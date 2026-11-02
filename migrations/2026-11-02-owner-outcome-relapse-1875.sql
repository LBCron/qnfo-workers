-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261102_owner_outcome_relapse_1875
-- Rollback: UPDATE issue_triage SET rc = (SELECT triage_rc FROM bak_20261102_owner_outcome_relapse_1875 WHERE issue_id = 1875 LIMIT 1), triage_state = (SELECT triage_state FROM bak_20261102_owner_outcome_relapse_1875 WHERE issue_id = 1875 LIMIT 1), owner = (SELECT triage_owner FROM bak_20261102_owner_outcome_relapse_1875 WHERE issue_id = 1875 LIMIT 1), close_evidence = (SELECT triage_close_evidence FROM bak_20261102_owner_outcome_relapse_1875 WHERE issue_id = 1875 LIMIT 1), triaged_at = (SELECT triage_triaged_at FROM bak_20261102_owner_outcome_relapse_1875 WHERE issue_id = 1875 LIMIT 1) WHERE issue_id = 1875 AND triage_state = 'closed' AND close_evidence LIKE 'SUPERSEDED BY goals:OWNER-OUTCOME-REACH-1%'; UPDATE agent_issues SET status = (SELECT issue_status FROM bak_20261102_owner_outcome_relapse_1875 WHERE issue_id = 1875 LIMIT 1), close_channel = (SELECT issue_close_channel FROM bak_20261102_owner_outcome_relapse_1875 WHERE issue_id = 1875 LIMIT 1), updated_at = (SELECT issue_updated_at FROM bak_20261102_owner_outcome_relapse_1875 WHERE issue_id = 1875 LIMIT 1) WHERE id = 1875 AND status = 'closed' AND close_channel = 'auto:triage-sync:qnfo-fleet-control' AND EXISTS (SELECT 1 FROM bak_20261102_owner_outcome_relapse_1875 WHERE issue_id = 1875); UPDATE remediation_contracts SET status = (SELECT contract_status FROM bak_20261102_owner_outcome_relapse_1875 WHERE contract_class = remediation_contracts.class), last_verdict = (SELECT contract_last_verdict FROM bak_20261102_owner_outcome_relapse_1875 WHERE contract_class = remediation_contracts.class), last_attempt_at = (SELECT contract_last_attempt_at FROM bak_20261102_owner_outcome_relapse_1875 WHERE contract_class = remediation_contracts.class) WHERE class IN ('issue-1875', 'metric-relapse-1875') AND status = 'superseded' AND last_verdict = 'superseded:OWNER-OUTCOME-RELAPSE-SUPERSEDE-1 by goal 74';

CREATE TABLE IF NOT EXISTS bak_20261102_owner_outcome_relapse_1875 (
  issue_id INTEGER NOT NULL,
  contract_class TEXT NOT NULL,
  issue_status TEXT,
  issue_close_channel TEXT,
  issue_updated_at INTEGER,
  triage_rc TEXT,
  triage_state TEXT,
  triage_owner TEXT,
  triage_close_evidence TEXT,
  triage_triaged_at TEXT,
  contract_status TEXT,
  contract_last_verdict TEXT,
  contract_last_attempt_at TEXT,
  PRIMARY KEY (issue_id, contract_class)
);

INSERT OR IGNORE INTO bak_20261102_owner_outcome_relapse_1875
  (issue_id, contract_class, issue_status, issue_close_channel, issue_updated_at, triage_rc, triage_state,
   triage_owner, triage_close_evidence, triage_triaged_at, contract_status, contract_last_verdict, contract_last_attempt_at)
SELECT a.id, c.class, a.status, a.close_channel, a.updated_at, t.rc, t.triage_state, t.owner, t.close_evidence,
       t.triaged_at, c.status, c.last_verdict, c.last_attempt_at
FROM agent_issues a
JOIN issue_triage t ON t.issue_id = a.id
JOIN remediation_contracts c ON c.issue_id = a.id
WHERE a.id = 1875
  AND a.status = 'open'
  AND a.title LIKE 'METRIC-TRIGGER-405-%'
  AND t.triage_state = 'triaged'
  AND c.class IN ('issue-1875', 'metric-relapse-1875')
  AND c.status IN ('active', 'holding', 'monitoring')
  AND EXISTS (
    SELECT 1
    FROM analytics_metric_triggers trigger_row
    JOIN metric_registry registry ON registry.metric = trigger_row.metric_key
    JOIN goals goal ON goal.id = 74 AND goal.goal_key = 'OWNER-OUTCOME-REACH-1'
    WHERE trigger_row.id = 405
      AND trigger_row.metric_key = 'outreach_reply_rate_30d'
      AND trigger_row.enabled = 0
      AND instr(COALESCE(registry.target, ''), '[owner-outcome: not autonomically closable, IL-OWNER-OUTCOME-1]') > 0
  )
  AND EXISTS (SELECT 1 FROM remediation_contracts WHERE issue_id = 1875 AND class = 'issue-1875')
  AND EXISTS (SELECT 1 FROM remediation_contracts WHERE issue_id = 1875 AND class = 'metric-relapse-1875');

UPDATE remediation_contracts
SET status = 'superseded',
    last_verdict = 'superseded:OWNER-OUTCOME-RELAPSE-SUPERSEDE-1 by goal 74',
    last_attempt_at = datetime('now'),
    next_due_at = NULL
WHERE issue_id = 1875
  AND class IN ('issue-1875', 'metric-relapse-1875')
  AND status IN ('active', 'holding', 'monitoring')
  AND EXISTS (SELECT 1 FROM bak_20261102_owner_outcome_relapse_1875 WHERE issue_id = 1875);

