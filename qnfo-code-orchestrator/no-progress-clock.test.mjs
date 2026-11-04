// NO-PROGRESS-CLOCK-1: the no-progress ceiling measures from the last new failure signature to the LAST ATTEMPT, not to now.
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const a = src.indexOf("var PATH_HOLD_MAX_MIN_DEFAULT");
const b = src.indexOf("async function pathNoProgress");
const end = src.indexOf("\n}\n", b) + 3;
const body = src.slice(a, end);
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error("FAIL " + m); } };
const build = (cfgMin) => new Function("getCtx", "iso", "CODE_TASK_DONE_SQL", "claimRelease", "audit",
  body + "\nreturn pathNoProgress;")(
  (t) => JSON.parse(t.ctx), () => new Date().toISOString(), "('merged')", async () => {}, async () => {});
const env = (changes) => ({ AUDIT_DB: { prepare: (sql) => ({ first: async () => ({ value: "45" }), bind: () => ({ run: async () => ({ meta: { changes } }) }) }) } });
const ago = (m) => new Date(Date.now() - m * 60000).toISOString();
const task = (ctx) => ({ id: "t", attempts: 3, path: "x/worker.js", created_at: ago(300), ctx: JSON.stringify(ctx), last_error: "e" });
const f = build();
// 40 min of failing without a new signature, then 120 min waiting in the queue: old clock cut it (160 > 45), new one keeps it.
ok(await f(env(1), task({ sigs: ["a", "a"], last_new_sig_at: ago(160), last_fail_at: ago(120) })) === false, "queue wait after the last attempt is not no-progress");
// 60 min of repeated failures with no new signature, last attempt 5 min ago: still cut.
ok(await f(env(1), task({ sigs: ["a", "a"], last_new_sig_at: ago(65), last_fail_at: ago(5) })) === true, "repeating one failure for 60 min is cut");
// idle over 180 min: measured to now again, so a stalled claim cannot hold its file.
ok(await f(env(1), task({ sigs: ["a", "a"], last_new_sig_at: ago(400), last_fail_at: ago(300) })) === true, "idle over 180 min is cut");
// legacy ctx without last_fail_at behaves as before.
ok(await f(env(1), task({ sigs: ["a", "a"], last_new_sig_at: ago(60) })) === true, "legacy ctx keeps old clock");
console.log("no-progress-clock: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
