// AI-METER-COVER-3a (roadmap RM-COST-FREE-FIRST-PARITY-1, pillar cost, agent_issues 1001924): qnfo-model-eval runs inside qnfo-ai-calibration as a FOLD-KIT member. __foldWrap builds
// the member's env from the RAW host env, so the host's own __aiAttrEnv (installed inside the host's fetch and scheduled) never reached the member's six Workers AI call sites.
// The member's env function now returns __aiAttrEnv(env, "qnfo-model-eval", "AI", "AUDIT"): each benchmark call is one ai_call_counters row under worker qnfo-model-eval.
// Run: node --no-warnings qnfo-ai-calibration/model-eval-ai-meter.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
// cloudflare:* modules do not exist under node: each imported name becomes an empty function.
const stubbed = src.replace(/^import \{([^}]*)\} from "cloudflare:[^"]+";$/gm, (_, names) => names.split(",").map((n) => n.trim()).filter(Boolean).map((n) => { const p = n.split(/\s+as\s+/); return "function " + (p[1] || p[0]).trim() + "() {}"; }).join("\n"));
const mod = await import("data:text/javascript;base64," + Buffer.from(stubbed + "\nexport { qnfoModelEvalFoldMod as __member, __fk_qnfoModelEval_default as __wrapped };\n").toString("base64"));
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 300) : "")); } };

const W = mod.__wrapped, M = mod.__member, H = W.__foldHost;
const seen = [];
const realMemberFetch = M.fetch, realHostFetch = H.fetch;
M.fetch = async (req, env) => { seen.push({ who: "member", env }); return new Response("m"); };
H.fetch = async (req, env) => { seen.push({ who: "host", env }); return new Response("h"); };

const rows = [];
const db = { prepare: (sql) => ({ bind: (...a) => ({ run: async () => { rows.push({ sql, a }); } }) }) };
const aiCalls = [];
const ai = { run: async (model, input) => { aiCalls.push({ model, input }); if (input.fail) throw new Error("3046: Request timeout"); return { response: "x", usage: { prompt_tokens: 1000, completion_tokens: 50 } }; } };
const raw = { AI: ai, QNFO_AUDIT: db, QNFO_AI: { tag: "svc" }, __HOST_ONLY__: 1 };

await W.fetch(new Request("https://qnfo-ai-calibration.example/model-eval/health"), raw, {});
ok(seen.length === 1 && seen[0].who === "member", "GET /model-eval/health reaches the member", seen.length);
const menv = seen[0].env;
ok(menv.AI !== ai && menv.__aiAttr === 1, "the member's AI binding is the metered wrapper, not the raw binding", { sameAsRaw: menv.AI === ai, flag: menv.__aiAttr });
ok(menv.AUDIT === db && menv.QNFO_AI && !("__HOST_ONLY__" in menv), "the member still gets AUDIT and QNFO_AI only (least privilege kept)", Object.keys(menv));
await menv.AI.run("@cf/zai-org/glm-5.3-flash", { messages: [{ role: "user", content: "hi" }] });
ok(rows.length === 1 && /INSERT INTO ai_call_counters/.test(rows[0].sql), "a benchmark call is one ai_call_counters row", rows.length);
ok(rows[0].a[1] === "qnfo-model-eval" && rows[0].a[2] === "@cf/zai-org/glm-5.3-flash", "booked under worker qnfo-model-eval and the model", rows[0].a);
ok(rows[0].a[3] === 0 && rows[0].a[6] === 1000 && rows[0].a[7] === 50, "no error, usage tokens recorded", rows[0].a);
let threw = null;
try { await menv.AI.run("@cf/zai-org/glm-5.3-flash", { fail: true }); } catch (e) { threw = e; }
ok(threw && /3046/.test(String(threw.message)) && rows.length === 2 && rows[1].a[3] === 1, "a model error is rethrown to the member and counted as an error", { threw: String(threw && threw.message), rows: rows.length });
ok(aiCalls.length === 2, "every call still reached the real binding", aiCalls.length);

// a host env with no AI or no database is passed through as before (the fold suite's env has neither)
seen.length = 0;
await W.fetch(new Request("https://qnfo-ai-calibration.example/model-eval/health"), { QNFO_AUDIT: db }, {});
ok(seen[0] && seen[0].env.AI === undefined && seen[0].env.AUDIT === db, "no AI binding: the env is passed through unchanged");
seen.length = 0;
await W.fetch(new Request("https://qnfo-ai-calibration.example/model-eval/health"), { AI: ai }, {});
ok(seen[0] && seen[0].env.AI === ai, "no database binding: the raw AI binding is passed through, so the benchmark still runs");

// the source: the wrapper lives in the member block, so the call-path audit sees it
const block = /\/\/ ---- FOLD-KIT-1:qnfo-model-eval:BEGIN[^\n]*\n([\s\S]*?)\/\/ ---- FOLD-KIT-1:qnfo-model-eval:END ----/.exec(src);
ok(!!block && /__aiAttrEnv\(Object\.assign\(e, \{ AUDIT: raw\.QNFO_AUDIT \}\), "qnfo-model-eval", "AI", "AUDIT"\)/.test(block[1]), "the member's env function wraps with __aiAttrEnv inside the member block");

M.fetch = realMemberFetch; H.fetch = realHostFetch;
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
