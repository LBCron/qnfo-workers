#!/usr/bin/env node
// REPOSITORY-AGE-POLICY-1, charter pillar autonomy: age advances work, never bypasses checks or claims a fix.
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { makeApi } from "./copilot-pr-lifecycle.mjs";

export const DRAFT_MINUTES = 30;
export const ISSUE_MINUTES = 7 * 24 * 60;
// TRACKER-D1-CANON-1: a GitHub issue carrying this label mirrors one qnfo-audit agent_issues row. D1 is canonical: qnfo-github-steward
// opens and closes the mirror from the D1 status, and D1's own age ladder (v_issue_age_ladder) advances the work. The seven-day policy
// is for issues that have no D1 row, so it never closes a mirror (134 open D1 issues had their mirror closed not_planned on 2026-11-06).
export const MIRROR_LABEL = "fleet-issue";
export function isD1Mirror(issue) {
  return (issue?.labels || []).some((l) => String(l?.name ?? l) === MIRROR_LABEL);
}
const MARKER = "<!-- repository-age-policy:v1 -->";
const READY = `mutation Ready($id: ID!) {
  markPullRequestReadyForReview(input: {pullRequestId: $id}) {
    pullRequest { id isDraft }
  }
}`;
const LINKS = `query Links($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      timelineItems(first: 100, after: $after, itemTypes: [CROSS_REFERENCED_EVENT]) {
        nodes {
          ... on CrossReferencedEvent {
            willCloseTarget
            source {
              ... on PullRequest {
                number state changedFiles repository { nameWithOwner }
              }
            }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;

export function olderThan(createdAt, minutes, now) {
  const created = Date.parse(createdAt);
  return Number.isFinite(created) && now - created > minutes * 60000;
}

function requireOk(r, where) {
  if (r.status < 200 || r.status >= 300) throw new Error(where + ": HTTP " + r.status + " " + r.message);
  return r.body;
}

async function graphql(api, query, variables) {
  const body = requireOk(await api.req("POST", "/graphql", { query, variables }), "GraphQL");
  if (!body?.data || body.errors?.length) throw new Error("GraphQL: " + JSON.stringify(body?.errors || "missing data"));
  return body.data;
}

// Finish pagination before writes; closing issues while paging the open list would skip rows.
async function list(api, path) {
  const items = [];
  for (let page = 1; ; page++) {
    const body = requireOk(await api.req("GET", path + "&per_page=100&page=" + page), "list");
    if (!Array.isArray(body)) throw new Error("list: expected array");
    items.push(...body);
    if (body.length < 100) return items;
  }
}

async function hasCodePr(api, repo, number) {
  const [owner, name] = repo.split("/");
  let after = null;
  const seen = new Set();
  for (;;) {
    const data = await graphql(api, LINKS, { owner, name, number, after });
    const timeline = data.repository?.issue?.timelineItems;
    if (!Array.isArray(timeline?.nodes) || typeof timeline.pageInfo?.hasNextPage !== "boolean") {
      throw new Error("issue links: incomplete timeline");
    }
    for (const event of timeline.nodes) {
      const pr = event?.source;
      if (event?.willCloseTarget && pr?.repository?.nameWithOwner === repo
          && pr.state === "OPEN" && pr.changedFiles > 0) return pr.number;
    }
    if (!timeline.pageInfo.hasNextPage) return null;
    after = timeline.pageInfo.endCursor;
    if (!after || seen.has(after)) throw new Error("issue links: invalid pagination cursor");
    seen.add(after);
  }
}

export async function run(opts, deps = {}) {
  const { repo, token, mode = "live" } = opts;
  const now = deps.now ?? Date.now();
  const sum = { repo, mode, drafts_ready: [], issues_with_pr: [], issues_closed: [], errors: [] };
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo || "") || !token) {
    sum.errors.push("Missing credential or invalid repository");
    return sum;
  }
  const api = makeApi((url, init) => (deps.fetchImpl || fetch)(url, {
    ...init, signal: AbortSignal.timeout(30000)
  }), token);
  const dry = mode === "dry";
  let actor;
  const recordError = (kind, number, e) => sum.errors.push(kind + " #" + number + ": " + e.message);
  let pulls = [];
  try { pulls = await list(api, "/repos/" + repo + "/pulls?state=open&sort=created&direction=asc"); }
  catch (e) { recordError("list pulls", "", e); }
  for (const listed of pulls) {
    if (!listed.draft || !olderThan(listed.created_at, DRAFT_MINUTES, now)) continue;
    try {
      const pr = requireOk(await api.req("GET", "/repos/" + repo + "/pulls/" + listed.number), "read pull");
      if (pr.state !== "open" || !pr.draft || !olderThan(pr.created_at, DRAFT_MINUTES, now)) continue;
      if (!pr.node_id) throw new Error("read pull: missing node ID");
      if (!dry) {
        const data = await graphql(api, READY, { id: pr.node_id });
        const ready = data.markPullRequestReadyForReview?.pullRequest;
        if (ready?.id !== pr.node_id || ready.isDraft !== false) throw new Error("readiness not confirmed");
      }
      sum.drafts_ready.push(pr.number);
    } catch (e) { recordError("ready pull", listed.number, e); }
  }

  let issues = [];
  try { issues = await list(api, "/repos/" + repo + "/issues?state=open&sort=created&direction=asc"); }
  catch (e) { recordError("list issues", "", e); }
  for (const listed of issues) {
    if (listed.pull_request || !olderThan(listed.created_at, ISSUE_MINUTES, now)) continue;
    if (isD1Mirror(listed)) { (sum.issues_d1_governed ||= []).push(listed.number); continue; }
    try {
      const path = "/repos/" + repo + "/issues/" + listed.number;
      const issue = requireOk(await api.req("GET", path), "read issue");
      if (issue.state !== "open" || issue.pull_request || !olderThan(issue.created_at, ISSUE_MINUTES, now)) continue;
      const pr = await hasCodePr(api, repo, issue.number);
      if (pr) { sum.issues_with_pr.push({ issue: issue.number, pr }); continue; }
      if (!dry) {
        if (!actor) {
          actor = requireOk(await api.req("GET", "/user"), "read actor")?.login;
          if (!actor) throw new Error("read actor: missing login");
        }
        const comments = await list(api, path + "/comments?sort=created&direction=asc");
        // A failed close can be retried without posting the policy comment again.
        if (!comments.some((c) => c.body?.includes(MARKER) && c.user?.login === actor)) {
          const body = MARKER + "\nClosed as **not planned** under the repository's seven-day age policy: "
            + "this issue is older than seven days and has no open, code-bearing pull request linked to close it. "
            + "This is an administrative disposition, not a claim that the defect is fixed or deployed. "
            + "Any canonical fleet/D1 remediation record remains unchanged. "
            + "Reopening an unchanged aged issue causes the policy to evaluate it again.";
          requireOk(await api.req("POST", path + "/comments", { body }), "comment issue");
        }
        const closed = requireOk(await api.req("PATCH", path, { state: "closed", state_reason: "not_planned" }), "close issue");
        if (closed?.state !== "closed") throw new Error("closure not confirmed");
      }
      sum.issues_closed.push(issue.number);
    } catch (e) { recordError("dispose issue", listed.number, e); }
  }
  return sum;
}

async function main() {
  const env = process.env;
  const mode = env.AGE_POLICY_MODE === "dry" ? "dry" : "live";
  let sum;
  try {
    sum = await run({ repo: env.GITHUB_REPOSITORY, token: env.GH_TOKEN, mode });
  } catch (e) { sum = { errors: [e.message] }; }
  console.log("RESULT_JSON=" + JSON.stringify(sum));
  for (const error of sum.errors) console.log("::error::" + error.replace(/[\r\n]/g, " "));
  if (env.GITHUB_STEP_SUMMARY) {
    appendFileSync(env.GITHUB_STEP_SUMMARY, "### Repository age policy (" + mode + ")\n\n"
      + "- Drafts made ready: " + (sum.drafts_ready?.length || 0)
      + "\n- Issues with a code PR: " + (sum.issues_with_pr?.length || 0)
      + "\n- Issues closed as not planned: " + (sum.issues_closed?.length || 0)
      + "\n- Errors: " + sum.errors.length + "\n");
  }
  process.exitCode = sum.errors.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
