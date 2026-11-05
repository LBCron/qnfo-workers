// AI-METER-COVER-3b (roadmap RM-COST-FREE-FIRST-PARITY-1, pillar cost, agent_issues 1001926): the three Workers AI call sites of qnfo-fleet-dashboard (the Ask panel,
// the command path and the Lee tool loop) go through __aiAttrEnv, so each call is one ai_call_counters row under worker qnfo-fleet-dashboard. Before this the dashboard
// was invisible to workers_ai_attribution_coverage_pct. The call itself is unchanged: the same reply comes back, an error is rethrown, a missing database leaves the call alone.
// Run: node qnfo-fleet-dashboard/ai-meter.test.mjs   -> prints "N passed, 0 failed"
import fs from "node:fs";
const src = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const toml = fs.readFileSync(new URL("./wrangler.toml", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? "  -- " + JSON.stringify(x).slice(0, 400) : "")); } };

const block = /\/\/ WORKERS-AI-ATTRIBUTION-1[\s\S]*?\nfunction __aiAttrEnv\([\s\S]*?\n\}\n/.exec(src);
ok(!!block, "the WORKERS-AI-ATTRIBUTION-1 block (__AI_ATTR_RATES and __aiAttrEnv) is in worker.js");
const lib = new Function((block ? block[0] : "") + "\nreturn { __aiAttrEnv };")();

// the wrapper, on fakes
const rows = [];
const db = { prepare: (sql) => ({ bind: (...a) => ({ run: async () => { rows.push({ sql, a }); } }) }) };
const calls = [];
const ai = { run: async (model, input) => { calls.push({ model, input }); if (input.fail) throw new Error("3046: Request timeout"); return { response: "pong", usage: { prompt_tokens: 2000, completion_tokens: 100 } }; }, other: () => "x" };
const env0 = { AI: ai, AUDIT: db, KEEP: 1 };
const env = lib.__aiAttrEnv(env0, "qnfo-fleet-dashboard", "AI", "AUDIT");
ok(env !== env0 && env0.AI === ai && !env0.__aiAttr, "the wrapper returns a copy and never mutates the env it was given");
ok(env.KEEP === 1 && env.AUDIT === db && env.__aiAttr === 1, "the copy keeps every other binding");
ok(lib.__aiAttrEnv(env, "qnfo-fleet-dashboard", "AI", "AUDIT") === env, "wrapping twice returns the same env (no double count)");
const r = await env.AI.run("@cf/zai-org/glm-5.3-flash", { messages: [{ role: "user", content: "hi" }] });
ok(r.response === "pong", "the reply comes back unchanged", r);
ok(calls.length === 1 && calls[0].model === "@cf/zai-org/glm-5.3-flash", "one model call", calls.length);
ok(rows.length === 1 && /INSERT INTO ai_call_counters/.test(rows[0].sql), "one counter row per call", rows.length);
ok(rows[0].a[1] === "qnfo-fleet-dashboard" && rows[0].a[2] === "@cf/zai-org/glm-5.3-flash", "booked under qnfo-fleet-dashboard and the model", rows[0].a);
ok(rows[0].a[3] === 0 && rows[0].a[6] === 2000 && rows[0].a[7] === 100, "no error, usage tokens recorded", rows[0].a);
ok(Math.abs(rows[0].a[8] - (2000 * 13636 + 100 * 45455) / 1e6) < 0.01, "neurons from the usage tokens at the published glm-5.3-flash rate", rows[0].a[8]);
ok(env.AI.other() === "x", "other binding members still work");
let threw = null;
try { await env.AI.run("@cf/zai-org/glm-5.3-flash", { fail: true }); } catch (e) { threw = e; }
ok(threw && /3046/.test(String(threw.message)) && rows.length === 2 && rows[1].a[3] === 1, "a model error is rethrown and counted as an error", { threw: String(threw && threw.message), rows: rows.length });
const noDb = lib.__aiAttrEnv({ AI: ai }, "qnfo-fleet-dashboard", "AI", "AUDIT");
ok(noDb.AI === ai, "no database binding: the AI binding is left alone and the call still works");

// the dashboard source: the wrapper is installed first in both handlers, so every call site below sees the wrapped binding
ok(/class \w+[^{]*\{[\s\S]{0,60}?async fetch\(request, env, ctx\) \{\n\s*env = __aiAttrEnv\(env, "qnfo-fleet-dashboard", "AI", "AUDIT"\);/.test(src) || /async fetch\(request, env, ctx\) \{\n\s*env = __aiAttrEnv\(env, "qnfo-fleet-dashboard", "AI", "AUDIT"\);/.test(src), "fetch installs __aiAttrEnv as its first line");
ok(/async scheduled\(controller, env, ctx\) \{\n\s*env = __aiAttrEnv\(env, "qnfo-fleet-dashboard", "AI", "AUDIT"\);/.test(src), "scheduled installs __aiAttrEnv as its first line");
ok(/^binding = "AUDIT"$/m.test(toml) && /^\[ai\]/m.test(toml), "wrangler.toml binds AUDIT (the qnfo-audit D1) and the AI binding");
ok((src.match(/\bAI\.run\(/g) || []).length >= 3, "the three call sites are still in the file (the wrapper must reach each)");
ok((src.match(/^var __AI_ATTR_RATES = /gm) || []).length === 1 && (src.match(/^function __aiAttrEnv\(/gm) || []).length === 1, "the block is present exactly once");
ok(!/catch \(e\d?\) \{\s*\}/.test(block ? block[0] : ""), "the helper's catch blocks log instead of swallowing (WORKERS-STANDARDS-GUARD-1)");

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
