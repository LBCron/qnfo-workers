-- UPSTREAM-429-TASK-RECOVERY-1 (#6712, agent_issues 1001418; charter pillar: autonomy).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261103_upstream_429_task
-- Rollback: UPDATE code_tasks SET (status, step, attempts, model, ctx, last_error, updated_at) = (SELECT status, step, attempts, model, ctx, last_error, updated_at FROM bak_20261103_upstream_429_task b WHERE b.id = code_tasks.id) WHERE id IN (SELECT id FROM bak_20261103_upstream_429_task) AND status = 'queued' AND step = 'read' AND attempts = 0 AND lease_until IS NULL AND branch IS NULL AND pr_url IS NULL AND json_extract(ctx, '$.recovery') = 'UPSTREAM-429-TASK-RECOVERY-1';
-- Rollback (contract): UPDATE remediation_contracts SET (action, verify_probe, verify_transport, status, module, attempts, last_verdict, last_attempt_at, deferred_since, next_due_at) = (SELECT action, verify_probe, verify_transport, status, module, attempts, last_verdict, last_attempt_at, deferred_since, next_due_at FROM bak_20261103_upstream_429_contract b WHERE b.class = remediation_contracts.class) WHERE class IN (SELECT class FROM bak_20261103_upstream_429_contract) AND module = 'upstream-429-task-recovery'; DELETE FROM remediation_contracts WHERE class = 'fm-upstream-429-stale-patch'; DELETE FROM failure_modes WHERE fm_key = 'upstream-429-stale-patch';
--
-- D1 read 2026-11-03: ct_dk7c7rkpv4i7kb failed three times against a cached
-- 773,436-character base whose VERSION line is 49,508 characters. Bumping
-- that line in source and mirror alone exceeds the unchanged 80,000 cap.
-- PR #6600 already split those notes on main. Restart from read, discarding
-- the stale base, edits, claim and failure signatures, but keep the exact goal.
-- Prediction: this task reaches ready_to_publish or later without relaxing
-- verification. Issue 1000739 retains its separate live 429 outcome contract.

CREATE TABLE IF NOT EXISTS bak_20261103_upstream_429_task AS
SELECT * FROM code_tasks
WHERE id = 'ct_dk7c7rkpv4i7kb' AND repo = 'qnfo-workers'
  AND path = 'qnfo-ops/worker.js' AND instr(goal, '[issue #1000739]') = 1
  AND status = 'failed' AND step = 'propose'
  AND branch IS NULL AND pr_url IS NULL AND lease_until IS NULL
  AND last_error LIKE 'patch too large: exceeds verification limit%'
  AND json_extract(ctx, '$.mode') = 'patch'
  AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 1001418 AND status = 'open')
  AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 1000739 AND status = 'open');

CREATE TABLE IF NOT EXISTS bak_20261103_upstream_429_contract AS
SELECT * FROM remediation_contracts WHERE class = 'issue-1001418' AND issue_id = 1001418;

UPDATE code_tasks
SET status = 'queued', step = 'read', attempts = 0, model = NULL,
    ctx = json_object('anchor', 'async function opsUpstreamError(env, status, where, model, detail) {',
                      'recovery', 'UPSTREAM-429-TASK-RECOVERY-1'),
    last_error = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 'ct_dk7c7rkpv4i7kb' AND status = 'failed' AND step = 'propose'
  AND branch IS NULL AND pr_url IS NULL AND lease_until IS NULL
  AND EXISTS (SELECT 1 FROM bak_20261103_upstream_429_task b
              WHERE b.id = code_tasks.id AND b.updated_at = code_tasks.updated_at
                AND b.ctx IS code_tasks.ctx AND b.goal = code_tasks.goal
                AND b.last_error IS code_tasks.last_error
                AND b.repo = code_tasks.repo AND b.path = code_tasks.path)
  AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 1001418 AND status = 'open')
  AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 1000739 AND status = 'open');

UPDATE remediation_contracts
SET action = 'UPSTREAM-429-TASK-RECOVERY-1: the code loop owns the fresh retry. Close issue 1001418 only on verified task readiness; issue 1000739 retains its separate live 429 outcome contract.',
    verify_probe = 'SELECT ''ready'' AS expected, CASE WHEN EXISTS (SELECT 1 FROM code_tasks WHERE id = ''ct_dk7c7rkpv4i7kb'' AND status IN (''ready_to_publish'', ''publishing'', ''published'', ''pr_open'', ''merged'', ''deployed'') AND step = ''done'' AND last_error IS NULL) THEN ''ready'' ELSE ''pending'' END AS observed',
    verify_transport = 'd1-query', status = 'active', module = 'upstream-429-task-recovery',
    attempts = 0, last_verdict = NULL, last_attempt_at = NULL, deferred_since = NULL,
    next_due_at = datetime('now')
WHERE class = 'issue-1001418' AND issue_id = 1001418
  AND module IS NOT 'upstream-429-task-recovery'
  AND EXISTS (SELECT 1 FROM code_tasks WHERE id = 'ct_dk7c7rkpv4i7kb'
              AND status = 'queued' AND step = 'read' AND attempts = 0
              AND json_extract(ctx, '$.recovery') = 'UPSTREAM-429-TASK-RECOVERY-1');

INSERT OR IGNORE INTO failure_modes
  (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id)
VALUES
  ('upstream-429-stale-patch', 'Handled-429 task repeats an oversized patch after the source fix',
   'The failed task caches the pre-6600 VERSION line and repeat-failure signatures',
   'Re-read main once after the VERSION-line fix; retain all verification limits',
   'The recovered upstream-429 task must not fail again', 'fm-upstream-429-stale-patch', '2026-11-03', 1001418);

INSERT OR IGNORE INTO remediation_contracts
  (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module)
VALUES
  ('fm-upstream-429-stale-patch', NULL, 'UPSTREAM-429-TASK-RECOVERY-1', 'failure-mode detector',
   'SELECT ''0'' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM code_tasks t JOIN bak_20261103_upstream_429_task b ON b.id = t.id WHERE t.updated_at IS NOT b.updated_at AND t.status IN (''failed'', ''needs_human'', ''publish_failed'')',
   'd1-query', 3, 'qnfo-code-orchestrator', 1, 'active', 'failure-mode');

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'copilot-6712',
  'The merged VERSION-line fix cannot repair a task that keeps its old source snapshot',
  'UPSTREAM-429-TASK-RECOVERY-1: refresh ct_dk7c7rkpv4i7kb once without changing its goal',
  'D1: three patch-limit failures; cached VERSION line is 49508 characters. Current source already carries PR 6600.',
  'Retry queued, not yet verified; neither issue is closed',
  'One failed code task, its completion contract and a recurrence detector',
  'Rollback headers restore the task before leasing or progress and its contract from backups',
  'The upstream-429 task can benefit from the merged patch-budget fix',
  'One exhausted task reaches ready_to_publish or later without lowering verification',
  'No public reach change', 'node migrations/upstream-429-task-recovery.test.mjs; node qnfo-ops/patch-budget.test.mjs'
WHERE EXISTS (SELECT 1 FROM code_tasks WHERE id = 'ct_dk7c7rkpv4i7kb'
              AND json_extract(ctx, '$.recovery') = 'UPSTREAM-429-TASK-RECOVERY-1')
  AND NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'UPSTREAM-429-TASK-RECOVERY-1:%');
