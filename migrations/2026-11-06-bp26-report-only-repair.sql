-- BP26-REPORT-ONLY-REPAIR-1: restore counting-only installed triggers. Refs #8371.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bp26_retention_trigger_backup_20261106
-- Rollback: restore the saved trigger SQL only after reviewing its data-deletion behavior; the backup is retained.
-- spof-review: counting remains on the existing heavy tick; no new runtime dependency.
CREATE TABLE IF NOT EXISTS bp26_retention_trigger_backup_20261106 AS SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND name IN ('bp26_retention_heavy_tick', 'bp26_retention_sweep_before');
DROP TRIGGER IF EXISTS bp26_retention_sweep_before;
DROP TRIGGER IF EXISTS bp26_retention_heavy_tick;
CREATE TRIGGER IF NOT EXISTS bp26_retention_heavy_tick AFTER INSERT ON fleet_tick_heavy
BEGIN
  UPDATE retention_policy SET past_retention = (SELECT COUNT(*) FROM emails WHERE substr(received_at,1,10) < date('now','-30 days') AND (COALESCE(body_text,'') <> '' OR COALESCE(body_html,'') <> '')), checked_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
    WHERE policy_key = 'emails_bodies_30d' AND measured_by = 'd1-trigger' AND (checked_at IS NULL OR checked_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-50 minutes'));
  UPDATE retention_policy SET past_retention = (SELECT COUNT(*) FROM email_raw_archive WHERE substr(created_at,1,10) < date('now','-30 days') AND COALESCE(raw_text,'') <> ''), checked_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
    WHERE policy_key = 'email_raw_archive_30d' AND measured_by = 'd1-trigger' AND (checked_at IS NULL OR checked_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-50 minutes'));
  UPDATE retention_policy SET past_retention = (SELECT COUNT(*) FROM email_reply_queue WHERE substr(created_at,1,10) < date('now','-90 days') AND (COALESCE(draft_text,'') <> '' OR COALESCE(draft_proposed,'') <> '')), checked_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
    WHERE policy_key = 'email_reply_queue_drafts_90d' AND measured_by = 'd1-trigger' AND (checked_at IS NULL OR checked_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-50 minutes'));
  UPDATE retention_policy SET past_retention = (SELECT COUNT(*) FROM email_loop_quarantine WHERE substr(COALESCE(quarantined_at, received_at),1,10) < date('now','-30 days') AND COALESCE(body_text,'') <> ''), checked_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
    WHERE policy_key = 'email_loop_quarantine_30d' AND measured_by = 'd1-trigger' AND (checked_at IS NULL OR checked_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-50 minutes'));
  UPDATE retention_policy SET past_retention = (SELECT COUNT(*) FROM email_commands WHERE substr(created_at,1,10) < date('now','-180 days') AND COALESCE(command_text,'') <> ''), checked_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
    WHERE policy_key = 'email_commands_180d' AND measured_by = 'd1-trigger' AND (checked_at IS NULL OR checked_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-50 minutes'));
  UPDATE retention_policy SET past_retention = (SELECT COUNT(*) FROM email_parse_failures WHERE substr(created_at,1,10) < date('now','-90 days') AND COALESCE(content_hint,'') <> ''), checked_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
    WHERE policy_key = 'email_parse_failures_90d' AND measured_by = 'd1-trigger' AND (checked_at IS NULL OR checked_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-50 minutes'));
  UPDATE retention_policy SET past_retention = (SELECT COUNT(*) FROM subscribers WHERE status = 'pending' AND substr(created_at,1,10) < date('now','-30 days')), checked_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
    WHERE policy_key = 'subscribers_pending_30d' AND measured_by = 'd1-trigger' AND (checked_at IS NULL OR checked_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-50 minutes'));
  UPDATE retention_policy SET past_retention = (SELECT COUNT(*) FROM subscribers WHERE status = 'unsubscribed' AND substr(COALESCE(updated_at, created_at),1,10) < date('now','-30 days')), checked_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
    WHERE policy_key = 'subscribers_unsubscribed_30d' AND measured_by = 'd1-trigger' AND (checked_at IS NULL OR checked_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-50 minutes'));
  UPDATE retention_policy SET past_retention = (SELECT COUNT(*) FROM contact_ledger WHERE COALESCE(suppress,0) = 0 AND substr(COALESCE(last_contact, first_contact, ''),1,10) <> '' AND substr(COALESCE(last_contact, first_contact),1,10) < date('now','-1095 days')), checked_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
    WHERE policy_key = 'contact_ledger_1095d' AND measured_by = 'd1-trigger' AND (checked_at IS NULL OR checked_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-50 minutes'));
  UPDATE retention_policy SET past_retention = (SELECT COUNT(*) FROM mcp_log WHERE substr(ts,1,10) < date('now','-90 days') AND (COALESCE(args,'') <> '' OR COALESCE(result,'') <> '')), checked_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
    WHERE policy_key = 'mcp_log_90d' AND measured_by = 'd1-trigger' AND (checked_at IS NULL OR checked_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-50 minutes'));
  UPDATE retention_policy SET past_retention = (SELECT COUNT(*) FROM email_calendar_delivery WHERE status IN ('sent','skipped','superseded') AND substr(due_at,1,10) < date('now','-90 days')), checked_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
    WHERE policy_key = 'email_calendar_delivery_90d' AND measured_by = 'd1-trigger' AND (checked_at IS NULL OR checked_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-50 minutes'));
  UPDATE retention_policy SET past_retention = (SELECT COUNT(*) FROM handoffs WHERE session_id LIKE 'email-%' AND substr(timestamp,1,10) < date('now','-180 days') AND COALESCE(summary,'') <> ''), checked_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
    WHERE policy_key = 'handoffs_email_180d' AND measured_by = 'd1-trigger' AND (checked_at IS NULL OR checked_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-50 minutes'));
  UPDATE retention_policy SET past_retention = (SELECT COUNT(*) FROM emails WHERE substr(received_at,1,10) < date('now','-365 days')), checked_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
    WHERE policy_key = 'emails_metadata_365d' AND measured_by = 'd1-trigger' AND (checked_at IS NULL OR checked_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-50 minutes'));
  UPDATE metric_registry SET last_refreshed = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), state = 'MEASURED', refresh_class = 'd1-trigger',
      last_value = CAST((SELECT COALESCE(SUM(past_retention), 0) FROM retention_policy WHERE past_retention IS NOT NULL) AS TEXT)
    WHERE metric = 'records_past_retention' AND instr(source_of_truth, '[BP26]') > 0 AND (last_refreshed IS NULL OR last_refreshed < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-50 minutes')) AND NOT EXISTS (SELECT 1 FROM retention_policy WHERE measured_by = 'd1-trigger' AND checked_at IS NULL);
END;
