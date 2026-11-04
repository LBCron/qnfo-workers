// HEARTBEAT-RETRY-TRANSIENT-1 (qnfo-social 0.21.16): socialHeartbeat retries a transient D1 failure and gives up at once on a
// deterministic one. Before, "no such table: fleet_heartbeat" was retried six times with 27.5 s of backoff inside every tick.
import { socialHeartbeat } from "./worker.js";
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL " + m); } };
function env(errors) {
  let calls = 0;
  return { calls: () => calls, DB: { prepare: () => ({ bind: () => ({ run: async () => { calls++; const e = errors.shift(); if (e) throw new Error(e); return {}; } }) }) } };
}
const realLog = console.error; console.error = () => {};
let e = env(["D1_ERROR: no such table: fleet_heartbeat"]);
let t = Date.now(); await socialHeartbeat(e, true);
ok(e.calls() === 1, "a deterministic error is tried once, not six times (" + e.calls() + ")");
ok(Date.now() - t < 200, "and costs no backoff");
e = env(["D1_ERROR: D1 DB is overloaded. Requests queued for too long."]);
t = Date.now(); await socialHeartbeat(e, true);
ok(e.calls() === 2, "a transient overload is retried and the second write lands (" + e.calls() + ")");
ok(Date.now() - t >= 450, "after the first backoff step");
e = env([]);
await socialHeartbeat(e, false);
ok(e.calls() === 1, "a healthy write is one call");
console.error = realLog;
console.log("heartbeat-retry: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
