-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE remediation_contracts SET precondition=(SELECT precondition FROM bak_20261102_probe_needed_1001220 WHERE class=remediation_contracts.class),action=(SELECT action FROM bak_20261102_probe_needed_1001220 WHERE class=remediation_contracts.class),verify_probe=(SELECT verify_probe FROM bak_20261102_probe_needed_1001220 WHERE class=remediation_contracts.class),verify_transport=(SELECT verify_transport FROM bak_20261102_probe_needed_1001220 WHERE class=remediation_contracts.class),max_attempts=(SELECT max_attempts FROM bak_20261102_probe_needed_1001220 WHERE class=remediation_contracts.class),escalate_to=(SELECT escalate_to FROM bak_20261102_probe_needed_1001220 WHERE class=remediation_contracts.class),expected_cadence_h=(SELECT expected_cadence_h FROM bak_20261102_probe_needed_1001220 WHERE class=remediation_contracts.class),status=(SELECT status FROM bak_20261102_probe_needed_1001220 WHERE class=remediation_contracts.class),ts=(SELECT ts FROM bak_20261102_probe_needed_1001220 WHERE class=remediation_contracts.class),last_attempt_at=(SELECT last_attempt_at FROM bak_20261102_probe_needed_1001220 WHERE class=remediation_contracts.class),last_verdict=(SELECT last_verdict FROM bak_20261102_probe_needed_1001220 WHERE class=remediation_contracts.class),module=(SELECT module FROM bak_20261102_probe_needed_1001220 WHERE class=remediation_contracts.class),next_due_at=(SELECT next_due_at FROM bak_20261102_probe_needed_1001220 WHERE class=remediation_contracts.class),attempts=(SELECT attempts FROM bak_20261102_probe_needed_1001220 WHERE class=remediation_contracts.class),deferred_since=(SELECT deferred_since FROM bak_20261102_probe_needed_1001220 WHERE class=remediation_contracts.class) WHERE class='issue-1001220' AND module='probe-needed-issue-1001220' AND EXISTS (SELECT 1 FROM bak_20261102_probe_needed_1001220 WHERE class=remediation_contracts.class); DELETE FROM remediation_contracts WHERE class='issue-1001220' AND module='probe-needed-issue-1001220' AND NOT EXISTS (SELECT 1 FROM bak_20261102_probe_needed_1001220 WHERE class=remediation_contracts.class);
-- PROBE-NEEDED-ISSUE-1001220-1 (2026-11-02, charter pillar autonomy).
-- Keep the family-quiet condition as a D1 probe, but hold the contract so it does not claim that condition alone closed this issue.
-- management-personas step rc-close owns closure through v_root_cause_quiet after 24 hours without a new or reopened family issue.

CREATE TABLE IF NOT EXISTS bak_20261102_probe_needed_1001220 AS
SELECT * FROM remediation_contracts
WHERE class = 'issue-1001220' AND status = 'probe-review-refused';

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'qnfo-workers:PROBE-NEEDED-ISSUE-1001220-1',
       'The probe can measure the stated 24-hour family-quiet condition without reading issue 1001220 status, but only management-personas rc-close establishes its closure.',
       'PROBE-NEEDED-ISSUE-1001220-1: park issue-1001220 on a holding D1 family-quiet probe and name management-personas rc-close as its closer.',
       'Live qnfo-audit: issue 1001220 is open with a probe-review-refused contract; family METRIC-UNMEASURED-1 has 29 reopens in 7 days and one open in the last 24 hours. Its definition closes after 24 quiet hours. management-personas rc-close consumes v_root_cause_quiet; the probe below reads issue_lifecycle but not issue 1001220 status.',
       'A holding contract measures family quietness without treating a passing condition as proof the issue closed; management-personas rc-close remains the closer.',
       'remediation_contracts class issue-1001220 only; no issue status or workflow definition is changed.',
       'Rollback restores the prior contract from bak_20261102_probe_needed_1001220, or removes the row if this migration created it; decision history remains append-only.',
       'A rejected root-cause contract now records the real D1 close condition and its independent owner-loop closer.',
       'The probe reads observed=0 while a family issue was opened or reopened in the last 24 hours (or the root issue is younger than 24 hours), and observed=1 only after 24 quiet hours; it never reads the root issue status.',
       'No external reach change; one root-cause issue gains a usable verification and named close path.',
       'SQLite migration regression test; read-only qnfo-audit issue, contract, lifecycle, recurrence and workflow reads.'
