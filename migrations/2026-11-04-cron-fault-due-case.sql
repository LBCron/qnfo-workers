-- CRON-FAULT-DUE-CASE-1 (2026-11-04, charter pillar autonomy): review-gate finding on PR 7277. The substr() prefix compare that replaced LIKE is case-sensitive, LIKE was
-- case-insensitive for ASCII, so an open floor issue titled in another case would stop suppressing its schedule fault. lower() on both sides restores the old match.
-- Same columns and rows as the view from CRON-FAULT-DUE-LIKE-1 apart from that case rule.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261104_v_cron_fault_due_case
-- Rollback: DROP VIEW IF EXISTS v_cron_fault_due; then re-create it from bak_20261104_v_cron_fault_due_case (column sql holds the exact previous CREATE VIEW statement)
-- spof-review: one view redefined with the same columns.

CREATE TABLE IF NOT EXISTS bak_20261104_v_cron_fault_due_case AS
SELECT name, type, sql FROM sqlite_master WHERE type = 'view' AND name = 'v_cron_fault_due';

DROP VIEW IF EXISTS v_cron_fault_due;
CREATE VIEW v_cron_fault_due AS
SELECT * FROM v_cron_fault_now
WHERE first_seen <= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', CASE WHEN kind = 'schedule' THEN '-90 minutes' ELSE '-9 minutes' END)
  AND NOT (kind = 'schedule' AND EXISTS (SELECT 1 FROM agent_issues a WHERE a.status = 'open'
    AND lower(substr(a.title, 1, length('CRON-HOURLY-FLOOR-1:' || v_cron_fault_now.worker || ':'))) = lower('CRON-HOURLY-FLOOR-1:' || v_cron_fault_now.worker || ':')));
