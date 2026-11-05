// BUDGET-PROBE-1 (qnfo-ai-calibration 1.6.0, agent_issues 2829 path A) offline suite. No network, no production data.
// Before 1.6.0 both writers of ai_model_health.status = 'ok' (the folded prober's probeOne with max_tokens 1, and the sweep's
// probeCompletion with max_tokens 16 that accepts reasoning_content as an answer) never read the reply a real caller would get,
// so glm-5.3-flash (0.53 error share over 6,000 calls on 2026-10-19) and qwen3.8-27b (0.77) read status ok. Proves: the judge
// (empty content, finish_reason length or a missing DONE marker is a failure); the prober member keeps the cheap ping and adds one
// budget probe per unique text id and none for an embedding model; the sweep adds one budget probe per text model; a failing
// budget probe takes the existing degraded -> failing path (no new status value); ai_calibration_config budget_probe = off
// restores the ping-only behaviour; the migration carries the failure mode, its fm- detector contract and the switch's registry row.
// Lane (review of 65693a88): qnfo-ai forces reasoning_effort low/none on max_tokens <= REASONING_SMALL_MAX for glm-5.3-flash, kimi-k2.6
// and gpt-oss-120b, the lane that exists because those models otherwise spend the allowance reasoning. A budget probe sent through the
// router at max_tokens 256 runs in that lane and passes. The sweep therefore probes every model that has a Workers AI id through
// env.AI.run, the request shape the prober sends, so the two writers of one ai_model_health row run one shape and a pass of one cannot
// mask a failure of the other; only deepseek-v4-flash-thinking has no Workers AI id and uses the router for its budget probe.
// SPEND-DOWNGRADE-INCONCLUSIVE-1 (1.6.4), the second path for a router-swapped ping. qnfo-ai 5.37.0 (MODEL-HEALTH-FLAP-1) honours no_downgrade
// for the caller qnfo-ai-calibration at max_tokens 512 or less, so the 16-token ping normally reaches the model it names (section 4c, case G, pins
// the request shape that rule needs). Where the router still swaps the ping for glm-5.3-flash (flag not honoured, ceiling exceeded, caller not
// identified, older router) the sweep used to score the swap as a model failure: degraded at one full sweep, failing plus an [ai-cal] issue at the
// next. Section 4c proves a swapped ping is inconclusive: judged on the direct probe when the model has a Workers AI id (pass: ok, 0 failures, the
// issue resolved; fail: the unchanged degraded then failing path), no health write and no issue when it has none or budget_probe is off. The
// probe = model row is never rewritten: it stays "downgraded" and the verdict is the probe = model-budget row.
// Run: node qnfo-ai-calibration/budget-probe.test.mjs   -> prints "N passed, 0 failed"
import fs from "node:fs";
import { versionAtLeast } from "../scripts/version-at-least.mjs";
const src = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const mirror = fs.readFileSync(new URL("./deployed-current.worker.js", import.meta.url), "utf8");
let mig = "";
try { mig = fs.readFileSync(new URL("../migrations/2026-10-19-model-health-budget-probe.sql", import.meta.url), "utf8"); } catch (e) { /* absent on the base commit: the migration checks below fail */ }
const api = new Function(src.replace(/export \{\s*(?:worker_default|__fk_\w+_default) as default\s*\};?/, "") +
  "\nreturn { worker_default, VERSION, PROBER_VERSION, judge: typeof judgeBudgetReply === 'function' ? judgeBudgetReply : null, fnv32 };")();
let pass = 0, fail = 0;
const ok = (c, m, extra) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (extra !== undefined ? " :: " + JSON.stringify(extra).slice(0, 300) : "")); } };
globalThis.fetch = async () => new Response("{}", { status: 200 });

const good = { choices: [{ message: { content: "42 DONE" }, finish_reason: "stop" }] };
const emptyLength = { choices: [{ message: { content: "", reasoning_content: "Let me think about 17 + 25 ..." }, finish_reason: "length" }] };

// 1. the judge
{
  const j = api.judge;
  ok(typeof j === "function", "judgeBudgetReply exists");
  if (j) {
    ok(j(good).ok === true, "a reply with content and DONE passes", j(good));
    ok(j({ response: "The answer is 42. DONE" }).ok === true, "a Workers AI {response} body with DONE passes");
    ok(j({ choices: [{ message: { content: [{ text: "42 " }, { text: "done" }] }, finish_reason: "stop" }] }).ok === true, "array content parts are joined and DONE is matched without case");
    const e = j(emptyLength);
    ok(e.ok === false && /empty/.test(e.reason) && /length/.test(e.reason), "empty content with finish_reason length fails (reasoning spent the budget)", e);
    ok(j({ choices: [{ message: { content: "", reasoning_content: "x" }, finish_reason: "stop" }] }).ok === false, "reasoning_content alone is not an answer");
    ok(j({ response: "" }).ok === false && j({}).ok === false && j(null).ok === false, "empty, missing and null replies fail");
    const nm = j({ choices: [{ message: { content: "42" }, finish_reason: "stop" }] });
    ok(nm.ok === false && /DONE/.test(nm.reason), "content without the DONE marker fails", nm);
    ok(j({ choices: [{ message: { content: "4" }, finish_reason: "length" }] }).ok === false, "a truncated reply without the marker fails");
  }
}

