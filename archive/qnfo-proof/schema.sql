-- qnfo-proof ledger schema (qnfo-audit D1, created 2026-09-04)
CREATE TABLE IF NOT EXISTS proofs (
  id TEXT PRIMARY KEY,
  conjecture TEXT NOT NULL,
  author TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  paper_slug TEXT,
  paper_doi TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS proof_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proof_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  ts INTEGER NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL,
  UNIQUE (proof_id, seq)
);
CREATE TABLE IF NOT EXISTS proof_nodes (
  proof_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  parent_id TEXT,
  statement TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  author TEXT,
  verifier TEXT,
  claimed_by TEXT,
  claim_role TEXT,
  claim_expires INTEGER,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (proof_id, node_id)
);
CREATE TABLE IF NOT EXISTS proof_challenges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proof_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'major',
  aspect TEXT,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  raised_by TEXT NOT NULL,
  response TEXT,
  resolved_by TEXT,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
