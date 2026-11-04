# Reader yield (READER-YIELD-1)

Charter pillar: **reach** (programs QNFO.REACH and QNFO.RSCH). Migration `migrations/2026-11-04-reader-yield-1.sql`; suite `migrations/reader-yield-1.test.mjs`.
Owner goals of 2026-11-04: people actually read the research, cost under USD 200-300 a month, a fast simple dashboard. This is the reader half of that: what a reader is,
what the fleet gets per paper and per neuron, and a research budget that follows readers instead of ignoring them.

## What was measured (2026-11-04, live qnfo-audit and Cloudflare RUM)

| Finding | Evidence |
|---|---|
| Readers do not follow output | Papers a day: 2 to 89 (71, 89, 56 on 10-19..10-21, then 1 to 16). GA4 engaged sessions on the public sites: 12 to 41 a day, 122 in the 7 days to 11-03, of which 44 (5.6 a day, 0 to 15) came from sources outside the fleet. External-referrer page loads fell from 26..58 a day to 1..9 through the surge. |
| Counted clicks are not readers | `utm_clicks_human` 1260 in 10 days; GA4 organic social 180 sessions, 25 engaged: about 2 engaged per 100 counted clicks. Bluesky 22 sessions / 1 engaged, Substack 110 / 0, LinkedIn 20 / 5, Mastodon 9 / 0; X 19 / 17, Google 34 / 28, referral 44 / 40. |
| The fleet's own link probes are counted as human clicks | `qnfo-social` `probeLink` fetches each tagged link with the user agent `Mozilla/5.0 (qnfo-social link-probe)`; the gateway's `UTM_BOT_RE` does not match it, so the probe is a `human` click. That fits the floor below and clicks rising to 140 a day while new papers fell to 6 a day (not proven: probe rows cannot be told from visitors in `utm_clicks`). |
| Every paper carries the same floor | 506 papers published since 10-01: UTM human clicks p10 3, p50 6, p90 11 (100 percent non-zero), human RUM page loads p10 4, p50 8; flat across idea source, score band and age. A human readership is heavy-tailed; a constant floor is automation (link previews, probes, renders). |
| Outsiders reach few papers | 868 paper keys with any signal in 30 days; 33 (3.8 percent) have a page load from a referrer outside the fleet, 61 loads in all; the most any paper has is 7. |
| Choosing papers for outreach slots changes nothing | The Bluesky queue holds 1 item; 460 paper-posts went out in 34 days. Of 210 tagged Bluesky paper-posts (10-19..10-31) 178 (85 percent) got no Bluesky-channel click in 72 hours, 27 got exactly 4, and 52 clicks landed the day before the posts existed. |
| Topic does not separate papers | Visits per credited post by shelf: 2.7 to 3.8 (n about 500). Topic throttling has no evidence behind it. |
| Where the sessions come from | GA4, 10 days to 11-03: Singapore 1002 of 1833 sessions (55 percent), United States 385, Netherlands 129, China 114, Iran 21. RUM bot-filtered loads, 7 days: Netherlands 52 percent, Singapore 22 percent, United States 17 percent; Chrome 2,230 of 3,400, Android 40 percent. The owner's time zone is W. Europe, so a Singapore share this size reads as datacenter automation (not proven: GA4 has no engaged-by-country row), and the Netherlands share includes the owner's own visits and the Amsterdam colo. |
| Engaged sessions are dominated by a few repeat users, probably you and the fleet | Live `/api/ga4/overview`, 28 days to 11-03: 307 engaged sessions, of which the Netherlands is 116 from 25 users (5.6 sessions and 10.5 page views a user), Poland 26 from 7 users, the United Kingdom 33 from 9. By source in the 7 days to 11-03: 54 direct, 24 from the fleet's own hosts (ask.qwav.tech 12, github.com 11), 44 from outside (google 21, x 17, six others). So the all-sources count is not a reader count: a handful of repeat users drive it, and the owner's own browsing and the fleet's browser checks are the likely cause (not proven: GA4 has no internal-traffic rule yet, see the owner card). |
| Spend ignores the key | `qnfo-research-exec` 988,203 and 996,539 neurons on 11-02 and 11-03 against `research_daily_neurons` 360000, for 9 and 16 papers. 7 days to 11-03: 4,585,257 neurons (research-exec, paper-reviser, errata-hub), 39 papers, 122 engaged sessions = 37,583 neurons per engaged session. |
| `pageviews_30d` is not capped | Live bot-filtered RUM total for 30 days is 19,660 to 20,500 (31 daily rows sum to the same). The stored value flaps 0 / 10000 / 25000 / 26000 / 19.7k (`metric_write_audit_log`); fix filed as a ROADMAP-1 row. |

