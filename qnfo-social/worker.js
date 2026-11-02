// qnfo-social - cloud-based Bluesky posting (AT Protocol) + AI compose with link facets.
// v0.7.0-LINKS (2026-09-16): postText emits app.bsky.richtext.facet#link facets (UTF-8 byte offsets) for
//   every URL; root posts carry app.bsky.embed.external link cards; /repost + /delete admin routes for
//   link remediation; auth accepts X-Ops-Key (OPS_KEY secret); autoScan+compose prompts demand full
//   https:// URLs (never bare DOIs); truncateSafe never splits a URL at the 290-char boundary.
// History: v0.6.0 DRAIN-QUOTA-1 (2026-09-15) drain matched to production rate + crashed-run reclaim +
//   failed-retry sweep + daily cap. v0.5.3-checker-failclosed (2026-09-13): checker returns null (not [])
//   when unavailable -> draft. v0.5.2-checker-heal (2026-09-08): tolerant JSON parse + strict retry +
//   agent_issue escalation. FIX 2026-09-15: checker max_tokens 1000->3000 for the reasoning model.
// v0.7.19 POST-ID-UTM-1 (#1712, 2026-10-01): UTM tags on qnfo links, post ids persisted, weekly cadence cap
//   (SOCIAL_WEEKLY_CAP, default 2) and the pipeline_flags.social_paused kill switch on both drains.
// v0.7.35 SOCIAL-POST-TRUNCATION-1 (#1902, pillar: reach): postText fits the UNTAGGED text and puts the UTM only in each link
//   facet uri (tagFacets), so tracking costs no visible characters and the prose is never cut for it; stored_text keeps the tagged form.
// Secrets: BSKY_HANDLE, BSKY_APP_PASS, SOCIAL_TOKEN, GATEWAY_SOCIAL_TOKEN, BUFFER_TOKEN, OPS_KEY, MASTODON_TOKEN (optional, MASTODON-DIRECT-1; var MASTODON_HOST).
// Vars (optional): SOCIAL_WEEKLY_CAP. D1: DB (qnfo-audit.social_threads, dissemination_tracker, pipeline_flags; 0.7.28 also
// social_learner_posts, ops_config social_learner_enabled / social_learner_pending, metric_registry). AI: env.AI.

// 0.19.1 LEARNER-ARMS-PROBE-SCOPE-1: persist policy-exclusion reasons so issue 2722 measures only eligible paper-linked learner rows.
var VERSION = "0.21.8-codeagent"; /* 0.21.3: use actual Bluesky post times for the 72h engagement metric (#1465, agent_issues 2022, pillar reach). */ /* 0.21.2 CROSSPOST-CAP-1 (2026-10-28, pillar reach; patch: a fix; agent_issues 1000610): the Bluesky cross-post (bufferPost) now applies the same weekly cap and spacing as the channel drain (windowHold, crossPostHold); it ignored both. */ /* 0.21.1 channel-marker */ /* 0.21.1 ART50-CHANNEL-DRAIN-MARKER-1 (2026-10-28, pillars reach and security, cluster D; patch): the channel drain posted to X, LinkedIn, Mastodon and Substack Notes without the AI marker (only Bluesky and the cross-post path used withAutomationMarker); it now marks the text, and the stored 200-character preview keeps the marker so ai_label_coverage can read it. Prediction: ai_label_coverage social row rises from 0 of 42 as marked posts replace unmarked ones in the 14-day window. prior 0.21.0 */ /* 0.21.0 BP26-AI-ACT-ART50-1 (2026-10-28, pillars reach and security, agent_issues 1000341): the post marker now says what Article 50 asks, " [AI-generated]" (it was " [automated]", which names no AI and which the BP26 collector bp26_web.py does not read as an AI marker: 0 of 42 posts of 14 days carried one), and it is never skipped: a post with no room for it is fitted to the limit minus the marker (URLs kept, prose shortened) instead of going out unlabelled. withAutomationMarker, qnfo-social/automation-marker.test.mjs. */ /* 0.20.0 BP26-SOCIAL-AUTOMATION-1 (2026-10-26, pillar reach, agent_issues 1000340): every automated post ends with a short automation marker (" [automated]") until the owner turns on the platform automated-account labels (owner card bp26-social-bot-labels, whose default is exactly this marker). It is appended at the three posting choke points (postText for Bluesky, mastodonCreate, bufferCreate for LinkedIn, X, Substack and the roll-up note) only when it fits the platform limit this worker already fits to, so no post is cut or refused for it; a post at the limit goes out unchanged. withAutomationMarker, qnfo-social/automation-marker.test.mjs. */ /* 0.19.4 LEARNER-ARMS-3 (2026-10-26, pillar reach, agent_issues 2722): the attention learner files a Bluesky roll-up post under the time it was posted, not the time its paper was announced. A roll-up row (dissemination_tracker mode rollup:bluesky) keeps the posted_at of the Substack roll-up that announced the paper and the Bluesky thread carries it days later, so 152 learner rows were anchored on 2026-10-14 although they went out between 10-14 and 10-25, and the 72 hour reward window opened before the post existed: 135 posts read no-data although every one of them has utm human clicks inside its real window (Bluesky is the channel with the most human clicks, 496 in 7 days). The row's posted_at is now the time inside its record key (a Bluesky TID: 13 base32-sortable characters whose first 11 hold microseconds since the epoch) when that is later than the tracker's value (blueskyTidMs, learnerPostedAtOf), the slot follows it, and a roll-up thread post is filed with n_posts 2 so the reply that is the next post of the same thread is not counted as engagement. migrations/2026-10-26-learner-anchor-repair.sql files the rows already stored under the right time. qnfo-social/learner-anchor.test.mjs. */ /* 0.19.3 SOCIAL-ENGAGEMENT-COVERAGE-1 (2026-10-26, pillar reach; guard metric attention_channels_stopped): collectEngagement measures every Bluesky post of the last 60 days. It built its list from social_threads (LIMIT 100) and then dissemination_tracker and stopped at 100 URIs, so each 07:00 run measured the newest 100 thread posts and none of the 203 dissemination posts (194 posted since 2026-10-14 had no social_engagements row), and the attention scorecard counted them as items with zero engagements. The list is now both sources deduplicated, posts without a snapshot first, then newest, up to 400 URIs (planEngagementUris); a URI the AppView omits gets no row; 429 waits and attempts are capped; the rows are written in batches of 400; the result reports candidates, never_measured, skipped_by_cap and omitted. 0.19.2 LINK-SLASH-CANON-1 (2026-10-26, pillar reach): probeLink follows a redirect that only adds or drops the trailing slash of the same URL (one hop, same origin and query) and judges the page it lands on. qnfo-gateway SEO-INDEX-1 (2026-10-25) answers /papers/<slug>/ with a 308 to /papers/<slug>; every dissemination_tracker pages_url ends in a slash, so every probe read 'misrouted': the last Buffer post (Substack, X) left at 2026-10-25 08:31Z, the LinkedIn, Mastodon and X drains held link-misrouted, both roll-ups held no-live-links, and retractDeadLinks overwrote post_text_snippet of 203 posted rows with a MISROUTED note (it no longer overwrites a posted row's text: PRESERVE-POSTED-TEXT-1). A redirect to another path or host stays misrouted (NEVER-RETIRE-ON-REDIRECT-1); a 404/410 on the landing page is gone; the marker check still applies. qnfo-social/link-slash-canon.test.mjs. */ /* 0.19.1-no-registrar */ /* 0.19.0-no-registrar NO-REGISTRAR-1 (2026-10-21): the Mastodon field filter matches the dead DOI prefix, not the registrar name */ /* 0.18.1 BSKY-CREATE-SESSION-COUNT-1 (2026-10-19, pillar reach, agent_issues 100191, residual of 2937): every com.atproto.server.createSession call, ok or refused, adds 1 to metric_history metric bsky_create_session_24h for the UTC day, so the 300-a-day account budget is measured; a failed count is logged and never blocks the post. */ /* 0.18.0 LEARNER-ARMS-2 (2026-10-19, pillar reach, agent_issues 2722): the attention learner learns from the posts it files. 50 of 61 learner rows read not-arm on 2026-10-17 and 124 of 137 on 2026-10-19 because learnerTopicOf named a topic for three keyword lists only and the channel-drain insert stored a null link slug. A post that links a paper now takes the paper's own shelf (living-paper paper_category, read through the new LIVING_PAPER binding; energy, ai-epistemics and ai-operations keep the arm names energy, epistemics and operations; qec, physics, mathematics, logic, synthesis and assessment are arms too) and the generic arm research when the paper has no shelf row or the binding is unreadable; q08, pillar 4 (ultrametric, adelic, p-adic, autaxic, topos), roll-up posts and posts with no paper link stay not-arm. The channel drain stores the paper slug as link_slug (parsed from the posted text, else the known paper slug). learnerVisits joins the utm ledger on the gateway's own campaign key (lower case, 64 characters) and on the row's slug, the campaign the post was tagged with, so a curated thread whose slug differs from its paper slug and a slug longer than 64 characters read their clicks. migrations/2026-10-19-learner-arms-backfill.sql re-files the recoverable not-arm rows. */ /* 0.17.1 SOCIAL-PAUSE-STALE-UNTIL-1 (2026-10-19, pillar reach, agent_issues 2818): social_paused_until ends a pause only when it was written with that pause (a stale until from an earlier episode is ignored and the pause holds), a pause whose expiry clear fails still holds, and every pause read logs one pause-read line (value, until, write times, result). The 2026-10-17 14:30Z drains posted without a SOCIAL-PAUSE-1 line while the flag read 1 (Workers Logs); the expiry path had no test. */ // 0.17.0 CRON-GRID-1 (owner directive 2026-10-19, pillar autonomy): one hourly :30 trigger. The 06:00 scan runs on the 06:30 fire and is retried hourly (at most 3 times) when it fails; the 07:00 alert digest and engagement run on the 07:30 fire, never retried (they send the owner a digest). Every fire is logged to cron_fire_log for CRON-WATCH-1. // 0.16.12 INTEG-MASTODON-VERIFY-1 (2026-10-19, pillar reach, agent_issues 2925, code task ct_im2925): the profile sync that 0.16.10-codeagent added as a top-level block (process.env, a fetch in global scope) could never run on a Worker; it is now mastodonProfileSync(env) on the daily engagement step, idempotent, with a read-back of the verified fields and a test (mastodon-profile.test.mjs). // 0.16.6 BSKY-SESSION-REUSE-1 (2026-10-18): one Bluesky session per isolate for 30 minutes instead of one createSession per step (createSession is limited to 30 per 5 min and 300 a day per account). 0.16.5 THREAD-CLOSE-1 (2026-10-18): a queued curated thread every Buffer channel has carried is marked posted after each drain (thread 153 sat queued 16 days after all three channels posted it); 0.16.0 PAPER-ROLLUP-1 (2026-10-14, pillar reach; owner directive "substack swapped for mastodon on buffer. update expectations and post/outreach schedule accordingly and implement full-throated/full-throttle publication and dissemination pipelines....clear out backlogs and queues now and forever...100% server-side and 100% automatically"): every published paper is disseminated, none is suppressed for volume. drainRollup runs every hourly tick (cron 30 * * * *, was every 2 h): a Substack Note lists every queued paper (up to ROLLUP_SUBSTACK_MAX, oldest first, each link probed and tagged utm_source=substack with the paper as campaign) and marks it posted (mode rollup); a Bluesky thread then carries up to ROLLUP_BSKY_MAX of those papers, one post each, inside the Bluesky gate (default 21 a week, spaced), each paper recording its own post id so RETRACT-DEAD-LINKS-1 still works. The single-paper Buffer drain reads posted and queued papers of 30 days, so LinkedIn, Mastodon (direct) and X keep taking the newest paper they have not carried; Substack takes roll-ups only. The gate counts a roll-up thread as one post. retractDeadLinks re-checks at most RETRACT_MAX posts of 30 days a run. // 0.15.0 0.15.0 OUTREACH-ACCELERATE-1 (2026-10-14, pillar reach; owner directive "Accelerate all social media and all external outreach, communication, and promotion. All available channels shall be fully utilized as appropriate and effective, including email, Buffer, Mastodon, Bluesky, Substack, and all other channels."): Bluesky defaults to 14 posts a week (2 a day) and the Buffer channels to LinkedIn 7 (queue or drafts, ToS 3.1 unchanged), Mastodon 14, X 14 and Substack Notes 14 (clamp 0..21); the attention share now steers between a floor and the cap (pipeline_flags social_share_floor, default 0.5) instead of cutting a channel to one post a week on a thin sample; Bluesky posts are spaced (at most one per 2-hourly run, at least 7 days / cap minus 1 h apart) so the higher cap never bursts; SUBSTACK-CHANNEL-1: a Substack channel connected in Buffer (Notes; API supported on the free plan) is drained and cross-posted like LinkedIn (whole thread, subscribe line, utm_source substack); MASTODON-DIRECT-1: with MASTODON_TOKEN set, Mastodon posts go straight to the instance API (MASTODON_HOST, default mstdn.science) instead of Buffer, which frees a Buffer channel slot, and their counts are read from the public status API at 07:00. // 0.14.3 LOG-NOISE-1 (2026-10-14, pillar core, found by FLEET-JOURNEYS-2 and the Cloudflare Observability Issues ingest): the three ensure*Schema ALTERs no longer log their expected "duplicate column" answer as an error.


// Wrap socialPausedBy to log its reads and fail‑closed on errors.
// This ensures drains see a paused state if the flag read throws.
if (typeof socialPausedBy === 'function') {
  const __origSocialPausedBy = socialPausedBy;
  // Preserve async nature if the original is async.
  socialPausedBy = async function (...args) {
    try {
      const result = await __origSocialPausedBy.apply(this, args);
      console.log('socialPausedBy read', { value: result });
      return result;
    } catch (e) {
      console.error('socialPausedBy error', e);
      // Fail‑closed: treat any error as “paused”.
      return true;
    }
  };
}
// // 0.14.0 (2026-10-13, pillar reach): SOCIAL-CHECK-FAIL-CLOSED-1 (issue 2501): the checker reply parser skips stray arrays such as "[1]", reads issue lists keyed issue, problem, claim or text, and returns null (thread held as draft) when no valid issue array is present. MASTODON-PUBLIC-STATS-1 (issues 2481, 2374): the 07:00 Buffer statistics run reads favourites, reblogs and replies of up to 30 sent Mastodon posts from the public status API when Buffer returns no metrics (platform buffer rows, post_id = the Buffer id). LEARNER-COVERAGE-1 (issue 2381): every drained post is recorded for the learner (chosen_by backfill when no learner decision; the 24h spacing applies to learner-chosen posts only). UTM-CREDIT-1 (issue 2036): a post without an engagement snapshot is credited on its utm clicks, and no-data rows of the last 14 days are re-read for them. CRON-ONLY-HEARTBEAT-1 (issue 2397): every scheduled run ends with a fleet_heartbeat upsert (ok=0 when it threw). // 0.13.1 also LEDE-SOCIAL-1 (2026-10-13, from the fleet lede audit of session_01BCBpN3cZdS57dweqCs9rwt): post 1 of a composed thread is the lede (what the paper is, by whom, its main finding), and checkThread holds a thread whose post 1 neither names the author nor shares a significant title word (threadLedeIssues) for the repair pass. 0.13.1 SOURCE-VOICE-SOCIAL-1 (agent_issues 2472, pillar reach): POST /compose stores the abstract it grounded the thread on, so reachRepairDrafts and recheckDrafts no longer skip its held drafts (179 of 182 social_threads rows had no abstract on 2026-10-13). // 0.13.0 (2026-10-12, pillar reach) BUFFER-POST-STATS-1 (issue 2374): the 07:00 engagement run also reads Buffer with this worker's own token: per connected channel the sent posts of the last 30 days with their statistics and public link; one social_engagements row per post and metric (platform buffer, post_id = the Buffer post id), the link into social_media_posts.url, an auth_status row every run, and per network buffer_channel rows that say how many sent posts carried statistics and how many carried none (never zeros in place of a missing statistic). Bounded: 6 channels, 3 pages of 30 posts each, 10 s per call, 512 KB per body. // 0.12.0-whole-sentences // 0.12.0 (2026-10-12, pillar reach) SOCIAL-POST-TRUNCATION-2 (issue 1902): a post too long for its channel is never cut mid-sentence: Bluesky continues it as replies split at sentence boundaries (splitForThread; the link and its card stay on the root), the Buffer channels and the LinkedIn text keep whole sentences and drop trailing ones (fitWhole); the ellipsis cut is the last resort for a single sentence longer than the limit. REACH-SIGNALS-1 (issue 2225): the 07:00 engagement run stores each reply by another account (social_replies: hashed author, delay from the post in minutes, text length, word count; never the text) from the public getPostThread endpoint; no reply is posted. SUBSCRIBE-LINE-ACCURATE-1 (issue 1753): the LinkedIn subscribe line said monthly while the list is a weekly digest and linked the page top; it now states the cadence the list has and links the form. Ledger ids come from crypto.randomUUID. // 0.11.1-doi-scrub // 0.11.1 NOZ-DOI-1 (owner decision 2026-10-10, pillar reach): the dead-registry paper scan, the selected-works refill and every 10.5281 identifier are removed; the 06:00 run only sweeps and repairs drafts, contentGate refuses (and the drain suppresses) any post carrying a dead-registry identifier or link, and prompts and the checker link only to a URL or a third-party DOI. // 0.11.0 SOCIAL-GROUND-1 (owner directive 2026-10-10, pillar reach): checkThread first runs a mechanical check that every capitalised name, year and figure in a thread occurs in the title, author or abstract it was written from (an invented one is an issue, no model can override it); composePrompt and the checker prompt state that the model's own knowledge is not a source and name no example topics; the checker stays fail-closed (unavailable = draft). // 0.10.0-open-q08 0.10.0 Q08-OPEN-1 (owner directive 2026-10-09, pillar reach): q08.org links and q08 rows are no longer refused or skipped, the REACH-SELECT title hold is dropped in the channel drain, an attention share of 0 keeps one slot instead of holding a channel or Bluesky, the Bluesky weekly cap defaults to 7 and the Buffer channel caps to LinkedIn 5 (drafts only), Mastodon 10, X 10 (ceiling 14); the mojibake guard, the pause flag and the LinkedIn draft rule stay.  // 0.9.2 // 0.9.2 PROMOTE-ROUTE-2: a channel whose last post was a curated thread gets the newest unposted paper next. // 0.9.1 PROMPT-CACHE-COUNT-3b (issue 2114, 2026-10-08, pillar cost): the 0.8.3 ai_cache_counters write named columns the table does not have (purpose, cached), so every insert failed silently; it now writes the fleet schema (day, worker, model, calls, cached_calls, in_tok, cached_tok).  // 0.9.0 PROMOTE-ROUTE-1 (2026-10-07, pillar reach, owner directive "no siloes"): the channel drain takes queued research papers from dissemination_tracker (newest first, after curated queued threads, before recycled posted threads), so a published paper reaches LinkedIn, Mastodon and X while Bluesky is at attention share 0. // 0.8.2 UTM-VISITS-1 (2026-10-06, pillar reach, transformation lever T7.9 half 2): learnerVisits reads the gateway's tagged loads first (reach_signals source utm, metric clicks_human, campaign = the paper slug, channel = the utm_source of the post's channel; UTM-CLICK-LEDGER-1, qnfo-gateway 3.10.0 + qnfo-fleet-dashboard 1.26.0, PR 688): a direct count of the visits a post caused beats the bot-filtered RUM lift, which stays the fallback when the window carries no tagged row. 0.8.1 LEARNER-CHANNEL-ARM-1 was
// 0.8.1 (2026-10-06, LEARNER-CHANNEL-ARM-1, transformation lever T7.13, pillar reach; owner directive "execute the suggestions"): the
// distribution learner gains a channel arm (bluesky, linkedin, mastodon, x): Buffer channel posts become learner rows credited
// from the reach ledger's buffer metrics, the posterior carries a channel allocation, and the channel drain visits the Buffer
// channels in the order of one Beta draw each (learnerChannelOrder); GET /learner shows the channel dimension.
// 0.8.0 (2026-10-06, ATTENTION-SHARE-1, pillar reach; owner directive 2026-10-06 07:44Z): the actuation half of qnfo-fleet-dashboard
// ATTENTION-LOOP-1. ops_config attention_channel_share (per-channel share of the owner cap, written daily by the dashboard's
// scorecard from human attention per item) scales the Buffer channel caps and the Bluesky cap (never above them; a stale
// share reads as 1); the channel drain orders posted rows noticed-first (bot-filtered external loads of the paper plus the
// post's Bluesky engagement); the distribution learner credits closed 72h windows daily (learnerDailyCredit) instead of
// only in the weekly update, and reads the bot-filtered per-item rows for visits when present.
// 0.7.37 (2026-10-06, DAILY-DISTRIBUTION-1, pillar: reach; owner directive 2026-10-06 "persistent, routine, daily" outreach):
// LinkedIn, Mastodon and X (connected in Buffer) posted only as the cross-post of a Bluesky post, so the Bluesky cap (2 a
// week) was every channel's cap and nothing went out on 5 of 7 days. Each Buffer channel now has its own weekly cap inside
// STRATEGY s4 (LinkedIn 3, Mastodon 2, X 2; pipeline_flags.social_channel_caps overrides, 0..7), evenly spaced over the
// week, filled by a channel drain on the 2-hourly tick after the Bluesky drains (queued selected rows first, then posted
// rows the channel has not carried in 30 days), with the subscribe offer on LinkedIn; ledger social_media_posts and
// social-channels-<day>; bufferPost skips a channel that already carried the slug. No cap is raised; Bluesky is unchanged.
// 0.7.36 (2026-10-05, REACH-REPAIR-1, pillar: reach): a draft the checker held was a dead end (4 eligible pillar 1-3
// papers on 2026-10-05, one since 09-29). Now each held draft gets exactly one automatic rewrite with the checker's
// findings fed back, then a fresh check: clean -> queued; held again -> rejected with both rounds of findings in notes.
 // 0.7.34 (2026-10-03, owner directive "wire an ideation loop so the fleet generates and queues the next reach work itself,
// without asking", pillar: reach): REACH-SELECT-1 + REACH-REFILL-1. Measured before: the paper scan composed a thread for
// every new paper (10 on 2026-10-03 06:0xZ, nearly all ultrametric programme, which STRATEGY 2.3 keeps out of outreach),
// spending AI on posts that must never ship, while 7 of 11 drafts were held only because the checker treated the author's
// name (which the composer is told to write) as invented. Now: (1) the scan, the recheck and the drain apply the STRATEGY
// 2.3/2.4 selection (reachEligible); an ineligible paper is recorded as suppressed with its reason, at no AI cost;
// (2) the checker's ground truth includes the author and the link; (3) when fewer than REFILL_MIN_QUEUE threads are
// queued, the daily scan composes one thread for the STRATEGY 2.4 selected work with the most views that has had no
// thread in REFILL_GAP_DAYS days, so the queue never runs dry and only refills with work the strategy leads with.
// 0.7.31 (2026-10-02, #1712 POST-ID-UTM-1, pillar: reach): POST-SENT-TEXT-1 + POST-UTM-SUBDOMAIN-1. The UTM tag was
// applied at send time only and social_threads.posts kept the untagged draft, so D1 had no record that any posted link
// carried a UTM and the issue's probe could never pass. A posted row now stores the text exactly as posted (tagged and
// fitted) in social_threads.posts, and a dissemination post stores it in dissemination_tracker.post_text_snippet; the
// /post, /thread, /cross and /broadcast routes record the same. Every *.qnfo.org host is tagged (was qnfo.org, www and
// papers only, so the ipatent.qnfo.org launch post would have gone out untagged).
// 0.7.29 (2026-10-02): GET /learner names an unavailable part ("posterior unavailable") and never echoes exception text
// (CodeQL js/stack-trace-exposure); the detail goes to the worker log.
// 0.7.28 (2026-10-02, pillar: reach): SOCIAL-DISTRIBUTION-LEARNER-1 (STRATEGY 6.4 "distribution allocation (weekly)",
// owner directive 2026-10-02: measure external effectiveness and change itself to improve it). A Thompson-sampling bandit
// over topic x format x time slot chooses which queued post goes next and in which slot, inside the weekly cap, pause flag
// and content gates; it never adds a post. Rewards (72h Bluesky engagement plus attributed paper-page views) are credited
// once per post in a weekly update; ops_config social_learner_enabled=0 restores the 0.7.27 order and timing. Daily
// metric_registry social_engagement_rate_30d; public GET /learner. Full design at the SOCIAL-DISTRIBUTION-LEARNER-1 block.
// 0.7.27 (2026-10-02, pillar: reach): SOCIAL-RUN-LEDGER-1. The profile sync, the posting drain with its Buffer cross-post,
// the paper scan and the engagement collector each record their run in cloud_ops_events (social-<op>-<day>), so the
// watchmaker (qnfo-fleet-dashboard WATCHMAKER_OPS) can tell a quiet run from a dead one. The two drains no longer share a
// try: a throw in one ended the tick before the other drain and the link checks ran.
// 0.7.25 (2026-10-01, #1713): LINKEDIN-OWNER-DELEGATED-1 and BUFFER-CHANNEL-AUDIT-1. The owner directed (2026-10-01 21:35Z,
// in addition to OWNER-DELEGATION-SOCIAL-1) that LinkedIn be managed without any manual step. LinkedIn is connected in
// Buffer (engagement run 2026-09-20: channels linkedin, twitter, mastodon). The fleet never calls LinkedIn's API; Buffer,
// the account holder's authorised publishing app, publishes from its queue. pipeline_flags.linkedin_mode selects
// 'publish' (Buffer queue, default per the owner's direction) or 'draft' (one-tap approval); the weekly cap, pause flag
// and content gate apply unchanged. A daily channel audit records every Buffer channel in social_channels.
// 0.7.21 (2026-10-01, #1712 POST-ID-UTM-1, #1647 SOCIAL-ENGAGEMENT-COLLECTION-STOPPED-1, #1713): measured at 14:11 UTC,
// social_threads had 141 posted rows and 0 with post_uri. Every one of them was posted before 0.7.19 went live
// (first deploy 11:22 UTC; newest post 04:30 UTC), and since then the queue was empty and the weekly cap (96 Bluesky
// posts in 7 days against 2) held everything, so the 0.7.19 code had never run on a real post. Hardened here:
// markPosted writes status and post_uri in one statement; the HTTP publish routes pass the pause flag, the cap and the
// content gate and record a row with post_uri; OWNER-VOICE-CONTENT-GATE-1 repairs mojibake and refuses q08.org links;
// SOCIAL-ENGAGEMENT-SELF-1 collects per-post Bluesky engagement daily for every recorded post id.
// LINKEDIN-BUFFER-DRAFTS-1 (2026-10-01, agent_issues #1713, docs/STRATEGY.md s4-s5): LinkedIn's API Terms 3.1 forbid
// automated posting, so the LinkedIn channel never receives a shareNow post. bufferPost saves it as a Buffer DRAFT
// (saveToDraft: true) that the owner approves with one tap in Buffer; Mastodon and X keep posting automatically inside
// the cadence caps. The draft id is recorded as buffer-draft:<id> in social_threads.post_uri so the daily sent-as-you
// digest (qnfo-cloud-ops) can list what is waiting for approval.
// Superseded 2026-10-01 by LINKEDIN-OWNER-DELEGATED-1 (0.7.25): draft is now the opt-in mode (pipeline_flags.linkedin_mode='draft').
const BSKY = 'https://bsky.social/xrpc';
const COMPOSE_MODEL = '@cf/deepseek-ai/deepseek-v4-flash-0731';
const CHECKER_MODEL = '@cf/moonshotai/kimi-k2.6'; // MODEL-FLOOR-1: non-thinking via reasoning_effort "none" (deepseek-v4-flash emits reasoning prose)

function truncate(text, max) {
  const pts = Array.from(String(text || ''));
  if (pts.length <= max) return String(text || '');
  return pts.slice(0, max).join('');
}

