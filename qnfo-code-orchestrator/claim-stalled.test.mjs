// CLAIM-STALLED-RELEASE-1 (qnfo-code-orchestrator 0.38.1, 2026-11-04). ct_y1la8qrww2mbak sat queued at step verify with last_error "patch too large",
// no lease and no pull request, unsaved since 11-03T01:21Z, and claimsSweep renewed its claim on file:qnfo-research-exec/worker.js every 2 hours
// for 38 hours, so six queued tasks and every session were refused the file. This suite proves the sweep releases such a claim, keeps renewing
// the claim of a task that moves or owns a pull request, and does not re-take the released one.
// (template: CLAIM-PUBLISHED-RELEASE-1, 0.18.20. A 'published' task is not in
// CODE_TASK_DONE — that list also decides whether a file is busy for CODE-DISPATCH-DEDUPE-1 and whether a retry is
// refused as in flight — so the claims sweep renewed its claim for ever. Measured 21:13Z: ct_im2925 published at
// 13:55:57Z still held file:qnfo-social/worker.js and deferred 9 tasks 104 times in 28 minutes. This suite proves the
// sweep now releases a published task's claim, keeps the file busy for dedupe, and does not re-take the claim.
// Run: node qnfo-code-orchestrator/claim-stalled.test.mjs
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
const here = path.dirname(fileURLToPath(import.meta.url));
const worker = (await import(pathToFileURL(path.join(here, "worker.js")).href)).default;
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? "  -- " + JSON.stringify(x).slice(0, 700) : "")); } };

