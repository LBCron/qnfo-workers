import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const migration = readFileSync(new URL("./2026-11-02-probe-needed-issue-1001220.sql", import.meta.url), "utf8");
const rollback = migration.match(/^-- Rollback: (.+)$/m)?.[1];
assert.ok(rollback, "migration has a rollback line");

const probe = "SELECT '1' AS expected, CAST((SELECT COUNT(*) FROM agent_issues root WHERE root.id = 1001220 AND root.title = 'ROOT-CAUSE-1: METRIC-UNMEASURED-1 keeps recurring' AND root.created_at < (CAST(strftime('%s', 'now') AS INTEGER) - 86400) * 1000 AND NOT EXISTS (SELECT 1 FROM issue_lifecycle l JOIN agent_issues family_issue ON family_issue.id = l.issue_id WHERE l.event IN ('opened', 'reopened') AND l.ts >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-24 hours') AND family_issue.title LIKE 'METRIC-UNMEASURED-1:%')) AS TEXT) AS observed";

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, status TEXT, created_at INTEGER);
    CREATE TABLE issue_lifecycle (id INTEGER PRIMARY KEY, issue_id INTEGER, event TEXT, ts TEXT);
    CREATE TABLE remediation_contracts (
      class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT NOT NULL, action TEXT NOT NULL,
      verify_probe TEXT NOT NULL, verify_transport TEXT NOT NULL, max_attempts INTEGER NOT NULL DEFAULT 3,
      escalate_to TEXT NOT NULL, expected_cadence_h INTEGER, status TEXT DEFAULT 'active',
      ts TEXT DEFAULT (datetime('now')), last_attempt_at TEXT, last_verdict TEXT, module TEXT,
      budget_ms INTEGER DEFAULT 45000, next_due_at TEXT, max_items INTEGER DEFAULT 5,
      requires_container INTEGER DEFAULT 0, attempts INTEGER DEFAULT 0, deferred_since TEXT
    );
    CREATE TABLE decision_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT NOT NULL, assumption TEXT NOT NULL,
      action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL,
      rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT
    );
  `);
  return db;
}

function seed(db, { status = "open", contract = true, contractStatus = "probe-review-refused" } = {}) {
  db.prepare("INSERT INTO agent_issues VALUES (1001220, 'ROOT-CAUSE-1: METRIC-UNMEASURED-1 keeps recurring', ?, 0)").run(status);
  db.prepare("INSERT INTO agent_issues VALUES (1001199, 'METRIC-UNMEASURED-1: qnfo-ai-search has metrics with no value', 'open', 0)").run();
  db.prepare("INSERT INTO issue_lifecycle VALUES (1, 1001199, 'opened', strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-1 hour'))").run();
  if (contract) {
    db.prepare(`
      INSERT INTO remediation_contracts
        (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts,
         escalate_to, expected_cadence_h, status, ts, last_attempt_at, last_verdict, module,
         next_due_at, attempts, deferred_since)
      VALUES ('issue-1001220', 1001220, 'old precondition', 'old action', 'old probe', 'd1-query',
        3, 'qnfo-fleet-control', 1, ?, '2026-11-01 17:20:00', '2026-11-01 17:21:00',
        'probe-review-refused', 'probe-template-v3-generic', '2026-11-01 17:20:00', 7, '2026-11-01 17:20:00')
    `).run(contractStatus);
  }
}

function runProbe(db, text) {
  return db.prepare(text).get();
}

const db = database();
seed(db);
db.exec(migration.replace(/^--.*$/gm, ""));

const contract = db.prepare("SELECT * FROM remediation_contracts WHERE class = 'issue-1001220'").get();
assert.equal(contract.status, "holding");
assert.equal(contract.verify_transport, "d1-query");
assert.equal(contract.verify_probe, probe);
assert.equal(contract.last_verdict, "holding:external-closer:management-personas.rc-close");
assert.equal(contract.attempts, 0);
assert.equal(contract.deferred_since, null);
assert.match(contract.next_due_at, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
assert.ok(!/\bstatus\b/i.test(contract.verify_probe), "the probe never reads issue status");
assert.deepEqual({ ...runProbe(db, contract.verify_probe) }, { expected: "1", observed: "0" }, "recent family activity prevents a pass");

db.prepare("UPDATE issue_lifecycle SET ts = strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-25 hours') WHERE id = 1").run();
assert.deepEqual({ ...runProbe(db, contract.verify_probe) }, { expected: "1", observed: "1" }, "family quietness is measured from lifecycle events");
db.prepare("UPDATE agent_issues SET status = 'closed' WHERE id = 1001220").run();
assert.deepEqual({ ...runProbe(db, contract.verify_probe) }, { expected: "1", observed: "1" }, "probe result does not depend on issue 1001220 status");

db.exec(migration.replace(/^--.*$/gm, ""));
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 1, "migration replay does not duplicate the decision");

db.exec(rollback);
const restored = db.prepare("SELECT * FROM remediation_contracts WHERE class = 'issue-1001220'").get();
assert.equal(restored.status, "probe-review-refused");
assert.equal(restored.verify_transport, "d1-query");
assert.equal(restored.verify_probe, "old probe");
assert.equal(restored.last_verdict, "probe-review-refused");
assert.equal(restored.attempts, 7);
assert.equal(restored.deferred_since, "2026-11-01 17:20:00");
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 1, "decision history remains append-only");

const missing = database();
seed(missing, { contract: false });
missing.exec(migration.replace(/^--.*$/gm, ""));
assert.equal(missing.prepare("SELECT status FROM remediation_contracts WHERE class = 'issue-1001220'").get().status, "holding");
missing.exec(rollback);
assert.equal(missing.prepare("SELECT COUNT(*) AS n FROM remediation_contracts").get().n, 0, "rollback removes a migration-created contract");

for (const options of [
  { status: "closed" },
  { contractStatus: "active" },
  { contractStatus: "monitoring" },
]) {
  const untouched = database();
  seed(untouched, options);
  const before = untouched.prepare("SELECT * FROM remediation_contracts").get();
  untouched.exec(migration.replace(/^--.*$/gm, ""));
  assert.deepEqual(untouched.prepare("SELECT * FROM remediation_contracts").get(), before, JSON.stringify(options));
  assert.equal(untouched.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 0, JSON.stringify(options));
}

console.log("probe-needed-issue-1001220: all assertions passed");
