// AI-SPEND-ROLLUP-1 (2026-11-04, pillar cost): one table of where the Workers AI neurons go. Replays the measured 2026-11-03 shape (Cloudflare meter
// 3.56M neurons against 1.48M in ai_call_counters; deepseek-v4.1-flash-1017 1.09M metered and never counted) through v_ai_spend_rollup.
// Run: node --no-warnings migrations/ai-spend-rollup.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const read = (f) => readFileSync(new URL("./" + f, import.meta.url), "utf8");
const mig = read("2026-11-04-ai-spend-rollup.sql");
assert.match(mig, /-- APPLY-BY: ci/);
assert.match(mig, /-- DB: qnfo-audit/);
assert.match(mig, /-- Rollback: /);
const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT, updated_at TEXT);" +
  "CREATE TABLE ai_call_counters (day TEXT, worker TEXT, purpose TEXT, model TEXT, calls INTEGER DEFAULT 0, errors INTEGER DEFAULT 0, in_tok INTEGER DEFAULT 0, out_tok INTEGER DEFAULT 0, neurons REAL DEFAULT 0, PRIMARY KEY (day, worker, purpose, model));");
db.exec(read("2026-11-04-ai-meter-model-daily.sql"));
db.exec(mig);
db.exec(mig); // idempotent
const day = (n) => db.prepare("SELECT date('now', ?) d").get("-" + n + " days").d;
const d1 = day(1), d2 = day(2), old = day(30);
const meter = db.prepare("INSERT INTO ai_meter_model_daily (date, model, neurons, requests) VALUES (?,?,?,?)");
const counter = db.prepare("INSERT INTO ai_call_counters (day, worker, purpose, model, calls, neurons) VALUES (?,?,?,?,?,?)");
// d1: the 11-03 shape, scaled to round numbers
meter.run(d1, "@cf/deepseek-ai/deepseek-v4.1-flash-1017", 1100000, 6000);
meter.run(d1, "@cf/openai/gpt-oss-120b", 700000, 3500);
meter.run(d1, "@cf/moonshotai/kimi-k2.6", 400000, 1400);
meter.run(d1, "@cf/zai-org/glm-5.3-flash", 400000, 1600);
meter.run(d1, "@cf/moonshotai/kimi-k2.7-code", 500000, 400);
counter.run(d1, "qnfo-research-exec", "binding", "@cf/openai/gpt-oss-120b", 450, 400000);
counter.run(d1, "errata-hub", "binding", "@cf/zai-org/glm-5.3-flash", 80, 20000);
counter.run(d1, "qnfo-paper-reviser", "binding", "@cf/zai-org/glm-5.3-flash", 70, 85000);
counter.run(d1, "qnfo-code-orchestrator", "ladder", "@cf/openai/gpt-oss-120b", 270, 250000);
counter.run(d1, "q08-signal-engine", "binding", "@cf/moonshotai/kimi-k2.6", 100, 110000);
counter.run(d1, "qnfo-ai", "binding", "@cf/openai/gpt-oss-120b", 150, 40000);
counter.run(d1, "qnfo-ops", "binding", "@cf/zai-org/glm-5.3-flash", 60, 20000);
counter.run(d1, "qnfo-ai", "binding", "dynamic/premium", 600, 0); // a gateway route: counted calls, no neurons
// d2: counters exceed the meter (failed calls are counted at the input estimate, the meter bills only what ran)
meter.run(d2, "@cf/openai/gpt-oss-120b", 100000, 500);
counter.run(d2, "qnfo-research-exec", "binding", "@cf/openai/gpt-oss-120b", 50, 130000);
// out of the window
meter.run(old, "@cf/openai/gpt-oss-120b", 9999999, 1);

const rows = db.prepare("SELECT bucket, neurons, pct_of_meter, usd FROM v_ai_spend_rollup WHERE date = ? ORDER BY neurons DESC").all(d1).map((r) => ({ ...r }));
const by = Object.fromEntries(rows.map((r) => [r.bucket, r]));
assert.deepEqual(rows.map((r) => r.bucket).sort(), ["code-loop", "other-counted", "q08", "qnfo-agents", "research", "total", "unattributed"].sort(), "seven rows a day");
assert.equal(by.total.neurons, 3100000, "total is the Cloudflare meter");
assert.equal(by.research.neurons, 505000);
assert.equal(by["code-loop"].neurons, 250000);
assert.equal(by.q08.neurons, 110000);
assert.equal(by["other-counted"].neurons, 60000, "the gateway route row adds nothing");
assert.equal(by["qnfo-agents"].neurons, 1100000, "the meter's deepseek-v4.1-flash-1017 neurons, none of which any worker counted");
assert.equal(by.unattributed.neurons, 3100000 - (505000 + 250000 + 110000 + 60000 + 1100000), "the rest of the meter");
const parts = ["research", "code-loop", "q08", "other-counted", "qnfo-agents", "unattributed"].reduce((a, b) => a + by[b].neurons, 0);
assert.equal(parts, by.total.neurons, "the buckets add up to the meter when the counters are below it");
assert.equal(by.total.pct_of_meter, 100);
assert.equal(by["qnfo-agents"].pct_of_meter, Math.round(1100000 / 3100000 * 1000) / 10);
assert.equal(by.total.usd, Math.round(3100000 / 1000 * 0.011 * 100) / 100);

// a counted deepseek-v4.1 row is not counted twice
counter.run(d1, "qnfo-agents", "binding", "@cf/deepseek-ai/deepseek-v4.1-flash-1017", 10, 50000);
const again = Object.fromEntries(db.prepare("SELECT bucket, neurons FROM v_ai_spend_rollup WHERE date = ?").all(d1).map((r) => [r.bucket, r.neurons]));
assert.equal(again["qnfo-agents"], 1050000, "metered minus counted for that model");
assert.equal(again["other-counted"], 110000, "the new counter row is other-counted (a worker the view does not name)");
assert.equal(again.unattributed, 3100000 - (505000 + 250000 + 110000 + 110000 + 1050000), "and the remainder moves with it");

// counters above the meter: unattributed floors at 0 and the buckets may exceed the total; the view never shows a negative
const r2 = Object.fromEntries(db.prepare("SELECT bucket, neurons FROM v_ai_spend_rollup WHERE date = ?").all(d2).map((r) => [r.bucket, r.neurons]));
assert.equal(r2.total, 100000);
assert.equal(r2.research, 130000);
assert.equal(r2.unattributed, 0, "never negative");
assert.equal(db.prepare("SELECT COUNT(*) n FROM v_ai_spend_rollup WHERE date = ?").get(old).n, 0, "days past the window are not listed");
assert.equal(db.prepare("SELECT COUNT(*) n FROM v_ai_spend_rollup WHERE neurons < 0").get().n, 0);
console.log("ai-spend-rollup: all assertions passed");
