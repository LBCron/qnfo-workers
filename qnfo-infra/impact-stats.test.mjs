// CITATION-TRACKING-1 (RM-CITATION-TRACKING-ALL-DOIS-1, charter pillar research) offline suite. Run: node qnfo-infra/impact-stats.test.mjs   -> prints "N passed, 0 failed"
// 1. GET /indexer/stats never names a DOI under 10.5281 (NOZ-DOI-1: the registrar is closed) and carries a coverage object (public papers, eligible DOIs, scored DOIs).
// 2. runImpact counts what a null answer was (429, 5xx, timeout) per source, keeps the earlier score when both sources were cut off, and still writes a 0 for a plain 404.
// 3. The OpenAlex key, when the secret is present, is sent as api_key and appears nowhere in the result.
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const mod = await import("data:text/javascript;base64," + Buffer.from(src + "\nexport { indexerMod as __member };\n").toString("base64"));
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " -- " + JSON.stringify(x).slice(0, 500) : "")); } };

function d1(dbx) {
  const stmt = (sql) => { let args = []; const self = { bind(...a) { args = a; return self; }, async all() { return { results: dbx.prepare(sql).all(...args) }; }, async first() { return dbx.prepare(sql).get(...args) || null; }, async run() { dbx.prepare(sql).run(...args); return { success: true }; } }; return self; };
  return { prepare: stmt };
}
function mkAudit() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE citation_stats (id TEXT PRIMARY KEY, doi TEXT, source TEXT, metric TEXT, value REAL, collected_at TEXT); CREATE TABLE impact_scores (doi TEXT PRIMARY KEY, score REAL, updated_at TEXT);");
  return db;
}
function mkLiving(papers) {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE papers (slug TEXT, doi TEXT, status TEXT, created_at TEXT, body_md TEXT);");
  for (const p of papers) db.prepare("INSERT INTO papers (slug, doi, status, created_at) VALUES (?, ?, ?, ?)").run(p.slug, p.doi, p.status || "published", p.created_at || "2026-10-01 00:00:00");
  return db;
}
const dead = "10.5281/zenodo.22144215", live = "10.64898/2026.07.27.740886";
const fetchStats = async (env) => (await mod.__member.fetch(new Request("https://qnfo-infra.q08.workers.dev/stats"), env, {})).json();

{ // 1. the stats route
  const au = mkAudit(), lv = mkLiving([{ slug: "a", doi: null }, { slug: "b", doi: live, status: "external_preprint" }, { slug: "c", doi: null, status: "draft" }]);
  const now = new Date().toISOString();
  au.prepare("INSERT INTO impact_scores VALUES (?, 5.4, '2026-10-04T04:00:12.735Z')").run(dead);
  au.prepare("INSERT INTO impact_scores VALUES (?, 2, ?)").run(live, now);
  const s = await fetchStats({ LIVING_PAPER: d1(lv), QNFO_AUDIT: d1(au) });
  const text = JSON.stringify(s);
  ok(!text.includes("10.5281/"), "the route never names a registrar DOI", s);
  ok(s.top.length === 1 && s.top[0].doi === live, "only the live DOI is listed", s.top);
  ok(s.coverage && s.coverage.public_papers === 2 && s.coverage.eligible_dois === 1 && s.coverage.scored_dois === 1 && s.coverage.last_collected === now, "coverage counts public papers, eligible DOIs and DOIs scored in the last 3 days", s.coverage);
  const stale = mkAudit(); stale.prepare("INSERT INTO impact_scores VALUES (?, 2, '2026-10-17T06:30:32.208Z')").run(live);
  const s2 = await fetchStats({ LIVING_PAPER: d1(lv), QNFO_AUDIT: d1(stale) });
  ok(s2.coverage.scored_dois === 0 && s2.coverage.eligible_dois === 1, "a DOI not refreshed for 3 days is eligible but not scored", s2.coverage);
  const broken = await fetchStats({ QNFO_AUDIT: d1(au) });
  ok(Array.isArray(broken.top) && broken.coverage && broken.coverage.error, "a coverage failure never hides the list", broken);
}