// 2. stubs
// REASONING-PING-1 (1.6.13): the ping is 16 tokens, and 512 for a reasoning-only id (thinking, reasoner), which cannot answer in 16.
const isPingBody = (b) => b && (b.max_tokens === 16 || (b.max_tokens === 512 && /thinking|reasoner/.test(String(b.model))));
function mkEnv(o) {
  o = o || {};
  const sql = [], ai = [], router = [];
  const cfg = Object.assign({}, o.cfg), prevCf = o.prevCf || {};
  const stmt = (q) => {
    let a = [];
    const s = {
      bind(...x) { a = x; return s; },
      async run() { sql.push({ q, a }); return { success: true, meta: { changes: 1 } }; },
      async first() {
        sql.push({ q, a });
        if (/FROM ai_calibration_config/.test(q)) return a[0] in cfg ? { value: cfg[a[0]] } : null;
        if (/SELECT consecutive_failures FROM ai_model_health/.test(q)) return a[0] in prevCf ? { consecutive_failures: prevCf[a[0]] } : null;
        if (/FROM issue_ledger WHERE fingerprint = \?1 AND status = 'open'/.test(q)) return (o.openFps || []).indexOf(a[0]) >= 0 ? { fingerprint: a[0] } : null;
        return null;
      },
      async all() {
        sql.push({ q, a });
        if (/SELECT model_id, status, last_probe_ts FROM ai_model_health/.test(q) && o.prior) return { results: o.prior };
        return { results: [] };
      }
    };
    return s;
  };
  const scripted = o.budget || {};
  const env = {
    QNFO_AUDIT: { prepare: stmt, batch: async (xs) => xs.map(() => ({ results: [] })) },
    AI: {
      async run(model, input) {
        ai.push({ model, input });
        if (input && input.max_tokens === 256) {
          const sc = scripted[model] !== undefined ? scripted[model] : scripted[model.split("/").pop()];
          if (sc === "throw") throw new Error("budget request refused");
          return sc || good;
        }
        return { response: "ok", data: [[0.1, 0.2]] };
      }
    },
    QNFO_AI: {
      async fetch(url, init) {
        const body = init && init.body ? JSON.parse(init.body) : {};
        router.push({ url: String(url), body });
        if (/\/health$/.test(String(url))) return new Response(JSON.stringify({ status: "ok", version: "t" }), { status: 200 });
        if (/\/v1\/models$/.test(String(url))) return new Response(JSON.stringify({ data: [] }), { status: 200 });
        if (o.router5xx && isPingBody(body)) return new Response(JSON.stringify({ error: "router timeout" }), { status: o.router5xx });
        const reply = body.max_tokens === 256 ? (scripted[body.model] || good) : { choices: [{ message: { content: "OK" }, finish_reason: "stop" }] };
        // o.downgrade: the spend governor answers the 16-token ping with another model (the router did not honour no_downgrade). o.honour models
        // qnfo-ai 5.37.0: a request with no_downgrade: true and at most 512 output tokens from this caller is never swapped.
        const honoured = !!o.honour && body.no_downgrade === true && body.max_tokens > 0 && body.max_tokens <= 512;
        const served = (!honoured && o.downgrade && isPingBody(body) && o.downgrade[body.model]) || body.model;
        return new Response(JSON.stringify(Object.assign({ model: served }, reply)), { status: 200 });
      }
    },
    QNFO_OPS: { async fetch() { return new Response("{}", { status: 200 }); } },
    PT_API: { async fetch() { return new Response("{}", { status: 200 }); } },
    QNFO_ROUTER_KEY: "calib-key"
  };
  return { env, sql, ai, router };
}
const req = (path, method) => new Request("https://qnfo-ai-calibration.q08.workers.dev" + path, { method: method || "GET", headers: { Authorization: "Bearer calib-key" } });
const proberStatus = (t, id) => { const w = t.sql.find((x) => /INSERT INTO ai_model_health/.test(x.q) && !/ctx_override/.test(x.q) && x.a[0] === id); return w ? w.a[4] : null; };
const sweepWrite = (t, id) => t.sql.filter((x) => /INSERT INTO ai_model_health/.test(x.q) && x.a[0] === id && x.a.length === 5 && /ctx_override/.test(x.q)).map((x) => ({ status: x.a[1], failures: x.a[4] }));

