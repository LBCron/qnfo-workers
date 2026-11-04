-- ISSUE-PROBE-CAP-1 (2026-11-04): the issue-probe-agent asks about one issue at most twice, ever.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE fleet_tasks SET definition = replace(definition, ' AND (SELECT COUNT(*) FROM cf_agent_requests z WHERE z.requester = ''issue-probe-agent'' AND z.instance = ''probe-issue-'' || a.id) < CAST(COALESCE((SELECT value FROM ops_config WHERE key = ''issue_probe_max_attempts''), ''2'') AS INTEGER) /* probe-attempt-cap */', ''), version = version + 1 WHERE id = 'issue-probe-agent';
--
-- Why: docs/INFRA-AUDIT-2026-11-04.md measured issue-probe-agent as about 95% of the account's Workers AI input tokens (about 32k per
-- call, 1,624 runs in 9 days, one issue re-asked 28 times) while the AI-spend cap is breached. The 24-hour re-ask rule had no ceiling.
-- How: add one clause to the probe-request step: an issue with ops_config issue_probe_max_attempts (default 2) or more rows in
-- cf_agent_requests (the real request log, which INSERT OR REPLACE on issue_probe_requests cannot lose) is not asked again.
-- Prediction: issue-probe-agent calls fall to at most 2 per issue lifetime; deepseek-v4.1-flash-1017 input tokens stay down after the
-- per-hour cut (12 -> 2) is raised again. Verify with the same Cloudflare GraphQL aiInferenceAdaptiveGroups query.

INSERT OR IGNORE INTO ops_config (key, value, note)
VALUES ('issue_probe_max_attempts', '2', 'ISSUE-PROBE-CAP-1: most times the issue-probe-agent is asked about one issue');
UPDATE fleet_tasks
SET definition = replace(definition,
      'AND NOT EXISTS (SELECT 1 FROM issue_probe_requests q WHERE q.issue_id = a.id',
      'AND (SELECT COUNT(*) FROM cf_agent_requests z WHERE z.requester = ''issue-probe-agent'' AND z.instance = ''probe-issue-'' || a.id) < CAST(COALESCE((SELECT value FROM ops_config WHERE key = ''issue_probe_max_attempts''), ''2'') AS INTEGER) /* probe-attempt-cap */ AND NOT EXISTS (SELECT 1 FROM issue_probe_requests q WHERE q.issue_id = a.id'),
    version = version + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 'issue-probe-agent' AND instr(definition, '/* probe-attempt-cap */') = 0;
INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, surfaces_tested)
SELECT 'claude-code-session-2026-11-04', 'Two defect-check attempts per issue capture most of the value; further re-asks burn tokens against a breached AI-spend cap',
  'ISSUE-PROBE-CAP-1: issue-probe-agent asks at most issue_probe_max_attempts (2) times per issue',
  'docs/INFRA-AUDIT-2026-11-04.md: 1,624 runs in 9 days, one issue asked 28 times, about 95% of account input tokens', 'fleet_tasks issue-probe-agent definition amended',
  'issue-probe-agent request step only', 'migration Rollback line; or set ops_config issue_probe_max_attempts to 1000',
  'bounded AI spend for the probe loop', 'issue-probe-agent requests per issue <= 2; Workers AI input tokens down', 'migrations/issue-probe-agent.test.mjs'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'ISSUE-PROBE-CAP-1:%');
