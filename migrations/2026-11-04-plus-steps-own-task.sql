-- PLUS-OWN-TASK-1 (charter pillar autonomy): the product plus steps (pl-*, the tail of the 125-step management-personas workflow) never ran.
-- Measured 2026-11-04 15:10Z: the last ok management-personas run is 07:07Z; 27 runs since 13:12Z sit in status running (the 120 s workflow outlives D1 overload and the
-- dispatcher), so every step after the first ~100 is never reached. All 8 products show last_plus_at NULL and hours_since_plus 146 in v_product_plus_due although
-- PR 6909 set plus_cadence_h to 24 (applied: plus_cadence_h 24 on all 8). Fix: the pl-* steps move into their own task and hourly cron, so the plus loop no longer depends
-- on the first 100 steps finishing. The 105 steps left are then split by position into three contiguous tasks of about 35 steps (A stays management-personas at :35,
-- B management-personas-b at :42, C management-personas-c at :49), each inside the 120 s limit; order is kept and tables carry state between them. Steps are copied by
-- name and position from the live definition, so concurrent edits to it are kept.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261104_plus_steps_mp
-- Rollback: UPDATE fleet_tasks SET definition = (SELECT definition FROM bak_20261104_plus_steps_mp), updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = 'management-personas'; DELETE FROM fleet_crons WHERE name = 'management-personas-plus-hourly'; DELETE FROM fleet_crons WHERE name IN ('management-personas-b-hourly','management-personas-c-hourly'); DELETE FROM fleet_tasks WHERE id IN ('management-personas-plus','management-personas-b','management-personas-c');

CREATE TABLE IF NOT EXISTS bak_20261104_plus_steps_mp AS SELECT definition FROM fleet_tasks WHERE id = 'management-personas';

INSERT OR IGNORE INTO fleet_tasks (id, name, type, definition, timeout_ms, retries, version, enabled, updated_at)
SELECT 'management-personas-plus', 'PLUSSING-OWN-TASK-1: product plus steps run on their own hourly task', 'workflow',
 json_object('steps', json((SELECT json_group_array(json(value)) FROM json_each((SELECT definition FROM fleet_tasks WHERE id = 'management-personas'), '$.steps') WHERE json_extract(value, '$.name') LIKE 'pl-%'))),
 120000, 1, 1, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE EXISTS (SELECT 1 FROM fleet_tasks WHERE id = 'management-personas');

UPDATE fleet_tasks SET definition = json_set(definition, '$.steps', json((SELECT json_group_array(json(value)) FROM json_each(definition, '$.steps') WHERE json_extract(value, '$.name') NOT LIKE 'pl-%'))),
 version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 'management-personas' AND EXISTS (SELECT 1 FROM fleet_tasks WHERE id = 'management-personas-plus' AND json_array_length(definition, '$.steps') > 0);

INSERT OR IGNORE INTO fleet_crons (name, cron_expr, task_id, enabled, timezone, next_fire, updated_at)
SELECT 'management-personas-plus-hourly', '50 * * * *', 'management-personas-plus', 1, 'UTC', NULL, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE EXISTS (SELECT 1 FROM fleet_tasks WHERE id = 'management-personas-plus');

-- Split what is left of management-personas by position: steps 0-34 stay, 35-69 become task B, 70 and above task C. Done once: only when B does not exist yet.
INSERT OR IGNORE INTO fleet_tasks (id, name, type, definition, timeout_ms, retries, version, enabled, updated_at)
SELECT 'management-personas-b', 'PLUSSING-OWN-TASK-1: management personas steps 36-70', 'workflow',
 json_object('steps', json((SELECT json_group_array(json(value)) FROM json_each((SELECT definition FROM fleet_tasks WHERE id = 'management-personas'), '$.steps') WHERE CAST(key AS INTEGER) BETWEEN 35 AND 69))),
 120000, 1, 1, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE EXISTS (SELECT 1 FROM fleet_tasks WHERE id = 'management-personas' AND json_array_length(definition, '$.steps') > 70);

INSERT OR IGNORE INTO fleet_tasks (id, name, type, definition, timeout_ms, retries, version, enabled, updated_at)
SELECT 'management-personas-c', 'PLUSSING-OWN-TASK-1: management personas steps 71 onward', 'workflow',
 json_object('steps', json((SELECT json_group_array(json(value)) FROM json_each((SELECT definition FROM fleet_tasks WHERE id = 'management-personas'), '$.steps') WHERE CAST(key AS INTEGER) >= 70))),
 120000, 1, 1, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE EXISTS (SELECT 1 FROM fleet_tasks WHERE id = 'management-personas' AND json_array_length(definition, '$.steps') > 70);

UPDATE fleet_tasks SET definition = json_set(definition, '$.steps', json((SELECT json_group_array(json(value)) FROM json_each(definition, '$.steps') WHERE CAST(key AS INTEGER) < 35))),
 version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 'management-personas' AND json_array_length(definition, '$.steps') > 70
  AND EXISTS (SELECT 1 FROM fleet_tasks WHERE id = 'management-personas-b' AND json_array_length(definition, '$.steps') > 0)
  AND EXISTS (SELECT 1 FROM fleet_tasks WHERE id = 'management-personas-c' AND json_array_length(definition, '$.steps') > 0);

INSERT OR IGNORE INTO fleet_crons (name, cron_expr, task_id, enabled, timezone, next_fire, updated_at)
SELECT 'management-personas-b-hourly', '42 * * * *', 'management-personas-b', 1, 'UTC', NULL, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE EXISTS (SELECT 1 FROM fleet_tasks WHERE id = 'management-personas-b');
INSERT OR IGNORE INTO fleet_crons (name, cron_expr, task_id, enabled, timezone, next_fire, updated_at)
SELECT 'management-personas-c-hourly', '49 * * * *', 'management-personas-c', 1, 'UTC', NULL, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE EXISTS (SELECT 1 FROM fleet_tasks WHERE id = 'management-personas-c');
