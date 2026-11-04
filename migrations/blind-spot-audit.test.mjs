import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("./2026-11-04-blind-spot-audit.sql", import.meta.url), "utf8");
const m = sql.match(/'workflow', '(\{.*?\})', 60000/s);
const steps = JSON.parse(m[1].replace(/''/g, "'")).steps;
const db = new DatabaseSync(":memory:");
db.exec(`
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE belief_registry (belief_key TEXT, claim TEXT, confidence REAL, probe_class TEXT);
CREATE TABLE remediation_verifications (id INTEGER PRIMARY KEY AUTOINCREMENT, class TEXT, pass INTEGER, verified_at TEXT);
CREATE TABLE failure_modes (fm_key TEXT, probe_class TEXT);
CREATE TABLE remediation_contracts (class TEXT, status TEXT);
CREATE TABLE metric_registry (metric TEXT, state TEXT, last_value TEXT, last_refreshed TEXT);
INSERT INTO metric_registry VALUES ('blindspots_open', NULL, NULL, NULL), ('stale_one', 'MEASURED', '1', '2020-01-01T00:00:00Z');
INSERT INTO belief_registry VALUES ('bad','claim bad',0.5,'p-bad'),('good','claim good',0.5,'p-good'),('old','claim old',0.5,'p-old');
INSERT INTO remediation_verifications (class, pass, verified_at) VALUES ('p-bad',0,datetime('now')),('p-good',1,datetime('now')),('p-old',1,datetime('now','-5 days'));
INSERT INTO failure_modes VALUES ('fm-a','fm-a'),('fm-b','fm-b');
INSERT INTO remediation_contracts VALUES ('fm-a','active');
INSERT INTO remediation_verifications (class, pass, verified_at) VALUES ('fm-a',1,datetime('now'));
`);
const run = () => { for (const s of steps) db.exec(s.sql); };
run(); run();
const t = db.prepare("SELECT title FROM agent_issues ORDER BY id").all().map(r => r.title);
assert.deepEqual(t, [
  "BLINDSPOT-1: belief bad is contradicted by its live probe",
  "BLINDSPOT-1: belief old has no probe result in 48 hours",
  "BLINDSPOT-1: 1 failure modes have a detector that never ran",
  "BLINDSPOT-1: 2 metrics have not refreshed in 3 days"]);
assert.equal(db.prepare("SELECT last_value v FROM metric_registry WHERE metric='blindspots_open'").get().v, "4");
console.log("ok");
