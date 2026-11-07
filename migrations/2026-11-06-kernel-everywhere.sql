-- KERNEL-EVERYWHERE-1 (2026-11-06, owner directive 2026-11-06: "IMPLEMENT EVERYWHERE ACROSS ALL AI APPS AND SERVICES AND SURFACES"
-- and "APPLY TO ALL LLM APPS, ALL AGENTS, ALL CODE, ALL CLOUD SERVICES, ALL REPOS"; charter pillar: autonomy).
-- The kernel implementation map (docs/DOCTRINE-KERNEL.md) recorded a known gap: "personal-api twin replies are not stored
-- in qnfo-audit and are not scanned". This migration closes it:
--   1. doctrine_lineage records the propagation event (kernel 8.2.1 text unchanged; the wiring widens).
--   2. personal-api (4.37.0 KERNEL-EVERYWHERE-1) mirrors each twin reply to qnfo-audit.personal_replies
--      (bounded text, assistant replies only, tool-trace rows excluded).
--   3. v_agent_replies gains the personal_replies branch, so the hourly false_stop_hits scan
--      (FALSE-STOP-SCAN-1, kernel-registries v_false_stop_candidates) covers the twin like ops_ai_log, ask_events and
--      chatbox_conversations. The disposition exclusion (readings n and p) is unchanged.
-- No new cron, no new metric, no model call. Metric false_stops_7d is unchanged and now counts personal_replies rows.
-- BACKUP: v_false_stop_candidates
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM doctrine_lineage WHERE version = 'kernel-8.2.1-everywhere'; DROP VIEW IF EXISTS v_false_stop_candidates; DROP VIEW IF EXISTS v_agent_replies; then re-run the CREATE VIEW statements of migrations/2026-10-27-false-stop-reply-scope.sql; DROP TABLE IF EXISTS personal_replies (personal-api mirrors fail soft while it is absent).

INSERT OR IGNORE INTO doctrine_lineage (version, adopted_at, source, file, parent, note) VALUES
 ('kernel-8.2.1-everywhere', '2026-11-06', 'owner directive 2026-11-06 (implement everywhere; apply to all LLM apps, agents, code, cloud services, repos)', 'docs/DOCTRINE-KERNEL.md', 'kernel-8.2.1', 'KERNEL-EVERYWHERE-1: kernel recognitions wired into personal-api (twin SYSTEM_PROMPT), personal-companion (planner chat), qnfo-ai-search (Ask writer), qnfo-research-exec (shared preamble, KERNEL-PRODUCE-1); canonical claude/chatbox system prompts reference the kernel; twin replies mirrored to personal_replies and scanned by v_agent_replies; kernel doc propagated to qnfo-ops and mirror repos. Kernel text unchanged.');

CREATE TABLE IF NOT EXISTS personal_replies (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  source TEXT,
  body TEXT
);
CREATE INDEX IF NOT EXISTS idx_personal_replies_ts ON personal_replies (ts);

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
)
UNION ALL
SELECT 'personal_replies' AS source, id, replace(substr(ts, 1, 19), 'T', ' '), COALESCE(body, '')
  FROM personal_replies WHERE COALESCE(body, '') <> '';

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
