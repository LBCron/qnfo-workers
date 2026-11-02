// Runs the offline QWAV golden-value cross-check so demo formula regressions fail the scripts suite.
import { spawnSync } from "node:child_process";
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

console.log("qwav-golden-crosscheck: PASS");
