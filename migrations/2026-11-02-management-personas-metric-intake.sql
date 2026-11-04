-- MANAGEMENT-PERSONAS-METRIC-INTAKE-1 (2026-11-02, charter pillar autonomy; issue 1001206).
-- The managers create METRIC-UNMEASURED-1 issues deterministically from metric_improvement_now, but the shared planner/intake trust list
-- admitted only management-personas ROADMAP-1 titles. Admit only this generated title prefix and re-arm its open untrusted plans when
-- their latest issue-specific verification is not passing. Existing planner, intake, claim, deny, merge and close-evidence checks remain.
-- Live baseline: three open untrusted metric plans; two latest issue probes fail, while issue 1000609's own probe passes. Do not re-arm
-- that resolved metric or close its still-open issue here; the existing manager workflow closes it from its passing probe.
-- Prediction: matching open untrusted plans without a latest passing probe that are not re-armed fall from two to zero on apply.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261102_mp_metric_intake_plans
-- Rollback: UPDATE ops_config SET value = replace(value, ',management-personas|METRIC-UNMEASURED-1:', ''), updated_at = datetime('now') WHERE key = 'code_merge_trusted_sources' AND instr(COALESCE((SELECT value FROM ops_config WHERE key = 'code_merge_trusted_sources--bak-20261102-mp-metric-intake'), ''), 'management-personas|METRIC-UNMEASURED-1:') = 0; UPDATE issue_plans SET planned_at = (SELECT b.planned_at FROM bak_20261102_mp_metric_intake_plans b WHERE b.issue_id = issue_plans.issue_id), detail = (SELECT b.detail FROM bak_20261102_mp_metric_intake_plans b WHERE b.issue_id = issue_plans.issue_id) WHERE issue_id IN (SELECT issue_id FROM bak_20261102_mp_metric_intake_plans) AND outcome = 'untrusted' AND detail LIKE 'MANAGEMENT-PERSONAS-METRIC-INTAKE-1 re-arm%'; UPDATE control_registry SET alternate_path = (SELECT b.alternate_path FROM bak_20261102_mp_metric_intake_control b WHERE b.control = control_registry.control), evidence = (SELECT b.evidence FROM bak_20261102_mp_metric_intake_control b WHERE b.control = control_registry.control), reviewed_at = (SELECT b.reviewed_at FROM bak_20261102_mp_metric_intake_control b WHERE b.control = control_registry.control) WHERE control = 'code-merge-trusted-sources' AND evidence LIKE '%MANAGEMENT-PERSONAS-METRIC-INTAKE-1%';

INSERT OR IGNORE INTO ops_config (key, value, note, updated_at)
SELECT 'code_merge_trusted_sources--bak-20261102-mp-metric-intake', value, note, updated_at
FROM ops_config
WHERE key = 'code_merge_trusted_sources'
  AND trim(COALESCE(value, '')) <> ''
  AND NOT EXISTS (SELECT 1 FROM ops_config WHERE key = 'code_merge_trusted_sources--bak-20261102-mp-metric-intake');

UPDATE ops_config
SET value = value || ',management-personas|METRIC-UNMEASURED-1:',
    updated_at = datetime('now')
WHERE key = 'code_merge_trusted_sources'
  AND trim(COALESCE(value, '')) <> ''
  AND instr(value, 'management-personas|METRIC-UNMEASURED-1:') = 0
  AND EXISTS (SELECT 1 FROM ops_config WHERE key = 'code_merge_trusted_sources--bak-20261102-mp-metric-intake');

CREATE TABLE IF NOT EXISTS bak_20261102_mp_metric_intake_plans AS
SELECT p.issue_id, p.planned_at, p.detail
FROM issue_plans p
WHERE 0;

