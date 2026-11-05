// Q08-DOMAIN-FORM-1 (roadmap EK-4 and EK-5, agent_issues 1000715): a story that is clearly about policy or science is written and judged in the
// structural-reading form instead of the technical systems form; everything else keeps today's prompt byte for byte. Offline: no model, no network.
// Run: node q08-signal-engine/domain-form.test.mjs
import assert from "node:assert/strict";
import { __domain as D } from "./worker.js";

let passes = 0;
const check = (label, cond, extra) => { assert.ok(cond, label + (extra === undefined ? "" : " -- " + JSON.stringify(extra).slice(0, 300))); passes++; };

// ---- ops_config q08_domains
{
  const all = D.parseDomains(null);
  check("unset: every domain is on", all.tech && all.science && all.policy);
  check("empty string reads as the default", D.parseDomains("  ").science && D.parseDomains("").policy);
  const techOnly = D.parseDomains("tech");
  check("'tech' alone restores the earlier behaviour", techOnly.tech && !techOnly.science && !techOnly.policy);
  check("an unrecognised value turns the extra domains off", !D.parseDomains("off").science && !D.parseDomains("off").policy);
  const sci = D.parseDomains("tech, science");
  check("a list enables exactly its members", sci.science && !sci.policy);
  const pol = D.parseDomains("policy;science");
  check("separators are lenient", pol.policy && pol.science);
  check("'all' enables both", D.parseDomains("all").science && D.parseDomains("all").policy);
  let reads = 0;
  const env = { AUDIT: { prepare() { return { bind() { return { async first() { reads++; return { value: "tech,policy" }; } }; } }; } } };
  D.resetDomains();
  const first = await D.q08Domains(env);
  const second = await D.q08Domains(env);
  check("q08Domains reads ops_config once a minute", first.policy && !first.science && second === first && reads === 1, { reads });
  D.resetDomains();
  const broken = await D.q08Domains({ AUDIT: { prepare() { throw new Error("d1 overloaded"); } } });
  check("an unreadable ops_config reads as the default (all on)", broken.science && broken.policy);
  D.resetDomains();
  check("no AUDIT binding reads as the default", (await D.q08Domains({})).science === true);
}

// ---- the classifier
const BALLOT = "Voters in a small Ohio town rejected a ballot measure on a data center after the city council had approved the zoning permit. Lawmakers and the mayor argued over the ordinance, and a federal regulator is reviewing the tax subsidies.";
const STUDY = "Researchers ran a randomized clinical trial of a vaccine in 4,000 patients. The study, published in a journal, found a lower rate of disease, and the scientists say the effect on the virus needs a meta-analysis.";
const KERNEL = "A Linux kernel patch changes how the scheduler talks to the GPU driver. The compiler now inlines the cache path, and the server latency drops. A vulnerability in the runtime was fixed in the open source repository.";
{
  check("a ballot measure is policy", D.classifyDomain(BALLOT) === "policy", D.classifyDomain(BALLOT));
  check("a clinical trial is science", D.classifyDomain(STUDY) === "science", D.classifyDomain(STUDY));
  check("a kernel patch is technology", D.classifyDomain(KERNEL) === "tech");
  check("a single marker is not enough", D.classifyDomain("The city shipped a new API.") === "tech");
  check("empty text is technology", D.classifyDomain("") === "tech" && D.classifyDomain(null) === "tech");
  check("policy markers outnumbered by technology markers stay technology", D.classifyDomain(BALLOT + " " + KERNEL) === "tech");
  const d = D.parseDomains(null), techOnly = D.parseDomains("tech");
  const hn = { source: "hn", id: "1", title: "Voters reject data center" };
  const fr = { core_concept: "ballot measure", friction_point: BALLOT };
  check("a Hacker News policy story is read as policy", D.storyDomain(hn, fr, d) === "policy");
  check("with the domain disabled it reads as technology", D.storyDomain(hn, fr, techOnly) === "tech");
  check("a repository is technology whatever its text says", D.storyDomain({ source: "github", title: "x" }, fr, d) === "tech");
  check("a technology paper is technology", D.storyDomain({ source: "arxiv", title: "x" }, { friction_point: BALLOT }, d) === "tech");
  check("a candidate from the science lane carries its domain", D.storyDomain({ source: "arxiv", domain: "science" }, null, d) === "science");
  check("a lane candidate of a disabled domain reads as technology", D.storyDomain({ source: "arxiv", domain: "science" }, null, D.parseDomains("tech,policy")) === "tech");
}

