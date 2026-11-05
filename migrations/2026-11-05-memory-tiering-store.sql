-- MEMORY-TIERING-STORE-1 (2026-11-05, charter pillar autonomy, program QNFO.INFRA; agent_issues 1000637 = GitHub 5687, roadmap_implementation 1681 = GitHub 5558).
-- qnfo-memory-mcp advertised two MCP tools with no handler since PR 6364 (2026-11-02): memory_outcome and memory_tiering_metrics answered "Unknown tool". 2.9.0 implements them. Their store
-- lives here, in qnfo-audit (the worker has the AUDIT binding; the migration runner only reaches this database): memory_outcomes (one success or failure per memory_id and feedback_id),
-- memory_tier_counts (an hourly snapshot of agent_memories by tier and role, written by the worker's cron) and memory_consolidation_runs (empty: consolidation is not built).
-- The views are the "view of consolidation row counts and the retrieval hit-rate before and after" that agent_issues 1000637 names as its definition of done.
-- The closing probe of issue-1000637 (docs/MEMORY-TIERING-EVAL.md carries the heading for the 30 day result) is not touched: its measurement is 30 days away.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_f1e_memory
-- Rollback: DROP VIEW IF EXISTS v_memory_tiering; DROP VIEW IF EXISTS v_memory_outcome_hit_rate; DROP VIEW IF EXISTS v_memory_tier_latest; DROP TABLE IF EXISTS memory_consolidation_runs; DROP TABLE IF EXISTS memory_tier_counts; DROP TABLE IF EXISTS memory_outcomes; UPDATE agent_issues SET description = (SELECT b.description FROM bak_20261105_f1e_memory b WHERE b.id = 1000637) WHERE id = 1000637 AND EXISTS (SELECT 1 FROM bak_20261105_f1e_memory WHERE id = 1000637); DELETE FROM failure_modes WHERE fm_key = 'mcp-advertised-tool-no-handler'; DELETE FROM remediation_contracts WHERE class = 'fm-mcp-advertised-tool-no-handler'; UPDATE agent_issues SET status = 'closed' WHERE title LIKE 'ROADMAP-1: QNFO.INFRA #memory-consolidation:%' AND status = 'open' AND EXISTS (SELECT 1 FROM issue_triage WHERE issue_id = agent_issues.id AND close_evidence IS NOT NULL);
-- CAUSE-MAPPED: registers no metric_registry row.
-- spof-review: three new tables and three views read by one worker and by whoever reads the hit rate; no new loop, cron or gate (the hourly snapshot joins the existing cron of qnfo-memory-mcp).

CREATE TABLE IF NOT EXISTS bak_20261105_f1e_memory AS SELECT id, description FROM agent_issues WHERE id = 1000637;

CREATE TABLE IF NOT EXISTS memory_outcomes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure')),
  feedback_id TEXT NOT NULL,
  provenance TEXT,
  ts TEXT NOT NULL,
  UNIQUE (memory_id, feedback_id)
);
CREATE INDEX IF NOT EXISTS idx_memory_outcomes_ts ON memory_outcomes (ts);

CREATE TABLE IF NOT EXISTS memory_tier_counts (
  ts TEXT NOT NULL,
  tier TEXT NOT NULL,
  role TEXT NOT NULL,
  n INTEGER NOT NULL,
  oldest TEXT,
  newest TEXT,
  PRIMARY KEY (ts, tier, role)
);

CREATE TABLE IF NOT EXISTS memory_consolidation_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  kind TEXT NOT NULL,
  episodic_in INTEGER NOT NULL DEFAULT 0,
  semantic_out INTEGER NOT NULL DEFAULT 0,
  note TEXT
);

CREATE VIEW IF NOT EXISTS v_memory_tier_latest AS
SELECT t.ts AS ts, t.tier AS tier, t.role AS role, t.n AS n, t.oldest AS oldest, t.newest AS newest
FROM memory_tier_counts t
WHERE t.ts = (SELECT MAX(ts) FROM memory_tier_counts);

CREATE VIEW IF NOT EXISTS v_memory_outcome_hit_rate AS
SELECT w.window_days AS window_days,
       COALESCE(SUM(CASE WHEN o.outcome = 'success' THEN 1 ELSE 0 END), 0) AS successes,
       COALESCE(SUM(CASE WHEN o.outcome = 'failure' THEN 1 ELSE 0 END), 0) AS failures,
       CASE WHEN COUNT(o.id) > 0 THEN ROUND(1.0 * SUM(CASE WHEN o.outcome = 'success' THEN 1 ELSE 0 END) / COUNT(o.id), 4) END AS hit_rate
FROM (SELECT 7 AS window_days UNION ALL SELECT 30) w
LEFT JOIN memory_outcomes o ON o.ts >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-' || w.window_days || ' days')
GROUP BY w.window_days;

