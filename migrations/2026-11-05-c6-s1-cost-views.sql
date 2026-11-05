-- C6-S1 cost slice (roadmap RM-COST-PREFIX-CACHE-1, RM-COST-PER-TASK-ALL-PATHS-1, RM-COST-L5-DISTILLATION-1, RM-COST-L6-DRAFT-VERIFY-1, RM-ANALYTICS-ENGINE-METERS-1), charter pillar cost, program QNFO.INFRA.
-- No new spend: one table, five views, one hourly D1 workflow (two ledger rows read, a handful of counter rows written).
--
-- WHAT WAS MEASURED (qnfo-audit, read 2026-11-04 23:05Z):
--   * workers_ai_attribution_coverage_pct = 33.9 (target >= 80): SUM(ai_call_counters.neurons) 1.0M of the 2.91M neurons Cloudflare billed.
--     v_ai_meter_vs_counters: deepseek-v4.1-flash-1017 meter 1,132,591 neurons / 7,126 requests, counters 0. That model is the AI Gateway route
--     dynamic/standard that qnfo-agents calls. It writes ai_spend_ledger (tokens, cached_tok) but never ai_call_counters, which is the table the
--     coverage metric and the attribution views read. The ledger holds 40,575,348 input / 1,011,911 output / 10,153,600 cached tokens for the day.
--   * Prefix caching is realised, not absent (RM-COST-PREFIX-CACHE-1 was written when cache_read_tokens was 0): ai_cache_counters 2026-11-04
--     qnfo-research-exec 19.7 percent of 15.6M input tokens cached, qnfo-ai-search 94.1, qnfo-ops 36.0, q08-signal-engine 14.9, qnfo-agents 25.0
--     over the whole day (88 percent in the 19:20Z window after PREFIX-CACHE-AGENTS-1). What was missing was the money: the ledger prices cached
--     tokens at the full input rate, and Cloudflare publishes a cached rate 5 to 50 times lower (deepseek-v4.1-flash-1017 USD 0.006 against 0.30).
--   * Code loop rungs (code_tasks merged, model = rung that merged): 2026-11-04 gpt-oss-120b 17, glm-5.3 5, kimi-k2.7-code 3 (68 percent of merges at
--     the cheap first rung), 2026-11-03 15 / 8 / 5 (54 percent): the draft-verify ladder is live, only unmeasured per rung.
--
-- WHAT THIS ADDS
--   1. cf_model_cached_price: Cloudflare's published USD per million input / cached input / output tokens (docs pages read 2026-11-05).
--   2. v_prefix_cache_effect (ledger callers) and v_prefix_cache_share (binding callers): cached share and the dollars cache saved, priced from 1.
--   3. v_cost_per_task_class: USD per successful task for the code loop, research, qnfo-agents and the ops/ai routers, over 14 days.
--   4. v_ladder_rung_outcomes: merges, calls and neurons per code-loop rung, so cost per merged task is read per rung (L6).
--   5. v_distill_candidates: the recurring structured task classes ranked by spend, the selection step of L5 distillation.
--   6. Workflow ai-ledger-rollup (hourly, :25): rolls the qnfo-agents ledger rows of today and yesterday into ai_call_counters as worker qnfo-agents,
--      purpose ledger-rollup, model = the model the route resolved to, neurons priced cache-aware from 1. The rows are overwritten, never added to.
--      The ledger usd column is left alone on purpose: v_agents_usd_per_usable_lever (PR 7172) is baselined on it.
-- PREDICTION: workers_ai_attribution_coverage_pct 33.9 -> at least 60 at the next hourly metric run after the first workflow tick (qnfo-agents
--   about 0.95M of 2.9M neurons). v_ai_meter_vs_counters deepseek-v4.1-flash-1017 attributed_pct 0 -> 60 to 100. Revert = the Rollback line.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE fleet_crons SET enabled = 0 WHERE name = 'ai-ledger-rollup-hourly'; UPDATE fleet_tasks SET enabled = 0 WHERE id = 'ai-ledger-rollup'; UPDATE ai_call_counters SET neurons = 0 WHERE worker = 'qnfo-agents' AND purpose = 'ledger-rollup'; UPDATE roadmap_implementation SET status = 'partial' WHERE id = 14 AND source = 'routing_policy CTX PARTIAL (cache_read_tokens=0)'; UPDATE roadmap_implementation SET status = 'partial' WHERE id = 16 AND item = 'RM-COST-UNIFIED-SPEND-1'; UPDATE roadmap_implementation SET status = 'not-built' WHERE id = 122 AND item = 'RM-COST-FLOOR-40-1';

