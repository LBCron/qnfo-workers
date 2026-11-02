import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./2026-11-02-metric-trigger-5797-relapse-contract.sql", import.meta.url), "utf8");
const rollback = migration.match(/^-- Rollback: (.*)$/m)?.[1];
assert.ok(rollback);
assert.match(migration, /^-- APPLY-BY: ci$/m);
assert.match(migration, /^-- DB: qnfo-audit$/m);
assert.match(migration, /^-- BACKUP: bak_20261102_metric_trigger_5797_relapse$/m);

function setup({ issueOpen = true, triggerEnabled = true, metricReadable = true, primaryMonitoring = true } = {}) {
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
    INSERT INTO agent_issues VALUES
      (2546, 'METRIC-TRIGGER-5797-CONTRACTS-UNEXECUTABLE-OPEN: issue', '${issueOpen ? "open" : "closed"}');
    INSERT INTO analytics_metric_triggers VALUES
      (5797, 'contracts_unexecutable_open', ${triggerEnabled ? 1 : 0}, 'gt', 0);
    INSERT INTO v_metric_trigger_state VALUES
      (5797, 'contracts_unexecutable_open', ${metricReadable ? 0 : "NULL"}, 0);
    INSERT INTO remediation_contracts VALUES
      ('issue-2546', 2546, '${primaryMonitoring ? "monitoring" : "active"}',
       '${primaryMonitoring ? "monitoring:metric-condition (clear streak)" : "fail"}',
       'SELECT ''1'' AS expected FROM v_metric_trigger_state WHERE id = 5797', 251, 3, 'probe-template-v1h'),
      ('metric-relapse-2546', 2546, 'active', 'fail',
       'SELECT ''0'' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM metric_history WHERE metric = ''contracts_unexecutable_open'' AND day > ''2026-10-18'' AND value > 0',
       14, 3, 'improvement-relapse');
  `);
  return db;
}

const eligible = setup();
const issue = () => eligible.prepare("SELECT status FROM agent_issues WHERE id = 2546").get();
const primary = () => eligible.prepare("SELECT status, last_verdict FROM remediation_contracts WHERE class = 'issue-2546'").get();
const relapse = () => eligible.prepare("SELECT status, last_verdict FROM remediation_contracts WHERE class = 'metric-relapse-2546'").get();

eligible.exec(migration);
assert.equal(relapse().status, "superseded");
assert.match(relapse().last_verdict, /^superseded:METRIC-TRIGGER-5797-RELAPSE-CONTRACT-1/);
assert.equal(primary().status, "monitoring", "the current trigger-recovery contract remains intact");
assert.equal(issue().status, "open", "the migration does not close the issue before its clean streak");
assert.equal(eligible.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 1);
assert.equal(eligible.prepare("SELECT COUNT(*) AS n FROM bak_20261102_metric_trigger_5797_relapse").get().n, 1);

const snapshot = () => JSON.stringify({
  issue: issue(),
  primary: primary(),
  relapse: relapse(),
  decision: eligible.prepare("SELECT action FROM decision_log").all(),
  backup: eligible.prepare("SELECT * FROM bak_20261102_metric_trigger_5797_relapse").all(),
});
const firstApply = snapshot();
eligible.exec(migration);
assert.equal(snapshot(), firstApply, "reapplying the migration is idempotent");

eligible.exec(rollback);
assert.deepEqual({ ...relapse() }, { status: "active", last_verdict: "fail" });
assert.deepEqual({ ...primary() }, {
  status: "monitoring",
  last_verdict: "monitoring:metric-condition (clear streak)",
});
assert.equal(issue().status, "open");
assert.equal(eligible.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 1, "decision history remains append-only");

for (const options of [
  { issueOpen: false },
  { triggerEnabled: false },
  { metricReadable: false },
  { primaryMonitoring: false },
]) {
  const blocked = setup(options);
  blocked.exec(migration);
  assert.equal(blocked.prepare("SELECT status FROM remediation_contracts WHERE class = 'metric-relapse-2546'").get().status, "active",
    "without the exact live issue and recovery path, the relapse contract is untouched");
  assert.equal(blocked.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 0);
  blocked.close();
}

eligible.close();
console.log("metric-trigger-5797-relapse-contract: all passed");
