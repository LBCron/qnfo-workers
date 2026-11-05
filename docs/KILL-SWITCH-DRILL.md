# Kill-switch drill protocol (BP26-LEASES-KILLSWITCH-1)

Charter pillar: autonomy. Practice (BP26 catalogue item 3.5, OWASP ASI08 and ASI10): a global kill-switch flag every loop reads, exercised monthly, with the
proof that every loop stopped and then resumed. Metric `kill_switch_test_age_days` (target 30 or fewer) reads the newest row of `kill_switch_tests` with
`mode = 'live'` and `outcome = 'pass'`; it stays UNMEASURED while no such row exists.

## State read on 2026-10-26 (what exists, what does not)

- No global kill switch exists. `ops_config` holds no key with halt, pause, kill, freeze, panic, emergency, stop, circuit or breaker in its name, and
  `pipeline_flags` holds one per-loop flag only: `social_paused` (qnfo-social). A drill today would have nothing to flip, so no honest age exists and none is
  written (a number made up to look measured is the failure this metric guards against).
- Exists and stays: the loop breaker (LOOP-BREAKER-1, `scripts/loop_breaker_runner.py`: a signature that repeats 3 times in 24 h files an issue), the deploy and
  secret locks, the work-claim ledger (expired claims are closed by qnfo-deploy-guard 1.3.34, PR 4729), the per-loop budgets of `fleet_budget`.
- Missing and owned (code-tasks in the issue): the flag and its readers, fencing tokens on the leases, per-iteration caps, the monthly schedule.

## The switch to build (contract)

`ops_config.fleet_kill_switch` with value `off` (default) or `on`, read by a single helper per worker (`killSwitchOn(env)`, one D1 read cached for 30 s).
While `on`:
1. no external side effect starts: publish, send (mail, post, DM), deploy, merge, secret write, paid model call outside the cheapest free model;
2. reads, probes, metric refreshes and the heartbeat keep running (the fleet must be able to see itself and to turn the switch off);
3. work in flight finishes its current step and stops at the next step boundary, recording `kill-switch observed` (a `cloud_ops_events` row of kind
   `kill-switch.observed` carrying the loop name) once per loop per switch change.
Readers to cover first, in order of blast radius: qnfo-ops (tool executor and `/ops/deploy`), qnfo-code-orchestrator (the code loop), qnfo-fleet-control
(every tick loop), qnfo-social, qnfo-email-orchestrator, qnfo-research-exec, qnfo-cloud-ops (dispatchers), qnfo-github-steward.

## The drill (monthly, fleet-run, never by a session)

A drill pauses live loops for at most 10 minutes. That is a reversible fleet decision (DECISION-AUTOPROCEED-1): it is recorded in `decision_log` with its revert
path before it starts, and the fleet runs it, not an owner step.

Preconditions: no deploy lock held (`deploy_locks` empty of live rows), no publication SLA window open (the q08 desk window around 09:00 CET), the audit
chain verifies (`audit_chain_verify` = 1), `loops_expected` read from `GET https://qnfo-fleet-control.q08.workers.dev/loops` (LOOP-WATCH-1).

1. T0: set the flag to `on` (one write by the fleet, through qnfo-fleet-control or the qnfo-ops tool, never by hand in D1).
2. By T0 + 2 ticks (10 minutes at most) every expected loop must show a `kill-switch.observed` event, and `agent_actions` (BP26-AUDIT-LOG-1) must hold no row of kind
   publish, send, deploy or secret-write with a time after T0 + 2 ticks: the audit log is the evidence that nothing acted.
3. T1 (at most T0 + 10 minutes): set the flag to `off`.
4. By T1 + 2 ticks every loop must show a heartbeat newer than T1 and a normal tick result: resumed.
5. One append-only row in `kill_switch_tests`: `flag`, `mode = 'live'`, `loops_expected`, `loops_observed_stopped`, `loops_observed_resumed`, `outcome`
   (`pass` only when both counts equal `loops_expected`, otherwise `fail`), `evidence` (the event ids and the count of side-effect rows after T0).
6. A `fail` files one `agent_issues` row per loop that did not stop or resume, with a `code-task:` line for its worker; the next drill is due within 7 days.

Rollback at any point: set the flag to `off`. If the flag cannot be written, the loops' own breaker and the deploy-guard lease expiry (30 to 120 minutes) bound the
damage; a failed write is itself a `fail` row.

Dry-run mode (`mode = 'dry-run'`) reads the flag in every reader without flipping it and records the reader count; it never counts toward the metric.

## Why the metric is not given a number today

