# Main push policy (MAIN-PUSH-POLICY-1, 2026-11-04)

Charter pillar: `core` (reliability). Out of scope and untouched: the ruleset itself.

## What changed on the repository

Ruleset 26544275 `require-build` (active, default branch) requires the status check `Workers Builds: qnfo-workers` and a pull request.
Its only bypass actor is the repository admin role. Since about 16:47Z on 2026-11-04 every workflow step that ran
`git push origin HEAD:main` with the workflow token is refused:

    GH013: Repository rule violations found for refs/heads/main.
    - Required status check "Workers Builds: qnfo-workers" is expected.
    - Changes must be made through a pull request.

Evidence: fleet-autodeploy run 41894680201 (ci-watchdog #7144) and apply-pending-patches run 41895865847 (#7149), both
`[remote rejected] HEAD -> main (push declined due to repository rule violations)` after every retry. No step in any
workflow uses a PAT or an app token for its push (the checkout is the default `GITHUB_TOKEN`), so none of them bypasses.

## Rule

A workflow does not push to `main`. It publishes through `scripts/push_head.sh`:

| mode | for | target | result |
|---|---|---|---|
| `artifact` | status and audit snapshots (`ci-status/*.json`, `audits/`) | branch `fleet-artifacts` (cherry-pick of the artifact commit, latest wins, no pull request, no ruleset applies) | best effort: exits 0 with a `::warning::`; an artifact never turns a green workflow red |
| `code <branch> <title>` | source changes (patches, retired appliers, mirrors, unmangled bundles) | branch `fleet-bot/<name>` (replaced each run) and a pull request into `main` through the REST API | the stale-PR lane merges it when the required checks pass; if the repository setting "Allow GitHub Actions to create pull requests" is off the branch still carries the change and a warning says so |

`scripts/push_artifact.sh` (used by canonical-deploy, fleet-telemetry-probe, ux-journeys and the two remaining `attach-*` workflows)
now delegates to `push_head.sh artifact`. A step that truly runs with a bypass credential carries a
`# MAIN-PUSH-BYPASS: <credential and reason>` line in the same step; `scripts/main-push-policy.test.mjs` fails otherwise.

## Table

Class: (a) legitimate bypass, leave; (b) failing and consumed from main, needs a replacement path; (c) failing and nothing reads it from main,
stop writing to main. `reader` is what a grep of the repository and the workers found.

| workflow | writes | reader on main | class | change |
|---|---|---|---|---|
| fleet-autodeploy | `audits/fleet-autoaudit-<date>.json` | none (D1 `worker_live_audit` and the uploaded run artifact are the record) | c | `push_head.sh artifact`; step no longer fails the run |
| canonical-deploy | `ci-status/canonical-deploy.json` | none in code | c | via `push_artifact.sh` |
| fleet-telemetry-probe | `ci-status/fleet-telemetry.json` | none in code | c | via `push_artifact.sh` |
| ux-journeys | `ci-status/ux-journeys-{live,local}.json` | none in code | c | via `push_artifact.sh` |
| attach-surface-routes (the other five attach-* workflows were retired in TP-3b, archive/ATTACH-WORKFLOWS-MANIFEST.md) | `ci-status/attach-*.json` | none in code | c | via `push_artifact.sh` |
| attach-ask-qwav-route (attach-lifecycle-custom-domain was retired in TP-3B-ATTACH-1) | `ci-status/<name>.json` | none in code | c | `push_head.sh artifact` |
| dup-worker-name-gate, guard-timebudget, remediation-bridge, remediation-consumer | `ci-status/<name>.json` | none in code (code comments describe the file as public; `status_unchanged.py` diffs against `origin/main`, see risks) | c | `push_head.sh artifact` |
| container-config-autoverify, container-config-selfheal-cron, deploy-containers-pilot, restore-container-config-1485 | `ci-status/<name>.json` | none in code | c | `push_head.sh artifact` |
| apply-pending-patches | patch scripts, `*/worker.js`, `.github/workflows/*` (landed patches); `ci-status/` report | the repository itself | b (code) / c (report) | code to branch `fleet-bot/apply-pending-patches` plus pull request; report to `fleet-artifacts` |
| applier-doctor | retired appliers; `ci-status/applier-doctor.json`, `audits/` | code-read probe of `ci-status/applier-doctor.json` (issue-100320 contract) | b / c | code to `fleet-bot/applier-retire` plus pull request; report to `fleet-artifacts` |
| applier-rot-triage | `ci-status` (hourly status output) | none | c | `push_head.sh artifact` (MAIN-PUSH-POLICY-2: one pull request per hourly run cost CI and a deploy each; retiring appliers stays with applier-doctor) |
| apply-unmangle-worker-js | `*/worker.js` repairs, `ci-status/unmangle-worker-js.json` | the repository itself | b | code to `fleet-bot/unmangle-worker-js` plus pull request |
| mirror-sync | `*/deployed-current.worker.js` | `mirror-guard`, the canonical deploy | b | code to `fleet-bot/mirror-sync` plus pull request |
| deploy-code-orchestrator, canonical-deploy (canary) | automatic revert commit via `scripts/canary_revert.py` | the deploy path | b, NOT yet converted | `canary_revert.py` was under another session's work claim (`session:deploy-proof`); pending in `main-push-policy.test.mjs` (`PENDING`). Follow-up: push the revert to a branch, open the pull request, dispatch the redeploy from it |
| code-task-publish, canary scripts' tests | test fixtures only | n/a | a | not a push to the real main |
| qnfo-fleet-control PORTFOLIO-LOOP-1 and CHARTER-LOOP-1 (worker code, not a workflow) | `docs/PORTFOLIO.md` and `docs/QUNIVERSE-CHARTER.md` on main; `PORTFOLIO.md` and `profile/README.md` on the default branch of `QNFO/.github` (the organisation landing page) | people and agents read them from the default branch; LOOP-WATCH and the loop-heartbeats journey read the sync status | b, NOT yet converted | every `pfCommitOnce` and `charterCommitOnce` PUT is refused (HTTP 409) since 2026-11-04T16:05Z (`portfolio_sync_runs` 773 to 776; the note now carries GitHub's sentence, PUT-RULE-NOTE-1). Doer: `ROADMAP-1: QNFO.OPS #portfolio-pr-publish` (write to a branch, open a pull request, merge only where no status check is required); the daily charter refresh meets the same refusal |

## Mechanics (MAIN-PUSH-POLICY-2)

- `artifact [path ...]` builds a new commit from the artifact paths only, on top of `origin/fleet-artifacts` (`origin/main` for the first run). Only
  `ci-status/` and `audits/` are published, so nothing under `.github/` can ride along and a `fetch-depth: 1` checkout (no parent commit) cannot copy
  the whole tree. The path list is the arguments, else the files HEAD changed (after `fetch --deepen=1` when the clone is shallow).
- `code <branch>` skips the push when `HEAD^{tree}` equals the remote branch's tree, so an unchanged hourly result does not reset the pull request
  head or the lane's quiet timer. It exits 1 when the pull request cannot be opened, so the workflow goes red and ci-watchdog records it.
- Checks on a branch pull request: the one required check, `Workers Builds: qnfo-workers`, is started by the Cloudflare GitHub app on the branch push
  (an app webhook, which `GITHUB_TOKEN` does not suppress). Actions workflows (`pr-checks`) do not start on a pull request opened by `GITHUB_TOKEN`; they are
  not required, and the helper pokes the merge lane (`/gh/poke`) after opening it. Not verifiable offline: the first real run of each code-mode workflow
  shows whether the check appears on the branch head; if it does not, the workflow fails on the missing pull request or the lane's stale-PR timer
  escalates, and the fix is a `workflow_dispatch` trigger on `pr-checks`.
- The code-read probe `issue-100320` (`ci-status/applier-doctor.json` on main) was superseded by migration 2026-10-20-real-probes-3 (closure-observing probe);
  no live reader of any `ci-status/` file on main remains. `scripts/main-push-policy.test.mjs` also scans `scripts/*.py|sh` and detects bare, variable and
  expression targets and `gh api` contents writes.

## Risks and follow-ups

- Branch `fleet-artifacts` is built on the previous tip of itself, not on `main`: it holds the latest copy of each artifact, not a
  working tree. A reader that wants a status file reads
  `https://raw.githubusercontent.com/QNFO/qnfo-workers/fleet-artifacts/ci-status/<name>.json`. The copies on `main` stop updating
  (last bot commits reached main at 15:16Z on 2026-11-04) and are stale.
- A code branch pull request made by `GITHUB_TOKEN` does not start workflows by itself (GitHub's documented behaviour); the lane's
  update-branch kick (KICK-GATED-CHECKS-1) starts the required checks. If the setting for Actions-created pull requests is off,
  the change waits on its branch.
- `scripts/status_unchanged.py --ref origin/main` now resolves the ref to `origin/fleet-artifacts` when that branch carries the file (MAIN-PUSH-POLICY-2), so the throttle works again; `push_head.sh artifact` also skips a snapshot identical to the branch tip, so the branch does not grow with identical commits.
  the throttle no longer suppresses an identical snapshot; the effect is one extra branch commit per run, not a failure.
- `scripts/github-settings-actions.mjs workflowPushPaths` still lists `push_artifact.sh` as a main push path; it is report-only.

## Compatible with either owner choice

If the owner prefers to give the bot a bypass on the ruleset instead, nothing here needs reverting: the branches and pull requests
keep working, and a workflow that should push to main again carries a `# MAIN-PUSH-BYPASS:` line and a credential that bypasses.
