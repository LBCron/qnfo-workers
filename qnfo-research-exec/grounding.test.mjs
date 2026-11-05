// Offline test (node:sqlite as D1 shim, fetch mocked) for GROUND-OR-SLOT-1 and GROUND-THIN-FAILFAST-1 (agent_issues 1751).
// Row 196536e3 grounded to 2 bibliography entries on four passes because its OR fallback query was cut by the 6-query cap,
// then ran the whole pipeline four times on a paper that could never pass gate-refcount (floor 5) and parked.
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { groundQueries, stageGround } from "./worker.js";

// No real pauses between arXiv requests in the test.
globalThis.setTimeout = (fn) => { fn(); return 0; };

// 1. groundQueries keeps the OR fallback in the last slot.
const IDEA_574 = "Re-entry from 10.9999/test.22749402: | **Weight sequence classification** | For which $U_n$ is arithmetic polynomial-time?";
const PARENT_574 = "Nonlinear Tree-Based Numeration Systems: A Consolidated Synthesis";
let qs = groundQueries(IDEA_574, PARENT_574);
assert.equal(qs.length, 6);
assert.match(qs[5], /^all:Weight OR all:sequence OR all:arithmetic OR all:polynomial-time OR /, "row 196536e3's OR fallback must survive the cap");
assert.equal(qs.filter((q) => / OR /.test(q)).length, 1);
// One idea phrase + a long parent title: already fit (OR was 6th), unchanged.
qs = groundQueries("Re-entry from 10.9999/test.22739626: (ii) Can this framework classify all possible fusion rules for MZMs in 2D TSCs?", "Braid Group Representations, Modular Data, and the Classification of Majorana Zero Mode Fusion Rules in 2D Topological Superconductors");
assert.equal(qs.length, 6);
assert.match(qs[0], /^all:"fusion rules" AND /);
assert.match(qs[5], / OR /);
// Short query sets are untouched; an idea with no content words yields no OR query and no crash.
assert.equal(groundQueries("Re-entry from 10.9999/test.22758712: Why Vertices, Not Points?", "p-Adic Braid Groups on Bruhat-Tits Buildings").length, 4);
assert.deepEqual(groundQueries("what is the", ""), []);

// 2. stageGround end to end against fake arXiv, router search, living-paper, R2 and qnfo-audit.
const audit = new DatabaseSync(":memory:");
audit.exec(`CREATE TABLE research_queue (id TEXT PRIMARY KEY, source TEXT, source_id TEXT, idea TEXT, summary TEXT, status TEXT DEFAULT 'queued', stage TEXT, claimed_at TEXT, attempt INTEGER DEFAULT 0, context TEXT, error TEXT, recover_count INTEGER DEFAULT 0, revise_count INTEGER DEFAULT 0, terminal_rearms INTEGER DEFAULT 0);
CREATE TABLE cloud_ops_events (id TEXT, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT);
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);`);
const lp = new DatabaseSync(":memory:");
// CITE-FULLTEXT-1: a corpus paper is cited from its body, an arXiv work from its HTML full text.
const BODY = "# T\n\n## 1. Introduction\n\n" + "The weight sequence fixes the carry rule of the numeration system. ".repeat(12) + "\n\n## 5. Results\n\n" + "Addition runs in quadratic time for every linear weight sequence. ".repeat(12) + "\n\n## References\n\n[1] x";
lp.exec(`CREATE TABLE papers (slug TEXT, title TEXT, doi TEXT, abstract TEXT, status TEXT, body_md TEXT);
INSERT INTO papers VALUES ('nonlinear-tree-based-numeration-systems-a-consolidated-synthesis', '${PARENT_574}', '10.9999/test.22749402', 'parent abstract', 'published', ''),
  ('corpus-a', 'Corpus paper A', '10.9999/test.1', 'a', 'published', '${BODY}'), ('corpus-b', 'Corpus paper B', '10.9999/test.2', 'b', 'published', '${BODY}');`);
