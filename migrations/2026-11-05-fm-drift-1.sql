-- FM-DRIFT-1 (2026-11-05, charter pillar autonomy, program QNFO.OPS; cluster C9-FAILURE-MODES; failure mode contract-cadence-drift, metric failure_modes_recurring).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: no undo needed: a due time is rewritten by the next probe; the previous due times are in bak_20261105_fm_drift_1
-- CAUSE-MAPPED: registers no metric_registry row (it repairs a schedule behind fm-contract-cadence-drift and sla_breaches_over_120m).
--
-- MEASURED 2026-11-04 23:32Z (qnfo-audit, SELECT only): detector fm-contract-cadence-drift read 5 of expected 0 (open issues whose active/holding contract is due later than 90 minutes).
-- All five are passing contracts of open issues parked by FM-5 at "+105 minutes" (STEADY_CADENCE_H = 2 in scripts/remediation_consumer.py): metric-relapse-2607, metric-relapse-1000326,
-- issue-1000575, issue-1000609, issue-1001695, each gap 105 minutes. The back-off and the detector disagreed (105 > 90). scripts/remediation_consumer.py now backs off to 1.5 hours
-- ("+75 minutes"); this file re-schedules the contracts already parked beyond 90 minutes so they do not wait out the old due time.
-- Prediction: fm-contract-cadence-drift 5 -> 0 within one consumer run of the apply; sla_breaches_over_120m contracts_cadence_drift column falls with it.

CREATE TABLE IF NOT EXISTS bak_20261105_fm_drift_1 AS
SELECT c.class, c.issue_id, c.status, c.next_due_at, c.last_attempt_at, strftime('%Y-%m-%dT%H:%M:%SZ', 'now') AS saved_at
FROM remediation_contracts c JOIN agent_issues a ON a.id = c.issue_id
WHERE a.status = 'open' AND c.status IN ('active', 'holding') AND c.next_due_at IS NOT NULL AND datetime(c.next_due_at) > datetime('now', '+80 minutes');

UPDATE remediation_contracts
SET next_due_at = datetime('now', '+' || abs(random() % 30) || ' minutes')
WHERE class IN (SELECT c.class FROM remediation_contracts c JOIN agent_issues a ON a.id = c.issue_id
                WHERE a.status = 'open' AND c.status IN ('active', 'holding') AND c.next_due_at IS NOT NULL AND datetime(c.next_due_at) > datetime('now', '+80 minutes'));

INSERT INTO decision_log
 (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, surfaces_tested)
SELECT 'claude-code-session-2026-11-04-c9-failure-modes',
 'A back-off interval must sit inside the drift bound that audits it',
 'FM-DRIFT-1: STEADY_CADENCE_H 2 -> 1.5 in scripts/remediation_consumer.py; contracts of open issues parked beyond 80 minutes re-scheduled within 30',
 'fm-contract-cadence-drift observed 5, expected 0, at 2026-11-04 23:32Z; the five contracts passed with gap 105 minutes',
 'backed-off issue contracts are due 75 minutes after their probe',
 'next_due_at of the open-issue contracts parked beyond 80 minutes; scripts/remediation_consumer.py back-off interval',
 'revert STEADY_CADENCE_H to 2 and restore next_due_at from bak_20261105_fm_drift_1',
 'one rule for how late an open issue contract may be scheduled',
 'fm-contract-cadence-drift 5 -> 0 within one consumer run; remediation_verifications steady-state rows +30 percent for the backed-off issue contracts (about 1.9 K a day)',
 'scripts/remediation_consumer_steady_test.py (back-off offsets +75 and +37, bound 90) and migrations/fm-drift-1.test.mjs'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'FM-DRIFT-1:%');
