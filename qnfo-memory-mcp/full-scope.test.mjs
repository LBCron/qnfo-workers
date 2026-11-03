// FULLSCOPE-1 offline suite for qnfo-memory-mcp 2.5.0: every tool against a real in-memory sqlite (GRAPH_DB,
// LIVING_PAPER) plus mocked AI/Vectorize/Exuvia; the repaired SSE transport with /mcp/messages; ?token= auth;
// MCP_READ_TOKEN scope; remember_fact long content + clamps + category enum; secret-subject filtering on the
// open findings route; AUDIT logging; JSON-RPC batch/notifications/negotiation.
// Run: node qnfo-memory-mcp/full-scope.test.mjs   -> prints "N passed, 0 failed"
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { versionAtLeast } from "../scripts/version-at-least.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const w = (await import(pathToFileURL(join(here, "worker.js")).href)).default;
const FG = await import(pathToFileURL(join(here, "..", "scripts", "fleet_graph.mjs")).href);

let passed = 0, failed = 0;
const t = async (name, fn) => { try { await fn(); passed++; console.log("ok   " + name); } catch (e) { failed++; console.log("FAIL " + name + ": " + (e && e.message || e)); } };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || "eq") + ": got " + JSON.stringify(a) + " want " + JSON.stringify(b)); };
const ok = (c, m) => { if (!c) throw new Error(m || "assertion"); };

// ---- fixtures: real sqlite for both D1 databases --------------------------
const gdb = new DatabaseSync(":memory:");
gdb.exec("CREATE TABLE nodes (id TEXT PRIMARY KEY, label TEXT, name TEXT, properties TEXT)");
gdb.exec("CREATE TABLE edges (source_id TEXT, target_id TEXT, relationship_type TEXT)");
gdb.exec("CREATE TABLE agent_memories (id TEXT PRIMARY KEY, category TEXT, content TEXT, summary TEXT, importance REAL, session_id TEXT, created_at TEXT, expires_at TEXT, metadata_json TEXT)");
gdb.exec("INSERT INTO nodes VALUES ('paper:demo', 'Paper', 'Demo Paper', '{}'), ('c1', 'Concept', 'Ultrametric', '{}')");
gdb.exec("INSERT INTO edges VALUES ('paper:demo', 'c1', 'discusses')");
for (const s of FG.SCHEMA_SQL) gdb.exec(s);
const now = "2026-10-31T00:00:00Z";
gdb.exec("INSERT INTO fg_node (id, scope, kind, name, worker, path, line, attrs, source, h, updated_at) VALUES ('worker:alpha', 'code', 'worker', 'alpha', 'alpha', 'alpha/worker.js', NULL, '{}', 'code', 'h1', '" + now + "')");
gdb.exec("INSERT INTO fg_finding (id, kind, subject, severity, detail, h, first_seen, last_seen) VALUES ('f1', 'env-undeclared', 'alpha.NOPE', 'warn', 'reads env.NOPE', 'x', '" + now + "', '" + now + "')");
gdb.exec("INSERT INTO fg_finding (id, kind, subject, severity, detail, h, first_seen, last_seen) VALUES ('f2', 'secret-drift', 'secret:alpha.DEPLOY_TOKEN', 'warn', 'secret drift', 'y', '" + now + "', '" + now + "')");
gdb.exec("INSERT INTO fg_state (scope, sha, built_at, nodes, edges, written, deleted, ms, status, detail, version) VALUES ('code', 'abc', '" + now + "', 1, 0, 1, 0, 5, 'ok', '', '2.5.0')");

const pdb = new DatabaseSync(":memory:");
pdb.exec("CREATE TABLE papers (slug TEXT PRIMARY KEY, title TEXT, doi TEXT, authors TEXT, abstract TEXT, body_md TEXT, published TEXT, updated_at TEXT, identifier TEXT, identifier_type TEXT, id TEXT, status TEXT, r2_key TEXT)");
pdb.exec("INSERT INTO papers (slug, title, doi, authors, abstract, body_md) VALUES ('demo', 'Demo Paper', '10.5281/dead.123', 'A', 'An abstract', 'body text here'), ('live', 'Live Paper', '10.1234/live', 'B', 'abs', 'body2')");