// 3. the prober member
{
  const t = mkEnv({ budget: { "@cf/zai-org/glm-5.3-flash": emptyLength, "@cf/qwen/qwen3.8-27b": { choices: [{ message: { content: "42" }, finish_reason: "stop" }] } } });
  const r = await api.worker_default.fetch(req("/prober/run?force=1"), t.env, { waitUntil() {} });
  ok(r.status === 200, "/prober/run answers", r.status);
  const pings = t.ai.filter((c) => c.input && c.input.max_tokens === 1), budgets = t.ai.filter((c) => c.input && c.input.max_tokens === 256);
  ok(pings.length > 0 && pings.some((c) => c.model === "@cf/zai-org/glm-5.3-flash"), "the cheap max_tokens 1 ping stays for reachability", pings.length);
  ok(budgets.length > 0 && budgets.every((c) => !/bge/.test(c.model)), "no budget probe for the embedding model", budgets.map((c) => c.model));
  const ids = budgets.map((c) => c.model);
  ok(new Set(ids).size === ids.length, "one budget probe per unique model id per run (deepseek-v4-pro shares one id)", ids);
  ok(budgets[0] && /DONE/.test(JSON.stringify(budgets[0].input)), "the budget body asks for the DONE marker", budgets[0] && budgets[0].input);
  ok(proberStatus(t, "glm-5.3-flash") === "degraded", "glm-5.3-flash answering empty under the budget is written degraded, not ok", proberStatus(t, "glm-5.3-flash"));
  ok(proberStatus(t, "qwen3.8-27b") === "degraded", "a reply without the DONE marker is degraded", proberStatus(t, "qwen3.8-27b"));
  ok(proberStatus(t, "gpt-oss-120b") === "ok" && proberStatus(t, "kimi-k2.6") === "ok", "a model that answers with the marker stays ok", [proberStatus(t, "gpt-oss-120b"), proberStatus(t, "kimi-k2.6")]);
  ok(proberStatus(t, "bge-base-en-v1.5") === "ok", "the embedding model is judged by the ping alone");
  const stray = t.sql.filter((x) => /INSERT INTO ai_model_health/.test(x.q) && !/ctx_override/.test(x.q)).every((x) => ["ok", "degraded", "failing"].indexOf(x.a[4]) >= 0);
  ok(stray, "no new status value: only ok, degraded and failing are written");
  ok(t.sql.some((x) => /INSERT INTO ai_calibration_results/.test(x.q) && x.a.indexOf("model-budget") >= 0 && x.a.indexOf("glm-5.3-flash") >= 0 && x.a.indexOf("fail") >= 0), "the budget verdict is recorded in ai_calibration_results so a degraded row has a reason");
}
{
  const t = mkEnv({ budget: { "@cf/zai-org/glm-5.3-flash": "throw" } });
  await api.worker_default.fetch(req("/prober/run?force=1"), t.env, { waitUntil() {} });
  ok(proberStatus(t, "glm-5.3-flash") === "degraded", "a budget request that throws on both body shapes is a failed probe");
  const glm = t.ai.filter((c) => c.model === "@cf/zai-org/glm-5.3-flash" && c.input.max_tokens === 256);
  ok(glm.length === 2 && !!glm[0].input.messages && typeof glm[1].input.prompt === "string", "the budget probe tries messages, then prompt", glm.map((c) => Object.keys(c.input)));
}
{
  const t = mkEnv({ cfg: { budget_probe: "off" }, budget: { "@cf/zai-org/glm-5.3-flash": emptyLength } });
  await api.worker_default.fetch(req("/prober/run?force=1"), t.env, { waitUntil() {} });
  ok(t.ai.every((c) => !(c.input && c.input.max_tokens === 256)), "budget_probe = off spends no budget call");
  ok(proberStatus(t, "glm-5.3-flash") === "ok", "budget_probe = off restores the ping-only verdict (the revert path)");
}

