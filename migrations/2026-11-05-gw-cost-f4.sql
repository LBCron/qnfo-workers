-- GATEWAY-ROUTE-ALL-1 (2026-11-05, charter pillar cost, program QNFO.INFRA): BP26-AI-GATEWAY-BUDGETS-1 (agent_issues 1000614, GitHub 5285) and RM-DSH-CACHE-1 (1000795, GitHub 5761 and 5633).
-- WHAT WAS MEASURED (Cloudflare GraphQL over 7 days to 2026-11-04T23:30Z, read-only through the account connector; qnfo-audit.ai_spend_ledger and ai_call_counters):
--  * gateway_coverage 0.5377: 44,244 AI Gateway requests, 79,144 Workers AI inferences, 38,042 of them with no gateway option. By model the direct share was gpt-oss-120b 16,995, glm-5.3-flash 8,848,
--    kimi-k2.6 5,102, bge-base 1,508, kimi-k2.7-code 1,281, glm-5.3 869. Cloudflare keeps no worker dimension on inferences (requestSource unknown, tag empty), so callers were found from ai_call_counters
--    and the code: qnfo-research-exec aiText 6,906 calls a week, the qnfo-ai binding about 5,000, qnfo-code-orchestrator 1,939, q08-signal-engine 1,920, idea-hub 1,283, errata-hub 1,146, and the model health pings
--    of qnfo-ai-calibration (two a hour for each model of the roster: llama-3.3-70b and clef-flash show 374 and 329 inferences, all direct).
--  * BP26-AI-GATEWAY-BUDGETS-1 asked for one call site: q08-signal-engine compose. It is live: gateway qnfo-infra carries q08-signal-engine/compose 524, factcheck 755, panel 534, title-repair 21 and forecast 20
--    requests in the 7 days (metadataRaw dimension). The metric clause of that issue (gateway_coverage 1.0) belongs to 1000351 and METRIC-TRIGGER 1000529 (both stay open): one call site cannot reach it.
--  * ai_gateway_usage rows for deepseek-v4-*-wa are written by the trigger trg_ai_gateway_usage_from_ai_queries with cached = 0 for every row, so the old DSH-CACHE probe (cached > 0 there) could never pass.
--    The true cache figure is ai_spend_ledger.cached_tok: qnfo-agents dynamic/standard (DeepSeek v4.1 flash through the gateway) read 25 percent on 2026-11-04 (the day PREFIX-CACHE-AGENTS-1, PR 7136, landed) and 88 percent in the 11 minutes after it.
-- WHAT THIS CHANGES: qnfo-ai 5.47.0 (binding wrapper) sends embeddings and text calls under 1 KB through AI Gateway (skipCache for text, 24 h cache for embeddings, metadata worker and purpose, plain-binding retry on a gateway
-- failure, ops_config router_gateway_route = off as the kill switch); long prompts keep their prefix-cache key and the direct path. This file adds the view v_cache_share_by_caller (the per-caller cached input share the issue asks for),
-- replaces two probes that could not measure their defect, and files the remaining bypass sites with a doer each.
-- PREDICTION (decision_log): gateway_coverage rises from 0.5377 by 0.02 to 0.04 within 7 days of the deploy (router binding about 2,500 short calls a week of 79,144 inferences); gateway statusCode 429 stays 0 (baseline 0 in 36 h);
-- ai_cache_hit_rate and qnfo-agents cached share do not fall. Falsifier: any gateway 429 or spend refusal on workers-ai, or cached share of qnfo-agents below 0.5 on a day with 100,000 input tokens: set ops_config router_gateway_route = off.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_gw_cost_f4_contracts
-- Rollback: DROP VIEW IF EXISTS v_cache_share_by_caller; UPDATE remediation_contracts SET verify_probe = (SELECT b.verify_probe FROM bak_20261105_gw_cost_f4_contracts b WHERE b.class = remediation_contracts.class), verify_transport = (SELECT b.verify_transport FROM bak_20261105_gw_cost_f4_contracts b WHERE b.class = remediation_contracts.class) WHERE class IN ('issue-1000614', 'issue-1000795');

