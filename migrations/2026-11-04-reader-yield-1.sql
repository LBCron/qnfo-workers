-- READER-YIELD-1 (2026-11-04, charter pillar reach; programs QNFO.REACH and QNFO.RSCH). Owner directive 2026-11-04: managers think in strategy, features and quality; goals are
-- people actually reading the research, cost under USD 200-300 a month, a fast simple dashboard.
-- WHAT WAS MEASURED (qnfo-audit reach_signals, research_queue, ai_call_counters and the live Cloudflare RUM GraphQL, 2026-11-04 15:00-17:00Z):
--  * Output is far ahead of readers, and readers do not follow output. research_queue.published_at: 2 to 89 papers a day (71, 89, 56 on 10-19..10-21, then 1 to 16 a day). GA4
--    engaged sessions on the public sites (reach_signals source ga4, entity_type channel, 10-25..11-03): 12 to 41 a day, 122 in the last 7 days. Only 44 of those 122 came from sources outside the fleet (google 21, x 17, six others); 54 are direct and 24 are the fleet's own hosts (ask.qwav.tech, github.com): in 28 days the Netherlands alone is 116 of 307 engaged sessions from 25 users (5.6 sessions and 10.5 page views a session), so the all-sources figure counts the owner's and the fleet's own browsing, and the externally sourced count is spiky (0 to 15 a day, 5.6 on average). Site-level external referred
--    page loads fell from 26..58 a day (10-06..10-15) to 1..9 (late October) through the 10x output surge. No per-paper or per-topic signal separates papers.
--  * The measure that is called human clicks is not readers. utm_clicks_human (qnfo-gateway utm_clicks, ua_class by a user-agent regex) was 1260 in the 10 days to 11-03; GA4
--    counted 180 sessions from organic social in the same days and 25 of them engaged: about 2 engaged sessions per 100 counted clicks. By source: bluesky 22 sessions and 1
--    engaged, substack 110 and 0, linkedin 20 and 5, mastodon 9 and 0; x 19 and 17, google 34 and 28, referral 44 and 40. 1525 of 1833 sessions are direct (7.5 percent engaged),
--    and Singapore is 1002 of them (55 percent; the owner is in W. Europe).
--  * Every paper carries the same floor. Over the 506 papers published since 10-01, utm_clicks_human per paper has p10 3, p50 6, p90 11 (100 percent non-zero), human RUM
--    page loads p10 4, p50 8 (99 percent non-zero), and neither rises with idea source (proposal 8.6, remediation 11.5 per paper), score band or paper age. A human readership is
--    heavy-tailed; a constant floor is automation (link previews, probes, renders). Only external-referrer loads are clean: 0.12 per paper, 7 percent of papers.
--  * The Bluesky queue is empty (1 queued item; 460 paper-posts in 34 days), so choosing which papers take its slots changes nothing. Of the 210 Bluesky roll-up paper-posts that carry
--    a utm tag (10-19..10-31; earlier posts carried none), 178 (85 percent) got no Bluesky-channel human-classed click within 72 hours, the rest got 3 to 6 (27 of them exactly 4: a
--    fixed count, not a reader), and 52 clicks landed on the day BEFORE the posts existed. qnfo-social probeLink fetches each tagged link with the user agent 'Mozilla/5.0 (qnfo-social
--    link-probe)', which UTM_BOT_RE does not match, so the fleet's own link probes are counted as human clicks, which fits the floor on every paper (not proven: probe rows cannot be told from visitors in utm_clicks).
--  * Research cost does not follow readers: qnfo-research-exec spent 988k and 997k neurons on 11-02 and 11-03 against ops_config research_daily_neurons 360000, for 9 and 16 papers.
--    Seven days to 11-03: 4,585,257 neurons (research-exec, paper-reviser, errata-hub), 39 papers, 122 engaged sessions (44 from outside the fleet): 37,583 neurons per engaged session, 104,210 per externally sourced one. fleet_budget
--    cost:fleet_all_in_month reads 1151 against its cap of 300 and ai_spend:workers-ai 793 against 95 (list estimates).
--  * Not a cap: pageviews_30d is not limited by the GraphQL row limit. The live bot-filtered 30 day total is 19,660 to 20,500 (31 days of rows sum to the same figure). The stored
--    value flaps between 19.6k, 0, 10000, 25000 and 26000 (metric_write_audit_log, five times in 12 hours); a code task below removes the cause.
-- WHAT THIS ADDS (no worker is edited and no cron is added, because fleet_budget caps are breached: the steps join the existing hourly fleet_tasks event-metric-recompute):
-- (1) reader_yield_daily, a ledger of GA4 engaged sessions, counted UTM clicks, external referrals, papers published and research neurons; (2) paper_readership, one row per paper
-- (30 day and 7 day windows, the week before, GA4 sessions, external-referrer loads) joined to research_queue (idea source, score, first publish time), with v_reader_yield_by_source
-- and v_paper_readers_top; (3) four metrics and their output_quality_measures rows (social_engaged_sessions_7d is the promotion outcome that replaces counted clicks): engaged_reader_sessions_7d and research_neurons_per_engaged_session_7d are outcomes of the
-- papers surface (an engaged session counts only when its GA4 source is outside the fleet: '(direct)', '(not set)' and the hosts in ops_config reader_internal_sources are excluded, because they hold the owner's and the fleet's own browsing), outreach_engaged_per_100_clicks_7d is a validity measure of the promotion surface (it says how much of outreach_human_clicks_7d is reading); (4)
-- v_research_volume_target, the research budget as a function of engaged readers: engaged readers a day x research_yield_neurons_per_engaged_day, inside [research_yield_floor,
-- research_yield_ceiling], at most research_yield_step_pct a day, once a UTC day, averaged over up to 28 days, neutral under 28 days of data (the signal is 5.6 a day and spiky). DORMANT: research_yield_governor is off because ops_config
-- research_policy_harmonized names qnfo-ops the single writer of research_daily_neurons ("other sessions must file an issue instead of overwriting these keys") and the spend-cap work
-- is changing how that key is enforced. The view and the daily ledger event publish the target; set research_yield_governor to on and the same task writes the key (and pauses on any
-- foreign write); (5) four ROADMAP-1 rows for the next items and one issue to switch the governor on, each with an owner and a closing condition.
-- PREDICTIONS (decision_log, below): engaged_reader_sessions_7d (externally sourced engaged sessions, baseline 44 in 7 days) stays at or above 35 (80 percent) for 14 days whatever the research volume does; with the governor
-- on and the key enforced, research neurons per engaged session fall below 75000 in 14 days (104k now). Falsifier: engaged readers down more than 20 percent in 14 days with outreach cadence
-- unchanged, which would mean readers do depend on research volume: keep the budget at 360000 and say so.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE ops_config SET value = 'off', updated_at = datetime('now') WHERE key = 'research_yield_governor'; UPDATE ops_config SET value = (SELECT value FROM bak_20261104_research_neurons_cfg), note = (SELECT note FROM bak_20261104_research_neurons_cfg), updated_at = datetime('now') WHERE key = 'research_daily_neurons' AND EXISTS (SELECT 1 FROM bak_20261104_research_neurons_cfg) AND note LIKE 'READER-YIELD-1 governor%'; UPDATE analytics_metric_triggers SET action = (SELECT action FROM bak_20261104_outreach_trigger_action WHERE metric_key = 'outreach_human_clicks_7d') WHERE metric_key = 'outreach_human_clicks_7d' AND EXISTS (SELECT 1 FROM bak_20261104_outreach_trigger_action); UPDATE fleet_tasks SET definition = (SELECT definition FROM bak_20261104_recompute_task WHERE id = 'event-metric-recompute'), version = version + 1, updated_at = datetime('now') WHERE id = 'event-metric-recompute' AND EXISTS (SELECT 1 FROM bak_20261104_recompute_task); UPDATE output_quality_measures SET role = 'proxy' WHERE metric IN ('engaged_reader_sessions_7d', 'research_neurons_per_engaged_session_7d', 'outreach_engaged_per_100_clicks_7d', 'social_engaged_sessions_7d');
-- Rollback note: the tables, views, metric rows, decision_log and issue rows stay as evidence; the rollback stops every writer (governor, refresh steps, trigger text) and takes the three measures out of the verdict.
-- spof-review: the refresh steps run inside event-metric-recompute (one producer, hourly :55); a missed run leaves the 7 day windows one hour older, and the governor, when on, holds its value.
-- runtime-probe (D1): SELECT metric, last_value, last_refreshed FROM metric_registry WHERE metric = 'engaged_reader_sessions_7d' -- expected a number and a refresh within 30 h
-- CAUSE-MAPPED: INSERT INTO metric_breach_cause below maps the four metrics (publishing, measurement, spend, publishing) in this same file.

