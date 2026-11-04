import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

// CRON-FAULT-DUE-LIKE-1: the due view compares a title prefix without LIKE, and keeps the same rows for short and long worker names.
const migration = readFileSync(new URL("./2026-11-04-cron-fault-due-like-limit.sql", import.meta.url), "utf8");
assert.match(migration, /^-- APPLY-BY: ci$/m);
assert.match(migration, /^-- DB: qnfo-audit$/m);
assert.match(migration, /^-- BACKUP: bak_20261104_v_cron_fault_due$/m);
assert.match(migration, /^-- Rollback: /m);
assert.ok(!/CRON-HOURLY-FLOOR-1:' \|\| v_cron_fault_now\.worker \|\| ':%'/.test(migration.split("CREATE VIEW")[1]), "no LIKE pattern left in the new view");

const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE cron_fault_seen (fault_key TEXT, kind TEXT, worker TEXT, worker_dir TEXT, detail TEXT, consecutive_fails INTEGER, first_seen TEXT, last_seen TEXT, cleared_at TEXT);
  CREATE VIEW v_cron_fault_now AS SELECT fault_key, kind, worker, worker_dir, detail, consecutive_fails, first_seen, last_seen FROM cron_fault_seen WHERE cleared_at IS NULL AND fault_key <> '#run';
  CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, status TEXT, title TEXT);
  CREATE TABLE decision_log (actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
  CREATE VIEW v_cron_fault_due AS
  SELECT * FROM v_cron_fault_now
  WHERE first_seen <= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', CASE WHEN kind = 'schedule' THEN '-90 minutes' ELSE '-9 minutes' END)
    AND NOT (kind = 'schedule' AND EXISTS (SELECT 1 FROM agent_issues a WHERE a.status = 'open' AND a.title LIKE 'CRON-HOURLY-FLOOR-1:' || v_cron_fault_now.worker || ':%'));
`);
const long = "fleet-exec:management-personas-b-hourly";
const old = new Date(Date.now() - 3 * 3600e3).toISOString().replace(/\.\d+Z$/, "Z");
const ins = db.prepare("INSERT INTO cron_fault_seen VALUES (?, ?, ?, NULL, 'd', 0, ?, ?, NULL)");
ins.run("schedule:short|x", "schedule", "short-worker", old, old);
ins.run("schedule:long|y", "schedule", long, old, old);
ins.run("task-failed:t", "task-failed", "fleet-exec:t", old, old);
db.prepare("INSERT INTO agent_issues (status, title) VALUES ('open', ?)").run("CRON-HOURLY-FLOOR-1:short-worker:something");
db.prepare("INSERT INTO agent_issues (status, title) VALUES ('open', ?)").run("CRON-HOURLY-FLOOR-1:" + long + ":something");
// node:sqlite has no 50-byte LIKE limit, so the old view works here; D1 refuses it for the long name. Compare the rows both ways.
const keys = () => db.prepare("SELECT fault_key FROM v_cron_fault_due ORDER BY fault_key").all().map((r) => r.fault_key);
const before = keys();
db.exec(migration);
const after = keys();
assert.deepEqual(after, before, "same rows");
assert.deepEqual(after, ["task-failed:t"], "faults with an open floor issue are hidden, others stay");
assert.ok(!/ LIKE /.test(db.prepare("SELECT sql FROM sqlite_master WHERE name = 'v_cron_fault_due'").get().sql), "no LIKE in the stored view");
console.log("cron-fault-due-like-limit: ok");
