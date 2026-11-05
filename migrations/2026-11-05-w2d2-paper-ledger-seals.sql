-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DROP TRIGGER IF EXISTS paper_ledger_seals_valid; DROP TRIGGER IF EXISTS paper_ledger_seals_no_update; DROP TRIGGER IF EXISTS paper_ledger_seals_no_delete; the table stays (it is the second-database anchor of the paper ledger chain)
-- PAPER-LEDGER-CHAIN-1 (RM-ADR-013-014-ENFORCEMENT-1, roadmap_implementation 115, charter pillar security; session w2d2, 2026-11-05).
-- The head of living-paper.paper_ledger_chain is copied here each time qnfo-lifecycle seals new ledger rows, so a rewrite of the chain table in living-paper alone no longer verifies:
-- qnfo-lifecycle compares the newest three seals and one older seal (rotating) with the chain row they name every hour. Rows are append-only and head_seq only grows.

CREATE TABLE IF NOT EXISTS paper_ledger_seals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  head_seq INTEGER NOT NULL,
  head_hash TEXT NOT NULL,
  chain_rows INTEGER NOT NULL,
  sealed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  sealed_by TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS paper_ledger_seals_valid BEFORE INSERT ON paper_ledger_seals
WHEN NEW.head_seq <= COALESCE((SELECT MAX(head_seq) FROM paper_ledger_seals), 0)
  OR length(NEW.head_hash) <> 71 OR substr(NEW.head_hash, 1, 7) <> 'sha256:'
  OR NEW.chain_rows < 1
BEGIN SELECT RAISE(ABORT, 'PAPER-LEDGER-CHAIN-1: a seal names a newer chain head than the last seal, a sha256:<hex> hash and at least one chain row'); END;

CREATE TRIGGER IF NOT EXISTS paper_ledger_seals_no_update BEFORE UPDATE ON paper_ledger_seals
BEGIN SELECT RAISE(ABORT, 'PAPER-LEDGER-CHAIN-1: seals are append-only'); END;

CREATE TRIGGER IF NOT EXISTS paper_ledger_seals_no_delete BEFORE DELETE ON paper_ledger_seals
BEGIN SELECT RAISE(ABORT, 'PAPER-LEDGER-CHAIN-1: seals are append-only'); END;
