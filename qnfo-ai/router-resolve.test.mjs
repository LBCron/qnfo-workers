// qnfo-ai 5.35.0 offline suite: CMD-AI-TIMEOUT-1 (#2316), AI-ROUTER-SECOND-PATH-1 (#2179), channel diversity (#2146),
// CHANNEL-POOL (#2147). The helper block, the MODELS table and the ensemble tables are run in a vm over the worker's own
// source with runModelTurn stubbed. Run: node qnfo-ai/router-resolve.test.mjs -> prints "N passed, 0 failed".
import { readFileSync } from "node:fs";
import vm from "node:vm";
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i + 1); if (i < 0 || j < i) throw new Error("block not found: " + a); return src.slice(i, j); };
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x) : "")); } };

const sb = { console: { warn() {}, error() {}, log() {} }, Math, Number, String, Object, JSON, isFinite, Promise, Date, Array, Uint8Array, TextEncoder, crypto: globalThis.crypto, setTimeout, clearTimeout, CTX_SAFETY_MARGIN: 512, _ds402Until: 0, VERSION: "test", __turns: {} };
sb.timingSafeEqual = (a, b) => { const x = new Uint8Array(a), y = new Uint8Array(b); if (x.length !== y.length) return false; let d = 0; for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i]; return d === 0; };
// Stub: each model key answers per sb.__turns[wa] = { ms, content, throws }.
sb.runModelTurn = (env, sp) => new Promise((res, rej) => { const t = sb.__turns[sp.wa || sp.api] || { ms: 1, content: "x" }; setTimeout(() => t.throws ? rej(new Error(t.throws)) : res({ content: t.content, toolCalls: null, provider: "stub" }), t.ms); });
vm.createContext(sb);
vm.runInContext(cut("var MODELS = {", "var MAX_OUT = {") + cut("var ENSEMBLE = {", "var json = ") + cut("// ---- ROUTER-HARDEN-BEGIN", "// ---- ROUTER-HARDEN-END") +
  "\n;__x = { MODELS, ENSEMBLE, ENSEMBLE_POOL, rid, bearerMatches, resolveModel, noteUnknownModel, reasoningEffortFor, sessionAffinityId, dsTwinSpec, dsUnfunded, turnBudgetMs, hedgeDelayMs, pickHedge, runTurnBudgeted, SECOND_PATH, MODEL_CHANNELS, channelDiversity, channelOf, channelOverlap, ensembleMembers, ensembleReviewerFor, ensembleValidatorFor, UNKNOWN_MODEL_DEFAULT, HEDGE_ORDER };", sb);
const X = sb.__x;

// ---- version (a minimum, never an exact pin) ----
const ver = /var VERSION = "(\d+)\.(\d+)\.(\d+)/.exec(src);
ok(ver && (Number(ver[1]) > 5 || Number(ver[1]) === 5 && Number(ver[2]) >= 35), "VERSION is at least 5.35.0", ver && ver[0]);

