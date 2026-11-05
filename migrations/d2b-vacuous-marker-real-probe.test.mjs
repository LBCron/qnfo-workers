// VACUOUS-MARKER-REAL-PROBE-1 offline suite (migrations/2026-11-05-d2b-vacuous-marker-real-probe.sql; roadmap_implementation 1757 FM-4).
// VACUOUS-FLAP-1 stops the autoclose triggers from closing an already-reopened issue while an active or holding contract has an action starting with VACUOUS-PROBE (the born placeholder).
// Doers replace the probe and leave the action, so the marker outlives the placeholder. This applies the migration on SQLite (node:sqlite) and proves: the header (APPLY-BY ci, DB qnfo-audit, one
// single-line Rollback, a BACKUP table, nothing deleted or dropped in the body); the marker is cleared only for an active or holding contract whose probe has a failing verification with a non-empty
// observed value, and kept for a probe that never failed, for a superseded placeholder and for an empty-observed failure; the old action text is kept after the new prefix; a replay changes nothing;
// the hourly sweep step is appended once and run on its own clears a marker written later; the birth step of management-personas-c writes a measuring action next to the owner-wide probe (and a
// replay does not edit it twice); the detector reads the count the sweep has not cleared; and the clause of the autoclose trigger, replayed on SQLite, holds a reopened issue before the migration and
// lets its passing probe close it after; the Rollback restores actions and task definitions; scripts/apply_migrations.py --check accepts the file.
// Run: node --no-warnings migrations/d2b-vacuous-marker-real-probe.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const FILE = join(here, "2026-11-05-d2b-vacuous-marker-real-probe.sql");
const sql = readFileSync(FILE, "utf8").replace(/\r\n/g, "\n");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };

