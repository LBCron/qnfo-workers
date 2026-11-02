# qnfo-code-orchestrator v0.3.0

## v0.27.0: soft daily-call routing

`ops_config.code_loop_daily_calls` remains the measured routing threshold. At or above
it, work continues on one lane and one step per tick, with the configured coding ladder
ordered by known input/output neuron rates. The cheapest priced rung runs first;
the existing bounded retry/timeout ladder supplies fallbacks. If all configured prices
are unknown, the supported `gpt-oss-120b` rung precedes them. Standalone planning also
uses the cheap route. Below the threshold, model ordering and parallelism are unchanged.
As of v0.27.1, a capped tick scans up to 64 claimable tasks within its existing time
budget to find one executable step. A live claim still defers its task; that deferral
does not consume the one-step allowance or prevent unrelated paths from progressing.
The tick reports `executed_steps` separately from `steps` (which includes deferrals).
Verification, work claims, publication gates, and metric thresholds are unchanged.
`code-task.spend-cap` reports `routed` rather than an idle-until-midnight hold.

One-time terminal compile recovery retains its replay marker and provenance through
fresh reads, including stale-base rereads, so the same task cannot replay indefinitely.
`spend-cap.test.mjs` exercises the actual threshold boundary, complete verified task
progression, fallback, and standalone planning. `verifier-replay.test.mjs` exercises
marker persistence through the actual read step.

## Self-doc (FLEET-SELF-DOC-1)
- **Purpose**: orchestrates the QNFO 100%-cloud autonomous code agent. v0.1.1 is the
  integration slice - reads repos via qnfo-code-agent (GitHub tool server) and executes
  Python in its OWN Cloudflare Container. v0.2.0 adds the LLM plan loop + edit/PR.
- **v0.1.1 (red-team remediation 2026-09-06)**: /task propagates read errors (never a
  silent ok:true on a failed read; HTTP 502 + read.error on failure); honest capability
  label integration-slice (not autonomous-ready - no LLM yet); /exec output caps (64 KiB,
  stdoutTruncated/stderrTruncated); AUDIT_DB cloud_ops_events logging.
- **Capabilities**: github-read (via code-agent), container-exec (own containers binding).
- **Deploy**: see the Deploy section below.
- **Canonical source**: QNFO/qnfo-workers/qnfo-code-orchestrator
- **Secrets** (fail-closed): ORCH_TOKEN (auth), CODE_AGENT_KEY (call code-agent).
- **Bindings**: AUDIT_DB (qnfo-audit cloud_ops_events).

## v0.2.0: durable code-task loop (NOT DEPLOYED; see "Status" below)
The server-side counterpart of a Claude Code cloud session: **compute is disposable, state is durable.**
One task = one file edit, verified deterministically, delivered as a **PR (never to main)**.

```
queued --read--> propose --> verify --(fail, attempts<3)--> propose  (NEXT model on the ladder, error fed back)
                                |--(ok)--> commit --> pr_open
                                |--(3 failed attempts)--> queued after a backoff (1 h, then 6 h), first rung again; after 3 rounds: failed + one fleet agent_issue (SELF-REPAIR-1, 0.3.6)
                                |--(no verifier | no-op proposal | file over 6M chars or over 900k without an anchor | refused path or anchor)--> needs_human
```
- **State**: D1 `code_tasks` (migration `migrations/2026-10-01-code-tasks.sql`; the worker also creates it lazily). Every step is
  bounded and idempotent; a crashed isolate's 90 s lease expires and the next tick resumes the task. FIFO claim.
- **Continuation without a human**: cron `*/10 * * * *` (the CRON-RATE-CEILING-1 floor) runs up to 16 steps / 40 s per tick (CODE-LOOP-2X-1).
- **Model independence + cost**: the ladder is data (`MODEL_LADDER`, comma-separated, cheapest first; default: qwen2.5-coder-32b, then the frontier coders kimi-k2.7-code and glm-5.3 on a failed attempt; LADDER-FRONTIER-1).
  A failed verify escalates one rung and feeds the verifier error back. Queue cap 20, 3 attempts, size caps.
- **Verifiers** (deterministic; a task with no verifier ends `needs_human`, never an unverified PR):
  `.py` compile in the Cloudflare Container; `.json` parse; `.md`/`.txt` size-sanity (0.5x-2x, stops truncated rewrites);
  `.js`/`.mjs` syntax via **Dynamic Workers** (`env.LOADER`, `globalOutbound:null`) **only when `JS_VERIFY=dynamic`** (default `off`).
