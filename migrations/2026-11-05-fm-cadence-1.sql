-- FM-CADENCE-1 (2026-11-05, charter pillar autonomy, program QNFO.OPS; metric failure_modes_recurring 208 = 80 recurring + 132 unprobed; METRIC-TRIGGER issue 3002; cluster C9-FAILURE-MODES).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM remediation_contracts WHERE class = 'fm-standing-detector-backed-off'; DELETE FROM failure_modes WHERE fm_key = 'standing-detector-backed-off'; (the restagger of next_due_at below needs no undo: a due time is rewritten by the next probe)
-- BACKUP: bak_20261105_fm_cadence_1
-- CAUSE-MAPPED: registers no metric_registry row (it repairs the cadence behind failure_modes_recurring and adds one failure-mode detector contract).
--
-- MEASURED 2026-11-04 22:44-23:05Z (qnfo-audit, SELECT only). v_failure_mode_status read 338 absent, 19 ci-guarded, 80 recurring, 132 unprobed; failure_modes_recurring = 212 (208 at the last refresh).
-- Of the 132 unprobed, 117 had their newest verification 90-120 minutes ago, 8 had 60-90, 10 never, 1 older: the detectors ran, but not every 60 minutes, which is the
-- freshness window of the view and of the doctrine measure failure_modes_unprobed_pct (FAILURE-MODE-PROBES-1, DETECTOR-CADENCE-1: "failure-mode detectors and belief probes must run every cycle").
-- Cause: FM-5 (2026-10-28, scripts/remediation_consumer.py steady_state_cadence, written for issue contracts such as 1000473 re-verified with observed=0) parks a contract whose last six
-- verifications passed with one observed value at STEADY_CADENCE_H = 2 hours, "+105 minutes". Every healthy fm-* detector reads the same value for ever, so all of them were parked:
-- remediation_contracts for class LIKE 'fm-%' hold 324 d1-query + 111 code-read + 19 other passing contracts with next_due_at 95-105 minutes after the last attempt, and the in-Cloudflare
-- tick (qnfo-fleet-control remediationContractsTick, every 10 minutes, d1-query transports, re-stamps +18 minutes) found them not due. remediation_verifications verifier counts for class LIKE 'fm-%'
-- 17:00-22:59Z: remediation-consumer 90 percent, tick 10 percent. Before FM-5 (agent_issues 3002 triage 2026-10-19) the same view read 2 unprobed.
-- Fix (scripts/remediation_consumer.py, same pull request): fm- and belief- contracts never take the steady-state back-off, so a passing detector is due again 22 minutes after its probe and both
-- executors keep it fresh. This file (1) re-staggers the parked contracts over the next 25 minutes instead of waiting up to 105 minutes for each to fall due, and (2) adds the detector that
-- would have caught the cause: no active standing detector may be scheduled more than 45 minutes ahead (the view window is 60; the tick runs every 10).
-- Prediction: failure_modes_recurring 208 -> at most 100 within 3 hours of the deploy (80 recurring remain until their own causes are fixed, plus about 10 never-probed), unprobed <= 10.
-- Cost: remediation_verifications fm-* rows a day go from about 4,000 (2026-11-04) to about 11,000 (the 2026-10-29..31 level, 10.6-11.4 K) and stay below the 2026-10 total of 22-25 K a day.

CREATE TABLE IF NOT EXISTS bak_20261105_fm_cadence_1 AS
SELECT class, status, next_due_at, last_attempt_at, strftime('%Y-%m-%dT%H:%M:%SZ', 'now') AS saved_at FROM remediation_contracts
WHERE status = 'active' AND (class LIKE 'fm-%' OR class LIKE 'belief-%') AND next_due_at > datetime('now', '+45 minutes');

-- (1) re-stagger: a parked standing detector is due within the next 25 minutes, spread so one consumer run and one tick do not receive them all at once.
UPDATE remediation_contracts
SET next_due_at = datetime('now', '+' || abs(random() % 25) || ' minutes')
WHERE status = 'active' AND (class LIKE 'fm-%' OR class LIKE 'belief-%') AND next_due_at > datetime('now', '+45 minutes');

