-- SPEND-ENFORCE-DETECTORS-1 (2026-11-04, program QNFO.OPS, charter pillar cost). The closing probes for SPEND-ENFORCE-1: three failure modes, each with a live fm contract.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM remediation_contracts WHERE class IN ('fm-spend-cap-overshoot', 'fm-ai-spend-unattributed', 'fm-ai-account-over-target'); DELETE FROM failure_modes WHERE fm_key IN ('spend-cap-overshoot', 'ai-spend-unattributed', 'ai-account-over-target'); DELETE FROM capability_ledger WHERE capability = 'ai-meter-by-model'; DELETE FROM ops_config WHERE key = 'spend_enforce_first_day';
-- CAUSE-MAPPED: registers no metric_registry row; the detectors are failure modes with fm contracts (the closing probes OWNER-NO-LOOSE-ENDS-1 asks for), read from v_spend_enforcement and v_ai_meter_daily.
--
-- Why: SPEND-ENFORCE-1 (PRs 6982, 6989, 7000, 7027, 7032, 7036 and research-exec 0.49.0) bound the budgeted callers and made the Cloudflare meter readable.
-- Each change carries a prediction; a prediction nobody re-reads is a loose end. These contracts re-read it every hour, name an owner when it fails, and
-- keep failing loudly while the account is over its target, which is the owner's actual goal (USD 200-300 a month all-in; ops_config ai_account_daily_neurons).
--   spend-cap-overshoot       a budgeted caller (research / code-loop / q08) spent over 115 percent of its daily budget on a complete UTC day from 2026-11-05 on
--                             (11-05 is the first full day with every cap deployed); expected 0 such rows.
--   ai-spend-unattributed     over 40 percent of a complete day's Cloudflare neurons are in no worker's ai_call_counters (11-01..03: 54-63 percent); expected 0 days.
--                             A day over the line means a caller is outside every cap: read v_ai_meter_vs_counters ORDER BY unattributed_neurons DESC.
--   ai-account-over-target    the Cloudflare account spent more than ops_config ai_account_daily_neurons (800000) on a complete day since 2026-11-05; expected 0 days.
-- All three fail today by design: they are the open work, not a regression. They pass when the claim "the caps hold" is true on the meter.

INSERT OR IGNORE INTO ops_config (key, value, note, updated_at)
VALUES ('spend_enforce_first_day', '2026-11-05', 'SPEND-ENFORCE-DETECTORS-1: the first complete UTC day the fm-spend-cap-overshoot, fm-ai-spend-unattributed and fm-ai-account-over-target probes judge (the day after every cap shipped); days before it are history, not regressions.', datetime('now'));

INSERT OR IGNORE INTO failure_modes
 (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, trigger_condition, symptom, blast_radius)
VALUES
 ('spend-cap-overshoot', 'A daily AI budget is exceeded by more than 15 percent on a complete UTC day',
  'Caps were routing flags: the research lean route changed width and ensemble size but a cron tick still ran up to 8 rounds (997k neurons against 360k on 2026-11-03); the code loop call threshold selected cheapest-first order and nothing bounded neurons; q08 pressure steered only the first writer model',
  'Per-tick neuron allowance with a one-stage floor (qnfo-research-exec 0.49.0), daily neuron budget that ends the dear rungs and paces only model-calling steps (qnfo-code-orchestrator 0.39.0, 0.40.2), pace line with a floor of one attempt per 3 hours (q08-signal-engine 0.43.0); BUDGET-SOFT-ROUTE-1: slower, never stopped',
  'fm-spend-cap-overshoot', 'fm-spend-cap-overshoot', '2026-11-04',
  'A budgeted worker spends more than 115 percent of research_daily_neurons, code_loop_daily_neurons or q08_daily_neurons on a complete UTC day',
  'v_spend_enforcement pct_of_budget above 115 for research, code-loop or q08',
  'Workers AI spend (USD 35-40 a day on 11-01..03 against a USD 300 a month target)'),
 ('ai-spend-unattributed', 'Over 40 percent of the Cloudflare Workers AI neurons of a complete day are in no worker counter',
  'ai_call_counters holds what each worker records through its own wrapper: 37-46 percent of the bill on 11-01..03. qnfo-agents (issue-probe-agent, deepseek-v4.1-flash-1017, 1.2M neurons a day) wrote no rows; an hourly kimi-k2.6 caller in the :05-:14 slots (about 360k neurons a day) is not identified; failed calls were booked as spend in the counters that do write',
  'Read v_ai_meter_vs_counters (ai_meter_model_daily, scripts/cost_ledger.py hourly) for the models whose meter exceeds their counters; bound or instrument each caller; failed calls book zero neurons (research-exec 0.49.0)',
  'fm-ai-spend-unattributed', 'fm-ai-spend-unattributed', '2026-11-04',
  'A worker calls Workers AI without writing ai_call_counters rows, or through a binding the wrapper does not cover',
  'v_ai_meter_daily unattributed_neurons above 40 percent of neurons',
  'Every per-worker cap: they bound at most the attributed share'),
 ('ai-account-over-target', 'The Cloudflare account spends more Workers AI neurons a day than the owner target allows',
  'The owner target is USD 200-300 a month all-in; the account billed USD 35-40 a day. Caps bound callers one by one and the sum of the bounds plus the unattributed remainder exceeds the target',
  'Bound each unattributed caller the same way (allowance, pace line or floor), then tighten the budgets with the meter as the judge: ops_config research_daily_neurons, code_loop_daily_neurons, q08_daily_neurons, issue_probe_birth_per_hour, ai_account_daily_neurons',
  'fm-ai-account-over-target', 'fm-ai-account-over-target', '2026-11-04',
  'The sum of the attributed budgets and the unattributed remainder exceeds ai_account_daily_neurons',
  'v_ai_meter_daily pct_of_target above 100',
  'Fleet cost against the owner USD 300 a month all-in target');

