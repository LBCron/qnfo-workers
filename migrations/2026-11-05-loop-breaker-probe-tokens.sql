-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: remediation_contracts
-- Rollback: UPDATE remediation_contracts SET verify_probe = 'SELECT ''no HUMAN-ITEMS-AUTOMATIC-1 recurrence on qnfo-fleet-control/worker.js in 6h'' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM code_tasks WHERE path = ''qnfo-fleet-control/worker.js'' AND substr(COALESCE(last_error,''''),1,24) = ''HUMAN-ITEMS-AUTOMATIC-1:'' AND updated_at > strftime(''%Y-%m-%dT%H:%M:%SZ'',''now'',''-6 hours'')' WHERE class = 'issue-1001396'; UPDATE remediation_contracts SET verify_probe = 'SELECT ''0 recurrences in the last 6h'' AS expected, CAST(COUNT(*) AS TEXT) || '' in the last 6h (last at '' || COALESCE(MAX(updated_at),''-'') || '')'' AS observed FROM code_tasks WHERE path = ''qnfo-fleet-dashboard/worker.js'' AND status IN (''failed'',''publish_failed'',''reverted'',''needs_human'') AND COALESCE(last_error,merge_note,'''') LIKE ''NO-PROGRESS-CEILING-1%'' AND updated_at > strftime(''%Y-%m-%dT%H:%M:%SZ'',''now'',''-6 hours'')' WHERE class = 'issue-1001444';
-- LOOP-BREAKER-PROBE-TOKEN-1 (2026-11-05, charter pillar autonomy; GitHub issues 6575 / agent_issues 1001396 and 6697 / agent_issues 1001444, both LOOP-BREAKER-1).
-- The consumer passes a d1-query contract only when `expected` equals `observed` as text (scripts/remediation_consumer.py classify). The two loop-breaker issues carry probes written
-- as a sentence for expected and a count for observed, so they cannot pass whatever the loop does:
--   issue-1001396  expected 'no HUMAN-ITEMS-AUTOMATIC-1 recurrence on qnfo-fleet-control/worker.js in 6h'   observed '0'                                   (59 verifications, all fail)
--   issue-1001444  expected '0 recurrences in the last 6h'                                                   observed '0 in the last 6h (last at -)'        (43 verifications, all fail)
-- Read from qnfo-audit on 2026-11-05: both measurements read zero (no task on the file with that signature updated in 6 hours; the last on qnfo-fleet-control/worker.js was
-- 2026-11-04T05:37Z, the last NO-PROGRESS-CEILING-1 on qnfo-fleet-dashboard/worker.js 2026-11-04T10:27Z), so the issues were already closable by their own definition ("closes when
-- the signature has not recurred for 6 hours") but the verdict could not say so.
-- The cause of 1001396 is already fixed on main: its example error, "companion qnfo-fleet-control/breach-doctor.test.mjs is over 48000 chars and needs its own code-anchor line",
-- was the pre-6576 companion rule; PR 6576 (merged 2026-11-03T09:23Z, "Auto-locate anchors for oversized companion files") locates the anchor itself, and the cap for a companion is
-- EXTRA_MAX_CHARS 200000 (breach-doctor.test.mjs is 155,528 chars). The later recurrences on that file were noop-proposal answers of the code model, a different signature.
-- The two probes keep the measurement and the 6-hour window exactly; only the token changes: expected 'ok', observed 'ok' when the count is zero and the count with the last time
-- otherwise. A second run finds nothing to change (the new text holds CASE). The contracts are reset so the consumer re-probes at its next run.
UPDATE remediation_contracts
   SET verify_probe = 'SELECT ''ok'' AS expected, CASE WHEN COUNT(*) = 0 THEN ''ok'' ELSE COUNT(*) || '' HUMAN-ITEMS-AUTOMATIC-1 task(s) on qnfo-fleet-control/worker.js in the last 6h (last at '' || MAX(updated_at) || '')'' END AS observed FROM code_tasks WHERE path = ''qnfo-fleet-control/worker.js'' AND substr(COALESCE(last_error,''''),1,24) = ''HUMAN-ITEMS-AUTOMATIC-1:'' AND updated_at > strftime(''%Y-%m-%dT%H:%M:%SZ'',''now'',''-6 hours'')',
       attempts = 0,
       last_verdict = NULL,
       next_due_at = datetime('now')
 WHERE class = 'issue-1001396' AND status = 'active' AND instr(verify_probe, 'CASE') = 0;

UPDATE remediation_contracts
   SET verify_probe = 'SELECT ''ok'' AS expected, CASE WHEN COUNT(*) = 0 THEN ''ok'' ELSE COUNT(*) || '' NO-PROGRESS-CEILING-1 task(s) on qnfo-fleet-dashboard/worker.js in the last 6h (last at '' || MAX(updated_at) || '')'' END AS observed FROM code_tasks WHERE path = ''qnfo-fleet-dashboard/worker.js'' AND status IN (''failed'',''publish_failed'',''reverted'',''needs_human'') AND COALESCE(last_error,merge_note,'''') LIKE ''NO-PROGRESS-CEILING-1%'' AND updated_at > strftime(''%Y-%m-%dT%H:%M:%SZ'',''now'',''-6 hours'')',
       attempts = 0,
       last_verdict = NULL,
       next_due_at = datetime('now')
 WHERE class = 'issue-1001444' AND status = 'active' AND instr(verify_probe, 'CASE') = 0;
