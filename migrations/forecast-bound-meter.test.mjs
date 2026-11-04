// FORECAST-BOUND-METER-1 (2026-11-04, pillar cost): v_cost_forecast's bound counts the caps (the code loop by neurons) plus the uncapped remainder read from the Cloudflare meter.
// Replays the old view (the SWEEP-PROBE-FIXES-B text live on 2026-11-04) and the new view on the measured 11-01..03 shape.
// Run: node --no-warnings migrations/forecast-bound-meter.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const read = (f) => readFileSync(new URL("./" + f, import.meta.url), "utf8");
const mig = read("2026-11-04-forecast-bound-meter.sql");
assert.match(mig, /^-- APPLY-BY: ci$/m);
assert.match(mig, /^-- DB: qnfo-audit$/m);
assert.match(mig, /^-- Rollback: /m);
assert.match(mig, /^-- BACKUP: bak_20261104_v_cost_forecast$/m);
assert.match(mig, /^-- CAUSE-MAPPED: /m);
const bare = mig.replace(/^--.*$/gm, "");
assert.equal((bare.match(/^\s*DROP\s+\w+/gmi) || []).map((x) => x.trim()).join(), "DROP VIEW", "the only destructive statement is DROP VIEW of v_cost_forecast");
assert.ok(!/^\s*DELETE\s+FROM\b/mi.test(bare));
assert.match(bare, /CREATE TABLE IF NOT EXISTS bak_20261104_v_cost_forecast AS SELECT name, sql FROM sqlite_master WHERE name = 'v_cost_forecast';[\s\S]*DROP VIEW IF EXISTS v_cost_forecast;/);

// the view as it was before this change
const oldMig = read("2026-10-26-sweep-probe-fixes-b.sql");
const OLD_VIEW = /CREATE VIEW v_cost_forecast AS[\s\S]*?\nFROM [gb](?:, bound)?;/.exec(oldMig.replace(/^--.*$/gm, ""))[0].replace(/;$/, "");

const build = () => {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT, updated_at TEXT);" +
    "CREATE TABLE ai_call_counters (day TEXT, worker TEXT, purpose TEXT, model TEXT, calls INTEGER DEFAULT 0, errors INTEGER DEFAULT 0, neurons REAL DEFAULT 0, PRIMARY KEY (day, worker, purpose, model));" +
    "CREATE TABLE cost_daily (date TEXT NOT NULL, source TEXT NOT NULL, scope TEXT NOT NULL DEFAULT 'fleet', usd REAL NOT NULL DEFAULT 0, requests INTEGER DEFAULT 0, tokens_in INTEGER DEFAULT 0, tokens_out INTEGER DEFAULT 0, note TEXT, updated_at TEXT, PRIMARY KEY (date, source));" +
    "CREATE TABLE ai_meter_model_daily (date TEXT NOT NULL, model TEXT NOT NULL, neurons REAL NOT NULL DEFAULT 0, requests INTEGER NOT NULL DEFAULT 0, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, observed_at TEXT, PRIMARY KEY (date, model));" +
    "CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, formula TEXT);" +
    "CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, surfaces_tested TEXT);"
  );
  const day = (n) => db.prepare("SELECT date('now', ?) d").get("-" + n + " days").d;
  const cfg = db.prepare("INSERT INTO ops_config (key, value) VALUES (?, ?)");
  cfg.run("research_daily_neurons", "360000");
  cfg.run("q08_daily_neurons", "50000");
  cfg.run("code_loop_daily_calls", "10");
  cfg.run("code_loop_daily_neurons", "100000");
  const counter = db.prepare("INSERT INTO ai_call_counters (day, worker, purpose, model, calls, neurons) VALUES (?, ?, 'binding', 'm', ?, ?)");
  const meter = db.prepare("INSERT INTO ai_meter_model_daily (date, model, neurons, requests) VALUES (?, ?, ?, 1)");
  const cost = db.prepare("INSERT INTO cost_daily (date, source, scope, usd) VALUES (?, 'workers_ai', 'fleet', ?)");
  for (let k = 1; k <= 7; k++) {
    counter.run(day(k), "qnfo-research-exec", 450, 400000);
    counter.run(day(k), "qnfo-code-orchestrator", 250, 500000);   // 2,000 neurons a call
    counter.run(day(k), "q08-signal-engine", 100, 50000);
    counter.run(day(k), "qnfo-ai", 100, 10000);                  // the one other counted worker
    cost.run(day(k), 18);
  }
  for (let k = 1; k <= 3; k++) { meter.run(day(k), "@cf/a", 1000000); meter.run(day(k), "@cf/b", 600000); } // 1.6M a day on the meter
  db.exec("INSERT INTO metric_registry (metric, formula) VALUES ('fleet_cost_bound_month_usd', 'old formula')");
  db.exec("CREATE VIEW v_cost_forecast AS" + OLD_VIEW.replace(/^CREATE VIEW v_cost_forecast AS/, ""));
  return db;
};
const fleet = (db) => ({ ...db.prepare("SELECT * FROM v_cost_forecast WHERE scope = 'fleet'").get() });
const cols = (db) => db.prepare("PRAGMA table_info(v_cost_forecast)").all().map((c) => c.name);

