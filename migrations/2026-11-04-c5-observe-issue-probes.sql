-- C5-OBSERVE (2026-11-05, charter pillar autonomy): the closing probes of the two issues filed by migrations/2026-11-04-c5-observe-rows.sql read live behaviour, not the spelling of a tag.
-- WATCHMAKER-FALSE-UNMEASURED-1 (issue 1001887) was born with a code-read probe for the literal WATCHMAKER-RETRY-1. A session (breach-sla-graph-fm) and a code task (issue 99909) are already changing
-- the same function under other names (WATCHMAKER-REMEASURE-1), so a tag probe could never pass and would strand the issue. The defect is a day stored with unmeasured operations: the probe reads the
-- newest watchmaker_runs row and passes when at most 3 operations read unmeasured (was 41 on 2026-11-04). CF-CAPABILITY-ADOPT-1 (issue 1001888, code merged as PR 7493) is probed on what it must do live:
-- the metric cf_capability_undecided_14d has a value and at least one CF-CAPABILITY-DECIDE-1 issue exists.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE remediation_contracts SET verify_transport = 'code-read', verify_probe = '{"paths": ["qnfo-fleet-dashboard/worker.js"], "contains": "WATCHMAKER-RETRY-1"}', last_verdict = NULL WHERE class = 'issue-1001887'; UPDATE remediation_contracts SET verify_transport = 'code-read', verify_probe = '{"paths": ["qnfo-fleet-control/worker.js"], "contains": "CF-CAPABILITY-DECIDE-1"}', last_verdict = NULL WHERE class = 'issue-1001888';

UPDATE remediation_contracts SET verify_transport = 'd1-query', status = 'active', last_verdict = NULL,
  verify_probe = 'SELECT ''ok'' AS expected, CASE WHEN (SELECT COUNT(*) FROM watchmaker_runs WHERE day >= date(''now'', ''-1 day'')) < 1 THEN ''unmet: no watchmaker run stored in the last day'' WHEN (SELECT (length(json) - length(replace(json, ''"state":"unmeasured'', ''''))) / length(''"state":"unmeasured'') FROM watchmaker_runs ORDER BY day DESC LIMIT 1) > 3 THEN ''unmet: the newest watchmaker day still has more than 3 unmeasured operations'' ELSE ''ok'' END AS observed'
  WHERE class = 'issue-1001887';

UPDATE remediation_contracts SET verify_transport = 'd1-query', status = 'active', last_verdict = NULL,
  verify_probe = 'SELECT ''ok'' AS expected, CASE WHEN COALESCE((SELECT last_value FROM metric_registry WHERE metric = ''cf_capability_undecided_14d''), '''') IN ('''', ''x'') THEN ''unmet: cf_capability_undecided_14d has no value yet'' WHEN (SELECT COUNT(*) FROM agent_issues WHERE title >= ''CF-CAPABILITY-DECIDE-1:'' AND title < ''CF-CAPABILITY-DECIDE-1'' || char(59)) < 1 THEN ''unmet: no CF-CAPABILITY-DECIDE-1 issue has been filed'' ELSE ''ok'' END AS observed'
  WHERE class = 'issue-1001888';
