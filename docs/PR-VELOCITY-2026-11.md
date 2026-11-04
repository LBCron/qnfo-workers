# PR velocity, 2026-11 (PR-VELOCITY-1)

Charter pillar: `autonomy` (merge speed, a green main) and `cost` (the shared GitHub REST budget). Owner directive 2026-11-04: raise velocity, improve quality and cut cost across Cloudflare, GitHub and the rest.
Builds on CI-VELOCITY-1 (docs/CI-VELOCITY-2026-11.md), PR-RETRY-1 (docs/PR-CYCLE-TIME-2026-11.md) and GH-BUDGET-FLOOR-1 (docs/GH-BUDGET-FLOOR.md); none of them is changed.

## Measured (2026-11-04, last 100 merged pull requests, merges 15:49Z to 18:57Z)

Re-measure with `python scripts/pr_velocity.py --runs` (2 list calls plus 12 for the runs; heads and merge replays are git).

| measure | before |
|---|---|
| open -> merge | median 31.2 min, p90 78.1 min (a draft PR counts from the day it was opened) |
| last push -> merge | median 7.8 min, p90 55.1 min |
| PRs that needed a conflicted merge commit (each merge commit replayed with `git merge-tree`; an update-branch that merged clean is not one) | 18 of 100 |
| ... of those, conflict hunks only in the VERSION line and release-note block | 10 of 18; 52 of 110 hunks, each twice (source and mirror) |
| ... the other hunks | real code: qnfo-code-orchestrator 27 hunks in 2 PRs |
| worker bumps whose release note sits on the VERSION line itself (more than 40 characters) | 34 of 44; note lines added under it: 9 of 44 |
| Actions runs in the window (event) | pull_request 317 (19% cancelled, 9% failed), push 1470 (47% cancelled), workflow_run 2395 (49% cancelled): about 42 runs per merged PR, 3 of them on the PR |
| deploy-gate on push to main | 35 of 37 sampled runs cancelled by the next merge; the 6 of 6 failed push runs all failed `SUITE-RUNNER-1` (9 failing suites each) |

Conflicts are not the main delay: conflicted PRs merged no slower (median 25.7 min against 31.9, last push -> merge 7 against 15). The tail is the stalls:

- Seven pull requests that touch nothing in common (7055, 7056, 7059, 7062, 7063, 7064, 7075: docs, migrations, workflow edits) went red at 17:09Z-17:14Z in `version-bump-guard / guard`, step "Lint the workflow YAML class repo-wide", and `workflow-lint / lint`. Their merge commits carried a transient defect of main. Nothing woke them for 92-107 minutes (`merge-when-ready` fires only on green); a session merged them by hand at 18:55Z. PR-RETRY-1 now retries once after the fact. This change removes the cause: a repository-wide guard blocks a pull request only for a failure the pull request adds.
- The checks that turn main red are cheap and were only ever read after the merge: deploy-gate is advisory on a pull request (MERGE-STREAMLINE-1) and its push run is cancelled by the next merge.

REST calls (the shared PAT is one user's 5000 an hour; the workflow `GITHUB_TOKEN` is the repository's own 1000 an hour):

