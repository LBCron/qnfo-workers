// D1-429 RESILIENCE offline suite (qnfo-fleet-control 0.64.1): BREACH-DOCTOR-HEARTBEAT-1 (agent_issues 1001476) and IL-DEGRADED-READ-1 (agent_issues 1001636).
// worker_logs showed the */10 slot of qnfo-fleet-control failing with "D1_ERROR: D1 DB is overloaded. Too many resources consumed within a 10 second window" (22:21Z and 22:30Z on 2026-11-04). Two
// consequences are proved fixed here. (1) The breach doctor's first read or lock write threw before a context existed, the tick event is written only for a run that held the lock, so a refused slot
// left no trace and the newest tick aged past 30 minutes: bdRetry retries a platform refusal after 2.5 s and 6 s (a real SQL error is thrown at once), and a run that still fails before the lock leaves a
// tick event with err and stage=pre-lock; a run that finds the lock held, a run in mode off and a paused run write nothing. (2) improvementLoopTick evaluated an empty history when D1 refused its
// facts read and stamped fix_target_hold_rate_30d UNMEASURED with a NULL value; a degraded tick now keeps the last measured value and records degraded_reads, while a tick whose reads all succeeded
// still writes NULL for a legitimately unmeasured figure. The BREACH-DOCTOR-1 block and the IMPROVEMENT-LOOP-1 block are sliced out of worker.js and replayed against stub and in-memory D1s.
// Output MUST contain "0 failed" on success.   node qnfo-fleet-control/d1-429-resilience.test.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "worker.js"), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 300))); } };
const OVERLOAD = "D1_ERROR: D1 DB is overloaded. Too many resources consumed within a 10 second window";

