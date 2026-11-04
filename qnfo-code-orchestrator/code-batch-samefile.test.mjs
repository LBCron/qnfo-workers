// CODE-BATCH-SAMEFILE-1 (0.44.0): a lead task absorbs up to 2 never-attempted queued tasks on the same file into one propose prompt;
// a merged lead supersedes them with its PR, a failed lead releases them untouched.
// Run: node qnfo-code-orchestrator/code-batch-samefile.test.mjs
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert";
const src = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert(i > 0 && j > i, a); return src.slice(i, j); };
const code = [cut("const CODE_TASK_DONE = [", "// PLAN-WIP"), cut("function taskPathKeySql(", "function taskFamilySql("), cut("function taskPaths(", "// NO-PROGRESS-CEILING-1"), cut("const BATCH_MAX_FOLLOWERS", "async function pathBusy(")].join("\n");
const audits = [];
const H = new Function("audit", code + "; return { batchAbsorb, batchSweep, batchGoalsText, BATCH_MARK };")(async (...a) => audits.push(a));
const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE code_tasks (id TEXT PRIMARY KEY, repo TEXT, path TEXT, goal TEXT, status TEXT, step TEXT, attempts INT DEFAULT 0, last_error TEXT, lease_until TEXT, pr_url TEXT, created_at TEXT)");
const ins = (id, path, o = {}) => db.prepare("INSERT INTO code_tasks (id,repo,path,goal,status,step,attempts,last_error,lease_until,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run(id, "qnfo-workers", path, "goal " + id, o.status || "queued", o.step || "read", o.attempts || 0, o.err || null, o.lease || null, "2026-11-04T10:00:" + id.slice(-2));
const env = { AUDIT_DB: { prepare: (sql) => { let a = []; const st = { bind: (...x) => { a = x.map((v) => (v === undefined ? null : v)); return st; }, run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...a).changes) } }), all: async () => ({ results: db.prepare(sql).all(...a) }), first: async () => db.prepare(sql).get(...a) || null }; return st; } } };
const P = "qnfo-fleet-dashboard/worker.js";
ins("t01", P); ins("t02", P); ins("t03", P); ins("t04", P); ins("t05", "qnfo-research-exec/worker.js"); ins("t06", "qnfo-fleet-dashboard/deployed-current.worker.js"); ins("t07", P, { attempts: 1 });
const lead = { id: "t01", repo: "qnfo-workers", path: P };
const b = await H.batchAbsorb(env, lead);
assert.deepEqual(b.map((x) => x.id), ["t02", "t03"], "cap 2, same file only, never-attempted only");
assert.equal(db.prepare("SELECT last_error FROM code_tasks WHERE id='t02'").get().last_error, "BATCHED-INTO:t01");
assert.equal(db.prepare("SELECT last_error FROM code_tasks WHERE id='t05'").get().last_error, null);
assert.deepEqual((await H.batchAbsorb(env, lead)).map((x) => x.id), ["t04", "t06"], "the mirror path counts as the same file");
assert(H.batchGoalsText({ batch_goals: b }).includes("goal t02") && H.batchGoalsText({}) === "");
// lead still open: nothing settles
let r = await H.batchSweep(env); assert.deepEqual(r, { superseded: 0, released: 0 });
// lead merged -> followers superseded with the PR
db.prepare("UPDATE code_tasks SET status='merged', pr_url='https://github.com/QNFO/qnfo-workers/pull/9' WHERE id='t01'").run();
r = await H.batchSweep(env); assert.equal(r.superseded, 4);
assert.match(db.prepare("SELECT last_error FROM code_tasks WHERE id='t02'").get().last_error, /merged, .*pull\/9/);
assert.equal(db.prepare("SELECT status FROM code_tasks WHERE id='t02'").get().status, "superseded");
// failed lead -> follower released, still queued
ins("t11", P); ins("t12", P, { err: "BATCHED-INTO:t11" }); ins("t13", P, { err: "BATCHED-INTO:gone" });
db.prepare("UPDATE code_tasks SET status='failed' WHERE id='t11'").run();
r = await H.batchSweep(env); assert.equal(r.released, 2);
assert.deepEqual(db.prepare("SELECT status,last_error FROM code_tasks WHERE id='t12'").get(), { status: "queued", last_error: null });
console.log("ok");
