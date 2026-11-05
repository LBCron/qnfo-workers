// MEMORY-TIERING-1 offline suite (agent_issues 1000637, qnfo-memory-mcp 2.9.0): tier and role on every write, memory_outcome, memory_tiering_metrics,
// rank=weighted search, the hourly tier snapshot, and the rule that every advertised tool has a handler. GRAPH_DB and AUDIT are in-memory SQLite
// (node:sqlite) with the production table shapes; AI, Vectorize and the network are stubs. Run: node qnfo-memory-mcp/memory-tiering.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { versionAtLeast } from "../scripts/version-at-least.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const w = (await import(pathToFileURL(join(here, "worker.js")).href)).default;

// ---- D1 over node:sqlite (numbered ?N parameters, reused)
function d1(db) {
  return {
    prepare(sql0) {
      const order = [];
      const sql = sql0.replace(/\?(\d+)/g, (m, n) => { order.push(Number(n) - 1); return "?"; });
      let args = [];
      const s = {
        bind(...a) { a = a.map((v) => (v === undefined ? null : v)); args = order.length ? order.map((i) => a[i]) : a; return s; },
        async first() { const r = db.prepare(sql).get(...args); return r === undefined ? null : { ...r }; },
        async all() { return { results: db.prepare(sql).all(...args).map((r) => ({ ...r })) }; },
        async run() { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; }
      };
      return s;
    }
  };
}

// The AUDIT tables are the ones the migration creates, read from the migration file so the worker and the store cannot drift.
const migration = readFileSync(join(here, "..", "migrations", "2026-11-05-memory-tiering-store.sql"), "utf8");
const storeDdl = migration.split("\n").filter((l) => !l.startsWith("--")).join("\n").split(/;\s*\n/)
  .map((s) => s.trim()).filter((s) => /^CREATE (TABLE|INDEX|VIEW) IF NOT EXISTS (memory_|idx_memory_|v_memory_)/.test(s));
assert.ok(storeDdl.length >= 7, "the migration creates three tables, an index and three views: " + storeDdl.length);

function makeEnv(opts = {}) {
  const graph = new DatabaseSync(":memory:");
  graph.exec("CREATE TABLE agent_memories (id TEXT PRIMARY KEY, category TEXT NOT NULL, content TEXT NOT NULL, summary TEXT, importance REAL DEFAULT 0.7, session_id TEXT, created_at TEXT DEFAULT (datetime('now')), expires_at TEXT, metadata_json TEXT)");
  const audit = new DatabaseSync(":memory:");
  if (!opts.noStore) for (const ddl of storeDdl) audit.exec(ddl);
  const upserts = [];
  let matches = [];
  const env = {
    MCP_TOKEN: "t", MCP_READ_TOKEN: "r",
    AI: { run: async () => ({ data: [[0.1, 0.2]] }) },
    PAPER_VZ: { upsert: async (rows) => { upserts.push(...rows); }, query: async () => ({ matches }) },
    GRAPH_DB: d1(graph),
    LIVING_PAPER: d1(new DatabaseSync(":memory:")),
    ...(opts.noAudit ? {} : { AUDIT: d1(audit) })
  };
  return { env, graph, audit, upserts, setMatches(m) { matches = m; } };
}
globalThis.fetch = async () => new Response(JSON.stringify({}), { status: 200 });

const rpcRaw = async (env, method, params, token = "t") => {
  const r = await w.fetch(new Request("https://x/mcp", { method: "POST", headers: { Authorization: "Bearer " + token }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }), env);
  return r.json();
};
const call = async (env, name, args, token) => {
  const j = await rpcRaw(env, "tools/call", { name, arguments: args }, token);
  const res = j.result || {};
  const text = res.content && res.content[0] ? res.content[0].text : JSON.stringify(j.error || {});
  let out; try { out = JSON.parse(text); } catch (e) { out = { text }; }
  return { isError: !!res.isError || !!j.error, out, text };
};

const health = await (await w.fetch(new Request("https://x/health"), makeEnv().env)).json();
assert.ok(versionAtLeast(health.version, "2.9.0"), "version " + health.version);

