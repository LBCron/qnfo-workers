// ASK-LOOP-1 offline suite (qnfo-ai-search 2.x). No network: AI Search, the gateway (papers + graph), idea-hub and
// Workers AI are stubbed; D1 is an in-memory node:sqlite database with the production schemas the worker touches.
// Run: node qnfo-ai-search/ask-loop.test.mjs   (Node 22; node:sqlite)
import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
let failed = 0, passed = 0;
function ok(c, m) { if (c) { passed++; } else { failed++; console.log("FAIL " + m); } }

// ---- D1 over node:sqlite (numbered ?N params, reused)
const sq = new DatabaseSync(":memory:");
sq.exec(`
CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, layer TEXT NOT NULL, kind TEXT NOT NULL, formula TEXT, source_of_truth TEXT, baseline TEXT, target TEXT, owner TEXT, disposition_actor TEXT, refresh_cadence TEXT, warning_band TEXT, kill_band TEXT, last_value TEXT, last_refreshed TEXT, state TEXT, refresh_class TEXT);
CREATE TABLE pipeline_flags (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT);
CREATE TABLE fleet_heartbeat (worker TEXT PRIMARY KEY, version TEXT, ts TEXT, ok INTEGER);
CREATE TABLE experiments (id TEXT PRIMARY KEY, name TEXT, hypothesis TEXT, kind TEXT, treatment TEXT, control TEXT, outcome_metric TEXT, baseline_date TEXT, status TEXT, owner TEXT, created_at TEXT);
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT DEFAULT 'open', linked_session TEXT, created_at INTEGER, updated_at INTEGER, close_channel TEXT);
CREATE TABLE issue_triage (issue_id INTEGER PRIMARY KEY, rc TEXT NOT NULL, triage_state TEXT NOT NULL DEFAULT 'triaged', owner TEXT NOT NULL, sla_due_at TEXT NOT NULL, triaged_at TEXT, remediation TEXT, close_evidence TEXT, reopened_count INTEGER NOT NULL DEFAULT 0);
CREATE TABLE human_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE, title TEXT NOT NULL, why TEXT, default_in_effect TEXT, action TEXT, url TEXT, sev TEXT, due TEXT, status TEXT DEFAULT 'open', source TEXT, created_at TEXT, updated_at TEXT, resolved_at TEXT, resolution TEXT);
CREATE TABLE fleet_budget (node_class TEXT PRIMARY KEY, cap REAL, target REAL, current REAL, unit TEXT, updated_at TEXT);
INSERT INTO fleet_budget (node_class, cap, current) VALUES ('ai_spend:total', 150, 10), ('workers', 30, 44);
CREATE TABLE ai_spend_ledger (day TEXT NOT NULL, provider TEXT NOT NULL, caller TEXT NOT NULL, model TEXT NOT NULL, calls INTEGER DEFAULT 0, in_tok INTEGER DEFAULT 0, out_tok INTEGER DEFAULT 0, usd REAL DEFAULT 0, downgraded INTEGER DEFAULT 0, refused INTEGER DEFAULT 0, PRIMARY KEY (day, provider, caller, model));`);
function stmt(sql0) {
  const order = [];
  const sql = sql0.replace(/\?(\d+)/g, (m, n) => { order.push(Number(n) - 1); return "?"; });
  let args = [];
  const s = {
    bind(...a) { a = a.map((v) => (v === undefined ? null : typeof v === "boolean" ? Number(v) : v)); args = order.length ? order.map((i) => a[i]) : a; return s; },
    async first() { const p = sq.prepare(sql); if (/^\s*(SELECT|WITH)|RETURNING/i.test(sql)) return p.get(...args) ?? null; p.run(...args); return null; },
    async all() { const p = sq.prepare(sql); return { results: /^\s*(SELECT|WITH)/i.test(sql) ? p.all(...args) : (p.run(...args), []) }; },
    async run() { const p = sq.prepare(sql); if (/RETURNING/i.test(sql)) return { results: p.all(...args), meta: { changes: 1 } }; const r = p.run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
  };
  return s;
}
const D1 = { prepare: stmt, async batch(list) { for (const s of list) await s.run(); return []; } };

// ---- stubs
const PAPERS = [
  { slug: "jpcub-llm-energy", title: "JPCUB for LLM Energy", doi: "10.1234/qnfo.1", abstract: "Joules per correct answer as an energy benchmark for language models, normalized by accuracy. ".repeat(4), created_at: "2026-10-01 10:00:00" },
  { slug: "adelic-quantum-statistics", title: "Quantum Statistics from the Adelic Product Formula", doi: "10.1234/qnfo.2", abstract: "Squarefree origin of quantum statistics from the adelic product formula across all places. ".repeat(4), created_at: "2026-09-30 10:00:00" },
];
const graph = { "paper:jpcub-llm-energy": { node: { id: "paper:jpcub-llm-energy", name: "JPCUB for LLM Energy", label: "Paper" }, neighbors: [{ id: "concept-energy-metric", name: "Energy metric", label: "Concept", relationshipType: "INTRODUCES", direction: "outgoing" }, { id: "infra-worker-x", name: "worker x", label: "CloudflareAsset", relationshipType: "SERVES", direction: "outgoing" }] } };
async function gatewayFetch(u) {
  const url = new URL(typeof u === "string" ? u : u.url);
  const J = (o, st) => new Response(JSON.stringify(o), { status: st || 200, headers: { "content-type": "application/json" } });
  if (url.host === "papers.qnfo.org" && url.pathname === "/papers") {
    const q = (url.searchParams.get("search") || "").toLowerCase();
    const list = q ? PAPERS.filter((p) => (p.title + p.abstract).toLowerCase().includes(q)) : PAPERS;
    return J({ papers: list.slice(0, Number(url.searchParams.get("limit") || 50)), total: 449 });
  }
  if (url.host === "papers.qnfo.org" && url.pathname.startsWith("/papers/")) { const p = PAPERS.find((x) => x.slug === url.pathname.slice(8)); return p ? J(p) : J({ error: "nf" }, 404); }
  if (url.host === "graph-api.qnfo.org" && url.pathname === "/stats") return J({ totalNodes: 8349, totalEdges: 8525, relationshipTypes: ["A"] });
  if (url.host === "graph-api.qnfo.org" && url.pathname.startsWith("/neighbors/")) { const g = graph[url.pathname.slice(11)]; return g ? J(g) : J({ error: "nf" }, 404); }
  if (url.host === "graph-api.qnfo.org" && url.pathname === "/nodes") return J({ nodes: url.searchParams.get("label") === "ResearchQuestion" ? [{ id: "rq-1", name: "RQ-001: Does the adelic framework constrain new physics?", label: "ResearchQuestion", properties: { status: "open" } }, { id: "rq-ops", name: "How can the Vectorize pipeline be unblocked?", label: "ResearchQuestion", properties: {} }] : [] });
  return J({ error: "unexpected " + url }, 404);
}
const ideasFetch = async () => new Response(JSON.stringify({ sessions: [{ id: "t-1", title: "Energy per correct answer: what does JPCUB measure in LLM benchmarks?", message_count: 2, updated_at: "2026-10-01T00:00:00Z" }] }), { headers: { "content-type": "application/json" } });
const uploads = [];
const searchRequests = [];
const AI_SEARCH = { get() { return { items: { async upload(key, text, opts) { uploads.push({ key, bytes: text.length, meta: opts && opts.metadata }); return { key }; } }, async search(request) { searchRequests.push(request); return { chunks: [{ score: 0.7, text: "# JPCUB for LLM Energy\n\nJPCUB is joules per correct answer.", item: { key: "jpcub-llm-energy.md" } }, { score: 0.65, text: "audit row", item: { key: "audit-test-002.md" } }] }; } }; }, async list() { return ["qnfo-corpus"]; } };
const models = [];
const AI = {
  async run(model, input) {
    models.push(model);
    const sys = input.messages[0].content;
    if (/You check whether an answer is supported/.test(sys)) return { response: '{"supported": 3, "total": 4}' };
    if (/Write ONE question/.test(sys)) return { response: "Which energy benchmark divides joules by correct answers?" };
    const enc = new TextEncoder();
    const text = "JPCUB measures the energy a system spends per correct answer, in joules, so accuracy and energy are reported together [1]. Bad cite [7].\n\nFOLLOWUPS:\n- How is accuracy measured?\n- What hardware was used?\n- How does it compare to FLOPs?";
    return new ReadableStream({ start(c) { for (const p of text.match(/[\s\S]{1,16}/g)) c.enqueue(enc.encode("data: " + JSON.stringify({ response: p }) + "\n\n")); c.enqueue(enc.encode("data: [DONE]\n\n")); c.close(); } });
  },
};
const store = new Map();
globalThis.caches = { default: { async match(r) { const x = store.get(r.url); return x ? x.clone() : undefined; }, async put(r, res) { store.set(r.url, res.clone()); } } };
const env = { AI, AI_SEARCH, QNFO_AUDIT: D1, GATEWAY: { fetch: gatewayFetch }, IDEAS: { fetch: ideasFetch }, SPEND_CAP_TOTAL_USD: "60" };

const dir = mkdtempSync(join(tmpdir(), "askloop-"));
writeFileSync(join(dir, "w.mjs"), readFileSync(join(here, "worker.js"), "utf8"));
const { default: worker } = await import(pathToFileURL(join(dir, "w.mjs")).href);
const waits = [];
const ctx = { waitUntil: (p) => waits.push(p) };
async function call(path, body, ip) {
  const r = await worker.fetch(new Request("https://ask.qwav.tech" + path, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", "CF-Connecting-IP": ip || "9.9.9.9" }, body: body ? JSON.stringify(body) : undefined }), env, ctx);
  const t = await r.text();
  await Promise.allSettled(waits.splice(0));
  return { status: r.status, text: t, json: () => JSON.parse(t) };
}
const sse = (t, ev) => t.split("\n\n").filter((b) => b.startsWith("event: " + ev)).map((b) => JSON.parse(b.split("data: ")[1]));

// 1. existing contract
const h = (await call("/health")).json();
ok(/^2\./.test(h.version) && h.capabilities.includes("ai-search-query") && h.limitations.length >= 4, "health keeps the 1.x capabilities and states limitations");
ok((await call("/")).text.includes("Ask the QNFO research corpus"), "GET / serves the ask page");
// FLEET-CTL-ROLLOUT-1.6 (#1775) and ASK-GRAPH-ELLIPSIS-1 (#1769), as the browser receives the page.
const page = (await call("/")).text;
ok(page.split('<script src="https://fleet.qnfo.org/ctl.js" defer></script>').length === 2 && /<script src="https:\/\/fleet\.qnfo\.org\/ctl\.js" defer><\/script>\s*<\/body>/.test(page), "the ask page loads the fleet command-line link once, just before </body>");
const label = (page.split("\n").find((l) => l.includes("d.name.length > 26")) || "");
ok(label.includes('d.name.slice(0, 24) + "..."') && !label.includes("…"), "graph labels are truncated with ASCII dots, not U+2026 (no glyph in the label font)");
ok((await call("/?q=%3Cscript%3E")).text.includes("&lt;script&gt; | Ask QWAV"), "deep-link title is escaped");
// 2. one answer end to end
await D1.prepare("INSERT INTO pipeline_flags (key, value, updated_at) VALUES ('ask_config', ?1, ?2)").bind(JSON.stringify({ champion: { id: "c0", rerank: false } }), "2026-10-01T00:00:00Z").run();
const a1 = await call("/api/ask", { query: "What does JPCUB measure?" });
const meta = sse(a1.text, "meta")[0], done = sse(a1.text, "done")[0];
const searchOptions = searchRequests[0] && searchRequests[0].ai_search_options;
ok(searchOptions && searchOptions.retrieval.retrieval_type === "hybrid" && searchOptions.retrieval.fusion_method === "rrf", "Ask forces hybrid reciprocal-rank fusion");
ok(searchOptions && searchOptions.reranking.enabled === true && searchOptions.reranking.model === "@cf/baai/bge-reranker-base", "Ask forces cross-encoder reranking even with a persisted rerank=false config");
ok(meta && meta.sources.length >= 1 && meta.sources.every((s) => !/audit-test/.test(s.slug)), "sources exclude corpus test files");
ok(meta.sources[0].url === "https://papers.qnfo.org/papers/jpcub-llm-energy" && !("excerpt" in meta.sources[0]), "sources link papers and do not ship raw excerpts");
ok(meta.graph.nodes.every((n) => n.label !== "CloudflareAsset") && meta.graph.nodes.some((n) => n.cite === 1), "graph drops ops labels and tags cited papers");
ok(meta.threads.length === 1, "related idea thread linked");
ok(done && /^a_/.test(done.id) && done.followups.length === 3, "done carries the answer id and three follow-ups");
const ev = sq.prepare("SELECT * FROM ask_events").get();
ok(ev.cites === 2 && ev.cites_invalid === 1 && ev.sources >= 1 && ev.usd > 0, "event records citations (1 of 2 invalid), sources and priced cost");
ok(sq.prepare("SELECT SUM(usd) u FROM ai_spend_ledger WHERE caller='qnfo-ai-search'").get().u > 0, "spend lands in ai_spend_ledger under caller qnfo-ai-search");
ok(/"cached":true/.test((await call("/api/ask", { query: "What does JPCUB measure?" })).text), "repeat question served from cache");
// 2b. PAPER-PIN-1 (2.1.0): papers.qnfo.org asks about the paper a visitor is reading
const ap = await call("/api/ask", { query: "What does it establish about statistics?", paper: "adelic-quantum-statistics" });
const mp = sse(ap.text, "meta")[0];
ok(mp && mp.sources[0].slug === "adelic-quantum-statistics" && mp.sources[0].n === 1 && mp.sources.filter((s) => s.slug === "adelic-quantum-statistics").length === 1, "the read paper is pinned as source [1], once");
ok(/^\[paper:adelic-quantum-statistics\] /.test(sq.prepare("SELECT query FROM ask_events ORDER BY rowid DESC LIMIT 1").get().query), "a pinned ask is labelled in ask_events");
const ap2 = await call("/api/ask", { query: "What does it establish about statistics?" });
ok(!/"cached":true/.test(ap2.text), "the pinned answer is cached apart from the unpinned one");
const bad = await call("/api/ask", { query: "What does JPCUB measure here?", paper: "../etc/passwd" });
ok(sse(bad.text, "meta")[0].sources.every((s) => !s.pinned), "an invalid paper slug is ignored");
// 3. feedback
ok((await call("/api/feedback", { id: done.id, helpful: 1 })).status === 200, "feedback accepted");
await call("/api/feedback", { id: done.id, helpful: 0 });
ok(sq.prepare("SELECT helpful FROM ask_feedback").get().helpful === 1, "one rating per answer");
ok((await call("/api/feedback", { id: "a_nope", helpful: 1 })).status === 404 && (await call("/api/feedback", { id: done.id, helpful: 5 })).status === 400, "unknown id and bad value refused");
// 4. caps: 12 per hashed address per hour, then sources-only
let limited = null;
for (let i = 0; i < 13; i++) { const r = await call("/api/ask", { query: "question number " + i + " about adelic statistics" }, "7.7.7.7"); const e = sse(r.text, "error")[0]; if (e) limited = e.error; }
ok(limited && /12 questions this hour/.test(limited) && sse((await call("/api/ask", { query: "one more adelic question" }, "7.7.7.7")).text, "meta").length === 1, "over the per-address cap: sources-only with a clear note");
// 5. the 03:41 tick: measure, golden, judge, tune, fix, housekeeping
sq.exec("UPDATE ask_events SET judge=2, answer='x [1]', context='[1] y'");
await worker.scheduled({ scheduledTime: Date.UTC(2026, 9, 3, 3, 41) }, env, ctx);
await Promise.allSettled(waits.splice(0));
const runs = sq.prepare("SELECT kind, ok, note FROM ask_loop_runs").all();
ok(runs.length === 9 && runs.every((r) => r.ok === 1), "all nine steps of the daily tick ran (2.2.8 adds corpus-sync): " + runs.map((r) => r.kind + ":" + r.ok).join(","));
ok(sq.prepare("SELECT COUNT(*) n FROM metric_registry WHERE owner='qnfo-ai-search'").get().n === 9, "nine ask_* metrics registered with bands (ASK-PLAIN-1 added ask_plain_share_7d)");
ok(sq.prepare("SELECT last_value v FROM metric_registry WHERE metric='ask_grounded_share_7d'").get().v === "0.75", "grounding judge feeds ask_grounded_share_7d");
ok(sq.prepare("SELECT COUNT(*) n FROM ask_golden").get().n >= 1, "golden set grows from new papers");
ok(uploads.length === 2 && uploads.every((u) => /\.md$/.test(u.key) && u.meta && u.meta.source === "papers.qnfo.org") && sq.prepare("SELECT COUNT(*) n FROM ask_corpus_sync WHERE status = 'uploaded'").get().n === 2, "with the ai_spend caps clear the corpus feeder uploads the published papers and records them (ASK-CORPUS-FEEDER-1)", uploads);
ok(sq.prepare("SELECT status FROM experiments WHERE id LIKE 'ASK-TUNE-G-%'").get().status === "running", "a generation A/B is registered in experiments");
const cfg = JSON.parse(sq.prepare("SELECT value FROM pipeline_flags WHERE key='ask_config'").get().value);
ok(cfg.challenger && cfg.challenger.change && cfg.champion.model, "challenger armed beside the champion (" + (cfg.challenger && cfg.challenger.change) + ")");
ok(cfg.champion.rerank === true && cfg.challenger.rerank === true, "legacy disabled-rerank configs are normalized for the fixed baseline");
// 6. ASK-FIX-1: kill band on two consecutive days -> one code-task issue; recovery closes it with evidence
sq.exec("UPDATE ask_events SET cites=10, cites_invalid=6");
sq.prepare("INSERT INTO ask_loop_runs (ts, version, kind, ok, note) VALUES (?, 't', 'measure', 1, ?)").run(new Date(Date.UTC(2026, 9, 4, 3, 41) - 24 * 36e5 + 6e4).toISOString(), JSON.stringify({ written: ["ask_citation_validity_7d=0.4"] }));
const realNow = Date.now;
Date.now = () => Date.UTC(2026, 9, 4, 3, 45);
await worker.scheduled({ scheduledTime: Date.UTC(2026, 9, 4, 3, 41) }, env, ctx);
await Promise.allSettled(waits.splice(0));
const iss = sq.prepare("SELECT * FROM agent_issues").all();
ok(iss.length === 1 && /code-task: repo=qnfo-workers path=qnfo-ai-search\/worker\.js/.test(iss[0].description), "kill band twice: one issue with a code-task line");
const anchor = (iss[0] && iss[0].description.match(/code-anchor: (.+)$/m) || [])[1] || "";
ok(anchor && readFileSync(join(here, "worker.js"), "utf8").split(anchor).length === 2, "its code-anchor occurs exactly once in worker.js (patch mode)");
await worker.scheduled({ scheduledTime: Date.UTC(2026, 9, 4, 3, 41) }, env, ctx);
await Promise.allSettled(waits.splice(0));
ok(sq.prepare("SELECT COUNT(*) n FROM agent_issues").get().n === 1, "no duplicate issue while one is open");
sq.exec("UPDATE ask_events SET cites=10, cites_invalid=0");
await worker.scheduled({ scheduledTime: Date.UTC(2026, 9, 5, 3, 41) }, env, ctx);
await Promise.allSettled(waits.splice(0));
const closed = sq.prepare("SELECT a.status, t.close_evidence e FROM agent_issues a JOIN issue_triage t ON t.issue_id = a.id").get();
ok(closed && closed.status === "closed" && /back inside its warning band/.test(closed.e), "recovery closes the issue with live evidence");
Date.now = realNow;
// 7. public loop report
const lp = (await call("/api/loop")).json();
ok(lp.metrics.length === 9 && lp.runs.length > 0 && lp.config.champion, "GET /api/loop reports metrics, runs and config");
ok(models.includes("@cf/deepseek-ai/deepseek-v4-flash-0731"), "the judge is a different model from the writer");

// 7. ASK-JUDGE-1: a judge that cannot judge says why in ask_loop_runs instead of reporting a bare judged:0
{
  const real = AI.run;
  sq.exec("UPDATE ask_events SET judged_total=NULL, judged_supported=NULL, judge=2, answer='x [1]', context='[1] y' WHERE id IN (SELECT id FROM ask_events LIMIT 2)");
  AI.run = async (m, o) => { if (/deepseek|glm/.test(m) && /supported by its numbered excerpts/.test(JSON.stringify(o.messages || ""))) return { response: "<think>reasoning that never reaches an answer</think>" + "so ".repeat(80) }; return real(m, o); };
  await worker.scheduled({ scheduledTime: Date.UTC(2026, 9, 4, 3, 41) }, env, ctx);
  await Promise.allSettled(waits.splice(0));
  let jr = JSON.parse(sq.prepare("SELECT note FROM ask_loop_runs WHERE kind='judge' ORDER BY id DESC LIMIT 1").get().note);
  ok(jr.judged === 0 && jr.failed && jr.failed.no_json === 2 && /so so/.test(jr.failed.head || ""), "an unparseable judge reply is counted and its head is kept: " + JSON.stringify(jr));
  AI.run = async (m, o) => { if (/deepseek|glm/.test(m) && /supported by its numbered excerpts/.test(JSON.stringify(o.messages || ""))) throw new Error("model unavailable: 5007"); return real(m, o); };
  await worker.scheduled({ scheduledTime: Date.UTC(2026, 9, 5, 3, 41) }, env, ctx);
  await Promise.allSettled(waits.splice(0));
  jr = JSON.parse(sq.prepare("SELECT note FROM ask_loop_runs WHERE kind='judge' ORDER BY id DESC LIMIT 1").get().note);
  ok(jr.failed && jr.failed.errors === 2 && /5007/.test(jr.failed.last_error), "a judge error is counted and named: " + JSON.stringify(jr));
  AI.run = real;
  let sawTokens = null;
  AI.run = async (m, o) => { if (/deepseek/.test(m)) sawTokens = o.max_tokens; return real(m, o); };
  await worker.scheduled({ scheduledTime: Date.UTC(2026, 9, 6, 3, 41) }, env, ctx);
  await Promise.allSettled(waits.splice(0));
  ok(sawTokens === 3000, "the judge gets a 3000-token budget for a reasoning model (" + sawTokens + ")");
  AI.run = real;
}

// 8. ASK-RETRIEVAL-DEFINITIONS-1 (#1813): a question naming one of the program's terms gets its defining paper first, with
// the section that answers it (level-1 headings, stem match), and the retrieval eval records the defined papers' ranks.
{
  PAPERS.push({ slug: "joules-per-solution-metric", title: "The Joules-per-Solution Metric: Definition, Measurement Protocol, and Anti-Gaming Provisions", doi: "10.1234/qnfo.21637028", abstract: "We define the joules-per-solution (J/S) metric as a universal, cross-domain measure of computational energy efficiency. ".repeat(3), body_md: "# The Joules-per-Solution Metric\n\n**Series:** Joules-per-Compute Universal Benchmark (JPCUB) - Paper P0\n\n## 3. The Joules-per-Solution Metric\n\nJ/S is the total system energy spent per correct solution, measured at the wall.\n\n## References\n\nnone", created_at: "2026-07-27 10:00:00" });
  PAPERS.push({ slug: "distinction-lattice-framework", title: "Distinction-Lattice Framework: Eigenforms, Bisimulation, and the Realizability Boundary", doi: "10.1234/qnfo.23076161", abstract: "A conservative formal version of DLF: stable entities are bisimulation classes of observational behaviour, certified coinductively. ".repeat(3), body_md: "# 1. Scope and Status\n\nThis document states one conjecture with explicit conditions and is deliberately conservative about everything else it says here.\n\n# 6. The Central Separation\n\nFalsification conditions (any one of these refutes the conjecture): 1. exhibit a realizability filter whose fixed points are not bisimulation classes; 2. a stable entity with no final coalgebra; 3. a notation that names itself without leaving R.\n\n# 9. References\n\nnone", created_at: "2026-10-01 10:00:00" });
  const real = AI.run;
  let seen = null;
  AI.run = async (m, o) => { if (o && o.stream) seen = o.messages[o.messages.length - 1].content; return real(m, o); };
  const r1 = await call("/api/ask", { query: "So what does JPCUB measure, exactly?" });
  const m1 = sse(r1.text, "meta")[0];
  ok(m1 && m1.sources[0].slug === "joules-per-solution-metric" && m1.sources[0].defines === "jpcub" && m1.sources.filter((s) => s.slug === "joules-per-solution-metric").length === 1, "a question naming JPCUB gets the J/S metric paper as source [1], once, marked as defining the term");
  ok(/\[1\] The Joules-per-Solution Metric[^\n]*\[defines the term 'jpcub'\]/.test(seen || "") && /J\/S is the total system energy spent per correct solution/.test(seen || ""), "the model is told [1] defines the term and gets the defining section");
  await call("/api/ask", { query: "What would falsify the distinction-lattice framework?" });
  ok(/^\[1\] Distinction-Lattice Framework/m.test(seen || "") && /Falsification conditions \(any one of these refutes the conjecture\)/.test(seen || ""), "'falsify' finds the falsification conditions under a level-1 heading");
  ok(!/strongest open problem/i.test(seen || "") && /never add a generic one/.test(readFileSync(join(here, "worker.js"), "utf8")), "the prompt no longer asks every answer for an open problem");
  AI.run = real;
  sq.exec("DELETE FROM ask_golden");
  const gq = sq.prepare("INSERT INTO ask_golden (slug, question, title, added_at) VALUES (?, ?, ?, '2026-10-05T00:00:00Z')");
  gq.run("joules-per-solution-metric", "What does JPCUB measure?", "J/S");
  gq.run("distinction-lattice-framework", "What would falsify the distinction-lattice framework?", "DLF");
  for (let i = 0; i < 8; i++) gq.run("filler-" + i, "Filler question number " + i + " about adelic statistics?", "filler");
  await worker.scheduled({ scheduledTime: Date.UTC(2026, 9, 7, 3, 41) }, env, ctx);
  await Promise.allSettled(waits.splice(0));
  const ev2 = sq.prepare("SELECT detail FROM ask_evals WHERE kind = 'retrieval-champion' ORDER BY id DESC LIMIT 1").get();
  const defs = ev2 ? JSON.parse(ev2.detail).defs : null;
  ok(defs && defs["joules-per-solution-metric"] === 1 && defs["distinction-lattice-framework"] === 1, "the retrieval eval always includes the defined terms' golden questions and records their ranks: " + JSON.stringify(defs));
}

// 8b. ASK-JUDGE-CONTEXT-1 (2.4.2, agent_issues 2165): the judge reads the excerpt text the writer read; only verdicts made
// on that full text feed the metric; a judge that returns no JSON hands the answer to a second model family.
{
  const real = AI.run;
  let seen = null;
  AI.run = async (m, o) => { if (o && o.stream) seen = o.messages[o.messages.length - 1].content; return real(m, o); };
  await call("/api/ask", { query: "Judge context question: what does JPCUB measure in joules?" }, "6.6.6.6");
  AI.run = real;
  const row = sq.prepare("SELECT judge, answer, context FROM ask_events WHERE query LIKE 'Judge context question%' ORDER BY ts DESC LIMIT 1").get();
  ok(row && row.judge === 2 && row.answer && row.context, "every answer is sampled for the judge and marked as full-context (judge = 2): " + JSON.stringify(row && row.judge));
  ok(seen && seen.includes(row.context), "the stored judge context is the excerpt text the writer was given, character for character");
  const wsrc = readFileSync(join(here, "worker.js"), "utf8");
  ok(!/excerpt\.slice\(0, 1800\)/.test(wsrc), "no 1800-character cut of the judge context remains");
  // a verdict made on the truncated context (judge = 1) is kept but not counted
  sq.exec("UPDATE ask_events SET judged_supported=NULL, judged_total=NULL, judge=0");
  sq.exec("UPDATE ask_events SET judge=1, judged_supported=0, judged_total=30 WHERE id IN (SELECT id FROM ask_events WHERE limited IS NULL AND cached=0 LIMIT 1)");
  sq.exec("UPDATE ask_events SET judge=2, judged_supported=18, judged_total=20, answer='x [1]', context='[1] y' WHERE id IN (SELECT id FROM ask_events WHERE limited IS NULL AND cached=0 AND judge=0 LIMIT 1)");
  await worker.scheduled({ scheduledTime: Date.UTC(2026, 9, 8, 4, 41) }, env, ctx);
  await Promise.allSettled(waits.splice(0));
  ok(sq.prepare("SELECT last_value v FROM metric_registry WHERE metric='ask_grounded_share_7d'").get().v === "0.9", "only full-context verdicts feed ask_grounded_share_7d: " + sq.prepare("SELECT last_value v FROM metric_registry WHERE metric='ask_grounded_share_7d'").get().v);
  ok(sq.prepare("SELECT judged_total t FROM ask_events WHERE judge=1").get().t === 30, "the old verdict stays in the table");
  // the first judge thinks and never answers: the second family judges
  sq.exec("UPDATE ask_events SET judged_supported=NULL, judged_total=NULL WHERE judge=2");
  const legs = [];
  AI.run = async (m, o) => { const isJudge = /supported by its numbered excerpts/.test(JSON.stringify(o.messages || "")); if (isJudge) legs.push([m, o.max_tokens]); if (isJudge && /deepseek/.test(m)) return { response: "<think>thinking only</think>" }; return real(m, o); };
  await worker.scheduled({ scheduledTime: Date.UTC(2026, 9, 9, 3, 41) }, env, ctx);
  await Promise.allSettled(waits.splice(0));
  AI.run = real;
  const jn = JSON.parse(sq.prepare("SELECT note FROM ask_loop_runs WHERE kind='judge' ORDER BY id DESC LIMIT 1").get().note);
  ok(jn.judged === 1 && jn.second_judge === 1 && !jn.failed, "a no-JSON judge reply is judged by the second model, not lost: " + JSON.stringify(jn));
  ok(legs.length === 2 && /deepseek/.test(legs[0][0]) && /glm/.test(legs[1][0]) && legs[1][1] === 8000, "the second judge is another family with a reasoning budget: " + JSON.stringify(legs));
  const vm = /var VERSION = "(\d+)\.(\d+)\.(\d+)/.exec(wsrc);
  ok(vm && Number(vm[1]) * 1e6 + Number(vm[2]) * 1e3 + Number(vm[3]) >= 2004002, "VERSION is at least 2.4.2");
}

// 9. ASK-HUNG-REQUEST-1 (#1839): no await on /api/ask can hang. Timers run 500 times faster in this section (the 150 s
// answer deadline is 300 ms, the 45 s model-idle deadline 90 ms, the 15 s write deadline 30 ms).
{
  const realST = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...a) => realST(fn, Math.max(1, (Number(ms) || 0) / 500), ...a);
  const n0 = sq.prepare("SELECT COUNT(*) n FROM ask_events").get().n;
  // a visitor who stops reading: the response body is never read
  const r = await worker.fetch(new Request("https://ask.qwav.tech/api/ask", { method: "POST", headers: { "content-type": "application/json", "CF-Connecting-IP": "5.5.5.5" }, body: JSON.stringify({ query: "Gone reader question about adelic statistics?" }) }), env, ctx);
  ok(r.status === 200, "the stream response is returned at once");
  await Promise.allSettled(waits.splice(0));
  const g = sq.prepare("SELECT limited, error FROM ask_events ORDER BY rowid DESC LIMIT 1").get();
  ok(sq.prepare("SELECT COUNT(*) n FROM ask_events").get().n === n0 + 1 && g.limited === "client-gone" && g.error === null, "a visitor who stops reading ends the answer: logged as limited 'client-gone', not an error (" + JSON.stringify(g) + ")");
  // a model stream that stalls after one chunk
  const real = AI.run;
  AI.run = async (m, o) => { if (!o || !o.stream) return real(m, o); const enc = new TextEncoder(); return new ReadableStream({ start(c) { c.enqueue(enc.encode("data: " + JSON.stringify({ response: "Partial " }) + "\n\n")); } }); };
  const s = await call("/api/ask", { query: "Stalled model question about adelic statistics?" }, "5.5.5.6");
  const e = sse(s.text, "error")[0];
  const row = sq.prepare("SELECT error FROM ask_events ORDER BY rowid DESC LIMIT 1").get();
  ok(e && /model stream timed out/.test(e.error) && /model stream timed out/.test(row.error || ""), "a stalled model stream ends with an error event and the event is logged (" + (row && row.error) + ")");
  // a model call that never starts
  AI.run = async (m, o) => (o && o.stream ? new Promise(() => {}) : real(m, o));
  const s2 = await call("/api/ask", { query: "Model that never starts, about adelic statistics?" }, "5.5.5.7");
  const e2 = sse(s2.text, "error")[0];
  ok(e2 && /timed out/.test(e2.error) && sse(s2.text, "meta").length === 1, "a model call that never answers still gives the visitor the sources and an error, never a hung request");
  AI.run = real;
  globalThis.setTimeout = realST;
}
// 10. ASK-IDEA-HANDOFF-1 (#1936): an uncovered answer points to the ideas pipeline; thread links use /s/<id>.
{
  const p = (await call("/")).text;
  ok(p.includes("if (d.uncovered){") && p.includes('href=\\"https://ideas.qnfo.org/\\">ideas.qnfo.org</a>') && !p.includes("ideas.qnfo.org/#/s/") && /https:\/\/ideas\.qnfo\.org\/s\//.test(p), "the page hands an uncovered question to ideas.qnfo.org and links threads at /s/<id>");
  const real = AI.run;
  AI.run = async (m, o) => { if (!o || !o.stream) return real(m, o); const enc = new TextEncoder(); return new ReadableStream({ start(c) { c.enqueue(enc.encode("data: " + JSON.stringify({ response: "The excerpts do not cover this question. Nothing in the corpus addresses it." }) + "\n\n")); c.close(); } }); };
  const u = await call("/api/ask", { query: "What is the boiling point of adelic tea?" }, "5.5.5.8");
  const d = sse(u.text, "done")[0];
  ok(d && d.uncovered === 1, "the done event says when the corpus does not cover the question");
  AI.run = real;
}
// 11. ASK-GROUND-3 and ASK-CRAWLER-GATE-1 (2.5.0, agent_issues 2165 and 2339)
{
  const wsrc = readFileSync(join(here, "worker.js"), "utf8");
  const vv = /var VERSION = "(\d+)\.(\d+)\.(\d+)/.exec(wsrc);
  ok(vv && Number(vv[1]) * 1e6 + Number(vv[2]) * 1e3 + Number(vv[3]) >= 2005000, "VERSION is at least 2.5.0");
  // 11a. a declared crawler or a prefetch gets no retrieval, no model call and no ask_events row; it is counted in ask_rate
  const post = async (headers, q) => {
    const r = await worker.fetch(new Request("https://ask.qwav.tech/api/ask", { method: "POST", headers: Object.assign({ "content-type": "application/json", "CF-Connecting-IP": "4.4.4.4" }, headers), body: JSON.stringify({ query: q }) }), env, ctx);
    const t = await r.text();
    await Promise.allSettled(waits.splice(0));
    return { status: r.status, text: t };
  };
  const ev0 = sq.prepare("SELECT COUNT(*) n FROM ask_events").get().n, m0 = models.length;
  const bot = await post({ "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" }, "What does crawler question one ask about adelic statistics?");
  const pre = await post({ "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36", "Sec-Purpose": "prefetch;prerender" }, "What does prefetch question two ask about adelic statistics?");
  const hl = await post({ "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/151.0.0.0 Safari/537.36" }, "What does headless question three ask about adelic statistics?");
  ok(bot.status === 403 && JSON.parse(bot.text).automated === "crawler" && pre.status === 403 && JSON.parse(pre.text).automated === "prefetch" && hl.status === 403, "a crawler user agent, a prefetch and a headless browser get a 403 that says why: " + [bot.status, pre.status, hl.status].join(","));
  ok(sq.prepare("SELECT COUNT(*) n FROM ask_events").get().n === ev0 && models.length === m0, "no ask_events row and no model call for automated clients");
  const day = new Date().toISOString().slice(0, 10);
  ok((sq.prepare("SELECT n FROM ask_rate WHERE k = ?").get("auto:crawler:" + day) || {}).n === 2 && (sq.prepare("SELECT n FROM ask_rate WHERE k = ?").get("auto:prefetch:" + day) || {}).n === 1, "automated requests are counted per kind and day in ask_rate");
  const human = await post({ "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36" }, "What does a reader ask about adelic statistics today?");
  const api = await post({ "User-Agent": "curl/8.9.1" }, "What does an API client ask about adelic statistics today?");
  ok(human.status === 200 && sse(human.text, "done").length === 1 && api.status === 200 && sse(api.text, "done").length === 1, "a browser and an API client (curl) are answered as before");
  ok(/Disallow: \/api\/ask/.test((await call("/robots.txt")).text), "robots.txt disallows /api/ask");
  // 11b. the page asks a ?q= question only after a trusted pointer, touch or key event (or the Ask button)
  const pg = (await call("/")).text;
  const bootSrc = pg.slice(pg.indexOf("function boot(){"), pg.indexOf('window.addEventListener("popstate"'));
  const runBoot = (webdriver) => {
    const listeners = {}, asked = [], t = { value: "", style: {}, form: { addEventListener() {} } }, hint = { textContent: "" };
    const ctxv = vm.createContext({ URLSearchParams, location: { search: "?q=" + encodeURIComponent("What does \u201cQuantum Statistics from the Adelic Product Formula\u201d show?") }, navigator: { webdriver }, window: { addEventListener(n, f) { listeners[n] = f; }, removeEventListener(n) { delete listeners[n]; } }, $: (s) => ({ "#q0": t, "#landing": {}, ".hint": hint })[s] || null, grow() {}, ask(q) { asked.push(q); }, busy: false });
    vm.runInContext(bootSrc + "\nboot();", ctxv);
    return { listeners, asked, t, hint };
  };
  const b1 = runBoot(false);
  ok(b1.asked.length === 0 && /Quantum Statistics/.test(b1.t.value) && /ready/.test(b1.hint.textContent) && typeof b1.listeners.pointermove === "function", "a deep link fills the box and waits; nothing is asked on load");
  b1.listeners.pointermove({ isTrusted: false, type: "pointermove" });
  ok(b1.asked.length === 0, "a synthetic (untrusted) event does not ask");
  b1.listeners.keydown({ isTrusted: true, type: "keydown", target: { tagName: "TEXTAREA" } });
  ok(b1.asked.length === 0, "typing in the box does not ask the original question");
  b1.listeners.pointermove({ isTrusted: true, type: "pointermove", target: {} });
  ok(b1.asked.length === 1 && /Quantum Statistics/.test(b1.asked[0]) && !b1.listeners.pointermove, "the first trusted pointer event asks once and removes the listeners");
  const b2 = runBoot(true);
  ok(b2.asked.length === 0 && !Object.keys(b2.listeners).length && /Quantum Statistics/.test(b2.t.value), "an automated browser (navigator.webdriver) gets the question in the box and no listener");
  // 11c. ASK-NAMED-PAPER-1: a quoted title gets that paper's body sections as source [1], and the judge stores the whole context
  const pq = PAPERS.find((p) => p.slug === "adelic-quantum-statistics");
  pq.body_md = "# 1. The Result\n\n" + "The squarefree origin of quantum statistics follows from the adelic product formula at every place. ".repeat(14) + "\n\n# 5. What Would Falsify It\n\nThe result is refuted if a measured exchange phase is not a product of local signs over the places. " + "A single counterexample place falsifies the statistics claim. ".repeat(20) + "\n\n# 6. Show And Tell\n\n" + "Quantum statistics show the product formula at work across places. ".repeat(20);
  const realGet = AI_SEARCH.get;
  AI_SEARCH.get = () => ({ items: { async upload() { return {}; } }, async search() { return { chunks: Array.from({ length: 8 }, (_, i) => ({ score: 0.6 - i * 0.01, text: "# Long Related Paper " + i + "\n\n" + ("Related statistics sentence number " + i + " for the context length check. ").repeat(60), item: { key: "long-related-" + i + ".md" } })) }; } });
  const real = AI.run;
  let seen = null;
  AI.run = async (m, o) => { if (o && o.stream) seen = o.messages[o.messages.length - 1].content; return real(m, o); };
  const nq = await call("/api/ask", { query: "What does \u201cQuantum Statistics from the Adelic Product Formula\u201d show, and what would falsify it?" }, "3.3.3.3");
  AI.run = real; AI_SEARCH.get = realGet;
  const nm = sse(nq.text, "meta")[0];
  ok(nm && nm.sources[0].slug === "adelic-quantum-statistics" && nm.sources[0].named === true && nm.sources.filter((s) => s.slug === "adelic-quantum-statistics").length === 1, "the quoted paper is source [1], once, marked as named");
  ok(seen && /The question names source \[1\] \(Quantum Statistics from the Adelic Product Formula\)/.test(seen) && /The result is refuted if a measured exchange phase/.test(seen) && !/KNOWLEDGE GRAPH/.test(seen), "the writer gets the paper's falsification section and no knowledge-graph lines");
  const nrow = sq.prepare("SELECT query, judge, context FROM ask_events WHERE query LIKE 'What does %Adelic Product Formula%' ORDER BY ts DESC LIMIT 1").get();
  ok(nrow && !/^\[paper:/.test(nrow.query) && nrow.judge === 2 && nrow.context.length > 12000 && seen.includes(nrow.context), "the judge context is stored whole (" + (nrow && nrow.context.length) + " characters, over the old 12000 cut) and equals the writer's excerpts");
  const phrase = await call("/api/ask", { query: 'Which papers use the "adelic product" idea?' }, "3.3.3.4");
  ok(sse(phrase.text, "meta")[0].sources.every((s) => !s.named), "a quoted phrase that is not a title (under half of the title's words) names no paper");
  // 11d. the grounded share counts every judged full-context answer, including one whose reader left; the judge runs hourly
  sq.exec("UPDATE ask_events SET judged_supported=NULL, judged_total=NULL, judge=0");
  const nowIso = new Date().toISOString();
  sq.prepare("INSERT INTO ask_events (id, ts, cached, limited, cfg, judge, answer, context, judged_supported, judged_total) VALUES ('a_gone1', ?, 0, 'client-gone', 'c0', 2, 'x [1]', '[1] y', 16, 20)").run(nowIso);
  sq.prepare("INSERT INTO ask_events (id, ts, cached, limited, cfg, judge, answer, context) VALUES ('a_fresh1', ?, 0, NULL, 'c0', 2, 'x [1]', '[1] y')").run(nowIso);
  sq.prepare("INSERT INTO ask_events (id, ts, cached, limited, cfg, judge, answer, context, judged_supported, judged_total) VALUES ('a_ip1', ?, 0, 'ip', 'c0', 2, 'x [1]', '[1] y', 0, 50)").run(nowIso);
  await worker.scheduled({ scheduledTime: Date.UTC(2026, 9, 13, 5, 41) }, env, ctx);
  await Promise.allSettled(waits.splice(0));
  const hj = sq.prepare("SELECT kind, note FROM ask_loop_runs ORDER BY id DESC LIMIT 3").all().map((r) => r.kind);
  ok(hj.includes("judge") && sq.prepare("SELECT judged_total t FROM ask_events WHERE id='a_fresh1'").get().t === 4, "an hourly tick judges new answers: " + hj.join(","));
  const gm = sq.prepare("SELECT last_value v, formula f FROM metric_registry WHERE metric='ask_grounded_share_7d'").get();
  ok(gm.v === "0.7917" && /client-gone/.test(gm.f), "ask_grounded_share_7d = (16 + 3) / (20 + 4) counts the client-gone answer, not the ip-limited row, and the registry formula says so: " + JSON.stringify(gm));
  const mn = JSON.parse(sq.prepare("SELECT note FROM ask_loop_runs WHERE kind='measure' ORDER BY id DESC LIMIT 1").get().note);
  ok(mn.grounded_claims_7d === 24, "the measure note records the judged claims behind the share: " + JSON.stringify(mn.grounded_claims_7d));
}
// 9. ASK-METRIC-STALE-1 (agent_issues 1000478): a metric the tick cannot compute goes back to UNMEASURED, a computed one keeps its 0..1 value
{
  sq.exec("DELETE FROM ask_feedback");
  sq.prepare("INSERT INTO ask_feedback (event_id, ts, helpful) VALUES ('fb1', ?, 1)").run(new Date().toISOString());
  sq.exec("UPDATE metric_registry SET last_value='33.3', last_refreshed='2026-10-25T08:45:00Z', state='MEASURED' WHERE metric='ask_helpful_rate_30d'");
  await worker.scheduled({ scheduledTime: Date.UTC(2026, 9, 14, 5, 41) }, env, ctx);
  await Promise.allSettled(waits.splice(0));
  const stale = sq.prepare("SELECT last_value v, last_refreshed r, state s, formula f FROM metric_registry WHERE metric='ask_helpful_rate_30d'").get();
  ok(stale.v === null && stale.r === null && stale.s === "UNMEASURED" && stale.f && stale.f.length > 20, "1 rating (under 10): the stale 33.3 is cleared to UNMEASURED and the formula stays: " + JSON.stringify(stale));
  const keep = sq.prepare("SELECT last_value v, state s FROM metric_registry WHERE metric='ask_grounded_share_7d'").get();
  ok(keep.s === "MEASURED" && Number(keep.v) > 0 && Number(keep.v) <= 1, "a metric the tick can compute keeps its value: " + JSON.stringify(keep));
  for (let i = 0; i < 12; i++) sq.prepare("INSERT INTO ask_feedback (event_id, ts, helpful) VALUES (?, ?, ?)").run("fbm" + i, new Date().toISOString(), i < 8 ? 1 : 0);
  await worker.scheduled({ scheduledTime: Date.UTC(2026, 9, 15, 5, 41) }, env, ctx);
  await Promise.allSettled(waits.splice(0));
  const back = sq.prepare("SELECT last_value v, state s FROM metric_registry WHERE metric='ask_helpful_rate_30d'").get();
  ok(back.s === "MEASURED" && Number(back.v) >= 0 && Number(back.v) <= 1 && Math.abs(Number(back.v) - 9 / 13) < 0.001, "13 ratings (9 helpful): the value is measured again, as a share in 0..1: " + JSON.stringify(back));
  sq.exec("DELETE FROM ask_feedback");
  await worker.scheduled({ scheduledTime: Date.UTC(2026, 9, 16, 5, 41) }, env, ctx);
  await Promise.allSettled(waits.splice(0));
  const again = sq.prepare("SELECT last_value v, state s FROM metric_registry WHERE metric='ask_helpful_rate_30d'").get();
  ok(again.v === null && again.s === "UNMEASURED", "ratings gone again: cleared again, never stale: " + JSON.stringify(again));
  const unmeasuredAll = sq.prepare("SELECT COUNT(*) n FROM metric_registry WHERE owner='qnfo-ai-search' AND state='MEASURED' AND last_value IS NULL").get().n;
  ok(unmeasuredAll === 0, "no ask metric is MEASURED without a value");
}
console.log(passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
