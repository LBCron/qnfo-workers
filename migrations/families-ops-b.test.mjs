// WORKFLOW-AND-DRILL-PROBES-1 offline suite: replays migrations/2026-11-05-families-ops-b.sql on SQLite (node:sqlite) over stubs that hold the live probe texts read from qnfo-audit on 2026-11-04
// (the two chaos-drill probes, the single-green WORKFLOW-FAILED-1 probe, the probe of issue 1000747). Proves: (1) the evidence-guard drill passes for an issue older than the event retention and
// still fails for a recent issue that cites a missing event, for a missing annotate trigger and for the returned abort trigger; (2) the revise-refs-extend drill passes while the executor's
// soft-route throttle record is fresh and a revise-patch exists in 12 hours, and still fails for no throttle record, for a route silent 12 hours, and passes as before for a real revise-patch or
// the old pause text; (3) the single-green WORKFLOW-FAILED-1 contracts get the 24-hour streak probe (only those), which reads the failure of the last 24 hours; (4) the probe of 1000747 returns
// the literal ok when nothing closed prematurely since the fix and the counts text otherwise; (5) a second apply changes nothing; (6) the detector reads 0 after and 1 before.
// Run: node migrations/families-ops-b.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("./2026-11-05-families-ops-b.sql", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };

// live texts (qnfo-audit control_alternate_probes, 2026-11-04 22:58Z)
const EVIDENCE = String.raw`SELECT 'ok' AS expected, CASE WHEN NOT EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = 'agent_issues_evidence_annotate_ai' AND tbl_name = 'agent_issues' AND sql LIKE '%NO-SILENT%') THEN 'the annotate trigger agent_issues_evidence_annotate_ai is missing' WHEN EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = 'agent_issues_evidence_must_exist_ins') THEN 'the abort trigger agent_issues_evidence_must_exist_ins is back, so an issue that cites a missing event would be lost' WHEN EXISTS (SELECT 1 FROM agent_issues a WHERE a.source LIKE 'cloud_ops_events:%' AND typeof(a.created_at) = 'integer' AND a.created_at > (CAST(strftime('%s', 'now') AS INTEGER) - 1209600) * 1000 AND NOT EXISTS (SELECT 1 FROM cloud_ops_events e WHERE e.id = substr(a.source, 18)) AND COALESCE(a.description, '') NOT LIKE '%the cited evidence event%') THEN 'an issue of the last 14 days cites a missing event and carries no annotation' ELSE 'ok' END AS observed`;
const REVISE = String.raw`SELECT 'ok' AS expected, CASE WHEN COALESCE((SELECT value FROM ops_config WHERE key = 'research_revise_refs_extend'), 'on') NOT IN ('on', 'off') THEN 'ops_config research_revise_refs_extend holds a value other than on or off, and only the exact value off switches the route off' WHEN NOT EXISTS (SELECT 1 FROM cloud_ops_events WHERE kind = 'revise-patch' AND status IN ('ok', 'warn') AND ts > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-120 minutes')) AND NOT EXISTS (SELECT 1 FROM cloud_ops_events WHERE job = 'qnfo-research-exec' AND kind = 'research-budget' AND status = 'ok' AND instr(COALESCE(text, ''), 'daily budget exhausted') = 1 AND ts > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-30 minutes')) THEN 'the revise route recorded no revise-patch event in 120 minutes, so the switch guards a route that is not running' ELSE 'ok' END AS observed`;
const SINGLE_GREEN = (w) => `SELECT 'success' AS expected, COALESCE((SELECT conclusion FROM workflow_main_state WHERE workflow = '${w}'), 'never_seen') AS observed`;
const OLD_1000747 = String.raw`WITH closes AS (SELECT il.issue_id, il.ts AS close_ts, substr(ai.title,20) AS workflow FROM issue_lifecycle il JOIN agent_issues ai ON ai.id=il.issue_id WHERE ai.title LIKE 'WORKFLOW-FAILED-1:%' AND (il.event='closed' OR (il.event='dispositioned' AND il.to_status='closed')) AND il.ts >= strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 days')) SELECT '0 premature closes in 7d' AS expected, CAST(SUM(CASE WHEN EXISTS (SELECT 1 FROM workflow_failures f WHERE f.workflow=c.workflow AND f.run_at <= c.close_ts AND f.run_at > strftime('%Y-%m-%dT%H:%M:%SZ', c.close_ts, '-24 hours')) THEN 1 ELSE 0 END) AS TEXT) || ' premature closes in 7d (' || CAST(COUNT(*) AS TEXT) || ' closes total)' AS observed FROM closes c`;
const STREAK = (w) => `SELECT 'success' AS expected, (SELECT CASE WHEN EXISTS (SELECT 1 FROM workflow_failures WHERE workflow = '${w}' AND run_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-24 hours')) THEN 'failure-within-24h' ELSE conclusion END FROM workflow_main_state WHERE workflow = '${w}') AS observed`;
const ANNOTATE = `CREATE TRIGGER agent_issues_evidence_annotate_ai AFTER INSERT ON agent_issues
WHEN NEW.source LIKE 'cloud_ops_events:%' AND NOT EXISTS (SELECT 1 FROM cloud_ops_events e WHERE e.id = replace(NEW.source, 'cloud_ops_events:', ''))
BEGIN
  UPDATE agent_issues SET description = COALESCE(description, '') || char(10) || 'NO-SILENT-DROP-1: the cited evidence event ' || NEW.source || ' does not exist; the issue was kept and needs its evidence re-attached.'
  WHERE id = NEW.id;
END;`;

