// REACH-AE-1b offline suite (qnfo-gateway; agent_issues 1000699, GitHub #5727): the writer half of the first-party per-page reach stream. A human HTML page load on a reach-layer host
// writes exactly one Workers Analytics Engine data point with the layout qnfo-infra reads (blob1 reach, blob2 host, blob3 path, blob4 referrer host, blob5 utm_source, blob6 country, double1 1,
// index1 host); crawlers, non-HTML, non-200, HEAD, /health, /api/ and other hosts write none; the point holds no query value, IP or user agent string; a missing or throwing binding never
// changes the response. Covers the pure functions (cut from the worker source between their markers, so no copy can drift) and the real fetch handler end to end with stubbed stores.
// Run: node --no-warnings qnfo-gateway/reach-ae.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "worker.js"), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 400) : "")); } };

const b = src.indexOf("// ---- REACH-AE-1b:BEGIN"), e = src.indexOf("// ---- REACH-AE-1b:END");
ok(b > 0 && e > b, "REACH-AE-1b block markers present");
ok(!/\*\//.test(src.slice(b, e)) && [...src.slice(b, e)].every((c) => c.charCodeAt(0) < 128), "the block is ASCII and holds no comment terminator");
ok(/var VERSION="3\.(5[9]|[6-9]\d)\.|var VERSION="[4-9]\./.test(src), "VERSION is at least 3.59 (a new capability raises the minor version)");
const tailAt = src.indexOf("const utmRow = utmClickRow(request, served);");
ok(tailAt > 0 && src.indexOf("reachAeWrite(env, reachAeEvent(request, served));", tailAt) > tailAt && src.indexOf("reachAeWrite(env, reachAeEvent(request, served));", tailAt) < src.indexOf("return withFleetCtl(await withReachLayer(served, request));", tailAt), "the fetch handler writes after the UTM ledger and before it returns the layered answer, once");
ok(src.split("env.REACH_AE.writeDataPoint(").length === 2, "the dataset is written from exactly one place");
// the deps the block reads, taken from the worker source
const rl = /var RL_HOSTS = \{[^}]*\};/.exec(src)[0];
const bot = src.slice(src.indexOf("var UTM_BOT_RE"), src.indexOf("// The row a response earns, or null"));
const cx = vm.createContext({ URL, String, console });
vm.runInContext(rl + "\n" + bot + "\n" + src.slice(b, e) + "\nthis.api = { reachAeEvent, reachAeWrite, RL_HOSTS };", cx);
const A = cx.api;
const HUMAN = "Mozilla/5.0 (Macintosh) AppleWebKit Safari", BOT = "Mozilla/5.0 (compatible; Bluesky Cardyb/1.1)";
const req = (url, o) => { o = o || {}; return { method: o.method || "GET", url, cf: o.cf === undefined ? { country: "nl" } : o.cf, headers: { get: (k) => ({ "User-Agent": o.ua === undefined ? HUMAN : o.ua, Referer: o.ref || null }[k] || null) } }; };
const res = (status, ct) => ({ status, headers: { get: (k) => (k === "Content-Type" ? ct : null) } });
const html = res(200, "text/html; charset=utf-8");

let ev = A.reachAeEvent(req("https://papers.qnfo.org/papers/alpha/?utm_source=Digest&utm_medium=email&token=SECRET", { ref: "https://News.YCombinator.com/item?id=42&x=secret" }), html);
ok(ev && JSON.stringify(ev.blobs) === JSON.stringify(["reach", "papers.qnfo.org", "/papers/alpha", "news.ycombinator.com", "digest", "NL"]) && JSON.stringify(ev.doubles) === "[1]" && JSON.stringify(ev.indexes) === '["papers.qnfo.org"]', "a human load: reach, host, path without slash or query, referrer host, utm_source, country", ev);
ok(!JSON.stringify(ev).includes("SECRET") && !JSON.stringify(ev).includes("secret") && !/Mozilla|Macintosh/.test(JSON.stringify(ev)), "no query value, no full Referer and no user agent string in the point");
ok(A.reachAeEvent(req("https://qnfo.org/", { ref: "https://papers.qnfo.org/papers/alpha" }), html).blobs[3] === "self", "a referrer on a fleet host is self");
ok(A.reachAeEvent(req("https://qnfo.org/", { ref: "https://qnfo.org/" }), html).blobs[3] === "self" && A.reachAeEvent(req("https://qnfo.org/", { ref: "https://fleet.q08.org/x" }), html).blobs[3] === "self" && A.reachAeEvent(req("https://qnfo.org/", { ref: "https://evilqnfo.org/" }), html).blobs[3] === "evilqnfo.org", "self covers the fleet domains by suffix and never a look-alike");
ok(A.reachAeEvent(req("https://qnfo.org/"), html).blobs[3] === "" && A.reachAeEvent(req("https://qnfo.org/", { ref: "not a url" }), html).blobs[3] === "", "no or malformed Referer is the empty string");
ok(A.reachAeEvent(req("https://qnfo.org/", { cf: undefined }), html) !== null && A.reachAeEvent(req("https://qnfo.org/", { cf: {} }), html).blobs[5] === "", "no country is the empty string");
ok(A.reachAeEvent(req("https://qnfo.org/" + "a".repeat(400)), html).blobs[2].length === 200, "the path is cut at 200 characters");
for (const [name, r, rs] of [
  ["a declared crawler", req("https://papers.qnfo.org/papers/alpha", { ua: "Mozilla/5.0 (compatible; Googlebot/2.1)" }), html],
  ["a link preview fetcher", req("https://qnfo.org/", { ua: BOT }), html],
  ["a HEAD request", req("https://qnfo.org/", { method: "HEAD" }), html],
  ["a POST", req("https://qnfo.org/", { method: "POST" }), html],
  ["a 404", req("https://qnfo.org/missing"), res(404, "text/html")],
  ["a 301", req("https://qnfo.org/x"), res(301, "text/html")],
  ["JSON", req("https://papers.qnfo.org/api/papers/alpha"), res(200, "application/json")],
  ["markdown", req("https://papers.qnfo.org/papers/alpha/v/1"), res(200, "text/markdown")],
  ["/health", req("https://qnfo.org/health"), html],
  ["an /api/ page (the confirm and unsubscribe pages carry tokens)", req("https://qnfo.org/api/confirm?token=abc123"), html],
  ["another host", req("https://legal.qnfo.org/privacy"), html],
  ["a workers.dev host", req("https://qnfo-gateway.q08.workers.dev/"), html],
  ["a malformed request", req("not a url"), html],
]) ok(A.reachAeEvent(r, rs) === null, name + " writes nothing");
ok(A.reachAeEvent(null, html) === null && A.reachAeEvent(req("https://qnfo.org/"), null) === null, "null arguments write nothing and do not throw");

