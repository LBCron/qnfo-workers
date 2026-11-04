// CONSUMER-SPEED-1 suite (2026-11-04, pillar autonomy): pins the shape of .github/workflows/remediation-consumer.yml that made its runs finish inside the cap, and the
// gate and measurement behind it. Offline. Run: node scripts/consumer-speed.test.mjs
//
// Before: one `consume` job of 26-32 minutes (half of the runs cancelled at its 30-minute cap) ran the contract run, then the sweeps, the cost ledger, the continuity
// snapshot with its weekly export and the restore drill, in series. A contract that became due mid-run waited for the next run; a two-pass close took 80 minutes.
// After: `consume` (contract run + status), `sweeps` (every cycle, beside it) and `heavy` (cost ledger, weekly export, restore drill) behind the gate's 3-hour stamp.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HEAVY_STAMP, HEAVY_WINDOW_S, heavyDue } from "./consumer-cadence-gate.mjs";
import { CAPS_MIN, HEAVY_WINDOW_MIN, summarize } from "./consumer-run-timing.mjs";

const here = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 300) : "")); } };

const wf = readFileSync(join(here, "..", ".github", "workflows", "remediation-consumer.yml"), "utf8");
// The jobs of the workflow: name -> text of its block (two-space-indented keys under `jobs:`).
const jobs = {};
{
  const body = wf.slice(wf.indexOf("\njobs:\n") + 6).split("\n");
  let name = null;
  for (const line of body) {
    const m = /^  ([a-z][a-z-]*):\s*$/.exec(line);
    if (m) { name = m[1]; jobs[name] = []; continue; }
    if (name) jobs[name].push(line);
  }
  for (const k of Object.keys(jobs)) jobs[k] = jobs[k].join("\n");
}
const steps = (job) => (jobs[job] || "").split(/\n      - /).slice(1); // a step per `      - ` item
// Steps whose shell actually runs the script (a comment above a step lands in the previous chunk and must not count).
const runLines = (s) => s.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
const stepRuns = (job, script) => steps(job).filter((s) => runLines(s).includes("python3 " + script));
const timeoutOf = (text) => { const m = /^ {4}timeout-minutes:\s*(\d+)/m.exec(text); return m ? Number(m[1]) : null; };

ok(JSON.stringify(Object.keys(jobs)) === JSON.stringify(["cadence-gate", "consume", "sweeps", "heavy"]), "the workflow has the four jobs, in order", Object.keys(jobs));

// 1. The heavy steps run in the heavy job, and only there, except the daily snapshot (every cycle) which is a ledger read while fresh.
for (const script of ["scripts/cost_ledger.py", "scripts/d1_restore_drill.py"]) {
  ok(stepRuns("heavy", script).length === 1, script + " runs in the heavy job");
  for (const j of ["consume", "sweeps"]) ok(stepRuns(j, script).length === 0, script + " is not in the " + j + " job");
}
ok(stepRuns("heavy", "scripts/continuity_snapshot.py").every((s) => /--only=export\b/.test(s) && !/--only=[a-z,]*(daily|bak|blob)/.test(s)), "the heavy job runs only the export stage of the continuity script");
ok(stepRuns("sweeps", "scripts/continuity_snapshot.py").length === 1 && /--only=daily,bak,blob\b/.test(stepRuns("sweeps", "scripts/continuity_snapshot.py")[0]) && !/--only=[a-z,]*export/.test(stepRuns("sweeps", "scripts/continuity_snapshot.py")[0]),
   "the sweeps job runs the daily snapshot every cycle and never the export (continuity_snapshot_age_h keeps its retry cadence)");
ok(stepRuns("consume", "scripts/continuity_snapshot.py").length === 0, "the consume job runs no continuity step");
ok(/continuity-snapshot\/\n/.test(jobs.sweeps || "") && /hashFiles\('continuity-snapshot\/\*\.jsonl\.gz'\)/.test(jobs.sweeps || ""), "the public-safe snapshot artifact (the second provider) is still uploaded, by the job that writes it");

