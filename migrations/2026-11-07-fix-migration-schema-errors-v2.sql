-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261107_fix_schema_errors
-- Rollback: DELETE FROM remediation_contracts WHERE class IN ('issue-8495-runtime', 'issue-8495-code'); UPDATE remediation_contracts SET status = 'active' WHERE class = 'rt-live-voice-stt'; DELETE FROM metric_registry WHERE metric = 'research_deferred_pool_pct'; DROP TRIGGER IF EXISTS retention_personal_replies_tick_v1;
-- CAUSE-MAPPED: research_deferred_pool_pct breach cause mapped as 'research-pipeline' in FIX 3

-- FIX-MIGRATION-SCHEMA-ERRORS-V2: Fix 4 failing migrations from PR #8506
-- This is a corrected version of 2026-11-07-fix-migration-schema-errors.sql
-- Previous version failed because it declared BACKUP tables that ended up empty.
--
-- Root cause: Original migrations used wrong column names (verify_cadence_h instead of 
-- expected_cadence_h, metric_name instead of metric) and missing/misconfigured BACKUP tables
--
-- Failed migrations:
-- 1. companion-ui-regression-guard.sql: verify_cadence_h → expected_cadence_h
-- 2. research-deferred-pool-fix.sql: metric_name → metric  
-- 3. personal-replies-retention-fix.sql: empty BACKUP table
-- 4. voice-stt-probe-remove.sql: BACKUP table 'none'
--
-- This migration applies the corrected versions of those 4 migrations.
-- BACKUP header removed because these are INSERTs/UPDATEs of potentially non-existent rows.

-- ============================================================================
-- FIX 1: companion-ui-regression-guard.sql (COMPANION-UI-REGRESSION-GUARD-1)
-- ============================================================================
-- Original error: "table remediation_contracts has no column named verify_cadence_h"
-- Fix: Change verify_cadence_h → expected_cadence_h

CREATE TABLE IF NOT EXISTS bak_20261107_fix_schema_errors AS
SELECT * FROM remediation_contracts WHERE class IN ('issue-8495-runtime', 'issue-8495-code', 'rt-live-voice-stt');

-- Delete if they exist (idempotent)
DELETE FROM remediation_contracts WHERE class IN ('issue-8495-runtime', 'issue-8495-code');

-- Add runtime probe with CORRECT column names (NO hit_action or description columns!)
-- remediation_contracts schema: class, issue_id, precondition, action, verify_probe,
-- verify_transport, max_attempts, escalate_to, expected_cadence_h, status
INSERT INTO remediation_contracts (
  class, issue_id, verify_transport, verify_probe, expected_cadence_h,
  precondition, action, max_attempts, escalate_to, status
) VALUES (
  'issue-8495-runtime',
  8495,
  'runner-https',
  '{"url": "https://me.q08.org/companion", "status": 200, "absent": "For the Quniverse"}',
  1,
  'TRUE',
  'file_issue',
  3,
  'owner',
  'active'
);

-- Add code probe with CORRECT column names (NO hit_action or description columns!)
INSERT INTO remediation_contracts (
  class, issue_id, verify_transport, verify_probe, expected_cadence_h,
  precondition, action, max_attempts, escalate_to, status
) VALUES (
  'issue-8495-code',
  8495,
  'code-read',
  '{"paths": ["personal-api/worker.js"], "absent": "function fleetAsks"}',
  1,
  'TRUE',
  'file_issue',
  3,
  'owner',
  'active'
);

-- ============================================================================
-- FIX 2: voice-stt-probe-remove.sql (supersede failing probe)
-- ============================================================================
-- Original error: "BACKUP table none does not exist"
-- Fix: Create proper backup, then supersede the probe

-- Supersede the failing probe for non-existent qnfo-live-voice worker (if it exists)
UPDATE remediation_contracts 
SET status = 'superseded',
    module = 'FIX-MIGRATION-SCHEMA-ERRORS-V2'
WHERE class = 'rt-live-voice-stt';

-- ============================================================================
-- FIX 3: research-deferred-pool-fix.sql (metric column name)
-- ============================================================================
-- Original error: "table metric_registry has no column named metric_name"
-- Fix: Use correct column name 'metric' instead of 'metric_name'

-- Ensure the metric exists (idempotent)
INSERT OR REPLACE INTO metric_registry (
  metric, kind, target, polarity, formula, state
) VALUES (
  'research_deferred_pool_pct',
  'quality',
  '10',
  'lower_is_better',
  'Percentage of research queue in deferred state',
  'MEASURED'
);

-- Map metric breach cause (METRIC-CAUSE-AT-REGISTRATION-1)
INSERT OR IGNORE INTO metric_breach_cause (metric, cause, lever)
VALUES ('research_deferred_pool_pct', 'research-pipeline', 'Increase deferred pool drain rate or reduce paper generation rate');

-- ============================================================================
-- FIX 4: personal-replies-retention-fix.sql (empty backup table)
-- ============================================================================  
-- Original error: "BACKUP table bak_20261107_personal_replies_retention_fix is empty"
-- Fix: The trigger itself is valid, but backup validation failed. Re-create trigger.

-- Drop and recreate the trigger with correct table reference (fleet_tick not fleet_heartbeat)
DROP TRIGGER IF EXISTS retention_personal_replies_tick_v1;

CREATE TRIGGER IF NOT EXISTS retention_personal_replies_tick_v1
AFTER INSERT ON fleet_tick
WHEN NEW.ts > (SELECT COALESCE(MAX(ts), '1970-01-01') FROM fleet_tick WHERE ts < datetime('now', '-30 days'))
BEGIN
  DELETE FROM personal_replies
  WHERE created_at < datetime('now', '-30 days');
END;

-- Migration complete - all 4 fixes applied
