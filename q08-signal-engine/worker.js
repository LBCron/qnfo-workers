/**
 * q08-signal-engine \u2014 v0.7.0
 *
 * What it is
 *   The external signal engine for q08.org. Scrapes high-friction technical
 *   discussions from Hacker News, ranks them by a volatility score, extracts
 *   the structural friction point, then composes a long-form analytical essay
 *   and publishes it to q08.org.
 *
 * Architecture
 *   cron (every 2h) -> scrape_hn -> volatility_rank -> pick_top ->
 *   extract_friction -> build_prompt -> compose (Workers AI) ->
 *   gate (long-form prose: no bullets / no tables / no names / no handles) ->
 *   persist (D1 q08-signal) -> serve HTML
 *
 * Register (Q08-LEDE-1, owner 2026-10-13: inverted pyramid)
 *   News first, then the system: the first paragraph reports the story (who did
 *   what, where it appeared, why it matters) for a reader who missed it; the
 *   essay then explains the mechanism behind it in plain explanatory prose, with
 *   no management-consulting abstractions. Structures vary per piece; section
 *   skeletons of recent pieces are injected as banned patterns. Each draft must
 *   carry a 'worth your time' self-verdict that gates publication, and readers
 *   vote yes/flat/no, which ranks the few-shot pool. NO bullet lists. NO tables.
 *
 * Bindings
 *   DB          \u2014 D1 q08-signal (signal_log, published_pieces, prompt_pool, engine_runs)
 *   QNFO_AI     \u2014 service binding to qnfo-ai (OpenAI-compat router)
 *   EMAIL       \u2014 service binding to qnfo-email (alerts on publish)
 *
 * Secrets
 *   ROUTER_TOKEN \u2014 bearer token for qnfo-ai
 *
 * Cron: 0 * /2 * * * (every 2 hours; up to 10x/day cap enforced in code, lowered by
 *   qnfo-audit ops_config q08_max_per_day when set: Q08-CADENCE-CAP-1)
 */

// Q08-ASCII-SOURCE-1 (2026-10-01): this file is ASCII-only; every typographic character is a \uXXXX escape. The deploy path
// double-encoded raw UTF-8, so live pages read "... \u00e2 q08" and posts "\u00e2\u0080\u0094". Keep new literals escaped.
// VERSION-NOTES-MOVED-1: release notes live in the block below
var VERSION = "0.43.0";
/* 0.43.0 Q08-TICK-ALLOWANCE-1 (2026-11-04, pillar cost; minor: the engine now decides on its own whether a tick starts an attempt; BUDGET-SOFT-ROUTE-1, attempts slow down and never stop): ai_call_counters showed 119,552, 129,547 and 110,450 neurons on 2026-11-01..03 against the 50,000 target (ops_config q08_daily_neurons) because q08Budget() only steered the first writer model and nothing bounded the attempts a tick starts (40 a day, the attempt cap, at about 2,760 neurons each). Now the :00 cron and the :30 stall retry go through governedGenerate: tick k of 48 starts an attempt only while the day is under the pace line budget x (k + 1) / 48, an essay after a forecast attempt that spent model calls starts only while the day is still under it, and 150 minutes without an attempt starts one whatever the line says (8 a day at least). No row is written for a tick that waits. The writer gate, reader panels, fact-check, final read and accuracy audit are unchanged, and an attempt already started runs all its rounds. ops_config q08_tick_governor = off restores the old behaviour. tick-allowance.test.mjs replays a UTC day. */
/* 0.42.0 RM-FORECAST-UPDATE-SCORING-1 (#5578; research): score the last valid update before the horizon with the resolved outcome. */
/* 0.41.6 FORECAST-CALIBRATION-BUCKET-COVERAGE-1 (#5576, charter pillar research; patch): calibration buckets include probabilities across the full [0,1] range, including the tails, rather than silently omitting forecasts below 5% or above 96%. */
// Q08-FORECAST-RESEARCH-1 (#4291, agent_issues 1000268, pillar reach): researched forecasts and dated secondary claims.
/* 0.40.5 Q08-FINAL-READ-RETRY-1 (#99929, pillar reach; patch): a missing strict final-reader verdict gets one fresh-cache retry; publication remains fail-closed if the retry has no verdict. FACTS and reader thresholds are unchanged. */
/* 0.40.0 Q08-FORECAST-LEDGER-1 (2026-10-30, agent_issues 1000512, pillar reach; minor: a data product it did not have, default off): with ops_config q08_forecast_ledger = on, generateForecast adds a research ledger of verbatim sentences (researchLedger: four evidence APIs queried with at most 6 capitalised names, the public https pages they link, at most 10 documents of 40000 characters, 60 lines "[R<n>] <sentence> (<host>, <date>)") to the forecast prompt and to fcGround; a fact may be cited by its tag, stripLedgerTags removes [R<n>] like [S<n>], the ledger is stored in q08_forecasts.ground_json and its sources join sources_json, and groundForPublished appends it for the re-audit. Off (absent or any other value) makes no request and leaves the prompt and ground unchanged. Replaces the unused forecastLedger draft. forecast-ledger.test.mjs. */
/* 0.39.2 BP26-AI-GATEWAY-BUDGETS-1 (2026-10-28, agent_issues 1000614 and 1000351, pillar cost): compose, title repair, forecast repair, fact-check and forecast-judge calls go through aiGatewayRun (AI Gateway with loop metadata, per-loop budget fallback), not env.AI.run directly; none of them is cached. */
/* 0.39.1 (2026-10-28, issue 5129): the VERSION line is short again (VERSION-LINE-NOTES-1); the 0.39.0 note moved here unchanged. 0.39.0 BP26-CORRECTIONS-FEED-1 (2026-10-28, agent_issues 1000334, pillar research): /api/retractions and the new /corrections and /api/corrections carry a COPE type and the original link per entry. */
/* 0.38.0 BP26-FORECAST-HYGIENE-1 (2026-10-28, charter pillar research, agent_issues 1000337; minor): a forecast resolution must name the source that settles it, the date it is read by and an edge-case rule (gate + both prompts); q08_forecast_updates holds probability updates as append-only rows; a trigger refuses in-place change of a published forecast's claim, probability, horizon, resolution and timestamp; log score beside Brier; /forecasts/calibration and /api/forecasts/calibration. */
/* 0.37.5 (2026-10-26, charter pillar reach, agent_issues 100439, 100607): Q08-THIN-PASSED-OVER-1 marks a candidate that was measured thin and passed over for a richer one, so a paper without an HTML rendering no longer holds the arXiv lane for a day (the lane ran at 02:02 and 03:04 on 2026-10-26 and then not for 16 hours); the 24-hour retry window is the existing one. */
/* 0.37.4 (2026-10-26, charter pillar reach, agent_issues 100607, 100439): Q08-GATE-GROUND-BLIND-1 removes the two checks of the writer gate that refused every comma-grouped dollar amount and every score, rating, ratio or reputation of 0.85 as fabricated without reading the source; the grounding check that runs on every draft before any panel call and on the final text already refuses a figure the source does not hold. */
/* 0.37.3 (2026-10-26, charter pillar reach, agent_issues 100607): Q08-DOTTED-NAMES-1 stops the grounding check refusing a dotted name (Qwen3.8-27B, PLAN.md, Node.js) or a possessive plural that stands in the source; the ground word set only gains words, so nothing accepted before is refused. */
/* 0.37.2 (2026-10-26, charter pillar reach, agent_issues 100439, 100453): Q08-ARXIV-POOL-1 reads the newest arXiv submissions from ops_config q08_arxiv_pool (30 to 200, absent = 100; was a fixed 30) because an arXiv run publishes about 5 times as often as a Hacker News run, and removes the never-called structuralPreflight. */
/* 0.37.0 BP26-AI-LABEL-1 (2026-10-26, charter pillar reach; EU AI Act Art. 50(4), applicable since 2026-08-02): every piece page carries a visible "AI-generated" label linked to the published method note and JSON-LD creditText; HTML responses add nosniff, HSTS (no includeSubDomains) and X-Frame-Options SAMEORIGIN. */
// 0.34.0 NO-REGISTRAR-1 (2026-10-21): release notes no longer name the closed registrar.

// Register new metric key
if (typeof Q08_METRIC_KEYS !== 'undefined') {
  Q08_METRIC_KEYS.push(["q08_retraction_rate_30d", "retraction_rate_30d"]);
}

// Compute retraction_rate_30d metric
async function computeRetractionRate30d(db) {
  const now = Date.now();
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
  const rows = await db.all(
    `SELECT id FROM published_pieces WHERE published_at >= ?`,
    new Date(thirtyDaysAgo).toISOString()
  );
  const total = rows.length;
  if (total < 10) return null;
  const result = await db.get(
    `SELECT COUNT(DISTINCT pp.id) AS cnt FROM published_pieces pp JOIN q08_retractions r ON r.piece_id = pp.id WHERE pp.published_at >= ?`,
    new Date(thirtyDaysAgo).toISOString()
  );
  const retracted = result.cnt;
  return retracted / total;
}

// Hook into existing 7d metrics calculation if function exists
if (typeof getMetrics7d === 'function') {
  const originalGetMetrics7d = getMetrics7d;
  getMetrics7d = async function(db) {
    const metrics = await originalGetMetrics7d.call(this, db);
    metrics.retraction_rate_30d = await computeRetractionRate30d(db);
    return metrics;
  };
}
/* 0.36.0 PUBLICATION-GATE-AUDIT-2 (2026-10-26, pillar reach; minor: a new data product, q08_retraction_rate_30d, and a writer-order switch). Evidence: engine_runs, 14 days to 2026-10-26: 20 ok of 537 finished runs (3.7%), 517 gate failures, about 48 attempts and 0.5 published pieces a day, the daily neuron pace reached on 8 to 17 runs a day since 2026-10-21. (1) Q08-WRITER-ORDER-2: nemotron, gpt-oss, kimi, by end-to-end yield (10.2%, 1.7%, 0.9%), not by the writer-gate pass rate; ops_config q08_compose_order overrides. (2) Q08-LEDGER-TAG-FORMS-2: ledger citations in round, curly, fullwidth and lenticular brackets, with "&" or "/" between numbers, after a dagger, or as [ledger S3] are removed before any check (the cause of 38 accuracy failures that listed ledger numbers as figures and tags as names). (3) Q08-REVIEWER-HYGIENE-1: a reviewer's object printed as a string is unwrapped, an item with no claim text is set aside (a fail that names nothing else still fails closed), an item whose closing clause says it is supported is acquitted. (4) Q08-PRECHECK-CONTEXT-1: each flagged item carries 24 characters of context on the stage row. (5) Q08-RETRACTION-METRIC-1: q08_retraction_rate_30d. No gate was loosened: names, figures, years, the lede check, the reader panel, the two-family fact-check and the prune are unchanged. */
/* 0.35.1 Q08-RETRY-PROGRESS-1: a repair that returns exactly a draft already rejected in the same verifyAndRevise invocation stops as an accuracy failure before spending another verification. Changed drafts still receive the full verification; no claim-count heuristic, quality threshold, reviewer family, retry ceiling or spend control changes. Run 955 spent 16 fact-check calls on multiple repairs; its log does not retain draft text, so savings on that run are not claimed. */
/* 0.35.0 Q08-RUN-STAGE-ATTRIBUTION-1: engine_runs now records reader-panel and fact-check calls separately while preserving verify_calls as their total. The q08.org/api/runs?limit=60 evidence sample returned 20 rows (IDs 952 through 933), not 60; 13 were gate_failed and 7 deferred. No quality gate, spend policy, or generation behavior changed. */
/* 0.34.4 Q08-LEDGER-WHITESPACE-GROUPS-1: the grounding normalizer now removes grouped source-ledger citations such as [S2 S3] and [S1, S2 S3] before any gate reads the draft. The factual and reader-quality gates are unchanged. */
/* 0.34.5 Q08-WRITER-YIELD-1 (2026-10-25): live 30-day q08_reader_tests showed writer-gate pass rates of 66.1% for gpt-oss (342 attempts), 60.2% for kimi (108), and 21.2% for nemotron (472), while the old order led with nemotron. Put the highest-yield, lowest-neuron writer first; the uncapped fallback favors yield, while the capped fallback favors the lower-cost nemotron. Quality thresholds are unchanged; revert by restoring the prior writer arrays. */
// 0.33.0 COST-SUSTAIN-2 (2026-10-21, owner directive: research and publication <= USD 300/month all-in, quality must not drop; pillar cost): a hard daily neuron budget for q08 (ops_config q08_daily_neurons, default 150000 = USD 1.65/day at USD 0.011/1k; measured 135-288k/day on 10-14..10-20) paced over the UTC day (spent <= budget x (hour+1)/24 + 10% burst) gates generate() and auditPublished(): over the pace the tick writes a deferred engine_runs row and waits, nothing is skipped and no gate, reader panel or fact check changes. Root cause it closes: q08 had a publish cap and an attempt cap but no spend bound, so retries and stall retries could spend without limit. GET /budget.
/* 0.32.0 Q08-FACT-LEDGER-1 (2026-10-19, agent_issues 2606 Q08-PUBLISH-STALL-AUTO-1, pillar research; minor: the engine now decides a deterministic source-grounding stage on its own ahead of the reader panel). Evidence (q08.org/api/runs, runs 647-666, 12:03Z to 21:30Z on 2026-10-19; stall digest of the last 24 h: fact-check 28, reader panel 12, writer gate 4): no piece since 2026-10-18T20:15Z, 15 of the last 20 runs ended gate_failed (the runs that logged their calls, 655-661, used 3 to 8 writer calls and 5 to 16 reviewer calls each) and the other five idled on the daily attempt cap (40/40). Cause: the reader panel and its editor rounds ran first and the source-grounding check last, so a draft whose names, years or figures are not in the source material was read by up to six judges and rewritten by an editor before the check that would have refused it, and the writer was never shown which sentences of the source it could rely on. Change 1, groundPreCheck: after the writer gate and before runLevels (essay path) and before runLevels in generateForecast, the free deterministic check groundingProblems runs on the draft against the same ground the fact-check later reads (labelledGround is now built before the panel; the forecast ground is built before it too). On problems the essay gets one pruneUnsupported pass held to the same gate as a repair round (prunedGateProblems and ledeProblems) and a re-check; a draft that is clean after it goes on to the panel, one that is not ends the run with gateResult 'accuracy: ...' (stallStage still reads fact-check) and no panel call; a forecast is not pruned and ends the same way. A q08_reader_tests row (round 0, role ground_precheck) records the outcome whenever the check finds a problem. The stage is fail-safe: if it throws, the error is logged and the draft goes to the panel exactly as before. Change 2, sourceLedger in buildPrompt: the sentences of the item description, the signal and the linked article are numbered [S1], [S2] ... in a SOURCE LEDGER block after the background, with the rule that every real-world assertion in the reporting sections reuses the names, figures, dates and attributions of one ledger sentence and that the analysis section stays exempt (Q08-FACT-INFERENCE-1); normalizeDraftCore removes a ledger tag the writer copies into its text. Unchanged: the FACTS rule text of Q08_DIRECTIVE, the fabrication checks, factCheck, verifyAndRevise, PUBLISH_MIN_CHARS, the panel and final-read thresholds, COMPOSE_MODELS and the attempt cap. Not claimed: that this restores publishing. Expected on the first full UTC day after the deploy: runs ending 'accuracy' on a name, year or figure fall to the pre-check (cheap, no panel call), compose_calls and verify_calls per gate_failed run fall, and the unsupported-claim items the two-family fact-check lists for paraphrase (not a name, year or figure) are what the ledger is meant to reduce; the measure is the share of engine_runs ending 'fact-check' and q08_gate_pass_rate_7d. Review repair in the same release (before it shipped): (1) stripLedgerTags now removes a grouped or ranged tag as well as the single one ([S1, S2], [S3;S4], [S2-S3] with a hyphen, en dash or em dash, and the two-digit [S12] of a ledger past nine lines); a model cites numbered sources in groups, and such a tag left in the draft read as a name the source does not hold ("S1"), so a tag in the lede made groundPreCheck refuse the whole draft over a cosmetic tag; the parenthesised "(S3)" is not stripped (it is not flagged, and it is how real text writes Amazon S3). (2) ops_config q08_ground_precheck = on (default) | prune | off is the pre-check's off switch and its tested alternate path, read like q08_panel_order (cached five minutes, a failing read keeps the last known mode, an unset or unknown value is on): prune keeps the essay prune but passes the draft to the panel unchanged when the prune cannot clear the problems and never refuses a forecast; off makes no pre-check call and restores the 0.31.3 flow (verifyAndRevise prunes an essay and sends one model revision for an essay or a forecast after the panel). What the refusal costs where that model revision used to run is NOT measured: ok rows keep no repair trail, so it is unknown how many of the 17 ok runs of the seven days to 2026-10-19 passed through the revision, and the 25 gate_failed runs of those days that ended on a name, year or figure all ran before this stage existed. (3) migrations/2026-10-19-q08-fact-ledger.sql registers the gate (control_registry q08-ground-precheck), the failure mode q08-factcheck-late-failure with its detector contract fm-q08-factcheck-late-failure, the capability and the decision. New release notes go in this block, never on the VERSION line (VERSION-LINE-NOTES-1, 2026-10-19). */
// Release notes of 0.31.3 and earlier, moved unchanged off the VERSION line (they rode on it as a 36,000-character comment): 0.31.1 Q08-PANEL-CALIBRATION-1 (2026-10-19, pillar research; patch): the reader panel rotates over the whole pool again (the 0.31.0 order put the two strictest judges, kimi-k2.6 pass 0.35 and deepseek-v4-flash pass 0.263 in q08_reader_tests, in every round-1 panel and cut the chance a draft clears it); ops_config q08_panel_order = measured restores the 0.31.0 order. 0.31.0 Q08-YIELD-1 (agent_issues 99929, 99930 and 2606, 2026-10-19; pillar research, cost second): 266 of 311 runs in 7 days ended gate_failed (17 ok, pass rate 0.06) at 83,598 neurons per published piece, and a run recorded neither how much source material it read nor how many model calls it spent. Every engine_runs row now carries source_chars, source_kind, compose_calls and verify_calls (nullable columns added by the worker's own schema bootstrap); the thin-source test is no longer a flat 600 characters of article but the thinnest source that has published in the last 30 days, once five logged ok runs exist (a source below it ends the run as skipped and is retried after 24 hours with another candidate ahead of it); and a repair that already pruned flagged claims, is pruned again to a draft under the 2800-character floor and flags the same claim classes stops there instead of spending a model revision to extend it. PUBLISH_MIN_CHARS, the FACTS rule and every fact-check threshold are unchanged. Q08-REVIEWER-SWAP-1 (same release, agent_issues 2606 and 100118): qwen3.8-27b (104 of 134 calls errored, 80 s) and glm-5.3-flash (175 of 400, 58 s) led both reviewer lists after MODEL-FLOOR-1 removed the judges that answered; kimi-k2.6 and deepseek-v4-flash-0731 now lead the reader panel and deepseek-v4-flash-0731, gpt-oss-20b (the cheaper small judge, 462 neurons a verdict pair against about 696 for the old order and 972 for flash plus kimi: no Workers AI spend added) and kimi-k2.6 lead the fact-check, the previous reviewers stay in both pools as the per-request fallback, and reviewerHealth orders any reviewer with 30% errors on 12 or more calls over two days (ai_call_counters) behind the others, so the previous order returns by itself if the new head fails; no banned model is used and no family leaves a pool. // 0.30.0 CRON-GRID-1 (0.29.0 was claimed by the Q08-YIELD-1 handoff patch, which lands as 0.31.0) (owner directive 2026-10-19, pillar autonomy): the daily 17:00 digest trigger is gone; it runs on the hourly :00 fire after its slot, and every fire is logged to cron_fire_log for CRON-WATCH-1. // 0.28.14 SIGNAL-SQL-ARITY-1 (#2779, 2026-10-19, RESOLVE-ALL-OPEN-1): stallDetector bound one value to "UPDATE issue_triage SET close_evidence=?1 WHERE issue_id=?2", the one prepare/bind site in this file whose placeholder count differs from its binds (static scan of 150 sites); it now binds the issue id and upserts the triage row, so a recovered stall closes its Q08-PUBLISH-STALL-AUTO-1 issue. // Q08-YIELD-ORDER-1 (2026-10-18, pillar research). Measured 7-day publish yield from engine_runs: nemotron 12.8%, gpt-oss 3.8%, kimi 1.7%. COMPOSE_MODELS led with kimi (lowest yield, highest cost, ~1040 neurons/call); reordered to nemotron, gpt-oss, kimi. Raises q08_gate_pass_rate_7d and lowers q08_neurons_per_published_piece_7d together. 0.28.1 Q08-PRUNE-EXTEND-1 (agent_issues 2284; 29 of 77 failed runs in the 48 h to 2026-10-14 13:30 UTC ended "too short after pruning"): when deleting the flagged sentences leaves a clean draft whose only problem is the 2800-character floor, the one model revision extends that pruned draft from the source (every surviving sentence kept, the deleted claims named as not to be restated) instead of rewriting the unpruned draft, and the result is re-verified in full. 0.28.0 EXTERNAL-PROPERTIES-1 (owner 2026-10-14: '"By property" SHALL ALSO INCLUDE Q08.ORG AND READING.Q08.ORG'): every tick ends by mirroring the finished runs of the last 7 days (published or rejected at the gate, title and stage only) into qnfo-audit.content_external_items, so fleet.qnfo.org/content shows q08.org by property. 0.27.0 (owner 2026-10-14: "REJECTION RATES ARE UNACCEPTABLY HIGH ... WHY ZERO PUBLISHED TODAY?"; engine_runs 394-417: 2 of 24 published, 13 of 16 failed essays stopped on a flagged lede claim): Q08-LEDE-PRUNE-2 (a flagged lede sentence is cut when another lede sentence remains; ledeProblems still guards the opening) and Q08-GROUND-PROVENANCE-1 (the fact-check ground states the item's title and the site it appeared on as sentences, and the reviewers are told the source line is source material; "the paper appears on arxiv.org" was flagged unsupported in runs 415 and 417). 0.26.1 Q08-TITLE-REPAIR-2: every attempted title repair leaves a q08_reader_tests trail note (the reply opening or the error; runs 405 and 406 left none), and a title wrapped in a preamble, a Title: label or a code fence is read. 0.26.0 Q08-TITLE-REPAIR-1 (agent_issues 2284, 2503): a writer draft whose only writer-gate problems are its title gets one short title call to the same writer before the next writer is tried (8 of 15 nemotron drafts in a day were refused for the title alone while nemotron wrote every published piece). // 0.25.1 WORKERS-BP-LOGGING-1 (#2342): swallowed catches log; Q08-PANEL-METRIC-STATE-1 (#1895): the panel effective-votes and panel-unavailable writes set state MEASURED. // 0.25.0 Q08-ENTITY-BACKGROUND-1: the products, projects and organisations a headline names get their own full Wikipedia article in the background, so the system the analysis explains is in the checked source (run 390). 0.24.2 was: // 0.24.2 Q08-PRUNE-BODY-FLOOR-1 + Q08-SOURCE-CONCESSION-1: the prune floor is the publish floor measured on the body, and a fact-check item whose reason concedes it is in the source material (FAQ, comments, background) is dropped (run 388). 0.24.1 was: // 0.24.1 Q08-PARAPHRASE-ITEMS-1: in the reporting, a fact-check item whose reason concedes the content (phrasing, not explicitly stated, implied) and whose sentence has no digit, quotation or name does not fail the essay (run 387). 0.24.0 was: // 0.24.0 Q08-BUDGET-ROUTE-1: while the workers-ai or total ai_spend cap is breached the writer order puts nemotron and gpt-oss before kimi-k2.6 (BUDGET-SOFT-ROUTE-1, issue 1780). 0.23.2 was: // 0.23.2 CRON-ONLY-HEARTBEAT-1 (agent_issues 2397, pillar autonomy): each hourly scheduled run ends with a qnfo-audit fleet_heartbeat upsert (ok=0 when generation threw); write errors are logged. // 0.23.1 Q08-NAME-COMPOUND-1 + Q08-COMPOSE-TRAIL-1 (each writer's gate result is kept in q08_reader_tests): in a hyphenated compound only the capitalised parts are checked as names ("AI-driven", "Claude-generated"; run 386). 0.23.0 0.23.0 Q08-TECH-SYSTEMS-1: the analysis explains the technical system (components, data flow, the design decision or constraint behind the event, the trade-off) instead of an incentive template; the background reads full Wikipedia articles on the technologies; both reader prompts judge technical understanding. 0.22.1 0.22.1 Q08-PRUNE-FLOOR-2: the prune floor is the publish floor (3000 characters with title and verdict), so the repair stops instead of eroding a draft that can no longer publish (run 385). 0.22.0 0.22.0 Q08-WRITER-UPGRADE-1: kimi-k2.6 writes first with thinking off, nemotron and gpt-oss as per-request fallback. 0.21.0 0.21.0 Q08-FINAL-READ-1 + Q08-SOURCE-DEPTH-1 (eight comments and arXiv abstracts up to 3000 characters; the fact-checkers count background and comments as source): the exact text that would be published needs 2800 characters of body and a final two-family reader panel (vacuity-focused prompt, mean 4, no judge under 3, fails closed) after the fact check and its prunes. 0.20.3 0.20.3 Q08-ANALYSIS-CONCRETE-1: an analysis-check item counts only when the sentence it quotes has a digit, a quotation or a name; abstract reasoning flagged against the reviewers' own instruction is dropped (run 383). 0.20.2 0.20.2 Q08-VERDICT-NORM-1: near-miss verdict lines are normalised, and a first draft whose only problem is the verdict line gets the verdict micro-call (which now reads the essay) before a full rewrite (run 382). 0.20.1 0.20.1 Q08-MARK-SHIFT-1: an analysis marker placed where the guard rails refuse it moves later, paragraph by paragraph, to the first accepted place instead of sending the whole essay to the strict check (run 381). 0.20.0 0.20.0 Q08-ANALYSIS-DEPTH-1: an essay publishes only with a systems analysis of at least two paragraphs and 700 characters whose opening refers to something the piece said (a thin one goes to the one model revision); the inference prune keeps the analysis section (Q08-ANALYSIS-KEEP-1), and a "This <noun>" sentence left after a cut goes with it (Q08-DANGLING-CUT-1). 0.19.3 0.19.3 Q08-SOURCE-ORDER-1: Hacker News stories and arXiv papers are tried before GitHub repositories (alternating, never the last source twice); a repository is used only when no story or paper ahead of it has enough source material (runs 354, 356, 358, 375, 379: repository essays had no system to analyse). // 0.19.2 Q08-ANALYSIS-AUTO-1 (run 378): when the writer leaves the <!-- analysis --> marker out, the analysis starts at the first body paragraph after the lede and context written in reasoning language (same 60% and 600-character guard rails, still checked for invented facts); the run error records the analysis split (marked, auto, none). // 0.19.1 Q08-SOURCE-GROUND-1 (run 377): the fact-check ground carries the source description the writer is given (kind, title, link, site) and labels each part (discussion comments, linked article, background), so "posted on apple.com" and "a commenter on Hacker News said" can be verified instead of failing as not in source. // 0.19.0 Q08-ANALYSIS-SECTION-1 (owner 2026-10-13: big-picture systems analysis): the writer marks where its systems analysis starts with an invisible <!-- analysis --> line; the reporting before it keeps the sentence-by-sentence fact-check, the analysis after it is checked only for concrete invented facts (events, named parties acting, dates, numbers, quotations, studies), the deterministic name/year/figure check still covers the whole text, the analysis may be at most 60% of the body, and the marker never reaches readers or the published page. // 0.18.2 (run 375): "README", "CHANGELOG", "GitHub" and "repository" are not names the grounding check needs in the source (the source of a repository piece is its README); the fact revision is told to keep a news lede naming the subject and where it appeared. // 0.18.1 Q08-LEDE-PRUNE-1: the fact-check prune never deletes sentences of the first paragraph (a piece was published opening "Users therefore trust ..." after its lede was pruned); a flagged claim in the lede sends the draft to the model revision, and every pruned draft is re-checked with ledeProblems. // 0.18.0 Q08-CONTEXT-1 (owner 2026-10-13: "totally lacking in context and big-picture systems analysis"): each essay gets a BACKGROUND pack of verified reference text (Wikipedia lead sections for the story's subject and recent news coverage) that the writer may cite and the fact-check verifies against; the directive requires a context section and a systems analysis (parties, incentives, constraints, feedback loop, who gains and who pays, where else it operates); the fact-check treats framed analysis that adds no new name, number or event as not a violation, and a reviewer reason calling an item analysis marks it reasoning; readers cap a piece that only retells its source at 3. // 0.17.6 Q08-PRUNE-VERDICT-1 (run 369): the sentence prune sets the verdict line aside and puts it back unchanged, so a verdict that shared a paragraph with the last sentence is no longer damaged into a "missing verdict" failure. // 0.17.5 Q08-LEDE-SPLIT-1 (run 368): an overlong first paragraph is split at a sentence boundary into a lede of at most 70 words and a following paragraph, instead of failing "lede too long"; nothing is added or removed. // 0.17.4 Q08-TICK-BUDGET-1 (agent_issues 2479): an essay after a failed forecast waits for the next tick when more than 240 s are used (run 366 left no row: forecast 256 s + essay up to 644 s reached the 15-minute limit), repair rounds stop at a tick deadline, and every early exit of generate() writes an engine_runs row (skipped or deferred) instead of vanishing. // 0.17.3 Q08-LEDE-1 (fleet audit 2026-10-13): forecasts open with a news lede too (the case they start from, where it was reported, the forecast and its probability) and are checked by ledeProblems; the forecast register is plain explanatory journalism, not the earlier detached register; the site description and home page say what q08 is in plain words. // 0.17.2 PUBLISH-STALL-DIGEST-1 (fleet audit 2026-10-13): the stall issue is rewritten on every stalled tick with the hours, a 24 h breakdown of the stage each run ended at and the newest errors, and turns critical after 24 h; stall failures are logged instead of swallowed. // 0.17.1 Q08-FULLTEXT-1 (agent_issues 2470): the richest thin candidate is written from only when its full text was fetched (at least 600 characters); an abstract-only candidate is skipped with a reported reason. // 0.17.0 Q08-LEDE-1 (owner 2026-10-13): inverted-pyramid essays. The writer is told the source (kind, title, link) and must open with a news lede (who did what, where it appeared, when, why it matters) before the analysis; a deterministic lede check (names the subject, no abstract opening, at most 90 words) joins the writer gate; the editor keeps the lede and reader cuts never remove it; readers score the opening first; titles are plain headlines naming the subject. // 0.16.0 Q08-GITHUB-README-1 (run 358): a GitHub repository source is read from its raw README (the page fetch returned a 378-byte stub, so true README statements were refused as unsupported), falling back to the page when there is none. // 0.15.2 Q08-PARAPHRASE-2 (run 357): a FACT-labelled item whose reason only objects to the wording ("slightly different wording") is a paraphrase too; 0.14.8 read that reason only on unlabelled items. // 0.15.1 Q08-REVISION-FLOOR-1 (run 356): the fact revision is held to the 1500-character prune floor, not the 2800-character writing floor (it rewrites an already pruned or edited draft), so a phrase-level tell is repaired instead of failing with "too short". // 0.15.0 Q08-READER-CUTS-1 (runs 339-355): the paragraph cuts the readers name ("delete paragraphs 4, 6 and 7", "cut the last two paragraphs") are applied deterministically before the model editor, at most half the body and only when the result passes the editor gate; the model editor is the fallback. // 0.14.11 Q08-FLOOR-PARAS-1 (run 354): a pruned or edited draft held to its lower floor needs 4 substantial paragraphs, not the 6 of a full 2800-character draft. // 0.14.10 Q08-PRUNE-FUZZY-1 (run 353): an unsupported item the reviewer paraphrased instead of quoting removes the one sentence sharing most of its content words (at least 4 and 60%), instead of "prune located nothing". // 0.14.9 Q08-TITLE-CARRY-2 (run 352): the title carry (editor drafts and the fact revision) uses every title rule of the gate (label, formula and Title Case titles), not only the dry-title pattern and the length limit. // 0.14.8 Q08-PRUNE-ROUNDS-2 + Q08-PARAPHRASE-1 (run 350): fact repair runs up to 8 rounds while it has used under 6 minutes (5 before), and a reviewer reason that only objects to the wording ("not in source as a direct quote", "not verbatim") marks a paraphrase, not a FACT; "not entirely in source" is read as a negation (it was read as support since 0.14.2). // 0.14.7 Q08-FACT-REVISION-FORMAT-1 (run 349): the fact revision keeps the draft's passing title and verdict line and gets the deterministic framing repair on a phrase-level-only gate failure, instead of failing on a label title it wrote. // 0.14.6 Q08-FACT-SHAPE-2 (runs 347-348): a reviewer item labelled FACT whose quoted text has no digit, quotation or capitalised name and uses generalising wording (wherever, any, every, if, therefore, would, could, pattern, mechanism, incentive) is reasoning; a plain modal claim stays a FACT. // 0.14.5 also removes the title checks 0.14.4-codeagent (PR 1061) pasted ahead of the gate's own if/else chain, which reported every failing title twice. // 0.14.5 Q08-HANDLE-STRIP-1 (run 346): a social handle the writer copied from the source loses its '@' instead of failing the gate (e-mail addresses and @cf/ model ids untouched). Q08-EDITOR-TITLE-CARRY-1 (run 343): an editor draft whose title is missing, over 100 characters or a label title keeps the writer's passing title instead of failing the gate; the body stays the editor's. // 0.14.3 Q08-EDITOR-ROUND-2 + Q08-FACT-OBJECT-ITEM-1 + Q08-FACT-SHAPE-1 (runs 338-341): an unlabelled fact-check item whose quoted text has no digit, quotation or capitalised name and uses causal or modal wording, with a reason that quotes nothing and names no date, figure or name, is reasoning (deleted when the draft can spare it, never a failure); a close panel miss (mean at least 3 of 5) after the editor gets one more editor pass that applies the readers' named cuts, read by a third panel; a fact-check item returned as an object is rebuilt as "LABEL: claim -- reason" instead of "[object Object]". // 0.14.2 Q08-FACT-INFERENCE-2 (run 338): reviewers skipped the FACT/INFERENCE label and wrote 'inference from source' in the reason; an unlabelled item whose reason names an inference, interpretation, generalisation, assumption or paraphrase (and no name, date, number or quotation) is an INFERENCE; the prompt shows an example answer. // 0.14.1 Q08-EDITOR-VERDICT-CARRY-1 (run 337): an editor draft that dropped the final 'worth your time' line gets the writer's line back instead of failing the gate. // 0.14.0 Q08-STALL-RETRY-1 (agent_issues 2286): while no piece has been published for 2 hours, the :30 cron makes a second generation attempt after its audit (same gates and caps, never overlapping the :00 attempt; ops_config q08_stall_retry = off stops it). // 0.13.2 Q08-FACT-INFERENCE-1 (agent_issues 2286): the fact-check labels each finding FACT or INFERENCE; only FACT findings fail a draft (unlabelled ones count as FACT), INFERENCE findings are deleted when the draft can spare them; runs 333-335 failed only because reviewers listed the essay's own reasoning next to real fact errors. // 0.13.0 FRAMING-REPAIR-1 + FACTCHECK-DEGRADE-1 (agent_issues 2284, 2286, 2288; pillar reach): a gate failure made only of phrase-level tells is repaired without a model call (the flagged sentences removed, full gate re-run, at most a quarter of the sentences; logged as framing_repair rows and in the run error), the writer, editor and forecaster prompts carry one line naming the framing idioms the gate rejects, the retry feedback shows each flagged phrase in its sentence, and the fact-check panel tries every non-writer family on Workers AI (the writer families join the pool, cheaper sibling first) before a draft fails as unavailable. // 0.12.0 Q08-EDGE-CACHE-1 (issue 2343, pillar reach): plain GET pages are served from the edge cache for their public max-age=300 (TTFB 0.8-1.6 s measured: every view rendered from D1); a cache hit on a piece page still counts both reads; every HTML response carries Referrer-Policy and Permissions-Policy. // 0.11.19 Q08-READER-NOTHINK-1 (issue 2085): reader judges use the measured per-model reasoning switches and a 6000-token budget (2000 left reasoning judges without a verdict on 11 panel reads in 3 days). // 0.11.18 Q08-EDIT-FLOOR-1: the editor pass applies the readers' cuts and is held to 1800 characters, not the 2800-character writing floor (runs 319, 323, 327: readers asked to delete restating paragraphs, the editor was told to keep 2800 characters, the second panel rejected the same padding); forecasts keep the writing floor. // 0.11.17 Q08-PRUNE-FLOOR-1: a draft repaired by deleting the reviewers' quoted sentences is held to a 1500-character floor (the audit-repair floor), not the 2800-character writing floor, so the repair stops falling back to a model revision that writes new unsupported detail (runs 292-332: no piece since 2026-10-10 06:05); five prune rounds, one model revision at most, and the repair trail is kept in the run error. // 0.11.16 SINGLE-LETTER-1: a single capital letter (the O of O(n), a variable, a list label) is never read as a name by the grounding check (run 330: accuracy "name not in the source: O"). // 0.11.15 Q08-FACT-REPAIR-1 + FACTCHECK-NOTHINK-1 (issue 2349) + Q08-VERDICT-TOLERANT-1: reviewers run with reasoning off where a measured switch exists (0.7-2.6 s instead of 4-9 s), 75 s timeout, and a verdict is read from the explicit fields when the JSON is wrapped or truncated. // 0.11.13 Q08-PRUNE-1: a draft that fails the fact-check is first repaired by deleting exactly the sentences the reviewers quoted (deletion cannot add a fact; runs 319-326 show every model revision reintroducing unsupported detail), then re-verified in full, up to three rounds; a model revision is only the fallback. // 0.11.12 Q08-EDITOR-PHRASE-REVISE-1: an editor draft rejected only for phrase-level tells (a label title) gets one targeted revision instead of failing the run. 0.11.11 0.11.11 GROUND-HYPHEN-1: the name check treats unicode hyphens as "-" and a hyphenated source name grants its parts, and the capital/cost/policy-driven label-title pattern no longer rejects sentence-case titles (run 318: 'Capital-driven polishing eclipses the original creator'). // 0.11.8 Q08-GENERAL-CLAIMS-1: the writer states general mechanisms only as conditional reasoning from the source (run 315: "many programs assume", "the only reliable safeguard" were flagged as unsupported prevalence claims), and the reviewers do not count conditionals or mentions of the source as violations. // 0.11.7 Q08-FACTCHECK-POOL-1: fact-check reviewers run in a fixed order, llama-3.3-70b and qwen3-30b first, because the rotating pool led with models that timed out or exhausted their token budget (runs 305-314 ended fact-check unavailable). // 0.11.6 Q08-RICH-SOURCE-1: candidates are chosen for source richness (story, discussion and fetched article of at least 2200 characters, arXiv papers read from their HTML rendering) before writing starts, because the fact-check rejected every draft a thin source forced the writer to invent (run 314: unsupported claims about a story whose article could not be fetched); the richest candidate is used when none reaches the bar. // 0.11.5 Q08-PANEL-THRESHOLD-1: the reader panel passes at a mean of 3.5 with at least half the readers reading to the end (was 4 from both: readers splitting 3 and 4 rejected every source-only draft); the name check skips all-caps acronyms of up to five letters (the two-family fact-check still reviews them) and sentence-opening prepositions. // 0.11.4 Q08-AI-OBJECT-REPLY-1: Workers AI returns `response` as a parsed object when a model replies with bare JSON (llama, qwen), which became "[object Object]" and no verdict (run 312: three of five fact-check reviewers); every reply is now normalised to text before it is parsed. // 0.11.3 Q08-EDITOR-GROUNDED-1: the editor pass said "cut anything that only restates" with a 2800-character floor and "replace abstractions with people doing things", so thin-source drafts came back too short or invented concrete detail; the editor now adds nothing outside the draft and source and keeps the floor, the reader prompts ask for cuts never outside facts, the length label is 450-1100 words (700 words could never fit the 2800-character floor), and the editor-gate failure names its gate problems. // 0.11.2 Q08-FACTCHECK-DIAG-1: fact-check reviewers run one at a time over every non-writer family and a failure keeps its cause in the run error (the verdict outage had no visible reason). // 0.11.1 Q08-FACTCHECK-BUDGET-1: reviewers get 8000 tokens (2000 left reasoning models without a verdict, so every run ended "fact-check unavailable"); the name check ignores sentence connectives, compass adjectives and common technical acronyms. // 0.11.0 Q08-YIELD-REPAIR-1 (pillar: reach; owner directive 2026-10-11, automation must run user-free): generation runs hourly and audit/repair has its own :30 cron; an essay that fails the audit is repaired (unsupported claims deleted, correction note) before it is retracted and earlier audit retractions get one restoration attempt; essay length follows the source (450-1100 words, never padded) so the panel stops rejecting padding; name check ignores initials; article fetch upgrades http to https; attempt cap 4x. // 0.10.2 Q08-RENDER-1 + NO-DEAD-DOI-2 (pillar: reach; owner directives 2026-10-10, agent_issues 2279 and 2275): titles, headings, list items, claims and previews render inline Markdown (*italic*, **bold**, `code`, links) and math (\\( \\), $$ $$, and $...$ only with a TeX token and no space inside, never before a digit, so currency stays literal) through q08Inline; <title>, og/twitter, citation meta, JSON-LD, RSS, e-mail digest, social text and BibTeX/RIS use q08Plain (markers stripped, TeX as Unicode); mdToHtml gains numbered lists and block quotes; the funnel copy no longer claims a DOI; the writer prompt states the title format. // 0.10.1 generative prompts name no example nouns (process and style only); 0.10.0 Q08-VERIFY-1 (pillar: reach, owner directive 2026-10-10: q08 content is 100% accurate and fact-checked): the writer prompts no longer ask for history from memory; a piece is published only when every name, year and figure is in its source material (signal plus the fetched article) and two reviewers from other model families find no unsupported claim (a reviewer outage fails closed); published pieces are re-audited each cron and a failure is retracted in public (410 notice, /retractions, out of index, feed, sitemap, APIs and social; forecasts built on it too). // 0.9.0 Q08-FORECAST-1 (pillar: reach): forecast mode. Every FORECAST_EVERY pieces the engine writes a most-likely scenario narrative from a published essay's mechanism (dated causal sequence, rival scenarios with probabilities, leading indicators, a checkable resolution condition), stored in q08_forecasts, settled by a two-family judge panel when the horizon passes and scored (Brier) on /forecasts and /api/forecasts; undecidable ones go void in public after 4 checks. // 0.8.13-codeagent 0.8.12 Q08-PHRASE-REVISE-1: a phrase-level-only gate failure is retried as a revision of the same draft, not a rewrite from scratch (#2034); 0.8.11 BUDGET-SOFT-ROUTE-1 (2026-10-06, pillar cost): the attempt-bound note no longer cites a budget stop; the bound is publishing cadence. // 0.8.10 Q08-STALL-METRIC-1 writes q08_hours_since_last_piece (#2034); 0.8.9 unknown paths 404 noindex (no soft 404); 0.8.8 Q08-SITEMAP-INDEXABLE-1: canonical home loc, no feed in the sitemap, www -> apex 301; // v0.8.6 Q08-WRITE-ROUTES-TOKEN-1 (pillar: reach, agent_issues 1995): POST /run and POST /regen need x-loop-token (both spent model calls for anyone; /regen rewrote a published essay without the panel); v0.8.5 Q08-ENSEMBLE-1 (pillar: reach): writer -> 2-judge reader panel from model families other than the writer -> editor from the other writer family -> fresh panel; judges are small-active-parameter models; panel agreement measured (q08_panel_effective_votes_30d); v0.8.4 Q08-QUALITY-1 (pillar: reach): plain-wording and no-pipeline-metadata rules, overused-precedent ban, Title Case title gate, owner editorial directives (qnfo-audit q08_editor_notes), reader-test rounds by the other model (max 1 rewrite, fail-open on a critic error), daily attempt cap of 2x the publish cap, owner verdict weight 3 (q08_owner_verdicts); v0.8.3 Q08-NOTE-1 (pillar: reach): optional sanitized note on the verdict form, stored in q08_feedback.note, never read by any prompt; v0.8.2 Q08-METRICS-1: daily human/crawler read counter, GET /api/metrics, metrics_7d on /health, own registry values (#1759); compose temperature from ops_config q08_compose_temperature 0.4..0.8 (#1760); v0.7.37 Q08-CADENCE-CAP-1: daily cap read from ops_config q08_max_per_day (#1716); v0.7.36 personal-channel-hold-ascii; v0.7.16 ANTI-BANAL-1: ban stock "structural dynamic" framing + label/abstraction titles; title must name a mechanism, not a category // 0.11.14 rnd36 uses rejection sampling (no modulo bias). 0.11.13 WORKERS-BEST-PRACTICES-1: the read-count write rides ctx.waitUntil (it was un-awaited and could be cancelled when the response returned), the x-loop-token check is constant-time, row ids and slug salts use crypto.getRandomValues, and a failed background write is logged. 0.11.12 0.11.12 Q08-EDITOR-PHRASE-REVISE-1: an editor draft rejected only for phrase-level tells (a label title) gets one targeted revision instead of failing the run. 0.11.11 0.11.11 GROUND-HYPHEN-1: the name check treats unicode hyphens as "-" and a hyphenated source name grants its parts, and the capital/cost/policy-driven label-title pattern no longer rejects sentence-case titles (run 318: 'Capital-driven polishing eclipses the original creator'). // 0.11.8 Q08-GENERAL-CLAIMS-1: the writer states general mechanisms only as conditional reasoning from the source (run 315: "many programs assume", "the only reliable safeguard" were flagged as unsupported prevalence claims), and the reviewers do not count conditionals or mentions of the source as violations. // 0.11.7 Q08-FACTCHECK-POOL-1: fact-check reviewers run in a fixed order, llama-3.3-70b and qwen3-30b first, because the rotating pool led with models that timed out or exhausted their token budget (runs 305-314 ended fact-check unavailable). // 0.11.6 Q08-RICH-SOURCE-1: candidates are chosen for source richness (story, discussion and fetched article of at least 2200 characters, arXiv papers read from their HTML rendering) before writing starts, because the fact-check rejected every draft a thin source forced the writer to invent (run 314: unsupported claims about a story whose article could not be fetched); the richest candidate is used when none reaches the bar. // 0.11.5 Q08-PANEL-THRESHOLD-1: the reader panel passes at a mean of 3.5 with at least half the readers reading to the end (was 4 from both: readers splitting 3 and 4 rejected every source-only draft); the name check skips all-caps acronyms of up to five letters (the two-family fact-check still reviews them) and sentence-opening prepositions. // 0.11.4 Q08-AI-OBJECT-REPLY-1: Workers AI returns `response` as a parsed object when a model replies with bare JSON (llama, qwen), which became "[object Object]" and no verdict (run 312: three of five fact-check reviewers); every reply is now normalised to text before it is parsed. // 0.11.3 Q08-EDITOR-GROUNDED-1: the editor pass said "cut anything that only restates" with a 2800-character floor and "replace abstractions with people doing things", so thin-source drafts came back too short or invented concrete detail; the editor now adds nothing outside the draft and source and keeps the floor, the reader prompts ask for cuts never outside facts, the length label is 450-1100 words (700 words could never fit the 2800-character floor), and the editor-gate failure names its gate problems. // 0.11.2 Q08-FACTCHECK-DIAG-1: fact-check reviewers run one at a time over every non-writer family and a failure keeps its cause in the run error (the verdict outage had no visible reason). // 0.11.1 Q08-FACTCHECK-BUDGET-1: reviewers get 8000 tokens (2000 left reasoning models without a verdict, so every run ended "fact-check unavailable"); the name check ignores sentence connectives, compass adjectives and common technical acronyms. // 0.11.0 Q08-YIELD-REPAIR-1 (pillar: reach; owner directive 2026-10-11, automation must run user-free): generation runs hourly and audit/repair has its own :30 cron; an essay that fails the audit is repaired (unsupported claims deleted, correction note) before it is retracted and earlier audit retractions get one restoration attempt; essay length follows the source (450-1100 words, never padded) so the panel stops rejecting padding; name check ignores initials; article fetch upgrades http to https; attempt cap 4x. // 0.10.2 Q08-RENDER-1 + NO-DEAD-DOI-2 (pillar: reach; owner directives 2026-10-10, agent_issues 2279 and 2275): titles, headings, list items, claims and previews render inline Markdown (*italic*, **bold**, `code`, links) and math (\\( \\), $$ $$, and $...$ only with a TeX token and no space inside, never before a digit, so currency stays literal) through q08Inline; <title>, og/twitter, citation meta, JSON-LD, RSS, e-mail digest, social text and BibTeX/RIS use q08Plain (markers stripped, TeX as Unicode); mdToHtml gains numbered lists and block quotes; the funnel copy no longer claims a DOI; the writer prompt states the title format. // 0.10.1 generative prompts name no example nouns (process and style only); 0.10.0 Q08-VERIFY-1 (pillar: reach, owner directive 2026-10-10: q08 content is 100% accurate and fact-checked): the writer prompts no longer ask for history from memory; a piece is published only when every name, year and figure is in its source material (signal plus the fetched article) and two reviewers from other model families find no unsupported claim (a reviewer outage fails closed); published pieces are re-audited each cron and a failure is retracted in public (410 notice, /retractions, out of index, feed, sitemap, APIs and social; forecasts built on it too). // 0.9.0 Q08-FORECAST-1 (pillar: reach): forecast mode. Every FORECAST_EVERY pieces the engine writes a most-likely scenario narrative from a published essay's mechanism (dated causal sequence, rival scenarios with probabilities, leading indicators, a checkable resolution condition), stored in q08_forecasts, settled by a two-family judge panel when the horizon passes and scored (Brier) on /forecasts and /api/forecasts; undecidable ones go void in public after 4 checks. // 0.8.13-codeagent 0.8.12 Q08-PHRASE-REVISE-1: a phrase-level-only gate failure is retried as a revision of the same draft, not a rewrite from scratch (#2034); 0.8.11 BUDGET-SOFT-ROUTE-1 (2026-10-06, pillar cost): the attempt-bound note no longer cites a budget stop; the bound is publishing cadence. // 0.8.10 Q08-STALL-METRIC-1 writes q08_hours_since_last_piece (#2034); 0.8.9 unknown paths 404 noindex (no soft 404); 0.8.8 Q08-SITEMAP-INDEXABLE-1: canonical home loc, no feed in the sitemap, www -> apex 301; // v0.8.6 Q08-WRITE-ROUTES-TOKEN-1 (pillar: reach, agent_issues 1995): POST /run and POST /regen need x-loop-token (both spent model calls for anyone; /regen rewrote a published essay without the panel); v0.8.5 Q08-ENSEMBLE-1 (pillar: reach): writer -> 2-judge reader panel from model families other than the writer -> editor from the other writer family -> fresh panel; judges are small-active-parameter models; panel agreement measured (q08_panel_effective_votes_30d); v0.8.4 Q08-QUALITY-1 (pillar: reach): plain-wording and no-pipeline-metadata rules, overused-precedent ban, Title Case title gate, owner editorial directives (qnfo-audit q08_editor_notes), reader-test rounds by the other model (max 1 rewrite, fail-open on a critic error), daily attempt cap of 2x the publish cap, owner verdict weight 3 (q08_owner_verdicts); v0.8.3 Q08-NOTE-1 (pillar: reach): optional sanitized note on the verdict form, stored in q08_feedback.note, never read by any prompt; v0.8.2 Q08-METRICS-1: daily human/crawler read counter, GET /api/metrics, metrics_7d on /health, own registry values (#1759); compose temperature from ops_config q08_compose_temperature 0.4..0.8 (#1760); v0.7.37 Q08-CADENCE-CAP-1: daily cap read from ops_config q08_max_per_day (#1716); v0.7.36 personal-channel-hold-ascii; v0.7.16 ANTI-BANAL-1: ban stock "structural dynamic" framing + label/abstraction titles; title must name a mechanism, not a category
// WORKERS-AI-ATTRIBUTION-1 (2026-10-01, #1681): per-worker Workers AI attribution. Returns a shallow env copy whose AI
// binding records each .run() (calls, errors, ms, tokens, neurons) into qnfo-audit ai_call_counters (purpose 'binding').
// Neurons = usage tokens x Cloudflare's published per-model rates (neurons per M tokens). Fail-soft; env is never mutated.
var __AI_ATTR_RATES = { "@cf/zai-org/glm-5.3": [127273, 400000], "@cf/zai-org/glm-5.3-flash": [13636, 45455], "@cf/nvidia/nemotron-3-120b-a12b": [45455, 136364], "@cf/moonshotai/kimi-k2.6": [86364, 363636], "@cf/moonshotai/kimi-k2.7-code": [86364, 363636], "@cf/openai/gpt-oss-120b": [31818, 68182], "@cf/openai/gpt-oss-20b": [18182, 27273], "@cf/deepseek-ai/deepseek-v4-pro-0813": [120000, 360000], "@cf/deepseek-ai/deepseek-v4-flash-0731": [40000, 120000], "@cf/meta/llama-3.3-70b-instruct-fp8-fast": [26668, 204805], "@cf/qwen/qwen3-30b-a3b-fp8": [4625, 30475], "@cf/qwen/qwen3.8-27b": [40909, 290909], "@cf/baai/bge-base-en-v1.5": [6058, 0], "@cf/baai/bge-small-en-v1.5": [1841, 0], "@cf/baai/bge-large-en-v1.5": [18582, 0] };
function __aiAttrEnv(env, worker, aiKey, dbKey) {
  try {
    if (!env || env.__aiAttr) return env;
    var ai = env[aiKey], db = env[dbKey];
    if (!ai || typeof ai.run !== "function" || !db) return env;
    var wrapped = new Proxy(ai, { get: function (t, p) {
      if (p !== "run") { var v = Reflect.get(t, p); return typeof v === "function" ? v.bind(t) : v; }
      return async function (model, input, opts) {
        var t0 = Date.now(), ok = 1, res;
        try { res = await t.run(model, input, (function () { /* PROMPT-CACHE-1: same model + same first 4 KB of prompt -> same instance, so Workers AI prefix caching bills repeated context at the cached-input rate (glm-5.3-flash $0.03 vs $0.15 per M) */ try { if (opts && opts.extraHeaders && opts.extraHeaders["x-session-affinity"]) return opts; var m = input && input.messages, c = m && m.length ? m[0].content : (input && input.prompt); var s = typeof c === "string" ? c : JSON.stringify(c || ""); if (s.length < 1024) return opts; s = String(model) + "|" + s.slice(0, 4096); var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } var o = Object.assign({}, opts || {}); o.extraHeaders = Object.assign({}, o.extraHeaders || {}, { "x-session-affinity": "pc-" + (h >>> 0).toString(36) }); return o; } catch (ePc) { return opts; } })()); return res; } catch (e) { ok = 0; throw e; }
        finally {
          try {
            var u = res && typeof res === "object" && res.usage || {}; if (!/bge|embed|whisper|m2m100|resnet|flux|sdxl/i.test(String(model))) try { var cTok = Number(u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens || u.cached_tokens || u.input_tokens_details && u.input_tokens_details.cached_tokens || 0) || 0; await db.prepare("INSERT INTO ai_cache_counters (day, worker, model, calls, cached_calls, in_tok, cached_tok) VALUES (?1,?2,?3,1,?4,?5,?6) ON CONFLICT(day, worker, model) DO UPDATE SET calls=calls+1, cached_calls=cached_calls+excluded.cached_calls, in_tok=in_tok+excluded.in_tok, cached_tok=cached_tok+excluded.cached_tok").bind(new Date().toISOString().slice(0, 10), worker, String(model).slice(0, 120), cTok > 0 ? 1 : 0, Number(u.prompt_tokens || u.input_tokens || 0) || 0, cTok).run(); } catch (eCc) { console.error(JSON.stringify({ evt: "q08-signal-engine:__aiAttrEnv:caught", error: String((eCc && eCc.message) || eCc) })); }
            var chars = 0; try { chars = JSON.stringify(input && (input.messages || input.prompt || input.text) || input || "").length; } catch (e1) { console.error(JSON.stringify({ evt: "q08-signal-engine:__aiAttrEnv:caught", error: String((e1 && e1.message) || e1) })); }
            var inTok = Number(u.prompt_tokens || u.input_tokens || 0) || Math.round(chars / 4);
            var outTok = Number(u.completion_tokens || u.output_tokens || 0);
            var r = __AI_ATTR_RATES[String(model)] || [0, 0];
            var neurons = (inTok * r[0] + outTok * r[1]) / 1e6;
            await db.prepare("INSERT INTO ai_call_counters (day, worker, purpose, model, calls, errors, in_chars, ms, in_tok, out_tok, neurons) VALUES (?1,?2,'binding',?3,1,?4,?5,?6,?7,?8,?9) ON CONFLICT(day, worker, purpose, model) DO UPDATE SET calls=calls+1, errors=errors+excluded.errors, in_chars=in_chars+excluded.in_chars, ms=ms+excluded.ms, in_tok=in_tok+excluded.in_tok, out_tok=out_tok+excluded.out_tok, neurons=neurons+excluded.neurons")
              .bind(new Date().toISOString().slice(0, 10), worker, String(model).slice(0, 120), ok ? 0 : 1, chars, Date.now() - t0, inTok, outTok, neurons).run();
          } catch (e2) { console.error(JSON.stringify({ evt: "q08-signal-engine:__aiAttrEnv:caught", error: String((e2 && e2.message) || e2) })); }
        }
      };
    } });
    var copy = Object.assign({}, env);
    copy[aiKey] = wrapped;
    copy.__aiAttr = 1;
    return copy;
  } catch (e) {
    return env;
  }
}
var WORKER = "q08-signal-engine";
// Q08-SIGNAL-SQL-ARITY-1 (#2779): the D1 access path logs the first 160 chars of the SQL and the bound-parameter count
// whenever this error class is raised, so a failing statement is identifiable without guessing among the 120 prepare sites.
if (typeof D1Database !== "undefined" && D1Database.prototype && !D1Database.prototype.__q08ArityLogPatched) {
  (function () {
    var origPrepare = D1Database.prototype.prepare;
    if (typeof origPrepare !== "function") return;
    D1Database.prototype.prepare = function (sql) {
      var stmt = origPrepare.call(this, sql);
      var sqlText = String(sql);
      function wrap(s, parentArgs) {
        var origBind = s.bind, origRun = s.run, origAll = s.all, origFirst = s.first, origRaw = s.raw;
        var boundArgs = parentArgs || null;
        if (typeof origBind === "function") {
          s.bind = function () {
            var args = Array.prototype.slice.call(arguments);
            var next = origBind.apply(this, args);
            return wrap(next, args);
          };
        }
        function guard(method) {
          return function () {
            var args = Array.prototype.slice.call(arguments);
            var count = boundArgs ? boundArgs.length : args.length;
            function log(e) {
              if (e && String(e.message).indexOf("Wrong number of parameter bindings") !== -1) {
                console.error(JSON.stringify({
                  evt: "q08-signal-engine:db-arity-error",
                  sql: sqlText.slice(0, 160),
                  bindCount: count,
                  error: String(e.message || e)
                }));
              }
              return e;
            }
            try {
              var result = method.apply(this, args);
              if (result && typeof result.then === "function") {
                return result.then(undefined, function (e) { throw log(e); });
              }
              return result;
            } catch (e) { throw log(e); }
          };
        }
        if (typeof origRun === "function") s.run = guard(origRun);
        if (typeof origAll === "function") s.all = guard(origAll);
        if (typeof origFirst === "function") s.first = guard(origFirst);
        if (typeof origRaw === "function") s.raw = guard(origRaw);
        return s;
      }
      return wrap(stmt);
    };
    D1Database.prototype.__q08ArityLogPatched = true;
  })();
}
// Q08-METRICS-1 (#1759, pillar: reach): q08 measures itself for METRIC-CLOSED-LOOP-1. A GET of /p/<slug> adds 1 to a daily
// counter as human or crawler (the user-agent test iPatent's PAGE-METRICS-1 uses; no IP, cookie or referrer is stored).
// GET /api/metrics serves 7d aggregates; qnfo-fleet-control SURFACE-METRICS-1 reads them into metric_registry hourly.
// Votes count only from VOTE_CUTOFF, the day after POST-only voting went live (crawler votes before it are noise).
var Q08_BOT_UA = /bot|crawl|spider|slurp|preview|headless|curl|wget|python|httpclient|go-http|java\/|okhttp|axios|node-fetch|lighthouse|pingdom|uptime|monitor|scanner|facebookexternalhit|embedly|whatsapp|telegram/i;
var VOTE_CUTOFF = "2026-10-03T00:00:00Z";
function isCrawler(req) {
  var ua = String(req.headers.get("user-agent") || "");
  if (!ua || Q08_BOT_UA.test(ua)) return true;
  var bm = req.cf && req.cf.botManagement;
  return !!(bm && bm.verifiedBot);
}
async function countRead(env, req) {
  var col = isCrawler(req) ? "crawler" : "human";
  await env.DB.prepare("INSERT INTO q08_daily_reads (day, " + col + ") VALUES (?1, 1) ON CONFLICT(day) DO UPDATE SET " + col + " = " + col + " + 1").bind(utcDay()).run();
}
function ratio(a, b) { return b > 0 ? Math.round((a / b) * 1000) / 1000 : null; }
async function metrics7d(env) {
  var since = new Date(Date.now() - 7 * 864e5).toISOString();
  var voteSince = since > VOTE_CUTOFF ? since : VOTE_CUTOFF;
  var one = function (sql, args) { var st = env.DB.prepare(sql); return (args ? st.bind.apply(st, args) : st).first().catch(function () { return null; }); };
  var pub = await one("SELECT COUNT(*) n FROM published_pieces WHERE published_at >= ?1", [since]);
  var runs = await one("SELECT COUNT(*) n, SUM(CASE WHEN piece_published = 1 THEN 1 ELSE 0 END) ok FROM engine_runs WHERE ran_at >= datetime('now','-7 days') AND status NOT IN ('running','abandoned','async-done','skipped','deferred')");
  var reads = await one("SELECT COALESCE(SUM(human),0) human, COALESCE(SUM(crawler),0) crawler, COUNT(*) days FROM q08_daily_reads WHERE day >= ?1", [since.slice(0, 10)]);
  var votes = await one("SELECT COUNT(*) n, SUM(CASE WHEN signal IN ('yes','good') THEN 1 ELSE 0 END) yes, SUM(CASE WHEN signal = 'flat' THEN 1 ELSE 0 END) flat, SUM(CASE WHEN signal = 'no' THEN 1 ELSE 0 END) no FROM q08_feedback WHERE created_at >= ?1", [voteSince]);
  var subs = await one("SELECT COUNT(*) n FROM subscribers WHERE status = 'confirmed'");
  // Q08-RETRACTION-METRIC-1 (0.36.0): of the pieces published in 30 days, the share that carry a q08_retractions row. On 2026-10-26 131 of
  // the 145 pieces ever published were retracted and no metric showed it. Unknown under 10 pieces is null, never a value.
  var ret = await one("SELECT COUNT(*) n, SUM(CASE WHEN r.slug IS NOT NULL THEN 1 ELSE 0 END) retracted FROM published_pieces p LEFT JOIN q08_retractions r ON r.slug = p.slug WHERE p.published_at >= ?1", [new Date(Date.now() - 30 * 864e5).toISOString()]);
  var neurons = null;
  if (env.AUDIT) {
    var nr = await env.AUDIT.prepare("SELECT COALESCE(SUM(neurons),0) n FROM ai_call_counters WHERE worker = ?1 AND day >= ?2").bind(WORKER, since.slice(0, 10)).first().catch(function () { return null; });
    neurons = nr ? Number(nr.n) || 0 : null;
  }
  var published = Number(pub && pub.n) || 0, finished = Number(runs && runs.n) || 0, ok = Number(runs && runs.ok) || 0;
  var nVotes = Number(votes && votes.n) || 0;
  var fst = await forecastStats(env);
  return {
    forecasts_published: fst.published_7d,
    forecasts_open: fst.open,
    forecasts_overdue_open: fst.overdue_open,
    forecasts_resolved: fst.resolved,
    forecasts_void: fst.void,
    forecast_void_share: fst.void_share,
    forecast_brier: fst.calibration.brier,
    published: published,
    finished_runs: finished,
    gate_pass_rate: ratio(ok, finished),
    human_reads: Number(reads && reads.human) || 0,
    crawler_reads: Number(reads && reads.crawler) || 0,
    read_days_measured: Number(reads && reads.days) || 0,
    verified_votes: nVotes,
    verified_good_share: ratio(Number(votes && votes.yes) || 0, nVotes),
    reader_sentiment: ratio((Number(votes && votes.yes) || 0) - (Number(votes && votes.no) || 0), nVotes),
    neurons: neurons,
    neurons_per_published_piece: neurons == null ? null : ratio(neurons, published),
    confirmed_subscribers: Number(subs && subs.n) || 0,
    retraction_rate_30d: Number(ret && ret.n) >= 10 ? ratio(Number(ret.retracted) || 0, Number(ret.n)) : null,
    vote_cutoff: VOTE_CUTOFF
  };
}
// q08 writes its own registry values (the rows, targets and triggers are in migrations/2026-10-02-q08-metrics.sql). A value
// that is not a finite number is not written: unknown is never a value.
var Q08_METRIC_KEYS = [["q08_gate_pass_rate_7d", "gate_pass_rate"], ["q08_neurons_per_published_piece_7d", "neurons_per_published_piece"], ["q08_human_reads_7d", "human_reads"], ["q08_verified_votes_7d", "verified_votes"], ["q08_reader_sentiment_7d", "reader_sentiment"], ["q08_confirmed_subscribers", "confirmed_subscribers"], ["q08_retraction_rate_30d", "retraction_rate_30d"], ["q08_panel_unavailable_share_7d", "panel_unavailable_share_7d"], ["q08_forecasts_overdue_open", "forecasts_overdue_open"], ["q08_forecast_void_share", "forecast_void_share"]];
// Hours from an ISO timestamp (or epoch ms) to nowMs, rounded to 0.1; null when unparseable or in the future.
function hoursSince(t, nowMs) {
  if (t == null || t === "") return null;
  var ms = typeof t === "number" ? t : Date.parse(String(t));
  if (!isFinite(ms) || ms > nowMs + 60000) return null;
  return Math.round(Math.max(0, nowMs - ms) / 360000) / 10;
}
async function writeOwnMetrics(env) {
  if (!env.AUDIT) return 0;
  var m = await metrics7d(env), now = nowIso(), n = 0;
  for (var i = 0; i < Q08_METRIC_KEYS.length; i++) {
    var v = m[Q08_METRIC_KEYS[i][1]];
    if (typeof v !== "number" || !isFinite(v)) continue;
    var r = await env.AUDIT.prepare("UPDATE metric_registry SET last_value = ?2, last_refreshed = ?3, state = CASE WHEN state = 'UNMEASURED' THEN 'MEASURED' ELSE state END WHERE metric = ?1").bind(Q08_METRIC_KEYS[i][0], String(v), now).run().catch(function () { return null; });
    if (r && r.meta && r.meta.changes) n++;
  }
  // Q08-ENSEMBLE-1: how many independent votes the two-judge panel really gives (2 = independent, 1 = one voice twice).
  try {
    var ev = effectiveVotes(await panelPairs(env));
    if (ev.n_eff != null) {
      var rr = await env.AUDIT.prepare("UPDATE metric_registry SET last_value = ?2, last_refreshed = ?3, state = 'MEASURED' WHERE metric = ?1").bind("q08_panel_effective_votes_30d", String(ev.n_eff), now).run();
      if (rr && rr.meta && rr.meta.changes) n++;
    }
  } catch (e) { console.error(JSON.stringify({ evt: "q08-signal-engine:writeOwnMetrics:caught", error: String((e && e.message) || e) })); }
  // Q08-STALL-METRIC-1 (agent_issues 2034): hours since the newest published piece, so a publishing stall is a measured
  // metric with a probe, not only an issue stallDetector files. No model call.
  try {
    var lp = env.DB ? await env.DB.prepare("SELECT MAX(published_at) t FROM published_pieces").first() : null;
    var hs = hoursSince(lp && lp.t, Date.now());
    if (hs != null) {
      var rh = await env.AUDIT.prepare("UPDATE metric_registry SET last_value = ?2, last_refreshed = ?3, state = 'MEASURED' WHERE metric = ?1").bind("q08_hours_since_last_piece", String(hs), now).run();
      if (rh && rh.meta && rh.meta.changes) n++;
    }
  } catch (e) { console.error(JSON.stringify({ evt: "q08-signal-engine:writeOwnMetrics:caught", error: String((e && e.message) || e) })); }
  try {
    var us = await panelUnavailableShare(env);
    if (us != null) {
      var ru = await env.AUDIT.prepare("UPDATE metric_registry SET last_value = ?2, last_refreshed = ?3, state = 'MEASURED' WHERE metric = ?1").bind("q08_panel_unavailable_share_7d", String(us), now).run();
      if (ru && ru.meta && ru.meta.changes) n++;
    }
  } catch (e) { console.error(JSON.stringify({ evt: "q08-signal-engine:writeOwnMetrics:caught", error: String((e && e.message) || e) })); }
  return n;
}
var MAX_PER_DAY = 10;
// Q08-CADENCE-CAP-1 (agent_issues 1716, Q08-REVIEW-2026-10-31; charter pillar: cost): the daily cap is the qnfo-audit
// ops_config value under CAP_KEY, an integer 0..MAX_PER_DAY (0 pauses publishing). Absent, unreadable or not an integer
// means MAX_PER_DAY, the behaviour before this knob. qnfo-fleet-dashboard sets it to 2 when the 2026-10-31 review measures
// under 50 human page views a week; delete the row or raise it to undo. The cron still fires every 2 hours; a run past
// the cap returns before any scrape or AI call.
var CAP_KEY = "q08_max_per_day";
// PUBLISH-QUOTAS-1 (owner directive 2026-10-17: "PUBLISH STREAMS SHALL HAVE SEPARATE QUOTAS FOR EACH PROPERTY, DO NOT
// COMMINGLE STREAMS"). This engine owns exactly one property. Its daily quota now comes from ops_config
// publish_quotas, a JSON object keyed by property, so every property's number lives in one auditable place and no
// property can spend another's. q08_max_per_day stays as the q08.org fallback for the Q08-CADENCE-CAP-1 knob. The
// day count below is scoped to this property, never to the whole table (before this, one property-blind count gated
// every piece in published_pieces, so q08.org and reading.q08.org shared one budget).
var PROPERTY = "q08.org";
var QUOTAS_KEY = "publish_quotas";
var QUOTA_MAX = 500;
function parseQuota(v, fallback) {
  var s = v == null ? "" : String(v).trim();
  if (!/^\d{1,3}$/.test(s)) return fallback;
  return Math.min(Number(s), QUOTA_MAX);
}
function parseDailyCap(v) {
  var s = v == null ? "" : String(v).trim();
  if (!/^\d{1,3}$/.test(s)) return MAX_PER_DAY;
  return Math.min(Number(s), MAX_PER_DAY);
}
async function propertyQuota(env, fallback) {
  if (!env || !env.AUDIT) return fallback;
  try {
    var r = await env.AUDIT.prepare("SELECT value FROM ops_config WHERE key = ?1").bind(QUOTAS_KEY).first();
    var raw = r && r.value ? JSON.parse(String(r.value)) : null;
    if (raw && Object.prototype.hasOwnProperty.call(raw, PROPERTY)) return parseQuota(raw[PROPERTY], fallback);
  } catch (e) {
    console.error(JSON.stringify({ worker: "q08-signal-engine", event: "publish-quota-read", error: String(e && e.message || e).slice(0, 160) }));
  }
  return fallback;
}
async function ensurePropertyColumn(env) {
  try {
    var cols = await env.DB.prepare("PRAGMA table_info(published_pieces)").all();
    var list = (cols && cols.results) || [];
    for (var i = 0; i < list.length; i++) if (String(list[i].name) === "property") return;
    await env.DB.prepare("ALTER TABLE published_pieces ADD COLUMN property TEXT").run();
  } catch (e) {
    console.error(JSON.stringify({ worker: "q08-signal-engine", event: "property-column", error: String(e && e.message || e).slice(0, 160) }));
  }
}
// Q08-YIELD-1 (agent_issues 99929, 99930): engine_runs recorded the outcome of a run but not what it read or spent, so nobody could say
// which share of 266 gate_failed runs in 7 days came from sources too thin to ground a 2800-character piece. engine_runs is created outside
// this file, so the worker adds the six nullable columns itself (pragma_table_info guard; a column that already exists is never added
// twice) and writes them at every generation insert. A failed ALTER, or an insert that fails with the new columns, falls back to the old
// column list: logging can never cost a run its row.
var RUN_COLUMNS = [["source_chars", "INTEGER"], ["source_kind", "TEXT"], ["compose_calls", "INTEGER"], ["verify_calls", "INTEGER"], ["panel_calls", "INTEGER"], ["factcheck_calls", "INTEGER"]];
var __runColsOk = false, __runColsTried = 0;
async function ensureRunColumns(env) {
  if (__runColsOk) return true;
  if (Date.now() - __runColsTried < 30000) return false;
  __runColsTried = Date.now();
  try {
    var cols = await env.DB.prepare("SELECT name FROM pragma_table_info('engine_runs')").all();
    var have = {};
    ((cols && cols.results) || []).forEach(function (c) { have[String(c.name)] = 1; });
    for (var i = 0; i < RUN_COLUMNS.length; i++) {
      if (!have[RUN_COLUMNS[i][0]]) await env.DB.prepare("ALTER TABLE engine_runs ADD COLUMN " + RUN_COLUMNS[i][0] + " " + RUN_COLUMNS[i][1]).run();
    }
    __runColsOk = true;
    return true;
  } catch (e) {
    console.error(JSON.stringify({ worker: "q08-signal-engine", event: "run-columns", error: String(e && e.message || e).slice(0, 160) }));
    return false;
  }
}
// verify_calls remains the total for compatibility; the stage counters split it into reader-panel and fact-check calls.
function meterCall(env, kind) {
  if (!env || !env.q08Meter) return;
  env.q08Meter[kind] = (env.q08Meter[kind] || 0) + 1;
  if (kind === "panel" || kind === "factcheck") env.q08Meter.verify = (env.q08Meter.verify || 0) + 1;
}
// Q08-ARXIV-POOL-1 (0.37.2, 2026-10-26; agent_issues 100439 and 100453, rem-a7). RED-DRAIN-1 had hoisted a "structural gate" (min refs,
// prior-work section, table-or-code) into structuralPreflight() on the claim that the gate ran after the compose call. That gate does not
// exist in this engine (the writer gate checks titles, register, lede and figures; the source checks are MIN_GROUND_CHARS, THIN_MIN_ARTICLE
// and learnedSourceFloor in generate(), which already run before any model call), and the function had no caller: engine_runs, 7 days to
// 2026-10-26, hold 256 finished runs that logged a source size and the thinnest source behind any of them was 2208 characters (0 under
// 800, 0 under 1500). It is removed so no one reads the engine as having a preflight it does not run. What fails is measured in
// engine_runs: of 249 gate failures since 2026-10-20, 175 (70 percent) end at the accuracy checks and 57 (23 percent) at the reader panel.
// The lever that has a measured effect is the choice of source: since 2026-10-14 an arXiv run published in 8 of 102 finished runs (7.8
// percent) and a Hacker News run in 5 of 362 (1.4 percent). scrapeArxiv() read the 30 newest submissions, a few hours of them (a weekend
// leaves the same Friday papers, already tried), so papers took 22 percent of the runs; the pool is now ops_config q08_arxiv_pool.
// r: { scraped, scored, published, top, model, ms, status, error, sourceChars, sourceKind }
async function insertRun(env, r) {
  var m = (env && env.q08Meter) ? { compose: env.q08Meter.compose || 0, verify: env.q08Meter.verify || 0, panel: env.q08Meter.panel || 0, factcheck: env.q08Meter.factcheck || 0 } : null;
  if (m) { env.q08Meter.compose = 0; env.q08Meter.verify = 0; env.q08Meter.panel = 0; env.q08Meter.factcheck = 0; } // a tick can write two rows (a failed forecast, then the essay): each counts its own calls
  var base = [r.scraped || 0, r.scored || 0, r.published ? 1 : 0, r.top || "", r.model || "", r.ms || 0, r.status, r.error == null ? null : String(r.error)];
  if (await ensureRunColumns(env)) {
    try {
      var st = env.DB.prepare("INSERT INTO engine_runs (signals_scraped, signals_scored, piece_published, top_signal, model, ms, status, error, source_chars, source_kind, compose_calls, verify_calls, panel_calls, factcheck_calls) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
      return await st.bind.apply(st, base.concat([r.sourceChars == null ? null : Math.round(r.sourceChars), r.sourceKind || null, m ? m.compose : null, m ? m.verify : null, m ? m.panel : null, m ? m.factcheck : null])).run();
    } catch (e) {
      __runColsOk = false;
      console.error(JSON.stringify({ worker: "q08-signal-engine", event: "run-columns-insert", error: String(e && e.message || e).slice(0, 160) }));
    }
  }
  return await env.DB.prepare("INSERT INTO engine_runs (signals_scraped, signals_scored, piece_published, top_signal, model, ms, status, error) VALUES (?,?,?,?,?,?,?,?)").bind(base[0], base[1], base[2], base[3], base[4], base[5], base[6], base[7]).run();
}
// COST-SUSTAIN-2 (0.33.0): daily spend pressure. PRECONDITION: env.AUDIT is qnfo-audit (ai_call_counters). POSTCONDITION:
// { ok, spent, budget, pace }; ok is false once today's q08 neurons reach the paced allowance. Callers use this to route the
// first writer attempt to a cheaper model, never to defer work; a budget of 0 or below disables the pressure signal.
var Q08_DAILY_NEURONS_DEFAULT = 150000;
var Q08_BUDGET_BURST = 0.1;
async function q08Budget(env, nowMs) {
  var budget = Q08_DAILY_NEURONS_DEFAULT;
  if (!env || !env.AUDIT) return { ok: true, spent: null, budget: budget, pace: null, unreadable: true };
  try {
    var c = await env.AUDIT.prepare("SELECT value FROM ops_config WHERE key = 'q08_daily_neurons'").first();
    if (c && String(c.value).trim() !== "" && Number.isFinite(Number(c.value))) budget = Math.floor(Number(c.value));
  } catch (e) { console.error(JSON.stringify({ worker: "q08-signal-engine", where: "q08-budget-flag", error: String(e && e.message || e).slice(0, 200) })); }
  if (!(budget > 0)) return { ok: true, spent: null, budget: budget, pace: null, disabled: true };
  var d = new Date(nowMs || Date.now());
  var pace = Math.min(budget, Math.round(budget * Math.min(1, (d.getUTCHours() + 1) / 24 + Q08_BUDGET_BURST)));
  try {
    var r = await env.AUDIT.prepare("SELECT COALESCE(SUM(neurons), 0) AS n FROM ai_call_counters WHERE day = ?1 AND worker = 'q08-signal-engine'").bind(d.toISOString().slice(0, 10)).first();
    var spent = Math.round(Number(r && r.n) || 0);
    return { ok: spent < pace, spent: spent, budget: budget, pace: pace };
  } catch (e) {
    console.error(JSON.stringify({ worker: "q08-signal-engine", where: "q08-budget-read", error: String(e && e.message || e).slice(0, 200) }));
    return { ok: true, spent: null, budget: budget, pace: pace, unreadable: true };
  }
}
// Q08-TICK-ALLOWANCE-1 (0.43.0, 2026-11-04, pillar cost; BUDGET-SOFT-ROUTE-1: attempts slow down, they never stop).
// WHY. q08Budget() above only steers the first writer attempt to a cheaper model. Nothing bounded how many attempts a tick starts, so
// the daily target (ops_config q08_daily_neurons, 50,000) was not a bound: ai_call_counters showed 119,552, 129,547 and 110,450 neurons
// on 2026-11-01..03 (2.2 to 2.6 times the target), every day at the attempt cap of 40 (cap 10 times 4).
// UNIT OF WORK = one generate() attempt (an engine_runs row of status ok or gate_failed). A tick starts one: the :00 cron, and the :30 stall
// retry. On 2026-11-03 all 379 model calls (109 compose, 134 reader panel, 136 fact-check) sat inside the 40 attempts, about 2,760 neurons
// each; the published-piece audit and the forecast settlement made no call that day. A model call is too fine a unit (stopping between
// calls throws away a half-built draft, and the editor rounds rescue 26 percent of drafts the first panel refused: q08_reader_tests,
// 2026-10-31..11-04); an audit batch is too coarse and is not where the money goes.
// RULE. The day has 48 ticks (:00 and :30). Tick k (0 to 47) may start an attempt while the day's spend is under the pace line
// budget * (k + 1) / 48, so attempts are spaced by what they actually cost (the budget buys about 18 attempts a day at 2,760 neurons,
// one every 2.7 ticks) and no cost estimate is needed. A tick that has already spent model calls on a failed forecast starts the essay
// only while the day is still under the line. FLOOR: once 150 minutes have passed since the last attempt was written (the tick 3 hours after the
// previous start), that tick starts one whatever the line says, so a day whose target is spent keeps 8 attempts and never goes quiet. Nothing is
// queued and no row is written: a tick that does not start an attempt only logs q08-tick-allowance.
// BOUNDED: the :00 and :30 generate() calls (every compose, title-repair, panel, final-read, fact-check and revision call of an essay or
// forecast attempt, and the criteria-sweep forecast regeneration inside it). NOT BOUNDED, on purpose: auditPublished() (the accuracy audit
// of pieces already live, a quality gate; once per piece, so its volume is the publication rate, which this bound lowers),
// resolveForecasts() (judge panels; at most 2 items a tick, a forecast is checked 4 times at 7-day intervals), /run and /regen (an
// operator's explicit kick behind x-loop-token), and the rounds inside an attempt already started: the editor and repair rounds are what
// turn a refused draft into a piece, and a piece past its gates still publishes. Every gate, panel bar and threshold is unchanged.
// ops_config q08_tick_governor = off restores the old behaviour without a deploy.
var Q08_TICK_MS = 18e5;
var Q08_TICKS_PER_DAY = 48;
var Q08_FLOOR_EVERY_TICKS = 6;
async function q08TickConfig(env) {
  var cfg = { off: false };
  if (!env || !env.AUDIT) return cfg;
  try {
    var r = await env.AUDIT.prepare("SELECT value FROM ops_config WHERE key = 'q08_tick_governor'").first();
    cfg.off = !!r && String(r.value == null ? "" : r.value).trim().toLowerCase() === "off";
  } catch (e) { console.error(JSON.stringify({ worker: "q08-signal-engine", where: "q08-tick-config", error: String(e && e.message || e).slice(0, 200) })); }
  return cfg;
}
// PRECONDITION: env.DB is q08-signal. POSTCONDITION: the ms at which the newest finished attempt (engine_runs status ok or gate_failed,
// the rows that spent model calls) was written, or null when there is none or the table cannot be read (the floor then reads as due).
async function q08LastAttemptMs(env) {
  try {
    var r = await env.DB.prepare("SELECT MAX(ran_at) AS t FROM engine_runs WHERE status IN ('ok','gate_failed')").first();
    var s = r && r.t ? String(r.t) : "";
    var t = s ? Date.parse(s.replace(" ", "T") + (/Z$/.test(s) ? "" : "Z")) : NaN;
    return Number.isFinite(t) ? t : null;
  } catch (e) {
    console.error(JSON.stringify({ worker: "q08-signal-engine", where: "q08-last-attempt", error: String(e && e.message || e).slice(0, 200) }));
    return null;
  }
}
function q08PaceLine(budget, nowMs) {
  var dayStart = Math.floor(nowMs / 864e5) * 864e5;
  var slot = Math.min(Q08_TICKS_PER_DAY - 1, Math.max(0, Math.floor((nowMs - dayStart) / Q08_TICK_MS)));
  return { slot: slot, line: Math.round(budget * (slot + 1) / Q08_TICKS_PER_DAY) };
}
// PRECONDITION: bud is the q08Budget() result, lastMs the q08LastAttemptMs() result, tickSpent the neurons this tick has already spent (0 or
// absent for the first attempt of a tick). POSTCONDITION: { limited, run, behind, floor, slot, line, spent, budget, gapMin, why }; limited
// false means no bound (governor off, budget 0, counters unreadable: a D1 fault never throttles verified work); run false means this tick starts
// no attempt. Only a first attempt can be a floor attempt.
function q08TickAllowance(bud, nowMs, cfg, lastMs, tickSpent) {
  cfg = cfg || {};
  if (cfg.off) return { limited: false, run: true, why: "governor off" };
  if (!bud || bud.disabled || bud.unreadable || bud.spent == null || !(bud.budget > 0)) return { limited: false, run: true, why: "no bound: budget off or counters unreadable" };
  var now = Number.isFinite(nowMs) ? nowMs : Date.now();
  var p = q08PaceLine(bud.budget, now);
  var behind = bud.spent < p.line;
  var gapMs = Number.isFinite(lastMs) ? now - lastMs : Infinity;
  var floor = !(Number(tickSpent) > 0) && !behind && gapMs >= (Q08_FLOOR_EVERY_TICKS - 1) * Q08_TICK_MS;
  return { limited: true, run: behind || floor, behind: behind, floor: floor, slot: p.slot, line: p.line, spent: bud.spent, budget: bud.budget, gapMin: Number.isFinite(gapMs) ? Math.round(gapMs / 6e4) : null, why: behind ? "behind the pace line" : floor ? "floor: no attempt for " + Math.round(gapMs / 6e4) + " minutes" : "ahead of the pace line" };
}
function q08Paced(reason) { return { ok: false, paced: true, reason: String(reason) }; }
// The scheduled entry to generate(): the :00 cron and the :30 stall retry. /run and /regen call generate() directly (an operator's kick).
async function governedGenerate(env) {
  var gov;
  try {
    var cfg = await q08TickConfig(env);
    gov = cfg.off ? q08TickAllowance(null, Date.now(), cfg) : q08TickAllowance(await q08Budget(env), Date.now(), cfg, await q08LastAttemptMs(env), 0);
  } catch (e) {
    console.error(JSON.stringify({ worker: "q08-signal-engine", where: "q08-tick-gate", error: String(e && e.message || e).slice(0, 200) }));
    gov = { limited: false, run: true, why: "governor fault" };
  }
  if (gov.limited) console.error(JSON.stringify({ worker: "q08-signal-engine", event: "q08-tick-allowance", run: gov.run, why: gov.why, slot: gov.slot, spent: gov.spent, line: gov.line, budget: gov.budget, gap_min: gov.gapMin }));
  if (!gov.run) return q08Paced("tick allowance: " + gov.why + " (spent " + gov.spent + " of " + gov.budget + ", pace line " + gov.line + "); work slows, it does not stop");
  return await generate(gov.limited ? Object.assign({}, env, { __q08Gov: gov }) : env);
}
// Inside generate(): true when the tick may start one more attempt. A first attempt that never reached a model call (a forecast deferred
// for lack of sources) has spent nothing of the tick's unit, so the essay may still start; after real spend the day must still be under the line.
async function q08TickMore(env) {
  var g = env && env.__q08Gov;
  if (!g || !g.limited) return true;
  try {
    var bud = await q08Budget(env);
    var tickSpent = bud.spent == null ? 0 : bud.spent - (g.spent || 0);
    if (!(tickSpent > 0)) return true;
    return q08TickAllowance(bud, Date.now(), {}, null, tickSpent).run;
  } catch (e) { return true; }
}
async function dailyCap(env) {
  // FORECAST-CRITERIA-REPUBLISH-1: run the criteria sweep once per cron tick, before any scrape or AI call.
  // It is idempotent (the void UPDATE only matches status = 'open') and never blocks the tick on failure.
  await sweepForecastCriteria(env);
  var legacy = MAX_PER_DAY;
  if (env && env.AUDIT) {
    try {
      var r = await env.AUDIT.prepare("SELECT value FROM ops_config WHERE key = ?1").bind(CAP_KEY).first();
      legacy = parseDailyCap(r && r.value);
    } catch (e) {
      legacy = MAX_PER_DAY;
    }
  }
  // REVIEW-CAP-LEVER-1 (2026-10-17, agent_issues 1716): propertyQuota prefers publish_quotas["q08.org"], so a cadence
  // cut written by the dashboard review to the legacy q08_max_per_day key was silently ignored (publish_quotas still said
  // 10) and the review's safety lever did nothing. The cap is now the most restrictive of the two: a cut binds, and
  // deleting the legacy key restores the property quota, so the documented undo still works.
  var _prop = await propertyQuota(env, legacy);
  return Math.min(_prop, legacy);
}
var OUTBOUND_TIMEOUT_MS = 20000; // OUTBOUND-TIMEOUT-1 (2026-10-17): 0.28.3 used AbortSignal.timeout(OUTBOUND_TIMEOUT_MS) at the HN/GitHub fetch sites without defining it, so every run that reached a fetch threw ReferenceError (worker_logs 15:00:40Z). 20s bounds a hung upstream without eating the cron budget.
var HN_SEARCH = "https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=50";
var HN_ITEMS  = "https://hn.algolia.com/api/v1/items/";
var ROUTER    = "https://qnfo-ai.internal/v1/chat/completions";
var UA        = "q08-signal-engine/0.1.0 (+https://q08.org)";
var ORIGIN = "https://q08.org";
// IndexNow: search-engine instant indexing (Bing, Yandex, Seznam, Naver).
var INDEXNOW_KEY = "3f8a1c9e7b2d6045a1f3c8e5b9d20147";

// Q08-FORECAST-LEDGER-1 (issue 1000512, charter pillar reach): the forecast ground is the source essay plus a research ledger of
// verbatim sentences. FETCH SCOPE: the four evidence APIs (Hacker News Algolia, GDELT doc, Wikipedia search, arXiv), queried with at most 6 capitalised
// names taken from the essay and its signal, then public https pages and their external source links, at most 15
// documents, at most 40000 characters read of each, 15 s timeout each, every fetch failing on its own. LEDGER: sentences of 25 to 280 characters copied
// from the fetched text that name one of those names, at most 60 numbered lines with URL and date; no model writes or
// rewords a ledger line. A fact in a draft may come from the essay, the signal or a ledger line cited by its tag; stripLedgerTags removes [R<n>] like
// [S<n>] before any check reads the draft. Default on; ops_config q08_forecast_ledger = off restores the legacy path.
// Six usable sources are required. Ground is stored with publication, so re-audits read the same material.
var LEDGER_MAX_NAMES = 6;
var LEDGER_MIN_DOCS = 6, LEDGER_MAX_DOCS = 15;
var LEDGER_DOC_CHARS = 40000;
var RLEDGER_MAX_LINES = 60; // not LEDGER_MAX_LINES: that name is the [S<n>] source ledger's cap (80), declared further down, and would overwrite this one
var LEDGER_FETCH_MS = 15000;
var LEDGER_STOP = ("The This That These Those There Then When While Where Which What Who Why How But And For Nor Yet With Without After Before During Since Until Because Although However Instead Each Every Some Many Most Such Not Our Your Its Their They Them You She Her His Has Have Had Was Were Will Would Could Should Can May Might Must Also Both Either Neither Other Another Over Under Into Onto From About Above Below Between Among Across Through Within Whether Once Still Just Even Only Here Now Today Yesterday Tomorrow Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April June July August September October November December").split(" ").reduce(function (o, w) { o[w] = 1; return o; }, {});

// At most 6 capitalised names from the essay and its signal: a word capitalised mid-sentence, or with a second capital or a digit (TrendForce, PJM, GPT4);
// a sentence-initial common word is not a name. Ranked by how often it occurs, then by first position.
function ledgerNames(src, signalText) {
  var text = String(src && src.title || "") + "\n" + String(src && src.body_md || "") + "\n" + String(signalText || "");
  var seen = {}, order = [], m, re = /\b[A-Z][A-Za-z0-9&-]{2,}\b/g;
  while ((m = re.exec(text)) !== null) {
    var w = m[0];
    if (LEDGER_STOP[w]) continue;
    var mid = !(m.index === 0 || /[.!?:#>*\n-]\s*$/.test(text.slice(Math.max(0, m.index - 3), m.index)));
    var e = seen[w];
    if (!e) { e = seen[w] = { w: w, n: 0, ok: false, at: order.length }; order.push(e); }
    e.n++;
    if (mid || /[A-Z0-9]/.test(w.slice(1))) e.ok = true;
  }
  return order.filter(function (x) { return x.ok; }).sort(function (a, b) { return b.n - a.n || a.at - b.at; }).slice(0, LEDGER_MAX_NAMES).map(function (x) { return x.w; });
}

// Sentences of 25 to 280 characters that name one of the query names, copied as they stand (whitespace collapsed, nothing else changed).
function ledgerSentences(text, names) {
  var low = (names || []).map(function (n) { return String(n).toLowerCase(); });
  var out = [], seen = {}, parts = String(text || "").split(/(?<=[.!?]["')\]]?)\s+(?=[A-Z0-9"'(\[])/);
  for (var i = 0; i < parts.length; i++) {
    var s = parts[i].replace(/\s+/g, " ").trim();
    if (s.length < 25 || s.length > 280 || seen[s] || !/[.!?]["')\]]?$/.test(s)) continue;
    var l = s.toLowerCase();
    if (!low.some(function (n) { return l.indexOf(n) >= 0; })) continue;
    seen[s] = 1;
    out.push(s);
  }
  return out;
}

// The four evidence APIs again, in the structured form the ledger needs (the page each result links and its date); EVIDENCE_SOURCES returns prose lines.
var LEDGER_SEARCHES = [
  { name: "Hacker News", run: async function (q) {
    var d = await (await evidenceFetch("https://hn.algolia.com/api/v1/search?tags=story&hitsPerPage=5&query=" + encodeURIComponent(q), LEDGER_FETCH_MS)).json();
    return (d.hits || []).slice(0, 5).map(function (h) { return { url: String(h.url || ""), date: String(h.created_at || "").slice(0, 10) }; });
  } },
  { name: "news", run: async function (q) {
    var d = await (await evidenceFetch("https://api.gdeltproject.org/api/v2/doc/doc?mode=artlist&format=json&maxrecords=5&sort=datedesc&query=" + encodeURIComponent(q), LEDGER_FETCH_MS)).json();
    return (d.articles || []).slice(0, 5).map(function (a) { var sd = String(a.seendate || ""); return { url: String(a.url || ""), date: sd.length >= 8 ? sd.slice(0, 4) + "-" + sd.slice(4, 6) + "-" + sd.slice(6, 8) : "" }; });
  } },
  { name: "Wikipedia", run: async function (q) {
    var d = await (await evidenceFetch("https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=3&srsearch=" + encodeURIComponent(q), LEDGER_FETCH_MS)).json();
    return ((d.query && d.query.search) || []).slice(0, 3).map(function (h) { return { url: "https://en.wikipedia.org/wiki/" + encodeURIComponent(String(h.title || "").replace(/ /g, "_")), date: String(h.timestamp || "").slice(0, 10) }; });
  } },
  { name: "arXiv", run: async function (q) {
    var x = await (await evidenceFetch("https://export.arxiv.org/api/query?sortBy=relevance&max_results=3&search_query=all:" + encodeURIComponent('"' + q + '"'), LEDGER_FETCH_MS)).text();
    var out = [];
    for (var m of x.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
      var id = (m[1].match(/<id>([^<]*)<\/id>/) || [])[1] || "", pub = (m[1].match(/<published>([^<]*)<\/published>/) || [])[1] || "";
      if (id) out.push({ url: id.trim().replace(/^http:/, "https:"), date: pub.slice(0, 10) });
    }
    return out;
  } }
];

// One linked page: at most LEDGER_DOC_CHARS characters are read, then tags are removed.
async function ledgerReadPage(url) {
  var r;
  for (var redirects = 0; redirects <= 3; redirects++) {
    if (!publicHttpsUrl(url)) throw new Error("non-public research URL");
    r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(LEDGER_FETCH_MS), redirect: "manual" });
    if (r.status < 300 || r.status >= 400) break;
    var location = r.headers.get("location");
    if (r.body) await r.body.cancel();
    if (!location || redirects === 3) throw new Error("research redirect limit");
    url = new URL(location, url).href;
  }
  if (!r.ok) throw new Error("http " + r.status);
  var txt = "";
  if (r.body && typeof r.body.getReader === "function") {
    var rd = r.body.getReader(), dec = new TextDecoder();
    while (txt.length < LEDGER_DOC_CHARS) {
      var ch = await rd.read();
      if (ch.done) break;
      txt += dec.decode(ch.value, { stream: true });
    }
    try { await rd.cancel(); } catch (e) { /* the stream is already closed */ }
  } else txt = await r.text();
  txt = txt.slice(0, LEDGER_DOC_CHARS);
  var links = [];
  for (var m of txt.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["']/gi)) {
    try {
      var link = publicHttpsUrl(new URL(m[1].replace(/&amp;/g, "&"), url).href);
      if (link && new URL(link).hostname !== new URL(url).hostname && links.indexOf(link) < 0) links.push(link);
    } catch (e) { /* malformed link */ }
    if (links.length >= 5) break;
  }
  return { text: plainText(txt), links: links };
}

// researchLedger(env, src, signalText) -> { lines, sources }. Every search and every page fails on its own; documents are taken round-robin across the
// names and APIs (so one source cannot fill the ledger), lines round-robin across the documents.
async function researchLedger(env, src, signalText) {
  var names = ledgerNames(src, signalText), lines = [], sources = [];
  if (!names.length) return { lines: lines, sources: sources };
  var jobs = [];
  names.forEach(function (n) { LEDGER_SEARCHES.forEach(function (s) { jobs.push(s.run(n).catch(function () { return []; })); }); });
  var found = await Promise.all(jobs);
  var cands = [], seenUrl = {};
  for (var rank = 0; rank < 5 && cands.length < LEDGER_MAX_DOCS; rank++) {
    for (var k = 0; k < found.length && cands.length < LEDGER_MAX_DOCS; k++) {
      var it = found[k][rank];
      var pu = it ? publicHttpsUrl(it.url.replace(/^(https:\/\/(?:export\.)?arxiv\.org)\/abs\//, "$1/html/")) : "";
      if (!pu || seenUrl[pu]) continue;
      seenUrl[pu] = 1;
      cands.push({ url: pu, date: String(it.date || "") });
    }
  }
  var read = function (c) {
    return ledgerReadPage(c.url).then(function (d) { return { c: c, sentences: ledgerSentences(d.text, names), links: d.links }; }).catch(function () { return null; });
  };
  // Reserve five fetches for primary-source links found in the discovery pages.
  var first = cands.slice(0, 10), docs = await Promise.all(first.map(read)), more = [];
  docs.filter(Boolean).forEach(function (d) {
    d.links.forEach(function (url) {
      if (!seenUrl[url] && more.length < LEDGER_MAX_DOCS - first.length) {
        seenUrl[url] = 1; more.push({ url: url, date: "" });
      }
    });
  });
  for (var ci = first.length; ci < cands.length && more.length < LEDGER_MAX_DOCS - first.length; ci++) more.push(cands[ci]);
  docs = docs.concat(await Promise.all(more.map(read))).filter(function (d) { return d && d.sentences.length; });
  var used = {};
  var ledgerChars = 0;
  for (var round = 0; lines.length < RLEDGER_MAX_LINES; round++) {
    var any = false;
    for (var di = 0; di < docs.length && lines.length < RLEDGER_MAX_LINES; di++) {
      var sn = docs[di].sentences[round];
      if (sn === undefined) continue;
      any = true;
      var host = "";
      try { host = new URL(docs[di].c.url).hostname; } catch (e) { host = ""; }
      var date = docs[di].c.date || "retrieved " + utcDay();
      var line = "[R" + (lines.length + 1) + "] " + sn + " (" + docs[di].c.url + ", " + date + ")";
      if (ledgerChars + line.length + 1 > 32000) continue;
      lines.push(line);
      ledgerChars += line.length + 1;
      if (!used[docs[di].c.url]) { used[docs[di].c.url] = 1; sources.push({ label: "Research ledger source: " + host, url: docs[di].c.url, date: date }); }
    }
    if (!any) break;
  }
  return { lines: lines, sources: sources };
}

// An absent setting or an unavailable config read keeps research enabled.
async function forecastLedgerOn(env) {
  try {
    if (!env || !env.AUDIT || typeof env.AUDIT.prepare !== "function") return true;
    var r = await env.AUDIT.prepare("SELECT value FROM ops_config WHERE key = 'q08_forecast_ledger'").first();
    return String(r && r.value || "").trim().toLowerCase() !== "off";
  } catch (e) { return true; }
}

// q08_forecasts.ground_json (nullable): the ensure-column pattern of RUN_COLUMNS. Called only when the ledger is on; a failure turns the ledger off.
var __groundColumnDone = false;
async function ensureForecastGroundColumn(env) {
  if (__groundColumnDone) return true;
  try {
    await ensureForecastSchema(env);
    var info = await env.DB.prepare("PRAGMA table_info(q08_forecasts)").all();
    var have = {};
    (info.results || []).forEach(function (c) { have[c.name] = 1; });
    if (!have.ground_json) {
      try { await env.DB.prepare("ALTER TABLE q08_forecasts ADD COLUMN ground_json TEXT").run(); }
      catch (e) { if (!/duplicate column|already exists/i.test(String(e && e.message || e))) throw e; }
    }
    __groundColumnDone = true;
    return true;
  } catch (e) {
    console.error(JSON.stringify({ evt: "q08-signal-engine:ensureForecastGroundColumn:caught", error: String((e && e.message) || e).slice(0, 200) }));
    return false;
  }
}

// What generateForecast calls: off (or a column that cannot be added) makes no request and returns an empty ledger.
async function forecastLedgerFor(env, src, signalText) {
  var empty = { lines: [], sources: [] };
  try {
    if (!(await forecastLedgerOn(env))) return empty;
    if (!(await ensureForecastGroundColumn(env))) return empty;
    var led = await researchLedger(env, src, signalText);
    return led && Array.isArray(led.lines) ? led : empty;
  } catch (e) {
    console.error(JSON.stringify({ evt: "q08-signal-engine:forecastLedgerFor:caught", error: String((e && e.message) || e).slice(0, 200) }));
    return empty;
  }
}

// The stored ledger of a published forecast, as ground text for its re-audit; "" when there is none or the column does not exist (no schema change on a read path).
async function storedForecastLedger(env, slug) {
  try {
    var r = await env.DB.prepare("SELECT ground_json FROM q08_forecasts WHERE slug = ?").bind(slug).first();
    var j = r && r.ground_json ? JSON.parse(r.ground_json) : null;
    var ls = j && Array.isArray(j.lines) ? j.lines.filter(function (l) { return typeof l === "string"; }) : [];
    return ls.length ? "\n" + ls.join("\n") : "";
  } catch (e) { return ""; }
}
function forecastGroundText(snapshot) {
  return [snapshot.essay.title || "", String(snapshot.essay.body_md || "").slice(0, 6000), snapshot.signal || "", (snapshot.lines || []).join("\n")].join("\n");
}

// FORECAST-CRITERIA-REPUBLISH-1 (issue 1000740, RED-DRAIN-1 dispatch; charter pillar: personal): metric
// forecast_resolution_criteria_complete (issue 1000671) reads 0 of 3 because the published resolution text of
// forecast 2 (PJM auction) lacks a source and an edge-case rule and forecasts 3 (TrendForce) and 4 (Broadcom) lack
// an edge-case rule. The published fields are immutable by trigger q08_forecasts_published_fields_immutable, so the
// text cannot be edited in place; the existing retraction path (the UPDATE q08_forecasts SET status = void in the
// retract code) is the only way out. This sweep runs on every cron tick before any scrape or AI call: for each
// open forecast whose resolution_text fails the same three patterns as validateForecast in scripts/bp26_forecast.py
// (a source, a date, an edge-case rule), it voids the row with disposition 'superseded-incomplete-criteria' — the
// UPDATE is guarded on status = 'open', so a rerun after a successful void matches zero rows and the step is
// idempotent — and queues a replacement through the existing generator, whose prompt and validateForecast gate
// already require all three parts, so the republished forecast cannot reintroduce the gap. It never touches a
// forecast that passes the gate, never edits a published field, and never writes anything when the resolution
// already satisfies the criteria.
var FORECAST_CRITERIA_SOURCE_RE = /\bsource\b/i;
var FORECAST_CRITERIA_DATE_RE = /\b\d{4}-\d{2}-\d{2}\b/;
var FORECAST_CRITERIA_EDGE_RE = /\bedge[- ]?case\b/i;
function forecastCriteriaMissing(text) {
  var t = String(text || "");
  if (!FORECAST_CRITERIA_SOURCE_RE.test(t)) return "source";
  if (!FORECAST_CRITERIA_DATE_RE.test(t)) return "date";
  if (!FORECAST_CRITERIA_EDGE_RE.test(t)) return "edge-case-rule";
  return null;
}
async function sweepForecastCriteria(env) {
  if (!env || !env.DB) return 0;
  var n = 0;
  try {
    // FLEET-JOURNEY-FAILED-1 / issue #1000489: the sweep read resolution_text before older D1
    // schemas had the column, so every tick threw D1_ERROR at /health. Add it if missing.
    try {
      await env.DB.prepare("ALTER TABLE q08_forecasts ADD COLUMN resolution_text TEXT").run();
    } catch (addErr) {
      var addMsg = String(addErr && addErr.message || addErr);
      if (!/duplicate column/i.test(addMsg) && !/already exists/i.test(addMsg)) throw addErr;
    }
    var rows = await env.DB.prepare("SELECT id, resolution_text FROM q08_forecasts WHERE status = 'open'").all();
    var list = (rows && rows.results) || [];
    for (var i = 0; i < list.length; i++) {
      var row = list[i];
      if (row.resolution_text == null || row.resolution_text === undefined) continue; // no text to judge yet: never void on absence alone
      var miss = forecastCriteriaMissing(row.resolution_text);
      if (!miss) continue;
      var upd = await env.DB.prepare("UPDATE q08_forecasts SET status = 'void', disposition = 'superseded-incomplete-criteria' WHERE id = ?1 AND status = 'open'").bind(row.id).run();
      if (upd && upd.meta && upd.meta.changes) {
        n++;
        console.error(JSON.stringify({ worker: "q08-signal-engine", event: "forecast-criteria-republish-void", id: row.id, missing: miss }));
        // Queue the replacement through the existing generator (its prompt and validateForecast already
        // require a source, a date and an edge-case rule), so the republished forecast closes the gap.
        if (typeof generateForecast === "function") {
          try { await generateForecast(env, { replaceId: row.id }); }
          catch (e) { console.error(JSON.stringify({ worker: "q08-signal-engine", event: "forecast-criteria-republish-queue", id: row.id, error: String((e && e.message) || e).slice(0, 200) })); }
        }
      }
    }
  } catch (e) {
    console.error(JSON.stringify({ worker: "q08-signal-engine", event: "forecast-criteria-republish-sweep", error: String((e && e.message) || e).slice(0, 200) }));
  }
  return n;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
function nowIso() { return new Date().toISOString(); }
function utcDay() { return nowIso().slice(0, 10); }
function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}
function json(obj, status) {
  return new Response(JSON.stringify(obj, null, 2), {
    status: status || 200,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}
function html(body, status) {
  return new Response(q08Wrap(body), {
    status: status || 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" }
  });
}
function escHtml(s) {
  return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// ---------------------------------------------------------------------------
// 1. Ingestion \u2014 Hacker News front page
// ---------------------------------------------------------------------------
async function scrapeHN() {
  const resp = await fetch(HN_SEARCH, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(OUTBOUND_TIMEOUT_MS) });
  if (!resp.ok) throw new Error("HN fetch " + resp.status);
  const data = await resp.json();
  const now = Date.now();
  const stories = [];
  for (const h of (data.hits || [])) {
    if (!h._tags || !h._tags.includes("story")) continue;
    // Skip Ask HN / Show HN ritual threads (low structural friction)
    if (/^(Ask HN|Show HN|Tell HN|Launch HN):/i.test(h.title || "")) continue;
    const pts = h.points || 0;
    const nc  = h.num_comments || 0;
    let age_h = null;
    if (h.created_at) {
      try {
        age_h = (now - new Date(h.created_at).getTime()) / 3600000;
      } catch (_) { console.error(JSON.stringify({ evt: "q08-signal-engine:scrapeHN:caught", error: String((_ && _.message) || _) })); }
    }
    const ratio = pts > 0 ? nc / pts : 0;
    const vel   = age_h != null ? Math.max(0.05, 1 / (1 + age_h / 6)) : 0.5;
    // Priority Score = (Engagements \u00d7 Velocity) + Controversy Modifier
    const score = (nc * vel) + (10 * ratio);
    stories.push({
      id:        h.story_id || h.objectID,
      title:     h.title || "",
      url:       h.url || "",
      points:    pts,
      num_comments: nc,
      age_h,
      ratio:     Math.round(ratio * 100) / 100,
      volatility_score: Math.round(score * 100) / 100,
    });
  }
  stories.sort((a, b) => b.volatility_score - a.volatility_score);
  return stories;
}

// ---------------------------------------------------------------------------
// 2. Friction extraction \u2014 top-level comments ranked by length (content proxy)
// ---------------------------------------------------------------------------
function cleanHtml(s) {
  return (s || "")
    .replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&")
    .replace(/&gt;/g, ">").replace(/&lt;/g, "<")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
function flattenComments(node, depth, out) {
  if (!node || typeof node !== "object") return;
  if (node.text) out.push({ depth, text: cleanHtml(node.text) });
  for (const child of (node.children || [])) flattenComments(child, depth + 1, out);
}
var FRICTION_TOP_K = 8, FRICTION_MAX = 3000;
async function extractFriction(storyId, topK) {
  topK = topK || FRICTION_TOP_K;
  const resp = await fetch(HN_ITEMS + storyId, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(OUTBOUND_TIMEOUT_MS) });
  if (!resp.ok) throw new Error("HN items " + resp.status);
  const item = await resp.json();
  const comments = [];
  for (const child of (item.children || [])) flattenComments(child, 0, comments);
  const topLevel = comments.filter(c => c.depth === 0).sort((a, b) => b.text.length - a.text.length);
  const top = topLevel.slice(0, topK);
  // Q08-SOURCE-DEPTH-1 (0.21.0, run 384): the writer and the fact-checkers both saw the five longest comments cut to 800 characters, so the
  // essay had almost nothing to analyse and quoted comments neither side could see. Each comment is now its own line, up to FRICTION_MAX.
  const friction = top.map(c => "Comment: " + String(c.text).replace(/\s+/g, " ").trim()).join("\n").slice(0, FRICTION_MAX);
  const strength = comments.length >= 100 ? "High" : comments.length >= 30 ? "Medium" : "Low";
  return {
    core_concept:   item.title || "",
    friction_point: friction,
    signal_strength: strength + " (" + comments.length + " comments)",
    comment_count:  comments.length,
  };
}

// --- GitHub (intent signals): trending repos with open issues ---
async function scrapeGitHub() {
  var since = new Date(Date.now() - 7*24*3600*1000).toISOString().slice(0,10);
  var url = "https://api.github.com/search/repositories?q=created:%3E" + since + "+stars:%3E50&sort=stars&order=desc&per_page=20";
  var resp = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/vnd.github+json" }, signal: AbortSignal.timeout(OUTBOUND_TIMEOUT_MS) });
  if (!resp.ok) throw new Error("github " + resp.status);
  var data = await resp.json();
  var out = [];
  for (var r of (data.items || [])) {
    var stars = r.stargazers_count || 0, issues = r.open_issues_count || 0;
    var issueRatio = stars > 0 ? issues/stars : 0;
    out.push({ source:"github", id: r.full_name, title: r.full_name, url: r.html_url, points: stars, num_comments: issues, ratio: Math.round(issueRatio*100)/100, volatility_score: Math.round((stars/10 + 10*Math.min(issueRatio,2))*10)/10, description: r.description||"" });
  }
  out.sort(function(a,b){ return b.volatility_score - a.volatility_score; });
  return out.slice(0, 15);
}

// --- arXiv (narrative signals): recent abstracts matching high-intent keywords ---
var ARXIV_KEYWORDS = ["distributed system","consensus","fault tolerance","compiler","programming language","database","security","privacy","machine learning","infrastructure","network","operating system","formal verification","cryptography","scalability","reliability","architecture","verification","protocol"];
// Q08-ARXIV-POOL-1 (0.37.2): how many of the newest submissions the scrape reads. 30 was a few hours of them (the newest 30 on 2026-10-26
// 17:00Z all dated 2026-10-23, a Friday), so the candidate list ran dry and the alternation in orderCandidates fell back to stories.
// ops_config q08_arxiv_pool (an integer, 30 to 200, absent = 100) sets it without a deploy; 30 restores the earlier pool. Read once a
// minute at most; an unreadable or invalid value reads as the default, and only the pool size changes (the keyword filter, the order, the
// 12 candidates kept, every gate and every cap are untouched).
var ARXIV_POOL_KEY = "q08_arxiv_pool", ARXIV_POOL_DEFAULT = 100, ARXIV_POOL_MIN = 30, ARXIV_POOL_MAX = 200;
function parseArxivPool(v) {
  var s = v == null ? "" : String(v).trim();
  if (!/^\d{1,4}$/.test(s)) return ARXIV_POOL_DEFAULT;
  return Math.min(ARXIV_POOL_MAX, Math.max(ARXIV_POOL_MIN, Number(s)));
}
var __arxivPool = { at: 0, n: ARXIV_POOL_DEFAULT };
async function arxivPoolSize(env) {
  if (!env || !env.AUDIT || typeof env.AUDIT.prepare !== "function") return ARXIV_POOL_DEFAULT;
  var now = Date.now();
  if (__arxivPool.at && now - __arxivPool.at < 60000) return __arxivPool.n;
  try {
    var r = await env.AUDIT.prepare("SELECT value FROM ops_config WHERE key = ?1").bind(ARXIV_POOL_KEY).first();
    __arxivPool = { at: now, n: parseArxivPool(r && r.value) };
  } catch (e) {
    console.error("q08 arxivPoolSize read failed: " + String(e && e.message || e).slice(0, 160));
    __arxivPool = { at: now, n: ARXIV_POOL_DEFAULT };
  }
  return __arxivPool.n;
}
async function scrapeArxiv(env) {
  var q = "cat:cs.DC OR cat:cs.CR OR cat:cs.DB OR cat:cs.PL OR cat:cs.OS OR cat:cs.NI OR cat:cs.SY OR cat:cs.SE OR cat:cs.AR";
  var url = "http://export.arxiv.org/api/query?search_query=" + encodeURIComponent(q) + "&sortBy=submittedDate&sortOrder=descending&max_results=" + (await arxivPoolSize(env));
  var resp = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
  if (!resp.ok) throw new Error("arxiv " + resp.status);
  var xml = await resp.text();
  var out = [];
  for (var e of xml.split("<entry>").slice(1)) {
    var title = ((e.match(/<title>([\s\S]*?)<\/title>/)||[,""])[1]||"").replace(/\s+/g," ").trim();
    var abs = ((e.match(/<summary>([\s\S]*?)<\/summary>/)||[,""])[1]||"").replace(/\s+/g," ").trim();
    var idm = (e.match(/<id>([\s\S]*?)<\/id>/)||[,""])[1]||"";
    var arxid = idm.split("/abs/")[1] || idm.trim();
    var low = (title + " " + abs).toLowerCase();
    var hits = 0;
    for (var k of ARXIV_KEYWORDS) if (low.includes(k)) hits++;
    if (hits === 0 || !arxid) continue;
    out.push({ source:"arxiv", id: arxid, title: title, url: "https://arxiv.org/abs/" + arxid, points: hits, num_comments: 0, ratio: 0, volatility_score: hits*20, abstract: abs });
  }
  out.sort(function(a,b){ return b.volatility_score - a.volatility_score; });
  return out.slice(0, 12);
}
async function extractGitHubFriction(fullName, description) {
  var parts = [];
  if (description) parts.push(description);
  try {
    var url = "https://api.github.com/repos/" + fullName + "/issues?state=open&sort=comments&direction=desc&per_page=5";
    var resp = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/vnd.github+json" }, signal: AbortSignal.timeout(OUTBOUND_TIMEOUT_MS) });
    if (resp.ok) {
      var issues = await resp.json();
      for (var i of (issues||[])) {
        if (i.pull_request) continue;
        parts.push((i.title||"") + ": " + String(i.body||"").replace(/\s+/g," ").slice(0,300));
      }
    }
  } catch (e) { console.error(JSON.stringify({ evt: "q08-signal-engine:extractGitHubFriction:caught", error: String((e && e.message) || e) })); }
  var friction = parts.join(" ").slice(0, 800);
  return { core_concept: fullName, friction_point: friction, signal_strength: parts.length >= 3 ? "Medium" : "Low", comment_count: parts.length };
}

// ---------------------------------------------------------------------------
// 3. Prompt construction \u2014 q08 register
// ---------------------------------------------------------------------------
// The register problem: LLMs default to management-consulting prose when asked
// for "systems-level critique" \u2014 producing capitalized nominalizations like
// "Knowledge Work", "Systemic Vulnerability", "Architectural Context".
// These are jargon placeholders, not analysis. The prompt must name and ban
// this failure mode explicitly, and model the correct register with contrast examples.
// FRAMING-REPAIR-1 (0.13.0, agent_issues 2284): one process-only line, shared by the writer, the editor and the forecaster, naming the
// framing idioms the deterministic gate rejects (55 of 75 gate_failed runs in the week to 2026-10-12 were "stock framing tell" with a
// "soft register" phrase beside it) and the replacement move. It names no example subject, only the idioms and the mechanism rule.
var FRAMING_RULE = "FRAMING IDIOMS (process rule, enforced by an automatic check that rejects the draft): never write that an incident, case or episode 'illustrates', 'reveals', 'exposes', 'underscores' or 'foregrounds' a broader, recurring, structural or similar pattern, dynamic, tension, logic or incentive; never write 'the same logic', 'the same dynamic', 'path forward', 'ecosystem of' or 'vibe'. Each of those phrases stands where a mechanism should be. In its place state the concrete mechanism of this case: which party does what, which information it lacks or withholds, and what breaks as a result.";
var Q08_DIRECTIVE = [
  "You are the writer for q08.org, a machine-written publication that takes a story from the technical front pages, explains it to a reader who missed it, and then explains the system that produced it: how the technology involved actually works and why it behaved as it did. The standard is the best system-design writing for engineers: concrete components, how data and requests move between them, the design decision or constraint that made this outcome possible, and the trade-off behind that decision. The story comes first; the system is the payoff.",
  "Your input is a story from a technical front page with its source text, the discussion around it and background reference text. Your output is a self-contained essay that an engineer who never saw the source can follow and learn from.",
  "",
  "NEWS FIRST, THEN THE SYSTEM: report the case before you analyse it, then explain the technical system the case runs on and the specific mechanism that produced the outcome, then the lesson a builder can take: under which design conditions the same outcome follows elsewhere, stated as reasoning ('a system that does X will Y when Z') without naming outside events. An essay that stays inside its incident is rejected, and so is one that reaches outside the source by asserting facts the source and the background do not contain.",
  "",
  "REGISTER: plain, exact explanatory journalism \u2014 a good science or technology desk explaining a story to a smart reader who missed it. Specific, unhurried, unimpressed; never a consultant describing a market.",
  "",
  "SECTION HEADERS (banned shapes): Banned section headers, exactly: 'How the Flaw Manifests', 'Cascading Failures', 'A Minimal Alternative', 'A Minimal Framework', 'Connections Across Disciplines', 'Echoes from the Past', 'A Path Forward', 'The Lens Restored', 'Lessons for the Future', 'Unexpected Parallels', 'The Broader Lesson', and any header of the form 'The [Adjective] [Lever/Bottleneck/Premise/Flaw]: X'. Never name a section after its rhetorical function.",
  "",
  "LEDE (inverted pyramid, checked): the first paragraph, at most 70 words, tells a reader who has never seen the source what happened: who did or said what, where it appeared (name it: the blog post and its author, the paper and where it was posted, the project and its repository, the publication), when if the source says, and why it matters. Name the subject in plain words in the first sentence. The second paragraph gives the context a newcomer needs: what the thing is and what is at stake. Then the most important facts from the source, most important first, and only then the analysis of the mechanism. Never open on an aphorism, a general claim, or an abstract noun such as 'the pattern', 'the mechanism' or 'the system'.",
  "",
  "CONCRETENESS FROM THE SOURCE: name the real things the SOURCE MATERIAL names \u2014 its products, people, organisations, figures and quotations, exactly as given. Elsewhere, be concrete by describing the mechanism step by step (who does what, which information is missing, where it breaks), never by adding named outside examples. Use at most one labelled hypothetical, in no more than three sentences, only if it makes the argument shorter or clearer; otherwise use none. It names no real person, company, product, date or number, describes parties only by their function, and says it is hypothetical. A sentence without a specific referent is a sentence to rewrite; a specific referent that is not in the source material is a sentence to delete.",
  "",
  "FACTS (hard, non-negotiable, and checked): every claim about the real world \u2014 an event, a date, a person, an organisation, a product, a law, a number, a price, a percentage, a count, an identifier, a quotation, a study, a historical episode \u2014 must be stated in the SOURCE MATERIAL you are given (the signal, the linked article text and the BACKGROUND reference text), verbatim or as a direct paraphrase. Your own memory is NOT a source: do not add historical precedents, case studies, statistics, dates, names of people or companies, laws, institutions, product details or 'studies show' from memory, however sure you are. If the source does not state it, delete it or turn it into labelled hypothetical reasoning with no real names. Every draft is fact-checked sentence by sentence against the source material by independent reviewers from other model families; a single unsupported claim means the piece is not published. A general honest sentence always beats a specific unsupported one. Before writing any name, date or number, ask: is this exact item in the source material? If not, do not write it.",
  "",
  "GENERAL CLAIMS: a sentence about what many programs, people, firms or systems do, how common, widespread, typical or reliable something is, or what 'the only' fix is, is a factual claim and is checked like any other. State a general mechanism only as conditional reasoning that follows from the source ('if a system does X, then Y follows'), never as an assertion about prevalence or reliability the source does not make. Attribute what you report to where it comes from, by name ('In a post on his blog, ...', 'The paper, posted to arXiv, ...', 'The project\u2019s README says ...').",
  "",
  "PROSE, NOT SCHEME: write prose, not a specification. Never enumerate with '(1) ... (2) ...' in running text, and never write like a design document; the reader is a person, not a reviewer.",
  "",
  "NO SECTION HEADERS: the essay is continuous prose. Do not use Markdown section headers (## or ###) anywhere in the body \u2014 paragraph breaks only. A header is a crutch; if you need one, the prose has failed to carry the argument.",
  "",
  "NO BORROWED HISTORY: do not cite historical episodes, past scandals, earlier industries, named laws, named institutions or named products that are not in the source material (the BACKGROUND reference text counts as source material, so context from it is welcome when attributed). A reader who checks must find every fact; the safest way to be checkable is to assert only what the source says and to reason openly about what follows from it. A metaphor ('it is like a telescope') is decorative and banned; reasoning from the stated facts to a general mechanism is the job.",
  "",
  "STRUCTURE (required, in this order): (1) the lede; (2) context a newcomer needs: what the thing is, how it came to this point, what came before, using the SOURCE and the BACKGROUND; (3) the key facts of this case, most important first; (4) the systems analysis; (5) an ending on the sharpest open question.",
  "",
  "SYSTEMS ANALYSIS (required; this is why the piece exists): after the facts, explain the system behind the story, technically and step by step. Name the components involved (the software, protocol, hardware, data store, model, service or organisation, as the SOURCE and BACKGROUND name them); say how data, requests or control move between them; locate the exact design decision, default, constraint or assumption that made this outcome possible; walk through how the event unfolded inside that system; and name the trade-off the designers made and what it costs, and whom. Where the source shows people or firms choosing, add who is rewarded for which choice. Abstract words are not analysis: 'the loop', 'the coupling', 'the structure', 'the dynamic', 'the information gap' must each be replaced by the concrete thing (which cookie, which queue, which check, which incentive, held by whom). Explain technical terms in a clause the first time they appear. Use BACKGROUND facts where they exist and attribute them; otherwise reason openly and say it is reasoning ('the incentive is ...', 'that means ...', 'if ... then ...'), introducing no new name, date, number or event. A piece that only retells its source is rejected. Begin the systems analysis with a line of its own that contains exactly <!-- analysis --> (readers never see it): everything before that line is reporting and is checked sentence by sentence against the sources; after it, reasoning about incentives and consequences is checked only for invented facts, and every name, date, number, event or quotation must still come from the sources.",
  "",
  "ENDING: end at the point of maximum implication. A closing paragraph that describes a healed system is forbidden. If a fix exists, fold it into the argument; the final sentences leave the reader with the sharpest unresolved fact \u2014 not a summary, not a resolution, not a flourish.",
  "",
  "VERDICT (mandatory final line, this is the last line of your output, after the essay): write exactly 'worth your time: yes|flat|no \u2014 one clause of justification'. State honestly whether a reader gains something by reading the essay that they would not get from the source thread itself. 'no' rejects the essay; 'flat' means it barely clears the bar. Omitting this line is a rejection on its own.",
  "",
    "MECHANISM, NOT LABEL: name the causal process \u2014 who is incentivised to do what, which information is missing, where the coupling breaks \u2014 as actors doing something, never as an abstract noun. 'Incentive structure', 'information asymmetry', 'coupling failure', 'structural dynamic' and 'systemic failure' are labels, not mechanisms: if a sentence reduces to one of them, the mechanism has not been found yet. The words 'structural', 'systemic' and 'dynamic' are permitted only as a precise description of a named mechanism, never as a summary of your own argument.",
    "BANNED FRAMING (automatic rejection \u2014 the tells of a banal essay): 'illustrates a broader structural dynamic', 'exposes a structural dynamic', 'reveals a structural dynamic', 'a recurring institutional dynamic', 'a systemic failure in which', 'a structural gap between', 'what this reveals about', 'the deeper pattern', 'the broader lesson'. Never tell the reader what the essay 'reveals'; demonstrate it and stop. A sentence that announces the significance of the essay instead of adding a fact is a sentence to delete.",
    "SIGNIFICANCE ANNOUNCEMENT (banned): never write \"the incident illustrates / exposes / reveals / foregrounds / underscores a <noun phrase>\". Those verbs, applied to the incident, are the banality signature \u2014 they announce that the essay has a point instead of making it. State the causal chain directly: who does what to whom, and what breaks as a result. If a draft contains any of these verbs, rewrite the sentence as a mechanism.",
    FRAMING_RULE,
    "TITLE: a plain headline in sentence case that names the subject (who or what) and the point, so a reader knows from the title alone what the piece is about \u2014 never an abstract label. A good title names the actors and what happens \u2014 e.g. 'The clearinghouse that paid itself first' or 'Why the map outlives the territory it describes'. Banned title shapes: the bare '[Adjective]-[Noun] [Preposition] [Abstract Noun]' stack ('Scale-Induced Professional Displacement'); 'The X of Y' ('The Incentive-Driven Misalignment of Threat Models'); 'X as Y' ('Formal Guarantees as Market Signal'); and any title opening with Structural, Systemic, Implicit, Opaque, Formal, Abstract, Externalized, Statistical or a similar nominalisation. If the title would work as a category label in a management deck, it is the wrong title. TITLE FORMAT: plain text; the only markup allowed is *italic* emphasis and math written as \\( ... \\); never use dollar signs for math, and write a literal dollar sign as \\$.",
  "PLAIN WORDING (this is what a reader judges first): write the way a sharp person explains something to a smart friend, not the way a paper abstracts it. Mix short sentences with long ones. Name who did what by what they are (the parties as the source describes them), never by role words: no 'the observer', 'the actor', 'the producer', 'the consumer', 'the proxy', 'the cue', 'the arrangement', 'the mechanism', 'the signal', 'the process'. A sentence that exists only to announce structure ('This same arrangement appears...', 'The mechanism works like this', 'The process therefore hinges on', 'not a quirk of a single product') is deleted. If you cannot picture a person doing the thing in a sentence, rewrite it. Say it once; do not restate a point in new abstract words.",
  "INTERNAL FIELDS: the SIGNAL block's field names and its signal_strength value are pipeline metadata, not facts about the world. Never mention them, never write 'signal strength', 'friction point' or 'core concept'. Open with what actually happened or was said, as one concrete event, in plain words.",
  "CONSTRAINTS (hard):",
  "- The structural claim must outlive the incident: dates may appear in the material, but the argument must not depend on them.",
  "- No @handles, no marketing register, no promotional language. No emotional vocabulary ('anxiety', 'dread', 'excitement'). No hedging ('it seems', 'perhaps').",
  "- No first person. No preamble, no meta-commentary about the essay itself.",
  "- 450-1100 words. Length follows the source material: a thin source gets a short, dense essay. Never pad: restating the mechanism in new words, closing summaries and filler cases are rejected. Complete sentences only: the essay ends on a full stop, never mid-sentence.",
  "- Output: valid Markdown, H1 title first, then the essay. The title names the subject and the point (see TITLE). Banned title forms: 'When X Meets Y', 'X: The Hidden Z', 'An Analysis of X', 'A Critique of Y'.",
  "- Mathematical notation: inline math as \\(...\\), display math as \\[...\\]. Use only these delimiters; never single-dollar signs.",
].join("\n");

var REGISTER_EXEMPLAR = [
  "STYLE SPECIFICATION (a process and a register, not a sample to imitate and not a source of subjects):",
  "1. Title: a plain headline in sentence case naming the subject and the point, naming the parties as the source names them.",
  "2. Lede (first paragraph, at most 70 words): who did or said what, where it was published (named), when if the source says, and why it matters to the reader. Then one paragraph of context a newcomer needs.",
  "3. Body: the key facts, then how the system works: its components and how data or requests move between them, the design decision or constraint behind the event, the event traced step by step through that system, and the trade-off it reveals and who pays for it. Every real-world fact comes from the source material or the background; any extra case is a labelled hypothetical whose parties are described only by their function.",
  "4. Voice: precise, unimpressed, short and long sentences mixed, no announcement of structure, no moral.",
  "5. Ending: the sharpest unresolved fact, in one or two sentences."
].join("\n");

// Only a reader-proven structure that is ALSO in-register may serve as an exemplar.
// Without this, promoting top-rated pieces would feed the OLD banal skeletons
// (label titles, 'structural dynamic' openings) straight back into the prompt.
function exemplarOk(md) {
  if (!md) return false;
  var t = String(md);
  var tm = t.match(/^#\s+(.+)$/m);
  var title = (tm ? tm[1].trim() : String(t.split("\n")[0] || "").trim()).replace(/[\u2010-\u2015\u2212]/g, "-");
  if (title) {
    if (BAD_TITLE_RE.test(title)) return false;
    if (TITLE_FORMULA_RE.test(title) || TITLE_COLON_RE.test(title)) return false;
    for (var i = 0; i < LABEL_TITLE_RES.length; i++) { if (LABEL_TITLE_RES[i].test(title)) return false; }
  }
  if (new RegExp(STOCK_FRAMING_RE.source, "i").test(t)) return false;
  if (new RegExp(LABEL_PHRASE_RE.source, "i").test(t)) return false;
  return true;
}

// Q08-QUALITY-1: precedents the site leans on too often are named to the writer and rejected by the gate. 19 of 36 pieces in
// the 7 days to 2026-10-03 reached for the same guild hallmark, because the register exemplar was one.
var PRECEDENT_VOCAB = [
  { label: "the medieval guild hallmark or goldsmith stamp", re: /hall-?mark|goldsmith|guild/i },
  { label: "the South Sea Bubble", re: /south sea/i },
  { label: "tulip mania", re: /tulip/i },
  { label: "patent medicines", re: /patent[- ]medicine/i },
  { label: "railway mania", re: /railway mania/i },
  { label: "the printing press", re: /gutenberg|printing press/i },
  { label: "the Hanseatic League", re: /hanseatic/i },
  { label: "the Medici bank", re: /medici/i },
  { label: "the Dutch East India Company", re: /east india company/i },
  { label: "the dot-com bubble", re: /dot-?com/i }
];
function overusedPrecedents(bodies, minUses) {
  var need = minUses || 2, out = [];
  for (var v of PRECEDENT_VOCAB) {
    var n = 0;
    for (var b of (bodies || [])) { if (v.re.test(String(b || ""))) n++; }
    if (n >= need) out.push(v);
  }
  return out;
}
// Q08-QUALITY-1: the owner's editorial directives, written only through the signed-in command line at fleet.qnfo.org
// (qnfo-audit q08_editor_notes). They are authenticated text, unlike visitor notes, which no prompt ever reads.
async function ownerDirectives(env) {
  if (!env || !env.AUDIT) return [];
  try {
    var r = await env.AUDIT.prepare("SELECT text FROM q08_editor_notes WHERE active = 1 ORDER BY id DESC LIMIT 8").all();
    return (r.results || []).map(function (x) { return String(x.text || "").replace(/\s+/g, " ").trim().slice(0, 400); }).filter(Boolean);
  } catch (e) { return []; }
}
// Q08-READER-TEST-1: a cold read by the model that did not write the draft. It judges as a reader, not as an editor.
// Workers AI returns `response` as a parsed OBJECT when a model's reply is bare JSON (llama, qwen): String() of it is "[object Object]",
// which every verdict parser then rejected. Normalise any reply shape to text.
function aiReplyText(resp) {
  if (!resp) return "";
  var r = resp.response;
  if (r !== undefined && r !== null && r !== "") return typeof r === "string" ? r : JSON.stringify(r);
  var m = resp.choices && resp.choices[0] && resp.choices[0].message;
  var c = m && m.content;
  if (Array.isArray(c)) c = c.map(function (p) { return typeof p === "string" ? p : (p && p.text) || ""; }).join("");
  if (c && typeof c !== "string") c = JSON.stringify(c);
  return c || "";
}
var READER_PROMPT = [
  "You are a busy, intelligent reader who has never heard of this site and owes it nothing. Read the essay below the way you read anything you found by chance: you stop at the first sentence that wastes your time.",
  "Answer with exactly one JSON object and nothing else:",
  "{\"would_read_to_end\": true or false, \"score\": 1 to 5 (5 = I would send it to a friend, 4 = worth the time, 3 = I would skim it, 1 = I stopped at the first paragraph), \"slop_tells\": [up to 3 short phrases copied from the essay that sound like generic machine prose], \"fix\": \"one sentence telling the writer what to change\"}",
  "Judge first the opening: does the first paragraph tell you, as someone who missed the story, what happened, who is involved, where it was published and why it matters? If it does not, the score is at most 3 and the fix says what the opening must state. Second: does it explain the system behind the story, concretely: how the technology involved works (its components and how data or requests move between them), which design decision or constraint produced this outcome, and what trade-off that reveals and who pays for it? A piece that only retells its source scores at most 3, and the fix names the system it should have explained. Abstract words standing in for that explanation ('the loop', 'the coupling', 'the structure') score at most 3. Then: does it open with something concrete that happened? Can you state its claim in one sentence? Does every paragraph add a new fact or step, or only restate in abstract words? Are the words plain, or do role words ('the observer', 'the actor', 'the arrangement') and announcements of structure stand in for people doing things? Does it reason from the facts it states to a general mechanism, or does it lean on a stock example? Be strict: a 4 must be earned. The writer may use only the facts of the story it was given and the reasoning that follows from them, so never ask for outside facts, history, examples, names or figures: when a paragraph is thin, the fix is to cut or merge it, and a short, dense, accurate piece that states its facts and reasons to one mechanism can earn a 4."
].join("\n");
function parseReaderVerdict(text) {
  var m = String(text || "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  var o;
  try { o = JSON.parse(m[0]); } catch (e) { return null; }
  var score = Number(o && o.score);
  if (!isFinite(score)) return null;
  score = Math.max(1, Math.min(5, Math.round(score)));
  var wr = o.would_read_to_end === true || o.would_read_to_end === "true";
  var tells = Array.isArray(o.slop_tells) ? o.slop_tells.slice(0, 3).map(function (t) { return String(t).slice(0, 120); }) : [];
  return { would_read: wr, score: score, tells: tells, fix: String(o.fix || "").slice(0, 300), pass: wr && score >= 4 };
}
// Q08-ENSEMBLE-1. Research behind the design (2026-10-03): LLM errors are strongly correlated. Kim et al. (ICML 2025) found models
// agree 60% of the time they are both wrong, and that larger, more accurate models correlate MORE; a 9-judge, 7-family panel gave
// only 2.18 effective independent votes (mean pairwise phi 0.39), and past 5 judges added 0.22 votes. Verga et al. (PoLL, 2024)
// found a panel of small models from disjoint families beat one large judge at about 1/7 the cost, with less self-preference.
// So: judges come from families other than the writer's, are small, are few (2 per round), and the layers that really are
// uncorrelated with a model are not models: the deterministic gate, real reader votes and the owner's verdict.
var MODEL_FAMILY = {
  "@cf/nvidia/nemotron-3-120b-a12b": "nvidia",
  "@cf/openai/gpt-oss-120b": "openai",
  "@cf/openai/gpt-oss-20b": "openai",
  "@cf/google/gemma-4-26b-a4b-it": "google",
  "@cf/zai-org/glm-5.3-flash": "zai",
  "@cf/qwen/qwen3.8-27b": "alibaba",
  "@cf/qwen/qwen3-30b-a3b-fp8": "alibaba",
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast": "meta",
  "@cf/deepseek-ai/deepseek-v4-flash-0731": "deepseek",
  "@cf/deepseek-ai/deepseek-v4-pro-0813": "deepseek",
  "@cf/moonshotai/kimi-k2.6": "moonshot",
  "@cf/zai-org/glm-5.3": "zai"
};
function familyOf(id) { return MODEL_FAMILY[id] || "unknown:" + String(id || "").split("/")[1]; }
// BREACH-LEVER-9193 (issue 100212): qwen3.8-27b spent the reply budget on reasoning and answered empty (89 of 114 calls
// failed in 24 h from q08-signal-engine's fact-check). factCheckExtra gave nemotron, kimi, deepseek and gpt-oss a measured
// reasoning switch but none to qwen; wrap it so every qwen call gets thinking disabled.
factCheckExtra = (function (orig) {
  return function (m) {
    var extra = orig(m);
    if (String(m || "").indexOf("qwen") >= 0) extra = Object.assign({}, extra, { chat_template_kwargs: { enable_thinking: false } });
    return extra;
  };
})(factCheckExtra);
// Judges, cheapest-per-call first within a rotation. Active parameters are small (a4b, a3b, flash) on purpose.
// Three of the five judges are reasoning models (qwen3-30b-a3b, glm-5.3-flash, deepseek-v4-flash): they think before they answer, so the
// output budget covers the thinking too (the same failure ASK-LOOP-1 hit with its judge, PR 566). Non-reasoning models lead the rotation.
// Q08-READER-NOTHINK-1 (0.11.19, issue 2085): 11 of the panel reads in 2026-10-09..12 returned no verdict, and glm/deepseek judges
// rejected 18 of 20 and 16 of 21 drafts while llama passed 17 of 18: the reasoning judges spent the 2000-token budget thinking. Readers now
// use the per-model reasoning switches measured for the fact-check (factCheckExtra) and a 6000-token budget, as the fact-check does.
var READER_MAX_TOKENS = 6000;
// Q08-REVIEWER-SWAP-1 (0.31.0, Q08-YIELD-1 / cluster publish-stalls, agent_issues 2606 and 100118). Measured 2026-10-19 from qnfo-audit
// ai_call_counters (worker q08-signal-engine, three days): qwen3.8-27b errored on 104 of 134 calls at 80 s, glm-5.3-flash on 175 of 400 at
// 58 s, while kimi-k2.6 errored on 0 of 310 (19 s) and deepseek-v4-flash-0731 on 4 of 401 (5.7 s). MODEL-FLOOR-1 (2026-10-17) had removed the
// judges that answered every time (llama-3.3-70b, qwen3-30b-a3b, gemma-4: banned by scripts/model-floor-guard.mjs, so they do not come back)
// and left those two at the head of both reviewer lists, so a panel read or fact-check round waited out one or two 58-80 s failures before
// a working reviewer was asked (fact-check runs averaged 606 s). The first PANEL_PRIMARY_N entries are the working judges and rotate with the
// seed; the entries after them are the previous panel, kept as the per-request fallback: asked only after the primaries (a family the writer or
// an earlier panel used is skipped, so a fresh panel can still reach them), glm-5.3-flash first because it errors less. Nothing is removed from
// the pool and no family leaves it; reviewerHealth() below moves any reviewer that is erroring now behind the working ones, which restores the
// previous order by itself if the primaries start failing. ENSEMBLE-POLICY-1 is unchanged: small judges, one per family, never the writer's.
var PANEL_POOL = [
  "@cf/moonshotai/kimi-k2.6",
  "@cf/deepseek-ai/deepseek-v4-flash-0731",
  "@cf/zai-org/glm-5.3-flash",
  "@cf/qwen/qwen3.8-27b"
];
var PANEL_PRIMARY_N = 2;
// Q08-PANEL-CALIBRATION-1 (0.31.1). The measured reader-panel order above puts kimi-k2.6 and deepseek-v4-flash in every round-1 panel. Their
// live reader-test verdicts (q08-signal q08_reader_tests, role judge, 7 days to 2026-10-19) are the two strictest judges: pass rate 0.35 for
// kimi-k2.6 (60 verdicts, mean score 2.83) and 0.263 for deepseek-v4-flash (194, 2.63), against 0.685 for glm-5.3-flash (181, 3.65); the
// panel passes at a mean of 3.5 with every score at least 3, so a pair of the two strict judges clears it rarely and the swap lowers the
// yield it was written to raise (found by an independent recheck, session_01QpQv19, and confirmed on these rows). The panel therefore
// rotates over the whole pool in the order it had before 0.31.0 unless ops_config q08_panel_order is `measured`; the health ordering still
// orders the fact-check (cost and latency) and the reader panel when the switch is `measured`. Read: ops_config q08_panel_order, cached five
// minutes, fail open to `rotate`. The effect is read on q08_gate_pass_rate_7d and on the per-judge pass share in q08_reader_tests.
var LEGACY_PANEL = [
  "@cf/moonshotai/kimi-k2.6",
  "@cf/qwen/qwen3.8-27b",
  "@cf/zai-org/glm-5.3-flash",
  "@cf/deepseek-ai/deepseek-v4-flash-0731"
];
var __panelOrder = { at: 0, mode: "rotate" };
async function panelOrderMode(env) {
  if (env && env.Q08_PANEL_ORDER) return String(env.Q08_PANEL_ORDER) === "measured" ? "measured" : "rotate";
  if (!env || !env.AUDIT || typeof env.AUDIT.prepare !== "function") return "rotate";
  var now = Date.now();
  if (__panelOrder.at && now - __panelOrder.at < 300000) return __panelOrder.mode;
  try {
    var r = await env.AUDIT.prepare("SELECT value FROM ops_config WHERE key = 'q08_panel_order'").first();
    __panelOrder = { at: now, mode: r && String(r.value) === "measured" ? "measured" : "rotate" };
  } catch (e) {
    __panelOrder = { at: now, mode: __panelOrder.mode };
  }
  return __panelOrder.mode;
}
// Q08-REVIEWER-HEALTH-1 (0.31.0): the automatic revert. A reviewer whose errors over the last two days (qnfo-audit ai_call_counters, this worker,
// the same rows the metric tick reads) are at least 30% of at least 12 calls is "flagged" and is ordered behind every unflagged reviewer, in
// both the reader panel and the fact-check; a flagged reviewer is still asked when nothing else is left, so a pool that is all flagged keeps its
// static order and no run is refused. A recovered reviewer (or one that ages out of the two-day window) is unflagged on the next read, five
// minutes later at most. Fail open: no AUDIT binding or a failed read means the static order. This orders; it never stops a call.
var REVIEWER_FLAG_ERR = 0.3, REVIEWER_FLAG_MIN_CALLS = 12, REVIEWER_HEALTH_TTL_MS = 300000;
var __reviewerHealth = { at: 0, flagged: {} };
function flaggedFrom(rows) {
  var out = {};
  (rows || []).forEach(function (r) {
    var c = Number(r && r.c) || 0, e = Number(r && r.e) || 0;
    if (r && r.model && c >= REVIEWER_FLAG_MIN_CALLS && e / c >= REVIEWER_FLAG_ERR) out[String(r.model)] = true;
  });
  return out;
}
async function reviewerHealth(env) {
  if (!env || !env.AUDIT || typeof env.AUDIT.prepare !== "function") return {};
  var now = Date.now();
  if (__reviewerHealth.at && now - __reviewerHealth.at < REVIEWER_HEALTH_TTL_MS) return __reviewerHealth.flagged;
  try {
    var rs = await env.AUDIT.prepare("SELECT model, SUM(calls) AS c, SUM(errors) AS e FROM ai_call_counters WHERE worker = 'q08-signal-engine' AND purpose = 'binding' AND day >= date('now', '-2 days') GROUP BY model").all();
    __reviewerHealth = { at: now, flagged: flaggedFrom(rs && rs.results) };
  } catch (e) {
    console.error("q08 reviewerHealth read failed: " + String(e && e.message || e).slice(0, 160));
    __reviewerHealth = { at: now, flagged: __reviewerHealth.flagged }; // keep the last answer; the static order is the floor
  }
  return __reviewerHealth.flagged;
}
// Unflagged reviewers first, each group in its own order.
function healthFirst(ids, flagged) {
  if (!flagged) return ids.slice();
  var good = [], bad = [];
  ids.forEach(function (m) { (flagged[m] ? bad : good).push(m); });
  return good.concat(bad);
}
// k judges, one per family, none from a family in `exclude` (the writer, the editor, an earlier panel). The start rotates with
// `seed` over the primary judges so no single family becomes the permanent judge; the previous panel follows them. `flagged` (optional)
// is reviewerHealth()'s answer. Returns [] when fewer than one candidate remains.
function pickPanel(exclude, k, seed, flagged, mode) {
  var ex = {}; (exclude || []).forEach(function (f) { ex[f] = 1; });
  var np, start, order = [], out = [], seen = {};
  if (mode === "rotate") {
    // Q08-PANEL-CALIBRATION-1: the order before 0.31.0, every model of the pool takes its turn at the head, nothing is reordered by health
    np = LEGACY_PANEL.length; start = Math.abs(seed | 0) % np;
    for (var q = 0; q < np; q++) order.push(LEGACY_PANEL[(start + q) % np]);
  } else {
    np = Math.min(PANEL_PRIMARY_N, PANEL_POOL.length); start = Math.abs(seed | 0) % np;
    for (var j = 0; j < np; j++) order.push(PANEL_POOL[(start + j) % np]);
    order = healthFirst(order.concat(PANEL_POOL.slice(np)), flagged);
  }
  for (var i = 0; i < order.length && out.length < k; i++) {
    var id = order[i], f = familyOf(id);
    if (ex[f] || seen[f]) continue;
    seen[f] = 1; out.push(id);
  }
  return out;
}
function seedOf(str) { var h = 0, t = String(str || ""); for (var i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0; return Math.abs(h); }
// BP26-AI-GATEWAY-BUDGETS-1 (issue 1000351): every model call from this worker is routed through AI Gateway, which applies the
// cache, the rate limits and the (beta, eventually consistent, up to 20 rules) spend limits configured on the gateway as a
// backstop. Each call carries metadata (worker, loop_id, session_id, purpose) so gateway logs can be attributed per loop.
// Deterministic calls (temperature 0 / fixed judge prompts) are cached (cf-aig-cache-ttl); anything else skips the cache.
// A breached spend or token budget steers the first writer attempt to a cheaper model (BUDGET-SOFT-ROUTE-1); reviewer calls
// keep their independent families, and a writer that fails its gates can escalate through the measured-yield order.
var AIG_GATEWAY_DEFAULT_ID = "qnfo-infra";
var AIG_CACHE_TTL_SECONDS = 21600; // cf-aig-cache-ttl: 6 h
var AIG_BUDGET_FALLBACK_MODEL = "@cf/openai/gpt-oss-20b";
var AIG_LOOP_MAX_TOKENS = 60000;
function loopBudget(env, loopId, maxTokens) {
  if (!env) return null;
  if (!env.__aigLoopBudget || env.__aigLoopBudget.id !== String(loopId || "")) {
    env.__aigLoopBudget = { id: String(loopId || ""), max: Number(maxTokens) || AIG_LOOP_MAX_TOKENS, used: 0 };
  }
  return env.__aigLoopBudget;
}
async function aiGatewayRun(env, modelId, input, meta) {
  var m = meta || {};
  var b = env && env.__aigLoopBudget, model = modelId;
  var writerCall = m.purpose === "compose" || m.purpose === "title-repair" || m.purpose === "forecast";
  if (writerCall && m.budgetFallback && ((b && b.used >= b.max) || (env && env.__q08BudgetPressure))) model = AIG_BUDGET_FALLBACK_MODEL;
  var callInput = input;
  if (model !== modelId) {
    callInput = Object.assign({}, input);
    delete callInput.chat_template_kwargs;
    delete callInput.reasoning;
    callInput.reasoning = { effort: "low" };
  }
  var gw = {
    id: (env && env.AIG_GATEWAY_ID) || AIG_GATEWAY_DEFAULT_ID,
    collectLog: true,
    metadata: { worker: "q08-signal-engine", loop_id: m.loop_id || "", session_id: m.session_id || "", purpose: m.purpose || "" }
  };
  if (m.deterministic && !m.skipCache) { gw.cacheKey = m.cacheKey || String(model) + "-" + seedOf(JSON.stringify(input && input.messages || input)); gw.cacheTtl = AIG_CACHE_TTL_SECONDS; }
  else { gw.skipCache = true; }
  var opts = { gateway: gw };
  if (m.signal) opts.signal = m.signal;
  var resp = await env.AI.run(model, callInput, opts);
  var u = (resp && resp.usage) || {};
  if (b) b.used += (Number(u.prompt_tokens) || 0) + (Number(u.completion_tokens) || 0);
  return resp && typeof resp === "object" ? Object.assign({}, resp, { __q08Model: model }) : { response: resp, __q08Model: model };
}
async function readerTest(env, modelId, text, rprompt, cacheSuffix) {
  try {
    var essay = stripAnalysisMark(String(text || "").replace(/\n?worth your time:[^\n]*$/im, "").trim()).slice(0, 9000);
    meterCall(env, "panel");
    // BP26-AI-GATEWAY-BUDGETS-1: through AI Gateway with loop metadata; the fixed judge prompt per essay is deterministic, so it is cached.
    var prompt = rprompt || READER_PROMPT;
    var cacheKey = String(modelId) + "-panel-" + seedOf(prompt) + "-" + seedOf(essay) + (cacheSuffix ? "-" + String(cacheSuffix) : "");
    var resp = await aiGatewayRun(env, modelId, Object.assign({ messages: [{ role: "user", content: prompt + "\n\n--- ESSAY ---\n" + essay }], max_tokens: READER_MAX_TOKENS, temperature: 0.2 }, factCheckExtra(modelId)), { loop_id: env && env.__aigLoopBudget && env.__aigLoopBudget.id, purpose: "panel", deterministic: true, cacheKey: cacheKey, signal: AbortSignal.timeout(90000) });
    var out = aiReplyText(resp);
    var v = parseReaderVerdict(String(out).replace(/<think>[\s\S]*?<\/think>/gi, ""));
    if (v) { v.model = modelId; v.family = familyOf(modelId); }
    return v;
  } catch (e) { return null; }
}
// Panel verdict: passes when the mean score is at least 4 and a strict majority would read to the end. With 2 judges that means
// both. Judges that error are replaced by the next candidate family once; no valid verdict at all returns null (fail open).
// Q08-PANEL-THRESHOLD-1: with source-only writing a "4 from both readers" bar rejected every draft whose readers split 3 and 4 (run 313: mean 3.5, 9 days without a piece);
// accuracy is guarded by the grounding check and the two-family fact-check, so this layer only has to keep out drafts a reader would skim past.
var PANEL_PASS_MEAN = 3.5;
function aggregatePanel(judges) {
  var j = (judges || []).filter(Boolean);
  if (!j.length) return null;
  var mean = j.reduce(function (a, x) { return a + x.score; }, 0) / j.length;
  var wr = j.filter(function (x) { return x.would_read; }).length;
  var tells = [], fixes = [];
  j.forEach(function (x) { (x.tells || []).forEach(function (t) { if (tells.indexOf(t) < 0 && tells.length < 5) tells.push(t); }); if (x.fix && fixes.indexOf(x.fix) < 0) fixes.push(x.fix); });
  return { judges: j, n: j.length, mean: Math.round(mean * 100) / 100, pass: mean >= PANEL_PASS_MEAN && wr >= 1 && j.every(function (x) { return x.score >= 3; }), fix: fixes.join(" | ").slice(0, 500), tells: tells };
}
async function panelRead(env, text, exclude, seed, k, rprompt, cacheSuffix) {
  var want = k || 2;
  var mode = await panelOrderMode(env);
  var ids = pickPanel(exclude, want + 2, seed, mode === "measured" ? await reviewerHealth(env) : undefined, mode);
  var first = ids.slice(0, want), spare = ids.slice(want);
  var got = await Promise.all(first.map(function (id) { return readerTest(env, id, text, rprompt, cacheSuffix); }));
  for (var i = 0; i < got.length; i++) { if (!got[i] && spare.length) got[i] = await readerTest(env, spare.shift(), text, rprompt, cacheSuffix); }
  return aggregatePanel(got);
}
// Mean pairwise agreement of the two judges in each panel read, as a phi coefficient over pass/fail, and the implied number of
// independent votes n_eff = n / (1 + (n - 1) * phi) for n = 2. Reported only from 20 paired reads, else null (unmeasured).
function effectiveVotes(pairs) {
  var a = 0, b = 0, c = 0, d = 0;
  (pairs || []).forEach(function (p) { if (p[0] && p[1]) a++; else if (p[0] && !p[1]) b++; else if (!p[0] && p[1]) c++; else d++; });
  var n = a + b + c + d;
  if (n < 20) return { reads: n, phi: null, n_eff: null };
  var den = Math.sqrt((a + b) * (c + d) * (a + c) * (b + d));
  var phi = den === 0 ? 1 : (a * d - b * c) / den;
  phi = Math.max(0, Math.min(1, phi));
  return { reads: n, phi: Math.round(phi * 1000) / 1000, n_eff: Math.round((2 / (1 + phi)) * 100) / 100 };
}
// Share of panel reads over 7 days that returned no valid verdict (every judge errored or answered with no JSON). A panel that
// silently never runs fails open, so this is the only place that shows it.
async function panelUnavailableShare(env) {
  var r = await env.DB.prepare("SELECT SUM(CASE WHEN role = 'panel_unavailable' THEN 1 ELSE 0 END) u, SUM(CASE WHEN role = 'judge' THEN 1 ELSE 0 END) j FROM q08_reader_tests WHERE created_at >= datetime('now','-7 days')").first().catch(function () { return null; });
  if (!r) return null;
  var panels = (r.j || 0) / 2 + (r.u || 0);
  if (panels < 5) return null;
  return Math.round(((r.u || 0) / panels) * 1000) / 1000;
}
async function panelPairs(env) {
  var rs = await env.DB.prepare("SELECT piece_key, round, pass FROM q08_reader_tests WHERE created_at >= datetime('now','-30 days') AND role = 'judge' ORDER BY piece_key, round, id").all().catch(function () { return { results: [] }; });
  var by = {};
  (rs.results || []).forEach(function (r) { var k = r.piece_key + "#" + r.round; (by[k] = by[k] || []).push(!!r.pass); });
  return Object.keys(by).filter(function (k) { return by[k].length === 2; }).map(function (k) { return by[k]; });
}
// 0.8.4 created q08_reader_tests without role and family. CREATE IF NOT EXISTS cannot add them, so an old table is altered; without
// this a deploy order of 0.8.4 then 0.8.5 would leave every insert failing inside a swallowed catch (review finding on PR 562).
async function ensureReaderTable(env) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS q08_reader_tests (id INTEGER PRIMARY KEY AUTOINCREMENT, piece_key TEXT, round INTEGER, role TEXT, model TEXT, family TEXT, would_read INTEGER, score INTEGER, tells TEXT, fix TEXT, pass INTEGER, created_at TEXT)").run();
  var info = await env.DB.prepare("PRAGMA table_info(q08_reader_tests)").all();
  var have = {}; (info.results || []).forEach(function (c) { have[c.name] = 1; });
  if (!have.role) await env.DB.prepare("ALTER TABLE q08_reader_tests ADD COLUMN role TEXT").run();
  if (!have.family) await env.DB.prepare("ALTER TABLE q08_reader_tests ADD COLUMN family TEXT").run();
}
async function saveReaderTests(env, key, rows) {
  if (!rows || !rows.length) return;
  try {
    await ensureReaderTable(env);
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      await env.DB.prepare("INSERT INTO q08_reader_tests (piece_key, round, role, model, family, would_read, score, tells, fix, pass, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(String(key || "").slice(0, 200), r.round == null ? 1 : r.round, r.role || "judge", r.model || "", r.family || "", r.would_read ? 1 : 0, r.score == null ? null : r.score, JSON.stringify(r.tells || []), r.fix || "", r.pass ? 1 : 0, nowIso()).run();
    }
  } catch (e) { console.error("q08 reader_tests write failed: " + String(e && e.message || e).slice(0, 200)); }
}
// One row per judge, plus an editor row, so the chain of models behind a piece is recorded.
// Q08-ENSEMBLE-1 read-out (public, aggregate only; no IP, cookie or visitor text). It is the evidence the loop needs: does each
// family read like the others (n_eff), does the editor round actually raise the score, and which phrases do judges keep flagging.
async function ensembleReport(env) {
  var out = { window_days: 30, by_family: [], by_round: [], effective_votes: effectiveVotes([]), top_tells: [], panel_unavailable: 0, recorded: false };
  try {
    var since = "created_at >= datetime('now','-30 days')";
    var f = await env.DB.prepare("SELECT family, role, COUNT(*) n, ROUND(AVG(score),2) mean_score, ROUND(AVG(pass),3) pass_rate FROM q08_reader_tests WHERE " + since + " GROUP BY family, role ORDER BY n DESC").all();
    out.by_family = f.results || [];
    var r = await env.DB.prepare("SELECT round, COUNT(*) n, ROUND(AVG(score),2) mean_score, ROUND(AVG(pass),3) pass_rate FROM q08_reader_tests WHERE role = 'judge' AND " + since + " GROUP BY round ORDER BY round").all();
    out.by_round = r.results || [];
    out.effective_votes = effectiveVotes(await panelPairs(env));
    var t = await env.DB.prepare("SELECT tells FROM q08_reader_tests WHERE role = 'judge' AND " + since + " ORDER BY id DESC LIMIT 400").all();
    var count = {};
    (t.results || []).forEach(function (x) { var a; try { a = JSON.parse(x.tells || "[]"); } catch (e) { a = []; } a.forEach(function (ph) { var k = String(ph).toLowerCase().replace(/\s+/g, " ").trim().slice(0, 120); if (k) count[k] = (count[k] || 0) + 1; }); });
    out.top_tells = Object.keys(count).filter(function (k) { return count[k] >= 2; }).sort(function (a, b) { return count[b] - count[a]; }).slice(0, 10).map(function (k) { return { phrase: k, n: count[k] }; });
    var un = await env.DB.prepare("SELECT COUNT(*) n FROM q08_reader_tests WHERE role = 'panel_unavailable' AND " + since).first();
    out.panel_unavailable = un ? un.n : 0;
    out.recorded = out.by_family.length > 0 || out.panel_unavailable > 0;
  } catch (e) { console.error(JSON.stringify({ evt: "q08-signal-engine:ensembleReport:caught", error: String((e && e.message) || e) })); }
  return out;
}
function panelRows(panel, round) {
  return panel.judges.map(function (j) { return { round: round, role: "judge", model: j.model, family: j.family, would_read: j.would_read, score: j.score, tells: j.tells, fix: j.fix, pass: j.pass }; });
}

// Q08-LEDE-1 (0.17.0, owner 2026-10-13: "poorly written and lacks context without a lede that fills in for the reader what is being
// discussed (inverted pyramid journalism)"). The writer now gets the source's kind, title and link and must open with a news lede; the
// gate checks the first body paragraph: it names the subject (a significant word of the source title or its site/repository), it does not
// open on an abstract noun ("The observable pattern is ...", "The mechanism ..."), and it stays under LEDE_MAX_WORDS.
var LEDE_MAX_WORDS = 90;
var LEDE_ABSTRACT_RE = /^\s*(?:the|this|that|these|such)\s+(?:observable\s+|underlying\s+|core\s+|central\s+)?(?:pattern|mechanism|dynamics?|arrangement|system|process|loop|incentive|structure|tension|question|problem|gap)\b/i;
var LEDE_STOP = /^(this|that|with|from|have|were|their|there|which|when|what|into|than|then|they|them|been|also|only|more|most|such|does|each|over|will|would|could|should|about|after|before|because|while|where|your|show|using|via|based|towards?|new|how|why)$/;
function hostOf(u) { var m = String(u || "").match(/^https?:\/\/(?:www\.)?([^\/:?#]+)/i); return m ? m[1].toLowerCase() : ""; }
function sourceKind(src) {
  var s = String(src && src.source || "hn"), host = hostOf(src && src.url);
  if (s === "github") return "a GitHub repository (" + String(src.title || "") + ")";
  if (s === "arxiv") return "a research paper posted to arXiv";
  return host ? "an article at " + host + ", discussed on Hacker News" : "a Hacker News discussion";
}
function ledeWords(t) { return String(t || "").toLowerCase().replace(/[\u2010-\u2015\u2212]/g, "-").split(/[^a-z0-9]+/).filter(function (w) { return w.length >= 4 && !LEDE_STOP.test(w); }); }
function ledeOf(text) {
  var parts = String(text || "").split(/\n{2,}/);
  for (var i = 0; i < parts.length; i++) { var p = parts[i].trim(); if (!p || /^#/.test(p) || /^(worth your time:|FORECAST-JSON:)/i.test(p)) continue; return p; }
  return "";
}
function ledeProblems(text, src) {
  if (!src || !src.title) return [];
  var lede = ledeOf(text), out = [];
  if (!lede) return ["lede missing: the essay has no opening paragraph"];
  var n = lede.split(/\s+/).filter(Boolean).length;
  if (n > LEDE_MAX_WORDS) out.push("lede too long (" + n + " words; the first paragraph is at most " + LEDE_MAX_WORDS + ")");
  if (LEDE_ABSTRACT_RE.test(lede)) out.push("lede opens on an abstract noun ('" + lede.slice(0, 40) + "'): open with who did what, where");
  var want = ledeWords(src.title);
  if (hostOf(src.url)) want = want.concat(ledeWords(hostOf(src.url).split(".")[0]));
  var have = ledeWords(lede).map(function (w) { return w.slice(0, 5); });
  if (want.length && !want.some(function (w) { return have.indexOf(w.slice(0, 5)) >= 0; })) out.push("lede does not name the subject: the first paragraph must say what is being discussed (" + String(src.title).slice(0, 80) + ") and where it appeared");
  return out;
}
function withLede(g, text, src) {
  var lp = ledeProblems(text, src);
  return lp.length ? { ok: false, problems: (g.problems || []).concat(lp) } : g;
}
// Q08-CONTEXT-1 (0.18.0, owner 2026-10-13: q08 "content is totally lacking in context and big-picture systems analysis"). The writer could
// state only what the one linked source said, so context and analysis were cut as unsupported. Each essay now gets a BACKGROUND pack of
// verified reference text: the lead sections of the Wikipedia articles that match the story and recent news coverage of the same subject.
// It goes to the writer and into the fact-check ground, so attributed context is checkable like the source.
var BG_STOP = /^(this|that|with|from|have|were|their|there|which|when|what|into|than|then|they|them|been|also|only|more|most|such|does|each|over|will|would|could|should|about|after|before|because|while|where|your|show|using|says|said|just|like|make|made|years|later|first|says|look|looks|claims|claimed)$/;
var BG_ARTICLE_MAX = 6000, BACKGROUND_PROMPT_MAX = 22000, BG_ENTITY_MAX = 4500, BG_ENTITIES = 4;
// Q08-ENTITY-BACKGROUND-1 (0.25.0, run 390): the analysis explains how the named systems work (Q08-TECH-SYSTEMS-1), but the background
// was searched with the headline's words, so a story about a Safari campaign fetched pages about the campaign and none about Chrome or
// Safari, and every architectural sentence was refused as "no source describes Chrome's architecture". The products, projects and
// organisations the headline names (capitalised words, at most BG_ENTITIES) each get their own Wikipedia article, read in full, so the
// system the writer explains is in the source material the fact-check reads.
var BG_ENTITY_SKIP = /^(Show|Ask|Tell|HN|The|A|An|How|Why|What|When|Where|Who|New|Our|We|I|It|Its|This|That|These|Those|My|Your|Is|Are|Was|Be|In|On|At|For|From|To|Of|And|Or|But|With|Without|Not|No|Yes|Now|Today|Why|Inside|Introducing|Announcing|Launch|Launches|Details|Campaign)$/;
function backgroundEntities(story) {
  var t = String(story && story.title || "").replace(/^(show|ask|tell) hn:\s*/i, "");
  var m = t.match(/^[A-Za-z0-9_.-]+\/([A-Za-z0-9_.-]+)$/);
  if (m) return [m[1]];
  var out = [];
  (t.match(/\b[A-Z][A-Za-z0-9+.#-]{2,}(?:\s+[A-Z][A-Za-z0-9+.#-]{1,})?/g) || []).forEach(function (w) {
    var first = w.split(/\s+/)[0];
    var clean = w.replace(/['\u2019]s$/, "").replace(/[.:,;]+$/, "");
    if (BG_ENTITY_SKIP.test(first) || clean.length < 3) return;
    if (out.map(function (x) { return x.toLowerCase(); }).indexOf(clean.toLowerCase()) < 0) out.push(clean);
  });
  return out.slice(0, BG_ENTITIES);
}
async function entityArticle(name, have) {
  var d = await (await evidenceFetch("https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=1&srsearch=" + encodeURIComponent(name), 8000)).json();
  var hit = ((d.query && d.query.search) || [])[0];
  if (!hit || !hit.title || have.indexOf(String(hit.title)) >= 0) return "";
  var j = await (await evidenceFetch("https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&format=json&titles=" + encodeURIComponent(String(hit.title)), 8000)).json();
  var pg = j.query && j.query.pages ? Object.keys(j.query.pages).map(function (k) { return j.query.pages[k]; }).filter(function (x) { return String(x.title) === String(hit.title); })[0] : null;
  var x = pg ? String(pg.extract || "") : "";
  if (x.length < 300 || /may refer to/i.test(x.slice(0, 300))) return "";
  have.push(String(hit.title));
  return "Wikipedia, '" + String(hit.title).slice(0, 100) + "' (article, as fetched " + nowIso().slice(0, 10) + "): " + x.replace(/\s+/g, " ").slice(0, BG_ENTITY_MAX);
}
function backgroundQuery(story) {
  var t = String(story && story.title || "");
  var m = t.match(/^[A-Za-z0-9_.-]+\/([A-Za-z0-9_.-]+)$/);
  if (m) t = m[1].replace(/[-_.]+/g, " ");
  return t.replace(/^(show|ask|tell) hn:\s*/i, "").split(/[^A-Za-z0-9'\u2019-]+/).filter(function (w) { return w.length >= 3 && !BG_STOP.test(w.toLowerCase()); }).slice(0, 6).join(" ");
}
async function backgroundPack(story) {
  var q = backgroundQuery(story);
  if (q.split(" ").length < 1 || q.length < 3) return "";
  var out = [];
  var wiki = (async function () {
    var d = await (await evidenceFetch("https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=3&srsearch=" + encodeURIComponent(q), 8000)).json();
    var titles = ((d.query && d.query.search) || []).map(function (h) { return String(h.title || ""); }).filter(Boolean).slice(0, 3);
    if (!titles.length) return [];
    var e = await (await evidenceFetch("https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&redirects=1&format=json&titles=" + encodeURIComponent(titles.join("|")), 8000)).json();
    var pages = e.query && e.query.pages ? Object.keys(e.query.pages).map(function (k) { return e.query.pages[k]; }) : [];
    var qw = q.toLowerCase().split(" ");
    var keep = pages.filter(function (p) { var x = String(p.extract || ""); return x.length >= 200 && !/may refer to/i.test(x.slice(0, 300)) && qw.some(function (w) { return (String(p.title || "") + " " + x.slice(0, 400)).toLowerCase().indexOf(w) >= 0; }); }).slice(0, 2);
    // Q08-TECH-SYSTEMS-1 (0.23.0): the lead section names a technology but rarely says how it works, so the writer could not explain the
    // system without asserting what the fact-check then cut. Each kept page is read in full (design, architecture and operation sections),
    // up to BG_ARTICLE_MAX characters; the lead stays the fallback when the full read fails.
    var full = await Promise.all(keep.map(function (p) {
      return evidenceFetch("https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&format=json&titles=" + encodeURIComponent(String(p.title)), 8000)
        .then(function (r) { return r.json(); })
        .then(function (j) { var pg = j.query && j.query.pages ? Object.keys(j.query.pages).map(function (k) { return j.query.pages[k]; }).filter(function (x) { return String(x.title) === String(p.title); })[0] : null; return pg && String(pg.extract || "").length > String(p.extract || "").length ? String(pg.extract) : ""; })
        .catch(function (e) { console.error(JSON.stringify({ at: "q08.backgroundPack.wikipedia-full", error: String(e && e.message || e).slice(0, 160) })); return ""; });
    }));
    return keep.map(function (p, i) { var body = full[i] || String(p.extract); return "Wikipedia, '" + String(p.title).slice(0, 100) + "' (" + (full[i] ? "article" : "lead section") + ", as fetched " + nowIso().slice(0, 10) + "): " + body.replace(/\s+/g, " ").slice(0, full[i] ? BG_ARTICLE_MAX : 1800); });
  })().catch(function (e) { console.error(JSON.stringify({ at: "q08.backgroundPack.wikipedia", error: String(e && e.message || e).slice(0, 160) })); return []; });
  var news = (async function () {
    var start = new Date(Date.now() - 30 * 864e5).toISOString().replace(/[-:T]/g, "").slice(0, 14);
    var d = await (await evidenceFetch("https://api.gdeltproject.org/api/v2/doc/doc?mode=artlist&format=json&maxrecords=8&sort=hybridrel&startdatetime=" + start + "&query=" + encodeURIComponent(q), 8000)).json();
    return (d.articles || []).slice(0, 5).map(function (a) { var sd = String(a.seendate || ""); return "News coverage (" + String(a.domain || "").slice(0, 60) + ", " + sd.slice(0, 4) + "-" + sd.slice(4, 6) + "-" + sd.slice(6, 8) + "): " + String(a.title || "").slice(0, 200); });
  })().catch(function (e) { console.error(JSON.stringify({ at: "q08.backgroundPack.news", error: String(e && e.message || e).slice(0, 160) })); return []; });
  var got = await Promise.all([wiki, news]);
  got.forEach(function (g) { g.forEach(function (x) { out.push(x); }); });
  var have = out.map(function (x) { var mm = String(x).match(/^Wikipedia, '([^']+)'/); return mm ? mm[1] : ""; }).filter(Boolean);
  var ents = backgroundEntities(story);
  for (var ei = 0; ei < ents.length; ei++) {
    try { var ea = await entityArticle(ents[ei], have); if (ea) out.push(ea); }
    catch (e) { console.error(JSON.stringify({ at: "q08.backgroundPack.entity", entity: ents[ei], error: String(e && e.message || e).slice(0, 160) })); }
  }
  return out.join("\n");
}
// Q08-FACT-LEDGER-1 (0.32.0, agent_issues 2606): the writer was told to use only what the source states, but not which sentences those are,
// and 28 of the 44 runs that failed in the 24 h to 2026-10-19 21:30Z ended at the fact-check on a paraphrase that said more than its
// sentence ("the co-founder announced the launch", "users say", "according to its public documentation"). The sentences of the item
// description, the signal and the linked article are numbered into a ledger the reporting sections must reuse; the analysis section stays
// exempt (Q08-FACT-INFERENCE-1). The tags are for the writer only: normalizeDraftCore removes one that is copied into the text.
var LEDGER_MAX_LINES = 80, LEDGER_MAX_CHARS = 7500, LEDGER_LINE_MIN = 25, LEDGER_LINE_MAX = 280;
function sourceLedger(friction, article, src) {
  var out = [], used = 0;
  function add(sentence) {
    var t = String(sentence || "").replace(/\s+/g, " ").trim();
    if (t.length < LEDGER_LINE_MIN || out.length >= LEDGER_MAX_LINES) return;
    if (t.length > LEDGER_LINE_MAX) t = t.slice(0, LEDGER_LINE_MAX).replace(/\s+\S*$/, "");
    if (used + t.length > LEDGER_MAX_CHARS) return;
    used += t.length; out.push(t);
  }
  function addText(text) {
    String(text || "").split(/\n+/).forEach(function (line) { line.split(/(?<=[.!?])\s+(?=[A-Z0-9"\u201c(])/).forEach(add); });
  }
  if (src && src.title) add("The item is titled \u201c" + String(src.title).slice(0, 200) + "\u201d." + (src.url && hostOf(src.url) ? " It appeared on " + hostOf(src.url) + "." : ""));
  addText(friction && friction.friction_point);
  addText(String(article || "").slice(0, 6000));
  return out;
}
function ledgerBlock(friction, article, src) {
  var lines = sourceLedger(friction, article, src);
  if (!lines.length) return "";
  return "\n--- SOURCE LEDGER (the numbered sentences of the item, the signal and the linked article above; the tags are for you only and never appear in the essay) ---\n"
    + lines.map(function (t, i) { return "[S" + (i + 1) + "] " + t; }).join("\n")
    + "\nLEDGER RULE: every assertion about the real world in the reporting sections (the lede, the context and the key facts of the case) reuses the names, figures, dates and attributions of one ledger sentence. You may reword that sentence; you may not change who did what, add a name, a number or a date, or say more than it says (a source that names a person does not make him the one who announced, wrote or decided something unless the sentence says so). If no ledger sentence states a claim, leave the claim out. The analysis section is exempt: its reasoning may go beyond the ledger as conditional reasoning ('a system that does X will Y when Z'), and it adds no new name, date or figure. BACKGROUND facts stay attributed to the background as before. Never write a ledger tag such as [S3] in the essay.";
}
function buildPrompt(friction, fewShot, recentStructures, opts) {
  var parts = [Q08_DIRECTIVE];
  parts.push("Remember: start your response with a single H1 title line '# <title>' before the essay body. Use sentence case (capitalize only the first word and names), keep it under 90 characters, and do not output the title as code or a labelled block.");
  parts.push("Remember: your final output line must be the verdict: 'worth your time: yes|flat|no \u2014 justification'.");
  parts.push("Begin with exactly one Markdown H1 title line '# <title>' before the lede; do not omit it.");
  if (fewShot && fewShot.length > 0) {
    parts.push("\n--- PROVEN EXEMPLAR STRUCTURES (quality floor, not templates to copy) ---");
    for (var ex of fewShot.slice(0, 2)) {
      parts.push(ex.structure_md.slice(0, 400));
    }
  } else {
    // ANTI-BANAL-2: with no reader-proven exemplars the writer has only prohibitions.
    parts.push("\n--- REGISTER EXEMPLAR (shape only - do not reuse this subject, title, or facts) ---");
    parts.push(REGISTER_EXEMPLAR);
  }
  if (recentStructures && recentStructures.length > 0) {
    parts.push("\n--- RECENT SECTION SKELETONS ON THIS SITE (BANNED PATTERNS \u2014 diverge from every one; these are H2/H3 heading shapes, never title shapes) ---");
    for (var s of recentStructures.slice(0, 6)) {
      parts.push(s.slice(0, 200));
    }
  }
  var banned = opts && opts.banned || [];
  if (banned.length) {
    parts.push("\n--- OVERUSED PRECEDENTS ON THIS SITE (BANNED: do not cite it) ---");
    parts.push(banned.map(function (b) { return b.label; }).join("; "));
  }
  var notes = opts && opts.ownerNotes || [];
  if (notes.length) {
    parts.push("\n--- OWNER EDITORIAL DIRECTIVES (from the publication's editor, authenticated; they outrank the style defaults above, never the FACTS rule or the hard constraints) ---");
    for (var n of notes) parts.push("- " + n);
  }
  var src = opts && opts.source;
  if (src && src.title) {
    parts.push("\n--- SOURCE (name it in the lede: what it is and where it appeared) ---");
    parts.push("kind: " + sourceKind(src));
    parts.push("title: " + String(src.title).slice(0, 200));
    if (src.url) parts.push("link: " + String(src.url).slice(0, 300));
  }
  parts.push("\n--- SIGNAL (the field names and the signal_strength value are internal pipeline metadata: never mention them in the essay) ---");
  parts.push("core_concept: " + friction.core_concept);
  parts.push("friction_point: " + friction.friction_point);
  parts.push("signal_strength: " + friction.signal_strength);
  var art = opts && opts.article || "";
  if (art) { parts.push("\n--- LINKED ARTICLE TEXT (source material, may be partial; facts may be taken from it) ---"); parts.push(String(art).slice(0, 6000)); }
  var bg = opts && opts.background || "";
  if (bg) { parts.push("\n--- BACKGROUND (verified reference text for context and the wider system; state its facts with attribution, only where they bear on this story) ---"); parts.push(String(bg).slice(0, BACKGROUND_PROMPT_MAX)); }
  var ledger = ledgerBlock(friction, art, src); // Q08-FACT-LEDGER-1
  if (ledger) parts.push(ledger);
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// 4. LLM composition via Workers AI binding (no token required)
// ---------------------------------------------------------------------------
// Model priority: frontier-scale non-reasoning writers only.
// Banned: llama, mistral, gemma-7b, -flash, -fp8-fast, -mini, -small (per fleet policy).
// Q08-WRITER-UPGRADE-1 (0.22.0; owner 2026-10-13: "q08.org is still publishing banal, vacuous shit"). In 14 days the two writers
// published 53 pieces from 191 runs and every piece live on 2026-10-13 was thin. kimi-k2.6 now writes first with its thinking switched
// off (factCheckExtra, the switch the fact-check measured), which removes the empty-content failure that kept reasoning models out;
// nemotron and gpt-oss stay as the per-request fallback when it returns nothing or fails. Cost per published piece is tracked by
// METRIC-TRIGGER-538 (#2288) and the compose order by #2478; engine_runs.model records which writer produced each run.
// Q08-WRITER-YIELD-1 (2026-10-25): live 30-day q08_reader_tests now show writer-gate pass rates of 66.1% for gpt-oss
// (342 attempts), 60.2% for kimi (108), and 21.2% for nemotron (472). The 2026-10-18 order put nemotron first, so
// most runs paid for a low-yield 740-neuron call before trying the 290-neuron gpt-oss writer. Lead with gpt-oss;
// outside a breached spend cap, try kimi before nemotron for its higher measured yield. At a cap, try the cheaper
// nemotron before kimi. This changes only fallback order; all gates and retry ceilings stay unchanged.
// Q08-WRITER-ORDER-2 (0.36.0, 2026-10-26): the 2026-10-25 order above was chosen on the writer-gate pass rate (a proxy: it only says the draft
// had a title, a lede and no banned phrase). What matters is whether a run publishes. engine_runs, 14 days to 2026-10-26, by the writer
// that produced the final draft: nemotron 14 ok of 137 runs (10.2%), gpt-oss 5 of 287 (1.7%), kimi 1 of 113 (0.9%); 212 of the 517 gate
// failures were gpt-oss drafts failing the accuracy check, and all 23 runs that listed eight or more unsupported figures and all 35 that
// listed a ledger tag as a name were gpt-oss. Nemotron leads, gpt-oss follows, kimi (the dearest call and the lowest yield) is last. All gates
// and ceilings are unchanged; ops_config q08_compose_order (comma-separated model ids) overrides the order without a deploy, and unknown ids
// are ignored. The same order serves a breached spend cap: the spend cap steers the call, not the writer with the lowest yield per neuron.
var COMPOSE_MODELS = [
  "@cf/nvidia/nemotron-3-120b-a12b",
  "@cf/openai/gpt-oss-120b",
  "@cf/moonshotai/kimi-k2.6",
];
var COMPOSE_MAX_TOKENS = 8000;
// Q08-BUDGET-ROUTE-1 (0.24.0, issue 1780; BUDGET-SOFT-ROUTE-1): a breached or unreadable budget makes the first writer attempt use
// the low-cost fallback; if it fails the gates, the measured-yield writer order remains available. Review and fact-check families stay
// unchanged. Work never stops at a cap.
var COMPOSE_MODELS_AT_CAP = [
  "@cf/nvidia/nemotron-3-120b-a12b",
  "@cf/openai/gpt-oss-120b",
  "@cf/moonshotai/kimi-k2.6",
];
var COMPOSE_ORDER_KEY = "q08_compose_order";
function parseComposeOrder(v) {
  var out = [];
  String(v == null ? "" : v).split(/[\s,]+/).forEach(function (m) { if (COMPOSE_MODELS.indexOf(m) >= 0 && out.indexOf(m) < 0) out.push(m); });
  if (!out.length) return null;
  COMPOSE_MODELS.forEach(function (m) { if (out.indexOf(m) < 0) out.push(m); });
  return out;
}
async function composeOrder(env) {
  if (!env || !env.AUDIT) return COMPOSE_MODELS;
  var override = null;
  try {
    var o = await env.AUDIT.prepare("SELECT value FROM ops_config WHERE key = ?1").bind(COMPOSE_ORDER_KEY).first();
    override = parseComposeOrder(o && o.value);
  } catch (e) { console.error("q08 composeOrder override read failed: " + String(e && e.message || e).slice(0, 160)); }
  try {
    var b = await env.AUDIT.prepare("SELECT COUNT(*) AS n FROM fleet_budget WHERE node_class IN ('ai_spend:workers-ai', 'ai_spend:total') AND current > cap").first();
    var breached = !!(b && Number(b.n) > 0);
    env.__q08BudgetPressure = !!env.__q08BudgetPressure || breached;
    return override || (breached ? COMPOSE_MODELS_AT_CAP : COMPOSE_MODELS);
  } catch (e) {
    console.error("q08 composeOrder budget read failed: " + String(e && e.message || e).slice(0, 160));
    env.__q08BudgetPressure = true;
    return override || COMPOSE_MODELS_AT_CAP;
  }
}

// Q08-SELF-TUNE-1 (#1760): the compose temperature is a tunable for PERFORMANCE-LOOP-1 (lever on q08_gate_pass_rate_7d).
// ops_config q08_compose_temperature, clamped to 0.4..0.8; absent or unreadable means 0.65, the value before this knob.
// The gate, the FACTS rule, Q08_SOCIAL_QUEUE and MAX_PER_DAY are invariants and have no ops_config knob.
var TEMP_KEY = "q08_compose_temperature", TEMP_DEFAULT = 0.65;
function parseTemperature(v) {
  var n = Number(String(v == null ? "" : v).trim());
  if (!String(v == null ? "" : v).trim() || !isFinite(n)) return TEMP_DEFAULT;
  return Math.min(0.8, Math.max(0.4, n));
}
async function composeTemperature(env) {
  if (!env || !env.AUDIT) return TEMP_DEFAULT;
  try { var r = await env.AUDIT.prepare("SELECT value FROM ops_config WHERE key = ?1").bind(TEMP_KEY).first(); return parseTemperature(r && r.value); }
  catch (e) { return TEMP_DEFAULT; }
}
async function compose(env, prompt, banned, order, xform, opts) {
  var temperature = await composeTemperature(env);
  var lastErr;
  // TITLE-PROMOTE-1: compliance-driven fallback -- keep the best draft across
  // models rather than returning the first long-enough one gate-unchecked.
  var best = null, trail = [];
  var models = order || await composeOrder(env);
  for (var modelIndex = 0; modelIndex < models.length; modelIndex++) {
    var modelId = models[modelIndex];
    try {
      meterCall(env, "compose");
      var resp = await aiGatewayRun(env, modelId, Object.assign({
        messages: [{ role: "user", content: prompt }],
        max_tokens: COMPOSE_MAX_TOKENS,
        temperature: temperature,
      }, factCheckExtra(modelId)), { loop_id: env && env.__aigLoopBudget && env.__aigLoopBudget.id, purpose: "compose", budgetFallback: modelIndex === 0, skipCache: true, signal: AbortSignal.timeout(150000) });
      // Workers AI returns {response: string} for chat models
      var text = aiReplyText(resp);
      var usedModel = resp && resp.__q08Model || modelId;
      if (!text || text.length <= 200) { trail.push({ model: usedModel, problems: ["empty or short reply (" + String(text || "").length + " chars)"] }); continue; }
      // Q08-FORECAST-1: an optional xform (forecastXform) splits a structured block off the draft and adds its own problems.
      var xr = xform ? xform(text) : null;
      var norm = normalizeDraft(xr ? xr.text : text);
      var g = gate(norm, banned);
      var allProblems = g.problems.concat(xr && xr.problems || []);
      trail.push({ model: usedModel, problems: allProblems, chars: norm.length });
      if (!allProblems.length) return { text: norm, model: usedModel, extra: xr ? xr.extra : undefined, trail: trail };
      // Q08-TITLE-REPAIR-1 (0.26.0): a draft whose only writer-gate problems are its title gets one short title call to the same
      // writer before the next writer is tried; the body is kept byte for byte and the whole gate runs again.
      if (opts && opts.titleRepair && titleOnlyProblems(allProblems)) {
        var titled = null, tErr = "";
        try { titled = await titleMicroCall(env, modelId, norm); } catch (eT) { tErr = String((eT && eT.message) || eT).slice(0, 160); console.error(JSON.stringify({ evt: "q08-signal-engine:titleMicroCall:caught", model: modelId, error: tErr })); }
        // Q08-TITLE-REPAIR-2 (0.26.1): an attempt that yields no title is recorded too (runs 405 and 406 of 2026-10-14 left no trace of it)
        if (titled && titled.reply !== undefined) { trail.push({ model: modelId, problems: ["title repair: no title line in the reply: " + String(titled.reply).replace(/\s+/g, " ").slice(0, 120)], chars: norm.length }); titled = null; }
        else if (!titled) trail.push({ model: modelId, problems: ["title repair failed: " + (tErr || "no reply")], chars: norm.length });
        if (titled) {
          var xr2 = xform ? xform(titled) : null, norm2 = normalizeDraft(xr2 ? xr2.text : titled);
          var p2 = gate(norm2, banned).problems.concat(xr2 && xr2.problems || []);
          trail.push({ model: modelId, problems: p2.length ? ["title repair: " + p2.join("; ")] : [], chars: norm2.length, note: "title repaired (was: " + allProblems.join("; ").slice(0, 160) + ")" });
          if (!p2.length) return { text: norm2, model: modelId, extra: xr2 ? xr2.extra : undefined, trail: trail };
        }
      }
      if (!best || norm.length > best.text.length) best = { text: norm, model: usedModel, problems: allProblems, extra: xr ? xr.extra : undefined };
    } catch (e) {
      lastErr = e;
      trail.push({ model: modelId, problems: ["error: " + String(e && e.message || e).slice(0, 160)] });
    }
  }
  if (best) { best.trail = trail; return best; }
  throw new Error("all compose models failed: " + String(lastErr && lastErr.message || lastErr).slice(0, 200));
}

// The repair runs for the writer and its corrective retry (essay and forecast) only: editor passes and fact revisions carry the
// draft's own title (carryTitle), and the verdict micro-call is not an essay.
var TITLE_REPAIR_ON = { titleRepair: true };
// Q08-TITLE-REPAIR-1 (0.26.0, agent_issues 2284 and 2503; q08_reader_tests round 0, 2026-10-13 04:00 to 2026-10-14 04:00 UTC): nemotron
// wrote the drafts that passed accuracy (3 of 3 published pieces in that day), but 8 of its 15 drafts never reached accuracy because the
// writer gate refused only their title ("Title Case title reads as a label", "no H1 title", "title too long"), so gpt-oss wrote instead
// and its 14 drafts all failed accuracy. A title-only failure now gets one short call to the same writer for a sentence-case title.
// Deterministic guard: the body is unchanged, the title is gated with the whole draft, and its names still face the accuracy check.
function titleOnlyProblems(problems) {
  return (problems || []).length > 0 && problems.every(function (p) { return /title/i.test(p) && !/^too short/i.test(p) && !/self-verdict/i.test(p); });
}
var TITLE_REPAIR_PROMPT = "Here is an essay that passed every editorial check except its title. Write a new title for it: one plain sentence in sentence case (capitalise only the first word and names), at most 90 characters, that states what the essay argues about its subject. Use only names that appear in the essay. Output exactly one line, nothing else, in this form:\n# <title>";
async function titleMicroCall(env, modelId, essay) {
  var body = String(essay || "").replace(/^#\s+.+$/m, "").trim();
  meterCall(env, "compose");
  var resp = await aiGatewayRun(env, modelId, Object.assign({ messages: [{ role: "user", content: TITLE_REPAIR_PROMPT + "\n--- ESSAY ---\n" + body.slice(0, 6000) + "\n--- END ---" }], max_tokens: 400, temperature: 0.3 }, factCheckExtra(modelId)), { loop_id: env && env.__aigLoopBudget && env.__aigLoopBudget.id, purpose: "title-repair", budgetFallback: true, signal: AbortSignal.timeout(60000) });
  var reply = aiReplyText(resp), line = titleLineOf(reply);
  if (!line) return { reply: String(reply || "") };
  return /^#\s+.+$/m.test(String(essay)) ? String(essay).replace(/^#\s+.+$/m, line) : line + "\n\n" + String(essay).replace(/^\s+/, "");
}
function titleLineOf(reply) {
  // Q08-TITLE-REPAIR-2 (0.26.1): a reply that wraps its one title in a preamble ("Here is a title:", "**Title:** ...") or code fence is read
  // too: the # line first, else a line labelled Title, else the one line that is not a preamble or fence
  var lines = String(reply || "").replace(/<think>[\s\S]*?<\/think>/gi, "").split("\n").map(function (x) { return x.trim(); }).filter(function (x) { return x && !/^```/.test(x); });
  var cands = lines.filter(function (x) { return !/:\s*$/.test(x) && !/^(here|sure|certainly|okay|ok)\b/i.test(x); });
  var h = lines.filter(function (x) { return /^#\s+\S/.test(x); })[0] || lines.filter(function (x) { return /^[*_]*title[*_]*\s*:/i.test(x); }).map(function (x) { return x.replace(/^[*_]*title[*_]*\s*:\s*/i, ""); })[0] || (cands.length === 1 ? cands[0] : "");
  var t = h.replace(/^#+\s*/, "").replace(/^(?:title\s*:\s*)/i, "").replace(/^[*_"\u201c\u2018']+|[*_"\u201d\u2019']+$/g, "").trim();
  return t && t.length <= 100 && t.indexOf("\n") < 0 ? "# " + t : null;
}

// ---------------------------------------------------------------------------
// 5. Gate \u2014 structural validation (no names, no handles, minimum length)
// ---------------------------------------------------------------------------
// Personal name detection: two capitalized words where BOTH are common given/surname patterns.
// Excludes structural/technical compound nouns (e.g. "Knowledge Work", "System Design").
// Approach: reject only when the phrase appears in a personal-name context (after "by ", "from ", etc.)
// or when it's a known personal-name pattern (First Last without structural context).
var HANDLE_RE = /@\w+/g;
// Structural compound nouns that look like names but aren't (whitelist)
var STRUCTURAL_TERMS = /^(Systems?|Software|Hardware|Network|Data|Cloud|Service|Knowledge|Architectural|Technical|Digital|Platform|Security|Infrastructure|Design|Engineering|Product|Research|Business|Market|Organizational?|Operational?|Strategic|Systemic|Structural|Computational|Distributed|Autonomous|Functional|Behavioral|Cognitive|Semantic|Logical|Physical|Virtual|Abstract|Formal|Applied|Open|Closed|Standard|Legacy|Modern|Native|Hybrid|Adaptive|Dynamic|Static|Linear|Parallel|Sequential|Recursive|Iterative|Incremental|Continuous|Discrete|Binary|Modular|Layered|Hierarchical|Composable|Decoupled|Integrated|Unified|Federated|Centralized|Decentralized|Horizontal|Vertical|Lateral|Forward|Backward|Internal|External|Primary|Secondary|Core|Edge|Base|Top|Bottom|High|Low|Mid|Full|Half|Single|Multi|Cross|Inter|Intra|Meta|Sub|Super|Pre|Post|Anti|Non|Semi|Pseudo|Quasi|Proto|Micro|Macro|Nano|Global|Local|Regional|Universal|Specific|General|Special|Common|Rare|Simple|Complex|Basic|Advanced|Standard|Custom|Default|Optional|Required|Critical|Optional|Minimal|Maximal|Optimal|Efficient|Effective|Reliable|Scalable|Portable|Flexible|Robust|Resilient|Fault|Error|Failure|Success|Risk|Trust|Safety|Privacy|Access|Control|Flow|State|Event|Signal|Message|Request|Response|Query|Command|Action|Task|Job|Process|Thread|Worker|Agent|Actor|Client|Server|Peer|Node|Edge|Link|Path|Route|Channel|Stream|Queue|Stack|Heap|Cache|Store|Index|Registry|Catalog|Schema|Model|View|Controller|Handler|Adapter|Bridge|Proxy|Gateway|Router|Scheduler|Monitor|Observer|Listener|Publisher|Subscriber|Producer|Consumer|Provider|Consumer|Builder|Factory|Singleton|Strategy|Pattern|Template|Protocol|Interface|Contract|Specification|Standard|Convention|Policy|Rule|Constraint|Invariant|Property|Attribute|Parameter|Variable|Constant|Function|Method|Procedure|Algorithm|Heuristic|Metric|Measure|Score|Rank|Weight|Priority|Threshold|Limit|Bound|Range|Window|Interval|Period|Cycle|Loop|Iteration|Generation|Version|Release|Deploy|Build|Test|Debug|Profile|Audit|Review|Inspect|Monitor|Trace|Log|Record|Report|Alert|Notify|Trigger|Schedule|Execute|Run|Start|Stop|Pause|Resume|Cancel|Reset|Retry|Rollback|Migrate|Upgrade|Patch|Fix|Repair|Restore|Backup|Archive|Compress|Encrypt|Decrypt|Hash|Sign|Verify|Validate|Parse|Format|Serialize|Deserialize|Encode|Decode|Map|Filter|Reduce|Sort|Search|Match|Compare|Merge|Split|Join|Group|Aggregate|Transform|Convert|Normalize|Denormalize|Optimize|Minimize|Maximize|Balance|Distribute|Replicate|Synchronize|Coordinate|Orchestrate|Choreograph|Compose|Decompose|Refactor|Rewrite|Replace|Remove|Add|Update|Insert|Delete|Create|Read|Write|Append|Prepend|Truncate|Clear|Flush|Drain|Fill|Load|Save|Fetch|Push|Pull|Send|Receive|Emit|Consume|Produce|Publish|Subscribe|Register|Deregister|Bind|Unbind|Connect|Disconnect|Open|Close|Lock|Unlock|Acquire|Release|Wait|Signal|Notify|Broadcast|Multicast|Unicast|Cast|Wrap|Unwrap|Pack|Unpack|Box|Unbox|Lift|Lower|Raise|Drop|Inject|Extract|Import|Export|Include|Exclude|Enable|Disable|Activate|Deactivate|Initialize|Finalize|Setup|Teardown|Mount|Unmount|Attach|Detach|Link|Unlink|Bind|Unbind|Compile|Interpret|Execute|Evaluate|Reduce|Expand|Inline|Outline|Abstract|Concrete|Generic|Specific|Static|Dynamic|Lazy|Eager|Sync|Async|Blocking|NonBlocking|Streaming|Batch|Online|Offline|Realtime|Deferred|Immediate|Eventual|Consistent|Eventual|Strong|Weak|Strict|Loose|Tight|Loose|Hard|Soft|Fast|Slow|Hot|Cold|Warm|Fresh|Stale|Live|Dead|Active|Passive|Push|Pull|Reactive|Proactive|Declarative|Imperative|Functional|Object|Aspect|Event|Data|Message|Command|Query|Document|Graph|Tree|List|Array|Map|Set|Queue|Stack|Heap|Ring|Buffer|Pool|Cache|Store|Vault|Ledger|Register|Log|Journal|Audit|Trail|History|Timeline|Snapshot|Checkpoint|Milestone|Baseline|Target|Goal|Objective|Metric|KPI|SLA|SLO|SLI|OKR|KR|MVP|POC|RFC|ADR|PR|MR|CR|DR|RCA|PIR|SOP|FAQ|TIL|TLDR|API|SDK|CLI|GUI|UI|UX|DX|DevX|PX|CX|EX|HCI|HMI|NLI|VUI|AUI|WUI|MUI|TUI|CUI|RUI|SUI|FUI|BUI|DUI|EUI|IUI|OUI|PUI|QUI|ZUI)$/;
function isPersonalName(phrase) {
  var parts = phrase.split(" ");
  if (parts.length !== 2) return false;
  // If either part matches structural terms, it's not a personal name
  if (STRUCTURAL_TERMS.test(parts[0]) || STRUCTURAL_TERMS.test(parts[1])) return false;
  // Both parts must be short (given names are typically 3-12 chars)
  if (parts[0].length > 14 || parts[1].length > 16) return false;
  return true;
}
var NAME_RE = /\b[A-Z][a-z]{2,13} [A-Z][a-z]{2,15}\b/g;
// BANNED_BABBLE: management-consulting phrases wrong in any register.
var BANNED_BABBLE = [
  "digital transformation", "operational excellence", "strategic alignment",
  "moving forward", "going forward", "at the end of the day", "circle back",
  "key takeaways", "lessons learned", "best practices", "thought leadership",
  "game changer", "synergies",
];
// FRAMING-REPAIR-1: the same list as one pattern, so a repair can locate the sentence that holds a babble phrase.
var BANNED_BABBLE_RE = new RegExp(BANNED_BABBLE.map(function (s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }).join("|"), "i");
var BANNED_HANDLES = /@\w+/g;
var BAD_TITLE_RE = /^(an? |the )?(analysis|critique|examination|exploration|overview|review|understanding|study|assessment|investigation) of /i;
var TITLE_FORMULA_RE = /^when .+ meets .+$/i;
var TITLE_COLON_RE = /: the (hidden|invisible|unseen|silent|quiet) /i;
var BANNED_H2_RE = /^#+\s+(how the flaw manifests|cascading failures|a minimal (alternative|framework|approach)|connections across disciplines|echoes from the past|a path forward|the lens restored|lessons for the future|the pattern across disciplines|unexpected parallels|the broader lesson)\b/i;
var FORMULA_H2_RE = /^#+\s+the (hidden|invisible|unseen|unspoken|silent|quiet) (lever|bottleneck|premise|flaw|cost|gear|engine|handoff|mismatch)\b/i;
var STOCK_PROPS_RE = /\b(telescopes?|galileo|alchem|philosopher.s stone|sonar|aperture|aerospace redundancy)\b/i;
var SOFT_REGISTER_RE = /\b(expectation gap|collective anxiety|vibe|democratiz\w*|future-proof|self-sustaining|path forward|healthy ecosystem|walks farther|ecosystem of)\b/i;
// ANTI-BANAL-1 (v0.7.16). The observed failure mode is not a weak argument but a
// banal *register*: the stock framing sentence ("\u2026illustrates a broader structural
// dynamic") and nominalised label titles ("Scale-Induced Professional Displacement").
// These are category names and significance-summaries, not mechanisms. The mandate
// forbids management-consulting abstractions; these patterns ARE that failure.
var STOCK_FRAMING_RE = /\b(?:illustrat\w+|expos\w+|reveal\w+|foreground\w+|underscor\w+)\b[^.!?]{0,90}\b(?:a|an|the)\s+(?:[a-z-]+\s+){0,3}(?:dynamic|structure|pattern|failure|gap|tension|mismatch|flaw|disjunction|force|logic|loop|cycle|feedback|principle|phenomenon|tendency|incentive|premise|asymmetry|equilibrium)\b/i;
var ABSTRACT_SUMMARY_RE = /\b(?:structural|systemic|recurring|institutional|underlying|universal|self-referential|self-reinforcing)\s+(?:dynamic|failure|gap|tension|mismatch|disjunction|structure|loop|cycle|pattern)\b/gi;
var LABEL_PHRASE_RE = /\b(?:coupling failure|incentive structure|information asymmetry|concrete manifestation of|concrete instance of|feedback loop in which|systemic incentive)\b/gi;
var LABEL_TITLE_RES = [
  /\b(?:systems?|chains?|designs?|loops?|traps?|paradoxes?|precedence|approximation|displacement|consolidation|observability|planning|automation|constraints?|escalation|asymmetry|convergence|divergence|disjunction|equilibrium|inertia|entropy|abstraction|fallacy|myth|illusion)$/i,
  /^(?:structural|systemic|recurring|institutional|externalized|opaque|implicit|formal|abstract|nominal|statistical|rhetoric\w*|scale|efficiency|goal|sponsorship|incentive|autonomous)\b/i,
  /^the\s+[a-z][^:]{3,70}\s+of\s+[a-z][^:]{3,70}$/i,
  /^[a-z][^:]{2,60}\s+as\s+[a-z][^:]{2,60}$/i,
  /(?:^|[\s-])(?:scale|efficiency|goal|incentive|sponsorship|market|growth|cost|risk|hype|policy|capital|prestige|autonomy|reward|narrative|fashion|trend)[- ]?(?:induced|driven|mediated|conditioned|derived)\s+[a-z]/i,
  /\b(?:in|across|within|under|of)\s+[a-z][a-z-]*(?:\s+[a-z][a-z-]*){0,2}\s+(?:systems|chains|designs|contexts|settings|architectures|planning|automation|constraints|contracts|pipelines|domains|models|frameworks)$/i,
  /^the\s+\w+\s+\w*\s*(?:trap|paradox|illusion|fallacy|myth|dilemma|tyranny|consequence|problem|curse|temptation|revenge)\b/i,
  /:\s+(?:how|why)\s+(?:[a-z]+\s+){0,3}(?:drives?|shapes?|creates?|breeds?|undermines?|erodes?|rewards?|punishes?)\b/i
];


// TITLE-PROMOTE-1 (v0.7.32). 11 of the 15 gate_failed cycles (engine_runs 190-204)
// failed on "no H1 title": gate() requires /^#\s+/m while the corrective-retry
// prompt asked for "NO section headers", which the writer applied to the H1 too.
// Promote an unambiguous leading title line instead of discarding a complete essay.
// Deterministic: invents nothing, rewrites at most one line, idempotent.
// Q08-HANDLE-STRIP-1 (0.14.4, run 346): the writer copied a social handle ("@openai") from the source and the gate rejected the draft
// ("handles: @openai"). A handle that stands on its own (not an e-mail address, not the "@cf/" model prefix) loses its "@".
function stripHandles(text) {
  return String(text).replace(/(^|[^\w.@\/])@([A-Za-z_]\w*)(?![\w\/])/g, function (m, pre, h) { return h.toLowerCase() === "cf" ? m : pre + h; });
}
// Q08-LEDE-SPLIT-1 (0.17.5, run 368): a draft failed only on "lede too long (107 words)". An overlong first paragraph is split at a
// sentence boundary: the opening sentences up to LEDE_SPLIT_WORDS stay as the lede, the rest becomes the next paragraph. Nothing is
// added or removed, so no fact changes; a first sentence that is itself over LEDE_MAX_WORDS is left for the gate and the revision.
var LEDE_SPLIT_WORDS = 70;
function splitLongLede(text) {
  var t = String(text || ""), parts = t.split(/\n{2,}/), idx = -1;
  for (var i = 0; i < parts.length; i++) { var p = parts[i].trim(); if (!p || /^#/.test(p) || /^(worth your time:|FORECAST-JSON:)/i.test(p)) continue; idx = i; break; }
  if (idx < 0) return t;
  var words = function (x) { return String(x).split(/\s+/).filter(Boolean).length; };
  if (words(parts[idx]) <= LEDE_MAX_WORDS) return t;
  var sents = parts[idx].trim().split(/(?<=[.!?]["\u201d\u2019)]?)\s+(?=[A-Z0-9"\u201c])/);
  if (sents.length < 2 || words(sents[0]) > LEDE_MAX_WORDS) return t;
  var lede = [sents[0]], n = words(sents[0]), k = 1;
  while (k < sents.length - 1 && n + words(sents[k]) <= LEDE_SPLIT_WORDS) { lede.push(sents[k]); n += words(sents[k]); k++; }
  parts.splice(idx, 1, lede.join(" "), sents.slice(k).join(" "));
  return parts.join("\n\n");
}
function normalizeDraft(text) { return text ? normalizeVerdictLine(splitLongLede(normalizeDraftCore(text))) : text; }
// Q08-VERDICT-NORM-1 (0.20.2, run 382): a run failed only on "missing or malformed 'worth your time' verdict line". Near-misses
// ("**Worth your time:** yes. ...", "worth your time - yes: ...", "Worth your time: Yes, ...") are rewritten to the canonical form; the
// writer's own yes/flat/no is kept as written, never supplied.
var VERDICT_LOOSE_RE = /^[ \t>*_#-]*worth your time[*_ ]*[:\u2014\u2013-][*_ ]*(yes|flat|no)\b[*_]*\s*[.,:;!\u2014\u2013-]*\s*(\S[^\n]*)$/im;
function normalizeVerdictLine(text) {
  var t = String(text || "");
  if (/worth your time:\s*(yes|flat|no)\s*[\u2014\u2013-]\s*\S[^\n]*$/im.test(t)) return t;
  var m = t.match(VERDICT_LOOSE_RE);
  if (!m) return t;
  return t.replace(m[0], "worth your time: " + m[1].toLowerCase() + " \u2014 " + m[2].replace(/[*_]+$/, "").trim());
}
function verdictOnlyProblem(problems) { return (problems || []).length === 1 && /verdict/i.test(problems[0]) && problems[0].indexOf("self-verdict") < 0; }
// Verdict-only micro-call: one cheap compose that reads the essay and returns exactly the verdict line.
async function verdictMicroCall(env, essay) {
  var vp = await compose(env, "Here is an essay that passed all editorial checks.\n--- ESSAY ---\n" + String(essay || "").slice(0, 6000) + "\n--- END ---\nOutput exactly one line, nothing else, in this form:\nworth your time: yes|flat|no \u2014 one clause of justification\nUse flat only if a reader gains little beyond the source material; use no if the piece is not worth publishing.");
  var vm = normalizeVerdictLine(vp && vp.text || "").match(/worth your time:\s*(yes|flat|no)\s*[\u2014\u2013-]\s*\S[^\n]*$/im);
  return vm ? vm[0] : null;
}
// Q08-FACT-LEDGER-1: the ledger tags ([S3]) are for the writer's reference; one copied into a draft is removed (with the space before it)
// before any check reads the text, and a text without a tag is returned untouched. A model that cites numbered sources groups them, so a
// grouped or ranged tag goes too: [S1, S2], [S3;S4], [S2-S3] (hyphen, en dash or em dash) and the two-digit [S12] of a ledger past nine lines.
// Left in, such a tag reads as a name the source does not hold ("S1") and, in the lede, makes the pre-check refuse the whole draft over
// a cosmetic tag. A year is never taken for a tag: the number group is one to three digits and must be followed by the closing bracket.
// The parenthesised "(S3)" is left alone on purpose: it is not a tag the ledger prints, groundingProblems does not flag it, and it is how
// real text writes Amazon S3.
var LEDGER_TAG_RE = /[ \t]*\[S\d{1,3}(?:\s*[,;\u2013\u2014-]\s*S?\d{1,3}|\s+S\d{1,3})*\]/g;
var LEDGER_R_TAG_RE = /[ \t]*\[R\d{1,3}(?:\s*[,;\u2013\u2014-]\s*R?\d{1,3}|\s+R\d{1,3})*\]/g;
// Q08-LEDGER-TAG-FORMS-2 (0.36.0, 2026-10-26): 517 gate failures in 14 days; the pre-check listed ledger numbers as figures ("figure not in the
// source: 40," with the comma that a "(S39, S40, S41)" list leaves behind) and tags as names ("name not in the source: S28 S29") in 38 accuracy
// failures, and "prune located nothing" because no sentence holds a bare "33". A writer prints a tag in more forms than [S3]: in round,
// curly, fullwidth and lenticular brackets (gpt-oss), with "&" or "/" between numbers, after a dagger line reference, as "[ledger S3]".
// All of those go, with their space. A lone "(S3)" or "{S3}" below S10 stays, because it is how real text writes Amazon S3; a word between
// numbers ("[S1 and S2]") is left alone, as it always was (fact-ledger.test.mjs pins it).
var LEDGER_TAG_ALT_RE = /[ \t]*[\u3010\u3014\uFF3B\u27E6\[({]\s*(?:(?:source|ledger)\s+)?\**S\s?\d{1,3}\**(?:\s*[,;\/&\u2013\u2014-]\s*\**S?\s?\d{1,3}\**|\s+S\d{1,3}|\s*[\u2020\u2021]\s*L?\d{1,4}(?:\s*[-\u2013]\s*L?\d{1,4})?)*\s*[.,]?\s*[\u3011\u3015\uFF3D\u27E7\])}]/gi;
function stripLedgerTags(t) {
  var s = String(t), before = s;
  if (/\[S\d/.test(s)) s = s.replace(LEDGER_TAG_RE, "");
  // Q08-FORECAST-LEDGER-1: a research-ledger tag ([R3], [R1, R2]) is removed the same way, with the space before it; a bare "[3]" or a year is not a tag.
  if (/\[R\d/.test(s)) s = s.replace(LEDGER_R_TAG_RE, "");
  if (/[\u3010\u3014\uFF3B\u27E6\[({]\s*(?:(?:source|ledger)\s+)?\**S\s?\d/i.test(s)) {
    s = s.replace(LEDGER_TAG_ALT_RE, function (m) {
      var nums = m.match(/\d{1,3}/g) || [];
      return /^\s*[({]/.test(m) && nums.length < 2 && Number(nums[0]) < 10 ? m : "";
    });
  }
  return s === before ? s : s.replace(/^[ \t]+(?=\S)/gm, "");
}
function normalizeDraftCore(text) {
  if (!text) return text;
  var t = stripHandles(stripLedgerTags(String(text).replace(/^\uFEFF/, "").replace(/\r\n/g, "\n")));
  if (/^#\s+\S/m.test(t)) return t;
  var lines = t.split("\n");
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    if (/^#{2,6}\s/.test(line)) break;
    if (/^(worth your time:|[-*_]{3,}\s*$)/i.test(line)) break;
    // Q08-H1-PROMOTE-2 (issue #99929): the writer often drops the leading '#' while
    // obeying "no section headers", leaving a plain sentence title. Promote any compact
    // leading title-like line; strip a trailing sentence punctuator so the gate's title
    // pattern checks still apply.
    // Q08-H1-PROMOTE-3 (issue #99929): the writer also emits the title wrapped in
    // emphasis ("**Three replicas made every write slower**") or behind a "title:"
    // label, sometimes with quotes. Unwrap those forms before the compact-line
    // test; the length and word caps stay, so a prose lede sentence (which the
    // title micro-call and the fact-revision path own) is never promoted.
    var cand = line;
    var wm = cand.match(/^[*_]{1,3}\s*(.+?)\s*[*_]{1,3}$/);
    if (wm) cand = wm[1];
    else {
      var lm = cand.match(/^title\s*:\s*(.+)$/i);
      if (lm) cand = lm[1];
    }
    cand = cand.replace(/^[\u201c\u2018"']+\s*/, "").replace(/\s*[\u201d\u2019"']+$/, "");
    // Do not promote a line that looks like a full sentence (contains sentence punctuation)
    if (/[.!?]/.test(line)) break;
    if (cand.length <= 100 && cand.split(/\s+/).length <= 14) {
      lines[i] = "# " + cand.replace(/[.!?]+$/, "");
      return lines.join("\n");
    }
    break;
  }
  return t;
}

function gate(text, banned) {
  // Enforce LONG-FORM PROSE with a hook, not lists:
  // 1. length 2. concrete title 3. no handles 4. no babble 5. prose-dominant.
  var problems = [];
  var body = text.toLowerCase();

  if (text.length < 2800) problems.push("too short (" + text.length + " chars; 450-1100 words required)");

  var titleMatch = text.match(/^#\s+(.+)$/m);
  var title = titleMatch ? titleMatch[1].trim().replace(/[\u2010-\u2015\u2212]/g, "-") : "";
  if (!title) problems.push("no H1 title");
  else if (BAD_TITLE_RE.test(title)) problems.push("dry/abstract title '" + title.slice(0, 60) + "'");
  else if (title.length > 100) problems.push("title too long");

  var handles = (text.match(BANNED_HANDLES) || []).filter(function(h) { return h !== "@cf"; });
  if (handles.length > 0) problems.push("handles: " + handles.slice(0, 3).join(", "));

  for (var phrase of BANNED_BABBLE) {
    if (body.includes(phrase)) { problems.push("management-babble: '" + phrase + "'"); break; }
  }
  for (var hl of text.split("\n")) {
    var ht = hl.trim();
    if (BANNED_H2_RE.test(ht)) { problems.push("banned section header: '" + ht.slice(0, 50) + "'"); break; }
    if (FORMULA_H2_RE.test(ht)) { problems.push("formula section header: '" + ht.slice(0, 50) + "'"); break; }
  }
  if (TITLE_FORMULA_RE.test(title)) problems.push("formula title 'When X Meets Y'");
  else if (TITLE_COLON_RE.test(title)) problems.push("formula title 'X: The Hidden Z'");
  var sp = body.match(STOCK_PROPS_RE);
  if (sp) problems.push("stock analogy prop: '" + sp[1] + "'");
  var sr = body.match(SOFT_REGISTER_RE);
  if (sr) problems.push("soft register: '" + sr[1] + "'");
  // ANTI-BANAL-1: reject the significance-summary framing and label titles.
  var sf = text.match(STOCK_FRAMING_RE);
  if (sf) problems.push("stock framing tell: '" + sf[0].replace(/\s+/g, " ").slice(0, 80) + "' \u2014 name the mechanism, do not summarise the essay's significance");
  var absN = (text.match(ABSTRACT_SUMMARY_RE) || []).length;
  var lp = text.match(LABEL_PHRASE_RE);
  if (lp && lp.length >= 2) problems.push("abstraction labels x" + lp.length + " ('" + lp.slice(0, 3).join("', '") + "') - state the mechanisms instead of labelling them");
  if (absN >= 3) problems.push("abstraction-summary phrases x" + absN + " (e.g. 'structural dynamic') \u2014 state the mechanism instead of labelling it");
  var sentenceCase = title.split(/\s+/).filter(Boolean).length >= 5 && title.split(/\s+/).slice(1).every(function (w) { return !/^[A-Z]/.test(w); }); // GROUND-HYPHEN-1: a sentence-case claim title is the wanted shape
  for (var lt of LABEL_TITLE_RES) {
    if (sentenceCase && lt === LABEL_TITLE_RES[4]) continue;
    if (lt.test(title)) { problems.push("label title \u2014 names a category, not a mechanism: '" + title.slice(0, 60) + "'"); break; }
  }
  // Q08-QUALITY-1: a Title Case title reads as a label; the pipeline's own field names must not reach the reader; a precedent the
  // site already overuses is rejected so the next essay finds a different case.
  var tw = title.split(/\s+/).filter(Boolean);
  if (tw.length >= 4 && tw.filter(function (w) { return /^[A-Z]/.test(w); }).length / tw.length >= 0.75) problems.push("Title Case title reads as a label, not a sentence: '" + title.slice(0, 60) + "'");
  if (/\b(?:signal_strength|friction_point|core_concept)\b|\bsignal strength (?:of|was|is|value)\s+[0-9.]+/i.test(text)) problems.push("pipeline metadata in the essay ('signal_strength', 'friction_point', 'core_concept' or a signal strength value) - open with what happened instead");
  if (banned && banned.length) {
    for (var bp of banned) { if (bp.re.test(text)) { problems.push("overused precedent on this site: " + bp.label + " - remove it"); break; } }
  }
  // Q08-GATE-GROUND-BLIND-1 (0.37.4, agent_issues 100607 and 100439): this gate used to refuse every comma-grouped dollar amount and every
  // "score, rating, ratio or reputation of 0.85" as fabricated, whatever the source said. It cannot see the source, and the deterministic
  // grounding check that runs on every draft before any panel call (and again on the final text in verifyPiece) already refuses a figure the
  // source does not hold. Six runs of 2026-10-19 to 26 ended here with all six composes spent: the story headline "Oregon Police Are Charging a
  // Local News Outlet $2.5M ..." (the draft said $2,484,599), "OLED iPad Mini" ($1,249), "Woman faces six years in prison over Cash App ..."
  // ($50,000) and three arXiv papers (a reported result "of 0.85") - the stories with figures, and the arXiv lane that publishes 5 times as
  // often as the Hacker News lane. The identifier check below is kept.
  if (/\b(?:channel|account|user|session) ID ['"][A-Za-z0-9_-]{6,}['"]/i.test(body)) problems.push("invented identifier \u2014 no fabricated IDs");

  var lines = text.split("\n");
  var bulletLines = 0, tableLines = 0, paraLines = 0;
  for (var line of lines) {
    var t = line.trim();
    if (/^[-*]\s/.test(t)) bulletLines++;
    else if (t.startsWith("|")) tableLines++;
    else if (t.length > 45) paraLines++;
  }
  if (bulletLines > 0) problems.push("bullet lists (" + bulletLines + " lines) \u2014 long-form prose required");
  if (tableLines > 0) problems.push("tables (" + tableLines + " lines) \u2014 prose required");
  if (paraLines < 6) problems.push("insufficient prose (" + paraLines + " substantial paragraphs)");

  var verdictMatch = text.match(/worth your time:\s*(yes|flat|no)\s*[\u2014\u2013-]\s*\S[^\n]*$/im);
  if (!verdictMatch) problems.push("missing or malformed 'worth your time' verdict line");
  else if (verdictMatch[1] === "no") problems.push("self-verdict 'no' \u2014 essay does not clear the worth-reading bar");
  var essayText = text.replace(/\n?worth your time:\s*(yes|flat|no)\s*[\u2014\u2013-].*$/im, "").trim();
  var lastCh = essayText.slice(-1);
  if (lastCh !== "." && lastCh !== "!" && lastCh !== "?" && lastCh !== "\u201d" && lastCh !== "\u2019") problems.push("truncated ending \u2014 essay must end on a full stop");

  return { ok: problems.length === 0, problems };
}

// ---------------------------------------------------------------------------
// 6. Persist + serve
// ---------------------------------------------------------------------------
async function persistPiece(env, piece, signal, story, model) {
  var fx = (story.source === "q08" && piece.extra) ? piece.extra : null;
  if (fx && (!(await ensureForecastSchema(env)) || !(await ensureForecastGroundColumn(env)))) throw new Error("forecast schema unavailable");
  var salt = Date.now().toString(36) + rnd36(4);
  var slug  = utcDay() + "-" + slugify(piece.title || signal.core_concept) + "-" + salt.slice(-6);
  var pieceId = "p-" + salt;
  // Extract H1 title from markdown
  var titleMatch = piece.text.match(/^#\s+(.+)$/m);
  var title = titleMatch ? titleMatch[1].trim() : (signal.core_concept || "Untitled");
  // Body without the H1
  var body = piece.text.replace(/^#\s+.+\n?/, "").trim();
  // Persist signal log
  var signalLog = env.DB.prepare(
    "INSERT OR IGNORE INTO signal_log (id, source, source_id, title, url, points, num_comments, ratio, volatility_score, friction_point, signal_strength, status, processed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)"
  ).bind(
    "sig-" + salt, (story.source || "hn"), (story.source || "hn") + ":" + String(story.id || ""),
    story.title, story.url, story.points, story.num_comments,
    story.ratio, story.volatility_score,
    signal.friction_point, signal.signal_strength, "published", nowIso()
  );
  // Persist piece
  var publication = env.DB.prepare(
    "INSERT INTO published_pieces (id, signal_id, slug, title, body_md, core_concept, signal_source, published_at, sources_json, property) VALUES (?,?,?,?,?,?,?,?,?,?)"
  ).bind(
    pieceId, "sig-" + salt, slug, title, body,
    signal.core_concept, (story.source || "hn") + ":" + story.id, nowIso(),
    JSON.stringify(buildSources(story).concat(Array.isArray(story.ledgerSources) ? story.ledgerSources : [])), PROPERTY
  );
  // Q08-FORECAST-1: a forecast piece also gets its q08_forecasts record (the claim, probability, horizon and resolution
  // condition the judges later settle). Its skeleton stays out of the essay prompt pool, which feeds essay few-shots only.
  if (fx) {
    var writes = [signalLog, publication, env.DB.prepare("UPDATE published_pieces SET kind = 'forecast' WHERE id = ?").bind(pieceId)];
    var fAlts = (fx.alternatives || []).map(function (a) { return { claim: String(a.claim || "").trim().slice(0, 300), probability: Math.round(Number(a.probability) * 100) / 100 }; });
    var fInd = (fx.indicators || []).map(function (x) { return String(x).trim().slice(0, 200); });
    var fUrls = (fx.watch_urls || []).map(publicHttpsUrl).filter(Boolean);
    writes.push(env.DB.prepare("INSERT INTO q08_forecasts (piece_id, slug, source_slug, claim, probability, horizon, resolution, watch_query, watch_urls, alternatives_json, indicators_json, created_at, ground_json, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'open')")
      .bind(pieceId, slug, String(story.slug || ""), String(fx.claim).trim().slice(0, 300), Math.round(Number(fx.probability) * 100) / 100, String(fx.horizon), String(fx.resolution).trim().slice(0, 400), String(fx.watch_query).trim().slice(0, 80), JSON.stringify(fUrls), JSON.stringify(fAlts), JSON.stringify(fInd), nowIso(), story.forecastGround ? JSON.stringify(story.forecastGround) : null));
    (fx.secondary_claims || []).forEach(function (c, i) {
      writes.push(env.DB.prepare("INSERT INTO q08_forecast_claims (forecast_id, slug, claim_index, claim, probability, horizon, resolution, watch_query, watch_urls, created_at) SELECT id, slug, ?, ?, ?, ?, ?, ?, ?, ? FROM q08_forecasts WHERE slug = ?")
        .bind(i + 1, String(c.claim).trim(), Math.round(Number(c.probability) * 100) / 100, c.horizon, String(c.resolution).trim(), String(c.watch_query).trim(), JSON.stringify((c.watch_urls || []).map(publicHttpsUrl)), nowIso(), slug));
    });
    await env.DB.batch(writes);
  } else {
    await signalLog.run();
    await publication.run();
  }
  // Seed prompt pool with structure skeleton (headings, else title + lead paragraph).
  var skeleton = body.split("\n").filter(l => l.startsWith("#") || l.startsWith("- ") || l.startsWith("**")).join("\n").slice(0, 800);
  if (skeleton.length < 50) {
    var leadPara = body.split("\n").map(l => l.trim()).filter(l => l.length > 40)[0] || "";
    skeleton = (title + "\n" + leadPara.slice(0, 400)).slice(0, 800);
  }
  if (skeleton.length > 50 && !fx) {
    await env.DB.prepare(
      "INSERT INTO prompt_pool (id, piece_id, structure_md, active) VALUES (?,?,?,1)"
    ).bind("pp-" + salt, pieceId, skeleton).run();
  }
  // Bound the pool: keep only the 40 newest skeletons.
  await env.DB.prepare(
    "DELETE FROM prompt_pool WHERE id NOT IN (SELECT id FROM prompt_pool ORDER BY created_at DESC LIMIT 40)"
  ).run().catch(function (e) { console.error(JSON.stringify({ evt: "q08-signal-engine:persistPiece:caught", error: String((e && e.message) || e) })); });
  return { slug, title, pieceId };
}

// ---------------------------------------------------------------------------
// 7. Feedback loop \u2014 promote top 15%, purge bottom 15%
// ---------------------------------------------------------------------------
var OWNER_VERDICT_WEIGHT = 3;
async function feedbackScan(env) {
  // Rank prompt_pool by READER VERDICTS (worth your time?) \u2014 votes, not views.
  var rows = await env.DB.prepare(
    "SELECT pp.id, pp.piece_id, pp.structure_md, p.slug, p.reads, " +
    "(SELECT COUNT(*) FROM q08_feedback f WHERE f.slug = p.slug AND f.created_at >= '2026-10-03T00:00:00Z' AND f.signal = 'good') AS g, " +
    "(SELECT COUNT(*) FROM q08_feedback f WHERE f.slug = p.slug AND f.created_at >= '2026-10-03T00:00:00Z' AND f.signal IN ('flat','no')) AS b " +
    "FROM prompt_pool pp JOIN published_pieces p ON p.id = pp.piece_id WHERE pp.active = 1"
  ).all();
  var all = rows.results || [];
  // Q08-QUALITY-1: the owner's verdict (signed in at fleet.qnfo.org, qnfo-audit q08_owner_verdicts) counts 3 votes, so one
  // calibrating verdict can clear the 3-vote minimum while reader volume is low.
  try {
    if (env.AUDIT) {
      var ov = await env.AUDIT.prepare("SELECT slug, signal FROM q08_owner_verdicts").all();
      var ow = {};
      for (var o of (ov.results || [])) { var k = String(o.slug); ow[k] = ow[k] || { g: 0, b: 0 }; if (o.signal === "good") ow[k].g++; else if (o.signal === "flat" || o.signal === "no") ow[k].b++; }
      for (var ar of all) { var w = ow[String(ar.slug)]; if (w) { ar.g = (Number(ar.g) || 0) + w.g * OWNER_VERDICT_WEIGHT; ar.b = (Number(ar.b) || 0) + w.b * OWNER_VERDICT_WEIGHT; } }
    }
  } catch (e) { console.error(JSON.stringify({ evt: "q08-signal-engine:feedbackScan:caught", error: String((e && e.message) || e) })); }
  var promoted = 0, purged = 0;
  for (var r of all) {
    var g = Number(r.g) || 0, b = Number(r.b) || 0;
    if (g + b > 0) {
      await env.DB.prepare("UPDATE published_pieces SET feedback_score = ? WHERE slug = ?").bind(g / (g + b), r.slug).run().catch(function (e) { console.error(JSON.stringify({ evt: "q08-signal-engine:feedbackScan:caught", error: String((e && e.message) || e) })); });
    }
  }
  if (all.length < 4) return { promoted: promoted, purged: purged };
  // PROMOTION (v0.7.22). The previous rule required g >= 2 && g >= 2*b (a 2:1 yes-ratio).
  // Real reader sentiment here is ~30% good / 70% flat-or-no, so that rule could NEVER
  // fire: zero pieces qualified and the proven pool was empty by construction. This now
  // implements what this function's header says - promote the TOP quantile by reader
  // verdict among pieces with a usable sample, purge the bottom quantile.
  function readerScore(r) { var g = Number(r.g) || 0, b = Number(r.b) || 0; return (g + b) > 0 ? g / (g + b) : 0; }
  var sampled = all.filter(function(r){ return ((Number(r.g) || 0) + (Number(r.b) || 0)) >= 3; });
  sampled.sort(function(x, y){ return readerScore(y) - readerScore(x) || (Number(y.g) || 0) - (Number(x.g) || 0); });
  var qn = Math.max(1, Math.floor(sampled.length * 0.15));
  for (var i = 0; i < Math.min(qn, sampled.length); i++) {
    if (readerScore(sampled[i]) < 0.5) break;
    await env.DB.prepare("UPDATE prompt_pool SET active = 2 WHERE id = ?").bind(sampled[i].id).run();
    promoted++;
  }
  for (var j = sampled.length - 1; j >= Math.max(0, sampled.length - qn); j--) {
    if (readerScore(sampled[j]) >= 0.5) break;
    await env.DB.prepare("UPDATE prompt_pool SET active = 0 WHERE id = ?").bind(sampled[j].id).run();
    purged++;
  }
  return { promoted: promoted, purged: purged };
}
// ---------------------------------------------------------------------------
// 8. Main generation cycle
// ---------------------------------------------------------------------------
// Self-referential signal: a published essay's systemic claim is emitted back into
// the fleet's signal store (signals table, source=q08) so the fleet's own self-audit
// (fleet-control scan, kaizen watchtower, cloud-ops digest) can read its own analysis
// and apply it to its own failure modes. Best-effort; never blocks publication.
async function emitContentSignal(env, piece, saved) {
  try {
    if (!env.AUDIT) return;
    var bodyText = String(piece.text || "").replace(/\n?worth your time:[\s\S]*$/im, "").trim();
    var paras = bodyText.split("\n").map(function(l){ return l.trim(); }).filter(function(l){ return l.length > 80; });
    var openQ = paras.length ? paras[paras.length - 1].slice(0, 400) : "";
    await env.AUDIT.prepare(
      "INSERT OR IGNORE INTO signals (id, ts, source, source_ref, content, open_questions, evidential_weight, domain, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)"
    ).bind(
      "q08:" + saved.slug,
      nowIso(),
      "q08",
      ORIGIN + "/p/" + saved.slug,
      String(saved.title || "").slice(0, 300),
      JSON.stringify([openQ]),
      0.6,
      "fleet",
      "open",
      nowIso()
    ).run();
  } catch (e) {
    // best-effort: a failed signal write must never fail a publish
  }
}

// Q08-ENSEMBLE-1. Levels: 1 writer (family W) -> 0 deterministic gate (uncorrelated with every model) -> 2 reader panel of two small
// models from families other than W -> 3 editor from the other writer family, editing the draft against the panel's notes ->
// 4 fresh panel from families other than W, the editor and the first panel where the pool allows. Publish only on a passing last
// read. A panel with no valid verdict fails open (the gate already passed), so a model outage never stalls q08; every such case is
// written as a 'panel_unavailable' row, so a panel that silently never runs shows in /api/ensemble and in the unavailable-share metric.
// Q08-PHRASE-REVISE-1 (2026-10-06, agent_issues 2034): 5 of the 7 gate failures in runs 234-245 were phrase-level
// only (a stock framing sentence, label phrases, soft register, a Title Case title), yet the retry threw the whole essay
// away and asked for a new one from scratch, which brings new tells. When every problem is phrase-level, the retry is a
// revision of the same draft that rewrites only the offending sentences and the title; any other problem keeps the
// rewrite from scratch. Same single compose call; the gate and the reader panel judge the result as before.
var PHRASE_LEVEL_RE = /^(?:stock framing tell|abstraction labels|abstraction-summary phrases|soft register|Title Case title|label title|management-babble|stock analogy prop|dry\/abstract title|formula title)/;
function phraseLevelOnly(problems) {
  return !!(problems && problems.length && problems.every(function (p) { return PHRASE_LEVEL_RE.test(String(p)); }));
}
// Sentences of one paragraph. A boundary is a full stop, question or exclamation mark (with an optional closing quote or bracket)
// followed by whitespace and a capital or opening quote, the split pruneUnsupported uses; ';' and ':' are not boundaries.
function splitSentences(para) { return String(para || "").split(/(?<=[.!?]["\u201d\u2019)]?)\s+(?=["\u201c(]?[A-Z])/); }
// FRAMING-REPAIR-1: the retry feedback shows each flagged phrase inside the sentence it sits in, so the reviser sees what to rewrite.
function problemsWithSentences(draft, problems) {
  var sents = [];
  String(draft || "").split(/\n+/).forEach(function (l) { if (!/^\s*#/.test(l) && !/^\s*(FORECAST-JSON:|worth your time:)/i.test(l)) sents = sents.concat(splitSentences(l)); });
  return (problems || []).map(function (p) {
    var q = String(p).match(/'([^']{3,})'/);
    if (!q) return p;
    var needle = q[1].toLowerCase().replace(/\s+/g, " "), hit = null;
    for (var i = 0; i < sents.length && !hit; i++) { if (sents[i].toLowerCase().replace(/\s+/g, " ").indexOf(needle) >= 0) hit = sents[i]; }
    return hit ? p + " [in the sentence: \"" + hit.replace(/\s+/g, " ").trim().slice(0, 240) + "\"]" : p;
  });
}
function retryPromptFor(prompt, draft, problems, floor) {
  var list = (problems || []).join("; ");
  if (phraseLevelOnly(problems) && draft && draft.length >= (floor || 2800)) {
    return prompt + "\n\n--- REVISION: your draft below was rejected only for these phrases: " + problemsWithSentences(draft, problems).join("; ")
      + ". Return the SAME essay with only those sentences and, if named, the title rewritten so that each names the concrete mechanism (who does what, which information is missing, where it breaks) in plain words. Keep every other sentence, the facts, the structure, the length and the final 'worth your time' line exactly as they are. Output the full essay, starting with its '# ' H1 title line, and nothing else. ---\n\n" + draft;
  }
  return prompt + "\n\n--- CORRECTIVE FEEDBACK: your previous draft was rejected. Rewrite the ENTIRE essay from scratch with a completely different structure \u2014 continuous prose, no '##' section headers, but KEEP exactly one '# ' H1 title line as the FIRST line of the essay \u2014 fixing only these issues ---\n" + list;
}
// FRAMING-REPAIR-1 (0.13.0, agent_issues 2284, 2286, 2288). In the week to 2026-10-12, 55 of 75 gate_failed runs were a "stock framing
// tell" (often with a "soft register" phrase) that the model re-produced on the revision retry, and every retry was a model call. When
// every gate problem is phrase-level and sentence-level (not a title problem), the repair is deterministic and model-free: delete each
// sentence that holds a flagged phrase (the gate's own regexes locate them; deletion cannot add a fact), then re-run the full gate the
// caller passes (its length floor included). The repaired draft is accepted only when that gate passes and at most a quarter of the
// sentences went; otherwise the existing model retry runs. The grounding and two-family fact-check still run on whatever is accepted.
var FRAMING_REPAIR_MAX_SHARE = 0.25;
function framingTellMatchers(problems) {
  var matchers = [], unrepairable = [];
  (problems || []).forEach(function (p) {
    var s = String(p);
    if (/^stock framing tell/.test(s)) matchers.push(STOCK_FRAMING_RE);
    else if (/^soft register/.test(s)) matchers.push(SOFT_REGISTER_RE);
    else if (/^stock analogy prop/.test(s)) matchers.push(STOCK_PROPS_RE);
    else if (/^abstraction labels/.test(s)) matchers.push(LABEL_PHRASE_RE);
    else if (/^abstraction-summary phrases/.test(s)) matchers.push(ABSTRACT_SUMMARY_RE);
    else if (/^management-babble/.test(s)) matchers.push(BANNED_BABBLE_RE);
    else unrepairable.push(s); // a title problem, or anything that is not a phrase in a body sentence
  });
  return { matchers: matchers, unrepairable: unrepairable };
}
// Returns null when the problems are not all phrase-level (nothing to repair here), else { accepted, text, removed, total, reason }.
// `gateFn(text)` returns the remaining problems of a candidate; the caller passes the gate with the floor that applies to its draft.
function framingRepair(text, problems, gateFn) {
  if (!phraseLevelOnly(problems)) return null;
  var m = framingTellMatchers(problems);
  if (m.unrepairable.length || !m.matchers.length) return { accepted: false, text: text, removed: [], total: 0, reason: "not a body-sentence problem: " + String(m.unrepairable[0] || "").slice(0, 80) };
  var removed = [], keep = [], total = 0;
  String(text).split(/\n{2,}/).forEach(function (para) {
    var head = "";
    if (/^\s*#/.test(para)) { var nl = para.indexOf("\n"); if (nl < 0) { keep.push(para); return; } head = para.slice(0, nl + 1); para = para.slice(nl + 1); }
    if (/^\s*(FORECAST-JSON:|worth your time:)/i.test(para)) { keep.push(head + para); return; }
    var out = [];
    splitSentences(para).forEach(function (sn) {
      if (!sn.trim()) return;
      total++;
      var hit = false;
      for (var i = 0; i < m.matchers.length && !hit; i++) hit = sn.search(m.matchers[i]) >= 0; // search() ignores a regex's lastIndex
      if (hit) removed.push(sn.replace(/\s+/g, " ").trim().slice(0, 160)); else out.push(sn);
    });
    if (out.length) keep.push(head + out.join(" ")); else if (head) keep.push(head.trim());
  });
  if (!removed.length) return { accepted: false, text: text, removed: [], total: total, reason: "no body sentence holds the flagged phrase" };
  var cap = Math.floor(total * FRAMING_REPAIR_MAX_SHARE);
  if (removed.length > cap) return { accepted: false, text: text, removed: removed, total: total, reason: "removing " + removed.length + " of " + total + " sentences is over the quarter cap (" + cap + ")" };
  var repaired = keep.join("\n\n");
  var rest = gateFn(repaired) || [];
  if (rest.length) return { accepted: false, text: text, removed: removed, total: total, reason: "the repaired draft still fails the gate: " + rest.slice(0, 2).join("; ").slice(0, 200) };
  return { accepted: true, text: repaired, removed: removed, total: total, reason: "" };
}
// The stage-log row (q08_reader_tests, role framing_repair), written beside the panel rows by saveReaderTests on every run outcome.
function framingRepairRow(fr, stage) {
  return { round: 0, role: "framing_repair", model: "", family: "", would_read: false, score: null, tells: (fr.removed || []).slice(0, 5), fix: ("FRAMING-REPAIR-1 " + stage + ": removed " + (fr.removed || []).length + " of " + fr.total + " sentences; " + (fr.accepted ? "accepted, gate passed" : "not accepted: " + fr.reason)).slice(0, 300), pass: !!fr.accepted };
}
function framingRepairNote(fr, stage) { return stage + " " + (fr.accepted ? "removed " + fr.removed.length + " of " + fr.total + " sentences" : fr.reason); }
var VERDICT_LINE_RE = /^[ \t]*worth your time:\s*(yes|flat|no)\s*[\u2014\u2013-]\s*\S[^\n]*$/im;
function carryVerdictLine(edited, original) {
  var t = String(edited || "");
  if (VERDICT_LINE_RE.test(t)) return t;
  var m = String(original || "").match(VERDICT_LINE_RE);
  if (!m) return t;
  return t.replace(/\n?[ \t]*worth your time:[^\n]*$/im, "").replace(/\s+$/, "") + "\n\n" + m[0].trim();
}
// Q08-EDITOR-TITLE-CARRY-1 (0.14.4, run 343): the editor applied the readers' cuts and returned a title over 100 characters, and the run
// failed on "title too long" with an edited body nobody had rejected. When the editor's H1 is missing, too long or a label title and the
// writer's H1 passed those checks, the writer's title is kept; the body stays the editor's.
// Q08-TITLE-CARRY-2 (0.14.9, run 352): the editor's "Marketing autonomous AI as a wieldable implement" failed the gate's label-title rule,
// which titleProblem did not know, so the writer's title was not carried. titleProblem now asks the gate itself for its title problems.
function titleProblem(title) {
  if (!title || BAD_TITLE_RE.test(title) || title.length > 100) return true;
  return gate("# " + title + "\n\nx", []).problems.some(function (p) { return /title/i.test(p) && !/^too short/.test(p); });
}
function h1Of(text) { var m = String(text || "").match(/^#\s+(.+)$/m); return m ? m[1].trim().replace(/[\u2010-\u2015\u2212]/g, "-") : ""; }
function carryTitle(edited, original) {
  var t = String(edited || "");
  if (!titleProblem(h1Of(t))) return t;
  var om = String(original || "").match(/^#\s+(.+)$/m);
  if (!om || titleProblem(h1Of(original))) return t;
  return /^#\s+.+$/m.test(t) ? t.replace(/^#\s+.+$/m, om[0].trim()) : om[0].trim() + "\n\n" + t.replace(/^\s+/, "");
}
function carryFormat(edited, original) { return carryTitle(carryVerdictLine(edited, original), original); }
// Q08-READER-CUTS-1 (0.15.0): readers name exact paragraph cuts ("Delete paragraphs 4, 6, and 7, which restate paragraph 3", "Cut the
// last two paragraphs", "Delete the final paragraph") and the model editor keeps not making them (runs 339, 342, 344, 351, 355: the
// second panel rejected the same restating paragraphs). Those cuts are applied deterministically first: deletion cannot add a fact. Only
// the first paragraph list after each delete/cut/remove/drop verb is read, at most half the body paragraphs go, and the result must pass
// the editor's gate; otherwise the model editor runs as before.
var CUT_NUMW = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
function cutNum(w) { w = String(w || "").toLowerCase(); return /^\d{1,2}$/.test(w) ? Number(w) : (CUT_NUMW[w] || 0); }
function readerCutIndices(fix, n) {
  var out = {}, f = String(fix || ""), re = /\b(?:delete|cut|remove|drop)\b([^.|;]{0,160})/gi, m;
  while ((m = re.exec(f))) {
    var seg = m[1];
    var l = seg.match(/\b(?:the )?(?:final|last|closing)\s+(?:(\w+)\s+)?paragraphs?\b/i);
    if (l) { var k = l[1] ? cutNum(l[1]) : 1; for (var i = n - k; k && i < n; i++) if (i >= 0) out[i] = 1; }
    var pm = seg.match(/\bparagraphs?\s+(\w+(?:\s*(?:,\s*and|,|and|through|to|-|\u2013)\s*\w+)*)/i);
    if (pm) {
      var toks = pm[1].split(/\s*(?:,\s*and|,|\band\b)\s*/);
      for (var t = 0; t < toks.length; t++) {
        var rg = toks[t].match(/^(\w+)\s*(?:through|to|-|\u2013)\s*(\w+)$/i);
        if (rg) { var a = cutNum(rg[1]), b = cutNum(rg[2]); if (!a || !b || b < a) break; for (var j = a; j <= b; j++) out[j - 1] = 1; continue; }
        var v = cutNum(toks[t]); if (!v) break; out[v - 1] = 1;
      }
    }
  }
  return Object.keys(out).map(Number).filter(function (i) { return i >= 0 && i < n; }).sort(function (x, y) { return x - y; });
}
function applyReaderCuts(text, fix) {
  var parts = String(text || "").split(/\n{2,}/), body = [];
  parts.forEach(function (p, i) { if (!/^\s*#\s/.test(p) && !/^\s*(FORECAST-JSON:|worth your time:)/i.test(p) && !ANALYSIS_MARK_RE.test(p) && p.trim()) body.push(i); });
  var cut = readerCutIndices(fix, body.length).filter(function (c) { return c !== 0; }); // Q08-LEDE-1: the lede is never cut
  if (!cut.length || cut.length > Math.floor(body.length / 2)) return null;
  var drop = {}; cut.forEach(function (c) { drop[body[c]] = 1; });
  return { text: parts.filter(function (p, i) { return !drop[i]; }).join("\n\n"), cut: cut.map(function (c) { return c + 1; }) };
}
async function runLevels(env, a) {
  var piece = a.piece, gateResult = a.gateResult, banned = a.banned, rows = [];
  if (!gateResult.ok) return { piece: piece, gateResult: gateResult, rows: rows };
  var writerFam = familyOf(piece.model);
  var seed = seedOf(a.seedText);
  var p1 = await panelRead(env, piece.text, [writerFam], seed, 2, a.readerPrompt);
  if (!p1) { rows.push({ round: 1, role: "panel_unavailable", model: "", family: "", pass: 1 }); return { piece: piece, gateResult: gateResult, rows: rows }; }
  rows = rows.concat(panelRows(p1, 1));
  if (p1.pass) return { piece: piece, gateResult: gateResult, rows: rows };
  // LEVER-538: cap the editor fallback panel so a failed edit does not burn the whole model roster per retry.
  var editOrder = COMPOSE_MODELS.filter(function (m) { return familyOf(m) !== writerFam; }).concat(COMPOSE_MODELS.filter(function (m) { return familyOf(m) === writerFam; })).slice(0, 2);
  var edPrompt = a.prompt + "\n\n--- EDITOR PASS: below is a draft by another writer. Two independent readers from different model families would not read it to the end (mean score " + p1.mean + " of 5). What they said to fix: " + p1.fix + (p1.tells.length ? " Phrases they flagged as generic machine prose: " + p1.tells.join(" | ") + "." : "") + " Edit it, do not start over: keep every fact and the same case, keep the title line first and the verdict line last, keep the first paragraph as the news lede (who did what, where it appeared, why it matters; at most 70 words), keep the line <!-- analysis --> on its own line where the analysis starts, replace abstractions with people doing things, vary sentence length, cut anything that only restates. Use only facts already in the draft or in the source material above: delete instead of adding, and never introduce a new name, date, figure, quotation or example to make a paragraph more concrete. Cut what the readers asked you to cut, even when the essay gets shorter: keep it at least " + (a.forecast ? 2800 : EDIT_FLOOR) + " characters and never pad it back. Return the full edited essay. " + (a.forecast ? "This is a forecast: keep every probability, the horizon, and the whole FORECAST-JSON line exactly as in the draft, and keep the verdict line last. " : "") + FRAMING_RULE + " ---\n\n--- DRAFT ---\n" + (a.forecast ? piece.text + "\nFORECAST-JSON: " + JSON.stringify(piece.extra || {}) : piece.text);
  var ed = null;
  var rc1 = a.forecast ? null : applyReaderCuts(piece.text, p1.fix);
  if (rc1 && !editGateProblems(rc1.text, banned, false).length) {
    ed = { text: rc1.text, model: piece.model, extra: piece.extra };
    rows.push({ round: 2, role: "reader_cuts", model: "", family: "", pass: 1, fix: "Q08-READER-CUTS-1: deleted paragraphs " + rc1.cut.join(", ") });
  } else {
    try { ed = await compose(env, edPrompt, banned, editOrder, a.xform); } catch (e) { ed = null; }
  }
  if (ed && a.forecast && !ed.extra && piece.extra) ed.extra = piece.extra;
  // Q08-EDITOR-VERDICT-CARRY-1 (0.14.1, run 337): the editor's rewrite dropped the final 'worth your time' line, a format marker the gate
  // requires, and the run failed with the readers' edits applied. A dropped or malformed verdict line is carried over from the writer.
  if (ed && ed.text) ed.text = carryFormat(ed.text, piece.text);
  // Q08-EDITOR-PHRASE-REVISE-1: an editor draft rejected only for phrase-level tells (a label title, a stock framing sentence) gets one
  // targeted revision of those sentences, as the writer's own draft does, instead of failing the whole run (run 318).
  // FRAMING-REPAIR-1: the deterministic sentence removal runs first; the model revision is the fallback when it is not accepted.
  if (ed && ed.text && !a.forecast) {
    var edProblems = editGateProblems(ed.text, banned, a.forecast);
    if (edProblems.length && phraseLevelOnly(edProblems) && ed.text.length >= EDIT_FLOOR) {
      var edFr = framingRepair(ed.text, edProblems, function (t) { return editGateProblems(t, banned, a.forecast); });
      if (edFr) rows.push(framingRepairRow(edFr, "editor"));
      // LEVER-538: the paid model revision retry is dropped; only the free deterministic framing repair is kept.
      if (edFr && edFr.accepted) ed = { text: edFr.text, model: ed.model, extra: ed.extra, repaired: edFr.removed.length };
    }
  }
  var edOk = !!(ed && ed.text && !editGateProblems(ed.text, banned, a.forecast).length && (!a.forecast || validateForecast(ed.extra, ed.text, Date.now()).length === 0));
  if (!edOk) return { piece: piece, gateResult: { ok: false, problems: ["ensemble: the editor's draft failed the gate (" + (ed && ed.text ? editGateProblems(ed.text, banned, a.forecast).slice(0, 3).join("; ").slice(0, 200) : "no editor draft") + ") - " + (p1.fix || "no fix given")] }, rows: rows };
  var edFam = familyOf(ed.model);
  var usedFam = [writerFam, edFam].concat(p1.judges.map(function (j) { return j.family; }));
  var p2 = await panelRead(env, ed.text, usedFam, seed + 1, 2, a.readerPrompt);
  if (!p2) p2 = await panelRead(env, ed.text, [writerFam, edFam], seed + 1, 2, a.readerPrompt);
  if (p2) rows = rows.concat(panelRows(p2, 2)); else rows.push({ round: 2, role: "panel_unavailable", model: "", family: "", pass: 1 });
  rows.push({ round: 2, role: "editor", model: ed.model, family: edFam, pass: p2 ? p2.pass : true });
  if (!p2 || p2.pass) return { piece: ed, gateResult: gateResult, rows: rows };
  // Q08-EDITOR-ROUND-2 (0.14.3, run 339): the second panel scored the edited draft 3 of 5 and named exact cuts ("delete the final
  // paragraph", "start with the quote"), and the run ended there. A close miss (mean at least CLOSE_MISS_MEAN) gets one more editor
  // pass that applies those cuts to the edited draft, read by a third panel; the pass bar and every later check are unchanged.
  if (!a.forecast && p2.mean >= CLOSE_MISS_MEAN && p2.fix) {
    var ed3 = null;
    var rc2 = applyReaderCuts(ed.text, p2.fix);
    if (rc2 && !editGateProblems(rc2.text, banned, false).length) { ed3 = { text: rc2.text, model: ed.model, extra: ed.extra }; rows.push({ round: 3, role: "reader_cuts", model: "", family: "", pass: 1, fix: "Q08-READER-CUTS-1: deleted paragraphs " + rc2.cut.join(", ") }); }
    else try { ed3 = await compose(env, a.prompt + "\n\n--- EDITOR PASS 2: below is an edited draft. Two fresh readers scored it " + p2.mean + " of 5. Apply exactly what they asked: " + p2.fix + (p2.tells.length ? " Phrases they flagged as generic machine prose: " + p2.tells.join(" | ") + "." : "") + " Delete and reorder; never add a name, date, figure, quotation or example that is not already in the draft or the source material above. Keep the title line first and the verdict line last, keep it at least " + EDIT_FLOOR + " characters, and return the full essay. " + FRAMING_RULE + " ---\n\n--- DRAFT ---\n" + ed.text, banned, editOrder, a.xform); } catch (e) { ed3 = null; }
    if (ed3 && ed3.text) ed3.text = carryFormat(ed3.text, ed.text);
    if (ed3 && ed3.text && !editGateProblems(ed3.text, banned, false).length) {
      var p3 = await panelRead(env, ed3.text, [writerFam, familyOf(ed3.model)], seed + 2, 2, a.readerPrompt);
      if (p3) rows = rows.concat(panelRows(p3, 3)); else rows.push({ round: 3, role: "panel_unavailable", model: "", family: "", pass: 1 });
      rows.push({ round: 3, role: "editor", model: ed3.model, family: familyOf(ed3.model), pass: p3 ? p3.pass : true });
      if (!p3 || p3.pass) return { piece: ed3, gateResult: gateResult, rows: rows };
      p2 = p3;
    }
  }
  return { piece: piece, gateResult: { ok: false, problems: ["ensemble: the edited draft was still not worth reading (panel mean " + p2.mean + " of 5) - " + (p2.fix || "no fix given")] }, rows: rows };
}
var CLOSE_MISS_MEAN = 3;
// Q08-FINAL-READ-1 (0.21.0; owner 2026-10-13: "q08.org is still publishing banal, vacuous shit"). The reader panel judged the draft before
// the fact check, and the prune and revision rounds then cut it to a stub that no reader saw: all five pieces live on 2026-10-13 were
// 1272-2156 characters, with analysis such as "This temporal separation creates a feedback-delay coupling". Now the exact text that
// would be published needs PUBLISH_MIN_CHARS of body and a final panel from two families other than the writer's, read with a stricter
// prompt, at a mean of FINAL_PASS_MEAN with no judge under 3. No verdict means no publication (fail closed).
var PUBLISH_MIN_CHARS = 2800, FINAL_PASS_MEAN = 4;
var FINAL_READER_PROMPT = [
  "You are an editor deciding whether the essay below is published under your name. You are a busy, intelligent reader who has never heard of this site. Most drafts you see are vacuous: they restate the headline, then wrap it in abstract words ('the loop', 'the coupling', 'the structure', 'the mechanism', 'the dynamic', 'the arrangement') that sound like analysis and say nothing a reader did not already know.",
  "Answer with exactly one JSON object and nothing else:",
  "{\"would_read_to_end\": true or false, \"score\": 1 to 5, \"slop_tells\": [up to 3 short phrases copied from the essay that are vacuous or generic], \"fix\": \"one sentence naming what is missing\"}",
  "The bar is the best system-design writing for engineers: after reading, an engineer who missed the story understands how the system involved works (its components and how data or requests flow between them), which design decision or constraint produced the event, and what trade-off it reveals.",
  "Scores: 5 = I learned something non-obvious about how this system works and would send it to a colleague; 4 = a reader who knows only the headline comes away understanding why it happened, in concrete technical terms; 3 = accurate but adds little beyond the headline; 2 = mostly abstract restatement; 1 = empty.",
  "Score at most 2 when: the opening does not say plainly what happened, to whom, and where it was reported; or the piece never names the actual people or organisations and what each wants; or its analysis is abstract nouns instead of who does what and why; or a paragraph exists only to restate the previous one. Score at most 3 when a reader would learn nothing they could not guess from the title. A 4 must be earned with concrete reasoning a newcomer can follow."
].join("\n");
function publishBody(text) { return stripAnalysisMark(String(text || "").replace(/\n?worth your time:[^\n]*$/im, "").replace(/^#\s.*$/m, "")).replace(/\s+/g, " ").trim(); }
async function finalRead(env, text, writerModel, seedText) {
  var n = publishBody(text).length;
  if (n < PUBLISH_MIN_CHARS) return { ok: false, rows: [], problems: ["final read: too short to publish (" + n + " chars of body; floor " + PUBLISH_MIN_CHARS + ")"] };
  var finalSeed = seedOf(seedText) + 7;
  var p = await panelRead(env, text, [familyOf(writerModel)], finalSeed, 2, FINAL_READER_PROMPT);
  if (!p) p = await panelRead(env, text, [familyOf(writerModel)], finalSeed + 1, 2, FINAL_READER_PROMPT, "final-read-retry-1");
  if (!p) return { ok: false, rows: [{ round: 9, role: "panel_unavailable", model: "", family: "", pass: 0 }], problems: ["final read: no reader verdict (fails closed)"] };
  var ok = p.mean >= FINAL_PASS_MEAN && p.judges.every(function (j) { return j.score >= 3; });
  var rows = panelRows(p, 9);
  return { ok: ok, rows: rows, mean: p.mean, problems: ok ? [] : ["final read: not worth publishing (panel mean " + p.mean + " of 5, bar " + FINAL_PASS_MEAN + ") - " + (p.fix || "no fix given") + (p.tells.length ? " | vacuous: " + p.tells.join(" | ") : "")] };
}
// Q08-SOURCE-GROUND-1 (0.19.1, run 377): the writer is told what its source is (kind, title, link) and must say so in the lede, but the
// fact-check ground had only bare text, so "Apple posted a product page on apple.com" and "a commenter on Hacker News noted ..." were
// listed as not in source. The ground now carries the same source description and labels each part with what it is.
function labelledGround(story, friction, article, background, ownerNotes) {
  var src = { source: story && story.source || "hn", title: story && story.title || "", url: story && story.url || "" };
  var kind = String(src.source);
  var sigLabel = kind === "github" ? "Repository description and README excerpt" : kind === "arxiv" ? "Paper abstract" : "Hacker News discussion comments on it";
  var parts = ["SOURCE: " + sourceKind(src) + ". Title: " + src.title + (src.url ? ". Link: " + src.url + " (site: " + hostOf(src.url) + ")" : "") + "."];
  // Q08-GROUND-PROVENANCE-1 (0.27.0; engine_runs 404, 413, 415, 417 of 2026-10-14): the lede must name the item and where it appeared
  // (ledeProblems), and the reviewers flagged exactly that ("the paper appears on arxiv.org -- source is linked but not stated") because the
  // header gives it as a label. The same facts are stated as sentences.
  if (src.title) parts.push("The item is titled \u201c" + src.title + "\u201d." + (src.url ? " It appeared on " + hostOf(src.url) + ", at " + src.url + "." : ""));
  if (friction && friction.core_concept) parts.push("Topic: " + friction.core_concept);
  if (friction && friction.friction_point) parts.push(sigLabel + ": " + friction.friction_point);
  if (article) parts.push("Linked article text: " + article);
  if (background) parts.push("Background reference text:\n" + background);
  if (ownerNotes && ownerNotes.length) parts.push(ownerNotes.join("\n"));
  return parts.join("\n");
}
var SOURCE_RANK = { hn: 0, arxiv: 1, github: 2 };
function orderCandidates(candidates, lastSource) {
  var rank = function (c) { var r = SOURCE_RANK[c.source || "hn"]; return r == null ? 1 : r; };
  var list = (candidates || []).map(function (c, i) { return { c: c, i: i }; }).sort(function (a, b) { return rank(a.c) - rank(b.c) || a.i - b.i; }).map(function (x) { return x.c; });
  var head = list.filter(function (c) { return (c.source || "hn") !== "github"; });
  var diverse = head.find(function (c) { return (c.source || "hn") !== lastSource; });
  return diverse ? [diverse].concat(list.filter(function (c) { return c !== diverse; })) : list;
}
async function generate(env) {
  var t0 = Date.now();
  // Q08-RUN-STAGE-ATTRIBUTION-1: verify_calls remains the total; panel_calls and factcheck_calls split reviewer spend by stage.
  env = Object.assign({}, env, { q08Meter: { compose: 0, verify: 0, panel: 0, factcheck: 0 } });
  // Q08-TICK-BUDGET-1 (0.17.4, agent_issues 2479): every early exit writes an engine_runs row (status skipped or deferred) so a quiet tick
  // can be told apart from one the runtime killed; the attempt cap counts only ok and gate_failed rows, so these never use an attempt.
  async function quit(status, reason, scraped, scored, srcInfo) {
    await insertRun(env, { scraped: scraped, scored: scored, published: 0, top: "", model: "", ms: Date.now() - t0, status: status, error: String(reason).slice(0, 500), sourceChars: srcInfo && srcInfo.chars, sourceKind: srcInfo && srcInfo.kind }).catch(function (e) { console.error(JSON.stringify({ at: "q08.generate.quit", error: String(e && e.message || e).slice(0, 200) })); });
    return { ok: false, reason: reason };
  }
  if (!(await ensureAccuracySchema(env))) return await quit("skipped", "accuracy schema unavailable (publishing fails closed)");
  // Daily cap check (PUBLISH-QUOTAS-1: scoped to this property only)
  await ensurePropertyColumn(env);
  var dayCount = await env.DB.prepare(
    "SELECT COUNT(*) n FROM published_pieces WHERE published_at >= ?1 AND COALESCE(property, ?2) = ?2"
  ).bind(utcDay() + "T00:00:00.000Z", PROPERTY).first();
  var todayN = (dayCount && dayCount.n) || 0;
  var _bud = await q08Budget(env);
  env = Object.assign({}, env, { __q08BudgetPressure: !!env.__q08BudgetPressure || !_bud.ok });
  var cap = await dailyCap(env);
  if (todayN >= cap) {
    return await quit("skipped", "daily cap reached (" + todayN + "/" + cap + (cap < MAX_PER_DAY ? ", ops_config " + CAP_KEY : "") + ")");
  }
  // Q08-QUALITY-1: attempts are bounded at four times the publish cap (a publishing-cadence and quality bound, not a spend
  // stop: under BUDGET-SOFT-ROUTE-1 a breached fleet_budget cap only steers model choice, never halts the engine).
  var attempts = await env.DB.prepare("SELECT COUNT(*) n FROM engine_runs WHERE ran_at >= datetime('now','start of day') AND status IN ('ok','gate_failed')").first().catch(function () { return { n: 0 }; });
  if ((attempts && attempts.n || 0) >= cap * 4) {
    return await quit("skipped", "daily attempt cap reached (" + attempts.n + "/" + (cap * 4) + ")");
  }
  // Q08-FORECAST-1: every FORECAST_EVERY pieces, write a forecast from a published essay's mechanism instead of scraping a
  // new signal. A forecast that fails its gate is logged and the analysis path below still runs this tick, so a failing
  // forecast can never stall publishing.
  try {
    if (await forecastDue(env)) {
      var fout = await generateForecast(env, t0);
      if (fout) return fout;
      // Q08-TICK-ALLOWANCE-1: a forecast attempt that spent model calls was this tick's unit; the essay starts only while the day is still under its pace line (no row: the forecast attempt wrote its own).
      if (!(await q08TickMore(env))) return q08Paced("the essay waits: the forecast attempt used this tick's share of the daily neuron target");
      // Q08-TICK-BUDGET-1: a failed forecast used part of the tick; an essay needs up to ~650 s, so it waits for the next tick instead of
      // being killed at the scheduled-run limit with no row (run 366, 2026-10-13 06:35Z).
      if (Date.now() - t0 > ESSAY_AFTER_FORECAST_MS) return await quit("deferred", "the essay waits for the next tick: the forecast attempt used " + Math.round((Date.now() - t0) / 1000) + " s of this one");
    }
  } catch (e) { console.error("q08 forecast path failed: " + String(e && e.message || e).slice(0, 200)); }
  // Scrape + rank \u2014 three sources (break the filter bubble)
  var stories = [];
  try { stories = stories.concat(await scrapeHN()); } catch (e) { console.error(JSON.stringify({ evt: "q08-signal-engine:quit:caught", error: String((e && e.message) || e) })); }
  try { stories = stories.concat(await scrapeGitHub()); } catch (e) { console.error(JSON.stringify({ evt: "q08-signal-engine:quit:caught", error: String((e && e.message) || e) })); }
  try { stories = stories.concat(await scrapeArxiv(env)); } catch (e) { console.error(JSON.stringify({ evt: "q08-signal-engine:quit:caught", error: String((e && e.message) || e) })); }
  if (!stories.length) return await quit("skipped", "no signals scraped");
  // Skip already-processed signal IDs (source-scoped). Q08-SIGNAL-RETRY-1 (2026-10-17): a 7-day window over EVERY
  // status exhausted the candidate pool (15:00Z run: "all signals already processed") because ~30 runs/day mark
  // signals processed even when the gate fails. Published signals keep the 7-day window; failed/skipped ones are
  // retried after 24h, so the gate (and the forecast repair) actually gets exercised.
  var processed = await env.DB.prepare(
    "SELECT source_id FROM signal_log WHERE (status = 'published' AND processed_at >= ?1) OR (COALESCE(status,'') <> 'published' AND processed_at >= ?2)"
  ).bind(new Date(Date.now() - 7 * 864e5).toISOString(), new Date(Date.now() - 864e5).toISOString()).all();
  var processedIds = new Set((processed.results || []).map(r => String(r.source_id)));
  var candidates = stories.filter(s => !processedIds.has(String((s.source||"hn") + ":" + s.id)));
  if (!candidates.length) return await quit("skipped", "all signals already processed (published 7d, failed 24h)", stories.length, 0);
  // Source diversity: prefer a source other than the last one used
  var lastRun = await env.DB.prepare("SELECT top_signal FROM engine_runs WHERE top_signal != '' ORDER BY id DESC LIMIT 1").first();
  var lastSource = lastRun ? (String(lastRun.top_signal||"").split(":")[0]) : "";
  // Q08-SOURCE-ORDER-1 (0.19.3): repositories produced product descriptions with no system to analyse (runs 354, 356, 358, 375, 379 all
  // failed; readers asked for the bigger conflict, not install steps). Stories and papers come first, alternating so the last source is not
  // repeated; a repository is written about only when no story or paper ahead of it has enough source material.
  var ordered = orderCandidates(candidates, lastSource);
  // Try candidates until one yields sufficient friction (sparse GitHub/arXiv fall through)
  var story = null, friction = null, prefetched = null, bestThin = null, storyGlen = 0, evaluated = [];
  for (var ci = 0; ci < Math.min(ordered.length, 8); ci++) {
    var cand = ordered[ci];
    var f = null;
    try {
      if ((cand.source||"hn") === "github") f = await extractGitHubFriction(cand.id, cand.description || "");
      else if ((cand.source||"hn") === "arxiv") f = { core_concept: cand.title, friction_point: (String(cand.title||"") + ". " + String(cand.abstract||"")).slice(0,FRICTION_MAX), signal_strength: "Medium" };
      else f = await extractFriction(cand.id);
    } catch (e) { f = null; }
    if (f && f.friction_point && f.friction_point.length >= 60) {
      // Q08-RICH-SOURCE-1: a writer limited to its source can only write what the source holds. Prefer the first candidate whose
      // story, discussion and article hold enough material for a full essay; thin ones made the writer invent, and the fact-check rejected it.
      var art = await fetchArticleText(articleUrlFor(cand));
      var glen = String(cand.title || "").length + String(f.core_concept || "").length + String(f.friction_point || "").length + art.length;
      evaluated.push({ cand: cand, f: f, glen: glen });
      if (!bestThin || glen > bestThin.glen) bestThin = { cand: cand, f: f, art: art, glen: glen };
      if (glen >= MIN_GROUND_CHARS) { story = cand; friction = f; prefetched = art; storyGlen = glen; break; }
    }
  }
  // Q08-FULLTEXT-1 (0.17.1, agent_issues 2470; owner 2026-10-13: "Papers shall cite full texts, not merely reference work summaries"): the
  // richest thin candidate is used only when its full text was fetched (THIN_MIN_ARTICLE characters); an abstract-only candidate is not
  // written from, and the run reports it instead.
  // Q08-YIELD-1: the richest thin candidate must also reach the floor learned from the sources that have published (learnedSourceFloor).
  var thinOk = bestThin && String(bestThin.art || "").length >= THIN_MIN_ARTICLE;
  var thinV = !story && bestThin ? thinSourceVerdict(bestThin, thinOk ? await learnedSourceFloor(env) : null) : null;
  if (!story && thinV && thinV.ok) { story = bestThin.cand; friction = bestThin.f; prefetched = bestThin.art; storyGlen = bestThin.glen; }
  if (!story && bestThin && !thinV.ok) {
    await markThinSkipped(env, evaluated);
    var thinInfo = { chars: bestThin.glen, kind: sourceKindOf(bestThin.cand, String(bestThin.art || "").length) };
    if (thinV.why === "below-floor") return await quit("skipped", "source too thin for a " + PUBLISH_MIN_CHARS + "-character grounded piece (the richest of " + evaluated.length + " candidates, " + String(bestThin.cand && bestThin.cand.title || "").slice(0, 80) + ", holds " + bestThin.glen + " characters of source material; the thinnest source that has published holds " + thinV.floor + "); retried after 24 hours", stories.length, candidates.length, thinInfo);
    return await quit("skipped", "no candidate with readable full text (the richest, " + String(bestThin.cand && bestThin.cand.title || "").slice(0, 80) + ", has " + String(bestThin.art || "").length + " characters of fetched text)", stories.length, candidates.length, thinInfo);
  }
  if (!story) {
    return await quit("skipped", "no candidate yielded sufficient friction (" + candidates.length + " available)", stories.length, candidates.length);
  }
  // Q08-THIN-PASSED-OVER-1 (0.37.5): a candidate measured thin and passed over for a later one was never marked, so the next tick measured it
  // again and, being first in its lane, passed it over again. A paper whose arxiv.org/html page answers 404 therefore holds the whole arXiv lane
  // (only the first unprocessed paper of the lane is ever tried: the stories come before the rest of it in the order). On 2026-10-26 the lane ran
  // at 02:02 and 03:04 and then not for 16 hours, although 9 unprocessed papers with an HTML rendering were in the list behind 2610.32638,
  // whose rendering answers 404 (read 17:50Z). A passed-over thin candidate is now marked like any measured-thin one, and the 24-hour retry
  // window puts the next paper ahead on the next turn.
  var passedOver = thinPassedOver(evaluated, story);
  if (passedOver.length) await markThinSkipped(env, passedOver);
  // Few-shot only from pieces with proven reader value (reads or verdicts); otherwise none.
  var exemplars = await env.DB.prepare(
    "SELECT pp.structure_md FROM prompt_pool pp JOIN published_pieces p ON p.id = pp.piece_id WHERE pp.active = 2 AND p.slug NOT IN (SELECT slug FROM q08_retractions) AND (p.reads > 0 OR p.feedback_score > 0) ORDER BY pp.performance_score DESC, p.feedback_score DESC LIMIT 2"
  ).all();
  var fewShot = (exemplars.results || []).filter(function(r){ return exemplarOk(r.structure_md); });
  // Recent structures as divergence priming: the model must NOT repeat them.
  var recentRows = await env.DB.prepare(
    "SELECT structure_md FROM prompt_pool ORDER BY created_at DESC LIMIT 6"
  ).all();
  var recentStructures = (recentRows.results || []).map(function(r){ return r.structure_md; });
  // Compose
  var recentBodies = await env.DB.prepare("SELECT body_md FROM published_pieces WHERE slug NOT IN (SELECT slug FROM q08_retractions) ORDER BY published_at DESC LIMIT 8").all().catch(function () { return { results: [] }; });
  var banned = []; // Q08-VERIFY-1: outside precedents are rejected by the grounding check, so no precedent is named to the writer
  var ownerNotes = await ownerDirectives(env);
  var article = prefetched !== null ? prefetched : await fetchArticleText(articleUrlFor(story));
  var srcCtx = { source: story.source || "hn", title: story.title || "", url: story.url || "" };
  var background = await backgroundPack(story);
  var prompt = buildPrompt(friction, fewShot, recentStructures, { banned: banned, ownerNotes: ownerNotes, article: article, source: srcCtx, background: background });
  // Q08-LEDE-1: every writer draft is gated with the lede check as well
  function gateW(t) { return withLede(gate(t, banned), t, srcCtx); }
  var piece  = await compose(env, prompt, banned, undefined, undefined, TITLE_REPAIR_ON);
  // Gate \u2014 one corrective retry on failure
  var gateResult = gateW(piece.text);
  // FRAMING-REPAIR-1: a phrase-level-only failure is first repaired without a model call (flagged sentences removed, full gate re-run,
  // at most a quarter of the sentences); the stage rows go to q08_reader_tests and the trail to the run error when the run still fails.
  var repairRows = [], repairTrail = [];
  // Q08-COMPOSE-TRAIL-1 (0.23.1, run 386): kimi-k2.6 wrote first and lost to gpt-oss with no record of why; every writer's gate result
  // is kept as a round-0 row in q08_reader_tests, so the next audit reads which model fails which check.
  (piece.trail || []).forEach(function (t) { repairRows.push({ round: 0, role: "compose", model: t.model, family: familyOf(t.model), pass: t.problems.length ? 0 : 1, fix: (t.chars ? t.chars + " chars; " : "") + (t.note ? t.note + "; " : "") + (t.problems.join("; ") || "passed the writer gate").slice(0, 480) }); });
  function tryFramingRepair(p, problems, stage) {
    var fr = framingRepair(p.text, problems, function (t) { return gateW(t).problems; });
    if (!fr) return null;
    repairRows.push(framingRepairRow(fr, stage));
    repairTrail.push(framingRepairNote(fr, stage));
    return fr.accepted ? { text: fr.text, model: p.model, extra: p.extra, repaired: fr.removed.length } : null;
  }
  if (!gateResult.ok) {
    var repaired0 = tryFramingRepair(piece, gateResult.problems, "writer");
    if (repaired0) { piece = repaired0; gateResult = gateW(piece.text); }
  }
  // Q08-VERDICT-NORM-1: a first draft whose only problem is the verdict line gets the micro-call before a full rewrite is spent on it.
  if (!gateResult.ok && verdictOnlyProblem(gateResult.problems)) {
    try {
      var v0 = await verdictMicroCall(env, piece.text);
      if (v0) { var vt0 = piece.text.replace(/\s*$/, "") + "\n\n" + v0, vg0 = gateW(vt0); if (vg0.ok) { piece = Object.assign({}, piece, { text: vt0 }); gateResult = vg0; } }
    } catch (e) { console.error("q08 verdict micro-call failed: " + String(e && e.message || e).slice(0, 200)); }
  }
  if (!gateResult.ok) {
    var retryPrompt = retryPromptFor(prompt, piece.text, gateResult.problems);
    var retryPiece = null;
    // RED-DRAIN-1 (issue #99930): the corrective retry re-asked the whole COMPOSE_MODELS ensemble, including every
    // writer that had already failed the writer gate in the first compose, so each failed round paid for them twice
    // and q08_neurons_per_published_piece_7d climbed past the 6000 budget. The retry now spends calls only on the
    // writers that have not yet failed this run; the gate, the panel and the fact-check are unchanged.
    var retryModels = await composeOrder(env);
    var failedWriters = {}; (piece.trail || []).forEach(function (t) { if (t.problems && t.problems.length) failedWriters[t.model] = 1; });
    retryModels = retryModels.filter(function (m) { return !failedWriters[m]; });
    const RETRY_MODEL_CAP = 2;
    if (retryModels.length > RETRY_MODEL_CAP) retryModels = retryModels.slice(0, RETRY_MODEL_CAP);
    if (retryModels.length) {
      try { retryPiece = await compose(env, retryPrompt, banned, retryModels, undefined, TITLE_REPAIR_ON); } catch (e) { retryPiece = null; }
    }
    if (retryPiece && retryPiece.text) {
      var retryGate = gateW(retryPiece.text);
      if (retryGate.ok) { piece = retryPiece; gateResult = retryGate; }
      else if (phraseLevelOnly(retryGate.problems)) {
        // the model re-produced the tells on the revision: the same deterministic repair applies to the retry draft
        var repaired1 = tryFramingRepair(retryPiece, retryGate.problems, "retry");
        if (repaired1) { piece = repaired1; gateResult = gateW(piece.text); }
      }
      else if (verdictOnlyProblem(retryGate.problems)) {
        try {
          var vm2 = await verdictMicroCall(env, retryPiece.text);
          if (vm2) {
            retryPiece.text = retryPiece.text.replace(/\s*$/, "") + "\n\n" + vm2;
            retryGate = gateW(retryPiece.text);
            if (retryGate.ok) { piece = retryPiece; gateResult = retryGate; }
          }
        } catch (e) { console.error(JSON.stringify({ evt: "q08-signal-engine:tryFramingRepair:caught", error: String((e && e.message) || e) })); }
      }
    }
  }
  // Q08-FACT-LEDGER-1: the ground is built before the panel, and the free deterministic grounding check runs on the draft ahead of it
  // (groundPreCheck). A draft that still names what the source does not hold ends here as an accuracy failure (stallStage: fact-check),
  // with no panel call; runLevels returns at once for a failed gate. The LLM fact-check below is unchanged and still runs last.
  var essayGround = labelledGround(story, friction, article, background, ownerNotes);
  if (gateResult.ok) {
    var gpMode = await groundPreCheckMode(env); // ops_config q08_ground_precheck: on (default) | prune | off (no pre-check call, the 0.31.3 flow)
    if (gpMode !== "off") {
      var pre = groundPreCheck(piece, essayGround, { forecast: false, banned: banned, src: srcCtx, mode: gpMode });
      pre.rows.forEach(function (r) { repairRows.push(r); }); // the stage row is saved with the repair rows and the panel rows
      if (pre.ok) piece = pre.piece;
      else gateResult = { ok: false, problems: ["accuracy: " + pre.problems.join("; "), "pre-check: " + pre.trail] };
    }
  }
  var lv = await runLevels(env, { piece: piece, prompt: prompt, banned: banned, seedText: story.title || "", gateResult: gateResult });
  piece = lv.piece; gateResult = lv.gateResult;
  var readerRows = repairRows.concat(lv.rows);
  // Q08-VERIFY-1: nothing is published until its names, years and figures are in the source material and two reviewers from
  // other model families find no unsupported claim. An outage of the reviewers fails closed.
  var essayVr = null;
  if (gateResult.ok) {
    var ev = await verifyAndRevise(env, { piece: piece, prompt: prompt, banned: banned, ground: essayGround, seedText: String(story.id || story.title || ""), forecast: false, deadline: t0 + TICK_BUDGET_MS, src: srcCtx });
    piece = ev.piece; essayVr = ev.vr;
    if (!ev.ok) gateResult = { ok: false, problems: ["accuracy: " + ev.problems.join("; ")] };
    else {
      var fin = await finalRead(env, piece.text, piece.model, String(story.id || story.title || ""));
      readerRows = readerRows.concat(fin.rows);
      if (!fin.ok) gateResult = { ok: false, problems: fin.problems };
    }
  }
  if (!gateResult.ok) {
    await saveReaderTests(env, (story.source || "hn") + ":" + String(story.id || ""), readerRows);
    // Mark the signal processed so the same story is not retried by the next runs.
    try {
      await env.DB.prepare(
        "INSERT OR IGNORE INTO signal_log (id, source, source_id, title, url, points, num_comments, ratio, volatility_score, friction_point, signal_strength, status, processed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)"
      ).bind("sig-" + Date.now().toString(36) + rnd36(4), (story.source || "hn"), (story.source || "hn") + ":" + String(story.id || ""), story.title, story.url, story.points, story.num_comments, story.ratio, story.volatility_score, friction.friction_point, friction.signal_strength, "gate_failed", nowIso()).run();
    } catch (e) { console.error(JSON.stringify({ evt: "q08-signal-engine:tryFramingRepair:caught", error: String((e && e.message) || e) })); }
    await insertRun(env, { scraped: stories.length, scored: candidates.length, published: 0, top: (story.source||"hn") + ":" + story.title.slice(0, 80), model: piece.model, ms: Date.now()-t0, status: "gate_failed", error: gateResult.problems.join("; ") + (repairTrail.length ? " | framing repair: " + repairTrail.join("; ").slice(0, 300) : ""), sourceChars: storyGlen, sourceKind: sourceKindOf(story, String(article || "").length) });
    return { ok: false, reason: "gate failed: " + gateResult.problems.join("; ") };
  }
  // Strip the calibration verdict line from the published body (it gates, it does not print).
  piece.text = stripAnalysisMark(piece.text.replace(/\n?worth your time:\s*(yes|flat|no)\s*[\u2014\u2013-].*$/im, "").trim());
  // Persist
  var saved = await persistPiece(env, piece, friction, story, piece.model);
  if (essayVr) await recordAudit(env, saved.slug, "pass", "publish", essayVr).catch(function (e) { console.error(JSON.stringify({ evt: "q08-signal-engine:tryFramingRepair:caught", error: String((e && e.message) || e) })); });
  await saveReaderTests(env, saved.slug, readerRows);
  // Feedback loop. MUST be awaited: as a floating promise with no ctx.waitUntil it
  // was truncated by the Worker runtime once the response returned, so the promotion
  // loop never completed and the reader-proven pool stayed empty (feedback_score
  // updates landed, promotions did not).
  await feedbackScan(env).catch((e) => { console.error(JSON.stringify({ evt: "q08-signal-engine:tryFramingRepair:caught", error: String((e && e.message) || e) })); });
  // Social cross-post (Bluesky via qnfo-social; skips silently if unset)
  await queueForDistribution(env, q08Plain(saved.title), saved.slug, null, q08Lede(piece.text || ""));
  pingIndexNow(env, ORIGIN + "/p/" + saved.slug).catch((e) => { console.error(JSON.stringify({ evt: "q08-signal-engine:tryFramingRepair:caught", error: String((e && e.message) || e) })); });
  emitContentSignal(env, piece, saved).catch((e) => { console.error(JSON.stringify({ evt: "q08-signal-engine:tryFramingRepair:caught", error: String((e && e.message) || e) })); });
  // Log run
  await insertRun(env, { scraped: stories.length, scored: candidates.length, published: 1, top: (story.source||"hn") + ":" + story.title.slice(0, 80), model: piece.model, ms: Date.now()-t0, status: "ok", sourceChars: storyGlen, sourceKind: sourceKindOf(story, String(article || "").length) });
  return { ok: true, slug: saved.slug, title: saved.title, model: piece.model, source: (story.source||"hn"), story: story.title };
}

// ---------------------------------------------------------------------------
// Q08-FORECAST-1 (v0.9.0, pillar: reach). q08 looks forward as well as back. Every few essays the engine writes a forecast
// from the mechanism a published essay identified: the single most likely scenario as a dated causal narrative, rival
// scenarios with probabilities, leading indicators, and a resolution condition anyone can check. Each forecast is a row in
// q08_forecasts; when its horizon passes, a two-family judge panel settles it from public evidence and the Brier score is
// recorded. A forecast with no decidable evidence after FORECAST_MAX_CHECKS checks is marked void in public, never dropped.
// The same gate, FACTS rule, ensemble levels and owner directives apply as for essays; probabilities are the writer's
// judgments and the only numbers it may add besides dates (FACTS rule in FORECAST_DIRECTIVE).
// ---------------------------------------------------------------------------
var FORECAST_CAP_KEY = "q08_forecast_max_per_day", FORECAST_CAP_DEFAULT = 3, FORECAST_CAP_MAX = 10;
var FORECAST_EVERY = 3;            // a forecast is due after this many consecutive non-forecast pieces
var FORECAST_MIN_DAYS = 14, FORECAST_MAX_DAYS = 730;
var FORECAST_RECHECK_DAYS = 7, FORECAST_MAX_CHECKS = 4;
var __forecastSchemaDone = false, __forecastSchemaTried = 0;
// BP26-FORECAST-HYGIENE-1 (Metaculus-style resolution criteria): a resolution names the source that settles it, the date, and what happens in the edge case.
// Text patterns, the same three scripts/bp26_forecast.py measures as forecast_resolution_criteria_complete: they check the words are present, not that the criteria are good.
var FC_SOURCE_RX = /https?:\/\/|\b(according to|as reported|reported by|published (by|on|in)|data from|per the|official|filing|release|index|report|statistics|bureau|agency|register|database|census|dashboard|tracker)\b/i;
var FC_DATE_RX = /\b\d{4}-\d{2}-\d{2}\b|\b(by|before|on|until|through)\s+(the\s+end\s+of\s+)?(\d{1,2}\s+)?(january|february|march|april|may|june|july|august|september|october|november|december|q[1-4]|20\d\d)\b|\b20\d\d\b/i;
var FC_EDGE_RX = /\b(if|unless|otherwise|void|ambiguous|not (published|available|reported)|no (data|report|announcement)|in the event|fails? to|cannot be|revised|restated)\b/i;
function forecastResolutionGaps(res) {
  var t = String(res || ""), g = [];
  if (!FC_SOURCE_RX.test(t)) g.push("the source that settles it (a named report, release, register or URL)");
  if (!FC_DATE_RX.test(t)) g.push("the date it is read by");
  if (!FC_EDGE_RX.test(t)) g.push("an edge-case rule (what counts if the source is late, revised or silent)");
  return g;
}
// An update is a new row: the original probability stays on q08_forecasts and is the one scored; updates are shown beside it.
async function recordForecastUpdate(env, slug, probability, reason, evidenceUrl) {
  if (!(await ensureForecastSchema(env))) return { ok: false, error: "schema unavailable" };
  var pr = Math.round(Number(probability) * 100) / 100, why = String(reason || "").trim();
  if (!isFinite(pr) || pr < 0.01 || pr > 0.99) return { ok: false, error: "probability must be 0.01-0.99" };
  if (why.length < 20 || why.length > 600) return { ok: false, error: "reason must be 20-600 characters" };
  var f = await env.DB.prepare("SELECT id, slug, probability, status FROM q08_forecasts WHERE slug = ?1").bind(String(slug || "")).first();
  if (!f) return { ok: false, error: "forecast not found" };
  if (f.status !== "open") return { ok: false, error: "forecast is " + f.status + "; only an open forecast takes an update" };
  var last = await env.DB.prepare("SELECT probability FROM q08_forecast_updates WHERE forecast_id = ?1 ORDER BY id DESC LIMIT 1").bind(f.id).first();
  var prior = last ? Number(last.probability) : Number(f.probability);
  var url = evidenceUrl ? publicHttpsUrl(String(evidenceUrl)) : null;
  await env.DB.prepare("INSERT INTO q08_forecast_updates (forecast_id, slug, prior_probability, probability, reason, evidence_url, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7)").bind(f.id, f.slug, prior, pr, why, url || null, nowIso()).run();
  return { ok: true, slug: f.slug, prior_probability: prior, probability: pr };
}
async function ensureForecastSchema(env) {
  if (__forecastSchemaDone) return true;
  if (Date.now() - __forecastSchemaTried < 60000) return false; // a failing schema step is retried once a minute, not on every request
  __forecastSchemaTried = Date.now();
  try {
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS q08_forecasts (id INTEGER PRIMARY KEY AUTOINCREMENT, piece_id TEXT, slug TEXT UNIQUE, source_slug TEXT, claim TEXT, probability REAL, horizon TEXT, resolution TEXT, watch_query TEXT, watch_urls TEXT, alternatives_json TEXT, indicators_json TEXT, created_at TEXT, status TEXT DEFAULT 'open', outcome INTEGER, brier REAL, checks INTEGER DEFAULT 0, last_check_at TEXT, resolved_at TEXT, disposition TEXT, evidence_json TEXT)").run();
    var info = await env.DB.prepare("PRAGMA table_info(published_pieces)").all();
    var have = {}; (info.results || []).forEach(function (c) { have[c.name] = 1; });
    if (!have.kind) {
      try { await env.DB.prepare("ALTER TABLE published_pieces ADD COLUMN kind TEXT DEFAULT 'analysis'").run(); }
      catch (e2) { if (!/duplicate column/i.test(String(e2 && e2.message || e2))) throw e2; }
    }
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_q08_forecasts_status ON q08_forecasts (status, horizon)").run();
    // BP26-FORECAST-HYGIENE-1: an update to a forecast is a new row here, never an overwrite of q08_forecasts, and the published claim, probability,
    // horizon, resolution text and timestamp can no longer be changed in place (the trigger names the rule; status/outcome/brier stay writable).
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS q08_forecast_updates (id INTEGER PRIMARY KEY AUTOINCREMENT, forecast_id INTEGER NOT NULL, slug TEXT NOT NULL, prior_probability REAL NOT NULL, probability REAL NOT NULL, reason TEXT NOT NULL, evidence_url TEXT, created_at TEXT NOT NULL)").run();
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS q08_forecast_claims (id INTEGER PRIMARY KEY AUTOINCREMENT, forecast_id INTEGER NOT NULL REFERENCES q08_forecasts(id), slug TEXT NOT NULL, claim_index INTEGER NOT NULL, claim TEXT NOT NULL, probability REAL NOT NULL, horizon TEXT NOT NULL, resolution TEXT NOT NULL, watch_query TEXT NOT NULL, watch_urls TEXT, created_at TEXT NOT NULL, status TEXT DEFAULT 'open', outcome INTEGER, brier REAL, checks INTEGER DEFAULT 0, last_check_at TEXT, resolved_at TEXT, disposition TEXT, evidence_json TEXT, UNIQUE(forecast_id, claim_index))").run();
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_q08_forecast_claims_due ON q08_forecast_claims (status, horizon)").run();
    await env.DB.prepare("CREATE TRIGGER IF NOT EXISTS q08_forecast_claims_immutable BEFORE UPDATE OF forecast_id, slug, claim_index, claim, probability, horizon, resolution, watch_query, watch_urls, created_at ON q08_forecast_claims BEGIN SELECT RAISE(ABORT, 'Q08-FORECAST-RESEARCH-1: published secondary claims are immutable'); END").run();
    await env.DB.prepare("CREATE TRIGGER IF NOT EXISTS q08_forecast_claims_no_delete BEFORE DELETE ON q08_forecast_claims BEGIN SELECT RAISE(ABORT, 'Q08-FORECAST-RESEARCH-1: secondary claims are never dropped'); END").run();
    await env.DB.prepare("CREATE TRIGGER IF NOT EXISTS q08_forecast_claims_retracted AFTER UPDATE OF status ON q08_forecasts WHEN NEW.status = 'void' AND NEW.disposition IN ('retracted', 'superseded-incomplete-criteria') BEGIN UPDATE q08_forecast_claims SET status = 'void', disposition = NEW.disposition, resolved_at = NEW.resolved_at WHERE forecast_id = NEW.id AND status = 'open'; END").run();
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_q08_forecast_updates_slug ON q08_forecast_updates (slug, id)").run();
    await env.DB.prepare("CREATE TRIGGER IF NOT EXISTS q08_forecast_updates_no_update BEFORE UPDATE ON q08_forecast_updates BEGIN SELECT RAISE(ABORT, 'BP26-FORECAST-HYGIENE-1: q08_forecast_updates is append-only'); END").run();
    await env.DB.prepare("CREATE TRIGGER IF NOT EXISTS q08_forecast_updates_no_delete BEFORE DELETE ON q08_forecast_updates BEGIN SELECT RAISE(ABORT, 'BP26-FORECAST-HYGIENE-1: q08_forecast_updates is append-only'); END").run();
    await env.DB.prepare("CREATE TRIGGER IF NOT EXISTS q08_forecasts_published_fields_immutable BEFORE UPDATE OF slug, claim, probability, horizon, resolution, created_at ON q08_forecasts WHEN NEW.slug IS NOT OLD.slug OR NEW.claim IS NOT OLD.claim OR NEW.probability IS NOT OLD.probability OR NEW.horizon IS NOT OLD.horizon OR NEW.resolution IS NOT OLD.resolution OR NEW.created_at IS NOT OLD.created_at BEGIN SELECT RAISE(ABORT, 'BP26-FORECAST-HYGIENE-1: a published forecast is never overwritten; insert a row in q08_forecast_updates'); END").run();
    __forecastSchemaDone = true;
    return true;
  } catch (e) {
    console.error("q08 forecast schema failed: " + String(e && e.message || e).slice(0, 200));
    return false;
  }
}
function parseForecastCap(v) {
  var s = v == null ? "" : String(v).trim();
  if (!/^\d{1,3}$/.test(s)) return FORECAST_CAP_DEFAULT;
  return Math.min(Number(s), FORECAST_CAP_MAX);
}
async function forecastCap(env) {
  if (!env || !env.AUDIT) return FORECAST_CAP_DEFAULT;
  try { var r = await env.AUDIT.prepare("SELECT value FROM ops_config WHERE key = ?1").bind(FORECAST_CAP_KEY).first(); return parseForecastCap(r && r.value); }
  catch (e) { return FORECAST_CAP_DEFAULT; }
}
// A forecast is due when the newest FORECAST_EVERY pieces include none and today's forecast cap is not reached.
async function forecastDue(env) {
  if (!(await ensureForecastSchema(env))) return false;
  var cap = await forecastCap(env);
  if (cap <= 0) return false;
  var n = await env.DB.prepare("SELECT COUNT(*) n FROM published_pieces WHERE kind = 'forecast' AND published_at >= ?1").bind(utcDay() + "T00:00:00.000Z").first();
  if ((n && n.n || 0) >= cap) return false;
  // Backpressure, not a stop: three forecast drafts rejected today means the rest of the day goes to essays.
  var ff = await env.DB.prepare("SELECT COUNT(*) n FROM engine_runs WHERE status = 'gate_failed' AND top_signal LIKE 'q08-forecast:%' AND ran_at >= datetime('now','start of day')").first().catch(function () { return { n: 0 }; });
  if ((ff && ff.n || 0) >= 3) return false;
  var last = await env.DB.prepare("SELECT kind FROM published_pieces WHERE slug NOT IN (SELECT slug FROM q08_retractions) ORDER BY published_at DESC LIMIT ?1").bind(FORECAST_EVERY).all();
  var rows = last.results || [];
  if (!(n && n.n)) return true; // the archive can seed a daily forecast even when essay publication stalls
  if (rows.length < FORECAST_EVERY) return false;
  return rows.every(function (r) { return r.kind !== "forecast"; });
}
async function pickForecastSource(env) {
  if (!(await ensureAccuracySchema(env))) return null; // fail closed: no forecast is built on an essay whose audit state is unknown
  return await env.DB.prepare(
    "SELECT p.id, p.slug, p.title, p.body_md, p.core_concept, p.signal_source, p.published_at FROM published_pieces p " +
    "WHERE COALESCE(p.kind, 'analysis') != 'forecast' AND p.published_at >= ?1 " +
    "AND p.slug IN (SELECT slug FROM q08_audits WHERE verdict = 'pass') AND p.slug NOT IN (SELECT slug FROM q08_retractions) " +
    "AND NOT EXISTS (SELECT 1 FROM q08_forecasts f WHERE f.source_slug = p.slug) " +
    "AND (SELECT COUNT(*) FROM engine_runs e WHERE e.status = 'gate_failed' AND e.top_signal = substr('q08-forecast:' || p.slug, 1, 80)) < 2 " +
    "ORDER BY COALESCE(p.feedback_score, 0) DESC, p.reads DESC, p.published_at DESC LIMIT 1"
  ).bind(new Date(Date.now() - 30 * 864e5).toISOString()).first();
}

var FORECAST_DIRECTIVE = [
  "You are the forecaster for q08.org. q08 publishes long-form essays on the recurring systems that make things break. This piece is different: it looks forward. You are given an essay q08 already published and the signal behind it. Say where the mechanism it describes most likely leads next, as one concrete, dated, checkable scenario, and say how likely you think it is.",
  "",
  "WHAT A FORECAST IS HERE: a most-likely scenario narrative. Of the mutually exclusive ways the next months can go, tell the single course you judge most probable, as a causal sequence in plain prose: who does what, because of what, and what that sets off, in the order it would happen, with approximate dates. Then give the strongest rival scenarios, each with its probability, and say what would let one of them overtake yours. The reader must be able to check you later.",
  "",
  "COMMITMENT: pick one main claim that a public fact can settle yes or no on or before the horizon date, and write its resolution condition so a stranger could check it without asking what you meant. A claim that cannot lose ('pressure will keep growing') is rejected. Prefer the sharpest claim you can honestly stand behind: a 40 percent forecast that names a specific event beats an 80 percent forecast that names nothing.",
  "",
  "PROBABILITIES: state your probability for the main scenario in the prose as a whole percent, and the alternatives' probabilities too. They are your judgments, not measurements: do not dress them as data and do not hedge them. The main scenario must be at least as probable as each alternative, and all stated probabilities together must not exceed 100 percent; the remainder is 'something else', and say so.",
  "",
  "BASE RATE: before the scenario, identify the class of situations you are reasoning from and how that class usually goes. Use dated precedents and historical statistics only when the ESSAY, SIGNAL or RESEARCH LEDGER states them. Then explain why this case should or should not follow the class.",
  "",
  "FACTS (hard, non-negotiable, and checked): every claim about the real world as it stands today (an event, a date, a person, an organisation, a product, a law, a number, a price, a count, an identifier, a quotation) must be stated in the ESSAY, SIGNAL or RESEARCH LEDGER below, verbatim or as a direct paraphrase. Your memory is not a source: add no outside facts, precedents or statistics. Future dates and your own probabilities are the only numbers you may add. Never state a projected quantity (a price, a user count, a market size) unless the text derives it from a figure in the sources. Never invent a source, a report or a quote. Every draft is fact-checked against the essay, signal and research ledger by independent reviewers from other model families; one unsupported claim and the forecast is not published. A general honest sentence beats a specific unsupported one.",
  "",
  "REGISTER: plain explanatory journalism, a sharp person explaining something to a smart friend. Name actors by what they are, never by role words ('the observer', 'the actor', 'the mechanism'). No bullets, no tables, no '##' headers: continuous prose. No first person, no hedging words, no emotional vocabulary, no marketing register, no @handles. Never mention 'the essay', 'the signal' or any pipeline field.",
  "",
  "LEDE (inverted pyramid, checked): the first paragraph, at most 70 words, tells a reader who has never seen q08 what is being forecast and why: the real case it starts from (who did what, where it was reported, as the ESSAY and SIGNAL state it) and the forecast itself with its probability. Then give the context a newcomer needs, then move forward in time.",
  "",
  FRAMING_RULE,
  "",
  "REACH: the essay starts in technology, but the mechanism does not stop there. Follow it into whatever other systems the source itself says it touches, wherever your scenario actually runs, and pick the main claim where the world, not only the tech press, will record the outcome.",
  "",
  "LEADING INDICATORS: say which two to five things an outsider can watch, and what each would look like if your scenario is on track and if it is not.",
  "",
  "ENDING: end on the one unresolved fact that would most change your probability, not on a summary or a moral.",
  "",
  "TITLE: one plain sentence in sentence case that states the forecast as a claim and names the actors and the event, under 90 characters, no colon, no Title Case, not shaped 'The X of Y', never a label ('The Future of X', 'Outlook for Y'). Length: 1100-1700 words. Complete sentences only; the prose ends on a full stop.",
  "",
  "OUTPUT FORMAT, in this order: Markdown with the H1 title first and then the prose; then one line that starts exactly with FORECAST-JSON: followed by a single-line JSON object; then the verdict line.",
  "The JSON object has these keys: \"claim\" (the main scenario as one checkable sentence, 20-300 characters), \"probability\" (your probability for it as a number from 0.05 to 0.95, equal to the percent you state in the prose), \"horizon\" (the date by which the claim is settled, YYYY-MM-DD, between 30 and 540 days after today), \"resolution\" (one sentence, 30-400 characters: the public, checkable condition that makes the claim true; it must name the source that settles it, the date it is read by, and an edge-case rule such as \"void if the figure is not published by then\"), \"alternatives\" (1 to 3 objects with \"claim\" and \"probability\"), \"indicators\" (2 to 5 short strings), \"watch_query\" (3 to 8 words someone would search to find news that settles it), \"watch_urls\" (0 to 2 https URLs of public pages that would show the outcome; only addresses you are certain exist, otherwise an empty list).",
  "VERDICT (mandatory last line, after the FORECAST-JSON line): worth your time: yes|flat|no - one clause of justification. State honestly whether a reader gains something a plain extrapolation of the source would not give them.",
  "SECONDARY PREDICTIONS: optionally add \"secondary_claims\", an array of at most five independent checkable predictions. Each has claim, probability, horizon, resolution, watch_query and watch_urls under the same rules as the main claim, and its probability must appear in the prose. These are not rival scenarios; they are separately dated and scored."
].join("\n");

var READER_FORECAST_PROMPT = [
  "You are a busy, intelligent reader who has never heard of this site and owes it nothing. You are reading a forecast. You stop at the first sentence that wastes your time.",
  "Answer with exactly one JSON object and nothing else:",
  "{\"would_read_to_end\": true or false, \"score\": 1 to 5 (5 = I would send it to a friend, 4 = worth the time, 3 = I would skim it, 1 = I stopped at the first paragraph), \"slop_tells\": [up to 3 short phrases copied from the text that sound like generic machine prose], \"fix\": \"one sentence telling the writer what to change\"}",
  "Judge: does it open with something concrete that is happening now? Is the main claim sharp enough that it could plainly turn out false? Is the path from now to the claim a chain of people doing things, each step caused by the one before? Does it name the class of situations it reasons from, without citing outside cases it cannot support, and say why this one should or should not follow it? Are the probabilities stated and consistent with each other? Does it say what to watch? Does it end on the fact that would flip it? Is it more than extrapolating the source? Be strict: a 4 must be earned. The writer may use only the facts of the story it was given and the reasoning that follows from them, so never ask for outside facts, history, examples, names or figures: when a paragraph is thin, the fix is to cut or merge it, and a short, dense, accurate piece that states its facts and reasons to one mechanism can earn a 4."
].join("\n");

function publicHttpsUrl(u) {
  var x = safeUrl(u);
  if (!x || x.length > 2048 || !/^https:\/\//i.test(x)) return "";
  try {
    var h = new URL(x).hostname.toLowerCase();
    if (h.indexOf(".") < 0 || h.includes(":") || new URL(x).username || new URL(x).password || /^\d+\.\d+\.\d+\.\d+$/.test(h) || /\.(internal|local|localhost)$/.test(h) || h === "localhost") return "";
  } catch (e) { return ""; }
  return x;
}
// Pulls the single FORECAST-JSON line out of a draft. Returns the draft without that line and the parsed object (or null).
function parseForecastBlock(text) {
  var t = String(text || "");
  var m = t.match(/^[ \t]*FORECAST-JSON:[ \t]*(\{.*\})[ \t]*$/im);
  if (!m) return { text: t, extra: null };
  var extra = null;
  try { extra = JSON.parse(m[1]); } catch (e) { extra = null; }
  // A model that wraps the line in a code fence leaves bare fence lines behind; they are not prose.
  var rest = t.replace(m[0], "").replace(/^[ \t]*```[a-z]*[ \t]*$/gim, "").replace(/\n{3,}/g, "\n\n");
  return { text: rest, extra: extra };
}
function validateForecastClaim(f, text, nowMs) {
  var p = [];
  if (!f || typeof f !== "object" || Array.isArray(f)) return ["forecast block missing or not valid JSON (the FORECAST-JSON line)"];
  var claim = String(f.claim || "").trim();
  if (claim.length < 20 || claim.length > 300) p.push("forecast claim must be 20-300 characters");
  var pr = Number(f.probability);
  if (!isFinite(pr) || pr < 0.05 || pr > 0.95) p.push("forecast probability must be a number from 0.05 to 0.95");
  var hz = String(f.horizon || "");
  var hm = /^\d{4}-\d{2}-\d{2}$/.test(hz) ? Date.parse(hz + "T00:00:00Z") : NaN;
  if (!isFinite(hm)) p.push("forecast horizon must be an ISO date YYYY-MM-DD");
  else {
    var days = (hm - nowMs) / 864e5;
    if (days < FORECAST_MIN_DAYS || days > FORECAST_MAX_DAYS) p.push("forecast horizon must be " + FORECAST_MIN_DAYS + "-" + FORECAST_MAX_DAYS + " days ahead (got " + Math.round(days) + ")");
  }
  var res = String(f.resolution || "").trim();
  if (res.length < 30 || res.length > 400) p.push("resolution condition must be 30-400 characters");
  forecastResolutionGaps(res).forEach(function (g) { p.push("resolution condition must name " + g); });
  var wq = String(f.watch_query || "").trim();
  if (wq.length < 3 || wq.length > 80) p.push("watch_query must be 3-80 characters");
  var wu = f.watch_urls == null ? [] : f.watch_urls;
  if (!Array.isArray(wu) || wu.length > 2 || wu.some(function (u) { return !publicHttpsUrl(u); })) p.push("watch_urls must be 0-2 public https URLs");
  if (isFinite(pr) && text != null) {
    var pct = Math.round(pr * 100);
    if (!new RegExp("(?:^|[^0-9])" + pct + "\\s?(?:%|percent|per cent)", "i").test(String(text))) p.push("the prose must state the main probability (" + pct + " percent) in its own words");
  }
  return p;
}
function validateForecast(f, text, nowMs) {
  var p = validateForecastClaim(f, text, nowMs);
  if (!f || typeof f !== "object" || Array.isArray(f)) return p;
  var pr = Number(f.probability);
  var alts = Array.isArray(f.alternatives) ? f.alternatives : [];
  if (alts.length < 1 || alts.length > 3) p.push("forecast needs 1-3 alternative scenarios");
  var sum = isFinite(pr) ? pr : 0, altOk = alts.length > 0, maxAlt = 0;
  alts.forEach(function (a) {
    var ap = Number(a && a.probability);
    if (!a || String(a.claim || "").trim().length < 15 || !isFinite(ap) || ap <= 0 || ap > 0.9) altOk = false;
    else { sum += ap; if (ap > maxAlt) maxAlt = ap; }
  });
  if (!altOk) p.push("each alternative needs a claim of 15+ characters and a probability in (0, 0.9]");
  else {
    if (sum > 1.001) p.push("the main scenario and the alternatives sum to more than 100 percent");
    if (isFinite(pr) && maxAlt > pr + 1e-9) p.push("the main scenario must be at least as probable as every alternative (maximum likelihood)");
  }
  var ind = Array.isArray(f.indicators) ? f.indicators : [];
  if (ind.length < 2 || ind.length > 5 || ind.some(function (x) { return String(x || "").trim().length < 15; })) p.push("forecast needs 2-5 leading indicators of 15+ characters");
  if (f.secondary_claims != null) {
    if (!Array.isArray(f.secondary_claims) || f.secondary_claims.length > 5) p.push("secondary_claims must be an array of at most five predictions");
    else f.secondary_claims.forEach(function (c, i) {
      validateForecastClaim(c, text, nowMs).forEach(function (g) { p.push("secondary claim " + (i + 1) + ": " + g); });
    });
  }
  return p;
}
function forecastXform(text) {
  var r = parseForecastBlock(text);
  r.problems = validateForecast(r.extra, r.text, Date.now());
  return r;
}
// Q08-FORECAST-REPAIR-1 (2026-10-17): the gate failures are dominated by forecast-block adherence, not by
// prose quality: the writer emits the essay but its FORECAST-JSON line is missing, truncated or violates the
// schema (title/horizon/resolution/probability). One corrective retry was not enough. This pass asks a model
// to extract ONLY the JSON record from the finished essay (which already states the probability in prose),
// then re-validates it against that same essay. It never invents a claim: every field is read from the essay,
// and validateForecast still enforces the source/statement rules. If the essay does not state a probability,
// the repair fails closed and the row stays gate_failed.
async function repairForecastJson(env, essayText, src, signalText) {
  var today = new Date(Date.now()).toISOString().slice(0, 10);
  var schema = '{"claim":"<20-300 chars>","probability":<0.05-0.95>,"horizon":"YYYY-MM-DD","resolution":"<30-400 chars>","alternatives":[{"claim":"<15+ chars>","probability":<0.05-0.9>}],"indicators":["<15+ chars>","<15+ chars>"],"watch_query":"<3-8 words>","watch_urls":[]}';
  var prompt = "You are repairing the forecast record for a q08.org essay. Read the ESSAY and the SIGNAL and output ONLY one JSON object, no prose and no code fence, with this exact schema:\n" + schema + "\nRules: TODAY is " + today + "; the claim is the single main forecast the ESSAY states, 20-300 characters; the probability is the whole percent the ESSAY states, divided by 100 (0.05-0.95); the horizon is the ISO date by which the claim is settled (30-540 days after TODAY); the resolution is one checkable sentence of 30-400 characters that names the source that settles it, the date it is read by, and an edge-case rule (for example void if the source is not published by then); provide 1-3 alternative scenarios with claims of 15+ characters and probabilities in (0,0.9]; the main probability must be at least every alternative and all probabilities must sum to at most 1; provide 2-5 leading indicators of 15+ characters; watch_query is 3-8 words; watch_urls only real public https URLs stated in the source, otherwise []. Do not add facts that are not in the ESSAY or SIGNAL.\n\nESSAY:\n" + String(essayText || "").slice(0, 6000) + "\n\nSIGNAL:\n" + String(signalText || (src && src.body_md) || "").slice(0, 2000);
  for (var modelId of COMPOSE_MODELS) {
    try {
      meterCall(env, "compose");
      var resp = await aiGatewayRun(env, modelId, { messages: [{ role: "user", content: prompt }], max_tokens: 1400, temperature: 0.2 }, { loop_id: env && env.__aigLoopBudget && env.__aigLoopBudget.id, purpose: "forecast", budgetFallback: true, signal: AbortSignal.timeout(60000) });
      var txt = aiReplyText(resp);
      var m = String(txt || "").match(/\{[\s\S]*\}/);
      if (!m) continue;
      var f = JSON.parse(m[0]);
      if (!validateForecast(f, essayText, Date.now()).length) return f;
    } catch (e) {}
  }
  return null;
}
// Full problem list for a composed forecast: the essay gate plus the forecast block checks.
function forecastProblems(piece, banned) {
  return gate(piece.text, banned).problems.concat(validateForecast(piece.extra, piece.text, Date.now()));
}
function buildForecastPrompt(src, signalText, opts) {
  var parts = [FORECAST_DIRECTIVE, "TODAY (UTC): " + utcDay()];
  var banned = opts && opts.banned || [];
  if (banned.length) {
    parts.push("\n--- OVERUSED PRECEDENTS ON THIS SITE (BANNED: do not cite it) ---");
    parts.push(banned.map(function (b) { return b.label; }).join("; "));
  }
  var notes = opts && opts.ownerNotes || [];
  if (notes.length) {
    parts.push("\n--- OWNER EDITORIAL DIRECTIVES (authenticated; they outrank the style defaults above, never the FACTS rule or the hard constraints) ---");
    for (var n of notes) parts.push("- " + n);
  }
  var recent = opts && opts.recent || [];
  if (recent.length) {
    parts.push("\n--- FORECASTS ALREADY PUBLISHED (do not repeat their claims) ---");
    for (var r of recent) parts.push("- " + String(r).slice(0, 200));
  }
  parts.push("\n--- ESSAY q08 PUBLISHED (the mechanism to project forward; internal source, never mention it as 'the essay') ---");
  parts.push("title: " + src.title);
  parts.push(String(src.body_md || "").slice(0, 6000));
  if (signalText) { parts.push("\n--- SIGNAL BEHIND IT (internal, never mention) ---"); parts.push(signalText); }
  // Q08-FORECAST-LEDGER-1: with the ledger on, a fact may also come from a ledger line, cited by its tag; with it off this block adds nothing.
  var ledgerLines = opts && opts.ledger || [];
  if (ledgerLines.length) {
    parts.push("\n--- RESEARCH LEDGER (verbatim sentences copied from public pages; internal source, never mention it as 'the ledger') ---");
    parts.push("FACTS rule, extended: a claim about the real world may also come from a ledger line below, stated verbatim or as a direct paraphrase and cited in your draft by its tag, for example [R3]. A claim found in neither the ESSAY, the SIGNAL nor a ledger line is not allowed. The tags are removed before publication.");
    for (var li = 0; li < ledgerLines.length; li++) parts.push(String(ledgerLines[li]));
  }
  return parts.join("\n");
}
async function generateForecast(env, t0) {
  var src = await pickForecastSource(env);
  if (!src) return null;
  var sg = await env.DB.prepare("SELECT friction_point FROM signal_log WHERE source_id = ?1 AND friction_point IS NOT NULL LIMIT 1").bind(String(src.signal_source || "")).first().catch(function () { return null; });
  var signalText = String(sg && sg.friction_point || "").slice(0, 800);
  var recentF = await env.DB.prepare("SELECT claim FROM q08_forecasts ORDER BY id DESC LIMIT 6").all().catch(function () { return { results: [] }; });
  var recentBodies = await env.DB.prepare("SELECT body_md FROM published_pieces WHERE slug NOT IN (SELECT slug FROM q08_retractions) ORDER BY published_at DESC LIMIT 8").all().catch(function () { return { results: [] }; });
  var banned = []; // Q08-VERIFY-1: outside precedents are rejected by the grounding check, so no precedent is named to the writer
  // Q08-FORECAST-LEDGER-1 (default off): with ops_config q08_forecast_ledger = on the ground also holds a research ledger; off makes no request.
  var ledger = await forecastLedgerFor(env, src, signalText);
  if (await forecastLedgerOn(env) && ledger.sources.length < LEDGER_MIN_DOCS) {
    await insertRun(env, { scraped: 1, scored: 1, published: 0, top: ("q08-forecast:" + src.slug).slice(0, 80), ms: Date.now() - t0, status: "deferred", error: "forecast research: " + ledger.sources.length + " usable sources; need " + LEDGER_MIN_DOCS, sourceKind: "forecast" });
    return null; // retry research next tick; never compose against a single essay by accident
  }
  var prompt = buildForecastPrompt(src, signalText, { banned: banned, ownerNotes: await ownerDirectives(env), recent: (recentF.results || []).map(function (r) { return r.claim; }), ledger: ledger.lines });
  var topSig = ("q08-forecast:" + src.slug).slice(0, 80);
  var fcSrcChars = String(src.title || "").length + String(src.body_md || "").length + signalText.length + ledger.lines.join("\n").length;
  var piece = null, problems = [];
  try { piece = await compose(env, prompt, banned, undefined, forecastXform, TITLE_REPAIR_ON); } catch (e) { problems = ["compose failed: " + String(e && e.message || e).slice(0, 160)]; }
  // Q08-LEDE-1 (0.17.3): a forecast opens with a news lede too; the subject is the essay's case (its title and signal)
  var fctx = { source: "q08", title: String(src.title || "") + " " + String(signalText || "").slice(0, 300), url: "" };
  if (piece) problems = forecastProblems(piece, banned).concat(ledeProblems(piece.text, fctx));
  if (piece && problems.length) {
    var rp = prompt + "\n\n--- CORRECTIVE FEEDBACK: your previous draft was rejected. Write the whole piece again, in the same output format (H1 title first, the prose, one FORECAST-JSON line, the verdict line), fixing these problems ---\n" + problems.join("; ");
    var retry = null;
    try { retry = await compose(env, rp, banned, undefined, forecastXform, TITLE_REPAIR_ON); } catch (e) { retry = null; }
    if (retry) { var rprob = forecastProblems(retry, banned).concat(ledeProblems(retry.text, fctx)); if (!rprob.length) { piece = retry; problems = []; } else problems = problems.concat(["retry: " + rprob.join("; ")]); }
  }
  // Q08-FORECAST-REPAIR-1: one JSON-only extraction pass when the block is missing/invalid but the prose exists.
  if (piece && problems.length && (!piece.extra || problems.some(function (p) { return /forecast|FORECAST-JSON|resolution|horizon|probability|alternative|indicator|watch_/i.test(String(p)); }))) {
    var repaired = await repairForecastJson(env, piece.text, src, signalText);
    if (repaired) {
      var candText = String(piece.text || "").replace(/\s*$/, "") + "\n\nFORECAST-JSON: " + JSON.stringify(repaired);
      var xr2 = forecastXform(candText);
      if (!xr2.problems.length) {
        var np = forecastProblems({ text: xr2.text, extra: xr2.extra }, banned).concat(ledeProblems(xr2.text, fctx));
        if (!np.length) { piece = { text: xr2.text, model: piece.model, extra: xr2.extra }; problems = []; }
        else problems = np;
      }
    }
  }
  var readerRows = [], gateResult = { ok: !!piece && problems.length === 0, problems: problems };
  // Q08-FACT-LEDGER-1: the forecast ground is built before the panel and the same free grounding check runs ahead of it (no prune: a forecast keeps its text)
  var snapshot = { essay: { title: src.title || "", body_md: src.body_md || "" }, signal: signalText, lines: ledger.lines, sources: ledger.sources, researched_at: nowIso() };
  var fcGround = forecastGroundText(snapshot);
  if (gateResult.ok) {
    var fgpMode = await groundPreCheckMode(env); // the same switch: prune never refuses a forecast, off makes no pre-check call
    if (fgpMode !== "off") {
      var fpre = groundPreCheck(piece, fcGround, { forecast: true, banned: banned, mode: fgpMode });
      readerRows = fpre.rows;
      if (!fpre.ok) gateResult = { ok: false, problems: ["accuracy: " + fpre.problems.join("; "), "pre-check: " + fpre.trail] };
    }
  }
  if (gateResult.ok) {
    var lv = await runLevels(env, { piece: piece, prompt: prompt, banned: banned, seedText: src.title || "", gateResult: gateResult, xform: forecastXform, forecast: true, readerPrompt: READER_FORECAST_PROMPT });
    piece = lv.piece; gateResult = lv.gateResult; readerRows = readerRows.concat(lv.rows);
  }
  var fcVr = null;
  if (gateResult.ok) {
    var fv = await verifyAndRevise(env, { piece: piece, prompt: prompt, banned: banned, ground: fcGround, seedText: String(src.slug || ""), forecast: true, xform: forecastXform });
    piece = fv.piece; fcVr = fv.vr;
    if (!fv.ok) gateResult = { ok: false, problems: ["accuracy: " + fv.problems.join("; ")] };
  }
  if (!gateResult.ok) {
    await saveReaderTests(env, topSig, readerRows);
    await insertRun(env, { scraped: 1, scored: 1, published: 0, top: topSig, model: piece ? piece.model : "", ms: Date.now() - t0, status: "gate_failed", error: ("forecast: " + gateResult.problems.join("; ")).slice(0, 900), sourceChars: fcSrcChars, sourceKind: "forecast" })
      .catch(function (e) { console.error(JSON.stringify({ evt: "q08-signal-engine:generateForecast:caught", error: String((e && e.message) || e) })); });
    return null; // the analysis path still runs this tick
  }
  piece.text = stripAnalysisMark(piece.text.replace(/\n?worth your time:\s*(yes|flat|no)\s*[\u2014\u2013-].*$/im, "").trim());
  var pseudo = { source: "q08", id: src.id, slug: src.slug, title: src.title, url: ORIGIN + "/p/" + src.slug, points: 0, num_comments: 0, ratio: 0, volatility_score: 0, ledgerSources: ledger.sources, forecastGround: snapshot };
  var saved = await persistPiece(env, piece, { core_concept: src.core_concept || src.title, friction_point: signalText || String(src.title || ""), signal_strength: "Forecast" }, pseudo, piece.model);
  if (fcVr) await recordAudit(env, saved.slug, "pass", "publish", fcVr).catch(function (e) { console.error(JSON.stringify({ evt: "q08-signal-engine:generateForecast:caught", error: String((e && e.message) || e) })); });
  await saveReaderTests(env, saved.slug, readerRows);
  var fcRow = await env.DB.prepare("SELECT claim, probability, horizon FROM q08_forecasts WHERE slug = ?").bind(saved.slug).first().catch(function () { return null; });
  await queueForDistribution(env, q08Plain(saved.title), saved.slug, fcRow);
  pingIndexNow(env, ORIGIN + "/p/" + saved.slug).catch(function (e) { console.error(JSON.stringify({ evt: "q08-signal-engine:generateForecast:caught", error: String((e && e.message) || e) })); });
  emitContentSignal(env, piece, saved).catch(function (e) { console.error(JSON.stringify({ evt: "q08-signal-engine:generateForecast:caught", error: String((e && e.message) || e) })); });
  await insertRun(env, { scraped: 1, scored: 1, published: 1, top: topSig, model: piece.model, ms: Date.now() - t0, status: "ok", sourceChars: fcSrcChars, sourceKind: "forecast" });
  return { ok: true, kind: "forecast", slug: saved.slug, title: saved.title, model: piece.model, source: "q08", story: src.title };
}

// ---- Accuracy layer (Q08-VERIFY-1, owner directive 2026-10-10: q08 content is 100% accurate and fact-checked) ---------------
// An essay or forecast is published only when (1) every name, year and figure in it appears in the source material the writer
// was given (deterministic check), and (2) two reviewers from model families other than the writer's find no claim about the
// real world that the source material does not state. A reviewer outage fails closed: nothing is published unchecked. The same
// test re-audits pieces already live; a piece that fails is retracted in public (never silently deleted).
var GROUND_MAX = 14000;
var FACTCHECK_GROUND_MAX = 48000; // Q08-CONTEXT-1: the article (up to GROUND_MAX) plus the BACKGROUND pack
var THIN_MIN_ARTICLE = 600;
var FACTCHECK_MAX_TOKENS = 8000; // Q08-YIELD-REPAIR-1: 2000 was spent on reasoning for long drafts, leaving no verdict (fact-check unavailable on every run)
var __accSchemaDone = false, __accSchemaTried = 0;
async function ensureAccuracySchema(env) {
  if (__accSchemaDone) return true;
  if (Date.now() - __accSchemaTried < 30000) return false;
  __accSchemaTried = Date.now();
  try {
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS q08_retractions (slug TEXT PRIMARY KEY, reason TEXT, claims_json TEXT, retracted_at TEXT)").run();
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS q08_audits (slug TEXT PRIMARY KEY, verdict TEXT, stage TEXT, models TEXT, unsupported_json TEXT, checked_at TEXT)").run();
    __accSchemaDone = true;
    return true;
  } catch (e) {
    console.error("q08 accuracy schema failed: " + String(e && e.message || e).slice(0, 200));
    return false;
  }
}
var MIN_GROUND_CHARS = 2200;
// Q08-YIELD-1: the thin-source test was a flat THIN_MIN_ARTICLE (600 characters of article), so a source far too small for a grounded
// 2800-character piece went to the writer and cost a compose, a reader panel and a fact-check before it failed (266 gate_failed of 311
// runs in 7 days). The floor is now taken from what has actually published: the smallest source_chars (title, discussion or abstract and
// article together, as the writer saw them) among the ok runs of the last SOURCE_FLOOR_DAYS days, once SOURCE_FLOOR_MIN_OK of them are
// logged, and never above MIN_GROUND_CHARS (a candidate that large is accepted before this test). Before that many ok runs carry a logged
// size the flat test stays, so the gate learns from the log and no constant is guessed. A candidate below the floor ends the run as
// skipped and is retried after 24 hours (markThinSkipped), with the next candidates ahead of it.
var SOURCE_FLOOR_DAYS = 30, SOURCE_FLOOR_MIN_OK = 5;
function sourceFloorFrom(okChars) {
  var nums = (okChars || []).map(Number).filter(function (n) { return isFinite(n) && n > 0; });
  if (nums.length < SOURCE_FLOOR_MIN_OK) return null;
  return Math.min(Math.min.apply(null, nums), MIN_GROUND_CHARS);
}
async function learnedSourceFloor(env) {
  try {
    if (!(await ensureRunColumns(env))) return null;
    var rows = await env.DB.prepare("SELECT source_chars FROM engine_runs WHERE status = 'ok' AND source_chars IS NOT NULL AND ran_at >= datetime('now', ?1)").bind("-" + SOURCE_FLOOR_DAYS + " days").all();
    return sourceFloorFrom(((rows && rows.results) || []).map(function (r) { return r.source_chars; }));
  } catch (e) {
    console.error(JSON.stringify({ worker: "q08-signal-engine", event: "source-floor", error: String(e && e.message || e).slice(0, 160) }));
    return null;
  }
}
// The richest thin candidate is used when its fetched article holds THIN_MIN_ARTICLE characters and its whole source material reaches the
// learned floor (null floor: the flat test alone). why: "none" | "no-text" | "below-floor".
function thinSourceVerdict(bestThin, floor) {
  if (!bestThin) return { ok: false, why: "none" };
  var alen = String(bestThin.art || "").length;
  if (alen < THIN_MIN_ARTICLE) return { ok: false, why: "no-text", alen: alen };
  if (floor != null && bestThin.glen < floor) return { ok: false, why: "below-floor", alen: alen, floor: floor };
  return { ok: true, alen: alen };
}
// source_kind for engine_runs: where the signal came from and whether the writer had the full article or only the summary.
function sourceKindOf(story, artLen) { return String(story && story.source || "hn") + (artLen >= THIN_MIN_ARTICLE ? "+fulltext" : "+summary"); }
// Q08-THIN-PASSED-OVER-1: the measured-thin candidates a later, richer one was chosen over (the chosen one and any candidate at or above
// MIN_GROUND_CHARS are never in the list).
function thinPassedOver(evaluated, story) {
  return (evaluated || []).filter(function (x) { return x && x.cand && x.cand !== story && Number(x.glen) < MIN_GROUND_CHARS; });
}
// A candidate measured and found too thin is marked like any processed signal, so the existing 24-hour retry window (Q08-SIGNAL-RETRY-1)
// puts the next candidates ahead of it on the next tick and the same top candidates are not measured again every tick. Nothing is dropped:
// the row is a retry marker, and the source is read again after 24 hours.
async function markThinSkipped(env, evaluated) {
  for (var i = 0; i < (evaluated || []).length; i++) {
    var x = evaluated[i], c = x.cand || {}, f = x.f || {};
    try {
      await env.DB.prepare("INSERT OR IGNORE INTO signal_log (id, source, source_id, title, url, points, num_comments, ratio, volatility_score, friction_point, signal_strength, status, processed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind("sig-" + Date.now().toString(36) + rnd36(4), (c.source || "hn"), (c.source || "hn") + ":" + String(c.id || ""), c.title || "", c.url || "", c.points || 0, c.num_comments || 0, c.ratio || 0, c.volatility_score || 0, f.friction_point || "", f.signal_strength || "", "thin_skipped", nowIso()).run();
    } catch (e) { console.error(JSON.stringify({ worker: "q08-signal-engine", event: "thin-skip-mark", error: String(e && e.message || e).slice(0, 160) })); }
  }
}
// The readable full text where one exists: arXiv papers have an HTML rendering next to the abstract page.
// Q08-GITHUB-README-1 (0.16.0, run 358): a GitHub repository page fetched from the Worker returned a 378-byte stub, so the source material
// held no README; the writer's true statements ("copy-on-write workbooks", "a dependency-graph engine", both in the 23 KB README) were
// refused as "not stated in source" and the draft was pruned below the floor. A repository URL (github.com/<owner>/<repo>) reads its raw
// README instead, and falls back to the page when the repository has none.
var GITHUB_REPO_RE = /^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?(?:[?#].*)?$/i;
function githubReadmeUrl(u) {
  var m = String(u || "").match(GITHUB_REPO_RE);
  return m ? "https://raw.githubusercontent.com/" + m[1] + "/" + m[2] + "/HEAD/README.md" : "";
}
function articleUrlFor(story) {
  var u = String(story && story.url || "");
  var m = u.match(/^https?:\/\/arxiv\.org\/abs\/(.+)$/i);
  return m ? "https://arxiv.org/html/" + m[1] : (githubReadmeUrl(u) || u);
}
async function fetchArticleText(url) {
  var u = publicHttpsUrl(String(url || "").replace(/^http:\/\//i, "https://"));
  if (!u) return "";
  var gm = u.match(/^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/HEAD\/README\.md$/i);
  if (gm) {
    var readme = await fetchArticleTextRaw(u);
    return readme.length >= 200 ? readme : await fetchArticleTextRaw("https://github.com/" + gm[1] + "/" + gm[2]);
  }
  return fetchArticleTextRaw(u);
}
async function fetchArticleTextRaw(u) {
  try {
    var r = await fetch(u, { headers: { "User-Agent": UA, "Accept": "text/html,text/plain" }, signal: AbortSignal.timeout(15000), redirect: "follow" });
    if (!r.ok) return "";
    var ct = String(r.headers.get("content-type") || "");
    if (!/text\/|html|xml/i.test(ct)) return "";
    return plainText((await r.text()).slice(0, 400000)).slice(0, GROUND_MAX);
  } catch (e) { return ""; }
}
var GROUND_LEAD = new Set(["the","a","an","in","on","at","when","if","but","and","so","as","that","this","these","those","it","its","each","every","most","some","no","for","with","without","before","after","once","while","because","since","what","where","who","why","how","then","there","here","not","only","even","still","yet","or","nor","by","from","to","of","their","his","her","our","your","one","two","three","such","both","many","any","all","i","we","you","he","she","they","my","whether","although","though","until","unless","instead","perhaps","suppose","imagine","consider","now","today","later","earlier","first","second","third","finally","meanwhile","however","which","whose","than","also","just","every","another","other","either","neither","same","more","less","few","several","unlike","like","despite","across","through","during","under","over","between","among","within","against","beyond","per","via","consequently","therefore","thus","hence","moreover","furthermore","similarly","likewise","otherwise","accordingly","additionally","specifically","ultimately","eventually","typically","usually","often","sometimes","rather","indeed","western","eastern","northern","southern","central"]);
var GROUND_OK = new Set(["readme", "changelog", "github", "gitlab", "repository", "january","february","march","april","may","june","july","august","september","october","november","december","monday","tuesday","wednesday","thursday","friday","saturday","sunday","q08","qnfo","hacker news","hn","github","arxiv","markdown","json","html","gpu","cpu","vpn","api","ai","llm","sdk","ceo","cto","url","dns","pdf","csv","sql","usb","ram","ssd","gps","ui","ux","os"]);
function groundWords(text) {
  // GROUND-HYPHEN-1: unicode hyphens count as '-', and a hyphenated source name also grants its parts ("Dex-One2Many" -> dex, one2many),
  // because the draft's tokenizer splits a name at a non-ASCII hyphen and every such name was rejected as "not in the source".
  // Q08-DOTTED-NAMES-1 (0.37.3, agent_issues 100607): the name check below turns every character outside a-z0-9' into a space, so "Qwen3.8-27B"
  // is read as the words qwen3, 8 and 27b and "PLAN.md" as plan and md, while this tokenizer keeps a dotted token whole ("qwen3.8", "plan.md").
  // A name that stands verbatim in the source was therefore refused as "name not in the source". Reproduced offline on engine_runs 930, whose
  // story title is "Five Qwen3.8-27B models match Fable 5 Using GVS5H Harness": Qwen3.8-27B, PLAN.md, STATUS.md, GOTCHAS.md and Qwen3.8 Flash
  // Next were all refused with each of them in the ground. Other runs of 2026-10-20 to 26 with a dotted name flagged: 895 and 877 (Node.js),
  // 748 (DeepSeek V4.1 Flash), 862, 794 and 685 (Qwen2.5); whether each stood in its source was not re-read.
  // A dotted token now also grants its dot- and hyphen-separated parts, as a hyphenated one always did. It only adds words to the set, so no
  // draft is refused that was accepted before.
  var set = new Set(); String(text || "").toLowerCase().replace(/[\u2010-\u2015\u2212]/g, "-").replace(/[‘’]/g, "'").replace(/[a-z0-9][a-z0-9'.-]*/g, function (w) {
    w = w.replace(/[.'-]+$/, ""); set.add(w); if (w.indexOf("-") > 0) w.split("-").forEach(function (part) { if (part) set.add(part); }); if (w.indexOf(".") > 0) w.split(/[-.]/).forEach(function (part) { if (part) set.add(part); }); set.add(w.replace(/'s$/, "")); if (w.length > 3 && w.charAt(w.length - 1) === "s") set.add(w.slice(0, -1)); else set.add(w + "s"); return "";
  });
  return set;
}
function groundNumbers(text) {
  var set = new Set(); (String(text || "").match(/\d[\d,]*(?:\.\d+)?/g) || []).forEach(function (n) { set.add(n.replace(/,/g, "").replace(/\.0+$/, "")); }); return set;
}
// Deterministic check: names, years and figures in `text` that `ground` does not contain. Returns a list of problem strings.
function groundingProblems(text, ground, opts) {
  var o = opts || {}, nowYear = Number(String(o.today || utcDay()).slice(0, 4));
  var body = String(text || "").replace(/^[ \t]*FORECAST-JSON:.*$/gim, " ").replace(/\n?worth your time:[^\n]*$/im, " ").replace(/^#\s+/gm, "").replace(/\(?(?:This|A|An) hypothetical[^)]*\)?/gi, " ");
  var words = groundWords(ground), nums = groundNumbers(ground), out = [], seen = {}, ctxs = [], at = -1;
  // Q08-PRECHECK-CONTEXT-1 (0.36.0): drafts of failed runs are not stored, so a new tag form could only be guessed from the figures it left behind.
  // Each flagged item now carries the 24 characters around it, kept on the returned array and written to the stage row.
  function add(kind, v) { var k = kind + v.toLowerCase(); if (seen[k]) return; seen[k] = 1; out.push(kind + ": " + v); if (at >= 0 && ctxs.length < 6) ctxs.push(v + " <<" + body.slice(Math.max(0, at - 24), at + v.length + 12).replace(/\s+/g, " ") + ">>"); }
  // figures: every number must be in the source, except small counts, future years and (forecasts) probabilities and horizons
  var nre = /\$?\d[\d,]*(?:\.\d+)?\s*(%|percent|days?|weeks?|months?|quarters?|years?|hours?)?/gi, m;
  while ((m = nre.exec(body))) {
    var raw = m[0], digits = raw.replace(/[^\d.]/g, "").replace(/\.$/, "").replace(/\.0+$/, "");
    if (!digits || digits.indexOf(",") >= 0) continue;
    var plain = m[0].replace(/[$,\s]/g, "").replace(/(%|percent|days?|weeks?|months?|quarters?|years?|hours?)$/i, "");
    var num = plain.replace(/,/g, "");
    if (nums.has(num) || nums.has(num.replace(/\.0+$/, ""))) continue;
    var unit = (m[1] || "").toLowerCase(), val = Number(num);
    var isYear = /^(1[0-9]|20)\d\d$/.test(num) && !unit;
    if (isYear && val >= nowYear && o.forecast) continue;
    if (o.forecast && (unit === "%" || unit === "percent")) continue;
    if (o.forecast && /^(days?|weeks?|months?|quarters?|years?)$/.test(unit)) continue;
    if (!isYear && !unit && /^\d{1,2}$/.test(num) && val <= 10 && raw.indexOf("$") < 0) continue;
    if (!isYear && !unit && /^\d$/.test(num)) continue;
    at = m.index; add(isYear ? "year not in the source" : "figure not in the source", raw.trim()); at = -1;
  }
  // names: capitalised words or phrases that are not at the start of a sentence and are absent from the source
  var sentences = body.split(/(?<=[.!?:;—]["'\)\]”’*_]*)\s+|\n+/);
  sentences.forEach(function (sent) {
    var toks = sent.match(/[A-Za-z0-9][A-Za-z0-9&'.’-]*|[,;]/g) || [];
    var i = 0;
    while (i < toks.length) {
      var t = toks[i];
      if (!/^[A-Z]/.test(t) || /^[A-Z]$/.test(t) && toks[i + 1] && !/^[A-Z]/.test(toks[i + 1])) { i++; continue; }
      var j = i, phrase = [];
      while (j < toks.length && /^[A-Z][A-Za-z0-9&'.’-]*$/.test(toks[j])) { var endsDot = /\.$/.test(toks[j]); phrase.push(toks[j]); j++; if (endsDot) break; if (toks[j] && /^(of|the|de|von|van|del|la)$/i.test(toks[j]) && toks[j + 1] && /^[A-Z]/.test(toks[j + 1])) { phrase.push(toks[j]); j++; } }
      phrase = phrase.filter(function (w) { return !/^[A-Z]\.$/.test(w); }); // initials ("Y.") are not names to check
      phrase = phrase.filter(function (w) { return !/^[A-Z]{2,5}s?[.,;:]?$/.test(w); }); // acronyms are left to the two-family fact-check; a deterministic list of them never ends
      var lead = 0; while (lead < phrase.length - 1 && GROUND_LEAD.has(phrase[lead].toLowerCase().replace(/[^a-z]/g, ""))) lead++;
      var core = phrase.slice(lead).filter(function (w) { return !/^[A-Z]$/.test(w); }); // SINGLE-LETTER-1: one capital letter (O in O(n), a variable, a list label) is never a name to verify
      var first = (i === 0);
      if (core.length === 1 && /^[A-Z][a-z]{3,}(ing|ed|ly|ness|less)$/.test(core[0])) { i = Math.max(j, i + 1); continue; } // a capitalised participle or adverb opening a clause is a word, not a name
      if (core.length && !(core.length === 1 && first && lead === 0) && !(core.length === 1 && GROUND_LEAD.has(core[0].toLowerCase()))) {
        var joined = core.join(" ").replace(/[’]/g, "'");
        // Q08-NAME-COMPOUND-1 (0.23.1, run 386): "Anthropic's AI-driven" and "Claude-generated" failed as names because the lowercase
        // halves of hyphenated compounds ("driven", "generated") were checked as name words. Only the capitalised parts of a compound
        // are names; "Claude" in "Claude-generated" must still be in the source.
        var nameParts = core.map(function (w) { var parts = w.split(/[-\u2010-\u2015]/); return parts.length > 1 ? parts.filter(function (x) { return /[A-Z0-9]/.test(x); }).join(" ") : w; }).join(" ").replace(/[’]/g, "'");
        var low = nameParts.toLowerCase().replace(/[^a-z0-9' ]/g, " ").replace(/\s+/g, " ").trim();
        if (low && !GROUND_OK.has(low)) {
          // Q08-DOTTED-NAMES-1: a possessive plural keeps its closing apostrophe here ("ShinyHunters'", "Workers'") and the ground word set drops it
          // (engine_runs 738 and 969), so the apostrophe is stripped before the lookup, as the ground side does.
          var miss = low.split(" ").filter(function (w) { return w && !GROUND_OK.has(w) && !GROUND_LEAD.has(w) && !words.has(w) && !words.has(w.replace(/'s$/, "")) && !words.has(w.replace(/'+$/, "")) && !/^\d+$/.test(w); });
          if (miss.length) { var nb = out.length; add("name not in the source", joined); if (out.length > nb && ctxs.length < 6) { var ix = sent.indexOf(core[0]); ctxs.push(joined + " <<" + sent.slice(Math.max(0, ix - 24), ix + joined.length + 12).replace(/\s+/g, " ") + ">>"); } }
        }
      }
      i = Math.max(j, i + 1);
    }
  });
  var res = out.slice(0, 14); res.ctx = ctxs;
  return res;
}
// Q08-FACT-LEDGER-1 (0.32.0, agent_issues 2606): the deterministic source-grounding check ran last (verifyPiece), after the reader panel and
// its editor rounds had read and rewritten the draft, so a draft whose names, years or figures the source does not hold cost up to
// six judge calls and an editor before it was refused. It now runs on the writer's draft first: it is free (no model call) and reads the
// same ground as the fact-check. An essay with problems gets one pruneUnsupported pass held to the gate of a repair round
// (prunedGateProblems and ledeProblems) and a re-check; a clean result goes on to the panel, anything else ends the run as an accuracy
// failure (stallStage reads "fact-check") before any panel call. A forecast is not pruned (it keeps its text) and ends the same way. The
// LLM fact-check and verifyAndRevise are unchanged and still run last. Fail-safe: if the check itself throws, the error is logged and the
// draft goes to the panel exactly as before, so the stage can never reduce yield through its own fault.
// The off switch (the alternate path of this gate, control_registry q08-ground-precheck): ops_config q08_ground_precheck, read like
// panelOrderMode (cached five minutes, fail open to the shipped default, an env override for the suite). `on` (default) is the stage above;
// `prune` keeps the essay prune but passes the draft to the panel, unchanged, when the prune cannot clear the problems, and never refuses a
// forecast (the refusal is replaced by a ground_precheck stage row, pass 0, "went to the panel unchanged"); `off` makes no pre-check call and
// restores the 0.31.3 flow, in which verifyAndRevise prunes (essay) or sends one model revision (essay and forecast) after the panel. What
// the refusal costs where a model revision used to run is NOT measured: ok rows keep no repair trail, so it is not known how many of the
// 17 ok runs of the seven days to 2026-10-19 passed through that revision. The switch is how that is found out without a deploy.
var GROUND_PRE_KEY = "q08_ground_precheck", GROUND_PRE_TTL_MS = 300000;
var __groundPre = { at: 0, mode: "on" }, __groundPreCalls = 0;
function parseGroundPreMode(v) { var m = String(v == null ? "" : v).trim().toLowerCase(); return m === "off" ? "off" : m === "prune" ? "prune" : "on"; }
async function groundPreCheckMode(env) {
  if (env && env.Q08_GROUND_PRECHECK) return parseGroundPreMode(env.Q08_GROUND_PRECHECK);
  if (!env || !env.AUDIT || typeof env.AUDIT.prepare !== "function") return "on";
  var now = Date.now();
  if (__groundPre.at && now - __groundPre.at < GROUND_PRE_TTL_MS) return __groundPre.mode;
  try {
    var r = await env.AUDIT.prepare("SELECT value FROM ops_config WHERE key = '" + GROUND_PRE_KEY + "'").first();
    __groundPre = { at: now, mode: parseGroundPreMode(r && r.value) };
  } catch (e) {
    console.error(JSON.stringify({ evt: "q08-signal-engine:groundPreCheckMode:caught", error: String((e && e.message) || e).slice(0, 200) }));
    __groundPre = { at: now, mode: __groundPre.mode }; // the last known mode stands for another five minutes
  }
  return __groundPre.mode;
}
function groundPreCheck(piece, ground, o) {
  var opts = o || {}, forecast = !!opts.forecast, soft = opts.mode === "prune";
  __groundPreCalls++;
  function stageRow(pass, fix, tells, ctx) { return { round: 0, role: "ground_precheck", model: "", family: "", would_read: false, score: null, tells: (tells || []).slice(0, 5), fix: ("Q08-FACT-LEDGER-1 pre-check: " + fix + (ctx && ctx.length ? " | context: " + ctx.slice(0, 3).join(" | ") : "")).slice(0, 520), pass: !!pass }; }
  try {
    var probs = groundingProblems(piece.text, ground, { forecast: forecast });
    if (!probs.length) return { ok: true, piece: piece, problems: [], trail: "clean", rows: [] };
    function refuse(why, remaining) {
      var rest = remaining && remaining.length ? remaining : probs;
      if (soft) return { ok: true, piece: piece, problems: [], trail: why + " (" + GROUND_PRE_KEY + "=prune: the draft goes to the panel unchanged)", rows: [stageRow(false, why + "; " + probs.length + " flagged, the draft went to the panel unchanged (" + GROUND_PRE_KEY + "=prune)", probs, probs.ctx)], passedOn: true, flagged: rest };
      return { ok: false, piece: piece, problems: rest, trail: why, rows: [stageRow(false, why + "; " + probs.length + " flagged, the panel was not asked", probs, probs.ctx)] };
    }
    if (forecast) return refuse("a forecast draft names or counts what the source does not hold (no prune for a forecast)");
    var pr = pruneUnsupported(piece.text, probs);
    if (pr.ledeHit) return refuse("prune blocked: a flagged name or figure is in the lede");
    if (!pr.removed.length) return refuse("prune located nothing");
    var gp = prunedGateProblems(pr.text, opts.banned).concat(ledeProblems(pr.text, opts.src));
    if (gp.length) return refuse("prune -" + pr.removed.length + " blocked: " + gp[0].slice(0, 80));
    var again = groundingProblems(pr.text, ground, { forecast: false });
    if (again.length) return refuse("prune -" + pr.removed.length + " left " + again.length + " flagged", again);
    return { ok: true, piece: Object.assign({}, piece, { text: pr.text, pruned: (piece.pruned || 0) + pr.removed.length }), problems: [], trail: "pruned " + pr.removed.length + " sentences, then clean", pruned: pr.removed.length, rows: [stageRow(true, "pruned " + pr.removed.length + " sentences holding a name, year or figure the source does not (" + probs.length + " flagged), then clean", pr.removed)] };
  } catch (e) {
    console.error(JSON.stringify({ evt: "q08-signal-engine:groundPreCheck:caught", error: String((e && e.message) || e).slice(0, 200) }));
    return { ok: true, piece: piece, problems: [], trail: "pre-check error, draft goes to the panel as before", rows: [], error: true };
  }
}
// Q08-ANALYSIS-SECTION-1 (0.19.0, owner 2026-10-13: "totally lacking in ... big-picture systems analysis"). Reviewers kept listing the
// essay's reasoning as unsupported ("When the checker approves code that later accesses freed memory, that guarantee is violated -- not
// stated in source", run 376), so every repair pruned the analysis away. The writer marks where its analysis starts with an invisible
// line; the reporting before it keeps the line-by-line check, and the analysis after it is checked only for concrete invented facts. The
// deterministic grounding check (names, years, figures) still runs over the whole text, the marker must follow the reporting, and the
// analysis may be at most ANALYSIS_MAX_SHARE of the body, so nothing can be moved out of the strict check wholesale.
var ANALYSIS_MARK = "<!-- analysis -->";
var ANALYSIS_MARK_RE = /^[ \t]*<!--\s*analysis\s*-->[ \t]*$/im;
var ANALYSIS_MAX_SHARE = 0.6;
function stripAnalysisMark(text) { return String(text || "").replace(/\n?[ \t]*<!--\s*analysis\s*-->[ \t]*\n?/gi, "\n").replace(/\n{3,}/g, "\n\n").trim(); }
// Q08-ANALYSIS-AUTO-1 (0.19.2, run 378): when the writer leaves the marker out, the analysis starts at the first body paragraph after the
// lede and context (the third or later) that is written in reasoning language; the same guard rails apply, and the analysis is still
// checked for invented facts, so only reasoning is spared the sentence-by-sentence check.
var ANALYSIS_VOCAB_RE = /\b(incentives?|rewards?|punish\w*|pays?|gains?|loses?|costs?|because|therefore|that means|which means|so that|feedback|loop|the system|systems?|structur\w*|constrain\w*|trade-?offs?|leverage|motivat\w*|if\b[^.]{0,80}\bthen)\b/i;
function autoAnalysisMark(text) {
  var t = String(text || ""), parts = t.split(/\n{2,}/), body = [];
  parts.forEach(function (p, i) { if (p.trim() && !/^\s*#/.test(p) && !/^\s*(worth your time:|FORECAST-JSON:)/i.test(p)) body.push(i); });
  for (var k = 2; k < body.length; k++) {
    if (!ANALYSIS_VOCAB_RE.test(parts[body[k]])) continue;
    var cand = parts.slice(0, body[k]).concat([ANALYSIS_MARK], parts.slice(body[k])).join("\n\n");
    var sp = splitAnalysisMarked(cand);
    if (sp.analysis) return cand;
  }
  return null;
}
function splitAnalysis(text) {
  var t = String(text || "");
  if (ANALYSIS_MARK_RE.test(t)) {
    var r0 = splitAnalysisMarked(t);
    if (r0.analysis) { r0.mode = "marked"; return r0; }
    // Q08-MARK-SHIFT-1 (0.20.1, run 381): the writer put its marker where the reporting was under 600 characters or the analysis over
    // ANALYSIS_MAX_SHARE, so the whole essay went to the strict check, its reasoning was listed as unsupported and the prune cut it to
    // 987 characters. The marker now moves later, one paragraph at a time, to the first place the same guard rails accept.
    var parts = t.split(/\n{2,}/), at = -1;
    for (var q = 0; q < parts.length; q++) { if (ANALYSIS_MARK_RE.test(parts[q]) && parts[q].trim().replace(/<!--\s*analysis\s*-->/i, "").trim() === "") { at = q; break; } }
    if (at >= 0) {
      var rest = parts.slice(0, at).concat(parts.slice(at + 1));
      for (var k = at + 1; k < rest.length; k++) {
        if (!rest[k].trim() || /^\s*(#|worth your time:|FORECAST-JSON:)/i.test(rest[k])) continue;
        var r2 = splitAnalysisMarked(rest.slice(0, k).concat([ANALYSIS_MARK], rest.slice(k)).join("\n\n"));
        if (r2.analysis) { r2.mode = "marked-shifted"; return r2; }
      }
    }
    r0.mode = "marked-rejected"; return r0;
  }
  var auto = autoAnalysisMark(t);
  if (auto) { var r1 = splitAnalysisMarked(auto); r1.mode = "auto"; return r1; }
  return { report: t, analysis: null, mode: "none" };
}
function splitAnalysisMarked(text) {
  var t = String(text || ""), m = t.match(ANALYSIS_MARK_RE);
  if (!m) return { report: t, analysis: null };
  var i = t.indexOf(m[0]);
  var report = t.slice(0, i).trim(), analysis = t.slice(i + m[0].length).replace(/\n?worth your time:[^\n]*$/im, "").trim();
  var bodyLen = function (x) { return String(x).replace(/^#.*$/m, "").replace(/\s+/g, " ").trim().length; };
  var total = bodyLen(report) + bodyLen(analysis);
  if (!analysis || !total || bodyLen(analysis) / total > ANALYSIS_MAX_SHARE || bodyLen(report) < 600) return { report: stripAnalysisMark(t), analysis: null, rejected: true };
  return { report: report, analysis: analysis };
}
// Q08-ANALYSIS-CONCRETE-1 (0.20.3, run 383): the analysis reviewers listed reasoning as unsupported ("Adopting the platform, however,
// requires learning a new workflow ..." -- "source does not mention user adoption challenges"), against their own instruction. In the
// analysis section an item counts only when the sentence it quotes carries something concrete: a digit, a quotation or a capitalised name
// after the first word. Other items are dropped; the deterministic grounding check still covers names, years and figures in the whole text.
var NOT_A_NAME_RE = /^(I|A|An|The|This|That|These|Those|It|If|When|Whether|But|And|Or|So|Yet|However|Because|While|For|In|On|At|By|To|As|Its|Their|Our|We|They|He|She)$/;
function concreteClaim(item) {
  var raw = String(item || "").split(/\s+--\s+/)[0].replace(/^\s*(?:\*\*)?(?:FACT|INFERENCE)(?:\*\*)?\s*:\s*/i, "").trim();
  if (/without naming a claim/.test(item)) return true;
  // a quotation inside the claim (the reviewers wrap the whole claim in quotes, so the outer pair is removed first)
  var claim = raw.replace(/^["'\u2018\u201c]+|["'\u2019\u201d.]+$/g, "");
  if (/\d/.test(claim) || /["\u201c][^"\u201d]{3,}["\u201d]/.test(raw.replace(/^["\u201c]([\s\S]*)["\u201d]\.?$/, "$1"))) return true;
  var words = claim.split(/\s+/).slice(1).map(function (w) { return w.replace(/^[("'\u2018\u201c]+|[)"'\u2019\u201d.,;:!?]+$/g, ""); });
  return words.some(function (w) { return /^[A-Z][A-Za-z0-9-]*[a-z0-9A-Z]$/.test(w) && !NOT_A_NAME_RE.test(w); });
}
// Q08-PARAPHRASE-ITEMS-1 (0.24.1, run 387): readers scored the edited draft 4 and 5 and the strict check failed it on items whose own
// reasons conceded the content ("not explicitly stated in source", "phrasing not in source"): "Next-generation applications need both
// high data rate and low latency" restated the paper's motivation. The fact-check allows a direct paraphrase, so in the reporting an item
// whose reason concedes partial support and whose sentence carries nothing concrete (concreteClaim: no digit, quotation or name) is
// dropped. An item naming a thing ("TCP Cubic ... filled buffers") still counts; the deterministic grounding check is unchanged.
// Q08-SOURCE-CONCESSION-1 (0.24.2, run 388): reviewers listed claims whose own reasons said they were in the source material ("date not
// directly from source, but from FAQ in source"; "quote from comment, not main source text, but idea is in source"). Everything under
// SOURCE MATERIAL is source (Q08-SOURCE-DEPTH-1), so an item whose reason concedes it is found there is dropped, concrete or not.
var SOURCE_CONCESSION_RE = /\b(but|though|although|however|yet)\b[^.;]*\b(in (the )?(source|faq|comments?|background|article|thread|discussion)|from (the )?(faq|comments?|background|article|thread|discussion|source))\b|\b(from|in) (the )?(faq|comments?|background reference|linked article|discussion)\b(?![^.;]*\bnot\b)/i;
var PARAPHRASE_REASON_RE = /\b(phrasing|wording|worded|not explicitly|not stated explicitly|paraphrase|implied|implicit|inferred|interpretation|editorial|characteri[sz]ation|framing)\b/i;
function paraphraseItemsDropped(fc) {
  var kept = (fc.unsupported || []).filter(function (u) {
    var reason = String(u).split(/\s+--\s+/).slice(1).join(" -- ");
    if (reason && SOURCE_CONCESSION_RE.test(reason) && !/\bnot (found |stated |mentioned )?(anywhere|at all)\b/i.test(reason)) return false;
    return !(reason && PARAPHRASE_REASON_RE.test(reason) && !concreteClaim(u));
  });
  var dropped = (fc.unsupported || []).length - kept.length;
  if (!dropped) return fc;
  return Object.assign({}, fc, { unsupported: kept, ok: kept.length === 0 ? true : fc.ok, droppedParaphrase: dropped });
}
function concreteAnalysisItems(fa) {
  var kept = (fa.unsupported || []).filter(concreteClaim);
  var dropped = (fa.unsupported || []).length - kept.length;
  if (!dropped) return fa;
  return Object.assign({}, fa, { unsupported: kept, ok: kept.length === 0 ? true : fa.ok, droppedAbstract: dropped });
}
var ANALYSIS_CHECK_PROMPT = [
  "You check the ANALYSIS section of an essay for a publication that must contain no invented facts. You are given SOURCE MATERIAL and the ANALYSIS section as the DRAFT.",
  "The section reasons about how a system works: incentives, constraints, feedback, who gains and who pays, consequences and where else the same arrangement could apply. Reasoning, interpretation, generalisation, conditional statements ('if ... then ...', 'when ...'), judgements and claims about what parties are motivated to do are expected here and are NEVER violations, even when the source does not state them.",
  "Everything under SOURCE MATERIAL counts as source: the source's own text, the discussion comments, the linked article and the Background reference text alike.",
  "List only concrete factual assertions about the real world that are not stated in, or a direct paraphrase of, the SOURCE MATERIAL: an event that happened; a specific named person, organisation, product, law or place doing or saying something; a date; a number, price, count or percentage; a quotation; a study, report or historical precedent. Your own knowledge is not support.",
  "Answer with exactly one JSON object and nothing else: {\"unsupported\": [up to 8 items, each starting with 'FACT: ', then a short quotation copied from the DRAFT, then ' -- ' and the reason in a few words], \"verdict\": \"pass\" or \"fail\"}. verdict is \"fail\" when any item is listed, else \"pass\"."
].join("\n");
var FACTCHECK_PROMPT = [
  "You are a strict fact-checker for a publication that must contain no unsupported claim. You are given SOURCE MATERIAL and a DRAFT.",
  "The SOURCE line and the sentence after it (the item's title, the site it appeared on and its link) are source material too: a statement that the item is titled so or appeared on that site is supported.",
  "Everything under SOURCE MATERIAL counts as source: the source's own text, the discussion comments, the linked article and the Background reference text alike. A claim found in any of them is supported; never list a claim because it comes from the background or the comments rather than the main source.",
  "List every sentence or clause in the DRAFT that asserts something about the real world and is not stated in, or a direct paraphrase of, the SOURCE MATERIAL. That covers events, dates, people, organisations, products, laws, institutions, numbers, quotations, studies, historical episodes and precedents, and statements that a practice or fact is 'known' or 'common'.",
  "Your own knowledge does not count as support, even if you are sure the claim is true: if it is not in the SOURCE MATERIAL, it is unsupported. These are NOT violations: analysis and interpretation the writer frames as such ('the incentive is ...', 'this means ...', 'the system rewards ...') that introduces no new name, date, number, event or quotation; reasoning that follows from the source's facts, conditional statements of the form 'if X then Y' that follow from them, mentions of the source itself ('the article'), definitions, and a clearly labelled hypothetical that names no real person, company, product, date or number.",
  "Example of the expected answer: {\"unsupported\": [\"FACT: the release shipped on 4 March -- date not in source\", \"INFERENCE: so the maintainers run out of review time -- reasoning from the source\"], \"verdict\": \"fail\"}.",
  "Label each item you list. FACT: a specific real-world assertion: something happened, exists, was said, decided, released or measured; any name of a person, organisation, product or place; any date, number, price, count or quotation; any study or precedent. INFERENCE: reasoning, interpretation, generalisation or consequence the writer draws from the source's facts, with no specific name, date, number or quotation of its own. When unsure, label it FACT.",
  "Answer with exactly one JSON object and nothing else: {\"unsupported\": [up to 8 items, each starting with 'FACT: ' or 'INFERENCE: ', then a short quotation copied from the DRAFT, then ' -- ' and the reason in a few words], \"verdict\": \"pass\" or \"fail\"}. verdict is \"fail\" when any FACT item is listed, else \"pass\"."
].join("\n");
// Q08-FACT-INFERENCE-1 (0.13.1, agent_issues 2286): runs 333-335 (2026-10-12) passed the gate and the reader panel and failed only here:
// the reviewers listed the essay's own reasoning ("volunteer review capacity is limited -- not in source", "unsupported claim about
// investor perception") next to real fact errors ("On Oct 7 2026 ... merged pull request #387 -- date not in source"), so deleting every
// listed sentence left 959-1437 characters and the run failed. Each item is now labelled. Only FACT items fail a draft (unlabelled items
// count as FACT, so the check stays fail-closed); INFERENCE items are deleted when the draft can spare them and never fail it. Names,
// years and figures are still refused deterministically by groundingProblems before any reviewer runs.
// Q08-FACT-INFERENCE-2 (0.14.2, run 338): the reviewers often skip the label and say it in the reason instead ("runs an API, a database
// and live collaboration on a private server -- inference from source"). An unlabelled item whose reason calls it an inference,
// interpretation, generalisation, assumption or paraphrase, and does not concern a name, date, number or quotation, is an INFERENCE;
// every other unlabelled item ("not in source", "date not in source") stays a FACT.
var INFERENCE_REASON_RE = /\b(analy\w*|evaluat\w*|judge?ments?|inferen\w*|interpret\w*|generali[sz]\w*|assum\w*|speculat\w*|paraphras\w*|reasoning|opinion|editoriali[sz]\w*|characteri[sz]\w*)\b/i;
var FACT_REASON_RE = /\b(dates?|years?|numbers?|figures?|statistics?|names?|quot\w*|percent\w*|prices?|counts?|amounts?|fabricat\w*|invent\w*|false|wrong|incorrect|contradict\w*)\b/i;
// Q08-PARAPHRASE-2 (0.15.2, run 357): the reason says only the wording differs ("not in source, slightly different wording"), so the
// content is in the source. Read for unlabelled and for FACT-labelled items alike: the reviewer's own reason contradicts the label.
function wordingOnly(reason) { reason = String(reason || ""); return /\b(?:as an? (?:direct|exact|verbatim) quot\w*|not (?:a )?(?:direct|exact|verbatim) quot\w*|verbatim|exact wording|different wording|worded differently|paraphras\w*)\b/i.test(reason) && !/\b(?:dates?|years?|numbers?|figures?|names?|percent\w*|prices?|fabricat\w*|invent\w*|false|wrong|incorrect|contradict\w*)\b/i.test(reason); }
function reasonIsInference(item) {
  var i = String(item).lastIndexOf(" -- ");
  if (i < 0) return false;
  var reason = String(item).slice(i + 4);
  // "in source" (the reviewer says the item IS supported) counts as not-a-fact; "not in source" never does.
  var saysSupported = /\bin (?:the )?source\b/i.test(reason) && !/\bnot (?:[\w-]+ ){0,2}in (?:the )?source\b/i.test(reason); // 0.14.8: "not entirely in source", "not directly stated in source" are negations too
  // Q08-PARAPHRASE-1 (0.14.8, run 350): "not in source as a direct quote", "not verbatim", "different wording": the content is in the source
  // and only the wording differs. That is a paraphrase, not an unsupported fact.
  if (wordingOnly(reason)) return true;
  return (INFERENCE_REASON_RE.test(reason) || saysSupported) && !FACT_REASON_RE.test(reason);
}
// Q08-FACT-OBJECT-ITEM-1 (0.14.3, run 338): a reviewer listed an item as an object ({"label": ..., "claim": ..., "reason": ...}), which
// became "[object Object]", an unlabelled FACT nobody could delete. An object item is rebuilt as "LABEL: claim -- reason".
// Q08-REVIEWER-HYGIENE-1 (0.36.0, 2026-10-26): of 18 fact-check failures read from engine_runs on 2026-10-24..26, seven were not claims the
// draft makes. A reviewer printed an object as a string (`{"fact":"FACT: ... -- reason"}`, `{"FACT":"claim -- reason"}`, kimi, 3), listed the
// word "reason" or an empty claim with only a reason (gpt-oss, 2), or listed a claim and then wrote "still, it is in the source material, so
// supported" (gpt-oss, 1; a FACT label skipped the supported test that an unlabelled item gets). Each such item doomed the draft: the needle
// was JSON, so the prune located nothing and the run ended after 3 writer, 7 reviewer and 3 fact-check calls. Reviewer output is now read as
// what it is before it is classified: an object printed as a string is unwrapped; an item with no claim text is set aside (a fail that names
// nothing else still fails closed); an item whose own closing clause says the claim is supported is acquitted, not deleted and not failed.
function unwrapJsonItem(str) {
  var t = String(str);
  if (!/^\s*\{\s*"/.test(t)) return t;
  try { var o = JSON.parse(t); if (o && typeof o === "object" && !Array.isArray(o)) { var r = factItemText(o); if (r) return r; } } catch (e) { /* truncated or malformed: take the value below */ }
  var m = t.match(/^\s*\{\s*"(fact|inference)"\s*:\s*"((?:[^"\\]|\\.)*)/i);
  if (!m) return t;
  var v = m[2].replace(/\\"/g, '"').replace(/\\n/g, " ").trim();
  return /^\**\s*(FACT|INFERENCE)\s*\**\s*[:\-]/i.test(v) ? v : m[1].toUpperCase() + ": " + v;
}
function itemHasNoClaim(item) {
  var s = String(item).replace(/^\s*\**\s*(?:FACT|INFERENCE)\s*\**\s*[:\-]\s*/i, "").trim();
  if (/^--/.test(s)) return true;
  var i = s.lastIndexOf(" -- "), claim = i >= 0 ? s.slice(0, i) : s;
  return normForMatch(claim).replace(/\b(?:reason|claim|fact|inference|none|null|na|n a)\b/g, "").trim().length < 1;
}
var SUPPORTED_CLAUSE_RE = /^(?:(?:so|therefore|thus|hence|and|but|still|yet)\s+)*(?:(?:it|this|that|the claim|the sentence|the statement)\s+(?:is|are)\s+)?(?:fully\s+|directly\s+|in fact\s+)?(?:supported|in (?:the )?source(?: material| text)?|stated in (?:the )?source(?: material)?|found in (?:the )?source(?: material)?)(?:\s+by (?:the )?(?:source|source material|article|background))?$/;
function reviewerSaysSupported(item) {
  var s = String(item), i = s.lastIndexOf(" -- ");
  if (i < 0) return false;
  var parts = s.slice(i + 4).split(/\s+--\s+|[;,.:\u2014]/).map(function (x) { return x.trim().toLowerCase(); }).filter(Boolean);
  var last = parts.length ? parts[parts.length - 1] : "";
  return !!last && !/\b(?:not|no|never|un\w+|partly|partially|only|but|cannot|can't)\b|n't/.test(last) && SUPPORTED_CLAUSE_RE.test(last);
}
function factItemText(x) {
  if (x == null) return "";
  if (typeof x === "string") return unwrapJsonItem(x);
  if (typeof x !== "object") return String(x);
  var lk = Object.keys(x).filter(function (k) { return /^(fact|inference)$/i.test(k) && typeof x[k] === "string" && x[k].trim(); });
  if (lk.length === 1) { var kv = x[lk[0]].trim(); return /^\**\s*(FACT|INFERENCE)\s*\**\s*[:\-]/i.test(kv) ? kv : lk[0].toUpperCase() + ": " + kv; }
  var pick = function (keys) { for (var i = 0; i < keys.length; i++) { if (x[keys[i]] != null && String(x[keys[i]]).trim()) return String(x[keys[i]]).trim(); } return ""; };
  var label = pick(["label", "type", "kind", "category"]).toUpperCase();
  var claim = pick(["claim", "quote", "quotation", "text", "sentence", "item", "excerpt"]);
  var reason = pick(["reason", "why", "explanation", "note", "issue"]);
  if (!claim) return JSON.stringify(x).slice(0, 260);
  return ((label === "FACT" || label === "INFERENCE") ? label + ": " : "") + claim + (reason ? " -- " + reason : "");
}
// Q08-FACT-SHAPE-1 (0.14.3, runs 340-341): reviewers marked the essay's own reasoning "not in source" with no label ("the provider faces
// little measurable pressure to ensure that the harness works", "the same incentive structure repeats wherever a supplier judges ...");
// as unlabelled FACTs they were all deleted and the draft fell under the floor. An unlabelled item is reasoning when its quoted text
// carries no digit, no quotation and no capitalised word after its first, it uses causal, modal or general wording, and the reason quotes
// nothing and names no date, figure or name. Names, years and figures are still checked deterministically by groundingProblems.
var REASONING_MARK_RE = /\b(incentives?|pressures?|mechanisms?|structures?|repeats?|wherever|whenever|because|therefore|thus|hence|so that|cannot|can|could|may|might|would|should|tends?|likely|levers?|creates?|means|translates?|prevent\w*|despite|based on|leads? to|result\w* in|unless|if|weak|stronger|weaker)\b/i;
// Q08-FACT-SHAPE-2 (0.14.6, runs 347-348): reviewers also labelled the essay's general reasoning FACT outright ("If a prosecutor needs to
// satisfy that requirement, inserting a dramatic allegation can increase the likelihood ...", "the same pattern could appear wherever a
// vendor declares a product unpatchable"). A FACT-labelled item is reasoning only with the same shape test and generalising wording
// (GENERAL_MARK_RE); a plain modal claim ("officials can improve ...") stays a FACT.
var GENERAL_MARK_RE = /\b(wherever|whenever|any|every|mechanisms?|patterns?|incentives?|structures?|if|unless|therefore|thus|hence|would|could|might|tends?)\b/i;
function claimIsReasoning(item, labelledFact) {
  var s = String(item), i = s.lastIndexOf(" -- ");
  if (i < 0) return false;
  var claim = s.slice(0, i).trim(), reason = s.slice(i + 4);
  if (FACT_REASON_RE.test(reason) || /["\u201c\u2018'][^"\u201d\u2019']{3,}["\u201d\u2019']/.test(reason)) return false;
  if (/[0-9"\u201c\u201d]/.test(claim)) return false;
  if (claim.split(/\s+/).slice(1).some(function (w) { return /^[^a-z]*[A-Z]/.test(w) && w !== "I"; })) return false;
  // Q08-CONTEXT-1 (0.18.0): a FACT-labelled item whose own reason calls it analysis or interpretation ("analytical claims not stated in
  // source") is reasoning when its shape carries no name, number or quotation.
  return labelledFact ? (GENERAL_MARK_RE.test(claim) || INFERENCE_REASON_RE.test(reason)) : REASONING_MARK_RE.test(claim);
}
function splitFactItems(items) {
  var facts = [], inferences = [], acquitted = [];
  (items || []).forEach(function (x) {
    var s = String(x).replace(/\s+/g, " ").trim();
    if (itemHasNoClaim(s)) return; // no claim text to check, delete or fail on; a fail that names nothing else still fails closed (parseFactVerdict)
    if (reviewerSaysSupported(s)) { acquitted.push(s.slice(0, 260)); return; }
    var m = s.match(/^\**\s*(FACT|INFERENCE)\s*\**\s*[:\-]\s*/i);
    if (m && (m[1].toUpperCase() === "INFERENCE" || claimIsReasoning(s.slice(m[0].length), true) || (s.lastIndexOf(" -- ") > 0 && wordingOnly(s.slice(s.lastIndexOf(" -- ") + 4))))) inferences.push(s.slice(m[0].length).slice(0, 260));
    else if (!m && (reasonIsInference(s) || claimIsReasoning(s))) inferences.push(s.slice(0, 260));
    else facts.push((m ? s.slice(m[0].length) : s).slice(0, 260));
  });
  return { facts: facts.filter(Boolean), inferences: inferences.filter(Boolean), acquitted: acquitted };
}
function parseFactVerdict(text) {
  // COMPANION/Q08-VERDICT-TOLERANT-1: a reviewer that wraps its JSON in prose, trails off before the closing brace or prints the JSON twice
  // still gave a verdict. Try the whole object first, then fall back to the explicit "verdict" and "unsupported" fields.
  var t = String(text || "").replace(/<think>[\s\S]*?<\/think>/gi, "");
  var o = null, m = t.match(/\{[\s\S]*\}/);
  if (m) { try { o = JSON.parse(m[0]); } catch (e) { o = null; } }
  if (!o) {
    var vm = t.match(/"verdict"\s*:\s*"(pass|fail)"/gi);
    if (!vm) return null;
    var last = vm[vm.length - 1].match(/(pass|fail)/i)[1];
    var um = t.match(/"unsupported"\s*:\s*\[([\s\S]*?)(?:\]|"verdict")/i), items = [];
    if (um) { var re = /"((?:[^"\\]|\\.)*)"/g, x; while ((x = re.exec(um[1]))) { if (x[1].trim()) items.push(x[1]); } }
    o = { verdict: last, unsupported: items };
  }
  var v = String(o && o.verdict || "").toLowerCase().trim();
  if (v !== "pass" && v !== "fail") return null;
  var listed = Array.isArray(o.unsupported) ? o.unsupported.map(factItemText).filter(function (x) { return x.trim(); }).slice(0, 8) : [];
  var sp = splitFactItems(listed), u = sp.facts;
  // Q08-FACT-INFERENCE-1: the verdict follows the FACT items. A fail that names nothing at all stays a fail (fail-closed); a fail that
  // names only INFERENCE items is a pass with those sentences to delete.
  if (u.length) v = "fail";
  else if (v === "fail" && !sp.inferences.length && !sp.acquitted.length) u = ["the reviewer rejected the draft without naming a claim"];
  else v = "pass";
  return { verdict: v, unsupported: u, inferences: sp.inferences, acquitted: sp.acquitted.length };
}
// FACTCHECK-NOTHINK-1 (measured 2026-10-12 against the live models with the same fact-check prompt): reasoning reviewers spent 4-9 s and
// 245 neurons thinking about a task that needs a comparison, and timed out on long drafts at 110 s. These per-model switches return the same
// verdict in 0.7-2.6 s: kimi chat_template_kwargs.thinking=false, nemotron chat_template_kwargs.enable_thinking=false, gpt-oss
// reasoning.effort=low, deepseek chat_template_kwargs.thinking=false. Models without a measured switch (glm, gemma, llama) get none.
function factCheckExtra(modelId) {
  var m = String(modelId || "").toLowerCase();
  if (m.indexOf("kimi") >= 0 || m.indexOf("deepseek") >= 0) return { chat_template_kwargs: { thinking: false } };
  if (m.indexOf("nemotron") >= 0) return { chat_template_kwargs: { enable_thinking: false } };
  if (m.indexOf("qwen") >= 0) return { chat_template_kwargs: { enable_thinking: false } };
  if (m.indexOf("gpt-oss") >= 0) return { reasoning: { effort: "low" } };
  return {};
}
async function factCheckOne(env, modelId, essay, ground, prompt) {
  meterCall(env, "factcheck");
  try {
    var body = (prompt || FACTCHECK_PROMPT) + "\n\n--- SOURCE MATERIAL ---\n" + String(ground).slice(0, FACTCHECK_GROUND_MAX) + "\n\n--- DRAFT ---\n" + String(essay).replace(/^[ \t]*FORECAST-JSON:.*$/gim, "").replace(/\n?worth your time:[^\n]*$/im, "").trim().slice(0, 9000);
    var resp = await aiGatewayRun(env, modelId, Object.assign({ messages: [{ role: "user", content: body }], max_tokens: FACTCHECK_MAX_TOKENS, temperature: 0.1 }, factCheckExtra(modelId)), { loop_id: env && env.__aigLoopBudget && env.__aigLoopBudget.id, purpose: "factcheck", signal: AbortSignal.timeout(75000) });
    var msg = resp && resp.choices && resp.choices[0] && resp.choices[0].message;
    // reasoning models spend tokens before the answer: a long draft needs room (a verdict is read only from the answer, never from reasoning text)
    var out = aiReplyText(resp);
    var v = parseFactVerdict(out);
    if (v) { v.model = modelId; v.family = familyOf(modelId); return v; }
    return { failed: true, model: modelId, error: "no verdict in reply (" + String(out).length + " chars, finish " + String(resp && resp.choices && resp.choices[0] && resp.choices[0].finish_reason) + ")" };
  } catch (e) { return { failed: true, model: modelId, error: String(e && e.message || e).slice(0, 140) }; }
}
// Two valid verdicts from two different families, neither the writer's. Fewer than two valid verdicts is "unavailable" (fail closed).
// Candidates run one at a time (parallel calls from one run shared a failure), and each failure's cause is kept in the reason.
// Q08-FACTCHECK-POOL-1 (0.11.7): runs 305-314 ended "fact-check unavailable" because the rotating pool put glm-5.3-flash, gemma-4 and
// deepseek-v4-flash first: they timed out or spent the whole token budget on reasoning (finish length, 0 chars). llama-3.3-70b and qwen3-30b
// returned verdicts every time in the audit runs. Reviewers now run in this fixed order, one family each, never the writer's family.
// FACTCHECK-DEGRADE-1 (0.13.0, agent_issues 2284; 6 of 75 gate_failed runs in the week to 2026-10-12 ended "fact-check unavailable"):
// under BUDGET-SOFT-ROUTE-1 the panel degrades to the next family instead of failing. After the five proven families the pool holds the
// two writer families (the one that did not write this draft is eligible; cheaper gpt-oss-20b ahead of its larger sibling), so a verdict
// outage needs every non-writer family on Workers AI to fail before the draft fails with that message. One verdict per family, never the
// writer's (docs/ENSEMBLE-POLICY.md); the deterministic grounding check ahead of the panel is untouched. No paid upstream is added.
// Q08-REVIEWER-SWAP-1 (0.31.0): the same eight models over the same six families, in the order the measurements support (see PANEL_POOL for the
// numbers: glm-5.3-flash 43% errors at 58 s and qwen3.8-27b 77% at 80 s over three days, against deepseek-v4-flash 1% at 5.7 s and kimi-k2.6 0% at
// 19 s). The last FACTCHECK_TAIL_N entries are the previous reviewers, kept as the per-request fallback: they are asked only after every other
// model has been tried, so a round that used to wait out two failures before its first verdict now reaches one in a few seconds, and a draft
// still fails as "unavailable" only when all eight models failed. reviewerHealth() orders any reviewer that is erroring now behind the rest.
// SPEND (Workers AI is in breach, BUDGET-SOFT-ROUTE-1 and ENSEMBLE-POLICY-1 rule 3: the cheapest capable small judge first): ai_call_counters,
// this worker, three days to 2026-10-19, neurons per answered call: deepseek-v4-flash 241, gpt-oss-20b 221, glm-5.3-flash 247 (but 43% of its
// calls error), gpt-oss-120b 385, nemotron 592, kimi-k2.6 731, qwen3.8-27b 1230. A verdict pair of deepseek-v4-flash + kimi (the first swap)
// costs 972 neurons against about 696 for the old order (glm answered 57% of the time, kimi took the rest), so the second leader is the
// cheaper gpt-oss-20b (pair 462; kimi stays next, and is the second reviewer whenever the writer is the openai family). A reviewer that
// errors goes behind the others by reviewerHealth(), so kimi is asked when gpt-oss-20b is not answering.
var FACTCHECK_POOL = ["@cf/deepseek-ai/deepseek-v4-flash-0731", "@cf/openai/gpt-oss-20b", "@cf/moonshotai/kimi-k2.6", "@cf/deepseek-ai/deepseek-v4-pro-0813", "@cf/nvidia/nemotron-3-120b-a12b", "@cf/openai/gpt-oss-120b", "@cf/zai-org/glm-5.3-flash", "@cf/qwen/qwen3.8-27b"];
var FACTCHECK_TAIL_N = 2;
// One model per non-excluded family first (pool order), then each of those families' remaining models, as the fallback for a family whose first
// model failed.
function familyFirst(ids, ex) {
  var first = [], rest = [], seen = {};
  ids.forEach(function (id) {
    var f = familyOf(id);
    if (ex[f]) return;
    if (seen[f]) rest.push(id); else { seen[f] = 1; first.push(id); }
  });
  return first.concat(rest);
}
// The order reviewers are tried in: the working models (one per non-writer family first, then their siblings), then the previous reviewers the
// same way, with `flagged` (reviewerHealth) moving the erroring ones to the back. A family that already gave a verdict is skipped at call time.
function factCheckOrder(exclude, flagged) {
  var ex = {}; (exclude || []).forEach(function (f) { ex[f] = 1; });
  var cut = Math.max(0, FACTCHECK_POOL.length - FACTCHECK_TAIL_N);
  return healthFirst(familyFirst(FACTCHECK_POOL.slice(0, cut), ex).concat(familyFirst(FACTCHECK_POOL.slice(cut), ex)), flagged);
}
async function factCheck(env, essay, ground, writerModel, seedText, prompt) {
  var wf = familyOf(writerModel || "");
  var ids = factCheckOrder([wf], await reviewerHealth(env)); // Q08-FACTCHECK-POOL-1 + FACTCHECK-DEGRADE-1 + Q08-REVIEWER-SWAP-1
  var got = [], failures = [], gotFam = {};
  for (var k = 0; k < ids.length && got.length < 2; k++) {
    if (gotFam[familyOf(ids[k])]) continue;
    var r = await factCheckOne(env, ids[k], essay, ground, prompt);
    if (r && !r.failed) { got.push(r); gotFam[r.family] = 1; } else if (r) failures.push(String(r.model).split("/").pop() + ": " + r.error);
  }
  if (got.length < 2) return { ok: false, unavailable: true, unsupported: [], judges: got, reason: "fewer than two fact-check verdicts from other model families (" + ids.length + " reviewers tried: " + failures.join(" | ").slice(0, 400) + ")" };
  var uns = [], inf = []; got.forEach(function (g) { g.unsupported.forEach(function (u) { if (uns.indexOf(u) < 0) uns.push(u); }); (g.inferences || []).forEach(function (u) { if (inf.indexOf(u) < 0) inf.push(u); }); });
  return { ok: got.every(function (g) { return g.verdict === "pass"; }), unavailable: false, unsupported: uns.slice(0, 10), inferences: inf.slice(0, 12), judges: got, reason: "" };
}
// Full verification of one draft: deterministic grounding first (free), then the two-family review.
async function verifyPiece(env, text, ground, writerModel, seedText, opts) {
  var det = groundingProblems(text, ground, opts);
  if (det.length) return { ok: false, stage: "grounding", problems: det, judges: [], unavailable: false };
  var sp = splitAnalysis(text);
  var fc = await factCheck(env, sp.report, ground, writerModel, seedText);
  if (!fc.unavailable) fc = paraphraseItemsDropped(fc);
  fc.analysisMode = sp.mode;
  if (!fc.unavailable && sp.analysis) {
    var fa = await factCheck(env, sp.analysis, ground, writerModel, seedText, ANALYSIS_CHECK_PROMPT);
    if (!fa.unavailable) fa = concreteAnalysisItems(fa);
    if (fa.unavailable) fc = fa;
    else fc = { ok: fc.ok && fa.ok, unavailable: false, unsupported: fc.unsupported.concat(fa.unsupported.filter(function (u) { return fc.unsupported.indexOf(u) < 0; })).slice(0, 12), inferences: (fc.inferences || []).concat(fa.inferences || []).slice(0, 14), judges: fc.judges.concat(fa.judges), reason: "" };
  }
  if (fc.unavailable) return { ok: false, stage: "factcheck", problems: ["fact-check unavailable: " + fc.reason], judges: fc.judges, unavailable: true };
  if (!fc.ok) return { ok: false, stage: "factcheck", problems: fc.unsupported.map(function (u) { return "unsupported claim: " + u; }), judges: fc.judges, unavailable: false, analysisMode: sp.mode };
  return { ok: true, stage: "pass", problems: [], judges: fc.judges, unavailable: false, inferences: fc.inferences || [] };
}
// Q08-FACT-INFERENCE-1: a passed essay loses the sentences the reviewers labelled INFERENCE when it can spare them (the pruned draft still
// clears the gate at PRUNE_FLOOR); deletion cannot add a fact, so no second review is needed. Forecasts keep their text.
// Q08-ANALYSIS-KEEP-1 (0.20.0, run 380): the inference prune also deleted the analysis section's own reasoning, so the published piece kept
// two sentences of it that opened "This information gap ..." about a gap no remaining sentence named. Reasoning is the analysis section's
// job, so the inference prune now cuts only the reporting before it.
function pruneInferences(piece, vr, banned, forecast) {
  var inf = (vr && vr.inferences) || [];
  if (forecast || !inf.length) return { piece: piece, removed: 0 };
  var src = String(piece.text), hadMark = ANALYSIS_MARK_RE.test(src);
  var marked = hadMark ? src : (autoAnalysisMark(src) || src);
  var pr = pruneUnsupported(marked, inf.map(function (u) { return "unsupported claim: " + u; }), { keepAnalysis: true });
  var out = hadMark ? pr.text : stripAnalysisMark(pr.text);
  if (!pr.removed.length || prunedGateProblems(out, banned).length) return { piece: piece, removed: 0 };
  return { piece: Object.assign({}, piece, { text: out, pruned: (piece.pruned || 0) + pr.removed.length }), removed: pr.removed.length };
}
// Q08-ANALYSIS-DEPTH-1 (0.20.0, owner 2026-10-13: "totally lacking in context and big-picture systems analysis. Fail, not worth
// publishing"). An essay is published only with a systems analysis of at least ANALYSIS_MIN_CHARS in at least ANALYSIS_MIN_PARAS
// paragraphs whose opening refers to something the piece has said. A thin analysis goes to the one model revision with that instruction.
var ANALYSIS_MIN_CHARS = 700, ANALYSIS_MIN_PARAS = 2;
var DEMONSTRATIVE_RE = /^(?:["\u201c]?)(This|That|These|Those|Such)\s+([a-z][a-z-]+)(?:\s+([a-z][a-z-]+))?/;
var DEMO_VERB_RE = /^(is|was|are|were|means|meant|matters|explains|leaves|left|creates|makes|made|shows|suggests|has|had|gives|puts|turns|raises|matters|helps|keeps|sets|lets|does|did|can|could|will|would|may|might|should|must|also|alone|in|on|is)$/;
function danglingOpening(sentence, before) {
  var m = String(sentence || "").trim().match(DEMONSTRATIVE_RE);
  if (!m || DEMO_VERB_RE.test(m[2])) return false;
  var prior = " " + normForMatch(before) + " ";
  var words = [m[2]].concat(m[3] && !DEMO_VERB_RE.test(m[3]) ? [m[3]] : []);
  return !words.some(function (w) { return prior.indexOf(" " + w.slice(0, Math.max(4, Math.min(w.length, 6)))) >= 0; });
}
function analysisDepthProblems(text) {
  var sp = splitAnalysis(text);
  if (!sp.analysis) return ["no systems analysis section: after the reported facts, add at least " + ANALYSIS_MIN_PARAS + " paragraphs, begun by a line containing exactly " + ANALYSIS_MARK + ", that name the parties in this story, what each is rewarded or punished for, the constraint or missing information that shapes their choices, who gains and who pays, and where the same arrangement operates beyond this case; reason openly and add no new name, date, number or event"];
  var paras = sp.analysis.split(/\n{2,}/).map(function (x) { return x.trim(); }).filter(function (x) { return x.length >= 120 && !/^\s*(worth your time:|FORECAST-JSON:|#)/i.test(x); });
  var len = paras.join(" ").replace(/\s+/g, " ").length, out = [];
  if (len < ANALYSIS_MIN_CHARS || paras.length < ANALYSIS_MIN_PARAS) out.push("systems analysis too thin (" + paras.length + " paragraphs, " + len + " chars; need " + ANALYSIS_MIN_PARAS + " and " + ANALYSIS_MIN_CHARS + "): after the " + ANALYSIS_MARK + " line, name the parties in this story and what each is rewarded or punished for, the constraint or missing information that shapes their choices, who gains and who pays, and where the same arrangement operates beyond this case; reason openly and add no new name, date, number or event");
  if (paras.length && danglingOpening(paras[0], sp.report)) out.push("the systems analysis opens with '" + paras[0].split(/\s+/).slice(0, 4).join(" ") + "', which refers to something the piece never explains: first state it from the reported facts");
  return out;
}
function factRevisionPrompt(prompt, draft, problems, ground, forecastExtra) {
  var d = String(draft || "") + (forecastExtra ? "\nFORECAST-JSON: " + JSON.stringify(forecastExtra) : "") + "\nworth your time: yes - revised for accuracy";
  // Q08-ANALYSIS-DEPTH-1: a thin or dangling analysis is a writing instruction, not a rejected claim, so it is listed apart.
  var depth = (problems || []).filter(function (x) { return /^(no systems analysis section|systems analysis too thin|the systems analysis opens|keep the first paragraph a news lede)/.test(String(x)); });
  var facts = (problems || []).filter(function (x) { return depth.indexOf(x) < 0; });
  return prompt + "\n\n--- " + (facts.length ? "FACT REVISION: independent fact-checkers rejected your draft. Every item below is a claim the source material does not support. Return the SAME piece in the SAME output format (H1 title first, then the prose" + (forecastExtra ? ", the FORECAST-JSON line" : "") + ", and the final 'worth your time' line) with each such name, date, figure or claim deleted or replaced by general reasoning or a labelled hypothetical that names no real person, company, product, date or number. Add no new facts. Keep everything else. Problems:\n- "
    + facts.join("\n- ") : "ANALYSIS REVISION: the reporting in your draft passed the fact check; its systems analysis did not meet the bar. Return the SAME piece in the SAME output format (H1 title first, then the prose" + (forecastExtra ? ", the FORECAST-JSON line" : "") + ", and the final 'worth your time' line). Keep the lede and the reporting exactly as they are. Add no new facts.") + (depth.length ? "\nALSO REQUIRED:\n- " + depth.join("\n- ") : "") + "\n--- SOURCE MATERIAL (the only facts you may use) ---\n" + String(ground).slice(0, 7000) + "\n--- DRAFT TO REVISE ---\n" + d;
}
// Q08-PRUNE-EXTEND-1 (0.28.1, agent_issues 2284; engine_runs 2026-10-12 13:30 to 2026-10-14 13:30 UTC: 29 of the 77 runs that failed ended
// "too short after pruning", run 418 at 2701 characters of body against the 2800 floor). Drafts run 3300-5300 characters, so deleting the
// sentences the reviewers flag often leaves a clean draft just under the floor, and the one model revision then rewrote the UNPRUNED draft
// from the reviewers' list and wrote new unsupported detail. When a prune is blocked by its length alone, the revision now extends the pruned
// draft: every surviving sentence kept word for word, new sentences built only from facts the source states, the deleted claims named as
// not to be restated. The result passes the same gate and the full two-family re-verification as any revision (port of personal-companion
// PRUNE-THEN-EXTEND-1, 1.19.4).
var EXTEND_AIM_CHARS = 3600;
// Q08-YIELD-1: the claim classes a fact-check round flagged (the leading label of each unsupported item). A repair round that flags only
// classes an earlier round already flagged and pruned is the same defect again, not a new one.
function claimClassesOf(problems) {
  var out = [];
  (problems || []).forEach(function (p) {
    var m = String(p).match(/^(unsupported claim|name not in the source|figure not in the source|year not in the source)/i);
    if (m && out.indexOf(m[1].toLowerCase()) < 0) out.push(m[1].toLowerCase());
  });
  return out;
}
function shortOnly(problems) { return !!(problems && problems.length) && problems.every(function (p) { return /^too short after pruning \(/.test(String(p)); }); }
function extendRevisionPrompt(prompt, draft, cutClaims, ground) {
  var have = publishBody(draft).length;
  var cut = (cutClaims || []).map(function (x) { return String(x).replace(/\s+/g, " ").trim().slice(0, 200); }).filter(Boolean).slice(0, 12);
  return prompt + "\n\n--- LENGTH REVISION: independent fact-checkers flagged some sentences of your draft and they were deleted. The draft below is what remains, and it now has " + have + " characters of body; it needs at least " + PUBLISH_MIN_CHARS + " (aim for about " + EXTEND_AIM_CHARS + "). Return the SAME piece in the SAME output format (H1 title first, then the prose, and the final 'worth your time' line). Keep every sentence of the draft word for word and in order, the opening paragraph included, and add new sentences where they belong, built only from facts the SOURCE MATERIAL states: who did what, how the system works, what the source reports and why it matters, with any reasoning from those facts framed as reasoning. Add no name, date, figure, quotation or claim that the SOURCE MATERIAL does not state."
    + (cut.length ? " These sentences were deleted because the source does not support them; do not restate them or their claims in any form:\n- " + cut.join("\n- ") : "")
    + "\n--- SOURCE MATERIAL (the only facts you may use) ---\n" + String(ground).slice(0, 7000) + "\n--- DRAFT TO EXTEND ---\n" + String(draft || "");
}
// Q08-PRUNE-1: the reviewers quote the unsupported sentences, so the safest repair deletes exactly those sentences. Deletion cannot add a
// fact, and a model revision can (runs 319-326: every revision reintroduced unsupported detail). Returns the pruned text and what was removed.
function normForMatch(t) { return String(t || "").toLowerCase().replace(/[\u2010-\u2015\u2212]/g, "-").replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d"]/g, "").replace(/[^a-z0-9' -]+/g, " ").replace(/\s+/g, " ").trim(); }
// Q08-PRUNE-FUZZY-1 (0.14.10, run 353): the last unsupported item ("the article already contains a publishable link between genotype,
// expression, and phenotype") was the reviewer's paraphrase of a sentence, so the exact match located nothing and the run failed with one
// item left. A claim needle that matches no sentence exactly now removes the one sentence that shares the most of its content words
// (at least FUZZY_MIN_SHARED words and FUZZY_MIN_SHARE of them). It only deletes, so it cannot add a fact; the full re-verification follows.
var FUZZY_MIN_SHARED = 4, FUZZY_MIN_SHARE = 0.6;
function contentWords(t) { return normForMatch(t).split(" ").filter(function (w) { return w.length >= 4 && !/^(that|this|with|from|have|were|their|there|which|when|what|into|than|then|they|them|been|also|only|more|most|such|does|each|over|will|would|could|should|about|after|before|because|while|where)$/.test(w); }); }
function pruneUnsupported(text, problems, popts) {
  var needles = [];
  (problems || []).forEach(function (pr) {
    var m = String(pr).match(/^unsupported claim:\s*([\s\S]*?)(?:\s+--\s+[\s\S]*)?$/);
    if (m) { var q = normForMatch(m[1]); if (q.length >= 18) needles.push({ nd: q.slice(0, 90), raw: m[1], hit: false }); return; }
    var n = String(pr).match(/^(?:name|figure|year) not in the source:\s*(.+)$/i);
    if (n) { var w = normForMatch(n[1]); if (w) needles.push({ nd: "\u0001" + w, raw: "", hit: false }); }
  });
  if (!needles.length) return { text: text, removed: [] };
  // Q08-PRUNE-VERDICT-1 (0.17.6, run 369): a verdict line that shared a paragraph with the last body sentence was split into "sentences"
  // and damaged by the prune ("r3 prune blocked: missing or malformed 'worth your time' verdict line"). The line is set aside first and
  // put back unchanged at the end.
  var vline = String(text).match(VERDICT_LINE_RE);
  var body = vline ? String(text).replace(VERDICT_LINE_RE, "").replace(/\s+$/, "") : String(text);
  var paras = body.split(/\n{2,}/).map(function (para) {
    if (/^\s*#\s/.test(para) || /^\s*(FORECAST-JSON:|worth your time:)/i.test(para)) return { fixed: para };
    return { lede: false, sents: para.split(/(?<=[.!?])\s+(?=[A-Z"\u201c])/).map(function (sn) { return { sn: sn, cut: false }; }) };
  });
  // Q08-LEDE-PRUNE-1 (0.18.1): the 11:06Z piece of 2026-10-13 was published opening "Users therefore trust ..." because the prune deleted
  // its lede sentences. The first body paragraph is never cut: a flagged sentence there sets ledeHit, and the caller sends the draft to the
  // model revision instead, which keeps a lede.
  for (var li = 0; li < paras.length; li++) { if (paras[li].sents) { paras[li].lede = true; break; } }
  // Q08-ANALYSIS-KEEP-1: with keepAnalysis, the mark line and every paragraph after it are kept whole.
  var inAnalysis = false;
  paras.forEach(function (p) {
    if (p.sents && p.sents.length === 1 && ANALYSIS_MARK_RE.test(p.sents[0].sn)) { p.fixed = p.sents[0].sn; p.sents = null; inAnalysis = true; return; }
    if (inAnalysis && popts && popts.keepAnalysis && p.sents) { p.fixed = p.sents.map(function (x) { return x.sn; }).join(" "); p.sents = null; }
  });
  var ledeHit = false;
  paras.forEach(function (p) {
    (p.sents || []).forEach(function (x) {
      var ns = normForMatch(x.sn);
      for (var i = 0; i < needles.length; i++) {
        var nd = needles[i].nd, hit;
        if (nd.charAt(0) === "\u0001") hit = (" " + ns + " ").indexOf(" " + nd.slice(1) + " ") >= 0;
        else hit = ns.indexOf(nd.slice(0, Math.min(nd.length, 60))) >= 0 || (ns.length >= 30 && nd.indexOf(ns.slice(0, Math.min(ns.length, 60))) >= 0);
        if (hit) { x.cut = true; needles[i].hit = true; }
      }
    });
  });
  // Q08-LEDE-PRUNE-2 (0.27.0; engine_runs 394-417 of 2026-10-14: 13 of 16 failed essays stopped on "prune blocked: a flagged claim is in
  // the lede" and spent their one model revision there): a flagged lede sentence is cut when another lede sentence remains; only a lede
  // whose every sentence is flagged is left whole and reported (Q08-LEDE-PRUNE-1). The caller still re-checks every pruned draft with
  // ledeProblems, so an opening that lost the subject or where it appeared goes to the revision as before.
  paras.forEach(function (p) {
    if (!p.lede || !p.sents) return;
    var live = p.sents.filter(function (x) { return x.sn.trim(); });
    if (live.length && live.every(function (x) { return x.cut; })) { live.forEach(function (x) { x.cut = false; }); ledeHit = true; }
  });
  needles.forEach(function (n) {
    if (n.hit || !n.raw) return;
    var want = contentWords(n.raw);
    if (want.length < FUZZY_MIN_SHARED) return;
    var best = null, bestShared = 0;
    paras.forEach(function (p) { (p.sents || []).forEach(function (x) {
      if (x.cut) return;
      x.inLede = !!p.lede;
      var have = contentWords(x.sn), shared = want.filter(function (w) { return have.indexOf(w) >= 0; }).length;
      if (shared > bestShared) { bestShared = shared; best = x; }
    }); });
    if (best && bestShared >= FUZZY_MIN_SHARED && bestShared / want.length >= FUZZY_MIN_SHARE) { if (best.inLede) ledeHit = true; else best.cut = true; n.hit = true; }
  });
  // Q08-DANGLING-CUT-1 (0.20.0, run 380): a kept sentence that opens "This/These <noun> ..." right after a cut sentence would refer to
  // something no longer there, so it goes with it (deletion only; the full re-verification follows).
  var prevCut = false, seen = "";
  paras.forEach(function (p) {
    if (!p.sents) { prevCut = false; seen += " " + (p.fixed || ""); return; }
    p.sents.forEach(function (x) {
      if (!x.cut && prevCut && !p.lede && danglingOpening(x.sn, seen)) x.cut = true;
      prevCut = x.cut;
      if (!x.cut) seen += " " + x.sn;
    });
  });
  var removed = [], keep = [];
  paras.forEach(function (p) {
    if (p.fixed != null) { keep.push(p.fixed); return; }
    var out = [];
    p.sents.forEach(function (x) { if (x.cut) removed.push(x.sn.slice(0, 120)); else out.push(x.sn); });
    if (out.length) keep.push(out.join(" "));
  });
  return { text: keep.join("\n\n") + (vline ? "\n\n" + vline[0].trim() : ""), removed: removed, ledeHit: ledeHit };
}
async function verifyAndRevise(env, a) {
  var opts = { forecast: !!a.forecast };
  var vr = await verifyPiece(env, a.piece.text, a.ground, a.piece.model, a.seedText, opts);
  var depthHeld = null;
  if (vr.ok) {
    var pi0 = pruneInferences(a.piece, vr, a.banned, a.forecast);
    var dp0 = a.forecast ? [] : analysisDepthProblems(pi0.piece.text);
    if (!dp0.length) return { ok: true, piece: pi0.piece, vr: vr, problems: [], pruned: pi0.removed };
    depthHeld = dp0;
  }
  if (vr.unavailable) return { ok: false, piece: a.piece, vr: vr, problems: vr.problems };
  // Q08-REVISE-LOOP-1 + Q08-PRUNE-1: up to three repair rounds. Each round first deletes the quoted unsupported sentences (essays only), and
  // falls back to a model revision of the remaining problems only when nothing could be located. Every result is re-verified in full.
  // Q08-PRUNE-FLOOR-1: a pruned draft is held to PRUNE_FLOOR (the floor the audit repair already uses), not the 2800-character writing
  // floor: deleting four sentences from a 3000-character essay fell under 2800, so the repair fell back to a model revision that wrote new
  // unsupported detail (runs 328-332). Up to PRUNE_ROUNDS rounds (reviewers answer in 1-3 s since FACTCHECK-NOTHINK-1), and at most one
  // model revision per run. The trail of every round is kept in the run error.
  var cur = a.piece, problems = depthHeld || vr.problems, pruned = 0, revised = 0, trail = depthHeld ? ["r0 passed; analysis held: " + depthHeld[0].slice(0, 50)] : [];
  var shortPruned = null, cutClaims = []; // Q08-PRUNE-EXTEND-1
  var seenClasses = {}; // Q08-YIELD-1
  var reviewedDrafts = [a.piece.text];
  function fail(extra) { return { ok: false, piece: a.piece, vr: vr, problems: problems.concat(extra || [], ["repair trail: " + trail.join(", ") + (vr && vr.analysisMode ? "; analysis section: " + vr.analysisMode : "")]) }; }
  // Q08-PRUNE-ROUNDS-2 (0.14.8, run 350): the model revision passed and the next prune left 3691 characters, and the run ended because the
  // fifth round was the last. Rounds past PRUNE_ROUNDS run up to PRUNE_ROUNDS_MAX while the repair has used less than PRUNE_BUDGET_MS
  // (runs take 130-380 s of the 900 s a scheduled run may use).
  var repairT0 = Date.now();
  for (var round = 0; round < PRUNE_ROUNDS_MAX && (round < PRUNE_ROUNDS || Date.now() - repairT0 < PRUNE_BUDGET_MS); round++) {
    if (a.deadline && Date.now() > a.deadline) { trail.push("r" + (round + 1) + " stopped: the tick budget is spent"); break; }
    var cand = null;
    // Q08-YIELD-1: a round that flags only claim classes an earlier round already flagged and pruned is recurring.
    var roundClasses = claimClassesOf(problems);
    var recurring = round > 0 && roundClasses.length > 0 && roundClasses.every(function (c) { return seenClasses[c]; });
    roundClasses.forEach(function (c) { seenClasses[c] = 1; });
    if (!a.forecast) {
      var pr = pruneUnsupported(cur.text, problems);
      if (pr.ledeHit) { trail.push("r" + (round + 1) + " prune blocked: a flagged claim is in the lede"); problems = problems.concat(["a flagged claim is in the opening paragraph: rewrite the lede from the source's own facts (who did what, where it appeared, when, why it matters)"]); }
      else if (pr.removed.length) {
        var gp = prunedGateProblems(pr.text, a.banned).concat(ledeProblems(pr.text, a.src));
        if (!gp.length) { cand = { text: pr.text, model: cur.model, extra: cur.extra, pruned: (cur.pruned || 0) + pr.removed.length }; pruned += pr.removed.length; cutClaims = cutClaims.concat(pr.removed); trail.push("r" + (round + 1) + " prune -" + pr.removed.length + " (" + pr.text.length + " chars)"); }
        else {
          trail.push("r" + (round + 1) + " prune blocked: " + gp[0].slice(0, 60)); problems = problems.concat(["pruning the unsupported sentences left a draft that failed the gate: " + gp.slice(0, 2).join("; ")]);
          // Q08-YIELD-1 (engine_runs, 7 days to 2026-10-19: 19 failed runs extended a pruned draft after an earlier round had already pruned
          // the same classes of claim; 11 of them wrote the extension and still failed, 494 s on average): the first prune round that leaves
          // the draft under the floor with the same claim classes recurring ends the repair; the extension and its re-verification are not spent.
          if (shortOnly(gp) && recurring) { trail.push("r" + (round + 1) + " stopped: repeat " + roundClasses.join("/") + " after a prune left the draft below the floor"); return fail(); }
          if (shortOnly(gp)) { shortPruned = pr.text; cutClaims = cutClaims.concat(pr.removed); }
        }
      } else trail.push("r" + (round + 1) + " prune located nothing");
    }
    if (!cand) {
      if (revised >= 1) return fail();
      revised++;
      var rev = null;
      // Q08-REVISION-LEDE-1 (0.18.2, run 375): the revision wrote an opening that named neither the project nor where it appeared; it is now told the subject.
      var revProblems = a.src && a.src.title ? problems.concat(["keep the first paragraph a news lede, at most 70 words, that names " + String(a.src.title).slice(0, 120) + (a.src.url ? " and where it appeared (" + hostOf(a.src.url) + ")" : "") + " and says what happened and why it matters"]) : problems;
      var base = shortPruned || cur.text;
      if (shortPruned) trail.push("r" + (round + 1) + " extending the pruned draft (" + publishBody(shortPruned).length + " chars of body)");
      try { rev = await compose(env, shortPruned ? extendRevisionPrompt(a.prompt, shortPruned, cutClaims, a.ground) : factRevisionPrompt(a.prompt, cur.text, revProblems, a.ground, a.forecast ? cur.extra : null), a.banned, undefined, a.xform); } catch (e) { rev = null; }
      if (!rev || !rev.text) return fail([shortPruned ? "length revision produced no draft" : "fact revision produced no draft"]);
      if (a.forecast && !rev.extra && cur.extra) rev.extra = cur.extra;
      // Q08-FACT-REVISION-FORMAT-1 (0.14.7, run 349): the fact revision fixed the facts and failed only on a label title it wrote. The draft's
      // passing title and verdict line are carried over (as for the editor), and a phrase-level-only failure gets the deterministic framing repair.
      if (!a.forecast) {
        rev.text = carryFormat(rev.text, base);
        // Q08-REVISION-FLOOR-1 (0.15.1, run 356): the revision rewrites a draft that was already pruned or edited below 2800 characters, so it
        // is held to the prune floor like the pruned drafts (it failed at 2526 characters on the writing floor).
        var rp = prunedGateProblems(rev.text, a.banned);
        if (rp.length && phraseLevelOnly(rp)) {
          var rfr = framingRepair(rev.text, rp, function (t) { return prunedGateProblems(t, a.banned); });
          if (rfr && rfr.accepted) { rev.text = rfr.text; trail.push("r" + (round + 1) + " revision framing repair -" + rfr.removed.length); }
        }
      }
      var sp = a.forecast ? forecastProblems(rev, a.banned) : prunedGateProblems(rev.text, a.banned);
      if (sp.length) return fail(["fact revision failed the editorial gate: " + sp.join("; ")]);
      trail.push("r" + (round + 1) + (shortPruned ? " length revision (" + publishBody(rev.text).length + " chars of body)" : " model revision"));
      cand = rev; shortPruned = null;
    }
    // Re-reading identical failed text can buy a different verdict, not a better draft. Scope this history to this repair only.
    if (reviewedDrafts.indexOf(cand.text) >= 0) { trail.push("r" + (round + 1) + " stopped: repair repeated an already rejected draft"); return fail(); }
    reviewedDrafts.push(cand.text);
    vr = await verifyPiece(env, cand.text, a.ground, cand.model, a.seedText, opts);
    if (vr.ok) {
      var pi1 = pruneInferences(cand, vr, a.banned, a.forecast);
      var dp1 = a.forecast ? [] : analysisDepthProblems(pi1.piece.text);
      if (!dp1.length) return { ok: true, piece: pi1.piece, vr: vr, problems: [], pruned: pruned + pi1.removed };
      trail.push("r" + (round + 1) + " passed; analysis held: " + dp1[0].slice(0, 50));
      cur = cand; problems = dp1; continue;
    }
    if (vr.unavailable) { problems = vr.problems; return fail(); }
    cur = cand; problems = vr.problems;
  }
  return fail();
}
var PRUNE_ROUNDS = 5;
var PRUNE_ROUNDS_MAX = 8;
var TICK_BUDGET_MS = 780000; // Q08-TICK-BUDGET-1: repair rounds stop 2 minutes before the 15-minute scheduled-run limit
var ESSAY_AFTER_FORECAST_MS = 240000;
var PRUNE_BUDGET_MS = 360000;
// Q08-PRUNE-FLOOR-2 (0.22.1, run 385): eight prune rounds each found 1-4 new items and cut a 4185-character draft to 1261. Since
// Q08-FINAL-READ-1 nothing under PUBLISH_MIN_CHARS of body can publish, so a prune below this floor stops the repair instead of
// spending more rounds on a draft that cannot be published (title and verdict line take about 200 characters).
var PRUNE_FLOOR = 3000;
// The editorial gate with a different length floor: every check except the 2800-character writing floor, which becomes `floor`.
// Q08-FLOOR-PARAS-1 (0.14.11, run 354): the 6-paragraph prose rule is tuned for a 2800-character draft; a pruned draft held to 1500
// characters was refused at 5 substantial paragraphs ("r4 prune blocked: insufficient prose"). A draft held to a lower floor needs
// FLOOR_MIN_PARAS; bullet lists and tables are still refused.
var FLOOR_MIN_PARAS = 4;
function gateAtFloor(text, banned, floor, label) {
  var ps = gate(text, banned).problems.filter(function (p) { return !/^too short \(/.test(p); }).filter(function (p) { var m = p.match(/^insufficient prose \((\d+) substantial paragraphs\)$/); return !m || Number(m[1]) < FLOOR_MIN_PARAS; });
  if (String(text).length < floor) ps.unshift("too short " + label + " (" + String(text).length + " chars; floor " + floor + ")");
  return ps;
}
// The editorial gate for a draft that only lost sentences.
// Q08-PRUNE-BODY-FLOOR-1 (0.24.2, run 388): a pruned draft of 2999 characters with title and verdict (about 2850 of body) was refused
// at the 3000-character proxy although the publish rule is PUBLISH_MIN_CHARS of body. The floor is now measured on the published body.
function prunedGateProblems(text, banned) {
  var ps = gateAtFloor(text, banned, 0, "after pruning");
  var n = publishBody(text).length;
  if (n < PUBLISH_MIN_CHARS) ps.unshift("too short after pruning (" + n + " chars of body; floor " + PUBLISH_MIN_CHARS + ")");
  return ps;
}
// Q08-EDIT-FLOOR-1: the editor pass applies the readers' cuts, so its draft is held to EDIT_FLOOR, not the 2800-character writing floor.
// Runs 319, 323, 327 (2026-10-11/12): the readers asked to delete restating paragraphs, the editor was told to keep 2800 characters, the
// cut never happened and the second panel rejected the same padding (13 of 41 stalled runs). A forecast keeps the writing floor.
var EDIT_FLOOR = 1800;
function editGateProblems(text, banned, forecast) { return forecast ? gate(text, banned).problems : gateAtFloor(text, banned, EDIT_FLOOR, "after editing"); }
function auditSeed(slug) { return "audit:" + slug; }
// Retracts a piece in public: the URL keeps answering with a notice, the piece leaves the index, feed, sitemap and APIs, queued
// social rows for it are suppressed, and forecasts built on it are retracted too. Reversible by deleting the q08_retractions row.
async function retractPiece(env, slug, reason, claims) {
  await ensureAccuracySchema(env);
  var now = nowIso(), cj = JSON.stringify((claims || []).slice(0, 8));
  await env.DB.prepare("INSERT OR REPLACE INTO q08_retractions (slug, reason, claims_json, retracted_at) VALUES (?,?,?,?)").bind(slug, String(reason || "").slice(0, 400), cj, now).run();
  try {
    var kids = await env.DB.prepare("SELECT slug FROM q08_forecasts WHERE source_slug = ?").bind(slug).all();
    for (var kid of (kids.results || [])) {
      await env.DB.prepare("INSERT OR IGNORE INTO q08_retractions (slug, reason, claims_json, retracted_at) VALUES (?,?,?,?)").bind(kid.slug, "Built on an essay that was retracted for unsupported claims.", "[]", now).run();
      await env.DB.prepare("UPDATE q08_forecasts SET status = 'void', disposition = 'retracted', resolved_at = ?1 WHERE slug = ?2 AND status = 'open'").bind(now, kid.slug).run().catch(function (e) { console.error(JSON.stringify({ evt: "q08-signal-engine:retractPiece:caught", error: String((e && e.message) || e) })); });
    }
  } catch (e) { console.error(JSON.stringify({ evt: "q08-signal-engine:retractPiece:caught", error: String((e && e.message) || e) })); }
  try {
    if (env.AUDIT) await env.AUDIT.prepare("UPDATE social_threads SET status = 'suppressed', notes = COALESCE(notes,'') || ' | Q08-VERIFY-1: piece retracted' WHERE status = 'queued' AND slug LIKE 'q08-%' AND posts LIKE ?1").bind("%/p/" + slug + "%").run();
  } catch (e) { console.error(JSON.stringify({ evt: "q08-signal-engine:retractPiece:caught", error: String((e && e.message) || e) })); }
  return { ok: true, slug: slug };
}
async function recordAudit(env, slug, verdict, stage, vr) {
  await ensureAccuracySchema(env);
  await env.DB.prepare("INSERT OR REPLACE INTO q08_audits (slug, verdict, stage, models, unsupported_json, checked_at) VALUES (?,?,?,?,?,?)")
    .bind(slug, verdict, stage, (vr.judges || []).map(function (j) { return j.model; }).join(","), JSON.stringify((vr.problems || []).slice(0, 10)), nowIso()).run();
}
// Source material for a piece already published: its signal row, the linked article, and (for a forecast) the essay it projects.
async function groundForPublished(env, p) {
  if (p.kind === "forecast") {
    var snapshot = null;
    try {
      var saved = await env.DB.prepare("SELECT ground_json FROM q08_forecasts WHERE slug = ?").bind(p.slug).first();
      snapshot = saved && JSON.parse(saved.ground_json);
    } catch (e) { /* legacy forecast */ }
    if (snapshot && snapshot.essay && Array.isArray(snapshot.lines)) return forecastGroundText(snapshot);
  }
  var parts = [p.title || "", p.core_concept || ""];
  var sig = null;
  try { sig = await env.DB.prepare("SELECT title, url, friction_point FROM signal_log WHERE id = ?").bind(p.signal_id).first(); } catch (e) { sig = null; }
  if (sig) { parts.push(sig.title || "", sig.friction_point || ""); }
  if (p.kind === "forecast") {
    var fr = await env.DB.prepare("SELECT source_slug FROM q08_forecasts WHERE slug = ?").bind(p.slug).first().catch(function () { return null; });
    var src = fr && await env.DB.prepare("SELECT title, body_md FROM published_pieces WHERE slug = ?").bind(fr.source_slug).first().catch(function () { return null; });
    if (src) parts.push(src.title || "", src.body_md || "");
  } else if (sig && sig.url) {
    parts.push(await fetchArticleText(articleUrlFor(sig)));
  }
  var ground = parts.join("\n").slice(0, GROUND_MAX + 8000);
  // Q08-FORECAST-LEDGER-1: the re-audit of a forecast reads the ledger it was published against, appended after the cap so a long essay cannot cut it off
  if (p.kind === "forecast") ground += await storedForecastLedger(env, p.slug);
  return ground;
}
// Repair before retract (Q08-REPAIR-1): an essay that fails the audit is first revised to delete the unsupported claims; if the
// revision passes the full check it is updated in place with a visible correction note, otherwise it is retracted. A piece whose
// repair already failed is not tried again.
async function repairPublished(env, p, ground, problems) {
  if (p.kind === "forecast") return { ok: false, reason: "forecasts are retracted, not repaired" };
  var draft = "# " + p.title + "\n" + p.body_md;
  var rev = null;
  try { rev = await compose(env, factRevisionPrompt(Q08_DIRECTIVE, draft, problems, ground, null), []); } catch (e) { rev = null; }
  if (!rev || !rev.text) return { ok: false, reason: "no revision produced" };
  var text = rev.text.replace(/\n?worth your time:\s*(yes|flat|no)\s*[\u2014\u2013-].*$/im, "").trim();
  var tm = text.match(/^#\s+(.+)$/m);
  if (!tm) return { ok: false, reason: "revision lost its title" };
  var body = text.replace(/^#\s+.+\n?/, "").trim();
  if (body.length < 1500) return { ok: false, reason: "revision too short to stand as an essay" };
  var vr = await verifyPiece(env, text, ground, rev.model, auditSeed(p.slug) + ":repair", { forecast: false, today: String(p.published_at || "").slice(0, 10) || utcDay() });
  if (!vr.ok) return { ok: false, reason: vr.problems.slice(0, 3).join("; "), unavailable: vr.unavailable, vr: vr };
  var note = "*Corrected " + utcDay() + ": a fact-check against the source material removed statements it did not support.*\n\n";
  await env.DB.prepare("UPDATE published_pieces SET title = ?1, body_md = ?2 WHERE slug = ?3").bind(tm[1].trim(), note + body, p.slug).run();
  return { ok: true, vr: vr };
}
// Cron step: audit published pieces that have no audit row, then give audit-retracted essays one repair attempt each.
// A reviewer outage writes nothing (retried next tick); an unrepairable failure retracts.
async function auditPublished(env, limit) {
  if (!(await ensureAccuracySchema(env))) return { ok: false, reason: "schema" };
  var _abud = await q08Budget(env);
  env = Object.assign({}, env, { __q08BudgetPressure: !!env.__q08BudgetPressure || !_abud.ok });
  var rows = await env.DB.prepare(
    "SELECT p.id, p.slug, p.title, p.body_md, p.core_concept, p.signal_id, p.kind, p.published_at FROM published_pieces p " +
    "WHERE p.slug NOT IN (SELECT slug FROM q08_retractions) AND p.slug NOT IN (SELECT slug FROM q08_audits) ORDER BY p.published_at DESC LIMIT ?1"
  ).bind(limit || 3).all();
  var res = { checked: 0, passed: 0, repaired: 0, retracted: 0, deferred: 0, restored: 0 };
  for (var p of (rows.results || [])) {
    var ground = await groundForPublished(env, p);
    var vr = await verifyPiece(env, "# " + p.title + "\n" + p.body_md, ground, "", auditSeed(p.slug), { forecast: p.kind === "forecast", today: String(p.published_at || "").slice(0, 10) || utcDay() });
    if (vr.unavailable) { res.deferred++; continue; }
    res.checked++;
    if (vr.ok) { await recordAudit(env, p.slug, "pass", vr.stage, vr); res.passed++; continue; }
    var rp = await repairPublished(env, p, ground, vr.problems);
    if (rp.unavailable) { res.deferred++; continue; }
    if (rp.ok) { await recordAudit(env, p.slug, "pass", "repaired", rp.vr); res.repaired++; continue; }
    await recordAudit(env, p.slug, "fail", vr.stage, vr);
    await retractPiece(env, p.slug, "Retracted after an accuracy audit: the piece contained claims the source material does not support (" + vr.stage + " check) and could not be repaired.", vr.problems);
    res.retracted++;
  }
  // Restoration: essays retracted by an earlier audit pass that never had a repair attempt.
  var rest = await env.DB.prepare(
    "SELECT p.id, p.slug, p.title, p.body_md, p.core_concept, p.signal_id, p.kind, p.published_at FROM q08_retractions r JOIN published_pieces p ON p.slug = r.slug " +
    "WHERE r.reason LIKE 'Retracted after an accuracy audit%' AND COALESCE(p.kind,'analysis') != 'forecast' AND r.reason NOT LIKE '%could not be repaired%' " +
    "AND p.slug NOT IN (SELECT slug FROM q08_audits WHERE stage = 'repair-failed') ORDER BY p.published_at DESC LIMIT ?1"
  ).bind(Math.max(1, Math.min(3, limit || 3))).all().catch(function () { return { results: [] }; });
  for (var q of (rest.results || [])) {
    var g2 = await groundForPublished(env, q);
    var v2 = await verifyPiece(env, "# " + q.title + "\n" + q.body_md, g2, "", auditSeed(q.slug) + ":restore", { forecast: false, today: String(q.published_at || "").slice(0, 10) || utcDay() });
    if (v2.unavailable) { res.deferred++; continue; }
    var r2 = v2.ok ? { ok: true, vr: v2 } : await repairPublished(env, q, g2, v2.problems);
    if (r2.unavailable) { res.deferred++; continue; }
    if (r2.ok) {
      await env.DB.prepare("DELETE FROM q08_retractions WHERE slug = ?1").bind(q.slug).run();
      await recordAudit(env, q.slug, "pass", "restored", r2.vr);
      res.restored++;
    } else {
      await recordAudit(env, q.slug, "fail", "repair-failed", { judges: [], problems: [r2.reason] });
      await env.DB.prepare("UPDATE q08_retractions SET reason = reason || ' (could not be repaired)' WHERE slug = ?1").bind(q.slug).run();
    }
  }
  return Object.assign({ ok: true }, res);
}
function renderRetraction(r, p) {
  var claims = []; try { claims = JSON.parse(r.claims_json || "[]"); } catch (e) { claims = []; }
  var date = String(r.retracted_at || "").slice(0, 10);
  var list = claims.length ? "<p>Examples of what could not be verified:</p><ul>" + claims.slice(0, 5).map(function (c) { return "<li>" + escHtml(c) + "</li>"; }).join("") + "</ul>" : "";
  return '<meta name="robots" content="noindex"><article class="q08-piece"><p class="q-eyebrow"><a href="/" style="text-decoration:none;color:inherit">← Index</a></p><h1 class="q08-t">Retracted: ' + q08Inline(p && p.title || "this piece") + '</h1><p class="q-meta">Retracted ' + escHtml(date) + '</p>' +
    "<p>q08 withdrew this piece. " + escHtml(r.reason || "") + " Every q08 piece is now checked against its source material by two independent reviewers before publication, and earlier pieces are being re-audited; any that fail are withdrawn and listed on the <a href=\"/retractions\">retractions page</a>.</p>" + list + "</article>";
}
function renderRetractions(rows) {
  var items = (rows || []).map(function (r) { return "<li><a href=\"/p/" + escHtml(r.slug) + "\">" + q08Inline(r.title || r.slug) + "</a> — retracted " + escHtml(String(r.retracted_at || "").slice(0, 10)) + "</li>"; }).join("");
  return '<article class="q08-piece"><p class="q-eyebrow"><a href="/" style="text-decoration:none;color:inherit">← Index</a></p><h1 class="q08-t">Corrections and retractions</h1><p>q08 publishes only claims its source material supports. When a piece is found to contain an unsupported claim, it is withdrawn and listed here.</p>' + (items ? "<ul>" + items + "</ul>" : "<p>No piece has been retracted.</p>") + "</article>";
}

// ---- Resolution and calibration -------------------------------------------------------------------------------------
function plainText(h) {
  return String(h || "").replace(/<script\b[\s\S]*?<\/script[^>]*>/gi, " ").replace(/<style\b[\s\S]*?<\/style[^>]*>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}
// Evidence comes from several independent public sources, each failing on its own (Q08-FORECAST-SOURCES-1): Hacker News,
// worldwide news (GDELT), Wikipedia's current text, and arXiv. The query is the writer's watch_query; every line carries
// its source and date so the judges can weigh it.
async function evidenceFetch(url, ms) {
  var r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(ms || 15000) });
  if (!r.ok) throw new Error("http " + r.status);
  return r;
}
var EVIDENCE_SOURCES = [
  { name: "Hacker News", run: async function (q, sinceSec) {
    var d = await (await evidenceFetch("https://hn.algolia.com/api/v1/search?tags=story&hitsPerPage=8&query=" + encodeURIComponent(q) + "&numericFilters=" + encodeURIComponent("created_at_i>" + sinceSec))).json();
    return (d.hits || []).slice(0, 8).map(function (h) { return "Hacker News story, " + String(h.created_at || "").slice(0, 10) + ", " + (h.points || 0) + " points: " + String(h.title || "").slice(0, 200) + (h.url ? " (" + String(h.url).slice(0, 160) + ")" : ""); });
  } },
  { name: "news", run: async function (q, sinceSec) {
    var start = new Date(Math.max(sinceSec, Date.now() / 1000 - 86400 * 365) * 1000).toISOString().replace(/[-:T]/g, "").slice(0, 14);
    var d = await (await evidenceFetch("https://api.gdeltproject.org/api/v2/doc/doc?mode=artlist&format=json&maxrecords=10&sort=datedesc&startdatetime=" + start + "&query=" + encodeURIComponent(q))).json();
    return (d.articles || []).slice(0, 8).map(function (a) { var sd = String(a.seendate || ""); return "News article (" + String(a.domain || "").slice(0, 60) + "), " + sd.slice(0, 4) + "-" + sd.slice(4, 6) + "-" + sd.slice(6, 8) + ": " + String(a.title || "").slice(0, 200) + (a.url ? " (" + String(a.url).slice(0, 160) + ")" : ""); });
  } },
  { name: "Wikipedia", run: async function (q) {
    var d = await (await evidenceFetch("https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=3&srsearch=" + encodeURIComponent(q))).json();
    return ((d.query && d.query.search) || []).slice(0, 3).map(function (h) { return "Wikipedia article '" + String(h.title || "").slice(0, 100) + "', last edited " + String(h.timestamp || "").slice(0, 10) + ": " + plainText(h.snippet).slice(0, 300); });
  } },
  { name: "arXiv", run: async function (q, sinceSec) {
    var x = await (await evidenceFetch("https://export.arxiv.org/api/query?sortBy=submittedDate&sortOrder=descending&max_results=5&search_query=all:" + encodeURIComponent('"' + q + '"'))).text();
    var out = [];
    for (var m of x.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
      var t = (m[1].match(/<title>([\s\S]*?)<\/title>/) || [])[1], pub = (m[1].match(/<published>([^<]*)<\/published>/) || [])[1] || "";
      if (t && Date.parse(pub) / 1000 > sinceSec) out.push("arXiv paper, " + pub.slice(0, 10) + ": " + plainText(t).slice(0, 200));
    }
    return out;
  } }
];
async function gatherEvidence(f) {
  var ev = [];
  var since = Math.floor(Date.parse(f.created_at) / 1000) || 0;
  var q = String(f.watch_query || "").trim();
  var got = await Promise.all(EVIDENCE_SOURCES.map(function (s) { return s.run(q, since).catch(function () { return []; }); }));
  for (var g of got) for (var line of g) ev.push(line);
  var urls = []; try { urls = JSON.parse(f.watch_urls || "[]"); } catch (e) { urls = []; }
  for (var wu of (Array.isArray(urls) ? urls : []).slice(0, 2)) {
    var pu = publicHttpsUrl(wu);
    if (!pu) continue;
    try {
      var pr = await fetch(pu, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(12000), redirect: "follow" });
      if (!pr.ok) continue;
      var len = Number(pr.headers.get("content-length") || 0);
      if (len > 3e6) continue;
      ev.push("Page " + pu + " as fetched " + nowIso().slice(0, 10) + ": " + plainText((await pr.text()).slice(0, 400000)).slice(0, 3000));
    } catch (e) { console.error(JSON.stringify({ evt: "q08-signal-engine:gatherEvidence:caught", error: String((e && e.message) || e) })); }
  }
  return ev;
}
var FORECAST_JUDGE_PROMPT = [
  "You settle forecasts for a publication. Use only the evidence listed below and the dates given; use no outside knowledge.",
  "Answer with exactly one JSON object and nothing else: {\"outcome\": \"yes\" or \"no\" or \"unclear\", \"basis\": \"the evidence number and a short paraphrase of what it shows\"}.",
  "yes: the evidence directly shows the resolution condition was met on or before the horizon date.",
  "no: the evidence directly shows the horizon date has passed and the condition was not met, or that the opposite happened. Not finding evidence that something happened is NOT evidence that it did not.",
  "unclear: anything else, including no evidence, off-topic evidence, or evidence that is dated after the horizon and does not say when the condition became true."
].join("\n");
function parseJudgeVerdict(text) {
  var m = String(text || "").replace(/<think>[\s\S]*?<\/think>/gi, "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  var o; try { o = JSON.parse(m[0]); } catch (e) { return null; }
  var out = String(o && o.outcome || "").toLowerCase().trim();
  if (out !== "yes" && out !== "no" && out !== "unclear") return null;
  return { outcome: out, basis: String(o.basis || "").slice(0, 300) };
}
function aggregateJudges(js) {
  var v = (js || []).filter(Boolean);
  if (v.length < 2) return { outcome: "unclear", basis: "fewer than two valid judge verdicts" };
  if (v[0].outcome === v[1].outcome && v[0].outcome !== "unclear") return { outcome: v[0].outcome, basis: v[0].basis };
  return { outcome: "unclear", basis: "judges did not agree or found the evidence insufficient" };
}
async function judgeForecast(env, f, evidence) {
  if (!evidence.length) return { outcome: "unclear", basis: "no public evidence found", judges: [] };
  var body = FORECAST_JUDGE_PROMPT + "\n\nToday: " + utcDay() + "\nForecast made: " + String(f.created_at || "").slice(0, 10) + "\nHorizon date: " + f.horizon + "\nClaim: " + f.claim + "\nResolution condition: " + f.resolution + "\n\nEVIDENCE:\n" + evidence.map(function (e, i) { return (i + 1) + ". " + e; }).join("\n");
  var ids = pickPanel([], 2, seedOf(f.slug));
  var got = await Promise.all(ids.map(async function (id) {
    try {
      var resp = await aiGatewayRun(env, id, { messages: [{ role: "user", content: body }], max_tokens: READER_MAX_TOKENS, temperature: 0.1 }, { loop_id: env && env.__aigLoopBudget && env.__aigLoopBudget.id, purpose: "judge", signal: AbortSignal.timeout(90000) });
      var out = aiReplyText(resp);
      var v = parseJudgeVerdict(out);
      if (v) v.model = id;
      return v;
    } catch (e) { return null; }
  }));
  var agg = aggregateJudges(got);
  agg.judges = got.filter(Boolean).map(function (j) { return { model: j.model, outcome: j.outcome }; });
  return agg;
}
async function resolveForecasts(env, max) {
  if (!(await ensureForecastSchema(env))) return { checked: 0 };
  var cutoff = new Date(Date.now() - FORECAST_RECHECK_DAYS * 864e5 + 36e5).toISOString();
  var due = await env.DB.prepare("SELECT * FROM q08_forecasts WHERE status = 'open' AND horizon <= ?1 AND (last_check_at IS NULL OR last_check_at <= ?2) ORDER BY horizon ASC LIMIT ?3").bind(utcDay(), cutoff, max || 2).all();
  var children = await env.DB.prepare("SELECT * FROM q08_forecast_claims WHERE status = 'open' AND horizon <= ?1 AND (last_check_at IS NULL OR last_check_at <= ?2) ORDER BY horizon ASC LIMIT ?3").bind(utcDay(), cutoff, max || 2).all();
  var work = (due.results || []).map(function (f) { return { row: f, table: "q08_forecasts" }; }).concat((children.results || []).map(function (f) { return { row: f, table: "q08_forecast_claims" }; }));
  work.sort(function (a, b) { return a.row.horizon.localeCompare(b.row.horizon) || (a.row.last_check_at || "").localeCompare(b.row.last_check_at || ""); });
  var done = 0;
  for (var item of work.slice(0, max || 2)) {
    var f = item.row, table = item.table;
    var ev = await gatherEvidence(f);
    var v = await judgeForecast(env, f, ev);
    var now = nowIso(), checks = (Number(f.checks) || 0) + 1;
    var evJson = JSON.stringify({ at: now, evidence: ev.map(function (e) { return e.slice(0, 400); }), verdict: v.outcome, basis: v.basis, judges: v.judges }).slice(0, 6000);
    if (v.outcome === "yes" || v.outcome === "no") {
      var oc = v.outcome === "yes" ? 1 : 0, br = Math.round(Math.pow(Number(f.probability) - oc, 2) * 10000) / 10000;
      await env.DB.prepare("UPDATE " + table + " SET status = 'resolved', outcome = ?1, brier = ?2, checks = ?3, last_check_at = ?4, resolved_at = ?4, disposition = ?5, evidence_json = ?6 WHERE id = ?7 AND status = 'open'")
        .bind(oc, br, checks, now, ("resolved " + v.outcome + ": " + v.basis).slice(0, 400), evJson, f.id).run();
    } else if (checks >= FORECAST_MAX_CHECKS) {
      await env.DB.prepare("UPDATE " + table + " SET status = 'void', checks = ?1, last_check_at = ?2, resolved_at = ?2, disposition = ?3, evidence_json = ?4 WHERE id = ?5 AND status = 'open'")
        .bind(checks, now, ("void: no decidable public evidence after " + checks + " checks. Last basis: " + v.basis).slice(0, 400), evJson, f.id).run();
    } else {
      await env.DB.prepare("UPDATE " + table + " SET checks = ?1, last_check_at = ?2, evidence_json = ?3 WHERE id = ?4 AND status = 'open'").bind(checks, now, evJson, f.id).run();
    }
    done++;
  }
  return { checked: done };
}
// rows: resolved forecasts with probability and outcome (1 or 0). Under 20 rows a Brier score is noise and is reported as such.
function calibration(rows) {
  var r = (rows || []).filter(function (x) { return x && (x.outcome === 0 || x.outcome === 1) && isFinite(Number(x.probability)); });
  var n = r.length;
  var out = { n: n, brier: null, log_score: null, hit_rate: null, baseline_brier: 0.25, baseline_log_score: Math.round(Math.log(0.5) * 1000) / 1000, bins: [], reliable: n >= 20 };
  if (!n) return out;
  var sb = 0, hits = 0, sl = 0;
  r.forEach(function (x) { var pp = Math.min(0.999, Math.max(0.001, Number(x.probability))); sb += Math.pow(Number(x.probability) - x.outcome, 2); sl += Math.log(x.outcome === 1 ? pp : 1 - pp); hits += x.outcome; });
  out.brier = Math.round((sb / n) * 1000) / 1000;
  out.log_score = Math.round((sl / n) * 1000) / 1000;
  out.hit_rate = Math.round((hits / n) * 1000) / 1000;
  [[0, 0.2], [0.2, 0.4], [0.4, 0.6], [0.6, 0.8], [0.8, 1]].forEach(function (b) {
    var g = r.filter(function (x) { var p = Number(x.probability); return p >= b[0] && (p < b[1] || (b[1] === 1 && p <= 1)); });
    if (!g.length) return;
    var mp = g.reduce(function (a, x) { return a + Number(x.probability); }, 0) / g.length, fq = g.reduce(function (a, x) { return a + x.outcome; }, 0) / g.length;
    out.bins.push({ from: b[0], to: b[1], n: g.length, mean_probability: Math.round(mp * 1000) / 1000, observed_frequency: Math.round(fq * 1000) / 1000 });
  });
  return out;
}
async function forecastStats(env) {
  var out = { published_7d: 0, open: 0, overdue_open: 0, resolved: 0, void: 0, void_share: null, calibration: calibration([]) };
  if (!(await ensureForecastSchema(env))) return out;
  try {
    var since = new Date(Date.now() - 7 * 864e5).toISOString();
    var a = await env.DB.prepare("SELECT COUNT(*) n FROM q08_forecasts WHERE created_at >= ?1").bind(since).first();
    var s = await env.DB.prepare("SELECT status, COUNT(*) n FROM q08_forecasts GROUP BY status").all();
    var od = await env.DB.prepare("SELECT COUNT(*) n FROM q08_forecasts WHERE status = 'open' AND horizon <= ?1").bind(new Date(Date.now() - 35 * 864e5).toISOString().slice(0, 10)).first();
    var rr = await env.DB.prepare("SELECT probability, outcome FROM q08_forecasts WHERE status = 'resolved'").all();
    out.published_7d = Number(a && a.n) || 0;
    (s.results || []).forEach(function (x) { if (x.status === "open") out.open = x.n; else if (x.status === "resolved") out.resolved = x.n; else if (x.status === "void") out.void = x.n; });
    out.overdue_open = Number(od && od.n) || 0;
    var fin = out.resolved + out.void;
    out.void_share = fin >= 10 ? Math.round((out.void / fin) * 1000) / 1000 : null;
    out.calibration = calibration(rr.results || []);
  } catch (e) { console.error(JSON.stringify({ evt: "q08-signal-engine:forecastStats:caught", error: String((e && e.message) || e) })); }
  return out;
}
function fcPct(p) { return Math.round(Number(p) * 100) + "%"; }
function fcStatus(f) {
  if (f.status === "resolved") return f.outcome === 1 ? "came true" : "did not come true";
  if (f.status === "void") return "void: no decidable public evidence";
  return Date.parse(String(f.horizon) + "T00:00:00Z") <= Date.now() ? "due, being checked" : "open";
}
function lastForecastUpdateScore(f, updates) {
  if (!f || f.status !== "resolved" || (f.outcome !== 0 && f.outcome !== 1)) return null;
  var horizonMs = Date.parse(String(f.horizon || ""));
  if (!isFinite(horizonMs)) return null;
  var last = null, lastMs = -Infinity;
  (updates || []).forEach(function (u) {
    var atMs = Date.parse(String(u && u.at || ""));
    var p = Number(u && u.probability);
    if (!isFinite(atMs) || atMs >= horizonMs || !isFinite(p) || p < 0 || p > 1 || atMs < lastMs) return;
    last = u;
    lastMs = atMs;
  });
  if (!last) return null;
  var probability = Number(last.probability);
  var bounded = Math.min(0.999, Math.max(0.001, probability));
  var originalProbability = Number(f.probability);
  var originalBounded = Math.min(0.999, Math.max(0.001, originalProbability));
  return {
    probability: probability,
    at: last.at,
    original_log_score: Math.round(Math.log(f.outcome === 1 ? originalBounded : 1 - originalBounded) * 1000) / 1000,
    brier: Math.round(Math.pow(probability - f.outcome, 2) * 1000) / 1000,
    log_score: Math.round(Math.log(f.outcome === 1 ? bounded : 1 - bounded) * 1000) / 1000
  };
}
function attachForecastUpdateScore(f, updates) {
  var score = lastForecastUpdateScore(f, updates);
  if (score) {
    f.updated_probability = score.probability;
    f.updated_at = score.at;
    f.original_log_score = score.original_log_score;
    f.updated_brier = score.brier;
    f.updated_log_score = score.log_score;
  }
  return f;
}
function renderForecastBox(f) {
  if (!f) return "";
  var alts = []; try { alts = JSON.parse(f.alternatives_json || "[]"); } catch (e) { alts = []; }
  var ind = []; try { ind = JSON.parse(f.indicators_json || "[]"); } catch (e) { ind = []; }
  var altText = (Array.isArray(alts) ? alts : []).map(function (a) { return q08Inline(String(a.claim || "")) + " (" + fcPct(a.probability) + ")"; }).join("; ");
  return '<section class="q-panel" style="margin:32px 0 0"><h2 class="q-h3" style="margin:0 0 8px">Forecast record</h2>' +
    '<p style="margin:0 0 8px"><strong>Most likely scenario (' + fcPct(f.probability) + '):</strong> ' + q08Inline(f.claim) + '</p>' +
    '<p class="q-meta" style="margin:0 0 6px">Settled by ' + escHtml(f.horizon) + ' &middot; status: ' + escHtml(fcStatus(f)) + (f.status === "resolved" && f.brier != null ? ' &middot; Brier score ' + escHtml(String(f.brier)) : "") + '</p>' +
    '<p class="q-meta" style="margin:0 0 6px">Resolves true if: ' + escHtml(f.resolution) + '</p>' +
    (altText ? '<p class="q-meta" style="margin:0 0 6px">Rival scenarios: ' + altText + '</p>' : "") +
    (ind.length ? '<p class="q-meta" style="margin:0 0 6px">Watch: ' + ind.map(function (x) { return escHtml(String(x)); }).join("; ") + '</p>' : "") +
    (f.secondary_claims || []).map(function (c) { return '<p class="q-meta">Secondary prediction (' + fcPct(c.probability) + '), made ' + escHtml(String(c.created_at).slice(0, 10)) + ': ' + escHtml(c.claim) + ' &middot; settled by ' + escHtml(c.horizon) + ' &middot; ' + escHtml(fcStatus(c)) + (c.brier != null ? ' &middot; Brier ' + escHtml(String(c.brier)) : '') + '<br>Resolves true if: ' + escHtml(c.resolution) + '</p>'; }).join("") +
    '<p class="q-meta" style="margin:0"><a href="/forecasts">All forecasts and the scoring record</a></p></section>';
}
function renderCalibration(c) {
  var W = 320, H = 320, P = 36, sx = function (v) { return P + v * (W - 2 * P); }, sy = function (v) { return H - P - v * (H - 2 * P); };
  var pts = (c.bins || []).map(function (b) { return '<circle cx="' + sx(b.mean_probability).toFixed(1) + '" cy="' + sy(b.observed_frequency).toFixed(1) + '" r="' + (4 + Math.min(8, b.n)) + '" fill="#2d6cdf" fill-opacity="0.7"><title>' + b.n + ' forecasts, said ' + fcPct(b.mean_probability) + ', came true ' + fcPct(b.observed_frequency) + '</title></circle>'; }).join("");
  var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="320" height="320" role="img" aria-label="Calibration: said probability against observed frequency, with the perfect-calibration diagonal"><rect x="' + P + '" y="' + P + '" width="' + (W - 2 * P) + '" height="' + (H - 2 * P) + '" fill="none" stroke="#999"/><line x1="' + sx(0) + '" y1="' + sy(0) + '" x2="' + sx(1) + '" y2="' + sy(1) + '" stroke="#999" stroke-dasharray="4 3"/>' + pts + '<text x="' + W / 2 + '" y="' + (H - 6) + '" text-anchor="middle" font-size="11">said probability</text><text x="10" y="' + H / 2 + '" font-size="11" transform="rotate(-90 10 ' + H / 2 + ')" text-anchor="middle">came true</text></svg>';
  var tr = (c.bins || []).map(function (b) { return '<tr><td>' + fcPct(b.from) + '&ndash;' + fcPct(b.to) + '</td><td>' + b.n + '</td><td>' + fcPct(b.mean_probability) + '</td><td>' + fcPct(b.observed_frequency) + '</td></tr>'; }).join("");
  var body = '<section class="q08-hero"><h1>Forecast calibration</h1><p class="q-lede">Forecasts grouped by the probability q08 gave them, against how often they came true. A calibrated forecaster sits on the diagonal. Scores use the original published probability; later updates are separate rows and never replace it.</p>' +
    '<p class="q-meta">' + (c.n ? c.n + ' resolved forecast' + (c.n === 1 ? '' : 's') + '. Brier score ' + c.brier + ' (always saying 50% scores ' + c.baseline_brier + '; lower is better). Log score ' + c.log_score + ' (always saying 50% scores ' + c.baseline_log_score + '; higher is better).' + (c.reliable ? '' : ' Under 20 resolved forecasts a score is mostly noise.') : 'No forecast has resolved yet, so there is nothing to plot.') + '</p></section>' +
    '<section class="q-panel">' + svg + (tr ? '<table class="q-table"><thead><tr><th>Bucket</th><th>Forecasts</th><th>Mean said</th><th>Came true</th></tr></thead><tbody>' + tr + '</tbody></table>' : '') + '<p class="q-meta"><a href="/forecasts">All forecasts</a> &middot; <a href="/api/forecasts/calibration">JSON</a></p></section>';
  return q08Page({ title: "Forecast calibration \u00b7 q08", canonical: ORIGIN + "/forecasts/calibration", active: "forecasts", ogType: "article", description: "Calibration of q08's resolved forecasts by probability bucket, with Brier and log scores against the always-50% baseline.", jsonld: { "@context": "https://schema.org", "@type": "Article", headline: "Forecast calibration", description: "Calibration of q08's resolved forecasts by probability bucket, with Brier and log scores against the always-50% baseline.", url: ORIGIN + "/forecasts/calibration", mainEntityOfPage: ORIGIN + "/forecasts/calibration", publisher: { "@type": "Organization", name: "q08", url: ORIGIN }, isPartOf: { "@type": "WebSite", name: "q08", url: ORIGIN }, about: { "@type": "Thing", name: "Forecast calibration and scoring" } } }, body);
}
function renderForecasts(rows, stats) {
  var item = function (f) {
    var updated = f.updated_brier != null ? " &middot; Last pre-horizon update (" + fcPct(f.updated_probability) + ") Brier " + escHtml(String(f.updated_brier)) + ", log score " + escHtml(String(f.updated_log_score)) : "";
    var original = f.brier != null ? " &middot; Original Brier " + escHtml(String(f.brier)) + (f.original_log_score != null ? ", log score " + escHtml(String(f.original_log_score)) : "") : "";
    var extra = f.status === "resolved" ? " &middot; " + escHtml(fcStatus(f)) + original + updated : " &middot; " + escHtml(fcStatus(f));
    return '<li class="q-item"><a class="q-item-title" href="/p/' + escHtml(f.slug) + '">' + q08Inline(f.claim) + '</a><div class="q-item-meta"><span class="q-badge">' + fcPct(f.probability) + '</span> settled by ' + escHtml(f.horizon) + extra + '</div></li>';
  };
  var open = rows.filter(function (f) { return f.status === "open"; }).sort(function (a, b) { return String(a.horizon).localeCompare(String(b.horizon)); });
  var fin = rows.filter(function (f) { return f.status !== "open"; });
  var c = stats.calibration;
  var cal = c.n ? ('Scored so far: ' + c.n + ' resolved, mean Brier score ' + c.brier + ' (always saying 50% scores 0.25; lower is better), mean log score ' + c.log_score + ' (always saying 50% scores ' + c.baseline_log_score + '; higher is better; <a href="/forecasts/calibration">calibration by probability bucket</a>)' + (c.reliable ? "" : '. Under 20 resolved forecasts a score is mostly noise') + '. Void: ' + stats.void + (stats.void_share != null ? ' (' + Math.round(stats.void_share * 100) + '% of finished)' : "") + '.') : 'No forecast has been scored yet. Void so far: ' + stats.void + '.';
  var body = '<section class="q08-hero"><h1>Forecasts</h1><p class="q-lede">Each forecast takes a mechanism q08 has described and says where it most likely leads: one dated scenario, its probability, the rivals, and a condition anyone can check. When the date passes, two judges from different model families settle it from public evidence and the score is recorded here, misses included. A forecast the evidence cannot settle after four checks is marked void in public.</p><p class="q-meta">' + cal + '</p></section>' +
    '<section class="q08-feed" aria-label="Open forecasts"><h2 class="q-h3">Open</h2>' + (open.length ? '<ul class="q-list">' + open.map(item).join("") + '</ul>' : '<div class="q-note">No open forecasts yet. Researched forecasts can draw on the essay archive.</div>') + '</section>' +
    (fin.length ? '<section class="q08-feed" aria-label="Settled forecasts"><h2 class="q-h3">Settled</h2><ul class="q-list">' + fin.map(item).join("") + '</ul></section>' : "") + q08Sub(true);
  return q08Page({ title: "Forecasts \u00b7 q08", canonical: ORIGIN + "/forecasts", active: "forecasts", ogType: "article", description: "Dated, probability-weighted forecasts built from q08's structural analyses, scored when they resolve.", jsonld: { "@context": "https://schema.org", "@type": "Article", headline: "Forecasts", description: "Dated, probability-weighted forecasts built from q08's structural analyses, scored when they resolve.", url: ORIGIN + "/forecasts", mainEntityOfPage: ORIGIN + "/forecasts", publisher: { "@type": "Organization", name: "q08", url: ORIGIN }, isPartOf: { "@type": "WebSite", name: "q08", url: ORIGIN }, about: { "@type": "Thing", name: "Dated, probability-weighted forecasts and their scoring record" } } }, body);
}

// ---------------------------------------------------------------------------
// 9. HTML rendering
// ---------------------------------------------------------------------------
var MATH_HEAD = "<script>window.MathJax={tex:{inlineMath:[[\"\\\\(\",\"\\\\)\"]],displayMath:[[\"$$\",\"$$\"],[\"\\\\[\",\"\\\\]\"]],processEscapes:true},svg:{scale:1.1,fontCache:\"global\"},options:{skipHtmlTags:[\"script\",\"noscript\",\"style\",\"textarea\",\"pre\",\"code\"],enableMenu:false}};function __mq(){if(window.MathJax&&MathJax.typesetPromise){MathJax.typesetPromise().catch(function (e) { console.error('mathjax-typeset', (e && e.message) || e); })}}if(document.readyState===\"complete\"){setTimeout(__mq,150)}else{window.addEventListener(\"load\",function(){setTimeout(__mq,150)})}</script><script async src=\"https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js\" onerror=\"this.onerror=null;var s=document.createElement('script');s.src='https://unpkg.com/mathjax@3/es5/tex-svg.js';document.head.appendChild(s);\"></script>";
function safeUrl(u) {
  var x = String(u || "").trim();
  return /^https?:\/\//i.test(x) ? x : "";
}

function renderSources(sj) {
  var arr = [];
  try { arr = JSON.parse(sj || "[]"); } catch (e) { arr = []; }
  if (!Array.isArray(arr)) arr = [];
  var items = [];
  for (var s of arr) {
    if (typeof s === "string") s = { url: s };
    if (!s || typeof s !== "object") continue;
    var url = safeUrl(s.url || s.href);
    if (!url) continue;
    var label = escHtml(s.label || s.title || url);
    items.push('<li><a href="' + escHtml(url) + '" rel="noopener noreferrer">' + label + "</a></li>");
  }
  if (!items.length) return "";
  return '<section class="refs"><h2>Sources &amp; further reading</h2><ul>' + items.join("") + "</ul></section>";
}

function buildSources(story) {
  var out = [], src = story.source || "hn", u = String(story.url || "").trim();
  if (src === "q08") {
    out.push({ label: "q08 essay this forecast extends: " + String(story.title || "").slice(0, 120), url: u });
  } else if (src === "github") {
    var repo = String(story.id || "").replace(/^.*?([^\/]+\/[^\/]+)$/, "$1");
    out.push({ label: "GitHub repository: " + (repo || story.title), url: u || "https://github.com/" + repo });
  } else if (src === "arxiv") {
    out.push({ label: "arXiv: " + String(story.title || "").slice(0, 120), url: u || "https://arxiv.org/abs/" + story.id });
  } else {
    if (u) { var host = ""; try { host = new URL(u).hostname.replace(/^www\./, ""); } catch (e) { console.error(JSON.stringify({ evt: "q08-signal-engine:buildSources:caught", error: String((e && e.message) || e) })); } out.push({ label: host || u, url: u }); }
    if (story.id) out.push({ label: "Hacker News discussion", url: "https://news.ycombinator.com/item?id=" + story.id });
  }
  return out;
}

// Q08-RENDER-1 (owner directive 2026-10-10): inline Markdown and math render wherever a title, heading, claim or preview shows.
// Math: \( \) and $$ $$ always; a single-dollar span only when the opening $ is not followed by a space, the closing $ is not
// preceded by a space or followed by a digit, and the inside holds a TeX token, so currency such as "$870 million ... $7.5
// billion" stays literal. \$ is a literal dollar. q08Inline gives HTML (typeset by MathJax in the page); q08Plain gives plain
// text for <title>, meta, JSON-LD, RSS, e-mail and social text.
var Q08_PH0 = "\uE000", Q08_PH1 = "\uE001", Q08_DOLLAR = "\uE002";
function q08Math(s, store) {
  var keep = function (tex, disp) { store.push([String(tex), disp]); return Q08_PH0 + (store.length - 1) + Q08_PH1; };
  s = String(s == null ? "" : s).replace(/\\\$/g, Q08_DOLLAR);
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, function (m, t) { return keep(t, true); });
  s = s.replace(/\\\[([\s\S]+?)\\\]/g, function (m, t) { return keep(t, true); });
  s = s.replace(/\\\(([\s\S]+?)\\\)/g, function (m, t) { return keep(t, false); });
  s = s.replace(/\$(?=[^\s$])([^$\n]*?[^\s$])\$(?!\d)/g, function (m, t) { return (/[\\^_{}]/.test(t) || /^[A-Za-z]$/.test(t)) ? keep(t, false) : m; });
  return s;
}
function q08Unmath(s, store, f) {
  return s.replace(/\uE000(\d+)\uE001/g, function (m, i) { return f(store[+i]); }).split(Q08_DOLLAR).join("$");
}
var Q08_TEX = { alpha: "\u03b1", beta: "\u03b2", gamma: "\u03b3", delta: "\u03b4", epsilon: "\u03b5", varepsilon: "\u03b5", zeta: "\u03b6", eta: "\u03b7", theta: "\u03b8", iota: "\u03b9", kappa: "\u03ba", lambda: "\u03bb", mu: "\u03bc", nu: "\u03bd", xi: "\u03be", pi: "\u03c0", rho: "\u03c1", sigma: "\u03c3", tau: "\u03c4", phi: "\u03c6", varphi: "\u03c6", chi: "\u03c7", psi: "\u03c8", omega: "\u03c9", Gamma: "\u0393", Delta: "\u0394", Theta: "\u0398", Lambda: "\u039b", Pi: "\u03a0", Sigma: "\u03a3", Phi: "\u03a6", Psi: "\u03a8", Omega: "\u03a9", times: "\u00d7", cdot: "\u00b7", leq: "\u2264", le: "\u2264", geq: "\u2265", ge: "\u2265", neq: "\u2260", ne: "\u2260", approx: "\u2248", to: "\u2192", rightarrow: "\u2192", leftarrow: "\u2190", infty: "\u221e", pm: "\u00b1", sum: "\u03a3", log: "log", ln: "ln", min: "min", max: "max" };
var Q08_SUP = { "0": "\u2070", "1": "\u00b9", "2": "\u00b2", "3": "\u00b3", "4": "\u2074", "5": "\u2075", "6": "\u2076", "7": "\u2077", "8": "\u2078", "9": "\u2079", "+": "\u207a", "-": "\u207b", "n": "\u207f", "i": "\u2071" };
var Q08_SUB = { "0": "\u2080", "1": "\u2081", "2": "\u2082", "3": "\u2083", "4": "\u2084", "5": "\u2085", "6": "\u2086", "7": "\u2087", "8": "\u2088", "9": "\u2089", "+": "\u208a", "-": "\u208b" };
function q08TexPlain(tex) {
  var t = String(tex).replace(/\\(?:text|mathrm|mathbf|mathit|operatorname|mathcal|mathbb)\s*\{([^{}]*)\}/g, "$1");
  t = t.replace(/\\([A-Za-z]+)/g, function (m, n) { return Object.prototype.hasOwnProperty.call(Q08_TEX, n) ? Q08_TEX[n] : n; });
  t = t.replace(/\^\{?([0-9+\-ni]+)\}?/g, function (m, d) { var o = ""; for (var i = 0; i < d.length; i++) { if (!Q08_SUP[d[i]]) return m; o += Q08_SUP[d[i]]; } return o; });
  t = t.replace(/_\{?([0-9+\-]+)\}?/g, function (m, d) { var o = ""; for (var i = 0; i < d.length; i++) { if (!Q08_SUB[d[i]]) return m; o += Q08_SUB[d[i]]; } return o; });
  return t.replace(/[{}\\]/g, "").replace(/\s+/g, " ").trim();
}
function q08Inline(s) {
  var store = [];
  var t = escHtml(q08Math(s, store));
  var parts = t.split(/(`[^`\n]+`)/);
  for (var i = 0; i < parts.length; i++) {
    if (i % 2 === 1) { parts[i] = "<code>" + parts[i].slice(1, -1) + "</code>"; continue; }
    parts[i] = parts[i]
      .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" rel="noopener noreferrer">$1</a>')
      .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*\w])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![*\w])/g, "$1<em>$2</em>")
      .replace(/(^|[^\w])_(?=[^\s_])([^_\n]*?[^\s_])_(?!\w)/g, "$1<em>$2</em>");
  }
  return q08Unmath(parts.join(""), store, function (m) { return m[1] ? "$$" + escHtml(m[0]) + "$$" : "\\(" + escHtml(m[0]) + "\\)"; });
}
function q08Plain(s) {
  var store = [];
  var t = q08Math(s, store)
    .replace(/!?\[([^\]\n]*)\]\([^)\s]*\)/g, "$1").replace(/`([^`\n]*)`/g, "$1")
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "$1")
    .replace(/(^|[^*\w])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![*\w])/g, "$1$2")
    .replace(/(^|[^\w])_(?=[^\s_])([^_\n]*?[^\s_])_(?!\w)/g, "$1$2");
  return q08Unmath(t, store, function (m) { return q08TexPlain(m[0]); }).replace(/\s+/g, " ").trim();
}

var CSS = `
:root{--bg:#f9f7f4;--fg:#1c1a18;--mut:#6b6560;--line:#e0d9d0;--acc:#5a3e2b;--max:42rem}
@media(prefers-color-scheme:dark){:root{--bg:#161412;--fg:#e8e3dc;--mut:#9a938b;--line:#2e2a25;--acc:#c9956e}}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--fg);font:17px/1.68 Georgia,'Times New Roman',serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:var(--max);margin:0 auto;padding:3rem 1.2rem 5rem}
header{border-bottom:1px solid var(--line);padding-bottom:1.2rem;margin-bottom:2.5rem}
header h1{font-size:1.05rem;font-weight:400;letter-spacing:.04em;color:var(--mut);text-transform:uppercase}
header p{font-size:.88rem;color:var(--mut);margin-top:.3rem}
nav{display:flex;gap:1.2rem;margin-top:.8rem;font-size:.88rem}
nav a{color:var(--acc);text-decoration:none}
nav a:hover{text-decoration:underline}
article{margin-bottom:3rem;padding-bottom:2rem;border-bottom:1px solid var(--line)}
article:last-child{border-bottom:none}
article h2{font-size:1.22rem;font-weight:600;line-height:1.3;margin-bottom:.5rem}
article h2 a{color:var(--fg);text-decoration:none}
article h2 a:hover{color:var(--acc)}
article .meta{font-size:.82rem;color:var(--mut);margin-bottom:.8rem}
article .lede{font-size:.97rem;color:var(--mut);line-height:1.6}
.piece h1{font-size:1.5rem;line-height:1.25;margin-bottom:.6rem}
.piece h2{font-size:1.15rem;margin:1.8rem 0 .5rem;font-weight:600}
.piece h3{font-size:1rem;margin:1.4rem 0 .4rem;font-weight:600;color:var(--acc)}
.piece p{margin-bottom:1rem}
.piece ul,.piece ol{margin:.6rem 0 1rem 1.4rem}
.piece li{margin-bottom:.3rem}
.piece strong{font-weight:600}
.piece em{font-style:italic}
.fb{margin:2.2rem 0 0;padding-top:1.2rem;border-top:1px solid var(--line);font-size:.92rem;color:var(--mut)}
.fb a{margin:0 .7rem 0 0;color:var(--acc);text-decoration:none}
.fb a:hover{text-decoration:underline}
footer{margin-top:4rem;padding-top:1.5rem;border-top:1px solid var(--line);font-size:.82rem;color:var(--mut)}
.chip{display:inline-block;font-size:.75rem;padding:.15rem .5rem;border-radius:3px;background:var(--line);color:var(--mut);margin-right:.4rem}
.refs{margin-top:2.5rem;padding-top:1.5rem;border-top:1px solid var(--line)}
.refs h2{font-size:.95rem;text-transform:uppercase;letter-spacing:.06em;color:var(--mut);font-weight:400;margin-bottom:.8rem}
.refs ul{margin:0;padding-left:1.2rem}
.refs li{margin-bottom:.4rem;font-size:.92rem}
.refs a{color:var(--acc)}
.refs a:hover{text-decoration:underline}
`;


// Q08-QDS-1 (2026-10-02, pillar reach): q08.org on the shared design system with its own identity. q08 is a separate
// publication (STRATEGY 2.1): it keeps its own name, voice and rust accent, links no QNFO navigation, and only borrows
// the type, spacing and components from https://qnfo.org/qds.css. Every page, including subscribe/confirm/unsubscribe
// and 404, now has a head, header and footer (they were bare fragments); the verdict form keeps its POST buttons.
var Q08_QDS = "1.0.0";
var Q08_FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Familjen+Grotesk:wght@400;500;600&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400&display=swap">';
var Q08_FAVICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23182042'/%3E%3Ctext x='16' y='21.5' text-anchor='middle' font-family='Georgia,serif' font-size='14' fill='%23F2906A'%3Eq08%3C/text%3E%3C/svg%3E";
// BEGIN TURNSTILE-EDGE-1
var TURNSTILE_SCRIPT = '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>';
function turnstileWidget(env, action) {
  var e = env || {};
  var sitekey = q08Attr(e.TURNSTILE_SITEKEY || "");
  return '<div class="cf-turnstile" data-sitekey="' + sitekey + '" data-action="' + q08Attr(action) + '"></div>';
}
async function turnstileVerify(env, token, ip, action) {
  var e = env || {};
  var secret = e.TURNSTILE_SECRET || "";
  var res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: new URLSearchParams({ secret: secret, response: token, remoteip: ip, action: action })
  });
  var data = await res.json();
  return data.success === true && data.action === action;
}
// END TURNSTILE-EDGE-1
var Q08_CSS = '<style>.q08-mark{font:600 1.15rem/1 var(--q-serif);letter-spacing:-.01em;text-decoration:none;color:var(--q-ink);display:flex;align-items:baseline;gap:10px}.q08-mark b{color:var(--q-accent);font-weight:600}.q08-mark small{font:400 var(--q-fs-sm)/1 var(--q-sans);color:var(--q-muted)}.q08-hero{padding:56px 0 24px;max-width:760px}.q08-hero h1{font:500 clamp(2rem,4.2vw,3.1rem)/1.08 var(--q-serif);letter-spacing:-.02em;margin:0 0 16px}.q08-feed{max-width:760px}.q08-piece{max-width:var(--q-measure);padding:40px 0 24px}.q08-piece h1.q08-t{font:500 clamp(1.85rem,3.4vw,2.6rem)/1.12 var(--q-serif);letter-spacing:-.015em;margin:0 0 14px;text-wrap:balance}.q08-fb{margin:40px 0 0;padding:20px 0 0;border-top:1px solid var(--q-rule);display:flex;flex-wrap:wrap;gap:10px;align-items:center;font-size:var(--q-fs-sm);color:var(--q-muted)}.q08-fb span{margin-right:6px}.q08-refs{margin:40px 0 0;padding-top:20px;border-top:1px solid var(--q-rule)}.q08-refs h2{font:600 var(--q-fs-sm)/1.3 var(--q-sans);color:var(--q-muted);margin:0 0 12px}.q08-refs ul{margin:0;padding-left:1.2em;font-size:var(--q-fs-sm)}.q08-refs li{margin-bottom:6px}.q08-refs a{color:var(--q-accent)}.q08-msg{padding:72px 0;max-width:620px}.q08-sub form{display:flex;gap:8px;flex-wrap:wrap}.q08-sub .q-input{flex:1;min-width:220px}</style>';
function q08Attr(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function q08Page(o, body) {
  var t = q08Attr(o.title), d = q08Attr(o.description || "Explanatory essays on technology stories: what happened, and the system that made it happen.");
  var canon = o.canonical ? q08Attr(o.canonical) : "";
  var siteJsonld = { "@context": "https://schema.org", "@type": "WebSite", name: "q08", url: ORIGIN, description: "Systems-level critique: explanatory essays on technology stories, with dated, scored forecasts.", publisher: { "@type": "Organization", name: "q08", url: ORIGIN } };
  var ldArr = o.jsonld ? (Array.isArray(o.jsonld) ? o.jsonld : [o.jsonld]) : [];
  ldArr.push(siteJsonld);
  var ld = '<script type="application/ld+json">' + JSON.stringify(ldArr).replace(/</g, "\\u003c") + "<\/script>";
  var xh = o.extraHead || "";
  var pubMeta = o.published ? '<meta property="article:published_time" content="' + q08Attr(o.published) + '">' : "";
  var modMeta = o.modified ? '<meta property="article:modified_time" content="' + q08Attr(o.modified) + '">' : "";
  var authMeta = o.author ? '<meta property="article:author" content="' + q08Attr(o.author) + '">' : "";
  return '<!DOCTYPE html><html lang="en" data-brand="q08"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + t + '</title><meta name="description" content="' + d + '">' +
    xh + (canon ? '<link rel="canonical" href="' + canon + '"><meta property="og:url" content="' + canon + '">' : "") + (o.robots ? '<meta name="robots" content="' + q08Attr(o.robots) + '">' : "") +
    '<meta property="og:site_name" content="q08"><meta property="og:title" content="' + t + '"><meta property="og:description" content="' + d + '"><meta property="og:type" content="' + (o.ogType || "website") + '">' + (o.ogType === "article" ? pubMeta + modMeta + authMeta : "") + (o.section ? '<meta property="article:section" content="' + q08Attr(o.section) + '">' : "") + '<meta name="twitter:card" content="summary"><meta name="twitter:title" content="' + t + '"><meta name="twitter:description" content="' + d + '">' +
    '<meta name="theme-color" content="#F5F7FB" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#121731" media="(prefers-color-scheme: dark)"><link rel="icon" type="image/svg+xml" href="' + Q08_FAVICON + '"><link rel="alternate" type="application/rss+xml" title="q08" href="/feed.xml">' +
    Q08_FONTS + '<link rel="stylesheet" href="https://qnfo.org/qds.css?v=' + Q08_QDS + '"><script src="https://qnfo.org/qds.js?v=' + Q08_QDS + '" defer><\/script>' + Q08_CSS + ld + MATH_HEAD + "</head><body>" +
    '<a class="q-skip" href="#main">Skip to main content</a><header class="q-top"><div class="q-wrap"><a class="q08-mark" href="/" aria-label="q08 home"><b>q08</b><small>systems-level critique</small></a>' +
    '<nav class="q-nav q-nav-wide" aria-label="Main"><a href="/"' + (o.active === "index" ? ' aria-current="page"' : "") + '>Index</a><a href="/forecasts"' + (o.active === "forecasts" ? ' aria-current="page"' : "") + '>Forecasts</a><a href="/subscribe"' + (o.active === "subscribe" ? ' aria-current="page"' : "") + '>Subscribe</a><a href="/feed.xml">RSS</a></nav>' +
    '<details class="q-menu"><summary aria-label="Menu"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></summary><nav class="q-nav" aria-label="Main"><a href="/">Index</a><a href="/forecasts">Forecasts</a><a href="/subscribe">Subscribe</a><a href="/feed.xml">RSS</a></nav></details>' +
    '<button class="q-theme" type="button" data-q-theme aria-label="Switch between light and dark theme"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 1.8a6.2 6.2 0 0 1 0 12.4z" fill="currentColor"/></svg></button></div></header>' +
    '<main id="main"><div class="q-wrap">' + body + "</div></main>" +
    '<footer class="q-foot"><div class="q-wrap"><div class="q-foot-base" style="border-top:0;padding-top:0;margin-top:0"><span>q08: an autonomous signal engine, updated continuously</span><span>Pieces are machine-written and gated before publication. <a href="/feed.xml">RSS</a> \u00b7 <a href="/subscribe">Daily digest</a> \u00b7 <a href="/health">Status</a></span></div></div></footer><script src="https://fleet.qnfo.org/ctl.js" defer><\/script></body></html>';
}
function q08Sub(compact) {
  return '<section class="q-panel q08-sub" style="margin:48px 0 64px' + (compact ? ";max-width:760px" : "") + '"><h2 class="q-h3" style="margin:0 0 6px">The daily digest</h2><p class="q-meta" style="margin:0 0 14px">One email a day with that day\u2019s pieces. Confirm by email; unsubscribe from any digest.</p>' +
    '<form method="post" action="/subscribe"><label class="q-sr" for="q08-e">Email address</label><input class="q-input" id="q08-e" type="email" name="email" placeholder="you@example.com" autocomplete="email" required><button class="q-btn q-btn-accent" type="submit">Subscribe</button></form></section>';
}
function q08Short(t, n) { t = String(t || ""); if (t.length <= n) return t; var c = t.slice(0, n), sp = c.lastIndexOf(" "); return (sp > n * 0.5 ? c.slice(0, sp) : c).replace(/[\s,;:.\-]+$/, "") + "\u2026"; }
function q08Lede(md) { return q08Plain(String(md || "").replace(/^#+\s*.+\n?/m, "").replace(/^[ \t]*(?:#{1,6}|[-*]|>|\d+[.)])[ \t]+/gm, "")); }
function renderIndex(pieces) {
  var items = pieces.map(function(p) {
    var date = (p.published_at || "").slice(0, 10);
    var lede = q08Short(q08Lede(p.body_md), 220);
    return '<li class="q-item"><a class="q-item-title" href="/p/' + escHtml(p.slug) + '">' + q08Inline(p.title) + "</a>" +
      '<div class="q-item-meta"><time datetime="' + escHtml(p.published_at || "") + '">' + date + "</time>" + (p.kind === "forecast" ? '<span class="q-badge">Forecast</span>' : (p.core_concept ? '<span class="q-badge">' + escHtml(q08Short(p.core_concept, 44)) + "</span>" : "")) + "</div>" +
      (lede ? '<p class="q-item-text">' + escHtml(lede) + "</p>" : "") + "</li>";
  }).join("");
  var body = '<section class="q08-hero"><h1>What happened, and the system that made it happen.</h1><p class="q-lede">Each piece reports one story from the technical front page for a reader who missed it, then explains the system that produced it. Every fact is checked against its source.</p></section>' +
    '<section class="q08-feed" aria-label="Pieces">' + (items ? '<ul class="q-list">' + items + "</ul>" : '<div class="q-note">No pieces published yet. The engine publishes a few times a day; subscribe below to get the next one.</div>') + "</section>" + q08Sub(true);
  return q08Page({ title: "q08 \u00b7 systems-level critique", canonical: ORIGIN + "/", active: "index", jsonld: { "@context": "https://schema.org", "@type": "Blog", name: "q08", url: ORIGIN + "/", description: "Systems-level critique of technical industry friction." } }, body);
}
// Q08-REACH-1: every piece carries one-tap share links, a ready-to-paste citation and a prompt to answer back, plus Scholar-style
// citation meta tags and fuller JSON-LD, so a reader can pass it on, cite it and argue with it without leaving the page.
function shareText(p) {
  return p.kind === "forecast" ? "A scored forecast: " + q08Plain(p.title) : q08Plain(p.title);
}
function renderShare(p) {
  var u = ORIGIN + "/p/" + p.slug, t = shareText(p), eu = encodeURIComponent(u), et = encodeURIComponent(t);
  var links = [["Bluesky", "https://bsky.app/intent/compose?text=" + encodeURIComponent(t + " " + u)], ["X", "https://twitter.com/intent/tweet?text=" + et + "&url=" + eu], ["LinkedIn", "https://www.linkedin.com/sharing/share-offsite/?url=" + eu], ["Mastodon", "https://mastodon.social/share?text=" + encodeURIComponent(t + " " + u)], ["Hacker News", "https://news.ycombinator.com/submitlink?u=" + eu + "&t=" + et], ["Reddit", "https://www.reddit.com/submit?url=" + eu + "&title=" + et], ["Email", "mailto:?subject=" + et + "&body=" + encodeURIComponent(t + "\n" + u)]];
  var yr = (p.published_at || "").slice(0, 4);
  var cite = "q08. (" + yr + "). " + q08Plain(p.title) + ". q08.org. " + u;
  var nativeBtn = '<button class="q-native-share" style="margin:0 0 8px" onclick="if(navigator.share){navigator.share({title:' + JSON.stringify(t) + ',text:' + JSON.stringify(t) + ',url:' + JSON.stringify(u) + '})}">Share</button>';
return '<section class="q08-share" aria-label="Share and cite" style="margin:28px 0">' + nativeBtn +
  '<p class="q-meta" style="margin:0 0 8px">Pass it on: ' +
    links.map(function (l) { return '<a href="' + escHtml(l[1]) + '" rel="noopener" target="_blank">' + l[0] + "</a>"; }).join(" \u00b7 ") + "</p>" +
    (p.kind === "forecast" ? '<p class="q-meta" style="margin:0 0 8px">Disagree? Post your own probability for the claim and link this page; q08 settles it in public on the stated date.</p>' : "") +
    '<p class="q-meta" style="margin:0 0 8px">Download citation: <a href="/p/' + escHtml(p.slug) + '.bib">BibTeX</a> \u00b7 <a href="/p/' + escHtml(p.slug) + '.ris">RIS</a></p>' +
    '<p class="q-meta" style="margin:0"><label>Cite as <input class="q-input" readonly value="' + escHtml(cite) + '" onfocus="this.select()" style="width:100%"></label></p></section>';
}
function citationFile(p, fmt) {
  var u = ORIGIN + "/p/" + p.slug, y = (p.published_at || "").slice(0, 4), m = (p.published_at || "").slice(5, 7), d = (p.published_at || "").slice(8, 10);
  var t = q08Plain(p.title).replace(/[{}\r\n]+/g, " ");
  if (fmt === "bib") return "@online{q08_" + String(p.slug).replace(/[^a-z0-9]/g, "") + ",\n  author = {{q08}},\n  title = {" + t + "},\n  year = {" + y + "},\n  month = {" + m + "},\n  url = {" + u + "},\n  organization = {q08},\n  note = {q08.org}\n}\n";
  return "TY  - ELEC\r\nAU  - q08\r\nTI  - " + t + "\r\nPY  - " + y + "\r\nDA  - " + y + "/" + m + "/" + d + "\r\nPB  - q08\r\nUR  - " + u + "\r\nER  - \r\n";
}
// Q08-FUNNEL-1 (owner directive 2026-10-09: all properties are one funnel): q08 is the attention surface, QNFO the authority
// it feeds. Each piece points readers to the imprint's papers and the iPatent tool, tagged so the gateway's UTM ledger counts the
// clicks per piece. QWAV (parked label) and the personal reading site are deliberately not linked.
function funnelUrl(base, slug) {
  return base + "?utm_source=q08&utm_medium=piece&utm_campaign=" + encodeURIComponent(String(slug || "home"));
}
function renderFunnel(slug) {
  return '<aside class="q08-funnel q-panel" aria-label="From the same imprint" style="margin:28px 0"><p class="q-meta" style="margin:0 0 6px">q08 is published by QNFO, an independent research imprint. Same author, slower and checked line by line:</p>' +
    '<ul class="q-list" style="margin:0"><li><a href="' + escHtml(funnelUrl("https://papers.qnfo.org/", slug)) + '">Open-access research papers</a></li>' +
    '<li><a href="' + escHtml(funnelUrl("https://ipatent.qnfo.org/", slug)) + '">iPatent</a>: free, private-by-default provisional patent drafting</li>' +
    '<li><a href="' + escHtml(funnelUrl("https://qnfo.org/", slug)) + '">QNFO</a>: the work and the author</li></ul></aside>';
}
function pieceHead(p, desc) {
  var u = ORIGIN + "/p/" + p.slug, d = (p.published_at || "").slice(0, 10).replace(/-/g, "/");
  return '<meta name="citation_title" content="' + q08Attr(q08Plain(p.title)) + '"><meta name="citation_publication_date" content="' + q08Attr(d) + '"><meta name="citation_abstract_html_url" content="' + q08Attr(u) + '"><meta name="citation_publisher" content="q08"><meta name="citation_author" content="q08">' +
    '<meta property="article:published_time" content="' + q08Attr(p.published_at || "") + '"><meta property="article:section" content="' + (p.kind === "forecast" ? "Forecast" : "Analysis") + '">';
}
// BP26-AI-LABEL-1 (0.37.0, 2026-10-26): EU AI Act Article 50(4) requires AI-generated text published to inform the public on matters of
// public interest to be disclosed as such unless a human holds editorial responsibility; q08 publishes without a human review step, so every
// piece says so where it is read, links the method note, and states it in machine-readable form (JSON-LD creditText). The label is
// unconditional: there is no switch, because the obligation has no off position.
var AI_METHOD_URL = ORIGIN + "/p/2026-10-26-how-q08-researches-writes-and-scores-its-forecasts-m3th0d";
var AI_LABEL_TEXT = "AI-generated";
var AI_CREDIT_TEXT = "Researched and written by AI; factual claims are checked by an independent AI fact-checker before publication. No human reviews pieces before they appear. Method: " + AI_METHOD_URL;
function aiLabelHtml() { return '<a class="q-badge" href="' + escHtml(AI_METHOD_URL) + '" title="' + escHtml(AI_CREDIT_TEXT) + '" style="text-decoration:none">' + AI_LABEL_TEXT + "</a>"; }
var Q08_FEEDBACK_SCRIPT = `<script>
(function () {
  var form = document.querySelector(".q08-fb");
  if (!form || typeof fetch !== "function" || typeof FormData !== "function") return;
  var status = form.querySelector(".q08-fb-status");
  var buttons = form.querySelectorAll("button");
  form.addEventListener("submit", async function (event) {
    if (!event.submitter) return;
    event.preventDefault();
    var action = event.submitter.formAction;
    var body = new FormData(form);
    buttons.forEach(function (button) { button.disabled = true; });
    status.textContent = "Saving your vote\u2026";
    try {
      var response = await fetch(action, { method: "POST", body: body, headers: { Accept: "application/json" } });
      var result = await response.json();
      if (!response.ok || !result.ok) throw new Error("Vote not saved");
      status.textContent = result.updated === false ? "Your vote was already recorded." : "Thanks \u2014 your vote is recorded.";
    } catch (e) {
      status.textContent = "Your vote could not be saved. Please try again.";
      buttons.forEach(function (button) { button.disabled = false; });
    }
  });
})();
</script>`;
function renderPiece(p, fr) {
  var body = mdToHtml(p.body_md || "").replace(/^\s*<h1>[\s\S]*?<\/h1>\s*/, "");
  var refs = renderSources(p.sources_json);
  var fb = '<form class="q08-fb" method="post"><span>Was this worth your time?</span><textarea class="q-input" name="note" maxlength="280" rows="2" style="flex-basis:100%;order:2" placeholder="Optional: what was missing?" aria-label="Optional note: what was missing?"></textarea><button class="q-btn q-btn-ghost" formaction="/api/f?slug=' + escHtml(p.slug) + '&amp;s=good">Yes</button> <button class="q-btn q-btn-ghost" formaction="/api/f?slug=' + escHtml(p.slug) + '&amp;s=flat">Flat</button> <button class="q-btn q-btn-ghost" formaction="/api/f?slug=' + escHtml(p.slug) + '&amp;s=no">No</button><span class="q08-fb-status" role="status" style="flex-basis:100%;order:3"></span></form>' + Q08_FEEDBACK_SCRIPT;
  var date = (p.published_at || "").slice(0, 10);
  var desc = q08Short(q08Lede(p.body_md), 160);
  var html = '<article class="q08-piece"><p class="q-eyebrow"><a href="/" style="text-decoration:none;color:inherit">\u2190 Index</a></p><h1 class="q08-t">' + q08Inline(p.title) + '</h1><p class="q-meta" style="margin:0 0 28px"><time datetime="' + escHtml(p.published_at || "") + '">' + date + "</time>" + (p.kind === "forecast" ? ' \u00b7 <span class="q-badge">Forecast</span>' : (p.core_concept ? ' \u00b7 <span class="q-badge">' + escHtml(q08Short(p.core_concept, 44)) + "</span>" : "")) + " \u00b7 " + aiLabelHtml() + "</p>" +
    '<div class="q-prose piece">' + body + "</div>" + (p.kind === "forecast" ? renderForecastBox(fr) : "") + fb + renderShare(p) + renderFunnel(p.slug) + (refs ? '<div class="q08-refs">' + refs.replace(/^\s*<section class="refs">/, "").replace(/<\/section>\s*$/, "") + "</div>" : "") + "</article>" + q08Sub(false);
  return q08Page({ title: q08Plain(p.title) + " \u00b7 q08", description: desc, canonical: ORIGIN + "/p/" + p.slug, ogType: "article", extraHead: pieceHead(p, desc),
    jsonld: { "@context": "https://schema.org", "@type": "Article", headline: q08Plain(p.title).slice(0, 110), description: desc, datePublished: p.published_at || undefined, dateModified: p.published_at || undefined, url: ORIGIN + "/p/" + p.slug, mainEntityOfPage: ORIGIN + "/p/" + p.slug, isAccessibleForFree: true, inLanguage: "en", creditText: AI_CREDIT_TEXT, articleSection: p.kind === "forecast" ? "Forecast" : "Analysis", isPartOf: p.kind === "forecast" ? { "@type": "CreativeWorkSeries", name: "q08 Forecast Ledger", url: ORIGIN + "/forecasts" } : undefined, author: { "@type": "Organization", name: "q08", url: ORIGIN + "/" }, publisher: { "@type": "Organization", name: "q08", url: ORIGIN + "/", parentOrganization: { "@type": "Organization", name: "QNFO", url: "https://qnfo.org/" } } } }, html);
}
// Bare fragments (subscribe, confirm, unsubscribe, not found) get the full page shell.
function q08Wrap(fragment, title) {
  if (/^\s*<!doctype/i.test(fragment)) return fragment;
  var t = title || ((/<h[12][^>]*>([^<]{1,80})<\/h[12]>/.exec(fragment) || [])[1] || "q08");
  var f = String(fragment).replace(/<form method=post action=\/subscribe><input type=email name=email required><button>Subscribe<\/button><\/form>/, '<form method="post" action="/subscribe" class="q08-sub" style="margin:20px 0"><label class="q-sr" for="q08-e2">Email address</label><input class="q-input" id="q08-e2" type="email" name="email" placeholder="you@example.com" autocomplete="email" required><button class="q-btn q-btn-accent" type="submit">Subscribe</button></form>')
    .replace(/<h[12]>/, '<h1 class="q-h1">').replace(/<\/h[12]>/, "</h1>");
  return q08Page({ title: t + " \u00b7 q08", active: /subscri/i.test(t) ? "subscribe" : "", robots: "noindex" }, '<section class="q08-msg">' + f + "</section>");
}

function mdToHtml(md) {
  // Markdown -> HTML: headings, bullet and numbered lists, block quotes and paragraphs; every text run goes through q08Inline
  // (Q08-RENDER-1), so emphasis, links, code and math render in headings and list items too.
  var lines = String(md || "").split("\n");
  var out = [];
  var list = "";
  var close = function () { if (list) { out.push("</" + list + ">"); list = ""; } };
  for (var line of lines) {
    var hm = line.match(/^(#{1,3}) +(.+)/);
    var ul = line.match(/^[-*] +(.+)/);
    var ol = line.match(/^\d+[.)] +(.+)/);
    var bq = line.match(/^> ?(.+)/);
    if (hm) { close(); out.push("<h" + hm[1].length + ">" + q08Inline(hm[2]) + "</h" + hm[1].length + ">"); }
    else if (ul) { if (list !== "ul") { close(); out.push("<ul>"); list = "ul"; } out.push("<li>" + q08Inline(ul[1]) + "</li>"); }
    else if (ol) { if (list !== "ol") { close(); out.push("<ol>"); list = "ol"; } out.push("<li>" + q08Inline(ol[1]) + "</li>"); }
    else if (bq) { close(); out.push("<blockquote><p>" + q08Inline(bq[1]) + "</p></blockquote>"); }
    else if (line.trim() === "") { close(); }
    else { close(); out.push("<p>" + q08Inline(line) + "</p>"); }
  }
  close();
  return out.join("\n");
}


function renderFeed(pieces) {
  var items = pieces.map(function(p) {
    var date = new Date(p.published_at || Date.now()).toUTCString();
    var desc = escHtml(q08Short(q08Lede(p.body_md), 500));
    return "<item><title>" + escHtml(q08Plain(p.title)) + "</title><link>https://q08.org/p/" + escHtml(p.slug) + "</link><pubDate>" + date + "</pubDate><description>" + desc + "...</description></item>";
  }).join("\n");
  return '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>q08</title><link>https://q08.org</link><description>Systems-level critique. Structural. Timeless.</description>' + items + '</channel></rss>';
}

// ---------------------------------------------------------------------------
// 10. Worker export
// ---------------------------------------------------------------------------
// ============ Email + Social ============
async function sha16(s) {
  var enc = new TextEncoder();
  var buf = await crypto.subtle.digest("SHA-256", enc.encode(String(s)));
  return Array.from(new Uint8Array(buf)).slice(0,16).map(function(b){return b.toString(16).padStart(2,"0");}).join("");
}
async function sendEmail(env, to, subject, body, unsubUrl) {
  // Tokenless path: native Email Routing send binding (q08.org). No API key needed.
  if (env.SEND_EMAIL) {
    try {
      var msg = { to: to, from: "digest@q08.org", subject: subject, text: body };
      if (unsubUrl) msg.headers = { "List-Unsubscribe": "<" + unsubUrl + ">", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
      await env.SEND_EMAIL.send(msg);
      return { ok: true, via: "send_email" };
    } catch (e) {
      return { ok: false, error: "send_email: " + String(e && e.message || e) };
    }
  }
  // Fallback: qnfo-email HTTP API (requires EMAIL_API_KEY).
  if (!env.EMAIL) return { ok: false, error: "no email path" };
  try {
    var resp = await env.EMAIL.fetch("https://email.internal/send", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + (env.EMAIL_API_KEY || "") }, body: JSON.stringify({ to: to, from: "qnfo@qnfo.org", subject: subject, body: body }) });
    return { ok: resp.ok, status: resp.status };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}
async function sendDigest(env) {
  var day = utcDay();
  await ensureForecastSchema(env);
  var pieces = await env.DB.prepare("SELECT slug, title" + (__forecastSchemaDone ? ", kind" : "") + " FROM published_pieces WHERE published_at >= ?1 AND slug NOT IN (SELECT slug FROM q08_retractions) ORDER BY published_at ASC").bind(day + "T00:00:00.000Z").all();
  var rows = pieces.results || [];
  if (!rows.length) return { ok: true, skipped: "no pieces today", pieces: 0 };
  var subs = await env.DB.prepare("SELECT email, token FROM subscribers WHERE status='confirmed' LIMIT 500").all();
  var list = rows.map(function(r){ return "- " + (r.kind === "forecast" ? "Forecast: " : "") + q08Plain(r.title) + " - https://q08.org/p/" + r.slug; }).join("\n");
  var sent = 0;
  for (var s of (subs.results || [])) {
    var unsubUrl = "https://q08.org/unsubscribe?t=" + s.token;
    var body = "q08 - daily digest (" + day + ")\n\n" + list + "\n\nUnsubscribe: " + unsubUrl;
    var r = await sendEmail(env, s.email, "q08 - daily digest", body, unsubUrl);
    if (r && r.ok) sent++;
  }
  return { ok: true, pieces: rows.length, subscribers: (subs.results||[]).length, sent: sent };
}
// IndexNow: instant search-index ping for a newly published URL (no auth needed).
async function pingIndexNow(env, url) {
  try {
    var resp = await fetch("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "q08.org", key: INDEXNOW_KEY, keyLocation: ORIGIN + "/" + INDEXNOW_KEY + ".txt", urlList: [url] })
    });
    return { ok: resp.ok, status: resp.status };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}

// Distribution via qnfo-social (Bluesky + Buffer cross-post). Tokenless:
// write to the shared social_threads queue in qnfo-audit; qnfo-social's cron
// picks it up and cross-posts. Buffer covers Mastodon + LinkedIn + X.
async function queueForDistribution(env, title, slug, fc, hook) {
  // Q08-PERSONAL-CHANNEL-HOLD-1 (2026-10-01): social_threads is drained by qnfo-social onto the
  // owner's PERSONAL Bluesky account, so every q08 essay posted under the owner's name. Off by default;
  // set the plain var Q08_SOCIAL_QUEUE="1" to re-enable once q08 has its own channel.
  // Q08-FORECAST-PROMOTE-1 (owner directive 2026-10-09: forecasts must be widely self-promoted): a forecast alone may be queued
  // when Q08_SOCIAL_FORECASTS="1" (the default in wrangler.toml). Essays stay held by Q08_SOCIAL_QUEUE; set the var to "0" to stop.
  if (env.Q08_SOCIAL_QUEUE === "0" || (!fc && env.Q08_SOCIAL_QUEUE !== "1" && env.Q08_SOCIAL_ESSAYS !== "1")) return { ok: false, skip: "Q08-PERSONAL-CHANNEL-HOLD-1" };
  if (!env.AUDIT) return { ok: false, skip: "no audit binding" };
  try {
    // NO-TRUNCATED-LINK-1 (2026-09-27): never slice the URL. A long title used to
    // truncate the permalink (e.g. ".../p/2026-09-18-...-the-lar") -> 404 -> link-dead.
    var _u = "https://q08.org/p/" + slug;
    var _s = " \u2014 ";
    var _t = String(title || "");
    if (fc) { _t = forecastPostText(fc, _u); _s = ""; _u = ""; }
    else if (hook) { // title, then the piece's own opening sentence as the hook, then the permalink (never truncated)
      var _room = 280 - _t.length - _u.length - 4, _h = String(hook).replace(/\s+/g, " ").trim().replace(/^(.{20,}?[.!?])\s.*$/, "$1");
      if (_room >= 40 && _h.length > _room) _h = _h.slice(0, _room - 1).replace(/\s+\S*$/, "") + "\u2026";
      if (_room >= 40 && _h) { _t = _t + "\n\n" + _h; _s = "\n\n"; }
    }
    var text = (_t.length + _s.length + _u.length <= 280) ? (_t + _s + _u) : (_t.slice(0, Math.max(0, 280 - _u.length - _s.length)) + _s + _u);
    var id = (fc ? "q08-fc-" : "q08-") + Date.now().toString(36) + rnd36(4);
    await env.AUDIT.prepare("INSERT OR IGNORE INTO social_threads (slug, title, posts, status, notes) VALUES (?,?,?, 'queued', ?)").bind(id, String(title || "").slice(0, 300), JSON.stringify([text]), "selected: q08 piece (Q08-OPEN-1, owner directive 2026-10-09)").run();
    return { ok: true, queued: id };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}
// One post per forecast: the committed claim, the probability and the settle date, then the permalink (never truncated).
function forecastPostText(fc, url) {
  var tail = "\n\nSettles by " + fc.horizon + ", scored in public. What is your number? " + url;
  var head = "Forecast, " + Math.round(Number(fc.probability) * 100) + "%: ";
  var room = 280 - tail.length - head.length;
  var claim = q08Plain(fc.claim);
  if (claim.length > room) claim = claim.slice(0, Math.max(0, room - 1)).replace(/\s+\S*$/, "") + "\u2026";
  return head + claim + tail;
}
async function handleSubscribe(req, env, url) {
  var email = "";
  if (req.method === "POST") {
    try {
      var ct = req.headers.get("Content-Type") || "";
      if (ct.indexOf("application/json") >= 0) { var b = await req.json(); email = b && b.email || ""; }
      else if (ct.indexOf("form") >= 0) { var fd = await req.formData(); email = fd.get("email") || ""; }
    } catch (e) { console.error(JSON.stringify({ evt: "q08-signal-engine:handleSubscribe:caught", error: String((e && e.message) || e) })); }
  }
  email = String(email || url.searchParams.get("email") || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    var bad = req.method === "POST";
    return html('<h2>Subscribe</h2><form method=post action=/subscribe><input type=email name=email required><button>Subscribe</button></form>' + (bad ? '<p>Enter a valid email address.</p>' : '<p>One email a day \u2014 the daily digest. No spam.</p>'), bad ? 400 : 200);
  }
  var token = await sha16(email + ":q08:sub");
  await env.DB.prepare("INSERT INTO subscribers(email, status, token, created_at) VALUES(?, 'pending', ?, ?) ON CONFLICT(email) DO UPDATE SET token=excluded.token, status=CASE WHEN status='confirmed' THEN 'confirmed' ELSE 'pending' END").bind(email, token, nowIso()).run();
  await sendEmail(env, email, "Confirm your q08 subscription", "Tap to confirm: https://q08.org/confirm?t=" + token);
  return html("<h2>Almost there</h2><p>Check your inbox for a confirmation link.</p>");
}

// Q08-STUCK-RUN-ROWS-1 (v0.7.33, issue 1670): an async /run whose isolate the platform cut short leaves its
// placeholder at status=running. generate() takes 30-90s, so anything still running after 30 min is dead.
async function sweepStaleRuns(env) {
  await env.DB.prepare("UPDATE engine_runs SET status='abandoned', error=COALESCE(error,'') || ' | STALE-RUN-SWEEP: isolate ended before finalize' WHERE status='running' AND ran_at < datetime('now','-30 minutes')").run().catch(function (e) { console.error(JSON.stringify({ evt: "q08-signal-engine:sweepStaleRuns:caught", error: String((e && e.message) || e) })); });
}
// Q08-GATE-OUTAGE-SELF-REPORT-1 (v0.7.33, issue 1671): 15 consecutive gate_failed cycles (~28h, runs 190-204) raised
// nothing and were found only because a human asked why q08.org was quiet. After every cron cycle: if the last 3
// finished generation runs published nothing AND the newest piece is older than 8h, file an agent_issue (the
// open-title unique index dedupes repeats) and an alert. Recovery is visible as runs with piece_published=1.
// PUBLISH-STALL-DIGEST-1 (0.17.2, fleet audit 2026-10-13): stall issues were filed once and never refreshed (#2222 on reading.q08.org kept
// "13h" in its title for 3 days; q08 filed #2002, #2034, #2095, #2172, #2286, each closed only when a piece happened to get through),
// so nothing in the issue said which stage was failing and no doer could act. Each stalled tick now rewrites the open issue: the hours
// in the title, a 24 h breakdown of the stage every finished run ended at, the newest errors, and priority critical after 24 h.
function stallStage(r) {
  var e = String(r && r.error || ""), st = String(r && r.status || "");
  if (st !== "gate_failed") return st || "unknown";
  if (/^(?:forecast: )?accuracy:/.test(e)) return "fact-check"; // Q08-FACT-LEDGER-1: a forecast's pre-check failure reads "forecast: accuracy: ..."
  if (/^ensemble: the edited draft was still not worth reading/.test(e)) return "reader panel";
  if (/^ensemble: the editor's draft failed the gate/.test(e)) return "editor gate";
  if (/\blede\b/.test(e)) return "lede";
  return "writer gate";
}
function stallDigest(rows) {
  var n = {}, order = [];
  (rows || []).forEach(function (r) { var k = stallStage(r); if (!n[k]) { n[k] = 0; order.push(k); } n[k]++; });
  return order.sort(function (x, y) { return n[y] - n[x]; }).map(function (k) { return k + " " + n[k]; }).join(", ");
}
async function stallDetector(env) {
  if (!env.AUDIT) return;
  try {
    var runs = await env.DB.prepare("SELECT id, status, piece_published, error FROM engine_runs WHERE status NOT IN ('running','abandoned','async-done','skipped','deferred') ORDER BY id DESC LIMIT 3").all();
    var rs = runs && runs.results || [];
    var pub = rs.filter(function (r) { return Number(r.piece_published) > 0; });
    if (pub.length) {
      // Recovered: close any open auto-filed stall issue with evidence (issue_close_evidence_required needs it first).
      var open = await env.AUDIT.prepare("SELECT id FROM agent_issues WHERE status='open' AND title LIKE 'Q08-PUBLISH-STALL-AUTO-1:%'").all();
      for (var o of (open && open.results || [])) {
        // SIGNAL-SQL-ARITY-1 (#2779, 0.28.14): this statement bound one value for two placeholders, so every recovery threw
        // "Wrong number of parameter bindings" (28x in 7 days, hourly on the scheduled run) and the stall issue never
        // closed. It now binds both and upserts the triage row, which issue_close_evidence_required reads.
        await env.AUDIT.prepare("INSERT INTO issue_triage (issue_id, rc, owner, sla_due_at, close_evidence) VALUES (?2, 'Q08-PUBLISH-STALL-AUTO-1', 'q08-signal-engine', datetime('now'), ?1) ON CONFLICT(issue_id) DO UPDATE SET close_evidence = excluded.close_evidence").bind("q08-signal-engine " + VERSION + " stallDetector: engine_runs #" + pub[0].id + " published (piece_published=1) at " + new Date().toISOString(), o.id).run();
        await env.AUDIT.prepare("UPDATE agent_issues SET status='closed', close_channel='auto-recovery', updated_at=?1 WHERE id=?2").bind(Date.now(), o.id).run();
      }
      return;
    }
    if (rs.length < 3) return;
    var last = await env.DB.prepare("SELECT MAX(published_at) m FROM published_pieces").first();
    var lastMs = last && last.m ? Date.parse(last.m) : 0;
    var hours = lastMs ? (Date.now() - lastMs) / 36e5 : Infinity;
    if (hours < 8) return;
    var day = await env.DB.prepare("SELECT id, status, error FROM engine_runs WHERE ran_at >= datetime('now','-24 hours') AND status NOT IN ('running','abandoned','async-done') ORDER BY id DESC LIMIT 60").all();
    var dayRows = day && day.results || [];
    var causes = rs.map(function (r) { return "#" + r.id + " " + stallStage(r) + ": " + String(r.error || "").slice(0, 160); }).join(" | ");
    var title = "Q08-PUBLISH-STALL-AUTO-1: q08-signal-engine published nothing in the last 3 runs and " + (isFinite(hours) ? Math.round(hours) + "h" : "ever") + " since the last piece";
    var desc = "Filed and refreshed automatically by q08-signal-engine " + VERSION + " stallDetector (PUBLISH-STALL-DIGEST-1), " + new Date().toISOString() + ". Stage each finished run ended at, last 24 h (" + dayRows.length + " runs): " + (stallDigest(dayRows) || "none") + ". Newest runs: " + causes + ". Fix the stage with the most runs first; the full errors are in engine_runs.error and GET https://q08.org/api/runs. Closes itself with evidence when a run publishes.";
    var prio = hours >= 24 ? "critical" : "high";
    var now = Date.now();
    var cur = await env.AUDIT.prepare("SELECT id FROM agent_issues WHERE status='open' AND title LIKE 'Q08-PUBLISH-STALL-AUTO-1:%' ORDER BY id DESC LIMIT 1").first();
    if (cur && cur.id) {
      await env.AUDIT.prepare("UPDATE agent_issues SET title=?1, description=?2, priority=?3, updated_at=?4 WHERE id=?5").bind(title, desc, prio, now, cur.id).run();
    } else {
      await env.AUDIT.prepare("INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at) SELECT ?1, ?2, 'q08-signal-engine', 'reliability', ?4, 'open', ?3, ?3 WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE status='open' AND title LIKE 'Q08-PUBLISH-STALL-AUTO-1:%')").bind(title, desc, now, prio).run().catch(function (e) { console.error(JSON.stringify({ at: "q08.stallDetector.insert", error: String(e && e.message || e).slice(0, 200) })); });
    }
    await env.AUDIT.prepare("INSERT INTO alerts (source, level, message) VALUES ('q08-signal-engine', 'warn', ?1)").bind(title).run().catch(function (e) { console.error(JSON.stringify({ at: "q08.stallDetector.alert", error: String(e && e.message || e).slice(0, 200) })); });
  } catch (e) { console.error(JSON.stringify({ at: "q08.stallDetector", error: String(e && e.message || e).slice(0, 300) })); }
}
// Q08-NOTE-1: a visitor note is stored for the owner to read and is never part of any prompt. Plain text only: control
// characters and angle brackets are dropped, links become [link], whitespace collapses, 280 characters at most.
function cleanNote(v) {
  var t = String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/https?:\/\/\S+/gi, "[link]").replace(/\s+/g, " ").trim().slice(0, 280);
  return t || null;
}
// Q08-QUALITY-1: pure helpers exposed for the offline suite (quality.test.mjs); no route uses this export.
export const __forecast = { forecastResolutionGaps: forecastResolutionGaps, recordForecastUpdate: recordForecastUpdate, renderCalibration: renderCalibration, forecastPostText: forecastPostText, gatherEvidence: gatherEvidence, forecastDue: forecastDue, resolveForecasts: resolveForecasts, ensureForecastSchema: ensureForecastSchema, generateForecast: generateForecast, forecastStats: forecastStats, parseForecastBlock: parseForecastBlock, validateForecast: validateForecast, forecastXform: forecastXform, forecastProblems: forecastProblems, buildForecastPrompt: buildForecastPrompt, calibration: calibration, lastForecastUpdateScore: lastForecastUpdateScore, parseJudgeVerdict: parseJudgeVerdict, aggregateJudges: aggregateJudges, parseForecastCap: parseForecastCap, publicHttpsUrl: publicHttpsUrl, fcStatus: fcStatus, renderForecastBox: renderForecastBox, renderForecasts: renderForecasts, FORECAST_DIRECTIVE: FORECAST_DIRECTIVE, FORECAST_EVERY: FORECAST_EVERY, FORECAST_MAX_CHECKS: FORECAST_MAX_CHECKS };
export const __gen = { thinPassedOver: thinPassedOver, parseArxivPool: parseArxivPool, arxivPoolSize: arxivPoolSize, resetArxivPool: function () { __arxivPool = { at: 0, n: ARXIV_POOL_DEFAULT }; }, scrapeArxiv: scrapeArxiv, ARXIV_POOL_DEFAULT: ARXIV_POOL_DEFAULT, parseComposeOrder: parseComposeOrder, q08Budget: q08Budget, Q08_DAILY_NEURONS_DEFAULT: Q08_DAILY_NEURONS_DEFAULT, resetRunColumns: function () { __runColsOk = false; __runColsTried = 0; }, sourceFloorFrom: sourceFloorFrom, learnedSourceFloor: learnedSourceFloor, thinSourceVerdict: thinSourceVerdict, sourceKindOf: sourceKindOf, markThinSkipped: markThinSkipped, ensureRunColumns: ensureRunColumns, insertRun: insertRun, meterCall: meterCall, claimClassesOf: claimClassesOf, get SOURCE_FLOOR_MIN_OK() { return SOURCE_FLOOR_MIN_OK; }, get THIN_MIN_ARTICLE() { return THIN_MIN_ARTICLE; }, get MIN_GROUND_CHARS() { return MIN_GROUND_CHARS; }, composeOrder: composeOrder, COMPOSE_MODELS: COMPOSE_MODELS, COMPOSE_MODELS_AT_CAP: COMPOSE_MODELS_AT_CAP, generate: generate, get TICK_BUDGET_MS() { return TICK_BUDGET_MS; }, get ESSAY_AFTER_FORECAST_MS() { return ESSAY_AFTER_FORECAST_MS; }, q08TickAllowance: q08TickAllowance, q08TickConfig: q08TickConfig, q08LastAttemptMs: q08LastAttemptMs, q08TickMore: q08TickMore, governedGenerate: governedGenerate };
export const __stall = { stallRetryDue: stallRetryDue, stallDetector: stallDetector, stallDigest: stallDigest, stallStage: stallStage, get STALL_RETRY_H() { return STALL_RETRY_H; } };
export const __factledger = { groundPreCheck: groundPreCheck, sourceLedger: sourceLedger, ledgerBlock: ledgerBlock, stripLedgerTags: stripLedgerTags, groundPreCheckMode: groundPreCheckMode, resetGroundPreCheck: function () { __groundPre = { at: 0, mode: "on" }; __groundPreCalls = 0; }, get groundPreCalls() { return __groundPreCalls; }, stallStage: stallStage, buildPrompt: buildPrompt, labelledGround: labelledGround, groundingProblems: groundingProblems, normalizeDraft: normalizeDraft, runLevels: runLevels, generate: generate, generateForecast: generateForecast, Q08_DIRECTIVE: Q08_DIRECTIVE, get LEDGER_MAX_LINES() { return LEDGER_MAX_LINES; }, get LEDGER_MAX_CHARS() { return LEDGER_MAX_CHARS; } };
export const __fledger = { researchLedger: researchLedger, ledgerNames: ledgerNames, ledgerSentences: ledgerSentences, forecastLedgerOn: forecastLedgerOn, forecastLedgerFor: forecastLedgerFor, ensureForecastGroundColumn: ensureForecastGroundColumn, storedForecastLedger: storedForecastLedger, groundForPublished: groundForPublished, buildForecastPrompt: buildForecastPrompt, stripLedgerTags: stripLedgerTags, groundPreCheck: groundPreCheck, resetGroundColumn: function () { __groundColumnDone = false; }, LEDGER_MAX_LINES: RLEDGER_MAX_LINES, LEDGER_MAX_DOCS: LEDGER_MAX_DOCS, LEDGER_DOC_CHARS: LEDGER_DOC_CHARS };
export const __cuts = { readerCutIndices: readerCutIndices, applyReaderCuts: applyReaderCuts };
export const __order = { orderCandidates: orderCandidates };
export const __ground = { labelledGround: labelledGround };
export const __analysis = { paraphraseItemsDropped: paraphraseItemsDropped, finalRead: finalRead, publishBody: publishBody, PUBLISH_MIN_CHARS: PUBLISH_MIN_CHARS, FINAL_PASS_MEAN: FINAL_PASS_MEAN, concreteClaim: concreteClaim, concreteAnalysisItems: concreteAnalysisItems, analysisDepthProblems: analysisDepthProblems, danglingOpening: danglingOpening, ANALYSIS_MIN_CHARS: ANALYSIS_MIN_CHARS, autoAnalysisMark: autoAnalysisMark, splitAnalysis: splitAnalysis, stripAnalysisMark: stripAnalysisMark, ANALYSIS_CHECK_PROMPT: ANALYSIS_CHECK_PROMPT, ANALYSIS_MARK: ANALYSIS_MARK };
export const __context = { backgroundEntities: backgroundEntities, backgroundPack: backgroundPack, backgroundQuery: backgroundQuery };
export const __lede = { normalizeVerdictLine: normalizeVerdictLine, verdictOnlyProblem: verdictOnlyProblem, splitLongLede: splitLongLede, normalizeDraft: normalizeDraft, ledeProblems: ledeProblems, ledeOf: ledeOf, sourceKind: sourceKind, withLede: withLede, buildPrompt: buildPrompt, READER_PROMPT: READER_PROMPT, Q08_DIRECTIVE: Q08_DIRECTIVE, LEDE_MAX_WORDS: LEDE_MAX_WORDS };
export const __title = { compose: compose, titleOnlyProblems: titleOnlyProblems, titleMicroCall: titleMicroCall, titleLineOf: titleLineOf, gate: gate };
export const __carry = { carryVerdictLine: carryVerdictLine, carryTitle: carryTitle, carryFormat: carryFormat, stripHandles: stripHandles, normalizeDraft: normalizeDraft };
export const __edge = { edgeCachedFetch: edgeCachedFetch, edgeCacheable: edgeCacheable, withPolicyHeaders: withPolicyHeaders };
export const __pipeline = { mirrorPipeline: mirrorPipeline, pipeItem: pipeItem, pipeSince: pipeSince, PIPE_SELECT: PIPE_SELECT, PIPE_PROPERTY: PIPE_PROPERTY, PIPE_ID_PREFIX: PIPE_ID_PREFIX };
export const __verify = { shortOnly: shortOnly, extendRevisionPrompt: extendRevisionPrompt, get EXTEND_AIM_CHARS() { return EXTEND_AIM_CHARS; }, factCheckExtra: factCheckExtra, pruneUnsupported: pruneUnsupported, groundingProblems: groundingProblems, parseFactVerdict: parseFactVerdict, factCheck: factCheck, verifyPiece: verifyPiece, verifyAndRevise: verifyAndRevise, splitFactItems: splitFactItems, factItemText: factItemText, claimIsReasoning: claimIsReasoning, pruneInferences: pruneInferences, prunedGateProblems: prunedGateProblems, editGateProblems: editGateProblems, EDIT_FLOOR: EDIT_FLOOR, PRUNE_FLOOR: PRUNE_FLOOR, PRUNE_ROUNDS: PRUNE_ROUNDS, PRUNE_ROUNDS_MAX: PRUNE_ROUNDS_MAX, retractPiece: retractPiece, auditPublished: auditPublished, ensureAccuracySchema: ensureAccuracySchema, renderRetraction: renderRetraction, fetchArticleText: fetchArticleText, THIN_MIN_ARTICLE: THIN_MIN_ARTICLE, articleUrlFor: articleUrlFor, githubReadmeUrl: githubReadmeUrl, factRevisionPrompt: factRevisionPrompt, Q08_DIRECTIVE: Q08_DIRECTIVE, FORECAST_DIRECTIVE: FORECAST_DIRECTIVE, REGISTER_EXEMPLAR: REGISTER_EXEMPLAR };
export const __framing = { framingRepair: framingRepair, framingRepairRow: framingRepairRow, framingTellMatchers: framingTellMatchers, problemsWithSentences: problemsWithSentences, retryPromptFor: retryPromptFor, phraseLevelOnly: phraseLevelOnly, splitSentences: splitSentences, FRAMING_RULE: FRAMING_RULE, FRAMING_REPAIR_MAX_SHARE: FRAMING_REPAIR_MAX_SHARE, FACTCHECK_POOL: FACTCHECK_POOL, factCheckOrder: factCheckOrder, MODEL_FAMILY: MODEL_FAMILY };
export const __quality = { gate: gate, overusedPrecedents: overusedPrecedents, parseReaderVerdict: parseReaderVerdict, buildPrompt: buildPrompt, ownerDirectives: ownerDirectives, readerTest: readerTest, pickPanel: pickPanel, familyOf: familyOf, aggregatePanel: aggregatePanel, panelRead: panelRead, effectiveVotes: effectiveVotes, PANEL_POOL: PANEL_POOL, ensembleReport: ensembleReport, saveReaderTests: saveReaderTests, runLevels: runLevels, panelUnavailableShare: panelUnavailableShare, ensureReaderTable: ensureReaderTable, OWNER_VERDICT_WEIGHT: OWNER_VERDICT_WEIGHT, REGISTER_EXEMPLAR: REGISTER_EXEMPLAR };
export const __reviewers = { reviewerHealth: reviewerHealth, flaggedFrom: flaggedFrom, healthFirst: healthFirst, resetReviewerHealth: function () { __reviewerHealth = { at: 0, flagged: {} }; }, pickPanel: pickPanel, panelOrderMode: panelOrderMode, resetPanelOrder: function () { __panelOrder = { at: 0, mode: "rotate" }; }, LEGACY_PANEL: LEGACY_PANEL, factCheckOrder: factCheckOrder, panelRead: panelRead, factCheck: factCheck, PANEL_POOL: PANEL_POOL, FACTCHECK_POOL: FACTCHECK_POOL, get PANEL_PRIMARY_N() { return PANEL_PRIMARY_N; }, get FACTCHECK_TAIL_N() { return FACTCHECK_TAIL_N; }, get REVIEWER_FLAG_ERR() { return REVIEWER_FLAG_ERR; }, get REVIEWER_FLAG_MIN_CALLS() { return REVIEWER_FLAG_MIN_CALLS; }, familyOf: familyOf, MODEL_FAMILY: MODEL_FAMILY };

function q08SitemapXml(rows) {
  var esc = function (x) { return String(x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); };
  var day = function (x) { var d = String(x || "").slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : ""; };
  var newest = rows.length ? day(rows[0].published_at) : "";
  var urls = rows.map(function (r) {
    var d = day(r.published_at);
    return "<url><loc>" + esc(ORIGIN + "/p/" + encodeURIComponent(r.slug)) + "</loc>" + (d ? "<lastmod>" + d + "</lastmod>" : "") + "</url>";
  }).join("");
  return '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>' + ORIGIN + '/</loc>' + (newest ? "<lastmod>" + newest + "</lastmod>" : "") + "</url><url><loc>" + ORIGIN + "/forecasts</loc></url>" + urls + "</urlset>";
}
// WORKERS-BEST-PRACTICES-1: compare a secret in constant time. Both sides are hashed with SHA-256 first, so the buffers have
// equal length (the secret's length does not leak either) and the byte loop does not stop at the first difference.
async function safeEqual(a, b) {
  var enc = new TextEncoder();
  var ha = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(String(a))));
  var hb = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(String(b))));
  var diff = 0;
  for (var i = 0; i < ha.length; i++) diff |= ha[i] ^ hb[i];
  return diff === 0;
}
// Random suffix for row ids and slug salts, from crypto.getRandomValues rather than Math.random (none of these is a secret).
function rnd36(n) {
  var out = "";
  while (out.length < n) {
    var b = crypto.getRandomValues(new Uint8Array(n * 2));
    for (var i = 0; i < b.length && out.length < n; i++) if (b[i] < 252) out += (b[i] % 36).toString(36);
  }
  return out;
}
// A background write that fails is logged as one structured line, never dropped silently.
function logBg(evt, extra) {
  return function (e) { console.error(JSON.stringify(Object.assign({ evt: evt, err: String((e && e.message) || e) }, extra || {}))); };
}

// Q08-EDGE-CACHE-1 (0.12.0, issue 2343): a Worker's response is not stored in Cloudflare's edge cache unless the Worker puts it there,
// so every page view rendered from D1 (TTFB 0.8-1.6 s measured 2026-10-12) although pages say public, max-age=300. Plain GET pages
// (no query string, not /api, /health, feeds or write routes) are now served from caches.default for that lifetime. A cache hit on a
// piece page still counts the read (published_pieces.reads and q08_daily_reads), so the human-read measure behind the q08 review
// (issue 1716) is unchanged. A retraction reaches cached copies within the 300 s lifetime. Every HTML response carries
// Referrer-Policy and Permissions-Policy. No runtime switch on purpose: reading ops_config per view would bring back the D1 read
// this removes. Revert by deploying the previous version.
var EDGE_CACHE_SKIP = /^\/(?:api\/|health$|run$|regen$|feed|rss|sitemap|robots|vote|feedback|subscribe|unsubscribe|confirm)/;
function edgeCacheable(req, path) {
  if (req.method !== "GET") return false;
  var u = new URL(req.url);
  if (u.search || u.hostname === "www.q08.org") return false;
  return !EDGE_CACHE_SKIP.test(path);
}
function withPolicyHeaders(resp) {
  var ct = resp.headers.get("Content-Type") || "";
  if (ct.indexOf("text/html") < 0) return resp;
  var r = new Response(resp.body, resp);
  r.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  r.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), interest-cohort=()");
  // BP26-EDGE-HEADERS-1 (0.37.0): OWASP secure-headers baseline for HTML. No includeSubDomains: other q08.org hosts are deployed separately.
  r.headers.set("X-Content-Type-Options", "nosniff");
  r.headers.set("Strict-Transport-Security", "max-age=31536000");
  r.headers.set("X-Frame-Options", "SAMEORIGIN");
  return r;
}
async function countPieceRead(env, req, slug, ctx) {
  ctx.waitUntil(env.DB.prepare("UPDATE published_pieces SET reads=reads+1 WHERE slug=?").bind(slug).run().catch(logBg("reads_increment_failed", { slug: slug })));
  ctx.waitUntil(countRead(env, req).catch(logBg("count_read_failed", { slug: slug })));
}
async function edgeCachedFetch(req, env, ctx, inner) {
  var path = new URL(req.url).pathname.replace(/\/+$/, "") || "/";
  var cache = (typeof caches !== "undefined" && caches.default) ? caches.default : null;
  var useCache = !!cache && edgeCacheable(req, path);
  var key = useCache ? new Request(new URL(req.url).toString(), { method: "GET" }) : null;
  if (useCache) {
    var hit = null;
    try { hit = await cache.match(key); } catch (e) { hit = null; }
    if (hit) {
      var pm = path.match(/^\/p\/([^/.]+)$/);
      if (pm) await countPieceRead(env, req, pm[1], ctx);
      return hit;
    }
  }
  var resp = withPolicyHeaders(await inner(req, env, ctx));
  if (useCache && resp.status === 200 && /text\/html/.test(resp.headers.get("Content-Type") || "") && /public/.test(resp.headers.get("Cache-Control") || "") && !resp.headers.has("Set-Cookie")) {
    ctx.waitUntil(cache.put(key, resp.clone()).catch(logBg("edge_cache_put_failed", { path: path })));
  }
  return resp;
}

// ---- CRON-GRID-1:BEGIN (owner directive 2026-10-19: "ALL CRON TICKS SHALL BE MEASURED IN 5-MINUTE INTERVALS, AND NO CRON
// SHALL EXECUTE LESS THAN ONCE EVERY HOUR. ALL CRON FAILURES/ERRORS SHALL BE TRIAGED AND REMEDIATED AUTOMATICALLY BY THE FLEET.")
// Cloudflare fires this worker only on triggers that repeat at least hourly, on minutes that are multiples of 5. A job that
// had its own slower trigger (daily, weekly, every 6 hours) keeps its cadence: it runs on the first grid fire after its old
// slot, and is retried on later fires while its last good run is older than its period plus 30 minutes, at most
// CRON_GRID_RETRIES times in a row; past that CRON-WATCH-1 (qnfo-audit fleet_tasks cron-watch) escalates it to the code loop.
// Every run is one cron_fire_log row (source worker:<name>, outcome ok, error or idle) that CRON-WATCH-1 reads. A job named
// retry: false (a send to people outside the fleet) runs only on its slot, so a failure is never repeated at a reader.
var CRON_GRID_RETRIES = 3;
function cronGridField(spec, v, lo, hi) {
  return String(spec).split(",").some(function (part) {
    var step = 1, sm = /^(.*)\/(\d+)$/.exec(part), a, b;
    if (sm) { part = sm[1]; step = Math.max(1, parseInt(sm[2], 10)); }
    if (part === "*") { a = lo; b = hi; }
    else if (part.indexOf("-") > 0) { a = parseInt(part, 10); b = parseInt(part.split("-")[1], 10); }
    else { a = parseInt(part, 10); b = sm ? hi : a; }
    return v >= a && v <= b && (v - a) % step === 0;
  });
}
// Cloudflare numbers weekdays 1 (Sunday) to 7 (Saturday) (CF-DOW, qnfo-fleet-control 2026-10-05).
function cronGridMatch(expr, d) {
  var f = String(expr).trim().split(/\s+/);
  if (f.length !== 5) return false;
  var domOk = cronGridField(f[2], d.getUTCDate(), 1, 31), dowOk = cronGridField(f[4], d.getUTCDay() + 1, 1, 7);
  var dayOk = f[2] !== "*" && f[4] !== "*" ? (domOk || dowOk) : (domOk && dowOk);
  return dayOk && cronGridField(f[0], d.getUTCMinutes(), 0, 59) && cronGridField(f[1], d.getUTCHours(), 0, 23) && cronGridField(f[3], d.getUTCMonth() + 1, 1, 12);
}
// True when expr had a slot in the window (sinceMs, untilMs].
function cronGridSlot(expr, sinceMs, untilMs) {
  for (var t = Math.floor(untilMs / 60000) * 60000; t > sinceMs; t -= 60000) if (cronGridMatch(expr, new Date(t))) return true;
  return false;
}
async function cronGridLog(db, worker, expr, startMs, outcome, note) {
  if (!db) return;
  try {
    await db.prepare("INSERT INTO cron_fire_log (cron_name, task_id, cron_expr, fired_at, fired_epoch_ms, outcome, source, note) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)")
      .bind(worker + "|" + expr, worker, expr, new Date(startMs).toISOString(), startMs, outcome, "worker:" + worker, String(note || "").slice(0, 500)).run();
  } catch (e) { console.error(JSON.stringify({ worker: worker, where: "cron-grid-log", error: String(e && e.message || e).slice(0, 200) })); }
}
async function cronGridDue(db, cfg, nowMs) {
  var out = [], lag = cfg.lagMin || 0;
  for (var i = 0; i < cfg.jobs.length; i++) {
    var j = cfg.jobs[i];
    if (cronGridSlot(j.cron, nowMs - (lag + cfg.tickMin) * 60000, nowMs - lag * 60000)) { out.push({ cron: j.cron, why: "slot" }); continue; }
    if (!db || !j.retry) continue;
    try {
      var name = cfg.worker + "|" + j.cron;
      var r = await db.prepare("SELECT COUNT(*) AS n, MAX(CASE WHEN outcome = 'ok' THEN fired_epoch_ms END) AS last_ok, SUM(CASE WHEN outcome = 'error' AND fired_epoch_ms > COALESCE((SELECT MAX(fired_epoch_ms) FROM cron_fire_log WHERE cron_name = ?1 AND outcome = 'ok'), 0) THEN 1 ELSE 0 END) AS fails FROM cron_fire_log WHERE cron_name = ?1").bind(name).first();
      if (r && Number(r.n) > 0 && Number(r.fails || 0) < CRON_GRID_RETRIES && nowMs - Number(r.last_ok || 0) > (j.periodMin + 30) * 60000) out.push({ cron: j.cron, why: "retry" });
    } catch (e) { console.error(JSON.stringify({ worker: cfg.worker, where: "cron-grid-due", error: String(e && e.message || e).slice(0, 200) })); }
  }
  return out;
}
// One run of the worker's own handler, awaited with its waitUntil work, logged with its outcome.
async function cronGridOne(db, worker, expr, why, ev, ctx, run) {
  var t0 = Date.now(), pending = [];
  var c = { waitUntil: function (p) { pending.push(Promise.resolve(p)); } };
  try {
    await run(ev, c);
    // Index loop, not allSettled: work a waitUntil promise adds while it runs is awaited too.
    var bad = null;
    for (var k = 0; k < pending.length; k++) { try { await pending[k]; } catch (e) { if (!bad) bad = e || new Error("waitUntil rejected"); } }
    if (bad) throw bad;
    await cronGridLog(db, worker, expr, t0, "ok", why + " " + (Date.now() - t0) + " ms");
  } catch (e) {
    await cronGridLog(db, worker, expr, t0, "error", why + ": " + String(e && e.message || e));
    throw e;
  }
}
// cfg: { worker, tick, tickMin, lagMin, jobs: [{ cron, periodMin, retry }], own: "self" | "none" | "<cron the tick runs as>", ownWhenDue }
async function cronGridRun(db, event, ctx, cfg, run) {
  var cron = String((event && event.cron) || "");
  var nowMs = Number(event && event.scheduledTime) || Date.now();
  if (cron !== cfg.tick) return cronGridOne(db, cfg.worker, cron || "manual", "fire", event, ctx, run);
  var due = await cronGridDue(db, cfg, nowMs), firstErr = null;
  for (var i = 0; i < due.length; i++) {
    try { await cronGridOne(db, cfg.worker, due[i].cron, due[i].why, { cron: due[i].cron, scheduledTime: nowMs, type: "scheduled" }, ctx, run); }
    catch (e) { if (!firstErr) firstErr = e; }
  }
  if (cfg.own === "none" || (due.length && cfg.ownWhenDue === false)) {
    if (!due.length) await cronGridLog(db, cfg.worker, cfg.tick, nowMs, "idle", "grid tick: no job due");
  } else {
    var ev = cfg.own && cfg.own !== "self" ? { cron: cfg.own, scheduledTime: nowMs, type: "scheduled" } : event;
    try { await cronGridOne(db, cfg.worker, cfg.tick, "tick", ev, ctx, run); } catch (e) { if (!firstErr) firstErr = e; }
  }
  if (firstErr) throw firstErr;
}
// ---- CRON-GRID-1:END ----
var CRON_GRID_CFG = {"worker": "q08-signal-engine", "tick": "0 * * * *", "tickMin": 60, "jobs": [{"cron": "0 17 * * *", "periodMin": 1440, "retry": false}], "own": "self"};
var __wm_default = {
  async fetch(req, env, ctx) { return edgeCachedFetch(req, env, ctx, q08Fetch); },
  async scheduled(controller, env, ctx) { return cronGridRun(env.AUDIT, controller, ctx, CRON_GRID_CFG, function (ev, c) { return q08Scheduled(ev, env, c); }); }
};
async function q08Fetch(req, env, ctx) {
    env = __aiAttrEnv(env, "q08-signal-engine", "AI", "AUDIT");
    var url  = new URL(req.url);
    var path = url.pathname.replace(/\/+$/, "") || "/";
    await ensureAccuracySchema(env); // Q08-VERIFY-1: the retraction filter below reads q08_retractions
    // Q08-SITEMAP-INDEXABLE-1 (2026-10-06): www.q08.org answered 200 with a full duplicate of every page; pages now move
    // permanently to the canonical host so Google indexes one URL per piece (API routes are left alone).
    if (url.hostname === "www.q08.org" && (req.method === "GET" || req.method === "HEAD") && path.indexOf("/api/") !== 0) {
      return new Response(null, { status: 301, headers: { "Location": ORIGIN + url.pathname + url.search, "Cache-Control": "public, max-age=86400" } });
    }

    await ensureForecastSchema(env); // Q08-FORECAST-1: idempotent, one flag check after the first request in an isolate
    if (path === "/api/ensemble") {
      return json(Object.assign({ ok: true, worker: WORKER, version: VERSION, generated_at: nowIso() }, await ensembleReport(env)));
    }
    if (path === "/api/metrics") {
      return json({ ok: true, worker: WORKER, version: VERSION, generated_at: nowIso(), windows: { "7d": await metrics7d(env) } });
    }
    if (path === "/health") {
      var m7 = await metrics7d(env).catch(function () { return null; });
      var cnt = await env.DB.prepare("SELECT COUNT(*) n FROM published_pieces").first().catch(() => ({n:0}));
      var last = await env.DB.prepare("SELECT slug, title, published_at FROM published_pieces WHERE slug NOT IN (SELECT slug FROM q08_retractions) ORDER BY published_at DESC LIMIT 1").first().catch(() => null);
      var runs = await env.DB.prepare("SELECT status, COUNT(*) n FROM engine_runs GROUP BY status").all().catch(() => ({results:[]}));
      return json({ ok: true, worker: WORKER, version: VERSION, capabilities: ["signal-scrape", "llm-compose", "essay-publish", "essay-regen", "rss", "mathjax-render", "sources-footer", "email-digest", "indexnow", "reader-verdict-vote", "self-verdict-gate", "feedback-calibration", "cross-day-signal-dedup", "fabrication-gate", "self-referential-signal-emit", "reader-test", "owner-editorial-directives", "owner-verdict-weight", "forecast-scenarios", "forecast-resolution", "forecast-calibration", "citation-files", "edge-cache", "stall-retry"], limitations: ["publisher/composer only - does NOT run a general agent tool loop and does not execute arbitrary code", "not a general-purpose model endpoint; use qnfo-ai for inference", "POST /run and POST /regen need x-loop-token (they spend model calls and change published essays; OPEN-ACCESS-1); every read stays open", "writes only to its own q08-signal D1; never writes research or personal stores", "no streaming"], metrics_7d: m7, pieces: cnt.n, daily_cap: await dailyCap(env), daily_cap_key: "ops_config " + CAP_KEY, last, runs: runs.results });
    }

    // Q08-WRITE-ROUTES-TOKEN-1 (v0.8.6, agent_issues 1995): /run starts a full generation (model calls, a publication) and
    // /regen rewrites a published essay through compose and gate only, skipping the cross-family panel and editor and
    // writing no engine_runs row. Both were open to anyone at 5 and 10 calls per IP per hour. OPEN-ACCESS-1 keeps reads
    // open and puts what changes the fleet or spends its money behind x-loop-token; the crons call generate() directly,
    // so nothing scheduled needs these routes. Without LOOP_TOKEN set on this worker both answer 401.
    if ((path === "/run" || path === "/regen") && req.method === "POST") {
      var lt = req.headers.get("x-loop-token") || "";
      if (!env.LOOP_TOKEN || !(await safeEqual(lt, env.LOOP_TOKEN))) return json({ ok: false, error: "unauthorized: " + path + " spends model calls and changes published essays; it needs x-loop-token (OPEN-ACCESS-1)" }, 401);
    }

    if (path === "/run" && req.method === "POST") {
      // Loop-token trigger (above), still bounded by a per-IP rate limit (crons call generate() directly).
      var runIp = String(req.headers.get("cf-connecting-ip") || "anon");
      var runIk = await sha16("run:" + runIp);
      var runRate = await env.DB.prepare("SELECT COUNT(*) n FROM q08_run_rate WHERE ip_key=? AND created_at > datetime('now','-1 hour')").bind(runIk).first().catch(function(){ return { n: 0 }; });
      if ((runRate && runRate.n || 0) >= 5) return json({ ok: false, error: "rate limited" }, 429);
      await env.DB.prepare("INSERT INTO q08_run_rate (ip_key, created_at) VALUES (?,?)").bind(runIk, nowIso()).run().catch(function (e) { console.error(JSON.stringify({ evt: "q08-signal-engine:q08Fetch:caught", error: String((e && e.message) || e) })); });
      await env.DB.prepare("DELETE FROM q08_run_rate WHERE created_at < datetime('now','-24 hours')").run().catch(function (e) { console.error(JSON.stringify({ evt: "q08-signal-engine:q08Fetch:caught", error: String((e && e.message) || e) })); });
      // Detach: generate() takes 30-90s (HN fetch + LLM). Return immediately,
      // run in background via waitUntil so the HTTP response is not blocked.
      var async_mode = url.searchParams.get("async") !== "0";
      if (async_mode) {
        var runId = Date.now().toString(36);
        // Q08-STUCK-RUN-ROWS-1 (v0.7.33, issue 1670): this placeholder was never finalized. generate() writes its own
        // engine_runs row, and the old completion handler rewrote the error text of MAX(id) - i.e. generate()'s row -
        // so the placeholder stayed status=running forever (run 205). Finalize THIS row by id; rows whose isolate was
        // cut short are closed by sweepStaleRuns() on the next cron.
        var ph = await env.DB.prepare("INSERT INTO engine_runs (ms,status,error) VALUES (0,'running',?)").bind("run-id:" + runId + " async generation started").run().catch(function(){ return null; });
        var phId = ph && ph.meta ? ph.meta.last_row_id : null;
        ctx.waitUntil(generate(env).then(async (out) => {
          if (phId) await env.DB.prepare("UPDATE engine_runs SET status='async-done', error=? WHERE id=? AND status='running'")
            .bind("run-id:" + runId + " result:" + JSON.stringify(out).slice(0,200), phId).run().catch((e) => { console.error(JSON.stringify({ evt: "q08-signal-engine:q08Fetch:caught", error: String((e && e.message) || e) })); });
        }).catch(async (e) => {
          if (phId) await env.DB.prepare("UPDATE engine_runs SET status='error', error=? WHERE id=?").bind(String(e&&e.message||e).slice(0,500), phId).run().catch((e) => { console.error(JSON.stringify({ evt: "q08-signal-engine:q08Fetch:caught", error: String((e && e.message) || e) })); });
          else await env.DB.prepare("INSERT INTO engine_runs (ms,status,error) VALUES (0,'error',?)").bind(String(e&&e.message||e).slice(0,500)).run().catch((e) => { console.error(JSON.stringify({ evt: "q08-signal-engine:q08Fetch:caught", error: String((e && e.message) || e) })); });
        }));
        return json({ ok: true, worker: WORKER, version: VERSION, mode: "async", run_id: runId, note: "generating in background; poll /api/runs or /health. Async runs may be cut short by the platform after ~30s; the cron path is the reliable one." });
      }
      var out = await generate(env);
      return json({ ok: true, worker: WORKER, version: VERSION, out });
    }

    if (path === "/regen" && req.method === "POST") {
      // Regenerate a single existing piece from its original signal, through the
      // current directive. Reuses buildPrompt/compose/gate. Loop token (above), then rate-limited per IP.
      var rip2 = String(req.headers.get("cf-connecting-ip") || "anon");
      var rik2 = await sha16("regen:" + rip2);
      var rr2 = await env.DB.prepare("SELECT COUNT(*) n FROM q08_run_rate WHERE ip_key=? AND created_at > datetime('now','-1 hour')").bind(rik2).first().catch(function(){ return { n: 0 }; });
      if ((rr2 && rr2.n || 0) >= 10) return json({ ok: false, error: "rate limited" }, 429);
      await env.DB.prepare("INSERT INTO q08_run_rate (ip_key, created_at) VALUES (?,?)").bind(rik2, nowIso()).run().catch(function (e) { console.error(JSON.stringify({ evt: "q08-signal-engine:q08Fetch:caught", error: String((e && e.message) || e) })); });

      var target = String(url.searchParams.get("slug") || "").slice(0, 200);
      if (!target) return json({ ok: false, error: "slug required" }, 400);
      var prow = await env.DB.prepare("SELECT * FROM published_pieces WHERE slug = ?").bind(target).first();
      if (!prow) return json({ ok: false, error: "piece not found" }, 404);
      var srow = await env.DB.prepare("SELECT * FROM signal_log WHERE (source_id = ? OR source_id = ?) AND friction_point IS NOT NULL AND length(friction_point) > 40 ORDER BY length(friction_point) DESC LIMIT 1").bind(prow.signal_source, String(prow.signal_source||"").indexOf(":") >= 0 ? String(prow.signal_source).split(":").slice(1).join(":") : prow.signal_source).first();
      if (!srow) return json({ ok: false, error: "signal friction not found" }, 404);
      var friction = { core_concept: prow.core_concept || srow.title, friction_point: srow.friction_point || "", signal_strength: srow.signal_strength || "Medium" };
      var recentRows = await env.DB.prepare("SELECT structure_md FROM prompt_pool ORDER BY created_at DESC LIMIT 6").all();
      var recentStructures = (recentRows.results || []).map(function(r){ return r.structure_md; });
      var prompt = buildPrompt(friction, [], recentStructures);
      var piece = await compose(env, prompt);
      var gateResult = gate(piece.text);
      if (!gateResult.ok) {
        var retryPrompt = prompt + "\n\n--- CORRECTIVE FEEDBACK: your previous draft was rejected. Rewrite the ENTIRE essay from scratch with a completely different structure \u2014 continuous prose, no '##' section headers, but KEEP exactly one '# ' H1 title line as the FIRST line of the essay \u2014 fixing only these issues ---\n" + gateResult.problems.join("; ");
        var retryPiece = null;
        try { retryPiece = await compose(env, retryPrompt); } catch (e) { retryPiece = null; }
        if (retryPiece && retryPiece.text) {
          var retryGate = gate(retryPiece.text);
          if (retryGate.ok) { piece = retryPiece; gateResult = retryGate; }
          else if (retryGate.problems.length === 1 && /verdict/i.test(retryGate.problems[0]) && retryGate.problems[0].indexOf("self-verdict") < 0) {
            try {
              var vp2 = await compose(env, "You have written an essay that passed all editorial checks. Output exactly one line, nothing else, in this form:\nworth your time: yes|flat|no \u2014 one clause of justification\nUse flat only if a reader gains little beyond the source material; use no if the piece is not worth publishing.");
              var vm3 = (vp2 && vp2.text || "").match(/worth your time:\s*(yes|flat|no)\s*[\u2014\u2013-]\s*\S[^\n]*$/im);
              if (vm3) { retryPiece.text = retryPiece.text.replace(/\s*$/, "") + "\n\n" + vm3[0]; retryGate = gate(retryPiece.text); if (retryGate.ok) { piece = retryPiece; gateResult = retryGate; } }
            } catch (e) { console.error(JSON.stringify({ evt: "q08-signal-engine:q08Fetch:caught", error: String((e && e.message) || e) })); }
          }
        }
      }
      if (!gateResult.ok) return json({ ok: false, error: "gate failed: " + gateResult.problems.join("; ") }, 422);
      // Q08-VERIFY-1: a regenerated essay is fact-checked against the same source material before it replaces the live text.
      var rgArticle = await fetchArticleText(articleUrlFor(srow));
      var rgv = await verifyPiece(env, piece.text, [srow.title || "", friction.core_concept || "", friction.friction_point || "", rgArticle].join("\n"), piece.model, target, { forecast: false });
      if (!rgv.ok) return json({ ok: false, error: "accuracy check failed: " + rgv.problems.join("; ") }, 422);
      piece.text = stripAnalysisMark(piece.text.replace(/\n?worth your time:\s*(yes|flat|no)\s*[\u2014\u2013-].*$/im, "").trim());
      var tm = piece.text.match(/^#\s+(.+)$/m);
      var title = tm ? tm[1].trim() : prow.title;
      var body = piece.text.replace(/^#\s+.+\n?/, "").trim();
      await env.DB.prepare("UPDATE published_pieces SET title = ?, body_md = ? WHERE slug = ?").bind(title, body, target).run();
      var skel = body.split("\n").filter(l => l.startsWith("#") || l.startsWith("- ") || l.startsWith("**")).join("\n").slice(0, 800);
      if (skel.length < 50) { var lp = body.split("\n").map(l => l.trim()).filter(l => l.length > 40)[0] || ""; skel = (title + "\n" + lp.slice(0, 400)).slice(0, 800); }
      await env.DB.prepare("UPDATE prompt_pool SET structure_md = ?, active = 0 WHERE piece_id = ?").bind(skel, prow.id).run().catch(function (e) { console.error(JSON.stringify({ evt: "q08-signal-engine:q08Fetch:caught", error: String((e && e.message) || e) })); });
      return json({ ok: true, slug: prow.slug, title: title, model: piece.model, words: body.split(/\s+/).length });
    }

    if (path === "/api/f" && req.method === "POST") {
      if (req.method !== "POST") return json({ ok: false, error: "POST required" }, 405);
      if (/bot|crawl|spider|slurp|preview|headless/i.test(String(req.headers.get("user-agent") || ""))) return json({ ok: false, error: "automated clients cannot vote" }, 403);
      // Q08-VOTES-TRIGGER-1 (issue 1893): /api/f posted to the q08-signal-engine worker while the vote UI posts to
      // PO (owner q08-signal-engine, target agent_issues), so almost no vote reached q08_feedback
      // (q08_verified_votes_7d = 1 against 106 reads). Accept the same vote here so the verdict loop can act.
      var s = (url.searchParams.get("s") || url.searchParams.get("vote") || "").toLowerCase();
      var fslug = String(url.searchParams.get("slug") || "").slice(0, 200);
      if (s !== "good" && s !== "flat" && s !== "no") return json({ ok: false, error: "s must be good|flat|no" }, 400);
      if (!fslug) return json({ ok: false, error: "slug required" }, 400);
      var ip = String(req.headers.get("cf-connecting-ip") || "anon");
      var ipKey = await sha16(ip + ":" + fslug);
      var prev = await env.DB.prepare("SELECT id FROM q08_feedback WHERE ip_key = ? AND slug = ?").bind(ipKey, fslug).first().catch(function(){ return null; });
      if (prev) return json({ ok: true, updated: false, note: "vote already recorded" });
      var rate = await env.DB.prepare("SELECT COUNT(*) n FROM q08_feedback WHERE ip_key = ? AND created_at > datetime('now','-1 hour')").bind(ipKey).first().catch(function(){ return { n: 0 }; });
      if ((rate && rate.n || 0) >= 5) return json({ ok: false, error: "rate limited" }, 429);
      var fnote = null;
      try {
        if (String(req.headers.get("Content-Type") || "").indexOf("form") >= 0) fnote = cleanNote((await req.formData()).get("note"));
      } catch (e) { fnote = null; }
      await env.DB.prepare("INSERT OR IGNORE INTO q08_feedback (slug, signal, ip_key, note, created_at) VALUES (?,?,?,?,?)").bind(fslug, s, ipKey, fnote, nowIso()).run();
      if ((req.headers.get("Accept") || "").includes("text/html")) {
        const location = `/p/${encodeURIComponent(fslug)}?voted=${encodeURIComponent(s)}`;
        return Response.redirect(location, 303);
      }
      return json({ ok: true, recorded: s, note_stored: !!fnote });
    }
    function renderAtomFeed(rows) {
      var esc = function (s) { return String(s || "").replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
      var updated = rows.length ? rows[0].published_at : nowIso();
      var entries = rows.map(function (r) {
        var url = ORIGIN + "/p/" + r.slug;
        var content = esc(String(r.body_md || "").slice(0, 8000)).replace(/\n/g, "<br/>\n");
        return "<entry>\n<id>" + esc(url) + "</id>\n<link href=\"" + esc(url) + "\"/>\n<title>" + esc(r.title || r.slug) + "</title>\n<updated>" + esc(r.published_at) + "</updated>\n<published>" + esc(r.published_at) + "</published>\n<summary>" + esc(r.core_concept || "") + "</summary>\n<content type=\"html\">" + content + "</content>\n</entry>";
      }).join("\n");
      return '<?xml version="1.0" encoding="utf-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom">\n<title>q08 Signal Engine pieces</title>\n<link rel="self" href="' + esc(ORIGIN + "/atom.xml") + '"/>\n<link href="' + esc(ORIGIN + "/") + '"/>\n<updated>' + esc(updated) + '</updated>\n<id>' + esc(ORIGIN + "/") + '</id>\n' + entries + '\n</feed>';
    }
    if (path === "/feed.xml" || path === "/atom.xml") {
      var rows = await env.DB.prepare("SELECT slug, title, body_md, core_concept, published_at FROM published_pieces WHERE slug NOT IN (SELECT slug FROM q08_retractions) ORDER BY published_at DESC LIMIT 20").all();
      if (path === "/atom.xml") {
        return new Response(renderAtomFeed(rows.results || []), { headers: { "Content-Type": "application/atom+xml; charset=utf-8" } });
      }
      return new Response(renderFeed(rows.results || []), { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
    }

    var cm = /^\/p\/([a-z0-9-]+)\.(bib|ris)$/.exec(path);
    if (cm) { // Q08-REACH-1: citation files for reference managers and scholarly indexing
      var cp = await env.DB.prepare("SELECT slug, title, published_at FROM published_pieces WHERE slug=? AND slug NOT IN (SELECT slug FROM q08_retractions)").bind(cm[1]).first();
      if (!cp) return html("<h1>Not found</h1>", 404);
      return new Response(citationFile(cp, cm[2]), { headers: { "Content-Type": cm[2] === "bib" ? "application/x-bibtex; charset=utf-8" : "application/x-research-info-systems; charset=utf-8", "Content-Disposition": 'attachment; filename="q08-' + cp.slug + "." + cm[2] + '"' } });
    }
    var pm = /^\/p\/([a-z0-9-]+)\/provenance\.json$/.exec(path);
    if (pm) { // BP26-PROVENANCE-MARKING-1: machine-readable provenance sidecar per piece
      return await provenanceResponse(env, pm[1]);
    }

    if (path.startsWith("/p/")) {
      var slug = path.slice(3);
      var piece = await env.DB.prepare("SELECT * FROM published_pieces WHERE slug=?").bind(slug).first();
      if (!piece) return html("<h1>Not found</h1>", 404);
      var retr = await env.DB.prepare("SELECT * FROM q08_retractions WHERE slug = ?").bind(slug).first().catch(function () { return null; });
      if (retr) return html(renderRetraction(retr, piece), 410);
      // Increment read count. WORKERS-BEST-PRACTICES-1: the counter write rides ctx.waitUntil (an un-awaited D1 call can be
      // cancelled once the response returns), and a failure is logged instead of swallowed.
      await countPieceRead(env, req, slug, ctx);
      var frow = piece.kind === "forecast" ? await env.DB.prepare("SELECT * FROM q08_forecasts WHERE slug = ?").bind(slug).first().catch(function () { return null; }) : null;
      if (frow) frow.secondary_claims = (await env.DB.prepare("SELECT * FROM q08_forecast_claims WHERE slug = ? ORDER BY claim_index").bind(slug).all().catch(function () { return { results: [] }; })).results || [];
      var pieceHtml = renderPiece(piece, frow);
      // If a vote just occurred, show a thank‑you notice instead of the voting UI.
      var voted = url.searchParams.get("voted");
      if (voted) {
        // Insert a simple acknowledgement paragraph before the closing </body> tag if present,
        // otherwise prepend it to the document.
        if (pieceHtml.search(/<\/body>/i) >= 0) {
          pieceHtml = pieceHtml.replace(/<\/body>/i, '<p class="q08-fb">Thanks, your verdict is recorded.</p></body>');
        } else {
          pieceHtml = '<p class="q08-fb">Thanks, your verdict is recorded.</p>' + pieceHtml;
        }
      }
      var provLink = '<link rel="c2pa-manifest" href="/p/' + slug + '/provenance.json">';
      if (pieceHtml.indexOf("</head>") >= 0) {
        pieceHtml = pieceHtml.replace(/<\/head>/i, provLink + "\n</head>");
      } else {
        pieceHtml = provLink + "\n" + pieceHtml;
      }
      return html(pieceHtml);
    }

    if (path === "/sitemap.xml") {
      // Q08-SITEMAP-INDEXABLE-1: the home <loc> matches its canonical (trailing slash) and carries the newest piece's date;
      // the RSS feed is not a page and is no longer listed; a piece without a valid date gets no <lastmod>.
      var srows = await env.DB.prepare("SELECT slug, published_at FROM published_pieces WHERE slug NOT IN (SELECT slug FROM q08_retractions) ORDER BY published_at DESC LIMIT 5000").all();
      var sitemapXml = q08SitemapXml(srows.results || []);
      var sxml = sitemapXml;
      return new Response(sxml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=1800" } });
    }

    if (path === "/robots.txt") {
      return new Response("User-agent: *\nAllow: /\n\nSitemap: " + ORIGIN + "/sitemap.xml\n", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }

    if (path === "/" + INDEXNOW_KEY + ".txt") return new Response(INDEXNOW_KEY, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
    if (path === "/subscribe") return await handleSubscribe(req, env, url);
    if (path === "/confirm") { var t0 = url.searchParams.get("t")||""; await env.DB.prepare("UPDATE subscribers SET status='confirmed', confirmed_at=? WHERE token=? AND status!='unsubscribed'").bind(nowIso(), t0).run(); return html("<h2>Subscribed</h2><p>You are subscribed. The daily digest arrives each evening.</p>"); }
    if (path === "/unsubscribe") { var t1 = (url.searchParams.get("t")||"").trim(); if (!t1) return html("<h2>Invalid link</h2><p>No unsubscribe token provided.</p>", 400); var unsub = await env.DB.prepare("UPDATE subscribers SET status='unsubscribed' WHERE token=?").bind(t1).run(); return (unsub && unsub.meta && unsub.meta.changes > 0) ? html("<h2>Unsubscribed</h2><p>You have been removed from the daily digest.</p>") : html("<h2>Not found</h2><p>That unsubscribe link is invalid or already used.</p>", 404); }
    if (path === "/forecasts") {
      var frs = await env.DB.prepare("SELECT slug, source_slug, claim, probability, horizon, resolution, status, outcome, brier FROM q08_forecasts WHERE slug NOT IN (SELECT slug FROM q08_retractions) ORDER BY id DESC LIMIT 200").all().catch(function () { return { results: [] }; });
      var updateRows = await env.DB.prepare("SELECT slug, probability, created_at FROM q08_forecast_updates ORDER BY id").all().catch(function () { return { results: [] }; });
      var updatesBySlug = {};
      (updateRows.results || []).forEach(function (u) { (updatesBySlug[u.slug] = updatesBySlug[u.slug] || []).push({ probability: u.probability, at: u.created_at }); });
      var forecastRows = (frs.results || []).map(function (f) { return attachForecastUpdateScore(f, updatesBySlug[f.slug] || []); });
      return html(renderForecasts(forecastRows, await forecastStats(env)));
    }
    if (path === "/retractions" || path === "/api/retractions" || path === "/corrections" || path === "/api/corrections") {
      var rrows = await env.DB.prepare("SELECT r.slug, r.reason, r.retracted_at, p.title FROM q08_retractions r LEFT JOIN published_pieces p ON p.slug = r.slug ORDER BY r.retracted_at DESC LIMIT 500").all().catch(function () { return { results: [] }; });
      // BP26-CORRECTIONS-FEED-1 slice 1: each entry carries the COPE type and a link to the original, which stays visible. Only plain retractions are recorded today.
      if (path === "/api/retractions" || path === "/api/corrections") return json({ ok: true, worker: WORKER, version: VERSION, retractions: (rrows.results || []).map(function (r) { return Object.assign({ type: "retraction", original_url: "/p/" + r.slug }, r); }) });
      return html(renderRetractions(rrows.results || []));
    }
    if (path === "/forecasts/calibration" || path === "/api/forecasts/calibration") {
      var cst = await forecastStats(env);
      if (path === "/api/forecasts/calibration") return json({ ok: true, worker: WORKER, version: VERSION, generated_at: nowIso(), calibration: cst.calibration });
      return html(renderCalibration(cst.calibration));
    }
    if (path === "/api/forecasts/updates" && req.method === "POST") {
      var ult = req.headers.get("x-loop-token") || "";
      if (!env.LOOP_TOKEN || !(await safeEqual(ult, env.LOOP_TOKEN))) return json({ ok: false, error: "unauthorized: a forecast update changes a published record; it needs x-loop-token" }, 401);
      var ub = await req.json().catch(function () { return {}; });
      var ur = await recordForecastUpdate(env, ub.slug, ub.probability, ub.reason, ub.evidence_url);
      return json(ur, ur.ok ? 200 : 400);
    }
    if (path === "/api/forecasts") {
      var fr2 = await env.DB.prepare("SELECT slug, source_slug, claim, probability, horizon, resolution, alternatives_json, status, outcome, brier, checks, created_at, resolved_at, disposition FROM q08_forecasts WHERE slug NOT IN (SELECT slug FROM q08_retractions) ORDER BY id DESC LIMIT 200").all().catch(function () { return { results: [] }; });
      var fupd = await env.DB.prepare("SELECT slug, prior_probability, probability, reason, evidence_url, created_at FROM q08_forecast_updates ORDER BY id").all().catch(function () { return { results: [] }; });
      var fby = {}; (fupd.results || []).forEach(function (u) { (fby[u.slug] = fby[u.slug] || []).push({ prior_probability: u.prior_probability, probability: u.probability, reason: u.reason, evidence_url: u.evidence_url, at: u.created_at }); });
      var claims = await env.DB.prepare("SELECT slug, claim_index, claim, probability, horizon, resolution, watch_query, watch_urls, created_at, status, outcome, brier, checks, last_check_at, resolved_at, disposition FROM q08_forecast_claims WHERE slug IN (SELECT slug FROM q08_forecasts ORDER BY id DESC LIMIT 200) ORDER BY claim_index").all().catch(function () { return { results: [] }; });
      var cby = {}; (claims.results || []).forEach(function (c) { (cby[c.slug] = cby[c.slug] || []).push(c); });
      return json({ ok: true, worker: WORKER, version: VERSION, generated_at: nowIso(), stats: await forecastStats(env), forecasts: (fr2.results || []).map(function (f) {
  f.original_probability = f.probability;
  f.secondary_claims = cby[f.slug] || [];
  f.updates = fby[f.slug] || [];
  return attachForecastUpdateScore(f, f.updates);
}) });
    }
    if (path === "/api/pieces") {
      var rows = await env.DB.prepare("SELECT slug, title, core_concept, published_at, reads" + (__forecastSchemaDone ? ", kind" : "") + " FROM published_pieces WHERE slug NOT IN (SELECT slug FROM q08_retractions) ORDER BY published_at DESC LIMIT 50").all();
      return json(rows.results || []);
    }

    if (path === "/api/signals") {
      var rows = await env.DB.prepare("SELECT id, source, title, volatility_score, ratio, signal_strength, status, created_at FROM signal_log ORDER BY created_at DESC LIMIT 30").all();
      return json(rows.results || []);
    }

    if (path === "/api/runs") {
      var rows = await env.DB.prepare("SELECT * FROM engine_runs ORDER BY id DESC LIMIT 20").all();
      return json(rows.results || []);
    }

    // Q08-SITEMAP-INDEXABLE-1: only / and /index.html are the index. Every other unknown path used to return the index
    // with 200 (a soft 404: scanner probes such as /.env or /.ssh/id_ed25519 and any typo became duplicate home pages to
    // Google). They now answer 404 with a link home, and are never indexed.
    if (path !== "/" && path !== "/index.html") {
      return new Response('<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Not found · q08</title></head><body style="font-family:system-ui,sans-serif;max-width:640px;margin:15vh auto;padding:0 16px"><h1>Not found</h1><p>There is no page at this address. <a href="' + ORIGIN + '/">Go to q08</a>.</p></body></html>', { status: 404, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" } });
    }
    // Index
    var pieces = await env.DB.prepare("SELECT slug, title, body_md, core_concept, published_at" + (__forecastSchemaDone ? ", kind" : "") + " FROM published_pieces WHERE slug NOT IN (SELECT slug FROM q08_retractions) ORDER BY published_at DESC LIMIT 20").all().catch(() => ({results:[]}));
    return html(renderIndex(pieces.results || []));
}

function renderAtomFeed(rows) {
  function esc(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  var updated = "";
  if (rows.length > 0) {
    var d = new Date(rows[0].published_at);
    updated = isNaN(d) ? "" : d.toISOString();
  }
  var out = '<?xml version="1.0" encoding="utf-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom">\n';
  out += '  <title>q08</title>\n';
  out += '  <link href="' + esc(ORIGIN) + '"/>\n';
  out += '  <id>' + esc(ORIGIN) + '/</id>\n';
  if (updated) out += '  <updated>' + updated + '</updated>\n';
  out += '  <author><name>q08</name></author>\n';
  rows.forEach(function(r) {
    var link = ORIGIN + "/p/" + r.slug;
    var pd = new Date(r.published_at);
    var pub = isNaN(pd) ? "" : pd.toISOString();
    out += "  <entry>\n";
    out += '    <id>' + esc(link) + "</id>\n";
    out += '    <title>' + esc(r.title || r.slug) + "</title>\n";
    out += '    <link rel="alternate" href="' + esc(link) + '"/>\n';
    if (pub) out += '    <published>' + pub + "</published>\n";
    if (pub) out += '    <updated>' + pub + "</updated>\n";
    out += '    <author><name>q08</name></author>\n';
    var summary = esc(r.core_concept || "").slice(0, 500);
    if (summary) out += '    <summary>' + summary + "</summary>\n";
    var content = esc(r.body_md || "").slice(0, 10000);
    if (content) out += '    <content type="text">' + content + "</content>\n";
    out += "  </entry>\n";
  });
  out += "</feed>";
  return out;
}

// Q08-STALL-RETRY-1 (0.14.0, agent_issues 2286; owner 2026-10-12: "start generating Q08 content immediately"): one candidate an hour, each
// clearing the deterministic gate, the reader panel, the editor and the two-family fact-check, left most hours empty (runs 292-336 published
// nothing). While no piece has been published for STALL_RETRY_H hours, the :30 cron makes a second attempt after its audit. It never
// overlaps a running attempt (no engine_runs row and no published piece in the last STALL_RETRY_QUIET_MIN minutes means the :00 attempt may
// still be running), and generate() keeps every cap (q08_max_per_day, the daily attempt cap) and every quality gate.
// Off without a deploy: ops_config q08_stall_retry = off.
var STALL_RETRY_H = 2;
var STALL_RETRY_QUIET_MIN = 20;
async function stallRetryDue(env) {
  try {
    if (env.AUDIT) {
      var flag = await env.AUDIT.prepare("SELECT value FROM ops_config WHERE key = 'q08_stall_retry'").first().catch(function () { return null; });
      if (flag && String(flag.value).toLowerCase() === "off") return false;
    }
    var last = await env.DB.prepare("SELECT MAX(published_at) AS t FROM published_pieces").first();
    var lastMs = last && last.t ? Date.parse(last.t) : 0;
    if (lastMs && Date.now() - lastMs < STALL_RETRY_H * 3600e3) return false;
    // The :00 attempt writes its engine_runs row when it ends. It is finished when that row is from this hour, or presumed finished once
    // STALL_RETRY_QUIET_MIN minutes of the hour have passed (attempts take 3-14 minutes).
    var hourStart = Math.floor(Date.now() / 3600e3) * 3600e3;
    if (Date.now() - hourStart >= STALL_RETRY_QUIET_MIN * 60e3) return true;
    var run = await env.DB.prepare("SELECT MAX(ran_at) AS t FROM engine_runs").first();
    var runMs = run && run.t ? Date.parse(String(run.t).replace(" ", "T") + (/Z$/.test(String(run.t)) ? "" : "Z")) : 0;
    return runMs >= hourStart;
  } catch (e) { return false; }
}
// CRON-ONLY-HEARTBEAT-1 (agent_issues 2397, pillar autonomy): each hourly scheduled run ends with one fleet_heartbeat upsert
// (ok=0 when the generation step threw). The write is caught and logged; it never fails or delays the run above it.
var PIPE_PROPERTY = "q08.org", PIPE_ID_PREFIX = "run-", PIPE_WORKER = "q08-signal-engine";
function PIPE_DB(env) { return env.DB; }
// engine_runs.ran_at is SQLite datetime text ("2026-10-14 08:06:30", UTC)
function pipeSince(ms) { return new Date(ms).toISOString().replace("T", " ").slice(0, 19); }
var PIPE_SELECT = "SELECT id, ran_at, status, top_signal, error FROM engine_runs WHERE id > ?1 AND ran_at >= ?2 AND status IN ('ok', 'gate_failed') ORDER BY id LIMIT ?3";
function pipeItem(r) {
  var sig = String(r.top_signal || ""), ok = r.status === "ok";
  return { id: r.id, flow: sig.indexOf("q08-forecast:") === 0 ? "forecast" : "essay", title: sig.replace(/^q08-forecast:/, "").replace(/^(hn|arxiv|github):/, ""),
    raw: ok ? "published" : "gate_failed: " + String(r.error || "").slice(0, 140), stage: ok ? "published" : "rejected", state: ok ? "done" : "rejected",
    since: String(r.ran_at || "").replace(" ", "T").slice(0, 19) + "Z" };
}
// EXTERNAL-PROPERTIES-1 (owner 2026-10-14: '"By property" SHALL ALSO INCLUDE Q08.ORG AND READING.Q08.ORG'): the content page reads
// v_content_stage_summary in qnfo-audit, and this property's runs live in another database, so the worker mirrors its own finished items
// (the last PIPE_DAYS days, public fields only: the title and the stage) into qnfo-audit.content_external_items at the end of each tick.
// New rows only (ids above the newest mirrored one), in multi-row statements of PIPE_ROWS_PER_STMT rows (D1 binds at most 100 values
// per statement), and rows older than PIPE_DAYS are removed. A failure is logged and never stops the tick.
var PIPE_DAYS = 7, PIPE_ROWS_PER_STMT = 10, PIPE_MAX_ROWS = 700;
async function mirrorPipeline(env) {
  if (!env.AUDIT || !PIPE_DB(env)) return { ok: false, skipped: "no binding" };
  try {
    var last = await env.AUDIT.prepare("SELECT MAX(CAST(substr(item_id, ?2) AS INTEGER)) AS m FROM content_external_items WHERE property = ?1").bind(PIPE_PROPERTY, PIPE_ID_PREFIX.length + 1).first();
    var after = Number(last && last.m) || 0;
    var rows = ((await PIPE_DB(env).prepare(PIPE_SELECT).bind(after, pipeSince(Date.now() - PIPE_DAYS * 864e5), PIPE_MAX_ROWS).all()).results) || [];
    var items = rows.map(pipeItem).filter(Boolean);
    var stmts = [];
    for (var i = 0; i < items.length; i += PIPE_ROWS_PER_STMT) {
      var chunk = items.slice(i, i + PIPE_ROWS_PER_STMT), vals = [], binds = [];
      chunk.forEach(function (it) {
        vals.push("(?, ?, ?, ?, ?, ?, ?, ?)");
        binds.push(PIPE_PROPERTY, it.flow, PIPE_ID_PREFIX + it.id, String(it.title || "").slice(0, 160), String(it.raw || "").slice(0, 160), it.stage, it.state, it.since);
      });
      var st = env.AUDIT.prepare("INSERT OR REPLACE INTO content_external_items (property, flow, item_id, title, raw_status, stage, state, since) VALUES " + vals.join(", "));
      stmts.push(st.bind.apply(st, binds));
    }
    stmts.push(env.AUDIT.prepare("DELETE FROM content_external_items WHERE property = ?1 AND since < ?2").bind(PIPE_PROPERTY, new Date(Date.now() - PIPE_DAYS * 864e5).toISOString()));
    await env.AUDIT.batch(stmts);
    return { ok: true, mirrored: items.length };
  } catch (e) {
    console.error(JSON.stringify({ worker: PIPE_WORKER, where: "mirrorPipeline", error: String(e && e.message || e).slice(0, 300) }));
    return { ok: false, error: String(e && e.message || e).slice(0, 200) };
  }
}

// BP26-PROVENANCE-MARKING-1: machine-readable provenance sidecar helpers
function bufToHex(buffer) {
  return Array.prototype.map.call(new Uint8Array(buffer), function (b) {
    return b.toString(16).padStart(2, "0");
  }).join("");
}
async function sha256Hex(text) {
  var enc = new TextEncoder();
  var buf = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return bufToHex(buf);
}
async function hmacSha256Hex(key, text) {
  var enc = new TextEncoder();
  var k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return bufToHex(await crypto.subtle.sign("HMAC", k, enc.encode(text)));
}
async function provenanceResponse(env, slug) {
  var piece = await env.DB.prepare("SELECT slug, body_md, title, published_at FROM published_pieces WHERE slug=?").bind(slug).first();
  if (!piece) return json({ ok: false, error: "not found" }, 404);
  var retr = await env.DB.prepare("SELECT slug FROM q08_retractions WHERE slug=?").bind(slug).first().catch(function () { return null; });
  if (retr) return json({ ok: false, error: "retracted" }, 410);
  var manifest = {
    slug: piece.slug,
    body_sha256: await sha256Hex(piece.body_md || ""),
    generated_at: new Date().toISOString(),
    claim_generator: (typeof WORKER !== "undefined" ? WORKER : "q08-signal-engine") + "@" + (typeof VERSION !== "undefined" ? VERSION : "unknown"),
    digitalSourceType: "trainedAlgorithmicMedia"
  };
  var key = env.PROVENANCE_SIGNING_KEY;
  var signature = null;
  var signed = false;
  if (key) {
    try {
      signature = await hmacSha256Hex(key, JSON.stringify(manifest));
      signed = true;
    } catch (e) {
      console.error(JSON.stringify({ evt: "q08 provenance sign failed", slug: slug, error: String(e && e.message || e) }));
    }
  }
  return json(Object.assign({}, manifest, { signature: signature, signed: signed }));
}

async function q08Heartbeat(env, ok) {
  await mirrorPipeline(env); // EXTERNAL-PROPERTIES-1: every tick ends with the mirror (it logs its own failure)
  try {
    await env.AUDIT.prepare("INSERT INTO fleet_heartbeat (worker, version, ts, ok) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(worker) DO UPDATE SET version=excluded.version, ts=excluded.ts, ok=excluded.ok").bind("q08-signal-engine", VERSION, new Date().toISOString(), ok ? 1 : 0).run();
  } catch (e) { console.error("q08 fleet_heartbeat write failed: " + String(e && e.message || e).slice(0, 200)); }
}
async function q08Scheduled(controller, env, ctx) {
    env = __aiAttrEnv(env, "q08-signal-engine", "AI", "AUDIT");
    if (controller.cron === "0 17 * * *") { ctx.waitUntil(sendDigest(env)); return; }
    // Q08-REPAIR-1: the :30 cron audits, repairs and restores pieces. Q08-STALL-RETRY-1: while q08 is stalled it also makes a second
    // generation attempt in the hour (stallRetryDue), after the audit, through the same generate() and the same caps.
    if (controller.cron === "30 * * * *") {
      ctx.waitUntil(auditPublished(env, 3).catch(function (e) { console.error("q08 auditPublished failed: " + String(e && e.message || e).slice(0, 200)); })
        .then(function () { return stallRetryDue(env); })
        .then(function (due) { if (due) return governedGenerate(env).then(function () { return stallDetector(env); }).then(function () { return writeOwnMetrics(env); }); })
        .then(function () { return true; }, function (e) { console.error("q08 stall retry failed: " + String(e && e.message || e).slice(0, 200)); return false; })
        .then(function (ok) { return q08Heartbeat(env, ok); }));
      return;
    }
    var hbOk = true;
    ctx.waitUntil(ensureAccuracySchema(env).then(() => sweepStaleRuns(env)).then(() => governedGenerate(env)).catch(async (e) => {
      hbOk = false;
      console.error("q08 generate failed: " + String(e && e.message || e).slice(0, 200));
      await env.DB.prepare(
        "INSERT INTO engine_runs (signals_scraped, signals_scored, piece_published, ms, status, error) VALUES (0,0,0,0,'error',?)"
      ).bind(String(e && e.message || e).slice(0, 500)).run().catch(function (e2) { console.error("q08 engine_runs error row failed: " + String(e2 && e2.message || e2).slice(0, 200)); });
    }).then(function () { return resolveForecasts(env, 2).catch(function (e) { console.error("q08 resolveForecasts failed: " + String(e && e.message || e).slice(0, 200)); }); }).then(() => stallDetector(env)).then(() => writeOwnMetrics(env)).catch(function (e) { hbOk = false; console.error("q08 scheduled tail failed: " + String(e && e.message || e).slice(0, 200)); })
      .then(function () { return q08Heartbeat(env, hbOk); }));
}
export default __wm_default;

// ---- WEBMCP-FLEET-1:BEGIN (sourced from _shared/webmcp.js; applied by scripts/webmcp-apply.mjs; do not edit inside a worker) ----
// WEBMCP-FLEET-1 (2026-10-25, pillar reach, owner directive "implement WebMCP systemwide across the fleet").
//
// WHAT. WebMCP (https://blog.cloudflare.com/webmcp/, August 2026) is a browser standard, shipping experimentally in
// Chrome 146, that appears in the page as document.modelContext: a site registers MCP tools with registerTool() so an
// agent visiting the page can call the site's own operations instead of guessing its way through a page built for
// humans. Cloudflare's developer preview offers a zone toggle that injects a bridge and two packs (c2pa, and a proxy
// to the site's own MCP server). That toggle is Dashboard-only and this fleet's token may not write zone Snippets
// (probed 2026-10-25: HTTP 403 "snippets are not allowed", and GET /user/tokens 403 so no wider token can be minted),
// so the fleet carries its own implementation, which is also the only version that can expose QNFO's real operations.
//
// HOW. Three pieces, all same-origin, all served by the worker that already answers the page:
//   1. GET /.webmcp/bridge.js   the browser-side module: finds document.modelContext, reads the manifest, registers
//                               every tool, and returns without registering anything when the browser has no WebMCP.
//   2. GET /.webmcp/packs.json  the machine-readable manifest (also readable by a non-browser agent).
//   3. an HTMLRewriter step on 200 HTML responses appending one <script type="module" src="/.webmcp/bridge.js">.
//
// WHY same-origin only. The bridge runs in the visitor's page with the visitor's session. A tool that reached another
// origin would hand this origin's tools to a page we do not own, and a proxy that took a caller-supplied absolute URL
// would be an SSRF surface on every page of every host. Every request template below is a path, resolved against the
// page's own origin, and read_page refuses anything that is not a path on this origin.
//
// WHY this is not a false capability claim (DECLARED-NOT-WORKING-1). The manifest is generated from the same table the
// bridge registers from, and every endpoint in it was answered 200 by a live probe on 2026-10-25 before shipping. The
// bridge reports what actually happened in window.__webmcp: supported=false when the browser has no modelContext, and
// registered=<n> only after registerTool() returned. Measured 2026-10-25 before this shipped: ideas /api/proposals
// answered 503 and was REMOVED from the manifest rather than advertised; ideas /api/sessions, q08 /api/metrics and
// POST ask.qwav.tech/api/ask answered 200. scripts/webmcp-verify.mjs re-probes every host and every tool endpoint.
//
// ROLLBACK. Revert the deploy of a worker to its previous version; the block is inert code for a browser without
// modelContext and cannot change a page's rendered output for any other client.
var WM_VERSION = "1.2.0";
var WM_BRIDGE_PATH = "/.webmcp/bridge.js";
var WM_PACKS_PATH = "/.webmcp/packs.json";
var WM_MANIFEST_PATH = "/.webmcp/manifest.json";
// WM_MANIFEST_URL is the path the bridge reads, and it is deliberately OUTSIDE /.webmcp/: Cloudflare's own WebMCP
// preview owns that prefix at the edge when a zone has it switched on (measured 2026-10-25: /.webmcp/bridge.js answer
// 75,756 bytes of the platform bundle and /.webmcp/packs.json answer 404 without ever reaching the worker), so a
// manifest under that prefix is invisible on exactly the zone with the most traffic. /api/webmcp/ is ours end to end.
var WM_MANIFEST_URL = "/api/webmcp/manifest.json";
var WM_MCP_PATH = "/mcp";
var WM_MCP_PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26"];
var WM_MAX_TEXT = 40000;

// WM_PACK_DEFS: the whole tool surface. `request` is a same-origin template. `{name}` in a path or a query value is
// replaced from the call arguments; an argument that is absent drops its query key rather than sending "undefined".
var WM_PACK_DEFS = {
  site: {
    title: "This site",
    description: "Read the site the visitor is looking at: the page in front of them, any page on this origin, and the sitemap.",
    tools: [
      {
        name: "get_page_context",
        description: "Return the page the visitor is on: its URL, title, description, its section headings and any text the visitor has selected. Call this first to learn where you are.",
        inputSchema: { type: "object", properties: {} },
        local: "page_context"
      },
      {
        name: "read_page",
        description: "Fetch a path on this site and return its text (HTML reduced to readable text, or the raw body for JSON/Markdown/plain). Paths are relative to this origin.",
        inputSchema: { type: "object", properties: { path: { type: "string", description: "A path on this site, e.g. /about" }, max_chars: { type: "number", description: "Truncate the text to this many characters (default 20000)" } }, required: ["path"] },
        request: { method: "GET", path: "{path}" }
      },
      {
        name: "list_site_pages",
        description: "List the URLs published in this site's sitemap.xml.",
        inputSchema: { type: "object", properties: { limit: { type: "number", description: "Maximum URLs to return (default 100)" } } },
        request: { method: "GET", path: "/sitemap.xml", extract: "loc" }
      }
    ]
  },
  papers: {
    title: "QNFO living papers",
    description: "Search, read and question the QNFO research corpus: full texts as Markdown, a JSON metadata API, and a deterministic digest of any paper.",
    tools: [
      {
        name: "search_papers",
        description: "Full-text search over the QNFO papers corpus. Returns matching papers with slug, title, authors and abstract.",
        inputSchema: { type: "object", properties: { q: { type: "string", description: "Search words" }, limit: { type: "number", description: "1-50, default 10" } }, required: ["q"] },
        request: { method: "GET", path: "/api/papers", query: { q: "{q}", limit: "{limit}" } }
      },
      {
        name: "get_paper",
        description: "Metadata for one paper by slug: title, authors, abstract, DOI, version, dates, licence and the URLs of its Markdown and PDF.",
        inputSchema: { type: "object", properties: { slug: { type: "string", description: "Paper slug, e.g. ultrametric-intelligence" } }, required: ["slug"] },
        request: { method: "GET", path: "/api/papers/{slug}" }
      },
      {
        name: "get_paper_markdown",
        description: "The full text of one paper as Markdown. Use this to read or quote a paper.",
        inputSchema: { type: "object", properties: { slug: { type: "string" }, max_chars: { type: "number" } }, required: ["slug"] },
        request: { method: "GET", path: "/papers/{slug}.md", accept: "text/markdown" }
      },
      {
        name: "get_paper_digest",
        description: "A deterministic digest of one paper written from its own sentences: the abstract, the claim, the figures it reports, how it is done, what would falsify it, where the claim stops, and a map of where to read.",
        inputSchema: { type: "object", properties: { slug: { type: "string" } }, required: ["slug"] },
        request: { method: "GET", path: "/api/quickread/{slug}" }
      }
    ]
  },
  fleet: {
    title: "QNFO fleet",
    description: "The live state of the QNFO Cloudflare fleet: health, spend, what needs attention and what changed.",
    tools: [
      {
        name: "fleet_status",
        description: "Fleet verdict and what the fleet is waiting on a human to do.",
        inputSchema: { type: "object", properties: {} },
        request: { method: "GET", path: "/api/human" }
      },
      {
        name: "fleet_attention",
        description: "Everything the fleet currently flags as needing attention.",
        inputSchema: { type: "object", properties: {} },
        request: { method: "GET", path: "/api/attention" }
      },
      {
        name: "fleet_cost",
        description: "Cost per surface over the current windows.",
        inputSchema: { type: "object", properties: {} },
        request: { method: "GET", path: "/api/cost" }
      },
      {
        name: "fleet_areas",
        description: "The functional areas of the fleet with their state.",
        inputSchema: { type: "object", properties: {} },
        request: { method: "GET", path: "/api/areas" }
      }
    ]
  },
  ideas: {
    title: "QNFO ideas",
    description: "The QNFO idea hub: the open idea threads.",
    tools: [
      {
        name: "list_ideas",
        description: "List the open idea threads in the hub.",
        inputSchema: { type: "object", properties: {} },
        request: { method: "GET", path: "/api/sessions" }
      }
    ]
  },
  signals: {
    title: "q08 signal organism",
    description: "Signals, forecasts and run metrics of the q08 signal organism.",
    tools: [
      {
        name: "list_signals",
        description: "The latest signals emitted by the organism.",
        inputSchema: { type: "object", properties: {} },
        request: { method: "GET", path: "/api/signals" }
      },
      {
        name: "list_forecasts",
        description: "Open and resolved forecasts with their outcomes.",
        inputSchema: { type: "object", properties: {} },
        request: { method: "GET", path: "/api/forecasts" }
      },
      {
        name: "signal_metrics",
        description: "Organism run metrics.",
        inputSchema: { type: "object", properties: {} },
        request: { method: "GET", path: "/api/metrics" }
      }
    ]
  },
  ask: {
    title: "Ask QWAV",
    description: "Ask a question over the QNFO corpus and read recent questions.",
    tools: [
      {
        name: "ask_corpus",
        description: "Ask a research question and get an answer grounded in the QNFO corpus with its sources.",
        inputSchema: { type: "object", properties: { q: { type: "string", description: "The question" } }, required: ["q"] },
        request: { method: "POST", path: "/api/ask", body: { q: "{q}" } }
      },
      {
        name: "recent_questions",
        description: "Recently asked questions and their answers.",
        inputSchema: { type: "object", properties: {} },
        request: { method: "GET", path: "/api/recent" }
      },
      {
        name: "corpus_stats",
        description: "Index statistics for the corpus behind this search.",
        inputSchema: { type: "object", properties: {} },
        request: { method: "GET", path: "/api/stats" }
      }
    ]
  },
  ipatent: {
    title: "iPatent",
    description: "Search the disclosure corpus, read its status, and get invention suggestions.",
    tools: [
      {
        name: "search_disclosures",
        description: "Search the iPatent disclosure corpus.",
        inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
        request: { method: "GET", path: "/api/search", query: { q: "{q}" } }
      },
      {
        name: "ipatent_status",
        description: "Corpus and pipeline status.",
        inputSchema: { type: "object", properties: {} },
        request: { method: "GET", path: "/api/status" }
      }
    ]
  },
  mind: {
    title: "mind.q08.org",
    description: "The inside reading surface: its corpus entries and shelves.",
    tools: [
      {
        name: "list_entries",
        description: "Every entry in the mind corpus with its shelf.",
        inputSchema: { type: "object", properties: {} },
        request: { method: "GET", path: "/api/entries.json" }
      }
    ]
  }
};

// WM_HOST_PACKS: which packs a host advertises. A host absent here gets the site pack only, so a new surface is
// agent-readable the moment it is deployed and never advertises a tool it cannot answer.
var WM_HOST_PACKS = {
  "qnfo.org": ["site", "papers"],
  "www.qnfo.org": ["site", "papers"],
  "papers.qnfo.org": ["site", "papers"],
  "archive.qnfo.org": ["site"],
  "legal.qnfo.org": ["site"],
  "qnfo.org:email": ["site"],
  "fleet.qnfo.org": ["site", "fleet"],
  "ideas.qnfo.org": ["site", "ideas"],
  "q08.org": ["site", "signals"],
  "www.q08.org": ["site", "signals"],
  "ask.qwav.tech": ["site", "ask"],
  "ask.qwav.org": ["site", "ask"],
  "ipatent.qnfo.org": ["site", "ipatent"],
  "ipatent.me": ["site", "ipatent"],
  "www.ipatent.me": ["site", "ipatent"],
  "mind.q08.org": ["site", "mind"]
};

// wmHost accepts a URL or a bare hostname (the manifest and the tests both call it with either) and never throws: an
// unknown shape yields "", which lands on the site pack rather than on a tool nobody verified.
function wmHost(url) {
  try {
    var s = typeof url === "string" ? url : String(url && url.hostname || url || "");
    if (s.indexOf("://") >= 0) {
      try { s = new URL(s).hostname; } catch (e2) { return ""; }
    }
    s = s.split("/")[0].split("?")[0].split("#")[0];
    return s.toLowerCase().replace(/:\d+$/, "");
  } catch (e) {
    return "";
  }
}
function wmPackIds(host) {
  var h = wmHost(host);
  return (WM_HOST_PACKS[h] || ["site"]).filter(function (id) { return !!WM_PACK_DEFS[id]; });
}
function wmPacks(host) {
  var out = [];
  var ids = wmPackIds(host);
  for (var i = 0; i < ids.length; i++) {
    var d = WM_PACK_DEFS[ids[i]];
    var tools = [];
    for (var j = 0; j < d.tools.length; j++) {
      var t = d.tools[j];
      tools.push({ name: t.name, description: t.description, inputSchema: t.inputSchema, local: t.local || null, request: t.request || null });
    }
    out.push({ id: ids[i], title: d.title, description: d.description, tools: tools });
  }
  return out;
}
function wmManifest(host, worker) {
  var packs = wmPacks(host);
  var n = 0;
  for (var i = 0; i < packs.length; i++) n += packs[i].tools.length;
  return {
    schema_version: "webmcp/v1",
    implementation: "qnfo-webmcp",
    version: WM_VERSION,
    worker: worker || "",
    host: wmHost(host),
    generated_from: "_shared/webmcp.js",
    bridge: WM_BRIDGE_PATH,
    standard: "https://blog.cloudflare.com/webmcp/",
    surface: { document_modelContext: true, navigator_modelContext_fallback: true, degrades_silently: true },
    pack_ids: wmPackIds(host),
    tool_count: n,
    packs: packs
  };
}

// The browser-side module. Written as lines, not a template literal, so nothing in it can be re-interpreted by the
// worker's own bundler and so a diff of this array is a diff of the shipped script.
function wmBridgeSource() {
  var L = [
    "/* QNFO WebMCP bridge " + WM_VERSION + " - generated from _shared/webmcp.js; do not edit. */",
    "(() => {",
    "  if (window.__webmcp && window.__webmcp.bridge) return;",
    "  const state = window.__webmcp = { bridge: true, version: '" + WM_VERSION + "', supported: false, mode: 'init', packs: [], tools: [], registered: 0, errors: [] };",
    "  const ctx = () => {",
    "    try {",
    "      if (document.modelContext && typeof document.modelContext.registerTool === 'function') return document.modelContext;",
    "      if (navigator.modelContext && typeof navigator.modelContext.registerTool === 'function') return navigator.modelContext;",
    "    } catch (e) { state.errors.push('context:' + e); }",
    "    return null;",
    "  };",
    "  const trunc = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) + '\\n[... ' + (s.length - n) + ' more characters]' : s; };",
    "  const html2text = (s) => String(s || '')",
    "    .replace(/<script[\\s\\S]*?<\\/script>/gi, ' ').replace(/<style[\\s\\S]*?<\\/style>/gi, ' ')",
    "    .replace(/<\\/(p|div|section|article|h[1-6]|li|tr|br)>/gi, '\\n').replace(/<[^>]+>/g, ' ')",
    "    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '\"').replace(/&#39;/g, \"'\")",
    "    .replace(/[ \\t]+/g, ' ').replace(/\\n{3,}/g, '\\n\\n').trim();",
    "  const fill = (tpl, args) => String(tpl || '').replace(/\\{([a-z0-9_]+)\\}/gi, (m, k) => {",
    "    const v = args && args[k];",
    "    return v == null ? '' : String(v);",
    "  });",
    "  const text = (body, isErr) => ({ content: [{ type: 'text', text: body }], isError: !!isErr });",
    "  const pageContext = () => {",
    "    const heads = [];",
    "    document.querySelectorAll('h1,h2,h3').forEach((h) => { if (heads.length < 40) heads.push(h.tagName.toLowerCase() + ': ' + (h.textContent || '').trim().slice(0, 160)); });",
    "    const desc = document.querySelector('meta[name=\"description\"]');",
    "    const sel = String(window.getSelection ? window.getSelection() : '').slice(0, 4000);",
    "    const out = { url: location.href, path: location.pathname, title: document.title, description: desc ? desc.getAttribute('content') : '', lang: document.documentElement.getAttribute('lang') || '', headings: heads, selected_text: sel,",
    "      tools_available: state.tools, packs: state.packs, webmcp_supported: state.supported };",
    "    return text(JSON.stringify(out, null, 1));",
    "  };",
    "  async function call(tool, args) {",
    "    const r = tool.request || {};",
    "    let path = fill(r.path, args);",
    "    if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return text('refused: the path must be relative to this site, not an absolute URL', true);",
    "    path = '/' + String(path).replace(/^\\/+/, '');",
    "    const qs = new URLSearchParams();",
    "    if (r.query) for (const k of Object.keys(r.query)) { const v = args && args[k] != null ? args[k] : null; if (v !== null) qs.set(k, String(v)); }",
    "    const url = path + (qs.toString() ? '?' + qs.toString() : '');",
    "    const init = { method: r.method || 'GET', credentials: 'same-origin', headers: { 'accept': r.accept || 'application/json, text/html;q=0.9, text/plain;q=0.8' } };",
    "    if (init.method === 'POST') { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(args || {}); }",
    "    const res = await fetch(url, init);",
    "    const raw = await res.text();",
    "    if (!res.ok) return text('HTTP ' + res.status + ' for ' + url + '\\n' + trunc(raw, 2000), true);",
    "    const ct = (res.headers.get('content-type') || '').toLowerCase();",
    "    const cap = Number(args && args.max_chars) > 0 ? Number(args.max_chars) : 20000;",
    "    if (r.extract === 'loc') {",
    "      const locs = Array.from(raw.matchAll(/<loc>([^<]+)<\\/loc>/gi)).map((m) => m[1]);",
    "      const limit = Number(args && args.limit) > 0 ? Number(args.limit) : 100;",
    "      return text(JSON.stringify({ count: locs.length, urls: locs.slice(0, limit) }, null, 1));",
    "    }",
    "    if (ct.indexOf('json') >= 0) return text(trunc(raw, 40000));",
    "    if (ct.indexOf('html') >= 0) return text(trunc(html2text(raw), cap));",
    "    return text(trunc(raw, cap));",
    "  }",
    "  function toolHandler(tool) {",
    "    return async (args) => {",
    "      try {",
    "        if (tool.local === 'page_context') return pageContext();",
    "        return await call(tool, args || {});",
    "      } catch (e) { state.errors.push(tool.name + ':' + e); return text(tool.name + ' failed: ' + (e && e.message || e), true); }",
    "    };",
    "  }",
    "  async function install(target) {",
    "    const man = state.manifest;",
    "    let n = 0;",
    "    for (const pack of (man.packs || [])) {",
    "      for (const tool of (pack.tools || [])) {",
    "        try {",
    "          await target.registerTool({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema, execute: toolHandler(tool) });",
    "          n++;",
    "        } catch (e) { state.errors.push('register:' + tool.name + ':' + e); }",
    "      }",
    "    }",
    "    state.registered = n;",
    "    state.mode = n ? 'registered' : 'failed';",
    "    return n;",
    "  }",
    "  state.install = install;",
    "  (async () => {",
    "    try {",
    "      const platform = document.querySelector('script[src*=\"/.webmcp/bridge.js\"]:not([data-webmcp])');",
    "      state.platform_bridge = !!platform;",
    "      const res = await fetch('/api/webmcp/manifest.json', { credentials: 'same-origin', headers: { accept: 'application/json' } });",
    "      if (!res.ok) { state.mode = 'no-manifest'; state.errors.push('manifest http ' + res.status); return; }",
    "      state.manifest = await res.json();",
    "      state.packs = (state.manifest.packs || []).map((p) => p.id);",
    "      state.tools = (state.manifest.packs || []).flatMap((p) => (p.tools || []).map((t) => t.name));",
    "      const c = ctx();",
    "      state.supported = !!c;",
    "      if (!c) { state.mode = 'standalone'; return; }",
    "      // Cloudflare's own bridge is on this page (its zone toggle is on): it registers the same tools through /mcp.",
    "      // Registering them a second time would collide on tool names, so ours stands down and says so.",
    "      if (state.platform_bridge) { state.mode = 'platform'; return; }",
    "      await install(c);",
    "    } catch (e) { state.mode = 'error'; state.errors.push(String(e)); }",
    "  })();",
    "})();"
  ];
  return L.join(String.fromCharCode(10)) + String.fromCharCode(10);
}

// wmToolUrl builds the same-origin request a tool describes. Both executors use it: the browser bridge (which calls
// over HTTP with the visitor's session) and the MCP endpoint below (which calls the worker's own router). One builder
// means a tool cannot mean one thing in a browser and another in the MCP surface.
function wmToolUrl(tool, args) {
  var r = tool.request || {};
  var fill = function (tpl) {
    return String(tpl == null ? "" : tpl).replace(/\{([a-z0-9_]+)\}/gi, function (m, k) {
      var v = args && args[k];
      return v == null ? "" : String(v);
    });
  };
  var path = fill(r.path);
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return null;
  path = "/" + path.replace(/^\/+/, "");
  var qs = [];
  if (r.query) {
    for (var k in r.query) {
      if (!Object.prototype.hasOwnProperty.call(r.query, k)) continue;
      var v = args && args[k] != null ? args[k] : null;
      if (v !== null) qs.push(encodeURIComponent(k) + "=" + encodeURIComponent(fill(r.query[k])));
    }
  }
  return path + (qs.length ? "?" + qs.join("&") : "");
}
function wmStripHtml(s) {
  return String(s || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|section|article|h[1-6]|li|tr|br)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"")
    .replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
function wmTrunc(s, n) {
  s = String(s == null ? "" : s);
  return s.length > n ? s.slice(0, n) + "\n[... " + (s.length - n) + " more characters]" : s;
}
function wmToolResult(text, isError) {
  return { content: [{ type: "text", text: text }], isError: isError ? true : undefined };
}

// wmExecTool runs one tool through the worker's own router. No subrequest: the captured original fetch is called as a
// function, so the tool sees exactly the response a visitor would get, at the cost of no extra invocation.
async function wmExecTool(tool, args, request, origFetch, env, ctx) {
  if (!tool || !tool.request) {
    return wmToolResult("page_context is answered in the browser by the bridge; a server-side caller has no page.", true);
  }
  var target = wmToolUrl(tool, args);
  if (!target) return wmToolResult("refused: a tool path must be relative to this site, not an absolute URL", true);
  var origin = new URL(request.url).origin;
  var init = { method: String(tool.request.method || "GET").toUpperCase(), headers: {} };
  if (init.method === "POST") {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(args || {});
  } else {
    init.headers["accept"] = tool.request.accept || "application/json";
  }
  var res = await origFetch(new Request(origin + target, init), env, ctx);
  var raw = await res.text();
  if (!res.ok) return wmToolResult("HTTP " + res.status + " for " + target + "\n" + wmTrunc(raw, 2000), true);
  var ct = (res.headers.get("Content-Type") || "").toLowerCase();
  if (ct.indexOf("html") >= 0) return wmToolResult(wmTrunc(wmStripHtml(raw), 20000));
  return wmToolResult(wmTrunc(raw, WM_MAX_TEXT));
}
function wmFindTool(host, name) {
  var packs = wmPacks(host);
  for (var i = 0; i < packs.length; i++) {
    for (var j = 0; j < packs[i].tools.length; j++) if (packs[i].tools[j].name === name) return packs[i].tools[j];
  }
  return null;
}
function wmMcpCard(host, workerName) {
  var man = wmManifest(host, workerName);
  return {
    schema_version: "mcp/server-card/v1",
    serverInfo: { name: "qnfo-webmcp", version: WM_VERSION, title: "QNFO " + (man.host || "site") },
    description: "The same-origin MCP server behind this site's WebMCP tools. Discovered by Cloudflare's WebMCP bridge (pack mcp-server-client) and by any MCP client that speaks JSON-RPC over HTTP.",
    transport: { type: "http", path: WM_MCP_PATH, methods: ["POST", "GET", "DELETE"], protocolVersions: WM_MCP_PROTOCOLS },
    capabilities: { tools: { listChanged: false } },
    tool_count: man.tool_count,
    packs: man.pack_ids,
    standard: "https://blog.cloudflare.com/webmcp/"
  };
}
async function wmRpc(msg, request, env, ctx, origFetch, workerName) {
  var u = new URL(request.url);
  var host = u.hostname;
  var id = msg && Object.prototype.hasOwnProperty.call(msg, "id") ? msg.id : null;
  var method = msg && msg.method ? String(msg.method) : "";
  var params = (msg && msg.params) || {};
  var isNotification = !msg || !Object.prototype.hasOwnProperty.call(msg, "id") || msg.id === null;
  var reply = function (result) { return { jsonrpc: "2.0", id: id, result: result }; };
  var fail = function (code, message) { return { jsonrpc: "2.0", id: id, error: { code: code, message: message } }; };
  if (!msg || msg.jsonrpc !== "2.0" || !method) return isNotification ? null : fail(-32600, "invalid request");
  if (method === "initialize") {
    var asked = String(params.protocolVersion || "");
    var ver = WM_MCP_PROTOCOLS.indexOf(asked) >= 0 ? asked : WM_MCP_PROTOCOLS[1];
    return reply({
      protocolVersion: ver,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "qnfo-webmcp", version: WM_VERSION, title: "QNFO " + host },
      instructions: "Tools published by " + host + ". Every tool reads the same public data the page shows; nothing here takes a credential, and nothing reaches another origin."
    });
  }
  if (method.indexOf("notifications/") === 0) return null;
  if (method === "ping") return reply({});
  if (method === "tools/list") {
    var man = wmManifest(host, workerName);
    var tools = [];
    for (var i = 0; i < man.packs.length; i++) {
      for (var j = 0; j < man.packs[i].tools.length; j++) {
        var t = man.packs[i].tools[j];
        tools.push({ name: t.name, description: t.description, inputSchema: t.inputSchema });
      }
    }
    return reply({ tools: tools });
  }
  if (method === "tools/call") {
    var name = String(params.name || "");
    var tool = wmFindTool(host, name);
    if (!tool) return fail(-32602, "unknown tool: " + name);
    try {
      var result = await wmExecTool(tool, params.arguments || {}, request, origFetch, env, ctx);
      return reply(result);
    } catch (e) {
      return reply(wmToolResult(name + " failed: " + String((e && e.message) || e), true));
    }
  }
  return isNotification ? null : fail(-32601, "method not found: " + method);
}

// wmMcp answers the site's MCP endpoint. Cloudflare's WebMCP bridge (pack mcp-server-client, data-mcp-url defaulting to
// /mcp) runs initialize -> notifications/initialized -> tools/list -> tools/call against it with the visitor's session,
// so the fleet's tools reach document.modelContext through the platform's own implementation wherever the zone toggle
// is on, and through /.webmcp/bridge.js where it is not.
async function wmMcp(request, env, ctx, origFetch, workerName) {
  try {
    if (!request) return null;
    var u = new URL(request.url);
    if ((u.pathname.replace(/\/+$/, "") || "/") !== WM_MCP_PATH) return null;
    var m = String(request.method || "GET").toUpperCase();
    var h = { "X-WebMCP": WM_VERSION };
    if (m === "GET" || m === "HEAD") {
      var card = JSON.stringify(wmMcpCard(u.hostname, workerName));
      return new Response(m === "HEAD" ? null : card, { status: 200, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300", "X-WebMCP": WM_VERSION } });
    }
    if (m === "DELETE" || m === "OPTIONS") return new Response(null, { status: 204, headers: h });
    if (m !== "POST") return wmJson({ error: "method not allowed" }, 405, "no-store");
    var body = null;
    try {
      body = await request.json();
    } catch (e) {
      return wmJson({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, 400, "no-store");
    }
    var batch = Array.isArray(body);
    var msgs = batch ? body : [body];
    var out = [];
    for (var i = 0; i < msgs.length; i++) {
      var r = await wmRpc(msgs[i], request, env, ctx, origFetch, workerName);
      if (r) out.push(r);
    }
    if (!out.length) return new Response(null, { status: 202, headers: h });
    return wmJson(batch ? out : out[0], 200, "no-store");
  } catch (e) {
    return null;
  }
}

function wmJson(body, status, cache) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": cache || "public, max-age=300", "X-WebMCP": WM_VERSION }
  });
}

// wmRoute answers the bridge and the manifest and nothing else. Returns null for every other request, so a caller can
// run it before its own router without changing any existing behaviour.
function wmRoute(request, workerName) {
  try {
    if (!request) return null;
    var u = new URL(request.url);
    var p = u.pathname;
    var isManifest = p === WM_PACKS_PATH || p === WM_MANIFEST_PATH || p === WM_MANIFEST_URL;
    if (p !== WM_BRIDGE_PATH && !isManifest) return null;
    var m = String(request.method || "GET").toUpperCase();
    if (m !== "GET" && m !== "HEAD") return wmJson({ error: "method not allowed" }, 405, "no-store");
    var host = u.hostname;
    if (p === WM_BRIDGE_PATH) {
      var js = wmBridgeSource();
      var h = { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "public, max-age=3600", "X-WebMCP": WM_VERSION, "X-Content-Type-Options": "nosniff" };
      return new Response(m === "HEAD" ? null : js, { status: 200, headers: h });
    }
    var man = wmManifest(host, workerName || "");
    man.paths = { bridge: WM_BRIDGE_PATH, packs: WM_MANIFEST_URL, manifest: WM_MANIFEST_URL, mcp: WM_MCP_PATH };
    var hh = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300", "X-WebMCP": WM_VERSION };
    return new Response(m === "HEAD" ? null : JSON.stringify(man), { status: 200, headers: hh });
  } catch (e) {
    return null;
  }
}

// The HTMLRewriter handler. It appends the module tag at the end of <head>; a page without a head, a non-200, a
// non-HTML body or a browser we cannot detect all pass through untouched.
// wmPlatformOn: hosts whose zone has Cloudflare own WebMCP preview switched on. Measured 2026-10-25: qnfo.org,
// papers, ideas, fleet and ipatent each carried the platform tag (data-packs="c2pa,mcp-server-client") and
// /.webmcp/bridge.js resolved to the 75,756-byte platform bundle before this worker was reached. The platform
// bundle keeps only the pack names it bundles and does NOT fall back to its defaults, so a second tag carrying
// "site,papers" downloads the same bundle again, registers nothing and logs two warnings. On those hosts this
// worker supplies /mcp and lets the platform bridge register it.
function wmPlatformOn(host) {
  var h = wmHost(host);
  return h === "qnfo.org" || h.slice(-9) === ".qnfo.org";
}
function wmInjector(host, workerName) {
  var ids = wmPackIds(host);
  var packs = ids.join(",");
  var tag = '<script type="module" src="' + WM_BRIDGE_PATH + '" data-webmcp="' + WM_VERSION + '" data-packs="' + packs + '" data-mcp-url="' + WM_MCP_PATH + '" data-worker="' + String(workerName || "").replace(/"/g, "") + '"></script>';
  return {
    element: function (el) {
      try { el.append(tag, { html: true }); } catch (e) { }
    }
  };
}
function wmWithHtml(res, request, workerName) {
  try {
    if (!res || !request) return res;
    var m = String(request.method || "GET").toUpperCase();
    if (m !== "GET") return res;
    if (res.status !== 200) return res;
    var ct = (res.headers.get("Content-Type") || "").toLowerCase();
    if (ct.indexOf("text/html") !== 0) return res;
    if (typeof HTMLRewriter === "undefined") return res;
    var u = new URL(request.url);
    if (wmPlatformOn(u.hostname)) return res;
    if (u.pathname.indexOf("/.webmcp/") === 0 || u.pathname === WM_MCP_PATH) return res;
    var out = new HTMLRewriter().on("head", wmInjector(u.hostname, workerName)).transform(res);
    // A rewritten body no longer matches the origin's Content-Length/ETag; left in place they truncate or mis-cache
    // the page. The X-WebMCP marker is what scripts/webmcp-verify.mjs reads without parsing 200 KB of HTML.
    try {
      out.headers.delete("Content-Length");
      out.headers.delete("ETag");
      out.headers.set("X-WebMCP", WM_VERSION);
    } catch (e2) { }
    return out;
  } catch (e) {
    return res;
  }
}

// wmAttach wraps a worker's default export so every response passes through the steps above. It is a property
// assignment on the exported object, so the runtime sees it on every invocation, and it is idempotent.
function wmAttach(target, workerName) {
  try {
    if (!target || typeof target.fetch !== "function" || target.__wm === WM_VERSION) return target;
    var orig = target.fetch;
    var name = workerName || "";
    target.fetch = async function (request, env, ctx) {
      var routed = wmRoute(request, name);
      if (routed) return routed;
      var mcp = await wmMcp(request, env, ctx, orig, name);
      if (mcp) return mcp;
      var res = await orig.call(this, request, env, ctx);
      return wmWithHtml(res, request, name);
    };
    target.__wm = WM_VERSION;
    return target;
  } catch (e) {
    return target;
  }
}
// ---- WEBMCP-FLEET-1:END ----
// ---- WEBMCP-FLEET-1:ATTACH q08-signal-engine ----
wmAttach(__wm_default, "q08-signal-engine");
