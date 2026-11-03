// QUICK-READ-1 offline suite (qnfo-gateway 3.20.0, owner directive 2026-10-19, pillar reach).
// The feature: one paper presented as it answers ONE question — overview, Answers, Approach, Considerations — after
// Google Scholar's Quick Read (2026-08-25). The invariant this suite exists to hold: every statement the page shows
// quotes a sentence of the paper, and a statement whose evidence is not in the text is dropped and counted, never
// softened. Also proved here: a question the paper does not touch is answered without a model call; a failed model
// falls back to a verbatim extractive read; the cache answers the second identical question without spending; the
// GET page makes no model call (a crawler following ?q= costs nothing) while POST renders server-side; and the
// evidence anchors are the very ids the paper page publishes.
// Run: node qnfo-gateway/quick-read.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "worker.js"), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 400) : "")); } };

const BODY = [
  "---", "title: Energy Floor Of The Controller", "---", "",
  "## Abstract", "",
  "The controller ran 42 trials on the cryostat and measured 1.7 joules per solution under load, which is the main result of this paper.", "",
  "## The energy floor", "",
  "We compute the energy floor of the benchmark from the Landauer bound and compare it with the measured cost of each run.", "",
  "The margin between the two is the headroom the design buys at the thousand-qubit scale.", "",
  "## Method", "",
  "We measure the cost of every run with a calibrated joule counter and we derive the bound from the entropy of the schedule.", "",
  "## Limitations", "",
  "The measurement holds only for schedules that fit inside the controller window, and we assume the counter shares the reference of the cryostat.", "",
  "We do not measure the cost of state preparation, which limits the claim to the compiled part of the pipeline."
].join("\n");

// QUICK-READ-DIGEST-3 fixture: a top-level heading with no prose of its own, its text in the h3 under it. The map
// must carry the section's length, not "0 words".
const SLUG = "energy-floor-of-the-controller";
const papers = { [SLUG]: { slug: SLUG, title: "Energy Floor Of The Controller", body_md: BODY, abstract: "", created_at: "2026-10-01", version: "2.0.0" } };
const AFFECTED_SLUG = "can-finite-group-topological-quantum-field-theories-generate-continuous-standard";
papers[AFFECTED_SLUG] = { ...papers[SLUG], slug: AFFECTED_SLUG, updated_at: "2020-01-01T00:00:00Z" };
// QUICK-READ-DIGEST-1 fixture: the corpus shape that broke the first live map. A body whose title is its own "#"
// heading makes every real section an h3 after the renderer shifts one level down, so a map built from h2 alone listed
// the title and nothing else.
const CHAPTERED = "chaptered-work";
papers[CHAPTERED] = { slug: CHAPTERED, title: "A Chaptered Work", abstract: "", created_at: "2026-10-01", version: "1.0.0", body_md: [
  "# A Chaptered Work", "",
  "## Abstract", "", "We report the whole result of the chaptered work in this paper here.", "",
  "## Method", "", "We measure the cost of every run with a calibrated joule counter.", "",
  "## Limits", "", "The measurement holds only for schedules that fit inside the controller window."
].join("\n") };
// QUICK-READ-DIGEST-3 fixture: a top-level heading with no prose of its own, its text in the h3 under it. The map
// must carry the section's length, not "0 words".
const NESTED = "nested-work";
papers[NESTED] = { slug: NESTED, title: "Nested Work", abstract: "", created_at: "2026-10-01", version: "1.0.0", body_md: [
  "## Part One", "",
  "### Detail", "", "We measure the cost of every run with a calibrated joule counter and compare it with the bound.", "",
  "## Part Two", "", "We report the second part of the work here in one sentence that stands on its own.", "",
  "## Part Three", "", "We report the third part of the work here in one sentence that stands on its own too.", "",
  "## References", "", "[1] A reference that belongs to somebody else and is not a place to read this argument."
].join("\n") };
// A dotted slug is a real slug in this library ("x3.3-bosonic-codes-native-encoding"); the API guard must accept it.
const DOTTED = "x9.9-dotted-paper";
papers[DOTTED] = { slug: DOTTED, title: "Dotted Paper", abstract: "", created_at: "2026-10-01", version: "1.0.0", body_md: [
  "## Abstract", "", "We report one result for the dotted paper in this sentence and no more.", "",
  "## Method", "", "We measure the cost of every run with a calibrated joule counter at 4.2 millikelvin.", "",
  "## Limits", "", "The measurement holds only for schedules that fit inside the controller window."
].join("\n") };
// QUICK-READ-6 fixtures: a paper whose closest section by meaning is too short to be a passage, and one with no usable
// section at all. The first must still read the next-best sections; the second must never claim it read anything.
const SHORTY = "shorty-paper";
papers[SHORTY] = { slug: SHORTY, title: "Shorty Paper", abstract: "", created_at: "2026-10-01", version: "1.0.0", body_md: [
  "## Abstract", "", "The controller ran 42 trials on the cryostat and measured 1.7 joules per solution under load, which is the main result of this paper.", "",
  "## Whisper", "", "We do not measure the cost of state preparation.", "",
  "## Method", "", "We measure the cost of every run with a calibrated joule counter and we derive the bound from the entropy of the schedule."
].join("\n") };
const ALLSHORT = "allshort-paper";
papers[ALLSHORT] = { slug: ALLSHORT, title: "All Short Paper", abstract: "", created_at: "2026-10-01", version: "1.0.0", body_md: [
  "## Abstract", "", "We do not measure the cost of state preparation.", "",
  "## Notes", "", "Holds only for schedules."
].join("\n") };
// QUICK-READ-DIGEST-1 fixture: a paper that states its claim in a line of its own, so the digest has a claim section AND
// a number of its own to report (the first fixture's only figure sits in its abstract, which the digest shows once).
const CLAIMED = "claimed-paper";papers[CLAIMED] = { slug: CLAIMED, title: "A Claimed Result", abstract: "", created_at: "2026-10-01", version: "1.0.0", body_md: [
  "---", "title: A Claimed Result", "---", "",
  "## Abstract", "", "We compare a controller against the reference design and report how long a logical qubit survives under load.", "",
  "## Claim", "", "**Claim.** The controller keeps a logical qubit alive four times longer than the reference design at the same power.", "",
  "## Method", "", "We measure the survival of the logical qubit with a randomized benchmark at 4.2 millikelvin for 310 runs.", "",
  "## Limitations", "", "The result holds only for the surface-code patch and we do not test other codes."
].join("\n") };

