# Every deploy proves itself (DEPLOY-PROBES-1, REVIEW-GATE-1; 2026-11-04)

Charter pillar: **autonomy** (output quality of the fleet's own changes), bounded by **cost**. Owner brief 2026-11-04: raise output quality by making every deploy
prove itself and by adding an independent, cheap review gate for risky code before it merges. Items (a) measure, (b) post-deploy probes, (c) review gate,
(d) pre-merge parity. Item (d) is built by the PR-VELOCITY-1 session (`scripts/pr_fast_guards.py`, `scripts/regression_gate.py`); this document records what the
measurement says it must cover and does not duplicate it.

## (a) What the last 7 days say (2026-10-28 18:00Z to 2026-11-04 18:00Z, 799 merged pull requests)

Full report with ids: the session notes `deploy-proof-measure.md`; the numbers that decided the design:

| Measure | Count |
|---|---|
| Merges whose own push run had a failed workflow | 666 (83%), 659 of them deploy-gate. deploy-gate was red on every push for 47.7 h (358 merges) |
| "Red main within 24 h of a merge" | 100% of merges, so the count carries no signal; the signal is the merge that turned a green check red (52 merges named in 39 incidents) |
| Reverted within 24 h | 1 (#6323, automatic, after 9.5 min: the VERSION canary worked) |
| RUNTIME-PROBE-FAIL-1 issues | 7, none attributable to a merge with evidence (stale page markers 3, load timeouts 4) |
| Hotfix or follow-up within 24 h | 32 merges (4.0%); 2.4% before MERGE-WHEN-READY-1 (#6928), 14.3% after (lower bound: 416 Copilot PRs have empty bodies) |
| Checks that were advisory on a pull request | all 170 deploy-gate steps (`continue-on-error` on `pull_request`) |

Which check would have caught the 39 incidents before the merge (a check can catch several): baseline-diff PR gate 16, **D1 compile probe 8**, **post-deploy route probe 7**,
required-check presence 5, independent AI review 4, head-pinned merge 3, merge queue 2; five had no cheap catch. The two largest runtime-effect classes
(a dead `fleet_tick` for 24 min, `no such table: issue_assignments`, five migrations that applied "ok" or failed at apply) are D1 compile errors, which no suite saw.

## (b) Post-deploy probes: `<worker>/probes.json`

```json
{ "mode": "revert",
  "health": "https://x.q08.workers.dev/health",
  "http": [ { "url": "https://x.q08.workers.dev/y", "status": 200, "contains": ["marker the page really shows"], "absent": ["Internal Error"] } ],
  "d1":   [ { "binding": "DB",
              "explain": ["SELECT 1 FROM v_issue_queue LIMIT 1", "INSERT INTO fleet_tick (source) VALUES ('probe')"] } ] }
```

* `health` opts a worker outside the control plane into the VERSION poll the canary already ran for the seven control-plane workers.
* `http`: a GET from the GitHub runner (outside the account, so no issue-1190 artifact), status and markers, whitespace-insensitive, 4 tries 15 s apart, with a cache-busting
  `_dp=<epoch>` query parameter. Hosts are limited to the fleet's own (`*.q08.workers.dev`, `qnfo.org`, `q08.org`, `qwav.org`, `qwav.tech`), a redirect off those hosts is refused
  (status 599), no secret in the query, no space, control or non-ASCII character anywhere in a URL or marker, GET only. A bare 200 is refused: the 2026-11-04 liveness miss was a
  page that answered while the probe looked for the old page's text. Routes backed by D1 are best left out of a `revert` probe (the dashboard's `/api/managers` was): under a D1
  overload they answer errors that say nothing about the deployed code.
* `d1.explain`: `EXPLAIN QUERY PLAN <SELECT | WITH | INSERT | UPDATE | DELETE>` on the worker's own D1 binding. SQLite compiles every view and every trigger body when a
  statement is prepared, so this surfaces a view that reads a missing column, a trigger on a missing table and `triggers nested too deep`, and **never executes the statement**
  (one single-line statement per entry, no `;`). The first draft ran `INSERT ... WHERE 0` for real; the independent review showed that shape can still write a row
  (`SELECT ... ON CONFLICT DO UPDATE ... WHERE 0`, `-- WHERE 0`, `UNION ALL`), so the probe type was removed: compile-only is enough, since `EXPLAIN QUERY PLAN INSERT INTO
  cloud_ops_events` returned the same `triggers nested too deep` as the real zero-row insert. Private databases are refused by name, by `database_id` (collected from every committed
  wrangler.toml) and when a binding has no `database_name`: the run log is public.
* A D1 error is a failure only when it is a compile-class error (`no such table|column|function`, syntax, `triggers nested too deep`; tested before the transient words, so `no such column:
  timeout_ms` is a failure). `D1 DB is overloaded`, a timeout, a request that failed at the runner (status 0), HTTP 429/502/503/504/522-524/530 and a body that says the platform was
  overloaded are **inconclusive** and never revert (a 500 or a 1101 page from a worker that threw is a failure). Anything that raises inside a probe is inconclusive with a one-line
  reason: an exception used to abort the whole canary silently, so a push that also failed its VERSION was not reverted.

Flow (`canonical-deploy.yml`, `scripts/canary_revert.py`, `scripts/deploy_probes.py`):

1. Before the deploy: `deploy_probes.py --baseline` runs the declared probes of the workers about to deploy (two tries each, 90 s in all, one worker's trouble never costs the others
   theirs) and stores `{worker: {probe key: state}}` plus the worker's live `/health` VERSION. `fail-marker` means the page answered but a marker was absent.
2. After the deploy: the canary polls VERSION (control plane and every worker with `health`), then runs the probes inside a 300 s budget per worker. Per probe: passed before and fails
   now = **regression**; declared in the parent commit and already failing before = **pre-existing** (filed, never reverted); a probe this very change declares that already failed with
   `fail-marker` in the baseline = a **mistyped marker** (filed, never reverted); a new probe whose route did not exist (404 before) or any failure without a baseline = regression.
3. A regression in a `revert` worker reverts the push through the existing path (`git revert`, VERSION re-bumped above the bad one, mirror kept identical, redeploy dispatched).
   **New in this change:** the redeploy also covers the other workers the revert changed (a multi-worker pull request used to leave the unfailed workers live on code main no longer
   carried). Not reverted, only filed: a worker the push *created* (a revert would delete files of a worker that stays deployed), `mode: "observe"`, a verify-only dispatched run, a
   worker a later push has since changed (that push's canary owns the verdict, like CANARY-AHEAD-1), a worker the pushed commit did not touch (its failure belongs to an earlier,
   cancelled push whose workers rode this run: reverting this commit would hit the innocent one and keep the bad code), a baseline taken after the deploy (the live VERSION before it was
   already the pushed one: a later push installed main's tip first), a new D1 probe in a push that also changes `migrations/` (the migration may not have applied yet), an inconclusive answer.
4. Evidence: one `cloud_ops_events` row (kind `canary-functional`, per-probe states) per run; a revert files `DEPLOY-PROBE-REVERTED-1` (`CONTROL-PLANE-REVERTED-1` when a control-plane worker
   failed), a failure that reverted nothing files `DEPLOY-PROBE-FAILED-1` (the title carries no sha, so repeated runs dedupe on the open title). Both carry the failing probe, and for an HTTP
   probe a `runtime-probe:` line, which D1 turns into a runner-https contract: the hourly remediation tick closes the issue when the route answers its marker again. Every probe-derived
   string is collapsed to one line before it reaches the issue text, which agents read (a `contains` marker with a newline and `code-task:` could otherwise inject a task).
5. PR time (`scans` job of pr-checks.yml, no new check): `deploy_probes.py --check-pr` (about 2 s) validates every declaration against its wrangler.toml and requires one for a changed
   `worker.js` unless the worker is on `scripts/probes-allowlist.txt` (which may only shrink against the base commit) or the description carries `probes: none (<reason>)`; when the
   scripts that can revert main or hold a pull request change (`canary_revert*`, `deploy_probes`, `review_gate`, `*/probes.json`, the deploy and lane workflows) their offline suites run
   too (about 15 s). The PR template says so.

Rollout: 30 workers declare probes today (the seven control-plane workers keep the routes the canary always checked, now in their own file, plus D1 statements for fleet-control, ops,
deploy-guard and code-orchestrator; the dashboard, idea-hub and q08-signal-engine declare their public pages; 20 more declare the `/health` VERSION poll). Six live workers are on the allowlist.
`deploy-code-orchestrator.yml` (the container worker's own deploy) runs the canary without a baseline, so any failure of qnfo-code-orchestrator counts as a regression there (stricter, not looser).

**First live finding.** Testing the D1 probes against production on 2026-11-04 found a live outage no check had seen: a plain `INSERT INTO cloud_ops_events` failed with
`triggers nested too deep` from the moment migration `2026-11-04-cloud-ops-events-trigger-cost.sql` applied (18:57:08Z) until about 19:26Z, while `INSERT OR IGNORE` kept working. Writers that use a
plain INSERT (`ops_ai_tool` 107 rows in the prior 90 min, `code-task.intake`, `code-task.spend-cap`) logged nothing for ~30 minutes. Filed as agent_issues 1001789 with a d1-query closing probe;
the qnfo-ops `explain` probe on `cloud_ops_events` now guards the statement.

**Drill.** `scripts/canary_revert_test.py::DrillEndToEnd` replays a deliberately bad deploy against a scratch git origin and a local HTTP server: the worker's `/health` answers the pushed VERSION
(the old canary would have passed it) while its declared route lost its marker. `canary_revert.run` reverts the push on origin/main, re-bumps the VERSION to `1.0.2-revert-<sha>`, keeps the
mirror identical, restores the previous page and dispatches the redeploy of both the failed worker and the bystander. `ProbeFlow` (13 cases) covers the cases that must not revert.

## (c) The review gate: `scripts/review_gate.py`

For a pull request whose diff touches a workflow or migration file (whatever its name), or adds or deletes lines about auth, a route condition, the Cache API or a trigger/view, or has a
file GitHub withheld, the diff (mirror files dropped, 60 000 characters, each file first gets an equal share so padding cannot starve the vulnerable one, per-category score cap) goes to two
Workers AI models of disjoint families with an adversarial brief (auth bypass, injection, cache audience, double submit, null handling, ORDER BY/LIMIT, retry storms, trigger or migration
depth, workflow permissions): **glm-5.3-flash** (`reasoning_effort: low`) and **llama-3.3-70b**, each reading the diff in chunks of about 14 KB (at most four, every chunk repeats its
file header). Measured on a 1.3k-token excerpt before choosing: glm with the default effort,
gemma-4-26b-a4b with thinking on, qwen3-30b-a3b and kimi-k2.7-code spent 3 000 to 4 000 tokens reasoning and returned no content; gemma with thinking off found one dubious item.
Cost about $0.012 a run (15k tokens in, 1.5k out at the ladder prices), at most 80 heads a day (a ledger row is claimed before the models are called, so a repeated lane event for the same head,
a clean result and a no-model result all cost nothing the second time), recorded in `cloud_ops_events` kind `review-gate`. The models run in daemon threads with a hard join.

* Every finding needs a file in the diff, a trigger of 40+ characters and a fix; a High finding also needs an `evidence` line that is, whole or as a 24+ character fragment, an **added**
  line of the diff (a deleted or unchanged context line demotes it to Medium). The HOLD decision is made by code from the verified findings, not by the model.
* **Only a High that both model families reported holds** (v2, after the first live replay below). Agreement means the same file and the same line, or title and trigger sharing a fifth
  of their words; a High from one family is shown in the comment, labelled `(llama only)`, and counted in the header as "from one family only".
* A surviving confirmed High item posts a comment that starts `HOLD:` (the merge step of pr-lane.yml counts every such comment; the stale-PR lane honours it). A new push releases it: the gate edits its own
  earlier HOLD comments so they no longer start with `HOLD:`; a collaborator's comment `override review-gate: <reason>` (or `hold released`) does the same. Only comments by the gate's bot
  login (`github-actions[bot]`) count as the gate's, so a marker or a HOLD typed by anyone else neither skips the review nor gets edited. Model text is defused before it is posted: the stale-PR
  lane's own hold and release phrases (`hold:`, `resolved`, `hold released`, ...) get a zero-width space, long token-like strings are redacted, @mentions are defused.
* It runs as a step of the `lane` job, on the event that is about to merge (checks green), before the merge step: no race with the merge, no extra check entry, and it **fails open**
  (no credential, a model outage, an unparseable answer: a log line, the merge goes on).
* Ships in **observe** mode (`REVIEW_GATE_MODE`, repository variable, default observe): the comment starts `review-gate (observe):` and nothing is held. It moves to `hold` after the
  replay below.

Replay (workflow `review-gate`, dispatch only): `scripts/review-gate/v3-dash-pre-review.diff` is the three-screen dashboard block exactly as the independent subagent reviewed it
(`git diff b2e0ed0b^ cc90bf553`, 339 added lines); `v3-dash-pre-review.json` lists the 9 defects fixed afterwards in d921ce3a0 with keyword rules. Honest limits of that number: the brief
names several of the same defect classes (it is the brief of that review), the regexes are keywords, so the recall printed is an upper bound and the findings are printed for a human to
read; it is not the criterion for `hold`. The `commits` input runs the gate on merged commits no fix followed (false positives). Results are appended below once run.

### Replay and false-positive run, v1 (2026-11-04, dispatch run 41911181555, $0.045 for 15 gate runs)

| Measure | Result | Reading |
|---|---|---|
| Recall on the 9 known dashboard defects (47 KB in one call) | **1 of 9** (D4, keys to strangers; llama) | poor: glm returned "no parseable answer" (it spent its 4000 output tokens and was cut off), llama gave 3 generic findings |
| False positives: High findings on 14 merged commits no fix followed | **4 of 14 commits** | all four from llama, all generic ("Unauthenticated access to internal data", "Unrestricted SQL query", "Unauthorized retry", "Deterministic D1 error retry"); glm gave no High on any of the 14 |
| glm Medium/Low findings on those 14 | 28 | read by hand, several are real classes: a migration that is a silent no-op when rows pre-exist, a retried ledger INSERT that can duplicate rows, a paginated HOLD-comment count that is per page |
| Cost | $0.0449 for 15 runs | about $0.003 a run, below the $0.012 planned |

So v1 would have held 4 of 14 clean pull requests on one family's generic claim and found 1 of 9 real defects: **not fit for `hold`**, and `REVIEW_GATE_MODE` stays `observe`. v2 (this section's
changes: a cut-off answer keeps its complete findings, glm gets 8000 output tokens, chunks of 14 KB instead of one 47 KB call, a sharper brief that forbids category-only findings, and the
agreement rule above) is measured by dispatching the same workflow again; the numbers go below before any flip.

## What this does not cover

* A probe proves the routes and statements it names, nothing else; a worker with only the `/health` starter is covered for "the new VERSION is serving", not for behaviour.
* The D1 probes prove the statement compiles, not that its result is right; a trigger that RAISEs at run time needs a scratch replay.
* A revert restores the whole pushed commit: a bystander's change in the same pull request is reverted with the failing one (and now redeployed, but its VERSION line goes back to the old
  value while a newer one is live); an applied migration file disappears from main; a commit that changes `.github/workflows/` cannot be pushed by `GITHUB_TOKEN`, so its revert reports
  "could not be reverted"; a rebase-merge reverts only the tip commit.
* A probe weakened in the same pull request (deleted, `mode: observe`, an invalid file) leaves that push unchecked: declarations are read at the pushed commit. Review sees it in the diff.
* The review gate reads the diff, not the repository: a defect that needs code outside the hunks is invisible to it. Two models of different families still share blind spots
  (`docs/ENSEMBLE-POLICY.md`: a 9-judge panel was worth 2.18 votes); the evidence rule trades recall for precision.

## First live drill, 2026-11-04 (#7208): the detection worked, the revert did not, and why

`qnfo-evolve` 0.2.8 was merged on purpose with `/health` reporting `"worker":"qnfo-evolve-drill"` (nothing else changed). canonical-deploy run 41911551981:
baseline read `{"f87f94d66cce": "ok", "__live_version__": "0.2.7"}` at 20:58:03Z; the deploy was `OK` at 20:58:16Z; the canary saw `qnfo-evolve ok (wanted 0.2.8, saw 0.2.8)` (the old canary
would have stopped here, green) and then `functional qnfo-evolve failed (GET .../health: marker "worker":"qnfo-evolve" absent, 4 tries)` at 20:59:03Z, wrote the ledger row, and tried to
revert. **The push of the revert to main was refused**: `GH013 Repository rule violations found for refs/heads/main: Required status check "Workers Builds: qnfo-workers" is expected`. The
`require-build` ruleset was created today at 15:47Z with the repository admin role as its only bypass actor, so the Actions token cannot push to main any more; the automatic revert
path that worked on 2026-11-03 (#6323) has been dead since, for every control-plane worker too, and nothing had exercised it. The drill is what found it. The bad `/health` stayed live
until the same revert was made by hand as a pull request (#7212, merged, live again at 21:05Z, about 7 minutes).

Two defects fixed in the follow-up: (1) when a direct push is refused by a repository rule the canary now pushes the revert commit as a branch and opens it as a pull request with the fleet
credential (so the lane's workflows run on it), the lane merges it and the push it makes deploys the reverted code; the direct push is still tried first, a refusal is not retried, and
`DrillEndToEnd`'s sibling `RevertThroughPullRequest` replays the refusal with a pre-receive hook; (2) the issue text claimed "reverted" whenever the local revert commit existed, even when
its push had failed (`{"error": ..., "sha": ...}`): an error is now a `...-CANARY-FAILED-1` issue that says nothing was reverted. Issue 1001819 (filed by the drill) carries the
`runtime-probe:` line and closes itself now that the route answers its marker again.

## Second live drill, 2026-11-04 (#7232): a bad deploy reverted with no human step

Same deliberate change on `qnfo-evolve` (0.2.10, `/health` reports `"worker":"qnfo-evolve-drill"`), now with the revert-through-a-pull-request path of #7215. canonical-deploy run
41915959542 (merge a3396887): baseline `{"f87f94d66cce": "ok", "__live_version__": "0.2.9-revert-49ce59b"}`; deploy `OK` 21:25:50Z; VERSION 0.2.10 arrived; the route failed its marker over
4 tries; the direct push of the revert was refused and the canary opened **pull request #7234** by itself (21:26:43Z, `revert: a339688 failed the functional canary on qnfo-evolve`, VERSION
`0.2.11-revert-a339688`, opened with `QNFO_GH_PAT` so the lane's workflows ran on it); the lane merged it at 21:27:42Z; the push it made deployed the reverted code, whose own canary
(run 41916304809) read `functional qnfo-evolve ok (every probe passed)` at 21:28:19Z. `/health` answers `"worker":"qnfo-evolve"` again. **Bad version live: about 2.5 minutes, human steps: none**
(drill 1: ~7 minutes and a hand-made revert). The old canary would have passed this deploy: the VERSION arrived.

## Follow-up owed (CLOSED-LOOPS-1)

* After 7 days: counts of `canary-functional` rows (ok / fail / inconclusive), `DEPLOY-PROBE-*` issues, reverts, and `review-gate` rows (cost, High findings, how many a human overruled) against the
  7-day baseline above; flip `REVIEW_GATE_MODE` to `hold` when the false-positive run and the week agree.
* Workers on `scripts/probes-allowlist.txt` shrink by one line each time a PR declares probes for them.

### Live observe-mode data, first 45 minutes after #7207 merged (cloud_ops_events kind review-gate)

12 pull request heads reviewed by the gate in the `lane` job (PR 7210 to 7242): 4 got a High (7213, 7215, 7216, 7233; v1 rules, observe mode, nothing held), 8 none; 1 run had a model fail
(glm unparseable, PR 7211, `status partial`); cost $0.0497 in all (mean $0.004, range $0.002 to $0.010); wall time 9 to 95 s per head, inside the lane's 4-minute step cap; no merge was delayed.
The review of this work's own #7215 is the one verdict checked end to end: its High (glm) said the ruleset's `Workers Builds` check never reports on a revert pull request, so it could never merge
- **refuted** by the next drill (#7234 merged in 59 s); a Medium said GitHub queues every push run when `cancel-in-progress` is false - **wrong**, GitHub keeps one pending run and replaces older
pending ones; a Medium said the merge push would not deploy if GITHUB_TOKEN merged - **moot**, the lane merges with the PAT (drill 2 deployed it); a Medium said `create_pr` silently falls back
to GITHUB_TOKEN when `QNFO_GH_PAT` is unset - **right**, fixed in the follow-up (the outcome now says no workflow runs on such a pull request and to merge it by hand). One real finding in four, one
false High: the gate is a useful second reader and a poor judge, which is what the agreement rule and observe mode encode.

`SELECT * FROM v_deploy_proof_7d` (migration 2026-11-05-deploy-proof-7d-view.sql) is the seven-day read-out the owner brief asked for: probe runs and failures, reverts, failures filed, canary
failures, review-gate runs and cost, and `WORKFLOW-FAILED-1` issues as the red-main proxy. Read it again on 2026-11-11 against the baseline in section (a).

### Replay and false-positive run, v2 (2026-11-04 21:50Z, dispatch run 41919876632, $0.0509 for 15 gate runs)

| Measure | v1 | v2 | Reading |
|---|---|---|---|
| Recall on the 9 known dashboard defects | 1 of 9 | **7 of 9** (D3 claim-first, D4 keys to strangers, D5 error text to strangers, D6 loop token as owner, D7 ORDER BY LIMIT, D8 single flight, D9 null as 0; missed D1 snooze, D2 fresh reload) | glm found all 7 (llama 2: D4, D9). Keyword matching and a brief written from that review make this an upper bound; every finding is printed in the run artifact for a human to read. One glm chunk call timed out in this run. |
| High findings on the dashboard block | 0 | 4 (1 confirmed by both families: "SQL injection in cmd_log table", which is not among the 9; 3 single-family) | the block would be held, partly for a reason that is probably wrong |
| Commits among 14 no fix followed with a High from one family | 4 | 4 (2 glm, 2 llama) | the single-family Highs are unchanged, and under the agreement rule none of them holds |
| Commits among 14 that would be **held** (a High both families reported) | 4 (v1 held on any High) | **0 of 14** | the false-positive rate of the hold rule on this sample |
| Cost | $0.0449 / 15 runs | $0.0509 / 15 runs | about $0.0034 a run with up to 8 calls each |

Reading: v2 reads the diff well enough to name 7 of the 9 defects that an independent human review found and 8 minutes of subagent time cost, and its hold rule held none of 14 clean pull
requests. It is **not** flipped to `hold` yet, on purpose: 14 commits is a small sample, the only confirmed High on the known-defect diff is itself doubtful (agreement between families is not
truth), and live observe-mode data after v2 is one day old. The flip is one repository variable (`REVIEW_GATE_MODE=hold`, `gh variable set`); the criterion the fleet applies is: at least 50 live
heads reviewed under the v2 rules in observe mode (`SELECT COUNT(*) FROM cloud_ops_events WHERE kind = 'review-gate' AND ts > '2026-11-04T21:50'`), and every `observe` verdict among them (a High both
families flagged) read by a person or the code loop and judged right.
