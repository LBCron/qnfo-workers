// COMPANION-VERIFY-1 offline suite (personal-companion 1.14.0, charter pillar: personal). Owner directive 2026-10-10: published
// content is 100% accurate and independently fact-checked; prompts carry process and style only; if a check or reviewer is
// unavailable nothing is published. Proves: an invented name, year or figure is rejected before any model reviewer sees it; two
// reviewers from families other than the writer's must both pass; a reviewer or critic outage fails closed; a critic-rejected draft
// is never force-published, even after a long silence; nothing is shown or mailed without a passing audit row; a piece with no
// recorded source is withdrawn and one that fails the audit is retracted in public; topics come from live fetches.
// Run: node personal-companion/verify.test.mjs   -> prints "N passed, 0 failed"
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { importWorker } from "./_harness-import-worker.mjs";
const IMPORT = 'import { WorkflowEntrypoint } from "cloudflare:workers";';
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const mod = await importWorker(() => (src.replace(IMPORT, "var WorkflowEntrypoint = class {};") + "\n//" + Math.random()), new URL("./", import.meta.url));
const V = mod.__verify, W = mod.default;
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " -- " + JSON.stringify(x).slice(0, 400) : "")); } };

// ---- the prompts carry process and style only ----------------------------------------------------------------------------------
const prompts = Object.values(V.prompts).join("\n");
ok(!/\bTOPICS\b/.test(src) && !/id: "coffeehouse-public"/.test(src), "no hard-coded topic table remains");
ok(!/coffeehouse|walking|ruins|fermentation|sourdough|kintsugi|john cage|p-adic|just intonation|musical tuning|garden|tide|clock|staircase|footnote|canal/i.test(prompts + src.slice(src.indexOf("var P_STYLE"), src.indexOf("function json("))), "no example subject noun in any prompt");
ok(!/history, music, design, language, craft, economics, biology, cities, computation/.test(prompts), "the field list is gone from the style prompt");
ok(!/a paper, a concept, a place, a piece of music/.test(prompts), "no example list of things in the notes form");
ok(/Your own memory is not a source/.test(V.prompts.P_STYLE) && !/mark the step as your inference/.test(V.prompts.P_STYLE), "the style prompt forbids facts from memory and no longer lets the model reason past its sources");
ok(/and only those/.test(V.prompts.P_ESSAY) && !/Use the specific names, dates, numbers, mechanisms and cases it contains\./.test(V.prompts.P_ESSAY), "the essay form uses only names found in the sources");
ok(/grounding/.test(V.prompts.P_CRITIQUE) && /SOURCE MATERIAL/.test(V.prompts.P_CRITIQUE), "the critic is given the sources and checks grounding");
ok(!/q\.gate = "forced"|bestRejected|forced fallback/.test(src.slice(src.indexOf("async function generate("), src.indexOf("var CRON_TABLE"))), "generate has no forced-publish path");
ok(!/\["Coffeehouse", "Walking"/.test(src), "no hard-coded fallback article list");

// ---- deterministic grounding ---------------------------------------------------------------------------------------------------
const source = "The Alpha Subject recorded 14 measurements in 1987 at the Beta Station. Surveyors at the Beta Station said the readings drifted by 2.5 percent a year. A later review by the Gamma Committee found the drift was real.";
const bad = "# What the subject shows\n\nThe Alpha Subject recorded 14 measurements in 1987. In 1863 Dr. Delmore Quill built the first Lantern Index, and 4000 readers used it.\n\n## The Objection Stands\n\nThe Gamma Committee found the drift was real.";
const probs = V.groundingProblems(bad, source);
ok(probs.some((p) => /1863/.test(p)), "an invented year is caught", probs);
ok(probs.some((p) => /Delmore|Quill/.test(p)) && probs.some((p) => /Lantern/.test(p)), "invented names are caught", probs);
ok(probs.some((p) => /4000/.test(p)), "an invented figure is caught", probs);
ok(!probs.some((p) => /Alpha|Beta|Gamma|1987|14\b|Objection/.test(p)), "what the source says, and a title-case heading, is not flagged", probs);
ok(V.groundingProblems("# Drift in the readings\n\nThe Alpha Subject recorded 14 measurements in 1987. Suppose a hypothetical station kept a ledger: the reader would see two columns.\n", source).length === 0, "a grounded piece with a labelled hypothetical has no problems");

// ---- fact-check verdicts and the two-family rule ---------------------------------------------------------------------------------
ok(V.parseFactVerdict('{"unsupported":[],"verdict":"pass"}').verdict === "pass" && V.parseFactVerdict("no json") === null && V.parseFactVerdict('{"verdict":"maybe"}') === null, "verdict parser: pass, junk, unknown verdict");
ok(V.parseFactVerdict('{"unsupported":["a -- x"],"verdict":"pass"}').verdict === "fail" && V.parseFactVerdict('{"unsupported":[],"verdict":"fail"}').unsupported.length === 1, "a pass that lists claims is a fail; a bare fail names a reason");
const fams = V.pickReviewers(["openai"], 5, 3).map(V.familyOf);
ok(fams.length >= 2 && !fams.includes("openai") && new Set(fams).size === fams.length, "reviewers come from distinct families other than the writer's", fams);
ok(!V.pickReviewers(["deepseek"], 5, 1).some((id) => /deepseek/.test(id)), "a deepseek writer is never reviewed by deepseek");

let calls = [];
let script = () => '{"unsupported":[],"verdict":"pass"}';
const goodText = "# Drift in the readings\n\nThe Alpha Subject recorded 14 measurements in 1987 at the Beta Station.";
const AI0 = { run: async (model, input) => { const c = input.messages[0].content; calls.push({ model, c }); const r = script(model, c); if (r instanceof Error) throw r; return { response: r }; } };
{
  calls = [];
  const r = await V.verifyPiece({ AI: AI0 }, bad, source, "@cf/openai/gpt-oss-120b", "s1", {});
  ok(!r.ok && r.stage === "grounding" && calls.length === 0, "a grounding failure never reaches the model reviewers", r);
}
{
  calls = []; script = () => '{"unsupported":[],"verdict":"pass"}';
  const r = await V.verifyPiece({ AI: AI0 }, goodText, source, "@cf/openai/gpt-oss-120b", "s2", {});
  const fs = new Set(calls.map((c) => V.familyOf(c.model)));
  ok(r.ok && calls.length === 2 && fs.size === 2 && !fs.has("openai"), "two reviewers, two families, neither the writer's, both pass", { ok: r.ok, n: calls.length, fs: [...fs] });
}
{
  // COMPANION-FACTCHECK-PARALLEL-1 (1.15.8): a reviewer that times out in round 1 is replaced in round 2 by the untried ones
  calls = []; let first = null;
  script = (model) => { if (first === null) first = model; return model === first ? new Error("The operation was aborted due to timeout") : '{"unsupported":[],"verdict":"pass"}'; };
  const r = await V.verifyPiece({ AI: AI0 }, goodText, source, "@cf/openai/gpt-oss-120b", "s2", {});
  const fs = new Set(calls.map((c) => V.familyOf(c.model)));
  ok(r.ok && calls.length >= 3 && calls.length <= 5 && !fs.has("openai") && (r.judges || []).length === 2, "a timed-out reviewer is replaced in a second parallel round; two verdicts still decide", { ok: r.ok, n: calls.length, judges: (r.judges || []).map((j) => j.model) });
  script = () => new Error("The operation was aborted due to timeout");
  calls = [];
  const r2 = await V.verifyPiece({ AI: AI0 }, goodText, source, "@cf/openai/gpt-oss-120b", "s3", {});
  ok(!r2.ok && r2.unavailable === true && calls.length <= 8, "every reviewer failing in both rounds still fails closed (nothing publishes)", { ok: r2.ok, n: calls.length });
  ok(calls.every((c) => /SOURCE MATERIAL/.test(c.c) && /Alpha Subject/.test(c.c)), "reviewers see the source material and the draft");
}
{
  let n = 0; script = () => (n++ === 0 ? '{"unsupported":["The Gamma Committee -- not in source"],"verdict":"fail"}' : '{"unsupported":[],"verdict":"pass"}');
  const r = await V.factCheck({ AI: AI0 }, goodText, source, "@cf/openai/gpt-oss-120b", "s3");
  ok(!r.ok && r.unsupported.length === 1 && !r.unavailable, "one failing reviewer fails the piece and its claim is reported", r);
}
{
  script = () => new Error("model down"); calls = [];
  const r = await V.verifyPiece({ AI: AI0 }, goodText, source, "@cf/openai/gpt-oss-120b", "s4", {});
  ok(!r.ok && r.unavailable === true && /unavailable/.test(r.problems[0]), "a reviewer outage fails closed and is marked unavailable", r);
  script = (m) => /nvidia/.test(m) ? new Error("down") : '{"unsupported":[],"verdict":"pass"}';
  const r2 = await V.verifyPiece({ AI: AI0 }, goodText, source, "@cf/zzz/writer", "s5", {});
  ok(r2.unavailable === true || (r2.ok === true && r2.judges.length === 2), "one reviewer down is replaced by the next family, never waved through", r2);
}

// ---- fixtures: an in-memory personal D1 and a scripted model world -------------------------------------------------------------
const wrap = (db) => ({ prepare(sql) { const mk = (args) => ({ bind: (...a) => mk(a),
  run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
  first: async () => db.prepare(sql).get(...args) || null, all: async () => ({ results: db.prepare(sql).all(...args) }) }); return mk([]); } });
function world() {
  const p = new DatabaseSync(":memory:");
  p.exec("CREATE TABLE profile (facet TEXT, label TEXT, statement TEXT, confidence REAL); CREATE TABLE activity (date TEXT, title TEXT, category TEXT, venue TEXT, city TEXT, notes TEXT, energy_label TEXT); CREATE TABLE events (start_date TEXT, title TEXT, venue TEXT, city TEXT, category TEXT); CREATE TABLE notes (ts TEXT, kind TEXT, content TEXT); CREATE TABLE companion_pieces (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE NOT NULL, form TEXT NOT NULL, title TEXT NOT NULL, subtitle TEXT, lede TEXT, body_md TEXT NOT NULL, anchor_json TEXT, quality_json TEXT, word_count INTEGER, day TEXT, created_at TEXT NOT NULL);");
  return p;
}
const sentence = "The reading at the Beta Station shows the Alpha Subject drifting, and the record of 14 measurements in 1987 keeps that pattern in view for anyone who checks it. ";
const art = (name, extra) => ("The " + name + " is the subject of this article. " + sentence.repeat(22) + (extra || "")).slice(0, 4200);
const SRC = { "Alpha Subject": art("Alpha Subject"), "Beta Station": art("Beta Station"), "Gamma Committee": art("Gamma Committee") };
function installFetch(opts) {
  opts = opts || {};
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (opts.down) throw new Error("network down");
    if (u.includes("list=random")) return new Response(JSON.stringify({ query: { random: [{ title: "Alpha Subject" }, { title: "Other Thing" }] } }), { status: 200 });
    if (u.includes("prop=links")) return new Response(JSON.stringify({ query: { pages: { 1: { title: "Alpha Subject", links: [{ title: "Beta Station" }, { title: "Gamma Committee" }, { title: "1987" }] } } } }), { status: 200 });
    if (u.includes("prop=extracts")) {
      const t = decodeURIComponent((u.match(/titles=([^&]*)/) || [])[1] || "");
      return new Response(JSON.stringify({ query: { pages: { 1: { title: t, extract: SRC[t] || "" } } } }), { status: 200 });
    }
    if (new URL(u).hostname === "export.arxiv.org") return new Response("<feed><entry><id>http://arxiv.org/abs/1</id><title>A paper on drift</title><summary>" + ("The Alpha Subject drifts when measured at the Beta Station. ").repeat(8) + "</summary></entry></feed>", { status: 200 });
    return new Response("{}", { status: 404 });
  };
}
// a 2200-word essay built only from the source sentence plus an objection section
const paras = (n) => Array.from({ length: n }, () => sentence.repeat(10).trim()).join("\n\n");
const LEDE = "The Alpha Subject drifts when it is read at the Beta Station.";
const goodBody = (lede) => "# Drift in the readings\n\n" + (lede || LEDE) + "\n\n" + paras(4) + "\n\n## What would falsify this\n\nIf the record of 14 measurements in 1987 were re-run and the drift vanished, the claim would fail.\n\n## The objection\n\nThe strongest objection is that fourteen readings are too few to separate drift from noise, and the record cannot settle that.\n\n" + paras(4);
function modelWorld(o) {
  const log = { writer: 0, critic: 0, review: 0 };
  const AI = { run: async (model, input) => {
    const sys = (input.messages && input.messages[0] && input.messages[0].content) || "";
    if (input.text) return { data: [] };
    if (/strict fact-checker/.test(sys)) { log.review++; if (o.reviewDown) throw new Error("reviewer down"); return { response: o.review ? o.review(model, sys) : '{"unsupported":[],"verdict":"pass"}' }; }
    if (/adversarial reader/.test(sys)) { log.critic++; if (o.criticDown) throw new Error("critic down"); return { response: o.critic || '{"specificity":8,"argument":8,"objection":8,"voice":8,"grounding":9,"systems":8,"verdict":"accept","why":"ok"}' }; }
    log.writer++; return { response: typeof o.draft === "function" ? o.draft(log.writer, input) : (o.draft || goodBody()) };
  } };
  return { AI, log };
}
function makeEnv(p, mw) { return { PERSONAL: wrap(p), AI: mw.AI }; }
const count = (p, t) => p.prepare("SELECT COUNT(*) n FROM " + t).get().n;

