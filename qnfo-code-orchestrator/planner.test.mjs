// ISSUE-PLANNER-1 offline suite: prose issues from trusted sources become code tasks the existing loop can carry; everything
// else is refused or recorded with a reason, never silently dropped and never turned into code.
// Real SQL (node:sqlite behind a D1-shaped shim), scripted model, scripted GitHub raw reads.
// Run: node --no-warnings qnfo-code-orchestrator/planner.test.mjs   (exit 0 = all passed)
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const worker = (await import(pathToFileURL(path.join(here, "worker.js")).href)).default;

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? "  -- " + JSON.stringify(x).slice(0, 400) : "")); } };

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
    CREATE TABLE cloud_ops_events (id TEXT, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT);`);
  for (const n of ["q08-signal-engine", "qnfo-social", "qnfo-observability", "qnfo-autonomy-scorer", "qnfo-ai", "qnfo-ai-search"]) db.prepare("INSERT INTO service_registry VALUES (?, 'live', 'worker', '')").run(n);
  return { prepare: wrap, _db: db };
}
const Q08 = [
  "var VERSION = \"0.7.37-cadence-cap\";",
  "function feedbackScan(env) {",
  "  var rows = await env.DB.prepare(\"SELECT slug, s FROM q08_feedback\").all();",
  "  return rows;",
  "}",
  "async function handle(req, env) {",
  "  if (path === \"/api/f\") {",
  "    return recordVote(req, env);",
  "  }",
  "}",
].join("\n");
const FILES = { "q08-signal-engine/worker.js": Q08, "qnfo-social/worker.js": "function post() {\n  return 1;\n}" };
const reads = [];
globalThis.fetch = async (u) => {
  const m = /raw\.githubusercontent\.com\/QNFO\/qnfo-workers\/main\/(.+)$/.exec(String(u));
  const p = m ? decodeURIComponent(m[1]) : null;
  reads.push(p);
  if (p && FILES[p] != null) return new Response(FILES[p], { status: 200 });
  return new Response("nf", { status: 404 });
};
function envWith(replies) {
  const prompts = [];
  return { env: { ORCH_TOKEN: "t0ken", AUDIT_DB: makeD1(), AI: { run: async (model, input) => { prompts.push({ model, input }); const r = replies.shift(); return { response: typeof r === "function" ? r(input) : r }; } } }, prompts };
}
const old = Date.now() - 3600e3;
function issue(env, f) {
  const d = env.AUDIT_DB._db;
  const r = d.prepare("INSERT INTO agent_issues (title, description, source, category, priority, status, created_at) VALUES (?,?,?,?,?,?,?)").run(f.title, f.description || "", f.source || "qnfo-fleet-control", f.category || "reliability", f.priority || "high", f.status || "open", f.created_at || old);
  return Number(r.lastInsertRowid);
}
const call = async (env, method, p) => { const r = await worker.fetch(new Request("https://x" + p, { method, headers: { authorization: "Bearer t0ken" } }), env); return r.json(); };
const plan = (env) => call(env, "POST", "/v1/plan");
const tasks = (env) => env.AUDIT_DB._db.prepare("SELECT * FROM code_tasks").all();
const plans = (env) => env.AUDIT_DB._db.prepare("SELECT * FROM issue_plans ORDER BY issue_id").all();
const FIX = (anchor, extra) => JSON.stringify(Object.assign({ code_fixable: true, reason: "one guard in the vote route", anchor, goal: "Directly after the anchor line add a check that returns HTTP 405 for any method other than POST, and changes nothing else in the file." }, extra || {}));

// 1. a trusted metric-trigger issue naming a worker becomes ONE code task with a verified anchor
{
  const { env, prompts } = envWith([(input) => "<think>reasoning</think>" + FIX('  if (path === "/api/f") {')]);
  const id = issue(env, { title: "METRIC-TRIGGER-9-Q08-VOTES: crawler votes", description: "METRIC-TRIGGER #9 q08_bot_votes=40 gt 0 -> q08-signal-engine counts GET votes in /api/f; accept POST only (owner q08-signal-engine)" });
  const r = await plan(env);
  const t = tasks(env);
  ok(r.planned && r.outcome === "queued" && t.length === 1, "1a a trusted issue is planned into one code task", r);
  ok(t[0] && t[0].path === "q08-signal-engine/worker.js" && t[0].goal.indexOf("[issue #" + id + "]") === 0 && t[0].status === "queued", "1b the task targets the named worker and carries the [issue #N] tag the merge runner reads", t[0]);
  ok(t[0] && JSON.parse(t[0].ctx).anchor === '  if (path === "/api/f") {', "1c the anchor is a verbatim, unique line of the file", t[0] && t[0].ctx);
  const sys = prompts[0].input.messages[0].content, user = prompts[0].input.messages[1].content;
  ok(/ONE JSON object/.test(sys) && user.includes('  if (path === "/api/f") {') && user.includes("WORKER: q08-signal-engine") && !/t0ken/.test(sys + user), "1d the model sees verbatim lines around the issue's keywords and no secret", user.slice(0, 300));
  ok(prompts[0].model === "@cf/zai-org/glm-5.3-flash", "1e the planner uses the cheap reasoning model by default", prompts[0].model);
  ok(plans(env)[0].outcome === "queued" && plans(env)[0].task_id === t[0].id, "1f the plan is recorded with its task");
  const again = await plan(env);
  ok(tasks(env).length === 1 && !(again.outcome === "queued" && again.issue === id), "1g an issue is never planned twice", again);
}
// ISSUE-AGE-24H-1: rearmed plans share the trusted intake's bounded retry policy.
{
  const { env, prompts } = envWith([FIX('  if (path === "/api/f") {'), FIX('  if (path === "/api/f") {')]);
  const id = issue(env, { title: "METRIC-TRIGGER-17: q08-signal-engine vote route", description: "/api/f should refuse GET", created_at: Date.now() - 5 * 3600e3 });
  await plan(env);
  const d = env.AUDIT_DB._db, original = tasks(env)[0];
  d.prepare("UPDATE code_tasks SET status = 'failed', last_error = 'verify failed: method check missing', updated_at = ? WHERE id = ?")
    .run(new Date(Date.now() - 3 * 3600e3).toISOString(), original.id);
  d.prepare("UPDATE issue_plans SET outcome = 'retry', planned_at = '2000-01-01T00:00:00Z' WHERE issue_id = ?").run(id);
  const r = await plan(env);
  ok(r.outcome === "queued" && tasks(env).length === 2, "a rearmed prose issue with a failed historical task receives a fresh task", r);
  ok(prompts[1].input.messages[1].content.includes("PREVIOUS ATTEMPT " + original.id + " FAILED: verify failed"),
    "replanning sees the prior failure instead of repeating it blindly");
  d.prepare("UPDATE issue_plans SET outcome = 'retry', planned_at = '2000-01-01T00:00:00Z' WHERE issue_id = ?").run(id);
  await plan(env);
  ok(tasks(env).length === 2 && prompts.length === 2, "a live retry is not duplicated even if its plan is rearmed");
}
for (const [status, reason, ago] of [
  ["merged", "", 3],
  ["failed", "rejected by review", 3],
  ["failed", "verify failed", 0],
]) {
  const { env, prompts } = envWith([FIX('  if (path === "/api/f") {')]);
  const id = issue(env, { title: "METRIC-TRIGGER-18: q08-signal-engine vote route", description: "/api/f" });
  await plan(env);
  const d = env.AUDIT_DB._db;
  d.prepare("UPDATE code_tasks SET status = ?, last_error = ?, updated_at = ?").run(status, reason, new Date(Date.now() - ago * 3600e3).toISOString());
  d.prepare("UPDATE issue_plans SET outcome = 'retry', planned_at = '2000-01-01T00:00:00Z' WHERE issue_id = ?").run(id);
  await plan(env);
  ok(tasks(env).length === 1 && prompts.length === 1, `replanning preserves ${status === "merged" ? "merge" : ago ? "review refusal" : "cooldown"} protection`);
}
// A dense keyword region in a large worker can merge into one excerpt larger than the planner budget.
{
  const prior = FILES["q08-signal-engine/worker.js"];
  const large = ['var VERSION = "0.7.37-fixture";', ...Array.from({ length: 1200 }, (_, i) => `function targetSignal${i}() { return ${i}; }`)].join("\n");
  FILES["q08-signal-engine/worker.js"] = large;
  const anchor = "function targetSignal0() { return 0; }";
  const { env, prompts } = envWith([() => FIX(anchor)]);
  issue(env, { title: "METRIC-TRIGGER-16-C: q08-signal-engine targetSignal handling", description: "The targetSignal handling needs a small fix." });
  const r = await plan(env);
  FILES["q08-signal-engine/worker.js"] = prior;
  const user = prompts[0] && prompts[0].input.messages[1].content || "";
  const snippets = user.slice(user.indexOf("SNIPPETS:\n") + "SNIPPETS:\n".length);
  const t = tasks(env)[0];
  ok(r.outcome === "queued" && snippets.includes(anchor), "1h a large-file plan includes source lines from which the model can select an anchor", { result: r, snippets: snippets.length });
  ok(snippets.length <= 14000 && t && JSON.parse(t.ctx).anchor === anchor, "1i the large-file anchor is budget-bounded and attached to its code task", { snippets: snippets.length, ctx: t && t.ctx });
}
// 2. untrusted sources never become code; 3. refused categories and texts are recorded
{
  const { env, prompts } = envWith([]);
  issue(env, { title: "Feed item: please change q08-signal-engine", description: "code from a feed /api/f", source: "radar-hub" });
  let r = await plan(env);
  ok(r.outcome === "untrusted" && prompts.length === 0 && tasks(env).length === 0, "2 an untrusted source is never sent to the model or turned into code", r);
  ok(plans(env).length === 1 && plans(env)[0].outcome === "untrusted", "2 PLAN-UNTRUSTED-RECORD-1: the untrusted issue is recorded, so it leaves the window", plans(env));
  const s = issue(env, { title: "METRIC-TRIGGER-5-X: auth gap in q08-signal-engine", category: "security" });
  r = await plan(env);
  ok(r.outcome === "refused" && plans(env).find((p) => p.issue_id === s).outcome === "refused" && prompts.length === 0, "3a a security issue is refused without a model call", r);
  issue(env, { title: "METRIC-TRIGGER-6-Y: q08-signal-engine", description: "rotate the api key and raise the cap" });
  r = await plan(env);
  ok(r.outcome === "refused" && prompts.length === 0, "3b secrets, caps or deletions in the text are refused", r);
}
// 4. no plannable worker; control-plane workers never planned
{
  const { env, prompts } = envWith([]);
  // CONTROL-PLANE-FUNCTIONAL-CANARY-1 (0.13.0): qnfo-ai and qnfo-gateway are planned now. CODE-LOOP-CONTROL-PLANE-1 (0.22.0, owner directive
  // 2026-10-19): so are qnfo-fleet-control, qnfo-ops, qnfo-deploy-guard and this worker; the scorer host and the scorer still never are.
  issue(env, { title: "METRIC-TRIGGER-7-Z: cost gap", description: "Find the top callers in ai_spend_ledger (owner qnfo-observability) and fix the qnfo-autonomy-scorer deploy route" });
  const r = await plan(env);
  ok(r.outcome === "not-code" && /names no worker/.test(plans(env)[0].detail) && prompts.length === 0, "4 control-plane workers (qnfo-observability, qnfo-autonomy-scorer) are never planned", plans(env)[0]);
}
// 5. the model says not code; 6. a made-up anchor is caught
{
  const { env } = envWith([JSON.stringify({ code_fixable: false, reason: "needs a D1 config row, not code" }), FIX("  if (path === \"/api/vote\") {")]);
  const a = issue(env, { title: "METRIC-TRIGGER-10-A: q08-signal-engine posts too often", description: "lower q08_max_per_day in ops_config" });
  const b = issue(env, { title: "METRIC-TRIGGER-11-B: q08-signal-engine vote route", description: "/api/f should refuse GET" });
  let r = await plan(env);
  ok(r.issue === a && r.outcome === "not-code" && /D1 config/.test(plans(env).find((p) => p.issue_id === a).detail), "5 a non-code issue is recorded with the model's reason", r);
  r = await plan(env);
  ok(r.issue === b && r.outcome === "invalid" && tasks(env).length === 0, "6 an anchor that is not in the file never becomes a task", plans(env).find((p) => p.issue_id === b));
}
const WIP = Number((/^const PLAN_WIP = (\d+);/m.exec(fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8")) || [])[1] || 3); // CODE-LOOP-2X-1: PLAN_WIP 6
// 7. caps: work in progress and the daily cap
{
  const { env, prompts } = envWith([]);
  const d = env.AUDIT_DB._db;
  await plan(env); // creates the schema
  for (let i = 0; i < WIP; i++) d.prepare("INSERT INTO code_tasks (id, repo, path, goal, status, step, attempts, created_at, updated_at) VALUES (?, 'qnfo-workers', 'x/worker.js', 'g', 'queued', 'read', 0, 'n', 'n')").run("ct_w" + i);
  issue(env, { title: "METRIC-TRIGGER-12-C: q08-signal-engine", description: "/api/f" });
  let r = await plan(env);
  ok(!r.planned && /work in progress/.test(r.why) && prompts.length === 0, "7a no planning while PLAN_WIP code tasks are unfinished", r);
  // PLAN-WIP-TUNABLE-1 (0.18.27, agent_issues 100086): ops_config code_plan_wip lifts the gate without a deploy.
  d.exec("CREATE TABLE IF NOT EXISTS ops_config (key TEXT PRIMARY KEY, value TEXT)");
  d.exec("INSERT OR REPLACE INTO ops_config VALUES ('code_plan_wip', '40')");
  r = await plan(env);
  ok(!/work in progress/.test(String(r.why || "")) && prompts.length === 1, "7a4 code_plan_wip 40 lets the planner run with PLAN_WIP tasks unfinished", r);
  d.exec("DELETE FROM ops_config WHERE key = 'code_plan_wip'");
  prompts.length = 0;
  d.exec("DELETE FROM issue_plans");
  issue(env, { title: "METRIC-TRIGGER-15-C: q08-signal-engine", description: "/api/f" });
  d.exec("DELETE FROM code_tasks");
  // PLAN-WIP-SUPERSEDED-1 (0.18.25, agent_issues 100074): superseded is terminal, so PLAN_WIP superseded tasks plus one live
  // task under the gate do not lock the planner out (8 superseded rows stalled issue_plans for 20 h on 2026-10-18/19).
  for (let i = 0; i < WIP; i++) d.prepare("INSERT INTO code_tasks (id, repo, path, goal, status, step, attempts, created_at, updated_at) VALUES (?, 'qnfo-workers', 'x/worker.js', 'g', 'superseded', 'read', 0, 'n', 'n')").run("ct_s" + i);
  r = await plan(env);
  ok(!/work in progress/.test(String(r.why || "")), "7a1 superseded code tasks are not work in progress", r);
  ok(prompts.length === 1, "7a1 the planner reached the model with only superseded tasks on the books", prompts.length);
  prompts.length = 0;
  d.exec("DELETE FROM code_tasks"); d.exec("DELETE FROM issue_plans");
  issue(env, { title: "METRIC-TRIGGER-14-C: q08-signal-engine", description: "/api/f" });
  // PLAN-WIP-HANDOFF-1: tasks waiting on the merge runner are not this worker's work in progress, but are bounded.
  for (let i = 0; i < 10; i++) d.prepare("INSERT INTO code_tasks (id, repo, path, goal, status, step, attempts, created_at, updated_at) VALUES (?, 'qnfo-workers', 'x/worker.js', 'g', ?, 'done', 0, 'n', 'n')").run("ct_h" + i, ["branch_pushed", "published", "pr_open"][i % 3]);
  r = await plan(env);
  ok(!/work in progress|merge backlog/.test(String(r.why || "")), "7a2 ten tasks waiting on the merge runner do not lock the planner out", r);
  ok(prompts.length === 1, "7a2 the planner reached the model for the waiting issue", prompts.length);
  prompts.length = 0;
  for (let i = 10; i < 12; i++) d.prepare("INSERT INTO code_tasks (id, repo, path, goal, status, step, attempts, created_at, updated_at) VALUES (?, 'qnfo-workers', 'x/worker.js', 'g', 'branch_pushed', 'done', 0, 'n', 'n')").run("ct_h" + i);
  issue(env, { title: "METRIC-TRIGGER-13-C: q08-signal-engine", description: "/api/f" });
  r = await plan(env);
  ok(!r.planned && /merge backlog/.test(r.why), "7a3 twelve tasks waiting on the merge runner pause planning", r);
  d.exec("DELETE FROM code_tasks");
  const today = new Date().toISOString();
  for (let i = 0; i < 24; i++) d.prepare("INSERT INTO issue_plans (issue_id, planned_at, outcome, model) VALUES (?, ?, 'not-code', 'm')").run(9000 + i, today);
  r = await plan(env);
  ok(!r.planned && /daily cap/.test(r.why) && prompts.length === 0, "7b at most 24 plans a day (PLAN-DAILY-24-1)", r);
  // CODE-LOOP-CEILINGS-TUNABLE-1 (0.18.26): ops_config code_plan_daily_cap moves the cap without a deploy; a bad value keeps the default.
  d.exec("CREATE TABLE IF NOT EXISTS ops_config (key TEXT PRIMARY KEY, value TEXT)");
  d.exec("INSERT INTO ops_config VALUES ('code_plan_daily_cap', 'x')");
  r = await plan(env);
  ok(!r.planned && r.why === "daily cap 24", "7b1 an unreadable code_plan_daily_cap keeps the default 24", r);
  d.exec("UPDATE ops_config SET value = '48' WHERE key = 'code_plan_daily_cap'");
  r = await plan(env);
  ok(!/daily cap/.test(String(r.why || "")), "7b1 code_plan_daily_cap 48 lets the 25th plan of the day through", r);
  d.exec("UPDATE ops_config SET value = '24' WHERE key = 'code_plan_daily_cap'");
  prompts.length = 0;
}
// 7c. refusals cost no model call: several are decided in one tick, they do not use the daily cap, and the tick still plans
{
  const { env, prompts } = envWith([FIX('  if (path === "/api/f") {')]);
  const d = env.AUDIT_DB._db;
  await plan(env);
  const today = new Date().toISOString();
  for (let i = 0; i < 20; i++) d.prepare("INSERT INTO issue_plans (issue_id, planned_at, outcome) VALUES (?, ?, 'refused')").run(8000 + i, today);
  const s1 = issue(env, { title: "METRIC-TRIGGER-20-S: q08-signal-engine auth", category: "security" });
  const s2 = issue(env, { title: "METRIC-TRIGGER-21-T: cost", description: "nothing named here" });
  const s3 = issue(env, { title: "METRIC-TRIGGER-22-U: q08-signal-engine votes", description: "/api/f accepts GET" });
  const r = await plan(env);
  const out = Object.fromEntries(plans(env).filter((p) => p.issue_id < 8000).map((p) => [p.issue_id, p.outcome]));
  ok(out[s1] === "refused" && out[s2] === "not-code" && out[s3] === "queued" && prompts.length === 1 && tasks(env).length === 1, "7c two cheap decisions and one model plan in a single tick, past 20 refusals today", { r, out });
}
// 8. a recorded 'not-code' is re-planned only after 7 days; fresh issues wait 15 minutes; code-task issues are left to intake
{
  const { env } = envWith([JSON.stringify({ code_fixable: false, reason: "still not code" })]);
  const d = env.AUDIT_DB._db;
  await plan(env);
  const a = issue(env, { title: "METRIC-TRIGGER-13-D: q08-signal-engine", description: "/api/f" });
  d.prepare("INSERT INTO issue_plans (issue_id, planned_at, outcome) VALUES (?, ?, 'not-code')").run(a, new Date(Date.now() - 2 * 864e5).toISOString());
  issue(env, { title: "METRIC-TRIGGER-14-E: q08-signal-engine fresh", description: "/api/f", created_at: Date.now() });
  issue(env, { title: "OWNER-TASK-1: q08-signal-engine", description: "code-task: repo=qnfo-workers path=q08-signal-engine/worker.js", source: "qnfo-fleet-dashboard:owner-request" });
  let r = await plan(env);
  ok(!r.planned, "8a a 2-day-old 'not-code', a 2-minute-old issue and a code-task issue are all left alone", r);
  d.prepare("UPDATE issue_plans SET planned_at = ? WHERE issue_id = ?").run(new Date(Date.now() - 8 * 864e5).toISOString(), a);
  r = await plan(env);
  ok(r.issue === a && r.outcome === "not-code" && plans(env).find((p) => p.issue_id === a).attempts === 2, "8b after 7 days it is asked again", plans(env).find((p) => p.issue_id === a));
}
// 9. owner tasks from the dashboard are trusted; the cron tick runs the planner after its steps
{
  const { env } = envWith([FIX("function post() {", { goal: "Inside post(), before the return, add a call that logs the post id to the console, and change nothing else." })]);
  issue(env, { title: "OWNER-TASK-7: qnfo-social logs post ids", description: "make qnfo-social log the id of each post", source: "qnfo-fleet-dashboard:owner-request" });
  await worker.scheduled({}, Object.assign(env.env || env, {}), { waitUntil: async (p) => { await p; } });
  await new Promise((r) => setTimeout(r, 50));
  const t = tasks(env);
  ok(t.length === 1 && t[0].path === "qnfo-social/worker.js" && plans(env)[0].outcome === "queued", "9 an owner task from the dashboard is planned by the cron tick itself", plans(env));
}
// 10. a longer worker name wins over its prefix (qnfo-ai-search, not qnfo-ai)
{
  const { env, prompts } = envWith([JSON.stringify({ code_fixable: false, reason: "x" })]);
  FILES["qnfo-ai-search/worker.js"] = "function ask() {}";
  issue(env, { title: "METRIC-TRIGGER-15-F: qnfo-ai-search answers fail", description: "qnfo-ai-search returns empty answers" });
  await plan(env);
  ok(prompts.length === 1 && prompts[0].input.messages[1].content.includes("WORKER: qnfo-ai-search"), "10 qnfo-ai-search is planned as itself, not as qnfo-ai", prompts[0] && prompts[0].input.messages[1].content.slice(0, 400));
}
// CODE-LOOP-CEILINGS-TUNABLE-1: the tick's lane count reads ops_config code_tick_lanes, bounded 1-16, default 16.
{
  const { env } = envWith([]);
  const d = env.AUDIT_DB._db;
  const lanesOf = async () => (await call(env, "POST", "/v1/tick")).lanes;
  await call(env, "POST", "/v1/plan");
  let l = await lanesOf();
  ok(l === 16, "11 the tick runs 16 lanes with no ops_config row", l);
  d.exec("CREATE TABLE IF NOT EXISTS ops_config (key TEXT PRIMARY KEY, value TEXT)");
  d.exec("INSERT OR REPLACE INTO ops_config VALUES ('code_tick_lanes', '12')");
  l = await lanesOf();
  ok(l === 12, "11 code_tick_lanes 12 runs 12 lanes", l);
  d.exec("UPDATE ops_config SET value = '99' WHERE key = 'code_tick_lanes'");
  l = await lanesOf();
  ok(l === 16, "11 code_tick_lanes is bounded at 16", l);
}
// PLAN-UNTRUSTED-RECORD-1 (0.18.28): 45 untrusted critical issues ahead of one trusted medium issue no longer starve it. Before, the
// untrusted rows were skipped unrecorded and filled the 40-row window at every tick.
{
  const { env, prompts } = envWith([]);
  for (let i = 0; i < 45; i++) issue(env, { title: "Feed item " + i + ": q08-signal-engine", description: "from a feed", source: "radar-hub", priority: "critical" });
  issue(env, { title: "METRIC-TRIGGER-77-Z: q08-signal-engine", description: "/api/f", priority: "medium" });
  let reached = false;
  for (let t = 0; t < 8 && !reached; t++) { await plan(env); reached = prompts.length > 0; }
  ok(reached, "12 a trusted issue behind 45 untrusted critical ones reaches the model within 8 ticks", prompts.length);
}
// PLAN-TOPOLOGY-1 (0.19.0, agent_issues 100102): an issue that names only tables is attributed through the fleet graph to the
// one plannable worker that writes them; the prompt carries a TOPOLOGY block; a tie, a control-plane-only writer, or no graph
// leaves the old "names no worker" decision.
{
  const graph = new DatabaseSync(":memory:");
  graph.exec("CREATE TABLE fg_edge (src TEXT, rel TEXT, dst TEXT, scope TEXT, confidence TEXT)");
  const e = graph.prepare("INSERT INTO fg_edge VALUES (?, ?, ?, 'code', ?)");
  e.run("fn:qnfo-social#drain", "writes", "d1t:qnfo-audit.social_posts", "EXTRACTED");
  e.run("fn:qnfo-social#drain", "writes", "d1t:qnfo-audit.social_queue", "EXTRACTED");
  e.run("fn:qnfo-ai-search#ask", "writes", "d1t:qnfo-audit.social_queue", "EXTRACTED");
  e.run("fn:qnfo-ai-search#ask", "writes", "d1t:qnfo-audit.social_posts", "INFERRED");
  e.run("fn:qnfo-fleet-control#tick", "writes", "d1t:qnfo-audit.fleet_tick", "EXTRACTED");
  e.run("fn:qnfo-social#drain", "reads", "d1t:qnfo-audit.paper_queue", "EXTRACTED");
  e.run("worker:qnfo-social", "has_cron", "cron:qnfo-social@30 * * * *", "EXTRACTED");
  e.run("binding:qnfo-ops.CH_QNFO_SOCIAL", "binds", "worker:qnfo-social", "EXTRACTED");
  e.run("fn:q08-signal-engine#a", "writes", "d1t:qnfo-audit.tie_a", "EXTRACTED");
  e.run("fn:qnfo-social#b", "writes", "d1t:qnfo-audit.tie_b", "EXTRACTED");
  const gdb = { prepare: (sql) => { let a = []; const st = { bind: (...x) => { a = x; return st; }, all: async () => ({ results: graph.prepare(sql).all(...a) }), first: async () => graph.prepare(sql).get(...a) || null }; return st; } };
  {
    const { env, prompts } = envWith([JSON.stringify({ code_fixable: false, reason: "x" })]);
    env.GRAPH_DB = gdb;
    const id = issue(env, { title: "STALL-1: social_posts stopped growing", description: "social_posts and social_queue have no row since 06:00", source: "claude-session-x" });
    await plan(env);
    const u = prompts[0] && prompts[0].input.messages[1].content;
    ok(prompts.length === 1 && u.includes("WORKER: qnfo-social"), "13a an issue naming only tables is planned on the worker that writes most of them", u && u.slice(0, 300));
    ok(u && u.includes("TOPOLOGY (fleet graph):") && u.includes("writes tables: social_posts, social_queue") && u.includes("reads tables: paper_queue") && u.includes("crons: 30 * * * *") && u.includes("bound by workers: qnfo-ops"), "13b the prompt carries the worker's topology", u && u.slice(u.indexOf("TOPOLOGY"), u.indexOf("SNIPPETS")));
    ok(/fleet graph: qnfo-social writes social_posts, social_queue/.test(plans(env).find((p) => p.issue_id === id).detail || "") || plans(env).find((p) => p.issue_id === id).outcome === "not-code", "13c the decision is recorded", plans(env));
  }
  {
    const { env, prompts } = envWith([]);
    env.GRAPH_DB = gdb;
    issue(env, { title: "TICK-1: fleet_tick rows missing", description: "fleet_tick has gaps", source: "claude-session-x" });
    issue(env, { title: "TIE-1: tie_a and tie_b", description: "tie_a tie_b", source: "claude-session-x" });
    await plan(env);
    ok(prompts.length === 0 && plans(env).length === 2 && plans(env).every((p) => /names no worker/.test(p.detail)), "13d a control-plane-only writer and a tie attribute nothing", plans(env));
  }
  {
    const { env, prompts } = envWith([]);
    issue(env, { title: "STALL-2: social_posts stopped", description: "social_posts", source: "claude-session-x" });
    await plan(env);
    ok(prompts.length === 0 && /names no worker/.test(plans(env)[0].detail), "13e without GRAPH_DB the planner is unchanged", plans(env));
  }
  {
    const { env, prompts } = envWith([JSON.stringify({ code_fixable: false, reason: "x" })]);
    env.GRAPH_DB = { prepare: () => { throw new Error("D1_ERROR: no such table: fg_edge"); } };
    issue(env, { title: "METRIC-TRIGGER-9-Q08-VOTES: q08-signal-engine", description: "/api/f" });
    await plan(env);
    ok(prompts.length === 1 && !prompts[0].input.messages[1].content.includes("TOPOLOGY"), "13f a failing graph read changes nothing", prompts.length);
  }
}
// Companion-inline anchors belong to the editable source, not its generated copy.
{
  const source = 'export function companionPage() {\n  return "<h2>Recently captured</h2>";\n}';
  const anchor = '  return "<h2>Recently captured</h2>";';
  const outside = "function outsideCompanion() { return 1; }";
  FILES["personal-api/worker.js"] = [
    outside,
    "// COMPANION-INLINE-BEGIN (generated)",
    "var CMP = (() => {",
    source.replace("export ", ""),
    "})();",
    "// COMPANION-INLINE-END",
  ].join("\n");
  for (const [name, pick, companion, redirected] of [
    ["inline markup", anchor, source, true],
    ["inline export", "function companionPage() {", source, true],
    ["outside block", outside, source, false],
    ["missing source", anchor, null, null],
    ["stale source", anchor, "export function other() {}", null],
    ["ambiguous source", anchor, source + "\n" + source, null],
  ]) {
    if (companion == null) delete FILES["personal-api/companion.js"];
    else FILES["personal-api/companion.js"] = companion;
    const { env } = envWith([FIX(pick)]);
    env.AUDIT_DB._db.prepare("INSERT INTO service_registry VALUES ('personal-api', 'live', 'worker', '')").run();
    const id = issue(env, { title: "personal-api: repair companion Recently captured markup", source: "claude-session-x" });
    const r = await plan(env), t = tasks(env);
    if (redirected == null) {
      ok(r.outcome === "invalid" && t.length === 0, name + ": an unverifiable source never queues a generated-file task", r);
    } else {
      const expected = "personal-api/" + (redirected ? "companion.js" : "worker.js");
      const description = env.AUDIT_DB._db.prepare("SELECT description FROM agent_issues WHERE id = ?").get(id).description;
      const goal = t[0] && t[0].goal;
      ok(r.path === expected && plans(env)[0].path === expected &&
        t.length === 1 && t[0].path === expected,
        name + ": plan and task target the correct file without widening merge scope", r);
      ok(t[0] && JSON.parse(t[0].ctx).anchor === pick,
        name + ": the unique source anchor is retained");
      ok(goal,
        name + ": only redirected tasks require same-commit regeneration", goal);
    }
  }
}
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
