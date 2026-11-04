-- D1-OVERLOAD-1a (charter pillar autonomy): index for the dispatcher's per-cron "last run" lookup.
-- Measured 2026-11-04 14:00Z, qnfo-audit, 24 h: SELECT id FROM fleet_runs WHERE task_id = ?1 AND cron_name = ?2 ORDER BY id DESC LIMIT 1
-- (qnfo-code-orchestrator runTick) = 3,427 calls, 17M rows read, 234 s of D1 time; idx_fleet_runs_task_status covers task_id only.
-- PREDICTION: that statement drops below 0.5M rows read and 10 s of D1 time per day.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DROP INDEX IF EXISTS idx_fleet_runs_task_cron

CREATE INDEX IF NOT EXISTS idx_fleet_runs_task_cron ON fleet_runs (task_id, cron_name, id);
