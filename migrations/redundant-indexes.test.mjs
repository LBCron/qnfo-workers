// REDUNDANT-INDEXES-1 (2026-11-04, pillar core): nine indexes that another index of the same table already serves are dropped; the plans that used them keep an index.
// Replays remediation_verifications with its nine live indexes (and the eight sibling indexes) and runs the contract probe.
// Run: node --no-warnings migrations/redundant-indexes.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const mig = readFileSync(new URL("./2026-11-04-redundant-indexes.sql", import.meta.url), "utf8");
assert.match(mig, /^-- APPLY-BY: ci$/m);
assert.match(mig, /^-- DB: qnfo-audit$/m);
assert.match(mig, /^-- BACKUP: bak_20261104_redundant_indexes$/m);
assert.match(mig, /^-- Rollback: /m);
assert.match(mig, /^-- CAUSE-MAPPED: /m);
const bare = mig.replace(/^--.*$/gm, "");
const drops = [...bare.matchAll(/^DROP INDEX IF EXISTS (\w+);$/gm)].map((m) => m[1]);
assert.equal(drops.length, 9);
assert.ok(!/DROP TABLE|DELETE FROM/i.test(bare), "indexes only");

const db = new DatabaseSync(":memory:");
const NORM = "replace(substr(verified_at, 1, 19), 'T', ' ')";
db.exec(`
CREATE TABLE remediation_verifications (id INTEGER PRIMARY KEY AUTOINCREMENT, issue_id INTEGER, class TEXT, verified_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), pass INTEGER, expected TEXT, observed TEXT, verifier TEXT, action_ref TEXT);
CREATE INDEX idx_remediation_verifications_issue_ts ON remediation_verifications (issue_id, verified_at);
CREATE INDEX idx_rv_class_verified ON remediation_verifications (class, verified_at);
CREATE INDEX idx_remediation_verifications_ts ON remediation_verifications (verified_at);
CREATE INDEX idx_rv_class_id ON remediation_verifications (class, id);
CREATE INDEX idx_rv_action_ref ON remediation_verifications(action_ref, id);
CREATE INDEX idx_rv_verifier_ts ON remediation_verifications(verifier, verified_at);
CREATE INDEX idx_rv_verified_norm ON remediation_verifications(${NORM});
CREATE INDEX idx_rv_verified_cover ON remediation_verifications (${NORM}, issue_id, class);
CREATE INDEX idx_rv_verified_norm_cover ON remediation_verifications (${NORM}, issue_id, class, verified_at);
CREATE TABLE discovery_projects (id INTEGER PRIMARY KEY, last_active TEXT, status TEXT);
CREATE INDEX idx_dp_last_active ON discovery_projects(last_active); CREATE INDEX idx_projects_last_active ON discovery_projects(last_active);
CREATE INDEX idx_dp_status ON discovery_projects(status); CREATE INDEX idx_projects_status ON discovery_projects(status);
CREATE TABLE errata_queue (id INTEGER PRIMARY KEY, subject TEXT);
CREATE INDEX idx_errata_queue_subject ON errata_queue(subject); CREATE INDEX ix_errata_queue_subject ON errata_queue(subject);
CREATE TABLE project_state (id INTEGER PRIMARY KEY, project_code TEXT, session_id TEXT);
CREATE UNIQUE INDEX ux_project_state_session ON project_state(project_code, session_id); CREATE INDEX idx_project_state_proj_session ON project_state(project_code, session_id);
CREATE TABLE tasks (id INTEGER PRIMARY KEY, column_name TEXT);
CREATE INDEX idx_tasks_column ON tasks(column_name); CREATE INDEX idx_tasks_status ON tasks(column_name);
CREATE TABLE analytics_daily (date TEXT, event_type TEXT, n INTEGER, PRIMARY KEY (date, event_type));
CREATE INDEX idx_analytics_daily_date ON analytics_daily(date);
CREATE TABLE venue_signal (id INTEGER PRIMARY KEY, venue TEXT, external_id TEXT, query TEXT, UNIQUE (venue, external_id, query));
CREATE INDEX idx_venue_signal_venue ON venue_signal(venue);
CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT, root_cause TEXT, remediation TEXT, detector TEXT, probe_class TEXT, first_seen TEXT, trigger_condition TEXT, symptom TEXT, blast_radius TEXT);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER, expected_cadence_h INTEGER, status TEXT, precondition TEXT, action TEXT, escalate_to TEXT, module TEXT, next_due_at TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, surfaces_tested TEXT);
`);
const ins = db.prepare("INSERT INTO remediation_verifications (issue_id, class, pass, verified_at) VALUES (?, ?, 1, ?)");
db.exec("BEGIN");
for (let i = 0; i < 3000; i++) ins.run(1000 + (i % 50), "issue-" + (1000 + (i % 50)), "2026-11-0" + (1 + (i % 4)) + "T" + String(i % 24).padStart(2, "0") + ":00:00Z");
db.exec("COMMIT");