const auditDb = new DatabaseSync(":memory:");
const prepOn = (db) => (sql0) => { const order = []; const sql = sql0.replace(/\?(\d+)/g, (m, n) => { order.push(Number(n) - 1); return "?"; }); let a = []; const st = { bind: (...x) => { a = order.length ? order.map((i) => (x[i] === undefined ? null : x[i])) : x; return st; }, run: async () => { const r = db.prepare(sql).run(...a); return { meta: { changes: Number(r.changes) } }; }, first: async () => db.prepare(sql).get(...a) || null, all: async () => ({ results: db.prepare(sql).all(...a).map((r) => Object.assign({}, r)), meta: { rows_read: 1 } }) }; return st; };

const vz = { store: [], upserts: 0 };
const PAPER_VZ = {
  query: async (vec, opts) => ({ matches: vz.store.filter((v) => !vz.queryFilter || vz.queryFilter(v)).slice(0, opts.topK || 50).map((v) => ({ id: v.id, score: 0.9, metadata: v.metadata })) }),
  upsert: async (arr) => { vz.upserts++; for (const v of arr) vz.store.push(v); return { count: arr.length }; },
  getByIds: async (ids) => ({ results: vz.store.filter((v) => ids.includes(v.id)) })
};
vz.store.push({ id: "vec:demo", values: [0.1], metadata: { slug: "demo", title: "Demo Paper", kind: "paper", chunk: 0 } });
vz.store.push({ id: "vec:live", values: [0.1], metadata: { slug: "live", kind: "paper" } }); // no title -> D1 lookup
vz.store.push({ id: "mem:project_fact:1:abcd1234", values: [0.1], metadata: { kind: "memory", category: "project_fact", content: "seeded memory" } });
gdb.exec("INSERT INTO agent_memories (id, category, content, summary, importance, session_id, created_at) VALUES ('mem:project_fact:1:abcd1234', 'project_fact', 'seeded memory', 'seed', 0.8, 's0', '" + now + "')");

const exCalls = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  exCalls.push({ url: u, init });
  if (u.endsWith("/api/v1/capabilities")) return new Response(JSON.stringify({ data: { limits: { content_max_chars: 50000 } } }));
  if (u.endsWith("/api/v1/me")) return new Response(JSON.stringify({ data: { identity: "qnfo" } }));
  if (u.includes("/api/v1/feed")) return new Response(JSON.stringify({ data: { posts: [] } }));
  if (u.includes("/api/v1/posts/")) return new Response(JSON.stringify({ data: { post: { id: "p9", title: "Ultrametric question", abstract: "How do hierarchies embed?" } } }));
  if (u.endsWith("/api/v1/posts")) return new Response(JSON.stringify({ success: true, data: { id: "p1" } }), { status: 201 });
  return new Response(JSON.stringify({ error: "nf" }), { status: 404 });
};

function mkEnv(over = {}) {
  return {
    MCP_TOKEN: "w-tok", MCP_READ_TOKEN: "r-tok",
    AI: { run: async () => ({ data: [[0.1, 0.2, 0.3]] }) },
    PAPER_VZ,
    GRAPH_DB: { prepare: prepOn(gdb) },
    LIVING_PAPER: { prepare: prepOn(pdb) },
    AUDIT: { prepare: prepOn(auditDb) },
    EXUVIA_API_KEY: "exk",
    ...over
  };
}
const rpc = async (env, body, token, qs = "") => {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  const r = await w.fetch(new Request("https://m.test/mcp" + qs, { method: "POST", headers, body: JSON.stringify(body) }), env);
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
};
const call = async (env, token, name, args) => {
  const r = await rpc(env, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args || {} } }, token);
  if (r.body && r.body.error) return { rpcError: r.body.error };
  return { isError: !!r.body.result.isError, out: JSON.parse(r.body.result.content[0].text), raw: r.body.result };
};
const get = async (env, p) => { const r = await w.fetch(new Request("https://m.test" + p), env); return { status: r.status, body: await r.json() }; };

// ---- health / auth ---------------------------------------------------------
await t("health: version, tokens, audit, capabilities; fail closed without any token", async () => {
  const h = await get(mkEnv(), "/health");
  ok(versionAtLeast(h.body.version, "2.5.0"), h.body.version);
  eq(h.body.read_token, true); eq(h.body.query_token, true); eq(h.body.audit, true);
  ok(h.body.capabilities.includes("sse") && h.body.capabilities.includes("fleet-graph"), "capabilities");
  const noTok = mkEnv({ MCP_TOKEN: undefined, MCP_READ_TOKEN: undefined });
  const r = await w.fetch(new Request("https://m.test/mcp", { method: "POST", body: "{}" }), noTok);
  eq(r.status, 503, "fails closed");
});

