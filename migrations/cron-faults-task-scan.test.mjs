import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

// CRON-FAULTS-TASK-SCAN-1: v_cron_faults_task returns the same faults and reads the newest fleet_runs ids by rowid range.
const migration = readFileSync(new URL("./2026-11-04-cron-faults-task-scan.sql", import.meta.url), "utf8");
assert.match(migration, /^-- APPLY-BY: ci$/m);
assert.match(migration, /^-- DB: qnfo-audit$/m);
assert.match(migration, /^-- BACKUP: bak_20261104_v_cron_faults_task$/m);
assert.match(migration, /^-- Rollback: /m);

const OLD_VIEW = `
CREATE VIEW v_cron_faults_task AS
SELECT 'task-failed:' || f.task_id AS fault_key, 'task-failed' AS kind, 'fleet-exec:' || f.task_id AS worker, NULL AS worker_dir,
  'latest run failed at ' || COALESCE(f.started_at, '?') || ': ' || substr(COALESCE(f.error, ''), 1, 300) AS detail,
  (SELECT COUNT(*) FROM fleet_runs x WHERE x.task_id = f.task_id AND x.status = 'failed'
     AND x.id > COALESCE((SELECT MAX(y.id) FROM fleet_runs y WHERE y.task_id = f.task_id AND y.status = 'ok'), 0)) AS consecutive_fails
FROM (SELECT task_id, MAX(id) AS id FROM fleet_runs WHERE id > (SELECT MAX(id) FROM fleet_runs) - 5000 GROUP BY task_id) r
JOIN fleet_runs f ON f.id = r.id
WHERE f.status = 'failed' AND f.started_at >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-24 hours')
UNION ALL
SELECT 'task-overdue:' || c.name, 'task-overdue', 'fleet-exec:' || c.name, NULL,
  'next_fire ' || c.next_fire || ' is ' || c.overdue_min || ' min overdue', CAST(c.overdue_min / 5 AS INTEGER)
FROM v_cron_health c WHERE c.overdue_min > 10;`;

// One clock for both databases: the fault detail carries started_at, so two builds a second apart (a slow CI runner) would differ in text, not in logic.
const T0 = Date.now();

function build() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE fleet_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, cron_name TEXT, status TEXT, started_at TEXT, error TEXT);
    CREATE INDEX idx_fleet_runs_task_status ON fleet_runs (task_id, status, id);
    CREATE INDEX idx_fleet_runs_task_cron ON fleet_runs (task_id, cron_name, id);
    CREATE TABLE fleet_crons (name TEXT, cron_expr TEXT, enabled INTEGER, last_fired TEXT, next_fire TEXT);
    CREATE VIEW v_cron_health AS SELECT name, cron_expr, enabled, last_fired, next_fire,
      ROUND((julianday('now') - julianday(next_fire)) * 1440, 1) AS overdue_min FROM fleet_crons WHERE enabled = 1;
    CREATE TABLE decision_log (actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT,
      predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
  `);
  db.exec(OLD_VIEW);
  const iso = (minAgo) => new Date(T0 - minAgo * 60000).toISOString().replace(/\.\d+Z$/, "Z");
  const add = db.prepare("INSERT INTO fleet_runs (task_id, cron_name, status, started_at, error) VALUES (?, ?, ?, ?, ?)");
  db.exec("BEGIN");
  // 30,000 old runs of 60 tasks (the table the planner would scan), all ok.
  for (let i = 0; i < 30000; i++) add.run("task" + (i % 60), "c" + (i % 60), "ok", iso(3000 + (30000 - i)), null);
  // The newest 5,000 ids: mostly ok; three tasks fail now, one failed long ago, one has no ok run at all, one failed inside the window but is older than 24 h.
  for (let i = 0; i < 4990; i++) add.run("task" + (i % 60), "c" + (i % 60), "ok", iso(60 - i / 100), null);
  add.run("task1", "c1", "failed", iso(5), "boom one");
  add.run("task2", "c2", "failed", iso(4), "boom two");
  add.run("task2", "c2", "failed", iso(3), "boom two again");
  add.run("noOk", "cn", "failed", iso(2), "never succeeded");
  add.run("noOk", "cn", "failed", iso(1), "never succeeded again");
  add.run("oldFail", "co", "failed", iso(60 * 30), "failed 30 h ago");
  db.exec("COMMIT");
  db.prepare("INSERT INTO fleet_crons VALUES ('late-cron', '*/10 * * * *', 1, NULL, ?)").run(iso(45));
  db.prepare("INSERT INTO fleet_crons VALUES ('fine-cron', '*/10 * * * *', 1, NULL, ?)").run(new Date(T0 + 5 * 60000).toISOString());
  return db;
}
const rows = (db) => JSON.stringify(db.prepare("SELECT fault_key, kind, worker, detail, consecutive_fails FROM v_cron_faults_task ORDER BY fault_key").all());
const plan = (db) => db.prepare("EXPLAIN QUERY PLAN SELECT * FROM v_cron_faults_task").all().map((r) => r.detail).join(" | ");

const before = build();
const after = build();
const beforeRows = rows(before);
const parsed = JSON.parse(beforeRows);
assert.deepEqual(parsed.map((r) => r.fault_key), ["task-failed:noOk", "task-failed:task1", "task-failed:task2", "task-overdue:late-cron"], "fixture: three failing tasks and one overdue cron");
assert.match(plan(before), /SCAN fleet_runs USING COVERING INDEX idx_fleet_runs_task_cron/, "before: the whole covering index is scanned for the newest 5,000 ids");

after.exec(migration);
assert.equal(after.prepare("SELECT COUNT(*) AS n FROM bak_20261104_v_cron_faults_task").get().n, 1, "the old definition is backed up");
assert.equal(rows(after), beforeRows, "same faults, same detail, same consecutive_fails");
assert.match(plan(after), /SEARCH fleet_runs USING INTEGER PRIMARY KEY \(rowid>\?\)/, "after: the rowid range is used: " + plan(after));
assert.doesNotMatch(plan(after), /SCAN fleet_runs USING COVERING INDEX idx_fleet_runs_task_cron/);

after.exec(migration);
assert.equal(after.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 1, "replay is idempotent");
assert.equal(rows(after), beforeRows);
before.close(); after.close();
console.log("cron-faults-task-scan: all passed");
