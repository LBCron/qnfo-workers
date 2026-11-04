-- BLOB-TRIM-1 (2026-11-04, program QNFO.INFRA, charter pillar core): the unread messages_json blob of chatbox_conversations is trimmed once the R2 export holds it.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM remediation_contracts WHERE class = 'fm-blob-trim-lag'; DELETE FROM failure_modes WHERE fm_key = 'blob-trim-lag'; DELETE FROM ops_config WHERE key = 'blob_trim';
-- CAUSE-MAPPED: registers no metric_registry row; the failure-mode contract fm-blob-trim-lag is the alarm.
--
-- Measured 2026-11-04 on qnfo-audit: chatbox_conversations has 3,491 rows, messages_json 144 MB of its 165 MB (qnfo-ai stores the last 100 messages of the thread on every row,
-- so a thread of n turns holds about n squared / 2 messages); prompt 3 MB, response 17 MB. The only code that touches the column is the writer in qnfo-ai (worker.js, the log
-- record) and a test; the history browse reads prompt and response (substr 20000), so each row's turn is complete without it. Database size 1.49 GB; this blob is 10 percent.
-- scripts/continuity_snapshot.py blob_trim sets messages_json to NULL on rows with rowid at most the last rowid the weekly R2 export wrote for the table (done, mode rowid),
-- 150 rows (about 6 MB of writes) a run, so the export object keeps every original and a row written after the export is never touched. ops_config blob_trim = off stops it.
-- PREDICTION: chatbox_conversations 165 MB -> about 21 MB within two days (3,491 rows at 150 a run and about 40 consumer runs a day), database 1.49 GB -> 1.35 GB; new rows
-- carry the blob for one week and are trimmed after the next export. Check: SELECT COUNT(*) FROM chatbox_conversations WHERE messages_json IS NOT NULL AND ts < date('now','-14 days').

INSERT OR IGNORE INTO ops_config (key, value, note, updated_at)
VALUES ('blob_trim', 'on', 'BLOB-TRIM-1: scripts/continuity_snapshot.py blob_trim nulls chatbox_conversations.messages_json on rows the weekly R2 export holds; off stops it', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));

INSERT OR IGNORE INTO failure_modes
 (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, trigger_condition, symptom, blast_radius)
VALUES
 ('blob-trim-lag', 'chatbox_conversations rows older than 14 days still hold the messages_json blob',
  'qnfo-ai writes the last 100 messages of the thread onto every row (quadratic in thread length, 41 KB a row on average) and nothing reads them; without a trim the table grows 70 KB a turn',
  'scripts/continuity_snapshot.py blob_trim (BLOB-TRIM-1) nulls the blob on rows the weekly R2 export holds; fix the export (v_continuity_status, _progress.json errors for chatbox_conversations) when rows stay',
  'fm-blob-trim-lag', 'fm-blob-trim-lag', '2026-11-04',
  'A chatbox_conversations row is older than 14 days and messages_json is not NULL',
  'chatbox_conversations rows older than 14 days with messages_json not null',
  'Database size and export time (144 MB of one table)');

INSERT OR IGNORE INTO remediation_contracts
 (class, issue_id, verify_probe, verify_transport, max_attempts, expected_cadence_h, status, precondition, action, escalate_to, module, next_due_at)
VALUES
 ('fm-blob-trim-lag', NULL,
  'SELECT ''0'' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM chatbox_conversations WHERE messages_json IS NOT NULL AND ts < strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-14 days'')',
  'd1-query', 1000, 1, 'active',
  'No chatbox_conversations row older than 14 days holds a messages_json blob',
  'Read the blob-trim and d1-export events of cloud_ops_events and the chatbox_conversations entry of export/qnfo-audit/_progress.json; the trim waits for a finished export of the table, so finish the export; never null the column by hand before the export object exists',
  'program-manager:QNFO.INFRA', 'failure-mode', datetime('now'));

INSERT INTO decision_log
 (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, surfaces_tested)
SELECT 'claude-code-session-2026-11-04-spend-enforce',
 'A write-only duplicate of the thread history, 41 KB on every chat row, is database weight with no reader once the export holds it',
 'BLOB-TRIM-1: blob_trim in scripts/continuity_snapshot.py nulls chatbox_conversations.messages_json on exported rows; contract fm-blob-trim-lag',
 'chatbox_conversations on 2026-11-04: 3,491 rows, messages_json 82 MB + 61 MB of 165 MB; code reads only prompt and response (qnfo-ai THREAD-HISTORY-1)',
 'messages_json is NULL on rows older than the export; prompt, response, ts, model, thread_id are untouched',
 'one column of one table; reversible from the R2 export object (qnfo-backups/export/qnfo-audit/<stamp>/chatbox_conversations*.jsonl.gz)',
 'set ops_config blob_trim to off; restore a value from the export object',
 'qnfo-audit sheds 144 MB of unread blob',
 'chatbox_conversations 165 MB -> about 21 MB in two days; database 1.49 GB -> about 1.35 GB',
 'continuity_snapshot.py --selftest (blob_selftest: 50 a run, only exported rowids, off, unfinished export, error, offset mode, no progress)'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'BLOB-TRIM-1:%');
