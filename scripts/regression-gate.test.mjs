// REGRESSION-GATE-1 suite: scripts/regression_gate.py lets a guard that fails the same way on the base tree pass with a warning, and blocks a
// failure the base does not have. Run: node scripts/regression-gate.test.mjs   -> prints "N passed, 0 failed"
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const gate = join(here, "regression_gate.py");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 400) : "")); } };
const PY = ["python3", "python"].find((p) => spawnSync(p, ["--version"], { encoding: "utf8" }).status === 0);
if (!PY) throw new Error("no python on PATH");

const dir = mkdtempSync(join(tmpdir(), "rg-test-"));
const sh = (args, cwd = dir, env = {}) => spawnSync(args[0], args.slice(1), { cwd, encoding: "utf8", env: { ...process.env, ...env } });
const git = (...a) => { const r = sh(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...a]); if (r.status !== 0) throw new Error("git " + a.join(" ") + ": " + r.stderr); return r.stdout.trim(); };
const put = (rel, text) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); };
const commit = (msg) => { git("add", "-A"); git("commit", "-q", "-m", msg); return git("rev-parse", "HEAD"); };
// the guard under test: prints one BROKEN line per cfg file that says "bad", then a summary count; exit 1 when any
put("check.py", [
  "import os, sys",
  "bad = sorted(f for f in os.listdir('cfg') if 'bad' in open(os.path.join('cfg', f)).read())",
  "for f in bad: print('BROKEN cfg/' + f + ': invalid')",
  "if bad: print('=== CHECK FAILED: %d invalid file(s) ===' % len(bad)); sys.exit(1)",
  "print('CHECK PASSED')",
  "",
].join("\n"));
const g = (extra = [], env = {}) => sh([PY, gate, "--name", "check", ...extra, "--", PY, "check.py"], dir, env);
const verdictOf = (r) => (/REGRESSION-GATE (\S+)/.exec(r.stdout) || [])[1];

git("init", "-q", "-b", "main");
put("cfg/a.txt", "good\n");
const clean = commit("clean base");

// 1. the command passes on the pull request
let r = g(["--base", clean]);
ok(r.status === 0 && verdictOf(r) === "pass", "a passing guard passes", { s: r.status, o: r.stdout });

// 2. the base is already broken (a.txt bad) and the pull request leaves it alone
put("cfg/a.txt", "bad\n");
const broken = commit("main breaks a.txt");
put("docs/readme.md", "unrelated change\n");
commit("pull request edits docs only");
r = g(["--base", broken]);
ok(r.status === 0 && verdictOf(r) === "pre-existing" && /::warning title=check::/.test(r.stdout), "a failure the base already has passes with a warning", { s: r.status, o: r.stdout });
ok(/pre-existing: BROKEN cfg\/a\.txt: invalid/.test(r.stdout), "the pre-existing failure line is shown", r.stdout);

// 3. the pull request adds a second broken file: the count line and a BROKEN line are new
put("cfg/b.txt", "bad\n");
commit("pull request breaks b.txt");
r = g(["--base", broken]);
ok(r.status === 1 && verdictOf(r) === "block" && /new: BROKEN cfg\/b\.txt/.test(r.stdout), "a new failure blocks and names it", { s: r.status, o: r.stdout });
ok(/new: === CHECK FAILED: 2 invalid file\(s\) ===/.test(r.stdout), "a changed count is a new failure line", r.stdout);

// 4. the base was clean and the pull request breaks a file
r = g(["--base", clean]);
ok(r.status === 1 && verdictOf(r) === "block", "a failure on a clean base blocks", { s: r.status, o: r.stdout });

// 5. a failure with no recognisable failure line fails closed
put("boom.py", "import sys\nprint('something odd')\nsys.exit(3)\n");
r = sh([PY, gate, "--name", "boom", "--base", clean, "--", PY, "boom.py"]);
ok(r.status === 3 && verdictOf(r) === "block" && /no recognisable failure line/.test(r.stdout), "no failure line blocks with the command's own exit code", { s: r.status, o: r.stdout });

