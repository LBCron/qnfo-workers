// COMPANION-RETARGET-1 / COMPANION-REGENERATE-1: personal-api worker.js tasks reach the code loop through companion.js.
import fs from "node:fs";
import assert from "node:assert";
const w = fs.readFileSync("qnfo-code-orchestrator/worker.js", "utf8");
const p = fs.readFileSync("scripts/code-task-publish.py", "utf8");
assert.ok(/COMPANION-RETARGET-1: edit the companion source/.test(w), "orchestrator retargets worker.js tasks that fail the companion parity suite");
assert.ok(/code-task\.companion-retarget/.test(w));
assert.ok(/COMPANION-REGENERATE-1/.test(p) && /inline-companion\.mjs/.test(p), "publisher regenerates worker.js and its mirror");
assert.ok(/"personal-api\/deployed-current\.worker\.js"/.test(p));
assert.strictEqual(fs.readFileSync("qnfo-code-orchestrator/deployed-current.worker.js", "utf8"), w);
console.log("ok");
