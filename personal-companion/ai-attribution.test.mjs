// WORKERS-AI-SPEND-UNATTRIBUTED-RISING-1 (#1681): offline proof for personal-companion aiRunAttr. Run: node personal-companion/ai-attribution.test.mjs (a *.test.mjs in the worker directory, so scripts/run-suites.mjs runs it on every personal-companion change; AI-ATTRIBUTION-COMPANION-TEST-STALE-1, #2483)
import fs from "node:fs";
const src = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const a = src.indexOf("var AI_ATTR_DB_BINDINGS");
const b = src.indexOf("// end aiRunAttr");
if (a < 0 || b < a) throw new Error("helper markers missing");
const helper = src.slice(a, b);
const aiRunAttr = new Function(helper + "; return aiRunAttr;")();
const BINDING = "AUDIT";
let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.error("FAIL", m); } };

// static: every env.AI.run is inside the helper only
const outside = src.slice(0, a) + src.slice(b);
ok(!/\benv\.AI\.run\(/.test(outside), "raw env.AI.run left outside helper");
const attributed = (src.match(/aiRunAttr\(env, "personal-companion"/g) || []).length;
ok(attributed >= 5, "expected at least 5 attributed call sites, found " + attributed);
// every call site goes through the helper: a minimum, not an exact count, so a new AI call does not break this suite

function mkDb(mode, log) {
  return { prepare(sql) {
    if (mode === "throw-prepare") throw new Error("d1 down");
    return { bind(...x) { this.x = x; return this; }, async run() {
      if (mode === "reject") throw new Error("d1 reject");
      if (mode === "hang") return new Promise(() => {});
      log.push({ sql, x: this.x });
    } };
  } };
}
const unhandled = []; process.on("unhandledRejection", (e) => unhandled.push(e));
const tick = () => new Promise((r) => setTimeout(r, 20));
const out = { response: "hello", usage: { prompt_tokens: 1000, completion_tokens: 100 } };
const input = { messages: [{ role: "user", content: "hi" }], max_tokens: 5 };
const mkAi = (res, err) => ({ async run(m, i, o) { if (err) throw err; ok(i === input, "input passed through"); return res; } });

// 1) result identical, one counter row with fleet-control column names
let log = [];
let env = { AI: mkAi(out), [BINDING]: mkDb("ok", log) };
let r = await aiRunAttr(env, "personal-companion", "t", "@cf/moonshotai/kimi-k2.6", input, { gateway: { id: "x" } });
await tick();
ok(r === out, "result must be the same object");
const ins = log.find((l) => /INSERT INTO ai_call_counters \(day, worker, purpose, model, calls, errors, in_chars, ms, in_tok, out_tok, neurons\)/.test(l.sql));
ok(ins && ins.x[1] === "personal-companion" && ins.x[2] === "t" && ins.x[3] === "@cf/moonshotai/kimi-k2.6" && ins.x[4] === 0, "counter row shape");
ok(ins && ins.x[7] === 1000 && ins.x[8] === 100, "in_tok/out_tok from usage (W-META-1)");
ok(ins && Math.abs(ins.x[9] - (1000 * 86364 + 100 * 363636) / 1e6) < 1e-6, "neurons from usage x published rate (W-META-1)");
ok(log.some((l) => /CREATE TABLE IF NOT EXISTS ai_call_counters/.test(l.sql)), "create table ddl");

// 2) D1 failure modes never propagate or alter the result
for (const mode of ["throw-prepare", "reject"]) {
  env = { AI: mkAi(out), [BINDING]: mkDb(mode, []) };
  r = await aiRunAttr(env, "personal-companion", "t", "@cf/m", input);
  await tick();
  ok(r === out, "result unchanged when d1 " + mode);
}
ok(unhandled.length === 0, "no unhandled rejection from counter write");

// 3) hanging D1 must not slow the AI call
env = { AI: mkAi(out), [BINDING]: mkDb("hang", []) };
const t0 = Date.now();
r = await aiRunAttr(env, "personal-companion", "t", "@cf/m", input);
ok(r === out && Date.now() - t0 < 200, "hung d1 must not delay the AI call");

// 4) AI error is rethrown unchanged and counted as an error
log = [];
const boom = new Error("model 5xx");
env = { AI: mkAi(null, boom), [BINDING]: mkDb("ok", log) };
let thrown = null;
try { await aiRunAttr(env, "personal-companion", "t", "@cf/m", input); } catch (e) { thrown = e; }
await tick();
ok(thrown === boom, "AI error rethrown as-is");
const ei = log.find((l) => /INSERT INTO ai_call_counters/.test(l.sql));
ok(ei && ei.x[4] === 1, "error counted");

// 5) no D1 binding: still returns result
env = { AI: mkAi(out) };
ok((await aiRunAttr(env, "personal-companion", "t", "@cf/m", input)) === out, "works without db binding");

if (fail) { console.error(fail + " failure(s)"); process.exit(1); }
console.log("ai-attribution personal-companion ok");
