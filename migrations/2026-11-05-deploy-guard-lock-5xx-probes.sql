-- D1-LOCK-OVERLOAD-1 (2026-11-05, charter pillar autonomy; cluster D1-observability of the open-issue sweep).
-- GitHub 6456 (agent_issues 1001280, Cloudflare group ef14ea93-3eec-4ab0-9c48-8f26dbf892a0, qnfo-deploy-guard HttpServerError HTTP 500) and
-- GitHub 6731 (agent_issues 1001391, group dd1704bf-c359-4fc1-a525-87e32ffff864, qnfo-deploy-guard HttpServerError HTTP 503).
--
-- WHAT WAS MEASURED (qnfo-audit SELECT only, 2026-11-05 00:00Z)
--   worker_logs, script_name qnfo-deploy-guard, last 24 h, status 500 or above, grouped by route: POST /work-lock/acquire 30 + 15 (service binding and workers.dev), POST /lock/acquire 5 + 17,
--   POST /work-lock/release 6 + 2, POST /lock/release 1, secret-lock acquire and release 1 + 1, all 500; GET /work-locks 10 + 8, all 503. Group counts since first sight: 180 (HTTP 500, first 2026-10-25) and 45
--   (HTTP 503, first 2026-10-22), still hourly. The 500 is the explicit `return [500, {error: "lock_db_unavailable"}]` of acquireLease and releaseLease and the 503 is workList's `lock_db_unavailable`: the
--   lock routes turned the first "D1 DB is overloaded. Too many resources consumed within a 10 second window" refusal of qnfo-audit into a 5xx. The fix is in qnfo-deploy-guard 1.4.7 (retry the lock
--   INSERT, the release DELETE and the open read three times over about 4.6 s; a lasting refusal is a 503 with Retry-After; a throwing route answers JSON).
--
-- WHAT THIS FILE DOES
--   The two issues' contracts watch the Cloudflare group, which counts every 5xx of the worker and is quiet only after 6 hours without one. They keep that meaning but gain a probe on the telemetry that the
--   fix changes: 5xx responses of qnfo-deploy-guard on its lock routes in the last 6 hours (expected 0), with a liveness guard: no telemetry row in the last hour reads `pending:` (a deferral, neither opens
--   nor closes) instead of a vacuous 0. The contracts leave module issue-birth-probe-families so contract_probe_templates_family_reassert cannot write the family probe back. Failure mode
--   deploy-guard-lock-overload-5xx gets the same measure over 24 hours as its detector fm-deploy-guard-lock-5xx.
--
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM remediation_contracts WHERE class = 'fm-deploy-guard-lock-5xx'; DELETE FROM failure_modes WHERE fm_key = 'deploy-guard-lock-overload-5xx'; UPDATE remediation_contracts SET verify_probe = (SELECT b.verify_probe FROM bak_20261105_deploy_guard_5xx_contracts b WHERE b.class = remediation_contracts.class), module = (SELECT b.module FROM bak_20261105_deploy_guard_5xx_contracts b WHERE b.class = remediation_contracts.class) WHERE class IN ('issue-1001280', 'issue-1001391') AND EXISTS (SELECT 1 FROM bak_20261105_deploy_guard_5xx_contracts b WHERE b.class = remediation_contracts.class)
-- CAUSE-MAPPED: no metric is registered here; the failure mode has its own detector contract.

CREATE TABLE IF NOT EXISTS bak_20261105_deploy_guard_5xx_contracts AS SELECT class, verify_probe, module, status, last_verdict FROM remediation_contracts WHERE class IN ('issue-1001280', 'issue-1001391');

-- the 500 group (1001280) and the 503 group (1001391): 5xx of that status on a lock route in the last 6 hours
UPDATE remediation_contracts SET verify_probe = 'SELECT ''0'' AS expected, CASE WHEN NOT EXISTS (SELECT 1 FROM worker_logs WHERE script_name = ''qnfo-deploy-guard'' AND ts_ms > (CAST(strftime(''%s'', ''now'') AS INTEGER) - 3600) * 1000) THEN ''pending: no qnfo-deploy-guard telemetry ingested in the last hour'' ELSE CAST((SELECT COUNT(*) FROM worker_logs WHERE script_name = ''qnfo-deploy-guard'' AND ts_ms > (CAST(strftime(''%s'', ''now'') AS INTEGER) - 21600) * 1000 AND status = 500 AND instr(url, ''lock'') > 0) AS TEXT) END AS observed',
  verify_transport = 'd1-query', status = 'active', module = 'deploy-guard-lock-5xx', next_due_at = datetime('now'), attempts = 0
