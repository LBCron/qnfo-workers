-- CLOSED-LOOPS-1 (2026-11-04, owner standing rule; charter pillar: autonomy).
-- Owner words (Rowan, 2026-11-04): every problem found gets its solution implemented; every item, bullet, issue and PR is a closed loop (owner, fix, live evidence, closure); loops are never lost.
-- Reuses the existing loops (v_issue_age_ladder from ISSUE-AGE-24H-REPAIR-1, issue_triage.close_evidence from OWNER-NO-LOOSE-ENDS-1, v_issue_accounting) and adds no gate and no owner card:
--   1. The rule is recorded for machines (ops_config OWNER_DIRECTIVE_2026_11_04_CLOSED_LOOPS_1).
--   2. fm-open-loops-unclosed reads two ways a loop is lost, expected 0 each: an open issue older than 120 minutes with no live doer (v_issue_age_ladder.doer IS NULL), and an issue closed without close_evidence.
--      A miss files through the failure-mode path (remediation_contracts, escalate_to qnfo-fleet-control), whose hourly tick routes the issue to its doer (code loop, breach doctor or managers).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM ops_config WHERE key = 'OWNER_DIRECTIVE_2026_11_04_CLOSED_LOOPS_1'; DELETE FROM remediation_contracts WHERE class = 'fm-open-loops-unclosed'; DELETE FROM failure_modes WHERE fm_key = 'open-loops-unclosed';
-- CAUSE-MAPPED: registers no metric_registry row; the detector is a failure_modes row with a remediation contract.

INSERT OR IGNORE INTO ops_config (key, value, note) VALUES ('OWNER_DIRECTIVE_2026_11_04_CLOSED_LOOPS_1', '{"id":"CLOSED-LOOPS-1","directive":"EVERY PROBLEM FOUND GETS ITS SOLUTION IMPLEMENTED; EVERY ITEM, ISSUE AND PR IS A CLOSED LOOP: OWNER, FIX, LIVE EVIDENCE, CLOSURE; NEVER LOSE A LOOP","date":"2026-11-04","carried_by":["fm-open-loops-unclosed detector","v_issue_age_ladder (doer per open issue)","issue_triage.close_evidence","v_issue_accounting","CODE-CHANGE-REQUIRED-1 (a PR needs its code change)"],"limits":"adds no gate and no owner card; only an IDENTITY-BOUND: item stays with the owner; harness permission checks, the secret lock and live work claims keep their precedence"}', 'CLOSED-LOOPS-1 (owner standing rule 2026-11-04): honored through the detector fm-open-loops-unclosed and the instructions of every project repository.');

INSERT OR IGNORE INTO failure_modes (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id, trigger_condition, symptom, blast_radius)
VALUES ('open-loops-unclosed', 'an issue stays open with no doer, or is closed with no evidence: the loop is lost',
  'filers and the planner trust list leave fleet-filed issues without a doer (600 of 607 open issues on 2026-11-04), and a close without close_evidence leaves no proof the fix is live',
  'v_issue_age_ladder names the doer of each open issue; the owning loops (code loop, breach doctor, managers) take an issue with no doer; a close needs issue_triage.close_evidence (a live measurement)',
  'the fm-open-loops-unclosed contract counts open issues over 120 minutes with no live doer plus issues closed in the last 24 hours with empty close_evidence, expected 0',
  'fm-open-loops-unclosed', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), NULL,
  'an open agent_issues row older than 120 minutes whose v_issue_age_ladder doer is NULL, or a closed issue_triage row with empty close_evidence',
  'open_agent_issues grows while issues_over_24h_no_doer stays above 0; closed issues with no proof',
  'every loop: a problem found is reported but its fix never lands');

INSERT OR IGNORE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module, next_due_at)
VALUES ('fm-open-loops-unclosed', NULL, 'CLOSED-LOOPS-1', 'failure-mode detector',
  'SELECT ''0'' AS expected, CAST((SELECT COUNT(*) FROM v_issue_age_ladder WHERE doer IS NULL AND age_h >= 2) + (SELECT COUNT(*) FROM issue_triage WHERE triage_state = ''closed'' AND COALESCE(TRIM(close_evidence), '''') = '''' AND triaged_at > strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-24 hours'')) AS TEXT) AS observed',
  'd1-query', 3, 'qnfo-fleet-control', 1, 'active', 'failure-mode', datetime('now'));

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session_0156nqDsKTKP9pmMqE2mx2n1',
  'a lost loop is an open issue with no doer or a close with no evidence; both are read from existing views',
  'CLOSED-LOOPS-1: directive recorded; fm-open-loops-unclosed reads open issues with no doer and closes without evidence',
  'owner message 2026-11-04 15:06; triage found 600 of 607 open issues without a doer',
  'migration merged', 'one ops_config row, one failure mode, one detector contract', 'the Rollback header of migrations/2026-11-04-closed-loops.sql',
  'lost loops are detected hourly and routed through the failure-mode path',
  'issues_over_24h_no_doer falls toward 0', 'none', 'd1:qnfo-audit view text, node:sqlite fixtures in migrations/closed-loops.test.mjs'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'CLOSED-LOOPS-1:%');