// 2. The critical path: the contract run stays in `consume` with nothing else in front of it; the every-cycle work stays every cycle.
ok(stepRuns("consume", "scripts/remediation-consumer.py").length === 2, "consume runs the consumer (and its selftest)");
const forbidden = ["cf_obs_issue_bridge.py", "loop_breaker_runner.py", "blocker_redteam_runner.py", "trigger_depth_sweep.py", "claim_reaper.py", "se_mentions_runner.py"];
for (const script of forbidden) {
  ok(stepRuns("sweeps", "scripts/" + script).length === 1, script + " still runs every cycle (sweeps job)");
  ok(stepRuns("consume", "scripts/" + script).length === 0, script + " is not in the contract path");
}
// The consumer's tail (242 serial view EXPLAINs, 4-6 of the 9-11 minutes of its step) runs beside the contract run, every cycle.
ok(/REMEDIATION_VIEW_HEALTH: sweeps/.test(jobs.consume) && !/REMEDIATION_VIEW_HEALTH/.test(jobs.sweeps + jobs.heavy), "only the consume job tells the consumer to leave the view-health pass to the sweeps job");
ok(stepRuns("sweeps", "scripts/view_health.py").length === 1 && /view_health\.py --run/.test(jobs.sweeps), "the sweeps job runs the view-health pass every cycle");
const rc = readFileSync(join(here, "remediation_consumer.py"), "utf8");
ok(/os\.environ\.get\("REMEDIATION_VIEW_HEALTH", "inline"\) == "inline"/.test(rc) && /import view_health/.test(rc), "the consumer still runs the pass itself unless the environment hands it to the sweeps job");
ok(/def live\(\)/.test(readFileSync(join(here, "view_health.py"), "utf8")) && /"--run" in sys\.argv/.test(readFileSync(join(here, "view_health.py"), "utf8")), "view_health.py has the --run entry the sweeps job calls");
ok(/needs\.cadence-gate\.outputs\.run == 'true'/.test(jobs.consume) && /needs\.cadence-gate\.outputs\.run == 'true'/.test(jobs.sweeps), "consume and sweeps run on every gated trigger");
ok(!/outputs\.heavy/.test(jobs.consume + jobs.sweeps), "neither of them depends on the heavy decision");
ok(/needs\.cadence-gate\.outputs\.run == 'true' && needs\.cadence-gate\.outputs\.heavy == 'true'/.test(jobs.heavy), "the heavy job needs the gate's heavy output (and a run)");
ok(!/needs:\s*\[?[^\n]*\b(consume|sweeps)\b/.test(jobs.heavy + jobs.sweeps + jobs.consume), "no job waits for another: they run beside each other");
ok(/output|outputs:\s*\n\s+run: .*steps\.g\.outputs\.run\s*\n\s+heavy: .*steps\.g\.outputs\.heavy/.test(jobs["cadence-gate"]), "the gate exports run and heavy");
ok(/FORCE_HEAVY: \$\{\{ github\.event\.inputs\.heavy \}\}/.test(jobs["cadence-gate"]) && /inputs:\s*\n\s+heavy:/.test(wf), "a manual run can force the heavy job");
ok(/^ {2}actions: read/m.test(wf.slice(0, wf.indexOf("\njobs:\n"))), "the token may list artifacts (actions: read)");

// 3. Timeouts: every job and every long step has one, none above what the measurement allows, and the old 30-minute cap is gone from the contract path.
for (const j of ["consume", "sweeps", "heavy"]) {
  ok(timeoutOf(jobs[j]) !== null && timeoutOf(jobs[j]) <= CAPS_MIN[j], j + " job cap is " + timeoutOf(jobs[j]) + " minutes, at most " + CAPS_MIN[j], timeoutOf(jobs[j]));
}
ok(timeoutOf(jobs.consume) < 30, "the consume cap is below the 30 minutes that half the runs hit");
ok(/Run the remediation consumer[\s\S]*?timeout-minutes: 15/.test(jobs.consume), "the consumer step carries its own 15-minute timeout");
for (const j of ["sweeps", "heavy"]) {
  for (const s of steps(j).filter((x) => /continue-on-error: true/.test(x) && /run: \|/.test(x))) {
    ok(/timeout-minutes: \d+/.test(s), j + ": step has its own timeout: " + s.split("\n")[0].trim());
  }
}
ok(Math.max(...steps("heavy").map((s) => Number((/timeout-minutes: (\d+)/.exec(s) || [0, 0])[1]))) * 2 + 6 <= timeoutOf(jobs.heavy) + 6, "the heavy job cap covers its two long steps");
// the restore drill stops itself (DRILL_BUDGET_SEC, 840 s default) before its step is killed, so the scratch database is deleted
const drillStep = stepRuns("heavy", "scripts/d1_restore_drill.py")[0] || "";
ok(Number((/timeout-minutes: (\d+)/.exec(drillStep) || [0, 0])[1]) * 60 > 840, "the drill step timeout outlasts the drill's own 840 s budget (no scratch database left behind)");
ok(/EXPORT_BUDGET_SEC: "900"/.test(stepRuns("heavy", "scripts/continuity_snapshot.py")[0] || "") && Number((/timeout-minutes: (\d+)/.exec(stepRuns("heavy", "scripts/continuity_snapshot.py")[0] || "") || [0, 0])[1]) * 60 > 900, "the export budget is below its step timeout");

// 4. The stamp: written last, always, under the name the gate reads, and it expires well after the window.
const lastStep = steps("heavy").slice(-1)[0] || "";
ok(/if: always\(\)/.test(lastStep) && new RegExp("name: " + HEAVY_STAMP).test(lastStep), "the last heavy step uploads the stamp under the gate's name, always");
const ret = Number((/retention-days: (\d+)/.exec(lastStep) || [0, 0])[1]);
ok(ret >= 1 && ret * 86400 > HEAVY_WINDOW_S, "the stamp outlives the gate window (" + ret + " day)", ret);
ok(HEAVY_WINDOW_S / 60 === HEAVY_WINDOW_MIN, "the gate and the measurement agree on the window", [HEAVY_WINDOW_S, HEAVY_WINDOW_MIN]);

// 5. The gate and the measurement pass their own selftests.
for (const f of ["consumer-cadence-gate.mjs", "consumer-run-timing.mjs"]) {
  let out = "";
  try { out = execFileSync("node", [join(here, f), "--selftest"], { encoding: "utf8" }); } catch (e) { out = String(e.stdout || "") + String(e.stderr || ""); }
  ok(/selftest: ok/.test(out) && !/^FAIL/m.test(out), f + " selftest passes", out.slice(-300));
}

// 6. The gate's decision, end to end: a run right after a heavy run skips it, a run three hours later does it, and nothing stops the consume job.
const now = Date.parse("2026-11-05T12:00:00Z");
const stamp = (secAgo) => [{ name: HEAVY_STAMP, created_at: new Date(now - secAgo * 1000).toISOString(), expired: false }];
ok(heavyDue({ artifacts: stamp(2400), now }).heavy === false, "the 40-minute cycle after a heavy run does not repeat it");
ok(heavyDue({ artifacts: stamp(2400 * 5), now }).heavy === true, "a cycle more than three hours after it does");
let heavyCycles = 0;
for (let i = 0, last = null; i < 36; i++) { // a day of 40-minute cycles
  const t = now + i * 2400 * 1000;
  const arts = last === null ? [] : [{ name: HEAVY_STAMP, created_at: new Date(last).toISOString(), expired: false }];
  if (heavyDue({ artifacts: arts, now: t }).heavy) { heavyCycles++; last = t; }
}
ok(heavyCycles >= 7 && heavyCycles <= 9, "36 cycles of 40 minutes start the heavy job 8 times, not 36", heavyCycles);

// 7. The measurement: the 2026-11-04 shape (the figures from the Actions API) misses the target, the new layout meets it.
const at = (min) => new Date(now - min * 60000).toISOString();
const job = (name, startAgo, mins, conclusion = "success") => ({ name, conclusion, started_at: at(startAgo), completed_at: at(startAgo - mins) });
const measured = [[26, "success"], [30, "cancelled"], [30, "cancelled"], [28, "success"], [30, "cancelled"]].map(([m, c], i) => ({ id: 41880000000 + i, created_at: at(900 - i * 40), jobs: [job("consume", 900 - i * 40, m, c)] }));
const before = summarize({ runs: measured, now, hours: 24 });
ok(before.ok === false && before.timeouts.length === 3 && before.median_run_min_no_heavy >= 28, "the measured state of 2026-11-04 fails the target (3 cap cancellations, median 28+ minutes)", before);

console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
