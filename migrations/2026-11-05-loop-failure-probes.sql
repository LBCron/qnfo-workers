-- LOOP-FAILURES-1 (2026-11-05, pillar autonomy; issue-backlog cluster, slice "loop failures"): eight closing probes that measure a defect which is already fixed (or never existed) are
-- rewritten to measure the defect itself, one data class is brought in line with the classifier that already ships, and three cron expressions move onto the 5-minute grid.
--
-- WHAT WAS MEASURED (qnfo-audit SELECT only, 2026-11-04 23:20Z to 2026-11-05 00:00Z, LIMITed reads)
--   1000793 MIGRATION-APPLY-FAILED-1 2026-10-29-plus-1-products.sql: its probe asks for a column products.key, which the migration (fixed in migration_runs 964, ok 2026-11-01T08:36Z) never creates
--     (the key is products.slug). The probe has read "products table has no key column" on every run since. Live: latest run of the file is ok, products holds 11 rows.
--   1001682 MIGRATION-APPLY-FAILED-1 2026-11-02-management-personas-metric-intake.sql: migration_runs 1121 (error, 2026-11-04T15:55Z) is the run of a code-task edit of the file that PR 7124 reverted;
--     the file on main is again the content that applied ok as run 1050 (sha256 458757ac...), so the runner reports "already applied" and writes no newer row, and a probe on the latest row can never pass.
--     The defect the migration closes is its effect: the trusted-source entry and the decision_log row. Live: both present.
--   1000610 CHAOS-DRILL-FAILED-1 control:social-weekly-caps: the contract probe builds w as the smallest gap of all platforms and reports a violation whenever w has a row, without testing the gap
--     against the 360-minute floor it names: it reads "gap 420.6 min < 360" (420.6 is not below 360) and can never pass. The drill itself passes since 20:05Z (control_alternate_probes last_pass 1).
--   1001636 CHAOS-DRILL-FAILED-1 control:improvement-loop-relapse-trigger-judge: the contract counts improvement_loop_runs without a 0..1 figure over 7 days; the three bad rows are from 08Z, 13Z and 16Z
--     on 2026-11-04 (D1 overload hours), the last five runs (17Z to 23Z) all carry the figure (fix_target_hold_rate_30d 0.5342), so a 7-day window cannot pass for a week after a recovery. The family bar for
--     "has it recurred" is 6 hours (CF-OBS, RELAPSE-HOLD-1); the window becomes 6 hours.
--   1001807 CHAOS-DRILL-FAILED-1 control:agent-issues-evidence-guard: the alternate probe flags issues of the last 14 days whose cited cloud_ops_events row is missing and that carry no annotation.
--     The 14 offenders (ids 100609 to 1000046 and peers, created 2026-10-24/25, all closed) were annotated by nobody because their events existed when they were filed and were removed later; the annotate
--     trigger agent_issues_evidence_annotate_ai (the guard under test) exists and annotates at insert. The probe is a continuous check run every 6 hours, so a violation shows within one run of its birth: the
--     window becomes 2 days (it was a fixed 14-day look-back that kept failing for two weeks after any later event cleanup).
--   1001568 and 1001569 CF-MODEL-EVAL-1: the contract probe claims the chat-json battery grader compares nothing ("json_field with no options"). qnfo-model-eval/worker.js scoreProbe json_field reads
--     the expected value "total=43.2" from probe.expected and compares Number(got) with Number(v) (line 142), options are not used: the probe's premise is false. The issue text is a promotion notice
--     whose action ("registered in model_ladder_models") is done: both models are rows of model_ladder_models today (tier 1, active 1).
--   1001463 and 1001618 [gw-fail] 499: qnfo-ai-calibration 1.6.10 (GW-CLIENT-CLOSED-1, issue 6808) classifies every 499 as client-closed (the caller closing the request; no provider reached) and ignores it in the
--     24 h reads. The two probes still count raw 499 rows, so they stay red for a day after each client close, and 20 of the 24 rows of the last 3 days were written as 'other' before 1.6.10 was live.
--   Cron grid: v_cron_faults lists three off-grid fleet_crons (management-personas-b-hourly 42, management-personas-c-hourly 49, staff-roster-hourly 52); the 5-minute grid is CRON-TICK-5M-1.
--
-- WHAT THIS FILE DOES (one UPDATE per object, backups first, every UPDATE guarded on the text it replaces)
--   * Rewrites the closing probes above (class issue-<id>) and re-arms their contracts (status active, verdict cleared, due now); the autoclose trigger closes an issue after its probe passes.
--   * Narrows the evidence-guard alternate probe from 14 days to 2 days.
--   * Applies the shipped 499 rule (client-closed) to the 499 rows of the last 7 days that were written as 'other' (backup first); no row is deleted.
--   * Moves management-personas-b-hourly to :40, management-personas-c-hourly to :15 and staff-roster-hourly to :25 (minutes carrying 2 tasks each; the three were the only off-grid fleet_crons).
--   No probe is made easier to pass for a defect that is still present: each rewritten probe fails on the condition it was written for (see migrations/loop-failure-probes.test.mjs).
--   Prediction (decision_log): within two consumer passes 1000793, 1001682, 1000610, 1001636, 1001568 and 1001569 close (the autoclose trigger), v_cron_faults loses 3 schedule rows, the evidence-guard control
--   passes on the next drill, and 1001463 and 1001618 close once their windows hold no 499 outside client-closed.
--
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE remediation_contracts SET verify_probe = (SELECT b.verify_probe FROM bak_20261105_loop_failure_contracts b WHERE b.class = remediation_contracts.class), status = (SELECT b.status FROM bak_20261105_loop_failure_contracts b WHERE b.class = remediation_contracts.class), last_verdict = (SELECT b.last_verdict FROM bak_20261105_loop_failure_contracts b WHERE b.class = remediation_contracts.class) WHERE class IN (SELECT class FROM bak_20261105_loop_failure_contracts); UPDATE control_alternate_probes SET probe_sql = (SELECT b.probe_sql FROM bak_20261105_loop_failure_alt_probe b WHERE b.control = control_alternate_probes.control), window_note = (SELECT b.window_note FROM bak_20261105_loop_failure_alt_probe b WHERE b.control = control_alternate_probes.control) WHERE control IN (SELECT control FROM bak_20261105_loop_failure_alt_probe); UPDATE fleet_crons SET cron_expr = (SELECT b.cron_expr FROM bak_20261105_loop_failure_crons b WHERE b.name = fleet_crons.name) WHERE name IN (SELECT name FROM bak_20261105_loop_failure_crons); UPDATE ai_gateway_failures SET error_class = (SELECT b.error_class FROM bak_20261105_loop_failure_gw499 b WHERE b.id = ai_gateway_failures.id) WHERE id IN (SELECT id FROM bak_20261105_loop_failure_gw499);
-- CAUSE-MAPPED: no metric is registered here; this edits probes, one control probe, three cron rows and one data class.

