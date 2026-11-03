// FLEET-GRAPH-1 offline suite for qnfo-memory-mcp 2.1.0: the open GET /fleet-graph/* routes and the fleet_graph_* MCP tools
// answer from the fg_* tables, refuse an ambiguous name with its candidates, keep secret NAMES off the open routes, walk
// impact and paths with a visited set, and never run caller SQL. Run: node qnfo-memory-mcp/fleet-graph.test.mjs
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { versionAtLeast } from "../scripts/version-at-least.mjs";
const here = dirname(fileURLToPath(import.meta.url));
const w = (await import(pathToFileURL(join(here, "worker.js")).href)).default;
const FG = await import(pathToFileURL(join(here, "..", "scripts", "fleet_graph.mjs")).href);

const db = new DatabaseSync(":memory:");
const likeDb = new DatabaseSync(":memory:");
db.function("like", (pattern, value) => {
  if (Buffer.byteLength(pattern, "utf8") > 50) throw new Error("LIKE or GLOB pattern too complex");
  return likeDb.prepare("SELECT ? LIKE ? AS matched").get(value, pattern).matched;
});
assert.throws(() => db.prepare("SELECT 'x' LIKE ?").get("x".repeat(51)), /pattern too complex/, "fixture enforces D1's 50-byte pattern limit");
for (const s of FG.SCHEMA_SQL) db.exec(s);
const g = new FG.Graph("code");
g.node("worker:alpha", "worker", "alpha", { worker: "alpha", attrs: { version: "1.0.0" } });
g.node("worker:beta", "worker", "beta", { worker: "beta" });
g.node("fn:alpha#tick", "handler", "default.scheduled", { worker: "alpha", path: "alpha/worker.js", line: 10 });
g.node("fn:alpha#helper", "function", "helper", { worker: "alpha", path: "alpha/worker.js", line: 3 });
g.node("fn:beta#helper", "function", "helper", { worker: "beta", path: "beta/worker.js", line: 4 });
g.node("binding:alpha.AUDIT", "binding", "AUDIT", { worker: "alpha" });
g.node("d1:qnfo-audit", "d1", "qnfo-audit");
g.node("d1t:qnfo-audit.agent_issues", "d1_table", "agent_issues");
g.edge("worker:alpha", "contains", "fn:alpha#tick");
g.edge("worker:alpha", "contains", "fn:alpha#helper");
g.edge("fn:alpha#tick", "calls", "fn:alpha#helper");
g.edge("fn:alpha#helper", "uses_binding", "binding:alpha.AUDIT");
g.edge("fn:alpha#helper", "writes", "d1t:qnfo-audit.agent_issues");
g.edge("worker:alpha", "has_binding", "binding:alpha.AUDIT");
g.edge("binding:alpha.AUDIT", "binds", "d1:qnfo-audit");
g.edge("fn:beta#helper", "http_calls", "worker:alpha");
g.edge("worker:beta", "contains", "fn:beta#helper");
const gl = new FG.Graph("live");
gl.node("worker:alpha", "worker", "alpha", { worker: "alpha", attrs: { live: true } });
gl.node("secret:alpha.DEPLOY_TOKEN", "secret", "DEPLOY_TOKEN", { worker: "alpha" });
gl.edge("worker:alpha", "has_secret", "secret:alpha.DEPLOY_TOKEN", { confidence: "OBSERVED" });
gl.node("d1trg:qnfo-audit.issue_log", "d1_trigger", "issue_log");
gl.edge("d1trg:qnfo-audit.issue_log", "fires_on", "d1t:qnfo-audit.agent_issues", { confidence: "OBSERVED" });
const now = "2026-10-19T05:00:00Z";
for (const b of [g.finalize(now), gl.finalize(now)]) {
  for (const s of FG.insertStatements("fg_node", ["id", "scope", "kind", "name", "worker", "path", "line", "attrs", "source", "h", "updated_at"], [...b.nodes.values()])) db.exec(s);
  for (const s of FG.insertStatements("fg_edge", ["src", "rel", "dst", "scope", "confidence", "source", "path", "attrs", "h", "updated_at"], [...b.edges.values()])) db.exec(s);
}
db.exec("INSERT INTO fg_finding (id, kind, subject, severity, detail, h, first_seen, last_seen) VALUES ('env-undeclared:alpha.NOPE', 'env-undeclared', 'alpha.NOPE', 'warn', 'reads env.NOPE', 'x', '" + now + "', '" + now + "')");
db.exec("INSERT INTO fg_state (scope, sha, built_at, nodes, edges, written, deleted, ms, status, detail, version) VALUES ('code', 'abc', '" + now + "', 8, 9, 17, 0, 10, 'ok', '', '1.0.0')");

