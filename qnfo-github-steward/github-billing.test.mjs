// COST-LEDGER-ALLVENDOR-1 offline suite (qnfo-github-steward 0.14.0). No network: gh() is a stub that answers the billing usage summary shapes measured on 2026-11-04
// (organization QNFO October: Actions Linux 186,195 minutes, gross 1,117.17, discount 1,117.17, net 0; owner rwnq8 November: Copilot AI units gross 199.67, net 0), qnfo-audit is a real
// node:sqlite database built from migrations/2026-11-04-vendor-cost-ledger.sql. Proves the mapping to cost_vendor_month (invoice evidence, list value kept next to the net), the
// month extrapolation, the 55 minute throttle, and that a refusal is recorded as a status row instead of silence.
// Run: node --no-warnings qnfo-github-steward/github-billing.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const a = src.indexOf("// ---- COST-LEDGER-ALLVENDOR-1:BEGIN"), b = src.indexOf("// ---- COST-LEDGER-ALLVENDOR-1:END");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 500) : "")); } };
const near = (x, y, tol = 1e-4) => Math.abs(x - y) <= tol;
ok(a > 0 && b > a, "the billing block is found between its markers");
ok(/githubBillingTick\(env\)/.test(src.slice(src.indexOf("async function stewardScheduled"))), "stewardScheduled calls githubBillingTick");
ok(/var VERSION = "0\.(1[4-9]|[2-9]\d)\./.test(src) || /var VERSION = "[1-9]\./.test(src), "VERSION is at least 0.14");
ok(/github-billing-ledger/.test(src.slice(src.indexOf("var CAPABILITIES"), src.indexOf("var LIMITATIONS"))), "/health declares the github-billing-ledger capability");

const box = { calls: [], answers: {}, limited: false };
const make = new Function("box", "ORG", "USER", "gh", "ghLimited", src.slice(a, b) + "\nreturn { ghbRows, githubBillingTick };");
const G = make(box, "QNFO", "rwnq8", async (env, method, path) => { box.calls.push(path); return box.answers[path.split("?")[0].includes("/organizations/") ? "org" : "user"]; }, () => box.limited);

const orgItems = [
  { product: "Actions", sku: "actions_linux", grossQuantity: 186195, discountQuantity: 186195, netQuantity: 0, grossAmount: 1117.17, discountAmount: 1117.17, netAmount: 0, pricePerUnit: 0.006, unitType: "minutes" },
  { product: "Actions", sku: "actions_storage", grossQuantity: 49.61, discountQuantity: 49.61, netQuantity: 0, grossAmount: 0.0167, discountAmount: 0.0167, netAmount: 0, pricePerUnit: 0.000336, unitType: "gigabyte-hours" }
];
const userItems = [
  { product: "Copilot", sku: "copilot_ai_unit", grossQuantity: 13314.24, discountQuantity: 13314.24, netQuantity: 0, grossAmount: 133.14, discountAmount: 133.14, netAmount: 0, pricePerUnit: 0.01, unitType: "ai-units" },
  { product: "Copilot", sku: "coding_agent_ai_unit", grossQuantity: 6652.57, discountQuantity: 6652.57, netQuantity: 0, grossAmount: 66.53, discountAmount: 66.53, netAmount: 0, pricePerUnit: 0.01, unitType: "ai-units" },
  { product: "Actions", sku: "actions_linux", grossQuantity: 5, discountQuantity: 5, netQuantity: 0, grossAmount: 0.03, discountAmount: 0.03, netAmount: 0, pricePerUnit: 0.006, unitType: "minutes" }
];
// the month fraction: 2026-11-05 12:00Z is 4.5 days into a 30 day month
const now = Date.UTC(2026, 10, 5, 12, 0, 0);
let rows = G.ghbRows(orgItems, "org", "2026-11", now);
const act = rows.find((r) => r.metric === "actions_linux");
ok(act && act.vendor === "github" && act.product === "org:actions" && act.evidence === "invoice" && act.unit === "minutes", "org Actions minutes become an invoice-evidence line org:actions / actions_linux", act);
ok(near(act.gross_mtd_usd, 1117.17) && act.net_mtd_usd === 0 && act.net_forecast_usd === 0, "the list value is kept (USD 1,117.17) and the net stays 0 (the discount is the repository's public visibility)", act);
ok(near(act.usage_projected, 186195 * 30 / 4.5, 1) && near(act.rate_daily_3d_usd, 1117.17 / 4.5, 0.01), "usage is extrapolated to the month and the list value per day is kept as the marginal rate", act);
ok(/discounted USD 1117\.17/.test(act.note), "the note says how much was discounted", act.note);
rows = G.ghbRows(userItems, "user", "2026-11", now);
ok(rows.length === 3 && rows.every((r) => r.product.startsWith("user:")) && rows.some((r) => r.product === "user:copilot" && r.metric === "coding_agent_ai_unit"), "owner usage maps to user:copilot and user:actions lines", rows.map((r) => r.product + "/" + r.metric));
rows = G.ghbRows([{ product: "Actions", sku: "actions_linux", grossQuantity: 100, discountQuantity: 60, grossAmount: 0.6, discountAmount: 0.36, netAmount: 0.24, unitType: "minutes" }], "org", "2026-11", now);
ok(near(rows[0].net_mtd_usd, 0.24) && near(rows[0].net_forecast_usd, 0.24 * 30 / 4.5) && rows[0].included === 60, "a non-zero net is extrapolated to the month", rows[0]);
ok(G.ghbRows(null, "org", "2026-11", now).length === 0 && G.ghbRows([{ product: "X", sku: "y", grossAmount: "oops" }], "org", "2026-11", now)[0].gross_mtd_usd === 0, "an empty or malformed summary yields no rows or zeros, never NaN");

