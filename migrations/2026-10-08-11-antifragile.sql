-- ANTIFRAGILE-1 (2026-10-08, pillar autonomy). Owner directive 2026-10-08, verbatim: "the system shall audit and remove all
-- such holds, filters, and blocks systemwide across the fleet ... all such blockers and assumptions shall be subject to
-- adversarial red-team never assume an issue is an issue without sufficient adversarial evidence. Workarounds almost always
-- exist. The system shall always build a robust system with redundant paths never a fragile one dependent on a single
-- critical path. The system shall track and regularly check all issue dates and shall immediately flag and remediate those
-- over one cycle/run/day old (and/or one tick). The system shall continuously and aggressivlely root out and eliminate false
-- beliefs and incorrect assumptions. Independent autonomy is now a bare minimum, aggressive robustness and anti-fragility
-- shall also be integrated systemwide across the fleet."
--
-- Done by session_01CWLpf5v1NjC9GXbM6rnH4k before this file (data, backup bak_20261008_hold_release, reverts in each row):
-- 19 research_queue owner_hold rows and 8 rows parked after model outages re-queued; 31 held ideas (2 owner notebook, 29
-- re-entry) accepted and queued. Code holds filed as code-tasks #2173 (owner score bar) and #2174 (re-entry expiry becomes a
-- 2/day rate limit); the single-path research executor as #2175. False belief corrected: card cf-dns-redirect-token said no
-- fleet token could write routes; the repository token had done so on 2026-10-02 (CLAUDE.md, QUEUE-SLA-1 PR).
--
-- This file makes the rest continuous (all on Cloudflare; runs on queue_sla_tick_10m's heartbeat row, QUEUE-SLA-1):
-- (1) Issue dates: v_issue_age lists every open issue with its age in minutes and hours. An issue open more than 24 hours
--     whose priority is low or medium rises one level per 24 hours (issue_age_bumps is the ledger and the revert), so the
--     master queue v_issue_queue serves it before newer work. Critical is never set by age; high is the ceiling.
-- (2) Red team of blockers: v_blocker_claims lists open issues and open owner cards whose text asserts a blocker ("owner
--     only", "needs a token", "no token", "needs the owner", "cannot be done", "blocked", "session-task:") that is older
--     than 60 minutes and has no blocker_redteam verdict in 24 hours. Metric unverified_blocker_claims (target 0); its
--     trigger tells the doer to attempt the action with the credentials and paths that exist and record the result.
-- (3) Research backlog age: queue_sla row research-queued-age (SLA 180 min); v_stuck_summary.research_queued_180m (QUEUE-SLA-1
--     file) counts it in stuck_items_over_sla, so a queue the single executor cannot drain is a breach until #2175 adds the
--     second path. (Kept in the view, not in this trigger: two triggers on one insert fire in no guaranteed order.)
-- (4) Metric issues_open_over_24h (target 0) with a trigger naming the escalation ladder.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DROP TRIGGER IF EXISTS antifragile_tick_10m; DROP VIEW IF EXISTS v_blocker_claims; DROP VIEW IF EXISTS v_issue_age; UPDATE agent_issues SET priority = (SELECT b.from_priority FROM issue_age_bumps b WHERE b.issue_id = agent_issues.id ORDER BY b.id LIMIT 1) WHERE id IN (SELECT issue_id FROM issue_age_bumps); DELETE FROM metric_registry WHERE metric IN ('unverified_blocker_claims', 'issues_open_over_24h'); DELETE FROM analytics_metric_triggers WHERE metric_key IN ('unverified_blocker_claims', 'issues_open_over_24h'); DELETE FROM queue_sla WHERE stuck_type = 'research-queued-age'; -- issue_age_bumps and blocker_redteam are ledgers and stay.

CREATE TABLE IF NOT EXISTS issue_age_bumps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id INTEGER NOT NULL,
  from_priority TEXT,
  to_priority TEXT NOT NULL,
  age_h INTEGER,
  ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_issue_age_bumps_issue ON issue_age_bumps (issue_id, ts);

CREATE TABLE IF NOT EXISTS blocker_redteam (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target TEXT NOT NULL,
  claim TEXT,
  attempt TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('false-belief-removed', 'confirmed-with-evidence', 'workaround-built')),
  evidence TEXT NOT NULL,
  actor TEXT,
  ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

INSERT OR IGNORE INTO queue_sla (stuck_type, queue, definition, cycle_min, sla_min, auto_fix, owner, summary_column) VALUES
 ('research-queued-age', 'research_queue', 'status queued for more than 180 min (the executor cannot drain the queue)', 15, 180,
  'none automatic yet: the second executor path is RESEARCH-THROUGHPUT-1 (#2175); the stuck metric carries the breach', 'qnfo-research-exec', 'research_queued_180m'),
 ('issue-over-a-day', 'agent_issues', 'open issue older than 24 h', 60, 1440,
  'escalate priority one level per 24 h (low -> medium -> high), ledger issue_age_bumps', 'qnfo-fleet-control', 'issues_open_over_24h'),
 ('blocker-unverified', 'agent_issues + human_actions', 'a blocker claim older than 60 min with no blocker_redteam verdict in 24 h', 60, 60,
  'none automatic: the metric trigger asks for the adversarial attempt and its recorded verdict', 'qnfo-ops', 'unverified_blocker_claims');

CREATE VIEW IF NOT EXISTS v_issue_age AS
SELECT a.id, a.priority, a.title,
  CAST(((CAST(strftime('%s', 'now') AS INTEGER) * 1000) - a.created_at) / 60000 AS INTEGER) AS age_min,
  CAST(((CAST(strftime('%s', 'now') AS INTEGER) * 1000) - a.created_at) / 3600000 AS INTEGER) AS age_h,
  (SELECT MAX(b.ts) FROM issue_age_bumps b WHERE b.issue_id = a.id) AS last_bump
FROM agent_issues a WHERE a.status = 'open';

CREATE VIEW IF NOT EXISTS v_blocker_claims AS
SELECT 'issue:' || a.id AS target, a.title AS text, a.created_at AS created_ms FROM agent_issues a
WHERE a.status = 'open' AND a.created_at < (CAST(strftime('%s', 'now') AS INTEGER) - 3600) * 1000
  AND (lower(a.title || ' ' || COALESCE(a.description, '')) LIKE '%owner only%' OR lower(a.title || ' ' || COALESCE(a.description, '')) LIKE '%owner-only%'
    OR lower(a.title || ' ' || COALESCE(a.description, '')) LIKE '%needs a token%' OR lower(a.title || ' ' || COALESCE(a.description, '')) LIKE '%no token%'
    OR lower(a.title || ' ' || COALESCE(a.description, '')) LIKE '%needs the owner%' OR lower(a.title || ' ' || COALESCE(a.description, '')) LIKE '%cannot be done%'
    OR lower(a.title || ' ' || COALESCE(a.description, '')) LIKE '%blocked%' OR lower(COALESCE(a.description, '')) LIKE '%session-task:%')
  AND NOT EXISTS (SELECT 1 FROM blocker_redteam r WHERE r.target = 'issue:' || a.id AND (r.ts > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-24 hours') OR (r.verdict = 'confirmed-with-evidence' AND r.ts = (SELECT MAX(ts) FROM blocker_redteam r2 WHERE r2.target = r.target))))
UNION ALL
SELECT 'card:' || h.id, h.title, CAST(strftime('%s', h.created_at) AS INTEGER) * 1000 FROM human_actions h
WHERE h.status = 'open' AND datetime(h.created_at) < datetime('now', '-60 minutes')
  AND NOT EXISTS (SELECT 1 FROM blocker_redteam r WHERE r.target = 'card:' || h.id AND (r.ts > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-24 hours') OR (r.verdict = 'confirmed-with-evidence' AND r.ts = (SELECT MAX(ts) FROM blocker_redteam r2 WHERE r2.target = r.target))));

INSERT OR IGNORE INTO metric_registry (metric, layer, kind, formula, source_of_truth, baseline, target, owner, disposition_actor, refresh_cadence, warning_band, kill_band, last_value, last_refreshed, state, refresh_class) VALUES
 ('unverified_blocker_claims', 'operational', 'guard',
  'COUNT of v_blocker_claims: open issues asserting a blocker and open owner cards, older than 60 minutes, with no blocker_redteam verdict in 24 hours (ANTIFRAGILE-1).',
  'qnfo-audit.v_blocker_claims (migrations/2026-10-08-11-antifragile.sql), refreshed every 10 minutes by trigger antifragile_tick_10m',
  '39 on 2026-10-08 (33 issues, 6 owner cards)', '0', 'qnfo-ops',
  'trigger gt 0 -> one METRIC-TRIGGER issue asking for the adversarial attempt on each claim', '10m', '> 0', '> 20',
  NULL, NULL, 'MEASURED', 'computed'),
 ('issues_open_over_24h', 'operational', 'target',
  'COUNT of v_issue_age with age_h >= 24 (ANTIFRAGILE-1). The ladder raises their priority one level per 24 h.',
  'qnfo-audit.v_issue_age (migrations/2026-10-08-11-antifragile.sql), refreshed every 10 minutes by trigger antifragile_tick_10m',
  '97 of 136 on 2026-10-08', '0', 'qnfo-fleet-control',
  'trigger gt 0 -> one METRIC-TRIGGER issue', '10m', '> 0', '> 50',
  NULL, NULL, 'MEASURED', 'computed');

CREATE TRIGGER IF NOT EXISTS antifragile_tick_10m AFTER INSERT ON fleet_tick
BEGIN
  -- (1) the age ladder: one level per 24 h, never to critical, never twice inside 24 h.
  INSERT INTO issue_age_bumps (issue_id, from_priority, to_priority, age_h)
    SELECT id, priority, CASE lower(priority) WHEN 'low' THEN 'medium' ELSE 'high' END, age_h FROM v_issue_age
    WHERE COALESCE((SELECT value FROM ops_config WHERE key = 'queue_sla_autofix'), 'on') <> 'off'
      AND age_h >= 24 AND lower(COALESCE(priority, 'medium')) IN ('low', 'medium', 'p3', 'p4', 'p5', 'trivial')
      AND (last_bump IS NULL OR last_bump < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-24 hours'));
  UPDATE agent_issues SET priority = (SELECT b.to_priority FROM issue_age_bumps b WHERE b.issue_id = agent_issues.id ORDER BY b.id DESC LIMIT 1),
      updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
  WHERE status = 'open' AND id IN (SELECT issue_id FROM issue_age_bumps WHERE ts >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-1 minutes'));
  -- metrics.
  UPDATE metric_registry SET last_value = CAST((SELECT COUNT(*) FROM v_blocker_claims) AS TEXT),
      last_refreshed = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), state = 'MEASURED' WHERE metric = 'unverified_blocker_claims';
  UPDATE metric_registry SET last_value = CAST((SELECT COUNT(*) FROM v_issue_age WHERE age_h >= 24) AS TEXT),
      last_refreshed = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), state = 'MEASURED' WHERE metric = 'issues_open_over_24h';
END;

INSERT INTO analytics_metric_triggers (metric_key, title, source_table, operator, threshold, priority, action, owner, queue_target, cooldown_hours, enabled, notes)
SELECT 'unverified_blocker_claims', 'Red team: blocker claims nobody has tested adversarially', 'registry', 'gt', 0, 2,
  'Pillar autonomy (ANTIFRAGILE-1). A blocker is a belief until an attempt proves it. Read SELECT * FROM v_blocker_claims. For each target: attempt the blocked action with what exists (the repository CLOUDFLARE_API_TOKEN through a workflow or scripts/cf_ops_actions.py, the service bindings, the code loop, the D1 tools), or build a workaround through a second path. Then INSERT INTO blocker_redteam (target, claim, attempt, verdict, evidence, actor): verdict false-belief-removed (the claim was wrong; remove the hold, card or session-task line and say so on the item), workaround-built (name the second path), or confirmed-with-evidence (the exact refusal: status code, error body, who refused; only then may the item stay with the owner). Never record confirmed without the refusal text. Definition of done: unverified_blocker_claims = 0 at a refresh.',
  'qnfo-ops', 'agent_issues', 1, 1, 'ANTIFRAGILE-1 (migrations/2026-10-08-11-antifragile.sql)'
WHERE NOT EXISTS (SELECT 1 FROM analytics_metric_triggers x WHERE x.metric_key = 'unverified_blocker_claims');

INSERT INTO analytics_metric_triggers (metric_key, title, source_table, operator, threshold, priority, action, owner, queue_target, cooldown_hours, enabled, notes)
SELECT 'issues_open_over_24h', 'Issue age: open issues older than one day', 'registry', 'gt', 0, 3,
  'Pillar autonomy (ANTIFRAGILE-1). Read SELECT * FROM v_issue_age WHERE age_h >= 24 ORDER BY age_h DESC. The ladder already raised their priority. For each, in order: (1) no doer (no code-task line, no active probe, no claim): give it one now (a code-task: and code-anchor: line for a one-file change, else a named owning loop and an issue claim); (2) a doer that failed: read the failure (code_tasks.merge_note, the probe verdicts) and change the lever, never repeat it; (3) a blocker claim: red-team it (v_blocker_claims). Close only with live evidence. Definition of done: issues_open_over_24h lower than at filing at every refresh, then 0.',
  'qnfo-fleet-control', 'agent_issues', 6, 1, 'ANTIFRAGILE-1 (migrations/2026-10-08-11-antifragile.sql)'
WHERE NOT EXISTS (SELECT 1 FROM analytics_metric_triggers x WHERE x.metric_key = 'issues_open_over_24h');
