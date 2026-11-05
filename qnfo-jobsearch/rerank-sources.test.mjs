// qnfo-jobsearch offline suite for JOBSEARCH-LLM-RERANK-1 (JS-6), JOBSEARCH-SOURCES-1 (JS-7) and JOBSEARCH-NL-PUBLIC-SECTOR-1 (JS-11).
// Proves: the AI re-rank can only reorder and annotate (a deterministic guard rejects any reason that adds a number, a name or a claim, and nothing it says reaches the
// resume or note), a bad or missing answer leaves the deterministic order, the binding the first version lacked is declared, Dutch titles pass the gates, the Dutch
// public-sector readers take the sitemap route within their caps, and the SmartRecruiters reader spends detail requests only on candidate titles.
// Run: node qnfo-jobsearch/rerank-sources.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const w = (await import(pathToFileURL(join(here, "worker.js")).href)).default;
const T = w.__test;
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };
const toml = readFileSync(join(here, "wrangler.toml"), "utf8");
const src = readFileSync(join(here, "worker.js"), "utf8");

// ---- the binding the re-rank needs is declared, with props and no key copy
ok(/\[\[services\]\][^[]*binding = "QNFO_AI"[^[]*service = "qnfo-ai"[^[]*props = \{ caller = "qnfo-jobsearch" \}/.test(toml), "wrangler.toml declares the QNFO_AI service binding with props caller qnfo-jobsearch");
ok(/^\[ai\]\s*\nbinding = "AI"/m.test(toml), "wrangler.toml declares the Workers AI binding the re-rank asks first");
ok(!/env\.AI\.fetch|qnfo-ai\/infer/.test(src), "the dead /infer call is gone");
ok(src.includes("WORKERS-AI-ATTRIBUTION-1") && src.split('env = __aiAttrEnv(env, "qnfo-jobsearch", "AI", "JOBS_DB");').length - 1 === 2, "both entry handlers count the AI spend under the worker's name");
ok(src.includes("JOBSEARCH-LLM-RERANK-1") && src.includes("JOBSEARCH-NL-PUBLIC-SECTOR-1") && src.includes("JOBSEARCH-SOURCES-1"), "the issue markers are in the source");

// ---- parseRerank: only a full permutation of 1..n is accepted
ok(JSON.stringify(T.parseRerank('{"order":[2,1,3],"reasons":{"1":"first reason"}}', 3).order) === "[1,0,2]", "a permutation is accepted, 1-based to 0-based");
ok(T.parseRerank('Here you go:\n```json\n{"order":["3","1","2"]}\n```', 3).order.join() === "2,0,1", "fenced or wrapped JSON is read, string numbers too");
for (const [name, text] of [["duplicate", '{"order":[1,1,2]}'], ["missing", '{"order":[1,2]}'], ["out of range", '{"order":[1,2,4]}'], ["zero", '{"order":[0,1,2]}'], ["not json", "sorry"], ["no order", '{"reasons":{}}'], ["fractional", '{"order":[1,2,2.5]}']])
  ok(T.parseRerank(text, 3) === null, "parseRerank rejects " + name);

// ---- reasonOk: nothing the posting does not already say
const job = { title: "Senior Policy Researcher", company: "Rijkswaterstaat", location: "Den Haag", desc: "The role needs 5 years of evidence-based policy research. Work with the OECD and ministries.", match: { why: ["title in your lane: policy", "evidence in the posting: federal"] } };
ok(T.reasonOk("Policy research in a ministry setting matches the title and the federal evidence.", job) !== null, "a grounded reason is shown");
ok(T.reasonOk("The posting asks for 5 years in the OECD setting.", job) !== null, "a number and an acronym the posting contains are allowed");
for (const [name, r] of [
  ["an invented number", "The posting asks for 12 years of policy research."],
  ["an invented name", "Strong fit for the Google research team."],
  ["an invented acronym", "Works with the WHO on policy research."],
  ["first person", "I think this role suits policy research."],
  ["second person", "You led policy research before so this fits."],
  ["the candidate", "The candidate has run policy research programs."],
  ["a link", "See https://example.org for policy research details."],
  ["markup", "Policy <b>research</b> in a ministry setting."],
  ["too short", "Fits."],
  ["too long", "Policy research ".repeat(30)],
  ["a non-string", 42],
]) ok(T.reasonOk(r, job) === null, "reasonOk rejects " + name);

// ---- llmRerankRun with a stub router: reorders and annotates, touches nothing else
const mk = (n, extra = {}) => ({ id: "t:" + n, company: "Co" + n, title: "Senior Research Program Manager " + n, location: "Amsterdam", url: "https://x/" + n, desc: "Research program management, research operations, urban planning, land use and spatial planning. " + n,
  match: { status: "ok", score: 90 - n, tier: "B", clusters: ["research_mgmt", "urban_planning"], unique: false, why: ["title in your lane: research", "evidence in the posting: research_mgmt, urban_planning"], flags: ["LOCATION: x"], stretch: false }, ...extra });
const fresh = () => [mk(1), mk(2), mk(3), mk(4)];
const answer = (obj) => ({ QNFO_AI: { fetch: async (url, init) => { answer.calls.push({ url, init }); return new Response(JSON.stringify({ choices: [{ message: { content: typeof obj === "string" ? obj : JSON.stringify(obj) } }] }), { status: 200 }); } } });
answer.calls = [];
{
  const kept = fresh();
  const before = JSON.parse(JSON.stringify(kept));
  const a1 = T.artifactsFor(kept[0]);
  const r = await T.llmRerankRun(answer({ order: [3, 1, 4, 2], reasons: { 1: "Research program management matches the title and the evidence listed.", 2: "Asks for 99 years of research.", 3: "Urban planning and land use are named in the posting." } }), kept);
  ok(r.status === "reordered" && r.kept.map((j) => j.id).join() === "t:3,t:1,t:4,t:2", "the stub order is applied", r.kept.map((j) => j.id));
  ok(answer.calls.length === 1 && /\/v1\/chat\/completions$/.test(answer.calls[0].url), "one call to the router chat route");
  const sent = JSON.parse(answer.calls[0].init.body);
  ok(sent.model === "@cf/zai-org/glm-5.3-flash" && sent.max_tokens <= 2048 && sent.stream === false && sent.temperature === 0 && sent.messages[0].role === "system" && /ONLY reorder/.test(sent.messages[0].content), "a pinned cheap model, deterministic, and the reorder-only instruction", sent.model);
  ok(!/Federal Highway|rwnquni|rowan\.quni|QNFO|ledger/i.test(JSON.stringify(sent.messages)), "no ledger text or personal data is sent to the model");
  const items = JSON.parse(sent.messages[1].content);
  ok(items.every((x) => x.signals.every((s) => /^(title in the target lane|evidence in the posting)/.test(s)) && x.signals.length === 2), "only posting-fit signals are sent, without the second person", items[0]);
  ok(!/\b(you|your)\b/i.test(JSON.stringify(items)) && /third person/.test(sent.messages[0].content), "neither the items nor the instruction invite a second-person reason");
  ok(items.length === 4 && items.map((x) => x.n).join() === "1,2,3,4", "postings are sent as numbered items");
  for (const j of r.kept) {
    const o = before.find((x) => x.id === j.id);
    ok(j.title === o.title && j.company === o.company && j.location === o.location && j.desc === o.desc && j.url === o.url, "posting fields are untouched: " + j.id);
    ok(j.match.score === o.match.score && j.match.tier === o.match.tier && JSON.stringify(j.match.flags) === JSON.stringify(o.match.flags), "score, tier and flags are untouched: " + j.id);
    ok(j.match.why.slice(0, o.match.why.length).join("|") === o.match.why.join("|"), "the deterministic signals stay first: " + j.id);
    ok(j.match.why.slice(o.match.why.length).every((x) => x.startsWith("LLM: ")), "only LLM: lines are appended: " + j.id);
  }
  const why1 = r.kept.find((j) => j.id === "t:1").match.why.join(" | "), why2 = r.kept.find((j) => j.id === "t:2").match.why.join(" | "), why3 = r.kept.find((j) => j.id === "t:3").match.why.join(" | ");
  ok(/LLM: .*matches the title and the evidence/.test(why1), "a grounded reason is shown", why1);
  ok(!/99 years/.test(why2), "an invented number is not shown", why2);
  ok(/Urban planning and land use/.test(why3), "a second grounded reason is shown", why3);
  const a2 = T.artifactsFor(r.kept.find((j) => j.id === "t:1"));
  ok(a2.resume === a1.resume && a2.note === a1.note && !/LLM: /.test(a2.resume + a2.note), "the resume and note are byte-identical and carry no model word");
}
// what the owner liked, rejected or lacks never reaches the router
{
  const kept = fresh();
  kept[0].match.why.push("you rejected roles at this employer before", "looks like roles you liked: research", "not in your CV yet: quantum_energy", "past application outcomes favor these posting signals", "no seniority marker in the title");
  answer.calls.length = 0;
  await T.llmRerankRun(answer({ order: [1, 2, 3, 4] }), kept);
  const body = answer.calls[0].init.body;
  ok(!/you rejected|you liked|not in your CV|past application|seniority/.test(body) && /title in the target lane/.test(body) && /evidence in the posting/.test(body), "only posting-fit signals leave the worker", body.slice(0, 300));
}
// the rank is shown as well, so the owner can see what the AI changed
{
  const r = await T.llmRerankRun(answer({ order: [2, 1, 3, 4] }), fresh());
  ok(r.kept[0].id === "t:2" && r.kept.every((j) => j.match.why.some((x) => /^LLM: rank \d+ of 4/.test(x))), "each posting carries its AI rank", r.kept.map((j) => j.match.why));
}
// the Workers AI binding answers first; the router is the second path
{
  const aiCalls = [];
  const ai = (content, fail) => ({ AI: { run: async (model, input) => { aiCalls.push({ model, input }); if (fail) throw new Error(fail); return { choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }] }; } } });
  answer.calls.length = 0;
  let r = await T.llmRerankRun({ ...ai({ order: [2, 1, 3, 4], reasons: { 2: "Urban planning and land use are named in the posting." } }), ...answer({ order: [4, 3, 2, 1] }) }, fresh());
  ok(r.status === "reordered" && r.via === "ai" && r.kept.map((j) => j.id).join() === "t:2,t:1,t:3,t:4", "the AI binding answers and the router is not asked", { status: r.status, via: r.via });
  ok(answer.calls.length === 0 && aiCalls.length === 1, "one AI call, no router call", { router: answer.calls.length, ai: aiCalls.length });
  const sent = aiCalls[0];
  ok(sent.model === "@cf/zai-org/glm-5.3-flash" && sent.input.reasoning_effort === "low" && sent.input.max_tokens <= 2048 && sent.input.temperature === 0 && /ONLY reorder/.test(sent.input.messages[0].content), "a cheap allowed model at low reasoning, deterministic, reorder-only instruction", sent.input);
  ok(!/Federal Highway|rwnquni|rowan\.quni|QNFO|ledger/i.test(JSON.stringify(sent.input.messages)), "no ledger text or personal data is sent");
  ok(r.kept.find((j) => j.id === "t:2").match.why.some((x) => /Urban planning and land use/.test(x)), "the grounded reason is shown");
  // a failing or empty binding falls back to the router; no binding at all and a failing binding report why
  r = await T.llmRerankRun({ ...ai("", "boom"), ...answer({ order: [3, 2, 1, 4] }) }, fresh());
  ok(r.status === "reordered" && r.via === "router" && r.kept[0].id === "t:3", "a throwing AI binding falls back to the router", { status: r.status, via: r.via });
  r = await T.llmRerankRun({ ...ai(""), ...answer({ order: [4, 3, 2, 1] }) }, fresh());
  ok(r.via === "router" && r.kept[0].id === "t:4", "an empty AI answer falls back to the router");
  r = await T.llmRerankRun(ai("", "boom"), fresh());
  ok(r.status === "error" && r.kept.map((j) => j.id).join() === "t:1,t:2,t:3,t:4", "a failing AI binding with no router leaves the order and says error", r.status);
  r = await T.llmRerankRun(ai("I cannot do that."), fresh());
  ok(r.status === "bad-answer" && r.via === "ai", "prose from the AI binding leaves the order", r.status);
  r = await T.llmRerankRun(ai({ order: [1, 1, 2, 3] }), fresh());
  ok(r.status === "bad-answer", "a repeated number from the AI binding leaves the order");
  r = await T.llmRerankRun({ AI: { run: async () => ({ response: JSON.stringify({ order: [2, 1, 3, 4] }) }) } }, fresh());
  ok(r.status === "reordered" && r.via === "ai", "the plain response shape is read too");
}
// every failure leaves the deterministic order and says why
for (const [name, e, expect] of [
  ["no binding", {}, "no-binding"],
  ["http 500", { QNFO_AI: { fetch: async () => new Response("no", { status: 500 }) } }, "http-500"],
  ["a thrown fetch", { QNFO_AI: { fetch: async () => { throw new Error("down"); } } }, "error"],
  ["prose instead of json", answer("I cannot do that."), "bad-answer"],
  ["a repeated number", answer({ order: [1, 1, 2, 3] }), "bad-answer"],
  ["a missing number", answer({ order: [1, 2, 3] }), "bad-answer"],
]) {
  const kept = fresh(), ids = kept.map((j) => j.id).join();
  const r = await T.llmRerankRun(e, kept);
  ok(r.status === expect && r.kept.map((j) => j.id).join() === ids && kept.every((j) => j.match.why.length === 2), "order stands on " + name, r.status);
}
{
  const one = [mk(1)];
  ok((await T.llmRerankRun(answer({ order: [1] }), one)).status === "empty", "one posting is not sent to the model");
  const many = Array.from({ length: 30 }, (_, i) => mk(i + 1));
  const o = Array.from({ length: 25 }, (_, i) => 25 - i);
  const r = await T.llmRerankRun(answer({ order: o }), many);
  ok(r.kept.length === 30 && r.kept[0].id === "t:25" && r.kept[25].id === "t:26" && r.kept[29].id === "t:30", "only the top 25 are reordered; the rest keep their place");
}

// ---- end to end: a run with a stub router stores matches, records the status, and the drafts are unchanged by the AI
const db = new DatabaseSync(":memory:");
db.exec(readFileSync(join(here, "../migrations/2026-10-27-jobsearch.sql"), "utf8"));
const stmt = (sql, args = []) => ({ bind: (...a) => stmt(sql, a),
  run: async () => { const r = db.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } }; },
  first: async () => db.prepare(sql).get(...args) ?? null, all: async () => ({ results: db.prepare(sql).all(...args) }) });
