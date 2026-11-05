-- RM-BS-HYPERAGENT-MANAGERS-1 slice 1 (blue-sky roadmap B8, row 3264; MEAS-07, AGT-12, AGT-13 first step; charter pillar autonomy; W2-J 2026-11-05).
-- WHAT  The fleet gets a sealed holdout it cannot edit, a record of the scorer it is judged by, and its first evolve-one-threshold proposal, logged with a revert and NOT applied:
--       (1) manager_holdout_v0: append-only (triggers refuse UPDATE and DELETE). Seal v0-2026-11-05 holds 10 headline readings copied from metric_registry at apply time (metrics_in_breach,
--           remedy_efficacy_30d, open_agent_issues, issue_drain_ratio_24h, code_task_success_rate_30d, session_execution_ratio_30d, mttr_h_7d, issue_wontfix_share_7d, remediation_latest_pass_pct_7d
--           and the cost and publication metrics that exist), the frozen v0 config of the evolve target (analytics_metric_triggers 378: operator, threshold, cooldown) and the holdout population rule
--           (agent_issues.id % 20 = 0, 5 percent: the evolved config never applies to those units).
--       (2) manager_scorer_seal: the SQL of the judge view v_metric_trigger_state at version 1. A later change of that view passes only with a new version row written in the SAME migration
--           (INSERT ... SELECT sql FROM sqlite_master); any other change reads as drift.
--       (3) manager_evolve_proposals: one row, a threshold proposal (code_task_success_rate_30d trigger 378 threshold 0.5 -> 0.6, the registry target; today 0.53 so it does not fire) with its
--           apply and revert SQL, the holdout metrics it is judged on, a 14-day evaluation date and status 'proposed'. Nothing is applied here: SELF-CHANGE protocol (core prompt rule 7).
--       (4) failure mode manager-holdout-tamper with detector fm-manager-holdout-sealed (triggers present, seal rows present, scorer view equals its sealed text, expected ok) and a decision_log row.
--       (5) next slice as an agent_issues row: the runner in qnfo-fleet-control that applies a proposal through a migration PR, reads the holdout after the window and keeps or reverts.
-- WHY   B8 asks managers to evolve prompts, thresholds and cadences against outcomes they cannot edit, with a frozen v0 holdout, and stops the loop on any evidence it edited its own scorer
--       (AGT-13). The loop could not start because nothing was frozen: metric_registry.last_value is overwritten hourly and v_metric_trigger_state is an ordinary view any migration can replace.
-- PREDICTION: the detector reads ok at birth and stays ok until a deliberate reseal; after the 14-day window (2026-11-19) the holdout comparison says whether aligning trigger 378 with its target moved
--             code_task_success_rate_30d from 0.53 toward 0.6 with issue_wontfix_share_7d (0.0) and remediation_latest_pass_pct_7d (72.4) not worse (guards).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DROP TRIGGER IF EXISTS manager_holdout_v0_no_update; DROP TRIGGER IF EXISTS manager_holdout_v0_no_delete; DROP TABLE IF EXISTS manager_holdout_v0; DROP TABLE IF EXISTS manager_scorer_seal; DROP TABLE IF EXISTS manager_evolve_proposals; UPDATE remediation_contracts SET status = 'superseded' WHERE class = 'fm-manager-holdout-sealed'; UPDATE failure_modes SET detector = 'retired by rollback of RM-BS-HYPERAGENT-MANAGERS-1' WHERE fm_key = 'manager-holdout-tamper'
-- CAUSE-MAPPED: registers no metric_registry row; the detector is a failure_modes row with a remediation contract.
-- spof-review: adds no worker, cron or route; two triggers on a table only this file writes (they RAISE, they never write to agent_issues).

CREATE TABLE IF NOT EXISTS manager_holdout_v0 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seal_id TEXT NOT NULL,
  row_kind TEXT NOT NULL CHECK (row_kind IN ('reading', 'config', 'rule')),
  key TEXT NOT NULL,
  value REAL,
  text_value TEXT,
  kind TEXT,
  target TEXT,
  read_from TEXT NOT NULL,
  read_at TEXT,
  sealed_at TEXT NOT NULL,
  UNIQUE (seal_id, row_kind, key)
);

