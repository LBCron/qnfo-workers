-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_liveness_issue_bound_task
-- Rollback: UPDATE fleet_tasks SET definition = (SELECT b.definition FROM bak_20261105_liveness_issue_bound_task b WHERE b.id = 'red-drain'), version = version + 1 WHERE id = 'red-drain'; UPDATE fleet_tasks_canonical SET definition = (SELECT b.definition FROM bak_20261105_liveness_issue_bound_task b WHERE b.id = 'red-drain') WHERE id = 'red-drain'; UPDATE remediation_contracts SET verify_probe = 'SELECT ''0'' AS expected, CAST((SELECT COUNT(*) FROM remediation_contracts WHERE module = ''runtime-liveness-v1'' AND issue_id IS NULL AND (status IN (''escalated'', ''monitoring'') OR (status = ''superseded'' AND last_verdict LIKE ''superseded:probe-unusable%''))) AS TEXT) AS observed' WHERE class = 'fm-standing-liveness-parked';
-- spof-review: no worker, cron, binding or host is added; this widens one existing red-drain re-arm step by the issue-bound liveness contracts.
--
-- LIVENESS-ISSUE-BOUND-REARM-1 (2026-11-05, charter pillar autonomy; metric runtime_verified_share_24h; GitHub #7040 STALE-MARKER part (a), sweep cluster B-governance-code).
-- WHAT WAS LEFT (read from qnfo-audit 2026-11-04 23:20Z): migrations/2026-11-04-18-liveness-never-superseded.sql stopped red-drain step 0 from superseding a runtime-liveness-v1 contract and re-armed the
-- 36 standing ones, but its re-arm step and its detector fm-standing-liveness-parked both say `issue_id IS NULL`. A liveness contract that already had a RUNTIME-PROBE-FAIL-1 issue attached is
-- issue-bound, so three stayed dark with valid runner-https JSON and 245 to 734 attempts: rt-live-q08-signal-engine (issue 1001466), rt-page-qwav-sitemap (1000994), rt-page-fleet-area-reliability (1001465).
-- rt-page-qwav-home (1000986), the case #7040 names, was re-armed by hand and reads pass; the detector still read 0 while the three were dark.
-- WHAT THIS CHANGES: (a) red-drain's re-arm step also re-arms an issue-bound liveness contract whose verdict is superseded:probe-unusable (the two deliberate supersessions, REM-A5-RETIRE and
-- RUNTIME-LIVENESS-GAP-2, carry other verdicts and stay); step 0 cannot supersede it again, so this is not a loop; (b) the three are re-armed now; (c) fm-standing-liveness-parked counts
-- issue-bound ones too, so it cannot read healthy while they are dark. The stale-marker hint for a missing-marker observation (part (b) of #7040) is already on main: probe_fail_description, PR 7057.
-- Cost: three more hourly GETs from the GitHub runner. A probe that then fails three times in a row reopens or files RUNTIME-PROBE-FAIL-1 as designed.
-- CAUSE-MAPPED: no metric is registered here; this edits a workflow definition, contract rows and one detector probe.

CREATE TABLE IF NOT EXISTS bak_20261105_liveness_issue_bound_task AS SELECT * FROM fleet_tasks WHERE id = 'red-drain';

UPDATE fleet_tasks SET
  definition = replace(definition,
    'status=''superseded'' AND issue_id IS NULL AND COALESCE(module,'''') = ''runtime-liveness-v1'' AND last_verdict LIKE ''superseded:probe-unusable%'' /* STANDING-LIVENESS-NEVER-SUPERSEDED-1 */',
    'status=''superseded'' AND COALESCE(module,'''') = ''runtime-liveness-v1'' AND last_verdict LIKE ''superseded:probe-unusable%'' /* STANDING-LIVENESS-NEVER-SUPERSEDED-1 LIVENESS-ISSUE-BOUND-REARM-1 */'),
  version = version + 1,
  updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 'red-drain'
  AND instr(definition, 'LIVENESS-ISSUE-BOUND-REARM-1') = 0
  AND instr(definition, 'status=''superseded'' AND issue_id IS NULL AND COALESCE(module,'''') = ''runtime-liveness-v1'' AND last_verdict LIKE ''superseded:probe-unusable%'' /* STANDING-LIVENESS-NEVER-SUPERSEDED-1 */') > 0;

-- the drift gate compares fleet_tasks with fleet_tasks_canonical: the canonical row moves with the live one, only when it matched the replaced definition
UPDATE fleet_tasks_canonical SET
  definition = (SELECT t.definition FROM fleet_tasks t WHERE t.id = 'red-drain'),
  repo_path = 'migrations/2026-11-05-liveness-issue-bound-rearm.sql',
  exported_at = datetime('now')
WHERE id = 'red-drain'
  AND definition = (SELECT b.definition FROM bak_20261105_liveness_issue_bound_task b WHERE b.id = 'red-drain')
  AND instr((SELECT t.definition FROM fleet_tasks t WHERE t.id = 'red-drain'), 'LIVENESS-ISSUE-BOUND-REARM-1') > 0;

-- (b) the dark issue-bound probes go back to work now (attempts kept so the history stays readable)
UPDATE remediation_contracts SET status = 'active', next_due_at = datetime('now'),
       last_verdict = 'rearmed: LIVENESS-ISSUE-BOUND-REARM-1 (was ' || substr(COALESCE(last_verdict, '?'), 1, 60) || '; a standing liveness probe is never superseded, three straight failures reopen or file RUNTIME-PROBE-FAIL-1)'
 WHERE status = 'superseded' AND issue_id IS NOT NULL AND COALESCE(module, '') = 'runtime-liveness-v1' AND last_verdict LIKE 'superseded:probe-unusable%';

-- (c) the detector sees issue-bound contracts too
UPDATE remediation_contracts SET verify_probe = 'SELECT ''0'' AS expected, CAST((SELECT COUNT(*) FROM remediation_contracts WHERE module = ''runtime-liveness-v1'' AND (status IN (''escalated'', ''monitoring'') OR (status = ''superseded'' AND last_verdict LIKE ''superseded:probe-unusable%''))) AS TEXT) AS observed'
 WHERE class = 'fm-standing-liveness-parked';
