import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const sql = readFileSync(new URL("./2026-11-03-issue-yield-per-100.sql", import.meta.url), "utf8");
const rollback = /^-- Rollback: (.+)$/m.exec(sql)?.[1];
assert.ok(rollback, "migration declares a rollback");

const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, status TEXT);
  CREATE TABLE issue_lifecycle (issue_id INTEGER, to_status TEXT, has_evidence INTEGER, ts TEXT);
  CREATE TABLE issue_triage (issue_id INTEGER PRIMARY KEY, close_evidence TEXT);
  CREATE TABLE cost_daily (date TEXT, scope TEXT, usd REAL, updated_at TEXT);
  CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, last_value TEXT, last_refreshed TEXT);
  CREATE TABLE fleet_budget (node_class TEXT PRIMARY KEY, current REAL, cap REAL, updated_at TEXT);
  CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, precondition TEXT, action TEXT, verify_probe TEXT, module TEXT);
  CREATE TABLE decision_log (
    actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT,
    rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT
  );
`);

const addIssue = db.prepare("INSERT INTO agent_issues (id, status) VALUES (?, ?)");
const addTriage = db.prepare("INSERT INTO issue_triage (issue_id, close_evidence) VALUES (?, ?)");
const addLifecycle = db.prepare("INSERT INTO issue_lifecycle (issue_id, to_status, has_evidence, ts) VALUES (?, ?, ?, datetime('now', ?))");
for (const [id, status, evidence, hasEvidence, age] of [
  [1, "closed", "verified fix", 1, "-1 day"],
  [2, "closed", "verified fix", 1, "-2 days"],
  [3, "open", "verified fix", 1, "-1 day"],
  [4, "wontfix", "disposition only", 1, "-1 day"],
  [5, "closed", null, 0, "-1 day"],
  [6, "closed", "verified fix", 1, "-8 days"],
  [7, "closed", "verified fix", 1, "-1 day"],
]) {
  addIssue.run(id, status);
  if (id !== 7) addTriage.run(id, evidence);
  addLifecycle.run(id, "closed", hasEvidence, age);
}
addLifecycle.run(1, "closed", 1, "-12 hours");

const addCost = db.prepare("INSERT INTO cost_daily (date, scope, usd, updated_at) VALUES (date('now', ?), ?, ?, datetime('now'))");
for (let day = 0; day < 7; day++) {
  addCost.run(`-${day} days`, "fleet", 10,);
  addCost.run(`-${day} days`, "owner-direct", 1);
}
db.prepare("INSERT INTO metric_registry VALUES ('remedy_efficacy_30d', '0.5', datetime('now'))").run();
db.prepare("INSERT INTO fleet_budget VALUES ('cost:fleet_all_in_month', 400, 300, datetime('now'))").run();
db.prepare("INSERT INTO remediation_contracts VALUES ('issue-1000780', 'original precondition', 'original action', 'SELECT ''before'' AS expected, ''before'' AS observed', 'original module')").run();

db.exec(sql);
const view = () => db.prepare("SELECT * FROM v_issue_yield_per_100").get();
const baseline = view();
assert.equal(baseline.evidence_closures_7d, 2, "counts distinct evidenced closures, excluding reopened, wontfix, unevidenced, stale, and untriaged issues");
assert.equal(baseline.cost_days_7d, 7);
assert.equal(baseline.spend_usd_7d, 77);
assert.equal(baseline.issue_closures_per_100_usd_7d, 2.6);
assert.equal(baseline.remedy_quality, 0.5);
assert.equal(baseline.within_monthly_budget, 0);

const contract = () => db.prepare("SELECT * FROM remediation_contracts WHERE class = 'issue-1000780'").get();
const probeResult = () => db.prepare(contract().verify_probe).get();
const baselineContract = JSON.parse(contract().precondition);
assert.equal(baselineContract.contract, "ISSUE-YIELD-PER-100-1");
assert.equal(baselineContract.baseline_yield_per_100_usd, 2.6);
assert.equal(probeResult().observed.startsWith("pending:"), true, "baseline is not itself an improvement and budget is over cap");

addIssue.run(8, "closed");
addTriage.run(8, "verified fix");
addLifecycle.run(8, "closed", 1, "-1 hour");
db.prepare("UPDATE metric_registry SET last_value = '0.6' WHERE metric = 'remedy_efficacy_30d'").run();
db.prepare("UPDATE fleet_budget SET current = 299 WHERE node_class = 'cost:fleet_all_in_month'").run();
assert.equal(probeResult().observed, "pass", "higher yield, non-falling remedy quality, fresh complete cost and in-budget spend pass");

db.prepare("UPDATE metric_registry SET last_value = '0.49' WHERE metric = 'remedy_efficacy_30d'").run();
assert.equal(probeResult().observed.startsWith("pending:"), true, "a quality regression blocks closure");
db.prepare("UPDATE metric_registry SET last_value = '0.6' WHERE metric = 'remedy_efficacy_30d'").run();
db.prepare("UPDATE fleet_budget SET current = 301 WHERE node_class = 'cost:fleet_all_in_month'").run();
assert.equal(probeResult().observed.startsWith("pending:"), true, "over-budget spend blocks closure");
db.prepare("UPDATE fleet_budget SET current = 299 WHERE node_class = 'cost:fleet_all_in_month'").run();

db.prepare("UPDATE cost_daily SET usd = 0").run();
assert.equal(view().issue_closures_per_100_usd_7d, null, "zero spend is not reported as infinite or successful yield");
assert.equal(probeResult().observed.startsWith("pending:"), true);
db.prepare("UPDATE cost_daily SET usd = CASE scope WHEN 'fleet' THEN 10 ELSE 1 END").run();
db.prepare("DELETE FROM cost_daily WHERE date = date('now', '-6 days')").run();
assert.equal(view().cost_days_7d, 6);
assert.equal(view().issue_closures_per_100_usd_7d, null, "an incomplete cost window cannot create a yield score");
assert.equal(probeResult().observed.startsWith("pending:"), true);
addCost.run("-6 days", "fleet", 10);
addCost.run("-6 days", "owner-direct", 1);
assert.equal(probeResult().observed, "pass");

const original = { ...contract() };
const logCount = db.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n;
db.exec(sql);
assert.deepEqual({ ...contract() }, original, "replay preserves the original captured baseline");
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, logCount, "replay does not duplicate its decision");
db.exec(rollback);
assert.deepEqual({ ...contract() }, {
  class: "issue-1000780",
  precondition: "original precondition",
  action: "original action",
  verify_probe: "SELECT 'before' AS expected, 'before' AS observed",
  module: "original module",
}, "rollback restores the existing issue contract");
assert.throws(() => db.prepare("SELECT * FROM v_issue_yield_per_100").get(), /no such table/);
console.log("issue-yield-per-100: evidence, cost window, quality, budget, replay and rollback passed");
