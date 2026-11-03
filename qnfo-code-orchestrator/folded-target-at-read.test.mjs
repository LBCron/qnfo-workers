// FOLDED-TARGET-AT-READ-1 offline suite (qnfo-code-orchestrator 0.29.1, 2026-10-26, pillar autonomy).
// ct_im1000417 was inserted straight into code_tasks by the RED-DRAIN-1 dispatch on qnfo-backlog-exec/worker.js, a FOLDED member: enqueue() runs foldedHost (FOLDED-TARGET-REDIRECT-1) and
// retiredTarget (RETIRED-TARGET-1), a direct row never passes it, and the read step judged only the merge scope. The merge runner merged PR 4620, the canonical deploy skips FOLDED
// directories and qnfo-lifecycle/backlog-fold.test.mjs turned the full suite red on main. This suite proves the read step now runs the same rules in enqueue()'s order, with no model call:
// a FOLDED member's path (and its deployed-current mirror) becomes its host's, whether the row names the repo as qnfo-workers or QNFO/qnfo-workers; a host that is itself out of the merge
// scope ends the task needs_human; a RETIRED or unregistered worker ends needs_human; a live worker is untouched even with a stale fold row; and a missing registry changes nothing.
// Run: node qnfo-code-orchestrator/folded-target-at-read.test.mjs   -> prints "N passed, 0 failed"
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
const lease = {}; let tokens = 0;
const guardFetch = async (u, init) => {
  const url = String(u), body = JSON.parse(init.body);
  if (url.endsWith("/acquire")) {
    const l = lease[body.key];
    if (l && l.token !== body.token) return new Response(JSON.stringify({ key: body.key, acquired: false, holder: l.owner }), { status: 409 });
    const token = body.token || "tok" + (++tokens); lease[body.key] = { token, owner: body.owner };
    return new Response(JSON.stringify({ acquired: true, key: body.key, token, expires_at: new Date(Date.now() + body.ttl_sec * 1000).toISOString() }), { status: 200 });
  }
  if (url.endsWith("/release")) { delete lease[body.key]; return new Response(JSON.stringify({ released: true }), { status: 200 }); }
  return new Response("nf", { status: 404 });
};
globalThis.fetch = async () => new Response("nf", { status: 404 });
let aiCalls = 0;
const env = { ORCH_TOKEN: "t0ken", AUDIT_DB: makeD1(), PR_PUBLISH_MODE: "pull", LOADER: { load: () => ({ getEntrypoint: () => ({ fetch: async () => new Response("ok") }) }) },
  DEPLOY_GUARD: { fetch: guardFetch }, AI: { run: async () => { aiCalls++; return { response: "" }; } } };
const hdr = { authorization: "Bearer t0ken", "content-type": "application/json" };
const tick = async () => (await worker.fetch(new Request("https://x/v1/tick", { method: "POST", headers: hdr, body: JSON.stringify({ maxSteps: 4, budgetMs: 4000, plan: false, intake: false }) }), env)).json();
const db = env.AUDIT_DB._db;

