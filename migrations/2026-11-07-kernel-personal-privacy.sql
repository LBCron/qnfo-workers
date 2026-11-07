-- KERNEL-PERSONAL-PRIVACY-1 (PR #8469): personal reply text stays in PERSONAL.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261107_kernel_public_views
-- Rollback: SELECT 1;
-- Rollback intentionally retains the privacy-safe views. The worker can revert to
-- personal-api 4.36.2 (before mirroring); never restore personal-text mirroring.
-- The earlier migration was applied live before review. Replace its shared personal
-- text branch; the new writer classifies locally and emits only allowlisted categories
-- to false_stop_hits, preserving the existing metric and remediation consumers.
-- No personal rows are read, copied, modified or deleted. The legacy personal_replies
-- table is left untouched; the backup contains view definitions only, not their rows.
-- Reapplying is idempotent. No new trigger, cron, binding, metric or credential.

CREATE TABLE IF NOT EXISTS bak_20261107_kernel_public_views AS
SELECT name, sql FROM sqlite_master
WHERE type = 'view' AND name IN ('v_agent_replies', 'v_false_stop_candidates');

DROP VIEW IF EXISTS v_false_stop_candidates;
DROP VIEW IF EXISTS v_agent_replies;

CREATE VIEW v_agent_replies AS
SELECT source, reply_id, reply_ts, body FROM (
  SELECT 'ops_ai_log' AS source, id AS reply_id, replace(substr(ts, 1, 19), 'T', ' ') AS reply_ts, COALESCE(response, '') AS body
    FROM ops_ai_log WHERE COALESCE(response, '') <> '' AND COALESCE(completion_tokens, 0) NOT IN (8000, 8192)
  UNION ALL
  SELECT 'owner_prompts', id, replace(substr(ts, 1, 19), 'T', ' '), COALESCE(response, '')
    FROM owner_prompts WHERE COALESCE(response, '') <> ''
  UNION ALL
  SELECT 'session_records', session_id, replace(substr(created_at, 1, 19), 'T', ' '), COALESCE(summary, '') || ' ' || COALESCE(handoff_notes, '')
    FROM session_records
)
UNION ALL
SELECT source, reply_id, reply_ts, body FROM (
  SELECT 'ask_events' AS source, id AS reply_id, replace(substr(ts, 1, 19), 'T', ' ') AS reply_ts, COALESCE(answer, '') AS body
    FROM ask_events WHERE COALESCE(answer, '') <> ''
  UNION ALL
  SELECT 'chatbox_conversations', id, replace(substr(ts, 1, 19), 'T', ' '), COALESCE(response, '')
    FROM chatbox_conversations WHERE source = 'chatbox' AND COALESCE(response, '') <> ''
);

CREATE VIEW v_false_stop_candidates AS
SELECT r.source, r.reply_id, r.reply_ts, p.pattern_key, p.phrase,
       substr(r.body, MAX(1, instr(lower(r.body), p.phrase) - 60), 200) AS excerpt
  FROM v_agent_replies r JOIN false_stop_phrases p ON p.scope = 'reply'
       AND instr(replace(replace(lower(r.body), '"' || p.phrase || '"', ''), char(96) || p.phrase || char(96), ''), p.phrase) > 0
  WHERE NOT EXISTS (SELECT 1 FROM false_stop_phrases d WHERE d.scope = 'disposition' AND instr(lower(r.body), d.phrase) > 0)
UNION ALL
SELECT r.source, r.reply_id, r.reply_ts, 'report-as-question', '?', substr(r.body, MAX(1, length(r.body) - 200), 201)
  FROM v_agent_replies r
  WHERE substr(rtrim(r.body, ' ' || char(9) || char(10) || char(13)), -1) = '?'
    AND NOT EXISTS (SELECT 1 FROM false_stop_phrases d WHERE d.scope = 'disposition' AND instr(lower(r.body), d.phrase) > 0)
UNION ALL
SELECT 'owner_prompts.prompt', o.id, replace(substr(o.ts, 1, 19), 'T', ' '), p.pattern_key, p.phrase,
       substr(o.prompt, MAX(1, instr(lower(o.prompt), p.phrase) - 60), 200)
  FROM owner_prompts o JOIN false_stop_phrases p ON p.scope = 'user' AND instr(lower(COALESCE(o.prompt, '')), p.phrase) > 0;
