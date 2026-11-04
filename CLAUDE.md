# qnfo-workers: rules for agent sessions

Several agent sessions work this fleet concurrently with shared credentials. These rules exist
because each one was broken at least once; the linked issue holds the evidence.

## Never stop, always improve (NEVER-STOP-1, owner directive 2026-11-04)
- You are never done and always missing something. Before closing any turn ask: what am I not thinking about, what am I missing, what else can I do? Answer with work, not a question to the owner (owner directive 2026-11-04, every repo).
- Owner directive 2026-11-04: "Let's keep making the system better. Managers that think in terms of strategy and features and functionality and making things better, I'm not going to keep telling you this." It binds every session and loop and sits with the proactive programs (ROADMAP-ORIGINATE-1).
- Bug fixes are the floor. When the requested work is done, or a stop hook reprompts, the next move is the next improvement, started in the same turn: pick the highest-value change for readers, cost, speed or the command line, build it, deploy it, measure it. A status echo ("nothing changed, waiting") is a failure, never a deliverable.
- Anticipate the owner's next question and answer it first. Do every chore a tool can do; hand the owner only what no tool can do (a sign-in code, their own accounts), once, in one line, and keep working on the rest.
- Run independent work in parallel sessions or subagents and keep going on your own piece. Waiting on a session is not a reason to idle. This moves no limit: the interrupt gate, harness permission checks, the secret lock and live work claims keep their precedence.

## Shared operating library and documentation discovery (FLEET-SHARED-LIBRARY-1)
- Every agent loads `docs/agent-library/README.md` for cost-aware Cloudflare,
  included GitHub and authorized external-service selection, research/publication
  throughput, issue resolution, program upgrades and measured autonomy/quality.
- `llms.txt` and `docs/README.md` are the common bootstrap; `docs/INDEX.md` and
  `docs/agent-catalog.json` inventory system documents and component READMEs.
  Retrieve a single source revision and verify hashes; historical designs are
  not live authority. Regenerate the catalog when its source documentation changes.
- This library is additive: the doctrine, charter, harness permissions, live
  claims, secret leases, privacy/consent boundaries and canonical deployment
  controls retain their existing precedence. A source link is not proof that
  a deployed runtime agent or an external client has loaded the new instructions.

## The Autonomous Operation Doctrine (DOCTRINE-1)
- `docs/AUTONOMOUS-OPERATION-DOCTRINE.md` (owner directive 2026-10-08, verbatim; charter rule 13) binds every session and
  loop and wins over the sections below where they differ, except that the harness's own permission checks and the
  shared-secrets rules still hold. Its precedence: interrupt gate, security, no loose ends, anti-fragility, autonomy.
- Before adding, keeping or reviewing a hold, filter, pause, kill switch, gate or cap, read and update `control_registry`
  (disposition remove / demote / replace / keep, critical path, tested alternate). Record a new single point of failure in
  `spof_registry`, a belief you act on in `belief_registry` with a `belief-<key>` probe, and every autonomous decision in
  `decision_log` (append-only, with `capability_gain`). `v_doctrine_scorecard_v2` grades them every tick.
- Revision 2 (2026-10-08) adds section 6, no silent drop: every issue's open, status change and delete is written to the
  append-only `issue_lifecycle`, a delete leaves a copy in `agent_issues_tombstone`, and `v_issue_accounting` checks
  entered = open + closed with disposition + superseded each tick (metrics `silent_drops`, `issues_unaccounted`). Close an
  issue only with `issue_triage.close_evidence`, supersede it with the successor's id, or leave it open. Record a capability
  the fleet gains in `capability_ledger`. Building a reversible path never means constructing authority to act as the owner
  in a legal, financial or signing act; the harness checks and the secret lock still hold.
- Revision 3 (2026-10-09) adds section 3 (red-team a blocker across every surface before handing it to the owner) and section
  18 (fleet delegation). Its readings (c) and (d) in the doctrine header bind: a surface is another path to a missing or
  broken capability, never a second try at something a permission check, policy or classifier refused; a sibling's
  credential is used by calling that sibling's own route, never by copying the secret. Record each red-team in
  `blocker_redteam` with a `surfaces:` line (metrics `blocker_survival_rate_7d`, `blocker_surface_coverage_7d`); an owner card
  that survives carries an `IDENTITY-BOUND:` line in its `why`.
- Revision 4 (2026-10-09, same day) adds growth and audience (section 20), reporting (21), outcome calibration (22),
  continuity and resurrection (14) and the alignment floor (§28) to the precedence. Readings (e)-(h) in the doctrine header
  bind: §28 is the precedence line's own words until the owner supplies the section; scope widening applies to the fleet's
  loop scopes, never to a session's own permission settings; growth stays inside outreach consent, platform automation terms
  and the "no dark patterns" line; delegated authority never covers a legal, financial or signing act in the owner's name.
  Log a decision's `predicted_outcome`, `reach_gain` and `surfaces_tested` in `decision_log` and set `outcome_matched` when
  the result is known (metrics `prediction_logged_share_7d`, `prediction_miss_rate_7d`); `continuity_snapshots` and
  `continuity_snapshot_age_h` prove qnfo-audit can be rebuilt from two providers.