let aiCalls = 0, aiOut = "", lastModel = null, lastUser = null, embedDown = false;
// The AI stub serves both models: bge-* gets embeddings (a fixed vector per known phrase, so cosine decides the section),
// everything else gets the canned completion. A question about birds and a limitations section about schedules share no
// words, which is exactly what the semantic fallback exists for.
// The AI stub serves both models: bge-* gets embeddings, everything else the canned completion. The stub tells the two
// apart by shape: one text is a question, several texts are the paper's sections (qrSemantic does exactly that), so an
// unrelated question scores 0 against every section while the bird question scores ~1 against the limitations section.
const embVec = (t, isQuestion) => {
  const s = String(t).toLowerCase();
  if (/migratory|navigate|magnetoreception/.test(s)) return [1, 0, 0, 0];
  if (/holds only for schedules|do not measure the cost of state preparation/.test(s)) return [0.95, 0.05, 0, 0];
  if (/landauer|energy floor|joule counter/.test(s)) return [0.2, 0.95, 0, 0];
  return isQuestion ? [0, 0, 0, 1] : [0, 0, 1, 0];
};
const AI = { run: async (model, input) => {
  if (model.indexOf("bge") >= 0) {
    if (embedDown) throw new Error("embedding model unavailable");
    const texts = Array.isArray(input.text) ? input.text : [input.text];
    const single = texts.length === 1; // one text is the question; the paper's sections come as one batch
    return { data: texts.map((t) => embVec(t, single)) };
  }
  aiCalls++; lastModel = model; lastUser = (input.messages && input.messages[1] && input.messages[1].content) || "";
  return { response: typeof aiOut === "function" ? aiOut() : aiOut };
} };

function mkEnv() {
  const qr = new Map(), plain = new Map();
  const plainFillQueries = [], plainFillSelections = [];
  let n = 0;
  const stmt = (sql) => {
    const st = {
      a: [], bind(...a) { st.a = a; return st; },
      async first() {
        if (/INSERT INTO ask_rate/i.test(sql)) { n++; return { n }; }
        if (/FROM quick_read/i.test(sql)) return qr.get(st.a[0] + "|" + st.a[1]) || null;
        if (/FROM plain_summary/i.test(sql)) return plain.get(st.a[0]) || null;
        if (/FROM papers/i.test(sql)) return papers[st.a[0]] || null;
        return null;
      },
      async run() {
        if (/INSERT INTO quick_read/i.test(sql)) { qr.set(st.a[0] + "|" + st.a[1], { payload: st.a[3] }); }
        if (/INSERT INTO plain_summary/i.test(sql)) { plain.set(st.a[0], { rev: st.a[1], text: st.a[2], dropped: st.a[3], grade: st.a[4] }); }
        return {};
      },
      async all() {
        if (!/FROM papers/i.test(sql)) return { results: [] };
        plainFillQueries.push(sql);
        let results = Object.values(papers).map((p) => Object.assign({}, p, { plain_rev: (plain.get(p.slug) || {}).rev || null, plain_text: (plain.get(p.slug) || {}).text || null }));
        if (/ORDER BY CASE WHEN/.test(sql)) {
          const rank = (p) => p.plain_text && /use everyday words|we must restate|output only the plain-language sentences|sorry, but i can|i cannot|i can't|i can’t|i am unable|i'm unable|i’m unable|i am not able|i'm not able|i’m not able|i apologize, but|i'm sorry|i’m sorry|unable to comply|without the necessary details/i.test(p.plain_text) ? 0 : (!p.plain_rev || !p.plain_text ? 1 : 2);
          results.sort((a, b) => rank(a) - rank(b) || String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
          const limit = Number((sql.match(/\bLIMIT\s+(\d+)/i) || [])[1] || results.length);
          results = results.slice(0, limit);
          plainFillSelections.push(results.map((p) => p.slug));
        }
        return { results };
      }
    };
    return st;
  };
  return { LIVING_PAPER: { prepare: stmt }, DB: { prepare: stmt }, AI, RELEASES: { head: async () => null }, _plain: plain, _plainFillQueries: plainFillQueries, _plainFillSelections: plainFillSelections };
}
globalThis.fetch = async () => new Response("", { status: 404 });
const gw = (await import(pathToFileURL(join(here, "worker.js")).href)).default;
const call = (env, url, init) => gw.fetch(new Request(url, init), env, { waitUntil() {} });
const qrGet = async (env, q, extra) => {
  const r = await call(env, "https://papers.qnfo.org/api/quickread/" + SLUG + "?q=" + encodeURIComponent(q) + (extra || ""));
  let body = "";
  const ct = r.headers.get("Content-Type") || "";
  if (ct.indexOf("application/json") === 0) { try { body = await r.json(); } catch (e) { body = null; } } else body = await r.text();
  return { s: r.status, j: body };
};
const qrGetSlug = async (env, slug, q, extra) => {
  const r = await call(env, "https://papers.qnfo.org/api/quickread/" + slug + "?q=" + encodeURIComponent(q) + (extra || ""));
  let body = null;
  if ((r.headers.get("Content-Type") || "").indexOf("application/json") === 0) { try { body = await r.json(); } catch (e) { body = null; } } else body = await r.text();
  return { s: r.status, j: body };
};
const postPage = async (env, q) => {
  const r = await call(env, "https://papers.qnfo.org/papers/" + SLUG + "/quickread", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "q=" + encodeURIComponent(q) });
  return { s: r.status, h: await r.text() };
};

