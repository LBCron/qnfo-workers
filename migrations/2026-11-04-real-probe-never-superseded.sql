-- REAL-PROBE-NEVER-SUPERSEDED-1 (2026-11-04, pillars autonomy and core; issue-closing quality: a closing path destroyed by one bad read is a close that can never be earned).
-- WHAT WAS WRONG (read from qnfo-audit, 2026-11-04 19:05Z)
--   24 open issues, all of them in the last 24 hours (10 in the last 3 hours), carry a contract that red-drain step 0 set to status superseded with last_verdict
--   "superseded:probe-unusable (no machine-executable probe; the issue stays open and needs a real one)", and 21 of the 24 produced a real expected/observed reading in the 7 days
--   before: issue-1000808 "budget state is not ok" (15:50Z), issue-1000804 "24 cmd failures" (14:02Z), issue-1000915 "34" days behind (14:34Z), issue-1000698 "186" (01:41Z), issue-1000427 (324
--   attempts), issue-1000822, issue-1001272 "4 age breaches have no issue_age_actions", issue-100310, metric-relapse-99906 and others. The probes are plain literal SELECTs that
--   run and fail because the defect is real. Cause: step 0 supersedes ANY active or holding contract whose last verdict is vacuous-probe-result, probe-not-machine-executable or probe-error
--   (excluding fm-, belief- and, since STANDING-LIVENESS-NEVER-SUPERSEDED-1 an hour earlier, runtime-liveness-v1). scripts/remediation_consumer.py stamps vacuous-probe-result when a read returns
--   no expected/observed pair and probe-error when the read throws, which is what a D1 read does under the overload of the last days; one such read at :36 turns the contract off for good,
--   the issue stays open with no probe, and when its defect is fixed nothing closes it. Same cause, same remedy as the standing liveness probes, for the contracts of open issues.
-- WHAT THIS CHANGES
--   (a) red-drain step 0 no longer supersedes a contract that produced a real reading (non-empty observed that is not a pending deferral) in the last 24 hours: such a probe is executable and
--       measured, so a bad read is transient. A placeholder (needs-machine-probe) or a probe with no reading in 24 hours is superseded exactly as before, so a probe that is truly unusable still ends.
--   (b) a contract of an open issue that is superseded:probe-unusable and has a real reading in the last 24 hours is re-armed now (due now, attempts kept so the history stays readable).
--   (c) detector fm-real-probe-superseded counts them, expected 0, so the loss cannot go unseen again.
--   Cost: about 20 more hourly probe reads, as these contracts ran before; the consumer reads each in one statement.
-- Prediction (decision_log): superseded contracts of open issues with a real reading in the last 24 h fall from 21 to 0 and stay there; open issues with a superseded:probe-unusable contract
-- and a real probe fall from 24 to 3 or fewer within 24 h; guards unchanged.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE fleet_tasks SET definition = (SELECT b.definition FROM bak_20261104_real_probe_task b WHERE b.id = 'red-drain'), version = version + 1 WHERE id = 'red-drain'; UPDATE fleet_tasks_canonical SET definition = (SELECT b.definition FROM bak_20261104_real_probe_task b WHERE b.id = 'red-drain') WHERE id = 'red-drain'; DROP the detector row with DELETE FROM remediation_contracts WHERE class = 'fm-real-probe-superseded'; the re-armed contracts are listed in bak_20261104_real_probe_contracts (status superseded, last_verdict as saved).
-- CAUSE-MAPPED: no metric is registered here; this edits a workflow definition, contract rows and one detector.

CREATE TABLE IF NOT EXISTS bak_20261104_real_probe_task AS SELECT * FROM fleet_tasks WHERE id = 'red-drain';
CREATE TABLE IF NOT EXISTS bak_20261104_real_probe_contracts AS
  SELECT c.class, c.issue_id, c.status, c.last_verdict, c.next_due_at, c.last_attempt_at, c.attempts
  FROM remediation_contracts c
  WHERE c.status = 'superseded' AND c.last_verdict LIKE 'superseded:probe-unusable%' AND c.issue_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM agent_issues a WHERE a.id = c.issue_id AND a.status = 'open')
    AND EXISTS (SELECT 1 FROM remediation_verifications v WHERE v.class = c.class AND v.verified_at > datetime('now', '-24 hours')
                  AND COALESCE(v.observed, '') <> '' AND lower(trim(v.observed)) NOT LIKE 'pending%');

