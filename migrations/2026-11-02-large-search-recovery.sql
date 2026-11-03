-- LARGE-SEARCH-RECOVERY-1 (issue 1001238, charter pillar autonomy).
-- Large tasks re-read main before proposing, but the nearest-match recovery skipped ctx.large,
-- retrying near-verbatim SEARCH blocks until the no-progress ceiling released the file.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE remediation_contracts SET (action, verify_probe, verify_transport, status) = (SELECT action, verify_probe, verify_transport, status FROM bak_20261102_large_search_contract WHERE class = remediation_contracts.class) WHERE class = 'issue-1001238' AND EXISTS (SELECT 1 FROM bak_20261102_large_search_contract WHERE class = 'issue-1001238'); UPDATE remediation_contracts SET status = 'superseded' WHERE class = 'fm-large-search-recovery'; revert the worker and mirror change through the canonical deploy.

CREATE TABLE IF NOT EXISTS bak_20261102_large_search_contract AS
SELECT class, action, verify_probe, verify_transport, status
FROM remediation_contracts WHERE class = 'issue-1001238';

INSERT OR IGNORE INTO failure_modes
  (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id)
VALUES ('large-search-recovery', 'large-file SEARCH failures repeat until the no-progress ceiling',
  'nearest-match recovery excluded large tasks even though baseFor re-reads main and relocates their bounded window',
  'LARGE-SEARCH-RECOVERY-1: use the same bounded recovery and exact replay validation for large and small tasks',
  'no-progress stops on qnfo-research-exec/worker.js within six hours',
  'fm-large-search-recovery', '2026-11-01', 1001238);

INSERT OR IGNORE INTO remediation_contracts
  (class, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module)
VALUES ('fm-large-search-recovery', 'LARGE-SEARCH-RECOVERY-1', 'failure-mode detector',
  'SELECT ''0'' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM code_tasks WHERE path = ''qnfo-research-exec/worker.js'' AND status IN (''failed'',''publish_failed'',''reverted'',''needs_human'') AND instr(COALESCE(last_error,''''),''NO-PROGRESS-CEILING-1'') = 1 AND julianday(updated_at) > julianday(''now'',''-6 hours'')',
  'd1-query', 3, 'qnfo-fleet-control', 1, 'active', 'failure-mode');

UPDATE remediation_contracts
SET action = 'LARGE-SEARCH-RECOVERY-1: verify zero no-progress stops for six hours after bounded large-file SEARCH recovery',
    verify_probe = (SELECT verify_probe FROM remediation_contracts WHERE class = 'fm-large-search-recovery'),
    verify_transport = 'd1-query',
    status = 'active'
WHERE class = 'issue-1001238';

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'copilot-6188', 'the bounded window and exact replay checks remain sufficient when the full file is re-read rather than stored',
  'LARGE-SEARCH-RECOVERY-1',
  'ct_6bx7qcqghzgvnn used a large-file window and failed a SEARCH with five of six file lines; regression reproduces the size-based exclusion',
  'pending canonical deployment and six-hour recurrence verification',
  'single-file patch proposals; no new routes, bindings or model calls',
  'Rollback in migrations/2026-11-02-large-search-recovery.sql and revert the worker fix',
  'large-file near-verbatim SEARCH recovery without retaining the full base in D1',
  'unique near SEARCH reaches ready_to_publish with one model call and zero failed attempts; ambiguous and out-of-window matches remain refused',
  'none', 'read-only D1 diagnosis; offline task-loop, moved-window, ambiguity and storage regressions'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action = 'LARGE-SEARCH-RECOVERY-1');
