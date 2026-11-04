#!/usr/bin/env node
// scripts/consumer-run-timing.mjs: CONSUMER-SPEED-1 (2026-11-04, charter pillar: autonomy). The measurement behind remediation-consumer.yml's speed target.
//
// Measured 2026-11-04 (Actions API): a consume job took 26-32 minutes and runs 41907336197, 41894454508 and 41884323072 were cancelled at the 30-minute cap, so a contract
// that became due mid-run waited for the next run and a two-pass issue close took 80 minutes. The workflow is now consume + sweeps + audits + heavy (see its header). This script
// reads the runs list and answers, from the API and not from a belief:
//   median_consume_min        median of the `consume` job durations (the contract run; what every issue close waits for)
//   median_run_min_no_heavy   median wall-clock of the runs that did not start the heavy job (the target: under 12; done = a run under 15)
//   timeouts                  consume/sweeps/heavy jobs cancelled at their cap (a cancelled job that ran for at least its cap minus a minute)
//   heavy_runs, min_heavy_gap_min   the heavy job's own cadence (the gate's window is 180 minutes)
// and exits 1 under --check when a target is missed.
//
// USAGE  node scripts/consumer-run-timing.mjs [--hours 24] [--since <ISO time>] [--check]     (needs the gh CLI; one runs list + one jobs read per run)
//        node scripts/consumer-run-timing.mjs --selftest
// `--since` limits the window to runs created after a deploy (the 24-hour window right after the merge still holds runs of the old layout).
import { execFileSync } from "node:child_process";

export const TARGET_MEDIAN_MIN = 12;
export const TARGET_RUN_MAX_MIN = 15;
export const HEAVY_WINDOW_MIN = 180;
export const CAPS_MIN = { consume: 25, sweeps: 25, audits: 25, heavy: 50 };
const LEGACY_CAP_MIN = 30; // the single consume job before CONSUMER-SPEED-1

const minutes = (a, b) => (Date.parse(b) - Date.parse(a)) / 60000;
export function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const r1 = (x) => (x === null ? null : Math.round(x * 10) / 10);

// runs: [{ id, created_at, jobs: [{ name, status, conclusion, started_at, completed_at }] }], any order. Only runs created within `hours` of `now` (and after `since`) count.
export function summarize({ runs, now, hours = 24, since = null }) {
  const from = Math.max(now - hours * 3600 * 1000, since ? Date.parse(since) : 0);
  const consume = [], noHeavy = [], heavyStarts = [], timeouts = [];
  let counted = 0;
  for (const r of runs || []) {
    if (!(Date.parse(r.created_at) >= from)) continue;
    const ran = (j) => j.started_at && j.completed_at;
    const jobs = (r.jobs || []).filter(ran);
    const c = jobs.find((j) => j.name === "consume");
    if (!c) continue; // a run whose consume job never ran (skipped by the gate) says nothing about speed
    counted++;
    consume.push(minutes(c.started_at, c.completed_at));
    const heavy = jobs.find((j) => j.name === "heavy");
    if (heavy) heavyStarts.push(Date.parse(heavy.started_at));
    else {
      const begin = Math.min(...jobs.map((j) => Date.parse(j.started_at)));
      const end = Math.max(...jobs.map((j) => Date.parse(j.completed_at)));
      noHeavy.push((end - begin) / 60000);
    }
    for (const j of jobs) {
      const cap = CAPS_MIN[j.name];
      if (!cap || j.conclusion !== "cancelled") continue;
      const ranMin = minutes(j.started_at, j.completed_at);
      if (ranMin >= Math.min(cap, LEGACY_CAP_MIN) - 1) timeouts.push({ run: r.id, job: j.name, minutes: r1(ranMin) });
    }
  }
  heavyStarts.sort((a, b) => a - b);
  const gaps = heavyStarts.slice(1).map((t, i) => (t - heavyStarts[i]) / 60000);
  const out = {
    window_hours: hours,
    runs_with_consume: counted,
    median_consume_min: r1(median(consume)),
    max_consume_min: r1(consume.length ? Math.max(...consume) : null),
    median_run_min_no_heavy: r1(median(noHeavy)),
    max_run_min_no_heavy: r1(noHeavy.length ? Math.max(...noHeavy) : null),
    timeouts,
    heavy_runs: heavyStarts.length,
    min_heavy_gap_min: gaps.length ? r1(Math.min(...gaps)) : null,
  };
  const checks = {
    has_runs: counted > 0,
    median_under_target: out.median_run_min_no_heavy !== null && out.median_run_min_no_heavy < TARGET_MEDIAN_MIN,
    no_run_over_max: out.max_run_min_no_heavy === null || out.max_run_min_no_heavy < TARGET_RUN_MAX_MIN * 2,
    no_timeouts: timeouts.length === 0,
    heavy_on_its_own_cadence: gaps.every((g) => g >= HEAVY_WINDOW_MIN - 15) && heavyStarts.length <= Math.ceil((hours * 60) / HEAVY_WINDOW_MIN) + 1,
  };
  return Object.assign(out, { checks, ok: Object.values(checks).every(Boolean) });
}

function gh(path) {
  return JSON.parse(execFileSync("gh", ["api", path], { encoding: "utf8", timeout: 120000, maxBuffer: 64 * 1024 * 1024 }));
}

