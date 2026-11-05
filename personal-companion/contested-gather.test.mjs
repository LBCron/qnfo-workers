// EK-2 offline suite (personal-companion 1.45.2, roadmap row 1749, agent_issues 1000713, charter pillar: reach).
// The EK-2 source gate (fitAnchors / contestedSourcesOk) wants three publishers, two labelled viewpoints and one non-US source for a contested topic, and until
// 1.45.2 nothing supplied them, so wikiAnchors skipped every contested candidate. Proves: the Hansard, Global Voices and GOV.UK adapters return anchors with
// the publisher's own text, ref, viewpoint and country, only for sources about the topic; the unchanged gate passes on Wikipedia plus what they return;
// a contested candidate is kept with those sources and skipped (with the reason) when they do not exist; the per-run budget bounds the fetches; the anchors
// carry viewpoint and country through fitAnchors into the writer's briefing; nothing else about topic choice changes.
// Run: node personal-companion/contested-gather.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
import { importWorker } from "./_harness-import-worker.mjs";
const IMPORT = 'import { WorkflowEntrypoint } from "cloudflare:workers";';
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const mod = await importWorker(() => (src.replace(IMPORT, "var WorkflowEntrypoint = class {};") + "\n//" + Math.random()), new URL("./", import.meta.url));
const V = mod.__verify;
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " -- " + JSON.stringify(x).slice(0, 500) : "")); } };

// ---- a scripted network: URL substring -> JSON
let calls = [];
let routes = [];
globalThis.fetch = async (url) => {
  const u = String(url);
  calls.push(u);
  for (const r of routes) if (u.indexOf(r.match) >= 0 && (!r.not || u.indexOf(r.not) < 0)) { const body = typeof r.reply === "function" ? r.reply(u) : r.reply; return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }); }
  return new Response("{}", { status: 404 });
};
const reset = (rs) => { calls = []; routes = rs; V.getSrcDiag().length = 0; };
const para = (w, n) => Array.from({ length: n }, (_, i) => "The " + w + " question " + i + " was argued on both sides with figures of 1992 and 1995.").join(" ");

const TOPIC = "Bosnian War";
const hansardDebate = {
  Overview: { ExtId: "AAAA1111-0000-0000-0000-000000000001" },
  Items: [
    { ItemType: "Contribution", AttributedTo: "None", Value: "x".repeat(300) },
    { ItemType: "Contribution", AttributedTo: "Alice Brown (Sheffield Central) (Lab)", Value: "The Bosnian War shows what happens when the Government delays. " + para("opposition", 14) },
    { ItemType: "Contribution", AttributedTo: "Bob Green (Harrow East) (Con)", Value: "The Bosnian War required patience, and the Government acted within its means. " + para("government", 14) },
    { ItemType: "Contribution", AttributedTo: "Alice Brown", Value: "A second speech by the same member must not be counted twice. " + para("repeat", 14) },
    { ItemType: "Contribution", AttributedTo: "Carol White (Edinburgh West) (LD)", Value: "On the Bosnian War the safe areas were never safe. " + para("liberal", 14) },
    { ItemType: "Timestamp", AttributedTo: "", Value: "9:00 am" }
  ]
};
const hansardRoutes = [
  { match: "hansard-api.parliament.uk/search/debates.json", reply: { Results: [{ Title: " Bosnian War: Anniversary", SittingDate: "2022-07-11T00:00:00", House: "Commons", DebateSection: "Westminster Hall", DebateSectionExtId: "AAAA1111-0000-0000-0000-000000000001" }, { Title: " Unrelated Debate", SittingDate: "2023-01-01T00:00:00", House: "Lords", DebateSectionExtId: "BBBB" }], TotalResultCount: 2 } },
  { match: "hansard-api.parliament.uk/debates/debate/AAAA1111", reply: hansardDebate }
];
const gvRoutes = [{ match: "globalvoices.org/wp-json/wp/v2/posts", reply: [
  { link: "https://globalvoices.org/2022/04/06/bosnia-remembers/", date: "2022-04-06T10:00:00", title: { rendered: "Bosnia remembers the siege" }, content: { rendered: "<p>Thirty years after the Bosnian War began, survivors in Sarajevo say the Bosnian War is not over. " + para("survivor", 40) + "</p>" } },
  { link: "https://globalvoices.org/2022/03/01/other/", date: "2022-03-01T10:00:00", title: { rendered: "A different story" }, content: { rendered: "<p>" + para("other", 40) + "</p>" } }
] }];
const govRoutes = [
  { match: "gov.uk/api/search.json", reply: { results: [{ title: "Statement on the Bosnian War anniversary", link: "/government/speeches/bosnian-war-anniversary", format: "speech", public_timestamp: "2022-07-11T09:00:00Z" }, { title: "A guidance page", link: "/guidance/x", format: "guidance" }] } },
  { match: "gov.uk/api/content/government/speeches/bosnian-war-anniversary", reply: { details: { body: "<div><p>The Bosnian War ended with Dayton, and the Bosnian War taught us about prevention. " + para("minister", 40) + "</p></div>" } } }
];