// 6. REGRESSION_GATE=strict is the revert: the base's own failure blocks again
put("cfg/b.txt", "good\n");
commit("fix b.txt");
r = g(["--base", broken], { REGRESSION_GATE: "strict" });
ok(r.status === 1 && verdictOf(r) === "block" && /"reason": "strict"/.test(r.stdout), "strict mode never relaxes", { s: r.status, o: r.stdout });

// 7. an unresolvable base fails closed
r = g(["--base", "0000000000000000000000000000000000000001"]);
ok(r.status === 1 && verdictOf(r) === "block" && /"reason": "no-worktree"/.test(r.stdout), "an unresolvable base blocks", { s: r.status, o: r.stdout });

// 8. the default base of a merge commit is its first parent (the pull_request checkout)
git("checkout", "-q", "-b", "pr", broken);
put("docs/other.md", "pr side\n");
commit("pr side");
git("checkout", "-q", "main");
git("merge", "--no-ff", "-q", "-m", "merge of the pull request", "pr");
r = g();
ok(r.status === 0 && verdictOf(r) === "pre-existing", "a merge commit compares with its first parent by default", { s: r.status, o: r.stdout });

// 9. run-suites style output: only "FAIL <ms> <suite>" lines count, timings differ between runs, a count line moving is not a failure
git("checkout", "-q", "-b", "suites", clean);
put("runner.py", [
  "import os, sys",
  "t = open('timing.txt').read().strip()",
  "red = sorted(l.strip() for l in open('red.txt') if l.strip())",
  "for s in ['a.test.mjs', 'b.test.mjs', 'c.test.mjs']:",
  "    print(('FAIL ' if s in red else 'ok   ') + t.rjust(6) + ' ms  ' + s)",
  "print('SUITE-RUNNER-1: %d passed, %d failed' % (3 - len(red), len(red)))",
  "sys.exit(1 if red else 0)",
  "",
].join("\n"));
put("timing.txt", "219\n"); put("red.txt", "a.test.mjs\n");
const suitesBase = commit("suites base: a is red");
put("timing.txt", "1423\n"); put("red.txt", "a.test.mjs\n"); // same red suite, other timing; nothing else changed
commit("suites head: same red suite, slower");
const PAT = "^FAIL\\s+<t>\\s+\\S+$";
const sg = (extra = []) => sh([PY, gate, "--name", "suites", "--base", suitesBase, "--pattern", PAT, ...extra, "--", PY, "runner.py"]);
r = sg();
ok(r.status === 0 && verdictOf(r) === "pre-existing", "a suite red on the base stays pre-existing when only its timing and the count line differ", { s: r.status, o: r.stdout });
put("red.txt", "a.test.mjs\nc.test.mjs\n");
commit("suites head: c turns red");
r = sg();
ok(r.status === 1 && verdictOf(r) === "block" && /new: FAIL\s+<t>\s+c\.test\.mjs/.test(r.stdout) && !/new: .*a\.test\.mjs/.test(r.stdout), "a newly red suite blocks and names only it", { s: r.status, o: r.stdout });

// the wiring: both lint steps of pr-checks.yml go through the gate (a pull request only; the guard files keep the plain lint for push)
const read = (p) => readFileSync(join(here, "..", p), "utf8").replace(/\r\n/g, "\n");
const pc = read(".github/workflows/pr-checks.yml");
ok((pc.match(/regression_gate\.py --name workflow-lint -- python3 scripts\/workflow-lint\.py/g) || []).length === 2, "both workflow-lint steps of pr-checks.yml run through the regression gate");
ok(!/\n\s+run: python3 scripts\/workflow-lint\.py/.test(pc), "no plain workflow-lint step remains in pr-checks.yml");

rmSync(dir, { recursive: true, force: true });
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
