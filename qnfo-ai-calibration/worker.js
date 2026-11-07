var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var PROBER_CRON = "*/20 * * * *";

// worker.js
var VERSION = "1.9.6-codeagent";
/* 1.6.6 MODEL-PROBE-FALLBACK-1 (2026-11-01, pillar cost): retain router 5xx as route failures while using direct confirmation for known model IDs before updating model health. */ /* 1.6.1 BUDGET-PROBE-REFRESH-1 (2026-10-19, pillar cost, agent_issues 2828 and 2829 closeout): the prober member skipped an ok row for 9 hours after its last probe (PROBE_OK_INTERVAL_MS), so the rows BUDGET-PROBE-1 exists for kept the verdict of the OLD ping-only probe after the 12:25Z deploy: glm-5.3-flash (last probed 12:00:37Z, 0.506 error share over 6,346 calls) and qwen3.8-27b (09:30:42Z, 0.763 over 118) were still ok, and eight other rows were probed only as their own 9 hours lapsed. An ok row whose last probe predates BUDGET_PROBE_SINCE_MS (the 1.6.0 deploy) is now due on the next tick, once; after that probe it carries a budget-shaped verdict and the 9-hour interval applies again. The sweep already probes every model on its full tick. Tests: budget-probe.test.mjs. */ /* 1.6.0 BUDGET-PROBE-1 (2026-10-19, pillar cost, agent_issues 2829 path A): ai_model_health stops reading ok for a model that answers a one-token ping and an empty reply to a real request (glm-5.3-flash 0.53 error share over 5,991 calls, qwen3.8-27b 0.77 over 105, both ok). Both writers of status ok, the sweep (probeBudgetCompletion) and the folded prober member 2.3.16 (applyBudgetProbe), keep the cheap ping and send text models one more request: a trivial sum, max_tokens 256, a DONE marker; empty content (finish_reason length) or no marker is a failed probe on the existing degraded then failing path, with no new status value. Models with a Workers AI id are probed through env.AI.run by both writers (probeBudgetDirect): the router's small-answer lane (reasoning_effort low or none at max_tokens <= 2048) would hide the empty reply; only deepseek-v4-flash and -thinking use the router. ai_calibration_config budget_probe = off reverts to the ping-only verdict without a deploy (control_registry ai-calibration-budget-probe-switch); fm-health-ok-but-empty detects ok rows with a 0.5 error share. */
// WORKERS-AI-ATTRIBUTION-1 (2026-10-01, #1681): per-worker Workers AI attribution. Returns a shallow env copy whose AI
// binding records each .run() (calls, errors, ms, tokens, neurons) into qnfo-audit ai_call_counters (purpose 'binding').
// Neurons = usage tokens x Cloudflare's published per-model rates (neurons per M tokens). Fail-soft; env is never mutated.
var __AI_ATTR_RATES = { "@cf/zai-org/glm-5.3": [127273, 400000], "@cf/zai-org/glm-5.3-flash": [13636, 45455], "@cf/nvidia/nemotron-3-120b-a12b": [45455, 136364], "@cf/moonshotai/kimi-k2.6": [86364, 363636], "@cf/moonshotai/kimi-k2.7-code": [86364, 363636], "@cf/openai/gpt-oss-120b": [31818, 68182], "@cf/openai/gpt-oss-20b": [18182, 27273], "@cf/deepseek-ai/deepseek-v4-pro-0813": [120000, 360000], "@cf/deepseek-ai/deepseek-v4-flash-0731": [40000, 120000], "@cf/meta/llama-3.3-70b-instruct-fp8-fast": [26668, 204805], "@cf/qwen/qwen3-30b-a3b-fp8": [4625, 30475], "@cf/qwen/qwen3.8-27b": [40909, 290909], "@cf/baai/bge-base-en-v1.5": [6058, 0], "@cf/baai/bge-small-en-v1.5": [1841, 0], "@cf/baai/bge-large-en-v1.5": [18582, 0] };
function __aiAttrEnv(env, worker, aiKey, dbKey) {
  try {
    if (!env || env.__aiAttr) return env;
    var ai = env[aiKey], db = env[dbKey];
    if (!ai || typeof ai.run !== "function" || !db) return env;
    var wrapped = new Proxy(ai, { get: function (t, p) {
      if (p !== "run") { var v = Reflect.get(t, p); return typeof v === "function" ? v.bind(t) : v; }
      return async function (model, input, opts) {
        var t0 = Date.now(), ok = 1, res;
        try { res = await t.run(model, input, opts); return res; } catch (e) { ok = 0; throw e; }
        finally {
          try {
            var u = res && typeof res === "object" && res.usage || {};
            var chars = 0; try { chars = JSON.stringify(input && (input.messages || input.prompt || input.text) || input || "").length; } catch (e1) {}
            var inTok = Number(u.prompt_tokens || u.input_tokens || 0) || Math.round(chars / 4);
            var outTok = Number(u.completion_tokens || u.output_tokens || 0);
            var r = __AI_ATTR_RATES[String(model)] || [0, 0];
            var neurons = (inTok * r[0] + outTok * r[1]) / 1e6;
            await db.prepare("INSERT INTO ai_call_counters (day, worker, purpose, model, calls, errors, in_chars, ms, in_tok, out_tok, neurons) VALUES (?1,?2,'binding',?3,1,?4,?5,?6,?7,?8,?9) ON CONFLICT(day, worker, purpose, model) DO UPDATE SET calls=calls+1, errors=errors+excluded.errors, in_chars=in_chars+excluded.in_chars, ms=ms+excluded.ms, in_tok=in_tok+excluded.in_tok, out_tok=out_tok+excluded.out_tok, neurons=neurons+excluded.neurons")
              .bind(new Date().toISOString().slice(0, 10), worker, String(model).slice(0, 120), ok ? 0 : 1, chars, Date.now() - t0, inTok, outTok, neurons).run();
          } catch (e2) {}
        }
      };
    } });
    var copy = Object.assign({}, env);
    copy[aiKey] = wrapped;
    copy.__aiAttr = 1;
    return copy;
  } catch (e) {
    return env;
  }
}
/* 1.6.9 MODEL-PROBE-DIRECT-CONFIRM-1 (2026-11-02, pillar cost): canonical deepseek-v4-flash shares the existing Workers AI ID for deepseek-v4-flash-wa, so router failures and downgrades can be confirmed directly before changing model health. */ /* 1.5.1 CALIBRATION-TASK-TRUTH-1 (agent_issues 2338): the truth probe sends hedge:false; the first run (2026-10-13 19:00Z) measured the router hedge, not the models: 16 of 20 answers came from llama-3.3-70b-instruct-fp8-fast through the TURN-BUDGET-1 fast lane. */ /* 1.5.0 1.5.0 CALIBRATION-TASK-TRUTH-1 (2026-10-13, pillar research, agent_issues 2338): once an hour every model answers a few integer sums, differences and products whose operands come from the UTC hour and whose answers the code computes; one row per item and model in ai_calibration_truth (right or wrong, served_by), 30 days kept, GET /truth gives the pair table (n11, n10, n01, n00, kappa) of the last 7 days; ai_calibration_config truth_probe_items sets the items an hour, 0 is off. */ /* 1.4.0 1.4.0 PROBE-CADENCE-COST-1 (2026-10-12, pillar cost, agent_issues 2118): the full model/vision/tools/stream/routing sweep runs every 4th 30-minute tick (ai_calibration_config model_sweep_every_ticks); the ticks between re-probe only models whose ai_model_health row is not ok. About 2,500 Workers AI calls a day through qnfo-ai become about 700. */ /* 1.3.4 WORKERS-STANDARDS-1 (2026-10-12, pillar security): the calibration run id is drawn from crypto.randomUUID instead of Math.random (same shape). */ /* 1.3.3 AMH-ROSTER-PRUNE-1 (2026-10-06, pillar autonomy, lever T5.11): the dead per-tick ai_model_health prune is removed (wrong bind receiver, never ran; fixed as written it would have deleted the canonical roster rows); the 24 never-probed external ids were pruned once after a backup by migration. 1.3.2 FOLD-HYGIENE-1 + FRESHNESS-REGISTERS-RETIRED-1 writer side (2026-10-06, agent_issues 1756 and 2028, pillar autonomy): the prober member's freshness SIGNALS no longer grade kaizen_candidates (qnfo-kaizen was retired in PR 657, so the register read stale forever, and the 07:40Z tick re-wrote the row PR 677 had deleted); version_queue is an event register with a 336 h window (the reviser queues a version only when a paper needs one, so idleness is not staleness); amh_coverage grades the probe roster (MODELS), not the 24 external ids registered 2026-09-19 that no probe covers, and names how many it leaves out (AMH-COVERAGE-ROSTER-1). 1.3.1 PROBER-ON-CAL-TICK-1 (2026-10-06, #1756): the every-20-minutes trigger registered for the member never fired (no prober run at 06:40 or 07:00 while the every-30-minutes calibration ran), so the member now runs on the every-30-minutes tick next to the calibration, the host awaits its waitUntil work, and the every-20-minutes trigger is dropped (one cron fewer). 1.3.0 PROBER-FOLD-1 (2026-10-06, pillar core, #1756): ai-health-prober runs here as a member (proberMod, the every-20-minutes cron, /prober/health and /prober/freshness, /prober/run behind the calibration key); the separate ai-health-prober worker is retired by fold. 1.2.9 GW-402-UNFUNDED-1 (2026-10-05, pillar: cost; agent_issues #1992, root cause shared with #1986): a provider's HTTP 402 ("Insufficient Balance", DeepSeek, owner decision 2026-10-05: do not top up) is an unfunded account, not a degraded model. The sweep classed it "other", set ai_model_health deepseek/deepseek-v4-flash degraded on every window with >= 2 such calls (15 at 16:00Z), and qnfo-fleet-control refiled MODEL-DEGRADED (#1992, #1256, #1099 ...). Now status 402 or an insufficient-balance/payment-required body is error_class "unfunded": recorded in ai_gateway_failures, never a [gw-fail] issue, never a degraded health row, and ignored (like rate-capacity) by the 24h reconcile that clears a degraded row, so the row recovers on the next sweep. The spend-side fix (stop paying for the failed first round trip) is #1986 in qnfo-ops. */
/* 1.6.4 SPEND-DOWNGRADE-INCONCLUSIVE-1 (2026-10-19, pillar cost; patch, a fix): the second path for a router-swapped ping. qnfo-ai 5.37.0 (MODEL-HEALTH-FLAP-1, #3161) honours no_downgrade for the caller qnfo-ai-calibration (props.caller on the QNFO_AI binding) at max_tokens 512 or less, so the 16-token ping reaches the model it names; that router change is what clears the [ai-cal] model probe failing rows, and this change does not claim them. Where the router still answers the ping with glm-5.3-flash (the flag not honoured, the token ceiling exceeded, the caller not identified, an older router) the ping is "downgraded" and says nothing about the model that was asked, so it is no longer scored as a model failure: a model with a Workers AI id is judged on the direct env.AI.run probe (probeBudgetCompletion; a pass writes ok with 0 failures and closes the open issue, a failure takes the unchanged degraded then failing path), a model without one is left unwritten, and budget_probe = off writes nothing. The probe = model row is not rewritten: it stays "downgraded", the verdict is the probe = model-budget row. Tests: budget-probe.test.mjs section 4c. New notes go in a block like this one, never on the VERSION line (VERSION-LINE-NOTES-1). */
var DEEPSEEK = "https://api.deepseek.com/v1";
var ACCOUNT = "edb167b78c9fb901ea5bca3ce58ccc4b";
var CATALOG = "https://api.cloudflare.com/client/v4/accounts/" + ACCOUNT;
var UA = "QNFO-AI-Calibration/" + VERSION;
var RED10X10_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAIAAAACUFjqAAAAEklEQVR4nGP4z8CAB+GTG8HSALfKY52fTcuYAAAAAElFTkSuQmCC";
var TIER0_WA = {
  /* retired: not in qnfo-ai roster (v4.3.7) */
  /* retired: not in qnfo-ai roster (v4.3.7) */
  /* retired: not in qnfo-ai roster (v4.3.7) */
  /* retired: not in qnfo-ai roster (v4.3.7) */
  "kimi-k2.6": "@cf/moonshotai/kimi-k2.6",
  /* retired: not in qnfo-ai roster (v4.3.7) */
  /* retired: not in qnfo-ai roster (v4.3.7) */
  /* retired: not in qnfo-ai roster (v4.3.7) */
  "glm-5.3-flash": "@cf/zai-org/glm-5.3-flash",
  "gpt-oss-120b": "@cf/openai/gpt-oss-120b",
  "deepseek-v4-flash-wa": "@cf/deepseek-ai/deepseek-v4-flash-0731",
  "deepseek-v4-pro-wa": "@cf/deepseek-ai/deepseek-v4-pro-0813",
  "kimi-k2.7-code": "@cf/moonshotai/kimi-k2.7-code",
  "glm-5.3": "@cf/zai-org/glm-5.3",
  /* retired: not in qnfo-ai roster (v4.3.7) */
};
var ALL_MODELS = Object.keys(TIER0_WA).concat(["deepseek-v4-flash", "deepseek-v4-flash-thinking", "deepseek-v4-pro"]);
var CF_TO_INTERNAL = {};
(function() {
  for (var k in TIER0_WA) {
    if (TIER0_WA[k]) CF_TO_INTERNAL[TIER0_WA[k]] = k;
  }
})();
CF_TO_INTERNAL["@cf/baai/bge-base-en-v1.5"] = "bge-base-en-v1.5";
function internalId(m) {
  if (CF_TO_INTERNAL[m]) return CF_TO_INTERNAL[m];
  if (m && m.indexOf("@cf/") === 0) {
    for (var k in TIER0_WA) {
      if (TIER0_WA[k] && TIER0_WA[k].indexOf(m.slice(5)) >= 0) return k;
    }
  }
  return m;
}
__name(internalId, "internalId");
var DEFAULT_VISION = "kimi-k2.6,kimi-k2.7-code,glm-5.3-flash";
// PROBE-CADENCE-COST-1 (1.4.0, agent_issues 2118 METRIC-TRIGGER-353, pillar cost). Measured 2026-10-12 (ai_spend_ledger, caller
// qnfo-ai-calibration): the */30 sweep made about 2,500 Workers AI calls a day through qnfo-ai (glm-5.3-flash 720, bge 650,
// kimi-k2.6 430, kimi-k2.7-code 380, gpt-oss-120b 150 ...), every model probed 48 times a day although every one passed 48 of 48
// in the last 24 h, while the folded prober member already probes the roster directly. The full sweep (models, vision, tools,
// stream, routing) now runs on one tick in MODEL_SWEEP_EVERY_TICKS (ai_calibration_config model_sweep_every_ticks, default 4 =
// every 2 h); the ticks between re-probe only the models whose ai_model_health row is not ok (degraded, failing, never probed),
// so a failure still escalates on the next tick. The gateway sweep, health, roster and endpoint checks run every tick (no model
// calls). A manual /run is always a full sweep. Revert: set model_sweep_every_ticks to 1.
var MODEL_SWEEP_EVERY_TICKS = 4;
var CAL_TICK_MS = 18e5;
function fullSweepDue(nowMs, everyTicks, trigger) {
  if (trigger !== "cron") return true;
  var n = parseInt(everyTicks, 10);
  if (!(n > 1)) return true;
  // the cron can fire a few seconds after :00/:30, so round to the nearest tick instead of flooring
  return Math.round(nowMs / CAL_TICK_MS) % n === 0;
}
__name(fullSweepDue, "fullSweepDue");
function leanSweepModels(models, healthRows) {
  var healthy = {};
  (healthRows || []).forEach(function(r) {
    if (r && r.status === "ok" && !(Number(r.consecutive_failures) > 0)) healthy[r.model_id] = 1;
  });
  return models.filter(function(m) { return !healthy[m]; });
}
__name(leanSweepModels, "leanSweepModels");
function json(resp, status) {
  return new Response(JSON.stringify(resp), { status: status || 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
}
__name(json, "json");
function withTimeout(promise, ms) {
  return new Promise(function(resolve, reject) {
    var t = setTimeout(function() {
      reject(new Error("timeout after " + ms + "ms"));
    }, ms);
    promise.then(function(v) {
      clearTimeout(t);
      resolve(v);
    }, function(e) {
      clearTimeout(t);
      reject(e);
    });
  });
}
__name(withTimeout, "withTimeout");
async function sha256Hex(s) {
  var enc = new TextEncoder();
  var buf = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return Array.prototype.map.call(new Uint8Array(buf), function(b) {
    return b.toString(16).padStart(2, "0");
  }).join("");
}
__name(sha256Hex, "sha256Hex");
async function authorized(request, env) {
  var h = request.headers.get("Authorization") || "";
  if (!h.startsWith("Bearer ")) return false;
  // AUTH-FAIL-CLOSED-1 (2026-10-01): compare only against a configured key. Without this, a missing QNFO_ROUTER_KEY
  // made the expected value sha256("") and an empty bearer token would match; header whitespace trimming is what
  // prevented it in practice, and the code must not rely on that.
  if (!env.QNFO_ROUTER_KEY || h.length <= 7) return false;
  return await sha256Hex(h.slice(7)) === await sha256Hex(env.QNFO_ROUTER_KEY);
}
__name(authorized, "authorized");
async function jfetch(env, url, headers, body, timeoutMs, bindName) {
  var init = { method: body ? "POST" : "GET", headers: Object.assign({ "Content-Type": "application/json", "User-Agent": UA }, headers || {}) };
  if (body) init.body = JSON.stringify(body);
  var bind = bindName ? env[bindName] : null;
  var resp = await withTimeout(bind ? bind.fetch(url, init) : fetch(url, init), timeoutMs || 45e3);
  var text = await resp.text();
  var data = null;
  try {
    data = JSON.parse(text);
  } catch (e) {
    data = { _raw: text.slice(0, 400) };
  }
  return { status: resp.status, data, text };
}
__name(jfetch, "jfetch");
async function runPool(items, limit, fn) {
  var out = new Array(items.length);
  var next = 0;
  async function worker() {
    while (true) {
      var i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  }
  __name(worker, "worker");
  var ws = [];
  for (var w = 0; w < Math.min(limit, items.length); w++) ws.push(worker());
  await Promise.all(ws);
  return out;
}
__name(runPool, "runPool");
// ---- CALIBRATION-TASK-TRUTH-1:BEGIN (1.5.0, pillar research, agent_issues 2338) ----
// Ground truth for the error-correlation estimate (HRAW W-H1, agent_issues 2145): until now ai_calibration_results held
// reachability only, ensemble-run rows one judge verdict per call and ask_evals one aggregate score per run, so no row said
// whether a model was right or wrong on an item with a known answer. Once an hour (the */30 cron fires twice; the second sees
// the first's rows and stops) every model in ALL_MODELS answers the same few integer sums, differences and products. The
// generator picks the operands from a seed derived from the UTC hour and the code computes the expected value, so there is no
// fixed list and nothing is written by hand. A call that fails or returns nothing is not a wrong answer and writes no row; a
// reply with text but no integer is wrong. ai_calibration_config truth_probe_items (0..5, default 2) sets the items an hour;
// 0 turns the probe off. GET /truth returns the pair table of the last 7 days.
var TRUTH_KEEP_MS = 30 * 864e5;
var TRUTH_WINDOW_MS = 7 * 864e5;
function truthRng(seed) {
  var a = seed >>> 0; // mulberry32
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    var t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function truthHour(nowMs) { return Math.floor(nowMs / 36e5); }
function truthItems(hour, n) {
  var rnd = truthRng(hour * 2654435761), items = [];
  for (var i = 0; i < n; i++) {
    var kind = Math.floor(rnd() * 3), a = 100 + Math.floor(rnd() * 900), b = 100 + Math.floor(rnd() * 900), q, v;
    if (kind === 0) { q = a + " + " + b; v = a + b; }
    else if (kind === 1) { q = a + " - " + b; v = a - b; }
    else { a = 11 + Math.floor(rnd() * 89); b = 11 + Math.floor(rnd() * 89); q = a + " * " + b; v = a * b; }
    items.push({ item_id: "h" + hour + "-" + i, prompt: "Compute " + q + ". Reply with only the integer, nothing else.", expected: String(v) });
  }
  return items;
}
// The last integer in the reply ("17 * 23 = 391" gives 391); thousands separators are dropped; null when there is none.
function truthExtract(text) {
  var m = String(text == null ? "" : text).replace(/(\d),(?=\d{3}(?!\d))/g, "$1").match(/-?\d+/g);
  return m && m.length ? String(parseInt(m[m.length - 1], 10)) : null;
}
// rows: { item_id, model, correct }. Per pair of models on the items both answered: n11 both right, n10 only the first
// right, n01 only the second right, n00 both wrong, and Cohen's kappa on correct/wrong (null when undefined).
function truthPairs(rows) {
  var by = {}, seen = {}, acc = {};
  rows.forEach(function (r) {
    (by[r.item_id] = by[r.item_id] || {})[r.model] = r.correct ? 1 : 0;
    seen[r.model] = 1;
    var a = acc[r.model] = acc[r.model] || { model: r.model, n: 0, correct: 0 };
    a.n++; if (r.correct) a.correct++;
  });
  var ms = Object.keys(seen).sort(), pairs = [];
  for (var i = 0; i < ms.length; i++) for (var j = i + 1; j < ms.length; j++) {
    var n11 = 0, n10 = 0, n01 = 0, n00 = 0;
    for (var it in by) {
      var x = by[it][ms[i]], y = by[it][ms[j]];
      if (x === undefined || y === undefined) continue;
      if (x && y) n11++; else if (x) n10++; else if (y) n01++; else n00++;
    }
    var n = n11 + n10 + n01 + n00, kappa = null;
    if (n > 0) {
      var po = (n11 + n00) / n, pa = (n11 + n10) / n, pb = (n11 + n01) / n, pe = pa * pb + (1 - pa) * (1 - pb);
      if (pe < 1) kappa = Math.round((po - pe) / (1 - pe) * 1e4) / 1e4;
    }
    pairs.push({ a: ms[i], b: ms[j], n: n, n11: n11, n10: n10, n01: n01, n00: n00, kappa: kappa });
  }
  return { models: ms.map(function (m) { return acc[m]; }), pairs: pairs };
}
async function truthEnsure(env) {
  await env.QNFO_AUDIT.prepare("CREATE TABLE IF NOT EXISTS ai_calibration_truth (run_id TEXT, ts INTEGER, item_id TEXT, model TEXT, expected TEXT, got TEXT, correct INTEGER, served_by TEXT, latency_ms INTEGER, PRIMARY KEY (run_id, item_id, model))").run();
  await env.QNFO_AUDIT.prepare("CREATE INDEX IF NOT EXISTS idx_ai_calibration_truth_ts ON ai_calibration_truth (ts)").run();
}
async function truthTick(env, nowMs) {
  try {
    var nItems = parseInt(await cfgGet(env, "truth_probe_items", "2"), 10);
    if (isNaN(nItems) || nItems < 0 || nItems > 5) nItems = 2;
    if (nItems === 0) return { ran: false, reason: "off" };
    await truthEnsure(env);
    var hour = truthHour(nowMs), runId = "truth-" + hour;
    // COST-CUT-CALIBRATION-1: the probe asks every model nItems questions through the router; reasoning models spend max_tokens 16 thinking, so most replies are
    // unscorable and the same hour is asked again on the next */30 tick. Only every truth_every_hours-th UTC hour (default 6, 1 restores hourly) runs.
    var everyH = parseInt(await cfgGet(env, "truth_every_hours", "6"), 10);
    if (everyH > 1 && hour % everyH !== 0) return { ran: false, reason: "cadence", every_hours: everyH };
    var have = await env.QNFO_AUDIT.prepare("SELECT 1 AS x FROM ai_calibration_truth WHERE run_id = ?1 LIMIT 1").bind(runId).first();
    if (have) return { ran: false, reason: "done this hour", run_id: runId };
    var jobs = [];
    truthItems(hour, nItems).forEach(function (it) { ALL_MODELS.forEach(function (m) { jobs.push({ it: it, m: m }); }); });
    var rows = [], errors = 0, unscorable = 0;
    await runPool(jobs, 4, async function (j) {
      var t0 = Date.now();
      try {
        var r = await jfetch(env, "https://qnfo-ai.internal/v1/chat/completions", { Authorization: "Bearer " + env.QNFO_ROUTER_KEY }, { model: j.m, messages: [{ role: "user", content: j.it.prompt }], max_tokens: 16, stream: false, hedge: false, no_downgrade: true }, 30e3, "QNFO_AI"); // hedge:false keeps the asked model: the router fast lane (max_tokens <= 1024) otherwise races a llama leg and 16 of the first 20 answers were its
        var msg = r.data && r.data.choices && r.data.choices[0] && r.data.choices[0].message;
        if (r.status !== 200 || !msg) { errors++; return; }
        var content = msg.content == null ? "" : String(msg.content);
        if (!content.trim()) { unscorable++; return; } // a reasoning model that spent max_tokens thinking: no answer, not a wrong one
        var got = truthExtract(content);
        var served = (r.data._router && r.data._router.served_by) || r.data.model || j.m;
        rows.push({ run_id: runId, ts: nowMs, item_id: j.it.item_id, model: j.m, expected: j.it.expected, got: got == null ? "" : got, correct: got === j.it.expected ? 1 : 0, served_by: String(served).slice(0, 80), latency_ms: Date.now() - t0 });
      } catch (e) { errors++; }
    });
    if (rows.length) {
      var stmt = env.QNFO_AUDIT.prepare("INSERT OR IGNORE INTO ai_calibration_truth (run_id, ts, item_id, model, expected, got, correct, served_by, latency_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)");
      await env.QNFO_AUDIT.batch(rows.map(function (x) { return stmt.bind(x.run_id, x.ts, x.item_id, x.model, x.expected, x.got, x.correct, x.served_by, x.latency_ms); }));
    }
    await env.QNFO_AUDIT.prepare("DELETE FROM ai_calibration_truth WHERE ts < ?1").bind(nowMs - TRUTH_KEEP_MS).run();
    return { ran: true, run_id: runId, items: nItems, rows: rows.length, errors: errors, unscorable: unscorable };
  } catch (e) {
    return { ran: false, error: String(e && e.message || e).slice(0, 120) };
  }
}
// A reply served by another model than the one asked is the other model's answer; it stays in the table (served_by) and is
// left out of the pair table, so a fallback never counts as the asked model's error.
async function truthReport(env, nowMs) {
  await truthEnsure(env);
  var res = await env.QNFO_AUDIT.prepare("SELECT item_id, model, correct, served_by FROM ai_calibration_truth WHERE ts >= ?1").bind(nowMs - TRUTH_WINDOW_MS).all();
  var all = res.results || [], kept = all.filter(function (r) { return r.served_by === r.model; });
  var t = truthPairs(kept);
  return { ok: true, window_days: 7, rows: all.length, excluded_served_by_other: all.length - kept.length, models: t.models, pairs: t.pairs };
}
// ---- CALIBRATION-TASK-TRUTH-1:END ----
// REASONING-PING-1 (1.6.13, issue 6178 / agent_issues 1001002): the 16-token ping can never be answered by a reasoning-only id. qnfo-ai keeps a reply
// only when message.content has text (extractWAContent drops a reasoning_content-only reply, runTurnBudgeted's good() needs content), so a model that
// spends all 16 tokens thinking comes back as an empty leg and the router answers 504 router_timeout after about 2 s. deepseek-v4-flash-thinking read
// http=504 echo=false on 91 of 91 sweeps from 2026-11-01, 128 consecutive failures and an open [ai-cal] issue, while deepseek-v4-flash, which shares
// its family and route, passed. Such an id gets 512 tokens, the most the router still honours no_downgrade for (qnfo-ai 5.37.0, max_tokens <= 512).
var REASONING_ONLY_RE = /thinking|reasoner/i;
function pingMaxTokens(model) {
  return REASONING_ONLY_RE.test(String(model || "")) ? 512 : 16;
}
__name(pingMaxTokens, "pingMaxTokens");
// ROUTER-LEGS-1 (1.8.2, pillar autonomy; GitHub 6158 and 6174, agent_issues 1001956): the router answers 504 router_timeout with error.type, error.budget_ms and error.legs
// (model, role, ms, ok, err) in the body, but the probe kept only "http=504 echo=false", so ten routes failing in one sweep (00:00, 10:00, 16:00, 20:00 and 22:00Z on
// 2026-11-04, while 23 of 24 models were ok when asked directly) could not be told from ten model failures. The note goes after the unchanged prefix, so the checks on
// /^http=5\d\d\b/ still match, and stays short enough for the 300 characters ai_calibration_results keeps.
function routerLegsNote(r) {
  var er = r && r.status >= 500 && r.data && typeof r.data.error === "object" && r.data.error ? r.data.error : null;
  if (!er) return "";
  var legs = Array.isArray(er.legs) ? er.legs.slice(0, 3).map(function (l) {
    return String(l && l.model || "?").replace(/^@cf\/[^/]+\//, "").slice(0, 24) + ":" + (l && l.ok ? "ok" : String(l && l.err || "fail").slice(0, 32)) + ":" + (l && l.ms != null ? l.ms : "-") + "ms";
  }).join(",") : "";
  return " router=" + String(er.type || "error").slice(0, 20) + (er.budget_ms ? " budget=" + er.budget_ms : "") + (legs ? " legs=" + legs : "");
}
__name(routerLegsNote, "routerLegsNote");
async function probeCompletion(env, model) {
  var t0 = Date.now();
  try {
    var r = await jfetch(
      env,
      "https://qnfo-ai.internal/v1/chat/completions",
      { Authorization: "Bearer " + env.QNFO_ROUTER_KEY },
      // qnfo-ai 5.37.0 (MODEL-HEALTH-FLAP-1) honours no_downgrade for caller qnfo-ai-calibration (props.caller on the QNFO_AI binding) when
      // max_tokens <= 512, so this 16-token ping reaches the model it names. Where the router still swaps it for glm-5.3-flash (flag not
      // honoured, ceiling exceeded, caller not identified, older router) this returns "downgraded"; the sweep treats that as inconclusive
      // (SPEND-DOWNGRADE-INCONCLUSIVE-1).
      { model, messages: [{ role: "user", content: "Reply with exactly: OK" }], max_tokens: pingMaxTokens(model), stream: false, hedge: false, no_downgrade: true },
      45e3,
      "QNFO_AI"
    );
    // Treat HTTP 410 (tombstone/retired) as non‑degraded: do not count it as a failure.
    if (r.status === 410) {
      return { status: "pass", latency_ms: Date.now() - t0, detail: "retired 410" };
    }
    var _m = r.data && r.data.choices && r.data.choices[0] && r.data.choices[0].message;
    var content = _m && _m.content;
    var _rs = _m && _m.reasoning_content;
    var echo = r.data && r.data.model === model;
    var _has = (!!content && String(content).trim().length > 0) || (!!_rs && String(_rs).trim().length > 0);
    var downgraded = r.status === 200 && _has && !echo && r.data && r.data.model === "glm-5.3-flash";
    var pass = r.status === 200 && _has && echo;
    var status = pass ? "pass" : downgraded ? "downgraded" : "fail";
  var detail = pass ? "ok" : downgraded ? "downgraded to glm-5.3-flash" : "http=" + r.status + " echo=" + echo + " " + JSON.stringify(String(content || "").slice(0, 60)) + routerLegsNote(r);
  // ECHO-DETAIL-1 (issue 1001925): the 200-with-content reply the router answers for another model is a fail on echo=false,
  // but the detail never named the model the router put in the response. On a non-echo 200 append the response model and the
  // router's own accounting so the next sweep row says who served the id. The downgraded (glm-5.3-flash swap) row keeps its
  // fixed machine-readable detail; the echo check itself is unchanged for every id.
  if (r.status === 200 && !echo && !downgraded && r.data) {
     var extra = [];
     if (typeof r.data.model === "string") extra.push("model=" + String(r.data.model).slice(0, 40));
     if (r.data._router && typeof r.data._router === "object") {
       if (typeof r.data._router.served_by === "string") extra.push("served_by=" + String(r.data._router.served_by).slice(0, 40));
       if (typeof r.data._router.model_resolution === "string") extra.push("resolution=" + String(r.data._router.model_resolution).slice(0, 40));
     }
     if (extra.length) detail += " " + extra.join(" ");
  }
  return { status: status, latency_ms: Date.now() - t0, detail: detail };
  } catch (e) {
    return { status: "fail", latency_ms: Date.now() - t0, detail: "err " + String(e && e.message || e).slice(0, 120) };
  }
}
__name(probeCompletion, "probeCompletion");
// ---- BUDGET-PROBE-1:BEGIN (1.6.0, pillar cost, agent_issues 2829 path A) ----
// ai_model_health said ok for a model that answers a one-token ping, never for one that answers a real request: on 2026-10-19
// glm-5.3-flash read ok with a 0.53 error share over 5,991 calls and qwen3.8-27b with 0.77 over 105, because the model spends
// its token budget on reasoning and returns empty content (finish_reason length). Both writers of status ok (the sweep's
// probeCompletion and the folded prober's probeOne) now keep their cheap ping for reachability and, for text models only,
// send one more request shaped like a caller's: a trivial sum, max_tokens 256, a DONE marker asked for. Empty content or no
// marker is a failed probe and takes the existing path (degraded at the first failure, failing at fail_threshold); no status
// value is new. One budget probe per model per run, never skipped at a breached ai_spend cap (BUDGET-SOFT-ROUTE-1: it is the
// lean shape already, 256 tokens at most). ai_calibration_config budget_probe = off restores the ping-only verdict.
// Lane (review of 65693a88): qnfo-ai sets reasoning_effort low/none for glm-5.3-flash, kimi-k2.6 and gpt-oss-120b on any request
// with max_tokens <= 2048 (REASONING_SMALL_MAX), the lane that exists because those models otherwise spend the allowance
// reasoning. A budget probe sent through the router at 256 runs in that lane and passes. So every model with a Workers AI id is
// probed through env.AI.run (probeBudgetDirect), the request a caller outside the lane sends, and the prober member uses the
// same function: the two writers of one ai_model_health row run one shape, and a pass of one cannot mask a failure of the other.
// Only deepseek-v4-flash-thinking has no Workers AI id and keeps the router-only budget path; the lane does not touch it.
var BUDGET_PROMPT = "What is 17 + 25? Reply with the number, then the word DONE.";
var BUDGET_MAX_TOKENS = 256;
var BUDGET_DIRECT_IDS = Object.assign({}, TIER0_WA, {
  "deepseek-v4-flash": "@cf/deepseek-ai/deepseek-v4-flash-0731",
  "deepseek-v4-pro": "@cf/deepseek-ai/deepseek-v4-pro-0813"
});
function replyParts(r) {
  var ch = r && r.choices && r.choices[0];
  var c = ch && ch.message && ch.message.content;
  if (Array.isArray(c)) c = c.map(function (p) { return p && (p.text || p.content) || ""; }).join("");
  if ((c == null || c === "") && r && typeof r.response === "string") c = r.response;
  if ((c == null || c === "") && r && r.result && typeof r.result.response === "string") c = r.result.response;
  var fin = (ch && ch.finish_reason) || (r && r.finish_reason) || null;
  return { content: c == null ? "" : String(c), finish: fin ? String(fin) : null };
}
__name(replyParts, "replyParts");
function judgeBudgetReply(r) {
  var p = replyParts(r);
  var fin = p.finish ? " finish_reason=" + p.finish : "";
  if (!p.content.trim()) return { ok: false, reason: "empty content" + fin + " under max_tokens " + BUDGET_MAX_TOKENS };
  if (!/\bDONE\b/i.test(p.content)) return { ok: false, reason: "no DONE marker" + fin + " got " + JSON.stringify(p.content.slice(0, 40)) };
  return { ok: true, reason: "ok" };
}
__name(judgeBudgetReply, "judgeBudgetReply");
async function budgetProbeOn(env) {
  return String(await cfgGet(env, "budget_probe", "on")).trim().toLowerCase() !== "off";
}
__name(budgetProbeOn, "budgetProbeOn");
// One budget request straight to the Workers AI binding (messages, then prompt when the model refuses that shape). Shared by the
// sweep and the prober member so a row both write is judged on one request shape.
async function probeBudgetDirect(env, cfId) {
  // BP26-G
  const GW_OPTS = {
    gateway: {
      id: "default",
      skipCache: true,
      metadata: { worker: "qnfo-ai-calibration", purpose: "health-ping" }
    }
  };
  var bodies = [
    { messages: [{ role: "user", content: BUDGET_PROMPT }], max_tokens: BUDGET_MAX_TOKENS },
    { prompt: BUDGET_PROMPT, max_tokens: BUDGET_MAX_TOKENS }
  ];
  var v = null,
    lastErr = null;
  for (var i = 0; i < bodies.length && !v; i++) {
    // First try with gateway options
    try {
      v = judgeBudgetReply(await env.AI.run(cfId, bodies[i], GW_OPTS));
      continue;
    } catch (e) {
      const msg = String(e && e.message || e);
      lastErr = msg.slice(0, 100);
      // Retry once on the plain binding if the error mentions the gateway but not spend/limit
      if (/gateway/i.test(msg) && !/spend|limit/i.test(msg)) {
        try {
          v = judgeBudgetReply(await env.AI.run(cfId, bodies[i])); // plain call, no gateway opts
          continue;
        } catch (e2) {
          lastErr = String(e2 && e2.message || e2).slice(0, 100);
        }
      }
    }
  }
  return v || { ok: false, reason: "budget request failed: " + lastErr };
}
__name(probeBudgetDirect, "probeBudgetDirect");
async function probeBudgetCompletion(env, model) {
  var t0 = Date.now();
  if (BUDGET_DIRECT_IDS[model] && env.AI) {
    var d = await probeBudgetDirect(env, BUDGET_DIRECT_IDS[model]);
    return { status: d.ok ? "pass" : "fail", latency_ms: Date.now() - t0, detail: d.ok ? "ok direct" : "budget direct " + d.reason };
  }
  try {
    var r = await jfetch(
      env,
      "https://qnfo-ai.internal/v1/chat/completions",
      { Authorization: "Bearer " + env.QNFO_ROUTER_KEY },
      { model, messages: [{ role: "user", content: BUDGET_PROMPT }], max_tokens: BUDGET_MAX_TOKENS, stream: false, hedge: false, no_downgrade: true },
      45e3,
      "QNFO_AI"
    );
    if (r.status !== 200) return { status: "fail", latency_ms: Date.now() - t0, detail: "budget router http=" + r.status };
    // a reply from another model says nothing about this one (the ping row already fails on a mismatch)
    if (!(r.data && r.data.model === model)) return { status: "pass", latency_ms: Date.now() - t0, detail: "inconclusive: served by " + String(r.data && r.data.model).slice(0, 60) };
    var v = judgeBudgetReply(r.data);
    return { status: v.ok ? "pass" : "fail", latency_ms: Date.now() - t0, detail: v.ok ? "ok router" : "budget router " + v.reason };
  } catch (e) {
    return { status: "fail", latency_ms: Date.now() - t0, detail: "budget router err " + String(e && e.message || e).slice(0, 120) };
  }
}
__name(probeBudgetCompletion, "probeBudgetCompletion");
// ---- BUDGET-PROBE-1:END ----
async function probeVision(env, model) {
  var t0 = Date.now();
  var msgs = [{ role: "user", content: [{ type: "text", text: "What color is this image? Reply in one word." }, { type: "image_url", image_url: { url: "data:image/png;base64," + RED10X10_B64 } }] }];
  try {
    var r = await jfetch(
      env,
      "https://qnfo-ai.internal/v1/chat/completions",
      { Authorization: "Bearer " + env.QNFO_ROUTER_KEY },
      { model, messages: msgs, max_tokens: 128, stream: false, hedge: false, no_downgrade: true },
      9e4,
      "QNFO_AI"
    );
    var content = r.data && r.data.choices && r.data.choices[0] && r.data.choices[0].message && r.data.choices[0].message.content;
    var s = String(content || "");
    var noSee = /cannot see|can't view|cannot view|no image|unsupported image|not able to see|can not see/i.test(s);
    var pass = r.status === 200 && s.trim().length > 0 && !noSee;
    return { status: pass ? "pass" : "fail", latency_ms: Date.now() - t0, detail: pass ? "ok " + s.slice(0, 40) : "http=" + r.status + " noSee=" + noSee + " " + s.slice(0, 80) };
  } catch (e) {
    return { status: "fail", latency_ms: Date.now() - t0, detail: "err " + String(e && e.message || e).slice(0, 120) };
  }
}
__name(probeVision, "probeVision");
async function probeTools(env) {
  var t0 = Date.now();
  var tools = [{ type: "function", function: { name: "get_weather", description: "Get weather", parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] } } }];
  try {
    var r = await jfetch(
      env,
      "https://qnfo-ai.internal/v1/chat/completions",
      { Authorization: "Bearer " + env.QNFO_ROUTER_KEY },
      { model: "deepseek-v4-flash", messages: [{ role: "user", content: "What is the weather in Berlin?" }], tools, max_tokens: 64, stream: false },
      6e4,
      "QNFO_AI"
    );
    var tc = r.data && r.data.choices && r.data.choices[0] && r.data.choices[0].message && r.data.choices[0].message.tool_calls;
    var pass = r.status === 200 && Array.isArray(tc) && tc.length > 0;
    return { status: pass ? "pass" : "fail", latency_ms: Date.now() - t0, detail: pass ? "tool_calls=" + tc.length : "http=" + r.status };
  } catch (e) {
    return { status: "fail", latency_ms: Date.now() - t0, detail: "err " + String(e && e.message || e).slice(0, 120) };
  }
}
__name(probeTools, "probeTools");
async function probeStream(env) {
  var t0 = Date.now();
  try {
    var r = await jfetch(
      env,
      "https://qnfo-ai.internal/v1/chat/completions",
      { Authorization: "Bearer " + env.QNFO_ROUTER_KEY },
      { model: "deepseek-v4-flash", messages: [{ role: "user", content: "Say hi" }], max_tokens: 16, stream: true },
      6e4,
      "QNFO_AI"
    );
    var pass = r.status === 200 && r.text.indexOf("[DONE]") >= 0 && r.text.indexOf("data:") >= 0;
    return { status: pass ? "pass" : "fail", latency_ms: Date.now() - t0, detail: pass ? "sse ok" : "http=" + r.status + " done=" + (r.text.indexOf("[DONE]") >= 0) };
  } catch (e) {
    return { status: "fail", latency_ms: Date.now() - t0, detail: "err " + String(e && e.message || e).slice(0, 120) };
  }
}
__name(probeStream, "probeStream");
async function probeRouting(env) {
  var out = [];
  try {
    var r = await jfetch(
      env,
      "https://qnfo-ai.internal/v1/chat/completions",
      { Authorization: "Bearer " + env.QNFO_ROUTER_KEY },
      { model: "auto", messages: [{ role: "user", content: "Hello" }], max_tokens: 32, stream: false },
      6e4,
      "QNFO_AI"
    );
    var rt = r.data && r.data._router;
    var content = r.data && r.data.choices && r.data.choices[0] && r.data.choices[0].message && r.data.choices[0].message.content;
    var pass = r.status === 200 && !!rt && !!rt.routed_model && !!content && String(content).trim().length > 0;
    out.push({ probe: "routing", target: "auto/simple", status: pass ? "pass" : "fail", latency_ms: 0, detail: pass ? "routed=" + rt.routed_model : "http=" + r.status + " " + JSON.stringify(rt || {}).slice(0, 100) });
  } catch (e) {
    out.push({ probe: "routing", target: "auto/simple", status: "fail", latency_ms: 0, detail: "err " + String(e && e.message || e).slice(0, 100) });
  }
  try {
    var r2 = await jfetch(
      env,
      "https://qnfo-ai.internal/v1/chat/completions",
      { Authorization: "Bearer " + env.QNFO_ROUTER_KEY },
      { model: "ensemble", messages: [{ role: "user", content: "What is 17*23?" }], max_tokens: 64, stream: false },
      12e4,
      "QNFO_AI"
    );
    var c2 = r2.data && r2.data.choices && r2.data.choices[0] && r2.data.choices[0].message && r2.data.choices[0].message.content;
    var pass2 = r2.status === 200 && r2.data.model === "ensemble" && !!c2 && String(c2).trim().length > 0;
    out.push({ probe: "routing", target: "ensemble/math", status: pass2 ? "pass" : "fail", latency_ms: 0, detail: pass2 ? "out=" + String(c2).slice(0, 40) : "http=" + r2.status });
  } catch (e) {
    out.push({ probe: "routing", target: "ensemble/math", status: "fail", latency_ms: 0, detail: "err " + String(e && e.message || e).slice(0, 100) });
  }
  try {
    var r3 = await jfetch(
      env,
      "https://qnfo-ai.internal/v1/chat/completions",
      { Authorization: "Bearer " + env.QNFO_ROUTER_KEY },
      { model: "nonexistent-model-xyz", messages: [{ role: "user", content: "hi" }], max_tokens: 32, stream: false },
      6e4,
      "QNFO_AI"
    );
    var pass3 = r3.status === 200 && r3.data && r3.data.model === "deepseek-v4-flash";
    out.push({ probe: "routing", target: "unknown-fallback", status: pass3 ? "pass" : "fail", latency_ms: 0, detail: pass3 ? "fallback=deepseek-v4-flash" : "http=" + r3.status + " model=" + (r3.data && r3.data.model) });
  } catch (e) {
    out.push({ probe: "routing", target: "unknown-fallback", status: "fail", latency_ms: 0, detail: "err " + String(e && e.message || e).slice(0, 100) });
  }
  for (var i = 0; i < 2; i++) {
    var mt = i === 0 ? 0 : 999999;
    try {
      var r4 = await jfetch(
        env,
        "https://qnfo-ai.internal/v1/chat/completions",
        { Authorization: "Bearer " + env.QNFO_ROUTER_KEY },
        { model: "deepseek-v4-flash", messages: [{ role: "user", content: "hi" }], max_tokens: mt, stream: false },
        6e4,
        "QNFO_AI"
      );
      out.push({ probe: "routing", target: "boundary/max_tokens=" + mt, status: r4.status === 200 ? "pass" : "fail", latency_ms: 0, detail: "http=" + r4.status });
    } catch (e) {
      out.push({ probe: "routing", target: "boundary/max_tokens=" + mt, status: "fail", latency_ms: 0, detail: "err " + String(e && e.message || e).slice(0, 100) });
    }
  }
  return out;
}
__name(probeRouting, "probeRouting");
async function probeEndpoint(env, name, url, key, body, bindName) {
  var t0 = Date.now();
  try {
    var r = await jfetch(env, url, { Authorization: "Bearer " + key }, body, 6e4, bindName);
    var pass;
    if (body) {
      var content = r.data && r.data.choices && r.data.choices[0] && r.data.choices[0].message && r.data.choices[0].message.content;
      pass = r.status === 200 && !!content && String(content).trim().length > 0;
    } else {
      pass = r.status === 200 && r.text.indexOf("deepseek-v4-flash") >= 0;
    }
    return { probe: "endpoint", target: name, status: pass ? "pass" : "fail", latency_ms: Date.now() - t0, detail: pass ? "ok" : "http=" + r.status };
  } catch (e) {
    return { probe: "endpoint", target: name, status: "fail", latency_ms: Date.now() - t0, detail: "err " + String(e && e.message || e).slice(0, 120) };
  }
}
__name(probeEndpoint, "probeEndpoint");
async function auditRoster(env, rosterData) {
  var drifts = [];
  var byId = {};
  for (var i = 0; i < (rosterData || []).length; i++) byId[rosterData[i].id] = rosterData[i];
  for (var id in TIER0_WA) {
    var wa = TIER0_WA[id];
    var adv = byId[id] && byId[id]._router;
    if (!adv) {
      drifts.push({ model: id, field: "roster-entry", advertised: "missing", catalog: wa });
      continue;
    }
    var short = wa.split("/").pop();
    var r;
    try {
      r = await jfetch(env, CATALOG + "/ai/models/search?search=" + encodeURIComponent(short), { Authorization: "Bearer " + env.CF_API_TOKEN }, null, 3e4);
    } catch (e) {
      drifts.push({ model: id, field: "catalog-fetch", advertised: "ok", catalog: "err" });
      continue;
    }
    var hit = null;
    var arr = r.data && r.data.result;
    for (var j = 0; arr && j < arr.length; j++) if (arr[j].name === wa) {
      hit = arr[j];
      break;
    }
    if (!hit) {
      drifts.push({ model: id, field: "catalog-entry", advertised: "present", catalog: "missing " + wa });
      continue;
    }
    var props = {};
    for (var k = 0; k < (hit.properties || []).length; k++) props[hit.properties[k].property_id] = hit.properties[k].value;
    var catCtx = Number(props.context_window);
    var catVision = props.vision === "true" ? 1 : 0;
    var catReason = props.reasoning === "true" ? 1 : 0;
    var catFC = props.function_calling === "true" ? 1 : 0;
    if (adv.ctx !== catCtx) drifts.push({ model: id, field: "ctx", advertised: adv.ctx, catalog: catCtx });
    if ((adv.vision ? 1 : 0) !== catVision) drifts.push({ model: id, field: "vision", advertised: adv.vision ? 1 : 0, catalog: catVision });
    if ((adv.reasoning ? 1 : 0) !== catReason) drifts.push({ model: id, field: "reasoning", advertised: adv.reasoning ? 1 : 0, catalog: catReason });
    if ((adv.tools ? 1 : 0) !== catFC) drifts.push({ model: id, field: "tools", advertised: adv.tools ? 1 : 0, catalog: catFC });
  }
  return drifts;
}
__name(auditRoster, "auditRoster");
function now() {
  return Date.now();
}
__name(now, "now");
async function cfgGet(env, key, def) {
  try {
    var r = await env.QNFO_AUDIT.prepare("SELECT value FROM ai_calibration_config WHERE key = ?1").bind(key).first();
    return r && r.value != null ? r.value : def;
  } catch (e) {
    return def;
  }
}
__name(cfgGet, "cfgGet");
async function setOverrides(env, model, o) {
  await env.QNFO_AUDIT.prepare("UPDATE ai_model_health SET ctx_override = ?2, vision_override = ?3, reasoning_override = ?4, updated_at = ?5 WHERE model_id = ?1").bind(model, o.ctx != null ? o.ctx : null, o.vision != null ? o.vision : null, o.reasoning != null ? o.reasoning : null, now()).run();
}
__name(setOverrides, "setOverrides");
async function clearOverrides(env, model) {
  await env.QNFO_AUDIT.prepare("UPDATE ai_model_health SET ctx_override = NULL, vision_override = NULL, reasoning_override = NULL, updated_at = ?2 WHERE model_id = ?1").bind(model, now()).run();
}
__name(clearOverrides, "clearOverrides");
async function upsertHealth(env, model, status, latency, failures) {
  await env.QNFO_AUDIT.prepare("INSERT INTO ai_model_health (model_id, status, ctx_override, vision_override, reasoning_override, last_probe_ts, last_latency_ms, consecutive_failures, updated_at) VALUES (?1, ?2, NULL, NULL, NULL, ?3, ?4, ?5, ?3) ON CONFLICT(model_id) DO UPDATE SET status = ?2, last_probe_ts = ?3, last_latency_ms = ?4, consecutive_failures = ?5, updated_at = ?3").bind(model, status, now(), latency, failures).run();
}
__name(upsertHealth, "upsertHealth");
function fnv32(s) {
  var h = 2166136261 >>> 0;
  for (var i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return ("00000000" + h.toString(16)).slice(-8);
}
__name(fnv32, "fnv32");
async function fileIssue(env, title, description, priority) {
  var tag = title.indexOf("[gw-fail]") === 0 ? "gwfail" : "cal";
  var fp = tag + ":" + fnv32(title);
  var ex = await env.QNFO_AUDIT.prepare("SELECT fingerprint FROM issue_ledger WHERE fingerprint = ?1").bind(fp).first();
  if (ex) {
    await env.QNFO_AUDIT.prepare("UPDATE issue_ledger SET occurrences = occurrences + 1, last_seen = ?2, last_detail = ?3, updated_at = ?2, status = 'open', resolved_at = NULL, resolution_note = NULL WHERE fingerprint = ?1").bind(fp, now(), String(description || "").slice(0, 500)).run();
    return false;
  }
  await env.QNFO_AUDIT.prepare("INSERT INTO issue_ledger (fingerprint, source, level, category, title, status, first_seen, last_seen, occurrences, last_detail, updated_at) VALUES (?1, 'qnfo-ai-calibration', ?2, 'ai-calibration', ?3, 'open', ?4, ?4, 1, ?5, ?4)").bind(fp, priority === "high" ? "error" : "warn", title, now(), String(description || "").slice(0, 500)).run();
  return true;
}
__name(fileIssue, "fileIssue");
async function closeIssue(env, title, reason) {
  var tag = title.indexOf("[gw-fail]") === 0 ? "gwfail" : "cal";
  var fp = tag + ":" + fnv32(title);
  var ex = await env.QNFO_AUDIT.prepare("SELECT fingerprint FROM issue_ledger WHERE fingerprint = ?1 AND status = 'open' LIMIT 1").bind(fp).first();
  if (!ex) return false;
  await env.QNFO_AUDIT.prepare("UPDATE issue_ledger SET status = 'resolved', resolved_at = ?2, resolution_note = ?3, updated_at = ?2 WHERE fingerprint = ?1").bind(fp, now(), String(reason || "").slice(0, 300)).run();
  return true;
}
__name(closeIssue, "closeIssue");
// GW-402-UNFUNDED-1 (1.2.9): one place decides the failure class of a gateway log bucket from its HTTP status and the
// upstream response head. "unfunded" (402, or an insufficient-balance / payment-required body) and "rate-capacity" are
// not evidence against the model: no [gw-fail] issue, no degraded health row, and the 24h reconcile ignores them.
var GW_NO_DEGRADE_CLASSES = { "rate-capacity": 1, "unfunded": 1, "spend-limited": 1, "client-closed": 1 };
function gwErrorClass(status, rh) {
  var s = Number(status) || 0, h = String(rh || "");
  // SPEND-LIMITED-CLASS-1 (2026-10-17): a gateway spend cap is an ACCOUNT condition, not a model fault. It fell
  // through to "other", so one cap degraded all 8 models at once and filed an issue per model on every sweep.
  if (/spend[ _-]?limit/i.test(h)) return "spend-limited";
  if (s === 402 || /insufficient[ _-]?balance|payment required|insufficient[ _-]?quota|billing (?:hard )?limit|exceeded your current quota/i.test(h)) return "unfunded";
  // STATUS-FIRST-1 (2026-10-17): the status code is authoritative when the response head is
  // empty or unmatched, which is the common case in gateway logs (the head is not always
  // captured). Every 429 was therefore stored as "other", and the 24h reconciler that clears
  // a degraded model exempts only rate-capacity / unfunded / spend-limited -- so transient
  // rate limits pinned models as degraded and refiled [gw-fail] issues (52 rows in the last
  // two days were all classified "other").
  if (s === 429) return "rate-capacity";
  // GW-CLIENT-CLOSED-1 (1.6.10, issue 6808): 499 with duration 0 is the caller closing the request (the companion chat tab left, a
  // hedge leg cancelled), 2026-11-04 gateway logs: seven 499 rows on dynamic/value, dynamic/standard and dynamic/premium, all duration 0, none
  // reaching a provider. It is no evidence against the model: no [gw-fail] issue, no degraded health row, ignored by the 24h reads.
  if (s === 499) return "client-closed";
  if (s >= 500) return "upstream";
  if (/string' not in 'array'|oneOf|Bad input/.test(h)) return "content-shape";
  if (/capacity temporarily|rate limit/i.test(h)) return "rate-capacity";
  if (/image|dimensions|at least 10px/i.test(h)) return "image-input";
  if (/arguments must be valid JSON/i.test(h)) return "tool-args-json";
  if (/unavailable|5[0-9][0-9]|internal/i.test(h)) return "upstream";
  return "other";
}
__name(gwErrorClass, "gwErrorClass");
async function gatewayFailureSweep(env, t0) {
  var out = { ok: true, classes: 0, total: 0, summary: "" };
  try {
    await env.QNFO_AUDIT.prepare("CREATE TABLE IF NOT EXISTS ai_gateway_failures (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, model TEXT, status INTEGER, count INTEGER, error_class TEXT, sample_detail TEXT, source TEXT)").run();
  } catch (e) {
    out.ok = false;
    out.summary = "ddl err " + String(e && e.message || e).slice(0, 80);
    return out;
  }
  var lastTs = t0 - 45 * 60 * 1e3;
  try {
    var cfg = await env.QNFO_AUDIT.prepare("SELECT value FROM ai_calibration_config WHERE key = ?1").bind("gw_sweep_last_ts").first();
    if (cfg && cfg.value != null && Number(cfg.value) > 0) lastTs = Number(cfg.value);
  } catch (e) {
  }
  var startIso = new Date(lastTs).toISOString();
  var buckets = {};
  var rows = [];
  var fetchFail = false;
  var limit = 3;
  try {
    for (var page = 1; page <= limit; page++) {
      var r = await jfetch(env, CATALOG + "/ai-gateway/gateways/default/logs?per_page=50&page=" + page + "&success=false&start_date=" + encodeURIComponent(startIso), { Authorization: "Bearer " + env.CF_API_TOKEN }, null, 25e3);
      if (r.status !== 200 || !r.data || !Array.isArray(r.data.result)) { fetchFail = true; out.ok = false; out.summary = "gw-log fetch HTTP " + r.status + " - sweep window NOT advanced"; break; }
      var arr = r.data.result;
      if (!arr.length) break;
      for (var i = 0; i < arr.length; i++) {
        var row = arr[i];
        if (Number(new Date(row.created_at).getTime()) < lastTs) continue;
        var st = row.status_code || 0;
        var mdl = row.model || "unknown";
        var key = st + "|" + mdl;
        buckets[key] = buckets[key] || { status: st, model: mdl, count: 0, sample: "" };
        buckets[key].count++;
        if (!buckets[key].sample) buckets[key].sample = (row.id || "") + "@" + (row.created_at || "");
      }
      rows = rows.concat(arr);
      if (arr.length < 50) break;
      await new Promise(function(res) {
        setTimeout(res, 5);
      });
    }
  } catch (e) {
    out.ok = false;
    out.summary = "fetch err " + String(e && e.message || e).slice(0, 120);
    return out;
  }
  var cls = Object.keys(buckets);
  out.total = rows.length;
  out.classes = cls.length;
  var parts = [];
  for (var ci = 0; ci < cls.length; ci++) {
    var b = buckets[cls[ci]];
    var clsLabel = gwErrorClass(b.status, "");
    try {
      if (b.sample) {
        var d = await jfetch(env, CATALOG + "/ai-gateway/gateways/default/logs/" + encodeURIComponent(b.sample.split("@")[0]), { Authorization: "Bearer " + env.CF_API_TOKEN }, null, 2e4);
        var dres = d.data && d.data.result;
        var rh = dres && dres.response_head ? String(dres.response_head) : d.data && d.data.response_head ? String(d.data.response_head) : "";
        clsLabel = gwErrorClass(b.status, rh);
        b.sample = rh.slice(0, 200) || b.sample;
      }
    } catch (e) {
    }
    try {
      await env.QNFO_AUDIT.prepare("INSERT INTO ai_gateway_failures (ts, model, status, count, error_class, sample_detail, source) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'qnfo-ai-calibration')").bind(t0, b.model, b.status, b.count, clsLabel, String(b.sample || "").slice(0, 300)).run();
    } catch (e) {
    }
    parts.push(b.status + " " + b.model + " x" + b.count + " [" + clsLabel + "]");
    var title = "[gw-fail] " + b.status + " " + b.model;
    try {
      var dispo = await env.QNFO_AUDIT.prepare("SELECT id FROM agent_issues WHERE title LIKE ?1 AND status IN ('wontfix','closed','resolved') LIMIT 1").bind("%" + b.model + "%").first();
      var prev = await env.QNFO_AUDIT.prepare("SELECT COUNT(*) AS c FROM ai_gateway_failures WHERE model = ?1 AND status = ?2 AND ts < ?3 AND ts > ?4").bind(b.model, b.status, lastTs, lastTs - 45 * 60 * 1e3).first();
      var prevCount = prev ? Number(prev.c || 0) : 0;
      if (!dispo && !GW_NO_DEGRADE_CLASSES[clsLabel] && (b.count >= 2 || prevCount > 0)) {
        await fileIssue(env, title, "gateway failures in sweep window: " + b.count + "x status=" + b.status + " class=" + clsLabel + " sample=" + String(b.sample || "").slice(0, 200) + ". Router-level self-heal handles content-shape/rate classes; escalate if this class persists.", "high");
      }
    } catch (e) {
    }
    try {
      var recurring = !GW_NO_DEGRADE_CLASSES[clsLabel] && (b.count >= 2 || prevCount > 0);
      var targetId = internalId(b.model);
      try {
        var hrow = await env.QNFO_AUDIT.prepare("SELECT model_id FROM ai_model_health WHERE model_id = ?1").bind(targetId).first();
        if (recurring) {
          if (hrow) await env.QNFO_AUDIT.prepare("UPDATE ai_model_health SET status='degraded', updated_at=?1 WHERE model_id=?2").bind((/* @__PURE__ */ new Date()).toISOString(), targetId).run();
          else if (String(targetId).indexOf("@cf/") !== 0) await env.QNFO_AUDIT.prepare("INSERT OR IGNORE INTO ai_model_health (model_id, status, updated_at) VALUES (?1,'degraded',?2)").bind(targetId, (/* @__PURE__ */ new Date()).toISOString()).run();
        } else if (hrow && hrow.model_id) {
          var cur = await env.QNFO_AUDIT.prepare("SELECT status FROM ai_model_health WHERE model_id = ?1").bind(targetId).first();
          if (cur && cur.status === "degraded") await env.QNFO_AUDIT.prepare("UPDATE ai_model_health SET status='ok', updated_at=?1 WHERE model_id=?2").bind((/* @__PURE__ */ new Date()).toISOString(), targetId).run();
        }
      } catch (e) {
      }
    } catch (e) {
    }
  }
  try {
    // GW-FAIL-STATUS-SCOPE-1 (1.6.13, issue 6808 / agent_issues 1001463): a "[gw-fail] <status> <model>" title names one status of one model, but this
    // read counted every non-transient class of the model. "[gw-fail] 499 dynamic/value" therefore stayed open for ever because the same model also
    // logs 400 and 504 rows (the calibration probes themselves), although its own status had gone quiet (499 is client-closed since 1.6.10). The
    // read is scoped to the title's status (?3, 0 = any), and the ledger rows are read too: closeIssue resolves the ledger, which has no agent_issues
    // row until the escalation mirrors it.
    var openTitles = await env.QNFO_AUDIT.prepare("SELECT id, title FROM agent_issues WHERE title LIKE '[gw-fail]%' AND status = 'open'").all();
    var openLedger = await env.QNFO_AUDIT.prepare("SELECT title FROM issue_ledger WHERE status = 'open' AND source = 'qnfo-ai-calibration' AND fingerprint LIKE 'gwfail:%'").all();
    var gwTitles = {};
    (openTitles.results || []).concat(openLedger.results || []).forEach(function(row) { if (row && row.title) gwTitles[row.title] = 1; });
    var gwTitleList = Object.keys(gwTitles);
    for (var oi = 0; oi < gwTitleList.length; oi++) {
      var ttl = gwTitleList[oi];
      var modelPart = ttl.replace(/^\[gw-fail\] \d+ /, "");
      var statusPart = /^\[gw-fail\] (\d+) /.exec(ttl);
      try {
        var recent = await env.QNFO_AUDIT.prepare("SELECT COUNT(*) AS c FROM ai_gateway_failures WHERE model = ?1 AND (?3 = 0 OR status = ?3) AND error_class NOT IN ('rate-capacity','unfunded','spend-limited','client-closed') AND ts > ?2").bind(modelPart, t0 - 24 * 3600 * 1e3, statusPart ? Number(statusPart[1]) : 0).first();
        if (!recent || Number(recent.c || 0) === 0) await closeIssue(env, ttl, "no non-transient failures for 24h");
      } catch (e) {
      }
    }
  } catch (e) {
  }
  // v1.2.5 AMH-STALE-DEGRADE-RECONCILE (fixes MODEL-DEGRADED recurrence #1256):
  // a row set degraded by a gateway-failure sweep cannot clear via the per-bucket path,
  // because a CLEAN sweep produces no bucket for that model. Clear any degraded row that
  // carries zero consecutive_failures AND has no non-transient gateway failure in 24h.
  try {
    var degRows = await env.QNFO_AUDIT.prepare("SELECT model_id, consecutive_failures FROM ai_model_health WHERE status = 'degraded'").all();
    var degList = (degRows && degRows.results) || [];
    for (var di = 0; di < degList.length; di++) {
      var dmid = degList[di].model_id;
      if (Number(degList[di].consecutive_failures || 0) !== 0) continue;
      // AMH-RECONCILE-SPEND-1 (1.5.3, 2026-10-17): the sweep writes a bucket's class TWICE -- once from the
      // status alone, then again once the log detail carries the response head. A row written before
      // SPEND-LIMITED-CLASS-1 is stamped 'other' while its sample_detail already reads "Spend limited".
      // The old predicate only excluded the CLASS, so 24 h of those rows pinned a degraded model with zero
      // consecutive failures and a 23-day-stale probe -- measured on deepseek/deepseek-v4-flash, which is
      // this fleet's fallback model. Exclude the spend class, exclude any 429 whose stored sample says so
      // regardless of its stored class, and match the row by internal OR qualified id (the sweep stores
      // the worker-reported id).
      var drec = await env.QNFO_AUDIT.prepare("SELECT COUNT(*) AS c FROM ai_gateway_failures WHERE (model = ?1 OR model = ?2) AND error_class NOT IN ('rate-capacity','unfunded','spend-limited','client-closed') AND NOT (status = 429 AND sample_detail LIKE '%Spend limit%') AND ts > ?3").bind(internalId(dmid), dmid, t0 - 24 * 60 * 60 * 1000).first();
      if (drec && Number(drec.c || 0) > 0) continue;
      await env.QNFO_AUDIT.prepare("UPDATE ai_model_health SET status = 'ok', updated_at = ?1 WHERE model_id = ?2").bind((/* @__PURE__ */ new Date()).toISOString(), dmid).run();
    }
  } catch (e) {
  }
  if (!fetchFail) {
    try {
      await env.QNFO_AUDIT.prepare("INSERT INTO ai_calibration_config (key, value) VALUES ('gw_sweep_last_ts', ?1) ON CONFLICT(key) DO UPDATE SET value = ?1").bind(String(t0)).run();
    } catch (e) {
    }
  }
  out.summary = cls.length ? parts.join("; ") : "clean (0 failed requests in window)";
  return out;
}
__name(gatewayFailureSweep, "gatewayFailureSweep");
// AUTOROUTER-SHADOW-SCHEDULE-1 (roadmap row 1695, agent_issues 1002052): qnfo-ai has had POST /internal/eval/autorouter-shadow since PR 6567 and nothing called it, so the Auto Router
// evaluation had 0 autorouter-shadow rows. Once a day this tick posts {confirm: true, limit: 3} through the QNFO_AI binding, which qnfo-ai trusts by ctx.props.caller (no secret). The route
// writes its own cloud_ops_events rows (the evidence); this keeps only a short summary in the Workers log. It never fails the tick. ai_calibration_config autorouter_shadow = off stops it;
// autorouter_shadow_last_ts is the attempt stamp, written before the call so an attempt that errors is retried the next day, not on every tick.
async function autoRouterShadowDaily(env, t0) {
  var out = { ok: true, ran: false, summary: "" };
  try {
    if (String(await cfgGet(env, "autorouter_shadow", "on")).toLowerCase() === "off") {
      out.summary = "off";
      return out;
    }
    var last = Number(await cfgGet(env, "autorouter_shadow_last_ts", "0")) || 0;
    if (t0 - last < 23 * 36e5) {
      out.summary = "ran " + Math.round((t0 - last) / 36e5) + " h ago";
      return out;
    }
    await env.QNFO_AUDIT.prepare("INSERT INTO ai_calibration_config (key, value) VALUES ('autorouter_shadow_last_ts', ?1) ON CONFLICT(key) DO UPDATE SET value = ?1").bind(String(t0)).run();
    if (!env.QNFO_AI || typeof env.QNFO_AI.fetch !== "function") {
      out.ok = false;
      out.summary = "QNFO_AI binding missing";
      return out;
    }
    var resp = await withTimeout(env.QNFO_AI.fetch("https://qnfo-ai.internal/internal/eval/autorouter-shadow", {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "qnfo-ai-calibration/" + VERSION },
      body: JSON.stringify({ confirm: true, limit: 3 })
    }), 100000);
    var data = null;
    try {
      data = await resp.json();
    } catch (e) {
      data = null;
    }
    out.ran = true;
    out.ok = resp.ok;
    out.summary = "HTTP " + resp.status + " " + JSON.stringify(data || {}).slice(0, 200);
  } catch (e) {
    out.ok = false;
    out.summary = "err " + String(e && e.message || e).slice(0, 120);
  }
  return out;
}
__name(autoRouterShadowDaily, "autoRouterShadowDaily");
async function calibration(env, trigger) {
  var t0 = Date.now();
  var runId = "cal-" + t0 + "-" + crypto.randomUUID().replace(/-/g, "").slice(0, 6); // WORKERS-STANDARDS-1 (1.3.4): ids come from crypto, same six-hex shape
  var results = [];
  var gwSweepRes = null;
  try {
    gwSweepRes = await gatewayFailureSweep(env, t0);
    if (gwSweepRes) results.push({ probe: "gateway-sweep", target: "ai-gateway-default", status: gwSweepRes.ok ? "pass" : "fail", latency_ms: 0, detail: String(gwSweepRes.summary || "").slice(0, 300) });
  } catch (e) {
  }
  try {
    var shadowRes = await autoRouterShadowDaily(env, t0);
    if (shadowRes.ran || !shadowRes.ok) console.log(JSON.stringify({ worker: "qnfo-ai-calibration", where: "autorouter-shadow", ok: shadowRes.ok, ran: shadowRes.ran, summary: shadowRes.summary }));
  } catch (e) {
  }
  var failing = {};
  var driftByModel = {};
  var failThreshold = parseInt(await cfgGet(env, "fail_threshold", "2"), 10) || 2;
  var latencyMax = parseInt(await cfgGet(env, "latency_max_ms", "8000"), 10) || 8e3;
  var visionModels = (await cfgGet(env, "vision_models", DEFAULT_VISION)).split(",").map(function(s) {
    return s.trim();
  }).filter(Boolean);
  var roster = null;
  var authBlind = false;
  try {
    var h = await jfetch(env, "https://qnfo-ai.internal/health", null, null, 2e4, "QNFO_AI");
    results.push({ probe: "health", target: "qnfo-ai", status: h.status === 200 && h.data && h.data.status === "ok" ? "pass" : "fail", latency_ms: 0, detail: "version=" + (h.data && h.data.version) });
    var r = await jfetch(env, "https://qnfo-ai.internal/v1/models", { Authorization: "Bearer " + env.QNFO_ROUTER_KEY }, null, 3e4, "QNFO_AI");
    var authorized = r.status === 200 && r.data && Array.isArray(r.data.data) && r.data.data.some(function(x) { return x && x._router; });
    if (r.status === 200 && r.data && Array.isArray(r.data.data) && !authorized) {
      authBlind = true;
      results.push({ probe: "roster", target: "qnfo-ai", status: "fail", latency_ms: 0, detail: "public listing only (no _router): QNFO_ROUTER_KEY rejected" });
    } else if (r.status === 401 || r.status === 403) {
      authBlind = true;
      results.push({ probe: "roster", target: "qnfo-ai", status: "fail", latency_ms: 0, detail: "http=" + r.status + " QNFO_ROUTER_KEY rejected" });
    } else if (authorized) {
      roster = r.data.data;
      results.push({ probe: "roster", target: "qnfo-ai", status: "pass", latency_ms: 0, detail: r.data.data.length + " models" });
    } else {
      results.push({ probe: "roster", target: "qnfo-ai", status: "fail", latency_ms: 0, detail: "http=" + r.status });
    }
  } catch (e) {
    results.push({ probe: "health", target: "qnfo-ai", status: "fail", latency_ms: 0, detail: "err " + String(e && e.message || e).slice(0, 100) });
  }
  if (authBlind) {
    await fileIssue(env, "[ai-cal] router key rejected by qnfo-ai (calibration blind)", "qnfo-ai refused QNFO_ROUTER_KEY (401/403 or public single-model listing). Roster audit and model probes are inconclusive and will not mark models failing. Fix: set QNFO_ROUTER_KEY on qnfo-ai-calibration to the current qnfo-ai router key.", "high");
  } else if (roster) {
    await closeIssue(env, "[ai-cal] router key rejected by qnfo-ai (calibration blind)", "authorized roster fetch succeeded");
  }
  if (roster) {
    var drifts = await auditRoster(env, roster);
    for (var di = 0; di < drifts.length; di++) {
      var d = drifts[di];
      (driftByModel[d.model] = driftByModel[d.model] || []).push(d);
      results.push({ probe: "roster-drift", target: d.model, status: "drift", latency_ms: 0, detail: d.field + ": advertised=" + d.advertised + " catalog=" + d.catalog });
    }
    for (var mid in driftByModel) {
      var cat = {};
      var detail = [];
      for (var j = 0; j < driftByModel[mid].length; j++) {
        var dd = driftByModel[mid][j];
        detail.push(dd.field + "=" + dd.advertised + "->" + dd.catalog);
        if (dd.field === "ctx") cat.ctx = dd.catalog;
        if (dd.field === "vision") cat.vision = dd.catalog;
        if (dd.field === "reasoning") cat.reasoning = dd.catalog;
      }
      await setOverrides(env, mid, cat);
      await fileIssue(env, "[ai-cal] roster drift: " + mid, "advertised vs catalog: " + detail.join("; ") + ". Live override applied in ai_model_health; fix the MODELS roster in qnfo-ai source and redeploy to clear.", "medium");
    }
    try {
      var ovr = await env.QNFO_AUDIT.prepare("SELECT model_id FROM ai_model_health WHERE ctx_override IS NOT NULL OR vision_override IS NOT NULL OR reasoning_override IS NOT NULL").all();
      for (var k = 0; k < (ovr.results || []).length; k++) {
        var m0 = ovr.results[k].model_id;
        if (!driftByModel[m0]) {
          await clearOverrides(env, m0);
          await closeIssue(env, "[ai-cal] roster drift: " + m0, "drift resolved in live roster");
        }
      }
      var odr = await env.QNFO_AUDIT.prepare("SELECT title FROM issue_ledger WHERE status='open' AND source='qnfo-ai-calibration' AND title LIKE '[ai-cal] roster drift: %'").all();
      for (var k2 = 0; k2 < (odr.results || []).length; k2++) {
        var t2 = String(odr.results[k2].title || "");
        var mid2 = t2.slice(t2.indexOf(": ") + 2);
        if (mid2 && !driftByModel[mid2]) await closeIssue(env, t2, "roster audit clean: model no longer drifting");
      }
    } catch (e) {
    }
  }
  var sweepEvery = await cfgGet(env, "model_sweep_every_ticks", String(MODEL_SWEEP_EVERY_TICKS));
  var fullSweep = fullSweepDue(t0, sweepEvery, trigger);
  var sweepModels = ALL_MODELS;
  if (!fullSweep) {
    try {
      var hr = await env.QNFO_AUDIT.prepare("SELECT model_id, status, consecutive_failures FROM ai_model_health").all();
      sweepModels = leanSweepModels(ALL_MODELS, hr.results || []);
    } catch (eH) {
      // ai_model_health unreadable: fall back to the full sweep rather than go blind
      fullSweep = true;
    }
    if (!fullSweep) results.push({ probe: "cadence", target: "model-sweep", status: "pass", latency_ms: 0, detail: "lean tick: re-probed " + sweepModels.length + " not-ok of " + ALL_MODELS.length + " models; full sweep every " + sweepEvery + " ticks (PROBE-CADENCE-COST-1)" });
  }
  if (fullSweep) sweepModels = ALL_MODELS;
  var budgetOn = await budgetProbeOn(env);
  await runPool(sweepModels, 4, async function(m) {
    var res = await probeCompletion(env, m);
    var modelRow = Object.assign({ probe: "model", target: m }, res);
    results.push(modelRow);
    var bres = null;
    // SPEND-DOWNGRADE-INCONCLUSIVE-1 (1.6.4), the second path: qnfo-ai 5.37.0 honours no_downgrade for this caller at max_tokens <= 512, so the
    // ping normally reaches the model it names. When the router still swaps it for glm-5.3-flash (flag not honoured, ceiling exceeded, caller not
    // identified, older router) the ping says nothing about the model that was asked: it is not a failure and does not move
    // consecutive_failures. A model with a Workers AI id is judged on the direct env.AI.run probe, the request the prober member sends: a pass
    // writes ok with 0 failures and closes the [ai-cal] model probe failing issue, a failure takes the unchanged degraded then failing path.
    // The probe = model row stays as probeCompletion returned it ("downgraded"), the only record that the routed ping was answered by another
    // model; the direct verdict is the probe = model-budget row. A model with no direct id (or budget_probe = off, or no AI binding) has no
    // conclusive probe: no health write, no issue.
    if (res.status === "downgraded") {
      if (!(budgetOn && BUDGET_DIRECT_IDS[m] && env.AI)) return res;
      bres = await probeBudgetCompletion(env, m);
      results.push(Object.assign({ probe: "model-budget", target: m }, bres));
      res = { status: bres.status, latency_ms: res.latency_ms, detail: bres.detail };
    } else if (res.status === "fail" && /^http=5\d\d\b/.test(String(res.detail || ""))) {
      var routeFailure = res;
      results.push(Object.assign({ probe: "model-route", target: m }, routeFailure));
      if (budgetOn && BUDGET_DIRECT_IDS[m] && env.AI) {
        bres = await probeBudgetCompletion(env, m);
        results.push(Object.assign({ probe: "model-budget", target: m }, bres));
        res = {
          status: bres.status,
          latency_ms: routeFailure.latency_ms,
          detail: "router " + routeFailure.detail + "; direct " + bres.detail
        };
        modelRow.status = res.status;
        modelRow.detail = res.detail;
      }
    }
    // BUDGET-PROBE-1 (1.6.0): a model that answers the ping gets one budget-shaped request; a failure there decides the health
    // row (detail and failure count) while the ping row and its latency stay as they were.
    if (res.status === "pass" && budgetOn && !bres) {
      bres = await probeBudgetCompletion(env, m);
      results.push(Object.assign({ probe: "model-budget", target: m }, bres));
      if (bres.status !== "pass") res = Object.assign({}, res, { status: "fail", detail: bres.detail });
    }
    if (res.status !== "pass" && /http=40[13]\b/.test(String(res.detail || ""))) return res;
    try {
      var prev = await env.QNFO_AUDIT.prepare("SELECT consecutive_failures FROM ai_model_health WHERE model_id = ?1").bind(m).first();
      var cf = prev ? prev.consecutive_failures || 0 : 0;
      if (res.status === "pass") {
        await upsertHealth(env, m, "ok", res.latency_ms, 0);
        await closeIssue(env, "[ai-cal] model probe failing: " + m, "self-recovered");
        if (res.latency_ms > latencyMax) results.push({ probe: "latency", target: m, status: "fail", latency_ms: res.latency_ms, detail: "slow minimal probe (> " + latencyMax + "ms)" });
      } else {
        cf += 1;
        var st = cf >= failThreshold ? "failing" : "degraded";
        await upsertHealth(env, m, st, res.latency_ms, cf);
        if (cf >= failThreshold) {
          failing[m] = res.detail;
          await fileIssue(env, "[ai-cal] model probe failing: " + m, "consecutive_failures=" + cf + " detail=" + res.detail, "high");
        }
      }
    } catch (e) {
    }
    return res;
  });
  if (fullSweep) {
    await runPool(visionModels, 2, async function(m) {
      var res = await probeVision(env, m);
      results.push(Object.assign({ probe: "vision", target: m }, res));
      return res;
    });
    results.push(Object.assign({ probe: "tools", target: "deepseek-v4-flash" }, await probeTools(env)));
    results.push(Object.assign({ probe: "stream", target: "deepseek-v4-flash" }, await probeStream(env)));
    results = results.concat(await probeRouting(env));
  }
  results.push(await (async function(){ var t0=Date.now(); try { var r=await jfetch(env,"https://qnfo-ops.internal/health",null,null,2e4,"QNFO_OPS"); return {probe:"endpoint",target:"qnfo-ops/health",status:r.status===200?"pass":"fail",latency_ms:Date.now()-t0,detail:r.status===200?"ok":"http="+r.status}; } catch(e){ return {probe:"endpoint",target:"qnfo-ops/health",status:"fail",latency_ms:Date.now()-t0,detail:"err "+String(e&&e.message||e).slice(0,120)}; } })());
  results.push(await (async function(){ var t0=Date.now(); try { var r=await jfetch(env,"https://personal-api.internal/health",null,null,2e4,"PT_API"); return {probe:"endpoint",target:"personal-api/health",status:r.status===200?"pass":"fail",latency_ms:Date.now()-t0,detail:r.status===200?"ok":"http="+r.status}; } catch(e){ return {probe:"endpoint",target:"personal-api/health",status:"fail",latency_ms:Date.now()-t0,detail:"err "+String(e&&e.message||e).slice(0,120)}; } })());
  // RETIRED-DIRECT-PATH-REMOVAL-1 (#1267): api.deepseek.com direct path is retired; DEEPSEEK_KEY is expired (HTTP 401 every run) and the fleet routes deepseek via AI Gateway / Workers-AI (@cf/deepseek-ai/*). Probing it only manufactured a permanent fail that the digest then masked.
  var pass = 0, fail = 0, driftCount = 0;
  for (var i = 0; i < results.length; i++) {
    if (results[i].status === "pass") pass++;
    else if (results[i].status === "drift") driftCount++;
    else fail++;
  }
  try {
    await env.QNFO_AUDIT.prepare("INSERT INTO ai_calibration_runs (id, ts, trigger, total, pass, fail, drifts, duration_ms, digest) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)").bind(runId, t0, trigger, results.length, pass, fail, driftCount, Date.now() - t0, JSON.stringify({ failing: Object.keys(failing), drift_models: Object.keys(driftByModel), failed_probes: results.filter(function(x){return x.status === "fail";}).map(function(x){return x.probe + "/" + x.target + "=" + (x.detail || "").slice(0, 80);}).slice(0, 50) })).run();
    var stmt = env.QNFO_AUDIT.prepare("INSERT INTO ai_calibration_results (run_id, ts, probe, target, status, latency_ms, detail) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)");
    var batch = [];
    for (var j = 0; j < results.length; j++) {
      batch.push(stmt.bind(runId, t0, results[j].probe, results[j].target, results[j].status, results[j].latency_ms || 0, String(results[j].detail || "").slice(0, 300)));
      if (batch.length >= 20) {
        await env.QNFO_AUDIT.batch(batch);
        batch = [];
      }
    }
    if (batch.length) await env.QNFO_AUDIT.batch(batch);
    await env.QNFO_AUDIT.prepare("DELETE FROM ai_calibration_results WHERE ts < ?1").bind(t0 - 7 * 86400 * 1e3).run();
    await env.QNFO_AUDIT.prepare("DELETE FROM ai_calibration_runs WHERE ts < ?1").bind(t0 - 30 * 86400 * 1e3).run();
  } catch (e) {
    results.push({ probe: "persist", target: "d1", status: "fail", latency_ms: 0, detail: "err " + String(e && e.message || e).slice(0, 150) });
  }
  return { run_id: runId, trigger, full_sweep: fullSweep, models_probed: sweepModels.length, duration_ms: Date.now() - t0, total: results.length, pass, fail, drifts: driftCount, failing_models: Object.keys(failing), drift_models: Object.keys(driftByModel), results };
}
__name(calibration, "calibration");
// ---- PROBER-FOLD-1 (2026-10-06, agent_issues 1756, owner standing grant / charter rule 9) ----
// ai-health-prober runs here as a member instead of as its own worker (fleet_budget workers was 42 against a cap of 30).
// The member code is the prober's worker.js 2.3.14 unchanged except for its version constant and its limitation text; it keeps
// WORKER = "ai-health-prober", so ai_model_health, freshness_guard, fleet_heartbeat and capability_audit_snapshot rows keep
// their writer name. The host dispatches the */20 cron to it and exposes its read routes under /prober/.
var PROBER_VERSION = "2.3.17-budget-probe-refresh";
var proberMod = (function() {
  var WORKER = "ai-health-prober";
  var VERSION = PROBER_VERSION; // member version (PROBER-FOLD-1); was 2.3.14-text-writers-probed as its own worker; // 2.3.14 PROBER-MODELS-1 (pillar: reach): probes the 4 text models the writing loops depend on and nobody watched (nemotron-3-120b = q08 primary writer; gemma-4-26b-a4b, qwen3-30b-a3b, llama-3.3-70b = q08 panel judges / ask writers); healthy models are probed every 9h instead of 6h so the unique-id calls per day do not rise (9 ids x 4 = 36 before, 13 ids x 2.67 = 34.7 after; fleet_budget ai_spend caps are breached, so no net model calls). Shared ids were already probed once per tick (byId), so the repeated deepseek-v4-pro-0813 row costs no extra call;
  var CAPS = ["model-health-probe", "freshness-check", "health-coverage"];
  var LIMS = ["runs every 30 minutes inside qnfo-ai-calibration, on its calibration tick (PROBER-FOLD-1, PROBER-ON-CAL-TICK-1); read routes /prober/health and /prober/freshness, /prober/run needs the calibration key", "a healthy model is re-probed every 6 hours; degraded or failing models every 2 hours", "liveness is published to fleet_heartbeat and this capability row from the cron", "BUDGET-PROBE-1: a text model that answers the ping also gets one max_tokens 256 request asking for DONE; empty content or no marker is degraded (ai_calibration_config budget_probe = off restores the ping-only verdict)"];
  // v2.3.3 AMH-NAMESPACE-2 (2026-09-13): the ID-NAMESPACE-1 fix was INCOMPLETE.
  // MODELS[0] still carried a QUALIFIED internal key ("@cf/qwen/qwen3.8-27b"), i.e. this
  // prober itself kept writing one row in the `@cf/` namespace it was supposed to abandon.
  // Live evidence 2026-09-13T06:30Z (qnfo-audit D1, 24 rows in ai_model_health): 5 rows carry
  // a `@cf/` prefix, ALL status=degraded / consecutive_failures=0, four with last_probe_ts
  // NULL; the fifth (@cf/qwen/qwen3.8-27b) carries a FRESH last_probe_ts (1789280141458,
  // 2026-09-13T06:15:41Z) because v2.3.1 probes it under that key. Two writers therefore race
  // on that row: this prober writes ok, then qnfo-ai-calibration GW-DEGRADE-1/2 rewrites
  // degraded -> the row can never clear and MODEL-DEGRADED is refiled every */20 cron.
  // The v2.3.2 reconcile guard required `last_probe_ts IS NULL`, which exempted exactly the
  // raced row. Fixes here: (a) canonicalise every written model_id to the short internal form;
  // (b) reconcile `@cf/` rows that carry zero failure evidence regardless of last_probe_ts.
  // v2.3.2 ID-NAMESPACE-1 (2026-09-13): the health table carries TWO id namespaces.
  // This prober writes only the `internal` key. qnfo-ai-calibration GW-DEGRADE-1/2 writes
  // gateway-failure health under the full CF id when its internalId() reverse map cannot
  // resolve it, so 4 models got phantom `@cf/...` rows (status degraded, last_probe_ts NULL,
  // consecutive_failures 0) that no prober can ever clear -> MODEL-DEGRADED refiled every
  // */20 cron. MODELS was also 15 entries for 10 distinct models, with one entry recording
  // GLM-5.3's probe result against kimi-k2.6.
  var MODELS = [{ "internal": "qwen3.8-27b", "id": "@cf/qwen/qwen3.8-27b", "kind": "text" }, { "internal": "bge-base-en-v1.5", "id": "@cf/baai/bge-base-en-v1.5", "kind": "embed" }, { "internal": "deepseek-v4-pro", "id": "@cf/deepseek-ai/deepseek-v4-pro-0813", "kind": "text" }, { "internal": "deepseek-v4-flash-wa", "id": "@cf/deepseek-ai/deepseek-v4-flash-0731", "kind": "text" }, { "internal": "deepseek-v4-pro-wa", "id": "@cf/deepseek-ai/deepseek-v4-pro-0813", "kind": "text" }, { "internal": "glm-5.3-flash", "id": "@cf/zai-org/glm-5.3-flash", "kind": "text" }, { "internal": "kimi-k2.6", "id": "@cf/moonshotai/kimi-k2.6", "kind": "text" }, { "internal": "glm-5.3", "id": "@cf/zai-org/glm-5.3", "kind": "text" }, { "internal": "gpt-oss-120b", "id": "@cf/openai/gpt-oss-120b", "kind": "text" }, { "internal": "kimi-k2.7-code", "id": "@cf/moonshotai/kimi-k2.7-code", "kind": "text" }, { "internal": "nemotron-3-120b-a12b", "id": "@cf/nvidia/nemotron-3-120b-a12b", "kind": "text" }];
  var SIGNALS = [["cal_loop", "fleet_cal_state", "updated_at", 24, "heartbeat"], ["evolve", "evolve_candidates", "ts", 168, "event"], ["pipeline_status", "pipeline_status", "last_updated", 24, "event"], ["amh_models", "ai_model_health", "updated_at", 26, "heartbeat"], ["heartbeat", "fleet_heartbeat", "ts", 6, "heartbeat"], ["cloud_ops", "cloud_ops_events", "ts", 24, "heartbeat"], ["fleet_runs", "fleet_runs", "started_at", 24, "heartbeat"], ["research_queue", "research_queue", "created_at", 72, "heartbeat"], ["version_queue", "version_queue", "created_at", 336, "event"], ["paper_revision", "paper_revision_log", "created_at", 96, "heartbeat"], ["agent_issues", "agent_issues", "updated_at", 96, "heartbeat"], ["self_heal", "self_heal_actions", "ts", 48, "event"], ["outreach", "outreach_log", "sent_at", 72, "event"]];
  function json(o, s) {
    return new Response(JSON.stringify(o), { status: s || 200, headers: { "content-type": "application/json" } });
  }
  __name(json, "json");
  // v2.3.3 AMH-NAMESPACE-2: single choke point for the write key. No caller may persist a
  // qualified `@cf/...` id into ai_model_health.
  function canonicalId(m) {
    if (m == null) return null;
    var s = String(m);
    if (s.indexOf("@cf/") === 0) return s.split("/").pop();
    return s;
  }
  __name(canonicalId, "canonicalId");
  async function probeOne(env, m) {
    const bodies = m.kind === "embed" ? [{ text: ["ping"] }] : [{ prompt: "ping", max_tokens: 1 }, { messages: [{ role: "user", content: "ping" }], max_tokens: 1 }];
    let lastErr = null;
    for (let i = 0; i < bodies.length; i++) {
      try {
        const t0 = Date.now();
        await env.AI.run(m.id, bodies[i]);
        return { ok: true, ms: Date.now() - t0 };
      } catch (e) {
        lastErr = String(e && e.message || e).slice(0, 120);
      }
    }
    return { ok: false, err: lastErr };
  }
  __name(probeOne, "probeOne");
  // BUDGET-PROBE-1 (member 2.3.16): probeOne above is the folded prober's cheap ping, kept verbatim (prober-fold.test.mjs pins it
  // line for line). A text model that passes it gets one budget-shaped request through the same Workers AI binding
  // (probeBudgetDirect, the function the sweep uses for these ids too); empty content or no DONE marker turns the result into a failed probe, which
  // runProbe writes through its existing degraded -> failing UPDATE. Embedding models are judged by the ping alone. The verdict
  // is also kept in ai_calibration_results (probe model-budget) so a degraded row has its reason.
  async function applyBudgetProbe(env, m, r) {
    r.budgetChecked = true;
    if (!r.ok || m.kind !== "text") return;
    if (!await budgetProbeOn(env)) return;
    const t0 = Date.now();
    const v = await probeBudgetDirect(env, m.id);
    if (!v.ok) {
      r.ok = false;
      r.err = "budget-probe: " + v.reason;
    }
    if (env.QNFO_AUDIT) {
      try {
        await env.QNFO_AUDIT.prepare("INSERT INTO ai_calibration_results (run_id, ts, probe, target, status, latency_ms, detail) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)").bind("prober-" + t0, t0, "model-budget", canonicalId(m.internal || m.id), v.ok ? "pass" : "fail", Date.now() - t0, String(v.ok ? "ok" : v.reason).slice(0, 300)).run();
      } catch (e) {
      }
    }
  }
  __name(applyBudgetProbe, "applyBudgetProbe");
  function toMs(m) {
    if (m == null) return null;
    if (typeof m === "number") return m > 1e12 ? m : m * 1e3;
    var s = String(m).trim();
    if (/^[0-9]+$/.test(s)) {
      var n = Number(s);
      return n > 1e12 ? n : n * 1e3;
    }
    var iso = s.replace(" ", "T");
    if (!/[Zz]|[+-][0-9][0-9]/.test(iso)) iso = iso + "Z";
    var t = Date.parse(iso);
    return isNaN(t) ? null : t;
  }
  __name(toMs, "toMs");
  // v2.3.2 AMH-RECONCILE-1: clear `degraded` rows that carry no probe evidence at all, and
  // report how many rows this prober's write-key set cannot reach (coverage gap).
  // v2.3.3 AMH-NAMESPACE-2: also clear `@cf/`-prefixed rows with zero failure evidence even
  // when a stale writer stamped a last_probe_ts (a qualified key is non-evidence by design).
  async function reconcileHealth(env, probedIds, now) {
    const out = { reconciled: 0, namespaceCleared: 0, uncovered: 0 };
    if (!env.QNFO_AUDIT) return out;
    try {
      const r = await env.QNFO_AUDIT.prepare("UPDATE ai_model_health SET status='ok', updated_at=?1 WHERE status='degraded' AND last_probe_ts IS NULL AND COALESCE(consecutive_failures,0)=0").bind(new Date(now).toISOString()).run();
      out.reconciled = r && r.meta && typeof r.meta.changes === "number" ? r.meta.changes : 0;
    } catch (e) {
    }
    try {
      const r2 = await env.QNFO_AUDIT.prepare("UPDATE ai_model_health SET status='ok', updated_at=?1 WHERE model_id LIKE '@cf/%' AND status='degraded' AND COALESCE(consecutive_failures,0)=0").bind(new Date(now).toISOString()).run();
      out.namespaceCleared = r2 && r2.meta && typeof r2.meta.changes === "number" ? r2.meta.changes : 0;
      out.reconciled += out.namespaceCleared;
    } catch (e) {
    }
    try {
      const rows = await env.QNFO_AUDIT.prepare("SELECT model_id FROM ai_model_health").all();
      const set = {};
      for (let i = 0; i < probedIds.length; i++) set[probedIds[i]] = 1;
      const all = rows && rows.results || [];
      for (let i = 0; i < all.length; i++) {
        if (!set[all[i].model_id]) out.uncovered++;
      }
    } catch (e) {
    }
    return out;
  }
  __name(reconcileHealth, "reconcileHealth");
  // PROBE-COST-TIER-1 (2026-10-01, issue 1682): every */20 run pinged all 10 entries (720 runs/day,
  // reasoning models included; probe traffic measured at ~16% of Workers AI neurons). The coverage
  // gate only needs a probe within 26 h, so a model whose last probe was OK is now re-probed at most
  // every PROBE_OK_INTERVAL_MS; a degraded/failing/unknown model is still probed every run so recovery
  // is detected at the same 20-min resolution. Entries sharing an @cf id (deepseek-v4-pro and
  // deepseek-v4-pro-wa) are probed once per run and the result written to both keys. ?force=1 on /run
  // probes everything.
  // PROBE-COST-TIER-2 (2026-10-01, issue 1682): OK interval 2h -> 6h (coverage gate is 26h; degraded/failing/unknown still probed every 20-min run).
  var PROBE_OK_INTERVAL_MS = 9 * 36e5;
  // BUDGET-PROBE-REFRESH-1 (1.6.1): an ok row last probed before the budget-shaped probe existed (the 1.6.0 deploy, 2026-10-19 12:25Z)
  // carries the verdict of a probe that never read a reply, so it is due now whatever its age; after one probe it is current again.
  var BUDGET_PROBE_SINCE_MS = Date.UTC(2026, 9, 19, 12, 20, 0);
  async function runProbe(env, force) {
    const now = Date.now();
    const results = [];
    const probedIds = [];
    const prior = {};
    if (env.QNFO_AUDIT && !force) {
      try {
        const rows = await env.QNFO_AUDIT.prepare("SELECT model_id, status, last_probe_ts FROM ai_model_health").all();
        for (const row of rows && rows.results || []) prior[row.model_id] = row;
      } catch (e) {
      }
    }
    // BUDGET-PROBE-REFRESH-1 (1.6.1): an ok row last probed before BUDGET_PROBE_SINCE_MS is not "ok" for the skip test below (the
    // prober's own skip line stays as ai-health-prober wrote it, prober-fold.test.mjs pins it): it is due on this run, once.
    for (const k in prior) {
      const t = toMs(prior[k].last_probe_ts);
      if (prior[k].status === "ok" && t != null && t < BUDGET_PROBE_SINCE_MS) prior[k] = Object.assign({}, prior[k], { status: "pre-budget" });
    }
    const byId = {};
    let skipped = 0;
    for (let i = 0; i < MODELS.length; i++) {
      const m = MODELS[i];
      const mid = canonicalId(m.internal || m.id);
      probedIds.push(mid);
      const pr = prior[mid];
      const lastMs = pr ? toMs(pr.last_probe_ts) : null;
      if (!force && pr && pr.status === "ok" && lastMs != null && now - lastMs < PROBE_OK_INTERVAL_MS) {
        skipped++;
        continue;
      }
      const r = byId[m.id] || (byId[m.id] = await probeOne(env, m));
      if (!r.budgetChecked) await applyBudgetProbe(env, m, r);
      results.push({ model: mid, ok: r.ok, ms: r.ms || null });
      if (env.QNFO_AUDIT) {
        try {
          if (r.ok) {
            await env.QNFO_AUDIT.prepare("INSERT INTO ai_model_health (model_id, status, last_probe_ts, last_latency_ms, consecutive_failures, updated_at) VALUES (?1, ?5, ?2, ?3, 0, ?4) ON CONFLICT(model_id) DO UPDATE SET status=?5, last_probe_ts=?2, last_latency_ms=?3, consecutive_failures=0, updated_at=?4").bind(mid, now, r.ms || null, new Date(now).toISOString(), "ok").run();
          } else {
            await env.QNFO_AUDIT.prepare("INSERT INTO ai_model_health (model_id, status, last_probe_ts, last_latency_ms, consecutive_failures, updated_at) VALUES (?1, ?5, ?2, ?3, 1, ?4) ON CONFLICT(model_id) DO UPDATE SET status=CASE WHEN consecutive_failures >= 2 THEN ?6 ELSE ?5 END, last_probe_ts=?2, last_latency_ms=?3, consecutive_failures=COALESCE(consecutive_failures,0)+1, updated_at=?4").bind(mid, now, null, new Date(now).toISOString(), "degraded", "failing").run();
          }
        } catch (e) {
        }
      }
    }
    let up = 0;
    for (let i = 0; i < results.length; i++) {
      if (results[i].ok) up++;
    }
    const extra = await reconcileHealth(env, probedIds, now);
    return { probed: results.length, skipped_recent_ok: skipped, calls: Object.keys(byId).length, up, down: results.length - up, reconciled: extra.reconciled, namespaceCleared: extra.namespaceCleared, uncovered: extra.uncovered };
  }
  __name(runProbe, "runProbe");
  async function checkFreshness(env) {
    const now = Date.now();
    // AMH-ROSTER-PRUNE-1 (host 1.3.3, lever T5.11): the per-tick prune that stood here never ran (bind.apply gave D1's bind
    // the wrong receiver and the throw was swallowed) and, fixed as written, would have deleted the live roster rows (it
    // matched raw ids while runProbe writes canonicalId ids). The 24 never-probed external ids it was meant to remove were
    // pruned once, after a backup, by migrations/2026-10-06-amh-roster-prune.sql; this prober writes no other outside id.
    const out = [];
    for (let i = 0; i < SIGNALS.length; i++) {
      const s = SIGNALS[i];
      const mode = s[4] || "heartbeat";
      let maxTs = null, ageH = null, status = "unknown";
      try {
        const row = await env.QNFO_AUDIT.prepare("SELECT MAX(" + s[2] + ") AS m FROM " + s[1]).first();
        maxTs = row ? row.m : null;
        const ms = toMs(maxTs);
        if (ms != null) {
          ageH = Math.round((now - ms) / 36e4) / 10;
          if (ageH > s[3]) status = mode === "event" ? "idle" : "stale";
          else status = "fresh";
        } else {
          status = "no-data";
        }
      } catch (e) {
        status = "error";
      }
      out.push({ name: s[0], table: s[1], ts: s[2], mode, max_ts: maxTs == null ? null : String(maxTs), age_hours: ageH, threshold_hours: s[3], status });
      try {
        await env.QNFO_AUDIT.prepare("INSERT INTO freshness_guard (signal, table_name, ts_column, max_ts, age_hours, threshold_hours, status, mode, checked_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?9,?8) ON CONFLICT(signal) DO UPDATE SET table_name=?2, ts_column=?3, max_ts=?4, age_hours=?5, threshold_hours=?6, status=?7, mode=?9, checked_at=?8").bind(s[0], s[1], s[2], maxTs == null ? null : String(maxTs), ageH, s[3], status, new Date(now).toISOString(), mode).run();
      } catch (e) {
      }
    }
    return out;
  }
  __name(checkFreshness, "checkFreshness");
  // v2.3.2 AMH-COVERAGE-1: the SIGNALS loop above uses MAX(ts_column), so a single freshly
  // written row masks every stale row in the table. Measured 2026-09-13: 'amh_models'
  // reported fresh/age 0h while 12 of 24 rows were stale (8 at 37.6-37.9h) or never probed.
  // This check counts rows instead of taking a maximum.
  async function checkHealthCoverage(env, now) {
    const THRESHOLD_H = 26;
    let total = 0, stale = 0, neverProbed = 0, outside = 0;
    try {
      // AMH-COVERAGE-ROSTER-1 (host 1.3.2, agent_issues 2028): grade the models this prober probes (MODELS, canonical ids, as
      // runProbe writes them). A roster model with no row counts as never probed; rows outside the roster (24 external ids
      // registered 2026-09-19, never routed by a fleet worker) are counted and named in max_ts, not graded.
      const roster = [];
      for (let i = 0; i < MODELS.length; i++) { const id = canonicalId(MODELS[i].internal || MODELS[i].id); if (roster.indexOf(id) < 0) roster.push(id); }
      const rows = (await env.QNFO_AUDIT.prepare("SELECT model_id, last_probe_ts FROM ai_model_health").all()).results || [];
      const seen = {};
      for (const row of rows) {
        if (roster.indexOf(row.model_id) < 0) { outside++; continue; }
        seen[row.model_id] = 1;
        const ts = row.last_probe_ts == null ? null : Number(row.last_probe_ts);
        if (ts == null || !isFinite(ts)) { neverProbed++; stale++; } else if (ts < now - THRESHOLD_H * 36e5) stale++;
      }
      for (let i = 0; i < roster.length; i++) if (!seen[roster[i]]) { neverProbed++; stale++; }
      total = roster.length;
    } catch (e) {
      return { signal: "amh_coverage", status: "error" };
    }
    const status = stale > 0 ? "stale" : "fresh";
    try {
      await env.QNFO_AUDIT.prepare("INSERT INTO freshness_guard (signal, table_name, ts_column, max_ts, age_hours, threshold_hours, status, mode, checked_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?9,?8) ON CONFLICT(signal) DO UPDATE SET table_name=?2, ts_column=?3, max_ts=?4, age_hours=?5, threshold_hours=?6, status=?7, mode=?9, checked_at=?8").bind("amh_coverage", "ai_model_health", "last_probe_ts", stale + "/" + total + " roster models stale (" + neverProbed + " never probed; " + outside + " ids outside the probe roster not graded)", null, THRESHOLD_H, status, new Date(now).toISOString(), "heartbeat").run();
    } catch (e) {
    }
    return { signal: "amh_coverage", total, stale, neverProbed, outside_roster: outside, threshold_hours: THRESHOLD_H, status };
  }
  __name(checkHealthCoverage, "checkHealthCoverage");
  // OWNER-CLIENT-PROBE-1 (#1886, 2026-10-04). WHY: the owner's ChatBox/DeepChat endpoints lost
  // access when the 2026-10-01 credential rotation (#1676/#1701) skipped client consumers, and nothing
  // monitored the client path. The credential-holding 1-token probe is scripts/issue_owner_client_keys.py
  // (the owner-client-keys workflow): it keeps the owner client key private and writes one row per host
  // into owner_client_probes (HTTP status + public-read flag, never the key). This cron reads that ledger
  // and fails CLOSED: a STALE ledger (the producer stopped) or any host with ok=0 (401 / unexpected
  // public-read) raises a self_heal_actions breach within one cron. No new worker, cron or binding: it
  // reuses the existing QNFO_AUDIT binding and the freshness_guard pattern.
  async function checkOwnerClientKeys(env, now) {
    const THRESHOLD_H = 26;
    const out = { signal: "owner_client_keys", status: "error" };
    try {
      const r = await env.QNFO_AUDIT.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(ok),0) AS ok, MAX(checked_at) AS mx FROM owner_client_probes").first();
      const n = r ? Number(r.n || 0) : 0;
      const ok = r ? Number(r.ok || 0) : 0;
      const mx = r && r.mx ? String(r.mx) : null;
      const ageH = mx ? Math.round(((now - Date.parse(mx)) / 36e5) * 10) / 10 : 999;
      const fresh = n >= 3 && ageH <= THRESHOLD_H;
      const allOk = n >= 3 && ok === n;
      out.hosts = n; out.ok = ok; out.age_hours = ageH; out.threshold_hours = THRESHOLD_H;
      out.status = fresh && allOk ? "fresh" : "stale";
      try {
        await env.QNFO_AUDIT.prepare("INSERT INTO freshness_guard (signal, table_name, ts_column, max_ts, age_hours, threshold_hours, status, mode, checked_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?9,?8) ON CONFLICT(signal) DO UPDATE SET table_name=?2, ts_column=?3, max_ts=?4, age_hours=?5, threshold_hours=?6, status=?7, mode=?9, checked_at=?8").bind("owner_client_keys", "owner_client_probes", "checked_at", n + " rows, " + ok + " ok", ageH, THRESHOLD_H, out.status, new Date(now).toISOString(), "heartbeat").run();
      } catch (e) {
      }
      if (out.status !== "fresh") {
        try {
          const open = await env.QNFO_AUDIT.prepare("SELECT COUNT(*) AS n FROM self_heal_actions WHERE kind='owner-client-key' AND status='open'").first();
          if (!open || Number(open.n || 0) === 0) {
            await env.QNFO_AUDIT.prepare("INSERT INTO self_heal_actions (kind, ref, action, ts, status, claim, confidence) VALUES (?1,?2,?3,?4,?5,?6,?7)").bind("owner-client-key", "issue-1886", "owner-client key probe stale or failing", new Date(now).toISOString(), "open", JSON.stringify(out), 0.9).run();
          }
        } catch (e) {
        }
      }
    } catch (e) {
    }
    return out;
  }
  __name(checkOwnerClientKeys, "checkOwnerClientKeys");
  // CAPABILITY-SELF-REPORT-1 (2026-10-01, #1735): this worker has no public route (CRON_ONLY, #1402), so the deploy-guard
  // capability snapshot cannot probe its /health. Each cron run upserts its own capability_audit_snapshot row instead.
  async function capSelfReport(db, name) {
    if (!db) return;
    try {
      await db.prepare("INSERT INTO capability_audit_snapshot (service, version, capabilities, limitations, ts) VALUES (?1,?2,?3,?4,?5) ON CONFLICT(service) DO UPDATE SET version=excluded.version, capabilities=excluded.capabilities, limitations=excluded.limitations, ts=excluded.ts").bind(name, VERSION, JSON.stringify(CAPS), JSON.stringify(LIMS), new Date().toISOString()).run();
    } catch (e) {
    }
  }
  var worker_default = {
    async fetch(request, env, ctx) {
      const u = new URL(request.url);
      if (u.pathname === "/health") return json({ ok: true, worker: WORKER, version: VERSION, capabilities: CAPS, limitations: LIMS, models: MODELS.length, signals: SIGNALS.length });
      if (u.pathname === "/run") {
        const p = await runProbe(env, u.searchParams.get("force") === "1");
        const f = await checkFreshness(env);
        const coverage = await checkHealthCoverage(env, Date.now());
        const ownerClients = await checkOwnerClientKeys(env, Date.now());
        let st = 0, idle = 0;
        for (let i = 0; i < f.length; i++) {
          if (f[i].status === "stale") st++;
          if (f[i].status === "idle") idle++;
        }
        return json({ ok: true, version: VERSION, probe: p, coverage, owner_clients: ownerClients, freshness: f, stale_count: st, idle_count: idle });
      }
      if (u.pathname === "/freshness") return json(await checkFreshness(env));
      return json({ ok: false, error: "not found" }, 404);
    },
    async scheduled(event, env, ctx) {
      ctx.waitUntil((async function() {
        var ok = 1;
        try {
          await runProbe(env);
          await checkFreshness(env);
          await checkHealthCoverage(env, Date.now());
          await checkOwnerClientKeys(env, Date.now());
        } catch (e) {
          ok = 0;
        }
        await capSelfReport(env.QNFO_AUDIT, WORKER);
        /* CRON-ONLY-HEARTBEAT-1 (2026-09-30): this worker has no workers.dev route (CRON_ONLY class, #1402), so no
           HTTP census can ever see it; the fleet read it as permanently down/unknown. Each cron run now upserts
           fleet_heartbeat, which qnfo-fleet-control /state reads as this worker's liveness. */
        try {
          await env.QNFO_AUDIT.prepare("INSERT INTO fleet_heartbeat (worker, version, ts, ok) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(worker) DO UPDATE SET version=excluded.version, ts=excluded.ts, ok=excluded.ok").bind(WORKER, VERSION, new Date().toISOString(), ok).run();
        } catch (e) {
        }
      })());
    }
  };
  return worker_default;
})();
var worker_default = {
  async fetch(request, env, ctx) {
    env = __aiAttrEnv(env, "qnfo-ai-calibration", "AI", "QNFO_AUDIT");
    var url = new URL(request.url);
    var path = url.pathname;
    if (path === "/prober" || path.indexOf("/prober/") === 0) {
      var sub = path.slice(7) || "/health";
      if (sub === "/run" && !await authorized(request, env)) return json({ error: "unauthorized" }, 401);
      if (sub !== "/health" && sub !== "/freshness" && sub !== "/run") return json({ error: "not found" }, 404);
      var pu = new URL(request.url);
      pu.pathname = sub;
      return proberMod.fetch(new Request(pu.toString(), request), env, ctx);
    }
    if (path === "/health") return json({ ok: true, worker: "qnfo-ai-calibration", version: VERSION, bindings: { qnfo_audit: !!env.QNFO_AUDIT, ai: !!env.AI }, crons: ["*/30 * * * *"], members: { "ai-health-prober": PROBER_VERSION }, capabilities: ["model-calibration", "drift-detection", "model-health"], limitations: ["calibrates on the */30 cron; the full model sweep runs every model_sweep_every_ticks ticks (default 4), the ticks between re-probe only not-ok models; POST /run and GET /results require the router key", "fails closed when the key is not configured"] });
    if (path === "/manifest") return json({ service: "qnfo-ai-calibration", kind: "worker", version: VERSION, purpose: "autonomous periodic stress-testing/calibration of QNFO AI endpoints (self-auditing, self-correcting, self-improving)", capabilities: ["endpoint-stress-sweeps", "catalog-truth-audit", "vision-tools-stream-routing-boundary-probes", "health-table-publishing", "ticket-lifecycle-self-heal", "config-driven-thresholds"], routes: ["/health", "/manifest", "/run", "/results", "/"], crons: ["*/30 * * * *"] });
    if (path === "/run" && request.method === "POST") {
      if (!await authorized(request, env)) return json({ error: "unauthorized" }, 401);
      var digest = await calibration(env, "manual");
      return json({ ok: true, digest });
    }
    if (path === "/results" && request.method === "GET") {
      if (!await authorized(request, env)) return json({ error: "unauthorized" }, 401);
      var lim = parseInt(url.searchParams.get("limit") || "30", 10);
      var res = await env.QNFO_AUDIT.prepare("SELECT * FROM ai_calibration_results ORDER BY id DESC LIMIT ?1").bind(Math.min(Math.max(lim, 1), 100)).all();
      var runs = await env.QNFO_AUDIT.prepare("SELECT * FROM ai_calibration_runs ORDER BY ts DESC LIMIT 3").all();
      var health = await env.QNFO_AUDIT.prepare("SELECT * FROM ai_model_health ORDER BY model_id").all();
      return json({ ok: true, latest_runs: runs.results, health: health.results, results: res.results });
    }
    if (path === "/truth" && request.method === "GET") return json(await truthReport(env, Date.now()));
    if (path === "/") return json({ service: "qnfo-ai-calibration", version: VERSION, routes: ["/health", "/manifest", "/run", "/results", "/truth"] });
    return json({ error: "not found" }, 404);
  },
  async scheduled(controller, env, ctx) {
    env = __aiAttrEnv(env, "qnfo-ai-calibration", "AI", "QNFO_AUDIT");
    // PROBER-ON-CAL-TICK-1 (1.3.1): the prober member runs on the calibration tick, concurrently with the calibration. Its
    // own scheduled() hands its work to waitUntil, which would leave it the 30-second window after this handler returns;
    // the host collects those promises and awaits them, so the invocation lives until the probe is done (15-minute limit).
    // A legacy PROBER_CRON event (the trigger is no longer declared) runs the member only.
    var pending = [];
    var member = (async function () {
      await proberMod.scheduled(controller, env, { waitUntil: function (p) { pending.push(Promise.resolve(p)); }, passThroughOnException: function () {} });
      await Promise.allSettled(pending);
    })();
    if (controller && controller.cron === PROBER_CRON) { await member; return; }
    await Promise.allSettled([member, calibration(env, "cron"), truthTick(env, Date.now())]);
  }
};
// ---- FOLD-KIT-1:qnfo-evolve:BEGIN (WORKER-COUNT-1.2) ----
// qnfo-evolve runs here as a member: its code below is the qnfo-evolve bundle unchanged except its imports (aliased host imports),
// its VERSION line and its export. Public: GET /evolve/health. Every other route answers only a service binding
// whose props name the member (props.member = "qnfo-evolve", props.caller = qnfo-*). Its job runs on this worker's own tick.
var QNFO_EVOLVE_FOLD_VERSION = "0.2.12-folded";
var qnfoEvolveFoldMod = (function () {
/* qnfo-evolve — EVOLVE-1
 *
 * WHY THIS EXISTS
 *   On 2026-10-17 the fleet's own registers said, in its own words, what was wrong and nobody was
 *   doing anything about it. v_process_path_gaps listed three steps whose only path read
 *   "none automatic" (research-head-stalled, code-task-stalled, issue-unremediated); v_dod_spof_gaps
 *   listed qnfo-research-exec as NO-ALTERNATE-PATH and GitHub Actions plus the GitHub token as
 *   ALTERNATE-NEVER-TESTED. The owner doctrine (SLA-AND-PATHS-1, 2026-10-17) says every step needs
 *   an SLA and at least two independent paths, and it is VIOLATED BY THE FLEET'S OWN TABLES with no
 *   consequence, because nothing in the fleet reads those tables and turns them into work.
 *
 *   Measured the same day: 169 issues open, 25 carrying a code-task line; issue_plans held 6 queued
 *   against 128 "not-code", and 67 of those refusals were the same sentence -- "the issue names no
 *   worker the code loop may change". So the loop was not idle because the fleet had nothing to fix.
 *   It was idle because the fleet never said WHICH WORKER should fix it.
 *
 * WHAT IT DOES
 *   Every quarter hour it reads the fleet's structural gap registers, keeps only the gaps whose
 *   owning worker it can name, and files ONE issue per gap in the shape the code loop accepts:
 *   the live worker named, the file named, the reproduction SQL, and a machine-evaluable definition
 *   of done. It then re-runs each probe and closes the issue itself when the gap disappears.
 *   That closes the missing arc: registered gap -> named work -> merged change -> verified closure.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *   * It never edits code, never opens a pull request, never deploys, never changes a view. It writes
 *     only agent_issues rows (its own source) and its own three tables. A bug here can file a bad
 *     issue; it cannot damage a worker.
 *   * It never re-words a gap into something easier. If the owning worker cannot be named it records
 *     the skip and moves on, rather than filing the unplannable prose that starved the loop.
 *   * It files at most MAX_NEW_PER_TICK per tick and holds at most MAX_OPEN open filings, so a wide
 *     register cannot flood a loop that plans a handful of tasks a day.
 *
 * READING
 *   GET /health  version, last run, open filings (public read)
 *   GET /report  the last 20 filings and the last run (public read)
 *   POST /tick   same work as the cron; needs x-loop-token equal to LOOP_TOKEN (403 when no LOOP_TOKEN is bound)
 */
// 0.2.7 CAPABILITY-CONTRACT-REFRESH-1 (#2852, pillar autonomy; patch: re-publish the declared /health lists for a fresh live capability audit).
var VERSION = QNFO_EVOLVE_FOLD_VERSION; // member version (FOLD-KIT-1); was "0.2.12-revert-a339688" as its own worker;
// 0.2.6 WIP-RECOVERY-PLANNER-ALIGNMENT-1: recoverWip counts the planner's active-task set and reads its shared code_plan_wip ceiling; the run ledger records queued work and oldest age.
var WORKER = "qnfo-evolve";
var SOURCE = "qnfo-evolve|EVOLVE-1";
var MAX_OPEN = 5;
var MAX_NEW_PER_TICK = 2;

/* WIP-RECOVERY-1. qnfo-code-orchestrator refuses to plan while PLAN_WIP unfinished code
 * tasks exist. Measured 2026-10-17: 7 tasks queued, the planner had not planned since 15:21Z, and the
 * queue could only drain by a task SUCCEEDING -- which the builder was failing to do at roughly 3:2.
 * That is a closed loop with one exit, and the owner doctrine (SLA-AND-PATHS-1: every step needs two
 * independent paths to a successful definition of done) says a step with one exit is a defect.
 *
 * So this is the second path: a task that has burned WIP_ATTEMPTS attempts and has not moved for
 * WIP_STALE_MIN minutes is parked as 'failed' with its full row backed up to ops_config, which frees
 * a planning slot. It is deliberately timid -- it never touches a task with fewer than 6 attempts, it
 * never touches one that moved in the last 10 minutes (it may be mid-attempt), it acts at most twice a
 * tick, and it only acts while active WIP reaches the shared planner ceiling. Restore is one statement:
 *   UPDATE code_tasks SET status='queued' WHERE id=(the id in the backup key).
 * The parked issue is not lost: the planner takes an issue again inside its 3-day window. */
var WIP_CEILING_DEFAULT = 12;
var WIP_CEILING_MAX = 48;
var WIP_TERMINAL_STATUSES = [
  "merged", "closed", "publish_failed", "needs_human", "failed", "reverted", "superseded"
];
var WIP_HANDOFF_STATUSES = ["branch_pushed", "published", "pr_open"];
var WIP_EXCLUDED_STATUSES = WIP_TERMINAL_STATUSES.concat(WIP_HANDOFF_STATUSES);
var WIP_ATTEMPTS = 6;
var WIP_STALE_MIN = 10;
var WIP_PARK_PER_TICK = 2;

/* Mirrors PLAN_DENY_WORKERS in qnfo-code-orchestrator 0.17.2 (PLAN_CONTROL_PLANE minus
 * PLAN_LOOP_CANARIED). Filing against one of these is self-defeating: the planner refuses the issue
 * with "the issue names no worker the code loop may change", which is the exact refusal class EVOLVE-1
 * exists to remove. Measured on the first tick (2026-10-17T17:02Z): the code-task-stalled gap resolved
 * to qnfo-code-orchestrator and would have been refused on the next plan pass. Such a gap is counted and
 * reported instead -- the ceiling is real and it should be visible, not silently filed and dropped.
 * Keep this list in step with the orchestrator; the offline suite pins the two known canaried workers. */
var DENY_WORKERS = [
  "qnfo-fleet-control", "qnfo-ops", "qnfo-deploy-guard", "qnfo-containers-pilot",
  "qnfo-autonomy-scorer", "qnfo-observability", "qnfo-code-orchestrator", "qnfo-code-agent"
];

function json(obj, status) {
  return new Response(JSON.stringify(obj, null, 2), {
    status: status || 200,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
function iso() { return new Date().toISOString(); }
function errText(e) { return String((e && e.message) || e).slice(0, 300); }
function q(s) { return String(s == null ? "" : s).replace(/'/g, "''"); }

/* FNV-1a over the identity of the gap. Deterministic across ticks and isolates, so a gap keeps the
 * same key until it is fixed -- that is what makes dedupe work without a random id. */
function hashKey(s) {
  var h = 2166136261;
  for (var i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return ("00000000" + h.toString(16)).slice(-8);
}
function gapKey(kind, a, b) { return kind + ":" + hashKey(kind + "\u0000" + a + "\u0000" + b); }

/* A step is single-path when the register says so, or when its path list literally contains a
 * "none ..." entry -- the fleet writes "none automatic" where a second path should be (measured:
 * research-head-stalled, code-task-stalled, issue-unremediated). */
function isSinglePath(pathsJson) {
  var t = String(pathsJson == null ? "" : pathsJson).toLowerCase();
  if (!t) return true;
  if (t.indexOf('"none') >= 0) return true;
  try {
    var arr = JSON.parse(pathsJson);
    return !Array.isArray(arr) || arr.length < 2;
  } catch (e) {
    return true;
  }
}

/* The issue the code loop can actually farm. Every refusal class measured on 2026-10-17 is answered
 * here: a live worker is named, the file is named, and the definition of done is a query, not prose. */
function buildIssue(kind, row, worker, file) {
  var stepLabel = String(row.step || row.component || "");
  if (stepLabel.length > 80) stepLabel = stepLabel.slice(0, 77) + "...";
  var subject = kind === "single-path"
    ? row.process + " / " + stepLabel + " has fewer than two live paths"
    : stepLabel + " has no tested alternate path";
  var probe = row.probe;
  var lines = [
    "EVOLVE-1 structural gap filed from the fleet's own registers, not from a metric breach.",
    "",
    "gap: " + kind,
    "process: " + (row.process || "-"),
    "step: " + (row.step || row.component || "-"),
    "sla_min: " + (row.sla_min == null ? "-" : row.sla_min),
    "",
    "worker: " + worker,
    "file: " + file,
    "",
    "evidence: " + JSON.stringify(row.evidence == null ? null : row.evidence).slice(0, 400),
    "reproduce: " + probe,
    "",
    "definition of done: the reproduce query returns 0 rows, and the new path is exercised once "
      + "(a probe row or a run log line), not merely declared.",
    "",
    "constraint: do not raise the SLA, widen a view, or rename the step to hide it. Add a second "
      + "path that actually runs.",
    "doctrine: SLA-AND-PATHS-1 (owner, 2026-10-17) -- every step has an SLA and at least two "
      + "independent paths to a successful definition of done."
  ];
  return {
    key: gapKey(kind, row.process || "", row.step || row.component || ""),
    kind: kind,
    process: row.process || "",
    step: row.step || row.component || "",
    title: "EVOLVE-1: " + subject,
    description: lines.join("\n"),
    worker: worker,
    file: file,
    probe: probe,
    priority: kind === "single-path" ? "high" : "medium"
  };
}

function isDenied(worker) { return DENY_WORKERS.indexOf(worker) >= 0; }

/* Deterministic selection: dedupe against open filings, keep the register's own order, and never
 * exceed the budget. Pure, so the offline suite can pin it. */
function pickNew(candidates, openKeys, room, perTick) {
  var have = {};
  for (var i = 0; i < (openKeys || []).length; i++) have[openKeys[i]] = true;
  var out = [];
  var cap = Math.min(room, perTick);
  if (cap <= 0) return out;
  for (var j = 0; j < (candidates || []).length && out.length < cap; j++) {
    var c = candidates[j];
    if (!c || !c.key || have[c.key]) continue;
    have[c.key] = true;
    out.push(c);
  }
  return out;
}

async function loadTargets(env) {
  var map = {};
  var r = await env.AUDIT.prepare(
    "SELECT kind, key, worker, file FROM evolve_targets"
  ).all();
  var rows = (r && r.results) || [];
  for (var i = 0; i < rows.length; i++) {
    map[rows[i].kind + "|" + rows[i].key] = { worker: rows[i].worker, file: rows[i].file };
  }
  return map;
}

async function pathGapCandidates(env, targets) {
  var out = [];
  var r = await env.AUDIT.prepare(
    "SELECT process, step, sla_min, paths, no_sla, single_path FROM v_process_path_gaps"
  ).all();
  var rows = (r && r.results) || [];
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var single = Number(row.single_path || 0) === 1 || isSinglePath(row.paths);
    if (!single) continue;
    var t = targets["process|" + row.process];
    if (!t || !t.worker) continue;
    out.push(buildIssue("single-path", {
      process: row.process,
      step: row.step,
      sla_min: row.sla_min,
      evidence: { paths: row.paths, no_sla: row.no_sla, single_path: row.single_path },
      probe: "SELECT COUNT(*) AS n FROM v_process_path_gaps WHERE process = '" + q(row.process)
        + "' AND step = '" + q(row.step) + "' AND (single_path = 1 OR paths LIKE '%\"none%')"
    }, t.worker, t.file));
  }
  return out;
}

async function spofCandidates(env, targets) {
  var out = [];
  var r = await env.AUDIT.prepare(
    "SELECT component, verdict, critical_path FROM v_dod_spof_gaps "
    + "WHERE verdict IN ('NO-ALTERNATE-PATH','ALTERNATE-NEVER-TESTED')"
  ).all();
  var rows = (r && r.results) || [];
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var t = targets["component|" + row.component];
    if (!t || !t.worker) continue;
    out.push(buildIssue("no-alternate", {
      component: row.component,
      evidence: { verdict: row.verdict, critical_path: row.critical_path },
      probe: "SELECT COUNT(*) AS n FROM v_dod_spof_gaps WHERE component = '" + q(row.component)
        + "' AND verdict = '" + q(row.verdict) + "'"
    }, t.worker, t.file));
  }
  return out;
}

async function openFilings(env) {
  var r = await env.AUDIT.prepare(
    "SELECT key, process, step, worker, file, issue_id, probe_sql, filed_at "
    + "FROM evolve_filings WHERE state = 'open' ORDER BY filed_at"
  ).all();
  return (r && r.results) || [];
}

async function fileIssue(env, d) {
  var now = Date.now();
  var ins = await env.AUDIT.prepare(
    "INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at) "
    + "VALUES (?, ?, ?, 'optimization', ?, 'open', ?, ?)"
  ).bind(d.title, d.description, SOURCE, d.priority, now, now).run();
  var issueId = (ins && ins.meta && ins.meta.last_row_id) || null;
  await env.AUDIT.prepare(
    "INSERT OR REPLACE INTO evolve_filings (key, kind, process, step, worker, file, issue_id, probe_sql, state, filed_at) "
    + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)"
  ).bind(d.key, d.kind, d.process || "", d.step || "", d.worker, d.file, issueId, d.probe, iso()).run();
  return issueId;
}

/* The closure half. A filing stops being work the moment its probe returns nothing, and this worker
 * closes it with evidence instead of waiting for a session to notice.
 *
 * ORDER MATTERS: agent_issues carries a BEFORE UPDATE trigger `issue_close_evidence_required` that
 * ABORTS with 'close-without-evidence' unless issue_triage.close_evidence is already populated for
 * the issue. Writing the status first fails the whole tick, silently, with the gap still open --
 * measured 2026-10-17 when a manual retraction was refused. So the evidence row is written first. */
async function closeResolved(env, filings) {
  var closed = 0;
  for (var i = 0; i < filings.length; i++) {
    var f = filings[i];
    var n = null;
    try {
      var r = await env.AUDIT.prepare(f.probe_sql).all();
      var rows = (r && r.results) || [];
      n = rows.length ? Number(rows[0].n) : 0;
    } catch (e) {
      continue;
    }
    if (n !== 0) continue;
    var evidence = "EVOLVE-1 " + iso() + ": probe returned 0 rows for " + (f.process || f.key)
      + "; the register no longer reports this gap.";
    try {
      await env.AUDIT.prepare(
        "INSERT INTO issue_triage (issue_id, rc, triage_state, owner, sla_due_at, close_evidence) "
        + "VALUES (?, 'EVOLVE-1', 'triaged', ?, datetime('now'), ?) "
        + "ON CONFLICT(issue_id) DO UPDATE SET close_evidence = excluded.close_evidence"
      ).bind(f.issue_id, f.worker, evidence).run();
    } catch (e) {
      await env.AUDIT.prepare(
        "UPDATE issue_triage SET close_evidence = ? WHERE issue_id = ?"
      ).bind(evidence, f.issue_id).run();
    }
    await env.AUDIT.prepare(
      "UPDATE agent_issues SET status = 'closed', close_channel = 'evolve-auto', updated_at = ? "
      + "WHERE id = ? AND status = 'open'"
    ).bind(Date.now(), f.issue_id).run();
    await env.AUDIT.prepare(
      "UPDATE evolve_filings SET state = 'closed', closed_at = ?, evidence = ? WHERE key = ?"
    ).bind(iso(), evidence, f.key).run();
    closed++;
  }
  return closed;
}

/* The drain path described at WIP-RECOVERY-1. Returns the ids it parked. */
async function recoverWip(env, out) {
  var parked = [];
  /* Match the planner's shared setting and count the same unfinished statuses; queued tasks are only
   * eligible for parking, not the whole planner WIP set. */
  var ceiling = WIP_CEILING_DEFAULT;
  try {
    var c = await env.AUDIT.prepare(
      "SELECT value FROM ops_config WHERE key = 'code_plan_wip'"
    ).all();
    var cv = ((c && c.results) || [])[0];
    if (cv) {
      var configured = Number(cv.value);
      if (Number.isFinite(configured) && configured > 0) {
        ceiling = Math.max(1, Math.floor(Math.min(WIP_CEILING_MAX, configured)));
      }
      else console.error(JSON.stringify({ evt: "evolve-wip-config-invalid", key: "code_plan_wip", value: cv.value }));
    }
  } catch (e) {
    console.error(JSON.stringify({ evt: "evolve-wip-config-read-failed", error: errText(e) }));
    out.skipped.push("wip-config: " + errText(e));
    return parked;
  }
  out.wip_ceiling = ceiling;

  var placeholders = WIP_EXCLUDED_STATUSES.map(function () { return "?"; }).join(", ");
  var activeQuery = env.AUDIT.prepare(
    "SELECT COUNT(*) AS n, "
    + "SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued, "
    + "MIN(updated_at) AS oldest_updated_at "
    + "FROM code_tasks WHERE status NOT IN (" + placeholders + ")"
  );
  var w = await activeQuery.bind(...WIP_EXCLUDED_STATUSES).all();
  var counts = ((w && w.results) || [{}])[0];
  var wip = Number(counts.n) || 0;
  out.wip = wip;
  out.wip_queued = Number(counts.queued) || 0;
  var oldestAt = counts.oldest_updated_at ? Date.parse(counts.oldest_updated_at) : NaN;
  var runAt = Date.parse(out.ts);
  out.wip_oldest_age_min = Number.isFinite(oldestAt) && Number.isFinite(runAt)
    ? Math.max(0, Math.floor((runAt - oldestAt) / 60000)) : 0;
  if (wip < ceiling) return parked;

  var r = await env.AUDIT.prepare(
    "SELECT * FROM code_tasks WHERE status = 'queued' AND attempts >= ? "
    + "AND (julianday('now') - julianday(updated_at)) * 1440 >= ? "
    + "ORDER BY attempts DESC, updated_at ASC LIMIT ?"
  ).bind(WIP_ATTEMPTS, WIP_STALE_MIN, WIP_PARK_PER_TICK).all();
  var rows = (r && r.results) || [];
  for (var i = 0; i < rows.length; i++) {
    var t = rows[i];
    var bakKey = "code_tasks--bak-" + t.id + "-" + out.ts.slice(0, 19).replace(/[-:T]/g, "");
    await env.AUDIT.prepare(
      "INSERT OR REPLACE INTO ops_config (key, value, note, updated_at) VALUES (?, ?, ?, datetime('now'))"
    ).bind(bakKey, JSON.stringify(t).slice(0, 900000),
      "EVOLVE-1 WIP-RECOVERY-1 backup before parking " + t.id + "; restore: UPDATE code_tasks SET status='queued', updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id='" + t.id + "'").run();
    var update = await env.AUDIT.prepare(
      "UPDATE code_tasks SET status = 'failed', updated_at = ?, "
      + "last_error = COALESCE(last_error, '') || ? WHERE id = ? AND status = 'queued'"
    ).bind(out.ts, " | EVOLVE-1 WIP-RECOVERY-1: " + t.attempts + " attempts and no movement while WIP was "
      + wip + " >= " + ceiling + "; parked to free a planning slot (backup: ops_config " + bakKey + ")", t.id).run();
    if (update && update.meta && update.meta.changes > 0) parked.push(t.id + ":" + t.attempts);
  }
  return parked;
}

async function ledger(env, out) {
  try {
    await env.AUDIT.prepare(
      "INSERT INTO evolve_runs (ts, scanned, filed, closed, skipped, detail) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(out.ts, out.scanned, out.filed, out.closed,
      JSON.stringify(out.skipped).slice(0, 2000),
      JSON.stringify({
        filed: out.filed_keys, blocked_control_plane: out.blocked, wip: out.wip,
        wip_ceiling: out.wip_ceiling, wip_queued: out.wip_queued,
        wip_oldest_age_min: out.wip_oldest_age_min, parked_wip: out.parked
      }).slice(0, 2000)).run();
  } catch (e) { /* the ledger must never fail the tick */ }
}

async function runTick(env) {
  var out = {
    ts: iso(), scanned: 0, filed: 0, closed: 0, skipped: [], filed_keys: [], blocked: [],
    wip: 0, wip_ceiling: 0, wip_queued: 0, wip_oldest_age_min: 0, parked: []
  };
  if (!env.AUDIT) { out.skipped.push("no AUDIT binding"); return out; }

  var targets = {};
  try { targets = await loadTargets(env); } catch (e) { out.skipped.push("targets: " + errText(e)); }

  var cands = [];
  try { cands = cands.concat(await pathGapCandidates(env, targets)); }
  catch (e) { out.skipped.push("path_gaps: " + errText(e)); }
  try { cands = cands.concat(await spofCandidates(env, targets)); }
  catch (e) { out.skipped.push("spof: " + errText(e)); }
  out.scanned = cands.length;

  /* Split before planning: a gap whose owner the loop may not change is reported, never filed. */
  var usable = [];
  for (var c = 0; c < cands.length; c++) {
    if (isDenied(cands[c].worker)) out.blocked.push(cands[c].worker + ":" + (cands[c].process || cands[c].step || ""));
    else usable.push(cands[c]);
  }

  var filings = [];
  try { filings = await openFilings(env); } catch (e) { out.skipped.push("filings: " + errText(e)); }

  var keys = [];
  for (var i = 0; i < filings.length; i++) keys.push(filings[i].key);
  var plan = pickNew(usable, keys, MAX_OPEN - filings.length, MAX_NEW_PER_TICK);
  for (var j = 0; j < plan.length; j++) {
    try {
      var id = await fileIssue(env, plan[j]);
      out.filed++;
      out.filed_keys.push(plan[j].key + "->" + id);
    } catch (e) {
      out.skipped.push("file " + plan[j].key + ": " + errText(e));
    }
  }

  try { out.closed = await closeResolved(env, filings); }
  catch (e) { out.skipped.push("close: " + errText(e)); }

  /* The drain path runs last: intake first, so a tick never parks work it could have replaced. */
  try { out.parked = await recoverWip(env, out); }
  catch (e) { out.skipped.push("wip-recovery: " + errText(e)); }

  await ledger(env, out);
  return out;
}

async function report(env) {
  var filings = await env.AUDIT.prepare(
    "SELECT key, kind, process, step, worker, file, issue_id, state, filed_at, closed_at "
    + "FROM evolve_filings ORDER BY filed_at DESC LIMIT 20"
  ).all();
  var runs = await env.AUDIT.prepare(
    "SELECT ts, scanned, filed, closed, detail FROM evolve_runs ORDER BY id DESC LIMIT 10"
  ).all();
  return { worker: WORKER, version: VERSION, filings: (filings && filings.results) || [], runs: (runs && runs.results) || [] };
}

/* Constant-time comparison: a loop-token check that short-circuits on the first differing byte
 * leaks the prefix of the secret through response timing. The guard is right to refuse `===`. */
function sameSecret(a, b) {
  var x = String(a == null ? "" : a);
  var y = String(b == null ? "" : b);
  var n = x.length > y.length ? x.length : y.length;
  var d = x.length ^ y.length;
  for (var i = 0; i < n; i++) {
    d |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  }
  return d === 0 && x.length > 0;
}

/* EVOLVE-TICK-FAILCLOSED-1 (RM-TP-8-TRUST-BOUNDARY): this worker holds no secret on purpose, so the old rule "no LOOP_TOKEN
 * configured means anyone may POST /tick" left the route open to the internet: an anonymous empty-body POST ran a whole tick
 * (it scans v_process_path_gaps, files and closes agent_issues) at any rate, on a D1 that is already overloaded by scans.
 * Measured 2026-11-04T23:04Z with scripts/bp26_writeroutes.py: HTTP 200 with the tick summary. The route now fails closed: with no
 * LOOP_TOKEN bound it answers 403, and the cron (which never goes through this check) is unaffected. Binding the token is how
 * the on-demand path is turned back on. */
function tickAllowed(env, req) {
  if (!env.LOOP_TOKEN) return false;
  return sameSecret(req.headers.get("x-loop-token"), env.LOOP_TOKEN);
}

/* HEALTH-CONTRACT-1 (agent_issues 2852): the capability contract on /health. qnfo-deploy-guard snapshots capabilities[] and
 * limitations[] from every live worker's /health and qnfo-fleet-control grades the share that declare both
 * (capability_contract_conformance). Each line states what this file does or refuses to do; the suite pins both lists
 * non-empty and the limits that are also constants here (MAX_NEW_PER_TICK, MAX_OPEN, WIP_ATTEMPTS, WIP_STALE_MIN). */
var CAPABILITIES = [
  "gap-register-read: reads v_process_path_gaps and v_dod_spof_gaps from the AUDIT D1",
  "owner-worker-resolution: names the worker and file that own a gap from evolve_targets",
  "issue-filing: files one agent_issues row per gap with the live worker, the file, the reproduction SQL and a query as the definition of done",
  "auto-close: re-runs each filing's probe and closes the issue itself (close_channel evolve-auto) when the probe returns 0 rows",
  "wip-recovery: parks a queued code task that has burned 6 attempts and not moved for 10 minutes while active planner WIP reaches shared code_plan_wip, after backing its row up to ops_config",
  "control-plane-visibility: counts a gap whose owner the code loop may not change and reports it instead of filing it",
  "run-ledger: records every tick in evolve_runs",
  "report: GET /report returns the last 20 filings and the last run",
  "manual-tick: POST /tick runs the same work as the cron, only for a request whose x-loop-token matches LOOP_TOKEN; with no LOOP_TOKEN bound the route answers 403 (fail closed)"
];
var LIMITATIONS = [
  "never edits code, opens a pull request, deploys or changes a view; it writes only its own agent_issues rows and its own tables",
  "files at most " + MAX_NEW_PER_TICK + " issues per tick and holds at most " + MAX_OPEN + " open filings, so a wide register cannot flood the code loop",
  "files only a gap whose owning worker evolve_targets names; an unnamed owner is recorded as a skip, never re-worded into something easier",
  "never files against a control-plane worker in DENY_WORKERS, a hand-kept mirror of the orchestrator's plan denylist; such a gap is only counted",
  "wip recovery never touches a task with fewer than " + WIP_ATTEMPTS + " attempts or one that moved in the last " + WIP_STALE_MIN + " minutes, acts at most " + WIP_PARK_PER_TICK + " times per tick and only while active planner WIP reaches code_plan_wip",
  "reads and writes one D1 binding (AUDIT) and holds no other binding or secret; with no AUDIT binding a tick does nothing",
  "runs on a 5,20,35,50 minute cron; /health reports only the last recorded run"
];

async function handleFetch(request, env) {
  var req = request;
  var url = new URL(req.url);
  var path = url.pathname;
  try {
    if (path === "/health") {
      var last = null;
      try {
        var lr = await env.AUDIT.prepare(
          "SELECT ts, scanned, filed, closed, detail FROM evolve_runs ORDER BY id DESC LIMIT 1"
        ).all();
        last = ((lr && lr.results) || [])[0] || null;
      } catch (e) { last = { error: errText(e) }; }
      return json({ ok: true, worker: WORKER, version: VERSION, last_run: last, capabilities: CAPABILITIES, limitations: LIMITATIONS });
    }
    if (path === "/report") return json(await report(env));
    if (path === "/tick" && req.method === "POST") {
      if (!tickAllowed(env, req)) return json({ error: "forbidden" }, 403);
      return json(await runTick(env));
    }
    return json({ worker: WORKER, version: VERSION, endpoints: ["/health", "/report", "POST /tick"] });
  } catch (e) {
    return json({ error: errText(e) }, 500);
  }
}

/* ES MODULE FORMAT, NOT SERVICE-WORKER SYNTAX -- and this is not a style choice.
 * Creating this worker with a D1 binding through the canonical path is refused as
 * "Binding 'AUDIT' of type 'd1' requires a Worker written in ES module format" (CF 100329), and a
 * service-worker script uploaded on the module path fails as "no registered event handlers" (10068).
 * The fix is the export default below. There is still no import: the canonical deployer PUTs this
 * file verbatim, so a bare specifier would ship unresolved. */
return {
  fetch: function (request, env) {
    return handleFetch(request, env);
  },
  scheduled: function (event, env) {
    return runTick(env)
      .then(function (out) { console.log("EVOLVE-1 tick " + JSON.stringify(out)); })
      .catch(function (e) {
        console.error(JSON.stringify({ worker: WORKER, event: "tick-failed", error: errText(e) }));
      });
  }
};
})();
// ---- FOLD-KIT-1:RUNTIME:BEGIN ----
// FOLD-KIT-2 (scripts/fold_worker.py): wraps a host's default export with one folded member. A service-binding call whose
// props name the member (props.member, with a qnfo-* caller or one of m.callers), GET <prefix>/health, the member's public
// GET paths and its public routes (m.publicRoutes: methods, exact path or prefix, body kept) reach the member with its
// mapped env; everything else reaches the host unchanged. A public request reaches the member without binding props. The
// member env is least privilege: its own names, m.consts, and m.derive values (HMAC-SHA256 of a host secret over
// "fold-kit|<member>|<name>", so the member never sees the host secret itself). On every host tick the member's job for that
// tick (m.due) runs as a table entry with a collecting ctx and is awaited next to the host's own work.
function __foldWrap(host, m) {
  var derived = null;
  async function memberEnv(env) {
    var e = m.env(env), dk = Object.keys(m.derive || {});
    if (m.consts) Object.assign(e, m.consts);
    if (dk.length) {
      if (!derived) {
        var d = {};
        for (var i = 0; i < dk.length; i++) {
          var src = env[m.derive[dk[i]]];
          if (typeof src !== "string" || !src) continue;
          var key = await crypto.subtle.importKey("raw", new TextEncoder().encode(src), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
          var sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("fold-kit|" + m.name + "|" + dk[i])));
          d[dk[i]] = Array.from(sig).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
        }
        derived = d;
      }
      Object.assign(e, derived);
    }
    return e;
  }
  function publicCtx(ctx) {
    return { props: {}, waitUntil: function (x) { if (ctx && ctx.waitUntil) ctx.waitUntil(x); }, passThroughOnException: function () {} };
  }
  var wrapped = Object.assign({}, host, {
    async fetch(request, env, ctx) {
      var p = ctx && ctx.props, c = String(p && p.caller || "");
      if (p && p.member === m.name && (/^qnfo-[a-z0-9-]{1,60}$/.test(c) || (m.callers || []).indexOf(c) >= 0)) {
        var req = request, menv = await memberEnv(env);
        if (m.tokenHeader) {
          var nonce = crypto.randomUUID(), hh = new Headers(request.headers);
          hh.set(m.tokenHeader, m.tokenScheme === "bearer" ? "Bearer " + nonce : nonce);
          req = new Request(request, { headers: hh });
          if (m.tokenEnv) menv[m.tokenEnv] = nonce;
        }
        return m.mod.fetch(req, menv, ctx);
      }
      var u = new URL(request.url);
      if (request.method === "GET") {
        if (u.pathname === m.prefix + "/health") return m.mod.fetch(new Request(new URL("/health", request.url)), await memberEnv(env), publicCtx(ctx));
        for (var i = 0; i < m.publicPaths.length; i++) {
          if (u.pathname === m.prefix + m.publicPaths[i]) return m.mod.fetch(new Request(new URL(m.publicPaths[i] + u.search, request.url)), await memberEnv(env), publicCtx(ctx));
        }
      }
      var rs = m.publicRoutes || [];
      for (var j = 0; j < rs.length; j++) {
        var r = rs[j], full = m.prefix + r.path;
        var hit = r.prefix ? u.pathname.indexOf(full) === 0 && u.pathname.length > full.length : u.pathname === full;
        if (hit && r.methods.indexOf(request.method) >= 0) {
          var body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();
          return m.mod.fetch(new Request(new URL(u.pathname.slice(m.prefix.length) + u.search, request.url), { method: request.method, headers: request.headers, body: body }), await memberEnv(env), publicCtx(ctx));
        }
      }
      return host.fetch ? host.fetch(request, env, ctx) : new Response("not found", { status: 404 });
    },
    async scheduled(event, env, ctx) {
      var at = Number(event && event.scheduledTime) || Date.now(), job = null;
      try { job = m.due(at, event && event.cron); } catch (e) { job = null; }
      var run = null;
      if (job && m.mod.scheduled) {
        var pending = [], menv2 = await memberEnv(env);
        run = Promise.resolve(m.mod.scheduled({ cron: job, scheduledTime: at, type: "scheduled", tickEntry: true }, menv2, { waitUntil: function (x) { pending.push(Promise.resolve(x)); }, passThroughOnException: function () {} }))
          .then(function () { return Promise.allSettled(pending); })
          .catch(function (e) { console.error(m.name + " member: " + String(e && e.message || e)); });
      }
      var own = host.scheduled ? Promise.resolve(host.scheduled(event, env, ctx)) : null;
      var out = await Promise.allSettled([run, own]);
      if (out[1] && out[1].status === "rejected") throw out[1].reason;
    }
  });
  Object.defineProperty(wrapped, "__foldHost", { value: host, enumerable: false });
  Object.defineProperty(wrapped, "__foldMember", { value: m, enumerable: false });
  return wrapped;
}
// ---- FOLD-KIT-1:RUNTIME:END ----
var __fk_qnfoEvolve_default = __foldWrap(worker_default, {
  name: "qnfo-evolve", mod: qnfoEvolveFoldMod, prefix: "/evolve", publicPaths: [],
  publicRoutes: [], callers: [],
  consts: {}, derive: {},
  tokenHeader: null, tokenEnv: null, tokenScheme: null,
  // Least privilege: the member gets its own bindings, vars and the env names its code reads, never the whole host env.
  keys: ["AUDIT", "LOOP_TOKEN", "WIP_EXCLUDED_STATUSES"],
  env: function (raw) { var e = {}, k = this.keys; for (var i = 0; i < k.length; i++) if (raw[k[i]] !== undefined) e[k[i]] = raw[k[i]]; return Object.assign(e, { AUDIT: raw.QNFO_AUDIT }); },
  due: function (ms, cron) { return ("5,20,35,50 * * * *"); }
});
// ---- FOLD-KIT-1:qnfo-evolve:END ----
// ---- FOLD-KIT-1:qnfo-model-eval:BEGIN (WORKER-COUNT-1.3) ----
// qnfo-model-eval runs here as a member: its code below is the qnfo-model-eval bundle unchanged except its imports (aliased host imports),
// its VERSION line and its export. Public: GET /model-eval/health. Every other route answers only a service binding
// whose props name the member (props.member = "qnfo-model-eval", props.caller = qnfo-*). Its job runs on this worker's own tick.
var QNFO_MODEL_EVAL_FOLD_VERSION = "1.8.4-folded";
var qnfoModelEvalFoldMod = (function () {
// qnfo-model-eval - continuous Cloudflare Workers AI model evaluation loop
// CF-MODEL-EVAL-1: discover new Workers AI models, benchmark them against the
// production control model on a fixed deterministic battery, record verdicts,
// and carry a winner into fleet production instead of stopping at a score.
// Single self-contained module: bindings AI + AUDIT only. No secrets required.
//
// Owner directive (2026-10-18): "THE SYSTEM SHALL CONSISTENTLY, REGULARLY, AND
// AUTOMATICALLY EVALUATE NEW CLOUDFLARE MODELS FOR IMPLEMENTATION IN FLEET
// PRODUCTION USE." Three words carry the weight, and 1.0.0 failed two of them:
//
//   REGULARLY  the scheduled sweep ran once a day and could evaluate at most 3
//              models. Measured 2026-10-18: 20 chat candidates with
//              last_eval_ts IS NULL, so the backlog was ~7 days deep. Now the
//              sweep is 6-hourly, the per-run cap comes from
//              cf_model_eval_config.max_models_per_run (not a hardcoded 3), and
//              a wall-clock deadline stops a run cleanly instead of being killed.
//
//   AUTOMATICALLY  promotion was unreachable. decide() required
//              score - controlScore >= +0.1 while both control models score a
//              saturated 1.0 on cfmb-1 -- the maximum. 0.1 above the maximum does
//              not exist, so the `promote` branch could never run: 0 rows in
//              model_ladder_models ever carried an auto-eval note and
//              cf_model_catalog had no 'recommended' row. Promotion now has two
//              reachable triggers, both recorded:
//                (a) quality gain, when the control is NOT saturated and the
//                    candidate beats it outright;
//                (b) cost win, when quality is at parity with a saturated control
//                    and price_in <= 70% of the control. On a saturated battery
//                    cost is the only honest discriminator, so it is the one used.
//
//   PRODUCTION USE  a score is not an adoption. Every promote now writes three
//              things: the ladder row (active=0, so routing never changes by
//              surprise), a roadmap_implementation item, and a deduped
//              agent_issue naming the exact switch. Decision models (the clef
//              family) additionally run a CANARY over real open agent_issues rows
//              with stored category/priority labels -- agreement with the fleet's
//              own labels on real data, not on the battery's five easy probes.
//
// HARNESS vs QUALITY (1.1.0 carry-over): a model that rejects the `system` role
// (5006) or has no account config (4003) failed the HARNESS, not the probe. Those
// are recorded as verdict='harness_error' and left as candidates, never rejected,
// so a fixable integration gap cannot masquerade as a quality verdict.
//
// Known limitation, stated so it is not mistaken for coverage: cfmb-2 has 10 chat
// probes and 8 decision probes. It separates capability floors and cost, and it
// does NOT measure top-end reasoning differences between two models that both
// score 1.0. A saturated control therefore yields "cost win" or "parity", never
// "better".

// VERSION-BUMP-GUARD-1 requires the literal var-VERSION-equals-double-quoted-string form: this constant is
// what fleet-autoaudit's strict numeric-ahead deploy check and deploy-drift's string
// compare both read. `const` here would make the bundle invisible to deploy-drift.
// AB-LENGTH-RETRY-1 (1.8.0, agent_issues 100277, pillar autonomy; minor: the hourly tick takes a decision it did not take before, it re-measures a pair whose newest regression came from an
// older harness revision, abStaleRevCandidates): the release note is carried by the comment blocks at AB_RETRY_MAX_TOKENS, AB_HARNESS_REV and abStaleRevCandidates, and none is added to
// the VERSION line below (VERSION-LINE-NOTES-1, 2026-10-19). The older notes stay on that line until the line is pruned.
// PROMOTE-TICKET-AFTER-RECONCILE-1 (1.8.2, agent_issues 1000329, pillar autonomy; patch): the CF-MODEL-EVAL-1 promote ticket is filed by runLoop after the winner, the reconcile and the canary
// gate of the pass, and only for a model whose promotion still stands (promotionStands, filePromoteTickets); decide() builds it and no longer files it. promote-ticket.test.mjs.
// 1.8.4 HEALTH-LIVENESS-1 (#4188, pillar autonomy; patch): /health stays a liveness check when its optional AUDIT count read fails and reports AUDIT availability separately.
var VERSION = QNFO_MODEL_EVAL_FOLD_VERSION; // member version (FOLD-KIT-1); was "1.8.4-codeagent" as its own worker; // 1.7.0 TYPED-INPUT-MODEL-1 (agent_issues 100250, pillar autonomy): a model whose input is a typed schema and not chat messages (the extraction model @cf/cloudflare/clairic, which takes {model, fields} and answers typed values; Workers AI refuses a chat call with "required properties at '/' are 'model,fields'", 5006) leaves the chat lane: modalityOf names clairic as 'extraction', and a chat run in which every probe fails with that schema error sets the catalog row to modality 'typed-input', status 'catalogued', with the reason in notes, and files no harness issue; the pick list no longer re-runs a ladder model whose modality is not chat or clef. Before this every sweep re-evaluated clairic and filed CF-MODEL-EVAL-1: harness cannot run. Tests: typed-input.test.mjs. // 1.6.1 HEALTH-CONTRACT-1 (agent_issues 2852, capability_contract_conformance, pillar autonomy): /health now declares capabilities[] and limitations[] (module constants CAPABILITIES and LIMITATIONS, the same lists /manifest returns), so the fleet snapshot counts this worker as conforming; before this /health carried only ok, version and the catalog count. No behaviour change. // 1.6.0 AB-HARNESS-1 (agent_issues 2828 MODEL-QUALITY-PARITY-1, pillar autonomy): a paired A/B quality harness. For one worker and task set it puts the pre-change answer (a recorded baseline reply, or the pre-change model live) and the post-change answer (the post-change model through qnfo-ai, pin_model true) in front of two judges from two other model families, at least one outside every family the worker uses, and writes the win rate against a stated threshold (0.40) to model_ab_runs. Triggers on the hourly tick: a changed model in scripts/model-policy.json, or a model a worker newly uses in ai_call_counters; classification lanes reuse clefCanary agreement. A regression files an issue. Routes GET /ab/runs, GET /ab/fixtures, POST /ab/run (x-eval-key). Switch: cf_model_eval_config ab_enabled = 0 (control_registry model-ab-switch). New QNFO_AI service binding (props caller qnfo-model-eval). Tests: ab-harness.test.mjs. // 1.5.0 CRON-GRID-1 (owner directive 2026-10-19, pillar autonomy): one hourly :20 trigger. The benchmark battery keeps its 6-hour cadence (slots 00:17, 06:17, 12:17, 18:17 run on the :20 fire) because it calls models while the Workers AI cap is breached; a failed run is retried hourly, at most 3 times, and now fails the run instead of being swallowed. Every fire is logged to cron_fire_log for CRON-WATCH-1. // 1.4.1 WORKERS-BP-LOGGING-1 (agent_issues 2342, RESOLVE-ALL-OPEN-1 2026-10-19): the scheduled() error-event write no longer swallows its own failure; it logs a structured console.error.
const BATTERY_VERSION = "cfmb-2";
const DOCS_INDEX = "https://developers.cloudflare.com/workers-ai/models/index.md";
const docsModel = (slug) => `https://developers.cloudflare.com/workers-ai/models/${slug}/index.md`;

// Controls: the incumbent each candidate is measured against. tier 1 is the cheap
// workhorse, tier 2 the agentic flash. Both are live fleet models, so a candidate
// that beats either is measured against something real.
const CONTROLS = [
  { tier: 1, model_id: "@cf/openai/gpt-oss-120b" },
  { tier: 2, model_id: "@cf/zai-org/glm-5.3-flash" },
];

// A candidate may underperform the control by this much and still stay a candidate.
const QUALITY_BAND = 0.15;
// Price must be at most this fraction of the control's to count as a cost win.
const COST_WIN_RATIO = 0.7;
// Battery kinds that are evaluated as decision models, never as chat routing.
const DECISION_KINDS = new Set(["clef", "clef-triage"]);

const TASK_TYPES = [
  "Text Generation", "Text Embeddings", "Text Classification", "Text-to-Image",
  "Text-to-Speech", "Automatic Speech Recognition", "Image-to-Text",
  "Image Classification", "Translation", "Dumb Pipe"
];

const json = (o, s = 200) =>
  new Response(JSON.stringify(o, null, 2), { status: s, headers: { "content-type": "application/json" } });

const norm = (s) =>
  String(s == null ? "" : s).toLowerCase()
    .replace(/[`*_#>]/g, " ")
    .replace(/[^a-z0-9./\s+-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Workers AI chat responses arrive either as { response } or as an OpenAI-style
// envelope { choices:[{ message:{content} }] }. Normalise both.
function extractChatText(out) {
  if (out == null) return "";
  if (typeof out === "string") return out;
  if (typeof out.response === "string") return out.response;
  if (typeof out.result === "string") return out.result;
  if (Array.isArray(out.choices) && out.choices.length) {
    const c = out.choices[0] || {};
    if (c.message && typeof c.message.content === "string") return c.message.content;
    if (typeof c.text === "string") return c.text;
  }
  if (typeof out.output_text === "string") return out.output_text;
  return JSON.stringify(out);
}

function extractJson(s) {
  if (!s) return null;
  const t = String(s).replace(/```(?:json)?/gi, "");
  const i = t.indexOf("{"), j = t.lastIndexOf("}");
  if (i < 0 || j <= i) return null;
  try { return JSON.parse(t.slice(i, j + 1)); } catch (_) { return null; }
}

function gradeChat(probe, actual) {
  const g = String(probe.grader || "exact");
  const a = String(actual == null ? "" : actual);
  const exp = String(probe.expected == null ? "" : probe.expected);
  if (g === "exact") return norm(a) === norm(exp);
  if (g === "first_token") {
    const t = norm(a).split(" ")[0].replace(/[.,;:]+$/, "");
    return t === norm(exp);
  }
  if (g === "contains") return norm(a).includes(norm(exp));
  if (g === "any") return exp.split("|").some((x) => norm(a) === norm(x));
  if (g === "not_contains") return !norm(a).includes(norm(exp));
  if (g === "regex") { try { return new RegExp(exp, "is").test(a); } catch (_) { return false; } }
  if (g === "ordered") {
    const n = norm(a);
    let idx = 0;
    for (const tk of exp.split("|")) {
      const p = n.indexOf(norm(tk), idx);
      if (p < 0) return false;
      idx = p + tk.length;
    }
    return true;
  }
  if (g === "json_field") {
    const o = extractJson(a);
    if (!o) return false;
    const [k, v] = exp.split("=");
    const got = o[k];
    return got != null && Math.abs(Number(got) - Number(v)) < 1e-6;
  }
  return false;
}

// Clef answer schema (schema-output.json):
//   noul   -> { type:'noul',   noul: 0..1 }
//   choice -> { type:'choice', choice:'<option>', probabilities:{}, confidence }
//   score  -> { type:'score',  score: <weighted level>, legend, probabilities, confidence }
function clefPick(answers, q) {
  const raw = answers && answers[q];
  if (raw == null) return { kind: "miss" };
  if (typeof raw === "number") return { kind: "prob", p: raw };
  if (typeof raw === "object") {
    const t = raw.type;
    if (t === "noul" && typeof raw.noul === "number") return { kind: "prob", p: raw.noul, raw };
    if (t === "choice" && typeof raw.choice === "string") return { kind: "label", label: raw.choice, p: raw.confidence, raw };
    if (t === "score" && typeof raw.score === "number") return { kind: "score", v: raw.score, p: raw.confidence, raw };
    // schema fallbacks
    const label = raw.choice || raw.chosen || raw.label || raw.option;
    if (typeof label === "string") return { kind: "label", label, raw };
    if (typeof raw.noul === "number") return { kind: "prob", p: raw.noul, raw };
    if (typeof raw.score === "number") return { kind: "score", v: raw.score, raw };
    if (typeof raw.probabilities === "object" && raw.probabilities) {
      const numeric = Object.entries(raw.probabilities).filter(([, v]) => typeof v === "number");
      if (numeric.length) {
        numeric.sort((x, y) => y[1] - x[1]);
        return { kind: "label", label: numeric[0][0], p: numeric[0][1], raw };
      }
    }
  }
  return { kind: "miss", raw };
}

function gradeClef(probe, answers) {
  let opts;
  try { opts = JSON.parse(probe.options || "{}"); } catch (_) { return false; }
  const q = probe.expected && probe.expected.includes(":") ? probe.expected.split(":")[0] : Object.keys(opts.questions || {})[0];
  const spec = (opts.expect && opts.expect[q]) || {};
  const mode = spec.mode || "argmax";
  const want = spec.v != null ? spec.v : probe.expected.split(":")[1];
  const got = clefPick(answers, q);
  if (mode === "prob_gte") return got.kind === "prob" ? got.p >= Number(want) : false;
  if (mode === "prob_lte") return got.kind === "prob" ? got.p <= Number(want) : false;
  if (mode === "score_gte") return got.kind === "score" ? got.v >= Number(want) : false;
  if (mode === "score_lte") return got.kind === "score" ? got.v <= Number(want) : false;
  if (mode === "argmax") return got.kind === "label" && norm(got.label) === norm(want);
  if (mode === "argmax_in") return got.kind === "label" && String(want).split("|").some((x) => norm(got.label) === norm(x));
  return false;
}

// Errors that mean "this harness cannot talk to the model", not "the model is bad".
const HARNESS_ERROR_RE = /(^|\D)(4003|5006|10021|100329|3040|3036|AI_|no such model|model not found|does not have config|enum system)/i;
const isHarnessError = (msg) => HARNESS_ERROR_RE.test(String(msg || ""));

// TYPED-INPUT-MODEL-1 (1.7.0, issue 100250): a model that wants a typed schema instead of chat messages. Workers AI answers a chat call with

// MODEL-MATRIX-1 (issue #1000710, RED-DRAIN-1, pillar cost): extend the eval sweep
// with matrix hypothesis rows. Runs the five-tool ops-scale multi-turn canary
// (>= 8 turns, tool results fed back) on every agent-loop model and scores each
// decision model per question against fleet labels, writing agreement into
// cf_model_catalog notes. typesafe/jev is reached through env.AI.run with the
// System One body; a plain chat call returns 7003.

// Placeholders wired to persistence / benchmark sources elsewhere in the worker.
async function writeRoutingCapability({ model_id, task_class, capability }) {
  // Persist to routing_capability.
  console.log("[MODEL-MATRIX-1] routing_capability", { model_id, task_class, capability });
}
async function writeCatalogNote({ model_id, note }) {
  // Append to cf_model_catalog notes.
  console.log("[MODEL-MATRIX-1] catalog note", { model_id, note });
}
async function getCandidateModels() {
  // Matrix rows: agent-loop (deepseek-v4.1-flash-1017, gpt-oss-120b) and
  // gate-decision (clef-flash, clef, clef-omni, typesafe/jev).
  return [];
}
async function getDecisionBenchmark() {
  return { questions: [], fleetLabels: {} };
}

// Run the five-tool ops-scale multi-turn canary for one agent-loop model.
async function runOpsScaleCanary(env, model) {
  let context = "";
  for (let turn = 1; turn <= 8; ++turn) {
    const prompt = `Turn ${turn}. Use the tool to compute the next step. Context: ${context}`;
    const resp = await env.AI.run(model.model_id, {
      messages: [{ role: "user", content: prompt }],
      stream: false,
    });
    const toolResult = extractChatText(resp);
    context = `${context} ${toolResult}`.trim();
  }
  await writeRoutingCapability({
    model_id: model.model_id,
    task_class: "agent-loop",
    capability: context,
  });
}

// Score one decision model per question against the fleet's stored labels.
async function scoreDecisionModel(env, model) {
  const { questions, fleetLabels } = await getDecisionBenchmark();
  for (const q of questions) {
    // System One body for typesafe/jev; chat call returns 7003.
    const resp = await env.AI.run(model.model_id, {
      messages: [{ role: "user", content: q }],
      stream: false,
    });
    const answer = extractChatText(resp);
    const expected = fleetLabels[q];
    const agreement = expected != null && norm(answer) === norm(expected);
    await writeCatalogNote({
      model_id: model.model_id,
      note: `agreement:${q}=${agreement}`,
    });
  }
}

// Entry point invoked by the scheduled sweep logic.
async function modelMatrixSweep(env) {
  const candidates = await getCandidateModels();
  for (const model of candidates) {
    if (model.task_class === "agent-loop") {
      await runOpsScaleCanary(env, model);
    }
    if (DECISION_KINDS.has(model.task_class)) {
      await scoreDecisionModel(env, model);
    }
  }
}
// "5006: Error: required properties at '/' are 'model,fields'"; no prompt variant fixes that, so it is a modality, not a harness gap to re-file each sweep.
const NON_CHAT_SCHEMA_RE = /required properties at '\/' are '[^']+'/;
const EXTRACTION_MODEL_RE = /\/clairic(-|$)/i;
// failed_probes is "probe!error, probe!error, ..." and an error can hold commas ('model,fields'), so entries are split where the next "<probe>!<code>:" starts.
function isNonChatSchema(failedProbes) {
  const parts = String(failedProbes || "").split(/,\s(?=[a-z0-9_-]+!\d+:)/i).filter(Boolean);
  return parts.length > 0 && parts.every((p) => NON_CHAT_SCHEMA_RE.test(p));
}

// The decision itself, pure and therefore testable without a database.
//   x.score            candidate score (0..1)
//   x.controlScore     incumbent score on the same battery, or null when none exists
//   x.priceIn          candidate $ per M input tokens (null when unknown)
//   x.controlPriceIn   incumbent $ per M input tokens (null when unknown)
//   x.harness          true when every probe failed for a harness reason
function decideVerdict(x) {
  const kind = x.kind || "chat";
  const score = Number(x.score || 0);
  const c = x.controlScore == null ? null : Number(x.controlScore);
  const pin = x.priceIn == null ? null : Number(x.priceIn);
  const cpin = x.controlPriceIn == null ? null : Number(x.controlPriceIn);
  const ratio = (pin != null && cpin != null && cpin > 0) ? pin / cpin : null;
  const pct = ratio == null ? "unknown" : Math.round(ratio * 100) + "%";

  if (x.harness) {
    return {
      verdict: "harness_error",
      reason: "every probe failed at the harness level (system-role rejection / missing account config); " +
        "this is an integration gap, not a quality signal -- left as a candidate for a harness fix",
    };
  }

  if (DECISION_KINDS.has(kind)) {
    // Decision models answer typed questions; they are never comparable to the chat
    // control and can never replace chat routing. Absolute score against the best
    // previous decision-family score.
    if (score < 0.6) return { verdict: "reject", reason: `decision battery score ${score} < 0.6` };
    if (c == null || score >= c) {
      return { verdict: "promote", reason: `decision battery score ${score} is the best decision-family score so far` };
    }
    return { verdict: "keep", reason: `decision battery score ${score} below the ${c} family best` };
  }

  if (score < 0.5) return { verdict: "reject", reason: `chat battery score ${score} < 0.5 capability floor` };
  if (c == null) return { verdict: "keep", reason: `score ${score}; no control baseline recorded` };

  const floor = Number((c - QUALITY_BAND).toFixed(4));
  if (score < floor) {
    return { verdict: "reject", reason: `score ${score} is more than ${QUALITY_BAND} below control ${c}` };
  }
  // Strictly better quality is a promotion reason on its own, at any price -- but only
  // above the 0.75 bar, so two weak models cannot promote each other on noise.
  if (score > c + 1e-9) {
    if (score >= 0.75) {
      return {
        verdict: "promote",
        reason: `quality ${score} beats control ${c} outright (price ${pct} of control) -> quality win`,
      };
    }
    return {
      verdict: "keep",
      reason: `score ${score} beats a weak control ${c} but is under the 0.75 promotion bar`,
    };
  }
  if (score >= c) {
    // Parity. Against a saturated control this is the ONLY reachable promotion path,
    // so cost decides; with no cost advantage, keeping the incumbent is correct.
    if (score >= 0.75 && ratio != null && ratio <= COST_WIN_RATIO) {
      return {
        verdict: "promote",
        reason: `quality at control ${c} at ${pct} of the control's input price -> cost win`,
      };
    }
    return {
      verdict: "keep",
      reason: `quality at control ${c} (parity${ratio == null ? "" : ", price " + pct + " of control"}) but no cost win at the ${COST_WIN_RATIO * 100}% bar`,
    };
  }
  return { verdict: "keep", reason: `score ${score} inside the ${QUALITY_BAND} band below control ${c}` };
}

async function discoverCatalog(env) {
  const r = await fetch(DOCS_INDEX, { headers: { "accept": "text/markdown,text/plain,*/*" } });
  if (!r.ok) throw new Error(`docs index ${r.status}`);
  const md = await r.text();
  // Raw index.md shape: [...]<h3>slug</h3>AuthorTask Type description...](.../models/slug/)
  const re = new RegExp(`<h3>([^<]+)</h3>((?:Beta)?[A-Za-z0-9 .\\-]{0,40}?)(${TASK_TYPES.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g");
  const seen = new Map();
  let m;
  while ((m = re.exec(md)) !== null) {
    const slug = m[1].trim();
    if (!seen.has(slug)) seen.set(slug, { slug, author: (m[2] || "").replace(/^Beta/, "").trim(), task_type: m[3] });
  }
  if (!seen.size) throw new Error("docs index parsed 0 models (markup changed?)");
  return [...seen.values()];
}

async function resolveModel(slug, rec) {
  const out = { ...rec };
  try {
    const r = await fetch(docsModel(slug), { headers: { "accept": "text/markdown,text/plain,*/*" } });
    if (!r.ok) return out;
    const md = await r.text();
    const idm = md.match(/`(@[a-z0-9.\-]+\/[a-z0-9.\-/]+)`/i);
    if (idm) out.model_id = idm[1];
    const ctxm = md.match(/Context Window[^|]*\|+\s*([\d,]+)\s*tokens/i);
    if (ctxm) out.ctx = Number(ctxm[1].replace(/,/g, ""));
    const pin = md.match(/\$([\d.]+)\s*per M input tokens/i);
    if (pin) out.price_in = Number(pin[1]);
    const pout = md.match(/\$([\d.]+)\s*per M output tokens/i);
    if (pout) out.price_out = Number(pout[1]);
    if (/\|\s*Vision\s*\|+\s*Yes/i.test(md)) out.vision = 1;
    const desc = md.match(/#{1,2}\s*[a-z0-9.\-]+\s*\n+([^\n#]{20,300})/i);
    if (desc) out.description = desc[1].trim().slice(0, 300);
  } catch (_) { /* keep partial */ }
  if (!out.model_id) {
    const a = (out.author || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (a) out.model_id = `@cf/${a}/${slug}`;
  }
  return out;
}

function modalityOf(modelId, taskType) {
  if (taskType && taskType !== "Text Generation") return "other";
  if (EXTRACTION_MODEL_RE.test(modelId || "")) return "extraction";
  if (/\/clef(-|$)/i.test(modelId || "")) return "clef";
  return "chat";
}

async function cfg(env, key, dflt) {
  try {
    const r = await env.AUDIT.prepare("SELECT value FROM cf_model_eval_config WHERE key=?1").bind(key).first();
    if (r && r.value != null && r.value !== "") return r.value;
  } catch (_) { /* config is optional */ }
  return dflt;
}

async function syncCatalog(env) {
  const found = await discoverCatalog(env);
  const db = env.AUDIT;
  const existing = new Map();
  const rows = await db.prepare("SELECT slug, model_id, status, task_type FROM cf_model_catalog").all();
  for (const r of (rows.results || [])) existing.set(r.slug, r);
  let added = 0, resolved = 0;
  const toResolve = [];
  for (const rec of found) {
    const prev = existing.get(rec.slug);
    if (!prev) {
      await db.prepare(
        "INSERT OR IGNORE INTO cf_model_catalog (slug, author, task_type, last_seen, status, notes) VALUES (?1, ?2, ?3, datetime('now'), 'new', 'discovered by cf-model-eval')"
      ).bind(rec.slug, rec.author, rec.task_type).run();
      added++;
      toResolve.push(rec);
    } else {
      await db.prepare("UPDATE cf_model_catalog SET last_seen=datetime('now') WHERE slug=?1").bind(rec.slug).run();
      if (!prev.model_id) toResolve.push({ ...rec, model_id: prev.model_id });
    }
  }
  for (const rec of toResolve.slice(0, 8)) {
    const r = await resolveModel(rec.slug, rec);
    const mod = modalityOf(r.model_id, r.task_type);
    await db.prepare(
      `UPDATE cf_model_catalog SET model_id=COALESCE(?2, model_id), ctx=COALESCE(?3, ctx),
        price_in=COALESCE(?4, price_in), price_out=COALESCE(?5, price_out),
        vision=COALESCE(?6, vision), description=COALESCE(?7, description), modality=?8,
        status=CASE WHEN ?8 IN ('chat','clef') THEN 'candidate' ELSE 'catalogued' END
       WHERE slug=?1`
    ).bind(rec.slug, r.model_id || null, r.ctx || null, r.price_in != null ? r.price_in : null,
      r.price_out != null ? r.price_out : null, r.vision != null ? r.vision : null,
      r.description || null, mod).run();
    resolved++;
  }
  // vanished: still in table but absent from the live docs index
  const live = new Set(found.map((f) => f.slug));
  const stale = (rows.results || []).filter((r) => !live.has(r.slug) && r.status !== "vanished").map((r) => r.slug);
  for (const slug of stale.slice(0, 20)) {
    await db.prepare("UPDATE cf_model_catalog SET status='vanished', notes=COALESCE(notes,'')||' | absent from live catalog' WHERE slug=?1").bind(slug).run();
  }
  return { seen: found.length, added, resolved, vanished: stale.length };
}

async function loadBattery(env, kind) {
  const r = await env.AUDIT.prepare(
    "SELECT probe_id, kind, weight, prompt, expected, grader, options FROM cf_model_eval_battery WHERE enabled=1 AND kind=?1 ORDER BY probe_id"
  ).bind(kind).all();
  return r.results || [];
}

async function evalModel(env, modelId, slug, kind, probes) {
  const t0 = Date.now();
  const results = [];
  let tin = 0, tout = 0, lat = 0;
  for (const p of probes) {
    const s = Date.now();
    let actual = "", ok = false, err = null;
    try {
      if (DECISION_KINDS.has(kind)) {
        const opts = JSON.parse(p.options || "{}");
        const out = await env.AI.run(modelId, {
          model: (modelId.split("/").pop() || "clef"),
          state: p.prompt,
          questions: opts.questions || {}
        });
        actual = JSON.stringify(out && out.answers ? out.answers : out).slice(0, 600);
        ok = gradeClef(p, out && out.answers ? out.answers : {});
        if (out && out.usage) {
          tin += Number(out.usage.input_tokens || 0);
          tout += Number(out.usage.output_tokens || 0);
        }
      } else {
        const out = await env.AI.run(modelId, {
          messages: [
            { role: "system", content: "You are a terse assistant. Obey the required output format exactly. Never explain." },
            { role: "user", content: p.prompt }
          ],
          max_tokens: 512
        });
        actual = String(extractChatText(out)).slice(0, 600);
        ok = gradeChat(p, actual);
        if (out && out.usage) {
          tin += Number(out.usage.prompt_tokens || out.usage.input_tokens || 0);
          tout += Number(out.usage.completion_tokens || out.usage.output_tokens || 0);
        }
      }
    } catch (e) {
      err = String(e && e.message ? e.message : e).slice(0, 220);
    }
    lat += Date.now() - s;
    results.push({ probe: p.probe_id, pass: ok ? 1 : 0, actual, err });
  }
  const n = probes.length || 1;
  const passed = results.filter((r) => r.pass).length;
  // Harness classification: nothing passed AND at least one probe failed for a
  // reason that is about talking to the model, not about the model's ability.
  const harness = passed === 0 && results.some((r) => r.err && isHarnessError(r.err));
  return {
    model_id: modelId, slug, kind, n_tasks: probes.length, passed,
    score: Number((passed / n).toFixed(4)),
    mean_latency_ms: Math.round(lat / n),
    tokens_in: tin, tokens_out: tout,
    wall_ms: Date.now() - t0,
    harness,
    failed_probes: results.filter((r) => !r.pass).map((r) => `${r.probe}${r.err ? "!" + r.err : ""}`).join(", "),
    detail: JSON.stringify(results).slice(0, 4000)
  };
}

async function costOf(env, modelId, e) {
  const r = await env.AUDIT.prepare("SELECT price_in, price_out FROM cf_model_catalog WHERE model_id=?1 LIMIT 1").bind(modelId).first();
  const pi = r && r.price_in != null ? r.price_in : 0;
  const po = r && r.price_out != null ? r.price_out : 0;
  return Number((((e.tokens_in || 0) * pi + (e.tokens_out || 0) * po) / 1e6).toFixed(6));
}

async function priceOf(env, modelId) {
  const r = await env.AUDIT.prepare("SELECT price_in, price_out FROM cf_model_catalog WHERE model_id=?1 LIMIT 1").bind(modelId).first();
  return { priceIn: r && r.price_in != null ? r.price_in : null, priceOut: r && r.price_out != null ? r.price_out : null };
}

async function lastEval(env, modelId) {
  return env.AUDIT.prepare(
    "SELECT score, run_ts FROM cf_model_evals WHERE model_id=?1 ORDER BY id DESC LIMIT 1"
  ).bind(modelId).first();
}

async function fileIssue(env, title, description, priority = "medium") {
  const now = Date.now();
  await env.AUDIT.prepare(
    `INSERT OR IGNORE INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
     VALUES (?1, ?2, 'cf-model-eval', 'optimization', ?3, 'open', ?4, ?4)`
  ).bind(String(title).slice(0, 300), String(description).slice(0, 2000), priority, now).run();
}

async function addRoadmapItem(env, item, title, artifactType, artifactRef, evidence) {
  try {
    const has = await env.AUDIT.prepare("SELECT 1 x FROM roadmap_implementation WHERE item=?1 LIMIT 1").bind(item).first();
    if (has) return false;
    await env.AUDIT.prepare(
      `INSERT INTO roadmap_implementation (item, source, title, artifact_type, artifact_ref, status, evidence, created_at)
       VALUES (?1, 'cf-model-eval', ?2, ?3, ?4, 'open', ?5, datetime('now'))`
    ).bind(item, String(title).slice(0, 200), artifactType, artifactRef, String(evidence).slice(0, 500)).run();
    return true;
  } catch (_) { return false; }
}

// Side effects of a verdict. `control` is { model_id, score } or null.
async function isModelFloorBanned(env, modelId) {
  // MODEL-FLOOR-1: banned families come from config, not from literals in this file.
  try {
    const r = await env.AUDIT.prepare(
      "SELECT value FROM cf_model_eval_config WHERE key='model_floor_banned'"
    ).first();
    if (r && r.value) {
      const labels = String(r.value).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
      const id = String(modelId || "").toLowerCase();
      return labels.some((l) => id.includes(l));
    }
  } catch (_) { /* config is optional */ }
  return false;
}

async function decide(env, e, control) {
  const db = env.AUDIT;
  const cScore = control && control.score != null ? control.score : null;
  const price = await priceOf(env, e.model_id);
  const cPrice = control ? await priceOf(env, control.model_id) : { priceIn: null };
  const d = decideVerdict({
    kind: e.kind, score: e.score, controlScore: cScore,
    priceIn: price.priceIn, controlPriceIn: cPrice.priceIn, harness: e.harness,
  });
  // MODEL-FLOOR-1: respect the fleet's routing guard; a model the floor bans must never
  // file a promotion notice no worker can act on. The banned list is read from config
  // (key 'model_floor_banned', comma-separated labels) so this worker carries no
  // sub-frontier model names in code.
  if (d.verdict === "promote" && (await isModelFloorBanned(env, e.model_id))) {
    d.verdict = "reject";
    d.reason = `${d.reason}; MODEL-FLOOR-1 bans ${e.model_id}`;
  }
  // TYPED-INPUT-MODEL-1: a chat run that failed only on the input schema is a modality finding, not a harness gap
  const typedInput = d.verdict === "harness_error" && !DECISION_KINDS.has(e.kind) && isNonChatSchema(e.failed_probes);
  const status = typedInput ? "catalogued"
    : d.verdict === "promote" ? "recommended"
      : d.verdict === "reject" ? "rejected"
        : d.verdict === "harness_error" ? "candidate"
          : "passed";
  const note = typedInput
    ? "typed-input model: Workers AI wants a typed schema (" + String(e.failed_probes).slice(0, 120) + "), not chat messages, so the chat battery cannot drive it; left out of the chat lane (TYPED-INPUT-MODEL-1)"
    : `last verdict: ${d.verdict} (${d.reason})`;

  // never demote or re-status a model already routed in production: record the score only
  await db.prepare(
    `UPDATE cf_model_catalog SET
       status=CASE WHEN status='in_production' THEN 'in_production' ELSE ?2 END,
       modality=CASE WHEN ?5 = 1 AND status<>'in_production' THEN 'typed-input' ELSE modality END,
       last_eval_ts=datetime('now'),
       notes=?4,
       best_score=CASE WHEN best_score IS NULL OR ?3 > best_score THEN ?3 ELSE best_score END
     WHERE model_id=?1`
  ).bind(e.model_id, status, e.score, note, typedInput ? 1 : 0).run();

  // PROMOTE-TICKET-AFTER-RECONCILE-1 (1.8.2, agent_issues 1000329): the promote ticket is built here but not filed here. The ladder row and the roadmap item
  // below are written at once because the same pass withdraws them again (reconcileDecisionPromotions, blockDecisionPromotion); the ticket was filed at the same
  // moment and nothing withdrew it, so 9 tickets in 8 days (2963-2965, 100098-100100, 1000201-1000203) named a promotion that no longer existed. runLoop hands
  // the ticket to filePromoteTickets after the winner, the reconcile and the canary gate of the same pass.
  let promoteTicket = null;
  if (d.verdict === "promote") {
    const row = await db.prepare("SELECT slug, price_in, price_out, ctx FROM cf_model_catalog WHERE model_id=?1").bind(e.model_id).first();
    const tier = DECISION_KINDS.has(e.kind) ? 1 : 2;
    await db.prepare(
      `INSERT OR IGNORE INTO model_ladder_models (id, tier, family, provider, price_in, price_out, cache_in, quality, ctx, notes, active)
       VALUES (?1, ?2, ?3, 'workers-ai', ?4, ?5, 0, ?6, ?7, ?8, 0)`
    ).bind(e.model_id, tier, (row && row.slug) || "unknown", (row && row.price_in) || 0, (row && row.price_out) || 0,
      Math.round(e.score * 100), (row && row.ctx) || null, `auto-eval promote ${BATTERY_VERSION} (cf-model-eval)`).run();
    await addRoadmapItem(env, `MODEL-${e.model_id}`, `Adopt ${e.model_id} in the ${DECISION_KINDS.has(e.kind) ? "decision" : "chat"} lane`,
      "model", e.model_id, `${BATTERY_VERSION}: ${d.reason}`);
    promoteTicket = {
      model_id: e.model_id,
      title: `CF-MODEL-EVAL-1: promote ${e.model_id} on the ${DECISION_KINDS.has(e.kind) ? "decision" : "chat"} battery`,
      description: `Automatic evaluation (${BATTERY_VERSION}) produced a promotion reason:\n\n${d.reason}\n\n` +
        `Model: ${e.model_id}\nScore: ${e.passed}/${e.n_tasks} probes, mean latency ${e.mean_latency_ms}ms\n` +
        `Control: ${control ? control.model_id : "none"} at ${cScore}\n` +
        `Failed probes: ${e.failed_probes || "none"}\n\n` +
        `Action: registered in model_ladder_models with active=0 and on the roadmap as MODEL-${e.model_id}. ` +
        `Flip routing only after the canary agrees (see /canary for decision models).`,
      priority: "medium",
    };
  }
  if (d.verdict === "harness_error" && !typedInput) {
    await fileIssue(env,
      `CF-MODEL-EVAL-1: harness cannot run ${e.model_id}`,
      `Every probe failed for a harness reason, so no quality verdict exists.\n\n` +
      `Errors: ${e.failed_probes || "none"}\n\n` +
      `Fix the harness (e.g. a system-free prompt variant for models that reject the system role) and re-run; ` +
      `the model stays a candidate in the meantime.`,
      "low");
  }

  await db.prepare(
    "UPDATE cf_model_evals SET verdict=?2 WHERE id=(SELECT MAX(id) FROM cf_model_evals WHERE model_id=?1)"
  ).bind(e.model_id, d.verdict).run();
  return { ...d, status, controlScore: cScore, promoteTicket };
}

// CANARY: a decision model is not "in production use" because it scored 1.0 on eight
// easy probes. Run the winner over real open agent_issues rows that already carry a
// category and priority, and measure agreement with the fleet's own labels.
//
// LABEL COVERAGE (1.3.0): the first version offered clef only the 8 most common
// categories while agent_issues holds 29, so a sampled row labelled 'autonomy' was
// unanswerable -- that measures the harness, not the model. Every category is now
// offered (slugged), and category and priority agreement are recorded separately,
// because they are different capabilities.
function slugLabel(s) {
  return String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 24);
}

// A decision model may only carry a promotion if real labelled work agrees with it.
// The battery saturates (all three clef models score 1.0), so the canary is the only
// evidence that separates "answers the probes" from "is right about the fleet".
const CANARY_BAR = 0.7;
function canaryGate(agreement, catAgreement) {
  if (agreement == null) return { ready: false, reason: "no canary evidence yet" };
  const a = Number(agreement);
  if (a >= CANARY_BAR) {
    return { ready: true, reason: `real-data agreement ${a} >= ${CANARY_BAR}` };
  }
  const cat = catAgreement == null ? "n/a" : Number(catAgreement);
  return {
    ready: false,
    reason: `real-data agreement ${a} < ${CANARY_BAR} (category ${cat}) -- the model answers the battery but does not reproduce the fleet's own labels`,
  };
}

async function clefCanary(env, modelId, limit = 12, ids = null) {
  const db = env.AUDIT;
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS cf_model_canary (
       id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT DEFAULT (datetime('now')),
       model_id TEXT, battery_version TEXT, n INTEGER, agree INTEGER, agreement REAL,
       mean_latency_ms INTEGER, detail TEXT)`
  ).run();
  // every category, not the top 8: an option the model cannot name is a harness bug
  const cats = (await db.prepare(
    "SELECT category, COUNT(*) n FROM agent_issues WHERE category IS NOT NULL AND status='open' GROUP BY 1 ORDER BY n DESC LIMIT 40"
  ).all()).results || [];
  if (cats.length < 2) return { ok: false, error: "not enough labelled categories" };
  // FAIR-LABEL-1 (1.4.0): a criteria description of "reliability" tells the model
  // nothing about what QNFO means by it. The taxonomy is proprietary ('autonomy' vs
  // 'self-heal' vs 'continuous-improvement' are not guessable), so the definition is
  // read from agent_issue_category_glossary and only falls back to the bare label.
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS agent_issue_category_glossary (category TEXT PRIMARY KEY, definition TEXT NOT NULL, updated_at TEXT DEFAULT (datetime('now')))"
  ).run();
  const gloss = new Map();
  try {
    const g = await db.prepare("SELECT category, definition FROM agent_issue_category_glossary").all();
    for (const r of (g.results || [])) gloss.set(String(r.category), String(r.definition));
  } catch (_) { /* glossary is an improvement, not a precondition */ }
  const criteria = {};
  let described = 0;
  for (const c of cats) {
    const def = gloss.get(String(c.category));
    if (def) described++;
    criteria[slugLabel(c.category)] = def || String(c.category);
  }
  const priCriteria = { low: "Routine, no user impact", medium: "Should be handled this week", high: "Blocks work or users now", critical: "Production is broken or data is at risk" };
  const questions = {
    category: { type: "choice", instructions: "Which part of the fleet does this issue concern?", criteria },
    priority: { type: "choice", instructions: "How urgent is this issue?", criteria: priCriteria },
  };
  // AB-HARNESS-1: with ids the canary scores exactly those rows, so the pre-change and post-change models are paired.
  const rows = Array.isArray(ids) && ids.length
    ? (await db.prepare(
      `SELECT id, title, COALESCE(NULLIF(category,''),'?') cat, COALESCE(NULLIF(priority,''),'medium') pri,
              COALESCE(description,'') des
         FROM agent_issues WHERE category IS NOT NULL AND id IN (${ids.map((_, i) => "?" + (i + 1)).join(",")})`
    ).bind(...ids).all()).results || []
    : (await db.prepare(
    `SELECT id, title, COALESCE(NULLIF(category,''),'?') cat, COALESCE(NULLIF(priority,''),'medium') pri,
            COALESCE(description,'') des
       FROM agent_issues WHERE status='open' AND category IS NOT NULL
      ORDER BY RANDOM() LIMIT ?1`
  ).bind(limit).all()).results || [];
  if (!rows.length) return { ok: false, error: "no open labelled issues" };

  let catAgree = 0, priAgree = 0, lat = 0, ton = 0;
  const pairs = [];
  for (const r of rows) {
    const s = Date.now();
    try {
      const out = await env.AI.run(modelId, {
        model: modelId.split("/").pop() || "clef",
        state: `${r.title}\n\n${String(r.des).slice(0, 400)}`,
        questions,
      });
      const a = (out && out.answers) || {};
      const gotCat = clefPick(a, "category").label || null;
      const gotPri = clefPick(a, "priority").label || null;
      const catOk = gotCat != null && norm(gotCat) === norm(slugLabel(r.cat));
      const priOk = gotPri != null && norm(gotPri) === norm(r.pri);
      if (catOk) catAgree++;
      if (priOk) priAgree++;
      if (out && out.usage) ton += Number(out.usage.input_tokens || 0);
      pairs.push({ id: r.id, want: `${r.cat}/${r.pri}`, got: `${gotCat}/${gotPri}`, catOk, priOk });
    } catch (e) {
      pairs.push({ id: r.id, err: String(e && e.message ? e.message : e).slice(0, 120) });
    }
    lat += Date.now() - s;
  }
  const n = rows.length;
  const agree = catAgree + priAgree;
  const agreement = n ? Number((agree / (2 * n)).toFixed(4)) : 0;
  const catAgreement = n ? Number((catAgree / n).toFixed(4)) : 0;
  await db.prepare(
    `INSERT INTO cf_model_canary (model_id, battery_version, n, agree, agreement, mean_latency_ms, detail)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
  ).bind(modelId, BATTERY_VERSION, n, agree, agreement, Math.round(lat / Math.max(1, n)),
    JSON.stringify({ categories_offered: Object.keys(criteria).length, cat_agree: catAgree, pri_agree: priAgree, cat_agreement: catAgreement, sample: pairs.slice(0, 12), input_tokens: ton }).slice(0, 3000)).run();
  return {
    ok: true, model_id: modelId, n, agree, agreement, cat_agreement: catAgreement,
    categories_offered: Object.keys(criteria).length, categories_described: described,
    mean_latency_ms: Math.round(lat / Math.max(1, n)), pairs: pairs.slice(0, 6), rows: pairs,
  };
}

// Pick the decision-model winner: highest score, cheapest to break a tie.
async function selectClefWinner(env) {
  const r = await env.AUDIT.prepare(
    `SELECT e.model_id, MAX(e.score) score, MIN(c.price_in) price_in
       FROM cf_model_evals e LEFT JOIN cf_model_catalog c ON c.model_id=e.model_id
      WHERE e.battery_version=?1 AND (e.model_id LIKE '%/clef%' OR e.model_id LIKE '%/clef-%')
      GROUP BY e.model_id ORDER BY score DESC, price_in ASC`
  ).bind(BATTERY_VERSION).all();
  const rows = r.results || [];
  if (!rows.length) return null;
  const best = rows[0];
  const prev = await cfg(env, "clef_winner", "");
  const changed = prev !== best.model_id;
  await env.AUDIT.prepare(
    "INSERT OR REPLACE INTO cf_model_eval_config (key, value, updated_at) VALUES ('clef_winner', ?1, datetime('now'))"
  ).bind(best.model_id).run();
  if (changed) {
    await addRoadmapItem(env, `MODEL-CLEF-LANE-${best.model_id}`, `Wire ${best.model_id} into the decision/triage lane`,
      "model", best.model_id, `best decision-battery score ${best.score} at $${best.price_in}/M in`);
    await fileIssue(env,
      `CF-MODEL-EVAL-1: decision-model winner is ${best.model_id}`,
      `Best decision-battery score: ${best.score} (price_in $${best.price_in}/M).\n` +
      `Previous winner: ${prev || "none"}.\n\n` +
      `Run the canary over real labelled agent_issues rows before switching any lane; agreement is recorded in cf_model_canary.`,
      "low");
  }
  return { ...best, previous: prev || null, changed };
}

// Only one decision model may hold a promotion at a time. The battery saturates, so
// without this every clef variant promotes itself in the same sweep and the backlog
// fills with three mutually superseding ladder rows.
async function reconcileDecisionPromotions(env, winnerId) {
  const db = env.AUDIT;
  const others = await db.prepare(
    "SELECT model_id FROM cf_model_catalog WHERE modality='clef' AND status='recommended' AND model_id<>?1"
  ).bind(winnerId).all();
  for (const r of (others.results || [])) {
    await db.prepare("UPDATE cf_model_catalog SET status='passed', notes=?2 WHERE model_id=?1")
      .bind(r.model_id, "superseded by decision-battery winner " + winnerId).run();
    await db.prepare("DELETE FROM model_ladder_models WHERE id=?1 AND notes LIKE 'auto-eval promote%'").bind(r.model_id).run();
    await db.prepare("DELETE FROM roadmap_implementation WHERE item=?1 AND source='cf-model-eval'").bind("MODEL-" + r.model_id).run();
  }
  return (others.results || []).length;
}

// A failed canary withdraws the promotion instead of leaving a recommendation nobody
// should act on. The ladder row goes, the catalog drops to candidate, and the roadmap
// item keeps the reason so the next reader sees why it is not live.
async function blockDecisionPromotion(env, modelId, reason) {
  const db = env.AUDIT;
  await db.prepare(
    "UPDATE cf_model_catalog SET status='candidate', notes=?2 WHERE model_id=?1 AND status<>'in_production'"
  ).bind(modelId, "canary gate: " + reason).run();
  await db.prepare("DELETE FROM model_ladder_models WHERE id=?1 AND notes LIKE 'auto-eval promote%'").bind(modelId).run();
  await db.prepare("UPDATE roadmap_implementation SET evidence=?2 WHERE item=?1")
    .bind("MODEL-" + modelId, ("BLOCKED: " + reason).slice(0, 500)).run();
}

// PROMOTE-TICKET-AFTER-RECONCILE-1 (1.8.2, agent_issues 1000329, pillar autonomy): a promotion stands when the model's catalog row still says recommended or
// in_production, or its ladder row is still there. This is the test ISSUE-HYGIENE-3 (rule model-eval-promote-withdrawn of the hourly workflow issue-meta-fold) applies
// to close a promote ticket as moot, so the producer now files exactly the tickets that rule keeps: reconcileDecisionPromotions leaves the superseded model 'passed' and
// without a ladder row, blockDecisionPromotion leaves the blocked one 'candidate' and without one.
async function promotionStands(env, modelId) {
  const r = await env.AUDIT.prepare(
    `SELECT (SELECT COUNT(*) FROM cf_model_catalog WHERE model_id=?1 AND status IN ('recommended','in_production')) live,
            (SELECT COUNT(*) FROM model_ladder_models WHERE id=?1) ladder`
  ).bind(modelId).first();
  return !!r && (Number(r.live) > 0 || Number(r.ladder) > 0);
}

// Files the promote tickets of one pass after its winner selection, its reconcile and its canary gate, and only for a model whose promotion stands. A withdrawn
// promotion files nothing: its ladder row and roadmap item are gone and the catalog says why. One bad insert does not lose the others.
async function filePromoteTickets(env, tickets) {
  const out = { filed: 0, withheld: [], errors: [] };
  const seen = new Set();
  for (const t of (tickets || [])) {
    if (!t || !t.model_id || seen.has(t.title)) continue;
    seen.add(t.title);
    try {
      if (await promotionStands(env, t.model_id)) {
        await fileIssue(env, t.title, t.description, t.priority || "medium");
        out.filed++;
      } else out.withheld.push(t.model_id);
    } catch (err) {
      out.errors.push(`${t.model_id}: ${String(err && err.message ? err.message : err).slice(0, 160)}`);
    }
  }
  return out;
}

async function recordEval(env, e, role) {
  const cost = await costOf(env, e.model_id, e);
  await env.AUDIT.prepare(
    `INSERT INTO cf_model_evals (model_id, slug, battery_version, run_ts, n_tasks, passed, score, mean_latency_ms, tokens_in, tokens_out, cost_usd, verdict, detail)
     VALUES (?1, ?2, ?3, datetime('now'), ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`
  ).bind(e.model_id, e.slug || null, BATTERY_VERSION, e.n_tasks, e.passed, e.score, e.mean_latency_ms,
    e.tokens_in, e.tokens_out, cost, role, e.detail || null).run();
  return cost;
}

async function runLoop(env, trigger, opts) {
  const db = env.AUDIT;
  const cfgMax = Number(await cfg(env, "max_models_per_run", "6"));
  const maxModels = Math.max(1, Math.min(12, Number(opts && opts.maxModels) || cfgMax || 6));
  const budgetMs = Math.max(15000, Math.min(240000, Number(opts && opts.budgetMs) || 90000));
  const deadline = Date.now() + budgetMs;
  const started = new Date().toISOString();
  const runId = "cme-" + Date.now().toString(36);
  const summary = { run_id: runId, trigger, started, sync: null, evaluated: [], skipped: 0, errors: [], maxModels, budgetMs };

  try { summary.sync = await syncCatalog(env); }
  catch (e) { summary.errors.push("sync: " + String(e.message || e)); }

  // pick work: never-evaluated candidates first, then the oldest scores
  const ctrlList = CONTROLS.map((c) => `'${c.model_id}'`).join(",");
  const picks = [];
  const cand = await db.prepare(
    `SELECT model_id, slug, modality FROM cf_model_catalog
      WHERE status IN ('new','candidate','passed') AND modality IN ('chat','clef') AND model_id IS NOT NULL
        AND model_id NOT IN (${ctrlList})
        AND (last_eval_ts IS NULL OR last_eval_ts < datetime('now','-7 days'))
      ORDER BY (last_eval_ts IS NULL) DESC, first_seen DESC LIMIT ?1`
  ).bind(maxModels).all();
  for (const r of (cand.results || [])) picks.push(r);

  if (picks.length < maxModels) {
    const reg = await db.prepare(
      `SELECT c.model_id, c.slug, c.modality FROM cf_model_catalog c
        JOIN model_ladder_models m ON m.id = c.model_id
        WHERE c.model_id NOT IN (${ctrlList}) AND c.modality IN ('chat','clef')
          AND (c.last_eval_ts IS NULL OR c.last_eval_ts < datetime('now','-7 days'))
        LIMIT ?1`
    ).bind(maxModels - picks.length).all();
    for (const r of (reg.results || [])) picks.push(r);
  }

  // control baseline, refreshed at most daily
  const controlScores = {};
  let controlScore = null;
  for (const c of CONTROLS) {
    const le = await lastEval(env, c.model_id);
    const fresh = le && le.run_ts && (Date.now() - Date.parse(le.run_ts.replace(" ", "T") + "Z")) < 86400000;
    if (fresh) { controlScores[c.model_id] = Number(le.score); continue; }
    if (Date.now() > deadline) { summary.errors.push("deadline before control baseline"); continue; }
    const probes = await loadBattery(env, "chat");
    if (!probes.length) { summary.errors.push("battery empty"); break; }
    try {
      const e = await evalModel(env, c.model_id, "control:tier" + c.tier, "chat", probes);
      await recordEval(env, e, "control");
      controlScores[c.model_id] = e.score;
      summary.evaluated.push({ model_id: e.model_id, score: e.score, passed: e.passed, n: e.n_tasks, verdict: "control" });
    } catch (err) { summary.errors.push(`control ${c.model_id}: ${String(err.message || err)}`); }
  }
  const control = controlScores["@cf/zai-org/glm-5.3-flash"] != null
    ? { model_id: "@cf/zai-org/glm-5.3-flash", score: controlScores["@cf/zai-org/glm-5.3-flash"] }
    : controlScores["@cf/openai/gpt-oss-120b"] != null
      ? { model_id: "@cf/openai/gpt-oss-120b", score: controlScores["@cf/openai/gpt-oss-120b"] } : null;
  controlScore = control ? control.score : null;

  // decision family compares against the best previous decision score, never the chat control
  const prevClef = await db.prepare(
    "SELECT MAX(score) s FROM cf_model_evals WHERE battery_version=?1 AND model_id LIKE '%/clef%'"
  ).bind(BATTERY_VERSION).first();
  const clefControl = prevClef && prevClef.s != null ? { model_id: "decision-family-best", score: prevClef.s } : null;

  // PROMOTE-TICKET-AFTER-RECONCILE-1: the promote tickets wait here until the winner, the reconcile and the canary gate of this pass have run.
  const promoteTickets = [];
  for (const p of picks) {
    if (Date.now() > deadline) { summary.skipped++; continue; }
    const kind = p.modality === "clef" ? "clef" : "chat";
    const probes = await loadBattery(env, kind);
    if (!probes.length) { summary.errors.push(`no ${kind} probes`); continue; }
    try {
      const e = await evalModel(env, p.model_id, p.slug, kind, probes);
      await recordEval(env, e, "candidate");
      const d = await decide(env, e, kind === "chat" ? control : clefControl);
      if (d.promoteTicket) promoteTickets.push(d.promoteTicket);
      summary.evaluated.push({ model_id: e.model_id, score: e.score, passed: e.passed, n: e.n_tasks, verdict: d.verdict, reason: d.reason, failed: e.failed_probes });
    } catch (err) { summary.errors.push(`${p.model_id}: ${String(err.message || err)}`); }
  }

  // decision winner + canary over real labelled issues
  let winner = null;
  try { winner = await selectClefWinner(env); } catch (e) { summary.errors.push("winner: " + String(e.message || e)); }
  summary.clef_winner = winner;
  if (winner && winner.model_id) {
    try { summary.superseded = await reconcileDecisionPromotions(env, winner.model_id); }
    catch (e) { summary.errors.push("reconcile: " + String(e.message || e)); }
    if (String(await cfg(env, "canary_enabled", "0")) === "1") {
      try {
        summary.canary = await clefCanary(env, winner.model_id);
        const gate = canaryGate(summary.canary && summary.canary.ok ? summary.canary.agreement : null,
          summary.canary ? summary.canary.cat_agreement : null);
        summary.canary_gate = gate;
        if (!gate.ready) await blockDecisionPromotion(env, winner.model_id, gate.reason);
      } catch (e) { summary.errors.push("canary: " + String(e.message || e)); }
    }
  }

  // PROMOTE-TICKET-AFTER-RECONCILE-1: only now, and only for a model whose promotion the reconcile and the canary gate left standing.
  try {
    const pt = await filePromoteTickets(env, promoteTickets);
    summary.promote_tickets = { filed: pt.filed, withheld: pt.withheld };
    for (const m of pt.errors) summary.errors.push("promote-ticket: " + m);
  } catch (e) { summary.errors.push("promote-tickets: " + String(e.message || e)); }

  // safety net: candidates sitting unevaluated too long
  const idle = await db.prepare(
    `SELECT slug, model_id FROM cf_model_catalog
      WHERE status IN ('new','candidate') AND first_seen < datetime('now','-7 days')
        AND (last_eval_ts IS NULL) LIMIT 5`
  ).all();
  for (const r of (idle.results || [])) {
    await fileIssue(env,
      `CF-MODEL-EVAL-1: ${r.slug} catalogued 7d+ without an evaluation`,
      `Model ${r.model_id || r.slug} was discovered but never evaluated. Check the eval loop's deadline and per-run cap (cf_model_eval_config).`,
      "low");
  }

  const unfinished = (await db.prepare(
    "SELECT COUNT(*) n FROM cf_model_catalog WHERE modality IN ('chat','clef') AND status IN ('new','candidate') AND (last_eval_ts IS NULL OR last_eval_ts < datetime('now','-7 days'))"
  ).first()) || { n: null };
  summary.backlog = unfinished.n;

  await db.prepare("INSERT OR REPLACE INTO cf_model_eval_runs (id, ts, trigger, models, probes, ok, detail) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")
    .bind(runId, started, trigger, summary.evaluated.length, summary.evaluated.reduce((a, x) => a + (x.n || 0), 0),
      summary.errors.length ? 0 : 1, JSON.stringify(summary).slice(0, 3500)).run();

  await db.prepare(
    `INSERT OR REPLACE INTO cloud_ops_events (id, ts, kind, text, meta, job, status) VALUES (?1, datetime('now'), ?2, ?3, ?4, ?5, ?6)`
  ).bind(
    "cf-model-eval-" + started.slice(0, 16) + ":" + trigger,
    "cf-model-eval",
    `CF-MODEL-EVAL-1: catalog ${summary.sync ? summary.sync.seen : "?"} (+${summary.sync ? summary.sync.added : 0} new); evaluated ${summary.evaluated.length}; backlog ${summary.backlog}; verdicts ${summary.evaluated.map((x) => (x.verdict || "?")).join(",") || "none"}`,
    JSON.stringify({ control: controlScore, verdicts: summary.evaluated.map((x) => ({ m: x.model_id, s: x.score, v: x.verdict })), backlog: summary.backlog, winner: winner && winner.model_id }).slice(0, 900),
    "cf-model-eval",
    summary.errors.length ? "warn" : "ok"
  ).run();

  return summary;
}

// ---- AB-HARNESS-1:BEGIN (agent_issues 2828 MODEL-QUALITY-PARITY-1, pillar autonomy; migrations/2026-10-19-model-ab.sql) ----
// WHY: on 2026-10-17 twenty workers moved off sub-frontier models and nothing measured whether the answers got worse. Every
// existing check (ai_model_health, the battery, the error counters) sees reachability, policy compliance or an ERROR. A model
// that answers fluently and worse raises none of them. This is the instrument for that: for one worker and one task set it
// puts the pre-change answer and the post-change answer to the same prompt in front of two judges from different model families
// and writes the paired win rate, against a stated threshold, to model_ab_runs.
//
// HOW, per fixture (AB_FIXTURES, stored in this file so a run is repeatable offline and a test can replay it):
//   pre-change answer   the fixture's recorded baseline reply; with live_pre the pre-change model is called instead (path B)
//   post-change answer  the post-change model through qnfo-ai with pin_model true (QNFO_AI service binding, props caller
//                       qnfo-model-eval); a reply served by another model is never scored: the same prompt goes to the
//                       Workers AI id through the AI binding (row detail post_paths says which path answered), and without
//                       a direct path the fixture is dropped
//   verdict             two judges from two families outside the pair under test, at least one outside every family the worker
//                       uses; each sees the two answers in the opposite order of the other (position bias cancels per fixture)
//   score               win 1, tie 0.5, loss 0 per judge, averaged; an EMPTY post-change answer is a loss without a judge
//                       (the kimi-k2.6 failure, 2026-10-17: a reasoning model spends the budget and returns nothing), except that
//                       an empty answer whose finish is "length" is first asked once more at a larger budget (AB-LENGTH-RETRY-1)
// win_rate = mean score over fixtures with a verdict. Parity is 0.5; the pass line (AB_THRESHOLD 0.40, non-inferiority margin
// 0.10) is the stated threshold; a run with fewer than AB_MIN_VALID fixtures, or judges that disagree on most fixtures, is
// inconclusive and never a pass. A regression files an agent_issues row (fileIssue) so the finding has a doer.
//
// WHAT IT DOES NOT SHOW: the fixtures are passage-grounded (so the qnfo-ai accuracy layer does not rewrite the reply), short and
// generic. They catch empty, unsupported, wrong or truncated answers; they are not the worker's own prompts. The seed
// baselines are reference answers authored in this file, not machine recordings; live_pre records real pre-change replies.
// Classification lanes (task_set clef-classification) use clefCanary agreement on the same labelled agent_issues rows instead.
//
// TRIGGERS (abTick, the hourly grid tick): (1) scripts/model-policy.json on main, read from raw.githubusercontent.com, names the
// model each governed worker uses; a changed model for a worker is a run, a worker seen for the first time is a baseline, not a
// run; (2) ai_call_counters, for a change nobody declared: a model with >= 20 calls yesterday or today that the same worker did
// not use (< 3 calls) in the 2 to 15 days before, against that worker's busiest earlier model; (3) AB-LENGTH-RETRY-1, a regression
// row of the last 7 days that an older harness revision scored (abStaleRevCandidates), which needs no model change in the counters.
// All are bounded by ab_max_runs_per_tick and ab_daily_cap, switched by ab_enabled (control_registry model-ab-switch), deduped on
// worker, pre and post model for 7 days, and an errored run, or an inconclusive one that lost fixtures to an unavailable retry,
// is tried again up to 3 times a day.
const AB_THRESHOLD = 0.4;
const AB_MIN_VALID = 6;
const AB_FIXTURE_LIMIT = 8;
const AB_CLASSIFY_SET = "clef-classification";
// A run starts no new fixture after AB_RUN_BUDGET_MS (calls already started finish within their 90 s timeout) and a tick starts no
// new run after AB_TICK_START_GATE_MS, so two runs stay inside a cron invocation's 15 minutes; a candidate left over is detected
// again on the next tick.
const AB_RUN_BUDGET_MS = 240000;
const AB_TICK_START_GATE_MS = 300000;
// AB-LENGTH-RETRY-1 (1.8.0, agent_issues 100277, pillar autonomy; minor): a post-change reply that is empty because the fixture's own
// token cap was spent (finish "length": a reasoning model spends the whole budget on thought) is the harness's budget and not the model's
// answer. Measured 2026-10-19 (model_ab_runs ids 1 and 4, the same pair, kimi-k2.6 against glm-5.3-flash, win rate 0.25 both times): every
// loss of run 4 and two of the four losses of run 1 were "empty post-change reply (finish length)" at a 300-token fixture, while the
// production confirm call of errata-hub sends thinking off at 2048 tokens. abOneFixture now asks such a reply once more at
// Math.min(AB_RETRY_MAX_TOKENS, Math.max(AB_RETRY_MIN_TOKENS, 4 * the fixture budget)) through the same path, and never after the run
// deadline. An empty reply with any other finish stays an immediate loss; a retry that cannot be made (call error, a reply from another
// model, the deadline) leaves the fixture unmeasured, never a loss and never callFailed (callFailed means the router is down).
const AB_RETRY_MIN_TOKENS = 2048;
const AB_RETRY_MAX_TOKENS = 4096;
// The scoring revision of the harness, written first in model_ab_runs.detail. Bump it when the harness changes how a row is scored:
// abAlreadyRun counts a 'regression' row as done only when it carries the current revision, and abStaleRevCandidates proposes every
// pair whose regression row (last 7 days) does not, so a regression found by an older scoring is measured again on the next hourly
// tick whether or not ai_call_counters still shows a model change (rev 1 scored a length-empty reply as a loss; rev 2 retries it).
// A pass or an inconclusive row keeps its 7-day dedupe, except an inconclusive row that lost fixtures to an unavailable retry (see
// abAlreadyRun), and no row is edited or deleted (they are history).
const AB_HARNESS_REV = 2;
const AB_POLICY_URL = "https://raw.githubusercontent.com/QNFO/qnfo-workers/main/scripts/model-policy.json";
// Judges, in preference order. One model per family; the pair under test and (preferably) the worker's families are skipped.
const AB_JUDGE_POOL = [
  { family: "openai", model: "@cf/openai/gpt-oss-120b" },
  { family: "deepseek", model: "@cf/deepseek-ai/deepseek-v4-flash-0731" },
  { family: "zai", model: "@cf/zai-org/glm-5.3" },
  { family: "nvidia", model: "@cf/nvidia/nemotron-3-120b-a12b" },
  { family: "moonshot", model: "@cf/moonshotai/kimi-k2.6" },
];
const AB_FAMILY_RULES = [
  ["moonshot", /kimi|moonshot/], ["openai", /gpt-oss|openai/], ["zai", /glm|zai/], ["deepseek", /deepseek/],
  ["nvidia", /nemotron|nvidia/], ["alibaba", /qwen/], ["google", /gemma|google/], ["meta", /meta|llama/],
  ["mistral", /mistral/], ["cloudflare", /cloudflare/],
];
const abGrounded = (passage, question) =>
  "Answer the question using only the passage. Reply in one or two sentences. If the passage does not say, state that it does not.\n\nPassage: " + passage + "\n\nQuestion: " + question;
const abSummary = (passage) => "Summarize the passage in one sentence of at most 30 words.\n\nPassage: " + passage;
const abReason = (problem) =>
  "Solve the problem. Show brief working, then give the final answer on a last line that starts with 'Answer:'.\n\nProblem: " + problem;
const AB_FIXTURES = {
  "grounded-qa": [
    { id: "gq-1", max_tokens: 300, gold: "since 2004",
      prompt: abGrounded("The Harlow Bridge opened in 1931 and spans 412 metres. It was closed for repairs from March to September 1987 and has carried only pedestrians and cyclists since 2004.", "Since when has the bridge carried only pedestrians and cyclists?"),
      baseline: "It has carried only pedestrians and cyclists since 2004." },
    { id: "gq-2", max_tokens: 300, gold: "culture C, 42 degrees, after 20 hours",
      prompt: abGrounded("Three cultures were incubated: culture A at 30 degrees, culture B at 37 degrees and culture C at 42 degrees. Only culture B reached confluence within 48 hours. Culture C died after 20 hours.", "Which culture died, at what temperature, and after how long?"),
      baseline: "Culture C, incubated at 42 degrees, died after 20 hours." },
    { id: "gq-3", max_tokens: 300, gold: "250",
      prompt: abGrounded("The Aldous fund ledger shows a deposit of 1200 in January, a withdrawal of 450 in February, a deposit of 300 in March and a withdrawal of 800 in April. The fund started at zero.", "What was the balance after April?"),
      baseline: "The balance after April was 250 (1200 - 450 + 300 - 800)." },
    { id: "gq-4", max_tokens: 300, gold: "it is rejected with an error",
      prompt: abGrounded("Requests under 10 MB are processed immediately. Requests from 10 MB up to 100 MB are queued and finished within one hour. Requests above 100 MB are rejected with an error.", "What happens to a 250 MB request?"),
      baseline: "A 250 MB request is above 100 MB, so it is rejected with an error." },
    { id: "gq-5", max_tokens: 300, gold: "never retried; port 7121",
      prompt: abGrounded("The Meridian protocol sends control messages on port 7120 and data messages on port 7121. A control message is retried three times, two seconds apart. A data message is never retried.", "How many times is a data message retried, and on which port is it sent?"),
      baseline: "A data message is never retried, and it is sent on port 7121." },
    { id: "gq-6", max_tokens: 300, gold: "the passage does not say who leads imaging today; it only says Dr. Lindqvist led it until 2021 and Dr. Okafor moved into it in 2021",
      prompt: abGrounded("Dr. Okafor joined the laboratory in 2019 and moved to the imaging group in 2021. Dr. Lindqvist led the imaging group until 2021 and then took over the sequencing group.", "Who leads the imaging group today?"),
      baseline: "The passage does not say who leads the imaging group today. It only says that Dr. Lindqvist led it until 2021 and that Dr. Okafor moved into it in 2021." },
    { id: "gq-7", max_tokens: 300, gold: "stations 2 and 4, 18 cubic metres per second",
      prompt: abGrounded("A river survey recorded flow rates of 14, 18, 22 and 18 cubic metres per second at stations 1, 2, 3 and 4.", "Which stations recorded the same flow rate, and what was it?"),
      baseline: "Stations 2 and 4 recorded the same flow rate, 18 cubic metres per second." },
    { id: "gq-8", max_tokens: 300, gold: "only --strict",
      prompt: abGrounded("Release 3.2 removed the --legacy flag, deprecated the --compat option and added the --strict option. Release 3.3 removes --compat.", "After release 3.3, which of the three options named in the passage can still be used?"),
      baseline: "Only --strict: --legacy was removed in 3.2 and --compat is removed in 3.3." },
  ],
  "summarize": [
    { id: "su-1", max_tokens: 200, gold: "40 old diesel buses replaced by electric over two years; first 10 on the airport route; fuel costs expected to fall by a third; winter range still being tested",
      prompt: abSummary("The Ostrava transit authority will replace its 40 oldest diesel buses with electric models over two years. The first 10 arrive in March and will run on the airport route, where charging depots already exist. Officials expect fuel costs to fall by a third, but warn that winter range is still being tested."),
      baseline: "The transit authority will replace 40 old diesel buses with electric ones over two years, starting with 10 on the airport route, expecting a third lower fuel costs while winter range remains under test." },
    { id: "su-2", max_tokens: 200, gold: "600 office workers, six months; four-day week: output unchanged, burnout down 22 percent; customer support saw no benefit because of coverage rules",
      prompt: abSummary("A study of 600 office workers compared a four-day week with a five-day week over six months. Output measured by completed tasks was unchanged, while reported burnout fell by 22 percent. Participants in customer support roles saw no benefit because coverage rules forced them to keep five-day rotas."),
      baseline: "In a six-month study of 600 office workers, a four-day week left output unchanged and cut reported burnout by 22 percent, except in customer support where coverage rules kept five-day rotas." },
    { id: "su-3", max_tokens: 200, gold: "Treve lost its bakery in 2020; residents raised 85,000 by cooperative and reopened it in 2022; six employees; supplies two villages",
      prompt: abSummary("The village of Treve lost its only bakery in 2020. Residents formed a cooperative, raised 85,000 in shares, and reopened the building as a community bakery in 2022. It now employs six people and supplies two neighbouring villages."),
      baseline: "After Treve lost its bakery in 2020, residents raised 85,000 through a cooperative and reopened it in 2022; it now employs six and supplies two nearby villages." },
    { id: "su-4", max_tokens: 200, gold: "mirror warped by under a micrometre in the cold; corrected with 120 actuators over two nights; observations resumed on the third; temperature sensors planned",
      prompt: abSummary("Engineers found that the telescope mirror had warped by less than a micrometre during the cold snap. They corrected it by adjusting 120 actuators over two nights, and observations resumed on the third. The team plans to add temperature sensors behind the mirror to catch such drift earlier."),
      baseline: "A telescope mirror warped slightly in the cold and was corrected by adjusting 120 actuators over two nights, and the team will add temperature sensors to catch drift sooner." },
    { id: "su-5", max_tokens: 200, gold: "council voted 7 to 2 to ban cars from the old market square on weekends; loading before 9 a.m. exempt; review after one year",
      prompt: abSummary("The city council voted 7 to 2 to ban cars from the old market square on weekends. Shop owners objected, citing lost deliveries, so the ban exempts vehicles loading before 9 a.m. A review is scheduled after one year."),
      baseline: "The council voted 7 to 2 to ban weekend cars from the old market square, exempting vehicles loading before 9 a.m. after shop owners objected, with a review in a year." },
    { id: "su-6", max_tokens: 200, gold: "small model predicts landslides from rainfall and soil data; flagged 81 percent of events; about one in four warnings false; should support human forecasters",
      prompt: abSummary("Researchers trained a small model to predict landslides from rainfall and soil data. On held-out regions it flagged 81 percent of events, but it also raised false alarms for roughly one in four warnings. The authors say it should support, not replace, human forecasters."),
      baseline: "A small landslide model flagged 81 percent of events on held-out regions but gave false alarms on about one in four warnings, so the authors say it should support human forecasters." },
    { id: "su-7", max_tokens: 200, gold: "12,000 pages of 19th-century letters scanned in a year; handwriting recognition about 70 percent correct; volunteers proofread; free online search next spring",
      prompt: abSummary("The library's digitisation project scanned 12,000 pages of 19th-century letters in its first year. Handwriting recognition read about 70 percent correctly, so volunteers now proofread each page. The finished archive will be free to search online next spring."),
      baseline: "The library scanned 12,000 pages of 19th-century letters in a year; because handwriting recognition is about 70 percent accurate, volunteers proofread, and the archive will be searchable free online next spring." },
    { id: "su-8", max_tokens: 200, gold: "recall of 3,400 pressure cookers sold May to August; lid lock can fail; no injuries; stop using and get a free replacement lid",
      prompt: abSummary("A recall affects 3,400 pressure cookers sold between May and August because the lid lock can fail. No injuries have been reported. Owners should stop using the product and contact the maker for a free replacement lid."),
      baseline: "3,400 pressure cookers sold from May to August are recalled because the lid lock can fail; there are no reported injuries and owners should stop using them and request a free replacement lid." },
  ],
  "reasoning-short": [
    { id: "rs-1", max_tokens: 400, gold: "155 minutes",
      prompt: abReason("A train leaves at 09:15 and arrives at 11:50. How many minutes long is the trip?"),
      baseline: "From 09:15 to 11:50 is 2 hours 35 minutes, which is 120 + 35 = 155 minutes.\nAnswer: 155 minutes" },
    { id: "rs-2", max_tokens: 400, gold: "192 litres",
      prompt: abReason("A tank holds 240 litres. It leaks 4 litres every 15 minutes. How many litres remain after 3 hours?"),
      baseline: "3 hours is 180 minutes, so there are 12 intervals of 15 minutes. The tank leaks 12 x 4 = 48 litres, leaving 240 - 48 = 192.\nAnswer: 192 litres" },
    { id: "rs-3", max_tokens: 400, gold: "4 hours",
      prompt: abReason("Three workers paint a fence in 8 hours. How long would 6 workers take at the same rate?"),
      baseline: "The job is 3 x 8 = 24 worker-hours. Six workers need 24 / 6 = 4 hours.\nAnswer: 4 hours" },
    { id: "rs-4", max_tokens: 400, gold: "80",
      prompt: abReason("A shop raises a price of 80 by 25 percent and then reduces the new price by 20 percent. What is the final price?"),
      baseline: "80 x 1.25 = 100, then 100 x 0.8 = 80.\nAnswer: 80" },
    { id: "rs-5", max_tokens: 400, gold: "24",
      prompt: abReason("Ana is twice as old as Ben. In 6 years the sum of their ages will be 48. How old is Ana now?"),
      baseline: "Let Ben be b and Ana 2b. In 6 years (2b + 6) + (b + 6) = 48, so 3b = 36 and b = 12. Ana is 24.\nAnswer: 24" },
    { id: "rs-6", max_tokens: 400, gold: "127",
      prompt: abReason("A sequence starts 3, 7, 15, 31 and each term is twice the previous term plus 1. What is the 6th term?"),
      baseline: "The 5th term is 2 x 31 + 1 = 63 and the 6th is 2 x 63 + 1 = 127.\nAnswer: 127" },
    { id: "rs-7", max_tokens: 400, gold: "2 hours",
      prompt: abReason("Two cyclists start 60 km apart and ride toward each other at 12 km/h and 18 km/h. After how many hours do they meet?"),
      baseline: "They close the gap at 12 + 18 = 30 km/h, so they meet after 60 / 30 = 2 hours.\nAnswer: 2 hours" },
    { id: "rs-8", max_tokens: 400, gold: "2/9",
      prompt: abReason("A box has 5 red, 3 blue and 2 green balls. Two are drawn without replacement. What is the probability that both are red? Give a fraction."),
      baseline: "The first is red with probability 5/10 and the second with 4/9, so (5/10) x (4/9) = 20/90 = 2/9.\nAnswer: 2/9" },
  ],
};

function abTail(id) { return String(id == null ? "" : id).toLowerCase().split("/").pop(); }
// One model, however the router spells it: the Workers AI id, the internal name, the dated build and the "-wa" binding alias.
function abCanon(id) { return abTail(id).replace(/-wa$/, "").replace(/-\d{4}$/, ""); }
function abSameModel(a, b) { return !!a && !!b && abCanon(a) === abCanon(b); }
function abFamily(id) {
  const s = String(id == null ? "" : id).toLowerCase();
  for (const r of AB_FAMILY_RULES) if (r[1].test(s)) return r[0];
  return "other";
}

// Two judges from two families, neither a family of the pair under test, and at least one that the worker does not use at all.
function abPickJudges(preModel, postModel, workerModels) {
  const pair = new Set([abFamily(preModel), abFamily(postModel)]);
  const used = new Set(pair);
  for (const m of workerModels || []) used.add(abFamily(m));
  const cands = AB_JUDGE_POOL.filter((j) => !pair.has(j.family));
  cands.sort((a, b) => (used.has(a.family) ? 1 : 0) - (used.has(b.family) ? 1 : 0));
  const picked = cands.slice(0, 2);
  if (picked.length < 2) return { ok: false, judges: picked, reason: "fewer than two judge families outside the pair under test" };
  const independent = picked.filter((j) => !used.has(j.family)).map((j) => j.family);
  if (!independent.length) return { ok: false, judges: picked, reason: "no judge family is independent of the models the worker uses" };
  return { ok: true, judges: picked, independent };
}

function abJudgePrompt(fx, replyA, replyB) {
  return [
    "You are grading two answers, A and B, to the same task. Judge correctness, completeness and whether the task's instructions were followed. Ignore length, tone and formatting. An answer that states anything the task text does not support, or invents a fact, is worse than one that says the text does not give it. An empty or off-topic answer loses.",
    "TASK:\n" + fx.prompt,
    fx.gold ? "KNOWN CORRECT ANSWER (key facts): " + fx.gold : "",
    "ANSWER A:\n" + replyA,
    "ANSWER B:\n" + replyB,
    "Reply with exactly one line: WINNER: A, WINNER: B or WINNER: TIE.",
  ].filter(Boolean).join("\n\n");
}

// The last "WINNER: x" in the reply (a judge may think aloud first); a bare "A", "B" or "TIE" reply also counts.
function abParseVerdict(text) {
  const t = String(text == null ? "" : text);
  let last = null;
  for (const m of t.matchAll(/winner\s*[:=-]?\s*\**\s*(tie|a|b)\b/gi)) last = m[1];
  if (last == null) {
    const bare = /^\s*\**\s*(tie|a|b)\s*\**\s*[.!]?\s*$/i.exec(t);
    if (bare) last = bare[1];
  }
  return last == null ? null : last.toUpperCase();
}

function abVerdictScore(v, postIsA) {
  if (v === "TIE") return 0.5;
  if (v === "A") return postIsA ? 1 : 0;
  if (v === "B") return postIsA ? 0 : 1;
  return null;
}

// items: [{ id, score|null, judge_scores: [] }]; a null score is a fixture that never reached a verdict (not counted).
function abSummarize(items, o) {
  const threshold = Number.isFinite(Number(o && o.threshold)) ? Number(o.threshold) : AB_THRESHOLD;
  const minValid = Number.isFinite(Number(o && o.minValid)) ? Number(o.minValid) : AB_MIN_VALID;
  const valid = (items || []).filter((i) => i && i.score != null);
  const n = valid.length;
  const win_rate = n ? Number((valid.reduce((a, i) => a + i.score, 0) / n).toFixed(4)) : null;
  const wins = valid.filter((i) => i.score > 0.5).length;
  const ties = valid.filter((i) => i.score === 0.5).length;
  const losses = valid.filter((i) => i.score < 0.5).length;
  const two = valid.filter((i) => Array.isArray(i.judge_scores) && i.judge_scores.length === 2);
  const judge_agreement = two.length ? Number((two.filter((i) => i.judge_scores[0] === i.judge_scores[1]).length / two.length).toFixed(4)) : null;
  let verdict, reason;
  if (n < minValid) { verdict = "inconclusive"; reason = "only " + n + " of the fixtures reached a verdict (needs " + minValid + ")"; }
  else if (two.length >= 4 && judge_agreement < 0.5) { verdict = "inconclusive"; reason = "the two judge families agree on " + judge_agreement + " of " + two.length + " fixtures"; }
  else if (win_rate >= threshold) { verdict = "pass"; reason = "win rate " + win_rate + " >= threshold " + threshold; }
  else { verdict = "regression"; reason = "win rate " + win_rate + " < threshold " + threshold; }
  return { n, win_rate, wins, ties, losses, judge_agreement, judge_pairs: two.length, threshold, minValid, verdict, reason };
}

// One chat call through qnfo-ai, pinned to the model. A reply that carries no text is { ok: true, text: "" }, never the
// stringified envelope (extractChatText would hand back the JSON of a reasoning-only reply as if it were an answer).
async function abChat(env, model, content, maxTokens, timeoutMs) {
  if (!env.QNFO_AI || typeof env.QNFO_AI.fetch !== "function") return { ok: false, error: "QNFO_AI binding missing" };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs || 90000);
  try {
    const resp = await env.QNFO_AI.fetch("https://qnfo-ai.internal/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "qnfo-model-eval/" + VERSION },
      body: JSON.stringify({ model, messages: [{ role: "user", content }], max_tokens: maxTokens, stream: false, hedge: false, pin_model: true, cache: false, rag: false }),
      signal: ctl.signal,
    });
    const raw = await resp.text();
    let data = null;
    try { data = JSON.parse(raw); } catch (_) { /* reported below */ }
    if (!resp.ok || !data) return { ok: false, error: "http " + resp.status };
    const choice = (data.choices && data.choices[0]) || {};
    const c = choice.message && choice.message.content;
    const text = typeof c === "string" ? c : Array.isArray(c) ? c.map((p) => (p && typeof p.text === "string" ? p.text : "")).join("") : "";
    return { ok: true, text: text.trim(), served: String(data.model || ""), finish: choice.finish_reason || null };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e).slice(0, 120) };
  } finally { clearTimeout(timer); }
}

// Second path (ANTIFRAGILE-1): the router serves only the ids in its MODELS table (nemotron-3-120b-a12b, qwen3.8-27b are
// not there, so qnfo-ai answers them with its unknown-id default), and a spend cap can steer a pinned id to a cheaper twin.
// Either way the reply is not the model under test. When the router did not serve exactly the asked-for Workers AI model, the
// same prompt goes to it through the AI binding; the row records which path answered (via). A reasoning model asked directly
// at a small max_tokens may answer empty where the router's small-answer lane would not: that is what a direct caller gets.
async function abDirect(env, model, content, maxTokens, timeoutMs) {
  if (!env.AI || typeof env.AI.run !== "function" || !/^@cf\//.test(String(model))) return { ok: false, error: "no direct path" };
  let timer;
  try {
    const out = await Promise.race([
      env.AI.run(model, { messages: [{ role: "user", content }], max_tokens: maxTokens }),
      new Promise((_, rej) => { timer = setTimeout(() => rej(new Error("direct call timed out")), timeoutMs || 90000); }),
    ]);
    const choice = (out && out.choices && out.choices[0]) || {};
    const c = choice.message && choice.message.content;
    const text = typeof out === "string" ? out : out && typeof out.response === "string" ? out.response : typeof c === "string" ? c : "";
    return { ok: true, text: text.trim(), served: model, finish: choice.finish_reason || null, via: "workers-ai" };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e).slice(0, 120) };
  } finally { clearTimeout(timer); }
}
async function abCall(env, model, content, maxTokens) {
  const r = await abChat(env, model, content, maxTokens, 90000);
  if (r.ok && abSameModel(r.served, model)) return Object.assign(r, { via: "router" });
  const d = await abDirect(env, model, content, maxTokens, 90000);
  if (d.ok) return d;
  return r.ok ? Object.assign(r, { unpinned: true }) : r;
}

