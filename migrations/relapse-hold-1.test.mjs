// RELAPSE-HOLD-1 offline suite: the autoclose triggers hold a relapsing issue until its passes span a stability window counted from its last reopen,
// the CF-OBS birth probe stops passing on Cloudflare's resolved status, and the relapse view and metric exist with their trigger and cause.
// Run: node --no-warnings migrations/relapse-hold-1.test.mjs   (exit 0 = all passed)
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const rd = (f) => readFileSync(new URL("./" + f, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const sqlNew = rd("2026-11-04-relapse-hold-1.sql");
const sqlAutoclose = rd("2026-11-03-monitoring-pass-autoclose.sql");
const sqlFamily = rd("2026-11-01-family-probe-at-birth.sql");

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? "  -- " + JSON.stringify(x).slice(0, 400) : "")); } };

const SCHEMA = `
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT DEFAULT 'open', close_channel TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE issue_triage (issue_id INTEGER PRIMARY KEY, rc TEXT, triage_state TEXT, owner TEXT, sla_due_at TEXT, close_evidence TEXT, reopened_count INTEGER NOT NULL DEFAULT 0);
CREATE TABLE issue_lifecycle (id INTEGER PRIMARY KEY AUTOINCREMENT, issue_id INTEGER NOT NULL, event TEXT NOT NULL, from_status TEXT, to_status TEXT, has_evidence INTEGER, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')));
CREATE INDEX idx_issue_lifecycle_issue ON issue_lifecycle (issue_id, ts);
CREATE TABLE remediation_verifications (id INTEGER PRIMARY KEY AUTOINCREMENT, issue_id INTEGER, class TEXT, action_ref INTEGER, probe_url TEXT, transport TEXT NOT NULL DEFAULT 'd1-query', expected TEXT, observed TEXT, pass INTEGER NOT NULL, verified_at TEXT DEFAULT (datetime('now')), verifier TEXT);
CREATE INDEX idx_rv_class_id ON remediation_verifications (class, id);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER, escalate_to TEXT, expected_cadence_h INTEGER, status TEXT DEFAULT 'active', module TEXT, next_due_at TEXT, last_verdict TEXT, attempts INTEGER DEFAULT 0);
CREATE TABLE issue_recurrence_now (family TEXT PRIMARY KEY, reopens_7d INTEGER, issues_7d INTEGER, reopens_24h INTEGER, opens_24h INTEGER);
CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT, updated_at TEXT);
CREATE TABLE analytics_metric_triggers (id INTEGER PRIMARY KEY, metric_key TEXT, title TEXT, source_table TEXT, operator TEXT, threshold REAL, priority INTEGER, action TEXT, owner TEXT, queue_target TEXT, cooldown_hours INTEGER, enabled INTEGER DEFAULT 1, notes TEXT);
CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, layer TEXT, kind TEXT, formula TEXT, source_of_truth TEXT, baseline TEXT, target TEXT, owner TEXT, disposition_actor TEXT, refresh_cadence TEXT, warning_band TEXT, kill_band TEXT, last_value TEXT, last_refreshed TEXT, state TEXT, refresh_class TEXT);
CREATE VIEW v_metric_trigger_state AS SELECT t.id, 0 AS hit FROM analytics_metric_triggers t;
CREATE TABLE fleet_tick (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, source TEXT);
CREATE TABLE metric_breach_cause (metric_key TEXT PRIMARY KEY, cause_key TEXT NOT NULL, note TEXT);
CREATE TABLE control_registry (control TEXT PRIMARY KEY, location TEXT NOT NULL, kind TEXT NOT NULL, guards_against TEXT, critical_path INTEGER NOT NULL DEFAULT 0, disposition TEXT NOT NULL, disposition_state TEXT NOT NULL DEFAULT 'planned', alternate_path TEXT, alternate_tested_at TEXT, evidence TEXT NOT NULL, issue_id INTEGER, reviewed_at TEXT);
CREATE TABLE control_alternate_probes (control TEXT PRIMARY KEY, probe_sql TEXT, window_note TEXT, enabled INTEGER);
CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT NOT NULL, root_cause TEXT NOT NULL, remediation TEXT NOT NULL, detector TEXT NOT NULL, probe_class TEXT, first_seen TEXT NOT NULL, issue_id INTEGER, trigger_condition TEXT, symptom TEXT, blast_radius TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT, outcome_matched INTEGER);
CREATE TABLE capability_ledger (capability TEXT PRIMARY KEY, provenance TEXT, prerequisites TEXT, reliability REAL, acquired_at TEXT, last_exercised_at TEXT, evidence TEXT);
CREATE TABLE metric_improvement_now (owner TEXT, verdict TEXT, bp26 INTEGER);
CREATE TABLE fleet_issue_dispatch (fingerprint TEXT PRIMARY KEY, category TEXT, state TEXT, payload TEXT);
INSERT INTO control_registry (control, location, kind, disposition, evidence) VALUES ('autoclose-hysteresis', 'x', 'hold', 'keep', 'x');
CREATE TRIGGER birth AFTER INSERT ON agent_issues WHEN NEW.status = 'open'
BEGIN
  INSERT INTO remediation_contracts (class, issue_id, status, verify_probe, verify_transport, module)
  VALUES ('issue-' || NEW.id, NEW.id, 'needs-machine-probe', 'needs-machine-probe', 'd1-query', 'birth');
END;
CREATE TRIGGER contract_probe_templates_v3_generic AFTER INSERT ON remediation_contracts
WHEN NEW.status = 'needs-machine-probe' AND NEW.issue_id IS NOT NULL
BEGIN
  UPDATE remediation_contracts SET status = 'superseded', module = 'probe-template-v3-generic',
      verify_probe = 'SELECT ''closed'' AS expected, NULL AS observed', action = 'VACUOUS-PROBE-V3-1'
  WHERE class = NEW.class AND status = 'needs-machine-probe';
END;
`;

