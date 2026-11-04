#!/usr/bin/env node
// scripts/consumer-cadence-gate.mjs: CONSUMER-GATE-STARVATION-1 (2026-10-19, charter pillar: autonomy).
//
// The cadence gate of remediation-consumer.yml (CONSUMER-CI-LOOP-1) lets a workflow_run-triggered run proceed only when no consumer
// run started in the last 20 minutes. It read "a consumer run" as any run of the workflow whose conclusion is success, and a run
// whose gate said skip ends with its `consume` job skipped and the WORKFLOW concluded success. So every skipped trigger counted as
// a consumer run and restarted the 20-minute window: with merges to main arriving more often than every 20 minutes (three upstream
// workflows complete per merge) the gate held itself shut. Measured on 2026-10-19: none of the last 30 runs had a `consume` job that
// ran, the last verification was at 08:56Z, 78 failure-mode detectors read "unprobed", issues whose fix had merged stayed open, and
// the log said "last consumer run started 174s ago" at 10:04Z while no consumer had run for over an hour.
//
// A consumer run is a run whose `consume` job ran (in progress, queued behind the concurrency group, or finished successfully).
// push, schedule, workflow_dispatch and repository_dispatch always run; a [skip ci] status commit never triggers one.
//
// CONSUMER-SPEED-1 (2026-11-04): the gate also decides whether the `heavy` job runs. Measured over the runs of 2026-11-04 a consume job took 26-32 minutes and half
// of them were cancelled at the 30-minute cap: the weekly export (270 s a run), the restore drill (300-490 s), the cost ledger (50-250 s) and the sweeps ran in
// series after the contract run. The heavy job holds the steps that need not run every cycle; it runs when the newest `consumer-heavy-stamp` artifact (uploaded at
// the end of a heavy job) is older than HEAVY_WINDOW_S, one REST call instead of a job read per run.
//
// USAGE  node scripts/consumer-cadence-gate.mjs        (reads GH_TOKEN, EVENT, HEAD_MSG, RUN_ID, FORCE_HEAVY, GITHUB_REPOSITORY, GITHUB_OUTPUT)
//        node scripts/consumer-cadence-gate.mjs --selftest
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

export const WINDOW_S = 1200;
// Heavy steps (cost ledger, weekly export, restore drill): 3 hours. The daily continuity snapshot is not among them (it runs every cycle in the sweeps job), so
// the 1260-minute cadence_sla of `continuity-snapshot` keeps one consumer window of slack, not the heavy window.
export const HEAVY_WINDOW_S = 10800;
export const HEAVY_STAMP = "consumer-heavy-stamp";

// runs: newest first, as the REST list returns them: [{ id, status, conclusion, run_started_at }]. jobsOf(id) -> [{ name, status, conclusion }].
export async function decide({ event, headMsg, runs, jobsOf, now, selfId, windowS = WINDOW_S }) {
  if (event !== "workflow_run") return { run: true, why: "not a workflow_run trigger" };
  if (String(headMsg || "").includes("[skip ci]")) return { run: false, why: "triggering commit is [skip ci]" };
  for (const r of runs || []) {
    if (String(r.id) === String(selfId)) continue;
    if (!(r.status === "in_progress" || r.conclusion === "success")) continue;
    const age = Math.round((now - Date.parse(r.run_started_at)) / 1000);
    if (!(age >= 0)) continue;
    if (age >= windowS) break; // newest first: every later run is older than the window
    const jobs = (await jobsOf(r.id)) || [];
    const consumed = jobs.some((j) => j.name === "consume" && (j.status === "in_progress" || j.status === "queued" || j.conclusion === "success"));
    if (consumed) return { run: false, why: "a consumer run that probed started " + age + " s ago (< " + windowS + " s)" };
  }
  return { run: true, why: "no consumer run probed in the last " + windowS + " s" };
}

// artifacts: newest first, as GET /actions/artifacts?name=<HEAVY_STAMP> returns them: [{ name, created_at, expired }]; null when the call failed.
// A missing, expired or unreadable stamp means heavy is due: backups and the cost ledger run rather than starve (the job runs beside `consume`, never in front of it).
export function heavyDue({ force, artifacts, now, windowS = HEAVY_WINDOW_S }) {
  if (String(force || "") === "true") return { heavy: true, why: "forced (workflow_dispatch input heavy)" };
  if (!Array.isArray(artifacts)) return { heavy: true, why: "stamp unreadable: heavy runs rather than starves" };
  const stamp = artifacts.find((a) => a && a.name === HEAVY_STAMP && !a.expired);
  if (!stamp) return { heavy: true, why: "no heavy stamp" };
  const age = Math.round((now - Date.parse(stamp.created_at)) / 1000);
  if (!(age >= 0)) return { heavy: true, why: "stamp time unreadable" };
  if (age >= windowS) return { heavy: true, why: "last heavy run " + age + " s ago (>= " + windowS + " s)" };
  return { heavy: false, why: "last heavy run " + age + " s ago (< " + windowS + " s)" };
}

function gh(path) {
  try {
    return JSON.parse(execFileSync("gh", ["api", path], { encoding: "utf8", timeout: 60000 }));
  } catch (e) {
    return null;
  }
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY || "QNFO/qnfo-workers";
  const list = gh("repos/" + repo + "/actions/workflows/remediation-consumer.yml/runs?per_page=30");
  const d = await decide({
    event: process.env.EVENT,
    headMsg: process.env.HEAD_MSG,
    runs: (list && list.workflow_runs) || [],
    jobsOf: async (id) => { const j = gh("repos/" + repo + "/actions/runs/" + id + "/jobs"); return j ? j.jobs : null; },
    now: Date.now(),
    selfId: process.env.RUN_ID
  });
  console.log((d.run ? "run: " : "skip: ") + d.why);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, "run=" + (d.run ? "true" : "false") + "\n");
}

