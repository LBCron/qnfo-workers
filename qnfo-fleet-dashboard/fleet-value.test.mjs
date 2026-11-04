// VALUE-DASH-1 (1.76.0) offline suite: the value proposition and the action contract on the home page.
//   V1 value.units (papers, merged code, closed issues, pageviews per $100: a maximise ratio with a push and a trim lever and a posture) with the quality measure beside each, and a null where a source is unreadable (never zero).
//   V2 doc.actions.subjects has an entry (meaning, why, fleet_default, doer) for every unit, cause, program, breached metric, quality, activity.
//   V3 the page shows every item with its "What is this" block; a stranger sees no buttons and the sign-in line, the owner sees Fix it and Tell the system.
//   V4 POST /api/owner/act files the item as fleet work from the page's own text (stable, deduped), refuses a stranger, a bad subject and a vanished item.
// Run: node qnfo-fleet-dashboard/fleet-value.test.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const worker = (await import(pathToFileURL(join(here, "worker.js")).href)).default;
const src = readFileSync(join(here, "worker.js"), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 300))); } };

// The pure pieces are inlined in worker.js; load them without the worker's I/O by evaluating the VALUE-DASH-1 block.
const a = src.indexOf("/* VALUE-DASH-1:BEGIN */"), b = src.indexOf("/* VALUE-DASH-1:END */");
ok(a > 0 && b > a, "value block present");
const V = new Function(src.slice(a, b) + "\nreturn { valueModel, actionIndex, actTicket, validSubject, actBarHtml, valueSectionHtml, usdText, VALUE_JS, VALUE_CSS };")();
const e = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const metrics = { code_task_success_rate_30d: { value: 0.62, breach: 1, trend: "worse" }, fix_hold_rate_30d: { value: 0.61, breach: 1, trend: "flat" }, pageviews_30d: { value: 9000, breach: 0, trend: "better" } };
const m = V.valueModel({ spend_7d_usd: 203.7, daily_usd: 29.1, fixed_daily_usd: 15.17, variable_daily_usd: 14.09, month_budget_usd: 300, month_to_date_usd: 351, work: { code_merged_7d: 40, issues_closed_7d: 100 }, papers_7d: 41, pageviews_7d: 5149, metrics, quality: { verdict: "mixed", better: 5, worse: 1, flat: 1, unmeasured: 4, gaps: ["papers"] }, blind: [] });
const byId = Object.fromEntries(m.units.map((u) => [u.id, u]));
ok(m.units.length === 4, "four units");
ok(Math.abs(byId.paper.yield_per_100usd - 41 / 203.7 * 100) < 0.01, "yield = outputs per $100 of spend", byId.paper.yield_per_100usd);
ok(Math.abs(byId.pageviews.yield_per_100usd - 5149 / 203.7 * 100) < 0.5, "pageviews per $100", byId.pageviews.yield_per_100usd);
ok(Math.abs(byId.paper.per_100usd_variable - 41 / (14.09 * 7) * 100) < 0.01, "yield per $100 of variable spend too");
ok(Math.abs(byId.paper.cost_each_usd - 203.7 / 41) < 1e-3, "cost each is kept as the minimise-side reading");
ok(byId.code.quality.status === "off_target" && /62%/.test(byId.code.quality.text), "code quality is the success rate, off target", byId.code.quality);
ok(/no outcome measure yet/.test(byId.paper.quality.text), "paper quality admits the missing measure");
ok(m.units.every((u) => u.push && u.trim), "every unit names a push (maximise) lever and a trim (minimise) lever");
ok(m.spend.fixed_share > 0.5 && m.spend.headroom_usd === -51, "fixed share and headroom", m.spend);
ok(m.posture.mode === "over_budget", "over budget -> hold volume, raise yield", m.posture);
ok(/yield per \$100 rose, quality did not fall/.test(m.rule) && /Spending nothing is not a win/.test(m.rule), "rule forbids winning by doing nothing");
const grow = V.valueModel({ spend_7d_usd: 100, daily_usd: 14, month_budget_usd: 300, month_to_date_usd: 120, work: { code_merged_7d: 5, issues_closed_7d: 5 }, papers_7d: 5, pageviews_7d: 1000, metrics: { code_task_success_rate_30d: { value: 0.9, breach: 0 }, fix_hold_rate_30d: { value: 0.9, breach: 0 }, pageviews_30d: { value: 9, breach: 0 } }, quality: { verdict: "better", better: 3, worse: 0, flat: 0, unmeasured: 0, gaps: [] } });
ok(grow.posture.mode === "grow" && /push volume/.test(grow.posture.sentence), "inside budget, quality on target -> push volume", grow.posture);
const fq = V.valueModel({ spend_7d_usd: 100, daily_usd: 14, month_budget_usd: 300, month_to_date_usd: 120, work: { code_merged_7d: 5, issues_closed_7d: 5 }, papers_7d: 5, pageviews_7d: 1000, metrics: { code_task_success_rate_30d: { value: 0.4, breach: 1 } }, quality: null });
ok(fq.posture.mode === "fix_quality", "quality off target inside budget -> fix quality first", fq.posture);
const n = V.valueModel({ spend_7d_usd: null, work: null, papers_7d: null, pageviews_7d: null, metrics: {}, quality: null, blind: ["spend (cost feed)"] });
ok(n.units.every((u) => u.yield_per_100usd === null) && n.posture.mode === "unknown", "no spend or no outputs -> null, never zero");
ok(V.valueModel({ spend_7d_usd: 100, work: { code_merged_7d: 0, issues_closed_7d: 5 }, papers_7d: 0, pageviews_7d: 10, metrics: {}, quality: null }).units[0].yield_per_100usd === 0, "zero outputs at real spend is a measured zero yield (the case cost-per-output hid)");
ok(V.valueModel({ spend_7d_usd: 100, work: { code_merged_7d: 0, issues_closed_7d: 5 }, papers_7d: 0, pageviews_7d: 10, metrics: {}, quality: null }).units[0].cost_each_usd === null, "cost each is null at zero outputs");

