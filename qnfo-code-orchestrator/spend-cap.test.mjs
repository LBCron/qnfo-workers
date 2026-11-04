import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "qnfo-soft-budget-"));
const originalFetch = globalThis.fetch;
const OSS = "@cf/openai/gpt-oss-120b";
const KIMI = "@cf/moonshotai/kimi-k2.7-code";
const GLM = "@cf/zai-org/glm-5.3";
const base = "A small fixture for a verified autonomous edit.\n";
const next = "A small fixture for a verified autonomous edit, now repaired.\n";

try {
  const workerPath = path.join(tempDir, "worker.mjs");
  const source = fs.readFileSync(path.join(here, "worker.js"), "utf8");
  fs.writeFileSync(workerPath, `${source}\nexport { tick, spendGate, budgetEnv, budgetLadder, ensureSchema, planIssues };\n`);
  const { tick, spendGate, budgetEnv, budgetLadder, ensureSchema, planIssues } = await import(pathToFileURL(workerPath).href);

  function makeEnv(calls = 141) {
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE cloud_ops_events (id TEXT,ts TEXT,kind TEXT,text TEXT,meta TEXT,job TEXT,status TEXT);
      CREATE TABLE ops_config (key TEXT PRIMARY KEY,value TEXT);
      INSERT INTO ops_config VALUES ('code_loop_daily_calls','140');
      CREATE TABLE ai_call_counters (day TEXT,worker TEXT,purpose TEXT,model TEXT,calls INTEGER DEFAULT 0,
        errors INTEGER DEFAULT 0,in_chars INTEGER DEFAULT 0,ms INTEGER DEFAULT 0,in_tok INTEGER DEFAULT 0,
        out_tok INTEGER DEFAULT 0,neurons REAL DEFAULT 0,PRIMARY KEY(day,worker,purpose,model));
      CREATE TABLE ai_spend_ledger (day TEXT,provider TEXT,caller TEXT,model TEXT,calls INTEGER DEFAULT 0,
        in_tok INTEGER DEFAULT 0,out_tok INTEGER DEFAULT 0,usd REAL DEFAULT 0,downgraded INTEGER DEFAULT 0,
        refused INTEGER DEFAULT 0,PRIMARY KEY(day,provider,caller,model));
      CREATE TABLE agent_issues (id INTEGER PRIMARY KEY,title TEXT,description TEXT,source TEXT,category TEXT,
        priority TEXT,status TEXT,created_at INTEGER,updated_at INTEGER);
      CREATE TABLE service_registry (service TEXT,state TEXT,kind TEXT);`);
    db.prepare("INSERT INTO ai_call_counters (day,worker,purpose,model,calls) VALUES (date('now'),'qnfo-code-orchestrator','ladder',?,?)").run(KIMI, calls);
    const inputs = [];
    const env = {
      MODEL_LADDER: [KIMI, GLM, OSS].join(","),
      PLAN_MODEL: KIMI,
      PR_PUBLISH_MODE: "pull",
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
      AI: { run: async (model) => { inputs.push(model); return { response: "```file\n" + next + "```" }; } },
    };
    return { env, db, inputs };
  }
  const opts = { maxSteps: 48, lanes: 8, intake: false, plan: false, claims: false };
  globalThis.fetch = async (url) => {
    if (String(url).startsWith("https://raw.githubusercontent.com/QNFO/qnfo-workers/main/")) return new Response(base);
    throw new Error("unexpected fixture fetch: " + url);
  };
  async function addTask(env, db, id = "ct_budget") {
    await ensureSchema(env);
    db.prepare(`INSERT INTO code_tasks (id,repo,path,goal,status,step,ctx,created_at,updated_at)
      VALUES (?,'qnfo-workers','docs/budget-fixture.md','Repair the fixture without changing any verification gate','queued','read','{}',?,?)`)
      .run(id, new Date().toISOString(), new Date().toISOString());
  }

  for (const [calls, capped] of [[139, false], [140, true], [141, true]]) {
    const { env, db } = makeEnv(calls);
    const gate = await spendGate(env);
    assert.equal(gate.ok, true, "the call threshold never stops work");
    assert.equal(gate.capped === true, capped, "the unchanged 140-call boundary selects routing");
    assert.equal(gate.cap, 140);
    const routed = budgetEnv(env, gate);
    assert.equal(routed === env, !capped, "only capped calls receive a scoped environment");
    assert.equal(env.MODEL_LADDER, [KIMI, GLM, OSS].join(","), "routing never mutates shared bindings");
    assert.equal(env.PLAN_MODEL, KIMI);
    if (capped) {
      assert.equal(routed.MODEL_LADDER, [OSS, KIMI, GLM].join(","));
      assert.equal(routed.PLAN_MODEL, OSS, "the planner also uses the cheaper rung");
    }
    assert.equal(db.prepare("SELECT value FROM ops_config WHERE key='code_loop_daily_calls'").get().value, "140");
    db.close();
  }
  assert.deepEqual(budgetLadder({ MODEL_LADDER: "custom/unpriced," + KIMI + "," + OSS }), [OSS, KIMI, "custom/unpriced"]);
  assert.deepEqual(budgetLadder({ MODEL_LADDER: "custom/unpriced" }), [OSS, "custom/unpriced"]);

  {
    const { env, db, inputs } = makeEnv();
    await addTask(env, db);
    db.prepare("UPDATE code_tasks SET created_at='2026-10-25T03:00:00Z' WHERE id='ct_budget'").run();
    for (let i = 0; i < 3; i++) {
      await addTask(env, db, "ct_held_" + i);
      db.prepare("UPDATE code_tasks SET path=?,created_at=? WHERE id=?")
        .run("held-" + i + "/worker.js", "2026-10-25T00:00:0" + i + "Z", "ct_held_" + i);
    }
    env.DEPLOY_GUARD.fetch = async (_url, init) => {
      const body = JSON.parse(init.body);
      return Response.json(body.key.includes("held-")
        ? { acquired: false, holder: "another-live-session" }
        : { acquired: true, token: "fixture-token", expires_at: new Date(Date.now() + 3600e3).toISOString() },
      { status: body.key.includes("held-") ? 409 : 200 });
    };
    const result = await tick(env, opts);
    assert.equal(result.done.filter((item) => item.deferred).length, 3, "live claims are deferred, never bypassed");
    assert.equal(result.done.filter((item) => !item.deferred).length, 1, "deferrals do not spend the one executable step");
    assert.equal(result.executed_steps, 1);
    assert.equal(db.prepare("SELECT step FROM code_tasks WHERE id='ct_budget'").get().step, "propose",
      "an unrelated runnable task progresses behind claimed paths");
    assert.deepEqual(inputs, [], "scanning claims and reading cannot spend a model call");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM code_tasks WHERE id LIKE 'ct_held_%' AND step='read' AND attempts=0").get().n, 3,
      "scanning does not execute or fail any held task");
    db.close();
  }

  {
    const { env, db } = makeEnv();
    for (let i = 0; i < 65; i++) {
      await addTask(env, db, "ct_scan_" + i);
      db.prepare("UPDATE code_tasks SET path=? WHERE id=?").run("docs/scan-" + i + ".md", "ct_scan_" + i);
    }
    let scans = 0;
    env.DEPLOY_GUARD.fetch = async () => { scans++; return Response.json({ acquired: false, holder: "another-live-session" }, { status: 409 }); };
    const result = await tick(env, opts);
    assert.equal(scans, 64, "all-held queues have a bounded claim scan");
    assert.equal(result.done.length, 64);
    assert.equal(result.executed_steps, 0);
    assert.ok(result.done.every((item) => item.deferred));
    db.close();
  }

  {
    const { env, db, inputs } = makeEnv();
    await addTask(env, db);
    for (const step of ["propose", "verify", "commit", "done"]) {
      const result = await tick(env, opts);
      assert.equal(result.capped, true);
      assert.equal(result.steps, 1, "capped ticks still execute a step");
      assert.equal(result.lanes, 1, "caller options cannot restore full-width work at the threshold");
      assert.equal(result.sla.errors, 0, "SLA checks continue at the threshold");
      assert.equal(db.prepare("SELECT step FROM code_tasks WHERE id='ct_budget'").get().step, step);
    }
    assert.deepEqual(inputs, [OSS], "the cheapest configured coder produces the proposal");
    assert.equal(db.prepare("SELECT downgraded FROM ai_spend_ledger WHERE model=?").get(OSS).downgraded, 1,
      "the ledger identifies the actual cheap-route call");
    const task = db.prepare("SELECT * FROM code_tasks WHERE id='ct_budget'").get();
    assert.equal(task.status, "ready_to_publish", "read, propose, verify, and commit all continue at the threshold");
    assert.ok(JSON.parse(task.ctx).patch.includes("now repaired"), "publication still carries a real verified patch");
    db.close();
  }

  {
    const { env, db, inputs } = makeEnv();
    env.AI.run = async (model) => {
      inputs.push(model);
      return { response: model === OSS ? "" : "```file\n" + next + "```" };
    };
    await addTask(env, db);
    await tick(env, opts);
    await tick(env, opts);
    assert.equal(db.prepare("SELECT attempts FROM code_tasks WHERE id='ct_budget'").get().attempts, 1);
    await tick(env, opts);
    assert.deepEqual(inputs, [OSS, GLM], "COST-CUT-CODE-1: glm climbs before kimi; an empty cheap reply uses the existing bounded retry ladder as fallback");
    assert.equal(db.prepare("SELECT downgraded FROM ai_spend_ledger WHERE model=?").get(GLM).downgraded, 0,
      "the ledger does not mislabel a more expensive fallback as the cheap primary");
    assert.equal(db.prepare("SELECT step FROM code_tasks WHERE id='ct_budget'").get().step, "verify");
    db.close();
  }

  {
    const { env, db } = makeEnv(139);
    await ensureSchema(env);
    const result = await tick(env, opts);
    assert.equal(result.capped, false);
    assert.equal(result.lanes, 8, "below-threshold parallelism is unchanged");
    db.close();
  }

  {
    const { env, db, inputs } = makeEnv();
    db.prepare("INSERT INTO service_registry VALUES ('fx-budget','live','worker')").run();
    db.prepare("INSERT INTO agent_issues VALUES (1,'Repair fx-budget logic','Change fx-budget to repair its fixture.','claude-session-budget','automation','medium','open',?,?)").run(Date.now() - 7200e3, Date.now());
    globalThis.fetch = async () => new Response("function fixture() { return 1; }\n");
    env.AI.run = async (model) => { inputs.push(model); return { response: '{"code_fixable":false,"reason":"fixture needs no change"}' }; };
    const result = await planIssues(env);
    assert.equal(result.outcome, "not-code", "standalone planning still runs at the threshold");
    assert.deepEqual(inputs, [OSS], "standalone /v1/plan uses the cheap route too");
    db.close();
  }

  console.log("PASS soft call threshold, scoped cheap routing, reduced batch, verified publication, and fallback");
} finally {
  globalThis.fetch = originalFetch;
  fs.rmSync(tempDir, { recursive: true, force: true });
}