// 1. every advertised tool has a handler (PR 6364 advertised two that answered "Unknown tool")
{
  const { env } = makeEnv();
  const list = (await rpcRaw(env, "tools/list", {})).result.tools;
  const names = list.map((t) => t.name);
  for (const n of ["memory_outcome", "memory_tiering_metrics", "remember_fact", "search_memories"]) assert.ok(names.includes(n), n + " is advertised");
  for (const name of names) {
    const r = await call(env, name, {});
    assert.ok(!(r.isError && /Unknown tool/.test(r.text)), name + " is advertised but has no handler: " + r.text.slice(0, 120));
  }
  // the dispatch table and the source agree, so a tool added to TOOLS without a handler fails here even if its empty call errors for another reason
  const src = readFileSync(join(here, "worker.js"), "utf8");
  assert.ok(src.includes("memory_outcome: tool_memory_outcome") && src.includes("memory_tiering_metrics: tool_memory_tiering_metrics"), "callTool binds both memory tools");
}

// 2. remember_fact: tier, role and provenance next to source (the first step), episodic only
{
  const { env, graph } = makeEnv();
  const a = await call(env, "remember_fact", { content: "The deploy lock lives in qnfo-deploy-guard.", category: "project_fact" });
  assert.equal(a.isError, false);
  assert.equal(a.out.tier, "episodic", "default tier is episodic");
  assert.equal(a.out.role, "agent", "default role is agent");
  const row = graph.prepare("SELECT metadata_json FROM agent_memories WHERE id = ?").get(a.out.id);
  const meta = JSON.parse(row.metadata_json);
  assert.equal(meta.source, "qnfo-memory-mcp");
  assert.equal(meta.tier, "episodic");
  assert.equal(meta.role, "agent");
  assert.equal(meta.provenance, null);
  assert.ok(Date.parse(meta.timestamp) > 0, "timestamp kept next to source");
  const b = await call(env, "remember_fact", { content: "Prefer small PRs.", category: "heuristic", role: "user", provenance: "session F1-research-reach/E", tier: "episodic" });
  assert.equal(b.out.role, "user");
  const metaB = JSON.parse(graph.prepare("SELECT metadata_json FROM agent_memories WHERE id = ?").get(b.out.id).metadata_json);
  assert.equal(metaB.role, "user");
  assert.equal(metaB.provenance, "session F1-research-reach/E");
  const c = await call(env, "remember_fact", { content: "A distilled fact.", category: "heuristic", tier: "semantic" });
  assert.equal(c.isError, true, "a caller cannot write a semantic row");
  assert.match(c.out.error, /tier must be one of episodic/);
  assert.equal(graph.prepare("SELECT COUNT(*) n FROM agent_memories").get().n, 2, "the refused write stored nothing");
  const d = await call(env, "remember_fact", { content: "x".repeat(10), category: "heuristic", role: "r".repeat(200), provenance: "p".repeat(500) });
  const metaD = JSON.parse(graph.prepare("SELECT metadata_json FROM agent_memories WHERE id = ?").get(d.out.id).metadata_json);
  assert.equal(metaD.role.length, 40);
  assert.equal(metaD.provenance.length, 200);
  // a read-only credential cannot write
  const ro = await call(env, "remember_fact", { content: "nope", category: "heuristic" }, "r");
  assert.equal(ro.isError, true);
}

