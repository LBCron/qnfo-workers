// TRACE-FOLD-1 (RM-TRACE-FOLD-1, agent_issues 1000650): the per-call appender writes ops_run_events rows the real table accepts (the first appender omitted the NOT NULL seq
// column and read the run id from model arguments, so the table stayed empty), the fold is a pure function of the events, and the read route folds one run.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const source = readFileSync(new URL("./worker.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const mirror = readFileSync(new URL("./deployed-current.worker.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
assert.equal(source, mirror, "deployed-current.worker.js mirrors worker.js");

const grab = (start, end) => {
  const i = source.indexOf(start), j = source.indexOf(end, i);
  return i >= 0 && j > i ? source.slice(i, j) : "";
};
const appendSrc = grab("async function opsRunEventAppend(", "async function opsRunState(");
const stateSrc = grab("async function opsRunState(", "\nvar schemaEnsured");
const foldSrc = grab("function foldRunState(events) {", "async function callWorkersAI(");
assert.ok(appendSrc && stateSrc && foldSrc, "appender, run-state reader and fold are present");
let tick = 0;
const lib = new Function("iso", appendSrc + "\n" + stateSrc + "\n" + foldSrc + "\nreturn { opsRunEventAppend, opsRunState, foldRunState };")(
  () => "2026-11-05T00:00:" + String(tick++).padStart(2, "0") + ".000Z"
);

// The real DDL from migrations/2026-10-28-cluster-e-b-doers.sql, so a missing NOT NULL column fails here as it did in production.
const ddl = readFileSync(new URL("../migrations/2026-10-28-cluster-e-b-doers.sql", import.meta.url), "utf8").match(/CREATE TABLE IF NOT EXISTS ops_run_events[^;]*;/)[0];
function d1(db, failWrites = false) {
  return {
    prepare(sql) {
      return {
        bind(...values) {
          const q = sql.replace(/\?(\d+)/g, "?"); // node:sqlite binds positionally; the statements here use each number once or in order
          const order = [...sql.matchAll(/\?(\d+)/g)].map((m) => Number(m[1]) - 1);
          const args = order.map((i) => values[i]);
          return {
            run: async () => { if (failWrites) throw new Error("D1 DB is overloaded"); db.prepare(q).run(...args); return { success: true }; },
            all: async () => ({ results: db.prepare(q).all(...args) })
          };
        }
      };
    }
  };
}
const db = new DatabaseSync(":memory:");
db.exec(ddl);
const env = { QNFO_AUDIT: d1(db) };

const ok = (text) => ({ ok: true, text: JSON.stringify(text) });
const bad = (obj) => ({ ok: false, text: JSON.stringify(obj) });

assert.equal(await lib.opsRunEventAppend(env, "job-1", "fleet_status", "{}", ok({ ok: true }), 12), true, "an ok call is appended");
assert.equal(await lib.opsRunEventAppend(env, "job-1", "ops_d1_query", '{"sql":"SELECT 1"}', bad({ ok: false, error: "no such table: zzz" }), 30), true, "a failed call is appended");
assert.equal(await lib.opsRunEventAppend(env, "job-1", "workspace_grep", '{"query":"x"}', bad({ ok: false, arg_error: true, error: "pattern required" }), 1), true, "a caller-input mistake is appended");
assert.equal(await lib.opsRunEventAppend(env, "job-1", "github_repo_read", "{}", ok({ ok: false, not_found: true }), 5), true);
assert.equal(await lib.opsRunEventAppend(env, "job-2", "fleet_status", "{}", ok({ ok: true }), 3), true, "a second run starts its own seq");