await t("auth: bearer and ?token= both work; wrong token 401; open fleet-graph routes need nothing", async () => {
  const env = mkEnv();
  eq((await rpc(env, { jsonrpc: "2.0", id: 1, method: "ping" }, "w-tok")).status, 200);
  eq((await rpc(env, { jsonrpc: "2.0", id: 1, method: "ping" }, null, "?token=w-tok")).status, 200);
  eq((await rpc(env, { jsonrpc: "2.0", id: 1, method: "ping" }, "wrong")).status, 401);
  const open = await get(mkEnv({ MCP_TOKEN: undefined, MCP_READ_TOKEN: undefined }), "/fleet-graph/freshness");
  eq(open.status, 200, "open route still open with no token configured");
});

await t("protocol: negotiation, ping, prompts/resources lists, batch, notifications, bad params", async () => {
  const env = mkEnv();
  const init = await rpc(env, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }, "w-tok");
  eq(init.body.result.protocolVersion, "2025-06-18");
  eq(init.body.result.serverInfo.name, "qnfo-memory-mcp");
  for (const [m, key] of [["ping", null], ["prompts/list", "prompts"], ["resources/list", "resources"], ["resources/templates/list", "resourceTemplates"]]) {
    const r = await rpc(env, { jsonrpc: "2.0", id: 2, method: m }, "w-tok");
    ok(r.body.result, m); if (key) eq(r.body.result[key], [], m);
  }
  const batch = await rpc(env, [{ jsonrpc: "2.0", id: 1, method: "ping" }, { jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", id: 9, method: "ping" }], "w-tok");
  ok(Array.isArray(batch.body) && batch.body.length === 2, "batch answers 2 of 3");
  const notif = await rpc(env, { jsonrpc: "2.0", method: "notifications/initialized" }, "w-tok");
  eq(notif.status, 202); eq(notif.body, null);
  eq((await rpc(env, { jsonrpc: "2.0", id: 3, method: "tools/call", params: {} }, "w-tok")).body.error.code, -32602);
  eq((await rpc(env, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "nope" } }, "w-tok")).body.error.code, -32602);
  eq((await rpc(env, { jsonrpc: "2.0", id: 5, method: "bogus" }, "w-tok")).body.error.code, -32601);
  eq((await w.fetch(new Request("https://m.test/mcp?token=w-tok", { method: "GET" }), env)).status, 405);
});

await t("read token: list hides write tools; remember_fact and Exuvia write tools refused (-32003)", async () => {
  const env = mkEnv();
  const list = await rpc(env, { jsonrpc: "2.0", id: 1, method: "tools/list" }, "r-tok");
  const names = list.body.result.tools.map((x) => x.name);
  ok(names.includes("search_papers") && names.includes("recall_facts"), "reads listed");
  ok(!names.includes("remember_fact") && !names.includes("exuvia_publish_paper") && !names.includes("exuvia_engage"), "writes hidden");
  const rf = await rpc(env, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "remember_fact", arguments: { content: "x", category: "project_fact" } } }, "r-tok");
  eq(rf.body.error.code, -32003);
  const ep = await rpc(env, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "exuvia_publish_paper", arguments: { slug: "demo", confirm: true } } }, "r-tok");
  eq(ep.body.error.code, -32003);
  const engage = await rpc(env, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "exuvia_engage", arguments: {} } }, "r-tok");
  eq(engage.body.error.code, -32003);
});

// ---- tools over real sqlite ------------------------------------------------
await t("search_papers: vectorize matches joined to D1 titles; mem: rows excluded", async () => {
  const env = mkEnv();
  const r = await call(env, "w-tok", "search_papers", { query: "demo", limit: 10 });
  eq(r.out.count, 2, "papers only, mem: filtered");
  eq(r.out.results[1].title, "Live Paper", "D1 title lookup when metadata lacks it");
  const missing = await call(env, "w-tok", "search_papers", {});
  eq(missing.isError, true);
});

await t("search_papers_enriched: body included, dead 10.5281 DOI hidden (NO-REGISTRAR-1)", async () => {
  const env = mkEnv();
  const r = await call(env, "w-tok", "search_papers_enriched", { query: "demo", limit: 2 });
  const demo = r.out.results.find((x) => x.slug === "demo");
  eq(demo.doi, null, "dead DOI suppressed");
  eq(demo.body, "body text here");
  const live = r.out.results.find((x) => x.slug === "live");
  eq(live.doi, "10.1234/live", "third-party DOI passes");
});

