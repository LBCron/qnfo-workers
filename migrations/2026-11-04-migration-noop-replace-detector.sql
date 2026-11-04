-- NOOP-UPDATE-1 detector (2026-11-04, charter pillar autonomy; owner: AI spend under USD 200-300 a month and no silent no-ops).
-- Evidence (session:spend-enforce, 2026-11-04): ISSUE-PROBE-CAP-1 and ISSUE-PROBE-CAP-2 both applied "ok" in migration_runs, but their UPDATE fleet_tasks SET steps = replace(steps, ...) matched 0 rows
-- because the live text had moved on, so the cap never existed while decision_log said it did and about 1.2 M neurons a day ran uncapped for a day. scripts/apply_migrations.py discarded D1's
-- meta.changes and could not see a replace() that finds nothing (an unguarded replace() reports changes = 1 for the row its WHERE matches even when no row holds the text).
-- Change (scripts/apply_migrations.py, same PR): a top-level UPDATE ... WHERE that changed 0 rows, or a replace() whose search text no live row holds (a read-only count with the same WHERE), is reported
-- in the run's JSON (noop_updates), as a ::warning annotation and as one cloud_ops_events row (kind migration-noop-update, or migration-noop-replace for the text-surgery class); it never fails the file,
-- and a file that expects it carries a `-- NOOP-OK: <why>` line. This file adds the alarm that makes the replace class a closed loop: fm-migration-noop-replace is 1 when such a row was written in the
-- last 24 hours, so a cap, a prompt edit or a step change that did not happen is seen within the hour and filed as an issue with a doer, not found a day later in the bill.
-- Prediction: reads 0 in normal operation (a text edit that applies finds its text); any 1 is a migration whose intended change did not land. Verify: SELECT kind, text FROM cloud_ops_events WHERE kind LIKE 'migration-noop-%'.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM remediation_contracts WHERE class = 'fm-migration-noop-replace'; DELETE FROM failure_modes WHERE fm_key = 'migration-noop-replace'
-- spof-review: one read-only detector contract and one failure-mode row (idx_coe_kind_ts serves the probe: a covering SEARCH); no trigger, cron, credential or executor.
-- CAUSE-MAPPED: registers no metric_registry row.

INSERT OR IGNORE INTO failure_modes (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id, trigger_condition, symptom, blast_radius) VALUES
 ('migration-noop-replace',
  'a migration applies ok and records itself in migration_runs while its text-surgery UPDATE (replace() on a stored prompt, step list or config text) found nothing to change, so the intended cap, prompt or step edit does not exist',
  'the live text had moved on since the migration was written, and the runner discarded D1 meta.changes; an unguarded replace() even reports changes = 1 when no row holds the searched text',
  'apply_migrations.py reports the no-op (noop_updates, ::warning, cloud_ops_events kind migration-noop-replace); fm-migration-noop-replace fails for 24 hours after it so a doer rewrites the statement against the live text',
  'fm-migration-noop-replace: 1 when a migration-noop-replace event was written in the last 24 hours, expected 0',
  'fm-migration-noop-replace', '2026-11-04', (SELECT id FROM agent_issues WHERE title LIKE 'D1-OVERLOAD-1e:%' ORDER BY id DESC LIMIT 1),
  'a migration edits text with UPDATE ... replace() against a copy of the text that was current when it was written, and another change landed first',
  'decision_log or a PR body says a cap or prompt change is live, but the live fleet_tasks, ops_config or prompt row does not contain it (ISSUE-PROBE-CAP-1 and CAP-2: 1.2 M neurons a day uncapped)',
  'AI-spend caps, fleet_tasks steps, any stored prompt or step text a migration edits');

INSERT OR IGNORE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, next_due_at, module, budget_ms, max_items, requires_container) VALUES
 ('fm-migration-noop-replace', NULL, 'NOOP-UPDATE-1', 'failure-mode detector',
  'SELECT ''0'' AS expected, CAST((SELECT COUNT(*) FROM cloud_ops_events WHERE kind = ''migration-noop-replace'' AND ts >= strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-24 hours'')) AS TEXT) AS observed',
  'd1-query', 3, 'qnfo-fleet-control', 1, 'active', strftime('%Y-%m-%d %H:%M:%S', 'now'), 'failure-mode', 45000, 5, 0);

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:fleet-tick-fanout', 'a migration that applies ok but changes nothing is the same failure as one that fails, and it is worse because migration_runs and decision_log both say it worked',
  'NOOP-UPDATE-1: apply_migrations.py reports guarded UPDATEs that changed 0 rows and replace() statements whose text no live row holds (noop_updates, ::warning, cloud_ops_events migration-noop-*), never failing the file; detector fm-migration-noop-replace',
  'session:spend-enforce 2026-11-04: ISSUE-PROBE-CAP-1 and CAP-2 "applied ok" with UPDATE fleet_tasks ... replace() matching 0 rows, about 1.2 M neurons a day uncapped for a day; d1() dropped meta.changes; scripts/apply_migrations_test.py 329 pass, 2 negative controls fail when either detection is off',
  'a migration whose intended text edit did not land is visible in the run, the workflow annotation and the event table within the run, and in the detector within the hour', 'one runner behaviour (advisory only) and one read-only contract',
  'revert the runner change; the Rollback line removes the detector', 'text-surgery migrations cannot silently do nothing',
  'fm-migration-noop-replace reads 0 on 2026-11-05; any run that reports noop_updates names the statement', NULL, 'scripts/apply_migrations_test.py (329 cases, two negative controls) and migrations/migration-noop-replace-detector.test.mjs'
WHERE NOT EXISTS (SELECT 1 FROM decision_log d WHERE d.action LIKE 'NOOP-UPDATE-1:%');
