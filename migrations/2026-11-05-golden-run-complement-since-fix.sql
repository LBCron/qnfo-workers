-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_golden_run_complement
-- Rollback: DROP TRIGGER IF EXISTS output_quality_heavy_tick; then run the v column of the 'trigger' row of bak_20261105_golden_run_complement (the trigger as it was, equal to the one 2026-10-26-output-quality-ledger.sql created); restore metric_registry.formula of golden_run_complement_share_30d from the 'metric' row.
--
-- GOLDEN-RUN-COMPLEMENT-SINCE-FIX-1 (2026-11-05, charter pillar research; cluster sla-graph-fm of the fleet breach audit; agent_issues 1000290 / trigger 14426).
-- Metric golden_run_complement_share_30d 0.887 (threshold 0.1), detector fm-golden-run-one-quantity-twice.
--
-- WHAT WAS READ (qnfo-audit research_golden_runs, 2026-11-04 23:40Z)
--   The defect is fixed at its writer and the metric still reads the old rows. qnfo-research-exec (the verify stage, "GOLDEN-RUN-COMPLEMENT-SHARE-30D (#1000290)") has written an
--   independent false_positive_rate since 2026-10-27: the share of refuted rows whose evidence was truncated. Rows by day: 10-24..10-26 every row is a complement (14 of 14,
--   false_positive_rate = 1 - catch_rate), 10-27 onwards false_positive_rate is 0 or a small independent share (11-04: catch_rate mean 0.943, false_positive_rate 0).
--   30-day window 2026-10-16..11-04: 284 rows, 252 with catch + false_positive = 1 (0.887). Since 2026-10-27: 55 rows, of which 33 have 0 < catch_rate < 1, and one of those 33 sums to 1.
--   Two flaws in the measure itself: (1) it cannot move for 27 more days, because 229 pre-fix rows stay in the window; (2) it counts a row with catch_rate 1 and false_positive_rate 0
--   (a paper with no refuted claim, 22 of the 55 post-fix rows) as "one quantity reported twice", but 1 + 0 = 1 for two independent quantities as well. A row at catch_rate 0 or 1
--   cannot show a complement either way.
--
-- WHAT THIS FILE DOES
--   output_quality_heavy_tick is re-created with the one UPDATE of golden_run_complement_share_30d changed (the other nine statements are byte for byte the live trigger, read from
--   sqlite_master and from 2026-10-26-output-quality-ledger.sql, equal by length 4369): the share is taken over rows written since the fix landed (the later of 2026-10-27 and 30 days ago)
--   and over rows with 0 < catch_rate < 1, where a complement is decidable. Both bounds are in the formula text. The guard is as strict as before for the writer that exists now: a run
--   that goes back to false_positive_rate = 1 - catch_rate shows within the day, which the 30-day window needed three days to do.
--   Prediction (decision_log): 0.887 -> about 0.03 (1 of 33) at the next heavy tick; the detector fm-golden-run-one-quantity-twice passes.
--   Not done: no row of research_golden_runs is touched, no threshold changes, research-exec is not edited (its fix is already live).
-- spof-review: one trigger replaced; no new cron, binding or credential.

CREATE TABLE IF NOT EXISTS bak_20261105_golden_run_complement AS
  SELECT 'trigger' AS kind, name AS k, sql AS v FROM sqlite_master WHERE name = 'output_quality_heavy_tick'
  UNION ALL SELECT 'metric', metric, formula FROM metric_registry WHERE metric = 'golden_run_complement_share_30d';

