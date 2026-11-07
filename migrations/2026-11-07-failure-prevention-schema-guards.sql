-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM failure_modes WHERE failure_key IN ('migration-schema-mismatch', 'migration-partial-apply'); DELETE FROM analytics_metric_triggers WHERE metric_key IN ('migration_schema_violations', 'migration_partial_states'); DELETE FROM metric_registry WHERE metric IN ('migration_schema_violations', 'migration_partial_states'); DROP VIEW IF EXISTS v_migration_quality;
-- BACKUP: failure_modes

-- FAILURE PREVENTION: Migration schema validation (MIGRATION-SCHEMA-GUARD-1)
-- 
-- ROOT CAUSE ANALYSIS: PR #8490 / migrations/2026-11-07-research-pipeline-drain-deferred-pool.sql
--   - Merged to main with 'metric_key' column for metric_registry table
--   - Production failure at apply-migrations step (statement 2)
--   - Error: "table metric_registry has no column named metric_key"
--   - Actual schema: metric_registry uses 'metric' (PRIMARY KEY)
--   - Actual schema: analytics_metric_triggers uses 'metric_key' (UNIQUE)
--   - Partial application: view created, metrics NOT inserted
--   - Required corrective migration: PR #8507
--
-- FAILURE MODE CHAIN:
--   1. No pre-merge schema validation (CI guards syntax only)
--   2. Assumed schema consistency across related tables (WRONG)
--   3. Column name error propagated through 6 iterations
--   4. Merged with passing CI checks
--   5. Failed in production at runtime (D1 schema mismatch)
--   6. Partial state left in database
--
-- PREVENTION LAYERS (defense in depth):
--   1. Pre-merge: scripts/migration_schema_guard.py (PR-CHECK-CAP-5-1 step)
--   2. Post-merge: Track violations in failure_modes registry
--   3. Monitoring: migration_schema_violations metric (target: 0)
--   4. Monitoring: migration_partial_states metric (partial applies)
--   5. Automated: Code loop files issue on breach with schema fix

-- Register the failure mode
INSERT INTO failure_modes (
  failure_key,
  title,
  severity,
  root_cause,
  remediation,
  prevention_layers,
  recurrence_cost,
  first_seen,
  last_seen,
  occurrence_count,
  state
) VALUES (
  'migration-schema-mismatch',
  'Migration schema column name mismatch',
  'critical',
  'INSERT statements use column names not in actual D1 table schema. CI guards validate syntax but cannot catch runtime schema mismatches. Assumptions about schema consistency across related tables (metric_registry vs analytics_metric_triggers) are false.',
  'scripts/migration_schema_guard.py validates INSERT column names against KNOWN_SCHEMAS dict extracted from actual D1. Guard runs in pr-checks versions job (MIGRATION-SCHEMA-GUARD-1). Always query live schema with wrangler d1 execute before writing migrations.',
  'Pre-merge: migration_schema_guard.py in CI; Post-merge: migration_runs table tracks failures; Monitoring: migration_schema_violations metric files code-task issues; Documentation: KNOWN_SCHEMAS updated when table schemas change',
  'Production deploy failure, partial D1 state, corrective migration required, 2+ hour delay, user escalation',
  datetime('2026-11-07 06:52:06'),
  datetime('2026-11-07 06:52:06'),
  1,
  'active'
);

INSERT INTO failure_modes (
  failure_key,
  title,
  severity,
  root_cause,
  remediation,
  prevention_layers,
  recurrence_cost,
  first_seen,
  last_seen,
  occurrence_count,
  state
) VALUES (
  'migration-partial-apply',
  'Migration partial application leaving inconsistent D1 state',
  'high',
  'Migration fails mid-execution, leaving partial state (views created, metrics not inserted). No automatic rollback. Corrective migration must clean up partial state before retry.',
  'BACKUP header documents state before migration. Corrective migrations use DROP VIEW IF EXISTS and DELETE WHERE metric IN (...) before re-applying. migration_runs table records partial failures for monitoring.',
  'Pre-merge: apply_migrations.py --check validates headers; Post-merge: migration_runs tracks status; Monitoring: migration_partial_states metric counts error status migrations; Automated: Corrective migrations triggered by metric breach',
  'Inconsistent D1 state until corrective migration, potential query errors, 1-2 hour delay',
  datetime('2026-11-07 06:52:06'),
  datetime('2026-11-07 06:52:06'),
  1,
  'active'
);