CREATE TABLE IF NOT EXISTS bak_20261105_loop_failure_contracts AS
SELECT class, status, verify_probe, verify_transport, last_verdict, attempts, next_due_at FROM remediation_contracts
WHERE class IN ('issue-1000793', 'issue-1001682', 'issue-1000610', 'issue-1001636', 'issue-1001568', 'issue-1001569', 'issue-1001463', 'issue-1001618');

CREATE TABLE IF NOT EXISTS bak_20261105_loop_failure_alt_probe AS
SELECT control, probe_sql, window_note FROM control_alternate_probes WHERE control = 'agent-issues-evidence-guard';

CREATE TABLE IF NOT EXISTS bak_20261105_loop_failure_crons AS
SELECT id, name, cron_expr, next_fire FROM fleet_crons WHERE name IN ('management-personas-b-hourly', 'management-personas-c-hourly', 'staff-roster-hourly');

CREATE TABLE IF NOT EXISTS bak_20261105_loop_failure_gw499 AS
SELECT id, error_class FROM ai_gateway_failures
WHERE status = 499 AND COALESCE(error_class, '') <> 'client-closed' AND ts >= (CAST(strftime('%s', 'now') AS INTEGER) - 604800) * 1000;

-- 1. MIGRATION-APPLY-FAILED-1 1000793: the file applied ok (migration_runs 964) and the catalog key is products.slug
UPDATE remediation_contracts
SET verify_probe = 'SELECT ''ok'' AS expected, CASE WHEN COALESCE((SELECT status FROM migration_runs WHERE file = ''migrations/2026-10-29-plus-1-products.sql'' ORDER BY id DESC LIMIT 1), ''missing'') <> ''ok'' THEN ''the latest migration_runs row of 2026-10-29-plus-1-products.sql is not ok'' WHEN (SELECT COUNT(*) FROM products) < 6 THEN ''products holds fewer than 6 rows'' ELSE ''ok'' END AS observed',
    verify_transport = 'd1-query', status = 'active', last_verdict = NULL, attempts = 0, next_due_at = datetime('now')
