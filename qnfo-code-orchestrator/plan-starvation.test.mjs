// PLAN-STARVATION-1 offline suite (qnfo-code-orchestrator 0.48.3, pillar autonomy; metrics issues_over_24h_no_doer, driver_drain_24h).
// Measured 2026-11-05T03Z on qnfo-audit: issue_plans held 0 rows in the last 12 h (about 8 planner tasks a day before 2026-11-04T15Z; 34 of the planner's last 77 tasks merged),
// because planIssues counted every unfinished code_tasks ROW as work in progress (50 queued rows, 21 files, code_plan_wip 40) while issue intake and the RED-DRAIN-1 dispatch
// refilled the queue to MAX_OPEN_TASKS (48) as soon as the loop freed a slot: the intake always won, an issue with no code-task line never reached a doer, and the early
// returns of planIssues were silent. This suite uses real SQL (node:sqlite behind a D1-shaped shim), a scripted model and scripted GitHub reads.
// Proves: 1 rows queued behind a task on the same file are not work in progress (44 queued rows on 3 files no longer shut the planner);
//         2 a full queue (48 rows) stops the planner BEFORE any model call and says so once per 30 minutes in a code-task.plan-gated event;
//         3 41 queued rows on 41 different files still hold the planner at code_plan_wip (the gate itself is kept);
//         4 enqueue() with reserve 6 (the intake) refuses at 42 rows with the reason, while a session's direct enqueue is allowed up to 48;
//         5 both copies carry the markers and the intake passes PLAN_RESERVE.
// Run: node --no-warnings qnfo-code-orchestrator/plan-starvation.test.mjs   (exit 0 = all passed; prints "N passed, 0 failed")
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "psv-"));
fs.writeFileSync(path.join(tmp, "w.mjs"), fs.readFileSync(path.join(here, "worker.js"), "utf8") + "\nexport { planIssues as __plan, enqueue as __enqueue, ensureSchema as __schema, MAX_OPEN_TASKS as __max, PLAN_RESERVE as __reserve };\n");
const W = await import(pathToFileURL(path.join(tmp, "w.mjs")).href);
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? "  -- " + JSON.stringify(x).slice(0, 500) : "")); } };

function makeD1() {
  const db = new DatabaseSync(":memory:");
  const wrap = (sql) => {
    let args = [];
    const st = {
      bind: (...a) => { args = a.map((v) => (v === undefined ? null : v)); return st; },
      run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
      first: async () => db.prepare(sql).get(...args) || null,
      all: async () => ({ results: db.prepare(sql).all(...args) }),
    };
    return st;
  };
  db.exec(`CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT DEFAULT 'open', created_at INTEGER, updated_at INTEGER);
    CREATE TABLE service_registry (service TEXT PRIMARY KEY, state TEXT, kind TEXT, base_url TEXT);
    CREATE TABLE cloud_ops_events (id TEXT, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT);
    CREATE TABLE issue_queue_order (id INTEGER PRIMARY KEY, aged INTEGER, score REAL);
    CREATE VIEW v_issue_queue_v2 AS SELECT a.id, q.aged, q.score FROM agent_issues a LEFT JOIN issue_queue_order q ON q.id = a.id;`);
  for (const n of ["q08-signal-engine", "qnfo-social", "qnfo-ai-search"]) db.prepare("INSERT INTO service_registry VALUES (?, 'live', 'worker', '')").run(n);
  return { prepare: wrap, _db: db };
}
const FILES = { "qnfo-ai-search/worker.js": "function askLoop() {\n  return digestRows(env);\n}" };
globalThis.fetch = async (u) => {
  const m = /raw\.githubusercontent\.com\/QNFO\/qnfo-workers\/main\/(.+)$/.exec(String(u));
  const p = m ? decodeURIComponent(m[1]) : null;
  return p && FILES[p] != null ? new Response(FILES[p], { status: 200 }) : new Response("nf", { status: 404 });
};
const FIX = JSON.stringify({ code_fixable: true, reason: "one guard", anchor: "  return digestRows(env);", goal: "Directly after the anchor line add a check that returns HTTP 405 for any method other than POST, and changes nothing else in the file." });
function mkEnv() {
  const prompts = [];
  return { env: { ORCH_TOKEN: "t0ken", AUDIT_DB: makeD1(), AI: { run: async (model, input) => { prompts.push({ model, input }); return { response: FIX }; } } }, prompts };
}
const old = Date.now() - 3600e3;
const addIssue = (env) => Number(env.AUDIT_DB._db.prepare("INSERT INTO agent_issues (title, description, source, category, priority, status, created_at) VALUES (?,?,?,?,?,?,?)")
  .run("METRIC-TRIGGER-90-X: qnfo-ai-search digest", "digestRows in qnfo-ai-search drops the last row", "qnfo-fleet-control", "", "critical", "open", old).lastInsertRowid);
