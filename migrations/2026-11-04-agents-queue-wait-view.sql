-- AGENTS-QUEUE-WAIT-1 (2026-11-04, charter pillar cost, autonomy; program QNFO.OPS). Owner goal: AI cost USD 200-300 a month and managers that originate strategy.
-- WHAT WAS MEASURED (qnfo-audit cf_agent_requests, read 2026-11-04 ~20:30Z): the average minutes from created_at to started_at of the qnfo-agents loop queue were 11.8 on 11-02, 15.8 on 11-03 and 67.4 on
-- 11-04 (program-manager lever rows, instance lever-%: 10.3, 24.3, 105.7). That reading counts only requests that started. QNFO-AGENTS-BUDGET-1 (qnfo-agents 0.7.0, PR 7187) lets the drain defer
-- a request when the day's neuron budget is spent and fails a queued one with `shed: waited over 110 minutes under the daily neuron budget`, and a shed row has no started_at: from the day that
-- ships, "average wait of started rows" falls while the managers wait longer, the survivorship error of a measure that cannot see the rows it drops. The wait of a request that never starts is
-- the time until it was shed, or until now while it still queues.
-- WHAT THIS ADDS (a read-only view, no worker is edited, no cron is added, no metric is registered, so no trigger or exemption is owed): v_agents_queue_wait_daily, one row per UTC day of the last
-- 14 days with requests, started, shed, still_open, avg_wait_min (every request; shed and queued rows count to their shed time or to now), avg_wait_started_min (the old reading, kept to compare),
-- max_wait_min, over_20m and over_120m (rows that waited longer), and the same average for lever rows (instance lever-%). Verification of any change to the drain (rate, order, budget) reads this
-- view for the days before and after, with the spend reading v_ai_spend_rollup bucket qnfo-agents beside it. cf_agent_requests holds a few thousand rows, so the scan is small.
-- Rollback: DROP VIEW IF EXISTS v_agents_queue_wait_daily;
-- APPLY-BY: ci
-- DB: qnfo-audit
-- runtime-probe (D1): SELECT day, requests, avg_wait_min FROM v_agents_queue_wait_daily ORDER BY day DESC LIMIT 3 -- expected rows for the last three days

CREATE VIEW IF NOT EXISTS v_agents_queue_wait_daily AS
WITH r AS (
  SELECT substr(created_at, 1, 10) AS day,
         started_at,
         instance,
         status,
         COALESCE(error, '') AS error,
         (julianday(COALESCE(started_at, finished_at, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))) - julianday(created_at)) * 1440.0 AS wait_min
  FROM cf_agent_requests
  WHERE created_at >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-14 days')
)
SELECT day,
       COUNT(*) AS requests,
       SUM(started_at IS NOT NULL) AS started,
       SUM(started_at IS NULL AND error LIKE 'shed:%') AS shed,
       SUM(status IN ('queued', 'running')) AS still_open,
       ROUND(AVG(wait_min), 1) AS avg_wait_min,
       ROUND(AVG(CASE WHEN started_at IS NOT NULL THEN wait_min END), 1) AS avg_wait_started_min,
       ROUND(MAX(wait_min), 0) AS max_wait_min,
       SUM(wait_min > 20) AS over_20m,
       SUM(wait_min > 120) AS over_120m,
       SUM(instance LIKE 'lever-%') AS lever_requests,
       ROUND(AVG(CASE WHEN instance LIKE 'lever-%' THEN wait_min END), 1) AS lever_avg_wait_min
FROM r
GROUP BY day;
