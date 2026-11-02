import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./2026-11-02-metric-trigger-5796-relapse-contract.sql", import.meta.url), "utf8");
const relapseMigration = readFileSync(new URL("./2026-10-19-relapse-window-close-event.sql", import.meta.url), "utf8");
const rollback = migration.match(/^-- Rollback: (.*)$/m)?.[1];
const reopenTrigger = relapseMigration.match(/^CREATE TRIGGER remediation_reopen_on_relapse_d1[\s\S]*?^END;/m)?.[0];
assert.ok(rollback);
assert.ok(reopenTrigger);
assert.match(migration, /^-- APPLY-BY: ci$/m);
assert.match(migration, /^-- DB: qnfo-audit$/m);
assert.match(migration, /^-- BACKUP: bak_20261102_metric_trigger_5796_superseded$/m);

function setup({
  issueOpen = true,
  successorOpen = true,
  successorPriority = "critical",
  old24Enabled = false,
  old120Enabled = false,
  successorEnabled = true,
  old24Superseded = true,
  old120Superseded = true,
  dependencyActive = true,
  primaryValid = true,
  relapseValid = true,
  extraFailure = false,
} = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE agent_issues (
      id INTEGER PRIMARY KEY, title TEXT, description TEXT, status TEXT, priority TEXT,
      close_channel TEXT, updated_at INTEGER
    );
    CREATE TABLE issue_triage (
      issue_id INTEGER PRIMARY KEY, rc TEXT, triage_state TEXT,
      owner TEXT, close_evidence TEXT, reopened_count INTEGER DEFAULT 0
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
    CREATE TABLE analytics_metric_triggers (
      id INTEGER PRIMARY KEY, metric_key TEXT, enabled INTEGER, operator TEXT, threshold REAL
    );
    CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, target TEXT);
    CREATE TABLE metric_deps (
      child_metric TEXT, parent_metric TEXT, relation TEXT, active INTEGER, note TEXT
    );
    CREATE TABLE decision_log (
      actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT,
      rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT
    );
    CREATE TRIGGER triage_close_sync
    AFTER UPDATE OF triage_state ON issue_triage
    WHEN NEW.triage_state IN ('closed', 'closed-refuted', 'wontfix')
    BEGIN
      UPDATE agent_issues
      SET status = CASE WHEN NEW.triage_state = 'wontfix' THEN 'wontfix' ELSE 'closed' END,
          close_channel = COALESCE(close_channel, 'auto:triage-sync:' || COALESCE(NEW.owner, '')),
          updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
      WHERE id = NEW.issue_id AND status = 'open';
    END;
    INSERT INTO agent_issues VALUES
      (2544, 'METRIC-TRIGGER-5796-OPEN-ISSUES-WITHOUT-DOER-24H: issue', '', '${issueOpen ? "open" : "closed"}', 'critical', NULL, 1000),
      (100301, 'METRIC-TRIGGER-9901-ISSUES-OVER-24H-NO-DOER: issue', '', '${successorOpen ? "open" : "closed"}', '${successorPriority}', NULL, 1000);
    INSERT INTO issue_triage (issue_id, rc, triage_state, owner, close_evidence)
      VALUES (2544, 'SLA-DRAIN-2', 'triaged', 'qnfo-fleet-control', NULL);
    INSERT INTO remediation_contracts (class, issue_id, status, last_verdict, verify_probe) VALUES
      ('issue-2544', 2544, 'escalated', 'escalated:over-retried',
       '${primaryValid ? "SELECT CAST(COUNT(*) AS TEXT) FROM agent_issues a WHERE a.created_at <= (CAST(strftime(''%s'',''now'') AS INTEGER) - 86400) * 1000 AND instr(a.description, ''code-task:'') = 0 AND NOT EXISTS (SELECT 1 FROM code_tasks c WHERE c.goal LIKE ''[issue #'' || a.id || '']%'')" : "SELECT 1"}'),
      ('metric-relapse-2544', 2544, 'escalated', 'escalated:over-retried',
       '${relapseValid ? "SELECT ''0'' AS expected FROM metric_history WHERE metric = ''open_issues_without_doer_24h'' AND day > ''2026-10-14''" : "SELECT 1"}');
    INSERT INTO analytics_metric_triggers VALUES
      (5796, 'open_issues_without_doer_24h', ${old24Enabled ? 1 : 0}, 'gt', 10),
      (5944, 'open_issues_without_doer_120m', ${old120Enabled ? 1 : 0}, 'gt', 190),
      (9901, 'issues_over_24h_no_doer', ${successorEnabled ? 1 : 0}, 'gt', 0);
    INSERT INTO metric_registry VALUES
      ('open_issues_without_doer_24h', '${old24Superseded ? "[superseded by open_issues_without_doer_120m, SLA-120M-6]" : "target"}'),
      ('open_issues_without_doer_120m', '${old120Superseded ? "[superseded by issues_over_24h_no_doer]" : "target"}');
    INSERT INTO metric_deps VALUES
      ('open_issues_without_doer_120m', 'issues_over_24h_no_doer', 'disabled-duplicate', ${dependencyActive ? 1 : 0}, 'BREACH-ONE-MEANING-1');
  `);
  db.exec(reopenTrigger);
  if (extraFailure) {
    db.prepare("INSERT INTO remediation_contracts (class, issue_id, status, last_verdict, verify_probe) VALUES (?, ?, ?, ?, ?)").run(
      "issue-2544-other", 2544, "escalated", "fail", "SELECT 0");
  }
  return db;
}

const eligible = setup();
eligible.exec(migration);
const issue = () => eligible.prepare("SELECT status, close_channel FROM agent_issues WHERE id = 2544").get();
const triage = () => eligible.prepare("SELECT rc, triage_state, close_evidence FROM issue_triage WHERE issue_id = 2544").get();
const contracts = () => eligible.prepare("SELECT class, status, last_verdict FROM remediation_contracts WHERE issue_id = 2544 ORDER BY class").all();
assert.equal(issue().status, "closed");
assert.match(issue().close_channel, /^auto:triage-sync:/);
assert.equal(triage().triage_state, "closed");
assert.match(triage().close_evidence, /^SUPERSEDED BY #100301:/);
assert.deepEqual(contracts().map(({ status }) => status), ["superseded", "superseded"]);
assert.equal(eligible.prepare("SELECT status FROM agent_issues WHERE id = 100301").get().status, "open");
assert.equal(eligible.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 1);
assert.equal(eligible.prepare("SELECT COUNT(*) AS n FROM bak_20261102_metric_trigger_5796_superseded").get().n, 4);
for (let i = 0; i < 3; i++) {
  eligible.prepare(`
    INSERT INTO remediation_verifications (issue_id, class, pass, observed, expected)
    VALUES (2544, 'metric-relapse-2544', 0, '18', '0')
  `).run();
}
assert.equal(issue().status, "closed", "historical metric failures cannot reopen a superseded issue");

const snapshot = () => JSON.stringify({
  issue: issue(),
  triage: triage(),
  contracts: contracts(),
  decision: eligible.prepare("SELECT action FROM decision_log").all(),
  backup: eligible.prepare("SELECT * FROM bak_20261102_metric_trigger_5796_superseded ORDER BY kind, record_key").all(),
});
const firstApply = snapshot();
eligible.exec(migration);
assert.equal(snapshot(), firstApply, "reapplying the migration is idempotent");

eligible.exec(rollback);
assert.deepEqual({ ...issue() }, { status: "open", close_channel: null });
assert.deepEqual({ ...triage() }, {
  rc: "SLA-DRAIN-2",
  triage_state: "triaged",
  close_evidence: null,
});
assert.deepEqual(contracts().map(({ status, last_verdict }) => ({ status, last_verdict })), [
  { status: "escalated", last_verdict: "escalated:over-retried" },
  { status: "escalated", last_verdict: "escalated:over-retried" },
]);
assert.equal(eligible.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 1, "decision history remains append-only");

for (const options of [
  { issueOpen: false },
  { successorOpen: false },
  { successorPriority: "low" },
  { old24Enabled: true },
  { old120Enabled: true },
  { successorEnabled: false },
  { old24Superseded: false },
  { old120Superseded: false },
  { dependencyActive: false },
  { primaryValid: false },
  { relapseValid: false },
  { extraFailure: true },
]) {
  const blocked = setup(options);
  blocked.exec(migration);
  assert.equal(blocked.prepare("SELECT status FROM agent_issues WHERE id = 2544").get().status,
    options.issueOpen === false ? "closed" : "open",
    "without all successor and stale-contract evidence the source issue stays open");
  assert.notEqual(blocked.prepare("SELECT status FROM remediation_contracts WHERE class = 'metric-relapse-2544'").get().status, "superseded");
  assert.equal(blocked.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 0);
  blocked.close();
}

eligible.close();
console.log("metric-trigger-5796-relapse-contract: all passed");
