-- FLEET-RUNS-OPEN-INDEX-1 (2026-11-04, charter pillar core; D1 overload family D1-OVERLOAD-1, program QNFO.INFRA): the orphaned-run sweep scans fleet_runs.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DROP INDEX IF EXISTS idx_fleet_runs_status_started;
-- CAUSE-MAPPED: registers no metric_registry row (one additive index).
-- spof-review: one additive index, no new worker, cron, credential or executor.
--
-- Measured 2026-11-04 19:00-21:00Z on qnfo-audit (Cloudflare GraphQL d1QueriesAdaptiveGroups, last 2 h, ordered by query time):
--   UPDATE fleet_runs SET status = 'failed', finished_at = ?1, error = 'orphaned: invocation ended before the run finished (CRON-ADVANCE-FIRST-1)'
--     WHERE status IN ('running','queued') AND started_at < ?2
--   157 calls, 9.2 M rows read (58 K rows a call: the whole table), 52 s of database time in 2 h, which is about 110 M rows a day.
-- EXPLAIN QUERY PLAN of the same predicate on the live database: "SCAN fleet_runs". The table has 69 K rows and two indexes, both led by task_id
-- (idx_fleet_runs_task_status, idx_fleet_runs_task_cron), so a predicate on status alone cannot use either.
-- Fix: an additive index (status, started_at). The two open states are a few rows, so the sweep reads only those and the started_at bound is a range
-- inside each status. No statement text changes. Cost: one more index entry per fleet_runs insert (about 1,000 a day).
-- Prediction: rows read by the sweep fall from 58 K to under 100 a call (-99 percent, about -110 M rows a day) and its 52 s per 2 h to under 1 s.
-- Verify: re-run the same d1QueriesAdaptiveGroups query 24 h after the apply and read the row for the UPDATE; revert with the Rollback line if the
-- statement still reads more than 1,000 rows a call.

CREATE INDEX IF NOT EXISTS idx_fleet_runs_status_started ON fleet_runs (status, started_at);
