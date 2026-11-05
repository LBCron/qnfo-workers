// REPRODUCE-1 (qnfo-ai-search 2.17.0, roadmap row 36 RM-VISION-REPRODUCE-BUTTON-1, charter pillar: research) offline suite.
// No network: the paper gateway, the run ledger, the public research repository's raw files, the rate-limit table and the edge cache are stubbed in
// the worker's own sandbox, and the page script runs against a small fake DOM with a fake Web Worker.
// Proves: /api/reproduce reads the run ledger and the two recorded files at the recorded commit (and at main when that commit has no file), returns
// the script, the extracted claims and the recorded output with its exit code, drops ledger rows whose repository or path is not a plain research
// repository path, cuts a script over the cap and says so, reports a paper without a record or whose files cannot be read, validates the slug and the
// run id, caches a record for an hour and a miss for a minute, and rate limits misses; /reproduce and /reproduce/<slug> serve the page with its
// marker, load no script but the pinned KaTeX, carry the pinned Pyodide address and integrity hash, and write text with textContent only; on a click
// the page fetches the Pyodide loader with the integrity option, starts a worker, shows the output as it arrives, fills the claim table from the
// lines the script prints, and can be stopped.
// Run: node --no-warnings qnfo-ai-search/reproduce.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
import vm from "node:vm";

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x) : "")); } };
const raw = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const src = raw.replace(/^export \{[^}]*\};?\s*$/m, "").replace(/^import [^;]*;/mg, "");

