-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DROP VIEW IF EXISTS v_research_deferred_analysis; DELETE FROM metric_registry WHERE metric_key IN ('research_deferred_pool_size','research_legacy_parked_count'); DELETE FROM analytics_metric_triggers WHERE metric IN ('research_deferred_pool_size','research_legacy_parked_count'); DELETE FROM metric_breach_cause WHERE cause_key = 'research-deferred-drain';
-- BACKUP: analytics_metric_triggers

/*
RESEARCH-DEFERRED-POOL-DRAIN-1: Fix the stalled research pipeline deferred pool

THE PROBLEM (from user: "PARKED, STALLED, AND INACTIVE RESEARCH? WHY ARE THERE SO MANY SUB-LANES AND DIFFERENT STATUS MARKERS?"):

1. DEFERRED STATUS: Items that fail 2+ recovery attempts get status='deferred' (TERMINAL_RECOVERY_MAX=2 in worker.js line 1099)
   - The deferred pool had 1,388 rows, synthesis reduced it to 437 (SLA-DRAIN-2 comment line 9160)
   - These items NEVER automatically return to queued
   - Research tick only processes status='queued', ignoring 'deferred'
   - Result: HUNDREDS OF ITEMS SIT FOREVER

2. "PARKED" STATUS CONFUSION:
   - "parked" STAGE was removed in version 0.54.0 with SINGLE-LANE-1 (worker.js line 3556)
   - Legacy parked rows are swept by legacyParkedSweep at 10/hour (LEGACY_PARKED_PER_RUN)
   - Modern pipeline uses laneReenter instead - NO MORE PARKING
   - Any remaining stage='parked' rows are legacy only

3. SUB-LANES AND STATUS MARKERS (the full state machine):
   Primary statuses: queued → researching → review → completed
   Error/holding states: failed, deferred, merged, wontfix (legacy), archived (legacy)
   Stage markers within researching: ground, ensemble, reconcile, complete, review, revise, verify
   Stage markers within review: publish

THE FIX:
- Add v_research_deferred_analysis view showing deferred pool composition
- Add metric research_deferred_pool_size (threshold: 100, target: 0)
- Add metric research_legacy_parked_count (threshold: 0 - should be swept clean)
- Triggers point to qnfo-research-exec with code-task for automatic deferred draining

RELATED CODE:
- laneReenter: lines 1109-1130 (re-enters failed items into lane)
- laneStatusFor: line 1104-1106 (returns 'deferred' after TERMINAL_RECOVERY_MAX cycles)
- TERMINAL_RECOVERY_MAX: line 1099 (currently 2)
- legacyParkedSweep: lines 3562-3574 (sweeps legacy parked rows at 10/hour)
- ideaSynthesisTick: lines 33709+ (merges similar deferred proposals, but doesn't drain pool)
- SLA-DRAIN-2 comment: line 9160 (mentions 437 deferred items needing clearing)
*/

-- View: Analyze deferred pool composition
CREATE VIEW IF NOT EXISTS v_research_deferred_analysis AS
SELECT 
  status,
  source,
  COUNT(*) as count,
  MIN(created_at) as oldest,
  MAX(created_at) as newest,
  ROUND(AVG(terminal_rearms), 2) as avg_rearms,
  MAX(terminal_rearms) as max_rearms
FROM research_queue
WHERE status IN ('deferred', 'wontfix', 'archived')
   OR stage = 'parked'
GROUP BY status, source
ORDER BY count DESC;

-- Metric 1: Deferred pool size (the main problem)
INSERT INTO metric_registry (
  metric_key,
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
  severity,
  owner,
  action,
  state,
  created_at
) VALUES (
  'research_deferred_pool_size',
  100,
  'high',
  'qnfo-research-exec',
  'RESEARCH-DEFERRED-POOL-DRAIN-1: Deferred pool >100. ROOT CAUSE: status=''deferred'' after TERMINAL_RECOVERY_MAX (2) never returns to ''queued''. Research tick only processes WHERE status=''queued''. CONCRETE LEVER: Add deferred drain to claimErrataFair: SELECT oldest N=10 deferred WHERE recover_count < terminal_rearms, UPDATE to status=''queued'' with stage=''ground''. DEFINITION OF DONE: research_deferred_pool_size < 100 sustained 7 days.' || char(10) ||
    'code-task: repo=qnfo-workers path=qnfo-research-exec/worker.js' || char(10) ||
    'code-anchor: async function claimErrataFair(env, nowMs) {',
  'active',
  datetime('now')
);

-- Metric 2: Legacy parked count (should be zero, swept at 10/hour)
INSERT INTO metric_registry (
  metric_key,
  metric_name,
  query,
  target_value,
  comparison,
  state,
  created_at,
  updated_at
) VALUES (
  'research_legacy_parked_count',
  'Research Legacy Parked Count',
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
  severity,
  owner,
  action,
  state,
  created_at
) VALUES (
  'research_legacy_parked_count',
  0,
  'medium',
  'qnfo-research-exec',
  'RESEARCH-LEGACY-PARKED-SWEEP-1: Legacy stage=''parked'' rows from pre-v0.54.0. Modern pipeline (SINGLE-LANE-1) uses laneReenter - NO MORE PARKING. ROOT CAUSE: stage=''parked'' removed in v0.54.0. Remaining rows are pre-0.54.0 artifacts. CONCRETE LEVER: legacyParkedSweep already sweeps at 10/hour. If count > 100, increase LEGACY_PARKED_PER_RUN temporarily. DEFINITION OF DONE: research_legacy_parked_count = 0 sustained for 24 hours.' || char(10) ||
    'code-task: repo=qnfo-workers path=qnfo-research-exec/worker.js' || char(10) ||
    'code-anchor: async function legacyParkedSweep(env) {',
  'active',
  datetime('now')
);

-- Map both metrics to research-deferred-drain cause
INSERT INTO metric_breach_cause (metric, cause_key, note, created_at)
VALUES 
  ('research_deferred_pool_size', 'research-deferred-drain', 'Deferred pool accumulation requiring drain logic', datetime('now')),
  ('research_legacy_parked_count', 'research-deferred-drain', 'Legacy parked rows requiring sweep completion', datetime('now'));
