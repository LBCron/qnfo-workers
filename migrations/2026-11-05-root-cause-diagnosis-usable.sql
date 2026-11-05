-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_rc_diagnosis_tasks
-- Rollback: UPDATE fleet_tasks SET definition = (SELECT b.definition FROM bak_20261105_rc_diagnosis_tasks b WHERE b.id = fleet_tasks.id), version = version + 1 WHERE id = 'management-personas'; UPDATE persona_actions SET to_value = 'reported' WHERE id IN (SELECT id FROM bak_20261105_rc_diagnosis_actions); DROP VIEW IF EXISTS v_root_cause_diagnosis; DELETE FROM remediation_contracts WHERE class = 'fm-root-cause-diagnosis-preface'; DELETE FROM failure_modes WHERE fm_key = 'root-cause-diagnosis-preface'
-- ROOT-CAUSE-DIAGNOSIS-USABLE-1 (2026-11-05, charter pillar autonomy; ROOT-CAUSE-1 tickets 1000892 (GitHub 5404), 1001198 (6015), 1001220 (6040), 1001522 (6781), 1001621 (6876)).
-- Why a ROOT-CAUSE-1 ticket "keeps recurring" without its cause being found: the management-personas step rc-agent-request asks the Cloudflare agent once per ticket to name the
-- producer, the closing probe, why they disagree and the smallest change, and treats ANY answer that is not empty or tool-call markup as the diagnosis. Read from qnfo-audit on 2026-11-05:
-- of the 8 newest tickets (1001198, 1001220, 1001307, 1001387, 1001401, 1001522, 1001621, 1001847) 6 hold exactly one request whose whole answer is the agent's opening
-- narration ("I'll start by reading the audit data for this issue family." 59 characters, "Now the contracts, the metrics named in the open family issues, and the lifecycle counts."
-- 89, "Now the migration that owns the probe step." 113) with status done; the retry rule (at most 6 requests, 3 a tick) never fires for them because the answer is not empty, and
-- rc-agent-report appended such a line to 1001220 as its diagnosis. The tickets then wait for the family to go quiet, with no named cause: 1000892's own diagnosis (1729 characters, the
-- only usable one of the five tickets in this cluster) said the closing probe was weaker than the SLO failure and was never acted on either, but at least it existed.
-- Same family as FM-1 of migrations/2026-10-28-cluster-e-c-failure-modes.sql (markup answers). Changes (one component, versioned, backed up):
--   1. management-personas v+1: rc-agent-request, rc-agent-report and rc-agent-mark count an answer as a diagnosis only when it holds at least 400 characters (a real answer to the
--      prompt is 600 to 2000; the three preface lines are 59 to 113), so a narration line is re-asked, 3 a tick and 6 per ticket at most, as before; empty and failed answers are
--      re-asked too (they were counted as answered). The prompt tells the agent the reply must start with ROOT-CAUSE-DIAGNOSIS: and that a reply that only announces what it will read is discarded.
--   2. open ROOT-CAUSE-1 tickets whose persona row says 'reported' but whose requests hold no usable answer are set back to 'requested', so the next usable answer is appended.
--   3. v_root_cause_diagnosis: per open ROOT-CAUSE-1 ticket, its requests and its usable answers (the outcome measure), and the failure mode root-cause-diagnosis-preface with its detector
--      (the rule stays in the live definition; the outcome is the view).
-- Prediction: within 24 h of the apply every open ROOT-CAUSE-1 ticket older than 6 h has at least one usable answer (usable >= 1 in the view) or six requests; requests stay at most
-- 3 per tick, about 18 per ticket. Guard: cf_agent_requests per hour does not rise above 3 per tick; open_agent_issues does not rise (nothing here files an issue).
-- Rollback restores the definition and the persona rows; the view, failure mode and detector are dropped.

