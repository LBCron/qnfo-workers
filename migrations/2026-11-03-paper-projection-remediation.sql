-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261103_paper_projection_learnings
-- Rollback: UPDATE paper_learnings SET fleet_status = (SELECT b.fleet_status FROM bak_20261103_paper_projection_learnings b WHERE b.id = paper_learnings.id), status_note = (SELECT b.status_note FROM bak_20261103_paper_projection_learnings b WHERE b.id = paper_learnings.id), updated_at = (SELECT b.updated_at FROM bak_20261103_paper_projection_learnings b WHERE b.id = paper_learnings.id) WHERE id IN (SELECT id FROM bak_20261103_paper_projection_learnings); DROP TABLE IF EXISTS bak_20261103_paper_projection_learnings; DELETE FROM metric_breach_cause WHERE metric_key IN ('paper_model_projection_remediation_share_7d', 'paper_unlabeled_model_projection_issues_7d'); DELETE FROM analytics_metric_triggers WHERE metric_key = 'paper_unlabeled_model_projection_issues_7d'; DELETE FROM metric_registry WHERE metric IN ('paper_model_projection_remediation_share_7d', 'paper_unlabeled_model_projection_issues_7d'); DELETE FROM ops_config WHERE key = 'paper_projection_enforcement_since'
-- CAUSE-MAPPED: both new measures concern evidence labeling at the research-to-remediation boundary; measurement is the existing cause family.
-- METRIC-EXEMPT: paper_model_projection_remediation_share_7d is observational; a high share is not inherently a defect, so the actionable trigger is the zero-target omission guard.
-- PAPER-LEARN-PROJECTIONS-1 (charter pillar: autonomy): paper_learnings 5981, 5982 and 5984 reproduce within the paper's formal equations, but no evidence maps the vacuum model's thresholds, correction gain or Nyquist bound to fleet issue/metric dynamics. Reject those proposed operational transfers. Apply learning 5987: model-derived and assumption outputs in generated issues must be labeled as unconfirmed projections, not measured facts.

CREATE TABLE IF NOT EXISTS bak_20261103_paper_projection_learnings AS
SELECT id, fleet_status, status_note, updated_at
FROM paper_learnings
WHERE id IN (5981, 5982, 5984, 5987)
  AND slug = 'the-speed-of-light-as-the-tracing-capacity-of-a-distributed-estimation-vacuum-ca'
  AND version = '1.0.0';

UPDATE paper_learnings
SET fleet_status = 'rejected',
    status_note = 'PL-TRIAGE-1 rejected (2026-11-03; model-transfer-not-established): the paper''s recursion reproduces the stated divergence times, but no measured mapping connects its estimator growth rate to issue or metric dynamics. Do not copy its projected threshold margins into fleet triggers.',
    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 5981
  AND slug = 'the-speed-of-light-as-the-tracing-capacity-of-a-distributed-estimation-vacuum-ca'
  AND version = '1.0.0'
  AND applicability = 'direct'
  AND fleet_status IN ('probation', 'proposed');

UPDATE paper_learnings
SET fleet_status = 'rejected',
    status_note = 'PL-TRIAGE-1 rejected (2026-11-03; model-transfer-not-established): the paper''s formula reproduces a 21.85-fold threshold ratio over its assumed gain values, but fleet budget changes are not shown to alter an equivalent per-update gain. Do not use the projected ratio as a fleet threshold.',
    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 5982
  AND slug = 'the-speed-of-light-as-the-tracing-capacity-of-a-distributed-estimation-vacuum-ca'
  AND version = '1.0.0'
  AND applicability = 'direct'
  AND fleet_status IN ('probation', 'proposed');

UPDATE paper_learnings
SET fleet_status = 'rejected',
    status_note = 'PL-TRIAGE-1 rejected (2026-11-03; model-transfer-not-established): 1/pi is correct for the paper''s lattice, but no fleet evidence demonstrates sampling aliasing between loop cadence and metric/issue arrival rates. Do not add a Nyquist rule without such a measurement.',
    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 5984
  AND slug = 'the-speed-of-light-as-the-tracing-capacity-of-a-distributed-estimation-vacuum-ca'
  AND version = '1.0.0'
  AND applicability = 'direct'
  AND fleet_status IN ('probation', 'proposed');

UPDATE paper_learnings
SET fleet_status = 'applied',
    status_note = 'PAPER-LEARN-PROJECTIONS-1 applied (2026-11-03; migrations/2026-11-03-paper-projection-remediation.sql and qnfo-lifecycle 1.17.6): generated issues label derived and assumption outputs as model projections, explicitly not measured facts; the omission guard and seven-day remediation-share measure verify the boundary.',
    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 5987
  AND slug = 'the-speed-of-light-as-the-tracing-capacity-of-a-distributed-estimation-vacuum-ca'
  AND version = '1.0.0'
  AND applicability = 'direct'
  AND fleet_status IN ('probation', 'proposed');