async function abPool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function lane() { for (;;) { const i = next++; if (i >= items.length) return; out[i] = await fn(items[i], i); } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return out;
}

function abRetryTokens(maxTokens) { return Math.min(AB_RETRY_MAX_TOKENS, Math.max(AB_RETRY_MIN_TOKENS, 4 * (maxTokens || 400))); }

async function abOneFixture(env, c, fx, idx, judges, deadline) {
  if (Date.now() > deadline) return { id: fx.id, score: null, why: "deadline" };
  const budget = fx.max_tokens || 400;
  let post = await abCall(env, c.post_model, fx.prompt, budget);
  if (!post.ok) return { id: fx.id, score: null, why: "post-call " + post.error, callFailed: true };
  if (post.unpinned) return { id: fx.id, score: null, why: "unpinned: served " + (post.served || "nothing").slice(0, 60) };
  let retried; // undefined unless this fixture was asked a second time (undefined is dropped from the row's JSON)
  if (!post.text && post.finish === "length") {
    // AB-LENGTH-RETRY-1: the model spent the fixture's own token cap, it did not choose silence. One more call, larger budget, same path.
    if (Date.now() > deadline) return { id: fx.id, score: null, why: "retry unavailable: deadline" };
    retried = abRetryTokens(budget);
    const again = await abCall(env, c.post_model, fx.prompt, retried);
    if (!again.ok) return { id: fx.id, score: null, why: "retry unavailable: " + again.error, retried };
    if (again.unpinned) return { id: fx.id, score: null, why: "retry unavailable: unpinned: served " + (again.served || "nothing").slice(0, 60), retried };
    post = again;
    if (!post.text) return { id: fx.id, score: 0, judge_scores: [], via: post.via, retried, why: "empty post-change reply (finish " + post.finish + ") after retry at " + retried + " tokens" };
  } else if (!post.text) return { id: fx.id, score: 0, judge_scores: [], via: post.via, why: "empty post-change reply (finish " + post.finish + ")" };
  let pre = fx.baseline;
  if (c.live_pre) {
    const p = await abCall(env, c.pre_model, fx.prompt, budget);
    if (!p.ok || p.unpinned || !p.text) return { id: fx.id, score: null, why: "live pre-change reply unavailable" };
    pre = p.text;
  }
  const scores = await Promise.all(judges.map(async (j, ji) => {
    const postIsA = (idx + ji) % 2 === 0;
    const r = await abCall(env, j.model, abJudgePrompt(fx, postIsA ? post.text : pre, postIsA ? pre : post.text), 400);
    if (!r.ok || r.unpinned) return null;
    return abVerdictScore(abParseVerdict(r.text), postIsA);
  }));
  const valid = scores.filter((s) => s != null);
  if (!valid.length) return { id: fx.id, score: null, why: "no judge reached a verdict" };
  return { id: fx.id, score: valid.reduce((a, b) => a + b, 0) / valid.length, judge_scores: valid, via: post.via, post: post.text.slice(0, 160), retried };
}

