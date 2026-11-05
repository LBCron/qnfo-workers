-- WORKER-COUNT-1.3 REGISTRY HALF (2026-11-05, charter pillar core; worker_count against the hard cap of 30, trigger 344, agent_issues 99923; owner standing grant OWNER-STANDING-GRANT-1; agent W2-E).
-- Follow-up to PR 7523, which folded qnfo-model-eval into qnfo-ai-calibration 1.8.0 as the member qnfoModelEvalFoldMod, and to PR 7624 (FOLD-RETURN-ORDER-1, host 1.8.1), which repaired the member (it threw "Cannot read properties of undefined (reading 'tick')" on every host tick from
-- the 03:00:30Z tick until the fix, so the old script was kept running). Measured after the fix (2026-11-05):
--   04:00:31Z  the member logs its first host tick: cron_fire_log cron_name 'qnfo-model-eval|20 * * * *' outcome ok 'tick 1522 ms' (the old script fired at :20, the host at :00 and :30); host /health 1.8.1, GET /model-eval/health answers as qnfo-model-eval 1.8.4-folded.
--   04:14Z     cf-ops-actions unbind-service qnfo-ops:CH_QNFO_MODEL_EVAL (run 41966513551): PATCH http 200 and the version it created at 04:14:21Z holds 69 bindings without CH_QNFO_MODEL_EVAL, but the action's own after-read still showed 70 (read-after-write lag), so the run reported ok=false (watchdog issue 7694).
--   04:16Z     canonical-deploy workers=qnfo-ops (run 41966765971) did not install the declared binding: its deployment_history row 3339 reads "observability=none declared", i.e. installDeclaredBindings could not fetch wrangler.toml that time.
--   04:19:58Z  canonical-deploy workers=qnfo-ops again (run 41967113086, deployment_history 3340, observability=applied): CH_QNFO_MODEL_EVAL now binds qnfo-ai-calibration (version 70 bindings); qnfo-ops /fleet reads qnfo-model-eval healthy 200 version 1.8.4-folded through binding:CH_QNFO_MODEL_EVAL.
--   04:22Z     cf-ops-actions delete-worker qnfo-model-eval (run 41967251811): marker FOLDED, http 200, settings 404; the Cloudflare script list reads 37 scripts, no qnfo-model-eval, no qnfo-evolve.
-- This file is applied only after the script is gone, so service_registry never says live for a script that does not exist (the 05:07Z census would read it as only-in-registry and worker_count_disagreement would go to 2):
--   * service_registry: qnfo-model-eval becomes a retired member served by the host (pattern of qnfo-evolve, fleet-exec, calendar-api);
--   * remediation_contracts: rt-live-qnfo-model-eval (runner-https GET of the deleted host) is superseded with the reason, never hidden (three straight failures would file RUNTIME-PROBE-FAIL-1 about a script removed on purpose); a new standing liveness contract reads the member route on the host;
--   * the closing contracts issue-1001902 and issue-1001903 were superseded at birth by CLOSE-PROBE-CIRCULAR-1 (they observed the issue status they guard); each gets a probe that measures the defect: the registry row is a retired member and metric worker_count has fallen (<= 38 for 1.2, <= 37 for 1.3). The remediation tick closes the issue on a pass;
--   * transformation_levers 3/17 (fold qnfo-model-eval) is landed; agent_issues 1001902 and 1001903 get the dated evidence note.
-- Backups: bak_20261105_fold_model_eval_registry, bak_20261105_fold_model_eval_contracts, bak_20261105_fold_model_eval_rows hold the rows before the change; the Rollback line restores them.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE service_registry SET kind = (SELECT b.kind FROM bak_20261105_fold_model_eval_registry b WHERE b.service = service_registry.service), state = (SELECT b.state FROM bak_20261105_fold_model_eval_registry b WHERE b.service = service_registry.service), version = (SELECT b.version FROM bak_20261105_fold_model_eval_registry b WHERE b.service = service_registry.service), base_url = (SELECT b.base_url FROM bak_20261105_fold_model_eval_registry b WHERE b.service = service_registry.service), purpose = (SELECT b.purpose FROM bak_20261105_fold_model_eval_registry b WHERE b.service = service_registry.service), updated_at = (SELECT b.updated_at FROM bak_20261105_fold_model_eval_registry b WHERE b.service = service_registry.service) WHERE service IN (SELECT service FROM bak_20261105_fold_model_eval_registry); UPDATE remediation_contracts SET status = (SELECT b.status FROM bak_20261105_fold_model_eval_contracts b WHERE b.class = remediation_contracts.class), last_verdict = (SELECT b.last_verdict FROM bak_20261105_fold_model_eval_contracts b WHERE b.class = remediation_contracts.class), verify_probe = (SELECT b.verify_probe FROM bak_20261105_fold_model_eval_contracts b WHERE b.class = remediation_contracts.class), precondition = (SELECT b.precondition FROM bak_20261105_fold_model_eval_contracts b WHERE b.class = remediation_contracts.class), next_due_at = (SELECT b.next_due_at FROM bak_20261105_fold_model_eval_contracts b WHERE b.class = remediation_contracts.class) WHERE class IN (SELECT class FROM bak_20261105_fold_model_eval_contracts); DELETE FROM remediation_contracts WHERE class = 'rt-live-qnfo-model-eval-member'; UPDATE transformation_levers SET status = (SELECT b.status FROM bak_20261105_fold_model_eval_rows b WHERE b.kind = 'lever'), landed_at = (SELECT b.stamp FROM bak_20261105_fold_model_eval_rows b WHERE b.kind = 'lever'), note = (SELECT b.text FROM bak_20261105_fold_model_eval_rows b WHERE b.kind = 'lever') WHERE tp = 3 AND n = 17 AND EXISTS (SELECT 1 FROM bak_20261105_fold_model_eval_rows b WHERE b.kind = 'lever'); UPDATE agent_issues SET description = (SELECT b.text FROM bak_20261105_fold_model_eval_rows b WHERE b.kind = 'issue' AND b.ref = agent_issues.id) WHERE id IN (SELECT b.ref FROM bak_20261105_fold_model_eval_rows b WHERE b.kind = 'issue');
-- Rollback note: decision_log is append-only and keeps its row; the script itself returns by removing qnfo-model-eval/FOLDED, re-adding the deploy-targets.txt line and the qnfo-ops binding to qnfo-model-eval, and redeploying the directory (the source stays in the directory).
-- CAUSE-MAPPED: registers no metric.
-- spof-review: removes a script and a probe host; adds one standing liveness contract on the existing runner and two closing probes; no cron, D1 trigger, route or credential.

