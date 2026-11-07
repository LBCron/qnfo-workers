-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261107_batch_schema_fix
-- Rollback: DELETE FROM remediation_contracts WHERE class IN ('issue-8495-runtime', 'issue-8495-code'); DELETE FROM failure_modes WHERE fm_key IN ('FM-COMPANION-NO-UI-VERIFICATION', 'FM-COMPANION-NO-RUNTIME-MONITORING', 'FM-COMPANION-NON-IDEMPOTENT-MIGRATION', 'fm-branch-cleanup-no-merge-check', 'fm-branch-cleanup-no-dry-run', 'fm-branch-cleanup-no-dangling-check'); DELETE FROM decision_log WHERE actor = 'failure-mode-remediation-migration' AND ts >= datetime('now', '-1 hour');

-- BATCH-FIX-SCHEMA-ERRORS: Fix 4 migrations with wrong column names
--
-- This migration corrects 4 failed migrations that used wrong column names:
-- 
-- Issue #8522: companion-ui-regression-guard.sql
--   Error: verify_cadence_h (should be expected_cadence_h in remediation_contracts)
--
-- Issue #8523: failure-mode-remediation.sql  
--   Error: decision_key (should use actor, assumption, action, evidence, outcome, blast_radius, rollback_path)
--
-- Issue #8524: companion-failure-modes.sql
--   Error: Used 'key' instead of 'fm_key' in failure_modes table
--
-- Issue #8527: branch-cleanup-failure-modes.sql
--   Error: Used (fm_key, title, ...) instead of (fm_key, failure_mode, ...)
--
-- Root cause: Migrations written without verifying column names against actual D1 schema
-- Prevention: Run migration_schema_guard.py before commit

-- ============================================================================
-- FIX 1: Issue #8522 - companion-ui-regression-guard.sql
-- ============================================================================
-- Original error: "table remediation_contracts has no column named verify_cadence_h"
-- Correct column: expected_cadence_h

CREATE TABLE IF NOT EXISTS bak_20261107_batch_schema_fix AS
SELECT * FROM remediation_contracts WHERE class IN ('issue-8495-runtime', 'issue-8495-code')
UNION ALL
SELECT * FROM failure_modes WHERE fm_key IN ('FM-COMPANION-NO-UI-VERIFICATION', 'FM-COMPANION-NO-RUNTIME-MONITORING', 'FM-COMPANION-NON-IDEMPOTENT-MIGRATION', 'fm-branch-cleanup-no-merge-check', 'fm-branch-cleanup-no-dry-run', 'fm-branch-cleanup-no-dangling-check')
UNION ALL
SELECT * FROM decision_log WHERE actor = 'failure-mode-remediation-migration' AND ts >= datetime('now', '-7 days');

DELETE FROM remediation_contracts WHERE class IN ('issue-8495-runtime', 'issue-8495-code');

INSERT INTO remediation_contracts (
  class, verify_transport, verify_probe, expected_cadence_h, hit_action, issue_id, description,
  precondition, action, max_attempts, escalate_to
) VALUES (
  'issue-8495-runtime',
  'runner-https',
  '{"url": "https://me.q08.org/companion", "status": 200, "absent": "For the Quniverse"}',
  1,
  'runtime',
  8495,
  'COMPANION-UI-REGRESSION-GUARD-1: Ensure ''For the Quniverse'' text does not appear on me.q08.org/companion',
  'TRUE',
  'file_issue',
  3,
  'owner'
);

INSERT INTO remediation_contracts (
  class, verify_transport, verify_probe, expected_cadence_h, hit_action, issue_id, description,
  precondition, action, max_attempts, escalate_to
) VALUES (
  'issue-8495-code',
  'code-read',
  '{"paths": ["qnfo-companion/worker.js"], "absent": "For the Quniverse"}',
  1,
  'code',
  8495,
  'COMPANION-UI-REGRESSION-GUARD-1: Ensure ''For the Quniverse'' text is not in qnfo-companion code',
  'TRUE',
  'file_issue',
  3,
  'code-loop'
);

-- ============================================================================
-- FIX 2: Issue #8524 - companion-failure-modes.sql
-- ============================================================================
-- Original error: "table failure_modes has no column named key"
-- Correct column: fm_key

DELETE FROM failure_modes WHERE fm_key IN ('FM-COMPANION-NO-UI-VERIFICATION', 'FM-COMPANION-NO-RUNTIME-MONITORING', 'FM-COMPANION-NON-IDEMPOTENT-MIGRATION');

INSERT INTO failure_modes (fm_key, failure_mode, root_cause, remediation, detected_at)
SELECT 
    'FM-COMPANION-NO-UI-VERIFICATION',
    'Companion UI changes deployed without verification',
    'UI regression introduced by removing content validation',
    'Add runtime probe checking actual rendered content at me.q08.org/companion',
    datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM failure_modes WHERE fm_key = 'FM-COMPANION-NO-UI-VERIFICATION');

INSERT INTO failure_modes (fm_key, failure_mode, root_cause, remediation, detected_at)
SELECT 
    'FM-COMPANION-NO-RUNTIME-MONITORING',
    'Companion deployed without runtime monitoring',
    'No verification that deployed version actually serves expected content',
    'Add continuous monitoring of companion endpoint with content assertions',
    datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM failure_modes WHERE fm_key = 'FM-COMPANION-NO-RUNTIME-MONITORING');

