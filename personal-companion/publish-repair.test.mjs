// COMPANION-PUBLISH-REPAIR-1 + COMPANION-LEDE-1 offline suite (personal-companion 1.17.0, charter pillar: personal).
// reading.q08.org published nothing for 73h (companion_runs 4549-5339). In the 72h to 2026-10-13 05:16Z, 154 attempts were rejected:
// grounding 102, length 42, banned phrase 32, critique 17, fact-check 8 (an attempt can carry several). Proves: writer and critic calls
// skip the AI Gateway cache; a banned-phrase sentence is deleted instead of throwing the draft away (not when the phrase is in the title,
// and not past the quarter cap); a draft left only short after the repair is extended from its cleaned text; fact-check items are FACT or
// INFERENCE and only FACT items fail (unlabelled items stay FACT); the quoted FACT sentences are deleted and the draft is re-verified
// before any model revision, and an invented claim that cannot be deleted still stops publication; the notes critic no longer scores the
// placeholder objection; every essay and notes piece opens with a lede that names its subject and is not abstract framing.
// Run: node personal-companion/publish-repair.test.mjs   -> prints "N passed, 0 failed"
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { importWorker } from "./_harness-import-worker.mjs";
const IMPORT = 'import { WorkflowEntrypoint } from "cloudflare:workers";';
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const mod = await importWorker(() => (src.replace(IMPORT, "var WorkflowEntrypoint = class {};") + "\n//" + Math.random()), new URL("./", import.meta.url));
const V = mod.__verify, validatePiece = mod.validatePiece, repair = V.repairGroundingDraft;
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " -- " + JSON.stringify(x).slice(0, 600) : "")); } };
const words = (s) => String(s).split(/\s+/).filter(Boolean).length;

// ---- VERSION ----------------------------------------------------------------------------------------------------------------------
{
  const vm = /var VERSION = "(\d+)\.(\d+)\.(\d+)/.exec(src);
  ok(vm && (+vm[1] > 1 || (+vm[1] === 1 && +vm[2] >= 17)), "VERSION is at least 1.17.0", vm && vm[0]);
}

// ---- the gateway cache is skipped for writer and critic calls ----------------------------------------------------------------------
{
  const seen = [];
  const env = { AI: { run: async (m, input, opts) => { seen.push(opts); return { response: "x".repeat(400) }; } } };
  await mod.callModel(env, [{ role: "user", content: "same prompt" }], 4000, 1000, "deepseek-chat", "writer");
  ok(seen.length === 1 && seen[0].gateway && seen[0].gateway.skipCache === true, "a Workers AI writer call asks the gateway to skip its cache", seen[0]);
}

// ---- fixtures -----------------------------------------------------------------------------------------------------------------------
const source = "Wikipedia article: Alpha Subject The Alpha Subject recorded 14 measurements in 1987 at the Beta Station. Surveyors at the Beta Station said the readings drifted by 2.5 percent a year. A later review by the Gamma Committee found the drift was real and that the Lantern Index described it.";
const grounded = [
  "The Alpha Subject recorded 14 measurements in 1987 at the Beta Station, and the surveyors there watched the readings drift.",
  "The drift the surveyors described was real, and the later review by the Gamma Committee said so in plain words.",
  "What the readings show is a slow movement, not a jump, and the surveyors treated it as such from the first year.",
  "If the drift holds at the rate the surveyors gave, it follows that the station's record cannot be read without a correction.",
  "The Lantern Index described the drift, and the review treated the index as the plainest account of what the station saw."
];
const para = (n) => { const out = []; for (let i = 0; i < n; i++) out.push(grounded[i % grounded.length]); return out.join(" "); };
const LEDE = "The Alpha Subject, the subject of a Wikipedia article, is a record of 14 measurements taken in 1987 at the Beta Station, and it matters because its readings drift.";
const notesOf = (extra) => ({ title: "Notes on the drift at the station", subtitle: "", lede: LEDE, body_md: ["## The station and its readings", "", para(30) + (extra || ""), "", "## The drift", "", para(30), "", "## The review", "", para(30)].join("\n"), objection: V.NOTES_OBJECTION_PLACEHOLDER });

