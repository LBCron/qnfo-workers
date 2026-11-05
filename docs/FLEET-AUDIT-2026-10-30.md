# QNFO fleet audit, 2026-10-30

Scope: every active repository in the QNFO organisation (51) and under the owner account `rwnq8` (7), 58 in total.
Method: GitHub REST reads, then shallow clones of the 42 active public non-fork repositories (15,959 text files).
Nothing was changed by the measurements themselves; the changes they led to are in section 0. Private repositories are counted and never named (QNFO-PORTFOLIO-1 rule 4).
The measurements can be repeated with the commands in the last section.

Relation to `docs/REPO-UNIFICATION.md` (REPO-UNIFY-1, 2026-10-29): that plan decides where things live (the hub is qnfo-workers, the
ops records are folded in by copy, platform repositories are compared and archive-requested). This audit measures what that plan does
not: committed credentials, security policy, standards, Actions pinning, settings and fork state. Where the two touch, this audit follows the plan.

Settings are owned by `GITHUB-STEWARD-1` (`qnfo-github-steward`), which already enforces the repository merge settings; section 4 lists what it does not yet declare.

## 0. Status on 2026-11-01

Landed since the audit (merged by the owner on 2026-11-01): the removal of hard-coded credential literals from two public repositories (two scripts, one worker configuration value, and 8.4 MB of committed build output: qnfo-skills#17 and qwav-platform#2); the pointer README for the ops records (qnfo-ops#6); the placeholder README of a demo repository (qwav-demo-monna-map-perspective#2); the fix of the GitBook translation archive workflow (gitbook#5). The 39 duplicate assign-copilot workflow pull requests are closed. Open pull requests organisation wide fell from 48 to 16.

Prepared on branches, waiting for a pull request (the identity that prepared them can push branches but cannot open pull requests or update a protected branch): `fleet-audit/security-policy` and `fleet-audit/hygiene` in QNFO/.github; `fleet-audit/hygiene` in QNFO/QWAV; `fleet-audit/licence-name` in QNFO/gitbook and QNFO/infomatics; `fleet-audit/readme-v2.1` in QNFO/license; `fleet-audit/redact-archive-literal` and `fleet-audit/readme` in QNFO/qnfo-skills; `fleet-audit/readme` in QNFO/qnfo-releases; `fleet-audit/dependabot` in QNFO/qnfo-research; `fleet-audit/demo-index` in QNFO/qwav-demos. Each branch is one commit whose message is the pull request description.

Still open and not possible for that identity: changes under the personal account `rwnq8` (a security policy, a duplicate profile file, licence files) and every repository or organisation setting (they need Administration).

The follow-up issues for the hub (this report, GITHUB-STEWARD-2, PORTFOLIO-STANDARDS-1, FAILURE-MODES-GITHUB-1) were accepted but are queued: the assignment sweep reported `open_copilot_prs: 12, capacity: 0, deferred: 161` at 10:19Z on 2026-11-01, drains oldest-first, at most 10 per run, and never above 12 open Copilot pull requests. They are behind 161 issues; a session with write access can take any of them sooner.

Corrections to the first version of this audit, found while preparing the changes: only 2 of the 12 unpinned action references are in a workflow that GitHub runs (`QNFO/.github`, `pub-lang-gate.yml`); the other 10 are in files inside merged project directories that GitHub never executes. The standalone demo repositories are rebuilds of the originals, not supersets, so nothing in `qwav-demos` is a duplicate to delete.

## 1. What was found, measured

| Fact | Value |
|---|---|
| Repositories in the organisation | 130: 51 active (35 public non-fork, 6 private, 10 forks) and 79 archived |
| Active repositories under `rwnq8` | 7 (all public), 53 archived |
| Default branch protected | 42 of 42 active public non-fork repositories |
| Default branch name `master` | 3 public QNFO repositories and 1 personal one (the rest use `main`) |
| Private vulnerability reporting enabled | 51 of 52 active public repositories (off on `rwnq8/ipatent`) |
| `SECURITY.md` | 0 of 42 non-fork repositories (four forks carry their upstream's), and none at organisation level |
| `CITATION.cff` | 6 of 42 (13 of the 17 research-tier repositories lack one) |
| Licence file | 38 of 42 (the four missing are personal: AIOS, play-the-ball-not-the-player, rwnq8, rwnq8.github.io) |
| README names a superseded licence version | 7 repositories, plus `docs/PORTFOLIO.md` in qnfo-workers |
| Workflow files in active public repositories | 82 (67 in qnfo-workers); all 82 declare explicit `permissions` |
| Action references pinned to a full commit SHA | 215 of 227. Of the 12 unpinned, 2 are in an active workflow (`QNFO/.github`, `pub-lang-gate.yml`) and 10 are in files inside merged project directories that GitHub never runs |
| Dependabot configured | 5 of 42; three repositories that have workflows have none |
| CodeQL default setup, last run failed (no later success) | 11 public repositories and 8 forks (Adjust Configuration and Analyze jobs; logs have expired, HTTP 410) |
| Forks | 10 active: 6 are 0 ahead and 0 behind upstream, 4 are 83 to 1,160 commits behind |
| Open pull requests, organisation wide | 48 on 2026-10-30 (16 on 2026-11-01); 39 were the same 19-line workflow, one per repository (a 40th, in qnfo-workers, is a different implementation: a sweep script) |
| Non-default branches in the 9 largest repositories | 178, of which 11 are fully merged |
| Largest repository | `.github`: 97 MB on GitHub, 3,430 files, 156 MB of content: `notes/` 65 MB, `releases/` 53 MB, `publications/` 37 MB |
| Committed build output | `.wrangler-dist/` in qwav-platform (8.4 MB: bundle and source map) |
| Public files containing a local Windows user path | 67 files in 4 repositories (112 occurrences of the owner's machine user path) |

CI is healthier than the raw failure counts suggest: the `ci` workflows of agentic-collapse, ultrametric-lean and ignorance-audit
recovered on 2026-10-08 and the qnfo-skills CI/CD workflow was removed on 2026-07-17. The one failing scheduled workflow is
`Archive GitBook Translations` in gitbook (fix open as gitbook#5).

## 2. Findings, ranked

| ID | Sev | Finding | Action | Doer |
|---|---|---|---|---|
| SEC-1 | P0 | Credential-like literals are committed in two public repositories (four values, in history since 2026-08). Paths are withheld here until the credentials are rotated; they are in the private ledger. | Revoke and re-issue the credentials (identity-bound: only the owner can mint). Three of the four literals were removed from the default branches on 2026-11-01 (qnfo-skills#17, qwav-platform#2); the fourth, in an archived document, is on a branch waiting for a pull request. History rewrite is optional after rotation and is an owner decision. | owner, then fleet |
| SEC-2 | P1 | No security policy anywhere, although private vulnerability reporting is on for 51 of 52 repositories. | Org-level `SECURITY.md` in `QNFO/.github` (branch `fleet-audit/security-policy`, waiting for a pull request); every repository without its own inherits it. The copy for the personal account needs a token that can write there. | session |
| SEC-3 | P1 | Secret scanning and push protection state could not be read (needs Administration read), and the only action that enables them (`github-settings-actions secret-scanning`) covers qnfo-workers alone. SEC-1 shows the gap. | Add the two features to the steward's declared state for every public repository (section 4). | fleet (steward) |
| SET-1 | P1 | "Allow GitHub Actions to create and approve pull requests": only qnfo-workers needs it (conflict-repair, mirror-autosync, code-task-publish). No other active repository has a workflow that opens or merges a PR. | Least privilege: ON for qnfo-workers, OFF in every other public repository, set per repository by the steward (section 4). The organisation value is read and reported, not written: a repository cannot enable the setting when the organisation disables it, and the workflows of the six private repositories were not audited. All 82 workflows in public repositories declare `permissions`, so a read-only default token breaks none of them. | fleet (steward); the owner can also switch it in the repository's Actions settings |
| CI-1 | P1 | CodeQL default setup is stuck failed on 19 public repositories. | Re-run or reconfigure the default setup, or switch it off where the languages cannot be analysed. Archiving the pure-mirror forks removes 5 of the 19. | owner or fleet |
| DUP-1 | P2 | 39 repositories each received a byte-identical workflow (`assign-copilot-on-issue.yml`) in separate PRs. It used `GITHUB_TOKEN`, which cannot assign Copilot (a user token is required). The hub's single org-wide sweep (ASSIGN-COPILOT-ISSUES-1, merged 2026-10-30) replaced the design, so those 39 PRs are dead. | Close the 39 pull requests without merging. | the rollout session |
| DUP-2 | P2 | `qwav-demos` holds the 2026-08-04 snapshot of four original demos. Each also exists as its own repository (created the same day, last demo change 2026-08-06) with a rebuilt version, and those repositories are what the Pages sites serve. They are rebuilds, not supersets (declared function names overlap 4 to 8 percent, titles differ), so the copies are not duplicates to delete. The `qwav-demos` README does not list the family or `monna-map-perspective/`, whose folder README says "LIVE" although its repository never held the demo. | README index of the demo family (branch `fleet-audit/demo-index`); delete nothing. Whether to publish the monna-map demo, and what "canonical home" now means, is the owner's decision. | session, owner |
| DUP-3 | P2 | `.wrangler-dist/` build output is tracked in qwav-platform; `.github/notes/` holds an 18.3 MB photo and a 9.2 MB screenshot. | Build output removed on 2026-11-01 (qwav-platform#2). Relocating `notes/` is an owner decision because `.github` is the publications source. | session, owner |
| DUP-4 | P2 | The DeepChat client-config backup tree is replicated in 5 repositories, 2 of them public (qnfo-ops, qnfo-skills) and 3 private; 67 public files carry the owner's local machine path. This cuts across the personal and research separation. | Decide one home for the backups and scrub the public copies. Not changed by this audit. | owner |
| DOC-1 | P2 | Licence references are stale: "Content License Agreement v1.1" and "ULA v2.0" are still named as current in 7 READMEs; `QNFO/license` README lists v2.0 as current although v2.1 was posted (`LICENSE` is v2.1, 82,527 bytes). | Name and link only; no licence text is touched (ADR-013). Branches prepared in QNFO/.github, QWAV, gitbook, infomatics and license, waiting for pull requests. Sentences that describe licence terms ("non-commercial use only") are left for the owner. | session |
| DOC-2 | P3 | The hand-written part of the organisation profile README links archived repositories as program homes and states licence terms in older wording. | Fix outside the generated `PORTFOLIO-LIVE` block, after verifying each target. | fleet loop |
| FORK-1 | P3 | Six forks have no local commits and track upstream exactly; four are far behind. | Archive request through the portfolio path (REPO-ARCHIVE-1); nothing is deleted. | fleet loop |
| STD-1 | P3 | 3 repositories have no README or only a one-line one; 13 of the 17 research-tier repositories lack `CITATION.cff`. | READMEs for qnfo-skills and qnfo-releases prepared on branches; CITATION.cff generation is a loop task. | session, fleet loop |
| CI-2 | P3 | 2 unpinned references in an active workflow (`QNFO/.github`, `pub-lang-gate.yml`) would block "require full-length SHA pinning"; 10 more sit in inert files inside merged project directories and do not matter to that policy. | Pinned to the commits the tags point at today (checkout v4.4.0, setup-python v5.6.0) on branch `fleet-audit/hygiene`; Dependabot configuration for QNFO/.github, QWAV and qnfo-research on branches; then enable the organisation policy. | session, owner |
| BR-1 | P3 | 178 non-default branches; only 11 are fully merged, because several repositories squash-merge. | `delete_branch_on_merge` is already on for 35 of 42 repositories and unreadable for the 7 personal ones; confirm for the personal ones. | owner |
| META-1 | P3 | The organisation profile has no website, its public email is an outlook.com address while every document names the qnfo.org one, and the domain is unverified. Personal repositories have no topics (0 of 7). | Baseline (website) and owner decisions (email, domain verification, topics). | owner |
| PRIV-1 | P3 | Private repository names appear in public policy text and code (the classifier needs them); the portfolio rule says they are named in no surface. | Reword the policy, or accept the classifier exception explicitly. | fleet loop |

## 3. Looks like duplication, is by design (do not remove)

| Duplicate | Why it exists | Evidence |
|---|---|---|
| `.github` `releases/` and `publications/` in `gitbook` (559 identical files, 36.9 MB) | `gitbook` is the synced mirror: `sync-publications.yml` checks out `QNFO/.github` at `master` weekly and on dispatch | workflow file |
| `LICENSE` identical in 41 repositories | QNFO-PORTFOLIO-1 rule 2: the loop creates it from `QNFO/license` | PORTFOLIO.md |
| `qnfo-ops` and `qnfo-workers/docs/ops-governance/` (98 identical files) | REPO-UNIFY-2: the governance records were copied into the hub on 2026-10-29 and `qnfo-ops` becomes a pointer README, so this duplicate is transitional and already being closed (qnfo-ops#6) | `docs/REPO-UNIFICATION.md`, blob hashes |
| `qnfo-workers/research-code/*` and the standalone agentic-collapse, ignorance-audit, ultrametric-lean | staging, then publication (the repository descriptions say so) | descriptions |
| `deployed-current.worker.js` beside `worker.js` | deploy mirror enforced by mirror-guard | CLAUDE.md |
| Member directories inside qnfo-research and qwav-platform | history-preserving consolidation by `git subtree`, originals archived, not deleted | their READMEs |

## 4. Settings: the steward owns them

`GITHUB-STEWARD-1` (`qnfo-github-steward`, every six hours, with the fleet's personal administration token) already enforces the repository
merge settings and the organisation defaults. A second writer would fight it, so this audit adds no applier: the missing items go into the
steward's declared state (`DESIRED_ORG`, `DESIRED_REPO`, `reconcileRepo` in its `worker.js`).

Read through GraphQL on 2026-10-30 (settings the REST token could not read): in all 35 public non-fork repositories delete-branch-on-merge is on,
only squash merge is allowed and auto-merge is allowed; Dependabot alerts are enabled in all 51 active repositories and none has an open alert;
a security policy is enabled in 0 of 35; `main-safety` rulesets exist in qnfo-research and qnfo-workers; the default-branch check rollup is
red in 8 repositories, all of them forks.

Not declared by the steward today (its own README measured two of them on 2026-10-17 and lists no fix):

| Setting | Declared state to add | Why |
|---|---|---|
| organisation `default_workflow_permissions` and `can_approve_pull_request_reviews` | read and report in `GET /report`; do not write in this change | measured `write` and permissive on 2026-10-17. Writing the organisation default would also change the six private repositories, whose workflows were not audited; a repository can be made stricter than the organisation without it |
| repository `default_workflow_permissions` (public, non-fork) | `read` | least privilege; all 82 workflow files in public repositories declare `permissions` |
| repository `can_approve_pull_request_reviews` (public, non-fork) | `false`, except `QNFO/qnfo-workers` `true` | only conflict-repair, mirror-autosync and code-task-publish open or merge PRs; this is the setting "Allow GitHub Actions to create and approve pull requests" |
| fork repositories, Actions | disabled | ten forks run upstream workflows that fail; 8 show a red default branch |
| fork repositories, code scanning default setup | not configured | the same 8 have a failed `CodeQL Setup` run |
| public repositories, secret scanning and push protection | enabled | `github-settings-actions secret-scanning` covers only qnfo-workers; SEC-1 |
| organisation website | `https://qnfo.org` | blank today |

Behaviour to keep: write only the differences, read the single-repository endpoint, record a refusal and never retry it with another credential,
private repositories untouched. Ship it behind an `ops_config` switch that starts off, read the dry result from `GET /report`, then switch on.
Owner decisions that no worker can take: credentials (SEC-1), two-factor requirement (the REST API accepts and ignores it), domain verification,
the website and public email, personal-repository licences, renaming `master` to `main` where other repositories check it out by ref.

## 5. For the fleet: PORTFOLIO-STANDARDS-1

PORTFOLIO-LOOP-1 grades description, licence and topics. It does not see anything in sections 1 and 2 above. Extend `pfHygiene` in
`qnfo-fleet-control` with these flags for graded public repositories, reported in `GET /portfolio` and never named for private ones:

| Flag | Rule |
|---|---|
| `no-security-policy` | no `SECURITY.md` in the repository and none in the organisation `.github` |
| `actions-unpinned` | count of `uses:` references that are not a 40-character SHA |
| `no-dependabot` | has workflows and no `.github/dependabot.yml` |
| `stale-license-ref` | README names a licence version older than the one in `QNFO/license` |
| `committed-credential` | secret-pattern match on the default branch; the flag only, never the path or value, in public surfaces |
| `fork-pure-mirror` | fork with 0 ahead and 0 behind: propose an `archive-request` row, never act on its own |
| `fork-actions-enabled` | fork with Actions enabled |
| `codeql-setup-failed` | last CodeQL default-setup run is a failure with no later success |

Acceptance: `portfolio.test.mjs` replays a fixture with each flag; the live JSON carries a `standards` block; the flags do not change
the hygiene score until the owner sets a target. Closing probe: `GET /portfolio` returns the block and the count of
`committed-credential` is 0 after rotation. No D1 write path existed for this session, so the `agent_issues` row for this item has to be created by the fleet.

## 5b. Failure modes with no entry in the `failure_modes` registry

The D1 registry holds 469 `fm-` ids (`fm_key`, `failure_mode`, `root_cause`, `remediation`, `detector`). A keyword search of the ids in `migrations/`
finds none for the classes below; `fm-secret-in-config` checks only the D1 table `ops_config`, not git history. Proposed entries, each with the
detector that would have caught it:

| Proposed `fm_key` | Failure mode | Root cause measured on 2026-10-30 | Remediation | Detector |
|---|---|---|---|---|
| `fm-github-user-quota-exhausted` | the REST core quota of the owner's user reached 0 from 09:37Z to 09:46Z; the steward latches `rate_limited` and skips its mirror, sync and portfolio stages | interactive sessions ran repository-wide REST scans under the same user identity that the loops use for administration; GraphQL has its own bucket and stayed at 4,700 of 5,000 | session rule in the agent library: read `GET /rate_limit` (free) first, stop below 1,500, use shallow clones, GraphQL batches and ETags; loops read through the App installation token and keep the personal token for administration writes | steward `GET /tracker` `last_run.rate_limited` true in 2 of the last 6 ticks |
| `fm-committed-credential` | credential literals committed to public repositories since 2026-08 | no secret scanning that covers them (the enabling action covers qnfo-workers only) and no detector over git content | org-wide secret scanning and push protection (section 4); rotation by the owner | `GET /repos/{r}/secret-scanning/alerts?state=open` count above 0 for any public repository |
| `fm-codeql-setup-failed` | a CodeQL default-setup run failed and nothing succeeded after it, in 19 public repositories | not determinable read-only (job logs expired, HTTP 410); the 8 forks inherit the upstream setup | forks: Actions and default setup off; others: reconfigure and read the first job log | GraphQL `defaultBranchRef.target.statusCheckRollup.state = FAILURE` on an active repository |
| `fm-no-security-policy` | no security policy in any public repository | none was ever added although private reporting is on | organisation `SECURITY.md` | GraphQL `isSecurityPolicyEnabled = false` |
| `fm-workflow-token-default-write` | organisation default workflow token `write` and workflows allowed to approve PRs | measured as defects on 2026-10-17, never added to the declared state | section 4 | `GET /orgs/QNFO/actions/permissions/workflow` |
| `fm-licence-ref-stale` | READMEs name a licence version the licence repository has superseded | v2.1 was posted without updating references | branches prepared for the five repositories; loop flag `stale-license-ref` | grep of README licence lines against `QNFO/license` |
| `fm-copilot-credits-exhausted` | Copilot answered an assigned issue with "You don't have sufficient GitHub AI Credits to start a session" (2026-10-31 11:32Z); sessions were starting again on 2026-11-01 | the assignment sweep assigns work without reading the credit balance or the agent's answer | the sweep reads the newest Copilot comment on an assigned issue and stops assigning while it holds that sentence, files one issue, and leaves the work to the code loop | an assigned issue whose newest Copilot comment contains that sentence |
| `fm-copilot-assignment-starved` | new issues are accepted but not worked: at 10:19Z on 2026-11-01 the sweep reported `open_copilot_prs: 12, capacity: 0, deferred: 161`, so an issue filed now waits behind 161 others | the cap of 12 open Copilot pull requests (`maxOpen`) is binding and the queue drains oldest-first, at most 10 per run; the hub also holds 148 open issues against the owner's target of fewer than 100 | owner decision on the cap (it is a cost control) and on the inflow: roll up or close duplicate issues so the queue shrinks; a human-filed priority issue needs a way to jump the queue | sweep `RESULT_JSON` with `deferred` above 0 and `capacity` 0 for more than 24 hours |

## 5c. Copilot pull request path (measured 2026-11-01)

A question raised while preparing this audit: do required checks run on Copilot pull requests without a person clicking "Approve and run workflows"? Measured through the REST API, read-only. There is no permission limitation in the path; the hold on a draft is the intended gate.

- The `pull_request_target` fast path of `copilot-pr-lifecycle` is itself approval-gated for Copilot-triggered runs: 28 of its last 30 runs were `action_required` (2 cancelled).
- The `push` and `workflow_run` fallbacks (the workflow file's own design) are not gated and approve the gated runs: 10 of 10 sweeps in 20 minutes succeeded; the latest reported `copilot_prs 12, skipped {agent-working: 4}, approved [], errors []`; no refusal on `POST /actions/runs/{id}/approve` with the workflow `GITHUB_TOKEN`.
- A pull request is approved only after the agent logs `copilot_work_finished` and only when it changes none of `DENY_PATHS` (`.github/`, `scripts/`, yaml, manifests, shell scripts, Dockerfiles). Two open drafts that add one `migrations/*.test.mjs` each were held only because their agent was still working.
- End to end: of the last 36 Copilot pull requests, 23 merged with 9 to 18 green check runs each. The rollup `{SUCCESS: 1}` on a draft is the agent's own run, not merge readiness: count a pull request as ready only when the required checks conclude success on its head commit.
- The one administrator knob is the repository setting Settings > Copilot > Cloud agent > "Require approval for workflow runs" (user interface, repository administrator). Leave it on: turning it off would bypass `DENY_PATHS`.
- A pull request created by a workflow with `GITHUB_TOKEN` starts no `pull_request` workflows at all (GitHub's recursion rule) and needs "Allow GitHub Actions to create and approve pull requests". Only two such pull requests exist in the organisation (2026-10-01). Open a task's pull request with the fleet's user or App credential when it needs checks.

## 6. Reproduce

```
gh api --paginate "orgs/QNFO/repos?per_page=100&type=all"            # inventory
gh api repos/QNFO/<repo>/community/profile                           # health
gh api repos/QNFO/<repo>/compare/<default>...<upstream-owner>:<default>   # fork drift
gh api repos/QNFO/<repo>/git/trees/<default>?recursive=1             # blob SHAs: identical sha = identical file
gh api graphql -f query='{ organization(login:"QNFO") { repositories(first:100, isArchived:false) { nodes { nameWithOwner isSecurityPolicyEnabled deleteBranchOnMerge squashMergeAllowed hasVulnerabilityAlertsEnabled defaultBranchRef { target { ... on Commit { statusCheckRollup { state } } } } } } } }'   # settings, one call
grep -rhoE "uses:\s*[A-Za-z0-9_.-]+/[A-Za-z0-9_./-]+@[^ #]+" --include=*.yml .github/workflows   # pinning
```
