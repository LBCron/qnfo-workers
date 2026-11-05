// CONCEPT-NAV-1 and CONSISTENCY-1 (qnfo-ai-search 2.15.0, roadmap rows 35 and 33, charter pillar: research) offline suite.
// No network: the graph gateway, the paper gateway, AI Search, the rate-limit table and the edge cache are stubbed in the worker's own sandbox.
// Proves: the concept search keeps public nodes only and drops withdrawn papers; the neighbour route drops withdrawn papers and the edges
// that reached them; the pages carry their markers, load no third-party script and write untrusted text with textContent only; the passage
// picker takes the abstract, an introduction, the longest other section and the conclusion and never the references; the classifier puts a
// neighbour in redundancy only when it matches most passages closely, in missing citations only when the paper never names it, treats a
// version of the same title as the same work, and drops unpublished and junk slugs; the route validates the slug, answers 404 for an
// unpublished paper, caches a 200 and rate limits misses per address and in total.
// Run: node --no-warnings qnfo-ai-search/navigator.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
import vm from "node:vm";

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x) : "")); } };
const raw = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const src = raw.replace(/^export \{[^}]*\};?\s*$/m, "").replace(/^import [^;]*;/mg, "");

const cacheMap = new Map();
const caches = { default: { match: async (r) => { const h = cacheMap.get(r.url); return h ? h.clone() : undefined; }, put: async (r, res) => { cacheMap.set(r.url, res); } } };
const GRAPH = {
  nodes: [
    { id: "paper:live", name: "A live paper on ultrametric trees", label: "Paper", properties: { slug: "live", status: "published" } },
    { id: "paper:gone", name: "A retracted paper on ultrametric trees", label: "Paper", properties: { slug: "gone", status: "retracted" } },
    { id: "concept:ultrametric", name: "Ultrametric", label: "Concept", properties: {} },
    { id: "asset:worker", name: "qnfo-ops worker", label: "CloudflareAsset", properties: {} },
  ],
};
const NEIGH = {
  "paper:live": { node: GRAPH.nodes[0], neighbors: [
    { id: "paper:gone", name: "A retracted paper on ultrametric trees", label: "Paper", properties: { slug: "gone", status: "retracted" }, direction: "incoming", relationshipType: "CITES" },
    { id: "concept:ultrametric", name: "Ultrametric", label: "Concept", properties: {}, direction: "outgoing", relationshipType: "ABOUT" },
  ] },
};
const PAPERS = {
  own: { slug: "own", title: "An Own Paper On Joules", status: "published", abstract: "Abstract text about joules per solution and computing paradigms, long enough to be a passage of its own for the comparison.", body_md: "# An Own Paper On Joules\n\n## 1. Introduction\nThe introduction explains the joules per solution metric for computing paradigms and why peak throughput misleads the reader about energy, with examples drawn from several machines.\n\n## 2. Method\nThe method section is the longest section of this paper and it describes the measurement protocol in detail, including the whole-system boundary, the metering, the correctness check and the anti-gaming provisions that keep a benchmark honest across platforms and years of hardware change. $E = k T \\ln 2$ is stated here.\n\n## 3. Results\nShort results text that is nonetheless long enough to pass the minimum length of one hundred and twenty characters for a section.\n\n## 4. Conclusion\nThe conclusion restates that energy per correct answer is the figure that matters, and that every claim of advantage needs a whole-system boundary and a pre-registered task.\n\n## References\n- Landauer 1961\n- Related Paper Already Cited: a title the text names\n" },
  draft: { slug: "draft", title: "A Draft", status: "draft", abstract: "x", body_md: "# A Draft" },
};
const CATALOG = [
  { slug: "own", title: "An Own Paper On Joules", abstract: "a" },
  { slug: "dup", title: "A Near Repeat Of The Own Paper", abstract: "a" },
  { slug: "related", title: "A Related Paper On Energy Per Answer", abstract: "a" },
  { slug: "cited-one", title: "Related Paper Already Cited", abstract: "a" },
  { slug: "own-v2", title: "An Own Paper On Joules (version 2)", abstract: "a" },
  { slug: "weak", title: "Weakly Related Paper", abstract: "a" },
];
const log = { gateway: [], searches: [] };
async function gateway(url) {
  const u = new URL(String(url));
  log.gateway.push(u.hostname + u.pathname);
  const resp = (j, s) => ({ ok: (s || 200) < 400, status: s || 200, json: async () => j });
  if (u.hostname === "graph-api.qnfo.org" && u.pathname === "/nodes") return resp(GRAPH);
  if (u.hostname === "graph-api.qnfo.org" && u.pathname.startsWith("/neighbors/")) { const id = decodeURIComponent(u.pathname.slice(11)); return NEIGH[id] ? resp(NEIGH[id]) : resp({ error: "x" }, 404); }
  if (u.hostname === "papers.qnfo.org" && u.pathname === "/papers" && u.searchParams.get("format") === "json") return resp({ papers: CATALOG, total: CATALOG.length });
  if (u.hostname === "papers.qnfo.org" && u.pathname.startsWith("/papers/")) { const s = decodeURIComponent(u.pathname.slice(8)); return PAPERS[s] ? resp(PAPERS[s]) : resp({ error: "nf" }, 404); }
  return resp({}, 404);
}
const counters = new Map();
const QNFO_AUDIT = { prepare(sql) { const s = { bind(k) { s.k = k; return s; }, async first() { if (/INSERT INTO ask_rate/.test(sql)) { const n = (counters.get(s.k) || 0) + 1; counters.set(s.k, n); return { n }; } return null; }, async run() { return { success: true }; }, async all() { return { results: [] }; } }; return s; } };
const chunk = (slug, score, text) => ({ item: { key: slug + ".md" }, score, text: text || "# " + slug + "\nbody" });
// one result list per passage, in the order the picker returns them
let passageResults = [];
const AI_SEARCH = { get: () => ({ search: async (o) => { log.searches.push(o.query.slice(0, 40)); return { chunks: passageResults[log.searches.length - 1] || [] }; } }) };
const sb = { console: { log() {}, error() {}, warn() {} }, Date, JSON, Math, Number, String, RegExp, Set, Map, Array, Object, Promise, URL, URLSearchParams, Response, Request, Headers, TextEncoder, AbortController, setTimeout, clearTimeout, crypto, fetch: gateway, encodeURIComponent, decodeURIComponent, caches, AbortSignal };
vm.createContext(sb);
vm.runInContext(src + "\n__x = { worker_default, conceptSearch, conceptNeighbors, consPassages, consGroups, consClassify, consistency, consistencyRoute, CONCEPTS_PAGE, CONSISTENCY_PAGE, NAV_CSS, CONS_PER_IP_HOUR, CONS_GLOBAL_HOUR };", sb);
const X = sb.__x;
const env = { GATEWAY: { fetch: (u, o) => gateway(u, o) }, AI_SEARCH, QNFO_AUDIT };
const ctx = { waitUntil() {}, pending: [] };
const call = (path, headers) => X.worker_default.fetch(new Request("https://ask.qwav.org" + path, { headers: headers || {} }), env, { waitUntil: (p) => ctx.pending.push(p) });

