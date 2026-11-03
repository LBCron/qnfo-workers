import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const migrationPath = new URL("./2026-11-01-invest-decision-duplicate.sql", import.meta.url);
const reopenPath = new URL("./2026-10-19-relapse-window-close-event.sql", import.meta.url);
const migration = readFileSync(migrationPath, "utf8");
const reopenMigration = readFileSync(reopenPath, "utf8");
const rollback = migration.match(/^-- Rollback: (.*)$/m)?.[1];
const reopenTrigger = reopenMigration.match(/^CREATE TRIGGER remediation_reopen_on_relapse_d1[\s\S]*?^END;/m)?.[0];

assert.ok(rollback);
assert.ok(reopenTrigger);
assert.match(migration, /^-- APPLY-BY: ci$/m);
assert.match(migration, /^-- DB: qnfo-audit$/m);
assert.match(migration, /^-- BACKUP: bak_20261101_invest_decision_duplicate$/m);

const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE agent_issues (
    id INTEGER PRIMARY KEY, title TEXT, description TEXT, status TEXT, close_channel TEXT, updated_at INTEGER
  );
  CREATE TABLE issue_triage (
    issue_id INTEGER PRIMARY KEY, triage_state TEXT, close_evidence TEXT, reopened_count INTEGER, owner TEXT
  );
  CREATE TABLE remediation_contracts (
    class TEXT PRIMARY KEY, issue_id INTEGER, status TEXT, last_verdict TEXT, max_attempts INTEGER,
    precondition TEXT NOT NULL DEFAULT '', action TEXT NOT NULL DEFAULT '', verify_probe TEXT NOT NULL DEFAULT '',
    verify_transport TEXT NOT NULL DEFAULT '', escalate_to TEXT NOT NULL DEFAULT '', expected_cadence_h INTEGER DEFAULT 1,
    module TEXT, budget_ms INTEGER DEFAULT 45000, max_items INTEGER DEFAULT 5, requires_container INTEGER DEFAULT 0
  );
  CREATE TABLE failure_modes (
    fm_key TEXT PRIMARY KEY, failure_mode TEXT NOT NULL, root_cause TEXT NOT NULL, remediation TEXT NOT NULL,
    detector TEXT NOT NULL, probe_class TEXT, first_seen TEXT NOT NULL, issue_id INTEGER,
    trigger_condition TEXT, symptom TEXT, blast_radius TEXT
  );
  CREATE TABLE remediation_verifications (
    class TEXT, pass INTEGER, observed TEXT, verified_at TEXT, expected TEXT
  );
  CREATE TABLE issue_lifecycle (issue_id INTEGER, event TEXT, to_status TEXT, ts TEXT);
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

for (const sql of [reopenTrigger]) db.exec(sql);
db.exec(`
  INSERT INTO agent_issues VALUES
    (2124, 'METRIC-TRIGGER-11-INVEST-DECISION-LEVEL: Investment verdict is scale back or stop', '', 'open', NULL, 0),
    (1836, 'INVEST-DECISION-1: investment verdict', '', 'open', NULL, 0),
    (2444, 'METRIC-TEST: unrelated active relapse', '', 'closed', NULL, 0);
  INSERT INTO issue_triage VALUES
    (2124, 'triaged', NULL, 1, 'qnfo-fleet-control'),
    (1836, 'triaged', NULL, 0, 'qnfo-fleet-dashboard'),
    (2444, 'closed', 'fixed after verification', 0, 'qnfo-fleet-control');
  INSERT INTO remediation_contracts (class, issue_id, status, last_verdict, max_attempts) VALUES
    ('metric-relapse-2124', 2124, 'active', 'fail', 3),
    ('issue-1836', 1836, 'active', NULL, 3),
    ('metric-relapse-2444', 2444, 'active', NULL, 3);
`);

db.exec(migration);
const issue = () => db.prepare("SELECT status, close_channel FROM agent_issues WHERE id = 2124").get();
const disposition = () => db.prepare("SELECT triage_state, close_evidence FROM issue_triage WHERE issue_id = 2124").get();
const contract = () => db.prepare("SELECT status, last_verdict FROM remediation_contracts WHERE class = 'metric-relapse-2124'").get();

assert.equal(issue().status, "closed", "closing via triage synchronizes the duplicate issue");
assert.match(issue().close_channel, /^auto:triage-sync:/);
assert.equal(disposition().triage_state, "closed");
assert.match(disposition().close_evidence, /^superseded by agent_issues 1836/);
assert.equal(contract().status, "superseded");
assert.equal(db.prepare("SELECT status FROM remediation_contracts WHERE class = 'issue-1836'").get().status, "active");
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM failure_modes WHERE fm_key = 'migration-close-before-contract-retire'").get().n, 1);
assert.equal(db.prepare("SELECT verify_transport FROM remediation_contracts WHERE class = 'fm-migration-close-before-contract-retire'").get().verify_transport, "d1-query");

const fail = db.prepare(`
  INSERT INTO remediation_verifications (class, pass, observed, verified_at, expected)
  VALUES (?, 0, 'SCALE_BACK still holds', datetime('now'), 'ok')
`);
db.prepare("UPDATE remediation_contracts SET status = 'active' WHERE class = 'metric-relapse-2124'").run();
for (let i = 0; i < 3; i++) fail.run("metric-relapse-2124");
assert.equal(issue().status, "closed", "explicit superseded evidence blocks the relapse trigger");
db.prepare("UPDATE remediation_contracts SET status = 'superseded' WHERE class = 'metric-relapse-2124'").run();

for (let i = 0; i < 3; i++) fail.run("metric-relapse-2444");
assert.equal(db.prepare("SELECT status FROM agent_issues WHERE id = 2444").get().status, "open",
  "an unrelated active contract still reopens after max_attempts failures");

const snapshot = () => JSON.stringify({
  issue: db.prepare("SELECT status, close_channel, updated_at FROM agent_issues WHERE id = 2124").get(),
  triage: disposition(),
  contract: contract(),
  backup: db.prepare("SELECT issue_id, issue_status, triage_state, close_evidence, contract_class, contract_status FROM bak_20261101_invest_decision_duplicate ORDER BY contract_class").all(),
  decisions: db.prepare("SELECT action FROM decision_log").all(),
});
const firstApply = snapshot();
db.exec(migration);
assert.equal(snapshot(), firstApply, "reapplying the migration is idempotent");

db.exec(rollback);
assert.equal(db.prepare("SELECT status, close_channel FROM agent_issues WHERE id = 2124").get().status, "open",
  "rollback restores the duplicate issue's prior status");
assert.equal(db.prepare("SELECT close_channel FROM agent_issues WHERE id = 2124").get().close_channel, null);
assert.equal(db.prepare("SELECT triage_state, close_evidence FROM issue_triage WHERE issue_id = 2124").get().triage_state, "triaged");
assert.equal(db.prepare("SELECT status, last_verdict FROM remediation_contracts WHERE class = 'metric-relapse-2124'").get().status, "active");
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 1, "decision_log remains append-only");

db.close();
console.log("invest-decision-duplicate: all passed");
