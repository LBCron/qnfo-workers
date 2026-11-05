// D1-LIKE-LIMIT-GUARD-1 offline suite. Run: node scripts/d1-like-limit-guard.test.mjs   -> prints "N passed, 0 failed"
// scripts/d1_like_limit_guard.py fails a change that ADDS a LIKE or GLOB pattern literal over 50 bytes (D1 refuses it). PAPER-LEARN-1 learning 5677:
// the same defect was fixed one file at a time (2026-10-13, then PRs 7277, 7281, 7282, 7283 on 2026-11-04); this guard is the sweep that stays.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + String(d).slice(0, 800))); } };

let py = null;
for (const cand of ["python3", "python"]) {
  const r = spawnSync(cand, ["--version"], { encoding: "utf8" });
  if (r.status === 0) { py = cand; break; }
}
ok(py !== null, "a python interpreter is available");
if (py) {
  const self = spawnSync(py, [join(here, "d1_like_limit_guard.py"), "--selftest"], { encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
  ok(self.status === 0 && /selftest ok/.test(self.stdout), "the guard's own selftest passes", self.stdout + self.stderr);
  // against an unreadable base the guard fails closed (exit 2), never green by accident
  const bad = spawnSync(py, [join(here, "d1_like_limit_guard.py"), "no-such-ref-for-the-like-guard"], { encoding: "utf8", cwd: join(here, "..") });
  ok(bad.status === 2 && /failing closed/.test(bad.stdout), "an unreadable base fails closed", bad.status + " " + bad.stdout);
  // against HEAD itself nothing is added, so the guard passes
  const same = spawnSync(py, [join(here, "d1_like_limit_guard.py"), "HEAD"], { encoding: "utf8", cwd: join(here, "..") });
  ok(same.status === 0 && /0 violation/.test(same.stdout), "a change that adds nothing passes", same.status + " " + same.stdout);
}
const src = readFileSync(join(here, "pr_fast_guards.py"), "utf8");
ok(/"d1-like-limit"/.test(src) && /d1_like_limit_guard\.py/.test(src), "pr_fast_guards.py runs the guard on a change to SQL, JS or Python files");
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
