-- AI-SPEND-ROLLUP-1 (2026-11-04, charter pillar cost). One view of where the Cloudflare Workers AI neurons go, by owner of the spend.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DROP VIEW IF EXISTS v_ai_spend_rollup;
-- CAUSE-MAPPED: registers no metric_registry row (a read-only view).
--
-- Why: the owner asked what the whole fleet spends and where. Three views already answer a slice (v_spend_enforcement: the budgeted callers against
-- their budgets; v_ai_meter_vs_counters: per model; v_ai_meter_daily: the account), and none of them says in one table "research X, code loop Y,
-- q08 Z, the probe agent W, other counted callers V, unattributed U, total T". This view is that table, per UTC day for the last 10 days:
--   research        qnfo-research-exec + errata-hub + qnfo-paper-reviser, ai_call_counters (the research_daily_neurons population)
--   code-loop       qnfo-code-orchestrator, ai_call_counters
--   q08             q08-signal-engine, ai_call_counters
--   other-counted   every other worker that writes ai_call_counters (qnfo-ai, qnfo-ops, personal-*, idea-hub, ...)
--   qnfo-agents     the Cloudflare meter's @cf/deepseek-ai/deepseek-v4.1-flash-1017 neurons minus any counter rows for that model: qnfo-agents'
--                   issue-probe-agent is the only caller of that model and writes no counter rows (11-01..03: 3.27M meter, 0 counted)
--   unattributed    the meter total minus everything above, never below 0 (a day whose counters exceed the meter shows 0: counters bill failed
--                   calls the meter does not)
--   total           the Cloudflare meter (ai_meter_model_daily) for the day, the number the bill follows
-- pct_of_meter is each bucket's share of the day's meter total; usd is the bucket at USD 0.011 per 1k neurons, before the 10k free neurons a day.
-- Reading: SELECT * FROM v_ai_spend_rollup WHERE date = date('now', '-1 day') ORDER BY neurons DESC;

CREATE VIEW IF NOT EXISTS v_ai_spend_rollup AS
WITH meter AS (
  SELECT date, SUM(neurons) AS neurons FROM ai_meter_model_daily WHERE date >= date('now', '-10 days') GROUP BY date
),
counted AS (
  SELECT day AS date,
         CASE WHEN worker IN ('qnfo-research-exec', 'errata-hub', 'qnfo-paper-reviser') THEN 'research'
              WHEN worker = 'qnfo-code-orchestrator' THEN 'code-loop'
              WHEN worker = 'q08-signal-engine' THEN 'q08'
              ELSE 'other-counted' END AS bucket,
         SUM(neurons) AS neurons
  FROM ai_call_counters WHERE day >= date('now', '-10 days') AND day IN (SELECT date FROM meter) GROUP BY day, 2
),
agents AS (
  SELECT m.date AS date,
         MAX(0, SUM(m.neurons) - COALESCE((SELECT SUM(c.neurons) FROM ai_call_counters c WHERE c.day = m.date AND c.model = m.model), 0)) AS neurons
  FROM ai_meter_model_daily m
  WHERE m.model = '@cf/deepseek-ai/deepseek-v4.1-flash-1017' AND m.date >= date('now', '-10 days')
  GROUP BY m.date, m.model
),
parts AS (
  SELECT date, bucket, neurons FROM counted
  UNION ALL SELECT date, 'qnfo-agents', neurons FROM agents
),
rest AS (
  SELECT m.date AS date, 'unattributed' AS bucket,
         MAX(0, m.neurons - COALESCE((SELECT SUM(p.neurons) FROM parts p WHERE p.date = m.date), 0)) AS neurons
  FROM meter m
),
rolled AS (
  SELECT date, bucket, neurons FROM parts
  UNION ALL SELECT date, bucket, neurons FROM rest
  UNION ALL SELECT date, 'total', neurons FROM meter
)
SELECT r.date AS date, r.bucket AS bucket, CAST(ROUND(r.neurons) AS INTEGER) AS neurons,
       ROUND(100.0 * r.neurons / NULLIF(m.neurons, 0), 1) AS pct_of_meter,
       ROUND(r.neurons / 1000.0 * 0.011, 2) AS usd
FROM rolled r JOIN meter m ON m.date = r.date;
