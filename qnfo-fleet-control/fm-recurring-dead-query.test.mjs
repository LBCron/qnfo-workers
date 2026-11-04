// FM-RECURRING-DEAD-QUERY-1 (#7051): chaosDrill ran a failure_modes_recurring query that named the table issue_assignments, which does not exist in qnfo-audit
// (the table is doer_assignments, with other columns), and columns that remediation_verifications and v_failure_mode_status do not have (failure_mode_id, owner, id). It threw on every
// drill and filed CF-OBS-ISSUE-1 each time; the metric already has its own refresher on the fleet_tick. This suite keeps the dead reference out of both copies of the worker.
// Output MUST contain "0 failed" on success.   node qnfo-fleet-control/fm-recurring-dead-query.test.mjs
import { readFileSync } from "node:fs";
const here = (p) => new URL(p, import.meta.url);
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 300))); } };
const code = (src) => src.split("\n").filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join("\n");
for (const file of ["./worker.js", "./deployed-current.worker.js"]) {
  const src = readFileSync(here(file), "utf8");
  const exec = code(src);
  ok(!/issue_assignments/.test(exec), file + ": no executable reference to the missing table issue_assignments");
  ok(!/rv\.failure_mode_id|ia\.failure_mode_id/.test(exec), file + ": no query on failure_mode_id columns that do not exist");
  ok(!/step: "failure-modes-metric"/.test(exec), file + ": the dead failure-modes-metric step is gone");
  ok(/WHERE metric = 'spof_alternates_untested_24h'/.test(exec) && /step: "chaos-drill-state"/.test(exec), file + ": the neighbouring chaosDrill steps are intact");
  const v = /var VERSION = "(\d+)\.(\d+)\.(\d+)/.exec(src);
  ok(v && (Number(v[1]) > 0 || Number(v[2]) > 62 || (Number(v[2]) === 62 && Number(v[3]) >= 6)), file + ": VERSION is at least 0.62.6", v && v[0]);
}
ok(readFileSync(here("./worker.js"), "utf8") === readFileSync(here("./deployed-current.worker.js"), "utf8"), "worker.js and deployed-current.worker.js are identical");
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
