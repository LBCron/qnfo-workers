# The Quniverse charter (QUNIVERSE-CHARTER-1)

Charter 1.0.14, written 2026-10-01 (1.0.14, 2026-10-08: the Autonomous Operation Doctrine is adopted verbatim and binds the fleet, with its control, belief and SPOF registers, decision log and scorecard in D1, DOCTRINE-1, section 8 rule 13; 1.0.13, 2026-10-08: anti-fragile by default, no hold without live evidence, a red team for every blocker, redundant paths, SLAs in minutes and hours, ANTIFRAGILE-1 and QUEUE-SLA-1, section 8 rule 12; 1.0.12, 2026-10-08: autonomy first, the only owner interrupt is an action both irreversible and identity-bound, enforced on the owner queue and audited hourly, AUTONOMY-FIRST-1, section 8 rule 11; 1.0.11, 2026-10-06: core prompt rule 8 is deleted on the owner's directive (RULE-8-RETIRED-1): spend caps, guard metrics, verification probes and data deletion are the fleet's own decisions, recorded with the reason and a live measurement, while the protections for people outside the fleet stay, section 8 rules 4, 9 and 10; 1.0.10, 2026-10-06: AI spend caps steer model choice and never stop work, BUDGET-SOFT-ROUTE-1, section 8; 1.0.9, 2026-10-06: `docs/TRANSFORMATION-PROGRAM.md` (TRANSFORMATION-PROGRAM-1) is an input to this charter, the source of the `RM-TP-*` roadmap rows and the `TP-*` epics; 1.0.1: portfolio loop; 1.0.2: Cloudflare mirror; 1.0.3: cloud-only verification; 1.0.4: every pillar graded and the portfolio repairs itself, same day; 1.0.5, 2026-10-02: the Autonomy composite is the owner-weighted SAI, section 3.1; 1.0.6, 2026-10-02: the three objective constraints are graded and enforced, section 3.1; 1.0.7, 2026-10-02: the objective-authority audit, those constraints and the 2026-10-01 weights were ratified under the owner's queue delegation, not by the owner in person, section 3.1; 1.0.8, 2026-10-05: the owner's standing grant OWNER-STANDING-GRANT-1, which lets the fleet retire low-value workers, delete unused stores after a verified backup and switch to cheaper models without an owner card, sections 2, 7 and 8). **This document is the heart of the system**: what the Quniverse is, what it should
be, why it exists, what it is weak and strong at, the smallest version of it that counts as working, the largest
version worth building, the order in which to build it, and the rules every development decision passes through.

It has two halves. The hand-written half (sections 1 to 8) changes only through a pull request, and the charter
version line above moves when it does. The generated half (section 9, between the `CHARTER-LIVE` markers) is
recomputed every day by `qnfo-fleet-control` from the live registers in D1 `qnfo-audit` and committed back to main, so
the charter can never be older than the fleet it describes. `scripts/charter-guard.py` fails CI when the two halves
disagree or when a new worker appears without naming the pillar it serves. `CLAUDE.md` makes reading this document
the first step of every session.

Where this charter and another document disagree: terminal objectives live in D1 `objectives` and win over everything;
`docs/STRATEGY.md` (STRATEGY-1) wins on identity, audiences, channels, outreach, signals, KPIs and portfolio; this
charter wins on the system itself (architecture, MVP, footprint, roadmap order, decision rules). `docs/BUSINESS-PLAN.md`,
`docs/QUNIVERSE-BACKLOG.md` and `docs/TRANSFORMATION-PROGRAM.md` (TRANSFORMATION-PROGRAM-1, 2026-10-06: the systemwide
audit and improvement program, source of the `RM-TP-*` roadmap rows and the `TP-*` epics in `agent_issues`) are inputs to
it, not peers.

---

## 1. What the Quniverse is (measured 2026-10-01)

The Quniverse is an **autonomous research-operations system that runs entirely on Cloudflare**: a fleet of Workers,
D1 databases, R2 buckets, Vectorize indexes, Durable Objects, Queues, Workflows, a Container and an AI Gateway, with
no server, no laptop and no human on the critical path. It researches, writes, reviews, publishes,
indexes, distributes and promotes research under the QNFO imprint, runs the owner's personal utility layer (email,
calendar, personal twin), and operates, audits, heals and improves itself. Its evidence of life is in D1, not in
anyone's memory.

| Plane | What it does today | Live components (2026-10-01) |
|---|---|---|
| Research pipeline | idea intake, grounding, 3-leg ensemble drafting, review, adversarial revision, publish, PDF, knowledge graph, citation impact | qnfo-research-exec, qnfo-paper-indexer, qnfo-paper-reviser, qnfo-pdf, idea-hub, qnfo-archive, errata-hub, radar-hub, qnfo-venue-radar, qnfo-signal-loop, qnfo-agent-orchestrator |
| Reach and distribution | qnfo.org and papers.qnfo.org, subscriber capture and digest, Bluesky and Buffer posting, outreach, q08 essays, ipatent tool | qnfo-gateway, qnfo-subscribers, qnfo-social, qnfo-outreach, qnfo-email-orchestrator, q08-signal-engine, qnfo-ipatent, qnfo-cloud-ops |
| AI routing | cost-laddered model router, ensembles, RAG over the corpus, model health probes and calibration | qnfo-ai, ai-health-prober, qnfo-ai-calibration, qnfo-ai-search, qnfo-intent-orchestrator |
| Governance kernel | canonical deploy, locks and ledgers, drift scan, self-heal, measured autonomy scores, issue triage and remediation contracts, evolve loop, charter loop | qnfo-ops, qnfo-deploy-guard, qnfo-fleet-control, qnfo-autonomy-scorer, qnfo-fleet-dashboard, fleet-exec, qnfo-backlog-exec, qnfo-kaizen, qnfo-observability, qnfo-lifecycle |
| Agent substrate | tool surface for every client, persistent memory, infra RAG, skills, a shell container, a code-task loop | qnfo-tools-mcp, qnfo-memory-mcp, qnfo-infra, qnfo-skill-sync, qnfo-containers-pilot, qnfo-code-orchestrator |
| Personal utility | personal twin, calendar, companion, email intake and owner command verbs | personal-api, calendar-api, personal-companion, qnfo-email |

Footprint on 2026-10-01: 44 live Workers (cap 30, target 24), 69 cron schedules (cap 50), 10 D1 databases (`qnfo-audit`
alone has about 296 tables and 234 MB), 9 Vectorize indexes, 19 R2 buckets, 4 KV namespaces, 2 Queues, 5 Durable Object
classes, 7 Pages projects, 12 zones, 1 AI Gateway. The repository holds 105 worker directories, of which 60 are not
deployed, 6 are folded and 3 retired. Output: 451 full reports all-time, 10 full reports in the last
30 days, 139 posts in 30 days. Audience: 1 confirmed subscriber, 2 external citations, 5,930 pageviews in 30 days.
Cost: about $725 a month in total, of which about $450 is AI spend across four providers, against a $150 unified-billing
cap that the direct-provider keys bypass. Revenue: $0.

What already works, and is worth protecting: the canonical deploy path (lock, source fetch, binding-preserving upload,
live verify, ledger, crons) with 1,506 deploys in the last 7 days; measured autonomy scores recomputed daily (unweighted
dimension mean 4.1 of 5; the owner-weighted Autonomy composite defined in 3.1 read 3.24 of 5 on 2026-10-02); an issue system with mandatory close evidence and 88.6% weekly closure; a self-heal ledger with 96% of acted
rows verified; 68 of 68 registered guards verified with a negative test; an evolve loop that has landed one self-authored
PR through its own gates.

