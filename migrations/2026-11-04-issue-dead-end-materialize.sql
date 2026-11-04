-- VIEW-MATERIALIZE-1 (2026-11-04, charter pillar autonomy; failure modes d1-like-pattern-length / probe-error contracts, D1 overload family).
-- Measured 2026-11-04 19:25Z on qnfo-audit: `SELECT COUNT(*) FROM v_issue_dead_end WHERE lane <> 'task-in-flight'` took 7.4 s and read 458,677 rows.
-- Cause: the view's code_task_status subquery (two leading-wildcard LIKEs over code_tasks) sits in a flattened derived table and is
-- re-evaluated for every outer reference (lane CASE reads it five times, plus the filter), so a 52-row result scanned code_tasks hundreds of times.
-- fm-open-issue-no-doer reads it hourly and probe-errors when the single-writer DB is busy (36 active issue/fm contracts read probe-error).
-- Change: the inner SELECT becomes a MATERIALIZED CTE, so each subquery runs once per issue. Same columns, same rows.
-- Tested: same CTE shape 1.0 s, 82,369 rows read (-82%, -86% time), 52 rows.
-- PREDICTION: SELECT COUNT(*) FROM v_issue_dead_end reads under 120000 rows and answers under 2 s.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261104_v_issue_dead_end
-- Rollback: DROP VIEW IF EXISTS v_issue_dead_end; then run the sql column of bak_20261104_v_issue_dead_end

CREATE TABLE IF NOT EXISTS bak_20261104_v_issue_dead_end AS
SELECT name, sql FROM sqlite_master WHERE name = 'v_issue_dead_end';

DROP VIEW IF EXISTS v_issue_dead_end;

CREATE VIEW v_issue_dead_end AS
WITH x AS MATERIALIZED (
  SELECT a.id AS issue_id, a.priority, a.source,
    CAST((CAST(strftime('%s', 'now') AS INTEGER) - a.created_at / 1000) / 60 AS INTEGER) AS age_min,
    c.class AS contract_class, c.status AS contract_status,
    CASE
      WHEN c.class IS NULL THEN 'no-contract'
      WHEN c.status = 'needs-machine-probe' THEN 'needs-machine-probe'
      WHEN instr(COALESCE(c.last_verdict, ''), 'superseded:probe-unusable') = 1 THEN 'probe-unusable'
      WHEN instr(COALESCE(c.last_verdict, ''), 'superseded:closure-observing') = 1 THEN 'closure-observing-probe'
      WHEN instr(COALESCE(c.last_verdict, ''), 'superseded:closure-superseded') = 1 THEN 'closure-superseded'
      ELSE COALESCE(c.status, 'unknown')
    END AS reason,
    CASE WHEN instr(COALESCE(a.description, ''), 'code-task:') > 0 THEN 1 ELSE 0 END AS has_code_task_line,
    (SELECT t.status FROM code_tasks t WHERE t.goal LIKE '%issue #' || a.id || ' %' OR t.goal LIKE '%issue #' || a.id || ']%'
       ORDER BY t.created_at DESC LIMIT 1) AS code_task_status,
    (SELECT p.outcome FROM issue_plans p WHERE p.issue_id = a.id) AS planner_outcome
  FROM agent_issues a
  LEFT JOIN remediation_contracts c ON c.class = (SELECT c0.class FROM remediation_contracts c0 WHERE c0.issue_id = a.id ORDER BY c0.ts DESC, c0.class DESC LIMIT 1)
  WHERE a.status = 'open' AND a.title NOT LIKE 'METRIC-TRIGGER-%'
    AND a.created_at < (CAST(strftime('%s', 'now') AS INTEGER) - 7200) * 1000
    AND NOT EXISTS (SELECT 1 FROM remediation_contracts k WHERE k.issue_id = a.id AND k.status IN ('active', 'holding'))
),
y AS MATERIALIZED (
  SELECT x.*,
    CASE
      WHEN x.code_task_status IS NOT NULL AND x.code_task_status NOT IN ('merged', 'failed', 'closed', 'superseded', 'needs_human') THEN 'task-in-flight'
      WHEN x.code_task_status = 'merged' THEN 'doer-merged-dod-unmeasured'
      WHEN x.code_task_status IS NOT NULL THEN 'task-ended'
      WHEN x.planner_outcome = 'untrusted' THEN 'planner-untrusted'
      WHEN x.planner_outcome IS NOT NULL THEN 'planner-' || x.planner_outcome
      ELSE 'unplanned'
    END AS lane
  FROM x
)
SELECT y.*,
  CASE WHEN y.lane = 'task-in-flight' THEN 'qnfo-code-orchestrator' ELSE 'probe-author' END AS next_actor
FROM y
ORDER BY CASE y.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, y.age_min DESC, y.issue_id;