const rows = db.prepare("SELECT run_id, seq, kind, tool, args_sha, ok, bytes_out, detail FROM ops_run_events ORDER BY id").all();
assert.equal(rows.length, 5);
assert.deepEqual(rows.filter((r) => r.run_id === "job-1").map((r) => r.seq), [1, 2, 3, 4], "seq counts up per run");
assert.equal(rows.find((r) => r.run_id === "job-2").seq, 1, "seq restarts for another run");
assert.equal(rows[1].ok, 0);
assert.equal(rows[1].kind, "tool");
assert.equal(rows[2].kind, "tool-rejected", "arg_error is a rejected call, not an error");
assert.equal(rows[3].ok, 1, "not_found is an answer, not a failure");
assert.match(rows[1].args_sha, /^[0-9a-f]{16}$/, "arguments are stored only as a hash");
assert.ok(!JSON.stringify(rows).includes("SELECT 1"), "argument text is never stored");
assert.equal(JSON.parse(rows[1].detail).error, "no such table: zzz");
assert.equal(JSON.parse(rows[1].detail).status, "error");
assert.equal(JSON.parse(rows[2].detail).status, "rejected");
assert.ok(rows[0].bytes_out > 0, "bytes_out is the result length");

// no run id, no store, a failing write: the call is never failed by the ledger
assert.equal(await lib.opsRunEventAppend(env, "", "fleet_status", "{}", ok({}), 1), false, "a loop without a run id writes nothing");
assert.equal(await lib.opsRunEventAppend({}, "job-1", "fleet_status", "{}", ok({}), 1), false, "no audit store, no write");
assert.equal(await lib.opsRunEventAppend({ QNFO_AUDIT: d1(db, true) }, "job-3", "fleet_status", "{}", ok({}), 1), false, "a D1 overload is swallowed");
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM ops_run_events WHERE run_id = 'job-3'").get().n, 0);

// the fold
const state = (await lib.opsRunState(env, "job-1")).state;
assert.equal(state.calls, 4);
assert.deepEqual(state.tools_used, ["fleet_status", "ops_d1_query", "workspace_grep", "github_repo_read"]);
assert.equal(state.error_count, 1, "only the real failure counts as an error");
assert.equal(state.rejected_count, 1, "the caller mistake is counted apart");
assert.equal(state.last_error.tool, "ops_d1_query");
assert.equal(state.last_error.error, "no such table: zzz");
assert.equal(state.errors.length, 1);
assert.ok(state.bytes_out_total > 0);
assert.deepEqual(state.open_items, []);
assert.ok(state.first_ts <= state.last_ts);
assert.equal(state.tool_counts.fleet_status, 1);

const empty = lib.foldRunState([]);
assert.deepEqual([empty.calls, empty.error_count, empty.tools_used, empty.last_error, empty.bytes_out_total], [0, 0, [], null, 0]);
assert.equal(lib.foldRunState(undefined).calls, 0, "no events folds to the empty state");
const open = lib.foldRunState([{ seq: 1, ts: "t1", kind: "open", tool: "approval", ok: null }, { seq: 2, ts: "t2", kind: "tool", tool: "x", ok: 1, bytes_out: 10 }]);
assert.equal(open.open_items.length, 1, "a row still open is an open item");
assert.equal(open.error_count, 0);
const objDetail = lib.foldRunState([{ seq: 1, ts: "t1", kind: "tool", tool: "x", ok: 0, bytes_out: 0, detail: { error: "boom" } }]);
assert.equal(objDetail.last_error.error, "boom", "detail may already be an object");

const missing = await lib.opsRunState(env, "");
assert.equal(missing.ok, false);
assert.equal(missing.arg_error, true, "a missing run_id is a caller mistake");
assert.equal((await lib.opsRunState({}, "job-1")).ok, false);

// wiring: both loops that own a run id append, and the route is owner-key gated like its siblings
assert.match(source, /await opsRunEventAppend\(env, jobId, tname, rawArgs, er, Date\.now\(\) - t0\)/, "the job workflow appends with its job id");
assert.match(source, /await opsRunEventAppend\(env, conversationId, name, rawArgs, er, Date\.now\(\) - t0\)/, "the agent DO appends with its conversation id");
assert.match(source, /path === "\/v1\/run-state" \|\| path === "\/mcp"/, "the run-state route sits behind the owner-key check");
assert.ok(!/const runId = args && args\.runId/.test(source), "the model-argument run id path is gone");

console.log("trace-fold tests: ok");
