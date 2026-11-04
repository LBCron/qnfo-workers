-- PERSONAS-C-SPLIT-1 (charter pillar autonomy): management-personas-c (35 steps) has never finished: 2 runs failed "orphaned: invocation ended before the run finished", 2 sit running (fleet_runs 2026-11-04 15:58-18:52Z),
-- while A (35 steps), B (35) and plus (20) finish ok. Run rows carry no per-step timing, so the slow step cannot be named from D1. C is cut by position into three tasks (steps 1-10 stay, 11-25 and 26-35 move out)
-- so the hung part is isolated by which task still orphans, and the rest of the roadmap, lever and dg steps run. C2 at :54, C3 at :58, C stays at :49. Copied by position from the live definition, once.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261104_personas_c_def
-- Rollback: UPDATE fleet_tasks SET definition = (SELECT definition FROM bak_20261104_personas_c_def), updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = 'management-personas-c'; DELETE FROM fleet_crons WHERE name IN ('management-personas-c2-hourly','management-personas-c3-hourly'); DELETE FROM fleet_tasks WHERE id IN ('management-personas-c2','management-personas-c3');

CREATE TABLE IF NOT EXISTS bak_20261104_personas_c_def AS SELECT definition FROM fleet_tasks WHERE id = 'management-personas-c';

INSERT OR IGNORE INTO fleet_tasks (id, name, type, definition, timeout_ms, retries, version, enabled, updated_at)
SELECT 'management-personas-c2', 'PERSONAS-C-SPLIT-1: management personas C, steps 11-25', 'workflow',
 json_object('steps', json((SELECT json_group_array(json(value)) FROM json_each((SELECT definition FROM fleet_tasks WHERE id = 'management-personas-c'), '$.steps') WHERE CAST(key AS INTEGER) BETWEEN 10 AND 24))),
 120000, 1, 1, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE EXISTS (SELECT 1 FROM fleet_tasks WHERE id = 'management-personas-c' AND json_array_length(definition, '$.steps') > 30);

INSERT OR IGNORE INTO fleet_tasks (id, name, type, definition, timeout_ms, retries, version, enabled, updated_at)
SELECT 'management-personas-c3', 'PERSONAS-C-SPLIT-1: management personas C, steps 26-35', 'workflow',
 json_object('steps', json((SELECT json_group_array(json(value)) FROM json_each((SELECT definition FROM fleet_tasks WHERE id = 'management-personas-c'), '$.steps') WHERE CAST(key AS INTEGER) >= 25))),
 120000, 1, 1, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE EXISTS (SELECT 1 FROM fleet_tasks WHERE id = 'management-personas-c' AND json_array_length(definition, '$.steps') > 30);

UPDATE fleet_tasks SET definition = json_set(definition, '$.steps', json((SELECT json_group_array(json(value)) FROM json_each(definition, '$.steps') WHERE CAST(key AS INTEGER) < 10))),
 version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 'management-personas-c' AND json_array_length(definition, '$.steps') > 30
  AND EXISTS (SELECT 1 FROM fleet_tasks WHERE id = 'management-personas-c2' AND json_array_length(definition, '$.steps') > 0)
  AND EXISTS (SELECT 1 FROM fleet_tasks WHERE id = 'management-personas-c3' AND json_array_length(definition, '$.steps') > 0);

INSERT OR IGNORE INTO fleet_crons (name, cron_expr, task_id, enabled, timezone, next_fire, updated_at)
SELECT 'management-personas-c2-hourly', '54 * * * *', 'management-personas-c2', 1, 'UTC', NULL, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE EXISTS (SELECT 1 FROM fleet_tasks WHERE id = 'management-personas-c2');
INSERT OR IGNORE INTO fleet_crons (name, cron_expr, task_id, enabled, timezone, next_fire, updated_at)
SELECT 'management-personas-c3-hourly', '58 * * * *', 'management-personas-c3', 1, 'UTC', NULL, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE EXISTS (SELECT 1 FROM fleet_tasks WHERE id = 'management-personas-c3');
