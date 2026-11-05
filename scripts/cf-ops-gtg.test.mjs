// GTG-TAG-1: runs the offline Python suite of the gtg-tag action of scripts/cf_ops_actions.py (so the suite runner picks it up without a workflow edit).
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
const r = spawnSync(py, [join(here, "cf_ops_gtg_test.py")], { encoding: "utf8", timeout: 60000 });
const out = (r.stdout || "") + (r.stderr || "");
console.log(out.trim().split("\n").slice(-6).join("\n"));
process.exit(r.status === 0 && /0 failed/.test(out) ? 0 : 1);
