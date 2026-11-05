# qnfo-github-steward

GITHUB-STEWARD-1 — the loop that keeps the QNFO GitHub estate in its declared shape.

## Why

The estate was optimised once, by hand, and then drifted. Measured on 2026-10-17 before this
worker existed:

| Defect | Count |
|:--|:--|
| active repositories that did **not** delete a merged branch | 61 / 61 |
| active repositories with a protected default branch | 3 / 61 |
| repositories allowing merge + rebase + squash simultaneously | 60 / 61 |
| organisation default permission granted to every member | `admin` |
| org-wide `GITHUB_TOKEN` default | `write` |
| workflows that could approve pull requests | `true` |

A setting is an optimisation only if something restores it. This worker restores it every six
hours and records each run in D1 (`qnfo-audit.github_steward_runs`).

## What it does

Reads one org (`QNFO`) plus the owner's personal account, compares every non-archived repository
and the organisation to the declared state in `worker.js`, writes only the differences, verifies
nothing else changed, and appends a ledger row.

It **never** deletes a repository, **never** archives one, **never** pushes a commit, and
**never** rewrites workflow YAML. Workflow findings are reported, not repaired: a heuristic
rewrite of a build file turns a green pipeline red, and that repair belongs to the code-agent
with a diff a human can read.

## Declared state

```
org   : default_repository_permission=read, members_can_create_public_repositories=false
repo  : delete_branch_on_merge, allow_auto_merge, allow_update_branch, allow_squash_merge,
        allow_merge_commit=false, allow_rebase_merge=false, has_projects=false
branch: no force-push, no deletion, no required reviews (autonomous direct pushes stay legal)
```

## Routes

| Route | Auth | Purpose |
|:--|:--|:--|
| `GET /health` | none | version, declared state, token presence |
| `GET /report` | none | the most recent ledger row |
| `POST /tick` | `x-steward-key` | reconcile now (`?workflows=1` also audits workflow hygiene) |

Cron: `17 */6 * * *` — minute 17 keeps it clear of the fleet's ten-minute control tick.

## Verification (2026-10-17)

```
run 1  0.1.0  checked=61  fixed=61  drift=360  errors=0  limitations=12
run 2  0.1.1  checked=61  fixed=0   drift=0    errors=0  limitations=12
```

Run 2 converging to zero is the proof the loop is idempotent rather than reporting phantom work.
(`0.1.0` compared against the LIST endpoint, which omits `delete_branch_on_merge` and the merge
flags, so every repository read as drifted; `0.1.1` compares against the single-repository
endpoint.)

## TRACKER-SYNC-1 — D1 and GitHub in step every 10 minutes (0.3.0)

Owner directive 2026-10-18: `qnfo-audit.code_tasks` and GitHub issues/PRs stay in sync at all times, so no metric
counts a phantom. Cron `3,13,23,33,43,53 * * * *` (off the control tick).

| Pair | Authority | What the tick does |
|:--|:--|:--|
| `agent_issues` ↔ GitHub issues (label `fleet-issue`, title `[#id] …`) | D1 (close-evidence gate) | files every open issue (20/tick), closes the GitHub issue when D1 closes it (posting the close evidence), reopens a GitHub issue closed by hand while D1 is open |
| `code_tasks` ↔ pull requests | GitHub | marks a task `merged` when its PR merged; records every other disagreement and every `codeagent-*` PR without a task row as drift |
| `fleet_issue_dispatch` ↔ GitHub issues (ISSUE-SYNC-1) | — | moved from the 6-hourly reconcile onto this tick |

Links live in `gh_issue_links` and `code_task_pr_links` (not new `agent_issues` columns: `agent_issues_tombstone` copies
it with `SELECT *`). `v_tracker_drift` lists what is still out of step; metric `tracker_drift` (target 0, trigger at > 0)
is graded once the open-issue backfill has finished. Scope (owner choice): open issues only; closed history stays in D1.
Public repository: descriptions are fenced, tokens and e-mail addresses redacted, personal and security issues mirrored by number only.
A failed or partial GitHub read changes nothing. If more than half the links disagree although D1 has not changed since the last agreement, each unexplained link is read by number: list omissions are left unchanged, while confirmed GitHub state changes are reconciled from D1.