CREATE TABLE IF NOT EXISTS cf_model_cached_price (
  model_id TEXT PRIMARY KEY,
  price_in REAL NOT NULL,
  price_out REAL NOT NULL,
  price_cached REAL NOT NULL,
  source_url TEXT NOT NULL,
  checked_on TEXT NOT NULL,
  note TEXT
) WITHOUT ROWID;

INSERT OR REPLACE INTO cf_model_cached_price (model_id, price_in, price_out, price_cached, source_url, checked_on, note) VALUES
 ('@cf/deepseek-ai/deepseek-v4.1-flash-1017', 0.30, 1.20, 0.006, 'https://developers.cloudflare.com/workers-ai/models/deepseek-v4.1-flash-1017/', '2026-11-05', 'the model the AI Gateway route dynamic/standard resolved to on 2026-11-04 (Cloudflare meter)'),
 ('@cf/deepseek-ai/deepseek-v4-flash-0731', 0.44, 1.32, 0.014, 'https://developers.cloudflare.com/workers-ai/models/deepseek-v4-flash-0731/', '2026-11-05', NULL),
 ('@cf/deepseek-ai/deepseek-v4-pro-0813', 1.32, 3.96, 0.044, 'https://developers.cloudflare.com/workers-ai/models/deepseek-v4-pro-0813/', '2026-11-05', NULL),
 ('@cf/zai-org/glm-5.3-flash', 0.15, 0.50, 0.03, 'https://developers.cloudflare.com/workers-ai/models/glm-5.3-flash/', '2026-11-05', NULL),
 ('@cf/zai-org/glm-5.3', 1.40, 4.40, 0.26, 'https://developers.cloudflare.com/workers-ai/models/glm-5.3/', '2026-11-05', NULL),
 ('@cf/zai-org/glm-5.2', 1.40, 4.40, 0.26, 'https://developers.cloudflare.com/workers-ai/platform/pricing/', '2026-11-05', NULL),
 ('@cf/moonshotai/kimi-k2.6', 0.95, 4.00, 0.16, 'https://developers.cloudflare.com/workers-ai/models/kimi-k2.6/', '2026-11-05', NULL),
 ('@cf/moonshotai/kimi-k2.7-code', 0.95, 4.00, 0.19, 'https://developers.cloudflare.com/workers-ai/models/kimi-k2.7-code/', '2026-11-05', NULL),
 ('@cf/qwen/qwen3.8-27b', 0.45, 3.20, 0.05, 'https://developers.cloudflare.com/workers-ai/models/qwen3.8-27b/', '2026-11-05', NULL),
 ('@cf/openai/gpt-oss-120b', 0.35, 0.75, 0.35, 'https://developers.cloudflare.com/workers-ai/models/gpt-oss-120b/', '2026-11-05', 'no cached-input rate published: cached tokens are priced as input, so the view shows no saving for this model');

