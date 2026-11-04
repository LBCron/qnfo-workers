// IMPROVEMENT-NO-DEAD-DOER-1 (qnfo-fleet-control 0.63.1, pillar autonomy; GitHub 6766 and 6881, agent_issues 1001472, Cloudflare group f8afe685).
// worker.js bundles other workers as namespaces: `var advisorMod = (function() { ... })();` at column 0. A helper declared inside one of them
// (d1All, d1Run, probeHealth, ...) does not exist outside it. PR 6658 added a call to d1Run in improvementLoopTick, outside the advisor
// namespace, and the hourly tick logged "d1Run is not defined" 22 times in a day. node --check cannot see a free identifier, so this
// suite does: no call to a function declared only inside a namespace may appear outside every namespace.
// Run: node qnfo-fleet-control/no-namespace-leak.test.mjs   (prints "0 failed" on success)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// Pure: { ranges: [[firstLine, lastLine]], inside: Set(names declared inside a namespace and not at column 0), leaks: [{ name, line }] }
export function findNamespaceLeaks(src) {
  const lines = src.split("\n");
  const ranges = [];
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (start < 0 && /^var [A-Za-z_$][\w$]* = \((?:function\s*\(\)|\(\) =>)\s*\{?\s*$/.test(lines[i])) start = i;
    else if (start >= 0 && /^\}\)\(\);?\s*$/.test(lines[i])) { ranges.push([start, i]); start = -1; }
  }
  const inRange = (i) => ranges.some(([a, b]) => i >= a && i <= b);
  const declRe = /^(\s*)(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/;
  const inside = new Set(), outsideDecl = new Set();
  for (let i = 0; i < lines.length; i++) {
    const m = declRe.exec(lines[i]);
    if (!m) continue;
    (inRange(i) ? inside : outsideDecl).add(m[2]);
  }
  for (const n of outsideDecl) inside.delete(n);
  const leaks = [];
  for (let i = 0; i < lines.length; i++) {
    if (inRange(i)) continue;
    const t = lines[i].trim();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) continue;
    for (const n of inside) {
      const re = new RegExp("(^|[^\\w$.\"'])" + n.replace(/\$/g, "\\$") + "\\(");
      const d = declRe.exec(lines[i]);
      if (re.test(lines[i]) && !(d && d[2] === n && lines[i].replace(/^\s*(?:async\s+)?function\s+[\w$]+\s*\(/, "").indexOf(n + "(") < 0)) leaks.push({ name: n, line: i + 1 });
    }
  }
  return { ranges, inside, leaks };
}

let passed = 0, failed = 0;
function check(cond, label, extra) { if (cond) passed++; else { failed++; console.error("FAIL " + label + (extra ? " -- " + JSON.stringify(extra).slice(0, 400) : "")); } }

// the detector itself, on a synthetic file shaped like worker.js
const synthetic = [
  "var ns = (function() {",
  "  async function d1Run(env) { return 1; }",
  "  function used() { return d1Run(); }",
  "})();",
  "async function shared() { return 2; }",
  "async function tick() { await shared(); await d1Run(env, 'x'); }",
  "// d1Run(env) in a comment is fine",
].join("\n");
const s = findNamespaceLeaks(synthetic);
check(s.ranges.length === 1 && s.inside.has("d1Run") && !s.inside.has("shared"), "synthetic: namespace and its private helper found", { ranges: s.ranges, inside: [...s.inside] });
check(s.leaks.length === 1 && s.leaks[0].name === "d1Run" && s.leaks[0].line === 6, "synthetic: the call outside the namespace is the one leak", s.leaks);
const ok = findNamespaceLeaks(synthetic.replace("await d1Run(env, 'x');", ""));
check(ok.leaks.length === 0, "synthetic: no leak once the call is gone", ok.leaks);

// the real file
const src = readFileSync(process.env.WORKER_JS || join(here, "worker.js"), "utf8");
const real = findNamespaceLeaks(src);
check(real.ranges.length >= 2, "worker.js: its namespaces are recognised", real.ranges);
check(real.inside.has("d1Run") && real.inside.has("d1All"), "worker.js: d1Run and d1All are namespace-private helpers", [...real.inside].slice(0, 20));
check(real.leaks.length === 0, "worker.js: no call to a namespace-private function outside its namespace", real.leaks);
check(!/\bd1Run\(env, "SELECT issue_id FROM program_focus/.test(src), "worker.js: the program_focus doer step that called d1Run is gone");

console.log((failed ? failed + " failed" : "0 failed") + ", " + passed + " passed");
process.exit(failed ? 1 : 0);