// 3. memory_outcome: idempotent per (memory_id, feedback_id)
{
  const { env, audit } = makeEnv();
  const id = (await call(env, "remember_fact", { content: "Outcome target memory.", category: "project_fact" })).out.id;
  assert.equal((await call(env, "memory_outcome", { memory_id: "mem:project_fact:1:deadbeef", outcome: "success", feedback_id: "f1" })).isError, true, "unknown memory refused");
  assert.equal((await call(env, "memory_outcome", { memory_id: "not-an-id", outcome: "success", feedback_id: "f1" })).isError, true, "malformed id refused");
  assert.equal((await call(env, "memory_outcome", { memory_id: id, outcome: "maybe", feedback_id: "f1" })).isError, true, "bad outcome refused");
  assert.equal((await call(env, "memory_outcome", { memory_id: id, outcome: "success" })).isError, true, "feedback_id required");
  const first = await call(env, "memory_outcome", { memory_id: id, outcome: "success", feedback_id: "f1", provenance: "unit test" });
  assert.deepEqual([first.out.success, first.out.recorded, first.out.duplicate, first.out.conflict], [true, true, false, false]);
  const again = await call(env, "memory_outcome", { memory_id: id, outcome: "success", feedback_id: "f1" });
  assert.deepEqual([again.out.recorded, again.out.duplicate, again.out.conflict, again.out.outcome], [false, true, false, "success"]);
  const conflict = await call(env, "memory_outcome", { memory_id: id, outcome: "failure", feedback_id: "f1" });
  assert.deepEqual([conflict.out.recorded, conflict.out.duplicate, conflict.out.conflict, conflict.out.outcome], [false, true, true, "success"], "the first answer for a feedback id stands");
  await call(env, "memory_outcome", { memory_id: id, outcome: "failure", feedback_id: "f2" });
  const rows = audit.prepare("SELECT outcome, feedback_id, provenance FROM memory_outcomes ORDER BY id").all();
  assert.deepEqual(rows.map((r) => r.outcome + ":" + r.feedback_id), ["success:f1", "failure:f2"]);
  assert.equal(rows[0].provenance, "unit test");
  // no store, no silent success
  const bare = makeEnv({ noAudit: true });
  const id2 = (await call(bare.env, "remember_fact", { content: "Another outcome target.", category: "project_fact" })).out.id;
  const noStore = await call(bare.env, "memory_outcome", { memory_id: id2, outcome: "success", feedback_id: "f1" });
  assert.equal(noStore.isError, true);
  assert.match(noStore.out.error, /outcome store unavailable/);
  const before = makeEnv({ noStore: true });
  const id3 = (await call(before.env, "remember_fact", { content: "Before the migration.", category: "project_fact" })).out.id;
  const noTable = await call(before.env, "memory_outcome", { memory_id: id3, outcome: "success", feedback_id: "f1" });
  assert.equal(noTable.isError, true, "a missing table is reported, not swallowed");
}

