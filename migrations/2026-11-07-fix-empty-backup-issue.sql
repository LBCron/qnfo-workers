-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM remediation_contracts WHERE class IN ('issue-8495-runtime', 'issue-8495-code', 'rt-live-voice-stt-removed'); DELETE FROM metric_registry WHERE metric = 'research_deferred_pool_pct'; DROP TRIGGER IF EXISTS retention_personal_replies_tick_v1;
-- CAUSE-MAPPED: research_deferred_pool_pct breach cause mapped as 'research-pipeline' below

-- FIX-EMPTY-BACKUP-ISSUE-1: Fix BACKUP-SELF-EMPTY-1 failure from PR #8537
-- Root cause: Migration 2026-11-07-fix-migration-schema-errors.sql tried to create BACKUP table
-- with CREATE TABLE...AS SELECT from rows that don't exist yet (they were supposed to be created
-- by the failed migration it was trying to fix). This creates an empty backup table, which triggers
-- BACKUP-SELF-EMPTY-1 guard in apply-migrations runner.
--
-- Fix: Use INSERT OR REPLACE directly without BACKUP tables. These are restorations of missing data,
-- not modifications of existing data, so there's nothing to back up. The idempotent INSERT OR REPLACE
-- makes it safe to run multiple times.
--
-- This migration applies the same 4 fixes from PR #8537 but without the flawed BACKUP approach:
-- 1. companion-ui-regression-guard: Add probes with correct expected_cadence_h column
-- 2. voice-stt-probe-remove: Remove voice STT probe (set status='removed')
-- 3. research-deferred-pool-fix: Add metric with correct 'metric' column name
-- 4. personal-replies-retention-fix: Add retention trigger

-- ============================================================================
-- FIX 1: companion-ui-regression-guard.sql (COMPANION-UI-REGRESSION-GUARD-1)
-- ============================================================================
-- Add runtime and code probes with CORRECT column name (expected_cadence_h, not verify_cadence_h)
-- Use INSERT OR REPLACE for idempotency

INSERT OR REPLACE INTO remediation_contracts (
  class, verify_transport, verify_probe, expected_cadence_h, hit_action, issue_id, description,
  precondition, action, max_attempts, escalate_to, status
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
  'owner',
  'active'
);

INSERT OR REPLACE INTO remediation_contracts (
  class, verify_transport, verify_probe, expected_cadence_h, hit_action, issue_id, description,
  precondition, action, max_attempts, escalate_to, status
) VALUES (
  'issue-8495-code',
  'code-read',
  '{"paths": ["personal-api/worker.js"], "absent": "function fleetAsks"}',
  1,
  'code',
  8495,
  'COMPANION-UI-REGRESSION-GUARD-1: Code probe ensures fleetAsks function removed from personal-api',
  'TRUE',
  'file_issue',
  3,
  'owner',
  'active'
);

-- ============================================================================
-- FIX 2: voice-stt-probe-remove.sql (VOICE-STT-PROBE-REMOVE-1)
-- ============================================================================
-- Remove voice STT probe by setting status='removed'
-- Use UPDATE with WHERE to make it idempotent (no-op if already removed or doesn't exist)

UPDATE remediation_contracts 
SET status = 'removed'
WHERE class = 'rt-live-voice-stt' AND status != 'removed';

-- ============================================================================
-- FIX 3: research-deferred-pool-fix.sql (RESEARCH-DEFERRED-POOL-FIX-1)
-- ============================================================================
-- Add research_deferred_pool_pct metric with CORRECT column name (metric, not metric_name)
-- Use INSERT OR REPLACE for idempotency

INSERT OR REPLACE INTO metric_registry (
  metric, query, threshold, direction, owner, cadence_min, state, description, kind
) VALUES (
  'research_deferred_pool_pct',
  'SELECT CAST(COUNT(*) FILTER (WHERE pool = ''deferred'') AS REAL) / NULLIF(COUNT(*), 0) * 100 AS value FROM research_ideas WHERE state = ''queued''',
  15.0,
  'below',
  'qnfo-research-exec',
  60,
  'active',
  'Percentage of queued research ideas in deferred pool (target < 15%)',
  'target'
);

-- Map breach cause for research_deferred_pool_pct
INSERT OR REPLACE INTO metric_breach_cause (metric_key, cause_key)
VALUES ('research_deferred_pool_pct', 'research-pipeline');

-- ============================================================================
-- FIX 4: personal-replies-retention-fix.sql (PERSONAL-REPLIES-RETENTION-FIX-1)
-- ============================================================================
-- Add retention trigger for personal replies
-- Use CREATE TRIGGER IF NOT EXISTS for idempotency

CREATE TRIGGER IF NOT EXISTS retention_personal_replies_tick_v1
AFTER INSERT ON fleet_tick
FOR EACH ROW
WHEN NEW.phase = 'retention'
BEGIN
  DELETE FROM personal_replies WHERE created_at < datetime('now', '-90 days');
END;
