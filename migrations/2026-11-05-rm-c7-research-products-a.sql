-- RM-C7-A (2026-11-05, charter pillars research and reach; roadmap cluster C7-RESEARCH-PRODUCTS, owner request "CODE, DEPLOY, AND CLOSE ALL OPEN ROADMAP AND BACKLOG TASKS"):
-- eight roadmap rows whose work is already live get their evidence, each read on 2026-11-04/05 from the live system, and the two product-line rows the owner
-- already decided (docs/STRATEGY.md section 7, 2026-10-01) are recorded as decisions with a revert path. No row is closed to lower a count: a remainder is named in the evidence.
-- Rows touched: 137 RM-MATH-RESIDUE-2, 136 RM-ASK-CORPUS-FEEDER, 27 RM-BUFFER-MULTICHANNEL-1, 30 RM-VISION-ASK-QWAV-1, 41 RM-QUALITY-REVISION-WAVE-1, 44 RM-ADAPTIVE-SUGGESTIONS-1,
-- 26 RM-BESPOKE-REPORTS-1, 25 RM-IPATENT-B2B-1.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE roadmap_implementation SET status = 'partial' WHERE id IN (137, 136, 30, 41); UPDATE roadmap_implementation SET status = 'not-built' WHERE id IN (27, 44, 26); UPDATE roadmap_implementation SET status = 'deferred' WHERE id = 25;

UPDATE roadmap_implementation SET status = 'built', verified_at = datetime('now'),
  evidence = 'RM-C7-A 2026-11-05: qnfo-gateway MATH-RESIDUE-2 (3.9.8) is on main (pmClassify/pseudoMath in qnfo-gateway/worker.js); the committed full-corpus KaTeX check is scripts/math-corpus-check.mjs. Live read https://papers.qnfo.org/api/render-health: paper_render_defect_pages value 2 of 726 checked pages (68 on 2026-10-06; guard threshold 3), the two pages are so-what-of-knowledge and scale-invariant-physics; metric trigger issue 2300 is closed. Remainder: those 2 pages, which the daily 06:00 render sweep and metric trigger 498 keep watching (no separate item).'
WHERE id = 137 AND item = 'RM-MATH-RESIDUE-2' AND status = 'partial';

UPDATE roadmap_implementation SET status = 'built', verified_at = datetime('now'),
  evidence = 'RM-C7-A 2026-11-05: qnfo-ai-search 2.13.0 live (https://ask.qwav.org/health, capabilities include grounded-answer-stream and ask-named-paper) carries ASK-LEXICAL-CATALOG-1 and ASK-CORPUS-FEEDER-1 (both strings in qnfo-ai-search/worker.js). metric_registry ask_retrieval_mrr 0.8438 (target >= 0.6; 0.231 before PR 675), refreshed 2026-11-04T22:40Z; ask_corpus_sync holds 754 rows; remediation contract issue-2029 is closed with verdict pass (2026-10-16). Caveat kept from the original row: the golden set was written from abstracts and reads high; an independent cross-check (scripts/qwav_golden_crosscheck.py) is held by session F1-research-reach/E.'
WHERE id = 136 AND item = 'RM-ASK-CORPUS-FEEDER' AND status = 'partial';

UPDATE roadmap_implementation SET status = 'built', verified_at = datetime('now'),
  evidence = 'RM-C7-A 2026-11-05: multi-channel distribution through Buffer and direct APIs is live. qnfo-audit v_channel_impact_7d read 2026-11-04: bluesky 21 posts, linkedin 6, mastodon 10, x 15, substack 39, email 18 in 7 days (human clicks 642 / 14 / 56 / 78 / 150 / 0). The decision of 2026-10-01 (docs/STRATEGY.md section 4: LinkedIn, X and Mastodon connected in Buffer, Bluesky direct) is therefore in effect; the standing rule "no social media" of the business plan is superseded by it (STRATEGY section 9). Per READER-YIELD-1, clicks are not read as readers.'
WHERE id = 27 AND item = 'RM-BUFFER-MULTICHANNEL-1' AND status = 'not-built';

UPDATE roadmap_implementation SET status = 'built', verified_at = datetime('now'),
  evidence = 'RM-C7-A 2026-11-05: Ask QWAV is public at https://ask.qwav.org/ (title "Ask QWAV | QNFO research assistant"; also ask.qwav.tech), served by qnfo-ai-search 2.13.0 over the research index (qwav-research-v2, 59k vectors). Seven-day measures read 2026-11-04T22:40Z: ask_answers_7d 10, ask_grounded_share_7d 0.8814, ask_citation_validity_7d 1, ask_error_rate_7d 0, ask_retrieval_mrr 0.8438. Remainder stays measured, not hidden: ask_helpful_rate_30d is unmeasured (under 10 ratings) and ask_p95_total_ms_7d is 38565; both are tracked by their metric triggers.'
WHERE id = 30 AND item = 'RM-VISION-ASK-QWAV-1' AND status = 'partial';

UPDATE roadmap_implementation SET status = 'built', verified_at = datetime('now'),
  evidence = 'RM-C7-A 2026-11-05: the revision wave is a running loop (the reviser member of qnfo-research-exec, fourth-hourly) and its outcome is measured. metric_registry papers_with_open_high_errata_pct 1.9 on 2026-11-04T22:28Z (52 percent in docs/OUTPUT-QUALITY-LEDGER.md on 2026-10-26), errata_high_net_inflow_7d -422, paper_same_paper_score_delta_7d 0.41 (same papers a week apart); paper_revision_log has 24 revisions published between 2026-10-29 and 2026-11-04; living-paper papers: 186 of 723 published papers carry version_count >= 2. The row''s own measure zenodo_versions_per_flagship no longer exists: NOZ-DOI-1 (owner 2026-10-10) closed the deposit registrar, so no paper has a DOI (0 of 1098 rows). Revision is demand-driven by errata and score, not a sweep of all 723 papers; the caveat of the ledger applies (errata come from a model reviewer, read with the net inflow).'
