-- TRACKER-ROLLUP-DRIFT-1 (#100378, pillar autonomy): exclude intentionally rolled-up issues from tracker drift.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261102_v_tracker_drift_rollup
-- Rollback: DROP VIEW v_tracker_drift; CREATE VIEW v_tracker_drift AS SELECT 'issue-unmirrored' AS kind, CAST(a.id AS TEXT) AS ref, a.title AS detail, MAX(0, (CAST(strftime('%s','now') AS INTEGER) - COALESCE(a.created_at, 0) / 1000) / 60) AS age_min FROM agent_issues a LEFT JOIN gh_issue_links l ON l.issue_id = a.id WHERE a.status = 'open' AND l.issue_id IS NULL AND a.created_at < (strftime('%s','now') - 1200) * 1000 UNION ALL SELECT 'issue-state', CAST(a.id AS TEXT), 'D1 ' || a.status || ' vs GitHub #' || l.gh_number || ' ' || COALESCE(l.gh_state, '?'), MAX(0, (CAST(strftime('%s','now') AS INTEGER) - COALESCE(a.updated_at, a.created_at, 0) / 1000) / 60) FROM agent_issues a JOIN gh_issue_links l ON l.issue_id = a.id WHERE (a.status IN ('open')) <> (COALESCE(l.gh_state, '') = 'open') UNION ALL SELECT 'code-task-pr', t.task_id, t.drift, CASE WHEN t.synced_at IS NULL THEN 0 ELSE MAX(0, (CAST(strftime('%s','now') AS INTEGER) - CAST(strftime('%s', t.synced_at) AS INTEGER)) / 60) END FROM code_task_pr_links t WHERE t.drift IS NOT NULL AND t.drift <> '';

CREATE TABLE IF NOT EXISTS bak_20261102_v_tracker_drift_rollup AS
SELECT name, sql, strftime('%Y-%m-%dT%H:%M:%SZ', 'now') AS saved_at
FROM sqlite_master
WHERE type = 'view' AND name = 'v_tracker_drift';

DROP VIEW IF EXISTS v_tracker_drift;

CREATE VIEW v_tracker_drift AS
  WITH configured_priorities AS (
    SELECT value FROM ops_config WHERE key = 'gh_individual_priorities' LIMIT 1
  ),
  issue_mirror_policy AS (
    SELECT a.id, a.title, a.status, a.priority, a.created_at, a.updated_at,
           CASE
             WHEN COALESCE(trim(p.value), '') = '' THEN 1
             WHEN lower(trim(a.title)) LIKE 'fm-actor-1:%' THEN 1
             WHEN instr(
               ',' || replace(replace(replace(replace(lower(p.value), char(9), ','), char(10), ','), char(13), ','), ' ', ',') || ',',
               ',' || lower(a.priority) || ','
             ) > 0 THEN 1
             ELSE 0
           END AS individual
      FROM agent_issues a
      LEFT JOIN configured_priorities p ON 1 = 1
  )
  SELECT 'issue-unmirrored' AS kind, CAST(a.id AS TEXT) AS ref, a.title AS detail,
         MAX(0, (CAST(strftime('%s','now') AS INTEGER) - COALESCE(a.created_at, 0) / 1000) / 60) AS age_min
    FROM issue_mirror_policy a LEFT JOIN gh_issue_links l ON l.issue_id = a.id
   WHERE a.status = 'open' AND a.individual = 1 AND l.issue_id IS NULL
     AND a.created_at < (strftime('%s','now') - 1200) * 1000
  UNION ALL
  SELECT 'issue-state', CAST(a.id AS TEXT), 'D1 ' || a.status || ' vs GitHub #' || l.gh_number || ' ' || COALESCE(l.gh_state, '?'),
         MAX(0, (CAST(strftime('%s','now') AS INTEGER) - COALESCE(a.updated_at, a.created_at, 0) / 1000) / 60)
    FROM issue_mirror_policy a JOIN gh_issue_links l ON l.issue_id = a.id
   WHERE a.individual = 1
     AND (a.status IN ('open')) <> (COALESCE(l.gh_state, '') = 'open')
  UNION ALL
  SELECT 'code-task-pr', t.task_id, t.drift,
         CASE WHEN t.synced_at IS NULL THEN 0 ELSE MAX(0, (CAST(strftime('%s','now') AS INTEGER) - CAST(strftime('%s', t.synced_at) AS INTEGER)) / 60) END
    FROM code_task_pr_links t WHERE t.drift IS NOT NULL AND t.drift <> '';
