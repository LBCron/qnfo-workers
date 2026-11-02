-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261102_metric_trigger_5796_superseded
-- Rollback: UPDATE remediation_contracts SET status = (SELECT contract_status FROM bak_20261102_metric_trigger_5796_superseded WHERE kind = 'contract' AND record_key = class), last_verdict = (SELECT last_verdict FROM bak_20261102_metric_trigger_5796_superseded WHERE kind = 'contract' AND record_key = class) WHERE class IN ('issue-2544', 'metric-relapse-2544') AND EXISTS (SELECT 1 FROM bak_20261102_metric_trigger_5796_superseded WHERE kind = 'contract' AND record_key = class); UPDATE issue_triage SET rc = (SELECT triage_rc FROM bak_20261102_metric_trigger_5796_superseded WHERE kind = 'triage' AND record_key = CAST(issue_id AS TEXT)), triage_state = (SELECT triage_state FROM bak_20261102_metric_trigger_5796_superseded WHERE kind = 'triage' AND record_key = CAST(issue_id AS TEXT)), owner = (SELECT triage_owner FROM bak_20261102_metric_trigger_5796_superseded WHERE kind = 'triage' AND record_key = CAST(issue_id AS TEXT)), close_evidence = (SELECT close_evidence FROM bak_20261102_metric_trigger_5796_superseded WHERE kind = 'triage' AND record_key = CAST(issue_id AS TEXT)) WHERE issue_id = 2544 AND EXISTS (SELECT 1 FROM bak_20261102_metric_trigger_5796_superseded WHERE kind = 'triage' AND record_key = CAST(issue_id AS TEXT)); UPDATE agent_issues SET status = (SELECT issue_status FROM bak_20261102_metric_trigger_5796_superseded WHERE kind = 'issue' AND record_key = CAST(id AS TEXT)), close_channel = (SELECT issue_close_channel FROM bak_20261102_metric_trigger_5796_superseded WHERE kind = 'issue' AND record_key = CAST(id AS TEXT)), updated_at = (SELECT issue_updated_at FROM bak_20261102_metric_trigger_5796_superseded WHERE kind = 'issue' AND record_key = CAST(id AS TEXT)) WHERE id = 2544 AND EXISTS (SELECT 1 FROM bak_20261102_metric_trigger_5796_superseded WHERE kind = 'issue' AND record_key = CAST(id AS TEXT))
--
-- METRIC-TRIGGER-5796-RELAPSE-CONTRACT-1 (issue 2544, charter pillar autonomy).
-- Its primary and relapse probes continue counting the disabled 24-hour metric.
-- Retire those stale contracts only when the disabled 120-minute duplicate is
-- demonstrably carried by its enabled successor trigger and open issue.

CREATE TABLE IF NOT EXISTS bak_20261102_metric_trigger_5796_superseded AS
SELECT 'issue' AS kind, CAST(a.id AS TEXT) AS record_key, a.id AS issue_id,
       a.status AS issue_status, a.close_channel AS issue_close_channel, a.updated_at AS issue_updated_at,
       NULL AS contract_status, NULL AS last_verdict, NULL AS triage_rc,
       NULL AS triage_state, NULL AS triage_owner, NULL AS close_evidence
FROM agent_issues a
WHERE a.id = 2544
UNION ALL
SELECT 'triage', CAST(t.issue_id AS TEXT), t.issue_id,
       NULL, NULL, NULL, NULL, NULL, t.rc, t.triage_state, t.owner, t.close_evidence
FROM issue_triage t
WHERE t.issue_id = 2544
UNION ALL
SELECT 'contract', c.class, c.issue_id,
       NULL, NULL, NULL, c.status, c.last_verdict, NULL, NULL, NULL, NULL
FROM remediation_contracts c
WHERE c.issue_id = 2544 AND c.class IN ('issue-2544', 'metric-relapse-2544');

UPDATE remediation_contracts
SET status = 'superseded',
    last_verdict = 'superseded:METRIC-TRIGGER-5796-RELAPSE-CONTRACT-1 by issue 100301'