// ---- the breach doctor ----
const A = "// ---- BREACH-DOCTOR-1:BEGIN ----", B = "// ---- BREACH-DOCTOR-1:END ----";
const a = src.indexOf(A), b = src.indexOf(B);
ok(a > 0 && b > a && src.split(A).length === 2, "the BREACH-DOCTOR-1 block is present once");
const kw = src.match(/^var __RT_WRITE_KW = \[[^\]]*\];$/m)[0];
const block = src.slice(a, b);
const waits = [];
const load = () => {
  const cx = vm.createContext({ Date, Number, String, parseInt, Math, JSON, Object, Array, RegExp, Error, Promise, isFinite, console: { error() {}, log() {} }, VERSION: "0.64.1-test", crypto: globalThis.crypto, TextEncoder, Uint8Array, setTimeout: (f, ms) => { waits.push(ms); f(); } });
  vm.runInContext(kw + "\n" + block + "\nthis.api = { breachDoctorTick, bdRetry, bdRefused };", cx);
  return cx.api;
};
// a stub D1: script = { config: [errors or rows...], lock: changes, event: [errors...], unlock: [errors...] }; every other statement throws a plain error so the run ends in the catch
const stub = (script) => {
  const calls = { config: 0, lock: 0, event: 0, unlock: 0, events: [] };
  const take = (list, n) => (list && list[n] !== undefined ? list[n] : null);
  const db = {
    prepare(sql) {
      let args = [];
      const s = {
        bind(...v) { args = v; return s; },
        async all() {
          if (/FROM ops_config WHERE key LIKE 'breach_doctor/.test(sql)) { const e = take(script.config, calls.config++); if (e instanceof Error) throw e; return { results: e || [{ key: "breach_doctor", value: "on" }] }; }
          throw new Error("boom");
        },
        async first() { throw new Error("boom"); },
        async run() {
          if (/^INSERT INTO loop_lock/.test(sql)) { calls.lock++; const e = take(script.lockErr, calls.lock - 1); if (e instanceof Error) throw e; return { meta: { changes: script.lock === undefined ? 1 : script.lock } }; }
          if (/^INSERT INTO breach_diagnosis_events/.test(sql)) { calls.event++; const e = take(script.event, calls.event - 1); if (e instanceof Error) throw e; calls.events.push({ event: args[3], detail: args[6] }); return { meta: { changes: 1 } }; }
          if (/^DELETE FROM loop_lock/.test(sql)) { calls.unlock++; const e = take(script.unlock, calls.unlock - 1); if (e instanceof Error) throw e; return { meta: { changes: 1 } }; }
          throw new Error("boom");
        },
      };
      return s;
    },
  };
  return { db, calls };
};
const ov = () => new Error(OVERLOAD);

{
  const api = load();
  ok(api.bdRefused(new Error(OVERLOAD)) && api.bdRefused(new Error("HTTP 429 from https://api.cloudflare.com/x")) && api.bdRefused(new Error("Network connection lost")), "bdRefused recognises the platform's refusals");
  ok(!api.bdRefused(new Error("SQLITE_ERROR: no such table: x")) && !api.bdRefused(new Error("D1_ERROR: UNIQUE constraint failed")) && !api.bdRefused(new Error("HTTP 400 bad sql")), "bdRefused does not treat a SQL error as a refusal");
  let n = 0;
  waits.length = 0;
  const r = await api.bdRetry(async () => { n++; if (n < 3) throw ov(); return "done"; });
  ok(r === "done" && n === 3 && JSON.stringify(waits) === "[2500,6000]", "bdRetry waits 2.5 s then 6 s and returns the third attempt", { n, waits });
  let m = 0, thrown = null;
  try { await api.bdRetry(async () => { m++; throw ov(); }); } catch (e) { thrown = e; }
  ok(m === 3 && thrown && /overloaded/.test(thrown.message), "bdRetry gives up after three attempts and throws the last refusal");
  let k = 0, thrown2 = null;
  try { await api.bdRetry(async () => { k++; throw new Error("SQLITE_ERROR: no such column"); }); } catch (e) { thrown2 = e; }
  ok(k === 1 && thrown2, "a real SQL error is thrown at once, without a wait");
}

{ // S1: the config read is refused twice, then answers; the run holds the lock, ends in its own catch, and still records its tick
  const { db, calls } = stub({ config: [ov(), ov()] });
  waits.length = 0;
  const out = await load().breachDoctorTick({ AUDIT: db }, {});
  ok(calls.config === 3 && out.mode === "on", "S1: the config read is retried twice and then read (mode on)", { calls, mode: out.mode });
  ok(calls.events.length === 1 && calls.events[0].event === "tick" && /err=other/.test(calls.events[0].detail) && !/stage=pre-lock/.test(calls.events[0].detail), "S1: a run that held the lock writes its ordinary tick", calls.events);
  ok(calls.unlock === 1, "S1: and releases the lock");
}
{ // S2: the config read is refused for good: the run leaves a pre-lock tick event instead of silence
  const { db, calls } = stub({ config: [ov(), ov(), ov(), ov(), ov()] });
  const out = await load().breachDoctorTick({ AUDIT: db }, {});
  ok(out.ok === false && out.error === "d1-error" && calls.config === 3, "S2: three refused reads end the run with err d1-error", { out: out.error, calls });
  ok(calls.events.length === 1 && calls.events[0].event === "tick" && /stage=pre-lock/.test(calls.events[0].detail) && /err=d1-error/.test(calls.events[0].detail) && /mode=none/.test(calls.events[0].detail), "S2: one tick event says err=d1-error and stage=pre-lock", calls.events);
  ok(calls.lock === 0 && calls.unlock === 0, "S2: no lock was taken or released");
}
{ // S2b: the same, with the event write refused once: the heartbeat is retried and lands
  const { db, calls } = stub({ config: [ov(), ov(), ov()], event: [ov()] });
  await load().breachDoctorTick({ AUDIT: db }, {});
  ok(calls.event === 2 && calls.events.length === 1, "S2b: a refused heartbeat write is retried and lands", calls);
}
{ // S2c: a watch call carries its source into the heartbeat
  const { db, calls } = stub({ config: [ov(), ov(), ov()] });
  await load().breachDoctorTick({ AUDIT: db }, { source: "watch" });
  ok(calls.events.length === 1 && /source=watch/.test(calls.events[0].detail), "S2c: the second runner's heartbeat says source=watch", calls.events);
}
{ // S3: the lock is held by a live tick: nothing is written
  const { db, calls } = stub({ lock: 0 });
  const out = await load().breachDoctorTick({ AUDIT: db }, {});
  ok(out.ok === true && out.skipped === "lock-held" && calls.events.length === 0 && calls.unlock === 0, "S3: lock-held writes no tick and releases nothing", { out: out.skipped, calls });
}
{ // S3b: the lock write is refused once, then taken
  const { db, calls } = stub({ lockErr: [ov()] });
  const out = await load().breachDoctorTick({ AUDIT: db }, {});
  ok(calls.lock === 2 && out.skipped === undefined && calls.events.length === 1, "S3b: a refused lock write is retried and the run proceeds", { calls: calls.lock, out: out.skipped });
}
{ // S4: mode off writes nothing
  const { db, calls } = stub({ config: [[{ key: "breach_doctor", value: "off" }]] });
  const out = await load().breachDoctorTick({ AUDIT: db }, {});
  ok(out.ok === true && out.mode === "off" && calls.events.length === 0 && calls.lock === 0, "S4: mode off returns before any write", { out: out.mode, calls });
}
{ // S5: a real SQL error is not retried, still ends the run; a missing table pauses the next run for ten minutes and writes the heartbeat once
  const { db, calls } = stub({ config: [new Error("SQLITE_ERROR: no such table: ops_config")] });
  const api = load();
  const out = await api.breachDoctorTick({ AUDIT: db }, {});
  ok(calls.config === 1 && out.error === "no-such-table", "S5: a SQL error is read once and not retried", { calls: calls.config, err: out.error });
  const again = await api.breachDoctorTick({ AUDIT: db }, {});
  ok(again.paused === 1 && calls.config === 1, "S5: the next run is paused and reads nothing");
  ok(calls.events.length === 1 && /err=no-such-table/.test(calls.events[0].detail), "S5: the failed run left one heartbeat; the paused run left none", calls.events);
}
{ // S6: the tick event and the unlock are refused twice each and still land
  const { db, calls } = stub({ event: [ov(), ov()], unlock: [ov(), ov()] });
  await load().breachDoctorTick({ AUDIT: db }, {});
  ok(calls.event === 3 && calls.events.length === 1 && calls.unlock === 3, "S6: tick event and unlock are retried to success", calls);
}

// ---- the improvement loop ----
const BEGIN = "// ---- IMPROVEMENT-LOOP-1:BEGIN", END = "// ---- IMPROVEMENT-LOOP-1:END ----";
const ia = src.indexOf(BEGIN), ib = src.indexOf(END);
const ca = src.indexOf("// ---- CHARTER-LOOP-1:BEGIN"), cb = src.indexOf("// ---- CHARTER-LOOP-1:END ----");
ok(ia > 0 && ib > ia && ca > 0 && cb > ca, "the IMPROVEMENT-LOOP-1 and CHARTER-LOOP-1 blocks are present");
const sandbox = { fetch: async () => { throw new Error("offline"); }, AbortSignal, VERSION: "test", timedFetch: null, b64encode: null, sha256: null, console: { error() {}, log() {}, warn() {} }, Date, Math, JSON, Number, String, Object, Array, RegExp, isNaN, isFinite, TextDecoder, atob, __export: null };
vm.createContext(sandbox);
vm.runInContext(src.slice(ca, cb + "// ---- CHARTER-LOOP-1:END ----".length) + "\n" + src.slice(ia, ib + END.length) + "\n__export = { improvementLoopTick, ilRows };", sandbox, { filename: "il-block.js" });
const I = sandbox.__export;

const db = new DatabaseSync(":memory:");
db.exec(`
CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, layer TEXT NOT NULL, kind TEXT NOT NULL, formula TEXT, source_of_truth TEXT, baseline TEXT, target TEXT, owner TEXT, disposition_actor TEXT, refresh_cadence TEXT, warning_band TEXT, kill_band TEXT, last_value TEXT, last_refreshed TEXT, state TEXT, refresh_class TEXT);
CREATE TABLE analytics_metric_triggers(id INTEGER PRIMARY KEY AUTOINCREMENT, metric_key TEXT UNIQUE, title TEXT, source_table TEXT, operator TEXT, threshold REAL, priority INTEGER DEFAULT 5, action TEXT, owner TEXT, queue_target TEXT, cooldown_hours INTEGER DEFAULT 168, enabled INTEGER DEFAULT 1, notes TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT DEFAULT 'open', created_at INTEGER, updated_at INTEGER, close_channel TEXT);
CREATE TABLE issue_triage (issue_id INTEGER PRIMARY KEY, rc TEXT NOT NULL, triage_state TEXT NOT NULL DEFAULT 'triaged', owner TEXT NOT NULL, sla_due_at TEXT NOT NULL, triaged_at TEXT DEFAULT (datetime('now')), close_evidence TEXT);
CREATE TABLE metric_history (metric TEXT NOT NULL, day TEXT NOT NULL, value REAL, meets INTEGER, target TEXT, ts TEXT, PRIMARY KEY (metric, day));
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT NOT NULL, action TEXT NOT NULL, verify_probe TEXT NOT NULL, verify_transport TEXT NOT NULL, max_attempts INTEGER NOT NULL DEFAULT 3, escalate_to TEXT NOT NULL, expected_cadence_h INTEGER, status TEXT DEFAULT 'active', module TEXT);
CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT);
`);
let refuse = false;
const stmtOn = (sql) => {
  let args = [];
  const s = {
    bind(...v) { args = v.map((y) => (y === undefined ? null : y)); return s; },
    async all() { if (refuse && /FROM metric_history WHERE day >=/.test(sql)) throw new Error(OVERLOAD); return { results: db.prepare(sql).all(...args) }; },
    async first() { return db.prepare(sql).get(...args) || null; },
    async run() { const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes) } }; },
  };
  return s;
};
const env = { AUDIT: { prepare: (sql) => stmtOn(sql) } };
const one = (sql, ...p) => db.prepare(sql).get(...p);
const realNow = Date.now();
const dd = (n) => new Date(realNow - n * 864e5).toISOString().slice(0, 10);
const closeAt = realNow - 10 * 864e5;
db.prepare("INSERT INTO metric_registry (metric, layer, kind, source_of_truth, target, disposition_actor, refresh_cadence, last_value, state) VALUES ('worker_count', 'fleet', 'leading', 's', '<= 24', 'a', 'hourly', '40', 'MEASURED')").run();
db.prepare("INSERT INTO analytics_metric_triggers (id, metric_key, title, operator, threshold, enabled) VALUES (344, 'worker_count', 'Core gap', 'gt', 30, 1)").run();
for (let k = 1; k <= 13; k++) db.prepare("INSERT OR REPLACE INTO metric_history (metric, day, value, meets, target, ts) VALUES ('worker_count', ?, ?, ?, '', '')").run(dd(k), k <= 2 ? 40 : 20, k <= 2 ? 0 : 1);
const mk = db.prepare("INSERT INTO agent_issues (title, status, created_at, updated_at) VALUES ('METRIC-TRIGGER-344-WORKER-COUNT: Core gap', 'closed', 0, ?)").run(closeAt);
db.prepare("INSERT INTO issue_triage (issue_id, rc, owner, sla_due_at, close_evidence) VALUES (?, 'x', 'o', datetime('now'), 'closed with evidence')").run(Number(mk.lastInsertRowid));
const reading = () => one("SELECT last_value v, last_refreshed r, state s FROM metric_registry WHERE metric = 'fix_target_hold_rate_30d'");