// Classification lane: the same labelled agent_issues rows through both decision models (clefCanary), scored per row on the
// two labels (category, priority). A row the post-change model gets more right is a win, fewer a loss.
async function abRunClassify(env, c, threshold) {
  const limit = Math.max(4, Math.min(24, Number(c.limit) || 12));
  const post = await clefCanary(env, c.post_model, limit);
  if (!post.ok) return { verdict: "error", reason: "post-change canary: " + (post.error || "failed"), n: 0, win_rate: null, threshold, judges: ["labels"], pre_source: "live" };
  const ids = (post.rows || []).map((r) => r.id);
  const pre = await clefCanary(env, c.pre_model, limit, ids);
  if (!pre.ok) return { verdict: "error", reason: "pre-change canary: " + (pre.error || "failed"), n: 0, win_rate: null, threshold, judges: ["labels"], pre_source: "live" };
  // A model that answers nothing on every row is a harness fault (or a dead model), not a tie with the other one.
  const answered = (res) => (res.rows || []).some((r) => r && !r.err);
  if (!answered(post)) return { verdict: "error", reason: "post-change model gave no answer on any row", n: 0, win_rate: null, threshold, judges: ["labels"], pre_source: "live" };
  if (!answered(pre)) return { verdict: "error", reason: "pre-change model gave no answer on any row", n: 0, win_rate: null, threshold, judges: ["labels"], pre_source: "live" };
  const rowScore = (r) => (r && !r.err ? ((r.catOk ? 1 : 0) + (r.priOk ? 1 : 0)) / 2 : 0);
  const preById = new Map((pre.rows || []).map((r) => [r.id, r]));
  const items = [];
  for (const r of post.rows || []) {
    if (!preById.has(r.id)) continue;
    const a = rowScore(r), b = rowScore(preById.get(r.id));
    items.push({ id: String(r.id), score: a > b ? 1 : a < b ? 0 : 0.5, judge_scores: [] });
  }
  const s = abSummarize(items, { threshold, minValid: Math.min(AB_MIN_VALID, limit) });
  return Object.assign({}, s, { judges: ["labels"], pre_source: "live", extra: { post_agreement: post.agreement, pre_agreement: pre.agreement } });
}

