// COST-LEDGER-ALLVENDOR-1 offline suite (qnfo-fleet-dashboard 1.90.0): the Money card reads ONE all-in total from the all-vendor ledger (v_cost_all_in) and its lines
// (v_cost_lines_month): month to date, forecast, budget band, the largest three lines, the share read from a vendor meter or invoice. No network. The two feed statements are run
// on a real node:sqlite database built from migrations/2026-11-04-vendor-cost-ledger.sql; v3Spend is cut out of worker.js and fed a stub feed.
// Run: node --no-warnings qnfo-fleet-dashboard/all-in-cost.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
let pass = 0, fail = 0;
const near = (x, y, tol = 0.01) => Math.abs(x - y) <= tol;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 500) : "")); } };

ok(/all_in: "SELECT \* FROM v_cost_all_in"/.test(src) && /all_in_lines: "SELECT vendor, product, evidence, mtd_usd, forecast_month_usd, rate_daily_usd FROM v_cost_lines_month ORDER BY forecast_month_usd DESC LIMIT 12"/.test(src), "the cost feed reads the ledger's total and its twelve largest lines");
ok(src.includes("Largest three lines") && src.includes("Read from a vendor meter or invoice") && src.includes("All vendors, forecast for the month"), "the Money card shows the forecast, the largest three lines and the measured share");
ok(/var VERSION = "1\.(9[1-9]|[1-9]\d\d)\./.test(src), "dashboard VERSION is at least 1.91");

// v3Spend with a stub feed
const v3s = src.indexOf("async function v3Spend(env) {"), a = src.indexOf("function v3AiRoom(");
const rest = src.slice(v3s + 10), m = /\n(?:async function|function|var) /.exec(rest);
const fn = src.slice(a, v3s + 10 + (m ? m.index : rest.length));
const make = new Function("feed", "v3Age", "return (function(){ const costFeedData = async () => feed.c;\n" + fn + "\nreturn v3Spend; })();");
const feed = { c: null };
const v3Spend = make(feed, (t) => (t ? Math.max(0, Math.round((Date.now() - Date.parse(t)) / 1000)) : null));
const base = { run_rate: [{ source_group: "total:all-billing", daily_7d: 41.6 }, { source_group: "workers_ai", daily_7d: 26.4 }], budgets: [], fleet_budget_month_usd: 300, fleet_month_to_date_usd: 115, fleet_forecast_bounded_month_usd: 832, fleet_pace_30d_usd: 1151 };
feed.c = Object.assign({}, base, {
  all_in: { mtd_usd: 140.5, forecast_month_usd: 1290.4, budget_month_usd: 300, budget_floor_month_usd: 200, measured_share_pct: 64.9, fleet_measured_share_pct: 100, owner_stated_usd: 450, last_usage_at: new Date(Date.now() - 600e3).toISOString().replace(/\.\d+Z$/, "Z") },
  all_in_lines: [
    { vendor: "cloudflare", product: "workers_ai", evidence: "meter", forecast_month_usd: 796 }, { vendor: "owner", product: "direct_providers", evidence: "owner-stated", forecast_month_usd: 450 },
    { vendor: "cloudflare", product: "d1", evidence: "meter", forecast_month_usd: 35.5 }, { vendor: "cloudflare", product: "durable_objects", evidence: "meter", forecast_month_usd: 8.1 }]
});
let sp = await v3Spend({});
ok(sp.all_in && sp.all_in.mtd_usd === 140.5 && sp.all_in.forecast_month_usd === 1290.4 && sp.all_in.budget_month_usd === 300 && sp.all_in.budget_floor_month_usd === 200, "v3Spend carries month to date, forecast and the budget band", sp.all_in);
ok(sp.all_in.top3.length === 3 && sp.all_in.top3[0].line === "cloudflare workers ai" && sp.all_in.top3[1].evidence === "owner-stated" && sp.all_in.top3[2].usd === 35.5, "the largest three lines are named in feed order with their evidence", sp.all_in.top3);
ok(sp.all_in.measured_share_pct === 64.9 && sp.all_in.fleet_measured_share_pct === 100 && sp.all_in.owner_stated_usd === 450 && sp.all_in.data_age_s >= 590 && sp.all_in.data_age_s < 700, "the measured shares, the stated dollars and the data age ride along", sp.all_in);
ok(sp.budget_month_usd === 300 && sp.pace_month_usd === 1151 && sp.daily_usd === 41.6, "the existing fleet fields are unchanged (the PR 7123 correction stays)", sp);
feed.c = Object.assign({}, base);
sp = await v3Spend({});
ok(sp.all_in === null && sp.pace_month_usd === 1151, "without the ledger view the card falls back to the old fields (all_in null, no throw)", sp.all_in);
feed.c = Object.assign({}, base, { all_in: { mtd_usd: null, forecast_month_usd: null } });
sp = await v3Spend({});
ok(sp.all_in === null, "an empty total (null forecast) is not shown as a number");

// the room the AI part has to land on the budget
const dnow = new Date(), dimN = new Date(Date.UTC(dnow.getUTCFullYear(), dnow.getUTCMonth() + 1, 0)).getUTCDate(), leftN = dimN - dnow.getUTCDate() + 1;
feed.c = Object.assign({}, base, {
  all_in: { mtd_usd: 140.5, forecast_month_usd: 1290.4, budget_month_usd: 300, budget_floor_month_usd: 200, measured_share_pct: 64.9, fleet_measured_share_pct: 100, owner_stated_usd: 450, last_usage_at: null },
  all_in_lines: [{ vendor: "cloudflare", product: "workers_ai", evidence: "meter", mtd_usd: 100, forecast_month_usd: 796, rate_daily_usd: 26.5 }, { vendor: "owner", product: "direct_providers", evidence: "owner-stated", mtd_usd: 40, forecast_month_usd: 450, rate_daily_usd: 15 }]
});
sp = await v3Spend({});
ok(sp.all_in.room && sp.all_in.room.reachable === false && sp.all_in.room.ai_daily_room_usd === 0 && near(sp.all_in.room.non_ai_forecast_usd, 494.4) && sp.all_in.room.ai_daily_now_usd === 26.5, "the owner's stated line plus the rest already forecast above the budget: not reachable even with AI at zero", sp.all_in.room);
feed.c.all_in = Object.assign({}, feed.c.all_in, { forecast_month_usd: 400 });
feed.c.all_in_lines = [{ vendor: "cloudflare", product: "workers_ai", evidence: "meter", mtd_usd: 90, forecast_month_usd: 300, rate_daily_usd: 12 }];
sp = await v3Spend({});
ok(sp.all_in.room.reachable === true && near(sp.all_in.room.ai_daily_room_usd, Math.round((300 - 100 - 90) / leftN * 100) / 100) && sp.all_in.room.days_left === leftN && sp.all_in.room.ai_daily_now_usd === 12, "when the rest fits, the AI part gets (budget - rest - AI spent so far) / days left a day", sp.all_in.room);
feed.c.all_in_lines = [{ vendor: "owner", product: "direct_providers", evidence: "owner-stated", mtd_usd: 40, forecast_month_usd: 450, rate_daily_usd: 15 }];
sp = await v3Spend({});
ok(sp.all_in.room === null && sp.all_in.forecast_month_usd === 400, "without a Workers AI line there is no room figure (null), the rest of the card still renders", sp.all_in);
ok(src.includes("var ai0=sp.all_in&&sp.all_in.budget_month_usd?sp.all_in:null") && src.includes("Cost: '+(ai0?'all-vendor forecast':'fleet pace')"), "the hero, the four numbers and the card header use the all-in forecast when the ledger has one, so they agree with the card body");
ok(src.includes("above the budget even with AI at zero") && src.includes("AI would have to average, per day, for the rest of the month"), "the Money card words both outcomes");

// the two feed statements on the real views
const mig = readFileSync(new URL("../migrations/2026-11-04-vendor-cost-ledger.sql", import.meta.url), "utf8");
const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE cost_daily (date TEXT NOT NULL, source TEXT NOT NULL, scope TEXT NOT NULL DEFAULT 'fleet', usd REAL NOT NULL DEFAULT 0, requests INTEGER DEFAULT 0, tokens_in INTEGER DEFAULT 0, tokens_out INTEGER DEFAULT 0, note TEXT, updated_at TEXT, PRIMARY KEY (date, source));" +
  "CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT, updated_at TEXT);" +
  "CREATE TABLE cost_source_registry (source TEXT PRIMARY KEY, label TEXT NOT NULL, scope TEXT NOT NULL, payer TEXT NOT NULL, observable_via TEXT, unit TEXT NOT NULL DEFAULT 'USD', notes TEXT, updated_at TEXT);" +
  "CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT, root_cause TEXT, remediation TEXT, detector TEXT, probe_class TEXT, first_seen TEXT, issue_id INTEGER, trigger_condition TEXT, symptom TEXT, blast_radius TEXT);" +
  "CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER, escalate_to TEXT, expected_cadence_h INTEGER, status TEXT);" +
  "CREATE TABLE capability_ledger (capability TEXT PRIMARY KEY, provenance TEXT, prerequisites TEXT, reliability TEXT, acquired_at TEXT, last_exercised_at TEXT, evidence TEXT);");
