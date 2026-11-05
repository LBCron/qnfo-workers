-- AGENTS-DO-FIX-2 (2026-11-05, charter pillar autonomy; agent_issues 1000805, 1000653): the D1 side of qnfo-agents 0.8.2.
-- Two live defects of 0.8.0, read from cf_agent_requests after the deploy: the approval_selftest failed on its host module name ("codemode:approval" must be a ws:* name; fixed in the
-- worker, src/approval.js), and the ten code_session replay requests were shed unrun after 110 minutes with the day's neuron budget 11 percent spent (about 27,000 of 250,000 neurons
-- at 05:42Z; fixed in the worker: code_session requests run in their own lane, on the cheap route, never shed). The worker seeds the new round itself (requesters
-- rm-code-session-1.r2 and rm-durable-interrupt-1.r2), because a migration inserting the rows would race the deploy. The closing probes of 1000805 and 1000653 can pass as
-- written (ten done sessions with tokens and cost; one staged step executed after a restart), so they are not changed.
-- This file records the one finding the fix does not change: the shared loop queue itself sheds non-critical requests while the budget is mostly unspent.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE agent_issues SET status = 'closed' WHERE title LIKE 'ROADMAP-1: QNFO.OPS #agents-shed-pacing:%';
-- spof-review: no new worker, cron, binding or table; one issue row and one decision_log row.

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.OPS #agents-shed-pacing: the loop drain sheds non-critical requests while most of the daily neuron budget is unspent',
 'Charter pillar: cost and autonomy. Serves QNFO-AGENTS-BUDGET-1 and BUDGET-SOFT-ROUTE-1 (a budget steers to the cheapest capable route and does not refuse, defer or skip a run). Measured 2026-11-05 05:42Z from cf_agent_requests (id >= 2440, since 2026-11-04 18:42Z) and ai_spend_ledger (caller qnfo-agents): 53 non-critical run requests, 27 done and 26 shed with "shed: waited over 110 minutes under the daily neuron budget" (13 high, 11 medium, 2 low), while 2026-11-05 had used about 27,300 of the 250,000-neuron budget (521,693 input and 53,387 output tokens, 11 percent, at 24 percent of the UTC day). Cause: agentDrainPlan level-loads the whole remaining day, share = left / ticks-left; early in the day that is about 900 to 1,000 neurons a tick against an estimate of 2,500 per run, so it starts one request every third tick (every 15 minutes) whatever was spent so far, and a request that waits 110 minutes is shed. Lever: start up to the per-tick cap whenever the spend is below the straight line of the day (budget x fraction of the UTC day elapsed, plus one run), and apply the duty cycle only above it; the line still bounds the day at the budget, so the owner cost cut of QNFO-AGENTS-BUDGET-1 (1.04M to 0.27M neurons a day) holds. Prediction: shed requests fall from 49 percent of non-critical runs to under 10 percent with the day staying at or under 250,000 neurons. Done: a week of cf_agent_requests with the shed share under 10 percent and ai_spend_ledger qnfo-agents neurons per day at or under the budget. The code_session requests no longer depend on this (0.8.2).' || char(10) ||
 'doer: session (qnfo-agents/src is outside the code loop merge scope; take file:qnfo-agents/src/lib.js as a work claim first)' || char(10) ||
 'code-task: repo=qnfo-workers path=qnfo-agents/src/lib.js' || char(10) ||
 'code-anchor: export function agentDrainPlan(spent, budget, nowMs, est, perTick) {',
 'session', 'cost', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.OPS #agents-shed-pacing:%' AND status = 'open');

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:C-ops-tools-F3',
  'The ten replay turns and the approval selftest of 0.8.0 ran: both did not (ten requests shed unrun, one request failed on a module name)',
  'AGENTS-DO-FIX-2: qnfo-agents 0.8.2 (ws:approval host module, code_session lane on the cheap route, never shed, own daily cap; seeding by round with a bounded selftest retry)',
  'cf_agent_requests 2473..2482 failed "shed: waited over 110 minutes" with 27,300 of 250,000 neurons spent on 2026-11-05; 2483 failed "Host module codemode:approval must use a simple ws:* name"; node_modules/@cloudflare/computer HOST_SPECIFIER = /^ws:[A-Za-z0-9][A-Za-z0-9._-]*$/ reproduced the refusal locally',
  'Fix shipped, not yet measured; no issue is closed',
  'qnfo-agents (one worker, one wrangler deploy), up to ten low-priority read-only rows and one selftest row in cf_agent_requests, at most 30 cheap code sessions a UTC day',
  'Revert the qnfo-agents PR; ops_config qnfo_agents_replay = off stops the seeding and qnfo_agents_code_session_daily = off pauses the lane at once',
  'The replay and the approval selftest can run: a CodeSession is measured per turn and a paused approval is recorded across a restart',
  'cf_agent_session_usage reaches 10 done rows within two hours of the deploy at under 30,000 neurons in all; cf_agent_approvals gets one executed staged_action row with restart_survived = 1 within one drain tick',
  'No public reach change', 'node qnfo-agents/code-session.test.mjs; node qnfo-agents/approval-modules.test.mjs; node qnfo-agents/worker.test.mjs'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'AGENTS-DO-FIX-2:%');
