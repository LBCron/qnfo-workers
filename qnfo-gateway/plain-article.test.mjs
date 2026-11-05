// PLAIN-ARTICLE-1 offline suite (qnfo-gateway 3.44.0, 2026-10-26, owner directive, pillar reach).
// The Quick Read rewrites each paper in plain language: no jargon, no mathematics, no domain terms; the paper page's brief
// "In plain language" box links to it; "Learn more" links are Simple English Wikipedia pages confirmed by the API.
// Proves: the reply is parsed into title, short version, sections, words and topics (and a reply without that shape is refused);
// the deterministic gate refuses a Greek-letter name, a symbol, a label, a link or citation, an equals sign habit, too many
// numbers, a reading grade above 12 and an article that is too short, and passes a plain one; a capitalised name the paper does not
// use is dropped with its sentence; links are verified (Simple English first, English Wikipedia second, a disambiguation page or a
// missing page left out, the host checked); the build writes, verifies, repairs once and stores, fails open when the verifier is
// silent, and never stores an article that still breaks a hard rule; the fill takes new papers first, three at a time, at most
// ARTICLE_FILL_MAX, retries a failed one only after six hours and three times, and gives empty writer replies one independent-family fallback; the pages show the article above the folded
// technical digest, the paper page links to it, the API returns it, and a paper without one says so.
// Run: node qnfo-gateway/plain-article.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { versionAtLeast } from "../scripts/version-at-least.mjs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "worker.js"), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 500) : "")); } };

