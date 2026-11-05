// Offline test for migrations/2026-11-05-c6-s1-cost-views.sql (C6-S1: cache-aware pricing table, five cost views, the hourly ledger rollup).
// Applies the file to an in-memory database with stand-ins for the tables it reads, runs the workflow step exactly as stored in fleet_tasks,
// and checks the numbers by hand: cache-aware neurons, idempotence (the rollup overwrites, never adds), the views and the roadmap rows.
// Run: node migrations/c6-s1-cost-views.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("./2026-11-05-c6-s1-cost-views.sql", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d))); } };
const near = (a, b, tol = 0.5) => Math.abs(Number(a) - Number(b)) <= tol;

const T0 = Date.now(); // one clock for every value below
const day = new Date(T0).toISOString().slice(0, 10);
const yday = new Date(T0 - 86400000).toISOString().slice(0, 10);

const db = new DatabaseSync(":memory:");
db.exec(`
CREATE TABLE ai_spend_ledger (day TEXT NOT NULL, provider TEXT NOT NULL, caller TEXT NOT NULL, model TEXT NOT NULL, calls INTEGER DEFAULT 0, in_tok INTEGER DEFAULT 0, out_tok INTEGER DEFAULT 0, usd REAL DEFAULT 0, downgraded INTEGER DEFAULT 0, refused INTEGER DEFAULT 0, cached_tok INTEGER DEFAULT 0, PRIMARY KEY (day, provider, caller, model));
CREATE TABLE ai_call_counters (day TEXT, worker TEXT, purpose TEXT, model TEXT, calls INTEGER DEFAULT 0, errors INTEGER DEFAULT 0, in_chars INTEGER DEFAULT 0, ms INTEGER DEFAULT 0, in_tok INTEGER DEFAULT 0, out_tok INTEGER DEFAULT 0, neurons REAL DEFAULT 0, PRIMARY KEY (day, worker, purpose, model));
CREATE TABLE ai_cache_counters (day TEXT, worker TEXT, model TEXT, calls INTEGER DEFAULT 0, cached_calls INTEGER DEFAULT 0, in_tok INTEGER DEFAULT 0, cached_tok INTEGER DEFAULT 0, PRIMARY KEY (day, worker, model));
CREATE TABLE code_tasks (id TEXT PRIMARY KEY, status TEXT, model TEXT, merged_at TEXT);
CREATE TABLE research_queue (id TEXT PRIMARY KEY, published_at TEXT);
CREATE TABLE cf_agent_runs (id TEXT PRIMARY KEY, status TEXT, created_ms INTEGER);
CREATE TABLE cost_router_metrics (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, worker TEXT, task_class TEXT, cost_usd REAL DEFAULT 0, success INTEGER DEFAULT 1);
CREATE TABLE fleet_tasks (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, definition TEXT NOT NULL, timeout_ms INTEGER NOT NULL DEFAULT 30000, retries INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 1, enabled INTEGER NOT NULL DEFAULT 1, updated_at TEXT);
CREATE TABLE fleet_crons (name TEXT PRIMARY KEY, cron_expr TEXT, task_id TEXT, enabled INTEGER, timezone TEXT, updated_at TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT, outcome_matched INTEGER);
CREATE TABLE roadmap_implementation (id INTEGER PRIMARY KEY AUTOINCREMENT, item TEXT NOT NULL, source TEXT NOT NULL, title TEXT NOT NULL, artifact_type TEXT NOT NULL, artifact_ref TEXT, status TEXT NOT NULL, evidence TEXT, verified_at TEXT, created_at TEXT);
INSERT INTO roadmap_implementation (id, item, source, title, artifact_type, status) VALUES
  (14, 'RM-COST-PREFIX-CACHE-1', 'routing_policy CTX PARTIAL (cache_read_tokens=0)', 't', 'cost', 'partial'),
  (16, 'RM-COST-UNIFIED-SPEND-1', 'goals external-impact-per-dollar DoD (a)', 't', 'cost', 'partial'),
  (122, 'RM-COST-FLOOR-40-1', 'docs/BUSINESS-PLAN.md Phase A', 't', 'cost', 'not-built');
`);

