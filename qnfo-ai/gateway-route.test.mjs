// GATEWAY-ROUTE-ALL-1 offline suite for the qnfo-ai binding wrapper (BP26-AI-GATEWAY-BUDGETS-1 #1000614, RM-DSH-CACHE-1 #1000795).
// Run: node qnfo-ai/gateway-route.test.mjs   -> prints "N passed, 0 failed"
// A binding call with no gateway option is invisible to AI Gateway (gateway_coverage 0.5377 on 2026-11-04: 38,042 of 79,144 inferences in 7 days).
// The wrapper adds the gateway option to embeddings and to text calls under the 1 KB prefix-cache bound, keeps long prompts on the direct path with their
// x-session-affinity key, retries a gateway infrastructure failure once on the plain binding, never retries a spend or model refusal that way, and stops
// when ops_config router_gateway_route = off.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
let failed = 0, passed = 0;
function ok(c, m, x) { if (c) passed++; else { failed++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 300) : "")); } }

const src = readFileSync(join(here, "worker.js"), "utf8");
const start = src.indexOf("function __aiAttrEnv(");
const end = src.indexOf("\n// AIG-CALLER-METADATA-1", start);
ok(start > 0 && end > start, "binding wrapper and gateway helpers found in worker.js");
const slice = src.slice(start, end);
ok(slice.includes("function __gwRouteOpts(") || slice.includes("async function __gwRouteOpts("), "the gateway routing helper sits inside the wrapper slice");

function makeWrap(opts = {}) {
  const logs = [];
  const ctx = vm.createContext({
    SPEND_CHEAP_WA: "@cf/cheap/model",
    __AI_ATTR_RATES: {},
    d1AttrWriteSkip: () => opts.skipD1 !== false,
    d1OverloadTrip: () => false,
    setTimeout: (fn) => { queueMicrotask(fn); return 1; },
    clearTimeout() {},
    console: { log() {}, error(m) { logs.push(m); } }
  });
  vm.runInContext(slice + "\nthis.wrapAI = __aiAttrEnv;", ctx);
  const calls = [];
  const db = opts.db;
  const env = { AI: { async run(model, input, o) { calls.push({ model, input, opts: o }); return opts.run ? opts.run(model, input, o, calls.length) : { response: "ok" }; } }, ...(db ? { QNFO_AUDIT: db } : {}) };
  const wrapped = ctx.wrapAI(env, "qnfo-ai", "AI", "QNFO_AUDIT");
  return { calls, ai: wrapped.AI, ctx, logs };
}

const short = { messages: [{ role: "user", content: "say hi" }] };
const long = { messages: [{ role: "system", content: "x".repeat(1500) }, { role: "user", content: "q" }] };

