// SEARCH-NEAREST-1 offline suite (qnfo-code-orchestrator 0.19.0, pillar autonomy; agent_issues 2111).
// Measured 2026-10-19 on cloud_ops_events: 90 "SEARCH text occurs 0 times in the shown content" failures in 7 days, 39 in the last 24 h,
// nearly all from the rung that rewrites a block from memory. The ones whose message names how many SEARCH lines are file lines
// include real blocks with one rewritten line (4 of 5, 5 of 6, 10 of 11 lines equal). This suite replays that shape on the real
// applyEdits through the task loop and proves: a SEARCH of 6 lines with one reworded line applies to the one block it was aimed at,
// keeps the file's own text for every line the REPLACE leaves identical (also a reworded one between two changed lines), and is audited with the score and the hashes of both texts;
// an ambiguous SEARCH (two equally near blocks), a weak one (half its lines invented) and a short one (2 lines) are refused
// exactly as before; large-file tasks recover only inside their stored window; exact, indentation, fuzzy and window-relocate paths never reach it.
// Run: node --no-warnings qnfo-code-orchestrator/search-nearest.test.mjs   (exit 0 = all passed)
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import crypto from "node:crypto";
const atLeast = (v, min) => { const a = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v || "")), b = min.split(".").map(Number); if (!a) return false; for (let i = 0; i < 3; i++) { if (+a[i + 1] !== b[i]) return +a[i + 1] > b[i]; } return true; };
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

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
    CREATE TABLE cloud_ops_events (id TEXT, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT);
    CREATE TABLE ai_spend_ledger (day TEXT NOT NULL, provider TEXT NOT NULL, caller TEXT NOT NULL, model TEXT NOT NULL, calls INTEGER DEFAULT 0, in_tok INTEGER DEFAULT 0, out_tok INTEGER DEFAULT 0, usd REAL DEFAULT 0, downgraded INTEGER DEFAULT 0, refused INTEGER DEFAULT 0, PRIMARY KEY (day, provider, caller, model));
    CREATE TABLE ai_call_counters (day TEXT, worker TEXT, purpose TEXT, model TEXT, calls INTEGER DEFAULT 0, errors INTEGER DEFAULT 0, in_chars INTEGER DEFAULT 0, ms INTEGER DEFAULT 0, in_tok INTEGER DEFAULT 0, out_tok INTEGER DEFAULT 0, neurons REAL DEFAULT 0, PRIMARY KEY (day, worker, purpose, model));`);
  return { prepare: wrap, _db: db };
}
// A 6-line block (the shape of the paper-indexer functions the loop edits), a twin of it, and filler.
const HEAD = 'async function planRow(env, id) {';
const B1 = '  const row = await env.DB.prepare("SELECT id, status, rank FROM plans WHERE id = ?1").bind(id).first();';
const B2 = '  if (!row) return { ok: false, error: "no plan " + id };';
const B3 = '  const rank = Number(row.rank || 0) + 1;';
const B4 = '  const label = String(row.status || "draft").toUpperCase();';
const B5 = '  return { ok: true, status: label, rank: rank };';
const BODY = [B1, B2, B3, B4, B5].join("\n");
const mk = (twin) => {
  const lines = ['var VERSION = "1.0.0-fixture";', "// fx-near (fixture)"];
  for (let i = 0; i < 30; i++) lines.push("function filler" + i + "(env) { return env && env.FLAG_" + i + " ? " + i + " : 0; }");
  lines.push(HEAD, BODY, "}");
  if (twin) lines.push("async function planRowTwin(env, id) {", BODY, "}");
  for (let i = 30; i < 50; i++) lines.push("function filler" + i + "(env) { return env && env.FLAG_" + i + " ? " + i + " : 0; }");
  lines.push("export default { async fetch(req, env) { return new Response('ok'); } };", "");
  return lines.join("\n");
};
const SINGLE = mk(false), TWIN = mk(true);
const FILES = { "fx-near/worker.js": SINGLE, "fx-near/deployed-current.worker.js": SINGLE };
globalThis.fetch = async (u) => {
  const m = /^https:\/\/raw\.githubusercontent\.com\/QNFO\/[A-Za-z0-9._-]+\/main\/(.+)$/.exec(String(u));
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
const tick = async (env) => (await worker.fetch(new Request("https://x/v1/tick", { method: "POST", headers: hdr, body: JSON.stringify({ maxSteps: 1, budgetMs: 25000, plan: false, intake: false }) }), env)).json();
const addTask = async (env, goal, p, anchor) => (await worker.fetch(new Request("https://x/v1/tasks", { method: "POST", headers: hdr, body: JSON.stringify({ repo: "qnfo-workers", path: p || "fx-near/worker.js", goal: goal, anchor: anchor || HEAD }) }), env)).json();
const row = (env, id) => env.AUDIT_DB._db.prepare("SELECT * FROM code_tasks WHERE id=?").get(id);
const ctxOf = (r) => { try { return JSON.parse(r.ctx || "{}"); } catch (e) { return {}; } };
const events = (env, kind) => env.AUDIT_DB._db.prepare("SELECT text, meta, status FROM cloud_ops_events WHERE kind=? ORDER BY rowid").all(kind);
const block = (a, b) => "<<<<<<< SEARCH\n" + a + "\n=======\n" + b + "\n>>>>>>> REPLACE";
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

// The model's SEARCH: the real block with line 3 reworded (invented: no `|| 0`, a different name), the REPLACE changes the return.
const B3_INVENTED = '  const rank = Number(row.rank) + 1; // next rank';
const SEARCH_INVENTED = [B1, B2, B3_INVENTED, B4, B5].join("\n");
const REPLACE_INVENTED = [B1, B2, B3_INVENTED, B4, '  return { ok: true, status: label, rank: rank, id: id };'].join("\n");

// ===== 1. health =====
const h = await (await worker.fetch(new Request("https://x/health"), {})).json();
ok(atLeast(h.version, "0.19.0") && h.capabilities.indexOf("search-nearest") >= 0, "health: 0.19.0+ with search-nearest", { version: h.version });

// ===== 2. an invented line in a real 5-line block: applies to that block, keeps the file's own lines, is audited =====
{
  ok(SEARCH_INVENTED.indexOf(B3) < 0 && SINGLE.indexOf(SEARCH_INVENTED) < 0, "fixture: the SEARCH occurs nowhere in the file");
  const { env, calls } = envWith([block(SEARCH_INVENTED, REPLACE_INVENTED)]);
  const c = await addTask(env, "return the id");
  const r = await runTask(env, c.id);
  ok(calls.length === 1 && Number(r.attempts) === 0 && r.status === "ready_to_publish", "the near SEARCH applies without a failed attempt", { status: r.status, attempts: r.attempts, last_error: r.last_error, calls: calls.length });
  const patch = String(ctxOf(r).patch || "");
  ok(/\+  return \{ ok: true, status: label, rank: rank, id: id \};/.test(patch), "the patch carries the REPLACE's change", patch.slice(0, 800));
  ok(patch.indexOf(B3_INVENTED) < 0, "the model's invented line is not written into the file", patch.slice(0, 800));
  const ev = events(env, "code-task.edit-nearest");
  const meta = ev[0] ? JSON.parse(ev[0].meta || "{}") : {};
  ok(ev.length === 1 && ev[0].status === "ok" && /edit 1/.test(ev[0].text), "one code-task.edit-nearest event", ev);
  ok(typeof meta.score === "number" && meta.score >= 0.92 && meta.score < 1, "the event carries the similarity score", meta);
  ok(meta.search_sha256 === sha(SEARCH_INVENTED) && meta.window_sha256 === sha([B1, B2, B3, B4, B5].join("\n")), "the event carries the sha-256 of the model's SEARCH and of the file text", meta);
  const eds = ctxOf(r).edits || [];
  ok(eds.length === 1 && eds[0].search === BODY, "the parked edits are the file's own text, so the publisher's rebuild applies them exactly", eds);
}

// ===== 2b. the change is on lines 2 and 4 around a reworded line 3: the file's line 3 survives (the model's wording is never written) =====
{
  const B2N = '  if (!row) return { ok: false, error: "plan " + id + " not found" };';
  const B4N = '  const label = String(row.status || "draft").toLowerCase();';
  const { env } = envWith([block(SEARCH_INVENTED, [B1, B2N, B3_INVENTED, B4N, B5].join("\n"))]);
  const c = await addTask(env, "reword the error and the label");
  const r = await runTask(env, c.id);
  ok(Number(r.attempts) === 0 && r.status === "ready_to_publish" && events(env, "code-task.edit-nearest").length === 1, "a change on lines 2 and 4 around a reworded line 3 applies", { status: r.status, attempts: r.attempts, last_error: r.last_error });
  const patch = String(ctxOf(r).patch || "");
  ok(patch.indexOf(B3_INVENTED) < 0, "the model's reworded line 3 is not written into the file", patch.slice(0, 900));
  ok(patch.indexOf("+" + B2N) >= 0 && patch.indexOf("+" + B4N) >= 0 && patch.indexOf("-" + B2) >= 0 && patch.indexOf("-" + B4) >= 0, "lines 2 and 4 carry the REPLACE's change", patch.slice(0, 900));
  ok(patch.indexOf("-" + B3) < 0 && patch.indexOf("+" + B3) < 0, "the file's line 3 (with its `|| 0` guard) is not in the diff: it survives", patch.slice(0, 900));
  const eds = ctxOf(r).edits || [];
  ok(eds.length === 1 && eds[0].search === BODY && eds[0].replace === [B1, B2N, B3, B4N, B5].join("\n"), "the parked REPLACE keeps the file's line 3", eds);
}

// ===== 3. two equally near blocks: refused as before, nothing guessed =====
{
  FILES["fx-near/worker.js"] = TWIN; FILES["fx-near/deployed-current.worker.js"] = TWIN;
  const { env } = envWith([block(SEARCH_INVENTED, REPLACE_INVENTED)]);
  const c = await addTask(env, "return the id");
  const r = await runTask(env, c.id);
  ok(Number(r.attempts) >= 1 && /edit 1: SEARCH text occurs 0 times in the shown content/.test(firstFail(env)) && events(env, "code-task.edit-nearest").length === 0, "an ambiguous near SEARCH is refused with the 0-times message and no event", { attempts: r.attempts, fail: firstFail(env) });
  FILES["fx-near/worker.js"] = SINGLE; FILES["fx-near/deployed-current.worker.js"] = SINGLE;
}

// ===== 4. half the lines invented: refused =====
{
  const weak = [B1, '  if (!row) throw new Error("missing");', '  const next = computeNext(row, id);', '  const tag = decorate(row, next);', B5].join("\n");
  const { env } = envWith([block(weak, weak + "\n  // changed")]);
  const c = await addTask(env, "return the id");
  const r = await runTask(env, c.id);
  ok(Number(r.attempts) >= 1 && /occurs 0 times in the shown content/.test(firstFail(env)) && events(env, "code-task.edit-nearest").length === 0, "a SEARCH with 3 of 5 lines invented is refused", { attempts: r.attempts, fail: firstFail(env) });
}

// ===== 5. a 2-line SEARCH with a reworded line: refused (too short to trust) =====
{
  const short = [B2, '  const rank = Number(row.rank) + 1; // next rank'].join("\n");
  const { env } = envWith([block(short, short + "\n  // changed")]);
  const c = await addTask(env, "return the id");
  const r = await runTask(env, c.id);
  ok(Number(r.attempts) >= 1 && /occurs 0 times in the shown content/.test(firstFail(env)) && events(env, "code-task.edit-nearest").length === 0, "a 2-line near SEARCH is refused", { attempts: r.attempts, fail: firstFail(env) });
}

// ===== 6. exact, indentation-only and fuzzy SEARCH never reach the nearest path =====
{
  const CHG = BODY.replace("rank: rank }", "rank: rank, tag: 1 }");
  const exact = envWith([block(BODY, CHG)]);
  let c = await addTask(exact.env, "x");
  let r = await runTask(exact.env, c.id);
  ok(r.status === "ready_to_publish" && events(exact.env, "code-task.edit-nearest").length === 0, "an exact SEARCH applies with no nearest event", { status: r.status });
  const indented = BODY.split("\n").map((l) => "      " + l.trim()).join("\n");
  const ind = envWith([block(indented, CHG)]);
  c = await addTask(ind.env, "x");
  r = await runTask(ind.env, c.id);
  ok(r.status === "ready_to_publish" && events(ind.env, "code-task.edit-indent").length === 1 && events(ind.env, "code-task.edit-nearest").length === 0, "an indentation-only SEARCH is the edit-indent path", { status: r.status });
  const spaced = BODY.replace("rank = Number", "rank  =  Number");
  const fz = envWith([block(spaced, CHG)]);
  c = await addTask(fz.env, "x");
  r = await runTask(fz.env, c.id);
  ok(r.status === "ready_to_publish" && events(fz.env, "code-task.edit-fuzzy").length === 1 && events(fz.env, "code-task.edit-nearest").length === 0, "a whitespace-drift SEARCH is the edit-fuzzy path", { status: r.status });
}

// ===== 7. 0.18.29 relocation first: a SEARCH the file holds once outside the window moves the window, nearest does not guess =====
{
  const pad = (tag, n) => { let s = "", i = 0; while (s.length < n) s += "// " + tag + " filler line " + (i++) + " keeps the target far from the anchor window\n"; return s; };
  const ANCH = "function topAnchor() { return 1; }";
  const NEAR = [HEAD, B1, B2, "  const rank = Number(row.rank) + 2;", B4, B5, "}"].join("\n"); // inside the window, almost the far block
  const FAR = [HEAD.replace("planRow", "planRowFar"), BODY, "}"].join("\n");
  const FARBODY = [HEAD.replace("planRow", "planRowFar"), BODY].join("\n");
  const BIG = pad("a", 2000) + ANCH + "\n" + NEAR + "\n" + pad("b", 70000) + FAR + "\nexport default { fetch() { return new Response('a'); } };\n";
  FILES["fx-rel/worker.js"] = BIG; FILES["fx-rel/deployed-current.worker.js"] = BIG;
  const { env } = envWith([block(FARBODY, FARBODY.replace("rank: rank }", "rank: rank, far: 1 }")), block(FARBODY, FARBODY.replace("rank: rank }", "rank: rank, far: 1 }"))]);
  const c = await addTask(env, "touch the far function", "fx-rel/worker.js", ANCH);
  await tick(env); await tick(env);
  const cx = ctxOf(row(env, c.id));
  ok(cx.relocated === 1 && events(env, "code-task.window-relocated").length === 1 && events(env, "code-task.edit-nearest").length === 0, "the relocation runs first and no nearest event is written", { relocated: cx.relocated, nearest: events(env, "code-task.edit-nearest").length });
}

// ===== 8. large-file recovery stays inside the stored window and parks exact, replayable edits =====
{
  const filler = [];
  for (let i = 0; i < 12000; i++) filler.push("function bulk" + i + "(env) { return env && env.FLAG_" + i + " ? " + i + " : 0; } // keeps the file over the large window");
  const BIGL = ['var VERSION = "1.0.0-fixture";', filler.join("\n"), HEAD, BODY, "}", "export default { async fetch() { return new Response('ok'); } };", ""].join("\n");
  ok(BIGL.length > 900000, "fixture: the file is over the large-file bound", BIGL.length);
  for (const moved of [false, true]) {
    FILES["fx-near-big/worker.js"] = BIGL; FILES["fx-near-big/deployed-current.worker.js"] = BIGL;
    const { env, calls } = envWith([block(SEARCH_INVENTED, REPLACE_INVENTED)]);
    const c = await addTask(env, "return the id", "fx-near-big/worker.js");
    await tick(env);
    const initial = ctxOf(row(env, c.id));
    const current = moved ? "// lines added on main\n" + BIGL : BIGL;
    FILES["fx-near-big/worker.js"] = current; FILES["fx-near-big/deployed-current.worker.js"] = current;
    const r = await runTask(env, c.id), cx = ctxOf(r);
    ok(initial.large === true && initial.win.ws > 0 && r.status === "ready_to_publish" && Number(r.attempts) === 0 && calls.length === 1,
      "a large-file near SEARCH recovers without a failed attempt (moved=" + moved + ")", { status: r.status, attempts: r.attempts, last_error: r.last_error });
    ok(cx.base == null && r.ctx.length < 60000 && (!moved || cx.moved >= 1), "large-file recovery keeps bounded storage and follows a moved window", { size: r.ctx.length, moved: cx.moved });
    const eds = cx.edits || [];
    ok(eds.length === 1 && eds[0].search === BODY && eds[0].replace === REPLACE_INVENTED.replace(B3_INVENTED, B3),
      "large-file edits retain the file's own SEARCH and unchanged lines", eds);
    ok(eds.length === 1 && current.split(eds[0].search).length === 2 && String(cx.patch || "").includes("+  return { ok: true, status: label, rank: rank, id: id };") && !String(cx.patch || "").includes(B3_INVENTED),
      "the parked patch carries the change and its SEARCH replays exactly against current main");
    const ev = events(env, "code-task.edit-nearest"), meta = ev[0] ? JSON.parse(ev[0].meta || "{}") : {};
    ok(ev.length === 1 && meta.at === current.indexOf(BODY) && meta.search_sha256 === sha(SEARCH_INVENTED) && meta.window_sha256 === sha(BODY),
      "large-file recovery audits absolute offsets and both hashes", meta);
  }
  const ambiguous = BIGL.replace(BODY + "\n}", BODY + "\n}\nasync function planRowTwin(env, id) {\n" + BODY + "\n}");
  const outsideAnchor = "function outsideAnchor() { return 1; }";
  for (const [label, content, anchor] of [["ambiguous", ambiguous, HEAD], ["outside", outsideAnchor + "\n" + BIGL, outsideAnchor]]) {
    FILES["fx-near-big/worker.js"] = content; FILES["fx-near-big/deployed-current.worker.js"] = content;
    const { env } = envWith([block(SEARCH_INVENTED, REPLACE_INVENTED)]);
    const c = await addTask(env, "return the id", "fx-near-big/worker.js", anchor);
    const r = await runTask(env, c.id);
    ok(Number(r.attempts) >= 1 && /occurs 0 times in the shown content/.test(firstFail(env)) && events(env, "code-task.edit-nearest").length === 0 && r.status !== "ready_to_publish",
      "large-file recovery refuses a near SEARCH that is " + label, { status: r.status, error: r.last_error });
  }
}

console.log("search-nearest.test: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
