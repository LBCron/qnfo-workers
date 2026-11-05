// PROBE-TRANSIENT-1 suite: runs scripts/remediation_consumer_transient_test.py, which executes the consumer's real consume_one against a fake d1 that raises the
// platform errors (HTTP 429, D1 overload) and proves a refused read is not a probe-error verdict. Run: node scripts/consumer-transient.test.mjs
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const py = process.platform === "win32" ? "python" : "python3";
const r = spawnSync(py, [join(here, "remediation_consumer_transient_test.py")], { encoding: "utf8" });
const out = (r.stdout || "") + (r.stderr || "");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 400) : "")); } };
ok(r.status === 0 && /all passed/.test(out) && !/^FAIL/m.test(out), "the transient test passes", out.slice(-600));
ok((out.match(/^ok /gm) || []).length >= 12, "the transient test covers the cases", (out.match(/^ok /gm) || []).length);
console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