UPDATE issue_triage
SET rc = 'qnfo-fleet-control:OWNER-OUTCOME-RELAPSE-SUPERSEDE-1',
    triage_state = 'closed',
    owner = 'qnfo-fleet-control',
    triaged_at = datetime('now'),
    close_evidence = 'SUPERSEDED BY goals:OWNER-OUTCOME-REACH-1 (goal 74): outreach_reply_rate_30d remains a measured owner outcome whose target requires independent replies; trigger 405 is intentionally disabled and the metric target is marked not autonomically closable. The stale issue-1875 monitoring and relapse contracts are superseded so historical sub-target readings cannot reopen a fleet-remediation issue. OWNER-OUTCOME-RELAPSE-SUPERSEDE-1.'
WHERE issue_id = 1875
  AND triage_state = 'triaged'
  AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 1875 AND status = 'open' AND title LIKE 'METRIC-TRIGGER-405-%')
  AND EXISTS (
    SELECT 1
    FROM analytics_metric_triggers trigger_row
    JOIN metric_registry registry ON registry.metric = trigger_row.metric_key
    JOIN goals goal ON goal.id = 74 AND goal.goal_key = 'OWNER-OUTCOME-REACH-1'
    WHERE trigger_row.id = 405
      AND trigger_row.metric_key = 'outreach_reply_rate_30d'
      AND trigger_row.enabled = 0
      AND instr(COALESCE(registry.target, ''), '[owner-outcome: not autonomically closable, IL-OWNER-OUTCOME-1]') > 0
  )
  AND NOT EXISTS (
    SELECT 1 FROM remediation_contracts
    WHERE issue_id = 1875 AND class IN ('issue-1875', 'metric-relapse-1875')
      AND status IN ('active', 'holding', 'monitoring')
  );

INSERT OR IGNORE INTO failure_modes
  (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id)
SELECT 'owner-outcome-relapse-contract-1875',
       'a historical relapse contract reopens an explicitly superseded owner-outcome issue',
       'issue 1875 retained active and monitoring contracts after its owner-outcome disposition; the relapse trigger reopened it after historical sub-target readings',
       'OWNER-OUTCOME-RELAPSE-SUPERSEDE-1: supersede both stale issue contracts and close with evidence while keeping the outcome metric measured',
       'no active or monitoring issue-1875 or metric-relapse-1875 contract remains',
       'fm-owner-outcome-relapse-contract-1875', '2026-11-02', 1875
WHERE EXISTS (SELECT 1 FROM bak_20261102_owner_outcome_relapse_1875 WHERE issue_id = 1875);

INSERT OR IGNORE INTO remediation_contracts
  (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to,
   expected_cadence_h, status, module)
SELECT 'fm-owner-outcome-relapse-contract-1875', NULL, 'OWNER-OUTCOME-RELAPSE-SUPERSEDE-1',
       'failure-mode detector',
       'SELECT ''0'' AS expected, CAST((SELECT COUNT(*) FROM remediation_contracts WHERE issue_id = 1875 AND class IN (''issue-1875'', ''metric-relapse-1875'') AND status IN (''active'', ''holding'', ''monitoring'')) AS TEXT) AS observed',
       'd1-query', 3, 'qnfo-fleet-control', 1, 'active', 'failure-mode'
WHERE EXISTS (SELECT 1 FROM bak_20261102_owner_outcome_relapse_1875 WHERE issue_id = 1875);

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain,
   predicted_outcome, reach_gain, surfaces_tested)
SELECT 'qnfo-fleet-control (issue 1875 remediation)',
       'outreach_reply_rate_30d is an owner-outcome measure that the fleet must keep measuring but cannot make pass by changing fleet code; the old issue contracts incorrectly treated its historical value as an actionable defect',
       'OWNER-OUTCOME-RELAPSE-SUPERSEDE-1: supersede issue 1875 and its stale monitoring/relapse contracts while retaining the metric and disabled trigger',
       'qnfo-audit: trigger 405 is disabled with REDERIVE-2026-10-18 OWNER-OUTCOME notes; metric_registry carries the IL-OWNER-OUTCOME-1 marker; goal 74 tracks outreach_reply_rate_30d; issue_lifecycle records an evidence-backed close followed by a relapse reopen; both issue contracts remained active or monitoring',
       'issue 1875 closes through issue_triage with supersession evidence; both old contracts are superseded; the reach outcome remains measured and a detector checks for recurrence',
       'issue 1875, its two remediation contracts, one failure mode and one detector contract; metric values, trigger state, sends and consent controls are unchanged',
       'restore issue, triage and contract fields from bak_20261102_owner_outcome_relapse_1875; the detector and decision history remain append-only',
       'an owner-outcome metric can be measured without historical threshold failures repeatedly reopening a non-actionable issue',
       'issue 1875 changes from open to closed with evidence; open issues decrease by one; outreach_reply_rate_30d and send/consent controls remain unchanged',
       'no immediate external reply-rate gain; preserve honest outcome measurement while eliminating one recurring false remediation issue',
       'qnfo-audit agent_issues, issue_triage, issue_lifecycle, remediation_contracts, metric_registry, analytics_metric_triggers, goals; offline Node sqlite relapse regression'
FROM bak_20261102_owner_outcome_relapse_1875
WHERE issue_id = 1875
  AND NOT EXISTS (
    SELECT 1 FROM decision_log
    WHERE action = 'OWNER-OUTCOME-RELAPSE-SUPERSEDE-1: supersede issue 1875 and its stale monitoring/relapse contracts while retaining the metric and disabled trigger'
  )
LIMIT 1;
