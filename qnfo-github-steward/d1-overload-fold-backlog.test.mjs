// D1-OVERLOAD-FOLD-2 offline suite (qnfo-github-steward 0.14.0): legacy overload mirrors that already carry a gh_number are closed once,
// stamped exec_state='folded', and no sync path (reverse, forward relapse reopen, pollObservability's upsert) revives them.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("./worker.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
function extract(name, async = false) {
  const start = source.indexOf((async ? "async " : "") + "function " + name + "(");
  assert.ok(start >= 0, name);
  const end = source.indexOf("\n}\n", start);
  return source.slice(start, end + 3);
}
const D1 = "D1_ERROR: D1 DB is overloaded. Too many resources consumed";
const mk = (fp, gh, title = D1, category = "worker-observability") => ({
  fingerprint: fp, category, gh_number: gh, state: "tracked", exec_state: "created", exec_attempts: 0,
  payload: JSON.stringify({ title })
});

// A tiny stateful D1: honours the predicates the fold select uses and the UPDATE shapes the function writes.
function setup(table, ghImpl) {
  const ghCalls = [];
  const env = { AUDIT: { prepare(sql) {
    const q = { sql, args: [] };
    return {
      bind(...a) { q.args = a; return this; },
      async all() {
        const lim = q.args[0];
        const r = table.filter((x) => x.category === "worker-observability" && x.gh_number && x.exec_state !== "folded" && /D1 DB is overloaded/i.test(x.payload))
          .sort((a, b) => a.exec_attempts - b.exec_attempts || (a.fingerprint < b.fingerprint ? -1 : 1)).slice(0, lim);
        return { results: r };
      },
      async run() {
        const row = table.find((x) => x.fingerprint === q.args[q.args.length - 1]);
        if (sql.includes("exec_state = 'folded'")) { row.exec_state = "folded"; row.exec_result = q.args[1]; }
        else if (sql.includes("exec_attempts")) { row.exec_attempts++; row.exec_result = q.args[0]; }
        return { success: true };
      }
    };
  } } };
  const ctx = vm.createContext({ Date, JSON, String, Promise, ORG: "QNFO", ghLimited: () => false,
    gh: async (_e, method, path, body) => { ghCalls.push({ method, path, body }); return ghImpl(method, path, body); } });
  vm.runInContext(extract("d1OverloadPayload") + "var FOLD_BACKLOG_PER_RUN = 5;\n" + extract("foldOverloadBacklog", true), ctx);
  return { ctx, env, ghCalls };
}
const ok = () => ({ status: 200, body: {}, text: "" });

test("a legacy overload row is closed once (not_planned + umbrella comment) and marked folded; non-overload rows are untouched", async () => {
  const table = [mk("a", "6902"), mk("b", "6903", "HttpServerError"), mk("c", "7020", D1, "queue-freshness")];
  const { ctx, env, ghCalls } = setup(table, ok);
  const result = { errors: [] };
  await ctx.foldOverloadBacklog(env, result);
  assert.equal(result.fold_backlog.folded, 1);
  assert.deepEqual(ghCalls.map((c) => c.method + " " + c.path), ["PATCH /repos/QNFO/qnfo-workers/issues/6902", "POST /repos/QNFO/qnfo-workers/issues/6902/comments"]);
  assert.equal(ghCalls[0].body.state, "closed");
  assert.equal(ghCalls[0].body.state_reason, "not_planned");
  assert.ok(ghCalls[1].body.body.includes("Folded into the D1-overload umbrella (D1-OVERLOAD-FOLD-1)"));
  assert.equal(table[0].exec_state, "folded");
  assert.equal(table[0].state, "tracked", "state is left alone");
  assert.equal(table[1].exec_state, "created");
  assert.equal(table[2].exec_state, "created");
});

test("a relapse (pollObservability upsert: payload rewritten, state tracked, exec_state untouched) causes no second close", async () => {
  const table = [mk("a", "6902")];
  const { ctx, env, ghCalls } = setup(table, ok);
  await ctx.foldOverloadBacklog(env, { errors: [] });
  const n = ghCalls.length;
  table[0].state = "tracked";
  table[0].payload = JSON.stringify({ title: D1, status: "active" });
  const result = { errors: [] };
  await ctx.foldOverloadBacklog(env, result);
  assert.equal(ghCalls.length, n, "no GitHub call for a folded row");
  assert.equal(result.fold_backlog.folded, 0);
  assert.equal(table[0].exec_state, "folded");
});

test("bounded at 5 per run; the rest wait for the next run", async () => {
  const table = Array.from({ length: 8 }, (_, i) => mk("fp" + i, String(7000 + i)));
  const { ctx, env } = setup(table, ok);
  const r1 = { errors: [] };
  await ctx.foldOverloadBacklog(env, r1);
  assert.equal(r1.fold_backlog.folded, 5);
  const r2 = { errors: [] };
  await ctx.foldOverloadBacklog(env, r2);
  assert.equal(r2.fold_backlog.folded, 3);
  assert.ok(table.every((x) => x.exec_state === "folded"));
});

test("a gh error leaves the row unfolded, moves it behind the others, and the next run retries it", async () => {
  const table = [mk("a", "6902"), mk("b", "6903")];
  let fail = true;
  const { ctx, env } = setup(table, (m, p) => (fail && p.endsWith("/6902") && m === "PATCH" ? { status: 502, text: "bad gateway" } : ok()));
  const r1 = { errors: [] };
  await ctx.foldOverloadBacklog(env, r1);
  assert.equal(r1.fold_backlog.errored, 1);
  assert.equal(r1.fold_backlog.folded, 1);
  assert.equal(table[0].exec_state, "created");
  assert.equal(table[0].exec_attempts, 1);
  assert.equal(r1.errors[0].status, 502);
  fail = false;
  const r2 = { errors: [] };
  await ctx.foldOverloadBacklog(env, r2);
  assert.equal(r2.fold_backlog.folded, 1);
  assert.equal(table[0].exec_state, "folded");
});

test("every reopen / rewrite path skips folded rows", () => {
  const rev = extract("issueSyncReverse", true);
  assert.ok(rev.includes("NOT IN ('closed-by-sync', 'folded') LIMIT 50"), "reverse sync first select");
  assert.ok(rev.includes("exec_state NOT IN ('closed', 'folded')"), "reverse sync force-close select");
  const fwd = extract("issueSyncForward", true);
  assert.ok(fwd.includes("NOT IN ('closed', 'closed-by-sync', 'folded')"), "forward close queue");
  assert.ok(fwd.includes("exec_state = 'closed-by-sync' AND gh_number"), "forward relapse reopen needs closed-by-sync, which a folded row never carries");
  assert.ok(source.includes("await foldOverloadBacklog(env, legacy)"), "wired into the tick");
});

test("version is at least 0.14.0", () => {
  const m = source.match(/var VERSION = "(\d+)\.(\d+)\.(\d+)/);
  assert.ok(m && (Number(m[1]) > 0 || Number(m[2]) >= 14));
});
