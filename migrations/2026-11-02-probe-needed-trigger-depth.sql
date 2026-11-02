-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261102_probe_needed_trigger_depth
-- Rollback: DELETE FROM remediation_contracts WHERE class = 'issue-1001212' AND NOT EXISTS (SELECT 1 FROM bak_20261102_probe_needed_trigger_depth WHERE class = 'issue-1001212'); UPDATE remediation_contracts SET verify_probe = (SELECT verify_probe FROM bak_20261102_probe_needed_trigger_depth WHERE class = 'issue-1001212'), verify_transport = (SELECT verify_transport FROM bak_20261102_probe_needed_trigger_depth WHERE class = 'issue-1001212'), status = (SELECT status FROM bak_20261102_probe_needed_trigger_depth WHERE class = 'issue-1001212'), last_verdict = (SELECT last_verdict FROM bak_20261102_probe_needed_trigger_depth WHERE class = 'issue-1001212'), attempts = (SELECT attempts FROM bak_20261102_probe_needed_trigger_depth WHERE class = 'issue-1001212'), deferred_since = (SELECT deferred_since FROM bak_20261102_probe_needed_trigger_depth WHERE class = 'issue-1001212'), next_due_at = (SELECT next_due_at FROM bak_20261102_probe_needed_trigger_depth WHERE class = 'issue-1001212') WHERE class = 'issue-1001212' AND EXISTS (SELECT 1 FROM bak_20261102_probe_needed_trigger_depth WHERE class = 'issue-1001212')
-- PROBE-NEEDED-1 for issue 1001212 / tracker issue 1001222 (charter pillar: autonomy).
-- The trigger-depth sweep records its actual table-write findings in remediation_verifications.
CREATE TABLE IF NOT EXISTS bak_20261102_probe_needed_trigger_depth AS
SELECT class, verify_probe, verify_transport, status, last_verdict, attempts, deferred_since, next_due_at
FROM remediation_contracts
WHERE class = 'issue-1001212';

UPDATE remediation_contracts
SET verify_probe = 'SELECT ''ok'' AS expected, COALESCE((SELECT observed FROM remediation_verifications WHERE class = ''fm-trigger-depth-compile'' AND verifier = ''trigger-depth-sweep'' AND datetime(verified_at) >= datetime(''now'', ''-60 minutes'') ORDER BY id DESC LIMIT 1), ''pending:no recent trigger-depth sweep'') AS observed',
    verify_transport = 'd1-query',
    status = 'active',
    last_verdict = NULL,
    attempts = 0,
    deferred_since = NULL,
    next_due_at = datetime('now')
WHERE class = 'issue-1001212'
  AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 1001212 AND status = 'open');

INSERT OR IGNORE INTO remediation_contracts
  (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts,
   escalate_to, expected_cadence_h, status, module, attempts, deferred_since, next_due_at)
SELECT 'issue-1001212', 1001212, 'TRIGGER-DEPTH-COMPILE-1: fresh trigger-depth-sweep result',
  'Verify the latest trigger-depth-sweep result; remain pending until a recent scan reports ok.',
  'SELECT ''ok'' AS expected, COALESCE((SELECT observed FROM remediation_verifications WHERE class = ''fm-trigger-depth-compile'' AND verifier = ''trigger-depth-sweep'' AND datetime(verified_at) >= datetime(''now'', ''-60 minutes'') ORDER BY id DESC LIMIT 1), ''pending:no recent trigger-depth sweep'') AS observed',
  'd1-query', 3, 'qnfo-fleet-control', 1, 'active', 'probe-needed-1001222', 0, NULL, datetime('now')
WHERE EXISTS (SELECT 1 FROM agent_issues WHERE id = 1001212 AND status = 'open');

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain,
   predicted_outcome, reach_gain, surfaces_tested)
SELECT 'copilot:issue-1001222',
  'the trigger-depth sweep writes current findings to remediation_verifications, so its result measures the root defect without consulting issue status',
  'PROBE-NEEDED-1: activate a live trigger-depth contract for issue 1001212',
  'scripts/trigger_depth_sweep.py records class fm-trigger-depth-compile with verifier trigger-depth-sweep and observed ok or nested-too-deep',
  'migration adds a due d1-query contract; the next sweep and remediation run provide live verification',
  'remediation_contracts class issue-1001212',
  'Rollback restores the prior contract fields from bak_20261102_probe_needed_trigger_depth or removes the newly inserted contract',
  'open trigger-depth defects are checked against the sweep result rather than issue status',
  'issue 1001212 receives fresh defect measurements and remains pending until a recent sweep reports ok',
  'no direct reach gain',
  'SQLite fixture covers stale, failing and passing sweep results, missing contract, closed issue and rollback'
WHERE NOT EXISTS (
  SELECT 1 FROM decision_log
  WHERE action = 'PROBE-NEEDED-1: activate a live trigger-depth contract for issue 1001212'
)
AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 1001212 AND status = 'open');
