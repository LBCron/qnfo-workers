-- REDUNDANT-INDEXES-1 (2026-11-04, program QNFO.INFRA, charter pillar core): drop nine indexes that another index on the same table already serves.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261104_redundant_indexes
-- Rollback: CREATE INDEX IF NOT EXISTS idx_rv_verified_norm ON remediation_verifications (replace(substr(verified_at, 1, 19), 'T', ' ')); CREATE INDEX IF NOT EXISTS idx_rv_verified_cover ON remediation_verifications (replace(substr(verified_at, 1, 19), 'T', ' '), issue_id, class); (the other seven: recreate from the sql column of bak_20261104_redundant_indexes)
-- CAUSE-MAPPED: registers no metric_registry row (indexes only; the closing probe is the failure-mode contract fm-redundant-indexes).
--
-- Measured 2026-11-04 on qnfo-audit (Cloudflare GraphQL d1QueriesAdaptiveGroups, 19:00-21:00Z): INSERT INTO remediation_verifications, 1,339 statements, 13,067 rows written
-- (9.8 a statement: the row plus 9 index entries; the table has 9 indexes), 66 s of database time (49 ms a statement), the largest write line after fleet_tick. Three of the nine
-- are one expression index grown twice: idx_rv_verified_norm (expr) is a prefix of idx_rv_verified_cover (expr, issue_id, class), which is a prefix of
-- idx_rv_verified_norm_cover (expr, issue_id, class, verified_at). SQLite serves any lookup on the shorter key from the longer index, so the two shorter ones only cost a
-- write per insert and about 45 MB of pages (585 K rows x 2 entries). A scan of every index of the database (pragma_index_xinfo, 653 indexes) found seven more that are an
-- exact duplicate or a strict prefix of a sibling: discovery_projects idx_projects_last_active and idx_projects_status (duplicates of idx_dp_last_active, idx_dp_status),
-- errata_queue ix_errata_queue_subject (duplicate of idx_errata_queue_subject), project_state idx_project_state_proj_session (duplicate of the unique ux_project_state_session),
-- tasks idx_tasks_status (duplicate of idx_tasks_column), analytics_daily idx_analytics_daily_date and venue_signal idx_venue_signal_venue (prefixes of their primary-key autoindexes).
-- The BACKUP table keeps each dropped index's table and CREATE statement. Prediction: 9 indexes -> 7 on remediation_verifications (rows written a statement 9.8 -> 7.8,
-- insert time about -20 percent, about 45 MB fewer pages); no read plan changes, because each dropped key is a prefix of one that stays.
-- Check: re-run the d1QueriesAdaptiveGroups row for the INSERT 24 h after the apply; SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND tbl_name='remediation_verifications' reads 7.

CREATE TABLE IF NOT EXISTS bak_20261104_redundant_indexes AS
SELECT name, tbl_name, sql FROM sqlite_master
WHERE type = 'index' AND name IN ('idx_rv_verified_norm', 'idx_rv_verified_cover', 'idx_projects_last_active', 'idx_projects_status', 'ix_errata_queue_subject',
  'idx_project_state_proj_session', 'idx_tasks_status', 'idx_analytics_daily_date', 'idx_venue_signal_venue');

DROP INDEX IF EXISTS idx_rv_verified_norm;
DROP INDEX IF EXISTS idx_rv_verified_cover;
DROP INDEX IF EXISTS idx_projects_last_active;
DROP INDEX IF EXISTS idx_projects_status;
DROP INDEX IF EXISTS ix_errata_queue_subject;
DROP INDEX IF EXISTS idx_project_state_proj_session;
DROP INDEX IF EXISTS idx_tasks_status;
DROP INDEX IF EXISTS idx_analytics_daily_date;
DROP INDEX IF EXISTS idx_venue_signal_venue;

INSERT OR IGNORE INTO failure_modes
 (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, trigger_condition, symptom, blast_radius)
VALUES
 ('redundant-indexes', 'remediation_verifications carries more than 7 indexes, so each insert writes the row plus more than 7 index entries',
  'Two covering indexes were added to the same expression key one after the other (idx_rv_verified_cover, idx_rv_verified_norm_cover) while the shorter idx_rv_verified_norm stayed, and a migration that re-runs recreates a dropped index (CREATE INDEX IF NOT EXISTS)',
  'REDUNDANT-INDEXES-1: keep idx_rv_verified_norm_cover only; before adding an index run pragma_index_xinfo for the table and extend an existing key instead of adding a prefix of it',
  'fm-redundant-indexes', 'fm-redundant-indexes', '2026-11-04',
  'An index on remediation_verifications is created beyond the seven that stay',
  'sqlite_master lists more than 7 indexes on remediation_verifications',
  'Insert time of the largest verification log (49 ms a statement, 18 K rows a day), database size');

INSERT OR IGNORE INTO remediation_contracts
 (class, issue_id, verify_probe, verify_transport, max_attempts, expected_cadence_h, status, precondition, action, escalate_to, module, next_due_at)
VALUES
 ('fm-redundant-indexes', NULL,
  'SELECT ''0'' AS expected, CAST(MAX(0, COUNT(*) - 7) AS TEXT) AS observed FROM sqlite_master WHERE type = ''index'' AND tbl_name = ''remediation_verifications''',
  'd1-query', 1000, 1, 'active',
  'remediation_verifications has at most 7 indexes',
  'List the indexes with pragma_index_xinfo; drop the one whose key is a prefix of another (restore nothing from the backup table) and remove the migration line that recreates it',
  'program-manager:QNFO.INFRA', 'failure-mode', datetime('now'));

INSERT INTO decision_log
 (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, surfaces_tested)
SELECT 'claude-code-session-2026-11-04-spend-enforce',
 'An index whose key is a strict prefix of a sibling adds a write to every insert and no read plan',
 'REDUNDANT-INDEXES-1: drop nine redundant indexes (two on remediation_verifications); contract fm-redundant-indexes',
 'd1QueriesAdaptiveGroups 19:00-21:00Z: remediation_verifications INSERT 1,339 statements, 13,067 rows written, 66 s; pragma_index_xinfo over 653 indexes: 9 prefix or duplicate',
 'remediation_verifications keeps 7 indexes; the other seven drops are tiny tables',
 'index structures only; no data, view or trigger changes; every dropped key is a prefix of an index that stays',
 'recreate from bak_20261104_redundant_indexes.sql (Rollback line)',
 'cheaper inserts on the largest verification log and 45 MB less database',
 'remediation_verifications INSERT rows written a statement 9.8 -> about 7.8 and insert time about -20 percent from the next 24 h',
 'migrations/redundant-indexes.test.mjs (EXPLAIN QUERY PLAN of the norm, cover and norm_cover lookups before and after on a replay of the table)'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'REDUNDANT-INDEXES-1:%');
