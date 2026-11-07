-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM metric_breach_cause WHERE cause_key = 'research-deferred-drain'; DELETE FROM analytics_metric_triggers WHERE metric_key IN ('research_deferred_pool_size', 'research_legacy_parked_count'); DELETE FROM metric_registry WHERE metric IN ('research_deferred_pool_size', 'research_legacy_parked_count'); DROP VIEW IF EXISTS v_research_deferred_analysis;
-- BACKUP: metric_registry
-- Fix for failed migration 2026-11-07-research-pipeline-drain-deferred-pool.sql
-- Original used 'metric_key' column for metric_registry but table uses 'metric'
-- This corrective migration uses correct column names for each table

-- Clean up partial state from failed migration (view succeeded before INSERT failed)
DROP VIEW IF EXISTS v_research_deferred_analysis;

-- Create analysis view for deferred pool (statement 1 - this succeeded before)
CREATE VIEW v_research_deferred_analysis AS
SELECT 
  COUNT(*) as total_deferred,
  COUNT(CASE WHEN recover_count >= 2 THEN 1 END) as terminal_recovery,
  MIN(created_at) as oldest_created
FROM research_queue
WHERE status = 'deferred';

-- Metric 1: Deferred pool size (FIXED: use 'metric' not 'metric_key')
INSERT INTO metric_registry (
  metric,
  metric_name,
  query,
  target_value,
  comparison,
  state,
  created_at,
  updated_at
) VALUES (
  'research_deferred_pool_size',
  'Research Deferred Pool Size',
  'SELECT COUNT(*) as value FROM research_queue WHERE status = ''deferred''',
  100,
  '<',
  'active',
  datetime('now'),
  datetime('now')
);

INSERT INTO analytics_metric_triggers (
  metric_key,
  threshold,
  direction,
  severity,
  action,
  owner,
  auto_create_issue,
  created_at
) VALUES (
  'research_deferred_pool_size',
  100,
  'above',
  'high',
  'Deferred research pool exceeds threshold. Items with status=''deferred'' never automatically return to ''queued''.

The code loop should implement drain logic in claimErrataFair or add a new function:
- SELECT oldest N items WHERE status=''deferred'' ORDER BY queued_at
- UPDATE research_queue SET status=''queued'', recover_count=0 WHERE id IN (...)
- Batch size: min(50, current_pool_size - 50) to drain toward target

code-task: repo=qnfo-workers path=qnfo-research-exec/worker.js
code-anchor: async function claimErrataFair(env, nowMs) {',
  'code-loop',
  1,
  datetime('now')
);

-- Metric 2: Legacy parked count (monitor cleanup progress)
INSERT INTO metric_registry (
  metric,
  metric_name,
  query,
  target_value,
  comparison,
  state,
  created_at,
  updated_at
) VALUES (
  'research_legacy_parked_count',
  'Research Legacy Parked Items',
  'SELECT COUNT(*) as value FROM research_queue WHERE stage = ''parked''',
  0,
  '=',
  'active',
  datetime('now'),
  datetime('now')
);

INSERT INTO analytics_metric_triggers (
  metric_key,
  threshold,
  direction,
  severity,
  action,
  owner,
  auto_create_issue,
  created_at
) VALUES (
  'research_legacy_parked_count',
  0,
  'above',
  'medium',
  'Legacy stage=''parked'' items still exist. These should be swept by legacyParkedSweep at LEGACY_PARKED_PER_RUN (10/hour).

Verify sweep is running:
- Check legacyParkedSweep runs in research tick
- Current rate should clear pool in ~days

If sweep stalled, increase LEGACY_PARKED_PER_RUN or force sweep remaining items.

code-task: repo=qnfo-workers path=qnfo-research-exec/worker.js
code-anchor: async function legacyParkedSweep(env) {',
  'code-loop',
  1,
  datetime('now')
);

-- Map both metrics to same cause
INSERT INTO metric_breach_cause (metric_key, cause_key, note)
VALUES 
  ('research_deferred_pool_size', 'research-deferred-drain', 'Deferred pool drain implementation'),
  ('research_legacy_parked_count', 'research-deferred-drain', 'Legacy parked stage cleanup');
