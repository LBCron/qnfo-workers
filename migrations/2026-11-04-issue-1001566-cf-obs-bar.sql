-- ISSUE-1001566 (2026-11-04, charter pillar autonomy; GitHub mirror 7095): "Issue #1001505 closed 2h35m after last occurrence, short of the 6h non-recurrence bar it defines".
-- Finding, confirmed from rows: agent_issues 1001505 (CF-OBS-ISSUE-1, qnfo-ai-search) states "closes by verification when the group has not recurred for 6 hours". It was closed 2026-11-04T01:55:10Z
-- by auto:verified-remediation-trigger, 2h35m after its last occurrence (23:20Z), because its birth probe (migrations/2026-11-01-family-probe-at-birth.sql) passed on Cloudflare's resolved status, which
-- Cloudflare sets 12 to 120 seconds after a burst ends. It was reopened at 04:58Z by issue_refile_reopen. The answer to the issue's question is the second branch it names: the trigger path applies the
-- contract's probe, and that probe was shorter than the stated bar.
-- Fixed by RELAPSE-HOLD-1 (PR 7031, migration_runs 1149, 2026-11-04T17:06:10Z): the birth triggers and the contracts of open CF-OBS issues now need six quiet hours (or no usable observation time).
-- This issue's own contract was superseded as probe-unusable (no probe), so nothing could close it. It gets the probe that measures the fix: no open CF-OBS issue carries a probe that passes on the
-- resolved status alone, and the birth trigger needs the six-hour reading. The probe reads 0 now and read 53 open contracts plus the old template before PR 7031, so it is falsifiable. The 26 closed
-- contracts whose group was seen within six hours keep the old probe until the owed retune (issue 1001754); they cannot close an open issue, so they are outside this probe.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE remediation_contracts SET status = 'superseded', last_verdict = 'superseded:rolled-back (ISSUE-1001566)' WHERE class = 'issue-1001566';
-- CAUSE-MAPPED: registers no metric_registry row.

UPDATE remediation_contracts
SET status = 'active', verify_transport = 'd1-query', module = 'cf-obs-six-hour-bar', attempts = 0, last_verdict = NULL, next_due_at = datetime('now'), expected_cadence_h = 1,
    precondition = 'ISSUE-1001566: the CF-OBS closing probe measures the 6 hour non-recurrence bar the issue text states',
    action = 'closes when no open CF-OBS issue carries a probe that passes on the resolved status alone and the birth trigger needs six quiet hours (RELAPSE-HOLD-1, PR 7031)',
    verify_probe = 'SELECT ''0'' AS expected, CAST((SELECT COUNT(*) FROM remediation_contracts c JOIN agent_issues a ON a.id = c.issue_id WHERE a.status = ''open'' AND c.module = ''issue-birth-probe-families'' AND instr(c.verify_probe, ''state = ''''resolved'''' OR (state <> ''''resolved'''' AND json_valid(payload) AND'') > 0) + COALESCE((SELECT CASE WHEN instr(sql, ''NOT (json_valid(payload)'') > 0 AND instr(sql, ''state = ''''resolved'''' OR '') = 0 THEN 0 ELSE 1 END FROM sqlite_master WHERE name = ''contract_probe_templates_family_birth''), 1) AS TEXT) AS observed'
WHERE class = 'issue-1001566' AND status = 'superseded' AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 1001566 AND status = 'open');

UPDATE agent_issues
SET description = description || char(10) || 'Answer (ISSUE-1001566 migration): the close came from the birth probe, which passed on Cloudflare''s resolved status 2h35m after the last occurrence; RELAPSE-HOLD-1 (PR 7031, applied 2026-11-04T17:06:10Z) replaced it with a six-quiet-hours reading on open CF-OBS contracts and on the birth trigger. The contract of this issue now measures that and closes it.',
    updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE id = 1001566 AND status = 'open' AND instr(description, 'ISSUE-1001566 migration') = 0;
