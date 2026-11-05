// SPEND-GOVERNOR-1 suite (RM-COST-L6-DRAFT-VERIFY-1, agent_issues 1001813): migrations/2026-11-05-w2f-a-spend-governor-plan.sql builds the hourly plan, not a switch.
// The view is run against a fixture database (node:sqlite), never against live state: the 1.8x threshold, the A/B gate, the excluded ladder purpose, the context floor.
// Run: node migrations/spend-governor-plan.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(here, "2026-11-05-w2f-a-spend-governor-plan.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 400) : "")); } };

ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: .+/m.test(sql), "the runner header lines are present");
const code = sql.replace(/^--.*$/gm, "");
ok(!/\b(DELETE FROM|DROP TABLE|DROP VIEW)\b/i.test(code.replace(/'(?:[^']|'')*'/g, "''")), "nothing is destroyed (no BACKUP table needed)");
ok(!/INSERT INTO ai_call_counters|UPDATE ai_call_counters/i.test(code), "the plan never writes projected neurons into ai_call_counters (cap and attribution input)");
ok(!/UPDATE (ops_config|model_ladder_models|ai_gateway_routes)|INSERT INTO ops_config/i.test(code), "the plan switches no model and edits no routing table");

// fleet task: the JSON parses and its single step writes the plan table from the view
const def = /VALUES \('spend-governor-plan', '(?:[^']|'')*', 'workflow',\s*'(\{(?:[^']|'')*\})'/.exec(sql);
ok(!!def, "the fleet_tasks definition is found");
let task = null;
try { task = JSON.parse(def[1].replace(/''/g, "'")); } catch (e) { task = { error: String(e) }; }
ok(task && Array.isArray(task.steps) && task.steps.length === 1 && task.steps[0].type === "sql" && task.steps[0].db === "AUDIT", "one sql step on the AUDIT database", task);
ok(/INSERT INTO spend_governor_plan[\s\S]*FROM v_spend_governor_plan WHERE 1 ON CONFLICT\(day, worker, purpose, model\) DO UPDATE/.test(task.steps[0].sql || ""), "the step upserts the view into the plan table on its key");
ok(/'35 \* \* \* \*'/.test(sql) && /spend-governor-plan-hourly/.test(sql), "hourly cron at :35");

// the view, on fixtures
const db = new DatabaseSync(":memory:");
db.exec(`CREATE TABLE ai_call_counters (day TEXT, worker TEXT, purpose TEXT, model TEXT, calls INTEGER, errors INTEGER, in_tok INTEGER, out_tok INTEGER, neurons REAL);
CREATE TABLE cf_model_catalog (model_id TEXT PRIMARY KEY, status TEXT, modality TEXT, price_in REAL, price_out REAL, best_score REAL, ctx INTEGER);
CREATE TABLE model_ab_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, worker TEXT, pre_model TEXT, post_model TEXT, verdict TEXT);`);
const today = new Date().toISOString().slice(0, 10);
const cnt = db.prepare("INSERT INTO ai_call_counters VALUES (?,?,?,?,?,?,?,?,?)");
const cat = db.prepare("INSERT INTO cf_model_catalog VALUES (?,?,?,?,?,?,?)");
// big (current) model at 1 USD/M in and 4 USD/M out; cheap at 0.1 / 0.3; a free one; a rejected one; a short-context one
cat.run("@cf/big", "in_production", "chat", 1, 4, 1, 262144);
cat.run("@cf/cheap", "in_production", "chat", 0.1, 0.3, 1, 262144);
cat.run("@cf/cheaper-but-short", "in_production", "chat", 0.05, 0.1, 1, 32768);
cat.run("@cf/cheaper-but-rejected", "rejected", "chat", 0.01, 0.01, 1, 262144);
cat.run("@cf/cheaper-but-failed-battery", "passed", "chat", 0.02, 0.02, 0.5, 262144);
cat.run("@cf/free", "in_production", "chat", 0, 0, 1, 262144);
cat.run("@cf/embed", "in_production", "embedding", 0.01, 0, 1, 262144);
cat.run("@cf/mid", "in_production", "chat", 0.6, 2.4, 1, 262144);
// 1,000,000 neurons-worth: 40 USD/M-ish; cur_usd = neurons * 0.000011 -> 3e6 neurons = USD 33
cnt.run(today, "w-a", "binding", "@cf/big", 100, 0, 5_000_000, 1_000_000, 3_000_000);
cnt.run(today, "w-ladder", "ladder", "@cf/big", 100, 0, 5_000_000, 1_000_000, 3_000_000);   // escalation rung: excluded
cnt.run(today, "w-tiny", "binding", "@cf/big", 5, 0, 5_000_000, 1_000_000, 3_000_000);      // under 20 calls: excluded
cnt.run(today, "w-cheapish", "binding", "@cf/mid", 100, 0, 5_000_000, 1_000_000, 60_000);    // alt not 1.8x cheaper than its own cost
cnt.run(today, "w-roll", "ledger-rollup", "@cf/big", 100, 0, 5_000_000, 1_000_000, 3_000_000); // the agent loop's rollup rows count
cnt.run("2020-01-01", "w-old", "binding", "@cf/big", 100, 0, 5_000_000, 1_000_000, 3_000_000); // outside 7 days
const viewSql = /CREATE VIEW IF NOT EXISTS v_spend_governor_plan AS[\s\S]*?FROM pick;/.exec(sql)[0];
db.exec(viewSql);
const rows = db.prepare("SELECT * FROM v_spend_governor_plan ORDER BY worker").all();
const by = Object.fromEntries(rows.map((r) => [r.worker, r]));
ok(Object.keys(by).sort().join(",") === "w-a,w-roll", "only the binding and ledger-rollup rows over the floors qualify", Object.keys(by));
ok(by["w-a"] && by["w-a"].alt_model === "@cf/cheap", "the alternative is the cheapest eligible chat model (not free, not embedding, not rejected, not short-context, not battery-failed)", by["w-a"]);
ok(by["w-a"] && by["w-a"].cur_usd_7d === 33 && by["w-a"].alt_usd_7d === 0.8, "current cost from neurons, alternative from the same token mix at list price", by["w-a"]);
ok(by["w-a"] && Math.abs(by["w-a"].save_usd_day - (33 - 0.8) / 7) < 0.01, "saving per day is (current - alternative) / 7", by["w-a"]);
ok(by["w-a"] && by["w-a"].ab_verdict === null && by["w-a"].action === "queue-ab", "no A/B verdict: queue-ab, never demote");
db.prepare("INSERT INTO model_ab_runs (worker, pre_model, post_model, verdict) VALUES (?,?,?,?)").run("w-a", "@cf/big", "@cf/cheap", "regression");
ok(db.prepare("SELECT action FROM v_spend_governor_plan WHERE worker = 'w-a'").get().action === "queue-ab", "a regression verdict keeps the line in queue-ab");
db.prepare("INSERT INTO model_ab_runs (worker, pre_model, post_model, verdict) VALUES (?,?,?,?)").run("w-a", "@cf/big", "@cf/cheap", "pass");
const a2 = db.prepare("SELECT action, ab_verdict FROM v_spend_governor_plan WHERE worker = 'w-a'").get();
ok(a2.action === "demote" && a2.ab_verdict === "pass", "the latest verdict for the pair decides: a pass makes the line demotable", a2);
db.prepare("INSERT INTO model_ab_runs (worker, pre_model, post_model, verdict) VALUES (?,?,?,?)").run("w-roll", "@cf/other", "@cf/cheap", "pass");
ok(db.prepare("SELECT action FROM v_spend_governor_plan WHERE worker = 'w-roll'").get().action === "queue-ab", "a pass for another pair or another worker does not count");

// the rewritten issue keeps a code-task, an anchor that is the stub line and a code-probe that asks for its absence
ok(/code-task: repo=qnfo-workers path=qnfo-lifecycle\/worker\.js/.test(sql) && /code-anchor: globalThis\.spendGovernor = \{ hourlyRoute: "cheapest" \};/.test(sql), "the issue keeps a code-task and the stub line as its anchor");
ok(/"absent": "globalThis\.spendGovernor"/.test(sql), "the closing code-probe asks for the stub's absence");

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
