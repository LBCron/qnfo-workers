-- RUNTIME-PROBE-BUDGET-1 (issue 2081 / GitHub #2524; charter pillar autonomy).
-- Six of the last ten consumer runs exhausted their budget on 2026-11-02.
-- Due runner-https probes now precede the non-runtime backlog without changing cadence or transport trust.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE remediation_contracts SET status = 'superseded', next_due_at = '2026-10-21 13:44:12' WHERE class = 'issue-2081' AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 2081 AND status = 'open'); DELETE FROM remediation_contracts WHERE class = 'fm-runtime-probe-budget'; DELETE FROM failure_modes WHERE fm_key = 'runtime-probe-budget'

INSERT OR IGNORE INTO failure_modes
  (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id,
   trigger_condition, symptom, blast_radius)
VALUES
  ('runtime-probe-budget', 'due independent runtime probes wait behind non-runtime verification backlogs',
   'the consumer shares a bounded oldest-first queue across SQL, code-read and runner-https contracts',
   'RUNTIME-PROBE-BUDGET-1: select due runner-https contracts first, oldest first within each transport group',
   'fm-runtime-probe-budget checks the consumer due-query ordering', 'fm-runtime-probe-budget',
   '2026-11-02', 2081, 'consumer runs exhaust their budget while runtime contracts remain due',
   'runtime_verified_share_24h can breach despite an executing runner', 'independent runtime verification coverage');

INSERT OR IGNORE INTO remediation_contracts
  (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to,
   expected_cadence_h, status, module)
VALUES
  ('fm-runtime-probe-budget', NULL, 'RUNTIME-PROBE-BUDGET-1', 'failure-mode detector',
   '{"paths":["scripts/remediation_consumer.py"],"contains":"ORDER BY CASE WHEN verify_transport = ''runner-https'' THEN 0 ELSE 1 END,"}',
   'code-read', 3, 'qnfo-ops', 1, 'active', 'failure-mode');

-- The original metric probe was parked as carried-by-twin, but its issue is open and has no open carrying twin.
-- Reuse its actual runtime-share predicate; do not close the issue on a code-only detector.
UPDATE remediation_contracts
SET status = 'active', next_due_at = datetime('now')
WHERE class = 'issue-2081' AND issue_id = 2081 AND status = 'superseded'
  AND last_verdict = 'superseded:carried-by-twin'
  AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 2081 AND status = 'open')
  AND NOT EXISTS (
    SELECT 1 FROM agent_issues a JOIN remediation_contracts c ON c.issue_id = a.id
    WHERE a.status = 'open' AND a.id <> 2081 AND c.status IN ('active', 'holding')
      AND lower(trim(a.title)) = lower(trim((SELECT title FROM agent_issues WHERE id = 2081)))
  );

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain,
   predicted_outcome, reach_gain, surfaces_tested)
SELECT 'copilot:issue-2081',
  'independent runtime probes need budget before the non-runtime backlog; a superseded metric contract cannot verify recovery',
  'RUNTIME-PROBE-BUDGET-1: prioritize due runner-https probes and rearm the original metric contract if no twin carries it',
  '2026-11-02: runtime_verified_share_24h=10.5; 3249 runner-https rows in 24h; six of ten recent runs budget-exhausted; issue-2081 superseded:carried-by-twin with no open twin',
  'branch regression passes; post-merge metric recovery is not yet verified',
  'remediation consumer due ordering and issue-2081 verification',
  'revert the consumer ordering and execute this migration rollback; preserve this append-only decision',
  'due runtime observations precede SQL backlog within the existing budget; recovery uses the existing measured-share probe',
  'due runtime probes run before non-runtime probes in budget-limited runs; runtime_verified_share_24h stays at or above 10',
  'no direct reach gain; independent verification coverage improves',
  'offline real-SQL ordering, transport/status/due exclusions, existing consumer regression suites, migration rerun and rollback'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action =
  'RUNTIME-PROBE-BUDGET-1: prioritize due runner-https probes and rearm the original metric contract if no twin carries it');
