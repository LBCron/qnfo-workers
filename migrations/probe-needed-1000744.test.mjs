import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const migration = readFileSync(new URL("./2026-11-03-probe-needed-1000744.sql", import.meta.url), "utf8");
const rollback = /^-- Rollback: (.*)$/m.exec(migration)[1];
const body = migration.split("\n").filter((line) => !line.startsWith("--")).join("\n");

function build() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, status TEXT);
    CREATE TABLE remediation_contracts (
      class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT,
      verify_transport TEXT, max_attempts INTEGER, escalate_to TEXT, expected_cadence_h INTEGER,
      status TEXT, module TEXT, attempts INTEGER, last_verdict TEXT, deferred_since TEXT,
      last_attempt_at TEXT, next_due_at TEXT
    );
    CREATE TABLE remediation_verifications (
      id INTEGER PRIMARY KEY, class TEXT, verified_at TEXT, verifier TEXT
    );
    INSERT INTO agent_issues VALUES (1000744, 'open'), (42, 'open'), (43, 'open');
  `);
  return db;
}

const db = build();
db.prepare(`INSERT INTO remediation_contracts
  (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts,
   escalate_to, expected_cadence_h, status, module, attempts, last_verdict,
   deferred_since, last_attempt_at, next_due_at)
  VALUES ('issue-1000744', 1000744, 'old', 'old', 'SELECT ''pending'' AS expected, ''pending'' AS observed',
   'd1-query', 3, 'qnfo-fleet-control', 1, 'superseded', 'old', 7, 'superseded',
   'old', 'old', '2000-01-01')`).run();

db.exec(body);
const target = () => db.prepare("SELECT * FROM remediation_contracts WHERE class = 'issue-1000744'").get();
assert.equal(target().status, "active");
assert.equal(target().verify_transport, "d1-query");
assert.equal(target().last_verdict, null);
assert.equal(target().attempts, 0);
assert.equal(target().deferred_since, null);
assert.equal(target().last_attempt_at, null);
assert.ok(Date.parse(target().next_due_at) > Date.now() - 60_000);
assert.match(target().verify_probe, /monitoring-pass@%/);
assert.match(target().verify_probe, /-55 minutes/);
assert.match(target().verify_probe, /a\.id <> 1000744/);
assert.doesNotMatch(target().verify_probe, /a\.id\s*=\s*1000744/);

const probe = () => db.prepare(target().verify_probe).get();
db.prepare(`INSERT INTO remediation_contracts
  (class, issue_id, verify_transport, status)
  VALUES ('issue-42', 42, 'd1-query', 'monitoring')`).run();
const pending = probe();
assert.equal(pending.expected, "0");
assert.match(pending.observed, /^1$/);

db.prepare(`INSERT INTO remediation_verifications (class, verified_at, verifier)
  VALUES ('issue-42', datetime('now'), 'qnfo-fleet-control/monitoring-pass@0.62.0')`).run();
assert.equal(probe().observed, "0");

db.prepare("UPDATE remediation_contracts SET status = 'monitoring' WHERE class = 'issue-1000744'").run();
assert.equal(probe().observed, "0");
db.prepare("UPDATE agent_issues SET status = 'closed' WHERE id = 1000744").run();
assert.equal(probe().observed, "0");
db.prepare("UPDATE agent_issues SET status = 'open' WHERE id = 1000744").run();
assert.equal(probe().observed, "0");

db.prepare(`INSERT INTO remediation_contracts (class, issue_id, verify_transport, status)
  VALUES ('issue-43', 43, 'd1-query', 'monitoring')`).run();
assert.equal(probe().observed, "1");
db.prepare(`INSERT INTO remediation_verifications (class, verified_at, verifier)
  VALUES ('issue-43', datetime('now', '-56 minutes'), 'qnfo-fleet-control/monitoring-pass@0.62.0')`).run();
assert.equal(probe().observed, "1");

db.exec(body);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM remediation_contracts WHERE class = 'issue-1000744'").get().n, 1);
db.exec(rollback);
assert.equal(target().status, "superseded");
assert.equal(target().verify_probe, "SELECT 'pending' AS expected, 'pending' AS observed");

const missing = build();
missing.exec(body);
assert.equal(missing.prepare("SELECT status FROM remediation_contracts WHERE class = 'issue-1000744'").get().status, "active");
missing.exec(rollback);
assert.equal(missing.prepare("SELECT COUNT(*) AS n FROM remediation_contracts WHERE class = 'issue-1000744'").get().n, 0);

const closed = build();
closed.prepare("UPDATE agent_issues SET status = 'closed' WHERE id = 1000744").run();
closed.exec(body);
assert.equal(closed.prepare("SELECT COUNT(*) AS n FROM remediation_contracts WHERE class = 'issue-1000744'").get().n, 0);

console.log("issue-1000744 probe repair checks passed");
