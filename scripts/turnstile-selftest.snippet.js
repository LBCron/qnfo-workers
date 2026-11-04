// BEGIN TURNSTILE-SELFTEST-1
// TURNSTILE-SELFTEST-1 (agent_issues 1000681-1000683, pillar security): after TURNSTILE_SECRET was set on three workers nothing could show the
// new value works, because Cloudflare answers a wrong secret and a wrong visitor token with the same 403 to the visitor. siteverify itself tells
// them apart: a valid secret with a dummy token answers invalid-input-response, a wrong secret answers invalid-input-secret. At most once an hour
// this posts the bound secret with a dummy token and records the verdict as one cloud_ops_events row (kind turnstile-selftest, job = the worker,
// id = worker + hour, so a repeat in the same hour is a no-op). The secret is never logged or stored; nothing runs while TURNSTILE_SECRET is unbound.
var TURNSTILE_SELFTEST_WORKER = "snippet";
var turnstileSelfTestHour = "";
async function turnstileSelfTest(env) {
  var db = env && (env.AUDIT || env.QNFO_AUDIT);
  if (!env || !env.TURNSTILE_SECRET || !db) return { ran: false, reason: "no-secret-or-db" };
  var now = new Date(), hour = now.toISOString().slice(0, 13);
  if (turnstileSelfTestHour === hour) return { ran: false, reason: "done-this-hour" };
  turnstileSelfTestHour = hour;
  var id = "turnstile-selftest-" + TURNSTILE_SELFTEST_WORKER + "-" + hour;
  try {
    var seen = await db.prepare("SELECT 1 AS x FROM cloud_ops_events WHERE id = ?1").bind(id).first();
    if (seen) return { ran: false, reason: "done-this-hour" };
    var body = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: "turnstile-selftest-dummy-token" });
    var r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: body, signal: AbortSignal.timeout(10000) });
    if (!r.ok) { turnstileSelfTestHour = ""; return { ran: true, recorded: false, reason: "siteverify-" + r.status }; }
    var j = await r.json();
    var codes = ((j && j["error-codes"]) || []).map(String);
    var wrong = codes.indexOf("invalid-input-secret") >= 0 || codes.indexOf("missing-input-secret") >= 0;
    var testing = !!(j && j.metadata && j.metadata.result_with_testing_key);
    var accepted = !wrong && !testing && codes.indexOf("invalid-input-response") >= 0;
    var verdict = accepted ? "accepted" : wrong ? "rejected" : testing ? "testing-key" : "unknown";
    var text = "turnstile siteverify self-test (" + TURNSTILE_SELFTEST_WORKER + "): secret " + verdict + (accepted ? " by Cloudflare" : "") + " [" + codes.join(",").slice(0, 80) + "]";
    await db.prepare("INSERT OR IGNORE INTO cloud_ops_events (id, ts, kind, text, meta, job, status) VALUES (?1, ?2, 'turnstile-selftest', ?3, ?4, ?5, ?6)")
      .bind(id, now.toISOString(), text, JSON.stringify({ worker: TURNSTILE_SELFTEST_WORKER, secret: verdict, codes: codes.slice(0, 4), source: "selftest" }), TURNSTILE_SELFTEST_WORKER, accepted ? "ok" : "error").run();
    return { ran: true, recorded: true, verdict: verdict };
  } catch (e) {
    turnstileSelfTestHour = "";
    console.error(JSON.stringify({ worker: TURNSTILE_SELFTEST_WORKER, where: "turnstileSelfTest", error: String((e && e.message) || e).slice(0, 160) }));
    return { ran: true, recorded: false, error: "caught" };
  }
}
// END TURNSTILE-SELFTEST-1