const SHA = "a".repeat(40), SHA2 = "b".repeat(40);
const cacheMap = new Map();
const caches = { default: { match: async (r) => { const h = cacheMap.get(r.url); return h ? h.clone() : undefined; }, put: async (r, res) => { cacheMap.set(r.url, res); } } };
const PAPERS = {
  live: { slug: "live", title: "A Live Paper On Trees", status: "published", version_semver: "2.0.0", body_md: "x" },
  fresh: { slug: "fresh", title: "A Paper With A New Commit", status: "published", version_semver: "1.0.0", body_md: "x" },
  bare: { slug: "bare", title: "A Paper Without A Record", status: "published", version_semver: "1.0.0", body_md: "x" },
  gone: { slug: "gone", title: "A Paper Whose Files Are Missing", status: "published", version_semver: "1.0.0", body_md: "x" },
  bad: { slug: "bad", title: "A Paper With Bad Ledger Rows", status: "published", version_semver: "1.0.0", body_md: "x" },
  huge: { slug: "huge", title: "A Paper With A Long Script", status: "published", version_semver: "1.0.0", body_md: "x" },
  draft: { slug: "draft", title: "A Draft", status: "draft", body_md: "x" },
};
const LEDGER = {
  live: [
    { run_id: "run-2", repo: "QNFO/qnfo-research", run_path: "runs/cycle-2/live", cycle: "cycle-2", paper_version: "2.0.0", status: "ok", commit_sha: SHA, deposited_at: "2026-11-03T09:55:10.783Z" },
    { run_id: "run-1", repo: "QNFO/qnfo-research", run_path: "runs/cycle-1/live", cycle: "cycle-1", paper_version: "1.0.0", status: "ok", commit_sha: SHA2, deposited_at: "2026-11-01T09:55:10.783Z" },
  ],
  fresh: [{ run_id: "run-f", repo: "QNFO/qnfo-research", run_path: "runs/cycle-9/fresh", cycle: "cycle-9", paper_version: "1.0.0", status: "ok", commit_sha: SHA, deposited_at: "2026-11-04T09:55:10.783Z" }],
  gone: [{ run_id: "run-g", repo: "QNFO/qnfo-research", run_path: "runs/cycle-3/gone", cycle: "cycle-3", paper_version: "1.0.0", status: "ok", commit_sha: null, deposited_at: "2026-11-04T09:55:10.783Z" }],
  bad: [
    { run_id: "evil-1", repo: "QNFO/qnfo-research", run_path: "runs/../../secret", cycle: "c", status: "ok", commit_sha: null, deposited_at: "2026-11-04" },
    { run_id: "evil-2", repo: "someone-else/repo", run_path: "runs/cycle-4/bad", cycle: "c", status: "ok", commit_sha: null, deposited_at: "2026-11-04" },
    { run_id: "evil-3", repo: "QNFO/qnfo-research", run_path: "runs/cycle 4/bad?x=1", cycle: "c", status: "ok", commit_sha: null, deposited_at: "2026-11-04" },
    { run_id: "evil-4", repo: "QNFO/..", run_path: "runs/cycle-4/bad", cycle: "c", status: "ok", commit_sha: null, deposited_at: "2026-11-04" },
  ],
  huge: [{ run_id: "run-h", repo: "QNFO/qnfo-research", run_path: "runs/cycle-5/huge", cycle: "cycle-5", paper_version: "1.0.0", status: "ok", commit_sha: null, deposited_at: "2026-11-04T09:55:10.783Z" }],
};
const MD = [
  "# Verification report", "", "## Extracted claims", "[", "  {\"id\": \"Q1\", \"statement\": \"First-level failure probability $p^{(1)}=0.17$\", \"inputs\": \"n=8\", \"formula\": \"\\\\sum\"},", "  {\"id\": \"Q2\", \"statement\": \"Barrier height $B(3)=8$\"}", "]", "",
  "## Script", "```python", "print('hi')", "```", "", "## Execution output", "```", "", "[stderr]", "Traceback (most recent call last):", "ModuleNotFoundError: No module named 'sympy'", "", "[exit 1]", "```", "", "## Adjudication", "", "x",
].join("\n");
const FILES = {
  ["raw.githubusercontent.com/QNFO/qnfo-research/" + SHA + "/runs/cycle-2/live/verification.py"]: "print('CLAIM Q1: computed=0.17 expected=0.17 match=yes')\nprint('VERIFICATION SUMMARY: 2 claims, 2 match, 0 mismatch')\n",
  ["raw.githubusercontent.com/QNFO/qnfo-research/" + SHA + "/runs/cycle-2/live/verification.md"]: MD,
  ["raw.githubusercontent.com/QNFO/qnfo-research/" + SHA2 + "/runs/cycle-1/live/verification.py"]: "print('older')\n",
  ["raw.githubusercontent.com/QNFO/qnfo-research/" + SHA2 + "/runs/cycle-1/live/verification.md"]: "# Verification report\n\n## Script\n```python\nprint('older')\n```\n",
  "raw.githubusercontent.com/QNFO/qnfo-research/main/runs/cycle-9/fresh/verification.py": "print('from main')\n",
  "raw.githubusercontent.com/QNFO/qnfo-research/main/runs/cycle-9/fresh/verification.md": "# Verification report\n\n## Extracted claims\n[]\n\n## Script\n",
  "raw.githubusercontent.com/QNFO/qnfo-research/main/runs/cycle-5/huge/verification.py": "x = 1\n".repeat(30000),
};
let upstream = 0, ledgerReads = 0;
const fetched = [];
async function gateway(url) {
  const u = new URL(String(url));
  const resp = (j, s) => ({ ok: (s || 200) < 400, status: s || 200, json: async () => j, text: async () => (typeof j === "string" ? j : JSON.stringify(j)) });
  if (u.hostname === "papers.qnfo.org" && u.pathname.startsWith("/papers/")) { upstream++; const s = decodeURIComponent(u.pathname.slice(8)); return PAPERS[s] ? resp(PAPERS[s]) : resp({ error: "nf" }, 404); }
  if (u.hostname === "raw.githubusercontent.com") { fetched.push(u.pathname); upstream++; const k = u.hostname + u.pathname; return k in FILES ? resp(FILES[k]) : resp("404: Not Found", 404); }
  return resp({}, 404);
}
const counters = new Map();
const QNFO_AUDIT = { prepare(sql) { const s = { bind(...k) { s.k = k; return s; }, async first() { if (/INSERT INTO ask_rate/.test(sql)) { const n = (counters.get(s.k[0]) || 0) + 1; counters.set(s.k[0], n); return { n }; } return null; }, async run() { return { success: true }; }, async all() { if (/research_run_ledger/.test(sql)) { ledgerReads++; return { results: LEDGER[s.k[0]] || [] }; } return { results: [] }; } }; return s; } };
const sb = { console: { log() {}, error() {}, warn() {} }, Date, JSON, Math, Number, String, RegExp, Set, Map, Array, Object, Promise, URL, URLSearchParams, Response, Request, Headers, TextEncoder, AbortController, setTimeout, clearTimeout, crypto, fetch: gateway, encodeURIComponent, decodeURIComponent, caches, AbortSignal };
vm.createContext(sb);
vm.runInContext(src + "\n__x = { worker_default, reproParse, REPRODUCE_PAGE, PAPER_PAGE, REPRO_PER_IP_HOUR, REPRO_SCRIPT_CHARS, PYODIDE_BASE, PYODIDE_SRI };", sb);
const X = sb.__x;
const env = { GATEWAY: { fetch: (u, o) => gateway(u, o) }, QNFO_AUDIT };
const pending = [];
const call = (path, headers) => X.worker_default.fetch(new Request("https://ask.qwav.org" + path, { headers: headers || {} }), env, { waitUntil: (p) => pending.push(p) });

