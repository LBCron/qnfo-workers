import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const migrationPath = fileURLToPath(new URL("./2026-11-02-orphan-metric-successor.sql", import.meta.url));
const migration = readFileSync(migrationPath, "utf8");
const rollback = migration.match(/^-- Rollback: (.+)$/m)?.[1];
assert.ok(rollback, "migration has one rollback line");

const db = () => {
  const d = new DatabaseSync(":memory:");
  d.exec(`
    CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, status TEXT, title TEXT, priority TEXT, close_channel TEXT, updated_at INTEGER);
    CREATE TABLE issue_triage (issue_id INTEGER PRIMARY KEY, rc TEXT, triage_state TEXT, owner TEXT, sla_due_at TEXT, close_evidence TEXT);
    CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, status TEXT, last_verdict TEXT, next_due_at TEXT, verify_probe TEXT, verify_transport TEXT, attempts INTEGER, action TEXT, module TEXT, max_attempts INTEGER);
    CREATE TABLE analytics_metric_triggers (id INTEGER PRIMARY KEY, metric_key TEXT, enabled INTEGER, queue_target TEXT);
    CREATE TABLE metric_deps (child_metric TEXT, parent_metric TEXT, relation TEXT, active INTEGER);
    CREATE TABLE work_claims (issue_id INTEGER, path TEXT, holder TEXT, released_at TEXT, expires_at TEXT);
    CREATE TABLE decision_log (id INTEGER PRIMARY KEY, actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT, outcome_matched INTEGER);
    CREATE TRIGGER issue_close_evidence_required BEFORE UPDATE OF status ON agent_issues
    WHEN NEW.status IN ('closed', 'resolved', 'wontfix') AND OLD.status NOT IN ('closed', 'resolved', 'wontfix')
    BEGIN
      SELECT RAISE(ABORT, 'close-without-evidence')
      WHERE NOT EXISTS (SELECT 1 FROM issue_triage t WHERE t.issue_id = NEW.id AND COALESCE(t.close_evidence, '') <> '');
    END;
    CREATE TRIGGER triage_close_sync_issue_upd AFTER UPDATE OF triage_state ON issue_triage
    WHEN NEW.triage_state IN ('closed', 'closed-refuted', 'wontfix')
    BEGIN
      UPDATE agent_issues SET status = CASE WHEN NEW.triage_state = 'wontfix' THEN 'wontfix' ELSE 'closed' END,
        close_channel = COALESCE(close_channel, 'auto:triage-sync:' || NEW.owner), updated_at = 1 WHERE id = NEW.issue_id AND status = 'open';
    END;
    CREATE TRIGGER agent_issues_superseded_contracts_upd AFTER UPDATE OF status ON agent_issues
    WHEN NEW.status IN ('closed', 'resolved') AND OLD.status NOT IN ('closed', 'resolved')
      AND EXISTS (SELECT 1 FROM issue_triage t WHERE t.issue_id = NEW.id AND lower(substr(t.close_evidence, 1, 10)) = 'superseded')
    BEGIN
      UPDATE remediation_contracts SET status = 'superseded', last_verdict = 'superseded:closure-superseded'
      WHERE issue_id = NEW.id AND status IN ('active', 'holding');
    END;
  `);
  return d;
};