function makeD1() {
  const db = new DatabaseSync(":memory:");
  const wrap = (sql) => {
    let args = [];
    // CLAIMS-BIND-COUNT-1: production D1 answers "Wrong number of parameter bindings for SQL query." when the marker
    // count and the bound values disagree; node:sqlite silently binds the gap as NULL. That divergence let 0.18.20 ship
    // a sweep whose release loop was dead in production while every suite passed, so the stub now refuses it the same
    // way the live database does.
    const markers = (sql.match(/\?/g) || []).length;
    const st = {
      bind: (...a) => { args = a.map((v) => (v === undefined ? null : v)); return st; },
      run: async () => { if (args.length !== markers) throw new Error("Wrong number of parameter bindings for SQL query."); const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
      first: async () => { if (args.length !== markers) throw new Error("Wrong number of parameter bindings for SQL query."); return db.prepare(sql).get(...args) || null; },
      all: async () => { if (args.length !== markers) throw new Error("Wrong number of parameter bindings for SQL query."); return { results: db.prepare(sql).all(...args) }; },
    };
    return st;
  };
  db.exec(`CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT DEFAULT 'optimization', priority TEXT DEFAULT 'medium', status TEXT DEFAULT 'open', linked_session TEXT, created_at INTEGER, updated_at INTEGER);
    CREATE UNIQUE INDEX idx_agent_issues_open_title ON agent_issues(title) WHERE status = 'open';
    CREATE TABLE cloud_ops_events (id TEXT, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT);`);
  return { prepare: wrap, _db: db };
}

const guard = { released: [], lease: {}, tokens: 0, acquires: [] };
const guardFetch = async (u, init) => {
  const url = String(u), body = JSON.parse(init.body);
  const exp = (s) => new Date(Date.now() + s * 1000).toISOString();
  if (url.endsWith("/acquire")) {
    guard.acquires.push(body.key);
    const lease = guard.lease[body.key];
    if (body.token && lease && lease.token === body.token) return new Response(JSON.stringify({ acquired: true, renewed: true, key: body.key, token: body.token, expires_at: exp(body.ttl_sec) }), { status: 200 });
    if (lease) return new Response(JSON.stringify({ key: body.key, acquired: false, holder: lease.owner }), { status: 409 });
    const token = "tok" + (++guard.tokens);
    guard.lease[body.key] = { token, owner: body.owner };
    return new Response(JSON.stringify({ acquired: true, renewed: false, key: body.key, token, expires_at: exp(body.ttl_sec) }), { status: 200 });
  }
  if (url.endsWith("/release")) {
    const lease = guard.lease[body.key];
    guard.released.push(body.key + ":" + body.token);
    if (!lease || lease.token !== body.token) return new Response(JSON.stringify({ released: false, error: "not_holder" }), { status: 409 });
    delete guard.lease[body.key];
    return new Response(JSON.stringify({ released: true }), { status: 200 });
  }
  return new Response("nf", { status: 404 });
};
globalThis.fetch = async () => new Response("nf", { status: 404 });

const env = { ORCH_TOKEN: "t0ken", AUDIT_DB: makeD1(), PR_PUBLISH_MODE: "pull", LOADER: { load: () => ({ getEntrypoint: () => ({ fetch: async () => new Response("ok") }) }) },
  DEPLOY_GUARD: { fetch: guardFetch }, AI: { run: async () => ({ response: "" }) } };
const hdr = { authorization: "Bearer t0ken", "content-type": "application/json" };
const tick = async () => (await worker.fetch(new Request("https://x/v1/tick", { method: "POST", headers: hdr, body: JSON.stringify({ maxSteps: 1, budgetMs: 2000, plan: false, intake: false }) }), env)).json();
const db = env.AUDIT_DB._db;
const now = new Date().toISOString();
const KEY = "file:fxpub/fxpub/worker.js", TOKEN = "pubtok";


const first = await tick();
ok(first && first.ok === true, "a tick creates the schema and runs", first && first.error);

const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();
const soon = () => new Date(Date.now() + 1800e3).toISOString(); // under 45 minutes left: due for renewal
const mk = (id, path, status, step, attempts, prUrl, updatedAt, token, key) => {
  db.prepare("INSERT INTO code_tasks (id, repo, path, goal, status, step, attempts, ctx, branch, pr_url, last_error, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(id, "qnfo-workers", path, "g", status, step, attempts, JSON.stringify({ claim: { key, token, expires_at: soon(), since: ago(38), renewals: 17, released_at: null } }), null, prUrl, "patch too large: exceeds verification limit", ago(40), updatedAt);
  guard.lease[key] = { token, owner: "qnfo-code-orchestrator:" + id };
};
// 1. the zombie: queued, verify, no lease, no PR, unsaved for 38 h
mk("ct_zombie", "fxz/fxz/worker.js", "queued", "verify", 1, null, ago(38), "ztok", "file:fxz/fxz/worker.js");
// 2. moving: queued, saved a minute ago
mk("ct_moving", "fxm/fxm/worker.js", "queued", "propose", 2, null, ago(0.02), "mtok", "file:fxm/fxm/worker.js");
// 3. quiet but 2 hours only: under the 3 hour stall line
mk("ct_quiet", "fxq/fxq/worker.js", "queued", "verify", 1, null, ago(2), "qtok", "file:fxq/fxq/worker.js");
// 4. old but owns a pull request
mk("ct_haspr", "fxp/fxp/worker.js", "queued", "verify", 1, "https://github.com/QNFO/qnfo-workers/pull/9", ago(38), "ptok", "file:fxp/fxp/worker.js");

// An earlier, unfinished task on the same file (here a published PR awaiting merge) keeps claim() from handing the queued task to a lane, which
// is how a real zombie stays unsaved: the lane's claim would otherwise stamp updated_at. This is the production shape of ct_y1la8qrww2mbak.
for (const [i, pth] of ["fxz", "fxm", "fxq", "fxp"].entries()) {
  db.prepare("INSERT INTO code_tasks (id, repo, path, goal, status, step, attempts, ctx, branch, pr_url, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
    .run("ct_blocker_" + i, "qnfo-workers", pth + "/" + pth + "/worker.js", "earlier", "published", "done", 1, "{}", "codex/b", "https://github.com/QNFO/qnfo-workers/pull/" + (100 + i), ago(60), ago(60));
}
const claimOf = (id) => JSON.parse(db.prepare("SELECT ctx FROM code_tasks WHERE id = ?").get(id).ctx).claim;
const res = await tick();
ok(guard.released.some((x) => x === "file:fxz/fxz/worker.js:ztok"), "the zombie's claim is released at the guard", guard.released);
const zc = claimOf("ct_zombie");
ok(!!zc.released_at && zc.stalled === true && zc.outcome === "abandoned", "the row records the stalled release", zc);
ok(!guard.lease["file:fxz/fxz/worker.js"], "the file is free for a session to acquire");
ok(res.claims && res.claims.stalled === 1 && !res.claims.error, "the sweep reports one stalled release", res.claims);
ok(guard.acquires.indexOf("file:fxz/fxz/worker.js") < 0, "the zombie is not renewed on the way", guard.acquires);
ok(db.prepare("SELECT COUNT(*) AS n FROM cloud_ops_events WHERE kind = 'code-task.claim-stalled'").get().n === 1, "one code-task.claim-stalled event");

ok(guard.acquires.indexOf("file:fxm/fxm/worker.js") >= 0 && !!guard.lease["file:fxm/fxm/worker.js"] && !claimOf("ct_moving").released_at, "a task saved a minute ago keeps and renews its claim");
ok(!claimOf("ct_quiet").released_at && !!guard.lease["file:fxq/fxq/worker.js"], "two quiet hours is under the stall line: claim kept");
ok(!claimOf("ct_haspr").released_at && !!guard.lease["file:fxp/fxp/worker.js"], "an old task with a pull request keeps its claim (the PR is the work)");

guard.acquires.length = 0; guard.released.length = 0;
const res2 = await tick();
ok(guard.acquires.indexOf("file:fxz/fxz/worker.js") < 0 && guard.released.indexOf("file:fxz/fxz/worker.js:ztok") < 0, "the next sweep neither re-takes nor re-releases the zombie", { acquires: guard.acquires, released: guard.released });
ok(res2.claims && res2.claims.stalled === 0, "and reports none", res2.claims);

// a session can now take the file
const lease = guard.lease["file:fxz/fxz/worker.js"];
ok(!lease, "no holder remains on the zombie's file");

console.log(pass + " passed, " + fail + " failed");
process.exitCode = fail ? 1 : 0;
