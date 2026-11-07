var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var PROTOCOL_VERSION = "2024-11-05";
var SUPPORTED_PROTOCOLS = ["2024-11-05", "2025-03-26", "2025-06-18"];
var NL = String.fromCharCode(10);
var SERVER_NAME = "qnfo-memory-mcp";
var VERSION = "2.11.4-codeagent";
/* 2.7.2: Batch semantic memory D1 enrichment to one query per search. */ /* 2.7.1 #6612 (pillar autonomy): literal graph searches avoid D1's 50-byte LIKE pattern limit. */ /* 2.7.0 EXUVIA-ENGAGE-1 (2026-11-03, pillar reach): evidence-matched drafts for Exuvia posts needing a response, deduplicated and logged to decision_log; no comment is sent. */ /* 2.5.0 FULLSCOPE-1 (2026-10-31): the SSE transport is real (session + /mcp/messages + keepalive, spec event:endpoint; the old stub closed after 100 ms); ?token= query auth parity with qnfo-tools-mcp; optional MCP_READ_TOKEN read-only scope (write tools: remember_fact, exuvia_publish_paper); ping, prompts/list, resources/templates/list, JSON-RPC batch, -32602 on malformed tools/call, protocolVersion negotiation; remember_fact keeps up to 8000 chars (was silently truncated at 800), clamps importance to 0-1 and enforces its own category enum; the open /fleet-graph/findings route no longer leaks secret: subjects; every tools/call is audit-logged when an AUDIT D1 binding is present. */ /* 2.4.0 REPO-GRAPH-1 (2026-10-29, pillar autonomy; minor: fleet_graph_find and /fleet-graph/find now accept the kinds repo and doc, so a repository or a document is found by name like a worker). */ // 2.3.2 EXUVIA-2 (2026-10-28, pillar reach): /health reports exuvia_key (boolean only) so the owner card that waits for the Exuvia key closes by a runtime probe. // 2.3.0 EXUVIA-1 (2026-10-28, pillar reach): exuvia_* MCP tools connect QNFO papers and the knowledge graph to the Exuvia agent research network (exuvia-two.vercel.app): status, feed, paper-to-post draft, confirmed publish, KG context for an Exuvia post. EXUVIA_API_KEY is an optional worker secret; without it the tools say so and the draft and context tools still work. // 2.2.0 NO-REGISTRAR-1 (2026-10-21): dead DOIs recognised by the 10.5281 prefix only; the registrar is not named. // 2.1.0 FLEET-GRAPH-1 (2026-10-19, pillar autonomy): the fleet code + topology graph (qnfo-graph fg_* tables, built by scripts/fleet_graph.mjs) as MCP tools fleet_graph_* and open read-only GET /fleet-graph/* routes: find, node, impact (blast radius), path, worker, resource, findings, freshness. Secret NAMES are served only to authenticated MCP clients; the open routes give counts.
// WORKERS-AI-ATTRIBUTION-1 (2026-10-01, #1681): per-worker Workers AI attribution. Returns a shallow env copy whose AI
// binding records each .run() (calls, errors, ms, tokens, neurons) into qnfo-audit ai_call_counters (purpose 'binding').
// Neurons = usage tokens x Cloudflare's published per-model rates (neurons per M tokens). Fail-soft; env is never mutated.
var __AI_ATTR_RATES = { "@cf/zai-org/glm-5.3": [127273, 400000], "@cf/zai-org/glm-5.3-flash": [13636, 45455], "@cf/nvidia/nemotron-3-120b-a12b": [45455, 136364], "@cf/moonshotai/kimi-k2.6": [86364, 363636], "@cf/moonshotai/kimi-k2.7-code": [86364, 363636], "@cf/openai/gpt-oss-120b": [31818, 68182], "@cf/openai/gpt-oss-20b": [18182, 27273], "@cf/deepseek-ai/deepseek-v4-pro-0813": [120000, 360000], "@cf/deepseek-ai/deepseek-v4-flash-0731": [40000, 120000], "@cf/meta/llama-3.3-70b-instruct-fp8-fast": [26668, 204805], "@cf/qwen/qwen3-30b-a3b-fp8": [4625, 30475], "@cf/qwen/qwen3.8-27b": [40909, 290909], "@cf/baai/bge-base-en-v1.5": [6058, 0], "@cf/baai/bge-small-en-v1.5": [1841, 0], "@cf/baai/bge-large-en-v1.5": [18582, 0] };
function __aiAttrEnv(env, worker, aiKey, dbKey) {
  try {
    if (!env || env.__aiAttr) return env;
    var ai = env[aiKey], db = env[dbKey];
    if (!ai || typeof ai.run !== "function" || !db) return env;
    var wrapped = new Proxy(ai, { get: function (t, p) {
      if (p !== "run") { var v = Reflect.get(t, p); return typeof v === "function" ? v.bind(t) : v; }
      return async function (model, input, opts) {
        var t0 = Date.now(), ok = 1, res;
        try { res = await t.run(model, input, opts); return res; } catch (e) { ok = 0; throw e; }
        finally {
          try {
            var u = res && typeof res === "object" && res.usage || {};
            var chars = 0; try { chars = JSON.stringify(input && (input.messages || input.prompt || input.text) || input || "").length; } catch (e1) {}
            var inTok = Number(u.prompt_tokens || u.input_tokens || 0) || Math.round(chars / 4);
            var outTok = Number(u.completion_tokens || u.output_tokens || 0);
            var r = __AI_ATTR_RATES[String(model)] || [0, 0];
            var neurons = (inTok * r[0] + outTok * r[1]) / 1e6;
            await db.prepare("INSERT INTO ai_call_counters (day, worker, purpose, model, calls, errors, in_chars, ms, in_tok, out_tok, neurons) VALUES (?1,?2,'binding',?3,1,?4,?5,?6,?7,?8,?9) ON CONFLICT(day, worker, purpose, model) DO UPDATE SET calls=calls+1, errors=errors+excluded.errors, in_chars=in_chars+excluded.in_chars, ms=ms+excluded.ms, in_tok=in_tok+excluded.in_tok, out_tok=out_tok+excluded.out_tok, neurons=neurons+excluded.neurons")
              .bind(new Date().toISOString().slice(0, 10), worker, String(model).slice(0, 120), ok ? 0 : 1, chars, Date.now() - t0, inTok, outTok, neurons).run();
          } catch (e2) {}
        }
      };
    } });
    var copy = Object.assign({}, env);
    copy[aiKey] = wrapped;
    copy.__aiAttr = 1;
    return copy;
  } catch (e) {
    return env;
  }
}
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
  { name: "search_memories", description: "Semantic search across persistent agent memories. rank=similarity (default) keeps the vector order; rank=weighted applies a mild age decay and the outcome factor from memory_outcome. Each result carries its tier and role.", inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number", default: 5 }, category: { type: "string" }, rank: { type: "string", enum: ["similarity", "weighted"], default: "similarity" } }, required: ["query"] }, annotations: { readOnlyHint: true } },
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
  { name: "fleet_graph_freshness", description: "When each graph scope (code, live, findings) was last built, from which commit, and how many rows changed.", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
  { name: "kg_health", description: "Health of the content knowledge graph: orphan share, edge density, giant-component share, papers with no content relation, duplicate groups, similarity precision proxy, edges by source and relationship, age of the last curation and a trend. Start here.", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
  { name: "kg_find", description: "Find content graph nodes (papers, concepts, tags, works, workers, issues, metrics, failure modes, decisions ...) by id or name.", inputSchema: { type: "object", properties: { query: { type: "string" }, label: { type: "string" }, limit: { type: "number" } }, required: ["query"] }, annotations: { readOnlyHint: true } },
  { name: "kg_node", description: "One content graph node with its active edges both ways (relationship, weight, confidence, origin: legacy or the kg: source that derived it), PageRank, component and community.", inputSchema: { type: "object", properties: { id: { type: "string" }, limit: { type: "number" }, include_stale: { type: "boolean" } }, required: ["id"] }, annotations: { readOnlyHint: true } },
  { name: "kg_neighbors", description: "Ego graph around a node, depth 1-3, structural CONTAINS edges and hub nodes (tags, categories) hidden by default: nodes with label, PageRank and community, plus every active edge between them.", inputSchema: { type: "object", properties: { id: { type: "string" }, depth: { type: "number" }, limit: { type: "number" }, structural: { type: "boolean" }, hubs: { type: "boolean" }, min_weight: { type: "number" } }, required: ["id"] }, annotations: { readOnlyHint: true } },
  { name: "kg_path", description: "Shortest path between two content graph nodes: semantic edges first, structural edges as the fallback.", inputSchema: { type: "object", properties: { from: { type: "string" }, to: { type: "string" }, max_depth: { type: "number" } }, required: ["from", "to"] }, annotations: { readOnlyHint: true } },
  { name: "kg_central", description: "The most central nodes by PageRank over non-structural edges, optionally for one label (Paper, Concept, Worker ...).", inputSchema: { type: "object", properties: { label: { type: "string" }, limit: { type: "number" } } }, annotations: { readOnlyHint: true } },
  { name: "kg_gaps", description: "Open graph gaps: isolated papers, bridge papers across communities, and link candidates (two papers with shared neighbours and no link).", inputSchema: { type: "object", properties: { kind: { type: "string" }, limit: { type: "number" } } }, annotations: { readOnlyHint: true } },
  { name: "kg_orphans", description: "Active nodes with no active edge at all, optionally for one label.", inputSchema: { type: "object", properties: { label: { type: "string" }, limit: { type: "number" } } }, annotations: { readOnlyHint: true } },
  { name: "kg_communities", description: "Paper communities (label propagation over citation, similarity and coupling edges) with their size and representative.", inputSchema: { type: "object", properties: { limit: { type: "number" } } }, annotations: { readOnlyHint: true } }
];
// FULLSCOPE-1: write-scope tools. MCP_TOKEN is the full read+write credential; MCP_READ_TOKEN (optional)
// grants read tools only, the same split as qnfo-tools-mcp (MCP-TOKEN-NO-SCOPE-SEPARATION, 954).
var WRITE_TOOLS = ["remember_fact", "memory_outcome", "exuvia_publish_paper", "exuvia_engage"];
var MEM_CATEGORIES = ["user_preference", "project_fact", "task_outcome", "heuristic", "anti_pattern"];
// MEMORY-TIERING-1 (agent_issues 1000637): a memory row is episodic (what an agent wrote) or semantic (distilled from episodic rows by consolidation, which is
// not built yet). remember_fact writes episodic rows only; a row with no tier (everything written before 2026-10-28) is read as episodic.
var MEM_TIERS = ["episodic", "semantic"];
var MEM_TIERS_WRITABLE = ["episodic"];
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
  // MEMORY-TIERING-1: rank=similarity (default) keeps the vector order, as before. rank=weighted reads every candidate (at most 50) and orders them by
  // score x age factor x outcome factor, both factors mild so relevance still dominates: the age factor falls from 1 to 0.85 with a 90-day half-life of the
  // difference, the outcome factor is 1 + 0.15 x (successes - failures) / (successes + failures + 3), in (0.85, 1.15), from memory_outcome records.
  const weighted = String(args.rank || "similarity") === "weighted";
  if (!query) return { content: [{ type: "text", text: JSON.stringify({ error: "query required" }) }], isError: true };
  const vec = await embed(env, query);
  const res = await env.PAPER_VZ.query(vec, { topK: Math.min(limit * 5, 50), returnMetadata: "all", returnValues: false });
  let matches = (res.matches || []).filter((m) => m.id.startsWith("mem:"));
  if (category) matches = matches.filter((m) => m.id.startsWith("mem:" + category + ":"));
  const pool = weighted ? matches : matches.slice(0, limit);
  const records = new Map();
  if (pool.length) {
    const rec = await env.GRAPH_DB.prepare(
      "SELECT id, category, content, summary, importance, session_id, created_at, CASE WHEN json_valid(metadata_json) THEN json_extract(metadata_json, '$.tier') END AS tier, CASE WHEN json_valid(metadata_json) THEN json_extract(metadata_json, '$.role') END AS role FROM agent_memories WHERE id IN (SELECT value FROM json_each(?1))"
    ).bind(JSON.stringify(pool.map((m) => m.id))).all().catch(() => ({ results: [] }));
    for (const row of rec.results || []) records.set(row.id, row);
  }
  let ranked = pool.map((m) => ({ m }));
  if (weighted && pool.length) {
    const outcomes = new Map();
    if (env.AUDIT) {
      const oc = await env.AUDIT.prepare(
        "SELECT memory_id, SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END) AS s, SUM(CASE WHEN outcome = 'failure' THEN 1 ELSE 0 END) AS f FROM memory_outcomes WHERE memory_id IN (SELECT value FROM json_each(?1)) GROUP BY memory_id"
      ).bind(JSON.stringify(pool.map((m) => m.id))).all().catch(() => ({ results: [] }));
      for (const row of oc.results || []) outcomes.set(row.memory_id, { s: Number(row.s) || 0, f: Number(row.f) || 0 });
    }
    const now = Date.now();
    ranked = pool.map((m) => {
      const t = Date.parse(records.get(m.id)?.created_at || "");
      const age_days = Number.isFinite(t) ? Math.max(0, (now - t) / 864e5) : null;
      const o = outcomes.get(m.id) || { s: 0, f: 0 };
      const rank_score = (m.score || 0) * (age_days === null ? 1 : 0.85 + 0.15 * Math.pow(0.5, age_days / 90)) * (1 + 0.15 * (o.s - o.f) / (o.s + o.f + 3));
      return { m, rank_score: Math.round(rank_score * 1e6) / 1e6, age_days: age_days === null ? null : Math.round(age_days * 10) / 10, outcomes: { success: o.s, failure: o.f } };
    }).sort((a, b) => b.rank_score - a.rank_score).slice(0, limit);
  }
  const results = ranked.map((x) => {
    const m = x.m;
    const rec = records.get(m.id);
    const row = {
      id: m.id,
      score: m.score,
      category: rec?.category || m.metadata?.category || null,
      content: rec?.content || m.metadata?.content || null,
      summary: rec?.summary || null,
      importance: rec?.importance || null,
      session_id: rec?.session_id || null,
      created_at: rec?.created_at || null,
      tier: rec?.tier || (rec ? "episodic" : null),
      role: rec?.role || null
    };
    if (weighted) { row.rank_score = x.rank_score; row.age_days = x.age_days; row.outcomes = x.outcomes; }
    return row;
  });
  // the default reply keeps its old shape; only a weighted reply names its ranking
  return { content: [{ type: "text", text: JSON.stringify(weighted ? { count: results.length, rank: "weighted", results } : { count: results.length, results }) }] };
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
  // MEMORY-TIERING-1: tier (episodic by default), role (who wrote it, agent by default) and a provenance note sit next to source in metadata_json, so the
  // consolidation step that comes later has a field to select on. Only episodic can be written here: semantic rows come from consolidation.
  const tier = args.tier ? sanitize(args.tier) : "episodic";
  if (MEM_TIERS_WRITABLE.indexOf(tier) < 0) return { content: [{ type: "text", text: JSON.stringify({ error: "tier must be one of " + MEM_TIERS_WRITABLE.join(", ") + " (semantic rows are written by consolidation)" }) }], isError: true };
  const role = args.role ? sanitize(args.role).slice(0, 40) : "agent";
  const provenance = args.provenance ? sanitize(args.provenance).slice(0, 200) : null;
  const metadata_json = JSON.stringify({ source: "qnfo-memory-mcp", timestamp: created_at, tier, role, provenance });
  await env.GRAPH_DB.prepare(
    "INSERT OR REPLACE INTO agent_memories (id, category, content, summary, importance, session_id, created_at, expires_at, metadata_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, ?8)"
  ).bind(id, category, content, summary, importance, session_id, created_at, metadata_json).run();
  const vec = await embed(env, content);
  await env.PAPER_VZ.upsert([{
    id,
    values: vec,
    metadata: { kind: "memory", category, content: content.slice(0, 800) }
  }]);
  return { content: [{ type: "text", text: JSON.stringify({ success: true, id, category, importance, created_at, tier, role }) }] };
}
__name(tool_remember_fact, "tool_remember_fact");
// MEMORY-TIERING-1 (agent_issues 1000637): outcome records and the numbers the consolidation work will be judged on. memory_outcome stores one success or
// failure per (memory_id, feedback_id) in qnfo-audit.memory_outcomes (migrations/2026-11-05-memory-tiering-store.sql); memory_tiering_metrics reads the tier
// counts from agent_memories, the consolidation runs (none yet: consolidation is not built) and the 7 and 30 day outcome hit rates (successes over successes
// plus failures). A row with no tier counts as episodic in episodic_effective, so the figure is the same before and after the first tiered write.
async function tool_memory_outcome(args, env) {
  const fail = (message) => ({ content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true });
  const memory_id = sanitize(args.memory_id);
  const outcome = sanitize(args.outcome);
  const feedback_id = sanitize(args.feedback_id).slice(0, 120);
  const provenance = args.provenance ? sanitize(args.provenance).slice(0, 200) : null;
  if (!/^mem:[a-z_]+:\d+:[0-9a-f]{8}$/.test(memory_id)) return fail("memory_id must be a mem:<category>:<time>:<hash> id returned by remember_fact or search_memories");
  if (outcome !== "success" && outcome !== "failure") return fail("outcome must be success or failure");
  if (!feedback_id) return fail("feedback_id required: the same memory_id and feedback_id is recorded once");
  if (!env.AUDIT) return fail("outcome store unavailable: AUDIT binding absent");
  const known = await env.GRAPH_DB.prepare("SELECT id FROM agent_memories WHERE id = ?1").bind(memory_id).first();
  if (!known) return fail("unknown memory " + memory_id);
  try {
    const ins = await env.AUDIT.prepare("INSERT OR IGNORE INTO memory_outcomes (memory_id, outcome, feedback_id, provenance, ts) VALUES (?1, ?2, ?3, ?4, ?5)")
      .bind(memory_id, outcome, feedback_id, provenance, new Date().toISOString()).run();
    const recorded = Number(ins && ins.meta && ins.meta.changes) > 0;
    let stored = outcome;
    if (!recorded) {
      const prior = await env.AUDIT.prepare("SELECT outcome FROM memory_outcomes WHERE memory_id = ?1 AND feedback_id = ?2").bind(memory_id, feedback_id).first();
      stored = prior ? prior.outcome : outcome;
    }
    return { content: [{ type: "text", text: JSON.stringify({ success: true, memory_id, feedback_id, recorded, duplicate: !recorded, outcome: stored, conflict: stored !== outcome }) }] };
  } catch (e) {
    return fail("outcome store unavailable: " + String(e && e.message || e).slice(0, 200));
  }
}
__name(tool_memory_outcome, "tool_memory_outcome");
async function memoryTierRows(env) {
  const rows = await env.GRAPH_DB.prepare(
    "SELECT CASE WHEN json_valid(metadata_json) THEN COALESCE(json_extract(metadata_json, '$.tier'), 'untiered') ELSE 'untiered' END AS tier, CASE WHEN json_valid(metadata_json) THEN COALESCE(json_extract(metadata_json, '$.role'), 'unknown') ELSE 'unknown' END AS role, COUNT(*) AS n, MIN(created_at) AS oldest, MAX(created_at) AS newest FROM agent_memories GROUP BY 1, 2"
  ).all();
  return rows.results || [];
}
async function tool_memory_tiering_metrics(args, env) {
  const out = { generated_at: new Date().toISOString(), tiers: [], episodic_effective: 0, semantic: 0, consolidation: null, outcomes: null };
  out.tiers = await memoryTierRows(env);
  for (const r of out.tiers) {
    if (r.tier === "semantic") out.semantic += Number(r.n) || 0;
    else out.episodic_effective += Number(r.n) || 0;
  }
  if (!env.AUDIT) { out.consolidation = { error: "AUDIT binding absent" }; out.outcomes = { error: "AUDIT binding absent" }; return { content: [{ type: "text", text: JSON.stringify(out) }] }; }
  try {
    const c = await env.AUDIT.prepare("SELECT COUNT(*) AS runs, COALESCE(SUM(episodic_in), 0) AS episodic_in, COALESCE(SUM(semantic_out), 0) AS semantic_out, MAX(ts) AS last_run FROM memory_consolidation_runs").first();
    out.consolidation = { runs: Number(c && c.runs) || 0, episodic_in: Number(c && c.episodic_in) || 0, semantic_out: Number(c && c.semantic_out) || 0, last_run: (c && c.last_run) || null };
  } catch (e) { out.consolidation = { error: String(e && e.message || e).slice(0, 200) }; }
  try {
    out.outcomes = {};
    for (const days of [7, 30]) {
      const since = new Date(Date.now() - days * 864e5).toISOString();
      const o = await env.AUDIT.prepare("SELECT COALESCE(SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END), 0) AS s, COALESCE(SUM(CASE WHEN outcome = 'failure' THEN 1 ELSE 0 END), 0) AS f FROM memory_outcomes WHERE ts >= ?1").bind(since).first();
      const s = Number(o && o.s) || 0, f = Number(o && o.f) || 0;
      out.outcomes["d" + days] = { success: s, failure: f, hit_rate: s + f > 0 ? Math.round(s / (s + f) * 1e4) / 1e4 : null };
    }
  } catch (e) { out.outcomes = { error: String(e && e.message || e).slice(0, 200) }; }
  return { content: [{ type: "text", text: JSON.stringify(out) }] };
}
__name(tool_memory_tiering_metrics, "tool_memory_tiering_metrics");
// Hourly: one snapshot of the tier counts into qnfo-audit.memory_tier_counts, so the counts have a history (v_memory_tier_latest, v_memory_tiering) next to the
// outcome hit rates. A failed snapshot is logged and never stops the Exuvia tick that shares the cron.
async function memoryTierSnapshot(env) {
  if (!env.AUDIT) return { skipped: "AUDIT binding absent" };
  try {
    // --- snapshot tier counts (existing behavior) ---
    const rows = await memoryTierRows(env);
    const ts = new Date().toISOString().slice(0, 13) + ":00:00Z";
    for (const r of rows) {
      await env.AUDIT.prepare(
        "INSERT OR REPLACE INTO memory_tier_counts (ts, tier, role, n, oldest, newest) VALUES (?1, ?2, ?3, ?4, ?5, ?6)"
      )
        .bind(ts, String(r.tier), String(r.role), Number(r.n) || 0, r.oldest || null, r.newest || null)
        .run();
    }

    // --- bounded consolidation step (new) ---
    // Process at most 20 episodic memories older than 7 days, grouped by category.
    const cutoff = new Date(Date.now() - 7 * 864e5).toISOString();
    const consolidRows = await env.GRAPH_DB.prepare(
      `SELECT id, category, content, summary, importance, session_id, created_at,
              CASE WHEN json_valid(metadata_json) THEN json_extract(metadata_json, '$.role') END AS role
       FROM agent_memories
       WHERE json_valid(metadata_json)
         AND json_extract(metadata_json, '$.tier') = 'episodic'
         AND created_at < ?
       ORDER BY category, created_at
       LIMIT 20`
    )
      .bind(cutoff)
      .all();

    let episodicCount = 0;
    let semanticCount = 0;

    if (consolidRows.results && consolidRows.results.length) {
      for (const r of consolidRows.results) {
        // Create a new semantic memory entry based on the episodic one.
        const nowMs = Date.now();
        const newId = "mem:semantic:" + nowMs + ":" + (await sha256hex(r.content || "").slice(0, 8));
        const created_at = new Date().toISOString();
        const provenance = "consolidated from " + r.id;
        const metadata_json = JSON.stringify({
          source: "qnfo-memory-mcp",
          timestamp: created_at,
          tier: "semantic",
          role: r.role || "agent",
          provenance,
        });

        // Insert the new semantic row.
        await env.GRAPH_DB.prepare(
          "INSERT OR REPLACE INTO agent_memories (id, category, content, summary, importance, session_id, created_at, expires_at, metadata_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, ?8)"
        )
          .bind(newId, r.category, r.content, r.summary, r.importance, r.session_id, created_at, metadata_json)
          .run();

        // Upsert the vector for the new semantic row.
        const vec = await embed(env, r.content);
        await env.PAPER_VZ.upsert([
          {
            id: newId,
            values: vec,
            metadata: { kind: "memory", category: r.category, content: (r.content || "").slice(0, 800) },
          },
        ]);

        // Delete the original episodic row.
        await env.GRAPH_DB.prepare("DELETE FROM agent_memories WHERE id = ?1").bind(r.id).run();

        episodicCount++;
        semanticCount++;
      }

      // Record the consolidation run.
      const runTs = new Date().toISOString();
      await env.AUDIT.prepare(
        "INSERT INTO memory_consolidation_runs (ts, episodic_in, semantic_out) VALUES (?1, ?2, ?3)"
      )
        .bind(runTs, episodicCount, semanticCount)
        .run();
    }

    // --- decay stale episodic memories (new) ---
    // Remove episodic rows older than 30 days that were not consolidated.
    const decayCutoff = new Date(Date.now() - 30 * 864e5).toISOString();
    await env.GRAPH_DB.prepare(
      `DELETE FROM agent_memories
       WHERE json_valid(metadata_json)
         AND json_extract(metadata_json, '$.tier') = 'episodic'
         AND created_at < ?`
    )
      .bind(decayCutoff)
      .run();

    // Return snapshot info plus consolidation summary.
    return {
      ts,
      rows: rows.length,
      consolidation: { processed: episodicCount, created_semantic: semanticCount },
    };
  } catch (e) {
    const error = String(e && e.message || e).slice(0, 200);
    console.error(JSON.stringify({ worker: SERVER_NAME, where: "memory-tier-snapshot", error }));
    return { error };
  }
}
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
  const near = [];
  let unmatched = 0, best = 0;   // best: the highest vector score any post reached, so a quiet feed can be told from a threshold that is too high
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
    for (const m of matches) { const sc = Number(m && m.score); if (Number.isFinite(sc) && sc > best) best = sc; }
    const top = matches.filter((m) => m && m.slug && Number.isFinite(Number(m.score))).sort((a, b) => Number(b.score) - Number(a.score))[0];
    if (top) near.push({ post_id: postId, post_title: sanitize(post && post.title).slice(0, 70), paper_slug: sanitize(top.slug).slice(0, 80), score: Math.round(Number(top.score) * 1000) / 1000 });   // EXUVIA-NEAR-MISS-1: who came closest, so the bar is judged from the pairs and not from one number
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
  near.sort((a, b) => b.score - a.score);
  return { posts_seen: posts.length, drafts, unmatched, errors, best_score: Math.round(best * 1000) / 1000, near: near.slice(0, 3) };
}
// EXUVIA-ENGAGE-1 (2.8.0): the reply step. A comment on Exuvia is public and no agent can delete it, so this runs ONLY when ops_config
// exuvia_engage_post is 'on' (the row ships absent). It posts stored drafts (decision_log, written by exuviaEngageTick) through
// POST /api/v1/posts/{id}/comments with field "body", at most EXUVIA_MAX_PER_RUN per run, EXUVIA_COOLDOWN_S apart, never the same
// Exuvia post twice, stops the run on a 429 and honours retry_after_seconds, and never retries any other 4xx. Every post and refusal is
// one decision_log row, so the 7 day measurement and the stop-and-review rule read from one place.
var EXUVIA_MAX_PER_RUN = 2;
var EXUVIA_COOLDOWN_S = 150;
var EXUVIA_ACTOR = "qnfo-memory-mcp:exuvia-engage";
function exuviaReplyBody(draft) {
  const p = draft && draft.paper || {};
  return ("A relevant QNFO paper is “" + sanitize(p.title) + "”. " + sanitizeLong(draft && draft.evidence || "").slice(0, 900) + " Full text: " + sanitize(p.url) + " (match score " + Number(p.score).toFixed(2) + ").").slice(0, 4000);
}
async function exuviaLog(env, action, evidence, outcome, predicted) {
  await env.AUDIT.prepare(
    "INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested) " +
    "SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11 WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action = ?3)"
  ).bind(
    EXUVIA_ACTOR,
    "A stored evidence-backed draft answers a needs_response Exuvia post; posting is public and final, so it is rate limited and gated by ops_config exuvia_engage_post",
    action, evidence, outcome,
    "One public Exuvia comment under the QNFO agent identity",
    "Set ops_config exuvia_engage_post off to stop; a posted comment cannot be deleted by an agent (Exuvia rule), which is why the step ships off",
    "Answers on Exuvia cite QNFO papers with evidence",
    predicted || "The post author or a reader opens the cited QNFO paper; referral from exuvia-two.vercel.app is measured in the 7 day review",
    "Potential Exuvia-to-QNFO paper referral; unmeasured",
    "Exuvia comments API, decision_log"
  ).run();
}
async function exuviaReplyTick(env, nowMs) {
  if (!env.EXUVIA_API_KEY) return { skipped: "no exuvia key" };
  if (!env.AUDIT) return { skipped: "audit binding unavailable" };
  nowMs = nowMs || Date.now();
  let flag;
  try { flag = await env.AUDIT.prepare("SELECT value FROM ops_config WHERE key = 'exuvia_engage_post'").first(); }
  catch (e) { return { error: "reply config unavailable" }; }
  if (!flag || String(flag.value || "").trim().toLowerCase() !== "on") return { skipped: "exuvia reply posting disabled" };
  let rows;
  try {
    rows = (await env.AUDIT.prepare("SELECT evidence FROM decision_log WHERE actor = ?1 AND outcome = ?2 ORDER BY id LIMIT 20").bind(EXUVIA_ACTOR, "Evidence-backed reply draft prepared; not posted").all()).results || [];
  } catch (e) { return { error: "draft lookup failed" }; }
  // Exuvia allows 2 posts per burst and then a 150 s cooldown (GET /api/v1/capabilities); the burst window is read back from the posted rows.
  let recent;
  try { recent = (await env.AUDIT.prepare("SELECT ts FROM decision_log WHERE actor = ?1 AND outcome = ?2 ORDER BY id DESC LIMIT 2").bind(EXUVIA_ACTOR, "posted").all()).results || []; }
  catch (e) { return { error: "last post lookup failed" }; }
  const burst = recent.map((x) => Date.parse(String(x.ts))).filter((t) => Number.isFinite(t) && nowMs - t < EXUVIA_COOLDOWN_S * 1000);
  const gap = Number(env.EXUVIA_WRITE_GAP_MS) >= 0 ? Number(env.EXUVIA_WRITE_GAP_MS) : 2100; // the write rate limit is 0.5 requests a second
  const posted = [], refused = [];
  for (const row of rows) {
    if (posted.length >= EXUVIA_MAX_PER_RUN) break;
    let draft;
    try { draft = JSON.parse(row.evidence); } catch (e) { refused.push({ error: "stored draft is invalid" }); continue; }
    const postId = sanitize(draft && draft.post_id);
    if (!postId || !draft.paper || !draft.paper.url || !draft.evidence) { refused.push({ post_id: postId, error: "draft incomplete" }); continue; }
    const postedAction = "EXUVIA-ENGAGE-1: reply posted for post " + postId;
    const refusedAction = "EXUVIA-ENGAGE-1: reply refused for post " + postId;
    let done;
    try { done = await env.AUDIT.prepare("SELECT 1 AS n FROM decision_log WHERE action IN (?1, ?2) LIMIT 1").bind(postedAction, refusedAction).first(); }
    catch (e) { refused.push({ post_id: postId, error: "posted lookup failed" }); continue; }
    if (done) continue;
    if (burst.length >= EXUVIA_MAX_PER_RUN) { refused.push({ post_id: postId, error: "cooldown", wait_s: Math.ceil((EXUVIA_COOLDOWN_S * 1000 - (nowMs - Math.min.apply(null, burst))) / 1000) }); break; }
    if (posted.length) await new Promise((resolve) => setTimeout(resolve, gap));
    const r = await exFetch(env, "/api/v1/posts/" + encodeURIComponent(postId) + "/comments", { method: "POST", body: JSON.stringify({ body: exuviaReplyBody(draft) }) }).catch((e) => ({ status: 0, data: { error: String(e && e.message || e).slice(0, 200) } }));
    if (r.status === 429) {
      const wait = Number(r.data && (r.data.retry_after_seconds || r.data.data && r.data.data.retry_after_seconds)) || EXUVIA_COOLDOWN_S;
      refused.push({ post_id: postId, status: 429, retry_after_seconds: wait });
      break; // stop the run; the next hourly run tries again, a 429 is never a failure of the draft
    }
    if (r.status >= 200 && r.status < 300) {
      posted.push({ post_id: postId, status: r.status });
      burst.push(nowMs);
      try { await exuviaLog(env, postedAction, JSON.stringify({ post_id: postId, paper: draft.paper, status: r.status }), "posted"); }
      catch (e) { refused.push({ post_id: postId, error: "post logged late: audit write failed" }); }
      continue;
    }
    refused.push({ post_id: postId, status: r.status });
    if (r.status === 0 || r.status >= 500) break; // a network error or a 5xx is transient: stop the run, nothing is recorded, the next hour tries again
    // any other 4xx is final for this draft: record the exact status once and never retry it (Exuvia rule: no 4xx other than 429)
    try { await exuviaLog(env, refusedAction, JSON.stringify({ post_id: postId, status: r.status, error: r.data && (r.data.error || r.data.message) || null }), "HTTP " + r.status); }
    catch (e) { console.error(JSON.stringify({ worker: SERVER_NAME, where: "exuvia-refusal-log", error: String(e && e.message || e).slice(0, 200) })); }
  }
  return { drafts_seen: rows.length, posted, refused };
}
// EXUVIA-ENGAGE-1 (2.8.0): the hourly step. The draft tick is a no-op until ops_config exuvia_engage is 'on'; the reply tick is a no-op until
// exuvia_engage_post is 'on'. A failure of one never skips the other, and neither throws out of the cron.
async function exuviaCron(env) {
  const out = {};
  for (const [name, fn] of [["draft", exuviaEngageTick], ["reply", exuviaReplyTick]]) {
    try { out[name] = await fn(env); }
    catch (e) { out[name] = { error: String(e && e.message || e).slice(0, 200) }; console.error(JSON.stringify({ worker: SERVER_NAME, where: "exuvia-cron-" + name, error: out[name].error })); }
  }
  console.log(JSON.stringify({ worker: SERVER_NAME, where: "exuvia-cron", draft: out.draft && (out.draft.skipped || out.draft.error || { seen: out.draft.posts_seen, drafts: (out.draft.drafts || []).length, unmatched: out.draft.unmatched, errors: (out.draft.errors || []).length, best_score: out.draft.best_score, near: out.draft.near }), reply: out.reply && (out.reply.skipped || out.reply.error || { posted: (out.reply.posted || []).length, refused: (out.reply.refused || []).length }) }));
  return out;
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
// MEMORY-MCP-ENV-LEAK-1: a route name comes from the URL, and `FG_ROUTES["constructor"]` is Object, which returns its argument: GET
// /fleet-graph/constructor answered with the worker env, secrets included. A table is read by own property only.
function ownEntry(table, key) { return typeof key === "string" && Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined; }
async function fgCall(name, args, env, open) {
  const fn = ownEntry(FG_ROUTES, name);
  if (!fn) return { error: "unknown fleet graph query " + name, queries: Object.keys(FG_ROUTES) };
  try { return await fn(env, args || {}, open); }
  catch (e) { const m = String(e && e.message || e); return { error: /no such table: fg_/.test(m) ? "the fleet graph has not been built yet (fg_* tables missing)" : "query failed: " + m.slice(0, 300) }; }
}
async function fgTool(name, args, env) {
  const out = await fgCall(name.replace(/^fleet_graph_/, ""), args, env, false);
  return { content: [{ type: "text", text: JSON.stringify(out) }], isError: !!out.error };
}
__name(fgTool, "fgTool");
// KG-CURATE-1: the content knowledge graph's read side. scripts/kg_curate.mjs (run by fleet-graph.yml) curates qnfo-graph `nodes` / `edges`;
// these open, read-only, parameterised queries answer from them: health, node, neighbors, path, central, gaps, orphans, find, communities.
// Active means status NULL or 'active'; a stale edge, a ghost or quarantined paper is hidden unless include_stale is passed. The open routes
// never serve the owner's notes or people (labels Note, Person, Vault): those are for authenticated MCP clients only.
var KG_STRUCTURAL = ["CONTAINS", "CONTAINS_PHASE", "CONTAINS_TASK", "ULTRA_CONTAINS", "HAS_ROUTE", "HAS_ENDPOINT", "HAS_DOMAIN", "SAME_AS"];
var KG_HUB_LABELS = ["Tag", "Category", "Vault", "Domain", "Bucket", "Database"];
var KG_PRIVATE_LABELS = ["Note", "Person", "Vault"];
var KG_EDGE_ACTIVE = "(e.status IS NULL OR e.status = 'active')";
var KG_NOT_PRIVATE = "label NOT IN ('" + KG_PRIVATE_LABELS.join("','") + "')";
var KG_MAX_QUERIES = 40; // one walk never runs more D1 queries than this
async function kgResolve(env, ref, open) {
  const q = fgStr(ref);
  if (!q) return { error: "id required" };
  const exact = await env.GRAPH_DB.prepare("SELECT id, label, name, status, source, canonical_id FROM nodes WHERE id = ?1 LIMIT 1").bind(q).first();
  if (exact) return open && KG_PRIVATE_LABELS.indexOf(exact.label) >= 0 ? { error: "withheld: personal notes and people are served to authenticated MCP clients only" } : { id: exact.id, node: exact };
  const rows = ((await env.GRAPH_DB.prepare("SELECT id, label, name, status FROM nodes WHERE lower(name) = lower(?1) AND status IS NULL" + (open ? " AND " + KG_NOT_PRIVATE : "") + " LIMIT 12").bind(q).all()).results) || [];
  if (rows.length === 1) return { id: rows[0].id, node: rows[0] };
  if (rows.length > 1) return { error: "ambiguous: " + rows.length + " nodes are named " + q + "; pass one id", candidates: rows };
  return { error: "no node with id or name " + q + "; use kg_find" };
}
async function kg_find(env, args, open) {
  const q = fgStr(args.query || args.q);
  if (!q) return { error: "query required" };
  const label = fgStr(args.label), limit = fgInt(args.limit, 20, 1, 100);
  const sql = "SELECT id, label, name, status FROM nodes WHERE (id = ?1 OR instr(lower(name), lower(?1)) > 0)" + (label ? " AND label = ?2" : "") + (open ? " AND " + KG_NOT_PRIVATE : "") + " ORDER BY CASE WHEN id = ?1 OR lower(name) = lower(?1) THEN 0 ELSE 1 END, length(name) LIMIT " + limit;
  const st = env.GRAPH_DB.prepare(sql), r = label ? await st.bind(q, label).all() : await st.bind(q).all();
  return { query: q, count: (r.results || []).length, results: r.results || [] };
}
async function kg_node(env, args, open) {
  const res = await kgResolve(env, args.id, open);
  if (res.error) return res;
  const limit = fgInt(args.limit, 60, 1, 300), stale = args.include_stale === true || args.include_stale === "true";
  const act = stale ? "1 = 1" : KG_EDGE_ACTIVE, hide = open ? " AND (n.label IS NULL OR n.label NOT IN ('" + KG_PRIVATE_LABELS.join("','") + "'))" : "";
  const props = await env.GRAPH_DB.prepare("SELECT properties, created_at, updated_at, last_seen FROM nodes WHERE id = ?1").bind(res.id).first();
  const stats = await env.GRAPH_DB.prepare("SELECT degree, deg_sem, pagerank, component, community FROM kg_node_stats WHERE node_id = ?1").bind(res.id).first().catch(() => null);
  const out = await env.GRAPH_DB.prepare("SELECT e.relationship_type AS rel, e.target_id AS other, n.label, n.name, e.weight, e.confidence, e.source AS origin, e.status FROM edges e LEFT JOIN nodes n ON n.id = e.target_id WHERE e.source_id = ?1 AND " + act + hide + " ORDER BY COALESCE(e.weight, 1) DESC, e.relationship_type LIMIT " + limit).bind(res.id).all();
  const inc = await env.GRAPH_DB.prepare("SELECT e.relationship_type AS rel, e.source_id AS other, n.label, n.name, e.weight, e.confidence, e.source AS origin, e.status FROM edges e LEFT JOIN nodes n ON n.id = e.source_id WHERE e.target_id = ?1 AND " + act + hide + " ORDER BY COALESCE(e.weight, 1) DESC, e.relationship_type LIMIT " + limit).bind(res.id).all();
  const tally = (rows) => rows.reduce((m, x) => { m[x.rel] = (m[x.rel] || 0) + 1; return m; }, {});
  let p = {}; try { p = JSON.parse((props && props.properties) || "{}"); if (typeof p === "string") p = JSON.parse(p); } catch (e) { p = {}; }
  return { id: res.id, node: Object.assign({}, res.node, { properties: p && typeof p === "object" ? p : {}, created_at: props && props.created_at, updated_at: props && props.updated_at, last_seen: props && props.last_seen }), stats: stats || null, out: out.results || [], in: inc.results || [], out_by_relationship: tally(out.results || []), in_by_relationship: tally(inc.results || []) };
}
// Level-by-level walk, one query per level chunk (frontier as one JSON parameter), at most KG_MAX_QUERIES in all. Structural edges
// (CONTAINS ...) are skipped unless asked for, a hub label (Tag, Category ...) is shown but not expanded past depth 1, and an open walk drops
// private labels. `truncated` says a query hit its row limit or the query budget ran out, so "not reached" may be "not looked at".
async function kgWalk(env, start, opts) {
  const seen = new Map([[start, { depth: 0, from: null, rel: null }]]);
  let frontier = [start], capped = false, truncated = false, queries = 0;
  const rel = opts.structural ? "" : " AND e.relationship_type NOT IN ('" + KG_STRUCTURAL.join("','") + "')";
  const labelOf = new Map();
  for (let d = 1; d <= opts.depth && frontier.length; d++) {
    const next = [], fset = new Set(frontier);
    for (let i = 0; i < frontier.length; i += 300) {
      if (queries >= KG_MAX_QUERIES) { truncated = true; break; }
      queries++;
      const chunk = JSON.stringify(frontier.slice(i, i + 300));
      const sql = "SELECT e.source_id AS s, e.target_id AS t, e.relationship_type AS r, e.weight AS w FROM edges e WHERE e.source_id IN (SELECT value FROM json_each(?1)) AND " + KG_EDGE_ACTIVE + rel + " UNION ALL SELECT e.source_id, e.target_id, e.relationship_type, e.weight FROM edges e WHERE e.target_id IN (SELECT value FROM json_each(?1)) AND " + KG_EDGE_ACTIVE + rel + " LIMIT 6000";
      const r = await env.GRAPH_DB.prepare(sql).bind(chunk).all();
      if ((r.results || []).length >= 6000) truncated = true;
      for (const x of r.results || []) {
        const here = fset.has(x.s) ? x.s : x.t, there = here === x.s ? x.t : x.s;
        if (opts.minWeight && (x.w == null ? 1 : x.w) < opts.minWeight) continue;
        if (!seen.has(there)) { seen.set(there, { depth: d, from: here, rel: x.r }); next.push(there); if (seen.size >= opts.cap) { capped = true; break; } }
      }
      if (capped) break;
    }
    if (opts.target && seen.has(opts.target)) break;
    if (capped || (truncated && queries >= KG_MAX_QUERIES)) break;
    if ((!opts.hubs || opts.hidePrivate) && next.length) {
      if (queries >= KG_MAX_QUERIES) { truncated = true; break; }
      queries++;
      const lab = await env.GRAPH_DB.prepare("SELECT id, label FROM nodes WHERE id IN (SELECT value FROM json_each(?1))").bind(JSON.stringify(next.slice(0, 2000))).all();
      for (const x of lab.results || []) labelOf.set(x.id, x.label);
      if (opts.hidePrivate) for (const id of next) if (KG_PRIVATE_LABELS.indexOf(labelOf.get(id)) >= 0) seen.delete(id);
      frontier = next.filter((id) => seen.has(id) && (opts.hubs || KG_HUB_LABELS.indexOf(labelOf.get(id)) < 0));
    } else frontier = next;
  }
  return { seen, capped, truncated, queries };
}
async function kg_neighbors(env, args, open) {
  const res = await kgResolve(env, args.id, open);
  if (res.error) return res;
  const depth = fgInt(args.depth, 1, 1, 3), cap = fgInt(args.limit, 150, 5, 500);
  const structural = args.structural === true || args.structural === "true";
  const w = await kgWalk(env, res.id, { depth, cap, structural, hubs: args.hubs === true || args.hubs === "true", minWeight: Number(args.min_weight) || 0, hidePrivate: !!open });
  const ids = Array.from(w.seen.keys()), meta = new Map(), stat = new Map();
  for (let i = 0; i < ids.length; i += 400) {
    const part = JSON.stringify(ids.slice(i, i + 400));
    for (const x of ((await env.GRAPH_DB.prepare("SELECT id, label, name, status FROM nodes WHERE id IN (SELECT value FROM json_each(?1))").bind(part).all()).results) || []) meta.set(x.id, x);
    for (const x of ((await env.GRAPH_DB.prepare("SELECT node_id, pagerank, community FROM kg_node_stats WHERE node_id IN (SELECT value FROM json_each(?1))").bind(part).all().catch(() => ({ results: [] }))).results) || []) stat.set(x.node_id, x);
  }
  const nodes = ids.map((id) => { const m = meta.get(id) || {}, s = stat.get(id) || {}; return { id, label: m.label || null, name: m.name || null, depth: w.seen.get(id).depth, pagerank: s.pagerank == null ? null : s.pagerank, community: s.community || null }; });
  // Every active edge between the nodes shown (a walk finds the tree; the view needs the cross links too).
  const edges = [];
  for (let i = 0; i < ids.length; i += 500) {
    const part = JSON.stringify(ids.slice(i, i + 500));
    const r = await env.GRAPH_DB.prepare("SELECT e.source_id AS s, e.target_id AS t, e.relationship_type AS r, e.weight AS w, e.confidence AS c, e.source AS origin FROM edges e WHERE e.source_id IN (SELECT value FROM json_each(?1)) AND e.target_id IN (SELECT value FROM json_each(?1)) AND " + KG_EDGE_ACTIVE + (structural ? "" : " AND e.relationship_type NOT IN ('" + KG_STRUCTURAL.join("','") + "')") + " LIMIT 3000").bind(part).all();
    for (const e of r.results || []) edges.push(e);
  }
  return { center: res.id, depth, count: nodes.length, truncated: w.capped || w.truncated, nodes, edges };
}
async function kg_path(env, args, open) {
  const a = await kgResolve(env, args.from, open), b = await kgResolve(env, args.to, open);
  if (a.error) return { error: "from: " + a.error, candidates: a.candidates };
  if (b.error) return { error: "to: " + b.error, candidates: b.candidates };
  const maxd = fgInt(args.max_depth, 5, 1, 7);
  let truncated = false;
  for (const structural of [false, true]) {
    const w = await kgWalk(env, a.id, { depth: maxd, cap: 30000, structural, hubs: structural, target: b.id, hidePrivate: !!open });
    truncated = truncated || w.capped || w.truncated;
    if (!w.seen.has(b.id)) continue;
    const steps = []; let cur = b.id;
    while (cur && cur !== a.id) { const s = w.seen.get(cur); steps.unshift({ from: s.from, rel: s.rel, to: cur }); cur = s.from; }
    return { from: a.id, to: b.id, length: steps.length, via_structural_edges: steps.some((x) => KG_STRUCTURAL.indexOf(x.rel) >= 0), truncated, path: steps };
  }
  return { from: a.id, to: b.id, path: null, truncated, note: truncated ? "no path found, but the search was cut short (query or row budget): this is not proof there is none" : "no path within " + maxd + " steps" };
}
async function kg_central(env, args, open) {
  const label = fgStr(args.label), limit = fgInt(args.limit, 25, 1, 200);
  const sql = "SELECT s.node_id AS id, n.label, n.name, s.pagerank, s.deg_sem, s.community FROM kg_node_stats s JOIN nodes n ON n.id = s.node_id WHERE n.status IS NULL" + (label ? " AND n.label = ?1" : "") + (open ? " AND n.label NOT IN ('" + KG_PRIVATE_LABELS.join("','") + "')" : "") + " ORDER BY s.pagerank DESC LIMIT " + limit;
  const st = env.GRAPH_DB.prepare(sql), r = label ? await st.bind(label).all() : await st.all();
  return { label: label || null, note: "PageRank over non-structural active edges, scaled so the mean is 1", count: (r.results || []).length, results: r.results || [] };
}
async function kg_gaps(env, args) {
  const kind = fgStr(args.kind), limit = fgInt(args.limit, 50, 1, 300);
  const tot = ((await env.GRAPH_DB.prepare("SELECT kind, COUNT(*) AS n FROM kg_gap WHERE status = 'open' GROUP BY kind ORDER BY n DESC").all()).results) || [];
  const sql = "SELECT id, kind, subject, detail, score, first_seen, last_seen FROM kg_gap WHERE status = 'open'" + (kind ? " AND kind = ?1" : "") + " ORDER BY score DESC, first_seen LIMIT " + limit;
  const st = env.GRAPH_DB.prepare(sql), r = kind ? await st.bind(kind).all() : await st.all();
  return { totals: tot, count: (r.results || []).length, note: "isolated-paper: no content relation; bridge-paper: neighbours in 3+ communities; link-candidate: two papers with shared neighbours and no link (Adamic-Adar, a lead not an edge)", results: (r.results || []).map((x) => Object.assign({}, x, { detail: fgAttrs(x.detail) })) };
}
async function kg_orphans(env, args, open) {
  const label = fgStr(args.label), limit = fgInt(args.limit, 50, 1, 300);
  const sql = "SELECT n.id, n.label, n.name FROM nodes n WHERE n.status IS NULL" + (label ? " AND n.label = ?1" : "") + (open ? " AND n.label NOT IN ('" + KG_PRIVATE_LABELS.join("','") + "')" : "") + " AND NOT EXISTS (SELECT 1 FROM edges e WHERE e.source_id = n.id AND " + KG_EDGE_ACTIVE + ") AND NOT EXISTS (SELECT 1 FROM edges e WHERE e.target_id = n.id AND " + KG_EDGE_ACTIVE + ") LIMIT " + limit;
  const st = env.GRAPH_DB.prepare(sql), r = label ? await st.bind(label).all() : await st.all();
  return { label: label || null, count: (r.results || []).length, results: r.results || [] };
}
async function kg_communities(env, args) {
  const limit = fgInt(args.limit, 30, 1, 100);
  const r = ((await env.GRAPH_DB.prepare("SELECT s.community AS id, COUNT(*) AS members, n.name AS representative FROM kg_node_stats s LEFT JOIN nodes n ON n.id = s.community WHERE s.community IS NOT NULL GROUP BY s.community ORDER BY members DESC LIMIT " + limit).all()).results) || [];
  return { note: "label propagation over paper-to-paper CITES / SIMILAR_TO / COUPLED_WITH, split into connected parts; the id is the highest-PageRank member", count: r.length, results: r };
}
async function kg_health(env) {
  const row = await env.GRAPH_DB.prepare("SELECT ts, version, metrics, CAST((julianday('now') - julianday(ts)) * 1440 AS INTEGER) AS age_min FROM kg_health ORDER BY ts DESC LIMIT 1").first();
  if (!row) return { error: "the knowledge graph has not been curated yet (kg_health is empty)" };
  const trend = ((await env.GRAPH_DB.prepare("SELECT ts, json_extract(metrics, '$.orphan_share') AS orphan_share, json_extract(metrics, '$.edge_density') AS edge_density, json_extract(metrics, '$.giant_component_share') AS giant_component_share, json_extract(metrics, '$.paper_unrelated_share') AS paper_unrelated_share, json_extract(metrics, '$.edges_active') AS edges_active FROM kg_health ORDER BY ts DESC LIMIT 48").all()).results) || [];
  const state = ((await env.GRAPH_DB.prepare("SELECT k, v, updated_at FROM kg_state WHERE k IN ('lastRun', 'simAdjust')").all()).results) || [];
  const tomb = await env.GRAPH_DB.prepare("SELECT COUNT(*) AS n FROM kg_tombstone").first();
  let m = {}; try { m = JSON.parse(row.metrics); } catch (e) { m = {}; }
  return { as_of: row.ts, age_min: row.age_min, stale: row.age_min > 180, curator_version: row.version, metrics: m, tombstones: tomb ? tomb.n : null, state: Object.fromEntries(state.map((x) => [x.k, x.v])), trend_newest_first: trend, how: "scripts/kg_curate.mjs inside fleet-graph.yml; docs/KNOWLEDGE-GRAPH.md" };
}
var KG_ROUTES = { health: kg_health, find: kg_find, node: kg_node, neighbors: kg_neighbors, path: kg_path, central: kg_central, gaps: kg_gaps, orphans: kg_orphans, communities: kg_communities };
async function kgCall(name, args, env, open) {
  // MEMORY-MCP-ENV-LEAK-1: a route name is a URL segment; only the table's own properties are routes (KG_ROUTES["constructor"] is Object).
  const fn = typeof name === "string" && Object.prototype.hasOwnProperty.call(KG_ROUTES, name) ? KG_ROUTES[name] : null;
  if (!fn) return { error: "unknown knowledge graph query " + name, queries: Object.keys(KG_ROUTES) };
  try { return await fn(env, args || {}, !!open); }
  catch (e) { const m = String(e && e.message || e); return { error: /no such (table|column)/.test(m) ? "the knowledge graph has not been curated yet (" + m.slice(0, 80) + ")" : "query failed: " + m.slice(0, 300) }; }
}
async function kgTool(name, args, env) {
  const out = await kgCall(name.replace(/^kg_/, ""), args, env, false);
  return { content: [{ type: "text", text: JSON.stringify(out) }], isError: !!out.error };
}
__name(kgTool, "kgTool");
// A self-contained viewer: a force layout drawn on a canvas, fed by /kg/neighbors or /fleet-graph/impact (same origin, fixed paths).
var KG_VIEW_HTML = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QNFO knowledge graph</title><style>html,body{margin:0;height:100%;font:14px system-ui,sans-serif;background:#0f1218;color:#dbe2ee}#bar{display:flex;gap:8px;padding:8px;align-items:center;flex-wrap:wrap}input,select,button{font:inherit;padding:6px 8px;border-radius:6px;border:1px solid #394150;background:#1a202b;color:inherit}input{min-width:16em}canvas{display:block;width:100vw;height:calc(100vh - 92px);touch-action:none}#info{padding:4px 10px;color:#9fb0c8;min-height:1.4em}</style><div id="bar"><input id="q" placeholder="node id or name (paper:..., worker:qnfo-ops)"><select id="d"><option>1</option><option selected>2</option><option>3</option></select><button id="go">Show neighbours</button><span id="n"></span></div><div id="info">Click a node to centre on it.</div><canvas id="c"></canvas><script>(function(){var C=document.getElementById("c"),X=C.getContext("2d"),info=document.getElementById("info"),N=[],E=[],W=0,H=0,dpr=window.devicePixelRatio||1,hue={},seed=7;function rnd(){seed=(seed*1103515245+12345)&2147483647;return seed/2147483647}function col(l){if(!hue[l]){var h=0;for(var i=0;i<(l||"?").length;i++)h=(h*31+(l||"?").charCodeAt(i))%360;hue[l]=h}return"hsl("+hue[l]+",65%,60%)"}function size(){W=C.clientWidth;H=C.clientHeight;C.width=W*dpr;C.height=H*dpr;X.setTransform(dpr,0,0,dpr,0,0)}function load(id,d){info.textContent="Loading\\u2026";var u=id.indexOf("worker:")===0||id.indexOf("d1")===0||id.indexOf("fn:")===0?"/fleet-graph/impact?direction=down&depth="+d+"&id="+encodeURIComponent(id):"/kg/neighbors?depth="+d+"&id="+encodeURIComponent(id);fetch(u).then(function(r){return r.json()}).then(function(j){if(j.error){info.textContent=j.error;return}var map={};if(j.nodes){N=j.nodes.map(function(n){return{id:n.id,label:n.label||"?",name:n.name||n.id,x:W/2+(rnd()-.5)*200,y:H/2+(rnd()-.5)*200,vx:0,vy:0,c:n.id===j.center}});E=j.edges.map(function(e){return{s:e.s,t:e.t,r:e.r}})}else{N=[{id:j.id,label:"center",name:j.id,x:W/2,y:H/2,vx:0,vy:0,c:true}].concat((j.results||[]).map(function(n){return{id:n.id,label:n.kind||"?",name:n.name||n.id,x:W/2+(rnd()-.5)*200,y:H/2+(rnd()-.5)*200,vx:0,vy:0,c:false}}));E=(j.results||[]).filter(function(n){return n.from}).map(function(n){return{s:n.from,t:n.id,r:n.via}})}N.forEach(function(n){map[n.id]=n});E=E.filter(function(e){return map[e.s]&&map[e.t]});info.textContent=N.length+" nodes, "+E.length+" edges"+(j.truncated?" (truncated)":"");for(var k=0;k<160;k++)step(map)}).catch(function(e){info.textContent=String(e)})}function step(map){var i,j,a,b,dx,dy,d2,f;for(i=0;i<N.length;i++){a=N[i];for(j=i+1;j<N.length;j++){b=N[j];dx=a.x-b.x;dy=a.y-b.y;d2=dx*dx+dy*dy+.01;f=900/d2;a.vx+=dx*f;a.vy+=dy*f;b.vx-=dx*f;b.vy-=dy*f}}for(i=0;i<E.length;i++){a=map[E[i].s];b=map[E[i].t];dx=b.x-a.x;dy=b.y-a.y;f=.02;a.vx+=dx*f;a.vy+=dy*f;b.vx-=dx*f;b.vy-=dy*f}for(i=0;i<N.length;i++){a=N[i];a.vx+=(W/2-a.x)*.004;a.vy+=(H/2-a.y)*.004;a.x+=Math.max(-20,Math.min(20,a.vx));a.y+=Math.max(-20,Math.min(20,a.vy));a.vx*=.6;a.vy*=.6}}function draw(){X.clearRect(0,0,W,H);var m={};N.forEach(function(n){m[n.id]=n});X.strokeStyle="#3a4558";X.lineWidth=1;E.forEach(function(e){var a=m[e.s],b=m[e.t];X.beginPath();X.moveTo(a.x,a.y);X.lineTo(b.x,b.y);X.stroke()});N.forEach(function(n){X.fillStyle=col(n.label);X.beginPath();X.arc(n.x,n.y,n.c?9:5,0,6.3);X.fill();if(N.length<60||n.c){X.fillStyle="#dbe2ee";X.fillText(String(n.name).slice(0,34),n.x+8,n.y+3)}});requestAnimationFrame(draw)}C.addEventListener("click",function(ev){var r=C.getBoundingClientRect(),x=ev.clientX-r.left,y=ev.clientY-r.top,best=null,bd=400;N.forEach(function(n){var d=(n.x-x)*(n.x-x)+(n.y-y)*(n.y-y);if(d<bd){bd=d;best=n}});if(best){info.textContent=best.label+": "+best.name+" ("+best.id+")";document.getElementById("q").value=best.id;load(best.id,+document.getElementById("d").value)}});document.getElementById("go").onclick=function(){load(document.getElementById("q").value.trim(),+document.getElementById("d").value)};window.addEventListener("resize",size);size();var q=new URLSearchParams(location.search).get("id");if(q){document.getElementById("q").value=q;load(q,2)}draw()})()</script>';
async function callTool(name, args, env) {
  const handlers = {
    search_papers: tool_search_papers,
    search_papers_enriched: tool_search_papers_enriched,
    resolve_paper_id: tool_resolve_paper_id,
    search_memories: tool_search_memories,
    remember_fact: tool_remember_fact,
    memory_outcome: tool_memory_outcome,
    memory_tiering_metrics: tool_memory_tiering_metrics,
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
  if (/^kg_/.test(String(name))) return await kgTool(name, args, env);
  const fn = ownEntry(handlers, name);
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
// CAP-TOKEN-1 (qnfo-workers ROADMAP-1, issue #1002031): qcap1 capability tokens, the same
// scheme as qnfo-tools-mcp 1.5.0, governed by ops_config capability_token_policy_v1.
// Token = "qcap1." + base64url(JSON payload). Payload caveats: i (id), t (allowed tools),
// w (write), x (expiry epoch seconds), k (task label); s is the HMAC-SHA256 signature over
// the caveat-only JSON. At most 16 caveats, only the keys above are accepted.
var CAP_PREFIX = "qcap1.";
var CAP_POLICY = "capability_token_policy_v1";
var CAVEAT_KEYS = ["i", "t", "x", "w", "k"];
var MAX_CAVEATS = 16;
function capB64u(buf) {
  const b = typeof buf === "string" ? new TextEncoder().encode(buf) : buf;
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
__name(capB64u, "capB64u");
function capU64b(str) {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  const raw = atob(str.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}
__name(capU64b, "capU64b");
function capBody(caveats) {
  const o = {};
  for (const k of CAVEAT_KEYS) if (caveats[k] !== void 0) o[k] = caveats[k];
  return o;
}
__name(capBody, "capBody");
async function capKey(env) {
  if (!env.CAP_SECRET) return null;
  return await crypto.subtle.importKey("raw", new TextEncoder().encode(env.CAP_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
__name(capKey, "capKey");
async function capSign(caveats, env) {
  const key = await capKey(env);
  if (!key) throw new Error(CAP_POLICY + ": CAP_SECRET not configured");
  const body = capBody(caveats);
  const text = JSON.stringify(body);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text)));
  return CAP_PREFIX + capB64u(new TextEncoder().encode(JSON.stringify(Object.assign({}, body, { s: capB64u(sig) }))));
}
__name(capSign, "capSign");
async function capMint(caveats, env) {
  const body = capBody(caveats);
  const n = Object.keys(body).length;
  if (n > MAX_CAVEATS) throw new Error(CAP_POLICY + ": more than " + MAX_CAVEATS + " caveats");
  return await capSign(body, env);
}
__name(capMint, "capMint");
function capFail(reason) {
  return { ok: false, write: false, allowed: null, id: null, k: null, x: null, reason: CAP_POLICY + ": " + reason };
}
__name(capFail, "capFail");
async function resolveScope(token, env) {
  if (env.MCP_TOKEN && constantTimeEqual(token, env.MCP_TOKEN)) return { ok: true, write: true, allowed: null, id: null, k: null, x: null };
  if (env.MCP_READ_TOKEN && constantTimeEqual(token, env.MCP_READ_TOKEN)) return { ok: true, write: false, allowed: null, id: null, k: null, x: null };
  if (!token || String(token).indexOf(CAP_PREFIX) !== 0) return capFail("not a qcap1 token");
  if (!env.CAP_SECRET) return capFail("CAP_SECRET not configured");
  let p;
  try { p = JSON.parse(new TextDecoder().decode(capU64b(String(token).slice(CAP_PREFIX.length)))); }
  catch (e) { return capFail("malformed token"); }
  if (!p || typeof p !== "object" || Array.isArray(p)) return capFail("malformed payload");
  const keys = Object.keys(p);
  if (keys.indexOf("s") < 0 || typeof p.s !== "string") return capFail("missing signature");
  const caveats = keys.filter((k) => k !== "s");
  if (caveats.length > MAX_CAVEATS) return capFail("more than " + MAX_CAVEATS + " caveats");
  if (caveats.some((k) => CAVEAT_KEYS.indexOf(k) < 0)) return capFail("unknown caveat key");
  const key = await capKey(env);
  const body = JSON.stringify(capBody(p));
  let okSig = false;
  try { okSig = await crypto.subtle.verify("HMAC", key, capU64b(p.s), new TextEncoder().encode(body)); }
  catch (e) { okSig = false; }
  if (!okSig) return capFail("bad signature");
  if (typeof p.x === "number" && Math.floor(Date.now() / 1000) >= p.x) return capFail("token expired");
  let allowed = null;
  if (p.t !== void 0) {
    if (!Array.isArray(p.t) || !p.t.every((x) => typeof x === "string")) return capFail("bad t caveat");
    allowed = p.t;
  }
  return { ok: true, write: p.w === true, allowed, id: typeof p.i === "string" ? p.i : null, k: typeof p.k === "string" ? p.k : null, x: typeof p.x === "number" ? p.x : null };
}
__name(resolveScope, "resolveScope");
async function scopeFor(token, env) {
  return await resolveScope(token, env);
}
__name(scopeFor, "scopeFor");
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
  if (method === "tools/list") {
    let list = scope.write ? TOOLS : TOOLS.filter((t) => WRITE_TOOLS.indexOf(t.name) < 0);
    // CAP-TOKEN-1: a qcap1 t caveat narrows the tool list to exactly the allowed names.
    if (scope.allowed) list = list.filter((t) => scope.allowed.indexOf(t.name) >= 0);
    return { out: rpcOk(id, { tools: list }) };
  }
  // FULLSCOPE-1: clients probing resources/prompts on connect get empty lists, not -32601.
  if (method === "resources/list") return { out: rpcOk(id, { resources: [] }) };
  if (method === "resources/templates/list") return { out: rpcOk(id, { resourceTemplates: [] }) };
  if (method === "prompts/list") return { out: rpcOk(id, { prompts: [] }) };
  if (method === "tools/call") {
    const p = params && typeof params === "object" ? params : null;
    const name = p ? String(p.name || "") : "";
    if (!name) return { err: rpcErr(id, -32602, "Invalid params: tools/call needs params.name") };
    if (TOOLS.every((t) => t.name !== name) && !/^fleet_graph_/.test(name) && !/^kg_/.test(name)) return { err: rpcErr(id, -32602, "unknown tool: " + name) };
    if (!scope.write && WRITE_TOOLS.indexOf(name) >= 0) return { err: rpcErr(id, -32003, "forbidden: token lacks write scope for '" + name + "'") };
    if (scope.allowed && scope.allowed.indexOf(name) < 0) return { err: rpcErr(id, -32003, "forbidden: capability token (" + CAP_POLICY + ") does not allow '" + name + "'") };
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
  // EXUVIA-ENGAGE-1 (2.8.0): hourly cron, see exuviaCron.
  async scheduled(event, env, ctx) {
    const attributed = __aiAttrEnv(env, "qnfo-memory-mcp", "AI", "AUDIT");
    ctx.waitUntil(exuviaCron(attributed));
    ctx.waitUntil(memoryTierSnapshot(attributed)); // MEMORY-TIERING-1
  },
  async fetch(request, env) {
    env = __aiAttrEnv(env, "qnfo-memory-mcp", "AI", "AUDIT");
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
    if (url.pathname === "/health") {
      return json({ status: "ok", server: SERVER_NAME, version: SERVER_VERSION, protocol: SUPPORTED_PROTOCOLS, auth: !!env.MCP_TOKEN, read_token: !!env.MCP_READ_TOKEN, query_token: true, exuvia_key: !!env.EXUVIA_API_KEY, audit: !!env.AUDIT, capabilities: ["mcp", "sse", "streamable-http", "persistent-memory", "knowledge-graph", "vector-recall", "fleet-graph", "kg-curation"], limitations: ["bearer token or ?token= required on /mcp, /mcp/sse and /mcp/messages", "fails closed (503) when no token is configured", "the tool list is served only to authenticated clients", "GET /fleet-graph/* is open and read-only (OPEN-ACCESS-1); secret names are withheld there", "write tools (remember_fact, exuvia_publish_paper) need the full MCP_TOKEN, not MCP_READ_TOKEN"] });
    }
    // FLEET-GRAPH-1: open, read-only, parameterised queries (OPEN-ACCESS-1). No caller SQL, bounded depth and rows.
    if (url.pathname === "/fleet-graph" || url.pathname === "/fleet-graph/") {
      return json({ graph: "qnfo fleet code + topology graph (FLEET-GRAPH-1)", queries: Object.keys(FG_ROUTES).map((q) => "/fleet-graph/" + q), examples: ["/fleet-graph/find?query=agent_issues", "/fleet-graph/impact?id=d1t:qnfo-audit.agent_issues&depth=2", "/fleet-graph/worker?worker=qnfo-ops", "/fleet-graph/findings?severity=warn", "/fleet-graph/freshness"], snapshot: "R2 qnfo-backups/fleet-graph/latest.json.gz (node-link JSON)" });
    }
    // KG-CURATE-1: the content knowledge graph, open and read-only like the fleet graph (OPEN-ACCESS-1).
    if (url.pathname === "/kg" || url.pathname === "/kg/") {
      return json({ graph: "qnfo content knowledge graph (KG-CURATE-1)", queries: Object.keys(KG_ROUTES).map((q) => "/kg/" + q), view: "/kg/view?id=paper:<slug>", examples: ["/kg/health", "/kg/find?query=ultrametric", "/kg/neighbors?id=worker:qnfo-ops&depth=2", "/kg/gaps?kind=isolated-paper", "/kg/central?label=Paper"], docs: "docs/KNOWLEDGE-GRAPH.md" });
    }
    if (url.pathname === "/kg/view" && request.method === "GET") {
      return new Response(KG_VIEW_HTML, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300", "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" } });
    }
    if (url.pathname.startsWith("/kg/") && request.method === "GET") {
      const q = url.pathname.slice("/kg/".length).replace(/\/+$/, "");
      const out = await kgCall(q, Object.fromEntries(url.searchParams.entries()), env, true);
      const r = json(out, out.error ? (/^unknown/.test(out.error) ? 404 : /not been curated/.test(out.error) ? 503 : 400) : 200);
      if (!out.error) r.headers.set("Cache-Control", "public, max-age=60");
      return r;
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
    // CAP-TOKEN-1 (issue #1002031): POST /mcp/attenuate mints a narrower qcap1 child token
    // from a valid parent (static or qcap1). Attenuation only: tools must be a subset, write
    // can only shrink, the child never outlives the parent, caveats stay within t/x/w/k/i.
    if (url.pathname === "/mcp/attenuate" && request.method === "POST") {
      const parent = await scopeFor(tokenFrom(url, request), env);
      if (!parent.ok) return json({ error: "unauthorized", policy: CAP_POLICY, detail: parent.reason || "invalid token" }, 401);
      let b;
      try { b = await request.json(); } catch (e) { return json({ error: "invalid_json" }, 400); }
      b = b && typeof b === "object" && !Array.isArray(b) ? b : {};
      if (!Array.isArray(b.tools) || !b.tools.every((x) => typeof x === "string")) return json({ error: "tools must be an array of tool names", policy: CAP_POLICY }, 400);
      if (parent.allowed && b.tools.some((x) => parent.allowed.indexOf(x) < 0)) return json({ error: "cannot widen: requested tools are outside the parent token", policy: CAP_POLICY }, 403);
      const write = b.write === true;
      if (write && !parent.write) return json({ error: "cannot widen: the parent token lacks write scope", policy: CAP_POLICY }, 403);
      const ttl = typeof b.ttl === "number" ? Math.max(1, Math.min(Math.floor(b.ttl), 86400)) : 3600;
      let x = Math.floor(Date.now() / 1000) + ttl;
      if (typeof parent.x === "number") x = Math.min(x, parent.x);
      const id = "cap-" + crypto.randomUUID().slice(0, 8);
      const task = typeof b.task === "string" ? b.task.slice(0, 64) : "default";
      try {
        const tok = await capMint({ i: id, t: b.tools, w: write, x, k: task }, env);
        return json({ token: tok, id, task, tools: b.tools, write, expires: x, policy: CAP_POLICY, session: "cap:" + id + ":" + task });
      } catch (e) {
        return json({ error: "mint failed", detail: String(e && e.message || e), policy: CAP_POLICY }, 500);
      }
    }
    if (!env.MCP_TOKEN && !env.MCP_READ_TOKEN && !env.CAP_SECRET) return json({ error: "server_misconfigured", detail: "MCP_TOKEN not set" }, 503);
    // FULLSCOPE-1: /mcp/messages authenticates by a live SSE session OR a token, exactly like qnfo-tools-mcp;
    // a token-only POST with no session gets the result inline instead of a dropped 202.
    if (url.pathname === "/mcp/messages" && request.method === "POST") {
      const sessionId = url.searchParams.get("sessionId") || "";
      const sess = sessions.get(sessionId);
      const sc = await scopeFor(tokenFrom(url, request), env);
      const capSession = sc.ok && sc.id ? "cap:" + sc.id + ":" + (sc.k || "default") : sessionId;
      if (!sess && !sc.ok) return json({ error: "unauthorized" }, 401);
      let body;
      try {
        body = await request.json();
      } catch (e) {
        return json({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null }, 400);
      }
      const scope = sess ? { ok: true, write: !!sess.write, allowed: sess.allowed || null, id: sess.id || null, k: sess.k || null } : sc;
      const handled = await handleRpcBody(body, env, scope, capSession || sessionId || null);
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
    const scope = await scopeFor(tokenFrom(url, request), env);
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
          sessions.set(sessionId, { c: controller, write: scope.write, allowed: scope.allowed || null, id: scope.id || null, k: scope.k || null });
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
