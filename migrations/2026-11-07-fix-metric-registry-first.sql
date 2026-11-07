-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM metric_breach_cause WHERE metric_key = 'research_deferred_pool_pct'; DELETE FROM metric_registry WHERE metric = 'research_deferred_pool_pct'; Manual restoration of remediation_contracts from backups
--
-- Fix layer 6: metric_breach_cause INSERT requires metric exists in metric_registry FIRST
-- Previous migration (2026-11-07-fix-column-mismatch.sql) failed at statement 4:
-- "METRIC-INTEGRITY-1: source_of_truth, disposition_actor and refresh_cadence are mandatory"
--
-- ROOT CAUSE: metric_breach_cause INSERT validates that its metric exists in metric_registry
-- with source_of_truth, disposition_actor, and refresh_cadence columns populated (triggers from
-- 2026-10-28-metric-family-cluster-b.sql). The migration tried to INSERT breach cause BEFORE
-- registering the metric itself.
--
-- FIX: Register metric in metric_registry FIRST with all required fields, THEN map its breach cause
--
-- ACTUAL metric_registry columns (from ab-length-retry.test.mjs AND metric-family-cluster-b.sql):
-- metric (PK), layer, kind, formula, source_of_truth, baseline, target, owner, disposition_actor,
-- refresh_cadence, warning_band, kill_band, last_value, last_refreshed, state, refresh_class
--
-- ACTUAL metric_breach_cause columns: metric_key (PK), cause_key, note

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

-- Issue #8502: METRIC-RESEARCH-DEFERRED-POOL - FIRST register the metric with required fields
INSERT OR REPLACE INTO metric_registry (
  metric, layer, kind, formula, source_of_truth, baseline, target, owner,
  disposition_actor, refresh_cadence, state, refresh_class
) VALUES (
  'research_deferred_pool_pct',
  'operational',
  'leading',
  'Share of research pool items in deferred status',
  'qnfo-audit.research_pool',
  '0',
  '< 0.2',
  'qnfo-research-exec',
  'analytics_metric_triggers research_deferred_pool_pct -> agent_issues',
  '10m',
  'PENDING',
  'computed'
);

-- Issue #8502: THEN add the breach cause mapping (AFTER metric exists in registry)
INSERT OR IGNORE INTO metric_breach_cause (metric_key, cause_key, note)
VALUES (
  'research_deferred_pool_pct',
  'research-execution',
  'Review deferred_since distribution in qnfo-research-exec and adjust execution priority or pool ceiling'
);

-- Issue #8474: RETENTION-PERSONAL-REPLIES - retention trigger was already created in
-- migrations/2026-11-02-personal-replies-retention.sql, so no action needed here.
-- The trigger exists and runs correctly.
