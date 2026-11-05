-- CODE-BATTERY-1 logic 1.1 (RM-S4-BENCHMARK-1, 2026-11-05, charter pillar autonomy; program QNFO.OPS): what the first live run of qnfo-code-orchestrator 0.47.0 showed, and the change it asked for.
-- WHAT WAS READ (qnfo-audit benchmark_results task_id cb-1:*, run cb-1-2026-11-05, 00:42Z to 01:08Z): gpt-oss-120b passed 10 of its 13 tasks, among them the multi-defect TtlLru, the .env parser, cut, globs, durations and tar paths.
-- The 3 other pairs were consecutive (split-sql and utm-link graded no-code, clean-path a regex syntax error), inside a window of four minutes, and the same prompt
-- sent through the REST API to the same model returned a complete fenced answer (1956 and 1379 completion tokens, finish stop), whose pipeline replay graded 4/5 on utm-link. So the first version had two defects of its own:
--   (1) an EMPTY reply from a reasoning model was graded as a wrong answer (no-code), where the truth probe of qnfo-ai-calibration already treats it as not answered;
--   (2) the answer extractor cut a block at the first three backticks, even inside a string or a regex of the answer (a task about backticks), and took an unclosed fence (a cut reply) for prose.
-- logic 1.1 (qnfo-code-orchestrator 0.47.1): an empty reply is retried twice and then stored as not answered (pass NULL, left out of the rate, counted as not_answered in coding_battery_detail); the closing fence is a line of its own; an unclosed
-- fence still yields its code; a failed pair stores what the model sent (no-code: <80 characters>); a run written by another logic is abandoned and started again (CB_LOGIC in the state), so numbers of different logics are never mixed.
-- SATURATION, read honestly: 10 of 13 with every task that ran properly passed is what a validity finding looks like. Six harder tasks join (19 in all): an expression evaluator (unary versus ^), cron next-fire (day-of-month OR day-of-week,
-- leap day, a fast loop), a unified-diff applier, RFC 4180 CSV, npm semver ranges (^0.0.x, partial versions) and a stable topological sort. Their reference solutions are in code-battery-refs.mjs, not in worker.js.
-- The metric text said 13 tasks; it is corrected below. No metric, trigger or exemption is added or changed.
-- PREDICTION (decision_log): the logic 1.1 run finishes within 5 hours of the 0.47.1 deploy with at least 3 models answered and at most 10 percent of pairs not answered; coding_battery_pass_rate below 0.95 (the 13-task rate would have been 0.77 for gpt-oss alone). Falsifier: not_answered over 10 percent (the empty-reply rate is then the finding) or a rate of 0.95 or more (the tasks still do not separate models: the next step is cb-2).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_c5_intel_battery_formula
-- Rollback: UPDATE metric_registry SET formula = (SELECT b.formula FROM bak_20261105_c5_intel_battery_formula b WHERE b.metric = metric_registry.metric) WHERE metric = 'coding_battery_pass_rate' AND EXISTS (SELECT 1 FROM bak_20261105_c5_intel_battery_formula b WHERE b.metric = metric_registry.metric); -- the decision_log row is append-only and stays
-- NOOP-OK: the guarded UPDATE matches only the formula text it was written against; a replay matches nothing.

CREATE TABLE IF NOT EXISTS bak_20261105_c5_intel_battery_formula AS
SELECT metric, formula FROM metric_registry WHERE metric = 'coding_battery_pass_rate';

UPDATE metric_registry
SET formula = replace(formula, 'cb-1 (13 tasks, hidden tests', 'cb-1 (logic 1.1: 19 tasks, 13 plain and 6 harder; logic 1.0 had 13; hidden tests')
WHERE metric = 'coding_battery_pass_rate'
  AND instr(formula, 'cb-1 (13 tasks, hidden tests') > 0;

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:c5-intel',
  'a coding battery that grades an empty reply or a cut answer as a wrong answer measures the token budget and the extractor, not the model; and a battery on which a strong model passes every task that ran cannot separate models',
  'RM-S4-BENCHMARK-1: qnfo-code-orchestrator 0.47.1 CODE-BATTERY-1 logic 1.1 (empty reply is not answered, closing fence on its own line, unclosed fence yields code, snippet of a failed pair, 6 harder tasks, a run of another logic restarts)',
  'benchmark_results cb-1:* 2026-11-05 00:42Z to 01:08Z: gpt-oss-120b 10 of 13 passed, the 3 failures consecutive (no-code, no-code, regex syntax error); REST replay of the same two prompts returned complete fenced answers; qnfo-code-orchestrator/code-battery.test.mjs 215 checks including a reference solution for each of the 19 tasks.',
  'pending',
  'qnfo-code-orchestrator CODE-BATTERY-1 block only; the logic marker restarts the run in progress (about 100 minutes, 12k to 60k neurons)',
  'ops_config code_battery = off; or revert the 0.47.1 PR (the 1.0 run state is then restarted again by the marker mismatch)',
  'coding-battery-weekly',
  'logic 1.1 run finishes within 5 hours of the 0.47.1 deploy with at least 3 models answered, at most 10 percent of pairs not answered, and coding_battery_pass_rate below 0.95',
  'No external reach gain; autonomy: the S4 measure separates models and does not count the platform as a model error.',
  'qnfo-code-orchestrator/code-battery.test.mjs; scripts/apply_migrations.py --check; REST replay of two prompts through the Workers AI API'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'RM-S4-BENCHMARK-1: qnfo-code-orchestrator 0.47.1%');
