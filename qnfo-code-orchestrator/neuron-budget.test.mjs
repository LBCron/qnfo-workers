// CODE-LOOP-NEURON-BUDGET-1 (qnfo-code-orchestrator 0.39.0, pillar cost; BUDGET-SOFT-ROUTE-1: cheaper and slower, never stopped).
// ai_call_counters showed the loop at 194k-688k neurons a day (11-03: 245k, 190k of it from the kimi-k2.7-code and glm-5.3 rungs) while
// ops_config code_loop_daily_calls (10) only selected cheapest-first order and one lane. The loop now keeps ops_config
// code_loop_daily_neurons (default 100000): under it nothing changes; once spent the ladder keeps only the cheap rungs and a scheduled
// tick runs a step in one 2-minute slot out of fifteen. This suite runs spendGate, budgetEnv, cheapLadder, floorSlot and tick from the
// source against an in-memory qnfo-audit.
// Run: node qnfo-code-orchestrator/neuron-budget.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "qnfo-neuron-budget-"));
const originalFetch = globalThis.fetch;
const realNow = Date.now;
const OSS = "@cf/openai/gpt-oss-120b";
const KIMI = "@cf/moonshotai/kimi-k2.7-code";
const GLM = "@cf/zai-org/glm-5.3";
const LLAMA = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const base = "A small fixture for a verified autonomous edit.\n";
const next = "A small fixture for a verified autonomous edit, now repaired.\n";
let passed = 0;
const check = (cond, msg, extra) => { assert.ok(cond, msg + (extra !== undefined ? " -- " + JSON.stringify(extra) : "")); passed++; };