WHERE class = 'issue-1001280' AND COALESCE(module, '') <> 'deploy-guard-lock-5xx';

UPDATE remediation_contracts SET verify_probe = 'SELECT ''0'' AS expected, CASE WHEN NOT EXISTS (SELECT 1 FROM worker_logs WHERE script_name = ''qnfo-deploy-guard'' AND ts_ms > (CAST(strftime(''%s'', ''now'') AS INTEGER) - 3600) * 1000) THEN ''pending: no qnfo-deploy-guard telemetry ingested in the last hour'' ELSE CAST((SELECT COUNT(*) FROM worker_logs WHERE script_name = ''qnfo-deploy-guard'' AND ts_ms > (CAST(strftime(''%s'', ''now'') AS INTEGER) - 21600) * 1000 AND status = 503 AND instr(url, ''lock'') > 0) AS TEXT) END AS observed',
  verify_transport = 'd1-query', status = 'active', module = 'deploy-guard-lock-5xx', next_due_at = datetime('now'), attempts = 0
WHERE class = 'issue-1001391' AND COALESCE(module, '') <> 'deploy-guard-lock-5xx';

INSERT OR IGNORE INTO failure_modes (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id)
VALUES ('deploy-guard-lock-overload-5xx', 'the lock routes of qnfo-deploy-guard answer a D1 overload refusal with HTTP 500 or 503 on the first refusal',
  'acquireLease and releaseLease returned 500 and workList 503 when qnfo-audit refused one statement for a few seconds; no retry, no Retry-After, no body for a throwing route',
  'D1-LOCK-OVERLOAD-1 (qnfo-deploy-guard 1.4.7): bounded retry of the lock statements, 503 with Retry-After on a lasting refusal, JSON for a throwing route',
  '5xx responses of qnfo-deploy-guard on a lock route in worker_logs over 24 hours',
  'fm-deploy-guard-lock-5xx', '2026-11-05', 1001280);

INSERT OR IGNORE INTO remediation_contracts (class, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module)
VALUES ('fm-deploy-guard-lock-5xx', 'D1-LOCK-OVERLOAD-1', 'failure-mode detector',
  'SELECT ''0'' AS expected, CASE WHEN NOT EXISTS (SELECT 1 FROM worker_logs WHERE script_name = ''qnfo-deploy-guard'' AND ts_ms > (CAST(strftime(''%s'', ''now'') AS INTEGER) - 3600) * 1000) THEN ''pending: no qnfo-deploy-guard telemetry ingested in the last hour'' ELSE CAST((SELECT COUNT(*) FROM worker_logs WHERE script_name = ''qnfo-deploy-guard'' AND ts_ms > (CAST(strftime(''%s'', ''now'') AS INTEGER) - 86400) * 1000 AND status >= 500 AND instr(url, ''lock'') > 0) AS TEXT) END AS observed',
  'd1-query', 3, 'qnfo-deploy-guard', 2, 'active', 'failure-mode');

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:D1-observability',
  'a lock call that D1 refuses for a few seconds should be absorbed or answered as a retryable 503, not turned into a 500 that every caller reads as a defect',
  'D1-LOCK-OVERLOAD-1: qnfo-deploy-guard 1.4.7 retries the lock statements; issue contracts 1001280 and 1001391 and the detector fm-deploy-guard-lock-5xx measure 5xx responses on the lock routes',
  'worker_logs 2026-11-04 to 2026-11-05: about 80 responses with status 500 and 18 with 503 on /work-lock/acquire, /work-lock/release, /lock/acquire, /work-locks in 24 h; offline suite qnfo-deploy-guard/d1-overload-resilience.test.mjs and migrations/deploy-guard-lock-5xx-probes.test.mjs',
  'worker deploy by the canonical path, migration applied on merge',
  'one worker (qnfo-deploy-guard, lock routes only), two contract rows, one failure mode and its detector',
  'Rollback line of migrations/2026-11-05-deploy-guard-lock-5xx-probes.sql; revert the worker change by reverting the merge',
  'a lock call survives a 5 to 10 second D1 refusal',
  'lock-route 5xx per 24 h: about 98 to under 20 within a day of the deploy; zero for six hours closes 1001280 and 1001391 through their contracts',
  'none',
  'live LIMITed D1 reads, offline sqlite suites'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'D1-LOCK-OVERLOAD-1:%');
