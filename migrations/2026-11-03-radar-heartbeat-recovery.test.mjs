import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./2026-11-03-radar-heartbeat-recovery.sql", import.meta.url), "utf8");
assert.match(migration, /^-- APPLY-BY: ci$/m);
assert.match(migration, /^-- DB: qnfo-audit$/m);
const rollback = migration.match(/^-- Rollback: (.+)$/m)[1];
const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE failure_modes (
    fm_key TEXT PRIMARY KEY, failure_mode TEXT, root_cause TEXT, remediation TEXT,
    detector TEXT, probe_class TEXT, first_seen TEXT, issue_id INTEGER
  );
  CREATE TABLE remediation_contracts (
    class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT,
    verify_transport TEXT, max_attempts INTEGER, escalate_to TEXT, expected_cadence_h REAL, status TEXT, module TEXT
  );
  CREATE TABLE decision_log (
    actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT,
    rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT
  );
  CREATE TABLE worker_logs (script_name TEXT, ts_ms INTEGER, logs_json TEXT, exceptions_json TEXT);
  CREATE TABLE fleet_heartbeat (worker TEXT PRIMARY KEY, ts TEXT, ok INTEGER);
`);
db.exec(migration);
db.exec(migration);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM failure_modes").get().n, 1);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM remediation_contracts").get().n, 1);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 1);
const contract = db.prepare("SELECT * FROM remediation_contracts").get();
assert.equal(contract.verify_transport, "d1-query");
assert.equal(contract.class, db.prepare("SELECT probe_class FROM failure_modes").get().probe_class);
const observed = () => db.prepare(contract.verify_probe).get().observed;
assert.equal(db.prepare(contract.verify_probe).get().expected, "0");
assert.equal(observed(), "1", "missing heartbeat fails");
db.exec("INSERT INTO fleet_heartbeat VALUES ('radar-hub', strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-121 minutes'), 1)");
assert.equal(observed(), "1", "stale heartbeat fails");
db.exec("UPDATE fleet_heartbeat SET ts = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), ok = 0");
assert.equal(observed(), "0", "a fresh heartbeat proves writing works even when the cron work failed");
const error = JSON.stringify([{ message: ["fleet_heartbeat radar-hub: D1_ERROR: D1 DB storage operation exceeded timeout which caused object to be reset."] }]);
const addLog = db.prepare("INSERT INTO worker_logs VALUES (?, (strftime('%s', 'now') - ? * 60) * 1000, ?, ?)");
addLog.run("other-worker", 0, error, null);
addLog.run("radar-hub", 361, error, null);
addLog.run("radar-hub", 0, JSON.stringify([{ message: ["unrelated error"] }]), null);
assert.equal(observed(), "0", "other workers, old logs and unrelated errors do not fail");
addLog.run("radar-hub", 1, error, null);
assert.equal(observed(), "1", "console errors are detected even with null exceptions_json");
addLog.run("radar-hub", 1, null, error);
assert.equal(observed(), "2", "exception errors are detected even with null logs_json");
db.exec(rollback);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM failure_modes").get().n, 0);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM remediation_contracts").get().n, 0);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 1, "rollback preserves the append-only decision record");
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM fleet_heartbeat").get().n, 1, "rollback leaves existing heartbeat data intact");
db.close();
console.log("radar heartbeat recovery: detector, observation window, idempotency, and rollback passed");
