-- CLOUD-OPS-EVENTS-INSERT-DEPTH-1 hotfix (2026-11-04, pillar core; issue #7154, agent_issues 1001789). Charter pillar: core.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261104_coe_filer_trigger
-- WHAT BROKE: migration 2026-11-04-cloud-ops-events-trigger-cost.sql (PR 7064, applied 18:57:08Z) dropped and recreated tool_error_rate_filer_v3_ins.
-- Since 18:56:5xZ a plain INSERT INTO cloud_ops_events (also INSERT ... SELECT ... WHERE 0 and EXPLAIN INSERT) fails on qnfo-audit with
-- D1 400 "triggers nested too deep: SQLITE_ERROR"; INSERT OR IGNORE / OR REPLACE still succeed. About 100 plain-INSERT call sites stopped
-- (ops_ai_tool 107 rows in the 90 minutes before, code-task.intake 51, code-task.spend-cap 22, zero since), some silently inside try/catch.
-- My earlier reading ("rows are flowing, so no outage") was wrong: the OR IGNORE writers kept the table moving.
-- WHY IT IS THE FILER: the trigger body INSERTs into agent_issues, which carries about 24 triggers; D1 counts trigger nesting at compile
-- time, and the compiled program of this one trigger is the only schema object on cloud_ops_events that changed in the window.
-- FIX: drop the trigger. It only auto-files TOOL-ERROR-RATE-<tool>-1 issues (error-rate escalation for ops_ai_tool); the same signal is
-- also covered by tool_error_files_issue_v2 (kept) and by qnfo-observability's evReview self-heal escalation. The old text is kept in
-- bak_20261104_coe_filer_trigger (the pre-PR-7064 trigger), so the Rollback restores it exactly. The partial index idx_sha_dispatched_open
-- from the same migration stays (an index cannot add trigger depth).
-- PREDICTION: after apply, `INSERT INTO cloud_ops_events (id, ts, kind, text, meta, job, status) SELECT 'p','t','p','p','{}','p','ok' WHERE 0`
-- succeeds and plain-INSERT writers (ops_ai_tool, code-task.intake, code-task.spend-cap) resume within one tick.
-- IF IT STILL FAILS after apply: the cause is another object changed in the same window; the next step is bisecting by EXPLAIN INSERT after
-- dropping the partial index (see docs/D1-CLOUD-OPS-EVENTS-2026-11.md).
-- FOLLOW-UP (not in this file): re-add the escalation as an hourly cron statement instead of an insert trigger (no nesting).
-- Rollback: execute the sql column of bak_20261104_coe_filer_trigger (row tool_error_rate_filer_v3_ins: the pre-PR-7064 trigger text) after DROP TRIGGER IF EXISTS tool_error_rate_filer_v3_ins

CREATE TABLE IF NOT EXISTS bak_20261104_coe_filer_trigger AS
SELECT name, tbl_name, sql FROM sqlite_master
WHERE type = 'trigger' AND name = 'tool_error_rate_filer_v3_ins';

DROP TRIGGER IF EXISTS tool_error_rate_filer_v3_ins;
