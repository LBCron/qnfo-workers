-- qnfo-chameleon M0 schema — preference telemetry (apply to D1: personal-life)
-- Source: QNFO/qnfo-workers/qnfo-chameleon/schema.sql
-- Apply:  wrangler d1 execute personal-life --remote --file schema.sql
-- Build plan: ops-workspace/plans/preference-evolution/2026-09-09-CHAMELEON-build-plan.md (§3)
-- Note: pref_signals carries an extra ts_bucket column vs plan §3 — the worker's
-- idempotency key is (session_id, consumer_key, action, ts_bucket, variant_id) per plan §4.
-- Retention: signals purged after 90d by the evolver (M3); outcomes + pref_state retained.

CREATE TABLE IF NOT EXISTS pref_consumers (
  user_id TEXT NOT NULL, consumer_key TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')), last_seen_at TEXT,
  PRIMARY KEY (user_id, consumer_key)
);

CREATE TABLE IF NOT EXISTS pref_signals (          -- raw behavioral events
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  ts_bucket TEXT NOT NULL DEFAULT (datetime('now')),
  user_id TEXT NOT NULL, session_id TEXT NOT NULL,
  consumer_key TEXT NOT NULL, variant_id INTEGER,
  action TEXT NOT NULL,                             -- view|scroll|click|copy|save|reply|abandon|open
  ctx_json TEXT                                     -- device, viewport, hour, entry, etc.
);
CREATE INDEX IF NOT EXISTS idx_pref_sig_variant ON pref_signals(variant_id);
CREATE INDEX IF NOT EXISTS idx_pref_sig_user_ts  ON pref_signals(user_id, ts);
CREATE INDEX IF NOT EXISTS idx_pref_sig_dedupe   ON pref_signals(session_id, consumer_key, action, ts_bucket);

CREATE TABLE IF NOT EXISTS pref_variants (          -- every served output is logged
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL, consumer_key TEXT NOT NULL,
  arm_id TEXT NOT NULL,                             -- e.g. 'dense_bullets', 'sparse_prose'
  content_spec TEXT, content_hash TEXT, prompt_hash TEXT,
  ctx_json TEXT, served_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pref_outcomes (          -- normalized reward, NOT raw engagement
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  variant_id INTEGER NOT NULL,
  outcome REAL NOT NULL,                            -- composite reward, see plan §5
  outcome_type TEXT NOT NULL, weight REAL NOT NULL DEFAULT 1.0,
  ts TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pref_state (             -- Thompson-sampling posterior per arm
  user_id TEXT NOT NULL, consumer_key TEXT NOT NULL, arm_id TEXT NOT NULL,
  alpha REAL NOT NULL DEFAULT 1.0, beta REAL NOT NULL DEFAULT 1.0,
  trials INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, consumer_key, arm_id)
);

CREATE TABLE IF NOT EXISTS pref_grammar (           -- the evolving rendering grammar
  version_id INTEGER PRIMARY KEY AUTOINCREMENT,
  active INTEGER NOT NULL DEFAULT 0,                -- one active row
  arm_id TEXT NOT NULL,
  grammar_json TEXT NOT NULL,                       -- design tokens + structure template
  changed_by TEXT NOT NULL,                         -- 'evolver' | 'owner-review'
  snapshot_r2_key TEXT,
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pref_drift (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  user_id TEXT, consumer_key TEXT, metric TEXT NOT NULL,
  value REAL NOT NULL, threshold REAL NOT NULL,
  action TEXT NOT NULL                              -- 'none' | 'froze_arm' | 'filed_issue'
);
