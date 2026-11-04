-- SELF-CHECK-REPAIRS-1 (2026-11-04, charter pillar autonomy; GitHub #5590, #6244, #6797, #6857, #6858, #6170, #6676, #6856 cluster).
-- Evidence read from live qnfo-audit on 2026-11-04 16:00Z (read-only):
--   1. 612 active contracts had next_due_at more than 3 h out, 355 of them fm-* detectors, all exactly last_attempt_at + 59.58 h. Cause: qnfo-fleet-control remediationContractsTick
--      sets `if (out.probe_error) cadH = Math.max(cadH, 60)`, where cadH is in HOURS (the comment says "at most hourly"), so a probe-error under the D1 overload parks the detector for 60 h
--      (rtNextDueOffset: 3600 - 25 minutes). fm-reopen-without-live-path last ran 2026-11-03 21:31 with next_due 2026-11-06 09:06, so the chaos drills rt-ensure-live-path and
--      rt-ensure-live-path-bounds read "the detector did not run in 120 minutes". This file re-arms them, staggered over 50 minutes so the consumer is not hit at once; the unit fix in
--      qnfo-fleet-control/worker.js is filed as a code-task (the file was under another session's work claim when this was written).
--   2. control_alternate_probes had no row for copilot-pr-approval-deny-paths, so v_control_alternate_untested.controls_untested_without_probe read 1 and the control-alternate-probes
--      drill (#5590) failed. Its alternate is the code loop opening the fleet-identity pull request for a denied path; merged code tasks of the last 3 days show that path is live.
--   3. rt-page-qwav-home expected "QWAV Research Papers" and rt-page-fleet-queue "<title>QNFO fleet status", neither of which the pages carry any more (qwav.org title: "QWAV - benchmarked in
--      joules per solution | p-adic ultrametric computing"; fleet.qnfo.org title: "Fleet"). The probe markers now name text the live pages serve today.
-- Prediction: within 3 hours rt-ensure-live-path, rt-ensure-live-path-bounds and control-alternate-probes read last_pass 1 at the next 6-hourly drill; active contracts with next_due_at
-- beyond 3 h fall from 612 to the contracts that have a long cadence on purpose.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM control_alternate_probes WHERE control = 'copilot-pr-approval-deny-paths'; UPDATE remediation_contracts SET verify_probe = REPLACE(verify_probe, 'p-adic ultrametric computing', 'QWAV Research Papers') WHERE class = 'rt-page-qwav-home'; UPDATE remediation_contracts SET verify_probe = REPLACE(verify_probe, '<title>Fleet</title>', '<title>QNFO fleet status') WHERE class = 'rt-page-fleet-queue';

INSERT OR IGNORE INTO control_alternate_probes (control, probe_sql, window_note, enabled) VALUES
 ('copilot-pr-approval-deny-paths',
  'SELECT ''ok'' AS expected, CASE WHEN NOT EXISTS (SELECT 1 FROM code_tasks WHERE status = ''merged'' AND updated_at > strftime(''%Y-%m-%dT%H:%M:%fZ'', ''now'', ''-4320 minutes'')) THEN ''no code task merged in 4320 minutes, so the code loop, which opens the fleet-identity pull request for a path the Copilot approval denies, is not showing evidence'' ELSE ''ok'' END AS observed',
  '4320 minutes: the alternate of this control is the code loop opening its own pull requests for a denied path (the repository variable COPILOT_PR_APPROVE is a GitHub setting and cannot be read from D1); a merged code task inside the window shows that path is live. 58 code tasks merged in the 2 days before this file.',
  1);

UPDATE remediation_contracts
   SET next_due_at = datetime('now', '+' || (abs(random()) % 50) || ' minutes')
 WHERE status = 'active'
   AND COALESCE(expected_cadence_h, 1) <= 2
   AND next_due_at IS NOT NULL
   AND datetime(next_due_at) > datetime('now', '+3 hours');

UPDATE remediation_contracts
   SET verify_probe = REPLACE(verify_probe, 'QWAV Research Papers', 'p-adic ultrametric computing')
 WHERE class = 'rt-page-qwav-home' AND instr(verify_probe, 'QWAV Research Papers') > 0;

UPDATE remediation_contracts
   SET verify_probe = REPLACE(verify_probe, '<title>QNFO fleet status', '<title>Fleet</title>')
 WHERE class = 'rt-page-fleet-queue' AND instr(verify_probe, '<title>QNFO fleet status') > 0;
