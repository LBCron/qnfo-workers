-- BP26-ENG-FOLLOWUPS-1 (2026-11-05, charter pillars cost and autonomy; BP26 breaches gateway_coverage 14515 and deploys_via_gradual 14517; PR 7326 fixed the measures, these two issues hold the practice).
-- Each issue names its owner, the exact preconditions, the next action and a probe that closes it on its own (OWNER-NO-LOOSE-ENDS-1). Neither carries a `code-task:` line on purpose:
-- the code change is unsafe until its preconditions hold, so the code loop must not pick it up early.
--
-- 1. BP26-GATEWAY-COVERAGE-1. Measured 2026-11-05 (Cloudflare GraphQL, 7 days): 38029 of 79123 Workers AI inferences bypass the AI Gateway; by model gpt-oss-120b 17.0k, glm-5.3-flash 8.8k,
--    kimi-k2.6 5.1k, bge 1.5k, kimi-k2.7-code 1.3k. About 68 percent is qnfo-research-exec aiText (env.AI.run(model, _opts, _runOpts) with no gateway option). Gateway `default`
--    (GET /ai-gateway/gateways/default, 2026-11-05): cache_ttl 2628288 s (a repeated prompt is answered from cache for 30 days), 300 requests per 60 s, and a HARD rule
--    monthly-100-workers-ai (limit USD 100, 30-day sliding window) while the gateway already shows USD 160.48 of workers-ai cost in the last 30 days. Routing research-exec through it
--    would replay cached answers to retries, hit the rate limit on parallel bursts and, at the cap, block research and the agents: that contradicts BUDGET-SOFT-ROUTE-1 (a budget steers
--    the model, it never stops work) and moves an owner-set cap, which no session may do.
-- 2. BP26-GRADUAL-PROOF-1. deploys_via_gradual reads 0.0032 and can reach 1.0 only by staged rollouts over a 30-day window. The only production use of the staged path failed:
--    canonical-deploy run 41355839963 (2026-11-01 22:11Z, qnfo-model-eval 1.8.4): "gradual: rolled-back preview smoke test failed (HTTP 200, version 1.8.4-codeagent not seen)"; the
--    retry of #6196 (2026-11-02) is not yet exercised by a real push. Widening scripts/gradual-deploy-workers.txt before one clean push would turn each listed worker's deploy red.
--    Candidates already verified live (GET /health 200 with the repo VERSION, ES module, not control plane): qnfo-github-steward, qnfo-jobsearch, q08-signal-engine, idea-hub, qnfo-evolve,
--    radar-hub, qnfo-youtube-shorts (176 code deploys in 34 days).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM agent_issues WHERE source = 'bp26-eng' AND (title LIKE 'BP26-GATEWAY-COVERAGE-1:%' OR title LIKE 'BP26-GRADUAL-PROOF-1:%')
-- CAUSE-MAPPED: no metric is registered here; this files two issues with their closing probes.

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'BP26-GATEWAY-COVERAGE-1: route qnfo-research-exec Workers AI calls through an AI Gateway that does not stop work (68 percent of the gateway bypass)',
 'Charter pillar: cost. Program QNFO.INFRA. Metric: gateway_coverage (trigger 14515), 0.5377, target 1.0; ai_cache_hit_rate follows. Owner: the QNFO.INFRA cost lever (the gateway limits are an owner-set cap; no session raises a cap). ' ||
 'Evidence (2026-11-05): 38029 of 79123 Workers AI inferences in 7 days bypass the gateway: gpt-oss-120b 17.0k, glm-5.3-flash 8.8k, kimi-k2.6 5.1k, bge 1.5k, kimi-k2.7-code 1.3k; about 68 percent is qnfo-research-exec aiText. ' ||
 'Preconditions, all three: (1) gateway default hard rule monthly-100-workers-ai (USD 100 per 30 days; the gateway already shows USD 160.48) becomes a steering rule or moves to a gateway with no blocking rule, per BUDGET-SOFT-ROUTE-1; (2) the calls pass skipCache true (gateway cache_ttl is 30 days) with metadata worker and purpose; (3) the 300 per 60 s rate limit is raised or research_parallel is capped under it. ' ||
 'Next action once they hold: in qnfo-research-exec/worker.js aiRunOpts (anchor: async function aiRunOpts(env, model, prompt) {) add the gateway option next to the session-affinity extraHeaders, bump VERSION, and verify the prefix cache still reads (ai_spend_ledger.cached_tok for the caller). ' ||
 'Definition of done: gateway_coverage at or above 0.8 in metric_registry, no 429 or spend-limit status for qnfo-research-exec in the gateway log for 24 hours, cached_tok not lower than before. Measure fixed by PR 7326 (bypass per model is in bp26_probe_results subject bypass:*).',
 'bp26-eng', 'cost', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'BP26-GATEWAY-COVERAGE-1:%' AND status NOT IN ('closed', 'resolved'));

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'BP26-GRADUAL-PROOF-1: one clean staged push of qnfo-model-eval, then widen scripts/gradual-deploy-workers.txt',
 'Charter pillar: autonomy. Program QNFO.INFRA. Metric: deploys_via_gradual (trigger 14517), 0.0032 before PR 7326 removed the retired root stub qnfo-workers from the denominator; target 1.0. Owner: the QNFO.INFRA deploy lever. ' ||
 'Evidence: the only production use of the staged path failed (canonical-deploy run 41355839963, 2026-11-01, qnfo-model-eval 1.8.4: preview smoke test failed, version not seen); the retry added by #6196 on 2026-11-02 has not met a real push. ' ||
 'Next action: (1) on the next qnfo-model-eval push read the canonical-deploy log line starting "gradual:" and bp26_deploy_events rows with message like "gradual 100%"; (2) if the outcome is rolled-out, add these verified workers to scripts/gradual-deploy-workers.txt in one pull request, one clean staged push each before the next: qnfo-github-steward, qnfo-jobsearch, q08-signal-engine, idea-hub, qnfo-evolve, radar-hub, qnfo-youtube-shorts (GET /health 200 with the repo VERSION on 2026-11-05, ES module, not control plane); (3) if it rolled back, fix the smoke test (scripts/gradual_deploy.py) first. ' ||
 'Definition of done: a gradual 100 percent row for qnfo-model-eval in bp26_deploy_events after 2026-11-05 (this issue''s probe), then the widened list merged and at least one staged deploy recorded for each listed worker; deploys_via_gradual climbs by about the listed workers'' share of releases a day.',
 'bp26-eng', 'reliability', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'BP26-GRADUAL-PROOF-1:%' AND status NOT IN ('closed', 'resolved'));

