// D1-OVERLOAD-TELEMETRY-BREAKER-1 (#5269): optional telemetry stops writing after
// an overload is detected, while request results and in-memory spend accounting remain intact.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
let failed = 0, passed = 0;
function ok(condition, message) { if (condition) passed++; else { failed++; console.log("FAIL " + message); } }

const src = readFileSync(join(here, "worker.js"), "utf8");
const mirror = readFileSync(join(here, "deployed-current.worker.js"), "utf8");
ok(src === mirror, "deployed-current.worker.js mirrors worker.js");

const breakerStart = src.indexOf("var __d1OverloadedUntil = 0;");
const breakerEnd = src.indexOf("\nfunction __aiAttrEnv(", breakerStart);
ok(breakerStart >= 0 && breakerEnd > breakerStart, "D1 telemetry breaker found");
const breakerSource = src.slice(breakerStart, breakerEnd);

let now = 1000;
const fakeDate = { now: () => now };
const breaker = new Function("Date", breakerSource + "\nreturn { d1AttrWriteSkip, d1OverloadTrip, until: () => __d1OverloadedUntil };")(fakeDate);
ok(!breaker.d1AttrWriteSkip(), "breaker is initially closed");
ok(!breaker.d1OverloadTrip(new Error("other D1 failure")), "non-overload failures do not open the breaker");
ok(breaker.d1OverloadTrip(new Error("D1 DB is overloaded. Requests queued for too long.")), "overload opens the breaker");
ok(breaker.until() === now + 60000 && breaker.d1AttrWriteSkip(), "breaker suppresses analytics for 60 seconds");
now += 60001;
ok(!breaker.d1AttrWriteSkip(), "breaker reopens after its cooldown");

const spendStart = src.indexOf("function spendRecord(");
const spendEnd = src.indexOf("\nfunction spendUsageOf(", spendStart);
ok(spendStart >= 0 && spendEnd > spendStart, "spendRecord found");
const spendSource = src.slice(spendStart, spendEnd);
const spendRuntime = new Function(
  "Date", "spendUsd", "spendDay", "spendEnsure",
  "var __spendState = { pending: {} };\n" + breakerSource + "\n" + spendSource +
  "\nreturn { spendRecord, pending: () => __spendState.pending, d1AttrWriteSkip };"
)(fakeDate, () => 2, () => "2026-11-03", async () => {});

let d1Calls = 0;
const waiting = [];
const overloadedDb = {
  prepare() {
    d1Calls++;
    return { bind() { return this; }, async run() { throw new Error("D1 DB is overloaded. Requests queued for too long."); } };
  }
};
const env = { QNFO_AUDIT: overloadedDb, __spendCtx: { waitUntil(promise) { waiting.push(promise); } } };
spendRuntime.spendRecord(env, "workers-ai", "model", 1, 1, {});
await Promise.all(waiting);
ok(spendRuntime.d1AttrWriteSkip(), "spend telemetry overload opens the shared breaker");
ok(d1Calls === 1, "overloaded spend write is attempted only once");
ok(spendRuntime.pending()["workers-ai"] === 2, "spend accounting is preserved in memory");
spendRuntime.spendRecord(env, "workers-ai", "model", 1, 1, {});
ok(d1Calls === 1 && spendRuntime.pending()["workers-ai"] === 4, "subsequent spend events skip D1 but remain counted in memory");

const logStart = src.indexOf("async function logQuery(");
const logEnd = src.indexOf("\n__name(logQuery", logStart);
ok(logStart >= 0 && logEnd > logStart, "logQuery found");
const logSource = src.slice(logStart, logEnd);
const logRuntime = new Function("Date", "console", "FALLBACK_TEXT", breakerSource + "\n" + logSource + "\nreturn { logQuery, d1AttrWriteSkip, d1OverloadTrip };")(
  fakeDate,
  { log() {}, error() {} },
  ""
);
logRuntime.d1OverloadTrip(new Error("D1 DB is overloaded. Requests queued for too long."));
const queryRuntime = new Function("Date", "console", "FALLBACK_TEXT", breakerSource + "\n" + logSource + "\nreturn { logQuery, d1AttrWriteSkip };")(
  fakeDate,
  { log() {}, error() {} },
  ""
);
let queryCalls = 0;
const overloadedQueryDb = {
  prepare() {
    queryCalls++;
    return { bind() { return this; }, async run() { throw new Error("D1 DB is overloaded. Requests queued for too long."); } };
  }
};
await queryRuntime.logQuery({ QNFO_AUDIT: overloadedQueryDb }, { id: "q", ts: "2026-11-03", prompt: "p", response: "r", thread_id: "t" });
ok(queryRuntime.d1AttrWriteSkip() && queryCalls === 1, "query log overload trips breaker and prevents later telemetry writes");
queryCalls = 0;
await logRuntime.logQuery({ QNFO_AUDIT: { prepare() { queryCalls++; } } }, { id: "q", prompt: "p", response: "r", thread_id: "t" });
ok(queryCalls === 0, "query logging skips D1 while the overload breaker is open");

const ensembleStart = src.indexOf("async function logEnsembleRun(");
const ensembleEnd = src.indexOf("\n// end ensemble-run-log", ensembleStart);
ok(ensembleStart >= 0 && ensembleEnd > ensembleStart, "logEnsembleRun found");
ok(/if \(!env \|\| !env\.QNFO_AUDIT \|\| d1AttrWriteSkip\(\)\) return false;/.test(src.slice(ensembleStart, ensembleEnd)), "ensemble telemetry skips D1 while the breaker is open");
ok(/d1OverloadTrip\(e\);/.test(src.slice(ensembleStart, ensembleEnd)), "ensemble overload trips the shared breaker");

console.log("d1-overload-breaker: " + passed + " passed, " + failed + " failed");
if (failed) process.exit(1);
