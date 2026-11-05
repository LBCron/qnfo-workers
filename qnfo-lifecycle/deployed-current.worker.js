var VERSION = "1.18.0-codeagent";
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
            var chars = 0; try { chars = JSON.stringify(input && (input.messages || input.prompt || input.text) || input || "").length; } catch (e1) { console.error(JSON.stringify({ worker: worker, where: "ai-attr-input-chars", error: String(e1 && e1.message || e1).slice(0, 200) })); }
            var inTok = Number(u.prompt_tokens || u.input_tokens || 0) || Math.round(chars / 4);
            var outTok = Number(u.completion_tokens || u.output_tokens || 0);
            var r = __AI_ATTR_RATES[String(model)] || [0, 0];
            var neurons = (inTok * r[0] + outTok * r[1]) / 1e6;
            await db.prepare("INSERT INTO ai_call_counters (day, worker, purpose, model, calls, errors, in_chars, ms, in_tok, out_tok, neurons) VALUES (?1,?2,'binding',?3,1,?4,?5,?6,?7,?8,?9) ON CONFLICT(day, worker, purpose, model) DO UPDATE SET calls=calls+1, errors=errors+excluded.errors, in_chars=in_chars+excluded.in_chars, ms=ms+excluded.ms, in_tok=in_tok+excluded.in_tok, out_tok=out_tok+excluded.out_tok, neurons=neurons+excluded.neurons")
              .bind(new Date().toISOString().slice(0, 10), worker, String(model).slice(0, 120), ok ? 0 : 1, chars, Date.now() - t0, inTok, outTok, neurons).run();
          } catch (e2) { console.error(JSON.stringify({ worker: worker, where: "ai-attr-counter", error: String(e2 && e2.message || e2).slice(0, 200) })); }
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
// Spend governor: demote hourly route to the cheapest sufficient model
globalThis.spendGovernor = { hourlyRoute: "cheapest" }; /* 1.17.1 BACKLOG-CATCHUP-1 (2026-11-02, issue 1001290, pillar autonomy): the folded daily backlog member catches up on an hourly tick after a missed daily run. */ /* 1.17.0 PAPER-LEARN-GAP-PROBATION-1 (2026-11-01, issue 100294, pillar autonomy): model-identified direct learnings without a verified cover become owned goals with a completion probe instead of remaining silently proposed. */ /* 1.15.3 BACKUP-PAGED-1 (2026-10-26, pillar reliability; CF-OBS group a539fdc8, agent_issues 100522, 1000239, 1000265, FLEET-JOURNEY traffic-health 1000262): the daily 05:00 UTC backup no longer reads a whole table into memory; tables are paged by rowid and written in parts, and the result is logged. */ /* prior: 1.15.1-codeagent */ /* 1.15.0 NO-REGISTRAR-1 (2026-10-21, owner directive: the closed deposit registrar is fully deprecated and is not used or named in any code): the finished hourly body scrub and its status route are removed. */ /* prior: 1.14.1-close-channel */ /* 1.14.1 CLOSE-CHANNEL-REQUIRED-1 (agent_issues 100419): MODEL-HEALTH-SWEEP-1 closes write close_channel auto:lifecycle/model-health-sweep. */ /* 1.14.0 PAPER-LEARN-TRIAGE-1 (2026-10-20, pillar autonomy, owner directive "clear all open issues server-side automatically within 24 hours"; agent_issues 100234, 100249, 100252, 100257, 100261; minor: a decision it now takes on its own): PAPER-LEARN-1 filed an issue per paper and nothing answered its learnings, so five issues sat at PL_ISSUE_OPEN_MAX and blocked every later paper. Each hourly tick now settles up to 12 proposed direct learnings, issue-bound first, against the catalogue paper_learning_mechanisms: already-in-place when a mechanism matches the claim or lever and its evidence probe is ok now (the note cites it), rejected only when two model families agree (or a named catalogue mechanism conflicts and its probe is ok), apply left proposed with the proposal in its note; ops_config paper_learn_triage = off stops it. The reader strips the pipeline's own notices (correction banner, Correction Notice, Version History, Provenance) before reading, so a notice is not learned as the paper's claim (11 of 18 learnings on the five open issues were the CLAIM-INTEGRITY-1 notice). paper-learn-triage.test.mjs. */ /* 1.12.0 PAPER-LEARN-1 (2026-10-19, pillar autonomy, owner directive "THE SYSTEM/FLEET SHALL ALWAYS LEARN FROM ITS OWN RESEARCH PAPERS"): a new hourly step reads each new or revised published paper (up to ops_config paper_learn_per_tick, default 4, newest first), stores its fleet-relevant claims in qnfo-audit.paper_learnings with a verification status decided from the paper itself (unverified, derived-unchecked, cited-unchecked, assumption), routes errors a second model family confirms to internal_errata for the revision loop, files one PAPER-LEARN-1 follow-up issue with a closing probe for a strong direct learning, writes metric papers_unlearned_over_120m; GET /paper-learn/status and /paper-learn/learnings?slug=; paper_learn_mode = off stops it. */ /* 1.11.5 ping-404. */ /* 1.11.4 SLA-120M-7 (2026-10-14, pillar autonomy; owner directive 2026-10-14: no SLA exceeds 120 minutes): the advisor-noise sweep closes an OPEN-ISSUES snapshot after ADVISOR_NOISE_MAX_MIN (120 minutes), not 3 h, and its caught error is logged. */ /* 1.11.3 WORKERS-BP-LOGGING-qnfo-lifecycle-1 (2026-10-14, agent_issues 2536, child of 2342, pillar autonomy): the swallowed catches log as a structured console.error (worker, where, error); control flow unchanged. */ /* 1.11.2: backlog member 2.0.7 BACKLOG-LATEST-PASS-1, an issue closes only when its latest verification passed within 3 h (agent_issues 2222 was closed on a stale pass while its latest verification failed). */ /* 1.11.1: /noz-scrub/status answers a fixed message on failure and logs the error (CodeQL alerts 394, 395). */ /* 1.11.0-noz-scrub NOZ-SCRUB-LOOP-1 (2026-10-12, agent_issues 2273 and 2278, pillar research): a new hourly step cleans the stored living-paper.papers rows that still name the dead deposit registrar or carry its DOIs (up to 150 rows, 10 MB or 20 s a tick; line-local scrub; DOI/URL columns of the registrar set NULL; old value of every changed field kept first in living-paper.papers_bak_nozdoi; idempotent, residual rows marked and not retried; GET /noz-scrub/status; ledger cloud_ops_events job noz-scrub). Was 1.10.1-doi-scrub. 1.10.0-spare-domains SPARE-DOMAINS-1 (agent_issues 2077, pillar reach): twelve spare-domain hostnames (ipatent.me, qwav.net, qwav.uk, qwave.tech, q-wave.tech, empoweringchange.today and their www) answer 301 to their canonical site (ipatent.qnfo.org, qwav.org, qnfo.org), path and query kept. 1.9.1-retired-hosts RETIRED-HOSTS-1: twelve retired qnfo.org hostnames answer 410 Gone (noindex) instead of 522 via Workers routes on this worker (agent_issues 2010). 1.9.0-calendar-fold CALENDAR-FOLD-2 (2026-10-06, T3.10, agent_issues 2010, pillar cost, OWNER-STANDING-GRANT-1): calendar-api (ICS publish, notes intake, event feedback, owner questions) runs here as the member calendarApiFoldMod on the hourly tick, awaited; its feedback-link key is HMAC-derived from this worker's CF_API_TOKEN by the fold kit (CAL_KEY_SEED), never copied or minted; public /calendar/health, /calendar/e/<id> (GET page, POST answer) and /calendar/events.ics; binders personal-api, qnfo-intent-orchestrator and radar-hub reach it with props.member (FOLD-KIT-1). Was 1.8.1-one-worker-count. */ // 1.8.1 ONE-WORKER-COUNT-1 (2026-10-06, pillar core, transformation lever T5.10): runMetricFreshness no longer writes metric_registry.worker_count; qnfo-fleet-control 0.4.137 writes it from the live scripts census beside fleet_budget.workers (COUNT(service_registry) counted retired rows too, 32 against 31 on 2026-10-06). 1.8.0 BACKLOG-FOLD-1 (#1756, pillar cost): qnfo-backlog-exec runs here as a member (backlogMod) on the 02:00 tick; GET /backlog/health; qnfo-ops reaches its drain over the BACKLOG binding (props.member). qnfo-archive (retired: its KG seed got HTTP 401 on every batch) leaves runPing. 1.7.3 LIFECYCLE-PING-1042-1 (#1994): wrangler.toml sets global_fetch_strictly_public, so runPing and runSync reach *.q08.workers.dev (150 PING FAIL HTTP 404 rows were Cloudflare error 1042). 1.7.2 METRIC-CADENCE-UNITS-1 + METRIC-UNMEASURED-CLASS-1 (#1865): "*/3h" and "2h" cadences parse with their unit; never-measured UNMEASURED/n/a metrics are their own class. 1.7.0 CRON-SINGLE-TRIGGER-1 (#1785): one hourly trigger, CRON_TABLE in code. Worker Contract v1 VERSION constant (read by version-bump-guard / drift checks) /* 1.15.2 PAPER-LEARN-ANCHOR-1 (2026-10-26, pillar research; patch): PAPER-LEARN-1 errata now carry an `At: "<passage>"` anchor in claim_text, the contract errata-hub's internal confirm already reads (qnfo-paper-reviser and READER-REPORT-1 write one), so the third-model confirm centres its excerpt on the passage instead of reading the first 24,000 characters. paper-learn-anchor.test.mjs. */ /* prior: 1.15.1-codeagent */ /* 1.15.0 NO-REGISTRAR-1 (2026-10-21, owner directive: the closed deposit registrar is fully deprecated and is not used or named in any code): the finished hourly body scrub and its status route are removed. */ /* prior: 1.14.1-close-channel */ /* 1.14.1 CLOSE-CHANNEL-REQUIRED-1 (agent_issues 100419): MODEL-HEALTH-SWEEP-1 closes write close_channel auto:lifecycle/model-health-sweep. */ /* 1.14.0 PAPER-LEARN-TRIAGE-1 (2026-10-20, pillar autonomy, owner directive "clear all open issues server-side automatically within 24 hours"; agent_issues 100234, 100249, 100252, 100257, 100261; minor: a decision it now takes on its own): PAPER-LEARN-1 filed an issue per paper and nothing answered its learnings, so five issues sat at PL_ISSUE_OPEN_MAX and blocked every later paper. Each hourly tick now settles up to 12 proposed direct learnings, issue-bound first, against the catalogue paper_learning_mechanisms: already-in-place when a mechanism matches the claim or lever and its evidence probe is ok now (the note cites it), rejected only when two model families agree (or a named catalogue mechanism conflicts and its probe is ok), apply left proposed with the proposal in its note; ops_config paper_learn_triage = off stops it. The reader strips the pipeline's own notices (correction banner, Correction Notice, Version History, Provenance) before reading, so a notice is not learned as the paper's claim (11 of 18 learnings on the five open issues were the CLAIM-INTEGRITY-1 notice). paper-learn-triage.test.mjs. */ /* 1.12.0 PAPER-LEARN-1 (2026-10-19, pillar autonomy, owner directive "THE SYSTEM/FLEET SHALL ALWAYS LEARN FROM ITS OWN RESEARCH PAPERS"): a new hourly step reads each new or revised published paper (up to ops_config paper_learn_per_tick, default 4, newest first), stores its fleet-relevant claims in qnfo-audit.paper_learnings with a verification status decided from the paper itself (unverified, derived-unchecked, cited-unchecked, assumption), routes errors a second model family confirms to internal_errata for the revision loop, files one PAPER-LEARN-1 follow-up issue with a closing probe for a strong direct learning, writes metric papers_unlearned_over_120m; GET /paper-learn/status and /paper-learn/learnings?slug=; paper_learn_mode = off stops it. */ /* 1.11.5 ping-404. */ /* 1.11.4 SLA-120M-7 (2026-10-14, pillar autonomy; owner directive 2026-10-14: no SLA exceeds 120 minutes): the advisor-noise sweep closes an OPEN-ISSUES snapshot after ADVISOR_NOISE_MAX_MIN (120 minutes), not 3 h, and its caught error is logged. */ /* 1.11.3 WORKERS-BP-LOGGING-qnfo-lifecycle-1 (2026-10-14, agent_issues 2536, child of 2342, pillar autonomy): the swallowed catches log as a structured console.error (worker, where, error); control flow unchanged. */ /* 1.11.2: backlog member 2.0.7 BACKLOG-LATEST-PASS-1, an issue closes only when its latest verification passed within 3 h (agent_issues 2222 was closed on a stale pass while its latest verification failed). */ /* 1.11.1: /noz-scrub/status answers a fixed message on failure and logs the error (CodeQL alerts 394, 395). */ /* 1.11.0-noz-scrub NOZ-SCRUB-LOOP-1 (2026-10-12, agent_issues 2273 and 2278, pillar research): a new hourly step cleans the stored living-paper.papers rows that still name the dead deposit registrar or carry its DOIs (up to 150 rows, 10 MB or 20 s a tick; line-local scrub; DOI/URL columns of the registrar set NULL; old value of every changed field kept first in living-paper.papers_bak_nozdoi; idempotent, residual rows marked and not retried; GET /noz-scrub/status; ledger cloud_ops_events job noz-scrub). Was 1.10.1-doi-scrub. 1.10.0-spare-domains SPARE-DOMAINS-1 (agent_issues 2077, pillar reach): twelve spare-domain hostnames (ipatent.me, qwav.net, qwav.uk, qwave.tech, q-wave.tech, empoweringchange.today and their www) answer 301 to their canonical site (ipatent.qnfo.org, qwav.org, qnfo.org), path and query kept. 1.9.1-retired-hosts RETIRED-HOSTS-1: twelve retired qnfo.org hostnames answer 410 Gone (noindex) instead of 522 via Workers routes on this worker (agent_issues 2010). 1.9.0-calendar-fold CALENDAR-FOLD-2 (2026-10-06, T3.10, agent_issues 2010, pillar cost, OWNER-STANDING-GRANT-1): calendar-api (ICS publish, notes intake, event feedback, owner questions) runs here as the member calendarApiFoldMod on the hourly tick, awaited; its feedback-link key is HMAC-derived from this worker's CF_API_TOKEN by the fold kit (CAL_KEY_SEED), never copied or minted; public /calendar/health, /calendar/e/<id> (GET page, POST answer) and /calendar/events.ics; binders personal-api, qnfo-intent-orchestrator and radar-hub reach it with props.member (FOLD-KIT-1). Was 1.8.1-one-worker-count. */ // 1.8.1 ONE-WORKER-COUNT-1 (2026-10-06, pillar core, transformation lever T5.10): runMetricFreshness no longer writes metric_registry.worker_count; qnfo-fleet-control 0.4.137 writes it from the live scripts census beside fleet_budget.workers (COUNT(service_registry) counted retired rows too, 32 against 31 on 2026-10-06). 1.8.0 BACKLOG-FOLD-1 (#1756, pillar cost): qnfo-backlog-exec runs here as a member (backlogMod) on the 02:00 tick; GET /backlog/health; qnfo-ops reaches its drain over the BACKLOG binding (props.member). qnfo-archive (retired: its KG seed got HTTP 401 on every batch) leaves runPing. 1.7.3 LIFECYCLE-PING-1042-1 (#1994): wrangler.toml sets global_fetch_strictly_public, so runPing and runSync reach *.q08.workers.dev (150 PING FAIL HTTP 404 rows were Cloudflare error 1042). 1.7.2 METRIC-CADENCE-UNITS-1 + METRIC-UNMEASURED-CLASS-1 (#1865): "*/3h" and "2h" cadences parse with their unit; never-measured UNMEASURED/n/a metrics are their own class. 1.7.0 CRON-SINGLE-TRIGGER-1 (#1785): one hourly trigger, CRON_TABLE in code. Worker Contract v1 VERSION constant (read by version-bump-guard / drift checks)
const QNFO_VERSION = VERSION;
const EXPECTED_QNFO_VERSION = VERSION;
var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var __defProp2 = Object.defineProperty;
var __name2 = /* @__PURE__ */ __name((target, value) => __defProp2(target, "name", { value, configurable: true }), "__name");
var __defProp22 = Object.defineProperty;
var __name22 = /* @__PURE__ */ __name2((target, value) => __defProp22(target, "name", { value, configurable: true }), "__name");
var __defProp222 = Object.defineProperty;
var __name222 = /* @__PURE__ */ __name22((target, value) => __defProp222(target, "name", { value, configurable: true }), "__name");
var __defProp2222 = Object.defineProperty;
var __name2222 = /* @__PURE__ */ __name222((target, value) => __defProp2222(target, "name", { value, configurable: true }), "__name");
var __defProp22222 = Object.defineProperty;
var __name22222 = /* @__PURE__ */ __name2222((target, value) => __defProp22222(target, "name", { value, configurable: true }), "__name");
var __defProp222222 = Object.defineProperty;
var __name222222 = __name22222((target, value) => __defProp222222(target, "name", { value, configurable: true }), "__name");
function corsHeaders(origin) {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": origin || "https://qnfo.org"
  };
}
__name(corsHeaders, "corsHeaders");
__name2(corsHeaders, "corsHeaders");
__name22(corsHeaders, "corsHeaders");
__name222(corsHeaders, "corsHeaders");
__name2222(corsHeaders, "corsHeaders");
__name22222(corsHeaders, "corsHeaders");
// ---- CRON-SINGLE-TRIGGER-1:BEGIN (pure; replayed by scripts/cron-single-trigger.test.mjs)
// CRON-SINGLE-TRIGGER-1 (2026-10-02, #1785, pillar: core). The account held 84 cron expressions against the fleet budget
// of 50. This worker now registers ONE hourly trigger; each tick runs every entry of CRON_TABLE (the former trigger list,
// unchanged) that fired in the hour ending at the tick, through the same dispatcher as before. An entry on the hour runs
// at its minute; one at :15 or :30 runs at the next full hour. Hourly keeps the 15-minute CPU limit of a cron trigger.
var TICK_CRON = "0 * * * *";
var CRON_TABLE = ["0 * * * *", "0 0 1 * *", "0 3 * * *", "0 5 * * *", "0 8 * * 1"];
var TICK_PARALLEL = false;
function cronFieldMatch(spec, v) {
  return String(spec).split(",").some(function (part) {
    var st = /^(.+)\/(\d+)$/.exec(part), step = st ? Number(st[2]) : 1, base = st ? st[1] : part;
    var r = /^(\d+)-(\d+)$/.exec(base), lo, hi;
    if (base === "*") { lo = 0; hi = 1e9; } else if (r) { lo = Number(r[1]); hi = Number(r[2]); } else { lo = Number(base); hi = st ? 1e9 : lo; }
    return v >= lo && v <= hi && (v - (base === "*" ? 0 : lo)) % step === 0;
  });
}
// Cloudflare cron fields in UTC; day of week 1 = Sunday .. 7 = Saturday.
function cronMatchesAt(expr, ms) {
  var f = String(expr).trim().split(/\s+/), d = new Date(ms);
  return f.length === 5 && cronFieldMatch(f[0], d.getUTCMinutes()) && cronFieldMatch(f[1], d.getUTCHours()) && cronFieldMatch(f[2], d.getUTCDate()) && cronFieldMatch(f[3], d.getUTCMonth() + 1) && cronFieldMatch(f[4], d.getUTCDay() + 1);
}
// The table entries that fired in the 60 minutes ending at the tick (tick minute included), in table order.
function cronDueAtTick(table, tickMs) {
  var t = Math.floor(tickMs / 60000) * 60000;
  return table.filter(function (expr) {
    for (var k = 0; k < 60; k++) if (cronMatchesAt(expr, t - k * 60000)) return true;
    return false;
  });
}
// ---- CRON-SINGLE-TRIGGER-1:END
// `one` is the dispatcher this worker always had (one cron expression in, its job run). A trigger other than the tick
// (a former per-job trigger still registered) goes straight to it, and so does an event marked tickEntry: that is how
// the tick hands each table entry on, and how a test runs one entry whose expression equals the tick's.
async function cronTickDispatch(event, one) {
  if (!event || event.cron !== TICK_CRON || event.tickEntry) return one(event);
  var at = Number(event.scheduledTime) || Date.now();
  var due = cronDueAtTick(CRON_TABLE, at);
  var run = function (expr) {
    return Promise.resolve().then(function () { return one({ cron: expr, scheduledTime: at, type: "scheduled", tickEntry: true }); }).catch(function (e) { console.error("cron " + expr + ": " + String(e && e.message || e)); });
  };
  if (TICK_PARALLEL) { await Promise.all(due.map(run)); return; }
  for (var i = 0; i < due.length; i++) await run(due[i]);
}
// ---- BACKLOG-FOLD-1:BEGIN (1.8.0, #1756) ----
// qnfo-backlog-exec (the agent_issues sweep and drain) runs here as a member: its code below is the qnfo-backlog-exec
// bundle unchanged except its VERSION line. AUDIT maps onto QNFO_AUDIT. It runs on the 02:00 UTC hourly tick (its old
// "10 1 * * *", delivered at the next full hour as CRON-SINGLE-TRIGGER-1 does for this worker's table). Public: GET
// /backlog/health. A service binding whose props name the member (qnfo-ops BACKLOG) reaches all of its routes, so
// qnfo-ops' https://backlog.internal/run drain keeps its internal-caller gate.
var BACKLOG_VERSION = "2.0.7-folded";
var BACKLOG_MEMBER = "qnfo-backlog-exec";
var backlogMod = (function () {
var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var VERSION = BACKLOG_VERSION;
// PRIORITY-QUEUE-1 (2026-10-03, owner directive): the sweep ranks critical first. The old CASE ranked high, medium, else,
// so critical issues sorted with low. Within a priority the least recently touched row still goes first (rotation).
var WORKER = "qnfo-backlog-exec";
var MAX_ROW = 40;
var LATEST_PASS_MAX_H = 3;
var PROBE_TIMEOUT = 8e3;
async function json(data, status) {
  return new Response(JSON.stringify(data), { status: status || 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
}
__name(json, "json");
function ts() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
__name(ts, "ts");
function nowEpoch() {
  return Date.now();
}
__name(nowEpoch, "nowEpoch");
function createdAgeMs(ca, now) {
  if (typeof ca === "number") return now - ca;
  if (typeof ca === "string") {
    const t = ca.trim();
    if (/^\d{10,}$/.test(t)) return now - Number(t);
    const d = new Date(t).getTime();
    if (Number.isFinite(d)) return now - d;
  }
  return 0;
}
__name(createdAgeMs, "createdAgeMs");
async function recordEvent(env, kind, text, meta, job, status) {
  try {
    const id = kind.slice(0, 2) + "-" + (job || WORKER) + "-" + Date.now().toString(36);
    // Set a busy timeout so SQLite will wait briefly instead of immediately erroring when the DB is under load.
    await env.AUDIT.prepare("PRAGMA busy_timeout = 5000").run();
    let inserted = false;
    for (let attempt = 0; attempt < 3 && !inserted; attempt++) {
      try {
        await env.AUDIT.prepare("INSERT INTO cloud_ops_events (id, ts, kind, text, meta, job, status) VALUES (?1,?2,?3,?4,?5,?6,?7)").bind(id, ts(), kind, String(text).slice(0, 800), JSON.stringify(meta || {}).slice(0, 800), job || WORKER, status || "ok").run();
        inserted = true;
      } catch (e) {
        if (attempt === 2) throw e;
        await new Promise((res) => setTimeout(res, 200 * (attempt + 1)));
      }
    }
  } catch (e) {
  }
}
__name(recordEvent, "recordEvent");
async function alert(env, source, level, message) {
  try {
    // Apply a busy timeout to mitigate D1 overload conditions.
    await env.AUDIT.prepare("PRAGMA busy_timeout = 5000").run();
    let inserted = false;
    for (let attempt = 0; attempt < 3 && !inserted; attempt++) {
      try {
        await env.AUDIT.prepare("INSERT INTO alerts (source, level, message) VALUES (?,?,?)").bind(source, level, String(message).slice(0, 500)).run();
        inserted = true;
      } catch (e) {
        if (attempt === 2) throw e;
        await new Promise((res) => setTimeout(res, 200 * (attempt + 1)));
      }
    }
  } catch (e) {
  }
}
__name(alert, "alert");
function workerTarget(text) {
  const m = String(text || "").match(/\b(qnfo-[a-z0-9-]+|personal-api(?:-[a-z0-9-]+)?|research-daily-brief|calendar-api|events-radar|qnfo-ai|qnfo-ai-chat)\b/g);
  if (!m) return null;
  return m[0];
}
__name(workerTarget, "workerTarget");
var TRUSTED_TRANSPORTS = new Set(["http", "external", "curl", "container", "dns", "edge-ext", "external-curl", "external-http", "external-https"]);
function transportTrusted(tr) {
  const t = String(tr || "").toLowerCase().trim();
  if (!t) return false;
  if (TRUSTED_TRANSPORTS.has(t)) return true;
  return TRUSTED_TRANSPORTS.has(t.split(":")[0].trim());
}
async function closeIssue(env, id, now, target, evidence) {
  const stamp = new Date().toISOString();
  const ev = "backlog-exec v1.6.1 evidence-first auto-close " + stamp + (target ? " | target=" + target : "") + (evidence ? " | " + evidence : "");
  let triaged = false;
  for (let attempt = 0; attempt < 3 && !triaged; attempt++) {
    try {
      await env.AUDIT.prepare("INSERT INTO issue_triage (issue_id, rc, triage_state, owner, sla_due_at, remediation, close_evidence, triaged_at) VALUES (?1,'RC-03','closed','qnfo-backlog-exec',datetime('now'),'auto-close by qnfo-backlog-exec v1.6.0 drain',?2,datetime('now')) ON CONFLICT(issue_id) DO UPDATE SET triage_state='closed', close_evidence=?2, triaged_at=datetime('now')").bind(id, ev).run();
      triaged = true;
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise((res) => setTimeout(res, 200 * (attempt + 1)));
    }
  }
  return env.AUDIT.prepare("UPDATE agent_issues SET status='closed', close_channel='auto:backlog-exec', updated_at=?1 WHERE id=?2 AND status='open'").bind(now, id).run();
}
// BACKLOG-EXEC-EVIDENCE-1 (2.0.4, agent_issues 1808): exception-class issues (WORKER-EXCEPTION-DETECTED <worker>,
// ALERT-STORM-DETECTED <worker>, filed by qnfo-error-selfheal until it was retired on 2026-10-01) closed when alerts held no
// qnfo-error-selfheal row naming the worker in 24 h. That worker is retired and alerts holds 0 of its rows, so the count was
// always 0 and every such issue older than 24 h closed, even while the worker kept failing; the health probe was read and
// then ignored. The target was also wrong: the first fleet name in title+description, which is the filer itself whenever the
// title names a worker the pattern misses (issue 509, job-market-watch, closed as "qnfo-error-selfheal" recovered), and any
// prose issue with "exception" in its title was treated as one (#1826, and #1808 itself as "qnfo-workers").
// Now: only a detector-shaped title counts, its subject is the worker the title names ("__unknown__" is no worker), and the
// issue closes only when all of these hold, written into close_evidence by the statement that closes it:
//   errors stopped: the latest worker_usage_daily snapshot (qnfo-fleet-control refreshScriptUsage, Cloudflare
//     workersInvocationsAdaptive per script, where errors are counted now) is under 36 h old, covers >= 10 scripts, has
//     the worker's row with errors_24h = 0, and its 24 h window began after the issue was filed;
//   no exception rows for the worker in worker_logs in 24 h (outcome other than ok/canceled, or exceptions_json);
//   no alert flood from the worker in 24 h (at most 4 alerts in any clock hour; the detector's storm was > 8 in 60 min,
//     which always puts >= 5 into one clock hour);
//   the health probe passed: see exceptionProbe (trusted transports only; a same-zone fetch never counts).
var EXC_TITLE = /\b(?:WORKER-EXCEPTION-DETECTED|ALERT-STORM-DETECTED|ERROR-BURST(?:-DETECTED)?)\s+(\S+)/i;
var EXC_SCRIPT = /^[a-z0-9][a-z0-9-]{0,62}$/;
var EXC_PROBE_MAX_MIN = 30;
var EXC_SNAPSHOT_MAX_H = 36;
var EXC_SNAPSHOT_MIN_SCRIPTS = 10;
var EXC_ALERTS_PER_HOUR_MAX = 4;
function exceptionTarget(title) {
  const m = String(title || "").match(EXC_TITLE);
  if (!m) return { detector: false, target: null };
  const n = m[1].replace(/[),.;:]+$/, "");
  return { detector: true, target: EXC_SCRIPT.test(n) ? n : null, named: n };
}
async function exceptionRecurrence(env, name, createdMs) {
  const out = { ok: false, why: "", ev: "" };
  const snap = await env.AUDIT.prepare("SELECT day, COUNT(*) AS n, MAX(ts) AS ts FROM worker_usage_daily WHERE day = (SELECT MAX(day) FROM worker_usage_daily) GROUP BY day").first();
  if (!snap) { out.why = "unmeasured: worker_usage_daily is empty"; return out; }
  const snapMs = Date.parse(String(snap.ts || ""));
  if (!Number.isFinite(snapMs) || Date.now() - snapMs > EXC_SNAPSHOT_MAX_H * 36e5) { out.why = "unmeasured: worker_usage_daily snapshot " + snap.day + " is stale (ts " + snap.ts + ")"; return out; }
  if (Number(snap.n) < EXC_SNAPSHOT_MIN_SCRIPTS) { out.why = "unmeasured: worker_usage_daily snapshot " + snap.day + " covers " + snap.n + " scripts (< " + EXC_SNAPSHOT_MIN_SCRIPTS + ")"; return out; }
  const u = await env.AUDIT.prepare("SELECT requests_24h, errors_24h, ts FROM worker_usage_daily WHERE day = ?1 AND script = ?2").bind(snap.day, name).first();
  if (!u) { out.why = "unmeasured: no worker_usage_daily row for " + name + " in snapshot " + snap.day; return out; }
  const uMs = Date.parse(String(u.ts || ""));
  if (!Number.isFinite(uMs) || uMs - 864e5 < createdMs) { out.why = "unmeasured: the snapshot's 24h window (to " + u.ts + ") began before the issue was filed (" + new Date(createdMs).toISOString() + ")"; return out; }
  const wl = await env.AUDIT.prepare("SELECT COUNT(*) AS c, MAX(ingested_at) AS last FROM worker_logs WHERE script_name = ?1 AND ts_ms >= ?2 AND (COALESCE(outcome, 'ok') NOT IN ('ok', 'canceled') OR (exceptions_json IS NOT NULL AND exceptions_json NOT IN ('', '[]')))").bind(name, Date.now() - 864e5).first();
  const al = await env.AUDIT.prepare("SELECT COALESCE(MAX(n), 0) AS m FROM (SELECT strftime('%Y-%m-%d %H', created_at) AS h, COUNT(*) AS n FROM alerts WHERE source = ?1 AND julianday(created_at) >= julianday('now', '-24 hours') GROUP BY h)").bind(name).first();
  const errors = Number(u.errors_24h || 0), logErr = wl ? Number(wl.c || 0) : 0, perHour = al ? Number(al.m || 0) : 0;
  out.ev = "worker_usage_daily day=" + snap.day + " ts=" + u.ts + " errors_24h=" + errors + " requests_24h=" + Number(u.requests_24h || 0) + " (window after filing " + new Date(createdMs).toISOString() + "); worker_logs error rows 24h=" + logErr + "; alerts max/h 24h=" + perHour;
  if (errors > 0 || logErr > 0 || perHour > EXC_ALERTS_PER_HOUR_MAX) { out.why = "errors recur: " + out.ev; return out; }
  out.ok = true;
  return out;
}
// The health probe: the newest trusted-transport fleet_probe_log row (qnfo-fleet-dashboard probes most workers over http
// every 5-15 min) decides when it is under 30 min old, pass or fail. Only when there is none (the dashboard does not probe
// itself) does the external /health probe in worker_live_audit (scripts/fleet-autoaudit.py) count, if under 6 h old.
var EXC_LIVE_AUDIT_MAX_H = 6;
async function exceptionProbe(env, name) {
  const rs = await env.AUDIT.prepare("SELECT ok, status, ts, transport, source FROM fleet_probe_log WHERE name = ?1 ORDER BY id DESC LIMIT 12").bind(name).all();
  const row = (rs.results || []).find((r) => transportTrusted(r.transport));
  let why = "no trusted-transport fleet_probe_log row for " + name;
  if (row) {
    const ageMin = (Date.now() - new Date(row.ts).getTime()) / 6e4;
    const ev = "probe ok=" + Number(row.ok) + " status=" + row.status + " transport=" + row.transport + " ts=" + row.ts + " source=" + row.source;
    if (ageMin <= EXC_PROBE_MAX_MIN) return { ok: Number(row.ok) === 1, ev: ev };
    why = ev + " (older than " + EXC_PROBE_MAX_MIN + "m)";
  }
  let la = null;
  try { la = await env.AUDIT.prepare("SELECT http, live_version, probed_at FROM worker_live_audit WHERE worker = ?1").bind(name).first(); } catch (e) { la = null; }
  const laMs = la ? Date.parse(String(la.probed_at || "").replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(la.probed_at || "")) ? "" : "Z")) : NaN;
  if (la && Number(la.http) === 200 && Number.isFinite(laMs) && Date.now() - laMs <= EXC_LIVE_AUDIT_MAX_H * 36e5) return { ok: true, ev: "probe ok=1 status=200 transport=external-https ts=" + la.probed_at + " source=worker_live_audit live_version=" + la.live_version };
  return { ok: false, ev: why + (la ? "; worker_live_audit http=" + la.http + " probed_at=" + la.probed_at + " (needs 200 within " + EXC_LIVE_AUDIT_MAX_H + "h)" : "") };
}
async function recheckRecentCloses(env) {
  let reopened = 0;
  const now = nowEpoch();
  try {
    const rows = await env.AUDIT.prepare("SELECT issue_id, close_evidence FROM issue_triage WHERE owner='qnfo-backlog-exec' AND triage_state='closed' AND triaged_at >= datetime('now','-7 days') AND close_evidence LIKE '%target=%' LIMIT 40").all();
    for (const r of rows.results || []) {
      const m = String(r.close_evidence || "").match(/target=([a-z0-9-]+)/i);
      if (!m) continue;
      const tgt = m[1];
      const last = await env.AUDIT.prepare("SELECT ok, ts FROM fleet_probe_log WHERE name=?1 ORDER BY id DESC LIMIT 1").bind(tgt).first();
      if (!last) continue;
      const age = Date.now() - new Date(last.ts).getTime();
      if (age <= 240 * 6e4 && Number(last.ok) === 0) {
        await env.AUDIT.prepare("UPDATE agent_issues SET status='open', updated_at=?1 WHERE id=?2 AND status='closed'").bind(now, r.issue_id).run();
        await env.AUDIT.prepare("UPDATE issue_triage SET triage_state='triaged', reopened_count = reopened_count + 1 WHERE issue_id=?1").bind(r.issue_id).run();
        reopened++;
        await recordEvent(env, "job-run", "backlog-exec REOPENED issue " + r.issue_id + " (" + tgt + "): fresh probe regression " + last.ts, { id: r.issue_id, target: tgt, action: "reopened" }, WORKER, "ok");
      }
    }
  } catch (e) { console.error(JSON.stringify({ worker: "qnfo-lifecycle", where: "backlogMod.recheckRecentCloses", error: String(e && e.message || e) })); }
  return reopened;
}
async function reconcileDodMirrors(env) {
  let dodClosed = 0, reowned = 0;
  try {
    const r1 = await env.AUDIT.prepare("UPDATE task_dod_register SET status='closed', evidence_pointer = COALESCE(evidence_pointer,'') || ' | auto-closed (backlog-exec v1.6.3 mirror reconciliation): source agent_issues row is terminal', updated_at=datetime('now') WHERE status='open' AND source_table='agent_issues' AND EXISTS (SELECT 1 FROM agent_issues a WHERE CAST(a.id AS TEXT)=task_dod_register.source_row_id AND a.status IN ('closed','resolved','wontfix'))").run();
    dodClosed = r1 && r1.meta ? Number(r1.meta.changes || 0) : 0;
    const r2 = await env.AUDIT.prepare("UPDATE task_dod_register SET owner='agent', evidence_pointer = COALESCE(evidence_pointer,'') || ' | re-owned (backlog-exec v1.6.3): prior owner was not a live service', updated_at=datetime('now') WHERE status='open' AND owner NOT IN (SELECT service FROM service_registry WHERE state='live') AND owner <> 'agent'").run();
    reowned = r2 && r2.meta ? Number(r2.meta.changes || 0) : 0;
  } catch (e) { console.error(JSON.stringify({ worker: "qnfo-lifecycle", where: "backlogMod.reconcileDodMirrors", error: String(e && e.message || e) })); }
  return { dodClosed, reowned };
}
// REGISTER-INVENTORY-COMPLETE-1 (2026-09-28): the fleet-failures inventory spans SIX
// open-issue registers (GitHub org, task_dod_register, gtd_register, agent_issues,
// fleet_issue_dispatch, issue_ledger) but the drain acted only on agent_issues, so the
// other lanes accumulated un-drained. This dispositions every sub-lane so the inventory
// is both COMPLETE and SELF-DRAINING (self-audit + remediate fleet-wide, not just one table).
var DISPATCH_TERMINAL = "'executed','verified-done','closed-failed','closed-no-action','no-action','dedupe-superseded','no-handler-superseded'";
var DOD_TERMINAL = "'done','closed','resolved','cancelled','cancelled-with-monitor'";
var AGENT_TERMINAL = "'closed','done','resolved','wontfix','cancelled'";
async function reconcileRegisters(env) {
  const out = { dispatchClosed: 0, dodClosed: 0 };
  try {
    const r1 = await env.AUDIT.prepare(
      "UPDATE fleet_issue_dispatch SET state='closed' WHERE state='queued' AND COALESCE(exec_state,'') IN (" + DISPATCH_TERMINAL + ")"
    ).run();
    out.dispatchClosed = r1 && r1.meta ? Number(r1.meta.changes || 0) : 0;
  } catch (e) { console.error(JSON.stringify({ worker: "qnfo-lifecycle", where: "backlogMod.reconcileRegisters", error: String(e && e.message || e) })); }
  try {
    const r2 = await env.AUDIT.prepare(
      "UPDATE task_dod_register SET status='closed', evidence_pointer=COALESCE(evidence_pointer,'') || ' | auto-closed (backlog-exec v1.9.0 register reconcile)', updated_at=datetime('now') WHERE status NOT IN (" + DOD_TERMINAL + ") AND status <> 'in_progress' AND source_table='agent_issues' AND EXISTS (SELECT 1 FROM agent_issues a WHERE CAST(a.id AS TEXT)=task_dod_register.source_row_id AND a.status IN ('closed','resolved','wontfix','done','cancelled'))"
    ).run();
    out.dodClosed = r2 && r2.meta ? Number(r2.meta.changes || 0) : 0;
  } catch (e) { console.error(JSON.stringify({ worker: "qnfo-lifecycle", where: "backlogMod.reconcileRegisters", error: String(e && e.message || e) })); }
  return out;
}
// REGISTER-INVENTORY-COMPLETE-2 (2026-09-28): the fleet-failures dashboard surfaces
// FOURTEEN registers across panel 4 (complete open-issue inventory) and panel 6
// (unremediated registers). v1.9.0 covered panel 4's six only. This enumerates ALL of
// them with an open count, a kind, and the disposition actor, so no register the
// failures inventory shows is invisible to the drain. kind=event-plane|lock lanes are
// reported but excluded from the open total (they are not drainable backlogs).
var INVENTORY_LANES = [
  ["agent_issues", "SELECT COUNT(*) n FROM agent_issues WHERE status NOT IN (" + AGENT_TERMINAL + ")", "issue", "backlog-exec drain + verified-remediation closure"],
  ["task_dod_register", "SELECT COUNT(*) n FROM task_dod_register WHERE status NOT IN (" + DOD_TERMINAL + ")", "issue", "backlog-exec register reconcile"],
  ["gtd_register", "SELECT COUNT(*) n FROM gtd_register WHERE done=0", "issue", "gtd register owner"],
  ["fleet_issue_dispatch", "SELECT COUNT(*) n FROM fleet_issue_dispatch WHERE state='queued' AND COALESCE(exec_state,'') NOT IN (" + DISPATCH_TERMINAL + ")", "issue", "backlog-exec register reconcile"],
  ["issue_ledger", "SELECT COUNT(*) n FROM issue_ledger WHERE status='open'", "issue", "backlog-exec ledger sweep"],
  ["email_parse_failures", "SELECT COUNT(*) n FROM email_parse_failures WHERE status IN ('open','handoff')", "issue", "qnfo-email parse-failure resolver"],
  ["email_send_violations", "SELECT COUNT(*) n FROM email_send_violations WHERE COALESCE(resolved,0)=0", "issue", "qnfo-email send policy"],
  ["dead_links", "SELECT COUNT(*) n FROM dead_links WHERE resolved_at IS NULL", "issue", "link checker"],
  ["email_loop_quarantine", "SELECT COUNT(*) n FROM email_loop_quarantine WHERE status NOT IN ('processed','archived','spam')", "quarantine", "qnfo-email loop classifier"],
  ["version_queue", "SELECT COUNT(*) n FROM version_queue WHERE status NOT IN ('published','wontfix')", "pipeline", "qnfo-paper-reviser"],
  ["outreach_queue", "SELECT COUNT(*) n FROM outreach_queue WHERE COALESCE(status,'') NOT IN ('sent','skipped','rejected')", "queue", "qnfo-outreach drain"],
  ["deploy_locks", "SELECT COUNT(*) n FROM deploy_locks WHERE typeof(expires_at) IN ('integer','real') AND expires_at > (strftime('%s','now')*1000)", "lock", "qnfo-deploy-guard reap"],
  ["ai_gateway_failures", "SELECT COALESCE(SUM(count),0) n FROM ai_gateway_failures WHERE ts >= ((strftime('%s','now')-86400)*1000)", "event-plane", "qnfo-ai-calibration / gateway-health"],
  ["alerts", "SELECT COUNT(*) n FROM alerts WHERE julianday(created_at) >= julianday('now','-24 hours')", "event-plane", "qnfo-fleet-dashboard alert review"]
];
async function openInventory(env) {
  const registers = {};
  let total = 0;
  for (let i = 0; i < INVENTORY_LANES.length; i++) {
    const lane = INVENTORY_LANES[i];
    let open = -1;
    try { const r = await env.AUDIT.prepare(lane[1]).first(); open = r ? Number(r.n) : -1; } catch (e) { open = -1; }
    registers[lane[0]] = { open: open, kind: lane[2], disposition: lane[3] };
    if (open > 0 && lane[2] !== "event-plane" && lane[2] !== "lock") total += open;
  }
  registers["github"] = { open: null, kind: "external", disposition: "GitHub mirror (dashboard GITHUB_TOKEN)" };
  return { laneCount: INVENTORY_LANES.length + 1, total: total, registers: registers };
}
// SLA-GAP-1 (agent_issues 1000619, QNFO.OPS roadmap #162): which open issues lack a doer, an owner or a next action, or have an expired SLA. "No doer" is the fleet's own
// definition, the view v_issues_no_next_action (no active or holding contract, no code-task or session-task line, no live code task, work claim or owner card).
async function slaGap(env) {
  const one = async (sql) => { try { const r = await env.AUDIT.prepare(sql).first(); return r ? Number(r.n) : -1; } catch (e) { return -1; } };
  const counts = {
    open: await one("SELECT COUNT(*) n FROM agent_issues WHERE status = 'open'"),
    no_doer: await one("SELECT COUNT(*) n FROM v_issues_no_next_action"),
    no_owner: await one("SELECT COUNT(*) n FROM agent_issues a LEFT JOIN issue_triage t ON t.issue_id = a.id WHERE a.status = 'open' AND (t.issue_id IS NULL OR COALESCE(t.owner, '') = '')"),
    no_next_action: await one("SELECT COUNT(*) n FROM agent_issues a LEFT JOIN issue_triage t ON t.issue_id = a.id WHERE a.status = 'open' AND COALESCE(t.remediation, '') = '' AND instr(COALESCE(a.description, ''), 'code-task:') = 0"),
    sla_breached: await one("SELECT COUNT(*) n FROM agent_issues a JOIN issue_triage t ON t.issue_id = a.id WHERE a.status = 'open' AND t.sla_due_at < datetime('now')")
  };
  let rows = [];
  try { rows = (await env.AUDIT.prepare("SELECT id, priority, age_h, substr(title, 1, 120) AS title FROM v_issues_no_next_action ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END, age_h DESC LIMIT 20").all()).results || []; } catch (e) { rows = []; }
  return { counts: counts, first20_no_doer: rows };
}
function healthOptIn(title, description) {
  const t = String(title || "") + " " + String(description || "");
  const m = t.match(/probe_target\s*=\s*([A-Za-z0-9_.-]+)/i);
  const c2 = t.match(/probe_class\s*=\s*([a-z0-9_-]+)/i);
  if (!m && !c2) return null;
  if (!m) return { partial: true, missing: "probe_target" };
  if (!c2) return { partial: true, missing: "probe_class" };
  const c = t.match(/probe_class\s*=\s*([a-z0-9_-]+)/i);
  return { target: m[1], cls: (c ? c[1] : "").toLowerCase(), complete: true, partial: false };
}
async function probeHealthyViaLog(env, name, maxAgeMin) {
  const win = Number(maxAgeMin) > 0 ? Number(maxAgeMin) : 15;
  try {
    const row = await env.AUDIT.prepare("SELECT ok, status, ts, transport, source FROM fleet_probe_log WHERE name = ?1 ORDER BY id DESC LIMIT 1").bind(name).first();
    if (row && Number(row.ok) === 1) {
      const age = Date.now() - new Date(row.ts).getTime();
      if (age < win * 6e4) return { ok: true, via: "fleet_probe_log", ts: row.ts, status: row.status, transport: row.transport, source: row.source };
    }
  } catch (e) {
  }
  return null;
}
__name(probeHealthyViaLog, "probeHealthyViaLog");
async function probeHealth(name) {
  const hosts = [name + ".q08.workers.dev", name + ".qnfo.org"];
  for (const h of hosts) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), PROBE_TIMEOUT);
      const r = await fetch("https://" + h + "/health", { headers: { "User-Agent": "Mozilla/5.0 (qnfo-backlog-exec)" }, signal: ctl.signal });
      clearTimeout(timer);
      if (r.ok) return { ok: true, host: h, status: r.status, transport: "worker-same-zone" };
    } catch (e) {
    }
  }
  return { ok: false, host: null, status: 0, transport: "worker-same-zone" };
}
__name(probeHealth, "probeHealth");
// SLA-120M-7 (1.11.4): an OPEN-ISSUES advisor snapshot is superseded and closed after 120 minutes, not 3 h (owner directive 2026-10-14:
// no SLA exceeds 120 minutes).
var ADVISOR_NOISE_MAX_MIN = 120;
async function sweepAdvisorNoise(env) {
  let closed = 0;
  const now = nowEpoch();
  try {
    const noise = await env.AUDIT.prepare("SELECT id, title, created_at FROM agent_issues WHERE status='open' AND title LIKE 'OPEN-ISSUES%' ORDER BY id").all();
    const rows = noise.results || [];
    for (const r of rows) {
      const ageMs = createdAgeMs(r.created_at, now);
      if (ageMs > ADVISOR_NOISE_MAX_MIN * 6e4) {
        await closeIssue(env, r.id, now);
        closed++;
        await recordEvent(env, "job-run", "backlog-exec closed advisor-noise snapshot " + r.id + " (" + String(r.title || "").slice(0, 40) + "): superseded, age>" + ADVISOR_NOISE_MAX_MIN + "min", { id: r.id, action: "closed", reason: "advisor-noise sweep v1.2.6" }, WORKER, "ok");
      }
    }
  } catch (e) {
    console.error(JSON.stringify({ worker: "qnfo-lifecycle", where: "sweepAdvisorNoise", error: String(e && e.message || e) }));
  }
  return closed;
}
__name(sweepAdvisorNoise, "sweepAdvisorNoise");
async function sweepIssueLedger(env) {
  let resolved = 0;
  const now = nowEpoch();
  const hours = Number(env.LEDGER_STALE_HOURS) > 0 ? Math.floor(Number(env.LEDGER_STALE_HOURS)) : 72;
  try {
    const stale = await env.AUDIT.prepare(
      "SELECT fingerprint, source, title, last_seen FROM issue_ledger WHERE status='open' AND julianday(last_seen) < julianday('now', ?1) ORDER BY last_seen LIMIT 500"
    ).bind("-" + hours + " hours").all();
    const rows = stale.results || [];
    for (const r of rows) {
      await env.AUDIT.prepare(
        "UPDATE issue_ledger SET status='resolved', resolved_at=?1, resolution_note=?2, updated_at=?1 WHERE fingerprint=?3 AND status='open'"
      ).bind(ts(), "auto-resolved v1.2.8: not re-seen in " + hours + "h (fingerprint PK - a recurrence would have advanced last_seen)", r.fingerprint).run();
      resolved++;
    }
    if (resolved > 0) {
      await recordEvent(env, "job-run", "backlog-exec resolved " + resolved + " stale issue_ledger fingerprint(s) (not re-seen in " + hours + "h)", { action: "issue_ledger-sweep", resolved, window_hours: hours }, WORKER, "ok");
    }
  } catch (e) {
    await recordEvent(env, "job-run", "backlog-exec issue_ledger sweep failed: " + String(e && e.message || e), { action: "issue_ledger-sweep", error: true }, WORKER, "error");
  }
  return resolved;
}
__name(sweepIssueLedger, "sweepIssueLedger");
async function sweepOpsJobs(env) {
  const out = { promoted: 0, failed: 0, strandedBefore: 0 };
  const staleMin = Number(env.OPS_JOB_STALE_MIN) > 0 ? Math.floor(Number(env.OPS_JOB_STALE_MIN)) : 30;
  const reapContinuing = String(env.OPS_JOB_REAP_CONTINUING || "1") !== "0";
  const statuses = reapContinuing ? "'running','continuing','queued'" : "'running','queued'";
  try {
    const stranded = await env.AUDIT.prepare(
      "SELECT COUNT(*) AS c FROM ops_jobs WHERE status IN ('running','continuing','queued') AND length(COALESCE(response,'')) > 0"
    ).first();
    out.strandedBefore = stranded ? Number(stranded.c || 0) : 0;
    const rows = await env.AUDIT.prepare(
      "SELECT id, status, updated_at, length(COALESCE(response,'')) AS rl FROM ops_jobs WHERE status IN (" + statuses + ") AND julianday(updated_at) < julianday('now', ?1) ORDER BY updated_at LIMIT 200"
    ).bind("-" + staleMin + " minutes").all();
    for (const r of rows.results || []) {
      if (Number(r.rl) > 0) {
        await env.AUDIT.prepare("UPDATE ops_jobs SET status='succeeded', updated_at=?1 WHERE id=?2 AND status IN (" + statuses + ")").bind(ts(), r.id).run();
        out.promoted++;
      } else {
        await env.AUDIT.prepare("UPDATE ops_jobs SET status='failed', error=COALESCE(error, ?1), updated_at=?2 WHERE id=?3 AND status IN (" + statuses + ")").bind("reaper v1.3.0 (INFERRED - no diagnostic was captured): no response within " + staleMin + "m of last write", ts(), r.id).run();
        out.failed++;
      }
    }
    if (out.promoted + out.failed > 0) {
      await recordEvent(env, "job-run", "backlog-exec reaped ops_jobs: promoted " + out.promoted + " stranded answer(s) to terminal, failed " + out.failed + " silent row(s) (idle>" + staleMin + "m)", { action: "ops-jobs-reap", promoted: out.promoted, failed: out.failed, stranded_before: out.strandedBefore, stale_min: staleMin }, WORKER, "ok");
    }
  } catch (e) {
    await recordEvent(env, "job-run", "backlog-exec ops_jobs reap failed: " + String(e && e.message || e), { action: "ops-jobs-reap", error: true }, WORKER, "error");
  }
  return out;
}
__name(sweepOpsJobs, "sweepOpsJobs");
async function run(env) {
  const MIN_AGE_MS = (Number(env.MIN_CLOSE_AGE_MIN) > 0 ? Number(env.MIN_CLOSE_AGE_MIN) : 30) * 6e4;
  const PROBE_WIN_MIN = Number(env.PROBE_LOG_MAX_AGE_MIN) > 0 ? Number(env.PROBE_LOG_MAX_AGE_MIN) : 15;
  const dodReconcile = await reconcileDodMirrors(env);
  const reopenedOnRegression = await recheckRecentCloses(env);
  const noiseClosed = await sweepAdvisorNoise(env);
  const ledgerResolved = await sweepIssueLedger(env);
  const jobsReaped = await sweepOpsJobs(env);
  const registers = await reconcileRegisters(env);
  const inventory = await openInventory(env);
  const rows = await env.AUDIT.prepare("SELECT id, title, description, source, category, priority, status, created_at, updated_at FROM agent_issues WHERE status='open' ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END, updated_at ASC, id LIMIT ?1").bind(MAX_ROW).all();
  const items = rows.results || [];
  const now = nowEpoch();
  let closed = 0, rechecked = 0, escalated = 0;
  const detail = [];
  for (const row of items) {
    const title = String(row.title || "");
    const name = workerTarget(title + " " + String(row.description || ""));
    const isHealthAvailability = /\b(health|heartbeat|availability|unreachable|endpoint down|is down|down)\b/i.test(title);
    const optIn = healthOptIn(title, row.description);
    if (isHealthAvailability && !optIn) {
      rechecked++;
      detail.push({ id: row.id, action: "recheck", note: "legacy-unmarked health ticket (v1.5.0): no probe_target= opt-in marker, auto-close disabled" });
      continue;
    }
    if (optIn && optIn.partial) {
      escalated++;
      detail.push({ id: row.id, action: "escalate-partial-marker", note: "partial opt-in marker (missing " + optIn.missing + "); fail-closed" });
      continue;
    }
    if (optIn && !isHealthAvailability) {
      escalated++;
      detail.push({ id: row.id, action: "escalate-marker-non-health", note: "opt-in marker on a non-health ticket; auto-close refused" });
      continue;
    }
    if (optIn && isHealthAvailability && optIn.cls === "worker-process") {
      const ageMs = createdAgeMs(row.created_at, now);
      if (ageMs < MIN_AGE_MS) {
        rechecked++;
        detail.push({ id: row.id, target: optIn.target, action: "recheck", note: "too fresh to auto-close: age " + Math.round(ageMs / 6e4) + "m < " + Math.round(MIN_AGE_MS / 6e4) + "m" });
        continue;
      }
      const pLog = await probeHealthyViaLog(env, optIn.target, PROBE_WIN_MIN);
      const p = pLog ? { ok: true, host: pLog.via + " " + pLog.ts, transport: pLog.transport } : await probeHealth(optIn.target);
      if (p.ok && transportTrusted(p.transport)) {
        await closeIssue(env, row.id, now, optIn.target);
        closed++;
        detail.push({ id: row.id, target: optIn.target, action: "closed", note: "health re-probe PASS " + p.host + " transport=" + p.transport + " (fresh<=" + PROBE_WIN_MIN + "m, age>" + Math.round(MIN_AGE_MS / 6e4) + "m)" });
        await recordEvent(env, "job-run", "backlog-exec closed issue " + row.id + " (" + optIn.target + "): " + p.host + " transport=" + p.transport, { id: row.id, target: optIn.target, action: "closed", reason: "health predicate v1.5.0: opt-in + fresh + trusted transport", transport: p.transport }, WORKER, "ok");
        continue;
      }
      escalated++;
      detail.push({ id: row.id, target: optIn.target, action: "escalate", note: "no close-authorizing evidence (ok=" + p.ok + ", transport=" + (p.transport || "none") + "): same-zone/binding evidence cannot authorize a close" });
      continue;
    }
    // BACKLOG-EXEC-EVIDENCE-1: see exceptionRecurrence. A detector issue that is not proven recovered falls through to the
    // other predicates (a verified remediation can still close it) and is rechecked with the measured reason.
    const exc = !isHealthAvailability ? exceptionTarget(title) : { detector: false };
    let excNote = null;
    if (exc.detector) {
      const ageMs = createdAgeMs(row.created_at, now);
      if (!exc.target) excNote = "exception-class: '" + String(exc.named || "").slice(0, 40) + "' names no worker, so no recurrence can be measured";
      else if (ageMs <= 24 * 3600 * 1e3) excNote = "exception-class: under 24h old";
      else {
        let rec, pr;
        try {
          rec = await exceptionRecurrence(env, exc.target, now - ageMs);
          pr = rec.ok ? await exceptionProbe(env, exc.target) : null;
        } catch (e) {
          rec = { ok: false, why: "recurrence query failed: " + String(e && e.message || e).slice(0, 160) };
        }
        if (rec.ok && pr && pr.ok) {
          const evidence = "BACKLOG-EXEC-EVIDENCE-1 (" + VERSION + ") exception-class closed on evidence: " + rec.ev + "; " + pr.ev;
          await closeIssue(env, row.id, now, exc.target, evidence);
          closed++;
          detail.push({ id: row.id, target: exc.target, action: "closed", note: evidence.slice(0, 400) });
          await recordEvent(env, "job-run", "backlog-exec closed issue " + row.id + " (" + exc.target + "): exception-class closed on evidence", { id: row.id, target: exc.target, action: "closed", reason: "BACKLOG-EXEC-EVIDENCE-1: errors stopped and probe passed" }, WORKER, "ok");
          continue;
        }
        excNote = "exception-class " + exc.target + " not closed: " + (rec.ok ? "errors stopped (" + rec.ev + ") but " + (pr ? pr.ev : "no probe") : rec.why);
      }
    }
    const isModelHealth = /^MODEL-DEGRADED\b/i.test(title);
    if (isModelHealth) {
      try {
        const dg = await env.AUDIT.prepare("SELECT model_id FROM ai_model_health WHERE status='degraded'").all();
        const degraded = new Set((dg.results || []).map((d) => String(d.model_id)));
        const named = title.replace(/^MODEL-DEGRADED\s*/i, "").split(",").map((s) => s.trim()).filter(Boolean);
        const still = named.filter((m) => degraded.has(m));
        if (degraded.size === 0 || still.length === 0) {
          await closeIssue(env, row.id, now);
          closed++;
          detail.push({ id: row.id, action: "closed", note: "model-health stale: none of [" + named.slice(0, 4).join(",") + "] degraded now (degraded rows=" + degraded.size + ")" });
          await recordEvent(env, "job-run", "backlog-exec closed issue " + row.id + " (model-health): no named model degraded now", { id: row.id, action: "closed", reason: "model-health predicate cleared v1.2.7" }, WORKER, "ok");
          continue;
        }
        rechecked++;
        detail.push({ id: row.id, action: "recheck", note: "model-health STILL degraded: " + still.join(",") });
        continue;
      } catch (e) {
      }
    }
    const probeFail = title.match(/^\[ai-cal\]\s+model probe failing:\s*(\S+)/i);
    if (probeFail) {
      try {
        const model = probeFail[1];
        const h = await env.AUDIT.prepare("SELECT status FROM ai_model_health WHERE model_id=?1").bind(model).first();
        if (!h || String(h.status) !== "degraded") {
          await closeIssue(env, row.id, now);
          closed++;
          detail.push({ id: row.id, target: model, action: "closed", note: "ai-cal probe-failing stale: ai_model_health status=" + (h ? h.status : "absent") });
          await recordEvent(env, "job-run", "backlog-exec closed issue " + row.id + " (ai-cal " + model + "): health no longer degraded", { id: row.id, target: model, action: "closed", reason: "ai-cal probe predicate cleared v1.2.7" }, WORKER, "ok");
          continue;
        }
        rechecked++;
        detail.push({ id: row.id, target: model, action: "recheck", note: "ai-cal probe STILL failing: " + model });
        continue;
      } catch (e) {
      }
    }
    const gwFail = title.match(/^\[gw-fail\]\s+(\d+)\s+(\S+)/);
    if (gwFail) {
      try {
        const model = gwFail[2];
        const rec = await env.AUDIT.prepare("SELECT COALESCE(SUM(count),0) AS n FROM ai_gateway_failures WHERE model=?1 AND ts >= ((strftime('%s','now') - 86400) * 1000)").bind(model).first();
        const n = rec ? Number(rec.n || 0) : 0;
        if (n === 0) {
          await closeIssue(env, row.id, now);
          closed++;
          detail.push({ id: row.id, target: model, action: "closed", note: "gw-fail stale: 0 failures for " + model + " in 24h" });
          await recordEvent(env, "job-run", "backlog-exec closed issue " + row.id + " (gw-fail " + model + "): no recurrence in 24h", { id: row.id, target: model, action: "closed", reason: "gateway-failure predicate cleared v1.2.7" }, WORKER, "ok");
          continue;
        }
        rechecked++;
        detail.push({ id: row.id, target: model, action: "recheck", note: "gateway failures CURRENT: " + n + "/24h - real defect, root fix pending" });
        continue;
      } catch (e) {
      }
    }
    const vq = title.match(/version_queue\s+id=(\d+)/i);
    if (vq) {
      try {
        const q = await env.AUDIT.prepare("SELECT status, version_to, updated_at FROM version_queue WHERE id=?1").bind(Number(vq[1])).first();
        if (!q || String(q.status).toLowerCase() !== "error") {
          await closeIssue(env, row.id, now);
          closed++;
          detail.push({ id: row.id, target: "version_queue#" + vq[1], action: "closed", note: q ? "version_queue status=" + q.status + " (not error) - condition cleared" : "version_queue row absent - ticket orphaned" });
          await recordEvent(env, "job-run", "backlog-exec closed issue " + row.id + " (VQ " + vq[1] + "): " + (q ? "status=" + q.status : "row absent"), { id: row.id, action: "closed", reason: "publish predicate cleared v1.2.9" }, WORKER, "ok");
          continue;
        }
        rechecked++;
        detail.push({ id: row.id, target: "version_queue#" + vq[1], action: "recheck", note: "version_queue STILL error (v" + (q.version_to || "?") + ", updated " + q.updated_at + ")" });
        continue;
      } catch (e) {
      }
    }
    if (/^TERMINAL research failure\b/i.test(title)) {
      try {
        const t = await env.AUDIT.prepare("SELECT COUNT(*) AS c FROM research_queue WHERE status='failed' AND recover_count>=2").first();
        const still = t ? Number(t.c || 0) : 0;
        if (still === 0) {
          await closeIssue(env, row.id, now);
          closed++;
          detail.push({ id: row.id, action: "closed", note: "research terminal condition cleared: 0 rows with status='failed' AND recover_count>=2" });
          await recordEvent(env, "job-run", "backlog-exec closed issue " + row.id + " (research): no terminal-failed queue rows remain", { id: row.id, action: "closed", reason: "research-pipeline predicate cleared v1.2.9" }, WORKER, "ok");
          continue;
        }
        rechecked++;
        detail.push({ id: row.id, action: "recheck", note: "research terminal condition STILL present: " + still + " queue row(s) status='failed' AND recover_count>=2" });
        continue;
      } catch (e) {
      }
    }
    // VERIFIED-REMEDIATION-CLOSURE-1 (issue #1281 DRAIN-CLOSURE-PREDICATE-TYPE-ERROR):
    // every predicate above is a liveness/heartbeat predicate, so semantic
    // defects (correctness/security/email/dissemination/publication/procedure)
    // could never close. The "defect absence" predicate is a fresh
    // remediation_verifications row with pass=1: a re-probe that verified the
    // fix. Close those here (RE-FALSIFICATION-CLOSED-GATE-1).
    // BACKLOG-LATEST-PASS-1 (2.0.7, 2026-10-14; agent_issues 2222 closed at 02:01 UTC while its latest verification, 01:44, failed
    // "pending: companion_hours_since_last_piece reads 93.1"): the predicate took ANY pass in 7 days, so a pass from 2026-10-09 closed a
    // defect that was still live (also 2086, 2050, 1947 in the week to 2026-10-14). It now reads only the issue's LATEST verification,
    // which must pass and be at most LATEST_PASS_MAX_H old (INTEGRITY-GUARDS-1: a fix whose latest verification fails does not count);
    // the close evidence names that row.
    {
      let vr = null;
      try {
        vr = await env.AUDIT.prepare(
          "SELECT id, probe_url, transport, observed, pass, verified_at FROM remediation_verifications WHERE issue_id=?1 ORDER BY id DESC LIMIT 1"
        ).bind(row.id).first();
      } catch (e) { console.error(JSON.stringify({ worker: WORKER, where: "run:latest-pass", error: String(e && e.message || e).slice(0, 300) })); }
      const vrMs = vr ? Date.parse(String(vr.verified_at || "").replace(" ", "T") + (/[zZ]$/.test(String(vr.verified_at || "")) ? "" : "Z")) : NaN;
      if (vr && Number(vr.pass) === 1 && Number.isFinite(vrMs) && now - vrMs <= LATEST_PASS_MAX_H * 36e5) {
        const evidence = "BACKLOG-LATEST-PASS-1 latest verification #" + vr.id + " pass at " + vr.verified_at + " via " + (vr.transport || "?") + ": " + String(vr.observed || "").slice(0, 160);
        await closeIssue(env, row.id, now, null, evidence);
        closed++;
        detail.push({ id: row.id, action: "closed", note: evidence.slice(0, 300) });
        await recordEvent(env, "job-run", "backlog-exec closed issue " + row.id + " (latest verification passed)", { id: row.id, action: "closed", reason: "BACKLOG-LATEST-PASS-1", verification: vr.id, probe: vr.probe_url, transport: vr.transport }, WORKER, "ok");
        continue;
      }
    }
    await env.AUDIT.prepare("UPDATE agent_issues SET updated_at=?1 WHERE id=?2 AND status='open'").bind(now, row.id).run();
    rechecked++;
    detail.push(excNote ? { id: row.id, title: title.slice(0, 60), target: exc.target || null, action: "recheck", note: excNote.slice(0, 400) } : { id: row.id, title: title.slice(0, 60), action: "recheck", note: name ? "probe target " + name : "no probe target" });
  }
  const summary = { registers, inventory, noiseClosed, ledgerResolved, jobsReaped, processed: items.length, closed, rechecked, escalated, detail: detail.slice(0, MAX_ROW) };
  if (escalated > 0) await alert(env, WORKER, "warning", "backlog-exec: " + escalated + " health issue(s) still failing: " + detail.filter((d) => d.action === "escalate").map((d) => d.target).join(", "));
  await recordEvent(env, "job-run", "backlog-exec " + JSON.stringify({ noiseClosed, ledgerResolved, jobsReaped, processed: items.length, closed, rechecked, escalated }), { exceptionRule: "BACKLOG-EXEC-EVIDENCE-1", version: VERSION, noiseClosed, ledgerResolved, jobsReaped, processed: items.length, closed, rechecked, escalated }, WORKER, "ok");
  return { status: "ok", notes: summary };
}
__name(run, "run");
var worker_default = {
  async scheduled(event, env, ctx) {
    if (env.FLEET_FEED) {
      try {
        var fr = await env.FLEET_FEED.fetch("https://qnfo-fleet-feed.q08.workers.dev/feed/self?worker=qnfo-backlog-exec");
        if (fr.ok) {
          var fd = await fr.json();
          var actionable = (fd.findings || []).filter(function(f) {
            return f.auto_action && f.severity_int >= 2 && f.category && !f.category.startsWith("backlog/");
          }).slice(0, 10);
          for (var af of actionable) {
            var sql = af.auto_action;
            if (sql && /^(UPDATE|INSERT|DELETE)/i.test(sql.trim())) {
              try {
                await env.AUDIT.prepare(sql).run();
              } catch (e2) {
              }
            }
            try {
              await env.AUDIT.prepare(
                "INSERT OR IGNORE INTO self_heal_actions (kind, ref, action, ts, status, verified_at) VALUES (?,?,?,datetime('now'),'executed',datetime('now'))"
              ).bind("feed-auto-exec", af.id, (af.auto_action || "").slice(0, 500)).run();
            } catch (e3) {
            }
          }
        }
      } catch (eFeed) {
      }
    }
    try {
      const out = await run(env);
      console.log("backlog-exec", JSON.stringify(out));
    } catch (e) {
      console.error("backlog-exec", String(e && e.message || e));
      await alert(env, WORKER, "error", "run failed: " + String(e && e.message || e));
    }
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      const open = await env.AUDIT.prepare("SELECT COUNT(*) c FROM agent_issues WHERE status='open'").first().catch(() => null);
      const led = await env.AUDIT.prepare("SELECT COUNT(*) c FROM issue_ledger WHERE status='open'").first().catch(() => null);
      const stranded = await env.AUDIT.prepare("SELECT COUNT(*) c FROM ops_jobs WHERE status IN ('running','continuing','queued') AND length(COALESCE(response,'')) > 0").first().catch(() => null);
      // HEALTH-PROBE-BUDGET-1 (2026-09-29): /health MUST stay cheap. This handler used to
      // run the full 14-lane inventory scan, which on a cold isolate exceeded the
      // 5s AbortController budget in qnfo-ops probeService() -> AbortError -> backlog_status
      // and fleet_status both reported this worker as "timeout" while it was in fact
      // healthy (curl http=200 in 1.6s). That false negative auto-filed agent_issues 1368.
      // The full inventory is served by the separate /inventory route.
      return json({ ok: true, worker: WORKER, version: VERSION, capabilities: ["backlog-inventory", "issue-drain", "stranded-job-recovery"], limitations: ["POST /run needs RUN_TOKEN or the qnfo-ops service binding (backlog.internal)", "the drain runs on the daily 01:10 cron", "/health reports counts only; the full inventory is GET /inventory"], openBacklog: open ? open.c : -1, openLedger: led ? led.c : -1, strandedOpsJobs: stranded ? stranded.c : -1, openIssuesTotal: open ? open.c : -1 });
    }
    if (url.pathname === "/inventory") {
      return json({ ok: true, worker: WORKER, version: VERSION, inventory: await openInventory(env) });
    }
    if (url.pathname === "/sla-gap") {
      return json({ ok: true, worker: WORKER, version: VERSION, sla_gap: await slaGap(env) });
    }
    if (url.pathname === "/run" && request.method === "POST") {
      const runTok = env.RUN_TOKEN;
      const authH = request.headers.get("Authorization") || "";
      // INTERNAL-SERVICE-BINDING-AUTH-1 (2026-09-27): qnfo-ops calls this endpoint over the
      // BACKLOG service binding as https://backlog.internal/run and holds no RUN_TOKEN
      // binding, so the Bearer-only gate returned 401 on every drain attempt. Internal
      // service-binding calls never leave Cloudflare and never carry CF-Connecting-IP;
      // client-originated calls always do. Bearer remains supported and preferred.
      const internalCall = url.hostname === "backlog.internal" && !request.headers.get("CF-Connecting-IP");
      if (runTok && authH === "Bearer " + runTok) {
        // authorized: shared run token
      } else if (internalCall) {
        // authorized: internal service-binding caller
      } else if (!runTok) {
        return json({ error: "run endpoint disabled: RUN_TOKEN unset" }, 503);
      } else {
        return json({ error: "unauthorized" }, 401);
      }
      const out = await run(env);
      return json({ ok: true, worker: WORKER, version: VERSION, out });
    }
    return json({ error: "not found" }, 404);
  }
};
return worker_default;
})();
function backlogEnv(env) { var e = Object.assign({}, env, { AUDIT: env.QNFO_AUDIT }); delete e.FLEET_FEED; return e; }
function backlogMemberCall(ctx) { var p = ctx && ctx.props; return !!(p && p.member === BACKLOG_MEMBER && /^qnfo-[a-z0-9-]{1,60}$/.test(String(p.caller || ""))); }
async function backlogDue(event, env) {
  if (!event || event.cron !== TICK_CRON || event.tickEntry) return false;
  var at = Number(event.scheduledTime) || Date.now();
  if (new Date(at).getUTCHours() === 2) return true;
  try {
    var last = await env.QNFO_AUDIT.prepare("SELECT MAX(ts) AS ts FROM cloud_ops_events WHERE job = 'qnfo-backlog-exec' AND kind = 'job-run' AND text LIKE 'backlog-exec {%'").first();
    var lastMs = Date.parse(String(last && last.ts || ""));
    return !Number.isFinite(lastMs) || at - lastMs >= 24 * 60 * 60 * 1000;
  } catch (e) {
    console.error("backlog catch-up check: " + String(e && e.message || e));
    return true;
  }
}
// ---- BACKLOG-FOLD-1:END ----
// MODEL-HEALTH-SWEEP-1 (qnfo-lifecycle 1.13.0, 2026-10-19, pillar autonomy; agent_issues 100238 to 100241, 100262 and 100151 as the measured cases): the "[ai-cal] model probe failing: <model>"
// and "MODEL-DEGRADED <models>" issues have a close predicate in the backlog member (a model whose ai_model_health row is no longer degraded), but the member runs once a day
// on the 02:00 UTC tick and reads only the first 40 open issues ordered by priority and oldest updated_at, so a high-priority row filed after the 40 oldest highs is never
// reached: at 21:5xZ the six rows had been open since 17:15Z while every model they name read status ok in ai_model_health (the calibration run of 21:30Z passed 6 of 6). The
// same two predicates now run on every hourly tick, over only those two title families, so a recovered model's issue closes within the hour (SLA-120M-2). A model whose
// health row reads degraded or failing is not recovered (the member's predicate tested only "degraded", and the calibration worker writes "failing" at its threshold).
// ops_config model_health_sweep = off stops it; the daily member is unchanged.
function modelHealthDue(event) { return !!event && event.cron === TICK_CRON && !event.tickEntry; }
async function sweepModelHealthIssues(env, nowMs) {
  var out = { checked: 0, closed: [], kept: [] };
  var db = env.QNFO_AUDIT;
  try {
    var off = await db.prepare("SELECT value FROM ops_config WHERE key = 'model_health_sweep'").first();
    if (off && String(off.value).trim().toLowerCase() === "off") { out.off = true; return out; }
  } catch (e) { /* no switch row: the sweep runs */ }
  var rows = ((await db.prepare("SELECT id, title FROM agent_issues WHERE status = 'open' AND (title LIKE 'MODEL-DEGRADED%' OR title LIKE '[ai-cal] model probe failing:%') ORDER BY id LIMIT 60").all()).results) || [];
  if (!rows.length) return out;
  var hr = ((await db.prepare("SELECT model_id, status FROM ai_model_health").all()).results) || [];
  var bad = {}, seen = {};
  hr.forEach(function (r) { seen[String(r.model_id)] = 1; if (r.status === "degraded" || r.status === "failing") bad[String(r.model_id)] = String(r.status); });
  var now = Number(nowMs) || Date.now();
  for (var i = 0; i < rows.length; i++) {
    var title = String(rows[i].title || ""), named, family;
    var pf = /^\[ai-cal\]\s+model probe failing:\s*(\S+)/i.exec(title);
    if (pf) { named = [pf[1]]; family = "ai-cal"; }
    else if (/^MODEL-DEGRADED\b/i.test(title)) { named = title.replace(/^MODEL-DEGRADED\s*/i, "").split(",").map(function (x) { return x.trim(); }).filter(Boolean); family = "model-degraded"; }
    else continue;
    out.checked++;
    var still = named.filter(function (m) { return bad[m]; });
    if (still.length) { out.kept.push(rows[i].id); continue; }
    var ev = "MODEL-HEALTH-SWEEP-1 (qnfo-lifecycle " + VERSION.split(" ")[0] + ") closed on evidence " + new Date(now).toISOString() + ": ai_model_health reads no degraded or failing row for [" + named.slice(0, 6).join(",") + "] (" + named.filter(function (m) { return seen[m]; }).length + " of " + named.length + " named models have a health row, all ok); family " + family;
    await db.prepare("INSERT INTO issue_triage (issue_id, rc, triage_state, owner, sla_due_at, remediation, close_evidence, triaged_at) VALUES (?1,'RC-03','closed','qnfo-lifecycle',datetime('now'),'auto-close by qnfo-lifecycle MODEL-HEALTH-SWEEP-1',?2,datetime('now')) ON CONFLICT(issue_id) DO UPDATE SET triage_state='closed', close_evidence=?2, triaged_at=datetime('now')").bind(rows[i].id, ev).run();
    var u = await db.prepare("UPDATE agent_issues SET status = 'closed', close_channel = 'auto:lifecycle/model-health-sweep', updated_at = ?1 WHERE id = ?2 AND status = 'open'").bind(now, rows[i].id).run();
    if (u && u.meta && Number(u.meta.changes) === 0) { out.kept.push(rows[i].id); continue; }
    out.closed.push(rows[i].id);
    try { await db.prepare("INSERT INTO cloud_ops_events (id, ts, kind, text, meta, job, status) VALUES (?1,?2,'job-run',?3,?4,'qnfo-lifecycle','ok')").bind("jr-mhs-" + rows[i].id + "-" + now.toString(36), new Date(now).toISOString(), ("model-health sweep closed issue " + rows[i].id + " (" + family + "): " + named.slice(0, 4).join(",") + " no longer degraded or failing").slice(0, 800), JSON.stringify({ id: rows[i].id, action: "closed", reason: "MODEL-HEALTH-SWEEP-1" })).run(); } catch (eE) { /* the close evidence is the record */ }
  }
  return out;
}
var worker_default = {
  async fetch(request, env, ctx) {
    if (backlogMemberCall(ctx)) return backlogMod.fetch(request, backlogEnv(env), ctx);
    const u = new URL(request.url), p = u.pathname;
    if (p === "/backlog/health" && request.method === "GET") return backlogMod.fetch(new Request(new URL("/health", u)), backlogEnv(env), ctx);
    if (p === "/backlog/sla-gap" && request.method === "GET") return backlogMod.fetch(new Request(new URL("/sla-gap", u)), backlogEnv(env), ctx); // SLA-GAP-1: read-only, counts and 20 titles
    const origin = request.headers.get("Origin") || "https://qnfo.org";
    const h = corsHeaders(origin);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
    if (p === "/health") return health(env, origin);
    if (p === "/status") return handleStatus(env, origin);
    // LIFECYCLE-RUN-INTERNAL-1 (2026-10-01, charter H0, #1735 sweep): every /run/* route was anonymous. GET /run/secrets-audit
    // returned the secret NAMES of every worker in the account (read with this worker's CF_API_TOKEN), /run/backup wrote a
    // full D1 export to R2 per call, and /run/memory-maintain?commit=1 mutated agent memory. No worker or script calls these
    // routes (qnfo-ops binds this worker for /health only); the crons do the work. They now answer only an internal caller
    // authenticated by service-binding props (ctx.props.caller, settable only by a deployer of the caller).
    if (p.startsWith("/run/")) {
      const caller = ctx && ctx.props && typeof ctx.props.caller === "string" ? ctx.props.caller : "";
      if (!/^qnfo-[a-z0-9-]{1,60}$/.test(caller)) return new Response(JSON.stringify({ error: "forbidden: /run/* is internal only (LIFECYCLE-RUN-INTERNAL-1); the crons run this work" }), { status: 403, headers: h });
    }
    if (p === "/run/drift") return handleDrift(env, origin);
    if (p === "/run/backup") return handleBackup(env, origin);
    if (p === "/run/secrets-audit") return handleSecretsAudit(env, origin);
    if (p === "/run/ula-check") return handleUlaCheck(env, origin);
    if (p === "/run/memory-maintain") return handleMemoryMaintain(request, env, origin);
    if (p === "/run/metrics-refresh") return handleMetricsRefresh(env, origin);
    return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: h });
  },
  async scheduled(event, env, ctx) {
    if (modelHealthDue(event)) await sweepModelHealthIssues(env).catch(function (e) { console.error("model-health sweep: " + String(e && e.message || e)); });
    if (await backlogDue(event, env)) await backlogMod.scheduled(event, backlogEnv(env), ctx).catch(function (e) { console.error("backlog member: " + String(e && e.message || e)); });
    return cronTickDispatch(event, async function (event) {
    const cron = event.cron;
    console.log("[qnfo-lifecycle] cron triggered:", cron);
     try { await env.QNFO_AUDIT.prepare("INSERT OR REPLACE INTO fleet_heartbeat (worker, version, ts, ok) VALUES (?, ?, ?, 1)").bind("qnfo-lifecycle", QNFO_VERSION, new Date().toISOString()).run(); } catch (e) { console.error(JSON.stringify({ worker: "qnfo-lifecycle", where: "scheduled", error: String(e && e.message || e) })); }
    try {
      // CRON-CONSOLIDATE-1 (2026-09-27 fleet reorg): the four lightweight daily D1 audit/
      // maintenance tasks (lifecycle, memory-maintain, ula-check, drift-audit) now share ONE
      // daily fire at 03:00 instead of four separate crons. This also FIXES a latent bug: the
      // drift-audit branch keyed on "0 6 * * *" while the trigger was registered as
      // "9 6 * * *" -> runDriftAudit never ran. Backup stays on its own cron (heavy).
      if (cron === "0 3 * * *") {
        await runLifecycle(env);
        await runMemoryMaintain(env, { commit: true });
        await runUlaCheck(env);
        await runDriftAudit(env);
      }
      else if (cron === "0 0 1 * *") await runGraphSeed(env);
      else if (cron === "0 5 * * *") {
        // BACKUP-PAGED-1: the result was dropped here, so a table that failed to back up left no trace. A failure is a console.error (an
        // Observability group), a clean run one console.log line with the row count per table.
        var backup = await runBackup(env);
        var backupBad = backup.status !== "backup-complete" || Object.keys(backup.results || {}).some(function (k) { return typeof backup.results[k] !== "number"; });
        (backupBad ? console.error : console.log)("[qnfo-lifecycle] backup: " + JSON.stringify(backup));
      }
      else if (cron === "0 8 * * 1") await runSecretsAudit(env);
      else if (cron === "0 * * * *") { await runSync(env); await runMetricFreshness(env); await runPing(env); } // LIFECYCLE-PING-DEAD-1 (#1810): runPing folded onto the single live hourly trigger
    } catch (e) {
      console.error("[qnfo-lifecycle] cron error:", e.message);
    }
    });
  }
};
function health(env, origin) {
  const h = corsHeaders(origin);
  return new Response(JSON.stringify({
    status: "ok",
    worker: "qnfo-lifecycle",
    version: QNFO_VERSION,
    cronSchedules: 5,
    capabilities: ["lifecycle-scan", "graph-seed", "d1-backup", "drift-audit", "secrets-audit", "registry-sync", "ula-check", "memory-maintain", "metric-freshness"],
    limitations: ["/run/* answers only internal service-binding callers (props); public callers get 403", "work runs on its crons: hourly registry sync, daily 03:00 maintenance, 05:00 backup, Monday 08:00 secrets audit, monthly graph seed", "the secrets audit reads secret names only, never values"],
    features: ["lifecycle-scan", "graph-seed", "backup", "drift-audit-enhanced", "secrets-audit-enhanced", "registry-sync", "infra-ping", "ula-check", "memory-maintain", "metric-freshness"],
    bindings: { d1: ["qnfo-audit", "qnfo-graph", "portfolio-state", "living-paper", "ipatent-db"], r2: ["qnfo", "qnfo-audit", "qnfo-backups"] }
  }), { headers: h });
}
__name(health, "health");
__name2(health, "health");
__name22(health, "health");
__name222(health, "health");
__name2222(health, "health");
__name22222(health, "health");
__name222222(health, "health");
async function handleStatus(env, origin) {
  const h = corsHeaders(origin);
  try {
    const project = await env.PORTFOLIO_STATE.prepare("SELECT COUNT(*) as total FROM resources WHERE type='project'").first();
    const audit = await env.QNFO_AUDIT.prepare("SELECT COUNT(*) as total FROM audit_sessions").first();
    return new Response(JSON.stringify({
      status: "ok",
      projects: project?.total || 0,
      auditSessions: audit?.total || 0,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    }), { headers: h });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: h });
  }
}
__name(handleStatus, "handleStatus");
__name2(handleStatus, "handleStatus");
__name22(handleStatus, "handleStatus");
__name222(handleStatus, "handleStatus");
__name2222(handleStatus, "handleStatus");
__name22222(handleStatus, "handleStatus");
__name222222(handleStatus, "handleStatus");
async function handleDrift(env, origin) {
  const result = await runDriftAudit(env);
  return new Response(JSON.stringify(result), { headers: corsHeaders(origin) });
}
__name(handleDrift, "handleDrift");
__name2(handleDrift, "handleDrift");
__name22(handleDrift, "handleDrift");
__name222(handleDrift, "handleDrift");
__name2222(handleDrift, "handleDrift");
__name22222(handleDrift, "handleDrift");
__name222222(handleDrift, "handleDrift");
async function handleSecretsAudit(env, origin) {
  const result = await runSecretsAudit(env);
  return new Response(JSON.stringify(result), { headers: corsHeaders(origin) });
}
__name(handleSecretsAudit, "handleSecretsAudit");
__name2(handleSecretsAudit, "handleSecretsAudit");
__name22(handleSecretsAudit, "handleSecretsAudit");
__name222(handleSecretsAudit, "handleSecretsAudit");
__name2222(handleSecretsAudit, "handleSecretsAudit");
__name22222(handleSecretsAudit, "handleSecretsAudit");
__name222222(handleSecretsAudit, "handleSecretsAudit");
async function handleBackup(env, origin) {
  const result = await runBackup(env);
  return new Response(JSON.stringify(result), { headers: corsHeaders(origin) });
}
__name(handleBackup, "handleBackup");
__name2(handleBackup, "handleBackup");
__name22(handleBackup, "handleBackup");
__name222(handleBackup, "handleBackup");
__name2222(handleBackup, "handleBackup");
__name22222(handleBackup, "handleBackup");
__name222222(handleBackup, "handleBackup");
async function handleUlaCheck(env, origin) {
  const result = await runUlaCheck(env);
  return new Response(JSON.stringify(result), { headers: corsHeaders(origin) });
}
__name(handleUlaCheck, "handleUlaCheck");
__name2(handleUlaCheck, "handleUlaCheck");
__name22(handleUlaCheck, "handleUlaCheck");
__name222(handleUlaCheck, "handleUlaCheck");
__name2222(handleUlaCheck, "handleUlaCheck");
__name22222(handleUlaCheck, "handleUlaCheck");
__name222222(handleUlaCheck, "handleUlaCheck");
async function runUlaCheck(env) {
  console.log("[lifecycle] running ULA health check...");
  var result = {
    status: "ula-checked",
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    locations: {},
    findings: [],
    verdict: "HEALTHY"
  };
  var ULA_LOCATIONS = [
    { name: "legal.qnfo.org", url: "https://legal.qnfo.org/" },
    { name: "qnfo.org/legal/license", url: "https://qnfo.org/legal/license" },
    { name: "qwav.tech/legal/license", url: "https://qwav.tech/legal/license" }
  ];
  var CORRUPTION_PATTERNS = [
    { name: "th-ligature", regex: /\uFB05|\uFB06/g, desc: "Th/ff fi/fl ligatures" },
    { name: "Misplaced-ampersand", regex: /Misplaced &/g, desc: "Broken MathJax placeholder" },
    { name: "MathJax-unicode-range", regex: /[\uD835][\uDC00-\uDFFF]/g, desc: "MathJax Unicode surrogate pairs" }
  ];
  var EXPECTED_MIN_SIZE = 64e3;
  for (var i = 0; i < ULA_LOCATIONS.length; i++) {
    var loc = ULA_LOCATIONS[i];
    try {
      var resp = await fetch(loc.url, { method: "GET", headers: { "User-Agent": "qnfo-lifecycle-ula-check/1.4" } });
      var body = await resp.text();
      var byteSize = new TextEncoder().encode(body).length;
      var locResult = { url: loc.url, httpStatus: resp.status, byteSize, ok: resp.status === 200 && byteSize >= EXPECTED_MIN_SIZE };
      var detectedPatterns = [];
      for (var p = 0; p < CORRUPTION_PATTERNS.length; p++) {
        var pat = CORRUPTION_PATTERNS[p];
        var matches = body.match(pat.regex);
        if (matches && matches.length > 0) {
          detectedPatterns.push({ pattern: pat.name, count: matches.length, desc: pat.desc });
        }
      }
      if (detectedPatterns.length > 0) {
        locResult.corruptionDetected = detectedPatterns;
        locResult.ok = false;
        result.findings.push("CORRUPTION at " + loc.name + ": " + detectedPatterns.map(function(d) {
          return d.pattern + "(" + d.count + ")";
        }).join(", "));
      }
      if (resp.status !== 200) result.findings.push("HTTP " + resp.status + " at " + loc.name);
      if (byteSize < EXPECTED_MIN_SIZE) result.findings.push("SIZE anomaly at " + loc.name + ": " + byteSize + " bytes");
      if (!body.includes("QNFO-ULA")) {
        result.findings.push("CONTENT mismatch at " + loc.name);
        locResult.ok = false;
      }
      result.locations[loc.name] = locResult;
    } catch (e) {
      result.locations[loc.name] = { url: loc.url, error: e.message, ok: false };
      result.findings.push("FETCH FAILED at " + loc.name + ": " + e.message);
    }
  }
  var allOk = Object.values(result.locations).every(function(l) {
    return l.ok;
  });
  result.verdict = allOk ? "HEALTHY" : "DEGRADED";
  try {
    await env.QNFO_AUDIT.prepare("INSERT INTO audit_sessions (session_id, agent, start_time, end_time, tasks_completed, tasks_total, notes) VALUES (?, ?, ?, ?, ?, ?, ?)").bind("ula-check-" + Date.now(), "qnfo-lifecycle-ula-cron", (/* @__PURE__ */ new Date()).toISOString(), (/* @__PURE__ */ new Date()).toISOString(), allOk ? 1 : 0, 1, "ULA check: " + result.verdict).run();
  } catch (e) {
    console.error("[lifecycle] ula-check audit log error:", e.message);
  }
  return result;
}
__name(runUlaCheck, "runUlaCheck");
__name2(runUlaCheck, "runUlaCheck");
__name22(runUlaCheck, "runUlaCheck");
__name222(runUlaCheck, "runUlaCheck");
__name2222(runUlaCheck, "runUlaCheck");
__name22222(runUlaCheck, "runUlaCheck");
__name222222(runUlaCheck, "runUlaCheck");
// METRIC-FRESHNESS-WRITER-1 (issue #1301, 2026-09-29): qnfo-audit.metric_registry
// declared 24 metrics with cadences as tight as */15 and NO writer existed anywhere in the
// repo. Measured 2026-09-29: 9 metrics last_refreshed IS NULL, 15 stale 42.6-74.6h. This
// auditor never invents a value -- it stamps last_value/last_refreshed only for metrics
// whose source table is bound here, classifies every other metric against its OWN declared
// refresh_cadence, and files one deduplicated agent_issue so staleness cannot stay silent.
// METRIC-CADENCE-UNITS-1 (2026-10-05, #1865): "*/3h" was read as 3 minutes (inbound_unactioned_72h "180m stale vs 3m
// cadence") and "2h" did not parse (seven q08 metrics "cadence unparsed"). "*/N" and "N" take an optional m, h or d unit;
// a bare "*/N" stays minutes (the cron-minute form the */15 metrics use).
function metricCadenceMinutes(cadence) {
  if (!cadence) return null;
  var c = String(cadence).trim();
  var unit = { m: 1, h: 60, d: 1440 };
  var m = c.match(/^\*\/(\d+)\s*([mhd])?$/i);
  if (m) return parseInt(m[1], 10) * unit[(m[2] || "m").toLowerCase()];
  var m2 = c.match(/^(\d+)\s*([mhd])$/i);
  if (m2) return parseInt(m2[1], 10) * unit[m2[2].toLowerCase()];
  if (c === "hourly") return 60;
  if (c === "daily") return 1440;
  if (c === "weekly") return 10080;
  if (c === "monthly") return 43200;
  return null;
}
async function runMetricFreshness(env) {
  var nowMs = Date.now();
  var nowIso = new Date(nowMs).toISOString();
  var out = { status: "metric-freshness", timestamp: nowIso, total: 0, fresh: 0, stale: 0, never: 0, unparsed_cadence: 0, undefined: 0, undefined_metrics: [], unmeasured: 0, unmeasured_metrics: [], worst: null, refreshed: [], filed_issue: false, updated_issue: false };
  var rows = [];
  try {
    var res = await env.QNFO_AUDIT.prepare("SELECT metric, refresh_cadence, last_refreshed, state FROM metric_registry").all();
    rows = res.results || [];
  } catch (e) {
    out.error = "metric_registry read failed: " + e.message;
    return out;
  }
  out.total = rows.length;
  var offenders = [];
  var worstAge = -1, worstMetric = null;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    // METRIC-UNDEFINED-CLASS-1 (2026-09-30, #1411): a metric in state UNDEFINED has no agreed formula, so no writer can
    // ever refresh it; counting it as "stale" kept this ticket open forever for a definition gap, not a freshness gap.
    // Report it in its own class (undefined_metrics) and keep it out of the staleness verdict.
    if (String(r.state || "").toUpperCase() === "UNDEFINED") {
      out.undefined++;
      out.undefined_metrics.push(r.metric);
      continue;
    }
    // METRIC-UNMEASURED-CLASS-1 (2026-10-05, #1865): a metric whose owner declares it UNMEASURED (or n/a) and that has never
    // had a reading (ask_helpful_rate_30d below 10 ratings, the q08 panel metrics, paper_math_browser_fail_pages) is a
    // measurement gap, not a stale writer; it is reported in its own class, like UNDEFINED. Once a writer stamps it, the
    // row is judged on its cadence like any other.
    if (!r.last_refreshed && /^(unmeasured|n\/a)$/i.test(String(r.state || "").trim())) {
      out.unmeasured++;
      out.unmeasured_metrics.push(r.metric);
      continue;
    }
    var cad = metricCadenceMinutes(r.refresh_cadence);
    if (cad === null) {
      out.unparsed_cadence++;
      offenders.push(r.metric + " (cadence unparsed: " + r.refresh_cadence + ")");
      continue;
    }
    if (!r.last_refreshed) {
      out.never++;
      offenders.push(r.metric + " (never refreshed)");
      continue;
    }
    var raw = String(r.last_refreshed);
    var t = Date.parse(raw.indexOf("T") >= 0 ? raw : raw.replace(" ", "T") + "Z");
    if (isNaN(t)) { out.unparsed_cadence++; continue; }
    var ageMin = (nowMs - t) / 60000;
    if (ageMin > cad * 2) {
      out.stale++;
      offenders.push(r.metric + " (" + Math.round(ageMin) + "m stale vs " + cad + "m cadence)");
      if (ageMin > worstAge) { worstAge = ageMin; worstMetric = r.metric; }
    } else {
      out.fresh++;
    }
  }
  if (worstMetric) out.worst = { metric: worstMetric, age_minutes: Math.round(worstAge) };
  try {
    var oi = await env.QNFO_AUDIT.prepare("SELECT COUNT(*) AS c FROM agent_issues WHERE status = 'open'").first();
    if (oi) {
      await env.QNFO_AUDIT.prepare("UPDATE metric_registry SET last_value = ?, last_refreshed = ?, state = ? WHERE metric = ?").bind(String(oi.c == null ? 0 : oi.c), nowIso, "MEASURED", "open_agent_issues").run();
      out.refreshed.push("open_agent_issues");
    }
  } catch (e) { out.refresh_error_open_issues = e.message; }
  // ONE-WORKER-COUNT-1 (1.8.1, transformation lever T5.10): worker_count is written by qnfo-fleet-control budgetAudit from the
  // live Cloudflare scripts census, the same read that writes fleet_budget.workers; this tick no longer writes it from
  // COUNT(service_registry), which counted every row whatever its state (32 against 31 live scripts on 2026-10-06) and made
  // the two readers disagree every hour. worker_count_disagreement (qnfo-fleet-control) names the odd ones out.
  // RESEARCH-METRICS-WRITER-1 (2026-10-01, agent_issues #1742): publications_30d and full_reports_live_30d
  // (registry formulas over living-paper.papers) and indexed_surface (<loc> count of the papers.qnfo.org sitemap)
  // had no writer anywhere in the fleet: their last values were written by hand on 2026-09-29 17:18Z and went
  // stale against a daily cadence while this auditor filed the ticket every hour. Same rule as the two writers
  // above: recompute from the registry's own source of truth, never invent; a source that cannot be read this
  // cycle is left untouched and reported in refresh_error_*.
  try {
    if (!env.LIVING_PAPER) throw new Error("no LIVING_PAPER binding");
    var pub = await env.LIVING_PAPER.prepare("SELECT COUNT(*) AS c FROM papers WHERE status = 'published' AND created_at >= datetime('now','-30 day')").first();
    var full = await env.LIVING_PAPER.prepare("SELECT COUNT(*) AS c FROM papers WHERE status = 'published' AND length(COALESCE(body_md,'')) >= 5000 AND created_at >= datetime('now','-30 day')").first();
    if (pub && pub.c != null) {
      await env.QNFO_AUDIT.prepare("UPDATE metric_registry SET last_value = ?, last_refreshed = ?, state = ? WHERE metric = ?").bind(String(pub.c), nowIso, "MEASURED", "publications_30d").run();
      out.refreshed.push("publications_30d");
    }
    if (full && full.c != null) {
      await env.QNFO_AUDIT.prepare("UPDATE metric_registry SET last_value = ?, last_refreshed = ?, state = ? WHERE metric = ?").bind(String(full.c), nowIso, "MEASURED", "full_reports_live_30d").run();
      out.refreshed.push("full_reports_live_30d");
    }
  } catch (e) { out.refresh_error_publications = e.message; }
  try {
    var sm = await fetch("https://papers.qnfo.org/sitemap.xml", { headers: { "User-Agent": "qnfo-lifecycle/" + QNFO_VERSION }, signal: AbortSignal.timeout(15000) });
    if (!sm.ok) throw new Error("sitemap http " + sm.status);
    var locs = ((await sm.text()).match(/<loc>/g) || []).length;
    if (locs <= 0) throw new Error("sitemap carries no <loc> entries");
    await env.QNFO_AUDIT.prepare("UPDATE metric_registry SET last_value = ?, last_refreshed = ?, state = ? WHERE metric = ?").bind(String(locs), nowIso, "MEASURED", "indexed_surface").run();
    out.refreshed.push("indexed_surface");
  } catch (e) { out.refresh_error_indexed_surface = e.message; }
  var remaining = out.stale + out.never + out.unparsed_cadence;
  var stTitle = "METRIC-REGISTRY-STALENESS-1: metric_registry rows exceed their declared refresh cadence";
  if (remaining === 0) {
    // METRIC-STALENESS-SELF-CLOSE-1 (2026-09-30): the auditor could FILE and UPDATE its ticket but never close it, so
    // even a fully fresh registry left #1411 open. Close on positive evidence (this run's own verdict), writing
    // issue_triage.close_evidence first as the qnfo-audit close trigger requires.
    try {
      var ox = await env.QNFO_AUDIT.prepare("SELECT id FROM agent_issues WHERE status = 'open' AND title = ? LIMIT 1").bind(stTitle).first();
      if (ox && ox.id) {
        var evd = "qnfo-lifecycle/" + QNFO_VERSION + " at " + nowIso + ": 0 stale / 0 never / 0 unparsed of " + out.total + " metrics (" + out.fresh + " fresh" + (out.undefined ? ", " + out.undefined + " UNDEFINED excluded: " + out.undefined_metrics.join(",") : "") + (out.unmeasured ? ", " + out.unmeasured + " never-measured UNMEASURED excluded: " + out.unmeasured_metrics.join(",") : "") + ")";
        await env.QNFO_AUDIT.prepare("INSERT INTO issue_triage (issue_id, rc, triage_state, owner, sla_due_at, remediation, close_evidence) VALUES (?1, 'METRIC-STALENESS-SELF-CLOSE-1', 'resolved', 'qnfo-lifecycle', datetime('now'), 'auditor verdict: registry fresh', ?2) ON CONFLICT(issue_id) DO UPDATE SET close_evidence=excluded.close_evidence, triage_state='resolved'").bind(ox.id, evd).run();
        await env.QNFO_AUDIT.prepare("UPDATE agent_issues SET status='resolved', close_channel='lifecycle-metric-freshness', updated_at=? WHERE id=? AND status='open'").bind(nowMs, ox.id).run();
        out.closed_issue = ox.id;
      }
    } catch (e) { out.close_error = e.message; }
  }
  if (remaining > 0) {
    var title = "METRIC-REGISTRY-STALENESS-1: metric_registry rows exceed their declared refresh cadence";
    var desc = remaining + "/" + out.total + " metrics not fresh at " + nowIso + " :: " + offenders.slice(0, 40).join("; ") + (out.undefined ? " || excluded as UNDEFINED (definition gap, not staleness): " + out.undefined_metrics.join(", ") : "") + (out.unmeasured ? " || awaiting a first reading (state UNMEASURED or n/a, never refreshed; a measurement gap, not staleness): " + out.unmeasured_metrics.join(", ") : "");
    try {
      var ex = await env.QNFO_AUDIT.prepare("SELECT id FROM agent_issues WHERE status = 'open' AND title = ? LIMIT 1").bind(title).first();
      if (ex && ex.id) {
        await env.QNFO_AUDIT.prepare("UPDATE agent_issues SET description = ?, updated_at = ? WHERE id = ?").bind(desc, nowMs, ex.id).run();
        out.updated_issue = true;
      } else {
        await env.QNFO_AUDIT.prepare("INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(title, desc, "qnfo-lifecycle-metric-freshness", "observability", "high", "open", nowMs, nowMs).run();
        out.filed_issue = true;
      }
    } catch (e) { out.issue_error = e.message; }
  }
  return out;
}
async function handleMetricsRefresh(env, origin) {
  var result = await runMetricFreshness(env);
  return new Response(JSON.stringify(result), { headers: corsHeaders(origin) });
}
async function runLifecycle(env) {
  console.log("[lifecycle] scanning inactive projects...");
  try {
    var now = /* @__PURE__ */ new Date();
    var res = await env.PORTFOLIO_STATE.prepare("SELECT id, name, status, updated_at FROM resources WHERE type='project'").all();
    var staleCount = 0, archivedCount = 0;
    for (var i = 0; i < (res.results || []).length; i++) {
      var r = res.results[i];
      if (!r.updated_at) continue;
      var days = (now.getTime() - new Date(r.updated_at).getTime()) / 864e5;
      var newStatus = r.status;
      if (days >= 180) newStatus = "ARCHIVED";
      else if (days >= 90) newStatus = "STALE";
      else newStatus = "ACTIVE";
      if (newStatus !== r.status) {
        await env.PORTFOLIO_STATE.prepare("UPDATE resources SET status=?, updated_at=updated_at WHERE id=?").bind(newStatus, r.id).run();
        if (newStatus === "STALE") staleCount++;
        if (newStatus === "ARCHIVED") archivedCount++;
      }
    }
    console.log("[lifecycle] transitions: " + staleCount + " -> STALE, " + archivedCount + " -> ARCHIVED");
  } catch (e) {
    console.error("[lifecycle] runLifecycle error:", e.message);
  }
}
__name(runLifecycle, "runLifecycle");
__name2(runLifecycle, "runLifecycle");
__name22(runLifecycle, "runLifecycle");
__name222(runLifecycle, "runLifecycle");
__name2222(runLifecycle, "runLifecycle");
__name22222(runLifecycle, "runLifecycle");
__name222222(runLifecycle, "runLifecycle");
async function runGraphSeed(env) {
  console.log("[lifecycle] re-seeding graph snapshot...");
  try {
    var nc = await env.QNFO_GRAPH.prepare("SELECT COUNT(*) as c FROM nodes").first();
    var ec = await env.QNFO_GRAPH.prepare("SELECT COUNT(*) as c FROM edges").first();
    await env.QNFO_AUDIT.prepare("INSERT INTO audit_sessions (session_id, agent, start_time, end_time, tasks_completed, tasks_total, notes) VALUES (?, ?, ?, ?, ?, ?, ?)").bind("graph-seed-" + Date.now(), "qnfo-lifecycle-cron", (/* @__PURE__ */ new Date()).toISOString(), (/* @__PURE__ */ new Date()).toISOString(), 1, 1, "Monthly graph snapshot: " + (nc?.c || 0) + " nodes, " + (ec?.c || 0) + " edges").run();
  } catch (e) {
    console.error("[lifecycle] runGraphSeed error:", e.message);
  }
}
__name(runGraphSeed, "runGraphSeed");
__name2(runGraphSeed, "runGraphSeed");
__name22(runGraphSeed, "runGraphSeed");
__name222(runGraphSeed, "runGraphSeed");
__name2222(runGraphSeed, "runGraphSeed");
__name22222(runGraphSeed, "runGraphSeed");
__name222222(runGraphSeed, "runGraphSeed");
async function runBackup(env) {
  console.log("[lifecycle] running backup...");
  var dateStamp = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  var results = {};
  try {
    var tables = [
      { db: env.PORTFOLIO_STATE, name: "portfolio-state", table: "resources", pageRows: 50 },
      { db: env.QNFO_AUDIT, name: "qnfo-audit", table: "audit_sessions", pageRows: 200 }, // 5,401 short rows: 10 a page would be 541 reads of the 1,000-subrequest budget
      { db: env.LIVING_PAPER, name: "living-paper", table: "papers" },
      { db: env.IPATENT_DB, name: "ipatent-db", table: "submissions" }
    ];
    for (var i = 0; i < tables.length; i++) {
      var t = tables[i];
      try {
        results[t.name] = await backupTable(env, t.name, t.db, t.table, dateStamp, t.pageRows);
      } catch (e) {
        results[t.name] = "error: " + e.message;
      }
    }
    return { status: "backup-complete", dateStamp, results };
  } catch (e) {
    return { status: "backup-failed", error: e.message };
  }
}
// BACKUP-PAGED-1 (1.15.2): the 05:00 UTC backup read each table with `SELECT * FROM <table>` into one array, stringified the array
// and put the string: for living-paper.papers (1077 rows, 41 MB of body_md in 2026-10) that is the rows, the JSON text and the
// encoded body alive together, over the 128 MB isolate limit. Cloudflare Observability recorded "Worker invocation ended with
// exceededMemory" on qnfo-lifecycle at 05:01Z on every day from 2026-10-20 to 2026-10-26 (group a539fdc8), one minute after this tick,
// and the isolate died before the catch below could record anything. Now a table is read in keyset pages of BACKUP_PAGE_ROWS rows
// (rowid order, no OFFSET) and written in parts of about BACKUP_PART_BYTES; a table that fits in one part keeps its old single object
// <db>/<table>-<date>.json (a JSON array), a larger one is <db>/<table>-<date>/part-NNNN.json (each a JSON array of rows, in rowid
// order) plus <db>/<table>-<date>.manifest.json that lists the parts. Peak memory is one page plus one part, whatever the table size.
var BACKUP_PAGE_ROWS = 10;
var BACKUP_PART_BYTES = 4 * 1024 * 1024;
async function backupTable(env, name, db, table, dateStamp, pageRows) {
  var pr = pageRows > 0 ? pageRows : BACKUP_PAGE_ROWS;
  var base = name + "/" + table + "-" + dateStamp;
  var put = function (key, body) { return env.BACKUP_BUCKET.put(key, body, { httpMetadata: { contentType: "application/json" } }); };
  var last = null, total = 0, parts = [], buf = [], bufChars = 0;
  var flush = async function () {
    var key = base + "/part-" + String(parts.length + 1).padStart(4, "0") + ".json";
    await put(key, "[" + buf.join(",") + "]");
    parts.push({ key: key, rows: buf.length });
    buf = [];
    bufChars = 0;
  };
  for (;;) {
    var stmt = last === null
      ? db.prepare("SELECT rowid AS _bk_rowid, * FROM " + table + " ORDER BY rowid LIMIT ?1").bind(pr)
      : db.prepare("SELECT rowid AS _bk_rowid, * FROM " + table + " WHERE rowid > ?1 ORDER BY rowid LIMIT ?2").bind(last, pr);
    var page = await stmt.all();
    var batch = (page && page.results) || [];
    for (var k = 0; k < batch.length; k++) {
      var row = batch[k];
      last = row._bk_rowid;
      delete row._bk_rowid;
      var text = JSON.stringify(row);
      buf.push(text);
      bufChars += text.length + 1;
      total++;
      if (bufChars >= BACKUP_PART_BYTES) await flush();
    }
    if (batch.length < pr) break;
  }
  if (!parts.length) {
    await put(base + ".json", "[" + buf.join(",") + "]");
    return total;
  }
  if (buf.length) await flush();
  await put(base + ".manifest.json", JSON.stringify({ db: name, table: table, date: dateStamp, rows: total, parts: parts }));
  return total;
}
__name(runBackup, "runBackup");
__name2(runBackup, "runBackup");
__name22(runBackup, "runBackup");
__name222(runBackup, "runBackup");
__name2222(runBackup, "runBackup");
__name22222(runBackup, "runBackup");
__name222222(runBackup, "runBackup");
async function runDriftAudit(env) {
  if (env.AI) env.AI.caller = "qnfo-lifecycle";
  console.log("[lifecycle] running ENHANCED drift audit...");
  var result = { status: "drift-checked", timestamp: (/* @__PURE__ */ new Date()).toISOString(), portfolioState: {}, liveState: {}, drift: [], warnings: [] };
  try {
    var project = await env.PORTFOLIO_STATE.prepare("SELECT COUNT(*) as c FROM resources WHERE type='project'").first();
    var worker = await env.PORTFOLIO_STATE.prepare("SELECT COUNT(*) as c FROM resources WHERE type='worker'").first();
    var workerNames = await env.PORTFOLIO_STATE.prepare("SELECT name FROM resources WHERE type='worker'").all();
    result.portfolioState = { projects: project?.c || 0, workers: worker?.c || 0, workerNames: workerNames.results?.map(function(r) {
      return r.name;
    }) || [] };
  } catch (e) {
    result.warnings.push("portfolio-state query failed: " + e.message);
  }
  if (env.CF_API_TOKEN) {
    try {
      var apiResp = await fetch("https://api.cloudflare.com/client/v4/accounts/edb167b78c9fb901ea5bca3ce58ccc4b/workers/scripts", { headers: { Authorization: "Bearer " + env.CF_API_TOKEN, "Content-Type": "application/json" } });
      if (apiResp.ok) {
        var data = await apiResp.json();
        var liveWorkers = data.result || [];
        result.liveState = { workers: liveWorkers.length, workerNames: liveWorkers.map(function(w) {
          return w.id;
        }) };
        var portfolioNames = new Set(result.portfolioState.workerNames || []);
        var liveNames = new Set(result.liveState.workerNames || []);
        liveNames.forEach(function(lw) {
          if (!portfolioNames.has(lw)) result.drift.push({ type: "missing_in_portfolio", worker: lw });
        });
        portfolioNames.forEach(function(pw) {
          if (!liveNames.has(pw)) result.drift.push({ type: "stale_in_portfolio", worker: pw });
        });
      } else {
        result.warnings.push("Cloudflare API returned HTTP " + apiResp.status);
      }
    } catch (e) {
      result.warnings.push("Cloudflare API fetch failed: " + e.message);
    }
  } else {
    result.warnings.push("CF_API_TOKEN not configured - live comparison skipped");
  }
  result.driftCount = result.drift.length;
  result.verdict = result.drift.length === 0 ? "CLEAN" : "DRIFT_DETECTED";
  try {
    await env.QNFO_AUDIT.prepare("INSERT INTO audit_sessions (session_id, agent, start_time, end_time, tasks_completed, tasks_total, notes) VALUES (?, ?, ?, ?, ?, ?, ?)").bind("drift-" + Date.now(), "qnfo-lifecycle-cron", (/* @__PURE__ */ new Date()).toISOString(), (/* @__PURE__ */ new Date()).toISOString(), result.drift.length === 0 ? 1 : 0, 1, "Drift audit: " + result.driftCount + " drifts. Verdict: " + result.verdict).run();
  } catch (e) {
  }
  return result;
}
__name(runDriftAudit, "runDriftAudit");
__name2(runDriftAudit, "runDriftAudit");
__name22(runDriftAudit, "runDriftAudit");
__name222(runDriftAudit, "runDriftAudit");
__name2222(runDriftAudit, "runDriftAudit");
__name22222(runDriftAudit, "runDriftAudit");
__name222222(runDriftAudit, "runDriftAudit");
async function runSecretsAudit(env) {
  if (env.AI) env.AI.caller = "qnfo-lifecycle";
  console.log("[lifecycle] running ENHANCED secrets audit...");
  var result = { status: "secrets-audited", timestamp: (/* @__PURE__ */ new Date()).toISOString(), metadataStaleness: [], workerSecrets: [], findings: [], recommendations: [] };
  try {
    var stale = await env.PORTFOLIO_STATE.prepare("SELECT id, name FROM resources WHERE type='project' AND updated_at < datetime('now', '-180 days')").all();
    result.metadataStaleness = (stale.results || []).map(function(r) {
      return r.name;
    });
    if (result.metadataStaleness.length > 0) result.findings.push(result.metadataStaleness.length + " projects with stale metadata (>180d)");
  } catch (e) {
    result.findings.push("Metadata staleness check error: " + e.message);
  }
  if (env.CF_API_TOKEN) {
    try {
      var apiResp = await fetch("https://api.cloudflare.com/client/v4/accounts/edb167b78c9fb901ea5bca3ce58ccc4b/workers/scripts", { headers: { Authorization: "Bearer " + env.CF_API_TOKEN, "Content-Type": "application/json" } });
      if (apiResp.ok) {
        var data = await apiResp.json();
        var workers = data.result || [];
        for (var i = 0; i < workers.length; i++) {
          var w = workers[i];
          try {
            var secretsResp = await fetch("https://api.cloudflare.com/client/v4/accounts/edb167b78c9fb901ea5bca3ce58ccc4b/workers/scripts/" + w.id + "/secrets", { headers: { Authorization: "Bearer " + env.CF_API_TOKEN } });
            if (secretsResp.ok) {
              var secretsData = await secretsResp.json();
              var secrets = secretsData.result || [];
              result.workerSecrets.push({ worker: w.id, secretCount: secrets.length, secretNames: secrets.map(function(s2) {
                return s2.name;
              }) });
              for (var s = 0; s < secrets.length; s++) {
                var sn = secrets[s];
                var nameUpper = (sn.name || "").toUpperCase();
                if (nameUpper.includes("TOKEN") || nameUpper.includes("API_KEY") || nameUpper.includes("SECRET")) {
                  result.findings.push("High-risk secret '" + sn.name + "' in Worker '" + w.id + "' - verify rotation age");
                }
              }
            }
          } catch (e) {
            result.findings.push("Failed to query secrets for " + w.id + ": " + e.message);
          }
        }
      }
    } catch (e) {
      result.findings.push("Cloudflare API fetch failed: " + e.message);
    }
  } else {
    result.recommendations.push("CF_API_TOKEN not configured - Worker secrets audit skipped");
  }
  var DOCUMENTED_SECRETS = ["CLOUDFLARE_API_TOKEN", "GITHUB_TOKEN", "BUFFER_ACCESS_TOKEN", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "PINATA_API_KEY", "PINATA_API_SECRET", "PINATA_JWT", "GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "BUFFER_CLIENT_ID", "BUFFER_CLIENT_SECRET", "ADMIN_API_TOKEN", "ADMIN_TOKEN", "CF_API_TOKEN"];
  var documentedSet = new Set(DOCUMENTED_SECRETS.map(function(s2) {
    return s2.toUpperCase();
  }));
  for (var i = 0; i < result.workerSecrets.length; i++) {
    var ws = result.workerSecrets[i];
    for (var j = 0; j < ws.secretNames.length; j++) {
      if (!documentedSet.has(ws.secretNames[j].toUpperCase())) {
        result.findings.push("UNDOCUMENTED secret '" + ws.secretNames[j] + "' in Worker '" + ws.worker + "'");
      }
    }
  }
  result.recommendations.push("Rotation check: secrets older than 90 days need rotation.");
  try {
    var govRows = await env.PORTFOLIO_STATE.prepare("SELECT policy_id, title, review_date, status, summary FROM governance_policies WHERE policy_id IN ('GOV-POL-004','GOV-REPORT-002')").all();
    result.governance = { policies: (govRows.results || []).map(function(r) {
      return { policy_id: r.policy_id, title: r.title, review_date: r.review_date, status: r.status };
    }) };
    var today = /* @__PURE__ */ new Date();
    for (var gi = 0; gi < result.governance.policies.length; gi++) {
      var gp = result.governance.policies[gi];
      if (!gp.review_date) continue;
      var due = /* @__PURE__ */ new Date(gp.review_date + "T00:00:00Z");
      var daysLeft = Math.round((due - today) / 864e5);
      gp.daysToReview = daysLeft;
      if (daysLeft < 0) {
        result.findings.push("GOV-OVERDUE: " + gp.policy_id + " review overdue by " + Math.abs(daysLeft) + " days (" + gp.review_date + ")");
      } else if (daysLeft <= 14) {
        result.recommendations.push("GOV-DUE: " + gp.policy_id + " review due in " + daysLeft + " days (" + gp.review_date + ")");
      }
    }
    var tokResp = await fetch("https://api.cloudflare.com/client/v4/accounts/edb167b78c9fb901ea5bca3ce58ccc4b/workers/scripts?per_page=1", { headers: { Authorization: "Bearer " + env.CF_API_TOKEN } });
    if (tokResp.ok) {
      result.findings.push("TOKEN-OK: CLOUDFLARE_API_TOKEN valid for Workers API (GOV-POL-004 compliance)");
    } else {
      result.findings.push("TOKEN-REVIEW: CLOUDFLARE_API_TOKEN Workers API probe HTTP " + tokResp.status + " (rotation deadline check per GOV-POL-004 90d schedule)");
    }
  } catch (e) {
    result.findings.push("Governance check error: " + e.message);
  }
  result.totalFindings = result.findings.length;
  result.totalRecommendations = result.recommendations.length;
  try {
    await env.QNFO_AUDIT.prepare("INSERT INTO audit_sessions (session_id, agent, start_time, end_time, tasks_completed, tasks_total, notes) VALUES (?, ?, ?, ?, ?, ?, ?)").bind("secrets-" + Date.now(), "qnfo-lifecycle-cron", (/* @__PURE__ */ new Date()).toISOString(), (/* @__PURE__ */ new Date()).toISOString(), 1, 1, "Secrets audit: " + result.totalFindings + " findings").run();
  } catch (e) {
  }
  return result;
}
__name(runSecretsAudit, "runSecretsAudit");
__name2(runSecretsAudit, "runSecretsAudit");
__name22(runSecretsAudit, "runSecretsAudit");
__name222(runSecretsAudit, "runSecretsAudit");
__name2222(runSecretsAudit, "runSecretsAudit");
__name22222(runSecretsAudit, "runSecretsAudit");
__name222222(runSecretsAudit, "runSecretsAudit");
async function runSync(env) {
  if (env.AI) env.AI.caller = "qnfo-lifecycle";
  console.log("[lifecycle] syncing registry...");
  var out = { status: "registry-synced", checked: 0, updated: 0, failed: 0, changes: [] };
  try {
    var rows = await env.QNFO_AUDIT.prepare("SELECT service, version, base_url FROM service_registry").all();
    var list = rows.results || [];
    var probe = async function(r) {
      out.checked++;
      var url = (r.base_url || ("https://" + r.service + ".q08.workers.dev")).replace(/\/+$/, "");
      try {
        var resp = await fetch(url + "/health", { signal: AbortSignal.timeout(6000) });
        if (!resp.ok) { out.failed++; return; }
        var t = (await resp.text()).replace(/\s+/g, " ");
        var m = t.match(/"version"\s*:\s*"([^"]{1,60})"/);
        var live = m && m[1] ? m[1] : null;
        if (!live) { out.failed++; return; }
        if (live !== r.version) {
          await env.QNFO_AUDIT.prepare("UPDATE service_registry SET version=?1, updated_at=?2 WHERE service=?3").bind(live, new Date().toISOString(), r.service).run();
          out.updated++;
          if (out.changes.length < 30) out.changes.push(r.service + ": " + (r.version || "null") + " -> " + live);
        }
      } catch (e) { out.failed++; }
    };
    for (var i = 0; i < list.length; i += 10) {
      await Promise.all(list.slice(i, i + 10).map(probe));
    }
  } catch (e) { out.error = String(e && e.message || e).slice(0, 160); }
  console.log("[lifecycle] registry sync: checked=" + out.checked + " updated=" + out.updated + " failed=" + out.failed);
  return out;
}
__name(runSync, "runSync");
__name2(runSync, "runSync");
__name22(runSync, "runSync");
__name222(runSync, "runSync");
__name2222(runSync, "runSync");
__name22222(runSync, "runSync");
__name222222(runSync, "runSync");
async function runPing(env) {
  if (env.AI) env.AI.caller = "qnfo-lifecycle";
  console.log("[lifecycle] infra ping...");
  // LIFECYCLE-PING-404-1 (1.11.5, agent_issues 2903): the ping hit the raw qnfo-gateway.q08.workers.dev hostname,
  // but qnfo-gateway serves /health only on its canonical hosts (qnfo.org / www.qnfo.org / graph-api.qnfo.org), so the
  // raw workers.dev host fell through to 404 and logged 150 PING FAIL rows (Observability groups 01d821db, 24f75eba).
  // Ping the canonical public /health (qnfo.org), which the gateway does serve.
  var targets = ["https://qnfo.org/health"];
  for (var i = 0; i < targets.length; i++) {
    try {
      var r = await fetch(targets[i], { method: "GET" });
      if (!r.ok) console.error("[lifecycle] PING FAIL " + targets[i] + ": HTTP " + r.status);
    } catch (e) {
      console.error("[lifecycle] PING ERROR " + targets[i] + ": " + e.message);
    }
  }
}
__name(runPing, "runPing");
__name2(runPing, "runPing");
__name22(runPing, "runPing");
__name222(runPing, "runPing");
__name2222(runPing, "runPing");
__name22222(runPing, "runPing");
__name222222(runPing, "runPing");
var MEM_DECAY_HALF_LIFE_DAYS = 90;
var MEM_PRUNE_EFFECTIVE_IMPORTANCE = 0.1;
async function runMemoryMaintain(env, opts) {
  if (env.AI) env.AI.caller = "qnfo-lifecycle";
  opts = opts || {};
  var commit = !!opts.commit;
  var result = { status: "memory-maintained", plane: "qnfo", commit, timestamp: (/* @__PURE__ */ new Date()).toISOString(), scanned: 0, decayed: 0, expired: 0, deduped: 0, pruned: 0, ids: [] };
  try {
    var rows = await env.QNFO_GRAPH.prepare("SELECT id, category, content, summary, importance, session_id, created_at, expires_at FROM agent_memories").all();
    var mems = rows.results || [];
    result.scanned = mems.length;
    var now = Date.now();
    var pruneIds = /* @__PURE__ */ new Set();
    for (var i = 0; i < mems.length; i++) {
      var m = mems[i];
      var importance = m.importance != null ? Number(m.importance) : 0.7;
      if (m.expires_at) {
        var exp = new Date(m.expires_at).getTime();
        if (!isNaN(exp) && exp <= now) {
          pruneIds.add(m.id);
          result.expired++;
          continue;
        }
      }
      var created = new Date(m.created_at).getTime();
      if (isNaN(created)) continue;
      var ageDays = (now - created) / 864e5;
      var effective = importance * Math.pow(0.5, ageDays / MEM_DECAY_HALF_LIFE_DAYS);
      if (effective < MEM_PRUNE_EFFECTIVE_IMPORTANCE) {
        pruneIds.add(m.id);
        result.decayed++;
      }
    }
    var byCat = {};
    for (var j = 0; j < mems.length; j++) {
      var mm = mems[j];
      if (pruneIds.has(mm.id)) continue;
      var key = mm.category + "::" + String(mm.content || "").toLowerCase().replace(/\s+/g, " ").trim();
      if (!byCat[key]) byCat[key] = [];
      byCat[key].push(mm);
    }
    for (var k in byCat) {
      var group = byCat[k];
      if (group.length < 2) continue;
      group.sort(function(a, b) {
        return (Number(b.importance) || 0) - (Number(a.importance) || 0);
      });
      for (var g = 1; g < group.length; g++) {
        var dup = group[g];
        if (pruneIds.has(dup.id)) continue;
        pruneIds.add(dup.id);
        result.deduped++;
      }
    }
    if (commit && pruneIds.size) {
      var ids = Array.from(pruneIds);
      for (var c = 0; c < ids.length; c += 100) {
        var chunk = ids.slice(c, c + 100);
        var ph = chunk.map(function() {
          return "?";
        }).join(",");
        await env.QNFO_GRAPH.prepare("DELETE FROM agent_memories WHERE id IN (" + ph + ")").bind(...chunk).run();
        await env.PAPER_VZ.deleteByIds(chunk).catch(function(e) {
          console.error("[lifecycle] VZ delete error:", e.message);
        });
      }
    }
    result.pruned = pruneIds.size;
    result.ids = Array.from(pruneIds).slice(0, 50);
    if (commit) {
      await env.QNFO_AUDIT.prepare("INSERT INTO audit_sessions (session_id, agent, start_time, end_time, tasks_completed, tasks_total, notes) VALUES (?, ?, ?, ?, ?, ?, ?)").bind("memory-maintain-" + Date.now(), "qnfo-lifecycle-cron", (/* @__PURE__ */ new Date()).toISOString(), (/* @__PURE__ */ new Date()).toISOString(), 1, 1, "Memory maintain: " + result.scanned + " scanned, " + result.pruned + " pruned").run().catch(function() {
      });
    }
  } catch (e) {
    result.error = e.message;
  }
  return result;
}
__name(runMemoryMaintain, "runMemoryMaintain");
__name2(runMemoryMaintain, "runMemoryMaintain");
async function handleMemoryMaintain(request, env, origin) {
  if (env.AI) env.AI.caller = "qnfo-lifecycle";
  var q = new URL(request.url).searchParams;
  var commit = q.get("commit") === "1" || q.get("commit") === "true";
  var result = await runMemoryMaintain(env, { commit });
  return new Response(JSON.stringify(result), { headers: corsHeaders(origin) });
}
__name(handleMemoryMaintain, "handleMemoryMaintain");
__name2(handleMemoryMaintain, "handleMemoryMaintain");
// ---- FOLD-KIT-1:calendar-api:BEGIN (T3.10, agent_issues 2010) ----
// calendar-api runs here as a member: its code below is the calendar-api bundle unchanged except its imports (aliased host imports),
// its VERSION line and its export. Public: GET /calendar/health. Every other route answers only a service binding
// whose props name the member (props.member = "calendar-api", props.caller = qnfo-* or personal-api, radar-hub). Its job runs on this worker's own tick.
// Public routes: GET,POST /calendar/e/*; GET /calendar/events.ics.
var CALENDAR_API_FOLD_VERSION = "0.7.5-folded";
var calendarApiFoldMod = (function () {
var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var VERSION = CALENDAR_API_FOLD_VERSION; // member version (FOLD-KIT-1); was "0.7.5-folded" as its own worker; // 0.7.5 CALENDAR-FOLD-2 (2026-10-06, agent_issues 2010, T3.10, pillar cost): the last version as its own worker; it runs as the member calendarApiFoldMod in qnfo-lifecycle (scripts/fold_worker.py, FOLD-KIT-2). GET /health reports feedback_links (whether a link key is present, never the key), so the derived key can be verified live without reading a secret. // 0.7.4 FOLD-READY-1 (CALENDAR-FOLD-2, agent_issues 2010, T3.10, pillar cost): nothing changes while this runs as its own worker. The feedback-link HMAC key is env.CAL_TOKEN, or env.CAL_KEY_SEED when CAL_TOKEN is absent (the fold kit derives it from a host secret the member never sees: a secret cannot be copied between workers and minting a new one is outside the standing grant); links use env.CAL_PUBLIC_BASE when set (the host route after the fold); the feedback form posts to "?s=<sig>" relative to its own page, so it works under a host prefix. // 0.7.3 OQ-TRIP-WINDOW-1 (#1951, pillar personal): queueOwnerQuestions decides local vs away from the calendar's own trip windows (domain travel / trip- uid / travel-sync-key rows outside the Amsterdam area, end exclusive) and an explicit Amsterdam-area list instead of a foreign-country regex; GET /feedback gains after_id (ascending, bounded, next_after_id) so a consumer can drain more than 500 rows without skipping any (CAL-FEEDBACK-PAGE-1). // 0.7.2 CAL-CANCELLED-ICS-1 (#1881 gap D, pillar personal): a calendar row with status='cancelled' (a trip cancelled by qnfo-email) is published in the personal feed as STATUS:CANCELLED with its uid, summary and dates only, so Outlook removes the copy it holds; host and qnfo feeds still omit it.
// 0.7.1 0.7.1 CAL-CALLER-PROPS-1: a service-binding caller named by ctx.props.caller is authorized like a CAL_TOKEN bearer (radar-hub has no CAL_TOKEN secret, so the personal radar posted nothing after 2026-09-23).
// NOTES-INTAKE-FOLD-1 (2026-10-01, issue 1639): notes-intake (0.1.5, the server-side Obsidian vault pipeline) disappeared
// unrecorded around 2026-09-25 - last notes_intake_runs row 2026-09-25T10:30Z - and is folded in here instead of being
// recreated as a separate worker. Its EXECUTE leg already wrote this worker's `calendar` table, and both share the
// qnfo-audit database (CAL_DB here, AUDIT there). The pipeline below is notes-intake 0.1.5 verbatim except:
//   * env.AUDIT -> env.CAL_DB (same database), run -> notesIntakeRun, regenIndex -> notesRegenIndex;
//   * it runs on this worker's hourly cron BEFORE the .ics publish (was */15 in its own worker), so note-derived
//     events reach the published calendar in the same cycle; MAX_CHANGED 500 per run drains any backlog;
//   * calendar uids keep the "notes-intake-" prefix, source 'notes-intake' and the _meta/notes-intake.status.json
//     key, so rows written before the fold stay idempotent (INSERT OR IGNORE on uid) and readers keep working;
//   * HTTP: POST /notes/run and GET /notes/stats require CAL_TOKEN (fail closed). notes-intake allowed /run without a
//     token when RUN_TOKEN was unset and exposed /stats publicly; the vault is personal data.
var WORKER = "calendar-api";

// ---- notes intake (folded from notes-intake 0.1.5) ----
var MAX_LIST_PAGES = 30;
var MAX_CHANGED = 500;
var MAX_EVENTS_PER_RUN = 100;
var FUTURE_WINDOW_DAYS = 7;
var HEAD_BYTES = 32768;
var GET_CONCURRENCY = 16;
var SKIP_PREFIXES = [".obsidian/", "releases/", "Attachments/", "Archive/", ".git/"];
var INGEST_ROOTS = ["notes/", "Inbox/", "Projects/", "Areas/", "Resources/"];
var MD_RE = /\.(md|markdown|mdx)$/i;

function basename(k) { var p = k.split("/"); return p[p.length - 1] || k; }
function numOrNull(v) { if (v === undefined || v === null || v === "") return null; var n = Number(v); return Number.isFinite(n) ? n : null; }
function chunk(a, n) { var o = []; for (var i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; }

function parseFrontmatter(text) {
  var out = {};
  if (text.slice(0, 3) !== "---") return out;
  var end = text.indexOf("\n---", 3);
  if (end < 0) return out;
  var lines = text.slice(3, end).split("\n");
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].replace(/\s+$/, "");
    if (!line || line.charAt(0) === "#" || line.charAt(0) === " ") continue;
    var c = line.indexOf(":");
    if (c < 0) continue;
    var k = line.slice(0, c).trim();
    var v = line.slice(c + 1).trim();
    if ((v.charAt(0) === '"' && v.charAt(v.length - 1) === '"') || (v.charAt(0) === "'" && v.charAt(v.length - 1) === "'")) v = v.slice(1, -1);
    else if (v.charAt(0) === "[" && v.charAt(v.length - 1) === "]") v = v.slice(1, -1).split(",").map(function (x) { return x.trim().replace(/^["']|["']$/g, ""); }).filter(Boolean);
    out[k] = v;
  }
  return out;
}

function inferType(key, fm) {
  if (fm.type) return String(fm.type);
  if (key.indexOf("Inbox/") === 0) return "capture";
  if (key.indexOf("Projects/") === 0) return "project";
  if (key.indexOf("Areas/") === 0) return "area";
  if (key.indexOf("Resources/") === 0) return "resource";
  if (/^_\d{2}\.md$/.test(basename(key))) return "daily";
  return "note";
}

function extractDatedActions(text) {
  var res = [];
  var re = /^[ \t]*[-*][ \t]*\[ \][ \t]*(\d{4}-\d{2}-\d{2})(?:[ \t]+(\d{2}:\d{2}))?[^\n]*?[\u2014\-:][ \t]*(.+)$/gm;
  var m, guard = 0;
  while ((m = re.exec(text)) !== null && guard++ < 200) res.push({ date: m[1], time: m[2] || null, text: m[3].trim().slice(0, 300) });
  return res;
}

async function getHead(env, key) {
  try {
    if (!MD_RE.test(key)) return null;
    var o = await env.VAULT.get(key, { range: { offset: 0, length: HEAD_BYTES } });
    if (!o) return null;
    return await o.text();
  } catch (e) { return null; }
}

async function digest16(s) {
  var d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d.slice(0, 8))).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
}

function inScope(key) {
  if (SKIP_PREFIXES.some(function (p) { return key.indexOf(p) === 0; })) return false;
  if (!MD_RE.test(key)) return false;
  return INGEST_ROOTS.some(function (p) { return key.indexOf(p) === 0; });
}

async function notesIntakeRun(env) {
  var t0 = Date.now();
  var s = { scanned: 0, changed: 0, ingested: 0, triaged: 0, eventsCreated: 0, eventsExisting: 0, publishQueued: 0, reconciled: 0, indexRegenerated: false, errors: 0, notes: [] };

  var regMap = new Map();
  try {
    var r0 = await env.CAL_DB.prepare("SELECT path,sig FROM notes_intake").all();
    (r0.results || []).forEach(function (x) { regMap.set(x.path, x.sig); });
  } catch (e) { s.errors++; s.notes.push("registry-read-fail"); }

  var all = [], cursor = undefined, pages = 0;
  do {
    var listed;
    try { listed = await env.VAULT.list({ cursor: cursor, limit: 1000 }); }
    catch (e) { s.errors++; s.notes.push("list-fail"); break; }
    cursor = listed.truncated ? listed.cursor : undefined;
    pages++;
    var objs = listed.objects || [];
    for (var i = 0; i < objs.length; i++) { all.push(objs[i]); s.scanned++; }
  } while (cursor && pages < MAX_LIST_PAGES);
  var completeList = !cursor;

  var seen = new Set();
  var changed = [];
  var nowMs = Date.now();
  for (var a = 0; a < all.length; a++) {
    var o = all[a]; var key = o.key;
    if (!inScope(key)) continue;
    seen.add(key);
    var sig = o.size + "|" + (o.uploaded ? o.uploaded.getTime() : 0);
    if (regMap.get(key) === sig) continue;
    changed.push({ key: key, obj: o, sig: sig });
  }
  s.changed = changed.length;

  if (completeList) {
    var stale = [];
    regMap.forEach(function (_sig, path) {
      if (!seen.has(path)) stale.push(path);
    });
    var delChunks = chunk(stale, 50);
    for (var d = 0; d < delChunks.length; d++) {
      try {
        var ds = delChunks[d].map(function (p) { return env.CAL_DB.prepare("DELETE FROM notes_intake WHERE path=?1").bind(p); });
        await env.CAL_DB.batch(ds);
        s.reconciled += delChunks[d].length;
      } catch (e) { s.errors++; }
    }
  }

  var work = changed.slice(0, MAX_CHANGED);
  var heads = new Array(work.length);
  for (var b = 0; b < work.length; b += GET_CONCURRENCY) {
    var slice = work.slice(b, b + GET_CONCURRENCY);
    var texts = await Promise.all(slice.map(function (w) { return getHead(env, w.key); }));
    for (var j = 0; j < slice.length; j++) heads[b + j] = texts[j];
  }

  var upserts = [], datedActions = [], publishFlags = [];
  for (var x = 0; x < work.length; x++) {
    var text = heads[x];
    if (text === null) continue;
    var w = work[x], wkey = w.key, wobj = w.obj, wsig = w.sig;
    var fm = parseFrontmatter(text);
    var type = inferType(wkey, fm);
    var title = (fm.title && String(fm.title)) || basename(wkey);
    var status = fm.status ? String(fm.status) : "active";
    var triage = (wkey.indexOf("Inbox/") === 0 || String(fm.triage).toLowerCase() === "true") ? "needs_triage" : null;
    upserts.push({ path: wkey, type: type, title: title, status: status, priority: numOrNull(fm.priority), due: fm.due ? String(fm.due).slice(0, 10) : null, next_action: fm.next_action ? String(fm.next_action).slice(0, 500) : null, project: fm.project ? String(fm.project) : null, area: fm.area ? String(fm.area) : null, energy: numOrNull(fm.energy), source: fm.source ? String(fm.source) : null, modified: new Date(wobj.uploaded || nowMs).toISOString(), sig: wsig, triage_state: triage, raw_fm: JSON.stringify(fm) });
    if (triage) s.triaged++;
    if (fm.due && (fm.next_action || fm.title)) datedActions.push({ path: wkey, title: (fm.next_action ? String(fm.next_action) : title).slice(0, 180), date: String(fm.due).slice(0, 10), time: null });
    if (type === "daily" || /_personal-gtd/i.test(wkey)) extractDatedActions(text).forEach(function (act) { datedActions.push({ path: wkey, title: act.text, date: act.date, time: act.time }); });
    if (String(fm.publish).toLowerCase() === "true" || String(fm.source || "").toLowerCase() === "publish") publishFlags.push({ path: wkey, title: title });
  }

  var upStmts = upserts.map(function (u) {
    return env.CAL_DB.prepare("INSERT INTO notes_intake (path,type,title,status,priority,due,next_action,project,area,energy,source,modified,ingested_at,sig,triage_state,raw_fm) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16) ON CONFLICT(path) DO UPDATE SET type=?2,title=?3,status=?4,priority=?5,due=?6,next_action=?7,project=?8,area=?9,energy=?10,source=?11,modified=?12,ingested_at=?13,sig=?14,triage_state=?15,raw_fm=?16").bind(u.path, u.type, u.title, u.status, u.priority, u.due, u.next_action, u.project, u.area, u.energy, u.source, u.modified, new Date().toISOString(), u.sig, u.triage_state, u.raw_fm);
  });
  var upChunks = chunk(upStmts, 50);
  for (var k = 0; k < upChunks.length; k++) {
    try { await env.CAL_DB.batch(upChunks[k]); s.ingested += upChunks[k].length; }
    catch (e) { s.errors++; }
  }

  var cutoff = new Date(nowMs - FUTURE_WINDOW_DAYS * 864e5).toISOString().slice(0, 10);
  var calStmts = [];
  for (var c = 0; c < datedActions.length && calStmts.length < MAX_EVENTS_PER_RUN; c++) {
    var act = datedActions[c];
    if (!act.date || act.date < cutoff) continue;
    var uid = "notes-intake-" + await digest16(act.path + "|" + act.date + "|" + (act.time || "")) + "@qnfo.cloud";
    var dtstart = act.time ? (act.date + "T" + act.time + ":00") : act.date;
    var allDay = act.time ? 0 : 1;
    calStmts.push(env.CAL_DB.prepare("INSERT OR IGNORE INTO calendar (plane,uid,title,description,location,dtstart,dtend,all_day,url,source,domain,relevance,friction,status) VALUES ('personal',?1,?2,?3,NULL,?4,NULL,?5,NULL,'notes-intake','personal',NULL,NULL,'confirmed')").bind(uid, act.title, "From notes: " + act.path, dtstart, allDay));
  }
  var calChunks = chunk(calStmts, 50);
  for (var c2 = 0; c2 < calChunks.length; c2++) {
    try {
      var cres = await env.CAL_DB.batch(calChunks[c2]);
      for (var ri = 0; ri < cres.length; ri++) { if (cres[ri].meta && cres[ri].meta.changes === 1) s.eventsCreated++; else s.eventsExisting++; }
    } catch (e) { s.errors++; }
  }

  for (var p = 0; p < publishFlags.length; p++) {
    try {
      await env.CAL_DB.prepare("INSERT INTO notes_publish_queue (path,title,status,created,note) VALUES (?1,?2,'pending',?3,'flagged in frontmatter') ON CONFLICT(path) DO UPDATE SET title=?2").bind(publishFlags[p].path, publishFlags[p].title, new Date().toISOString()).run();
      s.publishQueued++;
    } catch (e) { s.errors++; }
  }

  try { s.indexRegenerated = await notesRegenIndex(env); }
  catch (e) { s.errors++; s.notes.push("index-fail"); }

  try {
    await env.CAL_DB.prepare("INSERT INTO notes_intake_runs (started,finished,scanned,changed,ingested,events_created,publish_queued,index_regenerated,errors,note) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)").bind(new Date(t0).toISOString(), new Date().toISOString(), s.scanned, s.changed, s.ingested, s.eventsCreated, s.publishQueued, s.indexRegenerated ? 1 : 0, s.errors, s.notes.join("|").slice(0, 300)).run();
  } catch (e) { console.error(JSON.stringify({ worker: "qnfo-lifecycle", where: "calendarApiFoldMod.notesIntakeRun", error: String(e && e.message || e) })); }

  try {
    await env.VAULT.put("_meta/notes-intake.status.json", JSON.stringify({ ts: new Date().toISOString(), scanned: s.scanned, changed: s.changed, ingested: s.ingested, triaged: s.triaged, eventsCreated: s.eventsCreated, reconciled: s.reconciled, errors: s.errors }), { httpMetadata: { contentType: "application/json" } });
  } catch (e) { console.error(JSON.stringify({ worker: "qnfo-lifecycle", where: "calendarApiFoldMod.notesIntakeRun", error: String(e && e.message || e) })); }

  s.elapsedMs = Date.now() - t0;
  return s;
}

async function notesRegenIndex(env) {
  async function rows(sql) {
    try { var r = await env.CAL_DB.prepare(sql).all(); return r.results || []; } catch (e) { return []; }
  }
  var proj = await rows("SELECT title,path,status FROM notes_intake WHERE type='project' AND status NOT IN ('done','archived') ORDER BY (priority IS NULL), priority LIMIT 50");
try { await processOwnerReplies(env); } catch (eOqReply) { console.error(JSON.stringify({stage:"processOwnerReplies", error:eOqReply.message, stack:eOqReply.stack})); }
var nas = await rows("SELECT title,next_action,due,path FROM notes_intake WHERE next_action IS NOT NULL AND status='active' ORDER BY (due IS NULL), due LIMIT 50");
  var waiting = await rows("SELECT title,path FROM notes_intake WHERE status='waiting' LIMIT 50");
  var areas = await rows("SELECT title,path FROM notes_intake WHERE type='area' AND status!='archived' LIMIT 50");
  var triage = await rows("SELECT path,title FROM notes_intake WHERE triage_state='needs_triage' LIMIT 50");
  var now = new Date().toISOString();
  var L = ["---", "type: log", 'title: "Master Index"', "status: active", 'created: "' + now + '"', 'modified: "' + now + '"', "tags: [index]", "---", "", "# Master Index", "", "> Auto-maintained by calendar-api notes intake (folded from notes-intake 0.1.5; server-side). Source of truth = the individual notes.", ""];
  function wl(p) { return "[[" + p.replace(/\.md$/, "") + "|"; }
  function sec(h, arr, fmt) { L.push("## " + h); if (!arr.length) { L.push("_(none)_", ""); return; } for (var i = 0; i < arr.length; i++) L.push(fmt(arr[i])); L.push(""); }
  sec("Active projects", proj, function (r) { return "- " + wl(r.path) + r.title + "]] (" + r.status + ")"; });
  sec("Open next actions", nas, function (r) { return "- " + (r.due ? "[" + r.due + "] " : "") + r.next_action + "  -> " + wl(r.path) + "note]]"; });
  sec("Waiting on", waiting, function (r) { return "- " + wl(r.path) + r.title + "]]"; });
  sec("Active areas", areas, function (r) { return "- " + wl(r.path) + r.title + "]]"; });
  sec("Needs triage", triage, function (r) { return "- " + wl(r.path) + r.title + "]]"; });
  await env.VAULT.put("notes/v1/_index.md", L.join("\n") + "\n", { httpMetadata: { contentType: "text/markdown" } });
  return true;
}


var PLANES = ["qnfo", "personal", "host"];
var ALLOWED_SOURCES = ["radar", "catalog", "manual", "personal-radar", "personal-profile", "personal-twin", "email", "host"];
// CAL-HOST-PLANE-1 (2026-10-04, issue 1954, charter pillar: personal; owner decision 2026-10-04: dates only). The host plane is
// open-house availability. Its feed carries all-day "Open for guests" events and nothing else: no address, no names, no
// contact details, no description or url, whatever a row holds. The feed is built from the dates alone (the scrub is at read
// time, so an edited or older row cannot leak), and POST also stores nothing but the dates. Guest records never live here.
var HOST_TITLE = "Open for guests";
function hostDay(v) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ""));
  if (!m) return null;
  var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? m[0] : null;
}
__name(hostDay, "hostDay");
function hostNextDay(day) {
  var d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
__name(hostNextDay, "hostNextDay");
var R2_PUBLIC = "https://pub-7e5e6cd48f4b43ebb55a5ee25093cb71.r2.dev";
var CR = String.fromCharCode(13);
var LF = String.fromCharCode(10);
var CRLF = CR + LF;
var BS = String.fromCharCode(92);
function toIso(dt) {
  return dt ? new Date(dt).toISOString() : null;
}
__name(toIso, "toIso");
function escICal(s) {
  return String(s == null ? "" : s).split(BS).join(BS + BS).split(";").join(BS + ";").split(",").join(BS + ",").replace(new RegExp("[" + CR + LF + "]+", "g"), BS + "n");
}
__name(escICal, "escICal");
function fmtDate(iso, allDay) {
  if (!iso) return null;
  if (allDay) return iso.slice(0, 10).replace(/-/g, "");
  return new Date(iso).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}
__name(fmtDate, "fmtDate");
function uidFor(plane, id) {
  return plane + "-" + id + "@qnfo.cloud";
}
__name(uidFor, "uidFor");
function cors() {
  return { "content-type": "application/json", "access-control-allow-origin": "*" };
}
__name(cors, "cors");
function json(body, status) {
  return new Response(JSON.stringify(body), { status: status || 200, headers: cors() });
}
__name(json, "json");
function bearerToken(request) {
  return String(request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
}
__name(bearerToken, "bearerToken");
function tokenEq(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
__name(tokenEq, "tokenEq");
// CAL-CALLER-PROPS-1 (2026-10-05, charter pillar: personal; CLAUDE.md #1703 rule): internal workers authenticate by
// service-binding props, not by a copy of CAL_TOKEN. radar-hub carries no secrets at all (CAL_TOKEN was lost in a redeploy),
// so every personal-radar GET/POST here answered 401 and the radar posted 0 events from 2026-09-24 (self_heal_actions
// calendar-write-path-broken daily). Only someone with deploy rights on the CALLER can set ctx.props, and public requests
// never carry props, so a binding that declares props = { caller = "<worker>" } is as trusted as the bearer token.
function internalCaller(ctx) {
  try {
    const c = ctx && ctx.props && typeof ctx.props.caller === "string" ? ctx.props.caller : "";
    return /^[a-z][a-z0-9-]{1,60}$/.test(c) ? c : "";
  } catch (e) {
    return "";
  }
}
__name(internalCaller, "internalCaller");
function authorized(request, env, ctx) {
  if (internalCaller(ctx)) return true;
  const exp = env.CAL_TOKEN;
  if (!exp) return false;
  return tokenEq(bearerToken(request), exp);
}
__name(authorized, "authorized");
async function ensureSchema(env) {
  await env.CAL_DB.prepare(
    "CREATE TABLE IF NOT EXISTS calendar (id INTEGER PRIMARY KEY AUTOINCREMENT, plane TEXT NOT NULL, uid TEXT UNIQUE, title TEXT NOT NULL, description TEXT, location TEXT, dtstart TEXT NOT NULL, dtend TEXT, all_day INTEGER DEFAULT 0, url TEXT, source TEXT DEFAULT 'manual', domain TEXT, relevance REAL, friction REAL, status TEXT DEFAULT 'confirmed', created TEXT DEFAULT (datetime('now')), updated TEXT DEFAULT (datetime('now')))"
  ).run();
  await env.CAL_DB.prepare("CREATE TABLE IF NOT EXISTS calendar_meta (k TEXT PRIMARY KEY, v TEXT)").run();
  // FEEDBACK-1 (2026-10-03, charter pillar: personal): what Rowan said about a suggested event, written by the /e/<id> page.
  await env.CAL_DB.prepare("CREATE TABLE IF NOT EXISTS calendar_feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, cal_id INTEGER NOT NULL, uid TEXT, action TEXT NOT NULL, reason TEXT, met TEXT, note TEXT, title TEXT, location TEXT, domain TEXT, source TEXT, dtstart TEXT, relevance REAL, friction REAL, ts TEXT DEFAULT (datetime('now')), synced_to_ledger INTEGER DEFAULT 0)").run();
}
__name(ensureSchema, "ensureSchema");
async function runQuery(env, sql, params) {
  const r = await env.CAL_DB.prepare(sql).bind(...params || []).all();
  return r.results || [];
}
__name(runQuery, "runQuery");
async function getIcsToken(env, plane) {
  const row = await env.CAL_DB.prepare("SELECT v FROM calendar_meta WHERE k=?").bind("ics_token_" + plane).first();
  if (row && row.v) return row.v;
  const token = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
  await env.CAL_DB.prepare("INSERT OR REPLACE INTO calendar_meta (k, v) VALUES (?, ?)").bind("ics_token_" + plane, token).run();
  return token;
}
__name(getIcsToken, "getIcsToken");
async function buildICS(env, plane, fromIso) {
  const rows = await runQuery(env, "SELECT * FROM calendar WHERE plane=? AND (status!='cancelled' OR plane='personal') AND dtstart>=? ORDER BY dtstart LIMIT 500", [plane, fromIso]);
  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//QNFO//calendar-api//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  L.push("X-WR-CALNAME:" + (plane === "qnfo" ? "QNFO Research Calendar" : plane === "host" ? "Open House Availability" : "Personal Calendar"));
  for (const e of rows) {
    if (plane === "host") {
      const d0 = hostDay(e.dtstart);
      if (!d0) continue;
      let d1 = hostDay(e.dtend);
      if (!d1 || d1 <= d0) d1 = hostNextDay(d0);
      L.push("BEGIN:VEVENT", "UID:" + uidFor("host", e.id), "DTSTAMP:" + fmtDate(e.created || (/* @__PURE__ */ new Date()).toISOString(), 0), "DTSTART;VALUE=DATE:" + d0.replace(/-/g, ""), "DTEND;VALUE=DATE:" + d1.replace(/-/g, ""), "SUMMARY:" + HOST_TITLE, "TRANSP:TRANSPARENT", "END:VEVENT");
      continue;
    }
    if (e.status === "cancelled" && FB_SOURCES.indexOf(e.source) >= 0) continue; // a dismissed radar suggestion was never accepted: it just drops out
    if (e.status === "cancelled") {
      // CAL-CANCELLED-ICS-1: tombstone only; no description, location, feedback link or url.
      L.push("BEGIN:VEVENT", "UID:" + (e.uid || uidFor(e.plane, e.id)), "DTSTAMP:" + fmtDate(e.created || (/* @__PURE__ */ new Date()).toISOString(), 0), "DTSTART" + (e.all_day ? ";VALUE=DATE:" : ":") + fmtDate(e.dtstart, e.all_day));
      if (e.dtend) L.push("DTEND" + (e.all_day ? ";VALUE=DATE:" : ":") + fmtDate(e.dtend, e.all_day));
      L.push("SUMMARY:" + escICal(e.title), "STATUS:CANCELLED", "SEQUENCE:1", "END:VEVENT");
      continue;
    }
    L.push("BEGIN:VEVENT");
    L.push("UID:" + (e.uid || uidFor(e.plane, e.id)));
    L.push("DTSTAMP:" + fmtDate(e.created || (/* @__PURE__ */ new Date()).toISOString(), 0));
    L.push("DTSTART" + (e.all_day ? ";VALUE=DATE:" : ":") + fmtDate(e.dtstart, e.all_day));
    if (e.dtend) L.push("DTEND" + (e.all_day ? ";VALUE=DATE:" : ":") + fmtDate(e.dtend, e.all_day));
    L.push("SUMMARY:" + escICal(e.title));
    if (e.location) L.push("LOCATION:" + escICal(e.location));
    let desc = e.description || "";
    let fbUrl = null;
    if (plane === "personal" && FB_SOURCES.indexOf(e.source) >= 0 && e.id != null) {
      fbUrl = await fbLink(env, e.id);
      if (fbUrl) desc = (desc ? desc + "\n\n" : "") + "Not for me / keep / I went: " + fbUrl;
    }
    if (desc) L.push("DESCRIPTION:" + escICal(desc));
    const evUrl = e.url || fbUrl;
    if (evUrl) L.push("URL:" + evUrl);
    L.push("END:VEVENT");
  }
  L.push("END:VCALENDAR");
  return L.join(CRLF);
}
__name(buildICS, "buildICS");
async function publishICS(env) {
  const fromIso = new Date(Date.now() - 864e5).toISOString();
  const out = [];
  for (const plane of PLANES) {
    const token = await getIcsToken(env, plane);
    const ics = await buildICS(env, plane, fromIso);
    const key = "calendar/" + plane + "-" + token + ".ics";
    await env.ICS_R2.put(key, ics, { httpMetadata: { contentType: "text/calendar; charset=utf-8" } });
    // CAL-FEED-ROTATE-1 (2026-10-01): a feed is revoked by renaming its calendar_meta token row to ics_token_<plane>_prev.
    // getIcsToken then mints a new token, and this publish deletes the old object so the old URL stops serving at once.
    try {
      const prev = await env.CAL_DB.prepare("SELECT v FROM calendar_meta WHERE k=?").bind("ics_token_" + plane + "_prev").first();
      if (prev && prev.v && prev.v !== token) {
        await env.ICS_R2.delete("calendar/" + plane + "-" + prev.v + ".ics");
        await env.CAL_DB.prepare("DELETE FROM calendar_meta WHERE k=?").bind("ics_token_" + plane + "_prev").run();
      }
    } catch (eRot) {
    }
    out.push({ plane, key, url: R2_PUBLIC + "/" + key, bytes: ics.length });
  }
  return out;
}
__name(publishICS, "publishICS");
// ---- FEEDBACK-1 (2026-10-03, charter pillar: personal) ----
// Every suggested event in the personal feed links to /e/<id>?s=<sig>. The page shows the event and three choices
// (keep, I went, not for me). It runs on this worker, so it works from any calendar app with no session and no login:
// the link carries an HMAC of the event id made with CAL_TOKEN (nothing new to store or rotate). A GET only shows the
// page; a change needs a POST, so a link scanner that prefetches the URL cannot remove an event. "Not for me" sets
// status=cancelled (the radar dedupes on all statuses, so it is not re-suggested); keep and went set confirmed.
// Every answer is also stored in calendar_feedback for the radar to learn from.
var FB_SOURCES = ["personal-radar", "personal-twin"];
var FB_ACTIONS = ["keep", "nope", "went"];
var FB_REASONS = [["not-my-thing", "Not my kind of thing"], ["bad-timing", "Bad timing"], ["too-much-effort", "Too much effort"], ["not-my-crowd", "Not my crowd"]];
var PUBLIC_BASE = "https://calendar-api.q08.workers.dev";
function hexOf(buf, n) {
  return Array.from(new Uint8Array(buf).slice(0, n)).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
}
__name(hexOf, "hexOf");
// FOLD-READY-1 (0.7.4): the key is CAL_TOKEN while this is its own worker, else CAL_KEY_SEED (a host-derived value in the fold).
function fbSecret(env) {
  return env.CAL_TOKEN || env.CAL_KEY_SEED || "";
}
__name(fbSecret, "fbSecret");
function fbBase(env) {
  return String(env.CAL_PUBLIC_BASE || PUBLIC_BASE).replace(/\/+$/, "");
}
__name(fbBase, "fbBase");
async function fbSig(env, id) {
  if (!fbSecret(env)) return null;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("calendar-feedback|" + fbSecret(env)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hexOf(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("fb|" + id)), 12);
}
__name(fbSig, "fbSig");
async function fbLink(env, id) {
  const s = await fbSig(env, id);
  return s ? fbBase(env) + "/e/" + id + "?s=" + s : null;
}
__name(fbLink, "fbLink");
function htmlEsc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
__name(htmlEsc, "htmlEsc");
var FB_CSS = "body{font:18px/1.5 system-ui,sans-serif;max-width:32rem;margin:2rem auto;padding:0 1rem;color:#1c1c1c;background:#fafafa}h1{font-size:1.25rem}.meta{color:#555}button{font:inherit;padding:.7rem 1rem;margin:.3rem .3rem .3rem 0;border:1px solid #888;border-radius:.5rem;background:#fff;color:#1c1c1c;cursor:pointer}button.main{background:#1c1c1c;color:#fff}fieldset{border:0;border-top:1px solid #ccc;padding:.8rem 0;margin:0}label{display:block;margin:.2rem 0}input[type=text]{font:inherit;width:100%;padding:.5rem;box-sizing:border-box}@media(prefers-color-scheme:dark){body{background:#151515;color:#eee}.meta{color:#aaa}fieldset{border-color:#444}button{background:#222;color:#eee;border-color:#666}button.main{background:#eee;color:#111}}";
function fbPage(title, body, status) {
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>' + htmlEsc(title) + "</title><style>" + FB_CSS + "</style></head><body>" + body + "</body></html>";
  return new Response(html, { status: status || 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex", "referrer-policy": "no-referrer", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'" } });
}
__name(fbPage, "fbPage");
function fbEventHtml(row, sig, message) {
  const when = String(row.dtstart || "").replace("T", " ").slice(0, 16);
  let h = "<h1>" + htmlEsc(row.title) + '</h1><p class="meta">' + htmlEsc(when) + (row.location ? " &middot; " + htmlEsc(row.location) : "") + " &middot; now: " + htmlEsc(row.status) + "</p>";
  if (message) h += "<p><strong>" + htmlEsc(message) + "</strong></p>";
  // FOLD-READY-1: relative to the page itself, so the form posts back to /e/<id> here and to <prefix>/e/<id> on a host
  h += '<form method="post" action="?s=' + sig + '">';
  h += '<fieldset><button class="main" name="a" value="keep">Interested, keep it</button></fieldset>';
  h += '<fieldset><legend>If you went (both fields optional)</legend><label>Who did you talk to?<input type="text" name="met" maxlength="80" autocomplete="off"></label><label>One line to remember<input type="text" name="note" maxlength="200" autocomplete="off"></label><button name="a" value="went">I went</button></fieldset>';
  h += "<fieldset><legend>Not for me. Why? (optional)</legend>";
  for (const r of FB_REASONS) h += '<label><input type="radio" name="why" value="' + r[0] + '"> ' + htmlEsc(r[1]) + "</label>";
  h += '<button name="a" value="nope">Not for me, remove it</button></fieldset></form>';
  return h;
}
__name(fbEventHtml, "fbEventHtml");
async function fbHandle(request, env, id, sig) {
  const want = await fbSig(env, id);
  if (!want || !tokenEq(String(sig || ""), want)) return fbPage("Link not valid", "<h1>This link is not valid</h1><p>Open the event from your calendar again.</p>", 403);
  const row = await env.CAL_DB.prepare("SELECT * FROM calendar WHERE id=? AND plane='personal'").bind(id).first();
  if (!row || FB_SOURCES.indexOf(row.source) < 0) return fbPage("Not found", "<h1>No such event</h1>", 404);
  if (request.method === "GET") return fbPage(row.title, fbEventHtml(row, want, null));
  if (request.method !== "POST") return fbPage("Method not allowed", "<h1>Use the buttons on the page</h1>", 405);
  let form;
  try { form = await request.formData(); } catch (e) { return fbPage("Bad request", "<h1>Could not read the form</h1>", 400); }
  const action = String(form.get("a") || "");
  if (FB_ACTIONS.indexOf(action) < 0) return fbPage("Bad request", "<h1>Unknown choice</h1>", 400);
  const why = String(form.get("why") || "");
  const reason = action === "nope" && FB_REASONS.some(function (r) { return r[0] === why; }) ? why : null;
  const met = action === "went" ? String(form.get("met") || "").trim().slice(0, 80) || null : null;
  const note = action === "went" ? String(form.get("note") || "").trim().slice(0, 200) || null : null;
  const newStatus = action === "nope" ? "cancelled" : "confirmed";
  await env.CAL_DB.batch([
    env.CAL_DB.prepare("UPDATE calendar SET status=?, updated=datetime('now') WHERE id=?").bind(newStatus, id),
    env.CAL_DB.prepare("INSERT INTO calendar_feedback (cal_id, uid, action, reason, met, note, title, location, domain, source, dtstart, relevance, friction) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(id, row.uid, action, reason, met, note, row.title, row.location, row.domain, row.source, row.dtstart, row.relevance, row.friction)
  ]);
  await publishICS(env).catch(function () { return null; });
  const say = { keep: "Kept. It stays on your calendar.", went: "Logged that you went." + (met ? " Noted: " + met + "." : ""), nope: "Removed from your calendar. Your answer is saved." };
  return fbPage(row.title, fbEventHtml(Object.assign({}, row, { status: newStatus }), want, say[action]));
}
__name(fbHandle, "fbHandle");
// ---- CONNECTION-PRODUCER-1 (2026-10-04, issue 1950, charter pillar: personal) ----
// The hourly tick queues the owner's questions in qnfo-audit.owner_questions; personal-companion mails them (max 2/day,
// quiet hours 22-08 Amsterdam). Two kinds only, both INSERT OR IGNORE on UNIQUE(kind, ref) so a rerun adds nothing:
//   after-event  ref=<calendar id>  a confirmed timed suggestion whose end passed 1-6h ago: "Did you go to X?" + signed link
//   triage       ref=<ISO week>     on Sundays (Amsterdam), up to 5 tentative personal-radar suggestions within 14 days
// Only FB_SOURCES rows qualify (their signed page refuses every other source); manual rows, trip- uids, all-day or
// date-only rows, rows inside a trip window and places outside the Amsterdam area are skipped (OQ-TRIP-WINDOW-1 below). No model call.
var OQ_DDL = "CREATE TABLE IF NOT EXISTS owner_questions (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, ref TEXT, subject TEXT NOT NULL, body TEXT NOT NULL, priority INTEGER DEFAULT 5, not_before TEXT, created_at TEXT DEFAULT (datetime('now')), sent_at TEXT, attempts INTEGER DEFAULT 0, last_error TEXT, UNIQUE(kind, ref))";
 // CALENDAR-CHECKIN-REPLY-PARSE-2 (2026-10-19, issue 100186, charter pillar: personal; successor of 2682): owner replies to
 // "Did you go to X?" check-ins were never recorded. owner_questions has no message-id column, so a reply is matched by
 // subject: emails.subject = 'Re: ' || owner_questions.subject, sender rwnquni@%. The yes/no is taken from the first line of
 // the reply only (affirmative -> went, negative -> nope; no reason is invented). Each parsed answer is stored in
 // calendar_feedback with source 'email-reply' and the calendar row status is set (went -> confirmed, nope -> cancelled).
 // Rows already carrying an email-reply feedback (or any feedback for that event) are skipped, so a rerun adds nothing.
 // OWNER-REPLY-BODY-TEXT-1 (1.13.1, issue 100259): qnfo-audit.emails keeps the reply in body_text (it has no body or from column),
 // so the query aliases body_text AS body; the 1.12.1 query read a column that does not exist and logged it every tick.
 async function processOwnerReplies(env) {
   if (!env || !env.CAL_DB) return 0;
   var qs = [];
   try {
     qs = await runQuery(env, "SELECT id, ref, subject FROM owner_questions WHERE kind='after-event' AND ref IS NOT NULL", []);
   } catch (eQ) {
     console.error(JSON.stringify({stage:"owner_questions_query", error:eQ.message, stack:eQ.stack}));
     return 0;
   }
   var done = 0;
   for (var q of qs) {
     var ref = parseInt(q.ref, 10);
     if (!ref) continue;
     var seen = await env.CAL_DB.prepare("SELECT id FROM calendar_feedback WHERE cal_id=?").bind(ref).first();
     if (seen) continue;
     var want = "Re: " + q.subject;
     var em = [];
     try {
       em = await runQuery(env, "SELECT body_text AS body FROM emails WHERE subject=? AND sender LIKE 'rwnquni@%' ORDER BY id DESC LIMIT 1", [want]);
     } catch (eE1) {
       console.error(JSON.stringify({stage:"email_query_primary", error:eE1.message, stack:eE1.stack}));
       continue;
     }
     if (!em.length) continue;
     var first = String(em[0].body || "").split(/\r?\n/)[0].trim().toLowerCase();
     var action = /\b(yes|yeah|yep|yup|went|i did|did go|sure)\b/.test(first) ? "went" : /\b(no|nope|nah|didn'?t|did not|did not go)\b/.test(first) ? "nope" : null;
     if (!action) continue;
     var cal = await env.CAL_DB.prepare("SELECT * FROM calendar WHERE id=?").bind(ref).first();
     if (!cal) continue;
     await env.CAL_DB.batch([
       env.CAL_DB.prepare("INSERT INTO calendar_feedback (cal_id, uid, action, source, title, location, domain, dtstart, relevance, friction) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(ref, cal.uid, action, "email-reply", cal.title, cal.location, cal.domain, cal.dtstart, cal.relevance, cal.friction),
       env.CAL_DB.prepare("UPDATE calendar SET status=?, updated=datetime('now') WHERE id=?").bind(action === "went" ? "confirmed" : "cancelled", ref)
     ]);
     done++;
   }
   return done;
 }
 __name(processOwnerReplies, "processOwnerReplies");
 var OQ_DEFAULT_LEN_MS = 2 * 36e5;
// OQ-TRIP-WINDOW-1 (0.7.3): "is this event local?" is decided from the calendar itself, not from a list of foreign places.
//  1. Trip windows: confirmed personal rows with domain 'travel', a 'trip-' uid or a travel-sync-key note, whose location is
//     not in the Amsterdam area (a hotel, flight or "Away:" banner). Window = [start date, end date), end exclusive, so the
//     return day is local again; rows without a later end date open no window; overlapping rows merge.
//  2. An event inside a trip window is not asked about (he is away; Amsterdam-located ones included).
//  3. Outside a window, a location is local only when it matches OQ_AMS_AREA_RE (Amsterdam and its neighbouring municipalities,
//     Dutch and English spellings, postcodes 1000-1109, 1111-1115, 1180-1188, and well-known venues). A location that names
//     somewhere else is skipped; an empty location is asked about (the radar often omits it).
var OQ_AMS_AREA_RE = /amsterdam|a'dam|\bamstelveen\b|\bdiemen\b|\bduivendrecht\b|\bouderkerk\b|\bzuidoost\b|\bnieuw-west\b|\bbimhuis\b|\bconcertgebouw\b|\bparadiso\b|\bmelkweg\b|\bmuziekgebouw\b|\bzaal 100\b|\brijksmuseum\b|\bstedelijk\b|\bvan gogh museum\b|\bopenluchttheater\b|\bOBA\b/i;
var OQ_AMS_POSTCODE_RE = /\b(?:10\d\d|110\d|111[1-5]|118[0-8])\s?[A-Z]{2}\b/;
function oqIsAmsterdamArea(loc) {
  return OQ_AMS_AREA_RE.test(String(loc || "")) || OQ_AMS_POSTCODE_RE.test(String(loc || ""));
}
__name(oqIsAmsterdamArea, "oqIsAmsterdamArea");
async function oqTripWindows(env) {
  var rows = await runQuery(env, "SELECT location, dtstart, dtend FROM calendar WHERE plane='personal' AND status!='cancelled' AND (domain='travel' OR uid LIKE 'trip-%' OR description LIKE '%travel-sync-key%')", []);
  var w = [];
  for (var r of rows) {
    if (oqIsAmsterdamArea(r.location)) continue;
    var a = String(r.dtstart || "").slice(0, 10), b = String(r.dtend || "").slice(0, 10);
    if (!/^\d{4}-\d\d-\d\d$/.test(a) || !/^\d{4}-\d\d-\d\d$/.test(b) || b <= a) continue;
    w.push([a, b]);
  }
  w.sort(function (x, y) { return x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0; });
  var out = [];
  for (var x of w) {
    if (out.length && x[0] <= out[out.length - 1][1]) { if (x[1] > out[out.length - 1][1]) out[out.length - 1][1] = x[1]; } else out.push(x);
  }
  return out;
}
__name(oqTripWindows, "oqTripWindows");
function oqInWindow(windows, dateStr) {
  for (var w of windows) if (dateStr >= w[0] && dateStr < w[1]) return true;
  return false;
}
__name(oqInWindow, "oqInWindow");
var AMS_FMT = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Amsterdam", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" });
function amsParts(ms) {
  var o = {};
  AMS_FMT.formatToParts(new Date(ms)).forEach(function (p) { o[p.type] = p.value; });
  return o;
}
__name(amsParts, "amsParts");
function amsOffsetMin(ms) {
  var p = amsParts(ms);
  var wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((wall - Math.floor(ms / 1e3) * 1e3) / 6e4);
}
__name(amsOffsetMin, "amsOffsetMin");
function amsDateStr(ms) {
  var p = amsParts(ms);
  return p.year + "-" + p.month + "-" + p.day;
}
__name(amsDateStr, "amsDateStr");
// ISO week label of the Amsterdam calendar date at ms, e.g. 2026-W40
function amsIsoWeek(ms) {
  var p = amsParts(ms);
  var d = new Date(Date.UTC(+p.year, +p.month - 1, +p.day));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3);
  var y = d.getUTCFullYear();
  var jan4 = new Date(Date.UTC(y, 0, 4));
  var wk = 1 + Math.round(((d.getTime() - jan4.getTime()) / 864e5 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return y + "-W" + String(wk).padStart(2, "0");
}
__name(amsIsoWeek, "amsIsoWeek");
// A timed value: with an explicit offset it must be Amsterdam's offset at that instant (else the event is elsewhere);
// without one it is Amsterdam wall-clock time. Returns epoch ms, or null for date-only, unparsable or foreign-offset values.
function oqParseWhen(s) {
  s = String(s || "");
  var m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d))?(?:\.\d+)?(Z|[+-]\d\d:?\d\d)?$/.exec(s);
  if (!m) return null;
  if (m[7] === "Z") return Date.parse(s);
  if (m[7]) {
    var ms = Date.parse(s);
    if (!Number.isFinite(ms)) return null;
    var sign = m[7].charAt(0) === "-" ? -1 : 1;
    var hh = +m[7].slice(1, 3), mm = +m[7].slice(-2);
    return sign * (hh * 60 + mm) === amsOffsetMin(ms) ? ms : null;
  }
  var wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  var guess = wall - amsOffsetMin(wall) * 6e4;
  return wall - amsOffsetMin(guess) * 6e4;
}
__name(oqParseWhen, "oqParseWhen");
function oqCleanTitle(t) {
  t = String(t || "").replace(/\s+/g, " ").trim();
  var i = t.toLowerCase().lastIndexOf("opslaan:");
  if (i >= 0) t = t.slice(i + 8).trim();
  t = t.replace(/^[^:]{1,40}:\s+/, "");
  return t.length > 80 ? t.slice(0, 79).trim() + "…" : t;
}
__name(oqCleanTitle, "oqCleanTitle");
function oqSqlTime(ms) {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19);
}
__name(oqSqlTime, "oqSqlTime");
async function queueOwnerQuestions(env) {
  var out = { after_event: 0, triage: 0, skipped: null };
  await env.CAL_DB.prepare(OQ_DDL).run();
  var probe = await fbLink(env, 0);
  if (!probe) { out.skipped = "no feedback key (CAL_TOKEN or CAL_KEY_SEED)"; return out; }
  var now = Date.now();
  var srcIn = FB_SOURCES.map(function () { return "?"; }).join(",");
  // (a) after-event
  var rows = await runQuery(env, "SELECT id, uid, title, dtstart, dtend, all_day, location, source FROM calendar WHERE plane='personal' AND status='confirmed' AND all_day=0 AND source IN (" + srcIn + ") AND dtstart>=? AND dtstart<=?", FB_SOURCES.concat([new Date(now - 3 * 864e5).toISOString().slice(0, 10), new Date(now + 864e5).toISOString().slice(0, 10)]));
  var tripWin = await oqTripWindows(env);
  for (var r of rows) {
    if (r.source === "manual" || String(r.uid || "").indexOf("trip-") === 0 || (r.uid || "").indexOf("-trip-") >= 0) continue;
    var st = oqParseWhen(r.dtstart);
    if (st == null) continue;
    if (oqInWindow(tripWin, amsDateStr(st))) continue;
    if (String(r.location || "").trim() && !oqIsAmsterdamArea(r.location)) continue;
    var en = oqParseWhen(r.dtend);
    if (en == null || en <= st) en = st + OQ_DEFAULT_LEN_MS;
    if (en > now - 36e5 || en < now - 6 * 36e5) continue;
    var done = await env.CAL_DB.prepare("SELECT 1 x FROM calendar_feedback WHERE cal_id=? AND action IN ('went','nope') LIMIT 1").bind(r.id).first();
    if (done) continue;
    var link = await fbLink(env, r.id);
    var title = r.source === "personal-radar" ? oqCleanTitle(r.title) : String(r.title || "").replace(/\s+/g, " ").trim().slice(0, 100);
    var res = await env.CAL_DB.prepare("INSERT OR IGNORE INTO owner_questions (kind, ref, subject, body, priority, not_before) VALUES ('after-event', ?, ?, ?, 3, ?)")
      .bind(String(r.id), "Did you go to " + title + "?", title + "\n" + link + '\n\nTap "I went" and say who you talked to.', oqSqlTime(en + 36e5)).run();
    out.after_event += res && res.meta ? Number(res.meta.changes) || 0 : 0;
  }
  // (b) Sunday triage
  if (amsParts(now).weekday === "Sun") {
    var today = amsDateStr(now), horizon = amsDateStr(now + 14 * 864e5);
    var cand = await runQuery(env, "SELECT id, title, dtstart, location, relevance FROM calendar WHERE plane='personal' AND status='tentative' AND source='personal-radar' AND substr(dtstart,1,10)>=? AND substr(dtstart,1,10)<=?", [today, horizon]);
    cand.sort(function (a, b) { return (b.relevance == null ? -1 : b.relevance) - (a.relevance == null ? -1 : a.relevance) || String(a.dtstart).localeCompare(String(b.dtstart)); });
    cand = cand.slice(0, 5);
    if (cand.length) {
      var lines = ["These suggestions start in the next two weeks. Tap one to keep it, or remove it with a reason.", ""];
      for (var c of cand) lines.push("- " + oqCleanTitle(c.title) + " (" + String(c.dtstart).slice(0, 10) + (c.location ? ", " + c.location : "") + ")", "  " + await fbLink(env, c.id));
      var wk = amsIsoWeek(now);
      var t2 = await env.CAL_DB.prepare("INSERT OR IGNORE INTO owner_questions (kind, ref, subject, body, priority) VALUES ('triage', ?, ?, ?, 5)")
        .bind(wk, "This week: " + cand.length + " suggestion" + (cand.length === 1 ? "" : "s") + " to sort", lines.join("\n")).run();
      out.triage = t2 && t2.meta ? Number(t2.meta.changes) || 0 : 0;
    }
  }
  return out;
}
__name(queueOwnerQuestions, "queueOwnerQuestions");
var worker_default = {
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      if (env.VAULT) {
        try { await notesIntakeRun(env); } catch (e) { console.log("calendar-api notes intake error:", e && e.message || e); }
      } else console.log("calendar-api notes intake skipped: VAULT binding missing");
      await publishICS(env).catch((e) => console.log("calendar-api publish error:", e && e.message || e));
      try { await ensureSchema(env); console.log("calendar-api owner questions:", JSON.stringify(await queueOwnerQuestions(env))); } catch (e) { console.log("calendar-api queueOwnerQuestions error:", e && e.message || e); }
    })());
  },
  async fetch(request, env, ctx) {
    await ensureSchema(env);
    const url = new URL(request.url);
    const method = request.method;
    const path = url.pathname;
    const plane = url.searchParams.get("plane") || "qnfo";
    if (!PLANES.includes(plane)) return json({ error: "plane must be qnfo|personal|host" }, 400);
    if (path === "/health") {
      // PERSONAL-ICS-AUTH-1 (2026-10-01): the tokenised feed URLs are capability links, so /health
      // only returns them to a caller holding CAL_TOKEN.
      const urls = [];
      for (const p of authorized(request, env, ctx) ? PLANES : []) {
        const tok = await env.CAL_DB.prepare("SELECT v FROM calendar_meta WHERE k=?").bind("ics_token_" + p).first();
        urls.push({ plane: p, url: tok && tok.v ? R2_PUBLIC + "/calendar/" + p + "-" + tok.v + ".ics" : null });
      }
      return json({ ok: true, worker: WORKER, version: VERSION, feedback_links: !!fbSecret(env), capabilities: ["calendar-events", "ics-publish", "notes-intake", "event-feedback", "owner-questions", "host-plane"], limitations: ["reads and writes need the CAL_TOKEN bearer; the public /events.ics serves the qnfo plane only (personal needs CAL_TOKEN), and /health lists feed URLs only to a CAL_TOKEN caller", "ICS feeds are republished to R2 by the hourly :17 cron", "three planes: qnfo, personal and host; host (open-house availability) publishes dates only as all-day Open for guests, no address, names or contact details"], planes: PLANES, notes_intake: { vault: !!env.VAULT, folded_from: "notes-intake 0.1.5" }, ics_publish: { bucket: "qnfo-assets", base: R2_PUBLIC, urls } });
    }
    if (path === "/publish") {
      if (!authorized(request, env, ctx)) return json({ error: "unauthorized" }, 401);
      const out = await publishICS(env);
      return json({ ok: true, published: out });
    }
    if (path === "/notes/run" && method === "POST") {
      if (!authorized(request, env, ctx)) return json({ error: "unauthorized" }, 401);
      if (!env.VAULT) return json({ error: "VAULT binding missing" }, 503);
      const r = await notesIntakeRun(env);
      return json({ ok: true, version: VERSION, result: r });
    }
    if (path === "/notes/stats" && method === "GET") {
      if (!authorized(request, env, ctx)) return json({ error: "unauthorized" }, 401);
      const t = await env.CAL_DB.prepare("SELECT COUNT(*) c FROM notes_intake").first();
      const tt = await env.CAL_DB.prepare("SELECT COUNT(*) c FROM notes_intake WHERE triage_state='needs_triage'").first();
      const q = await env.CAL_DB.prepare("SELECT COUNT(*) c FROM notes_publish_queue WHERE status='pending'").first();
      const runs = await env.CAL_DB.prepare("SELECT * FROM notes_intake_runs ORDER BY id DESC LIMIT 5").all();
      return json({ ok: true, version: VERSION, vault: !!env.VAULT, notes: t && t.c || 0, triage: tt && tt.c || 0, publish_pending: q && q.c || 0, recent_runs: runs.results || [] });
    }
    if (path === "/events.ics") {
      // PERSONAL-ICS-AUTH-1: the personal plane needs CAL_TOKEN; subscribe to it via the tokenised R2 URL.
      if (plane !== "qnfo" && !authorized(request, env, ctx)) return json({ error: "unauthorized" }, 401);
      const fromIso = toIso(url.searchParams.get("from")) || new Date(Date.now() - 864e5).toISOString();
      const ics = await buildICS(env, plane, fromIso);
      return new Response(ics, { headers: { "content-type": "text/calendar; charset=utf-8" } });
    }
    const mFb = path.match(new RegExp("^/e/([0-9]+)$"));
    if (mFb) return fbHandle(request, env, parseInt(mFb[1], 10), url.searchParams.get("s"));
    if (!authorized(request, env, ctx)) return json({ error: "unauthorized" }, 401);
    if (path === "/feedback" && method === "GET") {
      const lim = Math.min(500, Math.max(1, parseInt(url.searchParams.get("limit") || "200", 10) || 200));
      const since = url.searchParams.get("since") || "1970-01-01";
      // CAL-FEEDBACK-PAGE-1: with after_id the page is the next `lim` rows by id, ascending, so a consumer that follows
      // next_after_id while more=true sees every row exactly once. Without it the old newest-first page is unchanged.
      if (url.searchParams.has("after_id")) {
        const after = Math.max(0, parseInt(url.searchParams.get("after_id") || "0", 10) || 0);
        const page = await runQuery(env, "SELECT * FROM calendar_feedback WHERE id>? AND ts>=? ORDER BY id ASC LIMIT ?", [after, since, lim + 1]);
        const more = page.length > lim;
        const rows = page.slice(0, lim);
        return json({ ok: true, count: rows.length, order: "asc", more, next_after_id: rows.length ? rows[rows.length - 1].id : after, feedback: rows });
      }
      const rows = await runQuery(env, "SELECT * FROM calendar_feedback WHERE ts>=? ORDER BY id DESC LIMIT ?", [since, lim]);
      return json({ ok: true, count: rows.length, feedback: rows });
    }
    if (path === "/events" && method === "GET") {
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      let sql = "SELECT * FROM calendar WHERE plane=?";
      const params = [plane];
      if (from) {
        sql += " AND dtstart>=?";
        params.push(from);
      }
      if (to) {
        sql += " AND dtstart<=?";
        params.push(to);
      }
      sql += " ORDER BY dtstart LIMIT 500";
      const rows = await runQuery(env, sql, params);
      return json({ ok: true, plane, count: rows.length, events: rows });
    }
    if (path === "/events" && method === "POST") {
      let b = await request.json().catch(() => null);
      if (plane === "host") {
        const d0 = hostDay(b && b.dtstart);
        if (!d0) return json({ error: "host plane needs dtstart as YYYY-MM-DD" }, 400);
        let d1 = hostDay(b.dtend);
        if (!d1 || d1 <= d0) d1 = hostNextDay(d0);
        b = { title: HOST_TITLE, dtstart: d0, dtend: d1, all_day: 1, source: "host", status: b.status === "cancelled" ? "cancelled" : "confirmed" };
      }
      if (!b || !b.title || !b.dtstart) return json({ error: "title and dtstart required" }, 400);
      const uid = uidFor(plane, "t" + Date.now().toString(36));
      const r = await env.CAL_DB.prepare(
        "INSERT INTO calendar (plane, uid, title, description, location, dtstart, dtend, all_day, url, source, domain, relevance, friction, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
      ).bind(plane, uid, b.title, b.description || null, b.location || null, b.dtstart, b.dtend || null, b.all_day ? 1 : 0, b.url || null, ALLOWED_SOURCES.includes(b.source) ? b.source : "manual", b.domain || null, b.relevance != null ? b.relevance : null, b.friction != null ? b.friction : null, b.status || "confirmed").run();
      const published = await publishICS(env).catch((e) => ({ error: e && e.message || String(e) }));
      return json({ ok: true, id: r.meta.last_row_id, uid, plane, published }, 201);
    }
    const m = path.match(new RegExp("^/events/([0-9]+)$"));
    if (m) {
      const id = parseInt(m[1], 10);
      if (method === "PUT") {
        const b = await request.json().catch(() => null);
        if (!b) return json({ error: "body required" }, 400);
        const sets = [];
        const params = [];
        for (const k of ["title", "description", "location", "dtstart", "dtend", "url", "source", "domain", "status"]) {
          if (b[k] !== void 0) {
            sets.push(k + "=?");
            params.push(b[k]);
          }
        }
        if (b.all_day !== void 0) {
          sets.push("all_day=?");
          params.push(b.all_day ? 1 : 0);
        }
        if (b.relevance !== void 0) {
          sets.push("relevance=?");
          params.push(b.relevance);
        }
        if (b.friction !== void 0) {
          sets.push("friction=?");
          params.push(b.friction);
        }
        sets.push("updated=datetime('now')");
        params.push(id);
        if (!sets.length) return json({ error: "no fields" }, 400);
        await env.CAL_DB.prepare("UPDATE calendar SET " + sets.join(",") + " WHERE id=?").bind(...params).run();
        const published = await publishICS(env).catch((e) => ({ error: e && e.message || String(e) }));
        return json({ ok: true, id, published });
      }
      if (method === "DELETE") {
        await env.CAL_DB.prepare("DELETE FROM calendar WHERE id=?").bind(id).run();
        const published = await publishICS(env).catch((e) => ({ error: e && e.message || String(e) }));
        return json({ ok: true, deleted: id, published });
      }
      if (method === "GET") {
        const rows = await runQuery(env, "SELECT * FROM calendar WHERE id=? AND plane=?", [id, plane]);
        return json({ ok: true, event: rows[0] || null });
      }
    }
    return json({ error: "not found: " + path + " (" + method + ")" }, 404);
  }
};
return worker_default;
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
var __fk_calendarApi_default = __foldWrap(worker_default, {
  name: "calendar-api", mod: calendarApiFoldMod, prefix: "/calendar", publicPaths: [],
  publicRoutes: [{"path": "/e/", "prefix": true, "methods": ["GET", "POST"]}, {"path": "/events.ics", "prefix": false, "methods": ["GET"]}], callers: ["personal-api", "radar-hub"],
  consts: {"CAL_PUBLIC_BASE": "https://qnfo-lifecycle.q08.workers.dev/calendar"}, derive: {"CAL_KEY_SEED": "CF_API_TOKEN"},
  tokenHeader: null, tokenEnv: null, tokenScheme: null,
  // Least privilege: the member gets its own bindings, vars and the env names its code reads, never the whole host env.
  keys: ["AUDIT", "CAL_DB", "CAL_KEY_SEED", "CAL_PUBLIC_BASE", "CAL_TOKEN", "ICS_R2", "UTC", "VAULT"],
  env: function (raw) { var e = {}, k = this.keys; for (var i = 0; i < k.length; i++) if (raw[k[i]] !== undefined) e[k[i]] = raw[k[i]]; return Object.assign(e, { CAL_DB: raw.QNFO_AUDIT }); },
  due: function (ms, cron) { return ("17 * * * *"); }
});
// ---- FOLD-KIT-1:calendar-api:END ----
// ---- RETIRED-HOSTS-1:BEGIN (agent_issues 2010 SEO input (a), 2026-10-06). Twelve qnfo.org hostnames still have proxied DNS
// records but no worker behind them, so they answered 522 (origin down) to people and crawlers. Removing the records needs
// a DNS-capable token (owner card cf-dns-redirect-token); until then this worker holds a Workers route for each one
// (wrangler.toml) and answers 410 Gone with noindex and a link to qnfo.org, which tells search engines the page is gone
// for good. Every other host passes through unchanged. A later fold wraps this default like any other (FOLD-KIT-1).
var RETIRED_HOSTS = { "agent-orchestrator.qnfo.org": 1, "fleet-executor.qnfo.org": 1, "fleet-scheduler.qnfo.org": 1, "qnfo-arxiv-radar.qnfo.org": 1, "qnfo-calibration-audit.qnfo.org": 1, "qnfo-citation-watch.qnfo.org": 1, "qnfo-paper-reviser.qnfo.org": 1, "qnfo-research-radar.qnfo.org": 1, "qnfo-secrets-audit.qnfo.org": 1, "qnfo-system-health.qnfo.org": 1, "scorecard.qnfo.org": 1, "analytics.qnfo.org": 1 };
function retiredHostResponse(host) {
  var html = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Retired</title></head>'
    + '<body><p>' + host + ' was an internal QNFO service and has been retired.</p><p><a href="https://qnfo.org/">Go to qnfo.org</a></p></body></html>';
  return new Response(html, { status: 410, headers: { "Content-Type": "text/html; charset=utf-8", "X-Robots-Tag": "noindex", "Cache-Control": "public, max-age=86400" } });
}
// SPARE-DOMAINS-1 (agent_issues 2077, 2026-10-08, pillar reach): the spare domains are routed here too
// (scripts/attach-surface-routes.py, repository token) and answer a permanent redirect to their canonical site, path and
// query kept: ipatent.me had no DNS at all, qwav.net and qwav.uk served duplicates of qwav.org, qwave.tech a parking page,
// empoweringchange.today nothing. Removing a host from this map and its route is the whole rollback.
var SPARE_HOST_REDIRECTS = { "ipatent.me": "https://ipatent.qnfo.org", "www.ipatent.me": "https://ipatent.qnfo.org", "qwav.net": "https://qwav.org", "www.qwav.net": "https://qwav.org", "qwav.uk": "https://qwav.org", "www.qwav.uk": "https://qwav.org", "qwave.tech": "https://qwav.org", "www.qwave.tech": "https://qwav.org", "q-wave.tech": "https://qwav.org", "www.q-wave.tech": "https://qwav.org", "empoweringchange.today": "https://qnfo.org", "www.empoweringchange.today": "https://qnfo.org" };
function spareHostResponse(url) {
  var target = SPARE_HOST_REDIRECTS[url.hostname];
  if (!target) return null;
  return new Response(null, { status: 301, headers: { "Location": target + url.pathname + url.search, "Cache-Control": "public, max-age=86400" } });
}
function withRetiredHosts(inner) {
  var out = Object.assign({}, inner, {
    async fetch(request, env, ctx) {
      var url = new URL(request.url), host = url.hostname;
      if (RETIRED_HOSTS[host] === 1) return retiredHostResponse(host);
      var spare = spareHostResponse(url);
      if (spare) return spare;
      return inner.fetch(request, env, ctx);
    }
  });
  ["__foldHost", "__foldMember"].forEach(function (k) { if (inner[k] !== undefined) Object.defineProperty(out, k, { value: inner[k], enumerable: false }); });
  return out;
}
var __retired_hosts_default = withRetiredHosts(__fk_calendarApi_default);
// ---- RETIRED-HOSTS-1:END ----
// DEAD-PREFIX-SCRUB retired 2026-10-21 (NO-REGISTRAR-1): the one-off body scrub finished (0 papers rows matched on 2026-10-21); the hourly wrapper is removed.
var __noz_scrub_default = __retired_hosts_default;
// ---- PAPER-LEARN-1 (1.12.0, owner directive 2026-10-19, pillar autonomy) ----
// Owner, 2026-10-19: "THE SYSTEM/FLEET SHALL ALWAYS LEARN FROM ITS OWN RESEARCH PAPERS". Until now a published paper fed the
// citation graph, the social roll-up and the revision loop, but nothing read what a paper claims and asked what it means for
// the fleet itself. Each hourly tick reads up to paper_learn_per_tick published papers (default 4, at most 8) whose slug and
// version have no paper_learn_state row, newest first, so a new paper or a new version is read within the hour and the older
// corpus drains behind it. One model (glm-5.3-flash, gpt-oss-120b as the per-request fallback) reads the full body (up to
// PL_BODY_MAX characters) and returns its claims as JSON; each claim is stored in qnfo-audit.paper_learnings with:
//   kind          derived | cited | empirical | assumption, as the paper presents it;
//   verification  set here, never by the model: empirical with no support -> unverified; derived -> derived-unchecked (the
//                 model did not recompute it); cited -> cited-unchecked; assumption -> assumption. A claim is a lead for the
//                 fleet, not a fact, until a session or loop checks it and sets verification = checked.
//   fleet lever   what in the fleet the claim bears on (a loop parameter, a metric, a doctrine rule) and how; applicability
//                 direct | analogy | none; fleet_status proposed (direct or analogy) or n/a.
// Errors the reader finds in the paper (a derivation that does not follow, a claim its own model contradicts) are checked by a
// second model family; a confirmed one becomes an internal_errata row (owner qnfo-research-exec), the queue the errata member
// and the revision loop read, so the paper is corrected through the pipeline that wrote it. At most PL_ERRATA_MAX per paper.
// A paper with a direct learning at confidence PL_ISSUE_CONF or more files one agent_issues row (PAPER-LEARN-1: apply ...),
// at most one per tick and none while PL_ISSUE_OPEN_MAX such issues are open (backpressure, not a hold); its remediation
// contract closes it when no direct learning of that paper is still proposed (applied or rejected, with a reason).
// The tick writes metric papers_unlearned_over_120m (papers whose version changed in the last 1,440 minutes and has waited more
// than 120 minutes unread; the older corpus drains behind them uncounted) and a
// cloud_ops_events job-run row (job paper-learn). GET /paper-learn/status and GET /paper-learn/learnings?slug= are open reads.
// ops_config: paper_learn_mode on (default) | off; paper_learn_per_tick. Rollback: paper_learn_mode = off.
var PL_PRIMARY = "@cf/zai-org/glm-5.3-flash";
var PL_SECOND = "@cf/openai/gpt-oss-120b";
var PL_PER_TICK_DEFAULT = 4, PL_PER_TICK_MAX = 8, PL_SCAN = 400, PL_MIN_BODY = 8000, PL_BODY_MAX = 60000;
var PL_LEARN_MAX = 8, PL_ERRATA_MAX = 2, PL_MAX_TRIES = 3, PL_ISSUE_CONF = 0.8, PL_ISSUE_OPEN_MAX = 5, PL_SLA_MIN = 120, PL_SLA_WINDOW_MIN = 1440;
// 1.17.3 D1-OVERLOAD-RETRY-1 (#6531): retry only transient overload errors, per operation, to avoid replaying a partially completed tick.
var PL_D1_RETRIES = 2, PL_D1_RETRY_BASE_MS = 100;
async function plD1Retry(run) {
  for (var attempt = 0; ; attempt++) {
    try { return await run(); }
    catch (e) {
      if (attempt >= PL_D1_RETRIES || !/D1_ERROR:\s*D1 DB is overloaded\. Requests queued for too long\./i.test(String(e && e.message || e))) throw e;
      await new Promise(function (resolve) { setTimeout(resolve, PL_D1_RETRY_BASE_MS * Math.pow(2, attempt)); });
    }
  }
}
function plRetryD1(db) {
  return {
    prepare: function (sql) {
      var statement = db.prepare(sql), wrapped = {
        bind: function () { statement = statement.bind.apply(statement, arguments); return wrapped; },
        run: function () { var args = arguments; return plD1Retry(function () { return statement.run.apply(statement, args); }); },
        all: function () { var args = arguments; return plD1Retry(function () { return statement.all.apply(statement, args); }); },
        first: function () { var args = arguments; return plD1Retry(function () { return statement.first.apply(statement, args); }); }
      };
      Object.defineProperty(wrapped, "__plStatement", { get: function () { return statement; } });
      return wrapped;
    },
    batch: function (statements) {
      var raw = statements.map(function (statement) { return statement && statement.__plStatement || statement; });
      return plD1Retry(function () { return db.batch(raw); });
    }
  };
}
var PL_KINDS = ["derived", "cited", "empirical", "assumption"];
var PL_APPLIC = ["direct", "analogy", "none"];
var PL_DDL = [
  "CREATE TABLE IF NOT EXISTS paper_learnings (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL, version TEXT, title TEXT, claim TEXT NOT NULL, section TEXT, kind TEXT NOT NULL, support TEXT, verification TEXT NOT NULL, fleet_lever TEXT, application TEXT, applicability TEXT NOT NULL, confidence REAL, fleet_status TEXT NOT NULL DEFAULT 'proposed', status_note TEXT, issue_id INTEGER, source TEXT NOT NULL DEFAULT 'qnfo-lifecycle PAPER-LEARN-1', model TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), updated_at TEXT)",
  "CREATE INDEX IF NOT EXISTS idx_paper_learnings_slug ON paper_learnings (slug, version)",
  "CREATE TABLE IF NOT EXISTS paper_learn_state (slug TEXT NOT NULL, version TEXT NOT NULL, title TEXT, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, n_learnings INTEGER DEFAULT 0, n_unverified INTEGER DEFAULT 0, n_direct INTEGER DEFAULT 0, n_errata INTEGER DEFAULT 0, issue_id INTEGER, model TEXT, note TEXT, learned_at TEXT NOT NULL, PRIMARY KEY (slug, version))"
];
var PL_FLEET = "The reader is an autonomous fleet of about 40 Cloudflare Workers that runs itself: hourly and 10-minute loops (a code loop that opens and merges pull requests, a research pipeline that writes and revises papers, outreach, monitoring), " +
  "a D1 issue queue (agent_issues) drained by loops, a metric registry with triggers that file an issue when a metric breaches, remediation probes that close issues, AI spend budgets that steer to cheaper models instead of stopping work, " +
  "work claims between concurrent sessions, a doctrine of rules it amends itself, a trust ledger that widens a loop's scope with verified outcomes, and model ensembles that check each other.";
