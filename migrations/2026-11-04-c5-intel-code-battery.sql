-- CODE-BATTERY-1 (RM-S4-BENCHMARK-1, 2026-11-04, charter pillar autonomy; program QNFO.OPS): the S4 intelligence battery from n=8 to a weekly, execution-graded coding battery.
-- WHAT WAS MEASURED (qnfo-audit read 2026-11-04): the only model-ability measure in the SAI is report_card_inputs.arc_agi_10task_pass_rate = 0.2, written once on 2026-09-10 from a
-- generator JSON (2 of 10 tasks) and never refreshed (55 days old); benchmark_results holds 8 ops tasks x 6 models run once on 2026-09-19; cf_model_eval_battery (cfmb-2) is 17 chat probes
-- that both production controls pass at 1.0 (saturated: it cannot separate models); eval_suite_age_days reads only the ask golden set. Nothing scores coding ability on a schedule.
-- WHAT THIS ADDS: qnfo-code-orchestrator 0.47.0 runs CODE-BATTERY-1 (CB_TASKS in worker.js; qnfo-code-orchestrator/code-battery.test.mjs proves every task has a passing reference and a failing starter):
-- 13 SWE-bench-style and Terminal-Bench-style tasks, the model answers with code, the code runs against hidden tests in a Dynamic Worker (no network, CPU limit), a task passes only when every
-- test passes. One (task, model) pair per scheduled tick, weekly, for gpt-oss-120b, glm-5.3-flash, glm-5.3 and kimi-k2.7-code (the ladder). Rows: benchmark_results task_id cb-1:<task>;
-- report_card_inputs coding_battery_pass_rate (mean over models, errors left out) and coding_battery_detail; the two metrics below. Cost about 12k to 40k neurons a week. ops_config code_battery = off stops it.
-- PROXY, NOT THE SUITES: no repositories, no containers, 13 tasks; it is labelled a proxy in the report_card_inputs source text and in the metric formula (OUTPUT-QUALITY-LEDGER-1). It does not feed the
-- SAI `thinking` dimension (that formula reads arc_agi_10task_pass_rate and is not changed here: scores are raised only by changing what they measure, never the formula).
-- VALIDITY FINDING TO WATCH: a pass rate of 0.95 or more on two runs in a row means the tasks no longer separate models; the follow-up is a harder CB_TASKS set (cb-2), not a higher score.
-- PREDICTION (decision_log below): within 3 hours of the 0.47.0 deploy a run finishes with at least 3 models answered, coding_battery_pass_rate is a number and coding_battery_age_days is 0.
-- Failure modes of this measure: (1) 13 tasks over 4 models is a coarse rate (one task = 0.077), (2) the models see the starter and the brief but never the tests, yet the tasks are public in the repository,
-- so a model trained on this repository could memorise them, (3) reasoning models can spend max_tokens thinking and return no code, which is graded a fail (no-code), not an error.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM analytics_metric_triggers WHERE metric_key = 'coding_battery_age_days'; DELETE FROM metric_unmeasured_exemptions WHERE metric_key IN ('coding_battery_pass_rate', 'coding_battery_age_days'); DELETE FROM metric_breach_cause WHERE metric_key IN ('coding_battery_pass_rate', 'coding_battery_age_days'); DELETE FROM metric_registry WHERE metric IN ('coding_battery_pass_rate', 'coding_battery_age_days'); DELETE FROM capability_ledger WHERE capability = 'coding-battery-weekly'; -- the decision_log row is append-only and stays; benchmark_results cb-1 rows and report_card_inputs coding_battery_* rows are data and stay
-- spof-review: one producer, qnfo-code-orchestrator CODE-BATTERY-1 on its per-minute cron; a stopped producer is read by coding_battery_age_days and its trigger below.
-- runtime-probe (D1): SELECT metric, last_value, last_refreshed FROM metric_registry WHERE metric IN ('coding_battery_pass_rate', 'coding_battery_age_days') -- expected both MEASURED within 3 hours of the deploy
-- CAUSE-MAPPED: INSERT INTO metric_breach_cause below maps both metrics (code-loop, measurement) in this same file.
-- NOOP-OK: INSERT OR IGNORE on every table; a replay inserts nothing.

