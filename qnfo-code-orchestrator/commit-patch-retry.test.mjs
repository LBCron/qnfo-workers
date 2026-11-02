// CODE-PATCH-RETRY-1 regression suite (#1834): oversized diffs stay below the publish limit and retry with feedback.
// Run: node --no-warnings qnfo-code-orchestrator/commit-patch-retry.test.mjs
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const worker = (await import(pathToFileURL(path.join(here, "worker.js")).href)).default;
let pass = 0, fail = 0;
const ok = (condition, message, value) => {
  if (condition) pass++;
  else { fail++; console.log("FAIL " + message + (value !== undefined ? " -- " + JSON.stringify(value).slice(0, 500) : "")); }
};

function makeD1() {
  const db = new DatabaseSync(":memory:");
  const wrap = (sql) => {
    let args = [];
    const statement = {
      bind: (...values) => { args = values.map((value) => value === undefined ? null : value); return statement; },
      run: async () => { const result = db.prepare(sql).run(...args); return { meta: { changes: Number(result.changes) } }; },
      first: async () => db.prepare(sql).get(...args) || null,
      all: async () => ({ results: db.prepare(sql).all(...args) }),
    };
    return statement;
  };
  db.exec(`CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT DEFAULT 'optimization', priority TEXT DEFAULT 'medium', status TEXT DEFAULT 'open', linked_session TEXT, created_at INTEGER, updated_at INTEGER);
    CREATE TABLE cloud_ops_events (id TEXT, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT);
    CREATE TABLE ai_spend_ledger (day TEXT NOT NULL, provider TEXT NOT NULL, caller TEXT NOT NULL, model TEXT NOT NULL, calls INTEGER DEFAULT 0, in_tok INTEGER DEFAULT 0, out_tok INTEGER DEFAULT 0, usd REAL DEFAULT 0, downgraded INTEGER DEFAULT 0, refused INTEGER DEFAULT 0, PRIMARY KEY (day, provider, caller, model));
    CREATE TABLE ai_call_counters (day TEXT, worker TEXT, purpose TEXT, model TEXT, calls INTEGER DEFAULT 0, errors INTEGER DEFAULT 0, in_chars INTEGER DEFAULT 0, ms INTEGER DEFAULT 0, in_tok INTEGER DEFAULT 0, out_tok INTEGER DEFAULT 0, neurons REAL DEFAULT 0, PRIMARY KEY (day, worker, purpose, model));`);
  return { prepare: wrap, _db: db };
}

const baseLines = Array.from({ length: 60 }, (_, i) => `paragraph-${i}: ${"x".repeat(680)}`);
const base = baseLines.join("\n");
const oversized = Array.from({ length: 60 }, (_, i) => `replacement-${i}: ${"y".repeat(1360)}`).join("\n");
const smallReplacement = baseLines[0].replace("x".repeat(12), "z".repeat(12));
const files = { "docs/fixture.md": base };
globalThis.fetch = async (url) => {
  const match = /^https:\/\/raw\.githubusercontent\.com\/QNFO\/qnfo-workers\/main\/(.+)$/.exec(String(url));
  const file = match ? decodeURIComponent(match[1]) : null;
  return file && files[file] != null ? new Response(files[file], { status: 200 }) : new Response("nf", { status: 404 });
};

const block = (search, replace) => `<<<<<<< SEARCH\n${search}\n=======\n${replace}\n>>>>>>> REPLACE`;
const { env, calls } = (() => {
  const replies = [block(base, oversized), block(baseLines[0], smallReplacement)];
  const calls = [];
  return {
    calls,
    env: {
      ORCH_TOKEN: "test-token",
      AUDIT_DB: makeD1(),
      PR_PUBLISH_MODE: "pull",
      MODEL_LADDER: "@cf/openai/gpt-oss-120b,@cf/zai-org/glm-5.3,@cf/moonshotai/kimi-k2.7-code",
      AI: { run: async (model, input) => { calls.push({ model, prompt: input.messages[1].content }); return { response: replies.shift() }; } },
    },
  };
})();
const headers = { authorization: "******", "content-type": "application/json" };
const call = async (method, endpoint, body) => (await worker.fetch(new Request("https://x" + endpoint, {
  method, headers, body: body === undefined ? undefined : JSON.stringify(body),
}), env)).json();
const tick = () => call("POST", "/v1/tick", { maxSteps: 1, budgetMs: 25000, plan: false, intake: false });
const taskRow = (id) => env.AUDIT_DB._db.prepare("SELECT * FROM code_tasks WHERE id = ?").get(id);
const context = (row) => JSON.parse(row.ctx || "{}");
const task = await call("POST", "/v1/tasks", { repo: "qnfo-workers", path: "docs/fixture.md", goal: "make one small edit" });

ok(task.ok && task.id, "task enqueued", task);
await tick();
await tick();
await tick();
ok(taskRow(task.id).step === "commit", "the oversized proposal passed the deterministic verifier before publication", taskRow(task.id));
await tick();
let row = taskRow(task.id);
ok(row.status === "queued" && row.step === "propose" && row.attempts === 1, "an over-limit diff retries as a proposal instead of terminating", {
  status: row.status, step: row.step, attempts: row.attempts, last_error: row.last_error,
});
ok(/patch too large: exceeds verification limit/.test(row.last_error) && !context(row).patch, "the retry gets the failure reason without persisting the oversized patch", context(row));
await tick();
ok(calls.length === 2 && calls[1].model === "@cf/zai-org/glm-5.3" && /patch too large: exceeds verification limit/.test(calls[1].prompt),
  "the next ladder rung receives the size failure as feedback", calls.map((item) => item.model));
await tick();
await tick();
await tick();
row = taskRow(task.id);
const finalPatch = String(context(row).patch || "");
ok(row.status === "ready_to_publish" && row.attempts === 1, "the smaller retried edit reaches publication", {
  status: row.status, attempts: row.attempts, error: row.last_error,
});
ok(finalPatch.length <= 80000 && finalPatch.includes("+" + smallReplacement), "the stored patch still satisfies the original limit and contains the second edit", finalPatch.length);
console.log("commit-patch-retry: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