// the qnfo-agents loop, as in the live ledger on 2026-11-04: 40.58M input, 10.15M of them cached, 1.01M output
const IN = 40575348, CACHED = 10153600, OUT = 1011911;
db.prepare("INSERT INTO ai_spend_ledger (day, provider, caller, model, calls, in_tok, out_tok, usd, cached_tok) VALUES (?,?,?,?,?,?,?,?,?)").run(day, "workers-ai", "qnfo-agents", "dynamic/standard", 1824, IN, OUT, 12.09, CACHED);
db.prepare("INSERT INTO ai_spend_ledger (day, provider, caller, model, calls, in_tok, out_tok, usd, cached_tok) VALUES (?,?,?,?,?,?,?,?,?)").run(yday, "workers-ai", "qnfo-agents", "dynamic/standard", 100, 1000000, 10000, 0.4, 0);
db.prepare("INSERT INTO ai_spend_ledger (day, provider, caller, model, calls, in_tok, out_tok, usd, cached_tok) VALUES (?,?,?,?,?,?,?,?,?)").run(day, "workers-ai", "qnfo-research-exec", "@cf/zai-org/glm-5.3-flash", 10, 1000000, 100000, 1, 400000);
db.prepare("INSERT INTO ai_spend_ledger (day, provider, caller, model, calls, in_tok, out_tok, usd, cached_tok) VALUES (?,?,?,?,?,?,?,?,?)").run(day, "gateway", "qnfo-ops", "gpt-x", 1, 100, 10, 1, 0);

