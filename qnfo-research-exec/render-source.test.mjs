// RENDER-SOURCE-1 (qnfo-research-exec 0.53.0, roadmap row 42 RM-RESEARCH-BROWSER-QUEUES-1, charter pillar: research) offline suite.
// Runs the real worker source in this process with Browser Run replaced by a fake renderer. Proves: only an arXiv or ar5iv HTML address of the form the pipeline builds
// can reach the browser; a missing binding, an address outside the allowlist, an exhausted per-run budget and ops_config ground_render = off each stop a render with a
// named reason and no browser launch; a render is a ground-render ledger row; arxivFullText falls back to a render only when the plain page answered but held too
// little text, and rendered text has to pass the same minimum (a page that stays thin is still dropped, CITE-FULLTEXT-1); without a renderer nothing changes;
// GET /render-check renders one fixed page, answers 503 with the reason when it cannot, and stores a good answer so a second request renders nothing.
// Run: node --no-warnings qnfo-research-exec/render-source.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { Buffer } from "node:buffer";

let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d !== undefined ? " -- " + JSON.stringify(d) : "")); } };
const raw = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const src = raw.replace(/^import [^;]*;/mg, "").replace(/^export \{[^}]*\};?\s*$/m, "").replace(/^export (?=async function|function|const|let|var|class)/mg, "");
globalThis.__ErrataBuffer = Buffer;
const cacheStore = new Map();
globalThis.caches = { default: { async match(r) { const e = cacheStore.get(r.url); return e ? e.clone() : undefined; }, async put(r, res) { cacheStore.set(r.url, res); } } };
vm.runInThisContext(src + "\n;globalThis.__w = { worker_default, renderedSourceText, arxivFullText, attachFullTexts, RENDER_ALLOW, RENDER_PER_RUN, FULLTEXT_MIN_CHARS };");
const W = globalThis.__w;

const section = (h, n) => "<h2>" + h + "</h2><p>" + "Plain words about the measurement and its boundary. ".repeat(n) + "</p>";
const RICH = "<html><body><article>" + section("Introduction", 20) + section("Method", 20) + section("Results", 20) + "</article></body></html>";
const THIN = "<html><body><article>" + section("Introduction", 3) + "</article></body></html>";
const SHELL = "<html><body><div id='app'></div><script>" + "x".repeat(400) + "</script></body></html>";

const events = [];
const flags = new Map();
const mkEnv = (extra) => Object.assign({ QNFO_AUDIT: { prepare(sql) { const s = { bind(...a) { s.a = a; return s; }, async first() { if (/FROM ops_config/.test(sql)) return flags.has("ground_render") ? { value: flags.get("ground_render") } : null; return null; }, async run() { if (/INSERT INTO cloud_ops_events/.test(sql)) events.push({ kind: s.a[2], text: s.a[3], status: s.a[6] }); return { success: true }; }, async all() { return { results: [] }; } }; return s; } } }, extra || {});
let launches = [];
globalThis.erratapublishMod = { renderSourceHtml: async (env, url, ms) => { launches.push({ url, ms }); if (globalThis.__renderMode === "throw") throw new Error("browser quota"); return globalThis.__renderMode === "thin" ? THIN : RICH; } };
globalThis.__renderMode = "rich";

