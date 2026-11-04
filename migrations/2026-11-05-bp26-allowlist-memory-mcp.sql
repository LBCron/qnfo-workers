-- BP26-ALLOWLIST-MCP-MEMORY-1 (2026-11-05, charter pillar security; BP26 breach agent_tool_calls_outside_allowlist, trigger 14534; practice BP26-PROMPT-INJECTION).
-- WHAT WAS WRONG (measured 2026-11-04T22:17Z, bp26_probe_results subjects of metric agent_tool_calls_outside_allowlist): the metric read 5 = 1 unlisted tool + 4 fetches to 3 hosts.
--   * The tool was `search_papers` (mcp_log 2026-11-02T15:44Z, result {"count":5,...}: it ran and answered). It is a tool of qnfo-memory-mcp. mcp_log is written by TWO workers
--     (qnfo-tools-mcp/worker.js:322 and qnfo-memory-mcp/worker.js:774 both INSERT INTO mcp_log; the table has no server column) and the collector checked every row against the
--     qnfo-tools-mcp list only. agent_tool_allowlist had no qnfo-memory-mcp surface at all, so every qnfo-memory-mcp tool the fleet would ever call was a false breach.
--   * The 4 fetches (web_fetch by the ops model on 2026-10-29: intenseminimalism.com 1, composio.dev 2, verdent.ai 1) are single reads of public articles. They leave the 7-day window on
--     2026-11-05 around 12:23-12:43Z, so the figure falls by itself. The three registrable domains are NOT added: a one-off read does not justify a standing suffix row that would also
--     permit every subdomain (the egress review of 2026-10-28 allowed hosts a worker reads on a schedule, not articles an agent happened to open once).
-- WHAT THIS DOES: lists the 24 tools qnfo-memory-mcp registers (TOOLS array, qnfo-memory-mcp/worker.js, read 2026-11-05) as surface `qnfo-memory-mcp`. scripts/bp26_agentsec.py
--   (same PR) lets a logged MCP call pass when any surface that writes mcp_log lists the tool, so a tool that is on NO list still counts (selftest case `not_a_tool`).
-- PREDICTION: agent_tool_calls_outside_allowlist 5 -> 4 at the next consumer run after the deploy, -> 0 after 2026-11-05T12:45Z when the 2026-10-29 fetches age out, unless the ops
--   model fetches a new host; any new host is a review item (the metric is a review control, not an enforcement point).
-- Revert: the Rollback line removes only the rows this file adds (matched on the note prefix).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM agent_tool_allowlist WHERE surface = 'qnfo-memory-mcp' AND note LIKE 'BP26-ALLOWLIST-MCP-MEMORY-1:%'
-- BACKUP: agent_tool_allowlist
-- CAUSE-MAPPED: no metric is registered here; this adds allow-list rows.
-- spof-review: read only by scripts/bp26_agentsec.py; a missing row leaves the metric above 0, never blocks a tool call (the list is measured, not enforced).

