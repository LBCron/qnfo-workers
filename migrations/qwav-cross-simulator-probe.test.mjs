// QWAV-CROSS-SIMULATOR-PROBE-1 (agent_issues 1000642): the closing probe and the doer anchor written by migrations/2026-11-05-qwav-cross-simulator-probe.sql.
// Offline and independent of live state: the probe text must be the exact line the coverage tooling prints once every demo repository is covered, and the
// anchor of the ROADMAP-1 row must occur exactly once in the file the code loop is told to edit.
// Run: node migrations/qwav-cross-simulator-probe.test.mjs
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const sql = readFileSync(join(here, "2026-11-05-qwav-cross-simulator-probe.sql"), "utf8");
const script = readFileSync(join(root, "scripts", "qwav_golden_crosscheck.py"), "utf8");
let failed = 0, passed = 0;
const ok = (c, m) => { if (c) passed++; else { failed++; console.log("FAIL " + m); } };

ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: .+/m.test(sql), "migration headers are present");
ok(!/\bDELETE\b|\bDROP\b/i.test(sql.replace(/^--.*$/gm, "")), "the migration deletes and drops nothing");

const probe = /verify_probe = '(\{[^']*\})'/.exec(sql);
ok(!!probe, "the migration sets a code-read probe");
const spec = probe ? JSON.parse(probe[1]) : {};
ok(JSON.stringify(spec.paths) === JSON.stringify(["docs/QWAV-CROSS-SIMULATOR.md"]) && spec.contains === "All published demos covered: yes", "the probe reads the document's coverage line: " + JSON.stringify(spec));
ok(/verify_transport = 'code-read'/.test(sql), "the probe's transport is code-read");

// the line the probe waits for is the line the tooling prints when every repository is covered
const python = ["python3", "python"].find((c) => { const r = spawnSync(c, ["-c", "print(3)"], { encoding: "utf8" }); return r.status === 0 && String(r.stdout).trim() === "3"; });
ok(!!python, "python 3 is available");
if (python) {
  const code = "import sys; sys.path.insert(0, " + JSON.stringify(join(root, "scripts")) + "); import qwav_golden_crosscheck as c; print(c.coverage_verdict(True))";
  const r = spawnSync(python, ["-c", code], { encoding: "utf8" });
  ok(String(r.stdout).trim() === spec.contains, "with every demo covered the tooling prints exactly the probe's line: " + String(r.stdout).trim() + String(r.stderr).slice(0, 200));
}

// the ROADMAP-1 row's anchor
const anchor = /code-anchor: (\{"repo": "qwav-demos"[^\n']*)'/.exec(sql);
ok(!!anchor, "the follow-up row carries a code-anchor");
if (anchor) ok(script.split(anchor[1]).length - 1 === 1, "the anchor occurs exactly once in scripts/qwav_golden_crosscheck.py: " + anchor[1]);
ok(/code-task: repo=qnfo-workers path=scripts\/qwav_golden_crosscheck\.py/.test(sql), "the follow-up row names its code-task path");
ok(/code-probe: \{"paths": \["docs\/QWAV-CROSS-SIMULATOR\.md"\], "contains": "All published demos covered: yes"\}/.test(sql), "the follow-up row closes on the same line");

console.log(passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