UPDATE fleet_tasks SET
  definition = json_set(definition, '$.steps[0].sql', replace(json_extract(definition, '$.steps[0].sql'),
    'AND COALESCE(module, '''') <> ''runtime-liveness-v1'' /* STANDING-LIVENESS-NEVER-SUPERSEDED-1 */',
    'AND COALESCE(module, '''') <> ''runtime-liveness-v1'' /* STANDING-LIVENESS-NEVER-SUPERSEDED-1 */
        AND NOT EXISTS (SELECT 1 FROM remediation_verifications rv WHERE rv.class = remediation_contracts.class AND rv.verified_at > datetime(''now'', ''-24 hours'')
                          AND COALESCE(rv.observed, '''') <> '''' AND lower(trim(rv.observed)) NOT LIKE ''pending%'') /* REAL-PROBE-NEVER-SUPERSEDED-1 */')),
  version = version + 1,
  updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 'red-drain'
  AND instr(json_extract(definition, '$.steps[0].sql'), 'REAL-PROBE-NEVER-SUPERSEDED-1') = 0
  AND instr(json_extract(definition, '$.steps[0].sql'), '/* STANDING-LIVENESS-NEVER-SUPERSEDED-1 */') > 0;

-- the drift gate compares fleet_tasks with fleet_tasks_canonical: the canonical row moves with the live one, only when it matched the replaced definition
UPDATE fleet_tasks_canonical SET
  definition = (SELECT t.definition FROM fleet_tasks t WHERE t.id = 'red-drain'),
  repo_path = 'migrations/2026-11-04-real-probe-never-superseded.sql',
  exported_at = datetime('now')
WHERE id = 'red-drain'
  AND definition = (SELECT b.definition FROM bak_20261104_real_probe_task b WHERE b.id = 'red-drain')
  AND instr((SELECT t.definition FROM fleet_tasks t WHERE t.id = 'red-drain'), 'REAL-PROBE-NEVER-SUPERSEDED-1') > 0;

-- (b) the contracts the sweep switched off in the last day, on open issues with a real reading, go back to work now
UPDATE remediation_contracts SET status = 'active', next_due_at = datetime('now'),
       last_verdict = 'rearmed: REAL-PROBE-NEVER-SUPERSEDED-1 (was ' || substr(COALESCE(last_verdict, '?'), 1, 60) || '; a probe with a real reading in the last 24 hours is executable, a bad read is transient)'
 WHERE class IN (SELECT class FROM bak_20261104_real_probe_contracts)
   AND status = 'superseded' AND last_verdict LIKE 'superseded:probe-unusable%';

-- (c) the detector
INSERT OR IGNORE INTO failure_modes (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, symptom, blast_radius)
VALUES ('real-probe-superseded',
  'An open issue has no live closing probe because red-drain superseded a contract that was producing real readings',
  'red-drain step 0 supersedes any contract whose last verdict is vacuous-probe-result, probe-not-machine-executable or probe-error; the consumer stamps those on one empty or failed read, which a D1 overload produces',
  'REAL-PROBE-NEVER-SUPERSEDED-1: step 0 skips a contract with a real reading in the last 24 hours; the detector counts the ones that were lost',
  'fm-real-probe-superseded: superseded:probe-unusable contracts of open issues with a real reading in the last 24 hours, expected 0',
  'fm-real-probe-superseded', '2026-11-04',
  '24 open issues with a superseded contract on 2026-11-04, 21 of them with a real reading in the last 7 days', 'an issue whose defect is fixed is never closed by its probe, and a failing probe stops reporting');

INSERT OR IGNORE INTO remediation_contracts
  (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module, next_due_at)
VALUES
  ('fm-real-probe-superseded', NULL, 'REAL-PROBE-NEVER-SUPERSEDED-1', 'failure-mode detector: no open issue has a real probe that red-drain superseded',
   'SELECT ''0'' AS expected, CAST((SELECT COUNT(*) FROM remediation_contracts c JOIN agent_issues a ON a.id = c.issue_id WHERE c.status = ''superseded'' AND c.last_verdict LIKE ''superseded:probe-unusable%'' AND a.status = ''open'' AND EXISTS (SELECT 1 FROM remediation_verifications v WHERE v.class = c.class AND v.verified_at > datetime(''now'', ''-24 hours'') AND COALESCE(v.observed, '''') <> '''' AND lower(trim(v.observed)) NOT LIKE ''pending%'')) AS TEXT) AS observed',
   'd1-query', 3, 'qnfo-fleet-control', 1, 'active', 'failure-mode', datetime('now'));

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:issue-relapse-hold',
  'A probe that returned a real expected/observed pair in the last day is executable; one empty or failed read is the database, not the probe, and must not end the issue''s only closing path.',
  'REAL-PROBE-NEVER-SUPERSEDED-1: red-drain step 0 skips contracts with a real reading in the last 24 hours; re-arm the ones lost in the last day; detector fm-real-probe-superseded.',
  'qnfo-audit 2026-11-04 19:05Z: 24 open issues with a superseded:probe-unusable contract on a literal SELECT, all superseded in the last 24 h (10 in the last 3 h), 21 with a real reading in the last 7 days (issue-1000808 budget state is not ok at 15:50Z, 1000804 24 cmd failures at 14:02Z, 1000915 34 days behind at 14:34Z); red-drain step 0 text supersedes on vacuous-probe-result, probe-not-machine-executable or probe-error; consumer classify() stamps vacuous on an empty pair.',
  'pending canonical migration; measured by fm-real-probe-superseded and the count of open issues with a superseded contract',
  'red-drain step 0 and about 20 contracts of open issues; no code path, no spend beyond about 20 hourly probe reads',
  'Rollback line of migrations/2026-11-04-real-probe-never-superseded.sql with bak_20261104_real_probe_task and bak_20261104_real_probe_contracts',
  'an open issue keeps its measuring probe through a transient read failure',
  'superseded contracts of open issues with a real reading in the last 24 h: 21 to 0 and staying 0; open issues with a superseded probe-unusable contract: 24 to 3 or fewer within 24 h; guards issue_wontfix_share_7d and remediation_latest_pass_pct_7d unchanged',
  'not a reach change; closing quality',
  'node:sqlite suite migrations/real-probe-never-superseded.test.mjs (step 0 behaviour on seeded contracts, re-arm, canonical row, detector, idempotent re-apply); scripts/apply_migrations.py --check'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'REAL-PROBE-NEVER-SUPERSEDED-1:%');