- **Pre-push code-task checks** (pull publishing): the publisher applies the patch to a fresh checkout, then runs `node --check`,
  the changed worker's suites, and `scripts/deploy_gate.py --check` before pushing the branch. Failures return to the proposal
  loop; the checks run on the GitHub Actions runner, not in the Python-only PyContainer.
- **Policy**: refuses `.github/`, `wrangler.toml`, `deploy-targets.txt`, `.env*`, path traversal; never commits to `main`/`master`;
  repo file content is passed as delimited UNTRUSTED DATA.

| Route | Method | Auth | Effect |
|---|---|---|---|
| /v1/tasks | POST | ORCH_TOKEN | enqueue `{repo, path, goal}` -> 202 `{id}` (400 policy, 429 queue full) |
| /v1/tasks, /v1/tasks/:id | GET | ORCH_TOKEN | list / read a task (no file contents) |
| /v1/tick | POST | ORCH_TOKEN | run steps now `{maxSteps, budgetMs}` |
| /v1/probe/dynamic-cpu | POST | ORCH_TOKEN | measure whether the platform enforces `limits.cpuMs` (gate for `JS_VERIFY=dynamic`) |

### v0.2.1: pull-based PR publishing (no PR-write credential needed)
Neither this worker nor a session holds a GitHub PR-write credential, and a session cannot mint one. With `PR_PUBLISH_MODE=pull`
(set in `wrangler.toml`) the `commit` step does not call code-agent: it stores a unified diff in `ctx.patch` and sets
`status='ready_to_publish'` (new status; `step='done'`). `.github/workflows/code-task-publish.yml` then PULLS those rows from D1
(same `CLOUDFLARE_*` secrets as `fleet-autodeploy`), applies each patch on a fresh `codeagent-*` branch off `main` with the built-in
`GITHUB_TOKEN`, opens a PR, and records `status='published'` + `pr_url`. It runs on `workflow_run` of `mirror-sync` /
`fleet-autodeploy` plus `workflow_dispatch` (GitHub `schedule` never fires on this repo). It never merges. A patch that no longer
applies (main moved) becomes `publish_failed` with `last_error` and the run goes red. Re-runs are idempotent (compare-and-set claim,
existing PR for the branch is adopted). Offline selftest (no network, real git + sqlite3, also a workflow step):
`python3 scripts/code-task-publish.py --selftest` covers no tasks, patch applies, patch fails, duplicate publish. Without
`PR_PUBLISH_MODE=pull` the original code-agent path (`pr_open`) is unchanged. Statuses: `queued | ready_to_publish | publishing | published | publish_failed | pr_open | needs_human | failed`.
Only a real run verifies: D1 REST access from Actions, `gh pr create` with `GITHUB_TOKEN` (repo setting "Allow GitHub Actions to create pull requests" must be on), and that PRs from `GITHUB_TOKEN` do not auto-start CI.

### v0.3.0: patch mode for large files (PATCH-MODE-1) and self-gated JS verification (JS-VERIFY-AUTO-1)
Every deployed `worker.js` is larger than the 60,000-char whole-file cap, so until 0.3.0 the loop could not edit any worker.
- **Patch mode.** The model sees a window of the file and answers with exact `<<<<<<< SEARCH / ======= / >>>>>>> REPLACE` blocks;
  the worker applies them to the full file. Each SEARCH must occur exactly once in the window, edits may not overlap, at most 8.
  A wrong SEARCH is a failed attempt whose error is fed back to the next rung of the ladder.
- **Which mode.** With an `anchor` (a verbatim string near the edit, at most 300 chars, exactly one occurrence): patch mode, window =
  about 24,000 chars of whole lines around the anchor, files up to 900,000 chars stored whole in the task row and, since 0.4.0,
  files up to 6,000,000 chars with only the window stored (LARGE-FILE-WINDOW-1 below). Without one: up to 12,000 chars whole-file,
  12,000 to 24,000 patch mode over the whole file, 24,000 to 60,000 whole-file as before, above 60,000 refused (`needs an anchor`).
- **Anchor intake.** `POST /v1/tasks {repo, path, goal, anchor}`, or a second opt-in line in the issue: `code-anchor: <text>`.
- **Worker hygiene done by the loop.** For `.js`/`.mjs` the single `VERSION = "x.y.z..."` declaration is bumped to
  `x.y.(z+1)-codeagent` when the edit left it alone; when `<dir>/deployed-current.worker.js` equals `<dir>/worker.js`, the same
  hunks are emitted for the mirror. `scripts/code-task-publish.py` accepts exactly the task path plus that mirror, nothing else.
