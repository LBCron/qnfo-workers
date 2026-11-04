-- APPLY-BY: ci
-- DB: living-paper
-- Rollback: DROP TRIGGER IF EXISTS papers_published_date_ins; DROP TRIGGER IF EXISTS papers_published_date_ver;
-- PAPER-DATE-STAMP-1 (pillar research, owner directive 2026-11-04: "why do I see old dates"). D1 read 2026-11-04: 376 of 594 published
-- pipeline papers had published NULL although first_published_at is set, so readers saw no date or the creation date of an older
-- revision. Backfill published from first_published_at (a date that was never filled is never invented), and stamp it on every new
-- paper and every version change. Owner papers (qnfo-2025-*) are not touched. No body, title, status or version change.
UPDATE papers SET published = substr(first_published_at, 1, 10),
  change_actor = 'migration:2026-11-04-paper-published-date',
  change_reason = 'PAPER-DATE-STAMP-1: published was NULL, filled from first_published_at'
WHERE status = 'published' AND published IS NULL AND first_published_at IS NOT NULL
  AND substr(COALESCE(identifier, ''), 1, 10) <> 'qnfo-2025-';

CREATE TRIGGER IF NOT EXISTS papers_published_date_ins AFTER INSERT ON papers
WHEN NEW.status = 'published' AND NEW.published IS NULL
BEGIN
  UPDATE papers SET published = date('now') WHERE rowid = NEW.rowid AND published IS NULL;
END;

CREATE TRIGGER IF NOT EXISTS papers_published_date_ver AFTER UPDATE OF version ON papers
WHEN NEW.status = 'published' AND NEW.published IS NULL AND NEW.version IS NOT OLD.version
BEGIN
  UPDATE papers SET published = COALESCE(substr(NEW.first_published_at, 1, 10), date('now')) WHERE rowid = NEW.rowid AND published IS NULL;
END;
