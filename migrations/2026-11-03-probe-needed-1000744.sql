-- PROBE-NEEDED-1: issue-1000744, MONITORING-PASS-1 (charter pillar autonomy).
-- Restore a live probe that measures monitoring-pass coverage, without reading this issue's own state.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261103_issue_1000744_probe
-- Rollback: DELETE FROM remediation_contracts WHERE class = 'issue-1000744'; INSERT INTO remediation_contracts SELECT * FROM bak_20261103_issue_1000744_probe;

CREATE TABLE IF NOT EXISTS bak_20261103_issue_1000744_probe AS
SELECT * FROM remediation_contracts WHERE 0;

INSERT INTO bak_20261103_issue_1000744_probe
SELECT * FROM remediation_contracts
WHERE class = 'issue-1000744'
  AND NOT EXISTS (
    SELECT 1 FROM bak_20261103_issue_1000744_probe WHERE class = 'issue-1000744'
  );

UPDATE remediation_contracts
SET verify_probe = 'WITH eligible AS (SELECT c.class FROM remediation_contracts c JOIN agent_issues a ON a.id = c.issue_id WHERE a.status = ''open'' AND a.id <> 1000744 AND c.status = ''monitoring'' AND c.verify_transport = ''d1-query''), fresh AS (SELECT class, MAX(verified_at) AS verified_at FROM remediation_verifications WHERE verifier LIKE ''qnfo-fleet-control/monitoring-pass@%'' GROUP BY class), stale AS (SELECT COUNT(*) AS n FROM eligible e LEFT JOIN fresh f ON f.class = e.class WHERE f.verified_at IS NULL OR datetime(f.verified_at) <= datetime(''now'', ''-55 minutes'')) SELECT ''0'' AS expected, CASE WHEN (SELECT COUNT(*) FROM eligible) = 0 THEN ''pending: no eligible open monitoring d1-query contracts'' ELSE CAST((SELECT n FROM stale) AS TEXT) END AS observed',
    verify_transport = 'd1-query',
    status = 'active',
    last_verdict = NULL,
    attempts = 0,
    deferred_since = NULL,
    last_attempt_at = NULL,
    next_due_at = datetime('now')
WHERE class = 'issue-1000744'
  AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 1000744 AND status = 'open');

INSERT OR IGNORE INTO remediation_contracts
  (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts,
   escalate_to, expected_cadence_h, status, module, attempts, last_verdict,
   deferred_since, last_attempt_at, next_due_at)
SELECT
  'issue-1000744', 1000744,
  'MONITORING-PASS-1: issue 1000744 is open and monitoring-pass verification coverage needs an active probe.',
  'Measure that each eligible open monitoring d1-query contract receives a monitoring-pass verification within 55 minutes.',
  'WITH eligible AS (SELECT c.class FROM remediation_contracts c JOIN agent_issues a ON a.id = c.issue_id WHERE a.status = ''open'' AND a.id <> 1000744 AND c.status = ''monitoring'' AND c.verify_transport = ''d1-query''), fresh AS (SELECT class, MAX(verified_at) AS verified_at FROM remediation_verifications WHERE verifier LIKE ''qnfo-fleet-control/monitoring-pass@%'' GROUP BY class), stale AS (SELECT COUNT(*) AS n FROM eligible e LEFT JOIN fresh f ON f.class = e.class WHERE f.verified_at IS NULL OR datetime(f.verified_at) <= datetime(''now'', ''-55 minutes'')) SELECT ''0'' AS expected, CASE WHEN (SELECT COUNT(*) FROM eligible) = 0 THEN ''pending: no eligible open monitoring d1-query contracts'' ELSE CAST((SELECT n FROM stale) AS TEXT) END AS observed',
  'd1-query', 3, 'qnfo-fleet-control', 1, 'active', 'issue-1000744-monitoring-pass',
  0, NULL, NULL, NULL, datetime('now')
FROM agent_issues
WHERE id = 1000744 AND status = 'open';
