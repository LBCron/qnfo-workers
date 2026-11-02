// FAIL-SIGNATURE-STOP-1 (qnfo-code-orchestrator 0.16.0, failure mode code-task-retry-holds-file, agent_issues 1834/2491, pillar autonomy).
// On 2026-10-13 ct_oevdiafbcde2mg failed math-latex.test.mjs on all 5 attempts and ct_53djh2yfqk3ocj broke diversity-cap.test.mjs on
// all 8, each renewing its file claim for hours: the publisher's suite feedback added attempts outside fail(), so no round backoff
// and no exhaustion ever applied. This suite proves:
//   A. three failed attempts with the same signature (a SEARCH absent from the file) end the task 'failed' at once, with one
//      CODE-LOOP-EXHAUSTED-1 issue that names the signature, and the claim is released then, not at a later sweep;
//   B. three different failures run the round as before: a backoff, the claim released with outcome 'backoff', never re-taken by
//      the sweep (not even inside the last 30 minutes of the wait), and a fresh claim (no old token) when the task runs again;
//   C. the publisher's suite feedback is accounted at the next step: the same failing assertion three times (payloads differ) ends
//      the task before any model call; a different third failure is a round end with a backoff and a released claim;
//   D. a provider timeout neither counts toward the stop nor breaks the run of identical failures.
// Run: node qnfo-code-orchestrator/fail-signature-stop.test.mjs   (exit 0 = all passed)
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
    CREATE UNIQUE INDEX idx_agent_issues_open_title ON agent_issues(title) WHERE status = 'open';
    CREATE TABLE cloud_ops_events (id TEXT, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT);`);
  return { prepare: wrap, _db: db };
}

// qnfo-deploy-guard /work-lock, as in claim-backoff.test.mjs: a held token renews, a released one falls through to a fresh lease.
const guard = { calls: [], lease: {}, tokens: 0 };
const GUARD = "https://qnfo-deploy-guard";
const guardFetch = async (u, init) => {
  const url = String(u);
  const body = JSON.parse(init.body);
  guard.calls.push({ path: url.slice(GUARD.length), body });
  const lease = guard.lease[body.key];
  const exp = (s) => new Date(Date.now() + s * 1000).toISOString();
  if (url.endsWith("/acquire")) {
    if (body.token && lease && lease.token === body.token) return new Response(JSON.stringify({ acquired: true, renewed: true, key: body.key, token: body.token, expires_at: exp(body.ttl_sec) }), { status: 200 });
    if (lease) return new Response(JSON.stringify({ key: body.key, acquired: false, holder: lease.owner }), { status: 409 });
    const token = "tok" + (++guard.tokens);
    guard.lease[body.key] = { token, owner: body.owner };
    return new Response(JSON.stringify({ acquired: true, renewed: false, key: body.key, token, expires_at: exp(body.ttl_sec) }), { status: 200 });
  }
  if (url.endsWith("/release")) {
    if (!lease || lease.token !== body.token) return new Response(JSON.stringify({ released: false, error: "not_holder" }), { status: 409 });
    delete guard.lease[body.key];
    return new Response(JSON.stringify({ released: true }), { status: 200 });
  }
  return new Response("nf", { status: 404 });
};

// A ~15 KB worker (patch mode, whole-file window) per fixture directory, served as raw GitHub reads of main.
const TARGET = "function target(env) { return env && env.ON ? 1 : 0; }";
const fixture = (name) => {
  const l = ["// " + name + " (fixture)", 'var VERSION = "1.2.3-fx";'];
  for (let i = 0; l.join("\n").length < 15000; i++) l.push("function filler" + i + "(env) { return env && env.FLAG_" + i + " ? " + i + " : 0; }");
  l.push(TARGET, "export default { async fetch() { return new Response('ok'); } };", "");
  return l.join("\n");
};
const FILES = {};
for (const d of ["fx-a", "fx-b", "fx-c", "fx-c2", "fx-d", "fx-e", "fx-e2"]) { FILES[d + "/worker.js"] = fixture(d); FILES[d + "/deployed-current.worker.js"] = FILES[d + "/worker.js"]; }
globalThis.fetch = async (u) => {
  const m = /^https:\/\/raw\.githubusercontent\.com\/QNFO\/qnfo-workers\/main\/(.+)$/.exec(String(u));
  const p = m ? decodeURIComponent(m[1]) : null;
  return p && FILES[p] != null ? new Response(FILES[p], { status: 200 }) : new Response("nf", { status: 404 });
};
const block = (a, b) => "<<<<<<< SEARCH\n" + a + "\n=======\n" + b + "\n>>>>>>> REPLACE";
const GOOD = block(TARGET, TARGET.replace("? 1 : 0", "? 2 : 0"));
const absent = (n) => block("function missing" + n + "(env) { return " + n + "; }", "function missing(env) { return 0; }");
const PROSE = "I would rather explain the change than make it.";

const replies = [];
let aiCalls = 0;
const fakeLoader = { load: () => ({ getEntrypoint: () => ({ fetch: async () => new Response("ok") }) }) };
const env = { ORCH_TOKEN: "t0ken", AUDIT_DB: makeD1(), PR_PUBLISH_MODE: "pull", JS_VERIFY: "dynamic", LOADER: fakeLoader, DEPLOY_GUARD: { fetch: guardFetch },
  AI: { run: async () => { aiCalls++; const r = replies.shift(); if (r instanceof Error) throw r; return { response: r == null ? "" : r }; } } };
const hdr = { authorization: "Bearer t0ken", "content-type": "application/json" };
const tick = async (o) => (await worker.fetch(new Request("https://x/v1/tick", { method: "POST", headers: hdr, body: JSON.stringify(Object.assign({ maxSteps: 12, budgetMs: 25000, plan: false, intake: false }, o || {})) }), env)).json();
const db = env.AUDIT_DB._db;
const row = (id) => db.prepare("SELECT * FROM code_tasks WHERE id = ?").get(id);
const ctxOf = (id) => JSON.parse(row(id).ctx || "{}");
const callsFor = (p, key) => guard.calls.filter((x) => x.path === p && x.body.key === key);
const expire = (id) => db.prepare("UPDATE code_tasks SET lease_until = ? WHERE id = ?").run(new Date(Date.now() - 1000).toISOString(), id);
const issues = (id) => db.prepare("SELECT * FROM agent_issues WHERE title LIKE ?").all("CODE-LOOP-EXHAUSTED-1: " + id + "%");
const events = (kind, id) => db.prepare("SELECT * FROM cloud_ops_events WHERE kind = ? AND text LIKE ?").all(kind, id + "%");
const add = async (dir) => (await (await worker.fetch(new Request("https://x/v1/tasks", { method: "POST", headers: hdr, body: JSON.stringify({ repo: "qnfo-workers", path: dir + "/worker.js", goal: "fail-signature fixture " + dir + ": return 2 from target when ON is set" }) }), env)).json()).id;
// The publisher's PUBLISH-SUITE-CHECK-1 requeue, verbatim from scripts/code-task-publish.py requeue_for_syntax.
const LANG = "the worker's suites fail after applying the edits and pass on main without them (PUBLISH-SUITE-CHECK-1); keep the change and fix what these tests assert: ";
const publisherFail = (id, err) => { const msg = LANG + err; db.prepare("UPDATE code_tasks SET status='queued', step='propose', attempts=attempts+1, lease_until=NULL, last_error=?, ctx=json_set(COALESCE(ctx, '{}'), '$.lastError', ?), updated_at=? WHERE id=?").run(msg, msg, new Date().toISOString(), id); };
const mathFail = (n) => "FAIL qnfo-research-exec/math-latex.test.mjs: AssertionError [ERR_ASSERTION]: plain-text math sends the paper to revise: {\"ok\":false,\"stage\":\"review\",\"round\":" + n + "}";

ok(atLeast((await (await worker.fetch(new Request("https://x/health"), env)).json()).version, "0.16.0"), "0 /health reports 0.16.0 or later");

// ===== A. the same failure three times in a row ends the task at once =====
{
  const id = await add("fx-a");
  const K = "file:fx-a/worker.js";
  replies.push(absent(11), absent(222), absent(3));
  const t = await tick();
  const r = row(id), c = ctxOf(id);
  ok(r.status === "failed" && r.attempts === 3 && r.lease_until == null, "A1 three 'SEARCH occurs 0 times' failures end the task failed, with no backoff", { st: r.status, a: r.attempts, lease: r.lease_until, done: t.done });
  ok(/FAIL-SIGNATURE-STOP-1: the same failure 3 attempts in a row \(SEARCH occurs 0 times\)/.test(r.last_error) && /agent_issues #\d+/.test(r.last_error), "A2 last_error names the repeated signature and the fleet issue", r.last_error);
  const iss = issues(id);
  ok(iss.length === 1 && iss[0].status === "open" && /FAIL-SIGNATURE-STOP-1: SEARCH occurs 0 times/.test(iss[0].description) && /3 attempts, the last 3 failing the same way/.test(iss[0].description), "A3 one CODE-LOOP-EXHAUSTED-1 issue names the signature", iss.map((i) => i.description.slice(0, 300)));
  ok(Array.isArray(c.sigs) && c.sigs.length === 3 && c.sigs.every((s) => s === "SEARCH occurs 0 times") && c.sig_n === 3, "A4 ctx keeps the signature run", { sigs: c.sigs, n: c.sig_n });
  const rel = callsFor("/work-lock/release", K);
  ok(rel.length === 1 && !guard.lease[K] && c.claim && c.claim.released_at && rel[0].body.outcome === "abandoned", "A5 the claim is released when the task ends", { rel, claim: c.claim });
  ok(events("code-task.sig-stop", id).length === 1, "A6 the stop is audited (code-task.sig-stop)");
  ok(aiCalls === 3, "A7 three model calls, not nine", aiCalls);
}

// ===== B. different failures: the round backs off, the claim is released and not re-taken =====
{
  const id = await add("fx-b");
  const K = "file:fx-b/worker.js";
  replies.push(absent(1), PROSE, block(TARGET + "\n" + TARGET, "x"));
  const n0 = aiCalls;
  await tick();
  const r = row(id), c = ctxOf(id);
  ok(r.status === "queued" && r.attempts === 3 && Date.parse(r.lease_until) - Date.now() > 3 * 60e3 && /SELF-REPAIR-1: round 1 of 3 failed/.test(r.last_error) && aiCalls - n0 === 3, "B1 three different failures end the round with a backoff, not the task", { st: r.status, a: r.attempts, err: r.last_error, sigs: c.sigs });
  const rel = callsFor("/work-lock/release", K);
  const oldTok = rel[0] && rel[0].body.token;
  ok(rel.length === 1 && rel[0].body.outcome === "backoff" && c.claim.released_at && c.claim.outcome === "backoff" && !guard.lease[K], "B2 the backoff releases the claim with outcome backoff", { rel, claim: c.claim });
  db.prepare("UPDATE code_tasks SET lease_until = ? WHERE id = ?").run(new Date(Date.now() + 10 * 60e3).toISOString(), id);
  guard.calls.length = 0;
  await tick();
  ok(callsFor("/work-lock/acquire", K).length === 0 && !guard.lease[K], "B3 the sweep never re-takes the released claim, even 10 minutes before the task resumes", guard.calls);
  expire(id); replies.push(GOOD); guard.calls.length = 0;
  await tick();
  const acq = callsFor("/work-lock/acquire", K);
  const freshClaim = ctxOf(id).claim;
  const release = callsFor("/work-lock/release", K).find((x) => x.body.token === freshClaim.token);
  ok(acq.length >= 1 && !acq[0].body.token && freshClaim.token !== oldTok && freshClaim.released_at && release && !guard.lease[K], "B4 on resume the task takes a fresh claim and releases it after reaching ready_to_publish", { acq, claim: freshClaim, release });
  ok(row(id).status === "ready_to_publish", "B5 the resumed task lands its edit", { st: row(id).status, err: row(id).last_error });
}

// ===== C. the publisher's suite feedback is accounted: the same assertion three times stops the task before a model call =====
{
  const id = await add("fx-c");
  const K = "file:fx-c/worker.js";
  replies.push(GOOD);
  await tick();
  ok(row(id).status === "ready_to_publish" && row(id).attempts === 0, "C1 the task reaches the publisher", { st: row(id).status, err: row(id).last_error });
  publisherFail(id, mathFail(1));
  replies.push(GOOD);
  await tick();
  ok(row(id).status === "ready_to_publish" && row(id).attempts === 1 && ctxOf(id).suite_rebase_attempted && /PUBLISH-SUITE-CHECK-1/.test(ctxOf(id).suite_rebase_reason) && !Array.isArray(ctxOf(id).sigs), "C2 the first publisher suite failure gets one fresh read before signature tracking", { st: row(id).status, rebase: ctxOf(id).suite_rebase_attempted, sigs: ctxOf(id).sigs });
  publisherFail(id, mathFail(22));
  replies.push(GOOD);
  await tick();
  ok(row(id).status === "ready_to_publish" && row(id).attempts === 2 && ctxOf(id).sigs.join() === "suite math-latex.test.mjs: plain-text math sends the paper to revise" && ctxOf(id).sig_n === 2, "C3 the first post-rebase suite failure is recorded by its suite and first assertion line", { st: row(id).status, sigs: ctxOf(id).sigs, n: ctxOf(id).sig_n });
  publisherFail(id, mathFail(333));
  replies.push(GOOD);
  await tick();
  ok(row(id).status === "ready_to_publish" && row(id).attempts === 3 && ctxOf(id).sigs.length === 2, "C4 the second identical post-rebase failure (a different payload) still runs", { st: row(id).status, sigs: ctxOf(id).sigs });
  publisherFail(id, mathFail(444));
  const n0 = aiCalls;
  guard.calls.length = 0;
  await tick();
  const r = row(id);
  ok(r.status === "failed" && r.attempts === 4 && aiCalls === n0, "C5 the third identical post-rebase suite failure ends the task before any model call", { st: r.status, a: r.attempts, calls: aiCalls - n0 });
  ok(/FAIL-SIGNATURE-STOP-1: the same failure 3 attempts in a row \(suite math-latex\.test\.mjs: plain-text math sends the paper to revise\)/.test(r.last_error), "C5 last_error names the failing suite and assertion", r.last_error);
  ok(issues(id).length === 1 && /math-latex\.test\.mjs/.test(issues(id)[0].description), "C6 its CODE-LOOP-EXHAUSTED-1 issue is filed");
  ok(!guard.lease[K] && ctxOf(id).claim.released_at, "C7 the file is free once the task ends", { lease: guard.lease[K], claim: ctxOf(id).claim });

  const id2 = await add("fx-c2");
  const K2 = "file:fx-c2/worker.js";
  replies.push(GOOD); await tick();
  publisherFail(id2, mathFail(1)); replies.push(GOOD); await tick();
  publisherFail(id2, mathFail(2)); replies.push(GOOD); await tick();
  publisherFail(id2, "FAIL idea-hub/diversity-cap.test.mjs: FAIL with fewer than DIVERSITY_MIN_N accepts in the window a quantum ACCEPT passes :: {\"triaged\":0}");
  const n1 = aiCalls;
  await tick();
  const r2 = row(id2), c2 = ctxOf(id2);
  ok(r2.status === "queued" && r2.attempts === 3 && Date.parse(r2.lease_until) - Date.now() > 3 * 60e3 && aiCalls === n1 && /round 1 of 3 failed/.test(r2.last_error), "C8 a different third publisher failure is a round end: a backoff, no model call", { st: r2.status, a: r2.attempts, err: r2.last_error });
  ok(c2.sigs[1] === "suite diversity-cap.test.mjs: with fewer than DIVERSITY_MIN_N accepts in the window a quantum ACCEPT passes", "C9 the signature drops the payload after ' :: '", c2.sigs);
  ok(!guard.lease[K2] && c2.claim.released_at && c2.claim.outcome === "backoff", "C10 the publisher-fed backoff releases the claim (outcome backoff)", c2.claim);
}

// ===== D. a provider timeout neither counts nor breaks the run =====
{
  const id = await add("fx-d");
  replies.push(absent(1), new Error("3046: Request timeout"));
  await tick();
  ok(row(id).status === "queued" && row(id).attempts === 1 && ctxOf(id).timeouts === 1 && ctxOf(id).sigs.length === 1, "D1 the timeout keeps the attempt and adds no signature", { st: row(id).status, a: row(id).attempts, c: ctxOf(id) });
  expire(id); replies.push(absent(2), absent(3));
  await tick();
  const r = row(id);
  ok(r.status === "failed" && r.attempts === 3 && /SEARCH occurs 0 times/.test(r.last_error), "D2 three identical failures around a timeout still stop the task", { st: r.status, a: r.attempts, err: r.last_error });
}

// ===== E. FOLD-PAIR-TASK-1 (0.19.0): a parity-suite failure ends the task at the first one, before any model call =====
{
  const cases = [["fx-e", "FAIL qnfo-cloud-ops/email-orch-fold.test.mjs: FAIL every orchestrator line is in the host except its VERSION line :: [\"var SLA_GRACE_H = 12;\"]"],
    ["fx-e2", "FAIL personal-api/companion.test.mjs: FAIL worker.js carries the current companion.js (run personal-api/inline-companion.mjs)"]];
  for (const [dir, err] of cases) {
    const id = await add(dir);
    replies.push(GOOD); await tick();
    publisherFail(id, err);
    const n0 = aiCalls;
    await tick();
    const r = row(id);
    ok(r.status !== "queued" && r.status !== "ready_to_publish" && /^FOLD-PAIR-TASK-1: /.test(r.last_error) && aiCalls === n0, "E1 " + dir + ": the first parity-suite failure ends the task with no model call", { st: r.status, err: r.last_error, calls: aiCalls - n0 });
    ok(events("code-task.pair-refused", id).length === 1, "E2 " + dir + ": the stop is audited (code-task.pair-refused)");
    ok(r.goal.includes("qnfo-workers") && /same commit/.test(r.goal) &&
      (dir === "fx-e2"
        ? r.goal.includes("personal-api/companion.js") && r.goal.includes("node personal-api/inline-companion.mjs") && r.goal.includes("deployed-current.worker.js")
        : /two-file/i.test(r.goal)),
      "E3 " + dir + ": the stored handoff goal requires the paired files or regeneration", r.goal);
  }
}

console.log("fail-signature-stop: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