// 1. the record
{
  const r = await call("/api/reproduce?slug=live"), j = await r.json();
  ok(r.status === 200 && j.slug === "live" && j.run && j.run.run_id === "run-2", "the newest recorded run is the one shown", j.run && j.run.run_id);
  ok(j.run.script.startsWith("print('CLAIM Q1") && j.run.script_truncated === false, "the script is returned whole");
  ok(j.run.claims.length === 2 && j.run.claims[0].id === "Q1" && /p\^\{\(1\)\}=0\.17/.test(j.run.claims[0].statement) && j.run.claims[1].formula === "", "the extracted claims are read from the report", j.run.claims);
  ok(j.run.recorded.exit === 1 && /ModuleNotFoundError: No module named 'sympy'/.test(j.run.recorded.output) && /\[exit 1\]$/.test(j.run.recorded.output), "the recorded server output and its exit code are returned", j.run.recorded);
  ok(fetched.some((p) => p.indexOf("/" + SHA + "/runs/cycle-2/live/verification.py") >= 0), "the files are read at the commit the ledger names", fetched);
  ok(j.run.source_url === "https://github.com/QNFO/qnfo-research/tree/" + SHA + "/runs/cycle-2/live", "the record links the repository directory at that commit", j.run.source_url);
  ok(j.version === "2.0.0" && j.run.paper_version === "2.0.0" && j.runs.length === 2 && j.runs[1].run_id === "run-1" && j.runs[1].deposited === "2026-11-01", "the paper version, the run's version and the other runs are listed");
  ok(r.headers.get("cache-control") === "public, max-age=3600", "a record is cacheable for an hour");
  await Promise.all(pending.splice(0));
  const up0 = upstream, led0 = ledgerReads;
  const again = await call("/api/reproduce?slug=live");
  ok(again.status === 200 && upstream === up0 && ledgerReads === led0, "a repeat is served from the cache: no gateway, ledger or file read");
  const older = await (await call("/api/reproduce?slug=live&run=run-1")).json();
  ok(older.run && older.run.run_id === "run-1" && older.run.script === "print('older')\n" && older.run.claims.length === 0 && older.run.recorded.output === null, "a chosen older run is returned; a report without the sections gives no claims and no output", older.run);
  const none = await (await call("/api/reproduce?slug=live&run=nope-1")).json();
  ok(none.run === null && /not on record/.test(none.note), "an unknown run id says so", none.note);
}
// 2. other shapes
{
  const f = await (await call("/api/reproduce?slug=fresh")).json();
  ok(f.run && f.run.script === "print('from main')\n" && /tree\/main\/runs\/cycle-9\/fresh$/.test(f.run.source_url), "a commit without the file falls back to main", f.run && f.run.source_url);
  const b = await (await call("/api/reproduce?slug=bare")).json();
  ok(b.run === null && b.runs.length === 0 && /No verification script has been recorded/.test(b.note), "a paper with no ledger row says so", b);
  const g = await call("/api/reproduce?slug=gone"), gj = await g.json();
  ok(gj.run === null && gj.runs.length === 1 && /could not be read just now/.test(gj.note) && g.headers.get("cache-control") === "public, max-age=60", "files that cannot be read give a note, cached a minute only", [gj.note, g.headers.get("cache-control")]);
  const e = await (await call("/api/reproduce?slug=bad")).json();
  ok(e.runs.length === 0 && e.run === null, "ledger rows with a foreign repository or a path that climbs or holds odd characters are dropped", e.runs);
  const h = await (await call("/api/reproduce?slug=huge")).json();
  ok(h.run.script_truncated === true && h.run.script.length === X.REPRO_SCRIPT_CHARS, "a script over the cap is cut and says so", [h.run.script.length, h.run.script_truncated]);
  const bad = await call("/api/reproduce?slug=%24%24"), badRun = await call("/api/reproduce?slug=live&run=a%20b"), nf = await call("/api/reproduce?slug=nope"), dr = await call("/api/reproduce?slug=draft");
  ok(bad.status === 400 && badRun.status === 400 && nf.status === 404 && dr.status === 404, "bad slug and bad run id 400, unknown 404, unpublished 404", [bad.status, badRun.status, nf.status, dr.status]);
  counters.clear();
  let last = 0;
  for (let i = 0; i < X.REPRO_PER_IP_HOUR + 1; i++) last = (await call("/api/reproduce?slug=miss-" + i, { "CF-Connecting-IP": "203.0.113.9" })).status;
  ok(last === 429, "the miss after the per-address cap is refused with 429", last);
  const other = await call("/api/reproduce?slug=miss-other", { "CF-Connecting-IP": "203.0.113.10" });
  ok(other.status === 404, "another address is not blocked by the first", other.status);
}
// 3. the report reader
{
  const p = X.reproParse(MD);
  ok(p.claims.length === 2 && p.exit === 1 && p.output.indexOf("[exit 1]") > 0, "the sample report is read");
  const fenced = X.reproParse("## Extracted claims\n```json\n[{\"id\":\"A1\",\"statement\":\"s\"}]\n```\n\n## Script\n");
  ok(fenced.claims.length === 1 && fenced.claims[0].id === "A1", "a fenced claims list is read too");
  ok(X.reproParse("## Extracted claims\nnot json\n\n## Script\n").claims.length === 0, "a claims section that is not JSON gives no claims, and no error");
  const okOut = X.reproParse("## Execution output\n```\nhello\n[exit 0]\n```\n");
  ok(okOut.exit === 0 && okOut.output === "hello\n[exit 0]", "a successful run has exit 0", okOut);
  const noExit = X.reproParse("## Execution output\n```\nhello\n```\n");
  ok(noExit.exit === null && noExit.output === "hello", "an output with no exit line has an unknown exit", noExit);
  ok(X.reproParse("## Execution output\n```\n" + "x".repeat(9000) + "\n```\n").output.length === 6000, "the recorded output is cut at 6000 characters");
}
// 4. the pages
{
  const a = await call("/reproduce"), at = await a.text();
  ok(a.status === 200 && /data-page="reproduce"/.test(at) && /<title>Reproduce/.test(at), "the picker page and its marker");
  const b = await call("/reproduce/live"), bt = await b.text();
  ok(b.status === 200 && /rel="canonical" href="https:\/\/ask\.qwav\.tech\/reproduce\/live"/.test(bt), "a record page has its own canonical address");
  ok((await call("/reproduce/A")).status === 404, "a malformed address is a 404");
  const scripts = [...bt.matchAll(/<script[^>]*\ssrc="([^"]+)"[^>]*>/g)].map((m) => m[0]);
  ok(scripts.length === 1 && /KaTeX\/0\.16\.47\/katex\.min\.js/.test(scripts[0]) && /integrity="sha384-/.test(scripts[0]), "the only script tag with a source is the pinned KaTeX file", scripts);
  ok(bt.indexOf("https://cdn.jsdelivr.net/pyodide/v0.29.5/full/") > 0 && bt.indexOf(X.PYODIDE_SRI) > 0 && /^sha384-[A-Za-z0-9+/]{64}$/.test(X.PYODIDE_SRI), "the page names the pinned Pyodide version and its integrity hash");
  ok(/integrity:PYSRI/.test(bt), "the loader is fetched with the integrity option");
  ok(!/innerHTML|insertAdjacentHTML|document\.write|eval\(|outerHTML/.test(bt), "the page writes text with textContent and node calls only");
  ok(/prefers-color-scheme:dark/.test(bt) && /:focus-visible/.test(bt) && /name="viewport"/.test(bt) && /does not show that the paper's physics is right/.test(bt), "dark mode, focus style, viewport and the limit of what a match shows");
  ok(!/vector|pipeline|supplied summary|grounding/i.test(bt.replace(/<script[\s\S]*?<\/script>/g, "").replace(/Recorded when the pipeline ran it|research pipeline/g, "")), "reader text has no pipeline talk beyond naming the research pipeline that ran the script");
  const robots = await (await call("/robots.txt")).text(), sm = await (await call("/sitemap.xml")).text(), h = await (await call("/health")).json(), nav = await (await call("/concepts")).text();
  ok(/Disallow: \/api\/reproduce/.test(robots) && /ask\.qwav\.tech\/reproduce</.test(sm) && h.capabilities.includes("paper-reproduce") && /href="\/reproduce"[^>]*>Reproduce</.test(nav), "robots, sitemap, health and nav know the page");
  ok(/id="lrep" href="\/reproduce"/.test(X.PAPER_PAGE) && /\$\('lrep'\)\.href='\/reproduce\//.test(X.PAPER_PAGE), "the living paper links to its reproduction");
}
// 5. the page script against a fake DOM and a fake worker
const registry = {};
class FNode {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.parentNode = null; this._text = ""; this.hidden = false; this.id = ""; this.className = ""; this.disabled = false; this.listeners = {}; }
  appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; }
  get firstChild() { return this.children[0] || null; }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === "id") { this.id = String(v); registry[this.id] = this; } }
  set textContent(t) { this.children.forEach((c) => { c.parentNode = null; }); this.children = []; if (t !== "") { const n = new FNode("#text"); n._text = String(t); n.parentNode = this; this.children.push(n); } }
  get textContent() { return this.tag === "#text" ? this._text : this.children.map((c) => c.textContent).join(""); }
  addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
  click() { (this.listeners.click || []).forEach((f) => f({})); }
  walk(fn) { fn(this); this.children.forEach((c) => c.walk && c.walk(fn)); }
  all(tag) { const out = []; this.walk((n) => { if (n !== this && n.tag === tag) out.push(n); }); return out; }
}
for (const id of ["pick", "doc", "slugl", "pt", "pm", "runs", "rb", "ctw", "ct", "cb", "cn", "rs", "rec", "csum", "code", "warn", "run", "stop", "rstat", "rout", "nonote", "f", "q", "results"]) { const n = new FNode("div"); n.setAttribute("id", id); }
registry.stop.hidden = true;
const fakeDoc = { createElement: (t) => new FNode(t), createTextNode: (t) => { const n = new FNode("#text"); n._text = String(t); return n; }, getElementById: (id) => registry[id] || null, querySelectorAll: (sel) => (sel === "#cb tr" ? registry.cb.children.filter((c) => c.tag === "tr") : []), querySelector: () => null, addEventListener() {} };
const fetchCalls = [], workers = [];
class FWorker { constructor(url) { this.url = url; this.sent = []; this.terminated = false; workers.push(this); } postMessage(m) { this.sent.push(m); } terminate() { this.terminated = true; } }
const scriptM = X.REPRODUCE_PAGE.match(/<script>\n\(function\(\)\{\n([\s\S]*)\}\)\(\);\n<\/script>/);
ok(!!scriptM, "the page has one inline script");
const pageJs = scriptM[1].replace("if(SLUG)load();", "__pg={parseOut:parseOut,fillResults:fillResults,showRun:showRun,startRun:startRun,stopRun:stopRun};");
const sb2 = { document: fakeDoc, window: {}, location: { pathname: "/reproduce", search: "" }, fetch: null, console, JSON, RegExp, String, Array, Object, Math, Promise, setTimeout, clearTimeout, Date, encodeURIComponent, URLSearchParams, URL: { createObjectURL: () => "blob:fake" }, Blob: class { constructor(parts, o) { this.parts = parts; this.o = o; } }, Worker: FWorker, __pg: null };
vm.createContext(sb2);
vm.runInContext(pageJs, sb2);
const PG = sb2.__pg;
ok(PG && typeof PG.startRun === "function", "the page script runs and exposes its functions");
{
  const o = PG.parseOut("noise\nCLAIM Q1: computed=0.1736704 expected=0.1736704 match=yes\nCLAIM Q2: computed=5.5e-3 expected=5.5489e-3 match=no\nVERIFICATION SUMMARY: 2 claims, 1 match, 1 mismatch\n");
  ok(o.claims.Q1.computed === "0.1736704" && o.claims.Q2.match === "no" && o.summary === "2 claims, 1 match, 1 mismatch", "the lines the script prints are read into claims and a summary", o);
  ok(Object.keys(PG.parseOut("DERIV ok: T1\nsomething").claims).length === 0, "output in another shape gives no claim rows and no error");
  const data = { slug: "live", title: "T", version: "2.0.0", runs: [{ run_id: "run-2", cycle: "cycle-2" }, { run_id: "run-1", cycle: "cycle-1", paper_version: "1.0.0" }],
    run: { run_id: "run-2", cycle: "cycle-2", paper_version: "1.0.0", deposited: "2026-11-03", source_url: "https://github.com/QNFO/qnfo-research/tree/main/runs/cycle-2/live", script: "print(1)\nprint(2)\n", script_truncated: false,
      claims: [{ id: "Q1", statement: "First-level failure probability $p^{(1)}=0.17$" }, { id: "Q2", statement: "Barrier height" }], recorded: { exit: 1, output: "Traceback\nModuleNotFoundError: No module named 'sympy'\n[exit 1]" } } };
  PG.showRun(data);
  ok(registry.rb.hidden === false && registry.cb.children.length === 2 && registry.cb.children[0].children.length === 5, "the claim table has a row per claim and five columns");
  ok(/Paper version now: 2\.0\.0\. Script recorded for version 1\.0\.0 on 2026-11-03/.test(registry.pm.textContent), "the page says which version the script was recorded for", registry.pm.textContent);
  ok(/ended with exit 1/.test(registry.rs.textContent) && /ModuleNotFoundError/.test(registry.rec.textContent), "the recorded failure and its output are shown");
  ok(registry.csum.textContent === "Show the script (3 lines)" && registry.code.textContent === "print(1)\nprint(2)\n", "the script is shown as text");
  ok(registry.runs.all("a").some((a) => /run=run-1/.test(a.attrs.href)), "other recorded runs are linked", registry.runs.all("a").map((a) => a.attrs.href));
  // the click: the loader is fetched with the integrity hash, a worker is started, output arrives, the table fills, the run ends
  sb2.fetch = async (u, o) => { fetchCalls.push({ u, o }); return { ok: true, status: 200, text: async () => "/* pyodide loader */" }; };
  registry.run.click();
  await new Promise((r) => setTimeout(r, 50));
  ok(fetchCalls.length === 1 && fetchCalls[0].u === X.PYODIDE_BASE + "pyodide.js" && fetchCalls[0].o.integrity === X.PYODIDE_SRI && fetchCalls[0].o.mode === "cors", "the Pyodide loader is fetched from the pinned address with its integrity hash", fetchCalls[0]);
  ok(workers.length === 1 && workers[0].sent[0].code === "print(1)\nprint(2)\n" && registry.run.disabled === true && registry.stop.hidden === false, "a worker gets the script and the button is locked while it runs");
  registry.run.click();
  await new Promise((r) => setTimeout(r, 10));
  ok(workers.length === 1, "a second click while it runs starts nothing");
  const w = workers[0];
  w.onmessage({ data: { k: "status", t: "Running the script..." } });
  w.onmessage({ data: { k: "out", t: "CLAIM Q1: computed=0.1736704 expected=0.1736704 match=yes" } });
  w.onmessage({ data: { k: "out", t: "VERIFICATION SUMMARY: 2 claims, 2 match, 0 mismatch" } });
  ok(/CLAIM Q1/.test(registry.rout.textContent) && registry.rstat.textContent === "Running the script...", "output and status are shown as they arrive");
  w.onmessage({ data: { k: "done", ok: true } });
  const row = registry.cb.children[0];
  ok(row.children[2].textContent === "0.1736704" && row.children[3].textContent === "0.1736704" && row.children[4].textContent === "yes" && row.children[4].className === "yes", "the claim row is filled from the script's line", row.children.map((c) => c.textContent));
  ok(w.terminated === true && registry.run.disabled === false && registry.stop.hidden === true && /Finished in/.test(registry.rstat.textContent) && /2 claims, 2 match, 0 mismatch/.test(registry.rstat.textContent), "the worker is ended and the script's own summary is quoted", registry.rstat.textContent);
  // an error inside the script is shown, not hidden
  registry.run.click();
  await new Promise((r) => setTimeout(r, 50));
  const w2 = workers[1];
  w2.onmessage({ data: { k: "out", t: "partial" } });
  w2.onmessage({ data: { k: "done", ok: false, err: "NameError: name 'x' is not defined" } });
  ok(/NameError/.test(registry.rout.textContent) && /stopped with an error/.test(registry.rstat.textContent), "an error raised by the script is shown", registry.rstat.textContent);
  // the stop button ends a running script
  registry.run.click();
  await new Promise((r) => setTimeout(r, 50));
  const w3 = workers[2];
  registry.stop.click();
  ok(w3.terminated === true && registry.run.disabled === false && registry.rstat.textContent === "Stopped.", "the stop button ends the worker at once");
  // a loader that fails the integrity check (the fetch is refused) is reported and the button comes back
  sb2.fetch = async () => { throw new TypeError("Failed to find a valid digest in the 'integrity' attribute"); };
  registry.run.click();
  await new Promise((r) => setTimeout(r, 50));
  ok(workers.length === 3 && /could not be loaded/.test(registry.rstat.textContent) && registry.run.disabled === false, "a loader that fails its integrity check is not run", registry.rstat.textContent);
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
