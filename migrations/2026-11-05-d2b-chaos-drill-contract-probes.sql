-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE remediation_contracts SET verify_probe = (SELECT b.verify_probe FROM bak_20261105_d2b_chaos_contracts b WHERE b.class = remediation_contracts.class), action = (SELECT b.action FROM bak_20261105_d2b_chaos_contracts b WHERE b.class = remediation_contracts.class), module = (SELECT b.module FROM bak_20261105_d2b_chaos_contracts b WHERE b.class = remediation_contracts.class), attempts = (SELECT b.attempts FROM bak_20261105_d2b_chaos_contracts b WHERE b.class = remediation_contracts.class), last_verdict = (SELECT b.last_verdict FROM bak_20261105_d2b_chaos_contracts b WHERE b.class = remediation_contracts.class) WHERE class IN (SELECT class FROM bak_20261105_d2b_chaos_contracts)
-- The Rollback leaves the decision row: decision_log is append-only.
-- BACKUP: bak_20261105_d2b_chaos_contracts
-- CHAOS-DRILL-CONTRACT-PROBE-1 (2026-11-05, charter pillar autonomy; GitHub 5282 / agent_issues 1000610 CHAOS-DRILL-FAILED-1: control:social-weekly-caps, and GitHub 7274 /
-- agent_issues 1001636 CHAOS-DRILL-FAILED-1: control:improvement-loop-relapse-trigger-judge). Both issues are closed by qnfo-fleet-control chaosDrill when the control's alternate probe passes
-- again ("the next passing drill closes this issue itself"), but that close is an UPDATE of agent_issues and the guard close-while-contract-fails refuses it while the issue's own contract reads
-- last_verdict fail. Both contracts carried a probe that could not read pass, so each drill pass was refused at the close and the issue stayed open after its defect was gone:
--   issue-1000610  the probe takes the smallest gap between adjacent posts of the last 7 days (ORDER BY gap_min LIMIT 1) and then prints "gap N min < 360" whenever ANY gap exists, with no
--                  WHERE gap_min < 360. Read live 2026-11-04T22:28Z: the smallest gap in the window is 420.6 min (bluesky-rollup 2026-10-31 02:31 -> 09:31), which is above 360, and the probe
--                  still printed "gap 420.6 min < 360". The LinkedIn pair that tripped the drill (2026-10-27 16:31 / 21:31, 5 h apart) left the window on 2026-11-03T21:31Z, and the cap-derived
--                  alternate probe (migrations/2026-11-03-social-weekly-caps-probe.sql, PR 6492) has read last_pass = 1 since the drill of 2026-11-04T20:05:45Z.
--   issue-1001636  the probe counts every improvement_loop_runs row of the last 7 days whose fix_target_hold_rate_30d is not strictly between 0 and 1. Three runs of 2026-11-04 (08:05, 13:05,
--                  16:05Z) were degraded reads (fixes_judged 0, every figure null: the loop's D1 reads answered 429 and were swallowed as empty), so the count stays above 0 for seven days after the
--                  last degraded run even though the metric is fresh (0.5342 at 22:05:45Z) and the loop has run hourly since 20:05Z.
-- Replacement: each contract measures the control's own condition live, in the same terms the drill uses, and returns the literal ok when it holds (the consumer passes only when expected
-- equals observed as text). issue-1000610 reads the drill's recorded verdict for the cap-derived probe and requires a drill within 8 hours (the drill runs every 6 hours);
-- issue-1001636 restates the control probe: the metric is refreshed within 120 minutes, holds a figure between 0 and 1, the loop recorded a run within 120 minutes and keeps the figure in its state.
-- A degraded run that is followed by a healthy one no longer blocks the close for seven days; the code fix that stops the degraded runs from blanking the metric is the separate PR for
-- agent_issues 1001636 (qnfo-fleet-control, D1 429 handling).
-- Each contract is reset (attempts 0, last_verdict NULL, due now) so the first verification after the apply is judged on the new probe alone.
-- CAUSE-MAPPED: no metric is registered here.

CREATE TABLE IF NOT EXISTS bak_20261105_d2b_chaos_contracts AS
  SELECT class, verify_probe, action, module, attempts, last_verdict, next_due_at
    FROM remediation_contracts WHERE class IN ('issue-1000610', 'issue-1001636');

UPDATE remediation_contracts SET
  verify_probe = 'SELECT ''ok'' AS expected, CASE WHEN NOT EXISTS (SELECT 1 FROM control_alternate_probes WHERE control = ''social-weekly-caps'' AND enabled = 1) THEN ''the social-weekly-caps alternate probe is missing or disabled'' WHEN COALESCE((SELECT last_pass FROM control_alternate_probes WHERE control = ''social-weekly-caps''), 0) <> 1 THEN ''the social-weekly-caps drill probe is failing: '' || COALESCE((SELECT substr(last_observed, 1, 200) FROM control_alternate_probes WHERE control = ''social-weekly-caps''), '''') WHEN COALESCE((SELECT last_run_at FROM control_alternate_probes WHERE control = ''social-weekly-caps''), '''') < strftime(''%Y-%m-%dT%H:%M:%fZ'', ''now'', ''-480 minutes'') THEN ''the social-weekly-caps drill has not run in 8 hours'' ELSE ''ok'' END AS observed',
  verify_transport = 'd1-query',
  status = 'active',
  module = 'chaos-drill-control-verdict-1',
  attempts = 0,
  last_verdict = NULL,
  next_due_at = datetime('now'),
  action = 'MEASURES the control behind this issue: the cap-derived social-weekly-caps alternate probe (control_alternate_probes) passed in its latest drill and that drill ran within 8 hours. CHAOS-DRILL-CONTRACT-PROBE-1; the drill itself closes the issue on its next pass.'
