import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./2026-11-02-metric-trigger-3062-relapse-contract.sql", import.meta.url), "utf8");
const relapseMigration = readFileSync(new URL("./2026-10-19-relapse-window-close-event.sql", import.meta.url), "utf8");
const rollback = migration.match(/^-- Rollback: (.*)$/m)?.[1];
const reopenTrigger = relapseMigration.match(/^CREATE TRIGGER remediation_reopen_on_relapse_d1[\s\S]*?^END;/m)?.[0];

assert.ok(rollback);
assert.ok(reopenTrigger);
assert.match(migration, /^-- APPLY-BY: ci$/m);
assert.match(migration, /^-- DB: qnfo-audit$/m);
assert.match(migration, /^-- BACKUP: bak_20261102_metric_trigger_3062_relapse$/m);

function setup({ retiredEnabled = 0, currentHit = 1, successorOpen = true, marker = true } = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE agent_issues (
      id INTEGER PRIMARY KEY, title TEXT, description TEXT, status TEXT, priority TEXT,
      close_channel TEXT, updated_at INTEGER
    );
    CREATE TABLE issue_triage (
      issue_id INTEGER PRIMARY KEY, rc TEXT, triage_state TEXT, owner TEXT, close_evidence TEXT,
      reopened_count INTEGER DEFAULT 0
    );
    CREATE TABLE remediation_contracts (
      class TEXT PRIMARY KEY, issue_id INTEGER, status TEXT, last_verdict TEXT,
      verify_probe TEXT, attempts INTEGER DEFAULT 0, max_attempts INTEGER DEFAULT 3
    );
    CREATE TABLE remediation_verifications (
      id INTEGER PRIMARY KEY, issue_id INTEGER, class TEXT, pass INTEGER, observed TEXT,
      expected TEXT, verified_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE issue_lifecycle (issue_id INTEGER, event TEXT, to_status TEXT, ts TEXT);
    CREATE TABLE analytics_metric_triggers (
      id INTEGER PRIMARY KEY, metric_key TEXT, enabled INTEGER, operator TEXT, threshold REAL
    );
    CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, target TEXT);
    CREATE TABLE v_metric_trigger_state (id INTEGER, metric_key TEXT, val REAL, hit INTEGER);
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
  db.prepare("INSERT INTO agent_issues VALUES (2196, ?, '', 'open', 'critical', NULL, 0)")
    .run("METRIC-TRIGGER-3062-ISSUES-OPEN-OVER-24H: Issue age: open issues older than one day");
  db.prepare("INSERT INTO agent_issues VALUES (1001231, ?, '', ?, 'critical', NULL, 0)")
    .run("METRIC-TRIGGER-5937-ISSUES-OPEN-OVER-120M: SLA breach: eligible issue work older than 120 minutes", successorOpen ? "open" : "closed");
  db.exec(`
    INSERT INTO issue_triage VALUES (2196, 'SLA-DRAIN-2', 'triaged', 'qnfo-fleet-control', NULL, 1);
    INSERT INTO remediation_contracts VALUES (
      'issue-2196', 2196, 'active', 'ISSUE-PROBE-AGENT-1: defect check',
      'WITH b AS (SELECT COUNT(*) AS n FROM agent_issues WHERE status = ''open'' AND ((CAST(strftime(''%s'',''now'') AS INTEGER) * 1000) - created_at) >= 86400000) SELECT ''0'' AS expected, CAST(n AS TEXT) AS observed FROM b', 0, 3
    );
    INSERT INTO remediation_contracts VALUES (
      'metric-relapse-2196', 2196, 'escalated', 'escalated:over-retried',
      'SELECT ''0'' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM metric_history WHERE metric = ''issues_open_over_24h'' AND day > ''2026-10-14'' AND date(''now'') <= date(''2026-10-14'', ''+30 days'') AND meets = 0', 17, 3
    );
    INSERT INTO remediation_contracts VALUES (
      'issue-1001231', 1001231, 'monitoring', 'monitoring:metric-condition (the probe reads a live metric)',
      'SELECT ''1'' AS expected, (SELECT hit FROM v_metric_trigger_state WHERE id = 5937) AS observed', 1, 3
    );
    INSERT INTO analytics_metric_triggers VALUES
      (3062, 'issues_open_over_24h', ${retiredEnabled}, 'gt', 0),
      (5937, 'issues_open_over_120m', 1, 'gt', 215);
    INSERT INTO metric_registry VALUES
      ('issues_open_over_24h', ${marker ? "'0 [superseded by issues_open_over_120m, SLA-120M-2]'" : "'0'"}),
      ('issues_open_over_120m', '0');
    INSERT INTO v_metric_trigger_state VALUES (5937, 'issues_open_over_120m', 280, ${currentHit});
  `);
  return db;
}

