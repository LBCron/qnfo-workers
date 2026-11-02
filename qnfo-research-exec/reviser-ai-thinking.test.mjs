// The reviser's aiText is shared by this host and qnfo-paper-reviser. Keep model-specific reasoning controls in both copies.
// Proves: DeepSeek gets thinking:false, Zai GLM gets low reasoning effort, other models are unchanged, and response extraction is preserved.
// Run: node qnfo-research-exec/reviser-ai-thinking.test.mjs   (exit 0 = all passed)
import { readFileSync } from "node:fs";
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 300) : "")); } };
const host = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const guest = readFileSync(new URL("../qnfo-paper-reviser/worker.js", import.meta.url), "utf8");
const fnOf = (s) => { const i = s.indexOf("async function aiText(env, prompt, model, maxTokens)"); const j = s.indexOf("__name(aiText", i); return s.slice(i, j); };
ok(fnOf(host).length > 200 && fnOf(host) === fnOf(guest), "the host and the guest carry the same aiText", fnOf(host).length);
const load = (s) => new Function("MODEL", "__name", "attributeAiCall", "return (" + fnOf(s).replace(/^async function aiText/, "async function") + ")")("@cf/default/model", (f) => f, () => {});
for (const [name, src] of [["host", host], ["guest", guest]]) {
  let fn;
  try { fn = load(src); } catch (e) { ok(false, name + " aiText loads standalone", String(e)); continue; }
  const seen = [];
  const env = { AI: { run: async (m, body, opts) => { seen.push({ m, body, opts }); return { response: "hello" }; } } };
  const t1 = await fn(env, "p", "@cf/deepseek-ai/deepseek-v4-pro", 100);
  const t2 = await fn(env, "p", "@cf/zai-org/glm-5.3", 100);
  const t3 = await fn(env, "p", "@cf/openai/gpt-oss-120b", 100);
  ok(seen[0].body.chat_template_kwargs && seen[0].body.chat_template_kwargs.thinking === false, name + ": a deepseek model gets thinking:false", seen[0].body);
  ok(seen[1].body.reasoning_effort === "low" && !("chat_template_kwargs" in seen[1].body), name + ": a Zai GLM model gets low reasoning effort", seen[1].body);
  ok(!("chat_template_kwargs" in seen[2].body) && !("reasoning_effort" in seen[2].body) && seen[2].body.max_tokens === 100 && seen[2].body.messages[0].content === "p", name + ": another model's body is unchanged", seen[2].body);
  ok(seen[0].opts && seen[0].opts.gateway && seen[0].opts.gateway.id === "default", name + ": the gateway option is still passed", seen[0].opts);
  ok(t1 === "hello" && t2 === "hello" && t3 === "hello", name + ": the text is still extracted", [t1, t2, t3]);
}
ok(/var VERSION = "0\.(28\.[3-9]|29|[3-9]\d)|var VERSION = "[1-9]/.test(host), "the host VERSION is at least 0.28.3 (a minimum)");
console.log("reviser-ai-thinking: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
