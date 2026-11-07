-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261107_metric_registry_research_deferred
-- Rollback: DELETE FROM metric_registry WHERE metric IN ('research_deferred_pool_size','research_legacy_parked_count'); DELETE FROM analytics_metric_triggers WHERE metric IN ('research_deferred_pool_size','research_legacy_parked_count'); DELETE FROM metric_breach_cause WHERE cause_key = 'research-deferred-drain'; DROP VIEW IF EXISTS v_research_deferred_analysis; DROP TABLE IF EXISTS bak_20261107_metric_registry_research_deferred;
--
-- RESEARCH-DEFERRED-POOL-FIX-1: Complete the broken research-pipeline-drain migration
-- The 2026-11-07-research-pipeline-drain-deferred-pool.sql migration failed at statement 2
-- because it used 'metric_key' instead of 'metric' column name. Statement 1 (view) succeeded.
-- This migration completes what that one tried to do with the correct column names.

-- Create backup
CREATE TABLE IF NOT EXISTS bak_20261107_metric_registry_research_deferred AS 
SELECT * FROM metric_registry WHERE 1=0;

-- First, check if v_research_deferred_analysis already exists from the broken migration
-- (It was created successfully as statement 1 before the failure at statement 2)
-- We'll drop and recreate it to ensure it's correct:

DROP VIEW IF EXISTS v_research_deferred_analysis;

CREATE VIEW v_research_deferred_analysis AS
SELECT 
  status,
  stage,
  COUNT(*) as count,
  AVG(recover_count) as avg_recovery_count,
  MAX(recover_count) as max_recovery_count,
  MIN(created_at) as oldest_created,
  MAX(created_at) as newest_created
FROM research_queue
WHERE status = 'deferred' OR stage = 'parked'
GROUP BY status, stage;

-- Metric 1: Deferred pool size
INSERT OR IGNORE INTO metric_registry (
  metric,
  metric_name,
  query,
  layer,
  kind,
  target,
  threshold,
  state,
  disposition_actor,
  owner
) VALUES (
  'research_deferred_pool_size',
  'Research deferred pool size',
  'SELECT COUNT(*) as value FROM research_queue WHERE status = ''deferred''',
  'infra',
  'ceiling',
  0,
  100,
  'active',
  'fix',
  'qnfo-research-exec'
);

-- Trigger for metric 1
INSERT OR IGNORE INTO analytics_metric_triggers (
  metric,
  metric_key,
  threshold,
  severity,
  action,
  owner
) VALUES (
  'research_deferred_pool_size',
  'research_deferred_pool_size',
  100,
  'high',
  'RESEARCH-DEFERRED-POOL-DRAIN-1: The deferred pool has grown past threshold. Most deferred items can be automatically drained by re-queueing them after their error cause is fixed. Implementation: qnfo-research-exec should add a deferred pool drain that runs every N minutes and re-queues deferred items with recover_count reset to 0, logging the drain action.

code-task: repo=qnfo-workers path=qnfo-research-exec/worker.js
code-anchor: async function tick(env) {',
  'qnfo-research-exec'
);

-- Metric 2: Legacy parked count
INSERT OR IGNORE INTO metric_registry (
  metric,
  metric_name,
  query,
  layer,
  kind,
  target,
  threshold,
  state,
  disposition_actor,
  owner
) VALUES (
  'research_legacy_parked_count',
  'Research legacy parked rows',
  'SELECT COUNT(*) as value FROM research_queue WHERE stage = ''parked''',
  'infra',
  'ceiling',
  0,
  0,
  'active',
  'alert',
  'qnfo-research-exec'
);

-- Trigger for metric 2
INSERT OR IGNORE INTO analytics_metric_triggers (
  metric,
  metric_key,
  threshold,
  severity,
  action,
  owner
) VALUES (
  'research_legacy_parked_count',
  'research_legacy_parked_count',
  0,
  'medium',
  'RESEARCH-LEGACY-PARKED-SWEEP-1: Legacy parked rows detected. The legacyParkedSweep should have cleared these at 10/hour. Verify the sweep is running and increase its rate if needed.

code-task: repo=qnfo-workers path=qnfo-research-exec/worker.js  
code-anchor: async function legacyParkedSweep(env) {',
  'qnfo-research-exec'
);

-- Add metric breach cause
INSERT OR IGNORE INTO metric_breach_cause (
  metric,
  cause_key,
  cause_description
) VALUES 
  ('research_deferred_pool_size', 'research-deferred-drain', 'Deferred items not being drained back to queued status'),
  ('research_legacy_parked_count', 'research-deferred-drain', 'Legacy parked sweep not running or running too slowly');
