-- PLUS-QUALITY-MEASURE-1 (2026-11-05, charter pillar autonomy and reach; roadmap plussing-2026 PLUS-4 follow-up; docs/PLUSSING.md rule "Ratchet" and failure mode 1).
-- Read before the change (qnfo-audit, 2026-11-05): of the 9 active products only q08-home has product_registry.quality_measure. The PLUS-4 steps keep or revert a plus only through that
-- column: pl-outcome-baseline joins output_quality_measures on r.quality_measure with role outcome, otherwise it writes the check as unmeasured ("not counted as kept"), and
-- pl-outcome-review reads the same measure. So for 8 of 9 products no plus could ever be kept, and the pl-research prompt told the product manager "none yet, so a measurement plus is a good first move".
-- Outcome measures that already exist in output_quality_measures (role outcome, with polarity and tolerance, not proxies) and belong to a product:
--   papers          engaged_reader_sessions_7d   (GA4 engaged sessions from outside the fleet; 44 in 7 days; the reader count the generators cannot satisfy)
--   jobs            jobsearch_reply_rate_90d     (replies to applications 21 to 90 days old; UNMEASURED under 10 mature applications, so a jobs plus stays unmeasured, never a pass)
--   shorts-channel  youtube_avg_view_duration_s  (registered here as the Shorts outcome measure: viewers, from YouTube Analytics; UNMEASURED until the owner grants the analytics scopes, card yt-analytics-consent)
-- fleet-dashboard, research-gateway, ops-executor, companion-today and travel keep NULL: no outcome measure exists for them, and inventing a proxy would dilute the outcome list
-- (OUTPUT-QUALITY-LEDGER-1). For those, "a measurement plus first" stays the prompt's advice.
-- Prediction: from the next plus batch (after 2026-11-06T00:50Z) the pl-research prompts for papers and jobs read "Quality measure: engaged_reader_sessions_7d" and "jobsearch_reply_rate_90d", and a deployed
-- papers plus gets plus_outcome_checks.outcome pending (not unmeasured) when output_quality_outcomes_worse and the measure are both fresh. Stop: Rollback.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_plus_qm
-- Rollback: UPDATE product_registry SET quality_measure = (SELECT b.quality_measure FROM bak_20261105_plus_qm b WHERE b.product = product_registry.product) WHERE product IN (SELECT product FROM bak_20261105_plus_qm); DELETE FROM output_quality_measures WHERE metric = 'youtube_avg_view_duration_s' AND surface = 'shorts';
-- CAUSE-MAPPED: registers no metric_registry row (youtube_avg_view_duration_s exists since YT-6); output_quality_measures is the outcome list.

CREATE TABLE IF NOT EXISTS bak_20261105_plus_qm AS SELECT product, quality_measure FROM product_registry;

UPDATE product_registry SET quality_measure = 'engaged_reader_sessions_7d' WHERE product = 'papers' AND quality_measure IS NULL;
UPDATE product_registry SET quality_measure = 'jobsearch_reply_rate_90d' WHERE product = 'jobs' AND quality_measure IS NULL;
UPDATE product_registry SET quality_measure = 'youtube_avg_view_duration_s' WHERE product = 'shorts-channel' AND quality_measure IS NULL;

INSERT INTO output_quality_measures (metric, surface, role, polarity, tol_rel, tol_abs, judged_by, caveat)
SELECT 'youtube_avg_view_duration_s', 'shorts', 'outcome', 1, 0.15, 2,
  'viewers: YouTube Analytics averageViewDuration per Short, read by qnfo-youtube-shorts (retention read) and averaged over the Shorts that have it',
  'unmeasured until the owner grants youtube.readonly and yt-analytics.readonly (human_actions yt-analytics-consent): unmeasured is not a pass; a handful of Shorts, so small numbers; a Short that is shorter has a lower absolute duration, read it with the Short length'
WHERE NOT EXISTS (SELECT 1 FROM output_quality_measures WHERE metric = 'youtube_avg_view_duration_s');

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session (C3-products)',
  'a plus can only be kept or reverted against a registered outcome measure; a product without one can never be kept, and an existing outcome measure is better than a new proxy',
  'PLUS-QUALITY-MEASURE-1: product_registry.quality_measure set for papers, jobs and shorts-channel from output_quality_measures; Shorts outcome measure registered',
  'product_registry: only q08-home had quality_measure; pl-outcome-baseline writes unmeasured without role outcome; output_quality_measures already lists engaged_reader_sessions_7d and jobsearch_reply_rate_90d as outcome',
  'migration merged', 'which measure the product manager is told about and which measure PLUS-4 judges a plus by, for three products; nothing is written to a product',
  'the Rollback header of migrations/2026-11-05-plus-quality-measures.sql',
  'plusses on papers can be kept or reverted on a reader outcome',
  'pl-research prompts for papers and jobs name their measure from the next batch; a deployed papers plus gets a pending outcome check', 'readers (papers)',
  'node:sqlite replay in migrations/plus-quality-measures.test.mjs; d1:qnfo-audit product_registry and output_quality_measures after apply'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'PLUS-QUALITY-MEASURE-1:%');
