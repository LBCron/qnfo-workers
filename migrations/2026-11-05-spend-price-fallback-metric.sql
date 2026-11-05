-- SPEND-PRICE-FALLBACK-2 (2026-11-05, charter pillar cost; sweep cluster B-governance-code; GitHub 7026, follow-up of #6980 and PR 6985; part 1 is qnfo-ai 5.46.1, PR 7039).
-- Part 1 shipped the producer: spendRecord counts every ledger call that spendUsd priced from a catch-all rate (the Workers AI fallback neuron rate or a provider "*" entry) in ai_call_counters under
-- purpose 'spend-price-fallback', by model (read 2026-11-05: 2 calls of @cf/zai-org/glm-5.2 on 2026-11-04, nothing else, so the counter fires only for a genuinely unknown model).
-- Part 2, this file, is what the issue's definition of done still names: the guard metric `spend_ledger_fallback_priced_rows` (target 0) with its trigger, the cause mapping, and the failure mode with
-- its detector for the #6980 class.
--   * metric: fallback-priced ledger calls counted today (UTC) in ai_call_counters purpose 'spend-price-fallback'. 0 on a day with no new unknown model; a new unknown model reads its call count.
--     Refreshed hourly in the first ten minutes by the trigger spend_price_fallback_tick on fleet_tick (the pattern of agents_lever_usable_tick), and once when this file is applied.
--   * trigger (gt 0, priority 6, cooldown 24 h): the lever is a code task on qnfo-ai that adds the model's rate to the price table, so a pricing artifact like #6980 (a @cf/ model priced at the
--     GPT-5.5 rate, about 90x) is repaired by a doer, not found by hand arithmetic. Telemetry only: the counter does not change any price.
--   * failure mode spend-price-fallback and its standing detector fm-spend-price-fallback: a code-read of qnfo-ai/worker.js that fails if the counter write is removed (the metric would then read 0
--     for the wrong reason).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DROP TRIGGER IF EXISTS spend_price_fallback_tick; DELETE FROM remediation_contracts WHERE class = 'fm-spend-price-fallback'; DELETE FROM failure_modes WHERE fm_key = 'spend-price-fallback'; DELETE FROM metric_breach_cause WHERE metric_key = 'spend_ledger_fallback_priced_rows'; DELETE FROM analytics_metric_triggers WHERE metric_key = 'spend_ledger_fallback_priced_rows'; DELETE FROM metric_registry WHERE metric = 'spend_ledger_fallback_priced_rows'; DELETE FROM decision_log WHERE actor = 'session:B-governance-code' AND capability_gain = 'spend-price-fallback-guard';
-- spof-review: one producer, the spend_price_fallback_tick trigger on fleet_tick (first ten minutes of each hour); a missed tick leaves the reading an hour old.
-- CAUSE-MAPPED: INSERT INTO metric_breach_cause below maps spend_ledger_fallback_priced_rows (spend) in this same file.
-- NOOP-OK: the first-reading UPDATE of the registry row is idempotent; a replay rewrites the same reading.

INSERT OR IGNORE INTO metric_registry
  (metric, layer, kind, formula, source_of_truth, baseline, target, owner, disposition_actor, refresh_cadence, warning_band, kill_band, last_value, last_refreshed, state, refresh_class)
VALUES
  ('spend_ledger_fallback_priced_rows', 'operational', 'guard',
   'Calls the AI spend ledger priced from a catch-all rate today (UTC): sum of ai_call_counters.calls where purpose = spend-price-fallback and day = today (SPEND-PRICE-FALLBACK-1, qnfo-ai spendRecord). 0 on a day with no new unknown model; a pricing artifact such as issue 6980 (a @cf/ model priced at the GPT-5.5 rate, about 90x) reads here before it reads as spend',
   'qnfo-audit.ai_call_counters (purpose spend-price-fallback); refreshed hourly by trigger spend_price_fallback_tick on fleet_tick',
   '2 calls of @cf/zai-org/glm-5.2 on 2026-11-04 (nothing else in 3 days)', '0', 'qnfo-ai',
   'qnfo-ai spend ledger: analytics_metric_triggers files a code task on qnfo-ai that adds the model rate to the price table', '1h', '> 0', NULL, NULL,
   strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), 'UNMEASURED', 'computed');

CREATE TRIGGER IF NOT EXISTS spend_price_fallback_tick
AFTER INSERT ON fleet_tick
WHEN strftime('%M', 'now') < '10' OR NEW.source LIKE 'migration:%'
BEGIN
  UPDATE metric_registry
  SET last_value = CAST((SELECT COALESCE(SUM(calls), 0) FROM ai_call_counters WHERE purpose = 'spend-price-fallback' AND day = date('now')) AS TEXT),
      last_refreshed = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
      state = 'MEASURED'
  WHERE metric = 'spend_ledger_fallback_priced_rows';
END;

UPDATE metric_registry
SET last_value = CAST((SELECT COALESCE(SUM(calls), 0) FROM ai_call_counters WHERE purpose = 'spend-price-fallback' AND day = date('now')) AS TEXT),
    last_refreshed = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
    state = 'MEASURED'
WHERE metric = 'spend_ledger_fallback_priced_rows';

INSERT INTO analytics_metric_triggers
  (metric_key, title, source_table, operator, threshold, priority, action, owner, queue_target, cooldown_hours, enabled, notes)