const lines = sql.split("\n");
const hdr = (k) => (lines.find((l) => l.startsWith("-- " + k + ": ")) || "").slice(k.length + 4).trim();
const rollback = hdr("Rollback");
const body = lines.filter((l) => !l.startsWith("--")).join("\n");
ok(hdr("APPLY-BY") === "ci" && hdr("DB") === "qnfo-audit", "the file opts in with APPLY-BY: ci and DB: qnfo-audit");
ok(lines.filter((l) => /^-- Rollback: /.test(l)).length === 1 && rollback.length > 300, "one single-line Rollback");
ok(hdr("BACKUP") === "bak_20261105_d2b_vacuous_marker" && /CREATE TABLE IF NOT EXISTS bak_20261105_d2b_vacuous_marker AS/.test(body), "a BACKUP table is named and created first");
ok(!/decision_log/i.test(rollback), "the Rollback never touches decision_log (append-only)");
ok(!/\bDELETE\b/i.test(body) && !/\bDROP\b/i.test(body), "the body deletes and drops nothing");
ok(!/claude\.ai|anthropic\.com/i.test(sql) && !/\[skip|skip[ -]ci|skip-checks/i.test(sql), "no claude.ai or anthropic.com link and no skip-CI token");

const MARK = "VACUOUS-PROBE-V3-1: this contract measures nothing while the issue is open, so it is born superseded and never blocks the close. A doer that knows the defect replaces this probe with one that measures it.";
const CIRCULAR = "SELECT 'closed' AS expected, (SELECT CASE WHEN status IN ('closed', 'resolved') THEN 'closed' ELSE NULL END FROM agent_issues WHERE id = 1) AS observed";
const BIRTH_SEG = "verify_transport = 'd1-query' WHERE class IN (SELECT 'issue-' || a.id FROM agent_issues a WHERE a.status = 'open' AND a.title LIKE 'METRIC-UNMEASURED-1: % has metrics with no value')";
const DDL = `
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT NOT NULL DEFAULT 'p', action TEXT NOT NULL, verify_probe TEXT NOT NULL, verify_transport TEXT NOT NULL DEFAULT 'd1-query', max_attempts INTEGER NOT NULL DEFAULT 3, escalate_to TEXT NOT NULL DEFAULT 'x', expected_cadence_h INTEGER, status TEXT DEFAULT 'active', last_verdict TEXT);
CREATE TABLE remediation_verifications (id INTEGER PRIMARY KEY AUTOINCREMENT, issue_id INTEGER, class TEXT, pass INTEGER, expected TEXT, observed TEXT, verified_at TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
CREATE TRIGGER decision_log_no_delete BEFORE DELETE ON decision_log BEGIN SELECT RAISE(ABORT, 'DOCTRINE-1: decision_log is append-only (doctrine section 12)'); END;
CREATE TRIGGER decision_log_no_update BEFORE UPDATE ON decision_log BEGIN SELECT RAISE(ABORT, 'DOCTRINE-1: decision_log is append-only (doctrine section 12)'); END;
CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT NOT NULL, root_cause TEXT NOT NULL, remediation TEXT NOT NULL, detector TEXT NOT NULL, probe_class TEXT, first_seen TEXT NOT NULL, issue_id INTEGER, trigger_condition TEXT, symptom TEXT, blast_radius TEXT);
CREATE TABLE fleet_tasks (id TEXT PRIMARY KEY, name TEXT, type TEXT, definition TEXT, timeout_ms INTEGER, retries INTEGER, version INTEGER, enabled INTEGER, updated_at TEXT);
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, status TEXT);
CREATE TABLE issue_triage (issue_id INTEGER PRIMARY KEY, reopened_count INTEGER DEFAULT 0, triage_state TEXT);
CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, layer TEXT, kind TEXT, formula TEXT, source_of_truth TEXT, baseline TEXT, target TEXT, owner TEXT, disposition_actor TEXT, refresh_cadence TEXT, warning_band TEXT, kill_band TEXT, last_value TEXT, last_refreshed TEXT, state TEXT, refresh_class TEXT);
CREATE TABLE metric_breach_cause (metric_key TEXT PRIMARY KEY, cause_key TEXT NOT NULL, note TEXT);
CREATE TABLE roadmap_implementation (id INTEGER PRIMARY KEY, item TEXT, status TEXT, evidence TEXT);
CREATE VIEW v_vacuous_probe_share AS SELECT COUNT(*) AS open_issues, SUM(CASE WHEN EXISTS (SELECT 1 FROM remediation_contracts c WHERE c.issue_id = a.id AND c.status IN ('active', 'holding') AND c.action LIKE 'VACUOUS-PROBE%') THEN 1 ELSE 0 END) AS on_vacuous_probe FROM agent_issues a WHERE a.status = 'open';
`;
const PLUS_DEF = '{"steps":[{"type":"sql","name":"pl-ledger","db":"AUDIT","sql":"SELECT 1"}]}';
const C_DEF = JSON.stringify({ steps: [{ type: "sql", name: "mi-unmeasured-probe", db: "AUDIT", sql: "UPDATE remediation_contracts SET verify_probe = 'x', " + BIRTH_SEG + " AND COALESCE(verify_probe, '') NOT LIKE '%metric_improvement_now%'" }] });
const fresh = () => {
  const db = new DatabaseSync(":memory:");
  db.exec(DDL);
  const c = db.prepare("INSERT INTO remediation_contracts (class, issue_id, action, verify_probe, status) VALUES (?, ?, ?, ?, ?)");
  const v = db.prepare("INSERT INTO remediation_verifications (issue_id, class, pass, expected, observed) VALUES (?, ?, ?, ?, ?)");
  c.run("issue-10", 10, MARK, "SELECT '0' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM t", "active");      // measured: failed with observed
  v.run(10, "issue-10", 0, "0", "3"); v.run(10, "issue-10", 1, "0", "0");
  c.run("issue-11", 11, MARK, "SELECT '0' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM t", "holding");     // measured, holding
  v.run(11, "issue-11", 0, "0", "1");
  c.run("issue-12", 12, MARK, "SELECT '0' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM t", "active");      // never failed
  v.run(12, "issue-12", 1, "0", "0");
  c.run("issue-13", 13, MARK, CIRCULAR, "superseded");                                                              // born placeholder, superseded
  c.run("issue-14", 14, MARK, "SELECT '0' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM t", "active");      // failed with empty observed only
  v.run(14, "issue-14", 0, "0", "");
  c.run("issue-15", 15, "MEASURES a real thing", "SELECT 1", "active");                                              // no marker
  v.run(15, "issue-15", 0, "ok", "bad");
  db.prepare("INSERT INTO roadmap_implementation (id, item, status) VALUES (1757, 'FM-4', 'planned')").run();
  db.prepare("INSERT INTO fleet_tasks (id, name, type, definition, version) VALUES ('management-personas-plus', 'p', 'workflow', ?, 1), ('management-personas-c', 'c', 'workflow', ?, 1)").run(PLUS_DEF, C_DEF);
  for (const [id, n] of [[10, 2], [11, 0], [12, 1], [14, 1]]) { db.prepare("INSERT INTO agent_issues (id, title, status) VALUES (?, 't', 'open')").run(id); db.prepare("INSERT INTO issue_triage (issue_id, reopened_count) VALUES (?, ?)").run(id, n); }
  return db;
};
const one = (db, q, ...a) => db.prepare(q).get(...a);
const actionOf = (db, cls) => one(db, "SELECT action a FROM remediation_contracts WHERE class = ?", cls).a;

// the autoclose clause (VACUOUS-FLAP-1), as it stands in the live trigger: a reopened issue is held while an active or holding contract has a VACUOUS-PROBE action
const HELD = "SELECT COUNT(*) n FROM agent_issues a JOIN issue_triage t ON t.issue_id = a.id WHERE a.status = 'open' AND COALESCE(t.reopened_count, 0) >= 1 AND EXISTS (SELECT 1 FROM remediation_contracts cv WHERE cv.issue_id = a.id AND cv.status IN ('active', 'holding') AND cv.action LIKE 'VACUOUS-PROBE%')";
const db = fresh();
ok(one(db, HELD).n === 3, "before: the clause holds the three reopened issues (10, 12, 14)", one(db, HELD));
db.exec(sql);
ok(/^REAL-PROBE-1: /.test(actionOf(db, "issue-10")) && actionOf(db, "issue-10").endsWith(MARK), "a measuring probe loses the marker and the old action text is kept after the prefix");
ok(/^REAL-PROBE-1: /.test(actionOf(db, "issue-11")), "a holding contract is cleared too");
ok(actionOf(db, "issue-12") === MARK, "a probe that never failed keeps the marker");
ok(actionOf(db, "issue-13") === MARK, "a superseded born placeholder keeps the marker");
ok(actionOf(db, "issue-14") === MARK, "a failure with an empty observed value does not count as a measurement");
ok(actionOf(db, "issue-15") === "MEASURES a real thing", "a contract without the marker is untouched");
ok(one(db, HELD).n === 2, "after: the clause holds only the two reopened issues whose probe never measured (12, 14)", one(db, HELD));
ok(one(db, "SELECT COUNT(*) n FROM bak_20261105_d2b_vacuous_marker").n === 2 && one(db, "SELECT action a FROM bak_20261105_d2b_vacuous_marker WHERE class = 'issue-10'").a === MARK, "the backup holds the two cleared contracts with their old action");
const snap = JSON.stringify(db.prepare("SELECT class, action FROM remediation_contracts ORDER BY class").all());
db.exec(sql);
ok(JSON.stringify(db.prepare("SELECT class, action FROM remediation_contracts ORDER BY class").all()) === snap, "a replay changes no action");
ok(one(db, "SELECT COUNT(*) n FROM decision_log").n === 1 && one(db, "SELECT COUNT(*) n FROM failure_modes").n === 1, "a replay adds no second decision row or failure mode");

// ---- the standing sweep ----
const plusDef = JSON.parse(one(db, "SELECT definition d FROM fleet_tasks WHERE id = 'management-personas-plus'").d);
const sweep = plusDef.steps.filter((s) => s.name === "fm4-marker-sweep");
const share = plusDef.steps.filter((s) => s.name === "fm4-vacuous-share");
ok(plusDef.steps.length === 3 && sweep.length === 1 && sweep[0].type === "sql" && sweep[0].db === "AUDIT" && share.length === 1, "the plus task gains exactly one sweep step and one share step (a replay did not add a second)");
ok(plusDef.steps[1].name === "fm4-marker-sweep" && plusDef.steps[2].name === "fm4-vacuous-share", "the sweep runs before the share is measured");
ok(one(db, "SELECT version v FROM fleet_tasks WHERE id = 'management-personas-plus'").v === 3, "the plus task version is bumped once per appended step");
db.prepare("INSERT INTO remediation_contracts (class, issue_id, action, verify_probe, status) VALUES ('issue-20', 20, ?, 'SELECT 1', 'active')").run(MARK);
ok(one(db, "SELECT COUNT(*) n FROM remediation_contracts WHERE action LIKE 'VACUOUS-PROBE%' AND class = 'issue-20'").n === 1, "a doer replaces a probe later and leaves the marker");
db.prepare("INSERT INTO remediation_verifications (issue_id, class, pass, expected, observed) VALUES (20, 'issue-20', 0, 'ok', 'errors 4/10')").run();
const DETECT = one(db, "SELECT verify_probe p FROM remediation_contracts WHERE class = 'fm-vacuous-marker-on-measuring-probe'").p;
ok(db.prepare(DETECT).get().expected === "0" && db.prepare(DETECT).get().observed === "1", "the detector counts the marker the sweep has not cleared yet");
db.exec(sweep[0].sql);
ok(/^REAL-PROBE-1: /.test(actionOf(db, "issue-20")) && db.prepare(DETECT).get().observed === "0", "the sweep clears it and the detector reads 0 against 0");
db.exec(sweep[0].sql);
ok(actionOf(db, "issue-20").split("REAL-PROBE-1").length === 2, "the sweep is idempotent (no second prefix)");


// ---- the guard metric ----
const mrow = one(db, "SELECT * FROM metric_registry WHERE metric = 'vacuous_probe_share'");
ok(mrow && mrow.kind === "guard" && mrow.state === "UNMEASURED" && mrow.last_value === null && /exempt from a threshold trigger/.test(mrow.disposition_actor), "the guard metric is registered once, unmeasured, with a named trigger exemption");
ok(one(db, "SELECT cause_key c FROM metric_breach_cause WHERE metric_key = 'vacuous_probe_share'").c === "structure" && /INSERT OR IGNORE INTO metric_breach_cause/.test(sql) && /^-- CAUSE-MAPPED: /m.test(sql), "the breach cause is mapped in the same file and the header says so");
const mdb = fresh();
mdb.exec(sql);
// open issues 10, 11, 12, 14 are open (11 has reopened_count 0); after the migration 10 and 11 are cleared, 12 and 14 keep the marker (never measured)
mdb.exec(share[0].sql);
const m1 = one(mdb, "SELECT last_value v, state s, last_refreshed r FROM metric_registry WHERE metric = 'vacuous_probe_share'");
ok(m1.v === "0.5" && m1.s === "MEASURED" && m1.r > "2026-11-01", "the step writes on_vacuous_probe / open_issues (2 of 4 = 0.5) and MEASURED", m1);
mdb.exec("UPDATE agent_issues SET status = 'closed'");
mdb.exec(share[0].sql);
ok(one(mdb, "SELECT last_value v FROM metric_registry WHERE metric = 'vacuous_probe_share'").v === "0.5", "with no open issue the step writes nothing (the view has no denominator)");
ok(one(db, "SELECT status s FROM roadmap_implementation WHERE id = 1757").s === "built" && /fm-vacuous-marker-on-measuring-probe/.test(one(db, "SELECT evidence e FROM roadmap_implementation WHERE id = 1757").e), "roadmap item 1757 is built with the evidence (never deployed on a merge alone)");

// ---- the birth step ----
const cDef = JSON.parse(one(db, "SELECT definition d FROM fleet_tasks WHERE id = 'management-personas-c'").d);
ok(/verify_transport = 'd1-query', action = 'MEASURES the issue: every enabled metric trigger of the owner holds a value or carries a named exemption/.test(cDef.steps[0].sql) && cDef.steps[0].sql.endsWith("NOT LIKE '%metric_improvement_now%'"), "mi-unmeasured-probe writes a measuring action next to the owner-wide probe and keeps the rest of its statement");
ok(one(db, "SELECT version v FROM fleet_tasks WHERE id = 'management-personas-c'").v === 2 && cDef.steps[0].sql.split("VACUOUS-MARKER-REAL-PROBE-1").length === 2, "the birth step is edited once and the task version bumped once");

// ---- rollback ----
const rb = fresh();
rb.exec(sql);
rb.exec(rollback);
ok(actionOf(rb, "issue-10") === MARK && actionOf(rb, "issue-11") === MARK && actionOf(rb, "issue-12") === MARK, "the Rollback restores the cleared actions");
ok(one(rb, "SELECT definition d FROM fleet_tasks WHERE id = 'management-personas-plus'").d === PLUS_DEF && one(rb, "SELECT definition d FROM fleet_tasks WHERE id = 'management-personas-c'").d === C_DEF, "the Rollback restores both task definitions byte for byte");
ok(one(rb, "SELECT COUNT(*) n FROM remediation_contracts WHERE class LIKE 'fm-%'").n === 0 && one(rb, "SELECT COUNT(*) n FROM failure_modes").n === 0 && one(rb, "SELECT COUNT(*) n FROM decision_log").n === 1, "the Rollback removes the detector and the failure mode and leaves the decision row");
ok(one(rb, "SELECT COUNT(*) n FROM metric_registry").n === 0 && one(rb, "SELECT COUNT(*) n FROM metric_breach_cause").n === 0 && one(rb, "SELECT status s FROM roadmap_implementation WHERE id = 1757").s === "planned", "the Rollback removes the metric and its cause and reopens the roadmap item");

// ---- the migration check ----
const PY = ["python3", "python"].find((c) => spawnSync(c, ["-I", "-c", "import sys"], { encoding: "utf8" }).status === 0);
if (PY) {
  const chk = spawnSync(PY, ["-I", join(root, "scripts", "apply_migrations.py"), "--check", FILE], { encoding: "utf8" });
  ok(chk.status === 0 && /"ok": true/.test(chk.stdout), "the file passes scripts/apply_migrations.py --check", chk.stdout + chk.stderr);
}
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
