-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261102_probe_needed_1001224
-- Rollback: DELETE FROM remediation_contracts WHERE class = 'issue-1001224' AND module = 'probe-needed-issue-1001224'; INSERT OR IGNORE INTO remediation_contracts SELECT * FROM bak_20261102_probe_needed_1001224;

-- PROBE-NEEDED-ISSUE-1001224-1 (2026-11-02, charter pillar autonomy).
-- Measure the specific exhausted grounding failure on its research_queue row; a missing row fails closed, and the probe never reads issue status.

CREATE TABLE IF NOT EXISTS bak_20261102_probe_needed_1001224 AS
SELECT * FROM remediation_contracts WHERE class = 'issue-1001224';

UPDATE remediation_contracts
SET precondition = 'The named research_queue row no longer remains parked with the exhausted full-text bibliography gate-refcount failure.',
    action = 'MEASURES the named research_queue row: expected 0 while the exhausted terminal failure remains or the row is missing, and 1 only after the row is present without that failure.',
    verify_probe = 'SELECT ''0'' AS expected, CAST(CASE WHEN NOT EXISTS (SELECT 1 FROM research_queue WHERE id = ''rem-d7554b7e-e87f-4615-80d6-921ba3b57f7a'') OR EXISTS (SELECT 1 FROM research_queue WHERE id = ''rem-d7554b7e-e87f-4615-80d6-921ba3b57f7a'' AND status = ''wontfix'' AND stage = ''parked'' AND recover_count >= 3 AND instr(COALESCE(error, ''''), ''bibliography 4 < 5 entries with full text'') > 0 AND instr(COALESCE(error, ''''), ''gate-refcount cannot pass'') > 0) THEN ''1'' ELSE ''0'' END AS TEXT) AS observed',
    verify_transport = 'd1-query',
    status = 'active',
    ts = datetime('now'),
    last_attempt_at = NULL,
    last_verdict = NULL,
    module = 'probe-needed-issue-1001224',
    next_due_at = datetime('now'),
    attempts = 0,
    deferred_since = NULL
WHERE class = 'issue-1001224' AND issue_id = 1001224 AND status = 'superseded'
  AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 1001224 AND status = 'open');

INSERT OR IGNORE INTO remediation_contracts
  (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module, next_due_at, attempts, last_verdict, deferred_since)
SELECT 'issue-1001224', 1001224,
       'The named research_queue row no longer remains parked with the exhausted full-text bibliography gate-refcount failure.',
       'MEASURES the named research_queue row: expected 0 while the exhausted terminal failure remains or the row is missing, and 1 only after the row is present without that failure.',
       'SELECT ''0'' AS expected, CAST(CASE WHEN NOT EXISTS (SELECT 1 FROM research_queue WHERE id = ''rem-d7554b7e-e87f-4615-80d6-921ba3b57f7a'') OR EXISTS (SELECT 1 FROM research_queue WHERE id = ''rem-d7554b7e-e87f-4615-80d6-921ba3b57f7a'' AND status = ''wontfix'' AND stage = ''parked'' AND recover_count >= 3 AND instr(COALESCE(error, ''''), ''bibliography 4 < 5 entries with full text'') > 0 AND instr(COALESCE(error, ''''), ''gate-refcount cannot pass'') > 0) THEN ''1'' ELSE ''0'' END AS TEXT) AS observed',
       'd1-query', 24, 'qnfo-research-exec', 1, 'active', 'probe-needed-issue-1001224', datetime('now'), 0, NULL, NULL
WHERE EXISTS (SELECT 1 FROM agent_issues WHERE id = 1001224 AND status = 'open')
  AND NOT EXISTS (SELECT 1 FROM remediation_contracts WHERE class = 'issue-1001224');

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'qnfo-workers:PROBE-NEEDED-ISSUE-1001224-1',
       'The defect remains while the named research_queue row is parked with the exhausted bibliography full-text gate-refcount error; a missing row is insufficient evidence of recovery.',
       'PROBE-NEEDED-ISSUE-1001224-1: re-armed issue-1001224 with a row-specific D1 failure probe.',
       'Read-only qnfo-audit query: issue 1001224 is open, its contract is superseded, and row rem-d7554b7e-e87f-4615-80d6-921ba3b57f7a is wontfix/parked with recover_count 3 and the named error.',
       'An active hourly D1 probe measures the underlying queue failure; issue closure awaits a passing live probe.',
       'remediation_contracts class issue-1001224 only.',
       'Rollback restores the backed-up contract from bak_20261102_probe_needed_1001224, or removes it if this migration created it; decision history remains append-only.',
       'The open terminal bibliography issue has a live verification path that measures its named queue row.',
       'The probe observes 1 while the failed terminal row remains and 0 only after that row is present without the failure.',
       'One autonomy reliability issue gains measurable verification; no recovery is claimed before the probe runs.',
       'SQLite migration regression test; CI migration application and qnfo-audit remediation-consumer probe.'
WHERE EXISTS (
  SELECT 1 FROM remediation_contracts
  WHERE class = 'issue-1001224' AND issue_id = 1001224
    AND status = 'active' AND verify_transport = 'd1-query'
    AND module = 'probe-needed-issue-1001224'
)
AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 1001224 AND status = 'open')
AND NOT EXISTS (
  SELECT 1 FROM decision_log
  WHERE actor = 'qnfo-workers:PROBE-NEEDED-ISSUE-1001224-1'
    AND action = 'PROBE-NEEDED-ISSUE-1001224-1: re-armed issue-1001224 with a row-specific D1 failure probe.'
);
