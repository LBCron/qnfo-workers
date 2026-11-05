// TT-DRILL-RECUR-1: runs the offline selftest of scripts/d1_timetravel_drill_due.py (due and retry rules, a fake Cloudflare client, no network) in the scripts suite,
// and pins that the remediation consumer's heavy job runs the step, never fails the job on it, and keeps it ahead of the heavy stamp.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const python = ["python3", "python"].find((c) => {
  const r = spawnSync(c, ["-c", "import sys; print(sys.version_info[0])"], { encoding: "utf8" });
  return r.status === 0 && String(r.stdout).trim() === "3";
});
if (!python) { console.error("d1_timetravel_drill_due: Python 3 is required"); process.exit(1); }
const r = spawnSync(python, [join(here, "d1_timetravel_drill_due.py"), "--selftest"], { encoding: "utf8", timeout: 60000, cwd: join(here, "..") });
const out = String(r.stdout || "") + String(r.stderr || "");
if (r.status !== 0 || !/d1_timetravel_drill_due selftest ok/.test(out)) { console.error("d1_timetravel_drill_due: FAIL\n" + out); process.exit(1); }

const wf = readFileSync(join(here, "..", ".github", "workflows", "remediation-consumer.yml"), "utf8").replace(/\r\n/g, "\n");
const heavy = wf.slice(wf.indexOf("\n  heavy:\n"));
const step = heavy.indexOf("- name: Time Travel restore drill when due");
const stamp = heavy.indexOf("- name: Stamp the heavy run");
if (step < 0 || stamp < 0 || step > stamp) { console.error("d1_timetravel_drill_due: the heavy job must run the step before the heavy stamp"); process.exit(1); }
const block = heavy.slice(step, stamp);
if (!/continue-on-error: true/.test(block) || !/python3 scripts\/d1_timetravel_drill_due\.py --selftest && python3 scripts\/d1_timetravel_drill_due\.py/.test(block)) {
  console.error("d1_timetravel_drill_due: the step must never fail the job and must run the script after its selftest");
  process.exit(1);
}
console.log("d1_timetravel_drill_due: PASS");
