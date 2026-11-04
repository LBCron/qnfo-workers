// ROADMAP-SELF-MAINTAIN-2 offline suite: replays migrations/2026-11-05-roadmap-self-maintain-split.sql on node:sqlite against a 22-step task shaped like the live one.
// Proves: (1) four tasks, steps 0-7 / 8-11 / 12-16 / 17-21, every step object byte-identical to the original and in order; (2) the three new tasks are enabled workflows
// with a 120 s timeout and exist before the original is trimmed; (3) three new crons on :31, :33 and :37, the original cron untouched; (4) the deferred-aware detector reads the
// metrics task's step 0 and still passes on the new shape; (5) the split is guarded: a task that is not 22 steps long is left alone, and a replay changes nothing;
// (6) one decision and two predictions.
// Run: node migrations/roadmap-self-maintain-split.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const here = (f) => new URL("./" + f, import.meta.url);
const sql = readFileSync(here("2026-11-05-roadmap-self-maintain-split.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d))); } };
function statements(text) {
  const body = text.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
  const out = []; let cur = "", q = false;
  for (const c of body) { if (c === "'") q = !q; if (c === ";" && !q) { if (cur.trim()) out.push(cur.trim()); cur = ""; } else cur += c; }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
const STMTS = statements(sql);
const NAMES = ["programs-log", "programs", "objectives-log", "objectives", "contracts", "contracts-sync", "contracts-retire", "contracts-reactivate", "complete-log", "complete", "reopen-log", "reopen",
  "roadmap-goal-verify", "roadmap-goal-reopen", "roadmap-next-verify", "roadmap-project-verify", "roadmap-fm-verify", "metric-goals-unevaluated", "metric-goals-without-dod", "metric-roadmap-unplaced", "metric-goals-completed", "ledger"];
const step = (i) => ({ type: "sql", db: "AUDIT", name: NAMES[i], sql: i === 17 ? "UPDATE metric_registry SET last_value = '0' WHERE metric = 'goals_unevaluated' /* LIKE 'deferred%' */" : "SELECT " + i + " AS n, 'it''s a quoted; text' AS t" });
function build(n = 22) {
  const db = new DatabaseSync(":memory:");
  db.exec(`
CREATE TABLE fleet_tasks (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, definition TEXT NOT NULL, timeout_ms INTEGER NOT NULL DEFAULT 30000, retries INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 1, enabled INTEGER NOT NULL DEFAULT 1, updated_at TEXT);
CREATE TABLE fleet_crons (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, cron_expr TEXT NOT NULL, task_id TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, timezone TEXT NOT NULL DEFAULT 'UTC', last_fired TEXT, next_fire TEXT, updated_at TEXT);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, verify_probe TEXT, last_verdict TEXT, attempts INTEGER, next_due_at TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
CREATE TABLE decision_predictions (id INTEGER PRIMARY KEY AUTOINCREMENT, decision_id INTEGER, kind TEXT, subject TEXT, op TEXT, value REAL, due_at TEXT, origin TEXT, UNIQUE(decision_id, kind, subject));
`);
  const steps = Array.from({ length: n }, (_, i) => step(i));
  db.prepare("INSERT INTO fleet_tasks (id, name, type, definition, timeout_ms, retries, version, enabled) VALUES ('roadmap-self-maintain', 'ROADMAP-SELF-MAINTAIN-1', 'workflow', ?, 120000, 1, 2, 1)").run(JSON.stringify({ steps }));
  db.prepare("INSERT INTO fleet_crons (name, cron_expr, task_id) VALUES ('roadmap-self-maintain-hourly', '30 * * * *', 'roadmap-self-maintain')").run();
  db.prepare("INSERT INTO remediation_contracts (class, verify_probe, last_verdict, attempts) VALUES ('fm-goals-unevaluated-counts-deferred-probes', ?, 'fail', 9)")
    .run("SELECT '1' AS expected, CASE WHEN EXISTS (SELECT 1 FROM fleet_tasks WHERE id='roadmap-self-maintain' AND enabled = 1 AND instr(json_extract(definition, '$.steps[17].sql'), 'LIKE ''deferred%''') > 0) AND 1 THEN '1' ELSE '0' END AS observed");
  return db;
}
const one = (db, q, ...a) => db.prepare(q).get(...a);
const all = (db, q, ...a) => db.prepare(q).all(...a);
const run = (db) => { for (const s of STMTS) db.exec(s); };
const defOf = (db, id) => JSON.parse(one(db, "SELECT definition d FROM fleet_tasks WHERE id = ?", id).d);

const db = build();
run(db);
const parts = { "roadmap-self-maintain": [0, 7], "roadmap-self-maintain-goals": [8, 11], "roadmap-self-maintain-roadmap": [12, 16], "roadmap-self-maintain-metrics": [17, 21] };
for (const [id, [a, b]] of Object.entries(parts)) {
  const steps = defOf(db, id).steps;
  ok(steps.length === b - a + 1, id + " holds steps " + a + "-" + b, steps.length);
  ok(steps.every((s, i) => JSON.stringify(s) === JSON.stringify(step(a + i))), id + ": every step is byte-identical to the original, in order", steps.map((s) => s.name));
}
for (const id of ["roadmap-self-maintain-goals", "roadmap-self-maintain-roadmap", "roadmap-self-maintain-metrics"]) {
  const t = one(db, "SELECT type, enabled, timeout_ms, retries FROM fleet_tasks WHERE id = ?", id);
  ok(t.type === "workflow" && t.enabled === 1 && t.timeout_ms === 120000 && t.retries === 1, id + " is an enabled workflow with the original timeout", t);
}
ok(one(db, "SELECT version v FROM fleet_tasks WHERE id = 'roadmap-self-maintain'").v === 3, "the trimmed original takes a version bump");
const crons = Object.fromEntries(all(db, "SELECT name, cron_expr, task_id, enabled FROM fleet_crons").map((c) => [c.name, c]));
ok(crons["roadmap-self-maintain-hourly"].cron_expr === "30 * * * *", "the original cron is untouched");
ok(crons["roadmap-self-maintain-goals-hourly"].cron_expr === "31 * * * *" && crons["roadmap-self-maintain-roadmap-hourly"].cron_expr === "33 * * * *" && crons["roadmap-self-maintain-metrics-hourly"].cron_expr === "37 * * * *", "three new crons on :31, :33 and :37");
ok(Object.values(crons).every((c) => c.enabled === 1) && Object.keys(crons).length === 4, "four enabled crons", Object.keys(crons));
const probe = one(db, "SELECT verify_probe p, last_verdict v, attempts a FROM remediation_contracts WHERE class = 'fm-goals-unevaluated-counts-deferred-probes'");
ok(/id='roadmap-self-maintain-metrics'/.test(probe.p) && /\$\.steps\[0\]\.sql/.test(probe.p) && !/steps\[17\]/.test(probe.p), "the detector reads the metrics task, step 0", probe.p);
ok(one(db, probe.p).observed === "1", "the detector passes on the new shape");
ok(probe.v === null && probe.a === 0, "the detector is re-armed");
ok(one(db, "SELECT COUNT(*) n FROM bak_20261105_roadmap_self_maintain_split").n === 2, "the backup holds the task and the probe");
ok(JSON.parse(one(db, "SELECT v FROM bak_20261105_roadmap_self_maintain_split WHERE kind = 'task'").v).steps.length === 22, "the backup holds all 22 original steps");
ok(one(db, "SELECT COUNT(*) n FROM decision_log").n === 1 && one(db, "SELECT COUNT(*) n FROM decision_predictions").n === 2, "one decision and two predictions");

// replay: nothing changes
const snap = (d) => JSON.stringify([all(d, "SELECT id, definition, version, enabled FROM fleet_tasks ORDER BY id"), all(d, "SELECT name, cron_expr, task_id FROM fleet_crons ORDER BY name"), all(d, "SELECT class, verify_probe FROM remediation_contracts"), all(d, "SELECT COUNT(*) n FROM decision_log"), all(d, "SELECT COUNT(*) n FROM decision_predictions")]);
const before = snap(db);
run(db);
ok(snap(db) === before, "a second run changes nothing");

// guard: a task that is not the 22-step shape is left alone
const odd = build(10);
run(odd);
ok(all(odd, "SELECT id FROM fleet_tasks").length === 1 && defOf(odd, "roadmap-self-maintain").steps.length === 10, "a 10-step task is neither split nor trimmed");
ok(all(odd, "SELECT name FROM fleet_crons").length === 1, "no cron is added for a task that does not exist (the dispatcher would queue a run row it cannot execute)");

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
