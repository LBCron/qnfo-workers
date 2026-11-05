// CF-ESTATE-1 (NEXT-QNFO.INFRA.DNS): a change to docs/DOMAINS.md runs the plane check on it in the pull request, because docs/ changes select this directory's suites
// and the host table is what scripts/cf_estate.py dns-drift reads. A row that stops parsing, or a personal host outside q08.org, fails here and not at the next live run.
// Run: node --no-warnings docs/domains-doc.test.mjs   -> prints "N passed, 0 failed"
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + String(x).slice(0, 800) : "")); } };
const root = fileURLToPath(new URL("..", import.meta.url));
const r = spawnSync("python3", ["-I", "scripts/cf_estate.py", "doc-check"], { encoding: "utf8", cwd: root });
ok(r.status === 0, "doc-check exits 0 (the host table parses and its planes hold)", (r.stdout || "") + (r.stderr || ""));
const line = ((r.stdout || "").split("\n").find((l) => l.startsWith("RESULT_JSON=")) || "RESULT_JSON={}").slice("RESULT_JSON=".length);
const res = JSON.parse(line);
ok(res.rows >= 25 && res.hosts >= 50, "the table has its rows and hosts", res);
ok(Array.isArray(res.plane_violation) && res.plane_violation.length === 0, "no plane violation", res.plane_violation);
console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
