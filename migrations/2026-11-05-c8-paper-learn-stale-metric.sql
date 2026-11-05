-- PAPER-LEARN-STALE-1 (2026-11-05, charter pillar autonomy, program QNFO.OPS; cluster C8-PROJECTS-GOALS of the roadmap and backlog completion sweep; follow-up of PAPER-LEARN-RETRIAGE-1, PR 7486).
-- PR 7486 (qnfo-lifecycle 1.18.0) makes every probationary paper learning leave probation within about 72 hours: each is read again every 20 hours by two model families, settled when both agree it is covered or rejected,
-- and lapsed as rejected on the third apply answer. Its goal PAPER-LEARN-<id> then completes on its next probe. Nothing watches that this works: if the step stops (kill switch left off, a model outage, an error
-- the tick swallows) the family silently refills at about 65 goals a day, which is the defect PR 7379 had to repair by hand.
--   * metric `paper_learn_goals_stale_96h` (guard, target 0): adopted goals PAPER-LEARN-% created more than 96 hours ago whose learning is still in probation (read 2026-11-05 01:50Z: 0; 46 goals are adopted, the oldest from 2026-11-01 16:01Z, all with settled learnings that wait for their contract probe: that wait is the consumer backlog and is not counted here). Refreshed hourly in the first ten
--     minutes by the trigger paper_learn_stale_tick on fleet_tick (the pattern of spend_price_fallback_tick), and once when this file is applied.
--   * trigger (gt 0, priority 5, cooldown 24 h): the lever is a read of ops_config paper_learn_retriage and paper_learn_triage and of the last paper-learn events; the code task points at plRetriage in qnfo-lifecycle.
--   * failure mode paper-learn-probation-stuck with its detector fm-paper-learn-probation-stuck (code-read: plRetriage is still in qnfo-lifecycle/worker.js, so the step cannot be deleted while the metric still reads 0 because nothing ever reaches 96 hours).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DROP TRIGGER IF EXISTS paper_learn_stale_tick; DELETE FROM remediation_contracts WHERE class = 'fm-paper-learn-probation-stuck'; DELETE FROM failure_modes WHERE fm_key = 'paper-learn-probation-stuck'; DELETE FROM metric_breach_cause WHERE metric_key = 'paper_learn_goals_stale_96h'; DELETE FROM analytics_metric_triggers WHERE metric_key = 'paper_learn_goals_stale_96h'; DELETE FROM metric_registry WHERE metric = 'paper_learn_goals_stale_96h'
-- spof-review: one producer, the paper_learn_stale_tick trigger on fleet_tick (first ten minutes of each hour); a missed tick leaves the reading an hour old.
-- CAUSE-MAPPED: INSERT INTO metric_breach_cause below maps paper_learn_goals_stale_96h (code-loop) in this same file.
-- NOOP-OK: the first-reading UPDATE of the registry row is idempotent; a replay rewrites the same reading.

INSERT OR IGNORE INTO metric_registry
  (metric, layer, kind, formula, source_of_truth, baseline, target, owner, disposition_actor, refresh_cadence, warning_band, kill_band, last_value, last_refreshed, state, refresh_class)
VALUES
  ('paper_learn_goals_stale_96h', 'operational', 'guard',
   'Probationary paper learnings whose adopted goal PAPER-LEARN-<id> was created more than 96 hours ago: count of adopted goals with goal_key like PAPER-LEARN- and created_at older than 96 hours whose paper_learnings row (id from the goal key) is still in fleet_status probation. 0 while the probation re-triage (qnfo-lifecycle plRetriage, PAPER-LEARN-RETRIAGE-1) settles or lapses every probationary learning within about 72 hours and the goal completes on its probe; above 0 means a learning or its goal is stuck and the family refills (about 65 new goals a day before the fix)',
   'qnfo-audit.goals (goal_key PAPER-LEARN-%); refreshed hourly by trigger paper_learn_stale_tick on fleet_tick',
   '0 read 2026-11-05 01:50Z (before PR 7379, 225 probationary learnings and goals were 1 to 4 days old and none had been settled)', '0', 'qnfo-lifecycle',
   'qnfo-lifecycle plRetriage: analytics_metric_triggers files a code task on qnfo-lifecycle when the re-triage stalls', '1h', '> 0', NULL, NULL,
   strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), 'UNMEASURED', 'computed');

CREATE TRIGGER IF NOT EXISTS paper_learn_stale_tick
AFTER INSERT ON fleet_tick
WHEN strftime('%M', 'now') < '10' OR NEW.source LIKE 'migration:%'
BEGIN
  UPDATE metric_registry
  SET last_value = CAST((SELECT COUNT(*) FROM goals g JOIN paper_learnings l ON l.id = CAST(substr(g.goal_key, 13) AS INTEGER) WHERE g.goal_key LIKE 'PAPER-LEARN-%' AND g.status = 'adopted' AND g.created_at < datetime('now', '-96 hours') AND l.fleet_status = 'probation') AS TEXT),
      last_refreshed = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
      state = 'MEASURED'
  WHERE metric = 'paper_learn_goals_stale_96h';
END;

UPDATE metric_registry
SET last_value = CAST((SELECT COUNT(*) FROM goals g JOIN paper_learnings l ON l.id = CAST(substr(g.goal_key, 13) AS INTEGER) WHERE g.goal_key LIKE 'PAPER-LEARN-%' AND g.status = 'adopted' AND g.created_at < datetime('now', '-96 hours') AND l.fleet_status = 'probation') AS TEXT),
    last_refreshed = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
    state = 'MEASURED'
WHERE metric = 'paper_learn_goals_stale_96h';

INSERT INTO analytics_metric_triggers
  (metric_key, title, source_table, operator, threshold, priority, action, owner, queue_target, cooldown_hours, enabled, notes)
