# qnfo-fleet-control

Canonical source for the merged fleet-control hub worker (advisors + calibrator + deploy/drift).

- Deploy method: Cloudflare API `PUT /accounts/{acct}/workers/scripts/qnfo-fleet-control/content`
  with multipart `metadata={main_module:"worker.js"}` + `worker.js` part **including filename="worker.js"**.
  This preserves all 23 existing bindings (verified 2026-09-12).
- Do NOT deploy via wrangler: it would drop the script-API-managed bindings (BINDING-PRESERVATION-1).
- Deployed version: 0.4.11 (qnfo-fleet-deploy / drift scanner).

## JOURNEY-CLOSE-CONTRACT-AWARE-1 (source 0.58.1-journey-contract)

When a journey recovers, `jrnIssue` calls the shared `closeBlockedByContract`
helper with the actual audit database before writing close evidence or closing
its issue. A failing remediation contract keeps both the issue and its existing
evidence unchanged; closure can proceed after the contract passes. The journey
probe still runs, so a close guard does not hide operational recovery or stop
subsequent verification. Canonical deployment and live closing-probe evidence,
not the source version, establish rollout.

## BREACH-DOCTOR-1 (0.52.0, reviewed in 0.53.0 BREACH-DOCTOR-FIX-1; pillar autonomy; agent_issues 1000266)

`breachDoctorTick` (block `BREACH-DOCTOR-1` in `worker.js`) runs on every `*/10` tick. It is worker code, not a D1 trigger on `fleet_tick`
(FLEET-TICK-SPLIT-1). Per tick, in this order: the five `doctor_*` / `breaches_*` metrics are written first (a dead heartbeat cannot hide);
each enabled `breach_playbooks` row is validated; the verify phase settles the cases in flight (two consecutive passes of `verify_sql` are
verified; a failed verify, an SQL error or an expired lease is failed); every open issue older than `breach_doctor_min_age_min` (60 minutes since 0.53.0,
so a case has the rest of the 120-minute SLA-120M-1 window to be applied and verified twice) with no doer (a `code-task:` line, a live code task or a live work claim) is classified into `breach_diagnoses` (family from a code
table of title prefixes, `cause_class` from the playbook that matched or `unclassified`, facts from numbers, ids and enum codes only), critical first,
up to `breach_doctor_max_cases`; a case whose playbook is `on` and older than the cooldown applies its action (revert stored in the ledger,
a `decision_log` row, a `breach_diagnosis_events` row). One tick at a time (`loop_lock` k = `breach-doctor`, 4 minutes). On live D1 a tick reads
about 10,500 rows (the largest statement 4,023; it never reads `v_issue_age_ladder`).

### Switches (all in `ops_config`, read by `bdConfig()` at the start of each tick; bounds are clamped)

| key | default | meaning |
| --- | --- | --- |
| `breach_doctor` | `on` | `off` returns before any write (the kill switch); `measure` (also any missing or unreadable value) diagnoses and records the would-do, acts on nothing; `on` acts |
| `breach_doctor_ai` | `off` | reserved: v1 makes no model call |
| `breach_doctor_max_cases` | `40` (1..60) | issues classified per tick; the 263 unowned issues of 2026-10-26 drain in 7 ticks. Over the cap waits for the next tick (backpressure, never a stop) |
| `breach_doctor_max_actions` | `6` (0..20) | state-changing actions per tick; the rest are deferred |
| `breach_doctor_budget_ms` | `20000` (5000..40000) | wall budget per tick; no new case starts after 85% of it |
| `breach_doctor_min_age_min` | `60` (10..120) | an unowned open issue becomes a case from this age in minutes (no SLA exceeds 120 minutes; control `breach-doctor-age-gate`). `breaches_undiagnosed_over_60m` flags 60 minutes past it and never later than 120 |
| `breach_doctor_playbook_cooldown_min` | `30` (0..120) | a playbook younger than this (from `breach_playbooks.created_at`) runs in measure |

