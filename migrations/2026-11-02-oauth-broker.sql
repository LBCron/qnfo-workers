-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DROP TABLE oauth_broker_records

CREATE TABLE IF NOT EXISTS oauth_broker_records (
  record_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'github', 'slack')),
  data_plane TEXT NOT NULL CHECK (data_plane IN ('personal', 'research')),
  record_type TEXT NOT NULL CHECK (record_type IN ('state', 'token')),
  encrypted_payload TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  lease_until INTEGER NOT NULL DEFAULT 0,
  call_count INTEGER NOT NULL DEFAULT 0,
  last_called_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oauth_broker_refresh
  ON oauth_broker_records (record_type, lease_until, expires_at);
