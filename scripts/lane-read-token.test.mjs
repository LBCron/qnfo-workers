// LANE-READ-TOKEN-1 suite: merge-when-ready.yml reads the pull request, its comments and its check runs with the workflow token and spends the shared PAT once, on the merge.
// The read helper falls back to the PAT when the workflow token is refused. Run: node scripts/lane-read-token.test.mjs   -> prints "N passed, 0 failed"
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 400) : "")); } };
const read = (p) => readFileSync(join(here, "..", p), "utf8").replace(/\r\n/g, "\n");

const lane = read(".github/workflows/pr-lane.yml");
const mwr = lane.slice(lane.indexOf("name: Merge the pull request when every fast check is green")); // the merge step

// wiring
ok(/READ_TOKEN: \$\{\{ github\.token \}\}/.test(mwr), "READ_TOKEN is the workflow token");
ok(/GH_TOKEN: \$\{\{ secrets\.QNFO_GH_PAT \}\}/.test(mwr), "GH_TOKEN stays the PAT (the merge needs it to start the push workflows)");
const reads = mwr.match(/\brd "repos\//g) || [];
ok(reads.length === 3, "the pull request, the comments and the check runs are read through rd", reads.length);
ok(!/(^|[^\w])gh api "repos\//m.test(mwr.split("run: |")[1] || ""), "no bare PAT read remains in the merge step");
ok(/gh pr merge "\$PR_NUMBER" --repo "\$GITHUB_REPOSITORY" --squash --delete-branch --match-head-commit "\$sha"/.test(mwr) && !/rd "?pr merge/.test(mwr), "the merge itself runs on the PAT");

ok(/\n  checks: read\n/.test(lane.split("jobs:")[0]), "pr-lane grants checks read (the check-run list needs it)");

// the helper, extracted from the workflow and run with a stub gh
const m = /\n(\s*rd\(\) \{[^\n]*\})\n/.exec(mwr);
ok(!!m, "the rd helper is defined once in the step");
if (m) {
  const dir = mkdtempSync(join(tmpdir(), "lrt-"));
  const stub = join(dir, "gh");
  writeFileSync(stub, ["#!/bin/bash", 'echo "$GH_TOKEN $*" >> "$LOG"', 'if [ "${FAIL_READ:-}" = 1 ] && [ "$GH_TOKEN" = "READ" ]; then echo "HTTP 403" >&2; exit 1; fi', 'echo "ok-by-$GH_TOKEN"', ""].join("\n"));
  chmodSync(stub, 0o755);
  const run = (env) => {
    const log = join(dir, "log-" + Math.random().toString(36).slice(2));
    const r = spawnSync("bash", ["-c", m[1].trim() + '\nrd "repos/o/r/pulls/5" --jq .x'], { encoding: "utf8", env: { ...process.env, PATH: dir + (process.platform === "win32" ? ";" : ":") + process.env.PATH, GH_TOKEN: "PAT", READ_TOKEN: "READ", LOG: log, ...env } });
    let calls = []; try { calls = readFileSync(log, "utf8").trim().split("\n"); } catch {}
    return { out: r.stdout.trim(), status: r.status, calls };
  };
  let r = run({});
  ok(r.out === "ok-by-READ" && r.calls.length === 1 && r.calls[0].startsWith("READ "), "a read is one call on the workflow token", r);
  r = run({ FAIL_READ: "1" });
  ok(r.out === "ok-by-PAT" && r.calls.length === 2 && r.calls[1].startsWith("PAT "), "a refused read falls back to the PAT", r);
  rmSync(dir, { recursive: true, force: true });
}

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);

