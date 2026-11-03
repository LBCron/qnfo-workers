-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261102_metric_trigger_3062_relapse
-- Rollback: UPDATE remediation_contracts SET status = (SELECT issue_contract_status FROM bak_20261102_metric_trigger_3062_relapse WHERE issue_id = 2196), last_verdict = (SELECT issue_contract_last_verdict FROM bak_20261102_metric_trigger_3062_relapse WHERE issue_id = 2196) WHERE class = 'issue-2196' AND EXISTS (SELECT 1 FROM bak_20261102_metric_trigger_3062_relapse WHERE issue_id = 2196); UPDATE remediation_contracts SET status = (SELECT relapse_contract_status FROM bak_20261102_metric_trigger_3062_relapse WHERE issue_id = 2196), last_verdict = (SELECT relapse_contract_last_verdict FROM bak_20261102_metric_trigger_3062_relapse WHERE issue_id = 2196) WHERE class = 'metric-relapse-2196' AND EXISTS (SELECT 1 FROM bak_20261102_metric_trigger_3062_relapse WHERE issue_id = 2196); UPDATE issue_triage SET rc = (SELECT triage_rc FROM bak_20261102_metric_trigger_3062_relapse WHERE issue_id = 2196), triage_state = (SELECT triage_state FROM bak_20261102_metric_trigger_3062_relapse WHERE issue_id = 2196), owner = (SELECT triage_owner FROM bak_20261102_metric_trigger_3062_relapse WHERE issue_id = 2196), close_evidence = (SELECT triage_close_evidence FROM bak_20261102_metric_trigger_3062_relapse WHERE issue_id = 2196) WHERE issue_id = 2196 AND EXISTS (SELECT 1 FROM bak_20261102_metric_trigger_3062_relapse WHERE issue_id = 2196); UPDATE agent_issues SET status = (SELECT issue_status FROM bak_20261102_metric_trigger_3062_relapse WHERE issue_id = 2196), close_channel = (SELECT issue_close_channel FROM bak_20261102_metric_trigger_3062_relapse WHERE issue_id = 2196), updated_at = (SELECT issue_updated_at FROM bak_20261102_metric_trigger_3062_relapse WHERE issue_id = 2196) WHERE id = 2196 AND EXISTS (SELECT 1 FROM bak_20261102_metric_trigger_3062_relapse WHERE issue_id = 2196)
--
-- METRIC-TRIGGER-3062-RELAPSE-CONTRACT-1 (issue 2196, charter pillar autonomy).
-- The 24-hour trigger is superseded by SLA-120M-2, but the reopened issue still
-- has an active issue-2196 probe and an exhausted metric-relapse-2196 probe
-- over that retired signal. Close it only while the enabled 120-minute trigger
-- is breached and its current successor issue #1001231 remains open.

CREATE TABLE IF NOT EXISTS bak_20261102_metric_trigger_3062_relapse AS
SELECT a.id AS issue_id,
       a.status AS issue_status,
       a.close_channel AS issue_close_channel,
       a.updated_at AS issue_updated_at,
       t.rc AS triage_rc,
       t.triage_state,
       t.owner AS triage_owner,
       t.close_evidence AS triage_close_evidence,
       primary_contract.status AS issue_contract_status,
       primary_contract.last_verdict AS issue_contract_last_verdict,
       relapse_contract.status AS relapse_contract_status,
       relapse_contract.last_verdict AS relapse_contract_last_verdict
FROM agent_issues a
JOIN issue_triage t ON t.issue_id = a.id
JOIN remediation_contracts primary_contract ON primary_contract.issue_id = a.id AND primary_contract.class = 'issue-2196'
JOIN remediation_contracts relapse_contract ON relapse_contract.issue_id = a.id AND relapse_contract.class = 'metric-relapse-2196'
WHERE a.id = 2196;

UPDATE remediation_contracts
SET status = 'superseded',
    last_verdict = CASE class
      WHEN 'issue-2196' THEN 'superseded:METRIC-TRIGGER-3062-RELAPSE-CONTRACT-1; issue #1001231 owns the enabled 120-minute metric'
      ELSE 'superseded:METRIC-TRIGGER-3062-RELAPSE-CONTRACT-1; historical 24-hour metric is superseded by SLA-120M-2'
    END
WHERE issue_id = 2196
  AND (
    (class = 'issue-2196' AND status = 'active'
      AND instr(verify_probe, '86400000') > 0
      AND instr(verify_probe, 'status = ''open''') > 0)
    OR
    (class = 'metric-relapse-2196' AND status = 'escalated'
      AND attempts >= max_attempts
      AND instr(verify_probe, 'FROM metric_history WHERE metric = ''issues_open_over_24h''') > 0)
  )
  AND EXISTS (
    SELECT 1
    FROM agent_issues old_issue
    JOIN analytics_metric_triggers retired ON retired.id = 3062
      AND retired.metric_key = 'issues_open_over_24h' AND retired.enabled = 0
    JOIN metric_registry old_metric ON old_metric.metric = retired.metric_key
      AND instr(old_metric.target, '[superseded by issues_open_over_120m, SLA-120M-2]') > 0
    JOIN analytics_metric_triggers current_trigger ON current_trigger.id = 5937
      AND current_trigger.metric_key = 'issues_open_over_120m'
      AND current_trigger.enabled = 1 AND current_trigger.operator = 'gt'
    JOIN v_metric_trigger_state current_state ON current_state.id = current_trigger.id
      AND current_state.metric_key = current_trigger.metric_key
      AND current_state.hit = 1 AND current_state.val > current_trigger.threshold
    JOIN agent_issues successor ON successor.id = 1001231
      AND successor.status = 'open'
      AND successor.title LIKE 'METRIC-TRIGGER-5937-ISSUES-OPEN-OVER-120M:%'
    JOIN remediation_contracts recovery ON recovery.class = 'issue-1001231'
      AND recovery.issue_id = successor.id
      AND recovery.status = 'monitoring'
      AND recovery.last_verdict LIKE 'monitoring:metric-condition%'
      AND instr(recovery.verify_probe, 'v_metric_trigger_state WHERE id = 5937') > 0
    WHERE old_issue.id = 2196 AND old_issue.status = 'open'
      AND old_issue.title LIKE 'METRIC-TRIGGER-3062-ISSUES-OPEN-OVER-24H:%'
  );

