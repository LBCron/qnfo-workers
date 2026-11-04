-- D1-READS-MONITOR-1 (QNFO.OPS, charter pillar cost/core): cut qnfo-audit rows_read from monitoring, probe and dispatch queries.
-- Measured 2026-11-04 (342M rows read in 3 h; 'D1 DB is overloaded' tickets are the symptom). Every change returns the same
-- result set as before; rows_read measured with the old and new statement on the live DB (read-only):
--   v_sla_bound_issue_age   196,271 -> 2,147  (same 320 ids): goals/objective_space were scanned once per open issue
--   breach-ticket-reopen    158,532 -> 965    (same MAX(id) 2758): LIKE 'METRIC-TRIGGER-'||s.id||'-%' cannot use the title index,
--                           the equivalent range title >= 'METRIC-TRIGGER-<id>-' AND title < 'METRIC-TRIGGER-<id>.' can
--   probe issue-1000639     ~330,000 -> ~20,000: the two LIKE '%x%' diagnostics scanned all of cloud_ops_events; they now read a window
--                           (the exact-kind count and MAX(ts) are unchanged and index-only)
--   v_issue_queue_v2        ~51,000 -> ~10,000 (estimate): the per-issue inferred_direction subquery scanned 65 rows per issue
-- The dashboard workerObservability() query is fixed in code (qnfo-fleet-dashboard), 526,826 -> 11,752 rows per run.
--
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261104_sla_bound_view
-- Rollback: DELETE FROM agent_issues WHERE title = 'D1-READS-MONITOR-1: bound the fleet_deploys NOT EXISTS in workerObservability' AND source = 'session:d1-monitor-reads'; DROP INDEX IF EXISTS idx_inferred_direction_dir_day; DROP VIEW IF EXISTS v_sla_bound_issue_age; CREATE VIEW v_sla_bound_issue_age AS SELECT a.id, a.priority, a.title, a.age_min, i.category FROM v_issue_age a JOIN agent_issues i ON i.id = a.id WHERE a.age_min >= 120 AND lower(trim(COALESCE(i.category, ''))) IN ('defect', 'incident', 'reliability') AND i.title NOT LIKE 'METRIC-TRIGGER-%' AND NOT EXISTS (SELECT 1 FROM goals g WHERE g.source = 'agent_issues:' || i.id OR g.source LIKE 'agent_issues:' || i.id || ' (%' OR g.source = 'agent_issues ' || i.id OR g.source LIKE 'agent_issues ' || i.id || ' (%') AND NOT EXISTS (SELECT 1 FROM objective_space o WHERE o.source = 'agent_issues:' || i.id OR o.source LIKE 'agent_issues:' || i.id || ' (%' OR o.source = 'agent_issues ' || i.id OR o.source LIKE 'agent_issues ' || i.id || ' (%'); UPDATE fleet_tasks SET definition = replace(replace(definition, 'a.title >= ''METRIC-TRIGGER-'' || s.id || ''-'' AND a.title < ''METRIC-TRIGGER-'' || s.id || ''.''', 'a.title LIKE ''METRIC-TRIGGER-'' || s.id || ''-%'''), 'o.title >= ''METRIC-TRIGGER-'' || s.id || ''-'' AND o.title < ''METRIC-TRIGGER-'' || s.id || ''.''', 'o.title LIKE ''METRIC-TRIGGER-'' || s.id || ''-%'''), version = version + 1, updated_at = datetime('now') WHERE id = 'breach-ticket-reopen'; UPDATE remediation_contracts SET verify_probe = replace(replace(replace(replace(verify_probe, 'WHERE kind LIKE ''%surface%'' AND ts >= date(''now'', ''-1 day'')', 'WHERE kind LIKE ''%surface%'''), 'WHERE kind LIKE ''%codemode%'' AND ts >= date(''now'', ''-1 day'')', 'WHERE kind LIKE ''%codemode%'''), '(kinds matching %surface% in last 2 days: ', '(kinds matching %surface%: '), ', %codemode% in last 2 days: ', ', %codemode%: ') WHERE class = 'issue-1000639';
-- Closing probe (after CI apply): SELECT COUNT(*) FROM migration_runs WHERE file LIKE '%d1-monitor-probe-reads%' AND status = 'ok'

-- 1. v_issue_queue_v2 reads inferred_direction per open issue by direction; the UNIQUE(day, direction) key leads with day.
CREATE INDEX IF NOT EXISTS idx_inferred_direction_dir_day ON inferred_direction (direction, day, confidence);

-- 2. v_sla_bound_issue_age: build the set of issue ids named by goals/objective_space once, instead of scanning both tables per issue.
CREATE TABLE IF NOT EXISTS bak_20261104_sla_bound_view AS
  SELECT name, sql FROM sqlite_master WHERE name = 'v_sla_bound_issue_age';
