// EVAPI-ABORT-1 (#7076): evApi used to let a timed-out or failed GitHub fetch throw ("The operation was aborted"), which ended branchHygieneTick and every other
// caller's tick instead of degrading. It now answers { status: 0, ok: false } like evGraphql, retries a GET once, and never retries a write.
// Offline: the real evApi source runs in a vm with a scripted timedFetch.
// Output MUST contain "0 failed" on success.   node qnfo-fleet-control/evapi-abort.test.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "worker.js"), "utf8");
const start = src.indexOf("async function evApi(env, method, path, body) {");
const end = src.indexOf('\n__name(evApi, "evApi");', start);
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 300))); } };
ok(start >= 0 && end > start, "evApi is present in worker.js");

function harness(script) {
  const calls = [], logs = [];
  const sandbox = {
    EVOLVE_REPO: "QNFO/qnfo-workers", __name: () => {}, evGh: () => ({}),
    setTimeout: (f) => { f(); return 0; },
    timedFetch: async (url, opts) => { calls.push(opts.method); const step = script[Math.min(calls.length - 1, script.length - 1)]; if (step instanceof Error) throw step; return step(); },
    console: { error: (m) => logs.push(["error", m]), log: (m) => logs.push(["log", m]) }
  };
  vm.createContext(sandbox);
  vm.runInContext(src.slice(start, end) + "\nthis.evApi = evApi;", sandbox);
  return { evApi: sandbox.evApi, calls, logs };
}
const abort = () => { const e = new Error("The operation was aborted"); e.name = "AbortError"; return e; };
const resp = (status, body) => () => new Response(body === undefined ? "{}" : body, { status });

{ const h = harness([resp(200, '{"a":1}')]); const r = await h.evApi({}, "GET", "/pulls"); ok(r.ok && r.status === 200 && r.j.a === 1 && h.calls.length === 1, "a normal 200 is unchanged", r); }
{ const h = harness([abort(), resp(200, '{"a":2}')]); const r = await h.evApi({}, "GET", "/pulls"); ok(r.ok && r.j.a === 2 && h.calls.length === 2, "a GET that aborts once is retried and answers", { r, calls: h.calls }); }
{ const h = harness([abort()]); let r, threw = false; try { r = await h.evApi({}, "GET", "/pulls"); } catch (e) { threw = true; }
  ok(!threw, "a GET that aborts twice does not throw"); ok(r && r.status === 0 && r.ok === false && /no response/.test(r.j.message), "it answers status 0, ok false", r); ok(h.calls.length === 2, "exactly one retry", h.calls);
  ok(h.logs.every(([lvl]) => lvl === "log") && h.logs.length === 2, "the abort is logged at log level, not error (no CF-OBS filing per timeout)", h.logs); }
{ const h = harness([abort()]); let r, threw = false; try { r = await h.evApi({}, "PUT", "/pulls/1/merge", { merge_method: "squash" }); } catch (e) { threw = true; }
  ok(!threw && r.status === 0 && r.ok === false, "a write that aborts answers status 0 without throwing"); ok(h.calls.length === 1, "a write is never retried", h.calls); }
{ const h = harness([resp(502, "bad"), resp(200, '{"a":3}')]); const r = await h.evApi({}, "GET", "/x"); ok(r.ok && r.j.a === 3 && h.calls.length === 2, "the existing 502 retry still works", r); }
{ const h = harness([resp(503, "down"), abort()]); const r = await h.evApi({}, "GET", "/x"); ok(r.status === 503 && h.calls.length === 2, "a 503 whose retry aborts keeps the 503 answer", r); }
{ const h = harness([resp(404, '{"message":"Not Found"}')]); const r = await h.evApi({}, "GET", "/x"); ok(r.status === 404 && !r.ok && h.calls.length === 1, "a 404 is returned as before, no retry", r); }
ok(readFileSync(join(here, "worker.js"), "utf8") === readFileSync(join(here, "deployed-current.worker.js"), "utf8"), "worker.js and deployed-current.worker.js are identical");
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
