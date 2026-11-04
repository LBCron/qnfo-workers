// AI-METER-MODEL-1 (2026-11-04, pillar cost): the Cloudflare Workers AI meter by model and day, read against the per-worker counters.
// Replays the measured 2026-11-03 numbers (GraphQL aiInferenceAdaptiveGroups against ai_call_counters) through the migration's views and shows
// the unattributed spend is a SELECT away: deepseek-v4.1-flash-1017 has meter neurons and no counter rows at all.
// Run: node --no-warnings migrations/ai-meter-model-daily.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const mig = readFileSync(new URL("./2026-11-04-ai-meter-model-daily.sql", import.meta.url), "utf8");
assert.match(mig, /-- APPLY-BY: ci/);
assert.match(mig, /-- DB: qnfo-audit/);
assert.match(mig, /-- Rollback: /);
const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT, updated_at TEXT);" +
  "CREATE TABLE ai_call_counters (day TEXT, worker TEXT, purpose TEXT, model TEXT, calls INTEGER DEFAULT 0, errors INTEGER DEFAULT 0, in_tok INTEGER DEFAULT 0, out_tok INTEGER DEFAULT 0, neurons REAL DEFAULT 0, PRIMARY KEY (day, worker, purpose, model));");
db.exec(mig);
db.exec(mig); // idempotent: IF NOT EXISTS / OR IGNORE
const today = db.prepare("SELECT date('now') d").get().d;
const yday = db.prepare("SELECT date('now', '-1 day') d").get().d;
const old = db.prepare("SELECT date('now', '-30 days') d").get().d;
const meter = db.prepare("INSERT INTO ai_meter_model_daily (date, model, neurons, requests, input_tokens, output_tokens) VALUES (?,?,?,?,?,?)");
const counter = db.prepare("INSERT INTO ai_call_counters (day, worker, purpose, model, calls, neurons) VALUES (?,?,?,?,?,?)");
// 2026-11-03 shaped day: GraphQL meter by model (11-01..03 totals scaled to one day) vs the counters
meter.run(yday, "@cf/deepseek-ai/deepseek-v4.1-flash-1017", 1088000, 6287, 49000000, 800000);
meter.run(yday, "@cf/openai/gpt-oss-120b", 668000, 3513, 7000000, 2000000);
meter.run(yday, "@cf/moonshotai/kimi-k2.6", 412000, 1438, 2000000, 300000);
meter.run(yday, "@cf/zai-org/glm-5.3-flash", 419000, 1619, 14000000, 3000000);
meter.run(old, "@cf/openai/gpt-oss-120b", 999999, 1, 1, 1); // outside the 10-day window
counter.run(yday, "qnfo-research-exec", "binding:revise", "@cf/openai/gpt-oss-120b", 454, 406848);
counter.run(yday, "qnfo-code-orchestrator", "ladder", "@cf/openai/gpt-oss-120b", 269, 50243);
counter.run(yday, "qnfo-research-exec", "binding:review", "@cf/zai-org/glm-5.3-flash", 1327, 589691);
counter.run(yday, "qnfo-ai", "binding", "dynamic/premium", 600, 0); // a gateway route is not a meter model
counter.run(yday, "qnfo-research-exec", "binding", "@cf/moonshotai/kimi-k2.6", 12, 9000);

const rows = db.prepare("SELECT * FROM v_ai_meter_vs_counters WHERE date = ? ORDER BY unattributed_neurons DESC").all(yday);
assert.equal(rows.length, 4, "one row per metered model for the day; the 30-day-old meter row is not in the view's counters window");
assert.equal(rows[0].model, "@cf/deepseek-ai/deepseek-v4.1-flash-1017", "the largest unattributed model comes first");
assert.equal(rows[0].counter_neurons, 0);
assert.equal(rows[0].attributed_pct, 0);
assert.equal(rows[0].unattributed_neurons, 1088000);
const oss = rows.find((r) => r.model === "@cf/openai/gpt-oss-120b");
assert.equal(oss.counter_neurons, 457091, "counters of several workers and purposes sum per model");
assert.equal(oss.counter_calls, 723);
assert.equal(oss.unattributed_neurons, 668000 - 457091);
assert.ok(oss.attributed_pct > 68 && oss.attributed_pct < 69);
const flash = rows.find((r) => r.model === "@cf/zai-org/glm-5.3-flash");
assert.ok(flash.unattributed_neurons < 0 && flash.attributed_pct > 100, "counters can exceed the meter (failed calls are counted at the input estimate; the meter bills only what ran)");
const k = rows.find((r) => r.model === "@cf/moonshotai/kimi-k2.6");
assert.equal(k.unattributed_neurons, 403000);

const day = db.prepare("SELECT * FROM v_ai_meter_daily WHERE date = ?").get(yday);
assert.equal(day.neurons, 1088000 + 668000 + 412000 + 419000);
assert.equal(day.requests, 6287 + 3513 + 1438 + 1619);
assert.equal(day.target_neurons, 800000);
assert.equal(day.pct_of_target, Math.round(day.neurons / 800000 * 1000) / 10);
assert.equal(day.usd, Math.round((day.neurons - 10000) / 1000 * 0.011 * 100) / 100, "list price after the 10k free neurons");
assert.equal(day.unattributed_neurons, day.neurons - (406848 + 50243 + 589691 + 9000));
assert.equal(db.prepare("SELECT COUNT(*) n FROM v_ai_meter_daily WHERE date = ?").get(old).n, 0, "days past the 10-day window are not listed");

db.prepare("UPDATE ops_config SET value = '400000' WHERE key = 'ai_account_daily_neurons'").run();
assert.equal(db.prepare("SELECT target_neurons FROM v_ai_meter_daily WHERE date = ?").get(yday).target_neurons, 400000, "the target is an ops_config knob");
assert.equal(db.prepare("SELECT COUNT(*) n FROM v_ai_meter_daily WHERE date = ?").get(today).n, 0, "a day with no meter rows has no row");
console.log("ai-meter-model-daily: all assertions passed");
