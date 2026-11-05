// KG-CURATE-1 offline suite for qnfo-memory-mcp 2.11.0: the open GET /kg/* routes and the kg_* MCP tools answer from the curated
// tables (nodes/edges with status, kg_node_stats, kg_gap, kg_health, kg_state), hide stale edges and inactive nodes, keep hub nodes
// from flooding a neighbourhood, refuse an ambiguous name, never run caller SQL and say plainly when nothing is curated yet.
// Run: node qnfo-memory-mcp/kg.test.mjs
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { versionAtLeast } from "../scripts/version-at-least.mjs";
const here = dirname(fileURLToPath(import.meta.url));
const w = (await import(pathToFileURL(join(here, "worker.js")).href)).default;

const mkEnv = (db) => {
  const prep = (sql0) => { const order = []; const sql = sql0.replace(/\?(\d+)/g, (m, n) => { order.push(Number(n) - 1); return "?"; }); let a = []; const st = { bind: (...x) => { a = order.length ? order.map((i) => (x[i] === undefined ? null : x[i])) : x; return st; }, run: async () => ({ meta: {} }), first: async () => db.prepare(sql).get(...a) || null, all: async () => ({ results: db.prepare(sql).all(...a).map((r) => Object.assign({}, r)), meta: { rows_read: 1 } }) }; return st; };
  return { MCP_TOKEN: "t0k3n", GRAPH_DB: { prepare: prep } };
};
const db = new DatabaseSync(":memory:");
db.exec(`
CREATE TABLE nodes (id TEXT PRIMARY KEY, label TEXT NOT NULL, name TEXT NOT NULL, properties TEXT DEFAULT '{}', created_at TEXT, updated_at TEXT, status TEXT, source TEXT, canonical_id TEXT, last_seen TEXT, h TEXT);
CREATE TABLE edges (id TEXT PRIMARY KEY, source_id TEXT NOT NULL, target_id TEXT NOT NULL, relationship_type TEXT NOT NULL, properties TEXT DEFAULT '{}', created_at TEXT, updated_at TEXT, source TEXT, confidence REAL, weight REAL, status TEXT, evidence TEXT, last_seen TEXT, invalidated_at TEXT);
CREATE TABLE kg_node_stats (node_id TEXT PRIMARY KEY, degree INTEGER, deg_sem INTEGER, pagerank REAL, component INTEGER, community TEXT, updated_at TEXT);
CREATE TABLE kg_gap (id TEXT PRIMARY KEY, kind TEXT, subject TEXT, detail TEXT, score REAL, status TEXT, first_seen TEXT, last_seen TEXT);
CREATE TABLE kg_health (ts TEXT PRIMARY KEY, version TEXT, metrics TEXT);
CREATE TABLE kg_state (k TEXT PRIMARY KEY, v TEXT, updated_at TEXT);
CREATE TABLE kg_tombstone (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, key TEXT, row TEXT, reason TEXT, deleted_at TEXT);`);
const N = (id, label, name, status = null, props = "{}") => db.prepare("INSERT INTO nodes (id, label, name, status, properties, created_at) VALUES (?, ?, ?, ?, ?, '2026-11-01')").run(id, label, name, status, props);
const E = (id, s, t, r, o = {}) => db.prepare("INSERT INTO edges (id, source_id, target_id, relationship_type, source, confidence, weight, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(id, s, t, r, o.source || null, o.c ?? null, o.w ?? null, o.status || null);
N("paper:a", "Paper", "Alpha Paper", null, '{"slug":"a"}'); N("paper:b", "Paper", "Beta Paper"); N("paper:c", "Paper", "Gamma Paper"); N("paper:orphan", "Paper", "Lonely Paper");
N("paper:ghost", "Paper", "Ghost Paper", "ghost"); N("paper:stale-only", "Paper", "Only a stale link");
N("tag:x", "Tag", "x"); N("concept:k", "Concept", "Bruhat-Tits Tree"); N("worker:w", "Worker", "w"); N("vault", "Vault", "Vault"); N("note:1", "Note", "A note");
N("person:1", "Person", "Some Person"); N("dup:1", "Project", "Same Name"); N("dup:2", "Project", "same name");
E("e1", "paper:a", "paper:b", "SIMILAR_TO", { source: "kg:semantic", c: 0.9, w: 0.9 }); E("e2", "paper:b", "paper:c", "CITES", { source: "kg:lp-cite", c: 1, w: 1 });
E("e3", "paper:a", "tag:x", "HAS_TAG", { source: "kg:lp-tag", c: 1, w: 1 }); E("e4", "paper:c", "tag:x", "HAS_TAG", { source: "kg:lp-tag", c: 1, w: 1 });
E("e5", "paper:a", "concept:k", "MENTIONS", { source: "kg:concept", c: 0.8, w: 0.8 }); E("e6", "paper:b", "concept:k", "MENTIONS", { source: "kg:concept", status: "stale" });
E("e9", "paper:a", "person:1", "MENTIONS", { source: "kg:concept", c: 0.8, w: 0.8 }); E("e7", "vault", "note:1", "CONTAINS"); E("e8", "paper:stale-only", "paper:a", "SIMILAR_TO", { source: "kg:semantic", status: "stale" });
db.exec("INSERT INTO kg_node_stats VALUES ('paper:a', 4, 3, 2.5, 1, 'paper:a', 'now'), ('paper:b', 2, 2, 1.2, 1, 'paper:a', 'now'), ('paper:c', 2, 1, 0.4, 1, 'paper:a', 'now')");
db.exec("INSERT INTO kg_gap VALUES ('isolated-paper:paper:orphan', 'isolated-paper', 'paper:orphan', '{\"name\":\"Lonely Paper\"}', 1, 'open', 'a', 'b'), ('bridge-paper:paper:a', 'bridge-paper', 'paper:a', '{}', 3, 'open', 'a', 'b'), ('isolated-paper:old', 'isolated-paper', 'paper:old', '{}', 1, 'resolved', 'a', 'b')");
const iso = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString();
db.prepare("INSERT INTO kg_health VALUES (?, '1.0.0', ?)").run(iso(10), JSON.stringify({ orphan_share: 6.5, edge_density: 1.6, giant_component_share: 83.7, paper_unrelated_share: 43.8, edges_active: 17281, dup_groups: 125 }));
db.prepare("INSERT INTO kg_health VALUES (?, '1.0.0', ?)").run(iso(1500), JSON.stringify({ orphan_share: 19.2, edge_density: 1.08, giant_component_share: 48.8, paper_unrelated_share: 64, edges_active: 9423 }));
db.exec("INSERT INTO kg_state VALUES ('lastRun', '{\"at\":\"x\",\"ok\":true}', 'now'), ('simAdjust', '0', 'now'), ('lease', 'secret-ish', 'now')");
db.exec("INSERT INTO kg_tombstone (kind, key, row, reason, deleted_at) VALUES ('node', 'archive-record-1', '{}', 'placeholder', 'now')");
const env = mkEnv(db);
const get = async (p, e = env) => { const r = await w.fetch(new Request("https://m.test" + p), e); return { status: r.status, body: r.headers.get("Content-Type").includes("json") ? await r.json() : await r.text(), headers: r.headers }; };
const mcp = async (method, params, token) => { const r = await w.fetch(new Request("https://m.test/mcp", { method: "POST", headers: { Authorization: "Bearer " + (token || "t0k3n"), "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }), env); return { status: r.status, body: await r.json() }; };

const h = await get("/health");
assert.ok(h.body.capabilities.includes("kg-curation") && versionAtLeast(h.body.version, "2.11.0"), "health names the capability and the minor bump");
const idx = await get("/kg");
assert.ok(idx.body.queries.includes("/kg/neighbors") && idx.body.queries.includes("/kg/health"));

// health
{
  const r = await get("/kg/health");
  assert.equal(r.status, 200); assert.equal(r.body.stale, false); assert.ok(r.body.age_min >= 9 && r.body.age_min <= 12);
  assert.equal(r.body.metrics.orphan_share, 6.5); assert.equal(r.body.tombstones, 1);
  assert.equal(r.body.trend_newest_first.length, 2); assert.equal(r.body.trend_newest_first[1].orphan_share, 19.2, "the trend shows the earlier, worse reading");
  assert.deepEqual(Object.keys(r.body.state).sort(), ["lastRun", "simAdjust"], "internal state keys such as the lease are not served");
  assert.equal(r.headers.get("Cache-Control"), "public, max-age=60");
}
// find and node
{
  const f = await get("/kg/find?query=alpha");
  assert.equal(f.body.results[0].id, "paper:a");
  assert.equal((await get("/kg/find?query=paper&label=Concept")).body.count, 0);
  const n = await get("/kg/node?id=paper:a");
  assert.equal(n.status, 200); assert.equal(n.body.node.properties.slug, "a"); assert.equal(n.body.stats.pagerank, 2.5);
  assert.deepEqual(n.body.out.map((x) => x.rel).sort(), ["HAS_TAG", "MENTIONS", "SIMILAR_TO"]);
  const sim = n.body.out.find((x) => x.rel === "SIMILAR_TO"); assert.equal(sim.origin, "kg:semantic"); assert.equal(sim.weight, 0.9);
  assert.equal(n.body.in.length, 0, "the stale edge into paper:a is hidden");
  assert.equal((await get("/kg/node?id=paper:a&include_stale=true")).body.in.length, 1, "and shown on request");
  const byName = await get("/kg/node?id=Alpha Paper"); assert.equal(byName.body.id, "paper:a");
  const amb = await get("/kg/node?id=Same Name"); assert.equal(amb.status, 400); assert.match(amb.body.error, /ambiguous: 2/); assert.equal(amb.body.candidates.length, 2);
  assert.equal((await get("/kg/node?id=nope")).status, 400);
}
// neighbours: structural edges and hub expansion
{
  const r = await get("/kg/neighbors?id=paper:a&depth=2");
  const ids = new Map(r.body.nodes.map((x) => [x.id, x.depth]));
  assert.equal(ids.get("paper:b"), 1); assert.equal(ids.get("tag:x"), 1); assert.equal(ids.get("concept:k"), 1);
  assert.equal(ids.get("paper:c"), 2, "reached through the citation, not through the tag hub");
  assert.ok(!ids.has("paper:stale-only"), "a node reachable only by a stale edge is not shown");
  assert.ok(r.body.edges.some((e) => e.s === "paper:c" && e.t === "tag:x"), "cross links between shown nodes are included");
  assert.ok(!r.body.edges.some((e) => e.r === "MENTIONS" && e.s === "paper:b"), "stale edges are not returned");
  assert.equal(r.body.nodes.find((x) => x.id === "paper:a").pagerank, 2.5);
  const tool = async (name, args) => JSON.parse((await mcp("tools/call", { name, arguments: args })).body.result.content[0].text);
  const v = await tool("kg_neighbors", { id: "vault", depth: 1 }); assert.equal(v.nodes.length, 1, "CONTAINS is structural and hidden by default");
  const v2 = await tool("kg_neighbors", { id: "vault", depth: 1, structural: true }); assert.equal(v2.nodes.length, 2);
  assert.equal((await get("/kg/neighbors?id=paper:a&depth=1&min_weight=0.95")).body.nodes.length, 2, "min_weight drops the 0.9 and 0.8 edges; the tag edge (no weight, counts as 1) stays");
}
// the open routes never serve the owner's notes or people; the authenticated tools do
{
  const tool = async (name, args) => JSON.parse((await mcp("tools/call", { name, arguments: args })).body.result.content[0].text);
  for (const id of ["note:1", "person:1", "vault"]) { const r = await get("/kg/node?id=" + id); assert.equal(r.status, 400, id + " is withheld"); assert.match(r.body.error, /withheld/); }
  assert.equal((await get("/kg/find?query=person")).body.count, 0, "find does not list people");
  assert.equal((await get("/kg/find?query=a note")).body.count, 0, "or notes");
  const n = await get("/kg/node?id=paper:a"); assert.ok(!n.body.out.some((x) => x.other === "person:1"), "a paper's edge to a person is not shown");
  const nb = await get("/kg/neighbors?id=paper:a&depth=2"); assert.ok(!nb.body.nodes.some((x) => x.id === "person:1") && !nb.body.edges.some((e) => e.t === "person:1"), "nor in a neighbourhood");
  assert.ok(!(await get("/kg/orphans")).body.results.some((x) => ["Note", "Person", "Vault"].includes(x.label)), "nor among the orphans");
  assert.equal((await tool("kg_node", { id: "person:1" })).node.label, "Person", "an authenticated client sees them");
  assert.ok((await tool("kg_neighbors", { id: "paper:a", depth: 1 })).nodes.some((x) => x.id === "person:1"));
}
// route names are own properties only
for (const evil of ["constructor", "__proto__", "toString", "hasOwnProperty"]) { const r = await get("/kg/" + evil); assert.equal(r.status, 404, "/kg/" + evil); assert.ok(!JSON.stringify(r.body).includes("t0k3n"), "/kg/" + evil + " does not echo the env"); }
// path
{
  const p = await get("/kg/path?from=paper:a&to=paper:c");
  assert.equal(p.body.length, 2); assert.equal(p.body.via_structural_edges, false);
  assert.deepEqual(p.body.path.map((s) => s.rel), ["SIMILAR_TO", "CITES"]); assert.equal(p.body.truncated, false);
  const none = await get("/kg/path?from=paper:a&to=paper:orphan"); assert.equal(none.body.path, null);
  assert.equal((await get("/kg/path?from=vault&to=note:1")).status, 400, "a path through withheld nodes is refused on the open route");
  const viaStructural = JSON.parse((await mcp("tools/call", { name: "kg_path", arguments: { from: "vault", to: "note:1" } })).body.result.content[0].text); assert.equal(viaStructural.via_structural_edges, true);
}
// central, gaps, orphans, communities
{
  const c = await get("/kg/central?label=Paper"); assert.deepEqual(c.body.results.map((x) => x.id), ["paper:a", "paper:b", "paper:c"]);
  const g = await get("/kg/gaps"); assert.equal(g.body.totals.find((x) => x.kind === "isolated-paper").n, 1, "resolved gaps are not counted");
  assert.equal((await get("/kg/gaps?kind=bridge-paper")).body.results[0].subject, "paper:a");
  const o = await get("/kg/orphans?label=Paper"); assert.deepEqual(o.body.results.map((x) => x.id).sort(), ["paper:orphan", "paper:stale-only"], "a node with only a stale edge is an orphan");
  assert.ok(o.body.results.every((x) => x.id !== "paper:ghost"), "inactive nodes are not orphans");
  const cm = await get("/kg/communities"); assert.equal(cm.body.results[0].members, 3);
}
// viewer
{
  const v = await get("/kg/view");
  assert.equal(v.status, 200); assert.match(v.body, /<canvas/); assert.match(v.headers.get("Content-Security-Policy"), /connect-src 'self'/); assert.equal(v.headers.get("X-Content-Type-Options"), "nosniff");
}
// unknown and caller SQL
{
  assert.equal((await get("/kg/nope")).status, 404);
  assert.equal((await get("/kg/find?query=" + encodeURIComponent("x'; DROP TABLE nodes; --"))).status, 200, "a hostile query is data");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM nodes").get().n, 14, "and nothing was dropped");
}
// MCP tools
{
  const list = await mcp("tools/list", {}); const names = list.body.result.tools.map((t) => t.name);
  for (const t of ["kg_health", "kg_find", "kg_node", "kg_neighbors", "kg_path", "kg_central", "kg_gaps", "kg_orphans", "kg_communities"]) assert.ok(names.includes(t), t + " is listed");
  const call = await mcp("tools/call", { name: "kg_find", arguments: { query: "gamma" } });
  assert.equal(JSON.parse(call.body.result.content[0].text).results[0].id, "paper:c");
  const noTok = await w.fetch(new Request("https://m.test/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }), env); assert.equal(noTok.status, 401);
}
// nothing curated yet
{
  const empty = new DatabaseSync(":memory:");
  empty.exec("CREATE TABLE nodes (id TEXT PRIMARY KEY, label TEXT, name TEXT, status TEXT); CREATE TABLE edges (id TEXT PRIMARY KEY, source_id TEXT, target_id TEXT, relationship_type TEXT)");
  const r = await get("/kg/health", mkEnv(empty)); assert.equal(r.status, 503); assert.match(r.body.error, /not been curated/);
}
console.log("kg suite ok");