CREATE TABLE IF NOT EXISTS bak_20261105_gw_cost_f4_contracts AS
SELECT class, issue_id, verify_probe, verify_transport, last_verdict
FROM remediation_contracts WHERE class IN ('issue-1000614', 'issue-1000795');

-- 1. cached input share per caller and day (ai_spend_ledger is one row per day, provider, caller and model: about 1,100 rows in 35 days)
CREATE VIEW IF NOT EXISTS v_cache_share_by_caller AS
SELECT day, caller,
       SUM(calls) AS calls,
       SUM(in_tok) AS in_tok,
       SUM(COALESCE(cached_tok, 0)) AS cached_tok,
       ROUND(1.0 * SUM(COALESCE(cached_tok, 0)) / NULLIF(SUM(in_tok), 0), 4) AS cached_share
FROM ai_spend_ledger
WHERE day >= date('now', '-35 day')
GROUP BY day, caller;

-- 2. RM-DSH-CACHE-1 (1000795): the measure the issue names, cached versus uncached input tokens per caller, on the caller that sends the DeepSeek traffic through the gateway route
UPDATE remediation_contracts
SET verify_probe = 'SELECT ''qnfo-agents cached input share at least 0.5 on its latest day with 100000 input tokens'' AS expected, COALESCE((SELECT CASE WHEN cached_share >= 0.5 THEN ''qnfo-agents cached input share at least 0.5 on its latest day with 100000 input tokens'' ELSE ''cached share '' || COALESCE(cached_share, 0) || '' on '' || day || '' with '' || in_tok || '' input tokens'' END FROM v_cache_share_by_caller WHERE caller = ''qnfo-agents'' AND in_tok >= 100000 ORDER BY day DESC LIMIT 1), ''no qnfo-agents day with 100000 input tokens'') AS observed',
    verify_transport = 'd1-query'
WHERE class = 'issue-1000795';

-- 3. BP26-AI-GATEWAY-BUDGETS-1 (1000614): the defect this implement issue names is the compose call site; the code on main is the evidence (the metric clause stays with 1000351 and 1000529)
UPDATE remediation_contracts
SET verify_probe = '{"paths": ["q08-signal-engine/worker.js"], "absent": "var resp = await env.AI.run(modelId, Object.assign({"}',
    verify_transport = 'code-read'
WHERE class = 'issue-1000614';