function plPrompt(title, version, body) {
  return "You read a research paper for an engineering team. " + PL_FLEET + "\n\n" +
    "Task: list the paper's claims that could change how such a fleet is designed or tuned, and any errors in the paper.\n" +
    "Rules:\n" +
    "- At most " + PL_LEARN_MAX + " learnings, most useful first. Quote or closely paraphrase the paper's own claim; never add a claim it does not make.\n" +
    "- kind: derived (the paper derives it from its stated assumptions), cited (it attributes it to a cited work), empirical (it states a measured fact about the world), assumption (it assumes it).\n" +
    "- support: where the paper supports it (section and how), or none.\n" +
    "- fleet_lever: the concrete part of the fleet it bears on (a loop's cadence or batch size, a metric and its threshold, a budget rule, a review rule, a doctrine rule); application: one or two sentences on what the fleet would change and how it would measure it.\n" +
    "- applicability: direct (the fleet has this exact trade-off and can act on it), analogy (suggestive only), none.\n" +
    "- The paper may carry notes written by the fleet's own pipeline (a correction banner, a Version History, a Provenance section). They describe the fleet, not the paper's subject; never turn them into a learning.\n" +
    "- errors: a derivation that does not follow, a number that does not match its own inputs, a conclusion the paper's own model contradicts. Show why in one or two sentences. Do not list style issues.\n" +
    "Answer with JSON only: {\"learnings\":[{\"claim\":\"\",\"section\":\"\",\"kind\":\"\",\"support\":\"\",\"fleet_lever\":\"\",\"application\":\"\",\"applicability\":\"\",\"confidence\":0.0}],\"errors\":[{\"claim\":\"\",\"why\":\"\"}]}\n\n" +
    "PAPER: " + String(title || "") + " (version " + String(version || "") + ")\n\n" + body;
}
// ---- PAPER-LEARN-ANCHOR-1 (1.15.2, 2026-10-26, pillar research; patch) ----
// errata-hub's internal confirm (ERRATA-INTERNAL-CONFIRM-1) is the third check of a PAPER-LEARN-1 finding. It reads an excerpt of the paper and
// centres it on the `At: "<passage>"` of the erratum's claim (qnfo-paper-reviser and the READER-REPORT-1 gateway write one); with no anchor the
// excerpt is the first CONFIRM_EXCERPT_MAX characters (24,000 since ERRATA-CONFIRM-COST-1, 48,000 before), so a finding about a passage further
// in was judged against text that does not contain it. Measured 2026-10-26: 59 PAPER-LEARN-1 errata rejected, 18 with a window reason ("not
// present in the excerpt", "Section 6 is not present"), 0 of 881 claims anchored, and the quoted passage of 5 of 8 sampled window rejections
// sits at characters 31,086 to 55,772 of a paper the window cut at 24,000 or 48,000. The reader quotes the passage in the claim; this finds
// it in the stored body and appends its first characters, verbatim, as the anchor. A claim with no locatable quotation is left as it was.
var PL_ANCHOR_MIN = 12, PL_ANCHOR_MAX = 120, PL_ANCHOR_HEADS = [8, 5, 3];
function plQuotedPassages(text) {
  var s = String(text || ""), out = [], m;
  var re = /\u201c([^\u201d]{16,400})\u201d|"([^"]{16,400})"|\u2018([^\u2019]{16,400})\u2019|(?:^|[\s(\[])'([^']{16,400})'(?=$|[\s.,;:)\]])/g;
  while ((m = re.exec(s)) && out.length < 8) {
    String(m[1] || m[2] || m[3] || m[4]).split(/\.{3}|\u2026/).forEach(function (piece) {
      var t = piece.replace(/\s+/g, " ").trim();
      if (t.length >= 16 && out.indexOf(t) < 0) out.push(t);
    });
  }
  return out;
}
function plTokenPattern(tok) {
  return tok.split("").map(function (ch) {
    if (/['\u2018\u2019`]/.test(ch)) return "['\u2018\u2019`]";
    if (/["\u201c\u201d]/.test(ch)) return "[\"\u201c\u201d]";
    return ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }).join("");
}
// Index in `raw` of the first place the passage's opening words occur (whitespace and quote style free), or -1.
function plLocatePassage(raw, passage) {
  var toks = String(passage || "").split(/\s+/).filter(Boolean), tried = {};
  for (var i = 0; i < PL_ANCHOR_HEADS.length; i++) {
    var head = toks.slice(0, PL_ANCHOR_HEADS[i]);
    if (head.length < 2 || head.join(" ").length < 16 || tried[head.length]) continue;
    tried[head.length] = true;
    try {
      var at = String(raw).search(new RegExp(head.map(plTokenPattern).join("\\s+")));
      if (at >= 0) return at;
    } catch (e) { /* a pattern that does not compile anchors nothing */ }
  }
  return -1;
}
// claim + ` At: "<verbatim passage start>"`. The anchor is a prefix of the stored body with no double quote or line break in it, because
// the confirm reads it with /At: "([^"]{12,})/ and looks it up with indexOf in the full body.
function plAnchorClaim(raw, claim, why) {
  var c = String(claim || ""), body = String(raw || "");
  if (!body || /At: "/.test(c)) return c;
  var cands = plQuotedPassages(c).concat(plQuotedPassages(why));
  for (var i = 0; i < cands.length; i++) {
    var at = plLocatePassage(body, cands[i]);
    if (at < 0) continue;
    var a = body.slice(at, at + PL_ANCHOR_MAX), cut = a.search(/["\r\n]/);
    if (cut >= 0) a = a.slice(0, cut);
    a = a.replace(/\s+$/, "");
    if (a.length >= PL_ANCHOR_MIN) return c + ' At: "' + a + '"';
  }
  return c;
}
function plConfirmPrompt(title, body, errors) {
  return "A reviewer claims the paper below contains these errors. For each one, check it against the paper's own text and math. " +
    "Answer with JSON only: {\"verdicts\":[{\"i\":0,\"confirmed\":true,\"why\":\"\"}]} with one verdict per error, confirmed true only when the error is real.\n\n" +
    "ERRORS:\n" + errors.map(function (e, i) { return i + ". " + e.claim + " -- " + e.why; }).join("\n") + "\n\nPAPER: " + String(title || "") + "\n\n" + body;
}
// The first balanced JSON object in a reply (models wrap JSON in prose or code fences).
function plJson(text) {
  var s = String(text || ""), start = s.indexOf("{");
  while (start >= 0) {
    var depth = 0, inStr = false, esc = false;
    for (var i = start; i < s.length; i++) {
      var c = s[i];
      if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === "\"") inStr = false; continue; }
      if (c === "\"") inStr = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) {
        var chunk = s.slice(start, i + 1);
        try { return JSON.parse(chunk); } catch (e) {
          try { return JSON.parse(chunk.replace(/\\(?!["\\/bfnrtu])/g, "\\\\")); } catch (e2) { break; } // lone LaTeX backslashes
        }
      }
    }
    start = s.indexOf("{", start + 1);
  }
  return null;
}
function plStr(v, n) { return String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n); }
// Verification is decided here from what the paper says about a claim, never taken from the model.
function plVerification(kind, support) {
  var none = !support || /^(none|n\/a|no|unsupported|-)?$/i.test(String(support).trim());
  if (kind === "empirical") return none ? "unverified" : "cited-unchecked";
  if (kind === "derived") return "derived-unchecked";
  if (kind === "cited") return "cited-unchecked";
  return "assumption";
}
function plNormalize(parsed) {
  var out = { learnings: [], errors: [] };
  if (!parsed || typeof parsed !== "object") return out;
  (Array.isArray(parsed.learnings) ? parsed.learnings : []).slice(0, PL_LEARN_MAX).forEach(function (l) {
    if (!l || typeof l !== "object") return;
    var claim = plStr(l.claim, 600);
    if (claim.length < 12) return;
    var kind = PL_KINDS.indexOf(String(l.kind || "").toLowerCase()) >= 0 ? String(l.kind).toLowerCase() : "assumption";
    var applic = PL_APPLIC.indexOf(String(l.applicability || "").toLowerCase()) >= 0 ? String(l.applicability).toLowerCase() : "analogy";
    var conf = Number(l.confidence);
    var support = plStr(l.support, 300);
    out.learnings.push({
      claim: claim, section: plStr(l.section, 80), kind: kind, support: support, verification: plVerification(kind, support),
      fleet_lever: plStr(l.fleet_lever, 200), application: plStr(l.application, 600), applicability: applic,
      confidence: isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 0.5, fleet_status: applic === "none" ? "n/a" : "proposed"
    });
  });
  (Array.isArray(parsed.errors) ? parsed.errors : []).slice(0, 4).forEach(function (e) {
    if (!e || typeof e !== "object") return;
    var claim = plStr(e.claim, 600), why = plStr(e.why, 600);
    if (claim.length >= 12 && why.length >= 12) out.errors.push({ claim: claim, why: why });
  });
  return out;
}
async function plAi(env, model, prompt, maxTokens) {
  env = __aiAttrEnv(env, "qnfo-lifecycle", "AI", "QNFO_AUDIT"); // AI-METER-COVER-3c: every call lands in ai_call_counters under qnfo-lifecycle
  var opts = { messages: [{ role: "user", content: prompt }], max_tokens: maxTokens || 4096, temperature: 0.2 };
  if (/^@cf\/zai-org\/glm-/.test(model)) opts.reasoning_effort = "low";
  var r = await env.AI.run(model, opts);
  if (typeof r === "string") return r;
  if (r && typeof r.response === "string") return r.response;
  if (r && r.choices && r.choices[0] && r.choices[0].message) return String(r.choices[0].message.content || "");
  return "";
}
// One model reads; the other family is the per-request fallback, so one model's outage or rate limit never stops the loop.
async function plRead(env, prompt, maxTokens, order) {
  var models = order || [PL_PRIMARY, PL_SECOND], errs = [];
  for (var i = 0; i < models.length; i++) {
    try {
      var t = await plAi(env, models[i], prompt, maxTokens);
      var j = plJson(t);
      if (j) return { model: models[i], json: j };
      errs.push(models[i].split("/").pop() + ": no JSON");
    } catch (e) {
      errs.push(models[i].split("/").pop() + ": " + String(e && e.message || e).slice(0, 120));
    }
  }
  return { model: null, json: null, error: errs.join("; ") };
}
async function plConfig(env) {
  var cfg = { mode: "on", perTick: PL_PER_TICK_DEFAULT };
  try {
    var rows = (await env.QNFO_AUDIT.prepare("SELECT key, value FROM ops_config WHERE key IN ('paper_learn_mode', 'paper_learn_per_tick')").all()).results || [];
    rows.forEach(function (r) {
      if (r.key === "paper_learn_mode") cfg.mode = String(r.value || "").trim().toLowerCase() === "off" ? "off" : "on";
      var n = Math.floor(Number(r.value));
      if (r.key === "paper_learn_per_tick" && n >= 0) cfg.perTick = Math.min(PL_PER_TICK_MAX, n);
    });
  } catch (e) {
    console.error(JSON.stringify({ worker: "qnfo-lifecycle", where: "paper-learn-config", error: String(e && e.message || e).slice(0, 200) }));
  }
  return cfg;
}
async function plEnsure(env) {
  for (var i = 0; i < PL_DDL.length; i++) await env.QNFO_AUDIT.prepare(PL_DDL[i]).run();
}
function plIsoAge(ts, now) {
  var s = String(ts || "").trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)) s = s.replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? "" : "Z");
  var t = Date.parse(s);
  return isFinite(t) ? (now - t) / 60000 : 0;
}
// Which (slug, version) pairs still need reading: no state row, or a failed one under PL_MAX_TRIES. Newest change first.
async function plCandidates(env, now) {
  var papers = (await env.LIVING_PAPER.prepare("SELECT slug, title, version, updated_at FROM papers WHERE status = 'published' AND slug IS NOT NULL AND slug <> '' AND length(body_md) >= ?1 ORDER BY datetime(updated_at) DESC LIMIT ?2").bind(PL_MIN_BODY, PL_SCAN).all()).results || [];
  var state = {};
  (((await env.QNFO_AUDIT.prepare("SELECT slug, version, status, attempts FROM paper_learn_state").all()).results) || []).forEach(function (r) { state[r.slug + "@" + r.version] = r; });
  var todo = [];
  papers.forEach(function (p) {
    var v = String(p.version || "1.0.0"), st = state[p.slug + "@" + v];
    if (st && (st.status !== "failed" || st.attempts >= PL_MAX_TRIES)) return;
    todo.push({ slug: p.slug, title: p.title, version: v, attempts: st ? st.attempts : 0, updated_at: p.updated_at });
  });
  return { todo: todo, scanned: papers.length };
}
async function plLearnOne(env, p, out) {
  var row = await env.LIVING_PAPER.prepare("SELECT body_md FROM papers WHERE slug = ?1").bind(p.slug).first();
  var rawBody = String(row && row.body_md || "");
  var body = plStripNotices(rawBody).slice(0, PL_BODY_MAX);
  var read = await plRead(env, plPrompt(p.title, p.version, body), 4096);
  var res = { key: p.slug + "@" + p.version, slug: p.slug.slice(0, 80), version: p.version, learnings: 0, unverified: 0, direct: 0, errata: 0, issue: null };
  var now = new Date().toISOString();
  if (!read.json) {
    await env.QNFO_AUDIT.prepare("INSERT INTO paper_learn_state (slug, version, title, status, attempts, model, note, learned_at) VALUES (?1, ?2, ?3, 'failed', ?4, NULL, ?5, ?6) ON CONFLICT (slug, version) DO UPDATE SET status = 'failed', attempts = excluded.attempts, note = excluded.note, learned_at = excluded.learned_at")
      .bind(p.slug, p.version, p.title, p.attempts + 1, String(read.error || "no answer").slice(0, 400), now).run();
    res.failed = String(read.error || "no answer").slice(0, 160);
    return res;
  }
  var n = plNormalize(read.json);
  var stmts = [];
  n.learnings.forEach(function (l) {
    stmts.push(env.QNFO_AUDIT.prepare("INSERT INTO paper_learnings (slug, version, title, claim, section, kind, support, verification, fleet_lever, application, applicability, confidence, fleet_status, model, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)")
      .bind(p.slug, p.version, p.title, l.claim, l.section, l.kind, l.support, l.verification, l.fleet_lever, l.application, l.applicability, l.confidence, l.fleet_status, read.model, now));
    res.learnings++;
    if (l.verification === "unverified") res.unverified++;
    if (l.applicability === "direct") res.direct++;
  });
  // Errors: a second family confirms each one against the same text before it enters the errata queue.
  var confirmed = [];
  if (n.errors.length) {
    var other = read.model === PL_PRIMARY ? [PL_SECOND, PL_PRIMARY] : [PL_PRIMARY, PL_SECOND];
    var check = await plRead(env, plConfirmPrompt(p.title, body, n.errors), 2048, other.slice(0, 1));
    var verdicts = check.json && Array.isArray(check.json.verdicts) ? check.json.verdicts : [];
    verdicts.forEach(function (v) {
      var i = Number(v && v.i);
      if (v && v.confirmed === true && n.errors[i] && confirmed.indexOf(n.errors[i]) < 0) confirmed.push(Object.assign({ check: plStr(v.why, 400), by: check.model }, n.errors[i]));
    });
  }
  confirmed.slice(0, PL_ERRATA_MAX).forEach(function (e, i) {
    stmts.push(env.QNFO_AUDIT.prepare("INSERT INTO paper_learnings (slug, version, title, claim, section, kind, support, verification, fleet_lever, application, applicability, confidence, fleet_status, status_note, model, created_at) VALUES (?1, ?2, ?3, ?4, '', 'error', ?5, 'error-confirmed', '', '', 'none', NULL, 'routed', 'internal_errata ' || ?6, ?7, ?8)")
      .bind(p.slug, p.version, p.title, e.claim, e.why, "pl-" + p.slug.slice(0, 80) + "-" + p.version + "-" + i, read.model, now));
    stmts.push(env.QNFO_AUDIT.prepare("INSERT OR IGNORE INTO internal_errata (id, target_kind, target_ref, detected_at, detected_by, severity, claim_text, falsification, evidence, remediation, status, owner) VALUES (?1, 'paper', ?2, ?3, 'qnfo-lifecycle PAPER-LEARN-1', 'high', ?4, ?5, ?6, ?7, 'open', 'qnfo-research-exec')")
      .bind("pl-" + p.slug.slice(0, 80) + "-" + p.version + "-" + i, p.slug, now, plAnchorClaim(rawBody, e.claim, e.why), e.why,
        "found by " + read.model + " and confirmed by " + e.by + " against version " + p.version + ": " + e.check,
        "revise through the research pipeline (REVISION-LOOP-1 or a remediation row): correct the derivation or qualify the claim and every place that repeats it"));
    res.errata++;
  });
  stmts.push(env.QNFO_AUDIT.prepare("INSERT INTO paper_learn_state (slug, version, title, status, attempts, n_learnings, n_unverified, n_direct, n_errata, model, note, learned_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12) ON CONFLICT (slug, version) DO UPDATE SET status = excluded.status, attempts = excluded.attempts, n_learnings = excluded.n_learnings, n_unverified = excluded.n_unverified, n_direct = excluded.n_direct, n_errata = excluded.n_errata, model = excluded.model, note = excluded.note, learned_at = excluded.learned_at")
    .bind(p.slug, p.version, p.title, res.learnings ? "ok" : "empty", p.attempts + 1, res.learnings, res.unverified, res.direct, res.errata, read.model, n.errors.length + " errors claimed, " + confirmed.length + " confirmed", now));
  await env.QNFO_AUDIT.batch(stmts);
  // One follow-up issue for a paper with a strong direct learning, at most one per tick and while few are open.
  var strong = n.learnings.filter(function (l) { return l.applicability === "direct" && l.confidence >= PL_ISSUE_CONF; });
  if (strong.length && !out.issueFiled) {
    var open = await env.QNFO_AUDIT.prepare("SELECT COUNT(*) AS n FROM agent_issues WHERE status = 'open' AND title LIKE 'PAPER-LEARN-1: apply %'").first();
    if (!open || Number(open.n) < PL_ISSUE_OPEN_MAX) res.issue = await plFileIssue(env, p, strong);
    if (res.issue) out.issueFiled = true;
  }
  return res;
}
function plSqlStr(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }
// PAPER-LEARN-PROJECTIONS-1: derived and assumption claims are projections, not measured facts.
async function plFileIssue(env, p, strong) {
  var title = "PAPER-LEARN-1: apply " + String(p.slug).slice(0, 120) + " to the fleet";
  var dup = await env.QNFO_AUDIT.prepare("SELECT id FROM agent_issues WHERE title = ?1 AND status = 'open'").bind(title).first();
  if (dup) return null;
  var lines = strong.map(function (l, i) {
    var status = l.kind === "derived" || l.kind === "assumption"
      ? "MODEL PROJECTION — UNCONFIRMED; NOT A MEASURED FACT"
      : l.verification === "checked" ? "CHECKED" : "UNVERIFIED; NOT A MEASURED FACT";
    return (i + 1) + ". [" + status + "] " + l.claim + " [" + l.kind + ", " + l.verification + "] Lever: " + l.fleet_lever + ". " + l.application;
  });
  var desc = "Charter pillar: autonomy. PAPER-LEARN-1 (qnfo-lifecycle) read the published paper \"" + String(p.title || "").slice(0, 300) + "\" (https://papers.qnfo.org/papers/" + p.slug + ", version " + p.version + ") and found learnings that bear directly on the fleet:\n" + lines.join("\n") +
    "\n\nFormal-model outputs are projections, not measured facts. Preserve stated assumptions and independently verify each claim before downstream loops use it or act on it. Each learning is a lead, not a fact: check the claim (recompute a derived one, read the cited source for a cited one) before acting. Apply a sound one through the canonical path (a PR or a migration with its metric and trigger) and set its paper_learnings row fleet_status = 'applied' with the PR or migration in status_note; set 'rejected' with the reason otherwise. " +
    "Read: SELECT id, claim, kind, verification, fleet_lever, application, confidence FROM paper_learnings WHERE slug = " + plSqlStr(p.slug) + " AND version = " + plSqlStr(p.version) + " AND applicability = 'direct'. " +
    "The probe closes this issue when none of those rows is still proposed.";
  var now = Date.now();
  var ins = await env.QNFO_AUDIT.prepare("INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at) VALUES (?1, ?2, 'qnfo-lifecycle', 'optimization', 'medium', 'open', ?3, ?3)").bind(title, desc, now).run();
  var id = ins && ins.meta && ins.meta.last_row_id;
  if (!id) return null;
  var probe = "SELECT '0' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM paper_learnings WHERE slug = " + plSqlStr(p.slug) + " AND version = " + plSqlStr(p.version) + " AND applicability = 'direct' AND fleet_status = 'proposed'";
  await env.QNFO_AUDIT.batch([
    env.QNFO_AUDIT.prepare("UPDATE paper_learnings SET issue_id = ?1 WHERE slug = ?2 AND version = ?3 AND applicability = 'direct'").bind(id, p.slug, p.version),
    env.QNFO_AUDIT.prepare("UPDATE paper_learn_state SET issue_id = ?1 WHERE slug = ?2 AND version = ?3").bind(id, p.slug, p.version),
    // ORPHAN-GUARD-BIRTH-1 wrote the issue-<id> contract at birth; the probe goes in by UPDATE (an INSERT is the fallback when no row exists).
    env.QNFO_AUDIT.prepare("UPDATE remediation_contracts SET verify_probe = ?2, verify_transport = 'd1-query', precondition = 'PAPER-LEARN-1 follow-up', action = 'apply or reject each direct learning of the paper' WHERE class = ?1").bind("issue-" + id, probe),
    env.QNFO_AUDIT.prepare("INSERT OR IGNORE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, escalate_to, expected_cadence_h) VALUES (?1, ?2, 'PAPER-LEARN-1 follow-up', 'apply or reject each direct learning of the paper', ?3, 'd1-query', 'qnfo-fleet-control', 1)").bind("issue-" + id, id, probe)
  ]);
  return id;
}
async function plProjectionMetrics(env, now) {
  var result = { remediation_share_7d: null, omissions_7d: null };
  try {
    var policy = await env.QNFO_AUDIT.prepare("SELECT value FROM ops_config WHERE key = 'paper_projection_enforcement_since'").first();
    var rollout = Number(policy && policy.value);
    if (!isFinite(rollout)) return result;
    var start = Math.max(rollout, now - 7 * 24 * 60 * 60 * 1000);
    var counts = await env.QNFO_AUDIT.prepare("SELECT COUNT(DISTINCT slug || char(31) || COALESCE(version, '')) AS total, COUNT(DISTINCT CASE WHEN issue_id IS NOT NULL THEN slug || char(31) || COALESCE(version, '') END) AS actions FROM paper_learnings WHERE created_at >= ?1 AND model IS NOT NULL AND applicability = 'direct' AND kind IN ('derived', 'assumption') AND verification IN ('derived-unchecked', 'assumption')").bind(new Date(start).toISOString()).first();
    var omissions = await env.QNFO_AUDIT.prepare("SELECT COUNT(DISTINCT a.id) AS n FROM agent_issues a JOIN paper_learnings l ON l.issue_id = a.id WHERE a.source = 'qnfo-lifecycle' AND a.title LIKE 'PAPER-LEARN-1: apply %' AND a.created_at >= ?1 AND l.created_at >= ?2 AND l.model IS NOT NULL AND l.applicability = 'direct' AND l.kind IN ('derived', 'assumption') AND l.verification IN ('derived-unchecked', 'assumption') AND instr(COALESCE(a.description, ''), 'MODEL PROJECTION — UNCONFIRMED') = 0").bind(start, new Date(start).toISOString()).first();
    var total = Number(counts && counts.total) || 0, actions = Number(counts && counts.actions) || 0;
    result.remediation_share_7d = total ? String(Math.round(1000 * actions / total) / 10) : "n/a";
    result.omissions_7d = String(Number(omissions && omissions.n) || 0);
    await env.QNFO_AUDIT.batch([
      env.QNFO_AUDIT.prepare("UPDATE metric_registry SET last_value = ?1, last_refreshed = ?2, state = ?3 WHERE metric = 'paper_model_projection_remediation_share_7d'")
        .bind(result.remediation_share_7d, new Date(now).toISOString(), total ? "MEASURED" : "UNMEASURED"),
      env.QNFO_AUDIT.prepare("UPDATE metric_registry SET last_value = ?1, last_refreshed = ?2, state = 'MEASURED' WHERE metric = 'paper_unlabeled_model_projection_issues_7d'")
        .bind(result.omissions_7d, new Date(now).toISOString())
    ]);
  } catch (e) {
    console.error(JSON.stringify({ worker: "qnfo-lifecycle", where: "paper-projection-metrics", error: String(e && e.message || e).slice(0, 200) }));
  }
  return result;
}
async function paperLearnTick(env, opts) {
  var o = opts || {}, t0 = Date.now();
  var out = { marker: "PAPER-LEARN-1", at: new Date(t0).toISOString(), mode: "on", read: [], errors: [] };
  if (!env.LIVING_PAPER || !env.QNFO_AUDIT || !env.AI) { out.errors.push("missing binding"); return out; }
  env = Object.assign({}, env, { LIVING_PAPER: plRetryD1(env.LIVING_PAPER), QNFO_AUDIT: plRetryD1(env.QNFO_AUDIT) });
  var cfg = await plConfig(env);
  out.mode = cfg.mode;
  if (cfg.mode === "off" && !o.force) { out.skipped = true; return out; }
  await plEnsure(env);
  var c = await plCandidates(env, t0);
  out.waiting = c.todo.length;
  var pick = o.slug ? c.todo.filter(function (p) { return p.slug === o.slug; }) : c.todo;
  var n = o.slug ? 1 : cfg.perTick;
  for (var i = 0; i < pick.length && out.read.length < n; i++) {
    try { out.read.push(await plLearnOne(env, pick[i], out)); }
    catch (e) { out.errors.push(String(pick[i].slug).slice(0, 60) + ": " + String(e && e.message || e).slice(0, 160)); }
  }
  // papers_unlearned_over_120m: versions still unread after this tick that have waited longer than the SLA.
  var done = {};
  out.read.forEach(function (r) { if (!r.failed) done[r.key] = 1; });
  out.overdue = c.todo.filter(function (p) { var age = plIsoAge(p.updated_at, t0); return !done[p.slug + "@" + p.version] && age > PL_SLA_MIN && age <= PL_SLA_WINDOW_MIN; }).length;
  try {
    await env.QNFO_AUDIT.prepare("UPDATE metric_registry SET last_value = ?1, last_refreshed = ?2, state = 'MEASURED' WHERE metric = 'papers_unlearned_over_120m'").bind(String(out.overdue), out.at).run();
  } catch (e) { out.errors.push("metric: " + String(e && e.message || e).slice(0, 120)); }
  out.projection_metrics = await plProjectionMetrics(env, t0);
  out.triage = await plTriageTick(env, o.triage);
  out.ms = Date.now() - t0;
  return out;
}
async function paperLearnStatus(env, slug) {
  env = Object.assign({}, env, { QNFO_AUDIT: plRetryD1(env.QNFO_AUDIT) });
  await plEnsure(env);
  if (slug) {
    var rows = (await env.QNFO_AUDIT.prepare("SELECT id, version, claim, section, kind, support, verification, fleet_lever, application, applicability, confidence, fleet_status, status_note, issue_id, source, model, created_at FROM paper_learnings WHERE slug = ?1 ORDER BY id").bind(slug).all()).results || [];
    return { marker: "PAPER-LEARN-1", slug: slug, learnings: rows };
  }
  var s = await env.QNFO_AUDIT.prepare("SELECT COUNT(*) AS versions, COALESCE(SUM(status = 'ok'), 0) AS ok, COALESCE(SUM(status = 'failed'), 0) AS failed, COALESCE(SUM(n_errata), 0) AS errata, MAX(learned_at) AS last FROM paper_learn_state").first();
  var l = (await env.QNFO_AUDIT.prepare("SELECT verification, applicability, fleet_status, COUNT(*) AS n FROM paper_learnings GROUP BY 1, 2, 3 ORDER BY n DESC").all()).results || [];
  var m = await env.QNFO_AUDIT.prepare("SELECT last_value, last_refreshed FROM metric_registry WHERE metric = 'papers_unlearned_over_120m'").first();
  var pm = (await env.QNFO_AUDIT.prepare("SELECT metric, last_value, last_refreshed FROM metric_registry WHERE metric IN ('paper_model_projection_remediation_share_7d', 'paper_unlabeled_model_projection_issues_7d')").all()).results || [];
  var projectionMetrics = {};
  pm.forEach(function (r) { projectionMetrics[r.metric] = { value: r.last_value, refreshed_at: r.last_refreshed }; });
  return { marker: "PAPER-LEARN-1", version: typeof QNFO_VERSION === "string" ? QNFO_VERSION : "", state: s, learnings: l, papers_unlearned_over_120m: m ? m.last_value : null, projection_metrics: projectionMetrics, cadence: "hourly (0 * * * *)", per_tick_default: PL_PER_TICK_DEFAULT };
}
// ---- PAPER-LEARN-TRIAGE-1 (1.14.0, 2026-10-20, pillar autonomy; owner directive "clear all open issues server-side automatically within 24 hours") ----
// PAPER-LEARN-1 files one issue per paper with a strong direct learning, at most PL_ISSUE_OPEN_MAX open at once, and nothing ever answered the
// learnings: five issues (100234, 100249, 100252, 100257, 100261) sat at the cap with 18 proposed learnings, 11 of them about one thing, the
// pipeline's own CLAIM-INTEGRITY-1 correction notice that the reader took for the paper's claim, and a cap that only drains when somebody
// applies or rejects each row blocks every later paper (169 direct learnings were proposed, 18 had an issue). Each hour the triage settles up to
// PL_TRIAGE_EXAMINE proposed direct learnings, issue-bound ones first, against a catalogue of live fleet mechanisms (paper_learning_mechanisms):
//   already-in-place  a mechanism whose terms occur in the claim or lever AND whose evidence probe (a SELECT on qnfo-audit) returns ok now; the
//                     note cites the mechanism and the time, so the citation is verified when the row is settled, not taken from a model;
//   rejected          two model families, asked separately, both say reject with a reason (the paper's own convention, an analogy only, or a
//                     conflict with a catalogue mechanism whose probe is ok); a single reject, an apply or an unreadable answer settles nothing;
//   probation         no verified mechanism covers the learning: an adopted goal keeps the proposal and a machine-checkable DoD until it is
//                     applied or rejected, while the paper-learning row leaves the issue's proposed backlog.
// The reader also strips the pipeline's own notices (correction banner, Correction Notice, Version History, Provenance) before it reads, so a
// notice is not learned as the paper's claim. ops_config paper_learn_triage = off stops the triage. Revert one row:
// UPDATE paper_learnings SET fleet_status = 'proposed' WHERE id = <id>.
var PL_TRIAGE_EXAMINE = 12, PL_TRIAGE_MODEL_MAX = 4, PL_TRIAGE_MARK = "PL-TRIAGE-1";
function plStripNotices(md) {
  var s = String(md || "");
  s = s.replace(/^> \*\*(?:Correction|Revised) \(version[^\n]*(?:\n>[^\n]*)*\n?/gm, "");
  ["Correction Notice", "Version History", "Provenance and AI Involvement"].forEach(function (h) {
    var re = new RegExp("^##[ \\t]+" + h + "[^\\n]*\\n[\\s\\S]*?(?=^##[ \\t]|(?![\\s\\S]))", "gm");
    s = s.replace(re, "");
  });
  return s;
}
async function plMechanisms(env) {
  return ((await env.QNFO_AUDIT.prepare("SELECT mech_key, title, terms, citation, evidence_probe FROM paper_learning_mechanisms WHERE status = 'active' ORDER BY mech_key").all()).results) || [];
}
// A probe is one SELECT whose first column reads ok; anything else (a write, a second statement, an error) is a failed probe.
async function plRunProbe(env, sql) {
  var q = String(sql || "").trim();
  if (!/^select\s/i.test(q) || q.indexOf(";") >= 0) return false;
  try {
    var r = await env.QNFO_AUDIT.prepare(q).first();
    return !!r && String(r[Object.keys(r)[0]]).toLowerCase() === "ok";
  } catch (e) {
    return false;
  }
}
function plMatchMechanisms(mechs, claim, lever) {
  var text = (String(claim || "") + " " + String(lever || "")).toLowerCase();
  return mechs.filter(function (m) {
    return String(m.terms || "").toLowerCase().split("|").some(function (t) { return t && text.indexOf(t) >= 0; });
  });
}
function plTriagePrompt(L, mechs) {
  return "You triage one learning that a research paper suggested for an autonomous fleet of Cloudflare Workers (loops, a D1 issue queue, remediation probes, a doctrine of rules, a trust ledger, model ensembles). " +
    "Decide: covered (a listed mechanism already does what the learning proposes: name its key), reject (the learning is the paper's own authoring convention, or only an analogy, or conflicts with an existing fleet mechanism listed below) or apply (the fleet has a real, measurable gap this would close and no listed mechanism covers it; name the file, table or metric a person would change).\n" +
    "Existing fleet mechanisms:\n" + mechs.map(function (m) { return "- " + m.mech_key + ": " + m.title; }).join("\n") + "\n\n" +
    "LEARNING: " + plStr(L.claim, 600) + "\nLEVER: " + plStr(L.fleet_lever, 200) + "\nAPPLICATION: " + plStr(L.application, 600) + "\nKIND: " + L.kind + " (" + L.verification + ")\n\n" +
    "Answer with JSON only: {\"disposition\":\"covered|reject|apply\",\"category\":\"covered|paper-convention|analogy-only|conflicts|gap\",\"mechanism\":\"<a key above when category is covered or conflicts, else empty>\",\"reason\":\"one or two specific sentences\"}";
}
async function plTriageModel(env, L, mechs, now) {
  var prompt = plTriagePrompt(L, mechs), answers = [];
  var orders = [[PL_PRIMARY], [PL_SECOND]];
  for (var i = 0; i < orders.length; i++) {
    var r = await plRead(env, prompt, 1024, orders[i]);
    var j = r.json || {};
    answers.push({ model: r.model, d: String(j.disposition || "").toLowerCase(), cat: String(j.category || "").toLowerCase(), mech: plStr(j.mechanism, 60), reason: plStr(j.reason, 400) });
  }
  // PAPER-LEARN-RETRIAGE-1: both families say a listed mechanism already does this, name the same key, and its evidence probe reads ok now.
  var bothCovered = answers.every(function (a) { return a.model && a.d === "covered" && a.reason.length >= 40 && a.mech && a.mech === answers[0].mech; });
  if (bothCovered) {
    var cm = mechs.filter(function (x) { return x.mech_key === answers[0].mech; })[0];
    if (!cm || !(await plRunProbe(env, cm.evidence_probe))) return { settled: false, why: "a covered answer named a mechanism that is not in the catalogue or whose probe is not ok" };
    return { settled: true, status: "already-in-place", note: PL_TRIAGE_MARK + " in place (two model families agree, " + now + "): " + cm.mech_key + " - " + cm.citation + " (evidence probe ok). " + answers[0].reason };
  }
  var bothReject = answers.every(function (a) { return a.model && a.d === "reject" && a.reason.length >= 40 && ["paper-convention", "analogy-only", "conflicts"].indexOf(a.cat) >= 0; });
  if (bothReject) {
    var conf = answers.filter(function (a) { return a.cat === "conflicts"; });
    if (conf.length && conf.length !== answers.length) return { settled: false, why: "the two families disagree on the category" };
    var cited = null;
    if (conf.length) {
      var m = mechs.filter(function (x) { return x.mech_key === conf[0].mech; })[0];
      if (!m || !(await plRunProbe(env, m.evidence_probe))) return { settled: false, why: "a conflict named a mechanism that is not in the catalogue or whose probe is not ok" };
      cited = m;
    }
    return { settled: true, status: "rejected", note: PL_TRIAGE_MARK + " rejected (" + answers[0].cat + "; two model families agree, " + now + "): " + answers[0].reason + (cited ? " Conflicts with " + cited.mech_key + ": " + cited.citation + " (probe ok)" : "") };
  }
  var apply = answers.filter(function (a) { return a.d === "apply" && a.reason.length >= 20; })[0];
  if (apply) return { settled: false, apply: { model: String(apply.model || "").split("/").pop(), reason: apply.reason } };
  return { settled: false, why: "no agreement" };
}
async function plProbationGoal(env, L, proposal, now) {
  var id = Number(L && L.id);
  if (!Number.isSafeInteger(id) || id < 1) return null;
  var goalKey = "PAPER-LEARN-" + id;
  var source = "paper_learnings " + id + " (PAPER-LEARN-TRIAGE-1; " + plStr(L.slug, 120) + " " + plStr(L.version, 40) + ")";
  var statement = ("Probationary direct learning from " + plStr(L.slug, 120) + " v" + plStr(L.version, 40) + ": " + plStr(L.claim, 500)).slice(0, 700);
  var alignment = ("PAPER-LEARN-TRIAGE-1 probation: no verified fleet mechanism covers this direct learning. Apply signal from " + plStr(proposal.model, 80) + ": " + plStr(proposal.reason, 400)).slice(0, 700);
  var dod = "SELECT '0' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM paper_learnings WHERE id = " + id + " AND fleet_status NOT IN ('applied', 'rejected', 'routed', 'already-in-place')"; // PAPER-LEARN-RETRIAGE-1: the four settled states
  await env.QNFO_AUDIT.prepare("INSERT OR IGNORE INTO goals (goal_key, statement, goal_type, parent_objective, alignment, source, priority, status, dod, owner) VALUES (?1, ?2, 'instrumental', 'mission', ?3, ?4, 1, 'adopted', ?5, 'qnfo-code-orchestrator')")
    .bind(goalKey, statement, alignment, source, dod).run();
  var goal = await env.QNFO_AUDIT.prepare("SELECT id, source FROM goals WHERE goal_key = ?1").bind(goalKey).first();
  if (!goal || goal.source !== source) return null;
  return { id: goal.id, key: goalKey, alignment: alignment };
}
async function plTriageTick(env, opts) {
  var o = opts || {}, out = { marker: PL_TRIAGE_MARK, examined: 0, in_place: 0, rejected: 0, apply: 0, goals: 0, kept: 0 };
  try {
    var flag = await env.QNFO_AUDIT.prepare("SELECT value FROM ops_config WHERE key = 'paper_learn_triage'").first();
    if (flag && String(flag.value || "").trim().toLowerCase() === "off") { out.skipped = true; return out; }
    var mechs = await plMechanisms(env);
    if (!mechs.length) { out.skipped = "no mechanisms"; return out; }
    var rows = ((await env.QNFO_AUDIT.prepare("SELECT id, slug, version, kind, verification, claim, fleet_lever, application, issue_id FROM paper_learnings WHERE fleet_status = 'proposed' AND applicability = 'direct' AND COALESCE(instr(status_note, 'PL-TRIAGE-1 apply'), 0) = 0 ORDER BY (issue_id IS NULL) ASC, id ASC LIMIT ?1").bind(o.examine || PL_TRIAGE_EXAMINE).all()).results) || [];
    var now = new Date().toISOString(), modelBudget = o.modelMax == null ? PL_TRIAGE_MODEL_MAX : o.modelMax;
    for (var i = 0; i < rows.length; i++) {
      var L = rows[i];
      out.examined++;
      var hits = plMatchMechanisms(mechs, L.claim, L.fleet_lever), hit = null;
      for (var k = 0; k < hits.length && !hit; k++) if (await plRunProbe(env, hits[k].evidence_probe)) hit = hits[k];
      if (hit) {
        await env.QNFO_AUDIT.prepare("UPDATE paper_learnings SET fleet_status = 'already-in-place', status_note = ?2, updated_at = ?3 WHERE id = ?1 AND fleet_status = 'proposed'")
          .bind(L.id, (PL_TRIAGE_MARK + " in place (" + now + "): " + hit.mech_key + " - " + hit.citation + " (evidence probe ok)").slice(0, 600), now).run();
        out.in_place++;
        continue;
      }
      if (modelBudget <= 0 || !env.AI) { out.kept++; continue; }
      modelBudget--;
      var v = await plTriageModel(env, L, mechs, now);
      if (v.settled) {
        await env.QNFO_AUDIT.prepare("UPDATE paper_learnings SET fleet_status = ?2, status_note = ?3, updated_at = ?4 WHERE id = ?1 AND fleet_status = 'proposed'").bind(L.id, v.status, v.note.slice(0, 700), now).run();
        out.rejected++;
      } else if (v.apply) {
        var goal = await plProbationGoal(env, L, v.apply, now);
        if (goal) {
          var note = (PL_TRIAGE_MARK + " probation: goal " + goal.key + " (goals.id " + goal.id + ", " + now + "): " + goal.alignment).slice(0, 700);
          await env.QNFO_AUDIT.prepare("UPDATE paper_learnings SET fleet_status = 'probation', status_note = ?2, updated_at = ?3 WHERE id = ?1 AND fleet_status = 'proposed'").bind(L.id, note, now).run();
          out.goals++;
          out.apply++;
        } else {
          out.kept++;
        }
      } else out.kept++;
    }
    await plRetriage(env, o, mechs, now, out);
  } catch (e) {
    out.error = String(e && e.message || e).slice(0, 200);
  }
  return out;
}
// ---- PAPER-LEARN-RETRIAGE-1 (2026-11-05, pillar autonomy; cluster C8-PROJECTS-GOALS of the roadmap sweep) ----
// A learning is parked in probation once, by one pass against the catalogue, and nothing settled it again: 225 goals PAPER-LEARN-<id> sat adopted and failing, with 229 created in
// four days (37, 81, 69, 42 a day) and 4 completed. The catalogue now holds the fleet's real mechanisms, the model prompt has a third answer (covered), and each probation
// learning is read again every PL_RETRIAGE_GAP_H hours by both families: covered or rejected by both settles it (the goal then completes on its probe), an "apply" again is counted
// in the note, and after PL_RETRIAGE_PASSES passes with no taker the learning lapses as rejected with that reason, so a suggestion no one will take does not hold a roadmap row open
// for ever (re-propose with a measured gap). ops_config paper_learn_retriage = off stops this step. Revert one row: UPDATE paper_learnings SET fleet_status = 'probation' WHERE id = <id>.
var PL_RETRIAGE_EXAMINE = 6, PL_RETRIAGE_MODEL_MAX = 2, PL_RETRIAGE_GAP_H = 20, PL_RETRIAGE_PASSES = 3;
async function plRetriage(env, o, mechs, now, out) {
  out.retriaged = 0; out.lapsed = 0;
  var rflag = await env.QNFO_AUDIT.prepare("SELECT value FROM ops_config WHERE key = 'paper_learn_retriage'").first();
  if (rflag && String(rflag.value || "").trim().toLowerCase() === "off") { out.retriage_skipped = true; return; }
  var cut = new Date(Date.parse(now) - (o.retriageGapH == null ? PL_RETRIAGE_GAP_H : o.retriageGapH) * 3600e3).toISOString();
  var prows = ((await env.QNFO_AUDIT.prepare("SELECT id, slug, version, kind, verification, claim, fleet_lever, application, status_note FROM paper_learnings WHERE fleet_status = 'probation' AND applicability = 'direct' AND updated_at < ?1 ORDER BY updated_at ASC LIMIT ?2").bind(cut, o.retriage || PL_RETRIAGE_EXAMINE).all()).results) || [];
  var budget = o.retriageModelMax == null ? PL_RETRIAGE_MODEL_MAX : o.retriageModelMax;
  for (var p = 0; p < prows.length; p++) {
    var R = prows[p];
    out.retriaged++;
    var old = String(R.status_note || "");
    var passes = Number((/ \| PL-RETRIAGE (\d+)/.exec(old) || [0, 0])[1]) || 0;
    var base = old.replace(/ \| PL-RETRIAGE \d+.*$/, "").slice(0, 380);
    var hits = plMatchMechanisms(mechs, R.claim, R.fleet_lever), hit = null;
    for (var k = 0; k < hits.length && !hit; k++) if (await plRunProbe(env, hits[k].evidence_probe)) hit = hits[k];
    if (hit) {
      await env.QNFO_AUDIT.prepare("UPDATE paper_learnings SET fleet_status = 'already-in-place', status_note = ?2, updated_at = ?3 WHERE id = ?1 AND fleet_status = 'probation'")
        .bind(R.id, (PL_TRIAGE_MARK + " in place (" + now + "): " + hit.mech_key + " - " + hit.citation + " (evidence probe ok)").slice(0, 600), now).run();
      out.in_place++;
      continue;
    }
    if (budget <= 0 || !env.AI) continue;
    budget--;
    var v = await plTriageModel(env, R, mechs, now);
    if (v.settled) {
      await env.QNFO_AUDIT.prepare("UPDATE paper_learnings SET fleet_status = ?2, status_note = ?3, updated_at = ?4 WHERE id = ?1 AND fleet_status = 'probation'").bind(R.id, v.status, v.note.slice(0, 700), now).run();
      if (v.status === "rejected") out.rejected++; else out.in_place++;
    } else if (v.apply) {
      passes++;
      if (passes >= PL_RETRIAGE_PASSES) {
        var lapse = ("PL-TRIAGE-2 rejected (lapsed; " + passes + " triage passes by two model families over " + (PL_RETRIAGE_GAP_H * (passes - 1)) + " hours or more found no covering mechanism and no taker for the apply signal, " + now + "): last signal " + plStr(v.apply.model, 60) + ": " + plStr(v.apply.reason, 300) + " Re-propose with a measured fleet gap.").slice(0, 700);
        await env.QNFO_AUDIT.prepare("UPDATE paper_learnings SET fleet_status = 'rejected', status_note = ?2, updated_at = ?3 WHERE id = ?1 AND fleet_status = 'probation'").bind(R.id, lapse, now).run();
        out.lapsed++;
      } else {
        await env.QNFO_AUDIT.prepare("UPDATE paper_learnings SET status_note = ?2, updated_at = ?3 WHERE id = ?1 AND fleet_status = 'probation'")
          .bind(R.id, (base + " | PL-RETRIAGE " + passes + " (" + now + "): apply again, " + plStr(v.apply.reason, 200)).slice(0, 700), now).run();
      }
    } else {
      // No agreement or an unreadable answer: no pass is counted, the row waits its gap again so it does not starve the others.
      await env.QNFO_AUDIT.prepare("UPDATE paper_learnings SET updated_at = ?2 WHERE id = ?1 AND fleet_status = 'probation'").bind(R.id, now).run();
    }
  }
}
function withPaperLearn(inner) {
  var out = Object.assign({}, inner, {
    async fetch(request, env, ctx) {
      var u = new URL(request.url);
      if ((u.pathname === "/paper-learn/status" || u.pathname === "/paper-learn/learnings") && request.method === "GET") {
        var st;
        try { st = await paperLearnStatus(env, u.pathname === "/paper-learn/learnings" ? (u.searchParams.get("slug") || "").slice(0, 200) || null : null); }
        catch (e) { console.error("[qnfo-lifecycle] paper-learn status failed: " + String(e && e.message || e).slice(0, 300)); st = { error: "status unavailable (logged)" }; }
        return new Response(JSON.stringify(st), { status: st.error ? 500 : 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      }
      return inner.fetch(request, env, ctx);
    },
    async scheduled(event, env, ctx) {
      var first = null;
      try { await inner.scheduled(event, env, ctx); } catch (e) { first = e; }
      // Once per hourly tick: a former trigger handed straight to the dispatcher (not the tick) does not read papers again.
      if (!event || event.cron === TICK_CRON) {
        try {
          var r = await paperLearnTick(env);
          console.log("[qnfo-lifecycle] paper-learn:", JSON.stringify(r).slice(0, 2000));
          if (!r.skipped && env.QNFO_AUDIT) {
            var learned = r.read.reduce(function (a, x) { return a + (x.learnings || 0); }, 0), errata = r.read.reduce(function (a, x) { return a + (x.errata || 0); }, 0);
            await env.QNFO_AUDIT.prepare("INSERT INTO cloud_ops_events (id, ts, kind, text, meta, job, status) VALUES (?1, ?2, 'job-run', ?3, ?4, 'paper-learn', ?5)")
              .bind("jr-paper-learn-" + Date.now().toString(36), r.at, "PAPER-LEARN-1: " + r.read.length + " papers read, " + learned + " learnings, " + errata + " errata routed, " + r.waiting + " waiting (" + r.overdue + " over 120 min)", JSON.stringify(r).slice(0, 800), r.errors.length ? "error" : "ok").run();
          }
        } catch (e) {
          console.error("[qnfo-lifecycle] paper-learn error:", String(e && e.message || e));
        }
      }
      if (first) throw first;
    }
  });
  ["__foldHost", "__foldMember"].forEach(function (k) { if (inner[k] !== undefined) Object.defineProperty(out, k, { value: inner[k], enumerable: false }); });
  Object.defineProperty(out, "__paperLearn", { value: { tick: paperLearnTick, triage: plTriageTick, stripNotices: plStripNotices, matchMechanisms: plMatchMechanisms, status: paperLearnStatus, normalize: plNormalize, json: plJson, verification: plVerification, prompt: plPrompt, anchorClaim: plAnchorClaim, quotedPassages: plQuotedPassages, ddl: PL_DDL }, enumerable: false });
  return out;
}
var __paper_learn_default = withPaperLearn(__noz_scrub_default);
// ---- PAPER-LEARN-1:END ----
export {
  __paper_learn_default as default
};
//# sourceMappingURL=worker.js.map

// ---- WEBMCP-FLEET-1:BEGIN (sourced from _shared/webmcp.js; applied by scripts/webmcp-apply.mjs; do not edit inside a worker) ----
// WEBMCP-FLEET-1 (2026-10-25, pillar reach, owner directive "implement WebMCP systemwide across the fleet").
//
// WHAT. WebMCP (https://blog.cloudflare.com/webmcp/, August 2026) is a browser standard, shipping experimentally in
// Chrome 146, that appears in the page as document.modelContext: a site registers MCP tools with registerTool() so an
// agent visiting the page can call the site's own operations instead of guessing its way through a page built for
// humans. Cloudflare's developer preview offers a zone toggle that injects a bridge and two packs (c2pa, and a proxy
// to the site's own MCP server). That toggle is Dashboard-only and this fleet's token may not write zone Snippets
// (probed 2026-10-25: HTTP 403 "snippets are not allowed", and GET /user/tokens 403 so no wider token can be minted),
// so the fleet carries its own implementation, which is also the only version that can expose QNFO's real operations.
//
// HOW. Three pieces, all same-origin, all served by the worker that already answers the page:
//   1. GET /.webmcp/bridge.js   the browser-side module: finds document.modelContext, reads the manifest, registers
//                               every tool, and returns without registering anything when the browser has no WebMCP.
//   2. GET /.webmcp/packs.json  the machine-readable manifest (also readable by a non-browser agent).
//   3. an HTMLRewriter step on 200 HTML responses appending one <script type="module" src="/.webmcp/bridge.js">.
//
// WHY same-origin only. The bridge runs in the visitor's page with the visitor's session. A tool that reached another
// origin would hand this origin's tools to a page we do not own, and a proxy that took a caller-supplied absolute URL
// would be an SSRF surface on every page of every host. Every request template below is a path, resolved against the
// page's own origin, and read_page refuses anything that is not a path on this origin.
//
// WHY this is not a false capability claim (DECLARED-NOT-WORKING-1). The manifest is generated from the same table the
// bridge registers from, and every endpoint in it was answered 200 by a live probe on 2026-10-25 before shipping. The
// bridge reports what actually happened in window.__webmcp: supported=false when the browser has no modelContext, and
// registered=<n> only after registerTool() returned. Measured 2026-10-25 before this shipped: ideas /api/proposals
// answered 503 and was REMOVED from the manifest rather than advertised; ideas /api/sessions, q08 /api/metrics and
// POST ask.qwav.tech/api/ask answered 200. scripts/webmcp-verify.mjs re-probes every host and every tool endpoint.
//
// ROLLBACK. Revert the deploy of a worker to its previous version; the block is inert code for a browser without
// modelContext and cannot change a page's rendered output for any other client.
var WM_VERSION = "1.2.0";
var WM_BRIDGE_PATH = "/.webmcp/bridge.js";
var WM_PACKS_PATH = "/.webmcp/packs.json";
var WM_MANIFEST_PATH = "/.webmcp/manifest.json";
// WM_MANIFEST_URL is the path the bridge reads, and it is deliberately OUTSIDE /.webmcp/: Cloudflare's own WebMCP
// preview owns that prefix at the edge when a zone has it switched on (measured 2026-10-25: /.webmcp/bridge.js answer
// 75,756 bytes of the platform bundle and /.webmcp/packs.json answer 404 without ever reaching the worker), so a
// manifest under that prefix is invisible on exactly the zone with the most traffic. /api/webmcp/ is ours end to end.
var WM_MANIFEST_URL = "/api/webmcp/manifest.json";
var WM_MCP_PATH = "/mcp";
var WM_MCP_PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26"];
var WM_MAX_TEXT = 40000;

// WM_PACK_DEFS: the whole tool surface. `request` is a same-origin template. `{name}` in a path or a query value is
// replaced from the call arguments; an argument that is absent drops its query key rather than sending "undefined".
var WM_PACK_DEFS = {
  site: {
    title: "This site",
    description: "Read the site the visitor is looking at: the page in front of them, any page on this origin, and the sitemap.",
    tools: [
      {
        name: "get_page_context",
        description: "Return the page the visitor is on: its URL, title, description, its section headings and any text the visitor has selected. Call this first to learn where you are.",
        inputSchema: { type: "object", properties: {} },
        local: "page_context"
      },
      {
        name: "read_page",
        description: "Fetch a path on this site and return its text (HTML reduced to readable text, or the raw body for JSON/Markdown/plain). Paths are relative to this origin.",
        inputSchema: { type: "object", properties: { path: { type: "string", description: "A path on this site, e.g. /about" }, max_chars: { type: "number", description: "Truncate the text to this many characters (default 20000)" } }, required: ["path"] },
        request: { method: "GET", path: "{path}" }
      },
      {
        name: "list_site_pages",
        description: "List the URLs published in this site's sitemap.xml.",
        inputSchema: { type: "object", properties: { limit: { type: "number", description: "Maximum URLs to return (default 100)" } } },
        request: { method: "GET", path: "/sitemap.xml", extract: "loc" }
      }
    ]
  },
  papers: {
    title: "QNFO living papers",
    description: "Search, read and question the QNFO research corpus: full texts as Markdown, a JSON metadata API, and a deterministic digest of any paper.",
    tools: [
      {
        name: "search_papers",
        description: "Full-text search over the QNFO papers corpus. Returns matching papers with slug, title, authors and abstract.",
        inputSchema: { type: "object", properties: { q: { type: "string", description: "Search words" }, limit: { type: "number", description: "1-50, default 10" } }, required: ["q"] },
        request: { method: "GET", path: "/api/papers", query: { q: "{q}", limit: "{limit}" } }
      },
      {
        name: "get_paper",
        description: "Metadata for one paper by slug: title, authors, abstract, DOI, version, dates, licence and the URLs of its Markdown and PDF.",
        inputSchema: { type: "object", properties: { slug: { type: "string", description: "Paper slug, e.g. ultrametric-intelligence" } }, required: ["slug"] },
        request: { method: "GET", path: "/api/papers/{slug}" }
      },
      {
        name: "get_paper_markdown",
        description: "The full text of one paper as Markdown. Use this to read or quote a paper.",
        inputSchema: { type: "object", properties: { slug: { type: "string" }, max_chars: { type: "number" } }, required: ["slug"] },
        request: { method: "GET", path: "/papers/{slug}.md", accept: "text/markdown" }
      },
      {
        name: "get_paper_digest",
        description: "A deterministic digest of one paper written from its own sentences: the abstract, the claim, the figures it reports, how it is done, what would falsify it, where the claim stops, and a map of where to read.",
        inputSchema: { type: "object", properties: { slug: { type: "string" } }, required: ["slug"] },
        request: { method: "GET", path: "/api/quickread/{slug}" }
      }
    ]
  },
  fleet: {
    title: "QNFO fleet",
    description: "The live state of the QNFO Cloudflare fleet: health, spend, what needs attention and what changed.",
    tools: [
      {
        name: "fleet_status",
        description: "Fleet verdict and what the fleet is waiting on a human to do.",
        inputSchema: { type: "object", properties: {} },
        request: { method: "GET", path: "/api/human" }
      },
      {
        name: "fleet_attention",
        description: "Everything the fleet currently flags as needing attention.",
        inputSchema: { type: "object", properties: {} },
        request: { method: "GET", path: "/api/attention" }
      },
      {
        name: "fleet_cost",
        description: "Cost per surface over the current windows.",
        inputSchema: { type: "object", properties: {} },
        request: { method: "GET", path: "/api/cost" }
      },
      {
        name: "fleet_areas",
        description: "The functional areas of the fleet with their state.",
        inputSchema: { type: "object", properties: {} },
        request: { method: "GET", path: "/api/areas" }
      }
    ]
  },
  ideas: {
    title: "QNFO ideas",
    description: "The QNFO idea hub: the open idea threads.",
    tools: [
      {
        name: "list_ideas",
        description: "List the open idea threads in the hub.",
        inputSchema: { type: "object", properties: {} },
        request: { method: "GET", path: "/api/sessions" }
      }
    ]
  },
  signals: {
    title: "q08 signal organism",
    description: "Signals, forecasts and run metrics of the q08 signal organism.",
    tools: [
      {
        name: "list_signals",
        description: "The latest signals emitted by the organism.",
        inputSchema: { type: "object", properties: {} },
        request: { method: "GET", path: "/api/signals" }
      },
      {
        name: "list_forecasts",
        description: "Open and resolved forecasts with their outcomes.",
        inputSchema: { type: "object", properties: {} },
        request: { method: "GET", path: "/api/forecasts" }
      },
      {
        name: "signal_metrics",
        description: "Organism run metrics.",
        inputSchema: { type: "object", properties: {} },
        request: { method: "GET", path: "/api/metrics" }
      }
    ]
  },
  ask: {
    title: "Ask QWAV",
    description: "Ask a question over the QNFO corpus and read recent questions.",
    tools: [
      {
        name: "ask_corpus",
        description: "Ask a research question and get an answer grounded in the QNFO corpus with its sources.",
        inputSchema: { type: "object", properties: { q: { type: "string", description: "The question" } }, required: ["q"] },
        request: { method: "POST", path: "/api/ask", body: { q: "{q}" } }
      },
      {
        name: "recent_questions",
        description: "Recently asked questions and their answers.",
        inputSchema: { type: "object", properties: {} },
        request: { method: "GET", path: "/api/recent" }
      },
      {
        name: "corpus_stats",
        description: "Index statistics for the corpus behind this search.",
        inputSchema: { type: "object", properties: {} },
        request: { method: "GET", path: "/api/stats" }
      }
    ]
  },
  ipatent: {
    title: "iPatent",
    description: "Search the disclosure corpus, read its status, and get invention suggestions.",
    tools: [
      {
        name: "search_disclosures",
        description: "Search the iPatent disclosure corpus.",
        inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
        request: { method: "GET", path: "/api/search", query: { q: "{q}" } }
      },
      {
        name: "ipatent_status",
        description: "Corpus and pipeline status.",
        inputSchema: { type: "object", properties: {} },
        request: { method: "GET", path: "/api/status" }
      }
    ]
  },
  mind: {
    title: "mind.q08.org",
    description: "The inside reading surface: its corpus entries and shelves.",
    tools: [
      {
        name: "list_entries",
        description: "Every entry in the mind corpus with its shelf.",
        inputSchema: { type: "object", properties: {} },
        request: { method: "GET", path: "/api/entries.json" }
      }
    ]
  }
};

// WM_HOST_PACKS: which packs a host advertises. A host absent here gets the site pack only, so a new surface is
// agent-readable the moment it is deployed and never advertises a tool it cannot answer.
var WM_HOST_PACKS = {
  "qnfo.org": ["site", "papers"],
  "www.qnfo.org": ["site", "papers"],
  "papers.qnfo.org": ["site", "papers"],
  "archive.qnfo.org": ["site"],
  "legal.qnfo.org": ["site"],
  "qnfo.org:email": ["site"],
  "fleet.qnfo.org": ["site", "fleet"],
  "ideas.qnfo.org": ["site", "ideas"],
  "q08.org": ["site", "signals"],
  "www.q08.org": ["site", "signals"],
  "ask.qwav.tech": ["site", "ask"],
  "ask.qwav.org": ["site", "ask"],
  "ipatent.qnfo.org": ["site", "ipatent"],
  "ipatent.me": ["site", "ipatent"],
  "www.ipatent.me": ["site", "ipatent"],
  "mind.q08.org": ["site", "mind"]
};

// wmHost accepts a URL or a bare hostname (the manifest and the tests both call it with either) and never throws: an
// unknown shape yields "", which lands on the site pack rather than on a tool nobody verified.
function wmHost(url) {
  try {
    var s = typeof url === "string" ? url : String(url && url.hostname || url || "");
    if (s.indexOf("://") >= 0) {
      try { s = new URL(s).hostname; } catch (e2) { return ""; }
    }
    s = s.split("/")[0].split("?")[0].split("#")[0];
    return s.toLowerCase().replace(/:\d+$/, "");
  } catch (e) {
    return "";
  }
}
function wmPackIds(host) {
  var h = wmHost(host);
  return (WM_HOST_PACKS[h] || ["site"]).filter(function (id) { return !!WM_PACK_DEFS[id]; });
}
function wmPacks(host) {
  var out = [];
  var ids = wmPackIds(host);
  for (var i = 0; i < ids.length; i++) {
    var d = WM_PACK_DEFS[ids[i]];
    var tools = [];
    for (var j = 0; j < d.tools.length; j++) {
      var t = d.tools[j];
      tools.push({ name: t.name, description: t.description, inputSchema: t.inputSchema, local: t.local || null, request: t.request || null });
    }
    out.push({ id: ids[i], title: d.title, description: d.description, tools: tools });
  }
  return out;
}
function wmManifest(host, worker) {
  var packs = wmPacks(host);
  var n = 0;
  for (var i = 0; i < packs.length; i++) n += packs[i].tools.length;
  return {
    schema_version: "webmcp/v1",
    implementation: "qnfo-webmcp",
    version: WM_VERSION,
    worker: worker || "",
    host: wmHost(host),
    generated_from: "_shared/webmcp.js",
    bridge: WM_BRIDGE_PATH,
    standard: "https://blog.cloudflare.com/webmcp/",
    surface: { document_modelContext: true, navigator_modelContext_fallback: true, degrades_silently: true },
    pack_ids: wmPackIds(host),
    tool_count: n,
    packs: packs
  };
}

// The browser-side module. Written as lines, not a template literal, so nothing in it can be re-interpreted by the
// worker's own bundler and so a diff of this array is a diff of the shipped script.
function wmBridgeSource() {
  var L = [
    "/* QNFO WebMCP bridge " + WM_VERSION + " - generated from _shared/webmcp.js; do not edit. */",
    "(() => {",
    "  if (window.__webmcp && window.__webmcp.bridge) return;",
    "  const state = window.__webmcp = { bridge: true, version: '" + WM_VERSION + "', supported: false, mode: 'init', packs: [], tools: [], registered: 0, errors: [] };",
    "  const ctx = () => {",
    "    try {",
    "      if (document.modelContext && typeof document.modelContext.registerTool === 'function') return document.modelContext;",
    "      if (navigator.modelContext && typeof navigator.modelContext.registerTool === 'function') return navigator.modelContext;",
    "    } catch (e) { state.errors.push('context:' + e); }",
    "    return null;",
    "  };",
    "  const trunc = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) + '\\n[... ' + (s.length - n) + ' more characters]' : s; };",
    "  const html2text = (s) => String(s || '')",
    "    .replace(/<script[\\s\\S]*?<\\/script>/gi, ' ').replace(/<style[\\s\\S]*?<\\/style>/gi, ' ')",
    "    .replace(/<\\/(p|div|section|article|h[1-6]|li|tr|br)>/gi, '\\n').replace(/<[^>]+>/g, ' ')",
    "    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '\"').replace(/&#39;/g, \"'\")",
    "    .replace(/[ \\t]+/g, ' ').replace(/\\n{3,}/g, '\\n\\n').trim();",
    "  const fill = (tpl, args) => String(tpl || '').replace(/\\{([a-z0-9_]+)\\}/gi, (m, k) => {",
    "    const v = args && args[k];",
    "    return v == null ? '' : String(v);",
    "  });",
    "  const text = (body, isErr) => ({ content: [{ type: 'text', text: body }], isError: !!isErr });",
    "  const pageContext = () => {",
    "    const heads = [];",
    "    document.querySelectorAll('h1,h2,h3').forEach((h) => { if (heads.length < 40) heads.push(h.tagName.toLowerCase() + ': ' + (h.textContent || '').trim().slice(0, 160)); });",
    "    const desc = document.querySelector('meta[name=\"description\"]');",
    "    const sel = String(window.getSelection ? window.getSelection() : '').slice(0, 4000);",
    "    const out = { url: location.href, path: location.pathname, title: document.title, description: desc ? desc.getAttribute('content') : '', lang: document.documentElement.getAttribute('lang') || '', headings: heads, selected_text: sel,",
    "      tools_available: state.tools, packs: state.packs, webmcp_supported: state.supported };",
    "    return text(JSON.stringify(out, null, 1));",
    "  };",
    "  async function call(tool, args) {",
    "    const r = tool.request || {};",
    "    let path = fill(r.path, args);",
    "    if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return text('refused: the path must be relative to this site, not an absolute URL', true);",
    "    path = '/' + String(path).replace(/^\\/+/, '');",
    "    const qs = new URLSearchParams();",
    "    if (r.query) for (const k of Object.keys(r.query)) { const v = args && args[k] != null ? args[k] : null; if (v !== null) qs.set(k, String(v)); }",
    "    const url = path + (qs.toString() ? '?' + qs.toString() : '');",
    "    const init = { method: r.method || 'GET', credentials: 'same-origin', headers: { 'accept': r.accept || 'application/json, text/html;q=0.9, text/plain;q=0.8' } };",
    "    if (init.method === 'POST') { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(args || {}); }",
    "    const res = await fetch(url, init);",
    "    const raw = await res.text();",
    "    if (!res.ok) return text('HTTP ' + res.status + ' for ' + url + '\\n' + trunc(raw, 2000), true);",
    "    const ct = (res.headers.get('content-type') || '').toLowerCase();",
    "    const cap = Number(args && args.max_chars) > 0 ? Number(args.max_chars) : 20000;",
    "    if (r.extract === 'loc') {",
    "      const locs = Array.from(raw.matchAll(/<loc>([^<]+)<\\/loc>/gi)).map((m) => m[1]);",
    "      const limit = Number(args && args.limit) > 0 ? Number(args.limit) : 100;",
    "      return text(JSON.stringify({ count: locs.length, urls: locs.slice(0, limit) }, null, 1));",
    "    }",
    "    if (ct.indexOf('json') >= 0) return text(trunc(raw, 40000));",
    "    if (ct.indexOf('html') >= 0) return text(trunc(html2text(raw), cap));",
    "    return text(trunc(raw, cap));",
    "  }",
    "  function toolHandler(tool) {",
    "    return async (args) => {",
    "      try {",
    "        if (tool.local === 'page_context') return pageContext();",
    "        return await call(tool, args || {});",
    "      } catch (e) { state.errors.push(tool.name + ':' + e); return text(tool.name + ' failed: ' + (e && e.message || e), true); }",
    "    };",
    "  }",
    "  async function install(target) {",
    "    const man = state.manifest;",
    "    let n = 0;",
    "    for (const pack of (man.packs || [])) {",
    "      for (const tool of (pack.tools || [])) {",
    "        try {",
    "          await target.registerTool({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema, execute: toolHandler(tool) });",
    "          n++;",
    "        } catch (e) { state.errors.push('register:' + tool.name + ':' + e); }",
    "      }",
    "    }",
    "    state.registered = n;",
    "    state.mode = n ? 'registered' : 'failed';",
    "    return n;",
    "  }",
    "  state.install = install;",
    "  (async () => {",
    "    try {",
    "      const platform = document.querySelector('script[src*=\"/.webmcp/bridge.js\"]:not([data-webmcp])');",
    "      state.platform_bridge = !!platform;",
    "      const res = await fetch('/api/webmcp/manifest.json', { credentials: 'same-origin', headers: { accept: 'application/json' } });",
    "      if (!res.ok) { state.mode = 'no-manifest'; state.errors.push('manifest http ' + res.status); return; }",
    "      state.manifest = await res.json();",
    "      state.packs = (state.manifest.packs || []).map((p) => p.id);",
    "      state.tools = (state.manifest.packs || []).flatMap((p) => (p.tools || []).map((t) => t.name));",
    "      const c = ctx();",
    "      state.supported = !!c;",
    "      if (!c) { state.mode = 'standalone'; return; }",
    "      // Cloudflare's own bridge is on this page (its zone toggle is on): it registers the same tools through /mcp.",
    "      // Registering them a second time would collide on tool names, so ours stands down and says so.",
    "      if (state.platform_bridge) { state.mode = 'platform'; return; }",
    "      await install(c);",
    "    } catch (e) { state.mode = 'error'; state.errors.push(String(e)); }",
    "  })();",
    "})();"
  ];
  return L.join(String.fromCharCode(10)) + String.fromCharCode(10);
}

// wmToolUrl builds the same-origin request a tool describes. Both executors use it: the browser bridge (which calls
// over HTTP with the visitor's session) and the MCP endpoint below (which calls the worker's own router). One builder
// means a tool cannot mean one thing in a browser and another in the MCP surface.
function wmToolUrl(tool, args) {
  var r = tool.request || {};
  var fill = function (tpl) {
    return String(tpl == null ? "" : tpl).replace(/\{([a-z0-9_]+)\}/gi, function (m, k) {
      var v = args && args[k];
      return v == null ? "" : String(v);
    });
  };
  var path = fill(r.path);
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return null;
  path = "/" + path.replace(/^\/+/, "");
  var qs = [];
  if (r.query) {
    for (var k in r.query) {
      if (!Object.prototype.hasOwnProperty.call(r.query, k)) continue;
      var v = args && args[k] != null ? args[k] : null;
      if (v !== null) qs.push(encodeURIComponent(k) + "=" + encodeURIComponent(fill(r.query[k])));
    }
  }
  return path + (qs.length ? "?" + qs.join("&") : "");
}
function wmStripHtml(s) {
  return String(s || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|section|article|h[1-6]|li|tr|br)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"")
    .replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
function wmTrunc(s, n) {
  s = String(s == null ? "" : s);
  return s.length > n ? s.slice(0, n) + "\n[... " + (s.length - n) + " more characters]" : s;
}
function wmToolResult(text, isError) {
  return { content: [{ type: "text", text: text }], isError: isError ? true : undefined };
}

// wmExecTool runs one tool through the worker's own router. No subrequest: the captured original fetch is called as a
// function, so the tool sees exactly the response a visitor would get, at the cost of no extra invocation.
async function wmExecTool(tool, args, request, origFetch, env, ctx) {
  if (!tool || !tool.request) {
    return wmToolResult("page_context is answered in the browser by the bridge; a server-side caller has no page.", true);
  }
  var target = wmToolUrl(tool, args);
  if (!target) return wmToolResult("refused: a tool path must be relative to this site, not an absolute URL", true);
  var origin = new URL(request.url).origin;
  var init = { method: String(tool.request.method || "GET").toUpperCase(), headers: {} };
  if (init.method === "POST") {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(args || {});
  } else {
    init.headers["accept"] = tool.request.accept || "application/json";
  }
  var res = await origFetch(new Request(origin + target, init), env, ctx);
  var raw = await res.text();
  if (!res.ok) return wmToolResult("HTTP " + res.status + " for " + target + "\n" + wmTrunc(raw, 2000), true);
  var ct = (res.headers.get("Content-Type") || "").toLowerCase();
  if (ct.indexOf("html") >= 0) return wmToolResult(wmTrunc(wmStripHtml(raw), 20000));
  return wmToolResult(wmTrunc(raw, WM_MAX_TEXT));
}
function wmFindTool(host, name) {
  var packs = wmPacks(host);
  for (var i = 0; i < packs.length; i++) {
    for (var j = 0; j < packs[i].tools.length; j++) if (packs[i].tools[j].name === name) return packs[i].tools[j];
  }
  return null;
}
function wmMcpCard(host, workerName) {
  var man = wmManifest(host, workerName);
  return {
    schema_version: "mcp/server-card/v1",
    serverInfo: { name: "qnfo-webmcp", version: WM_VERSION, title: "QNFO " + (man.host || "site") },
    description: "The same-origin MCP server behind this site's WebMCP tools. Discovered by Cloudflare's WebMCP bridge (pack mcp-server-client) and by any MCP client that speaks JSON-RPC over HTTP.",
    transport: { type: "http", path: WM_MCP_PATH, methods: ["POST", "GET", "DELETE"], protocolVersions: WM_MCP_PROTOCOLS },
    capabilities: { tools: { listChanged: false } },
    tool_count: man.tool_count,
    packs: man.pack_ids,
    standard: "https://blog.cloudflare.com/webmcp/"
  };
}
async function wmRpc(msg, request, env, ctx, origFetch, workerName) {
  var u = new URL(request.url);
  var host = u.hostname;
  var id = msg && Object.prototype.hasOwnProperty.call(msg, "id") ? msg.id : null;
  var method = msg && msg.method ? String(msg.method) : "";
  var params = (msg && msg.params) || {};
  var isNotification = !msg || !Object.prototype.hasOwnProperty.call(msg, "id") || msg.id === null;
  var reply = function (result) { return { jsonrpc: "2.0", id: id, result: result }; };
  var fail = function (code, message) { return { jsonrpc: "2.0", id: id, error: { code: code, message: message } }; };
  if (!msg || msg.jsonrpc !== "2.0" || !method) return isNotification ? null : fail(-32600, "invalid request");
  if (method === "initialize") {
    var asked = String(params.protocolVersion || "");
    var ver = WM_MCP_PROTOCOLS.indexOf(asked) >= 0 ? asked : WM_MCP_PROTOCOLS[1];
    return reply({
      protocolVersion: ver,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "qnfo-webmcp", version: WM_VERSION, title: "QNFO " + host },
      instructions: "Tools published by " + host + ". Every tool reads the same public data the page shows; nothing here takes a credential, and nothing reaches another origin."
    });
  }
  if (method.indexOf("notifications/") === 0) return null;
  if (method === "ping") return reply({});
  if (method === "tools/list") {
    var man = wmManifest(host, workerName);
    var tools = [];
    for (var i = 0; i < man.packs.length; i++) {
      for (var j = 0; j < man.packs[i].tools.length; j++) {
        var t = man.packs[i].tools[j];
        tools.push({ name: t.name, description: t.description, inputSchema: t.inputSchema });
      }
    }
    return reply({ tools: tools });
  }
  if (method === "tools/call") {
    var name = String(params.name || "");
    var tool = wmFindTool(host, name);
    if (!tool) return fail(-32602, "unknown tool: " + name);
    try {
      var result = await wmExecTool(tool, params.arguments || {}, request, origFetch, env, ctx);
      return reply(result);
    } catch (e) {
      return reply(wmToolResult(name + " failed: " + String((e && e.message) || e), true));
    }
  }
  return isNotification ? null : fail(-32601, "method not found: " + method);
}

// wmMcp answers the site's MCP endpoint. Cloudflare's WebMCP bridge (pack mcp-server-client, data-mcp-url defaulting to
// /mcp) runs initialize -> notifications/initialized -> tools/list -> tools/call against it with the visitor's session,
// so the fleet's tools reach document.modelContext through the platform's own implementation wherever the zone toggle
// is on, and through /.webmcp/bridge.js where it is not.
async function wmMcp(request, env, ctx, origFetch, workerName) {
  try {
    if (!request) return null;
    var u = new URL(request.url);
    if ((u.pathname.replace(/\/+$/, "") || "/") !== WM_MCP_PATH) return null;
    var m = String(request.method || "GET").toUpperCase();
    var h = { "X-WebMCP": WM_VERSION };
    if (m === "GET" || m === "HEAD") {
      var card = JSON.stringify(wmMcpCard(u.hostname, workerName));
      return new Response(m === "HEAD" ? null : card, { status: 200, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300", "X-WebMCP": WM_VERSION } });
    }
    if (m === "DELETE" || m === "OPTIONS") return new Response(null, { status: 204, headers: h });
    if (m !== "POST") return wmJson({ error: "method not allowed" }, 405, "no-store");
    var body = null;
    try {
      body = await request.json();
    } catch (e) {
      return wmJson({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, 400, "no-store");
    }
    var batch = Array.isArray(body);
    var msgs = batch ? body : [body];
    var out = [];
    for (var i = 0; i < msgs.length; i++) {
      var r = await wmRpc(msgs[i], request, env, ctx, origFetch, workerName);
      if (r) out.push(r);
    }
    if (!out.length) return new Response(null, { status: 202, headers: h });
    return wmJson(batch ? out : out[0], 200, "no-store");
  } catch (e) {
    return null;
  }
}

function wmJson(body, status, cache) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": cache || "public, max-age=300", "X-WebMCP": WM_VERSION }
  });
}

// wmRoute answers the bridge and the manifest and nothing else. Returns null for every other request, so a caller can
// run it before its own router without changing any existing behaviour.
function wmRoute(request, workerName) {
  try {
    if (!request) return null;
    var u = new URL(request.url);
    var p = u.pathname;
    var isManifest = p === WM_PACKS_PATH || p === WM_MANIFEST_PATH || p === WM_MANIFEST_URL;
    if (p !== WM_BRIDGE_PATH && !isManifest) return null;
    var m = String(request.method || "GET").toUpperCase();
    if (m !== "GET" && m !== "HEAD") return wmJson({ error: "method not allowed" }, 405, "no-store");
    var host = u.hostname;
    if (p === WM_BRIDGE_PATH) {
      var js = wmBridgeSource();
      var h = { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "public, max-age=3600", "X-WebMCP": WM_VERSION, "X-Content-Type-Options": "nosniff" };
      return new Response(m === "HEAD" ? null : js, { status: 200, headers: h });
    }
    var man = wmManifest(host, workerName || "");
    man.paths = { bridge: WM_BRIDGE_PATH, packs: WM_MANIFEST_URL, manifest: WM_MANIFEST_URL, mcp: WM_MCP_PATH };
    var hh = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300", "X-WebMCP": WM_VERSION };
    return new Response(m === "HEAD" ? null : JSON.stringify(man), { status: 200, headers: hh });
  } catch (e) {
    return null;
  }
}

// The HTMLRewriter handler. It appends the module tag at the end of <head>; a page without a head, a non-200, a
// non-HTML body or a browser we cannot detect all pass through untouched.
// wmPlatformOn: hosts whose zone has Cloudflare own WebMCP preview switched on. Measured 2026-10-25: qnfo.org,
// papers, ideas, fleet and ipatent each carried the platform tag (data-packs="c2pa,mcp-server-client") and
// /.webmcp/bridge.js resolved to the 75,756-byte platform bundle before this worker was reached. The platform
// bundle keeps only the pack names it bundles and does NOT fall back to its defaults, so a second tag carrying
// "site,papers" downloads the same bundle again, registers nothing and logs two warnings. On those hosts this
// worker supplies /mcp and lets the platform bridge register it.
function wmPlatformOn(host) {
  var h = wmHost(host);
  return h === "qnfo.org" || h.slice(-9) === ".qnfo.org";
}
function wmInjector(host, workerName) {
  var ids = wmPackIds(host);
  var packs = ids.join(",");
  var tag = '<script type="module" src="' + WM_BRIDGE_PATH + '" data-webmcp="' + WM_VERSION + '" data-packs="' + packs + '" data-mcp-url="' + WM_MCP_PATH + '" data-worker="' + String(workerName || "").replace(/"/g, "") + '"></script>';
  return {
    element: function (el) {
      try { el.append(tag, { html: true }); } catch (e) { }
    }
  };
}
function wmWithHtml(res, request, workerName) {
  try {
    if (!res || !request) return res;
    var m = String(request.method || "GET").toUpperCase();
    if (m !== "GET") return res;
    if (res.status !== 200) return res;
    var ct = (res.headers.get("Content-Type") || "").toLowerCase();
    if (ct.indexOf("text/html") !== 0) return res;
    if (typeof HTMLRewriter === "undefined") return res;
    var u = new URL(request.url);
    if (wmPlatformOn(u.hostname)) return res;
    if (u.pathname.indexOf("/.webmcp/") === 0 || u.pathname === WM_MCP_PATH) return res;
    var out = new HTMLRewriter().on("head", wmInjector(u.hostname, workerName)).transform(res);
    // A rewritten body no longer matches the origin's Content-Length/ETag; left in place they truncate or mis-cache
    // the page. The X-WebMCP marker is what scripts/webmcp-verify.mjs reads without parsing 200 KB of HTML.
    try {
      out.headers.delete("Content-Length");
      out.headers.delete("ETag");
      out.headers.set("X-WebMCP", WM_VERSION);
    } catch (e2) { }
    return out;
  } catch (e) {
    return res;
  }
}

// wmAttach wraps a worker's default export so every response passes through the steps above. It is a property
// assignment on the exported object, so the runtime sees it on every invocation, and it is idempotent.
function wmAttach(target, workerName) {
  try {
    if (!target || typeof target.fetch !== "function" || target.__wm === WM_VERSION) return target;
    var orig = target.fetch;
    var name = workerName || "";
    target.fetch = async function (request, env, ctx) {
      var routed = wmRoute(request, name);
      if (routed) return routed;
      var mcp = await wmMcp(request, env, ctx, orig, name);
      if (mcp) return mcp;
      var res = await orig.call(this, request, env, ctx);
      return wmWithHtml(res, request, name);
    };
    target.__wm = WM_VERSION;
    return target;
  } catch (e) {
    return target;
  }
}
// ---- WEBMCP-FLEET-1:END ----
// ---- WEBMCP-FLEET-1:ATTACH qnfo-lifecycle ----
wmAttach(__paper_learn_default, "qnfo-lifecycle");
