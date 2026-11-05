-- TASK-ISSUE-CLOSED-1 (2026-11-05, pillar autonomy; issue-backlog cluster, slice "loop failures"): a queued code task whose issue is already closed is superseded, now and every hour.
--
-- WHAT WAS MEASURED (qnfo-audit SELECT only, 2026-11-04 23:30Z)
--   code_tasks holds 62 queued tasks. For 20 of them the issue they were written for is closed: 18 CF-OBS-ISSUE-1, CRON-FAULT-1 worker-silent, D1-OVERLOAD-1x and CROSS-LINK tasks (idea-hub 1001629/1001670/1001710,
--   qnfo-ai 1001654, qnfo-fleet-dashboard 1001653/1001655/1001729, qnfo-model-eval 1001544/1001545/1001555, qnfo-pdf 1001490, qnfo-research-exec 1001479, qnfo-subscribers 1001586/1001587/1001588,
--   qnfo-youtube-shorts 1001502, radar-hub 1001503/1001585), closed by the verified-remediation trigger or by the D1-overload fold, and two METRIC-TRIGGER tasks (left to their own cluster).
--   Nothing retires a task when its issue closes: statuses of code_tasks are queued 62, superseded 559, failed 317, merged 427, closed 106, and none of the 18 carries a supersede reason. The tasks are
--   not harmless: the planner's per-file work-in-progress gate counts queued tasks (26 files hold them), and the code loop holds a live work claim for each (/work-locks: file:qnfo-model-eval/worker.js held by
--   qnfo-code-orchestrator:ct_im1001544 for a closed D1-overload issue), so a real change to that file waits for a task that can never produce one.
--   The D1-overload tasks are the clearest case: "D1 DB is overloaded" is a platform condition the umbrella issue 1001715 tracks, and no edit of the worker removes it.
--
-- WHAT THIS FILE DOES
--   1. Backs up the queued rows (id, status, last_error, updated_at) in bak_20261105_stale_code_tasks.
--   2. Supersedes every queued task whose issue (task id ct_im<issue id>, or the "[issue #<id>]" head of a goal) is closed, resolved or wontfix, and whose issue is not a METRIC-TRIGGER or BREACH-DOCTOR-1
--      issue (those belong to the metric-trigger cluster). The reason is written to last_error; nothing is deleted; the revert is status = 'queued'.
--   3. Appends the same statement to the hourly workflow issue-meta-fold (step name task-issue-closed), so a task is retired within the hour after its issue closes. A reopened issue is
--      requeued by the intake as before (the task row is not needed for that).
--   Prediction (decision_log): queued tasks 62 to 44 on apply, the stale-claim rows of the code loop in /work-locks fall by the same 18, and queued tasks of closed issues stay at 0.
--
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE code_tasks SET status = 'queued', last_error = (SELECT b.last_error FROM bak_20261105_stale_code_tasks b WHERE b.id = code_tasks.id) WHERE id IN (SELECT id FROM bak_20261105_stale_code_tasks) AND status = 'superseded' AND instr(COALESCE(last_error, ''), 'TASK-ISSUE-CLOSED-1:') = 1; UPDATE fleet_tasks SET definition = (SELECT b.definition FROM bak_20261105_fleet_task_issue_meta_fold_tic b WHERE b.id = 'issue-meta-fold'), version = version + 1, updated_at = datetime('now') WHERE id = 'issue-meta-fold' AND EXISTS (SELECT 1 FROM bak_20261105_fleet_task_issue_meta_fold_tic);
-- CAUSE-MAPPED: no metric is registered here; this supersedes queued tasks and appends one workflow statement.

CREATE TABLE IF NOT EXISTS bak_20261105_stale_code_tasks AS SELECT id, status, last_error, updated_at FROM code_tasks WHERE status = 'queued';

CREATE TABLE IF NOT EXISTS bak_20261105_fleet_task_issue_meta_fold_tic AS SELECT id, version, definition, updated_at FROM fleet_tasks WHERE id = 'issue-meta-fold';