The honest reading: output is two orders of magnitude ahead of verified readership (0.12 external visits and about 3 engaged sessions per published paper), and the only
reader signal that is not noise is GA4 engagement plus the external-referrer loads. Neither rose when output rose.

## What a reader is here

- **Engaged reader session**: a GA4 session of 10 seconds or more, two page views or a conversion whose source is outside the fleet (`reach_signals` source `ga4`, entity type `source`, metric
  `engagedSessions`; `(direct)`, `(not set)`, `(none)` and the hosts in `ops_config reader_internal_sources` are left out, an editable list). It runs in a browser, so it undercounts (ad blockers);
  it still counts you clicking your own posts, and your typed visits fall into direct and drop out. 44 in the 7 days to 11-03, spiky (0 to 15 a day): read weeks, not days. Direct holds 83 percent of
  sessions and 7.5 percent of them engage.
- **External visit**: a page load whose referrer is a host the fleet does not own (`external_pageviews`). The only per-paper count that is not a floor.
- **Counted click**: a tagged page load whose user agent does not match `UTM_BOT_RE` (qnfo-gateway). It includes fetchers and previews. Never a reader count; ROADMAP-1 READER-YIELD-1.1 fixes the class.

## What the migration adds

| Object | What it is |
|---|---|
| `reader_yield_daily` | One row per complete UTC day: GA4 sessions and engaged (all, and organic social), counted clicks, external loads, papers published, research neurons. NULL where a source has no row (GA4 starts 2026-10-25), never a zero. |
| `paper_readership` | One row per paper key (64 character lower-case campaign key): 30 day and 7 day windows plus the week before, RUM loads, external loads, UTM clicks, GA4 sessions of `/papers/<slug>`, joined to `research_queue` (idea source, score, publish time). Refreshed daily; same slugs a week apart are two columns of one row. |
| `v_reader_yield_by_source`, `v_paper_readers_top` | Yield by where the idea came from; papers an outsider reached, ranked, with `suspect_automated` for 50 or more sessions and no external referrer (one page had 110 sessions on 11-03). |
| Metrics | `engaged_reader_sessions_7d` and `research_neurons_per_engaged_session_7d` (outcomes, papers surface), `social_engaged_sessions_7d` (outcome, promotion surface: engaged sessions from social posts), `outreach_engaged_per_100_clicks_7d` (validity, promotion surface). History backfilled from 2026-10-31; first verdict 2026-11-07. |
| `v_research_volume_target` and the governor | See below. |
| Eight steps appended to `fleet_tasks` `event-metric-recompute` | Hourly (:55): ledger, per-paper table, prune of rows not refreshed for 14 days, metrics, governor, decision log, one `cloud_ops_events` row a UTC day (`reader-yield-<yyyymmdd>`). One statement a step. No new cron: `fleet_budget` caps are breached (`cost:fleet_all_in_month` 1151 against 300). |

Read the same papers a week apart: `SELECT slug, pv_7d, pv_prev_7d, utm_7d, utm_prev_7d FROM paper_readership WHERE published_at < date('now','-14 days')`.

## The research volume governor (dormant: off)

`v_research_volume_target` is the research budget as a function of readers: `research_daily_neurons` = clamp(engaged readers a day x `research_yield_neurons_per_engaged_day`,
`research_yield_floor`, `research_yield_ceiling`), reached by at most `research_yield_step_pct` a day, with a 2 percent dead band. Defaults 64000, 180000, 450000, 10, averaged over up to 28 days. At 5.6 externally sourced engaged
readers a day the target is 358k, about today's key. The floor is half of the 2026-10-21 budget; research never stops. The constant is a calibration, not a law.

