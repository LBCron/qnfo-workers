# Blue-sky roadmap and wish list (BLUESKY-2026-11)

Charter pillars: every bet below names its own. Programs: all five. Owner directive 2026-11-04 (chat), verbatim: "BUILD OUT ROADMAPS AND WISH LISTS FOR BLUE-SKY
IMPROVEMENTS TO CLOUDFLARE FLEET AND ALL PROPERTIES/PRODUCTS/SITES. THINK BIG AND BOLD! RESEARCH BEST PRACTICES AND INNOVATIVE IDEAS."

Method: four scouts read the live Cloudflare changelog, blog and docs, arXiv and engineering blogs, and the public sites on 2026-11-04 (about 130 ideas,
indexed in Appendix A); this session probed the load-bearing claims itself and re-read the charter, SYSTEM-MAP, READER-YIELD, COST-AND-D1-ANALYSIS,
PLUSSING, BP26 and both SCOUT rounds so nothing already planned is filed twice. Evidence flags used throughout: **R** = measured by this session against
the live system or the repository; **F** = a scout fetched the page and read it through the fetch tool's summary (numbers are as reported, the adopting PR
re-reads the primary source, CITE-FULLTEXT-1); **S** = search excerpt only, unverified; **est.** = an estimate with no measurement behind it. No cost or
reader figure in a prediction below has been measured on this fleet.

This is a plan. It moves no limit: the interrupt gate, the harness's permission checks, the secret lock, work claims, outreach consent and suppression,
and the personal/research separation keep their precedence. Section 9 says exactly what was filed.

## 0. The short version

1. **The constraint is not capability, it is yield.** About 950 papers earn about 0.12 external visits and about 3 engaged sessions each (READER-YIELD, R);
   output swung 2 to 89 papers a day and readers did not move. No Cloudflare feature the scouts found moves engaged readers by itself. The reader bets
   therefore remove blockers, make the work findable by agents and answer engines, and build things people use (demos, an oracle, a dataset), not more pages.
2. **Cost needs a different shape, not a trim.** Platform features reach roughly 40 to 50 percent of the measured Workers AI line (COST-AND-D1 analysis, R);
   a 3x cut needs fewer or cheaper stages: cascades, routers, distilled classifiers, a sealed eval that lets a cheap model replace an expensive one. Measured (R, B1 first reading):
   the meter went from USD 6 a day on 10-22 to USD 33 to 40 on 11-01 to 11-04 while papers a day rose 1.3x, because research-exec makes 3.7x the calls (21 percent of its
   `glm-5.3-flash` calls now error) and neurons per paper are 2.6x higher; bounding calls per paper comes before any model swap.
3. **D1 should hold control state and nothing else.** Telemetry goes to a lake, locks go to Durable Objects, switches go to flags. Size is not the limit
   (10 GB per database, F); one query at a time per database is.
4. **Nobody can say whether the fleet is getting better.** Measured (R): the reader series has a standard deviation of 5.0 on a mean of 5.1 a day, so two 7-day windows
   cannot tell a change smaller than +7.4 a day (more than double) from noise; two 28-day windows reach +3.7 (B4, first reading). Honest measurement is a bet of its
   own because every other bet is judged by it.
5. **Sixteen bets, three waves, four gates.** Wave 0 is small, reversible and has dated deadlines; later waves open on metrics, not on the calendar.
6. **Verified defects found on the way, filed with doers:** `ideas.qnfo.org` publicly lists a raw prompt as a thread; `ask.qwav.org` declares
   `ask.qwav.tech` canonical; `qwav.org/llms.txt` redirects to the homepage; `fleet.qnfo.org` serves "Loading..." with no social tags; a paper's `.md`
   carries an e-mail address (not named here) and a different author and date than its page. Section 4.
7. **Corrections to what the repo believes:** AI Search billing starts 2026-12-01, not 2026-11-01 (fixed in docs/AI-SEARCH-INSTANCES.md); D1 enforces a 50 MB
   result cap from 2026-11-04; D1 read replicas work through bindings only, so every runner and REST read still hits the primary. Section 5.

## 1. Where the Quniverse stands

| Fact | Evidence |
|---|---|
| Portfolio verdict RED; QNFO.OPS is the constraint (risk 528 of 617); 510 open issues, 336 critical, 116 high; 14 focus issues have no doer | `GET fleet.qnfo.org/api/managers` and `/api/portfolio/latest`, R, 2026-11-04 |
| North stars off target: readers 6.29 against 12, cost 798.53 against 300, reliability 2048 against 3000 | `/api/managers`, R |
| Three live cost figures disagree: USD 160.11 month-to-date with a USD 1,601 forecast (SYSTEM-MAP, includes a USD 450 owner-stated line no API sees), 798.53 (managers), 428.28 against a 200 ceiling (portfolio) | R. The disagreement is itself a finding: cost needs one invoice-grade ledger (CF-A-16, CF-B-19) |
| Workers AI measured about USD 22 a day (USD 155 over 7 days) against a budget of about USD 10 a day; 117k neurons per publication against a 20k target; counters explain about USD 100 of the 155, so about USD 35 a week has no named caller | docs/COST-AND-D1-ANALYSIS-2026-11-04.md, R |
| 2.0M neurons and 41.6M input tokens a day; research-exec and the code loop are most of it | SYSTEM-MAP, R |
| About 950 papers; external visits per paper 0.12; 33 of 868 paper keys have any outside referrer load; engaged sessions are dominated by repeat users (the Netherlands: 116 of 307 in 28 days) | docs/READER-YIELD.md, R |
| D1 `qnfo-audit` is 1.5 GB, 953 tables, one writer: 2.39 billion rows read and 3.3 h of database time a day; one `fleet_tick` insert fires 52 triggers | COST-AND-D1 analysis, SYSTEM-MAP, R |
| The plan is larger than the capacity: QNFO.OPS holds 501 roadmap items "now", 133 "next", 228 "later" | `/api/portfolio/latest`, R |
| Outcome measures are mostly proxies; the best reviewer in the literature catches 71.6 percent of injected errors, the fleet's rate is unmeasured | OUTPUT-QUALITY-LEDGER, arXiv 2606.19749 (F) |

## 2. Rules for a blue-sky bet

1. **A bet names** the north-star metric it moves, a prediction (direction, size, date), a kill criterion, the program that owns it and its charter pillar. A
   bet without a kill criterion is a wish and lives in section 7.
2. **Net-zero footprint.** 36 workers are live against a cap of 30 and a target of 24 (charter section 6). A bet lands inside an existing worker, a Workflow,
   a Durable Object, a Queue or a flag; a new worker names the retirement it funds, or the bet waits.
3. **Reversible first.** Shadow runs, dual writes, flags, Worker previews. A bet that cannot be undone in one change is split until the first slice can.
4. **Judged by a measure the bet did not write.** A proxy is labelled `proxy` and never counted toward the verdict (OUTPUT-QUALITY-LEDGER-1); B4 supplies the
   non-proxy measures.
5. **Filing discipline.** The backlog is 510 issues and 862 roadmap rows. Bets are `roadmap_implementation` rows (planned); only Wave 0 items with a verified
   defect, a code anchor and a closing probe become `agent_issues` (CODE-CHANGE-REQUIRED-1). A scout idea is never filed from a search excerpt.
6. **Replace before adding.** Each bet that lands retires or absorbs an open roadmap row of the same class, named in its PR, so the count falls.

## 3. The sixteen bets

Prediction lines are hypotheses to be logged in `decision_log` before the first change (PROACTIVE-PROGRAMS-1 rule 4). Ids in brackets index Appendix A.

### B1. Quniverse-small: every call on the cheapest model that passes a sealed eval (cost; program OPS with RSCH)
- **Vision.** A request carries an intent, not a model. A router trained on the fleet's own outcomes picks the cheapest model that has passed the stage's
  eval; classification-shaped calls leave the reasoning models for deterministic decision models; strong-model demonstrations are replayed into cheap prompts.
