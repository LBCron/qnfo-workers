import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const records = fs.readFileSync(path.join(here, "fixtures/planner-replay.jsonl"), "utf8")
  .trim().split(/\r?\n/).map((line) => JSON.parse(line));
const [task, loggedRequest, loggedResponse] = records;
assert.deepEqual(records.map((record) => record.type), ["task", "request", "response"]);

const worker = (await import(pathToFileURL(path.join(here, "worker.js")).href)).default;
const db = new DatabaseSync(":memory:");
db.exec(`CREATE TABLE agent_issues (
  id INTEGER PRIMARY KEY, title TEXT, description TEXT, source TEXT, category TEXT,
  priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER
);
CREATE TABLE service_registry (service TEXT PRIMARY KEY, state TEXT, kind TEXT, base_url TEXT);
CREATE TABLE cloud_ops_events (id TEXT, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT);
CREATE TABLE ai_call_counters (
  day TEXT, worker TEXT, purpose TEXT, model TEXT, calls INTEGER DEFAULT 0, errors INTEGER DEFAULT 0,
  in_chars INTEGER DEFAULT 0, ms INTEGER DEFAULT 0, in_tok INTEGER DEFAULT 0, out_tok INTEGER DEFAULT 0,
  neurons REAL DEFAULT 0, UNIQUE(day, worker, purpose, model)
);
CREATE TABLE ai_spend_ledger (
  day TEXT, provider TEXT, caller TEXT, model TEXT, calls INTEGER DEFAULT 0, in_tok INTEGER DEFAULT 0,
  out_tok INTEGER DEFAULT 0, usd REAL DEFAULT 0, downgraded INTEGER DEFAULT 0, refused INTEGER DEFAULT 0,
  UNIQUE(day, provider, caller, model)
);`);
for (const name of ["q08-signal-engine", "qnfo-social", "qnfo-observability", "qnfo-autonomy-scorer", "qnfo-ai", "qnfo-ai-search"]) {
  db.prepare("INSERT INTO service_registry VALUES (?, 'live', 'worker', '')").run(name);
}
const prepare = (sql) => {
  let args = [];
  const stmt = {
    bind(...values) { args = values.map((value) => value === undefined ? null : value); return stmt; },
    async run() { const result = db.prepare(sql).run(...args); return { meta: { changes: Number(result.changes) } }; },
    async first() { return db.prepare(sql).get(...args) || null; },
    async all() { return { results: db.prepare(sql).all(...args) }; },
  };
  return stmt;
};
const issue = task.issue;
db.prepare(`INSERT INTO agent_issues
  (id, title, description, source, category, priority, status, created_at)
  VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`)
  .run(issue.id, issue.title, issue.description, issue.source, issue.category, issue.priority, Date.now() - 3600e3);

const source = [
  'var VERSION = "0.7.37-cadence-cap";',
  "function feedbackScan(env) {",
  '  var rows = await env.DB.prepare("SELECT slug, s FROM q08_feedback").all();',
  "  return rows;",
  "}",
  "async function handle(req, env) {",
  '  if (path === "/api/f") {',
  "    return recordVote(req, env);",
  "  }",
  "}",
].join("\n");
const previousFetch = globalThis.fetch;
const fetches = [];
globalThis.fetch = async (url) => {
  fetches.push(String(url));
  assert.match(String(url), /^https:\/\/raw\.githubusercontent\.com\/QNFO\/qnfo-workers\/main\/q08-signal-engine\/worker\.js$/);
  return new Response(source, { status: 200 });
};

try {
  const requests = [];
  const env = {
    ORCH_TOKEN: "offline-only-placeholder",
    AUDIT_DB: { prepare },
    AI: {
      run: async (model, input) => {
        requests.push({ model, input });
        return { response: loggedResponse.content };
      },
    },
  };
  const response = await worker.fetch(new Request("https://x/v1/plan", {
    method: "POST",
    headers: { authorization: "offline-only-placeholder" },
  }), env);
  const result = await response.json();

  assert.equal(result.outcome, "queued", "the recorded task completes through the real planner");
  assert.equal(result.path, "q08-signal-engine/worker.js");
  assert.equal(fetches.length, 1, "the only fetch is the mocked public source read");
  assert.deepEqual(requests, [loggedRequest.projection], "the model request exactly matches its recorded projection");
  assert.deepEqual(Object.keys(loggedRequest.projection).sort(), ["input", "model"]);
  assert.deepEqual(Object.keys(loggedRequest.projection.input).sort(), ["max_tokens", "messages"]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM code_tasks WHERE status='queued'").get().n, 1);
  console.log("PASS keyless planner transcript replay and request/log projection equality");
} finally {
  globalThis.fetch = previousFetch;
  db.close();
}