// 4. the sweep
const GLM = "@cf/zai-org/glm-5.3-flash";
const sweepBudgetsDirect = (t) => t.ai.filter((c) => c.input && c.input.max_tokens === 256 && c.input.messages);
const routerBudgets = (t) => t.router.filter((c) => c.body && c.body.max_tokens === 256);
{
  const t = mkEnv({ budget: { "glm-5.3-flash": emptyLength } });
  const r = await api.worker_default.fetch(req("/run", "POST"), t.env, { waitUntil() {} });
  const j = await r.json();
  const direct = sweepBudgetsDirect(t).map((c) => c.model);
  const viaRouter = routerBudgets(t).map((c) => c.body.model);
  ok(r.status === 200 && direct.length === 9, "the sweep sends one direct budget probe per model with a Workers AI id (seven TIER0 ids, deepseek-v4-pro and canonical deepseek-v4-flash)", direct);
  ok(direct.indexOf(GLM) >= 0 && direct.indexOf("@cf/deepseek-ai/deepseek-v4-pro-0813") >= 0 && direct.indexOf("@cf/deepseek-ai/deepseek-v4-flash-0731") >= 0, "glm-5.3-flash, deepseek-v4-pro and canonical deepseek-v4-flash are probed direct", direct);
  ok(viaRouter.join() === "deepseek-v4-flash-thinking" && routerBudgets(t).every((c) => c.body.hedge === false && c.body.stream === false), "only the DeepSeek id without a Workers AI mapping uses the router budget path, unhedged", viaRouter);
  // the lane: qnfo-ai gives a request at or below REASONING_SMALL_MAX the small-answer effort for these models
  const qai = fs.readFileSync(new URL("../qnfo-ai/worker.js", import.meta.url), "utf8");
  const smallMax = Number((qai.match(/var REASONING_SMALL_MAX = (\d+);/) || [])[1]);
  const laneIds = Object.keys(JSON.parse((qai.match(/var WA_SMALL_ANSWER_EFFORT = (\{[^}]*\});/) || [])[1] || "{}"));
  ok(smallMax >= 256 && laneIds.indexOf(GLM) >= 0, "qnfo-ai still has a small-answer lane that covers max_tokens 256 for glm-5.3-flash", { smallMax, laneIds });
  const laneRouted = t.router.filter((c) => c.body && c.body.max_tokens <= smallMax && c.body.messages && /DONE/.test(JSON.stringify(c.body.messages)) && laneIds.some((id) => id.split("/").pop() === c.body.model));
  ok(laneRouted.length === 0, "no budget probe reaches a lane model through the router at max_tokens <= REASONING_SMALL_MAX (that lane hides the failure)", laneRouted.map((c) => c.body.model));
  const w = sweepWrite(t, "glm-5.3-flash");
  ok(w.length === 1 && w[0].status === "degraded" && w[0].failures === 1, "the sweep writes degraded (failures 1) for an empty budget reply", w);
  const g = sweepWrite(t, "gpt-oss-120b");
  ok(g.length === 1 && g[0].status === "ok" && g[0].failures === 0, "the sweep writes ok for a model that answers with the marker", g);
  const rows = (j.digest && j.digest.results || []).filter((x) => x.probe === "model-budget");
  ok(rows.some((x) => x.target === "glm-5.3-flash" && x.status === "fail" && /empty/.test(x.detail) && /direct/.test(x.detail)) && rows.some((x) => x.target === "gpt-oss-120b" && x.status === "pass"), "model-budget result rows carry the verdict, the reason and the lane", rows.slice(0, 3));
  ok((j.digest && j.digest.results || []).some((x) => x.probe === "model" && x.target === "glm-5.3-flash" && x.status === "pass"), "the ping row still passes: reachability is unchanged");
  // one shape for the two writers of a shared row: the sweep's body for an id equals the prober's body for it
  const sweepBody = t.ai.find((c) => c.model === GLM && c.input.max_tokens === 256);
  const tp = mkEnv({});
  await api.worker_default.fetch(req("/prober/run?force=1"), tp.env, { waitUntil() {} });
  const proberBody = tp.ai.find((c) => c.model === GLM && c.input.max_tokens === 256);
  ok(sweepBody && proberBody && JSON.stringify(sweepBody.input) === JSON.stringify(proberBody.input), "the sweep and the prober send the same request to a model whose health row both write", [sweepBody && sweepBody.input, proberBody && proberBody.input]);
}
{
  // the DeepSeek id without a Workers AI id keeps the router path and its verdict
  const t = mkEnv({ budget: { "deepseek-v4-flash-thinking": emptyLength } });
  await (await api.worker_default.fetch(req("/run", "POST"), t.env, { waitUntil() {} })).json();
  const w = sweepWrite(t, "deepseek-v4-flash-thinking");
  ok(w.length === 1 && w[0].status === "degraded", "an empty router-lane budget reply degrades deepseek-v4-flash-thinking", w);
}
{
  const t = mkEnv({ prevCf: { "glm-5.3-flash": 1 }, budget: { "glm-5.3-flash": emptyLength } });
  const r = await api.worker_default.fetch(req("/run", "POST"), t.env, { waitUntil() {} });
  await r.json();
  const w = sweepWrite(t, "glm-5.3-flash");
  ok(w.length === 1 && w[0].status === "failing" && w[0].failures === 2, "a second consecutive budget failure reaches failing at the existing fail_threshold", w);
  ok(t.sql.some((x) => /issue_ledger/.test(x.q) && x.a.some((v) => typeof v === "string" && /model probe failing: glm-5.3-flash/.test(v) || /budget/.test(String(v)))), "failing files the existing [ai-cal] model probe failing issue with the budget reason");
}
{
  const t = mkEnv({ prevCf: { "glm-5.3-flash": 1 }, budget: { "glm-5.3-flash": good } });
  await (await api.worker_default.fetch(req("/run", "POST"), t.env, { waitUntil() {} })).json();
  const w = sweepWrite(t, "glm-5.3-flash");
  ok(w.length === 1 && w[0].status === "ok" && w[0].failures === 0, "a model that now answers within the budget recovers to ok", w);
}
{
  const t = mkEnv({ cfg: { budget_probe: "off" }, budget: { "glm-5.3-flash": emptyLength } });
  await (await api.worker_default.fetch(req("/run", "POST"), t.env, { waitUntil() {} })).json();
  ok(routerBudgets(t).length === 0 && sweepBudgetsDirect(t).length === 0, "budget_probe = off: the sweep sends no budget probe");
  const w = sweepWrite(t, "glm-5.3-flash");
  ok(w.length === 1 && w[0].status === "ok", "budget_probe = off: the sweep writes the ping-only verdict", w);
}

