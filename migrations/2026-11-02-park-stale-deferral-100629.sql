-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261102_park_stale_deferral_100629
-- Rollback: UPDATE remediation_contracts SET status = (SELECT status FROM bak_20261102_park_stale_deferral_100629 WHERE class = 'issue-100629'), deferred_since = (SELECT deferred_since FROM bak_20261102_park_stale_deferral_100629 WHERE class = 'issue-100629'), next_due_at = (SELECT next_due_at FROM bak_20261102_park_stale_deferral_100629 WHERE class = 'issue-100629') WHERE class = 'issue-100629' AND status = 'parked' AND EXISTS (SELECT 1 FROM bak_20261102_park_stale_deferral_100629 WHERE class = 'issue-100629'); DROP TABLE IF EXISTS bak_20261102_park_stale_deferral_100629
--
-- The issue-100629 probe measures the size of the research queue, although its target issue is
-- closed. Park only that stale contract; the issue-1001219 closeout probe observes this status.

CREATE TABLE IF NOT EXISTS bak_20261102_park_stale_deferral_100629 AS
SELECT class, status, deferred_since, next_due_at
FROM remediation_contracts
WHERE class = 'issue-100629'
  AND issue_id = 100629
  AND status = 'active'
  AND deferred_since IS NOT NULL
  AND last_verdict LIKE 'deferred%'
  AND instr(verify_probe, 'research_queue') > 0
  AND EXISTS (
    SELECT 1 FROM agent_issues
    WHERE id = 100629 AND status IN ('closed', 'resolved')
  );

INSERT INTO decision_log (
  actor, assumption, action, evidence, outcome, blast_radius, rollback_path,
  capability_gain, predicted_outcome, reach_gain, surfaces_tested
)
SELECT
  'Copilot PR 6316',
  'A deferred contract for a closed issue should not keep waiting on a queue-size condition unrelated to that issue.',
  'VERIFICATION-DEFERRED-7D-1 park stale issue-100629 contract and clear its deferral markers',
  'Live qnfo-audit read on 2026-11-02: agent_issues.id=100629 is closed; its active issue-100629 contract remains deferred and probes research_queue queued count; the issue-1001219 contract reads pending only while issue-100629 remains active and deferred.',
  'Park the stale contract; its escalation issue closeout probe can now clear on its next pass.',
  'qnfo-audit.remediation_contracts class issue-100629',
  'Restore status, deferred_since, and next_due_at from bak_20261102_park_stale_deferral_100629; retain this append-only decision record.',
  'stale-deferred-contract-parked',
  'One active seven-day deferral is removed; issue-1001219 reads cleared on its next pass; the research queue count is unchanged.',
  'One stale deferral no longer blocks verification closeout.',
  'migration replay test; issue-1001219 closeout probe predicate'
WHERE EXISTS (SELECT 1 FROM bak_20261102_park_stale_deferral_100629 WHERE class = 'issue-100629')
  AND NOT EXISTS (
    SELECT 1 FROM decision_log
    WHERE action = 'VERIFICATION-DEFERRED-7D-1 park stale issue-100629 contract and clear its deferral markers'
  );

UPDATE remediation_contracts
SET status = 'parked', deferred_since = NULL, next_due_at = NULL
WHERE class = 'issue-100629'
  AND issue_id = 100629
  AND status = 'active'
  AND deferred_since IS NOT NULL
  AND last_verdict LIKE 'deferred%'
  AND instr(verify_probe, 'research_queue') > 0
  AND EXISTS (
    SELECT 1 FROM agent_issues
    WHERE id = 100629 AND status IN ('closed', 'resolved')
  );
