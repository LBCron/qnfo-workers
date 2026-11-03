-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261103_probe_needed_1000716
-- Rollback: DELETE FROM remediation_contracts WHERE class='issue-1000716' AND module='probe-needed-issue-1000716'; INSERT INTO remediation_contracts SELECT * FROM bak_20261103_probe_needed_1000716;

-- PROBE-NEEDED-ISSUE-1000716-1 (charter pillar autonomy).
-- Restore an active code-read contract for the open EK-6 issue. Require its P_ESSAY writer prompt in both the shared module and personal-companion bundle; never read the issue's own status.

CREATE TABLE IF NOT EXISTS bak_20261103_probe_needed_1000716 AS
SELECT * FROM remediation_contracts WHERE 0;

INSERT INTO bak_20261103_probe_needed_1000716
SELECT * FROM remediation_contracts
WHERE class = 'issue-1000716'
  AND issue_id = 1000716
  AND status = 'superseded'
  AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 1000716 AND status = 'open')
  AND NOT EXISTS (
    SELECT 1 FROM bak_20261103_probe_needed_1000716 WHERE class = 'issue-1000716'
  );

UPDATE remediation_contracts
SET precondition = 'PROBE-NEEDED-ISSUE-1000716-1: EK-6 is implemented when the P_ESSAY writer prompt is present in the shared module and personal-companion bundle, never when issue 1000716 changes status.',
    action = 'Measure the EK-6 analysis-form extraction on main with a code-read probe that requires the P_ESSAY writer prompt in _shared/analysis-form.js and personal-companion/worker.js.',
    verify_probe = '{"paths":["_shared/analysis-form.js","personal-companion/worker.js"],"contains":"FORM: essay, 2000 to 2800 words. This is long-form."}',
    verify_transport = 'code-read',
    max_attempts = 24,
    escalate_to = 'qnfo-fleet-control',
    expected_cadence_h = 1,
    status = 'active',
    ts = datetime('now'),
    last_attempt_at = NULL,
    last_verdict = NULL,
    module = 'probe-needed-issue-1000716',
    next_due_at = datetime('now'),
    attempts = 0,
    deferred_since = NULL
WHERE class = 'issue-1000716'
  AND issue_id = 1000716
  AND status = 'superseded'
  AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 1000716 AND status = 'open');

INSERT OR IGNORE INTO remediation_contracts
  (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts,
   escalate_to, expected_cadence_h, status, module, attempts, last_verdict,
   deferred_since, last_attempt_at, next_due_at)
SELECT
  'issue-1000716', 1000716,
  'PROBE-NEEDED-ISSUE-1000716-1: EK-6 is implemented when the P_ESSAY writer prompt is present in the shared module and personal-companion bundle, never when issue 1000716 changes status.',
  'Measure the EK-6 analysis-form extraction on main with a code-read probe that requires the P_ESSAY writer prompt in _shared/analysis-form.js and personal-companion/worker.js.',
  '{"paths":["_shared/analysis-form.js","personal-companion/worker.js"],"contains":"FORM: essay, 2000 to 2800 words. This is long-form."}',
  'code-read', 24, 'qnfo-fleet-control', 1, 'active', 'probe-needed-issue-1000716',
  0, NULL, NULL, NULL, datetime('now')
FROM agent_issues
WHERE id = 1000716 AND status = 'open'
  AND NOT EXISTS (SELECT 1 FROM remediation_contracts WHERE class = 'issue-1000716');

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path,
   capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'qnfo-workers:PROBE-NEEDED-ISSUE-1000716-1',
       'The EK-6 definition of done is measured by the analysis-form objection text appearing in the shared module and the personal-companion bundle.',
       'PROBE-NEEDED-ISSUE-1000716-1: installed an active code-read verification probe for issue-1000716.',
       'Issue 1000716 names _shared/analysis-form.js and personal-companion/worker.js; the probe checks their shared objection-rule text and does not read issue status.',
       'An active verification path is installed; issue closure awaits a passing code-read run.',
       'remediation_contracts row issue-1000716.',
       'Rollback restores the superseded contract from bak_20261103_probe_needed_1000716, or removes a contract created by this migration.',
       'An open EK-6 issue has an active probe for the shared analysis-form implementation.',
       'The active code-read contract count for issue 1000716 rises from zero to one after CI applies this migration.',
       'One open autonomy issue moves to measured verification; no implementation recovery is claimed before the code-read passes.',
       'SQLite migration fixture and remediation_consumer code-read judge; live verification awaits CI application and the remediation consumer.'
WHERE EXISTS (
  SELECT 1 FROM remediation_contracts
  WHERE class = 'issue-1000716'
    AND issue_id = 1000716
    AND status = 'active'
    AND verify_transport = 'code-read'
    AND verify_probe = '{"paths":["_shared/analysis-form.js","personal-companion/worker.js"],"contains":"FORM: essay, 2000 to 2800 words. This is long-form."}'
)
AND NOT EXISTS (
  SELECT 1 FROM decision_log
  WHERE actor = 'qnfo-workers:PROBE-NEEDED-ISSUE-1000716-1'
    AND action = 'PROBE-NEEDED-ISSUE-1000716-1: installed an active code-read verification probe for issue-1000716.'
);
