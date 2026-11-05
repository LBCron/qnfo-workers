-- BREACH-PLAYBOOK-TAINT-1 (2026-11-05, charter pillar autonomy; doctor_taint_violations_24h 15 -> 0, breaches_auto_remediated_24h).
-- Live qnfo-audit 2026-11-04: breach_diagnosis_events carries one taint-drop (rule=IAR-R1-live-doer why=verify-semicolon) on every doctor tick that loads the playbook
-- rules (15 in 24 h; metric doctor_taint_violations_24h). The doctor refuses any playbook SQL that contains a semicolon anywhere, string literals included (bdReadOnlyWhy and
-- bdWriteWhy), and IAR-R1-live-doer (migrations/2026-11-02-breach-issue-age-repairs.sql) writes its close evidence as 'moot: age-repair notice target #<id> doer=<code>; target remains open'.
-- So the rule has never acted since 2026-11-02, and migrations/breach-issue-age-repairs.test.mjs, which runs the production validator, has failed on main since the check was added.
-- The same literal is also a 61-byte LIKE pattern in the verify and revert statements: D1 refuses a LIKE or GLOB pattern over 50 bytes at run time, so lifting only the semicolon would have
-- moved the failure from load time to verify time. Version 2 writes the evidence with ' - target remains open' and matches it with a 33-byte LIKE prefix plus instr() (no length limit).
-- Two further defects surfaced once the validator passed (the production-engine test in migrations/breach-issue-age-repairs.test.mjs): the verify statement required the notice
-- to be closed (a.status IN ('closed','resolved')) AND open (n.status = 'open', the same row), so it could never read ok; and the revert reset issue_triage but never reopened the
-- agent_issues row, which no trigger does (TL-R03-close carries the same second statement). Version 2 drops the impossible predicate and adds the reopen statement.
-- The trigger, the bound action and the enumerated doer codes are unchanged. Nothing else in breach_playbooks fails the validator (migrations/breach-playbooks-validate.test.mjs replays every playbook migration through the production bdValidateRule).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_iar_r1_playbook
-- Rollback: UPDATE breach_playbooks SET version = (SELECT version FROM bak_20261105_iar_r1_playbook), trigger_sql = (SELECT trigger_sql FROM bak_20261105_iar_r1_playbook), action_sql = (SELECT action_sql FROM bak_20261105_iar_r1_playbook), revert_sql = (SELECT revert_sql FROM bak_20261105_iar_r1_playbook), verify_sql = (SELECT verify_sql FROM bak_20261105_iar_r1_playbook) WHERE rule_id = 'IAR-R1-live-doer'; DELETE FROM remediation_contracts WHERE class = 'fm-breach-playbook-taint'; DELETE FROM failure_modes WHERE fm_key = 'breach-playbook-taint'

CREATE TABLE IF NOT EXISTS bak_20261105_iar_r1_playbook AS SELECT * FROM breach_playbooks WHERE rule_id = 'IAR-R1-live-doer';

