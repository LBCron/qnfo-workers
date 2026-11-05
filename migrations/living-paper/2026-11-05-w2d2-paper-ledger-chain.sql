-- APPLY-BY: ci
-- DB: living-paper
-- Rollback: DROP TRIGGER IF EXISTS paper_ledger_chain_valid; DROP TRIGGER IF EXISTS paper_ledger_chain_no_update; DROP TRIGGER IF EXISTS paper_ledger_chain_no_delete; DROP TRIGGER IF EXISTS trg_papers_adr014_publish_ins; DROP TRIGGER IF EXISTS trg_papers_adr014_publish_upd; DROP TRIGGER IF EXISTS adr014_publish_audit_no_update; DROP TRIGGER IF EXISTS adr014_publish_audit_no_delete; DROP VIEW IF EXISTS v_paper_ledger_chain_breaks; DROP VIEW IF EXISTS v_paper_ledger_chain_body_breaks; DROP VIEW IF EXISTS v_paper_ledger_chain_status; DROP VIEW IF EXISTS v_adr014_authorship_violations; DROP VIEW IF EXISTS v_adr014_authorship_status; the chain table, the audit table and adr_enforcement are never dropped (they are the audit trail)
-- RM-ADR-013-014-ENFORCEMENT-1 (roadmap_implementation 115, charter pillar security; session w2d2, 2026-11-05).
--
-- What the two accepted ADRs ask for, and what was missing (read live 2026-11-05):
--   * ADR-013 (legal immutability): a published artifact is never silently changed. paper_change_ledger (PAPER-LEDGER-1) already refuses UPDATE and DELETE of its own rows, but nothing
--     could show that the ledger itself had not been rewritten by someone who drops the triggers, and the ledger was signed by nothing.
--   * ADR-014 (authorship mandate: the individual, Rowan Brad Quni-Gudzinas, is the attributed author; an organisation byline is not): nothing checked a paper at publish. Read live: 276 of 726 published
--     or distributed papers carry an organisation byline ("QNFO Research", "QNFO", "QNFO Research Agent"), every one first published on or before 2026-08-04; the 296 papers first published since
--     2026-09-01 all carry the owner.
--   * The ADR texts themselves are not readable: both R2 objects (qnfo-audit bucket, adr/ADR-013-LEGAL-IMMUTABILITY.md and adr/ADR-014-AUTHORSHIP-MANDATE.md, 310 bytes each) hold the stdout of a failed
--     wrangler download ("Downloading ... from qnfo-assets. Download complete."), not the decision. The rule enforced here is the one the fleet's own code states (the Zenodo attribution audit:
--     "sole human author = Rowan Brad Quni-Gudzinas; organizational bylines prohibited per ADR-014") and the docs quote ("attribution is always the individual").
--
-- What this adds (all additive; no existing trigger, view or row is changed):
--   * paper_ledger_chain: one row per paper_change_ledger row, in seq order: row_hash = sha256(previous row_hash + canonical JSON of the ledger row + the sha256 of the body it kept). A BEFORE INSERT
--     trigger accepts only the next ledger row (no gap, no repeat), the previous row's hash and a well formed hash; the table can never be updated or deleted. A worker (qnfo-lifecycle) writes the rows;
--     the hash is computed there because SQLite has no sha256. The head of the chain is anchored in a second database (qnfo-audit paper_ledger_seals), so rewriting this table alone is detected.
--   * unsealed_min is the minutes since the chain head was sealed while ledger rows wait (0 when none wait): a sealer that works hourly keeps it under 60 even while it catches up on a backlog,
--     and a stalled sealer shows from the first hour.
--   * v_paper_ledger_chain_breaks / v_paper_ledger_chain_body_breaks (two views: D1 rejects a compound SELECT over 5 terms) / v_paper_ledger_chain_status: the SQL-checkable part of the verification (link, genesis, a ledger row deleted or added below the head, a body added or an archive
--     fingerprint changed after sealing) and the sealing lag. The hash recomputation and the anchor comparison run in the worker.
--   * adr_enforcement + adr014_publish_audit + trg_papers_adr014_publish_ins / _upd: at publish (insert as published or distributed, or the first move into either from a non-public status, or an
--     authors change on a public paper) a paper whose authors do not name the owner is recorded in adr014_publish_audit (mode observe, the shipped default) or refused with ADR-014-AUTHORSHIP-BLOCKED
--     (mode enforce). Restores from quarantine, retraction or supersession are not first publications and are never recorded. 'off' skips the check.
--   * v_adr014_authorship_violations / v_adr014_authorship_status: the exact list, split into era 'since-adr' (first public on or after 2026-09-02, the date of the ADR objects in R2) and 'legacy'.
--
-- Rollback is the DROP list in the header. The publish check is stopped without a deploy by UPDATE adr_enforcement SET mode = 'off' WHERE rule = 'adr014-publish-authorship'
-- (and raised to enforce the same way).

