-- SPEND-ENFORCE-1 (charter pillar: cost). Owner directive 2026-11-04: all AI on Cloudflare, cheap, USD 200-300 a month.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DROP VIEW IF EXISTS v_spend_enforcement; DELETE FROM ops_config WHERE key = 'code_loop_daily_neurons';
-- CAUSE-MAPPED: registers no metric_registry row (a view and one ops_config key).
--
-- Why the caps did not hold (ai_call_counters, 2026-11-01..03, read 2026-11-04):
--   research (qnfo-research-exec + errata-hub + qnfo-paper-reviser) spent 644k / 988k / 996k neurons against research_daily_neurons = 360000.
--     SOFT-DAILY-BUDGET-1 (0.44.0, 11-01 16:30Z) turned the hold into a lean route that changes width and ensemble size, while the cron tick
--     (every 10 minutes) still ran up to 8 rounds; qnfo-research-exec 0.49.0 gives each tick its share of what is left of the day.
--   code loop (qnfo-code-orchestrator) spent 542k / 653k / 245k neurons. code_loop_daily_calls has been 10 since 11-02 (not 100): it is a
--     routing switch that is crossed in the first minutes, after which one step still ran on every 2-minute tick with kimi-k2.7-code and
--     glm-5.3 behind it (190k of 11-03's 245k). qnfo-code-orchestrator 0.39.0 keeps a daily neuron budget: this key.
--   q08-signal-engine spent 119k / 130k / 110k against q08_daily_neurons = 50000 (a pressure flag that only picked the first writer's model).
-- code_loop_daily_neurons 100000 is about USD 1.10 a day at list price (USD 0.011 per 1k neurons). 'off' or 0 disables the budget.
-- Verify after the deploys: SELECT * FROM v_spend_enforcement ORDER BY day DESC, scope; pct_of_budget at or under about 105 for a full day.
INSERT OR IGNORE INTO ops_config (key, value, note, updated_at) VALUES ('code_loop_daily_neurons', '100000', 'SPEND-ENFORCE-1 2026-11-04: qnfo-code-orchestrator daily neuron budget (about USD 1.10 at list price). Under it nothing changes; once spent the ladder keeps the cheap rung and a scheduled tick runs one step per half hour. off or 0 disables. Revert: delete row.', datetime('now'));

CREATE VIEW IF NOT EXISTS v_spend_enforcement AS
WITH d AS (
  SELECT day, worker, SUM(calls) AS calls, SUM(neurons) AS neurons
  FROM ai_call_counters
  WHERE day >= date('now', '-7 days')
  GROUP BY day, worker
),
cfg AS (
  SELECT
    CAST(COALESCE((SELECT value FROM ops_config WHERE key = 'research_daily_neurons'), '360000') AS REAL) AS research,
    CAST(COALESCE((SELECT value FROM ops_config WHERE key = 'code_loop_daily_neurons'), '100000') AS REAL) AS code,
    CAST(COALESCE((SELECT value FROM ops_config WHERE key = 'q08_daily_neurons'), '150000') AS REAL) AS q08
)
SELECT day, 'research' AS scope, CAST(ROUND(SUM(neurons)) AS INTEGER) AS neurons, CAST(SUM(calls) AS INTEGER) AS calls,
       (SELECT research FROM cfg) AS budget_neurons, ROUND(100.0 * SUM(neurons) / NULLIF((SELECT research FROM cfg), 0), 1) AS pct_of_budget
FROM d WHERE worker IN ('qnfo-research-exec', 'errata-hub', 'qnfo-paper-reviser') GROUP BY day
UNION ALL
SELECT day, 'code-loop', CAST(ROUND(SUM(neurons)) AS INTEGER), CAST(SUM(calls) AS INTEGER),
       (SELECT code FROM cfg), ROUND(100.0 * SUM(neurons) / NULLIF((SELECT code FROM cfg), 0), 1)
FROM d WHERE worker = 'qnfo-code-orchestrator' GROUP BY day
UNION ALL
SELECT day, 'q08', CAST(ROUND(SUM(neurons)) AS INTEGER), CAST(SUM(calls) AS INTEGER),
       (SELECT q08 FROM cfg), ROUND(100.0 * SUM(neurons) / NULLIF((SELECT q08 FROM cfg), 0), 1)
FROM d WHERE worker = 'q08-signal-engine' GROUP BY day;