UPDATE remediation_contracts SET verify_transport = 'd1-query', status = 'active',
  verify_probe = 'SELECT ''ok'' AS expected, CASE WHEN CAST((SELECT last_value FROM metric_registry WHERE metric = ''gateway_coverage'') AS REAL) >= 0.8 THEN ''ok'' ELSE ''pending: gateway_coverage '' || COALESCE((SELECT last_value FROM metric_registry WHERE metric = ''gateway_coverage''), ''unknown'') || '' is below 0.8'' END AS observed'
WHERE class = 'issue-' || (SELECT id FROM agent_issues WHERE title LIKE 'BP26-GATEWAY-COVERAGE-1:%' AND source = 'bp26-eng' ORDER BY id DESC LIMIT 1);

UPDATE remediation_contracts SET verify_transport = 'd1-query', status = 'active',
  verify_probe = 'SELECT ''ok'' AS expected, CASE WHEN EXISTS (SELECT 1 FROM bp26_deploy_events WHERE worker = ''qnfo-model-eval'' AND message LIKE ''gradual 100%'' AND created_on > ''2026-11-05'') THEN ''ok'' ELSE ''pending: no gradual 100 percent deployment of qnfo-model-eval since 2026-11-05'' END AS observed'
WHERE class = 'issue-' || (SELECT id FROM agent_issues WHERE title LIKE 'BP26-GRADUAL-PROOF-1:%' AND source = 'bp26-eng' ORDER BY id DESC LIMIT 1);
