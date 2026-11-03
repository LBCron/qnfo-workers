var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var PROTOCOL_VERSION = "2024-11-05";
var SUPPORTED_PROTOCOLS = ["2024-11-05", "2025-03-26", "2025-06-18"];
var NL = String.fromCharCode(10);
var SERVER_NAME = "qnfo-memory-mcp";
var VERSION = "2.7.1"; /* 2.7.1 #6612 (pillar autonomy): literal graph searches avoid D1's 50-byte LIKE pattern limit. */ /* 2.7.0 EXUVIA-ENGAGE-1 (2026-11-03, pillar reach): evidence-matched drafts for Exuvia posts needing a response, deduplicated and logged to decision_log; no comment is sent. */ /* 2.5.0 FULLSCOPE-1 (2026-10-31): the SSE transport is real (session + /mcp/messages + keepalive, spec event:endpoint; the old stub closed after 100 ms); ?token= query auth parity with qnfo-tools-mcp; optional MCP_READ_TOKEN read-only scope (write tools: remember_fact, exuvia_publish_paper); ping, prompts/list, resources/templates/list, JSON-RPC batch, -32602 on malformed tools/call, protocolVersion negotiation; remember_fact keeps up to 8000 chars (was silently truncated at 800), clamps importance to 0-1 and enforces its own category enum; the open /fleet-graph/findings route no longer leaks secret: subjects; every tools/call is audit-logged when an AUDIT D1 binding is present. */ /* 2.4.0 REPO-GRAPH-1 (2026-10-29, pillar autonomy; minor: fleet_graph_find and /fleet-graph/find now accept the kinds repo and doc, so a repository or a document is found by name like a worker). */ // 2.3.2 EXUVIA-2 (2026-10-28, pillar reach): /health reports exuvia_key (boolean only) so the owner card that waits for the Exuvia key closes by a runtime probe. // 2.3.0 EXUVIA-1 (2026-10-28, pillar reach): exuvia_* MCP tools connect QNFO papers and the knowledge graph to the Exuvia agent research network (exuvia-two.vercel.app): status, feed, paper-to-post draft, confirmed publish, KG context for an Exuvia post. EXUVIA_API_KEY is an optional worker secret; without it the tools say so and the draft and context tools still work. // 2.2.0 NO-REGISTRAR-1 (2026-10-21): dead DOIs recognised by the 10.5281 prefix only; the registrar is not named. // 2.1.0 FLEET-GRAPH-1 (2026-10-19, pillar autonomy): the fleet code + topology graph (qnfo-graph fg_* tables, built by scripts/fleet_graph.mjs) as MCP tools fleet_graph_* and open read-only GET /fleet-graph/* routes: find, node, impact (blast radius), path, worker, resource, findings, freshness. Secret NAMES are served only to authenticated MCP clients; the open routes give counts.
// NO-REGISTRAR-1: a DOI under the dead 10.5281 prefix is never returned; third-party DOIs pass through.
function nozDoi(d) { return d && !/10\.5281\//.test(String(d)) ? d : null; }
var SERVER_VERSION = VERSION;
var EMBED_MODEL = "@cf/baai/bge-base-en-v1.5";
var TOOLS = [
  // EXUVIA-1: Exuvia (https://exuvia-two.vercel.app) is a public research network for AI agents. Reads and drafts are open; a publish needs confirm=true and EXUVIA_API_KEY.
  { name: "exuvia_status", description: "Exuvia connection state: whether EXUVIA_API_KEY is set, public platform limits, and (with a key) the agent's /me orientation.", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true, openWorldHint: true } },
  { name: "exuvia_feed", description: "Read recent Exuvia research posts (needs EXUVIA_API_KEY). Use to find posts a QNFO paper or KG node can answer.", inputSchema: { type: "object", properties: { limit: { type: "number", default: 10 }, path: { type: "string", description: "feed | feed/needs-response | feed/follows", default: "feed" } } }, annotations: { readOnlyHint: true, openWorldHint: true } },
  { name: "exuvia_paper_post_draft", description: "Build an Exuvia research-post payload (title, abstract, content_markdown, tags, post_type) from a QNFO paper slug, with its knowledge-graph neighbours as a Related section. Nothing is sent.", inputSchema: { type: "object", properties: { slug: { type: "string" }, max_chars: { type: "number", default: 20000 } }, required: ["slug"] }, annotations: { readOnlyHint: true } },
  { name: "exuvia_publish_paper", description: "Publish a QNFO paper to Exuvia as a public research post. Public and not agent-deletable: dry-run unless confirm=true. Needs EXUVIA_API_KEY.", inputSchema: { type: "object", properties: { slug: { type: "string" }, confirm: { type: "boolean", default: false }, post_type: { type: "string", default: "research" }, max_chars: { type: "number", default: 20000 } }, required: ["slug"] }, annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true } },
  { name: "exuvia_kg_context", description: "QNFO papers and knowledge-graph nodes relevant to an Exuvia post (by post id, fetched with the key) or to free text. Use before replying on Exuvia.", inputSchema: { type: "object", properties: { post_id: { type: "string" }, text: { type: "string" }, limit: { type: "number", default: 5 } } }, annotations: { readOnlyHint: true, openWorldHint: true } },
  { name: "exuvia_engage", description: "Draft evidence-backed QNFO paper replies to Exuvia posts marked needs_response. Requires EXUVIA_API_KEY and ops_config exuvia_engage=on. Drafts are logged to decision_log and never posted.", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: false, openWorldHint: true } },
  { name: "search_papers", description: "Semantic search across QWAV research papers using Vectorize.", inputSchema: { type: "object", properties: { query: { type: "string", description: "Natural language search query" }, limit: { type: "number", description: "Maximum results (1-20, default 10)", default: 10 } }, required: ["query"] }, annotations: { readOnlyHint: true } },
  { name: "search_papers_enriched", description: "Semantic search papers AND return full body content. Searches Vectorize then enriches with D1 body_md, doi, authors.", inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number", default: 5 }, includeBody: { type: "boolean", default: true }, bodyLimitChars: { type: "number", default: 3e3 } }, required: ["query"] }, annotations: { readOnlyHint: true } },
  { name: "resolve_paper_id", description: "Resolve a paper identifier (slug, Vectorize ID, KG ID, DOI) into ALL cross-system identifiers.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] }, annotations: { readOnlyHint: true } },
  { name: "search_memories", description: "Semantic search across persistent agent memories with age-decay and outcome-weighted ranking.", inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number", default: 5 }, category: { type: "string" } }, required: ["query"] }, annotations: { readOnlyHint: true } },
  { name: "remember_fact", description: "Store an episodic memory with vector embedding, provenance, and role.", inputSchema: { type: "object", properties: { content: { type: "string" }, category: { type: "string", enum: ["user_preference", "project_fact", "task_outcome", "heuristic", "anti_pattern"] }, importance: { type: "number", default: 0.7 }, summary: { type: "string" }, session_id: { type: "string" }, tier: { type: "string", enum: ["episodic"] }, role: { type: "string" }, provenance: { type: "string" } }, required: ["content", "category"] }, annotations: { readOnlyHint: false, destructiveHint: false } },
  { name: "memory_outcome", description: "Record an idempotent success or failure outcome for a retrieved memory.", inputSchema: { type: "object", properties: { memory_id: { type: "string" }, outcome: { type: "string", enum: ["success", "failure"] }, feedback_id: { type: "string" }, provenance: { type: "string" } }, required: ["memory_id", "outcome", "feedback_id"] }, annotations: { readOnlyHint: false, destructiveHint: false } },
  { name: "memory_tiering_metrics", description: "Read episodic/semantic counts, consolidation runs, and 7/30-day outcome hit rates.", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
  { name: "recall_facts", description: "Recall stored facts from D1 by category or keyword match.", inputSchema: { type: "object", properties: { category: { type: "string" }, keyword: { type: "string" }, limit: { type: "number", default: 10 } }, required: [] }, annotations: { readOnlyHint: true } },
  { name: "query_graph", description: "Query the QNFO Knowledge Graph. stats, nodes, neighbors, impact, raw SQL.", inputSchema: { type: "object", properties: { endpoint: { type: "string", enum: ["stats", "nodes", "neighbors", "impact", "query"] }, params: { type: "object" } }, required: ["endpoint"] }, annotations: { readOnlyHint: true } },
  { name: "get_paper_context", description: "Get full paper body content from D1 living-paper database by slug.", inputSchema: { type: "object", properties: { slug: { type: "string" }, limit_chars: { type: "number", default: 5e3 } }, required: ["slug"] }, annotations: { readOnlyHint: true } },
  // FLEET-GRAPH-1: the fleet's code + live Cloudflare topology graph. Node ids: worker:<name>, fn:<worker>#<function>,
  // binding:<worker>.<NAME>, d1:<db>, d1t:<db>.<table>, d1v:<db>.<view>, d1trg:<db>.<trigger>, kv:<id>, r2:<bucket>, vz:<index>,
  // queue:<name>, cron:<worker>@<expr>, route:<pattern>, domain:<host>, secret:<worker>.<NAME>, host:<external host>,
  // migration:<file>, gha:<workflow file>, script:<path>. A name that matches several nodes is refused with the candidates.
  { name: "fleet_graph_find", description: "Find fleet graph nodes (workers, functions, bindings, D1 tables/views/triggers, crons, routes, queues, buckets) by id or name. Use before the other fleet_graph tools to get an exact id.", inputSchema: { type: "object", properties: { query: { type: "string" }, kind: { type: "string", description: "worker|function|handler|binding|d1|d1_table|d1_view|d1_trigger|cron|route|custom_domain|queue|r2|kv|vectorize|secret|external_host|migration|gh_workflow|script" }, limit: { type: "number", default: 20 } }, required: ["query"] }, annotations: { readOnlyHint: true } },
  { name: "fleet_graph_node", description: "One node with its incoming and outgoing edges (relation, confidence EXTRACTED|INFERRED|OBSERVED, scope code|live).", inputSchema: { type: "object", properties: { id: { type: "string" }, limit: { type: "number", default: 100 } }, required: ["id"] }, annotations: { readOnlyHint: true } },
  { name: "fleet_graph_impact", description: "Blast radius before a change: everything that depends on a node (direction up, default) or everything it depends on (down), bounded by depth. Run it before changing a binding, D1 table, cron, route or exported function.", inputSchema: { type: "object", properties: { id: { type: "string" }, depth: { type: "number", default: 3 }, direction: { type: "string", enum: ["up", "down"], default: "up" }, include_inferred: { type: "boolean", default: true }, limit: { type: "number", default: 300 } }, required: ["id"] }, annotations: { readOnlyHint: true } },
  { name: "fleet_graph_path", description: "Shortest dependency path between two nodes (directed first, then undirected).", inputSchema: { type: "object", properties: { from: { type: "string" }, to: { type: "string" }, max_depth: { type: "number", default: 6 } }, required: ["from", "to"] }, annotations: { readOnlyHint: true } },
  { name: "fleet_graph_worker", description: "Everything about one worker: version, declared vs live bindings and crons, routes, secret names, D1 tables it reads/writes, workers it calls and that call it, its findings.", inputSchema: { type: "object", properties: { worker: { type: "string" } }, required: ["worker"] }, annotations: { readOnlyHint: true } },
  { name: "fleet_graph_resource", description: "Who uses a resource: a D1 database or table, KV, R2 bucket, Vectorize index, queue, service or external host. Lists binders, readers, writers, triggers and views.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] }, annotations: { readOnlyHint: true } },
  { name: "fleet_graph_findings", description: "Current fleet graph findings: binding/cron drift, env reads with no binding, SQL against missing tables, untracked or undeployed workers, orphaned resources, unused bindings, trigger depth.", inputSchema: { type: "object", properties: { kind: { type: "string" }, severity: { type: "string", enum: ["warn", "info"] }, subject: { type: "string" }, limit: { type: "number", default: 200 } } }, annotations: { readOnlyHint: true } },
  { name: "fleet_graph_freshness", description: "When each graph scope (code, live, findings) was last built, from which commit, and how many rows changed.", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } }
];
// FULLSCOPE-1: write-scope tools. MCP_TOKEN is the full read+write credential; MCP_READ_TOKEN (optional)
// grants read tools only, the same split as qnfo-tools-mcp (MCP-TOKEN-NO-SCOPE-SEPARATION, 954).
var WRITE_TOOLS = ["remember_fact", "memory_outcome", "exuvia_publish_paper", "exuvia_engage"];
var MEM_CATEGORIES = ["user_preference", "project_fact", "task_outcome", "heuristic", "anti_pattern"];
function corsHeaders() {
  return { "Access-Control-Allow-Origin": "https://qnfo.org", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id" };
}
__name(corsHeaders, "corsHeaders");
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...corsHeaders() } });
}
__name(json, "json");
function sanitize(s) {
return String(s == null ? "" : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uD800-\uDFFF]/g, "").trim().substring(0, 800);
}
__name(sanitize, "sanitize");
// FULLSCOPE-1: long-form content (remember_fact bodies) gets the same control-character strip without the
// 800-char cap that sanitize() imposes; a durable fact used to be silently truncated to 800 chars.
function sanitizeLong(s) {
return String(s == null ? "" : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uD800-\uDFFF]/g, "").trim().substring(0, 8e3);
}
__name(sanitizeLong, "sanitizeLong");
async function embed(env, text) {
  const result = await env.AI.run(EMBED_MODEL, { text: [text] });
  return result.data[0];
}
__name(embed, "embed");
function sha256hex(str) {
  const enc = new TextEncoder().encode(str);
  return crypto.subtle.digest("SHA-256", enc).then(
    (buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("")
  );
}
__name(sha256hex, "sha256hex");
async function tool_search_papers(args, env) {
  const query = sanitize(args.query);
  const limit = Math.min(parseInt(args.limit) || 10, 20);
  if (!query) return { content: [{ type: "text", text: JSON.stringify({ error: "query required" }) }], isError: true };
  const vec = await embed(env, query);
  const res = await env.PAPER_VZ.query(vec, { topK: Math.min(limit * 3, 50), returnMetadata: "all", returnValues: false });
  const matches = (res.matches || []).filter((m) => !m.id.startsWith("mem:"));
  const results = [];
  for (const m of matches.slice(0, limit)) {
    const slug = m.metadata?.slug || null;
    let title = m.metadata?.title || null;
    if (slug && !title) {
      const paper = await env.LIVING_PAPER.prepare(
        "SELECT title FROM papers WHERE slug = ?1 LIMIT 1"
      ).bind(slug).first().catch(() => null);
      title = paper?.title || null;
    }
    results.push({
      id: m.id,
      slug,
      title,
      score: m.score,
      chunk: m.metadata?.chunk ?? m.metadata?.chunk_idx ?? null
    });
  }
  return { content: [{ type: "text", text: JSON.stringify({ count: results.length, results }) }] };
}
__name(tool_search_papers, "tool_search_papers");
async function tool_search_papers_enriched(args, env) {
  const query = sanitize(args.query);
  const limit = Math.min(parseInt(args.limit) || 5, 20);
  const includeBody = args.includeBody !== false;
  const bodyLimit = Math.min(parseInt(args.bodyLimitChars) || 3e3, 5e4);
  if (!query) return { content: [{ type: "text", text: JSON.stringify({ error: "query required" }) }], isError: true };
  const vec = await embed(env, query);
  const res = await env.PAPER_VZ.query(vec, { topK: Math.min(limit * 3, 50), returnMetadata: "all", returnValues: false });
  const matches = (res.matches || []).filter((m) => !m.id.startsWith("mem:"));
  const results = [];
  for (const m of matches.slice(0, limit)) {
    const slug = m.metadata?.slug || null;
    let paper = null;
    if (slug) {
      paper = await env.LIVING_PAPER.prepare(
        "SELECT slug, title, doi, authors, abstract, body_md FROM papers WHERE slug = ?1 LIMIT 1"
      ).bind(slug).first().catch(() => null);
    }
    let body = null;
    if (paper?.body_md && includeBody) {
      body = paper.body_md.slice(0, bodyLimit);
    }
    results.push({
      id: m.id,
      slug,
      title: m.metadata?.title || paper?.title || null,
      score: m.score,
      doi: nozDoi(paper?.doi),
      authors: paper?.authors || null,
      abstract: paper?.abstract || null,
      body,
      body_truncated: paper?.body_md ? paper.body_md.length > bodyLimit : null
    });
  }
  return { content: [{ type: "text", text: JSON.stringify({ count: results.length, results }) }] };
}
__name(tool_search_papers_enriched, "tool_search_papers_enriched");
async function tool_resolve_paper_id(args, env) {
  const id = sanitize(args.id);
  if (!id) return { content: [{ type: "text", text: JSON.stringify({ error: "id required" }) }], isError: true };
  const out = { input: id };
  const paper = await env.LIVING_PAPER.prepare(
    "SELECT slug, title, doi, identifier, identifier_type, id, status, r2_key FROM papers WHERE slug = ?1 OR doi = ?2 OR identifier = ?3 LIMIT 5"
  ).bind(id, id, id).all().catch(() => null);
  if (paper?.results?.length) out.papers = paper.results.map((r) => ({ ...r, doi: nozDoi(r.doi) }));
  const node = await env.GRAPH_DB.prepare(
    "SELECT id, label, name, properties FROM nodes WHERE id = ?1 OR name = ?2 LIMIT 5"
  ).bind(id, id).all().catch(() => null);
  if (node?.results?.length) out.kg_nodes = node.results;
  try {
    const res = await env.PAPER_VZ.getByIds([id]);
    if (res?.results?.length) out.vector = res.results.map((v) => ({ id: v.id, metadata: v.metadata }));
  } catch (e) {
  }
  return { content: [{ type: "text", text: JSON.stringify(out) }] };
}
__name(tool_resolve_paper_id, "tool_resolve_paper_id");
async function tool_search_memories(args, env) {
  const query = sanitize(args.query);
  const limit = Math.min(parseInt(args.limit) || 5, 20);
  const category = sanitize(args.category);
  if (!query) return { content: [{ type: "text", text: JSON.stringify({ error: "query required" }) }], isError: true };
  const vec = await embed(env, query);
  const res = await env.PAPER_VZ.query(vec, { topK: Math.min(limit * 5, 50), returnMetadata: "all", returnValues: false });
  let matches = (res.matches || []).filter((m) => m.id.startsWith("mem:"));
  if (category) matches = matches.filter((m) => m.id.startsWith("mem:" + category + ":"));
  const results = [];
  for (const m of matches.slice(0, limit)) {
    const rec = await env.GRAPH_DB.prepare(
      "SELECT id, category, content, summary, importance, session_id, created_at FROM agent_memories WHERE id = ?1"
    ).bind(m.id).first().catch(() => null);
    results.push({
      id: m.id,
      score: m.score,
      category: rec?.category || m.metadata?.category || null,
      content: rec?.content || m.metadata?.content || null,
      summary: rec?.summary || null,
      importance: rec?.importance || null,
      session_id: rec?.session_id || null,
      created_at: rec?.created_at || null
    });
  }
  return { content: [{ type: "text", text: JSON.stringify({ count: results.length, results }) }] };
}
__name(tool_search_memories, "tool_search_memories");
async function tool_remember_fact(args, env) {
  // FULLSCOPE-1: content keeps up to 8000 chars (sanitize() capped it at 800); category is validated against the
  // enum the schema advertises; importance is clamped into 0-1 and a non-number falls back to the default.
  const content = sanitizeLong(args.content);
  const category = args.category != null && args.category !== "" ? sanitize(args.category) : "project_fact";
  if (MEM_CATEGORIES.indexOf(category) < 0) return { content: [{ type: "text", text: JSON.stringify({ error: "category must be one of " + MEM_CATEGORIES.join(", ") }) }], isError: true };
  const imp = Number(args.importance);
  const importance = args.importance != null ? (Number.isFinite(imp) ? Math.max(0, Math.min(1, imp)) : 0.7) : 0.7;
  const summary = args.summary ? sanitize(args.summary) : null;
  const session_id = args.session_id ? sanitize(args.session_id) : null;
  if (!content) return { content: [{ type: "text", text: JSON.stringify({ error: "content required" }) }], isError: true };
  const ts = Date.now();
  const id = "mem:" + category + ":" + ts + ":" + (await sha256hex(content)).slice(0, 8);
  const created_at = (/* @__PURE__ */ new Date()).toISOString();
  const tier = args.tier ? sanitize(args.tier) : "episodic";
  const role = args.role ? sanitize(args.role) : "agent";
  const metadata_json = JSON.stringify({ source: "qnfo-memory-mcp", timestamp: created_at, tier, role });
  await env.GRAPH_DB.prepare(
    "INSERT OR REPLACE INTO agent_memories (id, category, content, summary, importance, session_id, created_at, expires_at, metadata_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, ?8)"
  ).bind(id, category, content, summary, importance, session_id, created_at, metadata_json).run();
  const vec = await embed(env, content);
  await env.PAPER_VZ.upsert([{
    id,
    values: vec,
    metadata: { kind: "memory", category, content: content.slice(0, 800) }
  }]);
  return { content: [{ type: "text", text: JSON.stringify({ success: true, id, category, importance, created_at, tier }) }] };
}
__name(tool_remember_fact, "tool_remember_fact");
async function tool_recall_facts(args, env) {
  const category = args.category ? sanitize(args.category) : null;
  const keyword = args.keyword ? sanitize(args.keyword) : null;
  const limit = Math.min(parseInt(args.limit) || 10, 50);
  let rows;
  if (category && keyword) {
    rows = await env.GRAPH_DB.prepare(
      "SELECT id, category, content, summary, importance, session_id, created_at FROM agent_memories WHERE category = ?1 AND content LIKE ?2 ORDER BY importance DESC LIMIT ?3"
    ).bind(category, "%" + keyword + "%", limit).all();
  } else if (category) {
    rows = await env.GRAPH_DB.prepare(
      "SELECT id, category, content, summary, importance, session_id, created_at FROM agent_memories WHERE category = ?1 ORDER BY importance DESC LIMIT ?2"
    ).bind(category, limit).all();
  } else if (keyword) {
    rows = await env.GRAPH_DB.prepare(
      "SELECT id, category, content, summary, importance, session_id, created_at FROM agent_memories WHERE content LIKE ?1 ORDER BY importance DESC LIMIT ?2"
    ).bind("%" + keyword + "%", limit).all();
  } else {
    rows = await env.GRAPH_DB.prepare(
      "SELECT id, category, content, summary, importance, session_id, created_at FROM agent_memories ORDER BY importance DESC, created_at DESC LIMIT ?1"
    ).bind(limit).all();
  }
  return { content: [{ type: "text", text: JSON.stringify({ count: rows.results.length, results: rows.results }) }] };
}
__name(tool_recall_facts, "tool_recall_facts");
async function tool_query_graph(args, env) {
  const endpoint = args.endpoint || "stats";
  const params = args.params || {};
  try {
    switch (endpoint) {
      case "stats": {
        const nodes = await env.GRAPH_DB.prepare("SELECT COUNT(*) AS c FROM nodes").first();
        const edges = await env.GRAPH_DB.prepare("SELECT COUNT(*) AS c FROM edges").first();
        const labels = await env.GRAPH_DB.prepare("SELECT label, COUNT(*) AS count FROM nodes GROUP BY label ORDER BY count DESC LIMIT 30").all();
        const rels = await env.GRAPH_DB.prepare("SELECT relationship_type, COUNT(*) AS count FROM edges GROUP BY relationship_type ORDER BY count DESC LIMIT 30").all();
        return { content: [{ type: "text", text: JSON.stringify({ totalNodes: nodes.c, totalEdges: edges.c, nodeLabels: labels.results, relationshipTypes: rels.results }) }] };
      }
      case "nodes": {
        const label = params.label ? sanitize(params.label) : null;
        const search = params.search ? sanitize(params.search) : null;
        let rows;
        if (label && search) {
          rows = await env.GRAPH_DB.prepare("SELECT id, label, name, properties FROM nodes WHERE label = ?1 AND (name LIKE ?2 OR id LIKE ?2) LIMIT 50").bind(label, "%" + search + "%").all();
        } else if (label) {
          rows = await env.GRAPH_DB.prepare("SELECT id, label, name, properties FROM nodes WHERE label = ?1 LIMIT 100").bind(label).all();
        } else if (search) {
          rows = await env.GRAPH_DB.prepare("SELECT id, label, name, properties FROM nodes WHERE name LIKE ?1 OR id LIKE ?1 LIMIT 50").bind("%" + search + "%").all();
        } else {
          rows = await env.GRAPH_DB.prepare("SELECT id, label, name, properties FROM nodes LIMIT 100").all();
        }
        return { content: [{ type: "text", text: JSON.stringify({ count: rows.results.length, results: rows.results }) }] };
      }
      case "neighbors": {
        const id = sanitize(params.id);
        if (!id) return { content: [{ type: "text", text: JSON.stringify({ error: "id required" }) }], isError: true };
        const bare = id.replace(/^paper[:|-]/, "");
        const alt1 = "paper:" + bare;
        const alt2 = "paper-" + bare;
        const rows = await env.GRAPH_DB.prepare(
          "SELECT e.source_id, e.target_id, e.relationship_type, n.id, n.label, n.name FROM edges e LEFT JOIN nodes n ON (n.id = e.source_id OR n.id = e.target_id) WHERE e.source_id IN (?1, ?2, ?3) OR e.target_id IN (?1, ?2, ?3) LIMIT 100"
        ).bind(id, alt1, alt2).all();
        const neighbors = (rows.results || []).map((r) => ({
          source_id: r.source_id,
          target_id: r.target_id,
          relationship: r.relationship_type,
          neighbor_id: r.id,
          label: r.label,
          name: r.name
        }));
        return { content: [{ type: "text", text: JSON.stringify({ id, count: neighbors.length, neighbors }) }] };
      }
      case "impact": {
        const id = sanitize(params.id);
        if (!id) return { content: [{ type: "text", text: JSON.stringify({ error: "id required" }) }], isError: true };
        const upstream = await env.GRAPH_DB.prepare(
          "SELECT e.source_id AS id, e.relationship_type, n.label, n.name FROM edges e LEFT JOIN nodes n ON n.id = e.source_id WHERE e.target_id = ?1 LIMIT 50"
        ).bind(id).all();
        const downstream = await env.GRAPH_DB.prepare(
          "SELECT e.target_id AS id, e.relationship_type, n.label, n.name FROM edges e LEFT JOIN nodes n ON n.id = e.target_id WHERE e.source_id = ?1 LIMIT 50"
        ).bind(id).all();
        return { content: [{ type: "text", text: JSON.stringify({ id, upstreamDependencies: upstream.results, downstreamDependents: downstream.results, totalDependents: downstream.results.length }) }] };
      }
      case "query": {
        const sql = sanitize(params.query || params.sql);
        if (!sql || !/^\s*(SELECT|PRAGMA)/i.test(sql)) {
          return { content: [{ type: "text", text: JSON.stringify({ error: "only SELECT/PRAGMA allowed" }) }], isError: true };
        }
        const rows = await env.GRAPH_DB.prepare(sql).all().catch((e) => ({ results: [], error: e.message }));
        return { content: [{ type: "text", text: JSON.stringify({ count: rows.results.length, results: rows.results, error: rows.error || null }) }] };
      }
      default:
        return { content: [{ type: "text", text: JSON.stringify({ error: "unknown endpoint: " + endpoint }) }], isError: true };
    }
  } catch (e) {
    return { content: [{ type: "text", text: JSON.stringify({ error: "internal error", detail: e.message }) }], isError: true };
  }
}
__name(tool_query_graph, "tool_query_graph");
async function tool_get_paper_context(args, env) {
  const slug = sanitize(args.slug);
  const limit = Math.min(parseInt(args.limit_chars) || 5e3, 1e5);
  if (!slug) return { content: [{ type: "text", text: JSON.stringify({ error: "slug required" }) }], isError: true };
  const paper = await env.LIVING_PAPER.prepare(
    "SELECT slug, title, doi, authors, abstract, body_md, published, updated_at FROM papers WHERE slug = ?1 LIMIT 1"
  ).bind(slug).first().catch(() => null);
  if (!paper) return { content: [{ type: "text", text: JSON.stringify({ error: "slug not found" }) }], isError: true };
  const body = paper.body_md ? paper.body_md.slice(0, limit) : null;
  return { content: [{ type: "text", text: JSON.stringify({
    slug: paper.slug,
    title: paper.title,
    doi: nozDoi(paper.doi),
    authors: paper.authors,
    abstract: paper.abstract,
    body,
    body_truncated: paper.body_md ? paper.body_md.length > limit : null,
    published: paper.published,
    updated_at: paper.updated_at
  }) }] };
}
__name(tool_get_paper_context, "tool_get_paper_context");
// ---------------------------------------------------------------------------------------------------------------------------
// EXUVIA-1 (2.3.0): bridge to the Exuvia agent research network. The key (EXUVIA_API_KEY) never appears in output; a publish
// is public and has no agent delete route, so it is a dry run unless confirm === true. Exuvia limits: content 50000 chars,
// 10 tags, 2 posts per burst, 150 s cooldown (GET /api/v1/capabilities).
// ---------------------------------------------------------------------------------------------------------------------------
function exBase(env) { return String(env.EXUVIA_BASE || "https://exuvia-two.vercel.app").replace(/\/+$/, ""); }
function exOut(o, err) { return { content: [{ type: "text", text: JSON.stringify(o) }], isError: !!err }; }
async function exFetch(env, path, init) {
  const headers = { Accept: "application/json" };
  if (env.EXUVIA_API_KEY) headers["x-api-key"] = env.EXUVIA_API_KEY;
  if (init && init.body) headers["Content-Type"] = "application/json";
  const r = await fetch(exBase(env) + path, { ...(init || {}), headers });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch (e) { data = { raw: text.slice(0, 500) }; }
  return { status: r.status, data };
}
async function exPaperDraft(env, slug, maxChars) {
  const paper = await env.LIVING_PAPER.prepare("SELECT slug, title, doi, authors, abstract, body_md FROM papers WHERE slug = ?1 LIMIT 1").bind(slug).first().catch(() => null);
  if (!paper) return { error: "slug not found" };
  const bare = slug.replace(/^paper[:|-]/, "");
  const rows = await env.GRAPH_DB.prepare("SELECT e.relationship_type AS rel, n.id, n.label, n.name FROM edges e JOIN nodes n ON (n.id = CASE WHEN e.source_id IN (?1, ?2, ?3) THEN e.target_id ELSE e.source_id END) WHERE e.source_id IN (?1, ?2, ?3) OR e.target_id IN (?1, ?2, ?3) LIMIT 12").bind(slug, "paper:" + bare, "paper-" + bare).all().catch(() => ({ results: [] }));
  const kg = (rows.results || []).filter((r) => r.name);
  const cap = Math.max(1000, Math.min(parseInt(maxChars, 10) || 20000, 40000));
  let body = String(paper.body_md || paper.abstract || "");
  const truncated = body.length > cap;
  if (truncated) body = body.slice(0, cap).replace(/\s+\S*$/, "") + "\n\n*Excerpt; the full text is linked below.*";
  const doi = nozDoi(paper.doi);
  const tail = ["", "## Related (QNFO knowledge graph)", ...(kg.length ? kg.map((r) => "- " + r.name + " (" + (r.label || "node") + ", " + (r.rel || "related") + ")") : ["- none linked yet"]), "", "Source: QNFO" + (doi ? " [" + doi + "](https://doi.org/" + doi + ")" : " paper `" + paper.slug + "`")].join("\n");
  const abstract = String(paper.abstract || paper.title || "").slice(0, 1500);
  return { post: { title: String(paper.title || slug).slice(0, 300), abstract, content_markdown: (body + "\n" + tail).slice(0, 50000), tags: ["qnfo", "knowledge-graph"], post_type: "research", is_speculative: false }, truncated, kg_neighbours: kg.length, slug: paper.slug };
}
async function tool_exuvia_status(args, env) {
  const cap = await exFetch(env, "/api/v1/capabilities").catch((e) => ({ status: 0, data: { error: String(e && e.message || e) } }));
  const out = { base: exBase(env), key_configured: !!env.EXUVIA_API_KEY, capabilities_status: cap.status, limits: cap.data && cap.data.data && cap.data.data.limits || null };
  if (env.EXUVIA_API_KEY) { const me = await exFetch(env, "/api/v1/me").catch((e) => ({ status: 0, data: { error: String(e && e.message || e) } })); out.me_status = me.status; out.me = me.data && me.data.data || me.data; }
  else out.note = "No EXUVIA_API_KEY: register the agent once (POST /api/v1/agents/spawn) and store data.api_key as the worker secret; drafts and KG context work without it.";
  return exOut(out);
}
async function tool_exuvia_feed(args, env) {
  if (!env.EXUVIA_API_KEY) return exOut({ error: "EXUVIA_API_KEY not set" }, true);
  const path = ["feed", "feed/needs-response", "feed/follows"].includes(args.path) ? args.path : "feed";
  const feedPath = path === "feed/needs-response" ? "/api/v1/feed?sort=needs_response" : path === "feed/follows" ? "/api/v1/feed/follows" : "/api/v1/feed?sort=new";
  const r = await exFetch(env, feedPath + "?limit=" + fgInt(args.limit, 10, 1, 50));
  return exOut({ status: r.status, data: r.data && r.data.data || r.data }, r.status >= 400);
}
async function tool_exuvia_paper_post_draft(args, env) {
  const slug = sanitize(args.slug);
  if (!slug) return exOut({ error: "slug required" }, true);
  const d = await exPaperDraft(env, slug, args.max_chars);
  return exOut(d, !!d.error);
}
async function tool_exuvia_publish_paper(args, env) {
  const slug = sanitize(args.slug);
  if (!slug) return exOut({ error: "slug required" }, true);
  const d = await exPaperDraft(env, slug, args.max_chars);
  if (d.error) return exOut(d, true);
  if (args.post_type) d.post.post_type = String(args.post_type).slice(0, 30);
  if (args.confirm !== true) return exOut({ dry_run: true, note: "Public and not agent-deletable. Re-call with confirm=true to publish.", post: { ...d.post, content_markdown: d.post.content_markdown.slice(0, 600) + "..." }, truncated: d.truncated });
  if (!env.EXUVIA_API_KEY) return exOut({ error: "EXUVIA_API_KEY not set" }, true);
  const r = await exFetch(env, "/api/v1/posts", { method: "POST", body: JSON.stringify(d.post) });
  return exOut({ status: r.status, slug: d.slug, result: r.data }, r.status >= 400);
}
async function tool_exuvia_kg_context(args, env) {
  let text = sanitize(args.text || "");
  let post = null;
  if (args.post_id && env.EXUVIA_API_KEY) {
    const r = await exFetch(env, "/api/v1/posts/" + encodeURIComponent(String(args.post_id).slice(0, 80)));
    const p = r.data && r.data.data && r.data.data.post;
    if (p) { post = { id: p.id, title: p.title }; text = (String(p.title || "") + ". " + String(p.abstract || "")).slice(0, 1500); }
  }
  if (!text) return exOut({ error: "text, or post_id with EXUVIA_API_KEY, required" }, true);
  const papers = await tool_search_papers({ query: text, limit: args.limit || 5 }, env);
  const word = text.split(/\s+/).filter((w) => w.length > 5)[0] || "";
  const nodes = word ? await env.GRAPH_DB.prepare("SELECT id, label, name FROM nodes WHERE name LIKE ?1 LIMIT 10").bind("%" + word + "%").all().catch(() => ({ results: [] })) : { results: [] };
  let parsed = null; try { parsed = JSON.parse(papers.content[0].text); } catch (e) { console.error(JSON.stringify({ worker: SERVER_NAME, where: "exuvia-kg-context-parse", error: String(e && e.message || e).slice(0, 200) })); }
  return exOut({ post, query: text.slice(0, 200), papers: parsed, kg_nodes: nodes.results || [] });
}
async function exuviaEngageTick(env) {
  if (!env.EXUVIA_API_KEY) return { skipped: "no exuvia key" };
  if (!env.AUDIT) return { skipped: "audit binding unavailable" };
  let flag;
  try { flag = await env.AUDIT.prepare("SELECT value FROM ops_config WHERE key = 'exuvia_engage'").first(); }
  catch (e) { return { error: "engagement config unavailable" }; }
  if (!flag || String(flag.value || "").trim().toLowerCase() !== "on") return { skipped: "exuvia engagement disabled" };
  const feed = await exFetch(env, "/api/v1/feed?sort=needs_response&limit=10").catch((e) => ({ status: 0, data: { error: String(e && e.message || e).slice(0, 200) } }));
  if (feed.status >= 400 || !feed.status) return { error: "Exuvia needs-response feed unavailable", status: feed.status };
  const posts = feed.data && feed.data.data && Array.isArray(feed.data.data.posts) ? feed.data.data.posts : [];
  const drafts = [];
  const errors = [];
  let unmatched = 0;
  for (const post of posts.slice(0, 10)) {
    const postId = sanitize(post && post.id);
    const query = sanitizeLong([post && post.title, post && post.abstract].filter(Boolean).join("\n"));
    if (!postId || !query) { unmatched++; continue; }
    const action = "EXUVIA-ENGAGE-1: reply draft for post " + postId;
    let existing;
    try { existing = await env.AUDIT.prepare("SELECT evidence FROM decision_log WHERE action = ?1 LIMIT 1").bind(action).first(); }
    catch (e) { errors.push({ post_id: postId, error: "decision lookup failed" }); continue; }
    if (existing && existing.evidence) {
      try { drafts.push(JSON.parse(existing.evidence)); } catch (e) { errors.push({ post_id: postId, error: "stored draft is invalid" }); }
      continue;
    }
    let matches;
    try {
      const searched = await tool_search_papers({ query, limit: 5 }, env);
      matches = JSON.parse(searched.content[0].text).results || [];
    } catch (e) { errors.push({ post_id: postId, error: "paper search failed" }); continue; }
    let draft = null;
    for (const match of matches) {
      const score = Number(match.score);
      if (!match.slug || !Number.isFinite(score) || score < 0.82) continue;
      const paper = await env.LIVING_PAPER.prepare("SELECT slug, title, abstract, status FROM papers WHERE slug = ?1 AND status IN ('published','distributed','external_preprint') LIMIT 1").bind(match.slug).first().catch(() => null);
      if (!paper || !paper.abstract) continue;
      const title = sanitize(paper.title || match.title || paper.slug);
      const abstract = sanitizeLong(paper.abstract).slice(0, 900);
      const url = "https://papers.qnfo.org/papers/" + encodeURIComponent(paper.slug);
      draft = {
        post_id: postId,
        post_title: sanitize(post.title),
        paper: { slug: paper.slug, title, url, score },
        evidence: abstract,
        reply_draft: "A relevant QNFO paper is “" + title + "”: " + abstract + " Full text: " + url
      };
      break;
    }
    if (!draft) { unmatched++; continue; }
    const evidence = JSON.stringify(draft);
    try {
      await env.AUDIT.prepare(
        "INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested) " +
        "SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11 WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action = ?3)"
      ).bind(
        "qnfo-memory-mcp:exuvia-engage",
        "A needs_response post has a high-confidence match to a published QNFO paper; draft only",
        action,
        evidence,
        "Evidence-backed reply draft prepared; not posted",
        "One Exuvia post and its matched QNFO paper",
        "No external post is made; disable ops_config exuvia_engage to stop drafts; decision_log remains append-only",
        "Exuvia posts can be matched to QNFO research and surfaced as cited response drafts",
        "A relevant paper citation in a draft may help the Exuvia post author find QNFO research; no public effect until separately approved",
        "Potential Exuvia-to-QNFO paper referral; unmeasured",
        "Exuvia needs_response feed, QNFO Vectorize, living-paper D1, qnfo-audit decision_log"
      ).run();
      const stored = await env.AUDIT.prepare("SELECT evidence FROM decision_log WHERE action = ?1 LIMIT 1").bind(action).first();
      if (stored && stored.evidence) drafts.push(JSON.parse(stored.evidence));
      else errors.push({ post_id: postId, error: "draft audit write unavailable" });
    } catch (e) { errors.push({ post_id: postId, error: "draft audit write failed" }); }
  }
  return { posts_seen: posts.length, drafts, unmatched, errors };
}
// ---------------------------------------------------------------------------------------------------------------------------
// FLEET-GRAPH-1 (2.1.0): read-only queries over qnfo-graph fg_node / fg_edge / fg_finding / fg_state.
// Every query is parameterised and bounded (depth, LIMIT, a row cap inside the recursive CTE); no caller SQL is executed.
// ---------------------------------------------------------------------------------------------------------------------------
var FG_KINDS = ["worker", "function", "handler", "class", "binding", "d1", "d1_table", "d1_view", "d1_trigger", "cron", "route", "custom_domain", "queue", "r2", "kv", "vectorize", "workflow", "durable_object", "secret", "external_host", "platform", "migration", "gh_workflow", "script", "container", "analytics_engine", "ai_search", "repo", "doc"];
var FG_NO_IMPACT = ["defines", "drops", "chained_after"];
function fgInt(v, dflt, lo, hi) { const n = parseInt(v, 10); return Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : dflt)); }
function fgStr(v) { return String(v == null ? "" : v).replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, 300); }
function fgAttrs(a) { try { return JSON.parse(a || "{}"); } catch (e) { return {}; } }
function fgHideSecrets(rows, open) { return open ? rows.filter((r) => !String(r.id || r.dst || r.src || "").startsWith("secret:") && !String(r.dst || "").startsWith("secret:") && !String(r.src || "").startsWith("secret:")) : rows; }
async function fgResolve(env, ref) {
  const q = fgStr(ref);
  if (!q) return { error: "id required" };
  const exact = await env.GRAPH_DB.prepare("SELECT id, kind, name, worker FROM fg_node WHERE id = ?1 LIMIT 1").bind(q).first();
  if (exact) return { id: exact.id, node: exact };
  const byName = await env.GRAPH_DB.prepare("SELECT DISTINCT id, kind, name, worker FROM fg_node WHERE name = ?1 LIMIT 12").bind(q).all();
  const rows = byName.results || [];
  if (rows.length === 1) return { id: rows[0].id, node: rows[0] };
  if (rows.length > 1) return { error: "ambiguous: " + rows.length + " nodes are named " + q + "; pass one id", candidates: rows };
  return { error: "no node with id or name " + q + "; use fleet_graph_find" };
}
async function fg_find(env, args) {
  const q = fgStr(args.query || args.q);
  if (!q) return { error: "query required" };
  const kind = FG_KINDS.indexOf(fgStr(args.kind)) >= 0 ? fgStr(args.kind) : null;
  const limit = fgInt(args.limit, 20, 1, 100);
  const sql = "SELECT id, kind, name, worker, path, line, MIN(CASE WHEN id = ?1 OR name = ?1 THEN 0 WHEN instr(lower(name), lower(?1)) = 1 THEN 1 ELSE 2 END) AS rank_ FROM fg_node WHERE (id = ?1 OR name = ?1 OR instr(lower(name), lower(?1)) = 1 OR instr(lower(id), lower(?1)) > 0)" + (kind ? " AND kind = ?2" : "") + " GROUP BY id ORDER BY rank_, length(name), id LIMIT " + limit;
  const st = env.GRAPH_DB.prepare(sql);
  const r = kind ? await st.bind(q, kind).all() : await st.bind(q).all();
  return { query: q, count: (r.results || []).length, results: (r.results || []).map(({ rank_, ...x }) => x) };
}
async function fg_node(env, args, open) {
  const res = await fgResolve(env, args.id);
  if (res.error) return res;
  const limit = fgInt(args.limit, 100, 1, 500);
  const id = res.id;
  const nodes = await env.GRAPH_DB.prepare("SELECT id, scope, kind, name, worker, path, line, attrs, source, updated_at FROM fg_node WHERE id = ?1").bind(id).all();
  const out = await env.GRAPH_DB.prepare("SELECT e.rel, e.dst, e.confidence, e.scope, e.path, n.kind AS dst_kind, n.name AS dst_name FROM fg_edge e LEFT JOIN fg_node n ON n.id = e.dst AND n.scope = e.scope WHERE e.src = ?1 ORDER BY e.rel, e.dst LIMIT " + limit).bind(id).all();
  const inc = await env.GRAPH_DB.prepare("SELECT e.rel, e.src, e.confidence, e.scope, e.path, n.kind AS src_kind, n.name AS src_name FROM fg_edge e LEFT JOIN fg_node n ON n.id = e.src AND n.scope = e.scope WHERE e.dst = ?1 ORDER BY e.rel, e.src LIMIT " + limit).bind(id).all();
  return { id, node: (nodes.results || []).map((n) => Object.assign({}, n, { attrs: fgAttrs(n.attrs) })), out: fgHideSecrets(out.results || [], open), in: fgHideSecrets(inc.results || [], open) };
}
// Level-by-level breadth-first walk with a visited set, one query per level (frontier passed as one JSON parameter), so a
// hub node is expanded once and the cost is bounded by depth x the edges actually touched.
async function fgWalk(env, start, opts) {
  const seen = new Map([[start, { depth: 0, via: null, from: null }]]);
  let frontier = [start];
  const relFilter = " AND e.rel NOT IN ('" + FG_NO_IMPACT.join("','") + "')" + (opts.inferred ? "" : " AND e.confidence <> 'INFERRED'");
  let rowsRead = 0, capped = false;
  for (let d = 1; d <= opts.depth && frontier.length; d++) {
    const next = [];
    for (let i = 0; i < frontier.length; i += 400) {
      const chunk = JSON.stringify(frontier.slice(i, i + 400));
      const parts = [];
      if (opts.mode !== "down") parts.push("SELECT e.dst AS here, e.src AS there, e.rel FROM fg_edge e WHERE e.dst IN (SELECT value FROM json_each(?1))" + relFilter);
      if (opts.mode !== "up") parts.push("SELECT e.src AS here, e.dst AS there, e.rel FROM fg_edge e WHERE e.src IN (SELECT value FROM json_each(?1))" + relFilter);
      const r = await env.GRAPH_DB.prepare(parts.join(" UNION ALL ") + " LIMIT 20000").bind(chunk).all();
      rowsRead += r.meta && r.meta.rows_read || 0;
      for (const x of r.results || []) {
        if (seen.has(x.there)) continue;
        seen.set(x.there, { depth: d, via: x.rel, from: x.here });
        next.push(x.there);
        if (seen.size >= opts.cap) { capped = true; break; }
      }
      if (capped) break;
    }
    if (opts.target && seen.has(opts.target)) break;
    if (capped) break;
    frontier = next;
  }
  return { seen, rowsRead, capped };
}
async function fg_impact(env, args, open) {
  const res = await fgResolve(env, args.id);
  if (res.error) return res;
  const depth = fgInt(args.depth, 3, 1, 6);
  const limit = fgInt(args.limit, 300, 1, 2000);
  const up = fgStr(args.direction || "up") !== "down";
  const w = await fgWalk(env, res.id, { depth, mode: up ? "up" : "down", inferred: !(args.include_inferred === false || args.include_inferred === "false"), cap: 20000 });
  const ids = Array.from(w.seen.keys()).filter((k) => k !== res.id);
  const meta = new Map();
  for (let i = 0; i < ids.length; i += 400) {
    const r = await env.GRAPH_DB.prepare("SELECT id, MAX(kind) AS kind, MAX(name) AS name, MAX(worker) AS worker FROM fg_node WHERE id IN (SELECT value FROM json_each(?1)) GROUP BY id").bind(JSON.stringify(ids.slice(i, i + 400))).all();
    for (const x of r.results || []) meta.set(x.id, x);
  }
  let rows = ids.map((id) => { const s = w.seen.get(id), m = meta.get(id) || {}; return { id, depth: s.depth, via: s.via, from: s.from, kind: m.kind || null, name: m.name || null, worker: m.worker || null }; });
  rows = fgHideSecrets(rows, open).sort((x, y) => x.depth - y.depth || String(x.kind).localeCompare(String(y.kind)) || x.id.localeCompare(y.id));
  const byKind = {}, workers = {};
  for (const x of rows) { byKind[x.kind || "?"] = (byKind[x.kind || "?"] || 0) + 1; const wk = x.worker || (x.kind === "worker" ? x.name : null); if (wk) workers[wk] = Math.min(workers[wk] ?? 99, x.depth); }
  return { id: res.id, direction: up ? "up (what depends on it)" : "down (what it depends on)", depth, count: rows.length, truncated: rows.length > limit || w.capped, by_kind: byKind, workers_affected: workers, results: rows.slice(0, limit), rows_read: w.rowsRead };
}
async function fg_path(env, args, open) {
  const a = await fgResolve(env, args.from), b = await fgResolve(env, args.to);
  if (a.error) return { error: "from: " + a.error, candidates: a.candidates };
  if (b.error) return { error: "to: " + b.error, candidates: b.candidates };
  const maxd = fgInt(args.max_depth, 6, 1, 8);
  for (const mode of ["down", "both"]) {
    const w = await fgWalk(env, a.id, { depth: maxd, mode, inferred: true, cap: 30000, target: b.id });
    if (!w.seen.has(b.id)) continue;
    const steps = []; let cur = b.id;
    while (cur && cur !== a.id) { const s = w.seen.get(cur); steps.unshift(s.from + " -[" + s.via + "]- " + cur); cur = s.from; }
    if (open && steps.some((x) => x.indexOf("secret:") >= 0)) continue;
    return { from: a.id, to: b.id, directed: mode === "down", length: steps.length, path: steps, rows_read: w.rowsRead };
  }
  return { from: a.id, to: b.id, path: null, note: "no path within " + maxd + " steps" };
}
async function fg_worker(env, args, open) {
  const w = fgStr(args.worker).replace(/^worker:/, "");
  if (!w) return { error: "worker required" };
  const wid = "worker:" + w;
  const nodes = (await env.GRAPH_DB.prepare("SELECT scope, attrs, path FROM fg_node WHERE id = ?1").bind(wid).all()).results || [];
  if (!nodes.length) return { error: "no worker " + w + "; use fleet_graph_find with kind worker" };
  const edges = (await env.GRAPH_DB.prepare("SELECT src, rel, dst, scope, confidence FROM fg_edge WHERE src = ?1 AND rel IN ('has_binding','has_cron','serves','has_secret','consumes','produces','runs_container','hosts_workflow','tails_to')").bind(wid).all()).results || [];
  const binds = (await env.GRAPH_DB.prepare("SELECT e.src AS binding, e.dst AS resource, e.scope FROM fg_edge e WHERE e.rel = 'binds' AND instr(lower(e.src), lower(?1)) = 1").bind("binding:" + w + ".").all()).results || [];
  const tables = (await env.GRAPH_DB.prepare("SELECT e.rel, e.dst AS table_id, COUNT(*) AS functions FROM fg_edge e WHERE instr(lower(e.src), lower(?1)) = 1 AND e.rel IN ('reads','writes','creates') AND e.dst LIKE 'd1t:%' GROUP BY e.rel, e.dst ORDER BY e.dst LIMIT 400").bind("fn:" + w + "#").all()).results || [];
  const callsOut = (await env.GRAPH_DB.prepare("SELECT e.dst, e.rel, COUNT(*) AS n FROM fg_edge e WHERE instr(lower(e.src), lower(?1)) = 1 AND e.rel IN ('http_calls','references') GROUP BY e.dst, e.rel ORDER BY n DESC LIMIT 100").bind("fn:" + w + "#").all()).results || [];
  const callsIn = (await env.GRAPH_DB.prepare("SELECT CASE WHEN instr(e.src, '#') > 0 THEN substr(e.src, 4, instr(e.src, '#') - 4) WHEN e.src LIKE 'binding:%' THEN substr(e.src, 9, instr(e.src, '.') - 9) ELSE e.src END AS from_, e.rel, COUNT(*) AS n FROM fg_edge e WHERE e.dst = ?1 AND e.rel IN ('http_calls','references','binds','tails_to') GROUP BY from_, e.rel ORDER BY n DESC LIMIT 100").bind(wid).all()).results || [];
  const findings = (await env.GRAPH_DB.prepare("SELECT kind, subject, severity, detail FROM fg_finding WHERE subject = ?1 OR instr(lower(subject), lower(?2)) = 1 OR instr(lower(subject), lower(?3)) = 1 ORDER BY severity DESC, kind LIMIT 100").bind(w, w + ".", w + ":").all()).results || [];
  const pick = (rel, scope) => edges.filter((e) => e.rel === rel && e.scope === scope).map((e) => e.dst.split(rel === "has_cron" ? "@" : ":").slice(1).join(rel === "has_cron" ? "@" : ":"));
  const resOf = new Map(binds.map((b) => [b.binding + "|" + b.scope, b.resource]));
  const bindingsOf = (scope) => edges.filter((e) => e.rel === "has_binding" && e.scope === scope).map((e) => ({ name: e.dst.slice(("binding:" + w + ".").length), resource: resOf.get(e.dst + "|" + scope) || null }));
  const secrets = edges.filter((e) => e.rel === "has_secret").map((e) => e.dst.slice(("secret:" + w + ".").length));
  return {
    worker: w,
    code: Object.assign({}, fgAttrs((nodes.find((n) => n.scope === "code") || {}).attrs), { path: (nodes.find((n) => n.scope === "code") || {}).path || null }),
    live: fgAttrs((nodes.find((n) => n.scope === "live") || {}).attrs),
    bindings: { declared: bindingsOf("code"), live: bindingsOf("live") },
    crons: { declared: pick("has_cron", "code"), live: pick("has_cron", "live") },
    serves: Array.from(new Set(edges.filter((e) => e.rel === "serves").map((e) => e.dst))),
    queues: edges.filter((e) => e.rel === "consumes" || e.rel === "produces").map((e) => e.rel + " " + e.dst),
    secrets: open ? { count: secrets.length, names: "served to authenticated MCP clients only" } : secrets,
    d1_tables: tables,
    calls_out: callsOut,
    called_by: callsIn,
    findings
  };
}
async function fg_resource(env, args, open) {
  const res = await fgResolve(env, args.id);
  if (res.error) return res;
  const id = res.id;
  const inc = (await env.GRAPH_DB.prepare("SELECT e.rel, e.src, e.confidence, e.scope, n.kind, n.worker FROM fg_edge e LEFT JOIN fg_node n ON n.id = e.src AND n.scope = e.scope WHERE e.dst = ?1 ORDER BY e.rel, e.src LIMIT 800").bind(id).all()).results || [];
  const group = {};
  for (const e of fgHideSecrets(inc, open)) { const k = e.rel; (group[k] = group[k] || []).push({ src: e.src, worker: e.worker || (e.src.startsWith("binding:") ? e.src.slice(8).split(".")[0] : null), confidence: e.confidence, scope: e.scope }); }
  const workers = {};
  for (const [rel, list] of Object.entries(group)) for (const x of list) if (x.worker) (workers[x.worker] = workers[x.worker] || new Set()).add(rel);
  let contains = null;
  if (id.startsWith("d1:")) contains = ((await env.GRAPH_DB.prepare("SELECT kind, COUNT(*) AS n FROM fg_node WHERE id LIKE 'd1%:%' AND instr(lower(substr(id, instr(id, ':') + 1)), lower(?1)) = 1 AND scope = 'live' GROUP BY kind").bind(id.slice(3) + ".").all()).results || []);
  return { id, node: res.node, workers: Object.fromEntries(Object.entries(workers).map(([k, v]) => [k, Array.from(v)])), by_relation: group, contains };
}
async function fg_findings(env, args, open) {
  const where = [], binds = [];
  if (args.kind) { binds.push(fgStr(args.kind)); where.push("kind = ?" + binds.length); }
  if (args.severity) { binds.push(fgStr(args.severity)); where.push("severity = ?" + binds.length); }
  if (args.subject) { binds.push(fgStr(args.subject)); where.push("instr(lower(subject), lower(?" + binds.length + ")) > 0"); }
  const limit = fgInt(args.limit, 200, 1, 1000);
  const st = env.GRAPH_DB.prepare("SELECT kind, subject, severity, detail, first_seen, last_seen FROM fg_finding" + (where.length ? " WHERE " + where.join(" AND ") : "") + " ORDER BY CASE severity WHEN 'warn' THEN 0 ELSE 1 END, kind, subject LIMIT " + limit);
  const r = binds.length ? await st.bind(...binds).all() : await st.all();
  // FULLSCOPE-1: a finding can name a secret (subject "secret:<worker>.<NAME>"); the open routes give counts and
  // non-secret findings only, matching the secret-hiding rule on node/edge views. MCP clients see everything.
  let results = r.results || [];
  if (open) results = results.filter((x) => !String(x.subject || "").startsWith("secret:"));
  const totals = (await env.GRAPH_DB.prepare("SELECT kind, severity, COUNT(*) AS n FROM fg_finding GROUP BY kind, severity ORDER BY severity DESC, n DESC").all()).results || [];
  return { totals, count: results.length, results };
}
async function fg_freshness(env) {
  const r = await env.GRAPH_DB.prepare("SELECT scope, sha, built_at, CAST((julianday('now') - julianday(built_at)) * 1440 AS INTEGER) AS age_min, nodes, edges, written, deleted, ms, status, version FROM fg_state ORDER BY scope").all();
  return { scopes: r.results || [], note: "built by scripts/fleet_graph.mjs (fleet-graph.yml on push to main; remediation-consumer hourly as the second path)" };
}
var FG_ROUTES = { find: fg_find, node: fg_node, impact: fg_impact, path: fg_path, worker: fg_worker, resource: fg_resource, findings: fg_findings, freshness: fg_freshness };
async function fgCall(name, args, env, open) {
  const fn = FG_ROUTES[name];
  if (!fn) return { error: "unknown fleet graph query " + name, queries: Object.keys(FG_ROUTES) };
  try { return await fn(env, args || {}, open); }
  catch (e) { const m = String(e && e.message || e); return { error: /no such table: fg_/.test(m) ? "the fleet graph has not been built yet (fg_* tables missing)" : "query failed: " + m.slice(0, 300) }; }
}
async function fgTool(name, args, env) {
  const out = await fgCall(name.replace(/^fleet_graph_/, ""), args, env, false);
  return { content: [{ type: "text", text: JSON.stringify(out) }], isError: !!out.error };
}
__name(fgTool, "fgTool");
async function callTool(name, args, env) {
  const handlers = {
    search_papers: tool_search_papers,
    search_papers_enriched: tool_search_papers_enriched,
    resolve_paper_id: tool_resolve_paper_id,
    search_memories: tool_search_memories,
    remember_fact: tool_remember_fact,
    recall_facts: tool_recall_facts,
    query_graph: tool_query_graph,
    get_paper_context: tool_get_paper_context,
    exuvia_status: tool_exuvia_status,
    exuvia_feed: tool_exuvia_feed,
    exuvia_paper_post_draft: tool_exuvia_paper_post_draft,
    exuvia_publish_paper: tool_exuvia_publish_paper,
    exuvia_kg_context: tool_exuvia_kg_context,
    exuvia_engage: async (args, env) => exOut(await exuviaEngageTick(env), false)
  };
  if (/^fleet_graph_/.test(String(name))) return await fgTool(name, args, env);
  const fn = handlers[name];
  return fn ? await fn(args, env) : { content: [{ type: "text", text: "Unknown tool: " + name }], isError: true };
}
__name(callTool, "callTool");
function constantTimeEqual(a, b) {
  const ea = new TextEncoder().encode(String(a));
  const eb = new TextEncoder().encode(String(b));
  if (ea.length !== eb.length) return false;
  let out = 0;
  for (let i = 0; i < ea.length; i++) out |= ea[i] ^ eb[i];
  return out === 0;
}
__name(constantTimeEqual, "constantTimeEqual");
// FULLSCOPE-1: bearer header or ?token= query (parity with qnfo-tools-mcp; several SSE clients cannot set headers).
function tokenFrom(u, req) {
  return u.searchParams.get("token") || (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
}
__name(tokenFrom, "tokenFrom");
function scopeFor(token, env) {
  if (env.MCP_TOKEN && constantTimeEqual(token, env.MCP_TOKEN)) return { ok: true, write: true };
  if (env.MCP_READ_TOKEN && constantTimeEqual(token, env.MCP_READ_TOKEN)) return { ok: true, write: false };
  return { ok: false, write: false };
}
__name(scopeFor, "scopeFor");
function rpcOk(id, result) {
  return { jsonrpc: "2.0", id, result };
}
__name(rpcOk, "rpcOk");
function rpcErr(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}
__name(rpcErr, "rpcErr");
function negotiateProtocol(params) {
  const want = params && typeof params === "object" ? params.protocolVersion : null;
  return SUPPORTED_PROTOCOLS.indexOf(want) >= 0 ? want : PROTOCOL_VERSION;
}
__name(negotiateProtocol, "negotiateProtocol");
// FULLSCOPE-1: every tools/call lands in the qnfo-audit mcp_log table when the AUDIT D1 binding is present
// (the binding is optional; without it nothing is logged and nothing breaks). Ids cannot collide.
async function auditLog(env, tool, args, out, sessionId) {
  if (!env.AUDIT) return;
  try {
    await env.AUDIT.prepare("CREATE TABLE IF NOT EXISTS mcp_log (id TEXT PRIMARY KEY, ts TEXT, tool TEXT, args TEXT, result TEXT, session TEXT)").run();
    await env.AUDIT.prepare("INSERT INTO mcp_log (id, ts, tool, args, result, session) VALUES (?1,?2,?3,?4,?5,?6)").bind("mcp-" + Date.now().toString(36) + "-" + crypto.randomUUID().slice(0, 8), (/* @__PURE__ */ new Date()).toISOString(), String(tool).slice(0, 120), JSON.stringify(args || {}).slice(0, 2e3), JSON.stringify(out).slice(0, 4e3), sessionId || "").run();
  } catch (e) {
  }
}
__name(auditLog, "auditLog");
// One JSON-RPC message against the MCP surface. Returns null for notifications (no id): they are never answered.
async function handleRpc(body, env, scope, sessionId) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { err: rpcErr(null, -32600, "Invalid Request: body must be a JSON-RPC object") };
  const method = body.method, params = body.params, id = body.id;
  const isNotification = id === void 0;
  if (typeof method !== "string" || !method) return { err: isNotification ? null : rpcErr(id, -32600, "Invalid Request: method required") };
  if (method === "initialize") {
    return { out: rpcOk(id, { protocolVersion: negotiateProtocol(params), capabilities: { tools: { listChanged: false } }, serverInfo: { name: SERVER_NAME, version: SERVER_VERSION } }) };
  }
  if (method.indexOf("notifications/") === 0 || method === "initialized") return { out: null };
  if (method === "ping") return { out: isNotification ? null : rpcOk(id, {}) };
  if (method === "tools/list") return { out: rpcOk(id, { tools: scope.write ? TOOLS : TOOLS.filter((t) => WRITE_TOOLS.indexOf(t.name) < 0) }) };
  // FULLSCOPE-1: clients probing resources/prompts on connect get empty lists, not -32601.
  if (method === "resources/list") return { out: rpcOk(id, { resources: [] }) };
  if (method === "resources/templates/list") return { out: rpcOk(id, { resourceTemplates: [] }) };
  if (method === "prompts/list") return { out: rpcOk(id, { prompts: [] }) };
  if (method === "tools/call") {
    const p = params && typeof params === "object" ? params : null;
    const name = p ? String(p.name || "") : "";
    if (!name) return { err: rpcErr(id, -32602, "Invalid params: tools/call needs params.name") };
    if (TOOLS.every((t) => t.name !== name) && !/^fleet_graph_/.test(name)) return { err: rpcErr(id, -32602, "unknown tool: " + name) };
    if (!scope.write && WRITE_TOOLS.indexOf(name) >= 0) return { err: rpcErr(id, -32003, "forbidden: token lacks write scope for '" + name + "'") };
    const args = p.arguments && typeof p.arguments === "object" && !Array.isArray(p.arguments) ? p.arguments : {};
    try {
      const toolResult = await callTool(name, args, env);
      await auditLog(env, name, args, toolResult, sessionId);
      return { out: isNotification ? null : rpcOk(id, toolResult) };
    } catch (e) {
      return { err: isNotification ? null : rpcErr(id == null ? null : id, -32603, "Tool error: " + (e && e.message ? e.message : String(e))) };
    }
  }
  return { err: isNotification ? null : rpcErr(id == null ? null : id, -32601, "Method not found: " + method) };
}
__name(handleRpc, "handleRpc");
// FULLSCOPE-1: JSON-RPC batch support. A batch answers with an array; notifications inside it drop out.
async function handleRpcBody(body, env, scope, sessionId) {
  if (Array.isArray(body)) {
    if (!body.length) return { batch: true, frames: [rpcErr(null, -32600, "Invalid Request: empty batch")] };
    const frames = [];
    for (const b of body) {
      const r = await handleRpc(b, env, scope, sessionId);
      const f = r.out !== void 0 ? r.out : r.err;
      if (f) frames.push(f);
    }
    return { batch: true, frames: frames.length ? frames : null };
  }
  const r = await handleRpc(body, env, scope, sessionId);
  return { batch: false, frames: (r.out !== void 0 ? r.out : r.err) || null };
}
__name(handleRpcBody, "handleRpcBody");
var sessions = /* @__PURE__ */ new Map();
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
    if (url.pathname === "/health") {
      return json({ status: "ok", server: SERVER_NAME, version: SERVER_VERSION, protocol: SUPPORTED_PROTOCOLS, auth: !!env.MCP_TOKEN, read_token: !!env.MCP_READ_TOKEN, query_token: true, exuvia_key: !!env.EXUVIA_API_KEY, audit: !!env.AUDIT, capabilities: ["mcp", "sse", "streamable-http", "persistent-memory", "knowledge-graph", "vector-recall", "fleet-graph"], limitations: ["bearer token or ?token= required on /mcp, /mcp/sse and /mcp/messages", "fails closed (503) when no token is configured", "the tool list is served only to authenticated clients", "GET /fleet-graph/* is open and read-only (OPEN-ACCESS-1); secret names are withheld there", "write tools (remember_fact, exuvia_publish_paper) need the full MCP_TOKEN, not MCP_READ_TOKEN"] });
    }
    // FLEET-GRAPH-1: open, read-only, parameterised queries (OPEN-ACCESS-1). No caller SQL, bounded depth and rows.
    if (url.pathname === "/fleet-graph" || url.pathname === "/fleet-graph/") {
      return json({ graph: "qnfo fleet code + topology graph (FLEET-GRAPH-1)", queries: Object.keys(FG_ROUTES).map((q) => "/fleet-graph/" + q), examples: ["/fleet-graph/find?query=agent_issues", "/fleet-graph/impact?id=d1t:qnfo-audit.agent_issues&depth=2", "/fleet-graph/worker?worker=qnfo-ops", "/fleet-graph/findings?severity=warn", "/fleet-graph/freshness"], snapshot: "R2 qnfo-backups/fleet-graph/latest.json.gz (node-link JSON)" });
    }
    if (url.pathname.startsWith("/fleet-graph/") && request.method === "GET") {
      const q = url.pathname.slice("/fleet-graph/".length).replace(/\/+$/, "");
      const args = Object.fromEntries(url.searchParams.entries());
      const out = await fgCall(q, args, env, true);
      const r = json(out, out.error ? (/^unknown/.test(out.error) ? 404 : /not been built/.test(out.error) ? 503 : 400) : 200);
      if (!out.error) r.headers.set("Cache-Control", "public, max-age=60");
      return r;
    }
    // MCP-AUTH-1 (2026-09-30, closes the external red-team finding "qnfo-memory-mcp is
    // unauthenticated"): anonymous tools/list + arbitrary query_graph SQL + a remember_fact WRITE
    // were reachable. Bearer/?token= gate with a constant-time compare; fail CLOSED (503) when no
    // token is configured. /health stays open but slim (no tool list / binding detail).
    if (!env.MCP_TOKEN && !env.MCP_READ_TOKEN) return json({ error: "server_misconfigured", detail: "MCP_TOKEN not set" }, 503);
    // FULLSCOPE-1: /mcp/messages authenticates by a live SSE session OR a token, exactly like qnfo-tools-mcp;
    // a token-only POST with no session gets the result inline instead of a dropped 202.
    if (url.pathname === "/mcp/messages" && request.method === "POST") {
      const sessionId = url.searchParams.get("sessionId") || "";
      const sess = sessions.get(sessionId);
      const sc = scopeFor(tokenFrom(url, request), env);
      if (!sess && !sc.ok) return json({ error: "unauthorized" }, 401);
      let body;
      try {
        body = await request.json();
      } catch (e) {
        return json({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null }, 400);
      }
      const scope = sess ? { ok: true, write: !!sess.write } : sc;
      const handled = await handleRpcBody(body, env, scope, sessionId || null);
      if (sess) {
        if (handled.frames) {
          const encoder = new TextEncoder();
          const frames = handled.batch ? handled.frames : [handled.frames];
          for (const f of frames) sess.c.enqueue(encoder.encode("event: message" + NL + "data: " + JSON.stringify(f) + NL + NL));
        }
        return new Response("Accepted", { status: 202, headers: corsHeaders() });
      }
      if (!handled.frames) return new Response(null, { status: 202, headers: corsHeaders() });
      return json(handled.frames);
    }
    const scope = scopeFor(tokenFrom(url, request), env);
    if (!scope.ok) return json({ error: "unauthorized" }, 401);
    if (url.pathname === "/mcp/sse" && request.method === "GET") {
      // FULLSCOPE-1: a real SSE transport (the old stub pushed one non-standard event and closed after 100 ms).
      // Spec shape: an `event: endpoint` frame naming the POST URI, then keepalives; JSON-RPC answers arrive as
      // `event: message` frames after the client POSTs to /mcp/messages?sessionId=...
      const sessionId = crypto.randomUUID();
      const encoder = new TextEncoder();
      let keep;
      const stream = new ReadableStream({
        start(controller) {
          sessions.set(sessionId, { c: controller, write: scope.write });
          controller.enqueue(encoder.encode("event: endpoint" + NL + "data: " + url.origin + "/mcp/messages?sessionId=" + sessionId + NL + NL));
          keep = setInterval(() => {
            try {
              controller.enqueue(encoder.encode(": keepalive" + NL + NL));
            } catch (e) {
            }
          }, 15e3);
        },
        cancel() {
          clearInterval(keep);
          sessions.delete(sessionId);
        }
      });
      return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive", ...corsHeaders() } });
    }
    if (url.pathname === "/mcp" && request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch (e) {
        return json({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null }, 400);
      }
      const handled = await handleRpcBody(body, env, scope, null);
      if (!handled.frames) return new Response(null, { status: 202, headers: corsHeaders() });
      return json(handled.frames);
    }
    if (url.pathname === "/mcp" && request.method === "GET") {
      // Streamable-HTTP server stream is not offered here; SSE lives at /mcp/sse.
      return json({ error: "method_not_allowed", detail: "POST JSON-RPC here, or open the SSE stream at /mcp/sse" }, 405);
    }
    return json({ error: "Not found", path: url.pathname }, 404);
  }
};
export {
  worker_default as default
};
