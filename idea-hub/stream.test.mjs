// IDEA-STREAM-1 (idea-hub 1.18.0, roadmap row 113 RM-IDEA-STREAM-UI-1, charter pillar: reach) offline suite.
// Drives the real worker for GET /stream, the home link, /health and the cache path, and runs the page script in a sandbox with a small fake DOM and a fake feed.
// Proves: /stream is a static page served through the same cache as the other pages (no D1 read), carries its marker, a no-script fallback to the home page and the RSS feed,
// and polls the existing public feed /api/feed (so it can show nothing the feed does not); the pure merge keeps one row per id, newest first, at most 60, and marks
// items that arrive after the first load as new; rel() words are right; titles are written with textContent only (an HTML-looking title stays text); polling backs off
// after a failed feed read and recovers; a hidden page does not fetch.
// Run: node --no-warnings idea-hub/stream.test.mjs   -> prints "N passed, 0 failed"
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";
const here = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x) : "")); } };
let reads = 0;
const stmt = { bind() { return stmt; }, async all() { reads++; return { results: [] }; }, async first() { reads++; return null; }, async run() { return {}; } };
const env = { QNFO_AUDIT: { prepare: () => stmt } };
const store = new Map();
globalThis.caches = { default: { async match(r) { const e = store.get(r.url); return e ? new Response(e.b, { headers: e.h }) : undefined; }, async put(r, res) { store.set(r.url, { b: await res.text(), h: new Headers(res.headers) }); } } };
const w = (await import(pathToFileURL(join(here, "worker.js")).href)).default;
const waits = [], ctx = { waitUntil(p) { waits.push(p); } };
const get = async (path) => { const r = await w.fetch(new Request("https://ideas.qnfo.org" + path), env, ctx); return { r, t: await r.text() }; };