CREATE VIEW IF NOT EXISTS v_prefix_cache_effect AS
SELECT l.day AS day, l.caller AS caller, l.model AS model, p.model_id AS priced_as, l.calls AS calls,
  l.in_tok AS in_tok, l.cached_tok AS cached_tok, l.out_tok AS out_tok,
  ROUND(100.0 * l.cached_tok / NULLIF(l.in_tok, 0), 1) AS cached_share_pct,
  ROUND(l.usd, 3) AS ledger_usd,
  ROUND(((MAX(l.in_tok - l.cached_tok, 0) * p.price_in + MIN(l.cached_tok, l.in_tok) * p.price_cached + l.out_tok * p.price_out) / 1000000.0), 3) AS usd_cache_aware,
  ROUND(MIN(l.cached_tok, l.in_tok) * (p.price_in - p.price_cached) / 1000000.0, 3) AS saved_by_cache_usd
FROM ai_spend_ledger l
JOIN cf_model_cached_price p ON p.model_id = CASE WHEN l.model LIKE 'dynamic/%' THEN '@cf/deepseek-ai/deepseek-v4.1-flash-1017' ELSE l.model END
WHERE l.provider = 'workers-ai' AND l.day >= date('now', '-14 days');

CREATE VIEW IF NOT EXISTS v_prefix_cache_share AS
SELECT c.day AS day, c.worker AS worker, c.model AS model, c.calls AS calls, c.cached_calls AS cached_calls,
  c.in_tok AS in_tok, c.cached_tok AS cached_tok,
  ROUND(100.0 * c.cached_tok / NULLIF(c.in_tok, 0), 1) AS cached_share_pct,
  ROUND(c.cached_tok * (p.price_in - p.price_cached) / 1000000.0, 3) AS saved_usd
FROM ai_cache_counters c LEFT JOIN cf_model_cached_price p ON p.model_id = c.model
WHERE c.day >= date('now', '-14 days');

CREATE VIEW IF NOT EXISTS v_cost_per_task_class AS
WITH nus AS (
  SELECT day, worker, SUM(neurons) AS neurons FROM ai_call_counters WHERE day >= date('now', '-14 days') GROUP BY day, worker
),
code_ok AS (
  SELECT substr(merged_at, 1, 10) AS day, COUNT(*) AS n FROM code_tasks WHERE status = 'merged' AND merged_at >= date('now', '-14 days') GROUP BY 1
),
paper_ok AS (
  SELECT substr(published_at, 1, 10) AS day, COUNT(*) AS n FROM research_queue WHERE published_at >= date('now', '-14 days') GROUP BY 1
),
run_ok AS (
  SELECT date(created_ms / 1000, 'unixepoch') AS day, COUNT(*) AS n FROM cf_agent_runs WHERE status = 'done' AND created_ms >= CAST(strftime('%s', 'now', '-14 days') AS INTEGER) * 1000 GROUP BY 1
)
SELECT n.day AS day, 'code-loop' AS path, 'merged-pr' AS task_class, COALESCE(c.n, 0) AS ok_tasks,
  ROUND(n.neurons * 0.000011, 3) AS usd, ROUND(n.neurons * 0.000011 / NULLIF(c.n, 0), 3) AS usd_per_ok_task,
  'ai_call_counters neurons of qnfo-code-orchestrator x USD 0.011 per 1k, over code_tasks merged that day' AS basis
FROM nus n LEFT JOIN code_ok c ON c.day = n.day WHERE n.worker = 'qnfo-code-orchestrator'
UNION ALL
SELECT r.day, 'research', 'paper-published', COALESCE(c.n, 0), ROUND(r.neurons * 0.000011, 3), ROUND(r.neurons * 0.000011 / NULLIF(c.n, 0), 3),
  'ai_call_counters neurons of qnfo-research-exec, errata-hub, qnfo-paper-reviser x USD 0.011 per 1k, over research_queue published that day'
FROM (SELECT day, SUM(neurons) AS neurons FROM nus WHERE worker IN ('qnfo-research-exec', 'errata-hub', 'qnfo-paper-reviser') GROUP BY day) r
LEFT JOIN paper_ok c ON c.day = r.day
UNION ALL
SELECT n.day, 'agents', 'run-done', COALESCE(c.n, 0), ROUND(n.neurons * 0.000011, 3), ROUND(n.neurons * 0.000011 / NULLIF(c.n, 0), 3),
  'ledger-rollup neurons of qnfo-agents (cache-aware) x USD 0.011 per 1k, over cf_agent_runs done that day'
