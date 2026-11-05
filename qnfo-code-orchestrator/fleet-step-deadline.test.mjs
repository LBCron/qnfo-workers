// FLEET-STEP-DEADLINE-1 offline suite. No network, synthetic data.
// Proves, through the member's real dispatcher (scheduled -> runTick -> /run -> executeTask -> runStepGuarded): (1) a workflow step that never answers fails after its deadline and the run
// row's error names the step and its position, instead of holding the dispatcher's invocation; (2) a sql step the database rejects as overloaded is retried (three times at most) and then
// passes, and a step overloaded on every attempt fails after four attempts; (3) any other error is thrown at once, not retried, and names the step; (4) a passing workflow keeps its result
// shape (steps_run, ms_total, slow); (5) the workflow stops at the failing step; (6) the closing write of the run row (ok or failed) is retried when the database refuses it as overloaded,
// so a failure is recorded even when the refusal that failed the step is still in force; (7) a refused audit event no longer turns a finished run into a failed one;
// (8) the deadline defaults by step type and a step's own deadline_ms wins.
// Run: node qnfo-code-orchestrator/fleet-step-deadline.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const mod = await import("data:text/javascript;base64," + Buffer.from(src + "\nexport { fleetExecMod as __member };\n").toString("base64"));
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 300) : "")); } };

ok(/var STEP_DEADLINE_MS = \{ sql: 60000, http: 45000, ai: 120000 \};/.test(src), "deadlines default by step type: sql 60 s, http 45 s, ai 120 s");
ok(/Number\(step && step\.deadline_ms\) > 0 \? Number\(step\.deadline_ms\) : \(STEP_DEADLINE_MS\[step && step\.type\] \|\| 60000\)/.test(src), "a step's own deadline_ms wins over the default");

// the closing writes wait 2 s, 4 s, 6 s in production; the test shortens every timer
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...a) => realSetTimeout(fn, Math.min(ms, 20), ...a);

// a recording D1: fleet_tasks holds one workflow, fleet_runs one pending row; step statements and run-row writes are scripted
function mkDb(steps, script, runScript) {
  const log = [];
  const task = { id: "t1", name: "t", type: "workflow", definition: JSON.stringify({ steps }), timeout_ms: 120000, retries: 1, enabled: 1 };
  const prepare = (q) => {
    let a = [];
    const s = {
      bind(...x) { a = x; return s; },
      async first() { if (/FROM fleet_tasks/.test(q)) return task; if (/FROM fleet_runs/.test(q)) return { id: 7 }; return null; },
      async run() {
        log.push({ q, a });
        const r = runScript ? runScript(q, log.filter((x) => x.q === q).length) : null;
        if (r instanceof Error) throw r;
        return { success: true, meta: { changes: 1 } };
      },
      async all() { if (/FROM fleet_crons/.test(q)) return { results: [{ name: "c1", task_id: "t1", cron_expr: "*/10 * * * *", enabled: 1 }] }; log.push({ q, a, step: true }); const r = script(q, log.filter((x) => x.step && x.q === q).length); if (r instanceof Error) throw r; return r; },
    };
    return s;
  };
  return { prepare, log };
}
const rows = { results: [{ n: 1 }] };
const overloaded = () => new Error("D1_ERROR: D1 DB is overloaded. Too many resources consumed within a 10 second window");
const run = async (db) => {
  const waits = [];
  await mod.__member.scheduled({ cron: "*/2 * * * *", scheduledTime: Date.now() }, { AUDIT: db }, { waitUntil(p) { waits.push(p); } });
  await Promise.all(waits);
  const closes = db.log.filter((x) => /UPDATE fleet_runs SET status = '(ok|failed)'/.test(x.q) && !x.q.includes("orphaned"));
  const statusRow = closes.filter((x) => !x.refused).pop();
  return { status: statusRow && /'ok'/.test(statusRow.q) ? "ok" : statusRow ? "failed" : null, args: statusRow && statusRow.a, closes };
};
const stepCalls = (db, q) => db.log.filter((x) => x.step && x.q === q).length;

// (1) a step that never answers
{
  const db = mkDb([{ type: "sql", name: "first", sql: "SELECT a" }, { type: "sql", name: "stuck-step", sql: "SELECT hang", deadline_ms: 60 }, { type: "sql", name: "never", sql: "SELECT never" }], (q) => (q === "SELECT hang" ? new Promise(() => {}) : rows));
  const t0 = Date.now();
  const r = await run(db);
  ok(r.status === "failed" && r.args[1] === "step 2/3 stuck-step: deadline 60 ms exceeded", "a hung step fails after its deadline and the run row's error names it", r);
  ok(Date.now() - t0 < 2000, "promptly, so the dispatcher moves on to the next cron", Date.now() - t0);
  ok(stepCalls(db, "SELECT never") === 0, "the steps behind the failing step do not run");
}

