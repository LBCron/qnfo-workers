// AI-METER-COVER-2 (2.12.5, pillar cost, roadmap RM-COST-FREE-FIRST-PARITY-1): voiceAi, the only Workers AI call site in qnfo-email, goes through
// __aiAttrEnv, so each voice-draft call is one ai_call_counters row under worker qnfo-email (before this it was invisible to the attribution
// coverage metric). The call itself is unchanged: the same text comes back, an error is rethrown, and a missing database leaves the call alone.
import fs from "node:fs";
import { stripWorkerDefaultExport } from "../scripts/worker-source-test.mjs";
const src = stripWorkerDefaultExport(fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8"));
const lib = new Function(src.replace(/export default\{/, "const __handler={") + "\nreturn { voiceAi };")();

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? "  -- " + JSON.stringify(x).slice(0, 400) : "")); } };

const rows = [];
const db = { prepare: (sql) => ({ bind: (...a) => ({ run: async () => { rows.push({ sql, a }); } }) }) };
const calls = [];
const ai = { run: async (model, input) => { calls.push({ model, input }); if (input.fail) throw new Error("3046: Request timeout"); return { response: "Hello Jane", usage: { prompt_tokens: 2000, completion_tokens: 100 } }; } };

const text = await lib.voiceAi({ AI: ai, AUDIT_DB: db }, "@cf/zai-org/glm-5.3-flash", "system", "user", 300);
ok(text === "Hello Jane", "the reply text is returned unchanged", text);
ok(calls.length === 1 && calls[0].input.messages.length === 2, "one model call with the system and user messages", calls.length);
ok(rows.length === 1 && /INSERT INTO ai_call_counters/.test(rows[0].sql), "one counter row per call", rows.length);
ok(rows[0].a[1] === "qnfo-email" && rows[0].a[2] === "@cf/zai-org/glm-5.3-flash", "booked under qnfo-email and the model", rows[0].a);
ok(rows[0].a[3] === 0 && rows[0].a[6] === 2000 && rows[0].a[7] === 100, "no error, usage tokens recorded", rows[0].a);
ok(Math.abs(rows[0].a[8] - (2000 * 13636 + 100 * 45455) / 1e6) < 0.01, "neurons from the usage tokens at the published glm-5.3-flash rate", rows[0].a[8]);

let threw = null;
try { await lib.voiceAi({ AI: ai, AUDIT_DB: db }, "@cf/zai-org/glm-5.3-flash", "s", "u"); await lib.voiceAi({ AI: { run: async () => { throw new Error("3046: Request timeout"); } }, AUDIT_DB: db }, "@cf/zai-org/glm-5.3-flash", "s", "u"); } catch (e) { threw = e; }
ok(threw && /3046/.test(String(threw.message)), "a model error is rethrown to the caller", String(threw && threw.message));
ok(rows.length === 3 && rows[2].a[3] === 1, "and counted as an error", rows.map((r) => r.a[3]));

const noDb = await lib.voiceAi({ AI: ai }, "@cf/zai-org/glm-5.3-flash", "s", "u");
ok(noDb === "Hello Jane" && rows.length === 3, "no database binding: the call still works and writes nothing");

let noAi = null;
try { await lib.voiceAi({ AUDIT_DB: db }, "m", "s", "u"); } catch (e) { noAi = e; }
ok(noAi && /no AI binding/.test(String(noAi.message)), "no AI binding still fails the same way");

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
