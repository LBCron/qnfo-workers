// NOOP-PROPOSAL-GATE-1 offline suite (qnfo-code-orchestrator 0.3.17, agent_issues #2018, TP-1e, pillar autonomy).
// On 2026-10-06 two code tasks answered a feature goal with a two-line edit that reworded a string literal on the anchor line
// (ct_r3k9lrbd7oijxr pasted the issue prose into an audit message; ct_5fibb664gtvew4 reworded an error message). Both parsed,
// passed the verifier and reached ready_to_publish; a session review was the only stop. This suite proves:
//   A. a prose paraphrase inside a string is refused before verify, the next rung is told why, and a real change then lands;
//   B. two no-op proposals in a row end the task needs_human with the reason, after exactly two model calls;
//   C. a comment-only edit and a VERSION-only edit are refused with their own reasons;
//   D. a code-like string change (a model id, a SQL fragment) is NOT a no-op and reaches ready_to_publish;
//   E. the gate also covers whole-file mode;
//   F. /health names the capability.
// Real SQL (node:sqlite behind a D1-shaped shim), scripted model, scripted GitHub raw reads.
// Run: node --no-warnings qnfo-code-orchestrator/noop-gate.test.mjs   (exit 0 = all passed)
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
const atLeast = (v, min) => { const a = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v || "")), b = min.split(".").map(Number); if (!a) return false; for (let i = 0; i < 3; i++) { if (+a[i + 1] !== b[i]) return +a[i + 1] > b[i]; } return true; }; // semver minimum, so a minor bump keeps passing