const D1 = { prepare: (s) => stmt(s), batch: async (a) => { for (const x of a) await x.run(); return []; } };
const JOBDESC = "Lead our research program and research operations. LLM evaluation, responsible AI, public sector work, government agencies. Audit and reproducibility.";
const realFetch = globalThis.fetch;
globalThis.fetch = async (u) => {
  const j = (o) => new Response(JSON.stringify(o), { status: 200 });
  if (u.includes("api.ashbyhq.com/posting-api/job-board/openai")) return j({ jobs: ["A", "B", "C"].map((x, i) => ({ id: "a" + i, title: "Research Program Manager " + x, location: "Amsterdam", jobUrl: "https://jobs/a" + i, descriptionPlain: JOBDESC })) });
  if (u.includes("sitemap")) return new Response("<urlset><url><loc>https://www.academictransfer.com/en/jobs/1/phd-position-in-optics/</loc></url></urlset>", { status: 200 });
  return j(u.includes("lever") ? [] : { jobs: [], data: [] });
};
{
  const calls = [];
  const env = { JOBS_DB: D1, LOOP_TOKEN: "t", QNFO_AI: { fetch: async (url, init) => { calls.push(JSON.parse(init.body)); return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ order: [3, 2, 1], reasons: { 3: "Responsible AI and public sector work are named in the posting." } }) } }] }), { status: 200 }); } } };
  const pending = []; const ctx = { waitUntil: (p) => pending.push(p) };
  await w.scheduled({}, env, ctx); await Promise.all(pending);
  const rows = db.prepare("SELECT id, why_json, resume_md, note_md, verified FROM jobsearch_matches ORDER BY id").all();
  ok(rows.length === 3 && rows.every((r) => r.verified === 1), "three verified matches stored", rows.length);
  ok(calls.length === 1 && JSON.parse(calls[0].messages[1].content).length === 3, "the run asked the router once with the three postings");
  const llm = rows.map((r) => JSON.parse(r.why_json).filter((x) => x.startsWith("LLM: "))).flat();
  ok(llm.length >= 3 && llm.some((x) => /Responsible AI and public sector/.test(x)), "the AI lines are in why_json", llm);
  ok(rows.every((r) => !/LLM: /.test(r.resume_md + r.note_md)), "no stored draft contains a model line");
  ok(db.prepare("SELECT v FROM jobsearch_meta WHERE k='rerank_status'").get().v === "reordered", "the status is recorded in jobsearch_meta");
  const ops = await T.opsReport(env);
  ok(ops.rerank.status === "reordered" && ops.rerank.binding === true && ops.rerank.at, "GET /api/ops reports the re-rank", ops.rerank);
  ok(ops.rerank.via === "router", "ops names the way that answered", ops.rerank);
  const ops2 = await T.opsReport({ JOBS_DB: D1, LOOP_TOKEN: "t" });
  ok(ops2.rerank.binding === false, "ops says when the binding is missing");
  // the same run through the AI binding (the first way), counted under the worker's name
  db.exec("CREATE TABLE IF NOT EXISTS ai_call_counters (day TEXT, worker TEXT, purpose TEXT, model TEXT, calls INTEGER, errors INTEGER, in_chars INTEGER, ms INTEGER, in_tok INTEGER, out_tok INTEGER, neurons REAL, PRIMARY KEY (day, worker, purpose, model))");
  const aiRuns = [];
  const env3 = { JOBS_DB: D1, LOOP_TOKEN: "t", AI: { run: async (model, input) => { aiRuns.push(model); return { choices: [{ message: { content: JSON.stringify({ order: [1, 2, 3] }) } }], usage: { prompt_tokens: 900, completion_tokens: 120 } }; } } };
  const pending3 = []; await w.scheduled({}, env3, { waitUntil: (p) => pending3.push(p) }); await Promise.all(pending3);
  ok(aiRuns.length === 1 && aiRuns[0] === "@cf/zai-org/glm-5.3-flash", "the scheduled run asks the AI binding once", aiRuns);
  const via = db.prepare("SELECT v FROM jobsearch_meta WHERE k='rerank_via'").get();
  ok(via && via.v === "ai" && db.prepare("SELECT v FROM jobsearch_meta WHERE k='rerank_status'").get().v === "ok", "the status and the way are recorded", via);
  const metered = db.prepare("SELECT worker, calls, in_tok FROM ai_call_counters WHERE worker = 'qnfo-jobsearch'").get();
  ok(metered && metered.calls === 1 && metered.in_tok === 900, "the AI spend is counted under qnfo-jobsearch", metered);
}
// ---- JOBSEARCH-RESEARCH-PORTFOLIO-1: the three QNFO papers are added to the owner's bank once, additively, and are the owner's afterwards
{
  const bankRow = () => JSON.parse(db.prepare("SELECT v FROM jobsearch_bank WHERE k='bank'").get().v);
  let bank = bankRow();
  const titles = bank.publications.map((p) => p.title);
  ok(["Quantum Laws of Form", "Dimensionless Physics", "Proof-of-Concept for Auditable Attention using Ultrametric Tree Distances"].every((t) => titles.includes(t)), "the three research papers were added by the first run", titles);
  ok(bank.publications.filter((p) => p.title === "Quantum Laws of Form").length === 1 && bank.publications.length === 8 + 3, "no duplicates, the original eight stay", bank.publications.length);
  ok(bank.publications.every((p) => p.doi === "" ? (p.url === undefined || /^https:\/\/papers\.qnfo\.org\/papers\/[a-z0-9-]+$/.test(p.url)) : true), "an entry without a DOI carries only a papers.qnfo.org address");
  ok(db.prepare("SELECT v FROM jobsearch_meta WHERE k='research_pubs_v1'").get().v === "done", "the merge is recorded");
  // a resume for a physics-theory posting lists the new paper, and it verifies line by line
  const physics = { id: "t:phys", company: "Lab", title: "Senior Research Scientist, Quantum Foundations", location: "Amsterdam", url: "https://x", desc: "Theoretical physics, quantum field theory, renormalization and effective field theory. Research integrity and reproducibility." };
  const m = T.evaluate(physics);
  await T.applyBank(bank, 1);
  const resume = T.buildResume(physics, m.status === "ok" ? m : { clusters: ["physics_theory", "quantum_energy"] });
  ok(/Quantum Laws of Form \(2026\), https:\/\/papers\.qnfo\.org\/papers\/quantum-laws-of-form <!--PUB:P09-->/.test(resume), "the resume lists the paper with its address", resume.split("\n").filter((l) => /PUB:/.test(l)));
  ok(T.verify(resume, physics).length === 0, "the resume with the new papers verifies", T.verify(resume, physics));
  ok(T.pubLine({ title: "T", year: 2020, doi: "10.1/x", url: "https://u" }) === "T (2020), https://doi.org/10.1/x" && T.pubLine({ title: "T", year: 2020, doi: "" }) === "T (2020)", "pubLine prefers the DOI and prints nothing when there is neither");
  // the owner deletes one: it stays deleted, and the fleet's edit never rewrote the owner's verified date
  await T.mutateBank({ JOBS_DB: D1 }, (b) => { b.publications = b.publications.filter((p) => p.id !== "P10"); return b; });
  const before = JSON.parse(db.prepare("SELECT v FROM jobsearch_bank WHERE k='bank'").get().v).verified_on;
  ok((await T.ensureResearchPubs({ JOBS_DB: D1 })) === false && !bankRow().publications.some((p) => p.id === "P10"), "a paper the owner removed does not come back");
  ok(bankRow().verified_on === before, "the merge does not touch verified_on");
  // a fresh database: the merge keeps the owner's date out of it
  db.prepare("DELETE FROM jobsearch_meta WHERE k='research_pubs_v1'").run();
  const rev0 = db.prepare("SELECT rev FROM jobsearch_bank WHERE k='bank'").get().rev;
  await T.ensureResearchPubs({ JOBS_DB: D1 });
  ok(db.prepare("SELECT rev FROM jobsearch_bank WHERE k='bank'").get().rev === rev0 + 1 && bankRow().publications.some((p) => p.id === "P10") === true && bankRow().verified_on === before, "re-arming the flag adds the missing paper again and still keeps verified_on");
}
globalThis.fetch = realFetch;

