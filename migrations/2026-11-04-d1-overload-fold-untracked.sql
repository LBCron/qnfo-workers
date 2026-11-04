-- D1-OVERLOAD-FOLD-1 (2026-11-04, charter pillar autonomy; issues #6883-#6896, #6953-#6959 family).
-- scripts/cf_obs_issue_bridge.py now folds every live "D1 DB is overloaded" observability group into ONE umbrella issue
-- (CF-OBS-ISSUE-1: fleet: D1 DB is overloaded, all workers [cf-obs:d1-overload]) instead of one issue per worker, function and message.
-- Measured 2026-11-04: 20+ open CF-OBS-ISSUE-1 / LOOP-BREAKER-1 issues of this one cause, each assigned to a coding session.
-- The fm-cf-obs-untracked detector counts a live group with no open bridge issue carrying its cf-obs-id. Folded groups have none by
-- design, so without this change the detector would read them as untracked and file a failure-mode issue for every fold.
-- This adds one clause: a group whose title says "d1 db is overloaded" is tracked by the umbrella, not counted.
-- PREDICTION: no new per-group D1-overload CF-OBS-ISSUE-1 issue is filed after the bridge deploy; the umbrella holds the counts;
-- fm-cf-obs-untracked stays 0.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE remediation_contracts SET verify_probe = REPLACE(verify_probe, ' AND instr(lower(COALESCE(json_extract(d.payload, ''$.title''), '''')), ''d1 db is overloaded'') = 0', '') WHERE class = 'fm-cf-obs-untracked'

UPDATE remediation_contracts
SET verify_probe = REPLACE(
      verify_probe,
      'instr(lower(COALESCE(json_extract(d.payload, ''$.title''), '''')), ''potential vulnerability scan'') = 0',
      'instr(lower(COALESCE(json_extract(d.payload, ''$.title''), '''')), ''potential vulnerability scan'') = 0 AND instr(lower(COALESCE(json_extract(d.payload, ''$.title''), '''')), ''d1 db is overloaded'') = 0'
    )
WHERE class = 'fm-cf-obs-untracked'
  AND instr(verify_probe, 'd1 db is overloaded') = 0
  AND instr(verify_probe, 'potential vulnerability scan') > 0;
