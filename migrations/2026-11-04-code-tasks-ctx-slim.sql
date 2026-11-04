-- CODE-TASKS-CTX-SLIM-1 (2026-11-04, charter pillar cost; owner request: "more efficient data structures ... old data we don't need anymore needs to be automatically cleaned").
-- APPLY-BY: ci
-- DB: qnfo-audit
-- (no BACKUP header: this file deletes nothing when it is applied. The trigger it creates copies base and patch into code_task_ctx_archive before it json_removes them from the live row, so the archive is the backup; the runner refuses a BACKUP table the file creates empty, BACKUP-SELF-EMPTY-1, run 41885084976.)
-- spof-review: non-critical housekeeping; if it stops only the scan cost returns. Second path: ops_config retention_prune=off pauses it; the archive table holds every removed value.
-- Rollback: DROP TRIGGER IF EXISTS code_tasks_ctx_slim_heavy_tick; UPDATE code_tasks SET ctx = json_patch(COALESCE(ctx, '{}'), json_object('base', (SELECT a.base FROM code_task_ctx_archive a WHERE a.task_id = code_tasks.id), 'patch', (SELECT a.patch FROM code_task_ctx_archive a WHERE a.task_id = code_tasks.id))) WHERE id IN (SELECT task_id FROM code_task_ctx_archive WHERE slimmed = 1);
-- Measured 2026-11-04 (qnfo-audit): code_tasks has 1,449 rows and 318 MB of ctx (average 220 KB, up to 1.0 MB). The two keys ctx.base (whole file
-- before the edit) and ctx.patch (the produced patch) hold about 99% of it; 1,399 of the 1,449 rows are merged, superseded, failed or closed, and none of
-- those rows is read for its base or patch again (the code loop reads ctx.base/ctx.patch only for a task it is building or publishing). Two statements
-- read the whole ctx column of every row on each run: qnfo-fleet-control cmCloseSuperseded (ctx LIKE '%superseded_pr%', 120 calls and 217 s of D1 time in
-- 3 h) and the planner scan (json_extract on ctx, 107 calls, 131 s). That is 318 MB read per call, the cause of the "D1 DB is overloaded" errors that a
-- row count does not show.
-- Mechanism: before anything leaves code_tasks, base and patch are copied to code_task_ctx_archive (the weekly qnfo-audit export to R2 then carries
-- them). A trigger on fleet_tick_heavy moves 12 tasks per heavy tick: terminal tasks past their age (merged, superseded, closed: 2 days; failed: 14 days,
-- because a failed task can be requeued), the copy first, then json_remove of $.base and $.patch on the live row. Other ctx keys (superseded_pr, claim,
-- edits, lastError) stay. Selection never reads ctx: it uses the status index and the archive primary key.

CREATE TABLE IF NOT EXISTS code_task_ctx_archive (
  task_id TEXT PRIMARY KEY,
  base TEXT,
  patch TEXT,
  orig_ctx_bytes INTEGER,
  archived_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  slimmed INTEGER NOT NULL DEFAULT 0
);

CREATE TRIGGER IF NOT EXISTS code_tasks_ctx_slim_heavy_tick AFTER INSERT ON fleet_tick_heavy
WHEN COALESCE((SELECT value FROM ops_config WHERE key = 'retention_prune'), 'on') <> 'off'
BEGIN
  INSERT OR IGNORE INTO code_task_ctx_archive (task_id, base, patch, orig_ctx_bytes)
    SELECT t.id, json_extract(t.ctx, '$.base'), json_extract(t.ctx, '$.patch'), length(t.ctx)
    FROM code_tasks t
    WHERE t.status IN ('merged', 'superseded', 'closed', 'failed')
      AND replace(substr(t.updated_at, 1, 19), 'T', ' ') < datetime('now', CASE t.status WHEN 'failed' THEN '-14 days' ELSE '-2 days' END)
      AND NOT EXISTS (SELECT 1 FROM code_task_ctx_archive a WHERE a.task_id = t.id)
      AND t.ctx IS NOT NULL AND json_valid(t.ctx)
    LIMIT 12;
  UPDATE code_tasks SET ctx = json_remove(ctx, '$.base', '$.patch')
    WHERE id IN (SELECT task_id FROM code_task_ctx_archive WHERE slimmed = 0 LIMIT 12)
      AND status IN ('merged', 'superseded', 'closed', 'failed') AND ctx IS NOT NULL AND json_valid(ctx);
  UPDATE code_task_ctx_archive SET slimmed = 1 WHERE slimmed = 0
    AND task_id IN (SELECT task_id FROM code_task_ctx_archive WHERE slimmed = 0 LIMIT 12);
END;