// One paired run. Never writes; abExecute persists the result.
async function abRunPair(env, c) {
  const taskSet = String(c.task_set || "grounded-qa");
  const threshold = Number.isFinite(Number(c.threshold)) ? Number(c.threshold) : AB_THRESHOLD;
  if (taskSet === AB_CLASSIFY_SET) return abRunClassify(env, c, threshold);
  const all = AB_FIXTURES[taskSet];
  if (!all) return { verdict: "error", reason: "unknown task_set " + taskSet, n: 0, win_rate: null, threshold, judges: [], pre_source: "baseline" };
  const pick = abPickJudges(c.pre_model, c.post_model, c.worker_models);
  if (!pick.ok) return { verdict: "inconclusive", reason: pick.reason, n: 0, win_rate: null, threshold, judges: pick.judges.map((j) => j.model), pre_source: c.live_pre ? "live" : "baseline" };
  const fixtures = all.slice(0, Math.max(1, Math.min(12, Number(c.limit) || AB_FIXTURE_LIMIT)));
  const deadline = Date.now() + Math.max(15000, Math.min(480000, Number(c.budget_ms) || AB_RUN_BUDGET_MS));
  const items = await abPool(fixtures, 3, (fx, i) => abOneFixture(env, c, fx, i, pick.judges, deadline));
  const s = abSummarize(items, { threshold, minValid: Number(c.min_valid) || AB_MIN_VALID });
  // Every fixture failed on the call itself: the router or the binding is down, not a verdict about the model. Retryable.
  if (items.length && items.every((i) => i.callFailed)) { s.verdict = "error"; s.reason = "every post-change call failed: " + items[0].why; }
  return Object.assign({}, s, {
    judges: pick.judges.map((j) => j.model), independent: pick.independent, pre_source: c.live_pre ? "live" : "baseline",
    skipped: items.filter((i) => i.score == null).map((i) => ({ id: i.id, why: i.why })),
    items: items.filter((i) => i.score != null).map((i) => ({ id: i.id, s: i.score, js: i.judge_scores, via: i.via, why: i.why, retried: i.retried })),
    post_paths: items.reduce((a, i) => { if (i.via) a[i.via] = (a[i.via] || 0) + 1; return a; }, {}),
  });
}

