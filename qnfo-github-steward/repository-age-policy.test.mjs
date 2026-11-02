// REPOSITORY-AGE-POLICY-1: mirrors must not undo the administrative disposition or claim remediation.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("./worker.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const now = Date.now();
const old = {
  number: 123, state: "closed", state_reason: "not_planned",
  created_at: new Date(now - 8 * 86400000).toISOString()
};
function extract(name, async = false) {
  const start = source.indexOf((async ? "async " : "") + "function " + name + "(");
  assert.ok(start >= 0);
  const end = source.indexOf("\n}\n", start);
  assert.ok(end > start);
  return source.slice(start, end + 3);
}
function context(gh) {
  const ctx = vm.createContext({ Date, Number, gh, ORG: "QNFO", ghLimited: () => false });
  vm.runInContext(extract("agePolicyClosed") + extract("reopenIssue", true) + extract("issueSyncReverse", true), ctx);
  return ctx;
}

test("age disposition is narrow and shares the workflow's strict seven-day boundary", () => {
  const ctx = context();
  assert.equal(ctx.agePolicyClosed(old, now), true);
  for (const extra of [
    { state: "open" }, { state_reason: "completed" }, { pull_request: {} },
    { created_at: "invalid" }, { created_at: new Date(now - 7 * 86400000).toISOString() }
  ]) {
    assert.equal(ctx.agePolicyClosed({ ...old, ...extra }, now), false);
  }
  assert.equal(ctx.agePolicyClosed(null, now), false);
});

test("all reopen payloads preserve aged not-planned issues without sending a write", async () => {
  const calls = [];
  const ctx = context(async (...args) => { calls.push(args); return { status: 200, body: old }; });
  for (const payload of [{ state: "open" }, { state: "open", title: "digest", body: "new digest" }]) {
    const r = await ctx.reopenIssue({}, "/repos/QNFO/qnfo-workers/issues/123", payload);
    assert.equal(r.age_policy_closed, true);
  }
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => c[1] === "GET"));
});

test("ordinary recent closures still reopen and digest edits pass through unchanged", async () => {
  const calls = [];
  const ctx = context(async (...args) => {
    calls.push(args);
    return { status: 200, body: { ...old, state_reason: "completed" } };
  });
  const payload = { state: "open", title: "digest", body: "current work" };
  await ctx.reopenIssue({}, "/issues/123", payload);
  assert.equal(calls[1][1], "PATCH");
  assert.equal(calls[1][3], payload);
});

test("read failures and malformed state never reopen", async () => {
  for (const r of [{ status: 403, text: "Forbidden" }, { status: 429, limited: true }, { status: 200, body: null }]) {
    const calls = [];
    const ctx = context(async (...args) => { calls.push(args); return r; });
    const result = await ctx.reopenIssue({}, "/issues/123", { state: "open" });
    assert.ok(result.status >= 400);
    assert.equal(calls.length, 1);
  }
});

test("administrative GitHub closures never close canonical observability work in reverse sync", async () => {
  const ctx = context(async () => ({ status: 200, body: old }));
  const out = { errors: [] };
  const env = { AUDIT: { prepare: () => ({
    all: async () => ({ results: [{ fingerprint: "still-broken", gh_number: "123" }] }),
    bind: () => { throw new Error("administrative closure must not write canonical state"); }
  }) } };
  await ctx.issueSyncReverse(env, out);
  assert.equal(out.issue_sync_reverse.age_policy_closed, 1);
  assert.equal(out.issue_sync_reverse.closed, 0);
  assert.deepEqual(out.errors, []);
});

test("every issue reopen surface uses the shared policy and worker mirror stays identical", () => {
  assert.equal((source.match(/await reopenIssue\(/g) || []).length, 4);
  assert.ok(!/await gh\(env, "PATCH", (?:TS_REPO|PS_REPO) \+ "\/issues\/"[^;\n]+state: "open"/.test(source));
  assert.equal(readFileSync(new URL("./deployed-current.worker.js", import.meta.url), "utf8"), readFileSync(new URL("./worker.js", import.meta.url), "utf8"));
});
