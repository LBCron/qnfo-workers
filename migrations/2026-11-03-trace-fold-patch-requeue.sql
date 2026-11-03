-- TRACE-FOLD-PATCH-REQUEUE-1 (#6675, agent_issues 1001398; charter pillar: autonomy).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261103_trace_fold_task
-- Rollback: UPDATE code_tasks SET (status, step, attempts, model, ctx, branch, last_error, lease_until, updated_at) = (SELECT status, step, attempts, model, ctx, branch, last_error, lease_until, updated_at FROM bak_20261103_trace_fold_task b WHERE b.id = code_tasks.id) WHERE id IN (SELECT id FROM bak_20261103_trace_fold_task) AND status = 'queued' AND step = 'read' AND attempts = 0 AND lease_until IS NULL AND pr_url IS NULL AND json_extract(ctx, '$.recovery') = 'TRACE-FOLD-PATCH-REQUEUE-1';
-- Rollback (contract): UPDATE remediation_contracts SET (action, verify_probe, verify_transport, status, module, attempts, last_verdict, last_attempt_at, deferred_since, next_due_at) = (SELECT action, verify_probe, verify_transport, status, module, attempts, last_verdict, last_attempt_at, deferred_since, next_due_at FROM bak_20261103_trace_fold_contract b WHERE b.class = remediation_contracts.class) WHERE class IN (SELECT class FROM bak_20261103_trace_fold_contract) AND module = 'trace-fold-patch-requeue'; DELETE FROM remediation_contracts WHERE class = 'fm-trace-fold-stale-patch-snapshot'; DELETE FROM failure_modes WHERE fm_key = 'trace-fold-stale-patch-snapshot';
--
-- PR #6600 already separated the oversized VERSION release notes in qnfo-ops
-- 2.62.12. Its patch-budget suite proves a mirrored edit fits 80,000 characters.
-- This task still holds the old 773,436-character base with a 49,508-character
-- VERSION line. Re-proposing against that snapshot cannot benefit from the fix.
-- Prediction: one fresh read lets this task reach ready_to_publish or later
-- without changing its goal, the patch limit, or any verification gate.
-- Recovery is not evidence that the underlying RM-TRACE-FOLD-1 feature shipped.

CREATE TABLE IF NOT EXISTS bak_20261103_trace_fold_task AS
SELECT * FROM code_tasks
WHERE id = 'ct_1b8wspgbpz6fy2' AND repo = 'qnfo-workers'
  AND path = 'qnfo-ops/worker.js' AND status = 'failed' AND step = 'propose'
  AND pr_url IS NULL AND lease_until IS NULL
  AND last_error LIKE 'patch too large: exceeds verification limit%'
  AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 1001398 AND status = 'open');

CREATE TABLE IF NOT EXISTS bak_20261103_trace_fold_contract AS
SELECT * FROM remediation_contracts WHERE class = 'issue-1001398' AND issue_id = 1001398;

UPDATE code_tasks
SET status = 'queued', step = 'read', attempts = 0, model = NULL,
    ctx = json_object('anchor', COALESCE(json_extract(ctx, '$.anchor'),
                        'async function logToolEvent(env, name, args, res, ms) {'),
                      'recovery', 'TRACE-FOLD-PATCH-REQUEUE-1'),
    branch = NULL, last_error = NULL, lease_until = NULL,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 'ct_1b8wspgbpz6fy2' AND repo = 'qnfo-workers'
  AND path = 'qnfo-ops/worker.js' AND status = 'failed' AND step = 'propose'
  AND pr_url IS NULL AND lease_until IS NULL
  AND last_error LIKE 'patch too large: exceeds verification limit%'
  AND EXISTS (SELECT 1 FROM bak_20261103_trace_fold_task b
              WHERE b.id = code_tasks.id AND b.updated_at = code_tasks.updated_at
                AND b.ctx IS code_tasks.ctx AND b.last_error IS code_tasks.last_error)
  AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 1001398 AND status = 'open');

UPDATE remediation_contracts
SET action = 'TRACE-FOLD-PATCH-REQUEUE-1: the code loop owns the fresh retry. Close issue 1001398 only with verified task progression; issue 1000650 retains its separate runtime definition of done.',
    verify_probe = 'SELECT ''ready'' AS expected, CASE WHEN EXISTS (SELECT 1 FROM code_tasks WHERE id = ''ct_1b8wspgbpz6fy2'' AND status IN (''ready_to_publish'', ''publishing'', ''published'', ''pr_open'', ''merged'', ''deployed'') AND step = ''done'' AND last_error IS NULL) THEN ''ready'' ELSE ''pending'' END AS observed',
    verify_transport = 'd1-query', status = 'active', module = 'trace-fold-patch-requeue',
    attempts = 0, last_verdict = NULL, last_attempt_at = NULL, deferred_since = NULL,
    next_due_at = datetime('now')
WHERE class = 'issue-1001398' AND issue_id = 1001398
  AND module IS NOT 'trace-fold-patch-requeue'
  AND EXISTS (SELECT 1 FROM code_tasks WHERE id = 'ct_1b8wspgbpz6fy2'
              AND status = 'queued' AND step = 'read' AND attempts = 0
              AND json_extract(ctx, '$.recovery') = 'TRACE-FOLD-PATCH-REQUEUE-1');

INSERT OR IGNORE INTO failure_modes
  (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id)
VALUES
  ('trace-fold-stale-patch-snapshot', 'Trace-fold task repeats an oversized patch after the source fix',
   'The failed task retains the pre-6600 source snapshot and repeat-failure signatures',
   'Re-read main once after the VERSION-line fix; retain all verification limits',
   'The recovered trace-fold task must not fail again', 'fm-trace-fold-stale-patch-snapshot', '2026-11-03', 1001398);

INSERT OR IGNORE INTO remediation_contracts
  (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module)
VALUES
  ('fm-trace-fold-stale-patch-snapshot', NULL, 'TRACE-FOLD-PATCH-REQUEUE-1', 'failure-mode detector',
   'SELECT ''0'' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM code_tasks t JOIN bak_20261103_trace_fold_task b ON b.id = t.id WHERE t.updated_at IS NOT b.updated_at AND t.status IN (''failed'', ''needs_human'', ''publish_failed'')',
   'd1-query', 3, 'qnfo-code-orchestrator', 1, 'active', 'failure-mode');

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'copilot-6677',
  'The merged VERSION-line fix cannot repair a task that keeps its old source snapshot',
  'TRACE-FOLD-PATCH-REQUEUE-1: re-read and requeue ct_1b8wspgbpz6fy2 once',
  'D1: failed after four attempts on the patch limit; stored VERSION line is 49508 characters. PR 6600 already fixes current source.',
  'Retry queued, not yet verified; neither issue is closed',
  'One failed code task, its completion contract and a recurrence detector',
  'Rollback header restores task before leasing or progress and restores its contract from backup',
  'Trace-fold task can benefit from the merged patch-budget fix without a stale proposal',
  'One exhausted task reaches ready_to_publish or later without relaxing verification',
  'No public reach change', 'node migrations/trace-fold-patch-requeue.test.mjs; node qnfo-ops/patch-budget.test.mjs'
WHERE EXISTS (SELECT 1 FROM code_tasks WHERE id = 'ct_1b8wspgbpz6fy2'
              AND json_extract(ctx, '$.recovery') = 'TRACE-FOLD-PATCH-REQUEUE-1')
  AND NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'TRACE-FOLD-PATCH-REQUEUE-1:%');
