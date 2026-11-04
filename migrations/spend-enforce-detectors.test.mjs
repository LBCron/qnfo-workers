// SPEND-ENFORCE-DETECTORS-1 (2026-11-04, pillar cost): the closing probes of SPEND-ENFORCE-1. Applies the three migrations that make the views
// (2026-11-04-spend-enforce-caps.sql, 2026-11-04-ai-meter-model-daily.sql) and the detector migration to an in-memory qnfo-audit, then runs each
// fm contract's probe against seeded days: a day that holds passes, a day over a budget, over the unattributed line or over the account target fails.
// Run: node --no-warnings migrations/spend-enforce-detectors.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const read = (f) => readFileSync(new URL("./" + f, import.meta.url), "utf8");
const db = new DatabaseSync(":memory:");
db.exec(`
CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT, updated_at TEXT);
CREATE TABLE ai_call_counters (day TEXT, worker TEXT, purpose TEXT, model TEXT, calls INTEGER DEFAULT 0, errors INTEGER DEFAULT 0, in_tok INTEGER DEFAULT 0, out_tok INTEGER DEFAULT 0, neurons REAL DEFAULT 0, PRIMARY KEY (day, worker, purpose, model));
CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT, root_cause TEXT, remediation TEXT, detector TEXT, probe_class TEXT, first_seen TEXT, trigger_condition TEXT, symptom TEXT, blast_radius TEXT);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER, expected_cadence_h INTEGER, status TEXT, precondition TEXT, action TEXT, escalate_to TEXT, module TEXT, next_due_at TEXT);
CREATE TABLE capability_ledger (capability TEXT PRIMARY KEY, provenance TEXT, prerequisites TEXT, reliability REAL, acquired_at TEXT, evidence TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT DEFAULT (datetime('now')), actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT, outcome_matched INTEGER);
`);
db.exec(read("2026-11-04-spend-enforce-caps.sql"));
db.exec(read("2026-11-04-ai-meter-model-daily.sql"));
const mig = read("2026-11-04-spend-enforce-detectors.sql");
assert.match(mig, /-- APPLY-BY: ci/);
assert.match(mig, /-- DB: qnfo-audit/);
assert.match(mig, /-- Rollback: /);
db.exec(mig);
db.exec(mig); // idempotent
const one = (s, ...p) => db.prepare(s).get(...p);
assert.equal(one("SELECT COUNT(*) n FROM failure_modes WHERE fm_key IN ('spend-cap-overshoot','ai-spend-unattributed','ai-account-over-target')").n, 3);
assert.equal(one("SELECT COUNT(*) n FROM remediation_contracts WHERE class LIKE 'fm-%' AND status = 'active' AND verify_transport = 'd1-query'").n, 3);
assert.equal(one("SELECT COUNT(*) n FROM decision_log WHERE action LIKE 'SPEND-ENFORCE-DETECTORS-1:%'").n, 1, "one decision_log row, not two on replay");
assert.ok(one("SELECT 1 x FROM capability_ledger WHERE capability = 'ai-meter-by-model'"));
for (const { verify_probe: p } of db.prepare("SELECT verify_probe FROM remediation_contracts WHERE class LIKE 'fm-%'").all()) {
  assert.ok(/^SELECT '0' AS expected, CAST\(COUNT\(\*\) AS TEXT\) AS observed FROM v_/.test(p), "a literal read-only SELECT with expected and observed columns");
  assert.ok(!/\b(insert|update|delete|drop|alter|create|attach|replace|pragma)\b/i.test(p), "no write keyword in a probe (the runners' guard scans literals too)");
}
db.prepare("UPDATE ops_config SET value = '2000-01-01' WHERE key = 'spend_enforce_first_day'").run(); // the fixtures use the real calendar, which may precede the production start day
assert.ok(one("SELECT 1 x FROM ops_config WHERE key = 'spend_enforce_first_day'"));
const probe = (cls) => one(db.prepare("SELECT verify_probe FROM remediation_contracts WHERE class = ?").get(cls).verify_probe);
const day = (n) => one("SELECT date('now', ?) d", "-" + n + " days").d;
const yday = day(1);
// the probes only look at complete days from 2026-11-05 on; a real run in 2026 is always past it, so these fixtures use the real calendar

