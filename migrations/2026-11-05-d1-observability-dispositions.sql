-- D1-OBSERVABILITY dispositions (2026-11-05, charter pillar autonomy; cluster D1-observability of the open-issue sweep).
-- GitHub 6862 (agent_issues 1001546, qnfo-fleet-control HttpServerError HTTP 503), 6174 (agent_issues 1000993, qnfo-ai HttpServerError HTTP 502) and
-- 6158 (agent_issues 1000984, qnfo-ai HTTP 504).
--
-- WHAT WAS MEASURED (qnfo-audit SELECT only, 2026-11-05 00:00Z to 01:00Z)
--   1001546: worker_logs qnfo-fleet-control status 500 or 503 in 24 h: POST /breach-doctor/run (503 when its D1 read fails, 500 when the doctor tick is not ok), GET /loops (500, an uncaught D1 read).
--   Six of the twelve land within two seconds of qnfo-deploy-guard lock_db_unavailable responses (06:00:56/06:00:54, 10:00:58/10:00:59, 12:25:06/12:25:07, 16:00:57/16:00:57, 18:20:58/18:20:58,
--   22:21:00/22:21:01): the minutes in which the fleet tick saturates qnfo-audit. The cause is the shared D1 condition the umbrella issue tracks; qnfo-deploy-guard 1.4.7 absorbs it on the lock routes.
--   1000984 / 1000993: qnfo-ai answers 504 router_timeout (389 in 24 h) and 502 (about 19) on POST /v1/chat/completions. ai_calibration_results shows the 504s are its own model-route probes at hh:00:
--   at 00:00, 10:00, 16:00, 20:00 and 22:00Z all ten routes (glm-5.3-flash, kimi-k2.6, gpt-oss-120b, glm-5.3, deepseek-v4-pro and the rest) answered http=504 in one sweep, at other hours none or one. The
--   router returns the failing legs in the 504 body but the probe keeps only http=504 echo=false, so a wholesale failure cannot be told from a model failure.
--
-- WHAT THIS FILE DOES
--   1. Gives agent_issues 1000993 the same measuring probe 1000984 already has: qnfo-ai HTTP 502 responses in worker_logs over 6 hours (expected 0), with a telemetry-liveness guard, off the family module.
--   2. Supersedes 1001546 by the umbrella (only while the umbrella is open; the same ledger statements as the hourly fold, with the evidence above).
--   3. Files the doer ROUTER-LEGS-1 (code-task on qnfo-ai-calibration/worker.js, held by another session until 02:22Z): the model-route probe records the router's error type, budget and legs.
--
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE remediation_contracts SET verify_probe = (SELECT b.verify_probe FROM bak_20261105_d1obs_dispositions_contracts b WHERE b.class = remediation_contracts.class), module = (SELECT b.module FROM bak_20261105_d1obs_dispositions_contracts b WHERE b.class = remediation_contracts.class) WHERE class = 'issue-1000993' AND EXISTS (SELECT 1 FROM bak_20261105_d1obs_dispositions_contracts b WHERE b.class = remediation_contracts.class); UPDATE agent_issues SET status = 'open' WHERE id IN (SELECT issue_id FROM issue_fold_ledger WHERE rule = 'd1-overload-superseded' AND evidence LIKE '%breach-doctor/run%'); UPDATE agent_issues SET status = 'closed' WHERE title LIKE 'ROUTER-LEGS-1:%' AND source = 'session:D1-observability'
-- CAUSE-MAPPED: no metric is registered here.

CREATE TABLE IF NOT EXISTS bak_20261105_d1obs_dispositions_contracts AS SELECT class, verify_probe, module, status, last_verdict FROM remediation_contracts WHERE class IN ('issue-1000993', 'issue-1001546');

