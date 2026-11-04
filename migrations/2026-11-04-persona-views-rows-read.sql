-- PERSONA-VIEWS-ROWS-READ-1 (charter pillar cost; D1-OVERLOAD-1). qnfo-audit read 342M rows in 3 h on 2026-11-04.
-- Measured 2026-11-04 15:00Z (meta.rows_read of one call, same result rows before and after):
--   v_output_quality_remediation_cohort 759,429 (full remediation_verifications, 376,935 rows, read twice); v_output_quality_verdict/by_surface/headline 759,534 each
--   -> persona_briefs 'Outputs' UPDATE (29 runs, 43.9M rows) and SELECT * FROM v_output_quality_headline (7 runs, 10.6M rows).
--   v_program_focus_candidates 481,823 (per open issue a scan of all 393 metric_registry rows for guard metrics) -> v_program_focus_plan and program_focus_plan_now INSERT (66 runs, 31.6M rows).
--   v_persona_twin_supersede 64,169 (per open METRIC-TRIGGER issue a scan of all open METRIC-TRIGGER issues) -> issue_triage INSERT / agent_issues UPDATE (89 runs, 5.4M rows).
--   v_backlog_burndown 13,560 (full scan of issue_lifecycle for the 24 h window) -> tempo_targets UPDATE (56 runs, 3.8M rows).
-- Changes: (1) the cohort view reads a one-row snapshot refreshed by a fleet_tick_heavy trigger (about every 30 min) and falls back to the live
-- computation (v_output_quality_remediation_cohort_raw, the old definition) only when the snapshot is older than 90 min; the live branch is gated
-- inside its anchor CTE so it reads 0 rows while the snapshot is fresh (36 reads measured). (2) the guard-metric match is hoisted into a
-- MATERIALIZED CTE of program x metric (13,236 reads, identical 608 rows incl. tier, has_doer, rn). (3) the twin view groups open METRIC-TRIGGER
-- issues once (1,133 reads; same rows, currently 0). (4) two covering indexes. No behaviour, probe, guard or cap is removed.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: output_quality_measures
-- Rollback: DROP TRIGGER IF EXISTS output_quality_cohort_snapshot_tick; DROP VIEW IF EXISTS v_output_quality_remediation_cohort; CREATE VIEW v_output_quality_remediation_cohort AS WITH anchor AS ( SELECT MAX(day) AS day FROM metric_history WHERE metric = 'remediation_latest_pass_pct_7d' ), subjects AS ( SELECT CASE WHEN r.issue_id IS NOT NULL THEN 'issue:' || r.issue_id ELSE 'class:' || r.class END AS subject, MAX(CASE WHEN replace(substr(r.verified_at, 1, 19), 'T', ' ') >= datetime(a.day, '-6 days') THEN r.id END) AS now_id, MAX(CASE WHEN replace(substr(r.verified_at, 1, 19), 'T', ' ') < datetime(a.day, '-6 days') THEN r.id END) AS prev_id FROM anchor a CROSS JOIN remediation_verifications r WHERE replace(substr(r.verified_at, 1, 19), 'T', ' ') >= datetime(a.day, '-13 days') AND replace(substr(r.verified_at, 1, 19), 'T', ' ') < datetime(a.day, '+1 day') AND (r.issue_id IS NOT NULL OR r.class IS NOT NULL) GROUP BY subject ) SELECT a.day AS now_day, date(a.day, '-7 days') AS prev_day, COUNT(n.id) AS subjects, ROUND(100.0 * SUM(n.pass) / NULLIF(COUNT(n.id), 0), 1) AS now_value, ROUND(100.0 * SUM(p.pass) / NULLIF(COUNT(p.id), 0), 1) AS prev_value FROM anchor a LEFT JOIN subjects s ON s.now_id IS NOT NULL AND s.prev_id IS NOT NULL LEFT JOIN remediation_verifications n ON n.id = s.now_id LEFT JOIN remediation_verifications p ON p.id = s.prev_id GROUP BY a.day; DROP VIEW IF EXISTS v_output_quality_remediation_cohort_raw; DROP VIEW IF EXISTS v_program_focus_candidates; CREATE VIEW v_program_focus_candidates AS SELECT x.*, ROW_NUMBER() OVER (PARTITION BY x.program_code ORDER BY x.tier, x.prank, x.created_at, x.id) AS rn FROM ( SELECT m.program_code, a.id, a.priority, a.title, a.created_at, CASE a.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END AS prank, CASE WHEN COALESCE(a.description, '') LIKE '%code-task:%' OR a.linked_session IS NOT NULL OR EXISTS (SELECT 1 FROM remediation_contracts rc WHERE rc.issue_id = a.id AND rc.status = 'active') THEN 1 ELSE 0 END AS has_doer, CASE WHEN c.primary_metric IS NOT NULL AND (instr(a.title, c.primary_metric) > 0 OR instr(upper(a.title), upper(replace(c.primary_metric, '_', '-'))) > 0) THEN 0 WHEN c.guard_metrics IS NOT NULL AND EXISTS (SELECT 1 FROM metric_registry mr WHERE instr(',' || replace(c.guard_metrics, ' ', '') || ',', ',' || mr.metric || ',') > 0 AND (instr(a.title, mr.metric) > 0 OR instr(upper(a.title), upper(replace(mr.metric, '_', '-'))) > 0)) THEN 1 WHEN a.priority = 'critical' THEN 2 WHEN a.priority = 'high' THEN 3 ELSE 4 END AS tier, c.primary_metric FROM agent_issues a JOIN issue_project_map m ON m.issue_id = a.id LEFT JOIN program_charters c ON c.program_code = m.program_code AND c.status = 'active' WHERE a.status = 'open' ) x; DROP VIEW IF EXISTS v_persona_twin_supersede; CREATE VIEW v_persona_twin_supersede AS SELECT x.id AS issue_id, x.program_code, x.tid, x.successor, 'superseded by #' || x.successor || ': the same metric trigger ' || x.tid || ' was filed again (newer threshold or text); the newer issue carries the work (MANAGEMENT-PERSONAS-2)' AS evidence FROM ( SELECT a.id, m.program_code, CAST(substr(a.title, 16, instr(substr(a.title, 16), '-') - 1) AS INTEGER) AS tid, (SELECT MAX(b.id) FROM agent_issues b WHERE b.status = 'open' AND b.title LIKE 'METRIC-TRIGGER-%' AND CAST(substr(b.title, 16, instr(substr(b.title, 16), '-') - 1) AS INTEGER) = CAST(substr(a.title, 16, instr(substr(a.title, 16), '-') - 1) AS INTEGER)) AS successor FROM agent_issues a LEFT JOIN issue_project_map m ON m.issue_id = a.id WHERE a.status = 'open' AND a.title LIKE 'METRIC-TRIGGER-%' ) x WHERE x.tid > 0 AND x.successor > x.id AND COALESCE((SELECT value FROM ops_config WHERE key = 'persona_actions'), 'on') <> 'off'; DROP INDEX IF EXISTS idx_rv_verified_cover; DROP INDEX IF EXISTS idx_issue_lifecycle_ts_status; DROP TABLE IF EXISTS output_quality_cohort_snapshot

