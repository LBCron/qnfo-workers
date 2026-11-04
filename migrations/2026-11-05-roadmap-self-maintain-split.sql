-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_roadmap_self_maintain_split
-- Rollback: UPDATE fleet_tasks SET definition = (SELECT v FROM bak_20261105_roadmap_self_maintain_split WHERE kind = 'task' AND k = 'roadmap-self-maintain'), version = version + 1, updated_at = datetime('now') WHERE id = 'roadmap-self-maintain'; UPDATE fleet_crons SET enabled = 0 WHERE name IN ('roadmap-self-maintain-goals-hourly', 'roadmap-self-maintain-roadmap-hourly', 'roadmap-self-maintain-metrics-hourly'); UPDATE fleet_tasks SET enabled = 0 WHERE id IN ('roadmap-self-maintain-goals', 'roadmap-self-maintain-roadmap', 'roadmap-self-maintain-metrics'); UPDATE remediation_contracts SET verify_probe = (SELECT v FROM bak_20261105_roadmap_self_maintain_split WHERE kind = 'probe' AND k = 'fm-goals-unevaluated-counts-deferred-probes') WHERE class = 'fm-goals-unevaluated-counts-deferred-probes'.
--
-- ROADMAP-SELF-MAINTAIN-2 (2026-11-05, charter pillar autonomy; cluster sla-graph-fm of the fleet breach audit).
-- Metrics: goals_unevaluated 221 (issue 100069, target 0), roadmap_open_unplaced 4 (target 0), goals_completed_7d; fm-goals-unevaluated-counts-deferred-probes.
--
-- WHAT WAS READ (qnfo-audit, 2026-11-04 22:30-23:30Z, before this file)
--   metric_registry.last_refreshed: goals_unevaluated and roadmap_open_unplaced 2026-11-04T15:30:5xZ, goals_completed_7d 13:34Z. Every other metric refreshed in the last hour.
--   The same measures computed live now: goals_unevaluated 0 (the exact SELECT of step 17, 950 ms, 91k rows), roadmap_open_unplaced 0. The breach values (221, 4) are seven
--   hours old, not current, and nothing in the fleet will refresh them while the task cannot finish.
--   fleet_runs for roadmap-self-maintain: 12 of 14 runs since id 68000 are `orphaned: invocation ended before the run finished` (CRON-ADVANCE-FIRST-1), two are still
--   `running` after 40+ minutes (22:30:48Z and 21:30:47Z), the last ok run is 13:34:53Z (ledger event 'goals adopted 281'). A run row names no step: STEP-TIMING-1 writes progress
--   only after 45 s, so a run that stops earlier says nothing. management-personas (63 steps, 4-10 s), event-metric-recompute and cron-watch finish in the same executor; the one
--   shared property of the orphaning tasks (roadmap-self-maintain 22 steps, metric-refresh 15, red-drain 10, management-personas-c 12) is a long serial chain of writes through trigger
--   cascades in a single invocation, where the first statement that stops answering takes every later step with it, including the three one-line metric refreshes at the end.
--   Costs measured idle: reopen / reopen-log (steps 10-11) read 753k rows and 3.4 s EACH, complete-log 73k rows; under the overload of the same hours each is many times slower.
--   fm-goals-unevaluated-counts-deferred-probes reads 0 because the metric is older than 180 minutes, the same cause.
--
-- WHAT THIS FILE DOES
--   Splits the single 22-step chain into four independent tasks on their own crons, the existing steps byte for byte, in the same order:
--     roadmap-self-maintain          steps 0-7   programs, objectives, goal contracts                       cron :30 (unchanged)
--     roadmap-self-maintain-goals    steps 8-11  complete a goal on a passing DoD, reopen after two failures  cron :31
--     roadmap-self-maintain-roadmap  steps 12-16 roadmap_implementation verify / reopen                      cron :33
--     roadmap-self-maintain-metrics  steps 17-21 the three metric refreshes and the run ledger               cron :37
--   Each task is short, so (a) a statement that stops answering costs one task, not the metrics behind it, (b) the dispatcher spreads the work over three more 2-minute ticks instead
--   of one invocation, (c) the next orphan names its part: the fleet_runs rows of the four tasks say which group stalls, and that group is then bisected step by step (the cause is not
--   proven by this file; this file removes its blast radius and makes it measurable). fm-goals-unevaluated-counts-deferred-probes follows its step to the metrics task.
--   No step text, goal, contract, roadmap row or metric definition changes. The split is guarded: it runs only while the original task still has exactly 22 steps, and trims the
--   original only after the three new tasks exist with 4, 5 and 5 steps.
-- Prediction (decision_log): goals_unevaluated 221 -> 0 and roadmap_open_unplaced 4 -> 0 at the first metrics run (:37 of the next hour) and fm-goals-unevaluated-counts-deferred-probes passes;
-- goals_completed_7d refreshes hourly again. If one of the three other tasks orphans, its fleet_runs rows name the group and the owning issue is that group.
-- spof-review: no new worker, binding or credential; three fleet_tasks rows and three fleet_crons rows on the existing dispatcher, each reversible by enabled = 0.

