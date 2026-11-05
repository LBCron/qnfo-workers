-- WORKER-COUNT-1.2 REGISTRY HALF (2026-11-05, charter pillar core; worker_count 39 against the hard cap of 30, trigger 344, agent_issues 99923; owner standing grant OWNER-STANDING-GRANT-1).
-- Follow-up to PR 7447, which folded qnfo-evolve into qnfo-ai-calibration 1.7.0 as the member qnfoEvolveFoldMod. Measured after the merge (2026-11-05):
--   01:00Z  qnfo-ai-calibration 1.7.0 live; GET /evolve/health answers as qnfo-evolve 0.2.12-folded; evolve_runs row 4162 at 01:00:30Z is the first run on a host tick (the old script wrote at :05, :20, :35, :50).
--   01:02Z  cf-ops-actions unbind-service qnfo-ops:CH_QNFO_EVOLVE: run 41945453593 answered Cloudflare HTTP 500 error 10002 (transient), run 41945753543 succeeded.
--   01:05Z  canonical-deploy workers=qnfo-ops (run 41946060244): CH_QNFO_EVOLVE now binds qnfo-ai-calibration with props.member = qnfo-evolve; qnfo-ops /fleet reads qnfo-evolve healthy 200 version 0.2.12-folded through binding:CH_QNFO_EVOLVE.
--   01:09Z  cf-ops-actions delete-worker qnfo-evolve (run 41946373191): marker FOLDED, http 200, settings 404 afterwards; the Cloudflare script list reads 38 scripts and no qnfo-evolve.
-- This file is applied only after the script is gone, so service_registry never says live for a script that does not exist (the census would read it as only-in-registry and worker_count_disagreement would go to 2):
--   * service_registry: qnfo-evolve becomes a retired member served by the host, the pattern of fleet-exec (migrations/2026-10-19-script-without-source.sql), calendar-api and qnfo-backlog-exec;
--   * remediation_contracts: rt-live-qnfo-evolve and the two holding contracts issue-1001819 and issue-1001828 (relapse probes of the DEPLOY-PROBE-REVERTED drill, runner-https GET of the deleted host) are superseded with the reason, never hidden:
--     three straight failures of the first would file RUNTIME-PROBE-FAIL-1 about a script that was removed on purpose, and the other two would reopen two closed drill issues; a new standing liveness contract reads the member route on the host;
--   * transformation_levers 3/16 follows the code (path = the host file) and agent_issues 1001902 (WORKER-COUNT-1.2) gets the dated progress note, including that the host is qnfo-ai-calibration, not qnfo-cloud-ops as filed
--     (qnfo-cloud-ops/worker.js was claimed by another session until 02:00Z).
-- Backups: bak_20261105_fold_evolve_registry, bak_20261105_fold_evolve_contracts, bak_20261105_fold_evolve_rows hold the rows before the change; the Rollback line restores them.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE service_registry SET kind = (SELECT b.kind FROM bak_20261105_fold_evolve_registry b WHERE b.service = service_registry.service), state = (SELECT b.state FROM bak_20261105_fold_evolve_registry b WHERE b.service = service_registry.service), version = (SELECT b.version FROM bak_20261105_fold_evolve_registry b WHERE b.service = service_registry.service), base_url = (SELECT b.base_url FROM bak_20261105_fold_evolve_registry b WHERE b.service = service_registry.service), purpose = (SELECT b.purpose FROM bak_20261105_fold_evolve_registry b WHERE b.service = service_registry.service), updated_at = (SELECT b.updated_at FROM bak_20261105_fold_evolve_registry b WHERE b.service = service_registry.service) WHERE service IN (SELECT service FROM bak_20261105_fold_evolve_registry); UPDATE remediation_contracts SET status = (SELECT b.status FROM bak_20261105_fold_evolve_contracts b WHERE b.class = remediation_contracts.class), last_verdict = (SELECT b.last_verdict FROM bak_20261105_fold_evolve_contracts b WHERE b.class = remediation_contracts.class), next_due_at = (SELECT b.next_due_at FROM bak_20261105_fold_evolve_contracts b WHERE b.class = remediation_contracts.class) WHERE class IN (SELECT class FROM bak_20261105_fold_evolve_contracts); DELETE FROM remediation_contracts WHERE class = 'rt-live-qnfo-evolve-member'; UPDATE transformation_levers SET path = (SELECT b.path FROM bak_20261105_fold_evolve_rows b WHERE b.kind = 'lever'), updated_at = (SELECT b.stamp FROM bak_20261105_fold_evolve_rows b WHERE b.kind = 'lever') WHERE tp = 3 AND n = 16; UPDATE agent_issues SET description = (SELECT b.text FROM bak_20261105_fold_evolve_rows b WHERE b.kind = 'issue') WHERE id = (SELECT b.ref FROM bak_20261105_fold_evolve_rows b WHERE b.kind = 'issue');
-- Rollback note: decision_log is append-only and keeps its row; the script itself returns by removing qnfo-evolve/FOLDED, re-adding the deploy-targets.txt line and the qnfo-ops binding to qnfo-evolve, and redeploying the directory.
-- CAUSE-MAPPED: registers no metric.
-- spof-review: removes a script and a probe host; adds one standing liveness contract on the existing runner; no cron, D1 trigger, route or credential.