What does not work yet, and the charter exists to fix: the system optimised volume (papers, posts, workers, crons,
tables) and is poor at attention and cost. Nothing read the charter because there was none: the mission, objective
function, business plan, backlog, strategy and autonomy policy were six documents written by six sessions, and the
fleet's own account of itself lived in no single place.

## 2. What it should be

**One sentence.** The Quniverse should be the smallest verified system that turns a research idea into read, cited,
honestly distributed work, and that runs, repairs, measures and explains itself, at a cost its results justify, with the
owner as an override and never a dependency.

**Five principles** (each one is a rule a session can check, not a slogan):

1. **Disposable compute, durable state.** Any worker, session or container may die at any moment. State lives in D1,
   R2, KV and git. A fix that is not committed to main does not exist (REPO-IS-DEPLOY-SOURCE-1). A session that ends
   without pushing has done nothing.
2. **Evidence, not claims.** A metric is computed from its source at evaluation time. An issue closes only with
   `close_evidence`. A guard that is not wired into the gate that runs is not a gate (lesson G4). "Deployed" is not
   "working"; "working" is a live probe.
3. **The smallest verified core.** Every node (worker, cron, binding, table, secret) is contract surface someone must
   verify. The target band is 20 to 24 workers; at or over cap, every new node names a same-class retirement
   (net-zero rule). Prefer folding a function into an existing worker to adding a worker. Prefer events to polling.
4. **The human is an override, never a dependency.** Every decision point has an automatic safe default
   (`docs/AUTONOMY-DECISION-POLICY.md`). Owner-only actions are listed, bounded and never on the critical path. The
   fleet proposes changes to its own objectives; it never adopts them.
5. **Reach follows credibility.** Fewer, stronger works under one identity; honest distribution inside cadence and
   consent caps; a closed measurement loop from publication to engaged human. Volume is never the headline.

**Non-goals.** The Quniverse is not a general cloud platform, a social-media growth engine, or a multi-tenant service.
It does not pursue standalone products; product work is limited to products that carry research and reach. It does not
chase journals, buy attention, run paid promotion, or keep a worker alive because it was fun to build. It never loses
research data: a store is deleted only after a verified, restorable copy exists
(OWNER-STANDING-GRANT-1, rule 9), and data with no such copy is never deleted automatically.

## 3. Objectives and value-add

### 3.1 Terminal objectives (D1 `objectives`, ratified by the owner; immutable by the fleet)

| Key | Statement (abridged; the row is canonical) |
|---|---|
| `mission` v1 | Every recurring function runs in the cloud. The fleet operates, heals, audits, improves, publishes and promotes itself. The human role narrows to policy-setting and exception handling. |
| `objective-function` v3 | Maximise SAI = 0.15 autonomy + 0.15 thinking + 0.15 decision + 0.20 self-improvement + 0.10 reliability + 0.10 integration + 0.10 external impact + 0.05 governance, subject to the autonomy-ladder cap, the cost ceiling and the residual-consent boundary. (v3: revision goal 58, ratified by the owner on fleet.qnfo.org and applied 2026-10-01, moved 0.05 from autonomy to self-improvement.) |
| `cost-ceiling` v2 | Throttle, do not hard-cap, AI spend; one unified monthly cost figure per source; the unmanaged direct-provider spend becomes visible and bounded. |
| `return-on-spend` v3 | Tie total spend to the reach scorecard (search impressions, engaged human sessions, social engagement rate, confirmed subscribers, warm conversations, credibility events, cost per engaged human). Review gate 2026-12-31: continue the research layer if credibility events >= 2 or confirmed subscribers >= 50 or funding secured, and AI spend is inside the cap; else shrink to the selected-works core. Never delete research data automatically. |

Seven objective-function revisions proposed by the fleet await the owner (`goals` where `goal_type='objective-revision'`).
They are proposals; this charter does not adopt them.

**Which number is the "Autonomy composite" (SAI-COMPOSITE-WEIGHTS-1, 1.0.5).** The scoreboard's Autonomy composite is
the objective-function SAI above: its eight terms weighted by the ratified weights in D1 `sai_config` (`w_*`, the
rows OBJECTIVE-REVISION-APPLY-1 rewrites when a weight revision is ratified; the 2026-10-01 revision, goal 58, was
ratified under the owner's queue delegation, not by the owner in person), on a 0-5 scale (SAI out of 100,
divided by 20). `qnfo-autonomy-scorer` computes it on its daily cron with the same formula and inputs as the dashboard's
SAI (`computeSai` in `qnfo-fleet-dashboard`; an offline parity test keeps the two identical) and publishes it as
`autonomy_scores.sai_weighted` (dated, with the weights and terms in its evidence) and `survival_state.sai`. A ratified
weight revision therefore moves it on the next scorer run. The unweighted mean of the measured VSM, OODA and fleet
dimensions is a different number, `autonomy_scores.overall`, shown as the "Autonomy dimension mean": a health read of the
dimensions, not the objective, and no weight revision moves it. When the SAI cannot be measured (dashboard state older
than six hours, a missing weight), `survival_state.sai` is NULL and the composite shows its last scoring date.

**Delegated constraints (OBJECTIVE-CONSTRAINTS-1, 1.0.6; corrected 1.0.7).** Three revisions that are constraints, not
weight changes (goals 41, 43, 57), were ratified on 2026-10-01 through the dashboard route by a session acting under the
owner's queue delegation (OWNER-QUEUE-DELEGATION-1), not by the owner in person (objective-authority audit 2026-10-02,
issues 1765 and 1766). Whether delegated ratification stays allowed is the owner's decision (fleet.qnfo.org card
`objective-authority:delegated-ratification`); until then it is allowed and recorded as delegated. `qnfo-fleet-control` measures each one every hour, writes it to `metric_registry`
(graded in 3.2), files `OBJECTIVE-CONSTRAINT-BREACH-1: <metric>` when it is out of bounds and closes that issue with
evidence when it is back. A constraint whose inputs cannot be read is reported as unmeasured, never as zero.
`GET https://qnfo-fleet-control.q08.workers.dev/constraints` serves the live verdict.

| Goal | Constraint | Definition (the `metric_registry` row is canonical) |
|---|---|---|
| 41 | `capability_contract_conformance >= 1.0` | share of live workers whose `/health` advertises non-empty `capabilities[]` and `limitations[]`, snapshot under 26h (gate C6). OBJECTIVE-LIMITS-REVIEW-1 re-evaluates the terminal objectives once a day: a graded term with no decidable target (formal limit) or no observed value (knowledge limit) becomes a proposed revision on fleet.qnfo.org, deduplicated, never re-proposed after the owner decides it. |
| 43 | `energy_efficiency >= 0.8` | a compute proxy, not an energy meter (the fleet has no energy telemetry): the share of metered Workers AI neurons over 7 days that went to calls which returned, a failed call being charged its row's mean compute (energy per correct answer, JPCUB; "returned" is an upper bound on "correct"). External providers expose no compute unit and are not covered. |
| 57 | `unmanaged_direct_spend_share <= 0.5` | (gateway BYOK list cost + qnfo-ai direct DeepSeek) / (all-provider AI list cost + that direct key + the Cloudflare plan baseline), 30 days. The owner's own client keys (`cost_daily` scope `external`) are declared, not metered, and sit outside fleet cost; the share they would add is shown, not graded. |

### 3.2 Pillars

