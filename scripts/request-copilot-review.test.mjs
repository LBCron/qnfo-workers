// REQUEST-COPILOT-REVIEW-1 offline suite (the review steps of .github/workflows/pr-lane.yml; they were .github/workflows/request-copilot-review.yml until PR-CHECK-CAP-5-1 folded the lane into one job;
// LANE-WAITS-FOR-REVIEW-1 lever 1, issue 5515). No network: the two request step scripts are run for real under `bash -eo pipefail` (the runner's shell) against a fake `gh` that records its calls.
// Proves: a ready pull request into main gets the Copilot reviewer requested through POST .../requested_reviewers, an already requested reviewer is left alone (an exact
// login match: a longer or prefixed login is not it), a failed list or a failed request makes the step fail (so continue-on-error lets the fallback run); the two
// scripts are identical (only the credential differs); both request steps cannot turn the job red (a failed non-required check stops the merge lane: bhMergeDecide "check(s) failed");
// the fleet user credential reaches the fallback, retry and merge steps only, never the first request step, and no pull request text (title, body, branch name) is read in the review steps.
// Run: node --no-warnings scripts/request-copilot-review.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, copyFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const wf = readFileSync(join(root, ".github/workflows/pr-lane.yml"), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 500) : "")); } };

const code = wf.replace(/^\s*#.*$/gm, "");
const stepsAt = code.indexOf("    steps:");
const steps = code.slice(stepsAt).split(/\n      - (?=name: |uses: )/).slice(1).map((s) => s);
const stepOf = (id) => steps.find((s) => new RegExp("^\\s+id: " + id + "\\s*$", "m").test(s)) || "";
const primary = stepOf("primary"), fallback = stepOf("fallback");
const warn = steps.find((s) => /Say so when no review/.test(s)) || "";
const runBlock = (s) => {
  const lines = s.split("\n"), i = lines.findIndex((l) => /^\s+run: \|\s*$/.test(l));
  if (i < 0) return (lines.find((l) => /^\s+run: /.test(l)) || "").replace(/^\s+run: /, "");
  const out = [];
  for (let j = i + 1; j < lines.length; j++) { if (/^ {10,}\S/.test(lines[j]) || lines[j].trim() === "") out.push(lines[j].replace(/^ {10}/, "")); else break; }
  return out.join("\n").trim();
};

// --- shape
ok(!!primary && !!fallback && !!warn, "the review steps exist: the request with GITHUB_TOKEN, the request with the fleet user credential, the warning");
ok(/DO_REVIEW: \$\{\{[^}]*pull_request_target[^}]*base\.ref == 'main'[^}]*draft == false[^}]*"opened","reopened","ready_for_review"[^}]*\}\}/.test(code), "the review is requested when a pull request into main opens, reopens or becomes ready, and never for a draft");
const head = code.slice(0, code.indexOf("\njobs:"));
ok(/^ {2}pull_request_target:/m.test(head) && /^ {2}workflow_run:/m.test(head) && !/^ {2}(pull_request|push|workflow_dispatch|schedule|issue_comment):/m.test(head), "only pull_request_target and workflow_run can hand the fleet user credential to the job");
ok(/runs-on: ubuntu-24\.04/.test(code) && /timeout-minutes: 5\b/.test(code) && !/ubuntu-latest/.test(code), "the job has the runner pin and a timeout");
ok(/group: pr-lane-/.test(code) && /cancel-in-progress: false/.test(code), "one run per pull request, never cancelled mid-request");

// --- a request never blocks a merge
ok(/continue-on-error: true/.test(primary) && /continue-on-error: true/.test(fallback), "both request steps are continue-on-error (a red non-required check stops the lane)");
ok(/if: \$\{\{ env\.DO_REVIEW == 'true' && steps\.primary\.outcome != 'success' \}\}/.test(fallback), "the fleet user credential is used only after the workflow token failed");
ok(/steps\.primary\.outcome != 'success' && steps\.fallback\.outcome != 'success'/.test(warn) && /::warning::/.test(runBlock(warn)), "the warning step runs only when neither credential worked, and it only warns");
ok(!/continue-on-error:\s*false/.test(primary + fallback + warn) && !/\bexit 1\b/.test(primary + fallback + warn), "nothing in the review steps fails the job on purpose");

