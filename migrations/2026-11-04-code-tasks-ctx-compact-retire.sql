-- CODE-TASKS-CTX-COMPACT-3 (2026-11-04, charter pillar cost): retire my CODE-TASKS-CTX-COMPACT-1/2 trigger now that CODE-TASKS-CTX-SLIM-1 (#7108) and CODE-TASKS-CTX-FLAGS-1 (#7112) own the problem.
-- What happened (live, 2026-11-04): my trigger code_tasks_ctx_compact_tick (applied 18:07Z, 40 tasks per heavy tick, no archive) and the slim trigger code_tasks_ctx_slim_heavy_tick (applied 18:23Z, archives base and patch
-- to code_task_ctx_archive before it strips) ran on the same heavy ticks over the same tasks. Mine stripped first, so the archive of the slim trigger held NULL base for every task it reached (24 of 24 at 18:43Z). I switched
-- mine off at 18:32:26Z (ops_config code_tasks_ctx_compact = off) and seeded the archive with the 120 tasks my ledger holds (slimmed = 1, base and patch NULL: nothing was archived for them; git holds the content: path, branch, merged_sha, pr_url).
-- Why retire, not only keep it off: the documented way to resume it is to delete one config row, and a resumed trigger would again delete finished-task ctx with no archive copy (the global rule: no deletion without a backup).
-- The scan cost it was built for is gone at the root: #7112 makes the claim sweeps and the superseded-PR scan read flag columns, not ctx (19:00-19:06Z: no code_tasks ctx statement in the top D1 time list; the 19:00 hourly bucket 11 s against 142 s at 17:05Z).
-- Kept: the ledger table code_task_ctx_compacted (the list of the 120 tasks stripped without an archive), the backup tables of both trigger texts, the heavy-tick stall detector fm-fleet-tick-heavy-stale (it watches every heavy-tick trigger, not only this one), idx_ctx_compacted_batch (harmless).
-- Prediction: nothing observable changes (the trigger is off); the heavy tick no longer carries a dormant trigger that could resume by a config delete.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261104_ctx_compact_trigger_v2
-- Rollback: re-create the trigger from bak_20261104_ctx_compact_trigger_v2 (column sql holds the exact previous CREATE statement); it stays off while ops_config code_tasks_ctx_compact = off
-- spof-review: removes one trigger from fleet_tick_heavy; every other heavy-tick trigger is untouched.
-- CAUSE-MAPPED: registers no metric_registry row.

CREATE TABLE IF NOT EXISTS bak_20261104_ctx_compact_trigger_v2 AS
SELECT name, type, sql FROM sqlite_master WHERE type = 'trigger' AND name = 'code_tasks_ctx_compact_tick';

DROP TRIGGER IF EXISTS code_tasks_ctx_compact_tick;

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:fleet-tick-fanout', 'one mechanism should delete finished-task ctx and it should archive first; a dormant trigger that resumes by deleting a config row is a footgun',
  'CODE-TASKS-CTX-COMPACT-3: drop trigger code_tasks_ctx_compact_tick (backup bak_20261104_ctx_compact_trigger_v2); CODE-TASKS-CTX-SLIM-1 and CODE-TASKS-CTX-FLAGS-1 own the problem',
  'code_task_ctx_archive 24 of 24 rows NULL base at 18:43Z while my trigger ran first; 19:00-19:06Z D1 top list has no code_tasks ctx statement; 19:00 bucket 11 s against 142 s at 17:05Z',
  'no deletion of finished-task ctx can happen without an archive copy', 'one trigger on fleet_tick_heavy',
  'the Rollback line', 'one retention mechanism with a backup', 'the heavy tick carries one fewer trigger; code_task_ctx_archive rows carry real base and patch', NULL, 'live D1 and SQLite test in migrations/code-tasks-ctx-compact-retire.test.mjs'
WHERE NOT EXISTS (SELECT 1 FROM decision_log d WHERE d.action LIKE 'CODE-TASKS-CTX-COMPACT-3:%');
