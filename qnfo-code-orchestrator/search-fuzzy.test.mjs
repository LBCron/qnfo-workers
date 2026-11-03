// SEARCH-FUZZY-1 offline suite (qnfo-code-orchestrator 0.11.0, pillar autonomy).
// Replays the 25 "SEARCH occurs 0 times" attempt failures (15 tasks, 7 days to 2026-10-12): SEARCH blocks that drift from the file in whitespace, quotes or blank lines.
// Proves: drift applies and is audited as code-task.edit-fuzzy; ambiguous or absent SEARCH still fails (with the closest file lines); exact match unchanged.
// Run: node --no-warnings qnfo-code-orchestrator/search-fuzzy.test.mjs   (exit 0 = all passed)
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
const atLeast = (v, min) => { const a = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v || "")), b = min.split(".").map(Number); if (!a) return false; for (let i = 0; i < 3; i++) { if (+a[i + 1] !== b[i]) return +a[i + 1] > b[i]; } return true; };

const here = path.dirname(fileURLToPath(import.meta.url));
const worker = (await import(pathToFileURL(path.join(here, "worker.js")).href)).default;
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? "  -- " + JSON.stringify(x).slice(0, 700) : "")); } };

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
  db.exec(`CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT DEFAULT 'optimization', priority TEXT DEFAULT 'medium', status TEXT DEFAULT 'open', linked_session TEXT, created_at INTEGER, updated_at INTEGER);
    CREATE TABLE cloud_ops_events (id TEXT, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT);`);
  return { prepare: wrap, _db: db };
}
// The fixture: qnfo-infra's shape around the paper-indexer lines ct_ygmwselr4c3dnj edited (4-space indent inside a function).
const L1 = '    const row = await env.QNFO_AUDIT.prepare("SELECT id, status FROM papers WHERE slug = ?1").bind(slug).first();';
const L2 = '    if (!row) return { ok: false, error: "no paper" };';
const L3 = '    return { ok: true, status: String(row.status || "draft") };';
const ANCHOR = "async function paperStatus(env, slug) {";
const lines = ['var VERSION = "2.3.1-fixture";', "// qnfo-infra (fixture)"];
for (let i = 0; i < 40; i++) lines.push("function filler" + i + "(env) { return env && env.FLAG_" + i + " ? " + i + " : 0; }");
lines.push(ANCHOR, L1, L2, L3, "}");
lines.push("function twice(a) {", "  if (a) {", "    return 1;", "  }", "  if (a) {", "    return 1;", "  }", "  return 0;", "}");
for (let i = 40; i < 60; i++) lines.push("function filler" + i + "(env) { return env && env.FLAG_" + i + " ? " + i + " : 0; }");
lines.push("export default { async fetch(req, env) { return new Response('ok'); } };", "");
const SRC = lines.join("\n");
const FILES = { "qnfo-infra/worker.js": SRC, "qnfo-infra/deployed-current.worker.js": SRC };
globalThis.fetch = async (u) => {
  const m = /^https:\/\/raw\.githubusercontent\.com\/QNFO\/qnfo-workers\/main\/(.+)$/.exec(String(u));
  const p = m ? decodeURIComponent(m[1]) : null;
  return p && FILES[p] != null ? new Response(FILES[p], { status: 200 }) : new Response("nf", { status: 404 });
};
const fakeLoader = { load: () => ({ getEntrypoint: () => ({ fetch: async () => new Response("ok") }) }) };
function envWith(replies) {
  const calls = [];
  const env = { ORCH_TOKEN: "t0ken", AUDIT_DB: makeD1(), PR_PUBLISH_MODE: "pull", JS_VERIFY: "dynamic", LOADER: fakeLoader,
    AI: { run: async (model, input) => { calls.push({ model, prompt: input.messages[1].content }); const r = replies.shift(); return { response: r == null ? "" : r }; } } };
  return { env, calls };
}
const hdr = { authorization: "Bearer t0ken", "content-type": "application/json" };
const tick = async (env, n) => (await worker.fetch(new Request("https://x/v1/tick", { method: "POST", headers: hdr, body: JSON.stringify({ maxSteps: n || 1, budgetMs: 25000, plan: false, intake: false }) }), env)).json();
const addTask = async (env, goal) => (await worker.fetch(new Request("https://x/v1/tasks", { method: "POST", headers: hdr, body: JSON.stringify({ repo: "qnfo-workers", path: "qnfo-infra/worker.js", goal: goal, anchor: ANCHOR }) }), env)).json();
const row = (env, id) => env.AUDIT_DB._db.prepare("SELECT * FROM code_tasks WHERE id=?").get(id);
const ctxOf = (r) => { try { return JSON.parse(r.ctx || "{}"); } catch (e) { return {}; } };
const events = (env, kind) => env.AUDIT_DB._db.prepare("SELECT text, meta, status FROM cloud_ops_events WHERE kind=? ORDER BY rowid").all(kind);
const block = (a, b) => "<<<<<<< SEARCH\n" + a + "\n=======\n" + b + "\n>>>>>>> REPLACE";
const ind = (s, n) => s.split("\n").map((l) => (l.trim() ? " ".repeat(n) + l.trim() : l)).join("\n");
// Steps the task until it parks its patch (pull mode: status ready_to_publish), fails once, or runs out of steps.
const runTask = async (env, id) => {
  for (let i = 0; i < 8; i++) {
    const r = row(env, id);
    if (!r || r.status !== "queued" || events(env, "code-task.fail").length) break;
    env.AUDIT_DB._db.prepare("UPDATE code_tasks SET lease_until=NULL WHERE id=?").run(id);
    await tick(env);
  }
  return row(env, id);
};
const firstFail = (env) => (events(env, "code-task.fail")[0] || {}).text || "";