CREATE TRIGGER IF NOT EXISTS manager_holdout_v0_no_update BEFORE UPDATE ON manager_holdout_v0
BEGIN
  SELECT RAISE(ABORT, 'manager_holdout_v0 is sealed: append a new seal_id, never edit a row');
END;

CREATE TRIGGER IF NOT EXISTS manager_holdout_v0_no_delete BEFORE DELETE ON manager_holdout_v0
BEGIN
  SELECT RAISE(ABORT, 'manager_holdout_v0 is sealed: rows are never deleted');
END;

INSERT OR IGNORE INTO manager_holdout_v0 (seal_id, row_kind, key, value, text_value, kind, target, read_from, read_at, sealed_at)
SELECT 'v0-2026-11-05', 'reading', metric,
  CASE WHEN rtrim(trim(last_value), '% ') <> '' AND rtrim(trim(last_value), '% ') NOT GLOB '*[^0-9.+-]*' THEN CAST(rtrim(trim(last_value), '% ') AS REAL) END,
  last_value, kind, target, 'metric_registry.last_value at apply time', last_refreshed, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
FROM metric_registry
WHERE metric IN ('metrics_in_breach', 'remedy_efficacy_30d', 'open_agent_issues', 'issue_drain_ratio_24h', 'code_task_success_rate_30d', 'session_execution_ratio_30d', 'mttr_h_7d',
  'issue_wontfix_share_7d', 'remediation_latest_pass_pct_7d', 'unified_cost_usd_30d', 'publications_30d');

INSERT OR IGNORE INTO manager_holdout_v0 (seal_id, row_kind, key, value, text_value, kind, target, read_from, read_at, sealed_at)
SELECT 'v0-2026-11-05', 'config', 'analytics_metric_triggers.' || id || '.threshold', threshold, metric_key || ' ' || operator || ' ' || threshold || ' cooldown_hours ' || cooldown_hours || ' enabled ' || enabled, NULL, NULL,
  'analytics_metric_triggers row ' || id || ' at apply time', NULL, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
FROM analytics_metric_triggers WHERE id = 378;

INSERT OR IGNORE INTO manager_holdout_v0 (seal_id, row_kind, key, value, text_value, kind, target, read_from, read_at, sealed_at)
VALUES ('v0-2026-11-05', 'rule', 'holdout_population', 5, 'units of agent_issues whose id satisfies id % 20 = 0 (5 percent) are handled by the sealed v0 config: an evolved threshold, prompt or cadence never applies to them, so the comparison has a control that did not move',
  NULL, NULL, 'blue-sky roadmap B8 / MEAS-07', NULL, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));

CREATE TABLE IF NOT EXISTS manager_scorer_seal (
  object TEXT NOT NULL,
  version INTEGER NOT NULL,
  sealed_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  pr TEXT,
  sql_text TEXT NOT NULL,
  PRIMARY KEY (object, version)
);

INSERT OR IGNORE INTO manager_scorer_seal (object, version, sealed_at, reason, pr, sql_text)
SELECT name, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), 'v0 seal: the judge of metric breaches (hit = 1) as of 2026-11-05; a change needs a version 2 row from sqlite_master in the same migration', NULL, sql
FROM sqlite_master WHERE type = 'view' AND name = 'v_metric_trigger_state';

CREATE TABLE IF NOT EXISTS manager_evolve_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  proposer TEXT NOT NULL,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('threshold', 'prompt', 'cadence', 'routing')),
  target_ref TEXT NOT NULL,
  current_value TEXT,
  proposed_value TEXT,
  rationale TEXT NOT NULL,
  predicted_effect TEXT NOT NULL,
  holdout_metrics TEXT NOT NULL,
  guard_metrics TEXT NOT NULL,
  evaluate_after TEXT NOT NULL,
  apply_sql TEXT NOT NULL,
  revert_sql TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'applied', 'kept', 'reverted', 'tamper-stopped', 'rejected')),
  seal_id TEXT NOT NULL,
  scorer_version INTEGER NOT NULL,
  decision_log_id INTEGER,
  outcome TEXT,
  updated_at TEXT
);

