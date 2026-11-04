-- CHAOS-METRIC-QUERY-1 (2026-11-04, charter pillar autonomy; own the fix of CF-OBS-ISSUE-1 #1001547 / mirror 7051, which cannot close for real until the cause is gone).
-- Evidence (qnfo-audit and qnfo-fleet-control/worker.js on main, 2026-11-04): chaosDrill's step "failure-modes-metric" (PR 6653, code task ct_u8g2cjbcr8kmz7) runs
--   SELECT COUNT(*) FROM v_failure_mode_status f WHERE ... remediation_verifications rv WHERE rv.failure_mode_id = f.id AND rv.owner ... issue_assignments ia WHERE ia.failure_mode_id = f.id ...
-- Three things in it do not exist: the table issue_assignments (no sqlite_master row), the columns remediation_verifications.failure_mode_id and .owner (columns are id, issue_id, class, action_ref,
-- probe_url, transport, expected, observed, pass, verified_at, verifier), and the column v_failure_mode_status.id (columns are fm_key, failure_mode, probe_class, last_probed, status). The query can never run;
-- the catch logs {"step":"failure-modes-metric","error":"D1_ERROR: no such table: issue_assignments"} on every chaos drill and the observability bridge files it as CF-OBS-ISSUE-1. The metric it
-- tries to write, failure_modes_recurring, is already refreshed by the D1 trigger failure_modes_tick from the same view, so the step is redundant as well as broken.
-- Change: a doer for the code loop (no worker edit here: the code loop holds a claim on qnfo-fleet-control/worker.js). Its closing probe is a code-probe: the text "FROM issue_assignments ia" is absent.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE agent_issues SET status = 'closed' WHERE title LIKE 'ROADMAP-1: QNFO.OPS #chaos-metric:%' after recording close_evidence on its issue_triage row (a filed issue is closed with evidence, never deleted).
-- CAUSE-MAPPED: registers no metric_registry row.

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.OPS #chaos-metric: chaosDrill failure-modes-metric reads a table and columns that do not exist',
       'Charter pillar: autonomy. Program QNFO.OPS. Metric to move: open_agent_issues (the CF-OBS-ISSUE-1 family, issue 1001547). In qnfo-fleet-control/worker.js chaosDrill, the step failure-modes-metric (PR 6653) selects from v_failure_mode_status f with NOT EXISTS subqueries on remediation_verifications.failure_mode_id, remediation_verifications.owner and the table issue_assignments. None of these exist (remediation_verifications has id, issue_id, class, action_ref, probe_url, transport, expected, observed, pass, verified_at, verifier; v_failure_mode_status has fm_key, failure_mode, probe_class, last_probed, status; there is no issue_assignments table), so every chaos drill logs D1_ERROR: no such table: issue_assignments and the observability bridge files it as CF-OBS-ISSUE-1.' || char(10) ||
       'Change: delete that try block (the metric failure_modes_recurring is already refreshed by the D1 trigger failure_modes_tick from the same view, so the worker write is redundant and a second writer), keeping the surrounding chaos-drill-state write; bump VERSION and the mirror. If an owner exclusion is wanted, define it on real data in a migration, not in the worker. Definition of done: no failure-modes-metric error in cloud_ops_events or worker logs after the deploy, and CF-OBS-ISSUE-1 issue 1001547 closes through its own probe.' || char(10) ||
       'code-task: repo=qnfo-workers path=qnfo-fleet-control/worker.js' || char(10) ||
       'code-anchor: var recurringRow = await db.prepare("SELECT COUNT(*) AS n FROM v_failure_mode_status f WHERE f.status IN',
       'claude-session', 'reliability', 'high', 'open', CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.OPS #chaos-metric:%');

-- The code-probe line is added by an update: the line trigger (agent_issues_code_probe_upd) installs the code-read contract only when the line is new in the description, and an insert
-- leaves the birth contract on the generic template (seen on issues 1001744 to 1001746 of RELAPSE-HOLD-1).
UPDATE agent_issues
SET description = description || char(10) || 'code-probe: {"paths": ["qnfo-fleet-control/worker.js"], "absent": "FROM issue_assignments ia"}',
    updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE title LIKE 'ROADMAP-1: QNFO.OPS #chaos-metric:%' AND status = 'open' AND instr(description, 'code-probe: {') = 0;
