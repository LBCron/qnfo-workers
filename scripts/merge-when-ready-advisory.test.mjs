// LANE-ADVISORY-JOBS-1 and PR-CHECK-CAP-5-1 offline suite (.github/workflows/pr-lane.yml, the merge step; it was merge-when-ready.yml). On 2026-11-04 a green pull request could not merge
// because its `poke / poke` check was "cancelled": lane-poke ran in one repository-wide concurrency group, GitHub marks every waiting run a newer one replaces as cancelled, and the
// readiness test below counted that cancelled check as failed. The lane is now one job named `lane`, which is running while it reads the check list, so it must be outside the list too.
// This suite reads the real jq filter out of the workflow and proves that the lane's own entries are outside the readiness set while every real guard stays inside it, and that the
// readiness arithmetic (at least 3 checks: versions, scans, suites; none pending, none bad) holds.
// Run: node --no-warnings scripts/merge-when-ready-advisory.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const yml = readFileSync(join(root, ".github/workflows/pr-lane.yml"), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 300) : "")); } };

const line = yml.split("\n").find((l) => /runs="\$\(gh api .*check-runs/.test(l));
ok(!!line, "the check-run query is present");
const m = line && /select\(\(\.name \| test\("([^"]+)"\)\) \| not\)/.exec(line);
ok(!!m, "the readiness filter excludes names by one anchored pattern");
const re = new RegExp(m ? m[1] : "$^");
const excluded = (n) => re.test(n);

for (const n of ["gate", "analyze (python)", "Workers Builds: qnfo-workers", "sweep"]) ok(excluded(n), "still outside the readiness set: " + n);
for (const n of ["lane", "poke / poke", "review / request", "lifecycle / sweep"]) ok(excluded(n), "the lane's own entry is outside the readiness set: " + n);
for (const n of ["versions", "scans", "suites", "guard", "version-bump-guard / guard", "workflow-lint / lint", "mirror-guard / guard", "migration-guard / guard", "identity-guard / guard", "charter-guard / guard", "deploy-gate / gate-fast", "lint", "scan", "test", "comparator", "pokemon-guard / guard", "review-guard / guard", "lanes", "plane", "lane-guard"])
  ok(!excluded(n), "a real check stays inside the readiness set: " + n);

// the readiness arithmetic, as the workflow computes it with jq, over a head sha whose lane entry is still running
const threshold = /"\$total" -lt (\d+)/.exec(yml);
ok(!!threshold && threshold[1] === "3", "the merge waits for at least 3 real checks", threshold && threshold[1]);
const ready = (runs) => {
  const set = runs.filter((r) => !excluded(r.name));
  const pending = set.filter((r) => r.status !== "completed").length;
  const bad = set.filter((r) => r.status === "completed" && !["success", "skipped", "neutral"].includes(r.conclusion)).length;
  return set.length >= 3 && pending === 0 && bad === 0;
};
const done = (name, conclusion) => ({ name, status: "completed", conclusion });
const running = (name) => ({ name, status: "in_progress", conclusion: null });
const green = [done("versions", "success"), done("scans", "success"), done("suites", "success")];
ok(ready(green), "three green real checks are ready");
ok(ready(green.concat([running("lane")])), "the lane's own running entry does not make it wait for itself");
ok(ready(green.concat([done("Workers Builds: qnfo-workers", "success")])), "the external build check does not count toward the three or block");
ok(ready(green.concat([done("poke / poke", "cancelled"), done("review / request", "cancelled")])), "a cancelled retired advisory entry does not block a ready pull request");
ok(!ready(green.concat([done("scans", "failure")])), "a failed real check still blocks");
ok(!ready(green.concat([running("suites")])), "a pending real check still waits");
ok(!ready(green.slice(0, 2).concat([done("lane", "success")])), "fewer than three real checks is still not ready (the lane entry does not count toward the three)");
ok(!ready(green.concat([done("versions", "cancelled")])), "a cancelled real guard still blocks");

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
