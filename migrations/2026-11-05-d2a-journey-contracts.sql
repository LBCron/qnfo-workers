-- D2A-JOURNEY-CONTRACTS-1 (2026-11-05, charter pillar autonomy; GitHub 5743 / agent_issues 1000750 binding-census, 6623 / 1001363 ask-path, 6676 / 1001440 rt-page-fleet-queue).
-- Three contracts stood on a probe that cannot pass for the defect the issue names; each is replaced by one that measures it (probe returns the literal ok from a CASE, a
-- 'pending:' answer is a deferral and neither passes nor fails). The autoclose trigger then closes each issue on its own once the cause is gone.
--  issue-1000750 (FLEET-JOURNEY-FAILED-1 binding-census): the probe read `fleet_worker_census` (the worker OUTPUT census, a different table) for a row of qnfo-fleet-lee and expected
--    'present'; the row has never existed, so the contract read 'absent' on every run (97 attempts) whatever the journey did. The journey fails on qnfo-fleet-lee because its health
--    route is lee.qnfo.org/api/health and qnfo-ops /fleet probes <name>.q08.workers.dev/health (404): scripts/fleet_journeys.py HEALTH_URLS now attests it (same PR). New probe:
--    both runners' newest binding-census run passed within 3 h (the v4 journey template shape).
--  issue-1001363 (ask-path): the journey runs every 6 h (JRN_ASK_EVERY_H), and the template probe wants the newest run at most 180 minutes old, so the contract could read ok only in
--    the 3 hours after each run (and a tick that is cut short before it records, 18:00Z on 2026-11-04, leaves no run at all). A freshness limit on a loop slower than 120 minutes is
--    its cadence plus 120 minutes (SLA-120M-2): 480 minutes. The cause of the failures themselves (a paper page blocking on a model fill, 12 s timeouts) is PAPER-TTFB-1, gateway 3.53.1, PR 6996.
--  issue-1001440 (RUNTIME-PROBE-FAIL-1 rt-page-fleet-queue): the runner-https contract rt-page-fleet-queue passes (30+ passes in a row since 2026-11-04T16:59Z, V3-DASH-1 PR 6923). The second
--    contract, on class issue-1001440, reads worker_logs, which holds captured error events and not every request: with a healthy page the window holds no GET / row, and the old probe
--    answered 'no root-page GET logged in 24h', which is not ok, so it could never pass once the defect was gone. New probe: ok when the capture is alive (a row in the last 2 h)
--    and no GET / of qnfo-fleet-dashboard in the last 24 h was aborted, threw or ran 15 s or more; otherwise the count. The last bad row was 2026-11-04T14:33:09Z, so it can read ok from 14:34Z.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE remediation_contracts SET verify_probe = (SELECT b.verify_probe FROM bak_20261105_d2a_journey_contracts b WHERE b.class = remediation_contracts.class), module = (SELECT b.module FROM bak_20261105_d2a_journey_contracts b WHERE b.class = remediation_contracts.class), attempts = (SELECT b.attempts FROM bak_20261105_d2a_journey_contracts b WHERE b.class = remediation_contracts.class), last_verdict = (SELECT b.last_verdict FROM bak_20261105_d2a_journey_contracts b WHERE b.class = remediation_contracts.class) WHERE class IN (SELECT class FROM bak_20261105_d2a_journey_contracts)
-- CAUSE-MAPPED: registers no metric_registry row.

CREATE TABLE IF NOT EXISTS bak_20261105_d2a_journey_contracts AS
  SELECT class, issue_id, verify_probe, verify_transport, status, module, attempts, last_verdict, next_due_at
    FROM remediation_contracts
   WHERE class IN ('issue-1000750', 'issue-1001363', 'issue-1001440');

UPDATE remediation_contracts
   SET verify_probe = 'SELECT ''ok'' AS expected, CASE WHEN (SELECT COUNT(*) FROM v_journey_state WHERE journey = ''binding-census'') = 0 THEN ''pending: no journey_state row'' WHEN (SELECT MIN(ok) FROM v_journey_state WHERE journey = ''binding-census'' AND age_min <= 180) = 1 AND (SELECT COUNT(*) FROM v_journey_state WHERE journey = ''binding-census'' AND age_min > 180) = 0 THEN ''ok'' ELSE ''pending: '' || (SELECT group_concat(runner || '' ok='' || ok || '' age_min='' || CAST(age_min AS INT), '', '') FROM v_journey_state WHERE journey = ''binding-census'') END AS observed',
       verify_transport = 'd1-query', status = 'active', module = 'probe-template-v4-journey',
       attempts = 0, last_verdict = NULL, next_due_at = datetime('now')
 WHERE class = 'issue-1000750' AND issue_id = 1000750
   AND instr(verify_probe, 'fleet_worker_census') > 0;