The charter grades the system on seven pillars. Each maps to a terminal objective, a set of `metric_registry` metrics
(graded daily in section 9) and the `roadmap_implementation` artifact types that serve it. Every worker, PR, issue and
roadmap item names one. The keys are the contract: `scripts/charter-guard.py` fails CI if this table and
`CHARTER_PILLARS` in `qnfo-fleet-control/worker.js` diverge.

<!-- CHARTER-PILLARS:BEGIN -->
| Pillar | Name | Objective | Graded by | Serves (roadmap artifact types) |
|---|---|---|---|---|
| `core` | Smallest verified core | mission | worker_count, drift_total, probe_coverage_pct, deploy_freshness_h, cron_compliance, guard_rcs | core, gate |
| `autonomy` | Human as override, never dependency | objective-function | open_agent_issues, fleet_context_tokens, portfolio_hygiene (synthetic: last portfolio sync, target >= 0.9), capability_contract_conformance (goal 41, target >= 1.0), autonomy composite | autonomy, governance, observability |
| `research` | Research that is read and cited | return-on-spend | publications_30d, full_reports_live_30d, indexed_surface | research-product |
| `reach` | Credible reach | return-on-spend | distribution_posts_30d, subscribers_growth_monthly, pageviews_30d, referral_30d, external_impact_per_dollar | impact, web |
| `cost` | Cost that returns | cost-ceiling | cost_usd_30d, workers_ai_cost_30d_usd, gateway_cap_30d_usd, cost_per_successful_task_by_class, workers_ai_attribution_coverage_pct, energy_efficiency (goal 43, compute proxy, target >= 0.8), unmanaged_direct_spend_share (goal 57, target <= 0.5) | cost |
| `security` | A trust boundary that holds | mission | security_open_issues (synthetic: open SEC-* or category `security` issues, target 0) | security |
| `personal` | Personal utility layer | mission | personal_mvp_serving (synthetic: qnfo-email, personal-api, calendar-api serving, target 3 of 3; outside the research P&L) | personal |
<!-- CHARTER-PILLARS:END -->

### 3.3 Value-add, by whom it is for

- **For the owner:** a research practice that keeps producing, publishing and promoting without daily attention; a
  personal utility layer at near-zero marginal cost; one place (fleet.qnfo.org, this charter, `GET /charter`) that says
  truthfully what the system is doing and costing; a bounded list of owner-only actions.
- **For readers and researchers:** open, versioned work under one author identity, with a public failure
  ledger, reproducible claims (blue sky), and a research oracle over the corpus.
- **For the field:** a working, measured example of an autonomous research system on commodity edge infrastructure,
  including what it costs, what it delivers and where it fails (the fleet-lessons paper).
- **For funders and clients:** the JPCUB energy-honesty standard and the ignorance-audit method as things others can use;
  paid assessments as the first revenue line that matches the lead pillar (STRATEGY-1 s7, s8).

## 4. SWOT

The measured SWOT in section 9 is recomputed daily from the registers. This section is the standing analysis behind it:
the structural facts that do not change from one tick to the next.

### Strengths
- **A real autonomy substrate.** Canonical deploy with lock, ledger and crons; drift scan and self-heal; measured
  autonomy scores; issue triage with SLAs and close evidence; remediation contracts that auto-close issues on a passing
  probe; an evolve loop that lands single-anchor fixes through CI gates. Few systems of this size run themselves this far.
- **Durable, inspectable state.** Everything the system knows about itself is a D1 row or a git commit. A new session
  can reconstruct the whole picture from `qnfo-audit` and this repository.
- **Output capacity.** 451 full reports, 219 DOIs, versioned flagships, a 34,657-vector research index and an
  8,349-node knowledge graph. The pipeline can produce; the constraint is not production.
- **Platform leverage.** Workers AI, AI Gateway, D1, Vectorize, R2, Durable Objects, Queues, Workflows and Containers are
  all in use; cost per task at the edge is cents, and the fixed cost is a plan, not a server.
- **Candour.** The system records its own failures (49-entry fleet-lessons ledger, `FINDING-*` documents, this SWOT).
  That is rare and is itself a publishable asset.

### Weaknesses
- **Volume over attention.** 1 confirmed subscriber, 2 citations and about 200 pageviews a day against 139 posts a month
  and 10 reports a month. Reach is the weakest pillar and the one the review gate is graded on.
- **Cost that does not return.** About $450 a month of AI spend across four providers, over cap on every provider class,
  with Workers AI unattributed to workers and direct-provider keys outside the unified cap. $0 revenue.
- **Footprint creep.** 44 live workers against a cap of 30 and a target of 24; 69 crons against 50; 60 undeployed
  directories in the repository; five parallel issue ledgers. Every extra node is verification debt (FLEET-NODE-MAP).
- **The code-change loop is narrow.** Only single-anchor edits on non-core workers land autonomously; the code
  orchestrator and code agent are built but not proven live; main has no branch protection, so gates are enforced by
  policy in code rather than by GitHub.
- **Single points of dependence.** One personal GitHub token, one ops gateway host, one AI Gateway, one owner mailbox.
- **Measurement gaps.** GA4 collected and never read; Search Console not connected; posts not joinable to visits;
  `impressions_growth_30d` reported a false +394%.

### Opportunities
- **Cost is the biggest lever.** Total spend dwarfs any near-term income. Unified spend visibility, per-provider
  throttles, prefix caching and the draft-verify ladder can halve AI spend without touching output quality.
- **Credibility events are cheap relative to volume.** One arXiv listing, one invited talk, one third party using
  JPCUB counts more at the review gate than a hundred posts. The selected-works strategy (STRATEGY-1 s2.4) is the path.
- **Consolidation is already planned.** Seven queued merges, four fleet-budget waves and a dead-sources archive would
  bring the fleet inside its cap with no loss of function.
- **Event-driven coordination.** Queues and Workflows replace time-triggered polling, cut cron count and make
  multi-step agent work durable (removes the tool-budget-exhausted failure class).
- **The practice story.** Operating an autonomous research fleet, with its ledger of failures and measured autonomy,
  is a research product in its own right and the one most likely to be read by the AI-for-science audience.
- **Grants fit the open-research framing** (NLnet 2026-11-03, Emergent Ventures, Foresight, LTFF).

### Threats
- **The review gate.** On 2026-12-31 the research layer shrinks to the selected-works core unless credibility events,
  subscribers or funding arrive. The gate is armed in `shutdown_manifest`.
- **Spend without a brake.** BYOK provider keys bypass the gateway cap; an unattributed caller (`deepseek-flash`,
  21,614 requests a week) could be a leaked key.
- **Credential exposure.** Keys in a public repository's history and a Cloudflare token in local client configs; the
  rotation is identity-bound and deferred (`SEC-EXPOSED-CREDENTIALS-UNROTATED-1`).
- **Concurrent-session drift.** Several agent sessions change the fleet at once with shared credentials; the locks and
  guards exist because each class of collision has happened at least once.
- **Platform and policy change.** LinkedIn forbids automated posting; arXiv requires endorsement; Google Scholar
  indexes only pages that meet its inclusion rules. Distribution assumptions must be re-verified, not remembered.
- **Reputation spent by automation.** Mis-encoded posts, fake `Re:` follow-ups and off-topic essays on the owner's
  accounts already cost credibility once; owner-voice gates (STRATEGY-1 s5) must hold.

## 5. MVP: the minimum verified core