-- 1. the 502 group: 502 responses of qnfo-ai in the last 6 hours
UPDATE remediation_contracts SET verify_probe = 'SELECT ''0'' AS expected, CASE WHEN NOT EXISTS (SELECT 1 FROM worker_logs WHERE script_name = ''qnfo-ai'' AND ts_ms > (CAST(strftime(''%s'', ''now'') AS INTEGER) - 3600) * 1000) THEN ''pending: no qnfo-ai telemetry ingested in the last hour'' ELSE CAST((SELECT COUNT(*) FROM worker_logs WHERE script_name = ''qnfo-ai'' AND status = 502 AND ts_ms > (CAST(strftime(''%s'', ''now'') AS INTEGER) - 21600) * 1000) AS TEXT) END AS observed',
  verify_transport = 'd1-query', status = 'active', module = 'qnfo-ai-5xx', next_due_at = datetime('now'), attempts = 0
WHERE class = 'issue-1000993' AND COALESCE(module, '') <> 'qnfo-ai-5xx';

-- 2. the fleet-control 5xx group is one symptom of the shared saturation: supersede it by the umbrella
INSERT INTO issue_fold_ledger (issue_id, rule, successor_id, evidence, agent_status, agent_updated_at, agent_close_channel, triage_state, triage_close_evidence, triage_reopened_count, triage_triaged_at, contract_class, contract_status, contract_last_verdict, contract_last_attempt_at) SELECT m.id, 'd1-overload-superseded', u.id, 'superseded by ' || u.id || ': qnfo-fleet-control 5xx responses (POST /breach-doctor/run 503 and 500, GET /loops 500) land in the same second as qnfo-deploy-guard lock_db_unavailable responses at the top of the fleet-tick minutes (worker_logs 2026-11-04, fleet-control against deploy-guard: 06:00:56 and 06:00:54, 10:00:58 and 10:00:59, 12:25:06 and 12:25:07, 16:00:57 and 16:00:57, 18:20:58 and 18:20:58, 22:21:00 and 22:21:01): one shared-database saturation, tracked once (D1-OVERLOAD-FOLD-1)', m.status, m.updated_at, m.close_channel, t.triage_state, t.close_evidence, t.reopened_count, t.triaged_at, c.class, c.status, c.last_verdict, c.last_attempt_at FROM agent_issues u JOIN agent_issues m ON m.id <> u.id JOIN issue_triage t ON t.issue_id = m.id LEFT JOIN remediation_contracts c ON c.class = 'issue-' || m.id WHERE u.id = (SELECT MAX(x.id) FROM agent_issues x WHERE x.status = 'open' AND x.title = 'CF-OBS-ISSUE-1: fleet: D1 DB is overloaded, all workers [cf-obs:d1-overload]') AND m.id = 1001546 AND m.status = 'open' AND NOT EXISTS (SELECT 1 FROM issue_fold_ledger f WHERE f.issue_id = m.id AND f.applied = 0);
UPDATE remediation_contracts SET status = 'superseded', last_verdict = 'superseded:closure-superseded (ISSUE-HYGIENE-1)', last_attempt_at = datetime('now') WHERE class IN (SELECT f.contract_class FROM issue_fold_ledger f WHERE f.applied = 0 AND f.contract_class IS NOT NULL AND f.issue_id = 1001546) AND status IN ('monitoring', 'escalated', 'active', 'holding', 'needs-machine-probe', 'probe-review-refused');
UPDATE agent_issues SET close_channel = 'session:D1-observability' WHERE status = 'open' AND id IN (SELECT issue_id FROM issue_fold_ledger WHERE applied = 0 AND issue_id = 1001546);
UPDATE issue_triage SET triage_state = 'closed', triaged_at = datetime('now'), close_evidence = (SELECT f.evidence FROM issue_fold_ledger f WHERE f.issue_id = issue_triage.issue_id AND f.applied = 0 ORDER BY f.id DESC LIMIT 1) WHERE issue_id IN (SELECT f.issue_id FROM issue_fold_ledger f JOIN agent_issues a ON a.id = f.issue_id WHERE f.applied = 0 AND f.issue_id = 1001546 AND a.status = 'open');
UPDATE agent_issues SET status = 'closed', updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000 WHERE status = 'open' AND id = 1001546 AND id IN (SELECT f.issue_id FROM issue_fold_ledger f JOIN issue_triage t ON t.issue_id = f.issue_id WHERE f.applied = 0 AND t.triage_state = 'closed' AND t.close_evidence = f.evidence);
UPDATE issue_fold_ledger SET applied = 1, applied_at = datetime('now') WHERE applied = 0 AND issue_id = 1001546 AND (SELECT a.status FROM agent_issues a WHERE a.id = issue_fold_ledger.issue_id) <> 'open';

