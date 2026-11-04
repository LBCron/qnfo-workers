-- PROBE-BIRTH-CAP-1 (2026-11-04, charter pillar: cost). The birth path of the issue-probe-agent gets the hourly cap the hourly workflow already has.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261104_birth_trigger
-- Rollback: DROP TRIGGER IF EXISTS agent_issues_birth_contract_ins; then execute the sql column of bak_20261104_birth_trigger (the previous CREATE TRIGGER); UPDATE ops_config SET value = '1000' WHERE key = 'issue_probe_birth_per_hour';
-- CAUSE-MAPPED: registers no metric_registry row.
--
-- Why (Cloudflare GraphQL aiInferenceAdaptiveGroups and AI Gateway logs, read 2026-11-04): qnfo-agents on @cf/deepseek-ai/deepseek-v4.1-flash-1017
-- is the largest single Workers AI consumer, 1.20M neurons and 147.7M input tokens a day (about USD 13 a day, a third of the account's
-- USD 35-40 a day), and none of it is in ai_call_counters (counter coverage 37 percent, workers_ai_attribution_coverage_pct), so no cap saw it.
-- ISSUE-PROBE-CAP-1/2 and issue_probe_agent_per_hour = 2 bound the hourly workflow only. The agent_issues_birth_contract_ins trigger
-- (ISSUE-BIRTH-DOER-PROBE-1, migrations/2026-11-01-issue-birth-doer-probe.sql) also queues one probe-agent run for every issue at birth with no
-- count limit: cf_agent_requests shows 40, 54, 7, 4, 3, 23, 28 and 19 issue-probe-agent runs in the hours 09Z to 16Z of 2026-11-04, bursts of
-- six in one minute, while the Gateway logs show 120 to 360 deepseek-v4.1 calls an hour (1.7M to 12.8M input tokens) after the hourly cut to 2. A storm of
-- machine-filed tickets (CF-OBS-ISSUE-1, CRON-FAULT-1, BLINDSPOT-1, CHAOS-DRILL-FAILED-1) therefore buys one multi-turn agent run each,
-- about 230k input tokens and 1.9k neurons a run.
-- How: the same trigger, with one clause on its cf_agent_requests insert: at most ops_config issue_probe_birth_per_hour (default 2) probe-agent requests
-- are born in a rolling hour (counted over the newest 300 request ids, a rowid range read, not a table scan). An issue over the limit keeps its birth
-- contract and stays in v_issue_probe_intake, so the capped hourly workflow (issue_probe_agent_per_hour, ISSUE-PROBE-CAP-1/2) picks it up later; nothing is
-- dropped and no existing check is removed. Worst case becomes about 4 runs an hour (96 a day) against 600 a day measured.
-- Prediction: qnfo-agents deepseek-v4.1-flash-1017 neurons fall from about 1.2M to under 0.2M a day within 24 h (Gateway log calls per hour under 40).
-- Verify: GraphQL aiInferenceAdaptiveGroups by modelId for the day, or SELECT substr(created_at,1,13) h, COUNT(*) FROM cf_agent_requests
--   WHERE requester = 'issue-probe-agent' AND id > (SELECT MAX(id) - 300 FROM cf_agent_requests) GROUP BY h.

CREATE TABLE IF NOT EXISTS bak_20261104_birth_trigger AS
SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'trigger' AND name = 'agent_issues_birth_contract_ins';

INSERT OR IGNORE INTO ops_config (key, value, note, updated_at)
VALUES ('issue_probe_birth_per_hour', '2', 'PROBE-BIRTH-CAP-1 2026-11-04: most issue-probe-agent runs the issue-birth trigger may queue in a rolling hour (each run is about 230k input tokens). Issues over the limit wait for the capped hourly workflow. Revert: set to 1000.', datetime('now'));

