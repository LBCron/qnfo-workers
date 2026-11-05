// scripts/dependency-allowlist.test.mjs (BP26-AGENT-CHANGE-GATES-1, roadmap row 1414): the offline half of the dependency allow-list gate.
// The python script carries its own selftest (it builds throwaway trees and checks every rule); this suite runs it so the suite runner covers it, and checks that the
// allow-list file is well formed (a malformed or too-short reason would turn the gate off for that line).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + (x !== undefined ? "  -> " + String(x).slice(0, 400) : "")); } };
const py = process.platform === "win32" ? "python" : "python3";

const self = spawnSync(py, ["-I", "scripts/dependency_allowlist.py", "--selftest"], { encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
ok("the script's own selftest passes", self.status === 0 && /selftest ok/.test(self.stdout), self.stdout + self.stderr);

const lines = fs.readFileSync("scripts/dependency-allowlist.txt", "utf8").split("\n").filter((l) => l.trim() && !l.trim().startsWith("#"));
ok("the allow-list has entries", lines.length > 0);
ok("every entry is `where | package | reason` with a reason of 20 characters or more", lines.every((l) => { const p = l.split("|"); return p.length >= 3 && p[0].trim() && p[1].trim() && p.slice(2).join("|").trim().length >= 20; }), lines.find((l) => { const p = l.split("|"); return !(p.length >= 3 && p.slice(2).join("|").trim().length >= 20); }));
ok("no entry is listed twice", new Set(lines.map((l) => l.split("|").slice(0, 2).map((s) => s.trim()).join("|"))).size === lines.length);

const run = spawnSync(py, ["-I", "scripts/dependency_allowlist.py"], { encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
ok("the tree passes its own gate (a new dependency is declared in the same change)", run.status === 0, run.stdout);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
