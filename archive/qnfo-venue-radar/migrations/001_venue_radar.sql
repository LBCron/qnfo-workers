-- qnfo-venue-radar migration 001 (QNFO.LW.003, 2026-09-03) - applied to qnfo-audit D1
CREATE TABLE IF NOT EXISTS venue_signal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  venue TEXT NOT NULL,
  external_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'post',
  title TEXT,
  author TEXT,
  url TEXT,
  karma INTEGER,
  date TEXT,
  query TEXT NOT NULL,
  topic TEXT,
  snippet TEXT,
  relevance INTEGER DEFAULT 0,
  raw_hash TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(venue, external_id, query)
);
CREATE INDEX IF NOT EXISTS idx_venue_signal_created ON venue_signal(created_at);
CREATE INDEX IF NOT EXISTS idx_venue_signal_topic ON venue_signal(topic);
CREATE INDEX IF NOT EXISTS idx_venue_signal_venue ON venue_signal(venue);
CREATE TABLE IF NOT EXISTS venue_radar_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  venue TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'scan',
  run_at TEXT NOT NULL,
  status TEXT NOT NULL,
  fetched INTEGER DEFAULT 0,
  kept INTEGER DEFAULT 0,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_venue_runs_runat ON venue_radar_runs(run_at);
CREATE TABLE IF NOT EXISTS venue_radar_config (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT
);
INSERT OR IGNORE INTO venue_radar_config (key, value, updated_at) VALUES
  ('venue_radar_enabled', '1', datetime('now')),
  ('last_run_utc', '', datetime('now')),
  ('review_due_at', '2026-10-03', datetime('now'));
