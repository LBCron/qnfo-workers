// SPEND-PRICE-FALLBACK-2 migration suite (GitHub 7026): migrations/2026-11-05-spend-price-fallback-metric.sql registers the guard metric spend_ledger_fallback_priced_rows with its fleet_tick
// refresh, its metric trigger (a code task on qnfo-ai whose anchor is a function signature that occurs once), the cause mapping, the failure mode and its code-read detector.
// Run: node --no-warnings migrations/spend-price-fallback-metric.test.mjs   (exit 0 = all passed)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(here, "2026-11-05-spend-price-fallback-metric.sql"), "utf8").replace(/\r\n/g, "\n");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? "  -- " + JSON.stringify(x).slice(0, 300) : "")); } };
ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: .+/m.test(sql) && /^-- CAUSE-MAPPED:/m.test(sql), "headers: APPLY-BY, DB, Rollback and CAUSE-MAPPED");
ok(/INSERT OR IGNORE INTO metric_breach_cause[\s\S]*spend_ledger_fallback_priced_rows/.test(sql), "the cause is mapped in the same file (METRIC-CAUSE-AT-REGISTRATION-1)");

const db = new DatabaseSync(":memory:");
db.exec(`CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, layer TEXT, kind TEXT, formula TEXT, source_of_truth TEXT, baseline TEXT, target TEXT, owner TEXT, disposition_actor TEXT, refresh_cadence TEXT, warning_band TEXT, kill_band TEXT, last_value TEXT, last_refreshed TEXT, state TEXT, refresh_class TEXT);
CREATE TABLE fleet_tick (id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT);
CREATE TABLE ai_call_counters (day TEXT, worker TEXT, purpose TEXT, model TEXT, calls INTEGER, errors INTEGER, PRIMARY KEY (day, worker, purpose, model));
CREATE TABLE analytics_metric_triggers (id INTEGER PRIMARY KEY AUTOINCREMENT, metric_key TEXT, title TEXT, source_table TEXT, operator TEXT, threshold REAL, priority INTEGER, action TEXT, owner TEXT, queue_target TEXT, cooldown_hours INTEGER, enabled INTEGER, notes TEXT);
CREATE TABLE metric_breach_cause (metric_key TEXT PRIMARY KEY, cause_key TEXT, note TEXT);
CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT, root_cause TEXT, remediation TEXT, detector TEXT, probe_class TEXT, first_seen TEXT, issue_id INTEGER, trigger_condition TEXT, symptom TEXT, blast_radius TEXT);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER, escalate_to TEXT, expected_cadence_h INTEGER, status TEXT, module TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY, actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);`);
const today = new Date().toISOString().slice(0, 10), yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
db.prepare("INSERT INTO ai_call_counters VALUES (?, 'qnfo-ai', 'spend-price-fallback', '@cf/zai-org/glm-5.2', 2, 0)").run(yesterday);
db.prepare("INSERT INTO ai_call_counters VALUES (?, 'qnfo-ai', 'binding', '@cf/a/b', 50, 0)").run(today);
db.exec(sql);

const m = db.prepare("SELECT * FROM metric_registry WHERE metric = 'spend_ledger_fallback_priced_rows'").get();
ok(m && m.kind === "guard" && m.target === "0" && m.owner === "qnfo-ai" && m.refresh_class === "computed", "the guard metric is registered with target 0", m);
ok(m.state === "MEASURED" && m.last_value === "0", "first reading: yesterday's unknown model and other purposes do not count, today reads 0", m);

const tick = (src) => db.prepare("INSERT INTO fleet_tick (source) VALUES (?)").run(src);
db.prepare("INSERT INTO ai_call_counters VALUES (?, 'qnfo-ai', 'spend-price-fallback', '@cf/new/unknown-model', 3, 0)").run(today);
tick("migration:test");
ok(db.prepare("SELECT last_value v FROM metric_registry WHERE metric = 'spend_ledger_fallback_priced_rows'").get().v === "3", "the tick refreshes the reading: a new unknown model today reads its call count (falsifiable)");
db.prepare("INSERT INTO ai_call_counters VALUES (?, 'qnfo-ai', 'spend-price-fallback', '@cf/other/model', 4, 0)").run(today);
tick("migration:again");
ok(db.prepare("SELECT last_value v FROM metric_registry WHERE metric = 'spend_ledger_fallback_priced_rows'").get().v === "7", "two unknown models today sum");
{
  const before = db.prepare("SELECT last_refreshed r FROM metric_registry WHERE metric = 'spend_ledger_fallback_priced_rows'").get().r;
  const n = db.prepare("SELECT strftime('%M','now') m").get().m;
  tick("fleet-cron");
  const after = db.prepare("SELECT last_refreshed r FROM metric_registry WHERE metric = 'spend_ledger_fallback_priced_rows'").get().r;
  ok(n < "10" ? true : before === after, "outside the first ten minutes of the hour an ordinary tick does not recompute (the trigger WHEN clause)");
}

const t = db.prepare("SELECT * FROM analytics_metric_triggers WHERE metric_key = 'spend_ledger_fallback_priced_rows'").get();
ok(t && t.operator === "gt" && t.threshold === 0 && t.enabled === 1 && t.cooldown_hours === 24 && t.queue_target === "agent_issues", "the trigger fires above 0, once a day, into agent_issues", t && { op: t.operator, th: t.threshold });
const lines = t.action.split("\n");
const cm = lines.find((l) => l.startsWith("code-task: ")), ca = lines.find((l) => l.startsWith("code-anchor: "));
ok(cm === "code-task: repo=qnfo-workers path=qnfo-ai/worker.js" && ca === "code-anchor: function spendPriceFallback(provider, model) {", "the lever carries a code-task line and a code-anchor that is a function signature", { cm, ca });
// the anchor must occur exactly once in the named file (migrations/code-anchor-once.test.mjs reads the same rule)
const worker = readFileSync(join(here, "..", "qnfo-ai", "worker.js"), "utf8");
ok(worker.split(ca.slice("code-anchor: ".length)).length - 1 === 1, "the anchor occurs once in qnfo-ai/worker.js");
ok(db.prepare("SELECT cause_key c FROM metric_breach_cause WHERE metric_key = 'spend_ledger_fallback_priced_rows'").get().c === "spend", "cause mapped to spend");

const fm = db.prepare("SELECT * FROM failure_modes WHERE fm_key = 'spend-price-fallback'").get();
const det = db.prepare("SELECT * FROM remediation_contracts WHERE class = 'fm-spend-price-fallback'").get();
ok(fm && fm.probe_class === "fm-spend-price-fallback" && det && det.verify_transport === "code-read" && det.status === "active" && det.module === "failure-mode", "failure mode and its standing detector exist");
const probe = JSON.parse(det.verify_probe);
ok(probe.paths[0] === "qnfo-ai/worker.js" && worker.includes(probe.contains), "the detector's marker is present in qnfo-ai/worker.js today (so it passes) and names the counter write", probe);
ok(!worker.replace(probe.contains, "").includes(probe.contains), "and occurs once, so removing the write fails the detector");

db.exec(sql);
ok(db.prepare("SELECT COUNT(*) n FROM decision_log").get().n === 1 && db.prepare("SELECT COUNT(*) n FROM analytics_metric_triggers").get().n === 1 && db.prepare("SELECT COUNT(*) n FROM metric_registry").get().n === 1, "a replay adds no second row");
console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