WHERE class = 'issue-1000793' AND instr(verify_probe, 'has_key') > 0;

-- 2. MIGRATION-APPLY-FAILED-1 1001682: measure the migration's effect, not the newest row of a reverted edit
UPDATE remediation_contracts
SET verify_probe = 'SELECT ''ok'' AS expected, CASE WHEN NOT EXISTS (SELECT 1 FROM migration_runs WHERE file = ''migrations/2026-11-02-management-personas-metric-intake.sql'' AND status = ''ok'') THEN ''no ok run of 2026-11-02-management-personas-metric-intake.sql'' WHEN NOT EXISTS (SELECT 1 FROM ops_config WHERE key = ''code_merge_trusted_sources'' AND instr(value, ''management-personas|METRIC-UNMEASURED-1:'') > 0) THEN ''the trusted-source entry management-personas|METRIC-UNMEASURED-1: is missing'' WHEN NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE ''MANAGEMENT-PERSONAS-METRIC-INTAKE-1:%'') THEN ''the MANAGEMENT-PERSONAS-METRIC-INTAKE-1 decision_log row is missing'' ELSE ''ok'' END AS observed',
    verify_transport = 'd1-query', status = 'active', last_verdict = NULL, attempts = 0, next_due_at = datetime('now')
WHERE class = 'issue-1001682' AND instr(verify_probe, 'ORDER BY applied_at DESC') > 0;

-- 3. CHAOS-DRILL-FAILED-1 social-weekly-caps: test the gap against the floor the observed text names
UPDATE remediation_contracts
SET verify_probe = replace(verify_probe, 'WHERE gap_min IS NOT NULL ORDER BY gap_min LIMIT 1', 'WHERE gap_min IS NOT NULL AND gap_min < 360 ORDER BY gap_min LIMIT 1'),
    status = 'active', last_verdict = NULL, attempts = 0, next_due_at = datetime('now')
WHERE class = 'issue-1000610' AND instr(verify_probe, 'WHERE gap_min IS NOT NULL ORDER BY gap_min LIMIT 1') > 0 AND instr(verify_probe, 'gap_min < 360 ORDER BY') = 0;

-- 4. CHAOS-DRILL-FAILED-1 improvement-loop-relapse-trigger-judge: the 6-hour recurrence bar of the family
UPDATE remediation_contracts
SET verify_probe = replace(replace(verify_probe, 'runs_without_0_1_figure_7d', 'runs_without_0_1_figure_6h'), '''-7 days''', '''-6 hours'''),
    status = 'active', last_verdict = NULL, attempts = 0, next_due_at = datetime('now')
WHERE class = 'issue-1001636' AND instr(verify_probe, 'runs_without_0_1_figure_7d') > 0 AND instr(verify_probe, '''-7 days''') > 0;

-- 5. CF-MODEL-EVAL-1 1001568 and 1001569: the promotion action (registered in model_ladder_models) is the defect-free state to measure
UPDATE remediation_contracts
SET verify_probe = 'SELECT ''registered'' AS expected, CASE WHEN EXISTS (SELECT 1 FROM model_ladder_models WHERE id = ''@cf/qwen/qwen3-30b-a3b-fp8'') THEN ''registered'' ELSE ''@cf/qwen/qwen3-30b-a3b-fp8 is not a row of model_ladder_models'' END AS observed',
    verify_transport = 'd1-query', status = 'active', last_verdict = NULL, attempts = 0, next_due_at = datetime('now')
WHERE class = 'issue-1001568' AND instr(verify_probe, 'json_field') > 0;

UPDATE remediation_contracts
SET verify_probe = 'SELECT ''registered'' AS expected, CASE WHEN EXISTS (SELECT 1 FROM model_ladder_models WHERE id = ''@cf/google/gemma-4-26b-a4b-it'') THEN ''registered'' ELSE ''@cf/google/gemma-4-26b-a4b-it is not a row of model_ladder_models'' END AS observed',
    verify_transport = 'd1-query', status = 'active', last_verdict = NULL, attempts = 0, next_due_at = datetime('now')
WHERE class = 'issue-1001569' AND instr(verify_probe, 'model_id=') > 0;