const Q = "What did the controller measure about the energy cost of one solution?";

// ---- 1. structure: the anchors are the paper page's own ids
{
  const env = mkEnv();
  const page = await call(env, "https://papers.qnfo.org/papers/" + SLUG);
  const html = await page.text();
  const ids = [...html.matchAll(/<h[234] id="([^"]+)"/g)].map((m) => m[1]);
  ok(ids.length >= 4, "the paper page publishes section ids", ids);
  aiOut = JSON.stringify({
    overview: "The paper measures the joules one solution costs in its own benchmark.",
    answers: [{ point: "It measured 1.7 joules per solution.", evidence: "The controller ran 42 trials on the cryostat and measured 1.7 joules per solution under load, which is the main result of this paper.", section: "Abstract" }],
    approach: [{ point: "It measures cost with a calibrated joule counter.", evidence: "We measure the cost of every run with a calibrated joule counter and we derive the bound from the entropy of the schedule.", section: "Method" }],
    considerations: [{ point: "The claim is limited to the compiled part of the pipeline.", evidence: "We do not measure the cost of state preparation, which limits the claim to the compiled part of the pipeline.", section: "Limitations" }]
  });
  const r = await qrGet(env, Q);
  ok(r.s === 200 && r.j.coverage === "answered" && r.j.method === "model", "a model read answers with coverage answered", r.j);
  ok(r.j.answers.length === 1 && r.j.approach.length === 1 && r.j.considerations.length === 1, "answers, approach and considerations each carry their item", r.j);
  const anchors = r.j.answers.concat(r.j.approach, r.j.considerations).map((x) => x.section);
  ok(anchors.every((a) => ids.indexOf(a) >= 0), "every evidence anchor is an id the paper page publishes", anchors);
  ok(r.j.answers[0].section === ids[0] && r.j.considerations[0].section === "limitations", "evidence is filed under the section it was taken from", anchors);
  ok(/1.7 joules per solution/.test(r.j.answers[0].quote) && /42 trials/.test(r.j.answers[0].quote), "the quote shown is the paper's sentence", r.j.answers[0]);
  ok(lastModel === "@cf/openai/gpt-oss-120b" && /PASSAGES:/.test(lastUser) && /reasoning_effort: "low"/.test(src.slice(src.indexOf("async function qrModel"), src.indexOf("async function qrBuild"))) && /word for word/.test(src.slice(src.indexOf("function qrSystemPrompt"), src.indexOf("function qrParse"))), "QUICK-READ-3: the measured model is used with its working reasoning effort, and the prompt demands verbatim evidence");
}

// ---- 2. the invariant: unquotable statements are dropped and counted, never shown
{
  const env = mkEnv();
  aiCalls = 0;
  aiOut = JSON.stringify({
    overview: "The paper measures joules.",
    answers: [
      { point: "It measured 1.7 joules per solution.", evidence: "The controller ran 42 trials on the cryostat and measured 1.7 joules per solution under load, which is the main result of this paper." },
      { point: "It beats the published baseline by 63.5%.", evidence: "The authors report a 63.5% saving against the published baseline while keeping the same schedule." },
      { point: "It saves 63.5% of the energy.", evidence: "We compute the energy floor of the benchmark from the Landauer bound and compare it with the measured cost of each run." }
    ],
    approach: [], considerations: []
  });
  const r = await qrGet(env, Q + " (fabrication check)");
  ok(r.j.answers.length === 1, "an invented sentence and an invented figure are not shown", r.j.answers);
  ok(r.j.dropped >= 2, "both dropped statements are counted", r.j.dropped);
  ok(!/63\.5/.test(JSON.stringify(r.j.answers)), "no unverifiable figure survives in the answer", r.j.answers);
  ok(r.j.answers[0].quote === "The controller ran 42 trials on the cryostat and measured 1.7 joules per solution under load, which is the main result of this paper.", "the surviving quote is the paper's text, not the model's", r.j.answers[0]);
}

// ---- 3. a failed model still answers, from the paper's own sentences
{
  const env = mkEnv();
  aiCalls = 0;
  aiOut = "I am sorry, but I cannot help with that.";
  const r = await qrGet(env, Q + " (fallback)");
  ok(aiCalls === 1 && r.s === 200, "the model was tried once and the request still answered", { aiCalls, s: r.s });
  ok(r.j.method === "extractive" && r.j.answers.length > 0, "unparseable model output falls back to the extractive read", r.j.method);
  const bodyNorm = BODY.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  const allQuotes = r.j.answers.concat(r.j.approach, r.j.considerations).map((x) => x.quote);
  const verbatim = allQuotes.every((q) => bodyNorm.indexOf(q.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim()) >= 0);
  ok(allQuotes.length > 0 && verbatim, "every extractive quote is verbatim paper text", allQuotes);
  ok(r.j.considerations.length > 0 && /do not measure|assume|holds only/.test(r.j.considerations.map((x) => x.quote).join(" ")), "the extractive read finds the paper's own caveats", r.j.considerations);
  ok(r.j.overview && r.j.overview.length > 10, "an extractive read still carries an overview", r.j.overview);
}

