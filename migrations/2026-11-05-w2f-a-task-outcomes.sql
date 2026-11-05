-- COST-TASK-OUTCOMES-1 (2026-11-05, pillar cost, program QNFO.INFRA, roadmap RM-COST-PER-TASK-ALL-PATHS-1 row 15; cluster W2-F agent W2F-A).
-- v_cost_per_task_class (migrations/2026-11-05-c6-s1-cost-views.sql) shows USD per successful task for the code loop, research, qnfo-agents and the two routers.
-- Every other counted worker sits in an 'all-calls' row whose ok_tasks is NULL: read 2026-11-05 04:00Z, 15 such rows on 11-05 and 15 on 11-04 (USD 2.61 that day),
-- because the outcome tables of those paths are in another database (q08-signal) or do not exist (gateway ask answers, personal-api replies).
-- This file adds the place the outcome goes (task_outcomes_daily), the view that joins it, and one issue for the first thing the join shows:
-- q08-signal-engine spent 107k neurons (about USD 1.18) on 2026-11-04 and published no piece; engine_runs 11-03 and 11-04: 89 and 74 runs, 0 published, 33 of the 74
-- ended 'deferred: forecast research: 4 usable sources; need 6' (the same forecast source re-tried every tick; the gate_failed cap in pickForecastSource does not count a deferral).
-- scripts/cost_task_outcomes.py fills the table (a step of the heavy job of remediation-consumer.yml, every 3 hours, idempotent): q08 pieces per day read as a count from the
-- q08-signal database, and calls minus errors from ai_call_counters for every other worker (ok_kind 'unit-call': the honest unit where no outcome table exists).
-- The personal-life database is not read (PERSONAL-QNFO-SEPARATION-1). Additive only: no DROP, no DELETE, the old view is untouched.
-- PREDICTION: SELECT COUNT(*) FROM v_cost_per_task_all_paths WHERE ok_tasks IS NULL AND day >= date('now','-3 days') goes from 15 (per day, 4 days) to 0 within 3 hours of the
--   first heavy run after the merge; q08-signal-engine shows ok_tasks 0 with its USD on 11-04 and the successful-call rows show USD per call for gateway, ops, ai-search, cloud-ops.
-- CAUSE-MAPPED: no metric is registered in this file.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DROP VIEW IF EXISTS v_cost_per_task_all_paths; DROP TABLE IF EXISTS task_outcomes_daily;

CREATE TABLE IF NOT EXISTS task_outcomes_daily (
  day TEXT NOT NULL,
  path TEXT NOT NULL,
  task_class TEXT NOT NULL,
  ok_tasks INTEGER NOT NULL,
  source TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (day, path, task_class)
) WITHOUT ROWID;

-- One real outcome class per path (q08: piece-published), else the successful-call unit. ok_kind says which one a reader is looking at.
CREATE VIEW IF NOT EXISTS v_cost_per_task_all_paths AS
SELECT v.day AS day, v.path AS path,
  CASE WHEN v.task_class <> 'all-calls' THEN v.task_class WHEN r.task_class IS NOT NULL THEN r.task_class WHEN c.task_class IS NOT NULL THEN c.task_class ELSE v.task_class END AS task_class,
  CASE WHEN v.task_class <> 'all-calls' THEN v.ok_tasks ELSE COALESCE(r.ok_tasks, c.ok_tasks) END AS ok_tasks,
  v.usd AS usd,
  ROUND(v.usd / NULLIF(CASE WHEN v.task_class <> 'all-calls' THEN v.ok_tasks ELSE COALESCE(r.ok_tasks, c.ok_tasks) END, 0), 4) AS usd_per_ok_task,
  CASE WHEN v.task_class <> 'all-calls' THEN 'outcome' WHEN r.ok_tasks IS NOT NULL THEN 'outcome' WHEN c.ok_tasks IS NOT NULL THEN 'unit-call' ELSE 'none' END AS ok_kind,
  CASE WHEN v.task_class <> 'all-calls' THEN v.basis WHEN r.ok_tasks IS NOT NULL THEN v.basis || '. Outcome: ' || r.source WHEN c.ok_tasks IS NOT NULL THEN v.basis || '. Unit: ' || c.source ELSE v.basis END AS basis
