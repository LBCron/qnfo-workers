// Offline regression suite for REPOSITORY-AGE-POLICY-1.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { run, olderThan, DRAFT_MINUTES, ISSUE_MINUTES } from "./repository-age-policy.mjs";

const repo = "QNFO/qnfo-workers";
const now = Date.parse("2026-11-02T16:00:00Z");
const ago = (minutes) => new Date(now - minutes * 60000).toISOString();
const pull = (number, extra = {}) => ({
  number, state: "open", draft: true, node_id: "PR_" + number, created_at: ago(31), ...extra
});
const issue = (number, extra = {}) => ({ number, state: "open", created_at: ago(ISSUE_MINUTES + 1), ...extra });
const event = (extra = {}) => ({
  willCloseTarget: true,
  source: { number: 42, state: "OPEN", changedFiles: 1, repository: { nameWithOwner: repo }, ...extra }
});
const response = (body, status = 200) => ({ status, text: async () => JSON.stringify(body) });

function fake(config = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) : undefined;
    const call = { path: u.pathname, query: u.searchParams, method: init.method, body };
    calls.push(call);
    const override = await config.handle?.(call, calls);
    if (override) return override;
    if (u.pathname === "/graphql") {
      if (body.query.startsWith("mutation")) {
        return response({ data: { markPullRequestReadyForReview: { pullRequest: { id: body.variables.id, isDraft: false } } } });
      }
      return response({ data: { repository: { issue: { timelineItems: {
        nodes: (config.links || {})[body.variables.number] || [],
        pageInfo: { hasNextPage: false, endCursor: null }
      } } } } });
    }
    if (u.pathname === "/user") return response({ login: "fleet-bot" });
    if (u.pathname === "/repos/" + repo + "/pulls") return response(config.pulls || []);
    if (u.pathname === "/repos/" + repo + "/issues") return response(config.issues || []);
    const m = /\/(pulls|issues)\/(\d+)(\/comments)?$/.exec(u.pathname);
    if (!m) throw new Error("Unexpected request " + init.method + " " + url);
    if (m[3]) {
      if (init.method === "GET") return response(config.comments || []);
      return response({}, 201);
    }
    if (init.method === "PATCH") return response({ state: "closed", state_reason: "not_planned" });
    return response((m[1] === "pulls" ? config.pulls : config.issues)?.find((x) => x.number === Number(m[2])));
  };
  return { calls, fetchImpl };
}
async function execute(config = {}, options = {}) {
  const gh = fake(config);
  const result = await run({ repo, token: "fixture-not-a-token", ...options }, { fetchImpl: gh.fetchImpl, now });
  return { ...gh, result };
}
const writes = (calls) => calls.filter((c) => c.method !== "GET" && !(c.path === "/graphql" && c.body.query.startsWith("query")));

test("strict thresholds use creation age, not updated age", () => {
  assert.equal(olderThan(ago(30), DRAFT_MINUTES, now), false);
  assert.equal(olderThan(ago(30.01), DRAFT_MINUTES, now), true);
  assert.equal(olderThan(ago(ISSUE_MINUTES), ISSUE_MINUTES, now), false);
  assert.equal(olderThan(ago(ISSUE_MINUTES + 1), ISSUE_MINUTES, now), true);
  for (const date of ["bad", undefined, new Date(now + 60000).toISOString()]) {
    assert.equal(olderThan(date, DRAFT_MINUTES, now), false);
  }
});

test("all aged drafts become ready regardless of author, fork, session or diff", async () => {
  const { result, calls } = await execute({ pulls: [
    pull(1, { user: { login: "human" }, changed_files: 0 }),
    pull(2, { user: { login: "Copilot" }, head: { repo: { full_name: "someone/fork" } } }),
    pull(3, { draft: false }), pull(4, { created_at: ago(30) })
  ] });
  assert.deepEqual(result.drafts_ready, [1, 2]);
  assert.deepEqual(result.errors, []);
  assert.equal(writes(calls).length, 2);
  assert.ok(writes(calls).every((c) => c.body.query.includes("markPullRequestReadyForReview")));
  assert.ok(!calls.some((c) => /approve|merge|dispatch|update-branch/.test(c.path)));
});