CREATE TABLE IF NOT EXISTS bak_20261105_rc_diagnosis_tasks AS SELECT id, definition, version FROM fleet_tasks WHERE id = 'management-personas';
CREATE TABLE IF NOT EXISTS bak_20261105_rc_diagnosis_actions AS
SELECT id, issue_id, to_value FROM persona_actions
WHERE kind = 'agent-diagnose' AND to_value = 'reported'
  AND issue_id IN (SELECT a.id FROM agent_issues a WHERE a.status = 'open' AND a.title LIKE 'ROOT-CAUSE-1:%')
  AND NOT EXISTS (SELECT 1 FROM cf_agent_requests r WHERE r.instance = 'root-cause-' || persona_actions.issue_id AND r.status IN ('done', 'failed', 'error') AND length(COALESCE(r.result, '')) >= 400
                  AND COALESCE(r.result, '') NOT LIKE '(the model returned no text)%' AND COALESCE(r.result, '') NOT LIKE '%tool_call%' AND COALESCE(r.result, '') NOT LIKE '%<invoke%'
                  AND COALESCE(r.result, '') NOT LIKE '%<function_calls%' AND COALESCE(r.result, '') NOT LIKE '%DSML%');

-- 1. Every fragment must occur exactly once or nothing is written (a concurrent edit of the workflow leaves it as it is).
UPDATE fleet_tasks SET
  definition = replace(replace(replace(replace(definition,
    'NOT LIKE ''%DSML%'') AND (SELECT COUNT(*) FROM cf_agent_requests q WHERE q.instance = ''root-cause-'' || a.id) < 6',
    'NOT LIKE ''%DSML%'' AND length(COALESCE(r.result, '''')) >= 400) AND (SELECT COUNT(*) FROM cf_agent_requests q WHERE q.instance = ''root-cause-'' || a.id) < 6'),
    'r.instance = ''root-cause-'' || agent_issues.id AND r.status IN (''done'', ''failed'', ''error'') AND COALESCE(r.result, '''') NOT LIKE ''(the model returned no text)%'' AND COALESCE(r.result, '''') NOT LIKE ''%tool_call%'' AND COALESCE(r.result, '''') NOT LIKE ''%<invoke%'' AND COALESCE(r.result, '''') NOT LIKE ''%<function_calls%'' AND COALESCE(r.result, '''') NOT LIKE ''%DSML%''',
    'r.instance = ''root-cause-'' || agent_issues.id AND r.status IN (''done'', ''failed'', ''error'') AND COALESCE(r.result, '''') NOT LIKE ''(the model returned no text)%'' AND COALESCE(r.result, '''') NOT LIKE ''%tool_call%'' AND COALESCE(r.result, '''') NOT LIKE ''%<invoke%'' AND COALESCE(r.result, '''') NOT LIKE ''%<function_calls%'' AND COALESCE(r.result, '''') NOT LIKE ''%DSML%'' AND length(COALESCE(r.result, '''')) >= 400'),
    'r.instance = ''root-cause-'' || persona_actions.issue_id AND r.status IN (''done'', ''failed'', ''error'') AND COALESCE(r.result, '''') NOT LIKE ''(the model returned no text)%'' AND COALESCE(r.result, '''') NOT LIKE ''%tool_call%'' AND COALESCE(r.result, '''') NOT LIKE ''%<invoke%'' AND COALESCE(r.result, '''') NOT LIKE ''%<function_calls%'' AND COALESCE(r.result, '''') NOT LIKE ''%DSML%''',
    'r.instance = ''root-cause-'' || persona_actions.issue_id AND r.status IN (''done'', ''failed'', ''error'') AND COALESCE(r.result, '''') NOT LIKE ''(the model returned no text)%'' AND COALESCE(r.result, '''') NOT LIKE ''%tool_call%'' AND COALESCE(r.result, '''') NOT LIKE ''%<invoke%'' AND COALESCE(r.result, '''') NOT LIKE ''%<function_calls%'' AND COALESCE(r.result, '''') NOT LIKE ''%DSML%'' AND length(COALESCE(r.result, '''')) >= 400'),
    'file one agent_issues row with a code-task line.'', ''root-cause-'' || a.id,',
    'file one agent_issues row with a code-task line. Your final reply must be the diagnosis itself, at least four sentences, beginning with the line ROOT-CAUSE-DIAGNOSIS: ; a reply that only says what you are about to read is discarded and you are asked again.'', ''root-cause-'' || a.id,'),
  version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 'management-personas' AND json_valid(definition)
  AND instr(definition, 'AND length(COALESCE(r.result, '''')) >= 400') = 0
  AND length(definition) - length(replace(definition, 'NOT LIKE ''%DSML%'') AND (SELECT COUNT(*) FROM cf_agent_requests q WHERE q.instance = ''root-cause-'' || a.id) < 6', '')) = length('NOT LIKE ''%DSML%'') AND (SELECT COUNT(*) FROM cf_agent_requests q WHERE q.instance = ''root-cause-'' || a.id) < 6')
  AND length(definition) - length(replace(definition, 'r.instance = ''root-cause-'' || agent_issues.id AND r.status IN (''done'', ''failed'', ''error'') AND COALESCE(r.result, '''') NOT LIKE ''(the model returned no text)%'' AND COALESCE(r.result, '''') NOT LIKE ''%tool_call%'' AND COALESCE(r.result, '''') NOT LIKE ''%<invoke%'' AND COALESCE(r.result, '''') NOT LIKE ''%<function_calls%'' AND COALESCE(r.result, '''') NOT LIKE ''%DSML%''', '')) = length('r.instance = ''root-cause-'' || agent_issues.id AND r.status IN (''done'', ''failed'', ''error'') AND COALESCE(r.result, '''') NOT LIKE ''(the model returned no text)%'' AND COALESCE(r.result, '''') NOT LIKE ''%tool_call%'' AND COALESCE(r.result, '''') NOT LIKE ''%<invoke%'' AND COALESCE(r.result, '''') NOT LIKE ''%<function_calls%'' AND COALESCE(r.result, '''') NOT LIKE ''%DSML%''')
  AND length(definition) - length(replace(definition, 'r.instance = ''root-cause-'' || persona_actions.issue_id AND r.status IN (''done'', ''failed'', ''error'') AND COALESCE(r.result, '''') NOT LIKE ''(the model returned no text)%'' AND COALESCE(r.result, '''') NOT LIKE ''%tool_call%'' AND COALESCE(r.result, '''') NOT LIKE ''%<invoke%'' AND COALESCE(r.result, '''') NOT LIKE ''%<function_calls%'' AND COALESCE(r.result, '''') NOT LIKE ''%DSML%''', '')) = length('r.instance = ''root-cause-'' || persona_actions.issue_id AND r.status IN (''done'', ''failed'', ''error'') AND COALESCE(r.result, '''') NOT LIKE ''(the model returned no text)%'' AND COALESCE(r.result, '''') NOT LIKE ''%tool_call%'' AND COALESCE(r.result, '''') NOT LIKE ''%<invoke%'' AND COALESCE(r.result, '''') NOT LIKE ''%<function_calls%'' AND COALESCE(r.result, '''') NOT LIKE ''%DSML%''')
  AND length(definition) - length(replace(definition, 'file one agent_issues row with a code-task line.'', ''root-cause-'' || a.id,', '')) = length('file one agent_issues row with a code-task line.'', ''root-cause-'' || a.id,');

