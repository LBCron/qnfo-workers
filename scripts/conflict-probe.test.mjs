// CONFLICT-PROBE-GIT-1 suite: scripts/conflict_probe.py tells which open pull requests conflict with main or change a worker.js, from git alone
// (one REST call for the list). Run: node scripts/conflict-probe.test.mjs   -> prints "N passed, 0 failed"
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 500) : "")); } };
const PY = ["python3", "python"].find((p) => spawnSync(p, ["--version"], { encoding: "utf8" }).status === 0);
if (!PY) throw new Error("no python on PATH");

const root = mkdtempSync(join(tmpdir(), "cp-test-"));
const origin = join(root, "origin"), clone = join(root, "clone"), bin = join(root, "bin");
mkdirSync(origin); mkdirSync(bin);
const sh = (args, cwd, env = {}) => spawnSync(args[0], args.slice(1), { cwd, encoding: "utf8", env: { ...process.env, ...env } });
const git = (cwd, ...a) => { const r = sh(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...a], cwd); if (r.status !== 0) throw new Error("git " + a.join(" ") + ": " + r.stderr); return r.stdout.trim(); };
const put = (cwd, rel, text) => { mkdirSync(dirname(join(cwd, rel)), { recursive: true }); writeFileSync(join(cwd, rel), text); };
const commit = (cwd, msg) => { git(cwd, "add", "-A"); git(cwd, "commit", "-q", "-m", msg); };

git(origin, "init", "-q", "-b", "main");
put(origin, "w/worker.js", 'var VERSION = "1.0.0";\nexport default {};\n');
put(origin, "notes.md", "one\n");
commit(origin, "base");
const baseSha = git(origin, "rev-parse", "HEAD");
const pr = (n, files, msg) => { // a pull request head cut from the base
  git(origin, "checkout", "-q", "-b", "pr" + n, baseSha);
  for (const [f, t] of Object.entries(files)) put(origin, f, t);
  commit(origin, msg);
  git(origin, "update-ref", "refs/pull/" + n + "/head", "HEAD");
  git(origin, "checkout", "-q", "main");
};
pr(1, { "w/worker.js": 'var VERSION = "1.0.1";\nexport default {};\n' }, "pr1 bumps the version line");        // conflicts once main bumps it too
pr(2, { "notes.md": "one\ntwo\n" }, "pr2 edits a note");                                                          // clean
pr(3, { "w/worker.js": 'var VERSION = "1.0.0";\nexport default {};\n// extra\n' }, "pr3 appends to the worker");  // clean merge, touches a worker.js
// pr 4 has no head ref at all (the fetch cannot find it)
put(origin, "w/worker.js", 'var VERSION = "1.0.2";\nexport default {};\n');
commit(origin, "main bumps the version line");

git(root, "clone", "-q", origin, clone);
const prsFile = join(bin, "pages.json");
const list = [
  [{ number: 1, title: "A", head: { ref: "pr1" } }, { number: 2, title: "B", head: { ref: "pr2" } }],
  [{ number: 3, title: "C", head: { ref: "pr3" } }, { number: 4, title: "D", head: { ref: "pr4" } },
   { number: 5, title: "WIP: not ready", head: { ref: "pr5" } }, { number: 6, title: "E", head: { ref: "repair/pr-6-abc" } }],
];
writeFileSync(prsFile, list.map((p) => JSON.stringify(p)).join("\n")); // two pages back to back, as gh api --paginate prints them
const out = join(root, "gh_output.txt");
const r = sh([PY, join(here, "conflict_probe.py"), "--base", "origin/main", "--repo", "o/r", "--github-output", out, "--prs-file", prsFile], clone);
let res = {}; try { res = JSON.parse(r.stdout.trim().split("\n").pop()); } catch { /* reported below */ }
ok(r.status === 0, "the probe exits 0", { s: r.status, e: r.stderr, o: r.stdout });
ok(JSON.stringify(res.conflict) === "[1]", "pull request 1 conflicts with main (both bump the VERSION line)", res);
ok(JSON.stringify(res.worker) === "[3]", "pull request 3 merges cleanly but changes a worker.js (the doer normalises its VERSION)", res);
ok(JSON.stringify(res.unknown) === "[4]", "pull request 4, whose head cannot be fetched, counts as dirty (the doer decides)", res);
ok(res.dirty === 3 && res.open_eligible === 4, "dirty counts conflict + worker + unknown; WIP and repair/ pull requests are not eligible", res);
ok(res.rest_calls === 1, "the probe reports one REST call", res);
ok(readFileSync(out, "utf8").trim().split(/\r?\n/).join(",") === "dirty=2,unknown=1", "dirty= (certain) and unknown= are written to the GitHub output file for the workflow to add", readFileSync(out, "utf8"));
ok(readFileSync(join(here, "..", ".github", "workflows", "conflict-repair.yml"), "utf8").includes("dirty=$((dirty+unknown))"), "the workflow adds the unknown count to dirty (fm-conflict-probe-skips-unknown)");
// the workflow: the probe is the script, the checkout comes first, and no per-pull-request REST read remains
const wf = readFileSync(join(here, "..", ".github", "workflows", "conflict-repair.yml"), "utf8").replace(/\r\n/g, "\n");
ok(/python3 scripts\/conflict_probe\.py/.test(wf), "conflict-repair.yml probes with scripts/conflict_probe.py");
ok(!/pulls\/\$n/.test(wf), "no per-pull-request REST read remains in the workflow");
ok(wf.indexOf("uses: actions/checkout") < wf.indexOf("python3 scripts/conflict_probe.py"), "the checkout precedes the probe");

rmSync(root, { recursive: true, force: true });
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
