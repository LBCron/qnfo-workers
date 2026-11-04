// TWIN-FLASH-1 offline suite (personal-api 4.8.0, owner directive 2026-10-05, agent_issues 1818): the twin answers with
// glm-5.3-flash first (reasoning_effort low), falls back to deepseek-v4-pro in the same request on an error or an empty
// reply, counts an empty reply as a failed answer, retries once without reasoning_effort if a model rejects it, and
// reverts the whole order to deepseek-v4-pro first when today's flash failure share is >= 20% over >= 10 calls.
// Run: node personal-api/twin-flash.test.mjs   -> prints "N passed, 0 failed"
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const patched = src + "\nexport { upstreamChat as __upstream, twinChatModels as __order, CHAT_MODELS as __models, TWIN_PRIMARY as __primary, TWIN_PREVIOUS as __previous };\nexport function __resetTwin() { _twinOrder = null; }\n";
const mod = await import("data:text/javascript;base64," + Buffer.from(patched).toString("base64"));
let pass = 0, fail = 0;
const ok = (c, m, extra) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (extra !== undefined ? " :: " + JSON.stringify(extra) : "")); } };
const FLASH = "@cf/zai-org/glm-5.3-flash", DS = "@cf/deepseek-ai/deepseek-v4-flash-0731";
const day = new Date().toISOString().slice(0, 10);

function mkEnv(behaviour) {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE ai_call_counters (day TEXT, worker TEXT, purpose TEXT, model TEXT, calls INTEGER DEFAULT 0, errors INTEGER DEFAULT 0, in_chars INTEGER DEFAULT 0, ms INTEGER DEFAULT 0, in_tok INTEGER DEFAULT 0, out_tok INTEGER DEFAULT 0, neurons REAL DEFAULT 0, PRIMARY KEY (day, worker, purpose, model))");
  const AUDIT = { prepare(sql) { let a = []; const s = { bind(...x) { a = x; return s; }, async run() { const r = db.prepare(sql).run(...a); return { success: true, meta: { changes: Number(r.changes) } }; }, async first() { return db.prepare(sql).get(...a) || null; } }; return s; } };
  const calls = [];
  const AI = { async run(model, input, opts) { calls.push({ model, input, opts }); return behaviour(model, input, calls.length); } };
  return { env: { AI, AUDIT }, db, calls };
}
const answer = (t) => ({ response: t, usage: { prompt_tokens: 10, completion_tokens: 5 } });

ok(mod.__models[0] === FLASH && mod.__models[1] === DS && !mod.__models.includes("@cf/zai-org/glm-5.3"), "flash is the primary, deepseek-v4-pro the fallback, glm-5.3 left the list", mod.__models);
ok(mod.__primary === FLASH && mod.__previous === DS, "the revert target is the previous primary");

{
  mod.__resetTwin();
  const { env, calls } = mkEnv(() => answer("hi from flash"));
  const r = await mod.__upstream(env, "sys", [{ role: "user", content: "hello" }], 0.7, 1000, false, false);
  ok(r.ok && r.model === FLASH && r.body.choices[0].message.content === "hi from flash", "flash answers first", r);
  ok(calls.length === 1 && calls[0].input.reasoning_effort === "low", "glm calls ask for low reasoning effort", calls[0] && calls[0].input);
}
{
  mod.__resetTwin();
  const { env, calls } = mkEnv((m) => { if (m === FLASH) throw new Error("upstream 500"); return answer("hi from deepseek"); });
  const r = await mod.__upstream(env, "sys", [{ role: "user", content: "hello" }], 0.7, 1000, false, false);
  ok(r.ok && r.model === DS && calls.map((c) => c.model).join() === FLASH + "," + DS, "a flash error is answered by deepseek-v4-pro in the same request", calls.map((c) => c.model));
  ok(calls[1].input.reasoning_effort === undefined, "non-glm models get no reasoning_effort");
}
{
  mod.__resetTwin();
  const { env, db, calls } = mkEnv((m) => m === FLASH ? answer("") : answer("deepseek fills in"));
  db.prepare("INSERT INTO ai_call_counters (day, worker, purpose, model, calls, errors) VALUES (?, 'personal-api', 'binding', ?, 1, 0)").run(day, FLASH);
  const r = await mod.__upstream(env, "sys", [{ role: "user", content: "hello" }], 0.7, 1000, false, false);
  const row = db.prepare("SELECT errors FROM ai_call_counters WHERE model = ?").get(FLASH);
  ok(r.ok && r.model === DS && calls.length === 2, "an empty flash reply falls back to deepseek-v4-pro");
  ok(row.errors === 1, "the empty reply is counted as a failed answer on flash's counter row", row);
}
{
  mod.__resetTwin();
  const { env, calls } = mkEnv((m, input) => { if (m === FLASH && input.reasoning_effort) throw new Error("unknown field reasoning_effort"); return answer("flash without the field"); });
  const r = await mod.__upstream(env, "sys", [{ role: "user", content: "hello" }], 0.7, 1000, false, false);
  ok(r.ok && r.model === FLASH && calls.length === 2 && calls[1].input.reasoning_effort === undefined, "a rejected reasoning_effort is retried once without it", calls.map((c) => c.input.reasoning_effort));
}
{
  mod.__resetTwin();
  const { env, db, calls } = mkEnv(() => answer("x"));
  db.prepare("INSERT INTO ai_call_counters (day, worker, purpose, model, calls, errors) VALUES (?, 'personal-api', 'binding', ?, 12, 3)").run(day, FLASH);
  const order = await mod.__order(env);
  ok(order[0] === DS && order.includes(FLASH), "25% failed flash answers over 12 calls today reverts the order to deepseek-v4-pro first", order);
  const r = await mod.__upstream(env, "sys", [{ role: "user", content: "hello" }], 0.7, 1000, false, false);
  ok(r.model === DS && calls[0].model === DS, "the chat route follows the reverted order");
}
{
  mod.__resetTwin();
  const { env, db } = mkEnv(() => answer("x"));
  db.prepare("INSERT INTO ai_call_counters (day, worker, purpose, model, calls, errors) VALUES (?, 'personal-api', 'binding', ?, 12, 1)").run(day, FLASH);
  ok((await mod.__order(env))[0] === FLASH, "8% failures keep flash first");
  mod.__resetTwin();
  db.prepare("UPDATE ai_call_counters SET calls = 5, errors = 5").run();
  ok((await mod.__order(env))[0] === FLASH, "fewer than 10 calls never revert (too little evidence)");
  mod.__resetTwin();
  ok((await mod.__order({ AI: {} }))[0] === FLASH, "no AUDIT binding keeps the owner's choice");
}
{
  const inner = src.slice(src.indexOf("async _chatInner(sid, uc)"), src.indexOf("async _chatInner(sid, uc)") + 3000);
  ok(!/deepseek-v4-pro-0813/.test(inner) && /twinChatModels\(_env\)/.test(inner) && /twinRun\(_env, _m/.test(inner), "the Durable Object chat uses the same order and fallback (no hard-coded model)");
  ok(/useBriefModels \? BRIEF_MODELS : await twinChatModels\(env\)/.test(src), "brief and image routes keep their own model lists");
}

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
