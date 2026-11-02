import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("./2026-11-02-park-stale-deferral-100629.sql", import.meta.url), "utf8");
const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, status TEXT);
  CREATE TABLE remediation_contracts (
    class TEXT PRIMARY KEY, issue_id INTEGER, status TEXT, deferred_since TEXT,
    next_due_at TEXT, last_verdict TEXT, verify_probe TEXT
  );
  CREATE TABLE decision_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, assumption TEXT, action TEXT,
    evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT,
    capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT
  );
  INSERT INTO agent_issues VALUES (100629, 'closed'), (100700, 'open');
  INSERT INTO remediation_contracts VALUES
    ('issue-100629', 100629, 'active', '2026-10-25 17:31:03', '2026-11-02 18:00:00', 'deferred', 'SELECT COUNT(*) FROM research_queue WHERE status=''queued'''),
    ('issue-100700', 100700, 'active', '2026-10-25 17:31:03', '2026-11-02 18:00:00', 'deferred', 'SELECT 1');
  CREATE TABLE research_queue (status TEXT);
  INSERT INTO research_queue VALUES ('queued'), ('queued');
  CREATE VIEW v_remediation_evidence_all AS
    SELECT class, observed, verified_at FROM (SELECT NULL AS class, NULL AS observed, NULL AS verified_at) WHERE 0;
`);

const closeoutProbe = `SELECT 'cleared' AS expected, CASE WHEN EXISTS (
  SELECT 1 FROM remediation_contracts c
  WHERE c.class = 'issue-100629' AND c.status = 'active' AND c.deferred_since IS NOT NULL
    AND (c.last_verdict LIKE 'deferred%' OR (
      c.last_verdict = 'fail' AND lower(trim(COALESCE((
        SELECT e.observed FROM v_remediation_evidence_all e
        WHERE e.class = c.class ORDER BY e.verified_at DESC LIMIT 1
      ), ''))) LIKE 'pending%'
    ))
) THEN 'pending: contract issue-100629 still defers' ELSE 'cleared' END AS observed`;

const header = sql.split("\n").filter((line) => line.startsWith("--"));
assert.ok(header.includes("-- APPLY-BY: ci") && header.includes("-- DB: qnfo-audit"));
assert.equal(header.filter((line) => line.startsWith("-- Rollback:")).length, 1);
assert.ok(header.some((line) => line.startsWith("-- BACKUP:")));
assert.equal(db.prepare(closeoutProbe).get().observed, "pending: contract issue-100629 still defers");

db.exec(sql);
const target = () => db.prepare("SELECT status, deferred_since, next_due_at FROM remediation_contracts WHERE class = 'issue-100629'").get();
assert.deepEqual({ ...target() }, { status: "parked", deferred_since: null, next_due_at: null });
assert.deepEqual({ ...db.prepare("SELECT status, deferred_since FROM remediation_contracts WHERE class = 'issue-100700'").get() }, {
  status: "active",
  deferred_since: "2026-10-25 17:31:03"
});
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM research_queue WHERE status='queued'").get().n, 2);
assert.equal(db.prepare(closeoutProbe).get().observed, "cleared");
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM decision_log WHERE action LIKE 'VERIFICATION-DEFERRED-7D-1 park stale issue-100629%'").get().n, 1);

db.exec(sql);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM decision_log WHERE action LIKE 'VERIFICATION-DEFERRED-7D-1 park stale issue-100629%'").get().n, 1);

const rollback = sql.match(/^-- Rollback: (.+)$/m)?.[1];
assert.ok(rollback);
db.exec(rollback);
assert.deepEqual({ ...target() }, {
  status: "active",
  deferred_since: "2026-10-25 17:31:03",
  next_due_at: "2026-11-02 18:00:00"
});
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM decision_log WHERE action LIKE 'VERIFICATION-DEFERRED-7D-1 park stale issue-100629%'").get().n, 1);

db.prepare("UPDATE agent_issues SET status = 'open' WHERE id = 100629").run();
db.exec(sql);
assert.deepEqual({ ...target() }, {
  status: "active",
  deferred_since: "2026-10-25 17:31:03",
  next_due_at: "2026-11-02 18:00:00"
});
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM bak_20261102_park_stale_deferral_100629").get().n, 0);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM decision_log WHERE action LIKE 'VERIFICATION-DEFERRED-7D-1 park stale issue-100629%'").get().n, 1);

console.log("verification-deferral-park-100629: passed");
