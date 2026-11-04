// scripts/version-bump-guard.test.mjs -- PR-GUARD-FIXES-1 (agent_issues 100295, charter pillar autonomy). Offline regression suite for the
// version-bump guard:
//   1. VERSION-RE-ANCHOR-1: scripts/version-bump-guard.py read the first `var VERSION = "..."` anywhere in a bundle, comments included.
//      qnfo-model-eval/worker.js line 50 quoted the form in a comment, so the guard read the placeholder "..." on both sides of two real bumps
//      (1.2.0 -> 1.3.0, 1.3.0 -> 1.4.0) and reported "unchanged VERSION after a byte change" (push runs 39126065745 and 39126418865, PR runs
//      39125992400 and 39126349048). The suite builds throw-away repositories (a base commit and a head commit) and runs the real script over them.
//   2. PUSH-COALESCE-1 and MAIN-GUARD-RANGE-FLOOR-1: .github/workflows/version-bump-guard.yml lets a newer push to main cancel the older run (one group, cancel-in-progress
//      true; before 2026-11-04 VERSION-BUMP-PUSH-SHA-1 gave each push its own group because 35 of 277 push-to-main runs from 2026-10-18 were cancelled and their commits never
//      validated). The suite evaluates the workflow's own concurrency expressions for push, pull_request and dispatch contexts, and runs the range-floor shell
//      against a throw-away repository with a fake gh: the newest run starts at the last green run's head, so a cancelled run's range is still read.
// Run: node scripts/version-bump-guard.test.mjs
//   VBG_GUARD=<file> runs another copy of the script, VBG_WORKFLOW=<file> another copy of the workflow (the pre-change files): each must fail.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const GUARD = process.env.VBG_GUARD ? resolve(process.env.VBG_GUARD) : join(here, "version-bump-guard.py");
const WF_PATH = process.env.VBG_WORKFLOW ? resolve(process.env.VBG_WORKFLOW) : join(root, ".github", "workflows", "version-bump-guard.yml");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 500) : "")); } };

const PY = (() => { for (const c of ["python3", "python"]) { const r = spawnSync(c, ["-I", "-c", "import sys; print(sys.version_info[0])"], { encoding: "utf8" }); if (r.status === 0 && String(r.stdout).trim() === "3") return c; } return null; })();
const GIT_OK = spawnSync("git", ["--version"], { encoding: "utf8" }).status === 0;
if (!PY || !GIT_OK) { console.log("version-bump-guard.test: python3 or git is absent on this runner; skipped"); process.exit(0); }

const dirs = [];
const git = (cwd, ...a) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...a], { cwd, encoding: "utf8" });
// A throw-away repository with a base commit and a head commit; files maps a path to its text.
function repo(baseFiles, headFiles) {
  const d = mkdtempSync(join(tmpdir(), "vbg-")); dirs.push(d);
  git(d, "init", "-q");
  const put = (files) => { for (const [p, text] of Object.entries(files)) { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), text); } git(d, "add", "-A"); git(d, "commit", "-q", "-m", "c"); return git(d, "rev-parse", "HEAD").stdout.trim(); };
  const base = put(baseFiles), head = put(headFiles);
  return { d, base, head };
}
const guard = (r) => { const p = spawnSync(PY, [GUARD, r.base, r.head], { cwd: r.d, encoding: "utf8" }); return { code: p.status, out: p.stdout + p.stderr }; };
const W = "qnfo-x/worker.js";

// The qnfo-model-eval form: a comment that quotes the declaration sits above the real one.
const quoted = (ver, body, decl) => "// A requires the literal `var VERSION = \"...\"` form (VERSION-LINE-NOTES-1).\n/*\n * requires the literal `var VERSION = \"...\"` form\n */\n" + (decl || "var VERSION = \"" + ver + "\";") + "\n" + body + "\n";