-- (2) the detector for the cause
INSERT OR IGNORE INTO failure_modes
 (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, trigger_condition, symptom, blast_radius)
VALUES
 ('standing-detector-backed-off',
  'a standing fm-* or belief-* detector is scheduled further ahead than the 60-minute freshness window of v_failure_mode_status, so it reads unprobed while it passes',
  'FM-5 (scripts/remediation_consumer.py steady_state_cadence) applied the 2-hour steady-state back-off to every contract whose last six verifications passed with one observed value; every healthy detector qualifies, so on 2026-11-04 117 of 132 unprobed detectors had last been probed 90-120 minutes earlier',
  'FM-CADENCE-1: standing_detector() in scripts/remediation_consumer.py exempts fm- and belief- from the back-off (test: scripts/remediation_consumer_steady_test.py); the migration re-staggers the parked contracts; contract fm-standing-detector-backed-off counts active standing detectors due more than 45 minutes ahead',
  'fm-standing-detector-backed-off', 'fm-standing-detector-backed-off', '2026-11-05',
  'a cadence rule, back-off, hold or cap is applied to contracts whose class starts with fm- or belief-',
  'failure_modes_recurring counts passing detectors as unprobed (132 of 208 on 2026-11-04)',
  'the guard metric failure_modes_recurring and every roadmap row FM-* that waits for its detector to read absent');

INSERT OR IGNORE INTO remediation_contracts
 (class, issue_id, verify_probe, verify_transport, max_attempts, expected_cadence_h, status, precondition, action, escalate_to, module, next_due_at)
VALUES
 ('fm-standing-detector-backed-off', NULL,
  'SELECT ''0'' AS expected, CAST((SELECT COUNT(*) FROM remediation_contracts WHERE status = ''active'' AND (class LIKE ''fm-%'' OR class LIKE ''belief-%'') AND next_due_at > datetime(''now'', ''+45 minutes'')) AS TEXT) AS observed',
  'd1-query', 3, 1, 'active', 'FM-CADENCE-1',
  'failure-mode detector: no active fm- or belief- contract is due more than 45 minutes ahead; find the writer that stamped next_due_at (scripts/remediation_consumer.py next_due_offset/steady_state_cadence, qnfo-fleet-control rtNextDueOffset) and exempt standing detectors',
  'qnfo-fleet-control', 'failure-mode', datetime('now'));

INSERT INTO decision_log
 (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, surfaces_tested)
SELECT 'claude-code-session-2026-11-04-c9-failure-modes',
 'A standing detector is an audit that runs every cycle; an issue-contract back-off does not apply to it',
 'FM-CADENCE-1: fm- and belief- contracts exempt from the FM-5 steady-state back-off; parked contracts re-staggered; contract fm-standing-detector-backed-off',
 'v_failure_mode_status 22:44Z: 80 recurring, 132 unprobed; unprobed by newest-verification age 60-90 min 8, 90-120 min 117, 2-24 h 1, never 10; verifier split for fm-* rows 17:00-22:59Z: consumer 90 percent, tick 10 percent',
 'detectors are probed at least every 22-45 minutes again',
 'remediation_contracts.next_due_at of about 430 active fm-/belief- rows; scripts/remediation_consumer.py back-off rule; no issue contract is touched',
 'revert scripts/remediation_consumer.py (standing_detector exemption); next_due_at of the parked rows is in bak_20261105_fm_cadence_1',
 'failure_modes_recurring counts only detectors that fail or stopped, not passing detectors the back-off parked',
 'failure_modes_recurring 208 -> at most 100 within 3 hours of the deploy; unprobed 132 -> 10 or fewer; fm-* verification rows about 4 K -> about 11 K a day',
 'scripts/remediation_consumer_steady_test.py and migrations/fm-cadence-1.test.mjs (replay of remediation_contracts: restagger, detector pass and fail)'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'FM-CADENCE-1:%');
