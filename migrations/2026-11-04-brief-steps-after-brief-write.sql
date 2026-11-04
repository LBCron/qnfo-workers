-- BRIEF-STEPS-AFTER-WRITE-1 (2026-11-04, charter pillar autonomy; follow-up of ROADMAP-ORIGINATION-MOVES-1, PR 7126).
-- Measured 2026-11-04 20:10Z: after PR 7126 the managers tick of 19:36Z ran all 66 steps (7.9 s, ok) and rm-research asked for OPS, INFRA, REACH and RSCH, but the portfolio brief
-- of tick 19:00Z carries neither 'North Star:' nor 'Roadmap (manager-originated)'. Cause: the three steps that append to the brief (rm-brief, dg-brief, ns-brief) now run in
-- management-personas at :35, and management-personas-b writes the brief with INSERT OR REPLACE (step brief-portfolio) at :42, which replaces their appends.
-- Fix: the three steps move from management-personas to the end of management-personas-b, after every brief write, in their order.
-- PREDICTION: the brief of the next tick that management-personas-b completes starts with 'North Star:' and carries 'Roadmap (manager-originated)'. Falsifier: management-personas-b fails (it failed once at 18:42Z under D1 overload): move them back.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261104_ns3_tasks
-- Rollback: UPDATE fleet_tasks SET definition = (SELECT b.definition FROM bak_20261104_ns3_tasks b WHERE b.id = fleet_tasks.id), version = version + 1, updated_at = datetime('now') WHERE id IN (SELECT id FROM bak_20261104_ns3_tasks);

CREATE TABLE IF NOT EXISTS bak_20261104_ns3_tasks AS
SELECT id, definition, version FROM fleet_tasks WHERE id IN ('management-personas', 'management-personas-b');

UPDATE fleet_tasks
SET definition = json_set(definition, '$.steps', json((
      SELECT json_group_array(json(s.v)) FROM (
        SELECT j.value AS v, 0 AS g, CAST(j.key AS INTEGER) AS k FROM json_each(fleet_tasks.definition, '$.steps') j
        UNION ALL
        SELECT j2.value, 1, CAST(j2.key AS INTEGER) FROM fleet_tasks m, json_each(m.definition, '$.steps') j2
        WHERE m.id = 'management-personas' AND json_extract(j2.value, '$.name') IN ('rm-brief', 'dg-brief', 'ns-brief')
        ORDER BY g, k) s))),
    version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 'management-personas-b'
  AND NOT EXISTS (SELECT 1 FROM json_each(fleet_tasks.definition, '$.steps') j WHERE json_extract(j.value, '$.name') = 'ns-brief')
  AND EXISTS (SELECT 1 FROM fleet_tasks m, json_each(m.definition, '$.steps') j2 WHERE m.id = 'management-personas' AND json_extract(j2.value, '$.name') = 'ns-brief');

UPDATE fleet_tasks
SET definition = json_set(definition, '$.steps', json((
      SELECT json_group_array(json(j.value)) FROM json_each(fleet_tasks.definition, '$.steps') j
      WHERE json_extract(j.value, '$.name') NOT IN ('rm-brief', 'dg-brief', 'ns-brief')))),
    version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 'management-personas'
  AND EXISTS (SELECT 1 FROM json_each(fleet_tasks.definition, '$.steps') j WHERE json_extract(j.value, '$.name') = 'ns-brief')
  AND EXISTS (SELECT 1 FROM fleet_tasks b, json_each(b.definition, '$.steps') j2 WHERE b.id = 'management-personas-b' AND json_extract(j2.value, '$.name') = 'ns-brief');

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'portfolio-manager (BRIEF-STEPS-AFTER-WRITE-1)',
  'a step that appends to the portfolio brief must run after the step that writes it',
  'moved rm-brief, dg-brief and ns-brief from management-personas (:35) to the end of management-personas-b (:42)',
  'brief of tick 19:00Z has no North Star or Roadmap line although the :35 run of 19:36Z ran 66 steps ok; brief-portfolio (management-personas-b) is INSERT OR REPLACE',
  'pending the next management-personas-b run', 'persona_briefs summary of the portfolio manager (fleet.qnfo.org/api/managers)',
  'Rollback line of migrations/2026-11-04-brief-steps-after-brief-write.sql', 'brief-appends-after-brief-write',
  'next completed management-personas-b run: the brief starts with North Star: and carries the Roadmap line',
  'the owner reads the four North Star values at the top of the portfolio brief',
  'SQLite replay of the move on a stub fleet_tasks'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE actor = 'portfolio-manager (BRIEF-STEPS-AFTER-WRITE-1)');