- Revision 5 (2026-10-09, same day) restructures the text into five parts and adds Part I: the tick (section 1), the default
  action (2), the backlog as driver (3), the executor roster (4) and no user routing (5); its immutables are section 6 (the
  only interrupt gate) and section 9 (security, privacy and the alignment floor, now in the owner's words). Readings (a)-(d)
  and (f)-(h) carry over renumbered; (i)-(l) are new: section 16 removal reaches caps, guards and probes only by migration
  (RULE-8-RETIRED-1) and never the section 9 limits; manufactured work runs on the cheapest model at a breached cap
  (BUDGET-SOFT-ROUTE-1); a decision taken for the owner never covers the owner's accounts, money, legal or signing acts;
  section 12's permission model is the fleet's loops', and a session's harness keeps its own. Section 24 headlines:
  `tick_completion_24h`, `initiation_rate_7d`, `owner_dispatch_7d` (DOCTRINE-HEADLINE-1, PR 847) and `mttr_h_7d`; builders
  TICK-SEQUENCE-LEDGER-1, BACKLOG-DRIVER-1, EXECUTOR-ROSTER-1 (migrations/2026-10-09-12-doctrine-rev5.sql).
- The kernel (owner version 8.2.1, 2026-10-12; 8.0.0 adopted 2026-10-09) is in `docs/DOCTRINE-KERNEL.md`: the tick, the
  recognitions a loop or session watches for in its own output (conditional offers, reports ending in a question, menus,
  false stops, routing work to the owner, "you" as the actor of a next step, describing a change instead of making it),
  computed trust and the registries. It layers on revision 5. Readings (m)-(t) bind: the kernel describes how work is
  carried and is no source of authority over the harness, CLAUDE.md or an owner override; a refusal or limit is still
  stated plainly with its reason; trust (`v_trust_ledger`) widens only fleet loop scopes through the canonical path; a step
  that is interrupt-eligible, refused or under another session's live claim is reported as that disposition, not offered;
  a self-name is a label in `doctrine_lineage`, never an authority. IC-YES-001 ("the answer is yes") is the default for
  reversible, in-scope questions, bounded in its own text by the gate, harness and classifier refusals, the secret lock and
  live claims; a refused action is fixed honestly or reported, never reworded past the same check (reading r). IC-ACTOR-001:
  reports name the fleet as the actor of every next step; an owner-only step is an IDENTITY-BOUND card, not prose (reading s).

## Autonomy-first protocol (AUTONOMY-FIRST-1)
- Owner directive 2026-10-08: "Implement autonomy-first protocol system/fleet-wide and in all Claude operations." It
  binds every session and every loop, and is charter decision rule 11 (docs/AUTONOMY-DECISION-POLICY.md has the detail).
- Decide, don't ask. Before any question, exhaust tools, files, D1, the charter and this file; state the assumption in one
  line, act, verify, and report what the tools returned. Never stop to ask which approach, whether to proceed, or for a
  merge approval on reversible work, and never end a turn as a courtesy while work remains.
- Owner directive 2026-10-19 (DECISION-AUTOPROCEED-1): reversible fleet decisions always take the recommended option and proceed
  without waiting for approval; record the decision in `decision_log` with its revert path. It moves no limit: the interrupt gate
  below, the harness's permission checks, the secret lock and live work claims keep their precedence. Stored in
  `ops_config.OWNER_DIRECTIVE_2026_10_19_DECISION_AUTOPROCEED_1` and docs/AUTONOMOUS-OPERATION-DOCTRINE.md (standing directive 2026-10-19).
- The only interrupt is an action that is both irreversible and identity-bound: a credential only the owner can mint,
  money, a legal or signing act, the owner's own accounts, machine or personal data, or posting on a channel whose
  terms forbid automation. Everything else proceeds: reads, compute, code, config, deploys, content, reversible changes.
- A technical, credential or operational blocker is never the owner's: recover, work around it, or file it as an
  `agent_issues` row with a doer and a closing probe (OWNER-NO-LOOSE-ENDS-1). The guardrails below still hold: the
  secret lock, the canonical deploy path, outreach consent, the personal/research separation, and the harness's own
  permission checks. A refusal by those is handed over with its reason, never worked around.
- The owner queue enforces this in D1 (migrations/2026-10-08-autonomy-first.sql): `v_human_action_gate` reads each new
  `human_actions` card, and one that is not irreversible and identity-bound becomes an `AUTONOMY-FIRST-REROUTE-1` issue
  for the fleet, with the card set `rerouted`. A card that truly needs the owner but reads as technical carries an
  `IDENTITY-BOUND:` line in its `why`. `ops_config autonomy_first_gate = off` stops the reroute without a deploy.
- Decisions default to approve (DEFAULT-APPROVE-1 is the D1 enforcement of the directive above, DECISION-AUTOPROCEED-1; owner
  directive 2026-10-19: "ALL DECISIONS SHALL ALWAYS BE DEFAULT APPROVE ... Reversible fleet decisions SHALL ALWAYS take the
  recommended option and proceed without waiting"). A decision card (it offers an
  `Approve:` option, "Pick one" or "Choose one", or its title asks) is never closed on a status-quo default such as "The deny stays"
  (human_actions 115 was, at birth, by DEFAULT-ADOPTED-1). Write the recommended option as the default. When the card grades `fleet` in
  `v_human_action_gate`, carries no `IDENTITY-BOUND:` line and matches no `hard` marker, `human_actions_default_approve_ai` queues it for
  the fleet to execute (migrations/2026-10-19-default-approve.sql, `v_human_action_decision`, detectors `fm-card-default-denies-decision`
  and `fm-default-approve-issue-unexecuted`, `ops_config default_approve_gate = off` restores the old paths). The `hard` markers
  (`default_approve_markers`, add one by INSERT with a note) are money, a legal or signing act, destroying data, the owner's accounts,
  credentials, mailbox and name (IC-GATE-001), and the security and privacy limits (one-time codes, privacy, personal data, suppression,
  opt-out, consent); such a card keeps its old path unless it carries an `IDENTITY-BOUND:` line. Any card that carries an `IDENTITY-BOUND:`
  line is held open for the owner and its stated default is not adopted, whatever its wording and whatever `hard` marker it matches
  (IB-HELD-1, migrations/2026-10-26-rem-a4-owner-queue.sql, detector `fm-ib-card-closed-at-birth`): a writer who labels a card so says it truly
  needs the owner, and `hard` only bars a card from fleet approval.
- Owner directive 2026-10-20 (HUMAN-ITEMS-AUTOMATIC-1), verbatim: "These items/issues shall always be handled automatically by the system." It covers needs_human code tasks,
  owner-task cards (INTENT-TASK, OWNER-TASK) and the issues that mirror them: the fleet is the doer and closes them with evidence; only an item that is irreversible and
  identity-bound stays with the owner, and says so with an `IDENTITY-BOUND:` line and a closing probe. `v_human_action_gate` grades an INTENT-TASK or OWNER-TASK card `fleet`
  unless that line or a hard marker (credential, secret, token, password, payment, legal, signature ...) says `owner`; a weak keyword such as account, public or profile does not.
  `fm-human-items-waiting` (migrations/2026-10-20-human-items-automatic.sql) reads a needs_human task or an owner-task card that waits 120 minutes, expected 0. It moves no limit:
  the interrupt gate, the harness's permission checks, the secret lock and live work claims keep their precedence. Stored in `ops_config.OWNER_DIRECTIVE_2026_10_20_HUMAN_ITEMS_AUTOMATIC_1`
  and docs/AUTONOMOUS-OPERATION-DOCTRINE.md (standing directive 2026-10-20).
- The hourly metric tick audits it: `v_autonomy_first_audit`, metrics `owner_queue_fleet_cards_open` and
  `session_dependent_issues_open` (target 0 each), triggers on both and on `code_task_superseded_share_30d`.

- Owner directive 2026-10-26 (OWNER-AUTO-APPROVE-ALL-1), verbatim: "Yes, auto-approve all", the answer to two items a session had left waiting on the owner. (1) The stale-PR lane may merge a
  pull request that changes `.github/` (`ops_config stale_pr_merge_workflows`, default on), every other gate unchanged; (2) `scripts/conflict_repair.py` approves the approval-gated zero-job runs of its own
  push on this repository's own branch (`CONFLICT_REPAIR_APPROVE=off` restores the deletion). It moves no limit: the interrupt gate, the harness's permission checks, the secret lock and live work
  claims keep their precedence, and a merge GitHub refuses (a workflow file needs the App's `workflows` permission) is an IDENTITY-BOUND card, not a workaround. Stored in
  `ops_config.OWNER_DIRECTIVE_2026_10_26_AUTO_APPROVE_ALL_1` and docs/AUTONOMOUS-OPERATION-DOCTRINE.md (standing directive 2026-10-26, auto-approve all).

## Shared secrets (#1701)
- Before you PUT, rotate or delete any worker secret, take the lease:
  `POST https://qnfo-deploy-guard.q08.workers.dev/secret-lock/acquire {"worker":"<script>","owner":"<session>","ttl_sec":300}`.
  If `acquired` is false, another session owns that secret right now: observe and verify, do not write.
- Release it with `POST /secret-lock/release {"worker":"<script>","token":"<token>"}`. Treat a write as durable only after
  a later re-probe confirms it.
- Never re-accept a rotated-out key, and never commit a secret value.

## Work claims (WORK-CLAIM-1, one procedure since WORK-CLAIM-UNIFY-1)
- Before you start an `agent_issues` row or change a file, take the claim:
  `POST https://qnfo-deploy-guard.q08.workers.dev/work-lock/acquire {"key":"file:<repo path>","owner":"<session>","intent":"<what you will change>","ttl_sec":3600}`
  (`issue:<id>` for an issue; `ttl_sec` at most 7200). If `acquired` is false, `holder` is on it until `expires_at`
  (`intent` says what it is doing): skip it and take other work, or review that change instead of writing a second one.
- CLAIM-UNREACHABLE-FALLBACK-1 (2026-10-30): the endpoint above resolves only from a session with fleet network access. A GitHub cloud-agent
  sandbox reaches GitHub hosts only (`curl: (6) Could not resolve host: qnfo-deploy-guard.q08.workers.dev`, about 20 sessions on 2026-10-30, each
  ending in a no-change draft pull request: the claim was the single path to every edit). `acquired: false` still binds. A claim that cannot be
  attempted (DNS failure, refusal, timeout) does not stop the work: coordinate through GitHub (open pull requests that touch the same paths, read
  with REST `pulls` and `pulls/<n>/files`; a `copilot/<issue>-<slug>` branch), write `work-claim: unreachable (<verbatim error>); no other open PR
  touches <paths>` in the pull request body, and finish the change. A live secret lease and a `HOLD:` comment stay binding. CONFLICT-REPAIR-INPLACE-1
  is the second line against overlapping edits. The
  repository administrator can also allowlist the claim host under Settings > Copilot > Internet access ("Copilot in the cloud" custom allowlist,
  `qnfo-deploy-guard.q08.workers.dev`); the fallback does not wait for it.
- `in_flight` in the answer lists the code loop's unfinished tasks on the same path or issue; they do not block you, but a
  task that fixes the same defect means you review it, not duplicate it. `GET /work-locks` lists every live claim and
  in-flight task (open, never a token).
- Acquire again with your `token` (and `pr` once you have one) to extend it; hold it until your PR merges or you stop, then
  `POST /work-lock/release {"key":"<key>","token":"<token>","pr":<n>,"outcome":"merged|closed|duplicate|abandoned"}`.
  An issue claim records you in `agent_issues.linked_session`.
- The claim is written to the D1 ledger `qnfo-audit.work_claims` (WORK-CLAIMS-1, migrations/2026-10-02-work-claims.sql) and
  released there too; a row another session inserted there directly also refuses your acquire. Do not keep a second claim
  procedure: the endpoint is the only writer a session needs.
- Before you bump a worker's VERSION, list what main and the open PRs claim (REST: `gh pr list` is GraphQL, refused in
  sessions) and take a numeric core above the last line. version-bump-guard fails one that is not ahead (VERSION-AHEAD-1).
  ```
  W=<worker>; R=repos/QNFO/qnfo-workers; for x in main $(gh api "$R/pulls?state=open&per_page=100" --jq '.[]|"\(.head.sha)#\(.number)"'); do gh api "$R/contents/$W/worker.js?ref=${x%#*}" -H 'Accept: application/vnd.github.raw' 2>/dev/null | grep -m1 -oE 'var VERSION = "[^"]*"' | sed -E "s/.*\"(.*)\"/\1 ${x#*#}/"; done | sort -V | tail -3
  ```
- A blocking review of another session's pull request is a PR comment that starts with `HOLD:` and says what must change
  (STALE-PR-LANE-READS-HOLDS-1, qnfo-fleet-control 0.20.0, #2389): the stale-PR lane refuses to merge while a comment newer than
  the head commit asks for changes, until a later comment says `resolved` or `hold released`, a new push lands, or 24 h pass.
  GitHub's request-changes review is not available to the account that authored the PR, so the comment is the review channel.
- Messages from other sessions reach you only between turns. Read your session's notifications before you merge, and
  leave a green control-plane pull request you authored to the stale-PR lane (CONTROL-PLANE-SELF-MERGE-1, about 20 minutes
  quiet since PR-LANE-FAST-1: ops_config stale_pr_merge_idle_min, floor 10) unless a live defect or the owner needs it sooner:
  lever T1.23 counts only lane merges (FAILURE-AUDIT-1, 2026-10-07: three control-plane PRs were merged by their author within
  minutes while a request to leave them to the lane sat unread). Owner directive 2026-10-14: "The system shall process PRs more
  rapidly and push to production." (qnfo-fleet-control 0.29.0: the code loop decides merges every 10 minutes too).

## Internal calls to qnfo-ai (#1703)
- Internal workers authenticate to qnfo-ai by service-binding props, not by a copy of the router key. Add
  `props = { caller = "<worker name>" }` under the worker's qnfo-ai `[[services]]` binding in wrangler.toml; the canonical
  deploy installs it (qnfo-ops BINDING-PROPS-APPLY-1). Do not create or rotate per-worker copies of ROUTER_AUTH_KEY.

## Deploys
- Deploy through the canonical path (merge to main; canonical-deploy.yml calls qnfo-ops /ops/deploy). It takes the
  deploy lock, writes the ledger, installs declared bindings and applies crons.
- The canonical path never creates a worker that is absent from the account (#1704, WORKER-RESURRECTION-GUARD-1). A
  brand-new worker deploys from the push that adds its worker.js, or by workflow_dispatch with `workers=<name>`.
- A retired or folded worker directory carries a `RETIRED` or `FOLDED` file; do not remove it to get a deploy through.
- Bump `var VERSION` in every changed worker.js and keep `deployed-current.worker.js` identical to `worker.js`
  (version-bump-guard and mirror-guard are required checks).
- The bump says what changed (VERSION-MINOR-CAPABILITY-1, proposed 2026-10-06 with FLEET-CHANGELOG-1). Raise the minor
  number (x.Y.0) when a change gives a worker a capability it did not have: a new route, page, loop, cron step, data
  product, or a decision it now takes on its own. Raise the patch number for fixes, tuning, refactors and wording. Raise
  the major number for a breaking change to a route, binding or table other workers depend on. A 0.x worker follows the
  same rule (qnfo-fleet-control 0.4.130 -> 0.5.0 for its next feature). The owner's changelog (fleet.qnfo.org/changelog)
  lists only minor and major releases, so a feature shipped as a patch never reaches the owner.

## Domains (DOMAIN-PLANE-1)
- Owner directive 2026-10-19: personal surfaces on `q08.org`, research and the fleet on `qnfo.org`, quantum computing on `qwav.org`
  (the owner wrote "qwave.org"; the account's zone is qwav.org), each on a short name a person can remember. A `*.workers.dev` host is
  never the address given to the owner, and the owner signs in with an e-mailed code, never a key. `docs/DOMAINS.md` has the table and
  the attach pattern; a surface on the wrong domain gets a `DOMAIN-PLANE-1:<host>` issue.

## Look up the blast radius first (FLEET-GRAPH-1)
- The fleet code + live topology graph (docs/FLEET-GRAPH.md) answers in one call what depends on a worker, function, binding,
  D1 table, view or trigger, cron, route or queue: `GET https://qnfo-memory-mcp.q08.workers.dev/fleet-graph/impact?id=<node>`
  (open, read-only), or the MCP tools `fleet_graph_*` on the same host. Ids: `worker:<name>`, `fn:<worker>#<function>`,
  `binding:<worker>.<NAME>`, `d1t:<db>.<table>`, `d1trg:<db>.<trigger>`, `cron:<worker>@<expr>`; `/fleet-graph/find?query=` gives
  the exact id.
- Before changing or removing a binding, a D1 table or trigger, a cron, a route or a function other workers call, run `impact` on
  it and cover what it returns in the same change; before retiring a worker, `impact` on `worker:<name>` is the dependency check.
  `/fleet-graph/worker?worker=<name>` shows declared versus live bindings and crons. Check `/fleet-graph/freshness` first: when the
  graph is older than the change you reason about, read the code too. Edges marked INFERRED are leads, not facts.
- Drift and dead references are findings (`/fleet-graph/findings?severity=warn`, metric `fleet_graph_findings_warn`); fix them at
  the cause through the canonical path, never by editing fg_* rows. The graph is built by scripts/fleet_graph.mjs
  (fleet-graph.yml on push, qnfo-cloud-ops FLEET-GRAPH-CADENCE-1 when main is quiet); a new binding type, handler shape or
  table family the extractor misses is fixed there, with a selftest case.

## Migrations and tests run themselves (MIGRATION-RUNNER-1, SUITE-RUNNER-1, PROBE-TEMPLATES-1)
- A D1 change to `qnfo-audit` is a file under `migrations/` that opts in with the header lines `-- APPLY-BY: ci`,
  `-- DB: qnfo-audit` and `-- Rollback: <sql>`. A file that runs DELETE or DROP also names `-- BACKUP: <table>`, either a
  table that already holds the rows or one the file creates first (`CREATE TABLE <table> AS SELECT ...` ahead of the
  delete). apply-migrations.yml applies the file when it merges and records it in `migration_runs`. A failure files
  `MIGRATION-APPLY-FAILED-1`. Do not also apply it by hand; check `migration_runs` for an `ok` row instead. deploy-gate runs
  `scripts/apply_migrations.py --check` on every changed migration, so a bad header fails the PR.
  A merged file the push run missed (MIGRATION-UNAPPLIED-1: runs cancelled by the old shared concurrency group on 2026-10-12) is
  applied by `scripts/remediation_consumer.py` on its next run; metric `migrations_unapplied` and event `migration-sweep` record it.
- A worker's `*.test.mjs` suites run on every PR that touches the worker (scripts/run-suites.mjs). The full set runs for
  control-plane, `scripts/`, `.github/` and `migrations/` changes. A new suite needs no deploy-gate line. A suite that
  pins an exact VERSION breaks on the next bump; assert a minimum instead.
- Two migration rules fail only in the full set after the merge (deploy-gate is advisory on a pull request, MERGE-STREAMLINE-1), so read them before you write the file;
  each broke main more than once in the week of 2026-10-29 (RED-MAIN-RECURRENCE-1):
  - A migration that registers a metric (`INSERT ... INTO metric_registry`) maps its breach cause in the same file (`INSERT ... INTO metric_breach_cause`, with a cause key
    the vocabulary already uses: look at the sibling metrics, for example `issue-backlog`, `code-loop`, `structure`) or carries a `-- CAUSE-MAPPED: <where and why>` line
    (METRIC-CAUSE-AT-REGISTRATION-1, migrations/metric-family-cluster-b.test.mjs). A file that already merged is never edited to add it (the runner re-applies an edited
    file, MIGRATION-NO-CLOBBER-1): add a later migration and list the pair in `MAPPED_FORWARD` in that test. plussing-3, plussing-4 and issue-family-throughput-action each needed one.
  - A trigger's `code-anchor:` line is a function signature (`async function name(...) {`), never a `return {...}` or other body line: sessions and the code loop edit body
    lines, the anchor then occurs 0 times and migrations/code-anchor-once.test.mjs fails (trigger 10931 twice, 2026-10-27 and 2026-11-01). Repoint a stale one by a later
    migration; migrations/2026-11-01-anchor-10931-repoint.sql is the pattern.
- `scripts/narrative-prompt-guard.py` (NARRATIVE-PROMPT-GUARD-1) is a deploy-gate step, so it is advisory on a pull request like the suites and shows only after the merge. It searches
  the whole text of every `<dir>/worker.js` and `<dir>/deployed-current.worker.js`, comments and tag names included, for the phrases it bans (`program placement`, `fit table`,
  `primary home`, ...). A comment that uses one turns main red until it is reworded in the source and its mirror (#5526 added one on 2026-11-01): run
  `python3 scripts/narrative-prompt-guard.py` (about 8 s) before you push a worker change; a failure names `file:line`.
- A `METRIC-TRIGGER-<id>-...` issue's contract gets its trigger's probe at birth (D1 trigger
  `contract_probe_templates_v1`). Write a probe by hand only for other families.

## Where probes run (PROBE-SYSTEMWIDE-1)
- A contract's `verify_transport` says where its probe runs:
  - `d1-query` reads qnfo-audit (qnfo-fleet-control's hourly tick and scripts/remediation_consumer.py);
  - `d1-query@portfolio-state` and `external-https` (hosts outside the fleet) run in qnfo-fleet-control;
  - `runner-https` GETs a fleet host from the GitHub runner, outside the Cloudflare account, because a Worker's request to its own account's hosts is the issue-1190 artifact;
  - `d1-query@<db>` reads any other account D1 by name (the consumer). qnfo-identity and qnfo-outreach are refused, because the run log is public.
- An issue about live behaviour names what closes it on a line of its own: `runtime-probe: {"url": "https://...", "status": 200, "contains": "<marker>"}`. D1 triggers make that line the issue's runner-https contract (PROBE-BIRTH-RUNTIME-1). Never choose a URL and marker that already pass while the defect exists. The runners' write-keyword guard scans string literals too, so a probe's failure text must not contain words like "update ".
- A removal is probed too (AUTOAUDIT-PROBES-1): a runtime-probe takes `"absent": "<text>"` (case-insensitive, must not occur),
  a deploy check uses `"min_version": "x.y.z"` (passes at or above it, read from the JSON `version`; MIN-VERSION-PROBE-1), never an
  exact VERSION string in `contains`, which fails for good after the next bump; and an issue whose defect is the code on main names `code-probe: {"paths": ["<dir>/worker.js"], "absent"|"contains": "<exact text>"}`
  on a line of its own; D1 triggers make it a `code-read` contract that the consumer runs against its checkout of main. Use it
  where the code state is the defect; behaviour still needs a runtime or D1 probe. The consumer drains every due contract
  per run (PROBE-DRAIN-1).
- ORPHAN-GUARD-BIRTH-1 (migrations/2026-10-06-orphan-birth-contracts.sql) writes the `issue-<id>` contract row at birth, so a session or loop that gives an issue its probe uses UPDATE on class `issue-<id>` (PROBE-BIRTH-RUNTIME-1 does; an INSERT OR IGNORE of that class is silently ignored). An issue filed by a live worker carries a 48-hour probe that reads `pending` while the filing loop owns it and `stale` after.
- qnfo-cloud-ops dispatches the consumer when it has been idle for 60 minutes (PROBE-CADENCE-1), so runtime probes do not depend on pushes to main.

## Cloudflare actions without a token
- `cf-ops-actions.yml` (workflow_dispatch) runs allowlisted Cloudflare API actions with the repository's token:
  report, delete-worker (marker-guarded), gateway-logs, gateway-cost, ai-neurons, access-probe, r2-get. Extend
  `scripts/cf_ops_actions.py` rather than parking an issue as "needs the credential holder".
- Owner directive 2026-10-08: no new Cloudflare token will be issued; use the ones in place. The repository's
  `CLOUDFLARE_API_TOKEN` writes zone routes and DNS records (attach-lifecycle-custom-domain 2026-09-30, attach-ask-qwav-route
  and attach-surface-routes 2026-10-02, the twelve retired hosts 2026-10-08) and deploys, deletes and unbinds workers and D1.
  Of the session connectors, the Cloudflare MCP reads every zone but may not write routes. A card or issue that says "needs a
  token" is wrong until a run with the repository token has been refused and its error recorded.

## Stuck items and SLAs (QUEUE-SLA-1)
- Owner directive 2026-10-08: no item or queue is stuck for more than one run or cycle. Owner directive 2026-10-14, verbatim: "All
  SLAs systemwide across the fleet shall be measured in 10-minute intervals/resolution, never hours or days. No SLA shall ever
  exceed 120 minutes and action shall commence immediately >120 minutes to audit and remediate all such failure modes and their
  root causes." Every SLA is measured at 10-minute resolution and none exceeds 120 minutes; action starts at the first tick past
  120 minutes (SLA-120M-1: queue_sla, the stuck views, sla_registry, breach actions on the 10-minute tick, metric
  `sla_breaches_over_120m`; SLA-120M-2: issue age `issues_open_over_120m` and escalation every 120 minutes, content stages,
  repair-time triggers at 2 h). A freshness check on a loop slower than 120 minutes allows its cadence plus at most 120 minutes,
  so a missed run is acted on within 120 minutes of its due time. A new SLA, threshold or budget states minutes, never hours or days.
- Cron cadence (CRON-HOURLY-FLOOR-1, owner directive 2026-10-19, verbatim: "ACCELERATE ALL SCHEDULED CRON EXECUTION. ALL CRON TICKS
  SHALL BE MEASURED IN 5-MINUTE INTERVALS, AND NO CRON SHALL EXECUTE LESS THAN ONCE EVERY HOUR."; CRON-TICK-5M-1 made the dispatcher
  tick every 5 minutes). `scripts/cron_rate_guard.py` (deploy-gate) fails a declared cron that fires less than hourly unless it is on
  the shrink-only, expiring `scripts/cron-tempo-allowlist.txt`; an expired entry and an entry that no longer matches a slow cron
  also fail. A `RETIRED` or `FOLDED` directory is never deployed, so its crons do not run and are not audited (24 of the 34
  directories with a slow cron on 2026-10-19). Convert a live worker with CRON-SINGLE-TRIGGER-1 (qnfo-lifecycle is the reference
  block, scripts/cron-single-trigger.test.mjs the test): one hourly tick plus a `CRON_TABLE` of the former expressions delivered
  exactly once, so a daily email or post does not become 24 emails. A job that is idempotent and cheap should also move its
  table entry to hourly. Each remaining worker has a `CRON-HOURLY-FLOOR-1:<worker>` issue in `agent_issues`; delete its allowlist
  line in the PR that converts it.
- `queue_sla` lists each known stuck type with its cycle, SLA (minutes) and automatic fix; `v_stuck_summary` measures them
  by age, not by count. The D1 trigger `queue_sla_tick_10m` runs the fixes every 10 minutes off the fleet cron heartbeat
  and logs each to `queue_sla_actions`; `ops_config queue_sla_autofix = off` stops the fixes, not the measurement.
  Metrics `stuck_items_over_sla` (target 0) and `issues_unprobed_60m` (target <= 10) file their own issues.
- Owner directive 2026-10-13 (ISSUE-SLA-2H-1): open issues for definition-of-done success criteria 0 with every fleet system
  green; every open issue resolved, deployed and closed within 120 minutes of opening (SLA-120M-2; was 24 hours), server-side, at a
  minimum of 1.5x accumulation. Measured as `open_agent_issues` (target 0), `issues_open_over_120m` (0; `issues_open_over_24h` is
  kept for history without a trigger), `issue_drain_ratio_24h` (>= 1.5)
  and `issue_auto_close_2h_share_24h` (1.0), each with its trigger (migrations/2026-10-13-issue-sla-2h.sql). A finding that is not
  a defect (a roadmap item, a report) belongs in `goals` or `objective_space` with the successor id, never closed as wontfix.
- Owner directive 2026-10-20 (ISSUE-THROUGHPUT-1), verbatim: "The system shall always triage, prioritise, remediate, resolve, deploy, and close issues server-side, automatically and
  faster than they open (throughput)." It extends ISSUE-SLA-2H-1 above: over 24 hours the issues closed with evidence outnumber those opened (`issue_drain_ratio_24h` at or above 1.5),
  and no family hides a net inflow: `v_issue_family_throughput` (migrations/2026-10-20-issue-throughput.sql) lists, per family, opened, closed, open, net inflow and drain ratio. A family with
  net inflow above 0 and an open backlog is missing a loop, a probe or a doer, and that is built next. Closure stays evidence-only (`issue_triage.close_evidence`), never `wontfix` to lower a count.
  Recorded in `ops_config.OWNER_DIRECTIVE_2026_10_20_ISSUE_THROUGHPUT_1` and docs/AUTONOMOUS-OPERATION-DOCTRINE.md (standing directive 2026-10-20, throughput).
- Owner directives 2026-10-20 (DEPLOY-ALL-MERGES-1, ISSUE-AGE-24H-1, MERGE-RELIABILITY-1), verbatim: "The system shall always clear all open issues server-side automatically
  within 24 hours. The system shall always fix and redeploy all merge failures automatically." and "The system shall always deploy all merges automatically." Every worker
  behind main is redeployed by a runner: qnfo-ops /ops/deploy for ordinary workers, a dispatch of canonical-deploy.yml workers=<name> (canary and revert) for the control
  plane and of the owning workflow for container workers (qnfo-fleet-control 0.42.0, deploy_drift_cf). Measured by `merges_undeployed_over_60m`, `code_pr_merge_share_7d`,
  `code_prs_unmerged_over_120m` and `issues_over_24h_no_doer`, read per issue in `v_issue_age_ladder` (doer, planner verdict, rung); not-code verdicts older than 24 h are
  re-planned daily (`issue_age_replans`, `ops_config issue_age_replan`). An issue is still closed only with evidence; PLAN_TRUSTED and the code loop's merge scope are unchanged.
  Recorded in `ops_config.OWNER_DIRECTIVE_2026_10_20_DEPLOY_ALL_MERGES_1` (migrations/2026-10-20-deploy-all-merges.sql).
- Every open issue's remediation contract is due hourly (trigger `remediation_contracts_cadence_1h_ai`). A new queue, status
  or loop that can hold items adds its `queue_sla` row and its `v_stuck_summary` column, with an automatic fix and its revert,
  in the PR that creates it. A chain or guard that checks only a count is incomplete: add the age of the oldest item.
- Outreach runs at full cadence (owner directives 2026-10-14, OUTREACH-ACCELERATE-1 and PAPER-ROLLUP-1): Bluesky 21 posts a week, LinkedIn 7
  (Buffer queue or drafts, ToS 3.1), Mastodon 14 (direct API, MASTODON_TOKEN; Buffer only as fallback), X 14; Substack Notes in Buffer
  carry roll-ups. Every published paper is disseminated: an hourly Substack roll-up lists every queued paper and a Bluesky thread
  carries the announced ones (qnfo-social drainRollup), so a dissemination queue is cleared by carrying more items per post, never by
  suppressing rows for volume. `papers_queued_over_120m` (target 0) and `v_channel_impact_7d` (posts and human clicks per channel)
  measure it; the attention share steers between half the cap and the cap (`pipeline_flags.social_share_floor`).

## Anti-fragile by default (ANTIFRAGILE-1, charter rule 12)
- Owner directive 2026-10-08: no holds, filters or blocks without live evidence; red-team every blocker; redundant paths,
  never a single critical path; flag and remediate anything older than one cycle; root out false beliefs.
- A hold, filter or park needs a current, recorded reason and an expiry; prefer backpressure (a rate) to a hold. Release
  what has neither (backup table first, revert text in the row), as the 2026-10-08 audit did (bak_20261008_hold_release).
- Before you write "blocked", "owner only", "needs a token" or "cannot", attempt it with what exists and record the attempt in
  `blocker_redteam` (verdict false-belief-removed, workaround-built or confirmed-with-evidence with the refusal text).
  `v_blocker_claims` and metric `unverified_blocker_claims` list every claim nobody has tested.
- `v_issue_age` dates every open issue; the 10-minute tick raises an issue's priority one level per 24 h (to high, never
  critical; ledger `issue_age_bumps`), and `issues_open_over_24h` files the backlog. A design with one executor, one
  model or one transport on a critical path ships with its second path or an issue that builds it.
- Never silently drop an issue (owner directive 2026-10-08): a guard on `agent_issues` normalises, annotates or reopens, never
  aborts or ignores; a worker dedupes only against OPEN issues of the same title (a closed one is reopened by the D1 trigger
  `issue_refile_reopen` when you insert); a caught insert error is logged, never swallowed. Two signals from one producer
  are one path, not two.
- Every failure mode you find gets a `failure_modes` row (root cause, remediation) and an `fm-<key>` detector contract in the
  PR that fixes it; `v_failure_mode_status` and `failure_modes_recurring` show a recurrence within the hour.

## The charter (QUNIVERSE-CHARTER-1)
- `docs/QUNIVERSE-CHARTER.md` is the system's charter: what the Quniverse is, what it should be, objectives, SWOT, MVP,
  blue-sky footprint, roadmap order and decision rules. Read it, and `GET https://qnfo-fleet-control.q08.workers.dev/charter`,
  before any change that adds, retires or redirects a worker, cron, binding, table family or spend.
- Every PR, issue and roadmap item names the charter pillar it serves (`core`, `autonomy`, `research`, `reach`, `cost`,
  `security`, `personal`). A new worker directory declares `# charter-pillar: <key>` in its wrangler.toml and names the
  same-class retirement it funds (net-zero rule); `charter-guard` fails CI otherwise. Work that serves no pillar is parked.
- The section between the `CHARTER-LIVE` markers is generated daily by qnfo-fleet-control (CHARTER-LOOP-1) and committed
  to main; never edit it by hand. Hand-written sections change by PR with a version bump. `CHARTER_PILLARS` and
  `CHARTER_MVP` in the kernel and the tables in the charter change together (the guard enforces parity).
- `docs/PORTFOLIO.md` is the portfolio of every QNFO GitHub repository (tiers, pillars, WBS links, hygiene). Its live
  block, `QNFO/.github/PORTFOLIO.md` and the index in the organisation profile README are regenerated daily by
  qnfo-fleet-control (PORTFOLIO-LOOP-1); never edit them by hand. A new repository names its tier and, for research, a
  WBS code in `portfolio-state.program_registry`; private repositories are counted and never named. The loop also
  repairs hygiene itself (PORTFOLIO-HYGIENE-1: the QNFO-ULA LICENSE file, a README-derived description, tier topics,
  registry links; `portfolio_actions` is the ledger), so do not hand-fix those on QNFO repositories; fix the README
  or the registry row and let the next sync take it.

## No Claude dependency at runtime (NO-CLAUDE-RUNTIME-DEPENDENCY-1, CLOUD-ONLY-VERIFICATION-1)
- Owner directive 2026-10-01: the fleet and its dashboard must not depend on continued Claude usage, and all data is hosted
  on Cloudflare (D1, R2, KV, Workers), never on claude.ai (Claude Docs, artifacts, Routines). A session builds the fleet; it
  is never part of it. A session that needs a durable record writes a D1 row or a repository file.
- Do not make claude.ai a system of record, a link target in a worker or doc, or a recurring runner. Recurring work is a
  worker cron (using qnfo-ai and D1). A decision the owner must make is made in https://fleet.qnfo.org (queue cards,
  objective decisions, the prompt panel), never by "telling a session". The dashboard refuses claude.ai and anthropic.com
  links in queue items, a D1 trigger refuses any `human_actions` card whose text routes the owner's work to Claude
  (migrations/2026-10-01-human-actions-no-claude.sql), and `cloudflare-only-host-guard.py` (deploy-gate) fails CI on a
  claude.ai link in any tracked file. Tasks sent from ChatBox, DeepChat or the dashboard become `agent_issues` rows
  (TASK-INTENT-INTAKE-1, OWNER-NOTES-ROUTE-1); an explicit `code-task: repo=<repo> path=<file>` line hands one to the code loop.
- The watchmaker index (WATCHMAKER-INDEX-1, `GET https://fleet.qnfo.org/api/watchmaker`, metric `watchmaker_index`, target 0)
  counts recurring operations that still need a person or a session, or whose Cloudflare runner is stalled. A PR that adds
  a recurring operation adds it to `WATCHMAKER_OPS` in qnfo-fleet-dashboard/worker.js with the D1 query that proves it ran.
- Recurring verification belongs to worker crons (LOOP-WATCH-1 in qnfo-fleet-control, `GET /loops`, files and self-closes
  `CHARTER-TICK-STALE-1`, `PORTFOLIO-SYNC-STALE-1` and friends), not to session check-ins or routines. A session follows
  its own in-flight PR through GitHub events while it is open; it arms no claude.ai reminder, check-in or Routine.
- Owner documents (identity, brand, CV, opportunities, their archives and edit history) live in the private D1
  `qnfo-identity`, table `owner_docs` (canonical key `identity`), bound ONLY to qnfo-fleet-dashboard (IDENTITY-STORE-1). The
  dashboard serves and edits them at fleet.qnfo.org/owner and runs IDENTITY-WEEKLY-1 from them; never bind `qnfo-identity`
  to another worker and never copy its rows into the shared `qnfo-audit` D1. Do not write `qnfo-audit.owner_docs` (no longer
  read; a write there is copied into `qnfo-identity` on the next */15 tick). A session that must change a document writes
  `qnfo-identity.owner_docs` and first keeps the current text as a `<key>--v<yyyymmddhhmmss>` row, visibility `history`. The final verbatim export of the retired Claude
  Doc (rev 46, with its five comment threads) is `personal-life.owner_documents` key `identity-brand-opportunities` (private
  plane). Never recreate an owner document on claude.ai.
- Known violations retired on 2026-10-01: the Identity doc on Claude Docs (exported, deleted); every claude.ai Routine and
  check-in (all 82 exported to `qnfo-audit.retired_claude_routines` and deleted on the owner's directive; none may be recreated); owner-ratified objective revisions with no
  Cloudflare consumer (OBJECTIVE-REVISION-APPLY-1, applied by qnfo-fleet-dashboard 1.13.0); card notes only sessions read
  and queued tasks no Cloudflare loop read (now `agent_issues` rows, OWNER-NOTES-ROUTE-1); the qnfo-ops `claude-sonnet-4.5` route (2.38.34: no Anthropic upstream anywhere in
  the fleet; a `claude-*` model id routes to the ops model).

## Standing owner grant (OWNER-STANDING-GRANT-1)
- Owner directive 2026-10-05: "I don't want the 'safest' choice. I want bold autonomous systems that think and act entirely
  on their own." It extends OWNER-QUEUE-DELEGATION-1 (docs/STRATEGY.md section 5; `pipeline_flags.owner_standing_grant`)
  and is charter decision rule 9. Without an owner card, a loop or a session may:
  - retire an idle or low-value worker: PR with a `RETIRED` marker, removal from probes and registries (`service_registry`
    state `retired`, deploy-targets.txt, registry lists), then cf-ops-actions delete-worker. Idle proof is not required; a
    dependency check is (binders, URL callers, live readers of the tables only it writes). Stop at the first real dependent
    and fold it or record it on the issue.
  - delete an unused D1 database after a verified backup (cf-ops-actions d1-backup, unbind-d1, delete-d1; D1-FOLD-1).
  - switch a worker to a cheaper model with no A/B test, when it keeps a per-request fallback to the previous model and an
    automatic revert on errors or empty replies (personal-api TWIN-FLASH-1 is the pattern), recorded on its issue.
- merge its own control-plane change (CONTROL-PLANE-SELF-MERGE-1, qnfo-fleet-control 0.7.0, PR 737; owner directive 2026-10-06
  "more flexibility and more autonomy ... proceed with all changes"): the stale-PR lane merges a green, quiet session pull request
  that changes a CM_DENY worker when `ops_config control_plane_self_merge` is `on`, the worker has a versioned `/health`
  (`CP_CANARY_WORKERS`) and the PR carries `worker.js` with its mirror. canonical-deploy.yml (deploy-code-orchestrator.yml for
  the container worker the canonical path skips, CONTROL-PLANE-CANARY-2) then canaries `/health` for the new VERSION and, when
  it does not arrive, reverts the push on main (`scripts/canary_revert.py`, one level, never a revert of a revert), dispatches
  the deploy of the revert through the workflow that owns the worker and files `CONTROL-PLANE-REVERTED-1`. The canary proves the VERSION arrived, not
  that the worker works: LOOP-WATCH-1 and the metric triggers are the next line. `off` restores CONTROL-PLANE-MANUAL-1 without a
  deploy. Workflows under `.github/`: the lane merges them since qnfo-fleet-control 0.50.0 (OWNER-AUTO-APPROVE-ALL-1, owner 2026-10-26: "Yes, auto-approve all"; `ops_config stale_pr_merge_workflows = off`
  restores the refusal); the code loop's own merge scope (`cmScope`) still denies `.github/workflows/**`.
  CODE-LOOP-CONTROL-PLANE-1 (lever T1.23; owner directive 2026-10-19, verbatim: "The code loop SHALL ALWAYS BE ABLE TO change
  qnfo-fleet-control, qnfo-ops, qnfo-deploy-guard and the loop's own code."; qnfo-fleet-control 0.37.0, qnfo-code-orchestrator 0.22.0,
  human_actions 115): the code loop plans and merges those three workers, qnfo-code-orchestrator and scripts/code-task-* like qnfo-ai
  and qnfo-gateway, behind the same functional canary and automatic revert (`CM_LOOP_CANARIED` and `PLAN_LOOP_CANARIED`, held equal by
  fold-guard.test.mjs, which also requires a canary entry for each). It replaces the earlier wait for five lane merges with no canary
  revert. The scorer host (qnfo-observability), qnfo-autonomy-scorer and qnfo-containers-pilot stay denied.
- RULE-8-RETIRED-1 (owner directive 2026-10-06, verbatim: "'Rule 8' is now deleted entirely. The system needs more flexibility
  and more autonomy to decide for itself and make it's own choices ad hoc. Proceed with all changes."; PR 736 retired it from the
  qnfo-ops prompt, the trigger texts and the policy documents): caps, guards, probes and deletions are the fleet's own decisions,
  made through the canonical path and recorded with the measurement that justified them: a cap change is a `fleet_budget`
  migration with its note, a guard or probe change a migration with its rollback line, a deletion a migration that names its
  `BACKUP` table (MIGRATION-RUNNER-1 above). Still in force, because they are not autonomy limits: the shared-secrets rules (no
  key minted, rotated or committed outside the secret lock), outreach suppression and opt-out handling, the personal/research
  separation, and governance changes (this file, the charter) land by PR. A breached `fleet_budget` AI spend cap steers model
  choice and never stops work (BUDGET-SOFT-ROUTE-1 below).

## AI spend budgets steer, never stop (BUDGET-SOFT-ROUTE-1)
- Owner directive 2026-10-06: "AI spend budget should never stop any process, pipeline, or workflow, only limit/suggest
  what models may be used (there are many free and low-cost coding models available through Cloudflare and these budgets
  shall never be hard and fast limits)." It replaces the earlier reading of core prompt rule 8 that no paid model call may
  run while a cap is breached, and extends BUDGET-CAP-FREE-FALLBACK-1 (`ops_config budget_cap_free_fallback`).
- While an `ai_spend:*` cap in `fleet_budget` is breached, work continues on the cheapest capable model: a single cheap
  Workers AI model (glm-5.3-flash, qwen3-30b-a3b and peers) instead of a premium model, one leg instead of an ensemble,
  fewer items per tick instead of none. Never a refusal, a deferral queue, an HTTP 429 on spend, or a skipped run. The qnfo-ai
  router downgrades every caller at a cap (5.32.0); idea-hub scores lean (1.6.0); qnfo-ai-search answers, indexes and
  generates questions lean (2.3.0); qnfo-ops falls back to free models.
- Caps are still measured and reported, and a breach still files its metric issue; a cap changes only by a recorded
  `fleet_budget` migration (RULE-8-RETIRED-1 above), never by a silent edit; the lever at a breach is a cheaper
  model or a smaller batch, never a stop. Limits that protect an open endpoint from abuse (per-address rate limits) and
  publishing or outreach cadence caps are not spend budgets and stay.

## No loose ends (OWNER-NO-LOOSE-ENDS-1)
- Owner directive 2026-10-06: "The system shall fully execute and implement its own suggestions and enhancements across
  the fleet. You shall never leave open issues unresolved or unremediated, now or in the future, not in this thread nor
  system/fleet-wide." It binds every session and every loop.
- A suggestion is implemented, not only written down. A session that proposes a change makes it in the same PR, or files
  it as an `agent_issues` row that a doer will execute: a `code-task:` line for the code loop, or a named owning loop.
  Prose in a reply is never the only record.
- Before a session ends, every item it opened (PR, issue, owner card, work claim, migration) is closed with evidence, or
  carries an owner, the exact blocker and a closing probe that resolves it on its own: a `remediation_contracts` d1-query
  probe for an issue, or a probe that resolves a `human_actions` card (qnfo-cloud-ops OWNER-STEPS-WATCH-1, metric-refresh
  steps). A PR a session opened is followed until it merges and its deploy is verified live.
- Work another session has claimed is not dropped and not duplicated: review it, and take it over when the claim lapses
  with the work undone.
- A step only the owner can take (a permission the session was refused, a credential, a legal or publishing act) becomes
  a `human_actions` card with its default in effect and a probe that closes it when the step is done. The session states
  the blocker plainly and never works around a refusal.

## Open access (OPEN-ACCESS-1)
- Owner directive 2026-10-01: favor free, open access. The more people see the fleet's data, the more impact the owner makes.
  Do not put reads behind a token, key, login or "owner key", and do not ask the owner to set or enter one. The dashboard
  (https://fleet.qnfo.org, its JSON and its Ask panel) is open to everyone; a card or doc that tells the owner to create a
  token is a defect.
- The narrow exception is what changes the fleet or spends its money: notes and tasks that become `agent_issues` the loops act on,
  ratifying an objective, editing the private owner documents, and unbounded AI calls. Those stay off the public page (they take
  `x-loop-token`) and public AI use is capped per anonymous visitor and globally. Never open them silently: say what a stranger
  could then do, and let the owner decide. Prefer a tokenless identity (Cloudflare Access) over a secret the owner must manage.

## Measuring and improving effectiveness (METRIC-CLOSED-LOOP-1, SESSION-RECORD-1)
- Owner directive 2026-10-02: the fleet measures and improves its own internal and external effectiveness automatically
  and continuously. The loop is on Cloudflare, not in a session: `metric_registry` (measure, hourly) ->
  `v_metric_trigger_state` (judge) -> `analytics_metric_triggers` + qnfo-fleet-control evaluateMetricTriggers (act: one
  deduped `agent_issues` row per breach) -> `remedy_efficacy_30d` (learn: did the remedy move the metric?).
  `metrics_in_breach` is the headline (target 0). See migrations/2026-10-02-metric-closed-loop.sql.
- A change that registers a metric also adds its trigger (threshold, owner, concrete lever, definition of done), or names
  its exemption in the same migration. `metric_registry.state` is not a verdict; `v_metric_trigger_state.hit` is.
- A remedy that did not move its metric within 7 days is replaced, not repeated: write a different lever into
  `analytics_metric_triggers.action` (with a code-task if it needs code) or correct a wrong target with evidence.
- Filing is not fixing (ACT-BRIDGE-1, owner directive 2026-10-02). When a breach's lever is a code change in one file, end the
  trigger's action with two lines of their own: `code-task: repo=qnfo-workers path=<dir>/worker.js` and
  `code-anchor: <verbatim text that occurs exactly once in that file near the edit>` (state the edit in the prose above).
  evaluateMetricTriggers (qnfo-fleet-control 0.4.89+) carries those lines into the issue unchanged, the code loop opens the
  PR, the merge runner merges on green checks and verifies live. `breach_code_task_pct` grades how many breaches reach a
  doer; `code_task_success_rate_30d` grades the doer (migrations/2026-10-02-act-bridge-doer-metrics.sql). A loop that acts
  on its own metrics (ASK-LOOP-1 in qnfo-ai-search: measure, golden-set eval, judged A/B with revert, ASK-FIX-1 code tasks
  that close themselves on recovery) points its triggers at the digest so a breach is not filed twice.
- Guard metrics (INTEGRITY-GUARDS-1, `metric_registry.kind = 'guard'`: `issue_wontfix_share_7d`,
  `remediation_latest_pass_pct_7d`) keep the loop honest. A target metric that improves while a guard metric worsens is
  a regression: do not close issues as `wontfix` to lower `open_agent_issues`, and do not count a fix whose latest
  `remediation_verifications` row fails. See migrations/2026-10-02-integrity-guard-metrics.sql.
- Every agent session writes one `qnfo-audit.session_records` row at closeout (wbs_code, summary, decisions_made,
  handoff_notes, total_tasks, completed_tasks, execution_ratio, started_at, completed_at): what it was asked, what it
  finished, what it left and why. `session_execution_ratio_30d` and `session_records_30d` are graded from these rows.
- A closing probe makes the claim checkable: a metric issue carries a `remediation_contracts` d1-query probe on the metric
  itself, so the hourly remediation tick closes it on recovery; every "this will work after the deploy" gets such a probe
  written at the same time.
- Session lessons (SESSION-EFFECTIVENESS-1, each from a 2026-10-01 or 2026-10-02 miss): re-read `origin/main` and the open
  pull requests for the thing you are about to build, immediately before building it (a watchmaker index was built twice;
  PR 345 closed unmerged). State what is true from a read made in this session ("never proven live" was said of the code
  loop hours after it delivered a merged PR). Before treating an off-target metric as a real gap, check that it is measured
  (a flagship-version metric read 1 while the true minimum was 3: two flagships were unmeasured, #1754). An action the
  session is refused is handed to the owner with the reason, not retried.

## Output quality outranks metric count (OUTPUT-QUALITY-LEDGER-1)
- Owner directive 2026-10-26, verbatim: "DO NOT LOSE SIGHT OF CONTINUED DRIVE TO BETTER QUALITY OUTPUTS OF ALL KINDS (PAPERS/POSTS/PUBLICATIONS/PROMOTION/CODE/ETC).
  IS THE FLEET ACTUALLY GETTING 'BETTER' AND HOW WOULD WE KNOW?" It binds every session and loop; `docs/OUTPUT-QUALITY-LEDGER.md` has the detail.
- Whether outputs got better is read from `SELECT * FROM v_output_quality_by_surface; SELECT * FROM v_output_quality_headline;` (outcome measures only, now against
  seven days earlier; `improving_with_gaps` means a surface has no measured outcome). Clearing breaches, closing issues and raising a gate pass rate are not quality.
- A pool mean is not evidence: compare the same items a week apart, or items made after a change against items made before (the paper score's mean rose 64 to 73
  while the same 464 papers fell 64.3 to 61.4). A gate or a rule-based score is a proxy: it is labelled `proxy` in `output_quality_measures`, never a target, and
  never counted toward the verdict. A measure that cannot move any more (81% of new papers score 95 or more) is a `validity` finding, not good news.
- A worker that produces output outsiders read (paper, essay, post, reply, code) names its outcome measure in `output_quality_measures` (role `outcome`, polarity, a
  tolerance) in the PR that adds it, or is listed as a gap in the doc. A worse outcome is fixed at its producer; no measure is added to the outcome list to dilute it.
- Do not close or reject findings (errata, retractions, reader reports) to lower a quality count; closure needs the reason or the fix.

## Writing that outsiders read (ENSEMBLE-POLICY-1)
- Read `docs/ENSEMBLE-POLICY.md` before adding or changing a worker that writes prose for readers outside the fleet. LLM errors are
  correlated (a 9-judge, 7-family panel is worth about 2.2 votes), so layers must come from disjoint model families, stay few and
  small, keep the non-model layers (deterministic gate, reader votes, owner verdict), and record their verdicts. While a
  `fleet_budget` cap is breached the layers use the cheapest models (BUDGET-SOFT-ROUTE-1); they are not removed.
- Cite full texts and keep the pipeline out of the prose (CITE-FULLTEXT-1, SOURCE-VOICE-1; owner directives 2026-10-13:
  "Papers shall cite full texts, not merely reference work summaries"; a paper saying it lacks a source's full text is
  "highly inappropriate"). A generator that writes about other works grounds each one on its full text (arXiv HTML, a QNFO
  paper's `body_md`), never a title or a truncated abstract, and drops a work it cannot read in full. Reader-facing text never
  mentions how its sources reached it (bibliography entries, supplied or fetched summaries, input or grounding blocks,
  truncated or empty sources). Prompts never ask a model to disclose a thin source; `narrative-prompt-guard.py` fails CI on it.
  Code that reads `papers.abstract` must not treat NULL as "no summary": the body holds the paper (fm-paper-abstract-empty).

## One priority queue, no due dates (PRIORITY-QUEUE-1)
- Owner directive 2026-10-03: dates are not important, the order of priority is. D1 `qnfo-audit.v_issue_queue` is the
  master queue: every open issue with `pos`, ordered critical, high, medium, low, then oldest first. A loop that picks issues
  orders by `CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END`
  (then its own tie-break), never by id or date alone, and never filters critical out.
- Do not set or rely on `issue_triage.sla_due_at`: new issues are due on arrival (trigger `agent_issues_autotriage2_ins`) and
  the SLA views report only untriaged issues. Never write "+7 days" or another future date into it.
  See migrations/2026-10-03-priority-queue.sql (backups and rollback in its header).

## Paper revisions and withdrawals (PAPER-LEDGER-1, PAPER-WITHDRAW-GUARD-1)
- Owner directive 2026-10-26: "papers should never disappear en masse; versioning needs to preserve changes across multiple revisions for auditing and provenance."
  `docs/PAPER-LEDGER.md` has the detail; the DDL is in `migrations/living-paper/`.
- Every change to a paper's body, status, version, title, abstract or metadata is one immutable row in living-paper `paper_change_ledger` (full prior body in
  `paper_change_bodies`): read a paper's history from `v_paper_revisions`, never from `paper_version_history` (it keeps one body per version). A writer that changes `papers`
  sets `change_actor` (`<worker>:<run id>`) and `change_reason` (different text for each change) in the same UPDATE, or its change is recorded as `unattributed`.
- A trigger refuses more than 25 papers an hour (80 a day) leaving published, distributed or external_preprint, and more than 5 deleted an hour. An intended larger withdrawal
  first inserts a reasoned, expiring `paper_withdrawal_override` row. Never drop the trigger to get a statement through; a refusal is the guard working.
- A new trigger on `papers` must not run an FTS5 statement for an update that leaves `title` and `abstract` alone (PAPERS-FTS-DRIFT-1: it corrupted `papers_fts`).

## Issues and evidence
- CODE-CHANGE-REQUIRED-1 (owner directive 2026-11-03): every filed issue and subsequent PR requires an implementation
  code change, an applied migration or executable configuration, an issue link, changed implementation paths,
  regression checks and outcome verification in its definition of done. Investigation-only, empty and documentation-only
  PRs are not deliverables; naming another PR or a documentation exemption does not satisfy this PR's own code requirement.
  If the implementation already exists, record evidence on the issue rather than opening a no-change PR.
  The publisher checks before pushing, the fleet checks before opening and merging, and the Copilot lifecycle closes
  finished no-code PRs while leaving their issues open. Active session placeholders are never treated as finished work.
- Open work lives in D1 `qnfo-audit.agent_issues`. Close an issue only with evidence in `issue_triage.close_evidence`
  (a live measurement, not "deployed").
- A close names its channel (CLOSE-CHANNEL-PROBE-2, agent_issues 100419). `agent_issues.close_channel` says which path closed an issue (a fix, a probe, a sweep, a session); a session that closes by SQL
  sets it in the same UPDATE (`session:<name>`), because `issue_close_evidence_required` guards the evidence and nothing guards the channel: 49 closes of 7 days carried none and no trigger can add it
  (SQLite cannot assign NEW.* in a BEFORE trigger, and an AFTER trigger that updates `agent_issues` again nests into the 24 existing triggers, AGENT-ISSUES-TRIGGER-DEPTH-1). Closing through `issue_triage`
  (`triage_state` closed) writes it for you (`auto:triage-sync:<owner>`). The contract `issue-100419` counts the closes of the last 48 hours that carry none.
- GitHub `schedule` triggers fire rarely and late on this repository (95 schedule runs in total by 2026-10-02; mirror-autosync
  ran 9 times), so no periodic work may depend on one; periodic work belongs in worker crons.
- Issue hygiene (ISSUE-HYGIENE-1 and PORTFOLIO-NOT-ISSUES-1, 2026-10-26; owner question "why are there over 800 GitHub issues?"): GitHub Issues carry work that
  finishing the work closes. `roadmap_mirror_scope` (qnfo-audit) names the roadmap sources that are not issues (projects, metric-breach twins of a METRIC-TRIGGER ticket,
  failure-mode registry rows): they stay in `roadmap_implementation`, on the Projects board and in `/roadmap`, qnfo-github-steward closes their mirrors `not_planned` and never
  reopens them, and a source set to `mirrored = 1` is mirrored again with no deploy. A ticket about another record (PROBE-NEEDED-1, CODE-MERGE-REFUSED-1, CODE-LOOP-EXHAUSTED-1,
  a self-heal ledger copy, a repeated owner prompt) closes with the fact that resolved it: the hourly D1 workflow `issue-meta-fold` (fleet_tasks, :20) saves the before-state in
  `issue_fold_ledger` and closes through the triage row with "moot: ..." or "superseded by <id> ..." evidence. A new filer of such tickets gets a rule in that workflow and in
  `migrations/issue-hygiene.test.mjs`; never a trigger on `agent_issues` (AGENT-ISSUES-TRIGGER-DEPTH-1: D1 refuses writes whose trigger programs nest more than 10 levels).
- ASSIGN-COPILOT-ISSUES-1 (2026-10-30, owner directive: "ALWAYS ASSIGN GITHUB COPILOT ... TO ALL NEW ISSUES ... NEVER ASSIGN ISSUES TO THE USER"): every new issue in every
  QNFO repository is assigned to GitHub Copilot running the Quniverse custom agent, never to a person, by `.github/workflows/assign-copilot-on-issue.yml`
  (`scripts/assign-copilot-sweep.mjs`, secret `QNFO_GH_PAT`; the workflow `GITHUB_TOKEN` cannot assign Copilot). The sweep also publishes the profile at
  `QNFO/.github` `agents/` (measured live 2026-10-30: with only that organization-level profile, sessions started in repositories that hold none). The API call also assigns the token's
  owner, which the sweep removes again. It is bounded: only issues written by an owner, member, collaborator or `github-actions[bot]`, created in the look-back window, at most
  `--max` (10) per run and never more than 12 open Copilot pull requests org-wide; an issue the work-claim service shows as claimed or in flight is left to that doer; an issue
  a person unassigned Copilot from is never assigned again. A stalled assignment (Copilot assigned, no open or merged pull request, session older than 2 hours) is re-driven once,
  and only while CLAIM-UNREACHABLE-FALLBACK-1 above is on main. An assignment Copilot refused to start (a Copilot comment "unable to start working on this issue", and the issue
  stays assigned to it) is not a session: 109 of 153 assigned issues were in that state on 2026-11-01, 107 for lack of AI credits, and counting them as sessions had left 87 of
  them, the red-main issue among them, unworkable; a credit refusal never counts against an issue, any other refusal is bounded at three, the first assignment of a run is checked
  for a refusal (credits exhausted stops the run and the next 30 minutes), a `ci-watchdog` issue is dispatched first, and a run spends at most 170 reads of the shared PAT.
  The repository variable `ASSIGN_COPILOT_SWEEP` = `off` stops the sweep, `new-only` stops the re-drive. A session that
  cannot reach the claim endpoint follows CLAIM-UNREACHABLE-FALLBACK-1 above. The owner is removed again from the pull requests those sessions open by COPILOT-PR-LIFECYCLE-1
  (`.github/workflows/copilot-pr-lifecycle.yml`). GitHub's REST call that approves a workflow run refuses every run the Copilot agent queued on a branch of this repository
  (403, 9 of 9 sweeps on 2026-11-01), so no finished Copilot pull request ever had a required check and the lane could not merge any; KICK-GATED-CHECKS-1 starts those checks
  instead with one `update-branch` of the fleet user credential, pinned to the head, for a finished pull request that changes no DENY_PATHS file (`scripts/copilot-pr-lifecycle.mjs`).
  A Copilot pull request that changes `.github/`, `scripts/`, yaml, a manifest or a shell file is not started: redo it through the code loop. A finished Copilot draft that changed
  no file is closed 30 minutes after its session ended (EMPTY-FINISHED-DRAFT-1; the lane's BH-EMPTY-DRAFT-1 waits 6 hours), which frees one of the 12 open-pull-request slots of the
  assignment sweep. Do not edit the title or body of a Copilot pull request by hand: the `edited` run of `lane-poke` is held at `action_required` and the pull request reads
  `unstable` (the lane refuses it) until its next push; `PUT /pulls/{n}/update-branch` pinned to the head clears it. Do not add per-repository copies of the workflow or of the secret.
- Every ready pull request into main gets the Copilot reviewer requested by `.github/workflows/request-copilot-review.yml` (REQUEST-COPILOT-REVIEW-1, lever 1 of LANE-WAITS-FOR-REVIEW-1,
  issue 5515): the workflow token first, the fleet user credential second. A request never blocks a merge: the lane refuses a pull request while a check that is not required has
  failed, so both request steps are `continue-on-error`. A draft is not reviewed. Still open on the issue: hold the merge when the reviewer's review of the head lists a High severity
  item, never wait more than 8 minutes for a review that has not arrived, feed the findings to the code loop.

## Closed loops (CLOSED-LOOPS-1, owner rule 2026-11-04)
- Every problem found gets its solution implemented, deployed and verified in the same piece of work. Every item, bullet, issue and PR is a closed loop: owner, fix, live evidence, closure.
  Never report a problem without its implemented fix, and never lose a loop. If a fix is truly blocked, say exactly what blocks it, give it an owner and a closing probe, and keep working on everything else.
- In the fleet this is live code: `fm-open-loops-unclosed` (migrations/2026-11-04-closed-loops.sql) reads open issues with no doer and closes without `close_evidence`, hourly. It adds no owner card and no gate.