INSERT OR IGNORE INTO metric_registry
  (metric, layer, kind, formula, source_of_truth, baseline, target, owner, disposition_actor, refresh_cadence, warning_band, kill_band, last_value, last_refreshed, state, refresh_class)
VALUES
  ('coding_battery_pass_rate', 'operational', 'leading',
   'PROXY of SWE-bench / Terminal-Bench style coding ability (OUTPUT-QUALITY-LEDGER-1: a proxy, never a target): mean over the ladder models (gpt-oss-120b, glm-5.3-flash, glm-5.3, kimi-k2.7-code) of tasks passed / tasks answered on the CODE-BATTERY-1 battery cb-1 (13 tasks, hidden tests run in a Dynamic Worker, a task passes only when every test passes; calls that errored are left out). Weekly (RM-S4-BENCHMARK-1)',
   'qnfo-audit.benchmark_results (task_id cb-1:*) -> report_card_inputs coding_battery_pass_rate; written by qnfo-code-orchestrator CODE-BATTERY-1 when a run finishes',
   'none yet: the first run sets it. Earlier measures were arc_agi_10task_pass_rate 0.2 (2026-09-10, 10 tasks, once) and 8 ops tasks (2026-09-19, once)',
   'report only: no absolute gate until two runs exist; a fall of 0.15 or more between runs is a model-quality regression to read per model in coding_battery_detail; 0.95 or more twice is a validity finding (harder tasks)',
   'qnfo-code-orchestrator', 'qnfo-code-orchestrator CODE-BATTERY-1 (weekly); ops_config code_battery = off stops it',
   'weekly', 'fall of 0.15 between runs', 'fall of 0.30 between runs', NULL, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), 'UNMEASURED', 'worker-written'),
  ('coding_battery_age_days', 'operational', 'guard',
   'Whole days since the last CODE-BATTERY-1 run finished (0 at the moment it finishes, refreshed hourly while idle by qnfo-code-orchestrator); a battery that stops running is a blind S4',
   'qnfo-audit.ops_config code_battery_state (done timestamp), written by qnfo-code-orchestrator CODE-BATTERY-1',
   '55 days since the only SAI model benchmark (arc_agi_10task_pass_rate, 2026-09-10) before this battery',
   '<= 9 (a weekly run plus two days of slack)', 'qnfo-code-orchestrator',
   'qnfo-code-orchestrator: analytics_metric_triggers files a code task on codeBatteryTick when it reads over 9',
   '1h', '> 9', '> 21', NULL, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), 'UNMEASURED', 'worker-written');

INSERT OR IGNORE INTO analytics_metric_triggers
  (metric_key, title, source_table, operator, threshold, priority, action, owner, queue_target, cooldown_hours, enabled, notes)
VALUES
  ('coding_battery_age_days', 'S4 gap: the weekly coding battery has not finished a run in over 9 days', 'registry', 'gt', 9, 5,
   'Pillar autonomy. Lever: read why the battery stopped (SELECT value FROM ops_config WHERE key = ''code_battery_state''; SELECT kind, text, ts FROM cloud_ops_events WHERE kind LIKE ''code-battery.%'' ORDER BY ts DESC LIMIT 10; ops_config code_battery must not be off). Typical causes: the Dynamic Worker LOADER binding missing on qnfo-code-orchestrator (pairs recorded as no-loader with a NULL pass), every model call failing (ai-error), or a lease that never lapses. Done: coding_battery_age_days is 0 after a finished run, with a regression test in qnfo-code-orchestrator/code-battery.test.mjs.' || char(10) ||
   'code-task: repo=qnfo-workers path=qnfo-code-orchestrator/worker.js' || char(10) ||
   'code-anchor: async function codeBatteryTick(env, nowMs) {',
   'qnfo-code-orchestrator', 'agent_issues', 24, 1,
   'CODE-BATTERY-1 (RM-S4-BENCHMARK-1): the guard on the weekly S4 coding battery. Switch off with enabled = 0 on this row.');