-- Create monitoring view
CREATE VIEW IF NOT EXISTS v_migration_quality AS
SELECT
  (SELECT COUNT(*) FROM migration_runs WHERE status = 'error') as failed_migrations,
  (SELECT COUNT(*) FROM migration_runs WHERE status = 'error' AND applied_at > datetime('now', '-7 days')) as failed_last_7d,
  (SELECT COUNT(*) FROM failure_modes WHERE failure_key LIKE 'migration-%' AND state = 'active') as active_migration_failures,
  (SELECT MAX(applied_at) FROM migration_runs WHERE status = 'error') as last_failure_at;

-- Register metrics with triggers pointing to code loop
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
  'migration_schema_violations',
  'Migration Schema Violations (Last 30 Days)',
  'SELECT COUNT(*) as value FROM migration_runs WHERE status = ''error'' AND applied_at > datetime(''now'', ''-30 days'') AND error_message LIKE ''%has no column named%''',
  0,
  '<=',
  'active',
  datetime('now'),
  datetime('now')
);

INSERT INTO analytics_metric_triggers (
  metric_key,
  title,
  threshold,
  operator,
  priority,
  owner,
  action,
  enabled,
  created_at
) VALUES (
  'migration_schema_violations',
  'Migration schema violations detected',
  0,
  '>',
  1,
  'code-loop',
  'MIGRATION-SCHEMA-VIOLATION: Schema mismatch in migration' || char(10) ||
  'Root cause: INSERT uses column name not in actual D1 table schema' || char(10) ||
  'Evidence: migration_runs.error_message contains "has no column named"' || char(10) ||
  'Fix required: Create corrective migration with correct column names' || char(10) ||
  'Query live schema: wrangler d1 execute qnfo-audit --remote --command "SELECT sql FROM sqlite_master WHERE type=''table'' AND name=''<table>''"' || char(10) ||
  'code-task: repo=qnfo-workers path=migrations/' || char(10) ||
  'closing probe: runtime-probe {"url": "https://fleet.qnfo.org/api/metrics", "status": 200, "contains": "migration_schema_violations", "value": 0}',
  1,
  datetime('now')
);

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
  'migration_partial_states',
  'Migrations With Partial Application (Last 30 Days)',
  'SELECT COUNT(*) as value FROM migration_runs WHERE status = ''error'' AND applied_at > datetime(''now'', ''-30 days'')',
  0,
  '<=',
  'active',
  datetime('now'),
  datetime('now')
);

INSERT INTO analytics_metric_triggers (
  metric_key,
  title,
  threshold,
  operator,
  priority,
  owner,
  action,
  enabled,
  created_at
) VALUES (
  'migration_partial_states',
  'Migration partial application detected',
  0,
  '>',
  2,
  'code-loop',
  'MIGRATION-PARTIAL-STATE: Migration failed mid-execution' || char(10) ||
  'Root cause: SQL error during multi-statement migration' || char(10) ||
  'Evidence: migration_runs.status = error' || char(10) ||
  'State: Partial application (some statements succeeded before failure)' || char(10) ||
  'Fix required: Create corrective migration that:' || char(10) ||
  '  1. Cleans up partial state (DROP VIEW IF EXISTS, DELETE WHERE metric IN (...))' || char(10) ||
  '  2. Re-applies with correct SQL' || char(10) ||
  '  3. Documents what was partially applied in migration header' || char(10) ||
  'code-task: repo=qnfo-workers path=migrations/' || char(10) ||
  'closing probe: runtime-probe {"url": "https://fleet.qnfo.org/api/metrics", "status": 200, "contains": "migration_partial_states", "value": 0}',
  1,
  datetime('now')
);

-- Map to cause registry
INSERT INTO metric_breach_cause (metric_key, cause_key, note)
VALUES
  ('migration_schema_violations', 'migration-quality', 'Schema guard prevented; monitor for escapes'),
  ('migration_partial_states', 'migration-quality', 'Partial state requires corrective migration');
