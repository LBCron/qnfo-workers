-- WORKFLOW-AND-DRILL-PROBES-1 (2026-11-05, charter pillar autonomy; breach cluster doctor-probes; agent_issues 1000747, 100412, 1001336, 1001807, 1001808).
-- WHAT WAS MEASURED (qnfo-audit, read-only, 2026-11-04 22:40-23:55Z)
--  1. WORKFLOW-FAILED-1 flapping (issue 1000747): the producer was fixed in qnfo-fleet-control 0.57.0 (WFI-GREEN-STREAK-1: close only after 24 h with no failed main run, probe = wfiProbe), but wfiProbe is
--     written only into the contract of an issue filed AFTER that release. issue-100412 (deploy-gate, reopened 20+ times since 2026-10-21) and issue-1001336 (code-task-publish) still carry the
--     single-green probe "SELECT conclusion FROM workflow_main_state", so the D1 autoclose trigger (auto:verified-remediation-trigger) closed 1001336 at 2026-11-04 00:11:13Z and 14:34:17Z and
--     the next red run reopened it: 8 premature closes in 7 days. The contract of 1000747 itself ('0 premature closes in 7d') can never pass: expected is that literal and observed is
--     "N premature closes in 7d (M closes total)", so even N = 0 is a failing text comparison (probe-expected-must-equal-observed).
--  2. CHAOS-DRILL-FAILED-1 control:agent-issues-evidence-guard (issue 1001807): the alternate probe asks whether an issue of the last 14 days cites a missing evidence event without an annotation.
--     The trigger annotates at insert time only, and RETENTION-SWEEP-1 (2026-11-04) keeps housekeeping kinds of cloud_ops_events for 5 days, so any issue older than 5 days cites an event that was
--     PRUNED, not one that never existed: the newest hit is issue 1000117 (2026-10-25), none from the last 4 days. The probe fails at every drill for a reason that is not the guard.
--  3. CHAOS-DRILL-FAILED-1 control:research-revise-refs-extend (issue 1001808): clause 2 fails when no revise-patch event is 120 minutes old unless a research-budget event "daily budget exhausted" with
--     status ok is under 30 minutes old. Since BUDGET-SOFT-ROUTE-1 the executor no longer stops at the budget: it logs "tick allowance: one stage every 12 ticks" (ok) and "daily neuron target exceeded;
--     continuing on lean route" (warn) and runs a stage every 120 minutes, so revise-patch is legitimately absent for more than 120 minutes (revise-patch per hour on 2026-11-04: 0 at 18Z and 19Z,
--     1 at 20Z and 21Z) and the pause the clause looks for is never logged. The drill read this silence as a dead route at 20:05:45Z.
-- WHAT THIS CHANGES (data only)
--  1. issue-1000747's probe returns 'ok' when no WORKFLOW-FAILED-1 issue was closed within 24 h of a failed main run of its workflow SINCE 2026-11-05 (the fix date), and the counts text otherwise.
--  2. every active or holding contract of a WORKFLOW-FAILED-1 issue that still reads the single-green probe gets wfiProbe(name): green AND no failed main run in 24 h (the same text the intake writes).
--  3. agent-issues-evidence-guard looks at issues of the last 4 days (inside the 5-day retention), so a pruned event is not read as a dropped issue; the trigger text and the abort-trigger clauses are untouched.
--  4. research-revise-refs-extend also excuses the 120-minute silence when the executor's own throttle record (tick allowance / daily neuron target exceeded, written at least hourly) is under 90 minutes old AND a revise-patch
--     event exists in the last 12 hours, so a route that stopped for good still fails.
-- PREDICTION (decision_log): issue-1001336 / issue-100412 stop closing on a single green run (no premature close after the apply); the contract of 1000747 reads ok at its next pass;
--  control_alternate_probes agent-issues-evidence-guard and research-revise-refs-extend read last_pass = 1 at the 02:05Z drill and the chaos drill closes issues 1001807 and 1001808 itself.
--  Falsifier: a drill probe still fails with the same observed text, or a WORKFLOW-FAILED-1 issue closes within 24 h of a failure.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_workflow_drill_probes
-- Rollback: UPDATE remediation_contracts SET verify_probe = (SELECT b.verify_probe FROM bak_20261105_workflow_drill_probes b WHERE b.kind = 'contract' AND b.key = remediation_contracts.class) WHERE class IN (SELECT key FROM bak_20261105_workflow_drill_probes WHERE kind = 'contract'); UPDATE control_alternate_probes SET probe_sql = (SELECT b.verify_probe FROM bak_20261105_workflow_drill_probes b WHERE b.kind = 'drill' AND b.key = control_alternate_probes.control), window_note = (SELECT b.note FROM bak_20261105_workflow_drill_probes b WHERE b.kind = 'drill' AND b.key = control_alternate_probes.control) WHERE control IN (SELECT key FROM bak_20261105_workflow_drill_probes WHERE kind = 'drill')
-- CAUSE-MAPPED: registers no metric_registry row.

