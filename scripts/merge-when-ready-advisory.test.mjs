// LANE-ADVISORY-JOBS-1 offline suite (.github/workflows/merge-when-ready.yml). On 2026-11-04 a green pull request could not merge because its `poke / poke` check was
// "cancelled": lane-poke runs in one repository-wide concurrency group, GitHub marks every waiting run a newer one replaces as cancelled, and the readiness test below counted
// that cancelled check as failed. This suite reads the real jq filter out of the workflow and proves that the lane's own advisory jobs are outside the readiness set while every real
// guard stays inside it, and that the readiness arithmetic (at least 4 checks, none pending, none bad) is unchanged.
// Run: node --no-warnings scripts/merge-when-ready-advisory.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const yml = readFileSync(join(root, ".github/workflows/merge-when-ready.yml"), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 300) : "")); } };

const line = yml.split("\n").find((l) => /runs="\$\(gh api .*check-runs/.test(l));
ok(!!line, "the check-run query is present");
const m = line && /select\(\(\.name \| test\("([^"]+)"\)\) \| not\)/.exec(line);
ok(!!m, "the readiness filter excludes names by one anchored pattern");
const re = new RegExp(m ? m[1] : "$^");
const excluded = (n) => re.test(n);

for (const n of ["gate", "analyze (python)", "Workers Builds: qnfo-workers", "sweep"]) ok(excluded(n), "still outside the readiness set: " + n);
for (const n of ["poke / poke", "review / request", "lifecycle / sweep"]) ok(excluded(n), "advisory lane job is outside the readiness set: " + n);
for (const n of ["guard", "version-bump-guard / guard", "workflow-lint / lint", "mirror-guard / guard", "migration-guard / guard", "identity-guard / guard", "charter-guard / guard", "deploy-gate / gate-fast", "lint", "scan", "test", "comparator", "pokemon-guard / guard", "review-guard / guard"])
  ok(!excluded(n), "a real check stays inside the readiness set: " + n);

// the readiness arithmetic, as the workflow computes it with jq, over a head sha whose poke was cancelled by concurrency
const ready = (runs) => {
  const set = runs.filter((r) => !excluded(r.name));
  const pending = set.filter((r) => r.status !== "completed").length;
  const bad = set.filter((r) => r.status === "completed" && !["success", "skipped", "neutral"].includes(r.conclusion)).length;
  return set.length >= 4 && pending === 0 && bad === 0;
};
const done = (name, conclusion) => ({ name, status: "completed", conclusion });
const green = [done("guard", "success"), done("lint", "success"), done("scan", "success"), done("test", "success")];
ok(ready(green), "four green real checks are ready");
ok(ready(green.concat([done("poke / poke", "cancelled"), done("review / request", "cancelled")])), "a cancelled poke and review do not block a ready pull request");
ok(ready(green.concat([{ name: "poke / poke", status: "in_progress", conclusion: null }])), "a poke still running does not make it wait");
ok(!ready(green.concat([done("lint", "failure")])), "a failed real check still blocks");
ok(!ready(green.concat([{ name: "guard", status: "in_progress", conclusion: null }])), "a pending real check still waits");
ok(!ready(green.slice(0, 3).concat([done("poke / poke", "success")])), "fewer than four real checks is still not ready (an advisory job does not count toward the four)");
ok(!ready(green.concat([done("version-bump-guard / guard", "cancelled")])), "a cancelled real guard still blocks");

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
