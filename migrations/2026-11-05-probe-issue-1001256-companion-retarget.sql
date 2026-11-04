-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_probe_1001256
-- Rollback: UPDATE remediation_contracts SET verify_probe = (SELECT verify_probe FROM bak_20261105_probe_1001256 WHERE class = 'issue-1001256'), verify_transport = (SELECT verify_transport FROM bak_20261105_probe_1001256 WHERE class = 'issue-1001256'), precondition = (SELECT precondition FROM bak_20261105_probe_1001256 WHERE class = 'issue-1001256'), action = (SELECT action FROM bak_20261105_probe_1001256 WHERE class = 'issue-1001256'), last_verdict = NULL, attempts = 0 WHERE class = 'issue-1001256' AND EXISTS (SELECT 1 FROM bak_20261105_probe_1001256 WHERE class = 'issue-1001256');
-- CAUSE-MAPPED: registers no metric_registry row; it replaces one issue contract's probe.

-- COMPANION-RETARGET-AT-READ-1 (agent_issues 1001256, charter pillar autonomy), written after reading the fix in qnfo-code-orchestrator 0.46.1.
-- The old probe counted every code_tasks row ever filed on personal-api/worker.js with an anchor in the generated COMPANION-INLINE region and no regenerate goal. Four of those rows
-- are finished history (ct_im1000792, ct_iui23eipw5w1lh, ct_yb3aomxnk3to5u, ct_rih48qvd8s1bo9, all failed before the fix), so it could never reach 0 whatever the planner does.
-- The defect is the loop's behaviour, and the code state is its measure: the read step retargets such a task to personal-api/companion.js with the regenerate goal.
-- The probe requires that rule on main (code-read of the consumer's checkout); issue 1001256 closes through the contract's autoclose when it passes, never on this file merging.

CREATE TABLE IF NOT EXISTS bak_20261105_probe_1001256 AS
SELECT * FROM remediation_contracts WHERE 0;

INSERT INTO bak_20261105_probe_1001256
SELECT * FROM remediation_contracts
WHERE class = 'issue-1001256'
  AND NOT EXISTS (SELECT 1 FROM bak_20261105_probe_1001256 WHERE class = 'issue-1001256');

UPDATE remediation_contracts
SET precondition = 'COMPANION-RETARGET-AT-READ-1: a task filed on personal-api/worker.js whose anchor lies inside the COMPANION-INLINE region is retargeted to personal-api/companion.js with the regenerate goal before any model call.',
    action = 'Measure the fix on main: qnfo-code-orchestrator/worker.js carries the read-step retarget (COMPANION-RETARGET-AT-READ-1) beside the planner retarget and the fail-time retarget.',
    verify_probe = '{"paths":["qnfo-code-orchestrator/worker.js"],"contains":"COMPANION-RETARGET-AT-READ-1: the anchor is inside the inlined companion"}',
    verify_transport = 'code-read',
    status = 'active',
    last_verdict = NULL,
    last_attempt_at = NULL,
    attempts = 0,
    deferred_since = NULL,
    next_due_at = datetime('now')
WHERE class = 'issue-1001256'
  AND issue_id = 1001256
  AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 1001256 AND status = 'open');

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path,
   capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'qnfo-workers:COMPANION-RETARGET-AT-READ-1',
       'Issue 1001256 is fixed when the code loop stops spending failed attempts on personal-api/worker.js tasks anchored in the inlined companion; the code state is the measure, the four historic failed rows are not.',
       'COMPANION-RETARGET-AT-READ-1: replaced the state-pinning d1-query probe of issue-1001256 with a code-read probe on the read-step retarget.',
       'code_tasks holds four finished personal-api/worker.js tasks with the inbox anchor and no regenerate goal (ct_im1000792, ct_iui23eipw5w1lh, ct_yb3aomxnk3to5u, ct_rih48qvd8s1bo9) and one queued successor (ct_u9huz7zbg8aahu); the old probe counted all of them.',
       'contract replaced; autoclose waits for the code-read to pass after the orchestrator deploy',
       'one remediation_contracts row (issue-1001256)',
       'The Rollback header of migrations/2026-11-05-probe-issue-1001256-companion-retarget.sql restores the old probe from bak_20261105_probe_1001256.',
       'A personal-api/worker.js task anchored in the companion region is retargeted at the read step, with no model call and no failed attempt.',
       'No new code_tasks row on personal-api/worker.js with an inline-region anchor and no regenerate goal reaches propose; ct_u9huz7zbg8aahu moves to personal-api/companion.js on its next read.',
       'Fewer code-loop attempts burned on an unsatisfiable parity suite; the PLUS-1 inbox card task (issue 1000792) can ship.',
       'qnfo-code-orchestrator/companion-retarget-at-read.test.mjs (offline, fails on the previous worker.js, passes on this one)'
WHERE EXISTS (SELECT 1 FROM remediation_contracts WHERE class = 'issue-1001256' AND verify_transport = 'code-read')
  AND NOT EXISTS (SELECT 1 FROM decision_log WHERE actor = 'qnfo-workers:COMPANION-RETARGET-AT-READ-1');