-- 2. persona rows of tickets whose stored answer is unusable are asked again
UPDATE persona_actions SET to_value = 'requested'
WHERE id IN (SELECT id FROM bak_20261105_rc_diagnosis_actions) AND kind = 'agent-diagnose' AND to_value = 'reported';

-- 3. the outcome measure and the failure mode with its detector
CREATE VIEW IF NOT EXISTS v_root_cause_diagnosis AS
SELECT a.id AS issue_id, a.title AS title, datetime(a.created_at / 1000, 'unixepoch') AS created_at,
       (SELECT COUNT(*) FROM cf_agent_requests r WHERE r.instance = 'root-cause-' || a.id) AS requests,
       (SELECT COUNT(*) FROM cf_agent_requests r WHERE r.instance = 'root-cause-' || a.id AND r.status IN ('done', 'failed', 'error') AND length(COALESCE(r.result, '')) >= 400
           AND COALESCE(r.result, '') NOT LIKE '(the model returned no text)%' AND COALESCE(r.result, '') NOT LIKE '%tool_call%' AND COALESCE(r.result, '') NOT LIKE '%<invoke%'
           AND COALESCE(r.result, '') NOT LIKE '%<function_calls%' AND COALESCE(r.result, '') NOT LIKE '%DSML%') AS usable