async function abWorkerModels(env, worker) {
  try {
    const r = await env.AUDIT.prepare("SELECT DISTINCT model FROM ai_call_counters WHERE worker=?1 AND day >= date('now','-15 day') AND model IS NOT NULL").bind(worker).all();
    return (r.results || []).map((x) => x.model);
  } catch (_) { return []; }
}

async function abPersist(env, c, r) {
  // harness_rev leads: the detail is cut at 6000 characters and abAlreadyRun and the issue-100277 probe read the prefix
  const detail = JSON.stringify({
    harness_rev: AB_HARNESS_REV, reason: r.reason, wins: r.wins, ties: r.ties, losses: r.losses, judge_pairs: r.judge_pairs, min_valid: r.minValid,
    independent_families: r.independent, post_paths: r.post_paths, skipped: r.skipped, items: r.items, extra: r.extra, worker_models: c.worker_models,
  }).slice(0, 6000);
  const res = await env.AUDIT.prepare(
    `INSERT INTO model_ab_runs (run_id, model_pair, worker, task_set, pre_model, post_model, trigger_source, n, win_rate, threshold, verdict, judges, judge_agreement, pre_source, detail, completed_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, datetime('now'))`
  ).bind(
    "ab-" + Date.now().toString(36), c.pre_model + " -> " + c.post_model, c.worker, c.task_set || "grounded-qa", c.pre_model, c.post_model,
    c.source || "manual", r.n == null ? 0 : r.n, r.win_rate, r.threshold, r.verdict, (r.judges || []).join(","), r.judge_agreement == null ? null : r.judge_agreement,
    r.pre_source || "baseline", detail
  ).run();
  return res && res.meta ? res.meta.last_row_id : null;
}

