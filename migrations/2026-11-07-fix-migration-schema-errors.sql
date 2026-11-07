-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM remediation_contracts WHERE class IN ('issue-8495-runtime', 'issue-8495-code'); UPDATE remediation_contracts SET status = 'active' WHERE class = 'rt-live-voice-stt'; DELETE FROM metric_registry WHERE metric = 'research_deferred_pool_pct'; DROP TRIGGER IF EXISTS retention_personal_replies_tick_v1;
-- BACKUP: bak_20261107_remediation_contracts_companion_ui
-- CAUSE-MAPPED: research_deferred_pool_pct breach cause mapped as 'research-pipeline' below

-- FIX-MIGRATION-SCHEMA-ERRORS-1: Fix 4 failing migrations from PR #8506
-- Root cause: Migrations used wrong column names (verify_cadence_h instead of expected_cadence_h, 
-- metric_name instead of metric) and missing/misconfigured BACKUP tables
--
-- Failed migrations:
-- 1. companion-ui-regression-guard.sql: verify_cadence_h → expected_cadence_h
-- 2. research-deferred-pool-fix.sql: metric_name → metric  
-- 3. personal-replies-retention-fix.sql: empty BACKUP table
-- 4. voice-stt-probe-remove.sql: BACKUP table 'none'
--
-- This migration applies the corrected versions of those 4 migrations.

-- ============================================================================
-- FIX 1: companion-ui-regression-guard.sql (COMPANION-UI-REGRESSION-GUARD-1)
-- ============================================================================
-- Original error: "table remediation_contracts has no column named verify_cadence_h"
-- Fix: Change verify_cadence_h → expected_cadence_h

-- Backup existing contracts (if any exist)
CREATE TABLE IF NOT EXISTS bak_20261107_remediation_contracts_companion_ui AS 
SELECT * FROM remediation_contracts WHERE class IN ('issue-8495-runtime', 'issue-8495-code');

-- Delete if they exist (idempotent)
DELETE FROM remediation_contracts WHERE class IN ('issue-8495-runtime', 'issue-8495-code');

-- Add runtime probe with CORRECT column name
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

-- Add code probe with CORRECT column name
INSERT INTO remediation_contracts (
  class, verify_transport, verify_probe, expected_cadence_h, hit_action, issue_id, description,
  precondition, action, max_attempts, escalate_to
) VALUES (
  'issue-8495-code',
  'code-read',
  '{"paths": ["personal-api/worker.js"], "absent": "function fleetAsks"}',
  1,
  'code',
  8495,
  'COMPANION-UI-REGRESSION-GUARD-1: Ensure fleetAsks function not reintroduced in personal-api',
  'TRUE',
  'file_issue',
  3,
  'owner'
);

-- Rollback for FIX 1:
-- DELETE FROM remediation_contracts WHERE class IN ('issue-8495-runtime', 'issue-8495-code');

-- ============================================================================
-- FIX 2: voice-stt-probe-remove.sql (supersede failing probe)
-- ============================================================================
-- Original error: "BACKUP table none does not exist"
-- Fix: Create proper backup, then supersede the probe

-- Create backup of the probe being superseded
CREATE TABLE IF NOT EXISTS bak_20261107_voice_stt_probe AS
SELECT * FROM remediation_contracts WHERE class = 'rt-live-voice-stt';

-- Supersede the failing probe for non-existent qnfo-live-voice worker
UPDATE remediation_contracts 
SET status = 'superseded',
    module = 'FIX-MIGRATION-SCHEMA-ERRORS-1'
WHERE class = 'rt-live-voice-stt';

-- Rollback for FIX 2:
-- UPDATE remediation_contracts SET status = 'active', module = NULL WHERE class = 'rt-live-voice-stt';

-- ============================================================================
-- FIX 3: research-deferred-pool-fix.sql (metric column name)
-- ============================================================================
-- Original error: "table metric_registry has no column named metric_name"
-- Fix: Use correct column name 'metric' instead of 'metric_name'

-- Note: The original migration also tried to add metric_key to analytics_metric_triggers
-- That part may have succeeded (statement 3 of 4). We make it idempotent.

-- Backup
CREATE TABLE IF NOT EXISTS bak_20261107_research_deferred_pool_metric AS
SELECT * FROM metric_registry WHERE metric = 'research_deferred_pool_pct';

-- Ensure the metric exists (idempotent)
INSERT OR REPLACE INTO metric_registry (
  metric, kind, target, polarity, formula, state, last_value, last_refreshed
) 
SELECT 
  'research_deferred_pool_pct',
  'quality',
  '10',
  'lower_is_better',
  'Percentage of research queue in deferred state',
  COALESCE(
    (SELECT state FROM metric_registry WHERE metric = 'research_deferred_pool_pct'),
    'MEASURED'
  ),
  (SELECT last_value FROM metric_registry WHERE metric = 'research_deferred_pool_pct'),
  (SELECT last_refreshed FROM metric_registry WHERE metric = 'research_deferred_pool_pct')
WHERE NOT EXISTS (SELECT 1 FROM metric_registry WHERE metric = 'research_deferred_pool_pct');

-- Map metric breach cause (METRIC-CAUSE-AT-REGISTRATION-1)
INSERT OR IGNORE INTO metric_breach_cause (metric, cause, lever)
VALUES ('research_deferred_pool_pct', 'research-pipeline', 'Increase deferred pool drain rate or reduce paper generation rate');

-- Rollback for FIX 3:
-- DELETE FROM metric_registry WHERE metric = 'research_deferred_pool_pct';

-- ============================================================================
-- FIX 4: personal-replies-retention-fix.sql (empty backup table)
-- ============================================================================  
-- Original error: "BACKUP table bak_20261107_personal_replies_retention_fix is empty"
-- Fix: The trigger itself is valid, but backup validation failed. Re-create trigger.

-- Backup: Save current trigger definition
CREATE TABLE IF NOT EXISTS bak_20261107_personal_replies_trigger AS
SELECT name, sql FROM sqlite_master 
WHERE type = 'trigger' AND name = 'retention_personal_replies_tick_v1';

-- Drop and recreate the trigger with correct table reference (fleet_tick not fleet_heartbeat)
DROP TRIGGER IF EXISTS retention_personal_replies_tick_v1;

CREATE TRIGGER IF NOT EXISTS retention_personal_replies_tick_v1
AFTER INSERT ON fleet_tick
WHEN NEW.ts > (SELECT COALESCE(MAX(ts), '1970-01-01') FROM fleet_tick WHERE ts < datetime('now', '-30 days'))
BEGIN
  DELETE FROM personal_replies
  WHERE created_at < datetime('now', '-30 days');
END;

-- Rollback for FIX 4:
-- DROP TRIGGER IF EXISTS retention_personal_replies_tick_v1;

-- Migration complete - all 4 fixes applied