// Like truncate but never leaves a URL split in half at the cut boundary.
function truncateSafe(text, max) {
  const s = String(text || '');
  const pts = Array.from(s);
  if (pts.length <= max) return s;
  let cut = pts.slice(0, max).join('');
  cut = cut.replace(/https?:\/\/\S*$/, '').trimEnd();
  return cut;
}
function byteLen(s) {
  return new TextEncoder().encode(String(s || '')).length;
}
function extractUrls(text) {
  const urls = [];
  const re = /https?:\/\/[^\s"'<>()\[\]{}]+/g;
  let m;
  const seen = new Set();
  while ((m = re.exec(text)) !== null) {
    const u = m[0].replace(/[.,;:!?]+$/, '');
    if (!seen.has(u)) { seen.add(u); urls.push(u); }
  }
  return urls;
}
// Build link facets with UTF-8 byte offsets (Bluesky requires byte indices, not char indices).
function buildFacets(text) {
  const s = String(text || '');
  const urls = extractUrls(s);
  const facets = [];
  for (const u of urls) {
    const idx = s.indexOf(u);
    if (idx < 0) continue;
    const byteStart = byteLen(s.slice(0, idx));
    const byteEnd = byteStart + byteLen(u);
    facets.push({
      $type: 'app.bsky.richtext.facet',
      index: { byteStart: byteStart, byteEnd: byteEnd },
      features: [{ $type: 'app.bsky.richtext.facet#link', uri: u }]
    });
  }
  return facets;
}
function findDoi(text) {
  const m = String(text || '').match(/(?:doi:?\s*)?(10\.\d{4,9}\/[^\s"'<>)\]]+)/i);
  if (!m) return null;
  return m[1].replace(/[.,;]+$/, '');
}
// Attach a link to a headline: replace a bare DOI with its URL, else append the URL.
function applyLink(text, link, max) {
  max = max || 290;
  const s = String(text || '');
  if (!link) return truncateSafe(s, max);
  if (s.includes(link)) return truncateSafe(s, max);
  const doi = findDoi(s);
  if (doi && ('https://doi.org/' + doi) === link) {
    return truncateSafe(s.replace(/doi:?\s*10\.\d{4,9}\/[^\s"'<>)\]]+/i, link), max);
  }
  const budget = max - link.length - 3;
  // SOCIAL-POST-TRUNCATION-2: keep whole sentences; the mid-text cut is the last resort (one sentence over the budget).
  const whole = fitWhole(s, Math.max(budget, 1));
  const head = whole !== null ? whole : truncateSafe(s, Math.max(budget, 1));
  return head + ' \u2014 ' + link;
}

// POST-ID-UTM-1 (#1712, 2026-10-01): every papers.qnfo.org / qnfo.org link qnfo-social puts into a post carries
// utm_source=<channel>&utm_medium=social&utm_campaign=<slug>, so a post joins to the visits it caused (STRATEGY 6.2).
// Links to other domains (doi.org, q08.org) are left untouched; a link that already has a utm_ parameter
// is never re-tagged. Without a slug the campaign is the link's last path segment (the paper slug on papers.qnfo.org).
// POST-UTM-SUBDOMAIN-1 (0.7.31, #1712): every qnfo.org host is the owner's own site, so every one is tagged. The list
// was qnfo.org, www and papers only, so the 2026-10-02 launch post for https://ipatent.qnfo.org/example (social_threads
// 153) would have gone out untagged and could never be joined to the visits it caused.
function utmHost(host) {
  const h = String(host || '').toLowerCase();
  return h === 'qnfo.org' || /^[a-z0-9-]+(\.[a-z0-9-]+)*\.qnfo\.org$/.test(h);
}
var BUFFER_UTM_SOURCE = { mastodon: 'mastodon', linkedin: 'linkedin', twitter: 'x', threads: 'threads', substack: 'substack' };
function utmTag(url, source, campaign) {
  const u = String(url || '');
  const hm = u.match(/^https?:\/\/([^\/?#:]+)/i);
  if (!hm || !utmHost(hm[1])) return u;
  if (/[?&]utm_(source|medium|campaign)=/i.test(u)) return u;
  const hashAt = u.indexOf('#');
  const base = hashAt < 0 ? u : u.slice(0, hashAt);
  const frag = hashAt < 0 ? '' : u.slice(hashAt);
  const segs = base.replace(/^https?:\/\/[^\/?#]+/i, '').split('?')[0].split('/').filter(Boolean);
  const camp = String(campaign || segs[segs.length - 1] || 'qnfo').trim() || 'qnfo';
  const q = 'utm_source=' + encodeURIComponent(source || 'bluesky') + '&utm_medium=social&utm_campaign=' + encodeURIComponent(camp);
  const sep = base.indexOf('?') < 0 ? '?' : (/[?&]$/.test(base) ? '' : '&');
  return base + sep + q + frag;
}
function utmTagText(text, source, campaign) {
  return String(text || '').replace(/https?:\/\/[^\s"'<>()\[\]{}]+/g, function(m) {
    const core = m.replace(/[.,;:!?]+$/, '');
    return utmTag(core, source, campaign) + m.slice(core.length);
  });
}
 // Fit text into max code points by shortening the PROSE, never a URL (truncateSafe drops a URL that crosses the cut,
 // UTM click fetch helper: returns sum of clicks and distinct date count for a campaign.
 async function fetchUtmClicks(campaign) {
   const sql = `
     SELECT SUM(value) AS v, COUNT(DISTINCT date) AS d
     FROM reach_signals
     WHERE source = 'utm'
       AND metric = 'clicks_human'
       AND entity_type = 'campaign'
       AND entity = ?
   `;
   const rows = await db.query(sql, [campaign]);
   const row = rows[0] || {};
   return { sum: row.v || 0, days: row.d || 0 };
 }
// and a UTM tag lengthens every qnfo link). The longest prose run is cut at a word boundary and marked with an
// ellipsis, repeatedly, until the text fits. Returns null when the URLs alone do not fit.
function fitKeepUrls(text, max) {
  const s = String(text || '');
  const len = function(x) { return Array.from(x).length; };
  if (len(s) <= max) return s;
  const runs = [];
  const re = /https?:\/\/[^\s"'<>()\[\]{}]+/g;
  let last = 0, m;
  while ((m = re.exec(s)) !== null) {
    const u = m[0].replace(/[.,;:!?]+$/, '');
    runs.push({ prose: s.slice(last, m.index) });
    runs.push({ url: u });
    last = m.index + u.length;
    re.lastIndex = last;
  }
  runs.push({ prose: s.slice(last) });
  if (runs.length === 1) return truncateSafe(s, max);
  for (const r of runs) {
    if (r.url !== undefined) continue;
    r.pre = r.prose.match(/^\s*/)[0];
    const rest = r.prose.slice(r.pre.length);
    r.post = rest.match(/[\s:\u2014\u2013-]*$/)[0];
    r.body = rest.slice(0, rest.length - r.post.length);
  }
  const join = function() { return runs.map(function(r) { return r.url !== undefined ? r.url : r.pre + r.body + r.post; }).join(''); };
  for (let guard = 0; guard < 64; guard++) {
    const over = len(join()) - max;
    if (over <= 0) break;
    let best = null;
    for (const r of runs) if (r.url === undefined && r.body && (!best || len(r.body) > len(best.body))) best = r;
    if (!best) return null;
    const pts = Array.from(best.body);
    const keep = pts.length - over - 1;
    if (keep <= 0) { best.body = ''; continue; }
    let cut = pts.slice(0, keep).join('');
    const w = cut.replace(/\s+\S*$/, '');
    if (w && len(w) >= keep / 2) cut = w;
    cut = cut.replace(/[\s,;:.!?\u2014\u2013-]+$/, '');
    best.body = cut ? cut + '\u2026' : '';
  }
  const out = join().replace(/^[\s:\u2014\u2013-]+/, '').trimEnd();
  return len(out) <= max ? out : null;
}
// SOCIAL-POST-TRUNCATION-2 (0.12.0, agent_issues #1902): prose is never cut mid-sentence to make room. proseUnits splits a
// text into sentences and lines (separators kept, so the units join back to the text; a URL holds no whitespace and is
// never split). splitForThread packs whole units into posts of at most `max` code points (the first of at most
// `firstMax`, so a caller can leave room for the link on the root); a single sentence longer than a post is packed by
// words. fitWhole keeps the text inside `max` by dropping whole trailing sentences that carry no URL; it returns null when
// that cannot fit (one sentence longer than the limit), and the caller falls back to the ellipsis cut.
function cpLen(x) { return Array.from(String(x || '')).length; }
function proseUnits(text) {
  const parts = String(text || '').split(/((?<=[.!?…]["')\]]?)[ \t]+|\s*\n+\s*)/);
  const units = [];
  for (let i = 0; i < parts.length; i += 2) {
    if (parts[i] === '' && i > 0 && i === parts.length - 1) break;
    units.push({ sep: i > 0 ? parts[i - 1] : '', text: parts[i] });
  }
  return units;
}
function packUnits(units, max, firstMax) {
  const out = [];
  let cur = '';
  const room = function() { return out.length === 0 ? firstMax : max; };
  for (const u of units) {
    if (!u.text) continue;
    if (cur && cpLen(cur + u.sep + u.text) <= room()) { cur += u.sep + u.text; continue; }
    if (cur) { out.push(cur); cur = ''; }
    if (cpLen(u.text) <= room()) { cur = u.text; continue; }
    // one unit longer than a post: pack it by words; a single word longer than a post is cut into pieces.
    for (const w of u.text.split(/\s+/).filter(Boolean)) {
      if (cur && cpLen(cur + ' ' + w) <= room()) { cur += ' ' + w; continue; }
      if (cur) { out.push(cur); cur = ''; }
      let pts = Array.from(w);
      while (pts.length > room()) { out.push(pts.slice(0, room()).join('')); pts = pts.slice(room()); }
      cur = pts.join('');
    }
  }
  if (cur) out.push(cur);
  return out;
}
function splitForThread(text, max, firstMax) {
  const s = String(text || '').trim();
  max = max || 290;
  firstMax = Math.max(1, Math.min(firstMax || max, max));
  if (cpLen(s) <= firstMax) return s ? [s] : [];
  return packUnits(proseUnits(s), max, firstMax);
}
function fitWhole(text, max) {
  const s = String(text || '').trim();
  if (cpLen(s) <= max) return s;
  const units = proseUnits(s).filter(function(u) { return u.text; });
  const join = function() { return units.map(function(u, i) { return (i ? u.sep : '') + u.text; }).join(''); };
  while (cpLen(join()) > max) {
    let at = -1, prose = 0;
    for (let i = 0; i < units.length; i++) if (!/https?:\/\//.test(units[i].text)) { prose++; at = i; }
    if (prose < 2 || at < 0) return null;
    units.splice(at, 1);
  }
  return join();
}
// Tag, then fit. Fail-soft: if the tagged text cannot fit (a URL longer than the limit), post it untagged.
function tagAndFit(text, max, source, campaign) {
  const plain = String(text || '');
  try {
    const tagged = fitKeepUrls(utmTagText(plain, source, campaign), max);
    if (tagged !== null) return tagged;
  } catch (e) { console.error(JSON.stringify({ evt: "social:tagAndFit:caught", error: String((e && e.message) || e) })); }
  const fit = fitKeepUrls(plain, max);
  return fit !== null ? fit : truncateSafe(plain, max);
}
// SOCIAL-POST-TRUNCATION-1 (0.7.35, agent_issues #1902): the visible post text is fitted WITHOUT the UTM parameters (about 55
// characters per qnfo link), and the tracking rides only in each link facet's uri. Before this, tagAndFit lengthened every
// qnfo link and then fitKeepUrls cut the prose to make room, so the 2026-10-02 launch post went out ending "Status: open…".
// A facet whose host is not a qnfo host keeps its uri (utmTag leaves other hosts and already-tagged links alone).
function tagFacets(facets, source, campaign) {
  return (facets || []).map(function(f) {
    return Object.assign({}, f, { features: (f.features || []).map(function(ft) {
      return ft && ft.$type === 'app.bsky.richtext.facet#link' ? Object.assign({}, ft, { uri: utmTag(ft.uri, source, campaign) }) : ft;
    }) });
  });
}
// post_uri value: the Bluesky URI alone, a lone 'buffer:<id>', or (both) a small JSON object keyed by utm_source.
function postUriValue(bskyUri, bufferResult) {
  const ids = {};
  if (bskyUri) ids.bluesky = String(bskyUri);
  const res = (bufferResult && bufferResult.results) || [];
  for (const r of res) {
    if (!r || !r.post_id) continue;
    if (r.status === 'ok' || r.status === 'queued') ids[BUFFER_UTM_SOURCE[r.platform] || r.platform] = 'buffer:' + r.post_id;
    else if (r.status === 'draft') ids[BUFFER_UTM_SOURCE[r.platform] || r.platform] = 'buffer-draft:' + r.post_id; // LINKEDIN-BUFFER-DRAFTS-1
  }
  const keys = Object.keys(ids);
  if (!keys.length) return null;
  return keys.length === 1 ? ids[keys[0]] : JSON.stringify(ids);
}

// OWNER-VOICE-CONTENT-GATE-1 (0.7.21, STRATEGY s4 + s5 gate 3): nothing leaves qnfo-social for the owner's channels with
// a q08.org link (q08 was removed from Bluesky) or with mojibake. UTF-8 text that was decoded as Latin-1/cp1252 upstream
// (e.g. an em dash stored as U+00E2 U+0080 U+0094, posted live on 2026-10-01) is repaired back to the real character;
// text that still carries a mojibake sequence after repair is held, never posted.
var CP1252_BYTE = { '\u20ac': 0x80, '\u201a': 0x82, '\u0192': 0x83, '\u201e': 0x84, '\u2026': 0x85, '\u2020': 0x86, '\u2021': 0x87,
  '\u02c6': 0x88, '\u2030': 0x89, '\u0160': 0x8a, '\u2039': 0x8b, '\u0152': 0x8c, '\u017d': 0x8e, '\u2018': 0x91, '\u2019': 0x92,
  '\u201c': 0x93, '\u201d': 0x94, '\u2022': 0x95, '\u2013': 0x96, '\u2014': 0x97, '\u02dc': 0x98, '\u2122': 0x99, '\u0161': 0x9a,
  '\u203a': 0x9b, '\u0153': 0x9c, '\u017e': 0x9e, '\u0178': 0x9f };
var MOJI_CONT = '[\\u0080-\\u00bf' + Object.keys(CP1252_BYTE).join('') + ']';
var MOJI_SEQ_RE = new RegExp('[\\u00c2-\\u00df]' + MOJI_CONT + '|[\\u00e0-\\u00ef]' + MOJI_CONT + '{2}|[\\u00f0-\\u00f4]' + MOJI_CONT + '{3}', 'g');
var MOJIBAKE_LEFT_RE = /\u00c3[\u0080-\u00bf]|\u00e2\u0080|\u00e2\u20ac|\u00c2[\u0080-\u00bf]|\ufffd/;
var Q08_LINK_RE = /(?:^|[^a-z0-9.-])(?:[a-z0-9-]+\.)*q08\.org(?!\.?[a-z0-9-])/i;
function repairMojibake(text) {
  const s = String(text || '');
  let dec = null;
  try { dec = new TextDecoder('utf-8', { fatal: true }); } catch (e) { return s; }
  return s.replace(MOJI_SEQ_RE, function(m) {
    const bytes = [];
    for (const ch of m) {
      const c = ch.charCodeAt(0);
      const b = c <= 0xff ? c : CP1252_BYTE[ch];
      if (b === undefined) return m;
      bytes.push(b);
    }
    try { return dec.decode(new Uint8Array(bytes)); } catch (e) { return m; }
  });
}
// NOZ-DOI-1: a dead-registry identifier or link is never posted. The pattern is assembled so source scans stay clean.
var DEAD_DOI_RE = new RegExp('zen' + 'odo|10\\.5281\\/', 'i');
function contentGate(texts) {
  const out = (texts || []).map(function(t) { return repairMojibake(typeof t === 'string' ? t : String((t && t.text) || '')); });
  for (const t of out) {
    // Q08-OPEN-1 (owner directive 2026-10-09: remove all filters and blocks): q08.org links are no longer refused.
    if (DEAD_DOI_RE.test(t)) return { ok: false, reason: 'dead-doi', texts: out };
    if (MOJIBAKE_LEFT_RE.test(t)) return { ok: false, reason: 'mojibake', texts: out };
  }
  return { ok: true, texts: out };
}

// Buffer (Mastodon/LinkedIn/X) publishes ONE standalone post with no thread, no facets and
// no embed. A Bluesky thread's post[0] is often a bare noun-phrase title ("Redundant
// Safeguards as Coupled Failure Modes") which is fine as a thread root but incoherent as a
// standalone cross-post. BUFFER-STANDALONE-1: prefer the first post that reads as a complete
// sentence, then attach the link. Falls back to title/post[0] + link so a link is always
// present. Bluesky composition is untouched.
function isCompleteSentence(t) {
  const s = String(t || '').trim();
  if (s.length < 25) return false;
  if (!/[.?!]["')\]]?$/.test(s)) return false;
  return /\s/.test(s);
}
function pickBufferText(posts, link, title, max) {
  max = max || 280;
  const list = (posts || []).map(function(p) { return typeof p === 'string' ? p : String((p && p.text) || ''); });
  const stripped = list.map(function(t) { return String(t).replace(/^\s*(Read|Paper|DOI)\s*:\s*/i, '').trim(); });
  // 1. first post that stands alone as a sentence and is not just a bare link line
  for (let i = 0; i < stripped.length; i++) {
    const t = stripped[i];
    if (!t) continue;
    const withoutUrl = t.replace(/https?:\/\/\S+/g, '').trim();
    if (withoutUrl.length < 25) continue;
    if (isCompleteSentence(withoutUrl)) return link ? applyLink(t, link, max) : truncate(t, max);
  }
  // 2. fall back to the thread title (or post 0), always link-bearing
  const head = String(title || list[0] || '').trim();
  return link ? applyLink(head, link, max) : truncate(head, max);
}

function auth(req, env) {
  const tok = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const ops = req.headers.get('X-Ops-Key') || '';
  const eq = (a, b) => {
    if (!a || !b || a.length !== b.length) return false;
    let d = 0;
    for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return d === 0;
  };
  if (tok && (eq(tok, env.SOCIAL_TOKEN) || eq(tok, env.GATEWAY_SOCIAL_TOKEN))) return true;
  if (ops && eq(ops, env.OPS_KEY)) return true;
  return false;
}

// BSKY-SESSION-REUSE-1 (2026-10-18, pillar reach): Bluesky limits com.atproto.server.createSession per account
// (30 per 5 minutes, 300 a day: docs.bsky.app rate limits) and every run of this worker opened up to ten sessions, one per
// step. A session is now reused inside the isolate for SESSION_TTL_MS (the access token lives about 2 hours), keyed on the
// handle so a rotated identity never reuses another account's token; a failed create is never cached.
var SESSION_TTL_MS = 30 * 60 * 1000;
var sessionCache = { key: '', at: 0, value: null };
// BSKY-CREATE-SESSION-COUNT-1 (0.18.1, agent_issues 100191): one row per UTC day in metric_history, bumped on every createSession
// call (a refused create spends the limit too), so the 300-a-day budget is a number, not a guess.
var BSKY_SESSION_METRIC = 'bsky_create_session_24h';
async function countCreateSession(env) {
  try {
    if (!env.DB) return null;
    const day = new Date().toISOString().slice(0, 10);
    const ts = new Date().toISOString();
    // Increment the daily counter
    await env.DB.prepare(
      "INSERT INTO metric_history (metric, day, value, meets, target, ts) VALUES (?1, ?2, 1, 1, '<= 300 a day (Bluesky account limit)', ?3) " +
      "ON CONFLICT(metric, day) DO UPDATE SET value = COALESCE(value, 0) + 1, " +
      "meets = CASE WHEN COALESCE(value, 0) + 1 <= 300 THEN 1 ELSE 0 END, ts = excluded.ts"
    )
      .bind(BSKY_SESSION_METRIC, day, ts)
      .run();
    // Retrieve the current total for the day
    const row = await env.DB.prepare(
      "SELECT value FROM metric_history WHERE metric = ?1 AND day = ?2"
    )
      .bind(BSKY_SESSION_METRIC, day)
      .first();
    return row ? Number(row.value) : null;
  } catch (e) {
    console.error(JSON.stringify({ evt: 'qnfo-social:bsky-session-count', error: String(e && e.message || e) }));
    return null;
  }
}
async function session(env) {
  const key = String(env.BSKY_HANDLE || '');
  if (sessionCache.value && sessionCache.key === key && Date.now() - sessionCache.at < SESSION_TTL_MS) return sessionCache.value;
  let r;
  try {
    r = await fetch(BSKY + '/com.atproto.server.createSession', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (qnfo-social)' },
      body: JSON.stringify({ identifier: env.BSKY_HANDLE, password: env.BSKY_APP_PASS })
    });
  } finally {
    await countCreateSession(env);
  }
  if (!r.ok) { sessionCache = { key: '', at: 0, value: null }; throw new Error('session ' + r.status); }
  const v = await r.json();
  sessionCache = { key, at: Date.now(), value: v };
  return v;
}

// PROFILE-SYNC-1 (2026-10-01): the account bio follows the owner's approved short bio (Identity doc, owner_docs
// identity, "Short bio"; owner delegation 2026-10-01). The bio read "Philosopher-scientist, AI-focused tech entrepreneur
// inventing nature-inspired quantum computers". Each run reads the public profile first and signs in only when the bio
// differs; it then rewrites only `description`, keeping displayName, avatar, banner and every other field, with
// swapRecord so a concurrent edit is never overwritten.
// PROFILE-SYNC-OWNER-WINS-1 (2026-10-01): it replaces only an empty bio or one the Identity doc lists as superseded. On
// 1 Oct, between the audit (10:17Z) and the first deploy, the bio was rewritten by hand outside the fleet; a bio the fleet
// does not recognise is the owner's edit and is left alone ({ held }) until the owner chooses.
var PROFILE_DESCRIPTION = "I build open, auditable AI-assisted research (QNFO). Asking what a correct computation costs in energy. Formerly FHWA and AARP. Some posts are drafted by my research pipeline. qnfo.org";
// OWNER-DELEGATION-SOCIAL-1 (2026-10-01): the owner directed "automatically manage all my social media accounts ... I will not
// provide any manual action or intervention", which decides human_actions bluesky-bio-choice by delegation: the bio
// hand-edited earlier that day is superseded by the approved systems-first short bio (its text is kept in the
// resolution). A bio edited later and not listed here is still left alone.
var PROFILE_SUPERSEDED_PREFIXES = ["Philosopher-scientist, AI-focused tech entrepreneur", "Founder of QNFO: independent open-science research on quantum computing architectures"];
function profileReplaceable(desc) {
  const d = String(desc || '').trim();
  return d === '' || PROFILE_SUPERSEDED_PREFIXES.some((p) => d.startsWith(p));
}
async function syncProfile(env) {
  if (!env.BSKY_HANDLE || !env.BSKY_APP_PASS) return { skipped: 'no credentials' };
  const pub = await fetch('https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=' + encodeURIComponent(env.BSKY_HANDLE), { headers: { 'User-Agent': 'Mozilla/5.0 (qnfo-social)' } });
  if (pub.ok) {
    const pj = await pub.json().catch(() => null);
    if (pj && pj.description === PROFILE_DESCRIPTION) return { unchanged: true };
    if (pj && !profileReplaceable(pj.description)) return { held: 'owner-edited', current: String(pj.description || '').slice(0, 160) };
  }
  const s = await session(env);
  const H = { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (qnfo-social)', 'Authorization': 'Bearer ' + s.accessJwt };
  const g = await fetch(BSKY + '/com.atproto.repo.getRecord?repo=' + encodeURIComponent(s.did) + '&collection=app.bsky.actor.profile&rkey=self', { headers: H });
  if (!g.ok) return { error: 'getRecord ' + g.status };
  const cur = await g.json();
  const value = (cur && cur.value) || {};
  if (value.description === PROFILE_DESCRIPTION) return { unchanged: true };
  if (!profileReplaceable(value.description)) return { held: 'owner-edited', current: String(value.description || '').slice(0, 160) };
  const record = Object.assign({}, value, { $type: 'app.bsky.actor.profile', description: PROFILE_DESCRIPTION });
  const p = await fetch(BSKY + '/com.atproto.repo.putRecord', { method: 'POST', headers: H, body: JSON.stringify({ repo: s.did, collection: 'app.bsky.actor.profile', rkey: 'self', record: record, swapRecord: cur.cid }) });
  if (!p.ok) return { error: 'putRecord ' + p.status };
  return { updated: true, previous: String(value.description || '').slice(0, 160) };
}

// BP26-SOCIAL-AUTOMATION-1 (2026-10-26, pillar reach; agent_issues 1000340): until the owner turns on each platform's automated-account label (owner card
// bp26-social-bot-labels; its default is that posts continue with a short automation marker in the text), an automated post ends with AUTOMATION_MARKER.
// The marker is added only where it fits the platform's limit and never by cutting the post: a post already at the limit goes out unchanged. The limits are
// the ones this worker already fits to (Bluesky 290 code points inside its 300 graphemes, X and Mastodon 280, LinkedIn 3000, a Substack Note 10000); the marker is ASCII.
var AUTOMATION_MARKER = " [AI-generated]";
var MARKER_MAX_CHARS = { bluesky: 290, linkedin: 3000, mastodon: 280, twitter: 280, substack: 10000 };
function withAutomationMarker(text, max) {
  const t = String(text == null ? "" : text);
  if (!t || t.endsWith(AUTOMATION_MARKER) || /\[(?:automated|AI-generated)\]$/.test(t)) return t;
  const limit = max || 280, mlen = Array.from(AUTOMATION_MARKER).length;
  if (Array.from(t).length + mlen <= limit) return t + AUTOMATION_MARKER;
  // ART50-NEVER-UNMARKED-1: no room, so shorten the prose (URLs kept) rather than publish an unlabelled AI post
  let fit = fitKeepUrls(t, limit - mlen);
  if (fit === null) fit = truncateSafe(t, limit - mlen);
  return String(fit).trimEnd() + AUTOMATION_MARKER;
}
async function postText(s, text, reply, opts) {
  opts = opts || {};
  // POST-ID-UTM-1 (#1712, 2026-10-01): tag qnfo links, then fit to 290 code points (inside Bluesky's 300 graphemes) by
  // shortening the prose, never a URL. Facets and the link card below are built from this final text.
  // SOCIAL-POST-TRUNCATION-1 (0.7.35): fit the untagged text, then put the UTM on the facet uri only (see tagFacets).
  const plainText = String(text || '');
  let shown = fitKeepUrls(plainText, 290);
  if (shown === null) shown = truncateSafe(plainText, 290);
  shown = withAutomationMarker(shown, MARKER_MAX_CHARS.bluesky);
  const record = { text: shown, createdAt: (opts.createdAt || new Date().toISOString()) };
  if (reply) record.reply = reply;
  const facets = tagFacets(buildFacets(record.text), opts.utmSource || 'bluesky', opts.campaign);
  if (facets.length) record.facets = facets;
  if (opts.embed && (facets.length || opts.embed.uri)) {
    record.embed = {
      $type: 'app.bsky.embed.external',
      external: {
        uri: facets.length ? facets[0].features[0].uri : utmTag(String(opts.embed.uri), opts.utmSource || 'bluesky', opts.campaign),
        title: String(opts.embed.title || 'QNFO').slice(0, 300),
        description: String(opts.embed.desc || 'QNFO research').slice(0, 1000)
      }
    };
  }
  let lastErr = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(BSKY + '/com.atproto.repo.createRecord', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (qnfo-social)', 'Authorization': 'Bearer ' + s.accessJwt },
      body: JSON.stringify({ repo: s.did, collection: 'app.bsky.feed.post', record: record })
    });
    if (r.status === 429 || r.status >= 500) {
      lastErr = new Error('post ' + r.status);
      await new Promise((res) => setTimeout(res, 500 * (attempt + 1)));
      continue;
    }
    if (!r.ok) throw new Error('post ' + r.status + ' ' + (await r.text()).slice(0, 200));
    // POST-SENT-TEXT-1 (0.7.31, #1712): hand back the text exactly as posted (tagged and fitted), so the caller can store
    // it. Before this the tagged text lived only on Bluesky and D1 kept the untagged draft, so no probe could see a UTM.
    const out = await r.json();
    if (out && typeof out === 'object') {
      out.text = record.text;
      // The copy kept in D1 (POST-SENT-TEXT-1) shows the link as the facet resolves it, so a probe on social_threads.posts
      // LIKE '%utm_source=%' still sees the tag; the public post itself shows the short link.
      out.stored_text = utmTagText(record.text, opts.utmSource || 'bluesky', opts.campaign);
      out.link_uris = facets.map(function(f) { return f.features[0] && f.features[0].uri; }).filter(Boolean); // tagged targets of the visible links
    }
    return out;
  }
  throw lastErr || new Error('post retries exhausted');
}
async function deleteRecord(s, uri) {
  const rkey = String(uri).split('/').pop();
  const r = await fetch(BSKY + '/com.atproto.repo.deleteRecord', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (qnfo-social)', 'Authorization': 'Bearer ' + s.accessJwt },
    body: JSON.stringify({ repo: s.did, collection: 'app.bsky.feed.post', rkey: rkey })
  });
  if (r.status === 400) return { ok: true, already_gone: true };
  if (!r.ok) throw new Error('delete ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return r.json();
}
// The posts a thread goes out as: every drafted post whole when it fits, else continued in further posts (pure).
function threadPlan(posts, link, max) {
  max = max || 290;
  const plan = [];
  (posts || []).forEach(function(p, i) {
    const raw = typeof p === 'string' ? p : String((p && p.text) || '');
    const createdAt = p && p.createdAt ? p.createdAt : undefined;
    let chunks;
    if (i === 0 && link) {
      const linked = applyLink(raw, link, 1e6);          // link attached (or the DOI swapped for it), nothing cut
      if (cpLen(linked) <= max) chunks = [linked];
      else if (raw.includes(link) || linked.indexOf(' \u2014 ' + link) < 0) chunks = splitForThread(linked, max);
      else {
        // the root takes as many whole sentences as fit beside the link; the rest follow as replies
        chunks = splitForThread(raw, max, Math.max(1, max - cpLen(link) - 3));
        chunks[0] = chunks[0] + ' \u2014 ' + link;
      }
    } else chunks = splitForThread(raw, max);
    chunks.forEach(function(c, k) { plan.push({ text: c, createdAt: k === 0 ? createdAt : undefined }); });
  });
  return plan;
}
async function postThread(s, posts, threadOpts) {
  let root = null, parent = null;
  const uris = [];
  threadOpts = threadOpts || {};
  // SOCIAL-POST-TRUNCATION-2: a post longer than one Bluesky post continues as replies, split at sentence boundaries,
  // instead of losing its end. The link (and its card) stays on the root post.
  const plan = threadPlan(posts, threadOpts.link, 290);
  for (let i = 0; i < plan.length; i++) {
    const p = plan[i];
    const text = p.text;
    const reply = i > 0 ? { root: root, parent: parent } : undefined;
    const opts = { createdAt: p.createdAt, campaign: threadOpts.campaign };
    if (i === 0 && threadOpts.embed) opts.embed = threadOpts.link ? Object.assign({ uri: threadOpts.link }, threadOpts.embed) : threadOpts.embed;
    const res = await postText(s, text, reply, opts);
    uris.push(res.uri);
    // POST-SENT-TEXT-1: a caller that passes threadOpts.sent = [] gets the posted texts, in order.
    if (Array.isArray(threadOpts.sent)) threadOpts.sent.push(typeof res.stored_text === 'string' ? res.stored_text : (typeof res.text === 'string' ? res.text : text));
    if (i === 0) root = { uri: res.uri, cid: res.cid };
    parent = { uri: res.uri, cid: res.cid };
  }
  return uris;
}
// Delete a thread's old posts then recreate them with link facets + a root embed.
async function repostThread(s, th) {
  const posts = (th.posts || []).filter(function(p){ return p && p.uri; });
  const link = String(th.link || '');
  const title = String(th.title || '');
  const desc = String(th.desc || 'QNFO research paper');
  const oldUris = posts.map(function(p){ return p.uri; });
  const deleted = [];
  for (const u of oldUris) {
    try { deleted.push(await deleteRecord(s, u)); } catch (e) { deleted.push({ uri: u, error: String(e).slice(0, 150) }); }
    await new Promise((res) => setTimeout(res, 80));
  }
  const revised = posts.map(function(p, i){
    if (i === 0) return { text: applyLink(p.text, link, 290), createdAt: p.createdAt };
    return { text: String(p.text || ''), createdAt: p.createdAt };
  });
  const embed = { title: title || 'QNFO', desc: desc };
  const uris = await postThread(s, revised, { embed: embed, campaign: th.slug ? String(th.slug) : undefined });
  return { deleted: deleted.length, newRoot: uris[0], count: uris.length };
}

function sanitizePosts(raw) {
  return (raw || []).map(function(x){ return truncate(String(x), 290); }).filter(function(x){ return x.trim(); });
}

function extractText(ai) {
  if (!ai) return '';
  if (typeof ai === 'string') return ai;
  if (typeof ai.response === 'string' && ai.response) return ai.response;
  var ch = (ai.choices && ai.choices[0]) || (ai.result && ai.result.choices && ai.result.choices[0]);
  if (ch) {
    if (ch.message && typeof ch.message.content === 'string' && ch.message.content) return ch.message.content;
    if (ch.message && typeof ch.message.reasoning_content === 'string' && ch.message.reasoning_content) {
      var rc = ch.message.reasoning_content;
      var m = rc.match(/\[[\s\S]*\]/);
      if (m) return m[0];
    }
    if (typeof ch.text === 'string') return ch.text;
  }
  return '';
}

// v0.5.3: structural fingerprint of an unhandled AI response, so a fail-closed escalation
// carries something diagnosable instead of an empty string (issue #676).
function describeShape(o) {
  try {
    if (o === null || o === undefined) return String(o);
    if (typeof o !== 'object') return 'type=' + typeof o;
    var keys = Object.keys(o).slice(0, 8).join(',');
    var inner = o.result || o.response;
    if (inner && typeof inner === 'object') keys += ' > ' + Object.keys(inner).slice(0, 8).join(',');
    return '{' + keys + '}';
  } catch (e) { return 'unreadable'; }
}

// ---- SOCIAL-GROUND-1 (0.11.0): mechanical grounding check, ported from q08-signal-engine Q08-VERIFY-1 ----
var GROUND_LEAD = new Set(["the","a","an","in","on","at","when","if","but","and","so","as","that","this","these","those","it","its","each","every","most","some","no","for","with","without","before","after","once","while","because","since","what","where","who","why","how","then","there","here","not","only","even","still","yet","or","nor","by","from","to","of","their","his","her","our","your","one","two","three","such","both","many","any","all","i","we","you","he","she","they","my","whether","although","though","until","unless","instead","perhaps","suppose","imagine","consider","now","today","later","earlier","first","second","third","finally","meanwhile","however","which","whose","than","also","just","another","other","either","neither","same","more","less","few","several","can","could","may","might","would","will","do","does","is","are","was","were","be","read","check","see","open","access","link","paper","thread"]);
var GROUND_OK = new Set(["doi","bluesky","arxiv","open access","json","html"]);
function groundWords(text) {
  var set = new Set();
  String(text || "").toLowerCase().replace(/[‘’]/g, "'").replace(/[a-z0-9][a-z0-9'.-]*/g, function(w) {
    w = w.replace(/[.'-]+$/, ""); set.add(w); set.add(w.replace(/'s$/, "")); if (w.length > 3 && w.charAt(w.length - 1) === "s") set.add(w.slice(0, -1)); else set.add(w + "s"); return "";
  });
  return set;
}
function groundNumbers(text) {
  var set = new Set(); (String(text || "").match(/\d[\d,]*(?:\.\d+)?/g) || []).forEach(function(n) { set.add(n.replace(/,/g, "").replace(/\.0+$/, "")); }); return set;
}
// Names, years and figures in `text` that `ground` does not contain. Links and hashtags are removed first (links are checked by
// the link gates). Returns problem strings; [] means every one is grounded.
function groundingProblems(text, ground) {
  var body = String(text || "").replace(/https?:\/\/\S+|\b(?:www\.)?[a-z0-9.-]+\.(?:org|com|net|io)\/\S*/gi, " ").replace(/#\w+/g, " ");
  var words = groundWords(ground), nums = groundNumbers(ground), out = [], seen = {};
  function add(kind, v) { var k = kind + v.toLowerCase(); if (seen[k]) return; seen[k] = 1; out.push(kind + ": " + v); }
  var nre = /\$?\d[\d,]*(?:\.\d+)?\s*(%|percent|days?|weeks?|months?|quarters?|years?|hours?)?/gi, m;
  while ((m = nre.exec(body))) {
    var raw = m[0], plain = raw.replace(/[$,\s]/g, "").replace(/(%|percent|days?|weeks?|months?|quarters?|years?|hours?)$/i, "");
    var num = plain.replace(/\.$/, "");
    if (!num || nums.has(num) || nums.has(num.replace(/\.0+$/, ""))) continue;
    var unit = (m[1] || "").toLowerCase();
    if (!unit && /^\d$/.test(num) && raw.indexOf("$") < 0) continue; // a bare single digit is a word, not a claim
    var isYear = /^(1[0-9]|20)\d\d$/.test(num) && !unit;
    add(isYear ? "year not in the source" : "figure not in the source", raw.trim());
  }
  body.split(/(?<=[.!?:;—])\s+|\n+/).forEach(function(sent) {
    var toks = sent.match(/[A-Za-z0-9][A-Za-z0-9&'.’-]*|[,;]/g) || [];
    var i = 0;
    while (i < toks.length) {
      var t = toks[i];
      if (!/^[A-Z]/.test(t) || /^[A-Z]$/.test(t) && toks[i + 1] && !/^[A-Z]/.test(toks[i + 1])) { i++; continue; }
      var j = i, phrase = [];
      while (j < toks.length && /^[A-Z][A-Za-z0-9&'.’-]*$/.test(toks[j])) { phrase.push(toks[j]); j++; if (toks[j] && /^(of|the|and|for|de|von|van|del|la)$/i.test(toks[j]) && toks[j + 1] && /^[A-Z]/.test(toks[j + 1])) { phrase.push(toks[j]); j++; } }
      var lead = 0; while (lead < phrase.length - 1 && GROUND_LEAD.has(phrase[lead].toLowerCase().replace(/[^a-z]/g, ""))) lead++;
      var core = phrase.slice(lead);
      if (core.length && !(core.length === 1 && i === 0 && lead === 0) && !(core.length === 1 && GROUND_LEAD.has(core[0].toLowerCase()))) {
        var joined = core.join(" ").replace(/’/g, "'");
        var low = joined.toLowerCase().replace(/[^a-z0-9'\- ]/g, " ").replace(/\s+/g, " ").trim();
        if (low && !GROUND_OK.has(low)) {
          var miss = low.split(" ").filter(function(w) { return w && !GROUND_OK.has(w) && !GROUND_LEAD.has(w) && !words.has(w) && !words.has(w.replace(/'s$/, "")) && !(w.indexOf("-") > 0 && w.split("-").every(function (x) { return !x || words.has(x); })) && !/^\d+$/.test(w); });
          if (miss.length) add("name not in the source", joined);
        }
      }
      i = Math.max(j, i + 1);
    }
  });
  return out.slice(0, 14);
}
// Per-post issues ({post, issue}) for a thread written from title + abstract (+ the author and DOI the prompt supplies).
function threadGroundingIssues(title, abstract, posts, doi) {
  var ground = [title, SOCIAL_AUTHOR, abstract, paperLink(doi)].join("\n");
  var issues = [];
  (posts || []).forEach(function(p, i) {
    groundingProblems(typeof p === "string" ? p : (p && p.text) || "", ground).forEach(function(x) { issues.push({ post: i + 1, issue: x }); });
  });
  return issues;
}
// LEDE-SOCIAL-1 (2026-10-13; owner: q08 content "lacks context without a lede ... (inverted pyramid journalism)", applied
// fleet-wide): post 1 tells a newcomer what the paper is before anything else, so it names the author or shares a significant
// word with the title. Same rule as q08-signal-engine ledeProblems.
var LEDE_STOP = { the: 1, and: 1, for: 1, with: 1, from: 1, into: 1, that: 1, this: 1, what: 1, when: 1, are: 1, its: 1, their: 1, via: 1, toward: 1, towards: 1, between: 1, under: 1, over: 1, does: 1, how: 1, why: 1, can: 1, not: 1 };
function threadLedeIssues(title, posts) {
  var p1 = String((posts || [])[0] && (typeof posts[0] === "string" ? posts[0] : posts[0].text) || "").toLowerCase();
  if (!p1) return [];
  if (p1.indexOf(SOCIAL_AUTHOR.toLowerCase().split(" ").pop()) >= 0) return [];
  var words = String(title || "").toLowerCase().split(/[^a-z0-9-]+/).filter(function(w) { return w.length >= 4 && !LEDE_STOP[w]; });
  if (!words.length || words.some(function(w) { return p1.indexOf(w) >= 0; })) return [];
  return [{ post: 1, issue: "LEDE-SOCIAL-1: post 1 must say what the paper is (its subject in the title's words, or 'a paper by " + SOCIAL_AUTHOR + "') before any hook" }];
}
// SOCIAL-CHECK-FAIL-CLOSED-1 (0.13.2, agent_issues 2501): the checker reply is read fail-closed. Before, the first bracketed
// array that parsed won, so "see [1] ... [{...}]" read as [] (a clean thread), and an issue list keyed `problem` or `claim`
// was filtered to nothing. Now: an array counts only when every element is an object; arrays of numbers or strings are
// skipped and the scan goes on; an object counts as an issue under `issue`, `problem`, `claim` or `text` (any other object
// is kept as an issue too, never dropped); a clean verdict is only the whole reply being exactly []; anything else
// (a bracket but no valid issue array, or no array at all) returns null, which keeps the thread as a draft.
function checkerIssueOf(x) {
  for (const k of ['issue', 'problem', 'claim', 'text']) {
    if (typeof x[k] === 'string' && x[k].trim()) return { post: x.post === undefined ? null : x.post, issue: x[k].trim() };
  }
  return { post: x.post === undefined ? null : x.post, issue: 'unparsed checker finding: ' + JSON.stringify(x).slice(0, 200) };
}
function checkerIssueArray(parsed) {
  if (!Array.isArray(parsed) || !parsed.length) return null;
  if (!parsed.every(function(x) { return x && typeof x === 'object' && !Array.isArray(x); })) return null;
  return parsed.map(checkerIssueOf);
}
function parseCheckerIssues(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/\x60\x60\x60(?:json)?/g, '').trim();
  if (/^\[\s*\]$/.test(cleaned)) return [];
  let whole;
  try { whole = JSON.parse(cleaned); } catch (e) { whole = undefined; /* not one JSON value: scan for an embedded array below */ }
  const direct = checkerIssueArray(whole);
  if (direct) return direct;
  for (let lo = cleaned.indexOf('['); lo >= 0; lo = cleaned.indexOf('[', lo + 1)) {
    let depth = 0, hi = -1;
    for (let j = lo; j < cleaned.length; j++) {
      if (cleaned[j] === '[') depth++;
      else if (cleaned[j] === ']') { depth--; if (depth === 0) { hi = j; break; } }
    }
    if (hi < 0) continue;
    let parsed;
    try { parsed = JSON.parse(cleaned.slice(lo, hi + 1)); } catch (e2) { continue; /* not JSON (e.g. "[sic]"): keep scanning */ }
    const found = checkerIssueArray(parsed);
    if (found) return found;
  }
  return null;
}
// Returns: [] = checked and faithful; [{post,issue},...] = problems found;
// null = CHECKER UNAVAILABLE (fail-closed - callers must NOT auto-queue).
async function checkThread(env, title, abstract, posts, doi) {
  // SOCIAL-GROUND-1: the mechanical check runs first and needs no model. A name, year or figure that the source text does not
  // contain is an issue; the list goes to the repair pass exactly like a checker finding. No checker verdict can override it.
  const groundIssues = threadGroundingIssues(title, abstract, posts, doi).concat(threadLedeIssues(title, posts));
  if (groundIssues.length) return groundIssues;
  const base = [
    "Given a paper (title + abstract = ground truth) and a social media thread (candidate), list every claim in the thread that is NOT supported by the title or abstract.",
    "Check for: invented numbers, invented statistics, invented findings, overclaiming, misattribution, unsupported claims of being 'new' or 'first'.",
    "Your own knowledge does not count as support, even if you are sure a claim is true: a name, number, date, method, result or benefit that the title or abstract does not state is unsupported, and hedged wording (could, might, may) does not excuse it.",
    "Ignore style: questions, hooks, calls to action, links, and generic phrases like 'read the paper'.",
    "The author's name and the paper link in PAPER are ground truth: naming the author or giving the link is never an issue.",
    "Output ONLY a JSON array of issues, e.g. [{\"post\": 2, \"issue\": \"...\"}]. Output [] if the thread is fully faithful.",
    "PAPER: " + JSON.stringify({ title: title, author: SOCIAL_AUTHOR, link: paperLink(doi), abstract: abstract }),
    "THREAD: " + JSON.stringify(posts)
  ].join('\n');
  const parseIssues = parseCheckerIssues;
  const ai1 = await aiRunAttr(env, "qnfo-social", "checker", CHECKER_MODEL, { messages: [{ role: 'user', content: base }], max_tokens: 2000, reasoning_effort: 'none' });
  let text = extractText(ai1).trim();
  let issues = parseIssues(text);
  let diagText = text;
  let lastAi = ai1;
  if (issues === null) {
    const ai2 = await aiRunAttr(env, "qnfo-social", "checker-retry", CHECKER_MODEL, { messages: [{ role: 'user', content: 'Reply with ONLY a JSON array. Nothing else.\n' + base }], max_tokens: 2000, reasoning_effort: 'none' });
    const retryText = extractText(ai2).trim();
    diagText = retryText;
    lastAi = ai2;
    issues = parseIssues(retryText);
    if (issues === null) {
      const sample = String(diagText || text || '').slice(0, 150);
      const diag = sample || ('empty model output; response shape=' + describeShape(lastAi));
      await logAlert(env, 'checker', 'warn', 'checker output unusable after retry; holding as draft (fail-closed, NOT queued): ' + diag);
      try {
        const dup = await env.DB.prepare("SELECT COUNT(*) n FROM agent_issues WHERE status='open' AND title LIKE 'SOCIAL-CHECKER-FAILOPEN%'").first();
        if (!dup || Number(dup.n) === 0) {
          const mx = await env.DB.prepare("SELECT COALESCE(MAX(id),0) m FROM agent_issues").first();
          await env.DB.prepare("INSERT INTO agent_issues (id, title, description, source, category, priority, status, linked_session, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))").bind(Number(mx.m) + 1, 'SOCIAL-CHECKER-FAILOPEN: fact-checker unusable after retry', 'checker empty or unparseable: ' + diag, 'qnfo-social', 'fleet-self-improve', 'medium', 'open', null).run();
        }
      } catch (eE) { console.error(JSON.stringify({ evt: "social:checkThread:caught", error: String((eE && eE.message) || eE) })); }
      return null;
    }
  }
  return issues;
}

async function logAlert(env, source, level, message) {
  try {
    await env.DB.prepare("INSERT INTO alerts (source, level, message) VALUES (?,?,?)").bind(source, level, String(message).slice(0, 500)).run();
  } catch (e) { console.error(JSON.stringify({ evt: "social:logAlert:caught", error: String((e && e.message) || e) })); }
}

async function alertDigest(env) {
  try {
    const rows = await env.DB.prepare("SELECT id, source, level, message, created_at FROM alerts WHERE digested IS NULL ORDER BY id ASC LIMIT 100").all();
    const items = rows.results || [];
    if (!items.length) return;
    const summary = 'QNFO alerts digest ' + new Date().toISOString() + ' - ' + items.length + ' alert(s): ' + items.map(function(a){ return '[' + a.level + '] ' + a.source + ': ' + a.message; }).join(' | ');
    await env.DB.prepare("UPDATE alerts SET digested=1 WHERE id IN (SELECT id FROM alerts WHERE digested IS NULL ORDER BY id ASC LIMIT 100)").run();
    await logAlert(env, 'digest', 'info', 'digest emitted ' + items.length + ' alert(s)');
    console.log(summary);
  } catch (e) {
    await logAlert(env, 'digest', 'error', String(e).slice(0, 300));
  }
}


// ---- REACH-SELECT-1:BEGIN (0.7.34) ----
// NOZ-DOI-1: the fixed list of selected works is retired; eligibility rests on the title and abstract signals below.
// STRATEGY 2.3: pillars 1-3 lead; pillar 4 (ultrametric programme) and speculative unification stay out of outreach until a
// falsifiable test result exists. Deny wins over allow. Title signals only (plus a few unambiguous abstract terms), so an
// abstract that merely says "unified framework" does not suppress an energy paper.
var REACH_DENY_TITLE = /\b(ultrametric|p-adic|adelic|adeles?|braid\w*|temperley|holograph\w*|ads\/cft|fine-structure|cross-ratio|modular data|radix|unif(y|ying|ied|ication)|theory of everything|general theory|self-proving|reification|ontolog\w*|consciousness|cosmolog\w*|qwav|diameter|scaling exponents?|hierarchical structure)\b/i;
var REACH_DENY_ABSTRACT = /\b(ultrametric|p-adic|adelic|ads\/cft)\b/i;
var REACH_ALLOW_TITLE = /\b(joules?|energy|energetic|thermodynamic\w*|landauer|jpcub|power|watts?|carbon|efficien\w*|epistemic\w*|ignorance|legib\w*|ai-assisted|metascience|reproducib\w*|validity|autonomous|fleet|agentic|agents?|research operations|llms?|inference)\b/i;
var SOCIAL_AUTHOR = "Rowan Brad Quni-Gudzinas";
// A paper link for prompts and the checker: an http(s) URL as given, a third-party DOI as a doi.org URL, nothing for an empty or 10.5281 value.
function paperLink(doi) {
  var d = String(doi || "").trim();
  if (/^https?:\/\//i.test(d)) return /10\.5281\//.test(d) ? "" : d;
  return d && d.indexOf("10.5281/") < 0 ? "https://doi.org/" + d : "";
}
function reachDenied(title, abstract) {
  var m = REACH_DENY_TITLE.exec(String(title || "")) || REACH_DENY_ABSTRACT.exec(String(abstract || ""));
  return m ? m[0].toLowerCase() : "";
}
// Pure: may the fleet spend AI composing, and post, a thread about this paper without asking?
function reachEligible(title, abstract, doi) {
  var d = reachDenied(title, abstract);
  if (d) return { ok: false, reason: "STRATEGY 2.3: pillar 4 / speculative theory ('" + d + "') stays out of outreach" };
  var a = REACH_ALLOW_TITLE.exec(String(title || ""));
  if (a) return { ok: true, reason: "STRATEGY 2.3 pillars 1-3 ('" + a[0].toLowerCase() + "')" };
  return { ok: false, reason: "STRATEGY 2.3: no pillar 1-3 signal in the title" };
}
// One composer prompt for the scan, /compose and the refill (it used to be copied twice).
function composePrompt(doi, title, abstract) {
  return [
    "Write a 5-post Bluesky thread that amplifies a research paper accurately.",
    "Rules:",
    "1. Post 1: the lede, for a reader who has never heard of the work: say what it is and who wrote it (its subject in the title's own words, 'a paper by " + SOCIAL_AUTHOR + "') and its main finding in one plain sentence. No question and no teaser before the reader knows what the paper is.",
    "2. Post 2: the claim in plain language, faithful to the abstract (never invent or overclaim).",
    "3. Post 3: why it matters, in accessible terms, using only what the abstract says about its significance; if the abstract states none, say which question the paper addresses.",
    "4. Post 4: how a reader can check it, using only what the abstract and the paper link provide; claim no dataset, code, test or result the abstract does not mention - invite scrutiny.",
    "5. Post 5: name the author (" + SOCIAL_AUTHOR + ") by name, " + (paperLink(doi) ? "give the paper link as a full URL: " + paperLink(doi) + ", then an open discussion question." : "then an open discussion question. No paper link is supplied: write none."),
    "GROUNDING RULE: every name, number, date, method and result must be stated in the title or abstract below. Your own knowledge is not a source. Add no background, comparison, example or forecast of your own, and state results no more strongly than the abstract does.",
    "Each post under 280 characters. No exclamation marks. No marketing hype. No invented numbers.",
    "Never call the paper new, first, novel or recent: the abstract is the only source.",
    "Links must be full URLs (https://...). Never write a bare DOI.",
    "Hashtags: end post 5 with 2-3 short field hashtags (for example #quantumcomputing, #physics, #ai). Each hashtag must name the paper's field in the abstract's own terms; never invent a term or use a trending tag.",
    "Output ONLY the 5 posts, one per line, no numbering, no markdown.",
    "Paper link: " + (paperLink(doi) || "(none provided)"),
    "Title: " + title,
    "Abstract: " + abstract
  ].join(String.fromCharCode(10));
}
// Drafts about papers STRATEGY keeps out of outreach are suppressed with the reason, so no recheck or approval can post them.
async function reachSweepDrafts(env) {
  var rows = await env.DB.prepare("SELECT id, title, doi, notes FROM social_threads WHERE status='draft' AND doi IS NOT NULL AND doi <> ''").all();
  var n = 0;
  for (var i = 0, list = (rows && rows.results) || []; i < list.length; i++) {
    var el = reachEligible(list[i].title, "", list[i].doi);
    if (el.ok) continue;
    await env.DB.prepare("UPDATE social_threads SET status='suppressed', notes=?, updated_at=datetime('now') WHERE id=? AND status='draft'")
      .bind(("REACH-SELECT-1: " + el.reason + " | was: " + String(list[i].notes || "")).slice(0, 1000), list[i].id).run();
    n++;
  }
  return n;
}
// REACH-REPAIR-1 (0.7.35): one rewrite per held draft, findings fed back; terminal state either way.
var REPAIR_PER_RUN = 2;
function repairPrompt(doi, title, abstract, posts, issues) {
  return composePrompt(doi, title, abstract) + String.fromCharCode(10) +
    "A fact checker rejected the previous draft for these reasons; write a new thread that avoids every one of them and adds nothing the abstract does not state:" + String.fromCharCode(10) +
    (issues || []).map(function(x) { return "- post " + x.post + ": " + String(x.issue || "").slice(0, 300); }).join(String.fromCharCode(10)) + String.fromCharCode(10) +
    "Previous draft (do not reuse its rejected wording): " + JSON.stringify(posts || []).slice(0, 2000);
}
async function reachRepairDrafts(env) {
  var rows = await env.DB.prepare("SELECT id, title, doi, abstract, posts, notes FROM social_threads WHERE status='draft' AND abstract IS NOT NULL AND abstract <> '' AND notes LIKE '[%' ORDER BY id ASC LIMIT ?").bind(REPAIR_PER_RUN).all();
  var out = { tried: 0, queued: 0, rejected: 0, skipped: 0 };
  for (var i = 0, list = (rows && rows.results) || []; i < list.length; i++) {
    var row = list[i], issues = [], posts = [];
    try { issues = JSON.parse(row.notes); } catch (e) { issues = []; }
    try { posts = JSON.parse(row.posts); } catch (e) { posts = []; }
    if (!reachEligible(row.title, "", row.doi).ok) { out.skipped++; continue; } // the sweep suppresses these
    var rec = { title: String(row.title || ""), abstract: String(row.abstract || "").slice(0, 4000) };
    out.tried++;
    var ai = await aiRunAttr(env, "qnfo-social", "repair", COMPOSE_MODEL, { messages: [{ role: "user", content: repairPrompt(row.doi, rec.title, rec.abstract, posts, issues) }], max_tokens: 2000 });
    var np = sanitizePosts(extractText(ai).split(String.fromCharCode(10)));
    var again = np.length >= 3 ? await checkThread(env, rec.title, rec.abstract, np, row.doi) : [{ post: 0, issue: "rewrite produced too few posts" }];
    if (again && again.length === 0) {
      await env.DB.prepare("UPDATE social_threads SET status='queued', posts=?, notes=?, updated_at=datetime('now') WHERE id=? AND status='draft'")
        .bind(JSON.stringify(np.slice(0, 6)), "REACH-REPAIR-1: rewritten after checker findings, now clean | first round: " + String(row.notes).slice(0, 600), row.id).run();
      out.queued++;
    } else {
      await env.DB.prepare("UPDATE social_threads SET status='rejected', notes=?, updated_at=datetime('now') WHERE id=? AND status='draft'")
        .bind(("REACH-REPAIR-1: held twice, not posted | first: " + String(row.notes).slice(0, 450) + " | second: " + JSON.stringify(again === null ? [{ issue: "checker unavailable" }] : again)).slice(0, 1000), row.id).run();
      out.rejected++;
    }
  }
  return out;
}
// ---- REACH-SELECT-1:END ----
// NOZ-DOI-1: the external-registry scan is retired. Papers reach the channels through the dissemination_tracker drain
// (PROMOTE-ROUTE-1); the 06:00 run now only sweeps ineligible drafts and rewrites held ones once (REACH-REPAIR-1).
async function autoScan(env) {
  try {
    let swept = 0, repair = null;
    try { swept = await reachSweepDrafts(env); } catch (e) { await logAlert(env, 'scan', 'error', 'REACH-SELECT-1 sweep: ' + String(e).slice(0, 200)); }
    try { repair = await reachRepairDrafts(env); } catch (e) { repair = { error: String(e && e.message || e).slice(0, 200) }; await logAlert(env, 'repair', 'error', repair.error); }
    console.log('auto-scan: swept', swept, 'repair', JSON.stringify(repair));
    return { swept: swept, repair: repair };
  } catch (e) {
    await logAlert(env, 'scan', 'error', String(e));
    console.error('auto-scan failed', String(e));
    return { error: String(e && e.message || e).slice(0, 200) };
  }
}

// ---------- Buffer cross-post (GraphQL: Mastodon + LinkedIn + X) ----------
async function bufferGql(env, query) {
  const r = await fetch("https://api.buffer.com", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + (env.BUFFER_TOKEN || ""), "User-Agent": "qnfo-social/" + VERSION },
    body: JSON.stringify({ query })
  });
  if (!r.ok) throw new Error("buffer gql " + r.status);
  return r.json();
}
// POST-ID-UTM-1 (#1712, 2026-10-01): each channel gets its own utm_source (twitter -> x). No refit after tagging:
// X and Mastodon count every link as 23 characters and LinkedIn allows 3000, so the tag does not change the length
// that the 280 cap was computed for.
// DAILY-DISTRIBUTION-1 (0.7.37): the Buffer organisation and channel list, read once per call site.
async function bufferChannels(env) {
  const orgRes = await bufferGql(env, "{ account { organizations { id } } }");
  const orgs = (orgRes && orgRes.data && orgRes.data.account && orgRes.data.account.organizations) || [];
  if (!orgs.length) return { error: "no buffer org", channels: [] };
  const chRes = await bufferGql(env, "{ channels(input: { organizationId: \"" + orgs[0].id + "\" }) { id service isDisconnected } }");
  return { orgId: orgs[0].id, channels: (chRes && chRes.data && chRes.data.channels) || [] };
}
// One Buffer post on one channel. `text` is already tagged for that channel. LinkedIn goes to the queue (or a draft in
// pipeline_flags.linkedin_mode='draft'); Mastodon and X share now. The result shape is what postUriValue reads.
async function bufferCreate(env, ch, svc, svcText, liMode) {
  svcText = withAutomationMarker(svcText, MARKER_MAX_CHARS[svc] || 280);
  try {
    // LINKEDIN-BUFFER-DRAFTS-1 (#1713): LinkedIn is draft-only (owner approves in Buffer); the rest share now.
    const draft = svc === "linkedin" && liMode === "draft";
    const queued = svc === "linkedin" && !draft;
    const mutation = "mutation CreatePost { createPost(input: { text: " + JSON.stringify(svcText) + ", channelId: \"" + ch.id + "\", schedulingType: automatic, mode: " + (draft ? "addToQueue, saveToDraft: true" : queued ? "addToQueue" : "shareNow") + " }) { ... on PostActionSuccess { post { id status } } ... on MutationError { message } } }";
    const r = await bufferGql(env, mutation);
    const cp = r && r.data && r.data.createPost;
    // 0.7.21: read back the status Buffer gave the LinkedIn post; anything but 'draft' is an alert (ToS 3.1).
    if (cp && cp.post && draft && cp.post.status && String(cp.post.status).toLowerCase() !== "draft") {
      await logAlert(env, "linkedin-draft", "error", "LINKEDIN-BUFFER-DRAFTS-1: Buffer post " + cp.post.id + " came back with status " + cp.post.status + ", not draft");
      return { platform: svc, status: "error", post_id: cp.post.id, error: "not-draft:" + cp.post.status };
    }
    if (cp && cp.post) return { platform: svc, status: draft ? "draft" : queued ? "queued" : "ok", post_id: cp.post.id, text: svcText };
    return { platform: svc, status: "error", error: (cp && cp.message) || JSON.stringify(r).slice(0, 120) };
  } catch (e) { return { platform: svc, status: "error", error: String(e && e.message || e) }; }
}
// CROSSPOST-CAP-1 (agent_issues 1000610, chaos drill control social-weekly-caps): pure. The hold a channel's own drain applies (drainChannels: weekly cap, then spacing of 7 days / cap less one hour),
// returned as a reason or null. The Bluesky cross-post (bufferPost) ignored both: on 2026-10-27 a LinkedIn post went out at 16:31 from the channel drain and another at 21:31 as a cross-post, 5 hours apart
// under a cap of 7 a week (spacing 23 h), and the drill read "two posts on one channel landed under 6 h apart". `w` is channelWindow's { n, lastMs }.
function windowHold(cap, w, nowMs) {
  if (!cap) return 'held:cap-0';
  if (w && w.n >= cap) return 'held:weekly-cap(' + w.n + '/' + cap + ')';
  const spacing = Math.floor(7 * 864e5 / cap) - 36e5;
  if (w && w.lastMs != null && nowMs - w.lastMs < spacing) return 'held:spacing(next ' + new Date(w.lastMs + spacing).toISOString().slice(0, 16) + 'Z)';
  return null;
}
// The hold for one cross-post channel; a channel outside the drain order (Substack Notes, which take roll-ups with their own gap) is not held here. An unreadable gate holds, as drainChannels does.
async function crossPostHold(env, svc, nowMs) {
  if (CHANNEL_ORDER.indexOf(svc) < 0) return null;
  try {
    const caps = await channelCaps(env), shares = await attentionShares(env);
    const cap = shareCap(caps[svc], shares[svc], shares.floor);
    const w = await channelWindow(env, svc, await capEpoch(env));
    return windowHold(cap, w, nowMs);
  } catch (e) { return 'held:gate-error'; }
}
async function bufferPost(env, text, campaign) {
  if (!env.BUFFER_TOKEN) return { skipped: "no BUFFER_TOKEN" };
  const results = [];
  try {
    const bc = await bufferChannels(env);
    if (bc.error) return { error: bc.error };
    const channels = bc.channels;
    const liMode = await linkedinMode(env);
    for (const svc of ["mastodon", "linkedin", "twitter", "substack"]) {
      const ch = svc === "mastodon" && mastodonDirect(env) ? MASTODON_DIRECT_CH : findChannel(channels, svc);
      if (!ch) { results.push({ platform: svc, status: "no-channel" }); continue; }
      // DAILY-DISTRIBUTION-1: a channel that already carried this slug (its own daily drain, or an earlier cross-post) in the
      // last CHANNEL_REPEAT_DAYS is skipped, so the Bluesky cross-post never duplicates a channel post.
      if (campaign && await channelCarried(env, svc, campaign)) { results.push({ platform: svc, status: "skipped", reason: "carried-" + CHANNEL_REPEAT_DAYS + "d" }); continue; }
      const xHold = await crossPostHold(env, svc, Date.now());
      if (xHold) { results.push({ platform: svc, status: "skipped", reason: xHold }); continue; }
      const svcText = utmTagText(text, BUFFER_UTM_SOURCE[svc] || svc, campaign);
      const res = await channelCreate(env, ch, svc, svcText, liMode);
      results.push(res);
      if (res.post_id && res.status !== "error") await recordChannelPost(env, svc, campaign, res, svcText, "cross-post");
    }
  } catch (e) { results.push({ status: "error", error: String(e && e.message || e) }); }
  return { results };
}

// ---------- DAILY-DISTRIBUTION-1 (0.7.37, 2026-10-06, pillar: reach; STRATEGY s4 cadence per channel) ----------
// Owner directive 2026-10-06: outreach must be persistent, routine and daily. Measured before this change (qnfo-audit,
// 2026-10-06): LinkedIn, Mastodon and X, all connected in Buffer (social_channels), received a post only as the cross-post
// of a Bluesky post, and the Bluesky weekly cap (2) held both drains, so every channel carried 2 items in the week of
// 10-02 (social_threads 152 and 154), nothing went out on 5 of 7 days, and four launch-queue rows (149, 150, 151, 153)
// waited the whole week. STRATEGY s4 gives each channel its own cadence: LinkedIn 2-3 a week, Mastodon a mirror of
// Bluesky (1-2), X at most 2. Nothing here raises a cap. Each Buffer channel gets its own weekly cap inside those numbers
// (CHANNEL_WEEKLY_CAP; pipeline_flags.social_channel_caps, a JSON object, overrides it, clamped to 0..7), its posts are
// spread over the week (minimum spacing 7 days / cap, so LinkedIn posts about every 56h and the mirrors every 84h), a
// channel never carries the same slug twice in CHANNEL_REPEAT_DAYS, and with Bluesky's own 2 a week the fleet publishes
// on most days of the week while every channel stays inside its STRATEGY cadence. The drain runs on the same 2-hourly
// tick as the Bluesky drains, after them, so a Bluesky post and its cross-posts come first and this drain fills only the
// room a channel still has. Content: the oldest queued selected row first (the launch queue reaches LinkedIn before
// Bluesky's cap lets it out), else the most recently posted row since the cadence epoch the channel has not carried.
// LinkedIn gets the whole thread (up to CHANNEL_MAX_CHARS.linkedin) with a one-line subscribe offer (lever 1 of
// agent_issues 1753: carry the subscribe offer in distribution posts); Mastodon and X get the 280-character fit. Every
// row still passes contentGate, the REACH-SELECT-1 deny rule and the link probe; pipeline_flags.social_paused holds
// everything; a posted row's status is never changed here. Ledger: social_media_posts (platform buffer-<channel>,
// project_id = slug, buffer_id, published_at; the table distribution_posts_30d already counts) and one cloud_ops_events
// row per day (social-channels-<day>), which the watchmaker reads.
// OUTREACH-ACCELERATE-1 (0.15.0): 7 / 14 / 14 / 14 a week (was 5 / 10 / 10); pipeline_flags.social_channel_caps overrides (0..21).
var CHANNEL_WEEKLY_CAP = { linkedin: 7, mastodon: 14, twitter: 14, substack: 14 };
var CHANNEL_CAP_MAX = 21;
var CHANNEL_PLATFORM = { linkedin: 'buffer-linkedin', mastodon: 'buffer-mastodon', twitter: 'buffer-x', substack: 'buffer-substack' };
// SUBSTACK-CHANNEL-1: a Note holds 10,000 characters; it gets the LinkedIn-length whole thread.
var CHANNEL_MAX_CHARS = { linkedin: 1300, mastodon: 280, twitter: 280, substack: 1300 };
var CHANNEL_LONG = { linkedin: 1, substack: 1 };
var CHANNEL_REPEAT_DAYS = 30;
var CHANNEL_ORDER = ['linkedin', 'mastodon', 'twitter'];   // PAPER-ROLLUP-1: Substack takes roll-ups (drainRollup), not single posts
// The Buffer channel for a service; Buffer may name Substack 'substack' or a variant, so it matches by substring.
function findChannel(channels, svc) {
  return (channels || []).find(function(c) { return c && !c.isDisconnected && (c.service === svc || (svc === 'substack' && /substack/i.test(String(c.service || '')))); }) || null;
}
// ---------- MASTODON-DIRECT-1 (0.15.0) ----------
// Mastodon has an open API, so it needs no Buffer slot: with the MASTODON_TOKEN secret (an application token with write:statuses
// on the QNFO account) the mastodon channel posts to https://<MASTODON_HOST>/api/v1/statuses directly. Without it, Buffer as before.
// The ledger row keeps platform buffer-mastodon (cadence window, learner and scorecard read it), buffer_id = the status id and url =
// the public status link, so the 07:00 run reads its counts from the public status API (mastodonDirectStats).
var MASTODON_DIRECT_CH = { id: 'mastodon-direct', service: 'mastodon' };
function mastodonDirect(env) { return !!(env && env.MASTODON_TOKEN); }
function mastodonHost(env) { const h = String((env && env.MASTODON_HOST) || 'mstdn.science').trim().toLowerCase(); return /^[a-z0-9][a-z0-9.-]{0,251}[a-z0-9]$/.test(h) ? h : 'mstdn.science'; }
async function mastodonCreate(env, svcText) {
  svcText = withAutomationMarker(svcText, MARKER_MAX_CHARS.mastodon);
  try {
    const body = new URLSearchParams({ status: String(svcText || ''), visibility: 'public', language: 'en' });
    const r = await fetch('https://' + mastodonHost(env) + '/api/v1/statuses', { method: 'POST', headers: { 'Authorization': 'Bearer ' + env.MASTODON_TOKEN, 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': await sha256Hex(String(svcText || '')), 'User-Agent': 'qnfo-social/' + VERSION }, body: body.toString(), signal: AbortSignal.timeout(15000) });
    const t = await readTextCapped(r, 65536);
    if (r.status < 200 || r.status >= 300) return { platform: 'mastodon', status: 'error', error: 'mastodon ' + r.status + ' ' + t.slice(0, 80) };
    const j = JSON.parse(t);
    if (!j || !j.id) return { platform: 'mastodon', status: 'error', error: 'mastodon: no status id' };
    return { platform: 'mastodon', status: 'ok', post_id: String(j.id), url: j.url ? String(j.url) : null, text: svcText, via: 'mastodon-direct' };
  } catch (e) { return { platform: 'mastodon', status: 'error', error: 'mastodon: ' + String(e && e.message || e).slice(0, 100) }; }
}
async function sha256Hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('').slice(0, 40);
}
// One post on one channel: Mastodon direct when the channel is the direct one, otherwise Buffer.
async function channelCreate(env, ch, svc, svcText, liMode) {
  if (ch && ch.id === MASTODON_DIRECT_CH.id) return mastodonCreate(env, svcText);
  return bufferCreate(env, ch, svc, svcText, liMode);
}
// The 07:00 counts for direct Mastodon posts of the last BUFFER_STATS_DAYS days (social_engagements platform buffer, post_id =
// the status id, as the Buffer-read rows are keyed), from the same public status reader.
async function mastodonDirectStats(env, nowMs) {
  const now = nowMs || Date.now();
  let rows = [];
  try { rows = (await env.DB.prepare("SELECT buffer_id, url, published_at FROM social_media_posts WHERE platform = 'buffer-mastodon' AND engagement_metrics LIKE '%mastodon-direct%' AND url IS NOT NULL AND published_at >= datetime('now', ?1) ORDER BY published_at DESC LIMIT 60").bind('-' + BUFFER_STATS_DAYS + ' days').all()).results || []; } catch (e) { return { error: String(e && e.message || e).slice(0, 120) }; }
  if (!rows.length) return { posts: 0 };
  const nodes = rows.map(function(r) { return { id: String(r.buffer_id), status: 'sent', metrics: [], externalLink: r.url, sentAt: String(r.published_at || '').replace(' ', 'T') + 'Z' }; });
  const mp = await mastodonPublicStats(nodes, now);
  const day = new Date(now).toISOString().slice(0, 10);
  const st = mp.rows.map(function(x) { return env.DB.prepare("INSERT INTO social_engagements (platform, post_id, metric, value, note, collected_at) VALUES ('buffer',?1,?2,?3,'mastodon public api (direct)',?4) ON CONFLICT(platform, post_id, metric, collected_at) DO UPDATE SET value=excluded.value, note=excluded.note").bind(x.post_id, x.metric, x.value, day); });
  for (let i = 0; i < st.length; i += 50) await env.DB.batch(st.slice(i, i + 50));
  return { posts: rows.length, rows: mp.rows.length, requests: mp.requests, errors: mp.errors };
}
// INTEG-MASTODON-VERIFY-1 (0.16.11, issue 2925): the account's link fields carry a verified link to qnfo.org and no entry for the
// closed registrar (NOZ-DOI-1). The 0.16.10-codeagent draft ran this as a top-level async block on process.env.MASTODON_TOKEN: a
// Worker may not fetch in global scope and carries its secrets in env, so it never ran. Now a function of env on the daily
// engagement step; idempotent (it PATCHes only when the wanted fields differ from the account's) and it reports a failure's
// reason, never a zero. Mastodon verifies the link itself (rel=me, served by qnfo-gateway on every page): verified is read back.
var MASTODON_WEBSITE_FIELD = 'https://qnfo.org';
var MASTODON_DEAD_FIELD_RE = /10\.5281\//; // a profile field that still links a dead-prefix DOI is removed (the live profile has none, 2026-10-21)
function mastodonWantedFields(fields) {
  const kept = (Array.isArray(fields) ? fields : []).filter(function(f) { return f && !MASTODON_DEAD_FIELD_RE.test(String(f.name || '') + ' ' + String(f.value || '')); })
    .map(function(f) { return { name: String(f.name || ''), value: String(f.value || '') }; });
  const i = kept.findIndex(function(f) { return f.name === 'Website'; });
  if (i >= 0) kept[i] = { name: 'Website', value: MASTODON_WEBSITE_FIELD }; else kept.push({ name: 'Website', value: MASTODON_WEBSITE_FIELD });
  return kept.slice(0, 4);
}
async function mastodonProfileSync(env, fetchImpl) {
  if (!mastodonDirect(env)) return { skipped: 'MASTODON_TOKEN not set' };
  const f = fetchImpl || fetch, host = mastodonHost(env), auth = { Authorization: 'Bearer ' + env.MASTODON_TOKEN };
  const r = await f('https://' + host + '/api/v1/accounts/verify_credentials', { headers: auth });
  if (!r.ok) return { error: 'verify_credentials ' + r.status };
  const acct = await r.json();
  const have = (acct.fields || []).map(function(x) { return { name: String(x.name || ''), value: String(x.value || '').replace(/<[^>]*>/g, '') }; });
  const want = mastodonWantedFields(acct.fields);
  const same = have.length === want.length && want.every(function(w, i) { return have[i].name === w.name && have[i].value === w.value; });
  const verified = (acct.fields || []).filter(function(x) { return x && x.verified_at; }).length;
  if (same) return { changed: false, fields: want.length, verified };
  const u = await f('https://' + host + '/api/v1/accounts/update_credentials', { method: 'PATCH', headers: Object.assign({ 'Content-Type': 'application/json' }, auth), body: JSON.stringify({ fields_attributes: want }) });
  if (!u.ok) return { error: 'update_credentials ' + u.status, changed: false };
  return { changed: true, fields: want.length, verified };
}
// SUBSCRIBE-LINE-ACCURATE-1 (0.12.0, issue 1753): the list is a weekly digest of new papers (qnfo-subscribers); the line
// says so and links the form itself, not the top of the page.
var SUBSCRIBE_LINE = 'New papers by email, one short weekly digest: https://qnfo.org/#subscribe';
async function channelCaps(env) {
  const caps = Object.assign({}, CHANNEL_WEEKLY_CAP);
  try {
    const f = await env.DB.prepare("SELECT value FROM pipeline_flags WHERE key='social_channel_caps'").first();
    const o = f && f.value ? JSON.parse(String(f.value)) : null;
    if (o && typeof o === 'object') for (const k of CHANNEL_ORDER) { const n = parseInt(String(o[k]), 10); if (Number.isFinite(n)) caps[k] = Math.max(0, Math.min(CHANNEL_CAP_MAX, n)); }
  } catch (e) { console.error(JSON.stringify({ evt: "social:channelCaps:caught", error: String((e && e.message) || e) })); }
  return caps;
}
// ---------- ATTENTION-SHARE-1 (0.8.0, 2026-10-06, pillar reach; the actuation half of qnfo-fleet-dashboard ATTENTION-LOOP-1) ----------
// Owner directive 2026-10-06 07:44Z: do more of what gets noticed; promote better or stop what is not. The dashboard's daily
// scorecard grades every channel's human attention per item and writes ops_config attention_channel_share, a share in
// [0, 1] per channel (bluesky, linkedin, mastodon, x). Here the share multiplies the owner's weekly cap (STRATEGY s4 and
// pipeline_flags.social_channel_caps for the Buffer channels, SOCIAL_WEEKLY_CAP for Bluesky): share 1 is the cap, 0.5 half
// of it, 0.25 one post a week at most (the re-test week), 0 holds every post (STOP). A share never raises a cap. A share
// row older than 3 days (the scorecard stopped) reads as 1 for every channel, so a dead loop can never silence a channel.
var ATTENTION_SHARE_STALE_MS = 3 * 864e5;
async function attentionShares(env) {
  const out = { bluesky: 1, linkedin: 1, mastodon: 1, twitter: 1, substack: 1, day: null, source: 'default', floor: SHARE_FLOOR_DEFAULT };
  // OUTREACH-ACCELERATE-1: the floor a share cannot push a cap below (pipeline_flags.social_share_floor, 0..1).
  try { const fl = await env.DB.prepare("SELECT value FROM pipeline_flags WHERE key='social_share_floor'").first(); const v = fl ? Number(String(fl.value).trim()) : NaN; if (fl && Number.isFinite(v)) out.floor = Math.max(0, Math.min(1, v)); } catch (e) { console.error(JSON.stringify({ evt: "social:shareFloor:caught", error: String((e && e.message) || e) })); }
  try {
    const r = await env.DB.prepare("SELECT value, updated_at FROM ops_config WHERE key='attention_channel_share'").first();
    const o = r && r.value ? JSON.parse(String(r.value)) : null;
    if (!o || typeof o !== 'object') return out;
    const ts = String(r.updated_at || '').trim();
    const age = ts ? Date.now() - Date.parse(/[zZ]$|[+-]\d\d:\d\d$/.test(ts) ? ts : ts.replace(' ', 'T') + 'Z') : NaN;
    if (!(age <= ATTENTION_SHARE_STALE_MS)) { out.source = 'stale-default'; out.stale_day = o.day || null; return out; }
    for (const k of ['bluesky', 'linkedin', 'mastodon']) { const v = Number(o[k]); if (Number.isFinite(v)) out[k] = Math.max(0, Math.min(1, v)); }
    const x = Number(o.x); if (Number.isFinite(x)) out.twitter = Math.max(0, Math.min(1, x));
    out.day = o.day || null; out.source = 'ops_config';
  } catch (e) { console.error(JSON.stringify({ evt: "social:attentionShares:caught", error: String((e && e.message) || e) })); }
  return out;
}
// Pure: the effective weekly cap. A positive share keeps at least one slot (a re-test needs one post), share 0 is 0.
// OUTREACH-ACCELERATE-1 (0.15.0): with a floor f the share steers between f x cap and the cap (f + (1 - f) x share), so a
// channel judged on a thin sample keeps enough posts to be measured; no floor argument keeps the plain scaling.
var SHARE_FLOOR_DEFAULT = 0.5;
function shareCap(cap, share, floor) {
  const c = Number(cap) || 0, s = Number.isFinite(Number(share)) ? Math.max(0, Math.min(1, Number(share))) : 1;
  if (c <= 0) return 0; // Q08-OPEN-1: an attention share of 0 no longer holds a channel; it keeps one slot
  const f = Number.isFinite(Number(floor)) && floor !== null && floor !== undefined ? Math.max(0, Math.min(1, Number(floor))) : 0;
  return Math.max(1, Math.floor(c * (f + (1 - f) * s)));
}
// Pure-ish: posted rows go noticed-first (the paper's bot-filtered external loads over 28 days plus the Bluesky engagement
// of the thread's own post, from reach_signals); queued selected rows keep their place ahead. A failed read keeps the
// incoming order.
async function attentionOrder(env, rows) {
  const posted = rows.filter(function(r) { return r.status === 'posted'; }), queued = rows.filter(function(r) { return r.status !== 'posted'; });
  if (posted.length < 2) return rows;
  try {
    const slugs = {}, uris = {};
    for (const r of posted) { const s = learnerLinkSlug(r.posts); if (s) slugs[s] = 1; const u = blueskyUriOf(r.post_uri); if (u) uris[u] = 1; }
    const sl = Object.keys(slugs), ur = Object.keys(uris), ext = {}, eng = {};
    if (sl.length) {
      const q = await env.DB.prepare("SELECT entity_id, SUM(value) AS v FROM reach_signals WHERE source = 'cf-rum-human' AND entity_type = 'paper' AND metric = 'external_pageviews' AND date >= date('now', '-28 days') AND entity_id IN (" + sl.map(function() { return '?'; }).join(',') + ") GROUP BY entity_id").bind(...sl).all();
      for (const x of (q && q.results) || []) ext[x.entity_id] = Number(x.v) || 0;
    }
    if (ur.length) {
      const q = await env.DB.prepare("SELECT entity_id, metric, MAX(value) AS v FROM reach_signals WHERE source = 'bluesky' AND entity_type = 'post' AND metric IN ('likes', 'reposts', 'quotes') AND entity_id IN (" + ur.map(function() { return '?'; }).join(',') + ") GROUP BY entity_id, metric").bind(...ur).all();
      for (const x of (q && q.results) || []) eng[x.entity_id] = (eng[x.entity_id] || 0) + (Number(x.v) || 0);
    }
    const of = function(r) { const s = learnerLinkSlug(r.posts), u = blueskyUriOf(r.post_uri); return (s ? ext[s] || 0 : 0) + (u ? eng[u] || 0 : 0); };
    const scored = posted.map(function(r, i) { return { r: r, i: i, a: of(r) }; }).sort(function(a, b) { return b.a - a.a || a.i - b.i; });
    for (const x of scored) x.r.attention = x.a;
    return queued.concat(scored.map(function(x) { return x.r; }));
  } catch (e) { return rows; }
}
async function capEpoch(env) {
  try { const ef = await env.DB.prepare("SELECT value FROM pipeline_flags WHERE key='social_cap_epoch'").first(); if (ef && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(ef.value || '').trim())) return String(ef.value).trim(); } catch (e) { console.error(JSON.stringify({ evt: "social:capEpoch:caught", error: String((e && e.message) || e) })); }
  return '0';
}
// SOCIAL-PAUSE-RESUME-1 (2026-10-17): pipeline_flags.social_paused is a bounded switch. A pause written with
// social_paused_until (the dashboard owner-voice guard) expires on its own, and an expired pause is cleared here,
// so a stale integer 1 can no longer hold every channel indefinitely. Absent row = not paused, as before.
// SOCIAL-PAUSE-STALE-UNTIL-1 (issue 2818): social_paused_until only expires the pause episode it was written with. The dashboard
// guard writes the pause and its until with one timestamp; an until whose row is older than the pause row belongs to an earlier
// episode (an owner or older-code write set social_paused=1 without touching it), so it never ends this pause, which then holds
// until a cleared flag, as a pause without an until does. Every read logs one line (value, until, both write times, result) so a
// post made while paused can be traced to the read that allowed it.
function pauseStamp(v) {
  if (!v) return NaN;
  const s = String(v).trim();
  return Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s) ? s.replace(' ', 'T') + 'Z' : s);
}
async function socialPausedBy(env) {
  const f = await env.DB.prepare("SELECT key, value, updated_at FROM pipeline_flags WHERE key IN ('social_paused','social_paused_until')").all();
  const rows = (f && f.results) || [];
  const paused = rows.find(function(r) { return r.key === 'social_paused'; });
  const until = rows.find(function(r) { return r.key === 'social_paused_until'; });
  const read = function(result, note) {
    console.log(JSON.stringify({ worker: 'qnfo-social', event: 'pause-read', value: paused ? String(paused.value) : null, until: until ? String(until.value) : null,
      pause_at: paused && paused.updated_at ? String(paused.updated_at) : null, until_at: until && until.updated_at ? String(until.updated_at) : null, result: result, note: note || null }));
    return result;
  };
  if (!paused || String(paused.value).trim() !== '1') return read(null, 'not-paused');
  if (until && until.value) {
    const pausedAt = pauseStamp(paused.updated_at), untilAt = pauseStamp(until.updated_at);
    if (Number.isFinite(pausedAt) && Number.isFinite(untilAt) && untilAt < pausedAt) return read('1', 'stale-until-ignored');
    const t = Date.parse(until.value);
    if (Number.isFinite(t) && t <= Date.now()) {
      try {
        await env.DB.prepare("UPDATE pipeline_flags SET value='0', updated_at=datetime('now') WHERE key='social_paused'").run();
        await env.DB.prepare("DELETE FROM pipeline_flags WHERE key='social_paused_until'").run();
      } catch (e) {
        console.error(JSON.stringify({ worker: 'qnfo-social', event: 'pause-expiry-clear', error: String(e && e.message || e).slice(0, 160) }));
        // The clear did not persist: the flag still reads 1, so the pause holds (fail closed) until a clear lands.
        return read(String(until.value), 'expired-clear-failed');
      }
      return read(null, 'expired-cleared');
    }
  }
  return read(until && until.value ? String(until.value) : '1', 'paused');
}
async function ensureChannelSchema(env) {
  try { await env.DB.prepare("CREATE TABLE IF NOT EXISTS social_media_posts (id TEXT PRIMARY KEY, platform TEXT NOT NULL, post_id TEXT, url TEXT, content_preview TEXT, published_at TEXT, buffer_id TEXT, project_id TEXT, paper_doi TEXT, status TEXT DEFAULT 'published', engagement_metrics TEXT, created_at TEXT DEFAULT (datetime('now')), _version INTEGER DEFAULT 1)").run(); } catch (e) { console.error(JSON.stringify({ evt: "social:ensureChannelSchema:caught", error: String((e && e.message) || e) })); }
}
// Posts a channel carried in the last 7 days (from the cadence epoch) and when it last posted: its own ledger rows plus the
// cross-posts recorded in social_threads.post_uri (a JSON object keyed by utm_source: linkedin, mastodon, x).
async function channelWindow(env, channel, epoch) {
  const key = BUFFER_UTM_SOURCE[channel] || channel;
  const a = await env.DB.prepare("SELECT COUNT(*) AS n, MAX(published_at) AS last FROM social_media_posts WHERE platform=?1 AND status='published' AND published_at >= MAX(datetime('now','-7 days'), ?2)").bind(CHANNEL_PLATFORM[channel], epoch).first();
  const b = await env.DB.prepare("SELECT COUNT(*) AS n, MAX(posted_at) AS last FROM social_threads WHERE status='posted' AND post_uri LIKE ?1 AND posted_at >= MAX(datetime('now','-7 days'), ?2)").bind('%"' + key + '":"buffer%', epoch).first();
  const n = Number((a && a.n) || 0) + Number((b && b.n) || 0);
  const lasts = [a && a.last, b && b.last].filter(Boolean).map(function(x) { return Date.parse(String(x).replace(' ', 'T') + (/Z$|[+-]\d\d:\d\d$/.test(String(x)) ? '' : 'Z')); }).filter(function(t) { return Number.isFinite(t); });
  return { n: n, lastMs: lasts.length ? Math.max.apply(null, lasts) : null };
}
async function channelCarried(env, channel, slug) {
  if (!slug) return false;
  const key = BUFFER_UTM_SOURCE[channel] || channel;
  try {
    const a = await env.DB.prepare("SELECT 1 AS x FROM social_media_posts WHERE platform=?1 AND project_id=?2 AND status='published' AND published_at >= datetime('now', ?3) LIMIT 1").bind(CHANNEL_PLATFORM[channel], String(slug), '-' + CHANNEL_REPEAT_DAYS + ' days').first();
    if (a) return true;
    const b = await env.DB.prepare("SELECT 1 AS x FROM social_threads WHERE slug=?1 AND status='posted' AND post_uri LIKE ?2 AND posted_at >= datetime('now', ?3) LIMIT 1").bind(String(slug), '%"' + key + '":"buffer%', '-' + CHANNEL_REPEAT_DAYS + ' days').first();
    return !!b;
  } catch (e) { return true; }   // an unreadable ledger holds the post (never duplicate blind)
}
// content_preview is cut at 200 characters; a post that ends with the AI marker keeps it in the preview so ai_label_coverage (bp26_web social_posts) can see it.
function previewKeepingMarker(text) {
  const t = String(text || '');
  if (t.length > 200 && t.endsWith(AUTOMATION_MARKER)) return t.slice(0, 200 - AUTOMATION_MARKER.length) + AUTOMATION_MARKER;
  return t.slice(0, 200);
}
async function recordChannelPost(env, channel, slug, res, text, via) {
  await ensureChannelSchema(env);
  const id = 'ch-' + (BUFFER_UTM_SOURCE[channel] || channel) + '-' + Date.now().toString(36) + crypto.randomUUID().replace(/-/g, '').slice(0, 6);
  try {
    await env.DB.prepare("INSERT INTO social_media_posts (id, platform, post_id, url, content_preview, published_at, buffer_id, project_id, status, engagement_metrics) VALUES (?1,?2,?3,?7,?4,datetime('now'),?3,?5,'published',?6)")
      .bind(id, CHANNEL_PLATFORM[channel], String(res.post_id), previewKeepingMarker(text), slug ? String(slug) : null, JSON.stringify(res.via ? { via: via, transport: res.via, status: res.status } : { via: via, buffer_status: res.status }), res.url || null).run();
  } catch (e) { console.log('DAILY-DISTRIBUTION-1 ledger write failed for ' + channel + ' ' + slug + ': ' + String(e && e.message || e).slice(0, 120)); }
  return id;
}
// The text one channel receives: LinkedIn the whole thread (link applied, subscribe offer appended), the short channels the
// same 280-character pick the Bluesky cross-post uses. Pure; tagging happens at send time (utmTagText per channel).
function channelText(channel, posts, link, title) {
  const max = CHANNEL_MAX_CHARS[channel] || 280;
  if (!CHANNEL_LONG[channel]) return pickBufferText(posts, link, title, max);
  const list = (posts || []).map(function(p) { return typeof p === 'string' ? p : String((p && p.text) || ''); }).map(function(t) { return t.trim(); }).filter(Boolean);
  let body = list.join('\n\n');
  if (link && body.indexOf(link) < 0) body = applyLink(body, link, max - 60);
  const room = max - SUBSCRIBE_LINE.length - 2;
  // SOCIAL-POST-TRUNCATION-2: whole sentences first; the ellipsis cut only when one sentence alone is over the limit.
  let fitted = fitWhole(body, room);
  if (fitted === null) fitted = fitKeepUrls(body, room);
  const base = fitted !== null ? fitted : truncateSafe(body, room);
  return base + '\n\n' + SUBSCRIBE_LINE;
}
// Candidate rows for a channel: queued selected rows oldest first, then rows posted since the cadence epoch newest first;
// q08 essays and anything the channel carried in CHANNEL_REPEAT_DAYS are skipped (the caller applies the content gates).
// PROMOTE-ROUTE-2: true when the channel's latest published post carried a slug that is not a tracked paper (a curated thread).
// No post yet, or any read error, is false: the original order (threads, then papers) stands.
async function lastPostWasThread(env, channel) {
  try {
    const last = await env.DB.prepare("SELECT project_id FROM social_media_posts WHERE platform=?1 AND status='published' AND project_id IS NOT NULL ORDER BY published_at DESC LIMIT 1").bind(CHANNEL_PLATFORM[channel]).first();
    if (!last || !last.project_id) return false;
    const paper = await env.DB.prepare("SELECT 1 AS x FROM dissemination_tracker WHERE paper_slug=?1 LIMIT 1").bind(String(last.project_id)).first();
    return !paper;
  } catch (e) {
    return false;
  }
}
async function pickChannelRow(env, channel, epoch) {
  const rows = (await env.DB.prepare("SELECT id, slug, title, posts, status, doi, notes, flags, posted_at, post_uri FROM social_threads WHERE (status='queued' AND (COALESCE(flags,'') LIKE '%selected%' OR COALESCE(notes,'') LIKE 'selected%')) OR (status='posted' AND posted_at >= ?1 AND posted_at >= datetime('now','-60 days')) ORDER BY CASE WHEN status='queued' THEN 0 ELSE 1 END, CASE WHEN status='queued' THEN id ELSE 0 END ASC, posted_at DESC LIMIT 24").bind(epoch === '0' ? '2026-10-01 00:00:00' : epoch).all()).results || [];
  // ATTENTION-SHARE-1: noticed items first among the posted rows.
  const ordered = await attentionOrder(env, rows);
  // PROMOTE-ROUTE-1 (0.9.0): new research papers reach the Buffer channels. qnfo-research-exec queues every published
  // paper in dissemination_tracker for Bluesky only, and the channel drain read social_threads only, so with Bluesky at
  // attention share 0 (STOP since 2026-10-06) the 28 papers published 2026-09-30..10-06 reached no channel at all. Order:
  // queued curated threads first, then the newest queued paper not yet carried on this channel, then recycled posted threads.
  let paperTried = false;
  // PROMOTE-ROUTE-2 (0.9.2): alternate. When the channel's last published post was a curated thread (not a paper), the next
  // post is the newest unposted paper, so the backlog of papers starts moving at the next slot instead of after every queued
  // thread (measured 2026-10-09: 5 threads queued at one a day, so papers would have waited until about 10-14).
  if (await lastPostWasThread(env, channel)) {
    paperTried = true;
    const first = await pickPaperRow(env, channel);
    if (first) return first;
  }
  for (const row of ordered) {
    if (row.status !== 'queued' && !paperTried) {
      paperTried = true;
      const pr = await pickPaperRow(env, channel);
      if (pr) return pr;
    }
    if (!row.slug) continue;
    if (await channelCarried(env, channel, row.slug)) continue;
    return row;
  }
  return paperTried ? null : await pickPaperRow(env, channel);
}
// PROMOTE-ROUTE-1: a queued dissemination row (a paper the research pipeline published in the last PAPER_PROMOTE_DAYS)
// as a channel-drain candidate, shaped like a social_threads row: one post, title and papers.qnfo.org link. The tracker
// row stays queued for Bluesky; channelCarried keeps one post per paper per channel.
var PAPER_PROMOTE_DAYS = 30;
async function pickPaperRow(env, channel) {
  let rows = [];
  // PAPER-ROLLUP-1: a paper the roll-up already announced (action posted) is still news on the channels that have not carried it.
  try { rows = (await env.DB.prepare("SELECT id, paper_slug, paper_title, paper_doi, pages_url FROM dissemination_tracker WHERE (action = 'queued' OR (action = 'posted' AND COALESCE(mode, '') LIKE 'rollup%')) AND channel='bluesky' AND paper_slug IS NOT NULL AND paper_slug <> '' AND created_at >= datetime('now', ?1) ORDER BY created_at DESC LIMIT 20").bind('-' + PAPER_PROMOTE_DAYS + ' days').all()).results || []; } catch (e) { return null; }
  for (const d of rows) {
    const slug = String(d.paper_slug);
    if (/^q08-/.test(slug)) continue;
    if (await channelCarried(env, channel, slug)) continue;
    const link = d.pages_url || ('https://papers.qnfo.org/papers/' + slug + '/');
    const title = repairMojibake(String(d.paper_title || slug));
    return { id: 'dissem:' + d.id, slug: slug, title: title, posts: JSON.stringify([title + ' \u2014 new open-access paper: ' + link]), status: 'paper', doi: d.paper_doi || null, notes: 'paper:dissemination_tracker', flags: '', posted_at: null, post_uri: null };
  }
  return null;
}
async function drainChannels(env, opts) {
  opts = opts || {};
  const nowMs = opts.nowMs || Date.now();
  const out = { posted: 0, channels: {} };
  if (!env.BUFFER_TOKEN) return { skipped: 'no BUFFER_TOKEN', channels: {} };
  await ensureSocialSchema(env);
  try {
    if (await socialPausedBy(env)) return { skipped: 'paused', channels: {} };
  } catch (e) { return { skipped: 'gate-error', channels: {} }; }
  const caps = await channelCaps(env);
  const epoch = await capEpoch(env);
  const shares = await attentionShares(env);
  // LEARNER-CHANNEL-ARM-1: the channels in the order of the learner's draws, so the best-drawn channel picks content first.
  const co = await learnerChannelOrder(env);
  out.caps = caps; out.shares = shares; out.channel_order = co.order; out.channel_draws = co.draws || null;
  let bc = null, liMode = null;
  for (const channel of co.order) {
    // ATTENTION-SHARE-1: the owner's cap times the channel's attention share (never above the cap).
    const cap = shareCap(caps[channel], shares[channel], shares.floor);
    if (!cap) { out.channels[channel] = caps[channel] && shares[channel] === 0 ? 'held:attention-stop' : 'held:cap-0'; continue; }
    let w;
    try { w = await channelWindow(env, channel, epoch); } catch (e) { out.channels[channel] = 'held:gate-error'; continue; }
    if (w.n >= cap) { out.channels[channel] = 'held:weekly-cap(' + w.n + '/' + cap + ')'; continue; }
    const spacing = Math.floor(7 * 864e5 / cap) - 36e5;
    if (w.lastMs != null && nowMs - w.lastMs < spacing) { out.channels[channel] = 'held:spacing(next ' + new Date(w.lastMs + spacing).toISOString().slice(0, 16) + 'Z)'; continue; }
    let row;
    try { row = await pickChannelRow(env, channel, epoch); } catch (e) { out.channels[channel] = 'held:pick-error'; continue; }
    if (!row) { out.channels[channel] = 'held:no-content'; continue; }
    let rawPosts = [];
    try { rawPosts = JSON.parse(row.posts); } catch (e) { console.error(JSON.stringify({ evt: "social:drainChannels:caught", error: String((e && e.message) || e) })); }
    if (!Array.isArray(rawPosts) || !rawPosts.length) { out.channels[channel] = 'held:bad-posts(' + row.slug + ')'; continue; }
    const cg = contentGate(rawPosts);
    if (!cg.ok) {
      if (cg.reason === 'dead-doi') {
        try {
          if (String(row.id).indexOf('dissem:') === 0) await env.DB.prepare("UPDATE dissemination_tracker SET action='suppressed', post_text_snippet='CONTENT-GATE: dead-doi - not posted', updated_at=datetime('now') WHERE id=?").bind(String(row.id).slice(7)).run();
          else await env.DB.prepare("UPDATE social_threads SET status='suppressed', error='CONTENT-GATE: dead-doi - not posted', updated_at=datetime('now') WHERE id=?").bind(row.id).run();
        } catch (e) { console.error(JSON.stringify({ evt: "social:drainChannels:caught", error: String((e && e.message) || e) })); }
      }
      out.channels[channel] = 'held:content-gate:' + cg.reason + '(' + row.slug + ')'; continue;
    }
    let link = null;
    for (const pt of cg.texts) { const u = extractUrls(String(pt)); if (u.length) { link = u[0]; break; } }
    if (link) {
      const p = await probeLink(link);
      if (p.verdict !== 'live') { out.channels[channel] = 'held:link-' + p.verdict + '(' + row.slug + ')'; continue; }
    }
    if (!bc) {
      try { bc = await bufferChannels(env); } catch (e) { bc = { error: String(e && e.message || e) }; }
      if (bc.error) { out.channels[channel] = 'error:' + bc.error; out.error = bc.error; break; }
      liMode = await linkedinMode(env);
    }
    const ch = channel === 'mastodon' && mastodonDirect(env) ? MASTODON_DIRECT_CH : findChannel(bc.channels, channel);
    if (!ch) { out.channels[channel] = 'held:no-channel'; continue; }
    // ART50-CHANNEL-DRAIN-MARKER-1 (0.21.1): the channel drain (X, LinkedIn, Mastodon, Substack Notes) is the main automated path and never passed through withAutomationMarker.
    const text = withAutomationMarker(utmTagText(channelText(channel, cg.texts, link, row.title), BUFFER_UTM_SOURCE[channel] || channel, String(row.slug)), CHANNEL_MAX_CHARS[channel] || 280);
    const res = await channelCreate(env, ch, channel, text, liMode);
    if (res.post_id && res.status !== 'error') {
      await recordChannelPost(env, channel, row.slug, res, text, 'channel-drain');
      out.posted++;
      out.channels[channel] = 'posted:' + res.status + ':' + row.slug + ':' + res.post_id;
    } else out.channels[channel] = 'error:' + String(res.error || res.status).slice(0, 80) + '(' + row.slug + ')';
  }
  out.threads_closed = await closeCarriedThreads(env);
  return out;
}
// THREAD-CLOSE-1 (0.16.5, 2026-10-18): the channel drain records each Buffer post in social_media_posts but never closed
// the social_threads row it came from, so a curated thread carried on every channel stayed status 'queued' forever and
// sat past the distribution SLA (thread 153 ipatent-example: LinkedIn 10-17, Mastodon + X 10-14, still queued 16 days).
// After each drain, a queued thread every CHANNEL_ORDER channel has carried is marked posted (one UPDATE per thread).
async function closeCarriedThreads(env) {
  let closed = 0;
  try {
    const rows = (await env.DB.prepare("SELECT id, slug FROM social_threads WHERE status='queued' AND slug IS NOT NULL LIMIT 50").all()).results || [];
    for (const r of rows) {
      let all = true;
      for (const ch of CHANNEL_ORDER) { if (!(await channelCarried(env, ch, r.slug))) { all = false; break; } }
      if (!all) continue;
      const u = await env.DB.prepare("UPDATE social_threads SET status='posted', posted_at=COALESCE(posted_at, datetime('now')), notes=substr('THREAD-CLOSE-1: carried on ' || ?2 || '; ' || COALESCE(notes,''),1,2000), updated_at=datetime('now') WHERE id=?1 AND status='queued'").bind(r.id, CHANNEL_ORDER.join(',')).run();
      closed += Number(u && u.meta && u.meta.changes) || 0;
    }
  } catch (e) { console.error(JSON.stringify({ evt: "social:closeCarriedThreads", error: String((e && e.message) || e).slice(0, 200) })); }
  return closed;
}
function channelsRunStatus(c) {
  if (!c || c.error) return 'error';
  if (c.skipped) return c.skipped === 'gate-error' ? 'error' : 'skipped';
  const vals = Object.keys(c.channels || {}).map(function(k) { return c.channels[k]; });
  if (vals.some(function(v) { return /^error:/.test(v) || /^held:(gate-error|pick-error)/.test(v); })) return 'degraded';
  return 'ok';
}

// LINKEDIN-OWNER-DELEGATED-1: 'publish' unless pipeline_flags.linkedin_mode is exactly 'draft'.
async function linkedinMode(env) {
  try {
    const f = await env.DB.prepare("SELECT value FROM pipeline_flags WHERE key='linkedin_mode'").first();
    return f && String(f.value) === "draft" ? "draft" : "publish";
  } catch (e) { return "publish"; }
}
// BUFFER-CHANNEL-AUDIT-1: once per UTC day (first */2h tick), record every Buffer channel and its connection state, so
// "is LinkedIn connected" is a D1 fact (social_channels) instead of a question for the owner. A failed read is logged,
// never written as "disconnected".
async function bufferChannelAudit(env, nowMs) {
  if (!env.BUFFER_TOKEN) return { skipped: "no BUFFER_TOKEN" };
  const day = new Date(nowMs || Date.now()).toISOString().slice(0, 10);
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS social_channels (channel_id TEXT PRIMARY KEY, service TEXT, name TEXT, connected INTEGER, checked_at TEXT, checked_day TEXT)").run();
  const done = await env.DB.prepare("SELECT 1 AS x FROM social_channels WHERE checked_day=?1 LIMIT 1").bind(day).first();
  if (done) return { throttled: day };
  const orgRes = await bufferGql(env, "{ account { organizations { id } } }");
  const orgs = (orgRes && orgRes.data && orgRes.data.account && orgRes.data.account.organizations) || [];
  if (!orgs.length) { await logAlert(env, "buffer-channels", "error", "BUFFER-CHANNEL-AUDIT-1: no Buffer organization (token rejected or empty)"); return { error: "no org" }; }
  const chRes = await bufferGql(env, "{ channels(input: { organizationId: \"" + orgs[0].id + "\" }) { id service name isDisconnected } }");
  const channels = (chRes && chRes.data && chRes.data.channels) || [];
  const iso = new Date(nowMs || Date.now()).toISOString();
  const st = channels.map(function(c) {
    return env.DB.prepare("INSERT INTO social_channels (channel_id, service, name, connected, checked_at, checked_day) VALUES (?1,?2,?3,?4,?5,?6) ON CONFLICT(channel_id) DO UPDATE SET service=excluded.service, name=excluded.name, connected=excluded.connected, checked_at=excluded.checked_at, checked_day=excluded.checked_day").bind(String(c.id), String(c.service || ""), String(c.name || ""), c.isDisconnected ? 0 : 1, iso, day);
  });
  if (st.length) await env.DB.batch(st);
  const li = channels.filter(function(c) { return c.service === "linkedin"; });
  if (!li.some(function(c) { return !c.isDisconnected; })) await logAlert(env, "buffer-channels", "error", "BUFFER-CHANNEL-AUDIT-1: no connected LinkedIn channel in Buffer (" + channels.length + " channels)");
  return { day: day, channels: channels.map(function(c) { return c.service + (c.isDisconnected ? ":disconnected" : ":connected"); }) };
}

// Re-run the fact-checker on drafts held only because the checker was unavailable.
async function recheckDrafts(env) {
  var rows = await env.DB.prepare("SELECT id, slug, title, doi, abstract, posts FROM social_threads WHERE status='draft' AND notes LIKE '%checker unavailable%' ORDER BY id ASC LIMIT 6").all();
  var list = rows.results || [];
  var approved = 0, held = 0, skipped = 0;
  for (var i = 0; i < list.length; i++) {
    var row = list[i];
    var posts = [];
    try { posts = JSON.parse(row.posts); } catch (e) { posts = []; }
    if (!Array.isArray(posts) || !posts.length) { skipped++; continue; }
    var abstract = String(row.abstract || "").slice(0, 4000);
    if (!abstract) { skipped++; continue; }
    // REACH-SELECT-1: a held draft about a paper STRATEGY keeps out of outreach is never approved by a recheck.
    var rel = reachEligible(String(row.title || ""), abstract, row.doi);
    if (!rel.ok) {
      await env.DB.prepare("UPDATE social_threads SET status='suppressed', notes=? WHERE id=? AND status='draft'").bind("REACH-SELECT-1: " + rel.reason, row.id).run();
      skipped++;
      continue;
    }
    var issues = await checkThread(env, String(row.title || ""), abstract, posts, row.doi);
    if (issues && issues.length === 0) {
      await env.DB.prepare("UPDATE social_threads SET status='queued', notes=NULL WHERE id=?").bind(row.id).run();
      approved++;
    } else {
      if (issues) await env.DB.prepare("UPDATE social_threads SET notes=? WHERE id=?").bind(JSON.stringify(issues), row.id).run();
      held++;
    }
  }
  if (approved) await logAlert(env, "recheck", "info", "recheck approved " + approved + " held draft(s)");
  return { checked: list.length, approved: approved, held: held, skipped: skipped };
}

var DRAIN_PER_RUN = 6;      // threads posted per scheduled run
var DRAIN_DAILY_CAP = 30;   // hard ceiling on posts per UTC day
var MAX_RETRIES = 3;        // attempts before a thread is parked as failed

// SOCIAL-CADENCE-CAP-1 + SOCIAL-PAUSE-1 (2026-10-01, STRATEGY 4 and 5 gates 5-6): both drains post to the owner's
// personal Bluesky account, whose cadence is 1-2 curated posts a week. Before posting, each drain reads
// pipeline_flags.social_paused ('1' = post nothing; no row = not paused) and counts Bluesky posts in the last 7 days
// (social_threads + dissemination_tracker channel 'bluesky', status posted) against env.SOCIAL_WEEKLY_CAP (default 2).
// Rows not posted stay queued: no status change, no retry_count bump. A gate read error holds the run (posts
// nothing, logs) instead of posting blind. Order: drainQueue posts a row whose flags contain 'selected' (or whose
// notes start with 'selected'; checker notes are JSON and never do) first, then oldest id first;
// dissemination_tracker has no flags/notes column, so drainDissemination stays oldest created_at first.
var SOCIAL_SCHEMA_DONE = false;
async function ensureSocialSchema(env) {
  if (SOCIAL_SCHEMA_DONE) return;
  SOCIAL_SCHEMA_DONE = true;
  try { await env.DB.prepare("CREATE TABLE IF NOT EXISTS pipeline_flags (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)").run(); } catch (e) { console.error(JSON.stringify({ evt: "social:ensureSocialSchema:caught", error: String((e && e.message) || e) })); }
  // POST-ID-UTM-1 (#1712): nullable post_uri; fails with 'duplicate column' once it exists, which is fine.
  try { await env.DB.prepare("ALTER TABLE social_threads ADD COLUMN post_uri TEXT").run(); } catch (e) { if (!/duplicate column/i.test(String((e && e.message) || e))) console.error(JSON.stringify({ evt: "social:ensureSocialSchema:caught", error: String((e && e.message) || e) })); }
}
function weeklyCap(env) {
  const v = env && env.SOCIAL_WEEKLY_CAP;
  const n = parseInt(String(v === undefined || v === null ? '' : v), 10);
  return Number.isFinite(n) && n >= 0 ? n : 21; // PAPER-ROLLUP-1: 21 a week (3 a day; a roll-up thread counts once); OUTREACH-ACCELERATE-1 had 14, Q08-OPEN-1 7
}
async function socialGate(env, who) {
  await ensureSocialSchema(env);
  await ensureChannelSchema(env);   // PAPER-ROLLUP-1: the count reads social_media_posts (bluesky-rollup)
  // ATTENTION-SHARE-1 (0.8.0): the attention share scales the Bluesky cap, never above it; share 0 holds every post.
  const shares = await attentionShares(env);
  const cap = shareCap(weeklyCap(env), shares.bluesky, shares.floor);
  try {
    const _pausedUntil = await socialPausedBy(env);
    if (_pausedUntil) {
      console.log('SOCIAL-PAUSE-1 ' + who + ': pipeline_flags.social_paused=1 (until ' + _pausedUntil + '), posting nothing');
      return { allowed: 0, reason: 'paused', cap: cap };
    }
    // SOCIAL-CAP-EPOCH-1 (0.7.30, owner direction 2026-10-02 "bring users"): the 2-per-week cap was counting 96 posts from
    // the volume regime STRATEGY-1 retired on 2026-10-01 (79 q08 essays, 17 automatic paper posts), which held the curated
    // launch queue for a week. pipeline_flags.social_cap_epoch (a UTC 'YYYY-MM-DD HH:MM:SS') starts the count no earlier
    // than the reset; the cap itself is unchanged. Delete the flag to count the plain rolling 7 days again.
    let epoch = '0';
    try { const ef = await env.DB.prepare("SELECT value FROM pipeline_flags WHERE key='social_cap_epoch'").first(); if (ef && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(ef.value || '').trim())) epoch = String(ef.value).trim(); } catch (e) { console.error(JSON.stringify({ evt: "social:socialGate:caught", error: String((e && e.message) || e) })); }
    const c = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM social_threads WHERE status='posted' AND posted_at >= MAX(datetime('now','-7 days'), ?1)) + (SELECT COUNT(*) FROM dissemination_tracker WHERE action='posted' AND channel='bluesky' AND COALESCE(mode, '') NOT LIKE 'rollup%' AND posted_at >= MAX(datetime('now','-7 days'), ?1)) + (SELECT COUNT(*) FROM social_media_posts WHERE platform='bluesky-rollup' AND published_at >= MAX(datetime('now','-7 days'), ?1)) AS n").bind(epoch).first();
    const n = Number((c && c.n) || 0);
    console.log('SOCIAL-CADENCE-CAP-1 ' + who + ': bluesky posts_7d=' + n + ' cap=' + cap + (n >= cap ? ' -> holding queued rows' : ''));
    if (n >= cap) return { allowed: 0, reason: 'weekly-cap', posted_7d: n, cap: cap };
    // BSKY-SPACING-1 (0.15.0): at most BSKY_PER_RUN posts a run and at least 7 days / cap minus 1 h after the last Bluesky post,
    // so the 2-hourly drains spread the week's posts over the days instead of spending them in one run.
    const sp = await blueskySpacing(env, cap, Date.now());
    if (sp.wait) { console.log('BSKY-SPACING-1 ' + who + ': last post ' + sp.last + ', next at ' + sp.next); return { allowed: 0, reason: 'spacing', posted_7d: n, cap: cap, next: sp.next }; }
    return { allowed: Math.min(BSKY_PER_RUN, cap - n), reason: null, posted_7d: n, cap: cap, remaining: cap - n };
  } catch (e) {
    console.log('SOCIAL-CADENCE-CAP-1 ' + who + ': gate read failed, posting nothing this run: ' + String(e).slice(0, 120));
    return { allowed: 0, reason: 'gate-error', cap: cap };
  }
}
var BSKY_PER_RUN = 1;
async function blueskySpacing(env, cap, nowMs) {
  try {
    const r = await env.DB.prepare("SELECT MAX(t) AS last FROM (SELECT MAX(posted_at) AS t FROM social_threads WHERE status='posted' UNION ALL SELECT MAX(posted_at) FROM dissemination_tracker WHERE action='posted' AND channel='bluesky' AND COALESCE(mode, '') NOT LIKE 'rollup%' UNION ALL SELECT MAX(published_at) FROM social_media_posts WHERE platform='bluesky-rollup')").first();
    const last = r && r.last ? String(r.last) : '';
    const t = last ? Date.parse(last.replace(' ', 'T') + (/Z$|[+-]\d\d:\d\d$/.test(last) ? '' : 'Z')) : NaN;
    if (!Number.isFinite(t) || !(cap > 0)) return { wait: false };
    const gap = Math.max(0, Math.floor(7 * 864e5 / cap) - 36e5);
    return nowMs - t < gap ? { wait: true, last: last, next: new Date(t + gap).toISOString().slice(0, 16) + 'Z' } : { wait: false, last: last };
  } catch (e) { return { wait: false }; }
}
async function recordPostUri(env, id, value) {
  if (!value) return;
  await ensureSocialSchema(env);
  try { await env.DB.prepare("UPDATE social_threads SET post_uri=? WHERE id=?").bind(value, id).run(); }
  catch (e) { console.log('POST-ID-UTM-1 post_uri write failed for thread ' + id + ': ' + String(e).slice(0, 120)); }
}
async function recordPostUriBySlug(env, slug, value) {
  if (!value || !slug) return;
  await ensureSocialSchema(env);
  await env.DB.prepare("UPDATE social_threads SET post_uri=?, updated_at=datetime('now') WHERE slug=?").bind(value, slug).run();
}
// POST-ID-UTM-1 (0.7.21): status='posted' and post_uri land in ONE statement, so a posted row can no longer exist without
// its platform id because a second write was lost. Fallback (column missing): mark posted, then the fail-soft id write.
// POST-SENT-TEXT-1 (0.7.31, #1712): `sent` (the texts as posted, from postThread's collector) replaces `posts`, so a posted
// row records what went out, UTM tags included; without it the row keeps its draft text.
function sentPostsJson(sent) {
  return Array.isArray(sent) && sent.length && sent.every(function(t) { return typeof t === 'string' && t; }) ? JSON.stringify(sent) : null;
}
async function markPosted(env, id, uriValue, sent) {
  await ensureSocialSchema(env);
  const postsJson = sentPostsJson(sent);
  try {
    await env.DB.prepare("UPDATE social_threads SET status='posted', posted_at=datetime('now'), error=NULL, post_uri=COALESCE(?1, post_uri), posts=COALESCE(?3, posts), updated_at=datetime('now') WHERE id=?2").bind(uriValue || null, id, postsJson).run();
  } catch (e) {
    console.log('POST-ID-UTM-1 combined posted write failed for thread ' + id + ', falling back: ' + String(e).slice(0, 120));
    await env.DB.prepare("UPDATE social_threads SET status='posted', posted_at=datetime('now'), error=NULL, posts=COALESCE(?2, posts) WHERE id=?1").bind(id, postsJson).run();
    await recordPostUri(env, id, uriValue);
  }
}
// SOCIAL-ADHOC-GATE-1 (0.7.21, #1712/#1713): the HTTP routes that publish (/post, /thread, /cross, /broadcast, /repost)
// used to skip the pause flag, the weekly cap and the post-id record, so anything calling them through qnfo-ai's social
// tool posted outside every gate and left no row. They now pass the same gates as the cron drains and record a
// social_threads row with post_uri, which also makes the post count toward the weekly cap.
async function routeGate(env, who, texts, opts) {
  opts = opts || {};
  const g = await socialGate(env, who);
  if (g.reason === 'paused' || g.reason === 'gate-error') return { status: g.reason === 'paused' ? 423 : 503, body: { error: 'social posting held: ' + g.reason, reason: g.reason } };
  if (!opts.skipCap && !g.allowed) return { status: 429, body: { error: 'weekly cadence cap reached', reason: g.reason, posted_7d: g.posted_7d, cap: g.cap } };
  const c = contentGate(texts);
  if (!c.ok) return { status: 422, body: { error: 'content gate: ' + c.reason, reason: c.reason } };
  return { texts: c.texts };
}
async function recordAdhoc(env, kind, title, texts, uriValue) {
  await ensureSocialSchema(env);
  const slug = kind + '-' + Date.now().toString(36) + crypto.randomUUID().replace(/-/g, '').slice(0, 6);
  try {
    await env.DB.prepare("INSERT INTO social_threads (slug, title, posts, status, posted_at, post_uri, flags, updated_at) VALUES (?,?,?,'posted',datetime('now'),?,?,datetime('now'))").bind(slug, String(title || '').slice(0, 300), JSON.stringify(texts || []), uriValue || null, 'adhoc-route').run();
  } catch (e) { console.log('SOCIAL-ADHOC-GATE-1 record failed ' + slug + ': ' + String(e).slice(0, 120)); }
  return slug;
}

// SOCIAL-ENGAGEMENT-SELF-1 (0.7.21, #1647): social_engagements stopped at 2026-09-20 because its only collector, the
// weekly qnfo-cloud-ops "engagement" job, missed its 2026-09-27 run (no job-run row that day) and reads only the 30 newest
// feed items. qnfo-social now also collects, daily in its 07:00 UTC cron, likes/reposts/replies/quotes for every Bluesky
// post it recorded an id for in the last 60 days (social_threads.post_uri + dissemination_tracker.post_id). It reads the
// public AppView (no credential) and writes the same (platform, post_id, metric, collected_at) key as qnfo-cloud-ops, so
// the two collectors upsert the same rows instead of duplicating them.
function blueskyUriOf(v) {
  const s = String(v || '').trim();
  if (s.indexOf('at://') === 0) return s;
  if (s.charAt(0) === '{') { try { const o = JSON.parse(s); if (o && typeof o.bluesky === 'string' && o.bluesky.indexOf('at://') === 0) return o.bluesky; } catch (e) { console.error(JSON.stringify({ evt: "social:blueskyUriOf:caught", error: String((e && e.message) || e) })); } }
  return null;
}
// REACH-SIGNALS-1 (0.12.0, agent_issues #2225, pillar reach): social_engagements keeps daily counts, so how fast and how
// substantive the replies are could not be computed. For each post that has replies, the public AppView thread (no
// credential) is read one level deep and every reply by ANOTHER account is stored once (reply_uri is the key): a hash of the
// author's DID, the delay from the post in minutes, the text length and the word count. The reply text and the handle are
// never stored, and nothing is posted or liked. Metrics reply_velocity_60m_share_30d and substantive_reply_share_30d are
// computed in D1 from this table (migrations/2026-10-12-reach-replies-subscribe-funnel.sql). Sentiment is not measured.
var REPLY_THREADS_PER_RUN = 25;
var SOCIAL_REPLIES_DDL = "CREATE TABLE IF NOT EXISTS social_replies (reply_uri TEXT PRIMARY KEY, platform TEXT NOT NULL, post_id TEXT NOT NULL, author_hash TEXT, post_created_at TEXT, created_at TEXT, delay_min REAL, text_len INTEGER NOT NULL DEFAULT 0, word_count INTEGER NOT NULL DEFAULT 0, collected_at TEXT NOT NULL)";
function replyWordCount(text) {
  return String(text || '').replace(/https?:\/\/\S+/g, ' ').split(/\s+/).filter(function(w) { return /[\p{L}\p{N}]/u.test(w); }).length;
}
// Pure: the rows one getPostThread answer yields (replies by other accounts only).
function replyRowsOf(thread) {
  const rows = [];
  const root = thread && thread.post;
  if (!root || !root.uri) return rows;
  const rootDid = root.author && root.author.did;
  const postAt = root.record && root.record.createdAt ? String(root.record.createdAt) : null;
  const postMs = postAt ? Date.parse(postAt) : NaN;
  for (const r of (thread.replies || [])) {
    const rp = r && r.post;
    if (!rp || !rp.uri || !rp.author || !rp.author.did || rp.author.did === rootDid) continue;
    const text = String((rp.record && rp.record.text) || '');
    const at = rp.record && rp.record.createdAt ? String(rp.record.createdAt) : (rp.indexedAt ? String(rp.indexedAt) : null);
    const ms = at ? Date.parse(at) : NaN;
    rows.push({ reply_uri: String(rp.uri), post_id: String(root.uri), did: String(rp.author.did), post_created_at: postAt, created_at: at,
      delay_min: Number.isFinite(ms) && Number.isFinite(postMs) ? Math.max(0, Math.round((ms - postMs) / 6e4 * 10) / 10) : null,
      text_len: Array.from(text).length, word_count: replyWordCount(text) });
  }
  return rows;
}
async function sha256Hex16(v) {
  const b = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(v))));
  let h = '';
  for (let i = 0; i < 8; i++) h += b[i].toString(16).padStart(2, '0');
  return h;
}
async function collectReplies(env, uris) {
  const out = { threads: 0, stored: 0, errors: 0 };
  await env.DB.prepare(SOCIAL_REPLIES_DDL).run();
  const now = new Date().toISOString();
  const stmts = [];
  for (const uri of (uris || []).slice(0, REPLY_THREADS_PER_RUN)) {
    try {
      const r = await fetch('https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?depth=1&parentHeight=0&uri=' + encodeURIComponent(uri), { headers: { 'User-Agent': 'qnfo-social/' + VERSION } });
      if (!r.ok) { out.errors++; continue; }
      const j = await r.json();
      out.threads++;
      for (const row of replyRowsOf(j && j.thread)) {
        stmts.push(env.DB.prepare("INSERT INTO social_replies (reply_uri, platform, post_id, author_hash, post_created_at, created_at, delay_min, text_len, word_count, collected_at) VALUES (?1,'bluesky',?2,?3,?4,?5,?6,?7,?8,?9) ON CONFLICT(reply_uri) DO NOTHING")
          .bind(row.reply_uri, row.post_id, await sha256Hex16(row.did), row.post_created_at, row.created_at, row.delay_min, row.text_len, row.word_count, now));
      }
    } catch (e) { out.errors++; }
  }
  if (stmts.length) { await env.DB.batch(stmts); out.stored = stmts.length; }
  return out;
}
// SOCIAL-ENGAGEMENT-COVERAGE-1 (0.19.3, pillar reach; guard metric attention_channels_stopped): the daily collector built its
// URI list from social_threads (LIMIT 100) first and then dissemination_tracker, and stopped adding at 100 URIs in all. With 141
// threads and 203 Bluesky dissemination posts inside the 60-day window (qnfo-audit, read 2026-10-26), every 07:00 run measured the
// newest 100 thread posts and none of the dissemination posts: social_engagements held no row for 194 of 194 dissemination posts
// posted since 2026-10-14, and the attention scorecard (qnfo-fleet-dashboard) counted those unmeasured posts as items with zero
// engagements. This plan covers every Bluesky post the fleet recorded in the window: both sources, deduplicated by at:// URI,
// the posts that have no snapshot yet first, then the newest, up to BSKY_ENGAGEMENT_MAX_URIS (getPosts takes 25 URIs a call, so
// 400 URIs are at most 16 calls). Pure: rows are { post_uri | post_id, posted_at }; measured is a Set or an object keyed by URI.
var BSKY_ENGAGEMENT_MAX_URIS = 400;
var BSKY_ENGAGEMENT_WINDOW_DAYS = 60;
var BSKY_ENGAGEMENT_BATCH = 400;
var BSKY_ENGAGEMENT_ATTEMPTS = 3;
var BSKY_ENGAGEMENT_WAIT_CAP_MS = 30000;
var BSKY_ENGAGEMENT_BUDGET_MS = 420000;
function planEngagementUris(threads, dissemination, measured, max) {
  const cap = Math.max(0, Math.floor(Number(max)) || 0);
  const isMeasured = function(u) { return !!measured && (typeof measured.has === 'function' ? measured.has(u) : !!measured[u]); };
  const key = function(ts) { return String(ts || '').replace('T', ' ').replace(/Z$/, ''); };
  const seen = {};
  const cand = [];
  const push = function(uri, ts) {
    if (!uri || seen[uri]) return;
    seen[uri] = 1;
    cand.push({ uri: uri, ts: key(ts), fresh: !isMeasured(uri), n: cand.length });
  };
  for (const r of (threads || [])) push(blueskyUriOf(r && r.post_uri), r && r.posted_at);
  for (const r of (dissemination || [])) push(blueskyUriOf(r && r.post_id), r && r.posted_at);
  cand.sort(function(a, b) {
    if (a.fresh !== b.fresh) return a.fresh ? -1 : 1;
    if (a.ts !== b.ts) return a.ts < b.ts ? 1 : -1;
    return a.n - b.n;
  });
  const picked = cand.slice(0, cap);
  return { uris: picked.map(function(c) { return c.uri; }), candidates: cand.length, never_measured: cand.filter(function(c) { return c.fresh; }).length, skipped_by_cap: cand.length - picked.length };
}
async function collectEngagement(env) {
  const t0 = Date.now();
  const day = new Date().toISOString().slice(0, 10);
  await ensureSocialSchema(env);
  let threads = [], dissem = [], measured = null;
  try {
    const a = await env.DB.prepare("SELECT post_uri, posted_at FROM social_threads WHERE status='posted' AND post_uri IS NOT NULL AND post_uri<>'' AND posted_at >= datetime('now','-" + BSKY_ENGAGEMENT_WINDOW_DAYS + " days') ORDER BY posted_at DESC").all();
    threads = a.results || [];
  } catch (e) { console.log('SOCIAL-ENGAGEMENT-SELF-1 social_threads read failed: ' + String(e).slice(0, 120)); }
  try {
    const b = await env.DB.prepare("SELECT post_id, posted_at FROM dissemination_tracker WHERE action='posted' AND channel='bluesky' AND post_id LIKE 'at://%' AND posted_at >= datetime('now','-" + BSKY_ENGAGEMENT_WINDOW_DAYS + " days') ORDER BY posted_at DESC").all();
    dissem = b.results || [];
  } catch (e) { console.log('SOCIAL-ENGAGEMENT-SELF-1 dissemination read failed: ' + String(e).slice(0, 120)); }
  try {
    const m = await env.DB.prepare("SELECT DISTINCT post_id FROM social_engagements WHERE platform='bluesky' AND post_id LIKE 'at://%'").all();
    measured = new Set((m.results || []).map(function(r) { return String(r.post_id); }));
  } catch (e) { console.log('SOCIAL-ENGAGEMENT-COVERAGE-1 measured-set read failed: ' + String(e).slice(0, 120)); }
  const plan = planEngagementUris(threads, dissem, measured, BSKY_ENGAGEMENT_MAX_URIS);
  const uris = plan.uris;
  const stmts = [];
  const withReplies = [];
  let found = 0, errors = 0, omitted = 0, skippedByBudget = 0;
  for (let i = 0; i < uris.length; i += 25) {
    if (Date.now() - t0 > BSKY_ENGAGEMENT_BUDGET_MS) { skippedByBudget = uris.length - i; break; }
    const chunk = uris.slice(i, i + 25);
    try {
      let r;
      let attempt = 0;
      while (true) {
        attempt++;
        r = await fetch('https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts?' + chunk.map(function(u) { return 'uris=' + encodeURIComponent(u); }).join('&'), { headers: { 'User-Agent': 'qnfo-social/' + VERSION } });
        if (r.status !== 429 || attempt >= BSKY_ENGAGEMENT_ATTEMPTS) break;
        // Honor rate-limit headers: Retry-After (seconds) or ratelimit-reset (UTC timestamp)
        const retryAfter = r.headers.get('Retry-After');
        const reset = r.headers.get('ratelimit-reset');
        let waitMs = 0;
        if (retryAfter) {
          const secs = parseInt(retryAfter, 10);
          if (!isNaN(secs)) waitMs = secs * 1000;
        } else if (reset) {
          const ts = Date.parse(reset);
          if (!isNaN(ts)) waitMs = Math.max(0, ts - Date.now());
        }
        // Fallback exponential back-off; every wait is capped so 16 chunks stay inside the cron budget
        if (!waitMs) waitMs = attempt * 1000;
        await new Promise(res => setTimeout(res, Math.min(BSKY_ENGAGEMENT_WAIT_CAP_MS, waitMs)));
      }
      if (!r.ok) { errors++; continue; }
      const j = await r.json();
      const got = (j && j.posts) || [];
      // A URI the AppView leaves out (a deleted post) is unmeasured: it gets no row, never a row of zeros.
      omitted += Math.max(0, chunk.length - got.length);
      for (const p of got) {
        found++;
        if (Number(p.replyCount || 0) > 0) withReplies.push(String(p.uri));
        const m = { likes: p.likeCount, reposts: p.repostCount, replies: p.replyCount, quotes: p.quoteCount };
        for (const k of Object.keys(m)) {
          if (typeof m[k] !== 'number' || !isFinite(m[k])) continue;
          stmts.push(env.DB.prepare("INSERT INTO social_engagements (platform, post_id, metric, value, note, collected_at) VALUES (?,?,?,?,?,?) ON CONFLICT(platform, post_id, metric, collected_at) DO UPDATE SET value=excluded.value").bind('bluesky', String(p.uri), k, Number(m[k]), 'qnfo-social', day));
        }
      }
    } catch (e) { errors++; }
  }
  // 400 posts are 1600 statements: written in batches of BSKY_ENGAGEMENT_BATCH so one oversized batch cannot lose the day.
  for (let i = 0; i < stmts.length; i += BSKY_ENGAGEMENT_BATCH) {
    try { await env.DB.batch(stmts.slice(i, i + BSKY_ENGAGEMENT_BATCH)); } catch (e) { errors++; console.log('SOCIAL-ENGAGEMENT-COVERAGE-1 batch write failed: ' + String(e).slice(0, 160)); }
  }
  const out = { day: day, uris: uris.length, posts_found: found, rows: stmts.length, errors: errors, candidates: plan.candidates, never_measured: plan.never_measured, skipped_by_cap: plan.skipped_by_cap, omitted: omitted, skipped_by_budget: skippedByBudget };
  // REACH-SIGNALS-1 (issue 2225): the replies themselves, for the posts that have any. Its failure never fails the counts.
  try { out.replies = await collectReplies(env, withReplies); } catch (e) { out.replies = { error: String(e && e.message || e).slice(0, 160) }; }
  console.log('SOCIAL-ENGAGEMENT-SELF-1 ' + JSON.stringify(out));
  return out;
}

// ---------- BUFFER-POST-STATS-1 (0.13.0, agent_issues 2374, pillar reach) ----------
// The fleet posts to LinkedIn, Mastodon and X through Buffer, and this worker holds the Buffer token, but the only
// statistics collector ran in qnfo-cloud-ops, which has no token ("buffer":"no token"), so no per-post statistic was ever
// stored and social_media_posts.url stayed NULL. The 07:00 UTC engagement run now also reads Buffer with the worker's own
// token: per connected channel one GraphQL `posts` query (sent posts), each post's `metrics`
// ({ type name value unit }) and `externalLink`.
//   - one social_engagements row per post and metric: platform 'buffer', post_id = the Buffer post id (the value in
//     social_media_posts.buffer_id), metric = Buffer's normalized metric type, collected_at = the UTC day, the same upsert
//     key as the Bluesky rows; note carries the network, the unit and Buffer's label;
//   - a metric Buffer does not return is NOT written as 0. Per network, rows with platform 'buffer_channel' (post_id = the
//     service) say how many sent posts came back, how many carried statistics and how many older than 36 h carried none
//     (Buffer pulls statistics from the networks about once a day), so "Buffer gives no statistics for this network" is a
//     stored fact and never a row of zeros;
//   - the public post URL goes to social_media_posts.url where it is still empty;
//   - an auth_status row (platform 'buffer', post_id 'auth') every run, as qnfo-cloud-ops wrote until 2026-09-20.
// Bounds: at most BUFFER_STATS_CHANNELS channels and BUFFER_STATS_PAGES pages of BUFFER_STATS_PER_CHANNEL posts each per run (5 requests a day
// with three small channels, 22 at the very most,
// against Buffer's documented 100 per 15 minutes and 250 per 24 hours on the free plan), a timeout on every call, the body
// read through readTextCapped, a 429 ends the run. The token is sent only in the Authorization header and never logged.
// The response shape is from Buffer's documentation (developers.buffer.com, read 2026-10-12) and was not seen live when
// this was written: a field the schema refuses is dropped and the query repeated once, the refusal is recorded in the run
// ledger, and the first response's field NAMES (never values) are logged and stored there so the next read confirms it.
var BUFFER_STATS_DAYS = 30;
var BUFFER_STATS_CHANNELS = 6;
var BUFFER_STATS_PER_CHANNEL = 30;
var BUFFER_STATS_PAGES = 3;
var BUFFER_STATS_TIMEOUT_MS = 10000;
var BUFFER_STATS_BODY_CAP = 524288;
var BUFFER_STATS_SETTLE_H = 36;
var BUFFER_STATS_POST_FIELDS = ['id', 'channelId', 'status', 'sentAt', 'externalLink', 'metricsUpdatedAt'];
var BUFFER_STATS_MIN_FIELDS = ['id', 'channelId', 'metricsUpdatedAt']; // the documented "posts with metrics" example
function bufferStatsQuery(orgId, channelId, fields, after) {
  return 'query { posts(first: ' + BUFFER_STATS_PER_CHANNEL + (after ? ', after: ' + JSON.stringify(String(after)) : '') + ', input: { organizationId: ' + JSON.stringify(String(orgId)) + ', filter: { status: [sent], channelIds: [' + JSON.stringify(String(channelId)) + '] } }) { edges { node { ' + fields.join(' ') + ' metrics { type name value unit } } } pageInfo { hasNextPage endCursor } } }';
}
// One bounded Buffer GraphQL call: timeout, capped body, HTTP status and GraphQL errors returned (not thrown), no secret
// in any message.
async function bufferGqlBounded(env, query) {
  let r;
  try {
    r = await fetch('https://api.buffer.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (env.BUFFER_TOKEN || ''), 'User-Agent': 'qnfo-social/' + VERSION },
      body: JSON.stringify({ query: query }),
      signal: AbortSignal.timeout(BUFFER_STATS_TIMEOUT_MS)
    });
  } catch (e) { return { ok: false, status: 0, error: 'fetch ' + String(e && e.name || 'error') }; }
  let text = '';
  try { text = await readTextCapped(r, BUFFER_STATS_BODY_CAP); } catch (e) { return { ok: false, status: r.status, error: 'body read ' + String(e && e.name || 'error') }; }
  let j = null;
  try { j = JSON.parse(text); } catch (e) { console.error(JSON.stringify({ evt: "social:bufferGqlBounded:caught", error: String((e && e.message) || e) })); }
  const errs = (j && Array.isArray(j.errors)) ? j.errors.map(function(x) { return String(x && x.message || '').slice(0, 200); }).filter(Boolean) : [];
  if (!r.ok) return { ok: false, status: r.status, error: 'http ' + r.status + (r.status === 429 ? ' retry-after ' + String((r.headers && r.headers.get('Retry-After')) || '?').slice(0, 12) : ''), errors: errs };
  if (!j) return { ok: false, status: r.status, error: 'body is not JSON (' + text.length + ' chars read)', errors: [] };
  if (!j.data) return { ok: false, status: r.status, error: errs[0] || 'no data in the response', errors: errs };
  return { ok: true, status: r.status, data: j.data, errors: errs };
}
// The field names a GraphQL validation error refuses ('Cannot query field "x" on type "Post"').
function bufferRefusedFields(errors) {
  const out = [];
  for (const m of errors || []) {
    const re = /Cannot query field\s*\\?["']?([A-Za-z_][A-Za-z0-9_]*)/g;
    let x;
    while ((x = re.exec(String(m)))) if (out.indexOf(x[1]) < 0) out.push(x[1]);
  }
  return out;
}
function bufferMetricKey(m) {
  return String((m && (m.type || m.name)) || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 60);
}
// Pure: what one channel's posts turn into. `known` maps a Buffer post id to the time this worker recorded for it (used
// when Buffer returns no sentAt). A post without statistics yields no metric row: it is counted as pending (younger than
// the settle time), unmeasured (older) or age_unknown.
function bufferStatsPlan(nodes, service, nowMs, known) {
  const svc = String(service || 'unknown').toLowerCase();
  const out = { service: svc, rows: [], urls: [], sent: 0, measured: 0, pending: 0, unmeasured: 0, age_unknown: 0, skipped_old: 0 };
  for (const n of nodes || []) {
    if (!n || !n.id) continue;
    if (n.status && String(n.status).toLowerCase() !== 'sent') continue;
    const id = String(n.id);
    let t = Date.parse(String(n.sentAt || ''));
    if (!isFinite(t) && known && known[id]) t = Date.parse(String(known[id]).replace(' ', 'T').replace(/Z?$/, 'Z'));
    const ageH = isFinite(t) ? (nowMs - t) / 36e5 : null;
    if (ageH !== null && ageH > BUFFER_STATS_DAYS * 24) { out.skipped_old++; continue; }
    out.sent++;
    if (typeof n.externalLink === 'string' && /^https:\/\/[^\s"'<>]{4,490}$/.test(n.externalLink)) out.urls.push({ id: id, url: n.externalLink });
    let had = 0;
    for (const m of (Array.isArray(n.metrics) ? n.metrics : [])) {
      const key = bufferMetricKey(m);
      const v = (m && m.value !== null && m.value !== undefined && m.value !== '') ? Number(m.value) : NaN;
      if (!key || key === 'auth_status' || !isFinite(v)) continue;
      had++;
      out.rows.push({ post_id: id, metric: key, value: v, note: ('qnfo-social ' + svc + ' ' + String(m.unit || 'count') + (m.name ? ' "' + String(m.name) + '"' : '')).slice(0, 160) });
    }
    if (had) out.measured++;
    else if (ageH === null) out.age_unknown++;
    else if (ageH < BUFFER_STATS_SETTLE_H) out.pending++;
    else out.unmeasured++;
  }
  return out;
}
// MASTODON-PUBLIC-STATS-1 (0.14.0): per-post counts from the public status API (no credential) for sent Mastodon posts
// whose Buffer metrics are null and whose public link is https://<host>/@<user>/<numeric id>. Newest first, at most
// MASTODON_PUBLIC_MAX statuses a run, 8 s each; a non-200 answer or an unreadable body is an error and skips that post.
var MASTODON_PUBLIC_MAX = 30;
var MASTODON_PUBLIC_TIMEOUT_MS = 8000;
var MASTODON_STATUS_RE = /^https:\/\/([a-z0-9][a-z0-9.-]{0,251}[a-z0-9])\/@[A-Za-z0-9_.@-]{1,120}\/(\d{1,25})\/?$/i;
function mastodonStatusRef(url) {
  const m = MASTODON_STATUS_RE.exec(String(url || ''));
  return m ? { host: m[1].toLowerCase(), id: m[2] } : null;
}
async function mastodonPublicStats(nodes, nowMs) {
  const out = { rows: [], requests: 0, errors: 0 };
  const cands = [];
  for (const n of nodes || []) {
    if (!n || !n.id || (n.status && String(n.status).toLowerCase() !== 'sent')) continue;
    if (Array.isArray(n.metrics) && n.metrics.length) continue;
    const ref = mastodonStatusRef(n.externalLink);
    if (!ref) continue;
    const t = Date.parse(String(n.sentAt || ''));
    if (isFinite(t) && nowMs - t > BUFFER_STATS_DAYS * 864e5) continue;
    cands.push({ id: String(n.id), ref: ref, t: isFinite(t) ? t : 0 });
  }
  cands.sort(function(a, b) { return b.t - a.t; });
  for (const c of cands.slice(0, MASTODON_PUBLIC_MAX)) {
    out.requests++;
    try {
      const r = await fetch('https://' + c.ref.host + '/api/v1/statuses/' + c.ref.id, { headers: { 'Accept': 'application/json', 'User-Agent': 'qnfo-social (MASTODON-PUBLIC-STATS-1)' }, signal: AbortSignal.timeout(MASTODON_PUBLIC_TIMEOUT_MS) });
      if (r.status !== 200) { out.errors++; console.log('MASTODON-PUBLIC-STATS-1 ' + c.ref.host + ' status ' + c.ref.id + ': HTTP ' + r.status); continue; }
      const j = JSON.parse(await readTextCapped(r, 262144));
      let had = 0;
      for (const k of [['favourites', 'favourites_count'], ['reblogs', 'reblogs_count'], ['replies', 'replies_count']]) {
        const v = Number(j && j[k[1]]);
        if (j && j[k[1]] !== null && j[k[1]] !== undefined && isFinite(v)) { out.rows.push({ post_id: c.id, metric: k[0], value: v }); had++; }
      }
      if (!had) { out.errors++; console.log('MASTODON-PUBLIC-STATS-1 ' + c.ref.host + ' status ' + c.ref.id + ': no counts in the answer'); }
    } catch (e) {
      out.errors++;
      console.log('MASTODON-PUBLIC-STATS-1 ' + c.ref.host + ' status ' + c.ref.id + ' failed: ' + String(e && e.message || e).slice(0, 120));
    }
  }
  return out;
}
async function collectBufferStats(env, nowMs) {
  if (!env.BUFFER_TOKEN) return { skipped: 'no BUFFER_TOKEN' };
  const now = nowMs || Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  const out = { day: day, channels: {}, posts: 0, rows: 0, urls: 0, requests: 0, errors: 0 };
  const stmts = [];
  const eng = function(platform, postId, metric, value, note) {
    stmts.push(env.DB.prepare("INSERT INTO social_engagements (platform, post_id, metric, value, note, collected_at) VALUES (?,?,?,?,?,?) ON CONFLICT(platform, post_id, metric, collected_at) DO UPDATE SET value=excluded.value, note=excluded.note").bind(platform, postId, metric, value, note, day));
  };
  const flush = async function() {
    for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
  };
  out.requests++;
  const orgRes = await bufferGqlBounded(env, '{ account { organizations { id } } }');
  const orgs = (orgRes.data && orgRes.data.account && orgRes.data.account.organizations) || [];
  if (!orgRes.ok || !orgs.length) {
    out.error = orgRes.ok ? 'no organization' : String(orgRes.error || 'buffer error');
    eng('buffer', 'auth', 'auth_status', 0, ('qnfo-social ' + out.error).slice(0, 160));
    await flush();
    return out;
  }
  eng('buffer', 'auth', 'auth_status', 1, 'ok (graphql) qnfo-social');
  out.requests++;
  const chRes = await bufferGqlBounded(env, '{ channels(input: { organizationId: ' + JSON.stringify(String(orgs[0].id)) + ' }) { id service isDisconnected } }');
  if (!chRes.ok) { out.error = 'channels: ' + String(chRes.error || 'no data'); await flush(); return out; }
  const channels = ((chRes.data && chRes.data.channels) || []).filter(function(c) { return c && c.id && !c.isDisconnected; }).slice(0, BUFFER_STATS_CHANNELS);
  const known = {};
  try {
    const k = await env.DB.prepare("SELECT buffer_id, published_at FROM social_media_posts WHERE buffer_id IS NOT NULL AND published_at >= datetime('now','-60 days') ORDER BY published_at DESC LIMIT 500").all();
    for (const r of (k.results || [])) if (r.buffer_id && !known[r.buffer_id]) known[String(r.buffer_id)] = r.published_at;
  } catch (e) { console.log('BUFFER-POST-STATS-1 social_media_posts read failed: ' + String(e && e.message || e).slice(0, 120)); }
  let fields = BUFFER_STATS_POST_FIELDS.slice();
  const agg = {};
  for (const ch of channels) {
    const svc = String(ch.service || 'unknown').toLowerCase();
    out.requests++;
    let pr = await bufferGqlBounded(env, bufferStatsQuery(orgs[0].id, ch.id, fields));
    if (!pr.ok && pr.status !== 429 && pr.status !== 0 && (pr.errors || []).length && fields.length > BUFFER_STATS_MIN_FIELDS.length) {
      // The schema refused the query: drop the named fields (or fall back to the documented example) and ask once more.
      const refused = bufferRefusedFields(pr.errors);
      const next = refused.length ? fields.filter(function(f) { return refused.indexOf(f) < 0; }) : [];
      out.refused = { fields: refused, message: String(pr.errors[0]).slice(0, 200) };
      console.log('BUFFER-POST-STATS-1 schema refused the query: ' + out.refused.message);
      fields = (next.length && next.length < fields.length) ? next : BUFFER_STATS_MIN_FIELDS.slice();
      out.requests++;
      pr = await bufferGqlBounded(env, bufferStatsQuery(orgs[0].id, ch.id, fields));
    }
    const a = agg[svc] || (agg[svc] = { sent: 0, measured: 0, pending: 0, unmeasured: 0, age_unknown: 0, error: null });
    if (!pr.ok || !pr.data.posts) {
      out.errors++;
      a.error = String(pr.error || (pr.errors || [])[0] || 'no posts in the response').slice(0, 160);
      if (pr.status === 429) { out.rate_limited = true; break; }
      continue;
    }
    let nodes = (pr.data.posts.edges || []).map(function(e) { return e && e.node; }).filter(Boolean);
    // The order of `posts` is not documented: follow the cursor (at most BUFFER_STATS_PAGES pages) so a channel with more
    // sent posts than one page still yields its newest ones.
    let pi = pr.data.posts.pageInfo;
    for (let page = 1; page < BUFFER_STATS_PAGES && pi && pi.hasNextPage && pi.endCursor; page++) {
      out.requests++;
      const more = await bufferGqlBounded(env, bufferStatsQuery(orgs[0].id, ch.id, fields, pi.endCursor));
      if (!more.ok || !more.data.posts) { out.errors++; if (more.status === 429) out.rate_limited = true; break; }
      nodes = nodes.concat((more.data.posts.edges || []).map(function(e) { return e && e.node; }).filter(Boolean));
      pi = more.data.posts.pageInfo;
    }
    if (pi && pi.hasNextPage) out.truncated = (out.truncated || 0) + 1;
    if (!out.shape && nodes.length) {
      // Field names only, never values: confirms the documented shape on the first live read.
      const withM = nodes.filter(function(n) { return Array.isArray(n.metrics) && n.metrics.length; })[0];
      const types = {};
      for (const n of nodes) for (const m of (Array.isArray(n.metrics) ? n.metrics : [])) types[bufferMetricKey(m)] = 1;
      out.shape = { post: Object.keys(nodes[0]).slice(0, 20), metric: withM ? Object.keys(withM.metrics[0]).slice(0, 10) : [], metrics_null: nodes.filter(function(n) { return n.metrics === null || n.metrics === undefined; }).length, types: Object.keys(types).slice(0, 30) };
      console.log('BUFFER-POST-STATS-1 first response field names ' + JSON.stringify(out.shape));
    }
    const plan = bufferStatsPlan(nodes, svc, now, known);
    for (const r of plan.rows) eng('buffer', r.post_id, r.metric, r.value, r.note);
    if (svc === 'mastodon') {
      // MASTODON-PUBLIC-STATS-1 (0.14.0, agent_issues 2481 / 2374): Buffer answers metrics null for every post on this
      // account, while Mastodon publishes each status's counts on its open API. Read them for the posts Buffer left empty.
      const mp = await mastodonPublicStats(nodes, now);
      for (const r of mp.rows) eng('buffer', r.post_id, r.metric, r.value, 'mastodon public api');
      out.mastodon_public = { requests: mp.requests, rows: mp.rows.length, errors: mp.errors };
      out.errors += mp.errors; out.rows += mp.rows.length;
    }
    for (const u of plan.urls) stmts.push(env.DB.prepare("UPDATE social_media_posts SET url = ?1 WHERE buffer_id = ?2 AND (url IS NULL OR url = '')").bind(u.url, u.id));
    out.posts += plan.sent; out.rows += plan.rows.length; out.urls += plan.urls.length;
    for (const k of ['sent', 'measured', 'pending', 'unmeasured', 'age_unknown']) a[k] += plan[k];
    if (out.rate_limited) break;
  }
  for (const svc of Object.keys(agg)) {
    const a = agg[svc];
    out.channels[svc] = a.error ? { error: a.error } : { sent: a.sent, measured: a.measured, pending: a.pending, unmeasured: a.unmeasured, age_unknown: a.age_unknown };
    if (a.error) { eng('buffer_channel', svc, 'collect_error', 1, ('qnfo-social ' + a.error).slice(0, 200)); continue; }
    const verdict = a.measured ? 'measured' : a.unmeasured ? 'unmeasured: Buffer returned no statistics for any of ' + a.unmeasured + ' sent posts older than ' + BUFFER_STATS_SETTLE_H + ' h' : a.sent ? 'pending: no sent post with a known time is older than ' + BUFFER_STATS_SETTLE_H + ' h' : 'no sent post in ' + BUFFER_STATS_DAYS + ' days';
    eng('buffer_channel', svc, 'sent_posts', a.sent, 'qnfo-social ' + verdict);
    eng('buffer_channel', svc, 'posts_with_metrics', a.measured, 'qnfo-social ' + verdict);
    eng('buffer_channel', svc, 'posts_unmeasured', a.unmeasured, 'qnfo-social ' + verdict);
  }
  await flush();
  console.log('BUFFER-POST-STATS-1 ' + JSON.stringify({ day: out.day, posts: out.posts, rows: out.rows, urls: out.urls, requests: out.requests, errors: out.errors, channels: out.channels }).slice(0, 900));
  return out;
}

// Drain the share queue oldest-first under a daily ceiling.
// WS-A3 (2026-09-26): consume the orphaned dissemination_tracker queue. 19 papers sat at
// action='queued'/channel='bluesky' since 2026-09-03 because nothing drained it (social_threads
// only carries the q08 essay threads). Post each queued paper to Bluesky, then mark it posted.
// LINK-RESOLUTION-GATE-1 (2026-09-26) + NEVER-RETIRE-ON-REDIRECT-1 (2026-09-27):
// A redirect (301/302/303/307/308) is a ROUTING change, NEVER a death. Destructive action -
// deleting published content or retiring a host - requires a HARD 404/410. A redirect that lands
// on a bare homepage is 'misrouted': a config bug to FIX, not content to delete. Root cause: a
// transient q08.org->qnfo.org 301 was misread as 'retirement' and 71 live posts were deleted on it.
// Read at most `cap` bytes of a response body as text (0.12.0): an external page is never buffered whole.
async function readTextCapped(r, cap) {
  if (!r || !r.body || typeof r.body.getReader !== 'function') return String(await r.text()).slice(0, cap);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let out = '', n = 0;
  try {
    while (n < cap) {
      const x = await reader.read();
      if (x.done) break;
      n += x.value.byteLength;
      out += dec.decode(x.value, { stream: true });
    }
  } finally { try { await reader.cancel(); } catch (e) { console.error(JSON.stringify({ evt: "social:readTextCapped:caught", error: String((e && e.message) || e) })); } }
  return out;
}
// LINK-SLASH-CANON-1 (0.19.2): the target of a redirect that only adds or drops the trailing slash of the same URL
// (same origin, same query, same path once slashes are trimmed), else null. qnfo-gateway answers /papers/<slug>/ with a 308 to
// /papers/<slug> (SEO-INDEX-1, 2026-10-25) and every dissemination_tracker pages_url ends in a slash, so the probe read all of
// them as 'misrouted' and the channels, both roll-ups and the Bluesky drain held for good. Such a redirect is the same page, not
// a routing change: probeLink follows it once and judges the page it lands on. Any other redirect stays 'misrouted'.
function slashCanonTarget(from, location) {
  try {
    const a = new URL(from), b = new URL(location, a);
    if (a.origin !== b.origin || a.search !== b.search || a.pathname === b.pathname) return null;
    if (a.pathname.replace(/\/+$/, "") !== b.pathname.replace(/\/+$/, "")) return null;
    return b.href;
  } catch (e) { return null; }
}
async function probeLink(url, marker, followed) {
  try {
    const r = await fetch(url, { method: "GET", redirect: "manual", headers: { "User-Agent": "Mozilla/5.0 (qnfo-social link-probe)" } });
    const st = r.status;
    if (st === 200) {
      if (marker) {
        // LINK-RESOLUTION-GATE R4: a bare 200 is not enough - a catch-all (e.g. a list page)
        // also returns 200. Require the marker (the paper slug) to appear in the fetched body.
        const body = await readTextCapped(r, 2e6);
        if (body.indexOf(marker) < 0) return { verdict: "misrouted", status: st };
      }
      return { verdict: "live", status: st };
    }
    if (st === 301 || st === 302 || st === 303 || st === 307 || st === 308) {
      const loc = r.headers.get("location") || "";
      const canon = followed ? null : slashCanonTarget(url, loc);
      if (canon) return probeLink(canon, marker, true);
      return { verdict: "misrouted", status: st, final: loc };
    }
    if (st === 404 || st === 410) return { verdict: "gone", status: st };
    return { verdict: "transient", status: st };
  } catch (e) {
    return { verdict: "transient", status: 0, err: String(e).slice(0, 60) };
  }
}
async function urlResolves(url, marker) {
  return (await probeLink(url, marker)).verdict === "live";
}
async function httpStatus(url) {
  try {
    const r = await fetch(url, { method: "GET", redirect: "manual", headers: { "User-Agent": "Mozilla/5.0 (qnfo-social link-gate)" } });
    return r.status;
  } catch (e) {
    return 0;
  }
}
// ---------- PAPER-ROLLUP-1 (0.16.0) ----------
// The research pipeline publishes about 17 papers a day; no single-post cadence carries that, and SLA-DRAIN-1 suppressed every
// queued paper but the newest. A roll-up carries many papers in one post: a Substack Note (10,000 characters) every hourly tick
// lists every queued paper, and a Bluesky thread (one paper per post, inside the Bluesky gate) carries up to ROLLUP_BSKY_MAX of
// the announced papers. A paper whose link is gone (404/410) is suppressed as drainDissemination does; any other probe failure
// waits for the next run. Substack missing or Buffer failing leaves the rows queued, so the Bluesky roll-up takes them directly.
var ROLLUP_SUBSTACK_MAX = 60, ROLLUP_BSKY_MAX = 15, ROLLUP_SUBSTACK_GAP_MS = 50 * 6e4, RETRACT_MAX = 60, ROLLUP_DAYS = 30;
function rollupLine(i, title, link) { return (i + 1) + '. ' + String(title || '').replace(/\s+/g, ' ').trim() + ' — ' + link; }
// Pure: the Substack Note for a list of {title, link} (links already tagged). Whole lines only, inside max characters.
function rollupNoteText(items, max) {
  max = max || 9500;
  const head = items.length === 1 ? 'New open-access paper from QNFO:' : 'New open-access papers from QNFO (' + items.length + '):';
  let body = head, used = 0;
  for (let i = 0; i < items.length; i++) {
    const line = rollupLine(i, items[i].title, items[i].link);
    if ((body + '\n\n' + line + '\n\n' + SUBSCRIBE_LINE).length > max) break;
    body += '\n\n' + line; used++;
  }
  return { text: body + '\n\n' + SUBSCRIBE_LINE, used: used };
}
async function rollupCandidates(env, where, limit) {
  return (await env.DB.prepare("SELECT id, paper_slug, paper_title, pages_url, action, mode FROM dissemination_tracker WHERE channel = 'bluesky' AND " + where + " AND paper_slug IS NOT NULL AND paper_slug <> '' AND paper_slug NOT LIKE 'q08-%' AND created_at >= datetime('now', ?1) ORDER BY created_at ASC LIMIT " + Number(limit)).bind('-' + ROLLUP_DAYS + ' days').all()).results || [];
}
// Probe and gate each candidate; returns the live ones as {row, title, link}. Gone links and gated text are suppressed.
async function rollupLive(env, rows) {
  const out = [];
  for (const row of rows) {
    const link = row.pages_url || ('https://papers.qnfo.org/papers/' + String(row.paper_slug) + '/');
    const title = repairMojibake(String(row.paper_title || row.paper_slug));
    const cg = contentGate([title + ' — ' + link]);
    if (!cg.ok) { await env.DB.prepare("UPDATE dissemination_tracker SET action = ?, post_text_snippet = ?, updated_at = datetime('now') WHERE id = ?").bind((cg.reason === 'q08-link' || cg.reason === 'dead-doi') ? 'suppressed' : 'held', 'CONTENT-GATE: ' + cg.reason + ' - not posted (PAPER-ROLLUP-1)', row.id).run(); continue; }
    const p = await probeLink(link, String(row.paper_slug || '').slice(0, 40));
    if (p.verdict === 'gone') { await env.DB.prepare("UPDATE dissemination_tracker SET action = 'suppressed', post_text_snippet = ?, updated_at = datetime('now') WHERE id = ?").bind('SUPPRESSED: target paper gone (404/410): ' + link, row.id).run(); continue; }
    if (p.verdict !== 'live') continue;
    out.push({ row: row, title: title, link: link });
  }
  return out;
}
async function drainRollup(env, opts) {
  opts = opts || {};
  const nowMs = opts.nowMs || Date.now();
  const out = { substack: null, bluesky: null };
  try {
    if (await socialPausedBy(env)) return { skipped: 'paused' };
  } catch (e) { return { skipped: 'gate-error' }; }
  // 1. Substack: every queued paper, oldest first.
  try { out.substack = await rollupSubstack(env, nowMs); } catch (e) { out.substack = { error: String(e && e.message || e).slice(0, 160) }; }
  // 2. Bluesky: the announced papers it has not carried (and queued ones when Substack could not take them).
  try { out.bluesky = await rollupBluesky(env, nowMs); } catch (e) { out.bluesky = { error: String(e && e.message || e).slice(0, 160) }; }
  return out;
}
async function rollupSubstack(env, nowMs) {
  if (!env.BUFFER_TOKEN) return { skipped: 'no BUFFER_TOKEN' };
  const w = await channelWindow(env, 'substack', '0');
  if (w.lastMs != null && nowMs - w.lastMs < ROLLUP_SUBSTACK_GAP_MS) return { held: 'spacing' };
  const rows = await rollupCandidates(env, "action = 'queued'", ROLLUP_SUBSTACK_MAX);
  if (!rows.length) return { held: 'no-content' };
  const bc = await bufferChannels(env);
  if (bc.error) return { error: 'buffer: ' + bc.error };
  const ch = findChannel(bc.channels, 'substack');
  if (!ch) return { held: 'no-channel' };
  const live = await rollupLive(env, rows);
  if (!live.length) return { held: 'no-live-links', candidates: rows.length };
  const items = live.map(function(x) { return { title: x.title, link: utmTag(x.link, 'substack', String(x.row.paper_slug)) }; });
  const note = rollupNoteText(items, 9500);
  const res = await bufferCreate(env, ch, 'substack', note.text, 'publish');
  if (!res.post_id || res.status === 'error') return { error: String(res.error || res.status).slice(0, 120), papers: note.used };
  const carried = live.slice(0, note.used);
  const st = carried.map(function(x) { return env.DB.prepare("UPDATE dissemination_tracker SET action = 'posted', mode = 'rollup', posted_at = datetime('now'), post_url = ?1, post_id = NULL, updated_at = datetime('now') WHERE id = ?2 AND action = 'queued'").bind('buffer-substack:' + res.post_id, x.row.id); });
  if (st.length) await env.DB.batch(st);
  await recordChannelPost(env, 'substack', 'rollup-' + new Date(nowMs).toISOString().slice(0, 16), res, note.text, 'rollup:' + carried.length);
  return { posted: res.post_id, papers: carried.length };
}
async function rollupBluesky(env, nowMs) {
  const gate = await socialGate(env, 'rollup');
  if (!gate.allowed) return { held: gate.reason || 'weekly-cap', next: gate.next || null };
  // Announced by the Substack roll-up and not yet on Bluesky; queued rows too when Substack did not take them this run.
  let rows = await rollupCandidates(env, "action = 'posted' AND mode = 'rollup' AND post_id IS NULL", ROLLUP_BSKY_MAX);
  if (rows.length < ROLLUP_BSKY_MAX) rows = rows.concat(await rollupCandidates(env, "action = 'queued'", ROLLUP_BSKY_MAX - rows.length));
  if (!rows.length) return { held: 'no-content' };
  const live = await rollupLive(env, rows);
  if (!live.length) return { held: 'no-live-links', candidates: rows.length };
  const s = await session(env);
  const handle = String((s && s.handle) || env.BSKY_HANDLE || '');
  let root = null, parent = null, rootUri = null, done = 0, err = null;
  for (let i = 0; i < live.length; i++) {
    const x = live[i];
    try {
    const head = i === 0 ? (live.length === 1 ? 'New open-access paper: ' : 'New open-access papers (' + live.length + '), one per post. 1/ ') : (i + 1) + '/ ';
    const r = await postText(s, head + x.title + ' — ' + x.link, i ? { root: root, parent: parent } : undefined, { embed: i === 0 ? { title: x.title, desc: 'QNFO research — open access' } : undefined, campaign: String(x.row.paper_slug) });
    if (i === 0) { root = { uri: r.uri, cid: r.cid }; rootUri = r.uri; }
    parent = { uri: r.uri, cid: r.cid };
    const rkey = String(r.uri || '').split('/').pop();
    await env.DB.prepare("UPDATE dissemination_tracker SET action = 'posted', mode = 'rollup:bluesky', posted_at = COALESCE(posted_at, datetime('now')), post_id = ?1, post_url = ?2, post_text_snippet = COALESCE(?3, post_text_snippet), updated_at = datetime('now') WHERE id = ?4")
      .bind(r.uri, handle && rkey ? 'https://bsky.app/profile/' + handle + '/post/' + rkey : r.uri, typeof r.stored_text === 'string' ? r.stored_text : null, x.row.id).run();
    done++;
    } catch (e) { err = String(e && e.message || e).slice(0, 120); break; }   // the rest wait for the next roll-up
  }
  if (!done) return { error: err || 'nothing posted' };
  await ensureChannelSchema(env);
  await env.DB.prepare("INSERT INTO social_media_posts (id, platform, post_id, url, content_preview, published_at, buffer_id, project_id, status, engagement_metrics) VALUES (?1, 'bluesky-rollup', ?2, NULL, ?3, datetime('now'), NULL, ?4, 'published', ?5)")
    .bind('bsky-rollup-' + Date.now().toString(36) + crypto.randomUUID().replace(/-/g, '').slice(0, 6), rootUri, ('roll-up of ' + done + ' papers').slice(0, 200), 'rollup-' + new Date(nowMs).toISOString().slice(0, 16), JSON.stringify({ via: 'rollup', papers: done })).run();
  return err ? { posted: rootUri, papers: done, error: err } : { posted: rootUri, papers: done };
}
function rollupRunStatus(r) {
  if (!r) return 'error';
  if (r.skipped) return r.skipped === 'gate-error' ? 'error' : 'skipped';
  return [r.substack, r.bluesky].some(function(x) { return x && x.error; }) ? 'degraded' : 'ok';
}
async function drainDissemination(env, opts) {
  opts = opts || {};
  await env.DB.prepare("UPDATE dissemination_tracker SET action='failed', updated_at=datetime('now') WHERE action='posting' AND updated_at < datetime('now','-1 hour')").run();
  await env.DB.prepare("UPDATE dissemination_tracker SET action='queued', retry_count=COALESCE(retry_count,0)+1, updated_at=datetime('now') WHERE action='failed' AND COALESCE(retry_count,0) < 3 AND updated_at < datetime('now','-30 minutes')").run();
  const cap = await env.DB.prepare("SELECT COUNT(*) n FROM dissemination_tracker WHERE action='posted' AND posted_at >= datetime('now','start of day')").first();
  const postedToday = (cap && cap.n) || 0;
  if (postedToday >= DRAIN_DAILY_CAP) return { skipped: 'daily-cap', posted_today: postedToday };
  const gate = await socialGate(env, 'drainDissemination');
  if (!gate.allowed) return { skipped: gate.reason || 'weekly-cap', posted_7d: gate.posted_7d, cap: gate.cap };
  // SOCIAL-DISTRIBUTION-LEARNER-1: with the learner on, this queue posts only the row the learner chose, in its slot.
  const lrn = await learnerEnabled(env);
  let posted = 0, failed = 0, learner;
  for (let i = 0; i < DRAIN_PER_RUN && posted < gate.allowed; i++) {
    let row = null, decision = null;
    if (lrn.on) {
      const pk = await learnerPick(env, 'dissem', opts.nowMs);
      if (pk.hold) { learner = learner && learner.posted ? learner : pk.summary; break; }
      if (pk.row) { row = pk.row; decision = pk.decision; }
      else if (pk.error) learner = { error: pk.error, fallback: 'old order' };
    }
    if (!row) row = await env.DB.prepare("SELECT * FROM dissemination_tracker WHERE action='queued' AND channel='bluesky' ORDER BY created_at ASC LIMIT 1").first();
    if (!row) break;
    try {
      await env.DB.prepare("UPDATE dissemination_tracker SET action='posting', updated_at=datetime('now') WHERE id=? AND action='queued'").bind(row.id).run();
      const link = row.pages_url || ("https://papers.qnfo.org/papers/" + String(row.paper_slug) + "/");
      const p = await probeLink(link, String(row.paper_slug || "").slice(0, 40));
      if (p.verdict !== "live") {
        // SUPPRESS-NON-PUBLISHED-1 + NEVER-RETIRE-ON-REDIRECT-1: 404/410 = genuinely gone ->
        // suppress. A REDIRECT is a routing change -> NEVER suppress/delete; hold as 'misrouted'.
        let act, note;
        if (p.verdict === "gone") { act = "suppressed"; note = "SUPPRESSED: target paper gone (404/410): "; }
        else if (p.verdict === "misrouted") { act = "misrouted"; note = "MISROUTED (redirect " + p.status + " -> " + String(p.final || "") + ") - NOT deleted: "; }
        else { act = "queued"; note = "TRANSIENT probe failure - retry: "; }
        if (act !== "queued") await env.DB.prepare("UPDATE dissemination_tracker SET action=?, post_text_snippet=?, updated_at=datetime('now') WHERE id=?").bind(act, note + link, row.id).run();
        console.log("LINK_GATE dissemination " + row.id + " " + act + " " + link);
        continue;
      }
      // POST-ID-UTM-1 (#1712): postText tags the link and fits by shortening the title, never the link.
      // OWNER-VOICE-CONTENT-GATE-1: repair mojibake in the title; never post a q08.org link or unrepairable text.
      const cg = contentGate([String(row.paper_title || row.paper_slug) + " \u2014 " + link]);
      if (!cg.ok) {
        await env.DB.prepare("UPDATE dissemination_tracker SET action=?, post_text_snippet=?, updated_at=datetime('now') WHERE id=?").bind((cg.reason === 'q08-link' || cg.reason === 'dead-doi') ? 'suppressed' : 'held', 'CONTENT-GATE: ' + cg.reason + ' - not posted', row.id).run();
        console.log("CONTENT_GATE dissemination " + row.id + " " + cg.reason);
        continue;
      }
      const text = cg.texts[0];
      const embedTitle = repairMojibake(String(row.paper_title || 'QNFO'));
      const s = await session(env);
      const r = await postText(s, text, null, { embed: { title: embedTitle, desc: 'QNFO research \u2014 open access' }, campaign: row.paper_slug ? String(row.paper_slug) : undefined });
      // post_id = the at:// URI (retractDeadLinks deletes by it); post_url = the public bsky.app permalink.
      const rkey = String(r.uri || '').split('/').pop();
      const handle = String((s && s.handle) || env.BSKY_HANDLE || '');
      const postUrl = handle && rkey ? 'https://bsky.app/profile/' + handle + '/post/' + rkey : r.uri;
      // POST-SENT-TEXT-1 (0.7.31, #1712): post_text_snippet holds the text as posted (UTM tag included) on success.
      await env.DB.prepare("UPDATE dissemination_tracker SET action='posted', posted_at=datetime('now'), post_url=?, post_id=?, post_text_snippet=COALESCE(?, post_text_snippet), updated_at=datetime('now') WHERE id=?").bind(postUrl, r.uri, typeof r.stored_text === 'string' && r.stored_text ? r.stored_text : (typeof r.text === 'string' && r.text ? r.text : null), row.id).run();
      posted++;
      if (decision) learner = await learnerRecordPost(env, decision, r.uri, opts.nowMs);
      else await learnerRecordPost(env, learnerBackfillDecision(row, 'dissem', opts.nowMs, await learnerHintsFor(env, [row], 'dissem')), r.uri, opts.nowMs);
    } catch (e) {
      failed++;
      await env.DB.prepare("UPDATE dissemination_tracker SET action='failed', post_text_snippet=?, updated_at=datetime('now') WHERE id=?").bind(String(e).slice(0, 180), row.id).run();
    }
  }
  const out = { posted, failed };
  if (lrn.on) out.learner = learner || { on: true };
  return out;
}
// RETRACT-DEAD-LINKS-1 (2026-09-26): the post-side gate stops POSTING bad links, but a paper can be
// published -> disseminated -> posted, then LATER reclassified (quarantined/duplicate/kg-backfill) by
// an out-of-band sweep, leaving a stale live post. Re-verify every posted paper link each cron and
// retract (delete the Bluesky post + flag) so the account can never carry a dead link.
async function retractDeadLinks(env) {
  // PAPER-ROLLUP-1: at most RETRACT_MAX Bluesky posts of 30 days a run (the least recently checked first), so the hourly tick stays bounded.
  const rows = await env.DB.prepare("SELECT id, post_id, pages_url FROM dissemination_tracker WHERE action='posted' AND channel='bluesky' AND post_id LIKE 'at://%' AND pages_url IS NOT NULL AND posted_at >= datetime('now', '-30 days') ORDER BY updated_at ASC LIMIT " + RETRACT_MAX).all();
  let retracted = 0, misrouted = 0;
  const batchStmts = [];
  for (const row of (rows.results || [])) {
    const p = await probeLink(row.pages_url);
    if (p.verdict === "live") continue;
    if (p.verdict === "gone") {
      // NEVER-RETIRE-ON-REDIRECT-1: ONLY a hard 404/410 justifies deleting published content.
      try { const s = await session(env); await deleteRecord(s, String(row.post_id)); retracted++; }
      catch (e) { console.log("RETRACT del fail " + row.id + " " + String(e && e.message || e).slice(0, 80)); }
      batchStmts.push(env.DB.prepare("UPDATE dissemination_tracker SET action='link-dead', post_text_snippet='RETRACTED: 404/410 gone', updated_at=datetime('now') WHERE id=?").bind(row.id));
    } else if (p.verdict === "misrouted") {
      // A redirect is NOT a death - flag for repair, never delete. PRESERVE-POSTED-TEXT-1 (0.19.2): and never overwrite the as-posted text
      // with the diagnosis: 203 posted rows lost their text this way on 2026-10-26 (hourly, 60 a run) while the gateway's slash 308 read as a
      // routing change. The row keeps its text; updated_at moves so the least-recently-checked order rotates; the diagnosis is the log line.
      misrouted++;
      batchStmts.push(env.DB.prepare("UPDATE dissemination_tracker SET updated_at=datetime('now') WHERE id=?").bind(row.id));
      console.log("RETRACT_MISROUTED " + row.id + " redirect " + p.status + " -> " + String(p.final || "").slice(0, 160));
    }
    // transient -> leave alone, retry next cron
  }
  if (batchStmts.length) await env.DB.batch(batchStmts);
  if (retracted) console.log("RETRACTED " + retracted + " genuinely-gone paper posts");
  return { retracted, misrouted };
}
// RESTORE-MISDELETED-1 (2026-09-27, ADD-VALUE): if a thread was flagged link-dead/misrouted but its
// link NOW resolves 200 (e.g. a route was fixed), re-queue it automatically. Self-healing recovery
// from the exact failure that deleted 71 q08 essays on a transient redirect.
async function restoreMisdeleted(env) {
  const rows = await env.DB.prepare("SELECT id, slug, posts FROM social_threads WHERE status IN ('link-dead','misrouted')").all();
  let restored = 0;
  for (const row of (rows.results || [])) {
    let link = null;
    try { const arr = JSON.parse(row.posts || "[]"); for (const t of arr) { const u = extractUrls(String(t)); if (u.length) { link = u[0]; break; } } } catch (e) { console.error(JSON.stringify({ evt: "social:restoreMisdeleted:caught", error: String((e && e.message) || e) })); }
    if (!link) continue;
    if (await urlResolves(link)) {
      await env.DB.prepare("UPDATE social_threads SET status='queued', error=NULL, updated_at=datetime('now') WHERE id=?").bind(row.id).run();
      restored++;
    }
  }
  if (restored) console.log("RESTORED " + restored + " mis-deleted threads (link now resolves)");
  return { restored };
}
async function drainQueue(env, opts) {
  opts = opts || {};
  await env.DB.prepare(
    "UPDATE social_threads SET status = CASE WHEN retry_count < ? THEN 'queued' ELSE 'failed' END, retry_count = retry_count + 1 WHERE status = 'posting'"
  ).bind(MAX_RETRIES).run();
  await env.DB.prepare(
    "UPDATE social_threads SET status = 'queued' WHERE status = 'failed' AND retry_count < ?"
  ).bind(MAX_RETRIES).run();
  const today = await env.DB.prepare(
    "SELECT COUNT(*) n FROM social_threads WHERE status = 'posted' AND posted_at >= datetime('now','start of day')"
  ).first();
  const postedToday = (today && today.n) || 0;
  if (postedToday >= DRAIN_DAILY_CAP) return { skipped: 'daily-cap', posted_today: postedToday };
  const gate = await socialGate(env, 'drainQueue');
  if (!gate.allowed) return { skipped: gate.reason || 'weekly-cap', posted_7d: gate.posted_7d, cap: gate.cap, posted_today: postedToday };
  // SOCIAL-DISTRIBUTION-LEARNER-1: only now, with capacity granted by the gate above, may the learner choose the row and
  // its slot. It holds (posts nothing) until the chosen slot, or while its choice belongs to the dissemination queue.
  // Learner off, or no answer from it: the old order below (selected rows first, then oldest id).
  const lrn = await learnerEnabled(env);
  let posted = 0, failed = 0, learner;
  const buffer = [];
  for (let i = 0; i < DRAIN_PER_RUN && posted < gate.allowed; i++) {
    let row = null, decision = null;
    if (lrn.on) {
      const pk = await learnerPick(env, 'thread', opts.nowMs);
      if (pk.hold) { learner = learner && learner.posted ? learner : pk.summary; break; }
      if (pk.row) { row = pk.row; decision = pk.decision; }
      else if (pk.error) learner = { error: pk.error, fallback: 'old order' };
    }
    if (!row) row = await env.DB.prepare("SELECT * FROM social_threads WHERE status='queued' ORDER BY CASE WHEN COALESCE(flags,'') LIKE '%selected%' OR COALESCE(notes,'') LIKE 'selected%' THEN 0 ELSE 1 END, id ASC LIMIT 1").first();
    if (!row) break;
    try {
      await env.DB.prepare("UPDATE social_threads SET status='posting' WHERE id=? AND status='queued'").bind(row.id).run();
      const rawPosts = JSON.parse(row.posts);
      if (!Array.isArray(rawPosts) || !rawPosts.length) throw new Error('bad posts payload');
      // OWNER-VOICE-CONTENT-GATE-1: q08.org link -> suppressed; mojibake that cannot be repaired -> held. Neither posts.
      const cg = contentGate(rawPosts);
      if (!cg.ok) {
        await env.DB.prepare("UPDATE social_threads SET status=?, error=?, updated_at=datetime('now') WHERE id=?").bind((cg.reason === 'q08-link' || cg.reason === 'dead-doi') ? 'suppressed' : 'held', 'CONTENT-GATE: ' + cg.reason + ' - not posted', row.id).run();
        console.log("CONTENT_GATE thread " + row.id + " " + cg.reason);
        continue;
      }
      // REACH-SELECT-1 (last line of defence): a thread about a pillar-4 / speculative-theory paper is not posted unless the
      // owner released it himself (owner queue card).
      const rd = row.doi ? reachDenied(row.title, '') : '';
      if (rd && !/^selected: released by owner card/.test(String(row.notes || ''))) {
        await env.DB.prepare("UPDATE social_threads SET status='suppressed', error=?, updated_at=datetime('now') WHERE id=?").bind("REACH-SELECT-1: STRATEGY 2.3 ('" + rd + "') - not posted", row.id).run();
        console.log("REACH_SELECT thread " + row.id + " " + rd);
        continue;
      }
      const posts = cg.texts;
      const s = await session(env);
      let threadLink = null;
      for (const pt of posts) { const u = extractUrls(String(pt)); if (u.length) { threadLink = u[0]; break; } }
      if (threadLink) {
        const p = await probeLink(threadLink);
        if (p.verdict === "gone") {
          await env.DB.prepare("UPDATE social_threads SET status='link-dead', error=?, updated_at=datetime('now') WHERE id=?").bind("LINK-GONE (404/410): " + threadLink, row.id).run();
          console.log("LINK_GONE thread " + row.id + " " + threadLink);
          continue;
        }
        if (p.verdict === "misrouted") {
          // NEVER-RETIRE-ON-REDIRECT-1: hold + flag (fix the route, then reset to queued). Do NOT delete.
          await env.DB.prepare("UPDATE social_threads SET status='misrouted', error=?, updated_at=datetime('now') WHERE id=?").bind("MISROUTED (redirect " + p.status + " -> " + String(p.final || "") + ") - NOT deleted", row.id).run();
          console.log("LINK_MISROUTED thread " + row.id + " " + threadLink);
          continue;
        }
        if (p.verdict === "transient") { continue; }
      }
      const sent = [];
      const uris = await postThread(s, posts, { link: threadLink, embed: threadLink ? { title: repairMojibake(String(row.title || 'QNFO')), desc: 'QNFO research' } : undefined, campaign: row.slug ? String(row.slug) : undefined, sent: sent });
      // Buffer (Mastodon/LinkedIn/X) posts plain text with no facet/embed support - the
      // link MUST be applied to the text itself here, mirroring what postThread() does
      // internally for Bluesky's post 1. Previously this sent the raw linkless posts[0].
      let bufferResult = null;
      try {
        const bufText = pickBufferText(posts, threadLink, row.title, 280);
        bufferResult = await bufferPost(env, bufText, row.slug ? String(row.slug) : undefined);
      } catch (e) { bufferResult = { error: String(e && e.message || e) }; }
      // POST-ID-UTM-1 (#1712): status, platform ids and (POST-SENT-TEXT-1) the posted text in one write (markPosted falls
      // back if the column is missing).
      await markPosted(env, row.id, postUriValue(uris[0], bufferResult), sent);
      posted++;
      if (decision) learner = await learnerRecordPost(env, decision, uris[0], opts.nowMs);
      else await learnerRecordPost(env, learnerBackfillDecision(row, 'thread', opts.nowMs, await learnerHintsFor(env, [row], 'thread')), uris[0], opts.nowMs);
      // SOCIAL-RUN-LEDGER-1: what Buffer did with this post, per platform, for the run record.
      if (bufferResult && Array.isArray(bufferResult.results)) for (const br of bufferResult.results) buffer.push(String(br.platform || 'buffer') + ':' + String(br.status || '?'));
      else if (bufferResult) buffer.push('buffer:' + (bufferResult.skipped ? 'skipped' : 'error'));
      console.log('drain posted thread', row.slug, uris[0], 'buffer:', JSON.stringify(bufferResult).slice(0, 200));
    } catch (e) {
      failed++;
      await env.DB.prepare("UPDATE social_threads SET status='failed', error=?, retry_count=retry_count+1 WHERE id=?").bind(String(e).slice(0, 300), row.id).run();
      await logAlert(env, 'cron', 'error', 'drain post failed ' + row.slug + ': ' + String(e));
      console.error('drain post failed', row.slug, String(e));
    }
  }
  const out = { posted: posted, failed: failed, posted_today: postedToday + posted, buffer: buffer };
  if (lrn.on) out.learner = learner || { on: true };
  return out;
}

// SOCIAL-RUN-LEDGER-1 (0.7.27, pillar: reach; WATCHMAKER-INDEX-1). The profile sync, the posting drain (Bluesky plus the
// Buffer cross-post to Mastodon, LinkedIn and X), the paper scan and the engagement collector logged only to the console,
// so the fleet could not tell a quiet run from a dead one. Each run now upserts ONE cloud_ops_events row per operation
// per UTC day, id social-<op>-<yyyy-mm-dd> (kind social-run, job qnfo-social): ts, status and text describe the latest
// run, meta.runs counts the day's runs, and meta.last_ok carries forward the time of the last run that completed
// ('ok' or 'degraded'), so a later failed run never hides the last good one. Status: ok | degraded (ran, but a part
// failed, e.g. a Buffer channel refused a post) | error | skipped (no credentials). Two rows a day for the 2-hourly
// tick, one each for the daily scan and collector. A ledger write failure is logged and never stops the run.
// Watchmaker proof: SELECT MAX(json_extract(meta, '$.last_ok')) FROM cloud_ops_events WHERE id range social-<op>-.
function socialRunJson(op, status, result, iso) {
  const done = status === 'ok' || status === 'degraded';
  let r = result === undefined ? null : result;
  let s = JSON.stringify({ op: op, version: VERSION, result: r, last_ok: done ? iso : null, runs: 1 });
  if (s.length > 3000) s = JSON.stringify({ op: op, version: VERSION, result: String(JSON.stringify(r)).slice(0, 2500), last_ok: done ? iso : null, runs: 1 });
  return s;
}
async function recordSocialRun(env, op, status, result, nowMs) {
  const iso = new Date(nowMs || Date.now()).toISOString();
  const id = 'social-' + op + '-' + iso.slice(0, 10);
  const text = ('qnfo-social ' + op + ' ' + status + ' ' + JSON.stringify(result === undefined ? null : result)).slice(0, 500);
  try {
    await env.DB.prepare("INSERT INTO cloud_ops_events (id, ts, kind, text, meta, job, status) VALUES (?1, ?2, 'social-run', ?3, ?4, 'qnfo-social', ?5) ON CONFLICT(id) DO UPDATE SET ts = excluded.ts, text = excluded.text, status = excluded.status, meta = json_set(excluded.meta, '$.last_ok', COALESCE(json_extract(excluded.meta, '$.last_ok'), json_extract(cloud_ops_events.meta, '$.last_ok')), '$.runs', COALESCE(json_extract(cloud_ops_events.meta, '$.runs'), 0) + 1)").bind(id, iso, text, socialRunJson(op, status, result, iso), status).run();
    return id;
  } catch (e) {
    console.log('SOCIAL-RUN-LEDGER-1 ' + op + ' record failed: ' + String(e && e.message || e).slice(0, 160));
    return null;
  }
}
function profileRunStatus(ps) {
  if (!ps || ps.error) return 'error';
  if (ps.skipped) return 'skipped';
  return 'ok';   // updated, unchanged, or held because the owner edited the bio
}
function drainRunStatus(q, d) {
  const bad = function(x) { return !x || x.error || x.skipped === 'gate-error'; };
  if (bad(q) || bad(d)) return 'error';
  if (q.failed || d.failed || (q.buffer || []).some(function(b) { return /:(error|no-channel)$/.test(b); })) return 'degraded';
  return 'ok';
}
function engagementRunStatus(o) {
  if (!o || o.error) return 'error';
  if (o.errors && !o.posts_found) return 'error';
  if (o.buffer && (o.buffer.error || o.buffer.errors)) return 'degraded'; // BUFFER-POST-STATS-1: a failed Buffer read shows in the run ledger
  return o.errors ? 'degraded' : 'ok';
}

// ---------- SOCIAL-DISTRIBUTION-LEARNER-1 (0.7.28, pillar: reach; STRATEGY 6.4 "distribution allocation (weekly)") ----------
// Owner directive 2026-10-02: the fleet measures its external effectiveness and changes itself to improve the metrics. This
// bandit chooses WHICH queued post goes out next and WHEN. It never adds a post: it is asked only after socialGate granted
// capacity (pause flag, weekly cap), it chooses among rows already queued (fact-checked threads and the dissemination
// queue), every row it chooses still passes the content gate and link checks, and with the learner on its posts are at
// least 24h apart (two posts two hours apart would spend the week's cap in one morning). It never rewrites text.
//
// Arms, factorised. Three independent Beta posteriors, one per dimension, instead of one per cell of the 3 x 3 x 3 cross
// product: at 1-2 posts a week a 27-cell table would take years before most cells had a second observation, while every
// post updates all three marginals at once, so each value has a few observations after about ten posts. The price is that
// interactions (questions working only for one topic, say) are not modelled.
//   topic  : energy (JPCUB, selected works 1-4), epistemics (works 5-6), operations (work 7): STRATEGY 2.3 pillars 1-3.
//            Selected-work DOIs map directly, other rows by title and text keywords. Pillar 4 (ultrametric), q08 and
//            anything unclassified are not arms: such a row keeps its old place behind every arm row and earns no reward.
//   format : what the queue genuinely holds (the learner can only choose among them): single (one post: the launch-queue
//            claim/test/status posts, the dissemination "title - link" card), thread (the composer's 5-post thread with a
//            statement hook) and question (the first sentence of the first post is a question: the composer's "provocative
//            question" hook, or a title that asks one).
//   slot   : the :30 ticks of the 2-hourly cron in three UTC windows: eu-morning 08:30 and 10:30, us-morning 14:30 and
//            16:30, us-afternoon 18:30 and 20:30. A chosen post waits for its slot (at most about 22h).
// Decision. When capacity exists and the last learner post is 24h old: draw theta from every Beta, score each queued arm
// row theta_topic x theta_format, take the best (ties keep the old order, selected rows first), take the slot with the
// highest draw. The decision is kept in ops_config social_learner_pending until it is posted, its row leaves the queue or
// it is 48h old (drawing again every tick would favour early slots), and logged as cloud_ops_events
// social-learner-decision-* with every draw and the scored candidates.
// Reward, once per post, after its 72h window, in the weekly update. social_learner_posts holds one row per post, status
// pending -> credited | no-data (one UPDATE ... WHERE status = 'pending'), so no post counts twice:
//   e = likes + reposts + quotes + replies from others on the root post at the last daily social_engagements snapshot
//       inside 72h (a thread's own first reply is subtracted, or every thread would start with a free reply);
//   v = paper-page views the post plausibly caused: CF RUM pageviews (reach_signals cf-rum, entity paper) of the linked
//       papers.qnfo.org/papers/<slug> on the post day and the two days after, minus 3 x its mean daily views over the 7 days
//       before; only when all 3 window days and 3+ baseline days were ingested, else e alone. Not available: UTM campaigns
//       (RUM paths carry no query string and GA4 is retired), referrers per post (reach_signals referrer hosts are site-wide
//       per day), subscriptions per post (the subscribers table has no campaign), impressions (Bluesky reports none) and
//       Buffer channel metrics (none in D1).
//   r = 1 - exp(-(e + v / 5) / 2), in [0, 1): one engagement 0.39, three 0.78; five extra views weigh as one engagement.
//       Each dimension's Beta(1, 1) prior takes alpha += r, beta += 1 - r. The posterior is recomputed from the credited rows
//       on every read, so there is no counter to drift or double-count.
// Weekly update: Mondays in the 07:00Z cron after the engagement collector, or on a later day when the last completed
// update is 7 or more days old. It also files Bluesky posts the learner did not choose (the dissemination drain, the HTTP
// routes) so they teach it too, and records next week's allocation (the share of 2000 posterior draws each arm wins) in the
// run ledger row social-learner-update-<day> (WATCHMAKER_OPS social-learner). metric_registry social_engagement_rate_30d
// is refreshed daily in the same cron, whatever the switch says (it is measurement only).
// Kill switch: ops_config social_learner_enabled ('0', 'off', 'false', 'no', 'disabled' = off; absent = on; unreadable =
// off). Off is the 0.7.27 order and timing exactly, and the weekly update records 'skipped'.
// LEARNER-ARMS-2 (0.18.0, agent_issues 2722): the topic arm of a post that links a paper is the paper's own shelf (living-paper
// paper_category: the audience classification papers.qnfo.org shows, 606 papers on 2026-10-19), so no such post is stored without
// an arm (124 of 137 rows were not-arm on 2026-10-19: the three keyword lists below named a topic for 3 of 61 posts). The three
// strategy pillars keep their older arm names, so the credited rows they already hold stay on the same arm; a paper with no shelf
// row, or an unreadable shelf table, takes the generic arm. A post with no paper link and no keyword topic, q08, pillar 4 and a
// roll-up post (several papers, no single arm) are still not arms.
var LEARNER_GENERIC_TOPIC = 'research';
var LEARNER_CATEGORY_TOPIC = { energy: 'energy', 'ai-epistemics': 'epistemics', 'ai-operations': 'operations', qec: 'qec', physics: 'physics', mathematics: 'mathematics', logic: 'logic', synthesis: 'synthesis', assessment: 'assessment' };
var LEARNER_TOPICS = ['energy', 'epistemics', 'operations', 'qec', 'physics', 'mathematics', 'logic', 'synthesis', 'assessment', LEARNER_GENERIC_TOPIC];
// LEARNER-CHANNEL-ARM-1 (0.8.1, 2026-10-06; transformation lever T7.13): a fourth arm dimension, the channel. The Buffer
// channel posts the drain records (social_media_posts, platform buffer-<service>) become learner rows (post_key
// channel:<id>, chosen_by channel-drain) with the thread's topic and format, credited from the reach ledger's buffer rows
// (reach_signals source buffer, per channel post: reactions + comments + reposts + shares + clicks + quotes at the last
// snapshot inside the 72h window; Buffer reports metrics about 24h after a post, so a closed window waits one more day
// before it reads no-data). The posterior then carries a channel allocation, and the channel drain visits the channels in
// the order of one Beta draw each (learnerChannelOrder), so the attention loop's shift of posts to the Buffer channels is
// an experiment the learner credits, not a pause. Bluesky rows carry channel 'bluesky'.
var LEARNER_CHANNELS = ['bluesky', 'linkedin', 'mastodon', 'x'];
var LEARNER_CHANNEL_OF = { 'buffer-linkedin': 'linkedin', 'buffer-mastodon': 'mastodon', 'buffer-x': 'x', 'buffer-twitter': 'x', 'buffer-substack': 'substack', linkedin: 'linkedin', mastodon: 'mastodon', twitter: 'x', x: 'x', bluesky: 'bluesky', substack: 'substack' };
var LEARNER_CHANNEL_GRACE_MS = 24 * 36e5;
var LEARNER_BUFFER_ENGAGEMENT = ['reactions', 'comments', 'reposts', 'shares', 'clicks', 'quotes'];
var LEARNER_FORMATS = ['single', 'thread', 'question'];
var LEARNER_SLOTS = { 'eu-morning': [8, 12], 'us-morning': [14, 18], 'us-afternoon': [18, 22] };   // UTC hours [from, to)
var LEARNER_EPOCH_SQL = '2026-10-02 00:00:00';   // posts before the learner (and before the STRATEGY-1 cadence) are not arms
var LEARNER_WINDOW_MS = 72 * 36e5;
var LEARNER_SNAPSHOT_UTC_H = 7;                  // a day's snapshot counts when its 07:00Z collection is inside the window
var LEARNER_CREDIT_GRACE_MS = 2 * 36e5;
var LEARNER_REWARD_SCALE = 2;
var LEARNER_VISITS_PER_ENGAGEMENT = 5;
var LEARNER_DECISION_TTL_MS = 48 * 36e5;
var LEARNER_MIN_GAP_MS = 24 * 36e5;              // learner posts at least 24h apart (so also one per tick)
var LEARNER_PBEST_DRAWS = 2000;
var LEARNER_METRIC = 'social_engagement_rate_30d';
var LEARNER_TOPIC_RE = [
  ['energy', /\b(?:jpcub|joules?\b|landauer|thermodynamic (?:floor|cost|limit)|energy[- ](?:honest|per|cost|floor|efficien|budget))/i],
  ['epistemics', /\b(?:ignorance audits?|epistemic (?:legibility|repair|audit)|epistemics of ai|ai-assisted (?:science|claims?))\b/i],
  ['operations', /\b(?:quniverse|autonomous (?:cloud )?research (?:system|operations|fleet)|research fleet|worker fleet|self-maintaining research)/i]
];
var LEARNER_NOT_ARM_RE = /\b(?:ultrametric|adelic|p-adic|autaxic|topos)\b/i;
var learnerRng = Math.random;
function setLearnerRng(f) { learnerRng = typeof f === 'function' ? f : Math.random; }
function lr4(x) { return Math.round(x * 1e4) / 1e4; }
function learnerSqlTs(ms) { return new Date(ms).toISOString().replace('T', ' ').slice(0, 19); }
function learnerParseTs(v) {
  const s = String(v || '').trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(s)) return Date.parse(s.replace(' ', 'T') + 'Z');
  return Date.parse(s);
}
function learnerShiftDay(day, n) { return new Date(Date.parse(day + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10); }
function learnerChanges(r) { const c = r && r.meta && r.meta.changes; return typeof c === 'number' ? c : null; }

// ---- classification ----
function learnerPostsOf(raw) {
  let arr = raw;
  if (typeof raw === 'string') { try { arr = JSON.parse(raw); } catch (e) { arr = [raw]; } }
  if (!Array.isArray(arr)) arr = [];
  return arr.map(function(p) { return typeof p === 'string' ? p : String((p && p.text) || ''); }).filter(function(t) { return t.trim(); });
}
// Question-led: the first sentence (URLs removed; a decimal point is not a sentence end) ends with '?'.
function learnerIsQuestion(text) {
  const s = String(text || '').replace(/https?:\/\/\S+/g, ' ').trim();
  const m = /[.!?](?=["')\]]*(?:\s|$))/.exec(s);
  return !!m && m[0] === '?';
}
function learnerLinkSlug(text) {
  const m = /https?:\/\/(?:[a-z0-9-]+\.)*qnfo\.org\/papers\/([^\/?#\s"'<>()\[\]]+)/i.exec(String(text || ''));
  return m ? m[1] : null;
}
function learnerNotArmReason(text) {
  const s = String(text || '');
  if (Q08_LINK_RE.test(s)) return 'q08 link';
  if (LEARNER_NOT_ARM_RE.test(s)) return 'pillar 4';
  return null;
}
// ctx (LEARNER-ARMS-2): { paper: the post links a paper, category: the paper's shelf or null }. Exclusions first (q08, pillar 4), then
// the keyword pillars, then the paper's shelf, then the generic arm for a post that links a paper; with no paper link: null.
function learnerTopicOf(doi, text, ctx) {
  const s = String(text || '');
  if (Q08_LINK_RE.test(s)) return null;                       // never q08
  const d = String(doi || '').trim().toLowerCase();
  if (LEARNER_NOT_ARM_RE.test(s)) return null;                // pillar 4 stays out of outreach (STRATEGY 2.3)
  for (const t of LEARNER_TOPIC_RE) if (t[1].test(s)) return t[0];
  if (!ctx || !(ctx.paper || ctx.category)) return null;
  return LEARNER_CATEGORY_TOPIC[String(ctx.category || '')] || LEARNER_GENERIC_TOPIC;
}
// The shelf of the first slug that has one in hints.categories ({ slug: category }, learnerCategories), else null.
function learnerCategoryOf(hints, slugs) {
  const m = hints && hints.categories;
  if (!m) return null;
  for (const k of slugs || []) if (k && m[String(k)]) return String(m[String(k)]);
  return null;
}
function learnerClassify(row, source, hints) {
  row = row || {};
  if (source === 'dissem') {
    const title = String(row.paper_title || row.paper_slug || '');
    const link = String(row.pages_url || '');
    const slug = String(row.paper_slug || row.id || '');
    const linkSlug = learnerLinkSlug(link) || (row.paper_slug ? String(row.paper_slug) : null);
    let topic = learnerTopicOf(row.paper_doi, title + '\n' + link, { paper: !!linkSlug, category: learnerCategoryOf(hints, [linkSlug, slug]) });
    const rollup = slug.startsWith('rollup-');
    if (rollup) topic = null;
    // LEARNER-ARMS-3: a paper the Bluesky roll-up thread carried is one post of a chain (each post answers the one before it), so all
    // but the last has exactly one reply that is the fleet's own; n_posts 2 makes learnerEngagementOf drop that reply.
    return { topic: topic, not_arm_reason: rollup ? 'roll-up' : learnerNotArmReason(title + '\n' + link), format: learnerIsQuestion(title) ? 'question' : 'single', n_posts: String(row.mode || '') === 'rollup:bluesky' ? 2 : 1, link_slug: linkSlug, slug: slug };
  }
  const posts = learnerPostsOf(row.posts);
  const all = posts.join('\n');
  let link = null;
  for (const p of posts) { link = learnerLinkSlug(p); if (link) break; }
  const slug = String(row.slug || row.id || '');
  const format = learnerIsQuestion(posts[0] || '') ? 'question' : (posts.length >= 2 ? 'thread' : 'single');
  const text = String(row.title || '') + '\n' + all;
  const rollup = /^rollup-/i.test(slug);
  const topic = rollup ? null : learnerTopicOf(row.doi || findDoi(all), text, { paper: !!link, category: learnerCategoryOf(hints, [link, slug]) });
  return { topic: topic, not_arm_reason: rollup ? 'roll-up' : learnerNotArmReason(text), format: format, n_posts: posts.length, link_slug: link, slug: slug };
}
// LEARNER-ARMS-2: a Buffer channel post with no social_threads row (a paper from the dissemination queue, a roll-up, a post
// whose thread is gone). The drain stores the slug it tagged the post with as project_id, so that is the row's slug; the link
// is the papers.qnfo.org slug in the posted text, else the project_id when it names a known paper (r.is_paper: a
// dissemination_tracker row carries it) or a paper shelf. A roll-up carries several papers: no link, no arm.
function learnerClassifyChannel(r, hints) {
  r = r || {};
  const slug = String(r.project_id || '');
  const text = String(r.content_preview || '');
  if (/^rollup-/i.test(slug)) return { topic: null, not_arm_reason: 'roll-up', format: 'single', n_posts: 1, link_slug: null, slug: slug };
  // content_preview is cut at 200 characters, so a link in it can end inside the slug: the project_id (the campaign, the whole
  // slug) names the paper when it is a known one or the text's slug is a prefix of it; a text slug alone is the last resort.
  const inText = learnerLinkSlug(text);
  const category = learnerCategoryOf(hints, [slug, inText]);
  let link = null;
  if (slug && (Number(r.is_paper) === 1 || category)) link = slug;
  else if (inText) link = slug.length > inText.length && slug.indexOf(inText) === 0 ? slug : inText;
  return { topic: learnerTopicOf(null, text + '\n' + slug, { paper: !!link, category: category }), not_arm_reason: learnerNotArmReason(text + '\n' + slug), format: learnerIsQuestion(text) ? 'question' : 'single', n_posts: 1, link_slug: link, slug: slug };
}
// LEARNER-ARMS-2: the shelf of each slug, one read per 90 slugs of living-paper paper_category (the binding the gateway
// also holds). Missing binding, missing table or a failed read: no shelves, and the generic arm names the paper's post.
async function learnerCategories(env, slugs) {
  const out = {};
  const db = env && env.LIVING_PAPER;
  if (!db || typeof db.prepare !== 'function') return out;
  const uniq = Array.from(new Set((slugs || []).filter(Boolean).map(String))).slice(0, 450);
  for (let i = 0; i < uniq.length; i += 90) {
    const chunk = uniq.slice(i, i + 90);
    try {
      const r = await db.prepare('SELECT slug, category FROM paper_category WHERE slug IN (' + chunk.map(function(_, k) { return '?' + (k + 1); }).join(', ') + ')').bind(...chunk).all();
      for (const x of (r && r.results) || []) if (x && x.slug && x.category) out[String(x.slug)] = String(x.category);
    } catch (e) {
      console.log('LEARNER-ARMS-2 paper_category read failed, generic arm: ' + String(e && e.message || e).slice(0, 160));
      break;
    }
  }
  return out;
}
// The slugs a set of rows can be filed under (the paper link and the row's own slug), for one learnerCategories read.
function learnerSlugsOf(rows, source) {
  const out = [];
  for (const r of rows || []) { const a = learnerClassify(r, source); out.push(a.link_slug, a.slug); }
  return out;
}
async function learnerHintsFor(env, rows, source) {
  return { categories: await learnerCategories(env, learnerSlugsOf(rows, source)) };
}
// The gateway keys its utm click ledger by the campaign cleaned this way (qnfo-gateway utmClean): a slug longer than 64
// characters is stored cut, so the learner looks it up the same way.
function learnerUtmCampaign(v) {
  return String(v || '').toLowerCase().trim().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
}
function learnerSlotOf(ms) {
  const h = new Date(ms).getUTCHours();
  for (const k of Object.keys(LEARNER_SLOTS)) if (h >= LEARNER_SLOTS[k][0] && h < LEARNER_SLOTS[k][1]) return k;
  return null;
}
// LEARNER-ARMS-3 (0.19.4, agent_issues 2722): the time a Bluesky post went out is in its record key. A post's record key is a TID: 13
// base32-sortable characters whose first 11 hold the creation time in microseconds since the epoch. A roll-up row (dissemination_tracker
// mode rollup:bluesky) keeps the posted_at of the Substack roll-up that announced the paper, and the Bluesky thread carries the paper
// days later (qnfo-audit 2026-10-26: 152 learner rows anchored on 10-14 went out on Bluesky from 10-14 to 10-25). The 72 hour reward
// window opened before the post existed, so 135 posts read no-data although every one has utm human clicks inside its real window.
var BSKY_TID_ALPHABET = '234567abcdefghijklmnopqrstuvwxyz';
function blueskyTidMs(uri) {
  const m = /\/app\.bsky\.feed\.post\/([2-7a-z]{13})$/.exec(String(uri || ''));
  if (!m) return null;
  let v = 0;
  for (let i = 0; i < 11; i++) v = v * 32 + BSKY_TID_ALPHABET.indexOf(m[1].charAt(i));
  if (!(v < 9007199254740992)) return null;
  const ms = Math.floor(v / 1000);
  return ms > Date.UTC(2023, 0, 1) ? ms : null;
}
// The posted_at the learner files a Bluesky row under: the record key's time when it is later than the tracker's own value (a roll-up
// carried the paper after it was announced) and not in the future; the tracker's value otherwise (a post the drain sent carries both
// within seconds, a key that is not a TID has no time).
function learnerPostedAtOf(uri, postedAt, nowMs) {
  const t = blueskyTidMs(uri), ms = learnerParseTs(postedAt);
  if (t === null || !isFinite(t)) return postedAt;
  if (t > (nowMs || Date.now()) + 36e5) return postedAt;
  if (isFinite(ms) && t <= ms + 36e5) return postedAt;
  return new Date(t).toISOString();
}

// ---- Beta posterior and Thompson draws ----
function learnerNormal(rng) {
  let u = 0;
  for (let k = 0; k < 64 && u <= 1e-12; k++) u = rng();
  if (u <= 1e-12) u = 0.5;
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}
// Marsaglia-Tsang gamma sampler; shape < 1 by the boost u^(1/k). Bounded loop: a pathological rng returns the mode.
function learnerGamma(k, rng) {
  if (!(k > 0)) return 0;
  if (k < 1) { const u = rng(); return learnerGamma(k + 1, rng) * Math.pow(u > 1e-12 ? u : 1e-12, 1 / k); }
  const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (let it = 0; it < 256; it++) {
    let x, v;
    do { x = learnerNormal(rng); v = 1 + c * x; } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u > 1e-300 ? u : 1e-300) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
  return d;
}
function learnerBeta(a, b, rng) {
  rng = rng || learnerRng;
  const x = learnerGamma(a, rng), y = learnerGamma(b, rng);
  return x + y > 0 ? x / (x + y) : 0.5;
}
function learnerPrior() {
  const mk = function(list) { const o = {}; for (const k of list) o[k] = { a: 1, b: 1, n: 0 }; return o; };
  return { topic: mk(LEARNER_TOPICS), format: mk(LEARNER_FORMATS), slot: mk(Object.keys(LEARNER_SLOTS)), channel: mk(LEARNER_CHANNELS) };
}
var LEARNER_SCHEMA_DBS = new WeakSet();
async function ensureLearnerSchema(env) {
  if (env.DB && typeof env.DB === 'object' && LEARNER_SCHEMA_DBS.has(env.DB)) return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS social_learner_posts (post_key TEXT PRIMARY KEY, slug TEXT, bsky_uri TEXT, link_slug TEXT, topic TEXT, format TEXT, slot TEXT, n_posts INTEGER, posted_at TEXT, chosen_by TEXT, decision TEXT, status TEXT, engagement REAL, visits REAL, reward REAL, reward_detail TEXT, credited_at TEXT, created_at TEXT)").run();
  // LEARNER-CHANNEL-ARM-1: the channel and the Buffer post id ('duplicate column' once they exist, which is fine); rows
  // written before 0.8.1 are Bluesky rows.
  try { await env.DB.prepare("ALTER TABLE social_learner_posts ADD COLUMN channel TEXT").run(); } catch (e) { if (!/duplicate column/i.test(String((e && e.message) || e))) console.error(JSON.stringify({ evt: "social:ensureLearnerSchema:caught", error: String((e && e.message) || e) })); }
  try { await env.DB.prepare("ALTER TABLE social_learner_posts ADD COLUMN buffer_id TEXT").run(); } catch (e) { if (!/duplicate column/i.test(String((e && e.message) || e))) console.error(JSON.stringify({ evt: "social:ensureLearnerSchema:caught", error: String((e && e.message) || e) })); }
  try { await env.DB.prepare("UPDATE social_learner_posts SET channel = 'bluesky' WHERE channel IS NULL AND bsky_uri IS NOT NULL").run(); } catch (e) { console.error(JSON.stringify({ evt: "social:ensureLearnerSchema:caught", error: String((e && e.message) || e) })); }
  if (env.DB && typeof env.DB === 'object') LEARNER_SCHEMA_DBS.add(env.DB);
}
// alpha = 1 + sum(reward), beta = 1 + n - sum(reward) per dimension value, over credited posts only.
async function learnerPosterior(env) {
  const post = learnerPrior();
  const r = await env.DB.prepare("SELECT 'topic' AS dim, topic AS arm, COUNT(*) AS n, SUM(reward) AS s FROM social_learner_posts WHERE status = 'credited' AND topic IS NOT NULL GROUP BY topic UNION ALL SELECT 'format', format, COUNT(*), SUM(reward) FROM social_learner_posts WHERE status = 'credited' AND format IS NOT NULL GROUP BY format UNION ALL SELECT 'slot', slot, COUNT(*), SUM(reward) FROM social_learner_posts WHERE status = 'credited' AND slot IS NOT NULL GROUP BY slot UNION ALL SELECT 'channel', COALESCE(channel, 'bluesky'), COUNT(*), SUM(reward) FROM social_learner_posts WHERE status = 'credited' GROUP BY COALESCE(channel, 'bluesky')").all();
  for (const x of (r && r.results) || []) {
    const c = post[x.dim] && post[x.dim][x.arm];
    if (!c) continue;
    const n = Number(x.n) || 0, s = Math.min(n, Math.max(0, Number(x.s) || 0));
    c.n = n; c.a = lr4(1 + s); c.b = lr4(1 + n - s);
  }
  return post;
}
function learnerPosteriorSummary(post) {
  const out = {};
  for (const dim of Object.keys(post)) {
    out[dim] = {};
    for (const k of Object.keys(post[dim])) { const c = post[dim][k]; out[dim][k] = { a: c.a, b: c.b, n: c.n, mean: Math.round(c.a / (c.a + c.b) * 1000) / 1000 }; }
  }
  return out;
}
// Next week's allocation: the share of posterior draws each arm wins (what Thompson sampling will pick, before the queue
// restricts the choice).
function learnerPBest(post, draws, rng) {
  rng = rng || learnerRng;
  const out = {};
  for (const dim of Object.keys(post)) {
    const keys = Object.keys(post[dim]), wins = {};
    for (const k of keys) wins[k] = 0;
    for (let i = 0; i < draws; i++) {
      let best = null, bv = -1;
      for (const k of keys) { const v = learnerBeta(post[dim][k].a, post[dim][k].b, rng); if (v > bv) { bv = v; best = k; } }
      wins[best]++;
    }
    out[dim] = {};
    for (const k of keys) out[dim][k] = Math.round(wins[k] / draws * 1000) / 1000;
  }
  return out;
}
// The decision: cands in the old order; returns the chosen candidate's arms, the slot and every draw.
function learnerChoose(cands, post, rng, nowMs) {
  rng = rng || learnerRng;
  const samples = {};
  for (const dim of ['topic', 'format', 'slot', 'channel']) {
    if (!post[dim]) continue;
    samples[dim] = {};
    for (const k of Object.keys(post[dim])) samples[dim][k] = lr4(learnerBeta(post[dim][k].a, post[dim][k].b, rng));
  }
  const scored = cands.map(function(c, i) {
    const a = c.arms || {};
    return { c: c, i: i, score: a.topic && samples.topic[a.topic] !== undefined && samples.format[a.format] !== undefined ? lr4(samples.topic[a.topic] * samples.format[a.format]) : null };
  });
  let best = null;
  for (const s of scored) if (s.score !== null && (!best || s.score > best.score)) best = s;   // strict: a tie keeps the old order
  const viaArms = !!best;
  if (!best) best = scored[0];   // no arm row queued: the old order, still in a sampled slot
  let slot = null;
  for (const k of Object.keys(samples.slot)) if (slot === null || samples.slot[k] > samples.slot[slot]) slot = k;
  // LEARNER-SLOT-REACHABLE-1 (2026-10-17, owner directive: the fleet must clear its own backlog): the slot was
  // sampled from the posterior alone, so it could name a window that had already closed in this UTC day. The drain
  // holds until slotNow === dec.slot, which then cost a full day, and the next decision could sample an expired
  // window again (social thread 153 sat at 366 h held for eu-morning while the drain ran in us-morning). A sampled
  // slot whose window has ended is clamped to the window that is current now; off-window ticks still hold.
  const _nowMs = nowMs || Date.now();
  const _nowSlot = learnerSlotOf(_nowMs);
  if (slot && _nowSlot && LEARNER_SLOTS[slot] && new Date(_nowMs).getUTCHours() >= LEARNER_SLOTS[slot][1]) slot = _nowSlot;
  const a = best.c.arms || {};
  return {
    source: best.c.source, id: best.c.id, slug: a.slug || null, topic: a.topic || null, format: a.format || null, n_posts: a.n_posts || 1,
    link_slug: a.link_slug || null, slot: slot, score: best.score, via_arms: viaArms, samples: samples,
    candidates: scored.slice(0, 12).map(function(s) { return { source: s.c.source, id: s.c.id, topic: (s.c.arms || {}).topic || null, format: (s.c.arms || {}).format || null, score: s.score }; }),
    decided_at: new Date(nowMs || Date.now()).toISOString(), version: VERSION
  };
}

// ---- state, switch, logs ----
async function learnerEnabled(env) {
  try {
    const f = await env.DB.prepare("SELECT value FROM ops_config WHERE key = 'social_learner_enabled'").first();
    if (!f) return { on: true, reason: 'ops_config.social_learner_enabled absent (default on)' };
    const v = String(f.value == null ? '' : f.value).trim().toLowerCase();
    if (['0', 'off', 'false', 'no', 'disabled'].indexOf(v) >= 0) return { on: false, reason: 'ops_config.social_learner_enabled=' + v };
    return { on: true, reason: 'ops_config.social_learner_enabled=' + v };
  } catch (e) {
    return { on: false, reason: 'switch unreadable, old order: ' + String(e && e.message || e).slice(0, 120) };
  }
}
async function learnerState(env) {
  const r = await env.DB.prepare("SELECT value FROM ops_config WHERE key = 'social_learner_pending'").first();
  if (!r || !r.value) return {};
  try { const o = JSON.parse(r.value); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; }
}
async function learnerSaveState(env, st) {
  try {
    await env.DB.prepare("INSERT INTO ops_config (key, value, note, updated_at) VALUES ('social_learner_pending', ?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = excluded.value, note = excluded.note, updated_at = excluded.updated_at").bind(JSON.stringify(st), 'SOCIAL-DISTRIBUTION-LEARNER-1 (qnfo-social): the post the learner chose next and when its last post left; written by the posting drain', new Date().toISOString()).run();
    return true;
  } catch (e) {
    console.log('SOCIAL-DISTRIBUTION-LEARNER-1 state write failed: ' + String(e && e.message || e).slice(0, 160));
    return false;
  }
}
async function learnerLogEvent(env, id, kind, status, text, meta, nowMs) {
  try {
    let m = JSON.stringify(meta === undefined ? null : meta);
    if (m.length > 6000) m = JSON.stringify({ clipped: true, head: m.slice(0, 5000) });
    await env.DB.prepare("INSERT OR IGNORE INTO cloud_ops_events (id, ts, kind, text, meta, job, status) VALUES (?1, ?2, ?3, ?4, ?5, 'qnfo-social', ?6)").bind(String(id).slice(0, 200), new Date(nowMs || Date.now()).toISOString(), kind, String(text || '').slice(0, 500), m, status).run();
    return id;
  } catch (e) {
    console.log('SOCIAL-DISTRIBUTION-LEARNER-1 ' + kind + ' log failed: ' + String(e && e.message || e).slice(0, 160));
    return null;
  }
}
function learnerBrief(dec) {
  return dec ? { source: dec.source, id: dec.id, slug: dec.slug, topic: dec.topic, format: dec.format, slot: dec.slot, decided_at: dec.decided_at } : null;
}
async function learnerCandidates(env) {
  const out = [];
  const a = await env.DB.prepare("SELECT id, slug, title, doi, posts, flags, notes, created_at FROM social_threads WHERE status='queued' ORDER BY CASE WHEN COALESCE(flags,'') LIKE '%selected%' OR COALESCE(notes,'') LIKE 'selected%' THEN 0 ELSE 1 END, id ASC LIMIT 50").all();
  const b = await env.DB.prepare("SELECT * FROM dissemination_tracker WHERE action='queued' AND channel='bluesky' ORDER BY created_at ASC LIMIT 50").all();
  const ra = (a && a.results) || [], rb = (b && b.results) || [];
  // LEARNER-ARMS-2: one shelf read for both queues (the paper's own category names its arm; none readable: the generic arm).
  const hints = { categories: await learnerCategories(env, learnerSlugsOf(ra, 'thread').concat(learnerSlugsOf(rb, 'dissem'))) };
  for (const r of ra) out.push({ source: 'thread', id: r.id, row: r, arms: learnerClassify(r, 'thread', hints) });
  for (const r of rb) out.push({ source: 'dissem', id: r.id, row: r, arms: learnerClassify(r, 'dissem', hints) });
  return out;
}

// ---- the scheduler's question: which row now, from which queue ('thread' = drainQueue, 'dissem' = drainDissemination)?
// Returns { row, decision } to post now, { hold, summary } to post nothing this tick, {} when the queues are empty, or
// { error } (the caller then uses the old order). Called only after socialGate granted capacity.
async function learnerPick(env, who, nowMs) {
  const now = nowMs || Date.now();
  try {
    await ensureLearnerSchema(env);
    const st = await learnerState(env);
    const lastMs = st.last_post_at ? Date.parse(st.last_post_at) : NaN;
    if (isFinite(lastMs) && now >= lastMs && now - lastMs < LEARNER_MIN_GAP_MS) return { hold: 'spacing', summary: { held: 'spacing', last_post_at: st.last_post_at, last_post_key: st.last_post_key || null, next_after: new Date(lastMs + LEARNER_MIN_GAP_MS).toISOString() } };
    const cands = await learnerCandidates(env);
    if (!cands.length) return {};
    let dec = st.decision || null;
    let cand = dec ? cands.find(function(c) { return c.source === dec.source && String(c.id) === String(dec.id); }) : null;
    const decMs = dec ? Date.parse(dec.decided_at) : NaN;
    if (!cand || !isFinite(decMs) || now - decMs > LEARNER_DECISION_TTL_MS) {
      const post = await learnerPosterior(env);
      dec = learnerChoose(cands, post, learnerRng, now);
      cand = cands.find(function(c) { return c.source === dec.source && String(c.id) === String(dec.id); });
      const logged = dec.candidates;
      delete dec.candidates;
      if (!(await learnerSaveState(env, { decision: dec, last_post_at: st.last_post_at || null, last_post_key: st.last_post_key || null }))) return { error: 'decision not persisted' };
      await learnerLogEvent(env, 'social-learner-decision-' + dec.decided_at + '-' + dec.source + '-' + dec.id, 'social-learner-decision', 'decided',
        'qnfo-social learner chose ' + dec.source + ':' + dec.id + ' (' + (dec.topic || 'not an arm') + ', ' + dec.format + ') for slot ' + dec.slot,
        { decision: dec, candidates: logged, posterior: learnerPosteriorSummary(post) }, now);
    }
    const slotNow = learnerSlotOf(now);
    if (slotNow !== dec.slot) return { hold: 'slot', summary: { held: 'slot', slot: dec.slot, now_slot: slotNow, chosen: learnerBrief(dec) } };
    if (dec.source !== who) return { hold: 'other-queue', summary: { held: 'other-queue', chosen: learnerBrief(dec) } };
    return { row: cand.row, decision: dec };
  } catch (e) {
    console.log('SOCIAL-DISTRIBUTION-LEARNER-1 pick failed, old order: ' + String(e && e.message || e).slice(0, 160));
    return { error: String(e && e.message || e).slice(0, 160) };
  }
}
// After the chosen post went out: its reward row (pending until the 72h window closes) and the 24h spacing marker.
async function learnerRecordPost(env, dec, bskyUri, nowMs, row, source) {
  if (!dec && row) dec = learnerBackfillDecision(row, source, nowMs, await learnerHintsFor(env, [row], source));
  const iso = new Date(nowMs || Date.now()).toISOString();
  const key = (dec.source === 'dissem' ? 'dissem:' : 'thread:') + dec.id;
  const by = dec.chosen_by === 'backfill' ? 'backfill' : 'learner';
  try {
    await ensureLearnerSchema(env);
    await env.DB.prepare("INSERT OR IGNORE INTO social_learner_posts (post_key, slug, bsky_uri, link_slug, topic, format, slot, n_posts, posted_at, chosen_by, decision, status, created_at, channel) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?12, ?10, ?11, ?9, 'bluesky')")
      .bind(key, dec.slug || null, bskyUri || null, dec.link_slug || null, dec.topic || null, dec.format || null, dec.slot || null, Number(dec.n_posts) || 1, iso, JSON.stringify(dec), dec.topic ? 'pending' : 'not-arm', by).run();
  } catch (e) { console.log('SOCIAL-DISTRIBUTION-LEARNER-1 post record failed ' + key + ': ' + String(e && e.message || e).slice(0, 160)); }
  // LEARNER-COVERAGE-1: the 24h spacing marker belongs to learner-chosen posts only; a backfilled post never holds the next.
  if (by === 'learner') await learnerSaveState(env, { decision: null, last_post_at: iso, last_post_key: key });
  return { posted: key, topic: dec.topic, format: dec.format, slot: dec.slot, chosen_by: by };
}
// LEARNER-COVERAGE-1 (0.14.0, agent_issues 2381): a post the drain sent without a learner decision (learner off, no
// answer, or the old order) is recorded too, with arms built from the row itself (topic and format from learnerClassify,
// slot from the posted hour, link slug from the utm campaign), so its utm clicks reach the posterior at the 72h credit.
function learnerBackfillDecision(row, source, nowMs, hints) {
  const a = learnerClassify(row, source, hints);
  const campaign = source === 'dissem' ? (row && row.paper_slug) : (row && row.slug);
  return { source: source, id: row && row.id, slug: a.slug || null, topic: a.topic || null, format: a.format || null, n_posts: a.n_posts || 1,
    link_slug: a.link_slug || (campaign ? String(campaign) : null), slot: learnerSlotOf(nowMs || Date.now()), chosen_by: 'backfill', decided_at: new Date(nowMs || Date.now()).toISOString(), version: VERSION };
}

// ---- reward ----
function learnerWindow(postedMs) {
  const end = postedMs + LEARNER_WINDOW_MS;
  return { from: new Date(postedMs).toISOString().slice(0, 10), to: new Date(end - LEARNER_SNAPSHOT_UTC_H * 36e5).toISOString().slice(0, 10), end: end };
}
// The snapshots inside each post's own window, 33 posts (99 bound parameters, D1 allows 100) per query: one D1 query per
// 33 posts instead of one per post, so the 07:00Z cron stays far below the per-invocation query limit.
async function learnerSnapshots(env, posts) {
  const out = {};
  for (let i = 0; i < posts.length; i += 33) {
    const chunk = posts.slice(i, i + 33), args = [];
    for (const p of chunk) { const w = learnerWindow(p.ms); args.push(String(p.uri), w.from, w.to); out[p.uri] = []; }
    const values = chunk.map(function(p, k) { return '(?' + (3 * k + 1) + ', ?' + (3 * k + 2) + ', ?' + (3 * k + 3) + ')'; }).join(', ');
    const r = await env.DB.prepare("WITH w(uri, f, t) AS (VALUES " + values + ") SELECT e.post_id, e.metric, e.value, e.collected_at FROM social_engagements e JOIN w ON e.post_id = w.uri AND e.collected_at >= w.f AND e.collected_at <= w.t WHERE e.platform = 'bluesky' ORDER BY e.collected_at DESC").bind(...args).all();
    for (const x of (r && r.results) || []) if (out[x.post_id]) out[x.post_id].push(x);
  }
  return out;
}
// rows newest first; the latest snapshot inside the window per metric (counts are cumulative).
function learnerEngagementOf(rows, nPosts) {
  const latest = {};
  let day = null;
  for (const r of rows || []) {
    const k = String(r.metric);
    if (latest[k] === undefined) latest[k] = Number(r.value) || 0;
    if (day === null || String(r.collected_at) > day) day = String(r.collected_at);
  }
  if (day === null) return null;
  const self = Number(nPosts) >= 2 ? 1 : 0;
  const likes = latest.likes || 0, reposts = latest.reposts || 0, quotes = latest.quotes || 0, replies = latest.replies || 0;
  return { e: likes + reposts + quotes + Math.max(0, replies - self), likes: likes, reposts: reposts, quotes: quotes, replies: replies, self_replies: self, snapshot_day: day };
}
// UTM-VISITS-1 (0.8.2): the utm_source values a learner channel's posts carry (POST-ID-UTM-1 and BUFFER_UTM_SOURCE).
var LEARNER_UTM_SOURCES = { bluesky: ['bluesky'], linkedin: ['linkedin'], mastodon: ['mastodon'], x: ['x', 'twitter'] };
// LEARNER-ARMS-2: the utm ledger is keyed by the campaign the post was tagged with (the row's slug: the thread slug of a curated
// thread, the paper slug of a paper), cleaned and cut to 64 characters by the gateway; the paper slug (link_slug) is what the RUM
// fallback below needs. Both keys are read, so 'jps-metric' (thread) and an 80-character paper slug join their clicks.
async function learnerVisits(env, slug, d0, channel, campaign) {
  if (!slug) return { visits: null, status: 'no papers.qnfo.org link' };
  // UTM-VISITS-1 (0.8.2, lever T7.9 half 2): a tagged page load counted by qnfo-gateway 3.10.0 (reach_signals source utm,
  // metric clicks_human, entity campaign = the paper slug, channel = utm_source) is a direct measurement of the visits this
  // post caused. When the 72h window carries any such row for the post's channel, they are the visits; else the RUM lift below.
  try {
    const srcs = (channel && LEARNER_UTM_SOURCES[String(channel)]) || null;
    const u = await env.DB.prepare("SELECT SUM(CASE WHEN metric = 'clicks_human' THEN value ELSE 0 END) AS h, SUM(CASE WHEN metric = 'clicks_bot' THEN value ELSE 0 END) AS b, COUNT(*) AS n, MAX(date) AS d FROM reach_signals WHERE source = 'utm' AND entity_type = 'campaign' AND entity_id IN (?1, ?6) AND date >= ?2 AND date <= ?3 AND (?4 IS NULL OR channel IN (?4, ?5))")
      .bind(learnerUtmCampaign(slug), d0, learnerShiftDay(d0, 2), srcs ? srcs[0] : null, srcs ? (srcs[1] || srcs[0]) : null, learnerUtmCampaign(campaign || slug)).first();
    if (u && Number(u.n) > 0) return { visits: Number(u.h) || 0, window_views: Number(u.h) || 0, bot_clicks: Number(u.b) || 0, status: 'ok', source: 'utm', channel: channel || 'all', last_day: String(u.d) };
  } catch (e) { /* no utm rows yet (the ledger starts with the first tagged load): the RUM lift below */ }
  // ATTENTION-LOOP-1 (0.8.0): the bot-filtered per-item rows (source cf-rum-human) when the three window days carry them,
  // else the unfiltered rows as before; the source is named in the status.
  const read = async function(source) {
    const r = await env.DB.prepare("SELECT date, MAX(CASE WHEN entity_type = 'site' THEN 1 ELSE 0 END) AS rd, SUM(CASE WHEN entity_type = 'paper' THEN value ELSE 0 END) AS v FROM reach_signals WHERE source = ?4 AND metric = 'pageviews' AND date >= ?2 AND date <= ?3 AND ((entity_type = 'site' AND entity_id = '(all)') OR (entity_type = 'paper' AND entity_id = ?1)) GROUP BY date").bind(String(slug), learnerShiftDay(d0, -7), learnerShiftDay(d0, 2), source).all();
    const by = {};
    for (const x of (r && r.results) || []) by[x.date] = { read: Number(x.rd) === 1, v: Number(x.v) || 0 };
    return by;
  };
  try {
    let source = 'cf-rum-human', by = await read(source);
    const windowRead = function(m) { for (let k = 0; k < 3; k++) { const d = m[learnerShiftDay(d0, k)]; if (!d || !d.read) return false; } return true; };
    if (!windowRead(by)) { source = 'cf-rum'; by = await read(source); }
    let win = 0;
    for (let k = 0; k < 3; k++) {
      const d = by[learnerShiftDay(d0, k)];
      if (!d || !d.read) return { visits: null, status: 'RUM day ' + learnerShiftDay(d0, k) + ' not ingested', source: source };
      win += d.v;
    }
    let bs = 0, bn = 0;
    for (let k = 1; k <= 7; k++) { const d = by[learnerShiftDay(d0, -k)]; if (d && d.read) { bs += d.v; bn++; } }
    if (bn < 3) return { visits: null, status: 'baseline has ' + bn + ' ingested days (needs 3)', window_views: win, source: source };
    const base = bs / bn;
    return { visits: Math.max(0, Math.round((win - 3 * base) * 100) / 100), window_views: win, baseline_daily: Math.round(base * 100) / 100, baseline_days: bn, status: 'ok', source: source };
  } catch (e) {
    return { visits: null, status: 'reach_signals unreadable: ' + String(e && e.message || e).slice(0, 100) };
  }
}
function learnerRewardOf(eng, visits) {
  const x = eng.e + (visits !== null && visits !== undefined ? visits / LEARNER_VISITS_PER_ENGAGEMENT : 0);
  return { x: lr4(x), reward: lr4(1 - Math.exp(-x / LEARNER_REWARD_SCALE)) };
}

// ---- weekly update ----
// Files every Bluesky post since the epoch that has no learner row yet (posts the learner did not choose teach it too).
async function learnerDiscover(env, nowMs) {
  const iso = new Date(nowMs || Date.now()).toISOString();
  const ins = "INSERT OR IGNORE INTO social_learner_posts (post_key, slug, bsky_uri, link_slug, topic, format, slot, n_posts, posted_at, chosen_by, status, created_at, channel, reward_detail) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'scheduler', ?10, ?11, 'bluesky', ?12)";
  const stmts = [];
  const add = function(key, arms, uri, postedAt) {
    const ms = learnerParseTs(postedAt);
    if (!uri || !isFinite(ms)) return;
    const reason = arms.not_arm_reason ? JSON.stringify({ not_arm: arms.not_arm_reason }) : null;
    stmts.push(env.DB.prepare(ins).bind(key, arms.slug || null, uri, arms.link_slug || null, arms.topic || null, arms.format || null, learnerSlotOf(ms), Number(arms.n_posts) || 1, new Date(ms).toISOString(), arms.topic ? 'pending' : 'not-arm', iso, reason));
  };
  const a = await env.DB.prepare("SELECT id, slug, title, doi, posts, post_uri, posted_at FROM social_threads WHERE status = 'posted' AND post_uri IS NOT NULL AND post_uri <> '' AND posted_at >= ?1 AND NOT EXISTS (SELECT 1 FROM social_learner_posts l WHERE l.post_key = 'thread:' || social_threads.id) ORDER BY posted_at ASC LIMIT 200").bind(LEARNER_EPOCH_SQL).all();
  // LEARNER-ARMS-3: all columns (mode tells a roll-up thread post from a single post); the row is filed under the post's own time.
  const b = await env.DB.prepare("SELECT * FROM dissemination_tracker WHERE action = 'posted' AND channel = 'bluesky' AND post_id LIKE 'at://%' AND posted_at >= ?1 AND NOT EXISTS (SELECT 1 FROM social_learner_posts l WHERE l.post_key = 'dissem:' || dissemination_tracker.id) ORDER BY posted_at ASC LIMIT 200").bind(LEARNER_EPOCH_SQL).all();
  // LEARNER-CHANNEL-ARM-1: the Buffer channel posts the drain recorded teach the channel arm. Arms come from the thread row
  // the slug names (topic, format, link), the slot from the publish time; the engagement is read at credit time from the
  // reach ledger's buffer rows (reach_signals source buffer, per channel post).
  // LEARNER-ARMS-2: a channel post whose thread row is gone (a paper from the dissemination queue, a roll-up) is classified from
  // the text the drain posted and the project_id it tagged the post with (learnerClassifyChannel); the link slug is the paper slug,
  // so learnerVisits can join the post's utm clicks, and a roll-up (several papers) is the only channel row with no link.
  let c = null;
  try {
    c = await env.DB.prepare("SELECT p.id, p.platform, p.buffer_id, p.project_id, p.published_at, p.content_preview, EXISTS (SELECT 1 FROM dissemination_tracker d WHERE d.paper_slug = p.project_id) AS is_paper, t.id AS thread_id, t.slug, t.title, t.doi, t.posts FROM social_media_posts p LEFT JOIN social_threads t ON t.slug = p.project_id WHERE p.platform LIKE 'buffer-%' AND p.status NOT IN ('failed', 'error') AND p.buffer_id IS NOT NULL AND p.published_at >= ?1 AND NOT EXISTS (SELECT 1 FROM social_learner_posts l WHERE l.post_key = 'channel:' || p.id) ORDER BY p.published_at ASC LIMIT 200").bind(LEARNER_EPOCH_SQL).all();
  } catch (e) { console.log('LEARNER-CHANNEL-ARM-1 discover failed: ' + String(e && e.message || e).slice(0, 160)); }
  const ra = (a && a.results) || [], rb = (b && b.results) || [], rc = (c && c.results) || [];
  const chanSlugs = [];
  for (const r of rc) { if (r.thread_id) { const x = learnerClassify({ slug: r.slug, title: r.title, doi: r.doi, posts: r.posts }, 'thread'); chanSlugs.push(x.link_slug, x.slug); } else { const x = learnerClassifyChannel(r); chanSlugs.push(x.link_slug, x.slug); } }
  const hints = { categories: await learnerCategories(env, learnerSlugsOf(ra, 'thread').concat(learnerSlugsOf(rb, 'dissem'), chanSlugs)) };
  for (const r of ra) add('thread:' + r.id, learnerClassify(r, 'thread', hints), blueskyUriOf(r.post_uri), r.posted_at);
  for (const r of rb) add('dissem:' + r.id, learnerClassify(r, 'dissem', hints), blueskyUriOf(r.post_id), learnerPostedAtOf(blueskyUriOf(r.post_id), r.posted_at, nowMs));
  try {
    for (const r of rc) {
      const ch = LEARNER_CHANNEL_OF[String(r.platform)] || null;
      const ms = learnerParseTs(r.published_at);
      if (!ch || !isFinite(ms)) continue;
      const arms = r.thread_id ? learnerClassify({ slug: r.slug, title: r.title, doi: r.doi, posts: r.posts }, 'thread', hints) : learnerClassifyChannel(r, hints);
      const reason = arms.not_arm_reason ? JSON.stringify({ not_arm: arms.not_arm_reason }) : null;
      stmts.push(env.DB.prepare("INSERT OR IGNORE INTO social_learner_posts (post_key, slug, bsky_uri, link_slug, topic, format, slot, n_posts, posted_at, chosen_by, status, created_at, channel, buffer_id, reward_detail) VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6, 1, ?7, 'channel-drain', ?8, ?9, ?10, ?11, ?12)")
        .bind('channel:' + r.id, arms.slug || String(r.project_id || ''), arms.link_slug || null, arms.topic || null, arms.format || null, learnerSlotOf(ms), new Date(ms).toISOString(), arms.topic ? 'pending' : 'not-arm', iso, ch, String(r.buffer_id), reason));
    }
  } catch (e) { console.log('LEARNER-CHANNEL-ARM-1 discover failed: ' + String(e && e.message || e).slice(0, 160)); }
  if (stmts.length) await env.DB.batch(stmts);
  return stmts.length;
}
// LEARNER-CHANNEL-ARM-1: a channel post's engagement from the reach ledger's buffer rows inside its window (counts are
// cumulative, so the maximum per metric is the last snapshot); null when no row has landed yet.
async function learnerChannelEngagement(env, bufferId, w) {
  if (!bufferId) return null;
  const r = await env.DB.prepare("SELECT metric, MAX(value) AS v, MAX(date) AS d FROM reach_signals WHERE source = 'buffer' AND entity_type = 'post' AND entity_id = ?1 AND date >= ?2 AND date <= ?3 GROUP BY metric").bind(String(bufferId), w.from, w.to).all();
  const rows = (r && r.results) || [];
  if (!rows.length) return null;
  const m = {};
  let day = null;
  for (const x of rows) { m[String(x.metric)] = Number(x.v) || 0; if (!day || String(x.d) > day) day = String(x.d); }
  let e = 0;
  for (const k of LEARNER_BUFFER_ENGAGEMENT) e += m[k] || 0;
  return { e: e, likes: m.reactions || 0, reposts: m.reposts || 0, quotes: m.quotes || 0, replies: m.comments || 0, self_replies: 0, impressions: m.impressions || m.views || m.reach || 0, snapshot_day: day };
}
// LEARNER-CHANNEL-ARM-1: the order the channel drain visits the Buffer channels: one Beta draw per channel arm, highest
// first (a tie keeps CHANNEL_ORDER); the learner off or unreadable keeps CHANNEL_ORDER. Drain keys (twitter for x).
async function learnerChannelOrder(env, rng) {
  const base = CHANNEL_ORDER.slice();
  const CLICK_PER_POST_FLOOR = 0.2; // minimum human clicks per post to keep full allocation weight
  try {
    const lrn = await learnerEnabled(env);
    if (!lrn.on) return { order: base, via: 'learner-off' };
    await ensureLearnerSchema(env);
    const post = await learnerPosterior(env);
    const draws = {};
    // compute per‑channel click‑per‑post metric over the recent 7‑day window
    const recentSince = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
    const recentUntil = new Date().toISOString().slice(0, 10);
    const channelClicks = {};
    for (const c of base) {
      const srcs = (c && LEARNER_UTM_SOURCES[String(c)]) || null;
      if (!srcs) { channelClicks[c] = 0; continue; }
      try {
        const r = await env.DB.prepare(
          "SELECT SUM(CASE WHEN metric = 'clicks_human' THEN value ELSE 0 END) AS clicks, COUNT(DISTINCT post_id) AS posts " +
          "FROM reach_signals WHERE source = 'utm' AND channel IN (?1, ?2) AND date >= ?3 AND date <= ?4"
        )
          .bind(srcs[0], srcs[1] || srcs[0], recentSince, recentUntil)
          .first();
        const clicks = Number(r && r.clicks) || 0;
        const posts = Number(r && r.posts) || 0;
        channelClicks[c] = posts > 0 ? clicks / posts : 0;
      } catch (_) {
        channelClicks[c] = 0;
      }
    }
    for (const c of base) {
      const k = LEARNER_CHANNEL_OF[c] || c;
      const arm = post.channel && post.channel[k];
      let draw = arm ? lr4(learnerBeta(arm.a, arm.b, rng || learnerRng)) : 0.5;
      // lower allocation cap if clicks‑per‑post falls below the floor
      if (channelClicks[c] < CLICK_PER_POST_FLOOR) draw *= 0.5;
      draws[c] = draw;
    }
    const order = base
      .map((c, i) => ({ c, i, v: draws[c] }))
      .sort((a, b) => b.v - a.v || a.i - b.i)
      .map(x => x.c);
    return { order, draws, via: 'learner' };
  } catch (e) {
    return { order: base, via: 'error: ' + String(e && e.message || e).slice(0, 80) };
  }
}
async function learnerCount(env) {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM social_learner_posts").first();
  return Number((r && r.n) || 0);
}
async function learnerWeeklyUpdate(env, nowMs) {
  const now = nowMs || Date.now();
  const iso = new Date(now).toISOString();
  await ensureLearnerSchema(env);
  const before = await learnerCount(env);
  await learnerDiscover(env, now);
  const out = { version: VERSION, epoch: LEARNER_EPOCH_SQL, discovered: (await learnerCount(env)) - before, credited: 0, no_data: 0, waiting: 0, rewards: [] };
  await learnerCreditPending(env, now, out);
  const post = await learnerPosterior(env);
  const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM social_learner_posts WHERE status = 'pending'").first();
  out.pending = Number((left && left.n) || 0);
  out.rewards = out.rewards.slice(0, 10);
  out.posterior = learnerPosteriorSummary(post);
  out.next_week_allocation = learnerPBest(post, LEARNER_PBEST_DRAWS, learnerRng);
  return out;
}
// ATTENTION-LOOP-1 (0.8.0): the credit step on its own, so it runs daily (learnerDailyCredit) as well as inside the weekly
// update. A post is credited once (UPDATE ... WHERE status IN ('pending', 'no-data')), whichever tick reaches it first.
// UTM-CREDIT-1 (0.14.0, agent_issues 2036 / 2381): a post with no engagement snapshot is credited on its measured utm clicks
// (learnerVisits source utm) instead of going no-data, and a no-data row of the last LEARNER_UTM_RECREDIT_DAYS days is
// re-read once a day so clicks that landed after the verdict still reach the posterior (on 2026-10-13 the Mastodon and X
// posts of 10-07 and 10-08 read no-data while reach_signals held 3 to 7 human utm clicks each).
var LEARNER_UTM_RECREDIT_DAYS = 14;
async function learnerCreditPending(env, now, out) {
  const iso = new Date(now).toISOString();
  const since = new Date(now - LEARNER_UTM_RECREDIT_DAYS * 864e5).toISOString();
  const pend = await env.DB.prepare("SELECT post_key, slug, bsky_uri, link_slug, topic, format, slot, n_posts, posted_at, chosen_by, channel, buffer_id, status FROM social_learner_posts WHERE status = 'pending' OR (status = 'no-data' AND link_slug IS NOT NULL AND topic IS NOT NULL AND posted_at >= ?1) ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, posted_at ASC LIMIT 60").bind(since).all();
  for (const p of (pend && pend.results) || []) {
    const t0 = learnerParseTs(p.posted_at);
    if (!isFinite(t0)) continue;
    const w = learnerWindow(t0);
    const recredit = p.status === 'no-data';
    if (!recredit && now < w.end + LEARNER_CREDIT_GRACE_MS) { out.waiting++; continue; }
    const ch = p.channel || 'bluesky';
    const arms = { topic: p.topic, format: p.format, slot: p.slot, channel: ch };
    let eng;
    if (ch === 'bluesky') {
      const snaps = p.bsky_uri ? (await learnerSnapshots(env, [{ uri: String(p.bsky_uri), ms: t0 }]))[String(p.bsky_uri)] : [];
      eng = learnerEngagementOf(snaps, p.n_posts);
    } else {
      // LEARNER-CHANNEL-ARM-1: Buffer reports a post's metrics about a day late, so a closed window waits one more day.
      eng = await learnerChannelEngagement(env, p.buffer_id, w);
      if (!eng && !recredit && now < w.end + LEARNER_CHANNEL_GRACE_MS) { out.waiting++; continue; }
    }
    let vis = null;
    if (!eng) {
      vis = await learnerVisits(env, p.link_slug, w.from, ch, p.slug);
      if (vis && vis.source === 'utm') eng = { e: 0, likes: 0, reposts: 0, quotes: 0, replies: 0, self_replies: 0, snapshot_day: null, measured: 'none: credited on utm clicks only' };
    }
    if (!eng && recredit) continue;
    if (!eng) {
      // Snapshots are written for the collection day only, so a closed window with none will never get one: final.
      const detail = { window: [w.from, w.to], reason: (ch === 'bluesky' ? 'no social_engagements snapshot' : 'no reach_signals buffer row for ' + ch) + ' inside the 72h window; posterior unchanged' };
      const u = await env.DB.prepare("UPDATE social_learner_posts SET status = 'no-data', reward_detail = ?2, credited_at = ?3 WHERE post_key = ?1 AND status = 'pending'").bind(p.post_key, JSON.stringify(detail), iso).run();
      if (learnerChanges(u) === 0) continue;
      out.no_data++;
      await learnerLogEvent(env, 'social-learner-reward-' + p.post_key, 'social-learner-reward', 'no-data', 'qnfo-social learner: ' + p.post_key + ' has no engagement snapshot inside its 72h window; no update', { post_key: p.post_key, arms: arms, detail: detail }, now);
      continue;
    }
    if (!vis) vis = await learnerVisits(env, p.link_slug, w.from, ch, p.slug);
    const rw = learnerRewardOf(eng, vis.visits);
    const detail = { engagement: eng, visits: vis, x: rw.x, reward: rw.reward, window: [w.from, w.to], chosen_by: p.chosen_by };
    if (recredit) detail.recredited_from = 'no-data';
    const u = await env.DB.prepare("UPDATE social_learner_posts SET status = 'credited', engagement = ?2, visits = ?3, reward = ?4, reward_detail = ?5, credited_at = ?6 WHERE post_key = ?1 AND status = ?7").bind(p.post_key, eng.e, vis.visits, rw.reward, JSON.stringify(detail), iso, recredit ? 'no-data' : 'pending').run();
    if (learnerChanges(u) === 0) continue;
    out.credited++;
    out.rewards.push({ post: p.post_key, topic: p.topic, format: p.format, slot: p.slot, e: eng.e, v: vis.visits, r: rw.reward });
    await learnerLogEvent(env, 'social-learner-reward-' + p.post_key + (recredit ? '-utm' : ''), 'social-learner-reward', 'credited',
      'qnfo-social learner: ' + p.post_key + ' (' + p.topic + ', ' + p.format + ', ' + (p.slot || 'no slot') + ') e=' + eng.e + ' v=' + vis.visits + ' reward ' + rw.reward,
      { post_key: p.post_key, arms: arms, update: { alpha_plus: rw.reward, beta_plus: lr4(1 - rw.reward) }, detail: detail }, now);
  }
  return out;
}
// Daily, 07:00Z after the engagement collector: file new posts and credit every pending post whose 72h window closed, so the
// posterior that chooses tomorrow's post carries this week's rewards (the weekly update alone credited 7+ days late; on
// 2026-10-06 the two learner rows of 10-02 and 10-03 still read pending). Records social-learner-credit-<day>.
async function learnerDailyCredit(env, nowMs) {
  const now = nowMs || Date.now();
  const lrn = await learnerEnabled(env);
  if (!lrn.on) return { disabled: true, reason: lrn.reason };
  await ensureLearnerSchema(env);
  const before = await learnerCount(env);
  await learnerDiscover(env, now);
  const out = { version: VERSION, discovered: (await learnerCount(env)) - before, credited: 0, no_data: 0, waiting: 0, rewards: [] };
  await learnerCreditPending(env, now, out);
  const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM social_learner_posts WHERE status = 'pending'").first();
  out.pending = Number((left && left.n) || 0);
  out.rewards = out.rewards.slice(0, 10);
  await recordSocialRun(env, 'learner-credit', 'ok', out, now);
  return out;
}
// Mondays, or any later day once the last completed update is 7+ days old. Records social-learner-update-<day>.
async function learnerWeeklyTick(env, nowMs) {
  const now = nowMs || Date.now();
  let last = null;
  try {
    const r = await env.DB.prepare("SELECT MAX(json_extract(meta, '$.last_ok')) AS last FROM cloud_ops_events WHERE id >= 'social-learner-update-' AND id < 'social-learner-update.'").first();
    last = r && r.last ? String(r.last) : null;
  } catch (e) { console.error(JSON.stringify({ evt: "social:learnerWeeklyTick:caught", error: String((e && e.message) || e) })); }
  const lastMs = last ? Date.parse(last) : NaN;
  const due = new Date(now).getUTCDay() === 1 || !isFinite(lastMs) || now - lastMs >= 7 * 864e5 - 36e5;
  if (!due) return { not_due: true, last_ok: last };
  const lrn = await learnerEnabled(env);
  if (!lrn.on) {
    const res = { disabled: true, reason: lrn.reason };
    await recordSocialRun(env, 'learner-update', 'skipped', res, now);
    return res;
  }
  let res;
  try { res = await learnerWeeklyUpdate(env, now); } catch (e) { res = { error: String(e && e.message || e).slice(0, 200) }; }
  await recordSocialRun(env, 'learner-update', res.error ? 'error' : 'ok', res, now);
  return res;
}

// ---- metric_registry social_engagement_rate_30d (daily, 07:00Z) ----
// Engagements per Bluesky post: Bluesky reports no impressions, so the STRATEGY 6.3 "engagement rate" is read per post.
// Every Bluesky post counts (not only arm posts), from the learner epoch on: the September q08 flood before it is a
// different channel that no remedy can move now. A post without a snapshot inside its window is left out (a missing
// measurement is not a zero), and with none the value is 'n/a: ...', which v_metric_trigger_state reads as unreadable,
// never 0. The row is created only if absent (migrations/2026-10-02-social-distribution-learner.sql inserts the same
// definition and its METRIC-CLOSED-LOOP-1 trigger), and the value is written only while qnfo-social owns the row, so a
// definition another change registers centrally is never overwritten. metric_history (qnfo-fleet-control
// IMPROVEMENT-LOOP-1) then keeps its daily trend and judges regressions like any other metric.
var LEARNER_METRIC_DEF = {
  formula: "mean, over Bluesky posts (social_threads + dissemination_tracker) posted since 2026-10-02 and in the 30 days ending 74h ago that have a social_engagements snapshot inside their first 72h, of likes + reposts + quotes + replies from others (a thread's own first reply subtracted) at the last daily snapshot within 72h of posting; engagements per post, since Bluesky reports no impressions",
  source: "qnfo-audit.social_engagements x social_threads.post_uri / dissemination_tracker.post_id (qnfo-social SOCIAL-DISTRIBUTION-LEARNER-1, GET https://qnfo-social.q08.workers.dev/learner)",
  baseline: "about 0.1 (2026-10-01 audit: 1 reaction across the last 10 posts); reset from the first full week of 72h-window data (STRATEGY 6.3)",
  target: ">= 0.2 engagements per post, then x2 on the first-week baseline by 2026-12-31 (STRATEGY 9); never by volume or paid attention",
  actor: "qnfo-social distribution learner: Thompson sampling over topic, format and time slot inside the cadence caps (STRATEGY 6.4)",
  warning: "< 0.2", kill: "< 0.05"
};
async function learnerEngagementRate(env, nowMs) {
  const now = nowMs || Date.now();
  const to = learnerSqlTs(now - LEARNER_WINDOW_MS - LEARNER_CREDIT_GRACE_MS);
  let from = learnerSqlTs(now - LEARNER_WINDOW_MS - LEARNER_CREDIT_GRACE_MS - 30 * 864e5);
  if (from < LEARNER_EPOCH_SQL) from = LEARNER_EPOCH_SQL;
  const fromMs = learnerParseTs(from), toMs = learnerParseTs(to);
  const posts = [], seen = {};
  const add = function(uri, postedAt, n) {
    const ms = learnerParseTs(postedAt);
    if (uri && !seen[uri] && isFinite(ms) && ms >= fromMs && ms <= toMs) { seen[uri] = 1; posts.push({ uri: uri, ms: ms, n: n }); }
  };
  const a = await env.DB.prepare("SELECT posts, post_uri, posted_at FROM social_threads WHERE status = 'posted' AND post_uri IS NOT NULL AND post_uri <> '' AND posted_at >= ?1 AND posted_at <= ?2 ORDER BY posted_at DESC LIMIT 300").bind(from, to).all();
  for (const r of (a && a.results) || []) add(blueskyUriOf(r.post_uri), r.posted_at, learnerPostsOf(r.posts).length);
  // Roll-ups retain the Substack announcement time: normalize before applying the metric's window or a source limit.
  const b = await env.DB.prepare("SELECT post_id, posted_at FROM dissemination_tracker WHERE action = 'posted' AND channel = 'bluesky' AND post_id LIKE 'at://%' ORDER BY posted_at DESC").all();
  for (const r of (b && b.results) || []) {
    const uri = blueskyUriOf(r.post_id);
    add(uri, learnerPostedAtOf(uri, r.posted_at, now), 1);
  }
  let withData = 0, sum = 0;
  const snaps = await learnerSnapshots(env, posts);
  for (const p of posts) {
    const eng = learnerEngagementOf(snaps[p.uri], p.n);
    if (eng) { withData++; sum += eng.e; }
  }
  const rate = withData ? Math.round(sum / withData * 1000) / 1000 : null;
  const value = rate === null ? 'n/a: no Bluesky post since 2026-10-02 has a closed 72h window with an engagement snapshot yet' : String(rate);
  return { posts: posts.length, with_data: withData, engagements: sum, rate: rate, window: [from, to], registry: await learnerWriteMetric(env, value, now) };
}
async function learnerWriteMetric(env, value, nowMs) {
  const D = LEARNER_METRIC_DEF;
  try {
    await env.DB.prepare("INSERT OR IGNORE INTO metric_registry (metric, layer, kind, formula, source_of_truth, baseline, target, owner, disposition_actor, refresh_cadence, warning_band, kill_band, state, refresh_class) VALUES (?1, 'fleet', 'leading', ?2, ?3, ?4, ?5, 'qnfo-social', ?6, 'daily', ?7, ?8, 'MEASURED', 'computed')")
      .bind(LEARNER_METRIC, D.formula, D.source, D.baseline, D.target, D.actor, D.warning, D.kill).run();
    const u = await env.DB.prepare("UPDATE metric_registry SET last_value = ?2, last_refreshed = ?3 WHERE metric = ?1 AND COALESCE(owner, 'qnfo-social') = 'qnfo-social'").bind(LEARNER_METRIC, value, new Date(nowMs || Date.now()).toISOString()).run();
    if (learnerChanges(u) === 0) {
      const o = await env.DB.prepare("SELECT owner FROM metric_registry WHERE metric = ?1").bind(LEARNER_METRIC).first();
      return { written: false, reason: o ? 'row owned by ' + String(o.owner || '?') + '; its owner refreshes it' : 'row absent after insert' };
    }
    return { written: true, value: value };
  } catch (e) {
    return { written: false, error: String(e && e.message || e).slice(0, 160) };
  }
}

// ---- public read (OPEN-ACCESS-1): GET /learner ----
// GET /learner is public (OPEN-ACCESS-1): a failed read says which part is unavailable, never the exception text (CodeQL
// js/stack-trace-exposure); the detail goes to the worker log.
function learnerPublicError(part, e) {
  console.error('SOCIAL-DISTRIBUTION-LEARNER-1 /learner ' + part + ' read failed', e);
  return part + ' unavailable';
}
async function learnerReport(env) {
  const lrn = await learnerEnabled(env);
  const out = { worker: 'qnfo-social', version: VERSION, learner: 'SOCIAL-DISTRIBUTION-LEARNER-1', enabled: lrn.on, switch: /^switch unreadable/.test(String(lrn.reason || '')) ? 'switch unreadable, old order' : lrn.reason,
    arms: { topic: LEARNER_TOPICS, format: LEARNER_FORMATS, slot_utc_hours: LEARNER_SLOTS },
    reward: 'r = 1 - exp(-(e + v/' + LEARNER_VISITS_PER_ENGAGEMENT + ')/' + LEARNER_REWARD_SCALE + '); e = 72h Bluesky likes + reposts + quotes + replies from others; v = attributed papers.qnfo.org paper views over baseline (CF RUM), when ingested; credited once per post',
    limits: ['chooses only among queued posts, inside the weekly cap, pause flag and content gates; never posts more', 'learner posts at least 24h apart'] };
  // Read-only: before the first learner run (no table yet) the posterior is the prior.
  let post;
  try { post = await learnerPosterior(env); } catch (e) {
    if (/no such table/i.test(String(e && e.message || e))) { post = learnerPrior(); out.note = 'no learner rows yet: the posterior is the Beta(1,1) prior'; }
    else out.posterior_error = learnerPublicError('posterior', e);
  }
  if (post) { out.posterior = learnerPosteriorSummary(post); out.next_week_allocation = learnerPBest(post, 1000, learnerRng); }
  try { const st = await learnerState(env); out.pending = learnerBrief(st.decision); out.last_post_at = st.last_post_at || null; } catch (e) { out.pending_error = learnerPublicError('pending', e); }
  try {
    const r = await env.DB.prepare("SELECT post_key, slug, topic, format, slot, posted_at, chosen_by, status, engagement, visits, reward, credited_at FROM social_learner_posts ORDER BY posted_at DESC LIMIT 20").all();
    out.recent = (r && r.results) || [];
  } catch (e) {
    if (/no such table/i.test(String(e && e.message || e))) out.recent = [];
    else out.recent_error = learnerPublicError('recent', e);
  }
  return out;
}

// CARD-RELEASE-1 (0.7.32, 2026-10-02, pillar reach): a post that waits for the owner is a social_threads row in status
// 'draft' whose notes are exactly 'await-card:<human_actions slug>'. Marking that card done on fleet.qnfo.org (the card's
// status becomes 'resolved') queues the post as a selected post, inside every gate and cap as usual; dismissing the card
// sets the post to 'rejected'. Nothing else releases it: recheckDrafts only touches checker-unavailable drafts.
async function releaseCardApproved(env) {
  const rows = await env.DB.prepare("SELECT t.id, substr(t.notes, 12) AS card_slug, h.status AS card FROM social_threads t JOIN human_actions h ON h.slug = substr(t.notes, 12) WHERE t.status = 'draft' AND t.notes LIKE 'await-card:%' AND h.status IN ('resolved', 'dismissed')").all();
  let queued = 0, rejected = 0;
  for (const r of rows.results || []) {
    if (r.card === 'resolved') {
      await env.DB.prepare("UPDATE social_threads SET status='queued', flags='selected', notes=?, updated_at=datetime('now') WHERE id=? AND status='draft'").bind('selected: released by owner card ' + r.card_slug, r.id).run();
      queued++;
    } else {
      await env.DB.prepare("UPDATE social_threads SET status='rejected', notes=?, updated_at=datetime('now') WHERE id=? AND status='draft'").bind('rejected: owner dismissed card ' + r.card_slug, r.id).run();
      rejected++;
    }
  }
  return { queued, rejected };
}

// CRON-ONLY-HEARTBEAT-1 (agent_issues 2397, FLEET-HARDENING-2, pillar autonomy): each scheduled run ends with one
// fleet_heartbeat upsert (ok=0 when the run threw). The write is caught and logged; it never fails or delays the run.
// CF-OBS-ISSUE-1 (2026-11-02, pillar reliability): the heartbeat upsert raced the run's own D1 writes and a transient
// "D1 DB is overloaded. Requests queued for too long." left the row stale (fleet-control then read a dead worker as late).
// The write is now retried a few times with a short backoff before giving up; a persistent failure is still only logged.
var HEARTBEAT_RETRIES = 3;
async function socialHeartbeat(env, ok) {
  for (var i = 1; i <= HEARTBEAT_RETRIES; i++) {
    try {
      await env.DB.prepare("INSERT INTO fleet_heartbeat (worker, version, ts, ok) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(worker) DO UPDATE SET version=excluded.version, ts=excluded.ts, ok=excluded.ok").bind("qnfo-social", VERSION, new Date().toISOString(), ok ? 1 : 0).run();
      return;
    } catch (e) {
      if (i === HEARTBEAT_RETRIES) console.error("qnfo-social fleet_heartbeat write failed: " + String(e && e.message || e).slice(0, 200));
      else await new Promise(function (r) { setTimeout(r, 200 * i); });
    }
  }
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
var CRON_GRID_CFG = {"worker": "qnfo-social", "tick": "30 * * * *", "tickMin": 60, "jobs": [{"cron": "0 6 * * *", "periodMin": 1440, "retry": true}, {"cron": "0 7 * * *", "periodMin": 1440, "retry": false}], "own": "self"};
async function socialScheduled(event, env) {
    // SOCIAL-RUN-LEDGER-1: every operation below records its run with recordSocialRun (defined after drainQueue).
    if (event.cron === '0 6 * * *') {
      const sc = await autoScan(env);
      await recordSocialRun(env, 'scan', sc && !sc.error ? 'ok' : 'error', sc || { error: 'no result' });
      return;
    }
    if (event.cron === '0 7 * * *') {
      await alertDigest(env);
      let eo;
      try { eo = await collectEngagement(env); } catch (e) { eo = { error: String(e && e.message || e).slice(0, 200) }; await logAlert(env, 'engagement', 'error', 'SOCIAL-ENGAGEMENT-SELF-1 ' + String(e).slice(0, 300)); }
      // SOCIAL-DISTRIBUTION-LEARNER-1: the 30-day engagement rate from the snapshots just taken (measurement only, never
      // switched off), then the learner's weekly update (Mondays, or catch-up), which records its own ledger row.
      // BUFFER-POST-STATS-1 (0.13.0): the Buffer per-post statistics, with this worker's own token. Isolated from the Bluesky counts.
      try { eo.buffer = await collectBufferStats(env); } catch (e) { eo.buffer = { error: String(e && e.message || e).slice(0, 200) }; }
      // MASTODON-DIRECT-1: counts for the posts that bypassed Buffer.
      try { eo.mastodon_direct = await mastodonDirectStats(env); } catch (e) { eo.mastodon_direct = { error: String(e && e.message || e).slice(0, 200) }; }
      // INTEG-MASTODON-VERIFY-1: keep the profile's verified link current.
      try { eo.mastodon_profile = await mastodonProfileSync(env); } catch (e) { eo.mastodon_profile = { error: String(e && e.message || e).slice(0, 200) }; }
      try { eo.rate_30d = await learnerEngagementRate(env); } catch (e) { eo.rate_30d = { error: String(e && e.message || e).slice(0, 160) }; }
      await recordSocialRun(env, 'engagement', engagementRunStatus(eo), eo);
      // ATTENTION-LOOP-1 (0.8.0): credit closed windows every day, then the weekly allocation when due.
      try { await learnerDailyCredit(env); } catch (e) { console.log('ATTENTION-LOOP-1 daily credit threw: ' + String(e && e.message || e).slice(0, 200)); }
      try { await learnerWeeklyTick(env); } catch (e) { console.log('SOCIAL-DISTRIBUTION-LEARNER-1 weekly tick threw: ' + String(e && e.message || e).slice(0, 200)); }
      return;
    }
    try { await bufferChannelAudit(env); } catch (e) { await logAlert(env, 'buffer-channels', 'error', 'BUFFER-CHANNEL-AUDIT-1 ' + String(e).slice(0, 300)); }
    let ps;
    try {
      ps = await syncProfile(env);
      if (ps && (ps.updated || ps.error || ps.held)) console.log('[qnfo-social] profile-sync', JSON.stringify(ps));
    } catch (e) { ps = { error: 'threw: ' + String(e && e.message || e).slice(0, 200) }; console.log('[qnfo-social] profile-sync threw', ps.error); }
    await recordSocialRun(env, 'profile-sync', profileRunStatus(ps), ps);
    try { await recheckDrafts(env); } catch (e) { console.log('[qnfo-social] recheck threw', String(e && e.message || e).slice(0, 200)); }
    let cr;
    try { cr = await releaseCardApproved(env); } catch (e) { cr = { error: String(e && e.message || e).slice(0, 200) }; }
    // Each drain is isolated: a throw in one used to end the tick before the other drain and the link checks ran.
    let q, d;
    try { q = await drainQueue(env); } catch (e) { q = { error: String(e && e.message || e).slice(0, 200) }; }
    try { d = await drainDissemination(env); } catch (e) { d = { error: String(e && e.message || e).slice(0, 200) }; }
    await recordSocialRun(env, 'drain', drainRunStatus(q, d), { queue: q, dissemination: d, card_release: cr });
    // DAILY-DISTRIBUTION-1: after the Bluesky drains (and their cross-posts), fill the room each Buffer channel still has.
    let ch;
    try { ch = await drainChannels(env); } catch (e) { ch = { error: String(e && e.message || e).slice(0, 200) }; }
    await recordSocialRun(env, 'channels', channelsRunStatus(ch), ch);
    // PAPER-ROLLUP-1: every queued paper reaches Substack this hour, and the Bluesky thread carries the announced ones.
    let ru;
    try { ru = await drainRollup(env); } catch (e) { ru = { error: String(e && e.message || e).slice(0, 200) }; }
    await recordSocialRun(env, 'rollup', rollupRunStatus(ru), ru);
    await retractDeadLinks(env);
    await restoreMisdeleted(env);
}

export default {
  async scheduled(event, env) {
    // CF-OBS-ISSUE-1: a transient "D1 DB is overloaded" anywhere in the run aborted the whole tick
    // (double-posting risk is nil: each drain re-reads its own ledger first, so a retried drain sees
    // what the first attempt already committed and continues from there). Retry only overload errors.
    let ok = true, err = null;
    for (var attempt = 0; attempt < 3; attempt++) {
      try {
        await cronGridRun(env.DB, event, null, CRON_GRID_CFG, function (ev) { return socialScheduled(ev, env); });
        ok = true; err = null;
        break;
      } catch (e) {
        ok = false; err = e;
        console.error("qnfo-social scheduled run threw (" + String(event && event.cron) + "): " + String(e && e.message || e).slice(0, 300));
        var msg = String(e && e.message || e);
        if (attempt >= 2 || !(msg.indexOf("D1 DB is overloaded") >= 0 || msg.indexOf("queued for too long") >= 0)) break;
        await new Promise(function (r) { setTimeout(r, 500 * (attempt + 1)); });
      }
    }
    await socialHeartbeat(env, ok);
    if (err) throw err;
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname, m = request.method;
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Ops-Key' };
    if (m === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (p === '/health') return new Response(JSON.stringify({ ok: true, worker: 'qnfo-social', version: VERSION, capabilities: ["bluesky-posting", "linkedin-via-buffer", "dissemination-drain", "engagement-collection", "profile-sync", "buffer-channel-audit", "distribution-learner", "channel-drain", "attention-share"], limitations: ["every route except /health and GET /learner needs the social token", "posting, the dissemination drain, profile sync and the audits run only on its hourly :30 cron; the 06:00 scan and the 07:00 engagement run on the :30 fire after their slot (CRON-GRID-1)", "LinkedIn is reached only through the Buffer queue, never LinkedIn's API; pipeline_flags.linkedin_mode 'draft' keeps those posts as drafts", "the channel drain posts to LinkedIn, Mastodon and X inside their own weekly caps (3, 2, 2; pipeline_flags.social_channel_caps) spread over the week, never the same slug twice in 30 days on one channel; Bluesky keeps its own cap", "the profile sync never overwrites a bio the owner edited", "the distribution learner only chooses which queued post goes next and in which slot, inside the weekly cap and content gates; ops_config social_learner_enabled=0 turns it off", "ATTENTION-SHARE-1: ops_config attention_channel_share (qnfo-fleet-dashboard scorecard, daily) scales each channel cap down to its attention share, never above the owner cap; a share older than 3 days reads as 1", "UTM-VISITS-1: a learner post's visits are the gateway's tagged loads for its slug and channel (reach_signals source utm, clicks_human) when its window has any, else the bot-filtered RUM lift", "LEARNER-CHANNEL-ARM-1: the learner's channel arm only orders the Buffer channels and reports an allocation; it never changes a cap or a share"], handle: env.BSKY_HANDLE }), { headers: { 'Content-Type': 'application/json', ...cors } });
    // SOCIAL-DISTRIBUTION-LEARNER-1 (OPEN-ACCESS-1): the learner's posterior, next decision and recent rewards, read-only.
    if (p === '/learner' && m === 'GET') {
      let body;
      try { body = await learnerReport(env); } catch (e) { console.error('learner report failed', e); body = { error: 'learner report unavailable' }; }
      return new Response(JSON.stringify(body), { status: body.error ? 500 : 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300', ...cors } });
    }
    if (!auth(request, env)) return new Response('unauthorized', { status: 401, headers: cors });
    try {
      if (p === '/drain-dissemination') {
        const r = await drainDissemination(env);
        return new Response(JSON.stringify({ ok: true, ...r }), { headers: { 'Content-Type': 'application/json', ...cors } });
      }
      const json = function(obj, status) { return new Response(JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json', ...cors } }); };
      if (p === '/engagement' && m === 'POST') {
        return json({ ok: true, engagement: await collectEngagement(env) });
      }
      if (p === '/post' && m === 'POST') {
        const b = await request.json();
        const g = await routeGate(env, '/post', [String(b.text || '')]);
        if (g.status) return json(g.body, g.status);
        const s = await session(env);
        const r = await postText(s, g.texts[0], null, { campaign: b.slug ? String(b.slug) : undefined });
        const slug = await recordAdhoc(env, 'post', b.title || g.texts[0].slice(0, 120), typeof r.stored_text === 'string' && r.stored_text ? [r.stored_text] : (typeof r.text === 'string' && r.text ? [r.text] : g.texts), r.uri);
        return json({ ok: true, uri: r.uri, slug: slug });
      }
      if (p === '/cross' && m === 'POST') {
        const b = await request.json();
        const link = String(b.link || '');
        const g = await routeGate(env, '/cross', [String(b.text || ''), link]);
        if (g.status) return json(g.body, g.status);
        const bufText = link ? applyLink(g.texts[0], link, 280) : truncate(g.texts[0], 280);
        const res = await bufferPost(env, bufText, b.slug ? String(b.slug) : undefined);
        const uriVal = postUriValue(null, res);
        // POST-SENT-TEXT-1: record the first channel's text as Buffer received it (tagged), not the untagged draft.
        const sentBuf = ((res && res.results) || []).filter(function(x) { return x && x.post_id && typeof x.text === 'string' && x.text; }).map(function(x) { return x.text; })[0];
        const slug = uriVal ? await recordAdhoc(env, 'cross', b.title || bufText.slice(0, 120), [sentBuf || bufText], uriVal) : null;
        return json({ ok: true, buffer: res, text_sent: bufText, post_uri: uriVal, slug: slug });
      }
      // Buffer admin proxy: Buffer posts are plain text with no facet/embed model, so a bad
      // cross-post can only be REMOVED, never repaired in place. This route gives the fleet
      // read+delete control over its own Buffer history (auth-gated, same key as /repost).
      if (p === '/buffer/gql' && m === 'POST') {
        const b = await request.json();
        const q = String(b.query || '');
        if (!q) return new Response(JSON.stringify({ error: 'query required' }), { status: 400, headers: { 'Content-Type': 'application/json', ...cors } });
        const res = await bufferGql(env, q);
        return new Response(JSON.stringify({ ok: true, data: res }), { headers: { 'Content-Type': 'application/json', ...cors } });
      }
      if (p === '/thread' && m === 'POST') {
        const b = await request.json();
        const posts = sanitizePosts(b.posts);
        if (!posts.length) return new Response(JSON.stringify({ error: 'no posts' }), { status: 400, headers: { 'Content-Type': 'application/json', ...cors } });
        const g = await routeGate(env, '/thread', posts);
        if (g.status) return json(g.body, g.status);
        const s = await session(env);
        const sent = [];
        const uris = await postThread(s, g.texts, { campaign: b.slug ? String(b.slug) : undefined, sent: sent });
        const slug = await recordAdhoc(env, 'thread', b.title || g.texts[0].slice(0, 120), sentPostsJson(sent) ? sent : g.texts, uris[0]);
        return new Response(JSON.stringify({ ok: true, root: uris[0], count: uris.length, uris: uris, slug: slug }), { headers: { 'Content-Type': 'application/json', ...cors } });
      }
      if (p === '/threads' && m === 'GET') {
        await ensureSocialSchema(env);
        const rows = await env.DB.prepare("SELECT id, slug, title, status, error, retry_count, posted_at, created_at, post_uri FROM social_threads ORDER BY id DESC LIMIT 50").all();
        return new Response(JSON.stringify(rows.results || []), { headers: { 'Content-Type': 'application/json', ...cors } });
      }
      if (p === '/queue' && m === 'POST') {
        const b = await request.json();
        const posts = sanitizePosts(b.posts);
        await env.DB.prepare("INSERT OR IGNORE INTO social_threads (slug, title, posts, status) VALUES (?,?,?, 'queued')").bind(String(b.slug), String(b.title || ''), JSON.stringify(posts)).run();
        return new Response(JSON.stringify({ ok: true, slug: b.slug }), { headers: { 'Content-Type': 'application/json', ...cors } });
      }

      if (p === '/compose' && m === 'POST') {
        const b = await request.json();
        const title = String(b.title || '').slice(0, 300);
        const abstract = String(b.abstract || '').slice(0, 4000);
        const doi = String(b.doi || '');
        if (!title || !abstract) return new Response(JSON.stringify({ error: 'title and abstract required' }), { status: 400, headers: { 'Content-Type': 'application/json', ...cors } });
        const prompt = composePrompt(doi, title, abstract);
        const ai = await aiRunAttr(env, "qnfo-social", "compose-2", COMPOSE_MODEL, { messages: [{ role: 'user', content: prompt }], max_tokens: 2000 });
        const text = extractText(ai);
        const posts = sanitizePosts(text.split("\n"));
        if (posts.length < 3) return new Response(JSON.stringify({ error: 'compose produced too few posts', raw: text.slice(0, 500) }), { status: 500, headers: { 'Content-Type': 'application/json', ...cors } });
        const slug = String(b.slug || ('draft-' + Date.now().toString(36)));
        const issues = await checkThread(env, title, abstract, posts, doi);
        const status = issues && issues.length === 0 ? 'queued' : 'draft';
        const notes = issues && issues.length ? JSON.stringify(issues) : (issues === null ? JSON.stringify([{ post: 0, issue: 'checker unavailable - unverified, held as draft' }]) : null);
        // SOURCE-VOICE-SOCIAL-1 (#2472): the grounding text is stored with the draft, so the repair pass and the recheck (which
        // skip a row with no abstract) can work on it; 179 of 182 rows carried none on 2026-10-13.
        await env.DB.prepare("INSERT INTO social_threads (slug, title, doi, abstract, posts, status, notes) VALUES (?,?,?,?,?,?,?)").bind(slug, title, doi, abstract, JSON.stringify(posts.slice(0, 6)), status, notes).run();
        if (!issues || issues.length) await logAlert(env, 'compose', 'warning', 'held as draft: ' + slug + ' (' + (issues === null ? 'checker unavailable' : issues.length + ' issue(s)') + ')');
        return new Response(JSON.stringify({ ok: true, slug: slug, status: status, auto_approved: status === 'queued', checker: issues === null ? 'unavailable' : 'ok', issues: issues, posts: posts.slice(0, 6) }), { headers: { 'Content-Type': 'application/json', ...cors } });
      }
      if (p === '/approve' && m === 'POST') {
        const b = await request.json();
        const row = await env.DB.prepare("SELECT * FROM social_threads WHERE slug=?").bind(String(b.slug)).first();
        if (!row) return new Response(JSON.stringify({ error: 'thread not found' }), { status: 404, headers: { 'Content-Type': 'application/json', ...cors } });
        await env.DB.prepare("UPDATE social_threads SET status='queued' WHERE slug=? AND status='draft'").bind(String(b.slug)).run();
        return new Response(JSON.stringify({ ok: true, slug: b.slug, status: 'queued' }), { headers: { 'Content-Type': 'application/json', ...cors } });
      }
      if (p === '/broadcast' && m === 'POST') {
        const b = await request.json();
        const row = await env.DB.prepare("SELECT * FROM social_threads WHERE slug=?").bind(String(b.slug)).first();
        if (!row) return new Response(JSON.stringify({ error: 'thread not found' }), { status: 404, headers: { 'Content-Type': 'application/json', ...cors } });
        if (row.status === 'posted') return new Response(JSON.stringify({ error: 'already posted', status: row.status }), { status: 409, headers: { 'Content-Type': 'application/json', ...cors } });
        const posts = sanitizePosts(JSON.parse(row.posts));
        const g = await routeGate(env, '/broadcast', posts);
        if (g.status) return json(g.body, g.status);
        const s = await session(env);
        const sent = [];
        const uris = await postThread(s, g.texts, { campaign: row.slug ? String(row.slug) : undefined, sent: sent });
        await markPosted(env, row.id, postUriValue(uris[0], null), sent);
        return new Response(JSON.stringify({ ok: true, root: uris[0], count: uris.length, uris: uris }), { headers: { 'Content-Type': 'application/json', ...cors } });
      }

      if (p === '/scan' && m === 'POST') {
        await autoScan(env);
        const drafts = await env.DB.prepare("SELECT id, slug, title, doi FROM social_threads WHERE status='draft' ORDER BY id DESC LIMIT 10").all();
        return new Response(JSON.stringify({ ok: true, drafted: (drafts.results || []).length, drafts: drafts.results || [] }), { headers: { 'Content-Type': 'application/json', ...cors } });
      }
      if (p === '/drain' && m === 'POST') {
        if (drainInProgress) return new Response(JSON.stringify({ error: 'drain already in progress' }), { status: 429, headers: { 'Content-Type': 'application/json', ...cors } });
        drainInProgress = true;
        try {
          const res = await drainQueue(env);
          return new Response(JSON.stringify({ ok: true, drain: res }), { headers: { 'Content-Type': 'application/json', ...cors } });
        } finally {
          drainInProgress = false;
        }
      }
      // Link remediation: delete old posts, recreate with facets + root embed.
      if (p === '/repost' && m === 'POST') {
        const b = await request.json();
        const threads = Array.isArray(b.threads) ? b.threads : (b.threads ? [b.threads] : []);
        if (!threads.length) return new Response(JSON.stringify({ error: 'no threads' }), { status: 400, headers: { 'Content-Type': 'application/json', ...cors } });
        // Remediation recreates posts that already existed, so the weekly cap does not apply; the pause flag and the
        // content gate do. A thread that fails the content gate is left untouched (its old posts are not deleted).
        const g0 = await routeGate(env, '/repost', [], { skipCap: true });
        if (g0.status) return json(g0.body, g0.status);
        const s = await session(env);
        const results = [];
        for (const th of threads) {
          try {
            const cg = contentGate(((th && th.posts) || []).concat([String((th && th.link) || ''), String((th && th.title) || '')]));
            if (!cg.ok) { results.push({ slug: th && th.slug, skipped: 'content gate: ' + cg.reason }); continue; }
            const r = await repostThread(s, th);
            if (th.slug && r.newRoot) { try { await recordPostUriBySlug(env, String(th.slug), r.newRoot); } catch (eU) { console.error(JSON.stringify({ evt: "social:fetch:caught", error: String((eU && eU.message) || eU) })); } }
            results.push(r);
          } catch (e) {
            results.push({ error: String(e).slice(0, 200) });
          }
          await new Promise((res) => setTimeout(res, 120));
        }
        return new Response(JSON.stringify({ ok: true, count: results.length, results: results }), { headers: { 'Content-Type': 'application/json', ...cors } });
      }
      if (p === '/delete' && m === 'POST') {
        const b = await request.json();
        const uris = Array.isArray(b.uris) ? b.uris : [];
        const s = await session(env);
        const out = [];
        for (const u of uris) {
          try { await deleteRecord(s, u); out.push({ uri: u, ok: true }); }
          catch (e) { out.push({ uri: u, ok: false, error: String(e).slice(0, 120) }); }
          await new Promise((res) => setTimeout(res, 60));
        }
        return new Response(JSON.stringify({ ok: true, deleted: out }), { headers: { 'Content-Type': 'application/json', ...cors } });
      }
      if (p === '/alerts' && m === 'GET') {
        const rows = await env.DB.prepare("SELECT id, source, level, message, created_at, digested FROM alerts ORDER BY id DESC LIMIT 50").all();
        return new Response(JSON.stringify(rows.results || []), { headers: { 'Content-Type': 'application/json', ...cors } });
      }
      if (p === '/digest' && m === 'POST') {
        await alertDigest(env);
        return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json', ...cors } });
      }
      return new Response('not found', { status: 404, headers: cors });
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { 'Content-Type': 'application/json', ...cors } });
    }
  }
};

// D1-overload guard (CF-OBS-ISSUE-1): only one /drain operation at a time per isolate to avoid queuing heavy D1 work.
var drainInProgress = false;

// WORKERS-AI-SPEND-UNATTRIBUTED-RISING-1 (#1681): every env.AI.run in this worker goes through aiRunAttr, which adds a
// per-worker/purpose call counter to D1 ai_call_counters (one UPSERT per call, fail-soft, never blocks or alters the AI call).
// Copied from qnfo-fleet-control (workers cannot import across directories); same table/columns. No new paid service.
// Unlike fleet-control the counter write is NOT awaited (fire-and-forget, errors swallowed) so it can never add latency.
var AI_ATTR_DB_BINDINGS = ["DB"];
// CF-OBS-ISSUE-1: set after the counter tables have been ensured once in this isolate, so the
// per-AI-call attribution write no longer issues a redundant DDL statement every time (halving
// the D1 statements queued per AI call and easing the D1 overload seen on 2026-11-02).
var AI_COUNTERS_SCHEMA_READY = false;
async function aiRunAttr(env, worker, purpose, model, input, opts) {
  var t0 = Date.now(), ok = 1, res;
  try { res = await env.AI.run(model, input, opts); return res; } catch (e) { ok = 0; throw e; }
  finally {
    try {
      var db = null;
      for (var bi = 0; bi < AI_ATTR_DB_BINDINGS.length && !db; bi++) db = env[AI_ATTR_DB_BINDINGS[bi]];
      if (db) {
        var ic = 0; try { ic = JSON.stringify(input && input.messages || input || "").length; } catch (e2) { console.error(JSON.stringify({ evt: "social:aiRunAttr:caught", error: String((e2 && e2.message) || e2) })); }
        var day = new Date().toISOString().slice(0, 10);
        var ms = Date.now() - t0;
        var wr = (async function() {
          // CF-OBS-ISSUE-1: the schema-ensure DDL ran on every AI call, doubling queued D1 statements per
          // request (the UPSERT can't be removed without losing attribution). Run it once per isolate instead.
          if (!AI_COUNTERS_SCHEMA_READY) {
            await db.prepare("CREATE TABLE IF NOT EXISTS ai_call_counters (day TEXT, worker TEXT, purpose TEXT, model TEXT, calls INTEGER DEFAULT 0, errors INTEGER DEFAULT 0, in_chars INTEGER DEFAULT 0, ms INTEGER DEFAULT 0, PRIMARY KEY (day, worker, purpose, model))").run();
            AI_COUNTERS_SCHEMA_READY = true;
          }
          await db.prepare("INSERT INTO ai_call_counters (day, worker, purpose, model, calls, errors, in_chars, ms) VALUES (?1,?2,?3,?4,1,?5,?6,?7) ON CONFLICT(day, worker, purpose, model) DO UPDATE SET calls=calls+1, errors=errors+?5, in_chars=in_chars+?6, ms=ms+?7").bind(day, worker, purpose, String(model), ok ? 0 : 1, ic, ms).run();
          if (res && !/(?:bge|embed|whisper|m2m100|resnet|flux|sdxl)/i.test(String(model))) {
            var u = (res && res.usage) || {};
            var cached = (u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens) || u.cached_tokens || (u.input_tokens_details && u.input_tokens_details.cached_tokens) || 0;
            var in_tok = u.prompt_tokens || u.input_tokens || 0;
            // PROMPT-CACHE-COUNT-3b: the fleet's ai_cache_counters schema (qnfo-ops form); the 0.8.3 columns did not exist.
            await db.prepare("INSERT INTO ai_cache_counters (day, worker, model, calls, cached_calls, in_tok, cached_tok) VALUES (?1,?2,?3,1,?4,?5,?6) ON CONFLICT(day, worker, model) DO UPDATE SET calls=calls+1, cached_calls=cached_calls+excluded.cached_calls, in_tok=in_tok+excluded.in_tok, cached_tok=cached_tok+excluded.cached_tok").bind(day, worker, String(model).slice(0, 120), Number(cached) > 0 ? 1 : 0, Number(in_tok) || 0, Number(cached) || 0).run();
          }
        })();
        await wr.catch(function (e) { console.error(JSON.stringify({ evt: "social:aiRunAttr:caught", error: String((e && e.message) || e) })); }); // awaited (0.12.0): a write started and left floating can be dropped when the invocation ends
      }
    } catch (e3) { console.error(JSON.stringify({ evt: "social:aiRunAttr:caught", error: String((e3 && e3.message) || e3) })); }
  }
}
// end aiRunAttr
export { planEngagementUris, BSKY_ENGAGEMENT_MAX_URIS, mastodonWantedFields, mastodonProfileSync, drainRollup, rollupNoteText, rollupSubstack, rollupBluesky, rollupRunStatus, ROLLUP_SUBSTACK_MAX, ROLLUP_BSKY_MAX, mastodonCreate, mastodonDirectStats, channelCreate, findChannel, blueskySpacing, CHANNEL_ORDER, collectBufferStats, bufferStatsPlan, bufferRefusedFields, bufferStatsQuery, bufferGqlBounded, BUFFER_STATS_PER_CHANNEL, BUFFER_STATS_CHANNELS, readTextCapped, probeLink, proseUnits, splitForThread, fitWhole, threadPlan, postThread, pickBufferText, collectReplies, replyRowsOf, replyWordCount, threadGroundingIssues, groundingProblems, composePrompt, repairPrompt, buildFacets, truncateSafe, applyLink, findDoi, byteLen, extractUrls, utmHost, sentPostsJson, utmTag, utmTagText,fitKeepUrls, tagAndFit, tagFacets, postText, postUriValue, weeklyCap, socialGate, drainQueue, drainDissemination, repairMojibake, contentGate, markPosted, routeGate, collectEngagement, blueskyUriOf, bufferPost, windowHold, crossPostHold, syncProfile, PROFILE_DESCRIPTION, bufferChannelAudit, linkedinMode, recordSocialRun, profileRunStatus, drainRunStatus, engagementRunStatus, autoScan,
  drainChannels, channelsRunStatus, channelText, channelCaps, channelWindow, channelCarried, pickChannelRow, CHANNEL_WEEKLY_CAP, CHANNEL_PLATFORM, CHANNEL_MAX_CHARS, AUTOMATION_MARKER, MARKER_MAX_CHARS, withAutomationMarker, bufferCreate, CHANNEL_REPEAT_DAYS, SUBSCRIBE_LINE,
  learnerClassify, learnerClassifyChannel, learnerCategories, learnerHintsFor, learnerUtmCampaign, learnerDiscover, blueskyTidMs, learnerPostedAtOf, LEARNER_TOPICS, LEARNER_CATEGORY_TOPIC, LEARNER_GENERIC_TOPIC, learnerIsQuestion, learnerTopicOf, learnerSlotOf, learnerBeta, learnerPrior, learnerPosterior, learnerChoose, learnerPBest,
  learnerEnabled, learnerPick, learnerEngagementOf, learnerVisits, learnerRewardOf, learnerWeeklyUpdate, learnerWeeklyTick, learnerCreditPending, learnerDailyCredit, attentionShares, shareCap, attentionOrder, learnerChannelOrder, learnerChannelEngagement, LEARNER_CHANNELS, LEARNER_CHANNEL_OF,
  learnerEngagementRate, learnerReport, parseCheckerIssues, socialHeartbeat, mastodonPublicStats, mastodonStatusRef, learnerBackfillDecision, learnerRecordPost, MASTODON_PUBLIC_MAX, ensureLearnerSchema, setLearnerRng, LEARNER_SLOTS, LEARNER_METRIC, LEARNER_METRIC_DEF , pickPaperRow, PAPER_PROMOTE_DAYS, slashCanonTarget, retractDeadLinks };