-- ---- backups of the three live rows this change edits -------------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bak_20261104_research_neurons_cfg AS
SELECT key, value, note, updated_at FROM ops_config WHERE key = 'research_daily_neurons';

CREATE TABLE IF NOT EXISTS bak_20261104_outreach_trigger_action AS
SELECT metric_key, action FROM analytics_metric_triggers WHERE metric_key = 'outreach_human_clicks_7d';

CREATE TABLE IF NOT EXISTS bak_20261104_recompute_task AS
SELECT id, definition, version, timeout_ms FROM fleet_tasks WHERE id = 'event-metric-recompute';

-- ---- the ledgers ------------------------------------------------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reader_yield_daily (
  day TEXT PRIMARY KEY,
  ga4_sessions REAL,
  ga4_engaged REAL,
  ga4_sessions_social REAL,
  ga4_engaged_social REAL,
  ga4_sessions_external REAL,
  ga4_engaged_external REAL,
  ga4_engaged_direct REAL,
  utm_clicks_human REAL,
  ext_referred_pv REAL,
  papers_published INTEGER,
  research_neurons REAL,
  refreshed_at TEXT
);

CREATE TABLE IF NOT EXISTS paper_readership (
  key64 TEXT PRIMARY KEY,
  slug TEXT,
  pv_30d REAL,
  ext_30d REAL,
  cont_30d REAL,
  utm_30d REAL,
  ga4_sessions_30d REAL,
  pv_7d REAL,
  pv_prev_7d REAL,
  utm_7d REAL,
  utm_prev_7d REAL,
  published_at TEXT,
  idea_source TEXT,
  idea_score REAL,
  refreshed_at TEXT
);

-- One row a day for the last 14 complete UTC days. A column is NULL where its source has no row for that day (GA4 starts 2026-10-25), never a zero.
-- ga4_engaged is every source; ga4_engaged_external leaves out '(direct)', '(not set)', '(none)' and the hosts in ops_config reader_internal_sources (the owner's and the fleet's own browsing).
CREATE VIEW IF NOT EXISTS v_reader_yield_source AS
WITH RECURSIVE d(day, n) AS (
  SELECT date('now', '-1 day'), 1
  UNION ALL
  SELECT date(day, '-1 day'), n + 1 FROM d WHERE n < 14
)
SELECT d.day AS day,
  (SELECT SUM(value) FROM reach_signals WHERE source = 'ga4' AND entity_type = 'channel' AND metric = 'sessions' AND date = d.day) AS ga4_sessions,
  (SELECT SUM(value) FROM reach_signals WHERE source = 'ga4' AND entity_type = 'channel' AND metric = 'engagedSessions' AND date = d.day) AS ga4_engaged,
  (SELECT SUM(value) FROM reach_signals WHERE source = 'ga4' AND entity_type = 'channel' AND metric = 'sessions' AND entity_id = 'organic social' AND date = d.day) AS ga4_sessions_social,
  (SELECT SUM(value) FROM reach_signals WHERE source = 'ga4' AND entity_type = 'channel' AND metric = 'engagedSessions' AND entity_id = 'organic social' AND date = d.day) AS ga4_engaged_social,
  CASE WHEN EXISTS (SELECT 1 FROM reach_signals WHERE source = 'ga4' AND entity_type = 'source' AND metric = 'sessions' AND date = d.day) THEN COALESCE((SELECT SUM(value) FROM reach_signals WHERE source = 'ga4' AND entity_type = 'source' AND metric = 'sessions' AND date = d.day AND entity_id NOT IN ('(direct)', '(not set)', '(none)') AND instr(',' || COALESCE((SELECT value FROM ops_config WHERE key = 'reader_internal_sources'), '') || ',', ',' || entity_id || ',') = 0), 0) END AS ga4_sessions_external,
  CASE WHEN EXISTS (SELECT 1 FROM reach_signals WHERE source = 'ga4' AND entity_type = 'source' AND metric = 'engagedSessions' AND date = d.day) THEN COALESCE((SELECT SUM(value) FROM reach_signals WHERE source = 'ga4' AND entity_type = 'source' AND metric = 'engagedSessions' AND date = d.day AND entity_id NOT IN ('(direct)', '(not set)', '(none)') AND instr(',' || COALESCE((SELECT value FROM ops_config WHERE key = 'reader_internal_sources'), '') || ',', ',' || entity_id || ',') = 0), 0) END AS ga4_engaged_external,
  (SELECT SUM(value) FROM reach_signals WHERE source = 'ga4' AND entity_type = 'source' AND metric = 'engagedSessions' AND entity_id = '(direct)' AND date = d.day) AS ga4_engaged_direct,
  (SELECT SUM(value) FROM reach_signals WHERE source = 'utm' AND entity_type = 'campaign' AND metric = 'clicks_human' AND date = d.day) AS utm_clicks_human,
  (SELECT SUM(value) FROM reach_signals WHERE source = 'cf-rum-human' AND entity_type IN ('page', 'paper') AND metric = 'external_pageviews' AND date = d.day) AS ext_referred_pv,
  (SELECT COUNT(*) FROM research_queue WHERE published_at >= d.day AND published_at < date(d.day, '+1 day')) AS papers_published,
  (SELECT SUM(neurons) FROM ai_call_counters WHERE day = d.day AND worker IN ('qnfo-research-exec', 'qnfo-paper-reviser', 'errata-hub')) AS research_neurons,
  strftime('%Y-%m-%dT%H:%M:%SZ', 'now') AS refreshed_at
FROM d;

-- One row per paper key (the 64 character lower-case campaign key the UTM ledger uses). Reads three indexed slices of reach_signals (about 12k rows) and the last 90 days of research_queue;
-- published_at, idea_source and idea_score come from the earliest row in that window (SQLite takes bare columns from the MIN row), so a later revision does not make a paper look new.
-- ext_30d is the only per-paper count that is not a floor: page loads with a referrer outside the fleet. cont_30d, pv_30d and utm_30d are kept because their floor is the finding.
CREATE VIEW IF NOT EXISTS v_paper_readership_source AS
WITH s AS (
  SELECT lower(substr(entity_id, 1, 64)) AS k, entity_id AS slug, date, metric, value, 'rum' AS src
  FROM reach_signals
  WHERE source = 'cf-rum-human' AND entity_type = 'paper' AND metric IN ('pageviews', 'external_pageviews', 'continuation_pageviews') AND date >= date('now', '-30 days')
  UNION ALL
  SELECT lower(substr(entity_id, 1, 64)), entity_id, date, metric, value, 'utm'
  FROM reach_signals
  WHERE source = 'utm' AND entity_type = 'campaign' AND metric = 'clicks_human' AND date >= date('now', '-30 days')
  UNION ALL
  SELECT lower(substr(substr(entity_id, 9), 1, 64)), substr(entity_id, 9), date, 'ga4_sessions', value, 'ga4'
  FROM reach_signals
  WHERE source = 'ga4' AND entity_type = 'page' AND metric = 'sessions' AND entity_id LIKE '/papers/%' AND entity_id NOT LIKE '/papers/%/%' AND date >= date('now', '-30 days')
), a AS (
  SELECT k,
    MAX(CASE WHEN src = 'rum' THEN slug END) AS slug_rum,
    MAX(slug) AS slug_any,
    SUM(CASE WHEN src = 'rum' AND metric = 'pageviews' THEN value ELSE 0 END) AS pv_30d,
    SUM(CASE WHEN metric = 'external_pageviews' THEN value ELSE 0 END) AS ext_30d,
    SUM(CASE WHEN metric = 'continuation_pageviews' THEN value ELSE 0 END) AS cont_30d,
    SUM(CASE WHEN src = 'utm' THEN value ELSE 0 END) AS utm_30d,
    SUM(CASE WHEN src = 'ga4' THEN value ELSE 0 END) AS ga4_sessions_30d,
    SUM(CASE WHEN src = 'rum' AND metric = 'pageviews' AND date >= date('now', '-7 days') THEN value ELSE 0 END) AS pv_7d,
    SUM(CASE WHEN src = 'rum' AND metric = 'pageviews' AND date >= date('now', '-14 days') AND date < date('now', '-7 days') THEN value ELSE 0 END) AS pv_prev_7d,
    SUM(CASE WHEN src = 'utm' AND date >= date('now', '-7 days') THEN value ELSE 0 END) AS utm_7d,
    SUM(CASE WHEN src = 'utm' AND date >= date('now', '-14 days') AND date < date('now', '-7 days') THEN value ELSE 0 END) AS utm_prev_7d
  FROM s GROUP BY k
), q AS (
  SELECT lower(substr(paper_slug, 1, 64)) AS k, MIN(published_at) AS published_at, source AS idea_source, score AS idea_score
  FROM research_queue WHERE paper_slug IS NOT NULL AND published_at >= date('now', '-90 days') GROUP BY 1
)
SELECT a.k AS key64, COALESCE(a.slug_rum, a.slug_any) AS slug, a.pv_30d, a.ext_30d, a.cont_30d, a.utm_30d, a.ga4_sessions_30d, a.pv_7d, a.pv_prev_7d, a.utm_7d, a.utm_prev_7d,
  q.published_at, q.idea_source, q.idea_score, strftime('%Y-%m-%dT%H:%M:%SZ', 'now') AS refreshed_at