CREATE TABLE IF NOT EXISTS bak_20261105_fold_model_eval_registry AS SELECT service, kind, state, version, base_url, purpose, updated_at FROM service_registry WHERE service = 'qnfo-model-eval';
CREATE TABLE IF NOT EXISTS bak_20261105_fold_model_eval_contracts AS SELECT class, status, last_verdict, verify_probe, precondition, next_due_at FROM remediation_contracts WHERE class IN ('rt-live-qnfo-model-eval', 'issue-1001902', 'issue-1001903');
CREATE TABLE IF NOT EXISTS bak_20261105_fold_model_eval_rows AS
  SELECT 'lever' AS kind, 0 AS ref, status AS status, landed_at AS stamp, note AS text FROM transformation_levers WHERE tp = 3 AND n = 17
  UNION ALL
  SELECT 'issue', id, NULL, NULL, description FROM agent_issues WHERE id IN (1001902, 1001903);

UPDATE service_registry SET kind = 'member', state = 'retired', version = '1.8.4-folded',
  base_url = 'https://qnfo-ai-calibration.q08.workers.dev/model-eval',
  purpose = 'CF-MODEL-EVAL-1: discovers new Cloudflare Workers AI models and benchmarks them against the production control; a member of qnfo-ai-calibration since WORKER-COUNT-1.3 (2026-11-05, PR 7523, host 1.8.0, member repaired by PR 7624 in host 1.8.1); the standalone script was deleted 2026-11-05 (cf-ops-actions run 41967251811)',
  updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
 WHERE service = 'qnfo-model-eval' AND kind = 'worker' AND state = 'live';

