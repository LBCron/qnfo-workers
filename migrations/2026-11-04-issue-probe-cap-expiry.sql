-- ISSUE-PROBE-CAP-2 (2026-11-04): the attempt cap of ISSUE-PROBE-CAP-1 expires, so a capped issue is asked once more each week.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE fleet_tasks SET definition = replace(replace(definition, ' OR NOT EXISTS (SELECT 1 FROM cf_agent_requests y WHERE y.requester = ''issue-probe-agent'' AND y.instance = ''probe-issue-'' || a.id AND y.created_at > strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-'' || COALESCE((SELECT value FROM ops_config WHERE key = ''issue_probe_retry_days''), ''7'') || '' days'')) ) /* probe-retry-7d */', ''), 'AND ((SELECT COUNT(*) FROM cf_agent_requests z', 'AND (SELECT COUNT(*) FROM cf_agent_requests z'), version = version + 1 WHERE id = 'issue-probe-agent';
--
-- Why: measured 2026-11-04 after ISSUE-PROBE-CAP-1 merged: 41 open issues had two or more probe requests and no active, monitoring or
-- holding contract, so the cap alone left them with no check and no doer for good (a hold with no expiry; ANTIFRAGILE-1, OWNER-NO-LOOSE-ENDS-1).
-- How: the cap clause becomes (attempts < issue_probe_max_attempts OR no request for the issue in the last issue_probe_retry_days days).
-- Worst case is one ask per issue per week, not the 28 asks the audit measured, and not none.
-- Prediction: open issues with 2+ asks and no live contract fall below 41 within 14 days while probe-agent input tokens stay down.

INSERT OR IGNORE INTO ops_config (key, value, note)
VALUES ('issue_probe_retry_days', '7', 'ISSUE-PROBE-CAP-2: days after which an issue at the attempt cap is asked once more');
UPDATE fleet_tasks
SET definition = replace(replace(definition,
      'AND (SELECT COUNT(*) FROM cf_agent_requests z',
      'AND ((SELECT COUNT(*) FROM cf_agent_requests z'),
      '/* probe-attempt-cap */',
      ' OR NOT EXISTS (SELECT 1 FROM cf_agent_requests y WHERE y.requester = ''issue-probe-agent'' AND y.instance = ''probe-issue-'' || a.id AND y.created_at > strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-'' || COALESCE((SELECT value FROM ops_config WHERE key = ''issue_probe_retry_days''), ''7'') || '' days'')) ) /* probe-attempt-cap */ /* probe-retry-7d */'),
    version = version + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 'issue-probe-agent' AND instr(definition, '/* probe-attempt-cap */') > 0 AND instr(definition, '/* probe-retry-7d */') = 0;
INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, surfaces_tested)
SELECT 'claude-code-session-2026-11-04', 'A cap without an expiry strands issues with no check and no doer; one ask a week keeps cost near the capped level',
  'ISSUE-PROBE-CAP-2: the probe attempt cap lapses after issue_probe_retry_days (7)',
  'qnfo-audit read 2026-11-04: 41 open issues with 2+ probe asks and no live contract after ISSUE-PROBE-CAP-1', 'fleet_tasks issue-probe-agent definition amended',
  'issue-probe-agent request step only', 'migration Rollback line; or set ops_config issue_probe_retry_days to 100000',
  'capped issues are retried instead of stranded', 'open issues with 2+ asks and no live contract < 41 within 14 days; probe-agent input tokens stay down', 'migrations/issue-probe-attempt-cap.test.mjs'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'ISSUE-PROBE-CAP-2:%');
