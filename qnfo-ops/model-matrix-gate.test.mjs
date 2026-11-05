// MODEL-MATRIX-1 (agent_issues 1000708) offline suite: the decision-model tier gate runs in SHADOW mode only. No network.
// Run: node qnfo-ops/model-matrix-gate.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 400) : "")); } };
const grab = (start, end) => { const i = src.indexOf(start), j = src.indexOf(end, i); return i >= 0 && j > i ? src.slice(i, j) : ""; };

const block = grab('var MM_GATE_MODEL =', '\n__name(modelMatrixGateShadow');
ok(block.length > 500, "the shadow gate block is found in worker.js", block.length);
ok(/ctx\.waitUntil\(modelMatrixGateShadow\(env, \{ prompt, tier: _tier, model: servedBy \|\| wanted, toolCalls: toolLog\.length \}\)\)/.test(src) && /!pub && !cacheHit && !clientHandoff\) ctx\.waitUntil\(modelMatrixGateShadow/.test(src), "the chat turn calls the gate through waitUntil, never for public or cached turns, and never awaits it");

const harness = block.replace(/\n__name\w*\([^\n]*\);?/g, "") + "\nreturn { modelMatrixGateShadow, mmGateParse, MM_GATE_QUESTIONS, MM_GATE_TIERS };";
const t = new Function("iso", "WORKER", harness)(() => "2026-11-05T00:00:00.000Z", "qnfo-ops");

const mkEnv = (conf, run) => {
  const rows = [];
  const env = {
    rows, runs: [],
    WAI: { run: async (model, input) => { env.runs.push({ model, input }); return run(model, input); } },
    QNFO_AUDIT: { prepare(sql) { let b = []; const s = { bind(...x) { b = x; return s; }, async all() { return { results: Object.entries(conf).map(([key, value]) => ({ key, value })) }; }, async run() { rows.push({ sql, b }); return {}; } }; return s; } },
  };
  return env;
};
const clef = (label, p) => async () => ({ answers: { tier: { type: "choice", choice: label, confidence: 0.8 }, needs_tools: { type: "noul", noul: p } }, usage: { input_tokens: 123 } });

// parse
let g = t.mmGateParse({ answers: { tier: { type: "choice", choice: "Free_Small" }, needs_tools: { type: "noul", noul: 0.9 } } });
ok(g.tier === "free_small" && g.needs_tools === 0.9, "mmGateParse reads a choice and a noul answer", g);
g = t.mmGateParse({ answers: { tier: { choice: "something else" }, needs_tools: 0.2 } });
ok(g.tier === null && g.needs_tools === 0.2, "an unknown label is no tier, a bare number is a probability", g);
ok(t.mmGateParse(null).tier === null && t.mmGateParse({}).needs_tools === null, "an empty answer parses to nothing");
ok(Object.keys(t.MM_GATE_QUESTIONS.tier.criteria).join() === "free_small,cheap_mid,frontier" && t.MM_GATE_QUESTIONS.needs_tools.type === "noul", "the two questions are the tier choice and the needs_tools noul of the issue");

// shadow row
let env = mkEnv({}, clef("free_small", 0.1));
let r = await t.modelMatrixGateShadow(env, { prompt: "what is the state of the fleet right now?", tier: 1, model: "@cf/zai-org/glm-5.3-flash", toolCalls: 0 });
ok(r.agree === 1 && r.tools_agree === 1 && env.rows.length === 1 && env.runs[0].model === "@cf/cloudflare/clef-flash" && env.runs[0].input.model === "clef-flash" && env.runs[0].input.state.startsWith("what is the state"), "default mode is shadow: one clef-flash call and one row", [r, env.runs, env.rows.length]);
let b = env.rows[0].b;
ok(/cost_router_metrics/.test(env.rows[0].sql) && b[2] === "gate-decision-shadow" && b[3] === 1 && b[4] === "@cf/zai-org/glm-5.3-flash" && b[5] === 123 && b[7] === 0 && b[8] === 1 && b[9] === 1, "the row records task_class, predicted tier, the model that served, input tokens, tool calls, tool agreement and tier agreement", b);
env = mkEnv({}, clef("frontier", 0.9));
r = await t.modelMatrixGateShadow(env, { prompt: "plan and write the migration for the new table", tier: 2, model: "deepseek-v4-flash", toolCalls: 3 });
b = env.rows[0].b;
ok(r.agree === 0 && r.tools_agree === 1 && b[3] === 3 && b[9] === 0 && b[8] === 1, "a disagreement is success 0, and needs_tools >= 0.5 agrees with a turn that called tools", [r, b]);
env = mkEnv({}, async () => ({ answers: {} }));
r = await t.modelMatrixGateShadow(env, { prompt: "a question the model cannot place", tier: 1, model: "m", toolCalls: 0 });
b = env.rows[0].b;
ok(r.agree === 0 && b[3] === 0 && b[8] === 0 && b[9] === 0, "no parseable answer is logged as tier 0 and no agreement, not dropped", [r, b]);

// switches and safety
env = mkEnv({ model_matrix_gate: "off" }, clef("free_small", 0));
r = await t.modelMatrixGateShadow(env, { prompt: "anything at all here", tier: 1, model: "m", toolCalls: 0 });
ok(r.skipped === "off" && env.runs.length === 0 && env.rows.length === 0, "ops_config model_matrix_gate = off makes no call and writes nothing", r);
env = mkEnv({ model_matrix_gate_rate: "0" }, clef("free_small", 0));
r = await t.modelMatrixGateShadow(env, { prompt: "anything at all here", tier: 1, model: "m", toolCalls: 0 });
ok(r.skipped === "sampled-out" && env.runs.length === 0, "rate 0 samples everything out", r);
env = mkEnv({}, clef("free_small", 0));
r = await t.modelMatrixGateShadow(env, { prompt: "hi", tier: 1, model: "m", toolCalls: 0 });
ok(r.skipped === "short" && env.runs.length === 0, "a prompt under 8 characters is skipped", r);
env = mkEnv({}, async () => { throw new Error("AiError: model unavailable"); });
r = await t.modelMatrixGateShadow(env, { prompt: "a normal question about the fleet", tier: 1, model: "m", toolCalls: 0 });
ok(r.skipped === "error" && env.rows.length === 0, "a failing decision model never throws into the turn", r);
env = mkEnv({}, clef("free_small", 0));
delete env.WAI;
r = await t.modelMatrixGateShadow(env, { prompt: "a normal question about the fleet", tier: 1, model: "m", toolCalls: 0 });
ok(r.skipped === "no-binding", "no Workers AI binding is a skip", r);
env = mkEnv({}, clef("free_small", 0));
env.QNFO_AUDIT.prepare = () => { throw new Error("D1_ERROR: overloaded"); };
r = await t.modelMatrixGateShadow(env, { prompt: "a normal question about the fleet", tier: 1, model: "m", toolCalls: 0 });
ok(r.skipped === "error", "a D1 failure is swallowed", r);

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