// ---- banned-phrase repair -----------------------------------------------------------------------------------------------------------
{
  const piece = notesOf(" The record stands as a reminder of the drift. The station serves as a ledger for the surveyors.");
  const v = validatePiece(piece, "notes", source);
  ok(!v.ok && v.problems.length === 1 && /^banned: /.test(v.problems[0]), "a banned phrase fails validation as a banned problem", v.problems);
  const r = repair(piece, v.problems, "notes", source);
  ok(r && r.ok && r.removed === 2, "both banned-phrase sentences are deleted and the draft is accepted", r && { removed: r.removed, v: r.v });
  ok(r && !/stands as a|serves as a/.test(r.piece.body_md) && r.piece.body_md.split("\n").filter((l) => l.indexOf("## ") === 0).length === 3, "no banned phrase remains and every heading survives");
  ok(r && r.piece.title === piece.title && r.piece.lede === piece.lede && r.piece.objection === piece.objection, "title, lede and objection are carried over");
  const both = notesOf(" In 1863 the Zorblax Engine stands as a relic.");
  const vb = validatePiece(both, "notes", source);
  const rb = repair(both, vb.problems, "notes", source);
  ok(vb.problems.some((p) => /^banned/.test(p)) && vb.problems.some((p) => /^grounding/.test(p)) && rb && rb.ok && !/Zorblax|1863|stands as a/.test(rb.piece.body_md), "grounding and banned problems together are repaired in one pass", vb.problems);
  const titled = Object.assign({}, piece, { title: "The station stands as a ledger" });
  ok(repair(titled, validatePiece(titled, "notes", source).problems, "notes", source) === null, "a banned phrase in the title is not repaired");
  const many = { title: "Short notes", lede: "", body_md: ["## One", "", "It serves as a test. " + grounded[0] + " It serves as a sign.", "", "## Two", "", grounded[1] + " This serves as a third.", "", "## Three", "", grounded[2]].join("\n"), objection: "" };
  ok(repair(many, ["banned: serves as a"], "notes", source) === null, "deleting more than a quarter of the sentences is refused");
}

