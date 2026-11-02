-- WATCHMAKER-TASK-RECOVERY-1 (#1000972 / #6151; charter pillar: autonomy).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261102_watchmaker_task
-- Rollback: UPDATE code_tasks SET (goal, status, step, attempts, model, ctx, branch, last_error, lease_until, updated_at) = (SELECT goal, status, step, attempts, model, ctx, branch, last_error, lease_until, updated_at FROM bak_20261102_watchmaker_task b WHERE b.id = code_tasks.id) WHERE id IN (SELECT id FROM bak_20261102_watchmaker_task) AND status = 'queued' AND lease_until IS NULL AND instr(goal, 'WATCHMAKER-TASK-RECOVERY-1') > 0; UPDATE remediation_contracts SET (verify_probe, action, module, next_due_at) = (SELECT verify_probe, action, module, next_due_at FROM bak_20261102_watchmaker_contract b WHERE b.class = remediation_contracts.class) WHERE class IN (SELECT class FROM bak_20261102_watchmaker_contract) AND module = 'watchmaker-task-recovery';
--
-- D1 read 2026-11-02: ct_o8wx7m353kt900 failed after five attempts. Its goal
-- asks to remove by_person, contradicting watchmaker.test.mjs. Publisher feedback
-- also reports VERSION minimum failures. A retry must not repeat that goal or
-- reuse the stale proposal. Live /api/watchmaker counts code-task-merge with
-- by_person 49, revert_failed 1, by_runner 296; those are not evidence of recovery.
-- Narrow to structured diagnostics so the doer can distinguish these causes
-- without deleting historical interventions or changing the target. Issue 99909
-- remains open on its own metric probe; this migration does not claim it fixed.

CREATE TABLE IF NOT EXISTS bak_20261102_watchmaker_task AS
SELECT * FROM code_tasks
WHERE id = 'ct_o8wx7m353kt900' AND repo = 'qnfo-workers'
  AND path = 'qnfo-fleet-dashboard/worker.js' AND status = 'failed'
  AND pr_url IS NULL AND lease_until IS NULL
  AND instr(last_error, 'PUBLISH-SUITE-CHECK-1') > 0
  AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 1000972 AND status = 'open');

CREATE TABLE IF NOT EXISTS bak_20261102_watchmaker_contract AS
SELECT * FROM remediation_contracts WHERE class = 'issue-1000972';

UPDATE code_tasks
SET goal = '[issue #99909] WATCHMAKER-TASK-RECOVERY-1: expose code-task-merge cause diagnostics without changing the watchmaker index.'
    || char(10) || 'In watchmakerMeasure, when the fresh code-task-merge runner reads its stuck_sql result, expose a details object containing the numeric stuck_prs, needs_person, by_person, revert_failed and by_runner values already returned by that query. Keep existing state text, counted logic, SQL, historical windows, target 0, and all other operations unchanged. Missing or unreadable results must still count as unmeasured, not as zero.'
    || char(10) || 'The previous goal conflicted with watchmaker.test.mjs: do not remove by_person or relax any assertion. Do not edit the VERSION declaration or lower its value; the orchestrator bumps it from current main. Preserve its double-quoted declaration and every existing suite invariant.'
    || char(10) || 'Definition of done for this narrowed task: structured cause counts are exposed and the existing dashboard suites pass before publication. Issue #99909 still requires its metric to recover; diagnostics alone do not close it.',
    status = 'queued', step = 'read', attempts = 0, model = NULL,
    ctx = json_object('anchor', 'async function watchmakerMeasure(env, nowMs) {'),
    branch = NULL, last_error = NULL, lease_until = NULL,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id IN (SELECT id FROM bak_20261102_watchmaker_task)
  AND status = 'failed' AND pr_url IS NULL AND lease_until IS NULL
  AND instr(last_error, 'PUBLISH-SUITE-CHECK-1') > 0
  AND instr(goal, 'WATCHMAKER-TASK-RECOVERY-1') = 0
  AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 1000972 AND status = 'open');

-- A failed/closed task, an arbitrary PR URL or step=done alone is not success.
-- Keep the existing contract row; the fleet verifier supplies the close evidence.
UPDATE remediation_contracts
SET verify_probe = 'SELECT ''ready'' AS expected, CASE WHEN EXISTS (SELECT 1 FROM code_tasks WHERE id = ''ct_o8wx7m353kt900'' AND status IN (''ready_to_publish'', ''published'', ''merged'') AND step = ''done'' AND last_error IS NULL) THEN ''ready'' ELSE ''pending'' END AS observed',
    action = 'WATCHMAKER-TASK-RECOVERY-1: the code loop owns the narrowed retry; close issue 1000972 only with the task status and verification evidence. Do not close issue 99909 on diagnostics.',
    module = 'watchmaker-task-recovery',
    next_due_at = datetime('now')
WHERE class = 'issue-1000972' AND issue_id = 1000972
  AND EXISTS (SELECT 1 FROM bak_20261102_watchmaker_task)
  AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 1000972 AND status = 'open')
  AND module IS NOT 'watchmaker-task-recovery';

INSERT OR IGNORE INTO failure_modes
  (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id)
VALUES
  ('watchmaker-task-goal-conflict', 'Watchmaker task repeatedly fails publisher suites',
   'The task goal removes by_person despite suites requiring historical intervention counts; stale proposals also fail VERSION minimum assertions',
   'WATCHMAKER-TASK-RECOVERY-1: narrow to structured diagnostics, preserve the count and suites, reset context and read current main',
   'The recovered task must not end failed, needs_human or publish_failed again',
   'fm-watchmaker-task-goal-conflict', '2026-11-01', 1000972);

INSERT OR IGNORE INTO remediation_contracts
  (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module)
VALUES
  ('fm-watchmaker-task-goal-conflict', NULL, 'WATCHMAKER-TASK-RECOVERY-1',
   'failure-mode detector',
   'SELECT ''0'' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM code_tasks WHERE id = ''ct_o8wx7m353kt900'' AND instr(goal, ''WATCHMAKER-TASK-RECOVERY-1'') > 0 AND status IN (''failed'', ''needs_human'', ''publish_failed'')',
   'd1-query', 3, 'qnfo-fleet-control', 1, 'active', 'failure-mode');

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'copilot-6151',
  'A retry must preserve suite-pinned historical intervention counts, not mask the metric breach',
  'WATCHMAKER-TASK-RECOVERY-1: narrow ct_o8wx7m353kt900 to structured cause diagnostics and requeue from current main',
  'D1 task failed after five attempts; publisher feedback names VERSION assertions and six by_person assertions; live watchmaker index 1 with by_person 49 and revert_failed 1',
  'Recovery queued, not yet verified; neither issue is closed',
  'One failed code task, its completion contract and one failure-mode detector; no runtime or metric target change',
  'Rollback header restores the task only before a runner leases it; restore contract from backup',
  'Code loop can publish cause diagnostics without weakening watchmaker verification',
  'One exhausted task reaches ready_to_publish or later with dashboard suites intact; watchmaker target remains 0',
  'No change to public reach', 'node migrations/watchmaker-task-recovery.test.mjs'
WHERE EXISTS (SELECT 1 FROM bak_20261102_watchmaker_task)
  AND NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'WATCHMAKER-TASK-RECOVERY-1:%');