// ---- Dutch titles pass the gates; Dutch noise does not
const nl = (title, loc, desc) => T.evaluate({ id: "x", company: "Rijksoverheid", title, location: loc, url: "https://x", desc: desc || "" });
for (const [title, desc] of [
  ["Senior beleidsadviseur mobiliteit", "Beleidsonderzoek en mobiliteit voor het ministerie."],
  ["Beleidsmedewerker volkshuisvesting", "Volkshuisvesting en woningmarkt bij de gemeente."],
  ["Senior onderzoeker verkeer en vervoer", "Verkeersmodel en vervoersmodel, ruimtelijke ordening."],
  ["Programmamanager ruimtelijke ordening", "Programma voor ruimtelijke ordening en gebiedsontwikkeling bij de provincie."],
]) { const r = nl(title, "Den Haag", desc); ok(r.status === "ok", "Dutch title passes: " + title, r); }
for (const title of ["Stagiair beleid", "Juridisch adviseur", "Administratief medewerker", "Verpleegkundige", "Afstudeerstage mobiliteit", "Handhaver openbare ruimte"])
  ok(nl(title, "Den Haag", "Beleid en mobiliteit.").status === "excluded", "Dutch noise is excluded: " + title);
ok(nl("Senior beleidsadviseur", "Maastricht", "Beleid.").status === "ok", "a Dutch city outside the short home list is still read as the Netherlands");

