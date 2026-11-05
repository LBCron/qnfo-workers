-- GATEWAY-COST-F4B (2026-11-05, charter pillar cost, program QNFO.INFRA): RM-DSH-CACHE-1 (agent_issues 1000795, GitHub 5761 and 5633), RM-DSH-REPLAY-1 (1000796, GitHub 5762) and RM-AUTOROUTER-EVAL-1 (1000652, GitHub 5705 and 5574).
-- WHAT WAS MEASURED (qnfo-audit and the repository token, 2026-11-05 03:30Z to 03:50Z):
--  * RM-DSH-CACHE-1: qnfo-agents sends dynamic/standard through the AI Gateway route with x-session-affinity = run id. ai_spend_ledger: cached share 0.25 on 2026-11-04 (40.6M input tokens, 1,824 calls, USD 12.10 ledger,
--    10.40 cache-aware) and 0.34 on 2026-11-05 (371k input tokens, 105 calls, USD 0.15 ledger). The day figure mixes the first step of a run (it cannot read a prefix its own run has not sent yet) with the later steps (they
--    resend the same prefix on the same instance and should read it), and since AGENTS-INPUT-CUT-1 the lean turns send 3.5k tokens a call instead of 22k, so the share fell while the cost per call fell about five times (USD 0.0057 to 0.0011).
--    The daily share cannot say whether cache-aware routing works. The per-step share can: this file adds cf_agent_step_usage (written by qnfo-agents 0.8.1) and v_agents_step_cache, and re-aims the probe of 1000795 at the steps after the first.
--  * RM-DSH-REPLAY-1: the recorded-transcript replay is on main and passing (qnfo-code-orchestrator/planner-transcript-replay.test.mjs asserts the planner's model request equals its logged projection, PR 6404; scripts/agent_loop_replay.mjs
--    is the reusable harness with first-divergence paths, extra and missing call detection and secret refusal, PR 7297; node scripts/agent_loop_replay.test.mjs 15 checks and the planner test both pass on 2026-11-05; scripts/run-suites.mjs discovers both).
--    The old probe of 1000796 looked for a column or a code_tasks.ctx key that no design asked for (and scans the 325 MB ctx column), so it could never pass: it becomes a code-read contract on the harness.
--  * RM-AUTOROUTER-EVAL-1: Auto Router is the built-in model cloudflare/auto, not a dynamic route, so gateway-routes listing premium, standard and value says nothing about it. cf-ops-actions gateway-auto-probe (this PR) answered on the
--    default gateway with the repository token: run 41963618835, HTTP 200, routed to anthropic/claude-haiku-5.5, cost_optimal_within_pool, 18 input and 4 output tokens (default pool: anthropic, openai, xai and Workers AI models);
--    run 41963959815 with cf-aig-allowed-providers: workers-ai, HTTP 200, routed to @cf/deepseek-ai/deepseek-v4-flash-0731. So Auto Router is available and the restriction works. The shadow replay in qnfo-ai (autoRouterShadowRun) does NOT
--    restrict the pool, so a daily caller would send logged prompts to anthropic, openai and xai models, which the owner decision of 2026-10-01 (no Anthropic upstream anywhere in the fleet) rules out.
--    This file latches ops_config autorouter_shadow_daily = off until AUTOROUTER-EVAL-1.3 (the pool restriction in qnfo-ai) is merged, and files that row with its doer.
-- PREDICTION (decision_log): qnfo-agents cached share of the steps after the first is at least 0.5 over at least 30 such steps within 48 hours of the qnfo-agents 0.8.1 deploy. Falsifier: below 0.5 with 30 or more steps, which names the
--    next lever (affinity key shared across runs for the stable prefix, or block-wise lean compaction so the prefix stays byte-identical between steps).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_gateway_cost_f4b_contracts
-- Rollback: DROP VIEW IF EXISTS v_agents_step_cache; DROP INDEX IF EXISTS idx_cf_agent_step_usage_day; DROP TABLE IF EXISTS cf_agent_step_usage; UPDATE remediation_contracts SET verify_probe = (SELECT b.verify_probe FROM bak_20261105_gateway_cost_f4b_contracts b WHERE b.class = remediation_contracts.class), verify_transport = (SELECT b.verify_transport FROM bak_20261105_gateway_cost_f4b_contracts b WHERE b.class = remediation_contracts.class) WHERE class IN ('issue-1000795', 'issue-1000796'); DELETE FROM ops_config WHERE key = 'autorouter_shadow_daily';

CREATE TABLE IF NOT EXISTS bak_20261105_gateway_cost_f4b_contracts AS
SELECT class, issue_id, verify_probe, verify_transport, last_verdict
FROM remediation_contracts WHERE class IN ('issue-1000795', 'issue-1000796');

