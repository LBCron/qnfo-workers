// Runs the offline QWAV golden-value cross-check so demo formula regressions fail the scripts suite.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const python = ["python3", "python"].find((candidate) => {
  const result = spawnSync(candidate, ["-c", "import sys; print(sys.version_info[0])"], { encoding: "utf8" });
  return result.status === 0 && String(result.stdout).trim() === "3";
});

if (!python) {
  console.error("qwav-golden-crosscheck: Python 3 is required");
  process.exit(1);
}

const result = spawnSync(python, [join(here, "qwav_golden_crosscheck.py"), "--selftest"], {
  encoding: "utf8",
  timeout: 120000,
  cwd: join(here, ".."),
});
const output = String(result.stdout || "") + String(result.stderr || "");
if (result.status !== 0 || !/qwav_golden_crosscheck selftest ok/.test(output)) {
  console.error("qwav-golden-crosscheck: FAIL\n" + output);
  process.exit(1);
}

// The coverage line of the document is the script's own: it cannot say "yes" while a published demo repository has no check, and every repository is listed.
const cov = spawnSync(python, [join(here, "qwav_golden_crosscheck.py"), "--coverage"], { encoding: "utf8", timeout: 60000, cwd: join(here, "..") });
const lines = String(cov.stdout || "").split(/\r?\n/);
const doc = readFileSync(join(here, "..", "docs", "QWAV-CROSS-SIMULATOR.md"), "utf8");
if (cov.status !== 0 || !/^All published demos covered: (yes|no)$/.test(lines[0])) {
  console.error("qwav-golden-crosscheck: --coverage printed no verdict\n" + cov.stdout + cov.stderr);
  process.exit(1);
}
if (!doc.split(/\r?\n/).includes(lines[0])) {
  console.error("qwav-golden-crosscheck: docs/QWAV-CROSS-SIMULATOR.md must carry the line \"" + lines[0] + "\"");
  process.exit(1);
}
const repos = [...lines.slice(1).join(",").matchAll(/qwav-demo[a-z-]*/g)].map((m) => m[0]);
const missing = repos.filter((repo) => !doc.includes("| " + repo + " "));
if (repos.length < 8 || missing.length) {
  console.error("qwav-golden-crosscheck: docs/QWAV-CROSS-SIMULATOR.md has no table row for " + (missing.join(", ") || "any repository"));
  process.exit(1);
}

console.log("qwav-golden-crosscheck: PASS");