{ const r = guard(repo({ [W]: quoted("1.2.0", "// body a") }, { [W]: quoted("1.3.0", "// body b") }));
  ok(r.code === 0 && /OK {4}qnfo-x\/worker\.js {2}1\.2\.0 -> 1\.3\.0/.test(r.out) && !/\[VERSION=\.\.\.\]/.test(r.out), "a comment that quotes the VERSION form above the declaration does not hide a real bump (the model-eval false positive)", r); }
{ const r = guard(repo({ [W]: quoted("1.2.0", "// body a") }, { [W]: quoted("1.2.0", "// body b") }));
  ok(r.code === 1 && /\[VERSION=1\.2\.0\] {2}unchanged VERSION after a byte change/.test(r.out), "a byte change that keeps the VERSION still fails, and names the real VERSION, not the quoted placeholder", r); }
{ const r = guard(repo({ [W]: "// var VERSION = \"0.0.1\";\nvar VERSION = \"1.2.0\";\nx\n" }, { [W]: "// var VERSION = \"0.0.1\";\nvar VERSION = \"1.2.1\";\ny\n" }));
  ok(r.code === 0 && /1\.2\.0 -> 1\.2\.1/.test(r.out), "a line comment that holds a whole declaration is not the VERSION", r); }
{ const r = guard(repo({ [W]: "/* header var VERSION = \"0.0.1\"; */\nvar VERSION = \"1.2.0\";\nx\n" }, { [W]: "/* header var VERSION = \"0.0.1\"; */\nvar VERSION = \"1.4.0\";\ny\n" }));
  ok(r.code === 0 && /1\.2\.0 -> 1\.4\.0/.test(r.out), "a block comment that holds a declaration mid-line is not the VERSION", r); }
{ const r = guard(repo({ [W]: "  var VERSION = \"2.0.0\";\nx\n" }, { [W]: "  var VERSION = \"2.0.1\";\ny\n" }));
  ok(r.code === 0 && /2\.0\.0 -> 2\.0\.1/.test(r.out), "an indented declaration is still read", r); }
{ const r = guard(repo({ [W]: "var VERSION=\"3.26.4-codeagent\";;\nx\n" }, { [W]: "var VERSION=\"3.26.5-codeagent\";;\ny\n" }));
  ok(r.code === 0 && /3\.26\.4-codeagent -> 3\.26\.5-codeagent/.test(r.out), "the no-space form qnfo-gateway writes is still read", r); }
{ const r = guard(repo({ [W]: "var VERSION = \"1.2.0\";\n/* 1.2.0 note quoting var VERSION = \"9.9.9\" */\nx\n" }, { [W]: "var VERSION = \"1.3.0\";\n/* 1.3.0 note quoting var VERSION = \"9.9.9\" */\n/* 1.2.0 note quoting var VERSION = \"9.9.9\" */\ny\n" }));
  ok(r.code === 0 && /1\.2\.0 -> 1\.3\.0/.test(r.out), "release-note lines below the declaration (VERSION-LINE-SPLIT-1) that quote the form do not change the reading", r); }
// What the guard enforced before still holds.
{ const r = guard(repo({ [W]: "var VERSION = \"1.2.0-a\";\nx\n" }, { [W]: "var VERSION = \"1.2.0-b\";\ny\n" }));
  ok(r.code === 1 && /VERSION-AHEAD-1/.test(r.out), "equal numeric cores with different suffixes are still a collision (VERSION-AHEAD-1)", r); }
{ const r = guard(repo({ [W]: "var VERSION = \"1.3.0\";\nx\n" }, { [W]: "var VERSION = \"1.2.9\";\ny\n" }));
  ok(r.code === 1 && /is behind the base/.test(r.out), "a VERSION that goes backwards is still refused", r); }
{ const r = guard(repo({ [W]: "var VERSION = \"1.3.0\";\nx\n" }, { [W]: "const VERSION = \"1.4.0\";\ny\n" }));
  ok(r.code === 1 && /NO VERSION CONSTANT/.test(r.out), "a bundle with no `var VERSION` declaration is still refused", r); }
{ const r = guard(repo({ [W]: "// only a comment: var VERSION = \"1.3.0\";\nx\n" }, { [W]: "// only a comment: var VERSION = \"1.4.0\";\ny\n" }));
  ok(r.code === 1 && /NO VERSION CONSTANT/.test(r.out), "a VERSION that exists only inside a comment is no VERSION constant", r); }
{ const r = guard(repo({ [W]: "var VERSION = \"1.2.0\";\nx\n" }, { [W]: "var VERSION = \"1.2.0\";\nx\n", "docs/readme.md": "hi\n" }));
  ok(r.code === 0 && /nothing to check/.test(r.out), "a range with no changed bundle has nothing to check", r); }
{ const r = guard(repo({ [W]: "var VERSION = \"1.2.0\";\nx" }, { [W]: "var VERSION = \"1.2.0\";\nx\n" }));
  ok(r.code === 0 && /PASS: 0 changed worker bundle/.test(r.out), "adding one optional terminal LF is not a worker bundle change", r); }

