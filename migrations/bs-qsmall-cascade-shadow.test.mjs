// RM-BS-QUNIVERSE-SMALL-1 slice 1 migration suite (roadmap_implementation 3257): the row moves to partial once with live evidence, the detector contract reads a finished run inside
// 26 hours (or the switch off), both filed issues name a real file and an anchor that occurs once in it, the decision row is written once, a second apply adds nothing, the rollback resets.
// Run: node migrations/bs-qsmall-cascade-shadow.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const sql = readFileSync(new URL("./2026-11-05-bs-qsmall-cascade-shadow.sql", import.meta.url), "utf8");
const worker = readFileSync(new URL("../qnfo-ai/worker.js", import.meta.url), "utf8");
assert.match(sql, /^-- APPLY-BY: ci$/m);
assert.match(sql, /^-- DB: qnfo-audit$/m);
assert.match(sql, /^-- Rollback: .+/m);
assert.ok(!/\bDELETE\b|\bDROP\b/i.test(sql.replace(/^--.*$/gm, "")), "no delete or drop, so no BACKUP header is needed");

function fixture(status = "planned", events = [], opsConfig = null) {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE roadmap_implementation (id INTEGER PRIMARY KEY, item TEXT, source TEXT, title TEXT, artifact_type TEXT, artifact_ref TEXT, status TEXT, evidence TEXT, verified_at TEXT);
    CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);
    CREATE TABLE decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested, outcome_matched INTEGER);
    CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id, trigger_condition, symptom, blast_radius);
    CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id, verify_probe, verify_transport, max_attempts, expected_cadence_h, status, precondition, action, escalate_to, last_verdict);
    CREATE TABLE cloud_ops_events (id TEXT, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT);
    CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT);
    INSERT INTO roadmap_implementation VALUES (3257, 'RM-BS-QUNIVERSE-SMALL-1', 'bluesky-2026-11', 't', 'worker', 'qnfo-ai', '${status}', 'docs/BLUE-SKY-ROADMAP-2026-11.md', NULL);
  `);
  const ins = db.prepare("INSERT INTO cloud_ops_events VALUES (?,?,?,?,?,?,?)");
  events.forEach(([hoursAgo, kind, st], i) => ins.run("e" + i, new Date(Date.now() - hoursAgo * 36e5).toISOString(), kind, "t", "{}", "qnfo-ai", st));
  if (opsConfig != null) db.prepare("INSERT INTO ops_config VALUES ('cascade_shadow', ?)").run(opsConfig);
  db.exec(sql);
  return db;
}
const observed = (db) => db.prepare(db.prepare("SELECT verify_probe FROM remediation_contracts WHERE class = 'fm-cascade-shadow-silent'").get().verify_probe).get();

// 1. the row moves to partial with live evidence that names the run, the finding and what is open; verified_at is set
{
  const db = fixture();
  const row = db.prepare("SELECT status, evidence, verified_at FROM roadmap_implementation WHERE id = 3257").get();
  assert.equal(row.status, "partial");
  assert.ok(row.verified_at);
  for (const needle of [/PR 7689/, /704303b30936/, /not_cheaper/, /CASCADE-SHADOW-1\.1/, /CASCADE-SHADOW-1\.2/, /Open:/, /fm-cascade-shadow-silent/]) assert.match(row.evidence, needle);
}
// 2. an in_progress row moves too; a row in any other state is left alone
{
  assert.equal(fixture("in_progress").prepare("SELECT status FROM roadmap_implementation WHERE id = 3257").get().status, "partial");
  const row = fixture("built").prepare("SELECT status, evidence FROM roadmap_implementation WHERE id = 3257").get();
  assert.equal(row.status, "built");
  assert.equal(row.evidence, "docs/BLUE-SKY-ROADMAP-2026-11.md");
}
// 3. the detector: a finished run inside 26 hours passes; none, an old one, a faulted one or another kind fails; the switch off passes
{
  const pass = (db) => { const o = observed(db); return o.expected === o.observed; };
  assert.ok(pass(fixture("planned", [[3, "cascade-shadow-run", "ok"]])));
  assert.ok(pass(fixture("planned", [[25, "cascade-shadow-run", "ok"]])));
  assert.ok(!pass(fixture("planned", [[27, "cascade-shadow-run", "ok"]])), "27 hours is stale");
  assert.ok(!pass(fixture("planned", [])), "no row at all");
  assert.ok(!pass(fixture("planned", [[1, "cascade-shadow-run", "error"], [1, "cascade-shadow", "ok"]])), "a faulted run and a candidate row are not a finished run");
  assert.ok(pass(fixture("planned", [], "off")), "the switch off is an intended silence");
  assert.ok(!pass(fixture("planned", [], "on")));
  const c = fixture().prepare("SELECT status, verify_transport, escalate_to FROM remediation_contracts WHERE class = 'fm-cascade-shadow-silent'").get();
  assert.deepEqual({ ...c }, { status: "active", verify_transport: "d1-query", escalate_to: "qnfo-code-orchestrator" });
  assert.equal(fixture().prepare("SELECT COUNT(*) AS n FROM failure_modes WHERE fm_key = 'cascade-shadow-silent'").get().n, 1);
}
// 4. both filed issues have a real path, an anchor that occurs exactly once in it, and a closing code-probe whose marker the doer adds
{
  const issues = fixture().prepare("SELECT title, description, source, status, priority FROM agent_issues ORDER BY id").all();
  assert.equal(issues.length, 2);
  assert.deepEqual(issues.map((i) => i.title.match(/CASCADE-SHADOW-1\.\d/)[0]), ["CASCADE-SHADOW-1.1", "CASCADE-SHADOW-1.2"]);
  for (const i of issues) {
    assert.equal(i.status, "open");
    assert.equal(i.source, "session:W2-H-3257");
    const path = /^code-task: repo=qnfo-workers path=(\S+)$/m.exec(i.description)[1];
    assert.equal(path, "qnfo-ai/worker.js");
    const anchor = /^code-anchor: (.+)$/m.exec(i.description)[1];
    assert.equal(worker.split(anchor).length - 1, 1, "the anchor occurs exactly once in " + path + ": " + anchor);
    assert.match(anchor, /^async function \w+\(.*\) \{$/, "the anchor is a function signature");
    const probe = JSON.parse(/^code-probe: (.+)$/m.exec(i.description)[1]);
    assert.deepEqual(probe.paths, ["qnfo-ai/worker.js"]);
    assert.ok(i.title.includes(probe.contains.replace("CASCADE-SHADOW-", "CASCADE-SHADOW-")), "the probe marker is the slice id");
    assert.ok(!worker.includes(probe.contains), "the probe fails until the doer lands the edit (" + probe.contains + ")");
  }
}
// 5. the decision row is written once and carries a prediction with a falsifier and a recorded miss
{
  const rows = fixture().prepare("SELECT action, predicted_outcome, outcome_matched FROM decision_log").all();
  assert.equal(rows.length, 1);
  assert.match(rows[0].action, /^RM-BS-QUNIVERSE-SMALL-1 slice 1:/);
  assert.match(rows[0].predicted_outcome, /Falsifier:/);
  assert.equal(rows[0].outcome_matched, 0, "the qwen3 part of the prediction did not hold");
}
// 6. a second apply adds nothing
{
  const db = fixture();
  db.exec(sql);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM agent_issues").get().n, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM remediation_contracts").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM failure_modes").get().n, 1);
}
// 7. the rollback header resets the row, supersedes the detector and closes the issues
{
  const db = fixture();
  db.exec(/^-- Rollback: (.+)$/m.exec(sql)[1]);
  assert.equal(db.prepare("SELECT status FROM roadmap_implementation WHERE id = 3257").get().status, "planned");
  assert.equal(db.prepare("SELECT status FROM remediation_contracts").get().status, "superseded");
  assert.deepEqual(db.prepare("SELECT status FROM agent_issues").all().map((r) => r.status), ["closed", "closed"]);
}
console.log("bs-qsmall-cascade-shadow: 7 groups passed");