const first = await tick();
ok(first && first.ok === true, "a tick creates the schema and runs", first);
const now = new Date().toISOString();
const add = (id, repo, p) => db.prepare("INSERT INTO code_tasks (id, repo, path, goal, status, step, attempts, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
  .run(id, repo, p, "g", "queued", "read", 0, now, now);
const row = (id) => db.prepare("SELECT status, step, path, attempts, last_error FROM code_tasks WHERE id = ?").get(id);
const err = (id) => String(row(id).last_error || "");

// 1. No registry tables yet: the lookups fail soft and the row proceeds to its file read (a 404 here), judged by nothing new.
add("ct_f_pre", "qnfo-workers", "fxpre/worker.js");
await tick();
ok(row("ct_f_pre").path === "fxpre/worker.js" && !/TARGET-AT-READ/.test(err("ct_f_pre")), "with no registry tables the read step changes nothing and refuses nothing", row("ct_f_pre"));

// 2. The registry: live workers, a FOLDED member with its fold row, a member folded into a denied host, a live worker with a stale fold row, a retired worker.
db.exec(`CREATE TABLE service_registry (service TEXT, kind TEXT, state TEXT);
  CREATE TABLE worker_removals (id INTEGER PRIMARY KEY AUTOINCREMENT, worker TEXT, action TEXT, target TEXT, recorded_at TEXT);`);
for (const s of ["fxhost", "fxhost2", "fxlive", "fxboth", "qnfo-observability"]) db.prepare("INSERT INTO service_registry (service, kind, state) VALUES (?, 'worker', 'live')").run(s);
const fold = (w, host) => db.prepare("INSERT INTO worker_removals (worker, action, target, recorded_at) VALUES (?, 'folded', ?, ?)").run(w, host, "2026-10-06 07:33:35");
fold("fxmember", "fxhost"); fold("fxmember2", "fxhost2"); fold("fxscorer", "qnfo-observability"); fold("fxboth", "fxhost");
add("ct_f_a", "qnfo-workers", "fxmember/worker.js");
add("ct_f_b", "QNFO/qnfo-workers", "fxmember2/worker.js");
add("ct_f_e", "qnfo-workers", "fxmember/deployed-current.worker.js");
add("ct_f_scorer", "qnfo-workers", "fxscorer/worker.js");
add("ct_f_both", "qnfo-workers", "fxboth/worker.js");
add("ct_f_live", "QNFO/qnfo-workers", "fxlive/worker.js");
add("ct_f_retired", "qnfo-workers", "fxretired/worker.js");
add("ct_f_retired_q", "QNFO/qnfo-workers", "fxretired/worker.js");
add("ct_f_other_repo", "other-repo", "fxretired/worker.js");
add("ct_f_script", "qnfo-workers", "docs/NOTES.md");
for (let i = 0; i < 16; i++) await tick(); // bounded for the full queue even when a tick runs one step
console.log("DEBUG", lease, db.prepare("SELECT id, status, step, attempts, lease_until, ctx, last_error FROM code_tasks").all(), db.prepare("SELECT kind, text FROM cloud_ops_events").all());

for (const id of ["ct_f_a", "ct_f_b"]) {
  ok(row(id).path === (id === "ct_f_a" ? "fxhost/worker.js" : "fxhost2/worker.js"), id + " (" + (id === "ct_f_a" ? "qnfo-workers" : "QNFO/qnfo-workers") + ") is redirected to its host", row(id));
  ok(!/FOLDED|RETIRED|MERGE-SCOPE/.test(err(id)), id + " is refused by none of the target rules", row(id));
}
ok(row("ct_f_e").path === "fxhost/worker.js", "the deployed-current mirror path of a FOLDED member becomes the host's worker.js", row("ct_f_e"));
ok(db.prepare("SELECT COUNT(*) AS n FROM cloud_ops_events WHERE kind = 'code-task.intake-redirect' AND text LIKE '%(at read)'").get().n >= 3, "each redirect at read is audited");
const sc = row("ct_f_scorer");
ok(sc.status === "needs_human" && sc.path === "qnfo-observability/worker.js" && /MERGE-SCOPE-AT-READ-1/.test(err("ct_f_scorer")), "a member folded into a denied host is redirected, then ends needs_human by the scope rule", sc);
ok(row("ct_f_both").path === "fxboth/worker.js" && !/TARGET-AT-READ/.test(err("ct_f_both")), "a live worker with a stale fold row keeps its own path", row("ct_f_both"));
ok(row("ct_f_live").path === "fxlive/worker.js" && !/TARGET-AT-READ/.test(err("ct_f_live")), "a live worker is untouched (owner-qualified repo)", row("ct_f_live"));
for (const id of ["ct_f_retired", "ct_f_retired_q"]) {
  const r = row(id);
  ok(r.status === "needs_human" && /RETIRED-TARGET-AT-READ-1/.test(err(id)) && /can never ship/.test(err(id)), id + " ends needs_human naming the rule and the reason", r);
}
ok(!/TARGET-AT-READ/.test(err("ct_f_other_repo")) && row("ct_f_other_repo").path === "fxretired/worker.js", "a row for another repository is not judged by the qnfo-workers registry", row("ct_f_other_repo"));
ok(!/TARGET-AT-READ/.test(err("ct_f_script")), "a path that is not a worker.js is not judged", row("ct_f_script"));
ok(aiCalls === 0, "no model call was spent on any refused or redirected row", aiCalls);
ok(db.prepare("SELECT COUNT(*) AS n FROM cloud_ops_events WHERE kind = 'code-task.retired-refused'").get().n >= 2, "each retired refusal is audited");

// 3. The rules are in the source and in the mirror, in enqueue()'s order.
import { readFileSync } from "node:fs";
const srcText = readFileSync(path.join(here, "worker.js"), "utf8");
const mirror = readFileSync(path.join(here, "deployed-current.worker.js"), "utf8");
const at = srcText.indexOf("FOLDED-TARGET-AT-READ-1 (0.29.1): the target rules");
const iRed = srcText.indexOf("foldedHost(env, slug0, task.path)", at), iScope = srcText.indexOf("mergeScopeWhy(task.repo, task.path)", at), iGone = srcText.indexOf("retiredTarget(env, slug0, task.path)", at);
ok(at > 0 && iRed > at && iScope > iRed && iGone > iScope, "the read step redirects, then judges the scope, then refuses a retired target (enqueue()'s order)", [at, iRed, iScope, iGone]);
ok(srcText === mirror, "deployed-current.worker.js is identical to worker.js");
const v = /var VERSION = "(\d+)\.(\d+)\.(\d+)/.exec(srcText);
ok(v && (+v[1] > 0 || +v[2] > 29 || (+v[2] === 29 && +v[3] >= 1)), "VERSION is at least 0.29.1", v && v[0]);
console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