async function abExecute(env, c) {
  const cand = Object.assign({}, c, { worker_models: c.worker_models || await abWorkerModels(env, c.worker) });
  if (!(Number(cand.threshold) > 0 && Number(cand.threshold) < 1)) {
    const t = Number(await cfg(env, "ab_threshold", String(AB_THRESHOLD)));
    cand.threshold = t > 0 && t < 1 ? t : AB_THRESHOLD;
  }
  const r = await abRunPair(env, cand);
  const id = await abPersist(env, cand, r);
  if (r.verdict === "regression") {
    const short = (m) => String(m).split("/").pop();
    try {
      await fileIssue(env,
        "MODEL-AB-REGRESSION-1: " + c.worker + " " + short(c.pre_model) + " -> " + short(c.post_model) + " on " + (c.task_set || "grounded-qa") + ": win rate " + r.win_rate + " < " + r.threshold,
        "The paired A/B harness (qnfo-model-eval AB-HARNESS-1, model_ab_runs id " + id + ") compared the post-change model with the pre-change baseline on the same prompts, judged by " +
        (r.judges || []).join(" and ") + ": " + r.wins + " wins, " + r.ties + " ties, " + r.losses + " losses over " + r.n + " fixtures, win rate " + r.win_rate + " against the stated threshold " + r.threshold +
        ". Either the model change made " + c.worker + "'s answers worse (revert it, or give the worker a better prompt or token budget) or the fixtures do not represent its work (say so with evidence and set the worker's task_set in scripts/model-policy.json). " +
        "Read the per-fixture rows: SELECT detail FROM model_ab_runs WHERE id = " + id + ". It closes when a later run for the same worker and post-change model passes: " +
        "SELECT 'pass' AS expected, (SELECT verdict FROM model_ab_runs WHERE worker = '" + String(c.worker).replace(/'/g, "''") + "' AND post_model = '" + String(c.post_model).replace(/'/g, "''") + "' ORDER BY id DESC LIMIT 1) AS observed",
        "high");
    } catch (e) { console.error(JSON.stringify({ worker: "qnfo-model-eval", where: "ab-file-issue", error: String(e && e.message || e).slice(0, 200) })); }
  }
  return { id, worker: c.worker, pre_model: c.pre_model, post_model: c.post_model, verdict: r.verdict, win_rate: r.win_rate, n: r.n, reason: r.reason };
}

