import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./2026-11-02-probe-needed-issue-1000701.sql", import.meta.url), "utf8");
const rollback = migration.match(/^-- Rollback: (.+)$/m)?.[1];
const probe = "SELECT '2' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM papers WHERE slug IN ('a-unified-framework-for-superdeterminism-neurobiology-and-the-mechanics-of-human-meaning', 'simulation-inconsistency-detection-via-neurobiological-and-cognitive-interfaces') AND ltrim(body_md) LIKE '# %' AND instr(body_md, '## Abstract') > 0 AND body_md NOT LIKE '%TOPIC COMPLEXITY ASSESSMENT%' AND body_md NOT LIKE '%Here is the continuation of the detailed%'";

assert.ok(rollback, "migration has a rollback line");
assert.match(migration, /^-- APPLY-BY: ci$/m);
assert.match(migration, /^-- DB: qnfo-audit$/m);
assert.match(migration, /^-- BACKUP: bak_20261102_probe_needed_1000701$/m);

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, status TEXT);
    CREATE TABLE papers (slug TEXT PRIMARY KEY, body_md TEXT);
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

function seed(db, { status = "open", contract = true } = {}) {
  db.prepare("INSERT INTO agent_issues VALUES (1000701, ?)").run(status);
  db.prepare("INSERT INTO papers VALUES (?, ?)").run(
    "a-unified-framework-for-superdeterminism-neurobiology-and-the-mechanics-of-human-meaning",
    "# Title\n\n## Abstract\nReal paper content"
  );
  db.prepare("INSERT INTO papers VALUES (?, ?)").run(
    "simulation-inconsistency-detection-via-neurobiological-and-cognitive-interfaces",
    "# Title two\n\n## Abstract\nReal paper content"
  );
  if (contract) {
    db.prepare(`
      INSERT INTO remediation_contracts
        (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts,
         escalate_to, expected_cadence_h, status, ts, last_attempt_at, last_verdict, module,
         budget_ms, next_due_at, max_items, requires_container, attempts, deferred_since)
      VALUES ('issue-1000701', 1000701, 'old precondition', 'old action', 'old probe', 'd1-query',
        3, 'qnfo-fleet-control', 1, 'superseded', '2026-11-01 17:20:00', '2026-11-01 17:21:00',
        'superseded:old', 'probe-template-v3-generic', 45000, '2026-11-01 17:20:00',
        5, 0, 7, '2026-11-01 17:20:00')
    `).run();
  }
}

function runProbe(db, text) {
  return db.prepare(text).get();
}

const db = database();
seed(db);
db.exec(migration.replace(/^--.*$/gm, ""));

const updated = db.prepare("SELECT * FROM remediation_contracts WHERE class = 'issue-1000701'").get();
assert.equal(updated.status, "active");
assert.equal(updated.verify_transport, "d1-query@living-paper");
assert.equal(updated.verify_probe, probe);
assert.equal(updated.last_verdict, null);
assert.equal(updated.attempts, 0);
assert.equal(updated.deferred_since, null);
assert.match(updated.next_due_at, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
assert.ok(!/agent_issues|1000701/.test(updated.verify_probe), "probe measures paper content, not issue status");
assert.deepEqual({ ...runProbe(db, updated.verify_probe) }, { expected: "2", observed: "2" });

db.prepare("UPDATE remediation_contracts SET attempts = 2, last_verdict = 'fail', deferred_since = '2026-11-02 12:00:00' WHERE class = 'issue-1000701'").run();
const beforeReplay = db.prepare("SELECT * FROM remediation_contracts WHERE class = 'issue-1000701'").get();
db.exec(migration.replace(/^--.*$/gm, ""));
assert.deepEqual(db.prepare("SELECT * FROM remediation_contracts WHERE class = 'issue-1000701'").get(), beforeReplay, "replay preserves contract progress");
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 1, "migration replay does not duplicate the decision");

db.prepare("UPDATE papers SET body_md = ? WHERE slug = ?")
  .run("**TOPIC COMPLEXITY ASSESSMENT**\n## Abstract",
    "a-unified-framework-for-superdeterminism-neurobiology-and-the-mechanics-of-human-meaning");
assert.deepEqual({ ...runProbe(db, updated.verify_probe) }, { expected: "2", observed: "1" });
db.prepare("UPDATE papers SET body_md = ? WHERE slug = ?")
  .run("# Title\n\n## Abstract\nReal paper content",
    "a-unified-framework-for-superdeterminism-neurobiology-and-the-mechanics-of-human-meaning");
db.prepare("UPDATE agent_issues SET status = 'closed' WHERE id = 1000701").run();
assert.deepEqual({ ...runProbe(db, updated.verify_probe) }, { expected: "2", observed: "2" }, "probe result does not depend on issue status");

db.exec(rollback);
const restored = db.prepare("SELECT * FROM remediation_contracts WHERE class = 'issue-1000701'").get();
assert.equal(restored.status, "superseded");
assert.equal(restored.verify_transport, "d1-query");
assert.equal(restored.verify_probe, "old probe");
assert.equal(restored.last_verdict, "superseded:old");
assert.equal(restored.attempts, 7);
assert.equal(restored.deferred_since, "2026-11-01 17:20:00");

const missing = database();
seed(missing, { contract: false });
missing.exec(migration.replace(/^--.*$/gm, ""));
assert.equal(missing.prepare("SELECT status FROM remediation_contracts WHERE class = 'issue-1000701'").get().status, "active");
missing.exec(rollback);
assert.equal(missing.prepare("SELECT COUNT(*) AS n FROM remediation_contracts").get().n, 0, "rollback removes a migration-created contract");

const closed = database();
seed(closed, { status: "closed" });
closed.exec(migration.replace(/^--.*$/gm, ""));
assert.equal(closed.prepare("SELECT status FROM remediation_contracts WHERE class = 'issue-1000701'").get().status, "superseded");
assert.equal(closed.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 0, "closed issue is untouched");

console.log("probe-needed-issue-1000701: all assertions passed");