| consumer | token | calls | per merge |
|---|---|---|---|
| CLAUDE.md "list what main and the open PRs claim" loop | session PAT | 1 + (1 + N open PRs) per bump, 26 with 25 open | 44 bumps in the window: about 1150 calls, 8% of the hourly budget |
| lane merge step (was merge-when-ready) | PAT | 3 reads (pull request, comments, check runs) per run + the merge; 2 to 3 runs per PR | 6 to 9 reads |
| conflict-repair probe, every push to main | workflow token | 2 to 3 passes x (1 + N), 40 to 75 with 20 open; about 12 pushes an hour | 400 to 900 an hour of the 1000 |
| assign-copilot sweep (up to 170 reads a run), artifacts sync, age policy | PAT | covered by GH-BUDGET-FLOOR-1 | not changed here |
| stop hook | session PAT | 21 to 33 per stop | covered by HOOK-REST-CACHE-1 (#7075) |

Call counts are from the code and the workflow logs, not a per-consumer counter: GitHub reports one bucket per token. The aggregate is `gh api rate_limit` (free).

## Changes

1. **REGRESSION-GATE-1** `scripts/regression_gate.py`: runs a guard on the pull request; when it fails, runs it on the base tree and compares the failure lines. A failure the base has too passes with a warning; a new failure line (a new invalid file, a changed count) blocks; a failure with no recognisable line, or no base to compare with, blocks (fail closed). Used by the two workflow-lint steps of `pr-checks.yml` (`versions` and `scans`); push, dispatch and main stay strict (the guard files keep the plain lint). `REGRESSION_GATE=strict` (repository variable) switches the relaxation off.
2. **PR-FAST-GUARDS-1** `scripts/pr_fast_guards.py` + a last, strict step of the `scans` job in `pr-checks.yml` (a step, not a check: the owner caps a PR at 5 entries and about a minute per check): narrative-prompt-guard, the load of every worker entry, the metric-cause rule and code-anchor-once (about 45 s together, in parallel), each through the regression gate; a failure blocks the lane instead of turning main red afterwards. The suites the change selects are available as `--with-suites` but not on the PR path: they take minutes (RED-SUITES-1 already runs the pin suites there).
3. **LANE-READ-TOKEN-1** the merge step of `pr-lane.yml` (merge-when-ready.yml was folded into it by PR-CHECK-CAP-5-1; the workflow gains `checks: read`): the reads use the workflow token; the PAT is spent once, on the merge, which needs it to start the push workflows. A refused read falls back to the PAT.
4. **CONFLICT-PROBE-GIT-1** `scripts/conflict_probe.py` + `conflict-repair.yml`: one list call, then `git fetch` of each head and `git merge-tree`. Exact at once (GitHub answers `null` for a minute after a push), no retry sleeps, 1 REST call instead of 40 to 75. A pull request the probe cannot judge counts as dirty.
5. **RELEASE-FRAGMENT-1** `scripts/worker_release.py`: `claims <worker>` (the CLAUDE.md loop with one REST call) and `bump <worker> --note ...` (next version above main and the open PRs, bare VERSION line, trailing comment moved to its own line, note in `<worker>/releases/<version>.md`, mirror copied when mirror-guard.py says it is safe, `node --check`). `version-bump-guard.py` warns (`version-line-notes`) when a new note lands on the VERSION line; `VERSION_LINE_NOTES=fail` makes it a violation. version-bump-guard and mirror-guard are otherwise untouched.
6. `scripts/pr_velocity.py`: the measurement above, as a command.

Tests (all `*.test.mjs`, picked up by `run-suites.mjs`): `regression-gate` 14, `pr-fast-guards` 11, `lane-read-token` 9, `conflict-probe` 11, `worker-release` 17.

## Not done, and why

- **The single-line VERSION collision stays.** Two pull requests that bump one worker still edit the same line, so the conflicted-merge share is not predicted to fall by much; the cost of each falls (one short line instead of up to 32 KB, no notes block, conflict-repair resolves it as before). Removing it needs the version assigned after the merge (a changeset-style stamp). Rejected for now: the canary proves "the new VERSION arrived" and `canary_revert.py` reverts the pushed commit; with the stamp as a second commit, the canary would no longer cover the code commit, and a revert of the stamp alone would leave the bad code on main. It needs the canary and the revert to follow a code change, not a version number, first.
- **The mirror stays committed.** The canonical deploy reads `deployed-current.worker.js` from main at push time; without the mirror in the PR, canonical-deploy would read a stale mirror until mirror-sync lands its follow-up commit (a GITHUB_TOKEN push starts no workflow), a red deploy per worker merge. `worker_release.py` copies it, `conflict_repair.py` regenerates it.
- **Existing release notes are not moved out of worker.js.** A one-time rewrite of 100 workers would conflict every open PR once. New releases use the fragments; the old notes stay as history.
- deploy-gate is off the PR path (PR-CHECK-CAP-5-1) and the full suite sweep stays a push-to-main run; a regression-only strict suite check (`pr_fast_guards.py --with-suites`) is built but not wired, because it takes minutes.

## Prediction

- A defect already on main no longer fails unrelated PRs: the 7-PR, 100-minute cluster cannot recur from that cause; on the sample, open -> merge p90 78 -> about 50 min and last push -> merge p90 55 -> about 25 min (the cluster is 7 of 100 PRs at 92-107 min). PR-RETRY-1 remains the net for a flaky job.
- Red main after a merge: failures of the five guards are stopped before the merge. Watch the `scans` check's red rate per PR (expected under 10%) and false blocks (a PR blocked by a failure line the base also has; the verdict line `REGRESSION-GATE <verdict>` is in every log).
- REST: merge-when-ready PAT reads 6-9 -> 0 per merge; conflict-repair probe 40-75 -> 1 per push; claims loop 26 -> 1 per bump. At the 2026-11-04 rate (about 33 merges and 15 bumps an hour): about 230 PAT calls an hour fewer from the lane, about 380 more once sessions use `claims`, and 400-900 workflow-token calls an hour fewer.
- Cost: the fast guards add about 45 s to the `scans` check, the conflict-repair job pays a checkout on every push (it is mostly cancelled by its own concurrency group).

## Re-measure and revert

```
python scripts/pr_velocity.py --runs      # before/after table; run it for the 100 PRs merged after the deploy
gh api rate_limit --jq .resources.core    # free; the aggregate PAT budget
```

Keep if the p90 falls, the `scans` check shows no false block (the `REGRESSION-GATE` verdict line is in its log), and no lane merge step reports a read fallback in bulk. Revert: delete the fast-guards step; set `REGRESSION_GATE=strict`; restore the three `gh api` reads in the lane merge step; restore the REST loop in conflict-repair.yml.