INSERT OR IGNORE INTO ops_config (key, value, note)
VALUES ('paper_projection_enforcement_since',
        CAST(CAST(strftime('%s', 'now') AS INTEGER) * 1000 AS TEXT),
        'PAPER-LEARN-PROJECTIONS-1: start of the labeled-projection measurement window in epoch milliseconds');

INSERT OR IGNORE INTO metric_registry
  (metric, layer, kind, formula, source_of_truth, baseline, target, owner, disposition_actor, refresh_cadence, warning_band, kill_band, state, refresh_class)
VALUES
  ('paper_model_projection_remediation_share_7d', 'operational', 'leading',
   '100 * distinct paper versions with direct derived/assumption model learnings linked to a PAPER-LEARN-1 issue / all such versions in the rollout-bounded trailing 7 days; n/a when denominator is zero',
   'qnfo-audit.paper_learnings (qnfo-lifecycle PAPER-LEARN-1)', 'unmeasured at rollout', 'observational; establish baseline',
   'qnfo-lifecycle', 'exempt: observational rate; an issue-linked learning is not inherently a defect', '1h', 'n/a', 'n/a', 'UNMEASURED', 'computed'),
  ('paper_unlabeled_model_projection_issues_7d', 'operational', 'guard',
   'count of rollout-bounded PAPER-LEARN-1 issues in the trailing 7 days linked to a direct derived/assumption model learning but missing the exact MODEL PROJECTION — UNCONFIRMED label',
   'qnfo-audit.agent_issues + paper_learnings (qnfo-lifecycle PAPER-LEARN-1)', '0 at rollout', '0',
   'qnfo-lifecycle', 'trigger gt 0', '1h', '> 0', '> 0', 'UNMEASURED', 'computed');

INSERT OR IGNORE INTO metric_breach_cause (metric_key, cause_key, note) VALUES
  ('paper_model_projection_remediation_share_7d', 'measurement', 'METRIC-CAUSE-AT-REGISTRATION-1: observational research-remediation rate'),
  ('paper_unlabeled_model_projection_issues_7d', 'measurement', 'METRIC-CAUSE-AT-REGISTRATION-1: missing projection label at research-remediation boundary');

INSERT OR IGNORE INTO analytics_metric_triggers
  (metric_key, title, source_table, operator, threshold, priority, action, owner, queue_target, cooldown_hours, enabled, notes)
VALUES
  ('paper_unlabeled_model_projection_issues_7d',
   'PAPER-LEARN-1: unconfirmed model outputs entered remediation without a projection label',
   'registry', 'gt', 0, 7,
   'Charter pillar: autonomy. Restore the MODEL PROJECTION — UNCONFIRMED label in every generated PAPER-LEARN-1 issue that includes a direct derived or assumption learning; check that no downstream consumer treats its numbers as measured facts. Definition of done: paper_unlabeled_model_projection_issues_7d = 0 at the latest metric refresh.'
     || char(10) || 'code-task: repo=qnfo-workers path=qnfo-lifecycle/worker.js'
     || char(10) || 'code-anchor: async function plFileIssue(env, p, strong) {',
   'qnfo-lifecycle', 'agent_issues', 24, 1, 'PAPER-LEARN-PROJECTIONS-1');

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'copilot/paper-learn-1-apply-speed-of-light',
       'The paper correctly derives numbers inside its model, but its own stated physical interpretation is unconfirmed; only the issue-labeling learning transfers directly to the fleet.',
       'PAPER-LEARN-PROJECTIONS-1: label unconfirmed model projections in paper-learning issues; reject three unmeasured model-to-fleet transfers; register remediation-share and label-omission measures.',
       'Read the cited paper in full and recomputed R5 (39.86 and 199.32 updates), the R4 gain ratio (21.85), and the R3 fraction (1/pi); qnfo-audit paper_learnings 5981, 5982, 5984 and 5987 identify the matching claims.',
       'Applied through the canonical migration and qnfo-lifecycle release; live verification remains the closing probe.',
       'qnfo-lifecycle PAPER-LEARN-1 generated issues and two metric_registry rows',
       'Rollback from migrations/2026-11-03-paper-projection-remediation.sql; restore the backed-up learning rows.',
       'Formal model outputs in generated issues are explicitly distinguished from measurements, and the omission rate is automatically detected.',
       'Future PAPER-LEARN-1 issues label every derived/assumption claim as a projection; omission metric remains 0 after deployment.',
       'All downstream issue consumers receive the model-status label at the issue source.',
       'paper full text; qnfo-audit paper_learnings; node:sqlite regression suites; canonical post-deploy metric probe'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'PAPER-LEARN-PROJECTIONS-1:%');
