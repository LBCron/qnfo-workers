-- CODE-TASKS-CTX-COMPACT-2 (2026-11-04, charter pillar cost; D1 overload family D1-OVERLOAD-1). Follow-up to CODE-TASKS-CTX-COMPACT-1 (#7078, applied 18:07Z, first batch 40 tasks / 6.1 MB):
-- an independent review of the live trigger found three things worth changing, and one risk worth an alarm.
--   1. Steady-state cost (reproduced: 6,100 json_valid calls per tick with 6,100 old finished rows): json_valid(t.ctx) ran before the NOT EXISTS ledger check, so every tick parsed every
--      old finished task again, compacted or not, a scan that grows with the task history. The ledger check (a primary-key probe) now comes first, then length, then json_valid.
--   2. A task compacted once was never compacted again: the ledger key meant a failed task that was requeued with a fresh 100 KB ctx.base and failed again kept it for ever (reproduced).
--      A task is now eligible again when it changed after its last compaction (ledger compacted_at is older than the task's updated_at; the trigger's own UPDATE leaves updated_at alone),
--      and the ledger row is replaced so the UPDATE finds it in the batch.
--   3. WHERE batch = NEW.id scanned the whole ledger each tick: index on batch.
--   4. Risk (not a defect today): a runtime error in the trigger body, for example a future trigger on code_tasks that raises on UPDATE, makes every INSERT INTO fleet_tick_heavy fail and rolls back
--      all sibling heavy triggers (reproduced with a hypothetical guard; the runner's canary compiles triggers but never runs them). Detector fm-fleet-tick-heavy-stale: 1 when no fleet_tick_heavy row
--      was written in the last 45 minutes (heavy ticks run about every 10), served by idx_fleet_tick_heavy_ts; ops_config code_tasks_ctx_compact = off is the kill switch for this trigger.
-- Scope of the compaction is unchanged (resumability rules in migrations/2026-11-04-code-tasks-ctx-compact.sql). Prediction: per-tick work after the drain falls from one json parse per old finished task
-- to one primary-key probe per old finished task; the drain rate (40 a tick) and the 325 MB -> about 85 MB end state are unchanged; the detector reads 0.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261104_ctx_compact_trigger_v1
-- Rollback: DROP TRIGGER IF EXISTS code_tasks_ctx_compact_tick; then re-create it from bak_20261104_ctx_compact_trigger_v1 (column sql holds the exact previous CREATE statement); DROP INDEX IF EXISTS idx_ctx_compacted_batch; DELETE FROM remediation_contracts WHERE class = 'fm-fleet-tick-heavy-stale'; DELETE FROM failure_modes WHERE fm_key = 'fleet-tick-heavy-stale'
-- spof-review: one retention trigger replaced (same table, same switch, same ledger); one read-only detector contract; the detector is the second line for the single path every heavy-tick trigger shares.
-- CAUSE-MAPPED: registers no metric_registry row.

CREATE TABLE IF NOT EXISTS bak_20261104_ctx_compact_trigger_v1 AS
SELECT name, type, sql FROM sqlite_master WHERE type = 'trigger' AND name = 'code_tasks_ctx_compact_tick';

CREATE INDEX IF NOT EXISTS idx_ctx_compacted_batch ON code_task_ctx_compacted (batch);

DROP TRIGGER IF EXISTS code_tasks_ctx_compact_tick;
CREATE TRIGGER code_tasks_ctx_compact_tick AFTER INSERT ON fleet_tick_heavy
WHEN COALESCE((SELECT value FROM ops_config WHERE key = 'code_tasks_ctx_compact'), 'on') <> 'off'
BEGIN
  INSERT OR REPLACE INTO code_task_ctx_compacted (task_id, status, bytes_before, bytes_after, keys_removed, batch)
  SELECT t.id, t.status, length(t.ctx), length(json_remove(t.ctx, '$.base', '$.patch', '$.win_text', '$.x')), 'base,patch,win_text,x', NEW.id
  FROM code_tasks t
  WHERE substr(t.updated_at, 1, 2) = '20'
    AND ((t.status = 'merged' AND t.updated_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-2 days')
          AND COALESCE(t.merge_state, '') NOT IN ('deploying', 'deployed', 'reverting', 'revert-failed'))
      OR (t.status = 'closed' AND t.updated_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-2 days'))
      OR (t.status = 'superseded' AND t.updated_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-2 days') AND COALESCE(t.merge_note, '') = '')
      OR (t.status = 'failed' AND t.updated_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-7 days')))
    AND NOT EXISTS (SELECT 1 FROM code_task_ctx_compacted c WHERE c.task_id = t.id AND c.compacted_at >= t.updated_at)
    AND length(t.ctx) > 20000
    AND json_valid(t.ctx)
  LIMIT 40;
  UPDATE code_tasks SET ctx = json_remove(ctx, '$.base', '$.patch', '$.win_text', '$.x')
  WHERE id IN (SELECT task_id FROM code_task_ctx_compacted WHERE batch = NEW.id);
END;

INSERT OR IGNORE INTO failure_modes (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id, trigger_condition, symptom, blast_radius) VALUES
 ('fleet-tick-heavy-stale',
  'no fleet_tick_heavy row was written for 45 minutes, so every trigger on it (output quality, PR merge SLA, bp26 producers, retention prune, evolve parse pass, the ctx compaction) stops, together',
  'an AFTER INSERT trigger on fleet_tick_heavy raising at run time (a nested trigger on code_tasks, a missing table, a depth limit) rolls the whole insert back, and the migration runner compiles triggers but never runs them; or the orchestrator stopped ticking',
  'fix or drop the raising trigger (ops_config code_tasks_ctx_compact = off for the compaction; each heavy trigger has its own switch or Rollback line); the detector reads 0 again at the next heavy tick',
  'fm-fleet-tick-heavy-stale: 1 when the newest fleet_tick_heavy row is older than 45 minutes, expected 0',
  'fm-fleet-tick-heavy-stale', '2026-11-04', (SELECT id FROM agent_issues WHERE title LIKE 'D1-OVERLOAD-1e:%' ORDER BY id DESC LIMIT 1),
  'a new or changed trigger on fleet_tick_heavy, or on a table its triggers write, that errors when it runs',
  'v_output_quality_headline, pr_merge_sla and retention prune counters stop moving; fm-cohort-snapshot-stale follows at 75 minutes',
  'every heavy-tick trigger; the fleet_tick insert itself is not affected');

INSERT OR IGNORE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, next_due_at, module, budget_ms, max_items, requires_container) VALUES
 ('fm-fleet-tick-heavy-stale', NULL, 'CODE-TASKS-CTX-COMPACT-2', 'failure-mode detector',
  'SELECT ''0'' AS expected, CAST(CASE WHEN COALESCE((SELECT ts FROM fleet_tick_heavy ORDER BY id DESC LIMIT 1), '''') < strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-45 minutes'') THEN 1 ELSE 0 END AS TEXT) AS observed',
  'd1-query', 3, 'qnfo-fleet-control', 1, 'active', strftime('%Y-%m-%d %H:%M:%S', 'now'), 'failure-mode', 45000, 5, 0);

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:fleet-tick-fanout', 'a retention trigger should cost one key probe per old row in steady state, not one JSON parse, and an alarm should exist for the single path all heavy-tick triggers share',
  'CODE-TASKS-CTX-COMPACT-2: trigger code_tasks_ctx_compact_tick re-created (ledger check before length and json_valid, a task changed after its compaction is eligible again, ledger index on batch); detector fm-fleet-tick-heavy-stale (no heavy tick in 45 minutes)',
  'independent subagent review of the merged #7078 (reproduced: 6,100 json_valid calls per tick with 6,100 old finished rows; a requeued failed task kept a 100,033-char ctx after the next tick; a raising trigger body failed 2 of 2 heavy inserts); live: ledger 40 tasks / 6.1 MB after the first batch (18:07:41Z), heavy ticks about every 10 minutes (ids 1263-1265)',
  'steady-state compaction cost is one primary-key probe per old finished task; regrown ctx is compacted again; a stalled heavy tick is seen within the hour', 'one trigger (same table, same switch, same ledger), one index, one read-only contract',
  'the Rollback line (v1 text in bak_20261104_ctx_compact_trigger_v1)', 'the compaction cost stops growing with task history',
  'ledger keeps growing by 40 a tick until about 1,100 tasks; code_tasks ctx under 100 MB within 6 hours; fm-fleet-tick-heavy-stale reads 0', NULL, 'SQLite test in migrations/code-tasks-ctx-compact.test.mjs (both files, regrow case, detector probe)'
WHERE NOT EXISTS (SELECT 1 FROM decision_log d WHERE d.action LIKE 'CODE-TASKS-CTX-COMPACT-2:%');