DROP VIEW IF EXISTS v_sla_bound_issue_age;
CREATE VIEW v_sla_bound_issue_age AS
SELECT a.id, a.priority, a.title, a.age_min, i.category
FROM v_issue_age a
JOIN agent_issues i ON i.id = a.id
WHERE a.age_min >= 120
  AND lower(trim(COALESCE(i.category, ''))) IN ('defect', 'incident', 'reliability')
  AND i.title NOT LIKE 'METRIC-TRIGGER-%'
  AND i.id NOT IN (
    SELECT CAST(substr(r.source, 14) AS INTEGER)
    FROM (SELECT source FROM goals UNION ALL SELECT source FROM objective_space) r
    WHERE (r.source LIKE 'agent_issues:%' OR r.source LIKE 'agent_issues %')
      AND (substr(r.source, 14) = CAST(CAST(substr(r.source, 14) AS INTEGER) AS TEXT)
           OR substr(r.source, 14) LIKE CAST(CAST(substr(r.source, 14) AS INTEGER) AS TEXT) || ' (%')
  );

-- 3. breach-ticket-reopen (every 10 minutes): title prefix as a range so idx_agent_issues_title / the open-title index are used.
UPDATE fleet_tasks SET
  definition = replace(replace(definition,
    'a.title LIKE ''METRIC-TRIGGER-'' || s.id || ''-%''',
    'a.title >= ''METRIC-TRIGGER-'' || s.id || ''-'' AND a.title < ''METRIC-TRIGGER-'' || s.id || ''.'''),
    'o.title LIKE ''METRIC-TRIGGER-'' || s.id || ''-%''',
    'o.title >= ''METRIC-TRIGGER-'' || s.id || ''-'' AND o.title < ''METRIC-TRIGGER-'' || s.id || ''.'''),
  version = version + 1, updated_at = datetime('now')
WHERE id = 'breach-ticket-reopen';

-- 4. CODEMODE-SURFACE-1 probe (issue-1000639): bound the two LIKE '%x%' diagnostics to a window; exact count and MAX(ts) unchanged.
UPDATE remediation_contracts SET verify_probe = replace(replace(replace(replace(verify_probe,
    'WHERE kind LIKE ''%surface%''', 'WHERE kind LIKE ''%surface%'' AND ts >= date(''now'', ''-1 day'')'),
    'WHERE kind LIKE ''%codemode%''', 'WHERE kind LIKE ''%codemode%'' AND ts >= date(''now'', ''-1 day'')'),
    '(kinds matching %surface%: ', '(kinds matching %surface% in last 2 days: '),
    ', %codemode%: ', ', %codemode% in last 2 days: ')
WHERE class = 'issue-1000639';

-- 5. workerObservability() in qnfo-fleet-dashboard (30.8M rows / 3 h): the file is claimed by the code loop, so the edit goes to a doer.
INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT
 'D1-READS-MONITOR-1: bound the fleet_deploys NOT EXISTS in workerObservability',
 'QNFO.OPS; charter pillar cost. workerObservability() in qnfo-fleet-dashboard/worker.js runs 257 times in 3 h and reads 526,826 rows per run, because the NOT EXISTS over fleet_deploys reads every ok deploy of the worker (idx_fdeploy_worker_ok) and only then compares julianday(f.ts) to seen_ms. Add the sargable conjunct `AND f.ts >= strftime(''%Y-%m-%d'', x.seen_ms / 1000, ''unixepoch'')` directly after `f.ok = 1` (every fleet_deploys.ts starts with a YYYY-MM-DD date; the exact julianday test stays, so the result is identical: 0 differences over 191,903 rows read on the live DB; 11,752 rows per run instead of 526,826). Bump the dashboard VERSION and keep deployed-current.worker.js identical.' || char(10) ||
 'code-task: repo=qnfo-workers path=qnfo-fleet-dashboard/worker.js' || char(10) ||
 'code-anchor: f.worker = x.svc AND f.ok = 1 AND COALESCE(' || char(10) ||
 'code-probe: {"paths":["qnfo-fleet-dashboard/worker.js"],"contains":"f.ts >= strftime(''%Y-%m-%d'', x.seen_ms / 1000, ''unixepoch'')"}',
 'session:d1-monitor-reads', 'code', 'high', 'open', unixepoch() * 1000, unixepoch() * 1000
WHERE NOT EXISTS (
 SELECT 1 FROM agent_issues WHERE title = 'D1-READS-MONITOR-1: bound the fleet_deploys NOT EXISTS in workerObservability' AND status = 'open'
);