FROM a LEFT JOIN q ON q.k = a.k;

-- Yield by where the idea came from, for papers first published in the last 45 days and refreshed in the last 2 days (a paper that left the 30 day window is not read as current). share_with_ext_visit is the share of papers an outsider reached from another site.
CREATE VIEW IF NOT EXISTS v_reader_yield_by_source AS
SELECT COALESCE(idea_source, '(unknown)') AS idea_source, COUNT(*) AS papers,
  ROUND(AVG(ext_30d), 3) AS ext_visits_per_paper,
  ROUND(1.0 * SUM(CASE WHEN ext_30d > 0 THEN 1 ELSE 0 END) / COUNT(*), 3) AS share_with_ext_visit,
  ROUND(AVG(ga4_sessions_30d), 3) AS ga4_sessions_per_paper,
  ROUND(AVG(utm_30d), 2) AS utm_clicks_per_paper_unverified
FROM paper_readership
WHERE published_at >= date('now', '-45 days') AND refreshed_at >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-2 days')
GROUP BY 1;

-- Papers someone outside the fleet reached, or that GA4 saw a few times. suspect_automated marks 50 or more sessions with no external referrer (one page had 110 in a day on 11-03).
CREATE VIEW IF NOT EXISTS v_paper_readers_top AS
SELECT slug, ext_30d, ga4_sessions_30d, cont_30d, pv_30d, utm_30d, published_at, idea_source,
  ROUND(ext_30d + MIN(ga4_sessions_30d, 20) / 20.0, 2) AS reader_score,
  CASE WHEN ga4_sessions_30d >= 50 AND ext_30d = 0 THEN 1 ELSE 0 END AS suspect_automated
FROM paper_readership
WHERE (ext_30d > 0 OR ga4_sessions_30d >= 3) AND refreshed_at >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-2 days')
ORDER BY reader_score DESC;

-- The four metrics, from the last 7 days that have GA4 source rows. engaged_reader_sessions_7d and the cost per engaged session use the externally sourced count. NULL (never a zero) until 7 such days exist.
CREATE VIEW IF NOT EXISTS v_reader_yield_metrics AS
WITH w AS (SELECT * FROM reader_yield_daily WHERE ga4_engaged_external IS NOT NULL ORDER BY day DESC LIMIT 7)
SELECT 'engaged_reader_sessions_7d' AS metric,
  CASE WHEN COUNT(*) >= 7 THEN SUM(ga4_engaged_external) END AS value
FROM w
UNION ALL
SELECT 'outreach_engaged_per_100_clicks_7d',
  CASE WHEN COUNT(*) >= 7 AND SUM(utm_clicks_human) > 0 THEN ROUND(100.0 * SUM(ga4_engaged_social) / SUM(utm_clicks_human), 2) END
FROM w
UNION ALL
SELECT 'research_neurons_per_engaged_session_7d',
  CASE WHEN COUNT(*) >= 7 AND SUM(ga4_engaged_external) > 0 AND SUM(research_neurons) IS NOT NULL THEN ROUND(SUM(research_neurons) / SUM(ga4_engaged_external)) END
FROM w
UNION ALL
SELECT 'social_engaged_sessions_7d',
  CASE WHEN COUNT(*) >= 7 THEN SUM(ga4_engaged_social) END
FROM w;

-- ---- the research volume governor -------------------------------------------------------------------------------------------------------------------------------------------
INSERT OR IGNORE INTO ops_config (key, value, note, updated_at) VALUES
  ('research_yield_governor', 'off', 'READER-YIELD-1 2026-11-04: off = the refresh publishes the target (v_research_volume_target, the daily reader-yield event) and never writes research_daily_neurons. on = once a UTC day it moves the key toward engaged readers a day x research_yield_neurons_per_engaged_day, inside the floor and ceiling, at most research_yield_step_pct a day, and pauses on any foreign write. Off because ops_config research_policy_harmonized names qnfo-ops the single writer of the key; the owner of that key switches it on (issue READER-YIELD-1.5). Revert: set off and restore research_daily_neurons from bak_20261104_research_neurons_cfg.', datetime('now')),
  ('research_yield_neurons_per_engaged_day', '64000', 'READER-YIELD-1 2026-11-04: calibration, not a law. 5.6 externally sourced engaged GA4 sessions a day (10 days to 11-03) x 64000 = 358k, so the key stays near 360000 today; USD 0.70 of Workers AI per engaged-session-day.', datetime('now')),
  ('reader_internal_sources', 'ask.qwav.tech,github.com,q08.org,q08,qwav.org,qwav.tech,deep.qwav.tech,qnfo.org,papers.qnfo.org,ideas.qnfo.org,legal.qnfo.org,archive.qnfo.org,reading.q08.org,tauri.localhost,localhost', 'READER-YIELD-1 2026-11-04: GA4 sources that are the owner and the fleet reading their own pages (comma list, no spaces). Together with (direct), (not set) and (none) they are left out of engaged_reader_sessions_7d. Edit the list without a deploy.', datetime('now')),
  ('research_yield_floor', '180000', 'READER-YIELD-1 2026-11-04: half of the 2026-10-21 budget; research never stops, it runs at 50 percent when readers fall.', datetime('now')),
  ('research_yield_ceiling', '450000', 'READER-YIELD-1 2026-11-04: the most the governor sets, about USD 5 a day; a higher key is the owner or ops session writing it, and pauses the governor.', datetime('now')),
  ('research_yield_step_pct', '10', 'READER-YIELD-1 2026-11-04: largest move per day, percent of the current value.', datetime('now')),
  ('research_yield_min_days', '28', 'READER-YIELD-1 2026-11-04: days of externally sourced GA4 engaged-session rows needed before the governor moves (the signal is 5.6 a day and spiky, 0 to 15); fewer is neutral. GA4 rows start 2026-10-25, so 28 days exist from 2026-11-21.', datetime('now'));

INSERT OR IGNORE INTO ops_config (key, value, note, updated_at)
SELECT 'research_yield_last_written', value, 'READER-YIELD-1 2026-11-04: the value the governor last wrote to research_daily_neurons (seeded with the value found at install). If the key differs, another writer changed it and the governor pauses until this key is set to an empty string or to the current value.', datetime('now')
FROM ops_config WHERE key = 'research_daily_neurons';

CREATE VIEW IF NOT EXISTS v_research_volume_target AS
WITH cfg AS (
  SELECT
    COALESCE((SELECT value FROM ops_config WHERE key = 'research_yield_governor'), 'off') AS gov,
    CAST(COALESCE((SELECT value FROM ops_config WHERE key = 'research_yield_neurons_per_engaged_day'), '64000') AS REAL) AS per_eng,
    CAST(COALESCE((SELECT value FROM ops_config WHERE key = 'research_yield_floor'), '180000') AS REAL) AS fl,
    CAST(COALESCE((SELECT value FROM ops_config WHERE key = 'research_yield_ceiling'), '450000') AS REAL) AS ceil,
    CAST(COALESCE((SELECT value FROM ops_config WHERE key = 'research_yield_step_pct'), '10') AS REAL) / 100.0 AS step,
    CAST(COALESCE((SELECT value FROM ops_config WHERE key = 'research_yield_min_days'), '28') AS INTEGER) AS min_days,
    CAST(NULLIF(COALESCE((SELECT value FROM ops_config WHERE key = 'research_daily_neurons'), ''), '') AS REAL) AS cur,
    COALESCE((SELECT value FROM ops_config WHERE key = 'research_yield_last_written'), '') AS lw
), w AS (
  SELECT COUNT(*) AS days, SUM(ga4_engaged_external) AS eng
  FROM (SELECT ga4_engaged_external FROM reader_yield_daily WHERE ga4_engaged_external IS NOT NULL ORDER BY day DESC LIMIT 28)
), t AS (
  SELECT cfg.*, w.days AS days, w.eng / NULLIF(w.days, 0) AS per_day,
    MIN(cfg.ceil, MAX(cfg.fl, w.eng / NULLIF(w.days, 0) * cfg.per_eng)) AS clamped
  FROM cfg, w
), r AS (
  SELECT gov, days, per_day, cur, clamped, per_eng, fl, ceil, step,
    CASE
      WHEN gov <> 'on' THEN 'governor off'
      WHEN cur IS NULL THEN 'research_daily_neurons unreadable'
      WHEN days < min_days THEN 'needs ' || min_days || ' days of externally sourced GA4 engaged sessions, has ' || days
      WHEN lw <> '' AND CAST(lw AS REAL) <> cur THEN 'paused: research_daily_neurons was changed by another writer'
      WHEN cur < fl OR cur > ceil THEN 'paused: current value is outside the governor band'
      WHEN clamped IS NULL THEN 'no engaged-session rows'
      WHEN ABS(clamped - cur) < 0.02 * cur THEN 'inside the 2 percent dead band'
      ELSE 'moving'
    END AS reason
  FROM t
)
SELECT gov, days, ROUND(per_day, 2) AS engaged_per_day, cur, ROUND(clamped) AS target, per_eng, fl AS floor_neurons, ceil AS ceiling_neurons,
  ROUND(CASE WHEN cur IS NULL OR clamped IS NULL THEN NULL ELSE cur + MAX(-step * cur, MIN(step * cur, clamped - cur)) END) AS step_target,
  reason, CASE WHEN reason = 'moving' THEN 1 ELSE 0 END AS eligible