// ---- end to end: a grounded piece is published only after both checks --------------------------------------------------------
{
  installFetch();
  const p = world(), mw = modelWorld({}), env = makeEnv(p, mw);
  const out = await V.generate(env, "essay", {});
  if (!out.ok) console.log(JSON.stringify(p.prepare("SELECT status, detail FROM companion_runs").all()).slice(0, 1500));
  ok(out.ok === true && count(p, "companion_pieces") === 1, "a grounded, reviewed essay is published", out);
  const row = p.prepare("SELECT * FROM companion_pieces").get(), au = p.prepare("SELECT * FROM companion_audits").get();
  ok(au && au.verdict === "pass" && au.slug === row.slug && /,/.test(au.models), "it carries a passing audit row naming two reviewer models", au);
  ok(row.ground_text && /Alpha Subject/.test(row.ground_text) && /Beta Station/.test(row.ground_text), "the source material is stored with the piece for later audits");
  ok(mw.log.review >= 2 && mw.log.critic === 1, "two fact-check calls and one critic call were made", mw.log);
  const list = await (await W.fetch(new Request("https://x.test/api/pieces"), env, { waitUntil() {} })).json();
  ok(list.count === 1, "the verified piece is served by the API", list);
  const idx = await (await W.fetch(new Request("https://x.test/"), env, { waitUntil() {} })).text();
  ok(/Drift in the readings/.test(idx), "and listed on the index");
  p.prepare("INSERT INTO companion_pieces (slug, form, title, body_md, created_at) VALUES (?, 'essay', ?, 'unpublished body', '2026-10-25T00:00:00Z')").run("sitemap-pending", "Pending piece");
  p.prepare("INSERT INTO companion_pieces (slug, form, title, body_md, created_at) VALUES (?, 'essay', ?, 'retracted body', '2026-10-25T00:00:00Z')").run("sitemap-retracted", "Retracted piece");
  p.prepare("INSERT INTO companion_audits (slug, verdict, checked_at) VALUES ('sitemap-retracted', 'pass', '2026-10-25T00:00:00Z')").run();
  p.prepare("INSERT INTO companion_retractions (slug, reason, retracted_at) VALUES ('sitemap-retracted', 'withdrawn', '2026-10-25T00:00:00Z')").run();
  const sitemapResponse = await W.fetch(new Request("https://x.test/sitemap.xml"), env, { waitUntil() {} });
  const sitemap = await sitemapResponse.text();
  ok(sitemapResponse.status === 200 && /application\/xml/.test(sitemapResponse.headers.get("Content-Type") || ""), "the sitemap is served as XML");
  ok(sitemap.includes("https://x.test/") && sitemap.includes("https://x.test/p/" + row.slug), "the sitemap lists the index and accuracy-passed piece");
  ok(!sitemap.includes("sitemap-pending") && !sitemap.includes("sitemap-retracted"), "unverified and retracted pieces are excluded from the sitemap");
  const robots = await W.fetch(new Request("https://x.test/robots.txt"), env, { waitUntil() {} });
  ok(await robots.text() === "User-agent: *\nDisallow: /\n", "the existing robots.txt disallow policy is unchanged");
  const protectedEnv = { ...env, COMPANION_KEY: "sitemap-test-key" };
  ok((await W.fetch(new Request("https://x.test/sitemap.xml"), protectedEnv, { waitUntil() {} })).status === 401, "the sitemap follows the existing companion-key authorization");
  const authorizedSitemap = await W.fetch(new Request("https://x.test/sitemap.xml?k=sitemap-test-key"), protectedEnv, { waitUntil() {} });
  ok(authorizedSitemap.status === 200 && !(await authorizedSitemap.text()).includes("sitemap-test-key"), "the authorized sitemap never embeds the companion key in URLs");
  const topicRow = p.prepare("SELECT topic FROM companion_runs WHERE status = 'ok'").get();
  ok(topicRow && topicRow.topic === "wiki:Alpha Subject", "the topic came from the live fetch", topicRow);
}