const t1 = await I.improvementLoopTick(env);
const r1 = reading();
ok(t1.ok === true && r1 && r1.s === "MEASURED" && Number.isFinite(Number(r1.v)), "a healthy tick measures fix_target_hold_rate_30d", r1);
const run1 = JSON.parse(one("SELECT state_json s FROM improvement_loop_runs ORDER BY id DESC LIMIT 1").s);
ok(run1.degraded_reads === 0 && typeof run1.fix_target_hold_rate_30d === "number", "and records degraded_reads 0 with the figure", run1);

refuse = true;
const t2 = await I.improvementLoopTick(env);
const r2 = reading();
ok(t2.ok === true && r2.v === r1.v && r2.s === "MEASURED" && r2.r === r1.r, "a degraded tick (the history read refused) keeps the last value, state and refresh time", { r1, r2 });
const run2 = JSON.parse(one("SELECT state_json s FROM improvement_loop_runs ORDER BY id DESC LIMIT 1").s);
ok(run2.degraded_reads >= 1 && run2.fix_target_hold_rate_30d === null, "and the run row says degraded_reads and carries no invented figure", run2);

refuse = false;
const t3 = await I.improvementLoopTick(env);
const r3 = reading();
ok(t3.ok === true && r3.s === "MEASURED" && r3.v === r1.v, "the next healthy tick measures again", r3);

