-- EMAIL-TPG-LIKE-1 (2026-11-05, charter pillar autonomy; the 2026-11-04 D1 50-byte LIKE class: PRs 7277, 7281, 7282, 7283).
-- D1 refuses a LIKE or GLOB pattern longer than 50 bytes when the statement runs ("LIKE or GLOB pattern too complex"), and that includes a pattern assembled at run time from a
-- column. email_reply_queue_terminal_parent_guard (2026-10-01, EMAIL-REPLY-TERMINAL-PARENT-GUARD-1) tests, for a human reply closed as terminal-parent,
--   lower(o.recipient) LIKE '%' || lower(NEW.sender) || '%'
-- and a sender is a free-text column: 139 of 1,017 emails.sender values are 49 bytes or longer (longest 84; measured 2026-11-05 on qnfo-audit). For such a sender the closing
-- UPDATE cannot finish: the EXISTS above is evaluated, D1 answers "pattern too complex" instead of the guard's own answer, and a closure the guard should ALLOW (an outbound
-- answer exists) fails with an opaque error while one it should refuse fails with the wrong message. instr(lower(o.recipient), lower(NEW.sender)) > 0 is the same containment test
-- with no pattern, no length limit and no LIKE wildcards in the sender ('_' and '%' in an address were read as wildcards). Everything else in the trigger is unchanged.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_email_tpg_trigger
-- Rollback: DROP TRIGGER IF EXISTS email_reply_queue_terminal_parent_guard; then re-create it from bak_20261105_email_tpg_trigger (column sql holds the exact previous CREATE statement); DELETE FROM failure_modes WHERE fm_key = 'like-dynamic-sender-pattern'

CREATE TABLE IF NOT EXISTS bak_20261105_email_tpg_trigger AS
SELECT name, type, sql FROM sqlite_master WHERE name = 'email_reply_queue_terminal_parent_guard';

DROP TRIGGER IF EXISTS email_reply_queue_terminal_parent_guard;

CREATE TRIGGER email_reply_queue_terminal_parent_guard
BEFORE UPDATE OF decision ON email_reply_queue
WHEN NEW.decision IN ('closed','skip')
  AND lower(COALESCE(NEW.skip_reason,'')) LIKE 'terminal-parent%'
  AND (
    COALESCE((SELECT length(body_text) FROM emails WHERE id = NEW.email_id), 0) = 0
    OR EXISTS (SELECT 1 FROM email_parse_failures f WHERE f.email_id = NEW.email_id AND f.resolved_at IS NULL)
    OR (
      COALESCE(NEW.human_score, 0) >= 2
      AND COALESCE((SELECT status FROM emails WHERE id = NEW.email_id), '') <> 'spam'
      AND NOT EXISTS (
        SELECT 1 FROM emails o
        WHERE lower(o.sender) LIKE '%qnfo.org%'
          AND instr(lower(o.recipient), lower(NEW.sender)) > 0
          AND o.received_at > COALESCE((SELECT received_at FROM emails WHERE id = NEW.email_id), '')
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'EMAIL-REPLY-TERMINAL-PARENT-GUARD-1: terminal-parent closure refused for a human reply with no outbound answer (or an unparsed parent); escalate to the owner instead');
END;

INSERT OR IGNORE INTO failure_modes
  (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id, trigger_condition, symptom, blast_radius)
VALUES
  ('like-dynamic-sender-pattern', 'a statement builds a LIKE pattern from a free-text column, so it fails for the long values only',
   'D1 caps a LIKE or GLOB pattern at 50 bytes at run time; a pattern assembled as ''%'' || column || ''%'' is as long as the column value, and an email sender reaches 84 bytes',
   'EMAIL-TPG-LIKE-1: the terminal-parent guard uses instr(); migrations/email-tpg-like.test.mjs pins the shape and scripts/like-limit-source.test.mjs refuses a static pattern over 50 bytes in worker and script source',
   'fm-like-dynamic-sender-pattern: triggers whose text builds a LIKE pattern from NEW.sender', 'fm-like-dynamic-sender-pattern', '2026-11-05', NULL,
   'a trigger or view contains LIKE ''%'' || lower(NEW.sender) || ''%''',
   'the guarded UPDATE fails with pattern too complex for senders of 49 bytes or more',
   'email_reply_queue terminal-parent closures of human replies');

INSERT OR IGNORE INTO remediation_contracts
  (class, issue_id, verify_probe, verify_transport, max_attempts, expected_cadence_h, status, precondition, action, escalate_to, module)
VALUES
  ('fm-like-dynamic-sender-pattern', NULL,
   'SELECT ''0'' AS expected, CAST((SELECT COUNT(*) FROM sqlite_master WHERE type = ''trigger'' AND instr(sql, ''LIKE ''''%'''' || lower(NEW.sender)'') > 0) AS TEXT) AS observed',
   'd1-query', 3, 24, 'active', 'EMAIL-TPG-LIKE-1', 'failure-mode detector', 'qnfo-fleet-control', 'failure-mode');