FROM nus n LEFT JOIN run_ok c ON c.day = n.day WHERE n.worker = 'qnfo-agents'
UNION ALL
SELECT substr(ts, 1, 10), worker || '-router', task_class, SUM(success), ROUND(SUM(cost_usd), 3), ROUND(SUM(cost_usd) / NULLIF(SUM(success), 0), 4),
  'cost_router_metrics cost_usd (paid-route dollars: free @cf calls cost 0 here), over successful tasks'
FROM cost_router_metrics WHERE ts >= date('now', '-14 days') GROUP BY 1, 2, 3
UNION ALL
SELECT n.day, n.worker, 'all-calls', NULL, ROUND(n.neurons * 0.000011, 3), NULL,
  'ai_call_counters neurons x USD 0.011 per 1k. The outcome of this path (q08 pieces, papers, replies) is stored in another database, so no per-task figure yet'
FROM nus n WHERE n.worker NOT IN ('qnfo-code-orchestrator', 'qnfo-research-exec', 'errata-hub', 'qnfo-paper-reviser', 'qnfo-agents');

CREATE VIEW IF NOT EXISTS v_ladder_rung_outcomes AS
WITH m AS (
  SELECT substr(merged_at, 1, 10) AS day, model, COUNT(*) AS merged FROM code_tasks WHERE status = 'merged' AND merged_at >= date('now', '-14 days') GROUP BY 1, 2
),
c AS (
  SELECT day, model, SUM(calls) AS calls, SUM(errors) AS errors, SUM(neurons) AS neurons FROM ai_call_counters
  WHERE worker = 'qnfo-code-orchestrator' AND purpose = 'ladder' AND day >= date('now', '-14 days') GROUP BY day, model
),
k AS (SELECT day, model FROM m UNION SELECT day, model FROM c),
t AS (SELECT day, SUM(merged) AS merged FROM m GROUP BY day)
SELECT k.day AS day, k.model AS rung_model, COALESCE(m.merged, 0) AS merged_at_rung,
  ROUND(100.0 * COALESCE(m.merged, 0) / NULLIF(t.merged, 0), 1) AS share_of_day_merges_pct,
  COALESCE(c.calls, 0) AS ladder_calls, COALESCE(c.errors, 0) AS ladder_errors,
  CAST(ROUND(COALESCE(c.neurons, 0)) AS INTEGER) AS neurons,
  ROUND(COALESCE(c.neurons, 0) * 0.000011, 3) AS usd,
  ROUND(COALESCE(c.neurons, 0) * 0.000011 / NULLIF(m.merged, 0), 3) AS usd_per_merge_at_rung
FROM k LEFT JOIN m ON m.day = k.day AND m.model = k.model LEFT JOIN c ON c.day = k.day AND c.model = k.model LEFT JOIN t ON t.day = k.day;

CREATE VIEW IF NOT EXISTS v_distill_candidates AS
SELECT worker, purpose, model, SUM(calls) AS calls_7d, ROUND(SUM(calls) / 7.0, 1) AS calls_per_day,
  ROUND(100.0 * SUM(errors) / NULLIF(SUM(calls), 0), 1) AS error_pct,
  CAST(ROUND(SUM(neurons)) AS INTEGER) AS neurons_7d, ROUND(SUM(neurons) * 0.000011, 2) AS usd_7d,
  CAST(ROUND(1.0 * SUM(in_tok) / NULLIF(SUM(calls), 0)) AS INTEGER) AS avg_in_tok,
  CAST(ROUND(1.0 * SUM(out_tok) / NULLIF(SUM(calls), 0)) AS INTEGER) AS avg_out_tok
