-- PROBE-UA-BOT-1 (2026-11-04, charter pillar reach; READER-YIELD-1 follow-up). Companion to qnfo-social 0.21.15, which makes the fleet's own link probes send a user agent that
-- the gateway classes as a bot. Until then the probes were counted as human clicks in the UTM ledger (reach_signals source utm), so outreach_human_clicks_7d (940 on 2026-11-04) and
-- outreach_clicks_per_post_7d (8.79) were partly the fleet reading its own links. Evidence: 210 tagged Bluesky roll-up paper-posts (10-19..10-31): 178 got no Bluesky-channel click in
-- 72 hours, 27 got exactly 4, and 52 clicks landed the day before the posts existed; only 2 of 100 counted clicks become a GA4 engaged session.
-- WHAT THIS DOES: two measures that count those clicks stop being outcomes. output_quality_measures classes a measure by who can satisfy it; a click the generator's own probe makes is
-- satisfied by the generator, so both become proxies (never a target, never counted toward the verdict) with the caveat below. Without this, the deploy of 0.21.15 would read as a
-- worse promotion outcome (a fall in clicks) and file output_quality_outcomes_worse for a correction. The promotion surface is then honest about having no click outcome until
-- READER-YIELD-1 (social_engaged_sessions_7d) lands; an unmeasured surface is a gap, not a pass.
-- PREDICTION (decision_log, below, parsed by decision_predictions): outreach_human_clicks_7d falls under 600 within 8 days of the qnfo-social deploy (from 940). If it does not, the
-- probes were not the floor: revert 0.21.15 and look for the next source (link-preview fetchers by user agent).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE output_quality_measures SET role = (SELECT b.role FROM bak_20261104_click_measures b WHERE b.metric = output_quality_measures.metric), caveat = (SELECT b.caveat FROM bak_20261104_click_measures b WHERE b.metric = output_quality_measures.metric) WHERE metric IN ('outreach_human_clicks_7d', 'outreach_clicks_per_post_7d') AND EXISTS (SELECT 1 FROM bak_20261104_click_measures b WHERE b.metric = output_quality_measures.metric);
-- Rollback note: the decision row is append-only evidence and stays; reverting qnfo-social is a git revert of 0.21.15.

CREATE TABLE IF NOT EXISTS bak_20261104_click_measures AS
SELECT metric, role, caveat FROM output_quality_measures WHERE metric IN ('outreach_human_clicks_7d', 'outreach_clicks_per_post_7d');

UPDATE output_quality_measures
SET role = 'proxy',
    caveat = 'PROBE-UA-BOT-1 2026-11-04: counts tagged page loads the gateway classes human. The fleet''s own link probes (qnfo-social probeLink and httpStatus, user agents link-probe and link-gate) were counted until qnfo-social 0.21.15, so a fall after that deploy is a correction, not a worse output; only 2 of 100 counted clicks became a GA4 engaged session. Never a target. Readers: engaged_reader_sessions_7d. Was: ' || COALESCE(caveat, '')
WHERE metric IN ('outreach_human_clicks_7d', 'outreach_clicks_per_post_7d') AND role = 'outcome';

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT
  'session:reader-yield (claude, QNFO.REACH)',
  'The click floor on every paper is the fleet probing its own tagged links with a user agent the gateway does not class as a bot.',
  'PROBE-UA-BOT-1: qnfo-social 0.21.15 sends user agents ending in "; bot" from probeLink and httpStatus; outreach_human_clicks_7d and outreach_clicks_per_post_7d become proxies in output_quality_measures.',
  'Of 210 tagged Bluesky roll-up paper-posts (10-19..10-31) 178 got no Bluesky-channel click in 72 hours and 27 got exactly 4; 52 clicks landed the day before the posts existed; utm_clicks_human 1260 vs 25 engaged organic-social GA4 sessions in 10 days; outreach_human_clicks_7d 940 on 11-04.',
  'merged with qnfo-social 0.21.15; measured after the deploy',
  'qnfo-social link probes (user agent only) and two output_quality_measures rows',
  'revert qnfo-social 0.21.15; restore the two measures from bak_20261104_click_measures (Rollback line)',
  'the UTM ledger stops counting the fleet reading its own links as readers',
  'outreach_human_clicks_7d < 600 within 8 d',
  'none: a correction of what is counted; real clicks are unchanged',
  'qnfo-social/probe-ua.test.mjs; migrations/probe-ua-bot-1.test.mjs; the gateway UTM_BOT_RE read from its source'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'PROBE-UA-BOT-1: qnfo-social%');
