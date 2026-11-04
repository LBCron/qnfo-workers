// AI-ATTR-FAILED-FREE-1 (qnfo-research-exec 0.49.0, pillar cost): the per-call attribution wrapper wrote an input-token estimate as neurons for a
// call that THREW, so ai_call_counters counted spend Cloudflare never billed: glm-5.3-flash over 2026-11-01..03 read 1.56M neurons in the counters
// and 1.26M on the Cloudflare meter (research-exec alone had 417 and 262 failed glm-5.3-flash calls on 11-02 and 11-03). research_daily_neurons reads
// the counters, so the gate throttled on phantom spend. A failed call is still counted as a call and an error, with zero neurons.
// Run: node qnfo-research-exec/attr-failed-free.test.mjs -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? "  -- " + JSON.stringify(x) : "")); } };
console.error = () => {};
const a = src.indexOf("\nvar __AI_ATTR_RATES = "), b = src.indexOf("\n", a + 1);
const f0 = src.indexOf("\nfunction __aiAttrBinding("), f1 = src.indexOf("\n}\n", f0) + 2;
ok(a > 0 && f0 > a && f1 > f0, "the rates table and the wrapper are found");
const make = new Function(src.slice(a, b) + src.slice(f0, f1) + "\nreturn __aiAttrBinding;")();
const rows = [];
const db = { prepare() { return { bind(...p) { return { async run() { if (p.length === 10) rows.push(p); return { meta: {} }; } }; } }; } }; // the wrapper also writes a cached-token row (6 binds); only the 10-bind counter row is read here
const MODEL = "@cf/zai-org/glm-5.3-flash";
const bigPrompt = "x".repeat(60000);
const okAi = { async run() { return { response: "hello", usage: { prompt_tokens: 15000, completion_tokens: 500 } }; } };
const badAi = { async run() { throw new Error("3046: Request timeout"); } };
const call = async (ai) => { const w = make(ai, db, "qnfo-research-exec", { stage: "revise" }); try { await w.run(MODEL, { messages: [{ role: "user", content: bigPrompt }] }); return "ok"; } catch (e) { return "threw"; } };
// INSERT binds: day, worker, model, errors, chars, ms, inTok, outTok, neurons, purpose
let r = await call(okAi);
ok(r === "ok" && rows.length === 1, "a successful call writes one row");
const good = rows[0];
ok(good[3] === 0 && good[8] > 200 && good[8] < 300, "its neurons come from the usage tokens (15,000 in x 13,636 + 500 out x 45,455 per million, about 227)", good);
r = await call(badAi);
ok(r === "threw" && rows.length === 2, "a failed call still rethrows and still writes one row");
const bad = rows[1];
ok(bad[3] === 1, "the row counts it as an error", bad);
ok(bad[8] === 0, "but books no neurons for it (no usage came back and Cloudflare billed nothing)", bad);
ok(bad[4] === bigPrompt.length + 0 || bad[4] > 59000, "the input size is still recorded, so the failure stays visible", bad[4]);
ok(/if \(!ok\) neurons = 0; \/\* AI-ATTR-FAILED-FREE-1/.test(src), "the source carries the marker");
// the second copy (the folded errata-hub member) is verbatim the member's own and is not touched here
const second = src.indexOf("var neurons = (inTok * r[0] + outTok * r[1]) / 1e6;", src.indexOf("var neurons = (inTok * r[0] + outTok * r[1]) / 1e6;") + 10);
ok(second > 0 && !/^var neurons = [^\n]*if \(!ok\)/.test(src.slice(second, second + 220)), "the folded errata member's copy is unchanged (parity with errata-hub)");
console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