// ---- rotation
{
  const d = D.parseDomains(null);
  const list = [{ source: "hn", id: "a", title: "Rust compiler news" }, { source: "arxiv", id: "b", title: "Kernel paper", abstract: "a scheduler" }, { source: "arxiv", id: "c", title: "Funding and peer review", abstract: "x", domain: "policy" }, { source: "github", id: "d", title: "repo" }];
  const out = D.preferNonTech(list, d);
  check("the first policy or science candidate moves to the front, the rest keep their order", out.map((c) => c.id).join("") === "cabd", out.map((c) => c.id));
  check("no such candidate: the list is returned as it was", D.preferNonTech(list.filter((c) => !c.domain), d).map((c) => c.id).join("") === "abd");
  check("a disabled domain is not preferred", D.preferNonTech(list, D.parseDomains("tech")) === list);
  check("rotation: every third attempt", D.DOMAIN_ROTATE === 3);
}

// ---- the second arXiv request
{
  const entry = (id, prim, title, abs) => `<entry><id>http://arxiv.org/abs/${id}v1</id><title>${title}</title><summary>${abs}</summary><arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="${prim}" scheme="http://arxiv.org/schemas/atom"/></entry>`;
  const xml = "<feed>" + [
    entry("2611.00001", "cs.CY", "Platform governance and moderation incentives", "A study of regulation and court rulings."),
    entry("2611.00002", "physics.ao-ph", "Regional climate emission scenarios", "Carbon budgets and energy policy under warming."),
    entry("2611.00003", "cs.CY", "A purely descriptive dataset", "Nothing relevant here."),
    entry("2611.00004", "cs.LG", "Cross-listed machine learning paper on policy", "Regulation of models."),
    entry("2611.00005", "econ.GN", "Wage subsidies and labor markets", "Tax and welfare effects.")
  ].join("") + "</feed>";
  const urls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => { urls.push(String(url)); return { ok: true, text: async () => xml }; };
  try {
    const rows = await D.scrapeArxivDomain({}, D.parseDomains(null));
    check("one request, for the policy and science categories", urls.length === 1 && /cat%3Acs\.CY/.test(urls[0]) && /cat%3Aphysics\.ao-ph/.test(urls[0]) && !/cat%3Acs\.DC/.test(urls[0]), urls);
    check("a paper with no domain keyword and a paper whose primary category is outside the lanes are dropped", rows.map((r) => r.id).sort().join() === "2611.00001v1,2611.00002v1,2611.00005v1", rows.map((r) => r.id));
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    check("economics and society categories are policy, the rest science", byId["2611.00001v1"].domain === "policy" && byId["2611.00005v1"].domain === "policy" && byId["2611.00002v1"].domain === "science");
    check("candidates are shaped like the technology arXiv candidates", byId["2611.00001v1"].source === "arxiv" && /^https:\/\/arxiv\.org\/abs\/2611\.00001/.test(byId["2611.00001v1"].url) && typeof byId["2611.00001v1"].abstract === "string");
    urls.length = 0;
    const sciOnly = await D.scrapeArxivDomain({}, D.parseDomains("tech,science"));
    check("with policy off only the science lane is requested and kept", sciOnly.every((r) => r.domain === "science") && !/cat%3Acs\.CY/.test(urls[0]), urls);
    urls.length = 0;
    check("tech only: no request at all", (await D.scrapeArxivDomain({}, D.parseDomains("tech"))).length === 0 && urls.length === 0);
    globalThis.fetch = async () => ({ ok: false, status: 503 });
    let threw = false; try { await D.scrapeArxivDomain({}, D.parseDomains(null)); } catch (e) { threw = /arxiv 503/.test(String(e.message)); }
    check("an arXiv error is thrown to generate(), which keeps the technology candidates", threw);
  } finally { globalThis.fetch = realFetch; }
}

