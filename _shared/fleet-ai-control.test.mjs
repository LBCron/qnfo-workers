import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("./fleet-ai-control.js", import.meta.url), "utf8");
const context = vm.createContext({ Request, Response, Headers, URL, console, setTimeout, clearTimeout,
  FLEET_AI_AUDIT_BINDING: "AUDIT", FLEET_AI_WORKER: "test-worker" });
vm.runInContext(source, context);
let state = { paused: 0, revision: 1 }, primaryReads = 0, calls = 0;
const env = { AUDIT: { withSession(mode) {
  assert.equal(mode, "first-primary");
  primaryReads++;
  return { prepare(sql) {
    assert.equal(sql, "SELECT paused, revision FROM fleet_ai_control WHERE id=1");
    return { async first() { return state; } };
  } };
} } };
const binding = { async run() { assert.equal(this, binding); calls++; return "result"; } };
assert.equal(await context.fleetAiRun(env, binding, "model", {}), "result");
assert.equal(primaryReads, 1);
state = { paused: 1, revision: 2 };
await assert.rejects(context.fleetAiRun(env, binding, "model", {}), e => e.code === "ai_paused" && !e.retryable);
assert.equal(calls, 1, "pause after first invocation stops a second dispatch in the SAME request");
assert.equal(primaryReads, 2, "allows are never cached across retries");
assert.equal(await context.fleetAiBackground(env), false);
for (const row of [null, {}, { paused: "0", revision: 2 }, { paused: 0, revision: -1 }, { paused: 0, revision: 1.1 }]) {
  state = row;
  await assert.rejects(context.fleetAiRun(env, binding, "model", {}), e => e.code === "ai_control_unavailable");
}
await assert.rejects(context.fleetAiRun({}, binding, "model", {}), e => e.code === "ai_control_unavailable");
await assert.rejects(context.fleetAiRun({ AUDIT: { withSession() { throw new Error("database down"); } } }, binding), e => e.code === "ai_control_unavailable");
state = { paused: 0, revision: 3 };
assert.equal(await context.fleetAiRun(env, binding, "model", {}), "result", "explicit resume admits future work");
assert.equal(calls, 2, "resume does not replay denied invocations");
let providerCalls = 0;
const provider = async (input, init) => { providerCalls++; return new Request(input, init); };
const gateway = "https://gateway.ai.cloudflare.com/v1/account/default/compat/chat/completions";
const request = await context.fleetAiFetch(env, provider, gateway, { method: "POST", body: '{"messages":[]}' });
assert.equal(await request.text(), '{"messages":[]}');
assert.equal(JSON.parse(request.headers.get("cf-aig-metadata")).worker, "test-worker");
state = { paused: 1, revision: 4 };
for (const url of [gateway, "https://api.deepseek.com/v1/chat/completions",
  "https://api.cloudflare.com/client/v4/accounts/a/ai/run/@cf/model",
  "https://api.cloudflare.com/client/v4/accounts/a/autorag/rags/x/ai-search",
  "https://api.cloudflare.com/client/v4/accounts/a/browser-rendering/markdown"]) {
  await assert.rejects(context.fleetAiFetch(env, provider, url), e => e.code === "ai_paused");
}
assert.equal(providerCalls, 1);
await context.fleetAiFetch(env, provider, "https://api.cloudflare.com/client/v4/accounts/a/workers/scripts");
assert.equal(providerCalls, 2, "non-AI management reads remain usable during pause");
const res = context.fleetAiResponse(Object.assign(new Error(), { code: "ai_paused" }));
assert.equal(res.status, 503);
assert.equal(res.headers.get("cache-control"), "no-store");
let serviceCalls = 0;
const service = { async fetch() { serviceCalls++; return res; } };
await assert.rejects(context.fleetAiServiceFetch(env, service, "https://ai/infer"), e => e.code === "ai_paused");
assert.equal(serviceCalls, 0, "internal AI services are checked before dispatch");
state = { paused: 0, revision: 5 };
await assert.rejects(context.fleetAiServiceFetch(env, service, "https://ai/infer"), e => e.code === "ai_paused" && !e.retryable);
assert.equal(serviceCalls, 1, "an upstream pause propagates terminally even if local state now reads running");
let retryCalls = 0;
const pauseDuringGatewayCall = async () => {
  retryCalls++;
  state = { paused: 1, revision: 6 };
  return new Response("transient provider failure", { status: 503 });
};
await assert.rejects(context.fleetAiFetch(env, pauseDuringGatewayCall, gateway), e => e.code === "ai_paused");
assert.equal(retryCalls, 1, "Gateway retry must re-read control, not re-dispatch after a mid-flight pause");
console.log("fleet AI gate: primary reads, per-dispatch pause/resume, fail-closed, REST, metadata, no replay passed");
