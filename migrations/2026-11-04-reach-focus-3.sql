-- REACH-FOCUS-3 (2026-11-04, charter pillar reach, program QNFO.REACH, with qnfo-jobsearch). Owner brief 2026-11-04: per-channel profiles and messaging, be irresistible to recruiters and top-tier employers
-- for AI, systems and research, correct the weaknesses and blind spots, the owner is a thinker not a pitchman. Detail and evidence: docs/CAREER-VISIBILITY.md.
-- WHAT WAS FOUND (2026-11-04): the About page claims about 400 requests a day on paper pages while READER-YIELD-1 measured about 6 engaged outside readers a day, the claim ledger says 44+ live workers and 39 are
-- live, the bluesky and mastodon bios lead with energy per correct answer rather than the owner pitch, and no profile states the through-line (evidence trustworthy enough to act on).
-- WHAT THIS ADDS: (1) reach_channel_profiles, the draft profile text per channel with its character limit (status draft: every line is a first-person claim and needs the owner), (2) three ROADMAP-1 rows with doers:
-- 1.5 About page readership claim and worker count, 1.6 profile sync bio text, 1.7 weekly target dossier for one-to-one messages. No worker is edited here: qnfo-gateway, qnfo-social and qnfo-jobsearch are claimed.
-- PREDICTION (decision_log): at least 2 substantive replies from organisations in docs/CAREER-VISIBILITY.md section 5 within 28 days of the profiles being posted and item 1.4 deployed. Falsifier: none, then the limit is visibility to those people.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE reach_channel_profiles SET status = 'withdrawn', updated_at = datetime('now') WHERE status = 'draft'
-- Rollback note: the table, the ROADMAP-1 rows and the decision_log row stay as evidence.
-- CAUSE-MAPPED: registers no metric.
-- spof-review: a table of draft text read by the owner and by planners, nothing posts from it.

CREATE TABLE IF NOT EXISTS reach_channel_profiles (
  channel TEXT NOT NULL,
  field TEXT NOT NULL,
  text TEXT NOT NULL,
  max_chars INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (channel, field)
);