// a legitimately unmeasured figure (no closed issue to judge) still reads NULL and UNMEASURED when every read succeeded
db.prepare("DELETE FROM issue_triage").run();
db.prepare("DELETE FROM agent_issues").run();
const t4 = await I.improvementLoopTick(env);
const r4 = reading();
const run4 = JSON.parse(one("SELECT state_json s FROM improvement_loop_runs ORDER BY id DESC LIMIT 1").s);
ok(t4.ok === true && r4.v === null && r4.s === "UNMEASURED" && run4.degraded_reads === 0, "a healthy tick with nothing to judge still stamps NULL and UNMEASURED (unchanged behaviour)", { r4, run4 });

// ilRows counts a refused read and answers []
{
  const f = { read_errors: 0 };
  const rows = await I.ilRows({ AUDIT: { prepare: () => ({ all: async () => { throw new Error(OVERLOAD); } }) } }, f, "SELECT 1");
  ok(Array.isArray(rows) && rows.length === 0 && f.read_errors === 1, "ilRows answers [] for a refused read and counts it");
  const rows2 = await I.ilRows({ AUDIT: { prepare: () => ({ all: async () => ({ results: [{ a: 1 }] }) }) } }, f, "SELECT 1");
  ok(rows2.length === 1 && f.read_errors === 1, "and counts nothing for a read that answers");
}

// ---- static: mirror, version, release fragment
const mirror = readFileSync(join(here, "deployed-current.worker.js"), "utf8");
ok(src === mirror, "deployed-current.worker.js is identical to worker.js");
const ver = (src.match(/^var VERSION = "([^"]*)"/m) || [])[1] || "";
const vn = ver.split("-")[0].split(".").map(Number);
ok(vn[0] > 0 || vn[1] > 64 || (vn[1] === 64 && vn[2] >= 1), "VERSION is at least 0.64.1", ver);

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
