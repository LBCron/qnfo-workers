import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("./2026-11-04-blind-spot-audit-2.sql", import.meta.url), "utf8");
const m = sql.match(/'workflow', '(\{.*?\})', 60000/s);
const steps = JSON.parse(m[1].replace(/''/g, "'")).steps;
const db = new DatabaseSync(":memory:");
db.exec(`
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE belief_registry (belief_key TEXT, claim TEXT, confidence REAL, probe_class TEXT);
CREATE TABLE remediation_verifications (id INTEGER PRIMARY KEY AUTOINCREMENT, class TEXT, pass INTEGER, verified_at TEXT);
CREATE TABLE failure_modes (fm_key TEXT, probe_class TEXT);
CREATE TABLE remediation_contracts (class TEXT, status TEXT, next_due_at TEXT, expected_cadence_h INTEGER);
CREATE TABLE metric_registry (metric TEXT, state TEXT, last_value TEXT, last_refreshed TEXT);
CREATE TABLE code_tasks (id TEXT, merged_at TEXT, deployed_at TEXT);
INSERT INTO code_tasks VALUES ('a', datetime('now','-1 day'), NULL), ('b', datetime('now','-1 day'), datetime('now'));
INSERT INTO metric_registry VALUES ('blindspots_open', NULL, NULL, NULL), ('stale_one', 'MEASURED', '1', '2020-01-01T00:00:00Z');
INSERT INTO belief_registry VALUES ('bad','claim bad',0.5,'p-bad'),('good','claim good',0.5,'p-good'),('old','claim old',0.5,'p-old');
INSERT INTO remediation_verifications (class, pass, verified_at) VALUES ('p-bad',0,datetime('now')),('p-good',1,datetime('now')),('p-old',1,datetime('now','-5 days'));
INSERT INTO failure_modes VALUES ('fm-a','fm-a'),('fm-b','fm-b');
INSERT INTO remediation_contracts VALUES ('fm-a','active',datetime('now'),1),('belief-x','active',datetime('now','+60 hours'),1),('issue-9','active',datetime('now','+60 hours'),24);
CREATE TABLE migration_runs (id INTEGER PRIMARY KEY, file TEXT, status TEXT, error TEXT);
INSERT INTO migration_runs VALUES (1,'a.sql','failed','boom'),(2,'b.sql','failed','x'),(3,'b.sql','ok',NULL);
INSERT INTO remediation_verifications (class, pass, verified_at) VALUES ('fm-a',1,datetime('now'));
`);
const run = () => { for (const s of steps) db.exec(s.sql); };
run(); run();
const t = db.prepare("SELECT title FROM agent_issues ORDER BY id").all().map(r => r.title);
assert.deepEqual(t, [
  "BLINDSPOT-1: belief bad is contradicted by its live probe",
  "BLINDSPOT-1: belief old has no probe result in 48 hours",
  "BLINDSPOT-1: 1 failure modes have a detector that never ran",
  "BLINDSPOT-1: 2 metrics have not refreshed in 3 days",
  "BLINDSPOT-1: 1 merged code tasks have no deploy evidence after 2 hours",
  "BLINDSPOT-1: 1 migration files have no ok row in migration_runs"]);
assert.ok(db.prepare("SELECT next_due_at <= datetime('now') ok FROM remediation_contracts WHERE class='issue-9'").get().ok, "a 24h contract parked 60h out (beyond cadence + 3h) is re-armed");
assert.ok(db.prepare("SELECT next_due_at <= datetime('now') ok FROM remediation_contracts WHERE class='belief-x'").get().ok, "far-out detector re-armed");
assert.equal(db.prepare("SELECT last_value v FROM metric_registry WHERE metric='blindspots_open'").get().v, "6");
console.log("ok");