// 4. memory_tiering_metrics: counts by tier (rows with no tier are episodic), consolidation runs, 7 and 30 day hit rates
{
  const { env, graph, audit } = makeEnv();
  const ins = graph.prepare("INSERT INTO agent_memories (id, category, content, created_at, metadata_json) VALUES (?, 'project_fact', 'c', ?, ?)");
  ins.run("mem:project_fact:1:aaaaaaaa", "2026-07-14T10:00:00.000Z", null);
  ins.run("mem:project_fact:2:bbbbbbbb", "2026-08-01T10:00:00.000Z", JSON.stringify({ source: "qnfo-memory-mcp", timestamp: "2026-08-01T10:00:00.000Z" }));
  ins.run("mem:project_fact:3:cccccccc", "2026-09-01T10:00:00.000Z", "not json at all");
  ins.run("mem:project_fact:4:dddddddd", "2026-11-01T10:00:00.000Z", JSON.stringify({ tier: "episodic", role: "agent" }));
  ins.run("mem:project_fact:5:eeeeeeee", "2026-11-02T10:00:00.000Z", JSON.stringify({ tier: "episodic", role: "agent" }));
  ins.run("mem:heuristic:6:ffffffff", "2026-11-03T10:00:00.000Z", JSON.stringify({ tier: "semantic", role: "consolidation" }));
  let m = (await call(env, "memory_tiering_metrics", {})).out;
  const byKey = Object.fromEntries(m.tiers.map((t) => [t.tier + "/" + t.role, t.n]));
  assert.deepEqual(byKey, { "untiered/unknown": 3, "episodic/agent": 2, "semantic/consolidation": 1 }, JSON.stringify(m.tiers));
  assert.equal(m.episodic_effective, 5, "rows with no tier count as episodic");
  assert.equal(m.semantic, 1);
  assert.deepEqual(m.consolidation, { runs: 0, episodic_in: 0, semantic_out: 0, last_run: null });
  assert.deepEqual(m.outcomes.d7, { success: 0, failure: 0, hit_rate: null }, "no outcomes, no hit rate");
  const now = Date.now();
  const iso = (daysAgo) => new Date(now - daysAgo * 864e5).toISOString();
  const oc = audit.prepare("INSERT INTO memory_outcomes (memory_id, outcome, feedback_id, ts) VALUES (?, ?, ?, ?)");
  oc.run("mem:project_fact:4:dddddddd", "success", "a", iso(1));
  oc.run("mem:project_fact:4:dddddddd", "success", "b", iso(2));
  oc.run("mem:project_fact:5:eeeeeeee", "failure", "c", iso(3));
  oc.run("mem:project_fact:5:eeeeeeee", "failure", "d", iso(20));
  oc.run("mem:project_fact:4:dddddddd", "success", "e", iso(25));
  oc.run("mem:project_fact:4:dddddddd", "success", "f", iso(45));
  audit.prepare("INSERT INTO memory_consolidation_runs (ts, kind, episodic_in, semantic_out) VALUES (?, 'consolidate', 6, 2)").run(iso(0.5));
  m = (await call(env, "memory_tiering_metrics", {})).out;
  assert.deepEqual(m.outcomes.d7, { success: 2, failure: 1, hit_rate: 0.6667 });
  assert.deepEqual(m.outcomes.d30, { success: 3, failure: 2, hit_rate: 0.6 }, "the 45 day old outcome is outside both windows");
  assert.equal(m.consolidation.runs, 1);
  assert.equal(m.consolidation.episodic_in, 6);
  assert.equal(m.consolidation.semantic_out, 2);
  // the view reads the same numbers from the hourly snapshot
  await w.scheduled({}, env, { waitUntil: (p) => p });
  await new Promise((r) => setTimeout(r, 50));
  const v = audit.prepare("SELECT * FROM v_memory_tiering").get();
  assert.equal(v.episodic_rows_effective, 5);
  assert.equal(v.untiered_rows, 3);
  assert.equal(v.semantic_rows, 1);
  assert.equal(v.consolidation_runs, 1);
  assert.equal(v.episodic_consolidated, 6);
  assert.equal(v.semantic_produced, 2);
  assert.equal(v.outcomes_7d, 3);
  assert.equal(v.hit_rate_7d, 0.6667);
  assert.equal(v.outcomes_30d, 5);
  assert.equal(v.hit_rate_30d, 0.6);
  // read-only credentials may read the metrics
  assert.equal((await call(env, "memory_tiering_metrics", {}, "r")).isError, false);
}

// 5. the hourly snapshot: one row per tier and role, replaced within the hour, and a failure never throws
{
  const { env, graph, audit } = makeEnv();
  await call(env, "remember_fact", { content: "Snapshot target.", category: "project_fact" });
  const pending = [];
  await w.scheduled({}, env, { waitUntil: (p) => pending.push(p) });
  await Promise.all(pending);
  await w.scheduled({}, env, { waitUntil: (p) => pending.push(p) });
  await Promise.all(pending);
  const rows = audit.prepare("SELECT tier, role, n FROM memory_tier_counts").all();
  assert.deepEqual(rows.map((r) => r.tier + "/" + r.role + "/" + r.n), ["episodic/agent/1"], "two ticks in one hour leave one row per tier and role");
  graph.exec("DROP TABLE agent_memories");
  const broken = [];
  await w.scheduled({}, env, { waitUntil: (p) => broken.push(p) });
  const settled = await Promise.allSettled(broken);
  assert.ok(settled.every((s) => s.status === "fulfilled"), "a failed snapshot is logged, not thrown");
  const bare = makeEnv({ noStore: true });
  const pend2 = [];
  await w.scheduled({}, bare.env, { waitUntil: (p) => pend2.push(p) });
  assert.ok((await Promise.allSettled(pend2)).every((s) => s.status === "fulfilled"), "a missing table before the migration is applied does not stop the cron");
}

