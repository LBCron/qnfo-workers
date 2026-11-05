# qnfo-fleet-deploy — fleet self-heal control plane

- **Purpose**: central, token-gated worker-redeploy control plane (self-healing fleet). Deploys canonical bundles to any worker; hourly drift scan; audit ledger.
- **Capabilities**: POST /redeploy (token-gated), POST /drift (admin, report-only scan), hourly scheduled drift scan (auto-heal OFF by default), fail-closed kill-switch + auto_heal flags in qnfo-audit.fleet_deploy_state, audit in fleet_deploys + fleet_drift_report.
- **Deploy method**: wrangler deploy (canonical) — currently API-multipart-deployed v0.2.0.
- **Canonical source**: QNFO/qnfo-workers/qnfo-fleet-deploy (this dir).
- **Secrets**: CF_DEPLOY_TOKEN (scoped Workers Scripts Write+Read), DEPLOY_ADMIN_TOKEN, SELFHEAL_TOKEN.
- **Security**: crown-jewel CF token lives ONLY here. Kill-switch (fleet_deploy_state.enabled) + auto_heal flag BOTH default '0' (fail-closed). Self-redeploy refused. 60s cooldown. Canonical-source-only redeploy (no arbitrary code injection). Do NOT enable auto_heal until canonical bundles are synced ahead of deployed versions (2026-09-08 drift scan: 7 workers deployed-AHEAD of canonical).