// 1. gates
{
  let r = await W.renderedSourceText(mkEnv({}), "https://arxiv.org/html/2601.00001", { budget: { left: 2 } });
  ok(r.ok === false && r.reason === "no-binding" && launches.length === 0, "no Browser binding: no render", r);
  const env = mkEnv({ BROWSER: {} });
  for (const bad of ["https://evil.example/page", "http://arxiv.org/html/2601.00001", "https://arxiv.org/pdf/2601.00001", "https://arxiv.org/html/2601.00001?x=1", "https://arxiv.org.evil.example/html/abc123", "file:///etc/passwd", "https://ar5iv.labs.arxiv.org/html/"]) {
    r = await W.renderedSourceText(env, bad, { budget: { left: 2 } });
    ok(r.ok === false && r.reason === "address-not-allowed", "not rendered: " + bad, r);
  }
  ok(launches.length === 0, "no browser was launched for any refused address", launches);
  const b = { left: 1 };
  r = await W.renderedSourceText(env, "https://arxiv.org/html/2601.00001", { budget: b, rid: "row-a" });
  ok(r.ok === true && r.chars > 1000 && b.left === 0 && launches.length === 1 && launches[0].ms === 25000, "an allowed address renders and spends the budget", { ok: r.ok, left: b.left, launches });
  r = await W.renderedSourceText(env, "https://ar5iv.labs.arxiv.org/html/1706.03762", { budget: b });
  ok(r.ok === false && r.reason === "budget" && launches.length === 1, "an exhausted budget stops the next render");
  flags.set("ground_render", "off");
  r = await W.renderedSourceText(env, "https://arxiv.org/html/2601.00002", { budget: { left: 2 } });
  ok(r.ok === false && r.reason === "switched-off" && launches.length === 1, "ops_config ground_render = off stops it");
  flags.delete("ground_render");
  globalThis.__renderMode = "throw";
  r = await W.renderedSourceText(env, "https://arxiv.org/html/2601.00003", { budget: { left: 2 }, rid: "row-b" });
  ok(r.ok === false && r.reason === "render-error" && /browser quota/.test(r.error), "a browser failure is a named reason, never a throw", r);
  globalThis.__renderMode = "rich";
  const ledger = events.filter((e) => e.kind === "ground-render");
  ok(ledger.length === 2 && /row=row-a url=https:\/\/arxiv\.org\/html\/2601\.00001 ok=1 html_chars=\d+ ms=\d+/.test(ledger[0].text) && ledger[0].status === "ok", "the render is a ledger row", ledger[0]);
  ok(/row=row-b .* ok=0 error=browser quota/.test(ledger[1].text) && ledger[1].status === "warn", "a failed render is a warn row", ledger[1]);
}
// 2. arxivFullText falls back to a render only for a page that answered with too little text
{
  const page = (html) => async () => new Response(html, { status: 200 });
  const base = { spacingMs: 0 };
  const rendered = [];
  const render = async (u) => { rendered.push(u); return { ok: true, html: RICH }; };
  let r = await W.arxivFullText("2601.00004", Object.assign({}, base, { fetch: page(RICH), render }));
  ok(r.ok === true && !r.rendered && rendered.length === 0, "a page with enough text is read as before, no render", r);
  r = await W.arxivFullText("2601.00004", Object.assign({}, base, { fetch: page(SHELL), render }));
  ok(r.ok === true && r.rendered === true && rendered.length === 1 && /^https:\/\/arxiv\.org\/html\/2601\.00004$/.test(rendered[0]) && r.chars >= W.FULLTEXT_MIN_CHARS, "a shell page is rendered and read", r);
  rendered.length = 0;
  r = await W.arxivFullText("2601.00005", Object.assign({}, base, { fetch: page(SHELL), render: async (u) => { rendered.push(u); return { ok: true, html: THIN }; } }));
  ok(r.ok === false && rendered.length === 2, "rendered text that is still thin is dropped, after both hosts were tried", { r, rendered });
  rendered.length = 0;
  r = await W.arxivFullText("2601.00006", Object.assign({}, base, { fetch: page(SHELL) }));
  ok(r.ok === false && rendered.length === 0, "without a renderer nothing changes");
  r = await W.arxivFullText("2601.00007", Object.assign({}, base, { fetch: async () => new Response("Not Found", { status: 404 }), render }));
  ok(r.ok === false && rendered.length === 0, "a missing page (404) is never rendered");
  r = await W.arxivFullText("2601.00008", Object.assign({}, base, { fetch: page(SHELL), render: async () => ({ ok: false, reason: "budget" }) }));
  ok(r.ok === false, "a refused render leaves the source dropped");
  // attachFullTexts counts renders
  rendered.length = 0;
  const bib = [{ n: 1, id: "arXiv:2601.00009", text: "arXiv:2601.00009 | A title\n  An abstract." }];
  const at = await W.attachFullTexts(bib, Object.assign({}, base, { fetch: page(SHELL), render }));
  ok(at.bib.length === 1 && at.stat.rendered === 1 && at.stat.arxiv === 1, "the stat counts a rendered source", at.stat);
}
// 3. diagnostic route
{
  launches.length = 0; cacheStore.clear();
  const ctx = { waitUntil(p) { if (p && p.catch) p.catch(() => {}); return p; } };
  let res = await W.worker_default.fetch(new Request("https://research-exec.qnfo.org/render-check"), mkEnv({}), ctx);
  let j = await res.json();
  ok(res.status === 503 && j.ok === false && j.reason === "no-binding" && res.headers.get("cache-control") === "no-store", "without the binding the check answers 503 with the reason", j);
  const env = mkEnv({ BROWSER: {} });
  res = await W.worker_default.fetch(new Request("https://research-exec.qnfo.org/render-check?url=https://evil.example/"), env, ctx);
  j = await res.json();
  ok(res.status === 200 && j.ok === true && j.page === "https://ar5iv.labs.arxiv.org/html/1706.03762" && j.sections >= 3 && j.section_chars >= 1500 && j.first_heading === "Introduction" && launches.length === 1 && launches[0].url === j.page, "it renders the one fixed page whatever the query says", { j, launches });
  await new Promise((r) => setImmediate(r));
  res = await W.worker_default.fetch(new Request("https://research-exec.qnfo.org/render-check?x=1"), env, ctx);
  j = await res.json();
  ok(res.status === 200 && j.ok === true && launches.length === 1, "a second request is served from the stored answer with no render", launches.length);
  const h = await (await W.worker_default.fetch(new Request("https://research-exec.qnfo.org/health"), env, ctx)).json();
  ok(h.capabilities.includes("ground-render"), "health lists the capability");
}
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