Per rule: `UPDATE breach_playbooks SET enabled = 0 WHERE rule_id = '...'` stops one rule; `mode = 'measure'` keeps it diagnosing only; a rule with 2 failed or
reverted cases in 24 hours demotes itself to measure (event `demote`, note `demoted <time> ...`). The demotion is a pause with a release (control `breach-doctor-auto-demotion`):
`BD_RELEASE_MIN` (60) minutes later the engine sets the row back to `on` as a trial (note `trial <time> ...`, event `selected` with `release=trial`) that runs one case at a time, and none while
a case of the rule is in flight; a failed trial case demotes the rule again, a verified one restores it (note `restored <time> ...`, event `selected` with `release=restored`) and lifts the cap.
Failures count from the last change of the rule's standing, so a restored rule is not demoted again for the failures that paused it. A rule an operator set to measure by hand (no `demoted` note) is
never released. An action that changes no row on an issue that is no longer open (ISSUE-HYGIENE-1 closed it first) supersedes the case instead of failing it. The contract
`fm-breach-doctor-rule-latched` files an issue when a demotion outlives 120 minutes (the release did not run). Per-rule `max_per_tick` and `max_per_day`
defer, never stop. The strike cap is in code, not in `ops_config`: an issue whose last case failed is retried after `BD_RETRY_MIN` (60) minutes, after `BD_STRIKES` (3) failed or
reverted cases at most once in `BD_STRIKE_RETRY_MIN` (120) minutes, and the self issue `BREACH-DOCTOR-1: self <rule> <code>` is filed once (control `breach-doctor-strike-cap`:
a rate with a release, never a permanent exclusion). The self issue is the only issue the doctor files by itself.

### Add a playbook (a migration, never a code change)

An `INSERT OR IGNORE INTO breach_playbooks (...)` in a migration; `migrations/2026-10-26-breach-doctor.sql` (CM-R1, CM-R2, CM-R3, CM-R5) is the shape. Columns:

- `rule_id` (primary key, `[A-Za-z0-9][A-Za-z0-9_.-]{1,40}`), `version`, `family` (the family it serves, `*` for a generic row), `cause_class` (a token such as `duplicate-exhaustion`, not `unclassified`),
  `action_kind` (`sql`, `file-issue` or `owner-card`: the kinds are closed in code), `min_ladder` (stored, not read in v1), `max_per_tick`, `max_per_day`, `enabled`, `mode` (`measure` or `on`), `note`.
- `trigger_sql`: one read-only SELECT (or WITH ... SELECT, no semicolon, no write keyword) that returns `issue_id`, `subject` (a token) and `facts_json` (an object of numbers, ids and enum codes).
- `action_sql` and `revert_sql`: JSON arrays of 1 to 6 statements (use `json_array('<statement>', ...)`). Each statement is exactly one INSERT or UPDATE on `issue_triage`, `agent_issues` (UPDATE only),
  `remediation_contracts` or `issue_plans` (`ops_config`, which holds the kill switch and the trusted-source list, and `human_actions` are not writable by a playbook); it binds `?1` = the issue id and no other placeholder,
  and carries a top-level `id = ?1`, `issue_id = ?1` or `a.id = ?1` predicate (an `INSERT ... SELECT ... FROM agent_issues a WHERE ... AND a.id = ?1` for an insert) with no `OR` beside it outside parentheses
  (`bdWriteWhy`: `no-id-predicate`, `or-widens`; a predicate hidden in a subquery does not count). That is the whole of what "bound to the issue" means; the decision_log row says the same; no semicolon, no DELETE, DROP, ALTER, CREATE, PRAGMA or ATTACH,
  no `INSERT OR REPLACE`, no INSERT into `agent_issues` or `code_tasks`, and no reference to a free-text column or table (`description`, `exceptions_json`, `detail`, `meta`, `last_error`, `worker_logs`, `cloud_ops_events`).
  A `file-issue` or `owner-card` row carries `[]` for both.
