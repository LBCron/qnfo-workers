// LEDGER-RETRY-1 offline suite (.github/workflows/deploy-code-orchestrator.yml, deploy-qnfo-agents.yml). On 2026-11-04 a deploy of qnfo-code-orchestrator succeeded and then the job failed because the
// guard-ledger write to D1 answered HTTP 429 (overloaded); the failed step skipped the health gate and the canary revert that follow it (#7151). The write now retries on 429 and 5xx. This suite
// extracts the real shell block from each workflow, replaces curl, sleep and jq with scripted stand-ins and runs it under bash.
// Run: node --no-warnings scripts/deploy-ledger-retry.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 300) : "")); } };
const dir = mkdtempSync(join(tmpdir(), "ledger-retry-"));

function block(file) {
  const lines = readFileSync(join(root, ".github/workflows", file), "utf8").replace(/\r\n/g, "\n").split("\n");
  const a = lines.findIndex((l) => /^\s*code=""\s*$/.test(l));
  const b = lines.findIndex((l, i) => i > a && /guard ledger write failed/.test(l));
  return a >= 0 && b > a ? lines.slice(a, b + 1).join("\n") : "";
}

function run(file, codes) {
  const b = block(file);
  const tag = Math.random().toString(36).slice(2);
  const posix = (p) => p.replace(/\\/g, "/");
  const counter = posix(join(dir, "n-" + tag)), codesFile = posix(join(dir, "c-" + tag));
  writeFileSync(counter, "0");
  writeFileSync(codesFile, codes.join("\n") + "\n");
  const script = [
    "set -uo pipefail",
    "CLOUDFLARE_API_TOKEN=t; CLOUDFLARE_ACCOUNT_ID=a; dbid=d; body='{}'",
    // the stand-in for curl answers the n-th scripted status code, and the last one for every call after the script ends
    'curl() { n=$(cat "' + counter + '"); n=$((n+1)); echo $n > "' + counter + '"; c=$(sed -n "${n}p" "' + codesFile + '"); [ -z "$c" ] && c=$(tail -n 1 "' + codesFile + '"); echo -n "$c"; }',
    "sleep() { :; }",
    "jq() { echo true; }",
    "(", b, ")", // the block ends in exit 1 on failure; a subshell keeps the harness alive to report the try count
    'rc=$?; echo "done rc=$rc n=$(cat "' + counter + '")"'
  ].join("\n");
  const f = join(dir, "s.sh");
  writeFileSync(f, script);
  const r = spawnSync("bash", [f], { encoding: "utf8" });
  const m = /done rc=(\d+) n=(\d+)/.exec(r.stdout) || [];
  return { status: m[1] === undefined ? -1 : Number(m[1]), tries: m[2] === undefined ? -1 : Number(m[2]), out: r.stdout + r.stderr };
}

for (const file of ["deploy-code-orchestrator.yml", "deploy-qnfo-agents.yml"]) {
  const b = block(file);
  ok(b.length > 0, file + ": the ledger write block is found in the workflow");
  ok(b.length > 0 && /for try in 1 2 3 4/.test(b) && /429\|500\|502\|503\|504/.test(b), file + ": the retry loop is in the workflow");
  let r = run(file, [200]);
  ok(r.status === 0 && r.tries === 1, file + ": 200 on the first try writes once and passes", r);
  r = run(file, [429, 200]);
  ok(r.status === 0 && r.tries === 2, file + ": 429 then 200 passes after one retry", r);
  r = run(file, [429, 503, 502, 200]);
  ok(r.status === 0 && r.tries === 4, file + ": three refusals then 200 passes on the fourth try", r);
  r = run(file, [429, 429, 429, 429]);
  ok(r.status === 1 && r.tries === 4 && /guard ledger write failed/.test(r.out), file + ": four 429 in a row still fails the step, after exactly four tries", r);
  r = run(file, [403]);
  ok(r.status === 1 && r.tries === 1, file + ": a 403 is not retried", r);
  r = run(file, [400]);
  ok(r.status === 1 && r.tries === 1, file + ": a 400 is not retried", r);
}
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
