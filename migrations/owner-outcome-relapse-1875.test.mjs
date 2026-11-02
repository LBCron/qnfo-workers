import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./2026-11-02-owner-outcome-relapse-1875.sql", import.meta.url), "utf8");
const relapseMigration = readFileSync(new URL("./2026-10-19-relapse-window-close-event.sql", import.meta.url), "utf8");
const rollback = migration.match(/^-- Rollback: (.*)$/m)?.[1];
const reopenTrigger = relapseMigration.match(/^CREATE TRIGGER remediation_reopen_on_relapse_d1[\s\S]*?^END;/m)?.[0];

assert.ok(rollback);
assert.ok(reopenTrigger);
assert.match(migration, /^-- APPLY-BY: ci$/m);
assert.match(migration, /^-- DB: qnfo-audit$/m);
assert.match(migration, /^-- BACKUP: bak_20261102_owner_outcome_relapse_1875$/m);

function setup({ triggerEnabled = 0, ownerOutcomeMarker = true, goalPresent = true } = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE agent_issues (
      id INTEGER PRIMARY KEY, title TEXT, description TEXT, status TEXT, priority TEXT,
      close_channel TEXT, updated_at INTEGER
    );
    CREATE TABLE issue_triage (
      issue_id INTEGER PRIMARY KEY, rc TEXT, triage_state TEXT, owner TEXT, triaged_at TEXT,
      close_evidence TEXT, reopened_count INTEGER DEFAULT 0
    );
    CREATE TABLE remediation_contracts (
      class TEXT PRIMARY KEY, issue_id INTEGER, status TEXT, last_verdict TEXT, verify_probe TEXT,
      verify_transport TEXT, attempts INTEGER DEFAULT 0, last_attempt_at TEXT, next_due_at TEXT,
      precondition TEXT, action TEXT, max_attempts INTEGER DEFAULT 3, escalate_to TEXT,
      expected_cadence_h INTEGER, module TEXT, budget_ms INTEGER, max_items INTEGER,
      requires_container INTEGER
    );
    CREATE TABLE remediation_verifications (
      id INTEGER PRIMARY KEY, issue_id INTEGER, class TEXT, pass INTEGER, observed TEXT,
      expected TEXT, verified_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE issue_lifecycle (
      id INTEGER PRIMARY KEY, issue_id INTEGER, event TEXT, from_status TEXT, to_status TEXT,
      has_evidence INTEGER, ts TEXT
    );
    CREATE TABLE analytics_metric_triggers (id INTEGER PRIMARY KEY, metric_key TEXT, enabled INTEGER);
    CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, target TEXT);
    CREATE TABLE goals (id INTEGER PRIMARY KEY, goal_key TEXT);
    CREATE TABLE failure_modes (
      fm_key TEXT PRIMARY KEY, failure_mode TEXT NOT NULL, root_cause TEXT NOT NULL,
      remediation TEXT NOT NULL, detector TEXT NOT NULL, probe_class TEXT, first_seen TEXT NOT NULL,
      issue_id INTEGER
    );
    CREATE TABLE decision_log (
      id INTEGER PRIMARY KEY, actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT,
      blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT,
      reach_gain TEXT, surfaces_tested TEXT
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
    CREATE TRIGGER issue_lifecycle_au
    AFTER UPDATE OF status ON agent_issues
    WHEN OLD.status <> NEW.status
    BEGIN
      INSERT INTO issue_lifecycle (issue_id, event, from_status, to_status, has_evidence, ts)
      SELECT NEW.id, CASE WHEN NEW.status = 'open' THEN 'reopened' ELSE 'dispositioned' END,
             OLD.status, NEW.status,
             CASE WHEN EXISTS (SELECT 1 FROM issue_triage WHERE issue_id = NEW.id AND close_evidence IS NOT NULL) THEN 1 ELSE 0 END,
             strftime('%Y-%m-%dT%H:%M:%SZ', 'now');
    END;
  `);
  db.exec(reopenTrigger);
  db.exec(`
    INSERT INTO agent_issues VALUES
      (1875, 'METRIC-TRIGGER-405-OUTREACH-REPLY-RATE-30D', '', 'open', 'critical', NULL, 0);
    INSERT INTO issue_triage (issue_id, rc, triage_state, owner, close_evidence)
      VALUES (1875, 'metric:405', 'triaged', 'qnfo-cloud-ops', NULL);
    INSERT INTO remediation_contracts
      (class, issue_id, status, last_verdict, verify_probe, verify_transport, attempts,
       last_attempt_at, next_due_at, max_attempts)
      VALUES
      ('issue-1875', 1875, 'monitoring', 'monitoring:metric-condition', 'SELECT 1', 'd1-query', 373, '2026-11-02', '2026-11-03', 3),
      ('metric-relapse-1875', 1875, 'active', 'fail', 'SELECT 0', 'd1-query', 14, '2026-11-02', '2026-11-03', 3);
    INSERT INTO analytics_metric_triggers VALUES (405, 'outreach_reply_rate_30d', ${triggerEnabled});
    INSERT INTO metric_registry VALUES
      ('outreach_reply_rate_30d', '${ownerOutcomeMarker ? '[owner-outcome: not autonomically closable, IL-OWNER-OUTCOME-1]' : '>= 2'}');
    ${goalPresent ? "INSERT INTO goals VALUES (74, 'OWNER-OUTCOME-REACH-1');" : ""}
  `);
  return db;
}

const issue = (db) => db.prepare("SELECT status, close_channel FROM agent_issues WHERE id = 1875").get();
const triage = (db) => db.prepare("SELECT rc, triage_state, owner, close_evidence FROM issue_triage WHERE issue_id = 1875").get();
const contractRows = (db) => db.prepare("SELECT class, status, last_verdict FROM remediation_contracts WHERE issue_id = 1875 ORDER BY class").all();

{
  const db = setup();
  db.exec(migration);
  assert.equal(issue(db).status, "closed");
  assert.equal(issue(db).close_channel, "auto:triage-sync:qnfo-fleet-control");
  assert.equal(triage(db).triage_state, "closed");
  assert.match(triage(db).close_evidence, /^SUPERSEDED BY goals:OWNER-OUTCOME-REACH-1 \(goal 74\):/);
  assert.match(triage(db).close_evidence, /trigger 405 is intentionally disabled/);
  assert.deepEqual(contractRows(db).map(({ status, last_verdict }) => [status, last_verdict]), [
    ["superseded", "superseded:OWNER-OUTCOME-RELAPSE-SUPERSEDE-1 by goal 74"],
    ["superseded", "superseded:OWNER-OUTCOME-RELAPSE-SUPERSEDE-1 by goal 74"],
  ]);
  assert.equal(db.prepare("SELECT enabled FROM analytics_metric_triggers WHERE id = 405").get().enabled, 0);
  assert.equal(db.prepare("SELECT target FROM metric_registry WHERE metric = 'outreach_reply_rate_30d'").get().target,
    "[owner-outcome: not autonomically closable, IL-OWNER-OUTCOME-1]");
  assert.deepEqual({ ...db.prepare("SELECT event, from_status, to_status, has_evidence FROM issue_lifecycle WHERE issue_id = 1875").get() },
    { event: "dispositioned", from_status: "open", to_status: "closed", has_evidence: 1 });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM failure_modes WHERE fm_key = 'owner-outcome-relapse-contract-1875'").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 1);

  const detector = db.prepare("SELECT verify_probe FROM remediation_contracts WHERE class = 'fm-owner-outcome-relapse-contract-1875'").get().verify_probe;
  assert.deepEqual({ ...db.prepare(detector).get() }, { expected: "0", observed: "0" });

  for (let i = 0; i < 3; i++) {
    db.prepare(`
      INSERT INTO remediation_verifications (issue_id, class, pass, observed, expected, verified_at)
      VALUES (1875, 'metric-relapse-1875', 0, 'outreach_reply_rate_30d remains below target', '0', datetime('now', '+' || ? || ' minutes'))
    `).run(i);
  }
  assert.equal(issue(db).status, "closed", "historical metric failures cannot reopen a superseded owner-outcome issue");

  const snapshot = () => JSON.stringify({
    issue: issue(db),
    triage: triage(db),
    contracts: contractRows(db),
    failureModes: db.prepare("SELECT fm_key FROM failure_modes").all(),
    decisions: db.prepare("SELECT action FROM decision_log").all(),
  });
  const before = snapshot();
  db.exec(migration);
  assert.equal(snapshot(), before, "reapplying the migration is idempotent");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 1);

  db.exec(rollback);
  assert.equal(issue(db).status, "open", "rollback restores the original issue status");
  assert.equal(issue(db).close_channel, null);
  assert.deepEqual({ ...triage(db) }, {
    rc: "metric:405", triage_state: "triaged", owner: "qnfo-cloud-ops", close_evidence: null,
  });
  assert.deepEqual(contractRows(db).map(({ status, last_verdict }) => [status, last_verdict]), [
    ["monitoring", "monitoring:metric-condition"],
    ["active", "fail"],
  ]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 1, "decision history remains append-only");
  db.close();
}

for (const options of [{ triggerEnabled: 1 }, { ownerOutcomeMarker: false }, { goalPresent: false }]) {
  const db = setup(options);
  const before = JSON.stringify({ issue: issue(db), triage: triage(db), contracts: contractRows(db) });
  db.exec(migration);
  assert.equal(JSON.stringify({ issue: issue(db), triage: triage(db), contracts: contractRows(db) }), before,
    "without the exact owner-outcome evidence the issue and contracts stay untouched");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM failure_modes").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 0);
  db.close();
}

console.log("owner-outcome-relapse-1875: all passed");
