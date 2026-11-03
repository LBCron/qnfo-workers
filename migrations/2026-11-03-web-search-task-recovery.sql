-- WEB-SEARCH-TASK-RECOVERY-1 (#6704, agent_issues 1001410; charter pillar: autonomy).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261103_web_search_task
-- Rollback: UPDATE code_tasks SET (goal, status, step, attempts, model, ctx, last_error, updated_at) = (SELECT goal, status, step, attempts, model, ctx, last_error, updated_at FROM bak_20261103_web_search_task b WHERE b.id = code_tasks.id) WHERE id IN (SELECT id FROM bak_20261103_web_search_task) AND status = 'queued' AND step = 'read' AND attempts = 0 AND lease_until IS NULL AND branch IS NULL AND pr_url IS NULL AND json_extract(ctx, '$.recovery') = 'WEB-SEARCH-TASK-RECOVERY-1';
-- Rollback (contract): UPDATE remediation_contracts SET (action, verify_probe, verify_transport, status, module, attempts, last_verdict, last_attempt_at, deferred_since, next_due_at) = (SELECT action, verify_probe, verify_transport, status, module, attempts, last_verdict, last_attempt_at, deferred_since, next_due_at FROM bak_20261103_web_search_contract b WHERE b.class = remediation_contracts.class) WHERE class IN (SELECT class FROM bak_20261103_web_search_contract) AND module = 'web-search-task-recovery'; DELETE FROM remediation_contracts WHERE class = 'fm-web-search-stale-patch'; DELETE FROM failure_modes WHERE fm_key = 'web-search-stale-patch';
--
-- D1 read 2026-11-03: ct_x2hh0z7m4z7svk failed three times with a
-- 49,508-character VERSION line. Its existing replacement ct_q3lctlj7ozkdsn
-- is queued at commit with the same error in ctx and a 49,503-character line.
-- Main already separates those notes (PR 6600); patch-budget.test.mjs proves
-- a mirrored edit fits 80,000 characters. Refresh the replacement, not both
-- tasks. Correct the goal's nonexistent query variable and const reassignment.
-- Prediction: the replacement reaches ready_to_publish or later without
-- relaxing any verifier. Neither requeue nor readiness proves issue 1000810's
-- forced-fallback runtime outcome; that issue and its contract remain untouched.

CREATE TABLE IF NOT EXISTS bak_20261103_web_search_task AS
SELECT * FROM code_tasks
WHERE id = 'ct_q3lctlj7ozkdsn' AND repo = 'qnfo-workers'
  AND path = 'qnfo-ops/worker.js' AND instr(goal, '[issue #1000810]') = 1
  AND status = 'queued' AND step = 'commit'
  AND branch IS NULL AND pr_url IS NULL AND lease_until IS NULL
  AND json_extract(ctx, '$.mode') = 'patch'
  AND json_extract(ctx, '$.lastError') = 'patch too large: exceeds verification limit'
  AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 1001410 AND status = 'open')
  AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 1000810 AND status = 'open');

CREATE TABLE IF NOT EXISTS bak_20261103_web_search_contract AS
SELECT * FROM remediation_contracts WHERE class = 'issue-1001410' AND issue_id = 1001410;

UPDATE code_tasks
SET goal = '[issue #1000810] WEB-SEARCH-TASK-RECOVERY-1: add a bounded fallback inside webSearchTool only.'
    || char(10) || 'Keep the existing primary fetch and parser. Replace only the zero-results return and the following success return. Default pathUsed to primary. When results.length is zero, fetch https://lite.duckduckgo.com/lite/?q= plus encodeURIComponent(q), using the existing local q, not query. Check the HTTP status before parsing.'
    || char(10) || 'Parse only result-link anchors from the lite markup, accepting either attribute order and single or double quotes. Push at most k title/url/snippet objects into the existing const results array; never reassign results or return navigation links. Reuse stripHtml and the existing uddg URL decoding. Use an empty snippet when none is available.'
    || char(10) || 'Return the existing ok/results fields plus path naming primary or fallback. Mark fallback when it is attempted. If both parsers yield zero results or the fallback fetch fails, return ok:false with an explicit error and path:fallback, never a successful empty result. Preserve the existing primary error behavior.'
    || char(10) || 'Keep the final mirrored unified patch within the existing 80000-character verification limit. Do not edit VERSION, release notes, tool catalogues, or unrelated functions; the loop bumps and mirrors the source. Existing verifiers and suites must pass. Issue 1001410 closes only on verified ready_to_publish or later; issue 1000810 still requires its live forced-fallback probe.',
    status = 'queued', step = 'read', attempts = 0, model = NULL,
    ctx = json_object('anchor', 'async function webSearchTool(env, args) {',
                      'recovery', 'WEB-SEARCH-TASK-RECOVERY-1'),
    last_error = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 'ct_q3lctlj7ozkdsn' AND status = 'queued' AND step = 'commit'
  AND branch IS NULL AND pr_url IS NULL AND lease_until IS NULL
  AND EXISTS (SELECT 1 FROM bak_20261103_web_search_task b
              WHERE b.id = code_tasks.id AND b.updated_at = code_tasks.updated_at
                AND b.ctx IS code_tasks.ctx AND b.goal = code_tasks.goal
                AND b.last_error IS code_tasks.last_error)
  AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 1001410 AND status = 'open')
  AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 1000810 AND status = 'open');