// Every worker bundle and mirror on this repository reads as before: the anchor must not blind the guard to a real declaration.
{ const py = [
    "import importlib.util, glob, os, re, sys, json",
    "spec = importlib.util.spec_from_file_location('vbg', sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)",
    "old = re.compile(r'var\\s+VERSION\\s*=\\s*\"([^\"]*)\"')",
    "n = 0; lost = []; changed = []",
    "for pat in ('worker.js', 'deployed-current.worker.js'):",
    "    for f in sorted(glob.glob(os.path.join(sys.argv[2], '*', pat))):",
    "        t = open(f, encoding='utf-8', errors='replace').read(); n += 1",
    "        o = old.search(t); a = m.version_of(t); rel = os.path.relpath(f, sys.argv[2])",
    "        if o is None: continue",
    "        if a is None: lost.append(rel); continue",
    "        at_line_start = t[:o.start()].rsplit('\\n', 1)[-1].strip() == ''",
    "        if at_line_start and a != o.group(1): changed.append([rel, o.group(1), a])",
    "print(json.dumps({'n': n, 'lost': lost, 'changed': changed}))",
  ].join("\n");
  const p = spawnSync(PY, ["-I", "-c", py, GUARD, root], { encoding: "utf8" });
  let j = {}; try { j = JSON.parse(p.stdout); } catch {}
  ok(p.status === 0 && j.n >= 100, "the replay read every worker bundle and mirror on this repository", { status: p.status, out: (p.stdout + p.stderr).slice(0, 300) });
  ok(Array.isArray(j.lost) && j.lost.length === 0, "no worker bundle or mirror that the unanchored guard could read has lost its VERSION to the anchor", j.lost);
  ok(Array.isArray(j.changed) && j.changed.length === 0, "no worker bundle or mirror whose declaration starts a line reads a different VERSION under the anchor", j.changed); }

