/**
 * improvement-nonfix-closure.test.mjs -- offline regression lock for IL-NONFIX-CLOSURE-1 (pillar autonomy; metric fix_hold_rate_30d).
 * Measured 2026-11-05 on qnfo-audit: of the 276 METRIC-TRIGGER / OBJECTIVE-CONSTRAINT-BREACH-1 / METRIC-REGRESSION-1 issues closed in the last 31 days, 67 were closed by a
 * supersede or a moot finding (close_evidence "SUPERSEDED BY #<id>" / "superseded by <id>" from METRIC-TWIN-SUPERSEDE-1 and the persona tick, "MOOT: ..."), which fixes nothing: the
 * metric is carried by the successor ticket. The improvement loop judged them "did the fix hold" like a remediation: 27 of the 48 relapses behind fix_hold_rate_30d 0.6923
 * (108 held of 156 judged) were such closures (the metric was still off its trigger, which is why a successor existed), and each filed (or would file) a METRIC-FIX-RELAPSED-1
 * for a fix nobody made.
 * Proves:
 *   - a closure whose close_evidence starts "superseded" or "moot:" (any case) is not judged by fix_hold_rate_30d, records no relapse and files no finding;
 *   - the strict view fix_target_hold_rate_30d keeps every closure in its denominator (the guard is not weakened: closures_judged counts them all);
 *   - a mixed set (one held fix, one superseded closure whose metric is off its trigger) reads fix_hold_rate_30d 1 (1 of 1) and fix_target_hold_rate_30d over both;
 *   - a recovery closure ("TRIGGER-RECOVERY-1 ...", "MANAGEMENT-PERSONAS-2 metric recovered: ...") and a closure with no close_evidence are judged exactly as before.
 * Output MUST contain "0 failed" on success.
 *
 *   node qnfo-fleet-control/improvement-nonfix-closure.test.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "worker.js"), "utf8");
const BEGIN = "// ---- IMPROVEMENT-LOOP-1:BEGIN";
const END = "// ---- IMPROVEMENT-LOOP-1:END ----";
const a = src.indexOf(BEGIN), b = src.indexOf(END);
if (a < 0 || b < 0 || b < a) { console.error("FAIL improvement block markers missing"); console.log("1 failed"); process.exit(1); }
const ca = src.indexOf("// ---- CHARTER-LOOP-1:BEGIN"), cb = src.indexOf("// ---- CHARTER-LOOP-1:END ----");
if (ca < 0 || cb < 0) { console.error("FAIL charter block markers missing"); console.log("1 failed"); process.exit(1); }
const sandbox = { fetch: async () => { throw new Error("offline"); }, AbortSignal, VERSION: "test", timedFetch: null, b64encode: null, sha256: null, console, Date, Math, JSON, Number, String, Object, Array, RegExp, isNaN, isFinite, TextDecoder, atob, __export: null };
vm.createContext(sandbox);
vm.runInContext(src.slice(ca, cb + "// ---- CHARTER-LOOP-1:END ----".length) + "\n" + src.slice(a, b + END.length) + "\n__export = { improvementEvaluate };", sandbox);
const I = sandbox.__export;

let passed = 0, failed = 0;
function eq(actual, expected, label) { if (actual === expected) { passed++; return; } failed++; console.error(`FAIL ${label}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`); }
const NOW = Date.parse("2026-11-05T12:00:00Z");
const day = (n) => new Date(NOW - n * 864e5).toISOString().slice(0, 10);
const reg = (metric, target) => ({ metric, target, state: "MEASURED" });
const histOf = (metric, values, meetsFn) => values.map((v, k) => ({ metric, day: day(k), value: v, meets: meetsFn(v) }));
const closedAt = (n) => day(n) + " 06:00:00";
const relapseFindings = (x) => x.findings.filter((fd) => fd.key.indexOf("METRIC-FIX-RELAPSED-1") === 0);

// monthly_cost_run_rate_usd: trigger 3689 gt 650; the ticket 2677 was closed 5 days ago as superseded by 99938, the metric is still far above 650
const COST_VALUES = [1100, 1150, 1200, 1180, 1100, 1000, 900, 900, 900, 900, 900, 900, 900, 900];
const costHist = histOf("monthly_cost_run_rate_usd", COST_VALUES, (v) => (v <= 650 ? 1 : 0));
const costFacts = (closed) => ({ registry: [reg("monthly_cost_run_rate_usd", "<= 650")], history: costHist, closed_issues: closed, trigger_metric: { "3689": "monthly_cost_run_rate_usd" }, trigger_pred: { "3689": { operator: "gt", threshold: 650 } } });
const COST = (evidence) => ({ id: 2677, title: "METRIC-TRIGGER-3689-MONTHLY-COST-RUN-RATE-USD: Cost: all-billing 7-day run rate over 650/30d", closed_at: closedAt(5), close_evidence: evidence });

// a baseline: the same closure with no close_evidence field is judged as before (a relapse, the trigger is hit on every day since)
let x = I.improvementEvaluate(costFacts([COST(undefined)]), NOW);
eq(x.fixes_judged, 1, "no evidence: judged");
eq(x.fixes_held, 0, "no evidence: not held");
eq(x.fix_hold_rate_30d, 0, "no evidence: fix_hold_rate_30d 0");
eq(x.relapses.length, 1, "no evidence: relapse recorded");

for (const ev of ["SUPERSEDED BY #99938: trigger 3689 is disabled", "superseded by 99938 (METRIC-TRIGGER-3689-MONTHLY-COST-RUN-RATE-USD: Cost)", "  Superseded by #99938", "MOOT: trigger 409 is disabled", "moot: the ticket tracks nothing"]) {
  x = I.improvementEvaluate(costFacts([COST(ev)]), NOW);
  eq(x.fixes_judged, 0, "non-fix (" + ev.slice(0, 14) + "): not judged by fix_hold_rate_30d");
  eq(x.fix_hold_rate_30d, null, "non-fix (" + ev.slice(0, 14) + "): fix_hold_rate_30d has no sample");
  eq(x.relapses.length, 0, "non-fix (" + ev.slice(0, 14) + "): no relapse recorded");
  eq(relapseFindings(x).length, 0, "non-fix (" + ev.slice(0, 14) + "): no METRIC-FIX-RELAPSED-1 finding");
  eq(x.closures_judged, 1, "non-fix (" + ev.slice(0, 14) + "): the strict view still counts the closure");
  eq(x.fix_target_hold_rate_30d, 0, "non-fix (" + ev.slice(0, 14) + "): fix_target_hold_rate_30d keeps the miss (guard not weakened)");
  eq(x.closures_non_fix, 1, "non-fix (" + ev.slice(0, 14) + "): counted apart");
}

// recovery closures are fixes and are judged
for (const ev of ["TRIGGER-RECOVERY-1 2026-10-26T06:31:08Z: monthly_cost_run_rate_usd=640 no longer", "MANAGEMENT-PERSONAS-2 metric recovered: monthly_cost_run_rate_usd reads 640", "remediation_verifications#522065 pass=1 class=issue-2677"]) {
  x = I.improvementEvaluate(costFacts([COST(ev)]), NOW);
  eq(x.fixes_judged, 1, "recovery (" + ev.slice(0, 14) + "): judged");
  eq(x.relapses.length, 1, "recovery (" + ev.slice(0, 14) + "): relapse recorded as before");
  eq(x.closures_non_fix, 0, "recovery (" + ev.slice(0, 14) + "): not a non-fix closure");
}

// mixed: one real fix that held (gateway_cap) and the superseded cost ticket
const GW_VALUES = [150, 150, 150, 150, 150, 150, 150, 150, 150, 150, 150, 150, 150, 150];
const gwHist = histOf("gateway_cap_30d_usd", GW_VALUES, (v) => (v <= 150 ? 1 : 0));
const GW = { id: 2778, title: "METRIC-TRIGGER-364-GATEWAY-CAP-30D-USD: Cost gap: AI gateway cap above $180/30d", closed_at: closedAt(10), close_evidence: "TRIGGER-RECOVERY-1 2026-10-25T06:00:00Z: gateway_cap_30d_usd=150 no longer" };
const mixed = { registry: [reg("monthly_cost_run_rate_usd", "<= 650"), reg("gateway_cap_30d_usd", "<=150 (owner threshold)")], history: costHist.concat(gwHist), closed_issues: [GW, COST("SUPERSEDED BY #99938: trigger 3689 is disabled")], trigger_metric: { "3689": "monthly_cost_run_rate_usd", "364": "gateway_cap_30d_usd" }, trigger_pred: { "3689": { operator: "gt", threshold: 650 }, "364": { operator: "gt", threshold: 180 } } };
x = I.improvementEvaluate(mixed, NOW);
eq(x.fixes_judged, 1, "mixed: one fix judged");
eq(x.fixes_held, 1, "mixed: it held");
eq(x.fix_hold_rate_30d, 1, "mixed: fix_hold_rate_30d is 1 of 1");
eq(x.closures_judged, 2, "mixed: the strict view counts both closures");
eq(x.fixes_held_target, 1, "mixed: one held against the target");
eq(x.fix_target_hold_rate_30d, 0.5, "mixed: fix_target_hold_rate_30d is 1 of 2");
eq(x.relapses.length, 0, "mixed: the superseded closure records no relapse");

// the loader and the markers
eq(src.includes("substr(COALESCE(t.close_evidence, ''), 1, 40) AS close_evidence"), true, "the closed_issues query selects close_evidence");
eq(src.includes("IL-NONFIX-CLOSURE-1"), true, "worker.js carries IL-NONFIX-CLOSURE-1");

console.log(`improvement-nonfix-closure.test: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
