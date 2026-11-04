// REASONING-LOW-1 offline suite (qnfo-code-orchestrator 0.23.0, agent_issues 2857 / 99925, pillar autonomy).
// Measured 2026-10-19 on qnfo-audit.ai_call_counters: glm-5.3, the second rung of the ladder, made 24 calls averaging 15.1k output tokens
// against its 16,384 budget (363,084 tokens, 4,635 s, 193 s a call against the 240 s ceiling), and 28 of its replies in 24 h were empty
// ("no SEARCH/REPLACE block found in the reply: the reply was empty": thought used the whole budget) for 2 merged tasks in 2 days. Its model
// page documents reasoning_effort (max, high, low). This suite proves the option is sent to glm-5.3 and to no other rung, that
// ops_config code_reasoning_low = off removes it, that a call the platform rejects because of it is made once more without it and audited,
// and that an unrelated error (a 3046 timeout) is not retried here (the timeout machinery owns it).
// Run: node --no-warnings qnfo-code-orchestrator/reasoning-low.test.mjs   (exit 0 = all passed)
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

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
    CREATE TABLE cloud_ops_events (id TEXT, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT);
    CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE ai_spend_ledger (day TEXT NOT NULL, provider TEXT NOT NULL, caller TEXT NOT NULL, model TEXT NOT NULL, calls INTEGER DEFAULT 0, in_tok INTEGER DEFAULT 0, out_tok INTEGER DEFAULT 0, usd REAL DEFAULT 0, downgraded INTEGER DEFAULT 0, refused INTEGER DEFAULT 0, PRIMARY KEY (day, provider, caller, model));
    CREATE TABLE ai_call_counters (day TEXT, worker TEXT, purpose TEXT, model TEXT, calls INTEGER DEFAULT 0, errors INTEGER DEFAULT 0, in_chars INTEGER DEFAULT 0, ms INTEGER DEFAULT 0, in_tok INTEGER DEFAULT 0, out_tok INTEGER DEFAULT 0, neurons REAL DEFAULT 0, PRIMARY KEY (day, worker, purpose, model));`);
  return { prepare: wrap, _db: db };
}
const pad = (tag, n) => { let s = ""; let i = 0; while (s.length < n) s += "// " + tag + " filler line " + (i++) + "\n"; return s; };
const TARGET = "function farAway(x) { return x + 1; }";
const SRC = pad("a", 3000) + TARGET + "\n" + pad("b", 3000) + 'export default { fetch() { return new Response("a"); } };\n';
const FILES = { "fx-low/worker.js": SRC, "fx-low/deployed-current.worker.js": SRC };
globalThis.fetch = async (u) => {
  const m = /^https:\/\/raw\.githubusercontent\.com\/QNFO\/[A-Za-z0-9._-]+\/main\/(.+)$/.exec(String(u));
  const p = m ? decodeURIComponent(m[1]) : null;
  return p && FILES[p] != null ? new Response(FILES[p], { status: 200 }) : new Response("nf", { status: 404 });
};
const fakeLoader = { load: () => ({ getEntrypoint: () => ({ fetch: async () => new Response("ok") }) }) };
const GLM = "@cf/zai-org/glm-5.3", KIMI = "@cf/moonshotai/kimi-k2.7-code", OSS = "@cf/openai/gpt-oss-120b";
const EDIT = "<<<<<<< SEARCH\n" + TARGET + "\n=======\nfunction farAway(x) { return x + 2; }\n>>>>>>> REPLACE";
function envWith(ladder, script) {
  const inputs = [];
  const env = { ORCH_TOKEN: "t0ken", AUDIT_DB: makeD1(), PR_PUBLISH_MODE: "pull", JS_VERIFY: "dynamic", LOADER: fakeLoader, MODEL_LADDER: ladder,
    AI: { run: async (model, input) => { inputs.push({ model, input }); const r = script.shift(); if (typeof r === "function") return { response: r(input) }; if (r instanceof Error) throw r; return { response: r == null ? "" : r }; } } };
  return { env, inputs };
}
const hdr = { authorization: "Bearer t0ken", "content-type": "application/json" };
const tick = async (env) => (await worker.fetch(new Request("https://x/v1/tick", { method: "POST", headers: hdr, body: JSON.stringify({ maxSteps: 1, budgetMs: 25000, plan: false, intake: false }) }), env)).json();
const addTask = async (env) => (await worker.fetch(new Request("https://x/v1/tasks", { method: "POST", headers: hdr, body: JSON.stringify({ repo: "qnfo-workers", path: "fx-low/worker.js", goal: "make farAway add two instead of one", anchor: TARGET }) }), env)).json();
const row = (env, id) => env.AUDIT_DB._db.prepare("SELECT * FROM code_tasks WHERE id=?").get(id);
const events = (env, kind) => env.AUDIT_DB._db.prepare("SELECT * FROM cloud_ops_events WHERE kind = ?").all(kind);
async function run(ladder, script, before) {
  const { env, inputs } = envWith(ladder, script);
  if (before) before(env);
  const c = await addTask(env);
  await tick(env); // read
  await tick(env); // propose
  return { env, inputs, id: c.id };
}

const h = await (await worker.fetch(new Request("https://x/health"), {})).json();
ok(/^0\.(2[3-9]|[3-9]\d)\.|^[1-9]\d*\./.test(String(h.version)), "health: 0.23.0 or later", h.version);
ok(Array.isArray(h.capabilities) && h.capabilities.includes("reasoning-low"), "health lists reasoning-low", h.capabilities);

// 1. glm-5.3 gets reasoning_effort low and keeps its 16,384-token budget; the task still proceeds on its reply
{
  const { env, inputs, id } = await run(GLM, [EDIT]);
  ok(inputs.length === 1 && inputs[0].model === GLM && inputs[0].input.reasoning_effort === "low" && inputs[0].input.max_tokens === 16384, "1a glm-5.3 is called with reasoning_effort low and max_tokens 16384", inputs.map((x) => x.input && { re: x.input.reasoning_effort, mt: x.input.max_tokens }));
  ok(Array.isArray(inputs[0].input.messages) && inputs[0].input.messages.length === 2, "1b the messages are unchanged", inputs[0].input && inputs[0].input.messages && inputs[0].input.messages.length);
  ok(row(env, id).step === "verify" || row(env, id).status === "ready_to_publish", "1c the reply is used", { step: row(env, id).step, status: row(env, id).status });
}
// 2. gpt-oss is not touched; KIMI-NOTHINK-1: kimi is asked with thinking off from the first call
{
  const { inputs } = await run(KIMI, [EDIT]);
  ok(inputs.length === 1 && inputs[0].input.chat_template_kwargs && inputs[0].input.chat_template_kwargs.thinking === false, "2k kimi is called with thinking off", inputs[0] && Object.keys(inputs[0].input));
}
{
  for (const m of [OSS]) {
    const { inputs } = await run(m, [EDIT]);
    ok(inputs.length === 1 && inputs[0].model === m && !("reasoning_effort" in inputs[0].input) && !("chat_template_kwargs" in inputs[0].input), "2 " + m + " is called exactly as before", inputs[0] && Object.keys(inputs[0].input));
  }
}
// 3. ops_config code_reasoning_low = off removes the option without a deploy; any other value leaves it on
{
  const off = await run(GLM, [EDIT], (env) => env.AUDIT_DB._db.prepare("INSERT INTO ops_config VALUES ('code_reasoning_low', 'off')").run());
  ok(off.inputs.length === 1 && !("reasoning_effort" in off.inputs[0].input), "3a code_reasoning_low = off: no reasoning_effort", Object.keys(off.inputs[0].input));
  const on = await run(GLM, [EDIT], (env) => env.AUDIT_DB._db.prepare("INSERT INTO ops_config VALUES ('code_reasoning_low', 'on')").run());
  ok(on.inputs[0].input.reasoning_effort === "low", "3b any other value keeps it", on.inputs[0].input.reasoning_effort);
}
// 4. a call the platform rejects because of the option is made once more without it, and audited
{
  const { env, inputs, id } = await run(GLM, [new Error("AiError: 400 invalid parameter reasoning_effort for this model"), EDIT]);
  ok(inputs.length === 2 && inputs[0].input.reasoning_effort === "low" && !("reasoning_effort" in inputs[1].input) && inputs[1].input.max_tokens === 16384, "4a the second call has no reasoning_effort", inputs.map((x) => Object.keys(x.input)));
  const ev = events(env, "code-task.model-opt-refused");
  ok(ev.length === 1 && /refused reasoning_effort/.test(ev[0].text), "4b event code-task.model-opt-refused", ev);
  ok(row(env, id).step === "verify" || row(env, id).status === "ready_to_publish", "4c the retry's reply is used", { step: row(env, id).step });
}
// 5. an error that is not about the option (a 3046 timeout) is not retried here
{
  const { env, inputs, id } = await run(GLM, [new Error("3046: Request timeout"), EDIT]);
  ok(inputs.length === 1, "5a a 3046 timeout makes one call (TIMEOUT-RETRY-1 owns it)", inputs.length);
  ok(events(env, "code-task.model-opt-refused").length === 0, "5b no model-opt-refused event", events(env, "code-task.model-opt-refused"));
  const cx = JSON.parse(row(env, id).ctx || "{}");
  ok(cx.timeouts === 1 && Number(row(env, id).attempts) === 0, "5c the timeout is kept as a same-attempt retry", { timeouts: cx.timeouts, attempts: row(env, id).attempts });
}
// 6. a rejection that also fails the second call surfaces as before (no loop)
{
  const { inputs } = await run(GLM, [new Error("AiError: 400 invalid parameter reasoning_effort"), new Error("AiError: 400 bad request")]);
  ok(inputs.length === 2, "6 two calls at most", inputs.length);
}
// 7. no ops_config table at all: the option stays on and nothing throws
{
  const { env, inputs } = envWith(GLM, [EDIT]);
  env.AUDIT_DB._db.exec("DROP TABLE ops_config");
  const c = await addTask(env);
  await tick(env); await tick(env);
  ok(c.ok && inputs.length === 1 && inputs[0].input.reasoning_effort === "low", "7 a missing ops_config leaves the option on", inputs.length && inputs[0].input.reasoning_effort);
}

// 8. EMPTY-REPLY-NOTHINK-1: an empty kimi reply is asked once more with thinking off, and that answer is used
{
  const { env, inputs, id } = await run(KIMI, ["", EDIT]);
  ok(inputs.length === 2 && inputs[0].input.chat_template_kwargs && inputs[1].input.chat_template_kwargs && inputs[1].input.chat_template_kwargs.thinking === false, "8a the second call has thinking off", inputs.map((x) => Object.keys(x.input)));
  ok(row(env, id).step === "verify" || row(env, id).status === "ready_to_publish", "8b the retried reply is used", { step: row(env, id).step, status: row(env, id).status });
  const ev = env.AUDIT_DB._db.prepare("SELECT text FROM cloud_ops_events WHERE kind = 'code-task.empty-retry'").all();
  ok(ev.length === 1 && /thinking off/.test(ev[0].text), "8c event code-task.empty-retry", ev);
}
{
  const { inputs } = await run(GLM, ["", EDIT]);
  ok(inputs.length === 1, "8d glm-5.3 (reasoning cannot be turned off) is not asked again in the same call", inputs.length);
}

console.log("reasoning-low.test: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
