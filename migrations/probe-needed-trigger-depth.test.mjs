import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./2026-11-02-probe-needed-trigger-depth.sql", import.meta.url), "utf8");
const rollback = migration.match(/^-- Rollback: (.*)$/m)?.[1];
const probe = "SELECT 'ok' AS expected, COALESCE((SELECT observed FROM remediation_verifications WHERE class = 'fm-trigger-depth-compile' AND verifier = 'trigger-depth-sweep' AND datetime(verified_at) >= datetime('now', '-60 minutes') ORDER BY id DESC LIMIT 1), 'pending:no recent trigger-depth sweep') AS observed";
assert.ok(rollback);
assert.match(migration, /^-- APPLY-BY: ci$/m);
assert.match(migration, /^-- DB: qnfo-audit$/m);
assert.match(migration, /^-- BACKUP: bak_20261102_probe_needed_trigger_depth$/m);

function setup({ contract = true, issueStatus = "open" } = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, status TEXT);
    CREATE TABLE remediation_verifications (
      id INTEGER PRIMARY KEY, class TEXT, verifier TEXT, verified_at TEXT, expected TEXT, observed TEXT, pass INTEGER
    );
    CREATE TABLE remediation_contracts (
      class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT,
      max_attempts INTEGER, escalate_to TEXT, expected_cadence_h INTEGER, status TEXT, module TEXT, attempts INTEGER,
      deferred_since TEXT, next_due_at TEXT, last_verdict TEXT
    );
    CREATE TABLE decision_log (
      actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT,
      capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT
    );
    INSERT INTO agent_issues VALUES (1001212, '${issueStatus}');
  `);
  if (contract) {
    db.exec(`INSERT INTO remediation_contracts
      (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to,
       expected_cadence_h, status, module, attempts, deferred_since, next_due_at, last_verdict)
      VALUES ('issue-1001212', 1001212, 'old precondition', 'old action', 'old probe', 'd1-query',
       3, 'qnfo-fleet-control', 1, 'superseded', 'old module', 7, '2026-11-01', '2000-01-01', 'superseded:old')`);
  }
  return db;
}

function getContract(db) {
  return db.prepare("SELECT * FROM remediation_contracts WHERE class = 'issue-1001212'").get();
}

const db = setup();
db.exec(migration);
const active = getContract(db);
assert.equal(active.status, "active");
assert.equal(active.verify_transport, "d1-query");
assert.equal(active.last_verdict, null);
assert.equal(active.attempts, 0);
assert.equal(active.deferred_since, null);
assert.equal(db.prepare("SELECT datetime(?) <= datetime('now') AS due").get(active.next_due_at).due, 1);
assert.equal(active.verify_probe, probe);
assert.doesNotMatch(active.verify_probe, /agent_issues|issue_triage|remediation_contracts/);

const runProbe = () => db.prepare(active.verify_probe).get();
db.exec(`INSERT INTO remediation_verifications VALUES (1, 'fm-trigger-depth-compile', 'trigger-depth-sweep',
  datetime('now', '-2 hours'), 'ok', 'ok', 1)`);
assert.equal(runProbe().observed, "pending:no recent trigger-depth sweep", "stale successful sweeps cannot pass");
db.exec(`INSERT INTO remediation_verifications VALUES (2, 'fm-trigger-depth-compile', 'trigger-depth-sweep',
  datetime('now'), 'ok', 'nested-too-deep:1tables:agent_issues', 0)`);
assert.deepEqual({ ...runProbe() }, { expected: "ok", observed: "nested-too-deep:1tables:agent_issues" });
db.exec(`INSERT INTO remediation_verifications VALUES (3, 'fm-trigger-depth-compile', 'trigger-depth-sweep',
  datetime('now'), 'ok', 'ok', 1)`);
assert.deepEqual({ ...runProbe() }, { expected: "ok", observed: "ok" });

db.exec(migration);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 1, "decision logging is idempotent");
db.exec(rollback);
const restored = getContract(db);
assert.equal(restored.verify_probe, "old probe");
assert.equal(restored.status, "superseded");
assert.equal(restored.attempts, 7);
assert.equal(restored.deferred_since, "2026-11-01");
assert.equal(restored.next_due_at, "2000-01-01");
db.close();

const missing = setup({ contract: false });
missing.exec(migration);
assert.equal(getContract(missing).status, "active", "an absent contract is inserted for an open issue");
missing.exec(rollback);
assert.equal(getContract(missing), undefined, "rollback removes only the contract it introduced");
missing.close();

const closed = setup({ issueStatus: "closed" });
closed.exec(migration);
assert.equal(getContract(closed).status, "superseded", "a closed issue's contract is not rearmed");
assert.equal(closed.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 0, "a closed issue does not record a remediation decision");
closed.close();

console.log("probe-needed-trigger-depth: all passed");
