-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: Manual restoration from issue-level backups of remediation_contracts, metric_registry rows
--
-- Fix schema column mismatch errors from 2026-11-07-fix-empty-backup-issue.sql
-- Previous migration failed with "table remediation_contracts has no column named hit_action"
-- Also included non-existent 'description' column
--
-- ACTUAL remediation_contracts columns (from ab-length-retry.test.mjs):
-- class, issue_id, precondition, action, verify_probe, verify_transport,
-- max_attempts, escalate_to, expected_cadence_h, status, ts, last_attempt_at,
-- last_verdict, module, budget_ms, next_due_at, max_items, requires_container,
-- attempts, deferred_since
--
-- ACTUAL metric_registry columns: metric, last_value
--
-- Issue #8495: COMPANION-UI-REGRESSION-GUARD-1 - restore missing runtime and code probes
INSERT OR REPLACE INTO remediation_contracts (
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

INSERT OR REPLACE INTO remediation_contracts (
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

-- Issue #8501: RT-LIVE-VOICE-STT - supersede voice STT contract
UPDATE remediation_contracts 
SET status = 'removed'
WHERE class = 'rt-live-voice-stt';

-- Issue #8502: METRIC-RESEARCH-DEFERRED-POOL - restore metric with correct column name
INSERT OR REPLACE INTO metric_registry (metric, last_value)
VALUES ('research_deferred_pool_pct', '0');

-- Issue #8502: Add metric breach cause mapping
INSERT OR IGNORE INTO metric_breach_cause (metric, cause, action_template)
VALUES (
  'research_deferred_pool_pct',
  'research-execution',
  'Review deferred_since distribution in qnfo-research-exec and adjust execution priority or pool ceiling'
);

-- Issue #8474: RETENTION-PERSONAL-REPLIES - retention trigger was already created in
-- migrations/2026-11-02-personal-replies-retention.sql, so no action needed here.
-- The trigger exists and runs correctly.