UPDATE remediation_contracts
SET action = 'WEB-SEARCH-TASK-RECOVERY-1: the code loop owns replacement ct_q3lctlj7ozkdsn. Close issue 1001410 only on verified task readiness; issue 1000810 retains its live forced-fallback definition of done.',
    verify_probe = 'SELECT ''ready'' AS expected, CASE WHEN EXISTS (SELECT 1 FROM code_tasks WHERE id = ''ct_q3lctlj7ozkdsn'' AND status IN (''ready_to_publish'', ''publishing'', ''published'', ''pr_open'', ''merged'', ''deployed'') AND step = ''done'' AND last_error IS NULL) THEN ''ready'' ELSE ''pending'' END AS observed',
    verify_transport = 'd1-query', status = 'active', module = 'web-search-task-recovery',
    attempts = 0, last_verdict = NULL, last_attempt_at = NULL, deferred_since = NULL,
    next_due_at = datetime('now')
WHERE class = 'issue-1001410' AND issue_id = 1001410
  AND module IS NOT 'web-search-task-recovery'
  AND EXISTS (SELECT 1 FROM code_tasks WHERE id = 'ct_q3lctlj7ozkdsn'
              AND status = 'queued' AND step = 'read' AND attempts = 0
              AND json_extract(ctx, '$.recovery') = 'WEB-SEARCH-TASK-RECOVERY-1');

INSERT OR IGNORE INTO failure_modes
  (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id)
VALUES
  ('web-search-stale-patch', 'Web-search replacement repeats an oversized patch after the source fix',
   'Both tasks cache pre-6600 VERSION lines; the replacement goal also names query instead of q and reassigns const results',
   'Re-read main once with a function-local goal, preserving all verification limits',
   'The recovered replacement must not fail again', 'fm-web-search-stale-patch', '2026-11-03', 1001410);

INSERT OR IGNORE INTO remediation_contracts
  (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module)
VALUES
  ('fm-web-search-stale-patch', NULL, 'WEB-SEARCH-TASK-RECOVERY-1', 'failure-mode detector',
   'SELECT ''0'' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM code_tasks t JOIN bak_20261103_web_search_task b ON b.id = t.id WHERE t.updated_at IS NOT b.updated_at AND t.status IN (''failed'', ''needs_human'', ''publish_failed'')',
   'd1-query', 3, 'qnfo-code-orchestrator', 1, 'active', 'failure-mode');

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'copilot-6706',
  'The existing replacement needs a fresh source snapshot, not a second concurrent retry',
  'WEB-SEARCH-TASK-RECOVERY-1: narrow and refresh ct_q3lctlj7ozkdsn once',
  'D1: original failed three times; replacement queued at commit retains the patch-limit error and a 49503-character VERSION line; current patch-budget suite passes',
  'Retry queued, not verified; both issues remain open',
  'One unleased unpublished replacement task, its completion contract and a recurrence detector',
  'Rollback headers restore the task before progress and its contract from backups',
  'Existing web-search replacement can use the merged patch-budget fix with a valid local goal',
  'One exhausted-task replacement reaches ready_to_publish or later without lowering verification',
  'No public reach change', 'node migrations/web-search-task-recovery.test.mjs; node qnfo-ops/patch-budget.test.mjs'
WHERE EXISTS (SELECT 1 FROM code_tasks WHERE id = 'ct_q3lctlj7ozkdsn'
              AND json_extract(ctx, '$.recovery') = 'WEB-SEARCH-TASK-RECOVERY-1')
  AND NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'WEB-SEARCH-TASK-RECOVERY-1:%');
