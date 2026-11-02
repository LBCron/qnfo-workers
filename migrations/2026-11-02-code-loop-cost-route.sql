-- CODE-LOOP-SOFT-BUDGET-COST-ROUTE-1 (issue 2619, charter pillar cost): the
-- live 7-day Workers AI run rate is $575.19/30d, and qnfo-code-orchestrator
-- used 3.83M neurons in that window. Most were Kimi/GLM calls before the
-- existing soft-budget route to the cheapest configured coder activates.
-- Move that reversible routing threshold from 140 to 10 calls/day. The loop
-- continues, and its retry fallback, verifier and publication gates are unchanged.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261102_code_loop_cost_route
-- Rollback: UPDATE ops_config SET value = (SELECT value FROM bak_20261102_code_loop_cost_route WHERE row_type = 'ops_config'), note = (SELECT note FROM bak_20261102_code_loop_cost_route WHERE row_type = 'ops_config'), updated_at = (SELECT updated_at FROM bak_20261102_code_loop_cost_route WHERE row_type = 'ops_config') WHERE key = 'code_loop_daily_calls' AND EXISTS (SELECT 1 FROM bak_20261102_code_loop_cost_route WHERE row_type = 'ops_config'); UPDATE control_registry SET evidence = (SELECT evidence FROM bak_20261102_code_loop_cost_route WHERE row_type = 'control_registry'), reviewed_at = (SELECT reviewed_at FROM bak_20261102_code_loop_cost_route WHERE row_type = 'control_registry') WHERE control = 'code-loop-daily-calls' AND EXISTS (SELECT 1 FROM bak_20261102_code_loop_cost_route WHERE row_type = 'control_registry'); DELETE FROM ops_config WHERE key = 'code_loop_daily_calls' AND note LIKE 'CODE-LOOP-SOFT-BUDGET-COST-ROUTE-1%' AND NOT EXISTS (SELECT 1 FROM bak_20261102_code_loop_cost_route WHERE row_type = 'ops_config')

CREATE TABLE IF NOT EXISTS bak_20261102_code_loop_cost_route AS
SELECT 'ops_config' AS row_type, key AS row_key, value, note, updated_at, NULL AS evidence, NULL AS reviewed_at
FROM ops_config WHERE key = 'code_loop_daily_calls'
UNION ALL
SELECT 'control_registry', control, NULL, NULL, NULL, evidence, reviewed_at
FROM control_registry WHERE control = 'code-loop-daily-calls';

INSERT OR IGNORE INTO ops_config (key, value, note)
VALUES (
  'code_loop_daily_calls',
  '10',
  'CODE-LOOP-SOFT-BUDGET-COST-ROUTE-1 (issue 2619): use the measured cheapest-first coder after 10 daily model calls; the loop, bounded fallback, verifier and publication gates continue.'
);

UPDATE ops_config
SET value = '10',
    note = 'CODE-LOOP-SOFT-BUDGET-COST-ROUTE-1 (issue 2619): use the measured cheapest-first coder after 10 daily model calls; the loop, bounded fallback, verifier and publication gates continue.',
    updated_at = datetime('now')
WHERE key = 'code_loop_daily_calls'
  AND (value IS NULL OR trim(value) = '' OR CAST(value AS REAL) > 10 OR CAST(value AS REAL) <= 0);

UPDATE control_registry
SET evidence = COALESCE(evidence, '') || char(10) ||
      'CODE-LOOP-SOFT-BUDGET-COST-ROUTE-1 (2026-11-02): the live fleet run rate was 580.19/30d, including 575.19 Workers AI; the code loop used 3,833,547 neurons in 7 days (Kimi 2,551,641; GLM 937,622; GPT-OSS 171,970; GLM-flash 172,314). The existing spend gate already routes to the cheapest configured coder and preserves its bounded retry and verification path; threshold 140 -> 10 so that route starts earlier. Revert from bak_20261102_code_loop_cost_route. Re-measure code-loop neurons, fleet_cost_run_rate_usd and code_task_success_rate_30d after 7 full days.',
    reviewed_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE control = 'code-loop-daily-calls'
  AND instr(COALESCE(evidence, ''), 'CODE-LOOP-SOFT-BUDGET-COST-ROUTE-1') = 0;

INSERT INTO decision_log (
  actor, assumption, action, evidence, outcome, blast_radius, rollback_path,
  capability_gain, predicted_outcome, reach_gain, surfaces_tested
)
SELECT
  'copilot-issue-2619',
  'The Workers AI run-rate breach is fleet-controlled; activating the existing cheapest-first soft route earlier lowers model cost without stopping work or weakening verification.',
  'CODE-LOOP-SOFT-BUDGET-COST-ROUTE-1: lowered code_loop_daily_calls from 140 to 10; preserved the bounded fallback, verifier and publication gates.',
  'qnfo-audit 2026-11-02: fleet_cost_run_rate_usd 580.19/30d, Workers AI 575.19/30d; qnfo-code-orchestrator used 3,833,547 neurons in 7 days, including 2,551,641 on Kimi and 937,622 on GLM. The live control value was 140.',
  'Applied by migration; live cost and quality outcome pending.',
  'qnfo-code-orchestrator model choice and resulting Workers AI spend; verification and publication remain unchanged.',
  'Restore ops_config and control_registry from bak_20261102_code_loop_cost_route; the prior threshold resumes without a worker deploy.',
  'Earlier measured cost-sensitive routing while preserving the verified code-task path.',
  'Within 7 full days, code-loop neurons fall by at least 50% from the 3,833,547 baseline and fleet_cost_run_rate_usd falls by at least $100/30d; code_task_success_rate_30d does not decline.',
  'No reach or output reduction is intended; lower compute cost per verified code task.',
  'Live D1 v_cost_run_rate, ai_call_counters and ops_config; existing qnfo-code-orchestrator spend-cap tests; migration replay test.'
WHERE NOT EXISTS (
  SELECT 1 FROM decision_log
  WHERE action LIKE 'CODE-LOOP-SOFT-BUDGET-COST-ROUTE-1:%'
);