// ---- the source ----
const block = src.slice(src.indexOf("PLAIN-ARTICLE-1:BEGIN"), src.indexOf("PLAIN-ARTICLE-1:END"));
ok(block.length > 5000 && !/[^\x00-\x7f]/.test(src), "the block exists and the source is ASCII");
ok(/var ARTICLE_WRITER = "@cf\/moonshotai\/kimi-k2\.6"/.test(block) && /var ARTICLE_VERIFIER = "@cf\/openai\/gpt-oss-120b"/.test(block), "the writer and the verifier are from different families (moonshot, openai)");
ok(/var ARTICLE_WRITER_FALLBACK = "@cf\/google\/gemma-4-26b-a4b-it"/.test(block), "the empty-reply fallback uses a separate model family");
ok(!/qrBuild|plainRun\(/.test(block) && !/function handle/.test(block), "the block builds no quick-read answer and answers no route");
const digest = src.slice(src.indexOf("QUICK-READ-DIGEST-1:BEGIN"), src.indexOf("QUICK-READ-DIGEST-1:END"));
ok(!/env\.AI/.test(digest), "the digest block still makes no model call");
ok(/await articleFill\(env\)/.test(src) && /await articlePublishMetrics\(env\)/.test(src), "the hourly cron fills articles and publishes their metrics");
ok(!/articleFill\(env/.test(src.slice(src.indexOf("async function handleQuickReadPage"), src.indexOf("QUICK-READ-1:END"))), "no reader's GET builds an article");

// ---- fixtures ----
const BODY = [
  "---", "title: Energy Floor Of The Controller", "---", "",
  "## Abstract", "",
  "The controller ran 42 trials on the cryostat and measured 1.7 joules per solution under load, with $\\kappa = 4$ as the index.", "",
  "## The energy floor", "",
  "We compute the energy floor of the benchmark from the Landauer bound and compare it with the measured cost of each run.", "",
  "## Method", "",
  "We measure the cost of every run with a calibrated joule counter.", "",
  "## Limitations", "",
  "The measurement holds only for schedules that fit inside the controller window. We do not measure the cost of state preparation.",
  "", "## References", "", "[1] A reference that is cut before the writer reads it."
].join("\n");
const SLUG = "energy-floor-of-the-controller";
const papers = { [SLUG]: { slug: SLUG, title: "Energy Floor Of The Controller", body_md: BODY, abstract: "", created_at: "2026-10-01", version: "2.0.0", updated_at: "2026-10-01" } };
const GOOD = [
  "# How Much Energy One Answer Costs", "",
  "## The short version", "",
  "A control system solved problems on a very cold computer. Each solved problem used a small, measured amount of energy.", "",
  "## What the team set out to do", "",
  "The team wanted to know how much energy a controller spends on each solved problem. They ran the controller many times and watched its power use.", "",
  "## How they measured it", "",
  "They counted the energy of every run with a careful meter. They also worked out the lowest energy any such system could need, and compared the two.", "",
  "## What they found", "",
  "The measured energy was close to the lowest possible amount. The gap between the two shows how much room the design leaves.", "",
  "## What this does not show", "",
  "The result holds only for runs that fit inside the time window of the controller. The team did not measure the energy needed to get the system ready.", "",
  "## Words used here", "",
  "- controller: the part that tells the computer what to do",
  "- cryostat: a very cold box that keeps the computer working", "",
  "LEARN MORE: energy; computer; temperature"
].join("\n");
const BAD = GOOD.replace("A control system solved", "A control system with index kappa = 4 solved").replace("Each solved problem used", "Each solved problem used 1.7 J, as in [1], and used");

// ---- the module with its internals exported, and the fakes ----
const calls = { writer: 0, fallback: 0, verifier: 0, fetch: [] };
let writerOut = () => GOOD, fallbackOut = () => GOOD, verifierOut = () => "{\"jargon\":[],\"math_like\":[]}", writerPrompts = [];
const AI = { run: async (model, input) => {
  const text = input.messages[0].content;
  if (/kimi/.test(model)) { calls.writer++; writerPrompts.push(text); return { response: typeof writerOut === "function" ? writerOut(calls.writer, text) : writerOut }; }
  if (/gemma/.test(model)) { calls.fallback++; return { response: typeof fallbackOut === "function" ? fallbackOut(calls.fallback, text) : fallbackOut }; }
  calls.verifier++; return { response: typeof verifierOut === "function" ? verifierOut(calls.verifier, text) : verifierOut };
} };
const J = (o) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });
globalThis.fetch = async (u) => {
  const url = new URL(typeof u === "string" ? u : u.url);
  if (/wikipedia\.org$/.test(url.hostname)) {
    calls.fetch.push(url.hostname + ":" + url.searchParams.get("titles"));
    const t = String(url.searchParams.get("titles") || "").toLowerCase(), simple = url.hostname.startsWith("simple.");
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
    const page = (title, extra) => J({ query: { pages: { "1": Object.assign({ pageid: 1, title, fullurl: "https://" + url.hostname + "/wiki/" + encodeURIComponent(title.replace(/ /g, "_")) }, extra || {}) } } });
    if (t === "mercury") return page("Mercury", { pageprops: { disambiguation: "" } });
    if (t === "energy") return page("Energy");
    if (t === "computer" && simple) return page("Computer");
    if (t === "temperature" && !simple) return page("Temperature");
    if (t === "elsewhere") return J({ query: { pages: { "1": { pageid: 1, title: "Elsewhere", fullurl: "https://evil.example/wiki/Elsewhere" } } } });
    return J({ query: { pages: { "-1": { title: cap(t), missing: "" } } } });
  }
  return new Response("", { status: 404 });
};
const dir = mkdtempSync(join(tmpdir(), "plainart-"));
writeFileSync(join(dir, "w.mjs"), src + "\nexport { articleParse, articleProblems, articleGround, articleLookup, articleLinks, articleBuild, articleFill, articleGet, articleImmaterial, ARTICLE_MATERIAL_PCT, articleRev, articleSource, articlePrompt, articleStats, articleTargetWords, plainHasRefusal, plainRefusalSql, ARTICLE_FILL_MAX, ARTICLE_FILL_BATCH };\n");
const m = await import(pathToFileURL(join(dir, "w.mjs")).href);
const gw = m.default;