// ---- explicit model resolution ----
ok(X.resolveModel("glm-5.3-flash").how === "exact", "a MODELS key resolves exactly");
ok(X.resolveModel("kimi-k2.6").id === "kimi-k2.6" && X.resolveModel("kimi-k2.6").how === "exact", "the fast tier id is routable by name");
const rwa = X.resolveModel("@cf/zai-org/glm-5.3-flash");
ok(rwa.id === "glm-5.3-flash" && rwa.how === "workers-ai-id", "a Workers AI id resolves to its MODELS key", rwa);
ok(X.resolveModel("workers-ai/@cf/openai/gpt-oss-120b").id === "gpt-oss-120b", "a workers-ai/ prefixed id resolves");
ok(X.resolveModel(" GLM-5.3-Flash ").how === "normalized", "case and whitespace are normalised, and named so");
ok(X.resolveModel("deepseek-chat").how === "alias" && X.resolveModel("deepseek-chat").id === "deepseek-v4-flash", "an alias resolves by name");
const unk = X.resolveModel("nonexistent-model-xyz");
ok(unk.id === X.UNKNOWN_MODEL_DEFAULT && unk.how === "unknown-id-default" && unk.requested === "nonexistent-model-xyz", "an unknown id resolves to the declared default and says so", unk);
ok(X.resolveModel("ensemble").how === "virtual" && X.resolveModel("auto").how === "virtual", "auto and ensemble are virtual ids");
ok(/requested_model: String\(_resInfo\.requested\)/.test(src) && /model_resolution: _resInfo\.how/.test(src), "_router carries requested_model and model_resolution");
ok(/kind router-drill|'router-drill'/.test(src) && /'model-unknown-id'/.test(src), "an unknown id and a drill leave a cloud_ops_events row");
{
  const rows = [];
  const env = { QNFO_AUDIT: { prepare: () => ({ bind: (...a) => ({ run: () => { rows.push(a); return Promise.resolve(); } }) }) } };
  const p1 = X.noteUnknownModel(env, unk, "qnfo-test");
  const p2 = X.noteUnknownModel(env, unk, "qnfo-test");
  await p1;
  ok(rows.length === 1 && p2 === null, "an unknown id is logged to D1 once per hour per id", rows.length);
  ok(rows[0] && /nonexistent-model-xyz/.test(rows[0][2]) && /deepseek-v4-flash/.test(rows[0][2]), "the row names the requested and the serving model");
}

// ---- reasoning effort for small answers ----
ok(X.reasoningEffortFor("@cf/zai-org/glm-5.3-flash", 700, null, false) === "low", "glm-5.3-flash with a small max_tokens asks for low effort");
ok(X.reasoningEffortFor("@cf/zai-org/glm-5.3-flash", 16000, null, false) === null, "a long answer keeps the model default");
ok(X.reasoningEffortFor("@cf/zai-org/glm-5.3-flash", 16000, "high", false) === "high", "a caller's valid effort is passed through");
ok(X.reasoningEffortFor("@cf/zai-org/glm-5.3-flash", 700, "none", false) === "low", "a value outside the model's list is not sent");
ok(X.reasoningEffortFor("@cf/moonshotai/kimi-k2.6", 512, null, false) === "none", "kimi-k2.6 small answers turn reasoning off");
ok(X.reasoningEffortFor("@cf/deepseek-ai/deepseek-v4-flash-0731", 512, null, false) === null, "a model with no verified lever gets no effort field");
ok(X.reasoningEffortFor("@cf/zai-org/glm-5.3-flash", 700, null, true) === null, "a tool request keeps the model default");
ok(src.includes('["temperature", "top_p", "reasoning_effort"]'), "dynamic chat passes the caller's reasoning option without a model-specific default");

// ---- DeepSeek twin ----
ok(X.dsTwinSpec(X.MODELS["deepseek-v4-flash"]) === X.MODELS["deepseek-v4-flash-wa"], "deepseek-v4-flash has its Workers AI twin");
ok(X.dsTwinSpec(X.MODELS["deepseek-v4-pro"]) === X.MODELS["deepseek-v4-pro-wa"], "deepseek-v4-pro has its Workers AI twin");
ok(X.dsTwinSpec(X.MODELS["glm-5.3"]) === null, "a Workers AI model has no twin");
ok(X.dsUnfunded() === false, "the breaker is closed by default");
sb._ds402Until = Date.now() + 6e4;
ok(X.dsUnfunded() === true, "an open 402 breaker reads as unfunded");
sb._ds402Until = 0;
ok(src.includes("return runDynamicChat(env, chatRoute(apiModel)") && !src.includes('twin_reason: "deepseek-402-breaker"'), "gateway routes replace the local DeepSeek twin fallback");

