import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./2026-11-03-paper-provenance-probe-transport.sql", import.meta.url), "utf8");
const rollback = migration.match(/^-- Rollback: (.+)$/m)?.[1];
const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE remediation_contracts (
    class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT,
    verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER, escalate_to TEXT,
    expected_cadence_h INTEGER, status TEXT, module TEXT, last_verdict TEXT,
    attempts INTEGER, deferred_since TEXT, next_due_at TEXT
  );
  CREATE TABLE failure_modes (
    fm_key TEXT PRIMARY KEY, failure_mode TEXT, root_cause TEXT, remediation TEXT,
    detector TEXT, probe_class TEXT, first_seen TEXT, issue_id INTEGER
  );
`);
const probe = `SELECT '1.00' AS expected, printf('%.2f', avg(CASE WHEN b.metadata LIKE '%"seed"%' AND b.metadata LIKE '%"trace_id"%' AND b.metadata LIKE '%"novelty"%' THEN 1.0 ELSE 0.0 END)) AS observed FROM papers p JOIN paper_change_ledger l ON l.slug = p.slug AND l.kind = 'insert' JOIN paper_change_bodies b ON b.seq = l.seq WHERE p.first_published_at >= date('now','-7 day')`;
const seed = db.prepare(`INSERT INTO remediation_contracts
  (class, issue_id, verify_probe, verify_transport, status, last_verdict, attempts, deferred_since, next_due_at)
  VALUES (?, ?, ?, ?, ?, 'probe-error', 4, '2026-11-02', '2099-01-01')`);
seed.run("issue-1000641", 1000641, probe, "d1-query", "active");
seed.run("unrelated", 1, "SELECT 1", "d1-query", "active");
const row = (cls) => ({ ...db.prepare("SELECT * FROM remediation_contracts WHERE class = ?").get(cls) });
const unrelated = row("unrelated");
assert.throws(() => db.prepare(probe).get(), /no such table: papers/, "reproduce the audit database error");

db.exec(migration);
const corrected = row("issue-1000641");
assert.equal(corrected.verify_transport, "d1-query@living-paper");
assert.equal(corrected.verify_probe, probe, "preserve the outcome predicate");
assert.equal(corrected.issue_id, 1000641);
assert.equal(corrected.status, "active");
assert.equal(corrected.last_verdict, null);
assert.equal(corrected.attempts, 0);
assert.equal(corrected.deferred_since, null);
assert.match(corrected.next_due_at, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
assert.deepEqual(row("unrelated"), unrelated);
db.exec(migration);
assert.deepEqual(row("issue-1000641"), corrected, "replay does not reset a correctly routed contract");
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM failure_modes").get().n, 1);

const papers = new DatabaseSync(":memory:");
papers.exec(`
  CREATE TABLE papers (slug TEXT, first_published_at TEXT);
  CREATE TABLE paper_change_ledger (slug TEXT, kind TEXT, seq INTEGER);
  CREATE TABLE paper_change_bodies (seq INTEGER, metadata TEXT);
  INSERT INTO papers VALUES ('paper', date('now'));
  INSERT INTO paper_change_ledger VALUES ('paper', 'insert', 1);
  INSERT INTO paper_change_bodies VALUES (1, '{"seed":1,"trace_id":"trace","novelty":1}');
`);
assert.deepEqual({ ...papers.prepare(corrected.verify_probe).get() }, { expected: "1.00", observed: "1.00" });
papers.exec("UPDATE paper_change_bodies SET metadata = '{}'");
assert.deepEqual({ ...papers.prepare(corrected.verify_probe).get() }, { expected: "1.00", observed: "0.00" }, "missing provenance still fails");

const detector = row("fm-paper-provenance-probe-transport").verify_probe;
assert.deepEqual({ ...db.prepare(detector).get() }, { expected: "0", observed: "0" });
assert.ok(rollback);
db.exec(rollback);
assert.equal(row("issue-1000641").verify_transport, "d1-query");
assert.deepEqual({ ...db.prepare(detector).get() }, { expected: "0", observed: "1" }, "recurrence is detected");
db.prepare("UPDATE remediation_contracts SET status = 'superseded' WHERE class = 'issue-1000641'").run();
const superseded = row("issue-1000641");
db.exec(migration);
assert.deepEqual(row("issue-1000641"), superseded, "do not reactivate terminal contracts");
db.prepare("DELETE FROM remediation_contracts WHERE class = 'issue-1000641'").run();
assert.deepEqual({ ...db.prepare(detector).get() }, { expected: "0", observed: "1" }, "missing contract is not healthy");
papers.close();
db.close();
console.log("paper provenance probe transport: ok");
