-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM human_actions WHERE slug = 'memory-mcp-secrets-exposed'; UPDATE agent_issues SET status = 'closed' WHERE status = 'open' AND title LIKE 'MEMORY-MCP-ENV-LEAK-1:%';
--
-- MEMORY-MCP-ENV-LEAK-1 (2026-11-05, charter pillar security). Found by an independent code review of KG-CURATE-1 and confirmed against production
-- the same hour (key names, types and lengths read; no value was printed or kept): GET https://qnfo-memory-mcp.q08.workers.dev/fleet-graph/constructor
-- answered 200 with the worker env as JSON, because the route name comes from the URL and FG_ROUTES["constructor"] is Object, which returns its
-- argument. The env of that worker holds MCP_TOKEN (read and write), MCP_READ_TOKEN and EXUVIA_API_KEY as strings. The route has been open since
-- FLEET-GRAPH-1 (qnfo-memory-mcp 2.1.0, 2026-10-19) and /fleet-graph is documented in a public repository. The code fix (own-property lookup,
-- a regression test that fails without it) ships in the same pull request; the secrets must still be rotated because their old values are valid
-- until they are, and nothing says nobody read them.

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'MEMORY-MCP-ENV-LEAK-1: GET /fleet-graph/constructor returned the qnfo-memory-mcp env (MCP_TOKEN, MCP_READ_TOKEN, EXUVIA_API_KEY) without authentication',
 'runtime-probe: {"url": "https://qnfo-memory-mcp.q08.workers.dev/fleet-graph/constructor", "status": 404}' || char(10) ||
 'Charter pillar: security. Fixed in qnfo-memory-mcp (FG_ROUTES and the MCP handler table are read by own property only; qnfo-memory-mcp/fleet-graph.test.mjs proves seven Object.prototype names are refused and do not echo the env). This issue closes when the probe above passes on the deployed worker. Rotation of the three secrets is the owner card memory-mcp-secrets-exposed (IDENTITY-BOUND: the Exuvia key is minted in the owner Exuvia account, and the MCP tokens are held by the owner own MCP clients). Scan for the same pattern on 2026-11-05: the only other dispatch tables keyed by a URL or request value are behind authentication (qnfo-cloud-ops POST /run, JOBS) or guarded (the agents SDK method check).',
 'session:kg-curate', 'security', 'critical', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE status = 'open' AND title LIKE 'MEMORY-MCP-ENV-LEAK-1:%');

INSERT OR IGNORE INTO human_actions (slug, title, why, default_in_effect, action, url, sev, due, status, source)
VALUES ('memory-mcp-secrets-exposed',
 'Rotate MCP_TOKEN, MCP_READ_TOKEN and EXUVIA_API_KEY on qnfo-memory-mcp: GET /fleet-graph/constructor served them to anyone from 2026-10-19 until the fix deploys',
 'IDENTITY-BOUND: the Exuvia key is a credential minted in the owner Exuvia account, and the two MCP tokens are copied into the owner own MCP clients (a connector config that sends MCP_TOKEN stops working the moment it is rotated), so neither can be rotated by the fleet without breaking or impersonating the owner. Measured 2026-11-05: the route answered 200 with the env as JSON, including the three strings (lengths 48, 64 and 67); no value was printed or stored. The code fix is in the pull request that carries this card. What the old values allow until rotated: MCP_TOKEN calls every tool of https://qnfo-memory-mcp.q08.workers.dev/mcp, among them query_graph (any SELECT on qnfo-graph), remember_fact (a write to agent memory) and exuvia_publish_paper; MCP_READ_TOKEN reads; EXUVIA_API_KEY acts as the agent on Exuvia. Nothing in the logs shows whether anyone read the route.',
 'The route is closed by the fix once it deploys, and the old values stay valid: anyone who read them in the 16 days can still use them until they are replaced.',
 'After the fix is live (the issue MEMORY-MCP-ENV-LEAK-1 closes itself when GET /fleet-graph/constructor answers 404): 1) take the secret lease: POST https://qnfo-deploy-guard.q08.workers.dev/secret-lock/acquire {"worker":"qnfo-memory-mcp","owner":"owner","ttl_sec":300}; 2) for MCP_TOKEN and MCP_READ_TOKEN generate a new value (openssl rand -hex 24) and put it with wrangler secret put <NAME> --name qnfo-memory-mcp, then replace it in each MCP client that holds the old one; 3) create a new key in your Exuvia account, revoke the old one, wrangler secret put EXUVIA_API_KEY --name qnfo-memory-mcp; 4) release the lease with POST /secret-lock/release. Then a call to https://qnfo-memory-mcp.q08.workers.dev/mcp with the old token must answer 401.',
 'https://qnfo-memory-mcp.q08.workers.dev/health', 'critical', NULL, 'open', 'kg-curate-review');