// ---- budget and hedge ----
ok(X.turnBudgetMs({ max_tokens: 700 }, {}) === 45e3, "a small answer runs under the default budget");
ok(X.turnBudgetMs({ max_tokens: 16000 }, {}) === 0, "a long generation has no budget");
ok(X.turnBudgetMs({ max_tokens: 16000, timeout_ms: 20000 }, {}) === 20000, "timeout_ms is the caller's budget");
ok(X.turnBudgetMs({ timeout_ms: 5 }, {}) === 3e3 && X.turnBudgetMs({ timeout_ms: 9e9 }, {}) === 12e4, "timeout_ms is clamped to 3 s - 120 s");
ok(X.turnBudgetMs({ max_tokens: 700 }, { stream: true }) === 0 && X.turnBudgetMs({ max_tokens: 700 }, { tools: true }) === 0, "streams and tool requests are not budgeted by default");
ok(X.pickHedge("glm-5.3-flash", X.MODELS["glm-5.3-flash"], { estIn: 4000, maxOut: 700 }) === "deepseek-v4-flash-wa", "the hedge for glm-5.3-flash is a healthy model of another family (HEDGE-HEALTH-1)");
ok(X.pickHedge("deepseek-v4-flash-wa", X.MODELS["deepseek-v4-flash-wa"], { estIn: 4000, maxOut: 700 }) === "glm-5.3-flash", "the hedge is never the primary");
ok(X.pickHedge("gpt-oss-120b", X.MODELS["gpt-oss-120b"], { estIn: 30000, maxOut: 700 }) === "glm-5.3-flash", "a prompt beyond the llama context hedges on a model that fits");
ok(X.pickHedge("gpt-oss-120b", X.MODELS["gpt-oss-120b"], { estIn: 100, maxOut: 700, hasImage: true }) === "glm-5.3-flash", "an image request hedges on a vision model");
const run = (o) => X.runTurnBudgeted({}, X.MODELS[o.primaryKey], [], 700, null, 0.6, 0.9, null, o);
{
  sb.__turns = { "@cf/zai-org/glm-5.3-flash": { ms: 400, content: "slow" }, "@cf/moonshotai/kimi-k2.6": { ms: 20, content: "fast" } };
  const r = await run({ budgetMs: 2000, hedgeMs: 50, primaryKey: "glm-5.3-flash", hedgeKey: "kimi-k2.6" });
  ok(r.turn && r.turn.content === "fast" && r.hedged && r.winner === "kimi-k2.6", "a silent primary is overtaken by the hedge", r);
  sb.__turns = { "@cf/zai-org/glm-5.3-flash": { ms: 10, content: "quick" } };
  const q = await run({ budgetMs: 2000, hedgeMs: 200, primaryKey: "glm-5.3-flash", hedgeKey: "kimi-k2.6" });
  ok(q.turn.content === "quick" && !q.hedged && q.legs.length === 1, "a quick primary answers alone: no second call", q);
  sb.__turns = { "@cf/zai-org/glm-5.3-flash": { ms: 10, content: "" }, "@cf/moonshotai/kimi-k2.6": { ms: 10, content: "hedge" } };
  const e = await run({ budgetMs: 2000, hedgeMs: 1500, primaryKey: "glm-5.3-flash", hedgeKey: "kimi-k2.6" });
  ok(e.turn.content === "hedge" && e.legs[0].err === "empty" && e.legs[1].ms < 500, "an empty primary starts the hedge at once", e);
  sb.__turns = { "@cf/zai-org/glm-5.3-flash": { ms: 10, throws: "deepseek 402" }, "@cf/moonshotai/kimi-k2.6": { ms: 10, throws: "boom" } };
  const f = await run({ budgetMs: 2000, hedgeMs: 1500, primaryKey: "glm-5.3-flash", hedgeKey: "kimi-k2.6" });
  ok(f.turn === null && f.reason === "all-legs-failed" && f.legs.length === 2 && f.legs[1].err === "boom", "two failed legs resolve with no turn and both errors", f);
  sb.__turns = { "@cf/zai-org/glm-5.3-flash": { ms: 500, content: "late" }, "@cf/moonshotai/kimi-k2.6": { ms: 500, content: "late" } };
  const d = await run({ budgetMs: 120, hedgeMs: 30, primaryKey: "glm-5.3-flash", hedgeKey: "kimi-k2.6" });
  ok(d.turn === null && d.reason === "deadline" && d.legs.every((l) => l.err === "unfinished"), "the deadline resolves with no turn", d);
  sb.__turns = { "@cf/zai-org/glm-5.3-flash": { ms: 10, content: "" } };
  const n = await run({ budgetMs: 500, hedgeMs: 100, primaryKey: "glm-5.3-flash", hedgeKey: null });
  ok(n.turn === null && !n.hedged, "with no hedge (spend cap: one leg) a failed primary ends the turn", n);
}
ok(/type: "router_timeout"/.test(src) && /, 504\);/.test(src), "an exhausted budget answers 504 router_timeout, not canned text");
ok(src.includes("primaryKey: _primaryKey, hedgeKey: null"), "dynamic routes keep one consumer leg; gateway owns fallback");
for (const label of ["calendar-context", "web-search", "web-fetch", "rag-context", "semantic-cache", "free-fallback"]) ok(src.includes('"' + label + '"'), "a timeout bounds " + label);