FROM r;

-- ---- the refresh: steps appended to the existing hourly fleet_tasks event-metric-recompute (no new cron while fleet_budget caps are breached; one statement a step) -------------------------------
-- Every step is idempotent and cheap (about 14k rows read an hour). Only the governor, the decision row and the daily event are once a UTC day: the governor and the ledger event key on
-- cloud_ops_events id reader-yield-<yyyymmdd>, so an hourly or retried run cannot move the key twice in a day.
UPDATE fleet_tasks
SET definition = json_object('steps', json((
      SELECT json_group_array(json(x.step)) FROM (
        SELECT value AS step FROM json_each(fleet_tasks.definition, '$.steps')
        UNION ALL
        SELECT value AS step FROM json_each('[
    {"type":"sql","db":"AUDIT","name":"daily-ledger","sql":"INSERT OR REPLACE INTO reader_yield_daily (day, ga4_sessions, ga4_engaged, ga4_sessions_social, ga4_engaged_social, ga4_sessions_external, ga4_engaged_external, ga4_engaged_direct, utm_clicks_human, ext_referred_pv, papers_published, research_neurons, refreshed_at) SELECT day, ga4_sessions, ga4_engaged, ga4_sessions_social, ga4_engaged_social, ga4_sessions_external, ga4_engaged_external, ga4_engaged_direct, utm_clicks_human, ext_referred_pv, papers_published, research_neurons, refreshed_at FROM v_reader_yield_source"},
    {"type":"sql","db":"AUDIT","name":"paper-readership","sql":"INSERT OR REPLACE INTO paper_readership (key64, slug, pv_30d, ext_30d, cont_30d, utm_30d, ga4_sessions_30d, pv_7d, pv_prev_7d, utm_7d, utm_prev_7d, published_at, idea_source, idea_score, refreshed_at) SELECT key64, slug, pv_30d, ext_30d, cont_30d, utm_30d, ga4_sessions_30d, pv_7d, pv_prev_7d, utm_7d, utm_prev_7d, published_at, idea_source, idea_score, refreshed_at FROM v_paper_readership_source"},
    {"type":"sql","db":"AUDIT","name":"paper-readership-prune","sql":"DELETE FROM paper_readership WHERE refreshed_at < strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-14 days'')"},
    {"type":"sql","db":"AUDIT","name":"metrics","sql":"UPDATE metric_registry SET last_value = (SELECT CASE WHEN m.value = CAST(m.value AS INTEGER) THEN CAST(CAST(m.value AS INTEGER) AS TEXT) ELSE CAST(m.value AS TEXT) END FROM v_reader_yield_metrics m WHERE m.metric = metric_registry.metric), last_refreshed = strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now''), state = ''MEASURED'' WHERE metric IN (SELECT metric FROM v_reader_yield_metrics WHERE value IS NOT NULL)"},
    {"type":"sql","db":"AUDIT","name":"governor","sql":"UPDATE ops_config SET value = CAST(CAST((SELECT step_target FROM v_research_volume_target) AS INTEGER) AS TEXT), note = ''READER-YIELD-1 governor '' || strftime(''%Y-%m-%dT%H:%MZ'', ''now'') || '': engaged readers a day '' || COALESCE((SELECT CAST(engaged_per_day AS TEXT) FROM v_research_volume_target), ''?'') || '' x research_yield_neurons_per_engaged_day, inside the floor and ceiling, at most research_yield_step_pct a day. Earlier text: bak_20261104_research_neurons_cfg. Revert: research_yield_governor = off.'', updated_at = datetime(''now'') WHERE key = ''research_daily_neurons'' AND (SELECT eligible FROM v_research_volume_target) = 1 AND NOT EXISTS (SELECT 1 FROM cloud_ops_events WHERE id = ''reader-yield-'' || strftime(''%Y%m%d'', ''now''))"},
    {"type":"sql","db":"AUDIT","name":"remember-write","sql":"UPDATE ops_config SET value = (SELECT value FROM ops_config WHERE key = ''research_daily_neurons''), updated_at = datetime(''now'') WHERE key = ''research_yield_last_written'' AND (SELECT note FROM ops_config WHERE key = ''research_daily_neurons'') LIKE ''READER-YIELD-1 governor %'' AND (SELECT updated_at FROM ops_config WHERE key = ''research_daily_neurons'') >= datetime(''now'', ''-2 minutes'')"},
    {"type":"sql","db":"AUDIT","name":"decision","sql":"INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested) SELECT ''fleet_task reader-yield-refresh'', ''research volume should follow the audience that reads, with a floor'', ''research_daily_neurons set to '' || c.value, ''GA4 engaged sessions 7d '' || COALESCE((SELECT value FROM metric_registry WHERE metric = ''engaged_reader_sessions_7d''), ''?'') || ''; target row: '' || COALESCE((SELECT engaged_per_day || '' a day, step_target '' || step_target FROM v_research_volume_target), ''?''), ''applied by the governor'', ''qnfo-research-exec daily neuron budget only'', ''set ops_config research_yield_governor to off and restore research_daily_neurons from bak_20261104_research_neurons_cfg'', ''the research budget follows engaged readers, inside the floor and ceiling'', ''the key keeps moving at most 10 percent a day; engaged_reader_sessions_7d stays inside 20 percent of its baseline'', ''none: cost and measurement'', ''v_research_volume_target'' FROM ops_config c WHERE c.key = ''research_daily_neurons'' AND c.note LIKE ''READER-YIELD-1 governor %'' AND c.updated_at >= datetime(''now'', ''-2 minutes'') AND NOT EXISTS (SELECT 1 FROM decision_log d WHERE d.actor = ''fleet_task reader-yield-refresh'' AND replace(substr(d.ts, 1, 19), ''T'', '' '') >= c.updated_at)"},
    {"type":"sql","db":"AUDIT","name":"reader-yield-event","sql":"INSERT OR IGNORE INTO cloud_ops_events (id, ts, kind, text, meta, job, status) SELECT ''reader-yield-'' || strftime(''%Y%m%d'', ''now''), datetime(''now''), ''reader-yield'', ''READER-YIELD-1: engaged readers a day '' || COALESCE(CAST(engaged_per_day AS TEXT), ''?'') || '' over '' || days || '' days; research_daily_neurons '' || COALESCE(CAST(CAST(cur AS INTEGER) AS TEXT), ''?'') || '', target '' || COALESCE(CAST(CAST(target AS INTEGER) AS TEXT), ''?'') || '': '' || reason, NULL, ''event-metric-recompute'', ''ok'' FROM v_research_volume_target"}
  ]')
      ) x))),
    timeout_ms = MAX(timeout_ms, 60000),
    version = version + 1,
    updated_at = datetime('now')
WHERE id = 'event-metric-recompute' AND definition NOT LIKE '%daily-ledger%';

-- ---- first fill (the same statements the steps run), so the baseline exists the moment this merges -----------------------------------------------------------------------------
INSERT OR REPLACE INTO reader_yield_daily (day, ga4_sessions, ga4_engaged, ga4_sessions_social, ga4_engaged_social, ga4_sessions_external, ga4_engaged_external, ga4_engaged_direct, utm_clicks_human, ext_referred_pv, papers_published, research_neurons, refreshed_at)
SELECT day, ga4_sessions, ga4_engaged, ga4_sessions_social, ga4_engaged_social, ga4_sessions_external, ga4_engaged_external, ga4_engaged_direct, utm_clicks_human, ext_referred_pv, papers_published, research_neurons, refreshed_at FROM v_reader_yield_source;

