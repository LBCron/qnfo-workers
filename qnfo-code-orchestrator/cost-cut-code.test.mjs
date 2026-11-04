// COST-CUT-CODE-1 offline suite (qnfo-code-orchestrator 0.46.0, pillar cost): glm-5.3 climbs before kimi-k2.7-code, the output caps for the two
// dear rungs, the "patch too large" signature and streak, and ops_config code_cost_cut = off restoring the old behaviour.
// Run: node --no-warnings qnfo-code-orchestrator/cost-cut-code.test.mjs   (exit 0 = all passed)
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qnfo-cc-"));
const OSS = "@cf/openai/gpt-oss-120b", KIMI = "@cf/moonshotai/kimi-k2.7-code", GLM = "@cf/zai-org/glm-5.3";
try {
  const p = path.join(tmp, "worker.mjs");
  fs.writeFileSync(p, fs.readFileSync(path.join(here, "worker.js"), "utf8") + "\nexport { ladder, budgetLadder, costCutEnv, ccGlmFirst, ai, failSig, noteSig, PTL_SIG, CC_OUT_CAP };\n");
  const m = await import(pathToFileURL(p).href);
  const mk = (cfg) => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE cloud_ops_events (id TEXT,ts TEXT,kind TEXT,text TEXT,meta TEXT,job TEXT,status TEXT);");
    if (cfg) db.prepare("INSERT INTO ops_config VALUES ('code_cost_cut', ?)").run(cfg);
    const wrap = (sql) => { let a = []; const st = { bind: (...x) => { a = x; return st; }, run: async () => { db.prepare(sql).run(...a); return {}; }, first: async () => db.prepare(sql).get(...a) || null, all: async () => ({ results: db.prepare(sql).all(...a) }) }; return st; };
    return { prepare: wrap };
  };
  const env = await m.costCutEnv({ AUDIT_DB: mk() });
  assert.deepEqual(m.ladder(env), [OSS, GLM, KIMI], "glm before kimi when on");
  assert.deepEqual(m.budgetLadder(env), [OSS, GLM, KIMI], "budget ladder glm before kimi");
  const off = await m.costCutEnv({ AUDIT_DB: mk("off") });
  assert.deepEqual(m.ladder(off), [OSS, KIMI, GLM], "off restores the old order");
  assert.deepEqual(m.budgetLadder(off), [OSS, KIMI, GLM]);
  assert.deepEqual(m.ladder({ ...env, MODEL_LADDER: OSS + "," + KIMI }), [OSS, KIMI], "a ladder without both rungs is untouched");
  const fb = m.PTL_SIG + ". Your edits make a 90123-character patch; the limit is 80000. Change fewer lines.";
  assert.equal(m.failSig(fb), m.PTL_SIG, "feedback sentence keeps the signature");
  assert.equal(m.noteSig({ sigs: [m.PTL_SIG] }, fb, 2).streak, 2, "second oversized patch is a streak of 2");
  const calls = [];
  const aiEnv = (e) => ({ ...e, AI: { run: async (model, req) => { calls.push(req.max_tokens); return { response: "x", usage: { prompt_tokens: 10, completion_tokens: 5 } }; } } });
  await m.ai(aiEnv(env), KIMI, [{ role: "user", content: "a" }]);
  await m.ai(aiEnv(env), GLM, [{ role: "user", content: "a" }]);
  await m.ai(aiEnv(off), KIMI, [{ role: "user", content: "a" }]);
  await m.ai(aiEnv(off), GLM, [{ role: "user", content: "a" }]);
  assert.deepEqual(calls, [6144, 8192, 9216, 16384]);
  console.log("cost-cut-code: all passed");
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