// ---- semantic cache: mkLogRec no longer reads a variable before its declaration ----
ok(src.indexOf("let routedModel = String(body.model") > 0 && src.indexOf("let routedModel = String(body.model") < src.indexOf("const mkLogRec = "), "routedModel is declared before mkLogRec");
ok(!/const routedModel = effective;/.test(src), "the late const declaration is gone");

// ---- second path ----
ok(X.SECOND_PATH.contract === "AI-ROUTER-SECOND-PATH-1" && X.SECOND_PATH.direct_binding === "AI" && X.SECOND_PATH.gateway === "default" && X.SECOND_PATH.models.join() === "dynamic/value" && X.SECOND_PATH.workers_ai_fallback.model === "@cf/zai-org/glm-5.3-flash" && X.SECOND_PATH.drill.answers === 503, "the second-path contract names gateway and direct Workers AI recovery");
ok(/transient gateway errors retry via dynamic\/value then direct Workers AI/.test(X.SECOND_PATH.request_budget) && /consumer does not add a separate model hedge/.test(X.SECOND_PATH.request_budget), "the second-path contract documents the bounded router fallback without a caller-side hedge");
ok(/second_path: SECOND_PATH/.test(src) && /body\.drill === "router-down"/.test(src) && /"x-qnfo-drill": "router-down"/.test(src), "/health serves the contract and the drill answers 503");
ok(src.indexOf('body.drill === "router-down"') > src.indexOf("async function handleChatCore") && src.indexOf('body.drill === "router-down"') > src.indexOf('return json({ error: "Unauthorized" }, 401);', src.indexOf("async function handleChatCore")), "the drill runs after the auth check");

// ---- channel diversity ----
const thr = 0.25;
const same = X.channelDiversity(["@cf/zai-org/glm-5.3", "@cf/zai-org/glm-5.3-flash"], thr);
ok(!same.ok && same.max_overlap === 1 && /share vendor and lineage/.test(same.reason), "two models of one lineage are refused with a reason", same.reason);
ok(X.channelDiversity(["deepseek-v4-flash", "deepseek-v4-pro-wa"], thr).ok === false, "a direct DeepSeek route and a Workers AI DeepSeek model are one lineage");
ok(X.channelDiversity(["@cf/zai-org/glm-5.3-flash", "@cf/openai/gpt-oss-120b"], thr).ok === true, "two lineages pass");
ok(X.channelDiversity(["@cf/zai-org/glm-5.3-flash"], thr).ok === false, "one member is not an ensemble");
ok(X.channelOf("@cf/acme/unknown-1").declared === false, "an undeclared model is marked undeclared");
for (const pool of Object.keys(X.ENSEMBLE_POOL)) for (const pm of X.ENSEMBLE_POOL[pool]) {
  const v = X.ensembleValidatorFor(X.ENSEMBLE, pm), r = X.ensembleReviewerFor(X.ENSEMBLE, pm, thr);
  ok(X.channelDiversity([pm, v.wa], thr).ok, "pool " + pool + ": the judge of " + pm + " is another lineage", v.wa);
  ok(r && X.channelOverlap(X.channelOf(pm), X.channelOf(r.wa)).overlap <= thr, "pool " + pool + ": the reviewer of " + pm + " is another lineage", r && r.wa);
}
ok(X.ensembleReviewerFor(X.ENSEMBLE, "@cf/deepseek-ai/deepseek-v4-flash-0731", thr).switched === true, "a deepseek primary is reviewed by the alternate reviewer");
ok(X.ensembleMembers(["glm-5.3-flash", "gpt-oss-120b"], 2).models.join() === "@cf/zai-org/glm-5.3-flash,@cf/openai/gpt-oss-120b", "caller-named members resolve to Workers AI ids");
ok(!!X.ensembleMembers(["glm-5.3-flash", "nonexistent-model-xyz"], 2).error && !!X.ensembleMembers(["glm-5.3-flash"], 2).error, "an unknown member or a single member is rejected");
ok(/type: "channel_diversity_refused"/.test(src) && /"\/v1\/ensemble\/policy"/.test(src), "the refusal is structured and the policy route exists");
for (const k of Object.keys(X.MODELS)) { const m = X.MODELS[k]; if (m.wa) ok(!!X.MODEL_CHANNELS[m.wa], "channel declared for " + m.wa); }