WHERE EXISTS (SELECT 1 FROM agent_issues WHERE id = 1001220 AND status = 'open')
  AND (
    EXISTS (SELECT 1 FROM remediation_contracts WHERE class = 'issue-1001220' AND issue_id = 1001220 AND status = 'probe-review-refused')
    OR NOT EXISTS (SELECT 1 FROM remediation_contracts WHERE class = 'issue-1001220')
  )
  AND NOT EXISTS (
    SELECT 1 FROM decision_log
    WHERE actor = 'qnfo-workers:PROBE-NEEDED-ISSUE-1001220-1'
      AND action = 'PROBE-NEEDED-ISSUE-1001220-1: park issue-1001220 on a holding D1 family-quiet probe and name management-personas rc-close as its closer.'
  );

UPDATE remediation_contracts
SET precondition = 'The METRIC-UNMEASURED-1 family has no opened or reopened issue in the last 24 hours, and issue 1001220 is at least 24 hours old.',
    action = 'HOLDING monitor only: management-personas step rc-close closes issue 1001220 from v_root_cause_quiet after the family-quiet condition; this probe does not establish issue status.',
    verify_probe = 'SELECT ''1'' AS expected, CAST((SELECT COUNT(*) FROM agent_issues root WHERE root.id = 1001220 AND root.title = ''ROOT-CAUSE-1: METRIC-UNMEASURED-1 keeps recurring'' AND root.created_at < (CAST(strftime(''%s'', ''now'') AS INTEGER) - 86400) * 1000 AND NOT EXISTS (SELECT 1 FROM issue_lifecycle l JOIN agent_issues family_issue ON family_issue.id = l.issue_id WHERE l.event IN (''opened'', ''reopened'') AND l.ts >= strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-24 hours'') AND family_issue.title LIKE ''METRIC-UNMEASURED-1:%'')) AS TEXT) AS observed',
    verify_transport = 'd1-query',
    max_attempts = 24,
    escalate_to = 'qnfo-fleet-control',
    expected_cadence_h = 1,
    status = 'holding',
    ts = datetime('now'),
    last_attempt_at = NULL,
    last_verdict = 'holding:external-closer:management-personas.rc-close',
    module = 'probe-needed-issue-1001220',
    next_due_at = datetime('now'),
    attempts = 0,
    deferred_since = NULL
WHERE class = 'issue-1001220' AND issue_id = 1001220 AND status = 'probe-review-refused'
  AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 1001220 AND status = 'open');

INSERT OR IGNORE INTO remediation_contracts
  (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, last_verdict, module, next_due_at, attempts, deferred_since)
SELECT 'issue-1001220', 1001220,
       'The METRIC-UNMEASURED-1 family has no opened or reopened issue in the last 24 hours, and issue 1001220 is at least 24 hours old.',
       'HOLDING monitor only: management-personas step rc-close closes issue 1001220 from v_root_cause_quiet after the family-quiet condition; this probe does not establish issue status.',
       'SELECT ''1'' AS expected, CAST((SELECT COUNT(*) FROM agent_issues root WHERE root.id = 1001220 AND root.title = ''ROOT-CAUSE-1: METRIC-UNMEASURED-1 keeps recurring'' AND root.created_at < (CAST(strftime(''%s'', ''now'') AS INTEGER) - 86400) * 1000 AND NOT EXISTS (SELECT 1 FROM issue_lifecycle l JOIN agent_issues family_issue ON family_issue.id = l.issue_id WHERE l.event IN (''opened'', ''reopened'') AND l.ts >= strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-24 hours'') AND family_issue.title LIKE ''METRIC-UNMEASURED-1:%'')) AS TEXT) AS observed',
       'd1-query', 24, 'qnfo-fleet-control', 1, 'holding',
       'holding:external-closer:management-personas.rc-close', 'probe-needed-issue-1001220', datetime('now'), 0, NULL
WHERE EXISTS (SELECT 1 FROM agent_issues WHERE id = 1001220 AND status = 'open')
  AND NOT EXISTS (SELECT 1 FROM remediation_contracts WHERE class = 'issue-1001220');
