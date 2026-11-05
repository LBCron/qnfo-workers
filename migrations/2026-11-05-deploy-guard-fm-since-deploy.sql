-- D1-LOCK-OVERLOAD-1 follow-up (2026-11-05, charter pillar autonomy): the detector fm-deploy-guard-lock-5xx counts 5xx on the lock routes over 24 hours, so it reads red for a day after the fix
-- ships because the 5xx the fix removed are still inside the window (read 2026-11-05 01:50Z: fail, last 5xx 00:20:58Z, qnfo-deploy-guard 1.4.7 live from 00:42:36Z). A detector that stays
-- red for a window after its fix is noise, not a finding: it counts from the later of 24 hours ago and the deploy (2026-11-05T00:45:00Z = 1793839500000 ms). The two issue contracts
-- (issue-1001280, issue-1001391) keep their 6-hour window: they are the closing probes and 6 quiet hours after the deploy is exactly what they should say.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE remediation_contracts SET verify_probe = REPLACE(verify_probe, 'MAX((CAST(strftime(''%s'', ''now'') AS INTEGER) - 86400) * 1000, 1793839500000)', '(CAST(strftime(''%s'', ''now'') AS INTEGER) - 86400) * 1000') WHERE class = 'fm-deploy-guard-lock-5xx'
-- CAUSE-MAPPED: no metric is registered here.

UPDATE remediation_contracts
SET verify_probe = REPLACE(verify_probe, '(CAST(strftime(''%s'', ''now'') AS INTEGER) - 86400) * 1000', 'MAX((CAST(strftime(''%s'', ''now'') AS INTEGER) - 86400) * 1000, 1793839500000)')
WHERE class = 'fm-deploy-guard-lock-5xx'
  AND instr(verify_probe, '1793839500000') = 0
  AND instr(verify_probe, '(CAST(strftime(''%s'', ''now'') AS INTEGER) - 86400) * 1000') > 0;
