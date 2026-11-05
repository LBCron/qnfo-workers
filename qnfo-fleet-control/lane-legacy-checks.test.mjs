// LANE-LEGACY-CHECK-NAMES-1 (qnfo-fleet-control, charter pillar autonomy): since PR-CHECK-CAP-5-1 a pull request carries four checks (versions, scans, lane, Workers Builds), and the guards
// that used to be separate checks named mirror-guard, comparator, guard and charter are steps of the versions and scans jobs. cmRequired still asks for the legacy names, so the stale-PR lane
// (bhMergeDecide) and the merge runner refused every worker.js pull request with "required check(s) mirror-guard, comparator, guard never ran" (12 pull requests 2026-11-05 04:06Z to 05:05Z in
// qnfo-audit.branch_hygiene_log). cmChecks now lets the success of BOTH versions and scans stand for a legacy name that has no run of its own.
// This suite pins: the new satisfaction; that a missing, running or failed versions or scans still refuses (missing, pending, failed); that a real run under the legacy name still wins; that a check
// with no legacy meaning (test) is still required by its own name. Run: node --no-warnings qnfo-fleet-control/lane-legacy-checks.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 400) : "")); } };
const line = (k) => { const i = src.indexOf(k); if (i < 0) throw new Error("not found: " + k); return src.slice(i, src.indexOf("\n", i)); };
const fn = (name) => { const i = src.indexOf("function " + name + "("); if (i < 0) throw new Error("not found: " + name); const end = src.indexOf('\n__name(' + name + ', "' + name + '");', i); if (end < 0) throw new Error("no __name for " + name); return src.slice(i, end); };
const sandbox = { __name: (f) => f, Math, Number, Object, String, Array };
vm.createContext(sandbox);
vm.runInContext([line("var EVOLVE_REQUIRED = "), line("var CM_OK = "), fn("cmRequired"), fn("cmChecks"), "this.cmRequired = cmRequired; this.cmChecks = cmChecks;"].join("\n"), sandbox);
const { cmRequired, cmChecks } = sandbox;

let id = 100;
const run = (name, status, conclusion) => ({ id: ++id, name, status, conclusion: conclusion === undefined ? (status === "completed" ? "success" : null) : conclusion });
const GREEN = () => [run("versions", "completed"), run("scans", "completed"), run("lane", "completed"), run("Workers Builds: qnfo-workers", "completed")];
const worker = ["qnfo-fleet-dashboard/worker.js", "qnfo-fleet-dashboard/deployed-current.worker.js", "qnfo-fleet-dashboard/releases/1.95.2.md"];
const scriptsOnly = ["scripts/ai_call_paths_audit.mjs"];
const fleetControl = ["qnfo-fleet-control/worker.js", "qnfo-fleet-control/deployed-current.worker.js"];

// what is asked for
ok(JSON.stringify(cmRequired(worker)) === JSON.stringify(["mirror-guard", "comparator", "guard"]), "a worker.js change still names mirror-guard, comparator and guard", cmRequired(worker));
ok(cmRequired(fleetControl).includes("charter"), "a fleet-control change still names charter");
ok(JSON.stringify(cmRequired(scriptsOnly)) === JSON.stringify(["mirror-guard", "comparator"]), "a scripts-only change names mirror-guard and comparator", cmRequired(scriptsOnly));

// the capped check set satisfies them
{
  const ck = cmChecks(GREEN(), null, cmRequired(worker));
  ok(ck.missing.length === 0 && ck.failed.length === 0 && ck.pending.length === 0 && ck.other.length === 0, "versions and scans green: no legacy name is missing, failed or pending", ck);
  const ck2 = cmChecks(GREEN(), null, cmRequired(fleetControl));
  ok(ck2.missing.length === 0 && ck2.failed.length === 0, "charter is satisfied the same way for fleet-control files", ck2);
  const ck3 = cmChecks(GREEN(), null, cmRequired(scriptsOnly));
  ok(ck3.missing.length === 0, "a scripts-only change is satisfied", ck3);
}