CREATE TABLE IF NOT EXISTS bak_20261105_roadmap_self_maintain_split AS
  SELECT 'task' AS kind, id AS k, definition AS v FROM fleet_tasks WHERE id = 'roadmap-self-maintain'
  UNION ALL SELECT 'probe', class, verify_probe FROM remediation_contracts WHERE class = 'fm-goals-unevaluated-counts-deferred-probes';

INSERT OR IGNORE INTO fleet_tasks (id, name, type, definition, timeout_ms, retries, version, enabled, updated_at)
SELECT 'roadmap-self-maintain-goals',
  'ROADMAP-SELF-MAINTAIN-2 (goals): a goal completes on a passing DoD and reopens after two failures since the last pass (steps 8-11 of the former single task)',
  'workflow',
  json_object('steps', json((SELECT json_group_array(json(s.value)) FROM (SELECT j.value AS value FROM json_each(json_extract(f.definition, '$.steps')) j WHERE j.key BETWEEN 8 AND 11 ORDER BY j.key) s))),
  120000, 1, 1, 1, datetime('now')
FROM fleet_tasks f WHERE f.id = 'roadmap-self-maintain' AND json_array_length(json_extract(f.definition, '$.steps')) = 22;

INSERT OR IGNORE INTO fleet_tasks (id, name, type, definition, timeout_ms, retries, version, enabled, updated_at)
SELECT 'roadmap-self-maintain-roadmap',
  'ROADMAP-SELF-MAINTAIN-2 (roadmap): roadmap_implementation rows verified or reopened from goal, project and failure-mode state (steps 12-16 of the former single task)',
  'workflow',
  json_object('steps', json((SELECT json_group_array(json(s.value)) FROM (SELECT j.value AS value FROM json_each(json_extract(f.definition, '$.steps')) j WHERE j.key BETWEEN 12 AND 16 ORDER BY j.key) s))),
  120000, 1, 1, 1, datetime('now')
FROM fleet_tasks f WHERE f.id = 'roadmap-self-maintain' AND json_array_length(json_extract(f.definition, '$.steps')) = 22;

INSERT OR IGNORE INTO fleet_tasks (id, name, type, definition, timeout_ms, retries, version, enabled, updated_at)
SELECT 'roadmap-self-maintain-metrics',
  'ROADMAP-SELF-MAINTAIN-2 (metrics): goals_unevaluated, goals_without_machine_dod, roadmap_open_unplaced, goals_completed_7d and the run ledger (steps 17-21 of the former single task)',
  'workflow',
  json_object('steps', json((SELECT json_group_array(json(s.value)) FROM (SELECT j.value AS value FROM json_each(json_extract(f.definition, '$.steps')) j WHERE j.key BETWEEN 17 AND 21 ORDER BY j.key) s))),
  120000, 1, 1, 1, datetime('now')
FROM fleet_tasks f WHERE f.id = 'roadmap-self-maintain' AND json_array_length(json_extract(f.definition, '$.steps')) = 22;

UPDATE fleet_tasks
SET definition = json_object('steps', json((SELECT json_group_array(json(s.value)) FROM (SELECT j.value AS value FROM json_each(json_extract(fleet_tasks.definition, '$.steps')) j WHERE j.key BETWEEN 0 AND 7 ORDER BY j.key) s))),
    version = version + 1, updated_at = datetime('now')
