-- FALSE-STOP-DISPOSITION-2 (2026-11-05, pillar autonomy; GitHub issue 6425 / agent_issues 1001266; false_stops_7d)
-- 2026-11-03 FALSE-STOP-DISPOSITION-1 seeded four refusal-with-reason shapes. Two replies that the contract probe of issue-1001266 names still read as conditional offers
-- (read from qnfo-audit 2026-11-05, probe observed 2 on every verification since): ops-6c7513b0b0ce56 says "that requires a D1 `DELETE`, which is a destructive write I have
-- not performed" (the backticks around DELETE defeat the phrase 'requires a d1 delete'), and ops-1a418c26da88ce quotes the tool answer "no code is waiting; call owner_login for a
-- new one". Both state a refusal and its reason: a disposition, not an autonomy gap. The classifier already prefers the disposition (v_false_stop_candidates drops a whole reply that
-- holds any disposition phrase), so the only missing piece is the phrases. They are kept narrow on purpose: a disposition phrase suppresses EVERY false-stop pattern of its reply,
-- so a broad 'requires a d1' would hide a menu or a question that merely mentions D1.
-- Hits already counted for those replies move to false_stop_hits_dispositioned (migration FALSE-STOP-DISPOSITION-2) as the 2026-11-03 file did; a hit whose reply is a bare offer stays.
--
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: false_stop_hits_dispositioned
-- Rollback: INSERT OR IGNORE INTO false_stop_hits (id, ts, source, reply_id, reply_ts, pattern_key, phrase, excerpt) SELECT id, ts, source, reply_id, reply_ts, pattern_key, phrase, excerpt FROM false_stop_hits_dispositioned WHERE migration = 'FALSE-STOP-DISPOSITION-2'; DELETE FROM false_stop_phrases WHERE scope = 'disposition' AND phrase IN ('requires a d1 `delete`', 'no code is waiting'); DELETE FROM false_stop_hits_dispositioned WHERE migration = 'FALSE-STOP-DISPOSITION-2';

INSERT OR IGNORE INTO false_stop_phrases (phrase, pattern_key, scope) VALUES
  ('requires a d1 `delete`', 'disposition', 'disposition'),
  ('no code is waiting', 'disposition', 'disposition');

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
       group_concat(d.phrase, ', '), 'FALSE-STOP-DISPOSITION-2'
  FROM false_stop_hits h
  JOIN v_agent_replies r ON r.source = h.source AND r.reply_id = h.reply_id
  JOIN false_stop_phrases d ON d.scope = 'disposition' AND d.phrase IN ('requires a d1 `delete`', 'no code is waiting') AND instr(lower(r.body), d.phrase) > 0
 GROUP BY h.id, h.ts, h.source, h.reply_id, h.reply_ts, h.pattern_key, h.phrase, h.excerpt;

DELETE FROM false_stop_hits
 WHERE id IN (SELECT id FROM false_stop_hits_dispositioned WHERE migration = 'FALSE-STOP-DISPOSITION-2');
