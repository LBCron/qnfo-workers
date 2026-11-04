// Re-inlines _shared/paper-canonical.js into qnfo-research-exec/worker.js between the PAPER-CANONICAL-1 markers, right after the
// PAPER-FORMAT-2 block it depends on, and mirrors the result to deployed-current.worker.js.
// Run: node _shared/inline-paper-canonical.mjs   (--check only reports a stale copy)
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const source = readFileSync(new URL("paper-canonical.js", import.meta.url), "utf8").replace(/^export function/gm, "function").trim();
const begin = "// PAPER-CANONICAL-1:BEGIN";
const end = "// PAPER-CANONICAL-1:END";
const fmtEnd = "// PAPER-FORMAT-2:END\n";
const path = fileURLToPath(new URL("qnfo-research-exec/worker.js", root));
const before = readFileSync(path, "utf8");
const a = before.indexOf(begin), b = before.indexOf(end);
if ((a < 0) !== (b < 0) || (a >= 0 && b < a)) throw new Error("Invalid canonical markers");
const clean = a < 0 ? before : before.slice(0, a) + before.slice(b + end.length).replace(/^\n/, "");
const at = clean.indexOf(fmtEnd);
if (at < 0) throw new Error("PAPER-FORMAT-2 block not found");
const block = begin + "\n" + source + "\n" + end + "\n";
const after = clean.slice(0, at + fmtEnd.length) + block + clean.slice(at + fmtEnd.length);
if (after !== before) {
  if (process.argv.includes("--check")) { console.error("Stale canonical formatter: run node _shared/inline-paper-canonical.mjs"); process.exitCode = 1; }
  else {
    writeFileSync(path, after);
    writeFileSync(path.replace(/worker\.js$/, "deployed-current.worker.js"), after);
    console.log("inlined " + source.length + " bytes");
  }
}