UPDATE remediation_contracts
   SET status = 'superseded', last_verdict = 'superseded:WORKER-COUNT-1.3 (qnfo-model-eval was folded into qnfo-ai-calibration, PR 7523, and its script deleted 2026-11-05; the member route is read by rt-live-qnfo-model-eval-member)', last_attempt_at = datetime('now')
 WHERE class = 'rt-live-qnfo-model-eval' AND status IN ('active', 'holding', 'escalated', 'monitoring');

INSERT OR IGNORE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module, budget_ms, max_items, next_due_at) VALUES
 ('rt-live-qnfo-model-eval-member', NULL, 'standing liveness: the qnfo-model-eval member answers /model-eval/health on qnfo-ai-calibration', 'none while it passes; 3 straight failures file RUNTIME-PROBE-FAIL-1', '{"url": "https://qnfo-ai-calibration.q08.workers.dev/model-eval/health", "status": 200, "contains": "qnfo-model-eval", "max_ms": 10000}', 'runner-https', 3, 'qnfo-ops', 1, 'active', 'runtime-liveness-v1', 45000, 5, datetime('now'));

UPDATE remediation_contracts
   SET status = 'active', last_verdict = NULL, next_due_at = datetime('now'), verify_transport = 'd1-query',
       precondition = 'WORKER-COUNT-1.2 closing probe (W2-E 2026-11-05): replaces the circular birth template; measures that qnfo-evolve is a retired member in the registry and the live worker count fell',
       verify_probe = 'SELECT ''1'' AS expected, CASE WHEN (SELECT state FROM service_registry WHERE service = ''qnfo-evolve'') = ''retired'' AND (SELECT CAST(last_value AS INTEGER) FROM metric_registry WHERE metric = ''worker_count'') <= 38 THEN ''1'' ELSE ''0'' END AS observed'
 WHERE class = 'issue-1001902' AND status = 'superseded';

UPDATE remediation_contracts
   SET status = 'active', last_verdict = NULL, next_due_at = datetime('now'), verify_transport = 'd1-query',
       precondition = 'WORKER-COUNT-1.3 closing probe (W2-E 2026-11-05): replaces the circular birth template; measures that qnfo-model-eval is a retired member in the registry and the live worker count fell to 37 or lower',
       verify_probe = 'SELECT ''1'' AS expected, CASE WHEN (SELECT state FROM service_registry WHERE service = ''qnfo-model-eval'') = ''retired'' AND (SELECT CAST(last_value AS INTEGER) FROM metric_registry WHERE metric = ''worker_count'') <= 37 THEN ''1'' ELSE ''0'' END AS observed'
 WHERE class = 'issue-1001903' AND status = 'superseded';

UPDATE transformation_levers SET status = 'landed', landed_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
  note = COALESCE(note, '') || ' || W2E-FOLD-1.3 2026-11-05: qnfo-model-eval folded into qnfo-ai-calibration (PR 7523, repaired by PR 7624), member ticking on the host since 04:00:31Z, qnfo-ops CH_QNFO_MODEL_EVAL repointed, script deleted (run 41967251811), Cloudflare script list 37.'
 WHERE tp = 3 AND n = 17 AND status = 'dispatched';

