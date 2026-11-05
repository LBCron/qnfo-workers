-- OPS-TOOL-ERRSHAPE-1 (2026-11-05, session C-ops-tools; charter pillar autonomy; program QNFO.OPS). Companion of qnfo-ops 2.66.1 for agent_issues 1000810 (web_search single path),
-- 1001394 (TOOL-FAILURE cf_worker_read), 1001469 (LOOP-BREAKER run_code_net) and the already-passing 1000838, 1000990, 1001245, 1001460.
-- WHAT WAS MEASURED (2026-11-05, cloud_ops_events kind ops_ai_tool): OPS-ARG-ALIAS-1 (2.62.20) stopped the original shapes, and after it deployed the tools produced only these residual
-- failures: cf_worker_read called as {name:"cf_worker_read", arguments:{worker}} (the call envelope sent as the arguments, then a 404 on the tool's own name, status error); workspace_grep with the
-- PCRE flag "(?i)" ("Invalid group", status error); fleet_graph with the invented ops grep, routes and stats (rejected, then retried with another invented op) and an impact lookup of a node the graph
-- does not hold (status error); run_code_net failures whose meta was cut at 600 characters in the middle of the JSON, so $.error is unreadable and the failure signature of LOOP-BREAKER 1001469 is the
-- bare tool name. The contract of 1001469 could never pass (expected 'errors without readable $.error: 0', observed 'errors without readable $.error: N of M'); the contract of 1001394 is a 24 h error
-- RATIO with 6 calls in the window, so one error fails it; the contract of 1000810 reads whether a web_search call has happened since the fix, and none has since 2026-10-29.
-- WHAT THIS DOES: replaces those three probes with ones that measure the defect after the fix reaches production (qnfo-ops 2.66.1 or later in fleet_deploys): 1001469 and 1001394 count error-status
-- events since that deploy and answer 'fix not deployed yet' (a fail) before it, so they do not pass vacuously on a quiet window; 1000810 reads the code that names the path that ran. The regression
-- tests are qnfo-ops/tool-errshape.test.mjs (45 checks, offline). No issue is closed here; the contracts close them.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_ops_errshape_contracts
-- Rollback: UPDATE remediation_contracts SET verify_probe = (SELECT b.verify_probe FROM bak_20261105_ops_errshape_contracts b WHERE b.class = remediation_contracts.class), verify_transport = (SELECT b.verify_transport FROM bak_20261105_ops_errshape_contracts b WHERE b.class = remediation_contracts.class) WHERE class IN ('issue-1000810', 'issue-1001394', 'issue-1001469');

CREATE TABLE IF NOT EXISTS bak_20261105_ops_errshape_contracts AS SELECT class, verify_probe, verify_transport, last_verdict FROM remediation_contracts WHERE class IN ('issue-1000810', 'issue-1001394', 'issue-1001469');

UPDATE remediation_contracts
SET verify_probe = '{"paths": ["qnfo-ops/worker.js"], "contains": "search_path: p.id"}', verify_transport = 'code-read', status = 'active', last_verdict = NULL, attempts = 0, next_due_at = datetime('now')
WHERE class = 'issue-1000810' AND issue_id = 1000810;

UPDATE remediation_contracts
SET verify_probe = 'WITH d AS (SELECT MIN(ts) AS t FROM fleet_deploys WHERE worker = ''qnfo-ops'' AND ok = 1 AND to_sha GLOB ''2.[0-9]*.[0-9]*'' AND CAST(substr(to_sha, 3, instr(substr(to_sha, 3), ''.'') - 1) AS INTEGER) * 1000 + CAST(substr(to_sha, 3 + instr(substr(to_sha, 3), ''.'')) AS INTEGER) >= 66001) SELECT ''0'' AS expected, CASE WHEN d.t IS NULL THEN ''fix not deployed yet'' ELSE CAST((SELECT COUNT(*) FROM cloud_ops_events e WHERE e.kind = ''ops_ai_tool'' AND e.text = ''run_code_net'' AND e.status = ''error'' AND e.ts > d.t AND COALESCE(CASE WHEN json_valid(e.meta) THEN json_extract(e.meta, ''$.error'') END, '''') = '''') AS TEXT) END AS observed FROM d',
    verify_transport = 'd1-query', status = 'active', last_verdict = NULL, attempts = 0, next_due_at = datetime('now')
WHERE class = 'issue-1001469' AND issue_id = 1001469;

UPDATE remediation_contracts
SET verify_probe = 'WITH d AS (SELECT MIN(ts) AS t FROM fleet_deploys WHERE worker = ''qnfo-ops'' AND ok = 1 AND to_sha GLOB ''2.[0-9]*.[0-9]*'' AND CAST(substr(to_sha, 3, instr(substr(to_sha, 3), ''.'') - 1) AS INTEGER) * 1000 + CAST(substr(to_sha, 3 + instr(substr(to_sha, 3), ''.'')) AS INTEGER) >= 66001) SELECT ''0'' AS expected, CASE WHEN d.t IS NULL THEN ''fix not deployed yet'' ELSE CAST((SELECT COUNT(*) FROM cloud_ops_events e WHERE e.kind = ''ops_ai_tool'' AND e.text = ''cf_worker_read'' AND e.status = ''error'' AND e.ts > d.t) AS TEXT) END AS observed FROM d',
    verify_transport = 'd1-query', status = 'active', last_verdict = NULL, attempts = 0, next_due_at = datetime('now')
WHERE class = 'issue-1001394' AND issue_id = 1001394;