FROM v_cost_per_task_class v
LEFT JOIN task_outcomes_daily r ON v.task_class = 'all-calls' AND r.day = v.day AND r.path = v.path AND r.task_class <> 'successful-model-call'
LEFT JOIN task_outcomes_daily c ON v.task_class = 'all-calls' AND c.day = v.day AND c.path = v.path AND c.task_class = 'successful-model-call';

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'COST-Q08-YIELD-1: q08-signal-engine spends about USD 1.18 a day and published nothing on 2026-11-03 and 2026-11-04: the same forecast source is re-tried every tick',
 'code-task: repo=qnfo-workers path=q08-signal-engine/worker.js' || char(10) ||
 'code-anchor: async function pickForecastSource(env) {' || char(10) ||
 'code-probe: {"paths": ["q08-signal-engine/worker.js"], "contains": "FORECAST_DEFER_CAP"}' || char(10) || char(10) ||
 'Charter pillar cost (program QNFO.INFRA), roadmap RM-COST-PER-TASK-ALL-PATHS-1 (row 15). Found by the per-task cost join of COST-TASK-OUTCOMES-1 (migrations/2026-11-05-w2f-a-task-outcomes.sql).' || char(10) ||
 'Evidence (q08-signal engine_runs and qnfo-audit ai_call_counters, read 2026-11-05 04:00Z): 2026-11-03 89 runs, 0 published, compose 109 / verify 270 / panel 134 / factcheck 136 calls; 2026-11-04 74 runs, 0 published, 33 of them status deferred "forecast research: 4 usable sources; need 6", the rest gate_failed (ensemble panel mean 2 of 5, accuracy figure/name not in the source). ai_call_counters q08-signal-engine 11-04: 107,131 neurons (about USD 1.18) in 331 calls (kimi-k2.6 67 calls 46.6k, deepseek-v4-flash 89 calls 23k, gpt-oss-20b 97 calls 22k). Pieces published per day: 2 on 11-01 and 11-02, 0 on 11-03 and 11-04.' || char(10) ||
 'Cause: pickForecastSource skips a source only after two gate_failed runs for it (the "< 2" subquery on engine_runs); a deferred run (research found fewer than LEDGER_MIN_DOCS usable sources) is not counted, so the same source is picked again on the next tick and its research is paid for again.' || char(10) ||
 'DO: in pickForecastSource add a constant FORECAST_DEFER_CAP (3) and extend the engine_runs subquery to count status IN (''gate_failed'', ''deferred'') for the source over the last 24 hours, so a source that cannot be researched is skipped for a day and the next source is tried. Bump with python scripts/worker_release.py bump q08-signal-engine; test: a source with 3 deferred runs is not picked. The q08 plane stays separate: this changes cost behaviour only, no content or voice rule.' || char(10) ||
 'Definition of done: merged and verified live: SELECT SUM(ok_tasks) FROM task_outcomes_daily WHERE path = ''q08-signal-engine'' AND day >= date(''now'', ''-2 days'') is at least 1 within 2 days of the deploy, or the deferred share of q08 engine_runs falls from 45 percent (33 of 74) to under 10 percent; recorded in issue_triage.close_evidence. Prediction: q08-signal-engine neurons 107k a day -> under 60k (about USD 0.5 a day) with no fall in pieces published.',
 'session:w2f-a', 'optimization', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'COST-Q08-YIELD-1%' AND status = 'open');

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:w2f-a', 'A cost with no outcome beside it cannot tell the owner whether the money bought anything; the smallest honest outcome for a path with no outcome table is its successful model calls, labelled as such.',
  'added task_outcomes_daily and v_cost_per_task_all_paths, plus a heavy-job step that fills them (q08 pieces per day as a count, successful calls for the rest)',
  'v_cost_per_task_class read 2026-11-05: 15 all-calls rows with ok_tasks NULL on 11-05 and on 11-04 (USD 2.61); q08-signal engine_runs 11-03 and 11-04: 163 runs, 0 pieces published',
  'applied by CI on merge; the table fills at the next heavy consumer run', 'one new table (about 20 rows a day), one view, no worker deploy, no spend',
  'DROP VIEW IF EXISTS v_cost_per_task_all_paths; DROP TABLE IF EXISTS task_outcomes_daily; remove the Write the daily task outcomes step from remediation-consumer.yml',
  'every counted path has an ok_tasks and a USD per task; a zero-yield spend (q08) is visible on the first read',
  'ok_tasks NULL rows in v_cost_per_task_all_paths 15 a day -> 0', 'none', 'qnfo-audit view queried after the first heavy run'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE actor = 'session:w2f-a' AND action LIKE 'added task_outcomes_daily%');
