// scripts/version-bump-guard.test.mjs -- PR-GUARD-FIXES-1 (agent_issues 100295, charter pillar autonomy). Offline regression suite for the
// version-bump guard:
//   1. VERSION-RE-ANCHOR-1: scripts/version-bump-guard.py read the first `var VERSION = "..."` anywhere in a bundle, comments included.
//      qnfo-model-eval/worker.js line 50 quoted the form in a comment, so the guard read the placeholder "..." on both sides of two real bumps
//      (1.2.0 -> 1.3.0, 1.3.0 -> 1.4.0) and reported "unchanged VERSION after a byte change" (push runs 39126065745 and 39126418865, PR runs
//      39125992400 and 39126349048). The suite builds throw-away repositories (a base commit and a head commit) and runs the real script over them.
//   2. VERSION-BUMP-PUSH-SHA-1: .github/workflows/version-bump-guard.yml cancelled the run of an earlier push to main when a later one arrived
//      (group per ref, cancel-in-progress true): 35 of 277 push-to-main runs from 2026-10-18, so the commits of a burst were never validated.
//      The suite evaluates the workflow's own concurrency expressions for push, pull_request and dispatch contexts.
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
  ok(gr(push1) !== gr(push2), "two pushes to main fall in different groups, so one never waits behind or cancels the other", [gr(push1), gr(push2)]);
  ok(cancel(push1) === false && cancel(push2) === false, "a push to main is never cancelled", [m[2]]);
  ok(gr(ctx("workflow_dispatch", "refs/heads/main", "c".repeat(40))).includes("c".repeat(40)), "a dispatch on main has its own sha group too");
  const b1 = ctx("push", "refs/heads/codeagent-x", "d".repeat(40)), b2 = ctx("push", "refs/heads/codeagent-x", "e".repeat(40));
  ok(gr(b1) === gr(b2) && cancel(b1) === true, "two pushes to one branch share a group and the newer cancels the older (CONCURRENCY-PER-REF-1 kept)", [gr(b1), gr(b2), m[2]]);
  const p1 = ctx("pull_request", "refs/pull/7/merge", "f".repeat(40)), p2 = ctx("pull_request", "refs/pull/7/merge", "0".repeat(40));
  ok(gr(p1) === gr(p2) && cancel(p1) === true, "two runs of one pull request share a group and the newer cancels the older", [gr(p1), gr(p2)]);
  const other = ctx("pull_request", "refs/pull/8/merge", "f".repeat(40));
  ok(new Set([gr(p1), gr(other), gr(b1), gr(push1)]).size === 4, "a pull request, another pull request, a branch and main are four groups, so none cancels another", [gr(p1), gr(other), gr(b1), gr(push1)]);
}
ok(/^ {2}pull_request:\s*$/m.test(wf) && !/^ {2}pull_request:\n[ \t]+paths:/m.test(wf), "the pull_request trigger still has no paths filter (INTEG-GITHUB-HARDEN-1: the guard job is a required check)");

for (const d of dirs) rmSync(d, { recursive: true, force: true });
console.log(fail ? fail + " failed, " + pass + " passed" : pass + " passed, 0 failed");
process.exit(fail ? 1 : 0);
