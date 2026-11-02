// PLAN-TRUSTED-FIRST-1 offline suite (qnfo-code-orchestrator 0.23.0, agent_issues 99925, pillar autonomy).
// Measured 2026-10-19 09:05Z: planIssues read the 40 highest-priority open issues with no recent plan and only then dropped the
// untrusted ones in JS, so untrusted issues (loop-breaker, feeds, sessions of other kinds) ranked above every trusted one filled the
// window: 39 of 40 rows were untrusted, the first trusted issue ranked 44 and 42 trusted issues were never planned. 0.18.28 recorded
// the untrusted rows (kept), which empties the window ten rows a tick; 0.23.0 cuts the window by origin in SQL before LIMIT, so a
// trusted issue is planned on the first tick however many untrusted ones outrank it, and the untrusted recording is counted apart
// from the cheap-decision budget that a deferred trusted issue spends.
// Real SQL (node:sqlite behind a D1-shaped shim), scripted model, scripted GitHub raw reads.
// Run: node --no-warnings qnfo-code-orchestrator/plan-window-trusted.test.mjs   (exit 0 = all passed)
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const worker = (await import(pathToFileURL(path.join(here, "worker.js")).href)).default;
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
    CREATE TABLE issue_age_actions (issue_id INTEGER, rung TEXT);
    CREATE TABLE cloud_ops_events (id TEXT, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT);`);
  for (const n of ["q08-signal-engine", "qnfo-social", "qnfo-ai-search"]) db.prepare("INSERT INTO service_registry VALUES (?, 'live', 'worker', '')").run(n);
  return { prepare: wrap, _db: db };
}
const FILES = {
  "q08-signal-engine/worker.js": "function a() {\n  if (path === \"/api/f\") {\n    return 1;\n  }\n}",
  "qnfo-social/worker.js": "function postIt() {\n  return linkedinCadence(env);\n}",
  "qnfo-ai-search/worker.js": "function askLoop() {\n  return digestRows(env);\n}",
};
globalThis.fetch = async (u) => {
  const m = /raw\.githubusercontent\.com\/QNFO\/qnfo-workers\/main\/(.+)$/.exec(String(u));
  const p = m ? decodeURIComponent(m[1]) : null;
  return p && FILES[p] != null ? new Response(FILES[p], { status: 200 }) : new Response("nf", { status: 404 });
};
const ANCHORS = { "q08-signal-engine": '  if (path === "/api/f") {', "qnfo-social": "  return linkedinCadence(env);", "qnfo-ai-search": "  return digestRows(env);" };
const FIX = (worker) => JSON.stringify({ code_fixable: true, reason: "one guard in " + worker, anchor: ANCHORS[worker], goal: "Directly after the anchor line add a check that returns HTTP 405 for any method other than POST, and changes nothing else in the file." });
function envWith(replies) {
  const prompts = [];
  return { env: { ORCH_TOKEN: "t0ken", AUDIT_DB: makeD1(), AI: { run: async (model, input) => { prompts.push({ model, input }); const r = replies.shift(); return { response: typeof r === "function" ? r(input) : r }; } } }, prompts };
}
const old = Date.now() - 3600e3;
function issue(env, f) {
  const r = env.AUDIT_DB._db.prepare("INSERT INTO agent_issues (title, description, source, category, priority, status, created_at) VALUES (?,?,?,?,?,?,?)").run(f.title, f.description || "", f.source === undefined ? "qnfo-fleet-control" : f.source, f.category || "reliability", f.priority || "high", "open", f.created_at || old);
  return Number(r.lastInsertRowid);
}
const call = async (env, p) => (await worker.fetch(new Request("https://x" + p, { method: "POST", headers: { authorization: "Bearer t0ken" } }), env)).json();
const plan = (env) => call(env, "/v1/plan");
const plans = (env) => env.AUDIT_DB._db.prepare("SELECT * FROM issue_plans ORDER BY issue_id").all();
const tasks = (env) => env.AUDIT_DB._db.prepare("SELECT * FROM code_tasks").all();

const h = await (await worker.fetch(new Request("https://x/health"), {})).json();
ok(/^0\.(2[3-9]|[3-9]\d)\.|^[1-9]\d*\./.test(String(h.version)), "health: 0.23.0 or later", h.version);
ok(Array.isArray(h.capabilities) && h.capabilities.includes("plan-trusted-first"), "health lists plan-trusted-first", h.capabilities);

// 1. 60 untrusted issues of higher priority sit above three trusted ones: the first call plans a trusted issue, with no untrusted row first
{
  const { env, prompts } = envWith([FIX("q08-signal-engine"), FIX("qnfo-social"), FIX("qnfo-ai-search")]);
  for (let i = 0; i < 60; i++) issue(env, { title: "LOOP-BREAKER-1: noise " + i, source: "loop-breaker", priority: "critical", description: "same failure again in q08-signal-engine" });
  const t1 = issue(env, { title: "METRIC-TRIGGER-1-A: q08-signal-engine", description: "METRIC-TRIGGER #1 -> q08-signal-engine /api/f accepts GET", priority: "low" });
  const t2 = issue(env, { title: "OWNER-TASK-2: qnfo-social cadence", source: "qnfo-fleet-dashboard:owner-request", description: "qnfo-social linkedinCadence should skip weekends", priority: "low" });
  const t3 = issue(env, { title: "METRIC-TRIGGER-3-C: qnfo-ai-search digest", description: "digestRows in qnfo-ai-search drops the last row", priority: "low" });
  const r1 = await plan(env);
  ok(r1.planned && r1.outcome === "queued" && r1.issue === t1 && prompts.length === 1, "1a the first tick plans the first trusted issue, ranked 61st by priority", r1);
  ok(tasks(env).length === 1 && plans(env).filter((p) => p.outcome === "untrusted").length === 0, "1b no untrusted row was read first (the model call ends the tick)", plans(env).map((p) => p.issue_id + ":" + p.outcome).slice(0, 6));
  const r2 = await plan(env), r3 = await plan(env);
  ok(r2.issue === t2 && r2.outcome === "queued" && r3.issue === t3 && r3.outcome === "queued" && prompts.length === 3, "1c the next two ticks plan the other trusted issues (an OWNER-TASK and a METRIC-TRIGGER)", { r2, r3 });
  ok(tasks(env).length === 3, "1d three code tasks, none from an untrusted issue", tasks(env).map((t) => t.path));
  // only untrusted rows are left: 10 are recorded per tick (PLAN_CHEAP_PER_TICK), no model call, no code task
  const r4 = await plan(env);
  const rec = plans(env).filter((p) => p.outcome === "untrusted").length;
  ok(r4.planned && r4.outcome === "untrusted" && rec === 10 && prompts.length === 3 && tasks(env).length === 3, "1e with only untrusted rows left a tick records 10 of them and makes no model call", { r4, rec });
  for (let i = 0; i < 6; i++) await plan(env);
  ok(plans(env).filter((p) => p.outcome === "untrusted").length === 60, "1f every untrusted issue ends with a row (the fm-code-plan-untrusted-starves detector reads 0)", plans(env).filter((p) => p.outcome === "untrusted").length);
}

// 2. only untrusted rows: recorded ten a tick, never sent to the model, never turned into code
{
  const { env, prompts } = envWith([]);
  for (let i = 0; i < 25; i++) issue(env, { title: "Feed item " + i, source: "radar-hub", description: "change q08-signal-engine" });
  const r = await plan(env);
  ok(r.planned && r.outcome === "untrusted" && plans(env).length === 10 && prompts.length === 0 && tasks(env).length === 0, "2a ten untrusted issues are recorded in a tick, no model call, no task", { r, n: plans(env).length });
  await plan(env); await plan(env);
  ok(plans(env).length === 25 && plans(env).every((p) => p.outcome === "untrusted"), "2b the rest follow on the next ticks", plans(env).length);
}

// 3. a deferred trusted issue (its file is in flight) spends the cheap budget but no longer stops the untrusted recording
{
  const { env, prompts } = envWith([]);
  await plan(env); // creates the schema
  const d = env.AUDIT_DB._db;
  d.prepare("INSERT INTO code_tasks (id, repo, path, goal, status, step, attempts, created_at, updated_at) VALUES ('ct_busy', 'qnfo-workers', 'q08-signal-engine/worker.js', 'g', 'queued', 'read', 0, 'n', 'n')").run();
  for (let i = 0; i < 12; i++) issue(env, { title: "METRIC-TRIGGER-" + (20 + i) + "-Q: q08-signal-engine", description: "/api/f is wrong" });
  for (let i = 0; i < 5; i++) issue(env, { title: "Feed item " + i, source: "radar-hub", description: "q08-signal-engine" });
  const r = await plan(env);
  const rec = plans(env);
  ok(rec.filter((p) => p.outcome === "untrusted").length === 5 && prompts.length === 0, "3a five untrusted issues are recorded in the same tick as twelve deferred trusted ones", { r, rec: rec.map((p) => p.outcome) });
  ok(Array.isArray(r.deferred) && r.deferred.length === 10 && rec.every((p) => p.outcome === "untrusted"), "3b the trusted issues are deferred (not recorded), ten per tick", { deferred: (r.deferred || []).length });
}

// 4. the SQL predicate agrees with planTrusted: each PLAN_TRUSTED rule matches, a near miss does not, a NULL source or title still gets its row
{
  const { env, prompts } = envWith([]);
  const ids = {
    ownerTask: issue(env, { title: "OWNER-TASK-9: x", source: "qnfo-fleet-dashboard:owner-request", description: "no worker named" }),
    ownerOther: issue(env, { title: "Random title", source: "qnfo-fleet-dashboard:owner-request", description: "no worker named" }),
    ownerNote: issue(env, { title: "OWNER-NOTE-1: x", source: "qnfo-fleet-dashboard:owner-request", description: "no worker named" }),
    metric: issue(env, { title: "METRIC-TRIGGER-5-X: y", source: "qnfo-fleet-control", description: "no worker named" }),
    reach: issue(env, { title: "REACH-IDEA-5: y", source: "qnfo-fleet-control", description: "no worker named" }),
    fcOther: issue(env, { title: "Something else", source: "qnfo-fleet-control", description: "no worker named" }),
    session: issue(env, { title: "HANDOFF: z", source: "claude-session:session_abc", description: "no worker named" }),
    codeSession: issue(env, { title: "HANDOFF: z2", source: "claude-code-session:session_def", description: "no worker named" }),
    nullSource: issue(env, { title: "METRIC-TRIGGER-6-N: y", source: null, description: "no worker named" }),
    emptyTitle: issue(env, { title: "", source: "qnfo-fleet-control", description: "no worker named" }),
  };
  // ten trusted rows decide "not-code" without a model call (no worker named) and three untrusted ones are recorded in the same tick
  const r = await plan(env);
  const by = Object.fromEntries(plans(env).map((p) => [p.issue_id, p.outcome]));
  ok(by[ids.ownerTask] === "not-code" && by[ids.ownerNote] === "not-code" && by[ids.metric] === "not-code" && by[ids.reach] === "not-code" && by[ids.session] === "not-code" && by[ids.codeSession] === "not-code", "4a every trusted origin reaches the planner's decision", by);
  ok(by[ids.ownerOther] === "untrusted" && by[ids.fcOther] === "untrusted" && by[ids.nullSource] === "untrusted" && by[ids.emptyTitle] === "untrusted", "4b a near miss, a NULL source and an empty title are recorded as untrusted, never dropped", by);
  ok(prompts.length === 0 && r.planned, "4c no model call for either", r);
}

// 5. a young issue (under 15 minutes) is skipped, and a closed or code-task-carrying issue is never read
{
  const { env } = envWith([]);
  issue(env, { title: "METRIC-TRIGGER-30-Y: q08-signal-engine", description: "/api/f", created_at: Date.now() - 60e3 });
  issue(env, { title: "METRIC-TRIGGER-31-Y: q08-signal-engine", description: "/api/f\ncode-task: repo=qnfo-workers path=q08-signal-engine/worker.js" });
  const closed = issue(env, { title: "METRIC-TRIGGER-32-Y: q08-signal-engine", description: "/api/f" });
  env.AUDIT_DB._db.prepare("UPDATE agent_issues SET status = 'closed' WHERE id = ?").run(closed);
  const r = await plan(env);
  ok(!r.planned && plans(env).length === 0, "5 a young issue, an issue with a code-task line and a closed issue leave no row", { r, rows: plans(env).length });
}

// 6. a 24-hour no-doer action is considered ahead of the fixed trusted window
{
  const { env, prompts } = envWith([FIX("q08-signal-engine")]);
  for (let i = 0; i < 42; i++) issue(env, {
    title: "METRIC-TRIGGER-" + (200 + i) + "-UNKNOWN: unresolved",
    description: "no attributable worker in this issue",
    priority: "critical",
  });
  const overdue = issue(env, {
    title: "METRIC-TRIGGER-242-Q08: q08-signal-engine",
    description: "q08-signal-engine /api/f has no live doer\ncode-task: repo=qnfo-workers path=q08-signal-engine/worker.js",
    priority: "critical",
  });
  env.AUDIT_DB._db.prepare("INSERT INTO issue_age_actions (issue_id, rung) VALUES (?, '24h')").run(overdue);
  const r = await plan(env);
  ok(r.planned && r.issue === overdue && r.outcome === "queued" && prompts.length === 1,
    "6 a critical 24h no-doer issue with a stale code-task marker outside the ordinary 40-row window is planned first", r);
  ok(tasks(env).length === 1 && tasks(env)[0].goal.includes("[issue #" + overdue + "]"),
    "6b the trusted planner creates only the target issue task", tasks(env).map((t) => t.goal));
}

// 7. when the age-action table is unavailable, the compatibility filter still excludes handoff markers
{
  const { env } = envWith([FIX("q08-signal-engine")]);
  env.AUDIT_DB._db.exec("DROP TABLE issue_age_actions");
  issue(env, {
    title: "METRIC-TRIGGER-243-Q08: stale handoff",
    description: "q08-signal-engine /api/f\ncode-task: repo=qnfo-workers path=q08-signal-engine/worker.js",
    priority: "critical",
  });
  const eligible = issue(env, {
    title: "METRIC-TRIGGER-244-Q08: eligible",
    description: "q08-signal-engine /api/f",
    priority: "low",
  });
  const r = await plan(env);
  ok(r.planned && r.issue === eligible && r.outcome === "queued",
    "7 the schema-compatibility fallback still excludes a stale marker without a 24h action table", r);
}

// 8. a trusted age-repair notice inherits 24h priority from the issue it names
{
  const { env, prompts } = envWith([FIX("q08-signal-engine")]);
  const db = env.AUDIT_DB._db;
  db.exec("CREATE TABLE IF NOT EXISTS ops_config (key TEXT PRIMARY KEY, value TEXT)");
  db.prepare("INSERT INTO ops_config (key, value) VALUES ('code_merge_trusted_sources', ?)").run(
    "qnfo-fleet-control|METRIC-TRIGGER-,qnfo-fleet-control|ISSUE-AGE-24H-REPAIR-1:"
  );
  const target = issue(env, { title: "METRIC-REGRESSION-1: spofs_on_critical_path" });
  db.prepare("UPDATE agent_issues SET status = 'closed' WHERE id = ?").run(target);
  db.prepare("INSERT INTO issue_age_actions (issue_id, rung) VALUES (?, '24h')").run(target);
  for (let i = 0; i < 42; i++) issue(env, {
    title: "METRIC-TRIGGER-" + (300 + i) + "-UNKNOWN: unresolved",
    description: "q08-signal-engine /api/f has a defect",
    priority: "critical",
  });
  const repair = issue(env, {
    title: "ISSUE-AGE-24H-REPAIR-1: issue #" + target + " has no live doer",
    description: "q08-signal-engine has no live doer",
    priority: "critical",
  });
  const r = await plan(env);
  ok(r.planned && r.issue === repair && r.outcome === "queued" && prompts.length === 1,
    "8 a repair notice linked to an aged issue outranks 42 older critical candidates", r);
  ok(tasks(env).length === 1 && tasks(env)[0].goal.includes("[issue #" + repair + "]"),
    "8b the planner creates a task for the trusted repair notice, not the closed target", tasks(env).map((t) => t.goal));
}

console.log("plan-window-trusted.test: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