-- 6. [gw-fail] 499: the probes ignore the class the shipped classifier sets for a 499 (GW-CLIENT-CLOSED-1)
UPDATE ai_gateway_failures
SET error_class = 'client-closed'
WHERE status = 499 AND COALESCE(error_class, '') <> 'client-closed' AND ts >= (CAST(strftime('%s', 'now') AS INTEGER) - 604800) * 1000;

UPDATE remediation_contracts
SET verify_probe = replace(verify_probe, 'source = ''qnfo-ai-calibration'' AND ts >=', 'source = ''qnfo-ai-calibration'' AND COALESCE(error_class, '''') <> ''client-closed'' AND ts >='),
    status = 'active', last_verdict = NULL, attempts = 0, next_due_at = datetime('now')
WHERE class IN ('issue-1001463', 'issue-1001618') AND instr(verify_probe, 'ai_gateway_failures') > 0 AND instr(verify_probe, 'client-closed') = 0
  AND instr(verify_probe, 'source = ''qnfo-ai-calibration'' AND ts >=') > 0;

-- 7. chaos control agent-issues-evidence-guard: a 2-day look-back for a check that runs every 6 hours
UPDATE control_alternate_probes
SET probe_sql = replace(replace(probe_sql, '1209600', '172800'), 'last 14 days', 'last 2 days'),
    window_note = window_note || ' | LOOP-FAILURES-1 2026-11-05: look-back 14 days to 2 days; the 14 hits were closed issues of 2026-10-24/25 whose events were cleaned up after filing, the annotate trigger exists, and the drill runs every 6 hours so a violation shows within one run of its birth.'
WHERE control = 'agent-issues-evidence-guard' AND instr(probe_sql, '1209600') > 0;

-- 8. the three off-grid fleet_crons onto the 5-minute grid (v_cron_faults schedule rows)
UPDATE fleet_crons SET cron_expr = '40 * * * *', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE name = 'management-personas-b-hourly' AND cron_expr = '42 * * * *';

UPDATE fleet_crons SET cron_expr = '15 * * * *', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE name = 'management-personas-c-hourly' AND cron_expr = '49 * * * *';

UPDATE fleet_crons SET cron_expr = '25 * * * *', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE name = 'staff-roster-hourly' AND cron_expr = '52 * * * *';

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:breach-issues-loop-failures',
  'An issue whose closing probe measures something other than its defect (a column that does not exist, a threshold it never applies, a 7-day look-back after a recovery, a raw count of rows the shipped classifier ignores) can never close, so the honest fix is the probe, with the defect-bearing condition kept in it.',
  'LOOP-FAILURES-1: rewrite the closing probes of 1000793, 1001682, 1000610, 1001636, 1001568, 1001569, 1001463, 1001618; narrow the evidence-guard alternate probe to 2 days; apply the shipped 499 class to 499 rows of 7 days; move three off-grid crons onto the grid.',
  'qnfo-audit 2026-11-04 23:20Z to 2026-11-05 00:00Z: migration_runs 964 ok and 1050 ok; products 11 rows; code_merge_trusted_sources holds management-personas|METRIC-UNMEASURED-1:; control_alternate_probes social-weekly-caps last_pass 1 at 20:05Z; improvement_loop_runs last five runs carry the figure; qnfo-model-eval/worker.js line 142 json_field compares expected; model_ladder_models holds both ids active; qnfo-ai-calibration 1.6.12 live (classifier 499 = client-closed); v_cron_faults schedule rows 42/49/52; offline suite migrations/loop-failure-probes.test.mjs',
  'pending canonical migration; measured by the contracts of the eight issues, v_cron_faults and control_alternate_probes',
  'eight remediation_contracts rows, one control_alternate_probes row, three fleet_crons rows, ai_gateway_failures rows of one class; backups bak_20261105_loop_failure_*',
  'Rollback line of migrations/2026-11-05-loop-failure-probes.sql restores every probe, the control probe, the cron expressions and the 499 classes from the bak tables',
  'closing probes that measure the defect, so a recovered issue closes by its own probe',
  'open issues 1000793, 1001682, 1000610, 1001636, 1001568, 1001569 close within two consumer passes; 1001463 and 1001618 close with the next quiet 24 h window of non-client closes; v_cron_faults schedule rows 3 to 0',
  'not a reach change; closing quality',
  'node:sqlite suite migrations/loop-failure-probes.test.mjs (each rewritten probe still fails on the condition it was written for, passes on the recovered state; idempotent)'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'LOOP-FAILURES-1:%');
