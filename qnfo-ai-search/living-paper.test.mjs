// LIVING-PAPER-1 (qnfo-ai-search 2.16.0, roadmap row 31 RM-VISION-LIVING-PAPER-1, charter pillar: research) offline suite.
// No network: the paper gateway, the rate-limit table and the edge cache are stubbed in the worker's own sandbox, and the page script runs
// against a small fake DOM.
// Proves: /api/paper returns one published paper (front matter removed, authors read from a JSON string, provenance kept), refuses a bad slug
// (400), an unknown or unpublished paper (404), caches a 200 and rate limits misses per address; /paper and /paper/<slug> serve the page with
// its marker and a per-paper canonical link, load only the pinned KaTeX files (with integrity hashes), and write paper text with textContent only;
// the page script turns Markdown into the right nodes (headings, a display equation inside a paragraph splits it, inline math, a currency dollar
// is not math, tables keep a pipe inside math, lists, code), builds the plain-language question for an equation from the sentences around it,
// and the event-stream reader hands meta, token, done and error events to the page.
// Run: node --no-warnings qnfo-ai-search/living-paper.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
import vm from "node:vm";

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x) : "")); } };
const raw = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const src = raw.replace(/^export \{[^}]*\};?\s*$/m, "").replace(/^import [^;]*;/mg, "");

const cacheMap = new Map();
const caches = { default: { match: async (r) => { const h = cacheMap.get(r.url); return h ? h.clone() : undefined; }, put: async (r, res) => { cacheMap.set(r.url, res); } } };
const PAPERS = {
  live: { slug: "live", title: "A Live Paper On Trees", status: "published", abstract: "An abstract.", authors: "[\"A. Author\",\"B. Author\"]", doi: null, version_semver: "1.2.0", first_published_at: "2026-11-04", last_revised_at: "2026-11-05", license: "QNFO-ULA", _prov: { basis: "created by a fleet pipeline; no human review is recorded" }, body_md: "---\ntitle: x\n---\n# A Live Paper On Trees\n\n## Abstract\n\nThe strong triangle inequality\n$$\nd(x,z) \\le \\max\\{d(x,y), d(y,z)\\}\n$$\nholds for the tree distance $d$ and costs $5 and $10 each.\n" },
  dist: { slug: "dist", title: "A Distributed Paper", status: "distributed", body_md: "# A Distributed Paper\n\nText." },
  prepr: { slug: "prepr", title: "An External Preprint", status: "external_preprint", body_md: "# An External Preprint\n\nText." },
  retracted: { slug: "retracted", title: "A Retracted Paper", status: "retracted", body_md: "# A Retracted Paper" },
  draft: { slug: "draft", title: "A Draft", status: "draft", abstract: "x", body_md: "# A Draft" },
  big: { slug: "big", title: "A Big Paper", status: "published", body_md: "x".repeat(400000) },
};
let upstream = 0;
async function gateway(url) {
  const u = new URL(String(url));
  upstream++;
  const resp = (j, s) => ({ ok: (s || 200) < 400, status: s || 200, json: async () => j });
  if (u.hostname === "papers.qnfo.org" && u.pathname.startsWith("/papers/")) { const s = decodeURIComponent(u.pathname.slice(8)); return PAPERS[s] ? resp(PAPERS[s]) : resp({ error: "nf" }, 404); }
  return resp({}, 404);
}
const counters = new Map();
const QNFO_AUDIT = { prepare(sql) { const s = { bind(k) { s.k = k; return s; }, async first() { if (/INSERT INTO ask_rate/.test(sql)) { const n = (counters.get(s.k) || 0) + 1; counters.set(s.k, n); return { n }; } return null; }, async run() { return { success: true }; }, async all() { return { results: [] }; } }; return s; } };
const sb = { console: { log() {}, error() {}, warn() {} }, Date, JSON, Math, Number, String, RegExp, Set, Map, Array, Object, Promise, URL, URLSearchParams, Response, Request, Headers, TextEncoder, AbortController, setTimeout, clearTimeout, crypto, fetch: gateway, encodeURIComponent, decodeURIComponent, caches, AbortSignal };
vm.createContext(sb);
vm.runInContext(src + "\n__x = { worker_default, paperView, PAPER_PAGE, LIVING_LIB, LIVING_CSS, PAPER_VIEW_PER_IP_HOUR, PAPER_BODY_CHARS };", sb);
const X = sb.__x;
const env = { GATEWAY: { fetch: (u, o) => gateway(u, o) }, QNFO_AUDIT };
const pending = [];
const call = (path, headers) => X.worker_default.fetch(new Request("https://ask.qwav.org" + path, { headers: headers || {} }), env, { waitUntil: (p) => pending.push(p) });

