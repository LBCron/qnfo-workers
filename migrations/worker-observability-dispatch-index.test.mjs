import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./2026-11-02-worker-observability-dispatch-index.sql", import.meta.url), "utf8");
const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE fleet_issue_dispatch (
    fingerprint TEXT PRIMARY KEY,
    category TEXT,
    state TEXT,
    payload TEXT
  );
  INSERT INTO fleet_issue_dispatch VALUES
    ('cf-obs-active', 'worker-observability', 'tracked', '{"status":"active"}'),
    ('cf-obs-stale', 'worker-observability', 'tracked', '{"status":"active"}'),
    ('other-active', 'other-category', 'tracked', '{"status":"active"}');
`);
db.exec(migration);

const reconcile = `UPDATE fleet_issue_dispatch
  SET state = 'resolved', payload = json_set(payload, '$.status', 'resolved')
  WHERE category = 'worker-observability'
    AND state <> 'resolved'
    AND fingerprint NOT IN (SELECT value FROM json_each(?1))`;
const plan = db.prepare("EXPLAIN QUERY PLAN " + reconcile).all(JSON.stringify(["cf-obs-active"]));
assert.ok(plan.some((row) => row.detail.includes("idx_fleet_issue_dispatch_category_state")), "reconciliation uses the category/state index");

db.prepare(reconcile).run(JSON.stringify(["cf-obs-active"]));
const rows = db.prepare("SELECT fingerprint, state FROM fleet_issue_dispatch ORDER BY fingerprint").all();
assert.deepEqual(rows.map((row) => [row.fingerprint, row.state]), [
  ["cf-obs-active", "tracked"],
  ["cf-obs-stale", "resolved"],
  ["other-active", "tracked"]
]);

console.log("worker-observability-dispatch-index: 2 passed, 0 failed");
