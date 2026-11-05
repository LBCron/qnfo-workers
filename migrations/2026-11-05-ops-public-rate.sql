-- BP26-R2-KV-USAGE-1 (2026-11-05, charter pillar core; agent_issues 1000350, roadmap_implementation row 1406): the per-visitor hourly counter of qnfo-ops public read mode moves from a KV
-- get-then-put to one atomic D1 upsert (qnfo-ops 2.63.1, opsPublicGate). KV is eventually consistent, so two concurrent requests from one visitor both read n and both wrote n + 1; the static scan
-- kv_used_for_locking (scripts/bp26_repo.py) reported exactly this line (1 hit, qnfo-ops/worker.js, kv-counter-rmw) on 2026-11-05. The table holds one row per visitor-hour (a salted hash, never an address)
-- and the worker deletes rows older than three hours on about one request in fifty. A missing table fails open for the per-visitor limit only (the daily cap reads ops_ai_log and stays the hard limit).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DROP TABLE IF EXISTS ops_public_rate;

CREATE TABLE IF NOT EXISTS ops_public_rate (
  k TEXT PRIMARY KEY,
  hr TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0
);