FROM ai_call_counters
WHERE day >= date('now', '-7 days') AND purpose <> 'spend-price-fallback' AND purpose <> 'ledger-rollup'
GROUP BY worker, purpose, model HAVING SUM(calls) >= 50
ORDER BY neurons_7d DESC;

INSERT INTO fleet_tasks (id, name, type, definition, timeout_ms, retries, version, enabled, updated_at)
VALUES ('ai-ledger-rollup', 'C6-S1 / RM-ANALYTICS-ENGINE-METERS-1: roll the qnfo-agents ledger rows into ai_call_counters so Workers AI attribution coverage sees the agent loop', 'workflow',
 '{"steps":[{"type":"sql","db":"AUDIT","sql":"INSERT INTO ai_call_counters (day, worker, purpose, model, calls, errors, in_chars, ms, in_tok, out_tok, neurons) SELECT l.day, ''qnfo-agents'', ''ledger-rollup'', p.model_id, SUM(l.calls), 0, 0, 0, SUM(l.in_tok), SUM(l.out_tok), SUM((MAX(l.in_tok - l.cached_tok, 0) * p.price_in + MIN(l.cached_tok, l.in_tok) * p.price_cached + l.out_tok * p.price_out) / 11.0) FROM ai_spend_ledger l JOIN cf_model_cached_price p ON p.model_id = CASE WHEN l.model LIKE ''dynamic/%'' THEN ''@cf/deepseek-ai/deepseek-v4.1-flash-1017'' ELSE l.model END WHERE l.caller = ''qnfo-agents'' AND l.provider = ''workers-ai'' AND l.day >= date(''now'', ''-1 day'') GROUP BY l.day, p.model_id ON CONFLICT(day, worker, purpose, model) DO UPDATE SET calls = excluded.calls, in_tok = excluded.in_tok, out_tok = excluded.out_tok, neurons = excluded.neurons"}]}',
 30000, 1, 1, 1, datetime('now'))
ON CONFLICT(id) DO UPDATE SET name = excluded.name, definition = excluded.definition, version = fleet_tasks.version + 1, enabled = 1, updated_at = excluded.updated_at;

INSERT INTO fleet_crons (name, cron_expr, task_id, enabled, timezone, updated_at)
VALUES ('ai-ledger-rollup-hourly', '25 * * * *', 'ai-ledger-rollup', 1, 'UTC', datetime('now'))
ON CONFLICT(name) DO UPDATE SET cron_expr = excluded.cron_expr, task_id = excluded.task_id, enabled = excluded.enabled, updated_at = excluded.updated_at;

UPDATE roadmap_implementation SET status = 'verified', verified_at = datetime('now'),
  evidence = 'ALREADY DONE (read 2026-11-04 23:05Z, C6-S1): qnfo-audit v_cost_all_in (PR 7168, cost-ledger-allvendor-1) is the one monthly figure: month-to-date USD 160.11, forecast USD 1601.13, budget USD 300 (ops_config cost_budget_month_usd), 16 lines (cloudflare 8 lines USD 115.11 month-to-date, github 3, owner 5 = direct_providers 45 owner-stated), measured USD 1151.13 + owner-stated USD 450 of the 1601.13 forecast, workers_ai 114.61, workers_paid_plan 0.5. GET https://fleet.qnfo.org/api/cost serves all_in and all_in_lines. The fleet_budget row cost:fleet_all_in_month (cap 300, target 250, current 1151.13) is the cap. Gateway unified billing, BYOK providers, Workers AI and the plan are all lines of cost_vendor_month.'
  WHERE id = 16 AND item = 'RM-COST-UNIFIED-SPEND-1' AND status <> 'verified';

