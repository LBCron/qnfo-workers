-- OUTPUT-QUALITY-REMEDIATION-COHORT-1, charter pillar reach; fixes QNFO/qnfo-workers#5412 (agent_issues 1000621).
-- The pool fell 80.8 -> 68.6 while matched subjects improved 41.1 -> 44.2 (issue lever review, 2026-11-02).
-- Compare latest verdicts for the SAME subjects in two adjacent seven-day windows ending on the latest snapshot day.
-- Keep the all-subject remediation_latest_pass_pct_7d guard, its history, thresholds and failed verifications unchanged.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261103_output_quality_verdict
-- Rollback: DROP VIEW IF EXISTS v_output_quality_verdict; CREATE VIEW v_output_quality_verdict AS SELECT m.metric, m.surface, m.role, m.polarity, m.judged_by, m.caveat, n.day AS now_day, n.value AS now_value, p.day AS prev_day, p.value AS prev_value, CASE WHEN n.value IS NULL OR p.value IS NULL THEN 'insufficient_history' WHEN n.day < date('now', '-2 days') THEN 'stale' WHEN ABS(n.value - p.value) <= MAX(m.tol_abs, m.tol_rel * ABS(p.value)) THEN 'flat' WHEN (n.value - p.value) * m.polarity > 0 THEN 'better' ELSE 'worse' END AS moved FROM output_quality_measures m LEFT JOIN metric_history n ON n.metric = m.metric AND n.day = (SELECT MAX(day) FROM metric_history WHERE metric = m.metric) LEFT JOIN metric_history p ON p.metric = m.metric AND p.day = (SELECT MAX(day) FROM metric_history WHERE metric = m.metric AND day <= date(n.day, '-7 days')); DROP VIEW IF EXISTS v_output_quality_remediation_cohort; UPDATE output_quality_measures SET caveat = (SELECT caveat FROM bak_20261103_output_quality_verdict) WHERE metric = 'remediation_latest_pass_pct_7d'; DELETE FROM remediation_contracts WHERE class = 'fm-output-quality-remediation-cohort'; DELETE FROM failure_modes WHERE fm_key = 'output-quality-remediation-cohort';

CREATE TABLE IF NOT EXISTS bak_20261103_output_quality_verdict (sql TEXT, caveat TEXT);
INSERT INTO bak_20261103_output_quality_verdict
SELECT sql, (SELECT caveat FROM output_quality_measures WHERE metric = 'remediation_latest_pass_pct_7d')
FROM sqlite_master WHERE name = 'v_output_quality_verdict'
AND NOT EXISTS (SELECT 1 FROM bak_20261103_output_quality_verdict);

CREATE VIEW IF NOT EXISTS v_output_quality_remediation_cohort AS
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

DROP VIEW IF EXISTS v_output_quality_verdict;
CREATE VIEW v_output_quality_verdict AS
WITH comparisons AS (
  SELECT m.*,
         n.day AS now_day,
         CASE WHEN m.metric = 'remediation_latest_pass_pct_7d' THEN c.now_value ELSE n.value END AS now_value,
         CASE WHEN m.metric = 'remediation_latest_pass_pct_7d' THEN c.prev_day ELSE p.day END AS prev_day,
         CASE WHEN m.metric = 'remediation_latest_pass_pct_7d' THEN c.prev_value ELSE p.value END AS prev_value
  FROM output_quality_measures m
  LEFT JOIN metric_history n ON n.metric = m.metric AND n.day = (SELECT MAX(day) FROM metric_history WHERE metric = m.metric)
  LEFT JOIN metric_history p ON p.metric = m.metric AND p.day = (SELECT MAX(day) FROM metric_history WHERE metric = m.metric AND day <= date(n.day, '-7 days'))
  LEFT JOIN v_output_quality_remediation_cohort c ON m.metric = 'remediation_latest_pass_pct_7d'
)
SELECT metric, surface, role, polarity, judged_by, caveat, now_day, now_value, prev_day, prev_value,
       CASE
         WHEN now_value IS NULL OR prev_value IS NULL THEN 'insufficient_history'
         WHEN now_day < date('now', '-2 days') THEN 'stale'
         WHEN ABS(now_value - prev_value) <= MAX(tol_abs, tol_rel * ABS(prev_value)) THEN 'flat'
         WHEN (now_value - prev_value) * polarity > 0 THEN 'better'
         ELSE 'worse'
       END AS moved
FROM comparisons;

UPDATE output_quality_measures
SET caveat = 'Trend compares latest verdicts for matched subjects in adjacent seven-day windows; no overlap is insufficient_history. The all-subject integrity guard remains unchanged. A probe the fixer wrote can be weak.'
WHERE metric = 'remediation_latest_pass_pct_7d';

INSERT OR IGNORE INTO failure_modes
  (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id)
VALUES ('output-quality-remediation-cohort', 'New verification subjects create a false output-quality regression',
  'Comparing pool pass rates changes the denominator between windows even when matched subjects improve',
  'Compare matched-subject latest verdicts in v_output_quality_remediation_cohort; retain the all-subject integrity guard',
  'Verify the output-quality verdict uses its matched-subject comparison', 'fm-output-quality-remediation-cohort',
  '2026-11-03', 1000621);

INSERT OR IGNORE INTO remediation_contracts
  (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module)
VALUES ('fm-output-quality-remediation-cohort', NULL, 'SELECT 1 AS ready',
  'Observe only; restore the matched-subject output-quality comparison through a CI migration if missing',
  'SELECT CASE WHEN instr(sql, ''v_output_quality_remediation_cohort'') > 0 THEN ''ok'' ELSE ''missing'' END AS status FROM sqlite_master WHERE name = ''v_output_quality_verdict''',
  'd1-query', 3, 'qnfo-fleet-control', 1, 'active', 'verification');

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'copilot-6506', 'Pool pass-rate changes can reflect new verification subjects rather than relapse',
  'OUTPUT-QUALITY-REMEDIATION-COHORT-1: compare matched remediation subjects for output quality',
  'Issue 1000621 lever review: pool 80.8 -> 68.6, matched subjects 41.1 -> 44.2; read-only pre-deploy query on 2026-11-03: 1330 matched subjects, 82.4 -> 85.9',
  'Pending canonical migration and two output_quality_outcomes_worse refreshes at zero; no issue closed by this migration',
  'v_output_quality_verdict remediation comparison only; all-subject integrity guard unchanged',
  'Execute this migration Rollback line; original view and caveat retained in bak_20261103_output_quality_verdict',
  'Distinguish verification-cohort churn from genuine remediation relapse',
  'New-only subjects do not change the trend; matched pass-to-fail changes still register as worse',
  'Honest output-quality attribution without hiding failed probes',
  'Offline SQLite regression, rollback and read-only live cohort query'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action = 'OUTPUT-QUALITY-REMEDIATION-COHORT-1: compare matched remediation subjects for output quality');