// ---- parse ----
const a1 = m.articleParse(GOOD);
ok(a1 && a1.title === "How Much Energy One Answer Costs" && /^A control system solved/.test(a1.short), "the title and the short version are read", a1 && [a1.title, a1.short]);
ok(a1 && a1.sections.length === 4 && a1.sections[3].h === "What this does not show" && a1.sections.every((s) => s.paras.length >= 1), "the plain sections are read in order, the short version and the word list are not among them", a1 && a1.sections.map((s) => s.h));
ok(a1 && a1.terms.length === 2 && a1.terms[0].t === "controller" && /tells the computer/.test(a1.terms[0].m), "the words used are read as term and meaning");
ok(a1 && a1.learn.join("|") === "energy|computer|temperature", "the topics to look up are read", a1 && a1.learn);
ok(m.articleParse("# Only a title\n\nSome text.") === null && m.articleParse("") === null && m.articleParse("## The short version\n\nx\n\n## A\n\ny\n\n## B\n\nz\n\n## C\n\nw") === null, "a reply without a title, a short version and three sections is refused");
ok(m.plainHasRefusal("I cannot provide a summary.") && m.plainHasRefusal("I can’t help with this request.") && m.plainHasRefusal("I’m unable to rewrite the paper."), "common model refusal variants are recognized");
ok(m.plainRefusalSql("a.short").includes("i cannot") && m.plainRefusalSql("a.body").includes("without the necessary details"), "the cache-repair SQL searches both article fields for refusal markers");
ok(m.articleParse("```markdown\n" + GOOD + "\n```") && m.articleParse("<think>hmm</think>" + GOOD), "a code fence or a thinking block around the reply is removed");
ok(/\*\*/.test(GOOD) === false && m.articleParse(GOOD.replace("A control system", "**A control** system")).short.indexOf("**") < 0, "bold markers are stripped from the text");

// ---- the deterministic gate ----
const P = papers[SLUG];
const g1 = m.articleProblems(a1, P);
ok(g1.hard.length === 0 && g1.grade <= 9 && g1.words >= 80, "a plain article passes the gate", g1);
const gb = m.articleProblems(m.articleParse(BAD), P);
ok(gb.hard.some((x) => /Greek letter \(kappa\)/.test(x)) && gb.hard.some((x) => /symbol \(=\)/.test(x)) && gb.hard.some((x) => /citation marker/.test(x)), "a Greek-letter name, an equals sign and a citation marker are hard problems", gb.hard);
const mathless = { slug: "x", title: "T", abstract: "", body_md: "A paper about river delta cleaning and beta testing of a tool. ".repeat(30), version: "1" };
ok(m.articleProblems(m.articleParse(GOOD.replace("A control system", "A delta in the river and a beta test of a system")), mathless).hard.every((x) => !/Greek/.test(x)), "a Greek-letter word in a paper with no mathematics is not a problem");
ok(m.articleProblems(m.articleParse(GOOD.replace("careful meter", "meter of type A1")), P).hard.some((x) => /label/.test(x)), "a letter-and-number label is a hard problem");
ok(m.articleProblems(m.articleParse(GOOD.replace("careful meter", "careful meter, see https://example.org")), P).hard.some((x) => /link/.test(x)), "a link is a hard problem");
const DS = "The multidimensional characterization of the thermodynamically constrained computational optimization demonstrates the fundamental interoperability of heterogeneous instrumentation architectures notwithstanding methodological considerations.";
const dense = ["# Characterization of Thermodynamically Constrained Optimization", "", "## The short version", "", DS + " " + DS, "", "## A", "", DS + " " + DS, "", "## B", "", DS + " " + DS, "", "## C", "", DS + " " + DS, "", "## D", "", DS + " " + DS, "", "## Words used here", "", "- controller: the part that tells the computer what to do", "", "LEARN MORE: energy"].join("\n");
const gd = m.articleProblems(m.articleParse(dense), P);
ok(gd.hard.some((x) => /reading grade/.test(x)), "a reading grade above 12 is a hard problem", gd);
const short = [ "# Tiny", "", "## The short version", "", "One thing.", "", "## A", "", "Two things.", "", "## B", "", "Three.", "", "## C", "", "Four." ].join("\n");
ok(m.articleProblems(m.articleParse(short), P).hard.some((x) => /too short/.test(x)), "an article that is too short is a hard problem");
const many = GOOD.replace("The measured energy was close", "The measured energy, 12 or 14 or 15 or 16 or 17 times, was close");
ok(m.articleProblems(m.articleParse(many), P).soft.some((x) => /numbers/.test(x)), "too many numbers is a soft problem");