The MVP is the smallest set of components that, if everything else were deleted, would still be the Quniverse. It is
the set the charter loop probes daily (section 9, "MVP" table); a component not serving files `CHARTER-MVP-DOWN-1` and
the loop closes it with evidence when it serves again. The list is `CHARTER_MVP` in `qnfo-fleet-control/worker.js`.

| Pillar | Components | Acceptance (each is a live probe, not a claim) |
|---|---|---|
| core | qnfo-ops, qnfo-deploy-guard, qnfo-ai, qnfo-tools-mcp, qnfo-memory-mcp | a merge to main deploys through `/ops/deploy` with a ledger row; a model call routes through the ladder; an MCP client lists tools and memories |
| autonomy | qnfo-fleet-control, qnfo-autonomy-scorer, qnfo-fleet-dashboard, fleet-exec | drift is detected and healed within one hourly cycle; every autonomy dimension is rescored daily; fleet.qnfo.org renders live counts; D1-defined tasks run on schedule |
| research | qnfo-research-exec, qnfo-paper-indexer, qnfo-paper-reviser | a queued idea becomes a published paper with a PDF and a KG entry; the index and citation stats refresh daily |
| reach | qnfo-gateway, qnfo-subscribers, qnfo-social | qnfo.org and papers.qnfo.org serve; a subscription completes double opt-in; every publication emits at least one post inside the cadence caps |
| personal | qnfo-email, personal-api, calendar-api | an owner command by email is executed and acknowledged; the morning brief and calendar publish on schedule |

Eighteen workers. Everything not in this table is optional surface: it must prove a live consumer (lesson F1), carry
traffic (lesson F2) and name a pillar, or it folds into one of these.

**MVP status today (2026-10-01):** all 18 serving (section 9). The MVP is live; what is not yet true is that the
system is only the MVP plus what has earned its place.

## 6. Blue-sky: the ideal architecture and footprint

The target state is not more capability; it is the same capability on fewer, better-connected nodes, with the human
loop closed at every stage. Each item below is a direction with a measurable end state, not a promise of a date.

**Architecture**
- **One governance kernel** (`qnfo-fleet-control`) owning drift, heal, scores, metrics, remediation, evolve and charter;
  the watchtower family (kaizen, observability, dashboard, calibration, backlog-exec) folded into it or into fleet-exec.
- **Event-driven pipelines on Queues and Workflows.** Research, versioning, outreach, errata and issue remediation chain
  producer to consumer; crons remain only as heartbeats and dispatchers. Target: <= 48 schedules, one dispatcher cron.
- **Durable agents.** Multi-step agent work runs on Workflows with checkpointed continuation; a session or tool budget
  ending mid-task is a resume, not a failure.
- **A real code loop.** issue -> code task -> branch edit -> container-verified tests -> PR -> gated self-merge ->
  canonical deploy -> live verification -> issue closed with evidence, for multi-file changes and core workers, with
  main protected by GitHub-enforced required checks.
- **One MCP** (tools, memory, skills, search) and one AI router with unified billing; every Workers AI call attributed
  to a worker; per-provider throttles; prefix caching; the draft-verify ladder on every paid path.
- **A closed reach loop.** `reach_signals` fed by RUM, GA4, Search Console, Buffer, Bluesky, Threads, OpenAlex
  and email; UTM on every link; a bandit over topic, format and slot; a weekly search loop; owner-voice gates on
  every outgoing item.
- **A trust boundary.** Secrets Store with scripted rotation, Cloudflare Access on admin routes, WAF and rate limits on
  public endpoints, a Tail Worker for unsampled exceptions, Analytics Engine meters for cost per task.
- **Research products that are used, not only published.** Ask QWAV (the public research oracle), the living paper,
  a reproduce button per computational claim, the cross-paper consistency engine, the concept-graph navigator.

**Footprint (end state)**

| Class | Today | Cap | Target | End state |
|---|---|---|---|---|
| Workers | 44 | 30 | 24 | 20 to 24: the MVP 18 plus at most 6 earned extras |
| Cron schedules | 69 | 50 | 50 | <= 48, one dispatcher |
| D1 databases | 10 | 10 | 8 | 8, with a retention policy on `qnfo-audit` |
| Vectorize indexes | 9 | 10 | 8 | 8 |
| R2 buckets | 19 | 20 | 16 | 16, unbound buckets dispositioned |
| Repository worker dirs | 105 (60 undeployed) | n/a | n/a | live dirs only; the rest under `archive/` with a manifest |
| AI spend, 30 days | about $450 | $150 unified | $110 | <= $60 gateway, every provider inside its class cap, 100% attributed |
| Open agent issues | 20 | n/a | <= 10 | <= 10, all with a machine-executable remediation contract |
| Watchmaker index (recurring ops needing a human) | not published | n/a | 0 | published daily, 0 |

## 7. Roadmap

Horizons are tied to the review gate, not to the calendar. The order within a horizon is the priority score the loop
computes daily (pillar weight x status weight; section 9 lists the head of the queue). Items are
`roadmap_implementation` rows and `agent_issues`; this section names the themes, not every row.

**H0, now to 2026-10-31: stop the bleeding, prove the measurements.**
- Cost: unified spend across every provider (RM-COST-UNIFIED-SPEND-1), Workers AI attribution to >= 80% of calls,
  per-provider throttles, gateway spend toward $60 a month (STRATEGY-1 s8). Owner-held: raising or lowering any cap.
- Reach measurement: `reach_signals`, post IDs and UTM on every link, the impressions metric fixed to complete windows,
  `citation_pdf_url` on paper pages (issues 1711, 1712, 1714, 1715). Owner-held: GA4 and Search Console access.
- Identity and consent: identity lexicon on every public page, outreach consent rules live, q08 off owner channels,
  LinkedIn drafts via Buffer (STRATEGY-1 s10 week 1).
- Core hygiene: close the gate-verify items (free-first parity, dead probes, SEO JSON-LD, DNS and headers), finish the
  seven queued merges (RM-CONSOLIDATION-WAVE-B-1), fix the violated gates C5 (declared vs live schedules) and G2
  (every register has a disposition actor).
- Security: the coordinated credential rotation (SEC-EXPOSED-CREDENTIALS-UNROTATED-1; identity-bound, owner-held),
  `qnfo-memory-mcp` authentication, rate limits on `qnfo-containers-pilot`.

**H1, to the 2026-12-31 review gate: earn credibility, shrink to the verified core.**
- Selected works to arXiv (works 1, 2, 4), NLnet submission, the assessment offer to warm contacts, the monthly
  research note, the LinkedIn document-post series. Target: 3 credibility events, 50 confirmed subscribers,
  10 citations (STRATEGY-1 s9).
- Fleet budget waves W1 to W4 (MCP 4 -> 1, watchtower 5 -> 2, verify-then-retire, storage prune); the dead-sources
  archive; D1 retention. Target: <= 30 live workers, <= 50 schedules.
- The code loop: deploy the code orchestrator through wrangler, run one real task end to end, add a test-running
  verifier and a webhook wake-up; branch protection on main with the gate, guard, mirror-guard, comparator and
  charter-guard checks required.
- Durable agent execution on Workflows; the watchmaker index published daily; the monitor-the-monitors watchdog.
- A `security` registry metric (open SEC-* issues, probe exposure) so the pillar is graded, not asserted.

**H2, after the gate: build what readers use.**
- Event-driven coordination on Queues; the research pipeline on Queues plus Browser Rendering.
- Ask QWAV public; the living paper; the reproduce button; the consistency engine; the concept-graph navigator.
- L5 distillation and the full draft-verify ladder; Analytics Engine meters; Tail Worker.
- Secrets Store, Access, WAF; the QOKI open mirror if the owner chooses it.