// ---- an invented name or year never publishes --------------------------------------------------------------------------------
// GROUNDING-REPAIR-1 (issue 2354): one ungrounded sentence among many is removed before the reviewers see the draft, and the piece
// that publishes contains no invented item; a draft whose invented items run through more than a quarter of its sentences is still
// rejected by the deterministic check before any reviewer is called.
{
  installFetch();
  const p = world(), mw = modelWorld({ draft: () => goodBody(LEDE + " Dr. Delmore Quill showed this in 1863.") });
  const out = await V.generate(makeEnv(p, mw), "essay", {});
  ok(out.ok === true && count(p, "companion_pieces") === 1, "a draft with one invented sentence is repaired and published without it", out);
  const row = p.prepare("SELECT lede, body_md FROM companion_pieces").get();
  ok(row && !/Quill|1863/.test(String(row.lede) + String(row.body_md)) && /Alpha Subject/.test(String(row.lede)), "the published piece carries no invented name or year and keeps the grounded lede", row && row.lede);
  const st = p.prepare("SELECT detail FROM companion_runs WHERE status = 'stage' AND detail LIKE 'grounding repair:%' LIMIT 1").get();
  ok(st && st.detail === "grounding repair: removed 1 sentences", "the repair is logged as a companion_runs stage row", st);
  ok(mw.log.review >= 2 && mw.log.writer === 1, "the repaired draft still went to two fact-check reviewers, with no second writer call", mw.log);
}
{
  installFetch();
  const invented = "Dr. Delmore Quill showed in 1863 that the Alpha Subject drifts when it is read at the Beta Station.";
  const p = world(), mw = modelWorld({ draft: () => goodBody(LEDE).split(sentence.trim()).join(invented) });
  const out = await V.generate(makeEnv(p, mw), "essay", {});
  ok(out.ok === false && count(p, "companion_pieces") === 0, "a draft whose invented name and year run through most sentences is not published", out);
  ok(mw.log.review === 0, "the deterministic check rejected it before any model reviewer was called", mw.log);
  ok(count(p, "companion_runs") > 0 && p.prepare("SELECT COUNT(*) n FROM companion_runs WHERE detail LIKE 'grounding repair:%'").get().n === 0, "no repair was accepted above the quarter cap");
  const rj = p.prepare("SELECT detail FROM companion_runs WHERE status = 'rejected' LIMIT 1").get();
  ok(rj && /grounding/.test(rj.detail) && /1863/.test(rj.detail), "the run log names the ungrounded year", rj);
}