WHERE id = 'roadmap-self-maintain' AND json_array_length(json_extract(definition, '$.steps')) = 22
  AND EXISTS (SELECT 1 FROM fleet_tasks n WHERE n.id = 'roadmap-self-maintain-goals' AND json_array_length(json_extract(n.definition, '$.steps')) = 4)
  AND EXISTS (SELECT 1 FROM fleet_tasks n WHERE n.id = 'roadmap-self-maintain-roadmap' AND json_array_length(json_extract(n.definition, '$.steps')) = 5)
  AND EXISTS (SELECT 1 FROM fleet_tasks n WHERE n.id = 'roadmap-self-maintain-metrics' AND json_array_length(json_extract(n.definition, '$.steps')) = 5);

INSERT OR IGNORE INTO fleet_crons (name, cron_expr, task_id, enabled, timezone, updated_at)
SELECT c.name, c.cron_expr, c.task_id, 1, 'UTC', datetime('now') FROM (
  SELECT 'roadmap-self-maintain-goals-hourly' AS name, '31 * * * *' AS cron_expr, 'roadmap-self-maintain-goals' AS task_id
  UNION ALL SELECT 'roadmap-self-maintain-roadmap-hourly', '33 * * * *', 'roadmap-self-maintain-roadmap'
  UNION ALL SELECT 'roadmap-self-maintain-metrics-hourly', '37 * * * *', 'roadmap-self-maintain-metrics'
) c WHERE EXISTS (SELECT 1 FROM fleet_tasks t WHERE t.id = c.task_id AND t.enabled = 1);

-- The detector reads the deferred-aware clause in the step it measures, now step 0 of the metrics task.
UPDATE remediation_contracts
SET verify_probe = replace(replace(verify_probe, 'WHERE id=''roadmap-self-maintain'' AND enabled = 1', 'WHERE id=''roadmap-self-maintain-metrics'' AND enabled = 1'), '$.steps[17].sql', '$.steps[0].sql'),
    last_verdict = NULL, attempts = 0, next_due_at = datetime('now')
WHERE class = 'fm-goals-unevaluated-counts-deferred-probes' AND instr(verify_probe, '$.steps[17].sql') > 0;

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:breach-sla-graph-fm', 'a long serial chain of trigger-heavy writes in one invocation loses everything behind its first stalled statement, so the metrics at its end go stale and read as breaches',
  'ROADMAP-SELF-MAINTAIN-2: fleet_tasks roadmap-self-maintain split into four independent tasks on their own crons (:30 steps 0-7, :31 steps 8-11, :33 steps 12-16, :37 steps 17-21), step text unchanged; fm-goals-unevaluated-counts-deferred-probes follows its step',
  'read 2026-11-04 22:30-23:30Z: 12 of 14 runs orphaned since id 68000, last ok run 13:34:53Z; goals_unevaluated and roadmap_open_unplaced last refreshed 15:30Z with live values 0 and 0 against the stored 221 and 4; steps 10-11 read 753k rows and 3.4 s each',
  'migration merged', 'three fleet_tasks rows, three fleet_crons rows, one trimmed task definition, one probe text', 'see the Rollback header and bak_20261105_roadmap_self_maintain_split',
  'one stalled statement costs one group of steps, not the metrics; the group that stalls is named by its own fleet_runs rows',
  'goals_unevaluated 221 to 0 and roadmap_open_unplaced 4 to 0 at the first :37 run; goals_completed_7d refreshes hourly; the stored value was stale, so this is a correction of the reading and of the loop, not a change in the goals',
  'goals complete and reopen on their DoD again; the goal and roadmap metrics are fresh enough for their triggers',
  'd1:qnfo-audit fleet_tasks, fleet_crons, fleet_runs, metric_registry, goals, remediation_contracts'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE instr(action, 'ROADMAP-SELF-MAINTAIN-2:') = 1);

INSERT OR IGNORE INTO decision_predictions (decision_id, kind, subject, op, value, due_at, origin)
SELECT d.id, 'metric', p.subject, p.op, p.value, strftime('%Y-%m-%dT%H:%M:%SZ', 'now', p.due), 'seeded'
FROM decision_log d JOIN (
  SELECT 'goals_unevaluated' AS subject, '<=' AS op, 10 AS value, '+3 hours' AS due
  UNION ALL SELECT 'roadmap_open_unplaced', '<=', 0, '+3 hours'
) p ON instr(d.action, 'ROADMAP-SELF-MAINTAIN-2:') = 1;