// ---- the workflow's concurrency group (VERSION-BUMP-PUSH-SHA-1) ----
const wf = readFileSync(WF_PATH, "utf8").replace(/\r\n/g, "\n");
const m = /^concurrency:\n[ \t]+group: (.+)\n[ \t]+cancel-in-progress: (.+)\n/m.exec(wf);
ok(m !== null, "the workflow declares a concurrency group and cancel-in-progress");
if (m) {
  // Evaluate the ${{ }} expressions the workflow uses over a github context. They are boolean and string operators only.
  const evaluate = (text, github) => text.replace(/\$\{\{\s*([^}]+?)\s*\}\}/g, (_, e) => String(new Function("github", "return (" + e + ");")(github)));
  const ctx = (event, ref, sha) => ({ event_name: event, ref, sha });
  const gr = (c) => evaluate(m[1], c), cancel = (c) => evaluate(m[2], c).trim() === "true";
  const push1 = ctx("push", "refs/heads/main", "a".repeat(40)), push2 = ctx("push", "refs/heads/main", "b".repeat(40));
  // PUSH-COALESCE-1 (2026-11-04, #7001): a burst of merges queued one run per pushed sha, so a newer push to main now cancels the older run. This reverses
  // VERSION-BUMP-PUSH-SHA-1 on purpose; the cost is that a cancelled run's before..sha range is validated by nobody;
  // MAIN-GUARD-RANGE-FLOOR-1 (follow-up) widens a push's range to the last green run so the newest run covers it.
  ok(gr(push1) === gr(push2) && gr(push1).includes("main-push"), "two pushes to main share one group (PUSH-COALESCE-1), so only the newest main is guarded", [gr(push1), gr(push2)]);
  ok(cancel(push1) === true && cancel(push2) === true, "a newer push to main cancels the older guard run (PUSH-COALESCE-1)", [m[2]]);
  ok(gr(ctx("workflow_dispatch", "refs/heads/main", "c".repeat(40))) === gr(push1), "a dispatch on main joins the same main-push group");
  const b1 = ctx("push", "refs/heads/codeagent-x", "d".repeat(40)), b2 = ctx("push", "refs/heads/codeagent-x", "e".repeat(40));
  ok(gr(b1) === gr(b2) && cancel(b1) === true, "two pushes to one branch share a group and the newer cancels the older (CONCURRENCY-PER-REF-1 kept)", [gr(b1), gr(b2), m[2]]);
  const p1 = ctx("pull_request", "refs/pull/7/merge", "f".repeat(40)), p2 = ctx("pull_request", "refs/pull/7/merge", "0".repeat(40));
  ok(gr(p1) === gr(p2) && cancel(p1) === true, "two runs of one pull request share a group and the newer cancels the older", [gr(p1), gr(p2)]);
  const other = ctx("pull_request", "refs/pull/8/merge", "f".repeat(40));
  ok(new Set([gr(p1), gr(other), gr(b1), gr(push1)]).size === 4, "a pull request, another pull request, a branch and main are four groups, so none cancels another", [gr(p1), gr(other), gr(b1), gr(push1)]);
}
// THREE-PR-WORKFLOWS-1, then PR-CHECK-CAP-5-1: the pull_request trigger left this file; pr-checks.yml holds the guard's steps in its `versions` job (a `uses:` job is one check
// entry, so it no longer calls this file). The guard must still run on every pull request: its step is unconditional and the trigger keeps no `paths:` filter
// (INTEG-GITHUB-HARDEN-1): a check that never runs stays "Expected" for ever.
const checks = readFileSync(join(root, ".github", "workflows", "pr-checks.yml"), "utf8").replace(/\r\n/g, "\n");
const versionsJob = (checks.match(/\n  versions:\n([\s\S]*?)(?=\n  [a-z-]+:\n|$)/) || [])[1] || "";
const guardStep = (versionsJob.match(/- name: Version bump guard\n([\s\S]*?)(?=\n      - |$)/) || [])[1] || "";
ok(/^ {2}workflow_call:\s*$/m.test(wf) && !/^ {2}pull_request:/m.test(wf) && /python3 scripts\/version-bump-guard\.py/.test(guardStep) && /^\s+if: \$\{\{ !cancelled\(\) \}\}\s*$/m.test(guardStep) && /^on:\n {2}pull_request:\n {4}branches: \[main\]\n(?! {4}paths)/m.test(checks), "pr-checks runs the guard on every pull request into main: the step has no condition and the pull_request trigger has no paths filter (INTEG-GITHUB-HARDEN-1)");