**It ships off.** `ops_config research_policy_harmonized` names qnfo-ops the single writer of `research_daily_neurons` ("other sessions must file an issue instead of overwriting these
keys") and the spend-cap work is changing how research-exec enforces it, so `research_yield_governor` is `off`: the hourly steps and the daily `reader-yield` event publish the target
and the reason, and nothing writes the key. Issue READER-YIELD-1.5 asks the key's owner to switch it on once research-exec respects the key (the spend-cap session's 0.49.0 adds a per-tick allowance), 28 days of externally sourced rows exist and the GA4 internal-traffic rule (owner card `ga4-internal-traffic-1`) is active (research-exec spent 988k and 997k neurons
on 11-02 and 11-03 against 360000, so today the key moves a number nothing reads).

When `on`, the governor moves the key once a UTC day (the `reader-yield-<yyyymmdd>` event is the guard, so an hourly or retried run cannot move it twice) and only while: at least
`research_yield_min_days` (28) days of externally sourced GA4 engaged rows exist (from 2026-11-21); the key is inside the band; and nobody else wrote the key since the governor did (`research_yield_last_written` equals the
key). Any other writer pauses it with a reason in `v_research_volume_target.reason` and the daily event; set `research_yield_last_written` to an empty string to resume. Revert:
`research_yield_governor` = `off` and restore the key from `bak_20261104_research_neurons_cfg`.

**Strongest argument against it.** Engaged readers depend on distribution (search, X, referrals), not on research volume, so tying the budget to total readers can freeze output at
today's audience and never invest ahead of it. The ceiling and the floor bound the damage; the real investment lever is outreach and search, which this does not touch. **Failure
mode.** If readers fall for reasons unrelated to research (a GA4 outage, a site change), the budget falls 10 percent a day to the floor with no cause in research; the 7 day window and
the pause on a foreign write limit it to a week, and `engaged_reader_sessions_7d` with `outreach_engaged_per_100_clicks_7d` show which. **Coupling risk.** The steps live inside another
loop's task row: a later migration that rewrites `event-metric-recompute` in full removes them; the metrics then go stale (daily cadence) and the staleness view says so.

## Prediction and what falsifies it

Logged in `decision_log` (parsed by `decision_predictions`): `engaged_reader_sessions_7d >= 35 within 14 d` (80 percent of the 44 baseline; the hypothesis is that readers do not follow
research volume, tested by the natural swings of output) and `research_neurons_per_engaged_session_7d <= 75000 within 14 d` (true only if the governor is on and the key binds). Falsified if engaged readers fall more than 20 percent in 14 days
with outreach cadence unchanged: readers do depend on research volume; keep the budget at 360000 and say so.

## Next items (four ROADMAP-1 rows with code-tasks and one enabling issue, filed by the migration)

1. READER-YIELD-1.1 `qnfo-gateway`: class automated fetchers as bots so `outreach_human_clicks_7d` falls to what is real; done when `outreach_engaged_per_100_clicks_7d` is 8 or more.
2. READER-YIELD-1.2 `qnfo-fleet-dashboard`: derive `pageviews_30d` from the stored daily series so the Readers screen reads 19.7k, not 0 or 10000.
3. READER-YIELD-1.3 `qnfo-social`: when the queue is empty, give one paper a day that an outsider already read a second post on X, LinkedIn and Mastodon (the channels that produce engaged
   sessions), measured against matched papers a week apart.
4. READER-YIELD-1.4 `qnfo-fleet-dashboard`: GA4 ingest by campaign and country so an engaged session can be tied to the paper, post and origin that earned it. X, LinkedIn and Mastodon have 14, 7 and 14 slots a week for about 60 new papers a week, so slot choice is real there (the roll-ups carry every paper) and has no signal until this lands.
5. READER-YIELD-1.5 (config, owner qnfo-ops / the spend-cap work): switch `research_yield_governor` on once research-exec enforces `research_daily_neurons`.
6. Owner card `ga4-internal-traffic-1` (IDENTITY-BOUND, GA4 Admin is the owner's Google account): define internal traffic and activate the Internal Traffic data filter so your own visits stop counting. Until then the list in `reader_internal_sources` is the approximation.
