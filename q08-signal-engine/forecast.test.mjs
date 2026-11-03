// Q08-FORECAST-1 offline suite (q08-signal-engine 0.9.0): the forecast block parser and validator, calibration, the judge
// verdict parser, and the real fetch/scheduled handlers over in-memory SQLite with a scripted Workers AI binding: a due
// forecast is written, gated, persisted with its q08_forecasts record, shown on /forecasts and /p/<slug>, settled yes by
// two agreeing judges with a Brier score, and sent void in public after four undecidable checks. A draft that fails the
// forecast gate never blocks the analysis path. Run: node q08-signal-engine/forecast.test.mjs
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
const mod = await import(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "worker.js")).href);
const w = mod.default, F = mod.__forecast;
let fails = 0, passes = 0;
const check = (l, c, x) => { if (c) passes++; else { fails++; console.log("FAIL " + l + (x !== undefined ? " -- " + JSON.stringify(x).slice(0, 400) : "")); } };

// ---- pure functions -------------------------------------------------------------------------------------------------
const ymd = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
const good = () => ({ claim: "The maintainers will publish a hard fork of the library before the vendor ships its rewrite.", probability: 0.55, horizon: ymd(120), resolution: "Resolves yes if the GitHub release page of a repository named as the successor of the library shows a tagged release dated no later than " + ymd(120) + "; void if the repository is deleted or private.", alternatives: [{ claim: "The vendor ships its rewrite first and the maintainers fold into it.", probability: 0.25 }, { claim: "Neither happens and the library stays as it is.", probability: 0.1 }], indicators: ["Maintainers announce a separate release channel", "The vendor publishes a rewrite roadmap with dates"], watch_query: "library hard fork maintainers", watch_urls: [] });
const text55 = "A paragraph that says the main scenario is judged at 55 percent by the writer.";
check("a well-formed forecast has no problems", F.validateForecast(good(), text55, Date.now()).length === 0, F.validateForecast(good(), text55, Date.now()));
check("missing block is a problem", F.validateForecast(null, text55, Date.now()).length === 1);
{ const f = good(); f.probability = 0.97; check("probability above 0.95 is rejected", F.validateForecast(f, "97 percent", Date.now()).some((p) => /0\.05 to 0\.95/.test(p))); }
{ const f = good(); f.horizon = ymd(3); check("a horizon under 14 days is rejected", F.validateForecast(f, text55, Date.now()).some((p) => /horizon must be/.test(p))); }
{ const f = good(); f.horizon = "next spring"; check("a non-ISO horizon is rejected", F.validateForecast(f, text55, Date.now()).some((p) => /ISO date/.test(p))); }
{ const f = good(); f.alternatives[0].probability = 0.7; check("probabilities summing over 1 are rejected", F.validateForecast(f, text55, Date.now()).some((p) => /more than 100 percent/.test(p))); }
{ const f = good(); f.probability = 0.3; f.alternatives = [{ claim: "A rival scenario that is more likely than the main one.", probability: 0.4 }]; check("a rival more probable than the main scenario is rejected (maximum likelihood)", F.validateForecast(f, "30 percent", Date.now()).some((p) => /at least as probable/.test(p))); }
{ const f = good(); check("the prose must state the main probability", F.validateForecast(f, "A paragraph with no stated probability at all.", Date.now()).some((p) => /state the main probability \(55 percent\)/.test(p))); }
check("55% is accepted as the stated probability", F.validateForecast(good(), "judged at 55% here", Date.now()).length === 0);
check("155 percent does not satisfy 55 percent", F.validateForecast(good(), "judged at 155 percent here", Date.now()).some((p) => /main probability/.test(p)));
{ const f = good(); f.watch_urls = ["http://insecure.example.com/x"]; check("a non-https watch url is rejected", F.validateForecast(f, text55, Date.now()).some((p) => /watch_urls/.test(p))); }
check("publicHttpsUrl refuses private hosts", !F.publicHttpsUrl("https://localhost/x") && !F.publicHttpsUrl("https://10.0.0.1/x") && !F.publicHttpsUrl("https://svc.internal/x") && !!F.publicHttpsUrl("https://example.com/status"));
{
  const raw = "# Title here\n\nProse one.\n\nFORECAST-JSON: " + JSON.stringify(good()) + "\n\nworth your time: yes - it commits to a claim.";
  const r = F.parseForecastBlock(raw);
  check("the FORECAST-JSON line is removed from the text and parsed", r.extra && r.extra.probability === 0.55 && !/FORECAST-JSON/.test(r.text) && /worth your time: yes/.test(r.text) && /Prose one\./.test(r.text), r);
  { const fenced = F.parseForecastBlock("Prose.\n```json\nFORECAST-JSON: " + JSON.stringify(good()) + "\n```\nworth your time: yes - x"); check("a code fence around the line is removed with it", fenced.extra && !/```/.test(fenced.text) && /Prose\./.test(fenced.text), fenced.text); }
  check("invalid JSON yields no extra but is still stripped", F.parseForecastBlock("a\nFORECAST-JSON: {not json}\nb").extra === null);
  check("no block means extra null and the text unchanged", F.parseForecastBlock("plain").extra === null && F.parseForecastBlock("plain").text === "plain");
}
{
  const c = F.calibration([{ probability: 0.9, outcome: 1 }, { probability: 0.9, outcome: 0 }, { probability: 0.2, outcome: 0 }, { probability: 0.6, outcome: 1 }, { probability: 0.5, outcome: null }]);
  check("calibration: n counts only resolved rows and Brier is the mean squared error", c.n === 4 && c.brier === Math.round(((0.01 + 0.81 + 0.04 + 0.16) / 4) * 1000) / 1000 && c.reliable === false, c);
  check("calibration bins carry observed frequency", c.bins.some((b) => b.from === 0.8 && b.n === 2 && b.observed_frequency === 0.5), c.bins);
  check("empty calibration is null, never a number", F.calibration([]).brier === null && F.calibration([]).n === 0);
}
{
  const updates = [
    { probability: 0.6, at: "2026-03-08T12:00:00Z" },
    { probability: 0.8, at: "2026-03-09T12:00:00Z" },
    { probability: 0.1, at: "2026-03-10T00:00:00Z" },
    { probability: 0.99, at: "2026-03-11T00:00:00Z" }
  ];
  const score = F.lastForecastUpdateScore({ status: "resolved", outcome: 1, probability: 0.55, horizon: "2026-03-10" }, updates);
  check("update scoring selects the latest update strictly before the horizon and uses the resolved outcome", score && score.probability === 0.8 && score.at === updates[1].at && score.original_log_score === -0.598 && score.brier === 0.04 && score.log_score === -0.223, score);
  const no = (f) => F.lastForecastUpdateScore(f, updates) === null;
  check("update scoring skips open or void forecasts and invalid horizons", no({ status: "open", outcome: 1, horizon: "2026-03-10" }) && no({ status: "void", outcome: 0, horizon: "2026-03-10" }) && no({ status: "resolved", outcome: 1, horizon: "unknown" }));
}
check("judge verdict parses and normalises", F.parseJudgeVerdict('<think>x</think>{"outcome":"YES","basis":"1: the fork exists"}').outcome === "yes" && F.parseJudgeVerdict("no json") === null && F.parseJudgeVerdict('{"outcome":"maybe"}') === null);
check("two agreeing judges settle; a split or an unclear does not", F.aggregateJudges([{ outcome: "yes", basis: "a" }, { outcome: "yes", basis: "b" }]).outcome === "yes" && F.aggregateJudges([{ outcome: "yes" }, { outcome: "no" }]).outcome === "unclear" && F.aggregateJudges([{ outcome: "unclear" }, { outcome: "unclear" }]).outcome === "unclear" && F.aggregateJudges([{ outcome: "yes" }, null]).outcome === "unclear");
check("forecast cap parses 0..10 and defaults to 3", F.parseForecastCap("0") === 0 && F.parseForecastCap("7") === 7 && F.parseForecastCap("99") === 10 && F.parseForecastCap("x") === 3 && F.parseForecastCap(undefined) === 3);
check("the directive keeps the FACTS rule and forbids invented projections", /FACTS \(hard, non-negotiable, and checked\)/.test(F.FORECAST_DIRECTIVE) && /Never state a projected quantity/.test(F.FORECAST_DIRECTIVE) && /at least as probable as each alternative/.test(F.FORECAST_DIRECTIVE));

// ---- handlers over in-memory SQLite --------------------------------------------------------------------------------
const db = new DatabaseSync(":memory:");
db.exec(`CREATE TABLE published_pieces (id TEXT, signal_id TEXT, slug TEXT UNIQUE, title TEXT, body_md TEXT, core_concept TEXT, signal_source TEXT, published_at TEXT, sources_json TEXT, reads INTEGER DEFAULT 0, feedback_score REAL);
CREATE TABLE engine_runs (id INTEGER PRIMARY KEY, ran_at TEXT DEFAULT (datetime('now')), status TEXT, piece_published INTEGER DEFAULT 0, error TEXT, ms INTEGER, signals_scraped INTEGER, signals_scored INTEGER, top_signal TEXT, model TEXT);
CREATE TABLE signal_log (id TEXT PRIMARY KEY, source TEXT, source_id TEXT, title TEXT, url TEXT, points INTEGER, num_comments INTEGER, ratio REAL, volatility_score REAL, friction_point TEXT, signal_strength TEXT, status TEXT, processed_at TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE prompt_pool (id TEXT PRIMARY KEY, piece_id TEXT, structure_md TEXT, active INTEGER DEFAULT 1, performance_score REAL DEFAULT 0, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE q08_daily_reads (day TEXT PRIMARY KEY, human INTEGER NOT NULL DEFAULT 0, crawler INTEGER NOT NULL DEFAULT 0);
CREATE TABLE q08_feedback (id INTEGER PRIMARY KEY, slug TEXT, signal TEXT, ip_key TEXT, note TEXT, created_at TEXT);
CREATE TABLE subscribers (email TEXT, status TEXT, token TEXT, created_at TEXT, confirmed_at TEXT);`);
const nowIso = new Date().toISOString();
for (let i = 1; i <= 3; i++) db.prepare("INSERT INTO published_pieces (id, signal_id, slug, title, body_md, core_concept, signal_source, published_at, sources_json) VALUES (?,?,?,?,?,?,?,?,?)").run("p" + i, "sig" + i, "essay-" + i, "A clearinghouse that paid itself first " + i, "The maintainers of a widely used library priced their own risk. ".repeat(40), "Self-priced risk", "hn:" + (100 + i), new Date(Date.now() - i * 36e5).toISOString(), "[]");
db.exec("CREATE TABLE IF NOT EXISTS q08_audits (slug TEXT PRIMARY KEY, verdict TEXT, stage TEXT, models TEXT, unsupported_json TEXT, checked_at TEXT)");
for (let i = 1; i <= 3; i++) db.prepare("INSERT INTO q08_audits (slug, verdict, stage, checked_at) VALUES (?, 'pass', 'publish', ?)").run("essay-" + i, nowIso);
db.prepare("INSERT INTO signal_log (id, source, source_id, title, url, friction_point, status, processed_at) VALUES ('sg1','hn','hn:101','t','u','Maintainers argue the vendor will rewrite the library and cut them out of the roadmap.','published',?)").run(nowIso);
const shim = { prepare: (sql) => { let a = []; const st = { bind: (...x) => { a = x; return st; }, run: async () => { const r = db.prepare(sql).run(...a); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; }, first: async () => db.prepare(sql).get(...a) || null, all: async () => ({ results: db.prepare(sql).all(...a) }) }; return st; }, async batch(statements) { db.exec("BEGIN"); try { const out = []; for (const s of statements) out.push(await s.run()); db.exec("COMMIT"); return out; } catch (e) { db.exec("ROLLBACK"); throw e; } } };
const social = [];
const audit = { prepare: (sql) => { let a = []; const st = { bind: (...x) => { a = x; if (/social_threads/.test(sql)) social.push(a); return st; }, first: async () => /key = 'q08_forecast_ledger'/.test(sql) ? { value: "off" } : null, run: async () => ({ meta: { changes: 0 } }), all: async () => ({ results: [] }) }; return st; } };

const para = "The maintainers priced their own risk, the vendor priced the rest, and each side read the other's silence as consent while the shipping date drifted. ";
const mkDraft = (o) => {
  o = o || {};
  const prob = o.prob || 0.55, pct = Math.round(prob * 100);
  const f = good(); f.probability = prob;
  const body = ["# Maintainers will fork the library before the vendor ships its rewrite", "",
    "The maintainers of a widely used library are arguing in public about a vendor rewrite that would cut them out of the roadmap; this forecast says they will fork the library before the rewrite ships.", "",
    para.repeat(5), "",
    "How situations like this ended before is the first anchor: when a steward and a sponsor stopped sharing a roadmap, the steward usually forked within a year. " + para.repeat(5), "",
    "The most likely course runs in order. The sponsor posts a rewrite date, the maintainers ask for a shared governance seat, and the sponsor declines. " + para.repeat(5), "",
    "That path is judged at " + pct + " percent by the writer, with the rival scenarios below it. " + para.repeat(5), "",
    "A rival course has the vendor ship first and fold the maintainers in, at 25 percent, and a third has neither happen, at 10 percent. " + para.repeat(5), "",
    "What to watch is the announcement of a separate release channel and any dated roadmap from the vendor. " + para.repeat(5), "",
    "The fact that would change the number most is whether the vendor accepts a governance seat before its rewrite date passes."].join("\n");
  return body + (o.omitJson ? "" : "\nFORECAST-JSON: " + JSON.stringify(f)) + "\nworth your time: yes - it commits to a claim a reader can check.";
};
let draft = () => mkDraft();
let factAnswer = '{"unsupported":[],"verdict":"pass"}';
let readerQueue = []; let judgeAnswer = '{"outcome":"yes","basis":"1: a successor repository exists"}';
const aiCalls = [];
const AI = { run: async (model, input) => {
  const c = input.messages[0].content; aiCalls.push(c.slice(0, 40));
  if (/You settle forecasts for a publication/.test(c)) return { response: judgeAnswer };
  if (/strict fact-checker/.test(c)) return { response: factAnswer };
  if (/busy, intelligent reader/.test(c)) return { response: readerQueue.length ? readerQueue.shift() : '{"would_read_to_end":true,"score":5,"slop_tells":[],"fix":"none"}' };
  return { response: draft() };
} };
const env = { DB: shim, AUDIT: audit, AI, Q08_SOCIAL_FORECASTS: "1" };
const origFetch = globalThis.fetch;
globalThis.fetch = async (u) => {
  const url = String(u);
  if (/hn\.algolia\.com/.test(url)) return new Response(JSON.stringify({ hits: [{ created_at: nowIso, points: 321, title: "Maintainers publish hard fork of the library", url: "https://example.org/fork" }] }), { status: 200 });
  if (/gdeltproject\.org/.test(url)) return new Response(JSON.stringify({ articles: [{ seendate: "20261001T120000Z", domain: "example.com", title: "Regulator rules on the library fork", url: "https://example.com/n" }] }), { status: 200 });
  if (/wikipedia\.org/.test(url)) return new Response(JSON.stringify({ query: { search: [{ title: "Library fork", timestamp: "2026-10-02T00:00:00Z", snippet: "A <span>fork</span> was announced" }] } }), { status: 200 });
  if (/arxiv\.org/.test(url)) throw new Error("arxiv down");
  return new Response("{}", { status: 200 });
};
const waits = []; const ctx = { waitUntil: (p) => waits.push(p) };
const cron = async () => { await w.scheduled({ cron: "0 */2 * * *" }, env, ctx); await Promise.all(waits.splice(0)); };
const get = async (path) => w.fetch(new Request("https://q08.org" + path, { headers: { "user-agent": "Mozilla/5.0 Safari" } }), env, ctx);

{
  const ev = await F.gatherEvidence({ created_at: "2026-01-01T00:00:00Z", watch_query: "library fork", watch_urls: "[]" });
  check("evidence spans Hacker News, worldwide news and Wikipedia", ev.some(e => /^Hacker News/.test(e)) && ev.some(e => /^News article/.test(e)) && ev.some(e => /^Wikipedia/.test(e)), ev);
  check("one source failing (arXiv) does not lose the others", ev.length === 3 && !ev.some(e => /arXiv/.test(e)), ev.length);
}
await cron();
let fp = db.prepare("SELECT * FROM published_pieces WHERE kind = 'forecast'").all();
check("a due forecast is published after three essays", fp.length === 1, fp.length);
{
  const sp = social.map(a => JSON.parse(a[2])[0]);
  const nF = sp.filter(t => /^Forecast, 55%: /.test(t)).length;
  check("each published forecast is queued once for cross-posting, essays are not", nF === 1 && social.length === 1, sp);
  check("the post is within 280 chars and ends with the permalink and settle date", sp[0] && sp[0].length <= 280 && /Settles by \d{4}-\d{2}-\d{2}, scored in public\. What is your number\? https:\/\/q08\.org\/p\/\S+$/.test(sp[0]), sp[0]);
  {
  const pg = await (await get("/p/" + fp[0].slug)).text();
  check("a piece page offers share links, a citation string and Scholar meta tags", /bsky\.app\/intent\/compose/.test(pg) && /Cite as/.test(pg) && /name="citation_title"/.test(pg) && /"isAccessibleForFree":true/.test(pg) && /Post your own probability/.test(pg));
}
{
  const bib = await get("/p/" + fp[0].slug + ".bib"), ris = await get("/p/" + fp[0].slug + ".ris");
  const bt = await bib.text(), rt = await ris.text();
  check("BibTeX and RIS citation files are served for a piece", bib.status === 200 && /^@online\{q08_/.test(bt) && /url = \{https:\/\/q08\.org\/p\//.test(bt) && ris.status === 200 && /^TY  - ELEC/.test(rt) && /ER  - /.test(rt), bt + rt);
  check("citation files 404 for an unknown slug", (await get("/p/no-such-piece.bib")).status === 404);
  const pg2 = await (await get("/p/" + fp[0].slug)).text();
  check("a forecast page links its citation files and names the Forecast Ledger series", /\.bib">BibTeX/.test(pg2) && /q08 Forecast Ledger/.test(pg2));
}
{
  const pg3 = await (await get("/p/" + fp[0].slug)).text();
  check("a piece funnels to QNFO papers, iPatent and QNFO with per-piece UTM tags, and never to QWAV or the personal site", /papers\.qnfo\.org\/\?utm_source=q08&amp;utm_medium=piece&amp;utm_campaign=/.test(pg3) && /ipatent\.qnfo\.org\/\?utm_source=q08/.test(pg3) && !/qwav|reading\.q08/i.test(pg3.split("<main")[1].split("</main>")[0]));
}
const long = F.forecastPostText({ claim: "word ".repeat(100), probability: 0.6, horizon: "2027-01-01" }, "https://q08.org/p/x");
  check("a long claim is trimmed but the link is never cut", long.length <= 280 && long.endsWith("https://q08.org/p/x"), long.length);
}
let fr = db.prepare("SELECT * FROM q08_forecasts").all();
check("its q08_forecasts record is open with the stated probability and horizon", fr.length === 1 && fr[0].status === "open" && fr[0].probability === 0.55 && fr[0].horizon === ymd(120) && fr[0].source_slug.startsWith("essay-") && fr[0].slug === fp[0].slug, fr[0]);
check("the forecast skeleton stays out of the essay prompt pool", db.prepare("SELECT COUNT(*) n FROM prompt_pool WHERE piece_id = ?").get(fp[0] && fp[0].id).n === 0);
check("the engine run is logged as published", db.prepare("SELECT COUNT(*) n FROM engine_runs WHERE status = 'ok' AND piece_published = 1 AND top_signal LIKE 'q08-forecast:%'").get().n === 1);
check("the stored body carries no FORECAST-JSON line and no verdict line", fp[0] && !/FORECAST-JSON|worth your time/i.test(fp[0].body_md));
check("sources link back to the essay the forecast extends", fp[0] && /q08 essay this forecast extends/.test(fp[0].sources_json));

let page = await (await get("/forecasts")).text();
check("/forecasts lists the open forecast with its probability", /<h1>Forecasts<\/h1>/.test(page) && /55%/.test(page) && /settled by/.test(page) && /hard fork of the library/.test(page));
let piecePage = await (await get("/p/" + fp[0].slug)).text();
check("the piece page shows the forecast record", /Forecast record/.test(piecePage) && /Most likely scenario \(55%\)/.test(piecePage) && /Resolves true if/.test(piecePage) && /status: open/.test(piecePage));
let api = await (await get("/api/forecasts")).json();
check("/api/forecasts serves stats and rows", api.ok && api.stats.open === 1 && api.forecasts.length === 1 && api.forecasts[0].claim.length > 20, api.stats);
let idx = await (await get("/")).text();
check("the index badges the forecast", /<span class="q-badge">Forecast<\/span>/.test(idx) && /Forecasts<\/a>/.test(idx));
check("/health lists the forecast capabilities", (await (await get("/health")).json()).capabilities.includes("forecast-resolution"));
await cron();
check("a second cron does not publish another forecast straight away", db.prepare("SELECT COUNT(*) n FROM published_pieces WHERE kind = 'forecast'").get().n === 1);

// resolution: a not-yet-due forecast is left alone, a due one is settled by two agreeing judges with a Brier score
const before = await F.resolveForecasts(env, 2);
check("a forecast before its horizon is not checked", before.checked === 0, before);
db.prepare("DROP TRIGGER q08_forecasts_published_fields_immutable").run(); // test setup moves the dates; production never may
db.prepare("UPDATE q08_forecasts SET horizon = ?, created_at = ?").run(ymd(-1), new Date(Date.now() - 100 * 864e5).toISOString());
const res = await F.resolveForecasts(env, 2);
const settled = db.prepare("SELECT * FROM q08_forecasts").get();
check("a due forecast is settled yes with Brier (p - 1)^2", res.checked === 1 && settled.status === "resolved" && settled.outcome === 1 && Math.abs(settled.brier - 0.2025) < 1e-9 && /^resolved yes/.test(settled.disposition) && !!settled.resolved_at, settled);
const st = await F.forecastStats(env);
check("stats count it as resolved with a calibration entry", st.resolved === 1 && st.calibration.n === 1 && Math.abs(st.calibration.brier - 0.2025) <= 0.001 && st.calibration.reliable === false, st);
const horizonMs = Date.parse(settled.horizon);
const updateAt = (offset) => new Date(horizonMs + offset).toISOString();
for (const [probability, at] of [[0.6, updateAt(-2 * 864e5)], [0.8, updateAt(-864e5)], [0.1, updateAt(0)], [0.99, updateAt(864e5)]]) {
  db.prepare("INSERT INTO q08_forecast_updates (forecast_id, slug, prior_probability, probability, reason, evidence_url, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)").run(settled.id, settled.slug, 0.55, probability, "A new reason for the changed probability.", at);
}
page = await (await get("/forecasts")).text();
check("/forecasts shows the settled forecast with the original and last pre-horizon update scores", /came true/.test(page) && /Original Brier 0\.2025, log score -0\.598/.test(page) && /Last pre-horizon update \(80%\) Brier 0\.04, log score -0\.223/.test(page));
api = await (await get("/api/forecasts")).json();
const scored = api.forecasts.find((f) => f.slug === settled.slug);
check("/api/forecasts returns the latest pre-horizon update probability and original/updated Brier/log scores", scored && scored.original_probability === 0.55 && scored.original_log_score === -0.598 && scored.updated_probability === 0.8 && scored.updated_at === updateAt(-864e5) && scored.updated_brier === 0.04 && scored.updated_log_score === -0.223, scored);

// void path: undecidable evidence four times in a row, rechecked weekly, never dropped silently
db.prepare("UPDATE q08_forecasts SET status = 'open', outcome = NULL, brier = NULL, checks = 0, last_check_at = NULL, resolved_at = NULL, disposition = NULL").run();
judgeAnswer = '{"outcome":"unclear","basis":"nothing decides it"}';
for (let i = 1; i <= 4; i++) {
  const r = await F.resolveForecasts(env, 2);
  const row = db.prepare("SELECT status, checks, disposition FROM q08_forecasts").get();
  check("undecidable check " + i + " is recorded", r.checked === 1 && row.checks === i, row);
  if (i < 4) {
    check("check " + i + " leaves it open", row.status === "open");
    check("it is not rechecked before the weekly interval", (await F.resolveForecasts(env, 2)).checked === 0);
    db.prepare("UPDATE q08_forecasts SET last_check_at = ?").run(new Date(Date.now() - 8 * 864e5).toISOString());
  } else check("the fourth undecidable check marks it void with a public disposition", row.status === "void" && /^void: no decidable public evidence after 4 checks/.test(row.disposition), row);
}
check("void forecasts are counted, not dropped", (await F.forecastStats(env)).void === 1);
page = await (await get("/forecasts")).text();
check("/forecasts shows the void forecast", /void: no decidable public evidence/.test(page));

// a forecast that fails its gate is logged and never blocks the analysis path
db.exec("DELETE FROM q08_forecasts; DELETE FROM published_pieces WHERE kind = 'forecast'; DELETE FROM engine_runs");
draft = () => mkDraft({ omitJson: true });
const t0 = Date.now();
const out = await F.generateForecast(env, t0);
check("a draft without the FORECAST-JSON line is rejected and generateForecast returns null", out === null);
const gf = db.prepare("SELECT status, error, top_signal FROM engine_runs").all();
check("the rejection is logged with its reasons (no silent drop)", gf.length === 1 && gf[0].status === "gate_failed" && /^forecast: .*forecast block missing/.test(gf[0].error) && /^q08-forecast:/.test(gf[0].top_signal), gf);
draft = () => mkDraft({ prob: 0.55 }).replace("judged at 55 percent", "judged at fifty-five");
check("a draft whose prose does not state the stored probability is rejected", (await F.generateForecast(env, t0)) === null && db.prepare("SELECT COUNT(*) n FROM engine_runs WHERE status = 'gate_failed'").get().n === 2);
await F.generateForecast(env, t0);
{ const rows = db.prepare("SELECT top_signal, COUNT(*) n FROM engine_runs WHERE status = 'gate_failed' GROUP BY top_signal ORDER BY n DESC").all();
  check("after two failures an essay is not retried: the next attempt moves to a different essay", rows.length === 2 && rows[0].n === 2 && rows[1].n === 1 && rows[0].top_signal !== rows[1].top_signal, rows); }

// the editor round: a first panel that would not read it sends the draft to an editor, and the edited draft keeps its forecast block
db.exec("DELETE FROM engine_runs");
draft = () => mkDraft({ prob: 0.55 });
readerQueue = ['{"would_read_to_end":false,"score":2,"slop_tells":["a phrase"],"fix":"cut the restating"}', '{"would_read_to_end":false,"score":3,"slop_tells":[],"fix":"cut the restating"}'];
const out2 = await F.generateForecast(env, Date.now());
check("a panel that would not read it triggers the editor, and the edited forecast is published with its record", out2 && out2.ok && out2.kind === "forecast" && db.prepare("SELECT COUNT(*) n FROM q08_forecasts").get().n === 1, out2);
check("the reader rows record the two rounds and the editor", db.prepare("SELECT COUNT(*) n FROM q08_reader_tests WHERE role = 'editor'").get().n === 1 && db.prepare("SELECT COUNT(DISTINCT round) n FROM q08_reader_tests").get().n === 2);

// cap 0 pauses forecasts without touching essays
const audit0 = { prepare: (sql) => { let a = []; const st = { bind: (...x) => { a = x; return st; }, first: async () => (a[0] === "q08_forecast_max_per_day" ? { value: "0" } : null), run: async () => ({ meta: { changes: 0 } }), all: async () => ({ results: [] }) }; return st; } };
db.exec("DELETE FROM q08_forecasts; DELETE FROM published_pieces WHERE kind = 'forecast'");
check("forecastDue is true with three essays on top and the default cap", (await F.forecastDue(env)) === true);
check("ops_config q08_forecast_max_per_day = 0 turns forecasts off", (await F.forecastDue({ DB: shim, AUDIT: audit0, AI })) === false);

globalThis.fetch = origFetch;
console.log("forecast.test.mjs: " + passes + " passed, " + fails + " failed");
if (fails) process.exit(1);
