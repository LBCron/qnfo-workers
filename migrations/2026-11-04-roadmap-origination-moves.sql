-- ROADMAP-ORIGINATION-MOVES-1 (2026-11-04, charter pillars autonomy and reach; follow-up of NORTH-STAR-MANAGERS-1, PR 7073).
-- Owner directive 2026-11-04: each program manager originates at least one strategic roadmap proposal a week.
-- WHAT WAS MEASURED (qnfo-audit 2026-11-04 18:10-19:05Z, after PR 7073 applied):
--  * fleet_tasks management-personas-c (hourly :49; 37 steps: metric audit, lever reviews, then the roadmap chain, the delegation chain and the North Star brief) has stopped finishing.
--    persona_briefs of the portfolio manager carry the 'Metric audit (' append of its step brief-audit (step 10) in 22 of 24 hours on 2026-11-03 and in 5 of 18 hours on 2026-11-04;
--    none of the briefs of 15:00, 17:00 and 18:00Z carries 'Roadmap (manager-originated)' (rm-brief) or 'North Star:' (ns-brief). fleet_runs: the 15:58 and 16:50 runs were marked
--    'orphaned: invocation ended before the run finished (CRON-ADVANCE-FIRST-1)' two hours later, the 17:52 and 18:52 runs were still 'running' at 19:00Z.
--    The read side of every step before rm-research runs in under 0.3 s (read-only SELECT of mi-unmeasured-*, lever-log, lever-report, lever-mark), so the stall is the executor under D1
--    overload, not one slow statement. Steps 11 and later never ran: at 19:00Z rm-research had asked nothing although its SELECT returned the four researching programs.
--  * management-personas (41 steps) finished 143 times and ended ok every hour since 16:36Z (about 10 s).
-- WHAT THIS CHANGES: the 25 steps of management-personas-c that serve the owner's strategy goal (rm-research ... rm-brief: roadmap originate, parse, meta, file, track, deployed, brief;
-- dg-request ... dg-brief: doers for focus issues without one, North Star issues first; ns-brief) move to the end of management-personas, in their order. management-personas-c keeps
-- the metric audit, the lever reviews, rc-probe (12 steps). Steps are standalone SQL, so a move changes only when and in which run they execute (hourly :35 instead of :49).
-- PREDICTION (decision_log): within 2 managers ticks (:35 and :35) `roadmap-QNFO.<program>-<day>` asks exist for OPS, INFRA, REACH and RSCH, the portfolio brief carries
-- 'North Star:' and 'Roadmap (manager-originated)' again, and dg-request files its asks for focus issues without a doer (9 at 18:43Z). Falsifier: management-personas fails or
-- runs over 60 s (fleet_runs): move the 25 steps back with the Rollback line.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261104_ns2_tasks
-- Rollback: UPDATE fleet_tasks SET definition = (SELECT b.definition FROM bak_20261104_ns2_tasks b WHERE b.id = fleet_tasks.id), version = version + 1, updated_at = datetime('now') WHERE id IN (SELECT id FROM bak_20261104_ns2_tasks);
-- spof-review: the moved steps now share the one producer management-personas (hourly :35); it finished 143 of 143 runs since 16:36Z.

CREATE TABLE IF NOT EXISTS bak_20261104_ns2_tasks AS
SELECT id, definition, version FROM fleet_tasks WHERE id IN ('management-personas', 'management-personas-c');

-- 1. append the 25 steps (their order in management-personas-c) to management-personas, unless they are already there
UPDATE fleet_tasks
SET definition = json_set(definition, '$.steps', json((
      SELECT json_group_array(json(s.v)) FROM (
        SELECT j.value AS v, 0 AS g, CAST(j.key AS INTEGER) AS k FROM json_each(fleet_tasks.definition, '$.steps') j
        UNION ALL
        SELECT j2.value, 1, CAST(j2.key AS INTEGER) FROM fleet_tasks c, json_each(c.definition, '$.steps') j2
        WHERE c.id = 'management-personas-c'
          AND json_extract(j2.value, '$.name') IN ('rm-research', 'rm-parse', 'rm-meta', 'rm-reject', 'rm-file', 'rm-filed', 'rm-map', 'rm-filed-log', 'rm-track',
            'rm-deployed-evidence', 'rm-deployed-log', 'rm-deployed-contracts', 'rm-deployed-close', 'rm-deployed', 'rm-metric', 'rm-brief',
            'dg-request', 'dg-parse', 'dg-nofix', 'dg-reject', 'dg-apply', 'dg-mark', 'dg-log', 'dg-brief', 'ns-brief')
        ORDER BY g, k) s))),
    version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 'management-personas'
  AND NOT EXISTS (SELECT 1 FROM json_each(fleet_tasks.definition, '$.steps') j WHERE json_extract(j.value, '$.name') = 'rm-research')
  AND EXISTS (SELECT 1 FROM fleet_tasks c, json_each(c.definition, '$.steps') j2 WHERE c.id = 'management-personas-c' AND json_extract(j2.value, '$.name') = 'rm-research');

-- 2. take them out of management-personas-c (only once management-personas holds them)
UPDATE fleet_tasks
SET definition = json_set(definition, '$.steps', json((
      SELECT json_group_array(json(j.value)) FROM json_each(fleet_tasks.definition, '$.steps') j
      WHERE json_extract(j.value, '$.name') NOT IN ('rm-research', 'rm-parse', 'rm-meta', 'rm-reject', 'rm-file', 'rm-filed', 'rm-map', 'rm-filed-log', 'rm-track',
            'rm-deployed-evidence', 'rm-deployed-log', 'rm-deployed-contracts', 'rm-deployed-close', 'rm-deployed', 'rm-metric', 'rm-brief',
            'dg-request', 'dg-parse', 'dg-nofix', 'dg-reject', 'dg-apply', 'dg-mark', 'dg-log', 'dg-brief', 'ns-brief')))),
    version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 'management-personas-c'
  AND EXISTS (SELECT 1 FROM json_each(fleet_tasks.definition, '$.steps') j WHERE json_extract(j.value, '$.name') = 'rm-research')
  AND EXISTS (SELECT 1 FROM fleet_tasks m, json_each(m.definition, '$.steps') j2 WHERE m.id = 'management-personas' AND json_extract(j2.value, '$.name') = 'rm-research');

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'portfolio-manager (ROADMAP-ORIGINATION-MOVES-1)',
  'the roadmap origination and doer chains must run in the workflow that finishes, because the one they sat in has stopped completing',
  'moved 25 steps (rm-research ... rm-brief, dg-request ... dg-brief, ns-brief) from management-personas-c to the end of management-personas',
  '2026-11-04: management-personas-c runs orphaned (15:58, 16:50) or still running (17:52, 18:52); the Metric audit brief append fell from 22 of 24 hours (11-03) to 5 of 18 (11-04); rm-research had asked nothing at 19:00Z; management-personas ok 143 times since 16:36Z',
  'pending the 19:35Z and 20:35Z managers ticks', 'fleet_tasks management-personas and management-personas-c definitions',
  'Rollback line of migrations/2026-11-04-roadmap-origination-moves.sql',
  'roadmap-origination-runs-in-the-finishing-workflow',
  'by 20:40Z roadmap asks exist for four programs, the brief carries North Star and Roadmap lines, dg-request has filed asks for no-doer focus issues',
  'strategic proposals are the reader-facing work; without this run none can be originated',
  'SQLite replay of the move on a stub fleet_tasks, order and idempotence, every moved step prepared against the stub schema'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE actor = 'portfolio-manager (ROADMAP-ORIGINATION-MOVES-1)');
