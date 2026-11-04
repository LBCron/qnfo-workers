// AI-METER-COVER-1 (2026-11-04, agent_issues 1001705): every worker that calls env.AI.run with qnfo-audit bound wraps its AI binding
// with __aiAttrEnv, so each call lands in ai_call_counters under the worker's name. This test checks the six workers added on
// 2026-11-04 carry the helper and the env rebinding in every entry handler, and runs the helper itself against a fake binding:
// the result passes through unchanged, one counter row is written per call, an error is counted and rethrown, and a missing
// database leaves env untouched.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const TARGETS = {
  "qnfo-gateway": ["AUDIT", 2],
  "qnfo-ai-calibration": ["QNFO_AUDIT", 2],
  "qnfo-intent-orchestrator": ["D1", 2],
  "qnfo-infra": ["AUDIT", 2],
  "qnfo-memory-mcp": ["AUDIT", 1],
  "qnfo-youtube-shorts": ["QNFO_AUDIT", 2],
};
let pass = 0;
for (const [dir, [db, handlers]] of Object.entries(TARGETS)) {
  const src = readFileSync(new URL("../" + dir + "/worker.js", import.meta.url), "utf8");
  const mirror = readFileSync(new URL("../" + dir + "/deployed-current.worker.js", import.meta.url), "utf8");
  assert.ok(src.includes("WORKERS-AI-ATTRIBUTION-1"), dir + ": helper missing");
  const calls = src.split('env = __aiAttrEnv(env, "' + dir + '", "AI", "' + db + '");').length - 1;
  assert.equal(calls, handlers, dir + ": expected " + handlers + " handler rebinding(s), found " + calls);
  assert.equal(src, mirror, dir + ": deployed-current.worker.js differs from worker.js");
  pass++;
}

// Run the helper from one worker (they are byte-identical copies of scripts/ai-attr-env-patch.py HELPER).
const src = readFileSync(new URL("../qnfo-gateway/worker.js", import.meta.url), "utf8");
const start = src.indexOf("var __AI_ATTR_RATES");
const end = src.indexOf("\n}\n", src.indexOf("function __aiAttrEnv")) + 3;
const __aiAttrEnv = new Function(src.slice(start, end) + "\nreturn __aiAttrEnv;")();
const rows = [];
const db = { prepare: (sql) => ({ bind: (...a) => ({ run: async () => { rows.push({ sql, a }); } }) }) };
const ai = { run: async (model, input) => { if (input.fail) throw new Error("3046: Request timeout"); return { response: "ok", usage: { prompt_tokens: 1000, completion_tokens: 100 } }; }, other: () => "x" };
const env = { AI: ai, AUDIT: db };
const wrapped = __aiAttrEnv(env, "qnfo-gateway", "AI", "AUDIT");
assert.notEqual(wrapped, env, "a wrapped copy is returned");
assert.equal(env.AI, ai, "the original env is never mutated");
assert.equal(__aiAttrEnv(wrapped, "qnfo-gateway", "AI", "AUDIT"), wrapped, "wrapping twice is a no-op");
assert.deepEqual(await wrapped.AI.run("@cf/moonshotai/kimi-k2.6", { messages: [] }), { response: "ok", usage: { prompt_tokens: 1000, completion_tokens: 100 } });
assert.equal(rows.length, 1, "one counter row per call");
assert.match(rows[0].sql, /INSERT INTO ai_call_counters/);
assert.equal(rows[0].a[1], "qnfo-gateway");
assert.equal(rows[0].a[2], "@cf/moonshotai/kimi-k2.6");
assert.ok(Math.abs(rows[0].a[8] - (1000 * 86364 + 100 * 363636) / 1e6) < 1e-6, "neurons from usage x published rate");
await assert.rejects(wrapped.AI.run("@cf/zai-org/glm-5.3-flash", { fail: true }), /3046/);
assert.equal(rows.length, 2, "a failed call is counted");
assert.equal(rows[1].a[3], 1, "and marked as an error");
assert.equal(wrapped.AI.other(), "x", "other binding methods pass through");
const noDb = { AI: ai };
assert.equal(__aiAttrEnv(noDb, "qnfo-memory-mcp", "AI", "AUDIT"), noDb, "no database: env is returned as is");
pass++;
console.log("ai-attr-cover: " + pass + " passed, 0 failed");
