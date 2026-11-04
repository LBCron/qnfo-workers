// MAIN-PUSH-POLICY-1 offline suite (docs/MAIN-PUSH-POLICY.md). Ruleset 26544275 `require-build` refuses direct pushes to main from the
// workflow token (GH013, 2026-11-04). This suite fails when a workflow step pushes to main directly without a documented bypass, so a new
// direct push cannot land unnoticed. A step that really runs with an admin/bypass credential carries the marker line
//   # MAIN-PUSH-BYPASS: <credential and reason>
// in the same step, and is listed in docs/MAIN-PUSH-POLICY.md.
// Run: node --no-warnings scripts/main-push-policy.test.mjs   -> prints "N passed, 0 failed"
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 600) : "")); } };

const PUSH_MAIN = /\bgit\s+(?:-\S+\s+)*push\b[^\n]*\b(?:HEAD:(?:refs\/heads\/)?main|origin\s+main|refs\/heads\/main)\b/;
// scripts that push to main themselves; a workflow that calls one needs the marker too
const MAIN_PUSHING_SCRIPTS = /\bcanary_revert\.py\b(?!.*--selftest)/;
const MARKER = /MAIN-PUSH-BYPASS:/;
// Known, tracked: scripts/canary_revert.py still pushes its revert to main (it was under another session's work claim when this policy
// landed). Follow-up: push the revert to a branch and open a pull request. Shrink-only: delete the entry when canary_revert.py is converted.
const PENDING = new Set(["canonical-deploy.yml", "deploy-code-orchestrator.yml"]);

const dir = join(root, ".github", "workflows");
const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort();
ok(files.length > 20, "workflow directory is read", files.length);

const offenders = [];
for (const f of files) {
  const lines = readFileSync(join(dir, f), "utf8").split("\n");
  // a "step" = the lines from one `- name:` / `- run:` / `- uses:` to the next; the marker must be inside the same step
  let start = 0;
  const stepOf = (i) => { let s = i; while (s > 0 && !/^\s*-\s+(name|run|uses|id|if|env|with):/.test(lines[s])) s--; let e = i + 1; while (e < lines.length && !/^\s*-\s+(name|run|uses|id):/.test(lines[e])) e++; return lines.slice(s, e).join("\n"); };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*#/.test(l)) continue;
    if (PUSH_MAIN.test(l) || MAIN_PUSHING_SCRIPTS.test(l)) {
      if (!MARKER.test(stepOf(i)) && !(PENDING.has(f) && MAIN_PUSHING_SCRIPTS.test(l))) offenders.push(f + ":" + (i + 1) + "  " + l.trim().slice(0, 120));
    }
  }
}
ok(offenders.length === 0, "no workflow step pushes to main without a `# MAIN-PUSH-BYPASS:` marker (use scripts/push_head.sh)", offenders);

// the helpers themselves must never push to main
for (const f of ["scripts/push_head.sh", "scripts/push_artifact.sh"]) {
  const txt = readFileSync(join(root, f), "utf8").split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  ok(!PUSH_MAIN.test(txt) && !/:refs\/heads\/main\b/.test(txt), f + " does not push to main");
}
// the artifact branch is the documented target
const ph = readFileSync(join(root, "scripts/push_head.sh"), "utf8");
ok(/refs\/heads\/fleet-artifacts/.test(ph) && /\[skip ci\]/.test(ph), "push_head.sh publishes to fleet-artifacts and drops [skip ci] from pull-request commits");
// every caller of push_head.sh can reach it and, for code mode, may open a pull request
for (const f of files) {
  const t = readFileSync(join(dir, f), "utf8");
  if (/push_head\.sh code/.test(t)) ok(/pull-requests:\s*write/.test(t), f + " uses push_head.sh code and grants pull-requests: write");
}
// the policy document lists the helper and the ruleset it answers
const doc = join(root, "docs", "MAIN-PUSH-POLICY.md");
ok(existsSync(doc) && /require-build/.test(readFileSync(doc, "utf8")) && /fleet-artifacts/.test(readFileSync(doc, "utf8")), "docs/MAIN-PUSH-POLICY.md exists and names the ruleset and the artifact branch");

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
