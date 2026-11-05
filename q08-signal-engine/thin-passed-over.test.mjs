// Q08-THIN-PASSED-OVER-1 (0.37.5, agent_issues 100439 and 100607): a candidate measured thin and passed over for a richer one is marked for the
// 24-hour retry like any measured-thin candidate, so a paper whose arxiv.org/html page answers 404 no longer holds the arXiv lane. Drives generate()
// over an in-memory q08-signal D1 with stubbed HN, GitHub, arXiv and article fetches; the model is offline, so each run ends at the compose call.
// Output MUST contain "0 failed".   node q08-signal-engine/thin-passed-over.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const mod = await import("./worker.js");
const G = mod.__gen;
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " -- " + JSON.stringify(x).slice(0, 400) : "")); } };

// ---- 1. the pure helper
const A = { id: "a" }, B = { id: "b" }, C = { id: "c" }, D = { id: "d" };
const ev = [{ cand: A, glen: 1500 }, { cand: B, glen: 1900 }, { cand: C, glen: 15000 }];
ok(typeof G.thinPassedOver === "function", "thinPassedOver is exported for the suite");
ok(G.thinPassedOver(ev, C).map((x) => x.cand.id).join() === "a,b", "the thin candidates ahead of the chosen one are returned, the chosen one is not", G.thinPassedOver(ev, C));
ok(G.thinPassedOver([{ cand: C, glen: 15000 }], C).length === 0 && G.thinPassedOver([], C).length === 0 && G.thinPassedOver(undefined, C).length === 0, "nothing passed over: nothing to mark");
ok(G.thinPassedOver([{ cand: A, glen: 1500 }, { cand: B, glen: 900 }], B).map((x) => x.cand.id).join() === "a", "a thin candidate chosen by the richest-thin rule is not marked, the others are");
ok(G.thinPassedOver([{ cand: A, glen: G.MIN_GROUND_CHARS }, { cand: D, glen: 100 }], C).map((x) => x.cand.id).join() === "d", "a candidate at the rich-source floor is never marked thin");
ok(G.thinPassedOver([null, { cand: null, glen: 10 }, { cand: A, glen: NaN }, { cand: B, glen: 100 }], C).map((x) => x.cand.id).join() === "b", "malformed entries are ignored");

// ---- 2. generate(): the arXiv lane advances past a paper with no HTML rendering
function makeDb() {
  G.resetRunColumns();
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE engine_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, ran_at TEXT DEFAULT (datetime('now')), signals_scraped INTEGER DEFAULT 0, signals_scored INTEGER DEFAULT 0, piece_published INTEGER DEFAULT 0, top_signal TEXT, model TEXT, ms INTEGER DEFAULT 0, status TEXT, error TEXT)");
  db.exec("CREATE TABLE published_pieces (id TEXT PRIMARY KEY, signal_id TEXT, slug TEXT UNIQUE, title TEXT, body_md TEXT, body_html TEXT, core_concept TEXT, signal_source TEXT, published_at TEXT, reads INTEGER DEFAULT 0, feedback_score REAL DEFAULT 0, promoted INTEGER DEFAULT 0, sources_json TEXT, kind TEXT DEFAULT 'analysis', property TEXT)");
  db.exec("CREATE TABLE signal_log (id TEXT PRIMARY KEY, source TEXT NOT NULL, source_id TEXT, title TEXT, url TEXT, points INTEGER DEFAULT 0, num_comments INTEGER DEFAULT 0, ratio REAL DEFAULT 0, volatility_score REAL DEFAULT 0, friction_point TEXT, signal_strength TEXT, status TEXT DEFAULT 'pending', created_at TEXT DEFAULT (datetime('now')), processed_at TEXT)");
  db.exec("CREATE TABLE q08_retractions (slug TEXT PRIMARY KEY, reason TEXT, claims_json TEXT, retracted_at TEXT)");
  db.exec("CREATE TABLE prompt_pool (id TEXT PRIMARY KEY, piece_id TEXT, structure_md TEXT NOT NULL, performance_score REAL DEFAULT 0, reads INTEGER DEFAULT 0, active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')))");
  const shim = { prepare: (sql) => { let a = []; const st = { bind: (...x) => { a = x; return st; }, run: async () => { db.prepare(sql).run(...a); return { meta: {} }; }, first: async () => db.prepare(sql).get(...a) || null, all: async () => ({ results: db.prepare(sql).all(...a) }) }; return st; } };
  return { db, shim };
}
const P1 = { id: "2610.90001v1", title: "Quiet leakage in a routing protocol", abs: "A security and privacy study of a network protocol: the architecture, the verification of the protocol, and the reliability of the infrastructure. " },
  P2 = { id: "2610.90002v1", title: "Verifying a consensus protocol under faults", abs: "We study consensus and fault tolerance in a distributed system with formal verification of the protocol. " },
  P3 = { id: "2610.90003v1", title: "A compiler for a small database language", abs: "A compiler and a programming language for a database. " };