FROM agent_issues a WHERE a.status = 'open' AND a.title LIKE 'ROOT-CAUSE-1:%';

INSERT OR IGNORE INTO failure_modes
  (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id, trigger_condition, symptom, blast_radius)
VALUES
  ('root-cause-diagnosis-preface',
   'a ROOT-CAUSE-1 ticket stands on a diagnosis that is only the agent''s opening narration line, so the cause is never named',
   'rc-agent-request, rc-agent-report and rc-agent-mark counted any answer that was not empty or tool-call markup as the diagnosis (59 to 113 character answers on 6 of the 8 newest tickets)',
   'ROOT-CAUSE-DIAGNOSIS-USABLE-1: an answer counts only from 400 characters, shorter and empty ones are re-asked (6 requests at most), the prompt requires the diagnosis itself; v_root_cause_diagnosis is the outcome measure',
   'fm-root-cause-diagnosis-preface: the live management-personas definition carries the length rule in all three steps',
   'fm-root-cause-diagnosis-preface', '2026-11-05', 1000892,
   'cf_agent_requests answers of a few dozen characters on a ROOT-CAUSE-1 instance with status done',
   'ROOT-CAUSE-1 tickets recur for days with no named producer, probe or change',
   'every ROOT-CAUSE-1 ticket and the managers that read them');

INSERT OR IGNORE INTO remediation_contracts
  (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module, budget_ms, max_items, requires_container)
VALUES
  ('fm-root-cause-diagnosis-preface', NULL, 'ROOT-CAUSE-DIAGNOSIS-USABLE-1', 'failure-mode detector',
   'SELECT ''3'' AS expected, CAST((SELECT (length(d) - length(replace(d, ''AND length(COALESCE(r.result, '''''''')) >= 400'', ''''))) / length(''AND length(COALESCE(r.result, '''''''')) >= 400'') FROM (SELECT definition AS d FROM fleet_tasks WHERE id = ''management-personas'')) AS TEXT) AS observed',
   'd1-query', 3, 'qnfo-fleet-control', 1, 'active', 'failure-mode', 45000, 5, 0);

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:D2-slo-journeys-probes',
  'a ROOT-CAUSE-1 ticket is worth having only if its diagnosis names the producer, the probe and the change; a one-line narration is not a diagnosis',
  'management-personas v+1: rc-agent-request/report/mark count an answer only from 400 characters; the prompt requires the diagnosis itself; unusable stored answers are re-asked',
  'qnfo-audit 2026-11-05: 6 of the 8 newest ROOT-CAUSE-1 tickets hold one done request of 59 to 113 characters; the retry rule (6 requests, 3 a tick) never fired for them',
  'pending', 'ROOT-CAUSE-1 tickets only (about 3 agent requests per tick at most)',
  'restore the definition and persona rows from bak_20261105_rc_diagnosis_tasks and bak_20261105_rc_diagnosis_actions (Rollback line)',
  'root-cause diagnoses that name a producer and a change instead of an opening line',
  'every open ROOT-CAUSE-1 ticket older than 6 h has at least one usable answer (v_root_cause_diagnosis.usable >= 1) or six requests within 24 h of the apply',
  'ROOT-CAUSE-1 families that stop recurring because the named cause is fixed',
  'migrations/root-cause-diagnosis-usable.test.mjs on node:sqlite over the three live step texts'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE actor = 'session:D2-slo-journeys-probes' AND action LIKE 'management-personas v+1: rc-agent%');
