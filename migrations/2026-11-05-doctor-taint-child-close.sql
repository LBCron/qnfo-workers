-- BREACH-PLAYBOOK-TAINT-1 follow-up (2026-11-05, charter pillar autonomy; cluster doctor-probes of the fleet-breaches remediation).
-- agent_issues 1001580 (CODE-LOOP-EXHAUSTED-1) is the exhausted code task ct_im1001373, which was dispatched to create migrations/2026-11-04-iar-r1-live-doer-verify-semicolon.sql for
-- issue 1001373 (METRIC-TRIGGER-14606, doctor_taint_violations_24h). The loop failed the same way three times (raw read HTTP 404: a new file has nothing to read) and stopped. The defect the
-- task was meant to fix is fixed by another route: migrations/2026-11-05-iar-r1-live-doer-v2.sql (PR 7463), applied ok at 2026-11-05T01:00:47Z (migration_runs 1341). Measured afterwards on qnfo-audit:
-- the six breach doctor ticks 01:00:53Z to 01:50:53Z read rules=26 (it was 25) and no taint-drop event was written after the apply (count 0). The parent issue 1001373 keeps its own contract (monitoring:
-- metric-condition) and closes when doctor_taint_violations_24h leaves its 24-hour window, which is a measurement of time, not of work. The task row is already failed, so no queued task is left to supersede.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE issue_triage SET triage_state = 'triaged', close_evidence = NULL WHERE issue_id = 1001580; UPDATE agent_issues SET status = 'open', close_channel = NULL WHERE id = 1001580

UPDATE agent_issues SET close_channel = 'session:breach-remediation' WHERE id = 1001580 AND status = 'open';

UPDATE issue_triage SET triage_state = 'closed', triaged_at = datetime('now'),
  close_evidence = 'BREACH-PLAYBOOK-TAINT-1: the defect this code task was meant to fix (IAR-R1-live-doer carried a semicolon, a 61-byte LIKE, an impossible verify and no reopen) is fixed by migrations/2026-11-05-iar-r1-live-doer-v2.sql (PR 7463), applied ok 2026-11-05T01:00:47Z (migration_runs 1341). Live after the apply: breach doctor ticks 01:00:53Z to 01:50:53Z read rules=26, and breach_diagnosis_events holds 0 taint-drop rows after the apply. The task ct_im1001373 failed on a read of a file that does not exist yet and is not needed. Parent issue 1001373 keeps its own metric contract until doctor_taint_violations_24h clears its 24 h window.'
WHERE issue_id = 1001580 AND triage_state <> 'closed';

UPDATE agent_issues SET status = 'closed', updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE id = 1001580 AND status = 'open'
  AND EXISTS (SELECT 1 FROM issue_triage t WHERE t.issue_id = 1001580 AND t.triage_state = 'closed' AND t.close_evidence IS NOT NULL);
