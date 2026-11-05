-- FLEET-CRON-GRID-1 (2026-11-05, charter pillar autonomy; breach cluster doctor-probes; the CRON-FAULT-1 schedule class, agent_issues 1001842-1001844 were the first three).
-- WHAT WAS MEASURED (qnfo-audit, read-only, 2026-11-05 00:10-00:25Z)
--   migrations/2026-11-05-roadmap-self-maintain-split.sql (ROADMAP-SELF-MAINTAIN-2) inserted three fleet_crons at '31 * * * *', '33 * * * *' and '37 * * * *'. The fleet-exec dispatcher ticks every 5 minutes
--   (CRON-TICK-5M-1), so they run at :35, :35 and :40, but cron-watch (CRON-WATCH-1, v_cron_faults) lists a cron whose minute is not a multiple of 5 as a schedule fault and files one CRON-FAULT-1 issue each. The same class
--   produced the earlier three (management-personas-b/-c, staff-roster at :42, :49, :52, fixed by migrations 2026-11-05-families-ops-a.sql and 2026-11-05-loop-failure-probes.sql) and the qnfo-memory-mcp
--   wrangler cron at :37 (PR 7334): four sources in one day, because nothing checked the minute of a fleet_crons row when the migration was reviewed (scripts/cron_rate_guard.py reads wrangler.toml only).
-- WHAT THIS FILE CHANGES (data only)
--   The three crons move to the minute they effectively ran at, spread over :30, :35 and :40: goals :31 -> :30, roadmap :33 -> :35, metrics :37 -> :40. Each UPDATE is guarded on the old expression, so a second apply or a
--   cron someone has since moved is left alone. migrations/fleet-crons-grid.test.mjs (added with this file) fails a migration dated 2026-11-05 or later that writes a fleet_crons minute off the grid.
-- PREDICTION (decision_log): v_cron_faults lists no schedule fault for fleet_crons; fm-fleet-cron-off-grid reads 0 at its next run (it reads 3 before this file); the three tasks keep running hourly
--   (fleet_runs for roadmap-self-maintain-goals, -roadmap and -metrics show a run within 70 minutes of the apply). Falsifier: a run of any of the three is missed for more than 2 hours.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE fleet_crons SET cron_expr = '31 * * * *' WHERE name = 'roadmap-self-maintain-goals-hourly'; UPDATE fleet_crons SET cron_expr = '33 * * * *' WHERE name = 'roadmap-self-maintain-roadmap-hourly'; UPDATE fleet_crons SET cron_expr = '37 * * * *' WHERE name = 'roadmap-self-maintain-metrics-hourly'
-- CAUSE-MAPPED: registers no metric_registry row.

UPDATE fleet_crons SET cron_expr = '30 * * * *', updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE name = 'roadmap-self-maintain-goals-hourly' AND cron_expr = '31 * * * *';

UPDATE fleet_crons SET cron_expr = '35 * * * *', updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE name = 'roadmap-self-maintain-roadmap-hourly' AND cron_expr = '33 * * * *';

UPDATE fleet_crons SET cron_expr = '40 * * * *', updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE name = 'roadmap-self-maintain-metrics-hourly' AND cron_expr = '37 * * * *';

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:breach-doctor-probes-families-ops',
  'the dispatcher already ran these crons on the 5-minute tick, so writing the minute it effectively used changes no run time and removes the schedule fault',
  'FLEET-CRON-GRID-1: roadmap-self-maintain-goals/-roadmap/-metrics move from :31, :33, :37 to :30, :35, :40; a migration test refuses an off-grid fleet_crons literal in a migration dated 2026-11-05 or later',
  'qnfo-audit fleet_crons 2026-11-05 00:15Z: exactly three enabled rows with a numeric minute that is not a multiple of 5, all from 2026-11-05-roadmap-self-maintain-split.sql; fleet_runs show them started at :34-:38',
  'v_cron_faults lists no fleet_crons schedule fault; fm-fleet-cron-off-grid reads 0',
  'fleet_crons (three rows)',
  'the Rollback line of this file',
  'a migration that writes an off-grid cron fails its own suite before the merge',
  'fm-fleet-cron-off-grid 3 -> 0 at its next run; no CRON-FAULT-1 schedule issue is filed for the three crons',
  'none', 'node migrations/fleet-crons-grid.test.mjs; node migrations/families-ops-c.test.mjs'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'FLEET-CRON-GRID-1:%');