INSERT OR REPLACE INTO paper_readership (key64, slug, pv_30d, ext_30d, cont_30d, utm_30d, ga4_sessions_30d, pv_7d, pv_prev_7d, utm_7d, utm_prev_7d, published_at, idea_source, idea_score, refreshed_at)
SELECT key64, slug, pv_30d, ext_30d, cont_30d, utm_30d, ga4_sessions_30d, pv_7d, pv_prev_7d, utm_7d, utm_prev_7d, published_at, idea_source, idea_score, refreshed_at FROM v_paper_readership_source;

-- ---- the three metrics, their classification, cause mapping and history backfill ------------------------------------------------------------------------------------------------
INSERT OR IGNORE INTO metric_registry (metric, layer, kind, formula, source_of_truth, baseline, target, owner, disposition_actor, refresh_cadence, warning_band, kill_band, state, refresh_class) VALUES
  ('engaged_reader_sessions_7d', 'fleet', 'leading',
   'sum of GA4 engagedSessions (a session of 10 seconds or more, two page views or a conversion) whose source is outside the fleet (not (direct), (not set), (none) or a host in ops_config reader_internal_sources) over the last 7 days that have GA4 source rows; steps appended to fleet_tasks event-metric-recompute (READER-YIELD-1) from reach_signals source ga4',
   'qnfo-audit.reader_yield_daily <- reach_signals source ga4 entity_type source metric engagedSessions (qnfo-fleet-dashboard reach ingest)',
   '44 (2026-10-28..11-03: externally sourced engaged sessions; 122 from all sources incl. direct and the fleet''s own hosts; GA4 rows start 2026-10-25)',
   'rising; no absolute gate. The research budget follows it (v_research_volume_target)',
   'qnfo-fleet-control', 'IMPROVEMENT-LOOP-1 files METRIC-REGRESSION-1 on a decline (exempt from a threshold trigger: a threshold would file an issue for a number that outreach and search move, not research; READER-YIELD-1)',
   'daily', '< 25', NULL, 'UNMEASURED', 'computed'),
  ('outreach_engaged_per_100_clicks_7d', 'fleet', 'leading',
   '100 x GA4 engaged sessions from the organic social channel / utm_clicks_human over the last 7 days that have GA4 rows (READER-YIELD-1); a validity measure of outreach_human_clicks_7d',
   'qnfo-audit.reader_yield_daily <- reach_signals sources ga4 and utm',
   '2.0 (2026-10-25..11-03: 25 engaged social sessions per 1260 counted clicks)',
   'rising: counted clicks that are readers; fix by classing automated fetchers as bots in the gateway (ROADMAP-1 row filed with this migration)',
   'qnfo-social', 'exempt from a threshold trigger: validity information with no lever of its own until the gateway classifier changes (READER-YIELD-1 ROADMAP-1 row)',
   'daily', '< 1', NULL, 'UNMEASURED', 'computed'),
  ('research_neurons_per_engaged_session_7d', 'fleet', 'leading',
   'Workers AI neurons of qnfo-research-exec, qnfo-paper-reviser and errata-hub in the last 7 days that have GA4 source rows / externally sourced GA4 engaged sessions in the same days (READER-YIELD-1); cost of one engaged reader',
   'qnfo-audit.reader_yield_daily <- ai_call_counters and reach_signals source ga4 (entity_type source)',
   '104210 (2026-10-28..11-03: 4,585,257 neurons, 44 externally sourced engaged sessions; 37583 over all 122)',
   'falling; the research governor and ops_config research_daily_neurons are the levers',
   'qnfo-fleet-control', 'exempt from a threshold trigger: fleet_cost_bound_month_usd and the ai_spend caps judge cost; this reads cost per reader (READER-YIELD-1)',
   'daily', '> 150000', NULL, 'UNMEASURED', 'computed'),
  ('social_engaged_sessions_7d', 'fleet', 'leading',
   'sum of GA4 engagedSessions (10 seconds or more, two page views or a conversion) of the Organic Social channel group over the last 7 days that have GA4 rows (READER-YIELD-1); the people outreach posts bring who stay',
   'qnfo-audit.reader_yield_daily <- reach_signals source ga4 entity_type channel entity_id organic social',
   '21 (2026-10-28..11-03; 25 in the 10 days to 11-03 from 1260 counted clicks)',
   'rising; no absolute gate: the promotion surface outcome that replaces counted clicks (PROBE-UA-BOT-1 makes outreach_human_clicks_7d a proxy)',
   'qnfo-social', 'exempt from a threshold trigger: judged by v_output_quality_verdict as an outcome; a threshold on 21 a week would file an issue for noise (READER-YIELD-1)',
   'daily', '< 5', NULL, 'UNMEASURED', 'computed');

UPDATE metric_registry
SET last_value = (SELECT CASE WHEN m.value = CAST(m.value AS INTEGER) THEN CAST(CAST(m.value AS INTEGER) AS TEXT) ELSE CAST(m.value AS TEXT) END FROM v_reader_yield_metrics m WHERE m.metric = metric_registry.metric),
    last_refreshed = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
    state = 'MEASURED'
WHERE metric IN (SELECT metric FROM v_reader_yield_metrics WHERE value IS NOT NULL);

INSERT OR IGNORE INTO metric_breach_cause (metric_key, cause_key, note) VALUES
  ('engaged_reader_sessions_7d', 'publishing', 'READER-YIELD-1 2026-11-04: engaged readers move with distribution (search, referrals, X), not with the number of papers; the lever is where outreach goes and what search can find.'),
  ('outreach_engaged_per_100_clicks_7d', 'measurement', 'READER-YIELD-1 2026-11-04: a low value says the counted clicks are fetchers, not readers; the repair is the gateway classifier, not more posts.'),
  ('research_neurons_per_engaged_session_7d', 'spend', 'READER-YIELD-1 2026-11-04: neurons spent per engaged reader; the lever is the research budget (research_daily_neurons, the governor), not a model change.'),
  ('social_engaged_sessions_7d', 'publishing', 'READER-YIELD-1 2026-11-04: engaged sessions from social posts move with where and how outreach posts (X and Mastodon carry engaged sessions, the Substack and Bluesky roll-ups carry almost none), not with the number of papers.');

INSERT OR IGNORE INTO metric_history (metric, day, value, meets, target, ts)
SELECT 'engaged_reader_sessions_7d', r.day,
  (SELECT SUM(x.ga4_engaged_external) FROM reader_yield_daily x WHERE x.day <= r.day AND x.day > date(r.day, '-7 days')),
  NULL, 'rising', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
FROM reader_yield_daily r
WHERE r.ga4_engaged_external IS NOT NULL
  AND (SELECT COUNT(*) FROM reader_yield_daily x WHERE x.day <= r.day AND x.day > date(r.day, '-7 days') AND x.ga4_engaged_external IS NOT NULL) = 7;

INSERT OR IGNORE INTO metric_history (metric, day, value, meets, target, ts)
SELECT 'outreach_engaged_per_100_clicks_7d', r.day,
  (SELECT ROUND(100.0 * SUM(x.ga4_engaged_social) / NULLIF(SUM(x.utm_clicks_human), 0), 2) FROM reader_yield_daily x WHERE x.day <= r.day AND x.day > date(r.day, '-7 days')),
  NULL, 'rising', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
FROM reader_yield_daily r
WHERE r.ga4_engaged_external IS NOT NULL
  AND (SELECT COUNT(*) FROM reader_yield_daily x WHERE x.day <= r.day AND x.day > date(r.day, '-7 days') AND x.ga4_engaged_external IS NOT NULL) = 7;

INSERT OR IGNORE INTO metric_history (metric, day, value, meets, target, ts)
SELECT 'research_neurons_per_engaged_session_7d', r.day,
  (SELECT ROUND(SUM(x.research_neurons) / NULLIF(SUM(x.ga4_engaged_external), 0)) FROM reader_yield_daily x WHERE x.day <= r.day AND x.day > date(r.day, '-7 days')),
  NULL, 'falling', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
FROM reader_yield_daily r
WHERE r.ga4_engaged_external IS NOT NULL
  AND (SELECT COUNT(*) FROM reader_yield_daily x WHERE x.day <= r.day AND x.day > date(r.day, '-7 days') AND x.ga4_engaged_external IS NOT NULL) = 7;

INSERT OR IGNORE INTO metric_history (metric, day, value, meets, target, ts)
SELECT 'social_engaged_sessions_7d', r.day,
  (SELECT SUM(x.ga4_engaged_social) FROM reader_yield_daily x WHERE x.day <= r.day AND x.day > date(r.day, '-7 days')),
  NULL, 'rising', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