// 1. the paper record
{
  const r = await call("/api/paper?slug=live"), j = await r.json();
  ok(r.status === 200 && j.slug === "live" && j.title === "A Live Paper On Trees", "a published paper is returned", j.title);
  ok(Array.isArray(j.authors) && j.authors.join("|") === "A. Author|B. Author", "authors are read from a JSON string", j.authors);
  ok(!/^---/.test(j.body_md) && /^# A Live Paper On Trees/.test(j.body_md), "front matter is removed", j.body_md.slice(0, 30));
  ok(j.version === "1.2.0" && j.published === "2026-11-04" && j.license === "QNFO-ULA" && j.url === "https://papers.qnfo.org/papers/live", "version, date, licence and address are carried");
  ok(/no human review is recorded/.test(j.provenance), "the recorded provenance is carried so the page can state it", j.provenance);
  ok(r.headers.get("cache-control") === "public, max-age=3600", "a 200 is cacheable for an hour");
  await Promise.all(pending.splice(0));
  const before = upstream;
  const again = await call("/api/paper?slug=live");
  ok(again.status === 200 && upstream === before, "a repeat is served from the cache with no upstream read");
  const bad = await call("/api/paper?slug=%24%24"), nf = await call("/api/paper?slug=nope"), dr = await call("/api/paper?slug=draft");
  ok(bad.status === 400 && nf.status === 404 && dr.status === 404, "bad slug 400, unknown 404, unpublished 404", [bad.status, nf.status, dr.status]);
  const big = await (await call("/api/paper?slug=big")).json();
  ok(big.truncated === true && big.body_md.length === X.PAPER_BODY_CHARS, "a very long paper is cut and says so");
  const dist = await call("/api/paper?slug=dist"), prepr = await call("/api/paper?slug=prepr"), ret = await call("/api/paper?slug=retracted");
  ok(dist.status === 200 && prepr.status === 200 && ret.status === 404, "distributed papers and external preprints are readable, a retracted paper is not", [dist.status, prepr.status, ret.status]);
  // a bad slug is refused before the cache and before the counters: it cannot use up the shared hourly budget
  counters.clear();
  const upBefore = upstream;
  for (let i = 0; i < 5; i++) await call("/api/paper?slug=%24%24" + i, { "CF-Connecting-IP": "203.0.113.50" });
  ok(counters.size === 0 && upstream === upBefore, "a bad slug writes no counter and reads nothing upstream", [counters.size, upstream - upBefore]);
  await call("/api/paper?slug=unknown-twice");
  await Promise.all(pending.splice(0));
  const upMid = upstream;
  const nf2 = await call("/api/paper?slug=unknown-twice");
  ok(nf2.status === 404 && upstream === upMid && nf2.headers.get("cache-control") === "public, max-age=60", "an unknown paper is remembered for a minute, so a repeat reads nothing upstream", nf2.headers.get("cache-control"));
  counters.clear();
  let last = 0;
  for (let i = 0; i < X.PAPER_VIEW_PER_IP_HOUR + 1; i++) last = (await call("/api/paper?slug=miss-" + i, { "CF-Connecting-IP": "203.0.113.9" })).status;
  ok(last === 429, "the miss after the per-address cap is refused with 429", last);
  const other = await call("/api/paper?slug=miss-other", { "CF-Connecting-IP": "203.0.113.10" });
  ok(other.status === 404, "another address is not blocked by the first", other.status);
}
// 2. the pages
{
  const a = await call("/paper"), at = await a.text();
  ok(a.status === 200 && /data-page="living-paper"/.test(at) && /<title>Living paper/.test(at), "the picker page and its marker");
  const b = await call("/paper/live"), bt = await b.text();
  ok(b.status === 200 && /rel="canonical" href="https:\/\/ask\.qwav\.tech\/paper\/live"/.test(bt), "a paper page has its own canonical address");
  const none = await call("/paper/A"), none2 = await call("/paper/live/extra");
  ok(none.status === 404 && none2.status === 404, "a malformed paper address is a 404", [none.status, none2.status]);
  ok(b.headers.get("x-frame-options") === "DENY" && b.headers.get("x-content-type-options") === "nosniff", "the page carries the security headers");
  const scripts = [...bt.matchAll(/<script[^>]*\ssrc="([^"]+)"[^>]*>/g)].map((m) => m[0]);
  ok(scripts.length === 1 && /cdnjs\.cloudflare\.com\/ajax\/libs\/KaTeX\/0\.16\.47\/katex\.min\.js/.test(scripts[0]) && /integrity="sha384-[A-Za-z0-9+/=]+"/.test(scripts[0]) && /crossorigin="anonymous"/.test(scripts[0]), "the only script loaded from elsewhere is the pinned KaTeX file with an integrity hash", scripts);
  const links = [...bt.matchAll(/<link[^>]*rel="stylesheet"[^>]*>/g)].map((m) => m[0]).filter((l) => /katex/.test(l));
  ok(links.length === 1 && /integrity="sha384-/.test(links[0]), "the KaTeX style sheet is pinned with an integrity hash", links);
  ok(!/innerHTML|insertAdjacentHTML|document\.write|eval\(|outerHTML/.test(bt), "the page writes paper text with textContent and node calls only");
  ok(/prefers-color-scheme:dark/.test(bt) && /:focus-visible/.test(bt) && /name="viewport"/.test(bt), "the page has dark mode, focus style and viewport");
  ok(!/vector|pipeline|supplied summary|grounding/i.test(bt.replace(/<script[\s\S]*?<\/script>/g, "")), "reader text has no pipeline talk");
  ok(/not part of it|not part of the paper/.test(bt), "the page says the explanations are not part of the paper");
  const robots = await (await call("/robots.txt")).text(), sm = await (await call("/sitemap.xml")).text(), h = await (await call("/health")).json();
  ok(/Disallow: \/api\/paper/.test(robots), "robots keeps crawlers off the paper route");
  ok(/ask\.qwav\.tech\/paper</.test(sm), "sitemap lists the picker page");
  ok(h.capabilities.includes("living-paper"), "health lists the capability");
  const nav = await (await call("/concepts")).text();
  ok(/href="\/paper"[^>]*>Read</.test(nav), "the other pages link to the reader");
}
// 3. the page script against a fake DOM
class FNode {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.parentNode = null; this._text = ""; this.listeners = {}; this.hidden = false; this.id = ""; this.value = ""; }
  get nodeType() { return this.tag === "#text" ? 3 : 1; }
  get firstChild() { return this.children[0] || null; }
  get nextSibling() { if (!this.parentNode) return null; const a = this.parentNode.children; return a[a.indexOf(this) + 1] || null; }
  get previousSibling() { if (!this.parentNode) return null; const a = this.parentNode.children; return a[a.indexOf(this) - 1] || null; }
  appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; }
  insertBefore(c, ref) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; if (!ref) this.children.push(c); else this.children.splice(this.children.indexOf(ref), 0, c); return c; }
  replaceChild(n, o) { const i = this.children.indexOf(o); this.children[i] = n; n.parentNode = this; o.parentNode = null; return o; }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === "id") this.id = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  set textContent(t) { this.children.forEach((c) => { c.parentNode = null; }); this.children = []; if (t !== "") { const n = new FNode("#text"); n._text = String(t); n.parentNode = this; this.children.push(n); } }
  get textContent() { return this.tag === "#text" ? this._text : this.children.map((c) => c.textContent).join(""); }
  get classList() { const s = this; return { contains: (c) => (s.attrs.class || "").split(/\s+/).includes(c) }; }
  addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
  contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }
  scrollIntoView() {}
  walk(fn) { fn(this); this.children.forEach((c) => c.walk && c.walk(fn)); }
  all(tag) { const out = []; this.walk((n) => { if (n !== this && n.tag === tag) out.push(n); }); return out; }
}
const ids = {};
for (const id of ["body", "pick", "doc", "slugl", "pt", "pm", "pv", "howto", "askf", "ans", "aq", "exsel", "selmsg", "lorig", "lcons", "f", "q", "results"]) { const n = new FNode("div"); n.id = id; ids[id] = n; }
const docParent = new FNode("article"); docParent.appendChild(ids.body);
const fakeDoc = { createElement: (t) => new FNode(t), createTextNode: (t) => { const n = new FNode("#text"); n._text = String(t); return n; }, getElementById: (id) => ids[id] || null, querySelector: () => null, addEventListener() {} };
const scriptM = X.PAPER_PAGE.match(/<script>\n\(function\(\)\{\n([\s\S]*)\}\)\(\);\n<\/script>/);
ok(!!scriptM, "the page has one inline script");
const pageJs = scriptM[1].replace("if(SLUG)load();", "__pg={renderDoc:renderDoc,ctxFor:ctxFor,topBlock:topBlock,inline:inline,answerText:answerText,streamAsk:streamAsk,mathEl:mathEl,lastSent:lastSent,firstSent:firstSent,explainMath:explainMath};");
const sb2 = { document: fakeDoc, window: { getSelection: () => null }, location: { pathname: "/paper" }, fetch: null, console, JSON, RegExp, String, Array, Object, Math, Promise, setTimeout, encodeURIComponent, Event: class {}, TextDecoder, __pg: null };
vm.createContext(sb2);
vm.runInContext(pageJs, sb2);
const PG = sb2.__pg;
ok(PG && typeof PG.renderDoc === "function", "the page script runs and exposes its readers");
{
  const md = [
    "# A Live Paper On Trees", "", "## Abstract", "",
    "The strong triangle inequality", "$$", "d(x,z) \\le \\max\\{d(x,y), d(y,z)\\}", "$$",
    "holds for the tree distance $d$ and costs $5 and $10 each, with **bold** and `code` and a [link](https://example.org/x).", "",
    "### Results", "", "- first item with $x^2$", "- second item", "  continued here", "", "1. one", "2. two", "",
    "| a | b |", "|---|---|", "| $|x|$ | 2 |", "", "```python", "print(1)", "```", "", "> a quote", "", "\\[ E = mc^2 \\]", "", "Last paragraph.",
  ].join("\n");
  PG.renderDoc(md);
  const body = ids.body, tags = body.children.map((c) => c.tag);
  ok(tags.join(",") === "h2,p,div,p,h3,ul,ol,div,pre,blockquote,div,p", "block order: heading, paragraph, display equation, paragraph, heading, lists, table, code, quote, bracket equation, paragraph", tags);
  ok(body.children[0].tag === "h2" && body.children[0].textContent === "Abstract", "the title heading is dropped and the first section is an h2");
  const eq = body.children[2];
  ok(eq.__disp === true && /d\(x,z\)/.test(eq.__tex) && eq.attrs.role === "button" && eq.attrs.tabindex === "0", "a display equation is a focusable button with its TeX kept", eq.__tex);
  const p2 = body.children[3], maths = []; p2.walk((n) => { if (n.__tex !== undefined) maths.push(n.__tex); });
  ok(maths.length === 1 && maths[0] === "d", "inline math is found, and the currency dollars are not math", maths);
  ok(/costs \$5 and \$10 each/.test(p2.textContent), "the currency text is kept as text");
  ok(p2.all("strong").length === 1 && p2.all("code").length === 1 && p2.all("a").length === 1 && p2.all("a")[0].attrs.href === "https://example.org/x", "bold, code and an https link become nodes");
  ok(body.children[5].children.length === 2 && /second item continued here/.test(body.children[5].children[1].textContent), "a bullet list keeps a continued line in its item");
  ok(body.children[6].tag === "ol" && body.children[6].children.length === 2, "a numbered list");
  const tbl = body.children[7].all("table")[0], cells = tbl.all("td");
  ok(cells.length === 2 && cells[0].children.some((c) => c.__tex === "|x|"), "a pipe inside math stays in its cell", cells.length);
  ok(body.children[8].all("code")[0].textContent === "print(1)", "a code fence is kept as text");
  ok(body.children[10].__disp === true && body.children[10].__tex.trim() === "E = mc^2", "a bracket equation on one line is a display equation");
  // the question built for an equation: the sentence before, the equation, the sentence after when it starts with a cue word
  const ctx = PG.ctxFor(eq);
  ok(/^The strong triangle inequality \$\$d\(x,z\)/.test(ctx) && /holds for the tree distance/.test(ctx) === false, "an equation's context is the sentence before it and the equation (the next paragraph does not start with a cue word)", ctx);
  ok(!/"/.test(ctx), "the quoted span holds no quote mark");
  const inlineCtx = PG.ctxFor((() => { let f; p2.walk((n) => { if (n.__tex === "d") f = n; }); return f; })());
  ok(/holds for the tree distance \$d\$/.test(inlineCtx), "an inline equation's context is its own paragraph", inlineCtx);
  ok(PG.firstSent("where d is the distance and p is a prime. Next sentence.") === "where d is the distance and p is a prime.", "a following sentence that starts with where is taken");
  ok(PG.firstSent("Next paragraph starts here.") === "", "any other following sentence is not");
  ok(PG.lastSent("An earlier sentence that is done. The sentence that introduces the equation is this one here, long enough") === "The sentence that introduces the equation is this one here, long enough", "only the last sentence before an equation is used");
  const box = new FNode("div");
  PG.answerText(box, "First paragraph with $x$.\n\n- point one\n- point two\n\nFOLLOWUPS: a? b?");
  ok(box.children.length === 2 && box.children[0].tag === "p" && box.children[1].tag === "ul" && !/FOLLOWUPS/.test(box.textContent), "an answer becomes paragraphs and a list, without the follow-up tail", box.children.map((c) => c.tag));
}
// 4. the event-stream reader
{
  // tapping an equation asks the pinned paper to say, in words, what the equation says; the answer lands in a panel after the equation
  let asked = null;
  sb2.fetch = async (u, o) => { asked = JSON.parse(o.body); return new Response("event: token\ndata: {\"t\":\"It says the distance is at most the larger of two.\"}\n\nevent: done\ndata: {\"followups\":[]}\n\n", { status: 200, headers: { "content-type": "text/event-stream" } }); };
  const eqNode = ids.body.children[2];
  PG.explainMath(eqNode);
  await new Promise((r) => setTimeout(r, 400));
  ok(!!asked, "tapping an equation posts a question");
  ok(asked && /^Explain in plain language what this equation says in words: "The strong triangle inequality \$\$d\(x,z\)/.test(asked.query), "the question names the equation and quotes the sentence around it", asked && asked.query);
  const panelNode = ids.body.children[3];
  ok(panelNode && /explain/.test(panelNode.attrs.class || "") && /at most the larger of two/.test(panelNode.textContent), "the explanation is shown in a panel right after the equation", panelNode && panelNode.attrs);
  // a second tap while the first answer is still arriving replaces it: the first answer's late text never reaches the page
  let n = 0;
  sb2.fetch = async () => {
    n++;
    const mine = n, enc = new TextEncoder();
    const stream = new ReadableStream({ async start(c) { if (mine === 1) await new Promise((r) => setTimeout(r, 150)); c.enqueue(enc.encode("event: token\ndata: {\"t\":\"" + (mine === 1 ? "STALE" : "FRESH") + "\"}\n\nevent: done\ndata: {\"followups\":[]}\n\n")); c.close(); } });
    return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  PG.explainMath(eqNode);
  const firstPanel = ids.body.children[3];
  PG.explainMath(eqNode);
  const secondPanel = ids.body.children[3];
  await new Promise((r) => setTimeout(r, 700));
  ok(firstPanel !== secondPanel && /FRESH/.test(secondPanel.textContent) && !/STALE/.test(firstPanel.textContent + secondPanel.textContent), "a newer tap replaces the answer still arriving", [firstPanel.textContent.slice(0, 60), secondPanel.textContent.slice(0, 60)]);
}
{
  const seen = [];
  const sse = "event: status\ndata: {\"stage\":\"retrieving\"}\n\nevent: meta\ndata: {\"sources\":[{\"n\":1,\"title\":\"T\"}]}\n\nevent: token\ndata: {\"t\":\"Hello \"}\n\nevent: token\ndata: {\"t\":\"there\"}\n\nevent: done\ndata: {\"followups\":[\"Why?\"]}\n\n";
  let posted = null;
  sb2.fetch = async (u, o) => { posted = { u, body: JSON.parse(o.body) }; return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } }); };
  await new Promise((res) => PG.streamAsk("Explain \"x\" in plain language", "live", [{ q: "a", a: "b" }], { meta: (d) => seen.push("meta:" + d.sources.length), token: (d) => seen.push("t:" + d.t), done: (d) => seen.push("done:" + d.followups.length), error: (d) => seen.push("error:" + d.error), end: () => { seen.push("end"); res(); } }));
  ok(posted.u === "/api/ask" && posted.body.paper === "live" && posted.body.query.startsWith("Explain ") && posted.body.history.length === 1, "the question goes to /api/ask with the paper pinned", posted);
  ok(seen.join(",") === "meta:1,t:Hello ,t:there,done:1,end", "meta, tokens and done reach the page in order, then end", seen);
  sb2.fetch = async () => new Response(JSON.stringify({ error: "limit reached" }), { status: 429, headers: { "content-type": "application/json" } });
  const seen2 = [];
  await new Promise((res) => PG.streamAsk("q q q", "live", [], { error: (d) => seen2.push(d.error), end: res }));
  ok(seen2.join() === "limit reached", "a JSON error from the route is shown to the reader", seen2);
}
// 5. cases an independent reader found: nested emphasis, parenthesised link addresses, loose and numbered lists, hard-wrapped paragraphs, currency in a table, panels between blocks
{
  const clearBody = () => { ids.body.children.slice().forEach((c) => ids.body.removeChild(c)); };
  const render = (md) => { clearBody(); PG.renderDoc(md); return ids.body.children; };
  let c = render("**bold *and* italic** and ***both*** and [w](https://en.wikipedia.org/wiki/Foo_(bar)) end.");
  const strongs = c[0].all("strong");
  ok(c.length === 1 && strongs.length === 2 && strongs[0].all("em").length === 1 && strongs[1].all("em").length === 1, "nested emphasis becomes nested nodes, not stray asterisks", c[0].textContent);
  ok(c[0].all("a")[0].attrs.href === "https://en.wikipedia.org/wiki/Foo_(bar)" && !/\)\s*end/.test(c[0].textContent) && /end\.$/.test(c[0].textContent), "a link address with parentheses is taken whole", c[0].all("a")[0].attrs.href);
  c = render("1. one\n\n2. two\n\n3. three");
  ok(c.length === 1 && c[0].tag === "ol" && c[0].children.length === 3, "a numbered list separated by blank lines is one list", c.map((x) => x.tag));
  c = render("5. five\n6. six");
  ok(c[0].attrs.start === "5", "a numbered list that starts at 5 keeps its number");
  c = render("Let $a\n+ b$ be large");
  let mm = []; c[0].walk((n) => { if (n.__tex !== undefined) mm.push(n.__tex); });
  ok(c.length === 1 && c[0].tag === "p" && mm.join() === "a + b", "a plus sign at the start of a wrapped line inside unfinished math stays in the paragraph", [c.map((x) => x.tag), mm]);
  c = render("The paper appeared in\n2019. It showed");
  ok(c.length === 1 && c[0].tag === "p", "a year with a full stop at the start of a wrapped line is not a list", c.map((x) => x.tag));
  c = render("So we get $$a = b\n$$ and more.");
  mm = []; c[0].walk((n) => { if (n.__tex !== undefined) mm.push(n.__tex.trim()); });
  ok(c.length === 1 && c[0].tag === "p" && mm.join() === "a = b", "a wrapped display equation inside a sentence closes where it ends", [c.map((x) => x.tag), mm]);
  c = render("| $5 | $10 |\n|---|---|\n| a | b |");
  ok(c[0].all("th").length === 2 && c[0].all("td").length === 2, "currency dollars in a table row do not merge its cells", [c[0].all("th").length, c[0].all("td").length]);
  // a panel between a sentence and its equation does not hide the sentence
  clearBody();
  PG.renderDoc("The sentence that introduces the equation is this one here, long enough to count.\n\n$$a=b$$\n\nSecond.");
  const eqA = ids.body.children[1];
  ids.body.insertBefore(Object.assign(new FNode("div"), { attrs: { class: "explain" } }), eqA);
  ok(/The sentence that introduces the equation/.test(PG.ctxFor(eqA)), "an open explanation between a sentence and its equation does not cost the equation its sentence", PG.ctxFor(eqA));
  ok(/\[hidden\]\{display:none!important\}/.test(X.LIVING_CSS), "the hidden attribute wins over the display rules");
  // the sources the server shows with a refusal reach the page
  let seenQuery = null;
  sb2.fetch = async (u, o) => { seenQuery = JSON.parse(o.body); return new Response("event: meta\ndata: {\"sources\":[{\"n\":1,\"title\":\"A Source\",\"url\":\"https://papers.qnfo.org/papers/a-source\"}]}\n\nevent: error\ndata: {\"error\":\"This address has asked 12 questions this hour.\"}\n\n", { status: 200, headers: { "content-type": "text/event-stream" } }); };
  PG.explainMath(eqA);
  await new Promise((r) => setTimeout(r, 400));
  const shown = ids.body.children.find((x) => /explain/.test(x.attrs.class || "") && x.all("strong").length);
  ok(shown && /asked 12 questions/.test(shown.textContent) && /Sources: \[1\] A Source/.test(shown.textContent), "a refused answer still shows the sources", shown && shown.textContent.slice(0, 200));
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
