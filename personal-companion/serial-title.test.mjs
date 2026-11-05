// COMPANION-SERIAL-TITLE-1 offline suite (personal-companion 1.43.2, charter pillar: personal; agent_issues 1000299).
// Failure mode proven: for the serial form the prompt tells the writer to keep the running work's title, and the duplicate-title check then
// rejected the finished draft (after a full 1,800 to 2,400 word compose) for having that title, and told the writer to choose a completely
// different one: the same input retried against a check it cannot pass. A serial installment now takes the running title with its number
// ("<running title>, part N", N = companion_series.chapters + 1) before the check; the check itself is unchanged for every other form.
// Proves: (1) a serial piece titled with the running title is accepted with its installment suffix, (2) the number follows the chapters
// count, including 0, empty, malformed and a count that fell behind the published pieces, (3) the duplicate-title check still rejects a
// repeated title for an essay and for a first installment, and for a serial title that is not the running one, (4) a serial piece whose
// writer chose another, unused title is not mangled (the code path does not require it: only the running title collides with itself).
// No production data is read: the fixtures are an in-memory sqlite and invented sentences. Run: node personal-companion/serial-title.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { importWorker } from "./_harness-import-worker.mjs";
const IMPORT = 'import { WorkflowEntrypoint } from "cloudflare:workers";';
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const mod = await importWorker(() => (src.replace(IMPORT, "var WorkflowEntrypoint = class {};") + "\n//" + Math.random()), new URL("./", import.meta.url));
const V = mod.__verify;
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " -- " + JSON.stringify(x).slice(0, 400) : "")); } };

// ---- the pure helpers ------------------------------------------------------------------------------------------------------------
const T = V.serialInstallmentTitle;
ok(typeof T === "function" && typeof V.withInstallmentTitle === "function" && typeof V.freeInstallmentPiece === "function", "the helpers are exported");
ok(T("The Long Quiet", 1) === "The Long Quiet, part 2", "one chapter published: part 2", T("The Long Quiet", 1));
ok(T("The Long Quiet", 7) === "The Long Quiet, part 8", "seven chapters published: part 8");
ok(T("The Long Quiet", "3") === "The Long Quiet, part 4", "a count that arrives as text is read as a number");
ok(T("The Long Quiet", 2.9) === "The Long Quiet, part 3", "a fractional count rounds down, never up");
for (const [label, c] of [["0", 0], ["null", null], ["undefined", undefined], ["empty string", ""], ["text", "many"], ["NaN", NaN], ["negative", -4], ["Infinity", Infinity], ["an object", {}], ["an absurd count", 1e12]]) {
  const t = T("The Long Quiet", c);
  ok(t === "The Long Quiet, part 1" && !/NaN|undefined|null|Infinity/.test(t), "a chapters count of " + label + " falls back to part 1, never NaN", t);
}
ok(T("", 3) === "" && T(null, 3) === "" && T(undefined, 3) === "", "no running title gives no installment title");
ok(T("The Long Quiet, part 4", 4) === "The Long Quiet, part 5", "a running title that already carries a suffix is not suffixed twice");
ok(T("The Long Quiet (Part II)", 1) === "The Long Quiet, part 2" && T("The Long Quiet: installment 9", 9) === "The Long Quiet, part 10", "other part spellings are replaced, not stacked");
ok(T("Part 2", 1) === "Part 2, part 2", "a title that is only a part label keeps its words");
ok(T("  The   Long\n Quiet  ", 0) === "The Long Quiet, part 1", "whitespace in the running title is squeezed");
ok(T("x".repeat(500), 12).endsWith(", part 13") && T("x".repeat(500), 12).length <= 300, "a long running title is cut so the number survives and the title fits the 300-character column");