try {
  const workerPath = path.join(tempDir, "worker.mjs");
  const source = fs.readFileSync(path.join(here, "worker.js"), "utf8");
  fs.writeFileSync(workerPath, `${source}\nexport { tick, spendGate, budgetEnv, budgetLadder, cheapLadder, floorSlot, ensureSchema, CODE_FLOOR_EVERY_TICKS, CODE_TICK_MS };\n`);
  const { tick, spendGate, budgetEnv, budgetLadder, cheapLadder, floorSlot, ensureSchema, CODE_FLOOR_EVERY_TICKS, CODE_TICK_MS } = await import(pathToFileURL(workerPath).href);

  function makeEnv(opts = {}) {
    const { calls = 0, neurons = 0, cfg = {} } = opts;
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE cloud_ops_events (id TEXT,ts TEXT,kind TEXT,text TEXT,meta TEXT,job TEXT,status TEXT);
      CREATE TABLE ops_config (key TEXT PRIMARY KEY,value TEXT);
      CREATE TABLE ai_call_counters (day TEXT,worker TEXT,purpose TEXT,model TEXT,calls INTEGER DEFAULT 0,
        errors INTEGER DEFAULT 0,in_chars INTEGER DEFAULT 0,ms INTEGER DEFAULT 0,in_tok INTEGER DEFAULT 0,
        out_tok INTEGER DEFAULT 0,neurons REAL DEFAULT 0,PRIMARY KEY(day,worker,purpose,model));
      CREATE TABLE ai_spend_ledger (day TEXT,provider TEXT,caller TEXT,model TEXT,calls INTEGER DEFAULT 0,
        in_tok INTEGER DEFAULT 0,out_tok INTEGER DEFAULT 0,usd REAL DEFAULT 0,downgraded INTEGER DEFAULT 0,
        refused INTEGER DEFAULT 0,PRIMARY KEY(day,provider,caller,model));
      CREATE TABLE agent_issues (id INTEGER PRIMARY KEY,title TEXT,description TEXT,source TEXT,category TEXT,
        priority TEXT,status TEXT,created_at INTEGER,updated_at INTEGER);
      CREATE TABLE service_registry (service TEXT,state TEXT,kind TEXT);`);
    const put = (k, v) => db.prepare("INSERT OR REPLACE INTO ops_config VALUES (?,?)").run(k, String(v));
    put("code_loop_daily_calls", 10);
    for (const [k, v] of Object.entries(cfg)) put(k, v);
    if (calls || neurons) db.prepare("INSERT INTO ai_call_counters (day,worker,purpose,model,calls,neurons) VALUES (date('now'),'qnfo-code-orchestrator','ladder',?,?,?)").run(KIMI, calls, neurons);
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
      DEPLOY_GUARD: { fetch: async () => Response.json({ acquired: true, token: "fixture-token", expires_at: new Date(realNow() + 3600e3).toISOString() }) },
      AI: { run: async (model) => { inputs.push(model); return { response: "```file\n" + next + "```" }; } },
    };
    return { env, db, inputs };
  }
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
  const atSlot = (slot) => Math.floor(realNow() / (CODE_TICK_MS * CODE_FLOOR_EVERY_TICKS)) * (CODE_TICK_MS * CODE_FLOOR_EVERY_TICKS) + slot * CODE_TICK_MS + 5000;

  // ---- the gate ----
  {
    let { env, db } = makeEnv({ calls: 0, neurons: 0 });
    let g = await spendGate(env);
    check(!g.capped && !g.floor && g.neuron_budget === 100000 && g.headroom === 100000, "a fresh day is uncapped with the 100k default budget", g);
    check(budgetEnv(env, g) === env, "an uncapped day keeps the shared env"); db.close();
    ({ env, db } = makeEnv({ calls: 11, neurons: 5000 }));
    g = await spendGate(env);
    check(g.capped === true && g.floor === false && g.headroom === 95000, "calls past the 10-call threshold: capped (cheapest-first, one lane), floor not yet", g);
    check(budgetEnv(env, g).MODEL_LADDER === [OSS, KIMI, GLM].join(","), "capped under budget keeps the whole cheapest-first ladder (fallback to the dear rungs)"); db.close();
    ({ env, db } = makeEnv({ calls: 11, neurons: 99999 }));
    g = await spendGate(env);
    check(g.capped && !g.floor, "one neuron under the budget is not the floor", g); db.close();
    ({ env, db } = makeEnv({ calls: 11, neurons: 100000 }));
    g = await spendGate(env);
    check(g.capped && g.floor === true && g.headroom === 0, "the budget reached: floor", g);
    const routed = budgetEnv(env, g);
    check(routed.MODEL_LADDER === OSS && routed.PLAN_MODEL === OSS, "the floor keeps only the cheap rung for steps and for the planner", routed.MODEL_LADDER);
    check(env.MODEL_LADDER === [KIMI, GLM, OSS].join(","), "routing never mutates the shared env");
    db.close();
    ({ env, db } = makeEnv({ calls: 1, neurons: 500000 }));
    g = await spendGate(env);
    check(g.floor && g.capped, "neurons alone reach the floor even with the call threshold unmet", g); db.close();
    for (const off of ["off", "0", "OFF"]) {
      ({ env, db } = makeEnv({ calls: 11, neurons: 900000, cfg: { code_loop_daily_neurons: off } }));
      g = await spendGate(env);
      check(g.capped && !g.floor && g.neuron_budget === 0 && g.headroom === null, "code_loop_daily_neurons=" + off + " disables the budget (calls threshold behaves as before)", g); db.close();
    }
    ({ env, db } = makeEnv({ calls: 11, neurons: 250000, cfg: { code_loop_daily_neurons: 300000 } }));
    g = await spendGate(env);
    check(g.capped && !g.floor && g.neuron_budget === 300000, "ops_config sets the budget", g); db.close();
    ({ env, db } = makeEnv({ calls: 0 }));
    env.AUDIT_DB = { prepare() { throw new Error("d1 down"); } };
    g = await spendGate(env);
    check(g.ok && g.used === null && !g.capped, "an unreadable meter never stops the loop", g);
  }

  // ---- the cheap ladder ----
  check(JSON.stringify(cheapLadder({ MODEL_LADDER: [KIMI, GLM, OSS].join(",") })) === JSON.stringify([OSS]), "kimi-k2.7-code (4.5x) and glm-5.3 (5.3x) are not cheap rungs");
  check(JSON.stringify(cheapLadder({ MODEL_LADDER: [LLAMA, OSS].join(",") })) === JSON.stringify([OSS]), "llama-3.3-70b (2.3x the cheapest) is over the 2x factor");
  check(JSON.stringify(cheapLadder({ MODEL_LADDER: "custom/unpriced," + KIMI })) === JSON.stringify([OSS]), "an unpriced model is dropped and a priced coder is put first");
  check(JSON.stringify(budgetLadder({ MODEL_LADDER: "custom/unpriced," + KIMI + "," + OSS })) === JSON.stringify([OSS, KIMI, "custom/unpriced"]), "the call-threshold ladder is unchanged");

  // ---- the floor slot ----
  {
    const slots = Array.from({ length: 720 }, (_, i) => floorSlot(Math.floor(realNow() / 864e5) * 864e5 + i * CODE_TICK_MS + 1000));
    check(slots.filter(Boolean).length === 144, "a day of 2-minute ticks has 144 floor slots (one every 10 minutes)", slots.filter(Boolean).length);
    check(floorSlot(atSlot(0)) && !floorSlot(atSlot(1)) && !floorSlot(atSlot(4)) && floorSlot(atSlot(5)), "the slot is one tick wide, every fifth");
  }

  // ---- the tick ----
  const opts = { maxSteps: 48, lanes: 8, intake: false, claims: false, scheduled: true };
  {
    // FLOOR-FREE-STEPS-1: outside the floor slot a spent day still runs the steps that call no model (read, verify, commit) and holds back only propose and the planner.
    const { env, db, inputs } = makeEnv({ calls: 11, neurons: 100000 });
    await addTask(env, db);
    const stepOf = () => db.prepare("SELECT step FROM code_tasks WHERE id='ct_budget'").get().step;
    Date.now = () => atSlot(3);
    const r = await tick(env, opts);
    check(r.floor === true && r.floor_skip === true && r.executed_steps === 1 && r.plan === null, "a spent day's scheduled tick outside the floor slot runs the model-free read step and starts no plan", { executed: r.executed_steps, skip: r.floor_skip });
    check(inputs.length === 0 && stepOf() === "propose", "the read step ran without a model call and the task now waits at propose", [inputs, stepOf()]);
    check(r.sla && r.sla.errors === 0, "the no-model SLA sweep still runs in a paced tick");
    Date.now = () => atSlot(4);
    const rWait = await tick(env, opts);
    check(rWait.floor_skip === true && rWait.executed_steps === 0 && inputs.length === 0 && stepOf() === "propose", "a task waiting at propose is held back outside the slot", { executed: rWait.executed_steps });
    Date.now = () => atSlot(5);
    const r2 = await tick(env, opts);
    check(r2.floor_skip === false && r2.executed_steps === 1 && r2.lanes === 1 && inputs.length === 1, "in the floor slot the propose step runs", { executed: r2.executed_steps, lanes: r2.lanes, inputs });
    Date.now = () => atSlot(6);
    const r3 = await tick(env, opts);
    check(r3.floor_skip === true && r3.executed_steps === 1 && stepOf() === "commit" && inputs.length === 1, "the model-free verify step runs on the next tick, not half an hour later", { executed: r3.executed_steps, step: stepOf() });
    Date.now = () => atSlot(7);
    await tick(env, opts);
    check(inputs.every((m) => m === OSS) && inputs.length === 1, "every model call on a spent day is the cheap rung", inputs);
    check(db.prepare("SELECT status FROM code_tasks WHERE id='ct_budget'").get().status === "ready_to_publish", "the task reached ready_to_publish within 3 ticks and one floor slot (0.39.1: five half-hours)");
    db.close();
  }
  {
    const { env, db, inputs } = makeEnv({ calls: 11, neurons: 100000 });
    await addTask(env, db);
    Date.now = () => atSlot(3);
    const r = await tick(env, { ...opts, scheduled: false });
    check(r.floor_skip === false && r.executed_steps === 1, "a manual /v1/tick (not scheduled) is an operator's call and is not paced", { skip: r.floor_skip, executed: r.executed_steps });
    check(inputs.every((m) => m === OSS), "but it still uses only the cheap rung", inputs);
    db.close();
  }
  {
    const { env, db } = makeEnv({ calls: 0, neurons: 98000 });
    await ensureSchema(env);
    Date.now = realNow;
    const r = await tick(env, { ...opts, scheduled: false });
    check(r.capped === false && r.lanes === 1, "with 2k of budget left an uncapped tick runs one lane, not eight (a dear step is about 3.5k)", r.lanes);
    db.close();
    const e2 = makeEnv({ calls: 0, neurons: 0 });
    await ensureSchema(e2.env);
    const r2 = await tick(e2.env, { ...opts, scheduled: false });
    check(r2.lanes === 8, "with the whole budget left the lane count is unchanged", r2.lanes);
    e2.db.close();
  }

  // ---- a day of 720 scheduled ticks, worst case: every step climbs to the dearest rung ----
  {
    const DEAR = 3200, CHEAP = 190;
    async function day(cfg) {
      const { env, db } = makeEnv({ calls: 0, neurons: 0, cfg });
      let steps = 0;
      const t0 = Math.floor(realNow() / 864e5) * 864e5;
      for (let i = 0; i < 720; i++) {
        Date.now = () => t0 + i * CODE_TICK_MS + 1000;
        const gate = await spendGate(env);
        const skip = gate.floor === true && !floorSlot(Date.now());
        if (skip) continue;
        const rungs = (gate.floor ? cheapLadder(env) : gate.capped ? budgetLadder(env) : [KIMI]).slice();
        const rung = rungs[rungs.length - 1];
        const cost = rung === OSS ? CHEAP : DEAR;
        db.prepare("INSERT INTO ai_call_counters (day,worker,purpose,model,calls,neurons) VALUES (date('now'),'qnfo-code-orchestrator','ladder',?,1,?) ON CONFLICT(day,worker,purpose,model) DO UPDATE SET calls=calls+1, neurons=neurons+excluded.neurons").run(rung, cost);
        steps++;
      }
      const spent = db.prepare("SELECT SUM(neurons) AS n FROM ai_call_counters").get().n;
      db.close();
      return { spent, steps };
    }
    const legacy = await day({ code_loop_daily_neurons: "off" });
    check(legacy.spent > 1000000, "reproduced: with no neuron budget the call threshold lets a failing queue climb to the dear rung on every tick (2.3M neurons a day)", legacy);
    const bounded = await day({});
    check(bounded.spent <= 100000 + DEAR + 144 * CHEAP, "with the budget the worst-case day is the budget plus one dear step plus the floor's cheap steps", bounded);
    check(bounded.steps >= 144, "the loop still takes at least 144 model steps a day", bounded);
    console.log("worst-case day: no neuron budget " + Math.round(legacy.spent) + " neurons / " + legacy.steps + " steps; budget 100k " + Math.round(bounded.spent) + " neurons / " + bounded.steps + " steps");
  }

  // ---- source wiring ----
  check(/try \{ return await tick\(env, \{ budgetMs: 40000, maxSteps: 48, scheduled: true \}\); \}/.test(source), "the cron tick is marked scheduled");
  check(/\(!opts \|\| opts\.plan !== false\) && !floorSkip/.test(source), "planning waits for the floor slot too");
  console.log("PASS " + passed + " neuron budget checks");
} finally {
  Date.now = realNow;
  globalThis.fetch = originalFetch;
  fs.rmSync(tempDir, { recursive: true, force: true });
}