INSERT OR IGNORE INTO bak_20261102_mp_metric_intake_plans
SELECT p.issue_id, p.planned_at, p.detail
FROM issue_plans p
JOIN agent_issues a ON a.id = p.issue_id
WHERE a.status = 'open'
  AND a.source = 'management-personas'
  AND a.title LIKE 'METRIC-UNMEASURED-1:%'
  AND p.outcome = 'untrusted'
  AND NOT EXISTS (
    SELECT 1
    FROM remediation_verifications v
    WHERE v.issue_id = a.id
      AND v.class = 'issue-' || a.id
      AND v.id = (
        SELECT MAX(v2.id)
        FROM remediation_verifications v2
        WHERE v2.issue_id = a.id
          AND v2.class = 'issue-' || a.id
      )
      AND v.pass = 1
  )
  AND EXISTS (
    SELECT 1
    FROM ops_config
    WHERE key = 'code_merge_trusted_sources'
      AND instr(value, 'management-personas|METRIC-UNMEASURED-1:') > 0
  );

UPDATE issue_plans
SET planned_at = '2000-01-01T00:00:00Z',
    detail = substr('MANAGEMENT-PERSONAS-METRIC-INTAKE-1 re-arm (was untrusted at ' || planned_at || '): ' || COALESCE(detail, ''), 1, 600)
WHERE outcome = 'untrusted'
  AND issue_id IN (SELECT issue_id FROM bak_20261102_mp_metric_intake_plans)
  AND instr(COALESCE(detail, ''), 'MANAGEMENT-PERSONAS-METRIC-INTAKE-1 re-arm') = 0;

CREATE TABLE IF NOT EXISTS bak_20261102_mp_metric_intake_control AS
SELECT control, alternate_path, evidence, reviewed_at
FROM control_registry
WHERE control = 'code-merge-trusted-sources' AND 0;

INSERT OR IGNORE INTO bak_20261102_mp_metric_intake_control
SELECT control, alternate_path, evidence, reviewed_at
FROM control_registry
WHERE control = 'code-merge-trusted-sources'
  AND EXISTS (
    SELECT 1
    FROM ops_config
    WHERE key = 'code_merge_trusted_sources'
      AND instr(value, 'management-personas|METRIC-UNMEASURED-1:') > 0
  );

UPDATE control_registry
SET evidence = evidence || ' | MANAGEMENT-PERSONAS-METRIC-INTAKE-1 2026-11-02: only deterministic METRIC-UNMEASURED-1 titles from management-personas are trusted; ALTERNATE-NOT-EXERCISABLE: planner and merge runner share this provenance list',
    reviewed_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE control = 'code-merge-trusted-sources'
  AND instr(evidence, 'MANAGEMENT-PERSONAS-METRIC-INTAKE-1') = 0
  AND EXISTS (
    SELECT 1
    FROM ops_config
    WHERE key = 'code_merge_trusted_sources'
      AND instr(value, 'management-personas|METRIC-UNMEASURED-1:') > 0
  );

INSERT OR IGNORE INTO failure_modes
  (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id, trigger_condition, symptom, blast_radius)
VALUES
  ('management-personas-metric-untrusted', 'manager-generated unmeasured metric issues are never considered by the trusted code planner',
   'the shared planner and merge runner trust list admitted management-personas roadmap titles but not its deterministic metric-unmeasured titles',
   'admit only the METRIC-UNMEASURED-1 title prefix and re-arm open untrusted plans only when their latest issue-specific verification is not passing',
   'fm-management-personas-metric-untrusted', 'fm-management-personas-metric-untrusted', '2026-11-02', 1001206,
   'an open management-personas METRIC-UNMEASURED-1 issue with a failing or missing latest probe has an untrusted plan that was not re-armed',
   'unmeasured metrics remain without planner intake and no live doer',
   'manager-generated metric issues, planner intake and merge provenance');

INSERT OR IGNORE INTO remediation_contracts
  (class, issue_id, verify_probe, verify_transport, max_attempts, expected_cadence_h, status, precondition, action, escalate_to)
