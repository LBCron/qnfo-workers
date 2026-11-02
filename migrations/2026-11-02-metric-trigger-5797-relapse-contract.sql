-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261102_metric_trigger_5797_relapse
-- Rollback: UPDATE remediation_contracts SET status = (SELECT status FROM bak_20261102_metric_trigger_5797_relapse WHERE class = 'metric-relapse-2546'), last_verdict = (SELECT last_verdict FROM bak_20261102_metric_trigger_5797_relapse WHERE class = 'metric-relapse-2546') WHERE class = 'metric-relapse-2546' AND EXISTS (SELECT 1 FROM bak_20261102_metric_trigger_5797_relapse WHERE class = 'metric-relapse-2546')
--
-- METRIC-TRIGGER-5797-RELAPSE-CONTRACT-1 (issue 2546, charter pillar autonomy).
-- The live metric is clear, and issue-2546 is already monitored by the metric-trigger
-- recovery probe. A second active metric-relapse-2546 contract counts every positive
-- metric_history value after 2026-10-18, so the historical relapse keeps failing after
-- recovery and can reopen the issue after max_attempts. Supersede only that stale
-- contract when the primary recovery contract and its live trigger remain available.
-- Leave the issue open; TRIGGER-RECOVERY-1 still requires a clean 60-minute streak.

CREATE TABLE IF NOT EXISTS bak_20261102_metric_trigger_5797_relapse AS
SELECT class, status, last_verdict
FROM remediation_contracts
WHERE class = 'metric-relapse-2546' AND issue_id = 2546;

UPDATE remediation_contracts
SET status = 'superseded',
    last_verdict = 'superseded:METRIC-TRIGGER-5797-RELAPSE-CONTRACT-1; issue-2546 recovery probe is authoritative'
WHERE class = 'metric-relapse-2546'
  AND issue_id = 2546
  AND status IN ('active', 'holding')
  AND last_verdict = 'fail'
  AND attempts >= max_attempts
  AND instr(verify_probe, 'FROM metric_history WHERE metric = ''contracts_unexecutable_open''') > 0
  AND EXISTS (
    SELECT 1
    FROM agent_issues a
    JOIN analytics_metric_triggers t ON t.id = 5797
      AND t.metric_key = 'contracts_unexecutable_open'
      AND t.enabled = 1
      AND t.operator = 'gt'
      AND t.threshold = 0
    JOIN v_metric_trigger_state s ON s.id = t.id
      AND s.metric_key = t.metric_key
      AND s.val IS NOT NULL
    JOIN remediation_contracts primary_contract ON primary_contract.class = 'issue-2546'
      AND primary_contract.issue_id = a.id
      AND primary_contract.status = 'monitoring'
      AND primary_contract.module = 'probe-template-v1h'
      AND primary_contract.last_verdict LIKE 'monitoring:metric-condition%'
      AND instr(primary_contract.verify_probe, 'FROM v_metric_trigger_state WHERE id = 5797') > 0
    WHERE a.id = 2546
      AND a.status = 'open'
      AND a.title LIKE 'METRIC-TRIGGER-5797-CONTRACTS-UNEXECUTABLE-OPEN:%'
  );

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'qnfo-fleet-control (issue 2546 remediation)',
       'the open metric-trigger issue must close on its current trigger-recovery condition; historical breach rows are not a continuing failure after the trigger clears',
       'METRIC-TRIGGER-5797-RELAPSE-CONTRACT-1: supersede the stale metric-relapse-2546 contract and preserve issue-2546 trigger recovery',
       'trigger 5797 is enabled and has a readable current metric; issue-2546 is open with its metric-condition recovery probe; metric-relapse-2546 failed at or beyond max_attempts on historical contracts_unexecutable_open rows',
       'only the stale relapse contract is superseded; issue 2546 remains open for its existing 60-minute trigger-recovery path',
       'issue 2546 contract metric-relapse-2546 only',
       'restore metric-relapse-2546 status and last_verdict from bak_20261102_metric_trigger_5797_relapse; decision history remains append-only',
       'the metric issue no longer remains open indefinitely because of pre-recovery history',
       'metric-relapse-2546 stops producing failures from historical rows; issue 2546 closes only after its current metric stays clear for the existing recovery window',
       'none',
       'D1: agent_issues 2546, analytics_metric_triggers 5797, v_metric_trigger_state 5797, both issue contracts; SQLite migration regression test'
WHERE EXISTS (
  SELECT 1 FROM remediation_contracts
  WHERE class = 'metric-relapse-2546'
    AND issue_id = 2546
    AND status = 'superseded'
    AND last_verdict LIKE 'superseded:METRIC-TRIGGER-5797-RELAPSE-CONTRACT-1%'
)
AND NOT EXISTS (
  SELECT 1 FROM decision_log
  WHERE action = 'METRIC-TRIGGER-5797-RELAPSE-CONTRACT-1: supersede the stale metric-relapse-2546 contract and preserve issue-2546 trigger recovery'
);
