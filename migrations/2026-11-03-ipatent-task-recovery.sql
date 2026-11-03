-- IPATENT-TASK-RECOVERY-1 (#6720, agent_issues 1001426; charter pillar: autonomy).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261103_ipatent_task
-- Rollback: UPDATE code_tasks SET (status, step, attempts, model, ctx, branch, last_error, lease_until, updated_at) = (SELECT status, step, attempts, model, ctx, branch, last_error, lease_until, updated_at FROM bak_20261103_ipatent_task b WHERE b.id = code_tasks.id) WHERE id IN (SELECT id FROM bak_20261103_ipatent_task) AND status = 'queued' AND step = 'read' AND attempts = 0 AND lease_until IS NULL AND pr_url IS NULL AND json_extract(ctx, '$.recovery') = 'IPATENT-TASK-RECOVERY-1';
-- Rollback (contract): UPDATE remediation_contracts SET (action, verify_probe, verify_transport, status, module, attempts, last_verdict, last_attempt_at, deferred_since, next_due_at) = (SELECT action, verify_probe, verify_transport, status, module, attempts, last_verdict, last_attempt_at, deferred_since, next_due_at FROM bak_20261103_ipatent_contract b WHERE b.class = remediation_contracts.class) WHERE class IN (SELECT class FROM bak_20261103_ipatent_contract) AND module = 'ipatent-task-recovery'; DELETE FROM remediation_contracts WHERE class = 'fm-ipatent-task-search-recovery'; DELETE FROM failure_modes WHERE fm_key = 'ipatent-task-search-recovery';
--
-- The goal already names ipatentUsage, but ctx.anchor retained a help string.
-- Re-read at the intended function, discarding the stale window and signatures.
-- Prediction: this one exhausted task reaches ready_to_publish or later without
-- changing its goal, exact-match rules, suites, or later retirement obligations.

CREATE TABLE IF NOT EXISTS bak_20261103_ipatent_task AS
SELECT * FROM code_tasks
WHERE id = 'ct_im1000598' AND repo = 'qnfo-workers'
  AND path = 'qnfo-fleet-dashboard/worker.js' AND status = 'failed' AND step = 'propose'
  AND pr_url IS NULL AND lease_until IS NULL
  AND last_error LIKE '%SEARCH text occurs 0 times%'
  AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 1001426 AND status = 'open');

CREATE TABLE IF NOT EXISTS bak_20261103_ipatent_contract AS
SELECT * FROM remediation_contracts WHERE class = 'issue-1001426' AND issue_id = 1001426;

UPDATE code_tasks
SET status = 'queued', step = 'read', attempts = 0, model = NULL,
    ctx = json_object('anchor', 'async function ipatentUsage(env) {',
                      'recovery', 'IPATENT-TASK-RECOVERY-1'),
    branch = NULL, last_error = NULL, lease_until = NULL,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 'ct_im1000598' AND repo = 'qnfo-workers'
  AND path = 'qnfo-fleet-dashboard/worker.js' AND status = 'failed' AND step = 'propose'
  AND pr_url IS NULL AND lease_until IS NULL
  AND last_error LIKE '%SEARCH text occurs 0 times%'
  AND EXISTS (SELECT 1 FROM bak_20261103_ipatent_task b
              WHERE b.id = code_tasks.id AND b.updated_at = code_tasks.updated_at
                AND b.ctx IS code_tasks.ctx AND b.last_error IS code_tasks.last_error)
  AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 1001426 AND status = 'open');

UPDATE remediation_contracts
SET action = 'IPATENT-TASK-RECOVERY-1: qnfo-code-orchestrator owns the fresh retry. Close issue 1001426 only on verified task progression; issue 1000598 retains its full retirement definition of done.',
    verify_probe = 'SELECT ''ready'' AS expected, CASE WHEN EXISTS (SELECT 1 FROM code_tasks WHERE id = ''ct_im1000598'' AND status IN (''ready_to_publish'', ''publishing'', ''published'', ''pr_open'', ''merged'', ''deployed'') AND step = ''done'' AND last_error IS NULL) THEN ''ready'' ELSE ''pending'' END AS observed',
    verify_transport = 'd1-query', status = 'active', module = 'ipatent-task-recovery',
    attempts = 0, last_verdict = NULL, last_attempt_at = NULL, deferred_since = NULL,
    next_due_at = datetime('now')
WHERE class = 'issue-1001426' AND issue_id = 1001426
  AND module IS NOT 'ipatent-task-recovery'
  AND EXISTS (SELECT 1 FROM code_tasks WHERE id = 'ct_im1000598'
              AND status = 'queued' AND step = 'read' AND attempts = 0
              AND json_extract(ctx, '$.recovery') = 'IPATENT-TASK-RECOVERY-1');

INSERT OR IGNORE INTO failure_modes
  (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id)
VALUES
  ('ipatent-task-search-recovery', 'Dashboard retirement task exhausts SEARCH retries',
   'A stale help-string window and truncated repair hints prevent a verbatim SEARCH',
   'Return complete source lines and re-read once at the intended function anchor',
   'The recovered task must not fail again', 'fm-ipatent-task-search-recovery', '2026-11-03', 1001426);

INSERT OR IGNORE INTO remediation_contracts
  (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module)
VALUES
  ('fm-ipatent-task-search-recovery', NULL, 'IPATENT-TASK-RECOVERY-1', 'failure-mode detector',
   'SELECT ''0'' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM code_tasks t JOIN bak_20261103_ipatent_task b ON b.id = t.id WHERE t.updated_at IS NOT b.updated_at AND t.status IN (''failed'', ''needs_human'', ''publish_failed'')',
   'd1-query', 3, 'qnfo-code-orchestrator', 1, 'active', 'failure-mode');

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'copilot-6720',
  'The intended function anchor is present but the failed task retained its help-string window',
  'IPATENT-TASK-RECOVERY-1: re-read and requeue ct_im1000598 once',
  'D1: failed after nine attempts; rejected SEARCH concatenates a string where source uses an array entry',
  'Retry queued, not yet verified; neither issue is closed',
  'One failed code task, its completion contract and a recurrence detector',
  'Rollback headers restore the task before leasing or progress and its contract from backup',
  'Repair hints preserve complete source lines; the task receives a fresh function window',
  'One exhausted task reaches ready_to_publish or later without relaxing verification',
  'No public reach change', 'node migrations/ipatent-task-recovery.test.mjs; node qnfo-code-orchestrator/edit-repair-hints.test.mjs'
WHERE EXISTS (SELECT 1 FROM code_tasks WHERE id = 'ct_im1000598'
              AND json_extract(ctx, '$.recovery') = 'IPATENT-TASK-RECOVERY-1')
  AND NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'IPATENT-TASK-RECOVERY-1:%');
