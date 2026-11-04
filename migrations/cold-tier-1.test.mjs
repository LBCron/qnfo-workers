// COLD-TIER-1 (2026-11-04, pillar cost): the ledger, rollup table, knob, failure mode and closing probe. The archive itself is tested by `python scripts/cold_tier.py --selftest`.
// Run: node --no-warnings migrations/cold-tier-1.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const mig = readFileSync(new URL("./2026-11-04-cold-tier-1.sql", import.meta.url), "utf8");
assert.match(mig, /^-- APPLY-BY: ci$/m);
assert.match(mig, /^-- DB: qnfo-audit$/m);
assert.match(mig, /^-- Rollback: /m);
assert.match(mig, /^-- CAUSE-MAPPED: /m);
const bare = mig.replace(/^--.*$/gm, "");
assert.ok(!/^\s*(DROP|DELETE\s+FROM)\b/mi.test(bare), "the migration destroys nothing");

const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT, updated_at TEXT);" +
  "CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT, root_cause TEXT, remediation TEXT, detector TEXT, probe_class TEXT, first_seen TEXT, trigger_condition TEXT, symptom TEXT, blast_radius TEXT);" +
  "CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER, expected_cadence_h INTEGER, status TEXT, precondition TEXT, action TEXT, escalate_to TEXT, module TEXT, next_due_at TEXT);" +
  "CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);" +
  "CREATE TABLE fleet_probe_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, name TEXT);");
db.exec(mig);
db.exec(mig);   // idempotent
assert.equal(db.prepare("SELECT value FROM ops_config WHERE key = 'cold_tier'").get().value, "on");
assert.equal(db.prepare("SELECT COUNT(*) n FROM decision_log WHERE action LIKE 'COLD-TIER-1:%'").get().n, 1);
assert.equal(db.prepare("SELECT COUNT(*) n FROM remediation_contracts WHERE class = 'fm-cold-archive-lag'").get().n, 1);
const ledger = db.prepare("PRAGMA table_info(cold_archive_ledger)").all().map((x) => x.name);
for (const c of ["src_table", "id_min", "id_max", "rows", "bytes", "sha256", "r2_key", "mode", "verified", "deleted_rows", "deleted_at", "archived_at"]) assert.ok(ledger.includes(c), c);
const roll = db.prepare("PRAGMA table_info(cold_rollup_daily)").all().map((x) => x.name);
for (const c of ["src_table", "day", "dim1", "dim2", "n", "n_ok", "n_fail", "v1", "v2"]) assert.ok(roll.includes(c), c);

const probe = () => ({ ...db.prepare(db.prepare("SELECT verify_probe p FROM remediation_contracts WHERE class = 'fm-cold-archive-lag'").get().p).get() });
const old = new Date(Date.now() - 6 * 86400000).toISOString().replace(/\.\d+Z$/, "Z");
const ins = db.prepare("INSERT INTO fleet_probe_log (ts, name) VALUES (?, ?)");
for (let i = 0; i < 300; i++) ins.run(old, "p" + i);
assert.deepEqual(probe(), { expected: "0", observed: "0" }, "300 retained latest rows is healthy");
for (let i = 0; i < 800; i++) ins.run(old, "q" + i);
assert.deepEqual(probe(), { expected: "0", observed: "1" }, "1,100 old rows means the archive is not running");
db.prepare("INSERT INTO cold_archive_ledger (src_table, id_min, id_max, rows, bytes, sha256, r2_key, mode, verified) VALUES ('fleet_probe_log', 1, 10, 10, 100, 'x', 'k', 'delete', 1)").run();
const v = db.prepare("SELECT * FROM v_cold_tier_status").get();
assert.equal(v.rows_archived, 10);
assert.equal(v.unverified, 0);
console.log("cold-tier-1: ok");