// 6. search_memories: the default order is the vector order; rank=weighted adds an age decay and an outcome factor
{
  const { env, graph, audit, setMatches } = makeEnv();
  const day = (n) => new Date(Date.now() - n * 864e5).toISOString();
  const put = (id, category, createdAt, meta) => graph.prepare("INSERT INTO agent_memories (id, category, content, created_at, metadata_json) VALUES (?, ?, ?, ?, ?)").run(id, category, "content of " + id, createdAt, meta);
  put("mem:heuristic:1:11111111", "heuristic", day(1), JSON.stringify({ tier: "episodic", role: "agent" }));
  put("mem:heuristic:2:22222222", "heuristic", day(1), JSON.stringify({ tier: "episodic", role: "user" }));
  put("mem:heuristic:3:33333333", "heuristic", day(400), null);
  put("mem:heuristic:4:44444444", "heuristic", day(1), JSON.stringify({ tier: "semantic", role: "consolidation" }));
  setMatches([
    { id: "mem:heuristic:1:11111111", score: 0.90 },
    { id: "paper:ignored", score: 0.89 },
    { id: "mem:heuristic:2:22222222", score: 0.89 },
    { id: "mem:heuristic:3:33333333", score: 0.89 },
    { id: "mem:heuristic:4:44444444", score: 0.88 }
  ]);
  const plain = (await call(env, "search_memories", { query: "q", limit: 4 })).out;
  assert.equal(plain.rank, undefined, "the default reply keeps its old shape");
  assert.deepEqual(plain.results.map((r) => r.id.slice(-8)), ["11111111", "22222222", "33333333", "44444444"], "the default keeps the vector order");
  assert.deepEqual(plain.results.map((r) => r.tier), ["episodic", "episodic", "episodic", "semantic"], "a row with no tier is read as episodic");
  assert.deepEqual(plain.results.map((r) => r.role), ["agent", "user", null, "consolidation"]);
  assert.equal(plain.results[0].rank_score, undefined, "similarity results carry no rank fields");
  // no outcomes yet: weighted differs from similarity only through the age factor
  const w0 = (await call(env, "search_memories", { query: "q", limit: 4, rank: "weighted" })).out;
  assert.equal(w0.rank, "weighted");
  assert.equal(w0.results[0].id.slice(-8), "11111111");
  assert.ok(w0.results[3].id.slice(-8) === "33333333" || w0.results[2].id.slice(-8) === "33333333", "the 400 day old memory loses ground");
  assert.ok(w0.results.every((r) => typeof r.rank_score === "number" && r.outcomes.success === 0 && r.outcomes.failure === 0));
  const oc = audit.prepare("INSERT INTO memory_outcomes (memory_id, outcome, feedback_id, ts) VALUES (?, ?, ?, ?)");
  for (let i = 0; i < 6; i++) oc.run("mem:heuristic:2:22222222", "success", "s" + i, day(1));
  for (let i = 0; i < 6; i++) oc.run("mem:heuristic:1:11111111", "failure", "f" + i, day(1));
  const w1 = (await call(env, "search_memories", { query: "q", limit: 4, rank: "weighted" })).out;
  assert.equal(w1.results[0].id.slice(-8), "22222222", "six successes lift a memory above a slightly more similar one with six failures");
  assert.equal(w1.results[0].outcomes.success, 6);
  const failing = w1.results.find((r) => r.id.slice(-8) === "11111111");
  assert.equal(failing.outcomes.failure, 6);
  assert.ok(failing.rank_score < failing.score, "failures lower the score");
  // the factors are mild: relevance still dominates a large similarity gap
  setMatches([{ id: "mem:heuristic:3:33333333", score: 0.95 }, { id: "mem:heuristic:2:22222222", score: 0.6 }]);
  const w2 = (await call(env, "search_memories", { query: "q", limit: 2, rank: "weighted" })).out;
  assert.equal(w2.results[0].id.slice(-8), "33333333");
  // weighted without the outcome store still works
  const bare = makeEnv({ noAudit: true });
  bare.graph.prepare("INSERT INTO agent_memories (id, category, content, created_at) VALUES ('mem:heuristic:9:99999999', 'heuristic', 'c', ?)").run(day(2));
  bare.setMatches([{ id: "mem:heuristic:9:99999999", score: 0.7 }]);
  const w3 = (await call(bare.env, "search_memories", { query: "q", rank: "weighted" })).out;
  assert.equal(w3.count, 1);
  // an unknown rank value falls back to similarity
  assert.equal((await call(env, "search_memories", { query: "q", rank: "nonsense" })).out.rank, undefined);
}

console.log("memory-tiering: all assertions passed");