// ---- reviewers reject, or are unavailable: nothing is published ---------------------------------------------------------------
{
  installFetch();
  const p = world(), mw = modelWorld({ review: () => '{"unsupported":["the readings drifted -- source says surveyors said"],"verdict":"fail"}' });
  const out = await V.generate(makeEnv(p, mw), "essay", {});
  ok(out.ok === false && count(p, "companion_pieces") === 0, "reviewers that find an unsupported claim stop publication", out);
}
{
  installFetch();
  const p = world(), mw = modelWorld({ reviewDown: true }), env = makeEnv(p, mw);
  const out = await V.generate(env, "essay", {});
  ok(out.ok === false && count(p, "companion_pieces") === 0 && /fact-check unavailable/.test(out.error), "a reviewer outage fails closed: nothing is published", out);
}
{
  installFetch();
  const p = world(), mw = modelWorld({ criticDown: true }), env = makeEnv(p, mw);
  const out = await V.generate(env, "essay", {});
  ok(out.ok === false && count(p, "companion_pieces") === 0, "a critic outage fails closed (it used to score a neutral 5 and pass)", out);
}
{
  installFetch();
  const p = world(), mw = modelWorld({ critic: '{"specificity":3,"argument":3,"objection":3,"voice":3,"verdict":"reject","why":"flat"}' }), env = makeEnv(p, mw);
  p.exec("CREATE TABLE IF NOT EXISTS companion_pieces (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE NOT NULL, form TEXT NOT NULL, title TEXT NOT NULL, subtitle TEXT, lede TEXT, body_md TEXT NOT NULL, anchor_json TEXT, quality_json TEXT, word_count INTEGER, day TEXT, created_at TEXT NOT NULL)");
  p.prepare("INSERT INTO companion_pieces (slug, form, title, body_md, day, created_at) VALUES ('old','essay','Old piece','x','2026-09-01','2026-09-01T00:00:00Z')").run();
  const out = await V.generate(env, "essay", {});
  ok(out.ok === false && count(p, "companion_pieces") === 1, "after weeks of silence a critic-rejected draft is still not force-published", out);
}
{
  installFetch({ down: true });
  const p = world(), mw = modelWorld({}), env = makeEnv(p, mw);
  const out = await V.generate(env, "essay", {});
  ok(out.ok === false && count(p, "companion_pieces") === 0 && mw.log.writer === 0, "when the live sources cannot be fetched the run is blocked and nothing is written", out);
}

// ---- one corrective revision rescues a draft whose only fault is an unsupported claim ---------------------------------------------
{
  installFetch();
  const p = world(); let reviews = 0;
  const mw = modelWorld({ review: () => (++reviews <= 2 ? '{"unsupported":["the record keeps that pattern -- overstated"],"verdict":"fail"}' : '{"unsupported":[],"verdict":"pass"}') });
  const out = await V.generate(makeEnv(p, mw), "essay", {});
  ok(out.ok === true && mw.log.writer === 2 && count(p, "companion_pieces") === 1, "a fact-check failure triggers one revision that is re-verified before publishing", { out, log: mw.log });
}