// (2) overloaded, then fine; overloaded for good
{
  const db = mkDb([{ type: "sql", name: "w", sql: "SELECT w", retry_backoff_ms: 5 }], (q) => (db.log.filter((x) => x.step && x.q === q).length < 3 ? overloaded() : rows));
  const r = await run(db);
  ok(r.status === "ok" && stepCalls(db, "SELECT w") === 3, "overloaded twice, then the third attempt passes and the run is ok", { r: r.status, calls: stepCalls(db, "SELECT w") });
  const db2 = mkDb([{ type: "sql", name: "w2", sql: "SELECT w2", retry_backoff_ms: 5 }], () => overloaded());
  const r2 = await run(db2);
  ok(r2.status === "failed" && stepCalls(db2, "SELECT w2") === 4 && /^step 1\/1 w2: D1_ERROR: D1 DB is overloaded/.test(r2.args[1]), "overloaded on every attempt: four attempts, then a named failure", { calls: stepCalls(db2, "SELECT w2"), e: r2.args && r2.args[1].slice(0, 50) });
}

// (3) any other error is not retried
{
  const db = mkDb([{ type: "sql", name: "ok1", sql: "SELECT ok1" }, { type: "sql", name: "bad", sql: "SELECT bad", retry_backoff_ms: 5 }], (q) => (q === "SELECT bad" ? new Error("D1_ERROR: no such table: nope") : rows));
  const r = await run(db);
  ok(r.status === "failed" && r.args[1] === "step 2/2 bad: D1_ERROR: no such table: nope" && stepCalls(db, "SELECT bad") === 1, "a non-overload error is thrown at once with the step named", { r, calls: stepCalls(db, "SELECT bad") });
}

// (4) a passing workflow keeps its result shape
{
  const db = mkDb([{ type: "sql", name: "a", sql: "SELECT a" }, { type: "sql", name: "b", sql: "SELECT b" }, { type: "sql", name: "c", sql: "SELECT c" }], () => rows);
  const r = await run(db);
  const res = r.args && JSON.parse(r.args[1]);
  ok(r.status === "ok" && res.type === "workflow" && res.steps_run === 3 && typeof res.ms_total === "number" && Array.isArray(res.slow), "a passing workflow keeps steps_run, ms_total and slow", res);
}

// (6) the closing write is retried while the database refuses it
{
  const failed = (q, n) => (/UPDATE fleet_runs SET status = 'failed'/.test(q) && n <= 2 ? overloaded() : null);
  const db = mkDb([{ type: "sql", name: "bad", sql: "SELECT bad" }], () => new Error("D1_ERROR: no such table: nope"), failed);
  const r = await run(db);
  const tries = db.log.filter((x) => /UPDATE fleet_runs SET status = 'failed'/.test(x.q) && !x.q.includes("orphaned")).length;
  ok(tries === 3 && r.args && r.args[1] === "step 1/1 bad: D1_ERROR: no such table: nope", "a failed run's closing write is retried until the database takes it (refused twice, accepted the third time)", { tries, r: r.args });
  const okRefused = (q, n) => (/UPDATE fleet_runs SET status = 'ok'/.test(q) && n <= 1 ? overloaded() : null);
  const db2 = mkDb([{ type: "sql", name: "a", sql: "SELECT a" }], () => rows, okRefused);
  const r2 = await run(db2);
  const tries2 = db2.log.filter((x) => /UPDATE fleet_runs SET status = 'ok'/.test(x.q)).length;
  ok(tries2 === 2 && !db2.log.some((x) => /UPDATE fleet_runs SET status = 'failed'/.test(x.q) && !x.q.includes("orphaned")), "an ok run's closing write is retried and never recorded as failed", { tries2 });
  const never = (q) => (/UPDATE fleet_runs SET status = 'failed'/.test(q) && !q.includes("orphaned") ? new Error("D1_ERROR: no such column: zzz") : null);
  const db3 = mkDb([{ type: "sql", name: "bad", sql: "SELECT bad" }], () => new Error("boom"), never);
  await run(db3);
  ok(db3.log.filter((x) => /UPDATE fleet_runs SET status = 'failed'/.test(x.q) && !x.q.includes("orphaned")).length === 1, "a closing-write error other than overload is not retried");
}

// (7) a refused audit event does not turn a finished run into a failed one
{
  const evt = (q) => (/INSERT INTO codeparse_events/.test(q) ? overloaded() : null);
  const db = mkDb([{ type: "sql", name: "a", sql: "SELECT a" }], () => rows, evt);
  const r = await run(db);
  ok(r.status === "ok" && !db.log.some((x) => /UPDATE fleet_runs SET status = 'failed'/.test(x.q) && !x.q.includes("orphaned")), "the run stays ok when the audit event insert is refused", r);
}

globalThis.setTimeout = realSetTimeout;
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