// World as of 2026-11-04 before the change: the 11-03 autoclose triggers and the 11-01 birth triggers.
function world({ applyNew }) {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  db.exec(sqlFamily);
  db.exec(sqlAutoclose);
  if (applyNew) db.exec(sqlNew);
  return db;
}
const one = (db, q, ...v) => db.prepare(q).get(...v);
const all = (db, q, ...v) => db.prepare(q).all(...v);

let seq = 0;
// An open issue with a plain contract of its own (the birth trigger's generic contract is superseded and ignored by the autoclose gate).
function issue(db, title, { reopened = 0, reopenedAt = null, status = "open" } = {}) {
  const id = db.prepare("INSERT INTO agent_issues (title, description, status, source) VALUES (?, '', ?, 't')").run(title, status).lastInsertRowid;
  db.prepare("INSERT INTO issue_triage (issue_id, rc, triage_state, owner, sla_due_at, reopened_count) VALUES (?, 'rc', 'triaged', 'o', datetime('now'), ?)").run(id, reopened);
  if (reopenedAt) db.prepare("INSERT INTO issue_lifecycle (issue_id, event, from_status, to_status, ts) VALUES (?, 'reopened', 'closed', 'open', ?)").run(id, reopenedAt);
  return Number(id);
}
const cls = (id) => "issue-" + id;
const verify = (db, id, at, passed, observed = passed ? "ok" : "bad", verifier = "remediation-consumer@t") =>
  db.prepare("INSERT INTO remediation_verifications (issue_id, class, observed, pass, transport, verified_at, verifier) VALUES (?, ?, ?, ?, 'd1-query', ?, ?)").run(id, cls(id), observed, passed ? 1 : 0, at, verifier);
const status = (db, id) => one(db, "SELECT status FROM agent_issues WHERE id = ?", id).status;

// ---------------------------------------------------------------------------------------------------------------- headers and shape
ok(/^-- APPLY-BY: ci$/m.test(sqlNew) && /^-- DB: qnfo-audit$/m.test(sqlNew) && /^-- Rollback: .+/m.test(sqlNew) && /^-- BACKUP: bak_20261104_relapse_hold$/m.test(sqlNew), "migration opts in with APPLY-BY, DB, Rollback and BACKUP headers");
ok(!/CREATE (OR REPLACE )?TRIGGER[^\n]*\bON agent_issues\b/i.test(sqlNew.replace(/^--.*$/gm, "")), "no trigger is added on agent_issues (AGENT-ISSUES-TRIGGER-DEPTH-1)");