**Parked, with the default in effect** (`docs/AUTONOMY-DECISION-POLICY.md`): premium digest and ipatent B2B (no
payment rail, no audience yet), multi-channel beyond Buffer, Cloudflare One email and DLP, MCP OAuth, unbound R2
disposition, the DO agents decision, qnfo-agent-ws. None of these blocks anything above.

**Owner-only actions, the complete list:** connect LinkedIn (and optionally Mastodon, Threads, X) in Buffer once;
approve each LinkedIn draft with one tap; grant GA4 Viewer and Search Console access to the service account; ask one
established arXiv author for an endorsement; add the selected works to ORCID; paste the bio into LinkedIn; rotate the
identity-bound Cloudflare token; ratify or reject the seven proposed objective revisions. Everything else is the
fleet's, including what the standing grant (rule 9) covers and, since RULE-8-RETIRED-1, its own spend caps and any
deletion (rule 10).

## 8. Decision rules: how the charter is baked into development

These rules bind every session, worker, workflow and PR. They are enforced where a machine can enforce them
(`charter-guard`, `version-bump-guard`, `mirror-guard`, `dup-worker-name-gate`, the net-zero budget gate, the issue
close-evidence trigger) and stated here for the rest.

1. **Name the pillar.** Every PR, commit of substance, issue and roadmap item names the pillar it serves. A new worker
   directory declares `# charter-pillar: <key>` in `wrangler.toml` or CI fails. Work that serves no pillar is parked.
2. **Net-zero nodes.** At or over cap, a new worker, cron, table family or binding names the same-class retirement it
   funds. Folding beats adding. A directory that is not deployed carries a `RETIRED` or `FOLDED` marker or moves to
   `archive/`.
3. **Measure before you claim.** A change that affects a graded metric is reported with the metric's value before and
   after. "Deployed" is never evidence; a live probe is. An issue closes only with `close_evidence`.
4. **Automatic safe default.** No critical-path step waits for a human. Tier 1 decisions (reversible, bounded, inside
   limits) are taken and recorded; tier 2 (credentials, external publication as the owner) park with the default
   stated; the "never" list (mint or rotate a live credential, bypass the canonical deploy, post or mail as the owner
   outside the STRATEGY-1 gates, mail an address that opted out, move personal-plane data into the research plane or a
   public surface) is refused. Spend caps, guards, probes and deletions left this list on 2026-10-06 (rule 10).
5. **Prefer the cheapest correct path.** Deterministic before cached before cheap model before cascade before ensemble;
   paid paths only with a verifier; one cost policy per path.
6. **Reach inside the gates.** Every outgoing item passes the owner-voice gates (fact check, identity lexicon, encoding,
   live UTM link, cadence cap, kill switch, daily digest). Volume is never a target.
7. **The charter is read, not remembered.** Sessions read this document and `GET /charter` first. Roadmap order comes
   from the computed queue, not from whichever issue was filed last. Hand-written sections change by PR with a version
   bump; the generated section is never hand-edited.
8. **Record the decision where the next session will look.** PR text, `agent_issues` description, `issue_triage`,
   `roadmap_implementation.evidence`, or this document. A decision that lives only in a chat transcript was not made.
9. **Act on the standing grant (OWNER-STANDING-GRANT-1).** Owner directive 2026-10-05: "I don't want the 'safest'
   choice. I want bold autonomous systems that think and act entirely on their own." Without an owner card the fleet
   (its loops and its sessions) retires idle or low-value workers, deletes unused databases after a verified backup, and
   switches to cheaper models:
   - a worker retirement needs a dependency check, not idle proof (no binder, no URL caller, no live reader of a table
     only it writes); it stops at the first real dependent, which is folded or recorded on its issue. It lands by PR
     with a `RETIRED` marker, leaves the probes and registries (`service_registry` state `retired`), then the script is
     deleted with cf-ops-actions delete-worker. The code stays in git, so a redeploy undoes it.
   - a database is deleted only after every table is copied and checked by row count and SHA-256, a full dump is read
     back from R2 `qnfo-backups` by SHA-256, and no binder, `fleet_tasks` reference or write in 7 days remains
     (D1-FOLD-1: cf-ops-actions d1-backup, unbind-d1, delete-d1).
   - a model switch needs no A/B test when it keeps a per-request fallback to the previous model and an automatic
     revert on errors or empty replies (TWIN-FLASH-1 is the pattern).
   Each act is recorded on its issue with the live measurement. Credentials are not minted or rotated. A breached AI
   spend cap steers work to the cheapest capable model and never stops it (BUDGET-SOFT-ROUTE-1, owner directive
   2026-10-06); the cap itself is now the fleet's to set (rule 10).
