-- C8-GOVERNANCE-PROPOSALS-1 (2026-11-05, charter pillar autonomy, program QNFO.OPS; cluster C8-PROJECTS-GOALS of the roadmap and backlog completion sweep).
-- Six adopted goals of type objective-revision (owner 'human-ratify') are open GL- roadmap rows of artifact type governance. Each was read against the objectives table on 2026-11-05 01:30Z:
--   resolved (the proposal is already in force; the live objective or metric shows it)
--     vrev-external-impact-term-20260926  objectives id 2 (objective-function v3, ratified_by owner (fleet.qnfo.org) on 2026-10-01) carries 0.10*external_impact, text "RATIFIED 2026-09-26 by owner directive (adds the
--                                         external-impact term absent from v1; autonomy funded 0.30 -> 0.20; sum stays 1.00)"
--     vrev-gmw8u0d2y                      objectives id 2 v3 weights read autonomy 0.15 and self_improv 0.20, the exact change proposed (autonomy 0.20 -> 0.15, self_improv 0.15 -> 0.20)
--     vrev-g15hdh4s30                     metric energy_efficiency exists with target ">= 0.8 (compute proxy; owner-ratified goals.id=43)" and reads 0.9617, refreshed 2026-11-05T01:05Z
--   superseded
--     gjyfc7j56                           its product, the limits review report, exists as the proposal lrev-return-on-spend-v3-17f8ssu (OBJECTIVE-LIMITS-REVIEW-1, owner-ratified goals.id=41)
--     vrev-g16eyz4j2k                     the cost side of the objective is carried by objectives id 329 cost-ceiling (ACTIVE v2, names the unmanaged direct-provider cost), id 330 return-on-spend (ACTIVE v3, ratified
--                                         2026-10-01 under the owner delegation to manage the fleet and its ROI) and the "cost ceilings (A9)" constraint inside objective-function v3; a separate 50 percent share constraint was not adopted in 39 days
--   open, left for its decision (not touched): lrev-return-on-spend-v3-17f8ssu. Its premise is 80 percent met: of the five terms it names, indexed_surface (733), pageviews_30d (21650), referral_30d (620) and
--     external_impact_per_dollar (0.0237) are observed and carry thresholds in metric_registry (read 2026-11-05), while zenodo_views_total has no metric and its source, the deposit registrar, is closed (NO-REGISTRAR-1,
--     #3493). The remaining decision (drop that term from the grade) is a change to the scorer of a denied worker and to a ratified objective, so it stays open on its own row with this evidence.
-- Nothing in `objectives` changes. Revert one row: UPDATE goals SET status = 'adopted', retired_at = NULL WHERE goal_key = '<key>'. decision_log row below.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE goals SET status = (SELECT b.status FROM bak_20261105_c8_gov b WHERE b.goal_key = goals.goal_key), retired_at = (SELECT b.retired_at FROM bak_20261105_c8_gov b WHERE b.goal_key = goals.goal_key), completed_at = (SELECT b.completed_at FROM bak_20261105_c8_gov b WHERE b.goal_key = goals.goal_key), alignment = (SELECT b.alignment FROM bak_20261105_c8_gov b WHERE b.goal_key = goals.goal_key), updated_at = datetime('now') WHERE goal_key IN (SELECT goal_key FROM bak_20261105_c8_gov)
-- CAUSE-MAPPED: no metric is registered here.

CREATE TABLE IF NOT EXISTS bak_20261105_c8_gov AS SELECT * FROM goals WHERE goal_key IN ('vrev-external-impact-term-20260926', 'vrev-gmw8u0d2y', 'vrev-g15hdh4s30', 'gjyfc7j56', 'vrev-g16eyz4j2k');

INSERT INTO goal_lifecycle (goal_key, from_status, to_status, action, evidence)
SELECT goal_key, 'adopted', 'resolved', 'c8-already-in-force', 'objectives id 2 objective-function v3 (ratified_by owner (fleet.qnfo.org), 2026-10-01) already carries the external_impact term 0.10 funded from autonomy (ratified 2026-09-26 by owner directive); C8-GOVERNANCE-PROPOSALS-1'
FROM goals WHERE status = 'adopted' AND goal_key = 'vrev-external-impact-term-20260926';
INSERT INTO goal_lifecycle (goal_key, from_status, to_status, action, evidence)
SELECT goal_key, 'adopted', 'resolved', 'c8-already-in-force', 'objectives id 2 objective-function v3 weights read autonomy 0.15 and self_improv 0.20, the change proposed; C8-GOVERNANCE-PROPOSALS-1'
FROM goals WHERE status = 'adopted' AND goal_key = 'vrev-gmw8u0d2y';
INSERT INTO goal_lifecycle (goal_key, from_status, to_status, action, evidence)
SELECT goal_key, 'adopted', 'resolved', 'c8-already-in-force', 'metric energy_efficiency exists with target >= 0.8 (owner-ratified goals.id=43) and reads 0.9617 refreshed 2026-11-05T01:05Z; C8-GOVERNANCE-PROPOSALS-1'
FROM goals WHERE status = 'adopted' AND goal_key = 'vrev-g15hdh4s30';
INSERT INTO goal_lifecycle (goal_key, from_status, to_status, action, evidence)
SELECT goal_key, 'adopted', 'superseded', 'c8-superseded', 'superseded by proposal lrev-return-on-spend-v3-17f8ssu (OBJECTIVE-LIMITS-REVIEW-1, owner-ratified goals.id=41), the report this goal asks for; C8-GOVERNANCE-PROPOSALS-1'
FROM goals WHERE status = 'adopted' AND goal_key = 'gjyfc7j56';
INSERT INTO goal_lifecycle (goal_key, from_status, to_status, action, evidence)
SELECT goal_key, 'adopted', 'superseded', 'c8-superseded', 'superseded by objectives id 329 cost-ceiling and id 330 return-on-spend v3 (both ACTIVE) and the cost ceilings (A9) constraint of objective-function v3; C8-GOVERNANCE-PROPOSALS-1'
FROM goals WHERE status = 'adopted' AND goal_key = 'vrev-g16eyz4j2k';

UPDATE goals SET status = 'resolved', completed_at = datetime('now'), updated_at = datetime('now'),
  alignment = COALESCE(alignment, '') || ' | resolved 2026-11-05: already in force. objectives id 2 objective-function v3 (ratified_by owner (fleet.qnfo.org) 2026-10-01) carries the external_impact term 0.10 funded from autonomy, ratified 2026-09-26 by owner directive.'
WHERE status = 'adopted' AND goal_key = 'vrev-external-impact-term-20260926';
UPDATE goals SET status = 'resolved', completed_at = datetime('now'), updated_at = datetime('now'),
  alignment = COALESCE(alignment, '') || ' | resolved 2026-11-05: already in force. objectives id 2 objective-function v3 weights read autonomy 0.15 and self_improv 0.20, the change proposed.'
WHERE status = 'adopted' AND goal_key = 'vrev-gmw8u0d2y';
UPDATE goals SET status = 'resolved', completed_at = datetime('now'), updated_at = datetime('now'),
  alignment = COALESCE(alignment, '') || ' | resolved 2026-11-05: already in force. Metric energy_efficiency exists with target >= 0.8 (owner-ratified goals.id=43) and reads 0.9617, refreshed 2026-11-05T01:05Z.'
WHERE status = 'adopted' AND goal_key = 'vrev-g15hdh4s30';
UPDATE goals SET status = 'superseded', retired_at = datetime('now'), updated_at = datetime('now'),
  alignment = COALESCE(alignment, '') || ' | superseded 2026-11-05 by proposal lrev-return-on-spend-v3-17f8ssu (OBJECTIVE-LIMITS-REVIEW-1, owner-ratified goals.id=41): the limits review this goal asks for exists as that proposal.'
WHERE status = 'adopted' AND goal_key = 'gjyfc7j56';
UPDATE goals SET status = 'superseded', retired_at = datetime('now'), updated_at = datetime('now'),
  alignment = COALESCE(alignment, '') || ' | superseded 2026-11-05 by objectives id 329 cost-ceiling and id 330 return-on-spend v3 (both ACTIVE) and the cost ceilings (A9) constraint of objective-function v3; a separate 50 percent direct-provider share constraint was not adopted in 39 days.'
WHERE status = 'adopted' AND goal_key = 'vrev-g16eyz4j2k';

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'c8-projects-goals session', 'an objective-revision proposal whose change is already in the ratified objective, or whose subject another ACTIVE objective carries, is closed against that objective with the reading shown; a proposal still undecided stays open',
 'C8-GOVERNANCE-PROPOSALS-1: 5 of 6 adopted objective-revision goals resolved (3) or superseded (2); lrev-return-on-spend-v3-17f8ssu left open with its updated evidence',
 'qnfo-audit 2026-11-05 01:30Z: objectives id 2 (objective-function v3, owner-ratified 2026-10-01) weights autonomy 0.15, self_improv 0.20, external_impact 0.10; metric energy_efficiency 0.9617 (target >= 0.8, owner-ratified goals.id=43); objectives 329 and 330 ACTIVE; metrics indexed_surface, pageviews_30d, referral_30d, external_impact_per_dollar observed with thresholds; no zenodo metric',
 'migration merged', 'goals.status, alignment, completed_at, retired_at of 5 rows (copied to bak_20261105_c8_gov); goal_lifecycle rows; objectives untouched',
 'the Rollback header of migrations/2026-11-05-c8-governance-proposals.sql', 'five governance GL- roadmap rows verify within the hour', '5 of the 6 GL- governance rows leave the open roadmap', 'none',
 'd1:qnfo-audit read-only (objectives, metric_registry, goals); node:sqlite replay in migrations/c8-governance-proposals.test.mjs'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'C8-GOVERNANCE-PROPOSALS-1:%');