test("old issues get an explicit not-planned disposition, not a fictional fix", async () => {
  const { result, calls } = await execute({ issues: [
    issue(1), issue(2, { created_at: ago(ISSUE_MINUTES) }), issue(3, { pull_request: {} })
  ] });
  assert.deepEqual(result.issues_closed, [1]);
  const comment = calls.find((c) => c.path.endsWith("/comments") && c.method === "POST");
  assert.match(comment.body.body, /not a claim that the defect is fixed or deployed/);
  const close = calls.find((c) => c.method === "PATCH");
  assert.deepEqual(close.body, { state: "closed", state_reason: "not_planned" });
  assert.deepEqual(result.errors, []);
});

test("only an open same-repository code-bearing closing PR covers an old issue", async () => {
  const { result } = await execute({
    issues: [1, 2, 3, 4, 5, 6].map((n) => issue(n)),
    links: {
      1: [event()],
      2: [event({ changedFiles: 0 })],
      3: [event({ state: "CLOSED" })],
      4: [event({ repository: { nameWithOwner: "other/repo" } })],
      5: [{ ...event(), willCloseTarget: false }],
      6: [event({ state: "MERGED" })]
    }
  });
  assert.deepEqual(result.issues_with_pr, [{ issue: 1, pr: 42 }]);
  assert.deepEqual(result.issues_closed, [2, 3, 4, 5, 6]);
});

test("dry mode reads links but never mutates", async () => {
  const { result, calls } = await execute({ pulls: [pull(1)], issues: [issue(2)] }, { mode: "dry" });
  assert.deepEqual(result.drafts_ready, [1]);
  assert.deepEqual(result.issues_closed, [2]);
  assert.deepEqual(writes(calls), []);
});

test("re-read prevents acting on items that closed or left draft since listing", async () => {
  const { result, calls } = await execute({
    pulls: [pull(1)], issues: [issue(2)],
    handle: (c) => {
      if (c.path.endsWith("/pulls/1")) return response(pull(1, { draft: false }));
      if (c.path.endsWith("/issues/2")) return response(issue(2, { state: "closed" }));
    }
  });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(writes(calls), []);
});

test("all list pages are collected before writes so closure cannot skip rows", async () => {
  const { result, calls } = await execute({
    handle: (c) => {
      if (c.path === "/repos/" + repo + "/issues") {
        return response(c.query.get("page") === "1"
          ? Array.from({ length: 100 }, (_, i) => issue(i + 1))
          : [issue(101)]);
      }
      const m = /\/issues\/(\d+)$/.exec(c.path);
      if (m && c.method === "GET") return response(issue(Number(m[1])));
    }
  });
  assert.equal(result.issues_closed.length, 101);
  const page2 = calls.findIndex((c) => c.path.endsWith("/issues") && c.query.get("page") === "2");
  assert.ok(page2 < calls.findIndex((c) => c.method === "PATCH"));
});

test("timeline pagination finds code PRs beyond the first page", async () => {
  const { result } = await execute({
    issues: [issue(1)],
    handle: (c) => {
      if (c.path === "/graphql" && c.body.query.startsWith("query")) {
        const second = c.body.variables.after === "cursor";
        return response({ data: { repository: { issue: { timelineItems: {
          nodes: second ? [event()] : [],
          pageInfo: { hasNextPage: !second, endCursor: second ? null : "cursor" }
        } } } } });
      }
    }
  });
  assert.deepEqual(result.issues_with_pr, [{ issue: 1, pr: 42 }]);
  assert.deepEqual(result.issues_closed, []);
});

test("GraphQL errors or incomplete timelines never become permission to close", async () => {
  for (const body of [
    { errors: [{ message: "Forbidden" }], data: {} },
    { data: { repository: { issue: null } } },
    { data: { repository: { issue: { timelineItems: { nodes: [], pageInfo: {} } } } } }
  ]) {
    const { result, calls } = await execute({
      issues: [issue(1)], handle: (c) => c.path === "/graphql" ? response(body) : undefined
    });
    assert.equal(result.errors.length, 1);
    assert.deepEqual(writes(calls), []);
  }
});