// 1. a short text call goes through the gateway, uncached, with attribution metadata
{
  const w = makeWrap();
  await w.ai.run("@cf/zai-org/glm-5.3-flash", short);
  const g = w.calls[0] && w.calls[0].opts && w.calls[0].opts.gateway;
  ok(w.calls.length === 1 && g && g.id === "default" && g.skipCache === true && !("cacheTtl" in g), "short text call: one call through gateway default with skipCache", g);
  ok(g && g.metadata && g.metadata.worker === "qnfo-ai" && g.metadata.purpose === "binding", "the gateway log entry carries worker=qnfo-ai and a purpose", g);
  ok(w.calls[0].opts && !w.calls[0].opts.extraHeaders, "a short call carries no session-affinity key (nothing to preserve)");
}
// 2. a long prompt stays direct and keeps its prefix-cache affinity key
{
  const w = makeWrap();
  await w.ai.run("@cf/zai-org/glm-5.3-flash", long);
  const o = w.calls[0].opts;
  ok(w.calls.length === 1 && o && !o.gateway && o.extraHeaders && /^pc-/.test(o.extraHeaders["x-session-affinity"]), "long prompt: direct, with x-session-affinity", o);
}
// 3. embeddings: gateway with a 24 h cache
{
  const w = makeWrap();
  await w.ai.run("@cf/baai/bge-base-en-v1.5", { text: ["a", "b"] });
  const g = w.calls[0].opts && w.calls[0].opts.gateway;
  ok(g && g.id === "default" && g.cacheTtl === 86400 && !("skipCache" in g) && g.metadata.purpose === "binding-embed", "embedding call: gateway with cacheTtl 86400", g);
}
// 4. calls that must not change
{
  const stream = makeWrap(); await stream.ai.run("@cf/zai-org/glm-5.3-flash", { ...short, stream: true });
  ok(!(stream.calls[0].opts && stream.calls[0].opts.gateway), "a streamed call stays direct");
  const own = { gateway: { id: "other" } };
  const explicit = makeWrap(); await explicit.ai.run("@cf/zai-org/glm-5.3-flash", short, own);
  ok(explicit.calls[0].opts === own, "a caller's own gateway options pass through unchanged (same object)");
  const raw = makeWrap(); await raw.ai.run("@cf/zai-org/glm-5.3-flash", short, { returnRawResponse: true });
  ok(!(raw.calls[0].opts && raw.calls[0].opts.gateway), "returnRawResponse stays direct");
  const dyn = makeWrap(); await dyn.ai.run("dynamic/standard", short);
  ok(dyn.calls[0].opts === undefined, "a dynamic route id is not rewritten");
  const prov = makeWrap(); await prov.ai.run("deepseek-chat", short);
  ok(prov.calls[0].opts === undefined, "a non-@cf model id is not rewritten");
  for (const m of ["@cf/openai/whisper", "@cf/black-forest-labs/flux-1-schnell", "@cf/deepgram/aura-2-en"]) {
    const x = makeWrap(); await x.ai.run(m, { prompt: "a cat" });
    ok(!(x.calls[0].opts && x.calls[0].opts.gateway), "media model " + m + " stays direct");
  }
  const img = makeWrap(); await img.ai.run("@cf/google/gemma-4-26b-a4b-it", { messages: [{ role: "user", content: "what is this" }], image: [1, 2, 3] });
  ok(!(img.calls[0].opts && img.calls[0].opts.gateway), "a call with an image input stays direct");
  const noPrompt = makeWrap(); await noPrompt.ai.run("@cf/zai-org/glm-5.3-flash", {});
  ok(!(noPrompt.calls[0].opts && noPrompt.calls[0].opts.gateway), "an input without messages or prompt stays direct");
}
// 5. a gateway infrastructure failure retries once on the plain binding
{
  const w = makeWrap({ run: (m, i, o, n) => { if (o && o.gateway) throw new Error("AiGateway: upstream connect error, gateway unavailable"); return { response: "plain" }; } });
  const r = await w.ai.run("@cf/zai-org/glm-5.3-flash", short);
  ok(r.response === "plain" && w.calls.length === 2 && w.calls[0].opts.gateway && !w.calls[1].opts, "a gateway failure retries once on the plain binding", w.calls.map((c) => !!(c.opts && c.opts.gateway)));
}
// 6. a spend or capacity refusal is rethrown, not retried around the gateway
{
  const w = makeWrap({ run: () => { throw new Error("Gateway spend limit exceeded for provider workers-ai"); } });
  let err = null;
  try { await w.ai.run("@cf/cheap/model", short); } catch (e) { err = e; }
  ok(err && /spend limit/.test(err.message) && w.calls.length === 1, "a gateway spend-limit refusal is not retried on the plain binding", w.calls.length);
}
{
  const w = makeWrap({ run: () => { throw new Error("InferenceUpstreamError: 3040: Capacity temporarily exceeded"); } });
  let err = null;
  try { await w.ai.run("@cf/cheap/model", short); } catch (e) { err = e; }
  ok(err && /3040/.test(err.message) && w.calls[0].opts.gateway && w.calls.slice(1).every((c) => !(c.opts && c.opts.gateway)), "a capacity error keeps the existing retry path (plain binding), never a second gateway-infrastructure retry", w.calls.length);
}
// 7. the kill switch in ops_config
const dbWith = (value, fail) => ({ prepare() { const s = { bind() { return s; }, async run() { return {}; }, async first() { if (fail) throw new Error("D1 overloaded"); return value == null ? null : { value }; } }; return s; } });
{
  const off = makeWrap({ skipD1: false, db: dbWith("off") });
  await off.ai.run("@cf/zai-org/glm-5.3-flash", short);
  ok(!(off.calls[0].opts && off.calls[0].opts.gateway), "ops_config router_gateway_route = off keeps the call direct");
  const on = makeWrap({ skipD1: false, db: dbWith("on") });
  await on.ai.run("@cf/zai-org/glm-5.3-flash", short);
  ok(on.calls[0].opts && on.calls[0].opts.gateway, "ops_config router_gateway_route = on routes through the gateway");
  const absent = makeWrap({ skipD1: false, db: dbWith(null) });
  await absent.ai.run("@cf/zai-org/glm-5.3-flash", short);
  ok(absent.calls[0].opts && absent.calls[0].opts.gateway, "no ops_config row: default is on");
  const broken = makeWrap({ skipD1: false, db: dbWith(null, true) });
  await broken.ai.run("@cf/zai-org/glm-5.3-flash", short);
  ok(broken.calls[0].opts && broken.calls[0].opts.gateway, "an unreadable ops_config (D1 overload) keeps the last value (on)");
}
// 8. the caller's input object is never mutated
{
  const w = makeWrap();
  const input = { messages: [{ role: "user", content: "hi" }] };
  const snapshot = JSON.stringify(input);
  const o = { temperature: 0 };
  await w.ai.run("@cf/zai-org/glm-5.3-flash", input, o);
  ok(JSON.stringify(input) === snapshot && !("gateway" in o) && w.calls[0].opts !== o && w.calls[0].opts.temperature === 0, "the caller's input and options are not mutated; other options are kept");
}

console.log(passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