CREATE TABLE IF NOT EXISTS output_quality_cohort_snapshot (
  k INTEGER PRIMARY KEY CHECK (k = 1), computed_at TEXT NOT NULL, now_day TEXT, prev_day TEXT, subjects INTEGER, now_value REAL, prev_value REAL
);
CREATE INDEX IF NOT EXISTS idx_rv_verified_cover ON remediation_verifications (replace(substr(verified_at, 1, 19), 'T', ' '), issue_id, class);
CREATE INDEX IF NOT EXISTS idx_issue_lifecycle_ts_status ON issue_lifecycle (ts, to_status);
DROP VIEW IF EXISTS v_output_quality_remediation_cohort_raw;
CREATE VIEW v_output_quality_remediation_cohort_raw AS
WITH anchor AS (
  SELECT MAX(day) AS day FROM metric_history WHERE metric = 'remediation_latest_pass_pct_7d'
), subjects AS (
  SELECT CASE WHEN r.issue_id IS NOT NULL THEN 'issue:' || r.issue_id ELSE 'class:' || r.class END AS subject,
         MAX(CASE WHEN replace(substr(r.verified_at, 1, 19), 'T', ' ') >= datetime(a.day, '-6 days') THEN r.id END) AS now_id,
         MAX(CASE WHEN replace(substr(r.verified_at, 1, 19), 'T', ' ') < datetime(a.day, '-6 days') THEN r.id END) AS prev_id
  FROM anchor a CROSS JOIN remediation_verifications r
  WHERE replace(substr(r.verified_at, 1, 19), 'T', ' ') >= datetime(a.day, '-13 days')
    AND replace(substr(r.verified_at, 1, 19), 'T', ' ') < datetime(a.day, '+1 day')
    AND (r.issue_id IS NOT NULL OR r.class IS NOT NULL)
  GROUP BY subject
)
SELECT a.day AS now_day, date(a.day, '-7 days') AS prev_day,
       COUNT(n.id) AS subjects,
       ROUND(100.0 * SUM(n.pass) / NULLIF(COUNT(n.id), 0), 1) AS now_value,
       ROUND(100.0 * SUM(p.pass) / NULLIF(COUNT(p.id), 0), 1) AS prev_value
