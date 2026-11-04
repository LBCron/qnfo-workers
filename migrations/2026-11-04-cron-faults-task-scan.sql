-- CRON-FAULTS-TASK-SCAN-1 (2026-11-04, charter pillar cost; D1 overload family D1-OVERLOAD-1).
-- Measured 2026-11-04 16:44Z (D1 GraphQL d1QueriesAdaptiveGroups, 55 min, after the fleet_tick fan-out fix left the tick off the top-16 list): the probes that read
-- v_cron_faults (fm-... worker-silent:qnfo-research-exec 56 calls, :qnfo-subscribers 27, :qnfo-code-orchestrator 21, cron_fault_seen refresh 30 and its select 12)
-- read 79-93 K rows a call, about 12 M rows in 55 minutes (about 100 reads an hour, about 300 M rows a day at that rate).
-- Cause (EXPLAIN QUERY PLAN and per-view rows_read): v_cron_faults_task alone reads 65,124 rows a call. Its first branch groups the newest 5,000 fleet_runs ids by task,
--   SELECT task_id, MAX(id) FROM fleet_runs WHERE id > (SELECT MAX(id) FROM fleet_runs) - 5000 GROUP BY task_id
-- and the planner walks the whole covering index idx_fleet_runs_task_cron (task_id, cron_name, id), 68,699 entries, to avoid sorting for GROUP BY, filtering id on every entry
-- ("SCAN fleet_runs USING COVERING INDEX idx_fleet_runs_task_cron"). With NOT INDEXED the rowid range on the primary key still applies, so the same rows are found by
-- "SEARCH fleet_runs USING INTEGER PRIMARY KEY (rowid>?)": 5,000 rows and a temp b-tree for the group.
-- Same result: the filter, the group and the join are unchanged, only the access path (verified by the plan test on a fixture, same rows before and after).
-- Prediction: v_cron_faults 79 K -> about 19 K rows a call (the worker branch's cron_fire_log read, 24 K, is left alone), -75 %; about 220 M rows a day fewer
-- from these probes; v_cron_faults_task alone 65 K -> about 6 K rows. Verify with SELECT COUNT(*) FROM v_cron_faults_task (D1 meta rows_read) and the same GraphQL window.
-- Not changed: how often those probes run (about 100 reads an hour; the issue contracts that read v_cron_faults are due every 20-60 minutes, so a further source runs the fm-style
-- worker-silent probes more often and was not identified); this file only makes each read cheaper.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261104_v_cron_faults_task
-- Rollback: DROP VIEW IF EXISTS v_cron_faults_task; then re-create it from bak_20261104_v_cron_faults_task (column sql holds the exact previous CREATE VIEW statement)
-- spof-review: one view redefined with the same columns and rows; v_cron_faults and the cron-watch workflow read it unchanged.

CREATE TABLE IF NOT EXISTS bak_20261104_v_cron_faults_task AS
SELECT name, type, sql FROM sqlite_master WHERE type = 'view' AND name = 'v_cron_faults_task';

DROP VIEW IF EXISTS v_cron_faults_task;
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
FROM v_cron_health c WHERE c.overdue_min > 10;

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:fleet-tick-fanout', 'a GROUP BY over the newest 5,000 rows should read 5,000 rows, not the whole index that happens to be ordered by the group key',
  'CRON-FAULTS-TASK-SCAN-1: v_cron_faults_task reads the newest 5,000 fleet_runs ids through the rowid range (NOT INDEXED) instead of scanning idx_fleet_runs_task_cron',
  'GraphQL 55 min: v_cron_faults probes about 12 M rows (79-93 K a call, 56 + 27 + 21 + 30 + 12 calls); per-view rows_read: v_cron_faults_task 65,124, v_cron_faults_worker 24,207, v_cron_activity 886, v_cron_schedule 973, v_cron_health 60; plan: SCAN fleet_runs USING COVERING INDEX idx_fleet_runs_task_cron',
  'same fault rows, about 75 % fewer rows read per v_cron_faults call', 'one view (old text in bak_20261104_v_cron_faults_task)',
  'the Rollback line', 'the cron-fault probes cost a quarter of their rows',
  'v_cron_faults rows_read under 25 K per call and the fm worker-silent probes under 3 M rows an hour, same GraphQL window', NULL, 'SQLite plan and equivalence test in migrations/cron-faults-task-scan.test.mjs'
WHERE NOT EXISTS (SELECT 1 FROM decision_log d WHERE d.action LIKE 'CRON-FAULTS-TASK-SCAN-1:%');
