-- RM-BS-WEEKLY-SIGNAL-1 (2026-11-05, charter pillar reach, program QNFO.REACH; roadmap_implementation row 3272, blue-sky bet B16): the table behind the human-reviewed weekly signal.
-- qnfo-subscribers (1.6.0) drafts one "claim, check, limits" issue a week into this table, mails the owner a review link once, and sends it to confirmed, non-suppressed
-- subscribers only after the owner approved it; with no approved issue the paper roll-up goes out as before. The worker tolerates the table being absent (it logs and does nothing),
-- so the order of this migration and the deploy does not matter.
-- send_date is the Sunday (UTC) of the 16:00 send slot, the one key of an issue. status: draft -> approved | rejected -> sending -> sent; expired when the slot passed unreviewed.
-- 'sending' is the at-most-once claim taken before the first mail, so a cron retry can never mail an issue twice.
-- Prediction: draft-to-decision latency and review rate are readable from this table (reviewed_at - drafted_at, share of drafts approved or rejected before the slot); the program gate is 50 confirmed subscribers by 2026-12-31 (baseline 1).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DROP TABLE IF EXISTS weekly_signal_issues;
-- CAUSE-MAPPED: registers no metric_registry row.

CREATE TABLE IF NOT EXISTS weekly_signal_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  send_date TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','rejected','sending','sent','expired')),
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  items_json TEXT NOT NULL DEFAULT '[]',
  voice_disclosure TEXT NOT NULL,
  audio_url TEXT,
  drafted_at TEXT NOT NULL DEFAULT (datetime('now')),
  drafted_by TEXT NOT NULL DEFAULT 'qnfo-subscribers',
  owner_mailed_at TEXT,
  mail_attempts INTEGER NOT NULL DEFAULT 0,
  reviewed_at TEXT,
  reviewed_by TEXT,
  sent_at TEXT,
  sent_count INTEGER,
  notes TEXT
);
