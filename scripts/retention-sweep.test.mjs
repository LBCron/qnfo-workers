// BP26-RETENTION-SWEEP-1: runs the offline suites of the retention sweep (scripts/retention_sweep.py) and of the continuity snapshot that carries it, so the
// suite runner picks them up without a workflow edit. The sweep is dormant until ops_config.retention_enforce is on; these checks pin that it changes nothing before.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
let py = null;
for (const cand of ["python3", "python"]) {
  const r = spawnSync(cand, ["--version"], { encoding: "utf8" });
  if (r.status === 0) { py = cand; break; }
}
if (!py) { console.log("FAIL no python interpreter"); process.exit(1); }
let bad = 0;
for (const [file, marker] of [["retention_sweep.py", /retention_sweep selftest ok/], ["continuity_snapshot.py", /cold_tier selftest ok/]]) {
  const r = spawnSync(py, ["-I", join(here, file), "--selftest"], { encoding: "utf8", timeout: 240000 });
  const out = (r.stdout || "") + (r.stderr || "");
  const ok = r.status === 0 && marker.test(out) && !/FAIL /.test(out);
  console.log((ok ? "ok   " : "FAIL ") + file + " --selftest");
  if (!ok) { bad++; console.log(out.trim().split("\n").slice(-8).join("\n")); }
}
process.exit(bad ? 1 : 0);
