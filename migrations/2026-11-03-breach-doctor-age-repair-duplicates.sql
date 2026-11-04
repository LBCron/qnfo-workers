-- BREACH-DOCTOR-1 age-repair duplicate classification, charter pillar autonomy; issue 1001402.
-- A generated age-repair notice is a duplicate signal when it points to a different, still-open issue.
-- Classify and close only the notice; the parent remains open and continues through its own diagnosis.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE breach_playbooks SET enabled = 0, mode = 'measure' WHERE rule_id = 'IAR-R2-open-parent'; decision_log is append-only and remains.

INSERT OR IGNORE INTO breach_playbooks
  (rule_id, version, family, cause_class, action_kind, trigger_sql, action_sql, revert_sql, verify_sql, min_ladder, max_per_tick, max_per_day, enabled, mode, note)
VALUES
  ('IAR-R2-open-parent', 1, 'ISSUE-AGE-24H-REPAIR-1', 'duplicate-of-open-parent', 'sql',
   'WITH n AS (SELECT a.id AS issue_id, CAST(substr(a.title, instr(a.title, ''issue #'') + 7, instr(substr(a.title, instr(a.title, ''issue #'') + 7) || '' '', '' '') - 1) AS INTEGER) AS target_id, substr(a.title, instr(a.title, ''issue #'') + 7, instr(substr(a.title, instr(a.title, ''issue #'') + 7) || '' '', '' '') - 1) AS target_token FROM agent_issues a WHERE a.status = ''open'' AND a.source = ''qnfo-fleet-control'' AND a.title LIKE ''ISSUE-AGE-24H-REPAIR-1: issue #% has no live doer'' AND instr(a.title, ''issue #'') > 0) SELECT n.issue_id, ''open-parent'' AS subject, json_object(''target_issue_id'', n.target_id, ''relation'', ''open-parent'') AS facts_json FROM n JOIN agent_issues p ON p.id = n.target_id AND p.status = ''open'' AND p.id <> n.issue_id JOIN issue_triage t ON t.issue_id = n.issue_id AND t.triage_state = ''triaged'' WHERE length(n.target_token) BETWEEN 1 AND 10 AND n.target_token NOT GLOB ''*[^0-9]*'' AND substr((SELECT a.title FROM agent_issues a WHERE a.id = n.issue_id), instr((SELECT a.title FROM agent_issues a WHERE a.id = n.issue_id), ''issue #'') + 7 + length(n.target_token)) = '' has no live doer'' AND NOT EXISTS (SELECT 1 FROM remediation_contracts c WHERE c.issue_id = n.issue_id AND c.status IN (''active'', ''holding'') AND COALESCE(c.last_verdict, '''') IN (''fail'', ''vacuous-probe-result'', ''probe-error'', ''probe-not-machine-executable'', ''probe-same-account-host''))',
   json_array('UPDATE issue_triage SET triage_state = ''closed'', close_evidence = ''duplicate: generated age-repair notice points to a different open parent, which remains open'' WHERE issue_id = ?1 AND triage_state = ''triaged'' AND EXISTS (SELECT 1 FROM agent_issues n JOIN agent_issues p ON p.id = CAST(substr(n.title, instr(n.title, ''issue #'') + 7, instr(substr(n.title, instr(n.title, ''issue #'') + 7) || '' '', '' '') - 1) AS INTEGER) AND p.status = ''open'' AND p.id <> n.id WHERE n.id = issue_triage.issue_id AND n.status = ''open'' AND n.source = ''qnfo-fleet-control'' AND n.title LIKE ''ISSUE-AGE-24H-REPAIR-1: issue #% has no live doer'' AND instr(n.title, ''issue #'') > 0 AND length(substr(n.title, instr(n.title, ''issue #'') + 7, instr(substr(n.title, instr(n.title, ''issue #'') + 7) || '' '', '' '') - 1)) BETWEEN 1 AND 10 AND substr(n.title, instr(n.title, ''issue #'') + 7, instr(substr(n.title, instr(n.title, ''issue #'') + 7) || '' '', '' '') - 1) NOT GLOB ''*[^0-9]*'' AND substr(n.title, instr(n.title, ''issue #'') + 7 + length(substr(n.title, instr(n.title, ''issue #'') + 7, instr(substr(n.title, instr(n.title, ''issue #'') + 7) || '' '', '' '') - 1))) = '' has no live doer'')'),
   json_array('UPDATE issue_triage SET triage_state = ''triaged'', close_evidence = NULL WHERE issue_id = ?1 AND triage_state = ''closed'' AND close_evidence = ''duplicate: generated age-repair notice points to a different open parent, which remains open'''),
   'SELECT ''ok'' AS expected, CASE WHEN a.status IN (''closed'', ''resolved'') AND t.triage_state = ''closed'' AND t.close_evidence = ''duplicate: generated age-repair notice points to a different open parent, which remains open'' AND EXISTS (SELECT 1 FROM agent_issues p WHERE p.id = CAST(substr(a.title, instr(a.title, ''issue #'') + 7, instr(substr(a.title, instr(a.title, ''issue #'') + 7) || '' '', '' '') - 1) AS INTEGER) AND p.id <> a.id AND p.status = ''open'') THEN ''ok'' ELSE ''duplicate-or-parent-state-mismatch'' END AS observed FROM agent_issues a JOIN issue_triage t ON t.issue_id = a.id WHERE a.id = ?1',
   'delegated', 6, 120, 1, 'on',
   'Only the generated qnfo-fleet-control age-repair notice with an exact numeric target ID and a different, still-open parent. The notice closes as a duplicate; the parent remains open and is diagnosed independently.');

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'copilot:1001402',
  'An open age-repair notice that references a different open issue duplicates that parent in the breach metric; classifying and closing the notice must not close the parent.',
  'BREACH-DOCTOR-1: add IAR-R2-open-parent for generated ISSUE-AGE-24H-REPAIR-1 notices whose referenced parent is still open.',
  'Live qnfo-audit evidence in issue 1001402: 129 generated open notices had open parents, and 102 parent issues already had an unclassified diagnosis.',
  'The notice is classified and closed only while its referenced parent remains open; the parent stays open.',
  'breach_playbooks IAR-R2-open-parent; matching generated age-repair notices and their issue_triage rows.',
  'Disable the rule and return it to measure; diagnosis and decision history remain.',
  'The breach doctor distinguishes duplicate ownership notices from their still-open parent issue.',
  'breaches_undiagnosed_over_60m < 426 within 24 hours',
  'Up to 129 duplicate notices stop being double-counted while parent issues remain independently counted.',
  'migration replay; production breach-doctor engine; wrong-source, malformed-target, closed-parent, and parent-preservation fixtures'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'BREACH-DOCTOR-1: add IAR-R2-open-parent%');
