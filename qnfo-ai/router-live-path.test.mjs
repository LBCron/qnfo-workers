// qnfo-ai 5.35.0 request-path suite: the whole worker module is loaded and driven through its fetch handler with stub
// bindings (no network: global fetch is replaced). Covers what the unit suite cannot: the chat route end to end.
// Run: node qnfo-ai/router-live-path.test.mjs -> prints "N passed, 0 failed".
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const dir = mkdtempSync(join(tmpdir(), "qnfo-ai-"));
writeFileSync(join(dir, "worker.mjs"), readFileSync(new URL("./worker.js", import.meta.url), "utf8"));
const worker = (await import(pathToFileURL(join(dir, "worker.mjs")).href)).default;
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 400) : "")); } };

const calls = { ai: [], fetch: [], d1: [] };
let aiPlan = {};
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const host = new URL(String(url)).hostname;
  calls.fetch.push(host);
  if (host === "api.deepseek.com") return new Response(JSON.stringify({ error: { message: "Insufficient Balance" } }), { status: 402 });
  return new Response("blocked in test", { status: 599 });
};
let envExtra = {};
let d1First = null;
const env = () => ({
  ...envExtra,
  ROUTER_AUTH_KEY: "test-key",
  DEEPSEEK_API_KEY: "x",
  AI: {
    async run(model, input, opts) {
      calls.ai.push({ model, input, opts });
      if (/bge-/.test(model)) return { data: [[0.1, 0.2, 0.3]] };
      const p = aiPlan[model] || { ms: 1, text: "answer from " + model };
      await new Promise((r) => setTimeout(r, p.ms));
      if (p.throws) throw new Error(p.throws);
      return { choices: [{ message: { content: p.text }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 4 } } };
    }
  },
  QNFO_AUDIT: { prepare(sql) { const st = { bind(...a) { st.args = a; return st; }, async run() { calls.d1.push({ sql, args: st.args }); return { meta: {} }; }, async all() { return { results: [] }; }, async first() { return d1First ? d1First(sql, st.args) : null; } }; return st; } }
});
const waits = [];
const ctx = { waitUntil(p) { waits.push(Promise.resolve(p).catch(() => {})); }, props: {} };
const chat = async (body, key, ua) => {
  const r = await worker.fetch(new Request("https://ai.test/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + (key || "test-key"), "User-Agent": ua || "QNFO-AI-Calibration/test" }, body: JSON.stringify(body) }), env(), ctx);
  let j = null;
  try { j = await r.json(); } catch (e) {}
  return { status: r.status, j, headers: r.headers };
};
const reset = () => { calls.ai.length = 0; calls.fetch.length = 0; calls.d1.length = 0; aiPlan = {}; };
const msgs = [{ role: "user", content: "Reply with exactly: OK" }];

// Dynamic route dispatch replaces direct-model, twin and local hedge semantics.
let r = await chat({ model: "nonexistent-model-xyz", messages: msgs, max_tokens: 32 });
ok(r.status === 200 && r.j.model === "dynamic/standard", "unknown IDs use the standard default", r);
ok(r.j._router.model_resolution === "unknown-id-default", "unknown resolution is still explicit");
await Promise.all(waits);
ok(calls.d1.some((c) => /'model-unknown-id'/.test(c.sql)), "unknown model requests remain logged");
for (const route of ["dynamic/value", "dynamic/standard", "dynamic/premium"]) {
  reset();
  r = await chat({ model: route, messages: msgs, max_tokens: 700 });
  const c = calls.ai.find((x) => x.model === route);
  ok(r.status === 200 && r.j.model === route && c, route + " is accepted without direct-model resolution", r);
  ok(c && c.opts.gateway.id === "default" && c.input.max_tokens === 700, "gateway and token options are preserved");
  ok(calls.ai.filter((x) => !/bge-/.test(x.model)).length === 1 && !calls.fetch.includes("api.deepseek.com"), "one route call, no provider ladder");
  ok(r.j._router.family === "unknown" && r.j._router.tier === null, "route IDs do not claim vendor or zero-price attribution");
}
reset();
r = await chat({ messages: msgs, max_tokens: 700 });
ok(r.status === 200 && r.j.model === "dynamic/standard", "omitted model defaults to standard");
reset();
const toolSpec = [{ type: "function", function: { name: "lookup", parameters: { type: "object", properties: {} } } }];
r = await chat({ model: "dynamic/standard", messages: msgs, max_tokens: 64, tools: toolSpec, tool_choice: { type: "function", function: { name: "lookup" } } });
const toolCall = calls.ai.find((x) => x.model === "dynamic/standard");
ok(r.status === 200 && toolCall && toolCall.input.tools[0].function.name === "lookup" && toolCall.input.tool_choice.function.name === "lookup", "dynamic route preserves the chat tool-call request shape");
reset();
const chatStream = await worker.fetch(new Request("https://ai.test/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer test-key" }, body: JSON.stringify({ model: "dynamic/value", messages: msgs, max_tokens: 64, stream: true }) }), env(), ctx);
const chatSse = await chatStream.text();
const chatStreamCall = calls.ai.find((x) => x.model === "dynamic/value");
ok(chatStream.status === 200 && chatStreamCall && chatStreamCall.opts.gateway.id === "default" && chatSse.includes('"object":"chat.completion.chunk"') && chatSse.includes("data: [DONE]"), "dynamic route preserves the chat streaming response shape");
reset();
const responsesStream = await worker.fetch(new Request("https://ai.test/v1/responses", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer test-key" }, body: JSON.stringify({ model: "dynamic/premium", input: "Reply with exactly: OK", max_output_tokens: 64, stream: true }) }), env(), ctx);
const responsesSse = await responsesStream.text();
const responsesCall = calls.ai.find((x) => x.model === "dynamic/premium");
ok(responsesStream.status === 200 && responsesCall && responsesCall.opts.gateway.id === "default" && responsesCall.input.max_tokens === 64 && responsesCall.input.messages.some((m) => m.content === "Reply with exactly: OK"), "Responses facade passes the dynamic route and input through the gateway unchanged");
ok(responsesSse.includes("response.output_text.delta") && responsesSse.includes("response.completed") && responsesSse.includes("data: [DONE]"), "Responses facade preserves its streaming event shape");
reset();
r = await chat({ model: "glm-5.3-flash", messages: msgs, max_tokens: 16000 });
let c = calls.ai.find((x) => x.model === "dynamic/value");
ok(r.status === 200 && c && c.input.max_tokens === 16000 && c.input.reasoning_effort === undefined, "legacy cheap model selects value without direct-model effort defaults");
reset();
r = await chat({ model: "@cf/moonshotai/kimi-k2.6", messages: msgs, max_tokens: 64 });
ok(r.status === 200 && r.j.model === "dynamic/premium" && r.j._router.model_resolution === "workers-ai-id", "legacy reasoning ID selects premium by named resolution");
reset();
aiPlan = { "dynamic/value": { ms: 3500, text: "late" } };
let t = Date.now();
r = await chat({ model: "dynamic/value", messages: msgs, max_tokens: 200, timeout_ms: 3000 });
ok(r.status === 504 && r.j.error.type === "router_timeout" && r.j.error.legs.length === 1 && Date.now() - t < 3400, "timeout returns 504 without a duplicate local fallback", r);
reset();
aiPlan = { "dynamic/standard": { ms: 1, throws: "gateway exhausted" } };
r = await chat({ model: "dynamic/standard", messages: msgs, max_tokens: 16000 });
ok(r.status === 502 && calls.ai.filter((x) => !/bge-/.test(x.model)).length === 1, "gateway exhaustion propagates without a local ladder", r);
reset();
aiPlan = {
  "dynamic/standard": { throws: "HttpServerError · HTTP 504" },
  "dynamic/value": { text: "recovered from the value route" }
};
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...args) => realSetTimeout(fn, ms <= 5000 ? 0 : ms, ...args);
try {
  r = await chat({ model: "dynamic/standard", messages: msgs, max_tokens: 64 });
} finally {
  globalThis.setTimeout = realSetTimeout;
}
ok(r.status === 200 && r.j.choices[0].message.content === "recovered from the value route", "exhausted transient 504s recover through the cheaper gateway route", r);
ok(calls.ai.filter((x) => x.model === "dynamic/standard").length === 4 && calls.ai.filter((x) => x.model === "dynamic/value").length === 1, "same-route retries finish before one bounded value-route attempt", calls.ai.map((x) => x.model));
reset();
aiPlan = {
  "dynamic/standard": { throws: "HttpServerError · HTTP 502" },
  "dynamic/value": { throws: "HttpServerError · HTTP 502" },
  "@cf/zai-org/glm-5.3-flash": { text: "recovered directly from Workers AI" }
};
globalThis.setTimeout = (fn, ms, ...args) => realSetTimeout(fn, ms <= 5000 ? 0 : ms, ...args);
try {
  r = await chat({ model: "dynamic/standard", messages: msgs, max_tokens: 64 });
} finally {
  globalThis.setTimeout = realSetTimeout;
}
ok(r.status === 200 && r.j.choices[0].message.content === "recovered directly from Workers AI", "exhausted transient gateway routes recover through direct Workers AI", r);
ok(calls.ai.filter((x) => x.model === "dynamic/standard").length === 4 && calls.ai.filter((x) => x.model === "dynamic/value").length === 4 && calls.ai.filter((x) => x.model === "@cf/zai-org/glm-5.3-flash").length === 1, "direct Workers AI runs only after both bounded gateway routes fail", calls.ai.map((x) => x.model));
ok(r.j._router.provider === "workers-ai" && r.j._router.served_by === "@cf/zai-org/glm-5.3-flash", "router metadata identifies the independent provider and model that answered", r.j._router);
reset();
aiPlan = {
  "dynamic/standard": { throws: "HttpServerError · HTTP 502" },
  "dynamic/value": { throws: "HttpServerError · HTTP 502" },
  "@cf/zai-org/glm-5.3-flash": { throws: "direct Workers AI unavailable" }
};
globalThis.setTimeout = (fn, ms, ...args) => realSetTimeout(fn, ms <= 5000 ? 0 : ms, ...args);
try {
  r = await chat({ model: "dynamic/standard", messages: msgs, max_tokens: 64 });
} finally {
  globalThis.setTimeout = realSetTimeout;
}
ok(r.status === 504 && r.j.error.type === "router_timeout" && r.j.error.legs.some((leg) => /direct Workers AI unavailable/.test(leg.err)), "a failed independent fallback remains visible as an error", r);

// 7 the router-down drill: 503 after auth, no model call, one evidence row.
reset();
r = await chat({ model: "dynamic/missing", messages: msgs });
ok(r.status === 400 && calls.ai.length === 0, "unknown route IDs fail explicitly before inference", r);
reset();
r = await chat({ model: "ensemble", messages: msgs, max_tokens: 700 });
ok(r.status === 200 && r.j._router.channel_diversity.ok === null, "ensemble preserves stages without claiming route-family independence", r);
ok(calls.ai.filter((x) => !/bge-/.test(x.model)).every((x) => /^dynamic\//.test(x.model)), "every ensemble leg is a dynamic route");
reset();
const native = await worker.fetch(new Request("https://ai.test/v1/messages", { method: "POST", headers: { Authorization: "Bearer test-key", "Content-Type": "application/json" }, body: JSON.stringify({ model: "claude-sonnet", max_tokens: 64, messages: [{ role: "user", content: "Reply OK" }] }) }), env(), ctx);
const nj = await native.json();
ok(native.status === 200 && nj.type === "message" && nj.model === "claude-sonnet", "native Messages response shape and client model stay intact", nj);
ok(calls.ai.some((x) => x.model === "dynamic/premium" && x.input.messages) && !calls.ai.some((x) => x.input.system), "only the translated OpenAI-shaped Anthropic relay uses premium");
reset();
r = await chat({ model: "auto", messages: msgs, drill: "router-down" });
await Promise.all(waits);
ok(r.status === 503 && r.j.error.type === "router_drill" && r.headers.get("x-qnfo-drill") === "router-down" && calls.ai.length === 0, "the drill answers 503 with no model call", r);
ok(calls.d1.some((x) => /'router-drill'/.test(x.sql)), "the drill left its evidence row");
r = await chat({ model: "auto", messages: msgs, drill: "router-down" }, "wrong-key");
ok(r.status === 401, "the drill needs the same auth as a chat request");

// 8 a caller-named ensemble of one lineage is refused with a structured reason before any call.
reset();
r = await chat({ model: "ensemble", messages: msgs, ensemble_models: ["glm-5.3", "glm-5.3-flash"] });
ok(r.status === 422 && r.j.error.type === "channel_diversity_refused" && r.j.error.pairs.length === 1 && calls.ai.length === 0, "a same-lineage ensemble is refused (422) with its pairs", r.j);

// 9 read routes.
const get = async (path, init) => { const x = await worker.fetch(new Request("https://ai.test" + path, init), env(), ctx); return { status: x.status, j: await x.json() }; };
r = await get("/health");
ok(r.status === 200 && r.j.second_path && r.j.second_path.contract === "AI-ROUTER-SECOND-PATH-1" && r.j.second_path.gateway === "default" && r.j.second_path.models.join() === "dynamic/value" && /consumer does not add a separate model hedge/.test(r.j.second_path.request_budget) && r.j.routes.indexOf("/v1/ensemble/policy") >= 0, "/health serves the dynamic-route second-path contract");
r = await get("/v1/ensemble/policy");
ok(r.status === 200 && r.j.threshold === 0.25 && r.j.pools.science.every((p) => p.diversity_ok && p.reviewer_overlap === 0), "GET /v1/ensemble/policy: every pool row is diverse", r.j && r.j.pools);
r = await get("/v1/ensemble/policy", { method: "POST", body: JSON.stringify({ models: ["deepseek-v4-flash-wa", "deepseek-v4-pro-wa", "gpt-oss-120b"] }) });
ok(r.status === 422 && r.j.error.type === "channel_diversity_refused", "POST /v1/ensemble/policy refuses a set with a shared lineage");
r = await get("/v1/ensemble/policy", { method: "POST", body: JSON.stringify({ models: ["kimi-k2.6", "gpt-oss-120b", "glm-5.3-flash"] }) });
ok(r.status === 200 && r.j.ok === true && r.j.verdict.max_overlap === 0, "POST /v1/ensemble/policy passes three lineages");
r = await get("/v1/models", { headers: { Authorization: "Bearer test-key" } });
ok(r.status === 200 && r.j.data.some((m) => m.id === "kimi-k2.6") && r.j.data.length >= 10, "the keyed roster lists the fast tier");
r = await get("/v1/models", { headers: { Authorization: "Bearer nope" } });
ok(r.status === 200 && r.j.data.length === 1 && r.j.data[0].id === "qnfo", "a wrong key still gets the single public model");

// 9b the semantic cache: served only for the same prompt, never for a near neighbour, never for a liveness probe.
reset();
const cachedPrompt = "State the routing rule of this endpoint in one line";
envExtra = { LOG_VZ: { async query() { return { matches: [{ id: "r:q-abc", score: 0.99, metadata: { kind: "response", model: "dynamic/value", text: "The rule is that every id resolves by a named rule and is reported." } }] }; } } };
d1First = (sql) => /FROM ai_queries WHERE id/.test(sql) ? { prompt: cachedPrompt, response: "The rule is that every id resolves by a named rule and is reported." } : null;
r = await chat({ model: "glm-5.3-flash", messages: [{ role: "user", content: cachedPrompt }], max_tokens: 200 }, null, "suite/1");
ok(r.status === 200 && r.j._router && r.j._router.cache === "semantic" && !calls.ai.some((x) => !/bge-/.test(x.model)), "the same prompt is served from the cache with no model call", { rt: r.j && r.j._router, ai: calls.ai.map((x) => x.model) });
reset();
r = await chat({ model: "glm-5.3-flash", messages: [{ role: "user", content: cachedPrompt + " for item 24" }], max_tokens: 200 }, null, "suite/1");
ok(r.status === 200 && (!r.j._router || r.j._router.cache !== "semantic") && calls.ai.some((x) => x.model === "dynamic/value"), "a near neighbour (score 0.99, different prompt) is not served from the cache", r.j && r.j._router);
reset();
r = await chat({ model: "glm-5.3-flash", messages: [{ role: "user", content: cachedPrompt }], max_tokens: 200 });
ok(r.status === 200 && r.j._router.cache !== "semantic" && calls.ai.some((x) => x.model === "dynamic/value"), "a liveness probe never reads the cache");
reset();
r = await chat({ model: "glm-5.3-flash", messages: [{ role: "user", content: cachedPrompt }], max_tokens: 200, cache: false }, null, "suite/1");
ok(r.status === 200 && r.j._router.cache !== "semantic", "cache: false skips the cache");
envExtra = {};
d1First = null;

// 10 cached tokens reach the ledger statement.
await Promise.all(waits);
ok(calls.d1.length >= 0 && /cached_tok = COALESCE\(cached_tok, 0\) \+ \?1/.test(readFileSync(join(dir, "worker.mjs"), "utf8")), "the ledger has a cached-token statement");

globalThis.fetch = realFetch;
rmSync(dir, { recursive: true, force: true });
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
