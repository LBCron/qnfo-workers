// FLEET-JOURNEYS-1 / CENSUS-EXTERNAL-HEARTBEAT-1: runs the offline selftest of scripts/fleet_journeys.py on every pull request that touches scripts/.
// The selftest carried no workflow hook, so a change to the journey runner (or its runner-attested heartbeat for workers qnfo-ops cannot probe) was only exercised by the live
// hourly run. Proves: every canned journey passes and fails where it should, the record/issue lifecycle holds, and external_heartbeat attests only the blind workers and the
// documented retired stub that the runner actually reached.
// Run: node scripts/fleet-journeys.test.mjs   (exit 0 = all passed; needs python3)
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const probe = spawnSync("python3", ["--version"], { encoding: "utf8" });
if (probe.status !== 0) {
  console.log("fleet-journeys: SKIP (python3 is not installed)");
  process.exit(0);
}
const r = spawnSync("python3", [join(here, "fleet_journeys.py"), "--selftest"], { encoding: "utf8", timeout: 120000, cwd: join(here, "..") });
let out = null;
try { out = JSON.parse((r.stdout || "").trim().split("\n").pop()); } catch (e) { out = null; }
// DASHBOARD-LOAD-1: the selftest also proves the dashboard-load journey (fleet.qnfo.org / and /api/managers, a North Star reliability input): 200 + body passes, a 500 or an empty body fails,
// and a slow-but-200 answer passes with journey_runs.ms recorded as the summed fetch time. checks >= 42 pins those six checks in; the registration is asserted below from the module itself.
const ok = r.status === 0 && out && out.selftest === "ok" && out.checks >= 42 && Array.isArray(out.failed) && out.failed.length === 0;
if (!ok) console.log("FAIL fleet_journeys.py --selftest :: " + ((r.stdout || "") + (r.stderr || "")).slice(-400));
const reg = spawnSync("python3", ["-c", "import json,sys; sys.path.insert(0, sys.argv[1]); import fleet_journeys as f; print(json.dumps({'names': [fn.__name__ for fn in f.JOURNEYS], 'dash': f.DASH}))", here],
  { encoding: "utf8", timeout: 60000, cwd: join(here, "..") });
let names = null;
try { names = JSON.parse((reg.stdout || "").trim().split("\n").pop()); } catch (e) { names = null; }
const registered = reg.status === 0 && names && names.names.includes("j_dashboard_load") && names.dash === "https://fleet.qnfo.org";
if (!registered) console.log("FAIL dashboard-load journey is not registered in JOURNEYS :: " + ((reg.stdout || "") + (reg.stderr || "")).slice(-300));
const passed = (ok ? 1 : 0) + (registered ? 1 : 0), failed = 2 - passed;
console.log("fleet-journeys: " + passed + " passed, " + failed + " failed" + (ok ? " (" + out.checks + " selftest checks)" : ""));
process.exit(failed === 0 ? 0 : 1);