await t("resolve_paper_id: D1 + KG + vector cross-references", async () => {
  const env = mkEnv();
  const r = await call(env, "w-tok", "resolve_paper_id", { id: "demo" });
  eq(r.out.papers[0].slug, "demo");
  const v = await call(env, "w-tok", "resolve_paper_id", { id: "vec:demo" });
  eq(v.out.vector[0].id, "vec:demo");
});

await t("remember_fact: 8000-char body kept, importance clamped, category enum enforced; recall + semantic search find it", async () => {
  const env = mkEnv();
  const long = "L".repeat(3000);
  const r = await call(env, "w-tok", "remember_fact", { content: long, category: "heuristic", importance: 5 });
  eq(r.out.success, true); eq(r.out.importance, 1, "clamped to 1");
  const stored = gdb.prepare("SELECT content FROM agent_memories WHERE id = ?").get(r.out.id);
  eq(stored.content.length, 3000, "full body stored (the 1.x-2.4 code truncated at 800)");
  eq(vz.upserts > 0, true, "embedded + upserted");
  const bad = await call(env, "w-tok", "remember_fact", { content: "x", category: "nonsense" });
  eq(bad.isError, true); ok(/category must be one of/.test(bad.out.error), "enum enforced");
  const nanImp = await call(env, "w-tok", "remember_fact", { content: "y", category: "project_fact", importance: "abc" });
  eq(nanImp.out.importance, 0.7, "NaN importance -> default");
  const rec = await call(env, "w-tok", "recall_facts", { keyword: "LLL" });
  ok(rec.out.results.some((x) => x.id === r.out.id), "recall by keyword");
  const sem = await call(env, "w-tok", "search_memories", { query: "seeded", category: "project_fact" });
  ok(sem.out.results.some((x) => x.content === "seeded memory"), "semantic memory search");
});

await t("query_graph: stats / nodes / neighbors / impact / raw SELECT allowed, DROP refused", async () => {
  const env = mkEnv();
  const stats = await call(env, "w-tok", "query_graph", { endpoint: "stats" });
  eq(stats.out.totalNodes, 2);
  const nodes = await call(env, "w-tok", "query_graph", { endpoint: "nodes", params: { search: "Ultra" } });
  eq(nodes.out.count, 1);
  const nb = await call(env, "w-tok", "query_graph", { endpoint: "neighbors", params: { id: "c1" } });
  ok(nb.out.neighbors.some((x) => x.name === "Demo Paper"), "neighbor joined by name");
  const im = await call(env, "w-tok", "query_graph", { endpoint: "impact", params: { id: "c1" } });
  eq(im.out.upstreamDependencies.length, 1, "paper:demo depends on c1");
  const q = await call(env, "w-tok", "query_graph", { endpoint: "query", params: { sql: "SELECT COUNT(*) AS c FROM nodes" } });
  eq(q.out.results[0].c, 2);
  const drop = await call(env, "w-tok", "query_graph", { endpoint: "query", params: { sql: "DROP TABLE nodes" } });
  eq(drop.isError, true);
  const badEp = await call(env, "w-tok", "query_graph", { endpoint: "bogus" });
  eq(badEp.isError, true);
});

await t("get_paper_context: body, truncation flag, unknown slug", async () => {
  const env = mkEnv();
  const r = await call(env, "w-tok", "get_paper_context", { slug: "demo", limit_chars: 4 });
  eq(r.out.body, "body"); eq(r.out.body_truncated, true); eq(r.out.doi, null);
  const no = await call(env, "w-tok", "get_paper_context", { slug: "nope" });
  eq(no.isError, true);
});