- **Patch shape.** A minimal unified diff (Myers over lines, 3 context lines), so it still applies after unrelated lines of the file
  moved on main; a file without a final newline or a change over 600 lines falls back to the whole-file patch.
- **`JS_VERIFY=auto`** (the shipped setting). Once a day the cron runs the CPU-limit probe and stores the result in
  `ops_config.code_orchestrator_dynamic_cpu`. The JS syntax verifier is on only while that row says `enforced: true` and is younger
  than 8 days; otherwise `.js` tasks end `needs_human` as before. `/health` reports `js_verify: auto-on | auto-off`.
  It proves SYNTAX only; CI on the pull request is the behaviour gate, and nothing here merges.
- **Limits that remain.** One file (plus its mirror) per task; the orchestrator's verifier does not run tests in PyContainer
  (the publisher runs worker suites and the deploy gate before pushing); the window must contain everything the model needs; no self-merge.

### v0.3.7: a model that fails is the fleet's problem, not the owner's (SELF-REPAIR-1, agent_issues #1768)
The owner's note on the dashboard card for `ct_qldqse7ngltdth` was "this is not a user problem audit and fix yourself". Measured:
the task's three attempts ran in one 26 s tick on 0.3.1 (qwen2.5-coder's SEARCH matched both of two near-identical lines, then
llama-3.3-70b twice replied with no block). The task went to `needs_human`, which the dashboard shows as an owner card. The frontier
rungs (0.3.3) deployed 5.5 minutes later, but `needs_human` is never retried. In 0.3.7:
- **Rounds with backoff.** A round is `MAX_ATTEMPTS` (3) failed attempts. At the end of a round the task stays `queued` with
  `lease_until` 1 h (then 6 h) ahead, and the next round climbs the ladder from its first rung again, with the last error still fed back.
  After `RETRY_ROUNDS` (3) rounds it is `failed`, and one deduped `agent_issues` row (`CODE-LOOP-EXHAUSTED-1: <task> <path>`, source
  `qnfo-code-orchestrator`) gives the fleet the evidence, the lever, the requeue statement and a definition of done.
  It is never an owner card. `needs_human` stays for refusals no model can fix: path, anchor, verifier coverage, no-op, and the merge runner.
- **Feedback that names the places.** A SEARCH that matches several times is reported with the line numbers and the start of each line.
- **Diagnosable no-block replies.** The error says whether the reply was empty, cut off inside `<think>`, held an unclosed SEARCH,
  or was prose, and the head of the reply is kept in `ctx.lastReply`.
- **Offline proof.** `node --no-warnings qnfo-code-orchestrator/self-repair.test.mjs` replays the task on a 93 KB fixture with q08's
  two lines verbatim, through to a patch that `git apply`s, and runs the dashboard's own owner-card query against the result.
  Against 0.3.5 it fails 24 of 34. Wired into `deploy-gate`, `code-loop-test` and `deploy-code-orchestrator`.
- **Metric.** `code_task_success_rate_30d` counts `failed` as finished and not merged
  (`migrations/2026-10-02-code-loop-self-repair.sql`), so a hand-off cannot make the rate look better.

### Status (what is and is not true)
- **Verified offline** (`node --no-warnings qnfo-code-orchestrator/test-loop.mjs`, 35 assertions, also run in CI as `code-loop-test`):
  the whole state machine against real SQL and real `python3`, model escalation with error feedback, lease resume + FIFO, policy
  refusals, cron path, prompt-injection delimiting, `wrangler deploy --dry-run` accepts the config and bindings.
- **Dynamic Workers behaviour** was measured on the real `workerd` (wrangler 4.145): JS syntax errors fail the start as
  `Uncaught SyntaxError ... at m.js:L:C` even with unresolvable imports; valid syntax + missing import fails later (`No such module`);
  `globalOutbound:null` blocks fetch. **Local workerd did NOT enforce `limits.cpuMs`** (a top-level `while(true){}` hung), so the
  verifier races a 4 s wall clock and ships OFF. The test's fake `LOADER` replays those real error strings; it is not workerd.
