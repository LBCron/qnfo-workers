-- RADAR-HEARTBEAT-RECOVERY-1: agent_issues 1000854 / 1000787, GitHub #5485; charter pillar core.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM remediation_contracts WHERE class = 'fm-radar-heartbeat-d1-transient'; DELETE FROM failure_modes WHERE fm_key = 'radar-heartbeat-d1-transient';

INSERT OR IGNORE INTO failure_modes
  (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id)
VALUES
  ('radar-heartbeat-d1-transient',
   'radar-hub loses its cron heartbeat after a transient D1 storage reset',
   'the heartbeat upsert made one write attempt; embedded var VERSION declarations also made its code-task remedy non-revertible',
   'retry only transient D1 errors at most three times with stable upsert bindings and backoff; name embedded versions so the merge runner can bump the hub alone',
   'fm-radar-heartbeat-d1-transient: terminal heartbeat errors in the original 360-minute observation window or no successful write within 120 minutes',
   'fm-radar-heartbeat-d1-transient', '2026-10-29', 1000854);

INSERT OR IGNORE INTO remediation_contracts
  (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module)
VALUES
  ('fm-radar-heartbeat-d1-transient', NULL, 'RADAR-HEARTBEAT-RECOVERY-1', 'failure-mode detector',
   'SELECT ''0'' AS expected, CAST((SELECT COUNT(*) FROM worker_logs WHERE script_name = ''radar-hub'' AND ts_ms > (strftime(''%s'', ''now'') - 360 * 60) * 1000 AND INSTR(COALESCE(logs_json, '''') || COALESCE(exceptions_json, ''''), ''fleet_heartbeat radar-hub:'') > 0) + CASE WHEN EXISTS (SELECT 1 FROM fleet_heartbeat WHERE worker = ''radar-hub'' AND ts >= strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-120 minutes'')) THEN 0 ELSE 1 END AS TEXT) AS observed',
   'd1-query', 3, 'qnfo-fleet-control', 1, 'active', 'failure-mode');

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'copilot:5485',
  'an idempotent heartbeat upsert can safely recover from a transient D1 reset even when the first response was lost',
  'RADAR-HEARTBEAT-RECOVERY-1: bounded heartbeat retries and one bumpable hub VERSION',
  'agent_issues 1000787 records a D1 storage timeout; ct_im1000787 and ct_vwhgluy03283va were refused for multiple var VERSION declarations',
  'branch regression tests cover recovery, exhausted retries, permanent failures, ambiguous commits, and the real merge-runner bump',
  'radar-hub scheduled heartbeat and embedded version identifiers; no binding, route, or cron change',
  'revert the worker and mirror through canonical deployment; remove the new detector and failure-mode row with the migration rollback',
  'recover transient heartbeat writes and allow automated rollback of radar-hub code tasks',
  'one or two transient D1 failures no longer lose a heartbeat; persistent failures remain logged after three attempts',
  'no direct reach gain',
  'radar-hub/cron-heartbeat.test.mjs and the radar-hub suite selection'
WHERE NOT EXISTS (
  SELECT 1 FROM decision_log
  WHERE action = 'RADAR-HEARTBEAT-RECOVERY-1: bounded heartbeat retries and one bumpable hub VERSION'
);