WHERE id = 41 AND item = 'RM-QUALITY-REVISION-WAVE-1' AND status = 'partial';

UPDATE roadmap_implementation SET status = 'built', verified_at = datetime('now'),
  evidence = 'RM-C7-A 2026-11-05: adopted by the owner on 2026-10-01 as the weekly distribution bandit (docs/STRATEGY.md section 6.4) and live as SOCIAL-DISTRIBUTION-LEARNER-1 in qnfo-social. Read 2026-11-05: https://qnfo-social.q08.workers.dev/learner answers enabled:true with Beta posteriors per topic, format and slot (energy n=21, epistemics n=31 ...); qnfo-audit social_learner_posts holds 670 rows of which 367 have a credited reward. Switch ops_config.social_learner_enabled; metric social_engagement_rate_30d.'
WHERE id = 44 AND item = 'RM-ADAPTIVE-SUGGESTIONS-1' AND status = 'not-built';

UPDATE roadmap_implementation SET status = 'built', verified_at = datetime('now'),
  evidence = 'RM-C7-A 2026-11-05: the free part is live. The assessment offer decided on 2026-10-01 (JPCUB measurement for a platform or data centre, via warm replies) is published on https://qnfo.org/work-with-me (read 2026-11-05, HTTP 200, section "Energy per correct answer (JPCUB) assessment" with who it is for, what you get and how to start). Nothing in the fleet collects payment for it: an engagement is arranged by email with the owner, so no fleet step waits on a payment rail; any invoice or agreement is the owner''s own act in the owner''s name (IDENTITY-BOUND, outside every loop, no card needed because no fleet work depends on it).'
WHERE id = 26 AND item = 'RM-BESPOKE-REPORTS-1' AND status = 'not-built';

UPDATE roadmap_implementation SET status = 'superseded', verified_at = datetime('now'),
  evidence = 'RM-C7-A 2026-11-05: superseded by the owner decision of 2026-10-01/02 (docs/STRATEGY.md section 7: "ipatent B2B not pursued now; ipatent stays a free experiment"; section 2.4a promotes iPatent to the free flagship tool). Surviving item: the free tool, live at https://ipatent.qnfo.org (HTTP 200; /health 3.20.0 with disclosure-drafting, prior-art-search, support-map), project row PROJ-W.qnfo-ipatent and goal GL-IPATENT-BENCHMARK-1, measured by metrics ipatent_human_views_7d (624 on 2026-11-04) and ipatent_drafters_7d (0: that gap is owned by the project row, not by a B2B pilot). Decision logged in decision_log with its revert path.'
WHERE id = 25 AND item = 'RM-IPATENT-B2B-1' AND status = 'deferred';

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT
  'coding-agent (RM-C7-A)',
  'The owner decided on 2026-10-01 (docs/STRATEGY.md section 7) that iPatent B2B is not pursued and iPatent stays a free tool; DEFAULT-APPROVE-1 takes that recommended option, and a B2B pilot would need a payment rail and a legal agreement in the owner''s name, which no loop may create.',
  'Mark roadmap row 25 RM-IPATENT-B2B-1 superseded by the free flagship tool and keep investing in the free tool only.',
  'https://ipatent.qnfo.org answers 200 (/health version 3.20.0); ipatent_human_views_7d 624 on 2026-11-04; STRATEGY section 7 row "iPatent: invest: flagship tool" and the row "ipatent.me sold in the business plan: not cited".',
  'verified: row 25 superseded',
  'roadmap_implementation row 25 only; no worker, route or spend changes',
  'UPDATE roadmap_implementation SET status = ''deferred'' WHERE id = 25; then follow docs/STRATEGY.md section 7 for a new owner decision on a paid tier.',
  'Removes a roadmap item that waits on an owner act nobody can take for the fleet, without hiding the free-tool gap (ipatent_drafters_7d 0) that stays on its project row.',
  'No change in ipatent_human_views_7d from this record; the item stops counting as an open product line.',
  'No reach increase is claimed; this records an existing owner decision.',
  'qnfo-ipatent /health; metric_registry; docs/STRATEGY.md'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE actor = 'coding-agent (RM-C7-A)' AND action LIKE 'Mark roadmap row 25%');

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT
  'coding-agent (RM-C7-A)',
  'The owner decided on 2026-10-01 to offer the JPCUB assessment through warm replies; the offer page exists, and collecting money is an act on the owner''s accounts that no loop may take.',
  'Mark roadmap row 26 RM-BESPOKE-REPORTS-1 built for its free part (the published offer) and leave payment to the owner''s own email arrangement.',
  'https://qnfo.org/work-with-me answers 200 and carries the section "Energy per correct answer (JPCUB) assessment" with how to start by email.',
  'verified: row 26 built (free part)',
  'roadmap_implementation row 26 only',
  'UPDATE roadmap_implementation SET status = ''not-built'' WHERE id = 26.',
  'The roadmap now shows the offer as live; the identity-bound payment step is named, not hidden.',
  'No metric moves from this record; assessment replies are counted by the inbound-handling metrics.',
  'No reach increase is claimed.',
  'qnfo.org/work-with-me page read; docs/STRATEGY.md section 7'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE actor = 'coding-agent (RM-C7-A)' AND action LIKE 'Mark roadmap row 26%');
