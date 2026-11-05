// Q08-GROUND-BAR-1 offline suite (q08-signal-engine 0.46.0, pillar research, cost second; metrics q08_gate_pass_rate_7d and q08_neurons_per_published_piece_7d).
// Evidence behind the change (engine_runs, 30 days to 2026-11-05, essays and papers with a logged source size): 162 attempts below 10,000 characters of source material, none published; 281 at
// 10,000 or more, 10 published; the thinnest source that has published holds 10,265. The learned floor could never exceed MIN_GROUND_CHARS (2200), so those attempts were composed.
// Proves: (1) the bar is the thinnest source that has published, never below MIN_GROUND_CHARS, never above GROUND_BAR_CAP, and MIN_GROUND_CHARS before five ok runs are logged;
// (2) generate() ends a run whose best candidate is under the bar as skipped before any model call, marks the candidates for the 24-hour retry and moves on to a richer one next tick;
// (3) one attempt in GROUND_EXPLORE_EVERY keeps the old bar; (4) thinPassedOver marks candidates under the bar; (5) nothing else changes (PUBLISH_MIN_CHARS, MIN_GROUND_CHARS).
// Run: node q08-signal-engine/ground-bar.test.mjs   -> prints "N passed, 0 failed"
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
const here = dirname(fileURLToPath(import.meta.url));
const mod = await import(pathToFileURL(join(here, "worker.js")).href);
const G = mod.__gen;
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " -- " + JSON.stringify(x).slice(0, 500) : "")); } };

// ---- 1. the bar
ok(mod.__analysis.PUBLISH_MIN_CHARS === 2800 && G.MIN_GROUND_CHARS === 2200 && G.THIN_MIN_ARTICLE === 600, "the publish floor, the rich-source minimum and the article minimum are unchanged");
ok(G.groundBarFrom([]) === 2200 && G.groundBarFrom([10300, 11000, 12000, 15000]) === 2200, "fewer than five logged ok runs: the old bar", G.groundBarFrom([10300, 11000, 12000, 15000]));
const live = [16543, 11947, 10265, 15721, 15765, 15918, 15215];
ok(G.groundBarFrom(live) === 10265, "five or more: the thinnest source that has published", G.groundBarFrom(live));
ok(G.groundBarFrom([null, 0, "x", 10265, 11000, 12000, 13000, 14000]) === 10265 && G.groundBarFrom([null, 0, "x", 10265, 11000, 12000, 13000]) === 2200, "unlogged and non-numeric sizes are ignored and not counted");
ok(G.groundBarFrom([14000, 15000, 16000, 17000, 18000]) === G.GROUND_BAR_CAP && G.GROUND_BAR_CAP === 12000, "the bar never exceeds the cap (the article is cut at 14000 before the writer sees it)", G.groundBarFrom([14000, 15000, 16000, 17000, 18000]));
ok(G.groundBarFrom([900, 1500, 2100, 1800, 2000]) === 2200, "the bar never falls under the rich-source minimum", G.groundBarFrom([900, 1500, 2100, 1800, 2000]));
ok(G.groundBarFrom([2400, 3100, 2900, 5200, 4100]) === 2400, "a log of small sources gives a small bar: the bar follows what published", G.groundBarFrom([2400, 3100, 2900, 5200, 4100]));
ok(G.GROUND_EXPLORE_EVERY === 10, "one attempt in ten explores");