const originalFetch = globalThis.fetch;
const runImpact = async (env) => (await (await mod.__member.fetch(new Request("https://qnfo-infra.q08.workers.dev/run?commit=1&limit=50", { headers: { Authorization: "Bearer t" } }), Object.assign({ IMPACT_TOKEN: "t" }, env), {})).json());
try {
  const lv = mkLiving([{ slug: "kkr", doi: live }]);
  { // 2. both sources rate-limited: the earlier score survives and the run says why
    const au = mkAudit(); au.prepare("INSERT INTO impact_scores VALUES (?, 7, '2026-11-01T06:30:00.000Z')").run(live);
    globalThis.fetch = async (input) => new Response("slow down", { status: new URL(input).hostname === "api.openalex.org" ? 429 : 503 });
    const r = await runImpact({ LIVING_PAPER: d1(lv), QNFO_AUDIT: d1(au) });
    ok(r.papers === 1 && r.skipped_unavailable === 1 && r.unavailable.openalex["429"] === 1 && r.unavailable.crossref["503"] === 1, "429 and 503 are counted per source", r);
    ok(au.prepare("SELECT score FROM impact_scores WHERE doi = ?").get(live).score === 7 && au.prepare("SELECT COUNT(*) n FROM citation_stats").get().n === 0, "the earlier score is kept and nothing is written");
  }
  { // a network failure counts as error
    const au = mkAudit();
    globalThis.fetch = async () => { throw new Error("boom"); };
    const r = await runImpact({ LIVING_PAPER: d1(lv), QNFO_AUDIT: d1(au) });
    ok(r.unavailable.openalex.error === 1 && r.unavailable.crossref.error === 1 && r.skipped_unavailable === 1, "a thrown fetch counts as error", r);
  }
  { // a plain 404 on both is a measured zero and is written, as before
    const au = mkAudit();
    globalThis.fetch = async () => new Response("{}", { status: 404 });
    const r = await runImpact({ LIVING_PAPER: d1(lv), QNFO_AUDIT: d1(au) });
    ok(r.skipped_unavailable === 0 && au.prepare("SELECT score FROM impact_scores WHERE doi = ?").get(live).score === 0, "a 404 from both sources still records a zero score", r);
  }
  { // one source answers, the other is cut off: the answer is written
    const au = mkAudit();
    globalThis.fetch = async (input) => new URL(input).hostname === "api.openalex.org" ? Response.json({ cited_by_count: 4 }) : new Response("no", { status: 500 });
    const r = await runImpact({ LIVING_PAPER: d1(lv), QNFO_AUDIT: d1(au) });
    ok(r.skipped_unavailable === 0 && au.prepare("SELECT score FROM impact_scores WHERE doi = ?").get(live).score === 4 && r.unavailable.crossref["500"] === 1, "an answered source is written even when the other failed", r);
  }
  { // 3. the key
    const au = mkAudit(); const urls = [];
    globalThis.fetch = async (input) => { urls.push(String(input)); return Response.json({ cited_by_count: 1, message: { "is-referenced-by-count": 0 } }); };
    const r = await runImpact({ LIVING_PAPER: d1(lv), QNFO_AUDIT: d1(au), OPENALEX_API_KEY: "k-secret-1" });
    ok(urls.some((u) => u.startsWith("https://api.openalex.org/") && u.includes("api_key=k-secret-1")), "the OpenAlex key is sent as api_key when the secret is present", urls);
    ok(!urls.some((u) => u.includes("crossref") && u.includes("api_key")), "the key is not sent to Crossref");
    ok(!JSON.stringify(r).includes("k-secret-1"), "the key never appears in the result");
    const urls2 = []; globalThis.fetch = async (input) => { urls2.push(String(input)); return Response.json({ cited_by_count: 1 }); };
    await runImpact({ LIVING_PAPER: d1(lv), QNFO_AUDIT: d1(mkAudit()) });
    ok(!urls2.some((u) => u.includes("api_key")), "without the secret no key parameter is sent");
  }
} finally {
  globalThis.fetch = originalFetch;
}
{ // the shipped file is the mirror
  ok(src === readFileSync(new URL("./deployed-current.worker.js", import.meta.url), "utf8"), "deployed-current.worker.js is identical to worker.js");
}
console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