UPDATE issue_triage
SET rc = 'SLA-DRAIN-2',
    triage_state = 'closed',
    owner = 'qnfo-fleet-control',
    close_evidence = 'superseded by #1001231 (METRIC-TRIGGER-5937): trigger 3062 and issues_open_over_24h are retired by SLA-120M-2; enabled trigger 5937 is currently breached and issue #1001231 has its metric-condition recovery contract. The issue-2196 and metric-relapse-2196 probes measure the retired 24-hour signal; the relapse contract exhausted its historical retries. Closed by migrations/2026-11-02-metric-trigger-3062-relapse-contract.sql.'
WHERE issue_id = 2196
  AND EXISTS (
    SELECT 1 FROM remediation_contracts c
    WHERE c.issue_id = 2196
      AND c.class = 'issue-2196'
      AND c.status = 'superseded'
      AND c.last_verdict LIKE 'superseded:METRIC-TRIGGER-3062-RELAPSE-CONTRACT-1%'
  )
  AND EXISTS (
    SELECT 1 FROM remediation_contracts c
    WHERE c.issue_id = 2196
      AND c.class = 'metric-relapse-2196'
      AND c.status = 'superseded'
      AND c.last_verdict LIKE 'superseded:METRIC-TRIGGER-3062-RELAPSE-CONTRACT-1%'
  )
  AND EXISTS (
    SELECT 1
    FROM analytics_metric_triggers retired
    JOIN metric_registry old_metric ON old_metric.metric = retired.metric_key
      AND instr(old_metric.target, '[superseded by issues_open_over_120m, SLA-120M-2]') > 0
    JOIN analytics_metric_triggers current_trigger ON current_trigger.id = 5937
      AND current_trigger.metric_key = 'issues_open_over_120m'
      AND current_trigger.enabled = 1 AND current_trigger.operator = 'gt'
    JOIN v_metric_trigger_state current_state ON current_state.id = current_trigger.id
      AND current_state.metric_key = current_trigger.metric_key
      AND current_state.hit = 1 AND current_state.val > current_trigger.threshold
    JOIN agent_issues successor ON successor.id = 1001231
      AND successor.status = 'open'
      AND successor.title LIKE 'METRIC-TRIGGER-5937-ISSUES-OPEN-OVER-120M:%'
    JOIN remediation_contracts recovery ON recovery.class = 'issue-1001231'
      AND recovery.issue_id = successor.id
      AND recovery.status = 'monitoring'
      AND recovery.last_verdict LIKE 'monitoring:metric-condition%'
      AND instr(recovery.verify_probe, 'v_metric_trigger_state WHERE id = 5937') > 0
    WHERE retired.id = 3062
      AND retired.metric_key = 'issues_open_over_24h'
      AND retired.enabled = 0
  );

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'qnfo-fleet-control (issue 2196 remediation)',
       'the 24-hour issue-age signal was retired by SLA-120M-2, while the enabled 120-minute successor remains breached and has an open issue',
       'METRIC-TRIGGER-3062-RELAPSE-CONTRACT-1: supersede issue 2196 and its stale contracts in favor of issue 1001231',
       'qnfo-audit: trigger 3062 disabled and metric target names issues_open_over_120m; trigger 5937 is enabled with 280 issues over its threshold 215; issue 1001231 is open with a metric-condition contract; issue 2196 relapse contract exhausted 17 attempts on historical issues_open_over_24h',
       'issue 2196 closes with supersession evidence; its two retired-signal contracts are superseded; issue 1001231 remains open for the current breach',
       'issue 2196 triage and contracts issue-2196 and metric-relapse-2196 only',
       'restore issue, triage and contract values from bak_20261102_metric_trigger_3062_relapse; decision history remains append-only',
       'a superseded metric issue can no longer be reopened by probes over the retired 24-hour signal',
       'issue 2196 remains closed after three further stale-probe failures; issues_open_over_120m falls from 280 to 279 at the next refresh and issue 1001231 remains open',
       'no external reach change',
       'D1 trigger/metric/successor/contract reads; SQLite migration regression test including reopen trigger, blocked preconditions, idempotency and rollback'
WHERE EXISTS (
  SELECT 1 FROM issue_triage
  WHERE issue_id = 2196
    AND triage_state = 'closed'
    AND close_evidence LIKE 'superseded by #1001231 (METRIC-TRIGGER-5937):%'
)
AND NOT EXISTS (
  SELECT 1 FROM decision_log
  WHERE action = 'METRIC-TRIGGER-3062-RELAPSE-CONTRACT-1: supersede issue 2196 and its stale contracts in favor of issue 1001231'
);
