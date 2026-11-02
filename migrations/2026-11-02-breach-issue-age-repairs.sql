-- BREACH-ISSUE-AGE-REPAIR-1 (2026-11-02, charter pillar autonomy; issue 1000404).
-- Live qnfo-audit: breaches_auto_remediated_24h=4; 143 unclassified `other` cases were generated issue-age repair notices,
-- and 2 referenced issues already had a live doer. Close only the notice after its still-open target gains a live doer;
-- the target issue and its own outcome probe remain untouched.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE breach_playbooks SET enabled = 0, mode = 'measure' WHERE rule_id = 'IAR-R1-live-doer'; UPDATE remediation_contracts SET status = 'superseded' WHERE class = 'fm-breach-age-repair-live-doer'; UPDATE failure_modes SET remediation = 'BREACH-ISSUE-AGE-REPAIR-1 disabled by rollback', trigger_condition = 'inactive after rollback' WHERE fm_key = 'breach-age-repair-live-doer'; UPDATE capability_ledger SET reliability = 'reverted by BREACH-ISSUE-AGE-REPAIR-1 rollback', evidence = 'The playbook was disabled; historical ledger retained.' WHERE capability = 'breach-doctor:close-age-repair-notices'; decision_log is append-only and remains.

INSERT OR IGNORE INTO breach_playbooks
  (rule_id, version, family, cause_class, action_kind, trigger_sql, action_sql, revert_sql, verify_sql, min_ladder, max_per_tick, max_per_day, enabled, mode, note)
