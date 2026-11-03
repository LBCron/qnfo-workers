-- FALSE-STOP-DISPOSITION-1 (2026-11-03, pillar autonomy; false_stops_7d)
-- Refusal-with-reason phrases are dispositions, not false stops. The existing v_false_stop_candidates
-- view excludes an entire reply whenever any disposition phrase appears, before considering reply phrases.
-- Seed the missing shapes and move already-counted matching hits to an audit table so the active ledger
-- reflects the same classification immediately. Bare conditional offers remain eligible.
--
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: false_stop_hits_dispositioned
-- Rollback: INSERT OR IGNORE INTO false_stop_hits (id, ts, source, reply_id, reply_ts, pattern_key, phrase, excerpt) SELECT id, ts, source, reply_id, reply_ts, pattern_key, phrase, excerpt FROM false_stop_hits_dispositioned WHERE migration = 'FALSE-STOP-DISPOSITION-1'; DELETE FROM false_stop_phrases WHERE scope = 'disposition' AND phrase IN ('waiting to be verified', 'wasn''t accepted', 'has to be emailed first', 'requires a d1 delete');

INSERT OR IGNORE INTO false_stop_phrases (phrase, pattern_key, scope) VALUES
  ('waiting to be verified', 'disposition', 'disposition'),
  ('wasn''t accepted', 'disposition', 'disposition'),
  ('has to be emailed first', 'disposition', 'disposition'),
  ('requires a d1 delete', 'disposition', 'disposition');

CREATE TABLE IF NOT EXISTS false_stop_hits_dispositioned (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,
  source TEXT NOT NULL,
  reply_id TEXT NOT NULL,
  reply_ts TEXT,
  pattern_key TEXT NOT NULL,
  phrase TEXT,
  excerpt TEXT,
  disposition_phrases TEXT NOT NULL,
  reclassified_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  migration TEXT NOT NULL
);

INSERT OR IGNORE INTO false_stop_hits_dispositioned
  (id, ts, source, reply_id, reply_ts, pattern_key, phrase, excerpt, disposition_phrases, migration)
SELECT h.id, h.ts, h.source, h.reply_id, h.reply_ts, h.pattern_key, h.phrase, h.excerpt,
       group_concat(d.phrase, ', '), 'FALSE-STOP-DISPOSITION-1'
  FROM false_stop_hits h
  JOIN v_agent_replies r ON r.source = h.source AND r.reply_id = h.reply_id
  JOIN false_stop_phrases d ON d.scope = 'disposition' AND instr(lower(r.body), d.phrase) > 0
 GROUP BY h.id, h.ts, h.source, h.reply_id, h.reply_ts, h.pattern_key, h.phrase, h.excerpt;

DELETE FROM false_stop_hits
 WHERE id IN (SELECT id FROM false_stop_hits_dispositioned WHERE migration = 'FALSE-STOP-DISPOSITION-1');