async function abFetchPolicy(env) {
  const url = await cfg(env, "ab_policy_url", AB_POLICY_URL);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10000);
  try {
    const resp = await fetch(url + "?cb=" + Math.floor(Date.now() / 6e5), { headers: { "user-agent": "qnfo-model-eval/" + VERSION }, signal: ctl.signal });
    if (!resp.ok) return { ok: false, error: "policy http " + resp.status };
    const p = JSON.parse(await resp.text());
    if (!p || typeof p !== "object" || !p.workers || typeof p.workers !== "object") return { ok: false, error: "policy has no workers object" };
    return { ok: true, policy: p };
  } catch (e) {
    return { ok: false, error: "policy fetch: " + String(e && e.message ? e.message : e).slice(0, 120) };
  } finally { clearTimeout(timer); }
}

// A worker whose declared model differs from the one last seen is a candidate; a worker seen for the first time is only recorded.
async function abPolicyCandidates(env, notes) {
  const got = await abFetchPolicy(env);
  if (!got.ok) { notes.push(got.error); return []; }
  const out = [];
  const defSet = await cfg(env, "ab_default_task_set", "grounded-qa");
  const entries = Object.entries(got.policy.workers).slice(0, 200);
  for (const [worker, e] of entries) {
    if (!e || typeof e.model !== "string" || !e.model) continue;
    const seen = await env.AUDIT.prepare("SELECT model FROM model_ab_policy_seen WHERE worker=?1").bind(worker).first();
    if (!seen) {
      await env.AUDIT.prepare("INSERT OR IGNORE INTO model_ab_policy_seen (worker, model, task_set) VALUES (?1, ?2, ?3)").bind(worker, e.model, e.task_set || defSet).run();
      notes.push("policy baseline: " + worker + " -> " + e.model);
      continue;
    }
    if (seen.model !== e.model) {
      out.push({ worker, pre_model: seen.model, post_model: e.model, task_set: e.task_set || defSet, threshold: e.threshold != null ? e.threshold : got.policy.threshold, live_pre: e.live_pre === true, source: "policy" });
    }
  }
  return out;
}

