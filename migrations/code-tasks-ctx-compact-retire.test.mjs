import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

// CODE-TASKS-CTX-COMPACT-3: the compaction trigger is dropped, its text is kept in a backup table, other heavy-tick triggers and the ledger stay, replay is safe.
const f = (n) => readFileSync(new URL("./" + n, import.meta.url), "utf8");
const v1 = f("2026-11-04-code-tasks-ctx-compact.sql"), v2 = f("2026-11-04-code-tasks-ctx-compact-2.sql"), retire = f("2026-11-04-code-tasks-ctx-compact-retire.sql");
assert.match(retire, /^-- APPLY-BY: ci$/m);
assert.match(retire, /^-- DB: qnfo-audit$/m);
assert.match(retire, /^-- Rollback: /m);
assert.match(retire, /^-- BACKUP: bak_20261104_ctx_compact_trigger_v2$/m);

const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT);
  CREATE TABLE fleet_tick_heavy (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), source TEXT);
  CREATE INDEX idx_fleet_tick_heavy_ts ON fleet_tick_heavy (ts);
  CREATE TABLE code_tasks (id TEXT PRIMARY KEY, status TEXT, ctx TEXT, updated_at TEXT, merge_state TEXT, merge_note TEXT, step TEXT);
  CREATE TABLE sibling_log (n INTEGER);
  CREATE TRIGGER sibling_heavy_tick AFTER INSERT ON fleet_tick_heavy BEGIN INSERT INTO sibling_log VALUES (NEW.id); END;
  CREATE TABLE decision_log (actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT,
    predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
  CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, status TEXT);
  CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT, root_cause TEXT, remediation TEXT, detector TEXT, probe_class TEXT, first_seen TEXT, issue_id INTEGER,
    trigger_condition TEXT, symptom TEXT, blast_radius TEXT);
  CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER,
    escalate_to TEXT, expected_cadence_h INTEGER, status TEXT, next_due_at TEXT, module TEXT, budget_ms INTEGER, max_items INTEGER, requires_container INTEGER);
`);
db.exec(v1);
db.exec(v2);
const trig = () => db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'fleet_tick_heavy' ORDER BY name").all().map((r) => r.name);
assert.deepEqual(trig(), ["code_tasks_ctx_compact_tick", "sibling_heavy_tick"], "both triggers exist before the retire file");
const big = JSON.stringify({ base: "x".repeat(50000), claim: { token: "t" } });
db.prepare("INSERT INTO code_tasks (id, status, ctx, updated_at) VALUES ('m1', 'merged', ?, ?)").run(big, new Date(Date.now() - 5 * 86400000).toISOString().replace(/\.\d+Z$/, "Z"));

db.exec(retire);
assert.deepEqual(trig(), ["sibling_heavy_tick"], "only the compaction trigger is dropped");
const bak = db.prepare("SELECT name, sql FROM bak_20261104_ctx_compact_trigger_v2").all();
assert.equal(bak.length, 1);
assert.match(bak[0].sql, /code_tasks_ctx_compact_tick/, "the backup holds the v2 trigger text (re-creatable)");
assert.match(bak[0].sql, /compacted_at >= t\.updated_at/, "and it is the v2 text, not v1");
db.exec("INSERT INTO fleet_tick_heavy (source) VALUES ('t')");
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sibling_log").get().n, 1, "the sibling heavy-tick trigger still fires");
assert.equal(JSON.parse(db.prepare("SELECT ctx FROM code_tasks WHERE id = 'm1'").get().ctx).base.length, 50000, "nothing strips ctx any more, even with the switch absent");
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM code_task_ctx_compacted").get().n, 0, "the ledger table is kept");
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM remediation_contracts WHERE class = 'fm-fleet-tick-heavy-stale'").get().n, 1, "the heavy-tick stall detector is kept");

// Rollback path works: re-creating from the backup restores a working trigger (switch off keeps it quiet).
db.exec(bak[0].sql);
assert.deepEqual(trig(), ["code_tasks_ctx_compact_tick", "sibling_heavy_tick"], "the Rollback line re-creates the trigger");
db.exec("DROP TRIGGER code_tasks_ctx_compact_tick");

db.exec(retire);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM decision_log WHERE action LIKE 'CODE-TASKS-CTX-COMPACT-3:%'").get().n, 1, "replay is idempotent");
db.close();
console.log("code-tasks-ctx-compact-retire: all passed");