// 4b. BUDGET-PROBE-REFRESH-1: an ok row last probed before the budget probe existed is due now, once
{
  const SINCE = Date.UTC(2026, 9, 19, 12, 20, 0);
  const realNow = Date.now;
  Date.now = () => SINCE + 2 * 36e5; // two hours after the 1.6.0 deploy
  try {
    const prior = [
      { model_id: "glm-5.3-flash", status: "ok", last_probe_ts: SINCE - 30 * 6e4 },      // 2.5 h old, probed before the deploy: due
      { model_id: "qwen3.8-27b", status: "ok", last_probe_ts: SINCE - 3 * 36e5 },        // 5 h old, probed before the deploy: due
      { model_id: "gpt-oss-120b", status: "ok", last_probe_ts: SINCE + 36e5 },           // 1 h old, probed after the deploy: current
      { model_id: "kimi-k2.6", status: "ok", last_probe_ts: SINCE + 36e5 },
      { model_id: "kimi-k2.7-code", status: "ok", last_probe_ts: SINCE + 36e5 },
      { model_id: "glm-5.3", status: "ok", last_probe_ts: SINCE + 36e5 },
      { model_id: "nemotron-3-120b-a12b", status: "ok", last_probe_ts: SINCE + 36e5 },
      { model_id: "deepseek-v4-pro", status: "ok", last_probe_ts: SINCE + 36e5 },
      { model_id: "deepseek-v4-pro-wa", status: "ok", last_probe_ts: SINCE + 36e5 },
      { model_id: "deepseek-v4-flash-wa", status: "ok", last_probe_ts: SINCE + 36e5 },
      { model_id: "bge-base-en-v1.5", status: "ok", last_probe_ts: SINCE + 36e5 },
    ];
    const t = mkEnv({ prior, budget: { "@cf/zai-org/glm-5.3-flash": emptyLength } });
    const r = await api.worker_default.fetch(req("/prober/run"), t.env, { waitUntil() {} });
    const j = await r.json();
    const probed = Array.from(new Set(t.ai.map((c) => c.model))).sort();
    ok(r.status === 200 && probed.join() === ["@cf/qwen/qwen3.8-27b", "@cf/zai-org/glm-5.3-flash"].join(), "only the two ok rows probed before the 1.6.0 deploy are due; current ones are skipped", probed);
    ok(proberStatus(t, "glm-5.3-flash") === "degraded", "and the stale ok row gets the budget-shaped verdict (empty under the budget: degraded)", proberStatus(t, "glm-5.3-flash"));
    ok(proberStatus(t, "qwen3.8-27b") === "ok", "a row that answers within the budget stays ok", proberStatus(t, "qwen3.8-27b"));
    // once probed after the deploy, the 9-hour interval applies again
    const prior2 = prior.map((x) => ({ model_id: x.model_id, status: "ok", last_probe_ts: SINCE + 3 * 6e4 * 10 }));
    const t2 = mkEnv({ prior: prior2 });
    await api.worker_default.fetch(req("/prober/run"), t2.env, { waitUntil() {} });
    ok(t2.ai.length === 0, "rows probed after the deploy are skipped again until their 9 hours lapse", t2.ai.map((c) => c.model));
    // a degraded row is never skipped, and a row with no probe time is probed
    const t3 = mkEnv({ prior: [{ model_id: "glm-5.3-flash", status: "degraded", last_probe_ts: SINCE + 36e5 }, { model_id: "gpt-oss-120b", status: "ok", last_probe_ts: null }] });
    await api.worker_default.fetch(req("/prober/run"), t3.env, { waitUntil() {} });
    const p3 = new Set(t3.ai.map((c) => c.model));
    ok(p3.has("@cf/zai-org/glm-5.3-flash") && p3.has("@cf/openai/gpt-oss-120b"), "a degraded row and a never-probed row are still probed every run", [...p3]);
    void j;
  } finally { Date.now = realNow; }
}