WHERE class = 'issue-1000610' AND issue_id = 1000610;

UPDATE remediation_contracts SET
  verify_probe = 'SELECT ''ok'' AS expected, CASE WHEN NOT EXISTS (SELECT 1 FROM metric_registry WHERE metric = ''fix_target_hold_rate_30d'' AND kind = ''guard'') THEN ''the guard metric fix_target_hold_rate_30d is missing from metric_registry'' WHEN COALESCE((SELECT last_refreshed FROM metric_registry WHERE metric = ''fix_target_hold_rate_30d''), '''') < strftime(''%Y-%m-%dT%H:%M:%fZ'', ''now'', ''-120 minutes'') THEN ''fix_target_hold_rate_30d was not refreshed in 120 minutes'' WHEN NOT COALESCE((SELECT CAST(last_value AS REAL) BETWEEN 0 AND 1 FROM metric_registry WHERE metric = ''fix_target_hold_rate_30d'' AND last_value GLOB ''[0-9]*''), 0) THEN ''fix_target_hold_rate_30d holds no figure between 0 and 1'' WHEN COALESCE((SELECT ts FROM improvement_loop_runs ORDER BY id DESC LIMIT 1), '''') < strftime(''%Y-%m-%dT%H:%M:%fZ'', ''now'', ''-120 minutes'') THEN ''the improvement loop recorded no run in 120 minutes'' WHEN instr(COALESCE((SELECT state_json FROM improvement_loop_runs ORDER BY id DESC LIMIT 1), ''''), ''"fix_target_hold_rate_30d"'') = 0 THEN ''the latest improvement loop run no longer keeps the target-based figure in its state'' ELSE ''ok'' END AS observed',
  verify_transport = 'd1-query',
  status = 'active',
  module = 'chaos-drill-control-verdict-1',
  attempts = 0,
  last_verdict = NULL,
  next_due_at = datetime('now'),
  action = 'MEASURES the control behind this issue now, not a seven-day count of past degraded runs: fix_target_hold_rate_30d is refreshed within 120 minutes and holds a figure between 0 and 1, and the improvement loop recorded a run within 120 minutes that keeps the figure. Same condition as the improvement-loop-relapse-trigger-judge alternate probe. CHAOS-DRILL-CONTRACT-PROBE-1.'
WHERE class = 'issue-1001636' AND issue_id = 1001636;

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:D2-slo-journeys-probes',
  'a chaos-drill issue is closed by the drill itself when its control probe passes, so the issue contract must be satisfiable by the same condition; a contract that fails after the defect is gone blocks the drill close through close-while-contract-fails',
  'CHAOS-DRILL-CONTRACT-PROBE-1: the contracts of issue-1000610 (social-weekly-caps) and issue-1001636 (improvement-loop-relapse-trigger-judge) measure the control live and return the literal ok',
  'live read 2026-11-04T22:28Z: remediation_verifications for class issue-1000610 observed "bluesky-rollup 2026-10-31 02:31:13 (rollup) -> 2026-10-31 09:31:51 (rollup), gap 420.6 min < 360" (a gap above the threshold printed as a failure) while control_alternate_probes social-weekly-caps had last_pass 1 at 2026-11-04T20:05:45Z; improvement_loop_runs ids 803, 805 and 806 of 2026-11-04 carry fixes_judged 0 and null figures, the contract of issue-1001636 counts them for seven days, and fix_target_hold_rate_30d was refreshed 22:05:45Z at 0.5342',
  'migration merged through the canonical path; no worker bundle changed',
  'two remediation_contracts rows and one backup table',
  'the Rollback header restores both probes, actions, modules and counters from bak_20261105_d2b_chaos_contracts; the decision row stays (append-only)',
  'a chaos-drill issue whose control is healthy now closes on the drill that proves it, instead of waiting for a seven-day count or failing on a gap that is above its threshold',
  'issue-1000610 and issue-1001636 read pass on their next verification (within 80 minutes of the apply) and close through the autoclose path or the next 6-hourly drill; no other contract changes',
  'none',
  'offline suite migrations/d2b-chaos-drill-contract-probes.test.mjs (both probes run on sqlite against healthy, failing, stale, missing and degraded states); live reads of control_alternate_probes, metric_registry and improvement_loop_runs'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'CHAOS-DRILL-CONTRACT-PROBE-1:%');
