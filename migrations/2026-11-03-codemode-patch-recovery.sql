-- CODEMODE-PATCH-RECOVERY-1 (#6599, agent_issues 1001341; charter pillar: autonomy).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261103_codemode_patch
-- Rollback: UPDATE code_tasks SET (status, step, attempts, ctx, last_error, lease_until, updated_at) = (SELECT status, step, attempts, ctx, last_error, lease_until, updated_at FROM bak_20261103_codemode_patch WHERE id = code_tasks.id) WHERE id IN (SELECT id FROM bak_20261103_codemode_patch) AND status = 'queued' AND step = 'read' AND attempts = 0 AND json_extract(ctx, '$.recovery') = 'CODEMODE-PATCH-RECOVERY-1';
-- Rollback (contract): UPDATE remediation_contracts SET (verify_probe, verify_transport, status) = (SELECT verify_probe, verify_transport, status FROM bak_20261103_codemode_contract WHERE class = remediation_contracts.class) WHERE class IN (SELECT class FROM bak_20261103_codemode_contract); DELETE FROM remediation_contracts WHERE class = 'fm-ops-version-line-patch-budget'; DELETE FROM failure_modes WHERE fm_key = 'ops-version-line-patch-budget';
--
-- The 49,642-character VERSION line made a tiny edit plus the automatic bump
-- exceed MAX_PATCH_CHARS (80,000) once source and mirror were included.
-- qnfo-ops 2.62.12 splits the existing notes without changing executable code.
-- Prediction: the representative mirrored patch falls from 206,928 to 8,890
-- characters, and this task can reach ready_to_publish without relaxing a gate.
-- Re-read main, discard stale edits and repeat-signature state, and preserve the
-- original anchor. Never restart a task another executor has already advanced.

CREATE TABLE IF NOT EXISTS bak_20261103_codemode_patch AS
  SELECT id, status, step, attempts, ctx, last_error, lease_until, updated_at
  FROM code_tasks
  WHERE id = 'ct_zh51q9gmwza5gw' AND repo = 'qnfo-workers'
    AND path = 'qnfo-ops/worker.js' AND status = 'failed'
    AND last_error LIKE 'patch too large: exceeds verification limit%';

CREATE TABLE IF NOT EXISTS bak_20261103_codemode_contract AS
  SELECT class, verify_probe, verify_transport, status FROM remediation_contracts
  WHERE class = 'issue-1001341';

UPDATE code_tasks
SET status = 'queued', step = 'read', attempts = 0, lease_until = NULL,
    last_error = NULL,
    ctx = json_object('anchor', COALESCE(json_extract(ctx, '$.anchor'), 'var OPS_TOOLS = ['),
                      'recovery', 'CODEMODE-PATCH-RECOVERY-1'),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 'ct_zh51q9gmwza5gw' AND repo = 'qnfo-workers'
  AND path = 'qnfo-ops/worker.js' AND status = 'failed'
  AND last_error LIKE 'patch too large: exceeds verification limit%'
  AND EXISTS (SELECT 1 FROM bak_20261103_codemode_patch b
              WHERE b.id = code_tasks.id AND b.updated_at = code_tasks.updated_at
                AND b.ctx IS code_tasks.ctx)
  AND (lease_until IS NULL OR julianday(lease_until) < julianday('now'));

INSERT OR IGNORE INTO failure_modes
  (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id)
VALUES
  ('ops-version-line-patch-budget', 'Small qnfo-ops edits exceed the code-loop patch verification limit',
   'Release notes shared the VERSION line; a required version bump duplicated that entire line in source and mirror',
   'Split release-note blocks below VERSION, retain the verifier limit, and re-read the failed task',
   'qnfo-ops/patch-budget.test.mjs and fm-ops-version-line-patch-budget',
   'fm-ops-version-line-patch-budget', '2026-11-03', 1001341);

INSERT OR IGNORE INTO remediation_contracts
  (class, issue_id, precondition, action, verify_probe, verify_transport,
   max_attempts, escalate_to, expected_cadence_h, status)
VALUES
  ('fm-ops-version-line-patch-budget', NULL, 'CODEMODE-PATCH-RECOVERY-1',
   'Detect recurrence on the recovered task; do not lower verification limits',
   'SELECT ''0'' AS expected, COUNT(*) AS observed FROM code_tasks WHERE id = ''ct_zh51q9gmwza5gw'' AND status = ''failed'' AND last_error LIKE ''patch too large: exceeds verification limit%''',
   'd1-query', 3, 'qnfo-code-orchestrator', 1, 'active');

UPDATE remediation_contracts
SET verify_probe = 'SELECT ''1'' AS expected, CASE WHEN EXISTS (SELECT 1 FROM code_tasks WHERE id = ''ct_zh51q9gmwza5gw'' AND status IN (''ready_to_publish'', ''publishing'', ''pr_open'', ''merged'', ''deployed'')) THEN ''1'' ELSE ''0'' END AS observed',
    verify_transport = 'd1-query', status = 'active'
WHERE class = 'issue-1001341';