-- 1. RM-DSH-CACHE-1: one row per model step of a qnfo-agents turn
CREATE TABLE IF NOT EXISTS cf_agent_step_usage (
  run_id TEXT NOT NULL,
  step INTEGER NOT NULL,
  day TEXT NOT NULL,
  model TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  cached_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  ts INTEGER,
  PRIMARY KEY (run_id, step)
);
CREATE INDEX IF NOT EXISTS idx_cf_agent_step_usage_day ON cf_agent_step_usage(day, step);

CREATE VIEW IF NOT EXISTS v_agents_step_cache AS
SELECT day,
       CASE WHEN step = 1 THEN 'first' ELSE 'later' END AS position,
       COUNT(*) AS steps,
       SUM(input_tokens) AS in_tok,
       SUM(cached_tokens) AS cached_tok,
       ROUND(1.0 * SUM(cached_tokens) / NULLIF(SUM(input_tokens), 0), 4) AS cached_share
FROM cf_agent_step_usage
GROUP BY day, position;

UPDATE remediation_contracts
SET verify_probe = 'SELECT ''qnfo-agents steps after the first read at least half of their input from the prefix cache over at least 30 steps'' AS expected, COALESCE((SELECT CASE WHEN steps IS NULL OR steps < 30 THEN ''only '' || COALESCE(steps, 0) || '' later steps recorded in the last 3 days'' WHEN cached_share >= 0.5 THEN ''qnfo-agents steps after the first read at least half of their input from the prefix cache over at least 30 steps'' ELSE ''later-step cached share '' || ROUND(cached_share, 4) || '' over '' || steps || '' steps'' END FROM (SELECT SUM(steps) AS steps, 1.0 * SUM(cached_tok) / NULLIF(SUM(in_tok), 0) AS cached_share FROM v_agents_step_cache WHERE position = ''later'' AND day >= date(''now'', ''-3 day''))), ''no step rows'') AS observed',
    verify_transport = 'd1-query'
WHERE class = 'issue-1000795';

UPDATE roadmap_implementation
SET status = 'partial',
    evidence = COALESCE(evidence, '') || ' | GATEWAY-COST-F4B: per-caller cached share is one SELECT (v_cache_share_by_caller, PR 7359); qnfo-agents 0.25 on 2026-11-04 and 0.34 on 2026-11-05 against 0 before PR 7136; the day share mixes first and later steps and fell while cost per call fell five times, so cf_agent_step_usage and v_agents_step_cache (qnfo-agents 0.8.1) measure the steps after the first, the grain at which cache-aware routing can be judged; closes on that share at 0.5 or more over 30 steps'
WHERE id = 1803 AND status IN ('planned', 'open');

-- 2. RM-DSH-REPLAY-1 (1000796): the defect named by the issue is code, so the code on main is the probe (roadmap row 1804 is already verified)
UPDATE remediation_contracts
SET verify_probe = '{"paths": ["scripts/agent_loop_replay.mjs"], "contains": "request differs from the log at"}',
    verify_transport = 'code-read'
WHERE class = 'issue-1000796';

-- 3. RM-AUTOROUTER-EVAL-1: the evidence, the latch and the missing precondition
UPDATE roadmap_implementation
SET status = 'partial',
    evidence = COALESCE(evidence, '') || ' | GATEWAY-COST-F4B: cf-ops-actions gateway-auto-probe (workflow runs 41963618835 and 41963959815, 2026-11-05) shows Auto Router (cloudflare/auto) answering HTTP 200 on gateway default, routed to anthropic/claude-haiku-5.5 with the default pool and to @cf/deepseek-ai/deepseek-v4-flash-0731 with cf-aig-allowed-providers: workers-ai (cost_optimal_within_pool); gateway-routes lists premium, standard and value only because Auto Router is a built-in model, not a route; the daily shadow caller (AUTOROUTER-EVAL-1.2) waits on the pool restriction (AUTOROUTER-EVAL-1.3)'
WHERE id = 1695 AND status IN ('planned', 'open');

