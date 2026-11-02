import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "worker.js"), "utf8");
const categoryMatch = source.match(/^var EVOLVE_CATEGORIES = (\[[^\n]+\]);$/m);
assert.ok(categoryMatch, "EVOLVE-PR-1 category allowlist exists");
const categories = JSON.parse(categoryMatch[1]);
assert.ok(categories.includes("code-defect"), "code-defect issues are eligible for EVOLVE-PR-1");

const proposeStart = source.indexOf("async function evPropose(env) {");
const proposeEnd = source.indexOf("\n__name(evPropose", proposeStart);
assert.ok(proposeStart >= 0 && proposeEnd > proposeStart, "EVOLVE-PR-1 proposal selector exists");
const propose = source.slice(proposeStart, proposeEnd);
assert.match(propose, /JOIN issue_triage t ON t\.issue_id=a\.id/, "the responsible worker comes from issue_triage");
assert.match(propose, /a\.category IN \(" \+ EVOLVE_CATEGORIES/, "only explicitly eligible defect categories are proposed");
assert.match(propose, /COALESCE\(a\.description,''\) NOT LIKE '%code-task:%'/, "code-loop-owned issues are not proposed twice");
assert.match(propose, /var iss = cands\[i\], worker = String\(iss\.owner \|\| ""\)/, "the assigned worker is the EVOLVE target");
assert.match(propose, /EVOLVE_DENY\.indexOf\(worker\) >= 0/, "denied workers remain excluded");
assert.match(propose, /evReadFile\(env, worker \+ "\/worker\.js", "main"\)/, "the selected worker must have a readable source file");

console.log("evolve-code-defect: all passed");