// ---- 2. the learned bar reads the log, forecasts excluded
function makeDb() {
  G.resetRunColumns();
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE engine_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, ran_at TEXT DEFAULT (datetime('now')), signals_scraped INTEGER DEFAULT 0, signals_scored INTEGER DEFAULT 0, piece_published INTEGER DEFAULT 0, top_signal TEXT, model TEXT, ms INTEGER DEFAULT 0, status TEXT, error TEXT)");
  db.exec("CREATE TABLE published_pieces (id TEXT PRIMARY KEY, signal_id TEXT, slug TEXT UNIQUE, title TEXT, body_md TEXT, body_html TEXT, core_concept TEXT, signal_source TEXT, published_at TEXT, reads INTEGER DEFAULT 0, feedback_score REAL DEFAULT 0, promoted INTEGER DEFAULT 0, sources_json TEXT, kind TEXT DEFAULT 'analysis', property TEXT)");
  db.exec("CREATE TABLE signal_log (id TEXT PRIMARY KEY, source TEXT NOT NULL, source_id TEXT, title TEXT, url TEXT, points INTEGER DEFAULT 0, num_comments INTEGER DEFAULT 0, ratio REAL DEFAULT 0, volatility_score REAL DEFAULT 0, friction_point TEXT, signal_strength TEXT, status TEXT DEFAULT 'pending', created_at TEXT DEFAULT (datetime('now')), processed_at TEXT)");
  db.exec("CREATE TABLE q08_retractions (slug TEXT PRIMARY KEY, reason TEXT, claims_json TEXT, retracted_at TEXT)");
  db.exec("CREATE TABLE prompt_pool (id TEXT PRIMARY KEY, piece_id TEXT, structure_md TEXT NOT NULL, performance_score REAL DEFAULT 0, reads INTEGER DEFAULT 0, active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')))");
  const shim = { prepare: (sql) => { let a = []; const st = { bind: (...x) => { a = x; return st; }, run: async () => { db.prepare(sql).run(...a); return { meta: {} }; }, first: async () => db.prepare(sql).get(...a) || null, all: async () => ({ results: db.prepare(sql).all(...a) }) }; return st; } };
  return { db, shim };
}
{
  const { db, shim } = makeDb();
  db.exec("ALTER TABLE engine_runs ADD COLUMN source_chars INTEGER; ALTER TABLE engine_runs ADD COLUMN source_kind TEXT");
  const ins = db.prepare("INSERT INTO engine_runs (piece_published, status, source_chars, source_kind, ran_at) VALUES (1, 'ok', ?, ?, datetime('now', ?))");
  for (const n of [16543, 11947, 10265, 15721, 15765]) ins.run(n, "hn+fulltext", "-1 day");
  ins.run(3100, "forecast", "-1 day");           // a forecast's source size is not an essay's
  ins.run(2500, "hn+fulltext", "-40 days");      // outside the 30-day window
  const env = { DB: shim };
  ok(await G.learnedGroundBar(env) === 10265, "learnedGroundBar: the thinnest essay source of the last 30 days, forecasts and old runs excluded", await G.learnedGroundBar(env));
  const empty = makeDb();
  ok(await G.learnedGroundBar({ DB: empty.shim }) === 2200, "no log: the old bar");
  ok(await G.learnedGroundBar({ DB: { prepare: () => { throw new Error("D1 down"); } } }) === 2200, "an unreadable log: the old bar, never an error");
}