// ---- the tick against sqlite
const mig = readFileSync(new URL("../migrations/2026-11-04-vendor-cost-ledger.sql", import.meta.url), "utf8");
const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE cost_daily (date TEXT NOT NULL, source TEXT NOT NULL, scope TEXT NOT NULL DEFAULT 'fleet', usd REAL NOT NULL DEFAULT 0, requests INTEGER DEFAULT 0, tokens_in INTEGER DEFAULT 0, tokens_out INTEGER DEFAULT 0, note TEXT, updated_at TEXT, PRIMARY KEY (date, source));" +
  "CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT, updated_at TEXT);" +
  "CREATE TABLE cost_source_registry (source TEXT PRIMARY KEY, label TEXT NOT NULL, scope TEXT NOT NULL, payer TEXT NOT NULL, observable_via TEXT, unit TEXT NOT NULL DEFAULT 'USD', notes TEXT, updated_at TEXT);" +
  "CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT, root_cause TEXT, remediation TEXT, detector TEXT, probe_class TEXT, first_seen TEXT, issue_id INTEGER, trigger_condition TEXT, symptom TEXT, blast_radius TEXT);" +
  "CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER, escalate_to TEXT, expected_cadence_h INTEGER, status TEXT);" +
  "CREATE TABLE capability_ledger (capability TEXT PRIMARY KEY, provenance TEXT, prerequisites TEXT, reliability TEXT, acquired_at TEXT, last_exercised_at TEXT, evidence TEXT);");
db.exec(mig);
const env = {
  GITHUB_TOKEN: "x",
  AUDIT: {
    prepare(sql) { let args = []; const s = { bind: (...x) => { args = x; return s; }, first: async () => db.prepare(sql).get(...args) || null, run: async () => { db.prepare(sql).run(...args); return {}; }, _run: () => db.prepare(sql).run(...args) }; return s; },
    async batch(stmts) { db.exec("BEGIN"); try { stmts.forEach((s) => s._run()); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return stmts.map(() => ({})); }
  }
};
box.answers.org = { status: 200, body: { usageItems: orgItems }, text: "" };
box.answers.user = { status: 200, body: { usageItems: userItems }, text: "" };
let res = await G.githubBillingTick(env, now);
ok(res.rows === 5 && res.scopes.org === 200 && res.scopes.user === 200, "first tick writes the organization and owner rows", res);
ok(box.calls[0] === "/organizations/QNFO/settings/billing/usage/summary?year=2026&month=11" && box.calls[1] === "/users/rwnq8/settings/billing/usage/summary?year=2026&month=11", "the two summaries are read for the current UTC month", box.calls);
ok(db.prepare("SELECT COUNT(*) AS n FROM cost_vendor_month WHERE vendor = 'github' AND month = '2026-11'").get().n === 5, "five github rows are in cost_vendor_month");
const st = db.prepare("SELECT metric, quantity FROM cost_usage_daily WHERE vendor = 'github' AND product = 'billing_api' ORDER BY metric").all();
ok(st.length === 2 && st[0].metric === "http_org" && st[0].quantity === 200 && st[1].metric === "http_user", "each attempt is recorded as an http status row", st);
box.calls = [];
res = await G.githubBillingTick(env, now + 30 * 60000);
ok(res.skipped === "fresh" && box.calls.length === 0, "a second tick inside 55 minutes makes no GitHub call");
res = await G.githubBillingTick(env, now + 56 * 60000);
ok(res.rows === 5 && box.calls.length === 2, "after 55 minutes it reads again, and rewrites the same rows");
ok(db.prepare("SELECT COUNT(*) AS n FROM cost_vendor_month WHERE vendor = 'github'").get().n === 5, "the rewrite leaves five rows (no duplicates)");
// the view carries it
db.exec("INSERT INTO cost_daily (date, source, usd) VALUES (date('now', '-1 day'), 'workers_ai', 10)");
db.exec("UPDATE cost_vendor_month SET month = strftime('%Y-%m', 'now') WHERE vendor = 'github'");
const lines = db.prepare("SELECT vendor, product, evidence, forecast_month_usd FROM v_cost_lines_month WHERE vendor = 'github'").all();
ok(lines.length === 3 && lines.every((l) => l.evidence === "invoice" && l.forecast_month_usd === 0), "v_cost_lines_month shows the three GitHub lines (metrics of one product folded) as invoice evidence at USD 0 net", lines);
// refusal: the status is recorded, no rows, no throw
db.exec("DELETE FROM cost_vendor_month; DELETE FROM cost_usage_daily");
box.answers.org = { status: 403, body: { message: "Resource not accessible by personal access token" }, text: "Resource not accessible" };
box.answers.user = { status: 404, body: null, text: "Not Found" };
const origErr = console.error; let logged = 0; console.error = () => { logged++; };
res = await G.githubBillingTick(env, now);
console.error = origErr;
const refused = db.prepare("SELECT metric, quantity FROM cost_usage_daily WHERE vendor = 'github' ORDER BY metric").all();
ok(res.rows === 0 && res.scopes.org === 403 && res.scopes.user === 404 && refused.length === 2 && refused[0].quantity === 403 && refused[1].quantity === 404 && logged === 2, "a refused summary writes no rows, records the HTTP status and logs the refusal", { res, refused, logged });
box.limited = true; box.calls = [];
res = await G.githubBillingTick(env, now + 3 * 3600e3);
ok(res.skipped === "github rate limit" && box.calls.length === 0, "while the steward is rate-limited by GitHub the tick makes no call");

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