INSERT INTO manager_evolve_proposals (created_at, proposer, target_kind, target_ref, current_value, proposed_value, rationale, predicted_effect, holdout_metrics, guard_metrics, evaluate_after, apply_sql, revert_sql, status, seal_id, scorer_version)
SELECT strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), 'session:w2-j', 'threshold', 'analytics_metric_triggers.378.threshold (code_task_success_rate_30d, operator lt)', '0.5', '0.6',
  'the registry target for code_task_success_rate_30d is ">= 0.6" but its trigger fires only below 0.5, so the metric sits at 0.53 (read 2026-11-05T03:00Z) with no breach, no issue and no remedy; the target and the trigger disagree and the trigger is the one that decides whether the code loop is told',
  'trigger 378 starts firing while the 30-day rate is in [0.5, 0.6): one METRIC-TRIGGER issue with its code-task action opens; metrics_in_breach rises by 1 on day 0 (the cost of seeing the gap); the 30-day code task success rate moves from 0.53 toward 0.6 within 14 days',
  'code_task_success_rate_30d, metrics_in_breach, remedy_efficacy_30d, mttr_h_7d', 'issue_wontfix_share_7d, remediation_latest_pass_pct_7d',
  '2026-11-19T00:00:00Z',
  'UPDATE analytics_metric_triggers SET threshold = 0.6 WHERE id = 378 AND threshold = 0.5',
  'UPDATE analytics_metric_triggers SET threshold = 0.5 WHERE id = 378 AND threshold = 0.6',
  'proposed', 'v0-2026-11-05', 1
WHERE NOT EXISTS (SELECT 1 FROM manager_evolve_proposals WHERE target_ref LIKE 'analytics_metric_triggers.378.threshold%' AND status IN ('proposed', 'applied'));

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:w2-j (blue-sky B8)',
  'a manager that evolves its own thresholds needs outcomes it cannot edit and a frozen control; the first proposal tightens a trigger to its own registry target, which is reversible and weakens no guard',
  'RM-BS-HYPERAGENT-MANAGERS-1 slice 1 PROPOSAL (not applied): analytics_metric_triggers 378 threshold 0.5 -> 0.6 (code_task_success_rate_30d), judged on the sealed holdout v0-2026-11-05 after 2026-11-19',
  'live reads 2026-11-05: metric_registry code_task_success_rate_30d last_value 0.53 target ">= 0.6"; analytics_metric_triggers 378 lt 0.5 cooldown 2 enabled 1; v_metric_trigger_state sql length 1489',
  'proposed, not applied; apply_sql and revert_sql stored in manager_evolve_proposals', 'none until applied; applying opens one METRIC-TRIGGER issue',
  'revert_sql in manager_evolve_proposals: UPDATE analytics_metric_triggers SET threshold = 0.5 WHERE id = 378 AND threshold = 0.6',
  'frozen holdout, sealed scorer and a logged, revertible proposal: the precondition for managers that evolve their own parameters',
  'code_task_success_rate_30d 0.53 -> 0.6 within 14 days of applying; guards issue_wontfix_share_7d and remediation_latest_pass_pct_7d not worse', 'none', 'live D1 reads of metric_registry, analytics_metric_triggers and sqlite_master; node:sqlite offline replay'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'RM-BS-HYPERAGENT-MANAGERS-1 slice 1 PROPOSAL%');

UPDATE manager_evolve_proposals SET decision_log_id = (SELECT MAX(id) FROM decision_log WHERE action LIKE 'RM-BS-HYPERAGENT-MANAGERS-1 slice 1 PROPOSAL%')
WHERE target_ref LIKE 'analytics_metric_triggers.378.threshold%' AND decision_log_id IS NULL;

INSERT OR IGNORE INTO failure_modes (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id, trigger_condition, symptom, blast_radius)
VALUES ('manager-holdout-tamper', 'the sealed holdout or the scorer it is judged by changes without a deliberate reseal, so an evolving manager could be grading itself',
  'the holdout and the judge view live in the same database the managers write; without triggers and a stored copy of the judge view text an edit is invisible (harness-tamper audit AGT-13)',
  'stop the evolve loop (proposals stay proposed), find the change in migration_runs and the PR history, restore the sealed text or reseal with a version row and the PR number in the same migration, and record the finding in blocker_redteam',
  'the fm-manager-holdout-sealed contract reads ok only while both holdout triggers exist, the v0 readings are present and v_metric_trigger_state equals its latest sealed text',
  'fm-manager-holdout-sealed', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), NULL,
  'a holdout trigger is missing, fewer than 8 v0 readings exist, or v_metric_trigger_state differs from manager_scorer_seal at its latest version',
  'evolved parameters are scored against a baseline or judge that may have moved; gains are illusory',
  'manager self-change decisions (blue-sky B8)');