VALUES
  ('fm-management-personas-metric-untrusted', 1001206,
   'SELECT ''0'' AS expected, CAST((CASE WHEN instr(COALESCE((SELECT value FROM ops_config WHERE key = ''code_merge_trusted_sources''), ''''), ''management-personas|METRIC-UNMEASURED-1:'') = 0 THEN 1 ELSE 0 END) + (SELECT COUNT(*) FROM issue_plans p JOIN agent_issues a ON a.id = p.issue_id WHERE a.status = ''open'' AND a.source = ''management-personas'' AND a.title LIKE ''METRIC-UNMEASURED-1:%'' AND p.outcome = ''untrusted'' AND p.planned_at <> ''2000-01-01T00:00:00Z'' AND NOT EXISTS (SELECT 1 FROM remediation_verifications v WHERE v.issue_id = a.id AND v.class = ''issue-'' || a.id AND v.id = (SELECT MAX(v2.id) FROM remediation_verifications v2 WHERE v2.issue_id = a.id AND v2.class = ''issue-'' || a.id) AND v.pass = 1)) AS TEXT) AS observed',
   'd1-query', 1000, 1, 'active',
   'The shared trusted-source list and issue-specific verification history are readable in qnfo-audit.',
   'Keep deterministic manager metric issues eligible for normal planner review; do not re-arm an issue with a latest passing probe.',
   'qnfo-code-orchestrator');

INSERT OR IGNORE INTO capability_ledger
  (capability, provenance, prerequisites, reliability, acquired_at, evidence)
VALUES
  ('management-personas:metric-issue-planner-intake', 'migrations/2026-11-02-management-personas-metric-intake.sql',
   'shared code_merge_trusted_sources policy, issue-specific remediation_verifications, normal code planner and merge runner',
   0.5, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
   'Only generated METRIC-UNMEASURED-1 titles are admitted; existing task claims, planner deny checks, merge provenance and own-probe closure remain in force.');

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'copilot:1001206',
  'management-personas emits METRIC-UNMEASURED-1 titles deterministically from metric_improvement_now, and the planner rejection is caused by one missing exact source/title rule; an issue with a latest passing own probe must not be re-armed',
  'MANAGEMENT-PERSONAS-METRIC-INTAKE-1: add the exact manager metric title prefix to the shared trust list and re-arm only open untrusted plans whose latest issue-specific probe is not passing',
  'Live qnfo-audit 2026-11-02: three open matching plans were untrusted; probes for 1000745 and 1000800 failed, while 1000609 passed at 2026-11-02 15:25:03; the age ladder still showed 1000609 at rung 24h with no doer',
  'CI migration re-arms only unresolved matching plans; planner, intake, claims, deny rules, merge checks and issue closure probes remain authoritative',
  'The exact management-personas METRIC-UNMEASURED-1 title prefix, eligible issue_plans, the trust control, and one detector contract',
  'The Rollback header restores the trusted-source list, matching plan timestamps/details, and control evidence from their backups; decision_log remains append-only',
  'Still-failing manager-generated unmeasured metric issues become eligible for normal code planner and trusted intake recovery without creating work for a metric whose own probe already passes',
  'Matching open untrusted plans without a latest passing issue probe that are not re-armed: 2 to 0 on migration apply',
  'No direct external reach gain.',
  'Read-only qnfo-audit trust list, issue_age_actions, issue_plans, metric probes, and age ladder; migrations/management-personas-metric-intake.test.mjs; scripts/apply_migrations.py --check'
WHERE EXISTS (
    SELECT 1
    FROM ops_config
    WHERE key = 'code_merge_trusted_sources'
      AND instr(value, 'management-personas|METRIC-UNMEASURED-1:') > 0
  )
  AND NOT EXISTS (
    SELECT 1
    FROM decision_log
    WHERE action LIKE 'MANAGEMENT-PERSONAS-METRIC-INTAKE-1:%'
  );
