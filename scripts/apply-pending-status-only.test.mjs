// STATUS-ONLY-PR-1 offline suite (2026-11-05, metric pr_open_over_10m): the commit-back step of .github/workflows/apply-pending-patches.yml must not
// open a code pull request for ci-status/ artifacts. Measured 2026-11-04: fleet-bot/apply-pending-patches was over 10 minutes in 2 of 2 pull requests of
// 48 hours (PR 7285: one file, ci-status/apply-pending-report.json, CONFLICTING for 25 minutes, CONFLICT-REPAIR-DOER-1 refused it six times). The step
// "Commit the status artifact" publishes ci-status/ to fleet-artifacts without a pull request, so the code commit leaves it out.
// The test runs the real `run:` block of the step in a scratch repository with a stub scripts/push_head.sh and reads what the step committed.
// Run: node --no-warnings scripts/apply-pending-status-only.test.mjs  -> prints "N passed, 0 failed"
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };

// WORKFLOW_FILE lets the mutation check run the suite against the workflow as it was before this change (git show <base>:path > file).
const text = readFileSync(process.env.WORKFLOW_FILE || join(root, ".github", "workflows", "apply-pending-patches.yml"), "utf8").replace(/\r\n/g, "\n");
const steps = text.split(/\n      - (?=name:|id:|uses:|run:)/).slice(1);
const step = steps.find((s) => /^name: "Commit landed patches/m.test(s));
ok(!!step, "the commit-back step exists");
const runAt = step.indexOf("run: |\n");
ok(runAt > 0, "the step has a run block");
const script = step.slice(runAt + "run: |\n".length).split("\n").map((l) => l.replace(/^          /, "")).join("\n");

function sh(cwd, args, env) { return spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...(env || {}) } }); }
function scratch(label, files) {
  const dir = mkdtempSync(join(tmpdir(), "status-only-" + label + "-"));
  const run = (...a) => { const r = sh(dir, a); if (r.status !== 0) throw new Error("git " + a.join(" ") + ": " + r.stderr); return r.stdout; };
  run("init", "-q", "-b", "main");
  run("config", "user.email", "t@example.org");
  run("config", "user.name", "t");
  for (const [p, c] of Object.entries(files.base)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), c); }
  mkdirSync(join(dir, "scripts"), { recursive: true });
  // stub: records its arguments and the files of HEAD
  writeFileSync(join(dir, "scripts", "push_head.sh"), '#!/usr/bin/env bash\necho "$@" >> "$PWD/.push-calls"\ngit show --name-only --pretty=format: HEAD >> "$PWD/.push-files"\nexit 0\n');
  run("add", "-A");
  run("commit", "-q", "-m", "base");
  for (const [p, c] of Object.entries(files.work)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), c); }
  return { dir, run };
}
function runStep(dir) {
  return spawnSync("bash", ["-c", script], { cwd: dir, encoding: "utf8", env: { ...process.env, GH_TOKEN: "x" }, timeout: 60000 });
}

// 1. only a status report changed: no commit, no push, the report stays in the work tree for the artifact step.
{
  const t = scratch("status", { base: { "ci-status/apply-pending-report.json": '{"ts":"a"}\n', "qnfo-ops/worker.js": "var VERSION = '1';\n" }, work: { "ci-status/apply-pending-report.json": '{"ts":"b"}\n' } });
  const r = runStep(t.dir);
  ok(r.status === 0, "a status-only change exits 0", r.stderr);
  ok(/nothing to commit/.test(r.stdout), "a status-only change reports nothing to commit", r.stdout);
  ok(!existsSync(join(t.dir, ".push-calls")), "a status-only change never calls push_head.sh code");
  ok(t.run("rev-list", "--count", "HEAD").trim() === "1", "a status-only change adds no commit");
  ok(readFileSync(join(t.dir, "ci-status", "apply-pending-report.json"), "utf8").includes('"b"'), "the new report is still in the work tree for the artifact step");
  ok(/ci-status\/apply-pending-report\.json/.test(t.run("status", "--porcelain")), "the report is left modified and unstaged");
  rmSync(t.dir, { recursive: true, force: true });
}

// 2. a landed patch plus a status report: the code commit holds the patch only.
{
  const t = scratch("both", { base: { "ci-status/apply-pending-report.json": '{"ts":"a"}\n', "qnfo-ops/worker.js": "var VERSION = '1';\n" }, work: { "ci-status/apply-pending-report.json": '{"ts":"b"}\n', "qnfo-ops/worker.js": "var VERSION = '2';\n" } });
  const r = runStep(t.dir);
  ok(r.status === 0, "a landed patch exits 0", r.stderr);
  ok(existsSync(join(t.dir, ".push-calls")) && /code fleet-bot\/apply-pending-patches/.test(readFileSync(join(t.dir, ".push-calls"), "utf8")), "a landed patch is pushed as a code pull request");
  const files = existsSync(join(t.dir, ".push-files")) ? readFileSync(join(t.dir, ".push-files"), "utf8").split("\n").map((x) => x.trim()).filter(Boolean) : [];
  ok(files.includes("qnfo-ops/worker.js"), "the code commit carries the landed patch", files);
  ok(!files.some((f) => f.startsWith("ci-status/")), "the code commit carries no ci-status artifact", files);
  ok(/ci-status\/apply-pending-report\.json/.test(t.run("status", "--porcelain")), "the report is left for the artifact step", t.run("status", "--porcelain"));
  rmSync(t.dir, { recursive: true, force: true });
}

// 3. the artifact step still stages ci-status/ (it is the only path that publishes it).
{
  const art = steps.find((s) => /^name: "Commit the status artifact"/m.test(s)) || "";
  ok(/git add ci-status\//.test(art) && /push_head\.sh artifact/.test(art), "the status artifact step still stages ci-status/ and publishes it with push_head.sh artifact");
}

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