const H1 = { id: 8101, title: "Operators describe a regional outage" };
const realFetch = globalThis.fetch;
function stubFetch() {
  const feed = "<feed>" + [P1, P2, P3].map((p) => "<entry><id>http://arxiv.org/abs/" + p.id + "</id><title>" + p.title + "</title><summary>" + p.abs + "</summary></entry>").join("") + "</feed>";
  globalThis.fetch = async (url) => {
    const u = String(url), res = (body, type) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200, headers: { "content-type": type || "application/json" } });
    if (u.includes("hn.algolia.com/api/v1/search")) return res({ hits: [{ _tags: ["story"], title: H1.title, objectID: H1.id, story_id: H1.id, url: "https://example.org/" + H1.id, points: 300, num_comments: 120, created_at: new Date().toISOString() }] });
    if (u.includes("hn.algolia.com/api/v1/items/")) return res({ title: H1.title, children: [1, 2, 3].map((k) => ({ text: "<p>" + ("Comment " + k + " about how the system behaved under load. ").repeat(8) + "</p>", children: [] })) });
    if (u.startsWith("https://example.org/")) return res("<html><body><p>" + "The service reported a fault and the operators described it in detail. ".repeat(130).slice(0, 9000) + "</p></body></html>", "text/html");
    if (u.includes("export.arxiv.org/api/query")) return res(feed, "application/atom+xml");
    if (u.startsWith("https://arxiv.org/html/" + P1.id)) return new Response("not found", { status: 404 }); // no HTML rendering for the first paper
    if (u.startsWith("https://arxiv.org/html/")) return res("<html><body><p>" + "The protocol keeps every replica in step by numbering each request and checking the numbers on receipt. ".repeat(120).slice(0, 9000) + "</p></body></html>", "text/html");
    return new Response("nope", { status: 500 }); // GitHub, Wikipedia and everything else
  };
}
async function tick(env) {
  const prompts = [];
  env.AI = { run: async (m, a) => { prompts.push(((a && a.messages) || []).map((x) => x.content).join("\n")); throw new Error("model offline (test)"); } };
  const quiet = console.error; console.error = () => {};
  let thrown = null; try { await G.generate(env); } catch (e) { thrown = String(e && e.message || e); }
  console.error = quiet;
  return { prompts, thrown };
}
try {
  stubFetch();
  const { db, shim } = makeDb();
  db.prepare("INSERT INTO engine_runs (status, top_signal, piece_published) VALUES ('gate_failed', 'hn:The story before', 0)").run(); // the last run was a story, so the lane that takes the turn is arXiv
  const env = { DB: shim };

  const t1 = await tick(env);
  ok(/all compose models failed/.test(String(t1.thrown)) && t1.prompts.length >= 1, "tick 1 reaches the writer (the model is offline)", t1.thrown);
  ok(t1.prompts[0].includes(H1.title) && !t1.prompts[0].includes(P2.title), "tick 1: the first paper has no HTML rendering, so the turn falls through to the story", t1.prompts[0].slice(0, 200));
  const marks1 = db.prepare("SELECT source_id, status FROM signal_log WHERE status = 'thin_skipped'").all();
  ok(marks1.length === 1 && marks1[0].source_id === "arxiv:" + P1.id, "tick 1: the paper that was passed over is marked for the 24-hour retry", marks1);
  ok(db.prepare("SELECT COUNT(*) n FROM signal_log WHERE source_id = ?").get("hn:" + H1.id).n === 0, "tick 1: the chosen story is not marked (it is written about)");

  const t2 = await tick(env);
  ok(/all compose models failed/.test(String(t2.thrown)) && t2.prompts.length >= 1, "tick 2 reaches the writer", t2.thrown);
  ok(t2.prompts[0].includes(P2.title) && !t2.prompts[0].includes(H1.title), "tick 2: the lane moves on to the next paper, which has a rendering", t2.prompts[0].slice(0, 200));
  ok(db.prepare("SELECT COUNT(*) n FROM signal_log WHERE status = 'thin_skipped'").get().n === 1, "tick 2: nothing is marked again while the retry window is open");
} finally { globalThis.fetch = realFetch; }

// ---- 3. wiring in the source
const gen = src.slice(src.indexOf("async function generate(env) {"), src.indexOf("// Q08-FORECAST-1 (v0.9.0"));
ok(/var passedOver = thinPassedOver\(evaluated, story, groundBar\);\s*\n\s*if \(passedOver\.length\) await markThinSkipped\(env, passedOver\);/.test(gen), "generate() marks the passed-over candidates once a story is chosen");
ok(gen.indexOf("var passedOver = thinPassedOver(") > gen.indexOf("no candidate yielded sufficient friction"), "the call sits after the no-story exits, so a run with no story still marks all its measured candidates exactly as before");
ok(/await markThinSkipped\(env, evaluated\);/.test(gen), "the existing mark-all branch for a run with no usable story is unchanged");

console.log("thin-passed-over.test.mjs: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