CREATE TABLE IF NOT EXISTS paper_ledger_chain (
  seq INTEGER PRIMARY KEY,
  prev_hash TEXT NOT NULL,
  row_hash TEXT NOT NULL,
  body_sha256 TEXT,
  sealed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  sealed_by TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS paper_ledger_chain_valid BEFORE INSERT ON paper_ledger_chain
WHEN NEW.seq <= COALESCE((SELECT MAX(seq) FROM paper_ledger_chain), 0)
  OR NOT EXISTS (SELECT 1 FROM paper_change_ledger WHERE seq = NEW.seq)
  OR EXISTS (SELECT 1 FROM paper_change_ledger WHERE seq > COALESCE((SELECT MAX(seq) FROM paper_ledger_chain), 0) AND seq < NEW.seq)
  OR NEW.prev_hash IS NOT COALESCE((SELECT row_hash FROM paper_ledger_chain ORDER BY seq DESC LIMIT 1), 'genesis')
  OR length(NEW.row_hash) <> 71 OR substr(NEW.row_hash, 1, 7) <> 'sha256:'
  OR (NEW.body_sha256 IS NOT NULL AND (length(NEW.body_sha256) <> 71 OR substr(NEW.body_sha256, 1, 7) <> 'sha256:'))
  OR trim(COALESCE(NEW.sealed_by, '')) = ''
BEGIN SELECT RAISE(ABORT, 'PAPER-LEDGER-CHAIN-1: a chain row must be the next ledger row (no gap, no repeat), carry the previous row hash (genesis for the first), a sha256:<hex> hash and a sealer'); END;

CREATE TRIGGER IF NOT EXISTS paper_ledger_chain_no_update BEFORE UPDATE ON paper_ledger_chain
BEGIN SELECT RAISE(ABORT, 'PAPER-LEDGER-CHAIN-1: the chain is append-only; a wrong row is answered by a new finding, never by an edit'); END;

CREATE TRIGGER IF NOT EXISTS paper_ledger_chain_no_delete BEFORE DELETE ON paper_ledger_chain
BEGIN SELECT RAISE(ABORT, 'PAPER-LEDGER-CHAIN-1: the chain is append-only; rows are never deleted'); END;

CREATE VIEW IF NOT EXISTS v_paper_ledger_chain_breaks AS
SELECT c.seq AS seq, 'link' AS kind, 'prev_hash is not the previous row_hash' AS detail
FROM (SELECT seq, prev_hash, LAG(row_hash) OVER (ORDER BY seq) AS expected FROM paper_ledger_chain) c
WHERE c.expected IS NOT NULL AND c.prev_hash <> c.expected
UNION ALL
SELECT c.seq, 'genesis', 'the first chain row does not start from genesis'
FROM paper_ledger_chain c
WHERE c.seq = (SELECT MIN(seq) FROM paper_ledger_chain) AND c.prev_hash <> 'genesis'
UNION ALL
SELECT c.seq, 'ledger-row-missing', 'a sealed ledger row no longer exists'
FROM paper_ledger_chain c LEFT JOIN paper_change_ledger l ON l.seq = c.seq
WHERE l.seq IS NULL
UNION ALL
SELECT l.seq, 'ledger-row-unsealed-below-head', 'a ledger row below the chain head has no chain row (inserted after sealing)'
FROM paper_change_ledger l
WHERE l.seq <= COALESCE((SELECT MAX(seq) FROM paper_ledger_chain), 0)
  AND NOT EXISTS (SELECT 1 FROM paper_ledger_chain c WHERE c.seq = l.seq);

CREATE VIEW IF NOT EXISTS v_paper_ledger_chain_body_breaks AS
SELECT c.seq AS seq, 'body-archive-mismatch' AS kind, 'the archive fingerprint differs from the body hash sealed with the row' AS detail
FROM paper_ledger_chain c JOIN paper_change_body_archive a ON a.seq = c.seq
WHERE c.body_sha256 IS NOT NULL AND c.body_sha256 <> a.fingerprint
UNION ALL
SELECT c.seq, 'body-added-after-seal', 'a body exists for a row that was sealed without one'
FROM paper_ledger_chain c JOIN paper_change_bodies b ON b.seq = c.seq
WHERE c.body_sha256 IS NULL;

CREATE VIEW IF NOT EXISTS v_paper_ledger_chain_status AS
SELECT
  (SELECT COUNT(*) FROM paper_ledger_chain) AS chain_rows,
  (SELECT MAX(seq) FROM paper_ledger_chain) AS head_seq,
  (SELECT row_hash FROM paper_ledger_chain ORDER BY seq DESC LIMIT 1) AS head_hash,
  (SELECT COUNT(*) FROM paper_change_ledger WHERE seq > COALESCE((SELECT MAX(seq) FROM paper_ledger_chain), 0)) AS unsealed_rows,
  (SELECT MIN(ts) FROM paper_change_ledger WHERE seq > COALESCE((SELECT MAX(seq) FROM paper_ledger_chain), 0)) AS oldest_unsealed_ts,
  CASE WHEN (SELECT COUNT(*) FROM paper_change_ledger WHERE seq > COALESCE((SELECT MAX(seq) FROM paper_ledger_chain), 0)) = 0 THEN 0
       ELSE CAST(ROUND((julianday('now') - julianday(COALESCE((SELECT sealed_at FROM paper_ledger_chain ORDER BY seq DESC LIMIT 1), (SELECT MIN(ts) FROM paper_change_ledger)))) * 1440) AS INTEGER) END AS unsealed_min,
  ((SELECT COUNT(*) FROM v_paper_ledger_chain_breaks) + (SELECT COUNT(*) FROM v_paper_ledger_chain_body_breaks)) AS sql_breaks;

CREATE TABLE IF NOT EXISTS adr_enforcement (
  rule TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('observe', 'enforce', 'off')),
  note TEXT,
  set_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT OR IGNORE INTO adr_enforcement (rule, mode, note)
VALUES ('adr014-publish-authorship', 'observe',
        'ADR-014 at publish: observe records a public paper whose authors do not name Quni-Gudzinas in adr014_publish_audit and lets the write through; enforce refuses it. Shipped as observe (2026-11-05, w2d2): 0 of the 296 papers first published since 2026-09-01 would have been refused, so the switch to enforce is a one-line UPDATE once adr014_publish_audit stays empty for seven days.');

CREATE TABLE IF NOT EXISTS adr014_publish_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  slug TEXT,
  identifier TEXT,
  status TEXT,
  authors TEXT,
  event TEXT NOT NULL,
  actor TEXT
);