INSERT OR IGNORE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module, next_due_at)
VALUES ('fm-manager-holdout-sealed', NULL, 'RM-BS-HYPERAGENT-MANAGERS-1', 'failure-mode detector',
  'SELECT ''ok'' AS expected, CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type = ''trigger'' AND name IN (''manager_holdout_v0_no_update'', ''manager_holdout_v0_no_delete'')) = 2 AND (SELECT COUNT(*) FROM manager_holdout_v0 WHERE seal_id = ''v0-2026-11-05'' AND row_kind = ''reading'') >= 8 AND (SELECT COUNT(*) FROM manager_scorer_seal s WHERE s.version = (SELECT MAX(x.version) FROM manager_scorer_seal x WHERE x.object = s.object) AND NOT EXISTS (SELECT 1 FROM sqlite_master m WHERE m.type = ''view'' AND m.name = s.object AND m.sql = s.sql_text)) = 0 AND (SELECT COUNT(*) FROM manager_scorer_seal) >= 1 THEN ''ok'' ELSE ''broken'' END AS observed',
  'd1-query', 3, 'qnfo-fleet-control', 1, 'active', 'failure-mode', datetime('now'));

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.OPS W2-J-HYPER-2: evolve runner applies a manager_evolve_proposals row through a migration PR and keeps or reverts it against the sealed holdout',
 'code-task: repo=qnfo-workers path=qnfo-fleet-control/worker.js' || char(10) ||
 'code-anchor: async function evaluateMetricTriggers(env) {' || char(10) ||
 'code-probe: {"paths": ["qnfo-fleet-control/worker.js"], "contains": "manager_evolve_proposals"}' || char(10) || char(10) ||
 'Charter pillar autonomy (program QNFO.OPS); roadmap row RM-BS-HYPERAGENT-MANAGERS-1 (3264), blue-sky B8 (AGT-12, MEAS-07, AGT-13). Metric it should move: remedy_efficacy_30d and mttr_h_7d against the sealed holdout v0-2026-11-05 with issue_wontfix_share_7d and remediation_latest_pass_pct_7d as guards.' || char(10) ||
 'Slice 1 (migrations/2026-11-05-rm-bs-hyperagent-managers-1.sql) froze the baseline: manager_holdout_v0 (append-only), manager_scorer_seal (v_metric_trigger_state text), manager_evolve_proposals (row 1: trigger 378 threshold 0.5 -> 0.6, evaluate_after 2026-11-19, status proposed) and the detector fm-manager-holdout-sealed.' || char(10) ||
 'DO: a step in the hourly tick of qnfo-fleet-control (cheap, no model call) that (1) refuses to run unless the fm-manager-holdout-sealed probe reads ok; (2) for a proposal in status proposed, files the apply as a migration through the canonical path (the migration runs apply_sql and sets status applied with the PR number) rather than writing analytics_metric_triggers itself; (3) after evaluate_after reads the holdout metrics now against manager_holdout_v0, separately for the unit population id % 20 = 0 (sealed config) and the rest, and for the guard metrics; (4) keeps the change only when the target metric moved and no guard worsened, otherwise opens a revert migration with revert_sql and records why in manager_evolve_proposals.outcome and decision_log (outcome_matched); (5) sets status tamper-stopped and files a tamper issue when the detector reads broken. Model-free; one proposal at a time (one change per component).' || char(10) ||
 'Definition of done: merged and verified live: the tick step runs and logs a cloud_ops_events row, proposal 1 reaches kept or reverted by its evaluate_after date with the measurement in outcome; recorded in issue_triage.close_evidence.',
 'session:w2-j', 'optimization', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.OPS W2-J-HYPER-2%' AND status = 'open');
