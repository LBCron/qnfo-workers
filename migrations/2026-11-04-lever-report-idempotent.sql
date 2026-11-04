-- LEVER-REPORT-IDEMPOTENT-1 (2026-11-04, charter pillar autonomy; issue 1001614 / GitHub #7134, CRON-FAULT-1 task-failed:management-personas).
-- WHAT WAS MEASURED (qnfo-audit, 2026-11-04 20:00-20:35Z, read-only until step 3):
--  * fleet_tasks management-personas-c (hourly :49, 12 steps) has not finished a run since it was split off (runs 68870, 69017, 69190 orphaned after 2 h, 69359 and 69528 'running').
--    Every one of those runs executed its step lever-report (agent_issues 99933, 1000618, 1000672, 1001556 carry the same 'Lever review by the Cloudflare agent' paragraph
--    5 times, updated_at 19:53:05Z = four seconds after run 69528 started) and none reached or finished lever-mark: 29 persona_actions lever-review rows sat at
--    to_value = 'requested' from 05:37Z to 20:30Z although their cf_agent_requests were done.
--  * lever-mark on its own is not slow: its SQL ran by hand in 235 ms (88,482 rows read, 27 rows changed). metric_improvement_now is a 306-row table read in 2 ms, so the
--    LIKE join in lever-log is not the hang. The lever-report WHERE clause alone reads 66,471 rows in 330 ms. What ends the invocation after lever-report is not established:
--    qnfo-fleet-control, qnfo-research-exec and qnfo-code-orchestrator log 'D1 DB is overloaded' within 20 s of the 19:53:01Z start (worker_logs 19:53:21Z).
-- WHAT THIS CHANGES: lever-report appended the same review every hour for as long as lever-mark did not follow it (its WHERE clause names no guard), so a stalled run multiplied
--  the paragraph (up to 5 copies, 2000 characters each, on issues whose description other loops parse for probes). The step now skips an issue whose description already
--  carries the paragraph of a still-pending request of that issue. A healthy run is unchanged: lever-report reports the lowest pending request, lever-mark marks it, the next
--  request is reported the next hour. The stall itself is NOT fixed by this file; the detector below reads it.
-- PREDICTION (decision_log): after this file no issue description gains a second copy of one 'Lever review by the Cloudflare agent (<instance>,' paragraph; the detector
--  fm-lever-mark-stalled reads 0 at the next :49 run if the run completes, and keeps reading the stall if it does not. Falsifier: a description with two copies of one instance
--  marker, or a lever review that is never reported (a persona_actions lever-review row 'requested' for a done request older than 3 h).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261104_lever_report_guard
-- Rollback: UPDATE fleet_tasks SET definition = (SELECT b.definition FROM bak_20261104_lever_report_guard b WHERE b.id = fleet_tasks.id), version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id IN (SELECT id FROM bak_20261104_lever_report_guard); DELETE FROM remediation_contracts WHERE class = 'fm-lever-mark-stalled'; DELETE FROM failure_modes WHERE fm_key = 'lever-mark-stalled';

CREATE TABLE IF NOT EXISTS bak_20261104_lever_report_guard AS
SELECT id, definition, version FROM fleet_tasks WHERE id IN ('management-personas', 'management-personas-c');

-- 1. guard the step (runs in whichever of the two tasks holds it; a task without it, or already guarded, is left alone)
UPDATE fleet_tasks
SET definition = json_set(
      definition,
      '$.steps[' || (SELECT key FROM json_each(fleet_tasks.definition, '$.steps') WHERE json_extract(value, '$.name') = 'lever-report') || '].sql',
      replace(
        (SELECT json_extract(value, '$.sql') FROM json_each(fleet_tasks.definition, '$.steps') WHERE json_extract(value, '$.name') = 'lever-report'),
        ' WHERE status = ''open'' AND (SELECT MIN(p.id) ',
        ' WHERE status = ''open'' AND NOT EXISTS (SELECT 1 FROM persona_actions g WHERE g.kind = ''lever-review'' AND g.to_value = ''requested'' AND g.issue_id = agent_issues.id AND instr(COALESCE(agent_issues.description, ''''), ''Lever review by the Cloudflare agent ('' || g.from_value || '','') > 0) AND (SELECT MIN(p.id) '
      )
    ),
    version = version + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id IN ('management-personas', 'management-personas-c')
  AND EXISTS (SELECT 1 FROM json_each(fleet_tasks.definition, '$.steps') WHERE json_extract(value, '$.name') = 'lever-report')
  AND instr((SELECT json_extract(value, '$.sql') FROM json_each(fleet_tasks.definition, '$.steps') WHERE json_extract(value, '$.name') = 'lever-report'), 'FROM persona_actions g WHERE g.kind = ''lever-review''') = 0
  AND instr((SELECT json_extract(value, '$.sql') FROM json_each(fleet_tasks.definition, '$.steps') WHERE json_extract(value, '$.name') = 'lever-report'), ' WHERE status = ''open'' AND (SELECT MIN(p.id) ') > 0;

INSERT OR IGNORE INTO failure_modes (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id, trigger_condition, symptom, blast_radius) VALUES
 ('lever-mark-stalled',
  'a lever review stays at to_value requested after its request is done, and the report step repeats the same paragraph on the issue every hour',
  'the hourly run of management-personas-c ends (invocation killed, run left running, orphaned after 2 h) after lever-report and before lever-mark has marked the rows, while D1 reports overload at the :53 start; lever-report had no guard against reporting the same request again',
  'LEVER-REPORT-IDEMPOTENT-1 skips an issue whose description already holds the paragraph of its pending request; the stall itself is read by this detector and owned by CRON-FAULT-1 (issue 1001614)',
  'fm-lever-mark-stalled: the number of lever-review rows still requested three hours after their request finished, expected 0',
  'fm-lever-mark-stalled', '2026-11-04', NULL,
  'management-personas-c does not finish a run (fleet_runs status running or orphaned) after lever-report',
  'duplicate Lever review paragraphs in issue descriptions; metric lever replies never marked reported or empty, so the 3-day cooldown and the retry of malformed replies do not apply',
  'metric lever reviews of the five program managers, issue descriptions of metric breaches');

INSERT OR IGNORE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, next_due_at, module, budget_ms, max_items, requires_container) VALUES
 ('fm-lever-mark-stalled', NULL, 'LEVER-REPORT-IDEMPOTENT-1', 'failure-mode detector',
  'SELECT ''0'' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM persona_actions p WHERE p.kind = ''lever-review'' AND p.to_value = ''requested'' AND p.ts < strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-3 hours'') AND EXISTS (SELECT 1 FROM cf_agent_requests r WHERE r.instance = p.from_value AND r.status IN (''done'', ''failed'', ''error''))',
  'd1-query', 3, 'qnfo-fleet-control', 1, 'active', strftime('%Y-%m-%d %H:%M:%S', 'now'), 'failure-mode', 45000, 5, 0);

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:cron-fault-mgmt-personas-c', 'a repeated append is the part of the stall that can be removed without knowing why the run ends; the stall stays open on issue 1001614',
  'LEVER-REPORT-IDEMPOTENT-1: lever-report skips an issue whose description already carries the paragraph of its pending request; lever-mark SQL run by hand once at about 20:30Z (27 of the 29 persona_actions rows that were requested became reported or empty; the 29 ids were 1010,1016,1017,1018,1021,1022,1023,1024,1025,1027,1028,1029,1030,1031,1077,1078,1079,1080,1081,1105,1106,1107,1108,1109,1273,1274,1275,1276,1277; undo: UPDATE persona_actions SET to_value = ''requested'' WHERE id IN (those ids))',
  'fleet_runs 69359 and 69528 running, 69190 orphaned; agent_issues 99933, 1000618, 1000672, 1001556 carry 5 copies; lever-mark by hand 235 ms, changes 27; lever-report WHERE 66,471 rows read, 330 ms; metric_improvement_now 306 rows',
  'no further duplicate paragraphs; the stall at lever-mark/brief-audit/rc-probe remains to be found and is read by fm-lever-mark-stalled', 'one workflow step, one read-only contract',
  'the Rollback line', 'a stalled hourly run no longer grows issue descriptions',
  'no issue description gains a second copy of one instance paragraph; detector reads 0 after the 20:49Z or 21:49Z run completes', NULL, 'migrations/lever-report-idempotent.test.mjs (stub tables, healthy and stalled sequences), live read-only measurement of every step'
WHERE NOT EXISTS (SELECT 1 FROM decision_log d WHERE d.action LIKE 'LEVER-REPORT-IDEMPOTENT-1:%');
