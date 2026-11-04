// CRON-ONLY-HEARTBEAT-1 (agent_issues 2397, qnfo-subscribers 1.3.0) offline test.
// Run: node qnfo-subscribers/cron-heartbeat.test.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const mod = await import(pathToFileURL(join(here, "worker.js")).href);
const worker = mod.default;
const src = readFileSync(join(here, "worker.js"), "utf8");
const VERSION = /var VERSION = "([^"]*)"/.exec(src)[1];
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " -- " + JSON.stringify(x).slice(0, 400) : "")); } };

// opts.livingThrows: the digest work throws; opts.livingEmpty: no papers (digest returns ok:true, skipped); opts.hbThrows: the heartbeat write fails.
function makeEnv(opts) {
  const beats = [];
  const db = (kind) => ({
    prepare(sql) {
      let args = [];
      const s = {
        bind(...a) { args = a; return s; },
        async all() {
          if (kind === "living") { if (opts.livingThrows) throw new Error("living down"); return { results: [] }; }
          return { results: [] };
        },
        async run() {
          if (/INSERT INTO fleet_heartbeat/.test(sql)) {
            if (opts.hbThrows) throw new Error("d1 down");
            if (opts.hbTransient && (opts.hbSeen = (opts.hbSeen || 0) + 1) <= opts.hbTransient) throw new Error("D1_ERROR: D1 DB is overloaded. Requests queued for too long.: SQLITE_ERROR");
            beats.push({ sql, args });
          }
          return { meta: { changes: 1 } };
        },
      };
      return s;
    },
  });
  return { env: { AUDIT: db("audit"), LIVING: db("living") }, beats };
}
async function runScheduled(opts) {
  const { env, beats } = makeEnv(opts || {});
  const pending = [];
  const errs = [];
  const orig = console.error;
  console.error = (...a) => errs.push(a.join(" "));
  let threw = null;
  try {
    await worker.scheduled({}, env, { waitUntil: (p) => pending.push(p) });
    await Promise.all(pending);
  } catch (e) { threw = e; } finally { console.error = orig; }
  return { beats, errs, threw };
}

// success: no new papers in window is an ok run
const a = await runScheduled({});
ok(!a.threw, "scheduled does not throw on success", a.threw && String(a.threw));
ok(a.beats.length === 1, "one heartbeat upsert after a successful run", a.beats.length);
const b = a.beats[0] || { args: [], sql: "" };
ok(b.args[0] === "qnfo-subscribers", "worker name", b.args[0]);
ok(b.args[1] === VERSION, "VERSION bound", b.args[1]);
ok(typeof b.args[2] === "string" && !Number.isNaN(Date.parse(b.args[2])) && new Date(b.args[2]).toISOString() === b.args[2], "ts is ISO", b.args[2]);
ok(b.args[3] === 1, "ok=1 after success", b.args[3]);
ok(/ON CONFLICT\(worker\) DO UPDATE/.test(b.sql), "upsert on worker");

// the digest work fails: papers query throws -> runDigest returns ok:false -> ok=0, heartbeat still written
const c = await runScheduled({ livingThrows: true });
ok(!c.threw, "scheduled does not throw when the work fails");
ok(c.beats.length === 1 && c.beats[0].args[3] === 0, "ok=0 when the work fails", c.beats.map((x) => x.args));

// the heartbeat write fails: logged, never thrown
const d = await runScheduled({ hbThrows: true });
ok(!d.threw, "heartbeat D1 failure does not throw out of scheduled()", d.threw && String(d.threw));
ok(d.beats.length === 0, "no row when the write fails");
ok(d.errs.some((e) => /fleet_heartbeat_write_failed/.test(e)), "heartbeat failure logged with console.error", d.errs);

// CRON-D1-RETRY-1: two transient D1 overload errors are retried and the heartbeat still lands; a persistent one is logged, never thrown
const e1 = await runScheduled({ hbTransient: 2 });
ok(!e1.threw && e1.beats.length === 1 && e1.beats[0].args[3] === 1, "heartbeat lands after two transient D1 overload errors", e1.beats.length);
const e2 = await runScheduled({ hbTransient: 9 });
ok(!e2.threw && e2.beats.length === 0 && e2.errs.some((e) => /fleet_heartbeat_write_failed/.test(e)), "a persistent transient error is logged after 4 attempts, not thrown");

// source: write sits after runDigest inside the scheduled handler, uses AUDIT only
const sched = src.slice(src.indexOf("async scheduled("));
ok(sched.indexOf("runDigest(env") > -1 && sched.indexOf("runDigest(env") < sched.indexOf("INSERT INTO fleet_heartbeat"), "heartbeat written after the digest work");
ok(!/env\.LIVING[^;]*fleet_heartbeat/.test(sched), "heartbeat never written to LIVING");
ok(/CRON-ONLY-HEARTBEAT-1/.test(src), "marker comment present");

console.log("cron-heartbeat: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