- **Verified live (2026-10-01)**: this worker is deployed (`GET /health` reports version 0.2.4 with the AI, AUDIT_DB and container bindings) and one task, `ct_smoke20261001a`, ran read -> propose -> verify -> ready_to_publish -> published on live Cloudflare and was delivered as pull request 297 through `code-task-publish.yml`.
- **Verified live (2026-10-01)**: this worker is deployed (`GET /health`) and tasks `ct_smoke20261001a` and `ct_ge5mddlm9z6915` ran
  read -> propose -> verify -> ready_to_publish -> published on live Cloudflare and were delivered as pull requests 297 and 368
  through `code-task-publish.yml`. `ct_readme20261001b` failed live and exposed FENCE-IN-FILE-1 (fixed in 0.2.6).
- **NOT verified live**: patch mode and `JS_VERIFY=auto` (0.3.0, offline tests only), real LLM output quality beyond one-line edits,
  and CPU-limit enforcement on the real platform (the worker now measures it itself; see below).
- **Not built**: GitHub webhook wake-up (CI/review events resuming a task), multi-file edits, a verifier that RUNS tests, the
  `qnfo-code-agent` deploy. Deploy must use a wrangler workflow (this worker has `[[containers]]` + a Durable Object; the canonical `/content` PUT destroys those bindings, see `qnfo-containers-pilot/RETRIGGER-4-DO-BINDING-LOST.md`), and `qnfo-code-agent` needs a GitHub credential with PR-write.

### v0.4.0: a file of any size is edited from its anchor window (LARGE-FILE-WINDOW-1, agent_issues 2073, lever T1.22)
Until 0.4.0 a file over 900,000 chars ended `needs_human` as "too large for the loop", because the base file and the task context had
to fit one D1 row together: `qnfo-research-exec/worker.js` (1.03M chars, issue 2052) and `qnfo-agent-ws/worker.js` (2.4M) were
out of the loop's reach, and the planner refused them too.
- **What is stored.** Over 900,000 chars (up to 6,000,000) the task row keeps `ctx.win_text` (the anchor window, about 24,000 chars),
  its offsets, `base_len` and the anchor; never the base. An anchor is required (no anchor: `needs_human` with the reason).
- **Every later step re-reads main** (`baseFor`): propose, verify and commit each read the file again and find the window text
  again, exactly once. A window that moved (lines added above it) is re-located and `ctx.win` updated (`ctx.moved`); the edits and
  the patch are therefore always built on the current file. A window that is gone or ambiguous sends the task back to `read` from
  the anchor (`code-task.reread`, at most 3 times), after which the task ends `needs_human`.
- **Unchanged below 900,000 chars**: the base is stored as before, so the pre-0.4.0 path and its suites are untouched.
- **Planner**: `PLAN_FILE_MAX` now equals the 6,000,000 cap, so ISSUE-PLANNER-1 may plan a large worker.
- **Suite**: `large-file.test.mjs` (1.2M-char fixture): lands with a small hunk that `git apply --check` accepts, a moved window
  is found again and the patch applies to the changed file, a vanished window re-reads then ends `needs_human`, no anchor gets one
  locator pick and then parks, a small file still stores its base, `/health` names the capability.

### v0.4.0 also: the loop locates its own anchor (ANCHOR-LOCATOR-1, agent_issues 2007 second half, human_actions 60)
ANCHOR-REPAIR-1 (0.3.19) repairs an anchor without a model call. What still parked tasks `needs_human` on 2026-10-06: an anchor
that occurs 0 times and cannot be repaired (`ct_qjjo05t4elayld`, qnfo-ipatent), an anchor that occurs twice, and a file over 60,000
chars filed without one. The read step now asks the cheapest rung of the ladder once for one verbatim line among the file excerpts
near the goal's keywords (`planSnippets`, the planner's own excerpt builder, at most 14,000 chars) and takes it when it occurs
exactly once in the file (`code-task.anchor-located`). A pick that is not a unique line parks the task with the old reason plus
`ANCHOR-LOCATOR-1 found no unique line near the goal either`. Small files (whole-file mode) never call it. Suite:
`anchor-locator.test.mjs` (66k-char fixture; no anchor, unrepairable anchor, duplicate anchor, useless pick, small file, `/health`).

## Routes (v0.1.1, unchanged)
| Route | Method | Auth | Effect |
|---|---|---|---|
| /health | GET | none | liveness + version |
| /task | POST | ORCH_TOKEN | code-agent repo/read + own-container python verify; 502 + read.error on read failure |
| /exec | POST | ORCH_TOKEN | own-container python -c (output-capped) |

## Claim-sheet
- claim: own-container python exec works; evidence: /task exec exitCode 0 + stdout
  'orchestrator-container-ok'; confidence: High (verified same-turn at deploy).
