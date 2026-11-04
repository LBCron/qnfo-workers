// GH-BUDGET-FLOOR-1 offline suite (scripts/gh-budget-floor.mjs). Mocked fetch, no network.
// Run: node --no-warnings scripts/gh-budget-floor.test.mjs   -> prints "N passed, 0 failed"
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkBudget, resolveFloor, yieldLine, DEFAULT_FLOOR, YIELD_EXIT } from "./gh-budget-floor.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 400) : "")); } };
const RESET = 1762276860;
const mk = (rem, status) => { const log = []; return { log, fetchImpl: async (u, init) => { log.push({ u: String(u), auth: init.headers.authorization }); return { ok: (status || 200) < 300, status: status || 200, json: async () => ({ resources: { core: { limit: 5000, remaining: rem, reset: RESET } } }) }; } }; };

{
  const m = mk(3000);
  const r = await checkBudget({ token: "tok", cls: "sweep", floor: 600, fetchImpl: m.fetchImpl });
  ok(r.yield === false && r.remaining === 3000 && r.limit === 5000 && r.floor === 600, "above the floor proceeds", r);
  ok(m.log.length === 1 && /\/rate_limit$/.test(m.log[0].u) && m.log[0].auth === "Bearer tok", "one /rate_limit read, with the token the caller will spend", m.log);
}
{
  const r = await checkBudget({ token: "tok", cls: "sweep", floor: 600, fetchImpl: mk(599).fetchImpl });
  ok(r.yield === true && r.reset === new Date(RESET * 1000).toISOString(), "below the floor yields and reports the reset time", r);
  ok((await checkBudget({ token: "tok", cls: "sweep", floor: 600, fetchImpl: mk(600).fetchImpl })).yield === false, "exactly at the floor proceeds");
  ok((await checkBudget({ token: "tok", cls: "sweep", floor: 600, fetchImpl: mk(0).fetchImpl })).yield === true, "0 remaining yields");
}
{
  const m = mk(0);
  const r = await checkBudget({ token: "tok", cls: "lane", floor: 600, fetchImpl: m.fetchImpl });
  ok(r.yield === false && r.floor === 0 && m.log.length === 0, "the lane class never yields and spends no probe", r);
}
{
  const bad = [
    await checkBudget({ token: "t", cls: "sweep", floor: 600, fetchImpl: mk(0, 500).fetchImpl }),
    await checkBudget({ token: "t", cls: "sweep", floor: 600, fetchImpl: async () => { throw new Error("dns"); } }),
    await checkBudget({ token: "t", cls: "sweep", floor: 600, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) }) }),
    await checkBudget({ token: "t", cls: "sweep", floor: 600, fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new Error("bad json"); } }) }),
    await checkBudget({ token: "", cls: "sweep", floor: 600, fetchImpl: mk(0).fetchImpl })
  ];
  ok(bad.every((r) => r.yield === false), "an erroring, malformed or unreachable probe, or no token, proceeds", bad);
  ok(bad[0].probe === "error-http-500" && /^error-/.test(bad[1].probe) && bad[2].probe === "error-shape", "the probe outcome is named", bad.map((r) => r.probe));
}
ok((await checkBudget({ token: "t", cls: "sweep", floor: 0, fetchImpl: mk(0).fetchImpl })).yield === false, "floor 0 disables");
ok(resolveFloor("sweep", undefined, undefined) === DEFAULT_FLOOR && DEFAULT_FLOOR === 600, "default floor is 600");
ok(resolveFloor("sweep", "700", "1500") === 1500 && resolveFloor("sweep", "700", "") === 700 && resolveFloor("sweep", "700", "0") === 0 && resolveFloor("sweep", "x", "y") === 600, "the repository variable overrides the flag; junk falls back");
ok(resolveFloor("lane", "700", "1500") === 0, "lane floor is always 0");
ok(/^GH-BUDGET-YIELD \{.*"who":"w".*"remaining":10/.test(yieldLine({ remaining: 10, yield: true }, "w")), "the yield line has the stable prefix");
ok(YIELD_EXIT === 78, "yield exit code is 78");
{
  // CLI: an unreachable api (no token) proceeds with exit 0 and prints one JSON line
  const p = spawnSync(process.execPath, [join(root, "scripts", "gh-budget-floor.mjs"), "--floor", "600", "--class", "sweep"], { env: { PATH: process.env.PATH }, encoding: "utf8" });
  ok(p.status === 0 && JSON.parse(p.stdout.trim().split("\n")[0]).yield === false, "CLI without a token exits 0", { s: p.status, o: p.stdout });
}
{
  const wf = (n) => readFileSync(join(root, ".github", "workflows", n), "utf8");
  for (const n of ["artifacts-canonical-sync.yml", "repository-age-policy.yml"]) ok(/gh-budget-floor\.mjs --floor 600 --class sweep/.test(wf(n)), n + " yields through the shared helper");
  for (const n of ["pr-lane.yml", "canonical-deploy.yml"]) ok(!/gh-budget-floor/.test(wf(n)), n + " (merge lane / deploy) is untouched"); // merge-when-ready.yml folded into pr-lane.yml (PR-CHECK-CAP-5-1)
}
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