FROM reader_yield_daily r
WHERE r.ga4_engaged_external IS NOT NULL
  AND (SELECT COUNT(*) FROM reader_yield_daily x WHERE x.day <= r.day AND x.day > date(r.day, '-7 days') AND x.ga4_engaged_external IS NOT NULL) = 7;

INSERT OR IGNORE INTO output_quality_measures (metric, surface, role, polarity, tol_rel, tol_abs, judged_by, caveat) VALUES
  ('engaged_reader_sessions_7d', 'papers', 'outcome', 1, 0.2, 10,
   'people: GA4 engaged sessions on the public sites (10 seconds or more, two page views or a conversion), the one reader count the generators cannot satisfy',
   'Counts engaged sessions whose GA4 source is outside the fleet: direct (83 percent of sessions, 7.5 percent engaged) and the fleet''s own hosts are left out because they hold the owner''s and the fleet''s own browsing (the Netherlands is 116 of 307 engaged sessions in 28 days from 25 users). It still counts the owner clicking their own posts (an internal-traffic rule in GA4 is an owner card) and the owner''s typed visits are lost to direct. Ad blockers undercount it; 44 in 7 days, 0 to 15 a day: read weeks, not days. GA4 rows start 2026-10-25: no verdict before 2026-11-07.'),
  ('research_neurons_per_engaged_session_7d', 'papers', 'outcome', -1, 0.2, 2000,
   'cost of one engaged reader: Workers AI neurons of the research workers over GA4 engaged sessions, same 7 days',
   'cutting spend alone improves it: read it with engaged_reader_sessions_7d, which must not fall. The neuron count includes revisions and errata work, whose readers it cannot tell apart.'),
  ('social_engaged_sessions_7d', 'promotion', 'outcome', 1, 0.3, 5,
   'people: GA4 engaged sessions from the Organic Social channel group (10 seconds or more, two page views or a conversion): the readers outreach posts bring who stay, which a probe or a link preview cannot fake',
   '21 in 7 days, spiky: read weeks. It still counts the owner clicking their own posts (X is 17 of 19 sessions engaged, which reads like it) and ad blockers undercount it. It replaces outreach_human_clicks_7d and outreach_clicks_per_post_7d as the promotion outcome once PROBE-UA-BOT-1 classes them as proxies; until that migration lands both exist.'),
  ('outreach_engaged_per_100_clicks_7d', 'promotion', 'validity', 1, 0.2, 0.5,
   'share of counted UTM human clicks that became GA4 engaged sessions from organic social, per 100',
   'about 2 per 100 on 2026-11-03: outreach_human_clicks_7d and outreach_clicks_per_post_7d count fetchers and previews as people; read them only with this measure. GA4 undercounts readers who block scripts.');

-- ---- the outreach trigger text: one short sentence after the Pillar header (triggerIssueDescription keeps 300 characters of prose, so the original levers must stay inside them) -----------------
UPDATE analytics_metric_triggers
SET action = replace(action, 'Pillar reach. ', 'Pillar reach. READER-YIELD-1: clicks are not readers; read outreach_engaged_per_100_clicks_7d before lever (2). ')
WHERE metric_key = 'outreach_human_clicks_7d' AND action NOT LIKE '%READER-YIELD-1%' AND action LIKE 'Pillar reach. %';

-- ---- the predictions, on record (decision_log is append-only; predicted_outcome is parsed by decision_predictions_parse as "<metric> <op> <value> within <N> d") -----------------------------
INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT
  'session:reader-yield (claude, QNFO.REACH / QNFO.RSCH)',
  'Research output is not what moves readers: engaged readers come from search, X and referrals and were flat through a 10x swing in papers a day, while each paper carries the same floor of automated visits. Tying the research budget to engaged readers with a floor is safer than a flat cut and than a flat cap that spend ignores.',
  'READER-YIELD-1 migration 2026-11-04-reader-yield-1.sql: reader ledger and per-paper readership tables, three measures (two outcomes, one validity), the research budget as a function of engaged readers (v_research_volume_target: floor 180000, ceiling 450000, 10 percent a day) with the governor that would write ops_config research_daily_neurons left OFF (qnfo-ops is the single writer of that key), outreach trigger text amended, four ROADMAP-1 rows and one issue to switch the governor on. Prediction: externally sourced engaged readers stay inside 20 percent of the 44 a week baseline (122 from all sources, 78 of them direct or the fleet''s own hosts) whatever research volume does (readers do not follow research volume); the budget function reads about 358k at today''s 5.6 a day. Falsifier: engaged_reader_sessions_7d down more than 20 percent in 14 days with outreach cadence unchanged.',
  'GA4 engaged sessions 12..41 a day, 122 in 7 days to 11-03 from all sources, 44 from sources outside the fleet (reach_signals; the live overview shows the Netherlands, 25 users, as 116 of 307 engaged sessions in 28 days); utm_clicks_human 1260 vs 25 engaged organic-social sessions in the same 10 days; per paper utm p10 3 / p50 6 / p90 11, external-referrer loads 0.12 per paper (7 percent of papers); publications 2..89 a day; research neurons 988k and 997k on 11-02 and 11-03 against a key of 360000; pageviews_30d live 19,660..20,500, stored 0/10000/25000/26000 five times in 12 hours.',
  'applied by migration; the refresh steps run at the next :55 run of event-metric-recompute; the governor is off',
  'three new metric rows, new ledger tables, one trigger text and eight steps appended to fleet_tasks event-metric-recompute; research_daily_neurons is not written while the governor is off; no worker code changes',
  'ops_config research_yield_governor = off (it is off), and restore research_daily_neurons from bak_20261104_research_neurons_cfg if it was ever switched on; the migration header Rollback line lists the rest',
  'a reader-grade ledger the fleet can learn from: engaged readers per day and per paper, cost per engaged reader, the share of counted clicks that are readers',
  'engaged_reader_sessions_7d >= 35 within 14 d',
  'no direct reach gain expected from this change; it makes reader growth measurable and stops spend that readers do not reward. Reach levers filed: gateway fetcher classification, verified-reader amplification in qnfo-social.',
  'live qnfo-audit D1 reads and the Cloudflare RUM GraphQL read on 2026-11-04; node:sqlite apply-and-run test migrations/reader-yield-1.test.mjs'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'READER-YIELD-1 migration%');

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT
  'session:reader-yield (claude, QNFO.REACH / QNFO.RSCH)',
  'If the governor is switched on and research_daily_neurons is enforced (the spend-cap work of another session), the key sits near 358k and research neurons per externally sourced engaged reader fall from 104k to about 70k; if it is not enforced the metric stays near 104k and the cap is the next thing to fix.',
  'READER-YIELD-1 cost prediction for the cap that spend does not yet respect (7 days to 11-03: 4,585,257 neurons, 39 papers, 44 externally sourced engaged sessions)',
  'ai_call_counters: research-exec 988,203 and 996,539 neurons on 11-02 and 11-03 against the key 360000; paper-reviser about 85k and errata-hub 18k..39k a day.',
  'recorded; scored by decision_predictions at the due date',
  'cost only',
  'none needed: a prediction row',
  'cost per engaged reader on record',
  'research_neurons_per_engaged_session_7d <= 75000 within 14 d',
  'none',
  'ai_call_counters and reader_yield_daily'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'READER-YIELD-1 cost prediction%');