UPDATE roadmap_implementation SET status = 'retired', verified_at = datetime('now'),
  evidence = 'SUPERSEDED (C6-S1): the USD 40 a month AI burn floor was written for Phase A of docs/BUSINESS-PLAN.md when the fleet ran on free Workers AI. The owner target since 2026-11-04 is USD 200 to 300 a month all-in (ops_config cost_budget_floor_month_usd 200, cost_budget_month_usd 300, fleet_budget cost:fleet_all_in_month cap 300 target 250, current pace 1151.13), BYOK spend is visible next to unified billing in v_cost_all_in (direct_providers 45 owner-stated), and the work that closes the gap is agent_issues 1001769 (METRIC-TRIGGER-21484-NS-FLEET-COST-USD-MONTH: North Star cost run rate above target), 1001813 (ROADMAP-1 QNFO.INFRA #2174 spend governor, hourly route demotion), 1001665 (COST-MANAGER-1) and 1001675 (TOKEN-CUT-1). A USD 40 target would be a second, unreachable number beside the measured one.'
  WHERE id = 122 AND item = 'RM-COST-FLOOR-40-1' AND status <> 'retired';

UPDATE roadmap_implementation SET status = 'verified', verified_at = datetime('now'),
  evidence = 'BUILT+VERIFIED (C6-S1): prefix caching is live on every long-prompt path. ai_cache_counters 2026-11-04: qnfo-research-exec 3,072,000 of 15,581,513 input tokens cached (19.7 percent, 6,092,800 of 28.3M on 11-03), qnfo-ai-search 94.1, qnfo-ops 36.0, q08-signal-engine 14.9, personal-api 24.8, idea-hub 15.3, qnfo-agents ai_spend_ledger cached_tok 10,153,600 of 40,575,348 (25.0 percent over the day, 88 percent in the 19:20Z window after PREFIX-CACHE-AGENTS-1 / PR 7136). Code: PROMPT-CACHE-1 x-session-affinity wrapper in 7 workers (scripts/prompt-cache.test.mjs), PROMPT-CACHE-AFFINITY-1 per-paper key in qnfo-research-exec, code-orchestrator cc- key, qnfo-agents sessionAffinity. This migration adds the money side: cf_model_cached_price (Cloudflare published cached-input rates), v_prefix_cache_effect (ledger callers, usd_cache_aware and saved_by_cache_usd) and v_prefix_cache_share (binding callers), because the ledger usd column prices cached tokens at the full input rate. Open: qnfo-paper-reviser (0.2 percent cached of 2.0M input tokens on 11-03) and errata-hub (0 percent) are the next callers for the affinity header.'
  WHERE id = 14 AND source = 'routing_policy CTX PARTIAL (cache_read_tokens=0)' AND status <> 'verified';

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:c6-s1', 'Attribution is a measurement defect, not a spend defect: qnfo-agents already meters tokens in ai_spend_ledger, so its neurons can be derived from them without touching the agent worker (its src/index.ts is claimed by another session) and without changing the ledger usd column that PR 7172 baselines on.',
  'hourly D1 workflow ai-ledger-rollup writes ai_call_counters rows (qnfo-agents, ledger-rollup) from ai_spend_ledger with cache-aware pricing from cf_model_cached_price, plus five read views',
  'v_ai_meter_vs_counters 2026-11-04: deepseek-v4.1-flash-1017 meter 1132591 neurons, counters 0. Ledger qnfo-agents in 40575348, cached 10153600, out 1011911 tokens = about 945k neurons at the published rates. Coverage metric 33.9.',
  'applied by CI on merge, measured at the next hourly metric run', 'ai_call_counters gains at most 2 rows a day (one per ledger day and priced model), no worker deploy, no spend',
  'UPDATE fleet_crons SET enabled = 0 WHERE name = ''ai-ledger-rollup-hourly'' (the Rollback header of migrations/2026-11-05-c6-s1-cost-views.sql)',
  'Workers AI attribution coverage and cost per task include the agent loop, the largest single model line',
  'workers_ai_attribution_coverage_pct 33.9 -> at least 60 within 2 hours of the first tick', 'none', 'qnfo-audit views queried after apply'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE actor = 'session:c6-s1' AND action LIKE 'hourly D1 workflow ai-ledger-rollup%');