CREATE VIEW IF NOT EXISTS v_memory_tiering AS
SELECT (SELECT MAX(ts) FROM v_memory_tier_latest) AS snapshot_ts,
       (SELECT COALESCE(SUM(n), 0) FROM v_memory_tier_latest WHERE tier <> 'semantic') AS episodic_rows_effective,
       (SELECT COALESCE(SUM(n), 0) FROM v_memory_tier_latest WHERE tier = 'untiered') AS untiered_rows,
       (SELECT COALESCE(SUM(n), 0) FROM v_memory_tier_latest WHERE tier = 'semantic') AS semantic_rows,
       (SELECT COUNT(*) FROM memory_consolidation_runs) AS consolidation_runs,
       (SELECT COALESCE(SUM(episodic_in), 0) FROM memory_consolidation_runs) AS episodic_consolidated,
       (SELECT COALESCE(SUM(semantic_out), 0) FROM memory_consolidation_runs) AS semantic_produced,
       (SELECT successes + failures FROM v_memory_outcome_hit_rate WHERE window_days = 7) AS outcomes_7d,
       (SELECT hit_rate FROM v_memory_outcome_hit_rate WHERE window_days = 7) AS hit_rate_7d,
       (SELECT successes + failures FROM v_memory_outcome_hit_rate WHERE window_days = 30) AS outcomes_30d,
       (SELECT hit_rate FROM v_memory_outcome_hit_rate WHERE window_days = 30) AS hit_rate_30d;

UPDATE agent_issues
SET description = description || char(10) || char(10) ||
  'STATE (MEMORY-TIERING-STORE-1, 2026-11-05, session F1-research-reach/E): the FIRST STEP above is on main since 2026-10-28 (PR 5167, code task ct_im1000637: tier and role in metadata_json) but had no test and no marker, and nothing used it: agent_memories held 647 rows, the newest written 2026-10-25, none with a tier (measured 2026-11-05). PR 6364 (2026-11-02) then advertised memory_outcome and memory_tiering_metrics and an outcome-weighted search_memories with no handler behind them. qnfo-memory-mcp 2.9.0 validates tier (episodic only; semantic rows come from consolidation), keeps role and provenance in metadata_json, returns tier and role from search_memories, implements memory_outcome (idempotent per memory_id and feedback_id) and memory_tiering_metrics, adds search_memories rank=weighted (mild age decay and outcome factor; the default stays the vector order), and snapshots the tier counts hourly. This migration creates the store and the views v_memory_tier_latest, v_memory_outcome_hit_rate and v_memory_tiering (the consolidation counts and the 7 and 30 day hit rates). Remaining: consolidation of episodic rows into semantic rows and the decay policy (follow-up ROADMAP-1: QNFO.INFRA #memory-consolidation, gated on the tool being used), and the measured result at 7 and 30 days written to docs/MEMORY-TIERING-EVAL.md by the QNFO.OPS roadmap lane, which is what the closing probe reads (earliest 30 days after the first recorded outcome). Baseline and reading guide: docs/MEMORY-TIERING-EVAL.md. Not verified: a live remember_fact, memory_outcome or search_memories call after the deploy.',
    updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE id = 1000637 AND instr(description, 'STATE (MEMORY-TIERING-STORE-1') = 0;

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.INFRA #memory-consolidation: consolidate episodic memories into semantic rows and decay stale ones, once the memory tools are used',
       'Charter pillar: autonomy. Program QNFO.INFRA. Parent: agent_issues 1000637 (RM-MEMORY-TIERING-1, GitHub 5687). Metric to move: the 7 and 30 day outcome hit rate in v_memory_tiering (hit_rate_7d, hit_rate_30d), with episodic_consolidated and semantic_produced as the consolidation counts.' || char(10) ||
       'START ONLY WHEN the first step is in use: SELECT * FROM v_memory_tiering returns episodic_rows_effective above 700 (647 rows existed on 2026-11-05, newest 2026-10-25) or outcomes_7d of 20 or more. If neither holds 14 days after the 2.9.0 deploy, stop and record on the parent issue that the premise (a flat memory in use) does not hold, with the two numbers; retirement of the feature then goes through the standing owner grant, not through building consolidation for a table nobody writes.' || char(10) ||
       'Change: an hourly bounded step in qnfo-memory-mcp (at most 20 episodic rows older than 7 days per run, grouped by category and session_id, at least 3 rows per group) that asks a cheap Workers AI model for one summary row per group, writes it as tier semantic with role consolidation and provenance listing the source ids (INSERT into agent_memories and an embedding upsert, as remember_fact does), marks the sources with metadata consolidated_into (never deletes them), and inserts one memory_consolidation_runs row per run. A decay policy comes second: episodic rows consolidated for 30 days are left out of search_memories unless asked (a filter, nothing is removed). Test offline with stub GRAPH_DB, AUDIT, PAPER_VZ and AI as in qnfo-memory-mcp/memory-tiering.test.mjs; compare hit_rate_7d before and after with the same query set.' || char(10) ||
       'Definition of done: memory_consolidation_runs has runs with semantic_produced above 0, search_memories can return semantic rows, and the 7 day hit rate is recorded before and after in docs/MEMORY-TIERING-EVAL.md.' || char(10) ||
       'code-task: repo=qnfo-workers path=qnfo-memory-mcp/worker.js' || char(10) ||
       'code-anchor: async function memoryTierSnapshot(env) {',
       'claude-session', 'reliability', 'medium', 'open', CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.INFRA #memory-consolidation:%');

