// SPEND-GATEWAY-CF-PRICE-1 (#6980): a @cf/ model priced through provider gateway must use Workers AI neuron rates, not the GPT-5.5 "*" rate.
import { readFileSync } from "node:fs";
import vm from "node:vm";
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const grab = (re) => { const m = re.exec(src); if (!m) throw new Error("not found: " + re); return m[0]; };
const code = [
  grab(/var __AI_ATTR_RATES = \{[^\n]*\};/),
  grab(/var SPEND_WA_FALLBACK_RATE = [^\n]*;/),
  grab(/var SPEND_GATEWAY_CF_RATES = [^\n]*;/),
  grab(/var SPEND_NEURON_USD = [^\n]*;/),
  grab(/var SPEND_PRICES = \{[\s\S]*?\n\};/),
  grab(/function spendUsd\(provider, model, inTok, outTok\) \{[\s\S]*?\n\}/),
].join("\n");
const ctx = vm.createContext({});
vm.runInContext(code + "\nthis.spendUsd = spendUsd;", ctx);
let ok = 0, bad = 0;
const t = (name, cond, info) => { if (cond) { ok++; } else { bad++; console.log("FAIL " + name, info === undefined ? "" : info); } };
const llama = ctx.spendUsd("gateway", "@cf/meta/llama-3.2-3b-instruct", 752253, 144684);
t("llama-3.2-3b through the gateway costs under 1 USD", llama < 1, llama);
const qwen = ctx.spendUsd("gateway", "@cf/qwen/qwen3-30b-a3b-fp8", 610253, 62762);
t("qwen3-30b through the gateway costs under 1 USD", qwen < 1, qwen);
t("gateway @cf/ equals the workers-ai price of the same model", Math.abs(ctx.spendUsd("gateway", "@cf/openai/gpt-oss-120b", 1e6, 1e5) - ctx.spendUsd("workers-ai", "@cf/openai/gpt-oss-120b", 1e6, 1e5)) < 1e-9);
t("a non-@cf gateway model still uses the gateway table", ctx.spendUsd("gateway", "openai/gpt-5.5", 1e6, 1e6) > 30);
console.log(ok + " passed, " + bad + " failed");
process.exit(bad ? 1 : 0);
