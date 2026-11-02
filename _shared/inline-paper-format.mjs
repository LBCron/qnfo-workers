import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const source = readFileSync(new URL("paper-format.js", import.meta.url), "utf8").replace("export function", "function").trim();
const begin = "// PAPER-FORMAT-2:BEGIN";
const end = "// PAPER-FORMAT-2:END";
let stale = false;
for (const name of ["qnfo-gateway/worker.js", "qnfo-research-exec/worker.js", "qnfo-pdf/renderer.js"]) {
  const path = fileURLToPath(new URL(name, root));
  const before = readFileSync(path, "utf8");
  const a = before.indexOf(begin), b = before.indexOf(end);
  const block = begin + "\n" + source + "\n" + end + "\n";
  if ((a < 0) !== (b < 0) || (a >= 0 && b < a)) throw new Error("Invalid formatter markers in " + name);
  const clean = a < 0 ? before : before.slice(0, a) + before.slice(b + end.length).replace(/^\n/, "");
  const imports = Array.from(clean.matchAll(/^import [^\n]+;\n/gm));
  const last = imports[imports.length - 1];
  const at = last ? last.index + last[0].length : 0;
  const after = clean.slice(0, at) + block + clean.slice(at);
  if (after !== before) {
    stale = true;
    if (!process.argv.includes("--check")) writeFileSync(path, after);
  }
  if (!process.argv.includes("--check") && name.endsWith("/worker.js")) {
    writeFileSync(path.replace(/worker\.js$/, "deployed-current.worker.js"), after);
  }
}
if (process.argv.includes("--check") && stale) {
  console.error("Stale paper formatter: run node _shared/inline-paper-format.mjs then node qnfo-pdf/build.mjs");
  process.exitCode = 1;
}