// ---------------------------------------------------------------------------------------------------------------- the defect: old triggers close on a pass from before the reopen
{
  const db = world({ applyNew: false });
  const id = issue(db, "CF-OBS-ISSUE-1: svc: boom", { reopened: 1, reopenedAt: "2026-11-02T10:42:51Z" });
  verify(db, id, "2026-11-02 10:23:06", true);
  verify(db, id, "2026-11-02 10:53:57", true);
  ok(status(db, id) === "closed", "reproduced: the old rule closes on the first pass after the reopen because the pass before it counted as the first of two");
}

// ---------------------------------------------------------------------------------------------------------------- the fix
{
  const db = world({ applyNew: true });

  // unchanged paths
  const fresh = issue(db, "CLEAN-FAMILY-1: first");
  verify(db, fresh, "2026-11-04 09:00:00", true);
  ok(status(db, fresh) === "closed", "a first-time issue in a family with no relapse closes on its first pass, as before");

  const gone = issue(db, "CLEAN-FAMILY-1: second", { status: "closed" });
  verify(db, gone, "2026-11-04 09:00:00", true);
  ok(status(db, gone) === "closed" && !one(db, "SELECT 1 AS x FROM issue_triage WHERE issue_id = ? AND close_evidence IS NOT NULL", gone), "a pass on an already closed issue does nothing");

  // the 1001278 case: reopened 10:42, passes 10:23 (before), 10:53, 11:20, 11:55
  const a = issue(db, "CF-OBS-ISSUE-1: svc: boom", { reopened: 1, reopenedAt: "2026-11-02T10:42:51Z" });
  verify(db, a, "2026-11-02 10:23:06", true);
  verify(db, a, "2026-11-02 10:53:57", true);
  ok(status(db, a) === "open", "reopened once: the pass from before the reopen no longer counts, the first pass after it does not close");
  verify(db, a, "2026-11-02 11:20:00", true);
  ok(status(db, a) === "open", "reopened once: 27 minutes of passes after the reopen are not enough");
  verify(db, a, "2026-11-02 11:55:00", true);
  ok(status(db, a) === "closed" && one(db, "SELECT close_channel c FROM agent_issues WHERE id = ?", a).c === "auto:verified-remediation-trigger", "reopened once: 62 minutes of continuous passes close it through the same channel");
  ok(/remediation_verifications#\d+ pass=1/.test(one(db, "SELECT close_evidence e FROM issue_triage WHERE issue_id = ?", a).e), "the close still carries its verification row as evidence");

  // three reopens need 120 minutes
  const b = issue(db, "FLEET-JOURNEY-FAILED-1: loop-heartbeats", { reopened: 3, reopenedAt: "2026-11-04T08:00:00Z" });
  verify(db, b, "2026-11-04 08:05:00", true);
  verify(db, b, "2026-11-04 09:10:00", true);
  verify(db, b, "2026-11-04 09:40:00", true);
  ok(status(db, b) === "open", "reopened three times: 95 minutes of passes are not enough");
  verify(db, b, "2026-11-04 10:10:00", true);
  ok(status(db, b) === "closed", "reopened three times: 125 minutes of passes close it");

  // a failure resets the run
  const c = issue(db, "TOOL-FAILURE: x", { reopened: 1 });
  verify(db, c, "2026-11-04 08:00:00", true);
  verify(db, c, "2026-11-04 08:30:00", false);
  verify(db, c, "2026-11-04 09:00:00", true);
  ok(status(db, c) === "open", "a failure between two passes: the pass after it is a first pass");
  verify(db, c, "2026-11-04 09:30:00", true);
  ok(status(db, c) === "open", "the run counts from the pass after the failure (30 minutes), not from the pass before it (90)");
  verify(db, c, "2026-11-04 10:05:00", true);
  ok(status(db, c) === "closed", "65 minutes after the failure it closes");

  // first close of a family that relapses: hold 20
  db.exec("INSERT INTO issue_recurrence_now VALUES ('RELAPSING-FAM-1', 2, 3, 1, 0), ('METRIC-TRIGGER-14350', 4, 1, 0, 0)");
  const d = issue(db, "RELAPSING-FAM-1: new one");
  verify(db, d, "2026-11-04 09:00:00", true);
  ok(status(db, d) === "open", "relapsing family, never reopened: a first pass does not close");
  verify(db, d, "2026-11-04 09:10:00", true);
  ok(status(db, d) === "open", "relapsing family: a second pass 10 minutes later is not a tick apart");
  verify(db, d, "2026-11-04 09:25:00", true);
  ok(status(db, d) === "closed", "relapsing family: a pass 25 minutes after the first closes");
  ok(one(db, "SELECT hold_min h FROM v_issue_close_hold WHERE issue_id = ?", d).h === 20, "the hold of a relapsing family is 20 minutes");

  // METRIC-TRIGGER issues key on their trigger id, like issue_recurrence_now
  db.exec("INSERT INTO analytics_metric_triggers (id, metric_key, enabled) VALUES (14350, 'm', 1)");
  const e = issue(db, "METRIC-TRIGGER-14350-POST-DEPLOY-ERROR-WORKERS: errors tripled");
  ok(one(db, "SELECT family f, hold_min h FROM v_issue_close_hold WHERE issue_id = ?", e).f === "METRIC-TRIGGER-14350" && one(db, "SELECT hold_min h FROM v_issue_close_hold WHERE issue_id = ?", e).h === 20, "a metric-trigger issue maps to its trigger's family");
  const unrelatedFam = issue(db, "NO-SUCH-FAM-1: y");
  ok(one(db, "SELECT hold_min h FROM v_issue_close_hold WHERE issue_id = ?", unrelatedFam).h === 0, "a family absent from issue_recurrence_now has no hold");

  // other clauses are intact
  const v = issue(db, "VAC-1: z", { reopened: 1 });
  db.prepare("INSERT INTO remediation_contracts (class, issue_id, action, verify_probe, verify_transport, status) VALUES ('vac-contract', ?, 'VACUOUS-PROBE-X', 'SELECT 1', 'd1-query', 'active')").run(v);
  verify(db, v, "2026-11-04 08:00:00", true); verify(db, v, "2026-11-04 10:00:00", true); verify(db, v, "2026-11-04 12:00:00", true);
  ok(status(db, v) === "open", "a reopened issue on a vacuous contract is still never auto-closed (VACUOUS-FLAP-1)");
  const m = issue(db, "MONITOR-1: w");
  verify(db, m, "2026-11-04 08:00:00", true, "ok", "qnfo-fleet-control/monitoring-pass@0.61.5");
  ok(status(db, m) === "open", "a monitoring-pass verification still never closes");
  for (const n of ["remediation_verification_autoclose_ins", "remediation_verification_autoclose_upd"]) {
    const t = one(db, "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?", n).sql;
    ok(t.includes("COALESCE(ms.hit, 1) <> 0") && t.includes("monitoring-pass@%") && t.includes("v_issue_close_hold"), n + " keeps the metric-trigger guard and the monitoring exclusion and reads the hold");
  }

  // update path
  const u = issue(db, "UPD-1: reopened", { reopened: 1, reopenedAt: "2026-11-04T07:00:00Z" });
  verify(db, u, "2026-11-04 07:10:00", true);
  const row = verify(db, u, "2026-11-04 07:20:00", false);
  db.prepare("UPDATE remediation_verifications SET pass = 1, observed = 'ok' WHERE id = ?").run(row.lastInsertRowid);
  ok(status(db, u) === "open", "update path: a failing row flipped to pass 10 minutes after the first pass does not close");
  const row2 = verify(db, u, "2026-11-04 08:30:00", false);
  db.prepare("UPDATE remediation_verifications SET pass = 1, observed = 'ok' WHERE id = ?").run(row2.lastInsertRowid);
  ok(status(db, u) === "closed", "update path: 80 minutes after the first post-reopen pass it closes");

  // kill switch restores the old two-pass rule
  db.exec("INSERT INTO ops_config (key, value) VALUES ('relapse_close_hold', 'off')");
  const k = issue(db, "KILL-1: reopened", { reopened: 2, reopenedAt: "2026-11-04T07:00:00Z" });
  verify(db, k, "2026-11-04 06:00:00", true);
  verify(db, k, "2026-11-04 07:10:00", true);
  ok(status(db, k) === "closed", "relapse_close_hold = off: a reopened issue closes on its second consecutive pass again");
  const k0 = issue(db, "RELAPSING-FAM-1: while off");
  verify(db, k0, "2026-11-04 09:00:00", true);
  ok(status(db, k0) === "closed", "relapse_close_hold = off: a relapsing family closes on its first pass again");
  const k1 = issue(db, "KILL-1: reopened but first pass", { reopened: 2 });
  verify(db, k1, "2026-11-04 09:00:00", true);
  ok(status(db, k1) === "open", "relapse_close_hold = off keeps the earlier requirement that a reopened issue has a previous pass");
  db.exec("DELETE FROM ops_config WHERE key = 'relapse_close_hold'");

  // the gate is cheap: the hold view is read by a primary-key lookup
  const plan = all(db, "EXPLAIN QUERY PLAN SELECT hold_min FROM v_issue_close_hold WHERE issue_id = 5").map((r) => r.detail).join(" | ");
  ok(!/SCAN (a|agent_issues)\b/.test(plan) && /SEARCH/.test(plan), "v_issue_close_hold is flattened to a lookup of one agent_issues row", plan);
}

// ---------------------------------------------------------------------------------------------------------------- CF-OBS probe
{
  const db = world({ applyNew: false });
  // one open and one closed CF-OBS issue born under the old template
  const open = db.prepare("INSERT INTO agent_issues (title, description, status, source) VALUES ('CF-OBS-ISSUE-1: a: e', 'x' || char(10) || 'cf-obs-id: grp-open' || char(10) || 'y', 'open', 'cf-obs-bridge')").run().lastInsertRowid;
  const shut = db.prepare("INSERT INTO agent_issues (title, description, status, source) VALUES ('CF-OBS-ISSUE-1: b: e', 'x' || char(10) || 'cf-obs-id: grp-shut' || char(10) || 'y', 'open', 'cf-obs-bridge')").run().lastInsertRowid;
  db.exec("UPDATE agent_issues SET status = 'closed' WHERE id = " + Number(shut));
  const quiet = db.prepare("INSERT INTO agent_issues (title, description, status, source) VALUES ('CF-OBS-ISSUE-1: q: e', 'x' || char(10) || 'cf-obs-id: grp-quiet' || char(10) || 'y', 'open', 'cf-obs-bridge')").run().lastInsertRowid;
  db.exec("UPDATE agent_issues SET status = 'closed' WHERE id = " + Number(quiet));
  const oldOpenProbe = one(db, "SELECT verify_probe p FROM remediation_contracts WHERE class = ?", cls(Number(open))).p;
  const oldShutProbe = one(db, "SELECT verify_probe p FROM remediation_contracts WHERE class = ?", cls(Number(shut))).p;
  const oldQuietProbe = one(db, "SELECT verify_probe p FROM remediation_contracts WHERE class = ?", cls(Number(quiet))).p;
  ok(oldOpenProbe.includes("state = 'resolved' OR (state <> 'resolved'"), "setup: the old birth template passes on resolved status");
  const now = Date.now();
  db.prepare("INSERT INTO fleet_issue_dispatch VALUES ('cf-obs-grp-open', 'worker-observability', 'resolved', ?)").run(JSON.stringify({ status: "resolved", lastObserved: now - 25_000, statusUpdated: now }));
  ok(one(db, oldOpenProbe).observed === "1", "setup: a group resolved 25 seconds after its last error passes the old probe");
  db.prepare("INSERT INTO fleet_issue_dispatch VALUES ('cf-obs-grp-shut', 'worker-observability', 'resolved', ?)").run(JSON.stringify({ lastObserved: now - 2 * 3600 * 1000 }));
  db.prepare("INSERT INTO fleet_issue_dispatch VALUES ('cf-obs-grp-quiet', 'worker-observability', 'resolved', ?)").run(JSON.stringify({ lastObserved: now - 9 * 3600 * 1000 }));

  db.exec(sqlNew);
  const newOpenProbe = one(db, "SELECT verify_probe p FROM remediation_contracts WHERE class = ?", cls(Number(open))).p;
  const keptShutProbe = one(db, "SELECT verify_probe p FROM remediation_contracts WHERE class = ?", cls(Number(shut))).p;
  const newQuietProbe = one(db, "SELECT verify_probe p FROM remediation_contracts WHERE class = ?", cls(Number(quiet))).p;
  ok(newOpenProbe !== oldOpenProbe, "the contract of an open CF-OBS issue is retuned");
  ok(keptShutProbe === oldShutProbe, "the contract of a closed issue whose group was seen 2 hours ago is left alone, so the migration reopens nothing");
  ok(newQuietProbe !== oldQuietProbe && newQuietProbe.includes("NOT (json_valid(payload)"), "the contract of a closed issue whose group has been quiet for 9 hours is retuned");
  ok(one(db, "SELECT action a FROM remediation_contracts WHERE class = ?", cls(Number(open))).a.includes("a resolved status alone is not quiet"), "the retuned contract says what it measures");
  ok(one(db, "SELECT COUNT(*) n FROM bak_20261104_relapse_hold WHERE kind = 'contract'").n === 3, "all three old contracts are in the backup table");

  const probe = (sql) => one(db, sql);
  db.prepare("UPDATE fleet_issue_dispatch SET state = 'resolved', payload = ? WHERE fingerprint = 'cf-obs-grp-open'").run(JSON.stringify({ lastObserved: now - 25_000 }));
  ok(probe(newOpenProbe).observed === "0", "resolved 25 seconds after the last error no longer passes");
  db.prepare("UPDATE fleet_issue_dispatch SET payload = ? WHERE fingerprint = 'cf-obs-grp-open'").run(JSON.stringify({ lastObserved: now - 5 * 3600 * 1000 }));
  ok(probe(newOpenProbe).observed === "0", "resolved but last seen 5 hours ago still fails");
  db.prepare("UPDATE fleet_issue_dispatch SET payload = ? WHERE fingerprint = 'cf-obs-grp-open'").run(JSON.stringify({ lastObserved: now - 7 * 3600 * 1000 }));
  ok(probe(newOpenProbe).observed === "1", "quiet for 7 hours passes");
  db.prepare("UPDATE fleet_issue_dispatch SET state = 'resolved', payload = ? WHERE fingerprint = 'cf-obs-grp-open'").run(JSON.stringify({ status: "resolved" }));
  ok(probe(newOpenProbe).observed === "1", "resolved with no usable observation time passes, so an old payload cannot strand the issue");
  db.prepare("UPDATE fleet_issue_dispatch SET state = 'tracked', payload = ? WHERE fingerprint = 'cf-obs-grp-open'").run(JSON.stringify({ lastObserved: now - 60_000 }));
  ok(probe(newOpenProbe).observed === "0", "an active group seen a minute ago fails");
  db.prepare("DELETE FROM fleet_issue_dispatch WHERE fingerprint = 'cf-obs-grp-open'").run();
  ok(probe(newOpenProbe).observed === "missing", "a missing group is not a pass");

  // births after the migration use the new template
  const born = db.prepare("INSERT INTO agent_issues (title, description, status, source) VALUES ('CF-OBS-ISSUE-1: c: e', 'x' || char(10) || 'cf-obs-id: grp-new' || char(10) || 'y', 'open', 'cf-obs-bridge')").run().lastInsertRowid;
  const bornContract = one(db, "SELECT * FROM remediation_contracts WHERE class = ?", cls(Number(born)));
  ok(bornContract.status === "active" && bornContract.module === "issue-birth-probe-families" && bornContract.verify_probe.includes("NOT (json_valid(payload)") && bornContract.action.includes("resolved status alone is not quiet"), "a new CF-OBS issue is born on the tightened probe", bornContract);
  db.prepare("INSERT INTO fleet_issue_dispatch VALUES ('cf-obs-grp-new', 'worker-observability', 'resolved', ?)").run(JSON.stringify({ lastObserved: now - 30_000 }));
  ok(one(db, bornContract.verify_probe).observed === "0", "a new CF-OBS issue does not pass on a resolved burst");
  // the dispatch bridge's later probe write is normalised by the reassert trigger to the safe shape
  db.prepare("UPDATE remediation_contracts SET verify_probe = ? WHERE class = ?").run("SELECT '1' AS expected, '1' AS observed", cls(Number(born)));
  const re = one(db, "SELECT verify_probe p FROM remediation_contracts WHERE class = ?", cls(Number(born))).p;
  ok(re.includes("ELSE 'missing' END AS observed") && re.includes("NOT (json_valid(payload)"), "the reassert trigger also writes the tightened shape");
}

// ---------------------------------------------------------------------------------------------------------------- relapse view, metric, trigger, cause
{
  const db = world({ applyNew: true });
  const ev = (id, event, minutesAgo) => db.prepare("INSERT INTO issue_lifecycle (issue_id, event, ts) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now', ?))").run(id, event, "-" + minutesAgo + " minutes");
  const fa = []; for (let i = 0; i < 6; i++) fa.push(issue(db, "FAM-A-1: item " + i));
  fa.forEach((id, i) => { ev(id, "dispositioned", 600 + i); if (i < 4) ev(id, "reopened", 300 + i); });
  ev(fa[0], "dispositioned", 100); ev(fa[0], "reopened", 90);                  // issue 0: 2 closes and 2 reopens
  const fb = []; for (let i = 0; i < 5; i++) fb.push(issue(db, "FAM-B-1: item " + i));
  fb.forEach((id, i) => { ev(id, "dispositioned", 500 + i); if (i === 0) ev(id, "reopened", 200); });
  const old = issue(db, "FAM-A-1: old"); ev(old, "reopened", 60 * 24 * 9);       // outside the 7 days
  const mt1 = issue(db, "METRIC-TRIGGER-1-X: a"), mt2 = issue(db, "METRIC-TRIGGER-2-Y: b");
  ev(mt1, "dispositioned", 50); ev(mt2, "dispositioned", 50);
  const rows = Object.fromEntries(all(db, "SELECT * FROM v_issue_relapse_7d").map((r) => [r.family, r]));
  ok(rows["FAM-A-1"].closes_7d === 7 && rows["FAM-A-1"].reopens_7d === 5 && rows["FAM-A-1"].issues_reopened_7d === 4 && rows["FAM-A-1"].relapse_rate_7d === 0.714, "family A: closes and reopens inside 7 days only", rows["FAM-A-1"]);
  ok(rows["FAM-A-1"].worst_issue_id === fa[0] && rows["FAM-A-1"].max_reopens_one_issue === 2, "family A: worst issue is the one with two reopens", rows["FAM-A-1"]);
  ok(rows["FAM-B-1"].closes_7d === 5 && rows["FAM-B-1"].reopens_7d === 1 && rows["FAM-B-1"].relapse_rate_7d === 0.2, "family B: a low relapse rate", rows["FAM-B-1"]);
  ok(rows["METRIC-TRIGGER"].closes_7d === 2, "metric-trigger issues are one coarse family in this view", rows["METRIC-TRIGGER"]);

  const m = one(db, "SELECT * FROM metric_registry WHERE metric = 'issue_relapse_families_7d'");
  ok(m && m.kind === "target" && m.state === "MEASURED" && m.last_value === "0" && m.baseline === "0", "the metric is registered and measured (an empty world reads 0)", m);
  db.exec("INSERT INTO fleet_tick (ts, source) VALUES (datetime('now'), 'migration:test')");
  ok(one(db, "SELECT last_value v FROM metric_registry WHERE metric = 'issue_relapse_families_7d'").v === "1", "the fleet tick reads one family over the line (A has 7 closes at 0.714)");
  const t = one(db, "SELECT * FROM analytics_metric_triggers WHERE metric_key = 'issue_relapse_families_7d'");
  ok(t && t.operator === "gt" && t.threshold === 0 && t.enabled === 1 && t.cooldown_hours <= 2 && t.action.includes("v_issue_relapse_7d"), "the metric has its enabled trigger with a lever and a cooldown of at most 2 hours", t);
  ok(one(db, "SELECT cause_key c FROM metric_breach_cause WHERE metric_key = 'issue_relapse_families_7d'").c === "issue-backlog", "the breach cause is mapped at registration");
  // refresh trigger
  for (let i = 0; i < 4; i++) db.prepare("UPDATE agent_issues SET title = title WHERE id = ?").run(fb[i]);
  fb.slice(1).forEach((id) => ev(id, "reopened", 20));
  db.exec("INSERT INTO fleet_tick (ts, source) VALUES (datetime('now'), 'migration:test')");
  ok(one(db, "SELECT last_value v FROM metric_registry WHERE metric = 'issue_relapse_families_7d'").v === "2", "the fleet tick refreshes the metric (family B now relapses too)");

  ok(one(db, "SELECT disposition d, kind k, disposition_state s FROM control_registry WHERE control = 'relapse-close-hold'").d === "keep", "the hold is recorded as a control");
  ok(one(db, "SELECT enabled e FROM control_alternate_probes WHERE control = 'relapse-close-hold'").e === 1, "the control has an alternate-path probe");
  ok(one(db, "SELECT verify_probe p FROM remediation_contracts WHERE class = 'fm-relapse-hold-present'").p.includes("v_issue_close_hold") && !one(db, "SELECT verify_probe p FROM remediation_contracts WHERE class = 'fm-relapse-hold-present'").p.includes(";"), "the failure-mode detector reads the triggers and holds no semicolon");
  ok(one(db, "SELECT observed o FROM (SELECT CAST((SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name IN ('remediation_verification_autoclose_ins', 'remediation_verification_autoclose_upd') AND instr(sql, 'v_issue_close_hold') > 0) AS TEXT) AS observed)").o === "2", "the detector's condition holds on the migrated world");
  const issues = all(db, "SELECT title, description FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.OPS #relapse-%'");
  ok(issues.length === 3 && issues.every((i) => /^code-task: repo=qnfo-workers path=\S+$/m.test(i.description) && /^code-anchor: .+$/m.test(i.description) && /^code-probe: \{.+\}$/m.test(i.description)), "three closer doers are filed with code-task, anchor and probe lines", issues.map((i) => i.title));
  ok(one(db, "SELECT COUNT(*) n FROM decision_log WHERE action LIKE 'RELAPSE-HOLD-1:%'").n === 1 && /closure_branching_ratio_24h/.test(one(db, "SELECT predicted_outcome p FROM decision_log WHERE action LIKE 'RELAPSE-HOLD-1:%'").p), "the prediction is logged once, naming its metric");

  // re-apply is idempotent and keeps the original rollback snapshot
  const before = one(db, "SELECT COUNT(*) n FROM bak_20261104_relapse_hold").n;
  db.exec(sqlNew);
  ok(one(db, "SELECT COUNT(*) n FROM bak_20261104_relapse_hold").n === before, "re-applying keeps the backup rows");
  ok(!one(db, "SELECT old_value v FROM bak_20261104_relapse_hold WHERE kind = 'trigger' AND record_key = 'remediation_verification_autoclose_ins'").v.includes("v_issue_close_hold"), "the backup still holds the pre-change trigger text");
  ok(one(db, "SELECT COUNT(*) n FROM decision_log WHERE action LIKE 'RELAPSE-HOLD-1:%'").n === 1 && one(db, "SELECT COUNT(*) n FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.OPS #relapse-%'").n === 3 && one(db, "SELECT COUNT(*) n FROM metric_registry WHERE metric = 'issue_relapse_families_7d'").n === 1, "re-applying duplicates no decision, issue or metric");
}

console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