CREATE TABLE IF NOT EXISTS bak_20261105_workflow_drill_probes AS
SELECT 'contract' AS kind, class AS key, verify_probe, NULL AS note FROM remediation_contracts
WHERE class = 'issue-1000747' OR (issue_id IN (SELECT id FROM agent_issues WHERE title LIKE 'WORKFLOW-FAILED-1: %') AND status IN ('active', 'holding') AND instr(verify_probe, 'failure-within-24h') = 0 AND instr(verify_probe, 'FROM workflow_main_state WHERE workflow = ') > 0)
UNION ALL
SELECT 'drill', control, probe_sql, window_note FROM control_alternate_probes WHERE control IN ('agent-issues-evidence-guard', 'research-revise-refs-extend');

-- 1. the unsatisfiable probe of issue 1000747: expected is the literal ok and observed is ok when the fix holds
UPDATE remediation_contracts SET verify_probe = 'WITH closes AS (SELECT il.issue_id, il.ts AS close_ts, substr(ai.title, 20) AS workflow FROM issue_lifecycle il JOIN agent_issues ai ON ai.id = il.issue_id WHERE ai.title LIKE ''WORKFLOW-FAILED-1:%'' AND (il.event = ''closed'' OR (il.event = ''dispositioned'' AND il.to_status = ''closed'')) AND il.ts >= max(strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-7 days''), ''2026-11-05T00:00:00Z'')), bad AS (SELECT COUNT(*) AS n FROM closes c WHERE EXISTS (SELECT 1 FROM workflow_failures f WHERE f.workflow = c.workflow AND f.run_at <= c.close_ts AND f.run_at > strftime(''%Y-%m-%dT%H:%M:%SZ'', c.close_ts, ''-24 hours''))) SELECT ''ok'' AS expected, CASE WHEN bad.n = 0 THEN ''ok'' ELSE CAST(bad.n AS TEXT) || '' premature closes since 2026-11-05 ('' || CAST((SELECT COUNT(*) FROM closes) AS TEXT) || '' closes total)'' END AS observed FROM bad',
  verify_transport = 'd1-query', last_verdict = NULL, attempts = 0, next_due_at = datetime('now')
WHERE class = 'issue-1000747' AND instr(verify_probe, '0 premature closes in 7d') > 0;

-- 2. the single-green probes of reopened WORKFLOW-FAILED-1 issues get the 24-hour streak probe (qnfo-fleet-control wfiProbe)
UPDATE remediation_contracts SET verify_probe = 'SELECT ''success'' AS expected, (SELECT CASE WHEN EXISTS (SELECT 1 FROM workflow_failures WHERE workflow = ''' || replace((SELECT substr(a.title, 20) FROM agent_issues a WHERE a.id = remediation_contracts.issue_id), '''', '''''') || ''' AND run_at > strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-24 hours'')) THEN ''failure-within-24h'' ELSE conclusion END FROM workflow_main_state WHERE workflow = ''' || replace((SELECT substr(a.title, 20) FROM agent_issues a WHERE a.id = remediation_contracts.issue_id), '''', '''''') || ''') AS observed',
  verify_transport = 'd1-query', last_verdict = NULL, attempts = 0, next_due_at = datetime('now')
WHERE issue_id IN (SELECT id FROM agent_issues WHERE title LIKE 'WORKFLOW-FAILED-1: %') AND status IN ('active', 'holding') AND instr(verify_probe, 'failure-within-24h') = 0 AND instr(verify_probe, 'FROM workflow_main_state WHERE workflow = ') > 0;

-- 3. agent-issues-evidence-guard: 4 days, inside the 5-day retention of the events the issues cite
UPDATE control_alternate_probes SET probe_sql = replace(probe_sql, 'a.created_at > (CAST(strftime(''%s'', ''now'') AS INTEGER) - 1209600) * 1000', 'a.created_at > (CAST(strftime(''%s'', ''now'') AS INTEGER) - 345600) * 1000'),
  window_note = '4 days (CHAOS-DRILL-EVIDENCE-WINDOW-1 2026-11-05; was 14): the trigger text from sqlite_master plus the issues it should have annotated. The trigger annotates at insert time and cloud_ops_events housekeeping kinds are kept 5 days (RETENTION-SWEEP-1), so an older issue cites an event that was pruned, not one that never existed; the replay lives in migrations/control-alternate-probes.test.mjs and migrations/families-ops-b.test.mjs'
WHERE control = 'agent-issues-evidence-guard' AND instr(probe_sql, '- 1209600) * 1000') > 0;