// ---- nothing is mailed without a passing audit --------------------------------------------------------------------------------
{
  const p = world(); let sent = 0;
  p.exec("CREATE TABLE wellbeing_config (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT); INSERT INTO wellbeing_config VALUES ('email_mode','\"all\"','x')"); // COMPANION-EMAIL-OPT-IN-1: mail path under test
  const env = { PERSONAL: wrap(p), SEND_EMAIL: { send: async () => { sent++; } } };
  await V.pieceVerified(env, "none");
  p.prepare("INSERT INTO companion_pieces (slug, form, title, body_md, day, created_at) VALUES ('u1','essay','Unaudited','body','2026-10-10','2026-10-10T00:00:00Z')").run();
  const r1 = await V.sendMail(env, { title: "Unaudited", body_md: "body", form: "essay", link: "x" }, "u1", "2026-10-10");
  ok(r1.ok === false && sent === 0, "an unaudited piece is not mailed", r1);
  await V.recordAudit(env, "u1", "pass", "pass", { judges: [], problems: [] });
  const r2 = await V.sendMail(env, { title: "Audited", body_md: "body", form: "essay", link: "x" }, "u1", "2026-10-10");
  ok(r2.ok === true && sent === 1, "an audited piece is mailed", r2);
  await V.retractPiece(env, "u1", "test", []);
  const r3 = await V.sendMail(env, { title: "Audited", body_md: "body", form: "essay", link: "x" }, "u1", "2026-10-10");
  ok(r3.ok === false && sent === 1, "a retracted piece is not mailed", r3);
}

// ---- the audit and the public retraction path ------------------------------------------------------------------------------------
{
  installFetch();
  const p = world(), mw = modelWorld({}), env = makeEnv(p, mw);
  await V.pieceVerified(env, "x");
  const ins = p.prepare("INSERT INTO companion_pieces (slug, form, title, body_md, day, created_at, ground_text) VALUES (?,?,?,?,'2026-10-09','2026-10-09T00:00:00Z',?)");
  ins.run("legacy", "essay", "Legacy piece", "Some earlier text from a model's memory.", null);
  ins.run("stored-bad", "essay", "Stored bad", "The Alpha Subject recorded 14 measurements, and in 1863 Dr. Delmore Quill disagreed.", SRC["Alpha Subject"]);
  ins.run("stored-good", "essay", "Stored good", "The Alpha Subject recorded 14 measurements in 1987 at the Beta Station.", SRC["Alpha Subject"]);
  const down = modelWorld({ reviewDown: true });
  const rDown = await V.auditPublished({ PERSONAL: wrap(p), AI: down.AI }, 10);
  ok(rDown.withdrawn === 1 && rDown.retracted === 1 && rDown.deferred === 1 && count(p, "companion_audits") === 2, "with the reviewers down the audit withdraws and retracts without a model, and defers the rest (no pass written)", rDown);
  const r = await V.auditPublished(env, 10);
  ok(r.passed === 1 && p.prepare("SELECT verdict FROM companion_audits WHERE slug='stored-good'").get().verdict === "pass", "the sourced piece passes once the reviewers are back", r);
  ok(p.prepare("SELECT verdict, stage FROM companion_audits WHERE slug='stored-bad'").get().stage === "grounding", "the piece with an invented name and year failed at the grounding stage");
  ok(count(p, "companion_retractions") === 2, "the withdrawn and the failed pieces are both retracted", p.prepare("SELECT slug, reason FROM companion_retractions").all());
  const ctx = { waitUntil() {} };
  const list = await (await W.fetch(new Request("https://x.test/api/pieces"), env, ctx)).json();
  ok(list.count === 1 && list.pieces[0].slug === "stored-good", "only the verified piece is served", list.pieces.map((x) => x.slug));
  const page = await W.fetch(new Request("https://x.test/p/stored-bad"), env, ctx), t = await page.text();
  ok(page.status === 410 && /Retracted: Stored bad/.test(t) && /noindex/.test(t) && !/Dr\. Delmore Quill disagreed/.test(t) && /could not be verified/.test(t), "a retracted piece answers 410 with a public notice, not its text", t.slice(0, 200));
  const lg = await W.fetch(new Request("https://x.test/p/legacy"), env, ctx);
  ok(lg.status === 410, "a withdrawn piece answers 410 too");
  const idx = await (await W.fetch(new Request("https://x.test/"), env, ctx)).text();
  ok(!/Stored bad|Legacy piece/.test(idx) && /Stored good/.test(idx), "retracted pieces are gone from the index");
  const feed = await (await W.fetch(new Request("https://x.test/feed.xml"), env, ctx)).text();
  ok(!/stored-bad|legacy/.test(feed) && /stored-good/.test(feed), "and from the feed");
  const ra = await (await W.fetch(new Request("https://x.test/api/retractions"), env, ctx)).json();
  ok(ra.count === 2 && ra.retractions.some((x) => x.slug === "stored-bad"), "the retractions API lists them", ra);
  const rp = await (await W.fetch(new Request("https://x.test/retractions"), env, ctx)).text();
  ok(/Stored bad/.test(rp) && /Legacy piece/.test(rp), "and so does the retractions page");
  const again = await V.auditPublished(env, 10);
  ok((again.checked || 0) === 0 && (again.withdrawn || 0) === 0, "an audited piece is not audited again", again);
}