// ---- a draft left only short is handed to the extend path, cleaned ----------------------------------------------------------------
{
  const short = { title: "Short notes on the station", lede: "", body_md: ["## One", "", para(6) + " The record stands as a reminder.", "", "## Two", "", para(6), "", "## Three", "", para(6)].join("\n"), objection: "" };
  const v = validatePiece(short, "notes", source);
  ok(v.problems.some((p) => /^notes length/.test(p)) && v.problems.some((p) => /^banned/.test(p)), "the draft is short and carries a banned phrase", v.problems);
  const r = repair(short, v.problems, "notes", source);
  ok(r && r.ok === false && r.piece && !/stands as a/.test(r.piece.body_md) && r.v.problems.length === 1 && /^notes length/.test(r.v.problems[0]), "the cleaned draft comes back with only its length problem", r && r.v);
  const fb = mod.expandFeedback(r.v.problems, "notes", r.piece);
  ok(fb && /Do not start over/.test(fb) && !/stands as a/.test(fb), "the extend prompt carries the cleaned draft, not the banned sentence");
  const loop = src.slice(src.indexOf("async function generate("), src.indexOf("var CRON_TABLE"));
  ok(/else if \(gr && gr\.piece\) \{/.test(loop) && loop.indexOf("else if (gr && gr.piece)") < loop.indexOf("var shortOnly = expandFeedback(v.problems, form, piece);"), "generate uses the cleaned draft before the extend path");
}

// ---- repaired drafts are held to 85% of the floor -----------------------------------------------------------------------------------
{
  ok(V.REPAIR_FLOOR_SHARE === 0.85 && V.FALLBACK_FLOOR_RATIO === 0.5, "repair share 0.85, fallback ratio 0.5");
  const body = (n) => ["## A", "", "w ".repeat(Math.floor(n / 3)), "", "## B", "", "w ".repeat(Math.floor(n / 3)), "", "## C", "", "w ".repeat(Math.floor(n / 3))].join("\n");
  ok(validatePiece({ title: "Tttt", body_md: body(1500) }, "notes").problems.some((p) => /length/.test(p)) || V.floorFor("notes") <= 1500, "sanity: the floor applies without a share");
  const f = V.floorFor("notes"), fr = V.floorFor("notes", 0.85);
  ok(fr === Math.round(f * 0.85), "floorFor applies the share to the floor in effect", { f, fr });
}

// ---- FACT and INFERENCE ---------------------------------------------------------------------------------------------------------------
{
  const s = V.splitFactItems([
    "FACT: the road was finished in 1952 -- date not in source",
    "INFERENCE: so the builders worked under pressure -- reasoning from the source",
    "Their reliance on oak underscores a commitment to a single material -- not in source",
    "Yet the Corlea builders operated without the benefit of iron tools -- source does not mention iron tools",
    "the readings were taken every night -- not in source",
    "the record shows a slow drift -- slightly different wording than the source",
    "FACT: whatever pattern appears here would repeat wherever a road is built -- not in source"
  ]);
  ok(s.facts.length === 3 && s.facts.some((f) => /1952/.test(f)) && s.facts.some((f) => /iron tools/.test(f)) && s.facts.some((f) => /every night/.test(f)), "dates, named claims and plain unlabelled claims are FACT", s);
  ok(s.inferences.length === 4 && s.inferences.some((f) => /oak underscores/.test(f)) && s.inferences.some((f) => /different wording/.test(f)) && s.inferences.some((f) => /wherever/.test(f)), "labelled inferences, reasoning-shaped claims, paraphrases and general FACT-labelled reasoning are INFERENCE", s);
  const onlyInf = V.parseFactVerdict('{"unsupported":["INFERENCE: so the builders worked under pressure -- reasoning"],"verdict":"fail"}');
  ok(onlyInf.verdict === "pass" && onlyInf.inferences.length === 1 && onlyInf.unsupported.length === 0, "a fail listing only INFERENCE items is a pass with sentences to delete", onlyInf);
  const fact = V.parseFactVerdict('{"unsupported":["FACT: the road was finished in 1952 -- date not in source"],"verdict":"pass"}');
  ok(fact.verdict === "fail" && fact.unsupported[0] === "the road was finished in 1952 -- date not in source", "a pass that lists a FACT item is a fail, label stripped", fact);
  ok(V.parseFactVerdict('{"unsupported":[],"verdict":"fail"}').unsupported.length === 1, "a bare fail still fails closed with a reason");
  const obj = V.parseFactVerdict('{"unsupported":[{"label":"FACT","claim":"the road was finished in 1952","reason":"date not in source"}],"verdict":"fail"}');
  ok(obj.verdict === "fail" && /1952/.test(obj.unsupported[0]) && !/object Object/.test(obj.unsupported[0]), "an item given as an object is read, not '[object Object]'", obj);
  ok(/FACT: /.test(V.prompts.FACTCHECK_PROMPT) && /INFERENCE: /.test(V.prompts.FACTCHECK_PROMPT) && /When unsure, label it FACT/.test(V.prompts.FACTCHECK_PROMPT), "the reviewer prompt asks for labels and defaults to FACT");
}

// ---- pruneUnsupported -------------------------------------------------------------------------------------------------------------------
{
  const piece = notesOf(" Yet the surveyors worked without the benefit of iron tools that later dominated the age.");
  const pr = V.pruneUnsupported(piece, ["unsupported claim: Yet the surveyors worked without the benefit of iron tools -- source does not mention iron tools"]);
  ok(pr.removed.length === 1 && !/iron tools/.test(pr.piece.body_md) && pr.piece.body_md.split("\n").filter((l) => l.indexOf("## ") === 0).length === 3, "the quoted sentence is deleted, headings kept", pr.removed);
  const fz = V.pruneUnsupported(piece, ["unsupported claim: surveyors lacked iron tools, which later dominated that age -- not in source"]);
  ok(fz.removed.length === 1 && /iron tools/.test(fz.removed[0]), "a paraphrased quotation removes the one sentence sharing most of its content words", fz.removed);
  const none = V.pruneUnsupported(piece, ["unsupported claim: an elephant crossed the river at dawn -- not in source"]);
  ok(none.removed.length === 0 && none.piece.body_md === piece.body_md, "a quotation that matches nothing removes nothing");
  const lp = V.pruneUnsupported(Object.assign({}, piece, { lede: LEDE + " It was built by kings." }), ["unsupported claim: It was built by kings -- not in source"]);
  ok(lp.removed.length === 0 || !/kings/.test(lp.piece.lede), "the lede field is pruned too (short quotations under 18 characters are ignored)");
}

// ---- the lede ------------------------------------------------------------------------------------------------------------------------------
{
  const subject = "Corlea Trackway";
  const good = { title: "T", lede: "The Corlea Trackway, described in a Wikipedia article, is an Iron Age road of oak planks laid across a bog, and it matters because it shows how much labour one crossing took.", body_md: "## One\n\ntext" };
  ok(V.ledeProblems(good, subject).length === 0, "a lede that says what the subject is and where it comes from passes", V.ledeProblems(good, subject));
  ok(V.ledeProblems(Object.assign({}, good, { lede: "The idea of a road is older than any road. People have always crossed wet ground." }), subject).length >= 1, "an abstract opening that never names the subject fails");
  ok(V.ledeProblems(Object.assign({}, good, { lede: "In an era of roads, the Corlea Trackway was one more." }), subject).some((p) => /abstract/.test(p)), "'In an era of' framing fails");
  ok(V.ledeProblems(Object.assign({}, good, { lede: "What makes a road last? The Corlea Trackway answers it." }), subject).some((p) => /question/.test(p)), "a question opening fails");
  ok(V.ledeProblems(Object.assign({}, good, { lede: "Oak planks lie across a bog in the midlands, laid in one season." }), subject).some((p) => /does not name the subject/.test(p)), "a lede that does not name the subject fails");
  ok(V.ledeProblems(Object.assign({}, good, { lede: "The Corlea trackways " + "and more ".repeat(70) }), subject).some((p) => /too long/.test(p)), "a lede over 120 words fails; 'trackways' still names 'Trackway'");
  ok(V.ledeProblems({ title: "T", lede: "", body_md: "## One\n\nThe Corlea Trackway is a road of oak planks.\n\nMore." }, subject).length === 0, "with no separate lede, the first prose paragraph of the body is the lede");
  ok(V.ledeProblems({ title: "T", lede: "", body_md: "## One" }, subject).some((p) => /missing/.test(p)), "no prose at all is a missing lede");
  const arx = "OGLE-2016-BLG-0523: A Low-mass Brown Dwarf or super-Jupiter in a $&gt;100$ au Orbit";
  ok(V.ledeProblems({ title: "T", lede: "An arXiv paper reports a low-mass brown dwarf found by microlensing, which matters because such wide orbits are rare.", body_md: "x" }, arx).length === 0, "an arXiv title is matched by its significant words");
  const piece = notesOf("");
  ok(validatePiece(Object.assign({}, piece, { lede: "Few things are as quiet as a ledger." }), "notes", source, { subject: "Alpha Subject" }).problems.some((p) => /^lede/.test(p)), "validatePiece runs the lede check when given the subject");
  ok(validatePiece(Object.assign({}, piece, { lede: "Few things are as quiet as a ledger." }), "serial", source, { subject: "Alpha Subject" }).problems.every((p) => !/^lede/.test(p)), "a serial installment is not held to the lede check");
  ok(validatePiece(Object.assign({}, piece, { lede: "Few things are as quiet as a ledger." }), "notes", source).problems.every((p) => !/^lede/.test(p)), "without a subject the check is off (old callers unchanged)");
  ok(repair(Object.assign({}, piece, { lede: "Few things are as quiet as a ledger." }), ["lede does not name the subject: x", "banned: stands as a"], "notes", source) === null, "a lede problem is not repaired by deletion");
  ok(/LEDE \(inverted pyramid/.test(V.prompts.P_STYLE) && /Wikipedia article/.test(V.prompts.P_STYLE) && /arXiv paper/.test(V.prompts.P_STYLE), "the writer prompt asks for the lede and names the source kinds");
}

// ---- LEDE-SPLIT-1 (1.19.1, run 5342-5364): an over-long lede is split at a sentence boundary, nothing added or removed ------------------
{
  const s1 = "The Corlea Trackway is an Iron Age road of oak planks in a bog, described in a Wikipedia article. ";
  const filler = "Its builders laid the planks across wet ground in one season and the road sank within a few years of its making. ";
  const longLede = s1 + filler.repeat(6);
  const piece = { title: "T", lede: longLede.trim(), body_md: "## One\n\nBody text here.", objection: "" };
  const sp = V.splitLongLede(piece);
  const wc = (t) => String(t).split(/\s+/).filter(Boolean).length;
  ok(sp !== piece && wc(sp.lede) <= 100 && sp.lede.indexOf("The Corlea Trackway is an Iron Age road") === 0, "the lede keeps its opening sentences within 100 words", wc(sp.lede));
  ok(sp.body_md.indexOf("## One") > 0 && (sp.lede + " " + sp.body_md.split("\n\n## One")[0]).replace(/\s+/g, " ").trim() === longLede.replace(/\s+/g, " ").trim(), "the rest becomes the first body paragraph; no word is added or lost");
  ok(V.ledeProblems(sp, "Corlea Trackway").length === 0, "the split lede passes the lede check");
  ok(V.splitLongLede(Object.assign({}, piece, { lede: s1 })) !== undefined && V.splitLongLede(Object.assign({}, piece, { lede: s1.trim() })).lede === s1.trim(), "a short lede is left alone");
  const one = Object.assign({}, piece, { lede: "word ".repeat(150).trim() + "." });
  ok(V.splitLongLede(one) === one, "a single over-long sentence is not split (the check still reports it)");
  const dup = { title: "T", lede: longLede.trim(), body_md: "## One\n\n" + longLede.trim() + "\n\nMore.", objection: "" };
  const sd = V.splitLongLede(dup);
  ok(wc(sd.lede) <= 100 && sd.body_md === dup.body_md, "a lede read out of the body is shortened without duplicating the body text");
  const loop = src.slice(src.indexOf("async function generate("), src.indexOf("var CRON_TABLE"));
  ok(loop.indexOf("var split = splitLongLede(piece);") !== -1 && loop.indexOf("var split = splitLongLede(piece);") < loop.indexOf("var v = validatePiece(piece, form, ground, vopts);"), "generate splits the lede before validation");
}

// ---- source labels in the briefing and the ground text; "Wikipedia" is grounded ------------------------------------------------------
{
  const anchors = [{ kind: "concept", ref: "https://en.wikipedia.org/wiki/Corlea_Trackway", title: "Corlea Trackway", text: "The Corlea Trackway is an Iron Age road." }, { kind: "paper", ref: "http://arxiv.org/abs/1", title: "A paper", text: "Abstract." }];
  ok(V.sourceLabel(anchors[0]) === "Wikipedia article" && V.sourceLabel(anchors[1]) === "arXiv paper", "source labels");
  const g = V.anchorsText(anchors);
  ok(/^Wikipedia article: Corlea Trackway/.test(g) && /arXiv paper: A paper/.test(g), "the ground text carries the source kind", g);
  const brief = V.anchorsBlock({ a: "Corlea Trackway" }, anchors, "life", "profile");
  ok(/the subject comes from: the Wikipedia article "Corlea Trackway"/.test(brief) && /\[1\] Wikipedia article :: Corlea Trackway/.test(brief), "the briefing names where the subject comes from");
  ok(V.groundingProblems("# Road\n\nThe Wikipedia article on the Corlea Trackway describes an Iron Age road.", g).length === 0, "naming the Wikipedia article is not an ungrounded name");
  ok(/mentions of the source itself/.test(V.prompts.FACTCHECK_PROMPT), "reviewers are told a mention of the source is not a violation");
}

// ---- the critic and the notes placeholder objection ------------------------------------------------------------------------------------
{
  let seen = "";
  const env = { AI: { run: async (m, input) => { seen = input.messages[1].content; return { response: '{"specificity":8,"argument":8,"objection":2,"voice":8,"grounding":9,"systems":8,"verdict":"accept","why":"ok"}' }; } } };
  await V.critiquePiece(env, notesOf(""), "notes", source);
  ok(/STATED OBJECTION: \(no separate objection section/.test(seen) && seen.indexOf(V.NOTES_OBJECTION_PLACEHOLDER) === -1, "the critic is not shown the notes placeholder as the stated objection");
  const essay = { title: "T", lede: "L", body_md: "B", objection: "The strongest objection is that fourteen readings are too few to separate drift from noise." };
  await V.critiquePiece(env, essay, "essay", source);
  ok(seen.indexOf("STATED OBJECTION: The strongest objection is that fourteen") !== -1, "an essay's real objection is still shown");
  const loop = src.slice(src.indexOf("async function generate("), src.indexOf("var CRON_TABLE"));
  const cw = src.slice(src.indexOf("function critiqueWorst("), src.indexOf("function criticQuotes("));
  ok(/var dims = form === "notes" \? \["specificity", "argument", "voice", "systems"\] : \["specificity", "argument", "objection", "voice", "systems"\];/.test(cw) && /gateWorst\(q, form, gg\)/.test(loop) && /function qualityWorst\(q, form\) \{\n  var dims = form === "notes" \? \["specificity", "argument", "voice", "systems"\] : \["specificity", "argument", "objection", "voice", "systems"\];/.test(src), "the notes objection score does not gate; essays and serials keep it; the systems score gates every form (COMPANION-SYSTEMS-ANALYSIS-1; through gateWorst since GATE-SEPARATION-1) essays and serials keep it; the systems score gates every form (COMPANION-SYSTEMS-ANALYSIS-1)");
}

// ---- end to end with an in-memory D1 and a scripted model world ----------------------------------------------------------------------
const wrap = (db) => ({ prepare(sql) { const mk = (args) => ({ bind: (...a) => mk(a),
  run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
  first: async () => db.prepare(sql).get(...args) || null, all: async () => ({ results: db.prepare(sql).all(...args) }) }); return mk([]); } });
function world() {
  const p = new DatabaseSync(":memory:");
  p.exec("CREATE TABLE profile (facet TEXT, label TEXT, statement TEXT, confidence REAL); CREATE TABLE activity (date TEXT, title TEXT, category TEXT, venue TEXT, city TEXT, notes TEXT, energy_label TEXT); CREATE TABLE events (start_date TEXT, title TEXT, venue TEXT, city TEXT, category TEXT); CREATE TABLE notes (ts TEXT, kind TEXT, content TEXT); CREATE TABLE companion_pieces (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE NOT NULL, form TEXT NOT NULL, title TEXT NOT NULL, subtitle TEXT, lede TEXT, body_md TEXT NOT NULL, anchor_json TEXT, quality_json TEXT, word_count INTEGER, day TEXT, created_at TEXT NOT NULL);");
  return p;
}
const sentence = "The reading at the Beta Station shows the Alpha Subject drifting, and the record of 14 measurements in 1987 keeps that pattern in view for anyone who checks it. ";
const art = (name) => ("The " + name + " is the subject of this article. " + sentence.repeat(22)).slice(0, 4200);
const SRC = { "Alpha Subject": art("Alpha Subject"), "Beta Station": art("Beta Station"), "Gamma Committee": art("Gamma Committee") };
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes("list=random")) return new Response(JSON.stringify({ query: { random: [{ title: "Alpha Subject" }, { title: "Other Thing" }] } }), { status: 200 });
  if (u.includes("prop=links")) return new Response(JSON.stringify({ query: { pages: { 1: { title: "Alpha Subject", links: [{ title: "Beta Station" }, { title: "Gamma Committee" }] } } } }), { status: 200 });
  if (u.includes("prop=extracts")) { const t = decodeURIComponent((u.match(/titles=([^&]*)/) || [])[1] || ""); return new Response(JSON.stringify({ query: { pages: { 1: { title: t, extract: SRC[t] || "" } } } }), { status: 200 }); }
  if (new URL(u).hostname === "export.arxiv.org") return new Response("<feed><entry><id>http://arxiv.org/abs/1</id><title>A paper on drift</title><summary>" + ("The Alpha Subject drifts when measured at the Beta Station. ").repeat(8) + "</summary></entry></feed>", { status: 200 });
  return new Response("{}", { status: 404 });
};
const paras = (n) => Array.from({ length: n }, () => sentence.repeat(10).trim()).join("\n\n");
const E_LEDE = "The Alpha Subject, the subject of a Wikipedia article, is a record of 14 measurements taken in 1987 at the Beta Station.";
const INVENTED = "Yet the surveyors worked without the benefit of iron tools that later dominated the age.";
const essayBody = (lede, extra) => "# Drift in the readings\n\n" + lede + "\n\n" + paras(4) + (extra ? " " + extra : "") + "\n\n## What would falsify this\n\nIf the record of 14 measurements in 1987 were re-run and the drift vanished, the claim would fail.\n\n## The objection\n\nThe strongest objection is that fourteen readings are too few to separate drift from noise, and the record cannot settle that.\n\n" + paras(4);
function modelWorld(o) {
  const log = { writer: 0, critic: 0, review: 0 };
  const AI = { run: async (model, input) => {
    const sys = (input.messages && input.messages[0] && input.messages[0].content) || "";
    if (input.text) return { data: [] };
    if (/strict fact-checker/.test(sys)) { log.review++; return { response: o.review(model, sys, log.review) }; }
    if (/even-keel reviewer/.test(sys)) { log.balance = (log.balance || 0) + 1; return { response: '{"opposing":9,"wording":9,"attribution":9,"reason":"ok"}' }; }
    if (/adversarial reader/.test(sys)) { log.critic++; return { response: '{"specificity":8,"argument":8,"objection":8,"voice":8,"grounding":9,"systems":8,"verdict":"accept","why":"ok"}' }; }
    log.writer++; return { response: typeof o.draft === "function" ? o.draft(log.writer) : o.draft };
  } };
  return { AI, log };
}
const count = (p, t) => p.prepare("SELECT COUNT(*) n FROM " + t).get().n;
{
  // reviewers quote one invented sentence as a FACT until it is gone; the prune deletes it and the second review passes
  const p = world();
  const mw = modelWorld({ draft: essayBody(E_LEDE, INVENTED), review: (m, sys) => sys.indexOf("iron tools") !== -1 && sys.lastIndexOf("iron tools") > sys.indexOf("--- DRAFT ---") ? '{"unsupported":["FACT: ' + INVENTED + ' -- source does not mention iron tools","INFERENCE: keeps that pattern in view for anyone who checks it -- reasoning"],"verdict":"fail"}' : '{"unsupported":[],"verdict":"pass"}' });
  const out = await V.generate({ PERSONAL: wrap(p), AI: mw.AI }, "essay", {});
  if (!out.ok) console.log(JSON.stringify(p.prepare("SELECT status, detail FROM companion_runs").all()).slice(0, 2000));
  ok(out.ok === true && count(p, "companion_pieces") === 1, "a draft whose only FACT error is one sentence is pruned and published", out);
  const row = p.prepare("SELECT lede, body_md FROM companion_pieces").get();
  ok(row && !/iron tools/.test(row.lede + row.body_md), "the published piece no longer carries the invented claim");
  ok(mw.log.writer === 1 && mw.log.review >= 4, "no model revision was needed; the pruned draft was reviewed again in full", mw.log);
  const st = p.prepare("SELECT detail FROM companion_runs WHERE detail LIKE 'fact prune trail:%'").get();
  ok(st && /-> pass/.test(st.detail), "the prune trail is logged", st);
}
{
  // an invented claim the prune cannot locate still stops publication (no revision can remove it either)
  const p = world();
  const mw = modelWorld({ draft: essayBody(E_LEDE), review: () => '{"unsupported":["FACT: an elephant crossed the river at dawn -- not in source"],"verdict":"fail"}' });
  const out = await V.generate({ PERSONAL: wrap(p), AI: mw.AI }, "essay", {});
  ok(out.ok === false && count(p, "companion_pieces") === 0, "a FACT error that cannot be deleted still fails the piece (fail closed)", out);
  ok(p.prepare("SELECT COUNT(*) n FROM companion_runs WHERE detail LIKE 'fact prune trail: r1 located nothing%'").get().n >= 1, "the trail says the prune located nothing");
}
{
  // INFERENCE items alone do not fail a piece
  const p = world();
  const mw = modelWorld({ draft: essayBody(E_LEDE), review: () => '{"unsupported":["INFERENCE: the record keeps that pattern in view -- reasoning from the source"],"verdict":"fail"}' });
  const out = await V.generate({ PERSONAL: wrap(p), AI: mw.AI }, "essay", {});
  ok(out.ok === true && mw.log.review === 2, "reasoning flagged as INFERENCE passes after one review", { out, log: mw.log });
}
{
  // a lede that does not name the subject is rejected with a lede problem, and the feedback asks for it
  const p = world();
  const mw = modelWorld({ draft: (n) => essayBody(n === 1 ? "Few things are as quiet as a ledger of readings." : E_LEDE), review: () => '{"unsupported":[],"verdict":"pass"}' });
  const out = await V.generate({ PERSONAL: wrap(p), AI: mw.AI }, "essay", {});
  const rj = p.prepare("SELECT detail FROM companion_runs WHERE status = 'rejected' ORDER BY id LIMIT 1").get();
  ok(rj && /lede does not name the subject|lede opens on abstract/.test(rj.detail), "the first draft is rejected for its lede", rj);
  ok(out.ok === true && mw.log.writer === 2, "the second draft with a proper lede publishes", { out, log: mw.log });
}

// ---- FACT-WORDING-1 (1.19.4) ---------------------------------------------------------------------------------------------------------
{
  const s = V.splitFactItems([
    "FACT: The object that forwards the call is commonly called a wrapper -- The source says 'frequently called', not 'commonly called'",
    "FACT: allowing a class to expose some behavior while delegating the rest -- 'delegating' misstates source, which says forwarding",
    "FACT: the source says 'twice a year', not 'three times a year' -- The source says 'twice a year', not 'three times a year'",
    "FACT: the bridge is called the old crossing -- The source says 'new crossing', not 'old crossing'"
  ]);
  ok(s.inferences.some((f) => /commonly called a wrapper/.test(f)), "a one-word synonym swap the reviewer reports as source says 'A', not 'B' is wording, not a fact", s);
  ok(s.facts.some((f) => /delegating the rest/.test(f)), "a different concept (delegating for forwarding) stays a fact", s);
  ok(s.facts.some((f) => /twice a year/.test(f)), "a changed frequency phrase of more than one word stays a fact", s);
  ok(s.facts.some((f) => /old crossing/.test(f)), "an antonym swap (new for old) stays a fact: only swaps inside a synonym group are wording", s);
  ok(s.facts.length + s.inferences.length === 4, "the swap rule never drops an item", s);
}
// ---- PRUNE-THEN-EXTEND-1 (1.19.4): a cleaned draft that is only too short is extended, not revised from the original ----------------
{
  const p = world();
  const BAD = Array.from({ length: 10 }, (_, i) => "Yet the surveyors in group " + "abcdefghij"[i] + " worked without the benefit of iron tools, carrying the planks across soft ground by hand for long seasons while the record keepers looked on and wrote nothing of it down at all.");
  const shortBody = "# Drift in the readings\n\n" + E_LEDE + "\n\n" + paras(1) + " " + BAD.join(" ") + "\n\n## What would falsify this\n\nIf the record of 14 measurements in 1987 were re-run and the drift vanished, the claim would fail.\n\n## The objection\n\nThe strongest objection is that fourteen readings are too few to separate drift from noise, and the record cannot settle that.\n\n" + paras(1);
  const longBody = essayBody(E_LEDE);
  let secondPrompt = "";
  const mw = modelWorld({
    draft: (n) => n === 1 ? shortBody : longBody,
    review: (m, sys) => {
      const d = sys.indexOf("--- DRAFT ---") >= 0 ? sys.slice(sys.indexOf("--- DRAFT ---")) : sys;
      const hits = BAD.filter((b) => d.indexOf(b.slice(0, 60)) !== -1);
      return hits.length ? JSON.stringify({ unsupported: hits.map((b) => "FACT: " + b + " -- source does not mention iron tools"), verdict: "fail" }) : '{"unsupported":[],"verdict":"pass"}';
    }
  });
  const AI0 = mw.AI.run;
  let writes = 0;
  mw.AI.run = async (model, input) => { const sys = (input.messages && input.messages[0] && input.messages[0].content) || ""; if (!/strict fact-checker|adversarial reader/.test(sys) && !input.text) { writes++; if (writes === 2) secondPrompt = JSON.stringify(input.messages); } return AI0(model, input); };
  const out = await V.generate({ PERSONAL: wrap(p), AI: mw.AI }, "essay", {});
  if (!out.ok) console.log(JSON.stringify(p.prepare("SELECT status, substr(detail,1,160) d FROM companion_runs").all()).slice(0, 4000));
  ok(out.ok === true && count(p, "companion_pieces") === 1, "the pruned, too-short draft is extended and published", out);
  const flagged = "abcdefgh".split("").map((g) => "group " + g + " worked");
  ok(/too short/.test(secondPrompt) && flagged.every((f) => secondPrompt.indexOf(f) === -1) && secondPrompt.indexOf("group i worked") !== -1, "the extension starts from the cleaned draft: the 8 flagged sentences are gone, the 2 the reviewers did not list remain", secondPrompt.length);
  ok(p.prepare("SELECT COUNT(*) n FROM companion_runs WHERE detail LIKE '%extending the pruned draft%'").get().n === 1, "the run log says the pruned draft was extended");
  const row = p.prepare("SELECT lede, body_md FROM companion_pieces").get();
  ok(row && !/iron tools/.test(row.lede + row.body_md), "the published piece carries none of the flagged sentences");
}
// ---- STARVED-RETRY-BOUNDARY-1 (1.19.5): a failed run that ended 45 minutes before the tick is retried --------------------------------
{
  const p = world();
  p.exec("CREATE TABLE IF NOT EXISTS companion_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, run_at TEXT, form TEXT, model TEXT, topic TEXT, status TEXT, detail TEXT, ms INTEGER)");
  const at = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString();
  p.prepare("INSERT INTO companion_runs (run_at, form, model, topic, status, detail, ms) VALUES (?, 'notes', 'm', 't', 'failed', 'no piece survived the gate', 1)").run(at(49.8));
  ok(await V.starvedRetryDue({ PERSONAL: wrap(p) }) === true, "a failed run 49.8 minutes old (the 2026-10-13 10:01 tick) is retried");
  p.prepare("INSERT INTO companion_runs (run_at, form, model, topic, status, detail, ms) VALUES (?, 'notes', 'm', 't', 'failed', 'no piece survived the gate', 1)").run(at(35));
  ok(await V.starvedRetryDue({ PERSONAL: wrap(p) }) === true, "STARVED-RETRY-SLA-1 (1.26.3): a failed run 35 minutes old is retried (no 40-minute bar; the 08:34 run of 2026-10-14 skipped the 09:00 tick)");
  for (let i = 0; i < 26; i++) p.prepare("INSERT INTO companion_runs (run_at, form, model, topic, status, detail, ms) VALUES (?, 'essay', 'm', 't', 'failed', 'no piece survived the gate', 1)").run(at(60 * 23 - i * 50));
  ok(await V.starvedRetryDue({ PERSONAL: wrap(p) }) === true, "26 failed runs in 24 h still retry at the next hourly tick (the 24-failure cap skipped 10:00 UTC on 2026-10-14)");
  p.prepare("INSERT INTO companion_runs (run_at, form, model, topic, status, detail, ms) VALUES (?, 'essay', 'm', 't', 'stage', 'critic prune r1', 1)").run(at(3));
  ok(await V.starvedRetryDue({ PERSONAL: wrap(p) }) === false, "a run in progress (a stage row 3 minutes ago) holds the retry back");
  p.prepare("INSERT INTO companion_runs (run_at, form, model, topic, status, detail, ms) VALUES (?, 'essay', 'm', 't', 'ok', 'published', 1)").run(at(120));
  p.prepare("DELETE FROM companion_runs WHERE status = 'stage'").run();
  ok(await V.starvedRetryDue({ PERSONAL: wrap(p) }) === false, "a published piece (the newest run is ok) ends the starved retry");
}
console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
