// AI-METER-COVER-3c (pillar cost, roadmap RM-COST-FREE-FIRST-PARITY-1): plAi, the one Workers AI call site of the paper-learning loop in
// qnfo-lifecycle, goes through __aiAttrEnv, so each call is an ai_call_counters row under worker qnfo-lifecycle (it was the largest fold member
// the attribution coverage metric could not see). The function and the helper are cut out of worker.js as text and run against a fake binding:
// the reply text is unchanged, an error is counted and rethrown, and a missing database leaves the call alone.
// Run: node qnfo-lifecycle/ai-meter.test.mjs
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
function fnText(name) {
  const i = src.indexOf("function " + name + "(");
  if (i < 0) return null;
  let d = 0;
  for (let k = src.indexOf("{", i); k < src.length; k++) {
    if (src[k] === "{") d++; else if (src[k] === "}") { d--; if (d === 0) return src.slice(i, k + 1); }
  }
  return null;
}
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 400) : "")); } };

const rates = src.slice(src.indexOf("var __AI_ATTR_RATES"), src.indexOf("\n", src.indexOf("var __AI_ATTR_RATES")));
const body = fnText("plAi"), helper = fnText("__aiAttrEnv");
ok(body && helper && rates, "plAi, __aiAttrEnv and the rate table are present in worker.js");
ok(/env = __aiAttrEnv\(env, "qnfo-lifecycle", "AI", "QNFO_AUDIT"\)/.test(body), "plAi rebinds env through __aiAttrEnv for worker qnfo-lifecycle and the QNFO_AUDIT database");
const { plAi } = new Function(rates + "\n" + helper + "\nasync " + body + "\nreturn { plAi };")();

const rows = [];
const db = { prepare: (sql) => ({ bind: (...a) => ({ run: async () => { rows.push({ sql, a }); } }) }) };
const seen = [];
const ai = { run: async (model, opts) => { seen.push({ model, opts }); if (opts.messages[0].content === "boom") throw new Error("3046: Request timeout"); return { response: "learned", usage: { prompt_tokens: 4000, completion_tokens: 300 } }; } };

const out = await plAi({ AI: ai, QNFO_AUDIT: db }, "@cf/zai-org/glm-5.3-flash", "read this paper", 1000);
ok(out === "learned", "the reply text is returned unchanged", out);
ok(seen.length === 1 && seen[0].opts.reasoning_effort === "low", "the call options are unchanged (glm models still get reasoning_effort low)", seen[0] && seen[0].opts);
ok(rows.length === 1 && /INSERT INTO ai_call_counters/.test(rows[0].sql) && rows[0].a[1] === "qnfo-lifecycle" && rows[0].a[2] === "@cf/zai-org/glm-5.3-flash", "one counter row under qnfo-lifecycle and the model", rows[0] && rows[0].a);
ok(rows[0].a[3] === 0 && rows[0].a[6] === 4000 && rows[0].a[7] === 300, "no error, usage tokens recorded", rows[0].a);

let threw = null;
try { await plAi({ AI: ai, QNFO_AUDIT: db }, "@cf/openai/gpt-oss-120b", "boom", 1000); } catch (e) { threw = e; }
ok(threw && /3046/.test(String(threw.message)), "a model error is rethrown", String(threw && threw.message));
ok(rows.length === 2 && rows[1].a[3] === 1, "and counted as an error", rows.map((r) => r.a[3]));

const noDb = await plAi({ AI: ai }, "@cf/zai-org/glm-5.3-flash", "read this paper", 1000);
ok(noDb === "learned" && rows.length === 2, "no database binding: the call still works and writes nothing");

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