const d1 = (db) => ({ prepare(sql) {
  let args = [];
  const o = { bind(...a) { args = a; return o; },
    async run() { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
    async first() { return db.prepare(sql).get(...args) || null; },
    async all() { return { results: db.prepare(sql).all(...args) }; } };
  return o;
} });
const r2 = new Map();
const env = {
  QNFO_AUDIT: d1(audit), LIVING_PAPER: d1(lp),
  MIRROR: { async put(k, v) { r2.set(k, v); }, async get(k) { return r2.has(k) ? { text: async () => r2.get(k) } : null; } },
  // qnfo-ai /v1/search: two corpus hits, as the live row got.
  QNFO_AI: { async fetch() { return new Response(JSON.stringify({ results: [{ index: "PAPER_VZ", metadata: { slug: "corpus-a" } }, { index: "PAPER_VZ", metadata: { slug: "corpus-b" } }] })); } }
};
let arxivDown = false;
let arxivCalls = [];
// GROUND-SECOND-SOURCE-1: DataCite is asked only when the bibliography is short; by default it is down too.
let dataciteCalls = [];
let dataciteAnswer = () => new Response("down", { status: 503 });
const dcRecord = (id, title, abstract) => ({ attributes: { doi: "10.48550/arxiv." + id, titles: [{ title }], descriptions: abstract ? [{ descriptionType: "Abstract", description: abstract }] : [] } });
const fullHtml = (u) => '<html><body><h1 class="ltx_title">W</h1><div class="ltx_abstract">abstract</div><section class="ltx_section"><h2 class="ltx_title ltx_title_section">1 Introduction</h2><p>' + "Intro text for " + u + ". ".repeat(1) + "We study the carry rule. ".repeat(40) + '</p></section><section class="ltx_section"><h2 class="ltx_title ltx_title_section">4 Results</h2><p>' + "The bound <math alttext=\"n^{2}\"><mi>n</mi></math> holds for every sequence. ".repeat(40) + '</p></section><section class="ltx_bibliography"><h2>References</h2><p>[1] other</p></section></body></html>';
const htmlUrl = (u) => u.startsWith("https://arxiv.org/html/") || u.startsWith("https://ar5iv.labs.arxiv.org/html/");
const feed = (n) => "<feed>" + Array.from({ length: n }, (_, i) => `<entry><id>http://arxiv.org/abs/2601.0${1000 + i}v1</id><title>Paper ${i}</title><summary>S${i}</summary></entry>`).join("") + "</feed>";
globalThis.fetch = async (url) => {
  const u = decodeURIComponent(String(url));
  if (u.startsWith("https://api.datacite.org/")) { dataciteCalls.push(u); return dataciteAnswer(); }
  if (htmlUrl(u)) return new Response(fullHtml(u));
  if (!u.startsWith("https://export.arxiv.org/")) return new Response("unexpected " + u, { status: 404 });
  arxivCalls.push(u);
  if (arxivDown) return new Response("Rate exceeded.", { status: 503 });
  // Live behaviour measured 2026-10-02: every AND-phrase query for this idea returns 0 entries, the OR query returns 8.
  return new Response(feed(/ OR /.test(u) ? 8 : 0));
};
const row = (id, rc) => {
  audit.prepare("INSERT INTO research_queue (id, source, source_id, idea, status, stage, recover_count) VALUES (?, 'proposal', '574', ?, 'researching', 'ground', ?)").run(id, IDEA_574, rc);
  return audit.prepare("SELECT * FROM research_queue WHERE id = ?").get(id);
};
const get = (id) => audit.prepare("SELECT * FROM research_queue WHERE id = ?").get(id);

// 2a. healthy arXiv: the OR query runs, 8 arXiv + 2 corpus entries, the row advances to ensemble.
let res = await stageGround(env, row("healthy", 0));
assert.equal(res.ok, true);
assert.equal(res.bibCount, 10);
assert.ok(arxivCalls.some((u) => / OR /.test(u)), "the OR fallback must be sent to arXiv");
assert.equal(get("healthy").stage, "ensemble");
assert.equal(JSON.parse(get("healthy").context).bibCount, 10);
assert.match(r2.get("pipeline/healthy/grounding.md"), /\n\[10\] QNFO: Corpus paper B/);
// CITE-FULLTEXT-1: every entry carries its full-text excerpts, results first in rank and in document order on the page.
const g1 = r2.get("pipeline/healthy/grounding.md");
assert.equal((g1.match(/Full text \(https:\/\/arxiv\.org\/html\/2601\.0\d{4}v1\)/g) || []).length, 8, "every arXiv entry was read from its HTML full text");
assert.equal((g1.match(/Full text \(https:\/\/papers\.qnfo\.org\/papers\/corpus-[ab]\)/g) || []).length, 2, "every corpus entry was read from its body");
assert.match(g1, /\u00a7 4 Results: The bound \$n\^\{2\}\$ holds/, "math keeps its LaTeX");
assert.ok(!/\[1\] other/.test(g1) && !/abstract\n/.test(g1.split("## Bibliography")[1]), "the cited work's own bibliography is not excerpted");
assert.match(audit.prepare("SELECT text FROM cloud_ops_events WHERE kind = 'ground-fulltext' ORDER BY rowid DESC LIMIT 1").get().text, /candidates=10 kept_arxiv=8 kept_qnfo=2 dropped_no_fulltext=0 transport_errors=0/);
assert.equal(dataciteCalls.length, 0, "a full bibliography does not call the second source");

// 2b. arXiv and DataCite down: each query is tried three times, the 2-entry grounding stops at ground, one recover is spent.
arxivDown = true; arxivCalls = [];
res = await stageGround(env, row("thin", 1));
assert.equal(res.ok, false);
assert.equal(res.stage, "ground");
assert.equal(res.bibCount, 2);
assert.equal(res.arxivErrors, 6);
assert.equal(arxivCalls.length, 18, "6 queries, three attempts each");
assert.equal(dataciteCalls.length, 2, "the second source is tried twice");
assert.equal(res.withheld, undefined, "a transport failure is an error, not a withheld paper");
let t = get("thin");
assert.equal(t.status, "queued"); assert.equal(t.stage, "ground"); assert.equal(t.recover_count, 2);
assert.match(t.error, /^ground: bibliography 2 < 5 entries with full text \(gate-refcount cannot pass\); fulltext_dropped=0; fulltext_transport_errors=0; arxiv_http_errors=6; second_source=error/);
assert.equal(audit.prepare("SELECT count(*) n FROM cloud_ops_events WHERE kind = 'ground-thin'").get().n, 1);
assert.ok(r2.has("pipeline/thin/grounding.md"), "the thin grounding is kept for diagnosis");

// 2c. a thin pass with recover_count exhausted re-enters the lane at ground with the reason (SINGLE-LANE-1: it was parked) and files the terminal issue, as before.
// 99 rather than the old ceiling of 3: the ceiling is ops_config research_recover_max (default 6), so a literal 3 is no
// longer exhausted and the assertion tested the default rather than the park.
res = await stageGround(env, row("exhausted", 99));
assert.equal(res.ok, false);
t = get("exhausted");
assert.equal(t.status, "queued"); assert.equal(t.stage, "ground"); assert.equal(t.recover_count, 0); assert.equal(t.terminal_rearms, 1);
assert.match(t.error, /^SINGLE-LANE-1: re-entered at ground, no parked state\. Was: recover_count exhausted \(99\); last error: ground: bibliography 2 < 5/);
assert.equal(audit.prepare("SELECT count(*) n FROM agent_issues WHERE title LIKE 'RESEARCH-TERMINAL exhauste%'").get().n, 1);

// 2d. arXiv refusing, DataCite answering: relevant arXiv records fill the bibliography, the row advances, and an
// off-topic record, a record without an abstract and a duplicate are left out.
arxivCalls = []; dataciteCalls = [];
dataciteAnswer = () => new Response(JSON.stringify({ data: [
  dcRecord("2601.10001", "Weight sequence classification for numeration systems", "We classify each weight sequence for which arithmetic is polynomial-time."),
  dcRecord("2601.10002", "Polynomial-time arithmetic in nonlinear numeration systems", "A weight sequence and its arithmetic are studied."),
  dcRecord("2601.10003", "Tree-based numeration systems", "Nonlinear tree-based numeration systems and their synthesis."),
  dcRecord("2601.10003", "Tree-based numeration systems", "Nonlinear tree-based numeration systems and their synthesis."),
  dcRecord("2601.10004", "An unrelated survey of galaxy morphology", "Spiral arms and bars in nearby galaxies."),
  dcRecord("2601.10005", "Weight sequence classification without a summary", ""),
  dcRecord("hep-th/9901001", "Arithmetic of weight sequence families", "Weight sequence classification revisited.")
] }), { status: 200 });
res = await stageGround(env, row("second", 0));
assert.equal(res.ok, true, "DataCite records carry the row past the floor");
assert.equal(res.bibCount, 6, "4 relevant arXiv records + 2 corpus entries");
const g2 = r2.get("pipeline/second/grounding.md");
assert.match(g2, /\[1\] arXiv:2601\.10001 \| Weight sequence classification for numeration systems\n  We classify/);
assert.match(g2, /arXiv:hep-th\/9901001 \| /);
assert.ok(!/galaxy/.test(g2), "an off-topic record is not cited");
assert.ok(!/without a summary/.test(g2), "a record with no abstract is not cited");
assert.equal((g2.match(/arXiv:2601\.10003 \|/g) || []).length, 2, "one bibliography line and one literature line, no duplicate");
assert.equal(get("second").stage, "ensemble");
const ev2 = audit.prepare("SELECT text, status FROM cloud_ops_events WHERE kind = 'ground-second-source' ORDER BY ts DESC, rowid DESC LIMIT 1").get();
assert.match(ev2.text, /source=datacite status=200 returned=6 added=4/);

// 2e. every source answers and the literature is thin: the floor withholds the row (a warning, not a transport error).
arxivDown = false;
globalThis.fetch = async (url) => {
  const u = decodeURIComponent(String(url));
  if (u.startsWith("https://api.datacite.org/")) return new Response(JSON.stringify({ data: [] }), { status: 200 });
  return new Response("<feed></feed>");
};
res = await stageGround(env, row("thinlit", 0));
assert.equal(res.ok, false); assert.equal(res.withheld, "thin-literature");
assert.match(get("thinlit").error, /arxiv_http_errors=0; second_source=ok$/);

// 2f. a refusal is retried and the retry's answer is used.
let n429 = 0;
globalThis.fetch = async (url) => {
  const u = decodeURIComponent(String(url));
  if (u.startsWith("https://api.datacite.org/")) return new Response(JSON.stringify({ data: [] }), { status: 200 });
  if (htmlUrl(u)) return new Response(fullHtml(u));
  if (/ OR /.test(u) && n429++ < 2) return new Response("Rate exceeded.", { status: 429, headers: { "retry-after": "1" } });
  return new Response(feed(/ OR /.test(u) ? 8 : 0));
};
res = await stageGround(env, row("retried", 0));
assert.equal(res.ok, true); assert.equal(res.bibCount, 10); assert.equal(n429, 3, "two refusals, then the answer");

// 2g. replace metadata candidates whose full text is unavailable when filtering leaves fewer than the reference floor.
lp.prepare("UPDATE papers SET body_md = '' WHERE slug IN ('corpus-a', 'corpus-b')").run();
arxivCalls = []; dataciteCalls = [];
dataciteAnswer = () => new Response(JSON.stringify({ data: [
  dcRecord("2601.20001", "Weight sequence classification for numeration systems", "We classify weight sequences for polynomial-time arithmetic."),
  dcRecord("2601.20002", "Weight sequence arithmetic and carry rules", "We study carry rules for weight sequences.")
] }), { status: 200 });
globalThis.fetch = async (url) => {
  const u = decodeURIComponent(String(url));
  if (u.startsWith("https://api.datacite.org/")) { dataciteCalls.push(u); return dataciteAnswer(); }
  if (htmlUrl(u)) return /2601\.0100[3-7]/.test(u) ? new Response("Not Found", { status: 404 }) : new Response(fullHtml(u));
  if (!u.startsWith("https://export.arxiv.org/")) return new Response("unexpected " + u, { status: 404 });
  arxivCalls.push(u);
  return new Response(feed(/ OR /.test(u) ? 8 : 0));
};
res = await stageGround(env, row("fulltext-topup", 0));
assert.equal(res.ok, true, "DataCite should replace candidates dropped by the full-text filter");
assert.equal(res.bibCount, 5);
assert.equal(dataciteCalls.length, 1, "the second source runs after the full-text shortfall");
assert.match(audit.prepare("SELECT text FROM cloud_ops_events WHERE kind = 'ground-fulltext' ORDER BY rowid DESC LIMIT 1").get().text, /candidates=12 kept_arxiv=5 kept_qnfo=0 dropped_no_fulltext=7 transport_errors=0/);
assert.match(audit.prepare("SELECT text FROM cloud_ops_events WHERE kind = 'ground-second-source' ORDER BY rowid DESC LIMIT 1").get().text, /returned=2 added=2/);
assert.equal((r2.get("pipeline/fulltext-topup/grounding.md").match(/Full text \(https:\/\/arxiv\.org\/html\//g) || []).length, 5);

console.log("grounding tests passed");
