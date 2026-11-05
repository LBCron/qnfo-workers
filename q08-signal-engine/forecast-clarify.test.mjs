// BP26-FORECAST-CLARIFY-1 offline suite (q08-signal-engine): a legacy forecast whose immutable resolution text lacks a source, a date or an edge-case rule gains a dated,
// append-only clarification written from facts the row already holds; nothing is voided, republished or regenerated. Run: node q08-signal-engine/forecast-clarify.test.mjs
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
const mod = await import(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "worker.js")).href);
const F = mod.__forecast;
let fails = 0, passes = 0;
const check = (l, c, x) => { if (c) passes++; else { fails++; console.log("FAIL " + l + (x !== undefined ? " -- " + JSON.stringify(x).slice(0, 500) : "")); } };

const db = new DatabaseSync(":memory:");
const env = { DB: { prepare(sql) { const st = db.prepare(sql); let b = []; const o = { bind(...a) { b = a; return o; }, async run() { const r = st.run(...b); return { meta: { changes: Number(r.changes) } }; }, async first() { return st.get(...b) || null; }, async all() { return { results: st.all(...b) }; } }; return o; } } };
db.prepare("CREATE TABLE published_pieces (slug TEXT)").run();
await F.ensureForecastSchema(env);
const ins = db.prepare("INSERT INTO q08_forecasts (slug, claim, probability, horizon, resolution, watch_urls, created_at, status) VALUES (?, 'c', 0.6, ?, ?, ?, '2026-10-26T06:40:00.000Z', ?)");
// the three real legacy forecasts of 2026-10-26 (wording as published)
ins.run("pjm", "2026-12-31", "PJM's 2029/2030 Base Residual Auction results, posted on or before 2026-12-31, state an RTO clearing price of $337.83/MW-day (UCAP), the cap, and total capacity procured (including FRR) below the 158,712 MW reliability requirement.", JSON.stringify(["https://insidelines.pjm.com/", "https://www.pjm.com/markets-and-operations/rpm"]), "open");
ins.run("avgo", "2026-12-31", "Broadcom's fiscal Q4 2026 earnings release or call, published on or before 2026-12-31, guides first-quarter fiscal 2027 AI semiconductor revenue at or above $25.0 billion.", "[]", "open");
ins.run("trend", "2027-07-31", "a TrendForce press release published on or before 2027-07-31 gives a 3Q27 conventional DRAM contract price forecast range whose lower bound is above 0% quarter on quarter.", JSON.stringify(["https://www.trendforce.com/presscenter/news"]), "open");
ins.run("done", "2026-12-31", "Resolves yes if the Eurostat release published by 2026-12-31 shows growth above 1%; void if the release is delayed.", "[]", "open");
ins.run("vague", "2026-12-31", "It will probably happen soon", "[]", "open");
ins.run("closed", "2026-12-31", "Resolves when it happens", "[]", "resolved");
const before = db.prepare("SELECT slug, resolution, created_at, probability, horizon, status FROM q08_forecasts ORDER BY id").all();

check("the real PJM text lacks the source and the edge case", F.forecastResolutionGaps(before[0].resolution).length === 2, F.forecastResolutionGaps(before[0].resolution));
check("the real Broadcom and TrendForce texts lack only the edge case", F.forecastResolutionGaps(before[1].resolution).length === 1 && F.forecastResolutionGaps(before[2].resolution).length === 1);

const n = await F.sweepForecastCriteria(env);
check("three legacy forecasts are clarified, the complete, the unsourced vague one and the closed one are not", n === 3, n);
const rows = db.prepare("SELECT f.slug, c.text, c.kind, c.added_at FROM q08_forecasts f JOIN q08_forecast_clarifications c ON c.forecast_id = f.id ORDER BY f.id").all();
check("clarified: pjm, avgo, trend", rows.map((r) => r.slug).join() === "pjm,avgo,trend", rows.map((r) => r.slug));
check("every clarified forecast now names a source, a date and an edge-case rule", rows.every((r, i) => F.forecastResolutionGaps(before[i].resolution + " " + r.text).length === 0), rows.map((r, i) => F.forecastResolutionGaps(before[i].resolution + " " + r.text)));
check("PJM's source comes from its watch_urls", /^Source: https:\/\/insidelines\.pjm\.com\//.test(rows[0].text), rows[0].text);
check("the edge-case rule restates the resolver (weekly rechecks, void and unscored)", /rechecked every 7 days up to 4 times and resolves void \(unscored\)/.test(rows[1].text), rows[1].text);
check("the clarification is dated and says the wording and timestamp are unchanged", /Clarification added \d{4}-\d{2}-\d{2}/.test(rows[2].text) && /unchanged/.test(rows[2].text) && /^\d{4}-\d{2}-\d{2}T/.test(rows[2].added_at), rows[2]);
const after = db.prepare("SELECT slug, resolution, created_at, probability, horizon, status FROM q08_forecasts ORDER BY id").all();
check("the published resolution text, timestamp, probability and horizon are untouched", JSON.stringify(after) === JSON.stringify(before));
check("a forecast with no nameable source keeps its gap", db.prepare("SELECT COUNT(*) n FROM q08_forecast_clarifications WHERE slug = 'vague'").get().n === 0);
check("a second sweep writes nothing", (await F.sweepForecastCriteria(env)) === 0);
let blocked = false; try { db.prepare("UPDATE q08_forecast_clarifications SET text = 'x'").run(); } catch (e) { blocked = /append-only/.test(String(e.message)); }
check("clarifications cannot be edited", blocked);
let blocked2 = false; try { db.prepare("DELETE FROM q08_forecast_clarifications").run(); } catch (e) { blocked2 = /append-only/.test(String(e.message)); }
check("clarifications cannot be deleted", blocked2);
check("nothing was voided or regenerated", db.prepare("SELECT COUNT(*) n FROM q08_forecasts WHERE status = 'void'").get().n === 0 && db.prepare("SELECT COUNT(*) n FROM q08_forecasts").get().n === 6);

// the page reads it
const frow = db.prepare("SELECT * FROM q08_forecasts WHERE slug = 'pjm'").get();
frow.clarification = await F.forecastClarification(env, frow.id);
const html = F.renderForecastBox({ ...frow, alternatives_json: "[]", indicators_json: "[]", secondary_claims: [] });
check("the forecast box shows the clarification under the original resolution", html.includes("Resolves true if: PJM") && html.includes("Clarification of the resolution (") && html.indexOf("Resolves true if") < html.indexOf("Clarification of the resolution"));
check("a forecast without one shows no clarification line", !F.renderForecastBox({ ...frow, clarification: null, alternatives_json: "[]", indicators_json: "[]", secondary_claims: [] }).includes("Clarification of the resolution"));
check("an unreadable table reads as no clarification", (await F.forecastClarification({ DB: { prepare() { throw new Error("no such table"); } } }, 1)) === null);

console.log(`${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