VALUES
  ('IAR-R1-live-doer', 1, 'other', 'age-repair-live-doer', 'sql',
   'WITH n AS (SELECT a.id AS issue_id, CAST(substr(a.title, instr(a.title, ''issue #'') + 7, instr(substr(a.title, instr(a.title, ''issue #'') + 7) || '' '', '' '') - 1) AS INTEGER) AS target_id, substr(a.title, instr(a.title, ''issue #'') + 7, instr(substr(a.title, instr(a.title, ''issue #'') + 7) || '' '', '' '') - 1) AS target_token FROM agent_issues a WHERE a.status = ''open'' AND a.source = ''qnfo-fleet-control'' AND a.title LIKE ''ISSUE-AGE-24H-REPAIR-1: issue #% has no live doer'' AND instr(a.title, ''issue #'') > 0) SELECT n.issue_id, ''live-doer'' AS subject, json_object(''target_issue_id'', n.target_id, ''doer'', CASE l.doer WHEN ''code-task line'' THEN ''code-task-line'' WHEN ''live code task'' THEN ''live-code-task'' WHEN ''live work claim'' THEN ''live-work-claim'' WHEN ''breach doctor'' THEN ''breach-doctor'' END) AS facts_json FROM n JOIN agent_issues p ON p.id = n.target_id AND p.status = ''open'' JOIN v_issue_age_ladder l ON l.id = p.id JOIN issue_triage t ON t.issue_id = n.issue_id AND t.triage_state = ''triaged'' WHERE length(n.target_token) BETWEEN 1 AND 10 AND n.target_token NOT GLOB ''*[^0-9]*'' AND l.doer IN (''code-task line'', ''live code task'', ''live work claim'', ''breach doctor'') AND NOT EXISTS (SELECT 1 FROM remediation_contracts c WHERE c.issue_id = n.issue_id AND c.status IN (''active'', ''holding'') AND COALESCE(c.last_verdict, '''') IN (''fail'', ''vacuous-probe-result'', ''probe-error'', ''probe-not-machine-executable'', ''probe-same-account-host''))',
   json_array('UPDATE issue_triage SET triage_state = ''closed'', close_evidence = ''moot: age-repair notice target #'' || (SELECT CAST(l.id AS TEXT) || '' doer='' || CASE l.doer WHEN ''code-task line'' THEN ''code-task-line'' WHEN ''live code task'' THEN ''live-code-task'' WHEN ''live work claim'' THEN ''live-work-claim'' WHEN ''breach doctor'' THEN ''breach-doctor'' END FROM agent_issues n JOIN v_issue_age_ladder l ON l.id = CAST(substr(n.title, instr(n.title, ''issue #'') + 7, instr(substr(n.title, instr(n.title, ''issue #'') + 7) || '' '', '' '') - 1) AS INTEGER) WHERE n.id = issue_triage.issue_id AND n.status = ''open'' AND n.source = ''qnfo-fleet-control'' AND n.title LIKE ''ISSUE-AGE-24H-REPAIR-1: issue #% has no live doer'' AND l.doer IN (''code-task line'', ''live code task'', ''live work claim'', ''breach doctor'')) || ''; target remains open'' WHERE issue_id = ?1 AND triage_state = ''triaged'' AND EXISTS (SELECT 1 FROM agent_issues n JOIN v_issue_age_ladder l ON l.id = CAST(substr(n.title, instr(n.title, ''issue #'') + 7, instr(substr(n.title, instr(n.title, ''issue #'') + 7) || '' '', '' '') - 1) AS INTEGER) WHERE n.id = issue_triage.issue_id AND n.status = ''open'' AND n.source = ''qnfo-fleet-control'' AND n.title LIKE ''ISSUE-AGE-24H-REPAIR-1: issue #% has no live doer'' AND length(substr(n.title, instr(n.title, ''issue #'') + 7, instr(substr(n.title, instr(n.title, ''issue #'') + 7) || '' '', '' '') - 1)) BETWEEN 1 AND 10 AND substr(n.title, instr(n.title, ''issue #'') + 7, instr(substr(n.title, instr(n.title, ''issue #'') + 7) || '' '', '' '') - 1) NOT GLOB ''*[^0-9]*'' AND l.doer IN (''code-task line'', ''live code task'', ''live work claim'', ''breach doctor''))'),
   json_array('UPDATE issue_triage SET triage_state = ''triaged'', close_evidence = NULL WHERE issue_id = ?1 AND triage_state = ''closed'' AND close_evidence LIKE ''moot: age-repair notice target #% doer=%; target remains open'''),
   'SELECT ''ok'' AS expected, CASE WHEN a.status IN (''closed'', ''resolved'') AND t.triage_state = ''closed'' AND t.close_evidence LIKE ''moot: age-repair notice target #% doer=%; target remains open'' AND EXISTS (SELECT 1 FROM agent_issues n JOIN v_issue_age_ladder l ON l.id = CAST(substr(n.title, instr(n.title, ''issue #'') + 7, instr(substr(n.title, instr(n.title, ''issue #'') + 7) || '' '', '' '') - 1) AS INTEGER) WHERE n.id = a.id AND n.status = ''open'' AND n.title LIKE ''ISSUE-AGE-24H-REPAIR-1: issue #% has no live doer'' AND l.doer IN (''code-task line'', ''live code task'', ''live work claim'', ''breach doctor'')) THEN ''ok'' ELSE ''target-doer-not-live'' END AS observed FROM agent_issues a JOIN issue_triage t ON t.issue_id = a.id WHERE a.id = ?1',
   'delegated', 6, 120, 1, 'on',
   'Only generated qnfo-fleet-control age-repair notices whose original issue remains open and has a live code-task line, task, claim or progressing breach-doctor case. Closing this notice records that its ownership gap is resolved; the original issue remains open for its own outcome probe. Facts and close evidence contain only issue IDs and enumerated doer codes.');

INSERT OR IGNORE INTO failure_modes
  (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id, trigger_condition, symptom, blast_radius)
VALUES
  ('breach-age-repair-live-doer', 'age-repair notices remain open after their target issue gains a live doer',
   'The breach doctor had no playbook for the generated ISSUE-AGE-24H-REPAIR-1 notices, so their unclassified cases remained diagnosed after a code task, claim or progressing doctor case took ownership.',
   'IAR-R1-live-doer closes only the generated notice when its still-open target has a live doer; the target and its outcome probe remain open.',
   'fm-breach-age-repair-live-doer: eligible open notice count', 'fm-breach-age-repair-live-doer', '2026-11-02', 1000404,
   'an open generated age-repair notice references an open issue with a live doer',
   'the doctor continues to count a solved ownership notice as unclassified',
   'issue-age repair notices and breaches_auto_remediated_24h');

