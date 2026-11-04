-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE fleet_tasks SET definition = (SELECT b.definition FROM bak_20261104_liveness_superseded_task b WHERE b.id = 'red-drain'), version = version + 1 WHERE id = 'red-drain'; UPDATE fleet_tasks_canonical SET definition = (SELECT b.definition FROM bak_20261104_liveness_superseded_task b WHERE b.id = 'red-drain') WHERE id = 'red-drain'; UPDATE remediation_contracts SET status = 'superseded', last_verdict = (SELECT b.last_verdict FROM bak_20261104_liveness_superseded_contracts b WHERE b.class = remediation_contracts.class) WHERE class IN (SELECT class FROM bak_20261104_liveness_superseded_contracts) AND last_verdict LIKE 'rearmed: STANDING-LIVENESS-NEVER-SUPERSEDED-1%'; UPDATE remediation_contracts SET verify_probe = 'SELECT ''0'' AS expected, CAST((SELECT COUNT(*) FROM remediation_contracts WHERE module = ''runtime-liveness-v1'' AND issue_id IS NULL AND status IN (''escalated'', ''monitoring'')) AS TEXT) AS observed' WHERE class = 'fm-standing-liveness-parked'
-- spof-review: removes a silent loss of the outside-the-account probes (a sweep that parked 36 of them for ever); adds no worker, cron or binding
--
-- STANDING-LIVENESS-NEVER-SUPERSEDED-1 (2026-11-04, pillars autonomy and core; metric runtime_verified_share_24h; issues 1000986 and PROBE-NEEDED-1 #7018).
-- WHAT WAS WRONG (read from qnfo-audit and the live sites, 2026-11-04 16:50-17:10Z)
--   36 of the 58 standing liveness contracts (module runtime-liveness-v1, issue_id NULL) were status superseded with last_verdict
--   "superseded:probe-unusable (no machine-executable probe ...)" and 240 to 860 attempts each, so they measured nothing: rt-live-qnfo-ops, rt-ai-router, rt-gateway,
--   rt-fleet-dashboard, the papers, reading, q08 and qwav pages, the fleet JSON feeds. Every one of their verify_probe values is valid runner-https JSON, and all 36 pass today when
--   fetched (200 with their marker, read 2026-11-04 17:00Z). Cause: red-drain step 0 supersedes ANY active or holding contract whose last verdict is probe-error,
--   probe-not-machine-executable or vacuous-probe-result, excluding only fm- and belief- detectors. A single transient runner error (a timeout, a DNS blip) therefore turned off a standing
--   probe for ever: STANDING-LIVENESS-NEVER-PARKS-1 (2026-10-26) taught step 2 and the re-arm step about escalated and monitoring but not about superseded, and the detector
--   fm-standing-liveness-parked counts only escalated and monitoring, so it read 0 ("pass") while 36 were dark. Issue 1000986 was one casualty: its contract was superseded, so the issue
--   had no live verification path and #7018 was filed.
-- WHAT THIS CHANGES
--   (a) red-drain step 0 never supersedes a runtime-liveness-v1 contract (same exclusion step 2 has since 2026-10-26);
--   (b) a new last red-drain step re-arms any liveness contract with issue_id NULL that is superseded:probe-unusable (the two deliberate supersessions, REM-A5-RETIRE and
--       RUNTIME-LIVENESS-GAP-2, carry other verdicts and are left alone);
--   (c) the 36 are re-armed now (due now, attempts kept so the history stays readable);
--   (d) fm-standing-liveness-parked also counts superseded:probe-unusable liveness contracts, so the detector can no longer read healthy while they are dark.
--   Cost: about 36 more hourly GETs from the GitHub runner and 40 verification rows a day per contract (the contracts ran like this before they were parked). A probe that then
--   fails three times files RUNTIME-PROBE-FAIL-1 as designed.
-- CAUSE-MAPPED: no metric is registered here; this edits a workflow definition, contract rows and one detector probe.

CREATE TABLE IF NOT EXISTS bak_20261104_liveness_superseded_task AS SELECT * FROM fleet_tasks WHERE id = 'red-drain';
CREATE TABLE IF NOT EXISTS bak_20261104_liveness_superseded_contracts AS
  SELECT * FROM remediation_contracts WHERE COALESCE(module, '') = 'runtime-liveness-v1' AND issue_id IS NULL AND status = 'superseded' AND last_verdict LIKE 'superseded:probe-unusable%';

UPDATE fleet_tasks SET
  definition = json_insert(json_set(definition,
    '$.steps[0].sql', replace(json_extract(definition, '$.steps[0].sql'), 'AND substr(class,1,7) <> ''belief-''',
      'AND substr(class,1,7) <> ''belief-'' AND COALESCE(module, '''') <> ''runtime-liveness-v1'' /* STANDING-LIVENESS-NEVER-SUPERSEDED-1 */')),
    '$.steps[#]', json_object('type', 'sql', 'db', 'AUDIT', 'sql', 'UPDATE remediation_contracts SET status=''active'', next_due_at=datetime(''now''),
        last_verdict=''rearmed: STANDING-LIVENESS-NEVER-SUPERSEDED-1 (was '' || substr(COALESCE(last_verdict,''?''),1,60) || ''; a standing liveness probe is never superseded, three straight failures file RUNTIME-PROBE-FAIL-1)''
      WHERE status=''superseded'' AND issue_id IS NULL AND COALESCE(module,'''') = ''runtime-liveness-v1'' AND last_verdict LIKE ''superseded:probe-unusable%'' /* STANDING-LIVENESS-NEVER-SUPERSEDED-1 */')),
  version = version + 1,
  updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 'red-drain'
  AND instr(definition, 'STANDING-LIVENESS-NEVER-SUPERSEDED-1') = 0
  AND instr(json_extract(definition, '$.steps[0].sql'), 'AND substr(class,1,7) <> ''belief-''') > 0;

-- the drift gate compares fleet_tasks with fleet_tasks_canonical: the canonical row moves with the live one, only when it matched the replaced definition
UPDATE fleet_tasks_canonical SET
  definition = (SELECT t.definition FROM fleet_tasks t WHERE t.id = 'red-drain'),
  repo_path = 'migrations/2026-11-04-18-liveness-never-superseded.sql',
  exported_at = datetime('now')
WHERE id = 'red-drain'
  AND definition = (SELECT b.definition FROM bak_20261104_liveness_superseded_task b WHERE b.id = 'red-drain')
  AND instr((SELECT t.definition FROM fleet_tasks t WHERE t.id = 'red-drain'), 'STANDING-LIVENESS-NEVER-SUPERSEDED-1') > 0;

-- (c) the dark standing probes go back to work now
UPDATE remediation_contracts SET status = 'active', next_due_at = datetime('now'),
       last_verdict = 'rearmed: STANDING-LIVENESS-NEVER-SUPERSEDED-1 (was ' || substr(COALESCE(last_verdict, '?'), 1, 60) || '; a standing liveness probe is never superseded, three straight failures file RUNTIME-PROBE-FAIL-1)'
 WHERE status = 'superseded' AND issue_id IS NULL AND COALESCE(module, '') = 'runtime-liveness-v1' AND last_verdict LIKE 'superseded:probe-unusable%';

-- (d) the detector sees superseded too
UPDATE remediation_contracts SET verify_probe = 'SELECT ''0'' AS expected, CAST((SELECT COUNT(*) FROM remediation_contracts WHERE module = ''runtime-liveness-v1'' AND issue_id IS NULL AND (status IN (''escalated'', ''monitoring'') OR (status = ''superseded'' AND last_verdict LIKE ''superseded:probe-unusable%''))) AS TEXT) AS observed'
 WHERE class = 'fm-standing-liveness-parked';
