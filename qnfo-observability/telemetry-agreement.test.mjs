// TELEMETRY-AGREEMENT-1 offline suite (RM-BS-SELF-REPORTING-PLATFORM-1, blue-sky B12, charter pillar reliability). No network.
// Proves: the digest compares the platform census (worker_usage_daily) with the captured failures (worker_logs) per worker and states which one is blind;
// a worker whose failures only the platform sees (capture_blind) is alerted from the census when more than half its requests fail; a worker the capture sees and the census
// does not (platform_blind) is listed and not alerted; agreeing counts are counted; both quiet is skipped; the stored digest row carries the comparison; nothing alerts twice.
// Run: node --no-warnings qnfo-observability/telemetry-agreement.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const mod = await import("data:text/javascript;base64," + Buffer.from(src + "\nexport { digest as __digest, telemetryAgreement as __ta };\n").toString("base64"));
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 400) : "")); } };

const db = new DatabaseSync(":memory:");
db.exec(`CREATE TABLE worker_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, event_hash TEXT, ts_ms INTEGER, ingested_at TEXT, script_name TEXT, event_type TEXT, outcome TEXT, url TEXT, method TEXT, status INTEGER, cpu_ms REAL, wall_ms REAL, logs_json TEXT, exceptions_json TEXT);
CREATE TABLE worker_usage_daily (day TEXT, script TEXT, requests_24h INTEGER, errors_24h INTEGER, requests_7d INTEGER, errors_7d INTEGER, source TEXT, ts TEXT);
CREATE TABLE service_registry (service TEXT, state TEXT);
CREATE TABLE alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT, level TEXT, message TEXT, digested TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, repeats INTEGER);
CREATE TABLE cloud_ops_events (id TEXT PRIMARY KEY, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT);`);
const AUDIT = { prepare(sql) { const q = sql.replace(/"digest"/g, "'digest'"); let a = []; const s = { bind: (...x) => { a = x; return s; }, run: async () => { db.prepare(q).run(...a); return {}; }, first: async () => db.prepare(q).get(...a) || null, all: async () => ({ results: db.prepare(q).all(...a) }) }; return s; } };
const env = { AUDIT };
const now = Date.now();
const log = (script, outcome, n) => { const st = db.prepare("INSERT INTO worker_logs (ts_ms, script_name, event_type, outcome, status) VALUES (?, ?, 'telemetry:fetch', ?, NULL)"); for (let i = 0; i < n; i++) st.run(now - 1000 - i, script, outcome); };
const census = (script, req, err) => db.prepare("INSERT INTO worker_usage_daily (day, script, requests_24h, errors_24h) VALUES ('2026-11-05', ?, ?, ?)").run(script, req, err);

census("blind-down", 100, 80);                 // platform: 80 of 100 requests fail; the capture holds nothing
census("blind-small", 400, 6);                 // platform sees 6 failures, capture none, but the ratio is tiny
census("agree-a", 500, 20); log("agree-a", "exception", 24);   // 20 vs 24: within 5x
census("differ-b", 500, 3); log("differ-b", "exception", 60);  // 3 vs 60: differ
census("capture-only", 900, 0); log("capture-only", "exception", 40); // capture sees 40, census none (logged errors in ok invocations)
census("quiet", 300, 0);                       // both quiet: skipped
census("few", 300, 0); log("few", "exception", 4); // capture 4, census 0: too few to call platform_blind
for (const w of ["blind-down", "blind-small", "agree-a", "differ-b", "capture-only", "quiet", "few"]) db.prepare("INSERT INTO service_registry VALUES (?, 'live')").run(w);

const sum = await mod.__digest(env, { files: 0 });
const ta = sum.telemetry_agreement;
ok(ta && ta.census_day === "2026-11-05", "the digest carries a telemetry_agreement block with the census day", ta);
ok(ta.compared === 6 && ta.agree === 2 && ta.differ === 1, "six workers compared (quiet skipped): agree-a and the 0-versus-4 worker agree within noise, differ-b differs", ta);
ok(ta.capture_blind.length === 2 && ta.capture_blind[0].worker === "blind-down" && ta.capture_blind[0].platform === 80 && ta.capture_blind[1].worker === "blind-small", "capture_blind lists the two workers only the platform sees, worst first", ta.capture_blind);
ok(ta.platform_blind.length === 1 && ta.platform_blind[0].worker === "capture-only" && ta.platform_blind[0].captured === 40, "platform_blind lists the worker only the capture sees (4 captured failures is too few)", ta.platform_blind);

const alerts = db.prepare("SELECT message FROM alerts").all().map((r) => r.message);
ok(alerts.length === 1 && /blind-down platform error ratio 80% \(80\/100 last 24h, none captured in worker_logs\)/.test(alerts[0]), "only the majority-failure capture-blind worker alerts, from the census", alerts);
const an = Object.fromEntries(sum.anomalies.map((a) => [a.worker, a]));
ok(an["blind-down"] && an["blind-down"].source === "platform-census" && an["blind-down"].denominator === "worker_usage_daily" && !an["blind-small"] && !an["capture-only"], "anomaly rows: the census path is named, small and capture-only workers are not anomalies", sum.anomalies);

const stored = JSON.parse(db.prepare("SELECT meta FROM cloud_ops_events").get().meta);
ok(stored.telemetry_agreement && stored.telemetry_agreement.capture_blind.length === 2 && stored.telemetry_agreement.compared === 6, "the stored digest row carries the comparison, so its history is the measurement");

// pure function: no census rows -> nothing compared; a census-only worker with errors is capture-blind
const none = mod.__ta([], { day: null, by: {} });
ok(none.compared === 0 && none.capture_blind.length === 0 && none.census_day === null, "no census, nothing compared", none);
const only = mod.__ta([], { day: "d", by: { w: { requests: 50, errors: 7 } } });
ok(only.capture_blind.length === 1 && only.capture_blind[0].worker === "w", "a census-only worker with 7 failures is capture-blind", only);
const top = mod.__ta([], { day: "d", by: Object.fromEntries(Array.from({ length: 14 }, (_, i) => ["w" + i, { requests: 100, errors: 10 + i }])) });
ok(top.capture_blind.length === 10 && top.capture_blind[0].platform === 23, "the list is capped at ten, worst first", top.capture_blind.map((x) => x.platform));

console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