// (1) the three adapters
{
  reset([...hansardRoutes, ...gvRoutes, ...govRoutes]);
  const h = await V.fetchHansardSource(TOPIC);
  ok(h && h.viewpoint === "uk-parliament" && h.sourceCountry === "GB" && /^https:\/\/hansard\.parliament\.uk\/Commons\/2022-07-11\/debates\/AAAA1111-/.test(h.ref) && h.full === true, "Hansard: the debate whose title names the topic, with ref, viewpoint and country", h && { ref: h.ref, vp: h.viewpoint });
  ok(h && /Alice Brown \(Sheffield Central\) \(Lab\):/.test(h.text) && /Bob Green \(Harrow East\) \(Con\):/.test(h.text) && /Carol White \(Edinburgh West\) \(LD\):/.test(h.text) && (h.text.match(/Alice Brown/g) || []).length === 1, "Hansard: speeches by different members of different parties, each marked, none twice", h && h.text.slice(0, 300));
  ok(h && h.text.length <= 9000 && !/Unrelated Debate/.test(h.text) && h.text.length >= 2500, "Hansard: the unrelated debate is left out and the text is capped");
  const g = await V.fetchGlobalVoicesSource(TOPIC);
  ok(g && g.viewpoint === "global-citizen-media" && g.sourceCountry === "NL" && g.ref === "https://globalvoices.org/2022/04/06/bosnia-remembers/" && /survivors in Sarajevo/.test(g.text) && !/<p>/.test(g.text) && g.text.length >= 2500, "Global Voices: the post about the topic, in full, as plain text", g && g.ref);
  const o = await V.fetchGovUkSource(TOPIC);
  ok(o && o.viewpoint === "uk-government" && o.sourceCountry === "GB" && o.ref === "https://www.gov.uk/government/speeches/bosnian-war-anniversary" && /Dayton/.test(o.text) && !/<p>/.test(o.text), "GOV.UK: the speech about the topic, as plain text", o && o.ref);
  ok(!calls.some((u) => /guidance\/x/.test(u)), "GOV.UK: a format that is not a statement is never read");
}
// (2) relevance: a source that is not about the topic is not used
{
  reset([
    { match: "hansard-api.parliament.uk/search/debates.json", reply: { Results: [{ Title: " Planning Reform", SittingDate: "2022-01-01T00:00:00", House: "Commons", DebateSectionExtId: "CCCC" }] } },
    { match: "globalvoices.org/wp-json", reply: [{ link: "https://globalvoices.org/2022/05/05/x/", date: "2022-05-05", title: { rendered: "Football in Sarajevo" }, content: { rendered: "<p>" + para("football", 50) + " A passing mention of the Bosnian War once.</p>" } }] },
    { match: "gov.uk/api/search.json", reply: { results: [] } }
  ]);
  ok(await V.fetchHansardSource(TOPIC) === null, "Hansard: a debate whose title does not name the topic is not used");
  ok(await V.fetchGlobalVoicesSource(TOPIC) === null, "Global Voices: a single passing mention is not a source about the topic");
  ok(await V.fetchGovUkSource(TOPIC) === null, "GOV.UK: no result, no source");
  ok(V.csrcRelevant("The Bosnian war ended in 1995", "Bosnian War") && !V.csrcRelevant("A war in a bosnian village", "Bosnian War") && V.csrcRelevant("Iranian presidential election of 2009", "2009 Iranian presidential election") && !V.csrcRelevant("An election in Iran", "2009 Iranian presidential election"), "relevance: the whole name, or every significant word of a multi-word name");
  ok(V.csrcQueries("Abu Ghraib torture and prisoner abuse (2004)").join("|") === "Abu Ghraib torture and prisoner abuse|Abu Ghraib" && V.csrcQueries("Taiwan").join("|") === "Taiwan", "queries: the name, then its first two capitalised words");
}
// (3) a failing network gives nothing, not an error
{
  reset([]);
  const out = await V.gatherContestedSources({ title: TOPIC });
  ok(Array.isArray(out) && out.length === 0, "no source answers: an empty list, never a throw", out);
  ok(V.getSrcDiag().some((d) => /contested sources for Bosnian War: hansard none, globalvoices none, govuk none/.test(d)), "the run log line says which adapters answered", V.getSrcDiag().slice(-3));
}
// (4) the unchanged gate on Wikipedia plus the sources
{
  reset([...hansardRoutes, ...gvRoutes, ...govRoutes]);
  const wiki = { kind: "concept", ref: "https://en.wikipedia.org/wiki/Bosnian_War", title: TOPIC, text: "w".repeat(6000) };
  const extra = await V.gatherContestedSources({ title: TOPIC });
  ok(extra.length === 3 && V.contestedSourcesOk([wiki].concat(extra)).ok, "Wikipedia + Hansard + Global Voices + GOV.UK pass the unchanged gate", V.contestedSourcesOk([wiki].concat(extra)));
  ok(!V.contestedSourcesOk([wiki, extra[0]]).ok && V.contestedSourcesOk([wiki, extra[0], extra[1]]).ok, "two publishers fail the gate, three pass (one non-US, two labelled viewpoints)");
  const fitted = V.fitAnchors([wiki].concat(extra));
  ok(fitted.length === 4 && fitted[1].viewpoint === "uk-parliament" && fitted[1].sourceCountry === "GB" && fitted[2].viewpoint === "global-citizen-media", "the viewpoint and country survive the grounding-budget fit", fitted.map((f) => f.viewpoint));
  const block = V.anchorsBlock({ a: TOPIC }, fitted, "", "");
  ok(/source metadata \(not factual evidence\): viewpoint=uk-parliament; sourceCountry=GB/.test(block) && /viewpoint=global-citizen-media; sourceCountry=NL/.test(block), "the writer's briefing carries each source's standpoint, marked as not evidence");
}
// (5) wikiAnchors keeps a contested candidate that has sources, skips one that has none, and bounds the work
{
  const article = (t) => t + " was decided by the government and the parliament; the treaty was negotiated and the army withdrew because the policy failed, which led to a vote in the council, a campaign by the union and a ruling by the court, in order to end the war. " + para(t, 60);
  const calm = (t) => t + " was founded by the company and established by the committee; the council approved the contract and adopted the licence because the firm wanted growth, which led to a second contract, therefore the corporation, consequently, in order to compete, decided to expand, thus it grew. " + para(t, 60);
  const wikiRoutes = (titles, fn) => [
    { match: "onthisday/events", reply: { events: titles.map((t) => ({ text: t, pages: [{ title: t, normalizedtitle: t, description: fn ? "founding in 1992" : "war in 1992" }] })) } },
    { match: "list=random", reply: { query: { random: [] } } },
    { match: "exintro=1", reply: (u) => ({ query: { pages: Object.fromEntries(titles.map((t, i) => [String(i + 1), { title: t, extract: (fn || article)(t).slice(0, 700) }])) } }) },
    { match: "prop=links", reply: { query: { pages: { 1: { title: "x", links: [{ title: "Dayton Agreement" }, { title: "Sarajevo" }] } } } } },
    { match: "prop=extracts", not: "exintro", reply: (u) => { const t = decodeURIComponent((/titles=([^&]+)/.exec(u) || [])[1] || "Topic"); return { query: { pages: { 1: { title: t, extract: (fn || article)(t) } } } }; } }
  ];
  reset([...wikiRoutes([TOPIC]), ...hansardRoutes, ...gvRoutes, ...govRoutes]);
  let a = await V.wikiAnchors([], {}, 1);
  ok(a.length >= 4 && a[0].title === TOPIC && !("sources" in a[0]) && a.slice(1, 4).map((x) => new URL(x.ref).host).join(",") === "hansard.parliament.uk,globalvoices.org,www.gov.uk", "a contested candidate with sources is kept: the article first, then the independent sources", a.map((x) => x.ref));
  ok(V.contestedSourcesOk(a).ok && a.filter((x) => /wikipedia\.org/.test(x.ref)).length <= 2, "the anchor list passes the gate and holds at most one linked Wikipedia article beside the primary", a.map((x) => x.ref));
  reset([...wikiRoutes([TOPIC])]);
  a = await V.wikiAnchors([], {}, 1);
  ok(a.length === 0 && V.getSrcDiag().some((d) => /contested, only 1 full-text sources/.test(d)), "a contested candidate with no independent source is skipped, as before, and the log says why", V.getSrcDiag().slice(-4));
  const many = ["Alpha War", "Beta War", "Gamma War", "Delta War"];
  reset([...wikiRoutes(many)]);
  a = await V.wikiAnchors([], {}, 1);
  const searches = calls.filter((u) => /hansard-api\.parliament\.uk\/search/.test(u)).length;
  ok(a.length === 0 && searches === 2 && !calls.some((u) => /Gamma|Delta/.test(u) && /hansard|globalvoices|gov\.uk/.test(u)), "at most two contested candidates are given sources per run; the rest are skipped without a fetch", { searches, n: calls.length });
  reset([...wikiRoutes(["Calm Gardens"], calm)]);
  a = await V.wikiAnchors([], {}, 1);
  ok(a.length >= 1 && a[0].title === "Calm Gardens" && !calls.some((u) => /hansard|globalvoices|gov\.uk/.test(u)), "a topic that is not contested never reaches the source adapters", { n: a.length, calls: calls.filter((u) => /hansard|globalvoices|gov\.uk/.test(u)).length });
}
// (6) the closing measure: visible pieces of the last 30 days whose sources footer holds a publisher other than Wikipedia and arXiv (real SQLite, the D1 dialect)
{
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE companion_pieces (slug TEXT, created_at TEXT, anchor_json TEXT); CREATE TABLE companion_audits (slug TEXT PRIMARY KEY, verdict TEXT); CREATE TABLE companion_retractions (slug TEXT);");
  const now = Date.parse("2026-11-05T12:00:00Z"), day = 864e5, iso = (d) => new Date(now - d * day).toISOString();
  const add = (slug, ago, refs, verdict) => { db.prepare("INSERT INTO companion_pieces VALUES (?,?,?)").run(slug, iso(ago), refs === null ? "not json" : JSON.stringify({ refs })); db.prepare("INSERT INTO companion_audits VALUES (?,?)").run(slug, verdict || "pass"); };
  add("wiki-only", 1, ["https://en.wikipedia.org/wiki/A", "https://arxiv.org/abs/2401.1"]);
  add("with-hansard", 2, ["https://en.wikipedia.org/wiki/B", "https://hansard.parliament.uk/Commons/2022-07-11/debates/X/Y"]);
  add("with-gv-and-gov", 3, ["https://en.wikipedia.org/wiki/C", "https://globalvoices.org/2022/04/06/x/", "https://www.gov.uk/government/speeches/z"]);
  add("bad-json", 4, null);
  add("too-old", 45, ["https://hansard.parliament.uk/Commons/2022-07-11/debates/X/Y"]);
  add("retracted", 5, ["https://hansard.parliament.uk/Commons/2022-07-11/debates/X/Y"]); db.prepare("INSERT INTO companion_retractions VALUES (?)").run("retracted");
  add("failed-audit", 6, ["https://globalvoices.org/2022/04/06/x/"], "fail");
  const writes = [];
  const wrap = { prepare: (sql) => ({ bind: (...a) => ({ first: async () => db.prepare(sql).get(...a), run: async () => { writes.push({ sql, a }); return {}; } }) }) };
  const out = await V.writeSourceMetrics({ PERSONAL: wrap, AUDIT: wrap }, now);
  ok(out && out.pieces === 2, "two visible pieces of the last 30 days cite a publisher other than Wikipedia and arXiv (old, retracted, unaudited and malformed rows are not counted)", out);
  ok(writes.length === 1 && writes[0].a[0] === "companion_independent_source_pieces_30d" && writes[0].a[1] === "2" && /UPDATE metric_registry SET last_value/.test(writes[0].sql), "the count is written to the registered metric", writes);
  ok(await V.writeSourceMetrics({ PERSONAL: { prepare: () => { throw new Error("db down"); } }, AUDIT: wrap }, now) === null, "a read failure is logged, never thrown into the stall detector");
}
// (7) wiring that cannot be exercised here
ok(/art\.sources = extra;/.test(src) && /var cgate = contestedSourcesOk\(\[art\]\.concat\(extra\)\);/.test(src), "the unchanged gate decides whether a contested candidate is kept");
ok(src.split("var CONTESTED_TOPIC_RE").length - 1 === 1, "CONTESTED_TOPIC_RE is defined once (the earlier definition was replaced at load and never took effect)");

console.log("contested-gather: " + pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