// ---- nothing recorded yet: all three read 0 (no complete day to judge) ----
for (const c of ["fm-spend-cap-overshoot", "fm-ai-spend-unattributed", "fm-ai-account-over-target"]) assert.deepEqual({ ...probe(c) }, { expected: "0", observed: "0" }, c + " has no day to judge");

// ---- a holding day: budgets respected, meter explained, account under target ----
const meter = db.prepare("INSERT INTO ai_meter_model_daily (date, model, neurons, requests) VALUES (?,?,?,?)");
const counter = db.prepare("INSERT INTO ai_call_counters (day, worker, purpose, model, calls, neurons) VALUES (?,?,?,?,?,?)");
meter.run(yday, "@cf/openai/gpt-oss-120b", 500000, 3000);
meter.run(yday, "@cf/zai-org/glm-5.3-flash", 100000, 1000);
counter.run(yday, "qnfo-research-exec", "binding", "@cf/openai/gpt-oss-120b", 2000, 330000);
counter.run(yday, "qnfo-code-orchestrator", "ladder", "@cf/openai/gpt-oss-120b", 300, 100000);
counter.run(yday, "q08-signal-engine", "binding", "@cf/zai-org/glm-5.3-flash", 90, 50000);
counter.run(yday, "qnfo-agents", "binding", "@cf/openai/gpt-oss-120b", 100, 90000);
const rows = db.prepare("SELECT scope, pct_of_budget FROM v_spend_enforcement WHERE day = ? ORDER BY scope").all(yday).map((r) => ({ ...r }));
assert.deepEqual(rows.map((r) => r.scope), ["code-loop", "q08", "research"], rows);
assert.equal(one("SELECT unattributed_neurons u, neurons n, pct_of_target p FROM v_ai_meter_daily WHERE date = ?", yday).n, 600000);
for (const c of ["fm-spend-cap-overshoot", "fm-ai-spend-unattributed", "fm-ai-account-over-target"]) assert.deepEqual({ ...probe(c) }, { expected: "0", observed: "0" }, c + " passes on a holding day");

// ---- overshoot: research at 140 percent of its 360k budget ----
counter.run(yday, "qnfo-research-exec", "binding", "@cf/moonshotai/kimi-k2.6", 100, 174000);
assert.deepEqual({ ...probe("fm-spend-cap-overshoot") }, { expected: "0", observed: "1" }, "research at 140 percent fails the overshoot contract");
db.prepare("DELETE FROM ai_call_counters WHERE model = '@cf/moonshotai/kimi-k2.6'").run();
assert.equal(probe("fm-spend-cap-overshoot").observed, "0");
// a budget set to off or 0 divides to NULL and is never an overshoot
db.prepare("UPDATE ops_config SET value = 'off' WHERE key = 'code_loop_daily_neurons'").run();
counter.run(yday, "qnfo-code-orchestrator", "ladder", "@cf/moonshotai/kimi-k2.7-code", 10, 900000);
assert.equal(probe("fm-spend-cap-overshoot").observed, "0", "a disabled budget cannot be exceeded");
db.prepare("DELETE FROM ai_call_counters WHERE model = '@cf/moonshotai/kimi-k2.7-code'").run();

// ---- unattributed: the meter holds 2.5M neurons the counters never saw (the 11-02 shape) ----
meter.run(yday, "@cf/deepseek-ai/deepseek-v4.1-flash-1017", 1100000, 6000);
assert.deepEqual({ ...probe("fm-ai-spend-unattributed") }, { expected: "0", observed: "1" }, "a day with over 40 percent of the meter in no counter fails");
// ---- account over target: 1.7M neurons against 800k ----
assert.deepEqual({ ...probe("fm-ai-account-over-target") }, { expected: "0", observed: "1" }, "1.7M neurons against 800k fails");
db.prepare("UPDATE ops_config SET value = '2000000' WHERE key = 'ai_account_daily_neurons'").run();
assert.equal(probe("fm-ai-account-over-target").observed, "0", "the target is an ops_config knob");

// ---- today is never judged (not a complete day) and 2026-11-04 and earlier is outside the probes' start ----
db.prepare("DELETE FROM ai_meter_model_daily").run();
meter.run(day(0), "@cf/openai/gpt-oss-120b", 5000000, 100);
assert.equal(probe("fm-ai-account-over-target").observed, "0", "today is not a complete day");
console.log("spend-enforce-detectors: all assertions passed");