// ---- 4. a question the paper never uses the words of: no model call, no invention
{
  const env = mkEnv();
  aiCalls = 0;
  const r = await qrGet(env, "How is sourdough fermentation affected by altitude?");
  ok(r.s === 200 && r.j.coverage === "none", "coverage none: no shared words and no semantic match", r.j.coverage);
  ok(aiCalls === 0, "no model call is spent on a question the paper does not touch", aiCalls);
  ok(r.j.answers.length === 0 && r.j.approach.length === 0 && r.j.considerations.length === 0, "nothing is invented for an untouched question", r.j);
  ok((r.j.closest || []).length > 0 && r.j.sections_total >= 4, "the page can name what the paper does cover", r.j.closest);
  const f = await qrGet(env, "How is sourdough fermentation affected by altitude?", "&format=html");
  ok(typeof f.j === "string" && /does not answer this question/.test(f.j) && /Nothing was generated from outside the text/.test(f.j), "the rendered page says the paper does not answer, and says nothing was invented", String(f.j).slice(0, 300));
}

// ---- 5. the cache answers the second identical question without spending a model call
{
  const env = mkEnv();
  aiCalls = 0;
  aiOut = JSON.stringify({ overview: "Measured.", answers: [{ point: "It measured 1.7 joules per solution.", evidence: "The controller ran 42 trials on the cryostat and measured 1.7 joules per solution under load, which is the main result of this paper." }], approach: [], considerations: [] });
  const a = await qrGet(env, Q + " cache me");
  const b = await qrGet(env, Q + " cache me");
  ok(aiCalls === 1 && a.j.cached === false && b.j.cached === true, "the second call is served from the cache", { aiCalls, first: a.j.cached, second: b.j.cached });
  ok(JSON.stringify(a.j.answers) === JSON.stringify(b.j.answers), "the cached answer is the same answer");
}

