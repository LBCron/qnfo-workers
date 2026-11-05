// DATA-SPINE-LAKE-1-BUILT (2026-11-05, pillars reliability and cost; roadmap row 3258): the row update with its live evidence and the detector for a drift check that goes silent.
// Run: node --no-warnings migrations/data-spine-lake-1-built.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const mig = readFileSync(new URL("./2026-11-05-data-spine-lake-1-built.sql", import.meta.url), "utf8");
assert.match(mig, /^-- APPLY-BY: ci$/m);
assert.match(mig, /^-- DB: qnfo-audit$/m);
assert.match(mig, /^-- Rollback: /m);
assert.match(mig, /^-- CAUSE-MAPPED: /m);
const bare = mig.replace(/^--.*$/gm, "");
assert.ok(!/^\s*(DROP|DELETE\s+FROM)\b/mi.test(bare), "the migration destroys nothing");

const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE roadmap_implementation (id INTEGER PRIMARY KEY, item TEXT, source TEXT, title TEXT, artifact_type TEXT, artifact_ref TEXT, status TEXT, evidence TEXT, verified_at TEXT, created_at TEXT);" +
  "INSERT INTO roadmap_implementation (id, item, source, title, status, evidence) VALUES (3258, 'RM-BS-DATA-SPINE-1', 'bluesky-2026-11', 't', 'planned', 'docs/BLUE-SKY-ROADMAP-2026-11.md');" +
  "INSERT INTO roadmap_implementation (id, item, source, title, status, evidence) VALUES (3257, 'RM-BS-QUNIVERSE-SMALL-1', 'bluesky-2026-11', 't', 'planned', 'docs/BLUE-SKY-ROADMAP-2026-11.md');" +
  "CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT, updated_at TEXT);" +
  "CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT, root_cause TEXT, remediation TEXT, detector TEXT, probe_class TEXT, first_seen TEXT, trigger_condition TEXT, symptom TEXT, blast_radius TEXT);" +
  "CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER, expected_cadence_h INTEGER, status TEXT, precondition TEXT, action TEXT, escalate_to TEXT, module TEXT, next_due_at TEXT);" +
  "CREATE TABLE lake_spine_drift (tbl TEXT NOT NULL, day TEXT NOT NULL, verdict TEXT, checked_at TEXT, PRIMARY KEY (tbl, day));");
db.exec(mig);
db.exec(mig);   // idempotent
const row = db.prepare("SELECT status, evidence, verified_at FROM roadmap_implementation WHERE id = 3258").get();
assert.equal(row.status, "partial");
assert.ok(row.verified_at && /^\d{4}-\d{2}-\d{2}T/.test(row.verified_at), "verified_at is set");
for (const need of ["PR 7716", "1.14.0-lake-spine", "13,037", "10,806", "4,028,925,249", "LAKE-SPINE-2.1", "LAKE-SPINE-2.2", "INFRA-AUTH-AWAIT-1", "D1 stays authoritative"]) assert.ok(row.evidence.includes(need), "evidence names " + need);
assert.equal(db.prepare("SELECT status FROM roadmap_implementation WHERE id = 3257").get().status, "planned", "only row 3258 changes");
assert.equal(db.prepare("SELECT COUNT(*) n FROM remediation_contracts WHERE class = 'fm-lake-spine-drift-silent'").get().n, 1);
assert.equal(db.prepare("SELECT COUNT(*) n FROM failure_modes WHERE fm_key = 'lake-spine-drift-silent'").get().n, 1);

const probe = () => ({ ...db.prepare(db.prepare("SELECT verify_probe p FROM remediation_contracts WHERE class = 'fm-lake-spine-drift-silent'").get().p).get() });
const z = (ms) => new Date(Date.now() - ms).toISOString().replace(/\.\d+Z$/, "Z");
const H = 3600 * 1000;
db.prepare("INSERT INTO ops_config (key, value, note, updated_at) VALUES ('lake_spine', 'shadow', '', ?)").run(z(2 * H));
assert.deepEqual(probe(), { expected: "0", observed: "0" }, "a flag turned on 2 hours ago has a grace period");
db.prepare("UPDATE ops_config SET updated_at = ? WHERE key = 'lake_spine'").run(z(40 * H));
assert.deepEqual(probe(), { expected: "0", observed: "1" }, "on for 40 hours with no reading is silent");
db.prepare("INSERT INTO lake_spine_drift (tbl, day, verdict, checked_at) VALUES ('fleet_probe_log', '2026-11-04', 'ok', ?)").run(z(25 * H));
assert.deepEqual(probe(), { expected: "0", observed: "0" }, "a 25 hour old reading is the normal daily gap");
db.prepare("UPDATE lake_spine_drift SET checked_at = ?").run(z(37 * H));
assert.deepEqual(probe(), { expected: "0", observed: "1" }, "a 37 hour old reading means the check stopped");
db.prepare("UPDATE ops_config SET value = 'paused'").run();
assert.deepEqual(probe(), { expected: "0", observed: "0" }, "a paused copy is the drift contract's business, not this one");
console.log("data-spine-lake-1-built: ok");