- **Build.** W0: count calls that end at `max_tokens` and abort looped generations in-stream [AGT-07]; set reasoning effort per stage, since gpt-oss-120b defaults
  to medium and deepseek-v4.1-flash to high [AGT-04]; A/B the prefix-cache key per rubric against per paper and read cached tokens from `usage` [CF-A-04];
  gateway metadata per worker so the unmetered kimi calls get a name [CF-A-01]. W1: model aliases (shipped 2026-11-04, F) with an ordered pool that
  qnfo-model-eval can reorder after a benchmark [CF-A-02]; benchmark Clef, Clef-flash and Clairic on the golden sets for triage, severity, intent and the
  degenerate-text pre-screen [CF-A-03, AGT-06]; `rejectIfBusy` plus the Batch API for latency-tolerant stages [CF-A-05]; two-stage judging with a small judge first
  [AGT-05]; replay a learned router on `ops_ai_log` against Cloudflare's own Auto Router, whose claim is up to 30 percent [AGT-02]. W2: GEPA prompt search on
  the cheap tier [AGT-01]; in-context distillation with escalation on disagreement [AGT-03].
- **First reading (W0, R, 2026-11-05; qnfo-audit `cost_daily`, `ai_call_counters`, `ai_spend_ledger`, read-only).** The cost problem is a recent rise, not a standing level.
  Account-meter Workers AI spend (fleet scope) was USD 6 to 9 a day on 7 of the 24 days from 10-12 to 11-04 (the target of USD 300 a month is USD 10 a day), spiked to USD 40 to 56
  on 10-18 to 10-20 (the 56-paper day), fell back to USD 6.2 to 6.5 on 10-22 and 10-23, then climbed to USD 33 to 40 a day on 11-01 to 11-04. Comparing 10-22..24 with 11-01..03
  (per day): papers published 8 to 10.7 (1.3x); `qnfo-research-exec` calls 420 to 1,561 (3.7x) and neurons 254k to 876k (3.4x), so neurons per published paper rose from about 32k
  to about 82k (2.6x); `qnfo-code-orchestrator` neurons 180k to 480k (2.7x). In research-exec, `glm-5.3-flash` errors went from 3 of 346 calls (0.9 percent) to 636 of 3,014 (21 percent;
  by purpose 26 percent revise, 34 percent ensemble, 27 percent reconcile, 16 percent complete, 11 percent review), and two purposes, `complete` and `reconcile`, which had no calls
  on 10-22..24, took 764 calls on 11-01..03. The per-model ledger (117 rows since 10-01) names only about USD 11 of the roughly USD 30 a day rise in the meter, so about 63 percent of it
  has no named caller. Reading: the rise is volume per paper (more calls, new stages, failed calls that are retried or sent to a dearer model), not price and not paper count.
  Cause of the errors (R, `cloud_ops_events`, the last 60,000 events, which are capped per kind and so a lower bound): they are provider-side, not a prompt bug.
  `aiText model=@cf/zai-org/glm-5.3-flash threw: 3040: Capacity temporarily exceeded` (405 events in the sample, 128 of them on 11-02), request timeouts `3046` on glm-5.3 and kimi-k2.6
  (190 on 11-02 and 262 on 11-03, from 10 to 70 a day in mid-October), and `cost-first-empty` (the cheap model returned nothing and the call fell back to `gpt-oss-120b`) rising
  from 35 a day on 10-27 to 206 a day on 11-03. Whether Workers AI bills a capacity or timeout failure is unverified. So the first W0 steps are to name the unattributed share [CF-A-01],
  send capacity failures to an alias fallback with `rejectIfBusy` or defer them to the Batch API instead of retrying at once [CF-A-02, CF-A-05], and bound calls per paper before any model swap,
  which would only lower a price on a volume that has tripled. Open critical issues already own the cost levers (agent_issues 1000031
  COST-LEVER-1, research-exec is 73.6 percent of Workers AI spend; 1000988 METRIC-354, research-exec escalates 50 percent of calls from `glm-5.3-flash` to the 1.7x dearer `gpt-oss-120b`),
  so nothing new is filed: the capacity errors are the cause behind the second. Caveats: three-day windows; the fleet counters undercount the meter
  (2.4x, COST-AND-D1 analysis); error counts include retried calls; the event log is a sample, so its counts are not the 636 failed calls in the counters.
- **Measure.** Prediction (est.): Workers AI neurons per engaged reader on the moved stages fall at least 3x within 60 days of W2 with no fall in the sealed
  eval (B4) and no rise in `open_high_errata_share`. Read on the Cloudflare account meter, not the fleet counters, which undercount 2.4x. A W0 prediction that can be checked sooner:
  the daily meter returns to USD 10 or less on at least 5 of 7 days within 14 days of the call-per-paper bound landing, the level it held on 7 of the last 24 days.
- **Kill.** Any moved stage whose sealed-eval score falls more than one noise-floor width reverts to its previous model within the day.
- **Failure mode.** Prompt search overfits a 20 to 100 item set and one review reports the headline gain flips under variance weighting (AGT-01, F);
  distillation lost 21 percent accuracy on one benchmark (AGT-03, F); Cloudflare's decision model agreed 0.17 with the fleet's labels, so labels come first.
  BUDGET-SOFT-ROUTE-1 holds: spend limits are a runaway fuse near 3x normal, never a stop.

### B2. The data spine: D1 holds control state and nothing else (reliability, cost; program INFRA)
- **Vision.** Append-only telemetry lives in an Iceberg lake queried by SQL; locks and claims live in Durable Object SQLite with per-object restore; kill
  switches and hot caps live in flags; D1 `qnfo-audit` keeps only the control tables a loop reads and writes in one statement.
- **Build.** Extends docs/D1-SPLIT-DESIGN-2026-11.md (P0 to P2) and COLD-TIER-1, which keep precedence. W0: guard against the 50 MB result cap [CF-A-11,
  CF-B-15]; read-only runner probes through a replica session, because the Sessions API is binding-only [CF-B-13]; `ops_config` as a KV snapshot with
  instant D1 reads kept for flagged kill switches [CF-B-14]; traces on the four heaviest workers to name the next 8-second statement [CF-B-12]. W1: one
  Pipelines stream to Iceberg for `fleet_probe_log` or `remediation_verifications`, as an alternative destination to the planned second D1 database, chosen by
  a measured pilot (Basin went GA 2026-10-01; Pipelines USD 0.04 per GB transform, SQL USD 2.50 per TB scanned, F) [CF-B-01]; a Queue write-coalescer for
  `cloud_ops_events` and `fleet_heartbeat`, which saves little unless the trigger logic moves into the consumer [CF-B-02]; Analytics Engine for heartbeats
  and rates, never for spend caps because it samples [CF-B-18]. W2: coordination plane (`work_claims`, `deploy_locks`, secret leases, `loop_lock`) on Durable
  Object SQLite, 10 GB per object and 30-day point-in-time recovery, which closes the "Time Travel is whole-database" gap [CF-B-03]; kill switches to Flagship
  and numeric caps to KV Instant once priced [CF-A-07, CF-B-30].
- **Measure.** Prediction (est.): primary rows read a day on `qnfo-audit` fall from 2.39 billion to under 1.2 billion and the "Too many resources consumed"
  overload does not recur for 14 days. Verify per statement from D1 trace spans (`rows_read`, `served_by_primary`, F).
- **Kill.** Dual-write drift above 0.1 percent for 24 hours, or a view that cannot be rebuilt from the lake, stops the cutover of that table.
- **Failure mode.** The 33 views over `remediation_verifications` and the 287 triggers make a lake cutover a rewrite, not a move; Pipelines are stateless;
  Postgres through Hyperdrive [CF-B-10] is rejected for now because D1 is about USD 47 a month and not the cost driver.