const piece = (title) => ({ title, subtitle: "", lede: "A lede.", body_md: "A body.", objection: "" });
const run = { title: "The Long Quiet", chapters: 3 };
ok(V.serialTitleMatches("the long quiet", "The Long Quiet") && V.serialTitleMatches("The Long Quiet.", "The Long Quiet") && V.serialTitleMatches("The Long Quiet, Part 9", "The Long Quiet"), "the running title is recognised in any case, with punctuation, or with a suffix");
ok(!V.serialTitleMatches("The Long Quiet and the Short Noise", "The Long Quiet") && !V.serialTitleMatches("", "") && !V.serialTitleMatches("The Long Quiet", ""), "a different title, or no title at all, is not the running title");
const p1 = piece("The Long Quiet");
const w1 = V.withInstallmentTitle(p1, "serial", run);
ok(w1.title === "The Long Quiet, part 4" && w1.body_md === "A body." && p1.title === "The Long Quiet", "(1) a serial piece titled with the running title gets its installment title; the input piece is not mutated", w1);
ok(V.withInstallmentTitle(piece("The long quiet"), "serial", run).title === "The Long Quiet, part 4", "(1) a case difference in the writer's title still takes the running title's spelling");
ok(V.withInstallmentTitle(piece("The Long Quiet, part 2"), "serial", run).title === "The Long Quiet, part 4", "(1) a number the writer guessed is replaced by the one the chapters count gives");
const w2 = V.withInstallmentTitle(piece("The Long Quiet, part 4"), "serial", run);
ok(w2.title === "The Long Quiet, part 4", "the title is already right: nothing changes (idempotent)");
const other = piece("What the quiet was for");
ok(V.withInstallmentTitle(other, "serial", run) === other, "(4) a title the writer chose that is not the running title is left alone (same object)");
ok(V.withInstallmentTitle(p1, "essay", run) === p1 && V.withInstallmentTitle(p1, "notes", run) === p1, "(3) an essay or notes piece is never retitled, even with the running title");
ok(V.withInstallmentTitle(p1, "serial", null) === p1 && V.withInstallmentTitle(p1, "serial", { title: "", chapters: 2 }) === p1, "a first installment (no running work) keeps the writer's title");
ok(V.withInstallmentTitle(p1, "serial", { title: "The Long Quiet", chapters: null }).title === "The Long Quiet, part 1", "(2) a running work whose chapters is missing becomes part 1");

// the bump: a count that fell behind the published pieces steps past the numbers already taken
const taken = (set) => async (low) => set.has(low);
const f1 = await V.freeInstallmentPiece(p1, "serial", run, taken(new Set()));
ok(f1.title === "The Long Quiet, part 4", "(2) nothing taken: the number follows the chapters count", f1.title);
const f2 = await V.freeInstallmentPiece(p1, "serial", run, taken(new Set(["the long quiet, part 4", "the long quiet, part 5"])));
ok(f2.title === "The Long Quiet, part 6", "(2) a count that fell behind the pieces steps to the first free number", f2.title);
const f3 = await V.freeInstallmentPiece(p1, "serial", run, taken({ has: () => true }));
ok(f3.title === "The Long Quiet, part 4", "every number taken: the first title is kept, so the duplicate-title check still has the last word", f3.title);
const f4 = await V.freeInstallmentPiece(p1, "serial", run, async () => { throw new Error("db down"); });
ok(f4.title === "The Long Quiet, part 4", "a failed lookup keeps the deterministic title (the check below skips on an error too)", f4.title);
ok(await V.freeInstallmentPiece(other, "serial", run, taken(new Set(["x"]))) === other && await V.freeInstallmentPiece(p1, "essay", run, taken(new Set())) === p1, "another title and another form pass through untouched");

