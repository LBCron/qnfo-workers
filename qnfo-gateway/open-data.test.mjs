// OPEN-DATA-1 offline suite (qnfo-gateway 3.12.0): OAI-PMH 2.0, JSON API, OpenAPI, dead-DOI filter.
// Run: node qnfo-gateway/open-data.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "worker.js"), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 400) : "")); } };
// NOZ-DOI-1: the retired deposit prefix is assembled so no literal identifier of it lives in the repository.
const deadList = ["10." + "5281/" + "zen" + "odo.15708823"];
ok(!/DEAD_DOIS/.test(src) && !/zeno\x64o/i.test(src), "no retired-prefix DOI list or host name in the worker");
const rows = [];
for (let i = 0; i < 130; i++) rows.push({ slug: "p" + String(i).padStart(3, "0"), title: "Paper " + i, authors: '["Rowan Brad Quni-Gudzinas","Co Author"]', abstract: "Abstract <b>" + i + "</b> & more", created_at: "2026-07-04 16:12:" + String(i % 60).padStart(2, "0"), updated_at: i < 5 ? "2026-10-02 08:52:39" : "2026-09-01 00:00:00", doi: i === 0 ? deadList[0] : i === 1 ? "10.1234/live.99999999" : "", version: "1.0.0", language: "en", keywords: "p-adic, ultrametric", license: "cc-by-4.0" });
const stmt = (sql) => { const st = { a: [], bind(...a) { st.a = a; return st; },
  async all() { const lim = st.a[st.a.length - 2], off = st.a[st.a.length - 1]; return { results: rows.slice(off, off + lim) }; },
  async first() { if (/COUNT/.test(sql)) return { n: rows.length }; if (/MIN\(/.test(sql)) return { m: "2026-07-04 16:12:00" }; const slug = st.a[st.a.length - 1]; return rows.find((r) => r.slug === slug) || null; },
  async run() { return {}; } }; return st; };
const env = { LIVING_PAPER: { prepare: stmt }, DB: { prepare: stmt }, QNFO_BUCKET: { get: async () => null } };
globalThis.fetch = async () => new Response("", { status: 404 });
const gw = (await import(pathToFileURL(join(here, "worker.js")).href)).default;
const get = async (path) => { const r = await gw.fetch(new Request("https://papers.qnfo.org" + path), env, { waitUntil() {} }); return { s: r.status, t: await r.text(), h: r.headers }; };
const err = (t) => (t.match(/<error code="([^"]+)"/) || [])[1];

let r = await get("/oai?verb=Identify");
ok(r.s === 200 && /<protocolVersion>2\.0/.test(r.t) && /<granularity>YYYY-MM-DDThh:mm:ssZ/.test(r.t) && /<deletedRecord>no/.test(r.t), "Identify", r.t);
ok(/xml/.test(r.h.get("Content-Type")), "XML content type");
ok(err((await get("/oai")).t) === "badVerb" && err((await get("/oai?verb=Nope")).t) === "badVerb", "badVerb");
ok(err((await get("/oai?verb=Identify&x=1")).t) === "badArgument", "illegal argument -> badArgument");
ok(err((await get("/oai?verb=ListRecords")).t) === "badArgument", "ListRecords needs metadataPrefix");
ok(err((await get("/oai?verb=ListRecords&metadataPrefix=marc")).t) === "cannotDisseminateFormat", "cannotDisseminateFormat");
ok(err((await get("/oai?verb=ListRecords&metadataPrefix=oai_dc&from=yesterday")).t) === "badArgument", "bad from");
ok(err((await get("/oai?verb=ListRecords&metadataPrefix=oai_dc&from=2026-01-01&until=2026-02-01T00:00:00Z")).t) === "badArgument", "mixed granularity");
ok(err((await get("/oai?verb=ListRecords&resumptionToken=zzz")).t) === "badResumptionToken", "badResumptionToken");
ok(/<setSpec>papers<\/setSpec>/.test((await get("/oai?verb=ListSets")).t), "ListSets");
ok(/oai_dc/.test((await get("/oai?verb=ListMetadataFormats")).t), "ListMetadataFormats");
r = await get("/oai?verb=ListRecords&metadataPrefix=oai_dc");
ok((r.t.match(/<record>/g) || []).length === 100, "first page is 100 records", (r.t.match(/<record>/g) || []).length);
const tok = (r.t.match(/<resumptionToken[^>]*>([^<]+)</) || [])[1];
ok(!!tok && /completeListSize="130"/.test(r.t), "resumption token with size", tok);
r = await get("/oai?verb=ListRecords&resumptionToken=" + tok);
ok((r.t.match(/<record>/g) || []).length === 30 && /<resumptionToken cursor="100"><\/resumptionToken>/.test(r.t), "last page has 30 records and an empty closing token");
ok(err((await get("/oai?verb=ListRecords&resumptionToken=" + tok + "&metadataPrefix=oai_dc")).t) === "badArgument", "token is exclusive");
r = await get("/oai?verb=GetRecord&identifier=oai:papers.qnfo.org:p001&metadataPrefix=oai_dc");
ok(/<dc:title>Paper 1<\/dc:title>/.test(r.t) && /<dc:creator>Co Author/.test(r.t) && /<dc:subject>ultrametric/.test(r.t), "GetRecord dc fields", r.t);
ok(/https:\/\/doi\.org\/10\.1234\/live\.99999999/.test(r.t), "a third-party DOI is exported");
ok(/Abstract &lt;b&gt;1&lt;\/b&gt; &amp; more/.test(r.t), "abstract is XML-escaped");
r = await get("/oai?verb=GetRecord&identifier=oai:papers.qnfo.org:p000&metadataPrefix=oai_dc");
ok(!/doi\.org/.test(r.t) && !r.t.includes(deadList[0]), "a retired-prefix DOI is never exported", r.t);
ok(err((await get("/oai?verb=GetRecord&identifier=oai:papers.qnfo.org:nope&metadataPrefix=oai_dc")).t) === "idDoesNotExist", "idDoesNotExist");
ok(/<datestamp>2026-10-02T08:52:39Z<\/datestamp>/.test((await get("/oai?verb=ListIdentifiers&metadataPrefix=oai_dc")).t), "datestamp is UTC seconds granularity");

r = await get("/api/papers?limit=10&offset=5");
const j = JSON.parse(r.t);
ok(r.s === 200 && j.total === 130 && j.items.length === 10 && /offset=15/.test(j.next) && r.h.get("Access-Control-Allow-Origin") === "*", "API list, paging, CORS", j.next);
ok(j.items.every((x) => x.id.startsWith("oai:papers.qnfo.org:") && x.license_url), "API items carry oai id and licence");
ok(JSON.parse((await get("/api/papers?limit=9999")).t).limit === 200, "limit is capped at 200");
ok((await get("/api/papers?since=junk")).s === 400, "bad since -> 400");
r = await get("/api/papers/p000");
const one = JSON.parse(r.t);
ok(one.doi === null && !JSON.stringify(one).includes(deadList[0]), "API omits a retired-prefix DOI", one.doi);
ok(one.datacite.creators[0].nameIdentifiers[0].nameIdentifier === "https://orcid.org/0009-0002-4317-5604" && one.datacite.rightsList[0].rightsIdentifier === "CC-BY-4.0", "DataCite block has ORCID and SPDX licence");
ok(JSON.parse((await get("/api/papers/p001")).t).doi === "10.1234/live.99999999", "API keeps a third-party DOI");
ok((await get("/api/papers/missing")).s === 404, "unknown slug -> 404");
ok(JSON.parse((await get("/feed.json")).t).version === "https://jsonfeed.org/version/1.1", "JSON Feed");
const oa = JSON.parse((await get("/openapi.json")).t);
ok(oa.openapi === "3.1.0" && oa.paths["/oai"] && oa.paths["/api/papers"], "OpenAPI describes the routes");
ok((await gw.fetch(new Request("https://papers.qnfo.org/oai", { method: "OPTIONS" }), env, {})).status === 204, "CORS preflight");
ok(/OAI-PMH 2\.0/.test((await get("/llms.txt")).t), "llms.txt advertises the open data endpoints");
// NOZ-DOI-1 3.14.2: abstract_markdown, abstract and version carry no retired-deposit text; a third-party DOI stays.
rows[1].abstract = "Built on the framework (DOI 10." + "5281/" + "zen" + "odo.123456) and doi.org/10.1103/PhysRevD.1.1 holds.";
rows[1].version = "0.8.1-zen" + "odo-real";
r = await get("/api/papers/" + rows[1].slug);
ok(r.s === 200 && !/10\.5281|zeno\x64o/i.test(r.t), "api record has no retired-deposit text", r.t.slice(0, 300));
ok(/Built on the framework/.test(r.t) && /^[\s\S]*"version": "0\.8\.1"/.test(r.t), "api keeps the sentence and a clean version");
// NOZ-DOI-1 3.14.3: emit-time scrub of body lines is line-local and keeps third-party DOIs.
{
  const pick = (name) => { const m = src.match(new RegExp("function " + name + "\\([^)]*\\) \\{[\\s\\S]*?\\n\\}\\n")); return m[0]; };
  const code = "var MDI_RETIRED = " + src.match(/var MDI_RETIRED = (\/.*\/i);/)[1] + ";\n" + pick("mdiCleanRetired") + pick("retiredLines") + pick("retiredTag") + "return { retiredLines, retiredTag };";
  const { retiredLines, retiredTag } = new Function(code)();
  const dead = "10." + "5281/" + "zen" + "odo.999";
  const md = "Intro  keeps  spacing.\n```\nx  =  1\n```\nSee Trilogy (DOI " + dead + ") and DOI 10.1103/PhysRevD.1.1 here.\n";
  const out = retiredLines(md);
  ok(!/10\.5281|zeno\x64o/i.test(out) && out.includes("Intro  keeps  spacing.") && out.includes("x  =  1") && out.includes("10.1103/PhysRevD.1.1"), "body scrub is line-local and keeps third-party DOIs", out);
  ok(retiredTag("0.8.1-zen" + "odo-real") === "0.8.1", "version tag cleaned");
}
// PAPER-PIDS-1 (3.45.0): per-paper reference-manager exports from the same open record.
{
  const cff = await get("/api/papers/p001.cff");
  ok(cff.s === 200 && /^cff-version: 1\.2\.0/.test(cff.t) && /text\/yaml/.test(cff.h.get("Content-Type")), "CITATION.cff served", cff.t);
  ok(/title: "Paper 1"/.test(cff.t) && /orcid: "https:\/\/orcid\.org\/0009-0002-4317-5604"/.test(cff.t) && /doi: "10\.1234\/live\.99999999"/.test(cff.t), "cff has title, owner ORCID and the live DOI", cff.t);
  const csl = await get("/api/papers/p001.csl.json");
  const item = JSON.parse(csl.t)[0];
  ok(csl.s === 200 && /citationstyles/.test(csl.h.get("Content-Type")) && item.type === "article" && item.title === "Paper 1" && item.DOI === "10.1234/live.99999999" && Array.isArray(item.author) && item.author[0].family === "Quni-Gudzinas", "CSL-JSON item", csl.t);
  const bib = await get("/api/papers/p001.bib");
  ok(bib.s === 200 && /^@article\{qnfo_p001,/.test(bib.t) && /doi = \{10\.1234\/live\.99999999\}/.test(bib.t) && /author = \{Rowan Brad Quni-Gudzinas and Co Author\}/.test(bib.t), "BibTeX entry", bib.t);
  for (const [format, api] of [["cff", cff], ["bib", bib], ["csl.json", csl]]) {
    const publicExport = await get("/papers/p001/cite." + format);
    ok(publicExport.s === 200 && publicExport.t === api.t && publicExport.h.get("Content-Type") === api.h.get("Content-Type"), "public citation route matches API " + format + " export");
  }
  ok((await get("/api/papers/nope.cff")).s === 404, "export of an unknown paper is 404");
  ok(!/10\.5281|zeno\x64o/i.test((await get("/api/papers/p000.cff")).t + (await get("/api/papers/p000.bib")).t), "exports never carry the retired DOI prefix");
  ok(JSON.parse((await get("/api/papers/p001")).t).slug === "p001", "plain /api/papers/<slug> unchanged");
}
console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
