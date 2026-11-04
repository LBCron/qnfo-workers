-- D1-OVERLOAD-1d (charter pillar autonomy): indexes for the tick cascade (fleet_tick / fleet_tick_heavy triggers).
-- Measured 2026-11-04, qnfo-audit, read-only SELECT meta.rows_read (no writes):
--   v_output_quality_headline            1,519,106 rows  (fleet_tick_heavy trigger output_quality_heavy_tick; the view evaluates
--                                        v_output_quality_remediation_cohort twice at 759,429 rows each: a 14-day range scan of
--                                        remediation_verifications (376,935 rows) through idx_rv_verified_norm, which is not
--                                        covering, so every matching row costs an index read plus a table read)
--   v_cadence_overdue                       68,084 rows  (fleet_tick cadence_overdue_tick_10m, every tick; 8 MAX() subqueries per
--                                        surface, repeated per referencing column, over research_queue.published_at,
--                                        idea_proposals.created_at, social_media_posts(status,published_at), continuity_snapshots(ok,ts)
--                                        with no index on those columns)
-- Change: two covering/lookup index families, results identical (same rows, same expressions, only the access path changes).
--   1. idx_rv_verified_norm_cover: the cohort's expression plus issue_id, class, verified_at, so the 14-day scan is index-only.
--   2. MAX() lookups for v_cadence_overdue become one index probe each.
-- PREDICTION: v_output_quality_remediation_cohort 759k -> ~380k rows (-50%), v_output_quality_headline 1.52M -> ~0.8M;
--   v_cadence_overdue 68k -> under 3k. Verify: SELECT * FROM v_output_quality_headline; meta.rows_read below 1.0M.
-- Not fixed here: v_false_stop_candidates (167k rows, kernel_registries_tick hourly) scans every reply body ever stored
--   (v_agent_replies has no window); narrowing it changes the view's results, so it is filed separately.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DROP INDEX IF EXISTS idx_rv_verified_norm_cover; DROP INDEX IF EXISTS idx_rq_published_at; DROP INDEX IF EXISTS idx_ip_created_at; DROP INDEX IF EXISTS idx_sm_status_published; DROP INDEX IF EXISTS idx_cs_ok_ts

CREATE INDEX IF NOT EXISTS idx_rv_verified_norm_cover ON remediation_verifications (replace(substr(verified_at, 1, 19), 'T', ' '), issue_id, class, verified_at);
CREATE INDEX IF NOT EXISTS idx_rq_published_at ON research_queue (published_at);
CREATE INDEX IF NOT EXISTS idx_ip_created_at ON idea_proposals (created_at);
CREATE INDEX IF NOT EXISTS idx_sm_status_published ON social_media_posts (status, published_at);
CREATE INDEX IF NOT EXISTS idx_cs_ok_ts ON continuity_snapshots (ok, ts);
