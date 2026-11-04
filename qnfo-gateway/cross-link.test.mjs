// CROSS-LINK-1: every QDS page links the three QNFO sites (family bar, Keep exploring, footer), the current site is marked,
// and qds.js carries the hydrator plus the injector that gives q08.org and other QDS consumers the same module.
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const worker = (await import(pathToFileURL(join(here, "worker.js")).href)).default;
const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE papers (slug TEXT, title TEXT, status TEXT)");
const d1 = { prepare(sql) { const st = { bind() { return st; }, async all() { try { return { results: db.prepare(sql).all() }; } catch (e) { return { results: [] }; } }, async first() { return null; }, async run() { return { success: true }; } }; return st; } };
const env = { LIVING_PAPER: d1, DB: d1, QNFO_BUCKET: { async get() { return null; } }, RELEASES: { async head() { return null; } } };
const get = async (url) => { const r = await worker.fetch(new Request(url, { headers: { Accept: "text/html" } }), env, { waitUntil() {} }); return { status: r.status, text: await r.text() }; };
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + String(d).slice(0, 300))); } };

for (const [url, cur] of [["https://qwav.org/", "qwav"], ["https://qnfo.org/privacy", "qnfo"]]) {
  const r = await get(url);
  ok(r.status === 200, url + " renders", r.status);
  ok(/class="q-family"/.test(r.text) && /The QNFO family/.test(r.text), url + " has the family bar");
  ok(/href="https:\/\/q08\.org\/"/.test(r.text) && /href="https:\/\/qwav\.org\/"/.test(r.text) && /href="https:\/\/qnfo\.org\/"/.test(r.text), url + " links all three sites");
  ok(/class="q-explore"/.test(r.text) && /Keep exploring/.test(r.text) && /data-q-keep="/.test(r.text), url + " has Keep exploring with the hydration hook");
  ok(new RegExp('data-fam="' + cur + '" href="[^"]+" aria-current="true"').test(r.text), url + " marks " + cur + " as the current site");
  ok(/papers\?search=/.test(r.text), url + " has topic chips into the library");
}

const qw = await get("https://qwav.org/");
ok((qw.text.match(/https:\/\/qnfo\.github\.io\//g) || []).length === 10 && /id="demos"/.test(qw.text), "the QWAV page links the ten interactive demos (QWAV-DEMOS-1)");

const lp = await get("https://papers.qnfo.org/papers");
ok(lp.status === 200 && /class="lp-fam"/.test(lp.text) && /href="https:..q08\.org.?"/.test(lp.text) && /lp-explore/.test(lp.text), "papers.qnfo.org pages (lpDoc) carry the family bar and Keep exploring (CROSS-LINK-2)", lp.status);

const js = await get("https://qnfo.org/qds.js");
ok(js.status === 200 && /qdsKeepReading/.test(js.text) && /papers\.qnfo\.org\/api\/papers/.test(js.text), "qds.js hydrates Keep exploring from the open papers API");
ok(/querySelector\('\.q-family'\)/.test(js.text) && /The QNFO family/.test(js.text) && /\\u003c/.test(js.text), "qds.js injects the module into pages qdsPage did not render");
ok(!/<\/script>/i.test(js.text), "the injected markup cannot close a script element");
try { new Function(js.text); ok(true, "qds.js parses"); } catch (e) { ok(false, "qds.js parses", e.message); }

console.log("cross-link: " + pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