INSERT OR IGNORE INTO remediation_contracts
  (class, issue_id, verify_probe, verify_transport, max_attempts, expected_cadence_h, status, precondition, action, escalate_to, module)
VALUES
  ('fm-breach-age-repair-live-doer', 1000404,
   'WITH n AS (SELECT a.id AS issue_id, CAST(substr(a.title, instr(a.title, ''issue #'') + 7, instr(substr(a.title, instr(a.title, ''issue #'') + 7) || '' '', '' '') - 1) AS INTEGER) AS target_id, substr(a.title, instr(a.title, ''issue #'') + 7, instr(substr(a.title, instr(a.title, ''issue #'') + 7) || '' '', '' '') - 1) AS target_token FROM agent_issues a WHERE a.status = ''open'' AND a.source = ''qnfo-fleet-control'' AND a.title LIKE ''ISSUE-AGE-24H-REPAIR-1: issue #% has no live doer'' AND instr(a.title, ''issue #'') > 0) SELECT ''0'' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM n JOIN agent_issues p ON p.id = n.target_id AND p.status = ''open'' JOIN v_issue_age_ladder l ON l.id = p.id JOIN issue_triage t ON t.issue_id = n.issue_id AND t.triage_state = ''triaged'' WHERE length(n.target_token) BETWEEN 1 AND 10 AND n.target_token NOT GLOB ''*[^0-9]*'' AND l.doer IN (''code-task line'', ''live code task'', ''live work claim'', ''breach doctor'')',
   'd1-query', 1000, 1, 'active', 'An issue-age repair notice has an open target with a live doer.',
   'The breach doctor closes the notice only after confirming the target doer; the target issue remains open.',
   'qnfo-fleet-control', 'failure-mode');

INSERT OR IGNORE INTO capability_ledger
  (capability, provenance, prerequisites, reliability, acquired_at, last_exercised_at, evidence)
VALUES
  ('breach-doctor:close-age-repair-notices', 'BREACH-ISSUE-AGE-REPAIR-1 (IAR-R1-live-doer)',
   'qnfo-fleet-control breach doctor tick; v_issue_age_ladder reports a live doer for the referenced open issue',
   'unmeasured until a breach_diagnoses row reaches verified',
   strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), NULL,
   'A generated age-repair notice closes only after its target issue has a live doer; the target remains open.');

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'copilot:1000404',
  'A generated age-repair notice is resolved when its still-open target gains an independently visible live doer; this does not establish that the target defect is fixed.',
  'BREACH-ISSUE-AGE-REPAIR-1: add IAR-R1-live-doer, a bounded playbook that closes only generated age-repair notices with an open target and an enumerated live doer.',
  'Live qnfo-audit 2026-11-02: verified_24h=4; unclassified_cases=431; other=261 including 143 generated age-repair notices; 2 notices referenced open targets with live doers.',
  'The notice closes with ID and doer-code evidence after two verification passes; the original issue remains open and its outcome probe is unchanged.',
  'breach_playbooks IAR-R1-live-doer; matching issue_triage rows only; failure-mode contract and capability ledger.',
  'The Rollback line disables the rule, supersedes its detector contract and marks the capability as reverted; issue and decision evidence remain.',
  'The breach doctor autonomously closes resolved ownership notices without closing or relabeling their target issues.',
  'breaches_auto_remediated_24h increases from 4 by up to 2 immediately after cooldown for the 2 currently eligible notices, and increases further as eligible targets acquire doers; reach 12 if at least 8 notices verify in the 24-hour window.',
  'none',
  'Read-only qnfo-audit status, diagnosis and issue-age reads; migrations/breach-issue-age-repairs.test.mjs; migration check'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'BREACH-ISSUE-AGE-REPAIR-1:%');