const planOf = (sql) => db.prepare("EXPLAIN QUERY PLAN " + sql).all().map((r) => r.detail).join(" | ");
const LOOKUPS = [
  `SELECT issue_id, class FROM remediation_verifications WHERE ${NORM} > '2026-11-02 00:00:00'`,
  `SELECT COUNT(*) FROM remediation_verifications WHERE ${NORM} > '2026-11-02 00:00:00'`,
  `SELECT issue_id, class, verified_at FROM remediation_verifications WHERE ${NORM} >= '2026-11-03 00:00:00' AND ${NORM} < '2026-11-04 00:00:00'`,
];
const before = LOOKUPS.map(planOf);
const count = () => db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type = 'index' AND tbl_name = 'remediation_verifications'").get().n;
assert.equal(count(), 9);
const before_rows = db.prepare(LOOKUPS[0]).all().length;

db.exec(mig);
db.exec(mig);   // idempotent
assert.equal(count(), 7, "remediation_verifications keeps seven indexes");
const names = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((r) => r.name));
for (const d of drops) assert.ok(!names.has(d), d + " is gone");
for (const keep of ["idx_rv_verified_norm_cover", "idx_rv_class_id", "idx_dp_last_active", "idx_dp_status", "idx_errata_queue_subject", "ux_project_state_session", "idx_tasks_column"]) assert.ok(names.has(keep), keep + " stays");
const after = LOOKUPS.map(planOf);
for (const p of after) assert.match(p, /USING (COVERING )?INDEX idx_rv_verified_norm_cover/, "every lookup on the expression key uses the index that stays: " + p);
for (const p of after) assert.ok(!/SCAN remediation_verifications(?! USING)/.test(p), "no table scan: " + p);
assert.equal(db.prepare(LOOKUPS[0]).all().length, before_rows, "same rows");
assert.ok(before.some((p) => /idx_rv_verified/.test(p)), "before: an expression index served them");

const bak = db.prepare("SELECT name, tbl_name, sql FROM bak_20261104_redundant_indexes").all();
assert.equal(bak.length, 9, "the backup holds the nine CREATE statements");
assert.ok(bak.every((b) => /^CREATE (UNIQUE )?INDEX/.test(b.sql)));
const probe = () => ({ ...db.prepare(db.prepare("SELECT verify_probe p FROM remediation_contracts WHERE class = 'fm-redundant-indexes'").get().p).get() });
assert.deepEqual(probe(), { expected: "0", observed: "0" });
db.exec(`CREATE INDEX idx_rv_extra ON remediation_verifications (pass)`);
assert.deepEqual(probe(), { expected: "0", observed: "1" }, "an eighth index fails the contract");
assert.equal(db.prepare("SELECT COUNT(*) n FROM decision_log WHERE action LIKE 'REDUNDANT-INDEXES-1:%'").get().n, 1);
console.log("redundant-indexes: all assertions passed");