-- ---- ROADMAP-1: the next items, each with a doer ------------------------------------------------------------------------------------------------------------------------------------
INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.REACH READER-YIELD-1.1: classify automated fetchers as bots in the UTM ledger so outreach clicks mean readers',
 'code-task: repo=qnfo-workers path=qnfo-gateway/worker.js' || char(10) ||
 'code-anchor: var UTM_BOT_RE = /bot|crawler|spider|preview|facebookexternalhit|slackbot|twitterbot|linkedinbot|mastodon|bluesky|cardyb|headless/i;' || char(10) ||
 'code-probe: {"paths": ["qnfo-gateway/worker.js"], "contains": "UTM-READER-CLASS-1"}' || char(10) || char(10) ||
 'Charter pillar reach (program QNFO.REACH). Metric it should move: outreach_engaged_per_100_clicks_7d (2.0 on 2026-11-03; target 8 or more) while engaged_reader_sessions_7d does not fall; outreach_human_clicks_7d is expected to FALL, which is the correction, not a regression.' || char(10) ||
 'Evidence (READER-YIELD-1, migrations/2026-11-04-reader-yield-1.sql): utm_clicks_human 1260 in 10 days vs 25 engaged organic-social GA4 sessions; every paper carries a floor of utm_clicks_human p10 3 / p50 6 / p90 11, flat across idea source, score and age; GA4 bluesky 22 sessions 1 engaged, substack 110 sessions 0 engaged. ua_class is bot only when the user agent matches UTM_BOT_RE (bot|crawler|spider|preview|facebookexternalhit|slackbot|twitterbot|linkedinbot|mastodon|bluesky|cardyb|headless), and qnfo-social probeLink fetches each tagged link with the user agent Mozilla/5.0 (qnfo-social link-probe): of 210 tagged Bluesky roll-up paper-posts 178 got no Bluesky-channel click in 72 hours, 27 got exactly 4, and 52 clicks landed the day before the posts existed, so the fleet''s own probes (and link-preview fetchers and HTTP libraries) read as human.' || char(10) ||
 'The fleet''s own probes are handled by PROBE-UA-BOT-1 (qnfo-social 0.21.15 sends user agents ending in "; bot", which UTM_BOT_RE already matches); this item is what is left after it lands: measure outreach_human_clicks_7d for two days, and if counted clicks still sit near 4 per tagged post, the rest is link-preview fetchers and HTTP libraries. EDIT: mark the load as bot when the user agent is not a browser (does not start with Mozilla/5.0 and name Chrome, Safari, Firefox or Edge) or names a fetcher (python-requests, curl, wget, node-fetch, undici, axios, Go-http-client, okhttp, Java, libwww, Embedly, WhatsApp, Discord, Telegram, Pinterest, Mastodon, http.rb), or when a user agent that claims to be a browser sends neither Sec-Fetch-Mode nor Accept-Language (count how many of today''s human-class loads that would reclassify before shipping: older iOS in-app browsers omit Sec-Fetch-Mode); keep the 64 character campaign and the counter unchanged; name the change UTM-READER-CLASS-1 in a comment; add a test with the user-agent strings that read as human today.' || char(10) ||
 'Definition of done: merged and verified live by the canonical deploy; outreach_engaged_per_100_clicks_7d reads 8 or more two days running; record the before and after in issue_triage.close_evidence. The gateway file is claimed by another session at the time of filing: take the work claim before editing.',
 'session:reader-yield', 'feature', 'high', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title = 'ROADMAP-1: QNFO.REACH READER-YIELD-1.1: classify automated fetchers as bots in the UTM ledger so outreach clicks mean readers');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.REACH READER-YIELD-1.2: pageviews_30d flaps between 0, 10000, 25000 and the true 19.7k; derive it from the stored daily series',
 'code-task: repo=qnfo-workers path=qnfo-fleet-dashboard/worker.js' || char(10) ||
 'code-anchor: async function refreshRegistryMetrics(env) {' || char(10) ||
 'code-probe: {"paths": ["qnfo-fleet-dashboard/worker.js"], "contains": "PAGEVIEWS-STABLE-1"}' || char(10) || char(10) ||
 'Charter pillar reach and core (program QNFO.REACH). Metric it should move: the Readers screen and metric_registry pageviews_30d read the true 30 day human total (19.7k) at every refresh.' || char(10) ||
 'Evidence: a live bot-filtered RUM read on 2026-11-04 gave 19,660 and 20,500 for 30 days (31 daily rows sum to 19,660), so the value is not capped by the GraphQL row limit. metric_write_audit_log shows pageviews_30d written as 0 (02:00, 08:00, 12:01, 14:01Z), 25000 (14:46Z on 11-03), 26000 (10:01Z) and 10000 (15:00:54Z) between hours of 19.6k to 20.2k; referral_30d flaps 550, 610, 1000 the same way. The refresh stamps last_refreshed on every write, and refreshRegistryMetrics skips for 55 minutes after any write, so a bad value stays about an hour. The sampled count is quantised to multiples of 10, and the account GraphQL budget was depleted ("Rate limiter budget depleted") during this session.' || char(10) ||
 'EDIT: in refreshRegistryMetrics derive pageviews_30d as the sum of the stored daily cf-rum-human page and paper pageviews rows (reach_signals, 30 complete days), written only when at least 28 of 30 days have rows; keep the GraphQL read for the prior window and as a fallback only when the stored series is short; never write a value below half of the previous one without a second read (the guard the human-audience metrics already use); do not touch last_refreshed on a skipped write; name the change PAGEVIEWS-STABLE-1 in a comment. In the same change the Readers card (renderReaders, /api/v3/readers) shows engaged_reader_sessions_7d (engaged sessions from outside the fleet, 44 in the 7 days to 11-03) and outreach_engaged_per_100_clicks_7d from metric_registry beside the referred visits, so the owner sees readers who stayed and not counted clicks or page loads. Find and remove the second writer if one exists: SELECT ts, prev_value, new_value FROM metric_write_audit_log WHERE metric = ''pageviews_30d'' ORDER BY id DESC LIMIT 40.' || char(10) ||
 'Definition of done: merged and verified live by the canonical deploy; no metric_write_audit_log row for pageviews_30d outside 12000..40000 for 48 hours; record before and after in issue_triage.close_evidence. qnfo-fleet-dashboard/worker.js is claimed by another session at the time of filing.',
 'session:reader-yield', 'bug', 'high', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title = 'ROADMAP-1: QNFO.REACH READER-YIELD-1.2: pageviews_30d flaps between 0, 10000, 25000 and the true 19.7k; derive it from the stored daily series');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.REACH READER-YIELD-1.3: give the papers an outsider reached a second post, from v_paper_readers_top',
 'code-task: repo=qnfo-workers path=qnfo-social/worker.js' || char(10) ||
 'code-anchor: async function drainRollup(env, opts) {' || char(10) ||
 'code-probe: {"paths": ["qnfo-social/worker.js"], "contains": "v_paper_readers_top"}' || char(10) || char(10) ||
 'Charter pillar reach (program QNFO.REACH). Metric it should move: engaged_reader_sessions_7d (44 a week baseline) and ext_30d per paper for the amplified papers against matched papers that were not (paper_readership, same slugs a week apart).' || char(10) ||
 'Evidence (READER-YIELD-1): the Bluesky queue is empty, so selecting among new papers changes nothing; the only unspent lever is repeat exposure of papers that an outsider already read. paper_readership lists them: 7 percent of papers (about 35 of 506) have an external-referrer visit in 30 days; v_paper_readers_top ranks them (external-referrer loads first, GA4 sessions capped at 20 only as a tie-break: most GA4 sessions are automation) and marks suspect_automated rows (50 or more sessions, no external referrer: one page had 110 sessions on 11-03). GA4 engaged sessions come from google (28 of 34), x (17 of 19) and referrals (40 of 44), so the second post goes to X and Mastodon, not the Substack and Bluesky roll-ups that produce 0 and 1 engaged sessions.' || char(10) ||
 'EDIT: when drainRollup has spare gate capacity (queue empty), pick at most one paper a day from v_paper_readers_top where suspect_automated = 0 and the paper was not announced in the last 14 days, post it once to the channels that carried an engaged session (X, LinkedIn, Mastodon) with a new first line (LEDE-SOCIAL-1) and the paper utm tags; record the pick in dissemination_tracker (mode amplify) so paper_readership can compare it with matched papers; never exceed the weekly caps and spacing already in the gate, never post a retracted paper.' || char(10) ||
 'Definition of done: merged and verified live; after 14 days compare ext_30d and GA4 sessions of the amplified papers with matched non-amplified papers of the same age (v_reader_yield_by_source and paper_readership), keep the lane only if the amplified papers gained engaged sessions, otherwise replace the lever. Take the work claim on qnfo-social/worker.js before editing.',
 'session:reader-yield', 'feature', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title = 'ROADMAP-1: QNFO.REACH READER-YIELD-1.3: give the papers an outsider reached a second post, from v_paper_readers_top');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.REACH READER-YIELD-1.4: GA4 ingest by campaign and country, so engaged sessions are attributable to papers, posts and origin',
 'code-task: repo=qnfo-workers path=qnfo-fleet-dashboard/worker.js' || char(10) ||
 'code-anchor: async function ga4Ingest(env, opts) {' || char(10) ||
 'code-probe: {"paths": ["qnfo-fleet-dashboard/worker.js"], "contains": "sessionCampaignName"}' || char(10) || char(10) ||
 'Charter pillar reach (program QNFO.REACH). Metric it should move: it moves none by itself; it makes yield per paper and per post measurable. Done when paper_readership can carry ga4_engaged_30d per paper and outreach_engaged_per_100_clicks_7d can be split by channel.' || char(10) ||
 'Evidence (READER-YIELD-1): the GA4 ingest writes sessions and engagedSessions by channel group, source and host, and sessions (not engaged) by page and country, so an engaged session cannot be tied to the paper or post that earned it. The tagged links already carry utm_campaign = paper slug and utm_source = channel, which GA4 exposes as sessionCampaignName and sessionSource. X, LinkedIn and Mastodon have 14, 7 and 14 slots a week for about 60 new papers a week, so which papers take those slots is a real choice there (the Bluesky and Substack roll-ups carry every paper); GA4 shows X at 17 engaged of 19 sessions and Bluesky at 1 of 22, but nothing says which X post earned them. Singapore is 55 percent of GA4 sessions (1002 of 1833) and no stored row says how many of them engage or how many sessions the Netherlands (the owner''s region) contributes to the engaged count.' || char(10) ||
 'EDIT: in ga4Ingest add two runReports for the complete day: dimensions sessionCampaignName and sessionSource with metrics sessions and engagedSessions (limit 1000, rows with an empty or (not set) campaign skipped), written as reach_signals rows source ga4, channel = the source, entity_type campaign, entity_id = the campaign lower-cased to 64 characters (the UTM ledger key); and dimension country with metrics sessions, engagedSessions and activeUsers as entity_type country_engaged (the live /api/ga4/overview has it; reach_signals stores sessions and users but not engaged by country: 28 days to 11-03 the Netherlands is 25 users, 139 sessions and 116 engaged, Singapore 1629 users and 55 engaged), so sessions per user can separate the owner and the fleet from one-time visitors. Keep quality human; do not change any existing row shape; name the change GA4-CAMPAIGN-1 in a comment.' || char(10) ||
 'Definition of done: merged and verified live by the canonical deploy; SELECT COUNT(*) FROM reach_signals WHERE source = ''ga4'' AND entity_type = ''campaign'' AND metric = ''engagedSessions'' is above 0 for the previous day; record the before and after in issue_triage.close_evidence. The file is claimed by another session at the time of filing: take the work claim first. Follow-up once rows exist: add ga4_engaged_30d to paper_readership and rank v_paper_readers_top by it.',
 'session:reader-yield', 'feature', 'high', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title = 'ROADMAP-1: QNFO.REACH READER-YIELD-1.4: GA4 ingest by campaign and country, so engaged sessions are attributable to papers, posts and origin');

