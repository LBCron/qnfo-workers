// ROUTER-LEGS-1 offline suite (qnfo-ai-calibration 1.8.2; GitHub 6158 and 6174, agent_issues 1001956).
// ai_calibration_results showed qnfo-ai's 504 router_timeout answers (389 in 24 h) are the hourly model-route probes: all ten routes at 00:00, 10:00, 16:00, 20:00 and 22:00Z on
// 2026-11-04 while 23 of 24 models were ok when asked directly. The router returns error.type, error.budget_ms and error.legs in the 504 body; the probe kept only
// "http=504 echo=false". The note now follows that unchanged prefix. Proves: a 504 with legs names the type, the budget and up to three legs (model:err-or-ok:ms); the prefix still
// matches /^http=5\d\d\b/ (the sweep's route-failure check); a 200 pass, a 504 without a body and a 4xx add nothing; the whole detail fits the 300 characters the results table keeps.
// Run: node qnfo-ai-calibration/router-legs.test.mjs
import fs from "node:fs";
const src = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const api = new Function(src.replace(/export \{\s*(?:worker_default|__fk_\w+_default) as default\s*\};?/, "") +
  "\nreturn { probeCompletion, routerLegsNote };")();
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };
const env = (status, body) => ({ QNFO_ROUTER_KEY: "k", QNFO_AI: { async fetch() { return new Response(body == null ? "" : JSON.stringify(body), { status }); } } });

const legs = [
  { model: "@cf/zai-org/glm-5.3-flash", role: "primary", ms: 2675, ok: false, err: "Capacity temporarily exceeded" },
  { model: "dynamic/value", role: "hedge", ms: 3100, ok: false, err: "empty" },
  { model: "@cf/openai/gpt-oss-120b", role: "hedge", ms: null, ok: false, err: "" },
  { model: "fourth", role: "hedge", ms: 1, ok: true, err: "" }
];
const r504 = await api.probeCompletion(env(504, { error: { type: "router_timeout", message: "no model answered", budget_ms: 3000, legs } }), "glm-5.3-flash");
ok(r504.status === "fail" && /^http=504 echo=false ""/.test(r504.detail), "the prefix is unchanged", r504.detail);
ok(/^http=5\d\d\b/.test(r504.detail), "the sweep's /^http=5\\d\\d\\b/ route-failure check still matches");
ok(r504.detail.includes(" router=router_timeout budget=3000 legs="), "the router type and budget follow the prefix", r504.detail);
ok(r504.detail.includes("glm-5.3-flash:Capacity temporarily exceeded:2675ms") && r504.detail.includes("dynamic/value:empty:3100ms") && r504.detail.includes("gpt-oss-120b:fail:-ms"), "each leg names its model, error and time", r504.detail);
ok(!r504.detail.includes("fourth"), "only the first three legs are kept", r504.detail);
ok(r504.detail.length <= 300, "the detail fits the 300 characters the results table keeps", r504.detail.length);

const noBody = await api.probeCompletion(env(504, null), "glm-5.3-flash");
ok(noBody.detail === 'http=504 echo=false ""', "a 504 without a JSON body adds nothing", noBody.detail);
const bad = await api.probeCompletion(env(401, { error: { type: "unauthorized" } }), "glm-5.3-flash");
ok(!bad.detail.includes("router="), "a 4xx adds nothing", bad.detail);
const good = await api.probeCompletion(env(200, { model: "glm-5.3-flash", choices: [{ message: { content: "OK" } }] }), "glm-5.3-flash");
ok(good.status === "pass" && good.detail === "ok", "a pass is unchanged", good);
ok(api.routerLegsNote(null) === "" && api.routerLegsNote({ status: 502, data: { error: "string error" } }) === "" && api.routerLegsNote({ status: 502, data: { error: { type: "x" } } }) === " router=x", "the helper is total on odd shapes");

console.log("router-legs: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
