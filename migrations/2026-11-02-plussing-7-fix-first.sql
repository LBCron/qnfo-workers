-- PLUSSING-7 (2026-11-02, charter pillars autonomy and reach).
-- Evaluate mature plus outcomes and enqueue any required reverts before the same tick originates new product plusses.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261102_plussing_7_workflow
-- Rollback: UPDATE fleet_tasks SET definition = (SELECT definition FROM bak_20261102_plussing_7_workflow WHERE id = 'management-personas'), version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = 'management-personas';

CREATE TABLE IF NOT EXISTS bak_20261102_plussing_7_workflow AS
SELECT id, definition, version FROM fleet_tasks WHERE id = 'management-personas';

UPDATE fleet_tasks
SET definition = json_set(
      definition,
      '$.steps',
      json((
        SELECT json_group_array(json(step.value))
        FROM (
          SELECT value, CAST(key AS REAL) AS position
          FROM json_each(fleet_tasks.definition, '$.steps')
          WHERE json_extract(value, '$.name') <> 'pl-research'
          UNION ALL
          SELECT value, (
            SELECT CAST(target.key AS REAL) + 0.5
            FROM json_each(fleet_tasks.definition, '$.steps') AS target
            WHERE json_extract(target.value, '$.name') = 'pl-revert-sync-check'
          ) AS position
          FROM json_each(fleet_tasks.definition, '$.steps')
          WHERE json_extract(value, '$.name') = 'pl-research'
          ORDER BY position
        ) AS step
      ))
    ),
    version = version + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 'management-personas'
  AND EXISTS (
    SELECT 1 FROM json_each(definition, '$.steps')
    WHERE json_extract(value, '$.name') = 'pl-research'
  )
  AND EXISTS (
    SELECT 1 FROM json_each(definition, '$.steps')
    WHERE json_extract(value, '$.name') = 'pl-revert-sync-check'
  )
  AND (
    SELECT CAST(key AS INTEGER) FROM json_each(definition, '$.steps')
    WHERE json_extract(value, '$.name') = 'pl-research'
  ) < (
    SELECT CAST(key AS INTEGER) FROM json_each(definition, '$.steps')
    WHERE json_extract(value, '$.name') = 'pl-revert-sync-check'
  );

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'management-personas (PLUSSING-7)',
  'A new plus must not be originated ahead of an already-due repair for a failed plus.',
  'Run mature outcome review and revert enqueue/synchronization before the product plus research step.',
  'The management-personas workflow previously ran pl-research before pl-outcome-review and pl-revert-request.',
  'applied',
  'management-personas product-plus workflow ordering',
  'restore management-personas from bak_20261102_plussing_7_workflow',
  'repair requests are enqueued before new plus requests in the same manager tick',
  'plus_shipped_7d rises as active, non-resting products receive verified pluses after any outstanding failed plus is repaired',
  'fewer repeated product regressions and more reliable reach improvements',
  'migrations/plussing-7.test.mjs'
WHERE NOT EXISTS (
  SELECT 1 FROM decision_log
  WHERE actor = 'management-personas (PLUSSING-7)'
    AND action = 'Run mature outcome review and revert enqueue/synchronization before the product plus research step.'
);