// ---- the code: the marker, the call sites, the check that stays --------------------------------------------------------------------
const gen = src.slice(src.indexOf("async function generate("), src.indexOf("var CRON_TABLE"));
ok(/COMPANION-SERIAL-TITLE-1/.test(src) && /COMPANION-SERIAL-TITLE-1/.test(gen), "the source and generate() name the change (COMPANION-SERIAL-TITLE-1)");
const iTitle = gen.indexOf("freeInstallmentPiece(piece, form, serialRun"), iDup = gen.indexOf("SELECT slug FROM companion_pieces WHERE lower(title) = ? LIMIT 1\"\n          ).bind(titleLow)");
ok(iTitle > 0 && iDup > iTitle, "the installment title is set before the duplicate-title check");
ok(/await logRun\(env, form, model, topic\.id, "rejected", "duplicate title: " \+ piece\.title, Date\.now\(\) - t0\);/.test(gen) && /if \(titleLow\.length > 4\) \{/.test(gen), "the duplicate-title rejection and its log line are unchanged");
ok(!/form (?:===|!==) "serial"[^\n]*dtCheck|dtCheck[^\n]*form (?:===|!==) "serial"/.test(gen), "the duplicate-title check is not switched off for the serial form");
ok(/The previous draft had a title that already exists\. Choose a completely different angle and title\./.test(gen), "the feedback for a repeated title is unchanged");
ok(/Keep the running work's title\. Put the installment number in the subtitle\./.test(V.prompts.P_SERIAL), "the serial prompt is unchanged: the writer still keeps the running title");
ok(/SELECT title, thesis, last_lines, chapters FROM companion_series ORDER BY id DESC LIMIT 1/.test(gen), "the running work's chapters count is read with its title");
ok((src.split("\n").find((l) => l.startsWith("var VERSION")) || "").length < 200, "the VERSION line stays short (VERSION-LINE-NOTES-COMPANION-1)");
const ver = (src.match(/var VERSION = "(\d+)\.(\d+)\.(\d+)/) || []).slice(1).map(Number);
ok(ver.length === 3 && (ver[0] > 1 || (ver[0] === 1 && (ver[1] > 43 || (ver[1] === 43 && ver[2] >= 2)))), "VERSION is at least 1.43.2", ver);

// ---- end to end: generate() with an in-memory D1 and a scripted model world ---------------------------------------------------------
const wrap = (db) => ({ prepare(sql) { const mk = (args) => ({ bind: (...a) => mk(a),
  run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
  first: async () => db.prepare(sql).get(...args) || null, all: async () => ({ results: db.prepare(sql).all(...args) }) }); return mk([]); } });
const sentence = "The reading at the Beta Station shows the Alpha Subject drifting, and the record of 14 measurements in 1987 keeps that pattern in view for anyone who checks it. ";
const art = (name) => ("The " + name + " is the subject of this article. " + sentence.repeat(22)).slice(0, 4200);
const SRC = { "Alpha Subject": art("Alpha Subject"), "Beta Station": art("Beta Station"), "Gamma Committee": art("Gamma Committee") };
function installFetch() {
  globalThis.fetch = async (url) => {
    const u = String(url);
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
const paras = (n) => Array.from({ length: n }, () => sentence.repeat(10).trim()).join("\n\n");
const draft = (title, lede) => "# " + title + "\n\n" + lede + "\n\n" + paras(4) + "\n\n## What would falsify this\n\nIf the record of 14 measurements in 1987 were re-run and the drift vanished, the claim would fail.\n\n## The objection\n\nThe strongest objection is that fourteen readings are too few to separate drift from noise, and the record cannot settle that.\n\n" + paras(4);
function modelWorld(titleOf, lede) {
  const log = { writer: 0 };
  const AI = { run: async (model, input) => {
    const sys = (input.messages && input.messages[0] && input.messages[0].content) || "";
    if (input.text) return { data: [] };
    if (/strict fact-checker/.test(sys)) return { response: '{"unsupported":[],"verdict":"pass"}' };
    if (/even-keel reviewer/.test(sys)) return { response: '{"opposing":9,"wording":9,"attribution":9,"reason":"ok"}' };
    if (/adversarial reader/.test(sys)) return { response: '{"specificity":8,"argument":8,"objection":8,"voice":8,"grounding":9,"systems":8,"verdict":"accept","why":"ok"}' };
    log.writer++; return { response: draft(titleOf, lede || "The Alpha Subject drifts when it is read at the Beta Station.") };
  } };
  return { AI, log };
}
const RUNNING = "The Long Quiet";
function world(opts) {
  opts = opts || {};
  const p = new DatabaseSync(":memory:");
  p.exec("CREATE TABLE profile (facet TEXT, label TEXT, statement TEXT, confidence REAL); CREATE TABLE activity (date TEXT, title TEXT, category TEXT, venue TEXT, city TEXT, notes TEXT, energy_label TEXT); CREATE TABLE events (start_date TEXT, title TEXT, venue TEXT, city TEXT, category TEXT); CREATE TABLE notes (ts TEXT, kind TEXT, content TEXT); CREATE TABLE companion_pieces (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE NOT NULL, form TEXT NOT NULL, title TEXT NOT NULL, subtitle TEXT, lede TEXT, body_md TEXT NOT NULL, anchor_json TEXT, quality_json TEXT, word_count INTEGER, day TEXT, created_at TEXT NOT NULL);");
  p.exec("CREATE TABLE companion_series (id INTEGER PRIMARY KEY AUTOINCREMENT, series TEXT UNIQUE NOT NULL, title TEXT, thesis TEXT, chapters INTEGER DEFAULT 0, last_lines TEXT, updated_at TEXT)");
  const addPiece = p.prepare("INSERT INTO companion_pieces (slug, form, title, body_md, created_at) VALUES (?, ?, ?, 'an earlier body', '2026-10-01T00:00:00Z')");
  (opts.pieces || []).forEach((x, i) => addPiece.run("seed-" + i, x[0], x[1]));
  if (opts.series) p.prepare("INSERT INTO companion_series (series, title, thesis, chapters, last_lines, updated_at) VALUES ('seed-serial', ?, 'A thesis about drift.', ?, 'The last lines of the last installment.', '2026-10-01T00:00:00Z')").run(RUNNING, opts.series.chapters);
  return p;
}
const runLog = (p, status) => p.prepare("SELECT detail FROM companion_runs WHERE status = ?").all(status).map((r) => r.detail);
const titles = (p) => p.prepare("SELECT title FROM companion_pieces ORDER BY id").all().map((r) => r.title);
const gen1 = async (p, form, mw) => V.generate({ PERSONAL: wrap(p), AI: mw.AI }, form, {});
installFetch();

{ // (1) the running title, one chapter published: part 2, and the chapters count moves on
  const p = world({ pieces: [["serial", RUNNING]], series: { chapters: 1 } }), mw = modelWorld(RUNNING);
  const out = await gen1(p, "serial", mw);
  if (!out.ok) console.log(JSON.stringify(p.prepare("SELECT status, detail FROM companion_runs").all()).slice(0, 1500));
  ok(out.ok === true && out.title === RUNNING + ", part 2", "(1) a serial draft titled with the running title is published as part 2", out.title);
  ok(titles(p).join("|") === RUNNING + "|" + RUNNING + ", part 2", "(1) both installments are stored, the new one with its suffix", titles(p));
  ok(runLog(p, "rejected").every((d) => !/duplicate title/.test(d)) && mw.log.writer === 1, "(1) no duplicate-title rejection and a single compose", { rej: runLog(p, "rejected"), writer: mw.log.writer });
  ok(runLog(p, "stage").some((d) => /COMPANION-SERIAL-TITLE-1/.test(d)), "the run log carries a stage row for the title");
  ok(p.prepare("SELECT chapters, title FROM companion_series").get().chapters === 2 && p.prepare("SELECT title FROM companion_series").get().title === RUNNING, "(2) persistPiece moves chapters to 2 and the running title stays the bare title");
  // the next installment, from the stored state: part 3
  const mw2 = modelWorld(RUNNING, "At the Beta Station the Alpha Subject drifts whenever its readings are repeated.");
  const out2 = await gen1(p, "serial", mw2);
  ok(out2.ok === true && out2.title === RUNNING + ", part 3", "(2) the next installment, read from the stored count, is part 3", out2.title || runLog(p, "rejected"));
}
{ // (2) chapters NULL, text or 0 on an existing series row: part 1, never NaN
  for (const [label, c] of [["NULL", null], ["text", "n/a"], ["0", 0]]) {
    const p = world({ series: { chapters: c } }), mw = modelWorld(RUNNING);
    const out = await gen1(p, "serial", mw);
    ok(out.ok === true && out.title === RUNNING + ", part 1" && !/NaN/.test(titles(p).join()), "(2) a series row with chapters " + label + " publishes as part 1", out.title || runLog(p, "rejected"));
  }
}
{ // (2) the count fell behind the pieces: "part 2" exists, chapters says 1 -> part 3, not a rejection loop
  const p = world({ pieces: [["serial", RUNNING], ["serial", RUNNING + ", part 2"]], series: { chapters: 1 } }), mw = modelWorld(RUNNING);
  const out = await gen1(p, "serial", mw);
  ok(out.ok === true && out.title === RUNNING + ", part 3" && mw.log.writer === 1, "(2) a chapters count behind the stored pieces steps to the first free number in one compose", { t: out.title, w: mw.log.writer });
}
{ // (4) the writer chose another title that is unused: kept as written
  const p = world({ pieces: [["serial", RUNNING]], series: { chapters: 1 } }), mw = modelWorld("What the quiet was for");
  const out = await gen1(p, "serial", mw);
  ok(out.ok === true && out.title === "What the quiet was for" && titles(p).includes("What the quiet was for"), "(4) a serial piece with its own, unused title is stored as the writer titled it", out.title || runLog(p, "rejected"));
}
{ // (3) a serial piece whose own title repeats an existing piece (not the running title) is still rejected
  const p = world({ pieces: [["serial", RUNNING], ["essay", "What the quiet was for"]], series: { chapters: 1 } }), mw = modelWorld("What the quiet was for");
  const out = await gen1(p, "serial", mw);
  ok(out.ok === false && titles(p).length === 2, "(3) a serial title that repeats another piece is not published", out);
  ok(runLog(p, "rejected").some((d) => /^duplicate title: What the quiet was for$/.test(d)), "(3) and the rejection is the duplicate-title one", runLog(p, "rejected"));
}
{ // (3) a first installment (no series row) whose title repeats an existing piece is rejected
  const p = world({ pieces: [["essay", RUNNING]] }), mw = modelWorld(RUNNING);
  const out = await gen1(p, "serial", mw);
  ok(out.ok === false && titles(p).length === 1 && runLog(p, "rejected").some((d) => /^duplicate title: /.test(d)), "(3) a first installment with a repeated title is still rejected", { out, rej: runLog(p, "rejected") });
}
{ // a first installment with a fresh title is published as the writer titled it and starts the series
  const p = world(), mw = modelWorld(RUNNING);
  const out = await gen1(p, "serial", mw);
  ok(out.ok === true && out.title === RUNNING && p.prepare("SELECT title, chapters FROM companion_series").get().chapters === 1, "a first installment keeps the writer's title and starts the series at chapters 1", out.title || runLog(p, "rejected"));
}
{ // (3) an essay with the title of an existing piece is rejected, however often the writer repeats it
  const p = world({ pieces: [["essay", RUNNING]], series: { chapters: 1 } }), mw = modelWorld(RUNNING);
  const out = await gen1(p, "essay", mw);
  ok(out.ok === false && titles(p).length === 1, "(3) an essay that repeats a stored title is not published", out);
  ok(runLog(p, "rejected").filter((d) => /^duplicate title: /.test(d)).length >= 1 && !runLog(p, "stage").some((d) => /COMPANION-SERIAL-TITLE-1/.test(d)), "(3) it is rejected as a duplicate title and no installment title was set", runLog(p, "rejected"));
}
console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