// reachAeWrite
const points = [];
ok(A.reachAeWrite({ REACH_AE: { writeDataPoint: (p) => points.push(p) } }, ev) === true && points.length === 1 && points[0] === ev, "reachAeWrite hands the point to the binding once");
ok(A.reachAeWrite({}, ev) === false && A.reachAeWrite(null, ev) === false && A.reachAeWrite({ REACH_AE: { writeDataPoint() { throw new Error("x"); } } }, null) === false, "no binding, no env or no event writes nothing");
let logged = "";
cx.console = { error: (m) => { logged += m; } };
ok(vm.runInContext("reachAeWrite({ REACH_AE: { writeDataPoint() { throw new Error('quota') } } }, { blobs: [] })", Object.assign(cx, { console: cx.console })) === false && /reachAeWrite/.test(logged) && /quota/.test(logged), "a throwing binding is logged and swallowed");

// ---- the real fetch handler end to end
const paper = { slug: "a-paper", title: "A paper", body_md: "## Introduction\n\nSome text.", abstract: "An abstract.", authors: "Rowan Brad Quni-Gudzinas", doi: null, created_at: "2026-10-01", status: "published", version: "1", pdf_path: null, license: null };
const stmt = (sql) => { const s = { bind() { return s; }, async all() { return { results: [] }; }, async first() { return /FROM papers WHERE slug = \?/.test(sql) ? Object.assign({}, paper) : null; }, async run() { return {}; } }; return s; };
const gw = (await import(pathToFileURL(join(here, "worker.js")).href)).default;
const written = [];
const withAe = { LIVING_PAPER: { prepare: stmt }, DB: { prepare: stmt }, REACH_AE: { writeDataPoint: (p) => written.push(p) } };
const without = { LIVING_PAPER: { prepare: stmt }, DB: { prepare: stmt } };
const throwing = { LIVING_PAPER: { prepare: stmt }, DB: { prepare: stmt }, REACH_AE: { writeDataPoint() { throw new Error("analytics engine down"); } } };
const get = async (env, url, o) => { o = o || {}; const r = await gw.fetch(new Request(url, { method: o.method || "GET", redirect: "manual", headers: Object.assign({ "User-Agent": HUMAN }, o.headers || {}) }), env, { waitUntil() {} }); return { s: r.status, ct: r.headers.get("Content-Type") || "", t: await r.text() }; };

const base = await get(without, "https://papers.qnfo.org/papers/a-paper");
ok(base.s === 200 && /text\/html/.test(base.ct), "baseline: the paper page answers 200 HTML without the binding", base.s);
const got = await get(withAe, "https://papers.qnfo.org/papers/a-paper?utm_source=bluesky&utm_campaign=a-paper&token=zzz", { headers: { Referer: "https://news.ycombinator.com/item?id=1" } });
ok(got.s === 200 && got.t.length > 0, "with the binding the page still answers 200", got.s);
ok(written.length === 1 && JSON.stringify(written[0].blobs.slice(0, 5)) === JSON.stringify(["reach", "papers.qnfo.org", "/papers/a-paper", "news.ycombinator.com", "bluesky"]) && written[0].doubles[0] === 1 && written[0].indexes[0] === "papers.qnfo.org", "one data point with the layout qnfo-infra reads", written);
ok(!JSON.stringify(written).includes("zzz"), "the token in the query is not in the point");
const same = await get(withAe, "https://papers.qnfo.org/papers/a-paper");
ok(same.t === base.t && same.s === base.s, "the response body is identical with and without the binding");
written.length = 0;
await get(withAe, "https://papers.qnfo.org/papers/a-paper", { headers: { "User-Agent": "Mozilla/5.0 (compatible; bingbot/2.0)" } });
await get(withAe, "https://papers.qnfo.org/papers/a-paper", { method: "HEAD" });
await get(withAe, "https://qnfo.org/health");
await get(withAe, "https://qnfo.org/api/confirm?token=abc123");
ok(written.length === 0, "a crawler, a HEAD, /health and a token page write nothing", written);
const t = await get(throwing, "https://papers.qnfo.org/papers/a-paper");
ok(t.s === 200 && t.t === base.t, "a throwing binding does not change the response");
await get(withAe, "https://qnfo.org/");
ok(written.length === 1 && written[0].blobs[1] === "qnfo.org" && written[0].blobs[2] === "/", "the home page of qnfo.org is one point on host qnfo.org, path /", written);

console.log(pass + " passed, " + fail + " failed");
process.exitCode = fail ? 1 : 0;
