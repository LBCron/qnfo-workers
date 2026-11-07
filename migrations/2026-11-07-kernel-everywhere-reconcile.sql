-- BLINDSPOT-1 reconciliation: manually-applied migrations (#8487)
-- migrations/2026-11-06-kernel-everywhere.sql was applied manually (PR #8469 "migration applied live")
-- despite BACKUP header referencing a view instead of a table. The apply-migrations.yml run failed
-- but the migration was executed outside that workflow. This reconciliation records it in migration_runs
-- so the BLINDSPOT-1 detector stops filing issues about it.
-- 
-- Evidence: PR #8469 merged 2026-11-06, description says "migration applied live"
-- GitHub workflow run 42346087266 shows the BACKUP error
-- The personal_replies table exists in qnfo-audit (created by that migration)
-- The v_agent_replies view includes personal_replies (created by that migration)
--
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261107_migration_runs_before_reconcile
-- Rollback: DELETE FROM migration_runs WHERE migration_file = 'migrations/2026-11-06-kernel-everywhere.sql' AND run_by = 'manual-reconciliation';

-- Backup migration_runs before reconciliation
CREATE TABLE IF NOT EXISTS bak_20261107_migration_runs_before_reconcile AS 
SELECT * FROM migration_runs;

-- Record the manually-applied migration as successful
-- Use INSERT OR REPLACE since migration_file is the PRIMARY KEY and a failed record already exists
INSERT OR REPLACE INTO migration_runs (
  migration_file,
  status,
  run_at,
  run_by,
  statements_executed,
  error_message
) VALUES (
  'migrations/2026-11-06-kernel-everywhere.sql',
  'ok',
  '2026-11-06 17:00:00',  -- Approximate time from PR #8469 merge
  'manual-reconciliation',
  7,  -- Number of statements in that migration
  NULL
);
