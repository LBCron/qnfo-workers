-- CODE-TASKS-CTX-COMPACT-1 (2026-11-04, charter pillar cost; D1 overload family D1-OVERLOAD-1; owner: "table rows are bloated and need to be regularly swept", RETENTION-SWEEP-1).
-- Measured 2026-11-04 ~17:35Z on qnfo-audit. Three statements that read code_tasks.ctx were among the top consumers of D1 TIME in 17:00-17:12Z while reading almost no rows:
--   qnfo-fleet-control cmCloseSuperseded:  SELECT ... FROM code_tasks WHERE ctx LIKE '%superseded_pr%' ...            14 calls, 39 s of D1 time (2.8 s each, 1.4 K rows)
--   qnfo-code-orchestrator claimsSweep:    SELECT ... WHERE status IN (...) AND json_extract(ctx, '$.claim.token') ...   27 + 39 calls, 33 s + 10 s
--   about 82 s of D1 time in 12 minutes, about 11 % of the single-threaded database, for the cost of parsing text, not of rows.
-- Cause: code_tasks.ctx holds the working blobs of the code loop and nothing removes them when a task is finished. 1,428 tasks hold 325 MB of ctx: merged 133.9 MB (425), superseded 93.7 MB (550),
-- failed 73.3 MB (314), closed 19.2 MB (105). On a sample of 40 finished tasks, ctx.base (the repository file as read when the task started, average 281 KB, up to 801 KB) is 85 % of the bytes,
-- ctx.patch 11 %, ctx.win_text 2.5 %, ctx.x 1.5 %; the keys the readers use (claim, anchor, superseded_pr, sigs, lastError, edits, suite_rebase_reason) total under 3 KB.
-- Resumability (read before widening this): the trigger code_task_rearm_on_blocker_close sets a SUPERSEDED task back to queued, at the step it stopped at (34 superseded tasks sit at propose, 5 at verify),
-- when an issue named in its merge_note closes; propose then builds on ctx.base, which a compacted task no longer has. A superseded task whose merge_note is empty cannot match that trigger's
-- LIKE '%#<id>%' (515 of 550), so only those are compacted; the 35 with a note keep their ctx (about 6 MB). A merged task still deploying or reverting (merge_state deploying, deployed, reverting, revert-failed)
-- keeps its ctx for the canary revert path. Every other requeue path in the code (qnfo-code-orchestrator 2392, 3814) sets step = 'read', which rebuilds ctx.base from the repository.
-- Change: an incremental retention trigger on fleet_tick_heavy (every ~10 minutes) removes the four blob keys with json_remove from at most 40 finished tasks per tick: status merged (not deploying or reverting), closed or
-- superseded (empty merge_note) and not updated for 2 days, or failed and not updated for 7 days (an ISO updated_at; a few rows hold an epoch number and are left alone), ctx larger than 20,000 characters. Every other key is kept, so claim sweeps, anchors and superseded_pr
-- still work; nothing else on the row changes (updated_at and status are not touched, no other trigger fires: the only UPDATE OF ctx trigger is the JSON-validity guard). The ledger
-- code_task_ctx_compacted records task, status, bytes before and after, keys removed and batch. The removed content is derived and recoverable: base is the repository file at the task's start
-- (git history of path, branch and merged_sha), patch is the pull request diff (pr_url).
-- Prediction: about 240 MB of the 325 MB (merged, closed, superseded without a merge_note older than 2 days, failed older than 7: about 1,100 tasks, at 40 a tick, about 5 hours) -> under 5 MB; total code_tasks ctx 325 MB -> about 85 MB
-- (younger finished tasks and active ones stay until they age); the three statements above fall from about 82 s per 12 minutes of D1 time to about 20 s. Verify: SELECT SUM(length(ctx)) FROM code_tasks, the ledger, and the same GraphQL by D1 time.
-- Off switch: ops_config code_tasks_ctx_compact = off.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DROP TRIGGER IF EXISTS code_tasks_ctx_compact_tick; the removed blobs are not restored (they are recoverable from git, see above); DROP TABLE IF EXISTS code_task_ctx_compacted when its rows are no longer wanted
-- spof-review: one retention trigger on fleet_tick_heavy (a failure there is logged by the orchestrator and never stops fleet_tick), one small ledger table.
-- CAUSE-MAPPED: registers no metric_registry row.