// ---- the sitemap route
ok(T.slugTitle("https://www.werkenvoornederland.nl/vacatures/projectleider-effectief-toezicht-bij-productveiligheid-chemie-NVWA-2026-4529", "wvn") === "projectleider effectief toezicht bij productveiligheid chemie", "a WVN slug becomes its title without the employer code, year and id");
ok(T.slugTitle("https://www.academictransfer.com/en/jobs/361205/postdoc-position-on-wafer-bonding/", "at") === "postdoc position on wafer bonding", "an AcademicTransfer slug becomes its title");
ok(T.sitemapUrls("<urlset><url><loc>https://a/x</loc><lastmod>2026-11-01</lastmod></url><url><loc>https://a/y?a=1&amp;b=2</loc></url></urlset>").map((u) => u.loc + "|" + u.lastmod).join(" ") === "https://a/x|2026-11-01 https://a/y?a=1&b=2|", "sitemap urls and lastmod are read, entities decoded");
ok(T.titleCandidate("Senior beleidsadviseur mobiliteit") && T.titleCandidate("Programme manager, research") && !T.titleCandidate("Stage juridisch inkoop") && !T.titleCandidate("Verpleegkundig specialist ggz") && !T.titleCandidate("Sales manager"), "titleCandidate keeps lane titles and drops noise");
{
  const WVN = T.PUBLIC_SECTOR.werkenvoornederland, AT = T.PUBLIC_SECTOR.academictransfer;
  ok(WVN.sitemap.endsWith("/sitemap-vacatures.xml") && WVN.detail <= 30 && WVN.delayMs >= 1000, "WVN: sitemap route, at most 30 posting pages, at least 1 s apart", WVN);
  ok(AT.sitemap.endsWith("/sitemap-vacancies.xml") && AT.detail === 0 && AT.delayMs >= 10000, "AcademicTransfer: sitemap only, no posting pages (its crawl delay is 10 s)", AT);
  const saved = { detail: WVN.detail, delayMs: WVN.delayMs };
  WVN.detail = 4; WVN.delayMs = 0;
  const loc = (slug) => "https://www.werkenvoornederland.nl/vacatures/" + slug;
  const sm = "<urlset>" + [
    ["stage-juridisch-inkoop-RWS-2026-1", "2026-11-04T10:00:00Z"],
    ["medewerker-opleidingsontwikkeling-DEF-2026-5430", "2026-11-04T09:00:00Z"],
    ["senior-beleidsadviseur-mobiliteit-RWS-2026-11", "2026-10-01T10:00:00Z"],
    ["onderzoeker-verkeer-en-vervoer-KIM-2026-12", "2026-10-02T10:00:00Z"],
    ["programmamanager-ruimtelijke-ordening-BZK-2026-13", "2026-10-03T10:00:00Z"],
    ["projectleider-facilitair-RWS-2026-14", "2026-11-04T11:00:00Z"],
    ["manager-bedrijfsvoering-RWS-2026-15", "2026-11-04T12:00:00Z"],
  ].map(([s, m]) => `<url><loc>${loc(s)}</loc><lastmod>${m}</lastmod></url>`).join("") + "</urlset>";
  const page = (title, city) => '<script type="application/ld+json">' + JSON.stringify({ "@type": "JobPosting", title, description: "Beleid en onderzoek.", hiringOrganization: { name: " Ministerie X " }, jobLocation: { address: { addressLocality: city } } }) + "</script>";
  const fetched = [];
  globalThis.fetch = async (u) => {
    fetched.push(u);
    if (u.endsWith("sitemap-vacatures.xml")) return new Response(sm, { status: 200 });
    if (u.includes("-RWS-2026-14")) return new Response("boom", { status: 500 });
    return new Response(page("Titel " + u.split("-").slice(-2).join("-"), "Utrecht"), { status: 200 });
  };
  let jobs = await T.FETCHERS.publicsector("werkenvoornederland");
  const pages = fetched.filter((u) => !u.endsWith(".xml"));
  ok(pages.length === 4 && fetched.length === 5, "one sitemap request and at most 4 posting pages (the cap)", fetched);
  ok(!fetched.some((u) => /stage-juridisch|opleidingsontwikkeling/.test(u)), "noise titles get no posting request");
  ok(!fetched.some((u) => /manager-bedrijfsvoering/.test(u)) && pages.every((u) => /beleidsadviseur|onderzoeker|programmamanager|projectleider/.test(u)), "lane titles are read before a generic management title, whatever its date", pages);
  const read = jobs.filter((j) => /^Titel /.test(j.title));
  ok(jobs.length === 4 && read.length === 3 && read.every((j) => j.company === "Ministerie X" && j.location === "Utrecht" && j.desc && j.id.startsWith("ps:werkenvoornederland:") && j.url.startsWith("https://www.werkenvoornederland.nl/")), "jobs carry the JSON-LD company, location and description", jobs[0]);
  // a posting page that fails is skipped; the job is still listed by its slug title
  WVN.detail = 8; fetched.length = 0;
  jobs = await T.FETCHERS.publicsector("werkenvoornederland");
  ok(jobs.some((j) => /facilitair/.test(j.title) && j.desc === "" && j.location === "Netherlands"), "a failed posting page leaves the slug title, no description", jobs.map((j) => j.title));
  // every posting page failing is a feed failure (so /api/ops shows it), an empty sitemap too
  globalThis.fetch = async (u) => (u.endsWith(".xml") ? new Response(sm, { status: 200 }) : new Response("no", { status: 500 }));
  let err = ""; try { await T.FETCHERS.publicsector("werkenvoornederland"); } catch (e) { err = String(e.message); }
  ok(/no posting page/.test(err), "all posting pages failing throws", err);
  globalThis.fetch = async () => new Response("<urlset></urlset>", { status: 200 });
  err = ""; try { await T.FETCHERS.publicsector("werkenvoornederland"); } catch (e) { err = String(e.message); }
  ok(/no vacancies/.test(err), "an empty sitemap throws", err);
  WVN.detail = saved.detail; WVN.delayMs = saved.delayMs;
  // AcademicTransfer: one request, titles from the URLs, family titles first
  fetched.length = 0;
  globalThis.fetch = async (u) => { fetched.push(u); return new Response("<urlset>" + ["361205/postdoc-position-on-wafer-bonding", "361206/senior-policy-researcher", "361207/lecturer-in-physics", "361208/programme-manager-research-office"].map((s) => `<url><loc>https://www.academictransfer.com/en/jobs/${s}/</loc></url>`).join("") + "</urlset>", { status: 200 }); };
  jobs = await T.FETCHERS.publicsector("academictransfer");
  ok(fetched.length === 1 && jobs.length >= 2 && jobs[0].title === "senior policy researcher" && jobs.every((j) => j.desc === "" && j.company.startsWith("Academic Transfer")), "AcademicTransfer: one request, family titles first, no posting pages", { fetched, titles: jobs.map((j) => j.title) });
  // EURAXESS keeps the plain listing page
  fetched.length = 0;
  globalThis.fetch = async (u) => { fetched.push(u); return new Response('<a href="/jobs/123">Senior Policy Researcher</a>', { status: 200 }); };
  jobs = await T.FETCHERS.publicsector("euraxess");
  ok(fetched.length === 1 && !/\?/.test(fetched[0]) && jobs.length === 1 && jobs[0].location === "EU", "EURAXESS: the plain listing page only, no query string", fetched);
}

