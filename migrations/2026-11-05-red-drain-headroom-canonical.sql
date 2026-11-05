-- PLAN-STARVATION-1 follow-up (2026-11-05, pillar autonomy): fleet_tasks_canonical follows the red-drain definition that migrations/2026-11-05-red-drain-headroom.sql changed.
-- The independent review of PR 7632 found the miss: the drift gate (fleet-tasks-drift-gate) compares fleet_tasks with fleet_tasks_canonical and files WORKFLOW-DEFINITION-DRIFT when they differ; live read 2026-11-05 04:05Z:
-- fleet_tasks.red-drain version 11 carries QUEUE-HEADROOM-1, the canonical row does not (exported 2026-11-04 23:56 by migrations/2026-11-05-liveness-issue-bound-rearm.sql). The canonical row moves ONLY when the live definition
-- minus the QUEUE-HEADROOM-1 gate is byte for byte the canonical one (read live: reverse_equals_canonical = 1), so a definition another session changed in between is never overwritten.
-- Prediction: no WORKFLOW-DEFINITION-DRIFT: red-drain issue is filed for this change.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE fleet_tasks_canonical SET definition = (SELECT b.definition FROM bak_20261105_red_drain_canonical b WHERE b.id = 'red-drain'), repo_path = (SELECT b.repo_path FROM bak_20261105_red_drain_canonical b WHERE b.id = 'red-drain'), exported_at = (SELECT b.exported_at FROM bak_20261105_red_drain_canonical b WHERE b.id = 'red-drain') WHERE id = 'red-drain';
-- Closing probe: SELECT (SELECT t.definition FROM fleet_tasks t WHERE t.id = 'red-drain') = (SELECT c.definition FROM fleet_tasks_canonical c WHERE c.id = 'red-drain'); -- 1

CREATE TABLE IF NOT EXISTS bak_20261105_red_drain_canonical AS
SELECT id, definition, repo_path, exported_at FROM fleet_tasks_canonical WHERE id = 'red-drain';

UPDATE fleet_tasks_canonical SET
  definition = (SELECT t.definition FROM fleet_tasks t WHERE t.id = 'red-drain'),
  repo_path = 'migrations/2026-11-05-red-drain-headroom.sql',
  exported_at = datetime('now')
WHERE id = 'red-drain'
  AND instr(definition, 'QUEUE-HEADROOM-1') = 0
  AND instr((SELECT t.definition FROM fleet_tasks t WHERE t.id = 'red-drain'), 'QUEUE-HEADROOM-1') > 0
  AND json_set((SELECT t.definition FROM fleet_tasks t WHERE t.id = 'red-drain'), '$.steps[3].sql',
        replace(json_extract((SELECT t.definition FROM fleet_tasks t WHERE t.id = 'red-drain'), '$.steps[3].sql'),
          'AND (SELECT COUNT(*) FROM code_tasks WHERE status = ''queued'') < 42 /* QUEUE-HEADROOM-1 */ LIMIT 5', 'LIMIT 5')) = definition;
