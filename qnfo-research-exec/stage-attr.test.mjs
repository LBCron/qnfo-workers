// AI-STAGE-ATTRIBUTION-1 and -2 offline suite (qnfo-research-exec 0.16.0, #1795/#1780, agent_issues 2264): Workers AI counter
// rows carry the pipeline stage of the call context that made the call, nothing else about the AI call changes (same model,
// same input, same result, fail-soft), and two research_parallel slots never label each other's calls.
// Run: node qnfo-research-exec/stage-attr.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d !== undefined ? " -- " + JSON.stringify(d) : "")); } };

// Every stage function labels the env it was called with, on entry.
for (const st of ["Ground", "Ensemble", "Reconcile", "Complete", "Review", "Revise", "Verify"]) {
  const re = new RegExp("async function stage" + st + "\\(env, row\\) \\{\\n  __attrStageSet\\(env, \"" + st.toLowerCase() + "\"\\);");
  ok(re.test(src), "stage" + st + " sets its label on its env on entry");
}

// Evaluate the real wrapper from the source.
const a = src.indexOf("var __AI_ATTR_RATES");
const b = src.indexOf("var WORKER = ");
const body = src.slice(a, b);
const W = new Function(body + "\nreturn { wrap: __aiAttrEnv, slot: __attrSlotEnv, set: __attrStageSet, get: __attrStageGet };")();

const mkDb = () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE ai_call_counters (day TEXT, worker TEXT, purpose TEXT, model TEXT, calls INTEGER DEFAULT 0, errors INTEGER DEFAULT 0, in_chars INTEGER DEFAULT 0, ms INTEGER DEFAULT 0, in_tok INTEGER DEFAULT 0, out_tok INTEGER DEFAULT 0, neurons REAL DEFAULT 0, PRIMARY KEY (day, worker, purpose, model))");
  const D1 = { prepare(sql) { let args = []; const q = { bind(...x) { args = x; return q; }, async run() { db.prepare(sql).run(...args); return {}; } }; return q; } };
  return { db, D1 };
};
const { db, D1 } = mkDb();
const seen = [];
const AI = { async run(model, input) { seen.push({ model, input }); if (input && input.boom) throw new Error("boom"); return { response: "ok:" + model, usage: { prompt_tokens: 1000, completion_tokens: 100 } }; } };
const env = W.wrap({ AI, QNFO_AUDIT: D1 }, "qnfo-research-exec", "AI", "QNFO_AUDIT");

const r0 = await env.AI.run("@cf/zai-org/glm-5.3-flash", { messages: [{ role: "user", content: "x" }] });
W.set(env, "ensemble");
const r1 = await env.AI.run("@cf/zai-org/glm-5.3-flash", { messages: [{ role: "user", content: "y" }] });
await env.AI.run("@cf/zai-org/glm-5.3-flash", { messages: [{ role: "user", content: "z" }] });
W.set(env, "verify");
let threw = false;
try { await env.AI.run("@cf/openai/gpt-oss-120b", { boom: 1 }); } catch (e) { threw = true; }

const rows = db.prepare("SELECT purpose, model, calls, errors, neurons FROM ai_call_counters ORDER BY purpose").all();
const by = Object.fromEntries(rows.map((r) => [r.purpose + "|" + r.model, r]));
ok(by["binding|@cf/zai-org/glm-5.3-flash"] && by["binding|@cf/zai-org/glm-5.3-flash"].calls === 1, "a call before any stage keeps purpose 'binding'", rows);
ok(by["binding:ensemble|@cf/zai-org/glm-5.3-flash"] && by["binding:ensemble|@cf/zai-org/glm-5.3-flash"].calls === 2, "calls in a stage are counted under binding:<stage>", rows);
ok(by["binding:ensemble|@cf/zai-org/glm-5.3-flash"].neurons > 0, "neurons are still computed per stage row");
ok(by["binding:verify|@cf/openai/gpt-oss-120b"] && by["binding:verify|@cf/openai/gpt-oss-120b"].errors === 1 && threw, "a failing call is counted as an error and still throws to the caller", rows);
ok(r0.response === "ok:@cf/zai-org/glm-5.3-flash" && r1.response === "ok:@cf/zai-org/glm-5.3-flash", "the AI result is returned unchanged");
ok(seen.length === 4 && seen[1].model === "@cf/zai-org/glm-5.3-flash" && seen[1].input.messages[0].content === "y", "model and input reach the binding unchanged");
const total = rows.reduce((s, r) => s + r.neurons, 0);
ok(total > 0 && rows.every((r) => r.purpose.indexOf("binding") === 0), "every row still starts with 'binding', so per-worker and per-day sums are unchanged");
ok(W.get(env) === "verify" && W.get({}) === "" && W.get(null) === "", "the label is read from the env's context; an env without one reads empty");
W.set({}, "x");
ok(true, "setting a label on an env without a context is a no-op, never a throw");