// ---- SmartRecruiters
{
  const fetched = [];
  globalThis.fetch = async (u) => {
    fetched.push(u);
    if (u.endsWith("postings?limit=100")) return new Response(JSON.stringify({ content: [
      { id: "1", name: "Senior Policy Analyst", company: { name: "OECD" }, location: { city: "Paris", country: "fr" } },
      { id: "2", name: "Internal Auditor", company: { name: "OECD" }, location: { city: "Paris", country: "fr" } },
      { id: "3", name: "Head of Research Programmes", company: { name: "OECD" }, location: { city: "Paris", country: "fr", remote: true } },
    ] }), { status: 200 });
    return new Response(JSON.stringify({ postingUrl: "https://jobs.smartrecruiters.com/OECD/" + u.split("/").pop() + "-x", jobAd: { sections: { jobDescription: { text: "<p>Lead policy research</p>" }, qualifications: { text: "Statistics" } } } }), { status: 200 });
  };
  const jobs = await T.FETCHERS.smartrecruiters("oecd");
  ok(jobs.length === 3 && fetched.length === 3, "SmartRecruiters: the list and one detail request per candidate title, not for the auditor", fetched);
  ok(jobs[0].id === "sr:oecd:1" && jobs[0].location === "Paris, FR" && /Lead policy research/.test(jobs[0].desc) && jobs[0].url.includes("-x") && jobs[1].desc === "" && /\(Remote\)/.test(jobs[2].location), "jobs carry id, place, text and url", jobs);
  ok(T.feedPrefix("smartrecruiters:oecd") === "sr:oecd:" && T.BOARDS.smartrecruiters.includes("oecd") && T.BOARDS.recruitee.includes("sweco"), "the feeds are registered and expire by prefix");
}
globalThis.fetch = realFetch;
// JS-7: a board that answers 404 on every ATS is retired, not kept to fail 3 runs and turn fm-jobsearch-feed-down red (lever:mistral, 2026-11-05)
ok(!T.BOARDS.lever.includes("mistral") && T.BOARDS.lever.includes("palantir") && T.BOARDS.lever.length === 8, "the dead lever:mistral board is retired and the others stay", T.BOARDS.lever);

console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