-- 4. the remaining bypass sites, one doer each (OWNER-NO-LOOSE-ENDS-1)
INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.INFRA BP26-GW-CALIBRATION-1: model health pings of qnfo-ai-calibration go through AI Gateway',
 'code-task: repo=qnfo-workers path=qnfo-ai-calibration/worker.js' || char(10) ||
 'code-anchor: async function probeBudgetDirect(env, cfId) {' || char(10) ||
 'code-probe: {"paths": ["qnfo-ai-calibration/worker.js"], "contains": "BP26-GW-CALIBRATION-1"}' || char(10) || char(10) ||
 'Charter pillar cost (program QNFO.INFRA). Metric it should move: gateway_coverage (0.5377 on 2026-11-04), by about 0.05.' || char(10) ||
 'Evidence: probeOne and probeBudgetDirect call env.AI.run(model, body) with no gateway option, two probes an hour for each roster model (llama-3.3-70b 374 and clef-flash 329 inferences in 7 days, all direct).' || char(10) ||
 'EDIT: pass { gateway: { id: "default", skipCache: true, metadata: { worker: "qnfo-ai-calibration", purpose: "health-ping" } } } as the third argument of both calls (skipCache so a health probe is never answered from the cache), retry once on the plain binding when the error text names the gateway, never when it names spend or a limit. Mark with BP26-GW-CALIBRATION-1. File qnfo-ai-calibration/worker.js was held by session D2c-gateway-loops at 2026-11-04T23:44Z: take a work claim first.' || char(10) ||
 'Definition of done: merged and verified live, metadataRaw worker qnfo-ai-calibration appears on the gateway, probe verdicts unchanged for 24 hours.',
 'session:C-ops-tools-F4', 'feature', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.INFRA BP26-GW-CALIBRATION-1%');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.INFRA BP26-GW-RESEARCH-EXEC-1: qnfo-research-exec aiText through AI Gateway without losing its prefix cache',
 'code-task: repo=qnfo-workers path=qnfo-research-exec/worker.js' || char(10) ||
 'code-anchor: async function aiRunOpts(env, model, prompt) {' || char(10) ||
 'code-probe: {"paths": ["qnfo-research-exec/worker.js"], "contains": "BP26-GW-RESEARCH-EXEC-1"}' || char(10) || char(10) ||
 'Charter pillar cost (program QNFO.INFRA). Metric it should move: gateway_coverage, by about 0.08 (aiText is the largest direct caller: 6,906 binding calls in 7 days in ai_call_counters).' || char(10) ||
 'Evidence: aiText calls env.AI.run(model, _opts, _runOpts) and aiRunOpts returns only an x-session-affinity header, so every research text call is invisible to the gateway. qnfo-ai 5.47.0 (GATEWAY-ROUTE-ALL-1) keeps long prompts direct because it is not yet known whether the gateway forwards the affinity header on a Workers AI model.' || char(10) ||
 'EDIT: measure first. For one hour send 5 percent of aiText calls with { gateway: { id: "default", skipCache: true, metadata: { worker: "qnfo-research-exec", purpose: "aiText" } }, extraHeaders } and compare cached_tok / in_tok in ai_cache_counters for those calls with the rest (v_cache_share_by_caller is the per-caller view). Move all calls only when the cached share is within 10 percent of the direct path; otherwise keep the header path and record the number. Mark with BP26-GW-RESEARCH-EXEC-1. qnfo-research-exec/worker.js was claimed by C2-SCOUT at 2026-11-04T23:44Z: take a work claim first.' || char(10) ||
 'Definition of done: merged and verified live, the measured cached-share comparison in issue_triage.close_evidence, gateway_coverage re-read.',
 'session:C-ops-tools-F4', 'feature', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.INFRA BP26-GW-RESEARCH-EXEC-1%');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.INFRA BP26-GW-CODE-ORCH-1: qnfo-code-orchestrator ai() through AI Gateway',
 'code-task: repo=qnfo-workers path=qnfo-code-orchestrator/worker.js' || char(10) ||
 'code-anchor: async function ai(env, model, messages) {' || char(10) ||
 'code-probe: {"paths": ["qnfo-code-orchestrator/worker.js"], "contains": "BP26-GW-CODE-ORCH-1"}' || char(10) || char(10) ||
 'Charter pillar cost (program QNFO.INFRA). Metric it should move: gateway_coverage by about 0.02 (1,939 calls a week in ai_call_counters), and the cached share of qnfo-code-orchestrator in v_cache_share_by_caller (0 on 2026-11-04 for 1.5M input tokens).' || char(10) ||
 'Evidence: ai() calls env.AI.run(model, req0, ro) with ro = cacheRunOpts(model, messages), an x-session-affinity header only. The ledger shows 0 cached tokens for gpt-oss-120b, kimi-k2.7-code and glm-5.3 on 1.5M input tokens on 2026-11-04, so first check whether those models report cached tokens at all.' || char(10) ||
 'EDIT: add the gateway option with metadata worker qnfo-code-orchestrator and purpose code-loop to the third argument next to extraHeaders, behind the measurement described in BP26-GW-RESEARCH-EXEC-1; keep the EMPTY_RETRY path. Mark with BP26-GW-CODE-ORCH-1. qnfo-code-orchestrator/worker.js was claimed by F1-research-reach/D at 2026-11-04T23:44Z: take a work claim first.' || char(10) ||
 'Definition of done: merged and verified live, gateway metadata worker qnfo-code-orchestrator present, code_task_success_rate_30d not lower.',
 'session:C-ops-tools-F4', 'feature', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.INFRA BP26-GW-CODE-ORCH-1%');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.INFRA BP26-GW-MODEL-EVAL-1: qnfo-model-eval batteries and canaries through AI Gateway, with call counters',
 'code-task: repo=qnfo-workers path=qnfo-model-eval/worker.js' || char(10) ||
 'code-anchor: async function runOpsScaleCanary(env, model) {' || char(10) ||
 'code-probe: {"paths": ["qnfo-model-eval/worker.js"], "contains": "BP26-GW-MODEL-EVAL-1"}' || char(10) || char(10) ||
 'Charter pillar cost (program QNFO.INFRA). Metric it should move: gateway_coverage and the unattributed share of Workers AI calls (ai_call_counters holds no row for qnfo-model-eval).' || char(10) ||
 'Evidence: qnfo-model-eval has six env.AI.run sites (battery items, the ops-scale canary, the benchmark) with no gateway option and no attribution wrapper, so a battery run over the whole roster adds direct calls that no table counts.' || char(10) ||
 'EDIT: route the six sites through one helper that adds { gateway: { id: "default", skipCache: true, metadata: { worker: "qnfo-model-eval", purpose: "battery" } } } and writes the ai_call_counters row (the __aiAttrEnv scheme of qnfo-ai). Mark with BP26-GW-MODEL-EVAL-1.' || char(10) ||
 'Definition of done: merged and verified live, an ai_call_counters row for worker qnfo-model-eval after the next battery run.',
 'session:C-ops-tools-F4', 'feature', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.INFRA BP26-GW-MODEL-EVAL-1%');

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session C-ops-tools-F4 (issues 1000614, 1000795)',
       'routing embeddings and text calls under 1 KB of the qnfo-ai binding through AI Gateway loses no prefix cache (PROMPT-CACHE-1 adds no key under 1 KB) and adds no cost (skipCache for text)',
       'GATEWAY-ROUTE-ALL-1: qnfo-ai 5.47.0 sends those calls through gateway default with metadata; v_cache_share_by_caller; probes of 1000614 and 1000795 replaced; four ROADMAP-1 rows for the other bypass sites',
       'CF GraphQL 7 days: gateway_coverage 0.5377 (44,244 gateway requests, 38,042 inferences without the gateway option); q08-signal-engine/compose 524 requests on gateway qnfo-infra; 0 gateway 429 in 36 hours; ai_spend_ledger 2026-11-04 qnfo-agents cached share 0.25',
       'qnfo-ai binding calls under 1 KB and embeddings are logged by AI Gateway; per-caller cached share is one SELECT',
       'qnfo-ai binding calls (embeddings, short text) and two remediation_contracts rows; no other worker changes',
       'set ops_config router_gateway_route = off (effective within 5 minutes), or revert qnfo-ai to 5.46.2; the migration Rollback restores the two probes from bak_20261105_gw_cost_f4_contracts',
       'the router itself gives the gateway its short calls; the other bypass sites are named with a doer each',
       'gateway_coverage 0.5377 -> at least 0.56 within 7 days of the deploy; gateway 429 count stays 0; qnfo-agents cached share >= 0.5 on its next day above 100,000 input tokens',
       'no external reach change',
       'node qnfo-ai/gateway-route.test.mjs (25 checks), aig-binding, prompt-cache and ai-attr-cover suites; live CF GraphQL baseline'
WHERE NOT EXISTS (
  SELECT 1 FROM decision_log
  WHERE action LIKE 'GATEWAY-ROUTE-ALL-1:%'
);