`kill_switch_test_age_days` is "days since the switch was last exercised and every loop was seen to stop and resume". With no switch there is no last exercise, so the
value is undefined, not zero. `scripts/bp26_auditchain.py` writes nothing for it, records the reason in `bp26_probe_results`, and the practice issue stays open with the
build tasks above until a live drill passes and the first row exists.

## Update 2026-10-28 (BP26-LEASES-KILLSWITCH-1)

The switch now exists: `ops_config.fleet_kill_switch` (`off` by default), read by qnfo-deploy-guard 1.4.0 (work claims, renewals, deploy and secret leases answer 503 `kill-switch`; event `kill-switch.observed`). The drill is the cf-ops-actions action `kill-switch-drill` (scripts/cf_ops_actions.py): it holds the switch on for under 10 minutes, checks the refusals and the event, restores it in every case, checks resumption and appends a `kill_switch_tests` row. Its evidence lists `readers` (covered) and `readers_pending`; the loops named above other than qnfo-deploy-guard are pending (roadmap row `ROADMAP-1: QNFO.OPS BP26-KILLSWITCH-READERS-1`). Design and limits: docs/LEASES-FENCING.md.

## Update 2026-11-05 (BP26-KILLSWITCH-READERS-1, one worker per change; BP26-KILLSWITCH-CAPS-1)

Readers, in the order they were taught the flag. Each is added to `KS_READERS` in `scripts/cf_ops_actions.py` in the change that teaches its worker to read the flag. The drill is a monthly, fleet-run action (workflow_dispatch of cf-ops-actions), never part of a deploy, so the deploy has landed before it runs; qnfo-github-steward was added after `/health` showed 0.17.0 live.

| Reader | Version | What stops while the switch is `on` | What keeps running | Evidence the drill reads |
|:--|:--|:--|:--|:--|
| qnfo-deploy-guard | 1.4.0 | new work claims, deploy and secret leases answer 503 `kill-switch` | releases, reads | the 503s and the `kill-switch.observed` event |
| qnfo-code-orchestrator | 0.48.0 | the code loop tick: intake, planning, every step and every model call | the heartbeat of the scheduled handler | `kill-switch.observed` (job `qnfo-code-orchestrator`, one per 5 minutes), no `code-task.*` event inside the window |
| qnfo-github-steward | 0.17.0 | scheduled runs: GitHub issue, comment, label and project writes, repository settings, the billing read | `POST /tick` and the keyed routes (a person's explicit request) | `kill-switch.observed` (job `qnfo-github-steward`), a `cron_fire_log` row per grid fire |

Both new readers read the flag once per tick or run (cached 30 s) and **fail open**: an unreadable row is `off`, logged as `failed_open`, never a stop. Not yet gated, each with its reason:
the fleet-exec member inside qnfo-code-orchestrator (its fleet_tasks mix internal D1 steps that must keep running, such as metric refresh and red-drain, with external ones, so it needs a
per-step gate, not a whole-member stop); qnfo-fleet-control, qnfo-ops, qnfo-social, qnfo-research-exec, qnfo-cloud-ops (large or contended files, one worker per change).
An event-observed reader is a worker whose tick is a cron, not a request, so the drill reads its events instead of sending it a probing call: stopped when a `kill-switch.observed` event for
its job is newer than T0, resumed when its heartbeat or `cron_fire_log` row is newer than T1 plus the 30 s cache with no new observed event.

### Per-iteration caps and the circuit breaker (BP26-KILLSWITCH-CAPS-1, qnfo-code-orchestrator 0.48.0)

The code loop already capped steps per tick (`maxSteps`), wall-clock per tick (`budget_ms`, the lane budget), lanes, the daily call count and the daily neuron budget (`spendGate`; a breached cap
steers to cheaper models and never stops work, BUDGET-SOFT-ROUTE-1), repeated failure signatures (LOOP-BREAKER-1, FAIL-SIGNATURE-STOP-1) and file claims. What was missing is a loop-wide pause
after a run of failures. `CODE-LOOP-BREAKER-1`: N consecutive failed steps across ticks (a success resets the run; a step deferred behind another session's claim counts as neither) pause the
loop for a bounded time, record `code-task.breaker-tripped` and file one `agent_issues` row (deduped against the open one). Switches in `ops_config`: `code_loop_breaker` (`on` default, `off`
disables), `code_loop_breaker_n` (default 30, bounds 5 to 200), `code_loop_breaker_pause_min` (default 30, bounds 5 to 240), `code_loop_breaker_state` (written only on change; delete the row
to reset). A paused loop runs no step and no plan, keeps its sweeps and heartbeat, and resumes by itself when the pause ends.