// ---- before: the 2026-11-04 behaviour
const db = build();
const before = fleet(db);
const oldCols = cols(db);
assert.equal(oldCols.length, 15);
assert.equal(before.bound_daily_neurons, 360000 + 50000 + 10 * 2000 + 10000, "old bound: caps + 10 calls x 2,000 + 10k of other counters");
assert.ok(before.bound_30d_usd < 160, "old bound reads about USD 150: " + before.bound_30d_usd);

// ---- after
db.exec(mig);
db.exec(mig); // idempotent
const after = fleet(db);
const newCols = cols(db);
assert.deepEqual(newCols.slice(0, 15), oldCols, "the first 15 columns keep their names and order");
assert.equal(newCols[15], "uncapped_daily_neurons");
assert.equal(newCols.length, 16);
assert.equal(after.uncapped_daily_neurons, 1600000 - (400000 + 500000 + 50000), "meter 1.6M minus the capped workers' 950k");
assert.equal(after.bound_daily_neurons, 360000 + 50000 + 100000 + 650000, "caps (code loop by its neuron cap) plus the uncapped remainder from the meter");
const usd = (1160000 - 10000) * 0.011 / 1000;
assert.ok(Math.abs(after.bound_daily_usd - usd) < 1e-3, "bound_daily_usd " + after.bound_daily_usd + " vs " + usd);
assert.ok(Math.abs(after.bound_30d_usd - Math.round(30 * (usd + 0) * 100) / 100) < 0.02, "bound_30d_usd " + after.bound_30d_usd);
assert.ok(after.bound_30d_usd > before.bound_30d_usd * 2, "the honest bound is more than twice the old one on this shape");
assert.equal(after.pace_30d_usd, before.pace_30d_usd, "the pace columns are unchanged");
assert.equal(after.forecast_month_usd, before.forecast_month_usd);
assert.equal(db.prepare("SELECT COUNT(*) n FROM v_cost_forecast").get().n, 1, "only the fleet scope has cost_daily rows in this fixture");

// ---- never below the old figure, and the fallbacks
const noMeter = build(); noMeter.exec(mig); noMeter.exec("DELETE FROM ai_meter_model_daily");
const nm = fleet(noMeter);
assert.equal(nm.uncapped_daily_neurons, 10000, "no meter rows: the old counter-based remainder");
assert.equal(nm.bound_daily_neurons, 360000 + 50000 + 100000 + 10000, "and the code loop is still bound by its neuron cap");
const noKnob = build(); noKnob.exec(mig); noKnob.exec("DELETE FROM ops_config WHERE key = 'code_loop_daily_neurons'; DELETE FROM ai_meter_model_daily");
assert.equal(fleet(noKnob).bound_daily_neurons, before.bound_daily_neurons, "no neuron knob and no meter rows: exactly the old bound");
const over = build(); over.exec(mig); over.exec("UPDATE ai_meter_model_daily SET neurons = 100000");  // meter below the capped counters: the remainder floors at 0, then the counter figure
assert.equal(fleet(over).uncapped_daily_neurons, 10000, "counters above the meter never make the remainder negative");
const oldDay = build(); oldDay.exec(mig); oldDay.exec("UPDATE ai_meter_model_daily SET date = date(date, '-20 days')");
assert.equal(fleet(oldDay).uncapped_daily_neurons, 10000, "meter days older than three days are not read");

// ---- the record
assert.match(db.prepare("SELECT formula FROM metric_registry WHERE metric = 'fleet_cost_bound_month_usd'").get().formula, /code_loop_daily_neurons[\s\S]*Cloudflare meter/);
assert.equal(db.prepare("SELECT COUNT(*) n FROM decision_log WHERE action LIKE 'FORECAST-BOUND-METER-1:%'").get().n, 1, "one decision_log row, written once");
const bak = db.prepare("SELECT name, sql FROM bak_20261104_v_cost_forecast").all();
assert.equal(bak.length, 1);
assert.match(bak[0].sql, /code_calls \* meas\.code_npc \+ meas\.other_n/, "the backup holds the old view text");
assert.ok(!/uncapped_daily_neurons/.test(bak[0].sql));
console.log("forecast-bound-meter: all assertions passed");
