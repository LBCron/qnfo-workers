// GH-BUDGET-MIN-1 (qnfo-cloud-ops 1.45.0): the 24-hour minimum of the shared GitHub token's remaining calls.
// Replays the pure bucket function, the wiring, and migrations/2026-11-04-gh-pat-budget-min.sql on node:sqlite. Run: node qnfo-cloud-ops/gh-budget-min.test.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { DatabaseSync } from "node:sqlite";
import { versionAtLeast } from "../scripts/version-at-least.mjs";
const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "worker.js"), "utf8");
let fails = 0;
const check = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (!c && x !== undefined ? " -- " + JSON.stringify(x) : "")); if (!c) fails++; };

const a = src.indexOf("// ---- GH-BUDGET-MIN-1:BEGIN"), b = src.indexOf("// ---- GH-BUDGET-MIN-1:END");
check(a > 0 && b > a, "the pure block is marked");
const sb = { Date, Math, Number, String, isNaN, JSON, Object };
vm.createContext(sb);
vm.runInContext(src.slice(a, b) + "\n__export = { ghBudgetMinUpdate };", sb);
const { ghBudgetMinUpdate } = sb.__export;
const H = 36e5, t0 = Date.parse("2026-11-04T17:00:00Z");

let r = ghBudgetMinUpdate(null, 4000, t0);
check(r.min === 4000 && r.buckets === 1, "first sample", r);
r = ghBudgetMinUpdate(r.state, 0, t0 + 10 * 6e4);
check(r.min === 0 && r.buckets === 1, "a drain to 0 in the same hour lowers the bucket", r);
r = ghBudgetMinUpdate(r.state, 5000, t0 + 20 * 6e4);
check(r.min === 0, "a recovery inside the hour does not raise the bucket (the drain stays visible)", r);
r = ghBudgetMinUpdate(r.state, 4900, t0 + 5 * H);
check(r.min === 0 && r.buckets === 2, "the minimum holds for 24 hours", r);
r = ghBudgetMinUpdate(r.state, 4800, t0 + 25 * H);
check(r.min === 4800 && r.buckets === 2 || r.min === 4800, "a bucket older than 24 hours drops out", r);
r = ghBudgetMinUpdate("not json", 700, t0);
check(r.min === 700, "corrupt state restarts cleanly", r);
r = ghBudgetMinUpdate(JSON.stringify({ b: { x: 1 } }), null, t0);
check(r.min === null && r.buckets === 0, "no sample and no valid bucket gives no minimum", r);
r = ghBudgetMinUpdate(ghBudgetMinUpdate(null, 900, t0).state, null, t0 + H);
check(r.min === 900, "a null remaining keeps the earlier minimum", r);

check(/ghBudgetMinUpdate\(await stateGet\(env, "gh_budget_min24", null\), w\.remaining, now\)/.test(src) && /vals\.push\(\["github_pat_budget_min_24h", bm\.min\]\)/.test(src), "jobGhTokenWatch feeds and writes the metric");
check((src.match(/async function jobGhTokenWatch\(env\) \{/g) || []).length === 1, "the trigger's code-anchor occurs once");
check(readFileSync(join(here, "deployed-current.worker.js"), "utf8") === src, "mirror identical");
const ver = /var VERSION = "([^"]+)"/.exec(src)[1];
check(versionAtLeast(ver, "1.45.0"), "VERSION at least 1.45.0", ver);

// migration replay
const sql = readFileSync(join(here, "..", "migrations", "2026-11-04-gh-pat-budget-min.sql"), "utf8");
const body = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
const db = new DatabaseSync(":memory:");
db.exec(`CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, layer TEXT, kind TEXT, formula TEXT, source_of_truth TEXT, baseline TEXT, target TEXT, owner TEXT, disposition_actor TEXT, refresh_cadence TEXT, warning_band TEXT, kill_band TEXT, state TEXT, refresh_class TEXT, last_value TEXT, last_refreshed TEXT);
CREATE TABLE analytics_metric_triggers (id INTEGER PRIMARY KEY AUTOINCREMENT, metric_key TEXT UNIQUE, title TEXT, source_table TEXT, operator TEXT, threshold REAL, priority INTEGER, action TEXT, owner TEXT, queue_target TEXT, cooldown_hours INTEGER, enabled INTEGER, notes TEXT);
CREATE TABLE metric_breach_cause (metric_key TEXT PRIMARY KEY, cause_key TEXT NOT NULL, note TEXT);
CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT, root_cause TEXT, remediation TEXT, detector TEXT, probe_class TEXT, first_seen TEXT, issue_id INTEGER, trigger_condition TEXT, symptom TEXT, blast_radius TEXT);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER, escalate_to TEXT, expected_cadence_h INTEGER, status TEXT, ts TEXT, module TEXT, budget_ms INTEGER, max_items INTEGER, requires_container INTEGER, attempts INTEGER);`);
db.exec(body); db.exec(body);
const one = (q) => db.prepare(q).all();
check(one("SELECT 1 FROM metric_registry WHERE metric='github_pat_budget_min_24h' AND kind='guard' AND target='>= 600' AND refresh_class='computed'").length === 1, "metric registered once");
const t = one("SELECT * FROM analytics_metric_triggers WHERE metric_key='github_pat_budget_min_24h'");
check(t.length === 1 && t[0].operator === "lt" && t[0].threshold === 600 && t[0].owner === "QNFO.OPS" && /Done:/.test(t[0].action), "one trigger, lt 600, owner QNFO.OPS, with a definition of done", t);
const lines = t[0].action.split("\n");
check(lines.includes("code-task: repo=qnfo-workers path=qnfo-cloud-ops/worker.js") && lines.includes("code-anchor: async function jobGhTokenWatch(env) {"), "ACT-BRIDGE-1 lines, anchor is a signature");
check(one("SELECT cause_key FROM metric_breach_cause WHERE metric_key='github_pat_budget_min_24h'")[0]?.cause_key === "code-loop", "cause mapped in the same file");
const probe = one("SELECT verify_probe p FROM remediation_contracts WHERE class='fm-github-pat-budget-min'")[0].p;
const run = () => { const x = db.prepare(probe).get(); return x.expected === x.observed; };
check(!run(), "probe fails while unmeasured");
db.exec("UPDATE metric_registry SET last_value='4000', last_refreshed=datetime('now') WHERE metric='github_pat_budget_min_24h'");
check(run(), "probe passes at 4000 and fresh");
db.exec("UPDATE metric_registry SET last_value='0' WHERE metric='github_pat_budget_min_24h'");
check(!run(), "probe fails at 0");
db.exec("UPDATE metric_registry SET last_value='4000', last_refreshed=datetime('now','-2 hours') WHERE metric='github_pat_budget_min_24h'");
check(!run(), "probe fails when stale");
const rb = /^-- Rollback: (.+)$/m.exec(sql)[1];
db.exec(rb);
check(one("SELECT 1 FROM metric_registry").length === 0 && one("SELECT 1 FROM analytics_metric_triggers").length === 0 && one("SELECT 1 FROM metric_breach_cause").length === 0, "rollback removes everything");
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
