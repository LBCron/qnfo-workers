-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE remediation_contracts SET issue_id=(SELECT issue_id FROM bak_20261102_probe_needed_1001216 WHERE class=remediation_contracts.class), precondition=(SELECT precondition FROM bak_20261102_probe_needed_1001216 WHERE class=remediation_contracts.class), action=(SELECT action FROM bak_20261102_probe_needed_1001216 WHERE class=remediation_contracts.class), verify_probe=(SELECT verify_probe FROM bak_20261102_probe_needed_1001216 WHERE class=remediation_contracts.class), verify_transport=(SELECT verify_transport FROM bak_20261102_probe_needed_1001216 WHERE class=remediation_contracts.class), max_attempts=(SELECT max_attempts FROM bak_20261102_probe_needed_1001216 WHERE class=remediation_contracts.class), escalate_to=(SELECT escalate_to FROM bak_20261102_probe_needed_1001216 WHERE class=remediation_contracts.class), expected_cadence_h=(SELECT expected_cadence_h FROM bak_20261102_probe_needed_1001216 WHERE class=remediation_contracts.class), status=(SELECT status FROM bak_20261102_probe_needed_1001216 WHERE class=remediation_contracts.class), ts=(SELECT ts FROM bak_20261102_probe_needed_1001216 WHERE class=remediation_contracts.class), last_attempt_at=(SELECT last_attempt_at FROM bak_20261102_probe_needed_1001216 WHERE class=remediation_contracts.class), last_verdict=(SELECT last_verdict FROM bak_20261102_probe_needed_1001216 WHERE class=remediation_contracts.class), module=(SELECT module FROM bak_20261102_probe_needed_1001216 WHERE class=remediation_contracts.class), budget_ms=(SELECT budget_ms FROM bak_20261102_probe_needed_1001216 WHERE class=remediation_contracts.class), next_due_at=(SELECT next_due_at FROM bak_20261102_probe_needed_1001216 WHERE class=remediation_contracts.class), max_items=(SELECT max_items FROM bak_20261102_probe_needed_1001216 WHERE class=remediation_contracts.class), requires_container=(SELECT requires_container FROM bak_20261102_probe_needed_1001216 WHERE class=remediation_contracts.class), attempts=(SELECT attempts FROM bak_20261102_probe_needed_1001216 WHERE class=remediation_contracts.class), deferred_since=(SELECT deferred_since FROM bak_20261102_probe_needed_1001216 WHERE class=remediation_contracts.class) WHERE class='issue-1001216' AND module='probe-needed-issue-1001216' AND EXISTS (SELECT 1 FROM bak_20261102_probe_needed_1001216 WHERE class=remediation_contracts.class); DELETE FROM remediation_contracts WHERE class='issue-1001216' AND module='probe-needed-issue-1001216' AND NOT EXISTS (SELECT 1 FROM bak_20261102_probe_needed_1001216 WHERE class=remediation_contracts.class);
-- PROBE-NEEDED-ISSUE-1001216-1 (2026-11-02, charter pillar autonomy).
-- Restore an active code-read contract for the open APPLIER-ROT-ERROR issue. Its report is produced on main by applier-doctor; require the report marker and absence of the affected script, never the issue's own status.

CREATE TABLE IF NOT EXISTS bak_20261102_probe_needed_1001216 AS
SELECT * FROM remediation_contracts WHERE class = 'issue-1001216';

UPDATE remediation_contracts
SET precondition = 'PROBE-NEEDED-ISSUE-1001216-1: APPLIER-ROT-ERROR is resolved when the applier-doctor report on main no longer names scripts/patch-sync-version-capture-1.py, never when issue 1001216 changes status',
    action = 'MEASURES the defect with a code-read probe against ci-status/applier-doctor.json on main: require the APPLIER-DOCTOR-2 marker and require that the report does not name scripts/patch-sync-version-capture-1.py in any list.',
    verify_probe = '{"paths":["ci-status/applier-doctor.json"],"contains":"\"marker\": \"APPLIER-DOCTOR-2\"","absent":"\"scripts/patch-sync-version-capture-1.py\""}',
    verify_transport = 'code-read',
    max_attempts = 24,
    escalate_to = 'qnfo-fleet-control',
    expected_cadence_h = 1,
    status = 'active',
    ts = datetime('now'),
    last_attempt_at = NULL,
    last_verdict = NULL,
    module = 'probe-needed-issue-1001216',
    next_due_at = datetime('now'),
    attempts = 0,
    deferred_since = NULL
WHERE class = 'issue-1001216' AND issue_id = 1001216 AND status = 'superseded'
  AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 1001216 AND status = 'open');

INSERT OR IGNORE INTO remediation_contracts
  (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module, next_due_at, attempts, last_verdict, deferred_since)
SELECT 'issue-1001216', 1001216,
       'PROBE-NEEDED-ISSUE-1001216-1: APPLIER-ROT-ERROR is resolved when the applier-doctor report on main no longer names scripts/patch-sync-version-capture-1.py, never when issue 1001216 changes status',
       'MEASURES the defect with a code-read probe against ci-status/applier-doctor.json on main: require the APPLIER-DOCTOR-2 marker and require that the report does not name scripts/patch-sync-version-capture-1.py in any list.',
       '{"paths":["ci-status/applier-doctor.json"],"contains":"\"marker\": \"APPLIER-DOCTOR-2\"","absent":"\"scripts/patch-sync-version-capture-1.py\""}',
       'code-read', 24, 'qnfo-fleet-control', 1, 'active', 'probe-needed-issue-1001216', datetime('now'), 0, NULL, NULL
WHERE EXISTS (SELECT 1 FROM agent_issues WHERE id = 1001216 AND status = 'open')
  AND NOT EXISTS (SELECT 1 FROM remediation_contracts WHERE class = 'issue-1001216');

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'qnfo-workers:PROBE-NEEDED-ISSUE-1001216-1',
       'The issue is resolved when the main-branch applier-doctor report is valid and no longer names the affected patch script.',
       'PROBE-NEEDED-ISSUE-1001216-1: reactivated issue-1001216 with a code-read verification probe.',
       'The issue description names scripts/patch-sync-version-capture-1.py and ci-status/applier-doctor.json; code-read validates the report marker and excludes the script path without reading issue status.',
       'Active verification path installed; issue closure awaits the next code-read run.',
       'remediation_contracts row issue-1001216.',
       'Rollback restores the backed-up contract from bak_20261102_probe_needed_1001216, or removes the row if this migration created it.',
       'An APPLIER-ROT-ERROR issue can be verified against the actual main-branch report.',
       'Issue 1001216 gains an active code-read probe; if the report no longer lists the script, its next run passes and the autoclose path can close the issue.',
       'One open autonomy issue moves to measured verification; no recovery is claimed before the probe runs.',
       'SQLite migration fixture and code-read parser/runtime; live closure awaits CI application and the remediation consumer.'
WHERE EXISTS (
  SELECT 1 FROM remediation_contracts
  WHERE class = 'issue-1001216' AND issue_id = 1001216
    AND status = 'active' AND verify_transport = 'code-read'
    AND verify_probe = '{"paths":["ci-status/applier-doctor.json"],"contains":"\"marker\": \"APPLIER-DOCTOR-2\"","absent":"\"scripts/patch-sync-version-capture-1.py\""}'
)
AND NOT EXISTS (
  SELECT 1 FROM decision_log
  WHERE actor = 'qnfo-workers:PROBE-NEEDED-ISSUE-1001216-1'
    AND action = 'PROBE-NEEDED-ISSUE-1001216-1: reactivated issue-1001216 with a code-read verification probe.'
);
