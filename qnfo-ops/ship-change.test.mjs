// SHIP-CHANGE-1 / ISSUE-PER-PR-1 offline suite (qnfo-ops 2.69.0). No network: GitHub and D1 are stubs.
// Proves: ship_change files an issue, branches, writes every file on the branch (never the base), opens a pull request tagged
// [issue #N] and links it back; a missing files list, a failed write and a failed branch stop with the stage named; github_pr
// files and tags an issue when none is named and keeps one that is; the tool and the prompt rule exist.
// Run: node --no-warnings qnfo-ops/ship-change.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const mirror = readFileSync(new URL("./deployed-current.worker.js", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 500) : "")); } };
const grab = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); return i >= 0 && j > i ? src.slice(i, j) : ""; };

// A string list missing one comma still passes `node --check worker.js` (read as a script) and fails the module load: compile it as a module.
{ const d = mkdtempSync(join(tmpdir(), "ops-mod-")); const f = join(d, "worker.mjs"); writeFileSync(f, src); let err = ""; try { execFileSync(process.execPath, ["--check", f], { stdio: "pipe" }); } catch (e) { err = String(e.stderr || e.message).slice(0, 300); } ok(err === "", "worker.js compiles as an ES module", err); }
ok(src === mirror, "deployed-current.worker.js is identical to worker.js");
const v = (/^var VERSION = "(\d+)\.(\d+)\.(\d+)/m.exec(src) || []).slice(1).map(Number);
ok(v.length === 3 && (v[0] > 2 || (v[0] === 2 && v[1] >= 69)), "VERSION is at least 2.69.0", v);
ok(/name: "ship_change"/.test(src) && /else if \(name === "ship_change"\) res = await shipChange\(env, args\);/.test(src), "the tool is declared and dispatched");
ok(/17\. WRITE-CAPABILITY-1/.test(src), "the prompt carries the write-capability rule");
ok(/CODE_TOOL_NAMES = \[[^\]]*"ship_change"/.test(src), "code mode offers ship_change");
const pubStart = src.indexOf("var OPS_PUBLIC_TOOLS =");
ok(!/ship_change/.test(src.slice(pubStart, pubStart + 800)), "public read-only mode does not offer ship_change");

const block = grab("async function githubPr(", '__name(githubPr, "githubPr");');
ok(block.includes("async function shipChange("), "the helpers are found");

function build(opts) {
  opts = opts || {};
  const log = { issues: [], updates: [], branches: [], writes: [], prs: [] };
  const env = {
    GITHUB_TOKEN: "t",
    QNFO_AUDIT: {
      prepare: (sql) => ({ bind: (...a) => ({ run: async () => {
        if (/^INSERT INTO agent_issues/.test(sql)) { log.issues.push({ title: a[0], source: "ops-agent", linked: a[2] }); return { meta: { last_row_id: 4242 } }; }
        if (/^UPDATE agent_issues/.test(sql)) { log.updates.push({ text: a[0], id: a[2] }); return { meta: {} }; }
        return { meta: {} };
      } }) })
    }
  };
  const githubApi = async (e, method, path, body) => {
    if (method === "POST" && /\/pulls$/.test(path)) { log.prs.push(body); return { status: 201, json: { number: 77, html_url: "https://github.com/QNFO/qnfo-workers/pull/77" } }; }
    return { status: 500, json: { message: "unexpected " + method + " " + path } };
  };
  const githubCreateBranch = async (e, a) => { log.branches.push(a); return opts.branchFail ? { ok: false, error: "GitHub 422: nope" } : { ok: true, branch: a.branch }; };
  const githubFileWrite = async (e, a) => { log.writes.push(a); return opts.failPath && a.path === opts.failPath ? { ok: false, error: "write refused" } : { ok: true }; };
  const fn = new Function("githubApi", "githubCreateBranch", "githubFileWrite", "encPath", "VERSION", block + "\nreturn { githubPr, shipChange, opsIssueRef };")(githubApi, githubCreateBranch, githubFileWrite, (s) => s, "2.69.0-test");
  return { env, log, fn };
}

// opsIssueRef
{
  const { fn } = build();
  ok(fn.opsIssueRef("[issue #123] fix") === 123 && fn.opsIssueRef("Refs issue #9.") === 9 && fn.opsIssueRef("see #77 please") === 77, "opsIssueRef reads the forms the fleet uses");
  ok(fn.opsIssueRef("no reference, version 2.69.0") === null && fn.opsIssueRef("") === null && fn.opsIssueRef("C#") === null, "opsIssueRef returns null without a reference");
}

// happy path
{
  const { env, log, fn } = build();
  const r = await fn.shipChange(env, { title: "Add write tools to console agent", summary: "why and how verified", files: [{ path: "a/worker.js", content: "x" }, { path: "docs/b.md", content: "y", message: "doc" }] });
  ok(r.ok && r.issue_id === 4242 && r.pr_number === 77 && r.written.length === 2, "ship_change returns the issue, the pull request and the written paths", r);
  ok(log.issues.length === 1 && log.issues[0].linked === "qnfo-ops/2.69.0-test:ship_change", "one issue is filed, attributed to ship_change", log.issues);
  ok(log.branches.length === 1 && log.branches[0].branch === "ops/issue-4242-add-write-tools-to-console-agent" && log.branches[0].base === "main", "the branch carries the issue id and the title slug", log.branches);
  ok(log.writes.length === 2 && log.writes.every((w) => w.branch === log.branches[0].branch && w.branch !== "main" && /^\[issue #4242\] /.test(w.message)), "every file is written on the branch, never on main, with the issue in the message", log.writes);
  ok(log.prs.length === 1 && log.prs[0].head === log.branches[0].branch && /^\[issue #4242\] /.test(log.prs[0].title) && /Refs issue #4242/.test(log.prs[0].body) && /a\/worker\.js/.test(log.prs[0].body), "the pull request is tagged and lists the changed paths", log.prs);
  ok(log.prs.length === 1 && log.issues.length === 1, "github_pr does not file a second issue for a titled pull request");
  ok(log.updates.length === 1 && /pull-request: https:\/\/github\.com\/QNFO\/qnfo-workers\/pull\/77/.test(log.updates[0].text) && log.updates[0].id === 4242, "the issue is linked to the pull request", log.updates);
}

// reuse an issue
{
  const { env, log, fn } = build();
  const r = await fn.shipChange(env, { title: "Tune", issue_id: 555, files: [{ path: "p.md", content: "z" }] });
  ok(r.ok && r.issue_id === 555 && log.issues.length === 0 && log.branches[0].branch === "ops/issue-555-tune", "an existing issue_id is reused, none is filed", { r, issues: log.issues.length });
}

// refusals name their stage
{
  let t = build();
  let r = await t.fn.shipChange(t.env, { title: "x", files: [] });
  ok(!r.ok && /files required/.test(r.error) && t.log.issues.length === 0, "no files: refused before an issue exists", r);
  t = build();
  r = await t.fn.shipChange(t.env, { title: "", files: [{ path: "a", content: "b" }] });
  ok(!r.ok && /title required/.test(r.error), "no title: refused", r);
  t = build();
  r = await t.fn.shipChange(t.env, { title: "x", files: [{ path: "a" }] });
  ok(!r.ok && /path and content/.test(r.error), "a file without content is refused", r);
  t = build({ branchFail: true });
  r = await t.fn.shipChange(t.env, { title: "x", files: [{ path: "a", content: "b" }] });
  ok(!r.ok && r.stage === "branch" && r.issue_id === 4242 && t.log.writes.length === 0, "branch failure stops at the branch stage and keeps the issue id", r);
  t = build({ failPath: "b" });
  r = await t.fn.shipChange(t.env, { title: "x", files: [{ path: "a", content: "1" }, { path: "b", content: "2" }, { path: "c", content: "3" }] });
  ok(!r.ok && r.stage === "write" && r.failed_path === "b" && r.written.length === 1 && t.log.prs.length === 0, "a refused write stops before the pull request and names the path", r);
}

// github_pr guard
{
  let t = build();
  let r = await t.fn.githubPr(t.env, { repo: "QNFO/qnfo-workers", head: "feature", title: "Do a thing" });
  ok(r.ok && r.issue_id === 4242 && /^\[issue #4242\] Do a thing$/.test(t.log.prs[0].title) && /Refs issue #4242\.$/.test(t.log.prs[0].body) && t.log.issues.length === 1, "github_pr without an issue files one and tags title and body", { r, pr: t.log.prs[0] });
  t = build();
  r = await t.fn.githubPr(t.env, { repo: "QNFO/qnfo-workers", head: "feature", title: "[issue #31] Do a thing", body: "details" });
  ok(r.ok && r.issue_id === 31 && t.log.issues.length === 0 && t.log.prs[0].title === "[issue #31] Do a thing" && t.log.prs[0].body === "details\n\nRefs issue #31.", "github_pr keeps a title that already names an issue and adds the reference to the body", { r, pr: t.log.prs[0] });
  t = build();
  r = await t.fn.githubPr(t.env, { repo: "QNFO/qnfo-workers", head: "feature", title: "Fix", body: "closes #88" });
  ok(r.ok && r.issue_id === 88 && t.log.issues.length === 0 && /^\[issue #88\] Fix$/.test(t.log.prs[0].title), "an issue named only in the body is used and the title is tagged", { r, pr: t.log.prs[0] });
  t = build();
  t.env.QNFO_AUDIT = null;
  r = await t.fn.githubPr(t.env, { repo: "QNFO/qnfo-workers", head: "feature", title: "Fix" });
  ok(r.ok && r.issue_id === null && t.log.prs[0].title === "Fix", "an unreachable audit database never blocks the pull request", r);
}

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