const here = path.dirname(fileURLToPath(import.meta.url));
const worker = (await import(pathToFileURL(path.join(here, "worker.js")).href)).default;

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? "  -- " + JSON.stringify(x).slice(0, 600) : "")); } };

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
    CREATE UNIQUE INDEX idx_agent_issues_open_title ON agent_issues(title) WHERE status = 'open';
    CREATE TABLE cloud_ops_events (id TEXT, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT);`);
  return { prepare: wrap, _db: db };
}

// ---- the fixture: a small worker with an audit line (the anchor), a model id and a SQL string ----
const AUDIT_LINE = `  await audit(env, "ready", task.id + " ready_to_publish on " + task.branch, "ok");`;
const MODEL_LINE = `  return env.MODEL || "@cf/qwen/qwen2.5-coder-32b-instruct";`;
const SQL_LINE = `const Q = "SELECT COUNT(*) AS n FROM code_tasks WHERE status='queued'";`;
const BASE = [
  "// fixture worker (test data)",
  'var VERSION = "1.2.3-fixture";',
  'const WORKER = "fx";',
  SQL_LINE,
  "async function audit(env, kind, text, status) { return env.AUDIT_DB.prepare(\"INSERT INTO cloud_ops_events (kind, text, status) VALUES (?,?,?)\").bind(kind, text, status).run(); }",
  "async function publish(env, task) {",
  AUDIT_LINE,
  "  return { ok: true };",
  "}",
  "function pick(env) {",
  MODEL_LINE,
  "}",
  "export default { async fetch() { return new Response('ok'); } };",
  "",
].join("\n");
const FILES = { "fx-worker/worker.js": BASE, "fx-worker/deployed-current.worker.js": BASE };
globalThis.fetch = async (u) => {
  const m = /^https:\/\/raw\.githubusercontent\.com\/QNFO\/qnfo-workers\/main\/(.+)$/.exec(String(u));
  const p = m ? decodeURIComponent(m[1]) : null;
  return p && FILES[p] != null ? new Response(FILES[p], { status: 200 }) : new Response("nf", { status: 404 });
};
const fakeLoader = { load: () => ({ getEntrypoint: () => ({ fetch: async () => new Response("ok") }) }) };
function envWith(replies) {
  const calls = [];
  const env = { ORCH_TOKEN: "t0ken", AUDIT_DB: makeD1(), PR_PUBLISH_MODE: "pull", JS_VERIFY: "dynamic", LOADER: fakeLoader,
    AI: { run: async (model, input) => { calls.push({ model, prompt: input.messages[1].content, sys: input.messages[0].content }); const r = replies.shift(); return { response: typeof r === "function" ? r(input) : (r == null ? "" : r) }; } } };
  return { env, calls };
}
const hdr = { authorization: "Bearer t0ken", "content-type": "application/json" };
const tick = async (env) => (await worker.fetch(new Request("https://x/v1/tick", { method: "POST", headers: hdr, body: JSON.stringify({ maxSteps: 12, budgetMs: 25000, plan: false, intake: false }) }), env)).json();
const addTask = async (env, goal, anchor) => (await worker.fetch(new Request("https://x/v1/tasks", { method: "POST", headers: hdr, body: JSON.stringify({ repo: "qnfo-workers", path: "fx-worker/worker.js", goal, anchor }) }), env)).json();
const row = (env) => env.AUDIT_DB._db.prepare("SELECT * FROM code_tasks").get();
const events = (env, kind) => env.AUDIT_DB._db.prepare("SELECT * FROM cloud_ops_events WHERE kind = ?").all(kind);
const block = (a, b) => "<<<<<<< SEARCH\n" + a + "\n=======\n" + b + "\n>>>>>>> REPLACE";

const GOAL = "At ready_to_publish, create the branch and commit the edited file through the GitHub Contents API with the fleet token the merge runner already uses, then set status branch_pushed.";
const PARAPHRASE = `  await audit(env, "ready", task.id + " ready_to_publish, create the branch and commit the edited file through the GitHub Contents API with the fleet token the merge runner already uses, then set status branch_pushed on " + task.branch, "ok");`;
const REAL = [
  `  const r = await fetch("https://api.github.com/repos/QNFO/qnfo-workers/contents/" + task.path, { method: "PUT", headers: { authorization: "Bearer " + env.GITHUB_TOKEN } });`,
  `  await audit(env, "ready", task.id + (r.ok ? " branch_pushed on " : " push failed on ") + task.branch, r.ok ? "ok" : "error");`,
].join("\n");

// ===== A. the live failure, then the next rung lands a real change =====
{
  const { env, calls } = envWith([block(AUDIT_LINE, PARAPHRASE), block(AUDIT_LINE, REAL)]);
  const a = await addTask(env, GOAL, AUDIT_LINE);
  ok(a.ok === true, "A0 the task is queued", a);
  await tick(env);
  const t = row(env);
  ok(t.status === "ready_to_publish" && t.attempts === 1 && t.last_error == null, "A1 after one refused paraphrase the next rung's real change reached ready_to_publish", { st: t.status, a: t.attempts, err: t.last_error });
  ok(calls.length === 2 && /noop-proposal: the edit changes only the words inside string literals or comments \(1 line\)/.test(calls[1].prompt), "A2 rung 2 was told the paraphrase was a no-op and why", calls[1] && calls[1].prompt.slice(-420));
  ok(/Rewording a string literal or a comment changes no behaviour and is refused/.test(calls[0].sys), "A2 the system prompt says so up front");
  const ev = events(env, "code-task.noop-refused");
  ok(ev.length === 1 && ev[0].status === "retry" && /\(1 of 2\)/.test(ev[0].text) && JSON.parse(ev[0].meta).terminal === false, "A3 one code-task.noop-refused event, status retry", ev);
  const cx = JSON.parse(t.ctx);
  ok(cx.noop === 1 && /api\.github\.com/.test(cx.patch) && /1\.2\.4-codeagent/.test(cx.patch) && /deployed-current\.worker\.js/.test(cx.patch), "A4 the patch carries the real change, the VERSION bump and the mirror", { noop: cx.noop, len: (cx.patch || "").length });
}

// ===== B. two no-ops in a row: needs_human with the reason, no third call =====
{
  const { env, calls } = envWith([block(AUDIT_LINE, PARAPHRASE), block(AUDIT_LINE, PARAPHRASE.replace("then set status", "and set the status")), block(AUDIT_LINE, REAL)]);
  await addTask(env, GOAL, AUDIT_LINE);
  await tick(env);
  const t = row(env);
  ok(t.status === "needs_human" && t.attempts === 2 && /noop-proposal/.test(t.last_error) && /2 no-op proposals in a row/.test(t.last_error), "B1 the second no-op ends the task needs_human with the reason", { st: t.status, a: t.attempts, err: t.last_error });
  ok(calls.length === 2, "B1 exactly two model calls: the real-change reply was never requested", calls.length);
  const ev = events(env, "code-task.noop-refused");
  ok(ev.length === 2 && ev[1].status === "error" && JSON.parse(ev[1].meta).terminal === true, "B2 the second event is terminal (status error)", ev.map((e) => e.status));
  await tick(env);
  ok(calls.length === 2 && row(env).status === "needs_human", "B3 a needs_human task is not claimed again");
}

// ===== C. comment-only and VERSION-only edits are refused with their own reasons =====
{
  const { env, calls } = envWith([block(AUDIT_LINE, AUDIT_LINE + " // pushes the branch through the Contents API"), block(AUDIT_LINE, REAL)]);
  await addTask(env, GOAL, AUDIT_LINE);
  await tick(env);
  ok(row(env).status === "ready_to_publish" && /noop-proposal: only comments changed/.test(calls[1].prompt), "C1 a comment-only edit is refused as such and the next rung is told", calls[1] && calls[1].prompt.slice(-300));
}
{
  const { env, calls } = envWith([block('var VERSION = "1.2.3-fixture";', 'var VERSION = "1.2.4-fixture";'), block(AUDIT_LINE, REAL)]);
  await addTask(env, GOAL, AUDIT_LINE);
  await tick(env);
  ok(row(env).status === "ready_to_publish" && /noop-proposal: only the VERSION line changed/.test(calls[1].prompt), "C2 a VERSION-only edit is refused as such", calls[1] && calls[1].prompt.slice(-300));
}

// ===== D. code-like string changes are real changes =====
{
  const { env, calls } = envWith([block(MODEL_LINE, MODEL_LINE.replace("@cf/qwen/qwen2.5-coder-32b-instruct", "@cf/zai-org/glm-5.3"))]);
  await addTask(env, "Switch pick() to the glm-5.3 model id as the default.", MODEL_LINE);
  await tick(env);
  const t = row(env);
  ok(t.status === "ready_to_publish" && calls.length === 1 && events(env, "code-task.noop-refused").length === 0, "D1 a model-id change inside a string is not a no-op", { st: t.status, err: t.last_error });
}
{
  const { env, calls } = envWith([block(SQL_LINE, SQL_LINE.replace("status='queued'", "status IN ('queued','publishing')"))]);
  await addTask(env, "Count publishing tasks as queued in Q.", SQL_LINE);
  await tick(env);
  const t = row(env);
  ok(t.status === "ready_to_publish" && calls.length === 1 && events(env, "code-task.noop-refused").length === 0, "D2 a SQL change inside a string is not a no-op", { st: t.status, err: t.last_error });
}

{
  // NOOP-SQL-LITERAL-1 (#1001468): a widened IN list in a long SELECT is a condition change even when the literal reads like words.
  const LONG = SQL_LINE;
  const { env, calls } = envWith([block(LONG, LONG.replace("status='queued'", "status='queued' AND label IN ('active holding monitoring probed due now')"))]);
  await addTask(env, "Widen the status filter in the remediation contracts tick so monitoring contracts are probed.", LONG);
  await tick(env);
  const t = row(env);
  ok(t.status === "ready_to_publish" && calls.length === 1 && events(env, "code-task.noop-refused").length === 0, "D6 a widened IN list in a long SQL literal is a real change", { st: t.status, err: t.last_error });
}

{
  // self-repair.test.mjs's own landing: a SQL cutoff the goal quotes verbatim is inserted inside a string. Code-like, so it passes.
  const CUT = " AND f.created_at >= '2026-10-03T00:00:00Z'";
  const { env, calls } = envWith([block(SQL_LINE, SQL_LINE.replace("status='queued'", "status='queued'" + CUT))]);
  await addTask(env, "In Q add the condition" + CUT + " directly after status='queued'. Change nothing else.", SQL_LINE);
  await tick(env);
  const t = row(env);
  ok(t.status === "ready_to_publish" && calls.length === 1 && events(env, "code-task.noop-refused").length === 0, "D3 a SQL fragment quoted verbatim by the goal is still a real change", { st: t.status, err: t.last_error });
}

// ===== D4. NOOP-COPY-GOAL-1: a goal that asks for wording makes a literal-only edit the change =====
{
  const { env, calls } = envWith([block(AUDIT_LINE, PARAPHRASE)]);
  await addTask(env, "Reword the ready_to_publish audit label in plain language: " + GOAL, AUDIT_LINE);
  await tick(env);
  const t = row(env);
  ok(t.status === "ready_to_publish" && calls.length === 1 && events(env, "code-task.noop-refused").length === 0, "D4 a copy goal lets a prose-only string edit through to the verifier", { st: t.status, err: t.last_error });
}
{
  const { env, calls } = envWith([block(AUDIT_LINE, AUDIT_LINE + " // pushes the branch through the Contents API"), block(AUDIT_LINE, REAL)]);
  await addTask(env, "Reword the audit label: " + GOAL, AUDIT_LINE);
  await tick(env);
  ok(row(env).status === "ready_to_publish" && /noop-proposal: only comments changed/.test(calls[1].prompt), "D5 a copy goal still refuses a comment-only edit");
}

// ===== E. whole-file mode (no anchor, small file) is gated the same way =====
{
  const asFile = (text) => "```file\n" + text + "```";
  const { env, calls } = envWith([asFile(BASE.replace(AUDIT_LINE, PARAPHRASE)), asFile(BASE.replace(AUDIT_LINE, REAL))]);
  await addTask(env, GOAL);
  await tick(env);
  const t = row(env);
  const cx = JSON.parse(t.ctx);
  ok(cx.mode !== "patch" && t.status === "ready_to_publish" && t.attempts === 1 && /noop-proposal/.test(calls[1].prompt) && events(env, "code-task.noop-refused").length === 1, "E1 whole-file mode: the paraphrase is refused and the real file lands", { mode: cx.mode, st: t.status, a: t.attempts });
}

// ===== F. /health =====
{
  const { env } = envWith([]);
  const h = await (await worker.fetch(new Request("https://x/health"), env)).json();
  ok(atLeast(h.version, "0.3.17") && /^\d+\.\d+\.\d+-/.test(h.version) && h.capabilities.includes("noop-gate") && h.limitations.some((l) => /NOOP-PROPOSAL-GATE-1/.test(l) && /2 such proposals in a row/.test(l)), "F1 /health names the gate and its limit", { v: h.version });
}

console.log("noop-gate: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
