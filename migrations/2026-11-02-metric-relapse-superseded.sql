-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261102_metric_relapse_superseded
-- Rollback: UPDATE remediation_contracts SET status = (SELECT contract_status FROM bak_20261102_metric_relapse_superseded WHERE contract_class = 'metric-relapse-100225'), last_verdict = (SELECT contract_last_verdict FROM bak_20261102_metric_relapse_superseded WHERE contract_class = 'metric-relapse-100225') WHERE class = 'metric-relapse-100225' AND EXISTS (SELECT 1 FROM bak_20261102_metric_relapse_superseded WHERE contract_class = 'metric-relapse-100225'); UPDATE issue_triage SET rc = (SELECT triage_rc FROM bak_20261102_metric_relapse_superseded WHERE issue_id = 100225), triage_state = (SELECT triage_state FROM bak_20261102_metric_relapse_superseded WHERE issue_id = 100225), owner = (SELECT triage_owner FROM bak_20261102_metric_relapse_superseded WHERE issue_id = 100225), close_evidence = (SELECT close_evidence FROM bak_20261102_metric_relapse_superseded WHERE issue_id = 100225) WHERE issue_id = 100225 AND EXISTS (SELECT 1 FROM bak_20261102_metric_relapse_superseded WHERE issue_id = 100225); UPDATE agent_issues SET status = (SELECT issue_status FROM bak_20261102_metric_relapse_superseded WHERE issue_id = 100225), close_channel = (SELECT issue_close_channel FROM bak_20261102_metric_relapse_superseded WHERE issue_id = 100225), updated_at = (SELECT issue_updated_at FROM bak_20261102_metric_relapse_superseded WHERE issue_id = 100225) WHERE id = 100225 AND EXISTS (SELECT 1 FROM bak_20261102_metric_relapse_superseded WHERE issue_id = 100225);
-- METRIC-RELAPSE-SUPERSEDED-1 (issue 100225, charter pillar cost): the relapse probe
-- keeps counting breaches of metric 409 after it was disabled as a duplicate of the
-- enabled all-billing trigger 3689. Retire that stale contract and restore the
-- evidence-backed supersession to open issue 99938; the parent keeps the spend work.
CREATE TABLE IF NOT EXISTS bak_20261102_metric_relapse_superseded AS
SELECT a.id AS issue_id, a.status AS issue_status, a.close_channel AS issue_close_channel,
       a.updated_at AS issue_updated_at, t.rc AS triage_rc, t.triage_state, t.owner AS triage_owner,
       t.close_evidence, c.class AS contract_class, c.status AS contract_status,
       c.last_verdict AS contract_last_verdict
FROM agent_issues a
JOIN issue_triage t ON t.issue_id = a.id
JOIN remediation_contracts c ON c.issue_id = a.id
WHERE a.id = 100225 AND c.class = 'metric-relapse-100225';

UPDATE remediation_contracts
SET status = 'superseded',
    last_verdict = 'superseded:METRIC-RELAPSE-SUPERSEDED-1 by issue 99938'
WHERE class = 'metric-relapse-100225'
  AND issue_id = 100225
  AND status IN ('active', 'holding')
  AND instr(verify_probe, 'metric_history WHERE metric = ''fleet_ai_run_rate_30d_usd''') > 0
  AND EXISTS (
    SELECT 1
    FROM agent_issues a
    JOIN analytics_metric_triggers child ON child.id = 409
      AND child.metric_key = 'fleet_ai_run_rate_30d_usd' AND child.enabled = 0
    JOIN metric_deps d ON d.child_metric = child.metric_key
      AND d.parent_metric = 'monthly_cost_run_rate_usd'
      AND d.relation = 'disabled-duplicate' AND d.active = 1
    JOIN analytics_metric_triggers parent ON parent.id = 3689
      AND parent.metric_key = d.parent_metric AND parent.enabled = 1
    JOIN agent_issues successor ON successor.id = 99938 AND successor.status = 'open'
      AND successor.title LIKE 'METRIC-TRIGGER-3689-%'
      AND (CASE successor.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END)
        <= (CASE a.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END)
    WHERE a.id = 100225 AND a.status = 'open' AND a.title LIKE 'METRIC-TRIGGER-409-%'
      AND NOT EXISTS (
        SELECT 1 FROM work_claims w
        WHERE (w.issue_id = 100225 OR w.path = 'issue:100225')
          AND w.released_at IS NULL AND w.expires_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
      )
  )
  AND NOT EXISTS (
    SELECT 1 FROM remediation_contracts other
    WHERE other.issue_id = 100225 AND other.class <> 'metric-relapse-100225'
      AND other.status IN ('active', 'holding')
      AND COALESCE(other.last_verdict, '') IN
        ('fail', 'vacuous-probe-result', 'probe-error', 'probe-not-machine-executable', 'probe-same-account-host')
  );