INSERT OR IGNORE INTO human_actions (slug, title, why, default_in_effect, action, sev, status, source)
VALUES ('ga4-internal-traffic-1',
  'Define internal traffic in Google Analytics so readers can be told from your own visits',
  'IDENTITY-BOUND: the GA4 property belongs to the owner''s Google account and its Admin settings are not open to any session or loop. Evidence (live /api/ga4/overview, 28 days to 2026-11-03): the Netherlands is 25 users with 139 sessions and 116 engaged of the property''s 307 engaged sessions, 5.6 sessions and 10.5 page views per user, while Singapore is 1629 users with one session each and 55 engaged. The engaged-session count the fleet uses as its reader measure (engaged_reader_sessions_7d) therefore includes your own browsing and the fleet''s own browser checks unless GA4 can tell them apart.',
  'engaged_reader_sessions_7d counts only engaged sessions whose source is outside the fleet (direct, not set and the hosts in ops_config reader_internal_sources are left out), 44 in the 7 days to 2026-11-03. Your own typed visits fall into direct and drop out; your clicks on your own posts still count. The research budget governor stays off.',
  'In GA4 Admin choose Data streams, open the stream, Configure tag settings, Show all, Define internal traffic: add a rule for your IP address or addresses (and the fleet egress range if you know it), then open Data settings, Data filters, and set the Internal Traffic filter from Testing to Active. Nothing else changes; the fleet reads the filtered numbers from the next daily ingest.',
  'normal', 'open', 'session:reader-yield');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'READER-YIELD-1.5: switch research_yield_governor on once research-exec enforces research_daily_neurons',
 'Charter pillar cost and reach (programs QNFO.OPS and QNFO.REACH). Owner of the key: qnfo-ops (ops_config research_policy_harmonized: single writer; other sessions file an issue). Doer: the spend-cap work that makes qnfo-research-exec respect research_daily_neurons, or the ops session.' || char(10) ||
 'Evidence (READER-YIELD-1): research-exec spent 988,203 and 996,539 neurons on 11-02 and 11-03 against research_daily_neurons 360000; fleet_budget cost:fleet_all_in_month 1151 against a cap of 300. v_research_volume_target publishes the budget a reader-linked rule would set (externally sourced engaged readers a day x 64000, floor 180000, ceiling 450000, 10 percent a day, averaged over up to 28 days): about 358k at today''s 5.6 externally sourced engaged readers a day. The migration leaves research_yield_governor off so nothing writes the key until its owner agrees, and the governor needs 28 days of externally sourced rows (from 2026-11-21) and the GA4 internal-traffic rule (owner card ga4-internal-traffic-1) before it is a signal rather than noise plus the owner.' || char(10) ||
 'EDIT (executable configuration): a migration that runs UPDATE ops_config SET value = ''on'' WHERE key = ''research_yield_governor'' and records the decision with its revert path in decision_log; before it, read SELECT * FROM v_research_volume_target and SELECT reason FROM v_research_volume_target (not paused, not outside the band).' || char(10) ||
 'Definition of done: research_yield_governor is on, ops_config research_daily_neurons carries a READER-YIELD-1 governor note, and ai_call_counters shows qnfo-research-exec at or below that value on two consecutive UTC days; record the before and after in issue_triage.close_evidence. Not before 28 days of externally sourced GA4 rows exist (from 2026-11-21), not before the GA4 internal-traffic rule (owner card ga4-internal-traffic-1) is active, and not while research-exec ignores the key (then the switch changes a number nothing reads).',
 'session:reader-yield', 'optimization', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title = 'READER-YIELD-1.5: switch research_yield_governor on once research-exec enforces research_daily_neurons');

INSERT OR IGNORE INTO roadmap_proposals (program_code, request_instance, title, rationale, path, anchor_line, status, issue_id, created_at, updated_at)
SELECT 'QNFO.REACH', 'session-reader-yield-20261104-1', 'Classify automated fetchers as bots in the UTM ledger so outreach clicks mean readers',
  'READER-YIELD-1: counted human clicks 1260 vs 25 engaged organic-social sessions in 10 days; metric outreach_engaged_per_100_clicks_7d.', 'qnfo-gateway/worker.js',
  'code-anchor: var UTM_BOT_RE = /bot|crawler|spider|preview|facebookexternalhit|slackbot|twitterbot|linkedinbot|mastodon|bluesky|cardyb|headless/i;', 'proposed',
  (SELECT MAX(id) FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.REACH READER-YIELD-1.1:%'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now');

INSERT OR IGNORE INTO roadmap_proposals (program_code, request_instance, title, rationale, path, anchor_line, status, issue_id, created_at, updated_at)
SELECT 'QNFO.REACH', 'session-reader-yield-20261104-2', 'pageviews_30d flaps between 0, 10000, 25000 and the true 19.7k; derive it from the stored daily series',
  'READER-YIELD-1: live RUM 30 day human total 19,660..20,500; stored value flaps (metric_write_audit_log).', 'qnfo-fleet-dashboard/worker.js',
  'code-anchor: async function refreshRegistryMetrics(env) {', 'proposed',
  (SELECT MAX(id) FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.REACH READER-YIELD-1.2:%'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now');

INSERT OR IGNORE INTO roadmap_proposals (program_code, request_instance, title, rationale, path, anchor_line, status, issue_id, created_at, updated_at)
SELECT 'QNFO.REACH', 'session-reader-yield-20261104-3', 'Give the papers an outsider reached a second post, from v_paper_readers_top',
  'READER-YIELD-1: the Bluesky queue is empty; repeat exposure of papers with an external-referrer visit is the unspent lever; measured against matched papers.', 'qnfo-social/worker.js',
  'code-anchor: async function drainRollup(env, opts) {', 'proposed',
  (SELECT MAX(id) FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.REACH READER-YIELD-1.3:%'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now');

INSERT OR IGNORE INTO roadmap_proposals (program_code, request_instance, title, rationale, path, anchor_line, status, issue_id, created_at, updated_at)
SELECT 'QNFO.REACH', 'session-reader-yield-20261104-4', 'GA4 ingest by campaign and country, so engaged sessions are attributable to papers, posts and origin',
  'READER-YIELD-1: engaged sessions cannot be tied to the paper or post that earned them; X, LinkedIn and Mastodon have 14, 7 and 14 slots a week for about 60 new papers a week, so slot choice matters there.', 'qnfo-fleet-dashboard/worker.js',
  'code-anchor: async function ga4Ingest(env, opts) {', 'proposed',
  (SELECT MAX(id) FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.REACH READER-YIELD-1.4:%'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now');