// AI-STAGE-ATTRIBUTION-2 (0.16.0, agent_issues 2264): two research_parallel slots interleave in one isolate. Each slot gets
// its own env copy (__attrSlotEnv) with its own context and its own wrapped binding; a slot sets its label, awaits, then
// calls the model: every call is counted under its own slot's stage, whatever the other slot set last.
const T = mkDb();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const AI2 = { async run() { await sleep(5); return { response: "ok", usage: { prompt_tokens: 10, completion_tokens: 1 } }; } };
const base = W.wrap({ AI: AI2, QNFO_AUDIT: T.D1 }, "qnfo-research-exec", "AI", "QNFO_AUDIT");
const M = "@cf/zai-org/glm-5.3-flash";
const sA = W.slot(base), sB = W.slot(base);
ok(sA !== base && sA.AI !== base.AI && sA.AI !== sB.AI && sA.__aiAttrCtx !== sB.__aiAttrCtx && sA.QNFO_AUDIT === base.QNFO_AUDIT, "each slot env has its own context and wrapped binding and shares the other bindings");
// slot A: review, waits, then makes 3 calls; slot B enters ground (no model call) mid-way, then ensemble with 2 calls.
const slotA = async (e) => { W.set(e, "review"); await sleep(10); for (let i = 0; i < 3; i++) await e.AI.run(M, { messages: [{ role: "user", content: "a" + i }] }); return W.get(e); };
const slotB = async (e) => { await sleep(2); W.set(e, "ground"); await sleep(3); W.set(e, "ensemble"); await sleep(1); await e.AI.run(M, { messages: [{ role: "user", content: "b0" }] }); await e.AI.run(M, { messages: [{ role: "user", content: "b1" }] }); return W.get(e); };
const labels = await Promise.all([slotA(sA), slotB(sB)]);
const rows2 = Object.fromEntries(T.db.prepare("SELECT purpose, calls FROM ai_call_counters").all().map((r) => [r.purpose, r.calls]));
ok(labels[0] === "review" && labels[1] === "ensemble", "each slot reads back its own label", labels);
ok(rows2["binding:review"] === 3, "slot A's calls stay under binding:review although slot B set ground and ensemble meanwhile", rows2);
ok(rows2["binding:ensemble"] === 2, "slot B's calls are counted under binding:ensemble", rows2);
ok(!rows2["binding:ground"], "nothing is counted under ground, a stage that makes no model call", rows2);
ok(W.get(base) === "", "the slots never wrote the shared env's label (no module-level or shared state)");
ok(W.slot({}) !== undefined && W.get(W.slot({})) === "", "an unwrapped env passes through __attrSlotEnv unchanged");

const runLeasedSrc = src.slice(src.indexOf("async function runLeased("), src.indexOf("async function runLeased(") + 7000);
ok(/runSlot\(__attrSlotEnv\(env\), k, roundWidth, inflight\)/.test(runLeasedSrc), "runLeased gives every slot its own attribution env");
ok(!/^var __AI_ATTR_STAGE\b/m.test(src) && !/__attrSlotRun\(/.test(src), "no module-level stage label and no AsyncLocalStorage slot runner remain");
ok(!/from "node:async_hooks"/.test(src), "the worker no longer imports AsyncLocalStorage");
ok(/attrCtx && attrCtx\.stage \? "binding:" \+ attrCtx\.stage : "binding"/.test(body), "the counter row reads the stage from the binding's own context object");

console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