// ... and the refusals stay
{
  const noVersions = GREEN().filter((r) => r.name !== "versions");
  const a = cmChecks(noVersions, null, cmRequired(worker));
  ok(JSON.stringify(a.missing) === JSON.stringify(["mirror-guard", "comparator", "guard"]), "no versions run: every legacy name is still missing (never ran)", a);
  const noScans = GREEN().filter((r) => r.name !== "scans");
  const b = cmChecks(noScans, null, cmRequired(worker));
  ok(JSON.stringify(b.missing) === JSON.stringify(["mirror-guard", "comparator", "guard"]), "no scans run: every legacy name is still missing", b);
  const none = cmChecks([], null, cmRequired(worker));
  ok(none.missing.length === 3, "no runs at all: all three are missing", none);
  const running = GREEN(); running[1] = run("scans", "in_progress");
  const c = cmChecks(running, null, cmRequired(worker));
  ok(c.pending.includes("mirror-guard") && c.pending.includes("guard") && c.missing.length === 0 && c.failed.length === 0, "scans still running: the legacy names are pending, not satisfied", c);
  const bad = GREEN(); bad[0] = run("versions", "completed", "failure");
  const d = cmChecks(bad, null, cmRequired(worker));
  ok(d.failed.includes("mirror-guard=failure") && d.failed.includes("comparator=failure") && d.failed.includes("guard=failure") && d.missing.length === 0, "versions failed: the legacy names fail with its conclusion", d);
  const bad2 = GREEN(); bad2[1] = run("scans", "completed", "cancelled");
  const e = cmChecks(bad2, null, cmRequired(worker));
  ok(e.failed.includes("guard=cancelled"), "scans cancelled: refused", e);
  const failedAndRunning = GREEN(); failedAndRunning[0] = run("versions", "completed", "failure"); failedAndRunning[1] = run("scans", "in_progress");
  const f = cmChecks(failedAndRunning, null, cmRequired(worker));
  ok(f.failed.length === 3, "a failed part decides even while the other part still runs", f);
  const timed = GREEN(); timed[0] = run("versions", "completed", "timed_out");
  ok(cmChecks(timed, null, cmRequired(worker)).failed.length === 3, "timed_out is a failure");
}

// a real run under the legacy name wins; other names are unchanged
{
  const real = GREEN().concat([run("mirror-guard", "completed"), run("comparator", "completed"), run("guard", "completed")]);
  const a = cmChecks(real, null, cmRequired(worker));
  ok(a.missing.length === 0 && a.failed.length === 0 && a.other.length === 0, "real legacy runs still satisfy their own names", a);
  const realFailed = GREEN().concat([run("mirror-guard", "completed", "failure"), run("comparator", "completed"), run("guard", "completed")]);
  const b = cmChecks(realFailed, null, cmRequired(worker));
  ok(b.failed.includes("mirror-guard=failure") && !b.failed.includes("comparator=failure"), "a real legacy run that failed is not rescued by green versions and scans", b);
  const test = cmChecks(GREEN(), null, ["test"]);
  ok(JSON.stringify(test.missing) === JSON.stringify(["test"]), "a name with no legacy meaning (test, for the code loop) is still required by its own run", test);
  const test2 = cmChecks(GREEN().concat([run("test", "completed")]), null, ["test"]);
  ok(test2.missing.length === 0, "and satisfied by it");
  const sup = [run("versions", "completed", "failure"), run("versions", "completed")];
  sup[1].id = sup[0].id + 5;
  ok(cmChecks(sup.concat([run("scans", "completed")]), null, ["comparator"]).failed.length === 0, "the latest run of versions decides (a re-run supersedes a failure)");
  const statusFail = cmChecks(GREEN(), { total_count: 1, state: "failure" }, cmRequired(worker));
  ok(statusFail.status === "failure", "the commit status is still reported", statusFail);
}

// source pin: cmChecks carries its own mapping (the other suites load cmChecks by itself, without module-level helpers), for the four legacy names only
{
  const body = fn("cmChecks");
  ok(/var legacyVia = \{ "mirror-guard": \["versions", "scans"\], comparator: \["versions", "scans"\], guard: \["versions", "scans"\], charter: \["versions", "scans"\] \};/.test(body), "cmChecks maps mirror-guard, comparator, guard and charter to versions and scans");
  ok(!/cmLegacyRun|CM_LEGACY_VIA/.test(src), "no module-level helper is needed by the other suites that slice cmChecks out of worker.js");
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