INSERT OR IGNORE INTO ops_config (key, value, note, updated_at)
VALUES ('autorouter_shadow_daily', 'off', 'GATEWAY-COST-F4B 2026-11-05: the Auto Router shadow replay must not run daily until qnfo-ai restricts the pool to Workers AI (AUTOROUTER-EVAL-1.3); the default pool holds anthropic, openai and xai models and the fleet has no such upstream. AUTOROUTER-EVAL-1.3 flips this to on in the same change.', datetime('now'));

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.INFRA AUTOROUTER-EVAL-1.3: the Auto Router shadow replay restricts its pool to Workers AI',
 'code-task: repo=qnfo-workers path=qnfo-ai/worker.js' || char(10) ||
 'code-anchor: async function autoRouterShadowRun(env, limit) {' || char(10) ||
 'code-probe: {"paths": ["qnfo-ai/worker.js"], "contains": "AUTOROUTER-EVAL-1.3"}' || char(10) || char(10) ||
 'Charter pillar security and cost (program QNFO.INFRA). Metric it should move: autorouter-shadow events with status ok (RM-AUTOROUTER-EVAL-1, agent_issues 1000652), without a prompt leaving Cloudflare Workers AI.' || char(10) ||
 'Evidence: cloudflare/auto answers on gateway default (cf-ops-actions gateway-auto-probe, runs 41963618835 and 41963959815). Its default pool is anthropic/claude-haiku-5.5, anthropic/claude-opus-5.5, anthropic/claude-sonnet-5.5, openai/gpt-6-luna, openai/gpt-6.1-sol, xai/grok-4.7, moonshotai/kimi-k3 and @cf/deepseek-ai/deepseek-v4-flash-0731; with the header cf-aig-allowed-providers: workers-ai it answered from @cf/deepseek-ai/deepseek-v4-flash-0731. autoRouterShadowRun in qnfo-ai sends no such header, so it would replay logged prompts to anthropic, openai and xai models, which the owner decision of 2026-10-01 (no Anthropic upstream anywhere in the fleet) excludes.' || char(10) ||
 'EDIT: in autoRouterShadowRun pass { gateway: {...as now}, extraHeaders: { "cf-aig-allowed-providers": "workers-ai" } } to the aiRunAttr call; when the answer''s selected model does not start with @cf/ record the event with status skipped_pool and no response hashes; mark with AUTOROUTER-EVAL-1.3. Add a case to qnfo-ai/autorouter-shadow.test.mjs that the options carry the header and that a non-@cf selected model is skipped. A migration in the same pull request sets ops_config autorouter_shadow_daily to on (key latched off by migrations/2026-11-05-gateway-cost-f4b.sql). qnfo-ai/worker.js was claimed by W2-H-3257 at 2026-11-05T03:50Z: take a work claim first.' || char(10) ||
 'Definition of done: merged and verified live, a replay run records autorouter-shadow events whose selected_model starts with @cf/, and AUTOROUTER-EVAL-1.2 (the daily caller in qnfo-cloud-ops) can then run.',
 'session:C-ops-tools-F4', 'feature', 'high', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.INFRA AUTOROUTER-EVAL-1.3%');

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session C-ops-tools-F4 (issues 1000795, 1000796, 1000652)',
       'the cached share of the steps after the first, not the day share, is what shows whether cache-aware routing works; Auto Router is a built-in model whose default pool must be restricted before the fleet sends prompts to it',
       'GATEWAY-COST-F4B: qnfo-agents 0.8.1 writes cf_agent_step_usage; probe of 1000795 re-aimed at later steps; probe of 1000796 a code-read contract on the replay harness; gateway-auto-probe action; ops_config autorouter_shadow_daily latched off; AUTOROUTER-EVAL-1.3 filed',
       'ai_spend_ledger qnfo-agents: 0.25 on 2026-11-04 (40.6M input tokens) and 0.34 on 2026-11-05 (371k); gateway-auto-probe runs 41963618835 (default pool, anthropic/claude-haiku-5.5) and 41963959815 (workers-ai pool, @cf/deepseek-ai/deepseek-v4-flash-0731); node scripts/agent_loop_replay.test.mjs 15 checks pass',
       'per-step cache telemetry exists; the replay issue has a probe that can pass; the Auto Router question has a live answer and a guard against sending prompts to third-party providers',
       'one new D1 table and view, one qnfo-agents telemetry write per turn (best effort), two remediation_contracts rows, one ops_config key; no routing change',
       'migration Rollback restores both probes and drops the table, view and key; qnfo-agents 0.8.0 stops the writes',
       'cache-aware routing becomes judgeable at step grain; the shadow replay cannot leak prompts to anthropic, openai or xai',
       'qnfo-agents cached share of steps after the first >= 0.5 over >= 30 steps within 48 hours of the 0.8.1 deploy',
       'no external reach change',
       'node qnfo-agents/step-cache.test.mjs; python scripts/cf_ops_gateway_routes_test.py (25 checks); node scripts/agent_loop_replay.test.mjs; two live cf-ops-actions runs'
WHERE NOT EXISTS (
  SELECT 1 FROM decision_log
  WHERE action LIKE 'GATEWAY-COST-F4B:%'
);