### TRACKER-DRAIN-1 (0.5.0)

* **Budgeted, oldest first.** State fixes run oldest D1 change first (reopens lead, up to a quarter of the cap) until `TS_FIX_MS`
  (50 s) or `TS_FIX_CALLS` (110 subrequests, GitHub and D1 calls of the loop together), at least 10 and at most 40 attempts a tick.
  A disagreement is *explained* when D1 moved across open/closed since the link last agreed (`gh_issue_links.d1_status`, refreshed every
  tick, differs from the current status; roadmap links likewise): GitHub is simply behind, a burst, drained in slices. A row whose
  `d1_status` already equals its status while GitHub differs is a GitHub-side change (label rename, hand close, API anomaly) however
  recent `updated_at` is, and is refused when such rows are over half the links (control `tracker-mass-flip-guard`).
  **Rate limits** (TRACKER-RATE-LIMIT-1): only a 429, or a 403 with Retry-After, `x-ratelimit-remaining: 0` or a rate-limit/abuse/secondary
  message, is a limit. It latches one flag for the whole tick (`last_run.rate_limited`): every later stage (mirror, forward, reverse, PR
  sync, portfolio) makes no GitHub call. Any other 403 is that issue's refusal, recorded and skipped. `GET /tracker` `last_run.state_sync`
  reports drift, tried, fixed, carried, oldest_min and rate_limited; `v_tracker_drift.age_min` and metric `tracker_drift_oldest_min`
  (target <= 30) measure how long the oldest issue row (`issue-state`, `issue-unmirrored`) has waited; `code-task-pr` rows belong to the
  code loop and are counted by `tracker_code_task_drift`, not aged here. The `tracker_drift` count itself is not graced.
* **One status mapping.** Only `open` is open on GitHub. `monitoring` (a parked twin of a newer open row) closes `not_planned` with a
  comment naming the twin; `wontfix` closes `not_planned`; the rest `completed`. "Close evidence" is quoted only when D1 holds it.
  A monitoring card an earlier version closed as completed is corrected once (`gh_issue_links.gh_close_reason`).
* **ISSUE-SYNC-FORWARD-1.** A resolved `worker-observability` dispatch row closes its GitHub issue (`exec_state closed-by-sync`);
  a recurrence reopens it before the reverse leg can read the closed issue and flip the row to done.
* **Attempt PRs.** A pr-without-task row outside the recent window is read once by number, matched to its task by branch stem, and
  recorded with `head_ref` / `task_ref`.

`GET /tracker` shows the last tick; `POST /tracker/tick` (`x-steward-key`) runs one now.

## Settings the audit found undeclared (GITHUB-STEWARD-2, 0.16.0)

