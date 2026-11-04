-- CRON-FAULTS-JOIN-ORDER-1 (2026-11-04, charter pillar cost; D1 overload family D1-OVERLOAD-1).
-- Measured 2026-11-04 20:40Z (GraphQL d1QueriesAdaptiveGroups, 40 min): the cron_fault_seen refresh (INSERT OR REPLACE ... SELECT FROM v_cron_faults) is the top statement of
-- qnfo-audit by D1 time: 27 calls, 98.9 M rows read, 114 s of the single-threaded DB (3.7 M rows and 4.2 s a call). CRON-FAULTS-TASK-SCAN-1 (the file before this one) made the
-- first branch cheap, but the join to the newest run per task was still planned with fleet_runs f as the OUTER loop: "SEARCH f USING INDEX idx_fleet_runs_status_started
-- (status=? AND started_at>?)" then "SCAN r" for every failed run of the last 24 hours (about 62,000 failed cron-watch runs x the 59-row r) = 3,690,411 rows.
-- Fix: CROSS JOIN pins the order (r outer, f by primary key). Same predicate, same columns, same rows; measured on the live DB with the same SELECT: 3,690,411 -> 10,100 rows read (-99.7 %).
-- Prediction: cron_fault_seen refresh and every v_cron_faults read go from about 3.7 M to about 0.03 M rows a call; about 100 M rows and 110 s of D1 time per 40 minutes freed (about 8 % of the DB).
-- Verify: SELECT COUNT(*) FROM v_cron_faults_task (D1 meta rows_read under 25,000) and the same GraphQL window.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261104_v_cron_faults_task_join
-- Rollback: DROP VIEW IF EXISTS v_cron_faults_task; then re-create it from bak_20261104_v_cron_faults_task_join (column sql holds the exact previous CREATE VIEW statement)
-- spof-review: one view redefined with the same columns and rows; v_cron_faults and the cron-watch workflow read it unchanged.

CREATE TABLE IF NOT EXISTS bak_20261104_v_cron_faults_task_join AS
SELECT name, type, sql FROM sqlite_master WHERE type = 'view' AND name = 'v_cron_faults_task';

DROP VIEW IF EXISTS v_cron_faults_task;
CREATE VIEW v_cron_faults_task AS
SELECT 'task-failed:' || f.task_id AS fault_key, 'task-failed' AS kind, 'fleet-exec:' || f.task_id AS worker, NULL AS worker_dir,
  'latest run failed at ' || COALESCE(f.started_at, '?') || ': ' || substr(COALESCE(f.error, ''), 1, 300) AS detail,
  (SELECT COUNT(*) FROM fleet_runs x WHERE x.task_id = f.task_id AND x.status = 'failed'
     AND x.id > COALESCE((SELECT MAX(y.id) FROM fleet_runs y WHERE y.task_id = f.task_id AND y.status = 'ok'), 0)) AS consecutive_fails
FROM (SELECT task_id, MAX(id) AS id FROM fleet_runs NOT INDEXED WHERE id > (SELECT MAX(id) FROM fleet_runs) - 5000 GROUP BY task_id) r
CROSS JOIN fleet_runs f ON f.id = r.id
WHERE f.status = 'failed' AND f.started_at >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-24 hours')
UNION ALL
SELECT 'task-overdue:' || c.name, 'task-overdue', 'fleet-exec:' || c.name, NULL,
  'next_fire ' || c.next_fire || ' is ' || c.overdue_min || ' min overdue', CAST(c.overdue_min / 5 AS INTEGER)
FROM v_cron_health c WHERE c.overdue_min > 10;

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:d1-hotspots-2', 'the planner drives the join from the selective-looking status/started_at index and rescans the 59-row group for each of 62,000 failed runs',
  'CRON-FAULTS-JOIN-ORDER-1: v_cron_faults_task joins with CROSS JOIN so the newest-run-per-task set is the outer loop',
  'GraphQL 40 min: cron_fault_seen refresh 27 calls, 98.9 M rows, 114 s; same SELECT with JOIN 3,690,411 rows, with CROSS JOIN 10,100 rows (2 result rows both)',
  'same fault rows, 99.7 % fewer rows read per v_cron_faults call', 'one view (old text in bak_20261104_v_cron_faults_task_join)',
  'the Rollback line', 'the cron-fault refresh stops being the top D1 statement',
  'v_cron_faults rows_read under 25 K per call, same GraphQL window', NULL, 'live SELECT before/after on qnfo-audit; plan test in migrations/cron-faults-task-join-order.test.mjs'
WHERE NOT EXISTS (SELECT 1 FROM decision_log d WHERE d.action LIKE 'CRON-FAULTS-JOIN-ORDER-1:%');
