// idea-hub v1.5.8-diversity-cap-20261006: IDEA-DIVERSITY-CAP-1 (#1947, trigger 1238 idea_topic_concentration_30d > 0.50:
//   a generated proposal scored ACCEPT whose topic cluster would push that cluster above half of the 30-day accepts waits as
//   deferred_diversity with its score kept; held rows are released best score first with no model call once the share
//   allows and no ai_spend cap is breached, and become a terminal HOLD when they leave the 30-day window).
// idea-hub v1.5.6-reentry-drain-20261005: REENTRY-DRAIN-1 (#1654 SIGNALS-TRIAGE-GAP-1: status='new' artifact_reentry signals
//   had no terminal state; weight-0 ones are expired after REENTRY_NOQ_TTL_H with one last re-check, weight>0 ones after
//   REENTRY_TTL_DAYS, no emission while the boundary row is not permitted; no model call, no new cron).
// idea-hub v1.5.5-triage-budget-20261005: IDEA-TRIAGE-BREACH-DEFER-1 (#1878: no triage model call while a fleet_budget
//   ai_spend cap is breached; proposals wait as deferred_budget and are released when the caps clear), COST-ATTRIBUTION
//   (#1833: triage and think-loop calls counted in ai_call_counters via aiRunAttr), OWNER-TOKEN-SHADOW-1 (#1966: intake
//   accepts OWNER_TOKEN or SYNC_TOKEN, constant-time).
// idea-hub v1.5.3-questions-feed-leakfix-20261004: ROLEPROMPT-SHAPE-GATE-1 (a public question is never
//   an instruction addressed to a model; catches pipeline prompts not enumerated in INTERNAL).
// idea-hub v1.5.2-questions-feed-20261004: IDEAS-PUBLIC-FILTER-1 (strip client-injected <ATTACHMENT_FILE>
//   and <context-data> blocks before the public gate; withhold a thread only when its FIRST public question
//   is internal, not when any turn is) + IDEAS-QUESTIONS-SOURCE-1 (publish self_questions open + triaged
//   idea_proposals, so the fleet's own latest research questions appear).
// idea-hub v1.5.1-public-ideas-20261004: IDEAS-PUBLIC-1 reverts IDEAS-PRIVATE-1. QNFO Ideas is a PUBLIC
//   read-only surface again: /, /s/*, /rss.xml, /api/sessions, /api/session/* load with NO credential. The
//   public filter (publicTitle + quarantine + INTERNAL/OPS/JUNK stripping) remains the only gate.
// idea-hub v1.4.0-qds-20261002: IDEAS-QDS-1 server-rendered public page and thread pages on the QNFO design system.
// idea-hub v1.3.0-think-loop-20261001
// AUTOPILOT-FOLD-1 (2026-10-01, issue 1640): qnfo-autopilot vanished unrecorded around 2026-09-25 and is folded into
//   existing workers instead of being recreated. Its think loop (one novel, falsifiable research question ->
//   self_questions + idea_proposals; last row 2026-09-21) lands here, next to the other ideation producers, with two
//   changes: it runs every THINK_EVERY_H hours instead of hourly, and it respects the same PROPOSAL_BACKPRESSURE pause
//   as re-entry. The 7-day near-duplicate filter is kept. Proposals are stored as the plain question text (the original
//   wrapped it in {"ideas":[...]}, which the triage scorer then read as JSON noise).
// idea-hub v1.2.0-ideation-loop-20261001
// SIGNALS-TRIAGE-GAP-1 (issue 1654) / L8 re-entry: qnfo-signal-loop, the only producer AND consumer of
//   signals.source='artifact_reentry', disappeared unrecorded around 2026-09-25 (worker_removals rationale), so
//   re-entry emission stopped 09-14, consumption 09-15 (128 left status=new) and idea_proposals stopped 09-24. Its
//   reentry + consume legs are ported here (idea-hub is already permitted for artifact_reentry in
//   signal_worker_boundary and holds the same LIVING_PAPER + QNFO_AUDIT bindings), with cost bounds the original
//   lacked: re-entry reads existing signals once instead of 2 queries per paper for 500 papers every hour and emits
//   at most REENTRY_BATCH new papers per run; consume takes CONSUME_SIGNALS signals x CONSUME_QUESTIONS questions per
//   run and pauses while more than PROPOSAL_BACKPRESSURE proposals await triage (the original could insert 375
//   proposals/hour against a triage rate of 5).
// idea-hub v1.1.0-triage-consumer-20261001
// IDEA-TRIAGE-CONSUMER-ABSENT-1 (issue 1689): qnfo-idea-triage was retired 2026-09-19 on the assumption that idea-hub
//   "embedded triage fully subsumes it", but idea-hub had no triage path at all, so idea_proposals stopped being
//   consumed on 2026-09-18 (19 status=new at 2026-10-01). The proposal-triage leg of qnfo-idea-triage 1.4.0 is ported
//   here verbatim (same two-model scorecard, tiebreak, ACCEPT thresholds, noise/question pre-filters, research_queue
//   enqueue) and runs on an hourly cron, at most TRIAGE_BATCH proposals per run. The public HTTP surface stays
//   read-only: /run and /api/proposals remain disabled; triage runs only from scheduled().
// idea-hub v1.0.8-toolinv-gate-20260929
// idea-hub v1.0.9-toolinv-shape-v2-20260929
// Fixes #1412 (D4/D5 RESIDUAL SHAPE HOLES). v1.0.8's TOOLINV caught the three live
//   leaks but its alternatives were over-specific: 'invoke <snake_case>' (no article),
//   and 'use your X tool' (no 'the'). Live gate probes 2026-09-29T17:2xZ returned
//   public:true for 'You must invoke the search tool ...' (D4) and 'Use the fetch
//   tool ...' (D5). v1.0.9 replaces verb-specific alternation with one VERB+ARTICLE+
//   NOUN-TYPE shape: (use|invoke|call|run) [your|the|a|an] <name> (tool|function|verb|
//   api|endpoint|action)s? -- plus 'call <snake_case> with' and bare '<snake_case> tool'.
//   Validated against the 39 live public titles (0 false positives) and the adversarial
//   set ('Call it with caution', 'Use your own judgement', 'call a function with keyword
//   arguments', 'Run the numbers', 'The tool with no name' all correctly unmatched).
//   Fail-closed: an imperative tool directive is never a public title. Still NOT in
//   INTERNAL/OPS, which also feed blocked(), so this gate cannot quarantine whole threads.
// Fixes #1412 (RESIDUAL CLASS). The v1.0.7 STAMP gate closed the orchestrator-retry
//   stamp vector, but the underlying OPS denylist enumerates SPECIFIC tool names and
//   therefore structurally lags the tool surface. Three public RSS items still exposed
//   raw agent tool-call directives as titles, because suggest_contacts and social_compose
//   were never added to OPS:
//     t-use-your-suggest-contacts-tool-w-2026-09-01
//     t-use-your-social-compose-tool-wit-2026-09-01
//     t-call-social-compose-with-title-t-2026-09-01
//   (Confirmed live 2026-09-29T17:16Z; the instances were quarantined in
//   chat_feed_quarantine_20260926 the same hour, which removed them from /rss.xml,
//   /api/feed, /api/sessions and /api/session/<id>. But /api/gate still returned
//   public:true for 'Use your suggest_contacts tool with topic=...', so the GATE was
//   still open and any newly added tool could leak the same way.)
//   TOOLINV replaces name-enumeration with the generic IMPERATIVE TOOL-INVOCATION
//   SHAPE. Validation against all 40 live titles: 3/3 leaks caught, 0 false positives;
//   10 adversarial probes all correctly unmatched ("Call it with caution", "Use your
//   own judgement", "call a function with keyword arguments", "Run the numbers",
//   "The tool with no name"). Fail-closed: an imperative tool directive is never a
//   public title. Deliberately NOT in INTERNAL/OPS, which also feed blocked(), so this
//   gate cannot quarantine whole threads.
// idea-hub v1.0.6-quarantine-wired-20260926
// Fixes #1179 QUARANTINE-TABLE-NOT-WIRED-1: chat_feed_quarantine_20260926 was written by the
//   integrity sweep but never read by this gate, so its 257 rows / 38 threads were inert.
//   blocked() now consults the quarantine set FIRST, so a quarantined thread cannot reach
//   /api/feed, /api/sessions, /rss.xml or /api/session/<id> regardless of title or content.
//   This also supplies the retraction path #1182 says is missing: the one thread quarantined
//   for "content error ... retracted 2026-09-26 (err-20260926-001)" is now withheld by
//   mechanism rather than by accident. Fail-closed on D1 error, consistent with the
//   pre-existing content scan. Set cached 60s. /health reports the wired count.
// Carries forward v1.0.5-boundary-match-20260926 (fix #1168 FEED-GATE-SUBSTRING-COLLISION-1:
//   single alphanumeric denylist tokens are matched with word boundaries
//   (?<![a-z0-9])token(?![a-z0-9]); phrases keep substring matching).
var VERSION = "1.18.0-codeagent";
/* 1.17.0 RESEARCH-INTAKE-RIGID-1 (owner directive 2026-11-04, pillar research; minor): machine accepts enter research_queue only as real conjectures; scan titles, re-entry fragments and JSON lists stay in idea_proposals as triaged_hold. */ // 1.14.6 IDEAS-HUB-SLOW-RSS-1 part 2 (agent_issues 1000460): all() reads the public-gate flags of every thread in one query (threadFlags, blockedBy) instead of one blocked() query per thread that pulled up to 200 message bodies, so a cold build of the feed and the sessions list drops from 3 to 4.5 s to well under 1 s; the gate rules are unchanged and archive rows with no chat rows are skipped without a query. 1.14.5 IDEAS-HUB-SLOW-RSS-1 (agent_issues 1000460): /rss.xml and /api/sessions (also /api/feed) are served from the ideasCached stored copy (max-age 120, rebuilt in the background after 2 minutes, keyed by the clamped limit) instead of building 500 threads with one gate query each on every read (3 to 5 s, one read in four timed out). 1.14.4 IDEA-TRIAGE-COOLING-STARVE-1 (agent_issues 1000411; see the comment above triageProposals). // 1.14.3 PROPOSAL-COOLING-1 + REENTRY-EVENT-1 (2026-10-26, agent_issues 1000244, pillar autonomy): (1) a proposal that IDEA-SCORING-POISON-1 could not score (a "[scoring-error" marker in rationale, 24 of the 33 'new' rows on 2026-10-26) no longer counts against PROPOSAL_BACKPRESSURE and PROPOSAL_FILL_TO in proposalRoom, runConsume, runOwnerCorpus, thinkLoop and runAskGap, which had held the count above 30 and kept re-entry consumption and the producers paused; triage's own selection of those rows is unchanged. It does not by itself clear the chaos drill of 1000244. (2) The re-entry leg's result is persisted once per cycle to cloud_ops_events id 'idea-reentry' (scanned, emitted, emit_error, owner_dois, owner_dois_capped, scan_capped; status error when the leg threw or its emission block failed), and a run that reads REENTRY_SCAN_LIMIT (500) papers says so in scan_capped. idea-hub/reentry-drain.test.mjs, idea-hub/proposal-headroom.test.mjs, migrations/2026-10-26-reentry-bind-limit.sql. // 1.14.2 REENTRY-BIND-LIMIT-1 (2026-10-26, agent_issues 1000244, pillar autonomy): runReentry bound the 5 owner identifier types plus up to 200 owner-pipeline DOIs in one IN (?,?,...) list, and D1 allows 100 bound parameters per query ("too many SQL variables"); the owner pipeline reached 99 DOIs at the 2026-10-19 00:25Z cycle, so the papers query threw on every hourly cycle after it (ideationCycle swallowed the throw into r.reentry), emission and both drain legs never ran, and 17 artifact_reentry rows stayed new with weight 0, none consumed in 7 days. The DOIs now travel as one JSON parameter read by json_each(?) (6 bound parameters at any DOI count), the owner-DOI slice(0, 200) that would have silently dropped papers past 200 is a 5000 growth bound that reports itself, a failure of the emission block (papers or signals read) no longer stops the drain legs, and the swallowed cycle error is logged. idea-hub/reentry-drain.test.mjs. // 1.14.0 WEBMCP-FLEET-1: expose the generated tool bridge on the rendered page. // 1.13.0 IDEA-SCORING-POISON-1 (2026-10-19, agent_issues 100145, pillar autonomy; minor: a decision triage now takes on its own): a row that no model in T_CHAIN can score (no JSON, an invalid scorecard) stayed status new, was scored again by up to four models on every hourly cycle, and counted out.errors, so fleet_heartbeat idea-hub read ok=0 on every cycle since 2026-10-19 10:32Z (CRON-FAULT-1 100145, four consecutive failures by 16:32Z) while ai_call_counters showed no API error (0 errors in 130 triage calls a day, the fallback models glm-5.3 and deepseek answering 74 of them). Row 1923 (owner-corpus) sat new from 13:25Z. A scoring failure of a generated or corpus row is now recorded on the row (rationale [scoring-error N ISO] reason, no new column), the row is retried on the next cycles up to 3 times and then once every 24 hours, rows without a failure marker are taken first so a failing row cannot starve the batch, and it is counted as scoring_failed (event meta scoring_failed, scoring_cooling, scoring_error, errors) and not as errors: a model that cannot read one text is not a cron fault, while a thrown error still is. A row scored later has its marker replaced by the rationale. idea-hub/scoring-failure.test.mjs. // 1.12.0 IDEAS-CAP-RATE-1 (2026-10-19, agent_issues 100047, pillar research, ANTIFRAGILE-1): the research admission cap held generated accepts with no expiry, and the 1.11.1 release only fitted rows under the cap while research_queue sat at 473 of 120, so 80 accepts (oldest about 45 h) were never admitted; at or over the cap triage now admits CAP_TRICKLE_PER_RUN (3) oldest held rows per run, logs each trickle run to cloud_ops_events (kind idea-cap-trickle), and keeps the room path unchanged; ops_config ideas_cap_trickle_per_run (0 to 12) overrides the rate and 0 restores the old hold without a deploy. // 1.11.3 CRON-GRID-1 (owner directive 2026-10-19: every cron tick on the 5-minute grid, none slower than hourly): trigger minute moved onto the 5-minute grid (:23 -> :25). /* 1.11.1 IDEAS-CAP-GENERATED-RELEASE-1 (2026-10-19, agent_issues 100047, pillar research): triage re-queues accepts the research admission cap held, oldest first, as many as fit under the cap; they were stranded for good before. */ // 1.11.0 REACH-IDEA-1 (2026-10-19, agent_issues 2480, pillar reach): every /s/ thread page carries the subscribe box the home page has (ideaSubBox, shared). Carries 1.10.12 IDEAS-INTAKE-OWNER-1 from main.
// Diversity enforcement: ensure no topic exceeds 50% of accepted proposals in the last 30 days.
const MAX_TOPIC_SHARE = 0.5;
async function applyDiversityConstraint(proposal, getRecentAccepts) {
  // Retrieve recent accepted proposals (last 30 days) and count topics
  const recent = await getRecentAccepts();
  const topicCounts = recent.reduce((acc, p) => {
    acc[p.topic] = (acc[p.topic] || 0) + 1;
    return acc;
  }, {});
  const total = recent.length;
  const proposalTopicCount = (topicCounts[proposal.topic] || 0) + (proposal.status === 'ACCEPT' ? 1 : 0);
  if (total > 0 && proposalTopicCount / total > MAX_TOPIC_SHARE) {
    proposal.status = 'deferred_diversity';
  }
} // 1.10.1 WORKERS-BP-LOGGING-idea-hub-1 (agent_issues 2527, child of WORKERS-BP-LOGGING-1 #2342, pillar autonomy): the 14 server-side empty catches (the public feed and session reads, the aiRunAttr counters, the triage tail writes, re-entry consume, the think seed reads, the owner token read) log console.error(JSON.stringify({worker, where, error})) to Workers Logs; the two model-reply JSON.parse catches state why a failure is expected (a fallback follows and records it); the MathJax catch is browser script inside a server string (standards-ok). Control flow unchanged. 1.10.0 TOPIC-CLUSTERS-DERIVED-1 (ACCURACY-FLEET-2a, agent_issues 2281, owner directive 2026-10-10 no topic or noun hard-coded): the diversity cap reads topic clusters derived from the ACCEPTed idea_proposals of the last 90 days (top content words by document frequency, producer boilerplate dropped, grouped by co-occurrence, cached in ops_config idea_topic_clusters, re-derived when older than 72 h) instead of the fixed IDEA_TOPIC_CLUSTERS table; a proposal is placed by its idea text; no data gives no clusters and no hold. Shared block identical to qnfo-cloud-ops 1.28.0. 1.9.0 IDEA-NOVELTY-1 (agent_issues 2409): triage screens each generated ACCEPT against its nearest QNFO-corpus and arXiv neighbours (overlap labelled by a model of another family; duplicate, substantial overlap with no stated delta, or a low practical payoff outside the foundational quota hold it). HUB-CACHE-VERSION-2 (agent_issues 2484): the cached ideas.qnfo.org pages carry the VERSION that built them, and a copy from another version is rebuilt while the request waits up to 2.5 s. 1.8.6 PROPOSAL-HEADROOM-1 (agent_issues 2489): the batch producers fill the triage queue only up to 25, so it stays under the chain limit of 30; nothing is dropped. 1.8.5 ZARAZ-MANUAL-LOAD-1 (#2345): pages load /cdn-cgi/zaraz/i.js themselves because Zaraz auto-inject does not touch Worker-served HTML. 1.8.4 ZARAZ-GA4-1: inline gtag.js removed (Zaraz serves GA4, one count per page view). 1.8.3 1.8.3 NOZ-DOI-1 (2026-10-11): the home page links no DOI of the dead registrar; re-entry keys a paper by its DOI when it has one and by its slug otherwise (papers written from now on carry no DOI), and REENTRY_OWNER_TYPES names the owner identifier types without the registrar. 1.8.2 // 1.8.2 NO-TOPIC-HARDCODE-1 (owner directive 2026-10-10): the think-loop fallback seed names no topic (it lists the loop's own recent questions from self_questions) and the scorecard prompt names no field. 1.8.1 OWNER-CORPUS-RATE-1 (#2185): a full research_queue slows the owner-corpus leg to 2 notes per cycle instead of pausing it. // 1.8.0 HOLD-RELEASE-REENTRY-1 (#2174): re-entry signals from non-owner papers are admitted at REENTRY_NONOWNER_PER_DAY (2) per UTC day instead of expired; the rest wait as new; owner-paper re-entries unlimited. // 1.7.6 CORPUS-REASONING-1 (#2185): owner-corpus extraction passes reasoning_effort low so dense notes no longer return an empty reply. // 1.7.3 OWNER-SIGNAL-INTAKE-2b: a pipeline paper whose research row came from an owner proposal counts as an owner paper for re-entry. // 1.7.2 REASONING-BUDGET-1 + OWNER-SIGNAL-INTAKE-2 + PROMPT-CACHE-COUNT-2 (2026-10-07, pillars research and cost): glm-5.3-flash is a reasoning model and spent all 700 scoring tokens thinking (finish length, empty content; measured 2026-10-07 11:40Z: 1,538 completion tokens needed), so triage scoring failed on rows 828/831 every hour; scoring and notebook extraction now get REASONING_MAX_TOKENS 2000. A failed notebook extraction is retried (3 tries, a day apart) instead of being lost; dated pre-fleet notes are read first; re-entry consumes only signals of the owner's own papers and drops sentences that merely mention an open question; aiRunAttr keeps ai_call_counters and adds ai_cache_counters plus the PROMPT-CACHE-1 session-affinity header (issue 2113, replacing code task ct_yghmskhqci2vv1, which dropped the call counters). // 1.7.0 OWNER-SIGNAL-INTAKE-1 (#1947 #2103 #2104, pillar research, owner directive 2026-10-07 "an integrated platform where all information is shared and leveraged across the fleet. No siloes!"): owner-authored proposals are ACCEPTed (scored for the record, never held by the model), ask-gap rows skip the chat-question filter, a new owner-corpus feeder distils research ideas from the owner's Obsidian notebook (notes_intake + R2 obsidian-vault) into the one intake, re-entry reads only the owner's own papers (slug/doi/internal types), and the think loop is seeded from the owner's accepted ideas instead of fixed quantum themes. Supersedes code task ct_hdaim0vx7h7vvl (1.6.2-codeagent). // 1.6.1 RULE-8-RETIRED-1 (2026-10-06, pillar cost): the /health limitation no longer says triage makes no model call while an ai_spend cap is breached; it scores on one cheap model since 1.6.0. // 1.6.0 BUDGET-SOFT-ROUTE-1 (2026-10-06, pillar cost, owner directive): an ai_spend cap no longer defers triage; proposals are scored by one cheap model while a cap is breached, deferred_budget rows are released every run, and diversity-held rows are released regardless of the caps. // 1.5.8 IDEA-DIVERSITY-CAP-1 (#1947, pillar research): triage holds a generated ACCEPT as deferred_diversity while its topic cluster would exceed half of the 30-day accepts (classifier identical to qnfo-cloud-ops IDEA_TOPIC_CLUSTERS), releases held rows best score first with no model call; 1.5.7 REACH-IDEA-1 (#2001, pillar reach): the home page carries a subscribe box (email input) posting to /api/subscribe, which forwards to the qnfo-subscribers double opt-in with source ideas.qnfo.org; 1.5.6 reentry-drain; 1.5.5 triage-budget; 1.5.4 (2026-10-05, #1919 #1920 + slow build): QNFO pages carry the 1200x630 share card and an iPatent link; ideasCached serves a stale copy at once and rebuilds in the background (an uncached build took ~12 s)
// ---- QDS-SHELL:BEGIN (generated from qnfo-gateway QDS-1; links https://qnfo.org/qds.css and qds.js) ----
var QDS_OWNER_ORCID = "0009-0002-4317-5604";
// The QNFO design system (QDS). Tokens, type and components live in ONE stylesheet served from here at
// https://qnfo.org/qds.css (any gateway host) and linked by every QNFO, QWAV and q08 surface, with qds.js for the theme
// toggle, sticky header and the article table of contents. Pages declare <html data-brand="qnfo|qwav|q08">. Reading
// type is Newsreader, interface type Familjen Grotesk; light and dark themes follow the OS unless the visitor picks one.
// Replaces the 2026-08-31 paper-and-ink system (qnfo-web-unified/README.md, STRATEGY 2.5), owner decision 2026-10-02.
var QDS_VERSION = "1.0.0";
var QDS_ORIGIN = "https://qnfo.org";
var QDS_FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Familjen+Grotesk:wght@400;500;600&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400&display=swap">';
var GA4_MEASUREMENT_ID = "G-LV7RHRVW6R";
/* GA4-COLLECT-RESTORE-1 (2026-10-25, owner report: Google Analytics is not collecting recent data for qnfo.org): measured from the GA4 Data API, papers.qnfo.org served 84-203 page views a day through 2026-10-12, then the property received 0 rows on 2026-10-13 and 1-8 a day after; no qnfo.org or papers.qnfo.org row exists after 10-12. The Zaraz GA4 action does fire at the edge (debug: 'Action called: Pageview from Google Analytics 4') but issues no request and GA4 stores nothing. ZARAZ-GA4-1 (5e88c1e0, 2026-10-12 14:00) removed this gtag.js on the assumption Zaraz counted every page view once; it counted zero. The direct tag is restored and the Zaraz loader is removed, so gtag.js sends one page view and there is no second counter. */
var GA4_TAG = "";
var QDS_GA = GA4_TAG; /* GA4-COLLECT-RESTORE-1 */
var QDS_MATHJAX = '<script>window.MathJax={tex:{inlineMath:[["$","$"],["\\\\(","\\\\)"]],displayMath:[["$$","$$"],["\\\\[","\\\\]"]],processEscapes:true},svg:{scale:1.05,fontCache:"global"},options:{skipHtmlTags:["script","noscript","style","textarea","pre","code"],enableMenu:false}};function __mq(){if(window.MathJax&&MathJax.typesetPromise){MathJax.typesetPromise().catch(function(){})}}if(document.readyState==="complete"){setTimeout(__mq,150)}else{window.addEventListener("load",function(){setTimeout(__mq,150)})}<\/script><script src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg-full.js" id="MathJax-script" defer onerror="this.onerror=null;var s=document.createElement(&quot;script&quot;);s.src=&quot;https://unpkg.com/mathjax@3/es5/tex-svg-full.js&quot;;document.head.appendChild(s);"><\/script>'; // standards-ok: browser script inside a server string
var QDS_MARK = {
  qnfo: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M6 16h7M13 16l7-8M13 16l7 8M20 8h6M20 24h6M20 8l4-4M20 24l4 4" stroke="var(--q-accent)" stroke-width="2.4" fill="none" stroke-linecap="round"/><circle cx="6" cy="16" r="3" fill="var(--q-ink)"/></svg>',
  qwav: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M3 19c3.2-7 6.4-7 9.6 0s6.4 7 9.6 0c2-4.4 4-5.6 6.8-4" stroke="var(--q-accent)" stroke-width="2.4" fill="none" stroke-linecap="round"/><circle cx="3.5" cy="19" r="2.6" fill="var(--q-ink)"/></svg>'
};
var QDS_FAVICON = {
  qnfo: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23182042'/%3E%3Cpath d='M6 16h7M13 16l7-8M13 16l7 8M20 8h6M20 24h6' stroke='%235FD3C4' stroke-width='2.6' fill='none' stroke-linecap='round'/%3E%3C/svg%3E",
  qwav: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23182042'/%3E%3Cpath d='M4 18c3-6.5 6-6.5 9 0s6 6.5 9 0c1.8-4 3.6-5 6-3.6' stroke='%239AA6FF' stroke-width='2.6' fill='none' stroke-linecap='round'/%3E%3C/svg%3E"
};
var QDS_THEME_BTN = '<button class="q-theme" type="button" data-q-theme aria-label="Switch between light and dark theme"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 1.8a6.2 6.2 0 0 1 0 12.4z" fill="currentColor"/></svg></button>';
var QDS_MENU_ICON = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
// One navigation for the QNFO family. QWAV and q08 are separate labels (STRATEGY 2.1) and are not linked from here.
var QDS_NAV_QNFO = [
  { k: "papers", t: "Papers", h: "https://papers.qnfo.org/papers" },
  { k: "ask", t: "Ask the corpus", h: "https://ask.qwav.tech/" },
  { k: "ideas", t: "Ideas", h: "https://ideas.qnfo.org/" },
  { k: "archive", t: "Archive", h: "https://archive.qnfo.org/" },
  { k: "about", t: "About", h: "https://qnfo.org/about" },
  { k: "work", t: "Work with me", h: "https://qnfo.org/work-with-me" }
];
var QDS_NAV_QWAV = [
  { k: "jpcub", t: "JPCUB", h: "https://qwav.org/#jpcub" },
  { k: "stack", t: "Architecture", h: "https://qwav.org/#stack" },
  { k: "landscape", t: "Landscape", h: "https://qwav.org/#landscape" },
  { k: "research", t: "Research", h: "https://qwav.org/#research" },
  { k: "ask", t: "Ask", h: "https://ask.qwav.tech/" }
];
function qdsAttr(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
// The <head> every page shares. o: title, description, canonical, brand, ogType, jsonld (string), math (bool), extra (string),
// rss (bool), robots.
function qdsHead(o) {
  const brand = o.brand || "qnfo";
  const t = qdsAttr(o.title), d = qdsAttr(o.description || "");
  const site = brand === "qwav" ? "QWAV" : "QNFO";
  return '<!DOCTYPE html><html lang="en" data-brand="' + brand + '"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">' +
    "<title>" + t + '</title><meta name="description" content="' + d + '">' + (o.canonical ? '<link rel="canonical" href="' + qdsAttr(o.canonical) + '">' : "") +
    (o.robots ? '<meta name="robots" content="' + qdsAttr(o.robots) + '">' : "") +
    '<meta name="author" content="Rowan Brad Quni-Gudzinas"><meta property="og:site_name" content="' + site + '"><meta property="og:title" content="' + t + '"><meta property="og:description" content="' + d + '"><meta property="og:type" content="' + (o.ogType || "website") + '">' +
    (o.canonical ? '<meta property="og:url" content="' + qdsAttr(o.canonical) + '">' : "") + '' + (brand === "qwav" ? '<meta name="twitter:card" content="summary">' : '<meta property="og:image" content="https://qnfo.org/og.jpg"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image">') + '<meta name="twitter:title" content="' + t + '"><meta name="twitter:description" content="' + d + '">' +
    '<meta name="theme-color" content="#F5F7FB" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#121731" media="(prefers-color-scheme: dark)">' +
    '<link rel="icon" type="image/svg+xml" href="' + QDS_FAVICON[brand === "qwav" ? "qwav" : "qnfo"] + '">' +
    (o.rss ? '<link rel="alternate" type="application/rss+xml" title="QNFO Papers" href="https://papers.qnfo.org/rss.xml">' : "") +
    QDS_FONTS + '<link rel="stylesheet" href="' + QDS_ORIGIN + "/qds.css?v=" + QDS_VERSION + '"><script src="' + QDS_ORIGIN + "/qds.js?v=" + QDS_VERSION + '" defer><\/script>' +
    (o.jsonld || "") + (o.math ? QDS_MATHJAX : "") + (o.extra || "") + QDS_GA + "</head>";
}
function qdsHeader(brand, active) {
  const nav = brand === "qwav" ? QDS_NAV_QWAV : QDS_NAV_QNFO;
  const home = brand === "qwav" ? "https://qwav.org/" : "https://qnfo.org/";
  const name = brand === "qwav" ? "QWAV" : "QNFO";
  const links = nav.map(function(n) {
    return '<a href="' + n.h + '"' + (n.k === active ? ' aria-current="page"' : "") + ">" + n.t + "</a>";
  }).join("");
  return '<a class="q-skip" href="#main">Skip to main content</a><header class="q-top"><div class="q-wrap"><a class="q-brand" href="' + home + '" aria-label="' + name + ' home">' + QDS_MARK[brand === "qwav" ? "qwav" : "qnfo"] + name + "</a>" +
    '<nav class="q-nav q-nav-wide" aria-label="Main">' + links + "</nav>" +
    '<details class="q-menu"><summary aria-label="Menu">' + QDS_MENU_ICON + '</summary><nav class="q-nav" aria-label="Main">' + links + "</nav></details>" + QDS_THEME_BTN + "</div></header>";
}
function qdsFooter(brand) {
  if (brand === "qwav") {
    return '<footer class="q-foot"><div class="q-wrap"><div class="q-foot-grid"><div><a class="q-brand" href="https://qwav.org/">' + QDS_MARK.qwav + 'QWAV</a><p style="margin-top:12px;max-width:36ch">A pre-commercial computing platform concept, benchmarked in joules per correct answer. Research by Rowan Brad Quni-Gudzinas, published by QNFO.</p></div>' +
      '<div><h2>Platform</h2><ul><li><a href="#jpcub">JPCUB benchmark</a></li><li><a href="#stack">Architecture</a></li><li><a href="#landscape">Landscape</a></li><li><a href="#research">Research</a></li></ul></div>' +
      '<div><h2>Research</h2><ul><li><a href="https://papers.qnfo.org/papers">Papers</a></li><li><a href="https://ask.qwav.tech/">Ask the corpus</a></li><li><a href="https://papers.qnfo.org/rss.xml">RSS</a></li></ul></div>' +
      '<div><h2>Legal</h2><ul><li><a href="https://legal.qnfo.org/">License (QNFO-ULA v2.0)</a></li><li><a href="https://qnfo.org/about">About the author</a></li></ul></div></div>' +
      '<div class="q-foot-base"><span>\u00a9 2025\u20132026 Rowan Brad Quni-Gudzinas</span><span>Research content under QNFO-ULA v2.0. No commercial product exists yet.</span></div></div></footer>';
  }
  return '<footer class="q-foot"><div class="q-wrap"><div class="q-foot-grid"><div><a class="q-brand" href="https://qnfo.org/">' + QDS_MARK.qnfo + 'QNFO</a><p style="margin-top:12px;max-width:38ch">The independent research imprint of Rowan Brad Quni-Gudzinas. Every work carries a DOI, and corrections ship as new versions.</p></div>' +
    '<div><h2>Research</h2><ul><li><a href="https://papers.qnfo.org/papers">Papers</a></li><li><a href="https://qnfo.org/#selected-works">Selected works</a></li><li><a href="https://ask.qwav.tech/">Ask the corpus</a></li><li><a href="https://ideas.qnfo.org/">Ideas</a></li><li><a href="https://archive.qnfo.org/">Archive</a></li><li><a href="https://ipatent.qnfo.org/?utm_source=ideas.qnfo.org&amp;utm_medium=referral&amp;utm_campaign=footer">iPatent: free provisional patent drafting</a></li></ul></div>' +
    '<div><h2>Author</h2><ul><li><a href="https://qnfo.org/about">About</a></li><li><a href="https://qnfo.org/work-with-me">Work with me</a></li><li><a href="https://orcid.org/' + QDS_OWNER_ORCID + '">ORCID ' + QDS_OWNER_ORCID + '</a></li><li><a href="https://qnfo.org/work-with-me#contact">Contact</a></li></ul></div>' +
    '<div><h2>Follow</h2><ul><li><a href="https://qnfo.org/#subscribe">New papers by email</a></li><li><a href="https://papers.qnfo.org/rss.xml">RSS</a></li><li><a href="https://legal.qnfo.org/">License (QNFO-ULA v2.0)</a></li><li><a href="https://legal.qnfo.org/privacy">Privacy</a></li></ul></div></div>' +
    '<div class="q-foot-base"><span>\u00a9 2025\u20132026 QNFO \u00b7 Rowan Brad Quni-Gudzinas</span><span>Prepared with an AI-assisted research pipeline; the author is responsible for the content.</span></div></div></footer>';
}
function qdsPage(o, body) {
  return qdsHead(o) + "<body>" + qdsHeader(o.brand || "qnfo", o.active) + '<main id="main">' + body + "</main>" + qdsFooter(o.brand || "qnfo") + (o.scripts || "") + "</body></html>";
}
// ---- QDS-SHELL:END ----

const BASE='https://ideas.qnfo.org';
const INTERNAL=['system-reminder','<system-reminder','system prompt','role instructions','respond with the exact first sentence','reply with ok','reply with exactly','write 200 words','write one self-contained python','extract every quantitative claim','you are an adversarial reviewer','you are the revising author','revision round-2 mandate','l8 specification','operator-shared thread','numerical verification sprint','paper-reviser','tool_call','tool result','strict json only','compare paqit','guard-probe','probe-','research and publish','calendar event','email received','attachment_file','file_index','file_key','file_content','read-only context data','working memory','context-data','treat them strictly as data'];
const OPS=['audit and remediate','remediate all failure modes','failure-mode','failure modes','backlog','open issues','ops_issue_run','fleet_status','backlog_status','ops_d1_query','ops_d1_write','cf_worker_read','cf_worker_deploy','cf_worker_bindings','workspace_write','workspace_read','web_fetch','web_search','github_','r2_','kv_','vectorize_query','telemetry_report','telemetry_analyze','dr_validate_schema','service_discover','shell_exec','exec_python','exec_node','container_status','qnfo-ops','worker deploy','patches not deployed','source drift','canonical source','binding missing','retired health stub','email-orchestrator','schema guard','dod audit','claim sheet','wbs plan','confirm:true','dryrun','incomplete:','ops endpoint','server-side ops','cloudflare worker'];
const JUNK=['say ok','say okay','test','testing','what is the capital','who are you','what is your name','tell me a joke','write a poem','write me a','make me a','create me','explain like i','good morning','good night','thank you','thanks','continue','repeat','again','what time is it','write code','implement a','give this conversation a name','hello world','what is 2+2','daily planning','life advice','productivity','planning a','trip to','overwinter','show my partner','weather in','weather for','what color is in this image','what colour is in this image','color is in this image','colour is in this image','image?','what relevant conferences are coming up'];
let RESEARCH=[];
let _researchSet=null,_researchAt=0;
const RESEARCH_TTL=300000;
async function refreshResearchTerms(env){
  const n=Date.now();
  if(_researchSet&&n-_researchAt<RESEARCH_TTL)return _researchSet;
  let terms=[];
  try{
    const data=await loadTopicClusters(env.QNFO_AUDIT,false);
    terms=(data.clusters||[]).flatMap(c=>Array.isArray(c.terms)?c.terms.map(String):[]);
  }catch(e){console.error(JSON.stringify({worker:"idea-hub",where:"refreshResearchTerms",error:String(e&&e.message||e).slice(0,300)}))}
  _researchSet=terms;
  RESEARCH=terms;
  _researchAt=n;
  return terms;
}
function cors(){return {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type'};}
function json(x,s=200){return new Response(JSON.stringify(x),{status:s,headers:{...cors(),'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}})}
// IDEAS-PUBLIC-FILTER-1 (2026-10-04): strip client-injected blocks BEFORE any public gate. Every
// DeepChat message now carries an <ATTACHMENT_FILE> block and/or the "read-only context data /
// working memory" <context-data> block; publicTitle() matched those as INTERNAL ('attachment_file',
// 'working memory') and rejected genuine research questions as if they were internal prompts.
function stripInj(s){return String(s||'').replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi,' ').replace(/<system-reminder>[\s\S]*$/gi,' ').replace(/<attachment_file>[\s\S]*?<\/attachment_file>/gi,' ').replace(/<context-data[^>]*>[\s\S]*?<\/context-data>/gi,' ').replace(/<file_content>[\s\S]*?<\/file_content>/gi,' ')}
function clean(s,max=240){return stripInj(s).replace(/^(User|Assistant|System|Human|AI)\s*:\s*/i,'').replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,'[redacted]').replace(/\b[A-Za-z0-9_-]{24,}\b/g,'[redacted]').replace(/\s+/g,' ').trim().slice(0,max)}
function reEsc(s){return String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}
const _wordRe=new Map();
function wordHit(t,p){let re=_wordRe.get(p);if(!re){re=new RegExp('(?<![a-z0-9])'+reEsc(p)+'(?![a-z0-9])','i');_wordRe.set(p,re)}return re.test(t)}
function has(s,a){const t=String(s||'').toLowerCase();return a.some(function(x){const p=String(x).toLowerCase();if(/^[a-z0-9]+$/.test(p))return wordHit(t,p);return t.includes(p)})}
// F10-RSS-PIPELINE-STAMP-GATE-1 (issue #1412, 2026-09-29): publicTitle() previously
// required only a RESEARCH token, so an orchestrator retry stamp prefixed to the idea
// summary passed verbatim into the public RSS title. Live reproduction (external curl,
// 2026-09-29T17:11:22Z) item 2 of https://ideas.qnfo.org/rss.xml read
//   "RETRY (prior submission was dropped by an expressed-step abort). Notation-commissioning
//    audit: ... physics and quantum mechanics."
// It passed because "physics"/"quantum" are RESEARCH tokens and the stamp matches no
// INTERNAL/OPS/JUNK entry. Detected here, before the lists; deliberately NOT in INTERNAL,
// which also feeds blocked() and would quarantine whole threads on a phrase like
// "before execution". Fail-closed: a stamped summary is never a public title.
const STAMP=/(prior submission was dropped|expressed-step abort|dropped by an expressed|notation-commissioning|cross-link to qnf-|cross-link to dlf-|before execution|retry\s*\()/i;
// F10-TOOLINV-GATE-1 (issue #1412 residual class, 2026-09-29): see header. Matches the
// generic imperative tool-invocation SHAPE, not a tool-name list, so a newly registered
// tool cannot leak as a public title. Validated: 3/3 live leaks caught, 0/40 live titles
// and 0/10 adversarial probes false-positive.
const TOOLINV=/(?:use|invoke|call|run)\s+(?:your\s+|the\s+|a\s+|an\s+)?[a-z][a-z0-9_]{1,}(?:_[a-z0-9]+)*\s+(?:tools?|functions?|verbs?|apis?|endpoints?|actions?)\b|call\s+[a-z][a-z0-9_]{1,}(?:_[a-z0-9]+)+\s+with\b|(?<![a-z0-9])[a-z][a-z0-9]*(?:_[a-z0-9]+)+\s+(?:tool|function|verb)\b/i;
// pubQuestion: denylist safety gate only (no RESEARCH allowlist) -- the fleet's own self-questions
// and triaged idea proposals are research questions by construction, so requiring one of 39 exact
// RESEARCH tokens would silently drop them. publicTitle keeps the allowlist for arbitrary chat threads.
// ROLEPROMPT-SHAPE-GATE-1 (2026-10-04): a public question is never an instruction addressed to a
// model. Blocking the SHAPE (role assignment / imperative writer prompt) catches the paper-pipeline
// prompts that were not enumerated in INTERNAL -- e.g. "You are the reconciling editor...", which
// leaked because "input block" matched the RESEARCH token 'block' and the role phrase was not listed.
const ROLEPROMPT=/^\s*(you are (the|an|a)\b|write (one|a|the|two)\b|extract (every|all|the)\b|produce (the|a|one|two)\b|output (the|a|only|strict)\b|audit (this|the)\b|reconcil(e|ing)\b|based on the chat history|give this conversation a name)/i;
// CROSS-LINK-FOLLOWUP-1 (issue #1001710): structural agent-prompt gate. blocked()/blockedBy() screened
// only phrase lists (INTERNAL/OPS/JUNK), so each NEW internal LLM task prompt leaked as a public idea
// thread until its phrase was enumerated. promptLike() tests the SHAPE of a task prompt instead.
const PROMPTLIKE=/^\s*(?:task\s+writer|task\s+reviewer|task\s+judge|you\s+are\s+one\s+of\b|you\s+are\s+(?:a|an|the)\b|you\s+are\s+now\b|answer\s+the\s+question\s+using\s+only\b|your\s+(?:task|role|job)\s+is\b|act\s+as\s+(?:a|the)\b|follow\s+these\s+instructions\b)/i;
function promptLike(s){return PROMPTLIKE.test(clean(s,4000))}
function pubQuestion(s){const t=clean(s,1000);if(STAMP.test(t))return false;if(TOOLINV.test(t))return false;if(ROLEPROMPT.test(t))return false;if(PROMPTLIKE.test(t))return false;return t.length>=12&&!has(t,INTERNAL)&&!has(t,OPS)&&!has(t,JUNK)}
function publicTitle(s){const t=clean(s,1000);return pubQuestion(t)&&(!RESEARCH.length||has(t,RESEARCH))}
function ts(v){if(!v)return null;if(typeof v==='number')return new Date(v).toISOString();let s=String(v).replace(' ','T');if(!/Z$|[+-]\d\d:\d\d$/.test(s))s+='Z';const d=new Date(s);return Number.isNaN(d.getTime())?String(v):d.toISOString()}
let _qSet=null,_qAt=0;
async function quarantined(env){const n=Date.now();if(_qSet&&n-_qAt<60000)return _qSet;const r=(await env.QNFO_AUDIT.prepare('SELECT DISTINCT thread FROM chat_feed_quarantine_20260926 WHERE thread IS NOT NULL LIMIT 5000').all()).results||[];_qSet=new Set(r.map(function(x){return String(x.thread)}));_qAt=n;return _qSet}
let _eSet=null,_eAt=0;
// CONTENT-ACCURACY-NOT-A-GATE-1 (#1182): threads named by an open internal_errata row (target_kind chat_log, target_ref '<thread>:...') are withheld by mechanism, independent of title/substring gates.
async function errataThreads(env){const n=Date.now();if(_eSet&&n-_eAt<60000)return _eSet;const r=(await env.QNFO_AUDIT.prepare("SELECT target_ref FROM internal_errata WHERE target_kind='chat_log' AND COALESCE(status,'open') NOT IN ('closed','resolved','rejected') LIMIT 5000").all()).results||[];_eSet=new Set(r.map(function(x){return String(x.target_ref).split(':')[0]}));_eAt=n;return _eSet}
// IDEAS-PUBLIC-FILTER-1: withhold a thread only when it is FUNDAMENTALLY internal -- quarantined,
// named by open errata, carrying a system turn, or whose FIRST (public) user question is internal.
// Previously ANY internal substring in ANY turn hid the whole thread, so one injected context block
// or a bare "CONTINUE" follow-up buried a clean public question. Internal turns are stripped from the
// rendered transcript separately (session() / ideasThread()), so nothing internal is ever displayed.
async function blocked(env,id){try{if((await quarantined(env)).has(String(id)))return true;if((await errataThreads(env)).has(String(id)))return true;const r=(await env.QNFO_AUDIT.prepare('SELECT role,content FROM chat WHERE thread=? ORDER BY ts ASC,id ASC LIMIT 200').bind(id).all()).results||[];if(r.some(x=>x.role==='system'))return true;const first=r.find(x=>x.role==='user');if(!first)return true;const c=clean(first.content,4000);return promptLike(c)||has(c,INTERNAL)||has(c,OPS)||has(c,JUNK)}catch(e){return true}}
// IDEAS-HUB-SLOW-RSS-1 part 2 (1.14.6): all() asked blocked() for every thread, one D1 query each that pulled up to 200 message bodies (about 150 round trips, 3 to 4.5 s).
// threadFlags reads, for every thread at once, the only two facts blocked() takes from those rows (a system turn in the first 200, a user turn in the first 200) and no content.
// blockedBy applies the same rules as blocked(): quarantine, errata, a system turn, no user turn, then the INTERNAL / OPS / JUNK lists on the first user turn, which the caller already
// holds (the first user turn is what the thread query selects as its title). A thread with no row in the map has no chat rows, which blocked() also treats as blocked. null = unreadable: fall back to blocked().
async function threadFlags(env){try{const r=(await env.QNFO_AUDIT.prepare("SELECT thread,SUM(role='system') AS sys,SUM(role='user') AS usr FROM (SELECT thread,role,ROW_NUMBER() OVER (PARTITION BY thread ORDER BY ts ASC,id ASC) AS rn FROM chat) WHERE rn<=200 GROUP BY thread").all()).results||[];const m=new Map();for(const x of r)m.set(String(x.thread),{sys:Number(x.sys)||0,usr:Number(x.usr)||0});return m}catch(e){console.error(JSON.stringify({worker:"idea-hub",where:"threadFlags",error:String(e&&e.message||e).slice(0,300)}));return null}}
async function blockedBy(env,id,flags,firstUser){try{if(!flags)return await blocked(env,id);if((await quarantined(env)).has(String(id)))return true;if((await errataThreads(env)).has(String(id)))return true;const f=flags.get(String(id));if(!f||f.sys>0||f.usr===0)return true;const c=clean(firstUser,4000);return promptLike(c)||has(c,INTERNAL)||has(c,OPS)||has(c,JUNK)}catch(e){return true}}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;')}
async function all(env){await refreshResearchTerms(env);const rows=(await env.QNFO_AUDIT.prepare("SELECT c.thread AS id,COUNT(*) AS n,MIN(c.ts) first_ts,MAX(c.ts) last_ts,(SELECT content FROM chat c2 WHERE c2.thread=c.thread AND c2.role='user' ORDER BY c2.ts ASC,c2.id ASC LIMIT 1) title,(SELECT model FROM chat c2 WHERE c2.thread=c.thread ORDER BY c2.ts DESC LIMIT 1) model FROM chat c GROUP BY c.thread ORDER BY last_ts DESC LIMIT 500").all()).results||[];const flags=await threadFlags(env);const out=[];for(const r of rows){if(!publicTitle(r.title))continue;if(await blockedBy(env,r.id,flags,r.title))continue;out.push({id:r.id,kind:'thread',source:'live',title:clean(r.title,220),created_at:ts(r.first_ts)||ts(r.last_ts),updated_at:ts(r.last_ts)||ts(r.first_ts),message_count:Number(r.n)||0,model:r.model||null,tags:['conversation','live']})}try{const ar=(await env.QNFO_AUDIT.prepare("SELECT thread_id id,title,created_at,updated_at FROM chat_sessions WHERE category='research' ORDER BY COALESCE(updated_at,created_at) DESC LIMIT 500").all()).results||[];for(const r of ar){if(!publicTitle(r.title))continue;if(flags&&!flags.has(String(r.id)))continue;if(await blocked(env,r.id))continue;out.push({id:r.id,kind:'session',source:'archive',title:clean(r.title,220),created_at:ts(r.created_at),updated_at:ts(r.updated_at)||ts(r.created_at),message_count:0,model:null,tags:['conversation','archive']})}}catch(e){console.error(JSON.stringify({worker:"idea-hub",where:"all",error:String(e&&e.message||e).slice(0,300)}))}
// IDEAS-QUESTIONS-SOURCE-1 (2026-10-04): the fleet's own research questions and triaged proposals are
// the "latest QNFO prompts" -- generated hourly by the ideation loop but never read by this page
// before now (the feed only read chat threads). self_questions(open) + idea_proposals(accepted/hold).
try{const qr=(await env.QNFO_AUDIT.prepare("SELECT id,ts,question FROM self_questions WHERE status='open' ORDER BY ts DESC LIMIT 60").all()).results||[];for(const r of qr){if(!pubQuestion(r.question))continue;out.push({id:'q-'+r.id,kind:'question',source:'ideation',title:clean(r.question,300),created_at:ts(r.ts),updated_at:ts(r.ts),message_count:0,model:null,tags:['question','ideation']})}}catch(e){console.error(JSON.stringify({worker:"idea-hub",where:"all",error:String(e&&e.message||e).slice(0,300)}))}
try{const pr=(await env.QNFO_AUDIT.prepare("SELECT id,idea,status,created_at FROM idea_proposals WHERE status IN ('triaged_accepted','triaged_hold') ORDER BY created_at DESC LIMIT 120").all()).results||[];for(const r of pr){if(!pubQuestion(r.idea))continue;out.push({id:'p-'+r.id,kind:'proposal',source:'ideation',title:clean(r.idea,300),created_at:ts(r.created_at),updated_at:ts(r.created_at),message_count:0,model:null,tags:['proposal','ideation',String(r.status)]})}}catch(e){console.error(JSON.stringify({worker:"idea-hub",where:"all",error:String(e&&e.message||e).slice(0,300)}))}
const seen=new Set();return out.sort((a,b)=>Date.parse(b.updated_at||0)-Date.parse(a.updated_at||0)).filter(x=>{const k=x.title.toLowerCase().slice(0,100);if(seen.has(k))return false;seen.add(k);return true})}
async function rss(env){const it=(await all(env)).slice(0,40);const body='<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>QNFO Idea Factory</title><link>'+BASE+'/</link><description>Public read-only research conversations from QNFO - ideas as they develop.</description><lastBuildDate>'+new Date().toUTCString()+'</lastBuildDate>\n'+it.map(x=>'<item><title>'+esc(x.title)+'</title><link>'+BASE+'/s/'+encodeURIComponent(x.id)+'</link><guid isPermaLink="false">'+esc(x.id)+'</guid><description>'+esc(x.title)+'</description><pubDate>'+new Date(x.updated_at||x.created_at||Date.now()).toUTCString()+'</pubDate></item>').join('\n')+'\n</channel></rss>';return new Response(body,{headers:{...cors(),'Content-Type':'application/rss+xml; charset=utf-8','Cache-Control':'no-store'}})}
async function sessions(url,env){const limit=Math.min(Math.max(parseInt(url.searchParams.get('limit')||'50',10),1),100);return json({sessions:(await all(env)).slice(0,limit),limit})}
async function session(path,env){await refreshResearchTerms(env);const id=decodeURIComponent(path.split('/').slice(3).join('/'));if(/^[qp]-\d+$/.test(id)){const k=id[0],num=id.slice(2);let row=null;try{if(k==='q'){const r=(await env.QNFO_AUDIT.prepare("SELECT question AS q,ts,status FROM self_questions WHERE id=?").bind(num).all()).results||[];row=r[0];if(row)row={id:id,kind:'question',title:clean(row.q,500),status:row.status||'',created_at:ts(row.ts)}}else{const r=(await env.QNFO_AUDIT.prepare("SELECT idea AS q,created_at,status FROM idea_proposals WHERE id=?").bind(num).all()).results||[];row=r[0];if(row)row={id:id,kind:'proposal',title:clean(row.q,500),status:row.status||'',created_at:ts(row.created_at)}}}catch(e){console.error(JSON.stringify({worker:"idea-hub",where:"session",error:String(e&&e.message||e).slice(0,300)}))}if(!row||!pubQuestion(row.title))return json({error:'Session not found or not public'},404);return json(row)}const rows=(await env.QNFO_AUDIT.prepare('SELECT ts,role,content,model FROM chat WHERE thread=? ORDER BY ts ASC,id ASC LIMIT 500').bind(id).all()).results||[];const first=rows.find(r=>r.role==='user');if(!first||!publicTitle(first.content)||await blocked(env,id))return json({error:'Session not found or not public'},404);return json({id,title:clean(first.content,500),messages:rows.filter(r=>r.role!=='system'&&!has(r.content,INTERNAL)&&!has(r.content,OPS)&&!has(r.content,JUNK)).map(r=>({role:r.role,content:clean(r.content,200000),timestamp:ts(r.ts),model:r.model||null}))})}
function html(){return new Response('<!doctype html><meta charset="utf-8"><title>QNFO Ideas</title><h1>QNFO Ideas</h1><p>Public read-only research conversations as they develop.</p><p><a href="/rss.xml">RSS feed</a></p>',{headers:{...cors(),'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}})}

// ---- triage consumer (ported from qnfo-idea-triage 1.4.0) ----
// SLA-DRAIN-1 (1.10.2, 2026-10-14): 5 a run on the hourly cron is 120 a day, below the 128 a day that arrived on 2026-10-12..13, so
// the oldest new proposal aged past the 120-minute intake SLA. 10 a run keeps triage ahead of intake; acceptance still follows the
// scorer and the diversity cap, so the research queue sees the same accepts, sooner.
var TRIAGE_BATCH = 6;
var T_MODELS = { a: "@cf/zai-org/glm-5.3-flash", b: "@cf/deepseek-ai/deepseek-v4-flash-0731", tiebreak: "@cf/qwen/qwen3.8-27b" };
var T_CHAIN = ["@cf/zai-org/glm-5.3-flash", "@cf/zai-org/glm-5.3", "@cf/deepseek-ai/deepseek-v4-flash-0731"];
var ACCEPT_MIN = 0.8, FEAS_MIN = 0.5, RISK_MAX = 0.4, STD_TIE = 0.25;
// REASONING-BUDGET-1 (1.7.2): the triage and notebook models are reasoning models; their thinking counts against max_tokens,
// and at 700 glm-5.3-flash returned finish_reason length with no content. 2000 covers the measured 1,538.
var REASONING_MAX_TOKENS = 2000;
var T_KEYS = ["novelty", "technical_merit", "impact_potential", "exposure_potential", "feasibility", "risk"];
var SCORECARD_PROMPT = "You are QNFO's research-idea merit reviewer. Score the idea below for the QNFO autonomous research pipeline.\n" +
"Return JSON ONLY: {\"novelty\":0-1,\"technical_merit\":0-1,\"impact_potential\":0-1,\"exposure_potential\":0-1,\"feasibility\":0-1,\"risk\":0-1,\"rationale\":\"<=120 chars\",\"hook\":\"<=90 chars, one-line public-facing hook\"}\n" +
"Scoring guide: technical_merit = depth of technical content + verifiability; impact_potential = significance if proven; exposure_potential = breadth of audience/attention it can attract (social, media, cross-field); risk = probability of producing nothing citable (1 = near-certain dead end). IMPORTANT: feasibility means feasibility of the THEORETICAL/COMPUTATIONAL research itself (can the derivation, simulation, formal analysis, and computational verification be carried out by the QNFO autonomous pipeline) - NOT experimental testability. QNFO has no laboratory; an idea is feasible if its mathematics/computation can be executed and verified in silico, even if a confirming experiment would require external labs years away. Do NOT mark a theoretical idea infeasible merely because no experiment currently exists.\n" +
"IDEA: ";
function tExtract(r) {
  if (!r) return "";
  var ch = r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content;
  if (ch) return String(ch);
  if (typeof r.response === "string") return r.response;
  if (r.result && typeof r.result.response === "string") return r.result.response;
  if (r.response && typeof r.response === "object") return JSON.stringify(r.response);
  return "";
}
// COST-ATTRIBUTION (#1833): every env.AI.run here goes through aiRunAttr (the qnfo-fleet-control helper), which adds one
// per-worker/purpose call counter to D1 ai_call_counters (fail-soft, never blocks or alters the AI call).
async function aiRunAttr(env, worker, purpose, model, input, opts) {
  var t0 = Date.now(), ok = 1, res;
  try { res = await env.AI.run(model, input, promptCacheOpts(model, input, opts)); } catch (e) { ok = 0; throw e; }
  finally {
    try {
      var db = env.QNFO_AUDIT;
      if (db) {
        var ic = 0; try { ic = JSON.stringify(input && input.messages || input || "").length; } catch (e2) { console.error(JSON.stringify({ worker: "idea-hub", where: "aiRunAttr", error: String(e2 && e2.message || e2).slice(0, 300) })); }
        var day = new Date().toISOString().slice(0, 10);
        await db.prepare("CREATE TABLE IF NOT EXISTS ai_call_counters (day TEXT, worker TEXT, purpose TEXT, model TEXT, calls INTEGER DEFAULT 0, errors INTEGER DEFAULT 0, in_chars INTEGER DEFAULT 0, ms INTEGER DEFAULT 0, PRIMARY KEY (day, worker, purpose, model))").run();
        await db.prepare("INSERT INTO ai_call_counters (day, worker, purpose, model, calls, errors, in_chars, ms) VALUES (?1,?2,?3,?4,1,?5,?6,?7) ON CONFLICT(day, worker, purpose, model) DO UPDATE SET calls=calls+1, errors=errors+?5, in_chars=in_chars+?6, ms=ms+?7").bind(day, worker, purpose, String(model), ok ? 0 : 1, ic, Date.now() - t0).run();
        // PROMPT-CACHE-COUNT-2 (issue 2113): the same ai_cache_counters row the other fleet wrappers write (qnfo-ops form).
        var u = res && typeof res === "object" && res.usage || {};
        if (!/bge|embed|whisper|m2m100|resnet|flux|sdxl/i.test(String(model))) {
          var cTok = Number(u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens || u.cached_tokens || u.input_tokens_details && u.input_tokens_details.cached_tokens || 0) || 0;
          var inTok = Number(u.prompt_tokens || u.input_tokens || 0) || 0;
          await db.prepare("INSERT INTO ai_cache_counters (day, worker, model, calls, cached_calls, in_tok, cached_tok) VALUES (?1,?2,?3,1,?4,?5,?6) ON CONFLICT(day, worker, model) DO UPDATE SET calls=calls+1, cached_calls=cached_calls+excluded.cached_calls, in_tok=in_tok+excluded.in_tok, cached_tok=cached_tok+excluded.cached_tok").bind(day, worker, String(model).slice(0, 120), cTok > 0 ? 1 : 0, inTok, cTok).run();
        }
      }
    } catch (e3) { console.error(JSON.stringify({ worker: "idea-hub", where: "aiRunAttr", error: String(e3 && e3.message || e3).slice(0, 300) })); }
  }
  return res;
}
// PROMPT-CACHE-1 (fleet pattern, qnfo-ops): the same model and the same first 4 KB of prompt get the same session-affinity
// key, so Workers AI prefix caching bills the repeated scorecard prompt at the cached-input rate. Prompts under 1 KB and
// calls that already carry a key are left alone.
function promptCacheOpts(model, input, opts) {
  try {
    if (opts && opts.extraHeaders && opts.extraHeaders["x-session-affinity"]) return opts;
    var m = input && input.messages, c = m && m.length ? m[0].content : (input && input.prompt);
    var t = typeof c === "string" ? c : JSON.stringify(c || "");
    if (t.length < 1024) return opts;
    t = String(model) + "|" + t.slice(0, 4096);
    var h = 2166136261; for (var i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
    var o = Object.assign({}, opts || {});
    o.extraHeaders = Object.assign({}, o.extraHeaders || {}, { "x-session-affinity": "pc-" + (h >>> 0).toString(36) });
    return o;
  } catch (e) { return opts; }
}
// True while any fleet_budget ai_spend cap is breached (current > cap). Since 1.6.0 (BUDGET-SOFT-ROUTE-1) a breach only
// selects lean scoring (one cheap model); an unreadable fleet_budget counts as breached, so a D1 fault selects lean too.
async function aiBudgetBreach(env) {
  try {
    var rows = (await env.QNFO_AUDIT.prepare("SELECT node_class, cap, current FROM fleet_budget WHERE node_class LIKE 'ai_spend:%' AND current > cap ORDER BY node_class").all()).results || [];
    return { breached: rows.length > 0, caps: rows.map(function (r) { return r.node_class + " " + r.current + "/" + r.cap; }) };
  } catch (e) {
    return { breached: true, caps: ["fleet_budget unreadable: " + String(e && e.message || e).slice(0, 80)] };
  }
}
async function tRunModel(env, name, prompt) {
  var lastErr = "";
  var chain = [name].concat(T_CHAIN.filter(function (x) { return x !== name; })).slice(0, 4);
  for (var i = 0; i < chain.length; i++) {
    try {
      var r = await aiRunAttr(env, "idea-hub", "triage", chain[i], { messages: [{ role: "user", content: prompt }], max_tokens: REASONING_MAX_TOKENS, temperature: 0.2 });
      var mm = tExtract(r).match(/\{[\s\S]*\}/);
      if (!mm) { lastErr = chain[i] + ": no JSON"; continue; }
      var c = JSON.parse(mm[0]); var ok = true;
      for (var k = 0; k < T_KEYS.length; k++) { var v = parseFloat(c[T_KEYS[k]]); if (!isFinite(v)) { ok = false; break; } c[T_KEYS[k]] = Math.max(0, Math.min(1, v)); }
      if (!ok) { lastErr = chain[i] + ": invalid scorecard"; continue; }
      return { card: c, model: chain[i] };
    } catch (e) { lastErr = chain[i] + ": " + (e && e.message || e); }
  }
  return { error: lastErr };
}
// BUDGET-SOFT-ROUTE-1 (1.6.0): lean = an ai_spend cap is breached. The proposal is still scored, by one cheap model
// (T_MODELS.a with the T_CHAIN fallbacks) instead of two plus a tiebreak; the cap steers the model, it never stops triage.
async function scoreIdea(env, desire, lean) {
  var prompt = SCORECARD_PROMPT + String(desire || "").slice(0, 3000);
  if (lean) {
    var one = await tRunModel(env, T_MODELS.a, prompt);
    if (!one.card) return { error: "lean scoring failed: " + one.error };
    var lc = one.card, ls = 0.3 * lc.novelty + 0.3 * lc.technical_merit + 0.2 * lc.impact_potential + 0.2 * lc.exposure_potential;
    return { score: Math.round(ls * 1000) / 1000, decision: ls >= ACCEPT_MIN && lc.feasibility >= FEAS_MIN && lc.risk <= RISK_MAX ? "ACCEPT" : "HOLD", rationale: lc.rationale, model: one.model + " (lean: ai_spend cap breached)" };
  }
  var res = await Promise.all([tRunModel(env, T_MODELS.a, prompt), tRunModel(env, T_MODELS.b, prompt)]);
  var a = res[0].card ? res[0] : null, b = res[1].card ? res[1] : null, card, models;
  if (a && b) {
    card = {}; T_KEYS.forEach(function (k) { card[k] = (a.card[k] + b.card[k]) / 2; });
    card.rationale = a.card.rationale || ""; models = [a.model, b.model];
    var std = Math.sqrt(T_KEYS.map(function (k) { return Math.pow(a.card[k] - b.card[k], 2); }).reduce(function (x, y) { return x + y; }, 0) / T_KEYS.length);
    if (std > STD_TIE) { var t = await tRunModel(env, T_MODELS.tiebreak, prompt); if (t.card) { T_KEYS.forEach(function (k) { card[k] = (a.card[k] + b.card[k] + t.card[k]) / 3; }); models.push(t.model); } }
  } else if (a || b) { card = (a || b).card; models = [(a || b).model]; }
  else return { error: "all scoring models failed: " + [res[0].error, res[1].error].join(" | ") };
  var score = 0.3 * card.novelty + 0.3 * card.technical_merit + 0.2 * card.impact_potential + 0.2 * card.exposure_potential;
  var decision = score >= ACCEPT_MIN && card.feasibility >= FEAS_MIN && card.risk <= RISK_MAX ? "ACCEPT" : "HOLD";
  return { score: Math.round(score * 1000) / 1000, decision: decision, rationale: card.rationale, model: models.join("+") };
}
// IDEA-NOVELTY-1 (1.9.0, agent_issues 2409, pillar research): a literature-grounded novelty and triviality screen. The
// scorecard's novelty comes from the idea text alone, and model-intuition novelty is unreliable (Si et al.: LLM ideas rated
// more novel than expert ideas scored worse after execution; an AI Scientist audit found its check marked all 12 ideas
// novel). After the scorecard answers ACCEPT for a generated proposal, triage retrieves its nearest neighbours in the QNFO
// corpus (PAPER_VZ, the Ask QNFO index, read back from living-paper papers) and on arXiv (export API, relevance order), and
// NOVELTY_MODELS (llama, then gemma: no model of either family is in T_MODELS or T_CHAIN; lean order while an ai_spend
// cap is breached, BUDGET-SOFT-ROUTE-1) labels each neighbour's overlap
// none | partial | substantial | duplicate with the overlapping element, quotes the delta the idea itself states, and gives
// an anchored practical payoff (5 = a named decision or design parameter changes if the result holds; 3 = a named open
// question narrows; 1 = nothing named changes) and whether the idea is foundational theory.
//   duplicate                          HOLD (the neighbour and the element are named in the rationale)
//   substantial with no stated delta   HOLD
//   payoff < NOVELTY_PAYOFF_MIN        HOLD, unless foundational and foundational-quota accepts are under
//                                      NOVELTY_FOUNDATIONAL_QUOTA of the 30-day accepts (at least one; tag foundational-quota)
// An accept keeps a short tag with labels and numbers only (no titles), so the topic classifier that reads the rationale
// (IDEA-DIVERSITY-CAP-1 and the idea_topic_concentration_30d metric) sees no new words. When no neighbour can be read or no
// labelling model answers, the proposal passes unscreened and the run counts it (novelty.unscreened in cloud_ops_events
// idea-triage-budget), so an outage of the screen never stops triage. Owner and notebook rows are never screened.
var NOVELTY_K = 4, NOVELTY_PAYOFF_MIN = 3, NOVELTY_FOUNDATIONAL_QUOTA = 0.3;
var NOVELTY_MODELS = ["@cf/moonshotai/kimi-k2.6", "@cf/openai/gpt-oss-20b"];
var NOVELTY_EMBED = "@cf/baai/bge-base-en-v1.5";
var NOVELTY_LABELS = ["none", "partial", "substantial", "duplicate"];
var NOVELTY_STOP = /^(about|above|after|again|against|among|another|based|being|below|between|both|could|does|doing|during|each|either|every|from|further|have|having|here|into|itself|more|most|much|must|other|over|same|should|some|such|than|that|their|them|then|there|these|they|this|those|through|under|until|very|what|when|where|whether|which|while|whose|will|with|within|without|would|your|using|study|paper|approach|method|novel|propose|proposed|research|question|questions|result|results|show|shows|whether)$/i;
function noveltyTerms(text) {
  var seen = {}, out = [];
  String(text || "").toLowerCase().replace(/[^a-z0-9\- ]+/g, " ").split(/\s+/).forEach(function (w) {
    w = w.replace(/^-+|-+$/g, "");
    if (w.length < 5 || NOVELTY_STOP.test(w) || seen[w]) return;
    seen[w] = 1; out.push(w);
  });
  return out.sort(function (a, b) { return b.length - a.length; }).slice(0, 6);
}
function arxivEntries(xml) {
  var out = [], re = /<entry>([\s\S]*?)<\/entry>/g, m;
  var pick = function (s, tag) { var x = s.match(new RegExp("<" + tag + "[^>]*>([\\s\\S]*?)</" + tag + ">")); return x ? x[1].replace(/\s+/g, " ").trim() : ""; };
  while ((m = re.exec(String(xml || ""))) && out.length < NOVELTY_K) {
    var id = pick(m[1], "id").replace(/^https?:\/\/arxiv\.org\/abs\//, "");
    var title = pick(m[1], "title"), summary = pick(m[1], "summary");
    if (title) out.push({ ref: "arXiv " + id, title: title, text: summary.slice(0, 1200) });
  }
  return out;
}
async function arxivNeighbours(idea) {
  var terms = noveltyTerms(idea);
  if (terms.length < 2) return [];
  var queries = [terms.slice(0, 3).map(function (t) { return "all:" + t; }).join(" AND "), terms.map(function (t) { return "all:" + t; }).join(" OR ")];
  for (var i = 0; i < queries.length; i++) {
    var init = typeof AbortSignal !== "undefined" && AbortSignal.timeout ? { signal: AbortSignal.timeout(8000) } : {};
    var r = await fetch("https://export.arxiv.org/api/query?sortBy=relevance&max_results=" + NOVELTY_K + "&search_query=" + encodeURIComponent(queries[i]), init);
    if (!r.ok) throw new Error("arXiv HTTP " + r.status);
    var es = arxivEntries(await r.text());
    if (es.length) return es;
  }
  return [];
}
async function corpusNeighbours(env, idea) {
  if (!env.PAPER_VZ || !env.LIVING_PAPER) return [];
  var emb = await aiRunAttr(env, "idea-hub", "novelty-embed", NOVELTY_EMBED, { text: [String(idea || "").slice(0, 1500)] });
  var vec = emb && emb.data && emb.data[0];
  if (!vec) throw new Error("no embedding");
  var hits = await env.PAPER_VZ.query(vec, { topK: 12, returnValues: false, returnMetadata: "all" });
  var slugs = [];
  ((hits && hits.matches) || []).forEach(function (h) { var s = h && h.metadata && h.metadata.slug; if (s && slugs.indexOf(s) < 0 && slugs.length < NOVELTY_K) slugs.push(String(s)); });
  var out = [];
  for (var i = 0; i < slugs.length; i++) {
    // papers.abstract may be NULL for a paper whose body holds it (fm-paper-abstract-empty): fall back to the body.
    var p = await env.LIVING_PAPER.prepare("SELECT title, COALESCE(NULLIF(abstract, ''), substr(body_md, 1, 1500)) AS s FROM papers WHERE slug = ?1 LIMIT 1").bind(slugs[i]).first();
    if (p && p.title) out.push({ ref: "QNFO " + slugs[i], title: String(p.title), text: String(p.s || "").slice(0, 1200) });
  }
  return out;
}
var NOVELTY_PROMPT = "You compare a proposed research idea with existing work. For each numbered neighbour, label its overlap with the IDEA: " +
  "none | partial | substantial | duplicate (duplicate = the neighbour already asks or answers the same question), and name the overlapping element in at most 80 characters. " +
  "delta = the difference from the closest neighbour that the IDEA text itself states, quoted or closely paraphrased from the IDEA; empty when the IDEA states none (do not invent one). " +
  "payoff 1-5, anchored: 5 = a named decision or design parameter changes if the result holds; 4 = a named method or model choice changes; 3 = a named open question narrows; 2 = only general understanding improves; 1 = nothing named changes. " +
  "foundational = true when the IDEA is foundational theory whose value is conceptual rather than a decision. " +
  "Return JSON ONLY: {\"neighbours\":[{\"n\":1,\"overlap\":\"none\",\"element\":\"\"}],\"delta\":\"\",\"payoff\":3,\"foundational\":false}\n";
function noveltyLabel(raw) {
  var m = String(raw || "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  var j = JSON.parse(m[0]);
  if (!j || !Array.isArray(j.neighbours)) return null;
  var p = Math.round(Number(j.payoff));
  return {
    neighbours: j.neighbours.map(function (x) { return { n: Number(x && x.n), overlap: NOVELTY_LABELS.indexOf(String(x && x.overlap || "").toLowerCase()) >= 0 ? String(x.overlap).toLowerCase() : "none", element: String(x && x.element || "").slice(0, 80) }; }),
    delta: String(j.delta || "").trim().slice(0, 200),
    payoff: isFinite(p) ? Math.max(1, Math.min(5, p)) : null,
    foundational: j.foundational === true || String(j.foundational).toLowerCase() === "true"
  };
}
// Pure verdict over the labelled neighbours: { hold, foundational_quota, tag }. mix: the 30-day accepted mix (n,
// foundational) or null (unreadable: the quota then allows).
function noveltyVerdict(lab, nbrs, mix) {
  var worst = -1, at = null;
  lab.neighbours.forEach(function (x) { var k = NOVELTY_LABELS.indexOf(x.overlap); if (k > worst && nbrs[x.n - 1]) { worst = k; at = x; } });
  var label = worst >= 0 ? NOVELTY_LABELS[worst] : "none", nb = at ? nbrs[at.n - 1] : null;
  var counts = NOVELTY_LABELS.map(function (l) { return lab.neighbours.filter(function (x) { return x.overlap === l; }).length; }).join("/");
  var base = "[novelty " + nbrs.length + " neighbours none/partial/substantial/duplicate " + counts + "; payoff " + (lab.payoff === null ? "?" : lab.payoff);
  if (label === "duplicate") return { hold: true, tag: base + "; HOLD duplicate of " + nb.ref + " (" + at.element + ")]" };
  if (label === "substantial" && !lab.delta) return { hold: true, tag: base + "; HOLD substantial overlap with " + nb.ref + " (" + at.element + ") and no stated delta]" };
  if (lab.payoff !== null && lab.payoff < NOVELTY_PAYOFF_MIN) {
    var room = !mix || (mix.foundational || 0) < Math.max(1, Math.ceil(NOVELTY_FOUNDATIONAL_QUOTA * (mix.n + 1)));
    if (lab.foundational && room) return { hold: false, foundational_quota: true, tag: base + "; foundational-quota]" };
    return { hold: true, tag: base + "; HOLD practical payoff below " + NOVELTY_PAYOFF_MIN + (lab.foundational ? ", foundational quota full" : "") + "]" };
  }
  return { hold: false, tag: base + (label === "substantial" ? "; delta stated" : "") + "]" };
}
async function noveltyScreen(env, idea, mix, lean) {
  var nbrs = [], errs = [];
  try { nbrs = nbrs.concat(await corpusNeighbours(env, idea)); } catch (e) { errs.push("corpus: " + String(e && e.message || e).slice(0, 80)); }
  try { nbrs = nbrs.concat(await arxivNeighbours(idea)); } catch (e) { errs.push("arxiv: " + String(e && e.message || e).slice(0, 80)); }
  if (!nbrs.length) return { screened: false, error: errs.join("; ") || "no neighbours" };
  var prompt = NOVELTY_PROMPT + "IDEA: " + String(idea || "").slice(0, 2000) + "\n" + nbrs.map(function (n, i) { return "NEIGHBOUR " + (i + 1) + " (" + n.ref + "): " + n.title + ". " + n.text; }).join("\n");
  var models = lean ? NOVELTY_MODELS.slice().reverse() : NOVELTY_MODELS;
  for (var i = 0; i < models.length; i++) {
    try {
      var r = await aiRunAttr(env, "idea-hub", "novelty", models[i], { messages: [{ role: "user", content: prompt }], max_tokens: REASONING_MAX_TOKENS, temperature: 0.1 });
      var lab = noveltyLabel(tExtract(r));
      if (!lab) { errs.push(models[i] + ": no labels"); continue; }
      var v = noveltyVerdict(lab, nbrs, mix);
      v.screened = true; v.model = models[i]; v.errors = errs;
      return v;
    } catch (e) { errs.push(models[i] + ": " + String(e && e.message || e).slice(0, 80)); }
  }
  return { screened: false, error: errs.join("; ") };
}
var NOISE_RE = [/^call (the )?[a-z_]+( tool)?(\s|$)/i, /(email_check|express_intent|intents_list|social_compose|search_research|search_papers tool)/i, /output the (complete )?raw json/i, /^reply with the single word/i, /^give this conversation a name/i, /^max \d+ chars/i, /based on the chat history/i, /rotation verification/i, /redirect probe/i, /auto-express block/i, /wrapped in/i, /^ok$/i];
function isNoise(t) { t = String(t || ""); return NOISE_RE.some(function (re) { return re.test(t); }); }
function isQuestion(t) { t = String(t || "").trim(); return t.length < 160 && /\?\s*$/.test(t) && /^(what|who|where|when|why|how|is|are|do|does|did|can|could|should|would|will|has|have|quick|one line|one sentence|in one sentence|probe)/i.test(t); }
// IDEA-DIVERSITY-CAP-1 (1.5.8, #1947, pillar research). metric_registry idea_topic_concentration_30d (trigger 1238: > 0.50)
// is the share of ACCEPTed idea_proposals in the last 30 days that fall in the largest topic cluster (derived from data since 1.10.0), recomputed daily
// by qnfo-cloud-ops jobIdeaTopicMetric. It read 0.596 (31 of 52 "quantum") on 2026-10-06, and with no new accepts the
// window alone would raise it (0.794 by 10-15, 1.0 by 11-02: the older accepts are the diverse ones). After a scoring
// model answers ACCEPT for a generated proposal, triage classifies it with the same clusters over the same text (the idea
// text; name and rationale before 1.10.0) and, while (cluster + 1) / (n + 1) > DIVERSITY_MAX_SHARE with n >= DIVERSITY_MIN_N accepts in the
// window, holds it as status 'deferred_diversity' (decision DEFER-DIVERSITY, score kept, never sent to research_queue
// and not counted by the metric). Held rows are released best score first, with no model call, when the share allows
// (1.6.0 BUDGET-SOFT-ROUTE-1: an ai_spend cap no longer holds a release back). A held row whose created_at leaves the
// 30-day window becomes a terminal HOLD instead, so a release can never land outside the window the metric reads.
// Owner-authored rows (name owner-* or rowan-*, contact 'owner') and intake:<family> rows (radar-hub
// SIGNAL-INTAKE-SOURCES-1) are never held; they still count in the mix. Since 1.10.0 (TOPIC-CLUSTERS-DERIVED-1) the clusters
// are derived from the accepted ideas by the shared block below, the same text qnfo-cloud-ops uses for the metric.
// TOPIC-CLUSTERS-DERIVED-1 BEGIN shared block. The text from this line to the END line is identical in idea-hub/worker.js and
// qnfo-cloud-ops/worker.js; idea-hub/diversity-cap.test.mjs fails when the two copies differ.
// ACCURACY-FLEET-2a (agent_issues 2281; owner directive 2026-10-10: no topic or noun may be hard-coded in instructions) retires
// the fixed four-cluster keyword table IDEA_TOPIC_CLUSTERS. The topic clusters are derived from data: the ACCEPTed
// idea_proposals of the last TOPIC_DERIVE_DAYS days that a GENERATOR produced (TOPIC-DERIVE-GENERATED-1 below: a producer name
// that holds "owner" is the owner's own notebook or chat and is left out), over the idea text only, by a deterministic rule:
//   1. terms: lower-cased, accents removed, split on anything but a-z and 0-9; words of 4+ characters that do not start with a
//      digit and are not in TOPIC_STOPWORDS (English function words and research-process words; it names no subject); plurals
//      folded (ies -> y, a final s after a letter other than s or u dropped).
//   2. template terms: a term in at least TOPIC_TEMPLATE_SHARE of one producer's texts (producer = idea_proposals.name up to its
//      first ":", so intake:<family> rows are one producer; with at least TOPIC_TEMPLATE_MIN_DOCS texts) is that producer's
//      boilerplate and is dropped.
//   3. candidates: the TOPIC_CANDIDATES terms with the highest document frequency (at least TOPIC_MIN_DF), ties alphabetical.
//   4. grouping: in that order a term joins the cluster whose seed it co-occurs with most (earliest seed on a tie) when at least
//      TOPIC_JOIN of its texts carry that seed (up to TOPIC_CLUSTER_TERMS terms a cluster); otherwise it seeds a new cluster
//      (at most 3 x TOPIC_CLUSTER_MAX seeds).
//   5. a seed no other term joined is a generic word, not a topic, and is dropped; the first TOPIC_CLUSTER_MAX remaining
//      clusters in seed-frequency order are kept, each labelled by its seed.
// A text belongs to the first cluster (largest seed first, as the old table checked its largest cluster first) that shares a
// term with it, else to "other". No data gives no clusters: every text is "other", the diversity cap holds nothing and the
// metric is not written; there is no fallback topic list. The derivation is cached in ops_config idea_topic_clusters:
// qnfo-cloud-ops re-derives it every day (idea-topic-metric) and either worker re-derives it when the cache is missing,
// unreadable or older than TOPIC_CACHE_MAX_AGE_H hours.
var TOPIC_DERIVE_DAYS = 90, TOPIC_MIN_DF = 3, TOPIC_CANDIDATES = 60, TOPIC_JOIN = 0.5, TOPIC_CLUSTER_MAX = 6, TOPIC_CLUSTER_TERMS = 8;
var TOPIC_TEMPLATE_MIN_DOCS = 10, TOPIC_TEMPLATE_SHARE = 0.9, TOPIC_CACHE_KEY = "idea_topic_clusters", TOPIC_CACHE_MAX_AGE_H = 72;
// TOPIC-DERIVE-GENERATED-1 (idea-hub 1.17.1, qnfo-cloud-ops 1.46.1; agent_issues 2047, trigger 1238, 2026-11-05). The clusters are derived from the population the
// metric and the cap's second check measure: the ACCEPTed GENERATED proposals (producer name without "owner"; owner-corpus, owner-chat and owner-import are the
// owner's notebooks and chat, accepted at bar 0 and exempt from the metric by OWNER-EXEMPT-METRIC-1). Until now the derivation pooled them: 1,211 of its 1,333 documents
// on 2026-11-04 were one notebook, so the clusters took the notebook's vocabulary and the first one was model/matter/quantum/derive/simulation/state/formal/formalize,
// generic words that 21 of the 29 generated accepts of the window contain (0.724) although 12 of them are about quantum physics (0.414 with clusters derived from the
// generated accepts themselves, same 29 rows, same rule). A measure whose boundaries come from a corpus it does not count cannot move when the counted intake does.
var TOPIC_GENERATED_SQL = "lower(COALESCE(name, '')) NOT LIKE '%owner%'";
function ideaTopicOwnerSourced(name) { return String(name || "").toLowerCase().indexOf("owner") >= 0; }
var TOPIC_DERIVE_SQL = "SELECT name, idea FROM idea_proposals WHERE decision = 'ACCEPT' AND " + TOPIC_GENERATED_SQL + " AND replace(substr(created_at, 1, 19), 'T', ' ') >= datetime('now', '-" + TOPIC_DERIVE_DAYS + " day') ORDER BY id";
var TOPIC_STOPWORDS = new Set(("about above across after again against also among because been before being between both cannot could does doing during each either every from further gives given have having here however into itself just keep known like made make many more most much must need neither often only other over said same should since some such than that their them then there these they this those through thus under until upon using very want were what when where whether which while whose will with within without would your " +
  "idea ideas research question questions paper papers study studies analysis approach method methods result results claim claims note notes proposal proposals show shows shown based work works novel first second third " +
  "author authors conjecture conjectures hypothesis hypotheses propose proposes proposed rather single standard yield yields test tests testable explore investigate framework").split(" "));
function topicTerms(text) {
  var out = [], seen = Object.create(null);
  var words = String(text || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").split(" ");
  for (var i = 0; i < words.length; i++) {
    var w = words[i];
    if (w.length < 4 || /^[0-9]/.test(w) || TOPIC_STOPWORDS.has(w)) continue;
    if (/ies$/.test(w)) w = w.slice(0, -3) + "y";
    else if (w.length > 4 && /[^su]s$/.test(w)) w = w.slice(0, -1);
    if (TOPIC_STOPWORDS.has(w) || seen[w]) continue;
    seen[w] = 1;
    out.push(w);
  }
  return out;
}
// Pure: rows [{ name, idea }] -> { clusters: [{ label, terms }], docs, template_terms }.
// TOPIC-TEMPLATE-FAMILY-1 (idea-hub 1.17.2, qnfo-cloud-ops 1.46.2; agent_issues 2047, 2026-11-05). The radar intake names a producer per feed (intake:arxiv-complexity, intake:journal-nature ...), and
// every one of them appends the same trailer to its text (source, http, fits). Each feed alone has fewer than TOPIC_TEMPLATE_MIN_DOCS texts, so the boilerplate rule never fired and the trailer
// became a topic: on 2026-11-04 all 15 intake texts, from seven different fields, formed the cluster source/fits/http and held 11 of the 29 generated accepts. The more feeds the intake gains
// (the point of SIGNAL-INTAKE-1), the more of it would have read as one topic. A producer is now the name up to its first ":", so the feed family is one producer and its trailer is dropped.
function topicProducer(name) { var s = String(name || ""), i = s.indexOf(":"); return i > 0 ? s.slice(0, i) : s; }
function deriveTopicClusters(rows) {
  var docs = (rows || []).map(function (r) { return { src: topicProducer(r && r.name), terms: topicTerms(r && r.idea) }; });
  var bySrc = Object.create(null);
  docs.forEach(function (d) { (bySrc[d.src] = bySrc[d.src] || []).push(d.terms); });
  var template = [];
  Object.keys(bySrc).sort().forEach(function (s) {
    var ds = bySrc[s];
    if (ds.length < TOPIC_TEMPLATE_MIN_DOCS) return;
    var c = Object.create(null);
    ds.forEach(function (t) { t.forEach(function (w) { c[w] = (c[w] || 0) + 1; }); });
    Object.keys(c).sort().forEach(function (w) { if (c[w] >= TOPIC_TEMPLATE_SHARE * ds.length && template.indexOf(w) < 0) template.push(w); });
  });
  var docsOf = Object.create(null);
  docs.forEach(function (d, i) { d.terms.forEach(function (w) { if (template.indexOf(w) < 0) (docsOf[w] = docsOf[w] || []).push(i); }); });
  var cands = Object.keys(docsOf).filter(function (w) { return docsOf[w].length >= TOPIC_MIN_DF; })
    .sort(function (a, b) { return docsOf[b].length - docsOf[a].length || (a < b ? -1 : a > b ? 1 : 0); }).slice(0, TOPIC_CANDIDATES);
  var seeds = [];
  cands.forEach(function (t) {
    var best = null, bs = 0;
    seeds.forEach(function (c) {
      var n = 0;
      docsOf[t].forEach(function (i) { if (c.docs.has(i)) n++; });
      if (n / docsOf[t].length > bs) { bs = n / docsOf[t].length; best = c; }
    });
    if (best && bs >= TOPIC_JOIN) { if (best.terms.length < TOPIC_CLUSTER_TERMS) best.terms.push(t); }
    else if (seeds.length < 3 * TOPIC_CLUSTER_MAX) seeds.push({ label: t, terms: [t], docs: new Set(docsOf[t]) });
  });
  var clusters = seeds.filter(function (c) { return c.terms.length >= 2; }).slice(0, TOPIC_CLUSTER_MAX).map(function (c) { return { label: c.label, terms: c.terms }; });
  return { clusters: clusters, docs: docs.length, template_terms: template };
}
// Pure: a text and the derived clusters -> the label of the first cluster sharing a term with it, else "other".
function topicCluster(text, clusters) {
  var terms = topicTerms(text);
  for (var i = 0; i < (clusters || []).length; i++) {
    for (var j = 0; j < clusters[i].terms.length; j++) if (terms.indexOf(clusters[i].terms[j]) >= 0) return clusters[i].label;
  }
  return "other";
}
// db: a qnfo-audit D1 binding. force: re-derive even when the cache is fresh. Returns { clusters, derived_at, docs, source,
// cache_error }. An unreadable or unwritable cache is reported in cache_error (the derivation still answers); a failed read
// of idea_proposals throws to the caller.
async function loadTopicClusters(db, force) {
  var cacheError = null;
  if (!force) {
    try {
      var row = await db.prepare("SELECT value FROM ops_config WHERE key = ?1").bind(TOPIC_CACHE_KEY).first();
      var v = row && row.value ? JSON.parse(row.value) : null;
      var age = v && v.derived_at ? (Date.now() - Date.parse(v.derived_at)) / 3600e3 : Infinity;
      if (v && Array.isArray(v.clusters) && age >= 0 && age <= TOPIC_CACHE_MAX_AGE_H) return Object.assign(v, { source: "cache", cache_error: null });
    } catch (e) {
      cacheError = "read: " + String(e && e.message || e).slice(0, 120);
    }
  }
  var rows = (await db.prepare(TOPIC_DERIVE_SQL).all()).results || [];
  var d = deriveTopicClusters(rows);
  var rec = { version: 1, derived_at: new Date().toISOString(), window_days: TOPIC_DERIVE_DAYS, docs: d.docs, clusters: d.clusters, template_terms: d.template_terms };
  try {
    await db.prepare("INSERT INTO ops_config (key, value, note, updated_at) VALUES (?1, ?2, ?3, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, note = excluded.note, updated_at = excluded.updated_at")
      .bind(TOPIC_CACHE_KEY, JSON.stringify(rec), "TOPIC-CLUSTERS-DERIVED-1 (agent_issues 2281): topic clusters derived from ACCEPTed idea_proposals; re-derived daily by qnfo-cloud-ops idea-topic-metric").run();
  } catch (e) {
    cacheError = (cacheError ? cacheError + "; " : "") + "write: " + String(e && e.message || e).slice(0, 120);
  }
  return Object.assign(rec, { source: "derived", cache_error: cacheError });
}
// TOPIC-CLUSTERS-DERIVED-1 END shared block.
var DIVERSITY_MAX_SHARE = 0.5, DIVERSITY_MIN_N = 10, DIVERSITY_RELEASE_SCAN = 50;
var DIVERSITY_WINDOW_SQL = "replace(substr(created_at, 1, 19), 'T', ' ') >= datetime('now', '-30 day')";
var DIVERSITY_NOTE_RE = /^\[diversity hold [^\]]*\] ?/;
// The idea text alone places a proposal (1.10.0: name and model rationale no longer count, so a scoring note cannot move it).
function proposalCluster(idea, clusters) { return topicCluster(idea, clusters); }
// OWNER-SIGNAL-INTAKE-1 (1.7.0, #1947 #2103 #2104). Three kinds of proposal share the one intake:
//   direct    the owner wrote it (POST /api/intake owner-chat, rowan-*, chat-session, contact 'owner'/'rowan-*'): ACCEPTed
//             independently of the model's decision, then subject to the same deterministic diversity cap as other ideas;
//   corpus    'owner-corpus', distilled by runOwnerCorpus from the owner's notebook: ACCEPTed at OWNER_CORPUS_SCORE_MIN, a
//             lower bar than generated ideas and prioritized ahead of generated scans in triage and diversity release;
//   generated everything else (arXiv scan, think loop, re-entry, ask-gap, radar intake): the unchanged scorecard.
// The research pipeline's review, verify and publish gates apply to all three alike.
var OWNER_CORPUS_SCORE_MIN = 0;
function proposalKind(row) {
  var name = String(row && row.name || ""), contact = String(row && row.contact || "");
  if (name === "owner-corpus") return "corpus";
  if (/^intake:/i.test(name)) return "generated";
  if (/^(owner|rowan)/i.test(name) || name === "chat-session" || contact === "owner" || /^rowan/i.test(contact)) return "direct";
  return "generated";
}
function ownerDecision(kind, s) {
  var r = Object.assign({}, s);
  if (kind === "direct") { r.decision = "ACCEPT"; r.rationale = "[owner-authored: accepted, OWNER-SIGNAL-INTAKE-1] " + (s.rationale || ""); }
  else if (kind === "corpus") { var ok = s.decision === "ACCEPT" || Number(s.score) >= OWNER_CORPUS_SCORE_MIN; r.decision = ok ? "ACCEPT" : "HOLD"; r.rationale = "[owner notebook, bar " + OWNER_CORPUS_SCORE_MIN + "] " + (s.rationale || ""); }
  return r;
}
async function acceptedMix(env) {
  var topics = await loadTopicClusters(env.QNFO_AUDIT, false);
  var rs = (await env.QNFO_AUDIT.prepare("SELECT name, idea, rationale FROM idea_proposals WHERE decision = 'ACCEPT' AND " + DIVERSITY_WINDOW_SQL).all()).results || [];
  var mix = { n: 0, by: Object.create(null), gen_n: 0, gen_by: Object.create(null), foundational: 0, clusters: topics.clusters || [], topics: { source: topics.source, derived_at: topics.derived_at, docs: topics.docs, cache_error: topics.cache_error || null } };
  rs.forEach(function (r) { mixAdd(mix, r.name, proposalCluster(r.idea, mix.clusters)); if (/foundational-quota/.test(String(r.rationale || ""))) mix.foundational++; });
  return mix;
}
// One accepted row into the mix: always the all-sources count, and the generated count when the producer is not the owner's own (TOPIC-DERIVE-GENERATED-1).
function mixAdd(mix, name, cluster) {
  mix.n++; mix.by[cluster] = (mix.by[cluster] || 0) + 1;
  if (!ideaTopicOwnerSourced(name)) { mix.gen_n = (mix.gen_n || 0) + 1; mix.gen_by = mix.gen_by || Object.create(null); mix.gen_by[cluster] = (mix.gen_by[cluster] || 0) + 1; }
}
// DIVERSITY-GENERATED-CAP-1 (1.17.1, agent_issues 2047, trigger 1238 idea_topic_concentration_30d). The cap above reads ALL accepted rows, and 1,211 of the 1,250
// accepts of the window on 2026-11-04 were the owner's notebook, so one more generated accept moved the all-sources share by 0.1 point whatever cluster it joined: the
// cap could not bind the population the metric measures (the 29 generated accepts). A generated proposal (producer name without "owner", the metric's own test) is now also
// held when one more accept in its cluster would put that cluster above DIVERSITY_MAX_SHARE of the 30-day GENERATED accepts (once DIVERSITY_MIN_N exist). "other" is never
// held on that count: a text that shares no term with a derived cluster is the diverse part of the intake, not a concentration, and holding it would lower the diversity
// the cap exists to raise. Owner-authored rows keep only the all-sources check, as before.
function diversityVerdict(mix, cluster, name) {
  if (!mix.clusters || !mix.clusters.length) return null;
  if (mix.n >= DIVERSITY_MIN_N && ((mix.by[cluster] || 0) + 1) / (mix.n + 1) > DIVERSITY_MAX_SHARE) return { population: "accepts", pct: Math.round(100 * ((mix.by[cluster] || 0) + 1) / (mix.n + 1)) };
  var gn = mix.gen_n || 0;
  if (name !== undefined && !ideaTopicOwnerSourced(name) && cluster !== "other" && gn >= DIVERSITY_MIN_N && (((mix.gen_by || {})[cluster] || 0) + 1) / (gn + 1) > DIVERSITY_MAX_SHARE) return { population: "generated accepts", pct: Math.round(100 * (((mix.gen_by || {})[cluster] || 0) + 1) / (gn + 1)) };
  return null;
}
// True when one more accept in `cluster` would put that cluster above the cap (only once DIVERSITY_MIN_N accepts exist). `name` is the producer of the proposal; give it
// to apply the generated-population check too. With no derived clusters (no generated accepted ideas to derive them from) nothing is held: every text is "other".
function diversityBlocks(mix, cluster, name) { return diversityVerdict(mix, cluster, name) !== null; }
function mixShare(mix) {
  var top = null;
  Object.keys(mix.by).forEach(function (k) { if (top === null || mix.by[k] > mix.by[top]) top = k; });
  var gen = mix.gen_by || {}, gtop = null;
  Object.keys(gen).forEach(function (k) { if (gtop === null || gen[k] > gen[gtop]) gtop = k; });
  var generated = { n: mix.gen_n || 0, top: gtop, share: mix.gen_n ? Math.round(1000 * gen[gtop] / mix.gen_n) / 1000 : null, by_cluster: Object.assign({}, gen) };
  return { n: mix.n, top: top, share: mix.n ? Math.round(1000 * mix.by[top] / mix.n) / 1000 : null, by_cluster: Object.assign({}, mix.by), generated: generated, clusters: (mix.clusters || []).map(function (c) { return c.label; }), topics: mix.topics || null };
}
// RESEARCH-INTAKE-RIGID-1 (1.17.0, owner directive 2026-11-04: "triage needs to be much more rigid"): D1 read 2026-11-04 found the deferred research pool full of
// rows that were never ideas to write about: bare arXiv titles from the daily scan ("Auto-candidate from daily research scan; triage for QNFO research fit"),
// one-line "Re-entry from <doi>:" fragments (a section header or a question), and JSON-wrapped idea lists. A machine-produced accept no longer enters research_queue
// in one of those shapes (the synthesis step also leaves anything under 400 characters unmerged). The rest stay in idea_proposals as triaged_hold with the reason in rationale, so no text
// is lost and the reading-list path (must_read) still sees the arXiv hits. The owner's own ideas (direct) are never held. ops_config research_intake_rigid = off restores the old intake.
function intakeNoiseReason(idea) {
  var t = String(idea || "").trim();
  if (/auto-candidate from daily research scan/i.test(t)) return "scan auto-candidate (a title, not a conjecture)";
  if (/^\s*[\[{]/.test(t)) return "JSON-wrapped idea list";
  if (/^re-entry from /i.test(t) && t.length < 400) return "re-entry fragment";
  return null;
}
async function enqueueAccepted(env, id, idea, score, now, direct) {
  // RESEARCH-ADMISSION-CAP-1 (2026-10-17): triage ACCEPTs ~40% of ~240 proposals/day while the executor
  // publishes ~5-9/day, so every accept used to be enqueued and the overflow piled up as status 'deferred'
  // (440 rows on 2026-10-17 = 68% of the pipeline). RESEARCH-BACKPRESSURE-1 only DEMOTES overflow; nothing
  // bounded admission. The queue is now capped at RESEARCH_ADMISSION_CAP active+deferred rows. An accept
  // beyond it stays in idea_proposals as triaged_hold with a '[research admission cap]' rationale (not
  // lost, not queued) until the queue drains. Read failure admits (a D1 fault must not stop triage).
  // IDEAS-INTAKE-OWNER-1 (1.10.12): `direct` is true for an idea the owner wrote himself (proposalKind 'direct'). The cap
  // bounds the machine producers (arXiv scan, think loop, re-entry, ask-gap); it never holds the owner's own idea, which the
  // doctrine says never waits on a hold. Nothing re-admitted a cap-held row, so before 1.10.12 an owner idea filed while the
  // queue was full stayed in triaged_hold for good (migrations/2026-10-19-owner-ideas-cap-requeue.sql re-queues those).
  if (!direct) try {
    var rigid = await env.QNFO_AUDIT.prepare("SELECT value FROM ops_config WHERE key = 'research_intake_rigid'").first();
    var noise = !(rigid && /^off$/i.test(String(rigid.value).trim())) ? intakeNoiseReason(idea) : null;
    if (noise) {
      await env.QNFO_AUDIT.prepare("UPDATE idea_proposals SET status='triaged_hold', rationale=substr('[research intake: ' || ?1 || '] ' || COALESCE(rationale, ''), 1, 2000) WHERE id=?2").bind(noise, id).run();
      return false;
    }
  } catch (eNoise) {
    console.error(JSON.stringify({ worker: "idea-hub", where: "intake-rigid", error: String(eNoise && eNoise.message || eNoise).slice(0, 300) }));
  }
  if (!direct) try {
    var qcap = await env.QNFO_AUDIT.prepare("SELECT COUNT(*) AS n FROM research_queue WHERE status IN ('queued','researching','review','deferred')").first();
    if (qcap && Number(qcap.n) >= RESEARCH_ADMISSION_CAP) {
      await env.QNFO_AUDIT.prepare("UPDATE idea_proposals SET status='triaged_hold', rationale=substr('[research admission cap ' || ?1 || '/' || ?2 || '] ' || COALESCE(rationale, ''), 1, 2000) WHERE id=?").bind(String(qcap.n), String(RESEARCH_ADMISSION_CAP), String(id)).run();
      return false;
    }
  } catch (e) {
    console.error(JSON.stringify({ worker: "idea-hub", where: "enqueueAccepted", error: String(e && e.message || e).slice(0, 300) }));
  }
  await env.QNFO_AUDIT.prepare("INSERT OR IGNORE INTO research_queue (id, source, source_id, idea, summary, score, decision, status, created_at) VALUES (?1,'proposal',?2,?3,'',?4,?5,'queued',?6)").bind(crypto.randomUUID(), String(id), String(idea || "").slice(0, 3000), score, "ACCEPT", now).run();
  return true;
}
// IDEAS-CAP-RATE-1 (1.12.0, agent_issues 100047, ANTIFRAGILE-1: a hold needs an expiry, prefer a rate): the 1.11.1 release only
// fitted held rows under RESEARCH_ADMISSION_CAP, and research_queue (queued, researching, review and the deferred overflow)
// stays far above 120 (473 rows on 2026-10-19), so room was never positive and the step released nothing: 80 cap-held accepts, the
// oldest about 45 hours, with no expiry. When room is not positive the cap now meters instead of holding: up to CAP_TRICKLE_PER_RUN of the
// oldest held rows are admitted per run (the inflow was about 1.75 an hour, 42 in 24 h; one run an hour). Executor load stays metered where it was
// before the cap, by research_ready_cap and deferral. A room > 0 run is unchanged (up to TRIAGE_BATCH, at most the room). Every
// trickle run writes an append-only cloud_ops_events row naming the rows it admitted, so the change is never silent.
async function capRelease(env, out) {
  out.cap_released = 0;
  out.cap_trickled = 0;
  var q = await env.QNFO_AUDIT.prepare("SELECT COUNT(*) AS n FROM research_queue WHERE status IN ('queued','researching','review','deferred')").first();
  var qn = Number(q && q.n || 0);
  var room = Math.min(TRIAGE_BATCH, RESEARCH_ADMISSION_CAP - qn);
  var trickle = !(room > 0);
  var take = trickle ? CAP_TRICKLE_PER_RUN : room;
  if (trickle) {
    // Revert switch without a deploy: ops_config ideas_cap_trickle_per_run (0 = off, the old hold; 1 to 12 = the rate per run). An absent
    // or unreadable row keeps CAP_TRICKLE_PER_RUN, so the read can never stop the admission.
    try {
      var tc = await env.QNFO_AUDIT.prepare("SELECT value FROM ops_config WHERE key = 'ideas_cap_trickle_per_run'").first();
      var tn = tc && tc.value != null ? parseInt(String(tc.value), 10) : NaN;
      if (Number.isFinite(tn) && tn >= 0 && tn <= 12) take = tn;
    } catch (e) { console.error(JSON.stringify({ worker: "idea-hub", where: "capRelease.ops_config", error: String(e && e.message || e).slice(0, 300) })); }
    if (take === 0) return;
  }
  var held =(await env.QNFO_AUDIT.prepare("SELECT id, idea, score, rationale FROM idea_proposals WHERE decision = 'ACCEPT' AND status = 'triaged_hold' AND rationale LIKE '[research admission cap %' ORDER BY created_at ASC, id ASC LIMIT ?1").bind(take).all()).results || [];
  var now = new Date().toISOString(), ids = [];
  for (var i = 0; i < held.length; i++) {
    var h = held[i], rationale = String(h.rationale || "").replace(/^\[research admission cap [^\]]*\] /, "");
    var up = await env.QNFO_AUDIT.prepare("UPDATE idea_proposals SET status = 'triaged_accepted', rationale = ?1 WHERE id = ?2 AND status = 'triaged_hold'").bind(rationale, h.id).run();
    if (!(Number(up && up.meta && up.meta.changes) > 0)) continue;
    await env.QNFO_AUDIT.prepare("INSERT OR IGNORE INTO research_queue (id, source, source_id, idea, summary, score, decision, status, created_at) VALUES (?1,'proposal',?2,?3,'',?4,'ACCEPT','queued',?5)").bind(crypto.randomUUID(), String(h.id), String(h.idea || "").slice(0, 3000), h.score, now).run();
    out.cap_released++;
    ids.push(h.id);
  }
  if (!trickle) return;
  out.cap_trickled = out.cap_released;
  if (!ids.length) return;
  try {
    var left = await env.QNFO_AUDIT.prepare("SELECT COUNT(*) AS n FROM idea_proposals WHERE decision = 'ACCEPT' AND status = 'triaged_hold' AND rationale LIKE '[research admission cap %'").first();
    out.cap_held_left = Number(left && left.n) || 0;
    await env.QNFO_AUDIT.prepare("INSERT OR IGNORE INTO cloud_ops_events (id, ts, kind, text, meta, job, status) VALUES (?1, ?2, 'idea-cap-trickle', ?3, ?4, 'idea-hub', 'ok')")
      .bind("idea-cap-trickle-" + now, now, "research admission cap trickle (IDEAS-CAP-RATE-1): research_queue at " + qn + "/" + RESEARCH_ADMISSION_CAP + ", admitted the " + ids.length + " oldest held accept" + (ids.length === 1 ? "" : "s") + " (idea_proposals " + ids.join(", ") + "), " + out.cap_held_left + " still held",
        JSON.stringify({ version: VERSION, queue_n: qn, cap: RESEARCH_ADMISSION_CAP, trickle_per_run: take, admitted_ids: ids, held_left: out.cap_held_left })).run();
  } catch (e) { console.error(JSON.stringify({ worker: "idea-hub", where: "capRelease", error: String(e && e.message || e).slice(0, 300) })); }
}
// Expire held rows that left the window (terminal HOLD, score kept); then release the best held rows the current mix
// allows, up to TRIAGE_BATCH a run. No model call either way. Since 1.6.0 (BUDGET-SOFT-ROUTE-1) a cap no longer holds
// the release back; the breached argument is kept for callers and ignored.
async function diversityRelease(env, mix, breached, out) {
  var now = new Date().toISOString();
  var ex = await env.QNFO_AUDIT.prepare("UPDATE idea_proposals SET status = 'triaged_hold', decision = 'HOLD', triaged_at = ?1, rationale = substr('[diversity hold expired: left the 30-day window] ' || COALESCE(rationale, ''), 1, 2000) WHERE status = 'deferred_diversity' AND NOT COALESCE(" + DIVERSITY_WINDOW_SQL + ", 0)").bind(now).run();
  out.diversity_expired = Number(ex && ex.meta && ex.meta.changes) || 0;
  var held = (await env.QNFO_AUDIT.prepare("SELECT id, name, idea, rationale, score FROM idea_proposals WHERE status = 'deferred_diversity' AND " + DIVERSITY_WINDOW_SQL + " ORDER BY CASE WHEN name = 'owner-corpus' THEN 0 ELSE 1 END ASC, score DESC, created_at ASC LIMIT ?1").bind(DIVERSITY_RELEASE_SCAN).all()).results || [];
  for (var i = 0; i < held.length && out.diversity_released < TRIAGE_BATCH; i++) {
    var h = held[i], rationale = String(h.rationale || "").replace(DIVERSITY_NOTE_RE, ""), k = proposalCluster(h.idea, mix.clusters);
    if (diversityBlocks(mix, k, h.name)) continue;
    var up = await env.QNFO_AUDIT.prepare("UPDATE idea_proposals SET decision = 'ACCEPT', status = 'triaged_accepted', rationale = ?1, triaged_at = ?2 WHERE id = ?3 AND status = 'deferred_diversity'").bind(rationale, now, h.id).run();
    if (!(Number(up && up.meta && up.meta.changes) > 0)) continue;
    await enqueueAccepted(env, h.id, h.idea, h.score, now);
    mixAdd(mix, h.name, k);
    out.diversity_released++; out.accepted++;
  }
}
// BUDGET-SOFT-ROUTE-1 (1.6.0, owner directive 2026-10-06: "AI spend budget should never stop any process, pipeline, or
// workflow, only limit/suggest what models may be used") replaces the deferral below: while a cap is breached every
// proposal is still scored, by one cheap model (scoreIdea lean), and rows left as deferred_budget by 1.5.5-1.5.8 are
// released every run, oldest first, TRIAGE_BATCH at a time. The text below is the retired 1.5.5 rule, kept for history.
// IDEA-TRIAGE-BREACH-DEFER-1 (#1878, pillar cost, retired): while a fleet_budget ai_spend cap is breached, triage made no model
// call. The zero-cost noise and chat-question rules still run; a proposal that needs scoring is set to status
// 'deferred_budget' (never dropped or closed, human ideas included). Once no cap is breached, deferred rows go back to
// 'new' oldest first, TRIAGE_BATCH a run, and are scored through the normal path. Each run writes the deferred count and
// the breached caps to cloud_ops_events id 'idea-triage-budget'; /health reports the count. Producers count deferred
// rows in their backpressure, so the backlog cannot grow without bound during a breach.
// IDEA-SCORING-POISON-1 (1.13.0): the failure marker of a row no model could score lives in its rationale (a new row has none), so no migration
// is needed. N failures so far and when the last one was; the first SCORING_RETRY_FAST failures are retried on the next cycle, then once a day.
var SCORING_RETRY_FAST = 3, SCORING_RETRY_SLOW_MS = 24 * 3600 * 1000;
function scoringErrorState(rationale) {
  var m = /^\[scoring-error (\d+) ([0-9T:.\-]+Z)\]/.exec(String(rationale || ""));
  return m ? { n: Number(m[1]), at: Date.parse(m[2]) || 0 } : { n: 0, at: 0 };
}
// IDEA-TRIAGE-COOLING-STARVE-1 (1.14.4, agent_issues 1000411): triage took the TRIAGE_BATCH oldest-created marked rows and then skipped the ones still cooling in JS, so
// five rows past their third failure (one try a day) held the batch slots while 19 rows that had failed once sat untried for days (24 marked of 33 new on 2026-10-26). The
// test is now in the SQL: a marked row that is still cooling (SCORING_RETRY_FAST or more failures, the last under SCORING_RETRY_SLOW_MS ago) is not selected and is only counted,
// and the marked rows that are selected go oldest last failure first. The marker is "[scoring-error N ISO] reason": N starts at character 16, the 24-character ISO time follows it.
var MARKED_SQL = "COALESCE(rationale, '') LIKE '[scoring-error %'";
var MARK_AT_SQL = "substr(COALESCE(rationale, ''), 16 + instr(substr(COALESCE(rationale, ''), 16), ' '), 24)";
var COOLING_SQL = MARKED_SQL + " AND CAST(substr(COALESCE(rationale, ''), 16, instr(substr(COALESCE(rationale, ''), 16), ' ') - 1) AS INTEGER) >= ?1 AND " + MARK_AT_SQL + " > ?2";
async function triageProposals(env, deadline) {
  // CRON-WALL-DEADLINE-1 (1.10.7, agent_issues 2904): the hourly cycle ended exceededWallTime because triage ran its full
  // batch (each row up to 3 scorecard models + an arXiv novelty screen) with no internal wall clock, and a single stage can
  // push the invocation past the 15-minute cron wall limit. A deadline (epoch ms) breaks the loop between rows; a skipped row
  // stays status 'new' for the next cycle. Absent deadline (tests) behaviour is unchanged.
  var out = { triaged: 0, accepted: 0, errors: 0, scoring_failed: 0, scoring_cooling: 0, scoring_error: null, deferred: 0, released: 0, diversity_held: 0, diversity_released: 0, diversity_expired: 0, wall_cut: 0, novelty: { screened: 0, held: 0, foundational_quota: 0, unscreened: 0, last_error: null } };
  var budget = await aiBudgetBreach(env);
  out.budget_breached = budget.breached;
  out.lean = budget.breached;
  {
    // Rows a 1.5.x run left as deferred_budget go back to 'new' every run (the cap no longer defers scoring).
    try {
      var rel = await env.QNFO_AUDIT.prepare("UPDATE idea_proposals SET status='new' WHERE id IN (SELECT id FROM idea_proposals WHERE status='deferred_budget' ORDER BY created_at ASC LIMIT ?1)").bind(TRIAGE_BATCH).run();
      out.released = Number(rel && rel.meta && rel.meta.changes) || 0;
    } catch (e) { out.errors++; }
  }
  // IDEAS-CAP-GENERATED-RELEASE-1 (1.11.1, agent_issues 100047): enqueueAccepted holds a generated ACCEPT as triaged_hold with a
  // '[research admission cap n/120]' rationale while the queue is full, and nothing ever re-admitted it (66 rows held since
  // 2026-10-17 on 2026-10-19). Each run now re-queues held cap rows oldest first, as many as fit under RESEARCH_ADMISSION_CAP
  // and at most TRIAGE_BATCH. IDEAS-CAP-RATE-1 (1.12.0): the cap itself stays, but a full queue no longer releases nothing; at or over
  // the cap, CAP_TRICKLE_PER_RUN held rows are admitted per run (a rate, not a hold with no expiry).
  try {
    await capRelease(env, out);
    out.released = (out.released || 0) + (out.cap_released || 0);
  } catch (e) {
    out.errors++;
  }
  // IDEA-SCORING-POISON-1 (1.13.0): rows that failed scoring earlier carry a [scoring-error N ISO] marker in rationale and go after the clean ones.
  // IDEA-TRIAGE-COOLING-STARVE-1 (1.14.4): rows still cooling are counted, not selected, and marked rows go oldest last failure first.
  var coolCutoff = new Date(Date.now() - SCORING_RETRY_SLOW_MS).toISOString();
  try {
    var cooling = await env.QNFO_AUDIT.prepare("SELECT COUNT(*) AS n FROM idea_proposals WHERE status='new' AND " + COOLING_SQL).bind(SCORING_RETRY_FAST, coolCutoff).first();
    out.scoring_cooling = Number(cooling && cooling.n) || 0;
  } catch (e) { out.errors++; }
  var rows = (await env.QNFO_AUDIT.prepare("SELECT id, idea, name, contact, rationale FROM idea_proposals WHERE status='new' AND NOT (" + COOLING_SQL + ") ORDER BY (CASE WHEN " + MARKED_SQL + " THEN 1 ELSE 0 END) ASC, (CASE WHEN " + MARKED_SQL + " THEN " + MARK_AT_SQL + " ELSE '' END) ASC, CASE WHEN name = 'owner-corpus' THEN 0 ELSE 1 END ASC, created_at ASC LIMIT ?3").bind(SCORING_RETRY_FAST, coolCutoff, TRIAGE_BATCH).all()).results || [];
  // IDEA-DIVERSITY-CAP-1: the 30-day accepted mix, read once and kept current as this run accepts. Unreadable: no cap
  // this run (null), and the error is counted.
  var mix = null;
  try { mix = await acceptedMix(env); } catch (e) { out.errors++; }
  for (var i = 0; i < rows.length; i++) {
    if (deadline && Date.now() > deadline) { out.wall_cut += rows.length - i; break; } // CRON-WALL-DEADLINE-1
    var row = rows[i], now = new Date().toISOString();
    var se = scoringErrorState(row.rationale);
    if (se.n >= SCORING_RETRY_FAST && Date.now() - se.at < SCORING_RETRY_SLOW_MS) continue; // counted by the query above; a row that crossed the 24-hour edge during this run waits a cycle
    try {
      // Research questions from the fleet's own producers are ideas, not chat questions: the chat-question filter
      // would HOLD every think-loop proposal unscored ("Can X predict Y?" matches it). OWNER-SIGNAL-INTAKE-1: Ask QWAV
      // gaps (ask-gap) are questions by construction, and notebook extractions are research text. A short chat question
      // typed by the owner ("What is a qubit?") is still held: it asks for an answer, not for a paper.
      var kind = proposalKind(row);
      var internal = row.name === "think-loop" || row.name === "auto-reentry" || row.name === "ask-gap" || kind === "corpus";
      if (isNoise(row.idea) || (!internal && isQuestion(row.idea))) {
        await env.QNFO_AUDIT.prepare("UPDATE idea_proposals SET decision='HOLD', rationale=?, triaged_at=?, status='triaged_hold' WHERE id=?").bind("noise/question filter", now, row.id).run();
        out.triaged++; continue;
      }
      var s = await scoreIdea(env, row.idea, budget.breached);
      if (s.error && kind !== "direct") {
        // IDEA-SCORING-POISON-1 (1.13.0): recorded on the row, retried a bounded number of times, and not a cron fault.
        out.scoring_failed++;
        if (!out.scoring_error) out.scoring_error = String(s.error).slice(0, 200);
        await env.QNFO_AUDIT.prepare("UPDATE idea_proposals SET rationale = ?1 WHERE id = ?2 AND status = 'new'").bind("[scoring-error " + (se.n + 1) + " " + now + "] " + String(s.error).slice(0, 160), row.id).run();
        continue;
      }
      if (s.error) s = { score: null, decision: "HOLD", rationale: "scoring unavailable: " + String(s.error).slice(0, 80) };
      s = ownerDecision(kind, s);
      if (kind !== "generated") out.owner_accepted = (out.owner_accepted || 0) + (s.decision === "ACCEPT" ? 1 : 0);
      // IDEA-NOVELTY-1: a generated ACCEPT is screened against the literature before the diversity cap sees it.
      var fq = false;
      if (s.decision === "ACCEPT" && kind === "generated") {
        var nv = await noveltyScreen(env, row.idea, mix, budget.breached);
        if (!nv.screened) { out.novelty.unscreened++; out.novelty.last_error = String(nv.error || "").slice(0, 300); }
        else {
          out.novelty.screened++;
          if (nv.errors && nv.errors.length) out.novelty.last_error = nv.errors.join("; ").slice(0, 300);
          s.rationale = nv.tag + " " + (s.rationale || "");
          if (nv.hold) { s.decision = "HOLD"; out.novelty.held++; }
          else if (nv.foundational_quota) { fq = true; out.novelty.foundational_quota++; }
        }
      }
      var cluster = s.decision === "ACCEPT" ? proposalCluster(row.idea, mix ? mix.clusters : []) : null;
      var verdict = cluster && mix ? diversityVerdict(mix, cluster, row.name) : null;
      if (verdict) {
        await env.QNFO_AUDIT.prepare("UPDATE idea_proposals SET decision='DEFER-DIVERSITY', score=?, rationale=?, triaged_at=?, status='deferred_diversity' WHERE id=?").bind(s.score, "[diversity hold " + now.slice(0, 16) + "Z: " + cluster + " would be " + verdict.pct + "% of 30-day " + verdict.population + ", cap " + Math.round(100 * DIVERSITY_MAX_SHARE) + "%] " + (s.rationale || ""), now, row.id).run();
        out.triaged++; out.diversity_held++; continue;
      }
      await env.QNFO_AUDIT.prepare("UPDATE idea_proposals SET decision=?, score=?, rationale=?, triaged_at=?, status=? WHERE id=?").bind(s.decision, s.score, s.rationale || "", now, s.decision === "ACCEPT" ? "triaged_accepted" : "triaged_hold", row.id).run();
      out.triaged++;
      if (s.decision === "ACCEPT") {
        await enqueueAccepted(env, row.id, row.idea, s.score, now, kind === "direct");
        out.accepted++;
        if (mix) { mixAdd(mix, row.name, cluster); if (fq) mix.foundational++; }
      }
    } catch (e) { out.errors++; }
  }
  if (mix) {
    try { await diversityRelease(env, mix, false, out); } catch (e) { out.errors++; }
    out.diversity = mixShare(mix);
  }
  try {
    var dc = await env.QNFO_AUDIT.prepare("SELECT COUNT(*) AS n FROM idea_proposals WHERE status='deferred_budget'").first();
    out.deferred_total = Number(dc && dc.n) || 0;
    var dd = await env.QNFO_AUDIT.prepare("SELECT COUNT(*) AS n FROM idea_proposals WHERE status='deferred_diversity'").first();
    out.diversity_held_total = Number(dd && dd.n) || 0;
    var at = new Date().toISOString();
    await env.QNFO_AUDIT.prepare("INSERT OR REPLACE INTO cloud_ops_events (id, ts, kind, text, meta, job, status) VALUES ('idea-triage-budget', ?1, 'idea-triage-budget', ?2, ?3, 'idea-hub', ?4)")
      .bind(at, "idea triage: " + (budget.breached ? "AI budget caps breached, scored lean on one cheap model; " : "caps clear; ") + out.released + " released, " + out.triaged + " triaged, " + out.deferred_total + " waiting as deferred_budget, " + out.diversity_held_total + " as deferred_diversity", JSON.stringify({ version: VERSION, breached: budget.breached, caps: budget.caps, deferred_run: out.deferred, released_run: out.released, cap_released_run: out.cap_released || 0, cap_trickled_run: out.cap_trickled || 0, deferred_total: out.deferred_total, triaged_run: out.triaged, diversity_held_run: out.diversity_held, diversity_released_run: out.diversity_released, diversity_expired_run: out.diversity_expired, diversity_held_total: out.diversity_held_total, diversity: out.diversity || null, novelty: out.novelty, scoring_failed: out.scoring_failed, scoring_cooling: out.scoring_cooling, scoring_error: out.scoring_error, errors: out.errors }), budget.breached ? "lean" : "ok").run();
  } catch (e) { console.error(JSON.stringify({ worker: "idea-hub", where: "triageProposals", error: String(e && e.message || e).slice(0, 300) })); }
  // OWNER-SIGNAL-INTAKE-1: metric owner_signal_share_30d (registered with its trigger in
  // migrations/2026-10-07-owner-signal-intake.sql) is the share of research_queue rows created in the last 30 days that
  // came from an owner proposal (direct or notebook). This run is its producer.
  try {
    var osm = await env.QNFO_AUDIT.prepare("SELECT COUNT(*) AS n, SUM(CASE WHEN p.name = 'owner-corpus' OR p.name LIKE 'owner%' OR p.name LIKE 'rowan%' OR p.name = 'chat-session' OR p.contact = 'owner' OR p.contact LIKE 'rowan%' THEN 1 ELSE 0 END) AS own FROM research_queue q LEFT JOIN idea_proposals p ON q.source = 'proposal' AND CAST(p.id AS TEXT) = q.source_id WHERE replace(substr(q.created_at, 1, 19), 'T', ' ') >= datetime('now', '-30 day') AND q.source <> 'diagnostic'").first();
    var osn = Number(osm && osm.n) || 0, oso = Number(osm && osm.own) || 0;
    out.owner_signal_share_30d = osn ? Math.round(1000 * oso / osn) / 1000 : 0;
    await env.QNFO_AUDIT.prepare("UPDATE metric_registry SET last_value = ?1, last_refreshed = ?2 WHERE metric = 'owner_signal_share_30d'").bind(String(out.owner_signal_share_30d), new Date().toISOString()).run();
  } catch (e) { console.error(JSON.stringify({ worker: "idea-hub", where: "triageProposals", error: String(e && e.message || e).slice(0, 300) })); }
  console.log("BUDGET-SOFT-ROUTE-1 idea-triage " + JSON.stringify(out));
  try { await env.QNFO_AUDIT.prepare("INSERT INTO fleet_heartbeat (worker, version, ts, ok) VALUES ('idea-hub', ?1, ?2, ?3) ON CONFLICT(worker) DO UPDATE SET version=excluded.version, ts=excluded.ts, ok=excluded.ok").bind(VERSION, new Date().toISOString(), out.errors ? 0 : 1).run(); } catch (e) { console.error(JSON.stringify({ worker: "idea-hub", where: "triageProposals", error: String(e && e.message || e).slice(0, 300) })); }
  return out;
}

// ---- L8 re-entry loop (ported from qnfo-signal-loop 1.1.2, bounded) ----
var REENTRY_BATCH = 20, CONSUME_SIGNALS = 2, CONSUME_QUESTIONS = 3, PROPOSAL_BACKPRESSURE = 30;
// PROPOSAL-HEADROOM-1 (1.8.6, agent_issues 2489; owner task op-mv6meusn21b1: "Idea intake -> triage stuck with backpressure: 35
// waiting (new <= 30)"). Each batch producer checked only that the queue was at or under PROPOSAL_BACKPRESSURE and then added a
// whole batch (re-entry up to CONSUME_SIGNALS x CONSUME_QUESTIONS questions, ask gaps up to ASK_GAP_BATCH, the notebook up to
// OWNER_CORPUS_BATCH notes), while triage takes TRIAGE_BATCH a cycle; on 2026-10-13 auto-reentry (84) and owner-corpus (59) added
// about six an hour against five triaged, so the queue sat above the chain's limit of 30 by design. The batch producers now fill
// the queue only up to PROPOSAL_FILL_TO, counting what the same cycle already added. Nothing is dropped: a signal, gap or note left
// out stays where it is (signals new, ask_events uncovered, the note unseen) for the next cycle. An unreadable count leaves the
// producers as they were.
var PROPOSAL_FILL_TO = 25;
// PROPOSAL-COOLING-1 (1.14.3, agent_issues 1000244): the proposals that await triage, as one WHERE clause shared by every backpressure and room
// count below (proposalRoom, runConsume, runOwnerCorpus, thinkLoop, runAskGap). A row IDEA-SCORING-POISON-1 could not score carries a
// "[scoring-error N ISO]" marker in rationale and stays in 'new': it waits for a model that can read it, not for triage capacity, and from its
// third failure triage tries it once a day. On 2026-10-26 24 of the 33 'new' rows carried the marker, which held the count above
// PROPOSAL_BACKPRESSURE (30) and left runConsume paused and every producer without room. A marked row is not counted here; triage still
// selects and scores it on its own schedule (that query is unchanged), and it counts again once a score replaces the marker.
var PROPOSAL_PENDING_WHERE = "status IN ('new', 'deferred_budget') AND COALESCE(rationale, '') NOT LIKE '%[scoring-error%'";
async function proposalRoom(env) {
  var p = await env.QNFO_AUDIT.prepare("SELECT COUNT(*) AS n FROM idea_proposals WHERE " + PROPOSAL_PENDING_WHERE).first().catch(function (e) { console.error("idea-hub proposalRoom: " + String(e && e.message || e).slice(0, 160)); return null; });
  return p ? PROPOSAL_FILL_TO - Number(p.n) : null;
}
// REENTRY-RESCORE-1 (1.3.1): the 1.2.0 port dropped qnfo-signal-loop's re-score leg, so a signal emitted with no
// detectable open questions (evidential_weight 0) could never be consumed even after its paper gained a body. Each run
// re-checks RESCORE_BATCH weight-0 signals, oldest-checked first (ts rotates); a signal whose paper is no longer in
// living-paper is expired with that reason instead of being re-checked forever.
var RESCORE_BATCH = 10;
// REENTRY-DRAIN-1 (1.5.6, #1654 SIGNALS-TRIAGE-GAP-1): status='new' re-entry signals had no terminal state. A weight-0
// signal (no open question found in its paper) fails the consume filter (evidential_weight > 0) for ever, and the re-score
// leg above only expired it when the paper had left living-paper; otherwise it rotated ts. On 2026-10-05 242 of the 245
// status='new' rows were weight 0 (all re-checked within the last 24 h, none ever re-scored: no weight>0 row has
// ts <> created_at), and the 3 weight>0 rows wait on the owner's pause (signal_worker_boundary idea-hub/artifact_reentry
// permitted=0, OWNER-NARROW-SIGNAL-1, until SIGNAL-INTAKE-1 #1947). Consuming them would feed the two-model triage
// (paid Workers AI) while fleet_budget caps are breached, so the remedy is an age rule, model-free and bounded:
//   1. a weight-0 signal older than REENTRY_NOQ_TTL_H gets one last re-check against its paper (oldest first, at most
//      REENTRY_EXPIRE_BATCH a run) and is expired if it still has no open question, so every such signal leaves 'new'
//      inside the 24 h window this issue's contract measures;
//   2. a weight>0 signal still status='new' after REENTRY_TTL_DAYS is expired (a week for a paused or backed-up consumer
//      to take it; younger rows stay consumable when the pause lifts);
//   3. while the boundary row is not permitted, no new signal is emitted (the owner paused re-entry; emitting rows that
//      nothing may consume only regrows the backlog).
// Expiry is a status change only: the row, its open_questions and its weight are kept and the reason is in decision.
var REENTRY_NOQ_TTL_H = 20, REENTRY_TTL_DAYS = 7, REENTRY_EXPIRE_BATCH = 50;
// NOZ-DOI-1 (2026-10-11): a paper is keyed by its DOI when it has a real one and by its slug otherwise (new papers carry no DOI).
// The last type is the identifier_type value legacy owner-authored rows still carry in living-paper; it is matched as data only and
// never emitted anywhere (spelled in two parts so no public text can pick it up).
var PAPER_KEY_SQL = "COALESCE(NULLIF(doi, ''), slug)";
var REENTRY_OWNER_TYPES = ["slug", "doi", "internal", "owner", "zen" + "odo"];
var REENTRY_OWNER_DOI_MAX = 5000; // growth bound for the owner-pipeline DOI list (one JSON parameter, see runReentry), not a bind limit
var REENTRY_SCAN_LIMIT = 500; // papers one run reads (newest first); a run that reaches it says so in out.scan_capped
// The owner-only re-entry has its own boundary row, so the pre-1.7.0 code (which still reads 'artifact_reentry', paused by
// OWNER-NARROW-SIGNAL-1) can never resume the arXiv-wide scan if a deploy lags the migration that opens this one.
var REENTRY_BOUNDARY_SOURCE = "artifact_reentry_owner";
function extractOpenQuestions(bodyMd) {
  if (!bodyMd) return [];
  var text = String(bodyMd), out = [], seen = new Set();
  var push = function (x) {
    var t = String(x).replace(/\s+/g, " ").replace(/^[\s*\-\d.]+/, "").trim();
    if (t.length < 15 || t.length > 320) return;
    var k = t.slice(0, 80).toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    if (out.length < 15) out.push(t);
  };
  var m = text.match(/##?\s*(Open Questions?|Open Problems?|Future Work|Future Directions?|Limitations?|Outlook|Unresolved|Discussion)[\s\S]{0,4000}/i);
  if (m) m[0].split("\n").forEach(function (l) { if (/^\s*([-*]|\d+\.)\s+\S/.test(l)) push(l); });
  (text.match(/[^.\n]{12,300}?(open question|remains? open|open problem|unresolved|future work|not yet (known|understood|resolved|established)|unknown whether|remains? to be)[^.\n]{0,240}[.?]/gi) || []).forEach(push);
  (text.match(/[^.\n?]{25,300}\?/g) || []).forEach(push);
  return out;
}
async function reentryPermitted(env) {
  try {
    var b = await env.QNFO_AUDIT.prepare("SELECT permitted FROM signal_worker_boundary WHERE worker='idea-hub' AND source='" + REENTRY_BOUNDARY_SOURCE + "'").first();
    return !!b && Number(b.permitted) === 1;
  } catch (e) { return false; }
}
async function runReentry(env) {
  var out = { scanned: 0, emitted: 0, errors: 0, permitted: await reentryPermitted(env) };
  var papers = [], have = new Set();
  if (out.permitted) {
    // OWNER-SIGNAL-INTAKE-1 (1.7.0): re-entry reads only the owner's own papers. The newest-500 scan recycled arXiv-derived
    // QEC papers into more QEC (the reason for OWNER-NARROW-SIGNAL-1); REENTRY_OWNER_TYPES are the identifier types of
    // papers the owner wrote (his slugs, DOIs, internal), not arxiv, kg-backfill or pipeline 'qnfo' rows.
    // REENTRY-BIND-LIMIT-1 (1.14.2, agent_issues 1000244): D1 allows 100 bound parameters per query, and one "?" per DOI broke
    // this query once the owner pipeline passed 95 DOIs (201 on 2026-10-26). The DOIs are now ONE bound parameter, a JSON array
    // read by json_each(?) (D1 supports json_each), so the statement binds REENTRY_OWNER_TYPES.length (5) + 1 parameters at any
    // DOI count; the five identifier types stay one "?" each. The old slice(0, 200) is gone because it dropped, unordered and
    // silently, every owner paper past the 200th as the pipeline grows. REENTRY_OWNER_DOI_MAX is only a growth bound (a DOI is about
    // 77 characters on 2026-10-26, so 5000 of them are about 400 KB of JSON, under D1's 2 MB value limit; the 100 KB statement
    // limit does not apply to a bound value). The query's own LIMIT (REENTRY_SCAN_LIMIT, 500) still caps the papers read, newest
    // first. Both cuts are reported, in out.owner_dois_capped and out.scan_capped, instead of passing unseen.
    var allOwn = await ownerPipelineDois(env);
    var ownDois = allOwn.slice(0, REENTRY_OWNER_DOI_MAX);
    out.owner_dois = ownDois.length;
    if (allOwn.length > ownDois.length) out.owner_dois_capped = allOwn.length;
    // A failure here (living-paper or the signals read) must not stop the drain legs below, which read and write qnfo-audit
    // only: the emission is skipped for this run, the failure is counted and logged, and the drain still runs.
    try {
      papers = (await env.LIVING_PAPER.prepare("SELECT " + PAPER_KEY_SQL + " AS doi, title FROM papers WHERE " + PAPER_KEY_SQL + " IS NOT NULL AND " + PAPER_KEY_SQL + " != '' AND body_md IS NOT NULL AND body_md != '' AND status IN ('published','distributed') AND (identifier_type IN (" + REENTRY_OWNER_TYPES.map(function () { return "?"; }).join(",") + ")" + (ownDois.length ? " OR " + PAPER_KEY_SQL + " IN (SELECT value FROM json_each(?))" : "") + ") ORDER BY created_at DESC LIMIT " + REENTRY_SCAN_LIMIT).bind(...REENTRY_OWNER_TYPES, ...(ownDois.length ? [JSON.stringify(ownDois)] : [])).all()).results || [];
      have = new Set(((await env.QNFO_AUDIT.prepare("SELECT source_ref FROM signals WHERE source='artifact_reentry'").all()).results || []).map(function (r) { return String(r.source_ref); }));
    } catch (e) {
      papers = []; have = new Set(); out.errors++;
      out.emit_error = String(e && e.message || e).slice(0, 300);
      console.error(JSON.stringify({ worker: "idea-hub", where: "runReentry.emit", error: out.emit_error }));
    }
  } else out.emit_paused = "signal_worker_boundary idea-hub/" + REENTRY_BOUNDARY_SOURCE + " not permitted";
  out.scanned = papers.length;
  if (papers.length >= REENTRY_SCAN_LIMIT) out.scan_capped = true;
  var todo = papers.filter(function (p) { return !have.has(String(p.doi)); }).slice(0, REENTRY_BATCH);
  for (var i = 0; i < todo.length; i++) {
    var p = todo[i];
    try {
      var pr = await env.LIVING_PAPER.prepare("SELECT substr(body_md, 1, 12000) AS b FROM papers WHERE " + PAPER_KEY_SQL + " = ? LIMIT 1").bind(p.doi).first();
      var oq = extractOpenQuestions(pr && pr.b || "");
      var now = new Date().toISOString();
      await env.QNFO_AUDIT.prepare("INSERT OR IGNORE INTO signals (id, ts, source, source_ref, content, open_questions, evidential_weight, domain, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
        .bind("artifact_reentry:" + String(p.doi).replace(/[^a-z0-9]+/gi, "-").slice(0, 80), now, "artifact_reentry", p.doi, String(p.title || "").slice(0, 500), JSON.stringify(oq), oq.length ? 0.9 : 0, "research", "new", now).run();
      out.emitted++;
    } catch (e) { out.errors++; }
  }
  out.rescored = 0; out.expired = 0; out.expired_noq = 0; out.expired_stale = 0;
  var nowMs = Date.now(), cutNoq = new Date(nowMs - REENTRY_NOQ_TTL_H * 3600e3).toISOString();
  // REENTRY-DRAIN-1 rule 2 (runs first, so a signal re-scored below still gets this run's consume leg): a weight>0 signal
  // older than REENTRY_TTL_DAYS, bounded, oldest first.
  try {
    var st = await env.QNFO_AUDIT.prepare("UPDATE signals SET status='expired', decision=?1, ts=?2 WHERE id IN (SELECT id FROM signals WHERE source='artifact_reentry' AND status='new' AND COALESCE(evidential_weight,0) > 0 AND created_at < ?3 ORDER BY created_at ASC LIMIT ?4)")
      .bind("idea-hub " + VERSION + ": REENTRY-DRAIN-1 not consumed within " + REENTRY_TTL_DAYS + " days (consume leg paused or backed up); open_questions kept", new Date().toISOString(), new Date(nowMs - REENTRY_TTL_DAYS * 864e5).toISOString(), REENTRY_EXPIRE_BATCH).run();
    out.expired_stale = Number(st && st.meta && st.meta.changes) || 0;
  } catch (e) { out.errors++; }
  // REENTRY-DRAIN-1 rule 1: weight-0 signals past REENTRY_NOQ_TTL_H, oldest first, one paper read for the whole batch.
  var old0 = (await env.QNFO_AUDIT.prepare("SELECT id, source_ref FROM signals WHERE source='artifact_reentry' AND status='new' AND COALESCE(evidential_weight,0)=0 AND created_at < ?1 ORDER BY created_at ASC LIMIT ?2").bind(cutNoq, REENTRY_EXPIRE_BATCH).all()).results || [];
  if (old0.length) {
    var refs = old0.map(function (r) { return String(r.source_ref); }), bodies = new Map();
    try {
      var pb = (await env.LIVING_PAPER.prepare("SELECT " + PAPER_KEY_SQL + " AS doi, substr(body_md, 1, 12000) AS b FROM papers WHERE " + PAPER_KEY_SQL + " IN (" + refs.map(function () { return "?"; }).join(",") + ")").bind(...refs).all()).results || [];
      pb.forEach(function (r) { var k = String(r.doi); if (!bodies.has(k) || (!bodies.get(k) && r.b)) bodies.set(k, r.b || ""); });
    } catch (e) { out.errors++; old0 = []; }
    for (var x = 0; x < old0.length; x++) {
      var so = old0[x], ref = String(so.source_ref), nowX = new Date().toISOString();
      try {
        if (!bodies.has(ref)) { await env.QNFO_AUDIT.prepare("UPDATE signals SET status='expired', decision=?, ts=? WHERE id=? AND status='new'").bind("idea-hub " + VERSION + ": paper " + ref.slice(0, 80) + " not in living-paper", nowX, so.id).run(); out.expired++; continue; }
        var oqx = extractOpenQuestions(bodies.get(ref));
        if (oqx.length) { await env.QNFO_AUDIT.prepare("UPDATE signals SET open_questions=?, evidential_weight=0.9, ts=? WHERE id=?").bind(JSON.stringify(oqx), nowX, so.id).run(); out.rescored++; continue; }
        await env.QNFO_AUDIT.prepare("UPDATE signals SET status='expired', decision=?, ts=? WHERE id=? AND status='new'").bind("idea-hub " + VERSION + ": REENTRY-DRAIN-1 no open question found in the paper after " + REENTRY_NOQ_TTL_H + " h of re-checks (a weight-0 signal is never consumed)", nowX, so.id).run();
        out.expired_noq++;
      } catch (e) { out.errors++; }
    }
  }
  // Re-score rotation for the younger weight-0 signals (REENTRY-RESCORE-1).
  var zero = (await env.QNFO_AUDIT.prepare("SELECT id, source_ref FROM signals WHERE source='artifact_reentry' AND status='new' AND COALESCE(evidential_weight,0)=0 AND created_at >= ?1 ORDER BY ts ASC LIMIT ?2").bind(cutNoq, RESCORE_BATCH).all()).results || [];
  for (var z = 0; z < zero.length; z++) {
    var sg = zero[z], nowZ = new Date().toISOString();
    try {
      var pz = await env.LIVING_PAPER.prepare("SELECT substr(body_md, 1, 12000) AS b FROM papers WHERE " + PAPER_KEY_SQL + " = ? LIMIT 1").bind(sg.source_ref).first();
      if (!pz) { await env.QNFO_AUDIT.prepare("UPDATE signals SET status='expired', decision=?, ts=? WHERE id=?").bind("idea-hub " + VERSION + ": paper " + String(sg.source_ref).slice(0, 80) + " not in living-paper", nowZ, sg.id).run(); out.expired++; continue; }
      var oqz = extractOpenQuestions(pz.b || "");
      if (oqz.length) { await env.QNFO_AUDIT.prepare("UPDATE signals SET open_questions=?, evidential_weight=0.9, ts=? WHERE id=?").bind(JSON.stringify(oqz), nowZ, sg.id).run(); out.rescored++; }
      else await env.QNFO_AUDIT.prepare("UPDATE signals SET ts=? WHERE id=?").bind(nowZ, sg.id).run();
    } catch (e) { out.errors++; }
  }
  return out;
}
// OWNER-SIGNAL-INTAKE-2: the DOIs of pipeline papers (identifier_type qnfo) whose research_queue row came from an owner
// proposal, direct or notebook: those are the owner's ideas carried through the pipeline, so re-entry treats them as his.
var OWNER_PROPOSAL_SQL = "p.name = 'owner-corpus' OR p.name LIKE 'owner%' OR p.name LIKE 'rowan%' OR p.name = 'chat-session' OR p.contact = 'owner' OR p.contact LIKE 'rowan%'";
async function ownerPipelineDois(env) {
  try {
    var rs = (await env.QNFO_AUDIT.prepare("SELECT DISTINCT COALESCE(NULLIF(q.doi, ''), q.paper_slug) AS doi FROM research_queue q JOIN idea_proposals p ON q.source = 'proposal' AND CAST(p.id AS TEXT) = q.source_id WHERE q.status = 'published' AND COALESCE(NULLIF(q.doi, ''), q.paper_slug) IS NOT NULL AND COALESCE(NULLIF(q.doi, ''), q.paper_slug) <> '' AND (" + OWNER_PROPOSAL_SQL + ")").all()).results || [];
    return rs.map(function (r) { return String(r.doi); });
  } catch (e) { return []; }
}
// OWNER-SIGNAL-INTAKE-2: true when the paper behind a re-entry signal is one of the owner's own (REENTRY_OWNER_TYPES, or a
// pipeline paper that came from an owner proposal).
async function ownerPaper(env, doi) {
  if (!env.LIVING_PAPER || !doi) return false;
  if ((await ownerPipelineDois(env)).indexOf(String(doi)) >= 0) return true;
  try {
    var p = await env.LIVING_PAPER.prepare("SELECT identifier_type FROM papers WHERE " + PAPER_KEY_SQL + " = ?1 AND identifier_type IN (" + REENTRY_OWNER_TYPES.map(function () { return "?"; }).join(",") + ") LIMIT 1").bind(String(doi), ...REENTRY_OWNER_TYPES).first();
    return !!p;
  } catch (e) { return false; }
}
// A re-entry line is a research question when it asks one: it ends with "?" or says what is unknown ("whether", "remains
// open", "unresolved", "not yet known"). "We flag this as an open question rather than a result." only mentions one.
function realQuestion(t) {
  t = String(t || "").trim();
  if (/\?\s*$/.test(t)) return true;
  return /\b(whether|remains? (open|unknown|unresolved|to be (shown|determined|established))|unresolved|not yet (known|understood|resolved|established)|open problem)\b/i.test(t) && !/\b(we|this paper|this note) (flag|leave|treat|mark)\b/i.test(t);
}
// HOLD-RELEASE-REENTRY-1 (1.8.0, agent_issues 2174, owner directive 2026-10-08: remove holds, prefer backpressure): a
// re-entry signal from a non-owner paper (pipeline or arXiv-derived) was expired outright (OWNER-SIGNAL-INTAKE-2). Removing
// the filter would let every published paper feed questions about itself back in without bound, so it is a rate instead:
// at most REENTRY_NONOWNER_PER_DAY such signals are consumed per UTC day (oldest first) and the rest stay new for the next
// day; owner-paper re-entries are not limited. The read window is wider than the consume count, so held non-owner rows
// can never starve an owner row behind them.
var REENTRY_NONOWNER_PER_DAY = 2, CONSUME_WINDOW = 20;
var REENTRY_NONOWNER_MARK = "HOLD-RELEASE-REENTRY-1 non-owner";
async function runConsume(env) {
  var out = { consumed: 0, proposals: 0, paused: false, errors: 0 };
  var pending = await env.QNFO_AUDIT.prepare("SELECT COUNT(*) n FROM idea_proposals WHERE " + PROPOSAL_PENDING_WHERE).first();
  if (pending && Number(pending.n) > PROPOSAL_BACKPRESSURE) { out.paused = true; return out; }
  var room = pending ? PROPOSAL_FILL_TO - Number(pending.n) : null; // PROPOSAL-HEADROOM-1
  if (room !== null && room <= 0) { out.paused = true; out.room = room; return out; }
  var b = await env.QNFO_AUDIT.prepare("SELECT permitted FROM signal_worker_boundary WHERE worker='idea-hub' AND source='" + REENTRY_BOUNDARY_SOURCE + "'").first();
  if (!b || Number(b.permitted) !== 1) { out.paused = true; return out; }
  var rows = (await env.QNFO_AUDIT.prepare("SELECT id, source_ref, open_questions FROM signals WHERE source='artifact_reentry' AND status='new' AND evidential_weight > 0 ORDER BY created_at LIMIT ?1").bind(CONSUME_WINDOW).all()).results || [];
  var dayStart = new Date().toISOString().slice(0, 10) + "T00:00:00Z";
  var nonOwnerToday = 0;
  try { var nt = await env.QNFO_AUDIT.prepare("SELECT COUNT(*) n FROM signals WHERE source='artifact_reentry' AND status='consumed' AND instr(COALESCE(decision, ''), ?1) > 0 AND ts >= ?2").bind(REENTRY_NONOWNER_MARK, dayStart).first(); nonOwnerToday = nt ? Number(nt.n) : 0; } catch (e) { console.error(JSON.stringify({ worker: "idea-hub", where: "runConsume", error: String(e && e.message || e).slice(0, 300) })); }
  for (var i = 0; i < rows.length && out.consumed < CONSUME_SIGNALS; i++) {
    var sg = rows[i], oq = [], nonOwner = false;
    try { oq = JSON.parse(sg.open_questions || "[]"); } catch (e) { console.error(JSON.stringify({ worker: "idea-hub", where: "runConsume", error: String(e && e.message || e).slice(0, 300) })); }
    // HOLD-RELEASE-REENTRY-1: a non-owner paper's signal is admitted under the daily rate, else left new for the next day.
    if (!(await ownerPaper(env, sg.source_ref))) {
      if (nonOwnerToday >= REENTRY_NONOWNER_PER_DAY) { out.deferred_not_owner = (out.deferred_not_owner || 0) + 1; continue; }
      nonOwner = true;
    }
    var ok = true;
    var qs = Array.isArray(oq) ? oq.filter(realQuestion).slice(0, CONSUME_QUESTIONS) : [];
    // PROPOSAL-HEADROOM-1: a signal is consumed whole or left new for the next cycle, never cut short
    if (room !== null && qs.length > room - out.proposals) { out.room_left = room - out.proposals; break; }
    for (var j = 0; j < qs.length; j++) {
      try {
        await env.QNFO_AUDIT.prepare("INSERT INTO idea_proposals (name, idea, contact, status, ip_hash, created_at) VALUES (?,?,?,?,?,?)")
          .bind("auto-reentry", "Re-entry from " + String(sg.source_ref || "").slice(0, 120) + ": " + String(qs[j]).slice(0, 1800), "auto", "new", "l8-reentry", new Date().toISOString()).run();
        out.proposals++;
      } catch (e) { out.errors++; ok = false; }
    }
    if (ok) { await env.QNFO_AUDIT.prepare("UPDATE signals SET status='consumed', decision=?, ts=? WHERE id=?").bind("idea-hub " + VERSION + ": " + (nonOwner ? REENTRY_NONOWNER_MARK + ": " : "") + qs.length + " of " + oq.length + " open questions proposed", new Date().toISOString(), sg.id).run(); if (nonOwner) nonOwnerToday++; out.consumed++; }
  }
  return out;
}

// OWNER-SIGNAL-INTAKE-1 (1.7.0): the think loop used a fixed prompt ("energy-efficient computing, quantum foundations,
// information thermodynamics"), which kept the generated ideas on the themes the owner has moved away from. It now seeds
// from up to THINK_SEED_N of the owner's own accepted ideas (direct and notebook), sampled at random, and asks for a
// question that extends or connects them; with none on file it falls back to the corpus-gap prompt without fixed themes.
var THINK_SEED_N = 3;
async function thinkSeed(env) {
  var rows = [];
  try { rows = (await env.QNFO_AUDIT.prepare("SELECT idea FROM idea_proposals WHERE decision='ACCEPT' AND (name='owner-corpus' OR contact='owner' OR name LIKE 'rowan%' OR name LIKE 'owner%') ORDER BY random() LIMIT ?1").bind(THINK_SEED_N).all()).results || []; } catch (e) { console.error(JSON.stringify({ worker: "idea-hub", where: "thinkSeed", error: String(e && e.message || e).slice(0, 300) })); }
  if (!rows.length) {
    // No accepted owner ideas on file: ground the prompt in the questions this loop already asked (live data), never in a fixed theme list.
    var recentQs = [];
    try { recentQs = ((await env.QNFO_AUDIT.prepare("SELECT question FROM self_questions ORDER BY id DESC LIMIT 12").all()).results || []).map(function (r) { return String(r.question || "").replace(/\s+/g, " ").slice(0, 200); }).filter(Boolean); } catch (e) { console.error(JSON.stringify({ worker: "idea-hub", where: "thinkSeed", error: String(e && e.message || e).slice(0, 300) })); }
    return "Generate one novel research question that fills a gap in the existing QNFO corpus." + (recentQs.length ? " Questions already asked recently (cover different ground from all of them):\n" + recentQs.map(function (q) { return "- " + q; }).join("\n") : "");
  }
  return "The author's own lines of work:\n" + rows.map(function (r) { return "- " + String(r.idea || "").replace(/\s+/g, " ").slice(0, 500); }).join("\n") + "\n\nPropose ONE novel, falsifiable question that extends one of these lines or connects two of them. Stay in the author's own terms and fields.";
}
// ---- owner corpus (OWNER-SIGNAL-INTAKE-1, #2104) ----
// notes_intake (written hourly by calendar-api from the R2 bucket obsidian-vault) indexes the owner's notebook: 6,589
// notes on 2026-10-07, read until now only by the calendar/GTD leg. Each hourly cycle takes OWNER_CORPUS_BATCH notes not
// yet in owner_corpus_seen (newest path first), reads the body from VAULT, and asks one cheap model to extract the
// single strongest original research idea, or none. An extracted idea becomes an idea_proposals row (name 'owner-corpus',
// contact 'owner', ip_hash corpus:<path hash>) that triage ACCEPTs at OWNER_CORPUS_SCORE_MIN. Every note gets one
// owner_corpus_seen row (proposed, none, short, missing, error) so nothing is read twice. The leg pauses under the same
// PROPOSAL_BACKPRESSURE as the others, and while OWNER_CORPUS_RQ_CAP research rows are already waiting, so the notebook
// cannot flood research_queue.
var OWNER_CORPUS_BATCH = 6, OWNER_CORPUS_SLOW_BATCH = 2, OWNER_CORPUS_MIN_CHARS = 600, OWNER_CORPUS_EXCERPT = 7000, OWNER_CORPUS_RQ_CAP = 12;
// RESEARCH-ADMISSION-CAP-1: bound admission to what the executor can hold. See enqueueAccepted().
var RESEARCH_ADMISSION_CAP = 120;
// IDEAS-CAP-RATE-1: at or over the cap, held accepts are admitted at this rate per run (oldest first) instead of waiting for room. See capRelease().
var CAP_TRICKLE_PER_RUN = 3;
var OWNER_CORPUS_FLEET_ERA = "notes/v1/2026/08";
var OWNER_CORPUS_TYPES = ["note", "synthesis", "synthesis-working-draft", "development-note", "lesson"];
var OWNER_NOTE_RETRY_MIN = 120;
var OWNER_CORPUS_MODEL = "@cf/zai-org/glm-5.3-flash";
var OWNER_CORPUS_PROMPT = "You read one note from the private research notebook of Rowan Brad Quni-Gudzinas, an independent researcher. Extract the single strongest ORIGINAL research idea the author is developing in it: a claim, conjecture or question that a theoretical or computational paper could investigate. Ignore assistant boilerplate, chat pleasantries, task lists, system prompts and operations notes. Return JSON only, either {\"title\": \"<= 14 words\", \"idea\": \"<= 160 words: the claim or question, why it matters, and how a derivation, simulation or formal analysis could test it\"} or {\"none\": \"<= 15 words why\"} when the note holds no research idea.\n\nNOTE:\n";
function corpusBody(t) { return String(t || "").replace(/^---\n[\s\S]*?\n---\n/, "").replace(/\r/g, "").trim(); }
async function shortHash(s) {
  var d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(s)));
  return Array.from(new Uint8Array(d)).slice(0, 8).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
}
async function runOwnerCorpus(env, deadline) {
  var out = { ok: true, picked: 0, proposed: 0, none: 0, short: 0, missing: 0, errors: 0, wall_cut: 0 };
  if (!env.VAULT) { out.ok = false; out.why = "VAULT binding absent"; return out; }
  var pending = await env.QNFO_AUDIT.prepare("SELECT COUNT(*) n FROM idea_proposals WHERE " + PROPOSAL_PENDING_WHERE).first();
  if (pending && Number(pending.n) > PROPOSAL_BACKPRESSURE) { out.paused = "proposal backpressure"; return out; }
  var rq = await env.QNFO_AUDIT.prepare("SELECT COUNT(*) n FROM research_queue WHERE status IN ('queued','researching','review','deferred')").first();
  // OWNER-CORPUS-RATE-1 (1.8.1, agent_issues 2185): a full research_queue slows the leg to OWNER_CORPUS_SLOW_BATCH notes per
  // cycle instead of pausing it (ANTIFRAGILE-1: a rate, not a hold). The pause stopped the owner's own notes for 24 h on
  // 2026-10-08 while 47 released re-entries were queued; proposal backpressure above still bounds what reaches triage.
  var batch = OWNER_CORPUS_BATCH;
  if (rq && Number(rq.n) >= OWNER_CORPUS_RQ_CAP) { batch = OWNER_CORPUS_SLOW_BATCH; out.slowed = "research_queue at " + rq.n; }
  var room = await proposalRoom(env); // PROPOSAL-HEADROOM-1: read after re-entry and ask gaps have added theirs this cycle
  if (room !== null) {
    if (room <= 0) { out.paused = "proposal headroom"; out.room = room; return out; }
    if (room < batch) { batch = room; out.capped = "room " + room; }
  }
  await env.QNFO_AUDIT.prepare("CREATE TABLE IF NOT EXISTS owner_corpus_seen (path TEXT PRIMARY KEY, sig TEXT, ts TEXT, outcome TEXT, proposal_id INTEGER, note TEXT)").run();
  // OWNER-SIGNAL-INTAKE-2 (1.7.2): dated notes before OWNER_CORPUS_FLEET_ERA (the owner's own pre-fleet thinking) first,
    // newest first among them, then later dated notes, then undated files (indexes, ops logs). A note whose extraction failed
    // (outcome error1, error2) is retried 120 minutes later; the third failure (error3) is final.
    var rows = (await env.QNFO_AUDIT.prepare("SELECT n.path, n.sig, s.outcome AS prev FROM notes_intake n LEFT JOIN owner_corpus_seen s ON s.path = n.path WHERE (s.path IS NULL OR (s.outcome IN ('error', 'error1', 'error2') AND s.ts < ?)) AND n.type IN (" + OWNER_CORPUS_TYPES.map(function () { return "?"; }).join(",") + ") AND n.path LIKE 'notes/%' AND COALESCE(n.status, '') NOT IN ('archived', 'done') ORDER BY CASE WHEN n.path GLOB 'notes/v1/20[0-9][0-9]/*' THEN 0 ELSE 1 END, CASE WHEN n.path < ? THEN 0 ELSE 1 END, n.path DESC LIMIT ?").bind(new Date(Date.now() - OWNER_NOTE_RETRY_MIN * 6e4).toISOString(), ...OWNER_CORPUS_TYPES, OWNER_CORPUS_FLEET_ERA, batch).all()).results || [];
  for (var i = 0; i < rows.length; i++) {
    if (deadline && Date.now() > deadline) { out.wall_cut += rows.length - i; break; } // CRON-WALL-DEADLINE-1
    var n = rows[i], now = new Date().toISOString(), outcome = "error", pid = null, note = "";
    out.picked++;
    try {
      var obj = await env.VAULT.get(n.path);
      if (!obj) { outcome = "missing"; out.missing++; }
      else {
        var body = corpusBody(await obj.text());
        if (body.length < OWNER_CORPUS_MIN_CHARS) { outcome = "short"; out.short++; }
        else {
          var ai = await aiRunAttr(env, "idea-hub", "owner-corpus", OWNER_CORPUS_MODEL, { messages: [{ role: "user", content: OWNER_CORPUS_PROMPT + body.slice(0, OWNER_CORPUS_EXCERPT) }], max_tokens: REASONING_MAX_TOKENS, temperature: 0.2, reasoning_effort: "low" });
          var m = tExtract(ai).match(/\{[\s\S]*\}/), j = null;
          if (m) { try { j = JSON.parse(m[0]); } catch (e) { /* expected: a reply that is not strict JSON leaves j null and is recorded below as an "unparseable model reply" outcome */ } }
          if (j && j.idea && String(j.idea).trim().length >= 40) {
            var idea = (j.title ? String(j.title).trim().replace(/[.\s]+$/, "") + ". " : "") + String(j.idea).trim().slice(0, 1600) + "\n\nSource: owner notebook " + n.path;
            var tag = "corpus:" + await shortHash(n.path);
            var seen = await env.QNFO_AUDIT.prepare("SELECT id FROM idea_proposals WHERE ip_hash = ?1 LIMIT 1").bind(tag).first();
            if (seen) pid = seen.id;
            else {
              var ins = await env.QNFO_AUDIT.prepare("INSERT INTO idea_proposals (name, idea, contact, status, ip_hash, created_at) VALUES ('owner-corpus', ?1, 'owner', 'new', ?2, ?3)").bind(idea, tag, now).run();
              pid = ins && ins.meta && ins.meta.last_row_id || null;
            }
            outcome = "proposed"; out.proposed++;
          } else if (j && j.none) { outcome = "none"; note = String(j.none).slice(0, 200); out.none++; }
          else { outcome = "error"; note = "unparseable model reply"; out.errors++; }
        }
      }
    } catch (e) { outcome = "error"; note = String(e && e.message || e).slice(0, 200); out.errors++; }
    if (outcome === "error") { var tries = /^error(\d)$/.exec(String(n.prev || "")); outcome = "error" + Math.min(3, (tries ? Number(tries[1]) : (n.prev === "error" ? 1 : 0)) + 1); }
    try { await env.QNFO_AUDIT.prepare("INSERT OR REPLACE INTO owner_corpus_seen (path, sig, ts, outcome, proposal_id, note) VALUES (?1, ?2, ?3, ?4, ?5, ?6)").bind(n.path, n.sig || null, now, outcome, pid, note).run(); } catch (e) { out.errors++; }
  }
  return out;
}
// ---- think loop (folded from qnfo-autopilot 0.3.3) ----
var THINK_EVERY_H = 6;
var THINK_MODEL = "@cf/zai-org/glm-5.3";
async function thinkLoop(env) {
  var pending = await env.QNFO_AUDIT.prepare("SELECT COUNT(*) n FROM idea_proposals WHERE " + PROPOSAL_PENDING_WHERE).first();
  if (pending && Number(pending.n) > PROPOSAL_BACKPRESSURE) return { ok: true, skipped: "backpressure" };
  await env.QNFO_AUDIT.prepare("CREATE TABLE IF NOT EXISTS self_questions (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, question TEXT, hypothesis TEXT, source TEXT, status TEXT)").run();
  var ai = await aiRunAttr(env, "idea-hub", "think", THINK_MODEL, { messages: [
    { role: "system", content: 'You are the research planner for QNFO, an independent research imprint (one researcher with an AI-assisted pipeline). Propose ONE novel, falsifiable research question the fleet should investigate next. Output strict JSON only: {"question": "...", "hypothesis": "...", "why": "..."}. No markdown.' },
    { role: "user", content: await thinkSeed(env) }
  ], max_tokens: 1024 });
  var text = tExtract(ai).trim();
  if (!text) return { ok: false, why: "model empty" };
  var q = null, m = text.match(/\{[\s\S]*\}/);
  if (m) { try { q = JSON.parse(m[0]); } catch (e) { /* expected: a reply that is not strict JSON falls back to the "question" match below, then to why "no parseable question" */ } }
  if (!q || !q.question) { var qm = text.match(/"question"\s*:\s*"([^"]+)"/); if (qm) q = { question: qm[1], hypothesis: "" }; }
  if (!q || !q.question) return { ok: false, why: "no parseable question" };
  var sig = function (x) { var o = new Set(); String(x || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).forEach(function (w) { if (w.length > 4) o.add(w); }); return o; };
  var contain = function (a, b) { if (!a.size || !b.size) return 0; var n = 0; a.forEach(function (x) { if (b.has(x)) n++; }); return n / Math.min(a.size, b.size); };
  var cand = sig(q.question);
  var recent = (await env.QNFO_AUDIT.prepare("SELECT question FROM self_questions WHERE status='open' AND ts >= ?1").bind(new Date(Date.now() - 7 * 864e5).toISOString()).all()).results || [];
  if (recent.some(function (r) { return contain(cand, sig(r.question)) >= 0.6; })) return { ok: true, skipped: "near-duplicate theme" };
  var now = new Date().toISOString(), question = String(q.question).slice(0, 300);
  await env.QNFO_AUDIT.prepare("INSERT INTO self_questions (ts, question, hypothesis, source, status) VALUES (?1, ?2, ?3, 'think-loop', 'open')").bind(now, question, String(q.hypothesis || "").slice(0, 300)).run();
  var d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(question));
  var qh = Array.from(new Uint8Array(d)).slice(0, 4).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
  var existing = await env.QNFO_AUDIT.prepare("SELECT id FROM idea_proposals WHERE ip_hash = ?1 LIMIT 1").bind(qh).first();
  if (!existing) await env.QNFO_AUDIT.prepare("INSERT INTO idea_proposals (name, idea, contact, status, ip_hash, created_at) VALUES ('think-loop', ?1, '', 'new', ?2, ?3)").bind(question, qh, now).run();
  return { ok: true, question: question, routed: !existing };
}
// ASK-GAP-1 (2026-10-02, autonomy audit; pillars research + autonomy): qnfo-ai-search marks an answer 'uncovered' when the
// corpus excerpts do not cover the question (ask_events.uncovered), and nothing read that column. Questions readers asked
// that the corpus cannot answer are the clearest demand signal the fleet has, so each hour the distinct uncovered questions
// of the last 7 days that pass the same research-domain gate as the public feed (publicTitle) become idea proposals
// (name 'ask-gap'), at most ASK_GAP_BATCH a run, deduplicated by question hash, paused under PROPOSAL_BACKPRESSURE like
// re-entry. Triage then scores them with everything else; nothing is published from here.
var ASK_GAP_BATCH = 5;
async function runAskGap(env) {
  var out = { ok: true, candidates: 0, inserted: 0, skipped: 0 };
  var pending = await env.QNFO_AUDIT.prepare("SELECT COUNT(*) AS n FROM idea_proposals WHERE " + PROPOSAL_PENDING_WHERE).first().catch(function () { return null; });
  if (pending && Number(pending.n) > PROPOSAL_BACKPRESSURE) { out.paused = true; return out; }
  var room = pending ? PROPOSAL_FILL_TO - Number(pending.n) : null; // PROPOSAL-HEADROOM-1
  if (room !== null && room <= 0) { out.paused = true; out.room = room; return out; }
  var rows = (await env.QNFO_AUDIT.prepare("SELECT qhash, MIN(query) AS query, COUNT(*) AS n FROM ask_events WHERE uncovered = 1 AND COALESCE(cached, 0) = 0 AND error IS NULL AND query IS NOT NULL AND ts > datetime('now', '-7 days') GROUP BY qhash ORDER BY n DESC, MAX(ts) DESC LIMIT 25").all().catch(function () { return { results: [] }; })).results || [];
  out.candidates = rows.length;
  for (var i = 0; i < rows.length && out.inserted < ASK_GAP_BATCH && (room === null || out.inserted < room); i++) {
    var q = clean(String(rows[i].query || "").replace(/^\[paper:[^\]]*\]\s*/, ""), 600);
    if (!publicTitle(q)) { out.skipped++; continue; }
    var tag = "ask-gap:" + String(rows[i].qhash || "").slice(0, 32);
    var seen = await env.QNFO_AUDIT.prepare("SELECT id FROM idea_proposals WHERE ip_hash = ?1 OR idea = ?2 LIMIT 1").bind(tag, q).first().catch(function () { return null; });
    if (seen) { out.skipped++; continue; }
    await env.QNFO_AUDIT.prepare("INSERT INTO idea_proposals (name, idea, contact, status, ip_hash, created_at) VALUES ('ask-gap', ?1, '', 'new', ?2, datetime('now'))").bind(q, tag).run();
    out.inserted++;
  }
  return out;
}
// REENTRY-EVENT-1 (1.14.3, agent_issues 1000244): scheduled() discards what ideationCycle returns, so the re-entry leg's own result was
// visible only in Workers Logs, and the bind-limit throw of 1.14.1 and before ran for 7 days seen by nothing but the chaos drill. The latest
// result of the leg is now one cloud_ops_events row, INSERT OR REPLACE on id 'idea-reentry' (the pattern of 'idea-triage-budget', no growth
// per cycle), status 'error' when the leg threw (rr.error) or its emission block failed (rr.emit_error), else 'ok'. It never throws.
async function recordReentryEvent(env, rr) {
  try {
    rr = rr || {};
    var bad = !!(rr.error || rr.emit_error);
    var meta = { version: VERSION, permitted: rr.permitted, scanned: rr.scanned, emitted: rr.emitted, emit_error: rr.emit_error || null, error: rr.error || null, owner_dois: rr.owner_dois, owner_dois_capped: rr.owner_dois_capped || null, scan_capped: !!rr.scan_capped, errors: rr.errors, rescored: rr.rescored, expired: rr.expired, expired_noq: rr.expired_noq, expired_stale: rr.expired_stale };
    var text = "idea re-entry: " + (bad ? "FAILED (" + String(rr.error || rr.emit_error).slice(0, 160) + "); " : "") + (rr.scanned === undefined ? "no scan" : rr.scanned + " scanned, " + rr.emitted + " emitted");
    await env.QNFO_AUDIT.prepare("INSERT OR REPLACE INTO cloud_ops_events (id, ts, kind, text, meta, job, status) VALUES ('idea-reentry', ?1, 'idea-reentry', ?2, ?3, 'idea-hub', ?4)")
      .bind(new Date().toISOString(), text, JSON.stringify(meta), bad ? "error" : "ok").run();
  } catch (e) { console.error(JSON.stringify({ worker: "idea-hub", where: "recordReentryEvent", error: String(e && e.message || e).slice(0, 300) })); }
}
async function ideationCycle(env) {
  // CRON-BUDGET-1 (2026-10-17): the hourly cycle ended exceededWallTime on 2 of 3 recent runs. Give the
  // cycle an explicit 240s wall budget and skip the later stages when the earlier ones consumed it, so the
  // run finishes instead of being killed mid-write.
  var t0 = Date.now(), BUDGET_MS = 240000;
  // CRON-WALL-DEADLINE-1 (agent_issues 2904): a hard wall deadline 60 s under the 15-minute cron wall limit. The soft
  // BUDGET_MS skips later stages when the earlier ones consumed it, but a single stage (triage or owner-corpus) can still run
  // its whole batch past the wall limit; the deadline is passed into those loops so they stop between rows instead of being
  // killed mid-write (exceededWallTime, which leaves a row half-updated).
  var WALL_DEADLINE = t0 + (15 * 60000 - 60000);
  var left = function () { return BUDGET_MS - (Date.now() - t0); };
  var r = { budget_ms: BUDGET_MS };
  try { r.reentry = await runReentry(env); } catch (e) { r.reentry = { error: String(e && e.message || e) }; console.error(JSON.stringify({ worker: "idea-hub", where: "ideationCycle.reentry", error: r.reentry.error })); }
  await recordReentryEvent(env, r.reentry); // REENTRY-EVENT-1: the leg's result outlives the cycle, success or failure
  // IDEA-TRIAGE-PRIORITY-1: drain before filling; a slow producer must not spend triage's budget and leave the intake stuck.
  r.triage = await triageProposals(env, WALL_DEADLINE);
  if (left() > 30000) { try { r.consume = await runConsume(env); } catch (e) { r.consume = { error: String(e && e.message || e) }; } } else r.consume = { skipped: "budget" };
  if (left() > 30000) { try { r.askgap = await runAskGap(env); } catch (e) { r.askgap = { error: String(e && e.message || e) }; } } else r.askgap = { skipped: "budget" };
  if (left() > 60000) { try { r.corpus = await runOwnerCorpus(env, WALL_DEADLINE); } catch (e) { r.corpus = { error: String(e && e.message || e) }; } } else r.corpus = { skipped: "budget" };
  if (left() > 60000 && new Date().getUTCHours() % THINK_EVERY_H === 0) { try { r.think = await thinkLoop(env); } catch (e) { r.think = { error: String(e && e.message || e) }; } }
  return r;
}
// ---- IDEAS-QDS-1 (2026-10-02, pillar reach): ideas.qnfo.org as a readable page on the QNFO design system ----
// The public page was a bare <h1> with an RSS link, and every RSS item pointed at /#/s/<id>, a client route nothing
// served. "/" now lists the public threads server-side and /s/<id> renders one thread. Both read through exactly the
// same gates as /api/sessions and /api/session/<id> (publicTitle, blocked, per-message INTERNAL/OPS/JUNK), so nothing
// becomes visible that the API did not already publish. Pages are cached 5 minutes (all() runs one D1 query per thread).
function ideaText(s, max) {
  return stripInj(s)
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[redacted]").replace(/\b[A-Za-z0-9_-]{24,}\b/g, "[redacted]")
    .replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max || 200000);
}
// Some rows were stored with every newline collapsed to a space. Put back the block breaks markdown needs (headings,
// table rows, bold-led list items, fences) so those answers read as sections instead of one paragraph.
function ideaReflow(s) {
  if (s.indexOf("\n") >= 0 || s.length < 300) return s;
  s = s.replace(/ (#{1,6}) (?=\S)/g, "\n\n$1 ").replace(/\| \|/g, "|\n|").replace(/ (```)/g, "\n$1")
    .replace(/ - (?=\*\*)/g, "\n- ").replace(/([.:)]) (\d{1,2}\. )(?=\*\*|[A-Z])/g, "$1\n$2");
  // A collapsed heading runs into its first sentence; end it before the first "Word word" pair after its first word.
  return s.split("\n").map(function(l) {
    const m = /^(#{1,6} )(.*)$/.exec(l);
    if (!m) return l;
    const w = m[2].split(" ");
    for (let k = 1; k < Math.min(w.length - 1, 16); k++) {
      if (!/[A-Za-z]{2}/.test(w.slice(0, k).join(" "))) continue;
      const starter = /^(The|This|These|That|A|An|It|Its|Your|Before|After|We|There|Here|Each|Every|Most|What|When|Yes|No|In|For|To|Let|Suppose|Consider|Define|Take|Given|If|Assume|Write|Our|One|Two|Three)$/.test(w[k]);
      if (/^[A-Z][a-z]+[,;:]?$/.test(w[k]) && (starter || (/^[a-z(]/.test(w[k + 1]) && !/^(and|or|of|the|in|on|for|to|vs\.?|with|as)$/.test(w[k + 1]))) && !/^(and|or|of|the|a|an|in|on|to|for|vs\.?)$/i.test(w[k - 1])) {
        return m[1] + w.slice(0, k).join(" ") + "\n\n" + w.slice(k).join(" ");
      }
    }
    return m[2].length > 100 ? m[2] : l;
  }).join("\n").replace(/([^|\n]) (\| [^\n]*\|)\n(\|[-:| ]+\|)/g, "$1\n$2\n$3");
}
function ideaShort(t, n) { t = String(t || ""); if (t.length <= n) return t; const cut = t.slice(0, n); const sp = cut.lastIndexOf(" "); return (sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.\-]+$/, "") + "\u2026"; }
function ideaTitle(t) { return String(t || "").replace(/^#+\s*/, "").replace(/^\d+\.\s+/, "").replace(/\*\*/g, ""); }
function ideaInline(s) {
  return s.replace(/`([^`\n]+)`/g, "<code>$1</code>").replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" rel="nofollow noopener">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" rel="nofollow noopener">$2</a>');
}
// Small, safe markdown: escape first, then fences, headings, lists, quotes, tables as preformatted text, paragraphs.
function ideaMd(src) {
  const lines = esc(ideaReflow(String(src || ""))).split("\n");
  const out = [];
  let para = [], list = null, fence = null;
  const flush = function() {
    if (para.length) { out.push("<p>" + ideaInline(para.join(" ")) + "</p>"); para = []; }
    if (list) { out.push("<" + list.t + ">" + list.items.map(function(i) { return "<li>" + ideaInline(i) + "</li>"; }).join("") + "</" + list.t + ">"); list = null; }
  };
  for (const raw of lines) {
    const l = raw.replace(/\s+$/, "");
    if (fence !== null) { if (/^```/.test(l)) { out.push("<pre><code>" + fence.join("\n") + "</code></pre>"); fence = null; } else fence.push(raw); continue; }
    if (/^```/.test(l)) { flush(); fence = []; continue; }
    let m;
    if (!l.trim()) { flush(); continue; }
    if ((m = /^(#{1,6})\s+(.*)$/.exec(l))) { flush(); const n = Math.min(4, Math.max(2, m[1].length + 1)); out.push("<h" + n + ">" + ideaInline(m[2]) + "</h" + n + ">"); continue; }
    if (/^(-{3,}|\*{3,})$/.test(l.trim())) { flush(); out.push("<hr>"); continue; }
    if ((m = /^\s*(?:[-*\u2022])\s+(.*)$/.exec(l))) { if (para.length) flush(); if (!list || list.t !== "ul") { flush(); list = { t: "ul", items: [] }; } list.items.push(m[1]); continue; }
    if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(l))) { if (para.length) flush(); if (!list || list.t !== "ol") { flush(); list = { t: "ol", items: [] }; } list.items.push(m[1]); continue; }
    if ((m = /^&gt;\s?(.*)$/.exec(l))) { flush(); out.push("<blockquote><p>" + ideaInline(m[1]) + "</p></blockquote>"); continue; }
    if (/^\|.*\|$/.test(l.trim())) { flush(); out.push('<pre class="idea-table">' + l + "</pre>"); continue; }
    if (list) { list.items[list.items.length - 1] += " " + l.trim(); continue; }
    para.push(l.trim());
  }
  if (fence !== null) out.push("<pre><code>" + fence.join("\n") + "</code></pre>");
  flush();
  return out.join("\n").replace(/<\/pre>\n<pre class="idea-table">/g, "\n").replace(/<pre class="idea-table">([\s\S]*?)<\/pre>/g, function(_, body) {
    const rows = body.split("\n").filter(function(r) { return !/^\|[-:| ]+\|$/.test(r.trim()); }).map(function(r) { return r.trim().replace(/^\||\|$/g, "").split("|").map(function(c) { return ideaInline(c.trim()); }); });
    if (!rows.length) return "";
    return '<div class="q-table-wrap"><table class="q-table"><thead><tr>' + rows[0].map(function(c) { return "<th>" + c + "</th>"; }).join("") + "</tr></thead><tbody>" +
      rows.slice(1).map(function(r) { return "<tr>" + r.map(function(c) { return "<td>" + c + "</td>"; }).join("") + "</tr>"; }).join("") + "</tbody></table></div>";
  });
}
// The ideation scorer stores its verdict as JSON; show it as a scorecard instead of raw JSON.
function ideaScorecard(content) {
  const t = String(content || "").trim();
  if (t.charAt(0) !== "{") return null;
  let j;
  try { j = JSON.parse(t); } catch (e) { return null; }
  if (!j || typeof j !== "object" || !("technical_merit" in j)) return null;
  const rows = [["Technical merit", j.technical_merit], ["Impact potential", j.impact_potential], ["Novelty", j.novelty], ["Feasibility", j.feasibility]]
    .filter(function(r) { return typeof r[1] === "number"; });
  return '<div class="q-panel idea-score"><p class="q-eyebrow">Automated triage score</p>' + (j.question ? '<p class="idea-score-q">' + ideaInline(esc(j.question)) + "</p>" : "") +
    '<dl class="idea-bars">' + rows.map(function(r) {
      const v = Math.max(0, Math.min(100, Math.round(r[1])));
      return "<div><dt>" + r[0] + '</dt><dd><span class="idea-bar"><i style="width:' + v + '%"></i></span><b class="q-num">' + v + "</b></dd></div>";
    }).join("") + "</dl>" + '<p class="q-meta">Scored 0 to 100 by two models when the question was proposed. A score ranks questions for the research queue; it is not a finding.</p></div>';
}
var IDEA_CSS = '<style>.idea-list{list-style:none;margin:0;padding:0}.idea-list li{padding:20px 0;border-bottom:1px solid var(--q-rule)}.idea-list li[hidden]{display:none}.idea-t{font:500 1.22rem/1.35 var(--q-serif);text-decoration:none;color:var(--q-ink);display:block;max-width:70ch}.idea-t:hover{color:var(--q-accent)}.idea-m{display:flex;gap:14px;flex-wrap:wrap;margin-top:8px;font-size:var(--q-fs-sm);color:var(--q-muted)}.idea-filter{max-width:560px;margin:8px 0 6px}.idea-q{font:500 clamp(1.5rem,2.6vw,2.1rem)/1.25 var(--q-serif);letter-spacing:-.01em;margin:0 0 14px;max-width:34ch;overflow-wrap:anywhere}.idea-q-full{font:400 var(--q-fs-read)/1.6 var(--q-serif);color:var(--q-muted);margin:0 0 24px;max-width:var(--q-measure)}.idea-turn{margin:36px 0 0}.idea-role{font:600 var(--q-fs-sm)/1 var(--q-sans);color:var(--q-accent);margin:0 0 12px;display:flex;gap:10px;align-items:center}.idea-score{margin:24px 0;max-width:640px}.idea-score-q{font:500 1.1rem/1.45 var(--q-serif);margin:6px 0 16px}.idea-bars{display:grid;gap:10px;margin:0 0 14px}.idea-bars div{display:grid;grid-template-columns:150px 1fr;gap:12px;align-items:center}.idea-bars dt{font-size:var(--q-fs-sm);color:var(--q-muted)}.idea-bars dd{margin:0;display:flex;gap:10px;align-items:center}.idea-bar{flex:1;height:8px;border-radius:99px;background:var(--q-rule);overflow:hidden}.idea-bar i{display:block;height:100%;background:var(--q-accent)}.idea-table{font:400 .8rem/1.5 var(--q-mono)}@media (max-width:560px){.idea-bars div{grid-template-columns:1fr}}</style>';
function ideaPage(o, body, status) {
  const html = qdsPage({ title: o.title, description: o.description, canonical: o.canonical, brand: "qnfo", active: "ideas", jsonld: o.jsonld, math: !!o.math, robots: o.robots, extra: IDEA_CSS + (o.head || "") }, body);
  return new Response(html, { status: status || 200, headers: { ...cors(), "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}
function ideaDate(s) { const d = new Date(s || 0); return Number.isNaN(d.getTime()) || !s ? "" : d.toISOString().slice(0, 10); }
function ideaLd(o) {
  return '<script type="application/ld+json">' + JSON.stringify(Object.assign({ "@context": "https://schema.org", author: { "@type": "Person", name: "Rowan Brad Quni-Gudzinas", sameAs: ["https://orcid.org/" + QDS_OWNER_ORCID] }, publisher: { "@type": "Organization", name: "QNFO", url: "https://qnfo.org/" } }, o)).replace(/</g, "\\u003c") + "<\/script>";
}
// REACH-IDEA-1 (1.11.0, agent_issues 2480): the subscribe box is shared by the home page and every /s/ thread page, so the
// share pages people land on from social posts (13 RUM views in 14 days on one of them) carry the same double opt-in form.
function ideaSubBox() {
  return '<section class="q-panel" id="subscribe" aria-labelledby="ideas-sub-h" style="margin-top:40px"><h2 class="q-h3" id="ideas-sub-h" style="margin:0 0 4px">Follow new work</h2><p class="q-meta" style="margin:0 0 12px">New threads by <a href="/rss.xml">RSS</a>. New papers by email: one short weekly digest, confirm by the link we send, unsubscribe any time.</p>' +
    '<form id="ideas-sub-form" novalidate style="display:flex;gap:8px;flex-wrap:wrap"><label class="q-sr" for="ideas-sub-email">Email address</label><input class="q-input" id="ideas-sub-email" type="email" name="email" placeholder="you@example.com" autocomplete="email" required style="flex:1 1 220px;min-width:0"><input class="q-sr" type="text" id="ideas-sub-hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true"><button class="q-btn q-btn-accent" type="submit" id="ideas-sub-btn">Subscribe</button>' + turnstileWidget(null, "ideas_subscribe") + '</form>' + TURNSTILE_SCRIPT + '<p class="q-meta" id="ideas-sub-msg" role="status" aria-live="polite" style="min-height:1.4em;margin:8px 0 0"></p></section>';
}
var IDEA_SUB_JS = "<script>(function(){var f=document.getElementById('ideas-sub-form');if(!f)return;var m=document.getElementById('ideas-sub-msg'),b=document.getElementById('ideas-sub-btn');f.addEventListener('submit',function(e){e.preventDefault();var em=(document.getElementById('ideas-sub-email').value||'').trim(),hp=(document.getElementById('ideas-sub-hp')||{}).value||'';if(!em||em.indexOf('@')<1){m.textContent='Enter a valid email address.';return}b.disabled=true;m.textContent='Subscribing...';fetch('/api/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:em,hp:hp,cf_turnstile:((f.querySelector('[name=cf-turnstile-response]')||{}).value||'')})}).then(function(r){return r.json().catch(function(){return {}})}).then(function(j){if(j&&j.ok){m.textContent='Check your inbox to confirm the subscription.';f.reset()}else{m.textContent=(j&&j.error)||'The subscription did not go through. Try again.'}}).catch(function(){m.textContent='Network error. Try again.'}).then(function(){b.disabled=false;try{if(window.turnstile)turnstile.reset()}catch(x){}})})})();<\/script>";
function ideaSubFooter() {
  return '<div class="q-wrap" style="padding-bottom:64px">' + ideaSubBox() + "</div>" + IDEA_SUB_JS;
}
async function ideasHome(env) {
  let items = [];
  try { items = await all(env); } catch (e) { items = []; }
  // 2026-08-31 owner mandate (qnfo-web-unified/README.md): only threads asked through the QNFO AI endpoint (the chat
  // table), not the chat_sessions archive, and only the latest 20.
  // IDEAS-QUESTIONS-SOURCE-1: include the fleet's own open questions and triaged proposals
  // (source 'ideation'), not only the chat threads asked through the endpoint.
  const list = items.filter(function(x) { return x.source === "live" || x.source === "ideation"; }).slice(0, 20);
  const newest = list.length ? ideaDate(list[0].updated_at) : "";
  const rows = list.map(function(x) {
    const t = ideaShort(ideaTitle(x.title), 200);
    return '<li data-t="' + esc(t.toLowerCase()) + '"><a class="idea-t" href="/s/' + encodeURIComponent(x.id) + '">' + esc(t) + '</a><div class="idea-m"><time datetime="' + esc(x.updated_at || "") + '">' + ideaDate(x.updated_at) + "</time>" +
      (x.message_count ? "<span>" + x.message_count + (x.message_count === 1 ? " message" : " messages") + "</span>" : "") + "</div></li>";
  }).join("");
  const body = '<section class="q-hero" style="padding-bottom:16px"><div class="q-wrap"><p class="q-eyebrow">Ideas</p><h1 class="q-display" style="max-width:18ch">Research questions as they develop</h1>' +
    '<p class="q-lede">Questions put to the QNFO research assistant and the answers it wrote from the corpus, published as they happen. Personal, operational and quarantined conversations never appear here. When a question holds up, it becomes a paper; <a href="https://papers.qnfo.org/papers">the papers</a> are the record. <a href="/stream">Watch new items arrive on the live stream.</a></p></div></section>' +
    '<section class="q-section" style="padding-top:8px" aria-labelledby="ideas-h"><div class="q-wrap"><div class="q-section-head"><h2 class="q-h2" id="ideas-h">' + (list.length === 20 ? "The latest 20" : list.length + " public items") + "</h2>" + (newest ? '<span class="q-meta">Newest ' + newest + "</span>" : "") + "</div>" +
    (list.length ? '<label class="q-field idea-filter"><span class="q-sr">Filter threads</span><input id="idea-f" type="search" placeholder="Filter by words in the question" autocomplete="off"></label><p class="q-meta" id="idea-n" aria-live="polite"></p><ul class="idea-list" id="idea-l">' + rows + "</ul>"
      : '<div class="q-note">No public threads right now. New questions appear here within five minutes of being asked; <a href="https://ask.qwav.tech/">ask the corpus</a> or read <a href="https://papers.qnfo.org/papers">the papers</a> meanwhile.</div>') +
    // REACH-IDEA-1 (1.5.7, agent_issues 2001): an inline subscribe box (email input) posting to /api/subscribe, which forwards to
    // the qnfo-subscribers double opt-in with source ideas.qnfo.org; the honeypot field is the same one qnfo.org uses.
    ideaSubBox() +
    "</div></section>";
  const subJs = IDEA_SUB_JS;
  const js = subJs + '<script>(function(){if(/^#\\/s\\//.test(location.hash)){location.replace("/s/"+location.hash.slice(4));return}var f=document.getElementById("idea-f"),l=document.getElementById("idea-l"),n=document.getElementById("idea-n");if(!f||!l)return;f.addEventListener("input",function(){var q=f.value.trim().toLowerCase(),k=0;l.querySelectorAll("li").forEach(function(li){var h=!q||li.getAttribute("data-t").indexOf(q)>=0;li.hidden=!h;if(h)k++});n.textContent=q?k+" of "+l.children.length+" threads":""})})()<\/script>';
  return ideaPage({ title: "Ideas \u00b7 research questions as they develop \u00b7 QNFO", description: "Public research conversations from the QNFO research assistant: questions, answers written from the paper corpus, and automated triage scores.", canonical: BASE + "/", math: /\$|\\\(|\\\[/.test(rows),
    jsonld: ideaLd({ "@type": "CollectionPage", name: "QNFO Ideas", url: BASE + "/", description: "Public research conversations from the QNFO research assistant." }), head: "" }, body + js);
}
// ---- IDEA-STREAM-1:BEGIN (roadmap_implementation row 113 RM-IDEA-STREAM-UI-1, 2026-11-05, pillar reach)
// A public read-only stream of the ideas as they reach the public list. The page is static (cached like the other pages) and reads the
// existing public feed, /api/feed, which already applies every public gate, so the stream can show nothing the home page, the RSS feed
// or the session API do not already show. While the page is open and visible it asks for the feed every 30 seconds (the feed answer is
// edge cached for FEED_FRESH_MS, so the polling costs the origin no extra D1 read), lists newest first, marks items that arrived after the
// page opened, and backs off when the feed cannot be reached. Titles are written with textContent only.
var IDEA_STREAM_CSS = '<style>.st-live{display:inline-flex;gap:8px;align-items:center}.st-dot{width:9px;height:9px;border-radius:50%;background:var(--q-muted)}.st-on .st-dot{background:var(--q-accent)}@media (prefers-reduced-motion:no-preference){.st-on .st-dot{animation:stp 2s ease-in-out infinite}}@keyframes stp{50%{opacity:.35}}.st-kind{font-weight:600}.st-new{color:var(--q-accent);font-weight:600}</style>';
var IDEA_STREAM_JS = String.raw`<script>
(function(){
var POLL=30000,MAXPOLL=300000,KEEP=60,KIND={question:"Question",proposal:"Proposal",thread:"Thread"};
function rel(iso,now){var t=Date.parse(iso);if(!(t>0))return"";var s=Math.max(0,Math.round(((now||Date.now())-t)/1000));if(s<45)return"just now";if(s<3600)return Math.round(s/60)+" min ago";if(s<86400)return Math.round(s/3600)+" h ago";return new Date(t).toISOString().slice(0,10)}
function merge(seen,incoming,first){var by={},fresh=[],i;for(i=0;i<seen.length;i++)by[seen[i].id]=seen[i];for(i=0;i<incoming.length;i++){var x=incoming[i];if(!x||!x.id)continue;if(!by[x.id]&&!first)fresh.push(x.id);by[x.id]=x}var items=Object.keys(by).map(function(k){return by[k]});items.sort(function(a,b){return Date.parse(b.updated_at||0)-Date.parse(a.updated_at||0)});return{items:items.slice(0,KEEP),fresh:fresh}}
var api={rel:rel,merge:merge};
if(typeof document==="undefined"){this.__ideaStream=api;return}
var $=function(i){return document.getElementById(i)},list=$("st-l"),live=$("st-live"),note=$("st-n"),filt=$("st-f");
if(!list)return;
var seen=[],fresh={},first=true,delay=POLL,timer=null,err=0;
function el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e}
function render(){
  var q=filt.value.trim().toLowerCase(),now=Date.now(),shown=0;
  while(list.firstChild)list.removeChild(list.firstChild);
  seen.forEach(function(x){
    var title=String(x.title||"").replace(/\s+/g," ").trim();if(title.length>200)title=title.slice(0,199)+String.fromCharCode(8230);
    if(q&&title.toLowerCase().indexOf(q)<0)return;shown++;
    var li=el("li"),a=el("a","idea-t",title);a.href="/s/"+encodeURIComponent(x.id);li.appendChild(a);
    var m=el("div","idea-m");m.appendChild(el("span","st-kind",KIND[x.kind]||"Thread"));
    var tm=el("time",null,rel(x.updated_at,now));tm.setAttribute("datetime",x.updated_at||"");tm.title=x.updated_at||"";m.appendChild(tm);
    if(x.message_count)m.appendChild(el("span",null,x.message_count+(x.message_count===1?" message":" messages")));
    if(fresh[x.id])m.appendChild(el("span","st-new","New"));
    li.appendChild(m);list.appendChild(li)
  });
  note.textContent=q?shown+" of "+seen.length+" items match":seen.length+" items, newest first"
}
function state(on,text){live.className="q-meta st-live"+(on?" st-on":"");while(live.firstChild)live.removeChild(live.firstChild);live.appendChild(el("span","st-dot"));live.appendChild(el("span",null,text))}
function tick(){
  if(document.hidden){timer=setTimeout(tick,POLL);return}
  fetch("/api/feed?limit=40",{cache:"no-cache"}).then(function(r){if(!r.ok)throw new Error("http "+r.status);return r.json()}).then(function(d){
    var r=merge(seen,(d&&d.sessions)||[],first);seen=r.items;r.fresh.forEach(function(id){fresh[id]=1});first=false;err=0;delay=POLL;
    state(true,"Live "+String.fromCharCode(183)+" checked "+new Date().toISOString().slice(11,19)+" UTC");render()
  }).catch(function(){err++;delay=Math.min(MAXPOLL,POLL*Math.pow(2,err));state(false,"Offline "+String.fromCharCode(183)+" trying again in "+Math.round(delay/1000)+" s")}).then(function(){timer=setTimeout(tick,delay)})
}
filt.addEventListener("input",render);
document.addEventListener("visibilitychange",function(){if(!document.hidden){clearTimeout(timer);tick()}});
setInterval(function(){if(seen.length&&!document.hidden)render()},60000);
tick()
})();
</script>`;
async function ideasStream() {
  const body = '<section class="q-hero" style="padding-bottom:16px"><div class="q-wrap"><p class="q-eyebrow">Ideas &middot; live</p><h1 class="q-display" style="max-width:18ch">The idea stream</h1>' +
    '<p class="q-lede">Questions and proposals as they reach the public list, newest first. While this page is open it checks for new items every 30 seconds. Personal, operational and withdrawn conversations never appear. <a href="/">The latest 20</a> and <a href="/rss.xml">the RSS feed</a> show the same list.</p></div></section>' +
    '<section class="q-section" style="padding-top:8px" aria-labelledby="st-h" id="idea-stream" data-page="idea-stream"><div class="q-wrap"><div class="q-section-head"><h2 class="q-h2" id="st-h">Newest first</h2><span class="q-meta st-live" id="st-live" role="status" aria-live="polite"><span class="st-dot"></span><span>Connecting&hellip;</span></span></div>' +
    '<label class="q-field idea-filter"><span class="q-sr">Filter the stream</span><input id="st-f" type="search" placeholder="Filter by words in the question" autocomplete="off"></label><p class="q-meta" id="st-n" aria-live="polite"></p><ul class="idea-list" id="st-l"></ul>' +
    '<noscript><div class="q-note">The live stream needs JavaScript. The same items are on <a href="/">the home page</a> and in <a href="/rss.xml">the RSS feed</a>.</div></noscript></div></section>';
  return ideaPage({ title: "The idea stream " + String.fromCharCode(183) + " QNFO Ideas", description: "New public research questions and proposals from the QNFO research assistant, as they arrive, newest first.", canonical: BASE + "/stream",
    jsonld: ideaLd({ "@type": "CollectionPage", name: "QNFO idea stream", url: BASE + "/stream", description: "New public research questions and proposals, newest first." }), head: IDEA_STREAM_CSS }, body + IDEA_STREAM_JS);
}
// ---- IDEA-STREAM-1:END
// IDEAS-QUESTIONS-SOURCE-1: render a fleet question / idea proposal (id q-N or p-N) on its own page.
async function ideasQuestion(env, kind, num) {
  let row = null, q = "", status = "", created = null;
  try {
    if (kind === "q") { const r = (await env.QNFO_AUDIT.prepare("SELECT question AS q, ts, status FROM self_questions WHERE id=?").bind(num).all()).results || []; row = r[0]; if (row) { q = row.q; created = ts(row.ts); status = row.status || ""; } }
    else { const r = (await env.QNFO_AUDIT.prepare("SELECT idea AS q, created_at, status FROM idea_proposals WHERE id=?").bind(num).all()).results || []; row = r[0]; if (row) { q = row.q; created = ts(row.created_at); status = row.status || ""; } }
  } catch (e) { row = null; }
  if (!row || !pubQuestion(q)) {
    return ideaPage({ title: "Question not found \u00b7 QNFO Ideas", description: "This question is not public.", robots: "noindex" },
      '<section class="q-hero"><div class="q-wrap"><p class="q-eyebrow">Ideas</p><h1 class="q-h1">This question is not public</h1><p class="q-lede"><a href="/">See every public question</a>.</p></div></section>', 404);
  }
  const title = ideaShort(ideaTitle(clean(q, 300)), 160);
  const kindLabel = kind === "q" ? "Open research question" : (status === "triaged_accepted" ? "Queued research question" : "Proposed research question");
  const body = '<div class="q-wrap" style="padding-top:36px;padding-bottom:64px"><p class="q-eyebrow"><a href="/" style="text-decoration:none;color:inherit">\u2190 All questions</a></p>' +
    '<h1 class="idea-q">' + esc(title) + "</h1>" +
    '<p class="q-meta">' + kindLabel + (created ? " \u00b7 " + ideaDate(created) : "") + ' \u00b7 generated autonomously by the QNFO research pipeline</p>' +
    '<p class="q-note" style="margin-top:24px">This is a question the QNFO pipeline is developing. Answers become <a href="https://papers.qnfo.org/papers">papers</a> when they hold up. <a href="https://ask.qwav.tech/?q=' + encodeURIComponent(title.slice(0, 300)) + '">Ask it against the current corpus</a>.</p></div>';
  return ideaPage({ title: title.slice(0, 90) + " \u00b7 QNFO Ideas", description: ideaTitle(clean(q, 300)), canonical: BASE + "/s/" + (kind === "q" ? "q-" : "p-") + num, math: /\$|\\\(|\\\[/.test(q),
    jsonld: ideaLd({ "@type": "Question", name: title.slice(0, 110), url: BASE + "/s/" + (kind === "q" ? "q-" : "p-") + num }) }, body + ideaSubFooter());
}
async function ideasThread(env, rawId) {
  let id = "";
  try { id = decodeURIComponent(rawId); } catch (e) { id = rawId; }
  if (/^q-\d+$/.test(id)) return ideasQuestion(env, "q", id.slice(2));
  if (/^p-\d+$/.test(id)) return ideasQuestion(env, "p", id.slice(2));
  let rows = [];
  try { rows = (await env.QNFO_AUDIT.prepare("SELECT ts,role,content,model FROM chat WHERE thread=? ORDER BY ts ASC,id ASC LIMIT 500").bind(id).all()).results || []; } catch (e) { rows = []; }
  const first = rows.find(function(r) { return r.role === "user"; });
  if (!first || !publicTitle(first.content) || await blocked(env, id)) {
    return ideaPage({ title: "Thread not found \u00b7 QNFO Ideas", description: "This thread is not public.", robots: "noindex" },
      '<section class="q-hero"><div class="q-wrap"><p class="q-eyebrow">Ideas</p><h1 class="q-h1">This thread is not public</h1><p class="q-lede">It may have been removed, or it never passed the public filter. <a href="/">See every public thread</a>.</p></div></section>', 404);
  }
  const shown = rows.filter(function(r) { return r.role !== "system" && r !== first && !has(r.content, INTERNAL) && !has(r.content, OPS) && !has(r.content, JUNK); });
  const q = ideaText(first.content, 20000);
  const qTitle = ideaShort(ideaTitle(clean(first.content, 2000)), 160);
  const long = q.length > 260;
  const turns = shown.map(function(r) {
    const card = r.role === "assistant" ? ideaScorecard(r.content) : null;
    if (card) return card;
    const who = r.role === "user" ? "Follow-up" : "Research assistant";
    return '<div class="idea-turn"><p class="idea-role">' + who + (r.ts ? ' <span class="q-meta" style="font-weight:400">' + ideaDate(ts(r.ts)) + "</span>" : "") + '</p><div class="q-prose">' + ideaMd(ideaText(r.content)) + "</div></div>";
  }).join("");
  const updated = ts(rows[rows.length - 1].ts), created = ts(first.ts);
  const body = '<div class="q-wrap" style="padding-top:36px;padding-bottom:64px"><p class="q-eyebrow"><a href="/" style="text-decoration:none;color:inherit">\u2190 All threads</a></p>' +
    '<h1 class="idea-q">' + esc(long ? qTitle : ideaTitle(q)) + "</h1>" + (long ? '<div class="idea-q-full q-prose">' + ideaMd(q) + "</div>" : "") +
    '<p class="q-meta">Asked ' + ideaDate(created) + (updated && updated !== created ? " \u00b7 updated " + ideaDate(updated) : "") + ' \u00b7 <a href="https://ask.qwav.tech/?q=' + encodeURIComponent(qTitle.slice(0, 300)) + '">Ask it again against the current corpus</a></p>' +
    (turns || '<div class="q-note" style="margin-top:24px">No public answer yet.</div>') +
    '<p class="q-note" style="margin-top:40px">Answers here were written by an AI research assistant over the QNFO corpus and have not been reviewed. Cite <a href="https://papers.qnfo.org/papers">the papers</a>, not this thread.</p></div>';
  return ideaPage({ title: qTitle.slice(0, 90) + " \u00b7 QNFO Ideas", description: ideaTitle(clean(first.content, 300)), canonical: BASE + "/s/" + encodeURIComponent(id), math: /\$|\\\(|\\\[/.test(q + turns),
    jsonld: ideaLd({ "@type": "DiscussionForumPosting", headline: qTitle.slice(0, 110), url: BASE + "/s/" + encodeURIComponent(id), datePublished: created, dateModified: updated }) }, body + ideaSubFooter());
}
async function ideasCached(req, ctx, make, opt) {
  const o = opt || {};
  // IDEAS-SWR-1 (1.5.4): a cached copy is served at once; older than IDEAS_FRESH_MS it is rebuilt in the background, so a
  // visitor never waits on the ~12 s uncached build. The internal build stamp is not sent to visitors.
  // HUB-CACHE-VERSION-2 (1.9.0, agent_issues 2484, failure mode edge-copy-version-skew; qnfo-gateway HUB-CACHE-VERSION-1 is
  // the same fix for qnfo.org): the stored copy carries X-Ideas-Version = VERSION. A copy built by another version (or
  // stored before this stamp) is rebuilt while the request waits up to IDEAS_VERSION_WAIT_MS; a 200 build in time is served,
  // otherwise the old copy is served marked X-Ideas-Cache: stale-version and the build finishes through ctx.waitUntil. So no
  // colo serves a previous version's render past one slow build after a deploy. Neither stamp is sent to visitors.
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const key = new Request(new URL(req.url).origin + new URL(req.url).pathname + "?__swr=1" + (o.variant || ""), { method: "GET" });
  const store = async function() {
    const res = await make();
    if (!cache || res.status !== 200) return res;
    const body = await res.text();
    const hd = new Headers(res.headers);
    hd.set("X-Ideas-Built", String(Date.now()));
    hd.set("X-Ideas-Version", VERSION);
    hd.set("Cache-Control", "public, max-age=604800");
    try { await cache.put(key, new Response(body, { status: 200, headers: hd })); } catch (e) { console.log("ideasCached: cache.put failed: " + (e && e.message || e)); }
    return new Response(body, { status: 200, headers: res.headers });
  };
  const logFail = function(e) { console.log("ideasCached: rebuild failed: " + (e && e.message || e)); return null; };
  const served = function(r, mark) {
    const hd = new Headers(r.headers);
    hd.delete("X-Ideas-Built");
    hd.delete("X-Ideas-Version");
    hd.set("Cache-Control", "public, max-age=" + (o.maxAge || 14400));
    if (mark) hd.set("X-Ideas-Cache", mark);
    return new Response(r.body, { status: 200, headers: hd });
  };
  let hit = null;
  if (cache) { try { hit = await cache.match(key); } catch (e) { console.log("ideasCached: cache.match failed: " + (e && e.message || e)); hit = null; } }
  if (!hit) return store();
  if (hit.headers.get("X-Ideas-Version") !== VERSION) {
    const build = store().catch(logFail);
    let timer = null;
    const timeout = new Promise(function(resolve) { timer = setTimeout(function() { resolve(null); }, IDEAS_VERSION_WAIT_MS); });
    const fresh = await Promise.race([build, timeout]);
    if (timer !== null) clearTimeout(timer);
    if (fresh && fresh.status === 200) return fresh;
    if (!fresh && ctx && ctx.waitUntil) ctx.waitUntil(build);
    return served(hit, "stale-version");
  }
  const age = Date.now() - Number(hit.headers.get("X-Ideas-Built") || 0);
  if (age > (o.freshMs || IDEAS_FRESH_MS) && ctx && ctx.waitUntil) ctx.waitUntil(store().catch(logFail));
  return served(hit, null);
}
var IDEAS_VERSION_WAIT_MS = 2500;
var IDEAS_FRESH_MS = 15 * 60 * 1000;
// IDEAS-HUB-SLOW-RSS-1 (1.14.5): the feed and the sessions list are built from 500 threads and 500 archive sessions with one gate query per thread (3 to 5 s); a stored copy is served at once and rebuilt in the background after 2 minutes (a quarantined or errata thread is withheld from the stored copy within about 3 minutes, was 1).
var FEED_FRESH_MS = 2 * 60 * 1000;
// ---- IDEAS-QDS-1:END ----


// IDEAS-PUBLIC-1 (2026-10-04): reverts IDEAS-PRIVATE-1. QNFO Ideas is a PUBLIC read-only surface --
// /, /index.html, /s/*, /api/sessions, /api/feed, /api/session/*, /rss.xml load with NO credential. The
// public filter below (publicTitle boundary match + quarantine + INTERNAL/OPS/JUNK stripping) is the ONLY
// gate, unchanged from v1.4.0-qds. POST /api/intake stays owner-authenticated (write path, not a public read).
// OWNER-TOKEN-SHADOW-1 (#1966): the intake accepts either worker secret, OWNER_TOKEN (set 2026-10-04T09:16Z for
// IDEAS-PRIVATE-1) or SYNC_TOKEN. Before, OWNER_TOKEN || SYNC_TOKEN let the new secret silently shadow the old one, so a
// client still sending SYNC_TOKEN got 401. Each secret shorter than 16 characters is ignored; every comparison is
// constant-time and both are always compared. No value is ever logged.
function ownerTokens(env){return [env.OWNER_TOKEN, env.SYNC_TOKEN].filter(function(t){return typeof t==='string'&&t.length>=16})}
function ctEq(a,b){if(a.length!==b.length)return false;var d=0;for(var i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0}
function ownerOk(req,env){
  var wants=ownerTokens(env);
  if(!wants.length)return false;
  var h=req.headers.get('Authorization')||'';
  var m=/^Bearer\s+(.+)$/i.exec(h.trim());
  var sup=m?m[1].trim():'';
  if(!sup){try{sup=new URL(req.url).searchParams.get('token')||''}catch(e){console.error(JSON.stringify({worker:"idea-hub",where:"ownerOk",error:String(e&&e.message||e).slice(0,300)}))}}
  if(!sup)return false;
  var ok=false;for(var i=0;i<wants.length;i++){if(ctEq(wants[i],sup))ok=true}
  return ok;
}
async function intake(req,env){
  var b;try{b=await req.json()}catch(e){return json({error:'invalid JSON body'},400)}
  var kind=String(b.kind||'idea').toLowerCase();
  var title=clean(b.title||'',300);
  var body=String(b.body||b.text||'').slice(0,200000);
  if(!title&&!body)return json({error:'title or body required'},400);
  var src='owner-chat', now=Date.now();
  if(kind==='paper'){
    var slug=String(b.slug||title).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80)||('owner-'+now);
    try{await env.LIVING_PAPER.prepare("INSERT OR IGNORE INTO papers (identifier,slug,title,authors,abstract,body_md,status,created_at,updated_at,version) VALUES (?,?,?,?,?,?,'draft',datetime('now'),datetime('now'),'0.0.1')").bind('owner-'+slug,slug,title||'Untitled','["Rowan Brad Quni-Gudzinas"]',clean(body,2000),body).run()}catch(e){return json({error:'paper insert failed: '+(e&&e.message||e)},500)}
    return json({ok:true,kind:'paper',slug:slug,status:'draft',provenance:src,held:true});
  }
  if(kind==='issue'){
    try{await env.QNFO_AUDIT.prepare("INSERT INTO agent_issues (title,description,source,category,priority,status,created_at,updated_at) VALUES (?,?,?,?,?,'open',?,?)").bind(title||'Owner-filed item',body||title,src,(b.category||'owner-intake'),(b.priority||'medium'),now,now).run()}catch(e){return json({error:'issue insert failed: '+(e&&e.message||e)},500)}
    return json({ok:true,kind:'issue',provenance:src,held:true});
  }
  // IDEAS-INTAKE-OWNER-1 (1.10.12): the reply carries the new row's id, so the owner can follow it in idea_proposals, and says
  // what happens next. `held:true` stays for callers that read it; an owner-chat row is ACCEPTed by the next hourly triage.
  var ins;
  try{ins=await env.QNFO_AUDIT.prepare("INSERT INTO idea_proposals (name,idea,contact,status,created_at) VALUES (?,?,?,?,datetime('now'))").bind(src,(title?title+'\n\n':'')+body,'owner','new').run()}catch(e){return json({error:'idea insert failed: '+(e&&e.message||e)},500)}
  return json({ok:true,kind:'idea',id:ins&&ins.meta&&ins.meta.last_row_id!=null?ins.meta.last_row_id:null,provenance:src,status:'new',held:true,next:'filed as owner-authored; the hourly triage accepts it and queues it for research'});
}
// REACH-IDEA-1 (1.5.7, agent_issues 2001): the home page's subscribe box posts here; the address goes to the qnfo-subscribers
// double opt-in (the same endpoint and fields qnfo-gateway's /api/subscribe proxy uses) with source ideas.qnfo.org, so nothing
// is stored here and nobody is subscribed until they click the confirmation link. Rate limits live in qnfo-subscribers.
var SUBSCRIBERS_ENDPOINT = "https://qnfo-subscribers.q08.workers.dev";
// TURNSTILE-EDGE-1 (1.15.0, BP26-EDGE-SECURITY-1): the subscribe box carries a Turnstile widget and subscribeProxy verifies its token; fail-open only while TURNSTILE_SECRET is unbound.
// BEGIN TURNSTILE-EDGE-1
var TURNSTILE_SITEKEY_DEFAULT = "0x4AAAAAAFpf2WdSG4-h5mu_";
var TURNSTILE_SCRIPT = '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>';
function turnstileWidget(env, action) {
  var key = (env && env.TURNSTILE_SITEKEY) || TURNSTILE_SITEKEY_DEFAULT;
  return '<div class="cf-turnstile" data-sitekey="' + key + '" data-action="' + String(action || "form").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) + '" data-appearance="interaction-only" data-theme="auto"></div>';
}
async function turnstileVerify(env, token, ip, action) {
  if (!env || !env.TURNSTILE_SECRET) return { ok: true, skipped: true, reason: "no-secret" };
  if (typeof token !== "string" || token.length === 0 || token.length > 2048) return { ok: false, reason: "missing-token" };
  try {
    var body = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token });
    if (ip) body.set("remoteip", ip);
    var r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: body, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return { ok: false, reason: "siteverify-" + r.status };
    var j = await r.json();
    if (!j || j.success !== true) return { ok: false, reason: "rejected:" + String((j && j["error-codes"]) || "").slice(0, 80) };
    if (action && j.action && j.action !== action) return { ok: false, reason: "action-mismatch" };
    return { ok: true, reason: "verified" };
  } catch (e) {
    return { ok: false, reason: "siteverify-error" };
  }
}
// END TURNSTILE-EDGE-1
async function subscribeProxy(req, env) {
  var payload = {};
  try { payload = await req.json(); } catch (e) { payload = {}; }
  var email = String(payload && payload.email || "").trim().toLowerCase();
  if (!email || email.length > 254 || !/^[^@\s]{1,64}@[^@\s.]{1,255}\.[^@\s.]{2,}$/.test(email)) return json({ ok: false, error: "Please enter a valid email address." }, 400);
  var ts = await turnstileVerify(env, payload && payload.cf_turnstile, req.headers.get("CF-Connecting-IP") || "", "ideas_subscribe");
  if (!ts.ok) return json({ ok: false, error: "Verification failed. Reload the page and try again." }, 403);
  var ctrl = new AbortController(), timer = setTimeout(function () { ctrl.abort(); }, 9000);
  try {
    var r = await fetch(SUBSCRIBERS_ENDPOINT + "/subscribe", { method: "POST", signal: ctrl.signal, headers: { "Content-Type": "application/json", "User-Agent": "idea-hub/" + VERSION, "X-Forwarded-For": req.headers.get("CF-Connecting-IP") || "", "X-Client-UA": String(req.headers.get("User-Agent") || "").slice(0, 300) },
      body: JSON.stringify({ email: email, hp: String(payload && (payload.hp || payload.website) || ""), source: "ideas.qnfo.org" }) });
    var data = await r.json().catch(function () { return {}; });
    return json(data && typeof data === "object" ? data : { ok: false, error: "Sign-up failed." }, r.status);
  } catch (e) {
    return json({ ok: false, error: "Sign-up is unavailable right now. Please try again shortly." }, 502);
  } finally { clearTimeout(timer); }
}
var __wm_default = {async scheduled(event,env,ctx){ctx.waitUntil(ideationCycle(env))},async fetch(req,env,ctx){const u=new URL(req.url);if(u.pathname==='/robots.txt')return new Response('User-agent: *\nAllow: /\nSitemap: https://ideas.qnfo.org/sitemap.xml\n',{headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'public, max-age=86400'}});if(u.pathname==='/sitemap.xml')return new Response('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://ideas.qnfo.org/</loc><changefreq>daily</changefreq></url></urlset>',{headers:{'Content-Type':'application/xml; charset=utf-8','Cache-Control':'public, max-age=3600'}});/* SEO-HYGIENE-1: robots + sitemap (home only: the idea pages are machine-generated questions, not invited into the index) */if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors()});try{if(u.pathname==='/api/subscribe'&&req.method==='POST')return await subscribeProxy(req,env);if(u.pathname==='/health'){let qt=-1;try{qt=(await quarantined(env)).size}catch(e){console.error(JSON.stringify({worker:"idea-hub",route:"/health",read:"quarantine",error:String(e&&e.message||e)}))}let td=-1,tdd=-1;try{const r=await env.QNFO_AUDIT.prepare("SELECT COUNT(*) AS n FROM idea_proposals WHERE status='deferred_budget'").first();td=Number(r&&r.n)||0;const r2=await env.QNFO_AUDIT.prepare("SELECT COUNT(*) AS n FROM idea_proposals WHERE status='deferred_diversity'").first();tdd=Number(r2&&r2.n)||0}catch(e){console.error(JSON.stringify({worker:"idea-hub",route:"/health",read:"deferred",error:String(e&&e.message||e)}))}let oc=null;try{oc={};((await env.QNFO_AUDIT.prepare("SELECT outcome, COUNT(*) AS n FROM owner_corpus_seen GROUP BY outcome").all()).results||[]).forEach(function(x){oc[x.outcome]=x.n})}catch(e){oc=null;console.error(JSON.stringify({worker:"idea-hub",route:"/health",read:"owner_corpus_seen",error:String(e&&e.message||e)}))}return json({ok:true,worker:'idea-hub',version:VERSION,private:false,owner_signal_intake:{vault_bound:!!env.VAULT,corpus_seen:oc,reentry_owner_types:REENTRY_OWNER_TYPES,corpus_score_min:OWNER_CORPUS_SCORE_MIN},triage_deferred_budget:td,triage_deferred_diversity:tdd,diversity_cap:{max_share:DIVERSITY_MAX_SHARE,min_n:DIVERSITY_MIN_N},novelty_screen:{models:NOVELTY_MODELS,neighbours_per_source:NOVELTY_K,sources:["qnfo-corpus","arxiv"],payoff_min:NOVELTY_PAYOFF_MIN,foundational_quota:NOVELTY_FOUNDATIONAL_QUOTA,corpus_bound:!!(env.PAPER_VZ&&env.LIVING_PAPER)},public_filter:true,thread_filter:true,strict_filter:true,match_mode:'boundary',quarantine_wired:true,errata_wired:true,quarantine_threads:qt,mutation_routes:false,capabilities:["public-ideas-feed", "idea-stream", "questions-feed", "rss", "session-pages", "ideation", "qds-pages", "owner-intake", "novelty-screen"],limitations:["read-only public surface: /, /s/*, /rss.xml, /api/sessions, /api/session/* load with no credential", "chat threads: only a first research-domain question passes the public filter; personal, ops and quarantined threads are never shown", "the feed also carries the pipeline's own open questions and triaged proposals (kind q-N / p-N, source ideation)", "/api/ask, /api/proposals and /run answer 503; POST /api/intake is owner-authenticated; POST /api/subscribe forwards an address to the qnfo-subscribers double opt-in (source ideas.qnfo.org; nobody is subscribed without clicking the confirmation link)", "ideation runs on the hourly :25 cron", "while a fleet_budget ai_spend cap is breached, triage still runs and scores on one cheap model (BUDGET-SOFT-ROUTE-1); rows left as status deferred_budget by older versions are released every run (count in triage_deferred_budget)", "a generated proposal scored ACCEPT waits as deferred_diversity (count in triage_deferred_diversity) while its topic cluster would exceed half of the 30-day accepts; owner and intake:* rows are never held"],bindings:{audit:!!env.QNFO_AUDIT}})}if(u.pathname==='/api/gate'){const q=u.searchParams.get('q')||'';return json({q,public:publicTitle(q),internal:has(q,INTERNAL),ops:has(q,OPS),junk:has(q,JUNK),research:has(q,RESEARCH),match_mode:'boundary'})}if(u.pathname==='/rss.xml')return ideasCached(req,ctx,function(){return rss(env)},{maxAge:120,freshMs:FEED_FRESH_MS});if(u.pathname==='/api/sessions'||u.pathname==='/api/feed'){const lim=parseInt(u.searchParams.get('limit')||'50',10);return ideasCached(req,ctx,function(){return sessions(u,env)},{variant:'&limit='+(Number.isFinite(lim)?Math.min(Math.max(lim,1),100):'x'),maxAge:120,freshMs:FEED_FRESH_MS})}if(u.pathname.startsWith('/api/session/'))return session(u.pathname,env);if(u.pathname==='/api/suggest')return json({policy:'research-domain only; personal/ops/actions/runtime metadata are never suggested',groups:[]});if(u.pathname==='/api/ask'||u.pathname==='/api/proposals'||u.pathname==='/run')return json({error:'mutation or ask route disabled on public ideas surface'},503);if(u.pathname==='/stream')return ideasCached(req,ctx,function(){return ideasStream()},{maxAge:300,freshMs:3600000});if(u.pathname==='/'||u.pathname==='/index.html')return ideasCached(req,ctx,function(){return ideasHome(env)});if(u.pathname.startsWith('/s/')&&u.pathname.length>3)return ideasCached(req,ctx,function(){return ideasThread(env,u.pathname.slice(3))});if(u.pathname==='/api/intake'){if(!ownerOk(req,env))return json({error:'Authentication required'},401);if(req.method!=='POST')return json({error:'POST required'},405);return await intake(req,env)}return json({error:'Not found'},404)}catch(e){return json({error:'Server error: '+(e&&e.message||String(e))},500)}}};
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
// ---- WEBMCP-FLEET-1:ATTACH idea-hub ----
wmAttach(__wm_default, "idea-hub");
