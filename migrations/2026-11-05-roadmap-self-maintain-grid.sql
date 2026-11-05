-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_rsm_grid
-- Rollback: UPDATE fleet_crons SET cron_expr = (SELECT v FROM bak_20261105_rsm_grid b WHERE b.k = fleet_crons.name), next_fire = NULL, updated_at = datetime('now') WHERE name IN (SELECT k FROM bak_20261105_rsm_grid).
--
-- ROADMAP-SELF-MAINTAIN-2b (2026-11-05, charter pillar autonomy; cluster sla-graph-fm of the fleet breach audit): the three crons migrations/2026-11-05-roadmap-self-maintain-split.sql added fire at
-- :31, :33 and :37, off the 5-minute grid that CRON-GRID-MIGRATION-1 (apply_migrations.py --check) requires of every fleet_crons row (owner directive 2026-10-19: cron ticks in 5-minute intervals).
-- That file merged before the check was run against it. They move to :40, :05 and :15, minutes that already carry light tasks; next_fire is cleared so the dispatcher fires each once at its next
-- two-minute tick and schedules it from the new expression. No step, task or metric changes.
-- spof-review: three fleet_crons rows; reversible from the backup table.

CREATE TABLE IF NOT EXISTS bak_20261105_rsm_grid AS
  SELECT name AS k, cron_expr AS v FROM fleet_crons WHERE name IN ('roadmap-self-maintain-goals-hourly', 'roadmap-self-maintain-roadmap-hourly', 'roadmap-self-maintain-metrics-hourly');

UPDATE fleet_crons SET cron_expr = '40 * * * *', next_fire = NULL, updated_at = datetime('now') WHERE name = 'roadmap-self-maintain-goals-hourly' AND cron_expr = '31 * * * *';
UPDATE fleet_crons SET cron_expr = '5 * * * *', next_fire = NULL, updated_at = datetime('now') WHERE name = 'roadmap-self-maintain-roadmap-hourly' AND cron_expr = '33 * * * *';
UPDATE fleet_crons SET cron_expr = '15 * * * *', next_fire = NULL, updated_at = datetime('now') WHERE name = 'roadmap-self-maintain-metrics-hourly' AND cron_expr = '37 * * * *';
