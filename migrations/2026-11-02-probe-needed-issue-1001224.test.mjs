import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./2026-11-02-probe-needed-issue-1001224.sql", import.meta.url), "utf8");
const rollback = migration.match(/^-- Rollback: (.+)$/m)?.[1];
const rowId = "rem-d7554b7e-e87f-4615-80d6-921ba3b57f7a";

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, status TEXT);
    CREATE TABLE research_queue (id TEXT PRIMARY KEY, status TEXT, stage TEXT, recover_count INTEGER, error TEXT);
    CREATE TABLE remediation_contracts (
      class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT NOT NULL, action TEXT NOT NULL,
      verify_probe TEXT NOT NULL, verify_transport TEXT NOT NULL, max_attempts INTEGER NOT NULL DEFAULT 3,
      escalate_to TEXT NOT NULL, expected_cadence_h INTEGER, status TEXT DEFAULT 'active',
      ts TEXT DEFAULT (datetime('now')), last_attempt_at TEXT, last_verdict TEXT, module TEXT,
      budget_ms INTEGER DEFAULT 45000, next_due_at TEXT, max_items INTEGER DEFAULT 5,
      requires_container INTEGER DEFAULT 0, attempts INTEGER DEFAULT 0, deferred_since TEXT
    );
    CREATE TABLE decision_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, assumption TEXT, action TEXT, evidence TEXT,
      outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT,
      reach_gain TEXT, surfaces_tested TEXT
    );
  `);
  return db;
}

function seed(db, { status = "open", contract = true, contractStatus = "superseded" } = {}) {
  db.prepare("INSERT INTO agent_issues VALUES (1001224, ?)").run(status);
  db.prepare("INSERT INTO research_queue VALUES (?, 'wontfix', 'parked', 3, ?)").run(
    rowId,
    "PARKED-POISON-1: recover_count exhausted (3); last error: ground: bibliography 4 < 5 entries with full text (gate-refcount cannot pass); fulltext_dropped=6"
  );
  if (contract) {
    db.prepare(`
      INSERT INTO remediation_contracts
        (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts,
         escalate_to, expected_cadence_h, status, ts, last_attempt_at, last_verdict, module,
         budget_ms, next_due_at, max_items, requires_container, attempts, deferred_since)
      VALUES ('issue-1001224', 1001224, 'old precondition', 'old action', 'old probe', 'd1-query',
        3, 'qnfo-research-exec', 1, ?, '2026-11-01 17:20:00', '2026-11-01 17:21:00',
        'superseded:probe-unusable', 'probe-template-v3-generic', 45000, '2026-11-01 17:20:00',
        5, 0, 7, '2026-11-01 17:20:00')
    `).run(contractStatus);
  }
}

assert.ok(rollback, "migration has a rollback line");
const db = database();
seed(db);
db.exec(migration.replace(/^--.*$/gm, ""));

const updated = db.prepare("SELECT * FROM remediation_contracts WHERE class = 'issue-1001224'").get();
assert.equal(updated.status, "active");
assert.equal(updated.verify_transport, "d1-query");
assert.equal(updated.last_verdict, null);
assert.equal(updated.attempts, 0);
assert.equal(updated.deferred_since, null);
assert.match(updated.next_due_at, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
assert.equal(updated.max_attempts, 3, "the existing retry policy is preserved");
assert.doesNotMatch(updated.verify_probe, /agent_issues|1001224/, "the probe never reads issue status");
assert.doesNotMatch(updated.verify_probe, /;\s*\S/, "the probe is a single query");

const probeResult = () => ({ ...db.prepare(updated.verify_probe).get() });
assert.deepEqual(probeResult(), { expected: "0", observed: "1" }, "the active terminal defect is visible");
db.prepare("UPDATE research_queue SET status = 'queued', stage = 'ground' WHERE id = ?").run(rowId);
assert.deepEqual(probeResult(), { expected: "0", observed: "0" }, "the probe passes after the named failure leaves terminal state");
db.prepare("DELETE FROM research_queue WHERE id = ?").run(rowId);
assert.deepEqual(probeResult(), { expected: "0", observed: "1" }, "missing queue evidence fails closed");

assert.equal(db.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 1);
db.exec(migration.replace(/^--.*$/gm, ""));
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 1, "migration replay is idempotent");

db.exec(rollback);
const restored = db.prepare("SELECT * FROM remediation_contracts WHERE class = 'issue-1001224'").get();
assert.equal(restored.status, "superseded");
assert.equal(restored.verify_transport, "d1-query");
assert.equal(restored.verify_probe, "old probe");
assert.equal(restored.last_verdict, "superseded:probe-unusable");
assert.equal(restored.attempts, 7);
assert.equal(restored.deferred_since, "2026-11-01 17:20:00");
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 1, "decision ledger remains append-only");

const missing = database();
seed(missing, { contract: false });
missing.exec(migration.replace(/^--.*$/gm, ""));
assert.equal(missing.prepare("SELECT status FROM remediation_contracts WHERE class = 'issue-1001224'").get().status, "active");
missing.exec(rollback);
assert.equal(missing.prepare("SELECT COUNT(*) AS n FROM remediation_contracts").get().n, 0, "rollback removes a migration-created contract");

for (const options of [{ status: "closed" }, { contractStatus: "active" }]) {
  const untouched = database();
  seed(untouched, options);
  const before = untouched.prepare("SELECT * FROM remediation_contracts").get();
  untouched.exec(migration.replace(/^--.*$/gm, ""));
  assert.deepEqual(untouched.prepare("SELECT * FROM remediation_contracts").get(), before, JSON.stringify(options));
  assert.equal(untouched.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 0, JSON.stringify(options));
}

console.log("probe-needed-issue-1001224: all assertions passed");