-- 3. the doer for the attribution slice
INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROUTER-LEGS-1: the model-route probe of qnfo-ai-calibration keeps only http=504, so an all-routes router_timeout at the top of the hour cannot be attributed (GitHub 6158, 6174)',
 'QNFO.OPS; charter pillar autonomy. Measured 2026-11-05 (qnfo-audit): qnfo-ai answered 504 router_timeout 389 times in 24 h on POST /v1/chat/completions, nearly all inside the hourly model-route sweep of qnfo-ai-calibration: ai_calibration_results probe model-route status fail detail http=504 for all ten routes at 00:00, 10:00, 16:00, 20:00 and 22:00Z and for none or one route in the other hours; ai_model_health shows 23 of 24 models ok, so the models answer when asked directly (probe model-budget). The router returns the failing legs in its 504 body (error.type router_timeout, error.budget_ms, error.legs: model, role, ms, ok, err) but probeCompletion stores only http=504 echo=false, so a router-wide stall (D1 or gateway latency in the minutes the fleet tick saturates qnfo-audit) cannot be told from ten model failures, and the Cloudflare groups for qnfo-ai HTTP 504 (3112 occurrences) and HTTP 502 cannot be assigned to a cause. Fix: in probeCompletion append the router error type, budget_ms and each leg (model:err-or-ok:ms) to the detail, after the unchanged prefix http=<status> echo=<bool> (the checks /^http=5\d\d\b/ still match) and inside the 300 characters ai_calibration_results keeps; add a case to qnfo-ai-calibration/reasoning-ping.test.mjs whose stub router answers 504 with legs. Then read the next all-routes sweep: legs err capacity or timeout means upstream, empty means the reply-shape gate, and file the cause as its own issue with a doer. Prediction: the next all-routes sweep names its cause in ai_calibration_results.detail. Guards: no probe is removed or loosened; the status of every probe row is unchanged.' || char(10) ||
 'code-task: repo=qnfo-workers path=qnfo-ai-calibration/worker.js' || char(10) ||
 'code-anchor: var detail = pass ? "ok" : downgraded ? "downgraded to glm-5.3-flash" : "http=" + r.status' || char(10) ||
 'code-probe: {"paths":["qnfo-ai-calibration/worker.js"],"contains":"ROUTER-LEGS-1"}',
 'session:D1-observability', 'reliability', 'high', 'open', unixepoch() * 1000, unixepoch() * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'ROUTER-LEGS-1:%' AND status = 'open');

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:D1-observability',
  'a 5xx group whose occurrences land in the same second as the lock-route refusals of the saturated database is a symptom of that saturation, and a 5xx group with an unattributed cause needs the attribution before a fix',
  'D1-OBSERVABILITY-DISPOSITIONS-1: agent_issues 1001546 superseded by the umbrella with the correlation as evidence; 1000993 gets a worker_logs 502 probe; doer ROUTER-LEGS-1 filed for the qnfo-ai-calibration attribution slice',
  'worker_logs 2026-11-04: six fleet-control 5xx within two seconds of deploy-guard lock_db_unavailable responses; ai_calibration_results: ten of ten model-route probes http=504 at 00:00, 10:00, 16:00, 20:00, 22:00Z; ai_model_health 23 of 24 ok',
  'migration merged; doer open',
  'two contract rows, one supersede with ledger before-state, one agent_issues row',
  'Rollback line of migrations/2026-11-05-d1-observability-dispositions.sql',
  'the next router-wide 504 is attributable from ai_calibration_results',
  'ROUTER-LEGS-1 merged within a day; qnfo-ai 502 probe reads a count instead of the group state',
  'none',
  'live LIMITed D1 reads'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'D1-OBSERVABILITY-DISPOSITIONS-1:%');
