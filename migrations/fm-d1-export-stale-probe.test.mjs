import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

// FM-D1-EXPORT-PROBE-1: the probe lists the same eight databases without a compound SELECT and gives the same verdict.
const migration = readFileSync(new URL("./2026-11-04-fm-d1-export-stale-probe.sql", import.meta.url), "utf8");
assert.match(migration, /^-- APPLY-BY: ci$/m);
assert.match(migration, /^-- DB: qnfo-audit$/m);
assert.match(migration, /^-- Rollback: /m);

const OLD = "SELECT '0' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM (SELECT 'qnfo-audit' AS db UNION ALL SELECT 'living-paper' UNION ALL SELECT 'q08-signal' UNION ALL SELECT 'personal-life' UNION ALL SELECT 'portfolio-state' UNION ALL SELECT 'qnfo-graph' UNION ALL SELECT 'ipatent-db' UNION ALL SELECT 'qnfo-cms') d WHERE NOT EXISTS (SELECT 1 FROM continuity_snapshots n WHERE n.ok = 1 AND n.r2_prefix LIKE 'qnfo-backups/export/' || d.db || '/%' AND n.ts > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-9 days'))";
const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE remediation_contracts (class TEXT, verify_probe TEXT); CREATE TABLE continuity_snapshots (ok INTEGER, r2_prefix TEXT, ts TEXT)");
db.prepare("INSERT INTO remediation_contracts VALUES ('fm-d1-export-stale', ?)").run(OLD);
const now = new Date().toISOString();
for (const n of ["qnfo-audit", "living-paper", "q08-signal", "personal-life", "portfolio-state", "qnfo-graph", "ipatent-db"]) db.prepare("INSERT INTO continuity_snapshots VALUES (1, ?, ?)").run("qnfo-backups/export/" + n + "/2026", now);
const before = db.prepare(OLD).get();
db.exec(migration);
const probe = db.prepare("SELECT verify_probe p FROM remediation_contracts").get().p;
assert.ok(!/UNION ALL/.test(probe), "no compound SELECT left");
const after = db.prepare(probe).get();
assert.deepEqual({ ...after }, { ...before }, "same verdict (qnfo-cms has no export: observed 1)");
assert.equal(after.observed, "1");
db.exec(migration); // idempotent
assert.equal(db.prepare("SELECT verify_probe p FROM remediation_contracts").get().p, probe);
console.log("fm-d1-export-stale-probe: ok");
