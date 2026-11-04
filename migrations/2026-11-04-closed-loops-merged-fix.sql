-- CLOSED-LOOPS-1 follow-up (2026-11-04). The first reading of fm-open-loops-unclosed was 590; 44 of those issues already have a merged fix and close on their own probe
-- (issue_plans.detail 'merged; the issue closes on its own probe'): their doer is the probe, so they are loops in progress, not lost ones. The detector now excludes them.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE remediation_contracts SET verify_probe = 'SELECT ''0'' AS expected, CAST((SELECT COUNT(*) FROM v_issue_age_ladder WHERE doer IS NULL AND age_h >= 2) + (SELECT COUNT(*) FROM issue_triage WHERE triage_state = ''closed'' AND COALESCE(TRIM(close_evidence), '''') = '''' AND triaged_at > strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-24 hours'')) AS TEXT) AS observed' WHERE class = 'fm-open-loops-unclosed';
-- CAUSE-MAPPED: registers no metric_registry row.

UPDATE remediation_contracts SET verify_probe =
  'SELECT ''0'' AS expected, CAST((SELECT COUNT(*) FROM v_issue_age_ladder WHERE doer IS NULL AND age_h >= 2 AND COALESCE(plan_reason, '''') NOT LIKE ''%merged%closes on its own probe%'') + (SELECT COUNT(*) FROM issue_triage WHERE triage_state = ''closed'' AND COALESCE(TRIM(close_evidence), '''') = '''' AND triaged_at > strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-24 hours'')) AS TEXT) AS observed'
WHERE class = 'fm-open-loops-unclosed';