// ---- 3. generate(): the bar in the run
const realFetch = globalThis.fetch;
function stubFetch(stories, articleChars) {
  globalThis.fetch = async (url) => {
    const u = String(url), res = (body, type) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200, headers: { "content-type": type || "application/json" } });
    if (u.includes("hn.algolia.com/api/v1/search")) return res({ hits: stories.map((s) => ({ _tags: ["story"], title: s.title, objectID: s.id, story_id: s.id, url: "https://example.org/" + s.id, points: 300, num_comments: 120, created_at: new Date().toISOString() })) });
    if (u.includes("hn.algolia.com/api/v1/items/")) {
      const id = u.split("/").pop(), s = stories.find((x) => String(x.id) === id);
      return res({ title: s ? s.title : "", children: [1, 2, 3].map((k) => ({ text: "<p>" + ("Comment " + k + " about how the system behaved under load. ").repeat(8) + "</p>", children: [] })) });
    }
    if (u.startsWith("https://example.org/")) { const id = u.split("/").pop(), s = stories.find((x) => String(x.id) === id); const n = s && s.art != null ? s.art : articleChars; return res("<html><body><p>" + "The service reported a fault and the operators described it in detail. ".repeat(Math.ceil(n / 70)).slice(0, n) + "</p></body></html>", "text/html"); }
    return new Response("nope", { status: 500 });
  };
}
async function runGenerate(stories, artChars, okSizes, extraRunsToday) {
  const { db, shim } = makeDb();
  db.exec("ALTER TABLE engine_runs ADD COLUMN source_chars INTEGER; ALTER TABLE engine_runs ADD COLUMN source_kind TEXT");
  (okSizes || []).forEach((n) => db.prepare("INSERT INTO engine_runs (piece_published, status, source_chars, source_kind, ran_at) VALUES (1, 'ok', ?, 'hn+fulltext', datetime('now', '-2 days'))").run(n));
  for (let i = 0; i < (extraRunsToday || 0); i++) db.prepare("INSERT INTO engine_runs (piece_published, status, ran_at) VALUES (0, 'gate_failed', datetime('now'))").run();
  let aiCalls = 0;
  const env = { DB: shim, AI: { run: async () => { aiCalls++; throw new Error("model offline (test)"); } } };
  stubFetch(stories, artChars);
  const quiet = console.error; console.error = () => {};
  let out = null, thrown = null;
  try { out = await G.generate(env); } catch (e) { thrown = String(e && e.message || e); }
  console.error = quiet;
  return { db, env, out, thrown, get aiCalls() { return aiCalls; }, row: db.prepare("SELECT * FROM engine_runs WHERE status = 'skipped' ORDER BY id DESC LIMIT 1").get() };
}
const THIN_LOG = [16543, 11947, 10265, 15721, 15765];
try {
  // a 6,000-character source, the size band that never published: skipped before any model call, both measured candidates marked for the 24-hour retry
  const six = [{ id: 8001, title: "Operators describe a regional outage" }, { id: 8002, title: "A vendor explains a billing fault" }];
  const r = await runGenerate(six, 5600, THIN_LOG);
  ok(r.row && r.row.status === "skipped" && /source too thin for a 2800-character grounded piece/.test(r.row.error) && /thinnest source that has published holds 10265/.test(r.row.error), "a 6,000-character source ends the run as skipped with the bar named", r.row && r.row.error);
  ok(r.aiCalls === 0 && r.row.compose_calls === 0 && r.row.verify_calls === 0, "no model is called for it", [r.aiCalls, r.row]);
  ok(r.row.source_chars > 5000 && r.row.source_chars < 10265, "the row records the size it measured", r.row.source_chars);
  const marks = r.db.prepare("SELECT source_id FROM signal_log WHERE status = 'thin_skipped'").all();
  ok(marks.length === 2, "both measured candidates are marked for the retry", marks);
  // next tick: a richer story is ahead of them and reaches the writer
  stubFetch([{ id: 8003, title: "A third story with the full report", art: 12500 }].concat(six), 5600);
  const quiet = console.error; console.error = () => {};
  let t2 = null; try { await G.generate(r.env); } catch (e) { t2 = String(e && e.message || e); }
  console.error = quiet;
  ok(r.aiCalls >= 1 && /all compose models failed/.test(String(t2)), "the next tick composes from the 12,500-character story", [r.aiCalls, t2]);

  // a source at the bar reaches the writer at once
  const fit = await runGenerate([{ id: 8101, title: "A long report on a regional outage" }], 11000, THIN_LOG);
  ok(fit.aiCalls >= 1 && /all compose models failed/.test(String(fit.thrown)), "an 11,000-character source clears the bar and reaches the writer", [fit.aiCalls, fit.thrown]);

  // before five ok runs are logged the old bar applies: the 6,000-character source is composed from, as before
  const early = await runGenerate(six, 5600, [12000, 11000]);
  ok(early.aiCalls >= 1 && /all compose models failed/.test(String(early.thrown)), "with fewer than five logged ok runs the 6,000-character source is composed from, as before", [early.aiCalls, early.thrown]);

  // exploration: with nine attempts logged today the tenth keeps the old bar, so a smaller size can still be learned
  const explore = await runGenerate(six, 5600, THIN_LOG, 9);
  ok(explore.aiCalls >= 1 && /all compose models failed/.test(String(explore.thrown)), "the tenth attempt of the day keeps the old bar and composes from the 6,000-character source", [explore.aiCalls, explore.thrown]);
  const notExplore = await runGenerate(six, 5600, THIN_LOG, 8);
  ok(notExplore.aiCalls === 0 && notExplore.row && notExplore.row.status === "skipped", "the ninth does not", notExplore.row && notExplore.row.status);
} finally { globalThis.fetch = realFetch; }

// ---- 4. thinPassedOver marks what is under the bar
const cands = [{ cand: { id: 1 }, glen: 5000 }, { cand: { id: 2 }, glen: 11000 }, { cand: { id: 3 }, glen: 2100 }];
ok(G.thinPassedOver(cands, cands[1].cand).length === 1, "without a bar only the candidate under 2200 is marked (old behaviour)");
ok(G.thinPassedOver(cands, cands[1].cand, 10265).map((x) => x.cand.id).join() === "1,3", "with the bar the 5,000-character candidate is marked too, and the chosen one never");

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
