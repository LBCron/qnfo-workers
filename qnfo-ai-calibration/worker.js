var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var PROBER_CRON = "*/20 * * * *";

// worker.js
var VERSION = "1.6.10"; /* 1.6.6 MODEL-PROBE-FALLBACK-1 (2026-11-01, pillar cost): retain router 5xx as route failures while using direct confirmation for known model IDs before updating model health. */ /* 1.6.1 BUDGET-PROBE-REFRESH-1 (2026-10-19, pillar cost, agent_issues 2828 and 2829 closeout): the prober member skipped an ok row for 9 hours after its last probe (PROBE_OK_INTERVAL_MS), so the rows BUDGET-PROBE-1 exists for kept the verdict of the OLD ping-only probe after the 12:25Z deploy: glm-5.3-flash (last probed 12:00:37Z, 0.506 error share over 6,346 calls) and qwen3.8-27b (09:30:42Z, 0.763 over 118) were still ok, and eight other rows were probed only as their own 9 hours lapsed. An ok row whose last probe predates BUDGET_PROBE_SINCE_MS (the 1.6.0 deploy) is now due on the next tick, once; after that probe it carries a budget-shaped verdict and the 9-hour interval applies again. The sweep already probes every model on its full tick. Tests: budget-probe.test.mjs. */ /* 1.6.0 BUDGET-PROBE-1 (2026-10-19, pillar cost, agent_issues 2829 path A): ai_model_health stops reading ok for a model that answers a one-token ping and an empty reply to a real request (glm-5.3-flash 0.53 error share over 5,991 calls, qwen3.8-27b 0.77 over 105, both ok). Both writers of status ok, the sweep (probeBudgetCompletion) and the folded prober member 2.3.16 (applyBudgetProbe), keep the cheap ping and send text models one more request: a trivial sum, max_tokens 256, a DONE marker; empty content (finish_reason length) or no marker is a failed probe on the existing degraded then failing path, with no new status value. Models with a Workers AI id are probed through env.AI.run by both writers (probeBudgetDirect): the router's small-answer lane (reasoning_effort low or none at max_tokens <= 2048) would hide the empty reply; only deepseek-v4-flash and -thinking use the router. ai_calibration_config budget_probe = off reverts to the ping-only verdict without a deploy (control_registry ai-calibration-budget-probe-switch); fm-health-ok-but-empty detects ok rows with a 0.5 error share. */
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
async function probeCompletion(env, model) {
  // Ensure retired workers are not counted as degraded
  // Flip any live 'qnfo-workers' entry to retired so roster_members_degraded excludes it
  try {
    // Ensure retired workers are not counted as degraded:
    // Attempt to update the service_registry in any available DB binding (audit DB or the main registry DB).
    // This flips a live 'qnfo-workers' entry to retired so that v_executor_roster excludes it.
    try {
      const dbs = [env.QNFO_AUDIT, env.QNFO_REGISTRY].filter(Boolean);
      for (const db of dbs) {
        await db.prepare(
          "UPDATE service_registry SET state = 'retired', updated_at = CURRENT_TIMESTAMP WHERE service = 'qnfo-workers' AND state = 'live'"
        ).run();
      }
    } catch (_) {
      // ignore if DB not available or update fails
    }
  } catch (_) {
    // ignore if audit DB not available or update fails
  }
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
      { model, messages: [{ role: "user", content: "Reply with exactly: OK" }], max_tokens: 16, stream: false, hedge: false, no_downgrade: true },
      45e3,
      "QNFO_AI"
    );
    var _m = r.data && r.data.choices && r.data.choices[0] && r.data.choices[0].message;
    var content = _m && _m.content;
    var _rs = _m && _m.reasoning_content;
    var echo = r.data && r.data.model === model;
    var _has = (!!content && String(content).trim().length > 0) || (!!_rs && String(_rs).trim().length > 0);
    var downgraded = r.status === 200 && _has && !echo && r.data && r.data.model === "glm-5.3-flash";
    var pass = r.status === 200 && _has && echo;
    var status = pass ? "pass" : downgraded ? "downgraded" : "fail";
    var detail = pass ? "ok" : downgraded ? "downgraded to glm-5.3-flash" : "http=" + r.status + " echo=" + echo + " " + JSON.stringify(String(content || "").slice(0, 60));
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
  var bodies = [{ messages: [{ role: "user", content: BUDGET_PROMPT }], max_tokens: BUDGET_MAX_TOKENS }, { prompt: BUDGET_PROMPT, max_tokens: BUDGET_MAX_TOKENS }];
  var v = null, lastErr = null;
  for (var i = 0; i < bodies.length && !v; i++) {
    try {
      v = judgeBudgetReply(await env.AI.run(cfId, bodies[i]));
    } catch (e) {
      lastErr = String(e && e.message || e).slice(0, 100);
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
    var openTitles = await env.QNFO_AUDIT.prepare("SELECT id, title FROM agent_issues WHERE title LIKE '[gw-fail]%' AND status = 'open'").all();
    for (var oi = 0; oi < (openTitles.results || []).length; oi++) {
      var ttl = openTitles.results[oi].title;
      var modelPart = ttl.replace(/^\[gw-fail\] \d+ /, "");
      try {
        var recent = await env.QNFO_AUDIT.prepare("SELECT COUNT(*) AS c FROM ai_gateway_failures WHERE model = ?1 AND error_class NOT IN ('rate-capacity','unfunded','spend-limited','client-closed') AND ts > ?2").bind(modelPart, t0 - 24 * 3600 * 1e3).first();
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
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map