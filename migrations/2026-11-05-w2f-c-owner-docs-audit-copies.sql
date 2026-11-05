-- OWNER-DOCS-AUDIT-COPIES-1 (2026-11-05, agent W2-F-C, charter pillar security; roadmap row 123 RM-OWNER-DOCS-PRIVATE-STORE-1). IDENTITY-STORE-1 (2026-10-01) moved the owner documents to the private D1
-- qnfo-identity, bound only to qnfo-fleet-dashboard, and left the rule "do not write qnfo-audit.owner_docs; a write there is copied across on the next */15 tick". Read 2026-11-05 04:00Z: qnfo-audit.owner_docs
-- still holds 3 private rows written on 2026-10-12 by sessions that followed the old rule (email-voice-v1 3180 chars, fleet-backlog-plan-2026-10-12 2414 chars, patch-goal-room-1 4727 chars), which every
-- worker bound to the shared qnfo-audit can read. qnfo-identity.owner_docs holds all three with the same key, length, updated_at and a character-weighted checksum
-- (SUM(unicode(char) * (position % 97 + 1)) = 13901494, 10222360 and 18238274 on both sides, equal), so the dashboard sync copied them across on 2026-10-12. Nothing reads the audit copies: a code read of every
-- worker.js finds owner_docs only in qnfo-fleet-dashboard (reads qnfo-identity), comments in qnfo-fleet-control and qnfo-social, and qnfo-email, which reads the voice document through the dashboard binding;
-- sqlite_master holds no view or trigger that names the table. This file removes the three stale copies (a delete guarded by key, length and updated_at, so a newer write is left for the sync) and keeps their
-- metadata (no body) in bak_20261105_owner_docs_audit_meta; the full copies are the qnfo-identity rows. After it qnfo-audit.owner_docs holds 0 rows, the state IDENTITY-STORE-1 intended.
-- PREDICTION: qnfo-audit.owner_docs row count 3 -> 0 and stays 0 unless a session writes there again (the sync then copies it across and the contract below shows it); 10.3 KB of private text leaves the shared database.
-- Revert: there is nothing to restore into qnfo-audit by design; the bodies are in qnfo-identity.owner_docs (copy back through the dashboard /api/owner/doc if ever needed).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_owner_docs_audit_meta
-- Rollback: SELECT 'no SQL rollback: qnfo-audit.owner_docs held stale copies; the bodies are in qnfo-identity.owner_docs (same key, length, updated_at, checksum); metadata kept in bak_20261105_owner_docs_audit_meta'
-- CAUSE-MAPPED: registers no metric.
-- spof-review: adds no worker, cron, D1 trigger, route or credential; it deletes 3 stale copies and adds one contract that reads the table size.

CREATE TABLE IF NOT EXISTS bak_20261105_owner_docs_audit_meta AS
SELECT key, title, source, visibility, updated_at, length(body_md) AS body_len, '2026-11-05' AS backed_up_on
FROM owner_docs
WHERE key IN ('email-voice-v1', 'fleet-backlog-plan-2026-10-12', 'patch-goal-room-1');

DELETE FROM owner_docs WHERE key = 'email-voice-v1' AND length(body_md) = 3180 AND updated_at = '2026-10-12 08:44:36';
DELETE FROM owner_docs WHERE key = 'fleet-backlog-plan-2026-10-12' AND length(body_md) = 2414 AND updated_at = '2026-10-12 08:52:40';
DELETE FROM owner_docs WHERE key = 'patch-goal-room-1' AND length(body_md) = 4727 AND updated_at = '2026-10-12 09:02:08';

INSERT OR IGNORE INTO failure_modes
 (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, trigger_condition, symptom, blast_radius)
VALUES
 ('owner-docs-audit-copy', 'qnfo-audit.owner_docs holds a row: a private owner document sits in the database every worker reads',
  'IDENTITY-STORE-1 moved the owner documents to the private D1 qnfo-identity but the old rule (write qnfo-audit.owner_docs, the dashboard sync copies it across) stayed in sessions memory; 3 documents were written there on 2026-10-12 and the sync, which never deletes in qnfo-audit, left the copies in place',
  'verify the same key, length and updated_at in qnfo-identity.owner_docs, then delete the audit copy by migration keeping its metadata; write owner documents to qnfo-identity through the dashboard /api/owner/doc',
  'fm-owner-docs-audit-copy', 'fm-owner-docs-audit-copy', '2026-11-05',
  'SELECT COUNT(*) FROM owner_docs on qnfo-audit is above 0',
  'a private owner document readable by every worker bound to qnfo-audit',
  'exposure of owner private text (email voice, plans) to every worker and session that reads qnfo-audit');

INSERT OR IGNORE INTO remediation_contracts
 (class, issue_id, verify_probe, verify_transport, max_attempts, expected_cadence_h, status, precondition, action, escalate_to, module, next_due_at)
VALUES
 ('fm-owner-docs-audit-copy', NULL,
  'SELECT ''0'' AS expected, CAST((SELECT COUNT(*) FROM owner_docs) AS TEXT) AS observed',
  'd1-query', 1000, 24, 'active',
  'qnfo-audit.owner_docs holds no row: the owner documents live in the private D1 qnfo-identity (IDENTITY-STORE-1)',
  'A row here is a write that followed the old rule. The dashboard sync copies it into qnfo-identity.owner_docs on the next */15 tick; once identity.owner_docs holds the same key, length and updated_at, delete the audit copy with a migration that keeps its metadata (migrations/2026-11-05-w2f-c-owner-docs-audit-copies.sql is the pattern). Write owner documents to qnfo-identity through the dashboard /api/owner/doc, never to qnfo-audit.',
  'program-manager:QNFO.INFRA', 'failure-mode', datetime('now', '+2 hours'));

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:w2f-c',
 'three private owner documents in the shared qnfo-audit are stale copies of rows already in the private qnfo-identity, so removing them loses nothing and ends their exposure to every worker that binds qnfo-audit',
 'OWNER-DOCS-AUDIT-COPIES-1: delete the 3 qnfo-audit.owner_docs rows written 2026-10-12, keep their metadata in bak_20261105_owner_docs_audit_meta, add contract fm-owner-docs-audit-copy',
 'qnfo-identity.owner_docs holds email-voice-v1, fleet-backlog-plan-2026-10-12 and patch-goal-room-1 with the same length, updated_at and character-weighted checksum as the qnfo-audit rows (read 2026-11-05 04:00Z); code read: only qnfo-fleet-dashboard reads owner_docs, qnfo-email through the dashboard binding; sqlite_master has no view or trigger on the table',
 'qnfo-audit.owner_docs holds 0 rows; qnfo-identity keeps the documents',
 'three rows of qnfo-audit.owner_docs; no reader',
 'the bodies are in qnfo-identity.owner_docs; the metadata is in bak_20261105_owner_docs_audit_meta',
 'the private-store rule of IDENTITY-STORE-1 is checked by a contract instead of by memory',
 'SELECT COUNT(*) FROM owner_docs on qnfo-audit reads 0 after the merge and the contract fm-owner-docs-audit-copy passes',
 'no external reach change',
 'two D1 reads compared (lengths, updated_at, weighted checksum); code read of every worker.js; sqlite_master read'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE actor = 'session:w2f-c' AND action LIKE 'OWNER-DOCS-AUDIT-COPIES-1:%');