const addTasks = (env, n, filesN) => {
  const ins = env.AUDIT_DB._db.prepare("INSERT INTO code_tasks (id, repo, path, goal, status, step, attempts, created_at, updated_at) VALUES (?,?,?,?, 'queued','read',0,?,?)");
  const now = new Date().toISOString();
  for (let i = 0; i < n; i++) ins.run("ct_seed" + i, "qnfo-workers", "worker-" + (i % filesN) + "/worker.js", "seed " + i, now, now);
};
const gatedEvents = (env) => env.AUDIT_DB._db.prepare("SELECT COUNT(*) n FROM cloud_ops_events WHERE kind = 'code-task.plan-gated'").get().n;

// 1. 44 queued rows on 3 files: the old row count (44 >= 40) shut the planner; files in motion are 3, the queue has room (44 < 48)
{
  const { env, prompts } = mkEnv();
  await W.__schema(env);
  addTasks(env, 44, 3);
  const id = addIssue(env);
  const r = await W.__plan(env);
  ok(r.planned === true && r.outcome === "queued" && r.issue === id && prompts.length === 1, "1a 44 queued rows on 3 files no longer shut the planner: the issue is planned", r);
  ok(env.AUDIT_DB._db.prepare("SELECT COUNT(*) n FROM code_tasks WHERE goal LIKE '[issue #" + id + "]%'").get().n === 1, "1b the planner's task is in the queue (a doer exists)");
  ok(gatedEvents(env) === 0, "1c no plan-gated event while the planner runs", gatedEvents(env));
}

// 2. a full queue stops the planner before the model call, once per 30 minutes it says why
{
  const { env, prompts } = mkEnv();
  await W.__schema(env);
  addTasks(env, 49, 3);
  addIssue(env);
  const r = await W.__plan(env);
  ok(r.planned === false && /queue full 49 >= 48/.test(r.why) && prompts.length === 0, "2a 49 queued rows: no model call, reason says queue full", { r, prompts: prompts.length });
  ok(gatedEvents(env) === 1, "2b the gate is recorded as one code-task.plan-gated event", gatedEvents(env));
  const ev = env.AUDIT_DB._db.prepare("SELECT status, text, meta FROM cloud_ops_events WHERE kind = 'code-task.plan-gated'").get();
  ok(ev && /queue full/.test(ev.text) && JSON.parse(ev.meta).queued === 49 && JSON.parse(ev.meta).files === 3, "2c the event names the gate and carries queued and files", ev);
  await W.__plan(env);
  ok(gatedEvents(env) === 1, "2d a second gated call inside 30 minutes writes no second event", gatedEvents(env));
}

// 2e. a full queue still writes the verdicts that need no slot (untrusted origin), and defers the trusted issue without a verdict
{
  const { env, prompts } = mkEnv();
  await W.__schema(env);
  addTasks(env, 49, 3);
  const trusted = addIssue(env);
  const d = env.AUDIT_DB._db;
  const untrusted = Number(d.prepare("INSERT INTO agent_issues (title, description, source, category, priority, status, created_at) VALUES ('Feed note', 'change qnfo-ai-search', 'radar-hub', '', 'critical', 'open', ?)").run(old).lastInsertRowid);
  const r = await W.__plan(env);
  const row = (id) => d.prepare("SELECT outcome FROM issue_plans WHERE issue_id = ?").get(id);
  ok(row(untrusted) && row(untrusted).outcome === "untrusted", "2e an untrusted verdict is still written while the queue is full", { r, row: row(untrusted) });
  ok(!row(trusted) && prompts.length === 0 && r.planned === true, "2f the trusted issue gets no verdict and no model call while the queue is full (it is planned when a slot frees)", { r, row: row(trusted), prompts: prompts.length });
}

