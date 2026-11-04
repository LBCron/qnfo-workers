import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

// CRON-FAULT-DUE-CASE-1: a floor issue titled in another case still suppresses the schedule fault, as the old LIKE did.
const migration = readFileSync(new URL("./2026-11-04-cron-fault-due-case.sql", import.meta.url), "utf8");
assert.match(migration, /^-- APPLY-BY: ci$/m);
assert.match(migration, /^-- DB: qnfo-audit$/m);
assert.match(migration, /^-- BACKUP: bak_20261104_v_cron_fault_due_case$/m);
assert.match(migration, /^-- Rollback: /m);
const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE cron_fault_seen (fault_key TEXT, kind TEXT, worker TEXT, worker_dir TEXT, detail TEXT, consecutive_fails INTEGER, first_seen TEXT, last_seen TEXT, cleared_at TEXT);
  CREATE VIEW v_cron_fault_now AS SELECT fault_key, kind, worker, worker_dir, detail, consecutive_fails, first_seen, last_seen FROM cron_fault_seen WHERE cleared_at IS NULL AND fault_key <> '#run';
  CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, status TEXT, title TEXT);
`);
const old = new Date(Date.now() - 3 * 3600e3).toISOString().replace(/\.\d+Z$/, "Z");
const ins = db.prepare("INSERT INTO cron_fault_seen VALUES (?, 'schedule', ?, NULL, 'd', 0, ?, ?, NULL)");
ins.run("k1", "worker-a", old, old);
ins.run("k2", "fleet-exec:management-personas-b-hourly", old, old);
ins.run("k3", "worker-c", old, old);
db.prepare("INSERT INTO agent_issues (status, title) VALUES ('open', ?)").run("cron-hourly-floor-1:worker-a:lower case title");
db.prepare("INSERT INTO agent_issues (status, title) VALUES ('open', ?)").run("CRON-HOURLY-FLOOR-1:fleet-exec:management-personas-b-hourly:x");
db.exec(migration);
assert.deepEqual(db.prepare("SELECT worker FROM v_cron_fault_due ORDER BY worker").all().map((r) => r.worker), ["worker-c"], "case-insensitive and long-name matches both suppress; unmatched stays");
db.exec(migration);
console.log("cron-fault-due-case: ok");
