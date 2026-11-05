# SLOs, error budgets and automatic postmortems (BP26-SLO-ERROR-BUDGETS-1)

Charter pillar: autonomy. Program QNFO.OPS, project BP26.AGENTOPS. agent_issues 1000357, GitHub 4453. Written 2026-10-28.

## Guidance applied (Google SRE book and workbook, "Implementing SLOs")

- An SLI is a ratio of good events to valid events; an SLO is a target for it over a window; the error budget is `1 - SLO` of the events in the window.
- Spent budget changes behaviour: while it is spent, change that is not about reliability waits. A postmortem is blameless, has a timeline, a root cause and
  actions with owners, and is written for every incident that burns budget or is user-visible.

## What exists

| Piece | Where |
|---|---|
| SLI: one availability sample per public HTML host per runner pass (answer 2xx, 3xx, 401 or 403 in under 5 s) | `scripts/bp26_web.py` > `bp26_probe_results`, subject `avail:<host>` |
| SLO per surface (13 hosts): objective 0.995 over 28 days | `slo_definitions` (migrations/2026-10-28-bp26-slo-budgets.sql) |
| Error-budget state per surface, hourly: samples, bad, attainment, share of budget spent, `ok` / `warn` (50 percent) / `spent` (100 percent) / `immature` (fewer than 200 samples at 0.995, where one failed sample exceeds the whole budget; the share is shown, the flag waits) | `slo_budget_state`, written by `scripts/bp26_slo.py` |
| "Budget spent" signal | `ops_config.slo_budget_spent` (comma list, empty when none) |
| Incidents: availability episodes (consecutive failed samples) and control-plane canary reverts or failures | `incidents` |
| Automatic blameless postmortem per incident: timeline, root-cause class the evidence supports, contributing facts, actions; an episode of two or more samples or on a spent surface files `SLO-POSTMORTEM-ACTION-1 <surface>` in `agent_issues` | `postmortems` |
| Metric `slo_attainment_28d_min` (lowest 28-day attainment, target 0.995 or more) | `scripts/bp26_web.py` (unchanged) |
| Metric `postmortem_coverage` (incidents judged in 30 days with a completed postmortem within 72 h / all, target 1.0) | `scripts/bp26_slo.py` |

## State when this landed (2026-10-28, measured)

`slo_attainment_28d_min` read 0.7273: `travel.q08.org` answered 24 of 33 samples, `qnfo.org` 30 of 33. Those are real failures, and the first pass of the
collector turns each failure episode into an incident with a postmortem. Incidents that closed more than 72 hours before the first pass were not written up in
time, so `postmortem_coverage` can read below 1.0 until they leave the 30-day window; that is the honest reading and is not corrected by backdating.

## Limits and what is next

- Only availability has recorded history. Latency and freshness SLIs (the q08 desk published by 09:00 CET) are not defined yet because nothing records them; they are
  added to `slo_definitions` when a producer exists. The `q08-research-desk-freshness` SLI is filed as roadmap row `ROADMAP-1: QNFO.OPS BP26-SLO-FRESHNESS-1`.
- "The merge lane takes reliability changes only when a budget is spent" is the lane's decision in `qnfo-fleet-control` (claimed by the code loop at the time of writing):
  roadmap row `ROADMAP-1: QNFO.OPS BP26-SLO-MERGE-LANE-1` carries the `code-task:` line; the flag it reads is live.
- Samples are hourly: an outage shorter than the gap is invisible, and the root-cause class is what the sample detail shows (timeout, TLS, 5xx, 4xx), not a human diagnosis.

## Closing an SLO-POSTMORTEM-ACTION-1 issue (SLO-ACTION-RECOVERY-2, 2026-11-05)

- The closing probe (`action_recovery_probe` in `scripts/bp26_slo.py`, class `issue-<id>`, module `slo-action-recovery-1`) reads the last 24 hours of the surface: at least 12 observed samples
  (a not-sampled row, `ok` NULL, is no observation), none failed, no availability incident of the surface still open, and a budget row exists. It does not read the budget state.
- Why not the budget state (the 2026-11-03 version did): `slo_budget_state` is a 28-day figure. It reads `immature` below 200 samples (all 13 surfaces held 167 on 2026-11-04) and `spent` for
  28 days after a single failed sample once a surface holds 200, so a probe on it could not pass inside the 120-minute issue SLA, and REMEDIATION-REOPEN-2 reopened each issue the earlier probe had closed
  ("budget state is not ok" on 1000675 to 1000678 and 1000808), which fed the ROOT-CAUSE-1 ticket 1000892. The budget stays what it is for: the burn figure and `ops_config slo_budget_spent`.
- The collector re-arms the current probe on every open action issue each run (`rearm_open_actions`: one exact-title lookup per surface), so a change to the definition reaches issues whose incident is already complete.
- What the data showed on 2026-11-05: the only real unavailability was `fleet.qnfo.org` (87 of 167 samples over the 5 s limit, 2026-10-29 to 2026-11-04T14:09Z; the server waited, CPU 25 to 158 ms of 12 to 29 s), fixed
  by V3-DASH-1 (dashboard 1.82.0, `/` became a static shell); the other four surfaces had single samples, the `travel.q08.org` ensureTravel cold start (PR 5165, 5175) and not-sampled artifacts (SLO-PROBE-BUDGET-1).
  Side effect to know: `/` no longer exercises the data path, so the availability SLI of `fleet.qnfo.org` cannot see a slow dashboard API (`/api/v3/now`); a data-path sample is the follow-up.