INSERT INTO failure_modes (fm_key, failure_mode, root_cause, remediation, detected_at)
SELECT 
    'FM-COMPANION-NON-IDEMPOTENT-MIGRATION',
    'Migration assumed clean state without verification',
    'Migration deleted rows without checking if they existed, causing empty BACKUP table',
    'Always use DELETE FROM WHERE or INSERT OR REPLACE; verify BACKUP will be non-empty',
    datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM failure_modes WHERE fm_key = 'FM-COMPANION-NON-IDEMPOTENT-MIGRATION');

-- ============================================================================
-- FIX 3: Issue #8527 - branch-cleanup-failure-modes.sql
-- ============================================================================
-- Original error: "table failure_modes has no column named title"
-- Correct schema: (fm_key, failure_mode, root_cause, remediation, ...)
-- Note: 'title' column doesn't exist; use 'failure_mode' for the title/name

DELETE FROM failure_modes WHERE fm_key IN ('fm-branch-cleanup-no-merge-check', 'fm-branch-cleanup-no-dry-run', 'fm-branch-cleanup-no-dangling-check');

INSERT INTO failure_modes (fm_key, failure_mode, root_cause, remediation, severity, detected_at)
VALUES (
  'fm-branch-cleanup-no-merge-check',
  'Branch cleanup deletes unmerged branches',
  'Branch cleanup script had no merge-status verification before deletion',
  'Add git merge-base check and refuse to delete branches with unmerged commits',
  'high',
  datetime('now')
);

INSERT INTO failure_modes (fm_key, failure_mode, root_cause, remediation, severity, detected_at)
VALUES (
  'fm-branch-cleanup-no-dry-run',
  'Branch cleanup has no dry-run mode',
  'No way to preview what cleanup would delete before running it',
  'Add --dry-run flag that lists branches to delete without deleting them',
  'medium',
  datetime('now')
);

INSERT INTO failure_modes (fm_key, failure_mode, root_cause, remediation, severity, detected_at)
VALUES (
  'fm-branch-cleanup-no-dangling-check',
  'Branch cleanup doesn''t check for dangling worktrees',
  'Deleting branch while worktree still references it leaves broken worktree',
  'Check worktree list before deletion; refuse if worktree references the branch',
  'high',
  datetime('now')
);

-- ============================================================================
-- FIX 4: Issue #8523 - failure-mode-remediation.sql (decision_log inserts)
-- ============================================================================
-- Original error: "table decision_log has no column named decision_key"
-- Correct schema: (actor, assumption, action, evidence, outcome, blast_radius, rollback_path)
-- Note: decision_log has auto-increment id, no decision_key column

-- Park issue 1001895 as monitoring
INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path)
SELECT
  'failure-mode-remediation-migration',
  'Issue 1001895 needs investigation before automatic remediation',
  'Park issue-1001895 as monitoring pending investigation',
  'Issue filed from PROBE-NEEDED-1 but actual requirement unclear',
  'PROBE-NEEDED-1 stops filing hourly; investigation can proceed',
  'remediation_contracts status change only',
  'UPDATE remediation_contracts SET status = ''active'' WHERE class = ''issue-1001895'''
WHERE NOT EXISTS (
  SELECT 1 FROM decision_log 
  WHERE actor = 'failure-mode-remediation-migration' 
    AND action = 'Park issue-1001895 as monitoring pending investigation'
);

INSERT OR REPLACE INTO remediation_contracts (class, issue_id, verify_probe, verify_transport, status, next_due_at)
VALUES (
  'issue-1001895',
  1001895,
  'SELECT ''investigation pending'' AS expected, ''pending'' AS observed',
  'd1-query',
  'monitoring',
  datetime('now', '+7 days')
);

-- Park issue 1001975 as monitoring
INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path)
SELECT
  'failure-mode-remediation-migration',
  'Issue 1001975 needs investigation before automatic remediation',
  'Park issue-1001975 as monitoring pending investigation',
  'Issue filed from PROBE-NEEDED-1 but actual requirement unclear',
  'PROBE-NEEDED-1 #8384 stops filing hourly',
  'remediation_contracts status change only',
  'UPDATE remediation_contracts SET status = ''active'' WHERE class = ''issue-1001975'''
WHERE NOT EXISTS (
  SELECT 1 FROM decision_log 
  WHERE actor = 'failure-mode-remediation-migration' 
    AND action = 'Park issue-1001975 as monitoring pending investigation'
);

INSERT OR REPLACE INTO remediation_contracts (class, issue_id, verify_probe, verify_transport, status, next_due_at)
VALUES (
  'issue-1001975',
  1001975,
  'SELECT ''investigation pending'' AS expected, ''pending'' AS observed',
  'd1-query',
  'monitoring',
  datetime('now', '+7 days')
);

-- Park issue 1002012 as monitoring
INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path)
SELECT
  'failure-mode-remediation-migration',
  'Issue 1002012 needs investigation before automatic remediation',
  'Park issue-1002012 as monitoring pending investigation',
  'Issue filed from PROBE-NEEDED-1 but actual requirement unclear',
  'PROBE-NEEDED-1 #8437 stops filing hourly',
  'remediation_contracts status change only',
  'UPDATE remediation_contracts SET status = ''active'' WHERE class = ''issue-1002012'''
WHERE NOT EXISTS (
  SELECT 1 FROM decision_log 
  WHERE actor = 'failure-mode-remediation-migration' 
    AND action = 'Park issue-1002012 as monitoring pending investigation'
);

INSERT OR REPLACE INTO remediation_contracts (class, issue_id, verify_probe, verify_transport, status, next_due_at)
VALUES (
  'issue-1002012',
  1002012,
  'SELECT ''investigation pending'' AS expected, ''pending'' AS observed',
  'd1-query',
  'monitoring',
  datetime('now', '+7 days')
);
