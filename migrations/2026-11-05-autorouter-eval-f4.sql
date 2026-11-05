-- AUTOROUTER-EVAL-1 (2026-11-05, charter pillar cost, program QNFO.INFRA): RM-AUTOROUTER-EVAL-1 (agent_issues 1000652, GitHub 5705 and 5574).
-- WHAT WAS MEASURED (Cloudflare API read-only through the account connector, 2026-11-05T00:00Z):
--  * gateway default has three dynamic routes, premium, standard and value (created 2026-10-31 16:02Z, each with an active version and a deployment); gateway qnfo-ai has none; no route is an Auto Router.
--  * the first step of the issue, the read-only gateway-routes action of scripts/cf_ops_actions.py, read the answer as result, but the API answers data.routes: against the real account it would have printed
--    count 0 ("no Auto Router configured") for a gateway that has three routes. It now reads data.routes (and result), pages, and prints the active version and the deployment flag of each route.
--  * the shadow replay itself (qnfo-ai /internal/eval/autorouter-shadow, qnfo-ai/autorouter-shadow.test.mjs) has never run: cloud_ops_events holds no row of kind autorouter-shadow, because nothing calls it
--    (qnfo-ai has no scheduled handler; the endpoint takes the router key or a fleet worker's service-binding caller).
--  * the old probe read ai_gateway_routes, a mirror whose rows are all marked DELETED 2026-09-26 and which no code writes, and llm_gateway_log.route_reason of the qnfo-ops gateway: neither can show the issue's definition of done.
-- WHAT THIS CHANGES: the probe of 1000652 now measures the definition of done (at least 3 autorouter-shadow events with status ok in 14 days, each carrying baseline and Auto Router cost and the selected model), and one
-- ROADMAP-1 row names the doer for the missing call (a daily replay of 3 logged prompts from qnfo-cloud-ops through its QNFO_AI binding).
-- PREDICTION (decision_log): after the doer lands, 3 or more ok events exist within a day and 1000652 reads the recorded cost per task; if the first replay returns status failed with a model-not-found error, cloudflare/auto
-- is not available on this account and the issue is closed with that error text as evidence, not retried. Falsifier: no event within 3 days of the doer's deploy.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_autorouter_eval_f4
-- Rollback: UPDATE remediation_contracts SET verify_probe = (SELECT b.verify_probe FROM bak_20261105_autorouter_eval_f4 b WHERE b.class = remediation_contracts.class), verify_transport = (SELECT b.verify_transport FROM bak_20261105_autorouter_eval_f4 b WHERE b.class = remediation_contracts.class) WHERE class = 'issue-1000652';

CREATE TABLE IF NOT EXISTS bak_20261105_autorouter_eval_f4 AS
SELECT class, issue_id, verify_probe, verify_transport, last_verdict
FROM remediation_contracts WHERE class = 'issue-1000652';

UPDATE remediation_contracts
SET verify_probe = 'SELECT ''at least 3 autorouter-shadow events with status ok in 14 days'' AS expected, CASE WHEN COALESCE(SUM(status = ''ok''), 0) >= 3 THEN ''at least 3 autorouter-shadow events with status ok in 14 days'' ELSE COALESCE(SUM(status = ''ok''), 0) || '' ok autorouter-shadow events in 14 days (''|| COUNT(*) || '' of any status)'' END AS observed FROM cloud_ops_events WHERE kind = ''autorouter-shadow'' AND ts > strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-14 days'')',
    verify_transport = 'd1-query'
WHERE class = 'issue-1000652';

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.INFRA AUTOROUTER-EVAL-1.2: run the Auto Router shadow replay every day from qnfo-cloud-ops',
 'code-task: repo=qnfo-workers path=qnfo-cloud-ops/worker.js' || char(10) ||
 'code-anchor: function workerHealthEndpoints(env, UA) {' || char(10) ||
 'code-probe: {"paths": ["qnfo-cloud-ops/worker.js"], "contains": "AUTOROUTER-EVAL-1.2"}' || char(10) || char(10) ||
 'Charter pillar cost (program QNFO.INFRA). Metric it should move: the recorded comparison of RM-AUTOROUTER-EVAL-1 (agent_issues 1000652): autorouter-shadow events in cloud_ops_events, none today.' || char(10) ||
 'Evidence: qnfo-ai/worker.js has autoRouterShadowRun and POST /internal/eval/autorouter-shadow (limit 1 to 5, confirm true, internal service-binding callers accepted by authOk), tested offline, never called. qnfo-cloud-ops already holds the QNFO_AI service binding with props caller (workerHealthEndpoints uses it for the chat probe).' || char(10) ||
 'EDIT: once per UTC day (gate on the absence of an autorouter-shadow event of that day, and on ops_config autorouter_shadow_daily not being off) call env.QNFO_AI.fetch("https://ai.qnfo.org/internal/eval/autorouter-shadow", POST, {"confirm": true, "limit": 3}) from the hourly worker-health run, write the answer''s status and counts to cloud_ops_events kind autorouter-shadow-run, never fail the health run on an error. Mark with AUTOROUTER-EVAL-1.2. The call costs at most three model calls a day; a breached spend cap steers qnfo-ai to its cheaper route (BUDGET-SOFT-ROUTE-1), it does not stop the run.' || char(10) ||
 'Definition of done: merged and verified live, 3 or more autorouter-shadow events with status ok (or one with the Auto Router error text, which then closes 1000652 as unavailable), cost per task and quality delta recorded in issue_triage.close_evidence. ENSEMBLE-POLICY-1: the quality judge is non-model or a disjoint family, so exact_match and output_length_ratio stay descriptive until a judge is added.',
 'session:C-ops-tools-F4', 'feature', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.INFRA AUTOROUTER-EVAL-1.2%');

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session C-ops-tools-F4 (issue 1000652)',
       'the issue is closed by a recorded cost and quality comparison, not by the presence of a route row; the missing piece is a caller for the shadow replay that already exists',
       'AUTOROUTER-EVAL-1 migration: probe of 1000652 measures autorouter-shadow events; gateway-routes action reads data.routes; ROADMAP-1 row for the daily replay from qnfo-cloud-ops',
       'GET /accounts/{id}/ai-gateway/gateways/default/routes answered data.routes with 3 dynamic routes (premium, standard, value); gateway qnfo-ai 0 routes; cloud_ops_events kind autorouter-shadow 0 rows; the old probe read a mirror marked DELETED',
       '1000652 stays open with a probe on its real definition of done and a doer',
       'one remediation_contracts row, one agent_issues row, scripts/cf_ops_actions.py gateway-routes',
       'the migration Rollback restores the old probe from bak_20261105_autorouter_eval_f4; the action change is a revert of the pull request',
       'the route inventory is read correctly by the fleet action and the replay has a named caller',
       'within one day of the doer deploy, 3 autorouter-shadow events exist; 1000652 reads their cost per task',
       'no external reach change',
       'python3 scripts/cf_ops_gateway_routes_test.py (14 checks on the live response shape); migrations/autorouter-eval-f4.test.mjs'
WHERE NOT EXISTS (
  SELECT 1 FROM decision_log
  WHERE action LIKE 'AUTOROUTER-EVAL-1 migration:%'
);