- claim: github-read integration works + errors propagate; evidence: /task read.ok true on
  real file; 502 + read.error on missing file; confidence: High (verified same-turn).
- claim: capabilities label honest; evidence: /health integration-slice, no autonomous-ready;
  confidence: High.

## Roadmap
- v0.2.0: LLM plan loop (DeepSeek via AI Gateway for plan/verdict, kimi for cheap rounds),
  code-agent /v1/repo/edit + create_pr, bounded iterate until container verify passes.

## Deploy
First and subsequent deploys use `.github/workflows/deploy-code-orchestrator.yml` (wrangler 4, this worker only), on push to main touching `qnfo-code-orchestrator/**` or via workflow_dispatch. The canonical `/content` route cannot create bindings, containers or DO classes. The job runs `node --check`, `test-loop.mjs` and `scripts/mirror-guard.py`, deploys, polls `/health` until VERSION equals worker.js, and writes a `deploy.wrangler` row to `cloud_ops_events` through the D1 REST API. It uses the existing `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets and sets none. `ORCH_TOKEN` stays unset (fail-closed). The cron runs every 10 minutes (144 per day).

## Keyless read (0.2.2, KEYLESS-READ-1)

The loop's read step used to call `qnfo-code-agent` with `CODE_AGENT_KEY`, which is deliberately unset, so every task failed before
reaching a model. `readRepoFile` now uses the code-agent only when that key exists and otherwise reads the file from GitHub's public
raw endpoint (`raw.githubusercontent.com/QNFO/<repo>/main/<path>`). The owner is pinned to `QNFO`, the repo name and path are
validated (no traversal, no absolute paths, no query strings) before any request, and the size cap is unchanged. With the pull-based
publisher, the loop now needs no GitHub credential at all, in either direction.

## Issue intake (0.2.4)

The Cloudflare equivalent of the Stop-hook re-prompt. Each cron tick scans open `agent_issues` rows whose description carries an explicit opt-in line:

    code-task: repo=qnfo-workers path=docs/some-file.md

Each such issue becomes one queued code task (goal = `[issue #N] <title>` plus the description). It is deduped by the `[issue #N]` prefix, at most two are created per tick, and a refused marker (protected path, bad repo) is logged once per isolate. Nothing is inferred from prose, and the PR is still opened by `code-task-publish` and never merged by this worker.

## 0.12.0: loop quality and multi-file tasks (2026-10-12)

Read from the last 40 failed `code_tasks` rows; each lever has its replay in `loop-quality.test.mjs` or `multi-file.test.mjs`.

- **MULTI-FILE-CODE-TASKS-1** (issue 2074): `POST /v1/tasks` takes `extras: [{ path, anchor? }]`, up to three companion files in
  the task path's directory (its `*.test.mjs`, a README, a JSON file) or `migrations/<name>.sql`. The model answers with blocks
  under `FILE: <path>` lines; a file that does not exist is written by one block with an empty SEARCH. The companions that
  change are parked in the same patch and named in `ctx.paths`; the publisher allows exactly those. An issue line
  `code-task: repo=<repo> path=<a> path=<b>` (the n-th `code-anchor:` line belongs to the n-th path, `-` for none) is taken by
  intake only while `ops_config code_merge_multi_file` is `on`: the merge runner must allow `ctx.paths` first.
- **DANGLING-REF-GATE-1**: a proposal that calls a function defined nowhere in the file, or removes a top-level declaration
  the file still uses, goes back to the next rung once with the names (`code-task.dangling-refused`); the same name a
  second time is let through (`code-task.dangling-passed`).
- **REPAIR-SHOWS-EDITS-1**: a retry after edits that applied (verify failure, publisher parse or suite failure, merge-runner
  repair round) shows the model its previous edits.
- **WINDOW-LONG-LINE-1**: the window is no longer stretched to the ends of very long lines; a cut edge line is announced.
- **SEARCH-NEAREST-BLOCK-1**: a SEARCH that matches nowhere is shown the file's own lines where one of its lines occurs.
- **VERIFY-DEFER-PUBLISHER-1** (issue 2008): a JavaScript proposal this worker cannot verify is parked with
  `ctx.verify_deferred`; the publisher runs `node --check` and the worker's suites before any push, and refuses to push it
  from a runner without Node.
- **GOAL-VERSION-1**, **ANCHOR-KEYWORD-FALLBACK-1** (issue 2007): the goal's next VERSION is used; a failed locator pick or
  call falls back to the unique line that holds the goal's earliest keyword.