const seed = (d, { parentStatus = "open", parentPriority = "critical", oldEnabled = 0, parentEnabled = 1, otherClaim = false } = {}) => {
  d.prepare("INSERT INTO agent_issues VALUES (2816, 'open', 'METRIC-TRIGGER-1959-ISSUES-WITHOUT-NEXT-ACTION: Autonomy gap', 'critical', NULL, 1)").run();
  d.prepare("INSERT INTO agent_issues VALUES (100301, ?, 'METRIC-TRIGGER-9901-ISSUES-OVER-24H-NO-DOER: Open issues older than 24 h with no doer', ?, NULL, 1)").run(parentStatus, parentPriority);
  d.prepare("INSERT INTO issue_triage VALUES (2816, 'triaged', 'triaged', 'qnfo-fleet-control', NULL, NULL)").run();
  d.prepare("INSERT INTO issue_triage VALUES (100301, 'triaged', 'triaged', 'qnfo-fleet-control', NULL, NULL)").run();
  d.prepare("INSERT INTO analytics_metric_triggers VALUES (1959, 'issues_without_next_action', ?, 'agent_issues')").run(oldEnabled);
  d.prepare("INSERT INTO analytics_metric_triggers VALUES (9901, 'issues_over_24h_no_doer', ?, 'agent_issues')").run(parentEnabled);
  d.prepare("INSERT INTO metric_deps VALUES ('issues_without_next_action', 'issues_over_24h_no_doer', 'disabled-duplicate', 1)").run();
  d.prepare("INSERT INTO remediation_contracts VALUES ('issue-2816', 2816, 'active', 'fail', '2026-11-02 10:25:46', 'SELECT ''0'' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM v_issues_no_next_action', 'd1-query', 3, 'needs-machine-probe', 'probe-template-v1h', 3)").run();
  d.prepare("INSERT INTO remediation_contracts VALUES ('metric-relapse-2816', 2816, 'active', 'fail', '2026-11-02 10:24:44', 'SELECT ''0'' AS expected FROM metric_history WHERE metric = ''issues_without_next_action''', 'd1-query', 3, 'replace remediation with structural fix', 'improvement-relapse', 3)").run();
  d.prepare("INSERT INTO remediation_contracts VALUES ('issue-100301', 100301, 'monitoring', 'monitoring:metric-condition (probe reads live metric)', '2026-10-20 06:49:07', 'SELECT ''1'' AS expected FROM v_metric_trigger_state WHERE id = 9901', 'd1-query', 2, 'needs-machine-probe', 'probe-template-v1h', 3)").run();
  d.prepare("INSERT INTO remediation_contracts VALUES ('issue-100301-BACKFILL-1', 100301, 'escalated', 'escalated:over-retried', NULL, 'SELECT ''closed-with-evidence'' AS expected', 'd1-query', 5, 're-probe', NULL, 5)").run();
  d.prepare("INSERT INTO work_claims VALUES (2816, 'issue:2816', 'copilot-2816-fix-autonomy-gap-issue', NULL, '2099-01-01T00:00:00Z')").run();
  if (otherClaim) d.prepare("INSERT INTO work_claims VALUES (100301, 'issue:100301', 'other-session', NULL, '2099-01-01T00:00:00Z')").run();
};

const eligible = db();
seed(eligible);
eligible.exec(migration.replace(/^--.*$/gm, ""));
assert.equal(eligible.prepare("SELECT status FROM agent_issues WHERE id = 2816").get().status, "closed");
assert.match(eligible.prepare("SELECT close_evidence FROM issue_triage WHERE issue_id = 2816").get().close_evidence, /^SUPERSEDED BY #100301:/);
assert.equal(eligible.prepare("SELECT status FROM remediation_contracts WHERE class = 'metric-relapse-2816'").get().status, "superseded");
assert.equal(eligible.prepare("SELECT status FROM remediation_contracts WHERE class = 'issue-2816'").get().status, "superseded");
assert.equal(eligible.prepare("SELECT status FROM remediation_contracts WHERE class = 'issue-100301'").get().status, "active");
assert.equal(eligible.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 1);
eligible.exec(migration.replace(/^--.*$/gm, ""));
assert.equal(eligible.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 1, "replay is idempotent");

for (const options of [
  { parentStatus: "closed" },
  { parentPriority: "low" },
  { oldEnabled: 1 },
  { parentEnabled: 0 },
  { otherClaim: true },
]) {
  const d = db();
  seed(d, options);
  d.exec(migration.replace(/^--.*$/gm, ""));
  assert.equal(d.prepare("SELECT status FROM agent_issues WHERE id = 2816").get().status, "open", JSON.stringify(options));
  assert.equal(d.prepare("SELECT status FROM remediation_contracts WHERE class = 'issue-100301'").get().status, "monitoring", JSON.stringify(options));
  assert.equal(d.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 0, JSON.stringify(options));
}

eligible.exec(rollback);
assert.equal(eligible.prepare("SELECT status FROM agent_issues WHERE id = 2816").get().status, "open");
assert.equal(eligible.prepare("SELECT status FROM remediation_contracts WHERE class = 'metric-relapse-2816'").get().status, "active");
assert.equal(eligible.prepare("SELECT last_verdict FROM remediation_contracts WHERE class = 'issue-100301'").get().last_verdict, "monitoring:metric-condition (probe reads live metric)");
assert.equal(eligible.prepare("SELECT outcome FROM decision_log").get().outcome, "applied", "decision ledger remains append-only");

console.log("orphan-metric-successor: 0 failed");
