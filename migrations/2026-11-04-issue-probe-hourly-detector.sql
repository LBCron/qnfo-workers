-- ISSUE-PROBE-HOURLY-DETECTOR-1 (2026-11-04, charter pillar cost; owner: Workers AI about USD 200-300 a month).
-- The trigger change that bounds the issue-birth path is session:spend-enforce's PROBE-BIRTH-CAP-1 (branch claude/probe-birth-cap); this file adds only the
-- detector and the record, so the two cannot collide on agent_issues_birth_contract_ins. It was measured independently on 2026-11-04 ~16:30Z:
--   Cloudflare's meter (GraphQL aiInferenceAdaptiveGroups, source of cost_daily.workers_ai): 3.56 M neurons (USD 39.03) on 11-03, 2.36 M (USD 25.84) by 16:00Z on 11-04, against 1.48 M
--   in ai_call_counters for 11-03 (workers_ai_attribution_coverage_pct 37): the caps cannot see about 60 % of the spend.
--   @cf/deepseek-ai/deepseek-v4.1-flash-1017 behind qnfo-agents: 2.32 M of 5.93 M neurons (39 %) since 11-03 00:00Z, 12,391 calls; AI Gateway logs 14:47-16:28Z: 578 of 700 calls,
--   10.4 M input tokens, 17.9 K input tokens a call (about 27 calls and 3.3 K neurons, USD 0.036, per agent request).
--   cf_agent_requests: issue-probe-agent 304 requests on 11-04 (311 on 11-03, 368 on 11-02), 133 of them within 3 minutes of the issue (birth), covering 202 issues, 34 of them
--   D1-overload tickets (CF-OBS-ISSUE-1, LOOP-BREAKER-1); program-manager:* 92 (133 on 11-03).
-- The bound alone is not enough: nothing reads the request rate afterwards, and the per-hour cut of 12 -> 2 earlier today did not move the hourly calls. The detector fails when more than
-- 8 issue-probe-agent requests were created in the last 60 minutes (birth cap 2 + hourly step 2 per run leaves room), so a regression, a lifted limit or a second birth path is seen
-- within the hour and not in the next day's bill.
-- Prediction (with PROBE-BIRTH-CAP-1 live): issue-probe-agent requests under 120 a day, deepseek-v4.1-flash-1017 under 20 K neurons and 130 calls an hour in GraphQL; this detector reads 0.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM remediation_contracts WHERE class = 'fm-issue-probe-hourly-unbounded'; DELETE FROM failure_modes WHERE fm_key = 'issue-probe-hourly-unbounded'
-- spof-review: one read-only detector contract and one failure-mode row; no trigger, cron, credential or executor.
-- CAUSE-MAPPED: registers no metric_registry row.

INSERT OR IGNORE INTO failure_modes (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id, trigger_condition, symptom, blast_radius) VALUES
 ('issue-probe-hourly-unbounded',
  'a trigger or step queues an LLM agent loop (about 27 model calls, 3.3 K neurons, USD 0.036) per event with no hourly budget, so spend follows the event rate: the issue-probe-agent ran 304 loops a day, 44 % of them at issue birth, and the D1-overload tickets drove it',
  'agent_issues_birth_contract_ins inserted a cf_agent_requests row for every new open issue (ISSUE-BIRTH-DOER-PROBE-1); issue_probe_agent_per_hour bounds only the hourly step, and the fleet caps do not see qnfo-agents calls (attribution coverage 37 %)',
  'PROBE-BIRTH-CAP-1 bounds the birth path (ops_config issue_probe_birth_per_hour); this detector fails when an hour holds more than 8 issue-probe-agent requests, whatever the source',
  'fm-issue-probe-hourly-unbounded: 1 when more than 8 issue-probe-agent requests were created in the last 60 minutes, expected 0',
  'fm-issue-probe-hourly-unbounded', '2026-11-04', (SELECT id FROM agent_issues WHERE title LIKE 'D1-OVERLOAD-1e:%' ORDER BY id DESC LIMIT 1),
  'a burst of new issues (an outage files dozens of tickets) while a birth or step path has no rate budget, or the limit is lifted',
  'cf_agent_requests issue-probe-agent above 120 a day; deepseek-v4.1-flash-1017 above 20 K neurons an hour in GraphQL aiInferenceAdaptiveGroups',
  'Workers AI neurons, the AI-spend caps, the single-writer D1 (each agent loop reads and writes qnfo-audit)');

INSERT OR IGNORE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, next_due_at, module, budget_ms, max_items, requires_container) VALUES
 ('fm-issue-probe-hourly-unbounded', NULL, 'ISSUE-PROBE-HOURLY-DETECTOR-1', 'failure-mode detector',
  'SELECT ''0'' AS expected, CAST(CASE WHEN (SELECT COUNT(*) FROM cf_agent_requests WHERE requester = ''issue-probe-agent'' AND created_at > strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-60 minutes'')) > 8 THEN 1 ELSE 0 END AS TEXT) AS observed',
  'd1-query', 3, 'qnfo-fleet-control', 1, 'active', strftime('%Y-%m-%d %H:%M:%S', 'now'), 'failure-mode', 45000, 5, 0);

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:fleet-tick-fanout', 'a bound on the birth path is only as good as the alarm that notices it failing: the per-hour cut earlier today did not move the hourly deepseek calls and nobody saw it',
  'ISSUE-PROBE-HOURLY-DETECTOR-1: detector fm-issue-probe-hourly-unbounded (more than 8 issue-probe-agent requests in 60 minutes) and its failure-mode row; the trigger change itself is PROBE-BIRTH-CAP-1',
  'GraphQL aiInferenceAdaptiveGroups: deepseek-v4.1-flash-1017 20-75 K neurons and 130-450 calls every hour on 11-04; AI Gateway logs 578 of 700 calls from qnfo-agents; cf_agent_requests 304 issue-probe-agent requests on 11-04, 133 at birth; cost_daily.workers_ai USD 39.03 on 11-03 against 1.48 M neurons counted',
  'a regression of the issue-probe request rate is detected within the hour', 'one read-only contract and one failure-mode row',
  'the Rollback line', 'the AI-spend bound on the probe agent is watched, not assumed',
  'detector reads 0 within 24 h of PROBE-BIRTH-CAP-1 merging; issue-probe-agent requests under 120 a day', NULL, 'SQLite test in migrations/issue-probe-hourly-detector.test.mjs'
WHERE NOT EXISTS (SELECT 1 FROM decision_log d WHERE d.action LIKE 'ISSUE-PROBE-HOURLY-DETECTOR-1:%');
