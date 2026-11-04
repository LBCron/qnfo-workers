// COMPANION-RETARGET-AT-READ-1: the issue-1001256 contract measures the read-step retarget on main, backs up the old probe, rolls back, and names text the worker really carries.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("./2026-11-05-probe-issue-1001256-companion-retarget.sql", import.meta.url), "utf8");
const rollback = sql.match(/^-- Rollback: (.+)$/m)?.[1];
assert.ok(rollback, "the migration carries a Rollback line");

function database(status = "open") {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, status TEXT);
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
  db.prepare("INSERT INTO agent_issues VALUES (1001256, ?)").run(status);
  db.prepare(`INSERT INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, escalate_to, status, last_verdict, attempts)
    VALUES ('issue-1001256', 1001256, 'old precondition', 'old action', 'SELECT 1 AS old_probe', 'd1-query', 'qnfo-fleet-control', 'active', 'fail', 90)`).run();
  return db;
}
const row = (db) => db.prepare("SELECT * FROM remediation_contracts WHERE class = 'issue-1001256'").get();

const db = database();
db.exec(sql);
let c = row(db);
assert.equal(c.verify_transport, "code-read");
const probe = JSON.parse(c.verify_probe);
assert.deepEqual(probe.paths, ["qnfo-code-orchestrator/worker.js"]);
assert.ok(c.attempts === 0 && c.last_verdict === null, "the contract starts a fresh verdict history");
assert.equal(db.prepare("SELECT verify_probe FROM bak_20261105_probe_1001256").get().verify_probe, "SELECT 1 AS old_probe", "the old probe is backed up first");
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM decision_log WHERE actor = 'qnfo-workers:COMPANION-RETARGET-AT-READ-1'").get().n, 1);

// Applying twice changes nothing more (the backup and the decision row are written once).
db.exec(sql);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM bak_20261105_probe_1001256").get().n, 1);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM decision_log WHERE actor = 'qnfo-workers:COMPANION-RETARGET-AT-READ-1'").get().n, 1);

// The probe text is in the worker the probe reads, and in its mirror.
for (const f of ["worker.js", "deployed-current.worker.js"]) {
  const text = readFileSync(new URL("../qnfo-code-orchestrator/" + f, import.meta.url), "utf8");
  assert.ok(text.includes(probe.contains), f + " carries the probe text");
}

// Rollback restores the old probe.
db.exec(rollback);
c = row(db);
assert.equal(c.verify_probe, "SELECT 1 AS old_probe");
assert.equal(c.verify_transport, "d1-query");

// A closed issue's contract is left alone.
const closed = database("closed");
closed.exec(sql);
assert.equal(row(closed).verify_probe, "SELECT 1 AS old_probe", "a closed issue keeps its contract");

console.log("probe-issue-1001256-companion-retarget: ok");
