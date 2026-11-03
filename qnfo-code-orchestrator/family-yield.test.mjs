import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "qnfo-family-yield-"));
const originalFetch = globalThis.fetch;
const KIMI = "@cf/moonshotai/kimi-k2.7-code";
const GLM = "@cf/zai-org/glm-5.3";
const OSS = "@cf/openai/gpt-oss-120b";

try {
  const workerPath = path.join(tempDir, "worker.mjs");
  const source = fs.readFileSync(path.join(here, "worker.js"), "utf8");
  fs.writeFileSync(workerPath, `${source}\nexport { tick, ensureSchema, familyPolicy, familyLadder };\n`);
  const { tick, ensureSchema, familyPolicy, familyLadder } = await import(pathToFileURL(workerPath).href);
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE cloud_ops_events (id TEXT, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT);
    CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE ai_call_counters (day TEXT, worker TEXT, purpose TEXT, model TEXT, calls INTEGER DEFAULT 0,
      errors INTEGER DEFAULT 0, in_chars INTEGER DEFAULT 0, ms INTEGER DEFAULT 0, in_tok INTEGER DEFAULT 0,
      out_tok INTEGER DEFAULT 0, neurons REAL DEFAULT 0, PRIMARY KEY(day,worker,purpose,model));
    CREATE TABLE ai_spend_ledger (day TEXT, provider TEXT, caller TEXT, model TEXT, calls INTEGER DEFAULT 0,
      in_tok INTEGER DEFAULT 0, out_tok INTEGER DEFAULT 0, usd REAL DEFAULT 0, downgraded INTEGER DEFAULT 0,
      refused INTEGER DEFAULT 0, PRIMARY KEY(day,provider,caller,model));
    CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, description TEXT, source TEXT, category TEXT,
      priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);`);
  const env = {
    MODEL_LADDER: [KIMI, GLM, OSS].join(","),
    AUDIT_DB: {
      prepare(sql) {
        let args = [];
        const stmt = {
          bind(...values) { args = values.map((value) => value === undefined ? null : value); return stmt; },
          async run() { return { meta: { changes: Number(db.prepare(sql).run(...args).changes) } }; },
          async first() { return db.prepare(sql).get(...args) || null; },
          async all() { return { results: db.prepare(sql).all(...args) }; },
        };
        return stmt;
      },
    },
    DEPLOY_GUARD: {
      fetch: async () => Response.json({ acquired: true, token: "fixture-token", expires_at: new Date(Date.now() + 3600e3).toISOString() }),
    },
    AI: { run: async () => ({ response: "" }) },
  };
  await ensureSchema(env);
  const insert = db.prepare(`INSERT INTO code_tasks (id,repo,path,goal,status,step,attempts,model,created_at,updated_at)
    VALUES (?,'qnfo-workers',?,'fixture task',?,'read',0,?,?,?)`);
  const recent = new Date(Date.now() - 864e5).toISOString();
  for (let i = 0; i < 4; i++) insert.run("good-merged-" + i, "docs/previous-" + i + ".md", "merged", i < 2 ? GLM : OSS, recent, recent);
  for (let i = 0; i < 5; i++) insert.run("poor-failed-" + i, "scripts/previous-" + i + ".mjs", "failed", KIMI, recent, recent);

  const goodPolicy = await familyPolicy(env, "docs/worker.js");
  assert.equal(goodPolicy.outcomes, 4);
  assert.equal(goodPolicy.merged, 4);
  assert.equal(goodPolicy.retryRounds, 3);
  assert.equal(goodPolicy.preferredModel, OSS, "choose the cheapest configured model with a merged result in the family");
  assert.deepEqual(familyLadder(env, goodPolicy), [OSS, KIMI, GLM]);

  const poorPolicy = await familyPolicy(env, "scripts/worker.js");
  assert.equal(poorPolicy.successRate, 0);
  assert.equal(poorPolicy.retryRounds, 1, "stop repeated rounds after enough recent family failures");
  assert.equal(poorPolicy.preferredModel, null, "never assume a model passes without a merged result");

  for (let i = 0; i < 10; i++) insert.run("good-queued-" + i, "docs/family-yield-" + i + ".md", "queued", null, recent, recent);
  for (let i = 0; i < 8; i++) insert.run("poor-queued-" + i, "scripts/family-yield-" + i + ".mjs", "queued", null, recent, recent);
  globalThis.fetch = async (url) => {
    if (String(url).startsWith("https://raw.githubusercontent.com/QNFO/")) return new Response("# fixture\n");
    throw new Error("unexpected fixture fetch: " + url);
  };
  const result = await tick(env, { intake: false, plan: false, claims: false, sla: false, budgetMs: 50000 });
  assert.equal(result.lanes, 16, "uncapped default uses the existing 16-lane ceiling");
  assert.equal(result.executed_steps, 16, "more than eight independent steps can run in one tick");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM code_tasks WHERE id LIKE 'good-queued-%' AND step='propose'").get().n, 10,
    "recently merged families receive the first parallel slots");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM code_tasks WHERE id LIKE 'poor-queued-%' AND step='propose'").get().n, 6,
    "lower-yield families continue after winning-family work is claimed");
  db.close();
  console.log("PASS family-specific retry limits, proven cheapest-model selection, merge-prioritized queue, and 16-lane tick");
} finally {
  globalThis.fetch = originalFetch;
  fs.rmSync(tempDir, { recursive: true, force: true });
}