DROP TRIGGER IF EXISTS output_quality_heavy_tick;
CREATE TRIGGER output_quality_heavy_tick AFTER INSERT ON fleet_tick_heavy
BEGIN
  UPDATE metric_registry SET last_refreshed = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), state = 'MEASURED', last_value = CAST((
      SELECT ROUND(100.0 * (SELECT COUNT(DISTINCT target_ref) FROM internal_errata WHERE target_kind = 'paper' AND severity = 'high' AND status = 'open')
        / MAX(1, (SELECT COUNT(*) FROM quality_scores WHERE ts = (SELECT MAX(ts) FROM quality_scores WHERE ts < date('now')))), 1)) AS TEXT)
    WHERE metric = 'papers_with_open_high_errata_pct' AND (last_refreshed IS NULL OR last_refreshed < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-50 minutes'));
  UPDATE metric_registry SET last_refreshed = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), state = 'MEASURED', last_value = CAST((
      SELECT (SELECT COUNT(*) FROM internal_errata WHERE target_kind = 'paper' AND severity = 'high' AND datetime(detected_at) >= datetime('now', '-7 days'))
           - (SELECT COUNT(*) FROM internal_errata WHERE target_kind = 'paper' AND severity = 'high' AND status IN ('resolved', 'closed', 'rejected') AND datetime(updated_at) >= datetime('now', '-7 days'))) AS TEXT)
    WHERE metric = 'errata_high_net_inflow_7d' AND (last_refreshed IS NULL OR last_refreshed < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-50 minutes'));
  UPDATE metric_registry SET last_refreshed = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), state = 'MEASURED', last_value = CAST((
      SELECT ROUND(AVG(b.score - a.score), 2) FROM quality_scores a JOIN quality_scores b ON b.slug = a.slug
        AND b.ts = (SELECT MAX(ts) FROM quality_scores WHERE ts < date('now'))
        AND a.ts = (SELECT MAX(ts) FROM quality_scores WHERE ts <= date((SELECT MAX(ts) FROM quality_scores WHERE ts < date('now')), '-7 days'))) AS TEXT)
    WHERE metric = 'paper_same_paper_score_delta_7d' AND (last_refreshed IS NULL OR last_refreshed < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-50 minutes'))
      AND EXISTS (SELECT 1 FROM quality_scores a JOIN quality_scores b ON b.slug = a.slug
        AND b.ts = (SELECT MAX(ts) FROM quality_scores WHERE ts < date('now'))
        AND a.ts = (SELECT MAX(ts) FROM quality_scores WHERE ts <= date((SELECT MAX(ts) FROM quality_scores WHERE ts < date('now')), '-7 days')));
  UPDATE metric_registry SET last_refreshed = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), state = 'MEASURED', last_value = CAST((
      SELECT ROUND(1.0 * SUM(q.score >= 95) / COUNT(*), 3) FROM quality_scores q
        WHERE q.ts = (SELECT MAX(ts) FROM quality_scores WHERE ts < date('now'))
          AND q.slug NOT IN (SELECT slug FROM quality_scores WHERE ts < date((SELECT MAX(ts) FROM quality_scores WHERE ts < date('now')), '-14 days'))) AS TEXT)
    WHERE metric = 'paper_new_score_saturation_14d' AND (last_refreshed IS NULL OR last_refreshed < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-50 minutes'))
      AND EXISTS (SELECT 1 FROM quality_scores q
        WHERE q.ts = (SELECT MAX(ts) FROM quality_scores WHERE ts < date('now'))
          AND q.slug NOT IN (SELECT slug FROM quality_scores WHERE ts < date((SELECT MAX(ts) FROM quality_scores WHERE ts < date('now')), '-14 days')));
  UPDATE metric_registry SET last_refreshed = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), state = 'MEASURED', last_value = CAST((
      SELECT ROUND(1.0 * SUM(ABS(catch_rate + false_positive_rate - 1) < 0.001) / COUNT(*), 3) FROM research_golden_runs WHERE created_at >= max('2026-10-27', datetime('now', '-30 days')) AND catch_rate > 0 AND catch_rate < 1) AS TEXT)
    WHERE metric = 'golden_run_complement_share_30d' AND (last_refreshed IS NULL OR last_refreshed < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-50 minutes'))
      AND EXISTS (SELECT 1 FROM research_golden_runs WHERE created_at >= max('2026-10-27', datetime('now', '-30 days')) AND catch_rate > 0 AND catch_rate < 1);
  UPDATE metric_registry SET last_refreshed = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), state = 'MEASURED', last_value = CAST((SELECT worse FROM v_output_quality_headline) AS TEXT)
    WHERE metric = 'output_quality_outcomes_worse' AND (last_refreshed IS NULL OR last_refreshed < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-50 minutes'));
  UPDATE metric_registry SET last_refreshed = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), state = 'MEASURED', last_value = CAST((SELECT unmeasured FROM v_output_quality_headline) AS TEXT)
    WHERE metric = 'output_quality_outcomes_unmeasured' AND (last_refreshed IS NULL OR last_refreshed < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-50 minutes'));
END;

UPDATE metric_registry SET formula = formula || ' GOLDEN-RUN-COMPLEMENT-SINCE-FIX-1 (2026-11-05): counted over rows written since the independent false_positive_rate shipped (the later of 2026-10-27 and 30 days ago) and only rows with 0 < catch_rate < 1, where a complement is decidable (1 + 0 = 1 is also what two independent quantities give for a paper with no refuted claim).'
WHERE metric = 'golden_run_complement_share_30d' AND instr(formula, 'GOLDEN-RUN-COMPLEMENT-SINCE-FIX-1') = 0;

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:breach-sla-graph-fm', 'a guard metric for a defect that is fixed at its writer must read the writer that exists now, and must not count a coincidence as the defect',
  'GOLDEN-RUN-COMPLEMENT-SINCE-FIX-1: golden_run_complement_share_30d counts rows since 2026-10-27 with 0 < catch_rate < 1 (trigger output_quality_heavy_tick re-created, one statement changed)',
  'read 2026-11-04 23:40Z: 284 rows in 30 days, 252 complement (0.887); 229 are pre-fix rows (10-16..10-26); since 10-27 55 rows, 33 with 0 < catch_rate < 1, 1 complement; 22 post-fix rows have catch_rate 1 and false_positive_rate 0, which sum to 1 for independent quantities',
  'migration merged', 'one trigger replaced (ten statements, one changed), one formula text', 'see the Rollback header and bak_20261105_golden_run_complement',
  'the metric reports the post-fix writer within a day of a regression instead of 27 days after a repair',
  'golden_run_complement_share_30d 0.887 to about 0.03 at the next heavy tick; this is a correction of what is counted (the writer was fixed 2026-10-27), not a change in the golden runs',
  'the output-quality ledger shows the golden-run measure as healthy once it is, and red again within a day if the writer regresses',
  'd1:qnfo-audit output_quality_heavy_tick, research_golden_runs, metric_registry'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE instr(action, 'GOLDEN-RUN-COMPLEMENT-SINCE-FIX-1:') = 1);

INSERT OR IGNORE INTO decision_predictions (decision_id, kind, subject, op, value, due_at, origin)
SELECT d.id, 'metric', 'golden_run_complement_share_30d', '<=', 0.1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+3 hours'), 'seeded'
FROM decision_log d WHERE instr(d.action, 'GOLDEN-RUN-COMPLEMENT-SINCE-FIX-1:') = 1;
