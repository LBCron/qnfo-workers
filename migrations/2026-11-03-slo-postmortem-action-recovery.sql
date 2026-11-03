-- ROOT-CAUSE-1 (#1000892 / #5404; charter pillar autonomy).
-- The HTTP-200-only close probe passed while the SLO's latency samples still failed,
-- so bp26-slo repeatedly refiled and reopened the same action issues. Require an ok
-- budget and 12 clean samples in the latest 24 hours for existing and future issues.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261103_slo_postmortem_action_recovery
-- Rollback: UPDATE remediation_contracts SET (verify_probe, verify_transport, precondition, action, status, module, attempts, last_verdict, next_due_at, expected_cadence_h, max_attempts) = (SELECT b.verify_probe, b.verify_transport, b.precondition, b.action, b.status, b.module, b.attempts, b.last_verdict, b.next_due_at, b.expected_cadence_h, b.max_attempts FROM bak_20261103_slo_postmortem_action_recovery b WHERE b.class = remediation_contracts.class) WHERE class IN (SELECT class FROM bak_20261103_slo_postmortem_action_recovery) AND module = 'slo-action-recovery-1';

CREATE TABLE IF NOT EXISTS bak_20261103_slo_postmortem_action_recovery AS
SELECT c.class, c.verify_probe, c.verify_transport, c.precondition, c.action, c.status, c.module,
       c.attempts, c.last_verdict, c.next_due_at, c.expected_cadence_h, c.max_attempts
FROM remediation_contracts c
JOIN agent_issues a ON a.id = c.issue_id
WHERE a.title LIKE 'SLO-POSTMORTEM-ACTION-1%';

WITH targets AS (
  SELECT c.class, c.issue_id,
         trim(substr(a.title, length('SLO-POSTMORTEM-ACTION-1') + 1,
                     instr(substr(a.title, length('SLO-POSTMORTEM-ACTION-1') + 1), ':') - 1)) AS surface
  FROM remediation_contracts c
  JOIN agent_issues a ON a.id = c.issue_id
  WHERE a.title LIKE 'SLO-POSTMORTEM-ACTION-1%'
    AND instr(substr(a.title, length('SLO-POSTMORTEM-ACTION-1') + 1), ':') > 0
),
probes AS (
  SELECT class, issue_id,
         'SELECT ''ok'' AS expected, CASE '
         || 'WHEN COALESCE((SELECT state FROM slo_budget_state WHERE surface = ' || quote(surface) || '), '''') <> ''ok'' THEN ''budget state is not ok'' '
         || 'WHEN (SELECT COUNT(*) FROM bp26_probe_results WHERE metric = ''slo_attainment_28d_min'' AND subject = ' || quote('avail:' || surface)
         || ' AND run_at > strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-24 hours'')) < 12 THEN ''fewer than 12 samples in 24 h'' '
         || 'WHEN (SELECT COUNT(*) FROM bp26_probe_results WHERE metric = ''slo_attainment_28d_min'' AND subject = ' || quote('avail:' || surface)
         || ' AND ok = 0 AND run_at > strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-24 hours'')) > 0 THEN ''a sample failed in the last 24 h'' '
         || 'ELSE ''ok'' END AS observed' AS verify_probe
  FROM targets
)
UPDATE remediation_contracts
SET verify_probe = (SELECT p.verify_probe FROM probes p WHERE p.class = remediation_contracts.class),
    verify_transport = 'd1-query',
    status = 'active',
    module = 'slo-action-recovery-1',
    attempts = 0,
    last_verdict = NULL,
    next_due_at = datetime('now'),
    expected_cadence_h = 1,
    max_attempts = 3,
    precondition = 'SLO recovery for 24 hours',
    action = 'the action issue closes only after the SLO is ok with at least 12 passing samples and no failures in 24 hours'
WHERE class IN (SELECT class FROM probes);