INSERT OR IGNORE INTO remediation_contracts
 (class, issue_id, verify_probe, verify_transport, max_attempts, expected_cadence_h, status, precondition, action, escalate_to, module, next_due_at)
VALUES
 ('fm-spend-cap-overshoot', NULL,
  'SELECT ''0'' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM v_spend_enforcement WHERE day >= COALESCE((SELECT value FROM ops_config WHERE key = ''spend_enforce_first_day''), ''2026-11-05'') AND day < date(''now'') AND day >= date(''now'', ''-7 days'') AND pct_of_budget > 115',
  'd1-query', 1000, 1, 'active',
  'A complete UTC day since 2026-11-05 has its budgeted callers (research, code-loop, q08) at or under 115 percent of their daily budget on the Cloudflare-side counters',
  'Find the caller over its budget in v_spend_enforcement, read its tick or attempt events, and bound the path that spent without the allowance, floor or pace line; never lower a review, verify or claim gate',
  'program-manager:QNFO.OPS', 'failure-mode', datetime('now')),
 ('fm-ai-spend-unattributed', NULL,
  'SELECT ''0'' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM v_ai_meter_daily WHERE date >= COALESCE((SELECT value FROM ops_config WHERE key = ''spend_enforce_first_day''), ''2026-11-05'') AND date < date(''now'') AND date >= date(''now'', ''-7 days'') AND unattributed_neurons > 0.4 * neurons',
  'd1-query', 1000, 1, 'active',
  'The per-worker counters explain at least 60 percent of the Cloudflare meter on every complete day since 2026-11-05',
  'Read v_ai_meter_vs_counters ordered by unattributed_neurons; for the first model, find the calling worker (cron slots, AI Gateway logs, requestSource) and bound or instrument it',
  'program-manager:QNFO.OPS', 'failure-mode', datetime('now')),
 ('fm-ai-account-over-target', NULL,
  'SELECT ''0'' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM v_ai_meter_daily WHERE date >= COALESCE((SELECT value FROM ops_config WHERE key = ''spend_enforce_first_day''), ''2026-11-05'') AND date < date(''now'') AND date >= date(''now'', ''-7 days'') AND pct_of_target > 100',
  'd1-query', 1000, 1, 'active',
  'The Cloudflare account spends at most ai_account_daily_neurons Workers AI neurons on every complete day since 2026-11-05',
  'Take the largest remaining line of v_ai_meter_vs_counters, bound it, and repeat until the account is under target; the owner direct spend outside the fleet is not part of this probe',
  'program-manager:QNFO.OPS', 'failure-mode', datetime('now'));

INSERT OR IGNORE INTO capability_ledger
 (capability, provenance, prerequisites, reliability, acquired_at, evidence)
VALUES
 ('ai-meter-by-model', 'AI-METER-MODEL-1 (PR 7032)', 'scripts/cost_ledger.py hourly, Cloudflare GraphQL aiInferenceAdaptiveGroups',
  0.6, datetime('now'), 'ai_meter_model_daily, v_ai_meter_vs_counters, v_ai_meter_daily; the fm-ai-* contracts of SPEND-ENFORCE-DETECTORS-1 read them every hour');

INSERT INTO decision_log
 (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, surfaces_tested)
SELECT 'claude-code-session-2026-11-04-spend-enforce',
 'A prediction no probe re-reads is a loose end, and a cap judged on the partial counters cannot show the account is over target',
 'SPEND-ENFORCE-DETECTORS-1: three fm contracts (spend-cap-overshoot, ai-spend-unattributed, ai-account-over-target) read v_spend_enforcement and v_ai_meter_daily hourly from the first complete day (2026-11-05)',
 'Cloudflare GraphQL aiInferenceAdaptiveGroups vs ai_call_counters 11-01..03: counters hold 37-46 percent of USD 35-40 a day; deepseek-v4.1-flash-1017 3.27M vs 0',
 'contracts registered active; the unattributed and account-over-target probes fail until the remaining callers are bound',
 'failure_modes, remediation_contracts, capability_ledger rows only; no worker, cron or cap changes',
 'DELETE the three fm- contract and failure_modes rows (migration Rollback line)',
 'ai-meter-by-model',
 'spend-cap-overshoot passes from 2026-11-06 if the caps hold; ai-spend-unattributed and ai-account-over-target pass only after the unattributed callers are bound',
 'migrations/spend-enforce-detectors.test.mjs'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'SPEND-ENFORCE-DETECTORS-1:%');
