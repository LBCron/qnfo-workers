import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "worker.js"), "utf8").replace(/\r\n/g, "\n");
const mirror = readFileSync(join(here, "deployed-current.worker.js"), "utf8").replace(/\r\n/g, "\n");
const start = src.indexOf("function queueLoopSyncIfStale(");
const end = src.indexOf("\n// ==== AREA-MAP reliability:", start);
let pass = 0, fail = 0;
const ok = (condition, message) => { if (condition) pass++; else { fail++; console.log("FAIL " + message); } };
const queued = [];
const maybeSync = async (env, state) => ({ ok: true, env, state });
const queueLoopSyncIfStale = new Function("LOOP_MIN_INTERVAL_MS", "loopMaybeSync", src.slice(start, end) + "\nreturn queueLoopSyncIfStale;")(10 * 60 * 1000, maybeSync);
const ctx = { waitUntil(promise) { queued.push(promise); } };
const now = Date.now();
const state = { issues: [] };

ok(start >= 0 && end > start, "queueLoopSyncIfStale is present in worker.js");
ok(!queueLoopSyncIfStale({}, ctx, state, { last_sync: new Date(now - 9 * 60 * 1000).toISOString() }, now), "a recent sync does not queue duplicate work");
ok(queued.length === 0, "fresh metadata leaves the waitUntil queue unchanged");
ok(queueLoopSyncIfStale({}, ctx, state, { last_sync: new Date(now - 11 * 60 * 1000).toISOString() }, now), "an overdue sync is queued");
ok(queued.length === 1, "an overdue sync schedules exactly one background task");
ok(queueLoopSyncIfStale({}, ctx, state, {}, now), "a missing sync timestamp is treated as overdue");
ok(queued.length === 2, "missing sync metadata also schedules one background task");
ok(!queueLoopSyncIfStale({}, ctx, null, {}, now), "missing state is not treated as an empty issue list");
ok(!queueLoopSyncIfStale({}, {}, state, {}, now), "a context without waitUntil is left untouched");
ok(src === mirror, "deployed-current.worker.js matches worker.js");
ok(/queueLoopSyncIfStale\(env, ctx, st, meta, Date\.now\(\)\)/.test(src), "GET /api/loop invokes the stale-sync recovery path");

await Promise.all(queued);
console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