FROM anchor a
LEFT JOIN subjects s ON s.now_id IS NOT NULL AND s.prev_id IS NOT NULL
LEFT JOIN remediation_verifications n ON n.id = s.now_id
LEFT JOIN remediation_verifications p ON p.id = s.prev_id
GROUP BY a.day;
INSERT OR REPLACE INTO output_quality_cohort_snapshot (k, computed_at, now_day, prev_day, subjects, now_value, prev_value)
  SELECT 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), now_day, prev_day, subjects, now_value, prev_value FROM v_output_quality_remediation_cohort_raw;
DROP VIEW IF EXISTS v_output_quality_remediation_cohort;
CREATE VIEW v_output_quality_remediation_cohort AS
SELECT now_day, prev_day, subjects, now_value, prev_value FROM output_quality_cohort_snapshot
WHERE k = 1 AND computed_at >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-90 minutes')
UNION ALL
SELECT now_day, prev_day, subjects, now_value, prev_value FROM (
  WITH anchor AS (
  SELECT MAX(day) AS day FROM metric_history WHERE metric = 'remediation_latest_pass_pct_7d' HAVING NOT EXISTS (SELECT 1 FROM output_quality_cohort_snapshot WHERE k = 1 AND computed_at >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-90 minutes'))
), subjects AS (
  SELECT CASE WHEN r.issue_id IS NOT NULL THEN 'issue:' || r.issue_id ELSE 'class:' || r.class END AS subject,
         MAX(CASE WHEN replace(substr(r.verified_at, 1, 19), 'T', ' ') >= datetime(a.day, '-6 days') THEN r.id END) AS now_id,
         MAX(CASE WHEN replace(substr(r.verified_at, 1, 19), 'T', ' ') < datetime(a.day, '-6 days') THEN r.id END) AS prev_id
  FROM anchor a CROSS JOIN remediation_verifications r
  WHERE replace(substr(r.verified_at, 1, 19), 'T', ' ') >= datetime(a.day, '-13 days')
    AND replace(substr(r.verified_at, 1, 19), 'T', ' ') < datetime(a.day, '+1 day')
    AND (r.issue_id IS NOT NULL OR r.class IS NOT NULL)
  GROUP BY subject
)
SELECT a.day AS now_day, date(a.day, '-7 days') AS prev_day,
       COUNT(n.id) AS subjects,
       ROUND(100.0 * SUM(n.pass) / NULLIF(COUNT(n.id), 0), 1) AS now_value,
       ROUND(100.0 * SUM(p.pass) / NULLIF(COUNT(p.id), 0), 1) AS prev_value
FROM anchor a
LEFT JOIN subjects s ON s.now_id IS NOT NULL AND s.prev_id IS NOT NULL
LEFT JOIN remediation_verifications n ON n.id = s.now_id
LEFT JOIN remediation_verifications p ON p.id = s.prev_id
GROUP BY a.day
);
CREATE TRIGGER IF NOT EXISTS output_quality_cohort_snapshot_tick AFTER INSERT ON fleet_tick_heavy
BEGIN
  INSERT OR REPLACE INTO output_quality_cohort_snapshot (k, computed_at, now_day, prev_day, subjects, now_value, prev_value)
  SELECT 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), now_day, prev_day, subjects, now_value, prev_value FROM v_output_quality_remediation_cohort_raw;