db.exec(mig);
for (let n = 1; n <= 4; n++) db.exec(`INSERT INTO cost_daily (date, source, usd) VALUES (date('now', '-${n} days'), 'workers_ai', 20), (date('now', '-${n} days'), 'direct_providers_external:daily', 15)`);
for (let i = 0; i < 14; i++) db.exec(`INSERT INTO cost_vendor_month (month, vendor, product, metric, evidence, unit, net_mtd_usd, net_forecast_usd) VALUES (strftime('%Y-%m', 'now'), 'cloudflare', 'p${i}', 'm', 'meter', 'x', 0, ${i + 1})`);
const grab = (key) => (new RegExp(key + ': "([^"]+)"').exec(src) || [])[1];
const total = db.prepare(grab("all_in")).all(), lines = db.prepare(grab("all_in_lines")).all();
ok(total.length === 1 && total[0].lines === 16 && total[0].forecast_month_usd > 0 && total[0].last_usage_at === null, "the total statement returns one row over the 16 lines (14 products, Workers AI, direct providers)", total[0]);
ok(lines.length === 12 && lines[0].forecast_month_usd >= lines[11].forecast_month_usd && lines[0].product !== undefined, "the lines statement returns the twelve largest, largest first", lines.map((l) => l.product + ":" + l.forecast_month_usd));
ok(lines.some((l) => l.evidence === "owner-stated") === (lines.some((l) => l.product === "direct_providers")), "the owner-stated flag is on the direct providers line");

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
