// LARGE-SEARCH-RECOVERY-1: idempotent detector registration and six-hour recurrence evidence.
// Run: node --no-warnings migrations/large-search-recovery.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const sql = readFileSync(new URL("2026-11-02-large-search-recovery.sql", import.meta.url), "utf8");
const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE code_tasks (path TEXT, status TEXT, last_error TEXT, updated_at TEXT);
  CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT, root_cause TEXT,
    remediation TEXT, detector TEXT, probe_class TEXT, first_seen TEXT, issue_id INTEGER);
  CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, precondition TEXT, action TEXT,
    verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER, escalate_to TEXT,
    expected_cadence_h INTEGER, status TEXT, module TEXT);
  CREATE TABLE decision_log (actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT,
    blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT,
    reach_gain TEXT, surfaces_tested TEXT);
  INSERT INTO remediation_contracts (class, action, verify_probe, verify_transport, status)
    VALUES ('issue-1001238', 'old action', 'old probe', 'd1-query', 'active');
`);
db.exec(sql);
db.exec(sql);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM failure_modes").get().n, 1);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 1);
assert.equal(db.prepare("SELECT action FROM bak_20261102_large_search_contract").get().action, "old action");
const detector = db.prepare("SELECT * FROM remediation_contracts WHERE class = 'fm-large-search-recovery'").get();
const issue = db.prepare("SELECT * FROM remediation_contracts WHERE class = 'issue-1001238'").get();
assert.equal(issue.verify_probe, detector.verify_probe);
assert.equal(issue.status, "active");
assert.equal(issue.verify_transport, "d1-query");
assert.equal(detector.expected_cadence_h, 1);

const observed = () => ({ ...db.prepare(issue.verify_probe).get() });
const zero = { expected: "0", observed: "0" };
assert.deepEqual(observed(), zero);
const insert = db.prepare("INSERT INTO code_tasks VALUES (?, ?, ?, ?)");
const now = Date.now();
const stamp = minutes => new Date(now - minutes * 60000).toISOString();
insert.run("qnfo-research-exec/worker.js", "failed", "NO-PROGRESS-CEILING-1: SEARCH occurs 0 times", stamp(10));
assert.deepEqual(observed(), { expected: "0", observed: "1" });
db.exec("DELETE FROM code_tasks");
insert.run("qnfo-research-exec/worker.js", "failed", "NO-PROGRESS-CEILING-1: SEARCH occurs 0 times", stamp(361));
insert.run("other/worker.js", "failed", "NO-PROGRESS-CEILING-1: SEARCH occurs 0 times", stamp(10));
insert.run("qnfo-research-exec/worker.js", "queued", "NO-PROGRESS-CEILING-1: SEARCH occurs 0 times", stamp(10));
insert.run("qnfo-research-exec/worker.js", "failed", "unrelated failure", stamp(10));
assert.deepEqual(observed(), zero);
for (const status of ["failed", "publish_failed", "reverted", "needs_human"]) {
  insert.run("qnfo-research-exec/worker.js", status, "NO-PROGRESS-CEILING-1: SEARCH occurs 0 times", stamp(359));
}
assert.deepEqual(observed(), { expected: "0", observed: "4" });

const rollback = /^-- Rollback: (.*?); revert the worker/m.exec(sql)[1] + ";";
db.exec(rollback);
assert.equal(db.prepare("SELECT action FROM remediation_contracts WHERE class = 'issue-1001238'").get().action, "old action");
assert.equal(db.prepare("SELECT status FROM remediation_contracts WHERE class = 'fm-large-search-recovery'").get().status, "superseded");
console.log("large-search-recovery: migration, recurrence detector and rollback passed");
