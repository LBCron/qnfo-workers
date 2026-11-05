-- PLAN-STARVATION-1 + DISABLED-TRIGGER-TICKET-1 (2026-11-05, pillar autonomy; metrics issues_over_24h_no_doer, driver_drain_24h, open_agent_issues, orphan_issues_no_live_path).
-- WHAT WAS READ (qnfo-audit, 2026-11-05 03Z):
--   planner   issue_plans held 0 rows planned in the last 12 h (about 8 planner tasks a day before 2026-11-04T15Z; 34 of the planner's last 77 tasks merged). planIssues was shut by its
--             work-in-progress gate: 50 queued code_tasks rows on 21 files against code_plan_wip 40, while issue intake and this RED-DRAIN-1 dispatch refill the queue up to
--             MAX_OPEN_TASKS (48) whenever the loop frees a slot, so an issue with no code-task line never reached a doer. qnfo-code-orchestrator 0.48.3 counts files in motion and keeps
--             6 slots for the planner on the intake side; this file does the same for the RED-DRAIN-1 dispatch (step 3 of fleet_tasks red-drain, LIMIT 5 an hour): it adds nothing while
--             42 or more tasks are queued, so the last 6 slots of the queue stay with the planner.
--   tickets   Six open METRIC-TRIGGER tickets belong to triggers that were disabled by a recorded decision (enabled = 0: 341 owner-outcome, 404 owner-outcome, 409 duplicate of 3689,
--             1868 suppressed until 20 judged decisions exist, 5916 duplicate and contradicts the owner directive 2026-10-26 pub-gate-v4-no-withdraw, 5944 duplicate of 9901). Each ticket's
--             monitoring contract probes v_metric_trigger_state for that trigger id, a row a disabled trigger does not have, so none can ever converge (they were counted as
--             no-doer, unprobed or orphan issues for 10 to 30 days). Two have an enabled parent in metric_deps (409 -> 3689 ticket 99938, 5944 -> 9901 ticket 100301): superseded by that ticket;
--             the other four are closed as moot with the trigger notes as evidence. Re-enabling a trigger files a new ticket, so nothing is lost.
-- WHAT THIS FILE ADDS
--   1. fleet_tasks red-drain step 3 (the code-task dispatch) gets `AND queued < 42` (QUEUE-HEADROOM-1); everything else in the workflow is byte for byte as before.
--   2. The six dead-end tickets are closed with evidence (close_channel session:breach-remediation), their contracts superseded; before-state in bak_20261105_disabled_trigger_tickets.
--   3. Detector fm-disabled-trigger-ticket-open (expected 0) so a later disabled trigger with an open ticket is seen within the hour, and fm-planner-silent (the planner wrote a verdict in the last 12 h).
-- Prediction: issue_plans gets rows again within 3 h of the deploy (>= 20 rows in 12 h, >= 3 queued planner tasks a day); driver_drain_24h stays above 0.05; open_agent_issues -6; orphan_issues_no_live_path -6 or fewer.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE fleet_tasks SET definition = b.definition, version = fleet_tasks.version + 1, updated_at = datetime('now') FROM bak_20261105_red_drain_def b WHERE fleet_tasks.id = b.id; UPDATE agent_issues SET status = 'open', close_channel = (SELECT x.issue_close_channel FROM bak_20261105_disabled_trigger_tickets x WHERE x.issue_id = agent_issues.id), updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000 WHERE id IN (SELECT issue_id FROM bak_20261105_disabled_trigger_tickets) AND status = 'closed'; UPDATE issue_triage SET triage_state = (SELECT x.triage_state FROM bak_20261105_disabled_trigger_tickets x WHERE x.issue_id = issue_triage.issue_id), close_evidence = (SELECT x.triage_close_evidence FROM bak_20261105_disabled_trigger_tickets x WHERE x.issue_id = issue_triage.issue_id) WHERE issue_id IN (SELECT issue_id FROM bak_20261105_disabled_trigger_tickets); UPDATE remediation_contracts SET status = 'monitoring', last_verdict = 'monitoring:metric-condition (rollback of DISABLED-TRIGGER-TICKET-1)' WHERE issue_id IN (SELECT issue_id FROM bak_20261105_disabled_trigger_tickets) AND last_verdict LIKE 'superseded:closure-superseded (DISABLED-TRIGGER%'; DELETE FROM remediation_contracts WHERE class IN ('fm-disabled-trigger-ticket-open', 'fm-planner-silent'); DELETE FROM failure_modes WHERE fm_key IN ('disabled-trigger-ticket-open', 'planner-silent');
-- Closing probe: SELECT COUNT(*) FROM issue_plans WHERE planned_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-12 hours'); -- >= 20 after the deploy and the queue falling below 48

CREATE TABLE IF NOT EXISTS bak_20261105_red_drain_def AS
SELECT id, definition, version, updated_at FROM fleet_tasks WHERE id = 'red-drain';

UPDATE fleet_tasks SET definition = json_set(
    definition,
    '$.steps[3].sql',
    replace(json_extract(definition, '$.steps[3].sql'), 'LIMIT 5', 'AND (SELECT COUNT(*) FROM code_tasks WHERE status = ''queued'') < 42 /* QUEUE-HEADROOM-1 */ LIMIT 5')),
  version = version + 1, updated_at = datetime('now')
WHERE id = 'red-drain'
  AND json_extract(definition, '$.steps[3].sql') LIKE '%RED-DRAIN-1 dispatch%'
  AND json_extract(definition, '$.steps[3].sql') NOT LIKE '%QUEUE-HEADROOM-1%';

CREATE TABLE IF NOT EXISTS bak_20261105_disabled_trigger_tickets AS
SELECT a.id AS issue_id, a.status AS issue_status, a.close_channel AS issue_close_channel, a.updated_at AS issue_updated_at,
  t.triage_state AS triage_state, t.owner AS triage_owner, t.close_evidence AS triage_close_evidence,
  (SELECT group_concat(c.class || '=' || c.status || '/' || COALESCE(c.last_verdict, ''), ' | ') FROM remediation_contracts c WHERE c.issue_id = a.id) AS contracts
FROM agent_issues a LEFT JOIN issue_triage t ON t.issue_id = a.id
WHERE a.id IN (1753, 2022, 2467, 2564, 99928, 99954);

UPDATE remediation_contracts SET status = 'superseded', last_verdict = 'superseded:closure-superseded (DISABLED-TRIGGER-TICKET-1)', last_attempt_at = datetime('now'), next_due_at = NULL
WHERE issue_id IN (
    SELECT a.id FROM agent_issues a
    JOIN analytics_metric_triggers t ON t.id = CAST(substr(a.title, 16, instr(substr(a.title, 16), '-') - 1) AS INTEGER)
    WHERE a.id IN (1753, 2022, 2467, 2564, 99928, 99954) AND a.status = 'open' AND a.title LIKE 'METRIC-TRIGGER-%' AND t.enabled = 0)
  AND status IN ('monitoring', 'escalated', 'active', 'holding', 'needs-machine-probe', 'probe-review-refused');

UPDATE agent_issues SET close_channel = 'session:breach-remediation'
WHERE id IN (1753, 2022, 2467, 2564, 99928, 99954) AND status = 'open' AND title LIKE 'METRIC-TRIGGER-%'
  AND EXISTS (SELECT 1 FROM analytics_metric_triggers t WHERE t.id = CAST(substr(agent_issues.title, 16, instr(substr(agent_issues.title, 16), '-') - 1) AS INTEGER) AND t.enabled = 0);

UPDATE issue_triage SET triage_state = 'closed', triaged_at = datetime('now'),
  close_evidence = (
    SELECT CASE WHEN s.id IS NOT NULL
      THEN 'SUPERSEDED BY #' || s.id || ': trigger ' || t.id || ' (' || t.metric_key || ') is disabled (analytics_metric_triggers.enabled = 0) and metric_deps names its enabled parent ' || d.parent_metric || ', whose open ticket #' || s.id || ' carries the breach; this ticket probes v_metric_trigger_state id ' || t.id || ', a row a disabled trigger does not have, so it could never converge. Read 2026-11-05.'
      ELSE 'MOOT: trigger ' || t.id || ' (' || t.metric_key || ') is disabled (analytics_metric_triggers.enabled = 0, decision recorded in its notes), so evaluateMetricTriggers files nothing for it and this ticket''s probe, which reads v_metric_trigger_state id ' || t.id || ', has no row to converge on. The metric stays measured in metric_registry (last_value ' || COALESCE(m.last_value, 'n/a') || ') and is tracked where the decision in the trigger notes says; re-enabling the trigger files a new ticket. Read 2026-11-05.' END
    FROM agent_issues a
    JOIN analytics_metric_triggers t ON t.id = CAST(substr(a.title, 16, instr(substr(a.title, 16), '-') - 1) AS INTEGER)
    LEFT JOIN metric_registry m ON m.metric = t.metric_key
    LEFT JOIN metric_deps d ON d.child_metric = t.metric_key AND d.active = 1 AND d.relation = 'disabled-duplicate'
    LEFT JOIN analytics_metric_triggers pt ON pt.metric_key = d.parent_metric AND pt.enabled = 1
    LEFT JOIN agent_issues s ON s.status = 'open' AND s.title LIKE 'METRIC-TRIGGER-' || pt.id || '-%'
    WHERE a.id = issue_triage.issue_id AND a.status = 'open' AND t.enabled = 0
    LIMIT 1)
WHERE issue_id IN (1753, 2022, 2467, 2564, 99928, 99954)
  AND EXISTS (
    SELECT 1 FROM agent_issues a
    JOIN analytics_metric_triggers t ON t.id = CAST(substr(a.title, 16, instr(substr(a.title, 16), '-') - 1) AS INTEGER)
    WHERE a.id = issue_triage.issue_id AND a.status = 'open' AND a.title LIKE 'METRIC-TRIGGER-%' AND t.enabled = 0);

INSERT OR IGNORE INTO failure_modes
  (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id)
VALUES ('disabled-trigger-ticket-open', 'an open METRIC-TRIGGER ticket outlives the decision that disabled its trigger',
  'a trigger is disabled by a migration (owner-outcome, duplicate, suppressed) but the ticket it filed earlier stays open with a monitoring contract that reads a v_metric_trigger_state row the disabled trigger no longer has',
  'DISABLED-TRIGGER-TICKET-1: the migration that disables a trigger closes its open ticket (superseded by the enabled parent in metric_deps, else moot with the notes as evidence)',
  'open METRIC-TRIGGER tickets older than 24 h whose trigger has enabled = 0',
  'fm-disabled-trigger-ticket-open', '2026-11-05', 99916),
 ('planner-silent', 'the issue planner writes no verdict for hours although open issues have none',
  'planIssues returned early on its work-in-progress gate (rows, not files) while intake and the dispatch kept the queue full, and the early returns wrote no event',
  'PLAN-STARVATION-1: work in progress counts files, the intake and the dispatch keep slots for the planner, code-task.plan-gated names the gate once per 30 minutes',
  'no issue_plans row planned in the last 12 hours',
  'fm-planner-silent', '2026-11-05', 100301);

INSERT OR IGNORE INTO remediation_contracts
  (class, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module)
VALUES ('fm-disabled-trigger-ticket-open', 'DISABLED-TRIGGER-TICKET-1', 'failure-mode detector',
  'SELECT ''0'' AS expected, CAST((SELECT COUNT(*) FROM agent_issues a JOIN analytics_metric_triggers t ON t.id = CAST(substr(a.title, 16, instr(substr(a.title, 16), ''-'') - 1) AS INTEGER) WHERE a.status = ''open'' AND a.title LIKE ''METRIC-TRIGGER-%'' AND t.enabled = 0 AND a.created_at < (CAST(strftime(''%s'', ''now'') AS INTEGER) - 86400) * 1000) AS TEXT) AS observed',
  'd1-query', 3, 'qnfo-fleet-control', 1, 'active', 'failure-mode');

INSERT OR IGNORE INTO remediation_contracts
  (class, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module, next_due_at)
VALUES ('fm-planner-silent', 'PLAN-STARVATION-1', 'failure-mode detector',
  'SELECT ''1'' AS expected, CASE WHEN EXISTS (SELECT 1 FROM issue_plans WHERE planned_at > strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-12 hours'')) THEN ''1'' ELSE ''0'' END AS observed',
  'd1-query', 3, 'qnfo-code-orchestrator', 1, 'active', 'failure-mode', datetime('now', '+3 hours'));

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:breach-issue-backlog', 'a planner that writes nothing for 12 h with 334 doer-less issues is starved, not idle',
  'PLAN-STARVATION-1', 'issue_plans 0 rows in 12 h; 50 queued rows on 21 files vs code_plan_wip 40; intake and red-drain refill to 48; planner tasks merged 34 of 77 in 10 days',
  'pending CI apply, orchestrator 0.48.3 deploy and live verification', 'red-drain dispatch step 3, six dead-end METRIC-TRIGGER tickets, two detector contracts',
  'Rollback line in migrations/2026-11-05-red-drain-headroom.sql', 'the planner can reach a doer for issues with no code-task line again',
  'issue_plans >= 20 rows in 12 h after deploy; driver_drain_24h >= 0.05; open_agent_issues -6', 'none', 'live read-only D1 diagnosis; offline SQLite suite migrations/red-drain-headroom.test.mjs'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action = 'PLAN-STARVATION-1');
