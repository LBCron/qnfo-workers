// QDS-1 gateway pages: the shared stylesheet is served, a missing page is an HTML page for browsers and JSON for API
// clients (NOT-FOUND-HTML-1), the privacy page states what is collected (PRIVACY-PAGE-1), and the archive and QWAV hosts
// render, redirect and answer robots/sitemap (ARCHIVE-ON-GATEWAY-1, QWAV-ON-GATEWAY-1).
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const worker = (await import(pathToFileURL(join(here, "worker.js")).href)).default;
const db = new DatabaseSync(":memory:");
// 941c245 (gateway 3.31.0) added publication/revision columns to the paper SELECT; the shim has to carry them or
// every query throws "no such column: version_semver" and six assertions fail on the mock rather than the code.
db.exec("CREATE TABLE papers (slug TEXT, title TEXT, body_md TEXT, abstract TEXT, authors TEXT, keywords TEXT, doi TEXT, created_at TEXT, updated_at TEXT, status TEXT, version TEXT, pdf_path TEXT, license TEXT, version_semver TEXT, version_count INTEGER, first_published_at TEXT, last_revised_at TEXT)");
for (const [s, t] of [["distinction-lattice-framework", "Distinction-Lattice Framework"], ["joules-per-solution-metric", "The Joules-per-Solution Metric"], ["hidden", "Hidden"]]) db.prepare("INSERT INTO papers VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(s, t, "# x", "abs", "Rowan", null, "10.1234/x.1", "2026-09-24", "2026-09-24", s === "hidden" ? "quarantined" : "published", "1", null, s === "joules-per-solution-metric" ? "CC BY 4.0" : "QNFO-ULA", "1.0.0", 1, "2026-09-24", "2026-09-24");
// D1-SHIM-NAMED-PARAMS-1: node:sqlite refuses positional binding for numbered placeholders (?1, ?2), and the worker
// numbers them (a query may also reuse ?1, as the not-found suggester does). Bind by name instead, and let a failure be
// loud: a shim that answered "no rows" on every error made a driver mismatch read as "the suggester found nothing".
const sqlBind = (stmt, sql, a) => {
  const named = /\?\d/.test(sql);
  const obj = () => Object.fromEntries(a.map((v, i) => [String(i + 1), v === undefined ? null : v]));
  return { all: () => (named ? stmt.all(obj()) : stmt.all(...a)), get: () => (named ? stmt.get(obj()) : stmt.get(...a)) };
};
const d1 = { prepare(sql) { let a = []; const st = { bind(...x) { a = x; return st; }, async all() { try { return { results: sqlBind(db.prepare(sql), sql, a).all() }; } catch (e) { console.error(JSON.stringify({ where: "qds-pages.shim.all", sql: sql.slice(0, 120), error: String(e && e.message || e) })); throw e; } }, async first() { try { return sqlBind(db.prepare(sql), sql, a).get() ?? null; } catch (e) { console.error(JSON.stringify({ where: "qds-pages.shim.first", sql: sql.slice(0, 120), error: String(e && e.message || e) })); throw e; } }, async run() { return {}; } }; return st; } };
const env = { LIVING_PAPER: d1, DB: d1, QNFO_BUCKET: { async get() { return null; } }, RELEASES: { async head() { return null; } } };
const get = async (url, accept) => { const r = await worker.fetch(new Request(url, { headers: accept ? { Accept: accept } : {} }), env, { waitUntil() {} }); return { status: r.status, ct: r.headers.get("content-type") || "", loc: r.headers.get("location"), text: await r.text() }; };
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + String(d).slice(0, 300))); } };
const css = await get("https://qnfo.org/qds.css");
ok(css.status === 200 && /text\/css/.test(css.ct) && /--q-accent/.test(css.text), "qds.css is served with the tokens");
const nfh = await get("https://papers.qnfo.org/papers/distinction-latice-framwork", "text/html");
ok(nfh.status === 404 && /text\/html/.test(nfh.ct) && /There is no paper at this address/.test(nfh.text), "a mistyped paper link is an HTML 404 for a browser", nfh.status + " " + nfh.ct);
ok(/papers\/distinction-lattice-framework/.test(nfh.text) && !/papers\/hidden/.test(nfh.text), "it suggests the closest published paper and never a hidden one");
ok(/name="robots" content="noindex"/.test(nfh.text), "the 404 page is noindex");
const nfj = await get("https://papers.qnfo.org/papers/nope", "application/json");
ok(nfj.status === 404 && /json/.test(nfj.ct) && JSON.parse(nfj.text).error === "Paper not found", "an API client still gets the JSON 404");
const nfq = await get("https://qnfo.org/does-not-exist", "text/html");
ok(nfq.status === 404 && /There is nothing at this address/.test(nfq.text), "an unknown qnfo.org path is an HTML 404");
for (const u of ["https://legal.qnfo.org/privacy", "https://qnfo.org/privacy"]) {
  const pr = await get(u, "text/html");
  ok(pr.status === 200 && /What the QNFO sites collect/.test(pr.text) && /G-LV7RHRVW6R/.test(pr.text) && /unsubscribe/.test(pr.text) && /without your network address/.test(pr.text), u + " is the privacy notice, not the licence");
}
const arc = await get("https://archive.qnfo.org/", "text/html");
ok(arc.status === 200 && /The research archive/.test(arc.text), "archive.qnfo.org renders on the gateway");
const qw = await get("https://qwav.tech/", "text/html");
ok(qw.status === 200 && /data-brand="qwav"/.test(qw.text) && /rel="canonical" href="https:\/\/qwav\.org\/"/.test(qw.text) && /design target, not (a )?measure/i.test(qw.text), "QWAV renders with one canonical and the joules figure labelled a target");
const www = await get("https://www.qwav.org/x?y=1");
ok(www.status === 301 && www.loc === "https://qwav.org/x?y=1", "www.qwav.org redirects to the apex with path and query", www.loc);
const rb = await get("https://qwav.org/robots.txt");
ok(rb.status === 200 && /text\/plain/.test(rb.ct) && /Sitemap: https:\/\/qwav\.org\/sitemap\.xml/.test(rb.text), "QWAV robots.txt is real");
const sm = await get("https://qwav.org/sitemap.xml");
ok(sm.status === 200 && /application\/xml/.test(sm.ct) && sm.text.includes("<urlset"), "QWAV sitemap.xml returns the XML urlset");
const lg = await get("https://qwav.tech/legal/license");
ok(lg.status === 301 && /^https:\/\/legal\.qnfo\.org\//.test(lg.loc), "QWAV /legal paths go to legal.qnfo.org");
const ldOf = (h) => { const m = h.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || []; for (const x of m) { try { const j = JSON.parse(x.replace(/<[^>]+>/g, "")); if (j.license || (j["@graph"] || []).some((g) => g.license)) return j.license || j["@graph"].find((g) => g.license).license; } catch (e) {} } return null; };
const ula = await get("https://papers.qnfo.org/papers/distinction-lattice-framework", "text/html");
ok(ldOf(ula.text) === "https://legal.qnfo.org/", "LICENSE-ONE-1: a QNFO-ULA paper's JSON-LD names QNFO-ULA v2.0", ldOf(ula.text));
const ccby = await get("https://papers.qnfo.org/papers/joules-per-solution-metric", "text/html");
ok(ldOf(ccby.text) === "https://creativecommons.org/licenses/by/4.0/", "LICENSE-ONE-1: a version released under CC BY 4.0 keeps that grant", ldOf(ccby.text));
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
