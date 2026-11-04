-- INTAKE-PATH-PUNCT-2 (2026-11-04, charter pillar autonomy; own the close of agent_issues 1001576 / mirror 7098).
-- Why the issue is still open: INTAKE-PATH-PUNCT-1 (qnfo-code-orchestrator 0.41.2, PR 7109, merged 2026-11-04 19:24+01:00, live: /health reports 0.46.0) stops new
-- tasks from storing "path=scripts/x.py;", but three failed tasks written before it still carry the punctuation (ct_im1000518 and ct_im1000618 "scripts/bp26_web.py;",
-- ct_im1000521 "qnfo-email/worker.js;"; created 03:36Z, 04:36Z and 16:36Z, all before the merge). The issue's closing probe
-- (contract issue-1001576: code_tasks rows whose path ends in ';' or ' ') reads those three rows, so it fails every hour (last_verdict fail, 4 attempts) and the
-- issue cannot close although the cause is fixed. No code_task created after the merge has trailing punctuation (SELECT ... WHERE path LIKE '%;' returns only these three).
-- Change: trim the stray ';' from the three dead rows (status stays failed; their re-proposals carry clean paths). The probe then reads 'none' and the loop that filed
-- the issue closes it. A second entry point, enqueue() in the code orchestrator (POST /task: `let path0 = String(b.path).trim();`), does not run cleanIntakePath;
-- it is filed below as a doer issue because the file is held by another session's work claim (F1-research-reach/D).
-- Prediction: contract issue-1001576 reads 'none' on its next run (within 60 minutes of the apply) and the issue closes on its own probe.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261104_code_task_paths
-- Rollback: UPDATE code_tasks SET path = (SELECT b.path FROM bak_20261104_code_task_paths b WHERE b.id = code_tasks.id) WHERE id IN (SELECT id FROM bak_20261104_code_task_paths); DELETE FROM agent_issues WHERE title = 'INTAKE-PATH-PUNCT-2: enqueue() must clean a task path like the intake does' AND status = 'open';
-- CAUSE-MAPPED: registers no metric_registry row.

CREATE TABLE IF NOT EXISTS bak_20261104_code_task_paths AS
SELECT id, path FROM code_tasks WHERE id IN ('ct_im1000518', 'ct_im1000521', 'ct_im1000618');

UPDATE code_tasks SET path = rtrim(path, char(59) || ' ')
WHERE id IN ('ct_im1000518', 'ct_im1000521', 'ct_im1000618') AND rtrim(path, char(59) || ' ') <> path;

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'INTAKE-PATH-PUNCT-2: enqueue() must clean a task path like the intake does',
'Charter pillar: autonomy. Metric it should move: code_goal_success_rate_30d (tasks refused by the merge scope for a path that carries punctuation).

Evidence: qnfo-code-orchestrator/worker.js enqueue() takes `let path0 = String(b.path).trim();` from the POST /task body and stores it unchanged; INTAKE-PATH-PUNCT-1 (0.41.2, PR 7109) cleaned only the issue-intake parser (`m[2] = cleanIntakePath(m[2])`). Any other caller (fleet-control dispatch, a session) that sends "scripts/x.py;" still stores the punctuation and the merge runner refuses it (MERGE-SCOPE-AT-READ-1).

Change: in enqueue() clean the path with the existing cleanIntakePath() before the folded-target, scope, liveness and claim checks; add a case to qnfo-code-orchestrator/intake-path-punct.test.mjs that the create route calls it. Bump VERSION (patch) with scripts/worker_release.py and keep deployed-current.worker.js identical.

Definition of done: the code-probe below passes on main, intake-path-punct.test.mjs asserts the create route, and no code_tasks row created after the deploy has a path ending in punctuation.

code-task: repo=qnfo-workers path=qnfo-code-orchestrator/worker.js
code-anchor: let path0 = String(b.path).trim();
code-probe: {"paths": ["qnfo-code-orchestrator/worker.js"], "contains": "let path0 = cleanIntakePath(String(b.path).trim());"}',
'intake-path-punct-2', 'reliability', 'medium', 'open', datetime('now'), datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE status = 'open' AND title = 'INTAKE-PATH-PUNCT-2: enqueue() must clean a task path like the intake does');
