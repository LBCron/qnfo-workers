import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./2026-11-02-metric-relapse-superseded.sql", import.meta.url), "utf8");
const relapseMigration = readFileSync(new URL("./2026-10-19-relapse-window-close-event.sql", import.meta.url), "utf8");
const rollback = migration.match(/^-- Rollback: (.*)$/m)?.[1];
const reopenTrigger = relapseMigration.match(/^CREATE TRIGGER remediation_reopen_on_relapse_d1[\s\S]*?^END;/m)?.[0];

assert.ok(rollback);
assert.ok(reopenTrigger);
assert.match(migration, /^-- APPLY-BY: ci$/m);
assert.match(migration, /^-- DB: qnfo-audit$/m);
assert.match(migration, /^-- BACKUP: bak_20261102_metric_relapse_superseded$/m);

function setup({ activeClaim = false, parentOpen = true } = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE agent_issues (
      id INTEGER PRIMARY KEY, title TEXT, description TEXT, status TEXT, priority TEXT,
      close_channel TEXT, updated_at INTEGER
    );
    CREATE TABLE issue_triage (
      issue_id INTEGER PRIMARY KEY, rc TEXT, triage_state TEXT, owner TEXT, sla_due_at TEXT,
      triaged_at TEXT, remediation TEXT, close_evidence TEXT, reopened_count INTEGER DEFAULT 0
    );
    CREATE TABLE remediation_contracts (
      class TEXT PRIMARY KEY, issue_id INTEGER, status TEXT, last_verdict TEXT,
      verify_probe TEXT, max_attempts INTEGER DEFAULT 3
    );
    CREATE TABLE remediation_verifications (
      id INTEGER PRIMARY KEY, issue_id INTEGER, class TEXT, pass INTEGER, observed TEXT,
      expected TEXT, verified_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE issue_lifecycle (issue_id INTEGER, event TEXT, to_status TEXT, ts TEXT);
    CREATE TABLE analytics_metric_triggers (id INTEGER PRIMARY KEY, metric_key TEXT, enabled INTEGER);
    CREATE TABLE metric_deps (
      child_metric TEXT, parent_metric TEXT, relation TEXT, active INTEGER DEFAULT 1
    );
    CREATE TABLE work_claims (
      issue_id INTEGER, path TEXT, released_at TEXT, expires_at TEXT
    );
    CREATE TABLE decision_log (
      actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT,
      rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT
    );
    CREATE TRIGGER triage_close_sync_issue_upd
    AFTER UPDATE OF triage_state ON issue_triage
    WHEN NEW.triage_state IN ('closed', 'closed-refuted', 'wontfix')
    BEGIN
      UPDATE agent_issues
      SET status = CASE WHEN NEW.triage_state = 'wontfix' THEN 'wontfix' ELSE 'closed' END,
          close_channel = COALESCE(close_channel, 'auto:triage-sync:' || COALESCE(NEW.owner, '')),
          updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
      WHERE id = NEW.issue_id AND status = 'open';
    END;
  `);
  db.exec(reopenTrigger);
  db.exec(`
    INSERT INTO agent_issues VALUES
      (100225, 'METRIC-TRIGGER-409-FLEET-AI-RUN-RATE-30D-USD', '', 'open', 'critical', NULL, 0),
      (99938, 'METRIC-TRIGGER-3689-MONTHLY-COST-RUN-RATE-USD', '', '${parentOpen ? "open" : "closed"}', 'critical', NULL, 0);
    INSERT INTO issue_triage (issue_id, rc, triage_state, owner, sla_due_at)
      VALUES (100225, 'breach-doctor:MD-6:migration', 'triaged', 'breach-doctor', datetime('now'));
    INSERT INTO remediation_contracts VALUES (
      'metric-relapse-100225', 100225, 'active', 'fail',
      'SELECT ''0'' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM metric_history WHERE metric = ''fleet_ai_run_rate_30d_usd'' AND day > ''2026-10-26'' AND date(''now'') <= date(''2026-10-26'', ''+30 days'') AND meets = 0',
      3
    );
    INSERT INTO analytics_metric_triggers VALUES
      (409, 'fleet_ai_run_rate_30d_usd', 0),
      (3689, 'monthly_cost_run_rate_usd', 1);
    INSERT INTO metric_deps VALUES
      ('fleet_ai_run_rate_30d_usd', 'monthly_cost_run_rate_usd', 'disabled-duplicate', 1);
  `);
  if (activeClaim) {
    db.prepare("INSERT INTO work_claims VALUES (100225, 'issue:100225', NULL, strftime('%Y-%m-%dT%H:%M:%SZ','now','+1 hour'))").run();
  }
  return db;
}

const eligible = setup();
eligible.exec(migration);
const issue = () => eligible.prepare("SELECT status, close_channel FROM agent_issues WHERE id = 100225").get();
const triage = () => eligible.prepare("SELECT rc, triage_state, close_evidence FROM issue_triage WHERE issue_id = 100225").get();
const contract = () => eligible.prepare("SELECT status, last_verdict FROM remediation_contracts WHERE class = 'metric-relapse-100225'").get();

assert.equal(issue().status, "closed", "the superseded issue closes through triage synchronization");
assert.match(issue().close_channel, /^auto:triage-sync:/);
assert.equal(triage().triage_state, "closed");
assert.match(triage().close_evidence, /^SUPERSEDED BY #99938:/);
assert.match(triage().close_evidence, /trigger 409 is disabled/);
assert.equal(contract().status, "superseded");
assert.match(contract().last_verdict, /^superseded:METRIC-RELAPSE-SUPERSEDED-1/);
assert.equal(eligible.prepare("SELECT status FROM agent_issues WHERE id = 99938").get().status, "open");

for (let i = 0; i < 3; i++) {
  eligible.prepare(`
    INSERT INTO remediation_verifications (issue_id, class, pass, observed, expected)
    VALUES (100225, 'metric-relapse-100225', 0, 'metric target still breached', '0')
  `).run();
}
assert.equal(issue().status, "closed", "later child-metric failures cannot reopen a superseded issue");

const snapshot = () => JSON.stringify({
  issue: eligible.prepare("SELECT status, close_channel, updated_at FROM agent_issues WHERE id = 100225").get(),
  triage: triage(),
  contract: contract(),
  backup: eligible.prepare("SELECT * FROM bak_20261102_metric_relapse_superseded ORDER BY contract_class").all(),
  decisions: eligible.prepare("SELECT action FROM decision_log").all(),
});
const firstApply = snapshot();
eligible.exec(migration);
assert.equal(snapshot(), firstApply, "reapplying the migration is idempotent");
assert.equal(eligible.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 1);

eligible.exec(rollback);
assert.equal(eligible.prepare("SELECT status, close_channel FROM agent_issues WHERE id = 100225").get().status, "open",
  "rollback restores the issue's prior status");
assert.equal(eligible.prepare("SELECT close_channel FROM agent_issues WHERE id = 100225").get().close_channel, null);
assert.deepEqual({ ...eligible.prepare("SELECT rc, triage_state, owner, close_evidence FROM issue_triage WHERE issue_id = 100225").get() },
  { rc: "breach-doctor:MD-6:migration", triage_state: "triaged", owner: "breach-doctor", close_evidence: null });
assert.deepEqual({ ...contract() }, { status: "active", last_verdict: "fail" });
assert.equal(eligible.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 1, "decision_log remains append-only");

for (const options of [{ activeClaim: true }, { parentOpen: false }]) {
  const blocked = setup(options);
  blocked.exec(migration);
  assert.equal(blocked.prepare("SELECT status FROM agent_issues WHERE id = 100225").get().status, "open",
    "without an unclaimed, open successor the issue stays open");
  assert.equal(blocked.prepare("SELECT status FROM remediation_contracts WHERE class = 'metric-relapse-100225'").get().status, "active",
    "without all supersession evidence the relapse contract stays active");
  blocked.close();
}

eligible.close();
console.log("metric-relapse-superseded: all passed");
