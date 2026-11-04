// TURNSTILE-SELFTEST-1 (agent_issues 1000681-1000683): every worker that holds TURNSTILE_SECRET carries the same self-test block, calls it from a
// path that runs without visitor traffic, and the block records an honest verdict: a valid secret with a dummy token answers invalid-input-response
// (accepted), a wrong secret answers invalid-input-secret (rejected), a testing key is flagged, an unreachable siteverify records nothing.
// Run: node scripts/turnstile-selftest.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
import vm from "node:vm";

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x) : "")); } };
const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const BLOCK_RX = /\/\/ BEGIN TURNSTILE-SELFTEST-1\n[\s\S]*?\/\/ END TURNSTILE-SELFTEST-1\n/;
const WORKER_LINE = /var TURNSTILE_SELFTEST_WORKER = "[^"]*";/;

const snippet = read("scripts/turnstile-selftest.snippet.js");
const snip = (BLOCK_RX.exec(snippet) || [])[0];
ok(!!snip, "the snippet file carries the marked block");

// worker -> the call site that runs the self-test without visitor traffic
const WORKERS = {
  "qnfo-ipatent": /if \(ctx && ctx\.waitUntil\) ctx\.waitUntil\(turnstileSelfTest\(env\)\);/
};
for (const [w, callRx] of Object.entries(WORKERS)) {
  const src = read(w + "/worker.js");
  const b = (BLOCK_RX.exec(src) || [])[0];
  ok(!!b, w + ": carries the self-test block");
  ok((src.match(/\/\/ BEGIN TURNSTILE-SELFTEST-1/g) || []).length === 1, w + ": exactly one copy");
  ok(b && b.replace(WORKER_LINE, "") === snip.replace(WORKER_LINE, ""), w + ": the block equals the snippet except for the worker constant");
  ok(b && b.indexOf('var TURNSTILE_SELFTEST_WORKER = "' + w + '";') >= 0, w + ": the worker constant names the worker");
  ok(callRx.test(src), w + ": a path without visitor traffic calls turnstileSelfTest");
  ok(src === read(w + "/deployed-current.worker.js"), w + ": deployed-current.worker.js mirrors worker.js");
  ok(/^[\x00-\x7f]*$/.test(b || ""), w + ": the block is ASCII (the deploy uploads Latin-1)");
}
ok(!/secret\s*[:=]\s*["'][^"']{8,}["']/i.test(snip) && /env\.TURNSTILE_SECRET/.test(snip), "the block holds no literal secret and reads TURNSTILE_SECRET from env");

// behaviour of the block
function mkDb(rows) {
  return { prepare(sql) {
    let a = [];
    const st = {
      bind(...x) { a = x; return st; },
      async first() { return /SELECT 1 AS x FROM cloud_ops_events/.test(sql) ? (rows.find((r) => r.id === a[0]) ? { x: 1 } : null) : null; },
      async run() {
        if (/INSERT OR IGNORE INTO cloud_ops_events/.test(sql)) {
          if (!rows.find((r) => r.id === a[0])) rows.push({ id: a[0], ts: a[1], kind: "turnstile-selftest", text: a[2], meta: a[3], job: a[4], status: a[5] });
        }
        return { meta: { changes: 1 } };
      }
    };
    return st;
  } };
}
async function run(env, fetchImpl, setup) {
  const logs = [];
  const ctx = { URLSearchParams, AbortSignal, JSON, String, Promise, Date, console: { error: (x) => logs.push(x) }, fetch: fetchImpl };
  vm.createContext(ctx);
  vm.runInContext(snip.replace(WORKER_LINE, 'var TURNSTILE_SELFTEST_WORKER = "t-worker";'), ctx);
  ctx.__env = env;
  const out = [];
  out.push(await vm.runInContext("turnstileSelfTest(__env)", ctx));
  if (setup && setup.twice) out.push(await vm.runInContext("turnstileSelfTest(__env)", ctx));
  return { out, logs };
}
const reply = (j, status = 200) => async () => ({ ok: status < 400, status, json: async () => j });

{
  const rows = [];
  const r = await run({ AUDIT: mkDb(rows) }, reply({}), null);
  ok(r.out[0].ran === false && rows.length === 0, "no TURNSTILE_SECRET: nothing runs, nothing recorded", r.out);
}
{
  const rows = []; let calls = 0, sent = "";
  const f = async (url, init) => { calls++; sent = String(init.body); return { ok: true, status: 200, json: async () => ({ success: false, "error-codes": ["invalid-input-response"] }) }; };
  const r = await run({ AUDIT: mkDb(rows), TURNSTILE_SECRET: "s3cret-value" }, f, { twice: true });
  ok(r.out[0].verdict === "accepted" && rows.length === 1, "a valid secret (invalid-input-response for the dummy token) is recorded once as accepted", r.out);
  ok(rows[0].status === "ok" && rows[0].job === "t-worker" && JSON.parse(rows[0].meta).secret === "accepted" && JSON.parse(rows[0].meta).worker === "t-worker", "the row is status ok, job = the worker, meta names worker and verdict", rows[0]);
  ok(/^turnstile-selftest-t-worker-\d{4}-\d{2}-\d{2}T\d{2}$/.test(rows[0].id), "the row id is per worker and hour", rows[0].id);
  ok(calls === 1 && r.out[1].reason === "done-this-hour", "a second call in the same hour makes no siteverify call", { calls, second: r.out[1] });
  ok(/secret=s3cret-value/.test(sent) && /response=turnstile-selftest-dummy-token/.test(sent), "the bound secret is posted with the dummy token");
  ok(!JSON.stringify(rows).includes("s3cret-value") && r.logs.every((l) => !String(l).includes("s3cret-value")), "the secret value is never stored or logged");
}
{
  const rows = [];
  const r = await run({ QNFO_AUDIT: mkDb(rows), TURNSTILE_SECRET: "x" }, reply({ success: false, "error-codes": ["invalid-input-secret"] }), null);
  ok(r.out[0].verdict === "rejected" && rows.length === 1 && rows[0].status === "error" && JSON.parse(rows[0].meta).secret === "rejected", "a wrong secret (invalid-input-secret) is recorded as an error, via the QNFO_AUDIT binding too", rows);
}
{
  const rows = [];
  const r = await run({ AUDIT: mkDb(rows), TURNSTILE_SECRET: "x" }, reply({ success: true, "error-codes": [], metadata: { result_with_testing_key: true } }), null);
  ok(r.out[0].verdict === "testing-key" && rows[0].status === "error", "a published testing key bound in production is flagged, not accepted", rows);
}
{
  const rows = [];
  const r = await run({ AUDIT: mkDb(rows), TURNSTILE_SECRET: "x" }, reply({ success: false, "error-codes": [] }), null);
  ok(r.out[0].verdict === "unknown" && rows[0].status === "error", "an answer that proves neither case is recorded as unknown, never as accepted", rows);
}
{
  const rows = [];
  const r = await run({ AUDIT: mkDb(rows), TURNSTILE_SECRET: "x" }, reply({}, 503), { twice: true });
  ok(r.out[0].recorded === false && rows.length === 0 && r.out[1].ran === true, "siteverify unreachable (HTTP 503): nothing is recorded as a verdict and the next call retries", r.out);
}
{
  const rows = [];
  const r = await run({ AUDIT: mkDb(rows), TURNSTILE_SECRET: "x" }, async () => { throw new Error("network down"); }, null);
  ok(r.out[0].recorded === false && rows.length === 0 && r.logs.length === 1, "a fetch failure is logged, not recorded as a verdict", { out: r.out, logs: r.logs });
}

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