INSERT OR IGNORE INTO metric_breach_cause (metric_key, cause_key, note) VALUES
  ('coding_battery_age_days', 'code-loop', 'CODE-BATTERY-1 2026-11-04: the battery is a block of qnfo-code-orchestrator driven by its per-minute cron; a stale battery is a defect in that block or its bindings, repaired by a code change, not by a budget.'),
  ('coding_battery_pass_rate', 'measurement', 'CODE-BATTERY-1 2026-11-04: a fall is first read per model in coding_battery_detail and per task in benchmark_results (task_id cb-1:*); the battery is a proxy, so a fall may be a model change or a task that stopped being fair, and is read before it is acted on.');

INSERT OR IGNORE INTO metric_unmeasured_exemptions (metric_key, reason, ends_when, doer) VALUES
  ('coding_battery_pass_rate',
   'worker-written weekly: the first run takes about an hour after the qnfo-code-orchestrator 0.47.0 deploy (one pair per minute, 52 pairs) and the value is NULL until it finishes; also exempt from a threshold trigger because no baseline exists yet (a threshold now would be a guess); the age guard coding_battery_age_days covers a battery that stops',
   'The first CODE-BATTERY-1 run has finished and report_card_inputs coding_battery_pass_rate exists; the next migration sets a fall threshold from two runs',
   'qnfo-code-orchestrator'),
  ('coding_battery_age_days',
   'worker-written: NULL until the first run finishes (about an hour after the 0.47.0 deploy), then 0 and refreshed hourly while idle',
   'coding_battery_age_days holds a number',
   'qnfo-code-orchestrator');

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:c5-intel',
  'the S4 model benchmark (one 10-task ARC result from 2026-09-10 and one 8-task ops run from 2026-09-19) is too small and too old to say whether the models that write the fleet code are getting better or worse; a weekly execution-graded battery for the ladder models is cheap enough (12k to 40k neurons a week) to run without a budget decision',
  'RM-S4-BENCHMARK-1: qnfo-code-orchestrator 0.47.0 CODE-BATTERY-1, weekly coding battery cb-1 (13 tasks, 4 models), with coding_battery_pass_rate and coding_battery_age_days',
  'benchmark_results held 8 ops tasks run once; report_card_inputs.arc_agi_10task_pass_rate 0.2 updated_at 2026-09-10; cf_model_eval_battery cfmb-2 17 chat probes saturated at 1.0; ops_config code_orchestrator_dynamic_cpu {"enforced":true} read 2026-11-03 (Dynamic Worker CPU limits are enforced); qnfo-code-orchestrator/code-battery.test.mjs: reference solutions pass, starters fail, state machine replayed.',
  'pending',
  'one block in qnfo-code-orchestrator (per-minute cron, one D1 read per tick while idle, one model call per tick during a weekly run), two metric rows, one trigger; no new worker, cron or binding',
  'ops_config code_battery = off; or revert the 0.47.0 PR; then the Rollback line of migrations/2026-11-04-c5-intel-code-battery.sql',
  'coding-battery-weekly',
  'a CODE-BATTERY-1 run finishes within 3 hours of the 0.47.0 deploy: report_card_inputs coding_battery_pass_rate is a number and coding_battery_age_days is 0',
  'No external reach gain; autonomy: the S4 measure of model ability is refreshed weekly and a regression of the ladder models is visible.',
  'qnfo-code-orchestrator/code-battery.test.mjs (159 offline checks); scripts/apply_migrations.py --check'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'RM-S4-BENCHMARK-1: qnfo-code-orchestrator 0.47.0%');

INSERT OR IGNORE INTO capability_ledger (capability, provenance, prerequisites, reliability, acquired_at, evidence) VALUES
  ('coding-battery-weekly', 'migrations/2026-11-04-c5-intel-code-battery.sql',
   'qnfo-code-orchestrator Dynamic Worker LOADER binding, the AI binding, benchmark_results, report_card_inputs',
   '0.5', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
   'A weekly, execution-graded coding battery for the ladder models: tasks the models never see the tests of, run in a sandbox with no network; the result is a stored row per pair and two metrics. Unverified live until the first run finishes.');
