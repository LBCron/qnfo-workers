// COMPUTE-1 (qnfo-ai-search 2.18.0, roadmap rows 34 RM-VISION-ULTRAMETRIC-PLAYGROUND-1 and 38 RM-VISION-COMPUTE-CLOUD-1, charter pillar: research) offline suite.
// No network. Proves: /compute serves the page with its marker, loads no script from elsewhere, makes no request of its own (nothing typed leaves the
// page), writes text with textContent only; the exact arithmetic of the p-adic calculator (valuation of integers and fractions, absolute value,
// p-adic digits of a fraction, differences, the strong triangle inequality, isosceles triangles, ball membership, refusal of a non-prime or a bad
// number); and the Laws of Form reducer (calling and crossing step by step, the truth table for letters, the value of well-known expressions,
// refusal of unbalanced brackets and other characters). The page script runs against a small fake DOM.
// Run: node --no-warnings qnfo-ai-search/compute.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
import vm from "node:vm";

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x) : "")); } };
const raw = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const src = raw.replace(/^export \{[^}]*\};?\s*$/m, "").replace(/^import [^;]*;/mg, "");
const cacheMap = new Map();
const caches = { default: { match: async (r) => { const h = cacheMap.get(r.url); return h ? h.clone() : undefined; }, put: async (r, res) => { cacheMap.set(r.url, res); } } };
const sb = { console: { log() {}, error() {}, warn() {} }, Date, JSON, Math, Number, String, RegExp, Set, Map, Array, Object, Promise, URL, URLSearchParams, Response, Request, Headers, TextEncoder, AbortController, setTimeout, clearTimeout, crypto, fetch: async () => { throw new Error("no network"); }, encodeURIComponent, decodeURIComponent, caches, AbortSignal };
vm.createContext(sb);
vm.runInContext(src + "\n__x = { worker_default, COMPUTE_PAGE };", sb);
const X = sb.__x;
const env = { QNFO_AUDIT: null };
const call = (path) => X.worker_default.fetch(new Request("https://ask.qwav.org" + path), env, { waitUntil() {} });

