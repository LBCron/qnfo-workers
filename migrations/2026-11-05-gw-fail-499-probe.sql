-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: remediation_contracts
-- Rollback: UPDATE remediation_contracts SET verify_probe = 'WITH f AS (SELECT COALESCE(SUM(count),0) AS c499, MAX(ts) AS last_ts FROM ai_gateway_failures WHERE status = 499 AND model = ''dynamic/value'' AND source = ''qnfo-ai-calibration'' AND ts >= unixepoch(''now'')*1000 - 86400000) SELECT ''no 499 on dynamic/value'' AS expected, CASE WHEN c499 = 0 THEN ''no 499 on dynamic/value'' ELSE ''499 x'' || c499 || '' on dynamic/value'' END AS observed FROM f' WHERE class = 'issue-1001463';
-- GW-FAIL-STATUS-SCOPE-1 (2026-11-05, charter pillar autonomy; GitHub issue 6808 / agent_issues 1001463 "[gw-fail] 499 dynamic/value").
-- Two defects kept this issue open after its cause was gone.
-- 1. qnfo-ai-calibration 1.6.10 (GW-CLIENT-CLOSED-1) already classes a 499 as client-closed (the caller closed the request, duration 0, no provider reached): no [gw-fail] issue, no
--    degraded health row. Read from qnfo-audit on 2026-11-05: every 499 row on dynamic/value since 2026-11-04T17:40Z is client-closed, the last class "other" 499 is 2026-11-04T10:00:31Z.
--    The sweep's reconcile of open "[gw-fail] <status> <model>" titles counted every non-transient class of the MODEL, not the status in the title, and the model also logs 400 and 504
--    rows from the calibration probes themselves, so the 499 title never closed (fixed in 1.6.13, qnfo-ai-calibration/worker.js, suite reasoning-ping.test.mjs).
-- 2. The contract probe of issue-1001463 counted ANY 499 row of 24 hours, client-closed ones included. 499 client-closed rows keep arriving (a closed chat tab, a cancelled hedge leg), so
--    the probe could not pass whatever the system did. It now measures the defect: no 499 on dynamic/value counted as a failure in 24 hours (class other, upstream ...) and the ledger
--    row gwfail:3892c147 resolved. Both clear on their own once the last class-other 499 (2026-11-04T10:00:31Z) is 24 hours old, and the 1.6.13 sweep resolves the ledger row.
-- The probe returns the literal ok from a CASE (the consumer passes only when expected equals observed as text). Nothing is deleted: BACKUP names remediation_contracts, which holds the old probe.
UPDATE remediation_contracts
   SET verify_probe = 'SELECT ''ok'' AS expected, CASE WHEN EXISTS (SELECT 1 FROM ai_gateway_failures WHERE model = ''dynamic/value'' AND status = 499 AND error_class NOT IN (''client-closed'', ''rate-capacity'', ''unfunded'', ''spend-limited'') AND ts >= (CAST(strftime(''%s'', ''now'') AS INTEGER) - 86400) * 1000) THEN ''a 499 on dynamic/value is still counted as a failure'' WHEN EXISTS (SELECT 1 FROM issue_ledger WHERE fingerprint = ''gwfail:3892c147'' AND status = ''open'') THEN ''the [gw-fail] 499 dynamic/value ledger row is still open'' ELSE ''ok'' END AS observed',
       verify_transport = 'd1-query',
       attempts = 0,
       last_verdict = NULL,
       next_due_at = datetime('now')
 WHERE class = 'issue-1001463' AND status = 'active';
