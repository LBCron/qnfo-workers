// AUTOROUTER-SHADOW-SCHEDULE-1 offline suite (qnfo-ai-calibration, roadmap row 1695, agent_issues 1002052). No network, no production data.
// Proves: the tick posts {confirm: true, limit: 3} to qnfo-ai /internal/eval/autorouter-shadow through the QNFO_AI binding once a day (stamp written before the call), skips inside 23 hours,
// stops on ai_calibration_config autorouter_shadow = off, never throws (a refused answer, a missing binding, a thrown fetch), and is called from calibration() after the gateway sweep.
// Run: node qnfo-ai-calibration/autorouter-schedule.test.mjs
import fs from "node:fs";
const src = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const api = new Function(src.replace(/export \{\s*(?:worker_default|__fk_\w+_default) as default\s*\};?/, "") + "\nreturn { autoRouterShadowDaily, VERSION };")();
const fail = [];
const eq = (l, g, w) => { if (JSON.stringify(g) !== JSON.stringify(w)) fail.push(l + ": got " + JSON.stringify(g) + " want " + JSON.stringify(w)); };
const ok = (l, c) => { if (!c) fail.push(l); };

function fakeEnv(cfg, fetchImpl) {
  const stamps = [];
  const env = {
    QNFO_AUDIT: {
      prepare(sql) {
        let args = [];
        const st = {
          bind: (...a) => { args = a; return st; },
          first: async () => (/SELECT value FROM ai_calibration_config/.test(sql) && Object.prototype.hasOwnProperty.call(cfg, args[0]) ? { value: cfg[args[0]] } : null),
          run: async () => { if (/INSERT INTO ai_calibration_config/.test(sql)) { stamps.push(args[0]); cfg.autorouter_shadow_last_ts = args[0]; } return {}; },
        };
        return st;
      },
    },
  };
  if (fetchImpl) env.QNFO_AI = { fetch: fetchImpl };
  return { env, stamps };
}

const NOW = Date.UTC(2026, 10, 6, 3, 0, 0);
let calls = [];
const okFetch = async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify({ ok: true, run_id: "r1", results: [{ status: "ok" }] }), { status: 200 }); };

// first run: never ran
let { env, stamps } = fakeEnv({}, okFetch);
let r = await api.autoRouterShadowDaily(env, NOW);
ok("first run calls the route", r.ran === true && r.ok === true && calls.length === 1);
eq("route and method", [calls[0].url, calls[0].init.method], ["https://qnfo-ai.internal/internal/eval/autorouter-shadow", "POST"]);
eq("body asks for confirm and limit 3", JSON.parse(calls[0].init.body), { confirm: true, limit: 3 });
ok("no Authorization header: the binding is trusted by caller props", !("authorization" in calls[0].init.headers) && !("Authorization" in calls[0].init.headers));
eq("stamp written once with the tick time", stamps, [String(NOW)]);
ok("summary carries the HTTP status", /^HTTP 200 /.test(r.summary));

// inside 23 hours: skipped, no call, no stamp
calls = [];
({ env, stamps } = fakeEnv({ autorouter_shadow_last_ts: String(NOW - 22 * 36e5) }, okFetch));
r = await api.autoRouterShadowDaily(env, NOW);
ok("skipped within 23 hours", r.ran === false && r.ok === true && calls.length === 0 && stamps.length === 0 && /ran 22 h ago/.test(r.summary));

// 24 hours later: runs again
calls = [];
({ env, stamps } = fakeEnv({ autorouter_shadow_last_ts: String(NOW - 24 * 36e5) }, okFetch));
r = await api.autoRouterShadowDaily(env, NOW);
ok("runs again after 24 hours", r.ran === true && calls.length === 1);

// switched off
calls = [];
({ env, stamps } = fakeEnv({ autorouter_shadow: "off" }, okFetch));
r = await api.autoRouterShadowDaily(env, NOW);
ok("off stops the call and the stamp", r.ran === false && r.summary === "off" && calls.length === 0 && stamps.length === 0);

// a refused answer is reported, never thrown; the stamp stays (retry tomorrow)
({ env, stamps } = fakeEnv({}, async () => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })));
r = await api.autoRouterShadowDaily(env, NOW);
ok("a 401 is reported, not thrown", r.ran === true && r.ok === false && /^HTTP 401 /.test(r.summary) && stamps.length === 1);

// a thrown fetch and a missing binding are reported, never thrown
({ env } = fakeEnv({}, async () => { throw new Error("boom"); }));
r = await api.autoRouterShadowDaily(env, NOW);
ok("a thrown fetch is reported", r.ok === false && /^err boom/.test(r.summary));
({ env } = fakeEnv({}, null));
r = await api.autoRouterShadowDaily(env, NOW);
ok("a missing binding is reported", r.ok === false && r.summary === "QNFO_AI binding missing");

// wiring: calibration() calls it once, after the gateway sweep, and records a result row
const body = src.slice(src.indexOf("async function calibration(env, trigger) {"));
const iSweep = body.indexOf("gatewayFailureSweep(env, t0)"), iShadow = body.indexOf("autoRouterShadowDaily(env, t0)");
ok("calibration calls the daily shadow once, after the gateway sweep", iSweep > 0 && iShadow > iSweep && body.split("autoRouterShadowDaily(env, t0)").length === 2);
ok("the change is marked", /AUTOROUTER-SHADOW-SCHEDULE-1/.test(src));

if (fail.length) { console.log(fail.join("\n")); console.log("autorouter-schedule FAILED " + fail.length); process.exit(1); }
console.log("autorouter-schedule ok");
