-- REACH-FOCUS-1 (2026-11-04, charter pillar reach, program QNFO.REACH). Owner brief 2026-11-04: reach is not working, reach employers, academics and industry leaders, be seen as a pioneer, the right message
-- on the right channel for the right people, a focused net, a channel nobody looks at is the wrong channel. Detail, evidence and the argument against: docs/REACH-PLAYBOOK.md.
-- WHAT WAS MEASURED (GA4 /api/ga4/overview 28 days to 2026-11-03, qnfo-audit v_channel_impact_7d, 2026-11-04):
--  * About 107 social posts a week give 43 engaged organic-social sessions in 28 days. Engaged sessions per channel (10 days): X 17 of 19, LinkedIn 5 of 20, Bluesky 1 of 22, Substack 0 of 110, Mastodon 0 of 9.
--    Organic search 46 engaged of 87 sessions (28 days) is the largest scalable source. Paper pages already carry citation_* tags, ScholarlyArticle JSON-LD, llms.txt and a sitemap: the gap is distribution.
--  * v_channel_impact_7d: bluesky 21 posts 642 counted clicks, substack 38 posts 150, x 14 posts 78, mastodon 10 posts 56, linkedin 6 posts 14, email 18 posts 0. Counted clicks are not readers (READER-YIELD-1).
-- WHAT THIS CHANGES (no worker is edited here, no cron is added):
--  (1) pipeline_flags.social_channel_caps: twitter 14 to 21 (the channel readers act on), mastodon 14 to 7 (0 engaged in 9 sessions). The old value is saved in bak_20261104_reach_focus_caps.
--  (2) reach_audience_matrix: audience, lead channel, message, proof asset, who acts, measure. One row per audience, read by the REACH managers and by the per-channel composer (REACH-FOCUS-1.1).
--  (3) three ROADMAP-1 rows with doers: per-channel messages, Substack to a weekly digest, a weekly human-post pack for the channels that forbid automation.
--  (4) a prediction in decision_log.
-- PREDICTION: engaged_reader_sessions_7d >= 55 within 21 d (baseline 44 externally sourced a week). Falsifier: X engaged sessions back under 8 a week after the cap rise, or no rise in 21 days: revert the caps, treat reach as credibility work.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE pipeline_flags SET value = (SELECT value FROM bak_20261104_reach_focus_caps WHERE key = 'social_channel_caps'), updated_at = datetime('now') WHERE key = 'social_channel_caps' AND EXISTS (SELECT 1 FROM bak_20261104_reach_focus_caps WHERE key = 'social_channel_caps')
-- Rollback note: reach_audience_matrix, the ROADMAP-1 rows and the decision_log rows stay as evidence.
-- CAUSE-MAPPED: registers no metric.
-- spof-review: the caps are read by qnfo-social on every drain, a bad value is clamped 0..21 by channelCaps and an unreadable one falls back to the code default.

CREATE TABLE IF NOT EXISTS bak_20261104_reach_focus_caps AS SELECT key, value, updated_at FROM pipeline_flags WHERE key = 'social_channel_caps';

UPDATE pipeline_flags
SET value = '{"linkedin":7,"mastodon":7,"twitter":21,"substack":14}', updated_at = datetime('now')
WHERE key = 'social_channel_caps'
  AND value = '{"linkedin":7,"mastodon":14,"twitter":14,"substack":14}';