// 1. the page
const a = await get("/stream");
ok(a.r.status === 200 && /text\/html/.test(a.r.headers.get("Content-Type")), "GET /stream answers 200 HTML", a.r.status);
ok(/data-page="idea-stream"/.test(a.t) && /id="st-l"/.test(a.t) && /The idea stream/.test(a.t), "marker, list and heading");
ok(/<noscript>[\s\S]*href="\/"[\s\S]*href="\/rss\.xml"[\s\S]*<\/noscript>/.test(a.t), "a no-script fallback points at the home page and the RSS feed");
ok(/fetch\("\/api\/feed\?limit=40"/.test(a.t), "the page reads the existing public feed");
ok(!/innerHTML|insertAdjacentHTML|document\.write|eval\(/.test(a.t.replace(/<script src[^>]*><\/script>/g, "")), "no raw HTML insertion in the page script");
ok(/rel="canonical" href="https:\/\/ideas\.qnfo\.org\/stream"/.test(a.t), "canonical address");
const mine = a.t.slice(a.t.indexOf('<section class="q-hero"'), a.t.indexOf("</noscript>")).replace(/<script[\s\S]*?<\/script>/g, "");
ok(mine.length > 500 && !/pipeline|grounding|supplied summary|model wrote|the model/i.test(mine), "the stream's own reader text has no pipeline talk", mine.length);
const readsAfterFirst = reads;
const b = await get("/stream");
ok(b.r.status === 200 && reads === readsAfterFirst, "the second read is served from the stored copy with no D1 read", { readsAfterFirst, reads });
ok(/max-age=300$/.test(b.r.headers.get("Cache-Control")), "visitors get max-age=300", b.r.headers.get("Cache-Control"));
const home = await get("/");
ok(/href="\/stream"/.test(home.t), "the home page links to the stream");
const health = await (await w.fetch(new Request("https://ideas.qnfo.org/health"), env, ctx)).json();
ok(health.capabilities.includes("idea-stream"), "health lists the capability");

// 2. the page script, in a sandbox
const scripts = [...a.t.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const code = scripts.find((s) => /ideaStream|POLL=30000/.test(s));
ok(!!code, "the stream script is inline", { n: scripts.length, lens: scripts.map((s) => s.length) });
{
  // pure functions: no document in the sandbox, so the script publishes its API
  const ctxv = {}; vm.createContext(ctxv); vm.runInContext("(function(){" + "return 0})()", ctxv);
  const g = vm.runInContext("this", ctxv); vm.runInContext(code, ctxv);
  const api = g.__ideaStream;
  ok(api && typeof api.merge === "function" && typeof api.rel === "function", "the pure functions are published when there is no document");
  const now = Date.parse("2026-11-05T12:00:00Z");
  ok(api.rel("2026-11-05T11:59:40Z", now) === "just now", "under 45 s is just now");
  ok(api.rel("2026-11-05T11:57:00Z", now) === "3 min ago", "minutes");
  ok(api.rel("2026-11-05T10:00:00Z", now) === "2 h ago", "hours");
  ok(api.rel("2026-11-02T10:00:00Z", now) === "2026-11-02" && api.rel("nonsense", now) === "", "a day or more is a date; a bad time is empty");
  const m1 = api.merge([], [{ id: "q-1", updated_at: "2026-11-05T10:00:00Z" }, { id: "p-2", updated_at: "2026-11-05T11:00:00Z" }, { id: "q-1", updated_at: "2026-11-05T10:30:00Z" }, null, {}], true);
  ok(m1.items.map((x) => x.id).join() === "p-2,q-1" && m1.fresh.length === 0, "first load: one row per id, newest first, nothing marked new", m1);
  ok(m1.items[1].updated_at === "2026-11-05T10:30:00Z", "the later copy of a repeated id wins");
  const m2 = api.merge(m1.items, [{ id: "t-3", updated_at: "2026-11-05T11:30:00Z" }, { id: "p-2", updated_at: "2026-11-05T11:00:00Z" }], false);
  ok(m2.fresh.join() === "t-3" && m2.items[0].id === "t-3", "a later load marks only the new id", m2);
  const many = Array.from({ length: 90 }, (_, i) => ({ id: "q-" + i, updated_at: new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString() }));
  const m3 = api.merge([], many, true);
  ok(m3.items.length === 60 && m3.items[0].id === "q-89", "at most 60 rows are kept, newest first");
}
// 3. the page script against a fake DOM and a fake feed
{
  const made = [];
  class El { constructor(t) { this.tagName = t; this.children = []; this._t = ""; this.className = ""; this.attrs = {}; this.listeners = {}; this.value = ""; made.push(this); }
    get firstChild() { return this.children[0] || null; } removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; } appendChild(c) { this.children.push(c); return c; }
    set textContent(v) { this._t = String(v); } get textContent() { return this._t + this.children.map((c) => c.textContent).join(""); }
    setAttribute(k, v) { this.attrs[k] = v; } addEventListener(k, f) { this.listeners[k] = f; }
    set innerHTML(v) { throw new Error("innerHTML was set"); } }
  const byId = { "st-l": new El("ul"), "st-live": new El("span"), "st-n": new El("p"), "st-f": new El("input") };
  const docListeners = {};
  const document = { hidden: false, getElementById: (i) => byId[i] || null, createElement: (t) => new El(t), addEventListener: (k, f) => { docListeners[k] = f; } };
  const timers = []; let feedCalls = 0, mode = "ok";
  const feeds = [
    { sessions: [{ id: "q-1", kind: "question", title: "<img src=x onerror=alert(1)> How does ultrametric error confinement scale?", updated_at: new Date(Date.now() - 120000).toISOString(), message_count: 0 }] },
    { sessions: [{ id: "p-9", kind: "proposal", title: "A newer proposal", updated_at: new Date().toISOString(), message_count: 2 }, { id: "q-1", kind: "question", title: "<img src=x onerror=alert(1)> How does ultrametric error confinement scale?", updated_at: new Date(Date.now() - 120000).toISOString() }] }
  ];
  const fetchFn = async (url) => { feedCalls++; if (mode === "down") return { ok: false, status: 503, json: async () => ({}) }; const d = feeds[Math.min(feedCalls - 1, feeds.length - 1)]; return { ok: true, status: 200, json: async () => d }; };
  const sb = { document, fetch: fetchFn, Date, JSON, Math, String, Object, Array, Promise, encodeURIComponent, setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clearTimeout() {}, setInterval() { return 1; } };
  vm.createContext(sb);
  vm.runInContext(code, sb);
  const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r)); };
  await settle();
  const li = byId["st-l"].children;
  ok(li.length === 1 && li[0].children[0].tagName === "a" && li[0].children[0].textContent.startsWith("<img src=x onerror=alert(1)>"), "an HTML-looking title is written as text", li.length && li[0].children[0].textContent);
  ok(li[0].children[0].attrs.href === undefined && li[0].children[0].href === "/s/q-1", "the link goes to the thread page");
  ok(/Live/.test(byId["st-live"].textContent) && /UTC/.test(byId["st-live"].textContent) && feedCalls === 1, "the indicator shows live after the first read", byId["st-live"].textContent);
  ok(byId["st-n"].textContent === "1 items, newest first", "the count line", byId["st-n"].textContent);
  ok(timers.length && timers[timers.length - 1].ms === 30000, "the next read is 30 s away", timers.map((t) => t.ms));
  // second read: a new item arrives and is marked New
  timers.pop().f(); await settle();
  const li2 = byId["st-l"].children;
  ok(li2.length === 2 && li2[0].children[0].textContent === "A newer proposal" && /New/.test(li2[0].textContent), "a later item is added on top and marked New", li2.map((x) => x.textContent));
  ok(!/New/.test(li2[1].textContent), "the item that was there at the first load is not marked");
  // feed down: backs off
  mode = "down"; timers.pop().f(); await settle();
  ok(/Offline/.test(byId["st-live"].textContent) && timers[timers.length - 1].ms === 60000, "a failed read shows offline and doubles the wait", [byId["st-live"].textContent, timers.map((t) => t.ms)]);
  mode = "ok"; timers.pop().f(); await settle();
  ok(/Live/.test(byId["st-live"].textContent) && timers[timers.length - 1].ms === 30000, "recovery returns to 30 s");
  // hidden page does not fetch
  document.hidden = true; const before = feedCalls; timers.pop().f(); await settle();
  ok(feedCalls === before, "a hidden page does not read the feed");
  // filter
  document.hidden = false; byId["st-f"].value = "proposal"; byId["st-f"].listeners.input();
  ok(byId["st-l"].children.length === 1 && /1 of 2 items match/.test(byId["st-n"].textContent), "the filter narrows the list and says how many match", byId["st-n"].textContent);
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