const isoAgo = (min) => new Date(Date.now() - min * 6e4).toISOString();
const msAgo = (min) => Date.now() - min * 6e4;
function build() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, status TEXT DEFAULT 'open', created_at INTEGER);
CREATE TABLE cloud_ops_events (id TEXT PRIMARY KEY, ts TEXT, kind TEXT, text TEXT, job TEXT, status TEXT);
CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE control_alternate_probes (control TEXT PRIMARY KEY, probe_sql TEXT NOT NULL, window_note TEXT, enabled INTEGER DEFAULT 1, last_run_at TEXT, last_pass INTEGER, last_pass_at TEXT, last_observed TEXT, created_at TEXT);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER, escalate_to TEXT, expected_cadence_h INTEGER, status TEXT DEFAULT 'active', next_due_at TEXT, module TEXT, budget_ms INTEGER, max_items INTEGER, requires_container INTEGER, last_verdict TEXT, attempts INTEGER DEFAULT 0);
CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT, root_cause TEXT, remediation TEXT, detector TEXT, probe_class TEXT, first_seen TEXT, issue_id INTEGER, trigger_condition TEXT, symptom TEXT, blast_radius TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT, outcome_matched INTEGER);
CREATE TABLE issue_lifecycle (id INTEGER PRIMARY KEY AUTOINCREMENT, issue_id INTEGER, event TEXT, from_status TEXT, to_status TEXT, ts TEXT);
CREATE TABLE workflow_failures (run_id INTEGER PRIMARY KEY, workflow TEXT, conclusion TEXT, run_at TEXT);
CREATE TABLE workflow_main_state (workflow TEXT PRIMARY KEY, conclusion TEXT);
`);
  db.exec(ANNOTATE);
  db.prepare("INSERT INTO control_alternate_probes (control, probe_sql, window_note) VALUES (?, ?, ?)").run("agent-issues-evidence-guard", EVIDENCE, "14 days: the trigger text from sqlite_master plus the issues it should have annotated");
  db.prepare("INSERT INTO control_alternate_probes (control, probe_sql, window_note) VALUES (?, ?, ?)").run("research-revise-refs-extend", REVISE, "120 minutes: a state check on one ops_config key | CHAOS-DRILL-BUDGET-PAUSE-1 2026-10-26: clause 2");
  db.exec(`INSERT INTO agent_issues (id, title, status) VALUES (100412, 'WORKFLOW-FAILED-1: deploy-gate', 'open'), (1001336, 'WORKFLOW-FAILED-1: code-task-publish', 'closed'), (1001226, 'WORKFLOW-FAILED-1: model-floor-guard', 'open'), (1000747, 'WORKFLOW-FAILED-1 close/reopen flapping: require 24-hour green streak', 'open'), (500, 'something else', 'open');`);
  const rc = db.prepare("INSERT INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, status, last_verdict, attempts) VALUES (?, ?, 'p', 'a', ?, 'd1-query', 3, 'x', ?, ?, ?)");
  rc.run("issue-100412", 100412, SINGLE_GREEN("deploy-gate"), "active", "pass", 521);
  rc.run("issue-1001336", 1001336, SINGLE_GREEN("code-task-publish"), "active", "pass", 12);
  rc.run("issue-1001226", 1001226, STREAK("model-floor-guard"), "active", "fail", 73);
  rc.run("issue-1000747", 1000747, OLD_1000747, "active", "fail", 20);
  rc.run("issue-500", 500, SINGLE_GREEN("not-a-workflow-issue"), "active", "pass", 1);
  return db;
}
const probe = (db, table, key) => { const q = table === "drill" ? db.prepare("SELECT probe_sql p FROM control_alternate_probes WHERE control = ?").get(key) : db.prepare("SELECT verify_probe p FROM remediation_contracts WHERE class = ?").get(key); const r = db.prepare(q.p).get(); return [r.expected, r.observed]; };
const drillOk = (db, key) => { const [e, o] = probe(db, "drill", key); return e === o ? "ok" : o; };

// ---- 1. agent-issues-evidence-guard ----
function evidenceCase(ageMin, annotated, fn) {
  const db = build();
  db.exec(`DROP TRIGGER agent_issues_evidence_annotate_ai`);
  db.exec(`INSERT INTO agent_issues (title, source, description, created_at) VALUES ('t', 'cloud_ops_events:evt-pruned', '${annotated ? "x the cited evidence event y" : "plain"}', ${msAgo(ageMin)})`);
  db.exec(ANNOTATE);
  fn(db);
}
evidenceCase(8 * 1440, false, (db) => {
  ok(/last 14 days/.test(drillOk(db, "agent-issues-evidence-guard")), "before: an 8-day-old issue whose event was pruned fails the drill (the live false positive)", drillOk(db, "agent-issues-evidence-guard"));
  db.exec(sql);
  ok(drillOk(db, "agent-issues-evidence-guard") === "ok", "after: the same 8-day-old issue is outside the 4-day window and the drill passes", drillOk(db, "agent-issues-evidence-guard"));
});
evidenceCase(1440, false, (db) => {
  db.exec(sql);
  ok(/last 14 days/.test(drillOk(db, "agent-issues-evidence-guard")) , "after: a 1-day-old issue that cites a missing event with no annotation still fails the drill (the guard is still judged)", drillOk(db, "agent-issues-evidence-guard"));
});
evidenceCase(1440, true, (db) => { db.exec(sql); ok(drillOk(db, "agent-issues-evidence-guard") === "ok", "after: an annotated recent issue passes"); });
{
  const db = build(); db.exec(sql);
  db.exec("DROP TRIGGER agent_issues_evidence_annotate_ai");
  ok(/annotate trigger/.test(drillOk(db, "agent-issues-evidence-guard")), "after: a missing annotate trigger still fails the drill");
  db.exec(ANNOTATE);
  db.exec("CREATE TRIGGER agent_issues_evidence_must_exist_ins BEFORE INSERT ON agent_issues BEGIN SELECT 1; END;");
  ok(/abort trigger/.test(drillOk(db, "agent-issues-evidence-guard")), "after: the returned abort trigger still fails the drill");
  const n = db.prepare("SELECT window_note w FROM control_alternate_probes WHERE control = 'agent-issues-evidence-guard'").get().w;
  ok(/^4 days/.test(n), "the window note says 4 days", n);
}

// ---- 2. research-revise-refs-extend ----
function reviseCase(events, fn) {
  const db = build();
  const ins = db.prepare("INSERT INTO cloud_ops_events (id, ts, kind, text, job, status) VALUES (?, ?, ?, ?, ?, ?)");
  events.forEach((e, i) => ins.run("e" + i, isoAgo(e.min), e.kind, e.text || "", e.job || "qnfo-research-exec", e.status || "ok"));
  fn(db);
}
const THROTTLE = (min) => ({ min, kind: "research-budget", text: "tick allowance: one stage every 12 ticks; spent=559119 budget=360000 (work slows, it does not stop)" });
const LEAN = (min) => ({ min, kind: "research-budget", status: "warn", text: "daily neuron target exceeded; continuing on lean route: spent=559119 budget=360000 width=1" });
const PATCH = (min) => ({ min, kind: "revise-patch", status: "ok" });
reviseCase([THROTTLE(10), PATCH(200)], (db) => {
  ok(/no revise-patch event in 120 minutes/.test(drillOk(db, "research-revise-refs-extend")), "before: silence of 200 minutes under the soft-route throttle fails the drill (the live false positive)");
  db.exec(sql);
  ok(drillOk(db, "research-revise-refs-extend") === "ok", "after: a fresh 'tick allowance' record and a revise-patch 200 minutes ago pass", drillOk(db, "research-revise-refs-extend"));
});
reviseCase([LEAN(5), PATCH(300)], (db) => { db.exec(sql); ok(drillOk(db, "research-revise-refs-extend") === "ok", "after: the 'daily neuron target exceeded;' warn record excuses the silence too"); });
reviseCase([THROTTLE(60), PATCH(200)], (db) => { db.exec(sql); ok(drillOk(db, "research-revise-refs-extend") === "ok", "after: a throttle record 60 minutes old (one hourly line since) still excuses"); });
reviseCase([THROTTLE(120), PATCH(200)], (db) => { db.exec(sql); ok(/no revise-patch/.test(drillOk(db, "research-revise-refs-extend")), "after: a throttle record 120 minutes old does not excuse (the executor may have stopped)"); });
reviseCase([THROTTLE(10), PATCH(800)], (db) => { db.exec(sql); ok(/no revise-patch/.test(drillOk(db, "research-revise-refs-extend")), "after: a route with no revise-patch for 800 minutes fails even under a fresh throttle record"); });
reviseCase([PATCH(200)], (db) => { db.exec(sql); ok(/no revise-patch/.test(drillOk(db, "research-revise-refs-extend")), "after: silence with no throttle record fails as before"); });
reviseCase([PATCH(30)], (db) => { db.exec(sql); ok(drillOk(db, "research-revise-refs-extend") === "ok", "after: a revise-patch 30 minutes ago passes as before"); });
reviseCase([{ min: 10, kind: "research-budget", text: "daily budget exhausted: spent=414726 budget=360000" }], (db) => { db.exec(sql); ok(drillOk(db, "research-revise-refs-extend") === "ok", "after: the old 'daily budget exhausted' pause still excuses as before"); });
reviseCase([THROTTLE(10), PATCH(200)], (db) => {
  db.exec(sql);
  db.exec("INSERT INTO ops_config (key, value) VALUES ('research_revise_refs_extend', 'banana')");
  ok(/other than on or off/.test(drillOk(db, "research-revise-refs-extend")), "after: clause 1 (the lever value) is untouched");
  ok(/CHAOS-DRILL-SOFT-ROUTE-1/.test(db.prepare("SELECT window_note w FROM control_alternate_probes WHERE control = 'research-revise-refs-extend'").get().w), "the window note records the change");
});

// ---- 3 and 4. WORKFLOW-FAILED-1 contracts ----
{
  const db = build(); db.exec(sql);
  const p = (c) => db.prepare("SELECT verify_probe p, last_verdict v, attempts a FROM remediation_contracts WHERE class = ?").get(c);
  ok(p("issue-100412").p === STREAK("deploy-gate") && p("issue-1001336").p === STREAK("code-task-publish"), "the two single-green contracts get the byte-exact wfiProbe text", [p("issue-100412").p, p("issue-1001336").p]);
  ok(p("issue-100412").v === null && p("issue-100412").a === 0, "their verdict and attempts are reset");
  ok(p("issue-1001226").p === STREAK("model-floor-guard") && p("issue-1001226").a === 73 && p("issue-1001226").v === "fail", "a contract that already has the streak probe is untouched");
  ok(p("issue-500").p === SINGLE_GREEN("not-a-workflow-issue"), "a contract of another issue is untouched");
  // behaviour: a failure inside 24 h keeps the streak probe off 'success'
  db.exec("INSERT INTO workflow_main_state (workflow, conclusion) VALUES ('deploy-gate', 'success')");
  db.prepare("INSERT INTO workflow_failures (run_id, workflow, conclusion, run_at) VALUES (1, 'deploy-gate', 'failure', ?)").run(isoAgo(120));
  ok(probe(db, "c", "issue-100412")[1] === "failure-within-24h", "a green run with a failure 2 hours earlier reads failure-within-24h, not success");
  db.exec("DELETE FROM workflow_failures");
  ok(probe(db, "c", "issue-100412")[1] === "success", "no failure in 24 hours reads success");
  const old = build();
  old.exec("INSERT INTO workflow_main_state (workflow, conclusion) VALUES ('deploy-gate', 'success')");
  old.prepare("INSERT INTO workflow_failures (run_id, workflow, conclusion, run_at) VALUES (1, 'deploy-gate', 'failure', ?)").run(isoAgo(120));
  ok(probe(old, "c", "issue-100412")[1] === "success", "before: the single-green probe read success two hours after a failure (the premature close)");
}
{
  const db = build();
  ok(probe(db, "c", "issue-1000747")[0] !== probe(db, "c", "issue-1000747")[1], "before: the probe of 1000747 can never pass (expected is the literal, observed carries a suffix even at 0)", probe(db, "c", "issue-1000747"));
  db.exec(sql);
  ok(probe(db, "c", "issue-1000747").join("|") === "ok|ok", "after: with no closes it reads ok|ok", probe(db, "c", "issue-1000747"));
  // a close since the fix, no failure before it
  const ts = (min) => new Date(Math.max(Date.now() - min * 6e4, Date.parse("2026-11-05T00:00:30Z"))).toISOString().replace(/\.\d+Z$/, "Z");
  db.prepare("INSERT INTO issue_lifecycle (issue_id, event, from_status, to_status, ts) VALUES (100412, 'closed', 'open', 'closed', ?)").run(ts(0));
  ok(probe(db, "c", "issue-1000747").join("|") === "ok|ok", "after: a close with no failure in the 24 hours before it is not premature");
  db.prepare("INSERT INTO workflow_failures (run_id, workflow, conclusion, run_at) VALUES (2, 'deploy-gate', 'failure', ?)").run(new Date(Date.parse(ts(0)) - 3 * 36e5).toISOString().replace(/\.\d+Z$/, "Z"));
  const bad = probe(db, "c", "issue-1000747");
  ok(bad[0] === "ok" && /^1 premature closes since 2026-11-05 \(1 closes total\)$/.test(bad[1]), "after: a close 3 hours after a failure is counted, as the counts text", bad);
  // closes before the fix date are not counted
  const old = build(); old.exec(sql);
  old.prepare("INSERT INTO issue_lifecycle (issue_id, event, from_status, to_status, ts) VALUES (1001336, 'dispositioned', 'open', 'closed', '2026-11-04T14:34:17Z')").run();
  old.prepare("INSERT INTO workflow_failures (run_id, workflow, conclusion, run_at) VALUES (3, 'code-task-publish', 'failure', '2026-11-04T12:20:56Z')").run();
  ok(probe(old, "c", "issue-1000747").join("|") === "ok|ok", "closes before 2026-11-05 are history, not counted against the fix");
}

// ---- 5. a second apply changes nothing ----
{
  const db = build(); db.exec(sql);
  const snap = () => JSON.stringify([db.prepare("SELECT class, verify_probe, last_verdict, attempts FROM remediation_contracts ORDER BY class").all(), db.prepare("SELECT control, probe_sql, window_note FROM control_alternate_probes ORDER BY control").all(), db.prepare("SELECT COUNT(*) c FROM failure_modes").get().c, db.prepare("SELECT COUNT(*) c FROM decision_log").get().c]);
  const a = snap(); db.exec(sql);
  ok(a === snap(), "a second apply changes nothing");
  // ---- 6. detector ----
  const det = db.prepare("SELECT verify_probe p FROM remediation_contracts WHERE class = 'fm-workflow-failed-single-green-probe'").get();
  const r = db.prepare(det.p).get();
  ok(r.expected === "0" && r.observed === "0", "the detector reads 0 after the file", r);
  db.exec("INSERT INTO agent_issues (id, title, status) VALUES (777, 'WORKFLOW-FAILED-1: charter-guard', 'open')");
  db.prepare("INSERT INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, status) VALUES ('issue-777', 777, 'p', 'a', ?, 'd1-query', 3, 'x', 'active')").run(SINGLE_GREEN("charter-guard"));
  ok(db.prepare(det.p).get().observed === "1", "the detector reads 1 for a new single-green WORKFLOW-FAILED-1 contract");
  ok(db.prepare("SELECT COUNT(*) c FROM bak_20261105_workflow_drill_probes").get().c === 5, "the backup holds exactly the 3 contracts that change (1000747, 100412, 1001336) and the 2 drills", db.prepare("SELECT kind, key FROM bak_20261105_workflow_drill_probes").all());
}

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