CREATE TRIGGER IF NOT EXISTS adr014_publish_audit_no_update BEFORE UPDATE ON adr014_publish_audit
BEGIN SELECT RAISE(ABORT, 'ADR-014: the publish audit is append-only'); END;

CREATE TRIGGER IF NOT EXISTS adr014_publish_audit_no_delete BEFORE DELETE ON adr014_publish_audit
BEGIN SELECT RAISE(ABORT, 'ADR-014: the publish audit is append-only'); END;

CREATE TRIGGER IF NOT EXISTS trg_papers_adr014_publish_ins BEFORE INSERT ON papers FOR EACH ROW
WHEN NEW.status IN ('published', 'distributed')
  AND (NEW.authors IS NULL OR instr(lower(NEW.authors), 'quni-gudzinas') = 0)
  AND COALESCE((SELECT mode FROM adr_enforcement WHERE rule = 'adr014-publish-authorship'), 'off') <> 'off'
BEGIN
  INSERT INTO adr014_publish_audit (slug, identifier, status, authors, event, actor)
  SELECT NEW.slug, NEW.identifier, NEW.status, substr(NEW.authors, 1, 300), 'insert', NEW.change_actor
  WHERE (SELECT mode FROM adr_enforcement WHERE rule = 'adr014-publish-authorship') = 'observe';
  SELECT RAISE(ABORT, 'ADR-014-AUTHORSHIP-BLOCKED: a published paper must name Rowan Brad Quni-Gudzinas in authors; an organisation byline is not an author (ADR-014)')
  WHERE (SELECT mode FROM adr_enforcement WHERE rule = 'adr014-publish-authorship') = 'enforce';
