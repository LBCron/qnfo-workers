// RESEARCH-COST-FIRST-1 (qnfo-research-exec 0.36.0, pillar cost). glm-5.3-flash runs first while ops_config research_primary_model is
// auto; empty or rate-limited glm replies fall back per request without switching later stages to gpt-oss-120b.
// Runs aiText and applyModelOrder from the source. Run: node qnfo-research-exec/cost-first.test.mjs
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? "  -- " + JSON.stringify(x) : "")); } };
const line = (name) => { const m = new RegExp("\\nvar " + name + " = [^\\n]*").exec(src); if (!m) throw new Error("missing " + name); return m[0]; };
const fn = (head) => { const a = src.indexOf("\n" + head); if (a < 0) throw new Error("missing " + head); return src.slice(a, src.indexOf("\n}\n", a) + 2); };
const body = line("WORKER") + line("MODELS") + line("MODELS_VALUE_ORDER") + line("MODELS_COST_ORDER") + line("_costFirst")
  + line("__AI_ATTR_RATES") + line("AI_RATE_FALLBACK") + line("AI_TIMEOUT_SKIP") + line("AI_TRANSIENT_RE") + line("AI_MODEL_SKIP_MS") + line("_aiRateSkip") + line("_aiSkipLogged")
  + fn("function aiInputRate(") + fn("function aiFallbackFor(") + fn("async function aiSkipLog(") + fn("async function applyModelOrder(")
  + "\nvar AI_TEXT_MAX_OUT = {};\nasync function aiRunOpts() { return undefined; }\nvar _evs = [];\nasync function logEvent(env, kind, text) { _evs.push(kind); }\n"
  + fn("async function aiText(env, model, prompt, maxTokens, effort) {")
  + "\nreturn { aiText, applyModelOrder, MODELS, evs: _evs };";
const W = new Function(body)();
const realSet = globalThis.setTimeout; globalThis.setTimeout = (f) => realSet(f, 0);
const GLM = "@cf/zai-org/glm-5.3-flash", OSS = "@cf/openai/gpt-oss-120b";
const d1 = (mode, fallbacks) => ({ prepare: (sql) => ({ bind() { return this; }, first: async () => /research_primary_model/.test(sql) ? (mode == null ? null : { value: mode }) : { n: fallbacks } }) });
const ai = (script) => { const calls = []; return { calls, run: async (m) => { calls.push(m); const r = script(m); if (r instanceof Error) throw r; return r; } }; };

let r = await W.applyModelOrder({ QNFO_AUDIT: d1(null, 0) });
ok(r.costFirst && W.MODELS[0] === GLM && W.MODELS[1] === OSS, "auto by default: glm-5.3-flash first, gpt-oss-120b second", W.MODELS);
let a = ai((m) => m === GLM ? { response: "" } : { response: "answer" });
ok((await W.aiText({ AI: a }, GLM, "p", 100, "low")) === "answer" && a.calls.join() === [GLM, OSS].join(), "an empty glm reply is asked once of gpt-oss-120b", a.calls);
a = ai((m) => m === GLM ? { response: "glm answer" } : { response: "x" });
ok((await W.aiText({ AI: a }, GLM, "p", 100, "low")) === "glm answer" && a.calls.length === 1, "a glm answer is used as is", a.calls);
a = ai((m) => m === GLM ? new Error("3021: rate limit") : { response: "oss" });
ok((await W.aiText({ AI: a }, GLM, "p", 100, "low")) === "oss" && a.calls[a.calls.length - 1] === OSS, "a rate-limited glm call falls back to gpt-oss-120b", a.calls);
ok(W.evs.filter((k) => k === "cost-first-empty").length === 2, "each fallback is an event the revert counts", W.evs);
r = await W.applyModelOrder({ QNFO_AUDIT: d1("auto", 50) });
ok(r.costFirst && W.MODELS[0] === GLM, "a fallback burst keeps glm first for later requests", r);
a = ai((m) => m === GLM ? { response: "" } : { response: "fallback answer" });
ok((await W.aiText({ AI: a }, GLM, "p", 100, "low")) === "fallback answer" && a.calls.join() === [GLM, OSS].join(), "empty replies still fall back per request after a burst", a.calls);
r = await W.applyModelOrder({ QNFO_AUDIT: d1("gpt-oss-120b", 0) });
ok(!r.costFirst && W.MODELS[0] === OSS, "research_primary_model = gpt-oss-120b keeps the old order", r);
r = await W.applyModelOrder({ QNFO_AUDIT: d1("glm-5.3-flash", 50) });
ok(r.costFirst && W.MODELS[0] === GLM, "research_primary_model = glm-5.3-flash pins glm first without the automatic revert", r);
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