UPDATE agent_issues SET description = COALESCE(description, '') || char(10) ||
  'WORKER-COUNT-1.3 2026-11-05 (W2-E): MERGED AND DEPLOYED. PR 7523 folded qnfo-model-eval into qnfo-ai-calibration 1.8.0; the member threw on every host tick until PR 7624 (host 1.8.1, FOLD-RETURN-ORDER-1), so the old script was kept; the first good host tick is cron_fire_log 04:00:31Z; the qnfo-ops binding CH_QNFO_MODEL_EVAL was unbound (run 41966513551, which reported ok=false on a stale after-read although the 04:14:21Z version holds 69 bindings) and re-declared to qnfo-ai-calibration by canonical-deploy run 41967113086 (the first attempt, run 41966765971, could not fetch wrangler.toml and installed nothing); qnfo-ops /fleet reads the member healthy through the binding; cf-ops-actions delete-worker run 41967251811 ok, Cloudflare script list 37. This migration is the registry half. The closing probe on contract issue-1001903 closes this issue when metric worker_count reads 37 or lower (next census 05:07Z).'
 WHERE id = 1001903 AND instr(COALESCE(description, ''), 'WORKER-COUNT-1.3 2026-11-05 (W2-E)') = 0;

UPDATE agent_issues SET description = COALESCE(description, '') || char(10) ||
  'WORKER-COUNT-1.2 2026-11-05 (W2-E, taking over the open tail): worker_count read 38 at the 03:07Z and 04:08Z census (cloud_ops_events worker-count-2026-11-05: 38 live scripts, 37 registry rows live, disagreement 1 only qnfo-workers), qnfo-evolve is absent from the Cloudflare script list (read 04:2xZ: 37 scripts), the member answers on the host. The closing probe on contract issue-1001902 (registry row retired and worker_count <= 38) closes this issue on a pass.'
 WHERE id = 1001902 AND instr(COALESCE(description, ''), 'WORKER-COUNT-1.2 2026-11-05 (W2-E') = 0;

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:W2-E (claude)',
  'a script whose only inbound edge was a probe binding and whose duties run unchanged on another worker is a fold the standing grant allows; the old script is deleted only after the member has run on a host tick, and the registry row follows the delete and never leads it',
  'WORKER-COUNT-1.3: qnfo-model-eval folded into qnfo-ai-calibration (PR 7523, repaired by PR 7624), qnfo-ops binding repointed, script deleted, registry row retired as a member, one contract superseded, one standing liveness contract and two closing probes added',
  'fleet graph impact worker:qnfo-model-eval: one binding (qnfo-ops CH_QNFO_MODEL_EVAL), no HTTP caller; the member threw (observability: "qnfo-model-eval member: Cannot read properties of undefined (reading tick)" at 03:00:30Z) until host 1.8.1; after: cron_fire_log 04:00:31Z ok, host /health 1.8.1, /model-eval/health 1.8.4-folded, qnfo-ops /fleet healthy through binding:CH_QNFO_MODEL_EVAL, delete-worker run 41967251811 ok with settings 404, Cloudflare script list 37',
  'applied by migration after the delete', 'one script, one probe binding repointed, one contract superseded, one registry row; the model-eval tables and the host calibration are untouched; worker_count_disagreement stays 1 (qnfo-workers, WORKER-COUNT-1.1)',
  'the Rollback line restores the registry row, the contracts and the lever; the script returns by removing qnfo-model-eval/FOLDED, re-adding the deploy-targets.txt line and the qnfo-ops binding and redeploying (the source stays in the directory)',
  'one script fewer on the account', 'worker_count <= 37 within 3 h', 'none',
  'github:PR 7523, PR 7624 and cf-ops-actions runs 41966513551, 41967251811, canonical-deploy 41967113086; cf:workers scripts and versions; d1:cron_fire_log, deployment_history, service_registry, remediation_contracts; qnfo-ops /fleet'
WHERE NOT EXISTS (SELECT 1 FROM decision_log d WHERE d.action LIKE 'WORKER-COUNT-1.3:%');
