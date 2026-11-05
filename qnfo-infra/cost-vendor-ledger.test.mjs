// COST-LEDGER-ALLVENDOR-1 offline suite (qnfo-infra 1.11.0). No network: the Cloudflare GraphQL and REST answers are stubs, qnfo-audit is a real node:sqlite database built from
// migrations/2026-11-04-vendor-cost-ledger.sql. Proves: the dataset mappers (R2 classes, KV actions, storage summed over ids), the allowance-aware month roll-up (D1 rows read cross the
// 25 B allowance only late in the month, so the forecast must be priced on the projected month, not on the days seen), the hourly tick (30 day backfill when empty, 3 days after,
// idempotent rewrite, a failing dataset skipped, a rate-limit answer stops the run).
// Run: node --no-warnings qnfo-infra/cost-vendor-ledger.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const a = src.indexOf("// ---- COST-LEDGER-ALLVENDOR-1:BEGIN"), b = src.indexOf("// ---- COST-LEDGER-ALLVENDOR-1:END");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 500) : "")); } };
const near = (x, y, tol = 1e-6) => Math.abs(x - y) <= tol;
ok(a > 0 && b > a, "the ledger block is found between its markers");
ok(/costVendorTick\(env\)/.test(src.slice(src.indexOf("async function runScheduled"))), "runScheduled calls costVendorTick every fire");
ok(/var VERSION = "1\.(1[1-9]|[2-9]\d)\./.test(src), "VERSION is at least 1.11");

const sandbox = { gqlImpl: null, cfImpl: null };
const make = new Function("sandbox", "withTimeout", "gql", "cf", src.slice(a, b) + "\nreturn { COST_DATASETS, costQuery, costPoints, costObservabilityPoints, costRollup, costVendorTick, costWindow };");
const L = make(sandbox, (p) => p, (env, q) => sandbox.gqlImpl(env, q), (env, p) => sandbox.cfImpl(env, p));

// ---- 1. mappers
const spec = (k) => L.COST_DATASETS.find((s) => s.key === k);
let pts = L.costPoints(spec("r2_ops"), [
  { dimensions: { date: "2026-11-03", actionType: "GetObject" }, sum: { requests: 200 } }, { dimensions: { date: "2026-11-03", actionType: "HeadObject" }, sum: { requests: 50 } },
  { dimensions: { date: "2026-11-03", actionType: "PutObject" }, sum: { requests: 7 } }, { dimensions: { date: "2026-11-03", actionType: "ListObjects" }, sum: { requests: 3 } },
  { dimensions: { date: "2026-11-03", actionType: "DeleteObject" }, sum: { requests: 999 } }, { dimensions: { date: "2026-11-03", actionType: "SomeNewAction" }, sum: { requests: 1 } }]);
const pv = (m) => (pts.find((p) => p.metric === m) || {}).quantity;
ok(pv("class_b_ops") === 250 && pv("class_a_ops") === 11, "R2: Get and Head are class B, writes, lists and an unknown action are class A, delete is free", pts);
pts = L.costPoints(spec("kv_ops"), [{ dimensions: { date: "2026-11-03", actionType: "read" }, sum: { requests: 5 } }, { dimensions: { date: "2026-11-03", actionType: "write" }, sum: { requests: 2 } }, { dimensions: { date: "2026-11-03", actionType: "delete" }, sum: { requests: 1 } }, { dimensions: { date: "2026-11-03", actionType: "list" }, sum: { requests: 4 } }]);
ok(["reads", "writes", "deletes", "lists"].every((m) => pts.some((p) => p.metric === m)) && pts.length === 4, "KV: read, write, delete, list map to the four priced metrics", pts);
pts = L.costPoints(spec("d1_storage"), [{ dimensions: { date: "2026-11-03", databaseId: "x" }, max: { databaseSizeBytes: 1.5e9 } }, { dimensions: { date: "2026-11-03", databaseId: "y" }, max: { databaseSizeBytes: 0.5e9 } }]);
ok(pts.length === 1 && near(pts[0].quantity, 2) && pts[0].metric === "storage_gb", "D1 storage is summed over databases (decimal GB)", pts);
pts = L.costPoints(spec("workers"), [{ dimensions: { date: "2026-11-03" }, sum: { requests: 10, cpuTimeUs: 5e6 } }]);
ok(pts.find((p) => p.metric === "cpu_ms").quantity === 5000, "Workers CPU microseconds become milliseconds", pts);
pts = L.costPoints(spec("containers"), [{ dimensions: { date: "2026-11-03" }, sum: { allocatedMemory: 2147483648, allocatedDisk: 5e9, cpuTimeSec: 12 } }]);
ok(near(pts.find((p) => p.metric === "memory_gib_s").quantity, 2) && near(pts.find((p) => p.metric === "disk_gb_s").quantity, 5) && pts.find((p) => p.metric === "vcpu_s").quantity === 12, "Containers: byte-seconds become GiB-s and GB-s", pts);
pts = L.costPoints(spec("workers"), [{ dimensions: {}, sum: { requests: 5 } }, { dimensions: { date: "2026-11-03" }, sum: { requests: "x", cpuTimeUs: null } }]);
ok(pts.every((p) => p.date === "2026-11-03" && Number.isFinite(p.quantity)), "a group without a date and a non-numeric value are dropped, never NaN", pts);
pts = L.costObservabilityPoints({ breakdown: [{ bin: "2026-11-03T00:00:00Z", count: 100.5, service: "a" }, { bin: "2026-11-03T00:00:00Z", count: 50, service: "b" }, { bin: "2026-11-04T00:00:00Z", count: 7, service: "a" }] });
ok(pts.length === 2 && pts[0].quantity === 150.5 && pts[0].product === "workers_logs", "observability events are summed over services per day", pts);
const q = L.costQuery("ACC", spec("d1"), L.costWindow(3, Date.UTC(2026, 10, 5, 12)));
ok(/accountTag: "ACC"/.test(q) && /d1AnalyticsAdaptiveGroups\(limit: 10000, filter: \{date_geq: "2026-11-02", date_lt: "2026-11-06"\}\)/.test(q), "the D1 query uses date filters, limit 10000 and the 3 day window", q);
const q2 = L.costQuery("ACC", spec("workers"), L.costWindow(30, Date.UTC(2026, 10, 5, 12)));
ok(/datetime_geq: "2026-10-06T00:00:00Z", datetime_lt: "2026-11-06T00:00:00Z"/.test(q2), "the 30 day backfill window is 31 days, inside the API's 32 day limit", q2);

// AI-SEARCH-COST-1: the five AI Search meters. Queries are counted, storage is the day's largest level summed over instances (decimal GB), ingestion tokens are summed.
pts = L.costPoints(spec("ai_search_semantic"), [{ dimensions: { date: "2026-11-03" }, count: 36 }, { dimensions: { date: "2026-11-03" }, count: 11 }, { dimensions: { date: "2026-11-04" }, count: 6 }]);
ok(pts.length === 2 && pts[0].metric === "semantic_queries" && pts[0].quantity === 47 && pts[0].product === "ai_search" && pts[0].unit === "queries", "AI Search semantic queries are summed per day", pts);
pts = L.costPoints(spec("ai_search_fulltext"), [{ dimensions: { date: "2026-11-03" }, count: 4 }]);
ok(pts.length === 1 && pts[0].metric === "fulltext_queries" && pts[0].quantity === 4, "AI Search full-text queries map to their own priced metric", pts);
pts = L.costPoints(spec("ai_search_storage"), [{ dimensions: { date: "2026-11-04", instanceId: "a" }, max: { bytes: 76694794 } }, { dimensions: { date: "2026-11-04", instanceId: "b" }, max: { bytes: 5305206 } }]);
ok(pts.length === 1 && pts[0].metric === "storage_gb" && near(pts[0].quantity, 0.082) && pts[0].product === "ai_search", "AI Search storage is summed over instances in decimal GB", pts);
pts = L.costPoints(spec("ai_search_ingest"), [{ dimensions: { date: "2026-11-03" }, sum: { tokens: 267599 } }, { dimensions: { date: "2026-11-03" }, sum: { tokens: 1 } }]);
ok(pts.length === 1 && pts[0].metric === "ingestion_tokens" && pts[0].quantity === 267600, "AI Search ingestion tokens are summed per day", pts);
pts = L.costPoints(spec("ai_search_image"), [{ dimensions: { date: "2026-11-03" }, sum: { tokens: 90 } }]);
ok(pts.length === 1 && pts[0].metric === "image_tokens", "AI Search image tokens map to their own priced metric", pts);
const qs = L.costQuery("ACC", spec("ai_search_semantic"), L.costWindow(30, Date.UTC(2026, 10, 5, 12)));
ok(/aiSearchSemanticQueriesAdaptiveGroups\(limit: 10000, filter: \{datetime_geq: "2026-10-06T00:00:00Z"/.test(qs) && /\{ count dimensions \{ date \} \}/.test(qs), "the AI Search query reads the semantic dataset over a datetime window and asks for count by date", qs);

// ---- 2. month roll-up
const book = [
  { vendor: "cloudflare", product: "d1", metric: "rows_read", kind: "flow", unit: "rows", included_per_month: 25e9, usd_per_block: 0.001, block_size: 1e6 },
  { vendor: "cloudflare", product: "r2", metric: "storage_gb", kind: "stock", unit: "GB", included_per_month: 10, usd_per_block: 0.015, block_size: 1 },
  { vendor: "cloudflare", product: "durable_objects", metric: "duration_gb_s", kind: "flow", unit: "GB-s", included_per_month: 400000, usd_per_block: 12.5, block_size: 1e6 }
];
const now = Date.UTC(2026, 10, 5, 12, 0, 0); // 2026-11-05 noon: 4 complete days, today partial, 30 days in November
const d1use = [1, 2, 3, 4].map((d) => ({ date: "2026-11-0" + d, product: "d1", metric: "rows_read", quantity: 2e9 })).concat([{ date: "2026-11-05", product: "d1", metric: "rows_read", quantity: 1e9 }]);
let rows = L.costRollup(d1use, book, "2026-11", now), r = rows.find((x) => x.metric === "rows_read");
ok(r && r.usage_mtd === 9e9 && r.net_mtd_usd === 0 && near(r.gross_mtd_usd, 9), "D1: month to date 9 B rows is under the 25 B allowance, net 0, gross USD 9 at the overage rate", r);
ok(near(r.usage_projected, 60e9) && near(r.net_forecast_usd, 35) && near(r.rate_daily_3d_usd, 2), "D1: the projected month (60 B) is priced after the allowance: USD 35 forecast, USD 2 a day marginal", r);
const stor = [{ date: "2026-11-03", product: "r2", metric: "storage_gb", quantity: 90 }, { date: "2026-11-05", product: "r2", metric: "storage_gb", quantity: 92 }];
r = L.costRollup(stor, book, "2026-11", now)[0];
ok(near(r.net_forecast_usd, 1.23) && near(r.net_mtd_usd, 1.23 * 5 / 30, 1e-5) && r.usage_projected === 92, "R2 stock: latest level 92 GB billed per month after 10 GB free, prorated 5/30 to date", r);
const duo = [1, 2, 3, 4].map((d) => ({ date: "2026-11-0" + d, product: "durable_objects", metric: "duration_gb_s", quantity: 35000 }));
r = L.costRollup(duo, book, "2026-11", now)[0];
ok(near(r.usage_projected, 35000 * 30) && near(r.net_forecast_usd, (1050000 - 400000) / 1e6 * 12.5), "Durable Objects: 35 k GB-s a day projects to 1.05 M against 400 k included = USD 8.125", r);
const closed = L.costRollup(d1use.slice(0, 4), book, "2026-11", Date.UTC(2026, 11, 1, 12)); r = closed[0];
ok(r.usage_projected === r.usage_mtd && r.usage_mtd === 8e9, "a closed month projects nothing: projected equals the month's actual", r);
const first = L.costRollup([{ date: "2026-11-01", product: "d1", metric: "rows_read", quantity: 3e9 }], book, "2026-11", Date.UTC(2026, 10, 1, 12));
ok(near(first[0].usage_projected, 90e9) && near(first[0].rate_daily_3d_usd, 3), "on the first day the partial day is the pace (no complete day yet)", first[0]);
ok(L.costRollup([{ date: "2026-11-03", product: "nope", metric: "nothing", quantity: 5 }], book, "2026-11", now).length === 0, "usage with no price-book row is not priced (and not invented)");

// ---- 3. the hourly tick against a real sqlite built from the migration
const mig = readFileSync(new URL("../migrations/2026-11-04-vendor-cost-ledger.sql", import.meta.url), "utf8");
const migAiSearch = readFileSync(new URL("../migrations/2026-11-05-ai-search-cost-meters.sql", import.meta.url), "utf8");
function freshDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE cost_daily (date TEXT NOT NULL, source TEXT NOT NULL, scope TEXT NOT NULL DEFAULT 'fleet', usd REAL NOT NULL DEFAULT 0, requests INTEGER DEFAULT 0, tokens_in INTEGER DEFAULT 0, tokens_out INTEGER DEFAULT 0, note TEXT, updated_at TEXT, PRIMARY KEY (date, source));" +
    "CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT, updated_at TEXT);" +
    "CREATE TABLE cost_source_registry (source TEXT PRIMARY KEY, label TEXT NOT NULL, scope TEXT NOT NULL, payer TEXT NOT NULL, observable_via TEXT, unit TEXT NOT NULL DEFAULT 'USD', notes TEXT, updated_at TEXT);" +
    "CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT, root_cause TEXT, remediation TEXT, detector TEXT, probe_class TEXT, first_seen TEXT, issue_id INTEGER, trigger_condition TEXT, symptom TEXT, blast_radius TEXT);" +
    "CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER, escalate_to TEXT, expected_cadence_h INTEGER, status TEXT, module TEXT, budget_ms INTEGER, max_items INTEGER, requires_container INTEGER);" +
    "CREATE TABLE capability_ledger (capability TEXT PRIMARY KEY, provenance TEXT, prerequisites TEXT, reliability TEXT, acquired_at TEXT, last_exercised_at TEXT, evidence TEXT);");
  db.exec(mig);
  db.exec(migAiSearch);
  return db;
}
const wrap = (db) => ({
  prepare(sql) { let args = []; const s = { bind: (...x) => { args = x; return s; }, first: async () => db.prepare(sql).get(...args) || null, all: async () => ({ results: db.prepare(sql).all(...args) }), run: async () => { db.prepare(sql).run(...args); return {}; }, _run: () => db.prepare(sql).run(...args) }; return s; },
  async batch(stmts) { db.exec("BEGIN"); try { stmts.forEach((s) => s._run()); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return stmts.map(() => ({})); }
});
const db = freshDb(), env = { AUDIT: wrap(db), CF_ACCOUNT: "ACC" };
ok(db.prepare("SELECT COUNT(*) AS n FROM cost_price_book").get().n >= 26 && db.prepare("SELECT COUNT(*) AS n FROM cost_price_book WHERE source_url NOT LIKE 'https://%' OR checked_on = ''").get().n === 0, "the price book is seeded and every row names its source URL and read date");
let queries = [];
const day = (ms) => new Date(ms).toISOString().slice(0, 10);
sandbox.gqlImpl = async (e, query) => {
  queries.push(query);
  const field = (query.match(/accounts\(filter: \{accountTag: "[^"]+"\}\) \{ (\w+)\(/) || [])[1];
  if (sandbox.failField === field) return { errors: [{ message: sandbox.failMessage || "boom" }] };
  const d = day(sandbox.now), prev = day(sandbox.now - 864e5);
  const per = { workersInvocationsAdaptive: { sum: { requests: 1000, cpuTimeUs: 2e6 } }, d1AnalyticsAdaptiveGroups: { sum: { rowsRead: 2e9, rowsWritten: 1e6 } }, d1StorageAdaptiveGroups: { max: { databaseSizeBytes: 1.5e9 } }, r2StorageAdaptiveGroups: { max: { payloadSize: 9.2e10, metadataSize: 5e6 } },
    aiSearchSemanticQueriesAdaptiveGroups: { count: 40 }, aiSearchStorageAdaptiveGroups: { max: { bytes: 7.6e7 } }, aiSearchIngestionTokensAdaptiveGroups: { sum: { tokens: 200000 } } };
  const row = per[field] || { sum: { requests: 1, duration: 10, rowsRead: 1, rowsWritten: 1, billableOperations: 1, queriedVectorDimensions: 1, totalSessionDurationMs: 1, allocatedMemory: 1, allocatedDisk: 1, cpuTimeSec: 1 }, max: { storedVectorDimensions: 5, storedBytes: 1e6, byteCount: 10 } };
  const groups = [prev, d].map((date) => ({ dimensions: { date, actionType: "GetObject" }, ...row }));
  return { data: { viewer: { accounts: [{ [field]: groups }] } } };
};
sandbox.cfImpl = async (e, p) => { sandbox.cfPath = p; return { success: true, result: { breakdown: [{ bin: day(sandbox.now) + "T00:00:00Z", count: 4000, service: "x", dataset: "workers", eventSize: 1 }] } }; };
sandbox.now = Date.UTC(2026, 10, 5, 12, 30);
let res = await L.costVendorTick(env, sandbox.now);
ok(res.errors.length === 0 && res.days === 30 && res.points > 30 && res.month_rows > 15, "first run on an empty ledger backfills 30 days and writes the month", res);
ok(queries.length === L.COST_DATASETS.length && /datetime_geq: "2026-10-06T00:00:00Z"/.test(queries[0]), "one GraphQL query per dataset over the 30 day window", queries[0]);
ok(/\/workers\/observability\/usage\?from=\d+&to=\d+/.test(sandbox.cfPath), "the observability usage endpoint is read with from and to in milliseconds", sandbox.cfPath);
const month = db.prepare("SELECT * FROM cost_vendor_month WHERE month = '2026-11' AND product = 'd1' AND metric = 'rows_read'").get();
ok(month && month.evidence === "meter" && month.usage_mtd === 4e9 && month.net_forecast_usd === 0 && month.gross_mtd_usd > 3.9 && month.gross_mtd_usd < 4.1, "the D1 row is priced: 4 B rows to date is under the allowance, so net 0 and gross USD 4", month);
const aq = db.prepare("SELECT * FROM cost_vendor_month WHERE month = '2026-11' AND product = 'ai_search' AND metric = 'semantic_queries'").get();
ok(aq && aq.evidence === "meter" && aq.usage_mtd === 80 && aq.included === 1000 && aq.net_mtd_usd === 0 && near(aq.gross_mtd_usd, 0.06), "AI Search: 80 queries to date are inside the 1,000 included, gross USD 0.06 at USD 0.75 per 1,000", aq);
const ast = db.prepare("SELECT * FROM cost_vendor_month WHERE month = '2026-11' AND product = 'ai_search' AND metric = 'storage_gb'").get();
ok(ast && near(ast.usage_projected, 0.076) && ast.net_forecast_usd === 0, "AI Search storage (0.076 GB) is a stock inside the 10 GB included", ast);
const ain = db.prepare("SELECT usage_mtd, net_forecast_usd, usage_projected FROM cost_vendor_month WHERE month = '2026-11' AND product = 'ai_search' AND metric = 'ingestion_tokens'").get();
ok(ain && ain.usage_mtd === 400000 && ain.usage_projected > ain.usage_mtd && ain.usage_projected < 5e6 && ain.net_forecast_usd === 0, "AI Search ingestion tokens are summed, projected over the month and still inside the 5 M included", ain);
const det = db.prepare("SELECT verify_probe FROM remediation_contracts WHERE class = 'fm-ai-search-meter-silent'").get();
ok(det && /product = 'ai_search' AND metric = 'storage_gb'/.test(det.verify_probe) && db.prepare("SELECT COUNT(*) AS n FROM failure_modes WHERE fm_key = 'ai-search-meter-silent'").get().n === 1, "the silent-meter failure mode and its detector are installed");
const ev = db.prepare("SELECT quantity FROM cost_usage_daily WHERE product = 'workers_logs' AND date = '2026-11-05'").get();
ok(ev && ev.quantity === 4000, "observability events are stored per day", ev);
const before = db.prepare("SELECT COUNT(*) AS n FROM cost_usage_daily").get().n;
// ledger now has 200+ rows? make it so, then the next run reads 3 days and is idempotent
for (let i = 0; i < 200; i++) db.prepare("INSERT OR IGNORE INTO cost_usage_daily (date, vendor, product, metric, quantity, unit) VALUES (?, 'cloudflare', 'filler', ?, 1, 'x')").run("2026-10-" + String(1 + (i % 28)).padStart(2, "0"), "m" + i);
queries = []; sandbox.now += 3600e3;
res = await L.costVendorTick(env, sandbox.now);
ok(res.days === 3 && /datetime_geq: "2026-11-02T00:00:00Z"/.test(queries[0]), "once the ledger holds data the run reads from three days back only", queries[0]);
ok(db.prepare("SELECT COUNT(*) AS n FROM cost_usage_daily WHERE product <> 'filler'").get().n === before, "a second run rewrites the same rows (idempotent), no duplicates");
// a failing dataset is skipped, the rest still land
sandbox.failField = "kvOperationsAdaptiveGroups"; sandbox.failMessage = "unknown field"; queries = []; sandbox.now += 3600e3;
res = await L.costVendorTick(env, sandbox.now);
ok(res.errors.length === 1 && /^kv_ops: unknown field/.test(res.errors[0]) && !res.stopped && queries.length === L.COST_DATASETS.length, "a failing dataset is reported and skipped, the other datasets still run", res);
// a rate-limit answer stops the run at that dataset
sandbox.failField = "d1AnalyticsAdaptiveGroups"; sandbox.failMessage = "Rate limiter budget depleted. Please try again after 5 minutes."; queries = []; sandbox.now += 3600e3;
res = await L.costVendorTick(env, sandbox.now);
ok(res.stopped === "graphql rate limit" && queries.length === 2, "a rate-limit answer stops the run at once (the next fire retries)", { stopped: res.stopped, q: queries.length });
// the first two days of a month also close the previous month (only when its first day was observed)
sandbox.failField = null; queries = [];
db.prepare("INSERT OR REPLACE INTO cost_usage_daily (date, vendor, product, metric, quantity, unit) VALUES ('2026-11-01', 'cloudflare', 'd1', 'rows_read', 1e9, 'rows')").run();

sandbox.now = Date.UTC(2026, 11, 1, 3, 30);
await L.costVendorTick(env, sandbox.now);
const oct = db.prepare("SELECT usage_projected, usage_mtd FROM cost_vendor_month WHERE month = '2026-11' AND product = 'd1' AND metric = 'rows_read'").get();
ok(oct && oct.usage_projected === oct.usage_mtd, "on December 1 the closed November roll-up is final (projected equals actual)", oct);

// ---- 4. the views over the same database
const db2 = freshDb();
const rel = (n) => `date('now', '${n} days')`;
for (let n = 1; n <= 5; n++) {
  db2.exec(`INSERT INTO cost_daily (date, source, usd) VALUES (${rel(-n)}, 'workers_ai', 10), (${rel(-n)}, 'cloudflare_plan:daily', 0.2), (${rel(-n)}, 'direct_providers_external:daily', 15), (${rel(-n)}, 'ai_gateway:deepseek', 1)`);
}
const nowD = new Date(), dim = new Date(Date.UTC(nowD.getUTCFullYear(), nowD.getUTCMonth() + 1, 0)).getUTCDate(), done = nowD.getUTCDate() - 1;
const mtdDays = Math.min(5, done);
db2.exec(`INSERT INTO cost_vendor_month (month, vendor, product, metric, evidence, unit, usage_mtd, net_mtd_usd, net_forecast_usd, rate_daily_3d_usd) VALUES (strftime('%Y-%m','now'), 'cloudflare', 'd1', 'rows_read', 'meter', 'rows', 9e9, 0, 35, 2), (strftime('%Y-%m','now'), 'cloudflare', 'd1', 'rows_written', 'meter', 'rows', 5e6, 0, 0.5, 0.1), (strftime('%Y-%m','now'), 'cloudflare', 'r2', 'storage_gb', 'meter', 'GB', 92, 0.2, 1.23, 0.04), (strftime('%Y-%m','now'), 'estimate_vendor', 'domains', 'renewals', 'estimate', 'USD', 0, 0, 12, 0.4)`);
const lines = db2.prepare("SELECT * FROM v_cost_lines_month").all(), L1 = (v, p) => lines.find((x) => x.vendor === v && x.product === p);
ok(lines.length === 7, "one line per (vendor, product): workers_ai, plan, gateway, direct providers, d1 (two metrics folded), r2, domains", lines.map((x) => x.vendor + "/" + x.product));
const wai = L1("cloudflare", "workers_ai");
ok(wai.evidence === "meter" && near(wai.mtd_usd, 10 * mtdDays, 0.01) && near(wai.forecast_month_usd, 10 * mtdDays + (dim - done) * 10, 0.01) && near(wai.rate_daily_usd, 10, 0.01), "Workers AI line: month to date over complete days, forecast = to date + days left x the 3 day mean", wai);
ok(L1("owner", "direct_providers").evidence === "owner-stated" && L1("cloudflare", "workers_paid_plan").evidence === "invoice", "evidence flags: the owner's figure is owner-stated, the subscription is an invoice amount");
const d1l = L1("cloudflare", "d1");
ok(near(d1l.forecast_month_usd, 35.5) && near(d1l.rate_daily_usd, 2.1), "the two D1 metrics fold into one line (35 + 0.5)", d1l);
const tot = db2.prepare("SELECT * FROM v_cost_all_in").get();
const expectedTotal = lines.reduce((s, x) => s + x.forecast_month_usd, 0);
ok(near(tot.forecast_month_usd, expectedTotal, 0.05) && tot.lines === 7 && tot.budget_month_usd === 300 && tot.budget_floor_month_usd === 200, "v_cost_all_in sums the lines and carries the USD 300 budget and USD 200 floor", tot);
ok(near(tot.owner_stated_usd, 15 * mtdDays + (dim - done) * 15, 0.05) && near(tot.estimated_usd, 12) && near(tot.measured_usd + tot.estimated_usd + tot.owner_stated_usd, tot.forecast_month_usd, 0.05), "the forecast splits exactly into measured, estimated and owner-stated dollars", tot);
ok(tot.fleet_measured_share_pct > tot.measured_share_pct && tot.fleet_measured_share_pct <= 100, "the fleet-scope measured share leaves the owner's stated figure out, so it is higher than the all-in share", tot);
db2.exec("INSERT INTO ops_config (key, value) VALUES ('cost_budget_month_usd', '250')");
ok(db2.prepare("SELECT budget_month_usd FROM v_cost_all_in").get().budget_month_usd === 250, "ops_config cost_budget_month_usd overrides the budget");
const priced = db2.prepare("SELECT * FROM v_cost_usage_priced_daily").all();
db2.exec("INSERT INTO cost_usage_daily (date, vendor, product, metric, quantity, unit) VALUES ('2026-11-03', 'cloudflare', 'd1', 'rows_read', 2.5e9, 'rows'), ('2026-11-03', 'cloudflare', 'r2', 'storage_gb', 92, 'GB')");
const pd = db2.prepare("SELECT product, metric, rate_usd FROM v_cost_usage_priced_daily").all();
ok(near(pd.find((x) => x.metric === "rows_read").rate_usd, 2.5) && near(pd.find((x) => x.metric === "storage_gb").rate_usd, (92 - 10) * 0.015 / 30), "v_cost_usage_priced_daily: a flow day is priced at the overage rate, a stock day at its monthly charge / 30", pd);
const stale = db2.prepare("SELECT * FROM v_cost_ledger_stale").all();
ok(stale.length === 1 && stale[0].vendor === "cloudflare", "v_cost_ledger_stale lists each vendor's last observation");
const probe = db2.prepare("SELECT verify_probe AS p FROM remediation_contracts WHERE class = 'fm-cost-vendor-ledger-stale'").get().p;
const pr = db2.prepare(probe).get();
ok(pr.expected === "0" && pr.observed === "0", "the stale detector reads 0 for a ledger written just now", pr);
db2.exec("UPDATE cost_usage_daily SET observed_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-8 hours')");
const prStale = db2.prepare(probe).get();
ok(Date.now() < Date.parse("2026-11-05T03:00:00Z") ? prStale.observed === "0" : prStale.observed === "1", "the detector flags a ledger older than 6 hours once the grace period (to 2026-11-05T03:00Z) is over", prStale);
ok(db2.prepare("SELECT COUNT(*) AS n FROM failure_modes WHERE fm_key = 'cost-vendor-ledger-stale'").get().n === 1, "the failure mode is registered with its detector");

const mk = db.prepare("SELECT metric, quantity, unit FROM cost_usage_daily WHERE vendor = 'cost_ledger' AND date = (SELECT MAX(date) FROM cost_usage_daily WHERE vendor = 'cost_ledger') ORDER BY metric").all();
ok(mk.length === 3 && mk.some((x) => x.metric === "errors") && mk.some((x) => x.metric === "last_note" && x.unit.length > 0), "every tick records points, errors and a note as cost_ledger rows", mk);
const noAcc = await L.costVendorTick({ AUDIT: env.AUDIT }, sandbox.now);
ok(/CF_ACCOUNT/.test(noAcc.skipped) && /CF_ACCOUNT/.test(db.prepare("SELECT unit FROM cost_usage_daily WHERE vendor = 'cost_ledger' AND metric = 'last_note' ORDER BY date DESC").get().unit), "a skipped tick (missing binding) is recorded with its reason", noAcc);

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