- `verify_sql`: one read-only SELECT (it may bind `?1` = the issue id) that returns `expected` and `observed`; equal text is a pass, and two consecutive passes verify the case.
- The 30-minute measure cooldown: a new row is `on` in the file but runs as measure (the would-do diagnosis only) until `created_at` is `breach_doctor_playbook_cooldown_min` old, so the engine shows what it would
  change before it changes it. Changing a row with an UPDATE does not restart the cooldown; a rule that changes what it does ships under a new `rule_id`.
- A row that fails these checks is not run: the engine skips it, writes a `taint-drop` event (once an hour per rule and reason) and counts it in `doctor_taint_violations_24h`.

### The taint rule

Free text never flows into an issue, a probe, a task or a prompt. The engine reads free text (an issue body, a plan reason, `cloud_ops_events` text) only to turn it into an enum code;
playbook SQL may not name those columns; every fact value must be a number, an id or a token (`bdFactsSafe`); a fact that is prose is dropped as a `taint-drop`. The issues the doctor
files hold playbook constants, ids, counts and enum codes only, which is why `migrations/2026-10-26-breach-doctor-trust.sql` may add the single pair `qnfo-fleet-control|BREACH-DOCTOR-1:` to
`ops_config code_merge_trusted_sources` (backup key `code_merge_trusted_sources--bak-20261026T0800Z`; before it applies the doctor's issues say `Doer: none yet`).

### The gap: `playbook-gap` is in measure

The generic `playbook-gap` row is seeded in `measure` and files no issue: a gap issue carries no `code-task:` or `code-anchor:` line (the lever for a family is a new playbook row by migration, not an edit of an
existing file), so it would only add an unowned issue. The gap is recorded instead, by family: every case of an unmatched family is a `breach_diagnoses` row with `cause_class = 'unclassified'`,
`v_breach_doctor_status.gap_by_family` lists the largest families, and `breaches_undiagnosed_over_60m` keeps counting those issues until a playbook finds their cause or they get a doer. To turn gap filing on (control
`breach-doctor-gap-measure`, reviewed by 2026-11-02): `UPDATE breach_playbooks SET mode = 'on' WHERE rule_id = 'playbook-gap'`, by migration with its `decision_log` row. Armed, it files one
`BREACH-DOCTOR-1: playbook gap <family>` issue per family per 24 hours, never for OWNER-CHAT, OWNER-REQUEST, other or BREACH-DOCTOR-1 (`BD_GAP_SKIP_FAMILIES`), and none while 3 gap issues are open (`BD_GAP_OPEN_MAX`).

### What the metrics mean

`breaches_undiagnosed_over_60m` counts an unowned issue once it is `min(120, breach_doctor_min_age_min + 60)` minutes old (120 by default) until a case found its cause (a playbook matched); an issue classified `unclassified` was only looked at and stays counted, so classifying the backlog
does not make it read 0. `breaches_auto_remediated_24h` (cases that reached `verified`) is the outcome the doctor has to earn. Issues titled `BREACH-DOCTOR-1:` are classified and counted like any other
(family `BREACH-DOCTOR-1`) but match no playbook and take no action (control `breach-doctor-own-issue-guard`). The five metrics are mapped to a root cause in `metric_breach_cause` by the same migration.
A case in `queued`, `applied` or `verifying` with an expired lease is failed by the verify phase (`lease-expired`); `queue_sla` row `breach-doctor-case-in-flight` and the contract `fm-breach-doctor-case-age`
watch the oldest one (120 minutes), which also covers `breach_doctor = off`, where no tick writes.

### Read it

- `SELECT * FROM v_breach_doctor_status;` one row: `mode` and `ai` (the switches), `last_tick_at`, `cases_24h`, `verified_24h`, `failed_24h` (failed or reverted), `in_flight` (queued, applied or verifying),
  `lease_expired` (in flight past its lease: the next tick fails them), `taint_drops_24h`, and the gap: `unclassified_cases`, `gap_families` and `gap_by_family` (`FAMILY:count`, largest first, at most 12).
- `SELECT family, cause_class, state, mode, COUNT(*) FROM v_breach_diagnosis_current GROUP BY 1, 2, 3, 4;` the current case of each issue; `SELECT * FROM v_breach_owner WHERE owner_kind IS NULL;` the open issues nobody owns.
- `SELECT ts, event, issue_id, from_state, to_state, detail FROM breach_diagnosis_events ORDER BY id DESC LIMIT 50;` the ledger. `event` is one of `tick` (one per tick; detail `mode=... rules=... hits=... diagnosed=... acted=...
  verified=... failed=... demoted=... taint=... gap=... undiagnosed=... deferred=... err=... ms=...`), `diagnosed` (`rule=<id> cause=<class> mode=<measure|on> would-do=<kind>` or `unclassified family=<F>`), `action`, `verify`, `renew`,
  `handoff` (an owner card), `fail` (`rule=<id> error=<code>`: `sql-error`, `no-rows`, `validation`, `verify-failed`, `verify-error`, `lease-expired`), `supersede` (the issue closed or gained a doer), `skip` (a live work claim),
  `budget-skip`, `demote` and `taint-drop` (`rule=<id> why=<code>`). A tick that did not run leaves no `tick` event: `doctor_tick_age_min` and the contract `fm-breach-doctor-stalled` read that.
- Offline suites: `node qnfo-fleet-control/breach-doctor.test.mjs` (the engine over a node:sqlite D1 stub), `node migrations/breach-doctor.test.mjs`, `node migrations/breach-doctor-fix.test.mjs` and `node migrations/breach-doctor-trust.test.mjs`.

## ADVISOR-AGENT-TRACING-1 (0.46.0, pillar autonomy)

The folded advisor is a custom application-owned harness, not an AI SDK/Think/Flue agent.
Each audit that actually calls a model creates one `invoke_agent qnfo-fleet-advisor` span,
with nested `chat <model>` spans for the proposal and each review. Cached advice, audits
without findings, and audits without an AI binding create no agent spans. Both HTTP and
scheduled entry points share this instrumentation in `runAudit`.

Workers custom spans carry the shared agent name `qnfo-fleet-advisor`, stable agent ID
`qnfo-fleet-control/advisor`, and a fresh opaque UUID per audit turn. Content is **metadata
only**: no messages, prompts, instructions, tool payloads, results, or secrets are attached.
Existing trace sampling remains `0.1` (10%); log sampling remains unchanged. No router or
other fleet Worker is instrumented by this change.

Run `node qnfo-fleet-control/agent-tracing.test.mjs` for offline coverage of nesting,
identity, privacy, cache skips, and failure behavior. A Wrangler dry run validates the
bundle but does not deploy or prove live trace ingestion; the Agents dashboard needs a
sampled advisor turn after a separately authorized canonical deployment.

## 2026-09-12 change (self-heal wiring)
`scan()` now writes a row to `self_heal_actions` (qnfo-audit D1) for every
`drifted` / `stale-canon` / `health-ver` finding, with a `status`
(healed|failed|deferred|detected) and `verified_at`. Replaces a count-and-skip
path that re-observed the same unhealed problems every cycle.

## PROFILE-CLAIMS-SCRUB-1 (0.4.79, 2026-10-01, pillar reach)

When PORTFOLIO-LOOP-1 writes `QNFO/.github/profile/README.md`, it first applies `PF_PROFILE_SCRUB`: exact
`[from, to]` pairs that replace the hand-written claims the public record does not support (the $10M NHTS
"co-directed" line, a patent line with no application numbers, "predictive analytics at Deloitte and Publicis", Empowering
Change as QNFO's current 501(c)(3), "scientific research incubator", stale record counts, a duplicated ledger row) and
swap the theory-first publication list for the STRATEGY-1 s2.4 selected works. Each pair is a no-op once applied;
drifted text is left alone. Tests: `portfolio.test.mjs` (scrub section).

## CODE-TASK-MERGE-RUNNER-1 (0.4.86, 2026-10-02, pillar autonomy, agent_issues 1726)

The hourly cron (`5 * * * *`) runs `codeMergeTick`: it opens and merges the code loop's pull requests
(qnfo-code-orchestrator + `scripts/code-task-publish.py`, table `code_tasks`), so no person sits between a verified patch
and main. It reuses EVOLVE-PR-1's GitHub token, squash merge pinned to the tested head (`evMergePr`), deploy ledger
(`evDeployRow`), live check (`evLiveCheck`) and revert pipeline (a revert is an evolve `revert` candidate that `evAdvance`
merges and verifies).

- **Opening**: a PR opened with the Actions `GITHUB_TOKEN` starts no `pull_request` workflow, and `code-task-publish.yml`
  holds no other GitHub credential. So the workflow pushes the branch and stops at `branch_pushed`
  (`CODE_TASK_PR_OPENER=qnfo-fleet-control`), and the runner opens the PR with the fleet token, so CI starts by itself. It
  opens only a branch that passes the verify, scope, provenance and integrity gates (CI runs the PR's code); an existing
  PR for the branch is adopted; a branch that fails a gate is `needs_human` with the compare URL kept.
- **Merge candidates**: `code_tasks` rows with status `published` or `pr_open`, branch `codeagent-<id[3:15]>`, and a
  `QNFO/qnfo-workers` pull URL whose head is that branch, based on `main`.
- **Merges only when all hold**: the orchestrator's verify passed (`step='done'`, `attempts<3`, no `last_error`, patch or
  proposal stored); the PR changes exactly the task path (plus the deployed-current mirror for a `worker.js`); the path is
  a `worker.js` outside `CM_DENY` without `[[containers]]`, or a Markdown doc; the source issue is a trusted origin
  (`CM_TRUSTED_SOURCES`, overridable by `ops_config.code_merge_trusted_sources`); each file at the head equals the
  verified patch applied to the merge base; a `worker.js` is auto-revertible; every required check (gate, mirror-guard,
  comparator, plus guard / charter / test where they run) ended `success` on the head, no other check failed or runs;
  the PR is open, not draft, mergeable. One merge per tick; never while the same worker has a change in flight.
- **No checks**: no required check on a head 3h after the runner first saw it is a refusal (for example an older PR
  opened with the Actions token). Nothing is pushed to start CI.
- **Refusal**: status `needs_human`, `last_error` `merge-runner: <reason>`, and a comment on the PR when there is one.
- **After a merge**: `merged_by='qnfo-fleet-control'`; a `worker.js` must show a `fleet_deploys` row for its new VERSION
  within 3h and a later `worker_live_audit` http 200 with it, otherwise the inverse patch is opened as a revert PR.
- **Kill switch**: `ops_config.code_merge_runner_enabled` (`0`/`off` stops opening and merging; absent means on).
  Heartbeat: `cloud_ops_events` `code-merge-tick-<UTC day>`, plus `code-merge-first-ok` written once on the first ok
  tick; each action is one `cloud_ops_events` row `code-merge.<action>`.
- **Routes**: `GET /code-merge/status` (public), `POST /code-merge/tick` (admin token).
- **Watchmaker**: qnfo-fleet-dashboard 1.16.4 counts `code-task-merge` only when the runner is stalled or disabled or
  leaves work for a person (a person's merge or close counts only after `code-merge-first-ok`). Tests:
  `code-merge.test.mjs` (deploy-gate, Node 22).

## IMPROVEMENT-LOOP-1 (0.4.87, 2026-10-02, pillar autonomy)
Owner directive: measure internal and external performance systemwide and keep improving against it. The fleet already
measured (metric_registry) and filed off-target graded metrics (METRIC-TRIGGER-LOOP-1, OBJECTIVE-CONSTRAINTS-1). It could
not tell whether anything was getting better. The hourly tick now:
- writes `metric_history` (one row per metric per UTC day: value, met target or not);
- compares each metric's 7d mean with the prior 7d in its good direction (from the target: `<=` down, `>=`/`+N`/`maximize`
  up) and files `METRIC-REGRESSION-1: <metric>` on a >= 15% worsening, including `maximize` metrics that have no trigger
  (pageviews, referrals, impact per dollar); it closes itself, with hysteresis, when the decline stops;
- re-checks metric issues closed in the last 30 days and files `METRIC-FIX-RELAPSED-1: <metric>` naming the issue whose
  remediation did not hold. A `METRIC-TRIGGER` issue closes when its trigger predicate clears (TRIGGER-RECOVERY-1), so since
  0.39.0 (IL-RELAPSE-TRIGGER-1) a relapse is that trigger hit again on a day after the closure; a metric that only misses a
  stricter registry target with the trigger clear is an early warning (no issue, listed in `GET /improvement`
  `target_misses`). A closure with no readable or no enabled trigger (a constraint breach, a deleted or disabled trigger) is judged on the target;
  `ops_config il_relapse_trigger_judge = off` restores the target judgement for every closure without a deploy;
- grades itself in `metric_registry`: `improvement_rate_7d` (>= 0.5), `metric_regressions_7d` (<= 1), `fix_hold_rate_30d`
  (>= 0.8, closures judged by the trigger predicate), with seeded triggers so a loop that stops improving things files its
  own issue, and the guard `fix_target_hold_rate_30d` (the same closures judged on the registry target; trended, no threshold
  trigger by design) so the relapse rule cannot hide a metric that is off target.
Unknown is never a finding (4 daily points per window, so about 10 days of history before the first verdict). One issue per
metric: a finding already carried by an open trigger or constraint issue is not filed twice. At most 3 new issues per tick.
Read: `GET /improvement`. Run now: `POST /improvement/tick` (admin token). Ledger: `improvement_loop_runs`. Suite:
`improvement.test.mjs` (pure half plus the tick on an in-memory D1 with the live integrity and close-evidence triggers) and
`improvement-relapse-trigger.test.mjs` (trigger-judged relapse against the gateway_cap_30d_usd and server_side_close_share_7d fixtures).

## VERIFICATION-PATH-1 (0.38.0, 2026-10-19, pillar autonomy; agent_issues 2953, 2954)
`rtReopenOnRelapse` starts its failure window at the issue's newest `issue_lifecycle` close event (event dispositioned or closed that landed
on closed or resolved), not at `agent_issues.updated_at`, which every annotation of the row moves; an issue with no lifecycle row keeps the old
anchor. `remediation_contracts.deferred_since` (migrations/2026-10-19-contract-deferred-since.sql) is stamped when a contract first reads
deferred and cleared by any real verdict; a deferral older than 7 days files one deduped `VERIFICATION-DEFERRED-7D-1: <class>` issue that quotes
the pending reason as the unblocker and closes itself when the contract reads a verdict or is parked. The sweep is bounded: 3 issues a tick, 12 in
any 24 hours, oldest first. Revert switches, no deploy: `ops_config rt_close_event_anchor = off` (window back on updated_at) and
`ops_config rt_deferral_escalation = off` (no escalation issues; the stamp keeps running). Suite: `verification-path.test.mjs`.

## SURFACE-METRICS-1 (0.4.88, 2026-10-02, pillar reach)
`IL_SURFACES` lists public surfaces that publish aggregate metrics. Each improvement tick reads them into `metric_registry`
(seeded idempotently past the integrity triggers, target `maximize`), so they get history, trends and regression issues.
First surface: iPatent (`https://ipatent.qnfo.org/api/metrics`): human views, search visits, crawler hits, drafters (7d).
An unreadable surface writes nothing.

## FLEET-RUN-RATE-1 (0.4.90, 2026-10-02, pillar cost)
`cost_usd_30d` ($450, target $200) is list cost over 30 days across all providers, dominated by spend no worker can move:
a one-off gpt-5.5 session burst on 2026-09-26 (about $198, ages out about 2026-10-26) and the owner's own desktop client
on BYOK DeepSeek (about $167). `fleet_ai_run_rate_30d_usd` is the fleet's own live AI cost projected to 30 days from the
last full days of data (attributed Workers AI neurons above the free 10k/day at $0.011/1k, plus qnfo-ai router spend on
other providers). Proposed target <= $15; its trigger names the top neuron consumer as the lever. Refreshed by the
improvement tick; tested in `improvement.test.mjs`.

## REACH-IDEATION-1 (0.4.93, 2026-10-02, pillar reach)
Owner directive: "the fleet shall ideate and shall build all next automatically". Once a UTC day the hourly tick probes
QNFO's public surfaces (qnfo.org home and work-with-me, papers index and the latest paper, iPatent home, guide and example,
ideas.qnfo.org) with nine reach checks (share image, canonical, structured data, description, author credit, contact path,
flagship link, subscribe box, speed) and a content-gap catalog (planned iPatent guide pages). Each failing check is one
deduped `REACH-IDEA-1: <check> on <surface>` issue (at most 3 new a day, buildable first), naming the worker file and the
metric to move. qnfo-code-orchestrator's planner trusts the prefix (0.3.10), so buildable ideas become code tasks and ship
through the merge runner. Ideas on deny-listed control-plane workers (qnfo-gateway) are filed as "not auto-buildable".
The next run closes an issue with evidence when the live page passes. Read: `GET /reach-ideas`; run now:
`POST /reach-ideas/tick` (admin). Ledger: `reach_idea_runs` (WATCHMAKER_OPS `reach-ideation`). Suite: `reach.test.mjs`.
Dry run on 2026-10-02 against the live pages: 26 ideas (14 buildable, 12 on qnfo-gateway).