-- 4. research-revise-refs-extend: the executor's soft-route throttle record excuses the 120-minute silence while a revise-patch exists in the last 12 hours
UPDATE control_alternate_probes SET probe_sql = replace(probe_sql, '''-30 minutes'')) THEN ''the revise route recorded no revise-patch event in 120 minutes', '''-30 minutes'')) AND NOT EXISTS (SELECT 1 FROM cloud_ops_events WHERE job = ''qnfo-research-exec'' AND kind = ''research-budget'' AND status IN (''ok'', ''warn'') AND (instr(COALESCE(text, ''''), ''tick allowance:'') = 1 OR instr(COALESCE(text, ''''), ''daily neuron target exceeded;'') = 1) AND ts > strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-90 minutes'') AND EXISTS (SELECT 1 FROM cloud_ops_events WHERE kind = ''revise-patch'' AND status IN (''ok'', ''warn'') AND ts > strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-720 minutes''))) THEN ''the revise route recorded no revise-patch event in 120 minutes'),
  window_note = window_note || ' | CHAOS-DRILL-SOFT-ROUTE-1 2026-11-05: since BUDGET-SOFT-ROUTE-1 the executor runs one stage every 12 ticks (120 minutes) over the daily target and logs research-budget "tick allowance:" (ok) or "daily neuron target exceeded;" (warn) instead of "daily budget exhausted", so clause 2 is also excused while one of those records is 90 minutes old or younger (the executor writes one at least hourly, at minute :01) AND a revise-patch event exists in the last 720 minutes; a route silent for 12 hours still fails'
WHERE control = 'research-revise-refs-extend' AND instr(probe_sql, 'tick allowance:') = 0 AND instr(probe_sql, '''-30 minutes'')) THEN ''the revise route recorded no revise-patch event in 120 minutes') > 0;

INSERT OR IGNORE INTO failure_modes (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id, trigger_condition, symptom, blast_radius) VALUES
 ('workflow-failed-single-green-probe',
  'a reopened WORKFLOW-FAILED-1 issue closes on one green main run and reopens at the next red one',
  'wfiProbe (24-hour green streak) is written only into the contract of an issue filed after qnfo-fleet-control 0.57.0; issue-100412 and issue-1001336 kept the single-green probe, which the D1 autoclose trigger reads',
  'WORKFLOW-AND-DRILL-PROBES-1 rewrites every active or holding WORKFLOW-FAILED-1 contract that still has the single-green probe',
  'fm-workflow-failed-single-green-probe: the number of active or holding WORKFLOW-FAILED-1 contracts without the 24-hour streak, expected 0', 'fm-workflow-failed-single-green-probe', '2026-11-05', 1000747,
  'issue_lifecycle shows closed then reopened within a day for a WORKFLOW-FAILED-1 issue', 'issue_refile_reopen loop on deploy-gate and code-task-publish', 'WORKFLOW-FAILED-1 issues');

INSERT OR IGNORE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, next_due_at, module, budget_ms, max_items, requires_container) VALUES
 ('fm-workflow-failed-single-green-probe', NULL, 'WORKFLOW-AND-DRILL-PROBES-1', 'failure-mode detector',
  'SELECT ''0'' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM remediation_contracts c JOIN agent_issues a ON a.id = c.issue_id WHERE a.title LIKE ''WORKFLOW-FAILED-1: %'' AND c.status IN (''active'', ''holding'') AND instr(c.verify_probe, ''FROM workflow_main_state WHERE workflow = '') > 0 AND instr(c.verify_probe, ''failure-within-24h'') = 0',
  'd1-query', 3, 'qnfo-fleet-control', 1, 'active', strftime('%Y-%m-%d %H:%M:%S', 'now'), 'failure-mode', 45000, 5, 0);

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:breach-doctor-probes-families-ops',
  'a drill or contract probe that fails for a reason other than the defect it guards is a defect of the probe, and is repaired by reading the same condition more precisely, never by weakening it',
  'WORKFLOW-AND-DRILL-PROBES-1: WORKFLOW-FAILED-1 contracts use the 24-hour streak probe; issue-1000747 probe returns the literal ok; the evidence-guard drill window is 4 days; the revise-refs-extend drill excuses the soft-route throttle',
  'issue_lifecycle: issue 1001336 closed 2026-11-04 00:11:13Z and 14:34:17Z on the single-green probe; cloud_ops_events oldest 2026-10-10, housekeeping kinds kept 5 days; revise-patch per hour 18Z 0, 19Z 0, 20Z 1, 21Z 1; research-budget text now tick allowance / daily neuron target exceeded',
  'the next drill (02:05Z) reads last_pass = 1 for both controls and closes their issues; WORKFLOW-FAILED-1 issues stay open through a single green run',
  'remediation_contracts (issue-1000747 and the single-green WORKFLOW-FAILED-1 contracts), control_alternate_probes (two rows)',
  'the Rollback line of this file; bak_20261105_workflow_drill_probes holds the previous probe texts and window notes',
  'WORKFLOW-FAILED-1 issues close only on a 24-hour streak for every contract; two chaos drill probes judge the control and not the retention or the throttle',
  'chaos drill 02:05Z: agent-issues-evidence-guard and research-revise-refs-extend pass; issue_lifecycle shows no WORKFLOW-FAILED-1 close within 24 h of a failure after 2026-11-05',
  'none', 'node migrations/families-ops-b.test.mjs (SQLite replay of the live probe texts and fixtures)'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'WORKFLOW-AND-DRILL-PROBES-1:%');
