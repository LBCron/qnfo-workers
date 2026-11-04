-- CODE-TASKS-CTX-FLAGS-1 (2026-11-04, charter pillar cost; root cause of the "D1 DB is overloaded" reads measured with CODE-TASKS-CTX-SLIM-1).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- spof-review: additive columns and triggers; if the triggers stop, the workers fall back to the old ctx test for rows whose flag is NULL. Second path: DROP the triggers; no data is changed except the three flag columns.
-- Rollback: DROP TRIGGER IF EXISTS code_tasks_ctx_flags_ins; DROP TRIGGER IF EXISTS code_tasks_ctx_flags_upd; DROP TRIGGER IF EXISTS code_tasks_ctx_flags_backfill_heavy_tick; (the columns stay, unused)
-- Measured 2026-11-04: qnfo-code-orchestrator's terminal claim sweeps (json_extract over ctx for every merged/superseded/failed/closed task) and qnfo-fleet-control's
-- cmCloseSuperseded (ctx LIKE '%superseded_pr%') read the whole 220 KB ctx of every code task on each run (318 MB per call). The tests become three small columns kept
-- current by triggers: claim_token_set (ctx.claim.token present), claim_open (token present and not released), superseded_flag (ctx.superseded_pr present).
-- The workers (orchestrator 0.40.3, fleet-control 0.62.8) read the flag and fall back to the old test only for a row whose flag is still NULL (rows not yet backfilled).
-- Backfill: 100 rows per fleet_tick_heavy insert, so no statement reads more than a few MB.

ALTER TABLE code_tasks ADD COLUMN claim_token_set INTEGER;
ALTER TABLE code_tasks ADD COLUMN claim_open INTEGER;
ALTER TABLE code_tasks ADD COLUMN superseded_flag INTEGER;

CREATE TRIGGER IF NOT EXISTS code_tasks_ctx_flags_ins AFTER INSERT ON code_tasks
BEGIN
  UPDATE code_tasks SET
    claim_token_set = CASE WHEN json_valid(NEW.ctx) AND json_extract(NEW.ctx, '$.claim.token') IS NOT NULL THEN 1 ELSE 0 END,
    claim_open = CASE WHEN json_valid(NEW.ctx) AND json_extract(NEW.ctx, '$.claim.token') IS NOT NULL AND json_extract(NEW.ctx, '$.claim.released_at') IS NULL THEN 1 ELSE 0 END,
    superseded_flag = CASE WHEN json_valid(NEW.ctx) AND json_extract(NEW.ctx, '$.superseded_pr') IS NOT NULL THEN 1 ELSE 0 END
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS code_tasks_ctx_flags_upd AFTER UPDATE OF ctx ON code_tasks
BEGIN
  UPDATE code_tasks SET
    claim_token_set = CASE WHEN json_valid(NEW.ctx) AND json_extract(NEW.ctx, '$.claim.token') IS NOT NULL THEN 1 ELSE 0 END,
    claim_open = CASE WHEN json_valid(NEW.ctx) AND json_extract(NEW.ctx, '$.claim.token') IS NOT NULL AND json_extract(NEW.ctx, '$.claim.released_at') IS NULL THEN 1 ELSE 0 END,
    superseded_flag = CASE WHEN json_valid(NEW.ctx) AND json_extract(NEW.ctx, '$.superseded_pr') IS NOT NULL THEN 1 ELSE 0 END
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS code_tasks_ctx_flags_backfill_heavy_tick AFTER INSERT ON fleet_tick_heavy
WHEN EXISTS (SELECT 1 FROM code_tasks WHERE superseded_flag IS NULL LIMIT 1)
BEGIN
  UPDATE code_tasks SET
    claim_token_set = CASE WHEN json_valid(ctx) AND json_extract(ctx, '$.claim.token') IS NOT NULL THEN 1 ELSE 0 END,
    claim_open = CASE WHEN json_valid(ctx) AND json_extract(ctx, '$.claim.token') IS NOT NULL AND json_extract(ctx, '$.claim.released_at') IS NULL THEN 1 ELSE 0 END,
    superseded_flag = CASE WHEN json_valid(ctx) AND json_extract(ctx, '$.superseded_pr') IS NOT NULL THEN 1 ELSE 0 END
  WHERE id IN (SELECT id FROM code_tasks WHERE superseded_flag IS NULL LIMIT 100);
END;