DROP TRIGGER IF EXISTS agent_issues_birth_contract_ins;
CREATE TRIGGER agent_issues_birth_contract_ins AFTER INSERT ON agent_issues
WHEN NEW.status = 'open'
BEGIN
  INSERT OR IGNORE INTO issue_triage (issue_id, rc, triage_state, owner, sla_due_at)
  SELECT NEW.id, 'ISSUE-BIRTH-DOER-PROBE-1', 'triaged', owner, datetime('now')
  FROM v_issue_birth_owner WHERE issue_id = NEW.id;
  UPDATE issue_triage SET owner = (SELECT owner FROM v_issue_birth_owner WHERE issue_id = NEW.id),
    rc = 'ISSUE-BIRTH-DOER-PROBE-1'
  WHERE issue_id = NEW.id AND rc = 'AUTOTRIAGE-1' AND owner = 'qnfo-ops';
  INSERT OR IGNORE INTO remediation_contracts
    (class, issue_id, precondition, action, verify_probe, verify_transport,
     max_attempts, escalate_to, expected_cadence_h, status, module)
  SELECT 'issue-' || NEW.id, NEW.id, 'born with the issue (ORPHAN-GUARD-BIRTH-1)',
    'needs-machine-probe', 'needs-machine-probe', 'd1-query', 3, 'qnfo-fleet-control', 1,
    'needs-machine-probe', 'birth'
  WHERE NOT EXISTS (SELECT 1 FROM remediation_contracts WHERE issue_id = NEW.id);
  INSERT INTO cf_agent_requests (requester, kind, prompt, instance, priority)
  SELECT 'issue-probe-agent', 'run', prompt, 'probe-issue-' || issue_id, priority
  FROM v_issue_probe_intake WHERE issue_id = NEW.id
    AND COALESCE((SELECT value FROM ops_config WHERE key = 'issue_probe_agent'), 'on') <> 'off'
    AND NOT EXISTS (SELECT 1 FROM cf_agent_requests
                    WHERE requester = 'issue-probe-agent' AND instance = 'probe-issue-' || NEW.id)
    AND (SELECT COUNT(*) FROM cf_agent_requests
         WHERE id > (SELECT COALESCE(MAX(id), 0) FROM cf_agent_requests) - 300
           AND requester = 'issue-probe-agent'
           AND created_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-60 minutes'))
        < CAST(COALESCE((SELECT value FROM ops_config WHERE key = 'issue_probe_birth_per_hour'), '2') AS INTEGER);
  INSERT OR IGNORE INTO issue_probe_requests (issue_id, request_id, requested_at)
  SELECT NEW.id, id, created_at FROM cf_agent_requests
  WHERE requester = 'issue-probe-agent' AND instance = 'probe-issue-' || NEW.id
  ORDER BY id DESC LIMIT 1;
END;

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, surfaces_tested)
SELECT 'claude-code-session-2026-11-04-spend-enforce', 'A defect check written by an agent for every issue at birth is worth less than a bounded cost: the account is billed USD 35-40 a day against a USD 10 a day target and this loop is a third of it',
  'PROBE-BIRTH-CAP-1: the issue-birth trigger queues at most issue_probe_birth_per_hour (2) probe-agent runs a rolling hour',
  'Cloudflare GraphQL: deepseek-v4.1-flash-1017 3.27M neurons in 3 days with no ai_call_counters rows; cf_agent_requests: 178 issue-probe-agent runs 09Z-16Z on 2026-11-04 after per_hour was cut to 2; AI Gateway logs: qnfo-agents 120-360 calls an hour',
  'agent_issues_birth_contract_ins recreated with one extra clause', 'new-issue birth only; existing issues, contracts and the hourly workflow unchanged',
  'bak_20261104_birth_trigger holds the previous trigger SQL; or set ops_config issue_probe_birth_per_hour to 1000',
  'the probe agent cannot spend without bound on an issue storm', 'qnfo-agents deepseek-v4.1-flash-1017 neurons under 0.2M a day; issue-probe-agent requests under 100 a day', 'migrations/probe-birth-cap.test.mjs'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'PROBE-BIRTH-CAP-1:%');