// ---- every Workers AI id in the worker exists in the live catalog (GET /ai/models/search, read 2026-10-12) ----
const CATALOG = new Set(["@cf/baai/bge-base-en-v1.5", "@cf/baai/bge-large-en-v1.5", "@cf/baai/bge-m3", "@cf/baai/bge-small-en-v1.5", "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b", "@cf/deepseek-ai/deepseek-v4-flash-0731", "@cf/deepseek-ai/deepseek-v4-pro-0813", "@cf/google/gemma-4-26b-a4b-it", "@cf/meta/llama-3.3-70b-instruct-fp8-fast", "@cf/meta/llama-4-scout-17b-16e-instruct", "@cf/moonshotai/kimi-k2.6", "@cf/moonshotai/kimi-k2.7-code", "@cf/nvidia/nemotron-3-120b-a12b", "@cf/openai/gpt-oss-120b", "@cf/openai/gpt-oss-20b", "@cf/qwen/qwen2.5-coder-32b-instruct", "@cf/qwen/qwen3-30b-a3b-fp8", "@cf/qwen/qwen3.8-27b", "@cf/qwen/qwq-32b", "@cf/zai-org/glm-4.7-flash", "@cf/zai-org/glm-5.2", "@cf/zai-org/glm-5.3", "@cf/zai-org/glm-5.3-flash"]);
// Ids inside the test-only strings of this worker's own prose (docs, comments) are held to the same list.
const ids = [...new Set(src.match(/@cf\/[a-z0-9_.-]+\/[A-Za-z0-9_.-]+/g) || [])].filter((id) => !/^@cf\/acme\//.test(id));
for (const id of ids) ok(CATALOG.has(id.replace(/[.,]$/, "")), "Workers AI id is in the live catalog: " + id);
for (const k of X.HEDGE_ORDER) ok(!!X.MODELS[k] && !!X.MODELS[k].wa, "hedge model is routable: " + k);

// ---- workers standards ----
ok(!/Math\.random\(\)/.test(src), "no Math.random() left (ids come from crypto.getRandomValues)");
ok(/^[0-9a-f]{8}$/.test(X.rid(8)) && /^[0-9a-f]{5}$/.test(X.rid(5)) && X.rid(16) !== X.rid(16), "rid returns n hex characters");
ok(!/=== "Bearer " \+/.test(src), "no direct string comparison of a bearer secret");
ok(await X.bearerMatches("Bearer k1", ["k0", "k1"]) === true && await X.bearerMatches("Bearer k2", ["k0", "k1"]) === false && await X.bearerMatches("Bearer ", [undefined, ""]) === false, "bearerMatches accepts each listed key and nothing else");
ok(!/passThroughOnException/.test(src), "no passThroughOnException");

console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