Source: `docs/FLEET-AUDIT-2026-10-30.md` section 4 (#5530). The hourly reconcile also declares, for **public, non-fork, non-archived QNFO repositories**: the default workflow token `read` and
workflow pull-request approval `false` (`QNFO/qnfo-workers` keeps approval `true`: conflict-repair, mirror-autosync and code-task-publish open or merge pull requests with the workflow token);
secret scanning and push protection `enabled`. For **public forks**: Actions disabled and code scanning default setup `not-configured`. For the **organisation**: the website `https://qnfo.org`
when empty; the organisation workflow-token defaults are reported (`org_actions_workflow`) and never written, because they also govern the private repositories whose workflows were not audited.
Private repositories, archived repositories and the personal account `rwnq8` are never read or written.

* Switch: `ops_config steward_settings_enforce` = `off` | `dry` | `on`. **Default `dry`**: the drift is computed and written to `GET /report` under `settings` (`drift` and `fixed` per setting,
  `refused` with repository, field, status and a trimmed text, `limitations`), nothing is written. `on` writes the differences, one write per difference; the next run reads `drift = {}`.
* A 403 is a recorded refusal, never retried with another credential; a 422 (or a 403 naming the plan) is a limitation; a rate limit latches `GH_LIMIT` like every other stage; at most 240 settings
  reads a run. Push protection can refuse a fleet write that contains a secret-like string: the ledger records the repository and status, never the content.
* Rollback: set the value to `off`. Re-enable Actions on a fork, or turn secret scanning off, in the repository's settings if ever needed; nothing here deletes anything.
* Tests: `settings-reconcile.test.mjs` (diff per setting, forks, the qnfo-workers exception, private and archived untouched, off/dry/on, convergence, 403/422/429, read cap, kill switch).

## Kill switch (BP26-KILLSWITCH-READERS-1)

While `ops_config fleet_kill_switch` is `on`, a scheduled run starts nothing that writes outside the fleet and records one `kill-switch.observed` event (job `qnfo-github-steward`) per five minutes.
The read is cached for 30 seconds and fails open. `POST /tick` and the other keyed routes are a person's explicit request and stay. Protocol: `docs/KILL-SWITCH-DRILL.md`.

## Known limits — recorded, not hidden

* **12 limitations are permanent on this plan.** Branch protection and auto-merge require
  GitHub Pro for private repositories; the six private repositories cannot have either until
  the plan changes. The worker records them once per run instead of retrying.
* **`two_factor_requirement_enabled` cannot be set over the REST API** on this plan — `PATCH
  /orgs/QNFO` accepts the field and returns 200 without applying it. It needs the web UI.
  (The owner account itself has 2FA enabled; the org requirement is simply not enforceable.)
* **Token.** Repository settings need `administration: write`, which the `qnfo-fleet` GitHub App
  does not have and cannot be granted through the API. This worker therefore holds the fleet's
  personal token for administration work only; content and workflow operations elsewhere in the
  fleet use the App installation token (`github_app_token_ok=1` since 2026-10-17).


## Portfolio, programs, projects and roadmap (PORTFOLIO-SYNC-1, 0.4.0)

Runs on the same 10-minute tick, right after TRACKER-SYNC-1. D1 `qnfo-audit` is authoritative; GitHub is the mirror.

| D1 (source of truth) | GitHub (QNFO/qnfo-workers) | Rule |
|:--|:--|:--|
| `programs` | labels `program:research|infra|ops|reach|personal` | fixed map, created if missing |
| `projects` (`source='derived'`) | milestone `<project_code> · <name>` | one per live worker (`W.<worker>`, from `service_registry`) and per active public non-fork repo (`R.<repo>`, from `portfolio_repos`); retired with its source, milestone closed |
| `issue_project_map` | issue milestone + `kind:fix|enhancement|research|owner` | every open mirrored `agent_issues` row is placed by triage owner, then source |
| `roadmap_implementation` | issues labelled `roadmap`, `[RM-<id>]` | open items mirrored; closed with evidence when D1 verifies; a hand close is reopened |
| `v_metric_trigger_state` hit=1 | roadmap objective `RM-METRIC-<metric>` | opened on breach, verified with the measured value when it clears |
| (all of the above) | org Projects v2 board "QNFO Fleet Portfolio" | best effort; failure is a recorded limitation |

Graded by `v_portfolio_drift` -> metric `portfolio_drift` (target 0, trigger -> agent_issues).
Routes: `GET /roadmap` (public tree; personal projects counted, never itemised), `GET /portfolio` (last tick),
`POST /portfolio/tick` (x-steward-key). Safety: per-tick caps, a degenerate census (<10 rows) never retires a project,
a failed or anomalous GitHub list changes nothing, legacy hand-written projects are never auto-retired.