END;
DROP VIEW IF EXISTS v_program_focus_candidates;
CREATE VIEW v_program_focus_candidates AS
WITH gm AS MATERIALIZED (
  SELECT c.program_code, mr.metric FROM program_charters c JOIN metric_registry mr
    ON c.status = 'active' AND c.guard_metrics IS NOT NULL
   AND instr(',' || replace(c.guard_metrics, ' ', '') || ',', ',' || mr.metric || ',') > 0
)
SELECT x.*, ROW_NUMBER() OVER (PARTITION BY x.program_code ORDER BY x.tier, x.prank, x.created_at, x.id) AS rn
FROM (
  SELECT m.program_code, a.id, a.priority, a.title, a.created_at,
    CASE a.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END AS prank,
    CASE WHEN COALESCE(a.description, '') LIKE '%code-task:%' OR a.linked_session IS NOT NULL
           OR EXISTS (SELECT 1 FROM remediation_contracts rc WHERE rc.issue_id = a.id AND rc.status = 'active') THEN 1 ELSE 0 END AS has_doer,
    CASE WHEN c.primary_metric IS NOT NULL AND (instr(a.title, c.primary_metric) > 0 OR instr(upper(a.title), upper(replace(c.primary_metric, '_', '-'))) > 0) THEN 0
         WHEN c.guard_metrics IS NOT NULL AND EXISTS (SELECT 1 FROM gm
                WHERE gm.program_code = c.program_code
                  AND (instr(a.title, gm.metric) > 0 OR instr(upper(a.title), upper(replace(gm.metric, '_', '-'))) > 0)) THEN 1
         WHEN a.priority = 'critical' THEN 2
         WHEN a.priority = 'high' THEN 3
         ELSE 4 END AS tier,
    c.primary_metric
  FROM agent_issues a
  JOIN issue_project_map m ON m.issue_id = a.id
  LEFT JOIN program_charters c ON c.program_code = m.program_code AND c.status = 'active'
  WHERE a.status = 'open'
) x;
DROP VIEW IF EXISTS v_persona_twin_supersede;
CREATE VIEW v_persona_twin_supersede AS
WITH mt AS MATERIALIZED (
  SELECT id, CAST(substr(title, 16, instr(substr(title, 16), '-') - 1) AS INTEGER) AS tid
  FROM agent_issues WHERE status = 'open' AND title LIKE 'METRIC-TRIGGER-%'
), mx AS (SELECT tid, MAX(id) AS successor FROM mt GROUP BY tid)
SELECT x.id AS issue_id, x.program_code, x.tid, x.successor,
  'superseded by #' || x.successor || ': the same metric trigger ' || x.tid || ' was filed again (newer threshold or text); the newer issue carries the work (MANAGEMENT-PERSONAS-2)' AS evidence
FROM (
  SELECT mt.id, m.program_code, mt.tid, (SELECT mx.successor FROM mx WHERE mx.tid = mt.tid) AS successor
  FROM mt LEFT JOIN issue_project_map m ON m.issue_id = mt.id
) x
WHERE x.tid > 0 AND x.successor > x.id
  AND COALESCE((SELECT value FROM ops_config WHERE key = 'persona_actions'), 'on') <> 'off';
