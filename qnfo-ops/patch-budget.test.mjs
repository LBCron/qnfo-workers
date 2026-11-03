import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const source = readFileSync(new URL("./worker.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const orchestrator = readFileSync(new URL("../qnfo-code-orchestrator/worker.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const section = (start, end) => {
  const a = orchestrator.indexOf(start), b = orchestrator.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `source section ${start}`);
  return orchestrator.slice(a, b);
};
const { hunkPatch, bumpVersion, limit } = new Function(
  "const countOf = (text, needle) => text.split(needle).length - 1;\n" +
  section("const VERSION_DECL =", "// NOOP-PROPOSAL-GATE-1") +
  section("function wholeFilePatch(", "// SELF-REPAIR-1") +
  "const DIFF_MAX_D = " + /const DIFF_MAX_D = (\d+)/.exec(orchestrator)[1] + ";\n" +
  section("function lineOps(", "// REPAIR-SHOWS-EDITS-1") +
  "return {hunkPatch, bumpVersion, limit: " + /const MAX_PATCH_CHARS = (\d+)/.exec(orchestrator)[1] + "};"
)();
const proposal = (base) => bumpVersion(base, base.replace("var OPS_TOOLS = [", "var CODEMODE_PATCH_BUDGET = true;\nvar OPS_TOOLS = ["));
const patchFor = (base, next) => ["worker.js", "deployed-current.worker.js"]
  .map((file) => hunkPatch("qnfo-ops/" + file, base, next)).join("");
const next = proposal(source), patch = patchFor(source, next);
assert.ok(patch.length <= limit, `representative mirrored patch is ${patch.length} chars, limit ${limit}`);
assert.equal(source, readFileSync(new URL("./deployed-current.worker.js", import.meta.url), "utf8").replace(/\r\n/g, "\n"));

const flattened = source.replace(/^(var VERSION = "[^"]+";)\n((?:\/\*.*\*\/\n)+)/m,
  (_, version, notes) => version + " " + notes.trim().replace(/\n/g, " ") + "\n");
assert.notEqual(flattened, source);
assert.ok(patchFor(flattened, proposal(flattened)).length > limit, "the historical same-line notes reproduce the failure");

const work = mkdtempSync(join(tmpdir(), "ops-patch-budget-"));
try {
  mkdirSync(join(work, "qnfo-ops"));
  for (const file of ["worker.js", "deployed-current.worker.js"]) writeFileSync(join(work, "qnfo-ops", file), source);
  execFileSync("git", ["apply", "-"], { cwd: work, input: patch });
  for (const file of ["worker.js", "deployed-current.worker.js"]) assert.equal(readFileSync(join(work, "qnfo-ops", file), "utf8"), next);
} finally {
  rmSync(work, { recursive: true, force: true });
}
console.log(`Mirrored version bump plus code edit: ${patch.length}/${limit} chars; git apply round-trip passed`);
