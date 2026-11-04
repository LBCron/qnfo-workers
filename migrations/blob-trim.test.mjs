// BLOB-TRIM-1 (2026-11-04, pillar core): the knob, the failure mode and the closing probe for the chatbox messages_json trim. The trim itself is tested by
// `python scripts/continuity_snapshot.py --selftest` (blob_selftest). This replays the migration and runs the contract's probe against a fixture.
// Run: node --no-warnings migrations/blob-trim.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const mig = readFileSync(new URL("./2026-11-04-blob-trim.sql", import.meta.url), "utf8");
assert.match(mig, /^-- APPLY-BY: ci$/m);
assert.match(mig, /^-- DB: qnfo-audit$/m);
assert.match(mig, /^-- Rollback: /m);
assert.match(mig, /^-- CAUSE-MAPPED: /m);
assert.ok(!/^\s*(DROP|DELETE\s+FROM)\b/mi.test(mig.replace(/^--.*$/gm, "")), "the migration destroys nothing");

const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT, updated_at TEXT);" +
  "CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT, root_cause TEXT, remediation TEXT, detector TEXT, probe_class TEXT, first_seen TEXT, trigger_condition TEXT, symptom TEXT, blast_radius TEXT);" +
  "CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER, expected_cadence_h INTEGER, status TEXT, precondition TEXT, action TEXT, escalate_to TEXT, module TEXT, next_due_at TEXT);" +
  "CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, surfaces_tested TEXT);" +
  "CREATE TABLE chatbox_conversations (id TEXT PRIMARY KEY, thread_id TEXT, messages_json TEXT, prompt TEXT, response TEXT, ts TEXT);");
const iso = (n) => db.prepare("SELECT strftime('%Y-%m-%dT%H:%M:%SZ', 'now', ?) d").get("-" + n + " days").d;
const ins = db.prepare("INSERT INTO chatbox_conversations VALUES (?, 't', ?, 'p', 'r', ?)");
ins.run("old-blob", "[x]", iso(30));
ins.run("old-blob-2", "[y]", iso(15));
ins.run("old-null", null, iso(40));
ins.run("young-blob", "[z]", iso(3));

const probe = () => ({ ...db.prepare(db.prepare("SELECT verify_probe p FROM remediation_contracts WHERE class = 'fm-blob-trim-lag'").get().p).get() });
db.exec(mig);
db.exec(mig);   // idempotent
assert.deepEqual(probe(), { expected: "0", observed: "2" }, "two rows older than 14 days still hold the blob; the young one and the null one do not count");
db.exec("UPDATE chatbox_conversations SET messages_json = NULL WHERE ts < '" + iso(14) + "'");
assert.deepEqual(probe(), { expected: "0", observed: "0" }, "after the trim the contract passes, and the young row keeps its blob");
assert.equal(db.prepare("SELECT messages_json FROM chatbox_conversations WHERE id = 'young-blob'").get().messages_json, "[z]");
assert.equal(db.prepare("SELECT value FROM ops_config WHERE key = 'blob_trim'").get().value, "on");
assert.equal(db.prepare("SELECT COUNT(*) n FROM failure_modes WHERE fm_key = 'blob-trim-lag'").get().n, 1);
assert.equal(db.prepare("SELECT status FROM remediation_contracts WHERE class = 'fm-blob-trim-lag'").get().status, "active");
assert.equal(db.prepare("SELECT COUNT(*) n FROM decision_log WHERE action LIKE 'BLOB-TRIM-1:%'").get().n, 1);
console.log("blob-trim: all assertions passed");