// 2g. the queue fills between the gate and the enqueue (a direct enqueue by a session): a wait, not a verdict
{
  const prompts = [];
  const env = { ORCH_TOKEN: "t0ken", AUDIT_DB: makeD1(), AI: { run: async (model, input) => { prompts.push(model); env.AUDIT_DB._db.exec("INSERT INTO code_tasks (id, repo, path, goal, status, step, attempts, created_at, updated_at) VALUES ('ct_race', 'qnfo-workers', 'race/worker.js', 'g', 'queued', 'read', 0, 'n', 'n')"); return { response: FIX }; } } };
  await W.__schema(env);
  addTasks(env, 47, 3);
  const id = addIssue(env);
  const r = await W.__plan(env);
  ok(prompts.length === 1 && r.planned === false && /enqueue deferred: queue full/.test(r.why), "2g a 429 at enqueue is reported as a wait", r);
  ok(!env.AUDIT_DB._db.prepare("SELECT 1 FROM issue_plans WHERE issue_id = ?").get(id), "2h and the issue gets no invalid verdict (it is planned again on the next tick)");
}

// 3. 41 queued rows on 41 files: the work-in-progress gate itself is kept (code_plan_wip default 12 would shut it earlier; ops_config absent -> PLAN_WIP 12, so seed the cap)
{
  const { env, prompts } = mkEnv();
  await W.__schema(env);
  env.AUDIT_DB._db.exec("CREATE TABLE IF NOT EXISTS ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT)");
  env.AUDIT_DB._db.prepare("INSERT INTO ops_config (key, value) VALUES ('code_plan_wip', '40')").run();
  addTasks(env, 41, 41);
  addIssue(env);
  const r = await W.__plan(env);
  ok(r.planned === false && /work in progress 41 files >= 40/.test(r.why) && prompts.length === 0, "3 41 queued rows on 41 files still hold the planner at code_plan_wip", r);
}

// 4. enqueue: the intake (reserve) stops at 42 rows, a direct enqueue is allowed up to 48
{
  const { env } = mkEnv();
  await W.__schema(env);
  addTasks(env, 42, 5);
  const job = { repo: "qnfo-workers", path: "qnfo-ai-search/worker.js", goal: "Directly after the anchor line add a check that returns HTTP 405 for any method other than POST.", anchor: "  return digestRows(env);" };
  const viaIntake = await W.__enqueue(env, job, { queueBehind: true, reserve: W.__reserve });
  ok(viaIntake.ok === false && viaIntake.status === 429 && /kept for the planner/.test(viaIntake.error) && /queue full \(42 queued tasks/.test(viaIntake.error), "4a intake enqueue at 42 rows is refused and says six slots are kept for the planner", viaIntake);
  const direct = await W.__enqueue(env, job, { queueBehind: true });
  ok(direct.ok === true && direct.status === 202, "4b a direct enqueue (a session, the planner) is still accepted at 42 rows", direct);
  ok(W.__reserve === 6 && W.__max === 48, "4c PLAN_RESERVE is 6 and MAX_OPEN_TASKS stays 48 (no cap raised)", { r: W.__reserve, m: W.__max });
}

// 5. markers in both copies, the intake passes the reserve
{
  const src = fs.readFileSync(path.join(here, "worker.js"), "utf8");
  const mirror = fs.readFileSync(path.join(here, "deployed-current.worker.js"), "utf8");
  ok(src === mirror, "5a deployed-current.worker.js is identical to worker.js");
  ok(src.includes("PLAN-STARVATION-1") && src.includes("code-task.plan-gated"), "5b worker.js carries PLAN-STARVATION-1 and the plan-gated event");
  ok(src.includes("enqueue(env, job, { queueBehind: extraPaths.length === 0, reserve: PLAN_RESERVE })"), "5c the issue intake passes PLAN_RESERVE");
  ok(src.includes("COUNT(DISTINCT CASE WHEN status IN ('branch_pushed','published','pr_open') THEN NULL ELSE repo || ':' || "), "5d work in progress counts files in motion");
}

console.log("plan-starvation.test: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