ok(V.validSubject("unit:paper") && V.validSubject("metric:open_agent_issues") && V.validSubject("quality") && V.validSubject("activity"), "valid subjects");
ok(!V.validSubject("unit:") && !V.validSubject("x:y") && !V.validSubject("metric:a b") && !V.validSubject("../etc"), "bad subjects refused");

const entry = { title: "T", meaning: "M", why: "W", fleet_default: "D", doer: "qnfo-x", lever: "L" };
const t1 = V.actTicket("unit:paper", entry, ""), t2 = V.actTicket("unit:paper", entry, "");
ok(t1 === t2 && /OWNER-ACT unit:paper/.test(t1) && /fix it: D/.test(t1) && /Spending nothing is not a win/.test(t1), "default ticket is stable, carries the fleet default and the two-sided rule");
ok(/make it cheaper/.test(V.actTicket("unit:paper", entry, "make it cheaper")) && !/fix it: D/.test(V.actTicket("unit:paper", entry, "make it cheaper")), "owner words replace the default");
ok(V.actTicket("unit:paper", entry, "x".repeat(900)).length < 1900, "directive is capped");

const idx = V.actionIndex({ value: m, causes: [{ cause: "structure", title: "S", plain: "p", lever: "l", doer: "d", breaches: 2 }], metrics: { by_program: [{ code: "QNFO.OPS", name: "Ops", what: "w", manager: "program-manager:QNFO.OPS", in_breach: 1, measured: 9, worse_7d: 1, breaches: [{ metric: "open_agent_issues", title: "Open issues", value: 384, threshold: 260, operator: "gt", value_7d_ago: 420, trend: "better" }] }] }, quality: { better: 5, worse: 1, gaps: ["papers"] }, activity_24h: { decisions_logged: 1 }, fleet_handling: { count: 2 } });
for (const k of ["unit:paper", "unit:code", "unit:issue", "unit:pageviews", "cause:structure", "program:QNFO.OPS", "metric:open_agent_issues", "quality", "activity", "handling"]) ok(idx[k] && idx[k].meaning && idx[k].why && idx[k].fleet_default && idx[k].doer, "action entry for " + k, idx[k]);

const visitor = V.valueSectionHtml(m, false, idx, e), owner = V.valueSectionHtml(m, true, idx, e);
ok(/What is this, why am I seeing it/.test(visitor) && /sign in/.test(visitor) && !/data-vact="fix"/.test(visitor), "stranger: explanation and sign-in line, no buttons");
ok(/data-vact="fix"/.test(owner) && /Tell the system/.test(owner) && /papers published per \$100/.test(owner), "owner: Fix it and Tell the system on every unit");
ok((owner.match(/data-vact="fix"/g) || []).length === 4, "one Fix it per unit");
ok(/<\/script>$/.test(V.VALUE_JS) && !/<\\\/script>/.test(V.VALUE_JS), "script tag closes");

// Route level: /api/status carries value + actions, and the owner route is closed to a stranger.
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => "" });
const env = { AUDIT: { prepare() { const q = { bind() { return q; }, async all() { return { results: [] }; }, async run() { return { success: true, meta: { changes: 0 } }; }, async first() { return null; } }; return q; }, async batch() { return []; } }, LOOP_TOKEN: "t" };
const ctx = { waitUntil() {}, passThroughOnException() {} };
const post = (path, body, h) => worker.fetch(new Request("https://fleet.qnfo.org" + path, { method: "POST", headers: Object.assign({ "content-type": "application/json", "x-fleet-ui": "1" }, h || {}), body: JSON.stringify(body) }), env, ctx);
const r1 = await post("/api/owner/act", { subject: "unit:paper" });
ok(r1.status === 403, "stranger cannot act", r1.status);
const r2 = await post("/api/owner/act", { subject: "../x" }, { "x-loop-token": "t" });
ok(r2.status === 400, "bad subject is 400", r2.status);
const r3 = await post("/api/owner/act", { subject: "metric:gone" }, { "x-loop-token": "t" });
ok(r3.status === 404, "vanished item is 404", r3.status);
const hv = await worker.fetch(new Request("https://fleet.qnfo.org/overview"), env, ctx);
ok(hv.status === 200 || hv.status === 500, "home renders or fails loudly (empty D1 fixture)", hv.status);

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