INSERT OR IGNORE INTO agent_tool_allowlist (surface, kind, pattern, note) VALUES
  ('qnfo-memory-mcp', 'tool', 'exuvia_status', 'BP26-ALLOWLIST-MCP-MEMORY-1: registered in qnfo-memory-mcp/worker.js TOOLS on 2026-11-05'),
  ('qnfo-memory-mcp', 'tool', 'exuvia_feed', 'BP26-ALLOWLIST-MCP-MEMORY-1: registered in qnfo-memory-mcp/worker.js TOOLS on 2026-11-05'),
  ('qnfo-memory-mcp', 'tool', 'exuvia_paper_post_draft', 'BP26-ALLOWLIST-MCP-MEMORY-1: registered in qnfo-memory-mcp/worker.js TOOLS on 2026-11-05'),
  ('qnfo-memory-mcp', 'tool', 'exuvia_publish_paper', 'BP26-ALLOWLIST-MCP-MEMORY-1: registered in qnfo-memory-mcp/worker.js TOOLS on 2026-11-05 (write scope: MCP_TOKEN only)'),
  ('qnfo-memory-mcp', 'tool', 'exuvia_kg_context', 'BP26-ALLOWLIST-MCP-MEMORY-1: registered in qnfo-memory-mcp/worker.js TOOLS on 2026-11-05'),
  ('qnfo-memory-mcp', 'tool', 'exuvia_engage', 'BP26-ALLOWLIST-MCP-MEMORY-1: registered in qnfo-memory-mcp/worker.js TOOLS on 2026-11-05 (write scope: MCP_TOKEN only)'),
  ('qnfo-memory-mcp', 'tool', 'search_papers', 'BP26-ALLOWLIST-MCP-MEMORY-1: registered in qnfo-memory-mcp/worker.js TOOLS on 2026-11-05; 1 call 2026-11-02 read as unlisted'),
  ('qnfo-memory-mcp', 'tool', 'search_papers_enriched', 'BP26-ALLOWLIST-MCP-MEMORY-1: registered in qnfo-memory-mcp/worker.js TOOLS on 2026-11-05'),
  ('qnfo-memory-mcp', 'tool', 'resolve_paper_id', 'BP26-ALLOWLIST-MCP-MEMORY-1: registered in qnfo-memory-mcp/worker.js TOOLS on 2026-11-05'),
  ('qnfo-memory-mcp', 'tool', 'search_memories', 'BP26-ALLOWLIST-MCP-MEMORY-1: registered in qnfo-memory-mcp/worker.js TOOLS on 2026-11-05'),
  ('qnfo-memory-mcp', 'tool', 'remember_fact', 'BP26-ALLOWLIST-MCP-MEMORY-1: registered in qnfo-memory-mcp/worker.js TOOLS on 2026-11-05 (write scope: MCP_TOKEN only)'),
  ('qnfo-memory-mcp', 'tool', 'memory_outcome', 'BP26-ALLOWLIST-MCP-MEMORY-1: registered in qnfo-memory-mcp/worker.js TOOLS on 2026-11-05 (write scope: MCP_TOKEN only)'),
  ('qnfo-memory-mcp', 'tool', 'memory_tiering_metrics', 'BP26-ALLOWLIST-MCP-MEMORY-1: registered in qnfo-memory-mcp/worker.js TOOLS on 2026-11-05'),
  ('qnfo-memory-mcp', 'tool', 'recall_facts', 'BP26-ALLOWLIST-MCP-MEMORY-1: registered in qnfo-memory-mcp/worker.js TOOLS on 2026-11-05'),
  ('qnfo-memory-mcp', 'tool', 'query_graph', 'BP26-ALLOWLIST-MCP-MEMORY-1: registered in qnfo-memory-mcp/worker.js TOOLS on 2026-11-05'),
  ('qnfo-memory-mcp', 'tool', 'get_paper_context', 'BP26-ALLOWLIST-MCP-MEMORY-1: registered in qnfo-memory-mcp/worker.js TOOLS on 2026-11-05'),
  ('qnfo-memory-mcp', 'tool', 'fleet_graph_find', 'BP26-ALLOWLIST-MCP-MEMORY-1: registered in qnfo-memory-mcp/worker.js TOOLS on 2026-11-05'),
  ('qnfo-memory-mcp', 'tool', 'fleet_graph_node', 'BP26-ALLOWLIST-MCP-MEMORY-1: registered in qnfo-memory-mcp/worker.js TOOLS on 2026-11-05'),
  ('qnfo-memory-mcp', 'tool', 'fleet_graph_impact', 'BP26-ALLOWLIST-MCP-MEMORY-1: registered in qnfo-memory-mcp/worker.js TOOLS on 2026-11-05'),
  ('qnfo-memory-mcp', 'tool', 'fleet_graph_path', 'BP26-ALLOWLIST-MCP-MEMORY-1: registered in qnfo-memory-mcp/worker.js TOOLS on 2026-11-05'),
  ('qnfo-memory-mcp', 'tool', 'fleet_graph_worker', 'BP26-ALLOWLIST-MCP-MEMORY-1: registered in qnfo-memory-mcp/worker.js TOOLS on 2026-11-05'),
  ('qnfo-memory-mcp', 'tool', 'fleet_graph_resource', 'BP26-ALLOWLIST-MCP-MEMORY-1: registered in qnfo-memory-mcp/worker.js TOOLS on 2026-11-05'),
  ('qnfo-memory-mcp', 'tool', 'fleet_graph_findings', 'BP26-ALLOWLIST-MCP-MEMORY-1: registered in qnfo-memory-mcp/worker.js TOOLS on 2026-11-05'),
  ('qnfo-memory-mcp', 'tool', 'fleet_graph_freshness', 'BP26-ALLOWLIST-MCP-MEMORY-1: registered in qnfo-memory-mcp/worker.js TOOLS on 2026-11-05');
