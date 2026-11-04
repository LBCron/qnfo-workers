-- FORECAST-BOUND-METER-1 (2026-11-04, program QNFO.OPS, charter pillar cost): the bound in v_cost_forecast counts what the caps do not cover, read from the Cloudflare meter.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261104_v_cost_forecast
-- Rollback: DROP VIEW IF EXISTS v_cost_forecast; CREATE VIEW v_cost_forecast AS <sql in bak_20261104_v_cost_forecast>;
-- CAUSE-MAPPED: registers no metric_registry row; it corrects the arithmetic behind the existing guard fleet_cost_bound_month_usd (trigger 10930, cause already mapped to the cost family).
--
-- Why: fleet_cost_bound_month_usd is the guard that answers "what can the fleet spend a month under its caps". It read USD 152.39 on 2026-11-04 while the measured pace was
-- USD 1,151 and the steady state after SPEND-ENFORCE-1 is about USD 340. Two terms were wrong:
--   (1) the code loop term was code_loop_daily_calls x neurons per call; the code loop is bound by code_loop_daily_neurons (100000) since qnfo-code-orchestrator 0.39.0, and
--       code_loop_daily_calls (10) is a routing switch, so the term was 20k neurons instead of the 100k cap;
--   (2) the "measured uncapped remainder" (other_n) summed ai_call_counters of the other workers. 37 to 63 percent of the neurons on 11-01..03 are in no counter (qnfo-agents'
--       deepseek-v4.1-flash through AI Gateway, qnfo-gateway's article writer), so the remainder read about 8k a day when the account spends 0.6M to 1.2M a day outside the caps.
-- Now the remainder is the larger of the old figure and the Cloudflare meter (ai_meter_model_daily, AI-METER-MODEL-1) minus what the five capped workers' counters hold, averaged over
-- the last three complete days the meter has. The bound is the caps plus that measured remainder: an honest "most the fleet spends a day while nothing about the uncapped callers
-- changes", which falls as those callers are bound (qnfo-agents birth cap, qnfo-gateway article backfill ending) and is read by the existing trigger (gt 300 a month).
-- New column uncapped_daily_neurons (last, so every reader by name or by position keeps working) shows the remainder term on its own.
-- PREDICTION: fleet_cost_bound_month_usd rises from 152 to about 380 to 450 on the 11-01..03 days in the meter and settles at 300 to 340 as the remainder ages out; it never reads
-- below the old figure. A rise is the signal, not a regression: the trigger files the cost lever against the uncapped callers.

CREATE TABLE IF NOT EXISTS bak_20261104_v_cost_forecast AS SELECT name, sql FROM sqlite_master WHERE name = 'v_cost_forecast';
DROP VIEW IF EXISTS v_cost_forecast;
CREATE VIEW v_cost_forecast AS
WITH b AS (
  SELECT date('now', 'start of month') AS m0, date('now') AS d0,
    CAST(julianday(date('now', 'start of month', '+1 month')) - julianday(date('now', 'start of month')) AS INTEGER) AS dim,
    CAST(julianday(date('now')) - julianday(date('now', 'start of month')) AS INTEGER) AS done
), cfg AS (
  SELECT
    COALESCE((SELECT CAST(value AS REAL) FROM ops_config WHERE key = 'research_daily_neurons'), 360000) AS research_n,
    COALESCE((SELECT CAST(value AS REAL) FROM ops_config WHERE key = 'q08_daily_neurons'), 150000) AS q08_n,
    COALESCE((SELECT CAST(value AS REAL) FROM ops_config WHERE key = 'code_loop_daily_calls'), 1500) AS code_calls,
    (SELECT CAST(value AS REAL) FROM ops_config WHERE key = 'code_loop_daily_neurons') AS code_n
), mday AS (
  SELECT date AS d, SUM(neurons) AS n FROM ai_meter_model_daily WHERE date >= date('now', '-3 days') AND date < date('now') GROUP BY date
), cday AS (
  SELECT day AS d, SUM(neurons) AS n FROM ai_call_counters
  WHERE worker IN ('qnfo-research-exec', 'errata-hub', 'qnfo-paper-reviser', 'q08-signal-engine', 'qnfo-code-orchestrator') AND day >= date('now', '-3 days') AND day < date('now') GROUP BY day
), meas AS (
  SELECT
    COALESCE((SELECT SUM(neurons) * 1.0 / NULLIF(SUM(calls), 0) FROM ai_call_counters WHERE worker = 'qnfo-code-orchestrator' AND day >= date('now', '-7 days') AND day < date('now')), 2000) AS code_npc,
    COALESCE((SELECT SUM(neurons) / 7.0 FROM ai_call_counters WHERE worker NOT IN ('qnfo-research-exec', 'errata-hub', 'qnfo-paper-reviser', 'q08-signal-engine', 'qnfo-code-orchestrator') AND day >= date('now', '-7 days') AND day < date('now')), 0) AS other_n,
    COALESCE((SELECT AVG(MAX(0, mday.n - COALESCE(cday.n, 0))) FROM mday LEFT JOIN cday ON cday.d = mday.d), 0) AS meter_rem
), c AS (
  SELECT date, usd,
    CASE WHEN source = 'workers_ai' OR instr(source, 'ai_gateway:') = 1 OR source = 'cloudflare_plan:daily' THEN 'fleet'
         WHEN instr(source, 'owner_gateway:') = 1 THEN 'owner_clients'
         WHEN source = 'direct_providers_external:daily' THEN 'owner_direct_unverified' END AS scope,
    CASE WHEN source = 'workers_ai' THEN 0 ELSE 1 END AS non_neuron
  FROM cost_daily WHERE date >= date('now', '-40 days')
), g AS (
  SELECT c.scope,
    SUM(CASE WHEN c.date >= b.m0 AND c.date < b.d0 THEN c.usd ELSE 0 END) AS mtd,
    SUM(CASE WHEN c.date = b.d0 THEN c.usd ELSE 0 END) AS today,
    SUM(CASE WHEN c.date >= date('now', '-3 days') AND c.date < b.d0 THEN c.usd ELSE 0 END) / 3.0 AS d3,
    SUM(CASE WHEN c.date >= date('now', '-7 days') AND c.date < b.d0 THEN c.usd ELSE 0 END) / 7.0 AS d7,
    SUM(CASE WHEN c.non_neuron = 1 AND c.date >= date('now', '-3 days') AND c.date < b.d0 THEN c.usd ELSE 0 END) / 3.0 AS d3_non_neuron,
    MAX(b.dim) AS dim, MAX(b.done) AS done
  FROM c, b WHERE c.scope IS NOT NULL GROUP BY c.scope
), bound AS (
  SELECT MAX(0, cfg.research_n + cfg.q08_n + COALESCE(cfg.code_n, cfg.code_calls * meas.code_npc) + MAX(meas.other_n, meas.meter_rem) - 10000) * 0.011 / 1000 AS neuron_usd,
    cfg.research_n + cfg.q08_n + COALESCE(cfg.code_n, cfg.code_calls * meas.code_npc) + MAX(meas.other_n, meas.meter_rem) AS neurons,
    MAX(meas.other_n, meas.meter_rem) AS uncapped_n
  FROM cfg, meas
)
SELECT g.scope, ROUND(g.mtd, 2) AS mtd_complete_usd, ROUND(g.today, 2) AS today_partial_usd, ROUND(g.d3, 4) AS daily_3d, ROUND(g.d7, 4) AS daily_7d,
  ROUND(g.d3 * 30, 2) AS pace_30d_usd, ROUND(g.mtd + (g.dim - g.done) * g.d3, 2) AS forecast_month_usd, g.dim AS days_in_month, g.done AS complete_days,
  CASE WHEN g.scope = 'fleet' THEN 300 END AS budget_month_usd,
  CASE g.scope WHEN 'fleet' THEN 'measured: GraphQL Workers AI neurons + AI Gateway fleet cost + Cloudflare subscriptions'
             WHEN 'owner_clients' THEN 'measured: owner desktop clients on the gateway (ai_spend_owner_local)'
             ELSE 'UNVERIFIED owner-stated monthly figure / 30; no API sees it' END AS basis,
  CASE WHEN g.scope = 'fleet' THEN ROUND(bound.neuron_usd + g.d3_non_neuron, 4) END AS bound_daily_usd,
  CASE WHEN g.scope = 'fleet' THEN ROUND(bound.neurons) END AS bound_daily_neurons,
  CASE WHEN g.scope = 'fleet' THEN ROUND(g.mtd + (g.dim - g.done) * MIN(g.d3, bound.neuron_usd + g.d3_non_neuron), 2) ELSE ROUND(g.mtd + (g.dim - g.done) * g.d3, 2) END AS forecast_bounded_month_usd,
  CASE WHEN g.scope = 'fleet' THEN ROUND(30 * (bound.neuron_usd + g.d3_non_neuron), 2) END AS bound_30d_usd,
  CASE WHEN g.scope = 'fleet' THEN ROUND(bound.uncapped_n) END AS uncapped_daily_neurons
FROM g, bound;

UPDATE metric_registry SET formula = '30 x v_cost_forecast.bound_daily_usd (scope fleet): the most the fleet can spend per day under research_daily_neurons + q08_daily_neurons + code_loop_daily_neurons (code_loop_daily_calls x measured neurons per call while that knob is absent) + the uncapped remainder (the larger of the 7-day mean of the other workers counters and the 3-day mean of the Cloudflare meter ai_meter_model_daily minus the five capped workers counters), at USD 0.011 per 1k neurons after the 10k free neurons a day, plus the non-neuron daily cost'
WHERE metric = 'fleet_cost_bound_month_usd';

INSERT INTO decision_log
 (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, surfaces_tested)
SELECT 'claude-code-session-2026-11-04-spend-enforce',
 'A guard that reads USD 152 while the pace is USD 1,151 and the steady state about USD 340 hides the uncapped callers it exists to expose',
 'FORECAST-BOUND-METER-1: v_cost_forecast bound = caps (code loop by neurons) + the uncapped remainder from the Cloudflare meter; new column uncapped_daily_neurons',
 'v_cost_forecast on 2026-11-04: bound_daily_neurons 456,636 (research 360k + q08 + code 10 calls x npc + other 7-day counters), meter 11-01..03 3.2 to 3.7M neurons a day with 37 to 63 percent in no counter',
 'the view returns the same 15 columns and one more; fleet_cost_bound_month_usd is recomputed by the next scripts/cost_ledger.py run',
 'one view and one metric formula text; readers by column name are unaffected; the guard trigger (gt 300) may now fire, which is its purpose',
 'DROP VIEW v_cost_forecast and recreate it from bak_20261104_v_cost_forecast (migration Rollback line)',
 'the cost guard counts spend that no worker counter holds',
 'fleet_cost_bound_month_usd about 380 to 450 on the 11-01..03 meter days, 300 to 340 once the post-cap days are the last three; never below the old figure',
 'sqlite replay of the old view and the new view on the 2026-11-04 shape (migrations/forecast-bound-meter.test.mjs)'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'FORECAST-BOUND-METER-1:%');