// 4c. SPEND-DOWNGRADE-INCONCLUSIVE-1: where the router still swaps the ping, a downgraded ping is inconclusive; the model is judged on the direct probe
{
  const GPT = "@cf/openai/gpt-oss-120b", SWAP = "glm-5.3-flash";
  const failingTitle = (m) => "[ai-cal] model probe failing: " + m;
  const fpOf = (m) => "cal:" + api.fnv32(failingTitle(m));
  const filed = (t, m) => t.sql.filter((x) => /INSERT INTO issue_ledger|UPDATE issue_ledger SET occurrences/.test(x.q) && x.a.some((v) => typeof v === "string" && (v === failingTitle(m) || v === fpOf(m))));
  const resolved = (t, m) => t.sql.filter((x) => /UPDATE issue_ledger SET status = 'resolved'/.test(x.q) && x.a[0] === fpOf(m));
  const rowsOf = (j, probe, m) => (j.digest && j.digest.results || []).filter((x) => x.probe === probe && x.target === m);
  const directCalls = (t, id) => t.ai.filter((c) => c.model === id && c.input && c.input.max_tokens === 256);
  const run = async (t) => (await (await api.worker_default.fetch(req("/run", "POST"), t.env, { waitUntil() {} })).json());

  // the harness itself: with o.downgrade and no o.honour the mock swaps the ping, so these cases exercise the router that still swaps it
  {
    const t = mkEnv({ downgrade: { "gpt-oss-120b": SWAP } });
    const j = await run(t);
    ok(rowsOf(j, "model", "gpt-oss-120b").length === 1, "harness: the sweep records a model row for gpt-oss-120b");
    const pinged = t.router.filter((c) => c.body && c.body.model === "gpt-oss-120b" && c.body.max_tokens === 16);
    ok(pinged.length === 1 && pinged[0].body.no_downgrade === true, "harness: the ping asks for no_downgrade (the mock router does not honour it in these cases)", pinged.map((c) => c.body));
  }

  // Case A: downgraded ping, direct probe passes -> ok with 0 failures, no degraded row, no issue filed, the open issue resolved, the ping row left as it was
  {
    const t = mkEnv({ downgrade: { "gpt-oss-120b": SWAP }, prevCf: { "gpt-oss-120b": 1 }, openFps: [fpOf("gpt-oss-120b")] });
    const j = await run(t);
    const w = sweepWrite(t, "gpt-oss-120b");
    ok(w.length === 1 && w[0].status === "ok" && w[0].failures === 0, "A: a downgraded ping with a passing direct probe writes ok with 0 failures (cf 1 is cleared)", w);
    ok(w.every((x) => x.status !== "degraded" && x.status !== "failing"), "A: no degraded or failing row is written", w);
    ok(filed(t, "gpt-oss-120b").length === 0, "A: no fileIssue call for the model", filed(t, "gpt-oss-120b").map((x) => x.a));
    ok(resolved(t, "gpt-oss-120b").length === 1, "A: closeIssue resolves the open [ai-cal] model probe failing row", resolved(t, "gpt-oss-120b"));
    ok(directCalls(t, GPT).length === 1, "A: exactly one direct budget probe is sent for the model (no second probe after the swap)", directCalls(t, GPT).length);
    const b = rowsOf(j, "model-budget", "gpt-oss-120b"), p = rowsOf(j, "model", "gpt-oss-120b");
    ok(b.length === 1 && b[0].status === "pass" && /direct/.test(b[0].detail), "A: the direct verdict is recorded as a model-budget row", b);
    ok(p.length === 1 && p[0].status === "downgraded" && p[0].detail === "downgraded to glm-5.3-flash", "A: the model row is not rewritten: it stays downgraded, the machine-readable record that the routed ping was answered by another model", p);
    ok(sweepWrite(t, "kimi-k2.6").length === 1 && sweepWrite(t, "kimi-k2.6")[0].status === "ok", "A: a model that was not downgraded is untouched");
    ok(directCalls(t, "@cf/moonshotai/kimi-k2.6").length === 1, "A: and gets its single budget probe as before");
  }

  // Case B: downgraded ping, the direct probe fails -> a genuine failure keeps the degraded then failing path
  {
    const t1 = mkEnv({ downgrade: { "gpt-oss-120b": SWAP }, budget: { "gpt-oss-120b": emptyLength } });
    const j1 = await run(t1);
    const w1 = sweepWrite(t1, "gpt-oss-120b");
    ok(w1.length === 1 && w1[0].status === "degraded" && w1[0].failures === 1, "B: a failing direct probe writes degraded (failures 1)", w1);
    ok(filed(t1, "gpt-oss-120b").length === 0, "B: the first failure files no issue");
    ok(resolved(t1, "gpt-oss-120b").length === 0, "B: and resolves nothing");
    const b1 = rowsOf(j1, "model-budget", "gpt-oss-120b"), p1 = rowsOf(j1, "model", "gpt-oss-120b");
    ok(b1.length === 1 && b1[0].status === "fail" && /empty/.test(b1[0].detail), "B: the model-budget row carries the failure reason", b1);
    ok(p1.length === 1 && p1[0].status === "downgraded" && p1[0].detail === "downgraded to glm-5.3-flash", "B: the model row is not rewritten either: it stays downgraded, the failure is the model-budget row", p1);
    const t2 = mkEnv({ downgrade: { "gpt-oss-120b": SWAP }, prevCf: { "gpt-oss-120b": 1 }, budget: { "gpt-oss-120b": emptyLength } });
    await run(t2);
    const w2 = sweepWrite(t2, "gpt-oss-120b");
    ok(w2.length === 1 && w2[0].status === "failing" && w2[0].failures === 2, "B: the second consecutive direct failure writes failing (failures 2)", w2);
    ok(filed(t2, "gpt-oss-120b").length >= 1, "B: and files the [ai-cal] model probe failing issue", filed(t2, "gpt-oss-120b").map((x) => x.a));
    ok(filed(t2, "gpt-oss-120b").some((x) => x.a.some((v) => /budget direct/.test(String(v)))), "B: the issue detail is the direct probe's reason, not the swap");
  }

  // Case C: the canonical DeepSeek flash id uses its known Workers AI mapping when the router downgrades its ping.
  {
    const FLASH = "@cf/deepseek-ai/deepseek-v4-flash-0731";
    const t = mkEnv({ downgrade: { "deepseek-v4-flash": SWAP }, prevCf: { "deepseek-v4-flash": 1 }, openFps: [fpOf("deepseek-v4-flash")] });
    const j = await run(t);
    const w = sweepWrite(t, "deepseek-v4-flash");
    ok(w.length === 1 && w[0].status === "ok" && w[0].failures === 0, "C: the direct confirmation clears the previous failure for a downgraded ping", w);
    ok(filed(t, "deepseek-v4-flash").length === 0 && resolved(t, "deepseek-v4-flash").length === 1, "C: no new issue is filed and an open failure is resolved", [filed(t, "deepseek-v4-flash"), resolved(t, "deepseek-v4-flash")]);
    ok(directCalls(t, FLASH).length === 2 && rowsOf(j, "model-budget", "deepseek-v4-flash").some((x) => x.status === "pass" && /direct/.test(x.detail)), "C: the canonical and -wa roster entries share the direct Workers AI probe path", rowsOf(j, "model-budget", "deepseek-v4-flash"));
    ok(routerBudgets(t).every((c) => c.body.model !== "deepseek-v4-flash"), "C: no budget request for the downgraded model goes through the router");
    const p = rowsOf(j, "model", "deepseek-v4-flash")[0];
    ok(p && p.status === "downgraded", "C: the ping row remains downgraded so the router swap stays visible", p);
    ok(sweepWrite(t, "deepseek-v4-flash-thinking").length === 1, "C: a sibling that was not downgraded is still written");
  }
  // Case C2: a downgraded model with no direct ID remains inconclusive.
  {
    const t = mkEnv({ downgrade: { "deepseek-v4-flash-thinking": SWAP }, prevCf: { "deepseek-v4-flash-thinking": 1 } });
    const j = await run(t);
    ok(sweepWrite(t, "deepseek-v4-flash-thinking").length === 0, "C2: no health write for a downgraded ping without a direct mapping", sweepWrite(t, "deepseek-v4-flash-thinking"));
    ok(filed(t, "deepseek-v4-flash-thinking").length === 0 && resolved(t, "deepseek-v4-flash-thinking").length === 0, "C2: no issue is filed or resolved");
    ok(routerBudgets(t).every((c) => c.body.model !== "deepseek-v4-flash-thinking"), "C2: no budget request goes through the router for the downgraded model");
    ok(rowsOf(j, "model", "deepseek-v4-flash-thinking").some((x) => x.status === "downgraded"), "C2: the ping remains inconclusive");
  }

  // Case D: budget_probe = off -> no health write for a downgraded ping, no direct request
  {
    const t = mkEnv({ cfg: { budget_probe: "off" }, downgrade: { "gpt-oss-120b": SWAP }, prevCf: { "gpt-oss-120b": 1 } });
    await run(t);
    ok(sweepWrite(t, "gpt-oss-120b").length === 0, "D: budget_probe = off: a downgraded ping writes no health row", sweepWrite(t, "gpt-oss-120b"));
    ok(filed(t, "gpt-oss-120b").length === 0, "D: and files no issue");
    ok(directCalls(t, GPT).length === 0, "D: and sends no direct request");
    ok(sweepWrite(t, "kimi-k2.6").length === 1 && sweepWrite(t, "kimi-k2.6")[0].status === "ok", "D: models whose ping was not downgraded keep the ping-only verdict");
  }

  // Case E: a ping that fails for another reason (not the glm-5.3-flash swap) is still a failure
  {
    const t = mkEnv({ downgrade: { "gpt-oss-120b": "some-other-model" }, prevCf: { "gpt-oss-120b": 1 } });
    await run(t);
    const w = sweepWrite(t, "gpt-oss-120b");
    ok(w.length === 1 && w[0].status === "failing" && w[0].failures === 2, "E: a ping served by a model other than the glm-5.3-flash swap still fails as before", w);
  }

  // Case F: the live shape at the cap, six models downgraded at once, writes only ok rows and files nothing
  {
    const swap = {}, prevCf = {};
    for (const m of ["kimi-k2.6", "kimi-k2.7-code", "gpt-oss-120b", "glm-5.3", "deepseek-v4-pro-wa", "deepseek-v4-flash-wa"]) { swap[m] = SWAP; prevCf[m] = 1; }
    const t = mkEnv({ downgrade: swap, prevCf });
    await run(t);
    const writes = t.sql.filter((x) => /INSERT INTO ai_model_health/.test(x.q) && x.a.length === 5 && /ctx_override/.test(x.q));
    ok(Object.keys(swap).every((m) => sweepWrite(t, m).length === 1 && sweepWrite(t, m)[0].status === "ok" && sweepWrite(t, m)[0].failures === 0), "F: all six downgraded models are written ok with 0 failures", Object.keys(swap).map((m) => sweepWrite(t, m)));
    ok(writes.every((x) => x.a[1] === "ok"), "F: no degraded or failing row is written anywhere in the sweep", writes.map((x) => x.a[0] + ":" + x.a[1]));
    ok(!t.sql.some((x) => /INSERT INTO issue_ledger/.test(x.q) && x.a.some((v) => /model probe failing/.test(String(v)))), "F: no model probe failing issue is filed");
  }

  // Case G: the router honours no_downgrade (qnfo-ai 5.37.0: caller qnfo-ai-calibration, at most 512 output tokens). The ping reaches the model,
  // passes on its own measurement and the downgraded branch is never taken: the primary path, with nothing rewritten.
  {
    const swap = {}, prevCf = {};
    for (const m of ["kimi-k2.6", "kimi-k2.7-code", "gpt-oss-120b", "glm-5.3", "deepseek-v4-pro-wa", "deepseek-v4-flash-wa"]) { swap[m] = SWAP; prevCf[m] = 1; }
    const t = mkEnv({ downgrade: swap, honour: true, prevCf, openFps: [fpOf("gpt-oss-120b")] });
    const j = await run(t);
    ok(Object.keys(swap).every((m) => { const p = rowsOf(j, "model", m); return p.length === 1 && p[0].status === "pass" && p[0].detail === "ok"; }), "G: with the flag honoured every ping row is a pass served by the asked model", Object.keys(swap).map((m) => rowsOf(j, "model", m)));
    ok(Object.keys(swap).every((m) => sweepWrite(t, m).length === 1 && sweepWrite(t, m)[0].status === "ok" && sweepWrite(t, m)[0].failures === 0), "G: and each is written ok with 0 failures", Object.keys(swap).map((m) => sweepWrite(t, m)));
    ok(resolved(t, "gpt-oss-120b").length === 1, "G: closeIssue resolves the open [ai-cal] model probe failing row on the passing ping");
    ok(directCalls(t, GPT).length === 1, "G: the model gets its one ordinary budget probe, not a second probe after a swap", directCalls(t, GPT).length);
    // the request shape qnfo-ai 5.37.0 needs: every routed probe that asks no_downgrade stays within the 512-token ceiling, and the binding names the caller
    const asked = t.router.filter((c) => c.body && c.body.no_downgrade === true);
    ok(asked.length > 0 && asked.every((c) => c.body.max_tokens > 0 && c.body.max_tokens <= 512), "G: every routed request that asks no_downgrade carries max_tokens of at most 512", asked.map((c) => c.body.max_tokens));
    const toml = fs.readFileSync(new URL("./wrangler.toml", import.meta.url), "utf8");
    ok(/binding = "QNFO_AI"[\s\S]{0,400}props = \{ caller = "qnfo-ai-calibration" \}/.test(toml), "G: the QNFO_AI binding identifies the caller qnfo-ai-calibration by props");
  }
  // Case H: a transient router 5xx stays visible, but direct confirmation determines model executor health.
  {
    const t = mkEnv({ router5xx: 504, prevCf: { "gpt-oss-120b": 1 } });
    const j = await run(t);
    const model = rowsOf(j, "model", "gpt-oss-120b");
    const route = rowsOf(j, "model-route", "gpt-oss-120b");
    const budget = rowsOf(j, "model-budget", "gpt-oss-120b");
    ok(model.length === 1 && model[0].status === "pass" && /router http=504/.test(model[0].detail) && /direct ok/.test(model[0].detail), "H: a passing direct probe keeps the model roster healthy while retaining the router 504 detail", model);
    ok(route.length === 1 && route[0].status === "fail" && /http=504/.test(route[0].detail), "H: the explicit model-route failure is retained independently", route);
    ok(budget.length === 1 && budget[0].status === "pass" && directCalls(t, GPT).length === 1, "H: direct confirmation is recorded once as model-budget", budget);
    ok(sweepWrite(t, "gpt-oss-120b").length === 1 && sweepWrite(t, "gpt-oss-120b")[0].status === "ok", "H: direct success clears a previous model failure");
    const flash = rowsOf(j, "model", "deepseek-v4-flash"), flashRoute = rowsOf(j, "model-route", "deepseek-v4-flash"), flashBudget = rowsOf(j, "model-budget", "deepseek-v4-flash");
    ok(flash.length === 1 && flash[0].status === "pass" && /router http=504/.test(flash[0].detail) && /direct ok/.test(flash[0].detail), "H: deepseek-v4-flash stays healthy when its router probe fails and direct confirmation passes", flash);
    ok(flashRoute.length === 1 && flashRoute[0].status === "fail" && /http=504/.test(flashRoute[0].detail), "H: the deepseek-v4-flash router failure remains visible independently", flashRoute);
    ok(flashBudget.length === 1 && flashBudget[0].status === "pass" && directCalls(t, "@cf/deepseek-ai/deepseek-v4-flash-0731").length === 2, "H: direct confirmation is recorded for the canonical and -wa roster entries", flashBudget);
    ok(sweepWrite(t, "deepseek-v4-flash")[0].status === "ok", "H: direct confirmation clears the canonical model health failure");
    ok(rowsOf(j, "model", "deepseek-v4-flash-thinking").some((x) => x.status === "fail") && sweepWrite(t, "deepseek-v4-flash-thinking")[0].status === "degraded", "H: a router 5xx for a model without a direct mapping remains degraded");
  }
}