INSERT OR IGNORE INTO reach_channel_profiles (channel, field, text, max_chars) VALUES
 ('linkedin', 'headline', 'Builds AI research systems that find what is unknown, check themselves and keep running | Research program lead (FHWA, AARP) | Founder, QNFO', 220),
 ('github', 'bio', 'Builds AI research systems that find what is unknown and maintain themselves. Ex-FHWA, AARP. Amsterdam. qnfo.org', 160),
 ('x', 'bio', 'Builds AI systems that research, ask what is unknown and maintain themselves. Ex-FHWA, AARP. Amsterdam. Open work: qnfo.org', 160),
 ('bluesky', 'bio', 'I build AI systems that research, ask what is unknown and maintain themselves. Ex-FHWA and AARP. Some posts are drafted by my research pipeline. Open work and failures: qnfo.org', 256),
 ('mastodon', 'bio', 'I build AI systems that research, ask what is unknown and maintain themselves (QNFO). Before that: national research programs at FHWA and AARP. Interested in AI evaluation, research integrity and epistemics. Some posts are drafted by my research pipeline and labelled. #AI #metascience #research', 500);

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT
  'session:reach-employers (claude, QNFO.REACH)',
  'Employers and recruiters judge in seconds. A through-line (evidence trustworthy enough to act on), five selected works, claims that match the fleet own measurements and one named outside voice raise the odds of being taken seriously. A profile alone does not get anyone looked at, so one-to-one messages and outside validation carry the plan.',
  'REACH-FOCUS-3 migration 2026-11-04-reach-focus-3.sql and docs/CAREER-VISIBILITY.md: ranked weaknesses and blind spots, per-channel draft profiles in reach_channel_profiles, employer classes, a five hour a week plan, three ROADMAP-1 rows (About page truthfulness, profile sync text, weekly target dossier). Prediction: at least 2 substantive replies from listed organisations within 28 days of the profiles being posted and item 1.4 deployed.',
  'qnfo.org/about says about 400 requests a day, READER-YIELD-1 measured 44 engaged outside readers a week. jobsearch/facts.json says 44+ live workers, fleet worker_count is 39. Bluesky and Mastodon bio text leads with energy per correct answer. 262 papers in 30 days, 728 in the corpus, labelled not independently peer-reviewed.',
  'applied by migration, nothing is posted by the fleet',
  'one new table of draft text and three issue rows, no worker code change',
  'reach_channel_profiles rows set to withdrawn (migration Rollback line)',
  'one source for per-channel profile text and a ranked list of credibility defects with doers',
  'jobsearch_reply_rate_90d >= 0.1 within 28 d',
  'expected: more replies from organisations that read the work, once the front door matches the evidence. Unproven: hiring at the top tier depends on networks and track record.',
  'public pages qnfo.org/about and /work-with-me, jobsearch/facts.json, GA4 overview, READER-YIELD-1 ledger on 2026-11-04'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'REACH-FOCUS-3 migration%');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.REACH REACH-FOCUS-1.5: qnfo.org/about claims about 400 requests a day, replace it with the measured engaged-reader figure and its caveat',
 'code-task: repo=qnfo-workers path=qnfo-gateway/worker.js' || char(10) ||
 'code-anchor: Readership on paper pages' || char(10) ||
 'code-probe: {"url": "https://qnfo.org/about", "status": 200, "absent": "about 400 requests a day"}' || char(10) || char(10) ||
 'Charter pillar reach (program QNFO.REACH). Metric it should move: none directly, it removes a credibility defect an employer or researcher can check. See docs/CAREER-VISIBILITY.md section 2 item 2.' || char(10) ||
 'Evidence: the About page record table says Readership on paper pages about 400 requests a day (2026-09-03). READER-YIELD-1 (docs/READER-YIELD.md) measured 44 engaged sessions a week from outside the fleet, 122 from all sources, with automated visits as a floor on every paper. The page overstates readership.' || char(10) ||
 'EDIT: replace the readership row with engaged readers from outside the fleet in the last 7 days and the count method in one sentence, read from the reader_yield_daily ledger or the GA4 overview route, never a hand-typed number, and drop the sentence about scanner noise. Also change any hand-typed worker count on the page to dozens of workers or a live count. Mark the change with REACH-FOCUS-1.5. qnfo-gateway/worker.js was claimed by session-yt-distribution until 2026-11-04T23:03Z: take the work claim before editing and bump VERSION with scripts/worker_release.py.' || char(10) ||
 'Definition of done: merged and verified live (curl https://qnfo.org/about no longer contains about 400 requests a day and shows the engaged-reader figure), recorded in issue_triage.close_evidence.',
 'session:reach-employers', 'feature', 'high', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.REACH REACH-FOCUS-1.5%');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.REACH REACH-FOCUS-1.6: Bluesky and Mastodon bios lead with the owner pitch instead of energy per correct answer',
 'code-task: repo=qnfo-workers path=qnfo-social/worker.js' || char(10) ||
 'code-anchor: var PROFILE_DESCRIPTION = "I build open, auditable AI-assisted research (QNFO).' || char(10) ||
 'code-probe: {"paths": ["qnfo-social/worker.js"], "contains": "REACH-FOCUS-1.6"}' || char(10) || char(10) ||
 'Charter pillar reach (program QNFO.REACH). Metric it should move: engaged_reader_sessions_7d from social profile visits, employer and recruiter replies. See docs/CAREER-VISIBILITY.md section 3 and table reach_channel_profiles.' || char(10) ||
 'Evidence: PROFILE_DESCRIPTION reads I build open, auditable AI-assisted research (QNFO). Asking what a correct computation costs in energy. The owner pitch of 2026-11-04 is AI systems that research, ask what is unknown and maintain themselves.' || char(10) ||
 'EDIT: set PROFILE_DESCRIPTION to the bluesky row of reach_channel_profiles (177 characters) and add the old text to PROFILE_SUPERSEDED_PREFIXES so PROFILE-SYNC-OWNER-WINS-1 may replace it, and set the Mastodon profile text from the mastodon row. A bio the owner edited by hand later is still left alone. Only apply rows whose status is approved: the owner sets reach_channel_profiles.status to approved. Mark the change with REACH-FOCUS-1.6. Take the work claim on qnfo-social/worker.js first.' || char(10) ||
 'Definition of done: merged and verified live (the public Bluesky profile description equals the approved row), recorded in issue_triage.close_evidence.',
 'session:reach-employers', 'feature', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.REACH REACH-FOCUS-1.6%');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.REACH REACH-FOCUS-1.7: weekly dossier of five named people and organisations for one-to-one messages the owner sends',
 'code-task: repo=qnfo-workers path=qnfo-jobsearch/worker.js' || char(10) ||
 'code-anchor: async function ensure(env) {' || char(10) ||
 'code-probe: {"paths": ["qnfo-jobsearch/worker.js"], "contains": "REACH-FOCUS-1.7"}' || char(10) || char(10) ||
 'Charter pillar reach (program QNFO.REACH, pillar personal for qnfo-jobsearch). Metric it should move: employer and recruiter replies (qnfo-jobsearch /api/outcomes reply rate). See docs/CAREER-VISIBILITY.md section 6 step 3.' || char(10) ||
 'Evidence: the most reliable route to senior roles is a one-to-one message to someone doing the work, citing a specific thing they made. No tool prepares that, and mass outreach breaks the consent rules. The ledger jobsearch/facts.json holds the only claims such a message may make.' || char(10) ||
 'EDIT: a weekly step that picks five people or organisations from the employer classes in docs/CAREER-VISIBILITY.md section 5 who published something in the last 30 days related to a ledger cluster (ai_systems, research_integrity, research_mgmt), reads that work in full, and writes for each one a dossier card: who, the specific work, one useful thing the owner found that relates (sentence copied from the ledger or a QNFO paper), a draft message of at most 90 words, and the link a stranger can check. Cards go to the owner in the jobsearch UI. The fleet never sends. Nothing is invented: a person with no public work to cite is skipped. Mark the change with REACH-FOCUS-1.7. Take the work claim on qnfo-jobsearch/worker.js first.' || char(10) ||
 'Definition of done: merged and verified live (five cards a week in the jobsearch UI, each citing a work that exists), reply rate to the owner sent messages recorded after 28 days in issue_triage.close_evidence.',
 'session:reach-employers', 'feature', 'high', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.REACH REACH-FOCUS-1.7%');
