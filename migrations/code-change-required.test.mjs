import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const sql = readFileSync(new URL("./2026-11-03-code-change-required.sql", import.meta.url), "utf8");
const db = new DatabaseSync(":memory:");
db.exec(`
CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT, root_cause TEXT, remediation TEXT, detector TEXT, probe_class TEXT, first_seen TEXT, trigger_condition TEXT, symptom TEXT, blast_radius TEXT);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER, expected_cadence_h REAL, status TEXT, precondition TEXT, action TEXT, escalate_to TEXT, module TEXT, next_due_at TEXT);
CREATE TABLE control_registry (control TEXT PRIMARY KEY, location TEXT, kind TEXT, guards_against TEXT, critical_path INTEGER, disposition TEXT, disposition_state TEXT, evidence TEXT);
CREATE TABLE capability_ledger (capability TEXT PRIMARY KEY, provenance TEXT, prerequisites TEXT, reliability REAL, acquired_at TEXT, evidence TEXT);
CREATE TABLE decision_log (actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE session_records (session_id TEXT PRIMARY KEY, wbs_code TEXT, agent_name TEXT, summary TEXT, decisions_made TEXT, files_changed TEXT, commits TEXT, infrastructure_changes TEXT, handoff_notes TEXT, execution_ratio REAL, total_tasks INTEGER, completed_tasks INTEGER, started_at TEXT, completed_at TEXT, created_at TEXT);
`);
db.exec(sql);
db.exec(sql);
assert.equal(db.prepare("SELECT count(*) AS n FROM agent_issues").get().n, 1);
assert.equal(db.prepare("SELECT count(*) AS n FROM session_records").get().n, 1);
const issue = db.prepare("SELECT * FROM agent_issues").get();
assert.equal(issue.status, "open");
assert.ok(issue.description.includes("PR #6489"));
const anchor = issue.description.match(/^code-anchor: (.+)$/m)[1];
const worker = readFileSync(new URL("../qnfo-fleet-control/worker.js", import.meta.url), "utf8");
assert.equal(worker.split(anchor).length - 1, 1);
const contract = db.prepare("SELECT * FROM remediation_contracts WHERE class = 'fm-pr-code-change-required'").get();
assert.equal(contract.verify_transport, "code-read");
const probe = JSON.parse(contract.verify_probe);
for (const path of probe.paths) {
  assert.ok(readFileSync(new URL("../" + path, import.meta.url), "utf8").includes(probe.contains));
}
assert.ok(db.prepare("SELECT outcome FROM decision_log LIMIT 1").get().outcome.includes("pending"));
assert.ok(db.prepare("SELECT handoff_notes FROM session_records").get().handoff_notes.includes("not live behavior"));
assert.equal(db.prepare("SELECT disposition FROM control_registry").get().disposition, "keep");
assert.ok(db.prepare("SELECT value FROM ops_config").get().value.includes("No empty"));
console.log("code-change-required migration: passed");