const sqlSeen = [];
const prep = (sql0) => { sqlSeen.push(sql0); const order = []; const sql = sql0.replace(/\?(\d+)/g, (m, n) => { order.push(Number(n) - 1); return "?"; }); let a = []; const st = { bind: (...x) => { a = order.length ? order.map((i) => (x[i] === undefined ? null : x[i])) : x; return st; }, run: async () => { const r = db.prepare(sql).run(...a); return { meta: { changes: Number(r.changes) } }; }, first: async () => db.prepare(sql).get(...a) || null, all: async () => ({ results: db.prepare(sql).all(...a).map((r) => Object.assign({}, r)), meta: { rows_read: 1 } }) }; return st; };
const env = { MCP_TOKEN: "t0k3n", GRAPH_DB: { prepare: prep } };
const get = async (p) => { const r = await w.fetch(new Request("https://m.test" + p), env); return { status: r.status, body: await r.json(), cache: r.headers.get("Cache-Control") }; };
const mcp = async (name, args, token) => { const r = await w.fetch(new Request("https://m.test/mcp", { method: "POST", headers: { Authorization: "Bearer " + (token || "t0k3n"), "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }), env); return { status: r.status, body: await r.json() }; };

const h = await get("/health");
assert.ok(h.body.capabilities.includes("fleet-graph") && versionAtLeast(h.body.version, "2.1.0"), "health names the capability and the minor bump");
const idx = await get("/fleet-graph");
assert.ok(idx.body.queries.includes("/fleet-graph/impact"), "index lists the queries");

const f = await get("/fleet-graph/find?query=agent_issues");
assert.equal(f.status, 200); assert.equal(f.body.results[0].id, "d1t:qnfo-audit.agent_issues", "find by name"); assert.equal(f.cache, "public, max-age=60");
const amb = await get("/fleet-graph/node?id=helper");
assert.equal(amb.status, 400); assert.match(amb.body.error, /ambiguous/); assert.equal(amb.body.candidates.length, 2, "an ambiguous name is refused with its candidates");

const imp = await get("/fleet-graph/impact?id=d1t:qnfo-audit.agent_issues&depth=3");
const ids = imp.body.results.map((x) => x.id);
for (const want of ["fn:alpha#helper", "fn:alpha#tick", "worker:alpha", "d1trg:qnfo-audit.issue_log", "fn:beta#helper"]) assert.ok(ids.includes(want), "impact up reaches " + want + " " + JSON.stringify(ids));
assert.equal(imp.body.workers_affected.alpha, 1, "workers_affected carries the shallowest depth");
assert.equal(imp.body.workers_affected.beta, 3, "a caller in another worker counts that worker as affected");
assert.equal(new Set(ids).size, ids.length, "each node once (visited set)");
const shallow = await get("/fleet-graph/impact?id=d1t:qnfo-audit.agent_issues&depth=1");
assert.ok(!shallow.body.results.some((x) => x.id === "fn:beta#helper"), "depth bounds the walk");
const down = await get("/fleet-graph/impact?id=fn:alpha#tick&direction=down&depth=4".replace("#", "%23"));
assert.ok(down.body.results.some((x) => x.id === "d1:qnfo-audit"), "impact down reaches the database through the binding");

const p = await get("/fleet-graph/path?from=" + encodeURIComponent("fn:alpha#tick") + "&to=d1:qnfo-audit");
assert.ok(p.body.path && p.body.directed && p.body.path.length === 3, "directed path " + JSON.stringify(p.body));
const p2 = await get("/fleet-graph/path?from=worker:beta&to=" + encodeURIComponent("d1t:qnfo-audit.agent_issues"));
assert.ok(p2.body.path && p2.body.length >= 2, "undirected fallback finds a path " + JSON.stringify(p2.body));

const wo = await get("/fleet-graph/worker?worker=alpha");
assert.equal(wo.body.worker, "alpha"); assert.equal(wo.body.secrets.count, 1); assert.ok(!JSON.stringify(wo.body).includes("DEPLOY_TOKEN"), "the open route withholds secret names");
assert.ok(wo.body.findings.some((x) => x.subject === "alpha.NOPE"), "worker view carries its findings");
const node = await get("/fleet-graph/node?id=worker:alpha");
assert.ok(!JSON.stringify(node.body).includes("DEPLOY_TOKEN"), "node view hides secret edges on the open route");
const tool = await mcp("fleet_graph_worker", { worker: "alpha" });
assert.ok(JSON.parse(tool.body.result.content[0].text).secrets.includes("DEPLOY_TOKEN"), "authenticated MCP clients see secret names");
const unauth = await mcp("fleet_graph_worker", { worker: "alpha" }, "wrong");
assert.equal(unauth.status, 401, "MCP stays bearer-gated");

const fi = await get("/fleet-graph/findings?severity=warn");
assert.equal(fi.body.count, 1); assert.ok(fi.body.totals.length >= 1);
const fr = await get("/fleet-graph/freshness");
assert.equal(fr.body.scopes[0].scope, "code");
const bad = await get("/fleet-graph/sql?q=DROP%20TABLE%20fg_node");
assert.equal(bad.status, 404, "no raw SQL route");
assert.ok(sqlSeen.length > 10 && sqlSeen.every((s) => /^\s*(SELECT|WITH)\b/i.test(s)), "the worker issued only reads");
const res = await get("/fleet-graph/resource?id=d1:qnfo-audit");
assert.ok(res.body.workers.alpha && res.body.workers.alpha.includes("binds"), "resource view groups binders by worker");
for (const name of ["x".repeat(49), "x".repeat(50), "x".repeat(300), "é".repeat(30), "literal_%", "quote' OR 1=1 --"]) {
  const addNode = (id, kind, label, scope = "code") => db.prepare("INSERT INTO fg_node (id, scope, kind, name, attrs, source, h, updated_at) VALUES (?, ?, ?, ?, '{}', 'test', 'test', ?)").run(id, scope, kind, label, now);
  addNode("worker:" + name, "worker", name);
  addNode("worker:prefix-" + name, "worker", name + "-suffix");
  addNode("worker:contains-" + name, "worker", "other");
  const find = await get("/fleet-graph/find?query=" + encodeURIComponent(name) + "&kind=worker&limit=3");
  assert.equal(find.status, 200, JSON.stringify(find.body));
  assert.deepEqual(find.body.results.map((x) => x.id), ["worker:" + name, "worker:prefix-" + name, "worker:contains-" + name], "exact, name-prefix, then ID-substring ranking");
  const rpcFind = await mcp("fleet_graph_find", { query: name, kind: "worker", limit: 3 });
  assert.equal(JSON.parse(rpcFind.body.result.content[0].text).results[0].id, "worker:" + name, "MCP uses the same long-query-safe lookup");
}
const caseFind = await get("/fleet-graph/find?query=ALP");
assert.equal(caseFind.body.results[0].id, "worker:alpha", "prefix matching remains ASCII case-insensitive");
const wildcardFind = await get("/fleet-graph/find?query=literalZx");
assert.equal(wildcardFind.body.count, 0, "wildcards in stored names do not expand");
const percentFind = await get("/fleet-graph/find?query=%25&kind=worker");
assert.deepEqual(percentFind.body.results.map((x) => x.id).sort(), ["worker:contains-literal_%", "worker:literal_%", "worker:prefix-literal_%"].sort(), "caller wildcards are literal, not a match-all");

const longWorker = "worker_" + "w".repeat(60);
const longDb = "db_" + "d".repeat(60);
db.prepare("INSERT INTO fg_node (id, scope, kind, name, worker, attrs, source, h, updated_at) VALUES (?, 'code', 'worker', ?, ?, '{}', 'test', 'test', ?)").run("worker:" + longWorker, longWorker, longWorker, now);
db.prepare("INSERT INTO fg_node (id, scope, kind, name, attrs, source, h, updated_at) VALUES (?, 'live', 'd1', ?, '{}', 'test', 'test', ?)").run("d1:" + longDb, longDb, now);
for (const [prefix, kind] of [["d1t:", "d1_table"], ["d1v:", "d1_view"], ["d1trg:", "d1_trigger"]]) {
  db.prepare("INSERT INTO fg_node (id, scope, kind, name, attrs, source, h, updated_at) VALUES (?, 'live', ?, 'item', '{}', 'test', 'test', ?)").run(prefix + longDb + ".item", kind, now);
}
for (const [src, rel, dst] of [
  ["worker:" + longWorker, "has_binding", "binding:" + longWorker + ".DB"],
  ["binding:" + longWorker + ".DB", "binds", "d1:" + longDb],
  ["fn:" + longWorker + "#run", "reads", "d1t:" + longDb + ".item"],
  ["fn:" + longWorker + "#run", "http_calls", "worker:alpha"]
]) db.prepare("INSERT INTO fg_edge (src, rel, dst, scope, confidence, source, h, updated_at) VALUES (?, ?, ?, 'code', 'OBSERVED', 'test', 'test', ?)").run(src, rel, dst, now);
for (const subject of [longWorker + ".DB", longWorker + ":drift"]) {
  db.prepare("INSERT INTO fg_finding (id, kind, subject, severity, detail, h, first_seen, last_seen) VALUES (?, 'binding-drift', ?, 'warn', 'test', 'test', ?, ?)").run(subject, subject, now, now);
}
const longWorkerView = await get("/fleet-graph/worker?worker=" + encodeURIComponent(longWorker));
assert.equal(longWorkerView.status, 200, JSON.stringify(longWorkerView.body));
assert.equal(longWorkerView.body.bindings.declared[0].resource, "d1:" + longDb);
assert.equal(longWorkerView.body.d1_tables[0].table_id, "d1t:" + longDb + ".item");
assert.equal(longWorkerView.body.calls_out[0].dst, "worker:alpha");
assert.equal(longWorkerView.body.findings.length, 2);
const longResource = await get("/fleet-graph/resource?id=" + encodeURIComponent("d1:" + longDb));
assert.equal(longResource.status, 200, JSON.stringify(longResource.body));
assert.deepEqual(longResource.body.contains.map((x) => x.kind).sort(), ["d1_table", "d1_trigger", "d1_view"]);
const longFindings = await get("/fleet-graph/findings?kind=binding-drift&severity=warn&subject=" + encodeURIComponent(longWorker.toUpperCase()));
assert.equal(longFindings.status, 200, JSON.stringify(longFindings.body));
assert.equal(longFindings.body.count, 2, "long finding subjects remain case-insensitive substrings");
// graph not built yet -> 503 with a clear message, not a stack
const empty = new DatabaseSync(":memory:");
const r0 = await w.fetch(new Request("https://m.test/fleet-graph/freshness"), { MCP_TOKEN: "x", GRAPH_DB: { prepare: (s) => ({ bind() { return this; }, all: async () => { empty.prepare(s); return { results: [] }; }, first: async () => null }) } });
assert.equal(r0.status, 503, "missing fg_* tables answer 503 " + r0.status);
console.log("fleet-graph.test.mjs ok");