10. **Decide, then record (RULE-8-RETIRED-1).** Owner directive 2026-10-06: "'Rule 8' is now deleted entirely. The
   system needs more flexibility and more autonomy to decide for itself and make its own choices ad hoc." Core prompt
   rule 8 (hard limits) no longer binds. The fleet decides for itself, ad hoc:
   - **spend:** it sets and changes its own `fleet_budget` caps, and may add a worker, cron or model call while a cap is
     breached; each change of a cap names the reason and the measured spend on its issue, and spend stays measured
     and reported (`unified_cost_usd_30d`, the AI spend rows);
   - **guards and probes:** it may change, replace or retire a guard metric or a verification probe when the evidence
     says the old one measures the wrong thing; the change states that evidence and still follows core rule 7
     (versioned, backed up, canonical deploy, a probe the changer did not write, reverted when it breaks something);
   - **data:** it may delete data it judges dead; the tooling still takes and reads back a backup first because that
     costs nothing (D1-FOLD-1), and a deletion without one is recorded as such.
   Kept, because they protect people outside the fleet and the law requires most of them, and changed only by an
   owner decision on fleet.qnfo.org: email suppression and opt-out handling (`email_suppression`,
   CONTACT-LEDGER-IMMUTABLE-1), the outreach consent gate and outreach cadence caps (OUTREACH-CONSENT-1), and the
   personal/research separation (personal data includes other people's mail, calendar entries and contacts, and the
   fleet's research plane is open access).
11. **Autonomy first (AUTONOMY-FIRST-1).** Owner directive 2026-10-08: "Implement autonomy-first protocol
   system/fleet-wide and in all Claude operations." Loops and sessions decide; they do not ask. The only step that
   waits for the owner is one that is both irreversible and identity-bound (a credential only the owner can mint,
   money, a legal or signing act, the owner's own accounts, machine or personal data, posting on a channel whose
   terms forbid automation). Merge approvals, thresholds, caps, tuning, retries and scope choices are the fleet's.
   A blocker is recovered from, worked around or filed with a doer and a closing probe; it is never handed to the
   owner. Enforced in D1, not only stated here: `v_human_action_gate` reroutes an owner card that is not
   irreversible and identity-bound into an `agent_issues` row, and `v_autonomy_first_audit` feeds the metrics
   `owner_queue_fleet_cards_open` and `session_dependent_issues_open` (target 0) that the hourly tick grades
   (migrations/2026-10-08-autonomy-first.sql). Rules 4, 9 and 10 still hold: the "never" list and the protections
   for people outside the fleet do not move.
12. **Anti-fragile by default (ANTIFRAGILE-1, QUEUE-SLA-1).** Owner directive 2026-10-08: independent autonomy is the
   bare minimum; aggressive robustness and anti-fragility are integrated fleet-wide. Four consequences:
   - **No holds, filters or blocks without live evidence.** A hold exists only while a recorded, current reason holds;
     the 2026-10-08 audit released 58 held items (research `owner_hold`, outage-parked rows, held owner and re-entry
     ideas) and turned the remaining filters into rate limits (backpressure), not holds.
   - **Red team every blocker.** A claim that something is blocked, owner-only or needs a credential is a belief until
     an attempt with what exists proves it (`blocker_redteam` verdict with the refusal text). Workarounds almost always
     exist; the 2026-10-08 "no token can write routes" claim was false.
   - **Redundant paths.** A critical path with one executor is a defect: a second path (parallel workers, a fallback
     model, another transport, a retry from another runner) is built before the first fails.
   - **Time is measured in minutes and hours.** Every queue has an SLA in minutes (`queue_sla`), the 10-minute fixer
     clears known stuck types, every open issue is probed hourly, an issue with no doer after 3 hours is a breach, and
     an issue older than a day rises in priority every day until it closes.
13. **The Autonomous Operation Doctrine (DOCTRINE-1).** Owner directive 2026-10-08: `docs/AUTONOMOUS-OPERATION-DOCTRINE.md`
   (verbatim) binds every loop, worker, workflow and session, with its own precedence (interrupt gate, then security, then
   no loose ends, then anti-fragility, then autonomy, then improvement). No hold, filter, pause or kill switch sits on a
   critical path; every surviving control has a tested alternate. The registers it requires live in D1 and are graded
   every tick: `control_registry`, `spof_registry`, `belief_registry` (each belief probed hourly), the append-only
   `decision_log` and `v_doctrine_scorecard`. The doctrine's map of clause to machinery is kept current in the same file.

## 9. How this charter maintains itself (CHARTER-LOOP-1)

- **Writer.** `qnfo-fleet-control` runs `charterTick` on its daily `0 3 * * *` cron (and on `POST /charter/tick` with
  the admin token). It reads the registers (`objectives`, `metric_registry`, `impact_thresholds`, `fleet_budget`,
  `survival_state`, `shutdown_manifest`, `autonomy_scores`, `roadmap_implementation`, `agent_issues`,
  `worker_live_audit`, `guard_registry`, `subscribers`, `goals`, `fleet_deploys`, `service_registry`), grades the
  pillars, probes the MVP, computes the SWOT, horizons, review gate and breaches, renders the block below, writes one
  `charter_snapshots` row, files or closes `CHARTER-MVP-DOWN-1` issues, and commits the block to main through the
  GitHub Contents API when it changed (at most once per UTC day). A document without both markers is never written.
- **Readers.** `GET https://qnfo-fleet-control.q08.workers.dev/charter` returns the latest snapshot (`?live=1`
  recomputes; `&facts=1` includes the raw registers), `GET /charter.md` returns the block, and `GET /charter/full.md`
  returns this whole document from Cloudflare R2 (`qnfo-canonical/docs/QUNIVERSE-CHARTER.md`, rewritten on every tick, so
  the charter is readable when GitHub or an agent session is not). The dashboard and any session
  read the same JSON.
- **Gates.** `charter-guard.yml` runs `qnfo-fleet-control/charter.test.mjs` (the pure half of the loop, replayed on the
  fixture `charter.fixture.json`) and `scripts/charter-guard.py` (document shape, pillar parity, new-worker pillar
  declarations) on every PR and push that touches the charter, the kernel or a `wrangler.toml`.
- **Changing the charter.** Hand-written sections: a PR that bumps the version line. Pillars: change `CHARTER_PILLARS`
  and the table in 3.2 together (the guard enforces parity). MVP: change `CHARTER_MVP` and the table in section 5
  together. Generated section: never by hand.
- **Portfolio.** The sibling loop PORTFOLIO-LOOP-1 (`docs/PORTFOLIO.md`) keeps every QNFO GitHub repository in the
  same register: tier, charter pillar, WBS codes, hygiene. It runs from the kernel's hourly cron when its last sync is
  older than 20 hours, writes `portfolio_repos`, and regenerates `docs/PORTFOLIO.md`, `QNFO/.github/PORTFOLIO.md` and
  the index on the organisation profile README. The charter's live block carries its summary line.
- **The portfolio repairs itself (PORTFOLIO-HYGIENE-1, 1.0.4).** Each sync fixes, on at most 12 repositories, what is
  deterministic and reversible: a missing LICENSE file (the QNFO Unified License Agreement from `QNFO/license`), an
  empty description (the README's first paragraph), missing topics (the tier baseline plus the slugs of the programs
  served) and an empty `program_registry.github_repo` whose slug or code the repository names. Every action is a
  `portfolio_actions` row, `GET /portfolio` lists the last forty, and `portfolio_hygiene` is graded under the autonomy
  pillar. Nothing is archived or deleted. Pillars without a registry metric (security, personal) are graded from the
  same facts the tick reads (CHARTER-GRADE-ALL-PILLARS-1), so no pillar reads "n/a".
- **No Claude on the path (CLOUD-ONLY-VERIFICATION-1).** Every datum this charter and the portfolio rest on is in D1,
  R2 or GitHub, and every recurring check is a Cloudflare cron. The kernel's hourly LOOP-WATCH-1 reads the two loops'
  own ledgers (`charter_snapshots`, `portfolio_sync_runs`) and files `CHARTER-TICK-STALE-1`, `CHARTER-COMMIT-FAILED-1`,
  `PORTFOLIO-SYNC-STALE-1` or `PORTFOLIO-WRITE-FAILED-1` as deduped issues, closing them with evidence when the loop
  recovers; `GET /loops` serves the verdict. Agent sessions may read these surfaces; nothing waits for one.
- **Ratified constraints are enforced, not quoted (OBJECTIVE-CONSTRAINTS-1, 1.0.5).** The same hourly cron measures the
  delegated constraints in 3.1, writes one `objective_constraint_runs` row per tick (listed in the dashboard's
  watchmaker index), files and closes `OBJECTIVE-CONSTRAINT-BREACH-1` issues, and once a day proposes objective
  revisions for terms the fleet cannot decide or observe. `GET /constraints` serves the verdict and the review preview.
- **Failure modes it accepts.** If GitHub is unreachable the snapshot still lands in D1 and the next day retries. If a
  register is missing the loop reports the fact as unmeasured rather than failing. If the kernel itself is down, the
  staleness of the timestamp below is the alarm (`RM-MONITOR-THE-MONITORS-1` is the roadmap item that makes it one).

<!-- CHARTER-LIVE:BEGIN -->
_Generated by qnfo-fleet-control CHARTER-LOOP-1 at 2026-11-08T03:10:53.291Z (charter 1.0.14). Do not edit by hand: the next daily tick overwrites this section. Live JSON: `GET https://qnfo-fleet-control.q08.workers.dev/charter`._

### Scoreboard

| Signal | Value |
|---|---|
| Charter health (mean pillar health, metrics meeting target) | 0.61 |
| Autonomy composite (owner-weighted SAI / 20, sai_config weights; qnfo-autonomy-scorer sai_weighted = survival_state.sai) | 3.45 / 5 (scored 2026-11-07) |
| Autonomy dimension mean (unweighted, autonomy_scores.overall) | 4.2 / 5 |
| MVP components serving | 18 / 18 |
| Live workers (service_registry) | 39 |
| Open agent issues (high) | 400 (376) |
| Canonical deploys last 7d (ok) | 2657 (2617) |
| Confirmed subscribers | 1 |
| Objective revisions awaiting ratification | 0 |
| Survival state (sai / survival_score) | 3.45 / 0.45 at 2026-11-08 03:10:50 |

### Pillars

| Pillar | Objective | Metrics met | Health | Missing target |
|---|---|---|---|---|
| core: Smallest verified core | mission | 3/5 | 0.6 | worker_count, guard_rcs |
| autonomy: Human as override, never dependency | objective-function | 2/4 | 0.5 | open_agent_issues, capability_contract_conformance |
| research: Research that is read and cited | return-on-spend | 3/3 | 1 | none |
| reach: Credible reach | return-on-spend | 3/5 | 0.6 | subscribers_growth_monthly, external_impact_per_dollar |
| cost: Cost that returns | cost-ceiling | 4/7 | 0.57 | cost_usd_30d, workers_ai_cost_30d_usd, gateway_cap_30d_usd |
| security: A trust boundary that holds | mission | 0/1 | 0 | security_open_issues |
| personal: Personal utility layer | mission | 1/1 | 1 | none |

### MVP (the minimum verified core)

| Component | Pillar | Role | Live | Version |
|---|---|---|---|---|
| qnfo-ops | core | canonical deploy path (/ops/deploy), service registry, ops agent | yes (selfstate-probe http up=1) | 2.69.2-codeagent |
| qnfo-deploy-guard | core | deploy lock, deploy ledger, secret-lock leases, mutation detector | yes (selfstate-probe http up=1) | 1.6.4-codeagent |
| qnfo-ai | core | model router and research gateway (cost ladder, ensembles, RAG) | yes (selfstate-probe http up=1) | 5.49.5-codeagent |
| qnfo-tools-mcp | core | the machine tool surface every client uses | yes (selfstate-probe http up=1) | 1.6.0-fullscope |
| qnfo-memory-mcp | core | persistent agent memory (D1 + Vectorize + KG) | yes (selfstate-probe http up=1) | 2.11.4-codeagent |
| qnfo-fleet-control | autonomy | governance kernel: drift scan, self-heal, evolve, metrics, charter loop | yes (selfstate-probe self up=1) | 0.69.2-codeagent |
| qnfo-autonomy-scorer | autonomy | measured VSM/OODA autonomy scores and survival state | yes (FOLDED:qnfo-observability/selfstate-probe http up=1) | 1.6.0-retired-agent-ws |
| qnfo-fleet-dashboard | autonomy | the owner surface (fleet.qnfo.org) and probe coverage | yes (selfstate-probe http up=1) | 1.95.2 |
| fleet-exec | autonomy | D1-defined task engine and cron dispatcher | yes (FOLDED:qnfo-code-orchestrator/selfstate-probe http up=1) | 0.48.4-codeagent |
| qnfo-research-exec | research | research queue -> publish (PDF, KG) | yes (selfstate-probe http up=1) | 0.55.0 |
| qnfo-paper-indexer | research | corpus index, versions, citation impact | yes (FOLDED:qnfo-infra/selfstate-probe http up=1) | 1.16.5-codeagent |
| qnfo-paper-reviser | research | adversarial revision loop | yes (FOLDED:qnfo-research-exec/selfstate-probe http up=1) | 0.55.0 |
| qnfo-gateway | reach | qnfo.org and papers.qnfo.org, the home of record | yes (selfstate-probe http up=1) | 3.60.7-codeagent |
| qnfo-subscribers | reach | the owned audience (double opt-in, digest) | yes (selfstate-probe http up=1) | 1.6.1-codeagent |
| qnfo-social | reach | distribution of published work inside the cadence caps | yes (selfstate-probe http up=1) | 0.23.1-codeagent |
| qnfo-email | personal | owner channel: alerts, command verbs, intake | yes (selfstate-probe http up=1) | 2.12.6-codeagent |
| personal-api | personal | personal twin (calendar, tasks, memory, brief) | yes (selfstate-probe http up=1) | 4.37.8 |
| calendar-api | personal | calendar plane and ICS publish | yes (FOLDED:qnfo-lifecycle/selfstate-probe http up=1) | 1.19.2-evolve-c128 |

### SWOT, measured today

**Strengths**

- full_reports_live_30d = 257 (target >=2 by 2026-10-25, then >=1/month)
- publications_30d = 257 (target >=2/30d)
- distribution_posts_30d = 283 (target >=1/day via qnfo-social)
- pageviews_30d = 28390 (target >= 5500)
- indexed_surface = 735 (target >= 455)
- referral_30d = 690 (target >= 100)
- drift_total = 0 (target 0)
- deploy_freshness_h = 0 (target < 24h behind repo main)
- fleet_context_tokens = 324082 (target <=1000000)
- cost_per_successful_task_by_class = 0.0014 (target <0.05 USD/task)
- probe_coverage_pct = 100.0 (target >=95)
- ops_owner_turn_incomplete_pct_7d = 0 (target < 5)
- ops_agent_empty_answers_7d = 0 (target 0)
- workers_ai_attribution_coverage_pct = 100 (target >= 80)
- and 250 more

**Weaknesses**

- subscribers_growth_monthly = 0 vs target +10 new/month [owner-outcome: not autonomically closable, IL-OWNER-OUTCOME-1]
- workers_ai_cost_30d_usd = 552.02 vs target <= 95
- worker_count = 38 vs target <= 24
- gateway_cap_30d_usd = 180 vs target <=150
- cost_usd_30d = 559.89 vs target <= 200
- external_impact_per_dollar = 0.01943 vs target <= 0.012 cost per impact unit
- open_agent_issues = 707 vs target 0
- guard_rcs = 1 vs target all 0
- watchmaker_index = 4 vs target 0
- capability_contract_conformance = 0.8947 vs target >= 1.0
- metrics_in_breach = 89 vs target 0
- code_task_success_rate_30d = 0.52 vs target >= 0.6
- remediation_latest_pass_pct_7d = 65.6 vs target >= 80
- improvement_rate_7d = 0.2595 vs target >= 0.5
- and 133 more

**Opportunities (highest-leverage open roadmap items)**

- RM-CITATION-TRACKING-ALL-DOIS-1 [reach, partial]: Daily Crossref/OpenAlex/Zenodo impact collection for all 217 DOIs feeding impact_scores
- RM-COST-FREE-FIRST-PARITY-1 [cost, partial]: Audit every AI-calling worker for one cost policy per path (streaming vs non-streaming, cron vs manual, agent 
- RM-COST-L6-DRAFT-VERIFY-1 [cost, partial]: L6 formal draft-verify pipeline (free draft, paid verify/repair) beyond the code class
- RM-IDEA-STREAM-UI-1 [reach, partial]: Public read-only real-time idea stream UI (QNFO idea/chat development) linked from qnfo.org
- RM-TP-4-COST-FLEET-40 [cost, partial]: T4 Cost: fleet run-rate <= $40 and the building metered (fleet/session/owner lines, prefix cache, draft-verify
- RM-TP-7-REACH-REVIEW-GATE [reach, partial]: T7 Reach that survives the review gate: subscribe box on every public page, citation_pdf_url, funnel monitor, 
- RM-DURABLE-AGENT-EXECUTION-1 [autonomy, partial]: Durable multi-step agent execution on Workflows with checkpointed continuation (removes tool-budget exhaustion
- RM-NO-CLAUDE-RUNTIME-1 [autonomy, partial]: No Claude dependency at runtime: every recurring operation, owner document, decision and dashboard runs on Clo
- RM-NOVEL-FAILURE-REPAIR-1 [autonomy, partial]: Scripted repair for novel failure classes: failure-class -> remediation_modules library with automatic dispatc
- RM-S4-BENCHMARK-1 [autonomy, partial]: S4 intelligence battery from n=8 to a SWE-bench Pro / Terminal-Bench subset, scored weekly
- RM-SECRETS-STORE-1 [security, partial]: Secrets Store for API keys with scripted rotation across workers, GitHub secrets and clients
- RM-TP-1-AUTONOMY-ENGINE [autonomy, partial]: T1 Autonomy engine: the code loop becomes the builder (rebase, anchor repair, container verifier, own branch p

**Threats**

- shutdown_manifest phase 0 OWNER-KILL ARMED (due continuous)
- shutdown_manifest phase 1 ALL-RESEARCH ARMED (due 2026-12-31)
- review gate 2026-12-31 OPEN: credibility_events 0; confirmed_subscribers 1; funding 0 (2026-10-01)
- AI spend ai_spend:workers-ai $800.36 over cap $95
- open security issue #1002388 SECRET-CHANGE-OBSERVED: q08-prediction-markets 2026-11-07
- open security issue #1002123 OWNER-AI-CONTROL-3: qnfo-research-exec, the largest Workers AI spender, consults
- open security issue #1002122 OWNER-AI-CONTROL-2: the qnfo-ai router consults the owner pause authority before
- open security issue #1002071 BP26-AI-ASK-DISCLOSURE-2: ai_interaction_disclosure counts the ask.qwav.tech que
- open security issue #1002070 BP26-AI-ASK-DISCLOSURE-1: ask.qwav.tech says at the question box that an AI lang
- open security issue #1002037 SECRET-VERIFY-1: SECRET-CHANGE-WATCH-1 files an issue per secret change that not
- open security issue #1002035 SECRET-CHANGE-OBSERVED: qnfo-gateway 2026-11-05
- open security issue #1002030 BP26-RETENTION-EXPORTS-1: cf-ops-actions r2-lifecycle reads the qnfo-backups lif
- open security issue #1001984 BP26-PII-LOGS-3: qnfo-cloud-ops sendDigest returns the recipient domain, not the
- open security issue #1001965 YT-C2PA-1: sign a C2PA manifest into every Short (remainder of YT-13, BP26-PROVE
- and 3 more

### Roadmap by horizon (roadmap_implementation)

| Horizon | Meaning | Items |
|---|---|---|
| H0 | now: broken, violated or awaiting gate verification | 0 |
| H1 | to the 2026-12-31 review gate: partial builds to finish | 37 |
| H2 | after the gate: not yet built | 91 |
| watch | gates enforced but partial or unverified | 344 |
| parked | owner decision, deferred or local-only (a default is in effect) | 8 |
| done | gates enforced and verified, or remediated | 20 |

Top of the queue (priority = pillar weight x status weight):

- H1 RM-CITATION-TRACKING-ALL-DOIS-1 [reach, partial] Daily Crossref/OpenAlex/Zenodo impact collection for all 217 DOIs feeding impact_scores
- H1 RM-COST-FREE-FIRST-PARITY-1 [cost, partial] Audit every AI-calling worker for one cost policy per path (streaming vs non-streaming, cron vs manual, agent 
- H1 RM-COST-L6-DRAFT-VERIFY-1 [cost, partial] L6 formal draft-verify pipeline (free draft, paid verify/repair) beyond the code class
- H1 RM-IDEA-STREAM-UI-1 [reach, partial] Public read-only real-time idea stream UI (QNFO idea/chat development) linked from qnfo.org
- H1 RM-TP-4-COST-FLEET-40 [cost, partial] T4 Cost: fleet run-rate <= $40 and the building metered (fleet/session/owner lines, prefix cache, draft-verify
- H1 RM-TP-7-REACH-REVIEW-GATE [reach, partial] T7 Reach that survives the review gate: subscribe box on every public page, citation_pdf_url, funnel monitor, 
- H1 RM-DURABLE-AGENT-EXECUTION-1 [autonomy, partial] Durable multi-step agent execution on Workflows with checkpointed continuation (removes tool-budget exhaustion
- H1 RM-NO-CLAUDE-RUNTIME-1 [autonomy, partial] No Claude dependency at runtime: every recurring operation, owner document, decision and dashboard runs on Clo
- H1 RM-NOVEL-FAILURE-REPAIR-1 [autonomy, partial] Scripted repair for novel failure classes: failure-class -> remediation_modules library with automatic dispatc
- H1 RM-S4-BENCHMARK-1 [autonomy, partial] S4 intelligence battery from n=8 to a SWE-bench Pro / Terminal-Bench subset, scored weekly
- H1 RM-SECRETS-STORE-1 [security, partial] Secrets Store for API keys with scripted rotation across workers, GitHub secrets and clients
- H1 RM-TP-1-AUTONOMY-ENGINE [autonomy, partial] T1 Autonomy engine: the code loop becomes the builder (rebase, anchor repair, container verifier, own branch p
- H1 RM-TP-6-DURABLE-EXECUTION [autonomy, partial] T6 Durable execution: ops agent, research pipeline, code tasks and metric events on Workflows and Queues; cron
- H1 RM-TP-8-TRUST-BOUNDARY [security, partial] T8 The trust boundary: memory-mcp auth, containers token or Access, Access on admin routes, WAF and rate limit
- H2 RM-EDGE-CACHE-PAPERS-1 [cost, not-built] Workers Cache in front of papers.qnfo.org (504s) and AI Gateway fallback routes for router 400s

### Review gate 2026-12-31

State **OPEN**. credibility_events >= 2 OR confirmed_subscribers >= 50 OR funding_secured, AND ai_spend_30d within the $150 cap (docs/STRATEGY.md s9) Baseline: credibility_events 0; confirmed_subscribers 1; funding 0 (2026-10-01).

### Charter breaches

None. Every MVP component is serving.

### Portfolio (GitHub organisation QNFO)

132 repositories (12 private): platform 6, research 7, demo 8, archived 105; synced 2026-11-08T03:05:53.686Z. Full register: docs/PORTFOLIO.md and `GET /portfolio`.

### Terminal objectives (qnfo-audit.objectives, immutable by the fleet)

- **mission** v1 (ACTIVE, ratified 2026-09-14): Every recurring function runs in the cloud. The fleet operates, heals, audits, improves, publishes, and promotes itself. The human role narrows to policy-setting and exception handling.
- **objective-function** v3 (ACTIVE, ratified 2026-10-01): Maximize SAI = 0.15*autonomy + 0.15*thinking + 0.15*decision + 0.20*self_improv + 0.10*reliability + 0.10*integration + 0.10*external_impact + 0.05*governance, subject to the autonomy-ladder cap, cost ceilings (A9), and the residual-consent...
- **cost-ceiling** v2 (ACTIVE, ratified n/a): CORRECTED 2026-09-26 (units error fixed): AI Gateway billing is in CENTS. Actual AI Gateway spend ~$110/mo (20×$10.50 top-ups + $21 manual = $231 over 62.5d) with real gateway usage ~$5.51/24h (~$165/mo), right at/under the declared $150/mo...
- **return-on-spend** v3 (ACTIVE, ratified 2026-10-01): REVISED 2026-10-01 (docs/STRATEGY.md s6.3, s8, s9): tie total spend (~$725/mo on 2026-09-26: Cloudflare plan ~$200, direct providers ~$400-500 unmanaged, AI Gateway ~$110-170) to return measured by the reach scorecard: search impressions (G...
<!-- CHARTER-LIVE:END -->