SELECT
  'spend_ledger_fallback_priced_rows', 'Cost gap: the AI spend ledger priced calls from a catch-all rate (an unknown model or a pricing artifact)', 'registry', 'gt', 0, 6,
   'Pillar cost. A model reached the ledger without a price of its own, so its spend is a guess (issue 6980: a @cf/ model priced at the GPT-5.5 rate overstated about 90x). First read which model: SELECT day, model, SUM(calls) FROM ai_call_counters WHERE purpose = ''spend-price-fallback'' AND day >= date(''now'', ''-2 days'') GROUP BY day, model. Lever: add the model''s neuron rates (per 1M input and output tokens, from the Workers AI catalog or the gateway price list) to the right table in qnfo-ai/worker.js (__AI_ATTR_RATES for Workers AI models, SPEND_GATEWAY_CF_RATES for @cf/ models that reach the ledger only through the gateway, SPEND_PRICES for the other providers); the counter is telemetry and changes no price by itself. Definition of done: the metric reads 0 for a full UTC day after the deploy, qnfo-ai VERSION bumped and its mirror identical, a regression test that the model is priced from its own entry.' || char(10) ||
   'code-task: repo=qnfo-workers path=qnfo-ai/worker.js' || char(10) ||
   'code-anchor: function spendPriceFallback(provider, model) {',
   'qnfo-ai', 'agent_issues', 24, 1,
   'SPEND-PRICE-FALLBACK-2: guard on the cost metrics; one issue per breach, cooldown 24 hours. A gain in a target metric while this guard is above 0 is a pricing artifact until the model is priced. Switch off with enabled = 0 on this row.'
WHERE NOT EXISTS (SELECT 1 FROM analytics_metric_triggers WHERE metric_key = 'spend_ledger_fallback_priced_rows');

INSERT OR IGNORE INTO metric_breach_cause (metric_key, cause_key, note) VALUES
  ('spend_ledger_fallback_priced_rows', 'spend', 'SPEND-PRICE-FALLBACK-2 2026-11-05: a ledger call priced from a catch-all rate is a model missing from the price tables of qnfo-ai; the repair is a price entry in qnfo-ai/worker.js (a code change in the spend ledger), not a budget or a model switch.');

INSERT OR IGNORE INTO failure_modes
  (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id, trigger_condition, symptom, blast_radius)
VALUES
  ('spend-price-fallback',
   'a model reaches the AI spend ledger without a price of its own and a catch-all rate stands in, so a spend alarm can be a pricing artifact (issue 6980: gateway @cf/ models priced at the GPT-5.5 rate, about 90x)',
   'spendUsd falls through to the Workers AI fallback neuron rate or a provider "*" entry for any model absent from its tables, silently',
   'qnfo-ai spendRecord counts each such call (ai_call_counters purpose spend-price-fallback, PR 7039); metric spend_ledger_fallback_priced_rows has a trigger whose lever is a price-table entry; this detector fails if the counter write is removed',
   'fm-spend-price-fallback: qnfo-ai/worker.js still writes the spend-price-fallback counter', 'fm-spend-price-fallback', '2026-11-05', NULL,
   'the counter write in spendRecord is absent from qnfo-ai/worker.js on main',
   'a spend alarm that is arithmetic on a wrong rate, found only by hand (issue 6980)',
   'every AI spend reading in the dashboard, the spend governor and the fleet_budget caps');

INSERT OR IGNORE INTO remediation_contracts
  (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module)
VALUES
  ('fm-spend-price-fallback', NULL,
   'qnfo-ai/worker.js on main writes ai_call_counters purpose spend-price-fallback from spendRecord',
   'failure-mode detector: restore the counter write in spendRecord (qnfo-ai/worker.js, SPEND-PRICE-FALLBACK-1) and its regression test; without it the metric spend_ledger_fallback_priced_rows reads 0 for the wrong reason',
   '{"paths":["qnfo-ai/worker.js"],"contains":"''qnfo-ai'', ''spend-price-fallback'', ?2"}',
   'code-read', 3, 'qnfo-fleet-control', 1, 'active', 'failure-mode');

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:B-governance-code',
  'a pricing artifact must be seen as a metric breach with a doer, not by hand arithmetic; the producer shipped in PR 7039, the guard and its trigger complete the issue',
  'SPEND-PRICE-FALLBACK-2: register spend_ledger_fallback_priced_rows with a trigger (code task on qnfo-ai), the cause mapping, the failure mode and its detector',
  'ai_call_counters purpose spend-price-fallback: 2 calls of @cf/zai-org/glm-5.2 on 2026-11-04 and nothing else in 3 days; issue 6980 was a gateway @cf/ model priced at the GPT-5.5 rate (about 90x), found by hand',
  'pending', 'one registry row, one trigger on fleet_tick (first ten minutes of the hour), one metric trigger, one failure mode and its detector; no worker change and no price change',
  'the Rollback line of migrations/2026-11-05-spend-price-fallback-metric.sql',
  'spend-price-fallback-guard',
  'the metric reads 0 on a day with no new unknown model; the next unknown model files one issue with a code task that prices it, and the metric returns to 0 after the deploy',
  'none (cost integrity)', 'node migrations/spend-price-fallback-metric.test.mjs (SQLite fixture: the trigger refreshes the reading, the reading is falsifiable)'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE actor = 'session:B-governance-code' AND capability_gain = 'spend-price-fallback-guard');
