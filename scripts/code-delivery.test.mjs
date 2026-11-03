import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { hasCodeChanges, withCodeDeliveryDoD, CODE_DELIVERY_DOD } from "./code-delivery.mjs";

for (const files of [[], [{ filename: "docs/report.md" }], [{ filename: "CLAUDE.md" }], [{ filename: "note.txt" }], [{ filename: "investigation.json" }], [{ filename: "docs/sample.js" }], [{ filename: "w/worker.js", additions: 0, deletions: 0 }]]) {
  assert.equal(hasCodeChanges(files), false);
}
for (const filename of ["w/worker.js", "scripts/check.py", "migrations/fix.sql", ".github/workflows/build.yml"]) {
  assert.equal(hasCodeChanges([{ filename, additions: 1, deletions: 0 }]), true);
}
assert.equal(hasCodeChanges([{ filename: "w/worker.js", additions: 0, deletions: 1 }]), true);
const body = withCodeDeliveryDoD("Fixes #7");
assert.ok(body.startsWith("Fixes #7"));
assert.ok(body.includes(CODE_DELIVERY_DOD));
assert.equal(withCodeDeliveryDoD(body), body);
const template = readFileSync(new URL("../.github/PULL_REQUEST_TEMPLATE.md", import.meta.url), "utf8");
assert.ok(template.includes("Definition of done (CODE-CHANGE-REQUIRED-1)"));
assert.ok(template.includes("This PR implements the remedy in code"));
const python = spawnSync("python3", ["-c", "from scripts.code_delivery import numstat_has_code_changes; assert numstat_has_code_changes('1\\t0\\tscripts/fix.py\\n'); assert not numstat_has_code_changes('1\\t0\\tdocs/report.md\\n'); assert not numstat_has_code_changes('0\\t0\\tw/worker.js\\n'); assert not numstat_has_code_changes('1\\t0\\treport.json\\n')"], { encoding: "utf8", cwd: new URL("..", import.meta.url) });
assert.equal(python.status, 0, python.stderr);
console.log("code-delivery: passed");
