// CRON-GRID-TICK-DECLARED-1 (agent_issues 1000269 CHARTER-TICK-STALE-1, 2679 loop-heartbeats): a worker that runs its slow jobs through
// CRON-GRID-1 (cronGridRun) must be fired by the trigger it names as the grid tick. qnfo-fleet-control 0.45.4 halved its declared fast
// trigger from */5 to */10 and left CRON_GRID_CFG.tick at */5; cronGridRun evaluates the daily, weekly and monthly jobs only on an event
// whose cron equals that tick, so from 2026-10-25 09:15Z the 0 3 * * * bundle (charter tick, cost guard, activity snapshot, census) and
// the weekly and monthly jobs never ran again (cron_fire_log: last */5 row 2026-10-25T09:15:39Z, last 0 3 * * * row 03:05:38Z that day).
// This suite reads every live worker.js that carries a CRON_GRID_CFG and its wrangler.toml, and proves (1) the tick is a declared trigger,
// (2) with the worker's own cronGridMatch/cronGridSlot code executed, every slot of every job falls in exactly one tick window over
// 400 days (a tick that is declared but too sparse for tickMin leaves a slot uncovered; an overlap would run a job twice).
// Run: node scripts/cron-grid-tick-declared.test.mjs   (exit 0 = all passed)
import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 300) : "")); } };

const helpers = (src) => {
  const a = src.indexOf("function cronGridField(");
  const b = src.indexOf("async function cronGridLog(");
  if (a < 0 || b < a) return null;
  return new Function(src.slice(a, b) + "\nreturn { cronGridMatch: cronGridMatch, cronGridSlot: cronGridSlot };")();
};

const MIN = 60000;
const DAYS = 400;
let seen = 0;
for (const dir of readdirSync(root, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  const w = join(root, dir.name);
  if (!existsSync(join(w, "worker.js")) || !existsSync(join(w, "wrangler.toml"))) continue;
  if (existsSync(join(w, "RETIRED")) || existsSync(join(w, "FOLDED"))) continue;
  const src = readFileSync(join(w, "worker.js"), "utf8");
  const m = /var CRON_GRID_CFG = (\{[^\n]*\});/.exec(src);
  if (!m) continue;
  seen++;
  // CRON-GRID-TICK-SYNTAX-1: the 0.55.2 version note carried a star-slash pair inside a block comment, the script stopped parsing, and the
  // deploy was refused (CF 10021) after a lane merge that does not run the gate job. The scanned worker must parse as a module.
  const tmp = join(tmpdir(), "cgtd-" + dir.name + ".mjs");
  writeFileSync(tmp, src);
  const chk = spawnSync(process.execPath, ["--check", tmp], { encoding: "utf8" });
  ok(chk.status === 0, dir.name + ": worker.js parses (node --check)", (chk.stderr || "").split("\n").slice(0, 4).join(" | "));
  let cfg;
  try { cfg = new Function("return " + m[1])(); } catch (e) { ok(false, dir.name + ": CRON_GRID_CFG is a readable object literal", String(e)); continue; }
  const toml = readFileSync(join(w, "wrangler.toml"), "utf8");
  const cl = /^crons\s*=\s*(\[[^\]]*\])/m.exec(toml);
  const crons = cl ? JSON.parse(cl[1]) : [];
  // WORKER-COUNT-1.3: a folded member (scripts/fold_worker.py) is not fired by a trigger of its own; its host hands it the grid tick as the cron of the event,
  // from the `due` expression of the generated wrapper, on a tick the host declares. So the tick is delivered when the host declares a trigger and a `due` returns it.
  const tickRe = cfg.tick.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const foldTick = crons.length > 0 && new RegExp('due: function \\(ms, cron\\) \\{ return \\([^\\n]*"' + tickRe + '"[^\\n]*\\); \\}').test(src);
  ok(crons.indexOf(cfg.tick) >= 0 || foldTick, dir.name + ": the grid tick " + cfg.tick + " is a declared trigger or is handed to a folded member by the host tick (declared: " + crons.join(" | ") + ")", { tick: cfg.tick, crons, foldTick });
  const h = helpers(src);
  ok(!!h, dir.name + ": the grid helpers are in worker.js");
  if (!h) continue;
  const lag = (cfg.lagMin || 0) * MIN, win = cfg.tickMin * MIN;
  const start = Date.UTC(2026, 0, 1);
  const end = start + DAYS * 1440 * MIN;
  for (const j of cfg.jobs) {
    let slots = 0, bad = null;
    for (let t = start; t < end - 2 * win - lag && !bad; t += MIN) {
      if (!h.cronGridMatch(j.cron, new Date(t))) continue;
      slots++;
      // the ticks whose window (T - lag - tickMin, T - lag] holds this slot: T in [slot + lag, slot + lag + tickMin)
      let n = 0;
      for (let T = t + lag; T < t + lag + win; T += MIN) if (h.cronGridMatch(cfg.tick, new Date(T))) n++;
      if (n !== 1) bad = { slot: new Date(t).toISOString(), ticks: n };
    }
    ok(slots > 0, dir.name + ": job " + j.cron + " has slots in " + DAYS + " days");
    ok(!bad, dir.name + ": every slot of " + j.cron + " is covered by exactly one " + cfg.tick + " tick", bad);
  }
}
ok(seen >= 1, "at least one worker carries a CRON_GRID_CFG (the scan found " + seen + ")");
console.log("cron-grid-tick-declared: " + pass + " passed, " + fail + " failed (" + seen + " workers scanned)");
process.exit(fail ? 1 : 0);
