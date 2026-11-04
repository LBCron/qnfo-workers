# CI velocity, 2026-11 (CI-VELOCITY-1)

Charter pillar: `cost` and `autonomy` (merge speed). Builds on THREE-PR-WORKFLOWS-1 (#6976, at most three workflows per pull request); that part is unchanged.

## Measured (2026-11-04, one sample window)

Window 2026-11-04T16:00:00Z to 16:12:00Z, one `actions/runs` listing (2 REST calls), 136 runs, 5 merges to main. That is about 680 runs/h at this moment; the 2500 runs/h seen earlier was a burst of the same shape. "wall min" is `updated_at - run_started_at`, which includes queue wait inside the run, so it over-states runner minutes (it is the queueing cost, the thing that made clean pull requests wait).

| workflow (event) | runs / 12 min | cancelled | wall min | trigger shape |
|---|---|---|---|---|
| pr-lane (pull_request_target) | 20 | 17 | 401 | 7 activity types + workflow_run; replaced-pending cancels |
| deploy-gate (pull_request) | 14 | 2 | 273 | required |
| pr-checks (pull_request) | 14 | 2 | 269 | required |
| deploy-gate (push) | 5 | 0 | 97 | every main push |
| identity-guard, version-compare, mirror-guard (push) | 5 each | 0 | 111-126 | every main push, no path filter |
| fleet-graph, conflict-repair, copilot-pr-lifecycle, artifacts-mirror-sync, mirror-sync, ci-watchdog-resolve, fleet-autodeploy (push) | 5 each | 2-4 | 92-109 | every main push |
| lane-poke (issue_comment) | 4 | 3 | 74 | already bot-filtered in the job `if` |
| path-filtered push (adversarial, version-bump, canonical-deploy, model-floor, apply-migrations, ...) | 1-4 | 0-2 | 20-85 | fine |

One merge to main fans out to about 17 push-event runs, and each `mirror-sync` and `fleet-autodeploy` completion (cancelled ones included) fans out further by `workflow_run`: mirror-sync -> mirror-guard, ci-watchdog, artifacts-canonical-sync, fleet-autodeploy, container-config-selfheal-cron; fleet-autodeploy -> code-task-publish, remediation-bridge, container-config-selfheal-cron; canonical-deploy -> fleet-autodeploy, fleet-telemetry-probe. Cancelled runs still trigger `workflow_run` consumers. That is why container-config-selfheal-cron (12 of 13), code-task-publish (10 of 11) and remediation-bridge (9 of 10) were cancelled: they started for a superseded upstream and were then replaced by their own concurrency group.

Bot data commits (ci-status, audits) were 218 of 448 commits in 36 hours, but 216 of those already carry `[skip ci]`; the two that did not (`ci(container-config): autoverify result`) are fixed here.

Branch protection REST read returned the classic protection without contexts; the `main-safety` ruleset is the source of the required checks. None of them is touched.

## Changes

1. `workflow_run` consumers skip a cancelled upstream at job level (`if: ... conclusion != 'cancelled'`): artifacts-canonical-sync, assign-copilot-on-issue, code-task-publish, conflict-repair, container-config-selfheal-cron, copilot-pr-lifecycle, fleet-autodeploy, fleet-telemetry-probe, mirror-guard, remediation-bridge, repository-age-policy, ci-watchdog (job and concurrency group, kept equal), pr-lane (poke and merge). A superseded upstream is always followed by a newer run that fires the same consumers, so nothing is lost. A skipped job takes no runner and no queue slot.
2. mirror-guard loses its `push` trigger. Its own header says the push run only warns and the `workflow_run` after mirror-sync is the authoritative gate.
3. fleet-autodeploy loses its `push` trigger. Its header documents the push run auditing while canonical-deploy is still deploying; every worker push ends in a mirror-sync or canonical-deploy completion that starts it. Schedule, `workflow_run` and dispatch stay.
4. mirror-sync runs only when a `worker.js`, a `deployed-current.worker.js`, `scripts/mirror-guard.py` or its own file changes (was: every push). Docs, migrations and data pushes no longer start it or its five `workflow_run` consumers.
5. version-compare (push) runs only for `qnfo-fleet-control/**` or its own file. The pull request path (`pr-checks` -> workflow_call) is unchanged.
6. container-config-autoverify's commit carries `[skip ci]`.

Not changed, on purpose: deploy-gate, pr-checks, identity-guard, version-bump-guard, canonical-deploy (required or safety nets; lane merges skip the gate, so the post-merge deploy-gate run is the net); conflict-repair and copilot-pr-lifecycle push triggers (a main move is what creates the conflicts they repair; they already collapse to one pending run); artifacts-mirror-sync (collapses to one pending run, reads the tip).

## Prediction

- Runs that start a job on a runner, per worker-source merge: about 17 push runs plus about 8 chained -> about 14 plus about 3 (mirror-guard push, fleet-autodeploy push gone; cancelled-upstream consumers skipped).
- Per docs, migration or data-only merge: about 17 plus 8 -> about 11 plus 2 (mirror-sync and version-compare skipped, with their fan-out).
- Runs/h that take a runner at the 16:00Z load: about 680 -> about 500 (-25%). Runs created (skipped ones included) fall less: about -10%, because a skipped run is still a record. At the 2500/h burst, which is 3.7x this window, the same ratios give about 1900 started and the queue backlog shrinks in proportion; the under-1200 target needs the burst itself to shrink (fewer merges per hour), which this change does not claim. Next lever if the ratio holds: batch merges (merge queue), and `pr-lane` activity types `assigned`, `review_requested`, `edited` (17 of 20 runs were replaced-pending cancels).
- Guards: required checks unchanged; `workflow-lint` passes; `runner-pin-annotations.test.mjs` 46/46.
- Pre-existing failures seen while testing, not caused by this change: `scripts/copilot-pr-lifecycle.test.mjs` (2: expects a `pull_request_target:` trigger and a `branches-ignore` block in lane-poke that #6976 removed) and `migrations/pr-guard-fixes.test.mjs` (1: version-bump-guard marker).

## Re-measure

```
gh api 'repos/QNFO/qnfo-workers/actions/runs?per_page=100&created=2026-11-04T16:00:00Z..2026-11-04T16:12:00Z' --paginate --jq '.workflow_runs[]|[.name,.event,.status,.conclusion,.run_started_at,.updated_at]|@tsv'
```

Change the window to a 12 minute span after the merge, group by (name, event), count `cancelled`/`skipped` conclusions. Keep or revert on: started runs per merge down, `pr-lane`/`mirror-guard` still green on main, no `mirror-guard` or `fleet-autodeploy` staleness issue within 24 h (`fm-gh-poke-silent`, `MIRROR-STALENESS-DEPLOY-FAIL-1`). Revert path: restore the removed `push:` blocks.
