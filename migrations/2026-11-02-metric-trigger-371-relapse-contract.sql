-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261102_metric_trigger_371_relapse
-- Rollback: UPDATE remediation_contracts SET status = (SELECT status FROM bak_20261102_metric_trigger_371_relapse WHERE class = 'metric-relapse-2244'), last_verdict = (SELECT last_verdict FROM bak_20261102_metric_trigger_371_relapse WHERE class = 'metric-relapse-2244') WHERE class = 'metric-relapse-2244' AND status = 'superseded' AND last_verdict = 'superseded:METRIC-TRIGGER-371-RELAPSE-CONTRACT-1; issue-2244 recovery probe is authoritative' AND EXISTS (SELECT 1 FROM bak_20261102_metric_trigger_371_relapse WHERE class = 'metric-relapse-2244')
--
-- METRIC-TRIGGER-371-RELAPSE-CONTRACT-1 (issue 2244, charter pillar autonomy).
-- Its relapse contract counts any historical sub-threshold day after 2026-10-19,
-- so it continues failing after trigger 371 has recovered and can reopen issue
-- 2244 indefinitely. Supersede only that exhausted historical probe while the
-- trigger is currently clear and issue-2244's metric-recovery contract remains
-- in monitoring. Leave the issue open for the existing 60-minute recovery path.

CREATE TABLE IF NOT EXISTS bak_20261102_metric_trigger_371_relapse AS
SELECT class, status, last_verdict
FROM remediation_contracts
WHERE class = 'metric-relapse-2244' AND issue_id = 2244;

UPDATE remediation_contracts
SET status = 'superseded',
    last_verdict = 'superseded:METRIC-TRIGGER-371-RELAPSE-CONTRACT-1; issue-2244 recovery probe is authoritative'
WHERE class = 'metric-relapse-2244'
  AND issue_id = 2244
  AND status IN ('active', 'holding')
  AND last_verdict = 'fail'
  AND attempts >= max_attempts
  AND instr(verify_probe, 'FROM metric_history WHERE metric = ''remedy_efficacy_30d''') > 0
  AND instr(verify_probe, 'day > ''2026-10-19''') > 0
  AND instr(verify_probe, 'value < 0.5') > 0
  AND EXISTS (
    SELECT 1
    FROM agent_issues a
    JOIN analytics_metric_triggers t ON t.id = 371
      AND t.metric_key = 'remedy_efficacy_30d'
      AND t.enabled = 1
      AND t.operator = 'lt'
      AND t.threshold = 0.5
    JOIN v_metric_trigger_state s ON s.id = t.id
      AND s.metric_key = t.metric_key
      AND s.val IS NOT NULL
      AND s.hit = 0
    JOIN remediation_contracts primary_contract ON primary_contract.class = 'issue-2244'
      AND primary_contract.issue_id = a.id
      AND primary_contract.status = 'monitoring'
      AND primary_contract.module = 'probe-template-v1h'
      AND primary_contract.last_verdict LIKE 'monitoring:metric-condition%'
      AND instr(primary_contract.verify_probe, 'metric=''remedy_efficacy_30d''') > 0
      AND instr(primary_contract.verify_probe, 'REMEDY-EFFICACY-PER-TRIGGER-1') > 0
    WHERE a.id = 2244
      AND a.status = 'open'
      AND a.title LIKE 'METRIC-TRIGGER-371-REMEDY-EFFICACY-30D:%'
  );

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'qnfo-fleet-control (issue 2244 remediation)',
       'the open metric-trigger issue must close on its current trigger-recovery condition; historical breach rows are not a continuing failure after the trigger clears',
       'METRIC-TRIGGER-371-RELAPSE-CONTRACT-1: supersede the stale metric-relapse-2244 contract and preserve issue-2244 trigger recovery',
       'qnfo-audit: trigger 371 is enabled and clear at 0.65; metric history is below threshold only on 2026-10-23 (0.48) and is clear from 2026-10-24 through 2026-11-02; issue 2244 is open with its metric-condition recovery contract; metric-relapse-2244 failed 10 times on the historical window',
       'only the stale relapse contract is superseded; issue 2244 remains open for its existing 60-minute trigger-recovery path',
       'issue 2244 contract metric-relapse-2244 only',
       'restore metric-relapse-2244 status and last_verdict from bak_20261102_metric_trigger_371_relapse; decision history remains append-only',
       'a recovered metric issue no longer remains open indefinitely because of pre-recovery history',
       'metric-relapse-2244 stops failing on historical sub-threshold days; issue 2244 closes only after its current metric stays clear for the existing recovery window',
       'no external reach change',
       'D1: agent_issues 2244, analytics_metric_triggers 371, v_metric_trigger_state 371, both issue contracts and metric_history; SQLite migration regression test'
WHERE EXISTS (
  SELECT 1 FROM remediation_contracts
  WHERE class = 'metric-relapse-2244'
    AND issue_id = 2244
    AND status = 'superseded'
    AND last_verdict LIKE 'superseded:METRIC-TRIGGER-371-RELAPSE-CONTRACT-1%'
)
AND NOT EXISTS (
  SELECT 1 FROM decision_log
  WHERE action = 'METRIC-TRIGGER-371-RELAPSE-CONTRACT-1: supersede the stale metric-relapse-2244 contract and preserve issue-2244 trigger recovery'
);
