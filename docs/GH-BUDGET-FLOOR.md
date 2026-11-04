# GH-BUDGET-FLOOR-1 (issue 7071, charter pillar core)

The shared personal token (`QNFO_GH_PAT`, user 167072747, 5000 REST calls an hour) read 0/5000 twice on 2026-11-04 (about 16:20Z and 17:20Z) and stalled PR creation and every merge.
Sweeps spend the same bucket as the merge lane and nothing yielded.

## The helper

`node scripts/gh-budget-floor.mjs --floor 600 --class sweep` reads `GET /rate_limit` (free) with the token the caller will spend and prints one JSON line
`{remaining, limit, reset, floor, class, yield, probe}`. Exit 0 proceeds; exit 78 yields (a yield also prints `GH-BUDGET-YIELD {json}` and `budget-floor: ... skipped`).
Class `lane` has floor 0 and never yields. A probe that errors proceeds. Floor: repository variable `GH_BUDGET_FLOOR` (overrides the flag; `0` disables), default 600.
Revert: set `GH_BUDGET_FLOOR=0`.

## PAT-spending workflows

| Workflow | Fires | Class | Wired |
|---|---|---|---|
| assign-copilot-on-issue (assign-copilot-sweep.mjs, cap 170 reads a run) | issues opened, after remediation-consumer, hourly cron `41 * * * *` | sweep | yes, `budgetGate()` in main() |
| artifacts-canonical-sync | after every mirror-sync run | sweep | yes, step skips reconcile and assert |
| repository-age-policy | after remediation-consumer, issues opened/reopened, daily cron | sweep | yes |
| copilot-pr-lifecycle | after workflow runs, pushes | mixed (KICK-GATED-CHECKS is lane work) | no: needs a per-part split |
| request-copilot-review | every ready PR (workflow_call) | sweep | no: the job has no checkout; needs one (or an inlined rate_limit call) |
| external-repo-patch, github-settings-actions | dispatch / push on their own paths | sweep, rare | no: low volume |
| merge-when-ready, pr-lane | every PR event | lane | never |

## Follow-ups owed

- Metric `github_pat_budget_floor_hits_24h` (count of `GH-BUDGET-YIELD` lines in 24 h; guard, target 0 stalls) needs a `metric_registry` row, a trigger and a `metric_breach_cause` mapping in one migration (METRIC-CAUSE-AT-REGISTRATION-1).
- DONE (GH-BUDGET-MIN-1, qnfo-cloud-ops 1.45.0): the existing 10-minute `GET /rate_limit` sample (GH-TOKEN-WATCH-1; not 30) keeps the lowest value per UTC hour in `scheduler_state gh_budget_min24`
  and writes the 24-hour minimum to metric `github_pat_budget_min_24h` (guard, target >= 600, trigger lt 600, cause `code-loop`, detector `fm-github-pat-budget-min`).
  Blind spot: only the watch's samples with its own token (GH_TOKEN, per-user bucket); a drain and recovery inside one 10-minute gap is still invisible.
- Wire `request-copilot-review` (add checkout) and the sweep parts of `copilot-pr-lifecycle`.