// ---- FACTCHECK-NOTHINK-1 / VERDICT-TOLERANT-1 ------------------------------------------------------------------------------------
{
  const fx = V.factCheckExtra;
  ok("reasoning is switched off for kimi, nemotron, gpt-oss and deepseek, and left alone for others", fx("@cf/moonshotai/kimi-k2.6").chat_template_kwargs.thinking === false && fx("@cf/nvidia/nemotron-3-120b-a12b").chat_template_kwargs.enable_thinking === false && fx("@cf/openai/gpt-oss-120b").reasoning.effort === "low" && fx("@cf/deepseek-ai/deepseek-v4-pro-0813").chat_template_kwargs.thinking === false && Object.keys(fx("@cf/zai-org/glm-5.3")).length === 0);
  ok("a verdict wrapped in prose is read", V.parseFactVerdict('Here is my answer: {"unsupported": ["x -- y"], "verdict": "fail"} Hope this helps {done}').verdict === "fail");
  ok("a truncated JSON reply still yields its explicit verdict and quotes", (() => { const r = V.parseFactVerdict('{"unsupported": ["the claim -- not in source", "another -- no"], "verdict": "fail"'); return r && r.verdict === "fail" && r.unsupported.length === 2; })());
  ok("a reply with no verdict field is still no verdict", V.parseFactVerdict("The draft looks fine to me.") === null);
}
// ---- REJECT-CONTEXT-1 -----------------------------------------------------------------------------------------------------------
{
  const c = V.problemContext("The study ran first. Later the Failure rate rose sharply in every trial.", ["name not in the source: Failure", "year not in the source: 1999"]);
  ok(/Failure => .*the Failure rate rose/.test(c) && !/1999/.test(c), "a flagged name is logged with its surrounding text; an absent item adds nothing", c);
  ok(V.problemContext("", ["name not in the source: X"]) === "" && V.problemContext("t", null) === "", "empty inputs give an empty context");
}
// ---- OPENER-WORD-1 ----------------------------------------------------------------------------------------------------------------
{
  const src = "InstantFusion lets two image generators share a latent interface. ImageNet is the benchmark used.";
  const g = (txt) => V.groundingProblems(txt, src, { today: "2026-10-12" });
  ok(g("Should InstantFusion be used here? Translating ImageNet results is the open question.").length === 0, "a sentence-opening ordinary word before a source name is not a name problem", g("Should InstantFusion be used here? Translating ImageNet results is the open question."));
  ok(g("Later, Zorblax InstantFusion appeared.").some((x) => /Zorblax/.test(x)), "an invented name mid-sentence still fails");
  ok(g("Zorblax Quimby invented the method.").some((x) => /Quimby/.test(x)), "an invented name after the opener still fails");
  ok(g("Results reached 78 % on the benchmark.").some((x) => /78/.test(x)), "an invented figure still fails");
}
{
  const gn = V.groundingNeedles;
  const n = gn(["grounding: figure not in the source: 8.34", "grounding: name not in the source: Soft Actor Critic", "grounding: figure not in the source: 8.34"]);
  ok(n.length === 2 && n[0] === "8.34" && n[1] === "Soft Actor Critic", "needles come from the real 'not in the source:' messages, deduplicated");
  ok(gn([]).length === 0 && gn(["essay length 10"]).length === 1, "empty input gives no needles");
}
// ---- COMPANION-STALL-YIELD-1 (1.37.0, agent_issues 100064) ---------------------------------------------------------------------
// reading.q08.org published nothing for 13 h: 29 of 158 rejections in 24 h were lengths ("essay length 3741") rewritten from scratch, 46 of 61
// runs ended "time budget spent after 2 attempts", and the fact-prune loop kept re-verifying drafts that drew the same kinds of invention.
{
  const wordsN = (n) => Array.from({ length: n }, (_, i) => "w" + i).join(" ");
  const pc = (n) => ({ title: "A long piece", lede: "", body_md: wordsN(n) });
  const sh = V.shortenFeedback;
  const f = sh(["essay length 3741"], "essay", pc(3741));
  ok(f && /3741 words against a ceiling of 3200/.test(f) && /cut to at most 2700 words/.test(f) && /Do not start over/.test(f) && /Add nothing/.test(f) && /removing the least-sourced passages/.test(f), "an over-length essay is told to cut to 500 words under the ceiling and add nothing", f && f.slice(0, 400));
  ok(f && /# A long piece/.test(f) && f.indexOf("w0 w1 w2") > 0 && f.indexOf("w3740") > 0, "and receives its own draft in full, title first", f && f.length);
  ok(/cut to at most 2300 words/.test(sh(["serial length 2950"], "serial", pc(2950)) || "") && /cut to at most 2700 words/.test(sh(["notes length 3300"], "notes", pc(3300)) || ""), "serial and notes use their own ceilings (2800 and 3200) with the same headroom");
  ok(2700 > V.floorFor("essay") && 2300 > V.floorFor("serial") && 2700 > V.floorFor("notes"), "shortening targets remain above their form floors");
  ok(sh(["essay length 3200"], "essay", pc(3200)) === null && sh(["serial length 2800"], "serial", pc(2800)) === null, "a length at the ceiling gives no shorten feedback");
  ok(sh(["essay length 1500"], "essay", pc(1500)) === null, "a length under the ceiling is the extend path's, not this one");
  ok(sh(["essay length 3741", "banned: tapestry"], "essay", pc(3741)) === null && sh([], "essay", pc(3741)) === null && sh(null, "essay", pc(3741)) === null, "a multi-problem list, an empty one or none gives null");
  ok(sh(["notes length 3741"], "essay", pc(3741)) === null && sh(["essay items 5"], "essay", pc(3741)) === null && sh(["essay length 3741"], "poem", pc(3741)) === null, "another form's length and other problems give null");
  ok(sh(["essay length 4801"], "essay", pc(4801)) === null && sh(["essay length 4800"], "essay", pc(4800)) !== null, "a draft more than 1.5 times the ceiling is a broken one and is rewritten");
  const withLede = sh(["essay length 3300"], "essay", { title: "T", lede: "Standalone lede paragraph.", body_md: "Body text only." });
  ok(withLede && withLede.indexOf("Standalone lede paragraph.") < withLede.indexOf("Body text only."), "a lede stored apart from the body is part of the draft the writer is shown");
  ok(V.LENGTH_CEILING.essay === 3200 && V.LENGTH_CEILING.serial === 2800 && V.LENGTH_CEILING.notes === 3200, "the ceiling table repeats the validator's: essay 3200, serial 2800, notes 3200");
  // the validator is unchanged: it accepts the ceiling and rejects one word over, and the floors are untouched
  const lenOf = (form, n) => mod.validatePiece({ title: "A long piece", body_md: wordsN(n), objection: "The strongest objection is that the readings are too few to separate drift from noise." }, form, undefined, {}).problems.filter((x) => /length/.test(x));
  ok(lenOf("essay", 3200).length === 0 && lenOf("essay", 3201).length === 1, "validatePiece accepts an essay of 3200 words and rejects 3201");
  ok(lenOf("serial", 2800).length === 0 && lenOf("serial", 2801).length === 1, "and a serial of 2800 and 2801");
  ok(lenOf("notes", 3200).filter((x) => /^notes length/.test(x)).length === 0 && lenOf("notes", 3201).filter((x) => /^notes length/.test(x)).length === 1, "and notes of 3200 and 3201");
  ok(/var LENGTH_FLOOR = \{ essay: 2000, serial: 1800, notes: 1700 \};/.test(src) && /wc > 3200\)\) problems\.push\("essay length "/.test(src) && /wc > 2800\)\) problems\.push\("serial length "/.test(src), "the floors and the literal ceilings in validatePiece are untouched");
  // generate() uses it only after the extend path declined
  const gen = src.slice(src.indexOf("async function generate("), src.indexOf("var CRON_TABLE"));
  ok(/var shortOnly = expandFeedback\(v\.problems, form, piece\);\n\s+if \(shortOnly\) feedback = shortOnly;\n\s+else \{[\s\S]*?var longOnly = shortenFeedback\(v\.problems, form, piece\);/.test(gen), "generate() tries the extend path first, then the shorten path");
}
{
  // the claim classes and the repeat rule
  const C = V.pruneClassOf;
  ok(C("unsupported claim: FACT: In 1863 Dr. Quill built the first index -- not in source") === "figure" && C("unsupported claim: 4000 readers used it -- x") === "figure", "a digit makes a claim a figure (year, count, percentage)");
  ok(C('unsupported claim: He said "no one will come" -- not in source') === "quotation", "quotation marks make a quotation");
  ok(C("unsupported claim: FACT: the board of Delmore Quill ruled -- not in source") === "name", "a capitalised word after the first makes a name");
  ok(C("unsupported claim: INFERENCE: the surveyors worked without iron tools -- not in source") === "assertion" && C("unsupported claim: Surveyors worked without iron tools -- x") === "assertion", "anything else is an assertion; a capitalised first word is not a name");
  ok(C("unsupported claim: the claim 1863 -- the reason says Quill") === "figure", "the class is read from the claim, not from the reviewer's reason");
  ok(JSON.stringify(V.pruneClassesOf(["unsupported claim: a b -- x", "unsupported claim: In 1863 -- x", "unsupported claim: c d -- x"])) === '["assertion","figure"]', "a verdict's classes are unique and sorted");
  const R = V.pruneRepeat, A = (n) => ({ classes: ["assertion"], n }), p = (n, label) => Array.from({ length: n }, () => "unsupported claim: " + (label || "the surveyors worked without iron tools") + " -- x");
  ok(V.PRUNE_REPEAT_AFTER === 2, "the loop is cut only after two answered prune rounds");
  ok(R([], p(3)).recurring === false && R([], p(3)).stop === false, "the first verdict is never a repeat");
  ok(R([A(3)], p(3)).recurring === true && R([A(3)], p(3)).stop === false, "one earlier round with the same classes recurs but does not stop the loop");
  ok(R([A(3), A(3)], p(3)).stop === true && /^repeat assertion \(3 items after 3\)$/.test(R([A(3), A(3)], p(3)).why), "two earlier rounds, the same classes and no fewer items: stop");
  ok(R([A(8), A(8)], p(3)).stop === false && R([A(8), A(8)], p(3)).recurring === true, "the documented 8, 8, 3 path is converging and continues");
  ok(R([A(8), A(8)], p(8)).stop === true, "8, 8, 8 stops");
  ok(R([A(3), A(3)], p(3, "In 1863 Dr. Quill")).recurring === false && R([A(3), A(3)], p(3, "In 1863 Dr. Quill")).stop === false, "a new class of claim is not a repeat");
  ok(R([A(3), A(3)], []).recurring === false && R([A(3), A(3)], null).stop === false, "an empty verdict is not a repeat");
  // generate() wires it: before pruning, on a blocked prune, and ahead of the corrective revision
  const gen = src.slice(src.indexOf("async function generate("), src.indexOf("var CRON_TABLE"));
  ok(/var prep = pruneRepeat\(pruneSeen, vr\.problems\);\n\s+if \(prep\.stop\) \{ pruneStopped = prep\.why;/.test(gen) && /pruneSeen\.push\(\{ classes: prep\.classes, n: \(vr\.problems \|\| \[\]\)\.length \}\);/.test(gen), "generate() checks the repeat before each prune and records the verdict a prune answered");
  ok(gen.indexOf("if (prep.recurring) { pruneStopped = prep.why;") > 0 && gen.indexOf("if (prep.recurring) { pruneStopped = prep.why;") < gen.indexOf("if (pruneBlockFixable(pv.problems, form)) prunedShort ="), "a blocked prune with recurring classes is decided before the extension draft is kept");
  ok(/if \(!vr\.ok && !vr\.unavailable && !pruneStopped && Date\.now\(\) - t0 < REVISE_BEFORE_MS\) \{/.test(gen), "a stopped loop skips the corrective revision");
}
{
  // the attempt budget
  const S = V.attemptBudgetStop;
  ok(S(0, 0, 600e3) === "" && S(599e3, 0, 600e3) === "", "the first attempt has no measure and always starts");
  ok(S(250e3, 250e3, 600e3) === "" && S(350e3, 250e3, 600e3) === "", "an attempt that can finish inside the budget starts (350 s left, 250 s cost)");
  ok(S(351e3, 250e3, 600e3) === "249 s left, an attempt cost 250 s", "less budget left than the measured cost: no attempt", S(351e3, 250e3, 600e3));
  ok(S(700e3, 250e3, 600e3) === "0 s left, an attempt cost 250 s", "an overspent budget reads 0 s left");
  ok(/var GEN_BUDGET_MS = 600e3;/.test(src), "the budget is still 600 s");
  ok(/^time budget spent after 2 attempts \(100 s left, an attempt cost 250 s/.test("time budget spent after 2 attempts (" + S(500e3, 250e3, 600e3) + "; x)") && V.stallAttemptStage("time budget spent after 2 attempts (100 s left, an attempt cost 250 s; x)") === "time budget", "the stop keeps the lead the stall digest counts as the time-budget stage");
}
{
  // end to end: an over-length essay is cut, not rewritten (companion_runs #11643 "essay length 3741")
  installFetch();
  const p = world();
  const longBody = goodBody() + "\n\n" + paras(4);
  let prompt2 = "";
  const mw = modelWorld({ draft: (n, input) => { if (n === 2) prompt2 = input.messages[1].content; return n === 1 ? longBody : goodBody(); } });
  const out = await V.generate(makeEnv(p, mw), "essay", {});
  const rej = p.prepare("SELECT detail FROM companion_runs WHERE status = 'rejected' ORDER BY id LIMIT 1").get();
  const m = rej && /^validate: essay length (\d+)/.exec(rej.detail);
  ok(m && Number(m[1]) > 3200 && Number(m[1]) <= 4800, "the long draft is rejected for its length alone", rej && rej.detail.slice(0, 120));
  ok(/too long: \d+ words against a ceiling of 3200/.test(prompt2) && /cut to at most 2700 words/.test(prompt2) && !/failed validation for these reasons/.test(prompt2), "the next attempt is asked to cut the draft, not to try again", prompt2.slice(0, 600));
  ok(prompt2.indexOf("The strongest objection is that fourteen readings") > 0, "and is shown the draft it must cut");
  ok(out.ok === true && mw.log.writer === 2 && count(p, "companion_pieces") === 1, "the second draft publishes through every gate", { out, log: mw.log });
  ok(p.prepare("SELECT COUNT(*) n FROM companion_runs WHERE status = 'stage' AND detail LIKE 'shorten: essay length%against a ceiling of 3200%'").get().n === 1, "the run log has one shorten stage row");
}
{
  // end to end: a draft that keeps drawing the same kind of invented claim is not pruned five times
  installFetch();
  const p = world();
  const TREES = ["alder", "birch", "cedar", "dogwood", "elm", "fir", "gum", "hazel", "ironwood", "juniper", "kauri", "larch", "maple", "nutmeg", "oak", "pine", "quince", "rowan", "spruce", "teak", "upas", "viburnum", "willow", "yew", "zelkova", "ash", "beech", "cypress", "elder", "fig"];
  const BAD = TREES.map((t) => "Yet the surveyors of the " + t + " crew worked without iron tools and wrote nothing of it down.");
  const withBad = goodBody().replace("\n\n## What would falsify this", " " + BAD.join(" ") + "\n\n## What would falsify this");
  const mw = modelWorld({
    draft: () => withBad,
    review: (m, sys) => {
      const d = sys.indexOf("--- DRAFT ---") >= 0 ? sys.slice(sys.indexOf("--- DRAFT ---")) : sys;
      const hits = BAD.filter((b) => d.indexOf(b.slice(0, 60)) !== -1).slice(0, 3);
      return hits.length ? JSON.stringify({ unsupported: hits.map((b) => "FACT: " + b + " -- source does not mention iron tools"), verdict: "fail" }) : '{"unsupported":[],"verdict":"pass"}';
    }
  });
  const out = await V.generate(makeEnv(p, mw), "essay", {});
  const trail = p.prepare("SELECT detail FROM companion_runs WHERE detail LIKE 'fact prune trail:%' ORDER BY id LIMIT 1").get();
  ok(trail && /^fact prune trail: r1 -3 \(\d+ words\), r2 -3 \(\d+ words\), r3 stopped: repeat assertion \(3 items after 3\)/.test(trail.detail) && !/ r4 /.test(trail.detail), "the first attempt's prune is cut at the third round with the repeat in the trail", trail && trail.detail);
  ok(p.prepare("SELECT COUNT(*) n FROM companion_runs WHERE detail LIKE '%one corrective revision%' OR detail LIKE '%extending the pruned draft%'").get().n === 0, "and no corrective revision or extension is spent on it");
  ok(out.ok === false && count(p, "companion_pieces") === 0, "nothing is published from a draft that keeps inventing (fail closed, the gate is unchanged)", out);
  ok(p.prepare("SELECT COUNT(*) n FROM companion_runs WHERE status = 'rejected' AND detail LIKE 'fact-check factcheck: %'").get().n >= 1, "the attempt ends as a fact-check rejection and the next attempt writes a new draft");
}
{
  // end to end: no attempt is started with less budget left than the longest attempt of the run cost (fake clock, 250 s per writer call)
  installFetch();
  const p = world();
  const realNow = Date.now;
  let clock = realNow.call(Date);
  Date.now = () => clock;
  const shortDraft = "# Drift in the readings\n\n" + LEDE + "\n\n" + paras(1);
  const mw = modelWorld({ draft: () => { clock += 250e3; return shortDraft; } });
  let out;
  try { out = await V.generate(makeEnv(p, mw), "essay", {}); } finally { Date.now = realNow; }
  const row = p.prepare("SELECT detail FROM companion_runs WHERE status = 'stage' AND detail LIKE 'time budget spent%' ORDER BY id").all();
  ok(mw.log.writer === 2, "two attempts of 250 s start; the third would have 100 s left and does not", mw.log);
  ok(row.length === 1 && /^time budget spent after 2 attempts \(100 s left, an attempt cost 250 s/.test(row[0].detail), "the stop is a stage row with the time-budget lead", row);
  ok(out.ok === false && count(p, "companion_pieces") === 0, "the run fails closed", out);
}
console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