UPDATE code_tasks SET status = 'superseded', last_error = 'TASK-ISSUE-CLOSED-1: the issue this task serves is closed; superseded so the queue and the file claims hold only live work (revert: status queued)', updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE status = 'queued' AND (id LIKE 'ct_im%' OR goal LIKE '[issue #%') AND EXISTS (SELECT 1 FROM agent_issues a WHERE a.id = CASE WHEN code_tasks.id LIKE 'ct_im%' THEN CAST(substr(code_tasks.id, 6) AS INTEGER) ELSE CAST(substr(code_tasks.goal, 9) AS INTEGER) END AND a.status IN ('closed', 'resolved', 'wontfix') AND a.title NOT LIKE 'METRIC-TRIGGER-%' AND a.title NOT LIKE 'BREACH-DOCTOR-1%');

UPDATE fleet_tasks
SET definition = json_insert(definition, '$.steps[#]', json_object('type', 'sql', 'db', 'AUDIT', 'name', 'task-issue-closed', 'sql', 'UPDATE code_tasks SET status = ''superseded'', last_error = ''TASK-ISSUE-CLOSED-1: the issue this task serves is closed; superseded so the queue and the file claims hold only live work (revert: status queued)'', updated_at = strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'') WHERE status = ''queued'' AND (id LIKE ''ct_im%'' OR goal LIKE ''[issue #%'') AND EXISTS (SELECT 1 FROM agent_issues a WHERE a.id = CASE WHEN code_tasks.id LIKE ''ct_im%'' THEN CAST(substr(code_tasks.id, 6) AS INTEGER) ELSE CAST(substr(code_tasks.goal, 9) AS INTEGER) END AND a.status IN (''closed'', ''resolved'', ''wontfix'') AND a.title NOT LIKE ''METRIC-TRIGGER-%'' AND a.title NOT LIKE ''BREACH-DOCTOR-1%'')')),
    version = version + 1,
    updated_at = datetime('now')
WHERE id = 'issue-meta-fold' AND json_valid(definition) AND instr(definition, 'TASK-ISSUE-CLOSED-1') = 0;

-- the drift gate compares fleet_tasks with fleet_tasks_canonical: a canonical row, when there is one, moves with the live one and only when it matched the definition replaced
UPDATE fleet_tasks_canonical
SET definition = (SELECT t.definition FROM fleet_tasks t WHERE t.id = 'issue-meta-fold'),
    repo_path = 'migrations/2026-11-05-stale-code-tasks.sql',
    exported_at = datetime('now')
WHERE id = 'issue-meta-fold'
  AND definition = (SELECT b.definition FROM bak_20261105_fleet_task_issue_meta_fold_tic b WHERE b.id = 'issue-meta-fold')
  AND instr((SELECT t.definition FROM fleet_tasks t WHERE t.id = 'issue-meta-fold'), 'TASK-ISSUE-CLOSED-1') > 0;

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:breach-issues-loop-failures',
  'A queued code task is work for an open issue; when the issue is closed with evidence its task cannot be needed, and a task that waits for ever only blocks the planner gate and holds a file claim.',
  'TASK-ISSUE-CLOSED-1: supersede queued code tasks whose issue is closed, resolved or wontfix (not METRIC-TRIGGER or BREACH-DOCTOR-1), once now and hourly in issue-meta-fold.',
  'qnfo-audit 2026-11-04 23:30Z: 62 queued code_tasks, 20 with a closed issue (18 outside METRIC-TRIGGER); /work-locks shows code-loop claims for closed D1-overload issues (qnfo-model-eval/worker.js held by ct_im1001544); code_tasks statuses show no supersede reason on any of them; offline suite migrations/stale-code-tasks.test.mjs',
  'pending canonical migration; measured by SELECT COUNT(*) FROM code_tasks t JOIN agent_issues a ... status queued and issue closed',
  'queued code_tasks rows of closed issues (18 at apply) and one workflow step; backup bak_20261105_stale_code_tasks',
  'Rollback line of migrations/2026-11-05-stale-code-tasks.sql sets the superseded rows back to queued and restores the workflow definition',
  'the code-loop queue and its file claims hold only work for open issues',
  'queued code tasks 62 to 44; queued tasks of closed issues 18 to 0 and they stay at 0',
  'not a reach change; frees the planner gate for real work',
  'node:sqlite suite migrations/stale-code-tasks.test.mjs (closed issue superseded, open issue and METRIC-TRIGGER kept, both id shapes, workflow step identical to the direct statement, idempotent)'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'TASK-ISSUE-CLOSED-1:%');