await t("exuvia tools work over mocked platform; publish confirms; key never echoed", async () => {
  const env = mkEnv();
  const st = await call(env, "w-tok", "exuvia_status", {});
  eq(st.out.key_configured, true); eq(st.out.limits.content_max_chars, 50000);
  const feed = await call(env, "w-tok", "exuvia_feed", {});
  eq(feed.isError, false);
  const draft = await call(env, "w-tok", "exuvia_paper_post_draft", { slug: "demo" });
  eq(draft.isError, false); eq(draft.out.slug, "demo");
  const dry = await call(env, "w-tok", "exuvia_publish_paper", { slug: "demo" });
  eq(dry.out.dry_run, true);
  const n = exCalls.filter((c) => c.url.endsWith("/api/v1/posts") && c.init && c.init.method === "POST").length;
  const pub = await call(env, "w-tok", "exuvia_publish_paper", { slug: "demo", confirm: true });
  eq(pub.isError, false);
  eq(exCalls.filter((c) => c.url.endsWith("/api/v1/posts") && c.init && c.init.method === "POST").length, n + 1, "one publish POST");
  ok(!JSON.stringify(pub).includes("exk"), "key never echoed");
  const kgc = await call(env, "w-tok", "exuvia_kg_context", { text: "Ultrametric hierarchies embed" });
  eq(kgc.isError, false); ok(kgc.out.kg_nodes.some((x) => x.name === "Ultrametric"), "kg node found");
});

await t("fleet_graph MCP tools + open findings route hides secret: subjects", async () => {
  const env = mkEnv();
  const f = await call(env, "w-tok", "fleet_graph_find", { query: "alpha" });
  ok(f.out.results.some((x) => x.id === "worker:alpha"), "find via MCP");
  const mcpFindings = await call(env, "w-tok", "fleet_graph_findings", {});
  ok(mcpFindings.out.results.some((x) => x.subject === "secret:alpha.DEPLOY_TOKEN"), "MCP clients see secret findings");
  const openFindings = await get(env, "/fleet-graph/findings");
  ok(openFindings.body.results.some((x) => x.subject === "alpha.NOPE"), "open route keeps normal findings");
  ok(!openFindings.body.results.some((x) => String(x.subject).startsWith("secret:")), "open route hides secret subjects (FULLSCOPE-1)");
  const fr = await get(env, "/fleet-graph/freshness");
  eq(fr.body.scopes[0].scope, "code");
});

// ---- audit ------------------------------------------------------------------
await t("audit: tools/call rows land in mcp_log with tool name", async () => {
  auditDb.exec("DROP TABLE IF EXISTS mcp_log");
  const env = mkEnv();
  await call(env, "w-tok", "recall_facts", { keyword: "audit-me" });
  await call(env, "w-tok", "remember_fact", { content: "audited fact", category: "project_fact" });
  const rows = auditDb.prepare("SELECT tool, args FROM mcp_log ORDER BY ts").all();
  eq(rows.length, 2, "both calls logged");
  ok(rows.some((r) => r.tool === "remember_fact" && r.args.includes("audited fact")), "write logged with args");
});

// ---- SSE transport -----------------------------------------------------------
await t("SSE: spec endpoint event, session POST without token, answers as message frames, read-scope enforced", async () => {
  const env = mkEnv();
  const res = await w.fetch(new Request("https://m.test/mcp/sse?token=r-tok"), env);
  eq(res.status, 200);
  const reader = res.body.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  ok(first.includes("event: endpoint"), "spec frame: " + JSON.stringify(first.slice(0, 60)));
  ok(first.includes("https://m.test/mcp/messages?sessionId="), "absolute messages URI");
  const sessionId = /sessionId=([0-9a-f-]{36})/.exec(first)[1];
  // session-only auth (no token on the POST)
  const pr = await w.fetch(new Request("https://m.test/mcp/messages?sessionId=" + sessionId, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: "recall_facts", arguments: {} } }) }), env);
  eq(pr.status, 202);
  const frame = new TextDecoder().decode((await reader.read()).value);
  ok(frame.includes("event: message") && frame.includes('"id":11'), "tool answer on the stream");
  // read-scope session cannot write
  await w.fetch(new Request("https://m.test/mcp/messages?sessionId=" + sessionId, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 12, method: "tools/call", params: { name: "remember_fact", arguments: { content: "x" } } }) }), env);
  const frame2 = new TextDecoder().decode((await reader.read()).value);
  ok(frame2.includes("-32003"), "write refused on read session");
  // no session + valid token -> inline result (never dropped)
  const inline = await w.fetch(new Request("https://m.test/mcp/messages", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer w-tok" }, body: JSON.stringify({ jsonrpc: "2.0", id: 13, method: "ping" }) }), env);
  eq(inline.status, 200); eq((await inline.json()).id, 13);
  // no session + no token -> 401
  eq((await w.fetch(new Request("https://m.test/mcp/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }), env)).status, 401);
  await reader.cancel();
});

console.log(passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