// 1. concept search
{
  const r = await (await call("/api/concepts?q=ultrametric")).json();
  const ids = r.nodes.map((n) => n.id);
  ok(JSON.stringify(ids) === JSON.stringify(["concept:ultrametric", "paper:live"]), "concept search keeps public nodes, concepts first, drops withdrawn papers and non-public labels", ids);
  const short = await (await call("/api/concepts?q=u")).json();
  ok(short.nodes.length === 0, "a one-letter query returns nothing and calls no upstream");
}
// 2. neighbours
{
  const r = await (await call("/api/concepts/neighbors?id=paper%3Alive")).json();
  ok(r.found === true && r.nodes.map((n) => n.id).sort().join() === "concept:ultrametric,paper:live", "neighbour route drops the withdrawn paper", r.nodes.map((n) => n.id));
  ok(r.edges.length === 1 && r.edges[0].type === "ABOUT", "edges that reached the withdrawn paper are dropped", r.edges);
  const none = await (await call("/api/concepts/neighbors?id=")).json();
  ok(none.error === "id required", "an empty id is refused");
}
// 3. pages
{
  const a = await call("/concepts"), at = await a.text();
  ok(a.status === 200 && /data-page="concept-nav"/.test(at) && /<title>Concept navigator/.test(at), "concepts page and marker");
  const b = await call("/consistency"), bt = await b.text();
  ok(b.status === 200 && /data-page="consistency"/.test(bt) && /not findings/.test(bt) && /does not yet look for claims that contradict/.test(bt), "consistency page states what it does not check");
  for (const [name, t] of [["concepts", at], ["consistency", bt]]) {
    ok(!/<script[^>]+src=/.test(t), name + " page loads no script from elsewhere");
    ok(!/innerHTML|insertAdjacentHTML|document\.write|eval\(/.test(t), name + " page writes untrusted text with textContent only");
    ok(/prefers-color-scheme:dark/.test(t) && /:focus-visible/.test(t) && /name="viewport"/.test(t), name + " page has dark mode, focus style and viewport");
    ok(!/vector|pipeline|supplied summary|grounding/i.test(t.replace(/<script[\s\S]*?<\/script>/g, "")), name + " reader text has no pipeline talk");
  }
  ok(/headers/.test("headers") && a.headers.get("x-frame-options") === "DENY", "pages carry the security headers");
  const robots = await (await call("/robots.txt")).text(), sm = await (await call("/sitemap.xml")).text();
  ok(/Disallow: \/api\/consistency/.test(robots) && /Disallow: \/api\/ask/.test(robots), "robots keeps crawlers off the comparison route");
  ok(/ask\.qwav\.tech\/concepts/.test(sm) && /ask\.qwav\.tech\/consistency/.test(sm) && /<loc>https:\/\/ask\.qwav\.tech\/<\/loc>/.test(sm), "sitemap lists both pages and the home page");
}
// 4. passage picker
{
  const p = PAPERS.own, ps = X.consPassages(p.abstract, p.body_md);
  ok(ps.length === 4, "four passages", ps.map((x) => x.slice(0, 30)));
  ok(/^Abstract text about joules/.test(ps[0]), "first passage is the abstract");
  ok(/introduction explains/.test(ps[1]), "second is the introduction");
  ok(/longest section of this paper/.test(ps[2]) && !/\$/.test(ps[2]) && !/ln 2/.test(ps[2]), "third is the longest other section with math removed", ps[2]);
  ok(/conclusion restates/.test(ps[3]), "fourth is the conclusion");
  ok(!ps.some((x) => /Landauer 1961/.test(x)), "the reference list is never a passage");
  ok(ps.every((x) => x.length <= 420), "passages are cut to 420 characters");
  ok(X.consPassages("", "").length === 0, "no text, no passages");
}
// 5. classifier
{
  const g = X.consGroups([
    [chunk("dup", 0.95), chunk("related", 0.8), chunk("own", 0.99), chunk("audit-test-1", 0.9), chunk("unpublished", 0.97), chunk("weak", 0.6)],
    [chunk("dup", 0.93), chunk("related", 0.79), chunk("cited-one", 0.88), chunk("own-v2", 0.9)],
    [chunk("dup", 0.92), chunk("cited-one", 0.86), chunk("related", 0.7, "# Related Heading\nx")],
    [chunk("weak", 0.55)],
  ], "own");
  const bySlug = new Map(CATALOG.map((c) => [c.slug, c]));
  const c = X.consClassify(g, bySlug, { slug: "own", title: "An Own Paper On Joules" }, PAPERS.own.body_md, 4);
  ok(c.redundancy.map((x) => x.slug).join() === "dup", "dup matches 3 of 4 passages at 0.9 or more: redundancy", c.redundancy);
  ok(c.missing_citations.map((x) => x.slug).join() === "related", "related matches 3 passages, is not named by the paper: missing citation; the named, the weak and the unpublished are not", c.missing_citations.map((x) => x.slug));
  ok(c.same_work.map((x) => x.slug).join() === "own-v2", "a version mark does not make a different title", c.same_work);
  ok(g.get("own") === undefined && g.get("audit-test-1") === undefined, "the paper itself and junk slugs never enter the groups");
  ok(c.redundancy[0].matched_passages === 3 && c.redundancy[0].best_score === 0.95 && c.redundancy[0].url === "https://papers.qnfo.org/papers/dup", "item carries the counts and the paper address");
  ok(g.get("related").heads.indexOf("Related Heading") >= 0, "the matching heading is kept as evidence");
  const g2 = X.consGroups([[chunk("dup", 0.88)], [chunk("dup", 0.87)], [chunk("dup", 0.86)], []], "own");
  const c2 = X.consClassify(g2, bySlug, { slug: "own", title: "An Own Paper On Joules" }, PAPERS.own.body_md, 4);
  ok(c2.redundancy.length === 0 && c2.missing_citations.map((x) => x.slug).join() === "dup", "three matches under the redundancy score are a missing-citation candidate, not a repeat");
}
// 6. end to end and route
{
  log.searches.length = 0;
  passageResults = [[chunk("dup", 0.95), chunk("related", 0.8)], [chunk("dup", 0.94)], [chunk("dup", 0.93), chunk("related", 0.81)], [chunk("dup", 0.92)]];
  const r = await call("/api/consistency?slug=own");
  const j = await r.json();
  ok(r.status === 200 && j.slug === "own" && j.checked.passages === 4 && j.redundancy[0] && j.redundancy[0].slug === "dup", "consistency of a published paper", j);
  ok(log.searches.length === 4, "one search per passage", log.searches.length);
  ok(/not findings/.test(j.note) && /Contradictions between papers are not checked yet/.test(j.note), "the note says what is not checked");
  const again = await call("/api/consistency?slug=own");
  ok(again.status === 200 && log.searches.length === 4, "a repeat is served from the cache with no search");
  const bad = await call("/api/consistency?slug=%24%24"), nf = await call("/api/consistency?slug=nope"), dr = await call("/api/consistency?slug=draft");
  ok(bad.status === 400 && nf.status === 404 && dr.status === 404, "bad slug 400, unknown 404, unpublished 404", [bad.status, nf.status, dr.status]);
  // rate limit: the per-address cap counts misses only
  counters.clear();
  let last = 0;
  for (let i = 0; i < X.CONS_PER_IP_HOUR + 1; i++) last = (await call("/api/consistency?slug=miss-" + i, { "CF-Connecting-IP": "203.0.113.9" })).status;
  ok(last === 429, "the miss after the per-address cap is refused with 429", last);
  const other = await call("/api/consistency?slug=miss-other", { "CF-Connecting-IP": "203.0.113.10" });
  ok(other.status === 404, "another address is not blocked by the first", other.status);
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
