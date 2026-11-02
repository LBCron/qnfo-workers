import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const migration = readFileSync(new URL("./2026-11-02-runtime-probe-budget.sql", import.meta.url), "utf8");
const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE failure_modes (
    fm_key TEXT PRIMARY KEY, failure_mode TEXT, root_cause TEXT, remediation TEXT, detector TEXT,
    probe_class TEXT, first_seen TEXT, issue_id INTEGER, trigger_condition TEXT, symptom TEXT, blast_radius TEXT
  );
  CREATE TABLE decision_log (
    actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT,
    capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT
  );
  CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, status TEXT, title TEXT);
  CREATE TABLE remediation_contracts (
    class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT,
    max_attempts INTEGER, escalate_to TEXT, expected_cadence_h INTEGER, status TEXT, module TEXT,
    next_due_at TEXT, last_verdict TEXT
  );
  INSERT INTO agent_issues VALUES (2081, 'open', 'METRIC-TRIGGER-2038');
  INSERT INTO remediation_contracts (class, issue_id, status, last_verdict, next_due_at, verify_probe)
    VALUES ('issue-2081', 2081, 'superseded', 'superseded:carried-by-twin', '2026-10-21 13:44:12', 'original metric probe');
`);
const contract = () => db.prepare("SELECT * FROM remediation_contracts WHERE class = 'issue-2081'").get();
const park = () => db.exec("UPDATE remediation_contracts SET status = 'superseded', last_verdict = 'superseded:carried-by-twin' WHERE class = 'issue-2081'");

db.exec(migration);
assert.equal(contract().status, "active", "the open issue with no carrying twin is rearmed");
assert.equal(contract().verify_probe, "original metric probe", "recovery still uses the original metric predicate");
assert.notEqual(contract().next_due_at, "2026-10-21 13:44:12", "the old overdue timestamp is replaced");
assert.equal(db.prepare("SELECT datetime(?) <= datetime('now') AS due").get(contract().next_due_at).due, 1,
  "the recovery contract is immediately due");
db.exec("UPDATE remediation_contracts SET next_due_at = '2999-01-01' WHERE class = 'issue-2081'");
db.exec(migration);
assert.equal(contract().next_due_at, "2999-01-01", "rerunning does not reschedule an active contract");
assert.equal(db.prepare("SELECT COUNT(*) n FROM decision_log").get().n, 1, "the decision is idempotent");
assert.equal(db.prepare("SELECT COUNT(*) n FROM failure_modes").get().n, 1, "the failure mode is idempotent");
const detector = db.prepare("SELECT verify_probe FROM remediation_contracts WHERE class = 'fm-runtime-probe-budget'").get();
assert.ok(readFileSync(new URL("../scripts/remediation_consumer.py", import.meta.url), "utf8").includes(JSON.parse(detector.verify_probe).contains),
  "the code detector matches the actual runtime-first query");

park();
db.exec("INSERT INTO agent_issues VALUES (2082, 'open', ' metric-trigger-2038 '); INSERT INTO remediation_contracts (class, issue_id, status) VALUES ('issue-2082', 2082, 'holding')");
db.exec(migration);
assert.equal(contract().status, "superseded", "an open carrying twin retains ownership");
db.exec("UPDATE agent_issues SET status = 'closed' WHERE id = 2082");
db.exec(migration);
assert.equal(contract().status, "active", "a closed twin does not prevent recovery verification");
park();
db.exec("UPDATE agent_issues SET status = 'closed' WHERE id = 2081");
db.exec(migration);
assert.equal(contract().status, "superseded", "a closed issue is not rearmed");
db.exec("UPDATE agent_issues SET status = 'open' WHERE id = 2081; UPDATE remediation_contracts SET last_verdict = 'superseded:probe-unusable' WHERE class = 'issue-2081'");
db.exec(migration);
assert.equal(contract().status, "superseded", "a different supersession reason is preserved");
park();
db.exec(migration);
db.exec(/^-- Rollback: (.*)$/m.exec(migration)[1]);
assert.equal(contract().status, "superseded", "rollback restores the old contract status");
assert.equal(contract().next_due_at, "2026-10-21 13:44:12", "rollback restores the old due timestamp");
assert.equal(db.prepare("SELECT COUNT(*) n FROM failure_modes").get().n, 0, "rollback removes the failure mode");
assert.equal(db.prepare("SELECT COUNT(*) n FROM remediation_contracts WHERE class = 'fm-runtime-probe-budget'").get().n, 0,
  "rollback removes the detector");
assert.equal(db.prepare("SELECT COUNT(*) n FROM decision_log").get().n, 1, "rollback preserves the append-only decision");
db.close();
console.log("runtime-probe-budget: all passed");