WHERE issue_id = 2544
  AND class IN ('issue-2544', 'metric-relapse-2544')
  AND status IN ('active', 'holding', 'escalated')
  AND (
    (class = 'issue-2544' AND instr(verify_probe, '86400') > 0
      AND instr(verify_probe, 'FROM agent_issues a') > 0
      AND instr(verify_probe, 'code_tasks') > 0)
    OR
    (class = 'metric-relapse-2544'
      AND instr(verify_probe, 'metric = ''open_issues_without_doer_24h''') > 0)
  )
  AND (
    SELECT COUNT(*) FROM remediation_contracts c
    WHERE c.issue_id = 2544
      AND c.status IN ('active', 'holding', 'escalated')
      AND (
        (c.class = 'issue-2544' AND instr(c.verify_probe, '86400') > 0
          AND instr(c.verify_probe, 'FROM agent_issues a') > 0
          AND instr(c.verify_probe, 'code_tasks') > 0)
        OR
        (c.class = 'metric-relapse-2544'
          AND instr(c.verify_probe, 'metric = ''open_issues_without_doer_24h''') > 0)
      )
  ) = 2
  AND NOT EXISTS (
    SELECT 1 FROM remediation_contracts other
    WHERE other.issue_id = 2544
      AND other.class NOT IN ('issue-2544', 'metric-relapse-2544')
      AND other.status IN ('active', 'holding', 'escalated')
      AND COALESCE(other.last_verdict, '') LIKE 'fail%'
  )
  AND EXISTS (
    SELECT 1
    FROM agent_issues source
    JOIN issue_triage triage ON triage.issue_id = source.id
      AND triage.triage_state NOT IN ('closed', 'closed-refuted', 'wontfix')
    JOIN analytics_metric_triggers old24 ON old24.id = 5796
      AND old24.metric_key = 'open_issues_without_doer_24h' AND old24.enabled = 0
    JOIN metric_registry old24_metric ON old24_metric.metric = old24.metric_key
      AND instr(old24_metric.target, 'superseded by open_issues_without_doer_120m') > 0
    JOIN analytics_metric_triggers old120 ON old120.id = 5944
      AND old120.metric_key = 'open_issues_without_doer_120m' AND old120.enabled = 0
    JOIN metric_registry old120_metric ON old120_metric.metric = old120.metric_key
      AND instr(old120_metric.target, 'superseded by issues_over_24h_no_doer') > 0
    JOIN metric_deps dependency ON dependency.child_metric = old120.metric_key
      AND dependency.parent_metric = 'issues_over_24h_no_doer'
      AND dependency.relation = 'disabled-duplicate' AND dependency.active = 1
    JOIN analytics_metric_triggers successor_trigger ON successor_trigger.id = 9901
      AND successor_trigger.metric_key = dependency.parent_metric AND successor_trigger.enabled = 1
    JOIN agent_issues successor ON successor.id = 100301
      AND successor.title LIKE 'METRIC-TRIGGER-9901-%' AND successor.status = 'open'
      AND (CASE successor.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END)
        <= (CASE source.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END)
    WHERE source.id = 2544
      AND source.title LIKE 'METRIC-TRIGGER-5796-%'
      AND source.status = 'open'
  );

UPDATE issue_triage
SET rc = 'METRIC-TRIGGER-5796-SUPERSEDED-1',
    triage_state = 'closed',
    owner = 'qnfo-fleet-control',
    close_evidence = 'SUPERSEDED BY #100301: trigger 5796 is disabled; trigger 5944 is disabled and its active disabled-duplicate relation maps open_issues_without_doer_120m to enabled trigger 9901 (issues_over_24h_no_doer). Issue 100301 is open at equal critical priority. Contracts issue-2544 and metric-relapse-2544 measured obsolete conditions.'
WHERE issue_id = 2544
  AND triage_state NOT IN ('closed', 'closed-refuted', 'wontfix')
  AND EXISTS (
    SELECT 1 FROM remediation_contracts c
    WHERE c.issue_id = 2544 AND c.class IN ('issue-2544', 'metric-relapse-2544')
      AND c.status = 'superseded'
      AND c.last_verdict = 'superseded:METRIC-TRIGGER-5796-RELAPSE-CONTRACT-1 by issue 100301'
  )
  AND (SELECT COUNT(*) FROM remediation_contracts c
       WHERE c.issue_id = 2544 AND c.class IN ('issue-2544', 'metric-relapse-2544')
         AND c.status = 'superseded') = 2;

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'qnfo-fleet-control (issue 2544 remediation)',
       'issue 2544 is superseded only when its disabled metric chain is carried by a live, equally urgent successor',
       'METRIC-TRIGGER-5796-RELAPSE-CONTRACT-1: supersede issue 2544 and its stale contracts with active issue 100301',
       'trigger 5796 and trigger 5944 are disabled; metric_registry marks each superseded; active metric_deps maps 5944 to enabled trigger 9901; issue 100301 is open at equal critical priority; both issue-2544 contracts match the old metric probes',
       'issue 2544 closes with explicit supersession evidence and cannot reopen from historical failures of the disabled metric; issue 100301 remains open',
       'issue 2544, its two obsolete remediation contracts, and their triage row only',
       'restore issue, triage, and contract state from bak_20261102_metric_trigger_5796_superseded; decision history remains append-only',
       'a superseded metric issue no longer reopens on historical breaches when an active successor carries the same issue meaning',
       'metric-relapse-2544 remains superseded and issue 2544 remains closed after subsequent historical metric failures; active issue 100301 retains the issue-without-doer remediation',
       'none',
       'live D1 reads of issues 2544/100301, triggers 5796/5944/9901, metric_registry, metric_deps and contracts; SQLite migration regression test'
WHERE EXISTS (
  SELECT 1 FROM issue_triage
  WHERE issue_id = 2544 AND rc = 'METRIC-TRIGGER-5796-SUPERSEDED-1'
    AND triage_state = 'closed'
    AND close_evidence LIKE 'SUPERSEDED BY #100301:%'
)
AND NOT EXISTS (
  SELECT 1 FROM decision_log
  WHERE action = 'METRIC-TRIGGER-5796-RELAPSE-CONTRACT-1: supersede issue 2544 and its stale contracts with active issue 100301'
);
