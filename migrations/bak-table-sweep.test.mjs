// BAK-TABLE-SWEEP-1 (2026-11-04, pillar core): the ledger, the knob, the failure mode and the closing probe for expired bak_ tables.
// The sweep itself is tested by `python scripts/continuity_snapshot.py --selftest` (bak_selftest); this replays the migration and runs the contract's probe.
// Run: node --no-warnings migrations/bak-table-sweep.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const mig = readFileSync(new URL("./2026-11-04-bak-table-sweep.sql", import.meta.url), "utf8");
assert.match(mig, /^-- APPLY-BY: ci$/m);
assert.match(mig, /^-- DB: qnfo-audit$/m);
assert.match(mig, /^-- Rollback: /m);
assert.match(mig, /^-- CAUSE-MAPPED: /m);
const bare = mig.replace(/^--.*$/gm, "");
assert.ok(!/^\s*(DROP|DELETE\s+FROM)\b/mi.test(bare), "the migration itself destroys nothing");

const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT, updated_at TEXT);" +
  "CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT, root_cause TEXT, remediation TEXT, detector TEXT, probe_class TEXT, first_seen TEXT, trigger_condition TEXT, symptom TEXT, blast_radius TEXT);" +
  "CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER, expected_cadence_h INTEGER, status TEXT, precondition TEXT, action TEXT, escalate_to TEXT, module TEXT, next_due_at TEXT);" +
  "CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, surfaces_tested TEXT);");
const day = (n) => db.prepare("SELECT strftime('%Y%m%d', 'now', ?) d").get("-" + n + " days").d;
for (const n of ["bak_" + day(30) + "_old", "bak_" + day(11) + "_old2", "bak_" + day(9) + "_inside_grace", "bak_" + day(1) + "_young", "bak_undated_thing", "bak_noz2_x_20261026", "bak_" + day(40) + "c_letter_suffix"]) db.exec(`CREATE TABLE "${n}" (a)`);

const probe = () => {
  const row = db.prepare("SELECT verify_probe p FROM remediation_contracts WHERE class = 'fm-bak-tables-accumulate'").get();
  return { ...db.prepare(row.p).get() };
};
db.exec(mig);
db.exec(mig);   // idempotent
assert.deepEqual(probe(), { expected: "0", observed: "3" }, "the probe counts the dated bak_ tables older than 10 days: 30, 11 and 40 days (the letter suffix form too), not 9, 1, undated or noz2");
assert.equal(db.prepare("SELECT COUNT(*) n FROM failure_modes WHERE fm_key = 'bak-tables-accumulate'").get().n, 1);
const c = db.prepare("SELECT * FROM remediation_contracts WHERE class = 'fm-bak-tables-accumulate'").get();
assert.equal(c.status, "active");
assert.equal(c.verify_transport, "d1-query");
assert.equal(c.module, "failure-mode");
assert.equal(db.prepare("SELECT value FROM ops_config WHERE key = 'bak_table_keep_days'").get().value, "7");
assert.equal(db.prepare("SELECT COUNT(*) n FROM decision_log WHERE action LIKE 'BAK-TABLE-SWEEP-1:%'").get().n, 1, "one decision_log row, written once");
const cols = db.prepare("PRAGMA table_info(dropped_bak_tables_ledger)").all().map((x) => x.name);
assert.deepEqual(cols, ["id", "name", "rows", "bytes", "r2_key", "sha", "dropped_at"], "the ledger the sweep writes to");
assert.ok(!db.prepare("SELECT 1 x FROM sqlite_master WHERE name LIKE 'bak\\_%' ESCAPE '\\' AND name = 'dropped_bak_tables_ledger'").get(), "the ledger is not itself a bak_ table");
// the sweep drops the three; the probe then reads 0
for (const n of ["bak_" + day(30) + "_old", "bak_" + day(11) + "_old2", "bak_" + day(40) + "c_letter_suffix"]) db.exec(`DROP TABLE "${n}"`);
assert.deepEqual(probe(), { expected: "0", observed: "0" });
console.log("bak-table-sweep: all assertions passed");
