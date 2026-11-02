// CLAIMS-FIRST-1 (0.3.21, transformation lever T1.14): every code task reserves its WORK-CLAIM-1 file claim at enqueue and holds it through
// qnfo-deploy-guard /work-lock to its end; queue-behind tasks use their predecessor's claim; a file a session holds makes the task wait; a finished task releases
// its claim with the pull request and the outcome; the guard unreachable never breaks the loop.
// Run: node qnfo-code-orchestrator/claims-first.test.mjs
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
    CREATE TABLE cloud_ops_events (id TEXT, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT);`);
  return { prepare: wrap, _db: db };
}

// the deploy-guard stub: acquire (409 while a session holds the key and no token renews it), release, or down.
// CLAIMS-CTX-1: like the real guard, a token-less acquire against a live lease on the key is refused with the lease's own
// holder, even when that holder is the caller (the lease is the proof, the owner string is not); the held token renews.
const guard = { calls: [], held: null, down: false, tokens: 0, lease: {} };
const GUARD = "https://qnfo-deploy-guard";
// raw reads fail: a step ends in a read error, which is not this suite's subject; the guard is reached only over the binding
globalThis.fetch = async () => new Response("nf", { status: 404 });
const guardFetch = async (u, init) => {
  const url = String(u);
  if (url.startsWith(GUARD + "/work-lock/")) {
    if (guard.down) throw new Error("ECONNRESET");
    const body = JSON.parse(init.body);
    guard.calls.push({ path: url.slice(GUARD.length), body });
    if (url.endsWith("/acquire")) {
      if (guard.held && !body.token) return new Response(JSON.stringify({ key: body.key, acquired: false, reason: "work_claims", holder: guard.held, expires_at: "2099-01-01T00:00:00Z", intent: "a session edits it" }), { status: 409 });
      const lease = guard.lease[body.key];
      if (body.token && lease && lease.token === body.token) return new Response(JSON.stringify({ acquired: true, renewed: true, key: body.key, token: body.token, holder: lease.owner, expires_at: new Date(Date.now() + body.ttl_sec * 1000).toISOString(), in_flight: [] }), { status: 200 });
      if (lease) return new Response(JSON.stringify({ key: body.key, acquired: false, holder: lease.owner, since: lease.since, expires_at: "2099-01-01T00:00:00Z", in_flight: [] }), { status: 409 });
      const token = "tok" + (++guard.tokens);
      guard.lease[body.key] = { token, owner: body.owner, since: new Date().toISOString() };
      return new Response(JSON.stringify({ acquired: true, renewed: false, key: body.key, token, holder: body.owner, expires_at: new Date(Date.now() + body.ttl_sec * 1000).toISOString(), in_flight: [] }), { status: 200 });
    }
    if (url.endsWith("/release")) { if (guard.lease[body.key] && guard.lease[body.key].token === body.token) delete guard.lease[body.key]; return new Response(JSON.stringify({ released: true, key: body.key }), { status: 200 }); }
  }
  return new Response("nf", { status: 404 });
};
let aiCalls = 0;
const env = { ORCH_TOKEN: "t0ken", AUDIT_DB: makeD1(), PR_PUBLISH_MODE: "pull", JS_VERIFY: "dynamic", AI: { run: async () => { aiCalls++; return { response: "" }; } },
  LOADER: { load: () => ({ getEntrypoint: () => ({ fetch: async () => new Response("ok") }) }) }, DEPLOY_GUARD: { fetch: guardFetch } };
const hdr = { authorization: "Bearer t0ken", "content-type": "application/json" };
const tick = async (o) => (await worker.fetch(new Request("https://x/v1/tick", { method: "POST", headers: hdr, body: JSON.stringify(Object.assign({ maxSteps: 1, budgetMs: 25000, plan: false, intake: false }, o || {})) }), env)).json();
const addTask = async (goal, path = "fx-worker/worker.js") => {
  const r = await worker.fetch(new Request("https://x/v1/tasks", { method: "POST", headers: hdr, body: JSON.stringify({ repo: "qnfo-workers", path, goal }) }), env);
  return Object.assign(await r.json(), { http: r.status });
};
const db = env.AUDIT_DB._db;
const row = (id) => db.prepare("SELECT * FROM code_tasks WHERE id = ?").get(id);
const ctxOf = (id) => JSON.parse(row(id).ctx || "{}");
const acquires = () => guard.calls.filter((x) => x.path === "/work-lock/acquire");
const releases = () => guard.calls.filter((x) => x.path === "/work-lock/release");

// 1. ENQUEUE-CLAIM-RESERVATION-1: enqueue reserves the path briefly; the first step renews the claim
const a = await addTask("claims-first fixture: a task holds its file");
ok(a.ok && /^ct_/.test(a.id), "task enqueued", a);
ok(acquires().length === 1 && acquires()[0].body.key === "file:fx-worker/worker.js" && acquires()[0].body.ttl_sec === 900 && ctxOf(a.id).claim && ctxOf(a.id).claim.token === "tok1", "enqueue reserves the file for 15 minutes and records the claim", { calls: guard.calls, ctx: ctxOf(a.id) });
guard.held = "session_other";
const blockedAtEnqueue = await addTask("claims-first fixture: session already holds file", "fx-session-worker/worker.js");
ok(!blockedAtEnqueue.ok && blockedAtEnqueue.http === 409 && /session_other/.test(blockedAtEnqueue.error) && db.prepare("SELECT COUNT(*) AS n FROM code_tasks").get().n === 1, "a session that wins the race is respected and no duplicate task is inserted", blockedAtEnqueue);
guard.held = null;
guard.calls.length = 0;
let t = await tick();
let c = ctxOf(a.id).claim;
ok(t.steps === 1 && !t.done[0].deferred && acquires().length === 1 && acquires()[0].body.key === "file:fx-worker/worker.js" && acquires()[0].body.owner === "qnfo-code-orchestrator:" + a.id && acquires()[0].body.ttl_sec === 7200 && acquires()[0].body.token === "tok1", "the first step renews the reservation as the task's normal claim", acquires());
ok(c && c.token === "tok1" && c.key === "file:fx-worker/worker.js" && c.expires_at && !c.released_at && Date.parse(c.expires_at) - Date.now() > 60 * 60e3, "the task stores the renewed claim and expiry", c);

// 2. a fresh claim costs no guard call at the step; the step itself runs
guard.calls.length = 0;
t = await tick();
ok(acquires().length === 0 && t.steps === 1 && !t.done[0].deferred, "a task with a fresh claim steps without a guard call", { calls: guard.calls, t });
ok(t.claims && typeof t.claims.taken === "number" && t.claims.held === 0, "the tick reports the claims sweep", t.claims);

// 3. a claim near expiry is renewed with its token
db.prepare("UPDATE code_tasks SET ctx = json_set(ctx, '$.claim.expires_at', ?), status = 'queued', lease_until = NULL, attempts = 1 WHERE id = ?").run(new Date(Date.now() + 10 * 60e3).toISOString(), a.id);
guard.calls.length = 0;
t = await tick();
ok(acquires().length >= 1 && acquires()[0].body.token === "tok1" && ctxOf(a.id).claim.renewals >= 1 && Date.parse(ctxOf(a.id).claim.expires_at) - Date.now() > 60 * 60e3, "a claim under 45 minutes from expiry is renewed with its token", { ren: acquires(), c: ctxOf(a.id).claim });

// 4. a file a session holds: the step is deferred, no model call, the hold recorded (the task's own lease lapsed, so it has no claim)
db.prepare("UPDATE code_tasks SET ctx = json_remove(ctx, '$.claim'), status = 'queued', lease_until = NULL WHERE id = ?").run(a.id);
guard.lease = {}; guard.held = "session_other"; guard.calls.length = 0; aiCalls = 0;
t = await tick();
ok(t.done.length === 1 && t.done[0].deferred === true && /held by session_other/.test(t.done[0].error) && aiCalls === 0, "a task whose file a session holds is deferred without a model call", t.done);
const r4 = row(a.id);
ok(r4.status === "queued" && r4.lease_until && Date.parse(r4.lease_until) > Date.now() + 1 * 60e3, "the task keeps its place and waits CLAIM_WAIT_MS", r4);
ok(db.prepare("SELECT COUNT(*) AS n FROM cloud_ops_events WHERE kind = 'code-task.claim-held'").get().n >= 1 && t.claims.held >= 1, "the hold is recorded (event and sweep count)", t.claims);

// 5. the file is free again: the task takes the claim and steps
guard.held = null; guard.calls.length = 0;
// attempts reset: a third failed read would end the round, and since 0.14.2 a task in a SELF-REPAIR-1 backoff releases its
// claim (CLAIM-HELD-IN-BACKOFF-1, claim-backoff.test.mjs); this test needs the task to keep its claim until it is merged.
db.prepare("UPDATE code_tasks SET lease_until = NULL, attempts = 0 WHERE id = ?").run(a.id);
t = await tick();
ok(t.done.length === 1 && !t.done[0].deferred && ctxOf(a.id).claim && ctxOf(a.id).claim.token === "tok2", "once the file is free the task claims it and steps", { t, c: ctxOf(a.id).claim });

// 6. a finished task releases its claim with the pull request and the outcome
db.prepare("UPDATE code_tasks SET status = 'merged', pr_url = 'https://github.com/QNFO/qnfo-workers/pull/777' WHERE id = ?").run(a.id);
guard.calls.length = 0;
t = await tick();
ok(releases().length === 1 && releases()[0].body.token === "tok2" && releases()[0].body.key === "file:fx-worker/worker.js" && releases()[0].body.pr === 777 && releases()[0].body.outcome === "merged" && t.claims.released === 1, "a merged task releases its claim with the PR number and outcome merged", { rel: releases(), claims: t.claims });
c = ctxOf(a.id).claim;
ok(c.released_at && c.outcome === "merged" && c.release_status === 200, "the release is recorded on the task", c);
guard.calls.length = 0;
t = await tick();
ok(guard.calls.length === 0, "a released claim is never released twice", guard.calls);

// 7. the guard unreachable: nothing breaks, the step still runs, the sweep counts the error
guard.down = true;
const b = await addTask("claims-first fixture: guard down");
ok(b.ok && !ctxOf(b.id).claim, "enqueue survives an unreachable guard, without a claim", ctxOf(b.id));
t = await tick();
ok(t.ok && t.steps === 1 && !t.done[0].deferred && t.claims.errors >= 1, "the step runs and the sweep counts the guard error", t);
guard.down = false;

// 8. outcome names: a failed task releases as abandoned, without a PR
db.prepare("UPDATE code_tasks SET status = 'failed', ctx = json_set(COALESCE(ctx,'{}'), '$.claim', json(?)) WHERE id = ?").run(JSON.stringify({ key: "file:fx-worker/worker.js", token: "tokX", expires_at: "2099-01-01T00:00:00Z" }), b.id);
guard.calls.length = 0;
t = await tick();
ok(releases().length === 1 && releases()[0].body.outcome === "abandoned" && releases()[0].body.token === "tokX" && !("pr" in releases()[0].body), "a failed task releases as abandoned, without a PR", releases());

// 9. no DEPLOY_GUARD binding: claims are skipped and counted, nothing reaches the network
{
  const envNo = Object.assign({}, env, { DEPLOY_GUARD: undefined });
  let guardCalls = 0; const f0 = globalThis.fetch; globalThis.fetch = async (...a) => { if (/deploy-guard|work-lock/.test(String(a[0]))) guardCalls++; return f0(...a); };
  const c9 = await (await worker.fetch(new Request("https://x/v1/tasks", { method: "POST", headers: hdr, body: JSON.stringify({ repo: "qnfo-workers", path: "fx-other/worker.js", goal: "no binding" }) }), envNo)).json();
  // maxSteps 1: 0 reads as the default 8, and three failed reads park the task in a backoff the sweep skips (CLAIM-HELD-IN-BACKOFF-1).
  const t9 = await (await worker.fetch(new Request("https://x/v1/tick", { method: "POST", headers: hdr, body: JSON.stringify({ maxSteps: 1, plan: false, intake: false }) }), envNo)).json();
  ok(c9.ok && !ctxOf(c9.id).claim && t9.claims && t9.claims.errors >= 1 && t9.claims.taken === 0 && guardCalls === 0, "without the binding no claim is taken, the sweep counts it, and no guard call leaves the worker", { c9, claims: t9.claims, guardCalls });
  globalThis.fetch = f0;
}

// 10. /health names the behaviour
const h = await (await worker.fetch(new Request("https://x/health"), env)).json();
ok(atLeast(h.version, "0.3.21") && (h.limitations || []).some((l) => /CLAIMS-FIRST-1/.test(l)), "health names CLAIMS-FIRST-1 and the version is 0.3.21+", { v: h.version });

// 11. CLAIMS-CTX-1 (0.4.1): the enqueue reservation survives the read step (ctx rebuilt from the file) and the propose step (ctx written back
//     whole), so the next acquire carries the token and renews. Before the fix the token was gone after the first step and every
//     later acquire was refused by the task's own lease, which the stub now models like the real guard.
{
  const f0 = globalThis.fetch, ai0 = env.AI.run;
  globalThis.fetch = async (u) => /raw\.githubusercontent\.com\/QNFO\/qnfo-workers\/main\/fx-worker\/README\.md$/.test(String(u)) ? new Response("# keep\n\nline\n", { status: 200 }) : new Response("nf", { status: 404 });
  env.AI.run = async () => ({ response: "```file\n# keep\n\nchanged\n```" });
  db.prepare("UPDATE code_tasks SET status = 'closed' WHERE status = 'queued'").run();
  guard.held = null; guard.lease = {}; guard.calls.length = 0;
  const k = await (await worker.fetch(new Request("https://x/v1/tasks", { method: "POST", headers: hdr, body: JSON.stringify({ repo: "qnfo-workers", path: "fx-worker/README.md", goal: "claims-ctx fixture: change the line" }) }), env)).json();
  const tok = ctxOf(k.id).claim && ctxOf(k.id).claim.token;
  ok(k.ok && tok && acquires().length === 1 && acquires()[0].body.ttl_sec === 900, "11a enqueue reserves the task file with a 15-minute claim", ctxOf(k.id));
  guard.calls.length = 0;
  let tk = await tick();
  ok(tk.steps === 1 && !tk.done[0].deferred && tk.done[0].step === "read" && row(k.id).step === "propose" && acquires().length === 1 && acquires()[0].body.token === tok, "11c the read step renews its enqueue reservation", { tk, calls: guard.calls });
  const selfRefused = await (await guardFetch(GUARD + "/work-lock/acquire", { body: JSON.stringify({ key: "file:fx-worker/README.md", owner: "qnfo-code-orchestrator:" + k.id, ttl_sec: 7200 }) })).json();
  ok(selfRefused.acquired === false && selfRefused.holder === "qnfo-code-orchestrator:" + k.id, "11b the stub refuses a token-less acquire with the task's own lease, as the guard does", selfRefused);
  let ck = ctxOf(k.id);
  ok(ck.base === "# keep\n\nline\n" && ck.claim && ck.claim.token === tok, "11d after the read step the rebuilt ctx still carries the claim token", { claim: ck.claim, hasBase: !!ck.base });
  tk = await tick();
  ck = ctxOf(k.id);
  ok(row(k.id).step === "verify" && ck.proposal && ck.claim && ck.claim.token === tok, "11e after the propose step (ctx written back whole) the claim token is still on the row", { step: row(k.id).step, claim: ck.claim });
  db.prepare("UPDATE code_tasks SET ctx = json_set(ctx, '$.claim.expires_at', ?), lease_until = NULL WHERE id = ?").run(new Date(Date.now() + 10 * 60e3).toISOString(), k.id);
  guard.calls.length = 0;
  tk = await tick();
  const ac = acquires();
  ok(ac.length >= 1 && ac[0].body.token === tok && !tk.done[0].deferred && ctxOf(k.id).claim.renewals >= 1, "11f near expiry the next acquire carries the token and renews; the task is never refused by its own lease", { tokens: ac.map((x) => x.body.token), done: tk.done });
  globalThis.fetch = f0; env.AI.run = ai0;
}

console.log(`claims-first: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