INSERT OR IGNORE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module, budget_ms, max_items, requires_container)
SELECT 'issue-' || a.id, a.id, 'qnfo-memory-mcp 2.9.0 is deployed and the memory tools are in use', 'Consolidate episodic memories into semantic rows and record the run in memory_consolidation_runs',
       'SELECT ''ok'' AS expected, ''pending'' AS observed', 'd1-query', 3, 'qnfo-memory-mcp', 24, 'active', 'issue', 45000, 5, 0
FROM agent_issues a WHERE a.title LIKE 'ROADMAP-1: QNFO.INFRA #memory-consolidation:%';

UPDATE remediation_contracts
SET verify_probe = 'SELECT ''ok'' AS expected, CASE WHEN EXISTS (SELECT 1 FROM memory_consolidation_runs WHERE semantic_out > 0) THEN ''ok'' ELSE ''no consolidation run with semantic_out above 0, runs: '' || (SELECT COUNT(*) FROM memory_consolidation_runs) END AS observed',
    verify_transport = 'd1-query'
WHERE class = 'issue-' || (SELECT id FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.INFRA #memory-consolidation:%' LIMIT 1);

INSERT OR IGNORE INTO failure_modes (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id, trigger_condition, symptom, blast_radius)
VALUES ('mcp-advertised-tool-no-handler', 'an MCP server lists a tool in tools/list that its dispatcher has no handler for',
  'PR 6364 added the contracts of memory_outcome and memory_tiering_metrics to the TOOLS array of qnfo-memory-mcp in a change that included no handler, so the tools answered "Unknown tool" while the server and its description claimed outcome-weighted retrieval',
  'every advertised tool name has a handler in callTool; qnfo-memory-mcp/memory-tiering.test.mjs fails when TOOLS and the dispatcher differ',
  'fm-mcp-advertised-tool-no-handler', 'fm-mcp-advertised-tool-no-handler', '2026-11-05', 1000637,
  'a tool is added to TOOLS without a handler in callTool', 'tools/call returns isError "Unknown tool: <name>" for a listed tool',
  'agents that read tools/list and call memory_outcome or memory_tiering_metrics');

INSERT OR IGNORE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module, budget_ms, max_items, requires_container)
VALUES ('fm-mcp-advertised-tool-no-handler', 1000637, 'qnfo-memory-mcp 2.9.0 is merged', 'Keep every tool in the TOOLS array of qnfo-memory-mcp bound to a handler in callTool',
  '{"paths": ["qnfo-memory-mcp/worker.js"], "contains": "memory_tiering_metrics: tool_memory_tiering_metrics"}', 'code-read', 3, 'qnfo-memory-mcp', 24, 'active', 'failure-mode', 45000, 5, 0);

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session F1-research-reach/E (2026-11-04 open-issue sweep)',
       'a tool that is listed but cannot be called is worse than a tool that is not listed, and a retrieval-quality item needs outcome records before any consolidation can be judged',
       'MEMORY-TIERING-STORE-1: implement memory_outcome and memory_tiering_metrics in qnfo-memory-mcp 2.9.0, store outcomes and hourly tier counts in qnfo-audit, file consolidation as a gated ROADMAP-1 row',
       'agent_memories held 647 rows, newest 2026-10-25, none with a tier; callTool had no handler for the two tools PR 6364 advertised; the closing probe of issue-1000637 needs a measured 30 day result',
       'qnfo-memory-mcp 2.9.0 plus three tables and three views in qnfo-audit; search_memories default order unchanged',
       'qnfo-memory-mcp tools/list and tools/call, qnfo-audit memory_* tables; the open fleet-graph API is untouched',
       'revert the PR; Rollback line of migrations/2026-11-05-memory-tiering-store.sql drops the tables and views and restores the issue description',
       'outcome records exist, so a retrieval hit rate can be measured before and after consolidation',
       'within 24 hours of the deploy v_memory_tiering has a snapshot_ts and episodic_rows_effective of at least 647; outcomes_7d stays 0 until an agent calls memory_outcome',
       'no external reach change',
       'qnfo-memory-mcp/memory-tiering.test.mjs (stub GRAPH_DB, AUDIT, PAPER_VZ, AI); migrations/memory-tiering-store.test.mjs (views on SQLite)'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'MEMORY-TIERING-STORE-1:%');
