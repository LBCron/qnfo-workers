// MULTI-FILE-CODE-TASKS-1 offline suite (qnfo-code-orchestrator 0.12.0, agent_issues 2074, transformation lever T1.24, pillar autonomy).
// The loop edited one file, so a change that needs the worker's test or a migration with it waited for a session (19 open
// issues on 2026-10-06), and a task whose goal changes a behaviour a suite pins could only fail that suite. This suite proves:
//   A. POST /v1/tasks validates companions (a worker source, another directory, a denied path, too many are refused);
//   B. a worker, its existing test and a NEW migration are read, edited under FILE: lines, verified and parked as ONE patch
//      that `git apply` takes; ctx.paths names the companions that changed; only the worker gets the VERSION bump and mirror;
//   C. a block under a FILE: line that names no file of the task, a reply with no block for the task's own path, a NEW file
//      with a non-empty SEARCH, and a migration without its CI header each fail the attempt with a reason the next rung reads;
//   D. a companion that needs no change gets no block and stays out of the patch;
//   E. intake leaves a multi-path code-task line alone until ops_config code_merge_multi_file is on, then files the task with
//      its companions and their anchors (the n-th code-anchor line belongs to the n-th path).
// Real SQL (node:sqlite behind a D1-shaped shim), scripted model, scripted GitHub raw reads, real git for the patch.
// Run: node --no-warnings qnfo-code-orchestrator/multi-file.test.mjs   (exit 0 = all passed)
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "orch-multi-"));
fs.writeFileSync(path.join(tmp, "w.mjs"), fs.readFileSync(path.join(here, "worker.js"), "utf8") +
  "\nexport { intakeIssues as __intake, parseFileEdits as __parse, validExtras as __valid, migrationWhy as __migration, VERSION as __version };\n");