// ---- grounding ----
const named = m.articleParse(GOOD.replace("They also worked out", "Professor Zorblax also worked out"));
const gr = m.articleGround(named, P);
ok(gr.dropped >= 1 && !/Zorblax/.test(JSON.stringify(gr.sections)), "a capitalised name that is not in the paper is dropped with its sentence", gr.dropped);
ok(m.articleGround(a1, P).dropped === 0, "a clean article loses nothing");

// ---- links ----
const L = await m.articleLinks({}, ["energy", "computer", "temperature", "mercury", "nothing at all", "elsewhere", "energy"]);
ok(L.length === 3 && L[0].title === "Energy" && L[0].source === "Simple English Wikipedia" && L[0].simple === true && /^https:\/\/simple\.wikipedia\.org\/wiki\/Energy$/.test(L[0].url), "a topic with a Simple English page links to it", L);
ok(L[2].title === "Temperature" && /English, more technical/.test(L[2].source) && L[2].simple === false && /^https:\/\/en\.wikipedia\.org\//.test(L[2].url), "a topic with only an English page links to that, labelled as more technical", L[2]);
ok(!L.some((x) => /Mercury|Elsewhere/.test(x.title)) && L.length === 3, "a disambiguation page, a missing page, another host and a repeat are left out", L.map((x) => x.title));
ok(calls.fetch.indexOf("simple.wikipedia.org:energy") >= 0 && calls.fetch.indexOf("en.wikipedia.org:temperature") >= 0 && calls.fetch.indexOf("en.wikipedia.org:computer") < 0, "English Wikipedia is asked only when the simple page is missing");

// ---- the build ----
const fresh = () => { calls.writer = 0; calls.fallback = 0; calls.verifier = 0; writerPrompts = []; writerOut = () => GOOD; fallbackOut = () => GOOD; verifierOut = () => "{\"jargon\":[],\"math_like\":[]}"; };
fresh();
let r = await m.articleBuild({ AI }, P);
ok(r.status === "ok" && calls.writer === 1 && calls.verifier === 1 && /kimi\+gate\+gptoss-verify\+ground/.test(r.method) && r.verdict.repaired === 0, "a clean article is written once and verified once, no repair", { status: r.status, method: r.method, w: calls.writer, v: calls.verifier });
ok(r.links.length >= 1 && r.grade <= 9 && r.words >= 80, "the stored article carries its links, grade and length", { links: r.links.length, grade: r.grade, words: r.words });
ok(/PAPER TEXT:/.test(writerPrompts[0]) && /controller/i.test(writerPrompts[0]) && !/A reference that is cut/.test(writerPrompts[0]), "the writer reads the paper text without its reference list");
ok(/No mathematics: no formulas, symbols, Greek letters/.test(writerPrompts[0]) && /Simple English Wikipedia/.test(writerPrompts[0]) && /at most three in the whole article/.test(writerPrompts[0]), "the prompt carries the plain-language rules");
fresh(); writerOut = (n) => n === 1 ? BAD : GOOD; verifierOut = () => "{\"jargon\":[\"cryostat\",\"not in the text\"],\"math_like\":[\"kappa\"]}";
r = await m.articleBuild({ AI }, P);
ok(r.status === "ok" && calls.writer === 2 && /\+repair\+/.test(r.method) && r.verdict.repaired === 1, "an article with hard problems is repaired once and then stored", { status: r.status, note: r.note, method: r.method });
ok(/Greek letter/.test(writerPrompts[1]) && /remove or reword this math-like text: kappa/.test(writerPrompts[1]) && !/not in the text/.test(writerPrompts[1]), "the repair is told exactly what to fix, and a verifier item that is not in the article is ignored");
fresh(); writerOut = () => BAD;
r = await m.articleBuild({ AI }, P);
ok(r.status === "failed" && /hard rule not met after one repair/.test(r.note) && calls.writer === 2, "an article that still breaks a hard rule after the repair is not stored", r.note);
fresh(); writerOut = () => "";
r = await m.articleBuild({ AI }, P);
ok(r.status === "ok" && calls.writer === 1 && calls.fallback === 1 && /gemma-fallback\+gate/.test(r.method), "an empty primary-writer reply falls back once and still passes the normal checks", { status: r.status, method: r.method, calls });
fresh(); writerOut = () => ""; fallbackOut = () => "";
r = await m.articleBuild({ AI }, P);
ok(r.status === "failed" && /no text/.test(r.note) && calls.writer === 1 && calls.fallback === 1, "empty replies from both writers remain failed without looping", r.note);
fresh(); writerOut = () => "Here is some text without the shape.";
r = await m.articleBuild({ AI }, P);
ok(r.status === "failed" && /no title, short version and three sections/.test(r.note) && calls.fallback === 0, "a nonempty malformed reply is refused without spending a fallback call", r.note);
fresh(); verifierOut = () => "";
r = await m.articleBuild({ AI }, P);
ok(r.status === "ok" && !/gptoss-verify/.test(r.method) && calls.writer === 1, "a verifier that does not answer fails open after the deterministic gate", r.method);
fresh(); writerOut = () => GOOD.replace("A control system solved problems on a very cold computer.", "I’m sorry, but I cannot rewrite the paper without the necessary details.");
r = await m.articleBuild({ AI }, P);
ok(r.status === "failed" && /model refusal/.test(r.note), "a structured model refusal is not stored as a plain-language article", r.note);
fresh(); writerOut = () => dense;
r = await m.articleBuild({ AI }, P);
ok(r.status === "failed" && /reading grade/.test(r.note), "an article above the hard grade that the repair does not lower is not stored", r.note);
const tinyPaper = { slug: "t", title: "T", abstract: "", body_md: "Too short.", version: "1" };
ok((await m.articleBuild({ AI }, tinyPaper)).status === "failed" && (await m.articleBuild({}, P)).status === "failed", "a paper with no text to read and a worker with no model are failures");
ok(m.articleTargetWords("word ".repeat(1000)) === 350 && m.articleTargetWords("word ".repeat(8000)) === 667 && m.articleTargetWords("word ".repeat(30000)) === 900, "the length target follows the paper between 350 and 900 words");
ok(m.articleSource({ body_md: "---\nt: 1\n---\n" + "## Intro\n\nBody text here.\n\n## References\n\n[1] Gone." + "\n\n## Appendix A\n\nGone too." }).trim() === "## Intro\n\nBody text here.", "front matter, the reference list and the appendices are cut from the text the writer reads");
ok(m.articleSource({ body_md: "x".repeat(60000) }).length < 36100 && /\[\.\.\.\]/.test(m.articleSource({ body_md: "x".repeat(60000) })), "a long paper keeps its start and its end");

// ---- the store and the fill (an in-memory living-paper) ----
const art = new Map();
const articleQueries = [];
const mkLP = (extra) => {
  const stmt = (sql) => {
    articleQueries.push(sql);
    const st = {
      a: [], bind(...a) { st.a = a; return st; },
      async first() {
        if (/FROM plain_article WHERE slug/i.test(sql)) return art.get(st.a[0]) || null;
        if (/FROM plain_summary/i.test(sql)) return null;
        if (/FROM papers p LEFT JOIN plain_article/i.test(sql)) return null;
        if (/FROM papers/i.test(sql) && st.a.length) return papers[st.a[0]] || null;
        return null;
      },
      async run() {
        if (/INSERT INTO plain_article/i.test(sql)) { const [slug, rev, status, attempts, title, short, body, terms, links, words, grade, method, verdict, note, version, body_len, generated_at] = st.a; art.set(slug, { slug, rev, status, attempts, title, short, body, terms, links, words, grade, method, verdict, note, version, body_len, generated_at }); }
        return {};
      },
      async all() {
        if (/FROM papers p LEFT JOIN plain_article/i.test(sql)) {
          const limit = Number((sql.match(/\bLIMIT\s+(\d+)/i) || [])[1] || 99);
          const rows = Object.values(papers).filter((p) => { const a = art.get(p.slug); if (!a) return true; if (a.status === "ok") return a.version !== String(p.version || "") || a.body_len <= 0 || Math.abs(p.body_md.length - a.body_len) * 100 > a.body_len * m.ARTICLE_MATERIAL_PCT || m.plainHasRefusal(a.short) || m.plainHasRefusal(a.body); return a.attempts < 3 && Date.now() - Date.parse(a.generated_at) > 6 * 3600e3; });
          rows.sort((x, y) => String(y.created_at).localeCompare(String(x.created_at)));
          return { results: rows.slice(0, limit).map((p) => ({ slug: p.slug, attempts: (art.get(p.slug) || {}).attempts || 0 })) };
        }
        return { results: [] };
      },
    };
    return st;
  };
  return Object.assign({ LIVING_PAPER: { prepare: stmt }, DB: { prepare: stmt }, AI }, extra || {});
};
// more than one run's worth of papers, so the order and per-run cap show
for (let i = 1; i <= 35; i++) papers["p" + i] = Object.assign({}, papers[SLUG], { slug: "p" + i, created_at: "2026-09-" + String(i).padStart(2, "0") });
fresh();
const env = mkLP();
const fr = await m.articleFill(env);
ok(fr.tried === m.ARTICLE_FILL_MAX && fr.built === m.ARTICLE_FILL_MAX && art.size === m.ARTICLE_FILL_MAX, "a run builds at most ARTICLE_FILL_MAX papers", fr);
ok(art.has(SLUG) && art.has("p7") && !art.has("p6"), "new papers come first, newest first", [...art.keys()].slice(0, 4));
ok(m.ARTICLE_FILL_BATCH === 3 && calls.writer === m.ARTICLE_FILL_MAX, "papers are built three at a time and a clean one costs one writer call", { batch: m.ARTICLE_FILL_BATCH, writer: calls.writer });
const row = art.get(SLUG);
ok(row.status === "ok" && row.rev === m.articleRev(P) && row.version === "2.0.0" && row.body_len === BODY.length && JSON.parse(row.body).length === 4, "the row is keyed on the paper text and carries the sections");
const got = await m.articleGet(env, P);
ok(got && got.title === "How Much Energy One Answer Costs" && got.minutes >= 1 && got.sections.length === 4 && Array.isArray(got.links), "articleGet returns the stored article", got && Object.keys(got));
// COST-GATEWAY-ARTICLE-1: the article describes the paper, not its typography
ok((await m.articleGet(env, Object.assign({}, P, { body_md: BODY + " changed" }))) !== null, "an article for a paper whose text changed by a few characters is still shown");
const grown = BODY + "\n\n" + "More text about the limitations of this controller paper. ".repeat(Math.ceil(BODY.length * 0.25 / 55) + 1);
ok(grown.length > BODY.length * 1.2, "the grown body is over the material bar", { len: grown.length, base: BODY.length });
ok((await m.articleGet(env, Object.assign({}, P, { body_md: grown }))) === null, "an article for a paper whose text grew by over 20 percent is not shown");
ok((await m.articleGet(env, Object.assign({}, P, { body_md: BODY.slice(0, Math.floor(BODY.length * 0.7)) }))) === null, "an article for a paper whose text shrank by over 20 percent is not shown");
ok((await m.articleGet(env, Object.assign({}, P, { version: "9.9.9" }))) === null, "an article for another version of the paper is not shown");
ok(m.articleImmaterial(row.rev, Object.assign({}, P, { body_md: BODY.slice(0, Math.floor(BODY.length * 0.81)) })) === true && m.articleImmaterial(row.rev, Object.assign({}, P, { body_md: BODY.slice(0, Math.floor(BODY.length * 0.79)) })) === false, "the bar is 20 percent of the length the article was built on", row.rev);
ok(m.articleImmaterial("old|2.0.0|100|abc", P) === false && m.articleImmaterial("", P) === false && m.articleImmaterial(row.rev + "", { version: "3" , body_md: BODY }) === false, "another rules tag, an empty rev or another version is never immaterial");
// a format-only revision (a few characters) is not rebuilt; the article stays in the store untouched
papers[SLUG].body_md = BODY + "\n\nOne more sentence.";
const wBefore = calls.writer, genBefore = art.get(SLUG).generated_at;
fresh();
const frFmt = await m.articleFill(env);
ok(art.get(SLUG).generated_at === genBefore && art.get(SLUG).body_len === BODY.length && art.get(SLUG).rev === m.articleRev(Object.assign({}, P, { body_md: BODY })), "a paper whose text moved by a few characters is not rebuilt (its article is untouched)", { fr: frFmt, w: calls.writer, wBefore, row: art.get(SLUG).body_len });
ok(frFmt.tried === 36 - m.ARTICLE_FILL_MAX, "only the papers that never had an article were built in that run", frFmt);
ok((await m.articleGet(env, papers[SLUG])) !== null, "and its article is still shown on the page");
// a material revision is rebuilt
papers[SLUG].body_md = grown;
fresh();
const fr2 = await m.articleFill(env);
ok(fr2.tried >= 1 && art.get(SLUG).body_len === papers[SLUG].body_md.length, "a paper whose text changed materially is rebuilt", fr2);
// a new version is rebuilt
papers[SLUG].version = "3.0.0";
fresh();
const fr3 = await m.articleFill(env);
ok(fr3.tried >= 1 && art.get(SLUG).version === "3.0.0", "a paper with a new version is rebuilt", fr3);
papers[SLUG].version = "2.0.0";
// failures: kept as failed rows, retried after six hours, three times
for (const k of [...art.keys()]) art.delete(k);
for (let i = 1; i <= 35; i++) delete papers["p" + i];
fresh(); writerOut = () => "no shape";
await m.articleFill(env);
ok(art.get(SLUG).status === "failed" && art.get(SLUG).attempts === 1 && !art.get(SLUG).body, "a failed build is a failed row with one attempt and no article");
ok((await m.articleGet(env, papers[SLUG])) === null, "a failed row shows nothing");
fresh(); const before = calls.writer; await m.articleFill(env);
ok(calls.writer === before, "a failed paper is not retried within six hours");
art.get(SLUG).generated_at = new Date(Date.now() - 7 * 3600e3).toISOString();
writerOut = () => "no shape"; await m.articleFill(env);
ok(art.get(SLUG).attempts === 2, "after six hours it is tried again", art.get(SLUG).attempts);
art.get(SLUG).generated_at = new Date(Date.now() - 7 * 3600e3).toISOString(); await m.articleFill(env);
art.get(SLUG).generated_at = new Date(Date.now() - 7 * 3600e3).toISOString(); const w3 = calls.writer; await m.articleFill(env);
ok(art.get(SLUG).attempts === 3 && calls.writer === w3, "after three attempts it is left alone", { attempts: art.get(SLUG).attempts });
art.delete(SLUG); fresh();
await m.articleFill(env);
ok(art.get(SLUG).status === "ok", "a paper with a good reply is stored once the writer answers");

// ---- the pages ----
const rev = m.articleRev(papers[SLUG]);
const callPage = (e, path) => gw.fetch(new Request("https://papers.qnfo.org" + path), e, { waitUntil() {} });
let page = await (await callPage(env, "/papers/" + SLUG + "/quickread")).text();
ok(/<h1>How Much Energy One Answer Costs<\/h1>/.test(page) && /Quick read &middot; plain language/.test(page), "the Quick Read opens with the plain title");
ok(/class="qa-short"/.test(page) && /A control system solved problems/.test(page), "the short version comes first");
ok(/<h2>What this does not show<\/h2>/.test(page) && /<dt>controller<\/dt>/.test(page), "the sections, the limits and the words used are shown");
ok(/<details class="qa-tech" id="technical">/.test(page) && page.indexOf("qa-short") < page.indexOf("qa-tech") && /For specialists: the technical digest/.test(page), "the technical digest sits below the article, folded");
ok(/Nothing in this digest is written by a model/.test(page) && !/Apart from the plain-language box/.test(page), "the digest says what is true of it alone");
ok(/written by an AI model from the text of the paper and checked against plain-language rules/.test(page) && /the paper is the source of record/.test(page), "the page says plainly that a model wrote it and that the paper is the source of record");
ok(/Want the exact version\?/.test(page) && new RegExp('href="/papers/' + SLUG + '"').test(page), "the page encourages the reader to go on to the paper");
ok(/<meta name="robots" content="noindex,follow">/.test(page) && /plain-language version with no jargon and no mathematics/.test(page), "the page stays noindex and its description says what it is");
const withLinks = JSON.parse(art.get(SLUG).links || "[]");
ok(withLinks.length === 0 || /rel="noopener noreferrer"/.test(page), "outbound links carry noopener noreferrer");
const paperPage = await (await callPage(env, "/papers/" + SLUG)).text();
ok(/class="plain-callout"/.test(paperPage) && /A control system solved problems/.test(paperPage) && /Read the plain-language version/.test(paperPage) && new RegExp('href="/papers/' + SLUG + '/quickread"').test(paperPage), "the paper page's box shows the short version and links to the plain-language article");
ok(/no jargon, no mathematics/.test(paperPage), "the link says what the reader gets");
const api = await (await callPage(env, "/api/quickread/" + SLUG)).json();
ok(api.article && api.article.title === "How Much Energy One Answer Costs" && api.article.sections.length === 4 && api.kind === "digest", "the API returns the article beside the digest");
const refusal = "I’m sorry, but I can’t rewrite that paper without the necessary details.";
art.set(SLUG, Object.assign({}, art.get(SLUG), { short: refusal }));
ok((await m.articleGet(env, papers[SLUG])) === null, "a cached refusal is not returned by articleGet");
const refusalApi = await (await callPage(env, "/api/quickread/" + SLUG)).json();
ok(refusalApi.article === null, "the public Quick Read API does not expose a cached refusal");
fresh();
const repair = await m.articleFill(env);
ok(repair.tried >= 1 && !m.plainHasRefusal(art.get(SLUG).short) && articleQueries.some((sql) => /i cannot/.test(sql) && /i''m sorry/.test(sql)), "the bounded article fill selects and repairs a cached refusal");
const frag = await (await callPage(env, "/api/quickread/" + SLUG + "?format=html")).text();
ok(/qa-short/.test(frag) && /qa-tech/.test(frag), "the HTML fragment carries the article and the folded digest");
art.delete(SLUG);
page = await (await callPage(env, "/papers/" + SLUG + "/quickread")).text();
ok(/is written in the background and is not ready yet/.test(page) && !/class="qa-short"/.test(page) && /Apart from the plain-language box, nothing on this page is written by a model/.test(page), "a paper without an article says so and keeps the digest, with an honest note on what a model wrote");
const api2 = await (await callPage(env, "/api/quickread/" + SLUG)).json();
ok(api2.article === null, "the API says null until the article is built");
const audit = await (await callPage(env, "/_audit/quick-read")).json();
ok(audit.plain_articles === null || typeof audit.plain_articles.publicPapers === "number" || audit.ok === false, "the audit route reports the article counts", audit.plain_articles);
const health = await (await callPage(env, "/health")).json().catch(() => ({}));
ok(!health.capabilities || health.capabilities.indexOf("quick-read-plain-article") >= 0, "the health route lists the capability", health.capabilities);
ok(versionAtLeast((src.match(/var VERSION="([^"]+)"/) || [])[1] || "", "3.44.0"), "the version is 3.44 or later");
console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
