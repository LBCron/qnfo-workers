import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

// CRON-FIRE-LOG-TASK-INDEX-1: the per-task MAX(fired_epoch_ms) probe is an index seek after the migration.
const migration = readFileSync(new URL("./2026-11-04-cron-fire-log-task-index.sql", import.meta.url), "utf8");
assert.match(migration, /^-- APPLY-BY: ci$/m);
assert.match(migration, /^-- DB: qnfo-audit$/m);
assert.match(migration, /^-- Rollback: /m);
const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE cron_fire_log (id INTEGER PRIMARY KEY, cron_name TEXT, task_id TEXT, source TEXT, fired_epoch_ms INTEGER, outcome TEXT, note TEXT);"
  + "CREATE INDEX idx_cron_fire_log_name_ms ON cron_fire_log (cron_name, fired_epoch_ms); CREATE INDEX idx_cron_fire_log_source_ms ON cron_fire_log (source, fired_epoch_ms);");
const add = db.prepare("INSERT INTO cron_fire_log (cron_name, task_id, source, fired_epoch_ms) VALUES (?, ?, ?, ?)");
db.exec("BEGIN"); for (let i = 0; i < 5000; i++) add.run("c" + (i % 50), "t" + (i % 50), "worker:x", 1000 + i); db.exec("COMMIT");
const sql = "SELECT MAX(l.fired_epoch_ms) AS m FROM cron_fire_log l WHERE l.task_id = 't7'";
const plan = () => db.prepare("EXPLAIN QUERY PLAN " + sql).all().map((r) => r.detail).join(" | ");
const before = db.prepare(sql).get().m;
console.log("before plan:", plan()); assert.doesNotMatch(plan(), /idx_cron_fire_log_task_ms/, "before: no task index");
db.exec(migration);
assert.match(plan(), /SEARCH l USING COVERING INDEX idx_cron_fire_log_task_ms/, "after: index seek");
assert.equal(db.prepare(sql).get().m, before, "same answer");
db.exec(migration); // idempotent
console.log("cron-fire-log-task-index: ok");
