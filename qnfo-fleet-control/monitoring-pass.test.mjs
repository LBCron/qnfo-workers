import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const migration = readFileSync(new URL("../migrations/2026-11-03-monitoring-pass-autoclose.sql", import.meta.url), "utf8");
const trigger = (name) => {
  const match = migration.match(new RegExp(`CREATE TRIGGER ${name}[\\s\\S]*?END;`));
  assert.ok(match, `${name} definition exists`);
  assert.match(match[0], /COALESCE\(NEW\.verifier, ''\) NOT LIKE 'qnfo-fleet-control\/monitoring-pass@%'/);
  return match[0];
};

const db = new DatabaseSync(":memory:");
db.exec(`CREATE TABLE remediation_verifications (
    id INTEGER PRIMARY KEY,
    issue_id INTEGER,
    class TEXT,
    transport TEXT,
    verified_at TEXT,
    observed TEXT,
    pass INTEGER,
    verifier TEXT
  );
  CREATE TABLE remediation_contracts (
    class TEXT,
    issue_id INTEGER,
    status TEXT,
    action TEXT,
    last_verdict TEXT
  );
  CREATE TABLE agent_issues (
    id INTEGER PRIMARY KEY,
    title TEXT,
    status TEXT,
    close_channel TEXT,
    updated_at INTEGER
  );
  CREATE TABLE analytics_metric_triggers (id INTEGER, enabled INTEGER);
  CREATE VIEW v_metric_trigger_state AS SELECT id, 0 AS hit FROM analytics_metric_triggers;
  CREATE TABLE issue_triage (
    issue_id INTEGER PRIMARY KEY,
    rc TEXT,
    triage_state TEXT,
    owner TEXT,
    sla_due_at TEXT,
    close_evidence TEXT,
    reopened_count INTEGER DEFAULT 0
  );`);
db.exec(trigger("remediation_verification_autoclose_ins"));
db.exec(trigger("remediation_verification_autoclose_upd"));
db.exec(`INSERT INTO agent_issues (id, title, status) VALUES
  (1, 'monitoring insert', 'open'),
  (2, 'ordinary insert', 'open'),
  (3, 'monitoring update', 'open'),
  (4, 'ordinary update', 'open');`);

const add = db.prepare("INSERT INTO remediation_verifications (issue_id, class, transport, pass, verifier) VALUES (?, ?, 'd1-query', ?, ?)");
add.run(1, "monitor-1", 1, "qnfo-fleet-control/monitoring-pass@0.62.0");
assert.equal(db.prepare("SELECT status FROM agent_issues WHERE id = 1").get().status, "open");
add.run(2, "ordinary-2", 1, "qnfo-fleet-control/remediation-tick@0.62.0");
assert.equal(db.prepare("SELECT status FROM agent_issues WHERE id = 2").get().status, "closed");
add.run(3, "monitor-3", 0, "qnfo-fleet-control/monitoring-pass@0.62.0");
db.prepare("UPDATE remediation_verifications SET pass = 1 WHERE issue_id = 3").run();
assert.equal(db.prepare("SELECT status FROM agent_issues WHERE id = 3").get().status, "open");
add.run(4, "ordinary-4", 0, "qnfo-fleet-control/remediation-tick@0.62.0");
db.prepare("UPDATE remediation_verifications SET pass = 1 WHERE issue_id = 4").run();
assert.equal(db.prepare("SELECT status FROM agent_issues WHERE id = 4").get().status, "closed");

console.log("monitoring-pass autoclose isolation: 4 checks, 0 failure(s)");