### B3. The fleet twin: a change proves itself before it merges (reliability, autonomy; program OPS)
- **Vision.** Every self-change runs on a candidate Worker version on its own URL, is probed there, shadow-replays seven days of recorded tool results, and merges only
  on non-regression. The code loop's attempts live in disposable repositories; only the winning diff becomes a GitHub pull request.
- **Build.** W1: promote through Worker Previews and run `probes.json` there [CF-A-14]; percentage canary and seconds-level rollback via Worker versions
  [CF-B-06]; agentic property-based tests for parse and migration invariants [AGT-15]. W2: harness-tamper audit (hash the eval scripts, score with a pristine
  evaluator, inject held-out tests late) [AGT-13]; TLA+ specs for the lane, work-claim, secret-lock and tick order [AGT-14]; the replay twin [AGT-16]; code-loop
  attempts in Artifacts repositories verified in Dynamic Workers, relieving the GitHub REST stall (0 of 5000) and the Actions storm [CF-A-15].
- **Measure.** Prediction (est.): reverts per merge halve and mean time to restore falls under 10 minutes within 60 days of W2. The current revert rate and MTTR are
  not measured: measuring them is the first W1 step.
- **Kill.** A twin that costs more neurons per merge than the reverts it prevents is cut back to previews only.
- **Failure mode.** Preview isolation of D1 and KV is undocumented and a preview may touch production data (F); replay is not interactive; Durable Object workers cannot
  go gradual; specs drift from code.

### B4. Honest measurement: is the fleet getting better, and how would we know? (all pillars; program OPS)
- **Vision.** Every north-star and outcome measure ships with its noise floor, a human anchor and a pristine control.
- **Build.** W0: an A/A noise floor and minimum detectable effect for each outcome measure before any keep or revert in PLUSSING-4 [MEAS-01]. W1: seeded known
  errors in a sample of drafts, reviewer recall published monthly [MEAS-03]; a first-party reader ledger from Logpush into the lake, replacing guesswork behind
  `engaged_reader_sessions` where Cloudflare's bot fields allow it [CF-B-05]; invoice-grade cost from the Billable Usage API [CF-A-16, CF-B-19]; the AI
  answer-engine loop (crawler and referral GraphQL, agent-readiness score) as the only platform-native external-reader signal [CF-A-10, MEAS-06]. W2: about 25
  one-tap owner labels a month, with prediction-powered inference giving valid intervals for judge scores [MEAS-04]; human anchors re-scored by the current
  judge to separate judge drift from system drift [MEAS-02]; a 5 percent holdout on a frozen "fleet v0" [MEAS-07]; enter the q08 forecasts in an external bot
  tournament [MEAS-05].
