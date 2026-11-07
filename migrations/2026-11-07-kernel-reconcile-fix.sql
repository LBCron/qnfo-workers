-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261107_migration_runs_kernel_fix
-- Rollback: DELETE FROM migration_runs WHERE file = 'migrations/2026-11-06-kernel-everywhere.sql' AND applied_by = 'manual-reconciliation-fix';
--
-- Fix BLINDSPOT-1 reconciliation for kernel-everywhere migration (#8487)
-- The original 2026-11-07-kernel-everywhere-reconcile.sql failed with:
-- "table migration_runs has no column named migration_file: SQLITE_ERROR"
--
-- Actual columns: file, sha256, commit_sha, db, status, statements, error, applied_by
-- (not migration_file, run_at, run_by, statements_executed, error_message)
--
-- The kernel-everywhere migration was applied manually (PR #8469 says "migration applied live")
-- despite the BACKUP header error. This records it correctly so BLINDSPOT-1 stops filing.

CREATE TABLE IF NOT EXISTS bak_20261107_migration_runs_kernel_fix AS 
SELECT * FROM migration_runs WHERE file = 'migrations/2026-11-06-kernel-everywhere.sql';

-- Record the manually-applied migration as successful with correct column names
INSERT OR REPLACE INTO migration_runs (
  file,
  sha256,
  commit_sha,
  db,
  status,
  statements,
  error,
  applied_by
) VALUES (
  'migrations/2026-11-06-kernel-everywhere.sql',
  'superseded',  -- Use superseded since it was applied outside normal flow
  NULL,  -- commit_sha unknown for manual application
  'qnfo-audit',
  'superseded',
  10,  -- Approximate statement count from the migration
  'BACKUP header error; migration applied manually (PR #8469)',
  'manual-reconciliation-fix'
);