// ---- MAIN-GUARD-RANGE-FLOOR-1: a push to main validates from the last green run, so a run PUSH-COALESCE-1 cancelled leaves no unvalidated range ----
{
  const floorAt = wf.indexOf("          # MAIN-GUARD-RANGE-FLOOR-1");
  const floorEnd = wf.indexOf('          echo "before=$BEFORE"', floorAt);
  ok(floorAt > 0 && floorEnd > floorAt, "the range step carries the MAIN-GUARD-RANGE-FLOOR-1 floor");
  if (floorAt > 0 && floorEnd > floorAt) {
    const snippet = wf.slice(floorAt, floorEnd).split("\n").map((l) => l.replace(/^ {10}/, "")).join("\n");
    const repo = mkdtempSync(join(tmpdir(), "vbg-floor-")); dirs.push(repo);
    git(repo, "init", "-q", "-b", "main");
    const shas = [];
    for (let i = 0; i < 4; i++) { writeFileSync(join(repo, "f.txt"), "c" + i + "\n"); git(repo, "add", "-A"); git(repo, "commit", "-q", "-m", "c" + i); shas.push(git(repo, "rev-parse", "HEAD").stdout.trim()); }
    git(repo, "checkout", "-q", "-b", "side", shas[0]); writeFileSync(join(repo, "g.txt"), "side\n"); git(repo, "add", "-A"); git(repo, "commit", "-q", "-m", "side");
    const sideSha = git(repo, "rev-parse", "HEAD").stdout.trim(); git(repo, "checkout", "-q", "main");
    const run = (event, ref, floor, before) => {
      const script = 'gh() { echo called >> "$GH_LOG"; if [ -n "${FAKE_FLOOR+x}" ]; then printf "%s" "$FAKE_FLOOR"; else return 1; fi; }\nset -euo pipefail\nBEFORE=' + before + "\nAFTER=" + shas[3] + "\n" + snippet + '\necho "RESULT=$BEFORE"';
      writeFileSync(join(repo, "gh.log"), "");
      const env = Object.assign({}, process.env, { GITHUB_EVENT_NAME: event, GITHUB_REF: ref, GITHUB_REPOSITORY: "QNFO/qnfo-workers", GH_LOG: join(repo, "gh.log").replaceAll(String.fromCharCode(92), "/") });
      delete env.FAKE_FLOOR; if (floor !== null) env.FAKE_FLOOR = floor;
      const r = spawnSync("bash", ["-c", script], { cwd: repo, encoding: "utf8", env });
      return { result: ((r.stdout.match(/RESULT=(\S*)/) || [])[1]) || null, called: readFileSync(join(repo, "gh.log"), "utf8").includes("called"), status: r.status, err: (r.stderr || "").slice(0, 200) };
    };
    const a = run("push", "refs/heads/main", shas[0], shas[2]);
    ok(a.status === 0 && a.result === shas[0], "a push to main starts at the last green run's head when that commit is an ancestor of before", a);
    const b = run("push", "refs/heads/main", null, shas[2]);
    ok(b.status === 0 && b.result === shas[2], "when the runs API fails the range stays event.before", b);
    const c = run("push", "refs/heads/main", sideSha, shas[2]);
    ok(c.status === 0 && c.result === shas[2], "a green run on a commit that is not an ancestor of before never moves the floor", c);
    const d = run("push", "refs/heads/main", "", shas[2]);
    ok(d.status === 0 && d.result === shas[2], "an empty answer (no green run yet) leaves the range alone", d);
    const e = run("push", "refs/heads/some-branch", shas[0], shas[2]);
    ok(e.status === 0 && e.result === shas[2] && e.called === false, "a push to another ref neither asks the API nor changes the range", e);
    const f = run("workflow_dispatch", "refs/heads/main", shas[0], shas[2]);
    ok(f.status === 0 && f.result === shas[2] && f.called === false, "a dispatch neither asks the API nor changes the range", f);
  }
  ok(/^ {8}env:\n {10}GH_TOKEN: \$\{\{ github\.token \}\}\n {8}run: \|\n {10}set -euo pipefail\n {10}BEFORE=/m.test(wf), "the range step hands the workflow token over through env for the runs API read (no new permission: the repository is public)");
}

for (const d of dirs) rmSync(d, { recursive: true, force: true });
console.log(fail ? fail + " failed, " + pass + " passed" : pass + " passed, 0 failed");
process.exit(fail ? 1 : 0);
