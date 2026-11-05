# Gradual deploys with automatic rollback (BP26-GRADUAL-DEPLOYS-1)

Charter pillar: autonomy. Program QNFO.INFRA, project BP26.ENGINEERING. agent_issues 1000352, GitHub 4428. Written 2026-10-28.

## What Cloudflare provides (docs read 2026-10-28)

- Versions: `wrangler versions upload` / `POST /accounts/{id}/workers/scripts/{name}/versions` creates an immutable Version without sending it traffic.
  `keep_bindings` in its metadata carries the live script's bindings, secrets and settings forward.
- Gradual deployments: `POST .../deployments` with `strategy: percentage` and up to two versions (percentages sum to 100). A request is routed to one
  version for its whole life; use `Cloudflare-Workers-Version-Overrides: <worker>="<version-id>"` to send a smoke test to a version at 0 percent.
- Rollback: deploy the previous Version at 100 percent (`wrangler rollback`). Code only: data written by the new version stays, so migrations are
  expand-then-contract and writes idempotent.
- Limits: a Version upload cannot carry Durable Object migrations, and at most two versions are live during a rollout.
- Analytics: the account GraphQL dataset `workersInvocationsAdaptive` has the `scriptVersion` dimension, so errors and wall time compare per version.

## What the fleet had

The canonical path (`canonical-deploy.yml` > qnfo-ops `/ops/deploy`, PUT `/content`) replaces the code at 100 percent at once. `scripts/canary_revert.py`
proves the new `VERSION` arrived at `/health` and reverts the push on main when it does not (control-plane workers only). It cannot see an error-rate
regression and it acts after every request already runs the new code. Metric `deploys_via_gradual` was 0.

## What this adds

`scripts/gradual_deploy.py` (offline `--selftest`) and `.github/workflows/gradual-deploy.yml` (workflow_dispatch):

1. upload the Version from `<worker>/worker.js` (refuses a non-module script, a missing script and a rollout already in progress);
2. deploy the new Version at 0 percent (previous Version at 100), then smoke test: `/health` with the version override must answer 200 and report the new `VERSION`, before any traffic
   (10 probes 3 s apart). Cloudflare applies the override only to a Version that is in the current deployment, so without the 0 percent step the probe sees the previous Version for ever
   (GRADUAL-PREVIEW-ZERO-1, 2026-11-05: three qnfo-ai-calibration 1.8.1 pushes rolled back this way; the 2026-10-28 proofs re-deployed identical code and never tested the override).
   A failed smoke test puts the previous Version back at 100 percent and reports whether that call was accepted; a deployment left at 0 percent by a run that died is not a rollout in progress;
3. 10 percent, soak, compare error rate (new above max(2 percent, 2x old + 1 point)) and wall-time p99 (above 1.5x old) from GraphQL, and `/health`;
   fewer than 20 requests on the new version is "no verdict" (cron-only workers) and is gated on `/health` alone; then 50 percent, soak, compare; then 100;
4. any regression: deploy the previous Version at 100 percent, exit 1, `RESULT_JSON` names the stage and reason.

`scripts/bp26_cfapi.py` already reads each worker's deployment history: a `percentage` strategy with two versions counts as gradual (`deploys_via_gradual`),
a rollback or canary revert inside 24 h counts toward `change_failure_rate`, and rollback minutes feed `mttr_rollback_min_p95`.

## Adoption path

| Step | State 2026-10-28 |
|---|---|
| Script, selftest, workflow | done |
| Live proof on a non-control-plane worker (identical main code, so harmless) | run by this session; result on the issue |
| Make the canonical path call it (`canonical_deploy.py` `gradual_attempt`, allowlist `scripts/gradual-deploy-workers.txt`, 2026-10-28) | done for listed workers (starts with `qnfo-model-eval`): a push that changes only the code is a staged rollout, a `wrangler.toml` change, a refusal or an unlisted worker uses `/ops/deploy`; `GRADUAL_DEPLOY=off` disables it. `deploys_via_gradual` reaches 1.0 only when every production deploy is listed and code-only, so the allowlist grows worker by worker after a clean proof |
| Control-plane workers (qnfo-ops, qnfo-fleet-control, qnfo-deploy-guard) | after two clean proofs; the canary and revert rules in CLAUDE.md stay in force |
| Workers that need DO migrations, bindings or crons | stay on the canonical path; documented exception |

ES-module guard (GRADUAL-ES-MODULE-1, 2026-11-05): the Versions upload is modules-only, and the script accepts a worker whose code has `export default` or a bundler's `export { x as default }`. Before, only the first form passed, so 15 of the 34 worker directories (every esbuild bundle: qnfo-pdf, qnfo-subscribers, qnfo-gateway, qnfo-lifecycle, qnfo-tools-mcp and others) were refused with "not an ES module" in a dry run; now all 34 pass this guard. Durable Object, queue and binding changes still take the canonical path, and a worker joins `scripts/gradual-deploy-workers.txt` only after a clean staged proof.

Honest limits: analytics lag a few minutes, so a short soak can see no requests at all; the script then trusts `/health`. A regression that only shows in
a cron step or a downstream write is for LOOP-WATCH-1 and the metric triggers, as with the canary.
