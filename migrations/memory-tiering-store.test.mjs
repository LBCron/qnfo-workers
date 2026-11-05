// MEMORY-TIERING-STORE-1 (agent_issues 1000637): the shape of migrations/2026-11-05-memory-tiering-store.sql that does not depend on live state. The views are
// exercised on SQLite by qnfo-memory-mcp/memory-tiering.test.mjs (which builds its AUDIT database from this file); here: headers, nothing destructive is run,
// the closing probe of the issue is untouched, and the doer anchor of the ROADMAP-1 row occurs once in the file it names.
// Run: node migrations/memory-tiering-store.test.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(here, "2026-11-05-memory-tiering-store.sql"), "utf8");
const worker = readFileSync(join(here, "..", "qnfo-memory-mcp", "worker.js"), "utf8");
let failed = 0, passed = 0;
const ok = (c, m) => { if (c) passed++; else { failed++; console.log("FAIL " + m); } };
const code = sql.replace(/^--.*$/gm, "");

ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: .+/m.test(sql), "migration headers are present");
ok(/^-- BACKUP: bak_20261105_f1e_memory$/m.test(sql) && /CREATE TABLE IF NOT EXISTS bak_20261105_f1e_memory AS/.test(code), "the backup table named in the header is created by the file");
ok(!/\bDELETE\b|\bDROP\b/i.test(code), "the migration runs no DELETE or DROP");
ok(!/UPDATE remediation_contracts[^;]*issue-1000637/.test(code) && !/class = 'issue-1000637'/.test(code), "the closing probe of issue-1000637 (the 30 day result document) is not touched");
ok(["memory_outcomes", "memory_tier_counts", "memory_consolidation_runs", "v_memory_tier_latest", "v_memory_outcome_hit_rate", "v_memory_tiering"].every((n) => new RegExp("CREATE (TABLE|VIEW) IF NOT EXISTS " + n + "\\b").test(code)), "three tables and three views are created");
ok(/UNIQUE \(memory_id, feedback_id\)/.test(code), "an outcome is unique per memory and feedback id (the idempotency key)");

// every table and view the worker reads or writes in qnfo-audit is created here
for (const name of ["memory_outcomes", "memory_tier_counts", "memory_consolidation_runs"]) ok(worker.includes(name), "the worker uses " + name);

const anchor = /code-anchor: (async function memoryTierSnapshot\(env\) \{)'/.exec(sql);
ok(!!anchor, "the ROADMAP-1 row carries a code-anchor");
ok(!!anchor && worker.split(anchor[1]).length - 1 === 1, "the anchor is a function signature that occurs exactly once in qnfo-memory-mcp/worker.js");
ok(/code-task: repo=qnfo-workers path=qnfo-memory-mcp\/worker\.js/.test(sql), "the ROADMAP-1 row names its code-task path");
ok(/verify_probe = 'SELECT ''ok'' AS expected, CASE WHEN EXISTS \(SELECT 1 FROM memory_consolidation_runs WHERE semantic_out > 0\)/.test(code), "the consolidation row closes on a measured run, not on a marker");
ok(!/;/.test((/verify_probe = '((?:[^']|'')*)'/.exec(code) || ["", ""])[1]), "no semicolon in the probe (PROBE-SEMICOLON-LINT-1)");

console.log(passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