UPDATE breach_playbooks SET version = 2,
  trigger_sql = 'WITH n AS (SELECT a.id AS issue_id, CAST(substr(a.title, instr(a.title, ''issue #'') + 7, instr(substr(a.title, instr(a.title, ''issue #'') + 7) || '' '', '' '') - 1) AS INTEGER) AS target_id, substr(a.title, instr(a.title, ''issue #'') + 7, instr(substr(a.title, instr(a.title, ''issue #'') + 7) || '' '', '' '') - 1) AS target_token FROM agent_issues a WHERE a.status = ''open'' AND a.source = ''qnfo-fleet-control'' AND a.title LIKE ''ISSUE-AGE-24H-REPAIR-1: issue #% has no live doer'' AND instr(a.title, ''issue #'') > 0) SELECT n.issue_id, ''live-doer'' AS subject, json_object(''target_issue_id'', n.target_id, ''doer'', CASE l.doer WHEN ''code-task line'' THEN ''code-task-line'' WHEN ''live code task'' THEN ''live-code-task'' WHEN ''live work claim'' THEN ''live-work-claim'' WHEN ''breach doctor'' THEN ''breach-doctor'' END) AS facts_json FROM n JOIN agent_issues p ON p.id = n.target_id AND p.status = ''open'' JOIN v_issue_age_ladder l ON l.id = p.id JOIN issue_triage t ON t.issue_id = n.issue_id AND t.triage_state = ''triaged'' WHERE length(n.target_token) BETWEEN 1 AND 10 AND n.target_token NOT GLOB ''*[^0-9]*'' AND l.doer IN (''code-task line'', ''live code task'', ''live work claim'', ''breach doctor'') AND NOT EXISTS (SELECT 1 FROM remediation_contracts c WHERE c.issue_id = n.issue_id AND c.status IN (''active'', ''holding'') AND COALESCE(c.last_verdict, '''') IN (''fail'', ''vacuous-probe-result'', ''probe-error'', ''probe-not-machine-executable'', ''probe-same-account-host''))',
  action_sql = '["UPDATE issue_triage SET triage_state = ''closed'', close_evidence = ''moot: age-repair notice target #'' || (SELECT CAST(l.id AS TEXT) || '' doer='' || CASE l.doer WHEN ''code-task line'' THEN ''code-task-line'' WHEN ''live code task'' THEN ''live-code-task'' WHEN ''live work claim'' THEN ''live-work-claim'' WHEN ''breach doctor'' THEN ''breach-doctor'' END FROM agent_issues n JOIN v_issue_age_ladder l ON l.id = CAST(substr(n.title, instr(n.title, ''issue #'') + 7, instr(substr(n.title, instr(n.title, ''issue #'') + 7) || '' '', '' '') - 1) AS INTEGER) WHERE n.id = issue_triage.issue_id AND n.status = ''open'' AND n.source = ''qnfo-fleet-control'' AND n.title LIKE ''ISSUE-AGE-24H-REPAIR-1: issue #% has no live doer'' AND l.doer IN (''code-task line'', ''live code task'', ''live work claim'', ''breach doctor'')) || '' - target remains open'' WHERE issue_id = ?1 AND triage_state = ''triaged'' AND EXISTS (SELECT 1 FROM agent_issues n JOIN v_issue_age_ladder l ON l.id = CAST(substr(n.title, instr(n.title, ''issue #'') + 7, instr(substr(n.title, instr(n.title, ''issue #'') + 7) || '' '', '' '') - 1) AS INTEGER) WHERE n.id = issue_triage.issue_id AND n.status = ''open'' AND n.source = ''qnfo-fleet-control'' AND n.title LIKE ''ISSUE-AGE-24H-REPAIR-1: issue #% has no live doer'' AND length(substr(n.title, instr(n.title, ''issue #'') + 7, instr(substr(n.title, instr(n.title, ''issue #'') + 7) || '' '', '' '') - 1)) BETWEEN 1 AND 10 AND substr(n.title, instr(n.title, ''issue #'') + 7, instr(substr(n.title, instr(n.title, ''issue #'') + 7) || '' '', '' '') - 1) NOT GLOB ''*[^0-9]*'' AND l.doer IN (''code-task line'', ''live code task'', ''live work claim'', ''breach doctor''))"]',
  revert_sql = '["UPDATE issue_triage SET triage_state = ''triaged'', close_evidence = NULL WHERE issue_id = ?1 AND triage_state = ''closed'' AND close_evidence LIKE ''moot: age-repair notice target #%'' AND instr(close_evidence, '' - target remains open'') > 0","UPDATE agent_issues SET status = ''open'', close_channel = NULL, updated_at = CAST(strftime(''%s'',''now'') AS INTEGER) * 1000 WHERE id = ?1 AND status = ''closed''"]',
  verify_sql = 'SELECT ''ok'' AS expected, CASE WHEN a.status IN (''closed'', ''resolved'') AND t.triage_state = ''closed'' AND t.close_evidence LIKE ''moot: age-repair notice target #%'' AND instr(t.close_evidence, '' doer='') > 0 AND instr(t.close_evidence, '' - target remains open'') > 0 AND EXISTS (SELECT 1 FROM agent_issues n JOIN v_issue_age_ladder l ON l.id = CAST(substr(n.title, instr(n.title, ''issue #'') + 7, instr(substr(n.title, instr(n.title, ''issue #'') + 7) || '' '', '' '') - 1) AS INTEGER) WHERE n.id = a.id AND n.title LIKE ''ISSUE-AGE-24H-REPAIR-1: issue #% has no live doer'' AND l.doer IN (''code-task line'', ''live code task'', ''live work claim'', ''breach doctor'')) THEN ''ok'' ELSE ''target-doer-not-live'' END AS observed FROM agent_issues a JOIN issue_triage t ON t.issue_id = a.id WHERE a.id = ?1'
WHERE rule_id = 'IAR-R1-live-doer' AND version = 1;

INSERT OR IGNORE INTO failure_modes
  (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id, trigger_condition, symptom, blast_radius)
VALUES
  ('breach-playbook-taint', 'an enabled breach playbook carries a semicolon in its SQL, so the doctor drops it on every tick and it never acts',
   'bdReadOnlyWhy and bdWriteWhy refuse a semicolon anywhere in a playbook statement, string literals included; IAR-R1-live-doer wrote one into its close evidence text, and no CI check ran the production validator over the migrations that author playbooks',
   'BREACH-PLAYBOOK-TAINT-1: version 2 of IAR-R1-live-doer, and migrations/breach-playbooks-validate.test.mjs replays every playbook migration through bdValidateRule',
   'fm-breach-playbook-taint: enabled playbooks with a semicolon in trigger, action, revert or verify SQL', 'fm-breach-playbook-taint', '2026-11-05', NULL,
   'an enabled breach_playbooks row has a semicolon in any of its four SQL columns',
   'taint-drop events on every doctor tick and doctor_taint_violations_24h above 0',
   'one playbook per rule: the rule never acts and its cases stay diagnosed');

INSERT OR IGNORE INTO remediation_contracts
  (class, issue_id, verify_probe, verify_transport, max_attempts, expected_cadence_h, status, precondition, action, escalate_to, module)
VALUES
  ('fm-breach-playbook-taint', NULL,
   'SELECT ''0'' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM breach_playbooks WHERE enabled = 1 AND (instr(trigger_sql, char(59)) > 0 OR instr(action_sql, char(59)) > 0 OR instr(revert_sql, char(59)) > 0 OR instr(verify_sql, char(59)) > 0)',
   'd1-query', 3, 1, 'active', 'BREACH-PLAYBOOK-TAINT-1', 'failure-mode detector', 'qnfo-fleet-control', 'failure-mode');

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:breach-doctor-probes',
  'A playbook the doctor drops on every tick is a defect in the playbook text, not in the doctor: the semicolon rule protects the one-statement bound and stays.',
  'BREACH-PLAYBOOK-TAINT-1: IAR-R1-live-doer version 2 (evidence text without a semicolon, LIKE prefixes under 50 bytes plus instr()), detector fm-breach-playbook-taint, replay test of all playbook migrations.',
  'Live 2026-11-04: breach_diagnosis_events taint-drop rule=IAR-R1-live-doer why=verify-semicolon on every loading tick (15 in 24 h, metric doctor_taint_violations_24h 15); breach-issue-age-repairs.test.mjs failed on main with the production validator.',
  'The doctor loads 26 of 26 rules, taint=0 in the tick detail, and IAR-R1 closes age-repair notices whose target has a live doer.',
  'breach_playbooks IAR-R1-live-doer only; backup table bak_20261105_iar_r1_playbook; the target issues are never touched.',
  'The Rollback line of migrations/2026-11-05-iar-r1-live-doer-v2.sql restores version 1 from the backup table.',
  'Every playbook migration is validated by the production validator in CI before it can taint a tick.',
  'doctor_taint_violations_24h: no new taint-drop events after the apply, metric 15 -> 0 within 24 h (rolling window); breaches_auto_remediated_24h gains the notices IAR-R1 verifies.',
  'none',
  'D1 breach_playbooks, breach_diagnosis_events; migrations/breach-playbooks-validate.test.mjs; migrations/breach-issue-age-repairs.test.mjs'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'BREACH-PLAYBOOK-TAINT-1:%');
