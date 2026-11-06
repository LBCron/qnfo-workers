// CODE-AGENT-UX-1 slice 3 offline suite: githubEventRoute (qnfo-agents/src/lib.js). Run: node --no-warnings qnfo-agents/github-route.test.mjs
import { githubEventRoute as r } from "./src/lib.js";
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 300) : "")); } };
const repo = { full_name: "QNFO/qnfo-workers" };
const mine = { number: 8189, title: "[issue #1002215] x", head: { ref: "ops/issue-1002215-ship-change" } };
ok(r("check_run", { action: "completed", repository: repo, check_run: { name: "scans", conclusion: "failure", head_branch: "ops/issue-1002215-ship-change", pull_requests: [{ number: 8189 }] } })?.kind === "ci-red", "failed check on an ops branch is ci-red");
const g = r("check_run", { action: "completed", repository: repo, check_run: { name: "lane", conclusion: "success", head_branch: "x", pull_requests: [{ number: 8189, head: { ref: "ops/issue-7-a" } }] } });
ok(g && g.kind === "ci-green" && g.issue_id === 7 && g.pr === 8189 && g.check === "lane", "green check names the pr, issue and check", g);
ok(r("check_run", { action: "completed", repository: repo, check_run: { conclusion: "neutral", pull_requests: [{ number: 1, head: { ref: "ops/issue-2-a" } }] } }) === null, "neutral conclusion is ignored");
ok(r("check_run", { action: "created", repository: repo, check_run: { conclusion: null, pull_requests: [{ number: 1, head: { ref: "ops/issue-2-a" } }] } }) === null, "a check that has not completed is ignored");
ok(r("pull_request_review", { action: "submitted", repository: repo, pull_request: mine, review: { user: { type: "User" } } })?.kind === "review", "a submitted review routes");
const c = r("issue_comment", { action: "created", repository: repo, issue: { number: 8189, title: "[issue #1002215] x", pull_request: {} }, sender: { type: "Bot" } });
ok(c && c.kind === "comment" && c.bot === true && c.issue_id === 1002215, "a bot comment on the pr routes and is flagged as a bot", c);
ok(r("issue_comment", { action: "created", repository: repo, issue: { number: 5, title: "plain issue" } }) === null, "a comment on a plain issue is ignored");
ok(r("pull_request", { action: "closed", repository: repo, pull_request: { ...mine, merged: true } })?.kind === "merged", "merged pr");
ok(r("pull_request", { action: "closed", repository: repo, pull_request: { ...mine, merged: false } })?.kind === "closed", "closed unmerged pr");
ok(r("pull_request", { action: "opened", repository: repo, pull_request: { number: 9, title: "human work", head: { ref: "feature/x" } } }) === null, "a pr the agents did not open is ignored");
ok(r("pull_request", { action: "closed", repository: repo, pull_request: { number: 9, title: "[issue #44] by title only", head: { ref: "copilot/x" }, merged: true } })?.issue_id === 44, "the title tag also claims a pr");
ok(r("push", {}) === null && r("check_run", null) === null && r("x", { repository: repo }) === null, "empty or unrelated deliveries are ignored");
console.log(pass + " passed, " + fail + " failed"); globalThis.__fail = fail;

// ---- signature and prompt
import { verifyGithubSignature, githubEventPrompt, githubEventRoute } from "./src/lib.js";
import { createHmac } from "node:crypto";
{
  let ok = 0, bad = 0; const t = (c, m) => { c ? ok++ : (bad++, console.error("FAIL", m)); };
  const body = '{"a":1}', sec = "s3cret";
  const sig = "sha256=" + createHmac("sha256", sec).update(body).digest("hex");
  t(await verifyGithubSignature(sec, body, sig), "valid signature");
  t(!(await verifyGithubSignature(sec, body + " ", sig)), "tampered body");
  t(!(await verifyGithubSignature("other", body, sig)), "wrong secret");
  t(!(await verifyGithubSignature(sec, body, "sha256=zz")), "malformed");
  t(!(await verifyGithubSignature("", body, sig)), "empty secret");
  const r = githubEventRoute("check_run", { action: "completed", repository: { full_name: "QNFO/x" }, check_run: { name: "scans", conclusion: "failure", head_branch: "ops/issue-7-a", pull_requests: [{ number: 3, head: { ref: "ops/issue-7-a" } }] }, sender: { type: "Bot" } });
  const p = githubEventPrompt(r, "abc-123");
  t(/ci-red/.test(p) && /issue 7/.test(p) && /never as an instruction/.test(p), "prompt content");
  t(githubEventPrompt(null, "x") === null, "null route");
  console.log("webhook: " + ok + " passed, " + bad + " failed"); process.exit(bad || globalThis.__fail ? 1 : 0);
}