// 5. versions and mirror
ok(versionAtLeast(api.VERSION, "1.6.1"), "qnfo-ai-calibration is at least 1.6.1 (1.6.0 new capability: what ok means; 1.6.1 refreshes rows probed before it)", api.VERSION);
ok(versionAtLeast(api.VERSION, "1.6.4"), "qnfo-ai-calibration is at least 1.6.4 (SPEND-DOWNGRADE-INCONCLUSIVE-1)", api.VERSION);
ok(versionAtLeast(api.VERSION, "1.6.6"), "qnfo-ai-calibration is at least 1.6.6 (MODEL-PROBE-FALLBACK-1)", api.VERSION);
ok(versionAtLeast(api.VERSION, "1.6.9"), "qnfo-ai-calibration is at least 1.6.9 (MODEL-PROBE-DIRECT-CONFIRM-1)", api.VERSION);
ok(versionAtLeast(api.PROBER_VERSION, "2.3.17"), "the member PROBER_VERSION is at least 2.3.17", api.PROBER_VERSION);
ok(src === mirror, "deployed-current.worker.js is identical to worker.js");
ok(!/\*\//.test(src.split("\n")[5].replace(/\/\*[\s\S]*?\*\//g, "")), "the VERSION note closes every block comment it opens");

// 6. the migration
ok(/^-- APPLY-BY: ci$/m.test(mig) && /^-- DB: qnfo-audit$/m.test(mig) && /^-- Rollback: .+/m.test(mig), "migration carries APPLY-BY, DB and Rollback headers");
ok(!/\b(DELETE|DROP)\b/i.test(mig.split("\n").filter((l) => !l.startsWith("--")).join("\n")), "migration deletes and drops nothing (no BACKUP line needed)");
ok(/INTO failure_modes[\s\S]*health-ok-but-empty/.test(mig), "a failure_modes row health-ok-but-empty");
ok(/INTO remediation_contracts[\s\S]*fm-health-ok-but-empty[\s\S]*ai_model_health[\s\S]*ai_call_counters/.test(mig) && /c\.model LIKE ''%\/'' \|\| h\.model_id/.test(mig), "its fm- detector contract joins ai_model_health to ai_call_counters");
ok(/INTO control_registry[\s\S]*kill-switch[\s\S]*budget_probe/.test(mig) && /INTO ai_calibration_config[\s\S]*budget_probe/.test(mig), "the budget_probe switch has its ai_calibration_config row and its control_registry row");
ok(/neurons/i.test(mig) && /per day/i.test(mig), "the migration states the probe's cost per day");
ok(/rate.limit/i.test(mig) && /not (a )?measured|cannot (see|tell)|not recorded/i.test(mig), "the migration separates rate-limit errors from empty replies and says the counters do not record the class");
const dl = (mig.match(/INTO decision_log[\s\S]*$/) || [""])[0];
ok(/qwen3\.8-27b/.test(dl) && /nemotron-3-120b-a12b/.test(dl) && !/glm-5\.3-flash and qwen3\.8-27b read degraded/.test(dl), "decision_log predicts only what the probe can flip (qwen3.8-27b, nemotron), not glm-5.3-flash");
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