const eligible = setup();
eligible.exec(migration);
const issue = () => eligible.prepare("SELECT status, close_channel FROM agent_issues WHERE id = 2196").get();
const triage = () => eligible.prepare("SELECT rc, triage_state, owner, close_evidence FROM issue_triage WHERE issue_id = 2196").get();
const contract = (className) => eligible.prepare("SELECT status, last_verdict FROM remediation_contracts WHERE class = ?").get(className);

assert.equal(issue().status, "closed", "the superseded issue closes through triage synchronization");
assert.match(issue().close_channel, /^auto:triage-sync:/);
assert.equal(triage().triage_state, "closed");
assert.match(triage().close_evidence, /^superseded by #1001231/);
assert.match(triage().close_evidence, /enabled trigger 5937 is currently breached/);
assert.equal(contract("issue-2196").status, "superseded", "the primary probe over the retired signal is disabled");
assert.equal(contract("metric-relapse-2196").status, "superseded", "the exhausted historical relapse probe is disabled");
assert.equal(eligible.prepare("SELECT status FROM agent_issues WHERE id = 1001231").get().status, "open");

for (let i = 0; i < 3; i++) {
  eligible.prepare(`
    INSERT INTO remediation_verifications (issue_id, class, pass, observed, expected)
    VALUES (2196, 'metric-relapse-2196', 0, 'retired metric still has historical breaches', '0')
  `).run();
}
assert.equal(issue().status, "closed", "later historical probe failures cannot reopen a superseded issue");

const snapshot = () => JSON.stringify({
  issue: eligible.prepare("SELECT status, close_channel, updated_at FROM agent_issues WHERE id = 2196").get(),
  triage: triage(),
  primary: contract("issue-2196"),
  relapse: contract("metric-relapse-2196"),
  backup: eligible.prepare("SELECT * FROM bak_20261102_metric_trigger_3062_relapse").all(),
  decisions: eligible.prepare("SELECT action FROM decision_log").all(),
});
const firstApply = snapshot();
eligible.exec(migration);
assert.equal(snapshot(), firstApply, "reapplying the migration is idempotent");
assert.equal(eligible.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 1);

eligible.exec(rollback);
assert.equal(eligible.prepare("SELECT status, close_channel FROM agent_issues WHERE id = 2196").get().status, "open");
assert.equal(eligible.prepare("SELECT close_channel FROM agent_issues WHERE id = 2196").get().close_channel, null);
assert.deepEqual({ ...triage() }, {
  rc: "SLA-DRAIN-2",
  triage_state: "triaged",
  owner: "qnfo-fleet-control",
  close_evidence: null,
});
assert.deepEqual({ ...contract("issue-2196") }, {
  status: "active",
  last_verdict: "ISSUE-PROBE-AGENT-1: defect check",
});
assert.deepEqual({ ...contract("metric-relapse-2196") }, {
  status: "escalated",
  last_verdict: "escalated:over-retried",
});
assert.equal(eligible.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 1, "decision_log remains append-only");

for (const options of [{ retiredEnabled: 1 }, { currentHit: 0 }, { successorOpen: false }, { marker: false }]) {
  const blocked = setup(options);
  blocked.exec(migration);
  assert.equal(blocked.prepare("SELECT status FROM agent_issues WHERE id = 2196").get().status, "open",
    "without live supersession and breached-successor evidence the old issue stays open");
  assert.equal(blocked.prepare("SELECT status FROM remediation_contracts WHERE class = 'metric-relapse-2196'").get().status, "escalated",
    "without complete evidence the historical relapse contract stays unchanged");
  assert.equal(blocked.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 0);
  blocked.close();
}

eligible.close();
console.log("metric-trigger-3062-relapse-contract: all passed");
