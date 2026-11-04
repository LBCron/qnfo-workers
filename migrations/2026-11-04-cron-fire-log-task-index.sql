-- CRON-FIRE-LOG-TASK-INDEX-1 (2026-11-04, charter pillar cost; D1 overload family D1-OVERLOAD-1).
-- Measured 20:55Z (GraphQL d1QueriesAdaptiveGroups, 20 min): the liveness probe of contract issue-1001611 (and its siblings that use the same template,
--   (SELECT MAX(l.fired_epoch_ms) FROM cron_fire_log l WHERE l.task_id = c.task_id) )
-- ran 30 times and read 3,822,270 rows (127,409 a call, two full scans of the 63,723-row cron_fire_log), 10 s of D1 time. cron_fire_log has indexes on (cron_name, fired_epoch_ms)
-- and (source, fired_epoch_ms) only, so a filter on task_id is a table scan.
-- Change: one covering index (task_id, fired_epoch_ms); MAX(fired_epoch_ms) per task becomes a single index seek.
-- Prediction: those probes 127 K -> under 10 rows a call (about 3.8 M rows and 10 s per 20 minutes freed); one more index entry per cron_fire_log insert.
-- Verify: the same GraphQL window shows no WITH t AS (SELECT c.name ... cron_fire_log l WHERE l.task_id ...) statement above 50 K rows.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DROP INDEX IF EXISTS idx_cron_fire_log_task_ms;
-- spof-review: additive index; no view, trigger or query text changes.

CREATE INDEX IF NOT EXISTS idx_cron_fire_log_task_ms ON cron_fire_log (task_id, fired_epoch_ms);
