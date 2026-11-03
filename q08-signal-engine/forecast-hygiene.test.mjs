// BP26-FORECAST-HYGIENE-1 offline suite (q08-signal-engine 0.38.0): resolution-criteria gate, log score, calibration page, append-only
// q08_forecast_updates and the immutability trigger on published forecast fields. Run: node q08-signal-engine/forecast-hygiene.test.mjs
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
const mod = await import(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "worker.js")).href);
const F = mod.__forecast;
let fails = 0, passes = 0;
const check = (l, c, x) => { if (c) passes++; else { fails++; console.log("FAIL " + l + (x !== undefined ? " -- " + JSON.stringify(x).slice(0, 400) : "")); } };
const ymd = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
const good = () => ({ claim: "The maintainers will publish a hard fork of the library before the vendor ships its rewrite.", probability: 0.55, horizon: ymd(120), resolution: "Resolves yes if the GitHub release page of the successor repository shows a tagged release dated no later than " + ymd(120) + "; void if the repository is deleted.", alternatives: [{ claim: "The vendor ships its rewrite first and the maintainers fold into it.", probability: 0.25 }, { claim: "Neither happens and the library stays as it is.", probability: 0.1 }], indicators: ["Maintainers announce a separate release channel", "The vendor publishes a rewrite roadmap with dates"], watch_query: "library hard fork maintainers", watch_urls: [] });
const text55 = "A paragraph that says the main scenario is judged at 55 percent by the writer.";
{
  const g = F.forecastResolutionGaps;
  check("complete resolution has no gaps", g("Resolves yes if the Eurostat release published by 2026-12-31 shows growth above 1%; void if it is delayed.").length === 0);
  check("vague resolution misses source, date and edge case", g("It will probably happen soon").length === 3);
  { const f = good(); f.resolution = "A public repository named as the successor of the library exists with a tagged one."; check("validateForecast rejects a resolution that names no source/date/edge case", F.validateForecast(f, text55, Date.now()).some((p) => /resolution condition must name/.test(p))); }
  const c = F.calibration([{ probability: 0.9, outcome: 1 }, { probability: 0.9, outcome: 0 }]);
  check("log score is the mean log of the probability given to the outcome, baseline ln 0.5", Math.abs(c.log_score - Math.round(((Math.log(0.9) + Math.log(0.1)) / 2) * 1000) / 1000) < 1e-9 && c.baseline_log_score === -0.693, c);
  const coverage = F.calibration([0.01, 0.2, 0.4, 0.6, 0.8, 0.99].map((probability) => ({ probability, outcome: 1 })));
  check("calibration buckets include both tails and every published probability", coverage.bins.reduce((n, b) => n + b.n, 0) === coverage.n && coverage.bins[0].n === 1 && coverage.bins[coverage.bins.length - 1].n === 2, coverage);
  const html = F.renderCalibration(F.calibration([{ probability: 0.9, outcome: 1 }]));
  check("calibration page renders the diagram and both scores", /<svg/.test(html) && /Log score/.test(html) && /Brier score/.test(html));
  check("empty calibration page says nothing resolved", /nothing to plot/.test(F.renderCalibration(F.calibration([]))));
  // updates: new rows, original untouched, immutability trigger
  const db = new DatabaseSync(":memory:");
  const env = { DB: { prepare(sql) { const st = db.prepare(sql); let b = []; const o = { bind(...a) { b = a; return o; }, async run() { st.run(...b); return {}; }, async first() { return st.get(...b) || null; }, async all() { return { results: st.all(...b) }; } }; return o; } } };
  db.prepare("CREATE TABLE published_pieces (slug TEXT)").run();
  await F.ensureForecastSchema(env);
  db.prepare("INSERT INTO q08_forecasts (slug, claim, probability, horizon, resolution, created_at, status) VALUES ('f1','c',0.6,'2027-01-01','r','2026-10-01T00:00:00Z','open')").run();
  const r1 = await F.recordForecastUpdate(env, "f1", 0.7, "A new official release changed the picture materially.", "https://example.com/x");
  const r2 = await F.recordForecastUpdate(env, "f1", 0.8, "Second revision after a further data release.");
  check("update inserts a row and chains the prior probability", r1.ok && r1.prior_probability === 0.6 && r2.ok && r2.prior_probability === 0.7, [r1, r2]);
  check("original probability untouched", db.prepare("SELECT probability p FROM q08_forecasts").get().p === 0.6);
  check("a short reason is refused", (await F.recordForecastUpdate(env, "f1", 0.5, "no")).ok === false);
  let blocked = false; try { db.prepare("UPDATE q08_forecasts SET probability = 0.1").run(); } catch (e) { blocked = /BP26-FORECAST-HYGIENE-1/.test(String(e.message)); }
  check("trigger refuses in-place probability change", blocked);
  let blocked2 = false; try { db.prepare("DELETE FROM q08_forecast_updates").run(); } catch (e) { blocked2 = /append-only/.test(String(e.message)); }
  check("updates are append-only", blocked2);
  db.prepare("UPDATE q08_forecasts SET status='resolved', outcome=1, brier=0.16").run();
  check("status/outcome/brier stay writable", db.prepare("SELECT status s FROM q08_forecasts").get().s === "resolved");
  check("a resolved forecast takes no update", (await F.recordForecastUpdate(env, "f1", 0.5, "A reason long enough to pass the check.")).ok === false);
}
console.log("forecast-hygiene.test.mjs: " + passes + " passed, " + fails + " failed");
if (fails) process.exit(1);
