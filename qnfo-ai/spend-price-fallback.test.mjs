// SPEND-PRICE-FALLBACK-1 (#7026): spendPriceFallback says when spendUsd prices a model from a catch-all rate, and spendRecord counts it
// in ai_call_counters (purpose spend-price-fallback, by model) without changing the price. Run: node qnfo-ai/spend-price-fallback.test.mjs
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
  grab(/function spendPriceFallback\(provider, model\) \{[\s\S]*?\n\}/),
].join("\n");
const ctx = vm.createContext({});
vm.runInContext(code + "\nthis.spendUsd = spendUsd; this.spendPriceFallback = spendPriceFallback; this.known = Object.keys(__AI_ATTR_RATES)[0];", ctx);
let ok = 0, bad = 0;
const t = (name, cond, info) => { if (cond) { ok++; } else { bad++; console.log("FAIL " + name, info === undefined ? "" : JSON.stringify(info)); } };

t("a model absent from every table is fallback-priced (workers-ai)", ctx.spendPriceFallback("workers-ai", "@cf/nobody/unknown-model") === true);
t("a model absent from every table is fallback-priced (gateway @cf/)", ctx.spendPriceFallback("gateway", "@cf/nobody/unknown-model") === true);
t("a model with a neuron rate is not fallback-priced", ctx.spendPriceFallback("workers-ai", ctx.known) === false, ctx.known);
t("a gateway @cf/ model with its own rate is not fallback-priced", ctx.spendPriceFallback("gateway", "@cf/meta/llama-3.2-3b-instruct") === false);
t("an unlisted gateway model falls to the \"*\" entry and is flagged", ctx.spendPriceFallback("gateway", "vendor/never-listed-model") === true);
t("pricing is unchanged by the flag", ctx.spendUsd("gateway", "vendor/never-listed-model", 1e6, 1e6) > 30);

// spendRecord writes the counter only for a fallback-priced call, after the ledger row, and a counter failure never breaks the ledger write.
const start = src.indexOf("function spendRecord(");
const end = src.indexOf("\nfunction spendUsageOf(", start);
t("spendRecord found", start >= 0 && end > start);
const body = src.slice(start, end);
t("spendRecord guards the counter with spendPriceFallback and calls", /if \(calls && typeof spendPriceFallback === "function" && spendPriceFallback\(provider, model\)\)/.test(body));
t("the counter statement names the purpose and is telemetry only", body.includes("'spend-price-fallback'") && !/spend-price-fallback[\s\S]{0,400}usd\s*=/.test(body));

console.log(ok + " passed, " + bad + " failed");
process.exit(bad ? 1 : 0);
