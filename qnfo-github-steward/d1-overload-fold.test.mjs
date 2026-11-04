// D1-OVERLOAD-FOLD-1 offline suite (qnfo-github-steward 0.13.0): a worker-observability dispatch row about "D1 DB is overloaded"
// gets no GitHub issue of its own; every other row is mirrored as before.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("./worker.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");

function extract(name, async = false) {
  const start = source.indexOf((async ? "async " : "") + "function " + name + "(");
  assert.ok(start >= 0, name);
  const end = source.indexOf("\n}\n", start);
  assert.ok(end > start, name);
  return source.slice(start, end + 3);
}

function setup(rows) {
  const writes = [];
  const ghCalls = [];
  const env = {
    AUDIT: {
      prepare(sql) {
        const q = { sql, args: [] };
        return {
          bind(...a) { q.args = a; return this; },
          async all() { writes.push({ select: sql }); return { results: rows }; },
          async run() { writes.push(q); return { success: true }; }
        };
      }
    }
  };
  const ctx = vm.createContext({
    Date, JSON, String, ORG: "QNFO", ghLimited: () => false,
    gh: async (...a) => { ghCalls.push(a); return { status: 201, body: { number: 777 } }; }
  });
  vm.runInContext(extract("d1OverloadPayload") + extract("issueSync", true), ctx);
  return { ctx, env, writes, ghCalls };
}

const D1_TITLE = "D1_ERROR: D1 DB is overloaded. Too many resources consumed within a <duration> window";
const row = (fp, title, category = "worker-observability") => ({
  fingerprint: fp, category, sev: "warn", owner: "fleet", gh_number: null,
  payload: JSON.stringify({ service: "qnfo-social", title })
});

test("payload detector matches only the overload title", () => {
  const { ctx } = setup([]);
  assert.equal(ctx.d1OverloadPayload(JSON.stringify({ title: D1_TITLE })), true);
  assert.equal(ctx.d1OverloadPayload(JSON.stringify({ title: "performanceLoopTick error: " + D1_TITLE })), true);
  assert.equal(ctx.d1OverloadPayload(JSON.stringify({ title: "HttpServerError · HTTP 503" })), false);
  assert.equal(ctx.d1OverloadPayload("not json"), false);
  assert.equal(ctx.d1OverloadPayload(JSON.stringify({})), false);
});

test("overload rows are folded with no GitHub call; others are mirrored", async () => {
  const { ctx, env, writes, ghCalls } = setup([
    row("cf-obs-a", D1_TITLE),
    row("cf-obs-b", "HttpServerError · HTTP 503"),
    row("cf-obs-c", D1_TITLE, "queue-freshness")
  ]);
  const result = { errors: [] };
  await ctx.issueSync(env, result);
  assert.equal(result.issue_sync.folded, 1);
  assert.equal(result.issue_sync.mirrored, 2);
  assert.equal(ghCalls.length, 2, "only the two non-folded rows reach GitHub");
  const folded = writes.filter((w) => w.sql && w.sql.includes("exec_state = 'folded'"));
  assert.equal(folded.length, 1);
  assert.equal(folded[0].args[2], "cf-obs-a");
  assert.ok(!folded[0].sql.includes("gh_number"), "a folded row keeps gh_number empty so no close loop touches a shared issue");
});

test("the backlog select skips rows already folded", async () => {
  const { ctx, env, writes } = setup([]);
  await ctx.issueSync(env, { errors: [] });
  const sel = writes.find((w) => w.select).select;
  assert.ok(sel.includes("COALESCE(exec_state, '') <> 'folded'"));
});

test("version is at least 0.13.0", () => {
  const m = source.match(/var VERSION = "(\d+)\.(\d+)\.(\d+)/);
  assert.ok(m && (Number(m[1]) > 0 || Number(m[2]) >= 13));
});