UPDATE remediation_contracts
   SET verify_probe = 'SELECT ''ok'' AS expected, CASE WHEN (SELECT COUNT(*) FROM v_journey_state WHERE journey = ''ask-path'') = 0 THEN ''pending: no journey_state row'' WHEN (SELECT MIN(ok) FROM v_journey_state WHERE journey = ''ask-path'' AND age_min <= 480) = 1 AND (SELECT COUNT(*) FROM v_journey_state WHERE journey = ''ask-path'' AND age_min > 480) = 0 THEN ''ok'' ELSE ''pending: '' || (SELECT group_concat(runner || '' ok='' || ok || '' age_min='' || CAST(age_min AS INT), '', '') FROM v_journey_state WHERE journey = ''ask-path'') END AS observed',
       verify_transport = 'd1-query', status = 'active', module = 'probe-template-v4-journey',
       attempts = 0, last_verdict = NULL, next_due_at = datetime('now')
 WHERE class = 'issue-1001363' AND issue_id = 1001363
   AND instr(verify_probe, 'age_min <= 180') > 0;

UPDATE remediation_contracts
   SET verify_probe = 'SELECT ''ok'' AS expected, CASE WHEN NOT EXISTS (SELECT 1 FROM worker_logs WHERE ts_ms >= (strftime(''%s'', ''now'') - 7200) * 1000) THEN ''worker_logs has no row in the last 2 h (capture stalled)'' WHEN (SELECT COUNT(*) FROM worker_logs WHERE script_name = ''qnfo-fleet-dashboard'' AND method = ''GET'' AND url = ''https://fleet.qnfo.org/'' AND ts_ms >= (strftime(''%s'', ''now'') - 86400) * 1000 AND (COALESCE(outcome, '''') <> ''ok'' OR COALESCE(wall_ms, 0) >= 15000)) = 0 THEN ''ok'' ELSE ''slow: '' || (SELECT COUNT(*) FROM worker_logs WHERE script_name = ''qnfo-fleet-dashboard'' AND method = ''GET'' AND url = ''https://fleet.qnfo.org/'' AND ts_ms >= (strftime(''%s'', ''now'') - 86400) * 1000 AND (COALESCE(outcome, '''') <> ''ok'' OR COALESCE(wall_ms, 0) >= 15000)) || '' GET / requests in 24 h were aborted, threw or ran 15000 ms or more'' END AS observed',
       verify_transport = 'd1-query', status = 'active',
       attempts = 0, last_verdict = NULL, next_due_at = datetime('now')
 WHERE class = 'issue-1001440' AND issue_id = 1001440
   AND instr(verify_probe, 'no root-page GET logged in 24h') > 0;

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:D2-slo-journeys-probes',
  'a contract that cannot read pass for the defect it names is not a check, so the fix is to make it measure that defect, never to loosen a threshold or close the issue by hand',
  'D2A-JOURNEY-CONTRACTS-1: issue-1000750 (binding-census), issue-1001363 (ask-path) and issue-1001440 (rt-page-fleet-queue, worker_logs contract) get probes that return ok when the journey or the page is healthy',
  'qnfo-audit read 2026-11-04: issue-1000750 probe read fleet_worker_census (97 attempts, observed absent); ask-path runs every 6 h against an age limit of 180 min (newest run 670 min old after the 18:00Z tick recorded nothing); issue-1001440 probe answered no root-page GET logged in 24h once the page stopped erroring (worker_logs keeps captured errors only); rt-page-fleet-queue passes since 2026-11-04T16:59Z',
  'migration merged through the canonical path; no worker bundle changed',
  'three remediation_contracts rows',
  'the Rollback header restores the three probes, modules, attempts and verdicts from bak_20261105_d2a_journey_contracts; the decision row stays (append-only)',
  'each contract can read pass when its cause is gone and the autoclose trigger then closes the issue; none passes while the journey or the page is failing',
  'issue-1000750 closes within two hours of the first run where both runners pass binding-census (heartbeat for qnfo-fleet-lee, scripts/fleet_journeys.py); issue-1001363 closes after the 00:00Z ask run passes; issue-1001440 reads ok from 2026-11-05T14:34Z if no GET / is aborted or slow',
  'none',
  'offline suite migrations/d2a-journey-contracts.test.mjs (the three probes run on sqlite against passing, failing, stale and empty rows); the new ask-path and worker_logs probes run read-only against production on 2026-11-04 and read pending: cf ok=1 age_min=670 and slow: 22 GET / requests'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'D2A-JOURNEY-CONTRACTS-1:%');