async function main(argv) {
  const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  const hours = Number(arg("--hours") || 24);
  const since = arg("--since");
  const repo = process.env.GITHUB_REPOSITORY || "QNFO/qnfo-workers";
  const now = Date.now();
  const from = new Date(Math.max(now - hours * 3600 * 1000, since ? Date.parse(since) : 0)).toISOString();
  const list = gh("repos/" + repo + "/actions/workflows/remediation-consumer.yml/runs?per_page=100&created=" + encodeURIComponent(">=" + from));
  const runs = [];
  for (const r of list.workflow_runs || []) {
    if (r.status === "queued" || r.status === "pending") continue;
    const jobs = gh("repos/" + repo + "/actions/runs/" + r.id + "/jobs?per_page=20").jobs || [];
    runs.push({ id: r.id, created_at: r.created_at, jobs });
  }
  const res = summarize({ runs, now, hours, since });
  console.log(JSON.stringify(res, null, 1));
  return argv.includes("--check") && !res.ok ? 1 : 0;
}

function selftest() {
  let fail = 0;
  const ok = (c, m, x) => { if (c) console.log("PASS " + m); else { fail++; console.log("FAIL " + m + (x === undefined ? "" : " " + JSON.stringify(x))); } };
  const now = Date.parse("2026-11-05T12:00:00Z");
  const at = (minAgo) => new Date(now - minAgo * 60000).toISOString();
  const job = (name, startAgo, mins, conclusion = "success") => ({ name, status: "completed", conclusion, started_at: at(startAgo), completed_at: at(startAgo - mins) });
  const run = (id, startAgo, jobs) => ({ id, created_at: at(startAgo + 0.5), jobs: [job("cadence-gate", startAgo + 0.4, 0.3)].concat(jobs) });

  // The measured state of 2026-11-04: 26-32 minute consume jobs, three cancelled at the 30-minute cap.
  const before = [run(1, 2400, [job("consume", 2400, 26)]), run(2, 2360, [job("consume", 2360, 30, "cancelled")]), run(3, 2320, [job("consume", 2320, 30, "cancelled")]), run(4, 2280, [job("consume", 2280, 28)])];
  let s = summarize({ runs: before, now, hours: 72 });
  ok(s.median_consume_min === 29 && s.timeouts.length === 2 && s.ok === false && s.checks.no_timeouts === false, "the 2026-11-04 shape fails: median 29 minutes, two cap cancellations", s);

  // The new layout: consume 9-11 minutes beside sweeps of 10; the heavy job every 3 hours.
  const after = [];
  for (let i = 0; i < 24; i++) {
    const startAgo = 1380 - i * 60;
    const jobs = [job("consume", startAgo, 9 + (i % 3)), job("sweeps", startAgo, 10)];
    if (i % 3 === 0) jobs.push(job("heavy", startAgo, 24));
    after.push(run(100 + i, startAgo, jobs));
  }
  s = summarize({ runs: after, now, hours: 24 });
  ok(s.ok === true && s.median_consume_min <= 11 && s.median_run_min_no_heavy < TARGET_MEDIAN_MIN && s.timeouts.length === 0, "the new layout passes", s);
  ok(s.heavy_runs === 8 && s.min_heavy_gap_min === 180, "eight heavy runs a day, 180 minutes apart", s);

  // A heavy job in every run is not a cadence.
  const every = after.map((r) => (r.jobs.some((j) => j.name === "heavy") ? r : Object.assign({}, r, { jobs: r.jobs.concat(job("heavy", 100, 20)) })));
  s = summarize({ runs: every, now, hours: 24 });
  ok(s.checks.heavy_on_its_own_cadence === false && s.ok === false, "a heavy job in every cycle fails the cadence check", s.checks);

  // One cancelled sweeps job at its cap is a timeout; a job cancelled early by a newer run is not.
  s = summarize({ runs: after.concat([run(300, 100, [job("consume", 100, 10), job("sweeps", 100, 25, "cancelled")])]), now, hours: 24 });
  ok(s.timeouts.length === 1 && s.timeouts[0].job === "sweeps" && s.checks.no_timeouts === false, "a sweeps job cancelled at its cap counts", s.timeouts);
  s = summarize({ runs: after.concat([run(301, 100, [job("consume", 100, 3, "cancelled")])]), now, hours: 24 });
  ok(s.timeouts.length === 0, "a job cancelled after 3 minutes is a superseded run, not a timeout", s.timeouts);

  // The window: old runs are ignored, and --since drops the runs of the previous layout.
  s = summarize({ runs: before.concat(after), now, hours: 48, since: at(1500) });
  ok(s.runs_with_consume === 24 && s.timeouts.length === 0, "--since keeps only the runs after the change", s);
  s = summarize({ runs: before, now: now + 80 * 3600 * 1000, hours: 24 });
  ok(s.runs_with_consume === 0 && s.ok === false, "no run in the window is a failure, not a pass", s);

  // A run whose consume job was skipped (the gate said no) says nothing about speed.
  s = summarize({ runs: after.concat([{ id: 400, created_at: at(10), jobs: [job("cadence-gate", 10, 0.3), { name: "consume", status: "completed", conclusion: "skipped", started_at: null, completed_at: null }] }]), now, hours: 24 });
  ok(s.runs_with_consume === 24, "a gated-out run is not counted", s);
  ok(median([3, 1, 2]) === 2 && median([1, 2, 3, 4]) === 2.5 && median([]) === null, "median");
  console.log(fail ? "consumer-run-timing selftest: " + fail + " FAILED" : "consumer-run-timing selftest: ok");
  return fail ? 1 : 0;
}

if (process.argv[1] && process.argv[1].endsWith("consumer-run-timing.mjs")) {
  const code = process.argv.includes("--selftest") ? selftest() : await main(process.argv.slice(2));
  process.exit(code);
}