// --- the credential and the pull request text
ok(/secrets\.QNFO_GH_PAT/.test(fallback) && !/secrets\./.test(primary) && !/secrets\./.test(warn), "the fleet user credential is not in the first request step or the warning");
const patSteps = steps.filter((s) => /secrets\.QNFO_GH_PAT/.test(s)).length;
ok(patSteps === 3, "the fleet user credential reaches exactly three steps (fallback review, retry, merge)", patSteps);
ok(/GH_TOKEN: \$\{\{ github\.token \}\}/.test(primary), "the first request uses the workflow token");
const checkouts = steps.filter((s) => /actions\/checkout/.test(s));
ok(checkouts.length === 1 && /env\.DO_LIFECYCLE == 'true'/.test(checkouts[0]) && !/\bref:/.test(code), "the only checkout is the base branch, for the Copilot lifecycle step; nothing is fetched from the pull request");
ok(!/pull_request\.(head|title|body)|head_ref|head_branch\)?\s*\}\}[^\n]*run:/.test(primary + fallback + warn), "no pull request text (title, body, branch) reaches the review steps");
ok(!/\$\{\{/.test([runBlock(primary), runBlock(fallback), runBlock(warn)].join("\n")), "no review run script carries an expression: the number travels through env");
ok(/^ {6}PR_NUMBER: \$\{\{ github\.event\.pull_request\.number \|\| github\.event\.workflow_run\.pull_requests\[0\]\.number \}\}/m.test(code), "the pull request number is handed over through env");
ok(runBlock(primary) === runBlock(fallback) && runBlock(primary).length > 100, "the two request scripts are identical: only the credential differs");

// --- behaviour: run the step script against a fake gh
const dir = mkdtempSync(join(tmpdir(), "rcr-"));
const bin = join(dir, "bin");
const log = join(dir, "gh.log");
writeFileSync(join(dir, "fake-gh.sh"), [
  "#!/usr/bin/env bash",
  'echo "$*" >> "$GH_LOG"',
  'case "$*" in',
  '  *"--method POST"*) if [ "${GH_POST_FAIL:-0}" = 1 ]; then echo "HTTP 422" >&2; exit 1; fi; exit 0;;',
  '  *"--jq"*) if [ "${GH_LIST_FAIL:-0}" = 1 ]; then echo "HTTP 403" >&2; exit 1; fi; printf "%s" "${GH_REQUESTED:-}"; exit 0;;',
  "esac", "exit 0", ""
].join("\n"));
mkdirSync(bin);
copyFileSync(join(dir, "fake-gh.sh"), join(bin, "gh"));
chmodSync(join(bin, "gh"), 0o755);
const exec = (script, env) => {
  writeFileSync(log, "");
  const r = spawnSync("bash", ["-eo", "pipefail", "-c", script], { encoding: "utf8", env: Object.assign({ PATH: bin + ":" + process.env.PATH, GH_LOG: log, GITHUB_REPOSITORY: "QNFO/qnfo-workers", PR_NUMBER: "42" }, env || {}) });
  return { code: r.status, calls: readFileSync(log, "utf8").split("\n").filter(Boolean), err: r.stderr };
};
const script = runBlock(primary);
const REVIEWER = "copilot-pull-request-reviewer[bot]";
const posts = (r) => r.calls.filter((c) => c.includes("--method POST"));

const a = exec(script, { GH_REQUESTED: "" });
ok(a.code === 0 && posts(a).length === 1 && posts(a)[0] === "api --method POST repos/QNFO/qnfo-workers/pulls/42/requested_reviewers -f reviewers[]=" + REVIEWER, "a pull request with no reviewer gets the Copilot reviewer requested", a);
const b = exec(script, { GH_REQUESTED: "rwnq8\n" + REVIEWER + "\n" });
ok(b.code === 0 && posts(b).length === 0 && b.calls.length === 1, "a reviewer that is already requested is left alone", b.calls);
for (const near of [REVIEWER + "x", "not-" + REVIEWER, "xcopilot-pull-request-reviewer[bot]", "copilot-pull-request-reviewer", "Copilot"]) {
  const c = exec(script, { GH_REQUESTED: near + "\n" });
  ok(c.code === 0 && posts(c).length === 1, "a different login (" + near + ") is not the reviewer, so the request is made", c.calls);
}
const d = exec(script, { GH_REQUESTED: "", GH_POST_FAIL: "1" });
ok(d.code !== 0 && posts(d).length === 1, "a refused request fails the step, so the fallback runs", d);
const e = exec(script, { GH_LIST_FAIL: "1" });
ok(e.code !== 0 && posts(e).length === 0, "an unreadable reviewer list fails the step and requests nothing", e);
const f = exec(script, { GH_REQUESTED: "", PR_NUMBER: "7" });
ok(posts(f).length === 1 && /pulls\/7\/requested_reviewers/.test(posts(f)[0]), "the request goes to the pull request named by PR_NUMBER", f.calls);
const w = exec(runBlock(warn), { PR_NUMBER: "42" });
ok(w.code === 0 && w.calls.length === 0, "the warning step succeeds and calls nothing");

rmSync(dir, { recursive: true, force: true });
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