## REACH-IDEATION-2 (0.4.101, 2026-10-02, pillars reach, autonomy)
The first live run (2026-10-02T09:00:45Z: 12 probes, 26 findings, 3 filed) showed four defects. (1) Finite catalog: the
loop now also probes the busiest pages on owned QNFO hosts by Cloudflare RUM traffic (`reach_signals`, 14 days, at most 3,
one per host + first path segment, skipping templates the fixed list covers). fleet.qnfo.org is excluded (operations
dashboard) and so is q08.org (STRATEGY 2.1: a separate publication that never carries the owner's identity). (2) Value
first: findings sort by score; buildable ideas fill the code loop's slots by score and one slot is kept for the best idea
on a deny-listed worker (qnfo-gateway) so the largest gap stays visible. (3) Work-in-progress cap: at most 4 open buildable
and 1 open not-buildable REACH-IDEA issue, and at most 3 new a day. (4) Learning: `reach_idea_outcomes` keeps each idea's
metric at filing, at close and 7 days after close; a check kind with 3+ measured outcomes is weighted x1.25 if its metric
rose and x0.5 if not (confounded by everything else that moved that week: a ranking prior, not a causal claim).
`reach_ideas_shipped_30d` grades the loop end to end (n/a for the first 14 days; trigger in
`migrations/2026-10-02-reach-ideation-2.sql`). `GET /reach-ideas` also returns `outcomes`, `efficacy` and `limits`.
No model call, worker, cron or binding is added: all `fleet_budget` AI caps were in breach on 2026-10-02.

## CF-CHANGELOG-LOOP-1 (0.4.112, 2026-10-03, pillar autonomy)

Once a day, inside the hourly tick, the kernel reads Cloudflare's changelog RSS and acts on it: at most 2 deduped
`agent_issues` a day for billing / deprecation / breaking changes to a product the fleet uses, rejected catalog rows reopened when
their product launches (max 2), `not_considered` rows for unknown products (max 5). No model call, no new worker or cron.
`GET /cf-changelog` is the digest, `POST /cf-changelog/run` forces a run (admin token). Metrics `cf_changelog_audit_age_h` and
`cf_changelog_open_proposals_14d` are registered with triggers in `migrations/2026-10-03-cf-changelog-loop.sql`. Tests:
`cf-changelog.test.mjs` replays real feed items (`cf-changelog.fixture.xml`); the feed shape, not the code, is what changes, so
a feed that stops parsing shows up as `parse-empty` in `cf_changelog_runs` and breaches the age metric within 48 hours.