UPDATE issue_triage
SET rc = 'breach-doctor:MD-6:metric-relapse-superseded',
    triage_state = 'closed',
    owner = 'breach-doctor',
    close_evidence = 'SUPERSEDED BY #99938: trigger 409 is disabled and metric_deps disabled-duplicate maps fleet_ai_run_rate_30d_usd to monthly_cost_run_rate_usd; enabled trigger 3689 and open issue #99938 carry the all-billing cost work. The old relapse contract counted historical breaches of the disabled child metric.'
WHERE issue_id = 100225
  AND EXISTS (
    SELECT 1 FROM remediation_contracts c
    WHERE c.class = 'metric-relapse-100225' AND c.issue_id = 100225
      AND c.status = 'superseded'
      AND c.last_verdict = 'superseded:METRIC-RELAPSE-SUPERSEDED-1 by issue 99938'
  )
  AND EXISTS (
    SELECT 1 FROM agent_issues a
    JOIN analytics_metric_triggers child ON child.id = 409
      AND child.metric_key = 'fleet_ai_run_rate_30d_usd' AND child.enabled = 0
    JOIN metric_deps d ON d.child_metric = child.metric_key
      AND d.parent_metric = 'monthly_cost_run_rate_usd'
      AND d.relation = 'disabled-duplicate' AND d.active = 1
    JOIN analytics_metric_triggers parent ON parent.id = 3689
      AND parent.metric_key = d.parent_metric AND parent.enabled = 1
    JOIN agent_issues successor ON successor.id = 99938 AND successor.status = 'open'
      AND successor.title LIKE 'METRIC-TRIGGER-3689-%'
      AND (CASE successor.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END)
        <= (CASE a.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END)
    WHERE a.id = 100225 AND a.status = 'open' AND a.title LIKE 'METRIC-TRIGGER-409-%'
      AND NOT EXISTS (
        SELECT 1 FROM work_claims w
        WHERE (w.issue_id = 100225 OR w.path = 'issue:100225')
          AND w.released_at IS NULL AND w.expires_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
      )
  )
  AND NOT EXISTS (
    SELECT 1 FROM remediation_contracts other
    WHERE other.issue_id = 100225 AND other.class <> 'metric-relapse-100225'
      AND other.status IN ('active', 'holding')
      AND COALESCE(other.last_verdict, '') IN
        ('fail', 'vacuous-probe-result', 'probe-error', 'probe-not-machine-executable', 'probe-same-account-host')
  );

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'qnfo-fleet-control (issue 100225 remediation)',
       'metric 409 is a disabled duplicate of the enabled all-billing trigger 3689; its relapse probe therefore cannot be the success criterion for issue 100225',
       'METRIC-RELAPSE-SUPERSEDED-1: supersede the stale relapse contract and close issue 100225 to its active parent issue 99938',
       'D1: trigger 409 disabled; active disabled-duplicate relation points to monthly_cost_run_rate_usd; trigger 3689 enabled; issue 99938 open and at least as urgent; metric-relapse-100225 failed four times on historical child-metric breaches',
       'issue 100225 carries explicit supersession evidence and its stale relapse contract no longer reopens it; issue 99938 retains the active all-billing cost work',
       'issue 100225 triage and metric-relapse-100225 only',
       'Rollback restores issue, triage, and contract values from bak_20261102_metric_relapse_superseded; decision history remains append-only',
       'a superseded metric issue can no longer be reopened by a contract that measures its disabled child metric',
       'metric-relapse-100225 reopen count stays at zero after three subsequent child-metric breach probes; successor 99938 remains open',
       'no external reach change',
       'D1 disabled-trigger/dependency/parent/issue reads; migration regression test including relapse trigger and rollback'
WHERE EXISTS (
  SELECT 1 FROM issue_triage
  WHERE issue_id = 100225 AND rc = 'breach-doctor:MD-6:metric-relapse-superseded'
    AND close_evidence LIKE 'SUPERSEDED BY #99938:%'
)
AND NOT EXISTS (
  SELECT 1 FROM decision_log
  WHERE action = 'METRIC-RELAPSE-SUPERSEDED-1: supersede the stale relapse contract and close issue 100225 to its active parent issue 99938'
);
