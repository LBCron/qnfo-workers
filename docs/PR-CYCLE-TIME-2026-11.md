# PR cycle time, 2026-11 (PR-RETRY-1)

Charter pillar: `autonomy`. Owner directives: 2026-10-14 "The system shall process PRs more rapidly and push to production."; 2026-11-04 "PRs need to be closed at max 2 hours". Builds on CI-VELOCITY-1 (docs/CI-VELOCITY-2026-11.md); that part is unchanged.

## Measured (2026-11-04, last 60 merged PRs into main, merges 16:54Z to 19:00Z)

Source: one `pulls?state=closed&base=main&per_page=100&sort=updated` call (created_at, merged_at); class from the files of each squash commit in local `git show` (no REST). Minutes are open -> merged.

| class | n | median | p90 | slowest |
|---|---|---|---|---|
| migration-only | 20 | 11 | 44 | 104 |
| worker (non control-plane) | 11 | 20 | 56 | 78 |
| scripts | 10 | 16 | 105 | 107 |
| .github | 8 | 18 | 46 | 104 |
| control-plane worker | 8 | 28 | 160 | 1392 (Copilot PR 6703) |
| other (docs, mixed) | 3 | 104 | 107 | 107 |
| all | 60 | 19 | 104 | 1392 |

Class does not explain the tail. Of the ten slowest, seven (7055, 7056, 7059, 7062, 7063, 7064, 7075; 92-107 min) are one cluster across five classes, all merged 18:55-18:56Z after opening 17:08-17:24Z. The rest: 6998 (160 min, code-loop PR, long iteration), 7035 (78), 6703 (Copilot, 23 h, stalled assignment).

## Dominant wait

The cluster went red on `pr-checks` -> `version-bump-guard` -> step "Lint the workflow YAML class repo-wide" at 17:13Z, because the PR merge commit carried a transient workflow state of main (workflow-lint passes on main now). Then nothing happened for 100 minutes:

- `merge-when-ready` fires only on a green `pr-checks` (workflow_run success), so a red run never wakes it.
- The stale-PR lane and `/gh/poke` refuse a PR with a red required check; the only exit was a new push.
- A plain re-run of a pull_request run reuses the same merge commit, so it cannot cure a failure caused by main's state at merge-commit time; a new merge commit needs a push (`update-branch`).

Not the bottleneck (checked): quiet-period idle. `ops_config stale_pr_merge_idle_min` is already `3` (floor 10 in the docs is stale), `stale_pr_merge_workflows` and `control_plane_self_merge` are `on`. Median 19 min and migration-only median 11 min show the green path is already fast (checks 70-390 s).

## Decision

PR-RETRY-1: a `retry` job in `.github/workflows/pr-lane.yml`, on a `pr-checks` workflow_run that concluded `failure`, `run_attempt == 1`, event pull_request, head still equals the run's sha, not a draft, no `hold` label, no `HOLD:` comment, not a `copilot/` branch:
- main is ahead of the head -> `PUT pulls/N/update-branch` pinned to the head (QNFO_GH_PAT, so the push starts workflows): new merge commit, fresh checks, then `merge-when-ready` merges on green as before.
- otherwise -> `gh run rerun --failed` (cures a flaky job on the same commit).
Only attempt 1 is answered; a second red run (attempt 2, or a run on the updated head that is not behind) stays red for a person/code loop.

Why safe: required checks, `merge-when-ready` readiness rules, HOLD comments, version-bump-guard and the canary + revert are untouched; the job only starts checks, it merges nothing. A real defect costs one extra CI run (~5 min). A conflict makes update-branch refuse, logged as a notice. Revert: delete the `retry` job.

Rejected: lowering `stale_pr_merge_idle_min` (already 3); letting merge-when-ready take migration-only/docs (it already merges every class once checks are green; migration-only median is 11 min); a bare re-run (same merge commit, would not have cured the 17:13Z failure); auto-update of every BEHIND PR (more CI runs on every main move, against CI-VELOCITY-1).

## Prediction

Red-then-stuck PRs: wait falls from ~100 min to about check time x 2 (~10-15 min) when the cause is a transient or main-state failure. On the same sample the 7 cluster PRs drop to ~15 min: p90 about 104 -> about 45 min, median 19 -> 17 min (the median barely moves). Watch for: `retry` runs that end red again (real defects), update-branch loops (bounded by one attempt per head).

## Re-measure

```
gh api 'repos/QNFO/qnfo-workers/pulls?state=closed&base=main&per_page=100&sort=updated&direction=desc' --jq '.[]|select(.merged_at)|[.number,.created_at,.merged_at]|@tsv'
```

Compute median/p90 of merged_at - created_at over the 60 merges after this PR merges, and list `pr-lane` runs whose `retry` job ran (`gh run list --workflow pr-lane.yml`). Keep if p90 falls and no PR shows two `retry` runs; revert otherwise.
