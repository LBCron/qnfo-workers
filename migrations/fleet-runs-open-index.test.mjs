// FLEET-RUNS-OPEN-INDEX-1 (2026-11-04, pillar core): the orphaned-run sweep (UPDATE fleet_runs ... WHERE status IN ('running','queued') AND started_at < ?)
// scanned the whole table (58 K rows a call, 157 calls in 2 h). Replays the table with its two live indexes and checks that the new index turns the SCAN into a SEARCH.
// Run: node --no-warnings migrations/fleet-runs-open-index.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const mig = readFileSync(new URL("./2026-11-04-fleet-runs-open-index.sql", import.meta.url), "utf8");
assert.match(mig, /^-- APPLY-BY: ci$/m);
assert.match(mig, /^-- DB: qnfo-audit$/m);
assert.match(mig, /^-- Rollback: DROP INDEX IF EXISTS idx_fleet_runs_status_started;$/m);
const bare = mig.replace(/^--.*$/gm, "").trim();
assert.equal(bare, "CREATE INDEX IF NOT EXISTS idx_fleet_runs_status_started ON fleet_runs (status, started_at);", "the migration is exactly one additive index");

const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE fleet_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, cron_name TEXT, status TEXT NOT NULL, started_at TEXT, finished_at TEXT, result TEXT, error TEXT, cost_neurons REAL);" +
  "CREATE INDEX idx_fleet_runs_task_status ON fleet_runs (task_id, status, id);" +
  "CREATE INDEX idx_fleet_runs_task_cron ON fleet_runs (task_id, cron_name, id);");
const ins = db.prepare("INSERT INTO fleet_runs (task_id, cron_name, status, started_at) VALUES (?, ?, ?, ?)");
db.exec("BEGIN");
for (let i = 0; i < 6000; i++) ins.run("t" + (i % 40), "c" + (i % 7), i % 97 === 0 ? "failed" : "ok", "2026-11-03T" + String(Math.floor(i / 250) % 24).padStart(2, "0") + ":" + String(i % 60).padStart(2, "0") + ":00Z");
ins.run("t1", "c1", "running", "2026-11-04T17:00:00Z");   // stale: orphaned
ins.run("t2", "c1", "queued", "2026-11-04T17:05:00Z");    // stale: orphaned
ins.run("t3", "c1", "running", "2026-11-04T20:59:30Z");   // fresh: still running
db.exec("COMMIT");

const SQL = "UPDATE fleet_runs SET status = 'failed', finished_at = ?1, error = 'orphaned' WHERE status IN ('running','queued') AND started_at < ?2";
const plan = (sql) => db.prepare("EXPLAIN QUERY PLAN " + sql.replace(/^UPDATE fleet_runs SET [^W]*WHERE/, "SELECT id FROM fleet_runs WHERE").replace(/\?1/g, "'x'").replace(/\?2/g, "'2026-11-04T20:30:00Z'")).all().map((r) => r.detail).join(" | ");
assert.match(plan(SQL), /SCAN fleet_runs/, "before: the sweep scans the table: " + plan(SQL));

db.exec(mig);
db.exec(mig);   // idempotent
const after = plan(SQL);
assert.match(after, /SEARCH fleet_runs USING (COVERING )?INDEX idx_fleet_runs_status_started/, "after: the sweep searches the new index: " + after);
assert.ok(!/SCAN fleet_runs/.test(after));

// the statement does exactly what it did: only the two stale open rows are failed
const r = db.prepare(SQL).run("2026-11-04T21:00:00Z", "2026-11-04T20:30:00Z");
assert.equal(Number(r.changes), 2);
assert.deepEqual(db.prepare("SELECT status FROM fleet_runs WHERE started_at >= '2026-11-04T17:00:00Z' ORDER BY id").all().map((x) => x.status), ["failed", "failed", "running"]);
console.log("fleet-runs-open-index: all assertions passed");