// ===== 1. health =====
const h = await (await worker.fetch(new Request("https://x/health"), {})).json();
ok(atLeast(h.version, "0.11.0") && h.capabilities.indexOf("search-fuzzy") >= 0, "health: 0.11.0+ with search-fuzzy", { version: h.version });

// ===== 2. whitespace runs + blank line inside + smart quotes: applies, audited =====
{
  const drift = '    if  (!row)   return { ok: false, error: “no paper” };\n\n    return { ok: true, status: String(row.status || "draft") };';
  const fix = '    if (!row) return { ok: false, error: "no paper: " + slug };\n    return { ok: true, status: String(row.status || "draft"), id: row.id };';
  const { env, calls } = envWith([block(drift, fix)]);
  const c = await addTask(env, "paperStatus names the slug and returns the id");
  const r = await runTask(env, c.id);
  ok(calls.length === 1 && r.attempts === 0 && r.status === "ready_to_publish", "drifted SEARCH applies without a failed attempt", { status: r.status, attempts: r.attempts, last_error: r.last_error });
  const ev = events(env, "code-task.edit-fuzzy");
  ok(ev.length === 1 && ev[0].status === "ok" && /edit 1 matched/.test(ev[0].text), "one code-task.edit-fuzzy event", ev);
  ok(/\+    if \(!row\) return \{ ok: false, error: "no paper: " \+ slug \};/.test(String(ctxOf(r).patch || "")), "patch carries the REPLACE", String(ctxOf(r).patch || "").slice(0, 600));
}

// ===== 3. exact match: unchanged, no event =====
{
  const { env } = envWith([block(L2, '    if (!row) return { ok: false, error: "no paper: " + slug };')]);
  const c = await addTask(env, "name the slug");
  const r = await runTask(env, c.id);
  ok(r.attempts === 0 && r.status === "ready_to_publish" && events(env, "code-task.edit-fuzzy").length === 0, "exact SEARCH writes no fuzzy event", { status: r.status });
}

// ===== 4. ambiguous fuzzy match fails, never guessed =====
{
  const { env } = envWith([block("if  (a) {\n return 1;\n}", "if (a) {\n  return 2;\n}")]);
  const c = await addTask(env, "return 2");
  const r = await runTask(env, c.id);
  ok(r.attempts >= 1 && /occurs 0 times in the shown content exactly and 2 times/.test(firstFail(env)) && events(env, "code-task.edit-fuzzy").length === 0, "ambiguous drift fails with the count", firstFail(env));
}

// ===== 5. true miss: 0-times text kept, closest lines named =====
{
  const { env } = envWith([block('    if (!row) return { ok: false, error: "missing paper row" };\n    cleanup();', "    x();")]);
  const c = await addTask(env, "x");
  const r = await runTask(env, c.id);
  const f = String(r.last_error || "");
  ok(r.attempts >= 1 && /SEARCH text occurs 0 times in the shown content \(it must be copied verbatim/.test(f) && /the closest file lines start at line \d+/.test(f) && f.includes("\n" + L2), "miss keeps the 0-times text and quotes the complete closest file line", f);
}

console.log("search-fuzzy.test: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
