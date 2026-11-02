import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./2026-11-02-metric-trigger-371-relapse-contract.sql", import.meta.url), "utf8");
const rollback = migration.match(/^-- Rollback: (.*)$/m)?.[1];
assert.ok(rollback);
assert.match(migration, /^-- APPLY-BY: ci$/m);
assert.match(migration, /^-- DB: qnfo-audit$/m);
assert.match(migration, /^-- BACKUP: bak_20261102_metric_trigger_371_relapse$/m);

function setup({
  issueOpen = true,
  triggerEnabled = true,
  metricReadable = true,
  metricClear = true,
  primaryMonitoring = true,
  staleRelapse = true,
} = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, status TEXT);
    CREATE TABLE analytics_metric_triggers (
      id INTEGER PRIMARY KEY, metric_key TEXT, enabled INTEGER, operator TEXT, threshold REAL
    );
    CREATE TABLE v_metric_trigger_state (id INTEGER, metric_key TEXT, val REAL, hit INTEGER);
    CREATE TABLE remediation_contracts (
      class TEXT PRIMARY KEY, issue_id INTEGER, status TEXT, last_verdict TEXT,
      verify_probe TEXT, attempts INTEGER, max_attempts INTEGER, module TEXT
    );
    CREATE TABLE decision_log (
      actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT,
      rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT
    );
  `);
  db.prepare("INSERT INTO agent_issues VALUES (?, ?, ?)").run(
    2244, "METRIC-TRIGGER-371-REMEDY-EFFICACY-30D: Autonomy gap", issueOpen ? "open" : "closed",
  );
  db.prepare("INSERT INTO analytics_metric_triggers VALUES (?, ?, ?, ?, ?)").run(
    371, "remedy_efficacy_30d", triggerEnabled ? 1 : 0, "lt", 0.5,
  );
  db.prepare("INSERT INTO v_metric_trigger_state VALUES (?, ?, ?, ?)").run(
    371, "remedy_efficacy_30d", metricReadable ? 0.65 : null, metricClear ? 0 : 1,
  );
  const relapseProbe = staleRelapse
    ? "SELECT '0' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM metric_history WHERE metric = 'remedy_efficacy_30d' AND day > '2026-10-19' AND date('now') <= date('2026-10-19', '+30 days') AND value < 0.5"
    : "SELECT '0' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM metric_history WHERE metric = 'remedy_efficacy_30d' AND value < 0.5";
  const insertContract = db.prepare("INSERT INTO remediation_contracts VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  insertContract.run(
    "issue-2244", 2244, primaryMonitoring ? "monitoring" : "active",
    primaryMonitoring ? "monitoring:metric-condition (clear streak)" : "fail",
    "SELECT '1' AS expected FROM metric_registry WHERE metric='remedy_efficacy_30d' AND marker='REMEDY-EFFICACY-PER-TRIGGER-1'",
    2, 3, "probe-template-v1h",
  );
  insertContract.run("metric-relapse-2244", 2244, "active", "fail", relapseProbe, 10, 3, "improvement-relapse");
  return db;
}

const db = setup();
const issue = () => db.prepare("SELECT status FROM agent_issues WHERE id = 2244").get();
const recovery = () => db.prepare("SELECT status, last_verdict FROM remediation_contracts WHERE class = 'issue-2244'").get();
const relapse = () => db.prepare("SELECT status, last_verdict FROM remediation_contracts WHERE class = 'metric-relapse-2244'").get();

db.exec(migration);
assert.equal(relapse().status, "superseded");
assert.match(relapse().last_verdict, /^superseded:METRIC-TRIGGER-371-RELAPSE-CONTRACT-1/);
assert.equal(recovery().status, "monitoring", "the current trigger-recovery contract remains intact");
assert.equal(issue().status, "open", "the migration does not close the issue before its clean streak");
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 1);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM bak_20261102_metric_trigger_371_relapse").get().n, 1);

const snapshot = () => JSON.stringify({
  issue: issue(),
  recovery: recovery(),
  relapse: relapse(),
  decision: db.prepare("SELECT action FROM decision_log").all(),
  backup: db.prepare("SELECT * FROM bak_20261102_metric_trigger_371_relapse").all(),
});
const firstApply = snapshot();
db.exec(migration);
assert.equal(snapshot(), firstApply, "reapplying the migration is idempotent");

db.exec(rollback);
assert.deepEqual({ ...relapse() }, { status: "active", last_verdict: "fail" });
assert.deepEqual({ ...recovery() }, {
  status: "monitoring",
  last_verdict: "monitoring:metric-condition (clear streak)",
});
assert.equal(issue().status, "open");
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 1, "decision history remains append-only");

for (const options of [
  { issueOpen: false },
  { triggerEnabled: false },
  { metricReadable: false },
  { metricClear: false },
  { primaryMonitoring: false },
  { staleRelapse: false },
]) {
  const blocked = setup(options);
  blocked.exec(migration);
  assert.equal(blocked.prepare("SELECT status FROM remediation_contracts WHERE class = 'metric-relapse-2244'").get().status, "active",
    "without the exact live issue and recovery path, the relapse contract is untouched");
  assert.equal(blocked.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 0);
  blocked.close();
}

db.close();
console.log("metric-trigger-371-relapse-contract: all passed");