// ---- 6. the GET page is a shell (a crawler following ?q= spends nothing); POST renders server-side
{
  const env = mkEnv();
  aiCalls = 0;
  aiOut = JSON.stringify({ overview: "Measured.", answers: [{ point: "It measured 1.7 joules per solution.", evidence: "The controller ran 42 trials on the cryostat and measured 1.7 joules per solution under load, which is the main result of this paper." }], approach: [], considerations: [] });
  const shell = await call(env, "https://papers.qnfo.org/papers/" + SLUG + "/quickread?q=" + encodeURIComponent(Q));
  const sh = await shell.text();
  ok(shell.status === 200 && aiCalls === 0, "GET with ?q= makes no model call", aiCalls);
  ok(/id="qr-q"[^>]*value="What did the controller measure/.test(sh), "the shell carries the question in the form", sh.slice(0, 200));
  ok(/method="post"/.test(sh) && /noindex/.test(sh) && /"rendered":false/.test(sh), "the shell posts, is noindex, and tells the browser it must ask", sh.slice(0, 200));
  ok(/\/api\/quickread\//.test(sh), "the shell asks the JSON endpoint from the browser");
  const p = await postPage(env, Q);
  ok(p.s === 200 && aiCalls === 1, "POST renders the answer on the server", { s: p.s, aiCalls });
  ok(/<h2>Answers<\/h2>/.test(p.h) && /<h2>Approach<\/h2>/.test(p.h) && /<h2>Considerations<\/h2>/.test(p.h), "the POST page carries all three sections", p.h.length);
  ok(/Show details/.test(p.h) && /Quoted from the paper|Read it in the paper/.test(p.h), "each point offers its supporting detail", p.h.length);
  ok(/\d+ of \d+ sections read/.test(p.h.replace(/<[^>]+>/g, " ")), "the page discloses how much of the paper was read", (p.h.match(/\d+ of \d+ sections read[^<]*/) || [])[0]);
}

// ---- 7. rate limit: a burst of distinct questions is capped with 429
{
  const env = mkEnv();
  aiOut = JSON.stringify({ overview: "Measured.", answers: [], approach: [], considerations: [] });
  let last = null;
  for (let i = 0; i < 22; i++) last = await qrGet(env, Q + " burst " + i);
  ok(last.s === 429 && last.j.error === "rate_limited", "the per-address hourly cap answers 429", last);
}

// ---- 8. the entry points exist: index rows under a search, the paper page, and robots
{
  const env = mkEnv();
  const idx = await call(env, "https://papers.qnfo.org/papers?search=energy");
  const ih = await idx.text();
  ok(/\/papers\/[a-z0-9-]+\/quickread"/.test(ih) && !/data-qr-q=/.test(ih), "QUICK-READ-DIGEST-1: a search result's Quick read is the digest, and carries no question", ih.length);
  ok(/data-ask-q="What does/.test(ih), "the question door beside it is still Ask about it, which carries the question", (ih.match(/data-ask-q="[^"]{0,60}/) || [])[0]);
  ok(!/\/quickread\?q=/.test(ih), "the row's href carries no ?q= (ASK-CLIENT-GONE-CRAWL-1: a crawler must not walk into a model call)", (ih.match(/\/quickread[^"']*/) || [])[0]);
  const page = await call(env, "https://papers.qnfo.org/papers/" + SLUG);
  const ph = await page.text();
  ok(/\/papers\/energy-floor-of-the-controller\/quickread/.test(ph) && /Quick read/.test(ph), "the paper page offers Quick read");
  const robots = await call(env, "https://papers.qnfo.org/robots.txt");
  const rh = await robots.text();
  ok(/Disallow: \/\*quickread/.test(rh), "question pages are kept out of the crawl (they are unbounded)", rh);
}

// ---- 9. the source carries the three paths and the deadline, not one shot
{
  const block = src.slice(src.indexOf("QUICK-READ-1:BEGIN"), src.indexOf("QUICK-READ-1:END"));
  ok(/quick_read/.test(block) && /qrCacheGet/.test(block) && /qrBuild/.test(block) && /qrExtractive/.test(block), "the block carries the cache, the model read and the extractive read");
  ok(/QR_TIMEOUT_MS/.test(block) && /clearTimeout\(timer\)/.test(block), "the model call has a deadline that is cleared when it answers");
  ok(/qrNorm\(/.test(block) && /byNorm/.test(block), "evidence is matched in comparison form against the paper's own sentences");
  ok(/noindex/.test(block) && /rendered: !!fragment/.test(block), "the page is noindex and knows whether it was server-rendered");
}

// ---- 10. QUICK-READ-4: the cache key follows the paper's revision, so a correction retires the old answer
{
  const env = mkEnv();
  aiCalls = 0;
  aiOut = JSON.stringify({ overview: "Measured.", answers: [{ point: "It measured 1.7 joules per solution.", evidence: "The controller ran 42 trials on the cryostat and measured 1.7 joules per solution under load, which is the main result of this paper." }], approach: [], considerations: [] });
  const first = await qrGet(env, Q + " revision");
  const again = await qrGet(env, Q + " revision");
  papers[SLUG].version = "2.0.1";
  const revised = await qrGet(env, Q + " revision");
  ok(first.j.cached === false && again.j.cached === true, "the same paper and question is cached", { a: first.j.cached, b: again.j.cached });
  ok(revised.j.cached === false && aiCalls === 2, "a new paper version is a new key, so the correction is read again", { cached: revised.j.cached, aiCalls });
  papers[SLUG].version = "2.0.0";
}

// ---- 11. QUICK-READ-4: a question in other words is read semantically instead of being refused
{
  const env = mkEnv();
  aiCalls = 0;
  embedDown = false;
  aiOut = JSON.stringify({ overview: "Measured.", answers: [], approach: [], considerations: [] });
  const q = "How do migratory birds navigate by magnetoreception?";
  const r = await qrGet(env, q + " semantic");
  ok(r.s === 200 && r.j.coverage === "related" && r.j.retrieval === "semantic", "no shared words but a close section: coverage related, retrieval semantic", { coverage: r.j.coverage, retrieval: r.j.retrieval });
  ok(r.j.passages > 0 && (r.j.answers.length + r.j.approach.length + r.j.considerations.length) > 0, "the semantically closest sections are actually read", { passages: r.j.passages });
  const secs = r.j.answers.concat(r.j.approach, r.j.considerations).map((x) => x.section_title);
  ok(secs.indexOf("Limitations") >= 0, "the closest section by meaning is the one read", secs);
  const quotes = r.j.answers.concat(r.j.approach, r.j.considerations).map((x) => x.quote).join(" ");
  ok(/1.7 joules|holds only for schedules|do not measure/.test(quotes), "the quote is still the paper's text", quotes.slice(0, 120));
  const f = await qrGet(env, q + " semantic", "&format=html");
  ok(typeof f.j === "string" && /closest to it by meaning/.test(f.j), "the page says the words are absent and the closest sections were read");
}

// ---- 12. QUICK-READ-4: when embeddings are unavailable the honest verdict stands (no invention)
{
  const env = mkEnv();
  aiCalls = 0;
  embedDown = true;
  const r = await qrGet(env, "How do migratory birds navigate by magnetoreception? offline");
  ok(r.j.coverage === "none" && aiCalls === 0, "no embeddings and no shared words: coverage none, no model call", { coverage: r.j.coverage, aiCalls });
  embedDown = false;
}

// ---- 13. QUICK-READ-4: the audit endpoint reports the paths instead of claiming them
{
  const env = mkEnv();
  const r = await call(env, "https://papers.qnfo.org/_audit/quick-read");
  const j = await r.json();
  ok(r.status === 200 && j.ok === true && typeof j.invariant === "string", "the audit endpoint answers with its invariant", j);
  ["reads", "answered", "partial", "related", "uncovered", "written_or_partly_written", "answered_from_the_paper_only", "statements_dropped", "served_from_cache", "unreadable_payloads"].forEach((k) => {
    ok(j[k] !== undefined, "audit reports " + k, j[k]);
  });
}

// ---- 14. the source carries what the page promises
{
  const block = src.slice(src.indexOf("QUICK-READ-1:BEGIN"), src.indexOf("QUICK-READ-1:END"));
  ok(/QR_SEM_MODEL/.test(block) && /qrSemantic/.test(block) && /quick_read_vec/.test(block), "QUICK-READ-4: semantic fallback and its vector cache exist in the block");
  ok(/QR_CACHE_VERSION/.test(block) && /function qrRev/.test(block) && /updated_at/.test(block), "QUICK-READ-4: the cache key carries the paper's revision");
  ok(/handleQuickReadAudit/.test(block), "QUICK-READ-4: the audit handler lives with the feature");
  ok(src.indexOf("_audit/quick-read") > 0, "the audit route is wired");
}

// ---- 15. QUICK-READ-5: the machine-readable index carries the endpoint the feature promises
{
  const env = mkEnv();
  const r = await call(env, "https://papers.qnfo.org/openapi.json");
  const doc = await r.json();
  const paths = Object.keys((doc && doc.paths) || {});
  ok(r.status === 200 && paths.indexOf("/api/quickread/{slug}") >= 0, "openapi.json lists /api/quickread/{slug}", paths);
  const op = doc.paths["/api/quickread/{slug}"].get;
  ok(op && /q/.test(JSON.stringify(op.parameters)) && op.responses && op.responses["200"], "the entry documents q, format, fresh and the 200 shape", op && Object.keys(op.responses));
  ok(/related/.test(op.description), "the entry explains the related and none coverage states", op.description.slice(0, 80));
}

// ---- 16. QUICK-READ-6: a claim needs a passage behind it
{
  const env = mkEnv();
  embedDown = false;
  aiOut = JSON.stringify({ overview: "Measured.", answers: [], approach: [], considerations: [] });
  const short = await qrGetSlug(env, SHORTY, "How do migratory birds navigate by magnetoreception?");
  ok(short.j.coverage === "related" && short.j.passages > 0 && short.j.chars > 0, "a short closest section is skipped, the next usable sections are read", { coverage: short.j.coverage, passages: short.j.passages, chars: short.j.chars });
  ok((short.j.answers || []).concat(short.j.approach || []).every((x) => (x.quote || "").length > 40), "no passage shorter than the floor is quoted", short.j.answers);
  const none = await qrGetSlug(env, ALLSHORT, "How do migratory birds navigate by magnetoreception?");
  ok(none.j.coverage === "none" && none.j.passages === 0, "when no section has usable text the verdict is none, never related over an empty page", { coverage: none.j.coverage, passages: none.j.passages });
  const src2 = src.slice(src.indexOf("QUICK-READ-1:BEGIN"), src.indexOf("QUICK-READ-1:END"));
  ok(/function qrPick\(ranked, semantic\)/.test(src2) && /pick = qrPick\(ranked, true\)/.test(src2), "the selector takes the mode and the semantic branch passes it");
}

// ---- 17. QUICK-READ-DIGEST-1: nothing to type, nothing invented, no spend
{
  const env = mkEnv();
  aiCalls = 0;
  const r = await call(env, "https://papers.qnfo.org/papers/" + SLUG + "/quickread");
  const h = await r.text();
  ok(r.status === 200 && aiCalls === 0, "the digest page answers with no model call", { s: r.status, aiCalls });
  ok(!/id="qr-q"/.test(h) && !/name="q"/.test(h), "the digest page asks nothing: it carries no question box", (h.match(/<input[^>]*name="q"[^>]*>/) || [])[0]);
  ok(/The controller ran 42 trials on the cryostat and measured 1.7 joules per solution under load/.test(h), "the abstract, verbatim, opens the page", h.length);
  ok(/What it claims/.test(h) === false, "a paper with no claim line does not get a claim section repeating its abstract", h.length);
  ok(/Numbers it reports/.test(h) && /How it is done/.test(h) && /What would falsify it/.test(h) && /Where to read/.test(h), "the page carries the digest sections");
  ok(/its opening sentence is the claim/.test(h) && /1\.7 joules per solution/.test(h), "the abstract is shown once, named as the claim, with its figure", h.length);
  ok(/Nothing to type/.test(h) && /Ask this paper/.test(h) && /\?ask=1/.test(h), "the page says what it is, and links the question door instead of embedding one");
  const page = await call(env, "https://papers.qnfo.org/papers/" + SLUG);
  const ph = await page.text();
  const ids = [...ph.matchAll(/<h[234] id="([^"]+)"/g)].map((m) => m[1]);
  const anchors = [...h.matchAll(/href="\/papers\/energy-floor-of-the-controller#([^"]+)"/g)].map((m) => m[1]);
  ok(anchors.length >= 3 && anchors.every((a) => ids.indexOf(a) >= 0), "every digest anchor is a section id the paper page publishes", anchors);
}

// ---- 18. the digest is a different page from the question view, on the same address
{
  const env = mkEnv();
  aiOut = JSON.stringify({ overview: "Measured.", answers: [], approach: [], considerations: [] });
  const digest = await call(env, "https://papers.qnfo.org/papers/" + SLUG + "/quickread");
  const dh = await digest.text();
  const question = await call(env, "https://papers.qnfo.org/papers/" + SLUG + "/quickread?q=" + encodeURIComponent(Q));
  const qh = await question.text();
  ok(/id="qr-q"/.test(qh) && !/id="qr-q"/.test(dh), "?q= is the question view, the bare URL is the digest: one address, two different pages");
  ok(dh !== qh && /<h2>Answers<\/h2>/.test(await (await postPage(env, Q)).h), "the question view still renders Answers on the server");
}

// ---- 19. the digest is an API too, and it says where it has nothing to quote
{
  const env = mkEnv();
  aiCalls = 0;
  const r = await call(env, "https://papers.qnfo.org/api/quickread/" + SLUG);
  const j = await r.json();
  ok(r.status === 200 && j.kind === "digest" && aiCalls === 0, "the API returns the digest when no question is given, spending nothing", { s: r.status, kind: j.kind, aiCalls });
  ok(Array.isArray(j.numbers) && j.numbers.length === 0 && j.numbers_above >= 1, "a figure already shown in the abstract is not repeated below it", { numbers: j.numbers, above: j.numbers_above });
  ok(j.claim === "" && j.claim_source === "abstract" && /main result of this paper/.test(j.abstract[0]), "the abstract's opening sentence is the claim, and is not served twice", { claim: j.claim, abs: j.abstract[0] });
  const cl = await (await call(env, "https://papers.qnfo.org/api/quickread/" + CLAIMED)).json();
  ok(cl.claim_source === "paper" && /four times longer than the reference design/.test(cl.claim), "a paper that states its claim in a line of its own gets that line", cl.claim);
  ok(cl.numbers.some((x) => /4\.2 millikelvin/.test(x.quote)) && cl.numbers[0].section, "the figures of the body are quoted with their section", cl.numbers);
  const clh = await (await call(env, "https://papers.qnfo.org/papers/" + CLAIMED + "/quickread")).text();
  ok(/<h2>What it claims<\/h2>/.test(clh) && /four times longer/.test(clh), "the claim section is rendered where the paper states one");
  ok(j.map.length >= 3 && j.map.every((s) => s.words > 0 && s.minutes >= 1), "the reading map carries a length for every section", j.map);
  ok(j.limits.length >= 1 && j.limits.some((x) => /do not measure the cost of state preparation/.test(x.quote)), "where the claim stops is quoted from the paper", j.limits);
  ok(j.falsifiers.length === 0, "a paper that states no falsification criterion gets none invented", j.falsifiers);
  const fh = await (await call(env, "https://papers.qnfo.org/api/quickread/" + SLUG + "?format=html")).text();
  ok(/no explicit falsification criterion/i.test(fh), "the section says so in words instead of being left empty", fh.slice(0, 160));
  const ns = await (await call(env, "https://papers.qnfo.org/api/quickread/" + NESTED)).json();
  ok(ns.map.length === 3 && ns.map.every((m) => m.words > 0), "a heading whose prose lives in its subsections carries their words, never 0", ns.map);
  ok(ns.map[0].title === "Part One" && ns.map[0].words > 10, "the parent section's length is its own text plus what is under it", ns.map[0]);
  ok(!ns.map.some((m) => /^references/i.test(m.title)), "a reference list is not a place to read the argument, so the map leaves it out", ns.map.map((m) => m.title));
  const dt = await (await call(env, "https://papers.qnfo.org/api/quickread/" + DOTTED)).json();
  ok(dt.kind === "digest" && dt.slug === DOTTED, "a dotted slug is served, not answered bad_slug", dt.error || dt.kind);
  const ch = await (await call(env, "https://papers.qnfo.org/api/quickread/" + CHAPTERED)).json();
  ok(ch.map.length >= 3 && ch.map.every((m) => m.title !== "A Chaptered Work"), "a body whose title is its own heading still maps its real sections, and not the title", ch.map);
  const doc = await (await call(env, "https://papers.qnfo.org/openapi.json")).json();
  const op = doc.paths["/api/quickread/{slug}"].get;
  const qp = (op.parameters || []).filter((p) => p.name === "q")[0];
  ok(qp && qp.required === false && /digest/.test(qp.description), "openapi says the question is optional and describes the digest", qp);
}

// ---- 20. the source holds the two doors apart
{
  const block = src.slice(src.indexOf("QUICK-READ-DIGEST-1:BEGIN"), src.indexOf("QUICK-READ-DIGEST-1:END"));
  ok(/function qrDigest/.test(block) && /function lpQuickReadDigestHTML/.test(block) && /function qdFragment/.test(block), "the digest lives in its own block");
  ok(!/env\.AI/.test(block), "the digest block makes no model call at all");
  ok(/location\.search\.indexOf\('ask=1'\)/.test(src), "the paper page opens the Ask rail from ?ask=1, so the digest can link to a question instead of embedding one");
  ok(/title="The paper in about a minute/.test(src), "the paper page's Quick read button says what the page now does");
}

// ---- 20. PLAIN-FILL-1: plain-language summaries are built by the daily cron, never on a reader's GET
{
  const env = mkEnv();
  aiOut = "The team ran 42 trials on the cryostat. Each solution used 1.7 joules under load, which is the main result.";
  aiCalls = 0;
  await call(env, "https://papers.qnfo.org/papers/" + SLUG + "/quickread");
  await call(env, "https://papers.qnfo.org/api/quickread/" + SLUG);
  ok(aiCalls === 0 && env._plain.size === 0, "a digest GET with no cached summary spends nothing and builds nothing", { aiCalls, cached: env._plain.size });
  ok(/async function plainFill\(env(, only)?\)/.test(src) && /await plainFill\(env\)/.test(src), "the scheduled run calls plainFill");
  const m = await import(pathToFileURL(join(here, "worker.js")).href);
  ok(typeof m.default.scheduled === "function", "the worker has a scheduled handler");
  const PLAIN_FILL = new Function("return " + src.match(/var PLAIN_FILL_MAX = (\d+);/)[1])();
  aiCalls = 0;
  await m.default.scheduled({ cron: "0 6 * * *" }, env, { waitUntil() {} }).catch(() => {});
  ok(aiCalls > 0 && env._plain.size > 0 && env._plain.size <= PLAIN_FILL, "the cron builds missing summaries, at most PLAIN_FILL_MAX a run", { aiCalls, cached: env._plain.size, max: PLAIN_FILL });
  aiCalls = 0;
  const r = await call(env, "https://papers.qnfo.org/api/quickread/" + SLUG);
  const j = await r.json();
  ok(aiCalls === 0 && j.plain && /42 trials/.test(j.plain.text) && j.plain.method === "cache", "the digest then shows the cached summary with no model call", { aiCalls, plain: j.plain });
}

// ---- 21. PLAIN-RESIDUE-GATE-1: reject prompt text and revalidate only contaminated cache rows
{
  const env = mkEnv();
  aiOut = "The controller ran 42 trials on the cryostat. Each solution used 1.7 joules under load, which is the main result.";
  await gw.scheduled({ cron: "0 6 * * *" }, env, { waitUntil() {} });
  const cached = env._plain.get(SLUG);
  ok(cached && cached.rev.endsWith("|g2"), "new plain summaries carry the gate revision", cached && cached.rev);
  if (cached) {
    const legacy = { ...cached, rev: cached.rev.slice(0, cached.rev.lastIndexOf("|")) };
    env._plain.set(AFFECTED_SLUG, { ...legacy });
    for (let i = 0; i < 125; i++) {
      const slug = "plain-cache-window-" + i;
      papers[slug] = { ...papers[SLUG], slug, updated_at: "2026-10-25T23:" + String(i % 60).padStart(2, "0") + ":00Z" };
      env._plain.set(slug, { ...legacy });
    }
    aiCalls = 0;
    const legacyRead = await call(env, "https://papers.qnfo.org/api/quickread/" + AFFECTED_SLUG);
    const legacyJson = await legacyRead.json();
    ok(legacyJson.plain && legacyJson.plain.method === "cache" && aiCalls === 0, "valid legacy summaries remain fresh without a corpus-wide rebuild", { plain: legacyJson.plain, aiCalls });
    const residue = `Use everyday words and active voice; where technical term unavoidable, say what it mean in one short clause or leave out. Cover, in order: what paper set out to find, what it found (claim and key numbers), why it matters in practice. We need to restate ONE research paper titled "Can Finite-Group Topological quantum field theories generate continuous Standard Model gauge symmetry?". We must restate in plain language for reader with no background. We must cover what paper set out to find, what it found (claim and key numbers), why it matters in practice. At most 6 sentences. Hard rules: every specific number, name, date, link or DOI must already appear in text below; add nothing from memory. We must output only plain-language sentences, no heading or code fence. We must cover what paper set out to find, what it found, and why it matters. At most 1 sentence. We must obey hard rules.`;
    env._plain.set(AFFECTED_SLUG, { ...legacy, text: residue });
    const hidden = await call(env, "https://papers.qnfo.org/api/quickread/" + AFFECTED_SLUG);
    const hiddenJson = await hidden.json();
    ok(hiddenJson.plain === null, "the affected paper API hides a cached summary that echoes its prompt", hiddenJson.plain);
    aiOut = residue;
    await gw.scheduled({ cron: "0 6 * * *" }, env, { waitUntil() {} });
    const stillHidden = await call(env, "https://papers.qnfo.org/api/quickread/" + AFFECTED_SLUG);
    const stillHiddenJson = await stillHidden.json();
    ok(stillHiddenJson.plain === null, "a rejected fresh model response cannot replace the contaminated cache", stillHiddenJson.plain);
    ok(env._plainFillQueries.some((sql) => /ORDER BY CASE WHEN s\.slug IS NOT NULL AND/.test(sql) && /use everyday words/.test(sql)), "the bounded fill query prioritizes flagged caches outside the recent-paper window");
    const selected = env._plainFillSelections.slice(-1)[0] || [];
    ok(selected.length === 120 && selected.indexOf(AFFECTED_SLUG) >= 0, "the contaminated 2020 paper is selected despite 125 newer cached papers", { length: selected.length, containsAffectedPaper: selected.indexOf(AFFECTED_SLUG) >= 0 });
    aiOut = "The controller ran 42 trials on the cryostat. Each solution used 1.7 joules under load, which is the main result.";
    await gw.scheduled({ cron: "0 6 * * *" }, env, { waitUntil() {} });
    const repaired = env._plain.get(AFFECTED_SLUG);
    ok(repaired && repaired.rev.endsWith("|g2") && !/use everyday words|we must restate|output only/i.test(repaired.text), "a later valid build replaces the bad cache with a current gated summary", repaired);
    const page = await call(env, "https://papers.qnfo.org/papers/" + AFFECTED_SLUG, { headers: { Accept: "text/html" } });
    const html = await page.text();
    ok(!/Use everyday words|We must restate|We must cover|Hard rules:|At most 1 sentence|Output only the plain-language sentences/i.test(html), "the public paper page never renders the live instruction-residue sample");
    const refusal = "I\u2019m sorry, but I can\u2019t rewrite that paper without the necessary details.";
    env._plain.set(AFFECTED_SLUG, { ...repaired, text: refusal });
    const refusedApi = await call(env, "https://papers.qnfo.org/api/quickread/" + AFFECTED_SLUG);
    ok((await refusedApi.json()).plain === null, "a model refusal is not served as a reader-facing summary");
    for (const variant of ["I cannot provide a summary.", "I can’t help with this request.", "I’m unable to rewrite the paper."]) {
      env._plain.set(AFFECTED_SLUG, { ...repaired, text: variant });
      const variantApi = await call(env, "https://papers.qnfo.org/api/quickread/" + AFFECTED_SLUG);
      ok((await variantApi.json()).plain === null, "common refusal wording is rejected: " + variant);
    }
    env._plain.set(AFFECTED_SLUG, { ...repaired, text: refusal });
    aiOut = refusal;
    await gw.scheduled({ cron: "0 6 * * *" }, env, { waitUntil() {} });
    const stillRefused = await call(env, "https://papers.qnfo.org/api/quickread/" + AFFECTED_SLUG);
    ok((await stillRefused.json()).plain === null, "a fresh refusal cannot replace or pass the summary cache gate");
    ok(env._plainFillQueries.some((sql) => /sorry, but i can/.test(sql)), "the bounded fill query also selects cached refusals for repair");
    aiOut = "The controller ran 42 trials on the cryostat. Each solution used 1.7 joules under load, which is the main result.";
    await gw.scheduled({ cron: "0 6 * * *" }, env, { waitUntil() {} });
    const recovered = await call(env, "https://papers.qnfo.org/api/quickread/" + AFFECTED_SLUG);
    ok(/42 trials/.test(((await recovered.json()).plain || {}).text || ""), "a later valid summary replaces the hidden refusal");
  }
}

// ---- 22. PLAIN-RESIDUE-LIKE-1: D1 refuses a LIKE pattern over 50 bytes, so the residue gate SQL must not build one
{
  const promptMarkers = new Function("return " + src.match(/var PLAIN_PROMPT_MARKERS = (\[[^\]]*\])\.concat\(PLAIN_REFUSAL_MARKERS\);/)[1])();
  const refusalMarkers = new Function("return " + src.match(/var PLAIN_REFUSAL_MARKERS = (\[[^\]]*\]);/)[1])();
  const markers = promptMarkers.concat(refusalMarkers);
  ok(markers.some((m) => Buffer.byteLength("%" + m + "%") > 50), "a residue marker is longer than the D1 LIKE limit (the case this guards)");
  ok(!/" LIKE '%" \+ marker/.test(src) && /"instr\(" \+ lower \+ ",'" \+ marker/.test(src), "the residue markers are matched with instr, never LIKE");
  const likeLits = (src.match(/LIKE '[^']*'/g) || []).filter((l) => Buffer.byteLength(l.slice(6, -1)) > 50);
  ok(likeLits.length === 0, "no LIKE literal in the worker is over 50 bytes", likeLits);
  ok(/if \(Array\.isArray\(only\) && only\.length\) \{ var one = only\[0\]/.test(src), "a page-time fill builds only the paper it was given");
}

console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
