// CANONICAL-FAILOPEN-1 + CRON-MANDATE-1 (qnfo-fleet-control 0.45.4), offline.
// Two defects found on 2026-10-25 while verifying a deploy:
//   1. canonical() returned the last-resort R2 copy with no freshness flag, so redeploy() could deploy a build older
//      than live whenever every GitHub source failed at once (the object then held 2.54.4 while live was 2.55.3).
//   2. the cron was */5 + hourly = 312 fires/day, over CRON-MANDATE-1's 144 cap. The earlier debloat 0708e81d was
//      reverted because it also deleted the hourly trigger - the ONLY path into scheduledOnce's hourly fan-out.
// ADVERSARIAL: source-shape plus one executed pure function. It cannot prove the deployed worker behaves this way; the
// live proof is the cron read-back (GET /schedules) and a heartbeat with the new VERSION on the next */10 tick.
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const toml = readFileSync(new URL("./wrangler.toml", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL " + m); } };

// --- 1. the stale fallback is marked and refused ---
const canonAt = src.indexOf("async function canonical(env, worker)");
ok(canonAt > 0, "canonical() present");
const canon = src.slice(canonAt, canonAt + 2600);
ok(/return \{ code: t, fresh: age < FRESH_MS, stale: false/.test(src), "a fresh/current R2 read is not stale");
ok(/if \(r2\) return Object\.assign\(\{\}, r2, \{ stale: true \}\)/.test(canon), "the last-resort R2 copy is marked stale");

const redAt = src.indexOf("async function redeploy(env, worker)");
ok(redAt > 0, "redeploy() present");
const red = src.slice(redAt, redAt + 2600);
ok(/if \(c\.stale\)/.test(red), "redeploy refuses a stale source");
ok(red.indexOf("if (c.stale)") < red.indexOf("lock/acquire"), "the refusal happens BEFORE the deploy lock is taken");
ok(/refused: canonical source is an unfresh R2 fallback/.test(red), "the refusal is audited with its reason");

// --- 2. cron cadence: */10 + hourly, and the hourly trigger must survive ---
const cronLine = (toml.match(/^crons = (\[[^\]]*\])$/m) || [])[1];
ok(cronLine, "crons declared");
const crons = JSON.parse(cronLine);
ok(crons.length === 2, "two triggers declared");
ok(crons.indexOf("*/10 * * * *") >= 0, "the fast trigger is */10 (144 fires/day, exactly at the cap)");
ok(crons.indexOf("5 * * * *") >= 0, "the hourly trigger is KEPT and offset to :05");
ok(crons.indexOf("0 * * * *") < 0, "the hourly D1 fan-out no longer overlaps the 10-minute tick at :00");
ok(crons.indexOf("*/5 * * * *") < 0, "no */5 trigger (288 fires/day would breach CRON-MANDATE-1)");
const perDay = (c) => {
  const m = /^\*\/(\d+) \* \* \* \*$/.exec(c);
  return m ? 1440 / Number(m[1]) : c === "5 * * * *" ? 24 : 0;
};
ok(crons.every((c) => perDay(c) <= 144), "every trigger is within the 144/day cap");
ok(crons.every((c) => { const m = /^\*\/(\d+)/.exec(c); return !m || Number(m[1]) >= 10; }), "no trigger fires more often than every 10 minutes");
ok(/const cron = \["5 \* \* \* \*"/.test(src), "the offset hourly event is routed to its own fan-out, not the fast slot");

// --- 3. the grid math that rules out */15, shown as a real computation ---
const onTwenty = (mins) => mins.filter((m) => m % 20 < 5);
ok(JSON.stringify(onTwenty([0, 10, 20, 30, 40, 50])) === "[0,20,40]", "a */10 tick keeps all three 20-minute steps");
ok(JSON.stringify(onTwenty([0, 15, 30, 45])) === "[0]", "a */15 tick would silently drop :20 and :40 (why not 15)");

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
