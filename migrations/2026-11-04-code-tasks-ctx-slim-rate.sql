-- CODE-TASKS-CTX-SLIM-RATE-1 (2026-11-04, charter pillar cost; D1 overload family D1-OVERLOAD-1).
-- Measured 20:45Z: code_tasks still holds 260 MB of ctx in 1,135 rows larger than 20 KB (merged 114 MB, superseded 89 MB, failed 45 MB); about 1,000 terminal tasks wait for
-- code_tasks_ctx_slim_heavy_tick, which archives and slims 12 a heavy tick (about 83 hours at one heavy tick per 10 minutes; 266 done since 18:35Z). The statements that read ctx
-- (cmCloseSuperseded, the claim sweeps) cost 76 + 56 + 37 s of D1 time in 3 h on that blob weight.
-- Change: 12 -> 40 a tick in the same three statements (same predicates, archive-before-slim order unchanged, kill switch ops_config retention_prune = off unchanged).
-- Prediction: backlog clears in about 25 hours instead of 83; SUM(length(ctx)) 260 MB -> under 80 MB; each tick reads about 9 MB more.
-- Verify: SELECT SUM(length(ctx))/1048576.0 FROM code_tasks (falls about 8 MB an hour) and COUNT(*) FROM code_task_ctx_archive.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261104_code_tasks_ctx_slim_trigger
-- Rollback: DROP TRIGGER IF EXISTS code_tasks_ctx_slim_heavy_tick; then run the sql column of bak_20261104_code_tasks_ctx_slim_trigger.
-- spof-review: one trigger redefined with a larger LIMIT; the archive keeps base and patch, so nothing is lost.

CREATE TABLE IF NOT EXISTS bak_20261104_code_tasks_ctx_slim_trigger AS
SELECT name, type, sql FROM sqlite_master WHERE type = 'trigger' AND name = 'code_tasks_ctx_slim_heavy_tick';

DROP TRIGGER IF EXISTS code_tasks_ctx_slim_heavy_tick;
CREATE TRIGGER code_tasks_ctx_slim_heavy_tick AFTER INSERT ON fleet_tick_heavy
WHEN COALESCE((SELECT value FROM ops_config WHERE key = 'retention_prune'), 'on') <> 'off'
BEGIN
  INSERT OR IGNORE INTO code_task_ctx_archive (task_id, base, patch, orig_ctx_bytes)
    SELECT t.id, json_extract(t.ctx, '$.base'), json_extract(t.ctx, '$.patch'), length(t.ctx)
    FROM code_tasks t
    WHERE t.status IN ('merged', 'superseded', 'closed', 'failed')
      AND replace(substr(t.updated_at, 1, 19), 'T', ' ') < datetime('now', CASE t.status WHEN 'failed' THEN '-14 days' ELSE '-2 days' END)
      AND NOT EXISTS (SELECT 1 FROM code_task_ctx_archive a WHERE a.task_id = t.id)
      AND t.ctx IS NOT NULL AND json_valid(t.ctx)
    LIMIT 40;
  UPDATE code_tasks SET ctx = json_remove(ctx, '$.base', '$.patch')
    WHERE id IN (SELECT task_id FROM code_task_ctx_archive WHERE slimmed = 0 LIMIT 40)
      AND status IN ('merged', 'superseded', 'closed', 'failed') AND ctx IS NOT NULL AND json_valid(ctx);
  UPDATE code_task_ctx_archive SET slimmed = 1 WHERE slimmed = 0
    AND task_id IN (SELECT task_id FROM code_task_ctx_archive WHERE slimmed = 0 LIMIT 40);
END;