SELECT
  'paper_learn_goals_stale_96h', 'Autonomy gap: an adopted PAPER-LEARN goal is older than 96 hours, so the probation re-triage is not settling learnings', 'registry', 'gt', 0, 5,
   'Pillar autonomy. A probationary paper learning (or its goal) outlived the re-triage that should settle or lapse it within about 72 hours. First read: SELECT key, value FROM ops_config WHERE key IN (''paper_learn_triage'', ''paper_learn_retriage''); SELECT fleet_status, COUNT(*), MIN(updated_at) FROM paper_learnings WHERE fleet_status = ''probation'' GROUP BY 1; SELECT goal_key, created_at FROM goals WHERE goal_key LIKE ''PAPER-LEARN-%'' AND status = ''adopted'' AND created_at < datetime(''now'', ''-96 hours'') LIMIT 10; and the latest job paper-learn event in cloud_ops_events (the triage object lists examined, retriaged, lapsed and error). A learning that is already settled but whose goal is adopted waits for its contract probe (look at remediation_contracts class goal-PAPER-LEARN-<id>), which is the consumer backlog, not this step. Lever: fix the step in qnfo-lifecycle plRetriage (an error swallowed by the tick, a model that always answers apply) or switch the flag back on. Definition of done: the metric reads 0 for 24 hours and `SELECT COUNT(*) FROM paper_learnings WHERE fleet_status = ''probation''` stays under 15.' || char(10) ||
   'code-task: repo=qnfo-workers path=qnfo-lifecycle/worker.js' || char(10) ||
   'code-anchor: async function plRetriage(env, o, mechs, now, out) {',
   'qnfo-lifecycle', 'agent_issues', 24, 1,
   'PAPER-LEARN-STALE-1: guard on the PAPER-LEARN family; one issue per breach, cooldown 24 hours. Switch off with enabled = 0 on this row.'
WHERE NOT EXISTS (SELECT 1 FROM analytics_metric_triggers WHERE metric_key = 'paper_learn_goals_stale_96h');

INSERT OR IGNORE INTO metric_breach_cause (metric_key, cause_key, note) VALUES
  ('paper_learn_goals_stale_96h', 'code-loop', 'PAPER-LEARN-STALE-1 2026-11-05: a stale PAPER-LEARN goal means plRetriage in qnfo-lifecycle is not settling probationary learnings; the repair is a code change in that step (or its flag), not a budget or a metric threshold.');

INSERT OR IGNORE INTO failure_modes
  (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id, trigger_condition, symptom, blast_radius)
VALUES
  ('paper-learn-probation-stuck',
   'probationary paper learnings stop being settled, so a goal PAPER-LEARN-<id> is adopted for each and none completes: 225 open roadmap rows and about 65 new goals a day (read 2026-11-04)',
   'PAPER-LEARN-TRIAGE-1 parked a learning in probation once, against a catalogue of 6 mechanisms, and nothing read it again; its goal DoD accepted only applied or rejected',
   'qnfo-lifecycle 1.18.0 plRetriage reads each probation learning every 20 hours with both model families (covered, rejected or a counted apply, lapsed on the third), the goal DoD accepts four settled states; metric paper_learn_goals_stale_96h watches it and this detector pins the step',
   'fm-paper-learn-probation-stuck: qnfo-lifecycle/worker.js still carries plRetriage', 'fm-paper-learn-probation-stuck', '2026-11-05', NULL,
   'plRetriage is absent from qnfo-lifecycle/worker.js on main',
   'adopted PAPER-LEARN goals and open GL- roadmap rows accumulate while their learnings sit in probation',
   'the roadmap goal rows, metric goals_unevaluated and the issue-free backlog of the paper-learn family');

INSERT OR IGNORE INTO remediation_contracts
  (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module)
VALUES
  ('fm-paper-learn-probation-stuck', NULL,
   'qnfo-lifecycle/worker.js on main carries plRetriage (PAPER-LEARN-RETRIAGE-1)',
   'failure-mode detector: restore the probation re-triage step in plTriageTick (qnfo-lifecycle/worker.js, PAPER-LEARN-RETRIAGE-1) and its tests; without it probationary learnings and their goals pile up again',
   '{"paths":["qnfo-lifecycle/worker.js"],"contains":"async function plRetriage("}',
   'code-read', 3, 'qnfo-fleet-control', 1, 'active', 'failure-mode');

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:c8-projects-goals',
  'a loop that closes a backlog must be watched by a metric with a doer, or the backlog silently refills; the re-triage shipped in PR 7486, the guard completes it',
  'PAPER-LEARN-STALE-1: register paper_learn_goals_stale_96h with a trigger (code task on qnfo-lifecycle plRetriage), the cause mapping, the failure mode and its detector',
  'qnfo-audit 2026-11-05: 229 PAPER-LEARN goals created in 4 days, 225 adopted and failing, 4 completed before PR 7379; after it 189 completed, 6 new probation learnings in an hour; the oldest adopted goal is under 96 hours old',
  'pending', 'one registry row, one trigger on fleet_tick (first ten minutes of the hour), one metric trigger, one failure mode and its detector; no worker change',
  'the Rollback line of migrations/2026-11-05-c8-paper-learn-stale-metric.sql',
  'paper-learn-stale-guard',
  'the metric reads 0; if the re-triage stalls the 96-hour mark files one issue with a code task on plRetriage and the metric returns to 0 after the fix',
  'none (autonomy integrity)', 'node migrations/c8-paper-learn-stale-metric.test.mjs (SQLite fixture: the trigger refreshes the reading and the reading is falsifiable)'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE actor = 'session:c8-projects-goals' AND capability_gain = 'paper-learn-stale-guard');