CREATE TABLE IF NOT EXISTS bak_20261105_fold_evolve_registry AS SELECT service, kind, state, version, base_url, purpose, updated_at FROM service_registry WHERE service = 'qnfo-evolve';
CREATE TABLE IF NOT EXISTS bak_20261105_fold_evolve_contracts AS SELECT class, status, last_verdict, next_due_at FROM remediation_contracts WHERE class IN ('rt-live-qnfo-evolve', 'issue-1001819', 'issue-1001828');
CREATE TABLE IF NOT EXISTS bak_20261105_fold_evolve_rows AS
  SELECT 'lever' AS kind, 0 AS ref, path AS path, updated_at AS stamp, NULL AS text FROM transformation_levers WHERE tp = 3 AND n = 16
  UNION ALL
  SELECT 'issue', id, NULL, NULL, description FROM agent_issues WHERE id = 1001902;

UPDATE service_registry SET kind = 'member', state = 'retired', version = '0.2.12-folded',
  base_url = 'https://qnfo-ai-calibration.q08.workers.dev/evolve',
  purpose = 'EVOLVE-1 gap registers to named work for the code loop; a member of qnfo-ai-calibration since WORKER-COUNT-1.2 (2026-11-05, PR 7447, host 1.7.0); the standalone script was deleted 2026-11-05',
  updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
 WHERE service = 'qnfo-evolve' AND kind = 'worker' AND state = 'live';

UPDATE remediation_contracts
   SET status = 'superseded', last_verdict = 'superseded:WORKER-COUNT-1.2 (qnfo-evolve was folded into qnfo-ai-calibration, PR 7447, and its script deleted 2026-11-05; the member route is read by rt-live-qnfo-evolve-member)', last_attempt_at = datetime('now')
 WHERE class IN ('rt-live-qnfo-evolve', 'issue-1001819', 'issue-1001828') AND status IN ('active', 'holding', 'escalated', 'monitoring');

INSERT OR IGNORE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module, budget_ms, max_items, next_due_at) VALUES
 ('rt-live-qnfo-evolve-member', NULL, 'standing liveness: the qnfo-evolve member answers /evolve/health on qnfo-ai-calibration', 'none while it passes; 3 straight failures file RUNTIME-PROBE-FAIL-1', '{"url": "https://qnfo-ai-calibration.q08.workers.dev/evolve/health", "status": 200, "contains": "qnfo-evolve", "max_ms": 10000}', 'runner-https', 3, 'qnfo-ops', 1, 'active', 'runtime-liveness-v1', 45000, 5, datetime('now'));

UPDATE transformation_levers SET path = 'qnfo-ai-calibration/worker.js', updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
 WHERE tp = 3 AND n = 16 AND path = 'qnfo-cloud-ops/worker.js';

UPDATE agent_issues SET description = COALESCE(description, '') || char(10) ||
  'WORKER-COUNT-1.2 2026-11-05: HOST CHANGED to qnfo-ai-calibration (qnfo-cloud-ops/worker.js was claimed by another session until 02:00Z; qnfo-ai-calibration had the same D1 and was free). PR 7447 merged and deployed (qnfo-ai-calibration 1.7.0, GET /evolve/health answers as qnfo-evolve 0.2.12-folded, evolve_runs row 4162 at 01:00:30Z is the first run on a host tick). The qnfo-ops binding CH_QNFO_EVOLVE was unbound (cf-ops-actions run 41945753543, an earlier run 41945453593 got a transient Cloudflare 500) and redeclared by canonical-deploy run 41946060244; the script qnfo-evolve was deleted by cf-ops-actions run 41946373191 (settings 404, script list 38). This migration is the registry half: the row becomes a retired member, rt-live-qnfo-evolve and the two relapse contracts of the DEPLOY-PROBE-REVERTED drill issues are superseded, rt-live-qnfo-evolve-member reads the member route. Still to do: read worker_count 38 at the 02:07Z census and close this issue with that reading in issue_triage.close_evidence.'
 WHERE id = 1001902 AND instr(COALESCE(description, ''), 'WORKER-COUNT-1.2 2026-11-05') = 0;

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:breach-cost-retire (claude)',
  'a script whose only inbound edge was a probe binding and whose duties run unchanged on another worker is a fold the standing grant allows; the registry row follows the delete and never leads it; a fold is verified by the member answering on the host before the old script goes',
  'WORKER-COUNT-1.2: qnfo-evolve folded into qnfo-ai-calibration 1.7.0 (PR 7447), qnfo-ops binding repointed, script deleted, registry row retired as a member, three contracts superseded, one standing liveness contract added',
  'fleet graph impact worker:qnfo-evolve depth 1: one binding (qnfo-ops CH_QNFO_EVOLVE), no HTTP caller; live settings: one D1 binding, no secret; scripts/fold_worker.py --dry-run and the generated suite (11 checks); after the merge: host /health 1.7.0, /evolve/health answers as qnfo-evolve, evolve_runs row 4162 on a host tick, qnfo-ops /fleet healthy through the binding, delete-worker run 41946373191 ok with settings 404, Cloudflare script list 38',
  'applied by migration after the delete', 'one script, one probe binding repointed, three contracts, one registry row; the evolve tables and the host calibration are untouched',
  'the Rollback line restores the registry row, the contracts and the lever path; the script returns by removing qnfo-evolve/FOLDED, re-adding the deploy-targets.txt line and the qnfo-ops binding and redeploying (the source stays in the directory)',
  'one script fewer on the account', 'worker_count <= 38 within 3 h', 'none',
  'github:PR 7447 and cf-ops-actions runs 41945753543, 41946373191, canonical-deploy 41946060244; cf:workers scripts and settings; d1:evolve_runs, service_registry, remediation_contracts; qnfo-ops /fleet'
WHERE NOT EXISTS (SELECT 1 FROM decision_log d WHERE d.action LIKE 'WORKER-COUNT-1.2:%');