async function selftest() {
  let fail = 0;
  const ok = (c, m, x) => { if (c) console.log("PASS " + m); else { fail++; console.log("FAIL " + m + (x === undefined ? "" : " " + JSON.stringify(x))); } };
  const now = Date.parse("2026-10-19T10:00:00Z");
  const at = (secAgo) => new Date(now - secAgo * 1000).toISOString();
  const skipped = (id, ago) => ({ id, status: "completed", conclusion: "success", run_started_at: at(ago) });
  const jobs = { 1: [{ name: "cadence-gate", status: "completed", conclusion: "success" }, { name: "consume", status: "completed", conclusion: "skipped" }], 2: [{ name: "consume", status: "completed", conclusion: "success" }], 3: [{ name: "consume", status: "in_progress", conclusion: null }], 4: [{ name: "consume", status: "queued", conclusion: null }], 5: [{ name: "consume", status: "completed", conclusion: "cancelled" }] };
  const jobsOf = async (id) => jobs[id] || null;
  let d = await decide({ event: "push", runs: [], jobsOf, now });
  ok(d.run === true, "a push always runs");
  d = await decide({ event: "workflow_run", headMsg: "ci(status): x [skip ci]", runs: [], jobsOf, now });
  ok(d.run === false && /skip ci/.test(d.why), "a [skip ci] status commit never triggers a consumer run");
  d = await decide({ event: "workflow_run", runs: [skipped(1, 170), skipped(1, 400)], jobsOf, now });
  ok(d.run === true, "a recent run whose consume job was skipped does not count (the starvation)", d);
  d = await decide({ event: "workflow_run", runs: [skipped(1, 100), skipped(1, 200), skipped(2, 900)], jobsOf, now });
  ok(d.run === false && /900 s/.test(d.why), "a recent run whose consume job ran does count, found behind skipped ones", d);
  d = await decide({ event: "workflow_run", runs: [skipped(2, 1500)], jobsOf, now });
  ok(d.run === true, "a consuming run older than the window lets the next one in", d);
  d = await decide({ event: "workflow_run", runs: [{ id: 3, status: "in_progress", conclusion: null, run_started_at: at(60) }], jobsOf, now });
  ok(d.run === false, "a consume job still in progress holds the gate", d);
  d = await decide({ event: "workflow_run", runs: [skipped(4, 30)], jobsOf, now });
  ok(d.run === false, "a consume job queued behind the concurrency group holds the gate", d);
  d = await decide({ event: "workflow_run", runs: [skipped(5, 30)], jobsOf, now });
  ok(d.run === true, "a cancelled consume job does not count", d);
  d = await decide({ event: "workflow_run", selfId: 2, runs: [skipped(2, 30)], jobsOf, now });
  ok(d.run === true, "the run being gated is not its own predecessor", d);
  d = await decide({ event: "workflow_run", runs: [skipped(1, 100)], jobsOf: async () => null, now });
  ok(d.run === true, "an unreadable job list fails open: the consumer runs rather than starves", d);
  let reads = 0;
  d = await decide({ event: "workflow_run", runs: [skipped(1, 1300), skipped(2, 1400)], jobsOf: async (id) => { reads++; return jobs[id]; }, now });
  ok(d.run === true && reads === 0, "runs older than the window cost no job read", { d, reads });
  // CONSUMER-SPEED-1: the heavy decision.
  const stamp = (secAgo, extra) => Object.assign({ name: HEAVY_STAMP, created_at: at(secAgo), expired: false }, extra || {});
  let h = heavyDue({ artifacts: [stamp(600)], now });
  ok(h.heavy === false, "a heavy stamp 10 minutes old holds the heavy job", h);
  h = heavyDue({ artifacts: [stamp(HEAVY_WINDOW_S - 60)], now });
  ok(h.heavy === false, "a stamp just inside the window still holds it", h);
  h = heavyDue({ artifacts: [stamp(HEAVY_WINDOW_S + 60)], now });
  ok(h.heavy === true && /s ago/.test(h.why), "a stamp past the window releases it", h);
  h = heavyDue({ artifacts: [], now });
  ok(h.heavy === true, "no stamp at all: the first heavy run", h);
  h = heavyDue({ artifacts: [stamp(60, { expired: true })], now });
  ok(h.heavy === true, "an expired stamp does not hold the job", h);
  h = heavyDue({ artifacts: [{ name: "remediation-consumer-status", created_at: at(5), expired: false }], now });
  ok(h.heavy === true, "another artifact is not the stamp", h);
  h = heavyDue({ artifacts: null, now });
  ok(h.heavy === true, "an unreadable artifact list fails open: backups run rather than starve", h);
  h = heavyDue({ artifacts: [stamp(60)], now, force: "true" });
  ok(h.heavy === true && /forced/.test(h.why), "a manual run can force the heavy job", h);
  h = heavyDue({ artifacts: [stamp(60)], now, force: "false" });
  ok(h.heavy === false, "force=false is no force", h);
  h = heavyDue({ artifacts: [{ name: HEAVY_STAMP, created_at: at(-300), expired: false }], now });
  ok(h.heavy === true, "a stamp from the future (clock skew) is not trusted", h);
  console.log(fail ? "consumer-cadence-gate selftest: " + fail + " FAILED" : "consumer-cadence-gate selftest: ok");
  return fail ? 1 : 0;
}

if (process.argv[1] && process.argv[1].endsWith("consumer-cadence-gate.mjs")) {
  const code = process.argv.includes("--selftest") ? await selftest() : (await main(), 0);
  process.exit(code);
}
