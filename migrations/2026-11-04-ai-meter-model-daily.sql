-- AI-METER-MODEL-1 (2026-11-04, charter pillar: cost). The Cloudflare Workers AI meter by model and day, next to the per-worker counters.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DROP VIEW IF EXISTS v_ai_meter_vs_counters; DROP VIEW IF EXISTS v_ai_meter_daily; DROP TABLE IF EXISTS ai_meter_model_daily; DELETE FROM ops_config WHERE key = 'ai_account_daily_neurons';
-- CAUSE-MAPPED: registers no metric_registry row (two views, one table, one ops_config key).
--
-- Why: every per-worker cap (research_daily_neurons, code_loop_daily_neurons, q08_daily_neurons) reads ai_call_counters, and the counters hold
-- 37-46 percent of what Cloudflare bills. Read 2026-11-04 (GraphQL aiInferenceAdaptiveGroups against the counters, 11-01..03): the account's
-- Workers AI neurons were 3.21M / 3.68M / 3.56M a day (cost_daily USD 35.25 / 40.34 / 39.03) against counters of 1.41M / 1.95M / 1.48M; by model,
-- deepseek-v4.1-flash-1017 3.27M vs 0 (qnfo-agents, issue-probe-agent), kimi-k2.6 1.24M vs 0.19M, kimi-k2.7-code 1.52M vs 0.85M. The
-- ledger only kept a daily total (cost_daily.workers_ai), so the unattributed share could not be sized per model without ad-hoc API calls, and
-- the GraphQL rate limiter ("budget depleted") makes ad-hoc reads unreliable. scripts/cost_ledger.py (hourly, remediation-consumer.yml)
-- already reads this feed per day; it now keeps the modelId dimension it was discarding, one extra column set in the same call.
-- Reading: SELECT * FROM v_ai_meter_vs_counters WHERE date = date('now', '-1 day') ORDER BY unattributed_neurons DESC; the first rows are the
-- models whose spend no worker counts. v_ai_meter_daily is the account total against ops_config ai_account_daily_neurons (800000 a day, about
-- USD 8.7 plus the USD 5 plan a month = under the owner's USD 300; a gauge for now, not a brake).

CREATE TABLE IF NOT EXISTS ai_meter_model_daily (
  date TEXT NOT NULL,
  model TEXT NOT NULL,
  neurons REAL NOT NULL DEFAULT 0,
  requests INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  observed_at TEXT,
  PRIMARY KEY (date, model)
);

INSERT OR IGNORE INTO ops_config (key, value, note, updated_at)
VALUES ('ai_account_daily_neurons', '800000', 'AI-METER-MODEL-1 2026-11-04: account-wide Workers AI neurons a day that fits the owner USD 300 a month all-in (about USD 8.7 a day plus the plan). A gauge read by v_ai_meter_daily; no worker is stopped by it.', datetime('now'));

CREATE VIEW IF NOT EXISTS v_ai_meter_vs_counters AS
WITH c AS (
  SELECT day, model, SUM(neurons) AS neurons, SUM(calls) AS calls
  FROM ai_call_counters
  WHERE day >= date('now', '-10 days')
  GROUP BY day, model
)
SELECT m.date AS date, m.model AS model,
       CAST(ROUND(m.neurons) AS INTEGER) AS meter_neurons, m.requests AS meter_requests,
       CAST(ROUND(COALESCE(c.neurons, 0)) AS INTEGER) AS counter_neurons, CAST(COALESCE(c.calls, 0) AS INTEGER) AS counter_calls,
       CAST(ROUND(m.neurons - COALESCE(c.neurons, 0)) AS INTEGER) AS unattributed_neurons,
       ROUND(100.0 * COALESCE(c.neurons, 0) / NULLIF(m.neurons, 0), 1) AS attributed_pct
FROM ai_meter_model_daily m LEFT JOIN c ON c.day = m.date AND c.model = m.model;

CREATE VIEW IF NOT EXISTS v_ai_meter_daily AS
SELECT m.date AS date, CAST(ROUND(SUM(m.neurons)) AS INTEGER) AS neurons, SUM(m.requests) AS requests,
       ROUND(MAX(0, SUM(m.neurons) - 10000) / 1000.0 * 0.011, 2) AS usd,
       CAST(COALESCE((SELECT value FROM ops_config WHERE key = 'ai_account_daily_neurons'), '800000') AS INTEGER) AS target_neurons,
       ROUND(100.0 * SUM(m.neurons) / CAST(COALESCE((SELECT value FROM ops_config WHERE key = 'ai_account_daily_neurons'), '800000') AS REAL), 1) AS pct_of_target,
       CAST(ROUND(SUM(m.neurons) - COALESCE((SELECT SUM(c.neurons) FROM ai_call_counters c WHERE c.day = m.date), 0)) AS INTEGER) AS unattributed_neurons
FROM ai_meter_model_daily m
WHERE m.date >= date('now', '-10 days')
GROUP BY m.date;