END;

CREATE TRIGGER IF NOT EXISTS trg_papers_adr014_publish_upd BEFORE UPDATE OF status, authors ON papers FOR EACH ROW
WHEN NEW.status IN ('published', 'distributed')
  AND (NEW.authors IS NULL OR instr(lower(NEW.authors), 'quni-gudzinas') = 0)
  AND (
    (COALESCE(OLD.status, '') NOT IN ('published', 'distributed', 'external_preprint', 'quarantined', 'retracted', 'superseded'))
    OR (OLD.status IN ('published', 'distributed') AND OLD.authors IS NOT NEW.authors AND instr(lower(COALESCE(OLD.authors, '')), 'quni-gudzinas') > 0)
  )
  AND COALESCE((SELECT mode FROM adr_enforcement WHERE rule = 'adr014-publish-authorship'), 'off') <> 'off'
BEGIN
  INSERT INTO adr014_publish_audit (slug, identifier, status, authors, event, actor)
  SELECT NEW.slug, NEW.identifier, NEW.status, substr(NEW.authors, 1, 300), 'update', NEW.change_actor
  WHERE (SELECT mode FROM adr_enforcement WHERE rule = 'adr014-publish-authorship') = 'observe';
  SELECT RAISE(ABORT, 'ADR-014-AUTHORSHIP-BLOCKED: a paper that is published, or whose authors change while published, must name Rowan Brad Quni-Gudzinas in authors; an organisation byline is not an author (ADR-014)')
  WHERE (SELECT mode FROM adr_enforcement WHERE rule = 'adr014-publish-authorship') = 'enforce';
END;

CREATE VIEW IF NOT EXISTS v_adr014_authorship_violations AS
SELECT slug, status, identifier_type, authors, version,
       COALESCE(first_published_at, substr(created_at, 1, 10)) AS first_public_at,
       CASE WHEN COALESCE(first_published_at, substr(created_at, 1, 10)) >= '2026-09-02' THEN 'since-adr' ELSE 'legacy' END AS era
FROM papers
WHERE status IN ('published', 'distributed')
  AND slug IS NOT NULL
  AND (authors IS NULL OR instr(lower(authors), 'quni-gudzinas') = 0);

CREATE VIEW IF NOT EXISTS v_adr014_authorship_status AS
SELECT
  (SELECT COUNT(*) FROM papers WHERE status IN ('published', 'distributed') AND slug IS NOT NULL) AS public_papers,
  (SELECT COUNT(*) FROM v_adr014_authorship_violations) AS violations,
  (SELECT COUNT(*) FROM v_adr014_authorship_violations WHERE era = 'since-adr') AS violations_since_adr,
  (SELECT COUNT(*) FROM v_adr014_authorship_violations WHERE era = 'legacy') AS violations_legacy,
  (SELECT COUNT(*) FROM adr014_publish_audit WHERE ts >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days')) AS observed_publish_7d,
  (SELECT mode FROM adr_enforcement WHERE rule = 'adr014-publish-authorship') AS publish_mode;