test("readiness failure is visible and does not stop independent issue disposition", async () => {
  const { result } = await execute({
    pulls: [pull(1)], issues: [issue(2)],
    handle: (c) => c.body?.query?.startsWith("mutation")
      ? response({ message: "Resource not accessible by integration" }, 403) : undefined
  });
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /HTTP 403 Resource not accessible by integration/);
  assert.deepEqual(result.issues_closed, [2]);
});

test("failed comment leaves issue open; failed close can reuse authenticated actor comment", async () => {
  const { result, calls } = await execute({
    issues: [issue(1)],
    handle: (c) => c.method === "POST" && c.path.endsWith("/comments")
      ? response({ message: "Forbidden" }, 403) : undefined
  });
  assert.equal(result.errors.length, 1);
  assert.ok(!calls.some((c) => c.method === "PATCH"));
  const retry = await execute({
    issues: [issue(1)],
    comments: [{ body: "<!-- repository-age-policy:v1 -->", user: { login: "fleet-bot" } }]
  });
  assert.deepEqual(retry.result.issues_closed, [1]);
  assert.equal(writes(retry.calls).length, 1);
});

test("untrusted marker cannot suppress the policy disposition comment", async () => {
  const { calls } = await execute({
    issues: [issue(1)],
    comments: [{ body: "<!-- repository-age-policy:v1 -->", user: { login: "stranger" } }]
  });
  assert.ok(calls.some((c) => c.method === "POST" && c.path.endsWith("/comments")));
});

test("list failure cannot close unseen issues or abandon draft readiness", async () => {
  const { result } = await execute({
    pulls: [pull(1)],
    handle: (c) => c.path.endsWith("/issues") ? response({ message: "rate limited" }, 429) : undefined
  });
  assert.deepEqual(result.drafts_ready, [1]);
  assert.deepEqual(result.issues_closed, []);
  assert.equal(result.errors.length, 1);
});

test("missing credential or malformed repository makes no requests", async () => {
  for (const opts of [{ token: "" }, { repo: "bad/repo/extra" }]) {
    const { result, calls } = await execute({}, opts);
    assert.equal(result.errors.length, 1);
    assert.deepEqual(calls, []);
  }
});

test("workflow uses trusted default-branch code and independent nonblocking cadence", () => {
  const wf = readFileSync(new URL("../.github/workflows/repository-age-policy.yml", import.meta.url), "utf8");
  assert.match(wf, /workflows: \["remediation-consumer"\]/);
  assert.match(wf, /cron: '43 3 \* \* \*'/);
  assert.match(wf, /workflow_dispatch:/);
  assert.match(wf, /types: \[opened, reopened\]/);
  assert.match(wf, /ref: \$\{\{ github.event.repository.default_branch \}\}/);
  assert.match(wf, /persist-credentials: false/);
  assert.match(wf, /head_repository.full_name == github.repository/);
  assert.match(wf, /head_branch == github.event.repository.default_branch/);
  assert.match(wf, /GH_TOKEN: \$\{\{ secrets.QNFO_GH_PAT \}\}/);
  assert.match(wf, /cancel-in-progress: false/);
  assert.match(wf, /timeout-minutes: 15/);
  assert.ok(!wf.includes("pull_request_target:"));
  assert.ok(!wf.includes("head_sha"));
  assert.ok(!wf.includes("pull_request:"));
  const actions = [...wf.matchAll(/uses: ([^\s]+)/g)];
  assert.ok(actions.length >= 2 && actions.every((m) => /@[a-f0-9]{40}$/.test(m[1])));
});

test("TRACKER-D1-CANON-1: a fleet-issue mirror is never closed by the age policy, a plain issue still is", async () => {
  const { result, calls } = await execute({ issues: [
    issue(11, { labels: [{ name: "fleet-issue" }] }), issue(12, { labels: [{ name: "bug" }] }), issue(13)
  ] });
  assert.deepEqual(result.issues_d1_governed, [11]);
  assert.deepEqual(result.issues_closed, [12, 13]);
  assert.ok(!calls.some((c) => c.path.endsWith("/issues/11") && c.method !== "GET"), "mirror untouched");
  assert.deepEqual(result.errors, []);
});