CREATE TABLE IF NOT EXISTS code_task_ctx_compacted (
  task_id TEXT PRIMARY KEY, status TEXT, bytes_before INTEGER, bytes_after INTEGER, keys_removed TEXT, batch INTEGER,
  compacted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TRIGGER IF NOT EXISTS code_tasks_ctx_compact_tick AFTER INSERT ON fleet_tick_heavy
WHEN COALESCE((SELECT value FROM ops_config WHERE key = 'code_tasks_ctx_compact'), 'on') <> 'off'
BEGIN
  INSERT OR IGNORE INTO code_task_ctx_compacted (task_id, status, bytes_before, bytes_after, keys_removed, batch)
  SELECT t.id, t.status, length(t.ctx), length(json_remove(t.ctx, '$.base', '$.patch', '$.win_text', '$.x')), 'base,patch,win_text,x', NEW.id
  FROM code_tasks t
  WHERE substr(t.updated_at, 1, 2) = '20'
    AND ((t.status = 'merged' AND t.updated_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-2 days')
          AND COALESCE(t.merge_state, '') NOT IN ('deploying', 'deployed', 'reverting', 'revert-failed'))
      OR (t.status = 'closed' AND t.updated_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-2 days'))
      OR (t.status = 'superseded' AND t.updated_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-2 days') AND COALESCE(t.merge_note, '') = '')
      OR (t.status = 'failed' AND t.updated_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-7 days')))
    AND json_valid(t.ctx) AND length(t.ctx) > 20000
    AND NOT EXISTS (SELECT 1 FROM code_task_ctx_compacted c WHERE c.task_id = t.id)
  LIMIT 40;
  UPDATE code_tasks SET ctx = json_remove(ctx, '$.base', '$.patch', '$.win_text', '$.x')
  WHERE id IN (SELECT task_id FROM code_task_ctx_compacted WHERE batch = NEW.id);
END;

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:fleet-tick-fanout', 'finished code tasks do not need the file snapshot and diff they carried while running; stripping them removes about 97 % of the bytes the ctx scans parse',
  'CODE-TASKS-CTX-COMPACT-1: trigger code_tasks_ctx_compact_tick on fleet_tick_heavy removes ctx.base, patch, win_text and x from at most 40 finished code_tasks per tick (merged, closed, superseded after 2 days, failed after 7), ledger code_task_ctx_compacted',
  'GraphQL 17:00-17:12Z by D1 time: code_tasks ctx statements 39 s + 33 s + 10 s; code_tasks ctx 325 MB over 1,428 tasks (merged 133.9, superseded 93.7, failed 73.3, closed 19.2); sample of 40 finished tasks: ctx.base 85 % of bytes, patch 11 %, keys the readers use under 3 KB',
  'same claims, anchors and superseded_pr; far fewer bytes parsed', 'one trigger on fleet_tick_heavy, one ledger table; removed blobs are recoverable from git (path, branch, merged_sha, pr_url)',
  'ops_config code_tasks_ctx_compact = off stops it; the removed blobs are not restored', 'the code-task scans cost a tenth of their D1 time',
  'compactable finished-task ctx under 5 MB within about 6 hours; the three ctx statements about 20 s of D1 time per 12 minutes', NULL, 'SQLite test in migrations/code-tasks-ctx-compact.test.mjs, live byte counts and ledger'
WHERE NOT EXISTS (SELECT 1 FROM decision_log d WHERE d.action LIKE 'CODE-TASKS-CTX-COMPACT-1:%');
