import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

// CRON-FAULTS-JOIN-ORDER-1: CROSS JOIN keeps the newest-run-per-task set as the outer loop; rows are unchanged.
const migration = readFileSync(new URL("./2026-11-04-cron-faults-task-join-order.sql", import.meta.url), "utf8");
assert.match(migration, /^-- APPLY-BY: ci$/m);
assert.match(migration, /^-- DB: qnfo-audit$/m);
assert.match(migration, /^-- BACKUP: bak_20261104_v_cron_faults_task_join$/m);
assert.match(migration, /^-- Rollback: /m);

const LIVE_VIEW = `
CREATE VIEW v_cron_faults_task AS
SELECT 'task-failed:' || f.task_id AS fault_key, 'task-failed' AS kind, 'fleet-exec:' || f.task_id AS worker, NULL AS worker_dir,
  'latest run failed at ' || COALESCE(f.started_at, '?') || ': ' || substr(COALESCE(f.error, ''), 1, 300) AS detail,
  (SELECT COUNT(*) FROM fleet_runs x WHERE x.task_id = f.task_id AND x.status = 'failed'
     AND x.id > COALESCE((SELECT MAX(y.id) FROM fleet_runs y WHERE y.task_id = f.task_id AND y.status = 'ok'), 0)) AS consecutive_fails
FROM (SELECT task_id, MAX(id) AS id FROM fleet_runs NOT INDEXED WHERE id > (SELECT MAX(id) FROM fleet_runs) - 5000 GROUP BY task_id) r
JOIN fleet_runs f ON f.id = r.id
WHERE f.status = 'failed' AND f.started_at >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-24 hours')
UNION ALL
SELECT 'task-overdue:' || c.name, 'task-overdue', 'fleet-exec:' || c.name, NULL,
  'next_fire ' || c.next_fire || ' is ' || c.overdue_min || ' min overdue', CAST(c.overdue_min / 5 AS INTEGER)
FROM v_cron_health c WHERE c.overdue_min > 10;`;

const T0 = Date.now();
function build() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE fleet_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, cron_name TEXT, status TEXT, started_at TEXT, error TEXT);
    CREATE INDEX idx_fleet_runs_task_status ON fleet_runs (task_id, status, id);
    CREATE INDEX idx_fleet_runs_task_cron ON fleet_runs (task_id, cron_name, id);
    CREATE INDEX idx_fleet_runs_status_started ON fleet_runs (status, started_at);
    CREATE TABLE fleet_crons (name TEXT, cron_expr TEXT, enabled INTEGER, last_fired TEXT, next_fire TEXT);
    CREATE VIEW v_cron_health AS SELECT name, cron_expr, enabled, last_fired, next_fire,
      ROUND((julianday('now') - julianday(next_fire)) * 1440, 1) AS overdue_min FROM fleet_crons WHERE enabled = 1;
    CREATE TABLE decision_log (actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT,
      predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
  `);
  db.exec(LIVE_VIEW);
  const iso = (minAgo) => new Date(T0 - minAgo * 60000).toISOString().replace(/\.\d+Z$/, "Z");
  const add = db.prepare("INSERT INTO fleet_runs (task_id, cron_name, status, started_at, error) VALUES (?, ?, ?, ?, ?)");
  db.exec("BEGIN");
  for (let i = 0; i < 6000; i++) add.run("task" + (i % 60), "c" + (i % 60), "ok", iso(3000 - i / 3), null);
  // thousands of failed runs inside 24 h for one task (the live cron-watch pattern), the latest one failed
  for (let i = 0; i < 3000; i++) add.run("flappy", "cf", "failed", iso(1000 - i / 4), "boom");
  add.run("task1", "c1", "failed", iso(2), "latest of task1");
  db.exec("COMMIT");
  return db;
}
const rows = (db) => JSON.stringify(db.prepare("SELECT fault_key, kind, worker, detail, consecutive_fails FROM v_cron_faults_task ORDER BY fault_key").all());
const plan = (db) => db.prepare("EXPLAIN QUERY PLAN SELECT * FROM v_cron_faults_task").all().map((r) => r.detail).join(" | ");

const before = build();
const after = build();
after.exec(migration);
assert.equal(rows(after), rows(before), "same faults before and after");
assert.ok(JSON.parse(rows(after)).length >= 2, "fixture yields faults");
assert.ok(plan(after).indexOf("SEARCH f") === -1 || plan(after).indexOf("idx_fleet_runs_status_started") === -1, "after: f is not driven by the status/started_at index");
assert.match(plan(after), /SEARCH f USING INTEGER PRIMARY KEY/, "after: f is read by primary key per newest run");
assert.equal(after.prepare("SELECT COUNT(*) n FROM decision_log WHERE action LIKE 'CRON-FAULTS-JOIN-ORDER-1:%'").get().n, 1);
console.log("cron-faults-task-join-order: ok");