const mod = await import(pathToFileURL(path.join(tmp, "w.mjs")).href);
const worker = mod.default;
const atLeast = (v, min) => { const a = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v || "")), b = min.split(".").map(Number); if (!a) return false; for (let i = 0; i < 3; i++) { if (+a[i + 1] !== b[i]) return +a[i + 1] > b[i]; } return true; };

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? "  -- " + JSON.stringify(x).slice(0, 800) : "")); } };

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
    CREATE TABLE cloud_ops_events (id TEXT, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT);
    CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT, updated_at TEXT);`);
  return { prepare: wrap, _db: db };
}

// ---- fixture: a worker, its test, and no migration yet
const W = ['var VERSION = "3.1.4-fixture";', "// fixture worker (test data)"];
for (let i = 0; i < 30; i++) W.push("function filler" + i + "(env) { return env && env.FLAG_" + i + " ? " + i + " : 0; }");
W.push("export function quota(plan) {", "  if (plan === \"pro\") return 100;", "  return 10;", "}", "export default { async fetch() { return new Response('ok'); } };", "");
const WORKER_SRC = W.join("\n");
const TEST_SRC = ["import { quota } from './worker.js';", "let fail = 0;", "if (quota('pro') !== 100) { console.log('FAIL pro is 100'); fail++; }", "if (quota('free') !== 10) { console.log('FAIL free is 10'); fail++; }", "process.exit(fail ? 1 : 0);", ""].join("\n");
const README_SRC = "# fx-worker\n\nQuotas: pro 100, free 10.\n";
const P = "fx-worker/worker.js", T = "fx-worker/quota.test.mjs", M = "migrations/2026-10-12-fx-quota.sql", R = "fx-worker/README.md";
const FILES = {};
const serve = () => { for (const k of Object.keys(FILES)) delete FILES[k]; FILES[P] = WORKER_SRC; FILES["fx-worker/deployed-current.worker.js"] = WORKER_SRC; FILES[T] = TEST_SRC; FILES[R] = README_SRC; };
globalThis.fetch = async (u) => {
  const m = /^https:\/\/raw\.githubusercontent\.com\/QNFO\/qnfo-workers\/main\/(.+)$/.exec(String(u));
  const p = m ? decodeURIComponent(m[1]) : null;
  return p && FILES[p] != null ? new Response(FILES[p], { status: 200 }) : new Response("nf", { status: 404 });
};
const fakeLoader = { load: () => ({ getEntrypoint: () => ({ fetch: async () => new Response("ok") }) }) };
function envWith(replies) {
  const calls = [];
  const env = { ORCH_TOKEN: "t0ken", AUDIT_DB: makeD1(), PR_PUBLISH_MODE: "pull", JS_VERIFY: "dynamic", LOADER: fakeLoader,
    AI: { run: async (model, input) => { calls.push({ model, prompt: input.messages[1].content, sys: input.messages[0].content }); const r = replies.shift(); return { response: r == null ? "" : r }; } } };
  return { env, calls };
}
const hdr = { authorization: "Bearer t0ken", "content-type": "application/json" };
const tick = async (env) => (await worker.fetch(new Request("https://x/v1/tick", { method: "POST", headers: hdr, body: JSON.stringify({ maxSteps: 12, budgetMs: 25000, plan: false, intake: false, claims: false }) }), env)).json();
const post = async (env, body) => { const r = await worker.fetch(new Request("https://x/v1/tasks", { method: "POST", headers: hdr, body: JSON.stringify(body) }), env); return { status: r.status, body: await r.json() }; };
const row = (env) => env.AUDIT_DB._db.prepare("SELECT * FROM code_tasks").get();
const events = (env, kind) => env.AUDIT_DB._db.prepare("SELECT * FROM cloud_ops_events WHERE kind = ?").all(kind);
const block = (a, b) => "<<<<<<< SEARCH\n" + a + "\n=======\n" + b + "\n>>>>>>> REPLACE";
const GOAL = "The free plan's quota becomes 25; the test and a migration that records the new default follow.";
const ANCHOR = "export function quota(plan) {";
const MIG = "-- APPLY-BY: ci\n-- DB: qnfo-audit\n-- Rollback: UPDATE ops_config SET value = '10' WHERE key = 'fx_free_quota';\nINSERT INTO ops_config (key, value) VALUES ('fx_free_quota', '25') ON CONFLICT(key) DO UPDATE SET value = excluded.value;";
const B_WORKER = block("  return 10;", "  return 25;");
const B_TEST = block("if (quota('free') !== 10) { console.log('FAIL free is 10'); fail++; }", "if (quota('free') !== 25) { console.log('FAIL free is 25'); fail++; }");
const TEST_ANCHOR = "if (quota('free') !== 10) { console.log('FAIL free is 10'); fail++; }";
const B_MIG = "<<<<<<< SEARCH\n=======\n" + MIG + "\n>>>>>>> REPLACE";
const REPLY = "FILE: " + P + "\n" + B_WORKER + "\nFILE: " + T + "\n" + B_TEST + "\nFILE: " + M + "\n" + B_MIG + "\n";
const task = (extras) => ({ repo: "qnfo-workers", path: P, goal: GOAL, anchor: ANCHOR, extras });

// `git apply` of the parked patch on the files as they are on main; returns the resulting files.
function applyPatch(patch) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mf-"));
  fs.mkdirSync(path.join(dir, "fx-worker")); fs.mkdirSync(path.join(dir, "migrations"));
  for (const k of Object.keys(FILES)) fs.writeFileSync(path.join(dir, k), FILES[k]);
  fs.writeFileSync(path.join(dir, "p.patch"), patch);
  spawnSync("git", ["init", "-q"], { cwd: dir });
  const r = spawnSync("git", ["-c", "core.autocrlf=false", "apply", "p.patch"], { cwd: dir, encoding: "utf8" });
  const read = (f) => { try { return fs.readFileSync(path.join(dir, f), "utf8"); } catch (e) { return null; } };
  const out = { ok: r.status === 0, err: (r.stderr || "").slice(0, 300), worker: read(P), mirror: read("fx-worker/deployed-current.worker.js"), test: read(T), mig: read(M), readme: read(R) };
  fs.rmSync(dir, { recursive: true, force: true });
  return out;
}

ok(atLeast(mod.__version, "0.12.0"), "the worker is 0.12.0 or later", mod.__version);

// ===== A. validation =====
{
  serve();
  const { env } = envWith([]);
  const bad = [
    [{ path: "fx-worker/deployed-current.worker.js" }], [{ path: "other-worker/x.test.mjs" }], [{ path: "other-worker/worker.js" }], [{ path: ".github/workflows/x.yml" }],
    [{ path: "fx-worker/wrangler.toml" }], [{ path: "../x.mjs" }], [{ path: P }], [{ path: T }, { path: T }], [{ path: "fx-worker/a.mjs" }, { path: "fx-worker/b.mjs" }, { path: "fx-worker/c.mjs" }, { path: "fx-worker/d.mjs" }],
    [{ path: "fx-worker/image.png" }], [{ path: "migrations/sub/x.sql" }], [{ path: T, anchor: "" }], [], "fx-worker/x.mjs",
  ];
  const got = [];
  for (const b of bad) got.push((await post(env, task(b))).status);
  ok(got.every((s) => s === 400) && !row(env), "A1 a worker source, a mirror, another directory, a denied path, a duplicate, too many, an unsupported type and malformed lists are refused with 400", got);
  const good = await post(env, task([{ path: T, anchor: "if (quota('free') !== 10)" }, { path: M }]));
  const cx = JSON.parse(row(env).ctx);
  ok(good.status === 202 && cx.anchor === ANCHOR && cx.extras.length === 2 && cx.extras[0].anchor === "if (quota('free') !== 10)" && cx.extras[1].path === M && !("anchor" in cx.extras[1]), "A2 a valid task keeps its companions and their anchors in ctx.extras", { st: good.status, cx });
  ok(mod.__valid(P, [{ path: T }]).list.length === 1 && /must be in fx-worker\//.test(mod.__valid(P, [{ path: "scripts/x.py" }]).error), "A3 a companion lives in the task's directory or is a migration", mod.__valid(P, [{ path: "scripts/x.py" }]));
}

// ===== B. worker + test + new migration: one patch =====
{
  serve();
  const { env, calls } = envWith([REPLY]);
  await post(env, task([{ path: T }, { path: M }]));
  await tick(env);
  const t = row(env), cx = JSON.parse(t.ctx);
  ok(t.status === "ready_to_publish" && calls.length === 1 && !t.last_error, "B1 the task lands with one model call", { st: t.status, err: t.last_error, calls: calls.length });
  ok(JSON.stringify(cx.paths) === JSON.stringify([T, M]) && cx.mirror === "fx-worker/deployed-current.worker.js", "B2 ctx.paths names the companions that changed, the mirror rides along", { paths: cx.paths, mirror: cx.mirror });
  const a = applyPatch(cx.patch || "");
  ok(a.ok && /return 25;/.test(a.worker) && a.worker === a.mirror && /var VERSION = "3\.1\.5-codeagent";/.test(a.worker), "B3 git applies the patch: the worker changes, bumped, with an identical mirror", { ok: a.ok, err: a.err });
  ok(a.ok && /FAIL free is 25/.test(a.test) && !/VERSION/.test(a.test) && a.test.split("\n").length === TEST_SRC.split("\n").length, "B4 the test file carries its edit and nothing else", a.test);
  ok(a.ok && a.mig === MIG + "\n", "B5 the new migration is created whole, ending in a newline", a.mig);
  const pr = calls[0].prompt;
  ok(pr.indexOf("FILE PATH: " + P) >= 0 && pr.indexOf("FILE PATH: " + T) >= 0 && pr.indexOf("FILE PATH: " + M + " (NEW: this file does not exist yet)") >= 0 && pr.indexOf("if (quota('free') !== 10)") >= 0 && /each group of blocks preceded by one line that names the file/.test(calls[0].sys), "B6 the model saw every file, the new one marked NEW, and the FILE: rule", pr.slice(0, 200));
  ok(cx.x.length === 2 && cx.x[1].new === true && cx.x[0].edits.length === 1, "B7 the companions' bases and edits stay on the task for a rebase or a repair round", cx.x.map((x) => ({ p: x.path, n: !!x.new, e: (x.edits || []).length })));
}

// ===== B2. large companions get a bounded window from the unique-anchor locator =====
{
  serve();
  const bigTest = TEST_SRC + "\n" + "/* large companion padding */\n".repeat(5000);
  FILES[T] = bigTest;
  const reply = "FILE: " + P + "\n" + B_WORKER + "\nFILE: " + T + "\n" + B_TEST + "\n";
  const { env, calls } = envWith([TEST_ANCHOR, reply]);
  const bigTask = Object.assign(task([{ path: T }]), { goal: GOAL + ' Update the "quota" assertion.' });
  await post(env, bigTask);
  await tick(env);
  const t = row(env), cx = JSON.parse(t.ctx), a = applyPatch(cx.patch || "");
  ok(bigTest.length > 48000, "B2a the companion fixture exceeds the rejected 48,000-character threshold", bigTest.length);
  ok(t.status === "ready_to_publish" && calls.length === 2 && cx.extras[0].anchor === TEST_ANCHOR && cx.x[0].anchor === TEST_ANCHOR, "B2b a missing companion anchor is located once and persisted for retries", { status: t.status, error: t.last_error, anchor: cx.extras[0].anchor });
  ok(calls[0] && calls[0].prompt.includes("FILE EXCERPTS from " + T) && calls[1] && calls[1].prompt.includes("FILE PATH: " + T) && calls[1].prompt.includes(TEST_ANCHOR), "B2c the locator reads the companion path and the proposal receives its anchor window", { calls: calls.length });
  ok(a.ok && a.test.includes("FAIL free is 25") && a.test.length === bigTest.length, "B2d the bounded multi-file patch updates the oversized companion without rewriting its padding", { ok: a.ok, err: a.err, size: a.test && a.test.length });
}

// ===== C. failures the next rung reads =====
{
  serve();
  const stray = "FILE: " + P + "\n" + B_WORKER + "\nFILE: fx-worker/other.mjs\n" + block("a", "b");
  const { env, calls } = envWith([stray, REPLY]);
  await post(env, task([{ path: T }, { path: M }]));
  await tick(env);
  const t = row(env);
  ok(t.status === "ready_to_publish" && calls.length === 2 && /FILE: fx-worker\/other\.mjs, which is not a file of this task/.test(calls[1].prompt), "C1 a block under a FILE: line outside the task fails the attempt with the reason; the next rung lands it", { st: t.status, err: t.last_error });
}
{
  serve();
  const { env, calls } = envWith(["FILE: " + T + "\n" + B_TEST, REPLY]);
  await post(env, task([{ path: T }, { path: M }]));
  await tick(env);
  ok(row(env).status === "ready_to_publish" && /no block edits fx-worker\/worker\.js \(the task's own file must change/.test(calls[1].prompt), "C2 a reply that leaves the task's own path unchanged is refused with the reason", row(env).last_error);
}
{
  serve();
  const wrongNew = "FILE: " + P + "\n" + B_WORKER + "\nFILE: " + M + "\n" + block("-- old", MIG);
  const { env, calls } = envWith([wrongNew, REPLY]);
  await post(env, task([{ path: T }, { path: M }]));
  await tick(env);
  ok(row(env).status === "ready_to_publish" && /is NEW: write exactly one block for it, with an empty SEARCH/.test(calls[1].prompt), "C3 a NEW file with a non-empty SEARCH is refused with the rule", row(env).last_error);
}
{
  serve();
  const noHeader = "FILE: " + P + "\n" + B_WORKER + "\nFILE: " + M + "\n<<<<<<< SEARCH\n=======\nINSERT INTO ops_config (key, value) VALUES ('fx_free_quota', '25');\n>>>>>>> REPLACE";
  const { env, calls } = envWith([noHeader, REPLY]);
  await post(env, task([{ path: T }, { path: M }]));
  await tick(env);
  ok(row(env).status === "ready_to_publish" && /the migration lacks the header lines -- APPLY-BY: ci, -- DB: <database>, -- Rollback: <sql>/.test(calls[1].prompt) && /YOUR PREVIOUS EDITS/.test(calls[1].prompt) && calls[1].prompt.indexOf("FILE: " + M) >= 0, "C4 a migration without its CI header fails verify with the missing lines, and the retry shows the previous edits by file", row(env).last_error);
  ok(mod.__migration("-- APPLY-BY: ci\n-- DB: qnfo-audit\n-- Rollback: SELECT 1;\nDELETE FROM t WHERE x = 1;") !== null && mod.__migration("-- APPLY-BY: ci\n-- DB: qnfo-audit\n-- Rollback: SELECT 1;\n-- BACKUP: bak_t\nCREATE TABLE bak_t AS SELECT * FROM t;\nDELETE FROM t WHERE x = 1;") === null && mod.__migration(MIG) === null, "C5 a migration that deletes names its BACKUP table");
}
{
  serve();
  const badTest = "FILE: " + P + "\n" + B_WORKER + "\nFILE: " + T + "\n" + block("if (quota('free') !== 11) { nothing like the file }", "x");
  const { env, calls } = envWith([badTest, REPLY]);
  await post(env, task([{ path: T }, { path: M }]));
  await tick(env);
  ok(row(env).status === "ready_to_publish" && /FILE fx-worker\/quota\.test\.mjs: edit 1: SEARCH text occurs 0 times/.test(calls[1].prompt), "C6 a companion SEARCH that matches nowhere names the file and the edit", row(env).last_error);
}

// ===== D. a companion with no block stays out of the patch =====
{
  serve();
  const { env } = envWith(["FILE: " + P + "\n" + B_WORKER + "\nFILE: " + T + "\n" + B_TEST]);
  await post(env, task([{ path: T }, { path: R }, { path: M }]));
  await tick(env);
  const t = row(env), cx = JSON.parse(t.ctx), a = applyPatch(cx.patch || "");
  ok(t.status === "ready_to_publish" && JSON.stringify(cx.paths) === JSON.stringify([T]) && a.ok && a.readme === README_SRC && a.mig === null, "D1 untouched companions (a README, a migration nobody wrote) are not in ctx.paths or the patch", { st: t.status, paths: cx.paths, err: a.err });
}
{
  // a single-file task is unchanged: no FILE: lines needed, no ctx.paths
  serve();
  const { env, calls } = envWith([B_WORKER]);
  await post(env, { repo: "qnfo-workers", path: P, goal: GOAL, anchor: ANCHOR });
  await tick(env);
  const t = row(env), cx = JSON.parse(t.ctx);
  ok(t.status === "ready_to_publish" && cx.paths === undefined && cx.x === undefined && !/FILE: \(path\)/.test(calls[0].sys), "D2 a task without companions runs the single-file prompt and parks no ctx.paths", { st: t.status });
}

// ===== E. intake =====
{
  serve();
  const { env } = envWith([]);
  const db = env.AUDIT_DB._db;
  await worker.fetch(new Request("https://x/v1/tasks", { headers: hdr }), env); // creates code_tasks
  db.prepare("INSERT INTO agent_issues (title, description, source, created_at, updated_at) VALUES (?,?,?,?,?)").run("FX-QUOTA-1: free quota 25",
    "The free plan's quota becomes 25.\ncode-task: repo=qnfo-workers path=" + P + " path=" + T + " path=" + M + "\ncode-anchor: " + ANCHOR + "\ncode-anchor: if (quota('free') !== 10)\ncode-anchor: -\n", "claude-session-test", 1, 1);
  const r1 = await mod.__intake(env, 2);
  const r1b = await mod.__intake(env, 2);
  const waits = events(env, "code-task.intake-waiting");
  ok(r1.created.length === 0 && r1b.created.length === 0 && !row(env) && waits.length === 1 && /code_merge_multi_file is not on/.test(waits[0].text), "E1 with the merge runner's key off, a multi-path line is left alone and noted once", { r1, waits: waits.length });
  ok(/code-task: repo=qnfo-workers path=/.test(db.prepare("SELECT description FROM agent_issues").get().description), "E2 the issue keeps its code-task line while it waits");
  db.prepare("INSERT INTO ops_config (key, value) VALUES ('code_merge_multi_file', 'on')").run();
  const r2 = await mod.__intake(env, 2);
  const t = row(env), cx = t ? JSON.parse(t.ctx) : {};
  ok(r2.created.length === 1 && t.path === P && cx.anchor === ANCHOR && cx.extras.length === 2 && cx.extras[0].path === T && cx.extras[0].anchor === "if (quota('free') !== 10)" && cx.extras[1].path === M && !("anchor" in cx.extras[1]) && /^\[issue #1\]/.test(t.goal) && !/code-task:/.test(t.goal), "E3 with the key on, the task is filed with its companions and their anchors", { r2, cx });
  // a single-path line is taken whatever the key says
  const { env: env2 } = envWith([]);
  await worker.fetch(new Request("https://x/v1/tasks", { headers: hdr }), env2);
  env2.AUDIT_DB._db.prepare("INSERT INTO agent_issues (title, description, source, created_at, updated_at) VALUES (?,?,?,?,?)").run("FX-QUOTA-2: free quota 25", "x\ncode-task: repo=qnfo-workers path=" + P + "\ncode-anchor: " + ANCHOR + "\n", "claude-session-test", 1, 1);
  const r3 = await mod.__intake(env2, 2);
  ok(r3.created.length === 1 && JSON.parse(row(env2).ctx).extras === undefined, "E4 a single-path line is unaffected", r3);
}

// ===== F. the parser =====
{
  const p = mod.__parse(B_WORKER + "\nFILE: `" + T + "`\n" + B_TEST + "\nsome prose\nFILE: " + M + "\n" + B_MIG, P, [T, M]);
  ok(!p.error && p.by[P].length === 1 && p.by[T].length === 1 && p.by[M].length === 1 && p.by[M][0].search === "" && p.by[M][0].replace === MIG, "F1 blocks before the first FILE: line are the task's own; a backticked path is read; an empty SEARCH parses", p);
  ok(mod.__parse("FILE: " + T + "\n(no blocks)", P, [T]).by[T] === undefined, "F2 a FILE: line with no block adds nothing");
}

// ===== G. publisher feedback adds every eligible failing suite, not just the first =====
{
  const U = "fx-worker/second.test.mjs", V = "fx-worker/third.test.mjs", W = "fx-worker/fourth.test.mjs";
  const feedback = (paths) => "PUBLISH-SUITE-CHECK-1: " + paths.map((p) => "FAIL " + p + ": assertion failed").join(" | ");
  const cases = [
    { initial: [T], last: feedback([T, T, "other-worker/foreign.test.mjs", "fx-worker/../escape.test.mjs", U, U, V, W]), expected: [T, U, V] },
    { initial: [T], last: "edit 1: SEARCH text occurs 0 times", previous: feedback([T, U]), expected: [T, U] },
    { initial: [], last: feedback(["other-worker/foreign.test.mjs", T, U]), expected: [T, U] },
  ];
  for (const [i, c] of cases.entries()) {
    serve();
    for (const p of [U, V, W]) FILES[p] = TEST_SRC;
    const reply = (paths) => "FILE: " + P + "\n" + B_WORKER + "\n" + paths.map((p) => "FILE: " + p + "\n" + B_TEST).join("\n");
    const { env, calls } = envWith([reply(c.initial), reply(c.expected)]);
    await post(env, c.initial.length ? task(c.initial.map((p) => ({ path: p }))) : task(undefined));
    await tick(env);
    const cx = JSON.parse(row(env).ctx);
    cx.lastError = c.last;
    cx.suite_rebase_reason = c.previous;
    cx.suite_rebase_attempted = true;
    cx.sig_n = 1;
    env.AUDIT_DB._db.prepare("UPDATE code_tasks SET status='queued', step='propose', attempts=1, ctx=?, lease_until=NULL")
      .run(JSON.stringify(cx));
    await tick(env);
    const t = row(env), repaired = JSON.parse(t.ctx);
    ok(t.status === "ready_to_publish" && calls.length === 2, "G" + i + " suite repairs land without an out-of-scope retry", { status: t.status, error: t.last_error, calls: calls.length });
    ok(JSON.stringify((repaired.extras || []).map((x) => x.path)) === JSON.stringify(c.expected), "G" + i + " discovery skips existing, duplicate, foreign and over-limit paths", repaired.extras);
    ok(c.expected.every((p) => (repaired.paths || []).includes(p) && calls[1].prompt.includes("FILE PATH: " + p)),
      "G" + i + " every accepted suite is read, shown and included in the patch", repaired.paths);
  }
}

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
