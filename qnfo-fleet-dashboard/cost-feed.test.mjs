// DASHBOARD-COST-FEED-1 (1.48.0, agent_issues 100071) offline suite, node:sqlite. Proves: GET /api/cost answers the cost area's
// own read from v_cost_run_rate, cost_daily, ai_call_counters and fleet_budget; neurons convert to USD at 0.011 per 1,000; a
// breached budget is counted; a missing table blanks one part with its reason and never the feed; GET /api lists the feed under
// area cost and /api/area/cost now counts two feeds; the answer revalidates by ETag.
// Run: node qnfo-fleet-dashboard/cost-feed.test.mjs   -> prints "N passed, 0 failed"
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const worker = (await import(pathToFileURL(join(here, "worker.js")).href)).default;
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => "" });
function mk(withCounters) {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE cost_daily (date TEXT, source TEXT, usd REAL);
  CREATE VIEW v_cost_run_rate AS SELECT 'total:all-billing' AS source_group, 3.0 AS daily_7d, 2.5 AS daily_10d, 90.0 AS run_rate_30d_7d, 75.0 AS run_rate_30d_10d UNION ALL SELECT 'workers_ai', 1.0, 1.0, 30.0, 30.0;
  CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, last_value TEXT, last_refreshed TEXT, target TEXT);
  INSERT INTO metric_registry VALUES ('research_neurons_per_publication_7d', '15000', '2026-10-21', '<= 20000');
  CREATE VIEW v_cost_forecast AS SELECT 'fleet' AS scope, 100.0 AS mtd_complete_usd, 2.0 AS today_partial_usd, 6.0 AS daily_3d, 7.0 AS daily_7d, 180.0 AS pace_30d_usd, 166.0 AS forecast_month_usd, 31 AS days_in_month, 20 AS complete_days, 300 AS budget_month_usd, 'measured' AS basis;
  CREATE VIEW v_cost_all_in AS SELECT 140.5 AS mtd_usd, 1290.4 AS forecast_month_usd, 300.0 AS budget_month_usd, 200.0 AS budget_floor_month_usd, 64.9 AS measured_share_pct, 100.0 AS fleet_measured_share_pct, 450.0 AS owner_stated_usd, NULL AS last_usage_at;
  CREATE VIEW v_cost_lines_month AS SELECT 'cloudflare' AS vendor, 'workers_ai' AS product, 'meter' AS evidence, 100.0 AS mtd_usd, 796.0 AS forecast_month_usd, 26.0 AS rate_daily_usd;
  CREATE TABLE fleet_budget (node_class TEXT PRIMARY KEY, cap INTEGER NOT NULL, target INTEGER NOT NULL, current INTEGER NOT NULL, unit TEXT NOT NULL, updated_at TEXT NOT NULL);
  INSERT INTO fleet_budget VALUES ('ai_spend:fleet', 95, 75, 121, 'usd_30d', '2026-10-19'), ('ai_spend:ops', 20, 10, 5, 'usd_30d', '2026-10-19'), ('workers', 40, 30, 33, 'count', '2026-10-19');`);
  db.exec("INSERT INTO cost_daily VALUES (date('now','-1 day'), 'workers_ai', 1.25), (date('now','-1 day'), 'ai_gateway:openrouter', 0.5), (date('now','-1 day'), 'r2', 9), (date('now','-30 days'), 'workers_ai', 7)");
  if (withCounters) {
    db.exec(`CREATE TABLE ai_call_counters (day TEXT, worker TEXT, purpose TEXT, model TEXT, calls INTEGER DEFAULT 0, errors INTEGER DEFAULT 0, in_chars INTEGER DEFAULT 0, ms INTEGER DEFAULT 0, in_tok INTEGER DEFAULT 0, out_tok INTEGER DEFAULT 0, neurons REAL DEFAULT 0, PRIMARY KEY (day, worker, purpose, model))`);
    db.exec("INSERT INTO ai_call_counters VALUES (date('now','-1 day'), 'qnfo-ai', 'chat', '@cf/big', 10, 1, 0, 0, 100, 50, 200000), (date('now','-2 day'), 'qnfo-social', 'post', '@cf/big', 5, 0, 0, 0, 10, 5, 100000), (date('now','-1 day'), 'qnfo-social', 'post', '@cf/small', 40, 2, 0, 0, 10, 5, 1000), (date('now','-20 day'), 'qnfo-ai', 'chat', '@cf/old', 99, 0, 0, 0, 0, 0, 9e9), (date('now'), 'qnfo-ai', 'chat', '@cf/big', 7, 0, 0, 0, 0, 0, 500000), (date('now','-8 day'), 'qnfo-ai', 'chat', '@cf/edge', 1, 0, 0, 0, 0, 0, 7000)");
  }
  const prep = (sql) => { let a = []; const q = { bind(...x) { a = x; return q; }, async all() { return { results: db.prepare(sql).all(...a) }; }, async run() { db.prepare(sql).run(...a); return { success: true, meta: { changes: 0 } }; }, async first() { return db.prepare(sql).get(...a) || null; } }; return q; };
  return { AUDIT: { prepare: prep, async batch() { return []; } } };
}
const ctx = { waitUntil(p) { if (p && p.catch) p.catch(() => {}); }, passThroughOnException() {} };
const call = (env, path, h) => worker.fetch(new Request("https://fleet.qnfo.org" + path, { headers: h || {} }), env, ctx);
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 400) : "")); } };

const env = mk(true);
let r = await call(env, "/api/cost");
ok(r.status === 200, "GET /api/cost answers 200", r.status);
let j = await r.json();
const b = j.data || j;
ok(b.schema_version === "fleet-cost/v1", "the body names its schema (the closing probe reads it)");
ok(b.run_rate_30d_usd === 90, "the 30-day run-rate is the all-billing total", b.run_rate_30d_usd);
ok(Array.isArray(b.daily_14d) && b.daily_14d.length === 1 && Math.abs(b.daily_14d[0].usd - 1.75) < 1e-9, "daily spend counts AI and gateway sources in the window only", b.daily_14d);
ok(b.by_model_7d[0].model === "@cf/big" && b.by_model_7d[0].calls === 15 && Math.abs(b.by_model_7d[0].est_usd - 3.3) < 1e-9, "by model: 300k neurons = USD 3.30, 7-day window", b.by_model_7d);
ok(!b.by_model_7d.some((m) => m.model === "@cf/old" || m.model === "@cf/edge"), "rows older than 7 days are left out");
// COST-FEED-7D-WINDOW-1 (agent_issues 100169): the window is the 7 complete UTC days; today is a partial bucket and is left out.
ok(b.by_model_7d[0].calls === 15 && b.by_worker_7d.find((w) => w.worker === "qnfo-ai").calls === 10 && b.by_worker_7d.find((w) => w.worker === "qnfo-ai").neurons === 200000, "today's partial counters are not in the 7-day sums", b.by_worker_7d);
ok(b.window_7d && b.window_7d.last_day === new Date(Date.now() - 864e5).toISOString().slice(0, 10) && b.window_7d.first_day === new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10) && b.window_7d.span_days === 2 && b.window_7d.includes_today === false && b.window_7d.label === "2 complete UTC days", "window_7d is read from the rows: first and last day, span, no partial today, label", b.window_7d);
ok(/list price/.test(b.est_usd_basis) && /free tier/.test(b.est_usd_basis) && b.free_tier_neurons_per_day === 10000, "est_usd says it is list price before the free tier", [b.est_usd_basis, b.free_tier_neurons_per_day]);
ok(!/including partial today/.test(JSON.stringify(b)), "no label claims a partial day");
ok(b.by_worker_7d.length === 2 && b.by_worker_7d[0].worker === "qnfo-ai", "by worker, largest first", b.by_worker_7d);
ok(b.budgets.length === 2 && b.budgets_breached === 1 && b.budgets[0].node_class === "ai_spend:fleet" && b.budgets[0].headroom === -26, "spend budgets with headroom, breached first", b.budgets);
ok(!b.blind, "no part is blind when every table exists");
ok(b.fleet_forecast_bounded_month_usd === null && b.fleet_month_to_date_usd === 100 && Array.isArray(b.cost_metrics), "COST-SUSTAIN-3: bounded fields are null (never fabricated) when the view lacks them; month-to-date and the cost metrics part are surfaced", b);
ok(b.fleet_pace_30d_usd === 180 && b.fleet_forecast_month_usd === 166 && b.fleet_budget_month_usd === 300 && b.forecast.length === 1, "COST-SUSTAIN-1: the fleet forecast is surfaced against the USD 300 budget", b);
const tag = r.headers.get("ETag");
ok(!!tag, "the feed carries an ETag");
r = await call(env, "/api/cost", { "If-None-Match": tag });
ok(r.status === 304, "an unchanged feed revalidates with 304", r.status);

r = await call(mk(false), "/api/cost");
j = await r.json();
const b2 = j.data || j;
ok(b2.window_7d === null && /list price/.test(b2.est_usd_basis), "a blind counters read keeps window_7d null and still states the basis", b2.window_7d);
ok(r.status === 200 && b2.by_model_7d.length === 0 && b2.blind.length === 3 && /ai_call_counters/.test(b2.blind[0]) && b2.blind.some(function (x) { return /^research_budget_today: .*ai_call_counters/.test(x); }) && b2.budgets.length === 2, "a missing table blanks only its parts, with the reason", b2);

r = await call(env, "/api");
j = await r.json();
const idx = JSON.stringify(j);
ok(/"path":"\/api\/cost"/.test(idx) && /fleet-cost\/v1/.test(idx), "GET /api lists /api/cost");
const areas = (j.data || j).by_area || (j.data || j).areas || [];
const cost = (Array.isArray(areas) ? areas : Object.values(areas)).find((a) => a && a.id === "cost");
ok(cost && cost.feed_count >= 2 && cost.feeds.indexOf("/api/cost") >= 0 && cost.all_members_live === true, "the cost area counts two feeds, all live", cost);
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