// 1. the page
{
  const a = await call("/compute"), at = await a.text();
  ok(a.status === 200 && /data-page="compute"/.test(at) && /<title>Compute/.test(at), "the page and its marker");
  ok(!/<script[^>]+src=/.test(at), "the page loads no script from elsewhere");
  ok(!/innerHTML|insertAdjacentHTML|document\.write|eval\(|outerHTML/.test(at), "the page writes text with textContent and node calls only");
  const js = at.match(/<script>\n\(function\(\)\{\n([\s\S]*)\}\)\(\);\n<\/script>/)[1];
  ok(!/fetch\(|XMLHttpRequest|sendBeacon|WebSocket/.test(js), "the page script makes no request: nothing typed leaves the page");
  ok(a.headers.get("x-frame-options") === "DENY" && /prefers-color-scheme:dark/.test(at) && /:focus-visible/.test(at) && /name="viewport"/.test(at), "security headers, dark mode, focus style, viewport");
  ok(!/vector|pipeline|supplied summary|grounding/i.test(at.replace(/<script[\s\S]*?<\/script>/g, "")), "reader text has no pipeline talk");
  ok(/qwav-demo-tree-distance/.test(at) && /qwav\.org\/#demos/.test(at) && /href="\/reproduce"/.test(at), "the page links the demos and the Reproduce page");
  const sm = await (await call("/sitemap.xml")).text(), h = await (await call("/health")).json(), nav = await (await call("/concepts")).text();
  ok(/ask\.qwav\.tech\/compute</.test(sm) && h.capabilities.includes("browser-compute") && /href="\/compute"[^>]*>Compute</.test(nav), "sitemap, health and nav know the page");
}
// 2. the page script against a fake DOM
const registry = {};
class FNode {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.parentNode = null; this._text = ""; this.value = ""; this.listeners = {}; }
  appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; }
  get firstChild() { return this.children[0] || null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  set textContent(t) { this.children.forEach((c) => { c.parentNode = null; }); this.children = []; if (t !== "") { const n = new FNode("#text"); n._text = String(t); n.parentNode = this; this.children.push(n); } }
  get textContent() { return this.tag === "#text" ? this._text : this.children.map((c) => c.textContent).join(""); }
  addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
  walk(fn) { fn(this); this.children.forEach((c) => c.walk && c.walk(fn)); }
  all(tag) { const out = []; this.walk((n) => { if (n !== this && n.tag === tag) out.push(n); }); return out; }
}
for (const id of ["pp", "px", "py", "pz", "pk", "pout", "pf", "le", "lout", "lf"]) { const n = new FNode("div"); registry[id] = n; }
const set = (o) => { for (const k of Object.keys(o)) registry[k].value = o[k]; };
const fakeDoc = { createElement: (t) => new FNode(t), createTextNode: (t) => { const n = new FNode("#text"); n._text = String(t); return n; }, getElementById: (id) => registry[id] || null };
const scriptM = X.COMPUTE_PAGE.match(/<script>\n\(function\(\)\{\n([\s\S]*)\}\)\(\);\n<\/script>/);
ok(!!scriptM, "the page has one inline script");
const pageJs = scriptM[1].replace("padic();lof();", "__pg={parseRat:parseRat,vRat:vRat,expand:expand,isPrime:isPrime,padic:padic,lof:lof,lofParse:lofParse,lofVal:lofVal,lofSteps:lofSteps,subRat:subRat};");
const sb2 = { document: fakeDoc, window: {}, console, JSON, RegExp, String, Array, Object, Math, Number, BigInt, Error, Infinity, __pg: null };
vm.createContext(sb2);
vm.runInContext(pageJs, sb2);
const PG = sb2.__pg;
ok(PG && typeof PG.padic === "function", "the page script runs and exposes its functions");
const rat = (s) => PG.parseRat(s);
{
  ok(PG.vRat(rat("75"), 5n) === 2 && PG.vRat(rat("3/25"), 5n) === -2 && PG.vRat(rat("0"), 2n) === null && PG.vRat(rat("-12"), 2n) === 2 && PG.vRat(rat("7"), 5n) === 0, "valuations of integers, a fraction, zero and a negative number");
  ok(PG.vRat(PG.subRat(rat("7"), rat("1")), 3n) === 1 && PG.vRat(PG.subRat(rat("1/2"), rat("1/3")), 2n) === -1, "valuation of a difference");
  ok(JSON.stringify(PG.expand(rat("1/3"), 5n, 6).digits) === "[2,3,1,3,1,3]", "1/3 in the 5-adic numbers is ...131312 (lowest digit first: 2,3,1,3,1,3)");
  ok(JSON.stringify(PG.expand(rat("-1"), 5n, 4).digits) === "[4,4,4,4]", "-1 is all digits p-1");
  const e = PG.expand(rat("3/25"), 5n, 3);
  ok(e.v === -2 && JSON.stringify(e.digits) === "[3,0,0]", "a fraction with p in the denominator has a negative power and a unit part");
  ok(PG.parseRat("1/0") === null && PG.parseRat("x") === null && PG.parseRat("1.5") === null && PG.parseRat("1/2/3") === null && PG.parseRat("+4/8").n === 1n && PG.parseRat("-4/8").d === 2n, "bad numbers are refused, fractions are reduced");
  ok(PG.isPrime(2) && PG.isPrime(5) && !PG.isPrime(91) && !PG.isPrime(1) && !PG.isPrime(1000033) && PG.isPrime(1000003), "primality up to 1000003");
}
{
  set({ pp: "5", px: "75", py: "3/25", pz: "1", pk: "1" });
  PG.padic();
  const t = registry.pout.textContent;
  ok(/x = 75/.test(t) && /y = 3\/25/.test(t) && /5\^2/.test(t) && /1\/5\^2/.test(t), "the table gives x = 75 with valuation 2 and |x| = 1/5^2", t.slice(0, 300));
  ok(/d\(x, z\)/.test(t) && /holds/.test(t) && !/fails/.test(t), "the strong triangle inequality holds for the defaults");
  ok(/y is outside it/.test(t) && /z is outside it/.test(t), "y and z lie outside the ball of radius 1/5 around x (v(x-y) = -2 < 1)", t.slice(-400));
  set({ pp: "3", px: "10", py: "1", pz: "28", pk: "2" });
  PG.padic();
  const t2 = registry.pout.textContent;
  ok(/y is inside it \(v\(x - y\) = 2\)/.test(t2) && /z is inside it \(v\(x - z\) = 2\)/.test(t2), "10, 1 and 28 differ by multiples of 9: both lie in the ball of radius 3^-2 around 10", t2.slice(-500));
  ok(/the two smallest valuations are 2 and 2/.test(t2) && /so it holds/.test(t2), "the isosceles check");
  set({ pp: "6", px: "1", py: "2", pz: "3", pk: "1" });
  PG.padic();
  ok(/p must be a prime/.test(registry.pout.textContent) && registry.pout.all("table").length === 0, "a composite p is refused with no table");
  set({ pp: "5", px: "1/0", py: "2", pz: "3", pk: "1" });
  PG.padic();
  ok(/x is not a whole number or a fraction/.test(registry.pout.textContent), "a bad number names the field");
  set({ pp: "5", px: "1", py: "2", pz: "3", pk: "one" });
  PG.padic();
  ok(/k must be a whole number/.test(registry.pout.textContent), "a bad k is refused");
  set({ pp: "2", px: "5", py: "5", pz: "0", pk: "3" });
  PG.padic();
  ok(/infinity/.test(registry.pout.textContent) && /y is inside it/.test(registry.pout.textContent), "equal numbers have infinite valuation and lie in every ball");
}
{
  const steps = (e) => PG.lofSteps(e).map((s) => s.s);
  ok(JSON.stringify(steps("(()())")) === JSON.stringify(["(()())", "(())", ""]), "(()()) reduces by calling then crossing to nothing", steps("(()())"));
  ok(JSON.stringify(steps("()()")) === JSON.stringify(["()()", "()"]), "()() is one mark");
  ok(steps("((()))").pop() === "()", "((())) is a mark");
  ok(steps("(()(()))").pop() === "", "(()(())) is void");
  ok(PG.lofVal(PG.lofParse("()"), {}) === true && PG.lofVal(PG.lofParse("(())"), {}) === false && PG.lofVal(PG.lofParse(""), {}) === false, "the value of a mark, a crossed mark and nothing");
  const t = PG.lofParse("((a)a)");
  ok(PG.lofVal(t, { a: true }) === false && PG.lofVal(t, { a: false }) === false, "((a)a) is void for both values of a (the first initial of the calculus)");
  const u = PG.lofParse("(a(b))");
  ok(PG.lofVal(u, { a: false, b: true }) === true && PG.lofVal(u, { a: true, b: false }) === false && PG.lofVal(u, { a: false, b: false }) === false, "(a(b)) is the value read off its truth table");
  let err = ""; try { PG.lofParse("(a"); } catch (e) { err = e.message; }
  ok(/not closed/.test(err), "an open bracket is refused", err);
  err = ""; try { PG.lofParse("a)"); } catch (e) { err = e.message; }
  ok(/no opening bracket/.test(err), "a stray closing bracket is refused", err);
  err = ""; try { PG.lofParse("a+b"); } catch (e) { err = e.message; }
  ok(/Use only brackets and the letters/.test(err), "another character is refused", err);
  err = ""; try { PG.lofParse("(".repeat(401)); } catch (e) { err = e.message; }
  ok(/at most 400/.test(err), "a very long input is refused", err);
  set({ le: "(()())(())" });
  PG.lof();
  const t1 = registry.lout.textContent;
  ok(/Reduction/.test(t1) && /by calling: two marks together are one mark/.test(t1) && /by crossing: a mark inside a mark is void/.test(t1) && /Result: \(nothing\) void/.test(t1), "a letter-free expression is reduced step by step", t1);
  set({ le: "(a(b))" });
  PG.lof();
  const t2 = registry.lout.textContent;
  ok(registry.lout.all("tr").length === 5 && /marked in 1 of 4 cases/.test(t2), "an expression with two letters gets a four-row truth table", t2.slice(-120));
  set({ le: "((a)a)" });
  PG.lof();
  ok(/void whatever the letters are/.test(registry.lout.textContent), "a tautology of the calculus is reported");
  set({ le: "abcdef" });
  PG.lof();
  ok(/at most five different letters/.test(registry.lout.textContent), "six letters are refused");
  set({ le: "(()" });
  PG.lof();
  ok(/not closed/.test(registry.lout.textContent), "an error is shown on the page");
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
