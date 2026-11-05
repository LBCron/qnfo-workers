-- WRITE-ROUTES-4 (2026-11-05, charter pillar security; roadmap row RM-TP-8-TRUST-BOUNDARY id 133). Two things the first reading of unauth_write_routes_open showed were missing.
-- 1. v_unauth_write_routes: the answer to "which write routes are open right now" in one indexed read (the latest run of the metric in bp26_probe_results, ok = 0 is an open route, ok = 1 refused or absent, ok NULL unproven, unknown or a register entry). Today that needs
--    a MAX(run_at) subquery by hand; the index idx_bp26_probe_metric_time (metric, run_at) serves both steps.
-- 2. The fix issue for qnfo-deploy-guard (WRITE-ROUTES-DEPLOY-GUARD-1) lacked the caller map, and a flat refusal of its routes would break deploys. Read 2026-11-05: scripts/deploy_guard.py (the session CLI) posts /lock/acquire, /lock/release and /ledger to the public URL with no
--    credential; /lock/acquire is also named by .github/workflows/deploy-code-orchestrator.yml, deploy-qnfo-agents.yml, scripts/raw_put.py and scripts/cf_ops_actions.py (qnfo-fleet-control/worker.js also reads the lock routes); fleet-graph impact lists four service-binding binders (qnfo-agents GUARD, qnfo-code-orchestrator DEPLOY_GUARD,
--    qnfo-fleet-control SVC_DEPLOY_GUARD, qnfo-ops DEPLOY_GUARD); qnfo-deploy-guard/d1-overload-resilience.test.mjs E1 posts /thresholds as the vehicle of its catch-all 500 test. The note goes into the issue before its code-task line, which stays the last block.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DROP VIEW IF EXISTS v_unauth_write_routes; UPDATE agent_issues SET description = substr(description, 1, instr(description, char(10) || 'C5-RESILIENCE caller findings') - 1) || substr(description, instr(description, 'END C5-RESILIENCE-NOTE') + length('END C5-RESILIENCE-NOTE')) WHERE source = 'session:c5-resilience' AND instr(description, 'END C5-RESILIENCE-NOTE') > 0;
-- BACKUP: agent_issues

CREATE VIEW IF NOT EXISTS v_unauth_write_routes AS
SELECT run_at, subject, ok, detail
FROM bp26_probe_results
WHERE metric = 'unauth_write_routes_open'
  AND run_at = (SELECT MAX(run_at) FROM bp26_probe_results WHERE metric = 'unauth_write_routes_open');

UPDATE agent_issues
SET description = replace(description, char(10) || 'code-task: repo=qnfo-workers path=qnfo-deploy-guard/worker.js',
  char(10) || 'C5-RESILIENCE caller findings 2026-11-05 (read before editing): (1) /lock/acquire is named by .github/workflows/deploy-code-orchestrator.yml, deploy-qnfo-agents.yml, scripts/raw_put.py and scripts/cf_ops_actions.py (qnfo-fleet-control/worker.js also reads the lock routes), and the session CLI scripts/deploy_guard.py posts /lock/acquire, /lock/release and /ledger to the public URL with no credential, so a flat 403 on /lock/* can stop the deploy of qnfo-code-orchestrator and qnfo-agents and every secret-lock: verify each caller transport before refusing anything. (2) fleet-graph impact on worker:qnfo-deploy-guard lists four service-binding binders (qnfo-agents GUARD, qnfo-code-orchestrator DEPLOY_GUARD, qnfo-fleet-control SVC_DEPLOY_GUARD, qnfo-ops DEPLOY_GUARD); none declares props.caller today (the pattern is qnfo-containers-pilot PILOT-PROPS-CALLER-1 and BINDING-PROPS-APPLY-1). (3) POST /thresholds has no caller, but qnfo-deploy-guard/d1-overload-resilience.test.mjs E1 posts it as the vehicle of its catch-all 500 handler test: move that fixture to another route first. (4) Suggested order: /thresholds (410); /ledger and /capability-snapshot (accept a service-binding caller with props.caller and add the props to the four bindings in the same change; the CLI uses the public URL, so it needs a bearer or a binding); /scan (POST internal only, GET answers the cached report while it is under 5 minutes old); /lock/acquire last, where runners and sessions hold no credential: either keep it open by design with a per-owner ttl cap and move the register row from open-gap to open-by-design with that reason, or give the workflows the OPS_ROUTER_AUTH_KEY secret they already hold and require it; decide in the pull request, never as a flat refusal. END C5-RESILIENCE-NOTE' || char(10) || 'code-task: repo=qnfo-workers path=qnfo-deploy-guard/worker.js')
WHERE source = 'session:c5-resilience'
  AND instr(title, 'ROADMAP-1: QNFO.INFRA WRITE-ROUTES-DEPLOY-GUARD-1:') = 1
  AND instr(description, 'END C5-RESILIENCE-NOTE') = 0;