db.exec(sql);
const afterFirst = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master").get().n;
db.exec(sql); // re-applying changes nothing it should not
ok(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master").get().n === afterFirst, "re-applying the file creates no second object");

// 1. the price table carries the published rates
const price = db.prepare("SELECT price_in, price_out, price_cached FROM cf_model_cached_price WHERE model_id = '@cf/deepseek-ai/deepseek-v4.1-flash-1017'").get();
ok(price && price.price_in === 0.30 && price.price_cached === 0.006 && price.price_out === 1.20, "deepseek-v4.1-flash-1017 rates as published", price);
const noDiscount = db.prepare("SELECT price_in = price_cached AS same FROM cf_model_cached_price WHERE model_id = '@cf/openai/gpt-oss-120b'").get();
ok(noDiscount && noDiscount.same === 1, "gpt-oss-120b has no published cached rate, so cached tokens are priced as input");

// 2. the stored workflow runs and prices cache-aware
const task = db.prepare("SELECT definition, enabled FROM fleet_tasks WHERE id = 'ai-ledger-rollup'").get();
ok(task && task.enabled === 1, "the rollup task is stored and enabled");
const steps = JSON.parse(task.definition).steps;
ok(steps.length === 1 && steps[0].type === "sql" && steps[0].db === "AUDIT", "one sql step against AUDIT", steps.map((s) => s.type));
const cron = db.prepare("SELECT cron_expr, task_id, enabled FROM fleet_crons WHERE name = 'ai-ledger-rollup-hourly'").get();
ok(cron && cron.cron_expr === "25 * * * *" && cron.task_id === "ai-ledger-rollup" && cron.enabled === 1, "hourly at :25", cron);
ok(!/\b(DELETE|DROP)\b/i.test(steps[0].sql) && !/\bUPDATE\s+\w+\s+SET\b/i.test(steps[0].sql) && /^INSERT INTO ai_call_counters/.test(steps[0].sql), "the workflow step only upserts counter rows (no DELETE, DROP or plain UPDATE)");

const run = () => db.exec(steps[0].sql);
run();
const row = db.prepare("SELECT * FROM ai_call_counters WHERE worker = 'qnfo-agents' AND day = ?").get(day);
const expected = ((IN - CACHED) * 0.30 + CACHED * 0.006 + OUT * 1.20) / 11;
ok(row && row.purpose === "ledger-rollup" && row.model === "@cf/deepseek-ai/deepseek-v4.1-flash-1017", "the dynamic route is booked on the model it resolved to", row);
ok(row && near(row.neurons, expected, 1), "neurons = (uncached x 0.30 + cached x 0.006 + out x 1.20) / 11 per million tokens", { got: row && row.neurons, expected });
ok(row && row.calls === 1824 && row.in_tok === IN && row.out_tok === OUT, "calls and tokens carried over", row);
const without = (IN * 0.30 + OUT * 1.20) / 11;
ok(row && row.neurons < without, "the cache lowers the neurons against full input pricing", { cache: row && row.neurons, full: without });
const y = db.prepare("SELECT neurons FROM ai_call_counters WHERE worker = 'qnfo-agents' AND day = ?").get(yday);
ok(y && near(y.neurons, (1000000 * 0.30 + 10000 * 1.20) / 11, 1), "yesterday is rolled up too (it settles after midnight)", y);
ok(db.prepare("SELECT COUNT(*) AS n FROM ai_call_counters WHERE worker <> 'qnfo-agents'").get().n === 0, "only the qnfo-agents caller is written (research-exec and the gateway caller are not)");

run(); run();
const again = db.prepare("SELECT neurons, calls FROM ai_call_counters WHERE worker = 'qnfo-agents' AND day = ?").get(day);
ok(near(again.neurons, row.neurons, 0.001) && again.calls === 1824, "running it again overwrites, it never adds", { first: row.neurons, again: again.neurons });
db.prepare("UPDATE ai_spend_ledger SET in_tok = in_tok + 1000000, cached_tok = cached_tok + 1000000, calls = calls + 5 WHERE day = ? AND caller = 'qnfo-agents'").run(day);
run();
const grown = db.prepare("SELECT neurons, calls FROM ai_call_counters WHERE worker = 'qnfo-agents' AND day = ?").get(day);
ok(grown.calls === 1829 && near(grown.neurons - row.neurons, 1000000 * 0.006 / 11, 1), "a growing ledger row moves the counter by the cached-rate delta", { was: row.neurons, now: grown.neurons });

// 3. the views
const fx = db.prepare("SELECT * FROM v_prefix_cache_effect WHERE caller = 'qnfo-research-exec'").get();
ok(fx && fx.cached_share_pct === 40 && near(fx.saved_by_cache_usd, 400000 * (0.15 - 0.03) / 1e6, 0.001), "v_prefix_cache_effect: share and saving for glm-5.3-flash", fx);
ok(fx && near(fx.usd_cache_aware, (600000 * 0.15 + 400000 * 0.03 + 100000 * 0.50) / 1e6, 0.001), "v_prefix_cache_effect: cache-aware dollars", fx);
const ag = db.prepare("SELECT priced_as, ledger_usd FROM v_prefix_cache_effect WHERE caller = 'qnfo-agents' AND day = ?").get(day);
ok(ag && ag.priced_as === "@cf/deepseek-ai/deepseek-v4.1-flash-1017" && ag.ledger_usd === 12.09, "the ledger usd column is shown untouched next to the cache-aware figure", ag);
ok(db.prepare("SELECT COUNT(*) AS n FROM v_prefix_cache_effect WHERE caller = 'qnfo-ops'").get().n === 0, "a gateway-provider row is not a Workers AI row");

db.prepare("INSERT INTO ai_cache_counters (day, worker, model, calls, cached_calls, in_tok, cached_tok) VALUES (?, 'qnfo-research-exec', '@cf/zai-org/glm-5.3-flash', 100, 40, 2000000, 500000)").run(day);
const sh = db.prepare("SELECT * FROM v_prefix_cache_share WHERE worker = 'qnfo-research-exec'").get();
ok(sh && sh.cached_share_pct === 25 && near(sh.saved_usd, 500000 * 0.12 / 1e6, 0.001), "v_prefix_cache_share", sh);

// cost per task class
db.prepare("INSERT INTO ai_call_counters (day, worker, purpose, model, calls, neurons) VALUES (?, 'qnfo-code-orchestrator', 'ladder', '@cf/openai/gpt-oss-120b', 10, 50000)").run(day);
db.prepare("INSERT INTO ai_call_counters (day, worker, purpose, model, calls, neurons) VALUES (?, 'qnfo-code-orchestrator', 'ladder', '@cf/zai-org/glm-5.3', 4, 100000)").run(day);
const mergedAt = new Date(T0).toISOString();
for (let i = 0; i < 3; i++) db.prepare("INSERT INTO code_tasks (id, status, model, merged_at) VALUES (?, 'merged', '@cf/openai/gpt-oss-120b', ?)").run("a" + i, mergedAt);
db.prepare("INSERT INTO code_tasks (id, status, model, merged_at) VALUES ('b0', 'merged', '@cf/zai-org/glm-5.3', ?)").run(mergedAt);
db.prepare("INSERT INTO code_tasks (id, status, model, merged_at) VALUES ('f0', 'failed', '@cf/zai-org/glm-5.3', ?)").run(mergedAt);
db.prepare("INSERT INTO ai_call_counters (day, worker, purpose, model, calls, neurons) VALUES (?, 'qnfo-research-exec', 'binding:review', '@cf/zai-org/glm-5.3-flash', 10, 100000)").run(day);
db.prepare("INSERT INTO ai_call_counters (day, worker, purpose, model, calls, neurons) VALUES (?, 'errata-hub', 'binding', '@cf/zai-org/glm-5.3-flash', 10, 20000)").run(day);
db.prepare("INSERT INTO research_queue (id, published_at) VALUES ('p1', ?), ('p2', ?)").run(mergedAt, mergedAt);
db.prepare("INSERT INTO cf_agent_runs (id, status, created_ms) VALUES ('r1', 'done', ?), ('r2', 'done', ?), ('r3', 'failed', ?)").run(T0, T0, T0);
db.prepare("INSERT INTO cost_router_metrics (ts, worker, task_class, cost_usd, success) VALUES (?, 'qnfo-ops', 'chat', 0.2, 1), (?, 'qnfo-ops', 'chat', 0.1, 1), (?, 'qnfo-ops', 'chat', 0, 0)").run(mergedAt, mergedAt, mergedAt);

const cp = (path) => db.prepare("SELECT * FROM v_cost_per_task_class WHERE path = ? AND day = ?").get(path, day);
const code = cp("code-loop");
ok(code && code.ok_tasks === 4 && near(code.usd, 150000 * 0.000011, 0.0005) && near(code.usd_per_ok_task, 150000 * 0.000011 / 4, 0.001), "code loop: USD per merged PR counts merged tasks only", code);
const res = cp("research");
ok(res && res.ok_tasks === 2 && near(res.usd, 120000 * 0.000011, 0.0005), "research: three workers' neurons over papers published", res);
const agents = cp("agents");
ok(agents && agents.ok_tasks === 2, "agents: runs done, a failed run is not a success", agents);
const ops = db.prepare("SELECT * FROM v_cost_per_task_class WHERE path = 'qnfo-ops-router' AND task_class = 'chat'").get();
ok(ops && ops.ok_tasks === 2 && near(ops.usd, 0.3, 0.001), "router path: dollars over successful tasks", ops);

db.prepare("INSERT INTO ai_call_counters (day, worker, purpose, model, calls, neurons) VALUES (?, 'q08-signal-engine', 'binding', '@cf/moonshotai/kimi-k2.6', 7, 90000)").run(day);
const other = db.prepare("SELECT * FROM v_cost_per_task_class WHERE path = 'q08-signal-engine' AND day = ?").get(day);
ok(other && other.ok_tasks === null && other.usd_per_ok_task === null && near(other.usd, 90000 * 0.000011, 0.0005), "every other counted worker is listed with its dollars and no per-task figure", other);
ok(!db.prepare("SELECT COUNT(*) AS n FROM v_cost_per_task_class WHERE path IN ('errata-hub', 'qnfo-paper-reviser')").get().n, "the research trio is one path, not three");

const rung = db.prepare("SELECT * FROM v_ladder_rung_outcomes WHERE day = ? AND rung_model = '@cf/openai/gpt-oss-120b'").get(day);
ok(rung && rung.merged_at_rung === 3 && rung.share_of_day_merges_pct === 75 && rung.ladder_calls === 10, "ladder rung: 3 of 4 merges at the cheap rung", rung);
ok(rung && near(rung.usd_per_merge_at_rung, 50000 * 0.000011 / 3, 0.001), "ladder rung: dollars per merge at that rung", rung);

db.prepare("INSERT INTO ai_call_counters (day, worker, purpose, model, calls, errors, neurons, in_tok, out_tok) VALUES (?, 'qnfo-research-exec', 'binding:verify', '@cf/zai-org/glm-5.3-flash', 140, 7, 70000, 140000, 14000)").run(day);
db.prepare("INSERT INTO ai_call_counters (day, worker, purpose, model, calls, neurons) VALUES (?, 'qnfo-x', 'rare', 'm', 3, 999999)").run(day);
const dc = db.prepare("SELECT * FROM v_distill_candidates").all();
ok(dc.length >= 1 && dc[0].purpose === 'binding:verify' && dc[0].error_pct === 5 && dc[0].avg_in_tok === 1000, "distillation candidates: recurring classes only, ranked by spend", dc[0]);
ok(!dc.some((r) => r.purpose === "rare" || r.purpose === "ledger-rollup"), "a class under 50 calls and the rollup rows are not candidates");

// 4. roadmap rows
const rm = (id) => db.prepare("SELECT status, evidence FROM roadmap_implementation WHERE id = ?").get(id);
ok(rm(16).status === "verified" && /1601\.13/.test(rm(16).evidence), "row 16 verified with the live figures");
ok(rm(122).status === "retired" && /1001769/.test(rm(122).evidence), "row 122 retired, names the surviving issue");
ok(rm(14).status === "verified" && /ai_cache_counters/.test(rm(14).evidence), "row 14 verified with the cache counters");
ok(db.prepare("SELECT COUNT(*) AS n FROM decision_log WHERE actor = 'session:c6-s1'").get().n === 1, "one decision_log row, not one per apply");

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
