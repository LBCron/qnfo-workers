// PROMPT-CACHE-COUNT-4 (issue 2115): qnfo-fleet-control aiRunAttr writes one ai_cache_counters row per text-model call, in the
// live qnfo-audit schema, and returns the AI result unchanged. Driven against node:sqlite with the production table DDL.
// Run: node qnfo-fleet-control/cache-count.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import vm from "node:vm";
const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "worker.js"), "utf8");
const a = src.indexOf("var AI_ATTR_RATES = {");
const b = src.indexOf('__name(aiCacheRow, "aiCacheRow");');
if (a < 0 || b < 0 || a > src.indexOf("async function aiRunAttr(env, worker, purpose, model, input, opts) {")) throw new Error("AI_ATTR_RATES / aiRunAttr / aiCacheRow block not found");
const sandbox = { __name: (f) => f };
vm.createContext(sandbox);
vm.runInContext(src.slice(a, b) + "\n__export = { aiRunAttr, aiCacheRow };", sandbox);
const { aiRunAttr, aiCacheRow } = sandbox.__export;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL " + m); } };

function d1() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE ai_cache_counters (day TEXT, worker TEXT, model TEXT, calls INTEGER DEFAULT 0, cached_calls INTEGER DEFAULT 0, in_tok INTEGER DEFAULT 0, cached_tok INTEGER DEFAULT 0, PRIMARY KEY (day, worker, model))");
  db.exec("CREATE TABLE ai_call_counters (day TEXT, worker TEXT, purpose TEXT, model TEXT, calls INTEGER DEFAULT 0, errors INTEGER DEFAULT 0, in_chars INTEGER DEFAULT 0, ms INTEGER DEFAULT 0, in_tok INTEGER DEFAULT 0, out_tok INTEGER DEFAULT 0, neurons REAL DEFAULT 0, PRIMARY KEY (day, worker, purpose, model))");
  const shim = { raw: db, prepare(sql) { let args = []; const st = { bind(...x) { args = x; return st; }, async run() { db.prepare(sql).run(...args); return { success: true }; } }; return st; } };
  return shim;
}

const db = d1();
const res = { response: "hi", usage: { prompt_tokens: 5000, prompt_tokens_details: { cached_tokens: 4096 } } };
const env = { AUDIT_DB: db, AI: { run: async () => res } };
const out = await aiRunAttr(env, "qnfo-fleet-control", "goal-review", "@cf/openai/gpt-oss-120b", { messages: [{ role: "user", content: "x" }] });
ok(out === res, "returns the AI result object unchanged");
await aiRunAttr({ AUDIT_DB: db, AI: { run: async () => ({ response: "y", usage: { prompt_tokens: 100 } }) } }, "qnfo-fleet-control", "goal-review", "@cf/openai/gpt-oss-120b", { prompt: "y" });
const row = db.raw.prepare("SELECT * FROM ai_cache_counters WHERE worker='qnfo-fleet-control'").get();
ok(row && row.calls === 2, "two calls counted in one row: " + JSON.stringify(row));
ok(row && row.cached_calls === 1 && row.cached_tok === 4096 && row.in_tok === 5100, "cached and input tokens summed");
await aiRunAttr({ AUDIT_DB: db, AI: { run: async () => ({ data: [[0.1]] }) } }, "fleet-control", "embed", "@cf/baai/bge-m3", { text: ["a"] });
ok(db.raw.prepare("SELECT COUNT(*) n FROM ai_cache_counters WHERE worker='fleet-control'").get().n === 0, "embedding models are not counted");
let threw = false;
try { await aiRunAttr({ AUDIT_DB: db, AI: { run: async () => { throw new Error("3046"); } } }, "fleet-control", "advisor-propose", "@cf/meta/llama-3.3-70b-instruct-fp8-fast", { prompt: "z" }); } catch (e) { threw = String(e.message) === "3046"; }
ok(threw, "AI errors propagate unchanged");
const broken = { AUDIT_DB: { prepare() { throw new Error("d1 down"); } }, AI: { run: async () => res } };
ok((await aiRunAttr(broken, "fleet-control", "x", "@cf/openai/gpt-oss-120b", { prompt: "q" })) === res, "a failing D1 never breaks the AI call");
ok(aiCacheRow("@cf/x", null) === null && aiCacheRow("@cf/x", "text") === null, "no row without an object result");
ok(aiCacheRow("@cf/x", { usage: { input_tokens: 7, input_tokens_details: { cached_tokens: 3 } } }).cached_tok === 3, "input_tokens_details form read");
console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
