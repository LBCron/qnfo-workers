-- QNFO-AGENTS-BUDGET-1 (2026-11-04, program QNFO.OPS, charter pillar cost): the loop drain of qnfo-agents has a daily neuron budget.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM ops_config WHERE key IN ('qnfo_agents_daily_neurons', 'qnfo_agents_run_neurons_est');
-- CAUSE-MAPPED: registers no metric_registry row; the budget is read by v_ai_spend_rollup (bucket qnfo-agents) and judged by fm-ai-account-over-target.
--
-- Why: the Cloudflare meter put qnfo-agents' deepseek-v4.1-flash-1017 (AI Gateway route dynamic/standard) at 1.06M, 1.42M and 1.04M neurons on 11-02, 11-03 and 11-04 (to 18:56Z),
-- 28 to 40 percent of the account and the largest line after research, with no cap of its own (v_ai_spend_rollup, bucket qnfo-agents). The owner's all-in target is USD 200-300 a
-- month (about 757k neurons a day, ops_config ai_account_daily_neurons 800000). qnfo-agents 0.7.0 takes its share of this budget in drainRequests: left / ticks-left neurons a tick,
-- one request an hour once spent, critical and no-model requests never deferred, a request the budget cannot start shed after 110 minutes (SLA-120M). 250000 neurons is about 100
-- program-manager or probe runs a day at the 2,500-neuron estimate (a run measured 2,000 to 2,400 neurons on 11-04).
-- PREDICTION: qnfo-agents falls from 1.04M to at most about 270k neurons on a complete UTC day from 2026-11-05 (budget plus the one-an-hour floor), i.e. USD 11.4 to 3.0 a day.
-- Check: SELECT * FROM v_ai_spend_rollup WHERE bucket = 'qnfo-agents' ORDER BY date DESC; revert with the Rollback line if program-manager runs fall below 3 an hour on a day
-- that is not yet spent (cf_agent_requests status failed with error like 'shed:%').

INSERT OR IGNORE INTO ops_config (key, value, note, updated_at)
VALUES ('qnfo_agents_daily_neurons', '250000', 'QNFO-AGENTS-BUDGET-1: daily neuron budget of the qnfo-agents loop drain (tokens in ai_spend_ledger caller qnfo-agents priced at 40000 in / 120000 out per M); off disables; steers, never stops (one request an hour once spent)', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));

INSERT OR IGNORE INTO ops_config (key, value, note, updated_at)
VALUES ('qnfo_agents_run_neurons_est', '2500', 'QNFO-AGENTS-BUDGET-1: planning estimate of the neurons one qnfo-agents run spends (measured 2000 to 2400 on 2026-11-04)', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));

INSERT INTO decision_log
 (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, surfaces_tested)
SELECT 'claude-code-session-2026-11-04-spend-enforce',
 'The largest uncapped Workers AI caller must hold a budget like research, the code loop and q08, or the owner target of about 757k neurons a day cannot hold',
 'QNFO-AGENTS-BUDGET-1: qnfo-agents 0.7.0 drain governor; ops_config qnfo_agents_daily_neurons 250000, qnfo_agents_run_neurons_est 2500',
 'v_ai_spend_rollup: qnfo-agents 1.06M / 1.42M / 1.04M neurons on 2026-11-02 / 03 / 04, 28 to 40 percent of the Cloudflare meter',
 'program-manager and probe runs pace to the budget; critical and no-model requests are unaffected; stale non-critical requests are shed with a reason',
 'qnfo-agents loop requests only (cf_agent_requests); the owner console turns and every other worker are untouched',
 'set ops_config qnfo_agents_daily_neurons to off (no deploy), or revert the 0.7.0 commit',
 'the agent fleet spends within a measured neuron budget',
 'qnfo-agents at most about 270k neurons on a complete UTC day from 2026-11-05; fm-ai-account-over-target is judged against the whole account',
 'node qnfo-agents/worker.test.mjs (110 checks, a simulated day of 288 ticks); bundle rebuilt, mirror identical'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'QNFO-AGENTS-BUDGET-1:%');
