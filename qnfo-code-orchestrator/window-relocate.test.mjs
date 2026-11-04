// WINDOW-RELOCATE-1 + MERGE-SCOPE-PARITY-1 offline suite (qnfo-code-orchestrator 0.18.29, pillar autonomy).
// Measured 2026-10-19 on code_tasks: 8 of the 20 failed tasks between 2026-10-18T13Z and 2026-10-19T09Z ended on "SEARCH text
// occurs 0 times in the shown content", and in each one checked the SEARCH named code that sits once in the file but outside the
// anchor window (ct_9w103x6wxfzs7s: window 0-22938, function learnerTopicOf at 190686). This suite proves that such a reply moves
// the window to the code it named and runs the propose again without spending an attempt, that the next reply then applies,
// that a SEARCH found nowhere still fails as before, and that the relocation is bounded. MERGE-SCOPE-PARITY-1: a qnfo-workers
// path the merge runner's cmScope refuses (personal-companion/wellbeing.js was built and refused 3 times in 24 h) is a session
// task at enqueue; a worker.js, docs/**.md, <dir>/README.md and a path in another repository are not.
// Run: node --no-warnings qnfo-code-orchestrator/window-relocate.test.mjs   (exit 0 = all passed)
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
const atLeast = (v, min) => { const a = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v || "")), b = min.split(".").map(Number); if (!a) return false; for (let i = 0; i < 3; i++) { if (+a[i + 1] !== b[i]) return +a[i + 1] > b[i]; } return true; };

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
    CREATE TABLE cloud_ops_events (id TEXT, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT);
    CREATE TABLE ai_spend_ledger (day TEXT NOT NULL, provider TEXT NOT NULL, caller TEXT NOT NULL, model TEXT NOT NULL, calls INTEGER DEFAULT 0, in_tok INTEGER DEFAULT 0, out_tok INTEGER DEFAULT 0, usd REAL DEFAULT 0, downgraded INTEGER DEFAULT 0, refused INTEGER DEFAULT 0, PRIMARY KEY (day, provider, caller, model));
    CREATE TABLE ai_call_counters (day TEXT, worker TEXT, purpose TEXT, model TEXT, calls INTEGER DEFAULT 0, errors INTEGER DEFAULT 0, in_chars INTEGER DEFAULT 0, ms INTEGER DEFAULT 0, in_tok INTEGER DEFAULT 0, out_tok INTEGER DEFAULT 0, neurons REAL DEFAULT 0, PRIMARY KEY (day, worker, purpose, model));`);
  return { prepare: wrap, _db: db };
}
const pad = (tag, n) => { let s = ""; let i = 0; while (s.length < n) s += "// " + tag + " filler line " + (i++) + " keeps the target far from the anchor window\n"; return s; };
const ANCHOR = "function topAnchor() { return 1; }";
const TARGET = "function farAway(x) { return x + 1; }";
const BIG = pad("a", 2000) + ANCHOR + "\n" + pad("b", 70000) + TARGET + "\n" + pad("c", 20000) + 'export default { fetch() { return new Response("a"); } };\n';
const FILES = { "fx-rel/worker.js": BIG, "fx-rel/deployed-current.worker.js": BIG };
globalThis.fetch = async (u) => {
  const m = /^https:\/\/raw\.githubusercontent\.com\/QNFO\/[A-Za-z0-9._-]+\/main\/(.+)$/.exec(String(u));
  const p = m ? decodeURIComponent(m[1]) : null;
  return p && FILES[p] != null ? new Response(FILES[p], { status: 200 }) : new Response("nf", { status: 404 });
};
const fakeLoader = { load: () => ({ getEntrypoint: () => ({ fetch: async () => new Response("ok") }) }) };
function envWith(script) {
  const calls = [];
  const env = { ORCH_TOKEN: "t0ken", AUDIT_DB: makeD1(), PR_PUBLISH_MODE: "pull", JS_VERIFY: "dynamic", LOADER: fakeLoader,
    AI: { run: async (model, input) => { calls.push({ model, prompt: JSON.stringify(input.messages || input.prompt || "") }); const r = script.shift(); if (r instanceof Error) throw r; return { response: r == null ? "" : r }; } } };
  return { env, calls };
}
const hdr = { authorization: "Bearer t0ken", "content-type": "application/json" };
const tick = async (env) => (await worker.fetch(new Request("https://x/v1/tick", { method: "POST", headers: hdr, body: JSON.stringify({ maxSteps: 1, budgetMs: 25000, plan: false, intake: false }) }), env)).json();
const addTask = async (env, p, anchor, repo) => (await worker.fetch(new Request("https://x/v1/tasks", { method: "POST", headers: hdr, body: JSON.stringify({ repo: repo || "qnfo-workers", path: p, goal: "make farAway add two instead of one", anchor }) }), env)).json();
const row = (env, id) => env.AUDIT_DB._db.prepare("SELECT * FROM code_tasks WHERE id=?").get(id);
const ctxOf = (r) => { try { return JSON.parse(r.ctx || "{}"); } catch (e) { return {}; } };
const free = (env, id) => env.AUDIT_DB._db.prepare("UPDATE code_tasks SET lease_until = NULL WHERE id = ?").run(id);
const EDIT = "<<<<<<< SEARCH\n" + TARGET + "\n=======\nfunction farAway(x) { return x + 2; }\n>>>>>>> REPLACE";
const MISS = "<<<<<<< SEARCH\nfunction neverWritten(y) { return y * 3; }\n=======\nfunction neverWritten(y) { return y * 4; }\n>>>>>>> REPLACE";

const h = await (await worker.fetch(new Request("https://x/health"), {})).json();
ok(atLeast(h.version, "0.18.29"), "health: 0.18.29+", { version: h.version });

// ===== 1. a SEARCH outside the window moves the window there, without spending an attempt; the next reply applies =====
{
  ok(BIG.length > 60000 && BIG.indexOf(TARGET) - BIG.indexOf(ANCHOR) > 24000, "the fixture puts the target beyond the anchor window", BIG.length);
  const { env, calls } = envWith([EDIT, EDIT]);
  const c = await addTask(env, "fx-rel/worker.js", ANCHOR);
  ok(c.ok && c.id, "task enqueued", c);
  await tick(env);
  let r = row(env, c.id), cx = ctxOf(r);
  const at = BIG.indexOf(TARGET);
  ok(r.step === "propose" && cx.mode === "patch" && cx.win.we < at, "read: patch mode, window around the anchor, target outside it", { step: r.step, win: cx.win, at });
  await tick(env);
  r = row(env, c.id); cx = ctxOf(r);
  ok(r.status === "queued" && r.step === "propose" && Number(r.attempts) === 0, "the relocation spends no attempt", { status: r.status, step: r.step, attempts: r.attempts, last_error: r.last_error });
  ok(cx.relocated === 1 && cx.win.ws <= at && cx.win.we >= at + TARGET.length && cx.anchor === TARGET, "the window now holds the SEARCH text and it is the anchor", { win: cx.win, relocated: cx.relocated, anchor: cx.anchor });
  ok(/occurs once elsewhere in the file/.test(cx.lastError || ""), "the next prompt says why the content changed", cx.lastError);
  const ev = env.AUDIT_DB._db.prepare("SELECT COUNT(*) AS n FROM cloud_ops_events WHERE kind = 'code-task.window-relocated'").get();
  ok(ev.n === 1, "event code-task.window-relocated recorded", ev);
  free(env, c.id);
  for (let i = 0; i < 4 && row(env, c.id).status === "queued"; i++) { await tick(env); free(env, c.id); }
  r = row(env, c.id);
  ok(calls.length === 2 && calls[1].prompt.indexOf("farAway") >= 0, "the second call was shown the target", calls.length);
  ok(r.status === "ready_to_publish", "the same SEARCH then applies and the task reaches ready_to_publish", { status: r.status, step: r.step, last_error: r.last_error });
  ok(String(ctxOf(r).patch || "").indexOf("+function farAway(x) { return x + 2; }") >= 0, "the patch carries the change", String(ctxOf(r).patch || "").slice(0, 200));
}

// ===== 2. a SEARCH found nowhere in the file still fails as before =====
{
  const { env } = envWith([MISS]);
  const c = await addTask(env, "fx-rel/worker.js", ANCHOR);
  await tick(env); await tick(env);
  const r = row(env, c.id);
  ok(Number(r.attempts) === 1 && /occurs 0 times in the shown content/.test(r.last_error || "") && !ctxOf(r).relocated, "a true miss spends an attempt and does not relocate", { attempts: r.attempts, last_error: r.last_error });
}

// ===== 3. the relocation is bounded by WINDOW_RELOCATE_MAX =====
{
  const { env } = envWith([EDIT]);
  const c = await addTask(env, "fx-rel/worker.js", ANCHOR);
  await tick(env);
  const cx = ctxOf(row(env, c.id)); cx.relocated = 2;
  env.AUDIT_DB._db.prepare("UPDATE code_tasks SET ctx = ? WHERE id = ?").run(JSON.stringify(cx), c.id);
  await tick(env);
  const r = row(env, c.id);
  ok(Number(r.attempts) === 1 && ctxOf(r).relocated === 2, "past the bound the miss is an ordinary failure", { attempts: r.attempts, relocated: ctxOf(r).relocated, last_error: r.last_error });
}

// ===== 4. MERGE-SCOPE-PARITY-1: enqueue refuses what the merge runner refuses =====
{
  FILES["fx-rel/wellbeing.js"] = "export const a = 1;\n";
  FILES["fx-rel/wellbeing.test.mjs"] = "export const a = 1;\n";
  const { env } = envWith([]);
  const m = await addTask(env, "fx-rel/wellbeing.test.mjs");
  ok(!m.ok && /outside the merge runner's auto-merge scope/.test(m.error || "") && /^session task/.test(m.error || ""), "a test file in qnfo-workers is a session task at enqueue", m);
  const t = await addTask(env, "fx-rel/wrangler.toml");
  ok(!t.ok, "a wrangler.toml is refused too", t);
  const d = await addTask(env, "docs/NOTES.md");
  ok(d.ok, "docs/**.md is in scope", d);
  const rd = await addTask(env, "fx-rel/README.md");
  ok(rd.ok, "<dir>/README.md is in scope", rd);
  const o = await addTask(env, "src/wellbeing.js", null, "qnfo-labs");
  ok(o.ok, "another repository is not judged by the qnfo-workers merge runner", o);
}

console.log("window-relocate.test: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
