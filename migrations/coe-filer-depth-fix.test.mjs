import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

// COE-FILER-DEPTH-FIX-1: the filer trigger is re-created with INSERT OR IGNORE INTO agent_issues, still files one ticket per tool, and the live-exception detector reads 0 / 1 correctly.
const migration = readFileSync(new URL("./2026-11-04-coe-filer-depth-fix.sql", import.meta.url), "utf8");
assert.match(migration, /^-- APPLY-BY: ci$/m);
assert.match(migration, /^-- DB: qnfo-audit$/m);
assert.match(migration, /^-- Rollback: /m);
assert.match(migration, /^-- BACKUP: bak_20261104_coe_filer_trigger_v2$/m);
const afterCreate = migration.slice(migration.indexOf("CREATE TRIGGER tool_error_rate_filer_v3_ins AFTER INSERT"));
assert.doesNotMatch(afterCreate.slice(afterCreate.indexOf("BEGIN"), afterCreate.indexOf("END;")), /INSERT INTO agent_issues/, "the trigger body no longer has a plain INSERT INTO agent_issues");

const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE cloud_ops_events (id TEXT PRIMARY KEY, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT);
  CREATE TABLE tool_error_exclusions (pattern TEXT);
  CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);
  CREATE UNIQUE INDEX idx_agent_issues_open_title ON agent_issues (title) WHERE status = 'open';
  CREATE TABLE worker_logs (id INTEGER PRIMARY KEY, ts_ms INTEGER, script_name TEXT, exceptions_json TEXT);
  CREATE INDEX idx_worker_logs_ts ON worker_logs (ts_ms);
  CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT, root_cause TEXT, remediation TEXT, detector TEXT, probe_class TEXT, first_seen TEXT, issue_id INTEGER,
    trigger_condition TEXT, symptom TEXT, blast_radius TEXT);
  CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER,
    escalate_to TEXT, expected_cadence_h INTEGER, status TEXT, next_due_at TEXT, module TEXT, budget_ms INTEGER, max_items INTEGER, requires_container INTEGER);
  CREATE TABLE decision_log (actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT,
    predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
  -- the broken (plain INSERT) filer that production had at 18:57Z, so the file's DROP has something to replace
  CREATE TRIGGER tool_error_rate_filer_v3_ins AFTER INSERT ON cloud_ops_events WHEN NEW.kind = 'ops_ai_tool' BEGIN INSERT INTO agent_issues (title) VALUES ('old'); END;
`);
db.exec(migration);
const trig = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'tool_error_rate_filer_v3_ins'").get().sql;
assert.match(trig, /INSERT OR IGNORE INTO agent_issues/, "the live text is the OR IGNORE version");
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM bak_20261104_coe_filer_trigger_v2").get().n, 1, "the backup holds the text that was replaced");
assert.match(db.prepare("SELECT sql FROM bak_20261104_coe_filer_trigger_v2").get().sql, /VALUES \('old'\)/, "and it is the previous text");

// Behaviour is unchanged: below the thresholds nothing is filed; at 20 calls with 10+ errors and rate >= 0.25 one ticket is filed; the next inserts add none and do not fail.
const nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");
const add = (i, status) => db.prepare("INSERT INTO cloud_ops_events (id, ts, kind, text, job, status) VALUES (?, ?, 'ops_ai_tool', 'toolX', 'j', ?)").run("e" + i, nowIso(), status);
for (let i = 0; i < 19; i++) add(i, "error");
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM agent_issues").get().n, 0, "19 calls: below the 20-call sample");
add(19, "error");
assert.equal(db.prepare("SELECT title FROM agent_issues").all().map((r) => r.title).join(), "TOOL-ERROR-RATE-toolX-1", "the 20th call files the ticket");
for (let i = 20; i < 30; i++) add(i, "error");
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM agent_issues").get().n, 1, "an open ticket of the same title is not filed again, and the event inserts do not fail");
// A closed ticket of the same title lets the next qualifying event file a new one (the unique index covers open tickets only).
db.exec("UPDATE agent_issues SET status = 'closed'");
add(30, "error");
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM agent_issues WHERE status = 'open'").get().n, 1, "after a close the next qualifying event reopens the family with one new ticket");

// The detector: more than 5 'nested too deep' exceptions in the last 30 minutes.
const probe = db.prepare("SELECT verify_probe FROM remediation_contracts WHERE class = 'fm-trigger-depth-errors-live'").get().verify_probe;
const T = Date.now();
const log = db.prepare("INSERT INTO worker_logs (ts_ms, script_name, exceptions_json) VALUES (?, 'qnfo-ops', ?)");
assert.deepEqual({ ...db.prepare(probe).get() }, { expected: "0", observed: "0" }, "no exceptions reads 0");
for (let i = 0; i < 5; i++) log.run(T - 60000, '[{"name":"exception","message":"D1_ERROR: triggers nested too deep: SQLITE_ERROR"}]');
for (let i = 0; i < 40; i++) log.run(T - 3 * 3600 * 1000, '[{"name":"exception","message":"D1_ERROR: triggers nested too deep: SQLITE_ERROR"}]');
for (let i = 0; i < 40; i++) log.run(T - 60000, '[{"name":"exception","message":"D1_ERROR: D1 DB is overloaded"}]');
assert.equal(db.prepare(probe).get().observed, "0", "5 recent exceptions, older ones and other errors do not trip it");
log.run(T - 30000, '[{"name":"exception","message":"D1_ERROR: triggers nested too deep: SQLITE_ERROR"}]');
assert.equal(db.prepare(probe).get().observed, "1", "a sixth recent exception trips it");
assert.match(db.prepare("EXPLAIN QUERY PLAN " + probe).all().map((r) => r.detail).join(" | "), /idx_worker_logs_ts/, "the probe reads the ts_ms range, not the table");

db.exec(migration);
for (const [t, n] of [["decision_log", 1], ["failure_modes", 1], ["remediation_contracts", 1]]) assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n, n, t + " replay is idempotent");
db.close();
console.log("coe-filer-depth-fix: all passed");
