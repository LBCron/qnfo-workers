import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

// ISSUE-PROBE-HOURLY-DETECTOR-1: the detector reads 0 for a normal hour, 1 above 8 issue-probe-agent requests in 60 minutes, and ignores other requesters and older rows.
const migration = readFileSync(new URL("./2026-11-04-issue-probe-hourly-detector.sql", import.meta.url), "utf8");
assert.match(migration, /^-- APPLY-BY: ci$/m);
assert.match(migration, /^-- DB: qnfo-audit$/m);
assert.match(migration, /^-- Rollback: /m);
assert.doesNotMatch(migration, /DROP TRIGGER|CREATE TRIGGER/i, "detector only: the trigger change belongs to PROBE-BIRTH-CAP-1");

const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, status TEXT);
  CREATE TABLE cf_agent_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, requester TEXT NOT NULL, instance TEXT, created_at TEXT NOT NULL);
  CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT, root_cause TEXT, remediation TEXT, detector TEXT, probe_class TEXT, first_seen TEXT, issue_id INTEGER,
    trigger_condition TEXT, symptom TEXT, blast_radius TEXT);
  CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER,
    escalate_to TEXT, expected_cadence_h INTEGER, status TEXT, next_due_at TEXT, module TEXT, budget_ms INTEGER, max_items INTEGER, requires_container INTEGER);
  CREATE TABLE decision_log (actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT,
    predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
`);
db.exec(migration);
const probe = db.prepare("SELECT verify_probe FROM remediation_contracts WHERE class = 'fm-issue-probe-hourly-unbounded'").get().verify_probe;
const ago = (m) => new Date(Date.now() - m * 60000).toISOString().replace(/\.\d+Z$/, "Z");
const add = (who, minutes, n = 1) => { for (let i = 0; i < n; i++) db.prepare("INSERT INTO cf_agent_requests (requester, instance, created_at) VALUES (?, 'x', ?)").run(who, ago(minutes)); };

assert.deepEqual({ ...db.prepare(probe).get() }, { expected: "0", observed: "0" }, "an empty hour reads 0");
add("issue-probe-agent", 10, 8);
add("issue-probe-agent", 90, 50);
add("program-manager:QNFO.OPS", 5, 30);
assert.equal(db.prepare(probe).get().observed, "0", "8 requests in the hour, older and other-requester rows ignored");
add("issue-probe-agent", 1, 1);
assert.equal(db.prepare(probe).get().observed, "1", "9 requests in the hour trip it");

db.exec(migration);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 1);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM failure_modes").get().n, 1);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM remediation_contracts").get().n, 1);
db.close();
console.log("issue-probe-hourly-detector: all passed");