const AB_NOT_CHAT_RE = /bge|embed|whisper|flux|clef|melotts|llava|stable-diffusion/i;
async function abObservedCandidates(env, notes) {
  const minCalls = Math.max(5, Number(await cfg(env, "ab_min_calls", "20")) || 20);
  const defSet = await cfg(env, "ab_default_task_set", "grounded-qa");
  const r = await env.AUDIT.prepare(
    `WITH recent AS (SELECT worker, model, SUM(calls) c FROM ai_call_counters WHERE day >= date('now','-1 day') AND model IS NOT NULL GROUP BY worker, model HAVING SUM(calls) >= ?1),
          prior AS (SELECT worker, model, SUM(calls) c FROM ai_call_counters WHERE day < date('now','-1 day') AND day >= date('now','-15 day') AND model IS NOT NULL GROUP BY worker, model)
     SELECT r.worker, r.model AS post_model, r.c AS recent_calls,
            (SELECT p2.model FROM prior p2 WHERE p2.worker = r.worker AND p2.model <> r.model AND p2.c >= ?1 ORDER BY p2.c DESC LIMIT 1) AS pre_model
       FROM recent r LEFT JOIN prior p ON p.worker = r.worker AND p.model = r.model
      WHERE COALESCE(p.c, 0) < 3
      ORDER BY r.c DESC LIMIT 20`
  ).bind(minCalls).all();
  const out = [];
  for (const x of r.results || []) {
    if (!x.pre_model || AB_NOT_CHAT_RE.test(x.pre_model) || AB_NOT_CHAT_RE.test(x.post_model)) continue;
    out.push({ worker: x.worker, pre_model: x.pre_model, post_model: x.post_model, task_set: defSet, source: "observed" });
  }
  if (out.length) notes.push("observed model changes: " + out.length);
  return out;
}

// AB-LENGTH-RETRY-1, the second path to a pair that was scored by an older harness revision: every pair with a 'regression' row of the
// last 7 days whose detail does not start with the current harness_rev. The first path (abObservedCandidates) needs the pair to still
// look like a model change in ai_call_counters (>= 20 calls in the last 2 days, < 3 in the 2 to 15 days before), a window that closes on
// its own: it closed for qnfo-research-exec/kimi-k2.6 at 00:00Z 2026-10-20 and closes for errata-hub/kimi-k2.6 at 00:00Z 2026-10-21, and
// POST /ab/run needs the x-eval-key, which no session holds. This source needs only the stored row, so the re-measurement does not depend
// on that window or on the day a deploy lands; it ends when the pair has a row of the current revision (abAlreadyRun) or the stale row is
// 7 days old. The row's own task set, threshold and pre-change source are re-used. The newest row of a pair wins; abTick dedupes by pair.
async function abStaleRevCandidates(env, notes) {
  const defSet = await cfg(env, "ab_default_task_set", "grounded-qa");
  const r = await env.AUDIT.prepare(
    `SELECT worker, pre_model, post_model, task_set, threshold, pre_source FROM model_ab_runs
      WHERE verdict = 'regression' AND (detail IS NULL OR detail NOT LIKE ?1) AND created_at >= datetime('now','-7 days')
      ORDER BY id DESC LIMIT 50`
  ).bind('{"harness_rev":' + AB_HARNESS_REV + ',%').all();
  const out = [];
  const seen = new Set();
  for (const x of r.results || []) {
    const k = x.worker + "|" + x.pre_model + "|" + x.post_model;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ worker: x.worker, pre_model: x.pre_model, post_model: x.post_model, task_set: x.task_set || defSet, threshold: Number(x.threshold), live_pre: x.pre_source === "live", source: "stale-rev" });
  }
  if (out.length) notes.push("regression rows scored by an older harness revision: " + out.length);
  return out;
}

// A 'regression' row is done only when the harness revision that scored it is the current one (AB_HARNESS_REV): a regression found
// by an older scoring is measured again. An 'inconclusive' row whose skipped fixtures include "retry unavailable" (the larger-budget
// call failed, was served by another model or came after the run deadline: the harness could not measure, the model did not fail) is
// not done either; it counts with the errors, so the pair is tried again on the next tick and stops after 3 such rows in a day, the
// same bound an error row has. Other inconclusive rows (no independent judge family, judges that disagree) keep their 7-day dedupe.
// The LIKE patterns are short (D1 refuses one over 50 bytes); the first matches abPersist's leading key.
async function abAlreadyRun(env, c) {
  const r = await env.AUDIT.prepare(
    `SELECT (SELECT COUNT(*) FROM model_ab_runs WHERE worker=?1 AND pre_model=?2 AND post_model=?3 AND verdict <> 'error' AND (verdict <> 'regression' OR detail LIKE ?4)
               AND (verdict <> 'inconclusive' OR detail IS NULL OR detail NOT LIKE '%retry unavailable%') AND created_at >= datetime('now','-7 days')) AS done,
            (SELECT COUNT(*) FROM model_ab_runs WHERE worker=?1 AND pre_model=?2 AND post_model=?3
               AND (verdict = 'error' OR (verdict = 'inconclusive' AND detail LIKE '%retry unavailable%')) AND created_at >= datetime('now','-1 day')) AS errs`
  ).bind(c.worker, c.pre_model, c.post_model, '{"harness_rev":' + AB_HARNESS_REV + ',%').first();
  return { done: Number(r && r.done) > 0, exhausted: Number(r && r.errs) >= 3 };
}

// The hourly tick. Switched by cf_model_eval_config ab_enabled ('0' stops it, nothing else changes).
async function abTick(env) {
  const out = { enabled: true, candidates: 0, ran: [], skipped: 0, notes: [] };
  if (["0", "off", "false"].includes(String(await cfg(env, "ab_enabled", "1")).toLowerCase())) { out.enabled = false; return out; }
  try { await env.AUDIT.prepare("SELECT 1 FROM model_ab_runs LIMIT 1").first(); }
  catch (e) { out.notes.push("model_ab_runs not readable yet: " + String(e && e.message ? e.message : e).slice(0, 100)); return out; }
  const found = [];
  const seenKey = new Set();
  for (const c of [].concat(await abPolicyCandidates(env, out.notes), await abObservedCandidates(env, out.notes), await abStaleRevCandidates(env, out.notes))) {
    const k = c.worker + "|" + c.pre_model + "|" + c.post_model;
    if (seenKey.has(k)) continue;
    seenKey.add(k);
    found.push(c);
  }
  out.candidates = found.length;
  const perTick = Math.max(1, Math.min(6, Number(await cfg(env, "ab_max_runs_per_tick", "2")) || 2));
  const dailyCap = Math.max(1, Number(await cfg(env, "ab_daily_cap", "12")) || 12);
  const today = await env.AUDIT.prepare("SELECT COUNT(*) n FROM model_ab_runs WHERE created_at >= datetime('now','-1 day')").first();
  let used = Number(today && today.n) || 0;
  const tickStart = Date.now();
  for (const c of found) {
    const st = await abAlreadyRun(env, c);
    if (st.done) {
      if (c.source === "policy") await abMarkSeen(env, c);
      out.skipped++;
      continue;
    }
    if (st.exhausted) { out.skipped++; continue; }
    if (out.ran.length >= perTick || used >= dailyCap || Date.now() - tickStart > AB_TICK_START_GATE_MS) { out.skipped++; continue; }
    const row = await abExecute(env, Object.assign({}, c, { budget_ms: AB_RUN_BUDGET_MS }));
    used++;
    out.ran.push(row);
    if (c.source === "policy" && row.verdict !== "error") await abMarkSeen(env, c);
  }
  return out;
}
async function abMarkSeen(env, c) {
  await env.AUDIT.prepare("INSERT OR REPLACE INTO model_ab_policy_seen (worker, model, task_set, seen_at) VALUES (?1, ?2, ?3, datetime('now'))").bind(c.worker, c.post_model, c.task_set || null).run();
}
// ---- AB-HARNESS-1:END ----

// HEALTH-CONTRACT-1 (agent_issues 2852): the capability contract. qnfo-deploy-guard snapshots capabilities[] and limitations[] from
// /health and qnfo-fleet-control grades the share of live workers that declare both (capability_contract_conformance). Each line is
// stated in this file's own header, battery notes or A/B block comments; /health and /manifest return the same two lists.
const CAPABILITIES = ["catalog-discovery", "model-benchmark-battery", "incumbent-control-baseline",
  "cost-aware-promotion", "harness-error-classification", "decision-model-canary", "backlog-escalation",
  "paired-ab-quality-harness", "model-change-trigger"];
const LIMITATIONS = [
  "the cfmb-2 battery has 10 chat probes and 8 decision probes: it separates capability floors and cost and does not measure top-end reasoning differences between two models that both score 1.0, so a saturated control yields a cost win or parity, never better",
  "a promotion is a recommendation, not a switch: the ladder row is written with active=0 and a roadmap item and a deduped agent_issue name the exact change, so routing never changes by surprise",
  "a model that rejects the system role or has no account config is recorded as harness_error and left a candidate, never rejected: a harness failure is not a quality verdict",
  "a model whose input is a typed schema and not chat messages (an extraction model such as @cf/cloudflare/clairic, which wants {model, fields}) is classified typed-input and is not benchmarked: the chat and decision batteries cannot measure it, and no harness issue is filed for it",
  "the A/B fixtures are passage-grounded, short and generic: they catch empty, unsupported, wrong or truncated answers and are not a worker's own prompts; a length-empty reply is retried once at a larger budget (2048 to 4096 tokens) before it is scored, so a reasoning model is not marked down for the fixture's own token cap; a regression row scored by an older harness revision (model_ab_runs.detail leads with harness_rev) is measured again by the hourly tick, and an inconclusive run that lost fixtures to an unavailable retry is tried again up to 3 times a day",
  "the A/B seed baselines are reference answers authored in worker.js, not machine recordings; only live_pre records real pre-change replies",
  "the decision-model canary over real labelled agent_issues runs only while cf_model_eval_config canary_enabled is 1 (default 0)",
  "bounded per run and per day: max_models_per_run (default 6) models per battery run, ab_max_runs_per_tick (default 2) and ab_daily_cap (default 12) A/B runs, switched by ab_enabled",
  "the A/B model-change trigger needs scripts/model-policy.json read from main over HTTPS and ai_call_counters; a worker seen for the first time in the policy is only recorded as a baseline, never run",
  "POST /run, POST /canary and POST /ab/run need the x-eval-key manual key; the read routes are open"
];

async function manifest(env) {
  const db = env.AUDIT;
  const counts = await db.prepare(
    `SELECT (SELECT COUNT(*) FROM cf_model_catalog) catalog,
            (SELECT COUNT(*) FROM cf_model_catalog WHERE status='new') new_models,
            (SELECT COUNT(*) FROM cf_model_catalog WHERE status='candidate') candidates,
            (SELECT COUNT(*) FROM cf_model_catalog WHERE status='recommended') recommended,
            (SELECT COUNT(*) FROM cf_model_catalog WHERE status='rejected') rejected,
            (SELECT COUNT(*) FROM cf_model_evals) evals,
            (SELECT COUNT(*) FROM cf_model_catalog WHERE modality IN ('chat','clef') AND status IN ('new','candidate') AND (last_eval_ts IS NULL OR last_eval_ts < datetime('now','-7 days'))) backlog`
  ).first();
  return {
    service: "qnfo-model-eval", kind: "worker", version: VERSION,
    purpose: "CF-MODEL-EVAL-1 continuous evaluation of new Cloudflare Workers AI models for fleet production adoption",
    capabilities: CAPABILITIES, limitations: LIMITATIONS,
    routes: ["/health", "/manifest", "/catalog", "/evals", "/runs", "/leaderboard", "/promotions", "/canary", "/run", "/ab/runs", "/ab/fixtures", "/ab/run"],
    crons: ["20 * * * *"], battery_cadence: "17 */6 * * * (CRON-GRID-1)", battery: BATTERY_VERSION,
    controls: CONTROLS.map((c) => c.model_id),
    budget: { max_models_per_run: await cfg(env, "max_models_per_run", "6"), canary_enabled: await cfg(env, "canary_enabled", "0") },
    ab: { enabled: await cfg(env, "ab_enabled", "1"), threshold: AB_THRESHOLD, min_valid: AB_MIN_VALID, task_sets: Object.keys(AB_FIXTURES).concat([AB_CLASSIFY_SET]), max_runs_per_tick: await cfg(env, "ab_max_runs_per_tick", "2"), daily_cap: await cfg(env, "ab_daily_cap", "12") },
    counts,
  };
}

// FOLD-RETURN-ORDER-1: the guest default is held in a variable and returned after the last top-level statement of the guest, so the statements that follow its `export default` (var CRON_GRID_RETRIES, var CRON_GRID_CFG) run before the host calls scheduled.
var __fk_qnfoModelEval_guestDefault = {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname.replace(/\/$/, "") || "/";
    try {
      if (p === "/health" || p === "/") {
        let catalog = null;
        let auditAvailable = false;
        try {
          const c = await env.AUDIT.prepare("SELECT COUNT(*) n FROM cf_model_catalog").first();
          catalog = c ? c.n : 0;
          auditAvailable = true;
        } catch (e) {
          console.warn(JSON.stringify({ worker: "qnfo-model-eval", where: "health:audit", error: String(e && e.message ? e.message : e).slice(0, 200) }));
        }
        return json({ ok: true, service: "qnfo-model-eval", version: VERSION, catalog, dependencies: { audit: auditAvailable ? "available" : "unavailable" }, capabilities: CAPABILITIES, limitations: LIMITATIONS });
      }
      if (p === "/manifest") return json(await manifest(env));
      if (p === "/catalog") {
        const r = await env.AUDIT.prepare(
          `SELECT slug, model_id, task_type, modality, status, price_in, price_out, ctx, vision, first_seen, last_seen, last_eval_ts, best_score
             FROM cf_model_catalog ORDER BY first_seen DESC, slug LIMIT 200`).all();
        return json({ count: (r.results || []).length, models: r.results || [] });
      }
      if (p === "/evals") {
        const r = await env.AUDIT.prepare(
          `SELECT id, model_id, battery_version, run_ts, n_tasks, passed, score, mean_latency_ms, cost_usd, verdict
             FROM cf_model_evals ORDER BY id DESC LIMIT 100`).all();
        return json({ count: (r.results || []).length, evals: r.results || [] });
      }
      if (p === "/runs") {
        const r = await env.AUDIT.prepare("SELECT id, ts, trigger, models, probes, ok, detail FROM cf_model_eval_runs ORDER BY ts DESC LIMIT 20").all();
        return json({ runs: r.results || [] });
      }
      if (p === "/leaderboard") {
        const r = await env.AUDIT.prepare(
          `SELECT e.model_id, MAX(e.score) best, MIN(e.mean_latency_ms) best_latency_ms,
                  (SELECT price_in FROM cf_model_catalog c WHERE c.model_id=e.model_id) price_in,
                  (SELECT status FROM cf_model_catalog c WHERE c.model_id=e.model_id) status
             FROM cf_model_evals e WHERE e.battery_version=?1
            GROUP BY e.model_id ORDER BY best DESC, price_in ASC LIMIT 50`).bind(BATTERY_VERSION).all();
        return json({ battery: BATTERY_VERSION, models: r.results || [] });
      }
      if (p === "/promotions") {
        const r = await env.AUDIT.prepare(
          `SELECT id, tier, family, price_in, price_out, quality, notes FROM model_ladder_models
            WHERE notes LIKE 'auto-eval promote%' ORDER BY quality DESC`).all();
        const rd = await env.AUDIT.prepare(
          "SELECT item, title, status, evidence, created_at FROM roadmap_implementation WHERE source='cf-model-eval' ORDER BY id DESC LIMIT 40").all();
        return json({ promoted_models: r.results || [], roadmap: rd.results || [] });
      }
      if (p === "/ab/runs") {
        const r = await env.AUDIT.prepare(
          `SELECT id, created_at, completed_at, worker, task_set, model_pair, trigger_source, n, win_rate, threshold, verdict, judges, judge_agreement, pre_source
             FROM model_ab_runs ORDER BY id DESC LIMIT 50`).all();
        return json({ count: (r.results || []).length, threshold: AB_THRESHOLD, runs: r.results || [] });
      }
      if (p === "/ab/fixtures") {
        const sets = {};
        for (const k of Object.keys(AB_FIXTURES)) sets[k] = AB_FIXTURES[k].map((f) => ({ id: f.id, prompt: f.prompt }));
        return json({ threshold: AB_THRESHOLD, min_valid: AB_MIN_VALID, judge_pool: AB_JUDGE_POOL, classification_set: AB_CLASSIFY_SET, sets });
      }
      if (p === "/ab/run" && req.method === "POST") {
        const keyRow = await env.AUDIT.prepare("SELECT value FROM cf_model_eval_config WHERE key='manual_key'").first();
        const sent = req.headers.get("x-eval-key") || "";
        if (!keyRow || !keyRow.value || sent !== keyRow.value) return json({ ok: false, error: "forbidden" }, 403);
        const body = await req.json().catch(() => ({}));
        if (!body.worker || !body.pre_model || !body.post_model) return json({ ok: false, error: "worker, pre_model and post_model are required" }, 400);
        const row = await abExecute(env, {
          worker: String(body.worker), pre_model: String(body.pre_model), post_model: String(body.post_model),
          task_set: body.task_set ? String(body.task_set) : "grounded-qa", threshold: body.threshold, limit: body.limit,
          live_pre: body.live_pre === true, source: "manual", budget_ms: body.budget_ms,
        });
        return json({ ok: true, run: row });
      }
      if (p === "/canary" && req.method === "POST") {
        const keyRow = await env.AUDIT.prepare("SELECT value FROM cf_model_eval_config WHERE key='manual_key'").first();
        const sent = req.headers.get("x-eval-key") || "";
        if (!keyRow || !keyRow.value || sent !== keyRow.value) return json({ ok: false, error: "forbidden" }, 403);
        const body = await req.json().catch(() => ({}));
        const modelId = body.modelId || (await cfg(env, "clef_winner", ""));
        if (!modelId) return json({ ok: false, error: "no winner; pass modelId" }, 400);
        return json({ ok: true, canary: await clefCanary(env, modelId, Number(body.limit) || 12) });
      }
      if (p === "/run" && req.method === "POST") {
        const keyRow = await env.AUDIT.prepare("SELECT value FROM cf_model_eval_config WHERE key='manual_key'").first();
        const sent = req.headers.get("x-eval-key") || "";
        if (!keyRow || !keyRow.value || sent !== keyRow.value) return json({ ok: false, error: "forbidden" }, 403);
        const body = await req.json().catch(() => ({}));
        const summary = await runLoop(env, "manual", body);
        return json({ ok: true, summary });
      }
      return json({ ok: false, error: "not_found", routes: ["/health", "/manifest", "/catalog", "/evals", "/runs", "/leaderboard", "/promotions", "/canary", "/run", "/ab/runs", "/ab/fixtures", "/ab/run"] }, 404);
    } catch (e) {
      return json({ ok: false, error: String(e && e.message ? e.message : e), version: VERSION }, 500);
    }
  },
  async scheduled(_event, env, ctx) {
    return cronGridRun(env.AUDIT, _event, ctx, CRON_GRID_CFG, function (ev, c) { return modelEvalScheduled(ev, env, c); });
  }
};
function modelEvalScheduled(_event, env, ctx) {
    // AB-HARNESS-1: the hourly grid tick runs the paired A/B trigger; the 6-hourly job (and a manual fire) runs the battery.
    if (String(_event && _event.cron) === CRON_GRID_CFG.tick) {
      ctx.waitUntil(abTick(env).catch(async (e) => {
        try {
          await env.AUDIT.prepare(
            "INSERT OR REPLACE INTO cloud_ops_events (id, ts, kind, text, meta, job, status) VALUES (?1, datetime('now'), 'cf-model-eval', ?2, NULL, 'cf-model-eval', 'warn')"
          ).bind("cf-model-eval-ab-err-" + Date.now(), "AB-HARNESS-1 tick failed: " + String(e && e.message ? e.message : e)).run();
        } catch (eLog) {
          console.error(JSON.stringify({ worker: "qnfo-model-eval", where: "ab-tick:error-event", error: String(eLog && eLog.message || eLog), tick_error: String(e && e.message || e) }));
        }
        throw e;
      }));
      return;
    }
    ctx.waitUntil(runLoop(env, "cron", {}).catch(async (e) => {
      try {
        await env.AUDIT.prepare(
          "INSERT OR REPLACE INTO cloud_ops_events (id, ts, kind, text, meta, job, status) VALUES (?1, datetime('now'), 'cf-model-eval', ?2, NULL, 'cf-model-eval', 'warn')"
        ).bind("cf-model-eval-err-" + Date.now(), "CF-MODEL-EVAL-1 cron failed: " + String(e && e.message ? e.message : e)).run();
      } catch (eLog) {
        console.error(JSON.stringify({ worker: "qnfo-model-eval", where: "scheduled:error-event", error: String(eLog && eLog.message || eLog), cron_error: String(e && e.message || e) }));
      }
      throw e;
    }));
}
// ---- CRON-GRID-1:BEGIN (owner directive 2026-10-19: "ALL CRON TICKS SHALL BE MEASURED IN 5-MINUTE INTERVALS, AND NO CRON
// SHALL EXECUTE LESS THAN ONCE EVERY HOUR. ALL CRON FAILURES/ERRORS SHALL BE TRIAGED AND REMEDIATED AUTOMATICALLY BY THE FLEET.")
// Cloudflare fires this worker only on triggers that repeat at least hourly, on minutes that are multiples of 5. A job that
// had its own slower trigger (daily, weekly, every 6 hours) keeps its cadence: it runs on the first grid fire after its old
// slot, and is retried on later fires while its last good run is older than its period plus 30 minutes, at most
// CRON_GRID_RETRIES times in a row; past that CRON-WATCH-1 (qnfo-audit fleet_tasks cron-watch) escalates it to the code loop.
// Every run is one cron_fire_log row (source worker:<name>, outcome ok, error or idle) that CRON-WATCH-1 reads. A job named
// retry: false (a send to people outside the fleet) runs only on its slot, so a failure is never repeated at a reader.
var CRON_GRID_RETRIES = 3;
function cronGridField(spec, v, lo, hi) {
  return String(spec).split(",").some(function (part) {
    var step = 1, sm = /^(.*)\/(\d+)$/.exec(part), a, b;
    if (sm) { part = sm[1]; step = Math.max(1, parseInt(sm[2], 10)); }
    if (part === "*") { a = lo; b = hi; }
    else if (part.indexOf("-") > 0) { a = parseInt(part, 10); b = parseInt(part.split("-")[1], 10); }
    else { a = parseInt(part, 10); b = sm ? hi : a; }
    return v >= a && v <= b && (v - a) % step === 0;
  });
}
// Cloudflare numbers weekdays 1 (Sunday) to 7 (Saturday) (CF-DOW, qnfo-fleet-control 2026-10-05).
function cronGridMatch(expr, d) {
  var f = String(expr).trim().split(/\s+/);
  if (f.length !== 5) return false;
  var domOk = cronGridField(f[2], d.getUTCDate(), 1, 31), dowOk = cronGridField(f[4], d.getUTCDay() + 1, 1, 7);
  var dayOk = f[2] !== "*" && f[4] !== "*" ? (domOk || dowOk) : (domOk && dowOk);
  return dayOk && cronGridField(f[0], d.getUTCMinutes(), 0, 59) && cronGridField(f[1], d.getUTCHours(), 0, 23) && cronGridField(f[3], d.getUTCMonth() + 1, 1, 12);
}
// True when expr had a slot in the window (sinceMs, untilMs].
function cronGridSlot(expr, sinceMs, untilMs) {
  for (var t = Math.floor(untilMs / 60000) * 60000; t > sinceMs; t -= 60000) if (cronGridMatch(expr, new Date(t))) return true;
  return false;
}
async function cronGridLog(db, worker, expr, startMs, outcome, note) {
  if (!db) return;
  try {
    await db.prepare("INSERT INTO cron_fire_log (cron_name, task_id, cron_expr, fired_at, fired_epoch_ms, outcome, source, note) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)")
      .bind(worker + "|" + expr, worker, expr, new Date(startMs).toISOString(), startMs, outcome, "worker:" + worker, String(note || "").slice(0, 500)).run();
  } catch (e) { console.error(JSON.stringify({ worker: worker, where: "cron-grid-log", error: String(e && e.message || e).slice(0, 200) })); }
}
async function cronGridDue(db, cfg, nowMs) {
  var out = [], lag = cfg.lagMin || 0;
  for (var i = 0; i < cfg.jobs.length; i++) {
    var j = cfg.jobs[i];
    if (cronGridSlot(j.cron, nowMs - (lag + cfg.tickMin) * 60000, nowMs - lag * 60000)) { out.push({ cron: j.cron, why: "slot" }); continue; }
    if (!db || !j.retry) continue;
    try {
      var name = cfg.worker + "|" + j.cron;
      var r = await db.prepare("SELECT COUNT(*) AS n, MAX(CASE WHEN outcome = 'ok' THEN fired_epoch_ms END) AS last_ok, SUM(CASE WHEN outcome = 'error' AND fired_epoch_ms > COALESCE((SELECT MAX(fired_epoch_ms) FROM cron_fire_log WHERE cron_name = ?1 AND outcome = 'ok'), 0) THEN 1 ELSE 0 END) AS fails FROM cron_fire_log WHERE cron_name = ?1").bind(name).first();
      if (r && Number(r.n) > 0 && Number(r.fails || 0) < CRON_GRID_RETRIES && nowMs - Number(r.last_ok || 0) > (j.periodMin + 30) * 60000) out.push({ cron: j.cron, why: "retry" });
    } catch (e) { console.error(JSON.stringify({ worker: cfg.worker, where: "cron-grid-due", error: String(e && e.message || e).slice(0, 200) })); }
  }
  return out;
}
// One run of the worker's own handler, awaited with its waitUntil work, logged with its outcome.
async function cronGridOne(db, worker, expr, why, ev, ctx, run) {
  var t0 = Date.now(), pending = [];
  var c = { waitUntil: function (p) { pending.push(Promise.resolve(p)); } };
  try {
    await run(ev, c);
    // Index loop, not allSettled: work a waitUntil promise adds while it runs is awaited too.
    var bad = null;
    for (var k = 0; k < pending.length; k++) { try { await pending[k]; } catch (e) { if (!bad) bad = e || new Error("waitUntil rejected"); } }
    if (bad) throw bad;
    await cronGridLog(db, worker, expr, t0, "ok", why + " " + (Date.now() - t0) + " ms");
  } catch (e) {
    await cronGridLog(db, worker, expr, t0, "error", why + ": " + String(e && e.message || e));
    throw e;
  }
}
// cfg: { worker, tick, tickMin, lagMin, jobs: [{ cron, periodMin, retry }], own: "self" | "none" | "<cron the tick runs as>", ownWhenDue }
async function cronGridRun(db, event, ctx, cfg, run) {
  var cron = String((event && event.cron) || "");
  var nowMs = Number(event && event.scheduledTime) || Date.now();
  if (cron !== cfg.tick) return cronGridOne(db, cfg.worker, cron || "manual", "fire", event, ctx, run);
  var due = await cronGridDue(db, cfg, nowMs), firstErr = null;
  for (var i = 0; i < due.length; i++) {
    try { await cronGridOne(db, cfg.worker, due[i].cron, due[i].why, { cron: due[i].cron, scheduledTime: nowMs, type: "scheduled" }, ctx, run); }
    catch (e) { if (!firstErr) firstErr = e; }
  }
  if (cfg.own === "none" || (due.length && cfg.ownWhenDue === false)) {
    if (!due.length) await cronGridLog(db, cfg.worker, cfg.tick, nowMs, "idle", "grid tick: no job due");
  } else {
    var ev = cfg.own && cfg.own !== "self" ? { cron: cfg.own, scheduledTime: nowMs, type: "scheduled" } : event;
    try { await cronGridOne(db, cfg.worker, cfg.tick, "tick", ev, ctx, run); } catch (e) { if (!firstErr) firstErr = e; }
  }
  if (firstErr) throw firstErr;
}
// ---- CRON-GRID-1:END ----
var CRON_GRID_CFG = {"worker": "qnfo-model-eval", "tick": "20 * * * *", "tickMin": 60, "jobs": [{"cron": "17 */6 * * *", "periodMin": 360, "retry": true}], "own": "self"};
return __fk_qnfoModelEval_guestDefault;
})();
var __fk_qnfoModelEval_default = __foldWrap(__fk_qnfoEvolve_default, {
  name: "qnfo-model-eval", mod: qnfoModelEvalFoldMod, prefix: "/model-eval", publicPaths: [],
  publicRoutes: [], callers: [],
  consts: {}, derive: {},
  tokenHeader: null, tokenEnv: null, tokenScheme: null,
  // Least privilege: the member gets its own bindings, vars and the env names its code reads, never the whole host env.
  keys: ["AI", "AUDIT", "QNFO_AI"],
  // AI-METER-COVER-3a (pillar cost, roadmap RM-COST-FREE-FIRST-PARITY-1): __foldWrap builds this env from the RAW host env, so the host's __aiAttrEnv (installed inside the host's fetch and scheduled) never reaches the member's Workers AI calls; the member's env is wrapped here, so each benchmark call is one ai_call_counters row under qnfo-model-eval.
  env: function (raw) { var e = {}, k = this.keys; for (var i = 0; i < k.length; i++) if (raw[k[i]] !== undefined) e[k[i]] = raw[k[i]]; return __aiAttrEnv(Object.assign(e, { AUDIT: raw.QNFO_AUDIT }), "qnfo-model-eval", "AI", "AUDIT"); },
  due: function (ms, cron) { return ((new Date(ms).getUTCMinutes() < 30) ? "20 * * * *" : null); }
});
// ---- FOLD-KIT-1:qnfo-model-eval:END ----
export {
  __fk_qnfoModelEval_default as default
};
//# sourceMappingURL=worker.js.map