- **First reading (W0, R, 2026-11-05).** From `reader_yield_daily` (qnfo-audit, 11 complete days 2026-10-25 to 2026-11-04, the span GA4 has been ingested), externally
  sourced engaged sessions a day (`ga4_engaged_external`, the series behind the North Star "readers" figure; the managers' 6.29 reproduces as the 7-day mean ending 11-03):
  mean 5.1, standard deviation 5.0, variance 4.8 times the mean (spiky, not Poisson), range 0 to 15. Treating days as independent, a 7-day mean carries a standard error of
  1.9 (a 95 percent band of about plus or minus 3.7); the five rolling 7-day means in the data span 5.4 to 7.6 with nothing changed on purpose. The smallest effect two
  7-day windows can tell apart (alpha 0.05, power 0.8) is **+7.4 a day, 145 percent of the mean**; two 14-day windows +5.2; two 28-day windows +3.7 (73 percent). So a
  keep-or-revert rule that compares a reader count across two 7-day windows (PLUSSING-4's seven-day outcome check, wherever a plus registers a reader count as its outcome)
  will keep or revert most plusses on noise; a reader-outcome plus needs a 28-day read, or a measure with more events (per-page engaged rate, click-through on owned
  surfaces). The target of 12 a day sits 3.7 standard errors above the current 7-day mean, so reaching it would be visible within a week; a drift from 6 to 8 would not.
  Caveats: 11 days, one weekly cycle at most, a 15 on 11-01 inflates the deviation, days are not independent in practice (shared referrers), and the owner's own browsing is
  still in the series until the GA4 internal-traffic filter (`ga4-internal-traffic-1`) is active. Papers published against next-day external engaged sessions correlate at
  -0.7 on 10 pairs, which is descriptive only and consistent with READER-YIELD's finding that readers do not follow output. The other reader North Star, external visits per
  paper (`paper_readership.ext_30d`): 62 external loads over 870 papers in 30 days (34 papers have any, the most is 7), 0.07 a paper against a target of 0.25, which needs about 218
  loads. Poisson error on 62 events is about plus or minus 13 percent, but loads cluster on few pages, so the effective sample is nearer the 34 papers: a tripling would show in one
  30-day window, a 30 percent gain would not. Cost has the opposite problem: its day-to-day swing (USD 6 to 56) is large, but the gap to target is 3x, so a 7-day cost reading is decisive.
- **Measure.** Prediction: within 30 days every metric in `v_output_quality_headline` has a published noise floor, and the verdict names which movements
  are below it. Success is a claim the fleet withdraws because it was inside the noise.
- **Failure mode.** At 6.3 readers a day nothing may be detectable; the honest result is then "unmeasurable at this volume", which redirects effort to B5 rather than
  being reported as flat. Owner labels add owner load, capped at 25 a month.

### B5. Papers that answer back: answer-engine and agent reach (readers; program REACH)
- **Vision.** A stranger's agent or answer engine can find, cite and query any paper: a per-paper endpoint grounded only in that paper, markdown on request,
  clean metadata, no crawler block, and a visible record of which assistants fetched what.
- **Build.** Already live in qnfo-gateway: llms.txt, markdown, WebMCP and Content-Signal (R, repo). W0: a daily read-only probe that no AI-crawler block exists on
  the three zones (Search, Agent, Training toggles, Bot Preference Sync, new-domain defaults) [CF-A-09]; fix the verified metadata contradictions (section 4).
  W1: markdown for agents and a real `llms.txt`, feed and sitemap on `qwav.org` and `q08.org` [PROD-08]; NLWeb `/ask` and `/mcp` on the oracle through AI Search
  with rate limits [PROD-11]; redirects for verified AI-training crawlers to the canonical paper version [CF-A-26, CF-B-20]; agent journeys through Browser Run proving an
  agent can use the paper tools [CF-A-13]. W2: "ask the paper" endpoints with a reproduction capsule where a paper ships code [SCI-03]; shareable answer permalinks
  with a citation-card image [PROD-27].
- **Measure.** Prediction (est.): agent and answer-engine referrals become a measured series within 14 days (today there is none), and external-referrer loads per
  paper rise from 0.12 to 0.3 within 90 days. Cloudflare cites a 1,700 to 1 crawl-to-referral ratio for one operator (S, June 2025): the series may show that
  agents read far more than they send.
- **Kill.** Two consecutive 30-day windows with agent reads up and external referrals flat end the investment beyond the permalink and markdown basics.
- **Failure mode.** Evidence that llms.txt lifts citations is weak (no lift found across 300,000 domains, S); NLWeb has no public deployment count (S); a bad answer
  with a citation card can travel, so the existing removal rule applies. Cost while over budget: NLWeb ships rate-limited and cached or not at all.

### B6. Quantum Sandbox Academy and the verified-quantum commons (readers, research; program REACH with RSCH)
- **Vision.** The ten `qwav.org` demos become a six-lesson path with in-browser notebooks and shareable results; each demo carries a certificate that a second
  simulator agrees; a living tracker states which advantage claims survive.
- **Build.** W0: real 404s instead of the homepage with HTTP 200, a real `llms.txt`, `feed.xml` and a sitemap that lists the demos (section 4) [PROD-09]. W1: read each
  demo's computed values headlessly and compare them to the Python golden check, the gap docs/QWAV-CROSS-SIMULATOR.md names [QNT-01]; permalink, state image and
  embed snippet per demo [PROD-20]. W2: dual-simulator certificates (RM-QWAV-CROSS-SIMULATOR-1) and Stim where a demo claims error correction [QNT-03]; an "advantage
  claim watch" mirroring the IBM tracker [QNT-02]; each demo run in a Dynamic Worker with no outbound network so a reader can run the paper's own code [wish list 1];
  email capture at lesson three (consent and double opt-in unchanged) [PROD-17]; consolidate the 497 `deep.qwav.tech` pages under `qwav.org` with 301s once
  migrated, which DOMAINS.md requires first [PROD-10].
- **Measure.** Prediction (est.): engaged sessions on `qwav.org` from outside the fleet reach 3 a day within 60 days; verified-demo share reaches 100 percent.
- **Failure mode.** The scout found demo code is tree arithmetic today, not quantum hardware, so a certificate must say what it certifies; overclaiming is the main
  reputational risk (QNT-02 exists to guard it). License conflict between CC-BY-NC pages and QNFO-ULA must be resolved before consolidation.

### B7. The self-auditing journal: claim graph, challenge queue, signed provenance (research; program RSCH)
- **Vision.** Every paper page shows live status: claims checked, errata open, code reproduced, human review recorded. A reader can challenge a claim; the fleet
  re-runs the check and publishes the result. Papers ship checkable claims and auto-resolving predictions and publish their claim half-life.
- **Build.** Builds on BP26-CLAIM-LEDGER-1, BP26-CORRECTIONS-FEED-1, BP26-PROVENANCE-MARKING-1 and RM-PAPER-PROVENANCE-TRACE-1. W1: a deterministic reference-existence
  gate with Browser Run `/crawl` and `/markdown` for full-text fetch, honoring Content Signals [CF-A-12, RM-CITE-EXISTENCE-GATE-1]; a per-paper human-review
  record and errata status shown above the fold [PROD-13]. W2: typed claim graph with claim-to-citation alignment, cross-paper contradiction checks and 30-day claim
  survival [SCI-01]; signed provenance per revision (Sigstore hash, model ids, seeds) and an AI-disclosure block [SCI-04]; a Lean 4 lane for theorem claims
  where `sorry` counts as unverified [SCI-02]; each paper as a Git repository in Artifacts so revisions are commits and Zenodo versions are tags [CF-B-25].
- **Measure.** Prediction (est.): share of papers with a recorded human review and zero open high errata rises from the 2026-10-26 baseline (361 of 694 papers had an
  open high erratum, docs/OUTPUT-QUALITY-LEDGER.md) by 20 points in 90 days; seeded-error recall (B4) rises with it.
- **Failure mode.** Same-family extractor errors; labels measure disclosure, not quality; moving the 312 MB revision ledger into Artifacts means re-implementing
  PAPER-LEDGER immutability and the withdraw guard on a beta store.

### B8. Managers that evolve their own prompts and thresholds against sealed outcomes (autonomy; program OPS)
- **Vision.** The fleet keeps a variant archive for manager prompts, thresholds, routing tables and cadences, evolves them against outcomes it cannot edit, and
  measures itself against a frozen v0 holdout.
- **Build.** W1: per-loop session-cost alarm at 2x the loop's own p95 [AGT-17]; every closed critical issue becomes a regression eval scored pass^k [AGT-19]. W2:
  evolve thresholds, prompts and cadences against a scorer, through the canonical path only [AGT-12]; a hyperagent loop with an editable meta-procedure [AGT-11];
  the holdout [MEAS-07].
- **Measure.** Prediction (est.): `remedy_efficacy_30d` and time-to-fix improve against the holdout with no guard metric worse.
- **Kill.** Any evidence the loop edited its own scorer or evaluator stops it and files a tamper issue (AGT-13 is the prerequisite, so B3 W2 precedes B8 W2).
- **Failure mode.** Goodhart; harness tampering (a 2026 paper reports illusory gains and authorization violations, F); run cost; a self-name is a label, never an
  authority (doctrine readings m to t).

### B9. The capability-secured fleet (security; program OPS)
- **Vision.** No static shared token on an internal route, no secret in a sandbox, every tool call allowlisted and audited, every agent's authority attenuated to its task.
- **Build.** W1: one governed MCP front door with per-tool allowlist, audit and code-mode policy (portals GA 2026-09-24, F) over qnfo-ops, qnfo-tools-mcp and
  qnfo-memory-mcp [CF-B-07]; Access for Workers with service tokens in place of `x-loop-token` on internal routes, never on public reads (OPEN-ACCESS-1) [CF-B-08];
  workers.dev and preview URLs off for non-public workers after checking deploy-guard's callers [CF-B-24]; R2 data-access logs on the private buckets [CF-B-23].
  W2: outbound-Worker credential injection so sandboxes never hold tokens [CF-A-22]; Secrets Store for shared secrets once its status is confirmed (the scout read
  it as GA in one fetch and beta in another) [CF-B-21]; task-scoped attenuating tokens and a trust ratchet [AGT-18].
- **Measure.** Prediction: static internal tokens fall from the current count to zero on the covered routes; `security_open_issues` stays 0.
- **Failure mode.** Direct server URLs bypass a portal unless Access is the OAuth provider; the egress Worker becomes a single point of failure (record it in
  `spof_registry`); the secret lock and live leases keep precedence over every item here.

### B10. The personal plane: isolation, on-device, proactive precompute (personal; program PERSONAL)
- **Vision.** The personal twin runs in its own account boundary with its own bill, keeps raw private text on the device, and uses idle time to prepare what the owner
  will want, asking first.
- **Build.** W1: keyed memory where facts supersede and instructions are immutable, plus a weekly injection canary [PER-02, CF-A-19 when the beta opens]. W2: idle-time
  precompute with ask-first [PER-01]; on-device Gemma 4 over WebGPU for raw private text, cloud sees summaries only [PER-03]. W3: move the personal workers and stores to a
  separate Cloudflare account [CF-B-11]. `me.q08.org` was not audited by the scouts (sign-in); its owed items stay on the Today-tab list in memory.
- **Measure.** Prediction (est.): owner-effort measures (taps to a done task, UX-JOURNEYS budgets) fall; personal cost becomes a visible separate line.
- **Failure mode.** Personal workers bind `qnfo-audit` today and there are no cross-account service or D1 bindings, so isolation is a rewrite of every shared read; on-device
  quality varies by device; the research stores are never queried from this plane.

### B11. Open data commons and the atlas of AI-written science failures (research, reach; program RSCH)
- **Vision.** The corpus, knowledge graph, citations and the errata and reproduction record are published as an open Iceberg catalog and a Hugging Face dataset with a
  DOI and an `ai_generated` field, queryable in a browser; the failure record becomes the first open dataset of how AI-written papers fail.
- **Build.** W1: publish errata and reproduction logs as a feed [PROD-26]. W2: dataset with data card [PROD-25]; public Iceberg catalog read plus DuckDB-WASM "query us in
  your browser" if anonymous catalog reads are allowed (unverified) [CF-B-26]; a replayable incident benchmark, with secrets removed [SCI-05]. W3: charging bulk AI
  crawlers for full text through Monetization Gateway [CF-B-27] only if the owner sets a policy, because it conflicts with OPEN-ACCESS-1 and receiving money is IDENTITY-BOUND.
- **Measure.** Prediction (est.): dataset downloads and outside citations of the failure record, first read at 60 days.
- **Failure mode.** Contamination of benchmarks by the dataset; license must permit publication; the record shows defects, which is the point and a reputational cost.

### B12. A self-reporting platform: retire home-grown telemetry capture (reliability, owner load; program INFRA)
- **Vision.** Exceptions, 5xx and slow routes arrive as grouped, source-mapped issues from Cloudflare, not from log scraping in `qnfo-observability`.
- **Build.** W1: Workers Issues (open beta) into `agent_issues` by webhook with a `code-task:` doer, deduped by group id so the 510 are not inflated [CF-A-06, CF-B-04]; custom SQL
  alerts to a qnfo-ops intake instead of hourly probes [CF-A-27, CF-B-22]. W2: agent tracing for qnfo-agents [CF-A-29]; weekly CPU and memory profile of the three heaviest
  workers feeding a `code-task:` [CF-A-28]. Dec-1 observability pricing (50 GB included, USD 0.25 per GB after, F) is covered by BP26-OBSERVABILITY-1; this bet adds the audit
  of the 67 blocks at `head_sampling_rate` 1 [CF-A-23].
- **Measure.** Prediction (est.): exception detection moves from up to an hour to minutes; about 16k D1 rows per 6 hours of `worker_logs` and two cross-table triggers leave `qnfo-audit`.
- **Failure mode.** Beta products with unannounced prices; grouping differs from the `fm-*` detectors, so keep a fail-open fallback until measured agreement.

### B13. The joules-per-solution observatory (reach, research; program RSCH)
- **Vision.** An open leaderboard, API and calculator where any lab submits a measurement under the JPCUB protocol; a monthly "state of compute energy" report.
- **Build.** W2: public JPCUB calculator on `qwav.org` returning a graded estimate for a platform [PROD-34]; protocol compliance checks by the fleet; the leaderboard and API.
  W3: monthly report. Builds on the charter's JPCUB energy-honesty standard (value-add for funders and clients).
- **Measure.** Third-party submissions and outside citations of the report, first read at 90 days.
- **Failure mode.** Wrong numbers: every result is labelled an estimate with its method; submissions need a compliance gate or the board is noise.

### B14. Fleet Live: a public daily account of the autonomous organisation (reach; program REACH)
- **Vision.** `fleet.qnfo.org` becomes readable by a stranger: five plain numbers and one sentence server-rendered, a daily account of cost per engaged reader, failures and fixes.
  The audience is builders and employers; the case study feeds the work-with-me and paid-assessment line in STRATEGY-1.
- **Build.** W0: server-render the five numbers and add social tags (section 4). W1: a daily generated note from the fleet's own ledgers (PLUSSING digest as source), with
  failures included. W2: referrals from builders measured through the same ledger as B4.
- **Failure mode.** Exposing operations detail or secrets (the page serves `OPEN-ACCESS-1` reads only; the command line stays behind the e-mailed code); a public failure ledger
  invites scrutiny, which the charter already accepts.

### B15. Defensive-publication commons (reach, research; program RSCH)
- **Vision.** An inventor submits an idea in `ipatent.qnfo.org`, the app drafts a disclosure, and with explicit consent it is published to an open register with a DOI.
- **Build.** W1: guides targeting "provisional patent disclosure template" with shareable worked examples [PROD-29]; a link from the research flow into the app. W2: the consented register.
- **Failure mode.** Legal exposure: the draft stays labelled not legal advice; consent is explicit and recorded; nothing is published without it.

### B16. One human-reviewed weekly digest, as text and audio (reach; program REACH)
- **Vision.** One digest a week: a demo, a claim and the check a reader can run, as e-mail and a podcast feed with a disclosed synthetic voice.
- **Build.** W1: the "claim, check, limits" digest replaces the roll-up [PROD-17]; W2: "paper in five minutes" audio episodes with an RSS feed [PROD-22]; recommendations or swaps with three to five
  aligned technical newsletters [PROD-18]. Excludes q08 (personal/research separation).
- **Measure.** Prediction (est.): confirmed subscribers and completion rate; the review gate of 2026-12-31 asks for 50 confirmed subscribers (baseline 1).
- **Failure mode.** Weak peers make swaps worthless; synthetic voice quality; the owner's review time is the bottleneck by design (one digest, not many).

## 4. Property roadmaps and verified defects

Each defect below marked **R** was reproduced by this session on 2026-11-04; the others are scout reports (**F**). Wave 0 defects are filed with a doer (section 9).

| Property | What a visitor sees now | Next 30 days (Wave 0 and 1) | Blue sky |
|---|---|---|---|
| qnfo.org | 0.3 s, 20 KB, structured data, a feed, an agent catalog, markdown on `Accept: text/markdown` (F). The headline is jargon and signup is a link, not a box (F) | One proof-led front door: what you get, one demo to try, an inline signup [PROD-17]; five human-edited "Start here" pages for flagships [PROD-14] | B5, B7, B16 |
| papers.qnfo.org | 728 papers via the API (R). One sampled page: 110 KB, 1.8 s to first byte, no `citation_doi`, dates 2025-12-01 on the page against 2026-07-04 in the `.md`, author "QNFO Research" in the `.md` against a named author on the page and in the API, an e-mail address in the `.md` (not reproduced here), a self-assigned `quality_label` of "High-quality scholarly research" beside "Not independently peer-reviewed" (all R). The scout also reports a placeholder "a longer plain-language version is on its way", an empty "Papers" heading in `llms.txt` and `keywords: []` (F) | **PAPER-META-1** (filed): build page, `.md`, API and JSON-LD from one record, remove the e-mail, add `citation_doi` where a DOI exists, a visible Cite block; plain summary above the fold [PROD-03, 04, 05]; cache and paginate the list (137 KB, about 2 s, F) [PROD-06]; trim `llms.txt` to 50 curated links [PROD-07]; register OAI-PMH with BASE, CORE/OpenDOAR and OpenAIRE [PROD-15] | B5, B7, B11 |
| qwav.org (and deep.qwav.tech) | Clear thesis and ten demos; no structured data, feed, signup or `llms.txt`; `/llms.txt` answers 301 to the homepage (R); the sitemap lists one URL (R); 497 research pages live on a different host and license (F) | **QWAV-DISCOVERY-1** (filed): real `llms.txt`, `feed.xml`, full sitemap, true 404s [PROD-08, 09]; permalinks per demo [PROD-20] | B6, B13 |
| ask.qwav.org | Answers cite their papers, honest privacy line (F). Canonical and robots sitemap say `ask.qwav.tech` (R), so it is indexed under the wrong host; qnfo.org links to `.tech` (F) | **ASK-CANONICAL-1** (filed; extends DOMAIN-PLANE-1:ask.qwav.tech): canonical, robots, sitemap and links to `ask.qwav.org`; 301 from `.tech` after a probe proves the route [PROD-02]; NLWeb, permalinks [PROD-11, 27] | B5 |
| q08.org | About 20 dated pieces, feed, forecasts, "Every fact is checked"; no byline, no outbound links on the home page, no `llms.txt`, no privacy link (F). It reads as a public tech-news explainer, while DOMAINS.md calls the plane personal (F, policy mismatch) | Bylines, machine-written disclosure, source links, privacy footer [PROD-31]; reconcile the plane label and the "QNFO family" navigation with the separation rule [PROD-32]; a public calibration scoreboard (Brier score, resolution date) [PROD-30] | B4 forecast tournament |
| ideas.qnfo.org | The page promises that operational conversations never appear and lists a raw "TASK WRITER ... three independent research writers" prompt as a public thread; the scout counted 18 of 20 listed threads defective, including "Re-entry from [redacted]" fragments and a literal `&lt;p&gt;` (the prompt, "redacted" and `&lt;p&gt;` strings reproduced, R; the 18 of 20 count is F). No submit form (F) | **IDEAS-PUBLIC-GATE-1** (filed): the existing `pubQuestion` denylist lets these through; switch the public list to an allowlist and fix the producers [PROD-01]; "Ask or propose" form with a status timeline behind Turnstile [PROD-28] | B5, B7 |
| fleet.qnfo.org | Server HTML is "Loading..." and no social tags (R); the command line needs an e-mailed code | **FLEET-PUBLIC-SSR-1** (filed): server-render five plain numbers and one sentence, add og tags and canonical [PROD-33] | B14 |
| ipatent.qnfo.org | The clearest value statement of the set: free, no account, not legal advice (F) | Guides, worked examples, a link from the research flow [PROD-29] | B15 |
| Newsletter | 18 sends, 0 clicks (docs); qwav has no form (F) | Inline signup, weekly digest, recommendations [PROD-17, 18] | B16 |
| YouTube Shorts | 2 subscribers, 6 to 40 views a short (memory note, docs) | Cut Shorts from demos, each ending on a 3 to 5 minute explainer [PROD-21]; a typed yes/no media gate before upload [CF-A-30] | B6 |
| Social, fediverse | Bluesky: 22 sessions, 1 engaged (READER-YIELD, R) | A followable bridged fediverse handle and fewer posts [PROD-23]; owner-written weekly posts for Hacker News and LessWrong, never automated, since both reject AI-written submissions (S) [PROD-24] | B16 |
| Identity and indexes | 724 of 739 OpenAlex works come from Zenodo; Semantic Scholar shows 1 paper against OpenAlex's 741 works (F); a user reports mass removal of AI-generated Zenodo records on 2026-06-19 (F, a user claim in a GitHub issue, Zenodo's policy page not read) | Mirror text and metadata to a second archive with an own-domain canonical, no mass minting [PROD-12]; claim the Semantic Scholar author page and sync ORCID (owner-bound, section 7) [PROD-16] | B7, B11 |
| me.q08.org, jobs, reading, travel | Not audited (sign-in) | B10 items; keep the owed iCal links on the owner-card list | B10 |

Four flywheels the scout proposes, adopted as design checks for B5 to B7: (1) demo, paper, newsletter; (2) Ask question, question graph, paper (unanswered questions stored without addresses feed the Ideas
queue); (3) public errata, credibility, backlinks, more challenges; (4) corpus dataset, developers, citations.

## 5. Platform calendar and corrections (read with docs/CLOUDFLARE-CAPABILITY-INTEGRATION.md; CF-CHANGELOG-LOOP-1 should already surface these)

| Date | Change | Source | Fleet consequence |
|---|---|---|---|
| 2026-10-22 | The scout lists an MCP `/sse` endpoint returning 410. This session could not find it in the changelog and found no `/sse` route in qnfo-tools-mcp or qnfo-memory-mcp (only a streamed response type) | F (scout), R (code) | Unconfirmed; no action beyond keeping the Streamable HTTP transport |
| 2026-11-04 | D1 caps query results at 50 MB | F | `code_tasks` (250 MB), `chatbox_conversations` (174 MB) and any unbounded SELECT on a fat column can fail: **D1-RESULT-CAP-1** (filed) |
| 2026-11-17 | New module registry default and `request.signal` disconnect events for compatibility date 2026-11-17 or later | R (changelog fetched this session) | Only a worker that bumps its date is affected; do not bump in the same PR as a feature |
| 2026-12-01 | AI Search usage billing begins (postponed one month from 2026-11-01); default sync 24 h; pricing unchanged | R (full post read) | Corrected in docs/AI-SEARCH-INSTANCES.md; `qnfo-corpus` sets its own interval |
| 2026-12-01 | Unified observability pricing: 50 GB ingest included, then USD 0.25 per GB | F | BP26-OBSERVABILITY-1 covers it; B12 adds the sampling audit |
| 2026-12-02 | EU AI Act Article 50 and C2PA marking deadlines | BP26 doc | BP26-PROVENANCE-MARKING-1 and BP26-AI-ACT-ART50-1 |
| Standing | D1 read replication is `auto` but the Sessions API works through bindings only; REST and GitHub-runner reads always hit the primary | F | CF-B-13 |
| Standing | Durable Objects defer code updates up to 5 minutes | F | The canary window is 8 minutes (`--canary-min 8`, R), so a DO-served `/health` is covered; no change |
| Standing | Smart Placement affects fetch handlers only, not cron or RPC | F | Not a lever for the loops; dropped |
| Standing | D1 undelete works within 7 days of deletion; Artifacts billing from 2026-10-15; Workflows billed per step from 2026-08-10 | F | Backups stay the recovery path; B7 and B3 prices to be read before adoption |
| Closed | GLM-5.3 cross-request KV-cache exposure, 2026-08-27 to 2026-09-09, prompts over 681,280 tokens only | F | The code loop's glm-5.3 prompts average about 11k tokens; looks unaffected, unverified per call |

## 6. Waves and gates

Gates are measured, not dated (charter section 7). A gate that is not met leaves the wave closed; Wave 0 needs none.

| Wave | Gate | Contents |
|---|---|---|
| W0 (now, small, reversible) | none | The six filed defects (section 9); AGT-07, AGT-04, CF-A-04 and CF-A-01 measurement steps; MEAS-01 noise floor; CF-A-09 crawler-block probe; CF-B-13, CF-B-14 (already in COST-D1-DRILL-1); corrections in section 5 |
| W1 | `QNFO.OPS` verdict at most AMBER, or `open_agent_issues` critical count under 100; at most three W1 items in flight at once | B1 aliases, Clef benchmark, router replay; B2 first lake stream and coalescer; B3 previews; B4 seeded errors and ledgers; B5 NLWeb, redirects; B6 verification; B7 existence gate; B9 portal and Access; B12 Issues; B16 digest |
| W2 | W1 items verified live, cost forecast at or under budget for 14 consecutive days | B1 GEPA and distillation; B2 Durable Object plane; B3 replay twin, TLA+, tamper audit; B7 claim graph; B8; B11 dataset; B13 |
| W3 (moonshots) | Externally sourced engaged readers at or above 12 a day for 14 days and cost within budget | B10 account split; B11 monetisation; B6 runnable papers at scale; B14 and B15 growth |

The charter's review gate of 2026-12-31 stays binding: a bet that does not serve credibility events, confirmed subscribers or spend inside the cap is parked.

## 7. Wish list

**Of Cloudflare** (none verified as planned): a self-serve fine-tune-and-serve path for fleet labels (today the RL fine-tune of Clef is staff-assisted); a published Workers AI batch discount
(the async API exists, no discount is stated); per-Worker billing split; replica Sessions over REST; Workers-level path scoping for Access; a stated price for Flagship, KV Instant and Agent Memory.

**Owner-only** (IDENTITY-BOUND cards with closing probes; the fleet does everything else): activate the GA4 internal-traffic filter (`ga4-internal-traffic-1`); claim the Semantic Scholar author page and
sync ORCID; one arXiv endorsement (charter list); a Metaculus account for the forecast tournament; weekly 150-word Hacker News or LessWrong posts in the owner's own voice; about 25 one-tap quality labels a month;
funding of a capped Cloudflare Wallet and any pay-per-crawl policy (money, a legal act); the registrar delegation for `qwave.tech` and `q-wave.tech` (DOMAINS.md).

**Crazy, plausible** (each needs a measured case before it is a bet):
1. Runnable papers: a click runs the paper's own code in a Dynamic Worker with no outbound network (charge quoted at USD 0.002 per unique Worker per day, waived in beta, F).
2. A warm-standby fleet on one VPS running self-hosted workerd, the second provider for the continuity doctrine (the Deno team joined Cloudflare to make that first-class, F; timeline unverified).
3. A capped agent wallet that buys full-text articles per request over x402 (the post says paying is "soon", F; funding is IDENTITY-BOUND).
4. Every paper a Git repository in Artifacts: revisions are commits, Zenodo versions are tags, readers can fork, a push rebuilds the PDF.
5. A QNFO-specific decision model fine-tuned on owner verdicts and reader votes, used as the deterministic gate a judge cannot override.
6. A pinned, grade-only frontier model that never writes.
7. Synthetic reader personas validated against GA4 for offline A/B tests of page changes.
8. A fleet constitution compiled to TLA+ and Lean, proving no loop can both modify and grade itself.
9. A live post-quantum handshake share per host on `qwav.org`, shown to readers (low value, high fit).
10. Pay-per-crawl for bulk AI crawlers, with open access preserved for people (conflicts with OPEN-ACCESS-1; owner policy first).

## 8. Adversarial notes

- **The strongest argument against this document:** the portfolio is RED with 510 open issues and 862 roadmap rows, and a plan this size can add load faster than it removes any. The answer is structural: sixteen
  rows, one wave open at a time, a gate on W1, and rule 6 (each bet retires a row of its class). If W1 has not opened by 2026-12-31, cut to B1, B2 and B4 and park the rest.
- **The readers may not respond to anything platform-shaped.** The Cloudflare scout found no verified platform lever that moves engaged readers; the reader bets are blocker removal and measurement. If B5's two windows
  stay flat, the honest conclusion is that distribution (people, not protocols) is the lever, and the owner-voice items in section 7 are then the plan.
- **Evidence is thin where it is boldest.** About half the ideas rest on search excerpts or a beta feature with no announced price (Flagship, KV Instant, Agent Memory, Artifacts, Monetization Gateway). Every adopting PR
  re-reads the primary source and states the price it assumed.
- **Goodhart at every layer.** New metrics (noise floor, seeded recall, holdout) can be gamed by the loops they judge; hence sealed evaluators (AGT-13), pristine controls and the rule that a proxy never counts toward a verdict.
- **Distilled and cascaded models drift.** B1's gains decay unless the sealed eval re-runs on a schedule; the first W1 step is the schedule, not the swap.
- **A false sense of coverage.** Four scouts sampled single page loads from one location, and the property audit rendered no pages and measured no Core Web Vitals. Section 4 labels what was reproduced (R) and what was reported (F).
- **Things this plan deliberately does not do:** add workers, raise a cap, weaken a probe or a gate, rank by raw clicks, publish more papers to raise a count, or automate posts on channels that forbid it.

## 9. What was filed (this PR, by `migrations/2026-11-05-bluesky-roadmap.sql`)

- Sixteen `roadmap_implementation` rows, source `bluesky-2026-11`, status `planned`: `RM-BS-QUNIVERSE-SMALL-1`, `RM-BS-DATA-SPINE-1`, `RM-BS-FLEET-TWIN-1`, `RM-BS-HONEST-MEASURE-1`, `RM-BS-PAPERS-AS-AGENTS-1`,
  `RM-BS-QUANTUM-COMMONS-1`, `RM-BS-SELF-AUDITING-JOURNAL-1`, `RM-BS-HYPERAGENT-MANAGERS-1`, `RM-BS-CAPABILITY-SECURITY-1`, `RM-BS-PERSONAL-PLANE-1`, `RM-BS-OPEN-DATA-COMMONS-1`, `RM-BS-SELF-REPORTING-PLATFORM-1`,
  `RM-BS-JPCUB-OBSERVATORY-1`, `RM-BS-FLEET-LIVE-1`, `RM-BS-DEFENSIVE-PUBLICATION-1`, `RM-BS-WEEKLY-SIGNAL-1`.
- Six Wave 0 `agent_issues` rows, each with a `code-task:`, a verified `code-anchor:`, a closing probe and a charter pillar: IDEAS-PUBLIC-GATE-1 (idea-hub), ASK-CANONICAL-1 (qnfo-ai-search), QWAV-DISCOVERY-1 (qnfo-gateway),
  PAPER-META-1 (qnfo-gateway), FLEET-PUBLIC-SSR-1 (qnfo-fleet-dashboard), D1-RESULT-CAP-1 (qnfo-ops).
- The AI Search billing date corrected in docs/AI-SEARCH-INSTANCES.md.
- Not filed, and why: ideas resting on search excerpts or unpriced betas; items already owned (D1-SPLIT-1a to 1c, COST-D1-DRILL-1, BP26-OBSERVABILITY-1, RM-QWAV-CROSS-SIMULATOR-1, RM-CITE-EXISTENCE-GATE-1, RM-PAPER-PROVENANCE-TRACE-1, RM-MEMORY-TIERING-1, RM-CODEMODE-MCP-SURFACE-1).
- B4 W0 started in this PR: the first noise-floor reading of the reader series is in B4 (R). Next originated item: extend it to the other north-star and outcome measures
  (cost per day, external visits per paper, `v_output_quality_headline`), and size the keep-or-revert window of every count-valued plus outcome from its minimum detectable
  effect; that is the first row of `RM-BS-HONEST-MEASURE-1` to take a doer.

## Appendix A. Scout index

Ids are the scouts' own. Evidence: F fetched, S excerpt, D docs. Effort: S, M, L. Full rationale and risks are in the bet that cites the id.

### A.1 Cloudflare compute and AI (scout A)
| Id | Idea | Eff | Ev |
|---|---|---|---|
| CF-A-01 | Gateway-first spend governance, per-worker metadata, spend limits as a runaway fuse | M | F |
| CF-A-02 | Model aliases with ordered fallback pools, reordered by qnfo-model-eval | M | F |
| CF-A-03 | Clef, Clef-flash, Clairic for classification-shaped calls | M | F |
| CF-A-04 | Prefix-cache key A/B (per rubric against per paper); read cached tokens from usage | S | F |
| CF-A-05 | `rejectIfBusy` plus Batch API for latency-tolerant stages | M | F |
| CF-A-06 | Workers Issues into `agent_issues` | M | F |
| CF-A-07 | Kill switches and caps to Flagship and KV Instant | L | F |
| CF-A-08 | research-exec stages as Workflow steps | L | F |
| CF-A-09 | Daily probe: no AI-crawler block on the three zones | S | F |
| CF-A-10 | AI-answer-engine reader loop (crawler and referral GraphQL, readiness score) | M | F |
| CF-A-11 | D1 50 MB result cap audit and a byte guard | S | F |
| CF-A-12 | Browser Run `/crawl` and `/markdown` for full-text fetch and citation checks | M | F |
| CF-A-13 | Edge UX-journey runner and WebMCP agent journeys | M | F |
| CF-A-14 | Promote through Worker Previews, probes on the preview | L | F |
| CF-A-15 | Code-loop attempts in Artifacts, verified in Dynamic Workers | L | F |
| CF-A-16 | Billable Usage API into the cost ledger | S | F |
| CF-A-17 | Apply AI Search facts (rates, 2026-12-01) to RM-AISEARCH-GA-MIGRATE-1 | S | F |
| CF-A-18 | Canary against DO code-update deferral | S | F |
| CF-A-19 | Agent Memory as the qnfo-memory-mcp backend (private beta) | M | S |
| CF-A-20 | One grounded-search tool through the gateway | S | F |
| CF-A-21 | Containers right-sizing and snapshots | M | F |
| CF-A-22 | Outbound Worker credential injection | S | F |
| CF-A-23 | Dec-1 observability ingest audit | S | F |
| CF-A-24 | Email Sending events into suppression and a deliverability metric | S | F |
| CF-A-25 | Agent Skills from R2 | S | F |
| CF-A-26 | Redirects for AI-training crawlers to the canonical paper | S | F |
| CF-A-27 | Custom alerts with webhooks to a qnfo-ops intake | S | F |
| CF-A-28 | Weekly CPU and memory profile of the heaviest workers | S | F |
| CF-A-29 | Agent tracing for qnfo-agents | S | F |
| CF-A-30 | Typed yes/no media gate for Shorts | S | F |
| CF-A-31 | Replay CF-CHANGELOG-LOOP-1 on the dated posts | S | F |

### A.2 Cloudflare data, security, edge (scout B)
| Id | Idea | Eff | Ev |
|---|---|---|---|
| CF-B-01 | Telemetry lake: Pipelines to Iceberg, SQL over it | M | F |
| CF-B-02 | Queue write-coalescer, trigger logic into the consumer | M | F |
| CF-B-03 | Coordination plane on Durable Object SQLite | L | F |
| CF-B-04 | Retire home-grown log capture for Logs, Traces and Issues | M | F |
| CF-B-05 | First-party reader ledger from Logpush | M | F |
| CF-B-06 | Percentage canary and seconds-level rollback via Worker versions | M | F |
| CF-B-07 | Governed MCP front door (portals) | M | F |
| CF-B-08 | Access for Workers with service tokens | M | F |
| CF-B-09 | Cloudflare Email Service for newsletter and intake (public beta) | M | S |
| CF-B-10 | Metric and trigger plane on Postgres through Hyperdrive | L | F |
| CF-B-11 | Personal plane in a separate Cloudflare account | L | F |
| CF-B-12 | Attribute heavy statements from D1 trace spans | S | F |
| CF-B-13 | Read-only probes through a replica session | S | F |
| CF-B-14 | `ops_config` as a KV snapshot | S | F |
| CF-B-15 | 50 MB result-cap guard | S | F |
| CF-B-16 | Dec-1 observability audit | S | F |
| CF-B-17 | Workers Cache in front of D1-backed pages | S | F |
| CF-B-18 | Analytics Engine for heartbeats and rates | S | F |
| CF-B-19 | Billable Usage API as the cost ledger | S | F |
| CF-B-20 | Agent-readiness bundle (markdown, Content Signals, AEO) | S | F |
| CF-B-21 | Secrets Store for shared secrets (status unverified) | S | F |
| CF-B-22 | Custom SQL alerts with webhooks | S | F |
| CF-B-23 | R2 data-access logs on private buckets | S | F |
| CF-B-24 | workers.dev and preview URLs off for non-public workers | S | R |
| CF-B-25 | Each paper a Git repository in Artifacts | wish | F |
| CF-B-26 | Open Iceberg corpus and DuckDB-WASM | wish | F |
| CF-B-27 | Charge bulk AI crawlers (Monetization Gateway) | wish | F |
| CF-B-28 | Demos in Dynamic Workers with Durable Object facets | wish | S |
| CF-B-29 | K2 flight recorder of state changes and LLM calls | wish | F |
| CF-B-30 | KV Instant for kill switches only | wish | F |
| CF-B-31 | Live post-quantum handshake share per host | wish | S |

### A.3 Agents, research, measurement (scout D)
| Id | Idea | Eff | Ev |
|---|---|---|---|
| AGT-01 | GEPA prompt search on the cheap tier | M | F |
| AGT-02 | Step-level learned router trained on `ops_ai_log` | M | F |
| AGT-03 | In-context distillation with escalation | M | F |
| AGT-04 | Reasoning effort per stage | S | D |
| AGT-05 | Two-stage selective judging | M | F |
| AGT-06 | Terse micro-classifiers on fleet labels | M | F |
| AGT-07 | In-stream degeneration abort and `max_tokens` caps | S | S |
| AGT-08 | Mask old observations, dynamic content last | S | S |
| AGT-09 | Cache at semantic checkpoints | M | F |
| AGT-10 | Embedding-distance novelty gate before drafting | S | S |
| AGT-11 | Hyperagent loop for managers and the code loop | L | F |
| AGT-12 | Evolve prompts, thresholds, routing against a scorer | M | F |
| AGT-13 | Harness-tamper audit | M | S |
| AGT-14 | TLA+ specs for lane, claim, lock, tick order | M | F |
| AGT-15 | Agentic property-based tests | S | F |
| AGT-16 | Replay twin | L | F |
| AGT-17 | Per-loop session-cost alarm | S | F |
| AGT-18 | Attenuating task tokens and a trust ratchet | L | S |
| AGT-19 | Closed critical issues become regression evals (pass^k) | S | F |
| MEAS-01 | A/A noise floor and minimum detectable effect | S | F |
| MEAS-02 | Human anchors re-scored by the current judge | M | F |
| MEAS-03 | Seeded known errors, monthly reviewer recall | M | F |
| MEAS-04 | 25 owner labels a month with prediction-powered inference | M | F |
| MEAS-05 | External forecasting-bot tournament for q08 | S | S |
| MEAS-06 | Weekly answer-engine citation share on a fixed prompt panel | M | F |
| MEAS-07 | 5 percent holdout on frozen "fleet v0" | M | S |
| SCI-01 | Typed claim graph, alignment, contradiction check, claim survival | L | S |
| SCI-02 | Lean 4 lane for theorem claims | L | S |
| SCI-03 | Reproduction capsule and "ask the paper" endpoint | L | S |
| SCI-04 | Signed provenance per revision, AI-disclosure block | M | F |
| SCI-05 | Anonymised replayable incident benchmark | M | S |
| PER-01 | Idle-time proactive precompute, ask first | M | F |
| PER-02 | Keyed memory plus weekly injection canary | M | F |
| PER-03 | On-device model for raw private text | L | S |
| QNT-01 | Headless read of demo values against the Python golden check | S | F |
| QNT-02 | Living advantage-claim watch | M | F |
| QNT-03 | Stim plus a second simulator where a demo claims error correction | M | F |

### A.4 Properties and audience (scout C)
| Id | Property | Idea | Eff |
|---|---|---|---|
| PROD-01 | ideas | Allowlist public threads | S |
| PROD-02 | ask, qnfo | Canonical, robots, sitemap and links to `ask.qwav.org`, 301 from `.tech` | S |
| PROD-03 | papers | Real plain summary and claim, check, limits above the fold | S |
| PROD-04 | papers | One record for page, `.md`, API, JSON-LD; remove the e-mail | S |
| PROD-05 | papers | `citation_doi`, visible Cite block, DOI `sameAs` | S |
| PROD-06 | papers | Cache and paginate the list; edge-cache pages | S/M |
| PROD-07 | papers | Curate `llms.txt` to 50 links | S |
| PROD-08 | qwav, q08 | Markdown for Agents, real `llms.txt`, `feed.xml`, sitemap | S |
| PROD-09 | qwav | Real 404s | S |
| PROD-10 | qwav | Consolidate `deep.qwav.tech` under `qwav.org` with 301s | M |
| PROD-11 | ask | NLWeb `/ask` and `/mcp` through AI Search | M |
| PROD-12 | all | Second-archive mirror, own-domain canonical | M |
| PROD-13 | papers | Per-paper human-review record, errata status | M |
| PROD-14 | qnfo | Five human-edited "Start here" pages | M |
| PROD-15 | papers | Register OAI-PMH with BASE, CORE/OpenDOAR, OpenAIRE | S |
| PROD-16 | all | Claim Semantic Scholar author page, sync ORCID | S |
| PROD-17 | qnfo, qwav | Inline signup, weekly "claim, check, limits" digest | M |
| PROD-18 | newsletter | Recommendations and swaps | S |
| PROD-19 | papers | `research-code` repo and in-browser notebook per flagship | M |
| PROD-20 | qwav | Permalink, state image, embed snippet, walkthrough per demo | M |
| PROD-21 | YouTube | Shorts cut from demos ending on a 3 to 5 minute explainer | M |
| PROD-22 | audio | "Paper in 5 minutes" episodes with a podcast feed | M |
| PROD-23 | Bluesky, fediverse | Bridged handle, fewer posts | S |
| PROD-24 | outreach | Owner-written weekly posts for HN and LessWrong | S |
| PROD-25 | papers | Hugging Face dataset with DOI, card, `ai_generated` field | M |
| PROD-26 | papers | Errata and reproduction logs as a feed | M |
| PROD-27 | ask | Shareable answer permalinks, citation-card image, widget | M |
| PROD-28 | ideas | "Ask or propose" form with status timeline | M |
| PROD-29 | ipatent | Guides and worked examples | S |
| PROD-30 | q08 | Public calibration scoreboard | M |
| PROD-31 | q08 | Bylines, disclosure, source links, privacy footer | S |
| PROD-32 | all | Reconcile q08's plane label with its content | S |
| PROD-33 | fleet | Server-render five numbers and a sentence, social tags | S |
| PROD-34 | qwav | Public JPCUB calculator | M |
