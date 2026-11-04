-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE remediation_contracts SET verify_probe = replace(verify_probe, '''-90 minutes''', '''-25 minutes''') WHERE class = 'fm-trigger-depth-compile';
-- The Rollback leaves the decision row: decision_log is append-only.
-- TRIGGER-DEPTH-PROBE-WINDOW-1 (2026-11-04, charter pillar autonomy; failure mode trigger-depth-compile, agent_issues 1001212).
-- The detector fm-trigger-depth-compile reads 'ok' only when a pass=1 row of its own class, written by the consumer's trigger-depth sweep, is younger than 25 minutes. The sweep is one
-- step of remediation-consumer.yml and that workflow now runs about every 40 minutes (a run takes 26 to 32 minutes; 2 of the last 6 were cancelled at the 30-minute timeout), so the
-- row is older than 25 minutes for most of every cycle. Measured 2026-11-04: the sweep wrote pass rows at 17:07, 17:18, 17:38, 17:55, 18:15, 18:55, 20:02 and 20:50 (longest gap 67
-- minutes), and the verifications that read 'stale-or-failing' came at 18:41 (26 minutes after the 18:15 pass) and 19:52 (57 minutes after the 18:55 pass) while every sweep passed.
-- That left the detector red 708 times with nothing wrong, a standing failure-mode signal that is not one. The window is now 90 minutes: it covers the longest observed gap with room for a
-- cancelled run, stays inside the 120-minute ceiling (SLA-120M-1), and still reads 'stale-or-failing' when the sweep has not passed for 90 minutes or fails (a pass=0 row never counts).
-- Only the window literal changes; a second run finds none left to replace.
UPDATE remediation_contracts SET verify_probe = replace(verify_probe, '''-25 minutes''', '''-90 minutes''')
 WHERE class = 'fm-trigger-depth-compile';

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:github-issues-resolution',
  'a freshness window shorter than the cadence of the job that writes the evidence makes a detector red by arithmetic, and a detector that is always red carries no signal; the window must follow the measured cadence, inside the 120-minute ceiling, and the pass condition stays',
  'TRIGGER-DEPTH-PROBE-WINDOW-1: fm-trigger-depth-compile reads a trigger-depth sweep pass from the last 90 minutes instead of 25',
  'remediation_verifications read 2026-11-04: eight sweep passes between 17:07 and 20:50, longest gap 67 minutes; the two failing verifications (18:41, 19:52) fell 26 and 57 minutes after a passing sweep; the detector had 708 attempts and last_verdict fail',
  'migration merged through the canonical path; no worker bundle changed',
  'one remediation_contracts row',
  'the Rollback header restores the 25-minute window; the decision row stays (append-only)',
  'a detector that turns red only when the sweep is missing or failing',
  'fm-trigger-depth-compile reads ok within the next consumer run and stays ok while the sweep passes at least every 90 minutes; it reads stale-or-failing again when the sweep goes silent for 90 minutes',
  'none',
  'offline suite migrations/trigger-depth-probe-window.test.mjs (the probe on sqlite with a pass 40 minutes old, 100 minutes old, a failed row and no row); live read of the eight sweep passes'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'TRIGGER-DEPTH-PROBE-WINDOW-1:%');