// ---- the prompts
{
  const friction = { core_concept: "ballot measure", friction_point: BALLOT, signal_strength: "High" };
  const fewShot = [{ structure_md: "PROVEN-STRUCTURE-MARKER" }];
  const opts = { banned: [], ownerNotes: [], article: "", source: { source: "hn", title: "t", url: "https://example.org/a" }, background: "" };
  const tech = D.buildPrompt(friction, fewShot, [], opts);
  check("no domain: the prompt is unchanged (exemplars, no form)", /PROVEN EXEMPLAR STRUCTURES/.test(tech) && /PROVEN-STRUCTURE-MARKER/.test(tech) && !/FORM FOR THIS STORY/.test(tech));
  check("domain 'tech' is the same prompt, byte for byte", D.buildPrompt(friction, fewShot, [], { ...opts, domain: "tech" }) === tech);
  const pol = D.buildPrompt(friction, fewShot, [], { ...opts, domain: "policy" });
  check("policy: the form is the last instruction", pol.endsWith(D.domainForm("policy")) && /FORM FOR THIS STORY: policy/.test(pol));
  check("policy: the technical exemplars are not shown", !/PROVEN EXEMPLAR STRUCTURES|PROVEN-STRUCTURE-MARKER|REGISTER EXEMPLAR/.test(pol));
  check("policy: the facts rules still apply (Q08_DIRECTIVE is kept whole)", pol.startsWith(D.Q08_DIRECTIVE) && /FACTS \(hard, non-negotiable/.test(pol));
  for (const part of ["STRUCTURAL READING", "BARGAINING AND INCENTIVES", "THE STRONGEST OBJECTION", "WHAT THE COUNTING LEAVES OUT"]) check("the form asks for " + part, D.domainForm("policy").includes(part) && D.domainForm("science").includes(part));
  check("the strongest objection goes where the argument needs it, not at a fixed place", /Place it where the argument needs it/.test(D.domainForm("policy")));
  check("only the science form asks what was measured", /WHAT WAS MEASURED/.test(D.domainForm("science")) && !/WHAT WAS MEASURED/.test(D.domainForm("policy")));
  check("the form invents no technical system", /not about software/.test(D.domainForm("policy")) && /Do not invent a technical system/.test(D.domainForm("science")));
  check("technology has no form", D.domainForm("tech") === "" && D.domainForm(undefined) === "");
  check("the form is ASCII (the deploy uploads Latin-1)", /^[\x00-\x7f]*$/.test(D.domainForm("policy") + D.domainForm("science")));
}

// ---- the readers
{
  check("the technology reader prompt is untouched", /explain the system behind the story/.test(D.READER_PROMPT) && /components and how data or requests move/.test(D.READER_PROMPT));
  check("the technology final prompt is untouched", /best system-design writing for engineers/.test(D.FINAL_READER_PROMPT));
  const r = D.READER_PROMPT_DOMAIN, f = D.FINAL_READER_PROMPT_DOMAIN;
  check("the domain reader prompt differs and asks for the structural reading", r !== D.READER_PROMPT && /read the case as a structure/.test(r) && /strongest objection/.test(r) && /what the counting or the measure in the source leaves out/.test(r));
  check("the domain reader prompt drops the technology criterion", !/components and how data or requests move/.test(r) && !/design decision or constraint/.test(r));
  check("the domain reader prompt keeps the scale, the JSON contract, the opening test and the no-outside-facts rule", /Answer with exactly one JSON object/.test(r) && /score\\?": 1 to 5/.test(r) || /1 to 5/.test(r));
  check("... and the strictness words", /Be strict: a 4 must be earned/.test(r) && /Then: does it open with something concrete that happened/.test(r) && /never ask for outside facts/.test(r));
  check("the domain final prompt differs, keeps the 'at most 2' rules and the score scale", f !== D.FINAL_READER_PROMPT && /Score at most 2 when:/.test(f) && /5 = I learned something non-obvious/.test(f) && !/system-design writing for engineers/.test(f) && /what the counting leaves out/.test(f));
  check("prompts are selected by domain", D.readerPromptFor("policy") === r && D.readerPromptFor("science") === r && D.readerPromptFor("tech") === undefined && D.readerPromptFor(undefined) === undefined);
  check("final prompt selection", D.finalReaderPromptFor("science") === f && D.finalReaderPromptFor("tech") === D.FINAL_READER_PROMPT && D.finalReaderPromptFor("") === D.FINAL_READER_PROMPT);
  check("the domain prompts are ASCII", /^[\x00-\x7f]*$/.test(r + f));
}

// ---- measurement: the run row says which lane a piece came from
{
  check("source_kind carries the domain", D.sourceKindOf({ source: "arxiv", domain: "policy" }, 9000) === "arxiv-policy+fulltext" && D.sourceKindOf({ source: "hn", domain: "science" }, 10) === "hn-science+summary");
  check("a technology story keeps the earlier kind", D.sourceKindOf({ source: "hn" }, 9000) === "hn+fulltext" && D.sourceKindOf({ source: "arxiv", domain: "tech" }, 0) === "arxiv+summary");
}

// ---- generate() end to end: the first writer call of a policy story carries the policy form, a technology story does not
{
  const { DatabaseSync } = await import("node:sqlite");
  const mk = () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE engine_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, ran_at TEXT DEFAULT (datetime('now')), signals_scraped INTEGER DEFAULT 0, signals_scored INTEGER DEFAULT 0, piece_published INTEGER DEFAULT 0, top_signal TEXT, model TEXT, ms INTEGER DEFAULT 0, status TEXT, error TEXT)");
    db.exec("CREATE TABLE published_pieces (id TEXT PRIMARY KEY, signal_id TEXT, slug TEXT UNIQUE, title TEXT, body_md TEXT, body_html TEXT, core_concept TEXT, signal_source TEXT, published_at TEXT, reads INTEGER DEFAULT 0, feedback_score REAL DEFAULT 0, promoted INTEGER DEFAULT 0, sources_json TEXT, kind TEXT DEFAULT 'analysis', property TEXT)");
    db.exec("CREATE TABLE signal_log (id TEXT PRIMARY KEY, source TEXT NOT NULL, source_id TEXT, title TEXT, url TEXT, points INTEGER DEFAULT 0, num_comments INTEGER DEFAULT 0, ratio REAL DEFAULT 0, volatility_score REAL DEFAULT 0, friction_point TEXT, signal_strength TEXT, status TEXT DEFAULT 'pending', created_at TEXT DEFAULT (datetime('now')), processed_at TEXT)");
    db.exec("CREATE TABLE q08_retractions (slug TEXT PRIMARY KEY, reason TEXT, claims_json TEXT, retracted_at TEXT)");
    db.exec("CREATE TABLE prompt_pool (id TEXT PRIMARY KEY, piece_id TEXT, structure_md TEXT NOT NULL, performance_score REAL DEFAULT 0, reads INTEGER DEFAULT 0, active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')))");
    const shim = { prepare: (sql) => { let a = []; const st = { bind: (...x) => { a = x; return st; }, run: async () => { db.prepare(sql).run(...a); return { meta: {} }; }, first: async () => db.prepare(sql).get(...a) || null, all: async () => ({ results: db.prepare(sql).all(...a) }) }; return st; } };
    return { db, shim };
  };
  const realFetch = globalThis.fetch;
  const stubFor = (title, comment, domainEntries) => {
    globalThis.fetch = async (url) => {
      const u = String(url), res = (body, type) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200, headers: { "content-type": type || "application/json" } });
      if (u.includes("hn.algolia.com/api/v1/search")) return res({ hits: [{ _tags: ["story"], title, objectID: "9001", story_id: "9001", url: "https://example.org/9001", points: 300, num_comments: 120, created_at: new Date().toISOString() }] });
      if (u.includes("hn.algolia.com/api/v1/items/")) return res({ title, children: [1, 2, 3].map(() => ({ text: "<p>" + comment.repeat(6) + "</p>", children: [] })) });
      if (u.startsWith("https://example.org/")) return res("<html><body><p>" + "The council and the operators described the decision in detail. ".repeat(60) + "</p></body></html>", "text/html");
      if (u.includes("export.arxiv.org")) return res(domainEntries || "<feed></feed>", "application/atom+xml");
      return new Response("nope", { status: 500 });
    };
  };
  const run = async (title, comment, domainEntries, auditValue) => {
    const { db, shim } = mk();
    const prompts = [];
    const env = { DB: shim, AI: { run: async (model, input) => { prompts.push(String(input && input.messages && input.messages[0] && input.messages[0].content || "")); throw new Error("model offline (test)"); } } };
    if (auditValue !== undefined) env.AUDIT = { prepare() { return { bind() { return { async first() { return { value: auditValue }; } }; } }; } };
    stubFor(title, comment, domainEntries);
    D.resetDomains();
    const quiet = console.error; console.error = () => {};
    try { await worker_generate(env); } catch (e) { /* all compose models failed: expected */ } finally { console.error = quiet; }
    return { prompts, db };
  };
  const { __gen } = await import("./worker.js");
  const worker_generate = __gen.generate;
  check("generate is exported for the harness", typeof worker_generate === "function");
  try {
    const pol = await run("Voters reject a data center after the council vote", "The city council and the mayor argued over the ordinance, the zoning permit and the ballot measure, and the voters decided. ");
    check("a policy story reaches the writer with the policy form", pol.prompts.length >= 1 && /FORM FOR THIS STORY: policy/.test(pol.prompts[0]) && !/REGISTER EXEMPLAR/.test(pol.prompts[0]), pol.prompts.map((p) => p.length));
    const off = await run("Voters reject a data center after the council vote", "The city council and the mayor argued over the ordinance, the zoning permit and the ballot measure, and the voters decided. ", undefined, "tech");
    check("with ops_config q08_domains = tech the same story gets the technology prompt", off.prompts.length >= 1 && !/FORM FOR THIS STORY/.test(off.prompts[0]) && /REGISTER EXEMPLAR/.test(off.prompts[0]));
    const tech = await run("A kernel scheduler patch lands", "The Linux kernel scheduler and the GPU driver share a cache path, and the compiler inlines it. The runtime exposes the latency in the open source repository. ");
    check("a technology story keeps the technology prompt", tech.prompts.length >= 1 && !/FORM FOR THIS STORY/.test(tech.prompts[0]) && /REGISTER EXEMPLAR/.test(tech.prompts[0]));
  } finally { globalThis.fetch = realFetch; }
}
console.log("domain-form.test.mjs: " + passes + " passed");
