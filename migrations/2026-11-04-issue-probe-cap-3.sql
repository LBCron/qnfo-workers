-- ISSUE-PROBE-CAP-3 (2026-11-04): put the attempt cap on the probe-request step that is actually live.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE fleet_tasks SET definition = replace(definition, 'AND ((SELECT COUNT(*) FROM cf_agent_requests z WHERE z.requester = ''issue-probe-agent'' AND z.instance = ''probe-issue-'' || v.issue_id) < CAST(COALESCE((SELECT value FROM ops_config WHERE key = ''issue_probe_max_attempts''), ''2'') AS INTEGER) OR NOT EXISTS (SELECT 1 FROM cf_agent_requests y WHERE y.requester = ''issue-probe-agent'' AND y.instance = ''probe-issue-'' || v.issue_id AND y.created_at > strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-'' || COALESCE((SELECT value FROM ops_config WHERE key = ''issue_probe_retry_days''), ''7'') || '' days''))) /* probe-attempt-cap-3 */ ', ''), version = version + 1 WHERE id = 'issue-probe-agent'; DROP INDEX IF EXISTS idx_cf_agent_requests_probe_cap;
--
-- Why (measured 2026-11-04 from qnfo-audit, not assumed): ISSUE-PROBE-CAP-1 and CAP-2 never took effect. Their migrations ran, but both match
-- the October workflow text (issue_probe_requests q ... = a.id), and ISSUE-BIRTH-DOER-PROBE-1 (2026-11-01) had already rewritten the
-- probe-request step to read v_issue_probe_intake (... = v.issue_id). The UPDATE matched no row, so fleet_tasks issue-probe-agent stayed at
-- version 5 with no cap marker while the agent was asked 23 to 28 times an hour. That step also re-asks an issue every 120 minutes, which is
-- the real driver of the 28-asks-per-issue pattern in docs/INFRA-AUDIT-2026-11-04.md.
-- How: the cap goes on the live text. An issue is asked while it has fewer than issue_probe_max_attempts (2) requests, or when its newest
-- request is older than issue_probe_retry_days (7): one ask a week at the worst, never none (a cap with no expiry strands issues).
-- idx_cf_agent_requests_probe_cap keeps the per-issue count off a full scan of cf_agent_requests (D1-OVERLOAD: rows_read is the cost).
-- Prediction: issue-probe-agent asks fall from about 25 an hour to at most the per_hour batch for issues under the cap, then to about zero
-- for capped issues; verify with SELECT substr(created_at,1,13), COUNT(*) FROM cf_agent_requests WHERE requester = 'issue-probe-agent'
-- GROUP BY 1 and with fleet_tasks.definition containing 'probe-attempt-cap-3'.

CREATE INDEX IF NOT EXISTS idx_cf_agent_requests_probe_cap ON cf_agent_requests (requester, instance, created_at);
INSERT OR IGNORE INTO ops_config (key, value, note) VALUES
  ('issue_probe_max_attempts', '2', 'ISSUE-PROBE-CAP-1/3: most times the issue-probe-agent is asked about one issue before the retry window'),
  ('issue_probe_retry_days', '7', 'ISSUE-PROBE-CAP-2/3: days after which an issue at the attempt cap is asked once more');
UPDATE fleet_tasks
SET definition = replace(definition,
      'AND NOT EXISTS (SELECT 1 FROM issue_probe_requests q WHERE q.issue_id = v.issue_id',
      'AND ((SELECT COUNT(*) FROM cf_agent_requests z WHERE z.requester = ''issue-probe-agent'' AND z.instance = ''probe-issue-'' || v.issue_id) < CAST(COALESCE((SELECT value FROM ops_config WHERE key = ''issue_probe_max_attempts''), ''2'') AS INTEGER) OR NOT EXISTS (SELECT 1 FROM cf_agent_requests y WHERE y.requester = ''issue-probe-agent'' AND y.instance = ''probe-issue-'' || v.issue_id AND y.created_at > strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-'' || COALESCE((SELECT value FROM ops_config WHERE key = ''issue_probe_retry_days''), ''7'') || '' days''))) /* probe-attempt-cap-3 */ AND NOT EXISTS (SELECT 1 FROM issue_probe_requests q WHERE q.issue_id = v.issue_id'),
    version = version + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 'issue-probe-agent' AND instr(definition, 'FROM v_issue_probe_intake v') > 0 AND instr(definition, '/* probe-attempt-cap-3 */') = 0;
INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, surfaces_tested)
SELECT 'claude-code-session-2026-11-04', 'Correction: the ISSUE-PROBE-CAP-1 and CAP-2 decision_log rows say the cap was installed; it was not (the replace matched the superseded October text)',
  'ISSUE-PROBE-CAP-3: the attempt cap and its 7-day expiry go on the live v_issue_probe_intake probe-request step',
  'qnfo-audit read 2026-11-04: fleet_tasks issue-probe-agent version 5, updated_at 2026-11-04T15:12:19Z, no cap marker; 23 to 28 asks an hour', 'fleet_tasks issue-probe-agent definition amended, index added',
  'issue-probe-agent request step only', 'migration Rollback line; or set ops_config issue_probe_max_attempts to 100000',
  'the probe loop is bounded in spend and strands no issue', 'asks per hour fall; capped issues asked at most weekly', 'migrations/issue-birth-doer-probe.test.mjs'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'ISSUE-PROBE-CAP-3:%');
-- A change that "works after the deploy" carries its own closing probe (METRIC-CLOSED-LOOP-1): CAP-1 and CAP-2 had none, which is how they
-- stayed uninstalled unnoticed. The remediation tick runs this and closes the issue only when the cap text is live and the agent's asks have fallen.
INSERT INTO agent_issues (title, description, source, priority, status)
SELECT 'ISSUE-PROBE-CAP-3: the issue-probe-agent attempt cap must be live in fleet_tasks',
 'Charter pillar: cost. migrations/2026-11-04-issue-probe-cap-3.sql puts the per-issue attempt cap (2, expiring after 7 days) on the live probe-request step; CAP-1 and CAP-2 matched superseded text and changed nothing.
Closing probe (d1-query): SELECT ''yes'' AS expected, CASE WHEN (SELECT instr(definition, ''probe-attempt-cap-3'') FROM fleet_tasks WHERE id = ''issue-probe-agent'') > 0 THEN ''yes'' ELSE ''no'' END AS observed
code-probe: {"paths":["migrations/2026-11-04-issue-probe-cap-3.sql"],"contains":"probe-attempt-cap-3"}',
 'session:probe-cap-3', 'high', 'open'
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title = 'ISSUE-PROBE-CAP-3: the issue-probe-agent attempt cap must be live in fleet_tasks');
