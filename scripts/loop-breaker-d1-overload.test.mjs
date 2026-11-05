// D1-OVERLOAD-REFILE-1 offline suite (2026-11-05, charter pillar autonomy; GitHub 6852, 6853, 6863, 6866, 6867, 6869, 6959, 6975, 7116, 7197).
//
// scripts/loop_breaker_runner.py filed one LOOP-BREAKER-1 issue per producer and message variant of the shared "D1 DB is overloaded" condition. The hourly fold
// (issue-meta-fold, rule d1-overload-superseded) closed them as superseded by the umbrella issue; the next runner pass filed each title again and
// issue_refile_reopen reopened it. The runner's own --selftest models that trigger and proves it counts the signature instead of filing it while the umbrella
// is open (and files it when there is none). That selftest ran only inside the hourly remediation-consumer workflow; this suite puts it, and the bridge's
// umbrella-probe suite, in the PR gate.
// Run: node scripts/loop-breaker-d1-overload.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + String(d).slice(0, 1200))); } };

const runner = readFileSync(join(here, "loop_breaker_runner.py"), "utf8");
ok(/def is_d1_overload\(/.test(runner) && /D1_OVERLOAD_MARK = "db is overloaded"/.test(runner), "the runner recognises the digit-stripped overload text");
ok(/UMBRELLA_TITLE = "CF-OBS-ISSUE-1: fleet: D1 DB is overloaded, all workers \[cf-obs:d1-overload\]"/.test(runner), "the runner names the umbrella by the bridge's exact title");
const bridge = readFileSync(join(here, "cf_obs_issue_bridge.py"), "utf8");
ok(bridge.includes('UMBRELLA_ID = "d1-overload"') && bridge.includes('UMBRELLA_TITLE = PREFIX + "fleet: D1 DB is overloaded, all workers [cf-obs:" + UMBRELLA_ID + "]"'), "the bridge builds the same umbrella title");

let py = null;
for (const cand of ["python3", "python"]) {
  const r = spawnSync(cand, ["--version"], { encoding: "utf8" });
  if (r.status === 0) { py = cand; break; }
}
ok(py !== null, "a python interpreter is available");
if (py) {
  const env = { ...process.env, CLOUDFLARE_API_TOKEN: "", CF_API_TOKEN: "", GITHUB_TOKEN: "", GH_TOKEN: "" };
  const a = spawnSync(py, [join(here, "loop_breaker_runner.py"), "--selftest"], { encoding: "utf8", timeout: 180000, env });
  ok(a.status === 0, "loop_breaker_runner.py --selftest exits 0", (a.stdout || "") + (a.stderr || ""));
  ok(/d1-overload selftest ok/.test(a.stdout || ""), "the d1-overload cases ran", a.stdout);
  const b = spawnSync(py, [join(here, "cf_obs_issue_bridge_test.py")], { encoding: "utf8", timeout: 180000, env });
  ok(b.status === 0, "cf_obs_issue_bridge_test.py exits 0", (b.stdout || "") + (b.stderr || ""));
  ok(/test_umbrella_probe_survives_the_family_triggers/.test(b.stdout || ""), "the umbrella-probe case ran", b.stdout);
}

console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