CREATE TABLE IF NOT EXISTS reach_audience_matrix (
  audience TEXT PRIMARY KEY,
  lead_channels TEXT NOT NULL,
  message TEXT NOT NULL,
  proof_asset TEXT NOT NULL,
  actor TEXT NOT NULL,
  cadence TEXT NOT NULL,
  measure TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'active',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO reach_audience_matrix (audience, lead_channels, message, proof_asset, actor, cadence, measure) VALUES
 ('academics-quantum-math', 'search, x, mastodon (scholar.social)', 'The claim in one sentence, the check a reader can run, the limits. No hype words.', 'paper page with citation tags, Zenodo DOI, research-code companion', 'fleet', 'X up to 21 a week, Mastodon 7', 'external engaged sessions on /papers/*, citation_stats'),
 ('ai-ml-safety-researchers', 'lesswrong, hacker news, x', 'A falsifiable finding. Lead story: the reproduction that found the Agentic Collapse trajectory does not follow from its equations.', 'agentic-collapse and ignorance-audit libraries', 'owner posts by hand, fleet drafts the pack', 'one pack a week', 'external referrer loads, engaged sessions from news.ycombinator.com and lesswrong.com'),
 ('employers-industry-leaders', 'linkedin, qnfo.org/work-with-me', 'Applied capability: an autonomous research and operations system on Cloudflare that reports its own failures and costs. One case study a month, first person.', 'the fleet itself, live dashboards, code', 'fleet drafts, Buffer posts', '3 a week', 'engaged sessions from linkedin, visits to /work-with-me, inbound contacts'),
 ('developers-formal-methods', 'github topics, show hn, lean zulip', 'Something that runs: lake build passes, tests pass, install works.', 'ultrametric-lean and the research-code libraries', 'owner posts by hand', 'on release', 'github referrals, stars, downloads'),
 ('question-askers', 'search', 'Page title and first paragraph answer the question in plain words.', 'existing paper pages', 'fleet', 'continuous', 'organic search engaged sessions'),
 ('subscribers', 'substack, email', 'A weekly digest of three papers instead of one note per paper.', 'digest', 'fleet', 'weekly', 'engaged sessions from substack and email, subscriber growth');

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT
  'session:reach-focus (claude, QNFO.REACH)',
  'Readers act on a few channels (X, search, LinkedIn) and ignore volume on the rest, so concentrating the automated posting where readers act and sending one audience-specific message per channel beats more of the same.',
  'REACH-FOCUS-1 migration 2026-11-04-reach-focus-1.sql: social_channel_caps twitter 14 to 21 and mastodon 14 to 7, the audience matrix, three ROADMAP-1 rows (per-channel messages, Substack weekly digest, weekly human-post pack). Prediction: externally sourced engaged sessions rise from 44 a week to 55 or more within 21 days. Falsifier: X engaged sessions back under 8 a week, or no rise in 21 days, then revert the caps.',
  'GA4 engaged sessions per channel over 10 days: x 17 of 19, linkedin 5 of 20, bluesky 1 of 22, substack 0 of 110, mastodon 0 of 9. Organic search 46 of 87 over 28 days. v_channel_impact_7d: about 107 posts a week. #TweetTheJournal (PMC10899730): no significant citation effect from social promotion, so credibility assets stay step one.',
  'applied by migration, qnfo-social reads the new caps at its next drain',
  'one pipeline_flags value, one new table, three issue rows, no worker code change',
  'pipeline_flags social_channel_caps restored from bak_20261104_reach_focus_caps (migration Rollback line)',
  'an audience-by-channel plan the managers and the composer can read, instead of one message everywhere',
  'engaged_reader_sessions_7d >= 55 within 21 d',
  'expected: more engaged readers from X and LinkedIn, fewer wasted posts on Substack and Mastodon. Small samples: x is 19 sessions.',
  'live GA4 overview and qnfo-audit reads on 2026-11-04'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'REACH-FOCUS-1 migration%');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.REACH REACH-FOCUS-1.1: one message per channel, X hook, Mastodon scholar tags, LinkedIn first-person note',
 'code-task: repo=qnfo-workers path=qnfo-social/worker.js' || char(10) ||
 'code-anchor: function composePrompt(doi, title, abstract) {' || char(10) ||
 'code-probe: {"paths": ["qnfo-social/worker.js"], "contains": "REACH-FOCUS-1.1"}' || char(10) || char(10) ||
 'Charter pillar reach (program QNFO.REACH). Metric it should move: engaged_reader_sessions_7d (44 a week on 2026-11-03, prediction 55 or more by 2026-11-25) and social_engaged_sessions_7d. See docs/REACH-PLAYBOOK.md sections 3 and 4.' || char(10) ||
 'Evidence: composePrompt writes one five-post Bluesky thread and every channel carries a fit of it. GA4 engaged sessions by channel over 10 days: x 17 of 19, linkedin 5 of 20, bluesky 1 of 22, substack 0 of 110, mastodon 0 of 9.' || char(10) ||
 'EDIT: add a channel argument to the composer with three variants. X: one hook post of at most 280 characters with the paper link and the check a reader can run. Mastodon: two posts, field hashtags in the abstract''s terms. LinkedIn: a first-person practitioner note of 600 to 1200 characters for a hiring or commissioning reader, naming what the work lets a team do. Keep every grounding gate (threadGroundingIssues, checkThread) and the no-hype rules unchanged and mark the change with the text REACH-FOCUS-1.1 in a comment.' || char(10) ||
 'Definition of done: merged and verified live, social_channel_caps unchanged, X engaged sessions per week measured for 14 days after deploy and recorded in issue_triage.close_evidence.',
 'session:reach-focus', 'feature', 'high', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.REACH REACH-FOCUS-1.1%');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.REACH REACH-FOCUS-1.2: Substack Notes to one weekly digest of three papers instead of 38 notes a week',
 'code-task: repo=qnfo-workers path=qnfo-social/worker.js' || char(10) ||
 'code-anchor: async function drainRollup(env, opts) {' || char(10) ||
 'code-probe: {"paths": ["qnfo-social/worker.js"], "contains": "REACH-FOCUS-1.2"}' || char(10) || char(10) ||
 'Charter pillar reach (program QNFO.REACH). Metric it should move: social_engaged_sessions_7d without a fall in engaged_reader_sessions_7d, and posts a week on Substack from 38 to 1 digest.' || char(10) ||
 'Evidence: Substack Notes 38 posts a week, 110 GA4 sessions, 0 engaged (10 days to 2026-11-03). Roll-ups carry every paper (PAPER-ROLLUP-1), so no paper is dropped: this changes the carrier from hourly notes to one weekly digest of the three papers with the most outsider reads (v_paper_readers_top), with the rest linked from the papers index.' || char(10) ||
 'EDIT: when the channel is substack, drainRollup posts at most once per 7 days and selects three papers by outsider reads. Mark the change with REACH-FOCUS-1.2. Do not remove the other roll-up channels.' || char(10) ||
 'Definition of done: merged and verified live, Substack posts a week at most 2, review on 2026-12-02 with engaged sessions per channel in issue_triage.close_evidence.',
 'session:reach-focus', 'feature', 'high', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.REACH REACH-FOCUS-1.2%');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.REACH REACH-FOCUS-1.3: weekly human-post pack for Hacker News, LessWrong and scholar.social, one owner card a week',
 'code-task: repo=qnfo-workers path=qnfo-social/worker.js' || char(10) ||
 'code-anchor: function reachEligible(title, abstract, doi) {' || char(10) ||
 'code-probe: {"paths": ["qnfo-social/worker.js"], "contains": "REACH-FOCUS-1.3"}' || char(10) || char(10) ||
 'Charter pillar reach (program QNFO.REACH). Metric it should move: engaged_reader_sessions_7d, external referrer loads from news.ycombinator.com and lesswrong.com. See docs/REACH-PLAYBOOK.md section 4 step 4.' || char(10) ||
 'Evidence: the venues with the biggest single-day audiences for technical research forbid or punish automated posting, so the fleet cannot post there and nobody drafts for them. The most credible story the fleet owns is the Agentic Collapse reproduction (docs/CODE-REACH-PROGRAM.md 3.1).' || char(10) ||
 'EDIT: add a weekly step that picks the paper with the most outsider reads in v_paper_readers_top (excluding suspect_automated rows), drafts a Hacker News title of at most 80 characters, a LessWrong post summary and a scholar.social post using only the title and abstract (the grounding gates apply), and writes them as one human_actions card with an IDENTITY-BOUND line: posting on a channel whose terms forbid automation. A probe closes the card when the referrer appears or after 7 days. Mark the change with REACH-FOCUS-1.3.' || char(10) ||
 'Definition of done: merged and verified live, one card in human_actions, referrer loads measured 14 days after the first pack and recorded in issue_triage.close_evidence.',
 'session:reach-focus', 'feature', 'high', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.REACH REACH-FOCUS-1.3%');
