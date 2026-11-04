import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

// CODE-TASKS-CTX-COMPACT-1: finished code tasks lose only the four blob keys, 40 at a time; everything the readers use stays.
const migration = readFileSync(new URL("./2026-11-04-code-tasks-ctx-compact.sql", import.meta.url), "utf8");
assert.match(migration, /^-- APPLY-BY: ci$/m);
assert.match(migration, /^-- DB: qnfo-audit$/m);
assert.match(migration, /^-- Rollback: /m);

const T0 = Date.now();
const isoDaysAgo = (d) => new Date(T0 - d * 86400000).toISOString().replace(/\.\d+Z$/, "Z");

const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT);
  CREATE TABLE fleet_tick_heavy (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), source TEXT);
  CREATE TABLE code_tasks (id TEXT PRIMARY KEY, status TEXT, ctx TEXT, updated_at TEXT, merge_state TEXT, merge_note TEXT, step TEXT);
  CREATE INDEX idx_code_tasks_status ON code_tasks (status);
  -- the validity guard that exists on the live table
  CREATE TRIGGER code_tasks_ctx_json_upd BEFORE UPDATE OF ctx ON code_tasks FOR EACH ROW WHEN NEW.ctx IS NOT NULL AND json_valid(NEW.ctx) = 0
  BEGIN SELECT RAISE(ABORT, 'CTX-JSON-1'); END;
  CREATE TABLE decision_log (actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT,
    predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
`);
const blob = (n) => "x".repeat(n);
const ctxOf = (extra = {}) => JSON.stringify({ base: blob(120000), patch: blob(15000), win_text: blob(5000), x: blob(2000), claim: { token: "t1", released_at: "2026-10-30T00:00:00Z" }, anchor: "async function f() {", superseded_pr: 77, sigs: ["a"], lastError: "e", edits: [1, 2], ...extra });
const add = db.prepare("INSERT INTO code_tasks (id, status, ctx, updated_at) VALUES (?, ?, ?, ?)");
const addX = db.prepare("INSERT INTO code_tasks (id, status, ctx, updated_at, merge_state, merge_note, step) VALUES (?, ?, ?, ?, ?, ?, ?)");
db.exec("BEGIN");
for (let i = 0; i < 100; i++) add.run("m" + i, "merged", ctxOf(), isoDaysAgo(3));          // due: merged, 3 days
for (let i = 0; i < 5; i++) add.run("s" + i, "superseded", ctxOf(), isoDaysAgo(5));        // due
for (let i = 0; i < 5; i++) add.run("c" + i, "closed", ctxOf(), isoDaysAgo(5));            // due
for (let i = 0; i < 3; i++) add.run("fo" + i, "failed", ctxOf(), isoDaysAgo(9));           // due: failed over 7 days
add.run("fy", "failed", ctxOf(), isoDaysAgo(3));                                           // kept: failed 3 days
add.run("my", "merged", ctxOf(), isoDaysAgo(1));                                           // kept: merged yesterday
add.run("q", "queued", ctxOf(), isoDaysAgo(30));                                           // kept: active
add.run("pr", "pr_open", ctxOf(), isoDaysAgo(30));                                         // kept: active
addX.run("sn", "superseded", ctxOf(), isoDaysAgo(9), null, "REARM-able: waits on blocker #123", "propose");     // kept: REARM-1 can set it back to queued at propose, which needs ctx.base
addX.run("sd", "merged", ctxOf(), isoDaysAgo(9), "deploying", null, "done");                           // kept: the canary revert path may still read it
addX.run("sr", "merged", ctxOf(), isoDaysAgo(9), "revert-failed", null, "done");                      // kept
addX.run("sv", "merged", ctxOf(), isoDaysAgo(9), "verified", null, "done");                           // due: deployment verified
addX.run("sp", "superseded", ctxOf(), isoDaysAgo(9), null, "", "propose");                             // due: empty merge_note cannot match REARM-1
addX.run("cr", "closed", ctxOf(), isoDaysAgo(9), "closed-by-review", null, "read");                   // due
add.run("small", "merged", JSON.stringify({ base: "tiny", claim: { token: "t" } }), isoDaysAgo(9)); // kept: ctx under 20,000 characters
add.run("epoch", "superseded", ctxOf(), "1793000277");                                     // kept: epoch updated_at is not an ISO date
add.run("bad", "merged", "not json at all " + blob(30000), isoDaysAgo(9));                 // kept: not valid JSON
db.exec("COMMIT");
const total = () => db.prepare("SELECT SUM(length(ctx)) AS n FROM code_tasks").get().n;
const bytes0 = total();

db.exec(migration);
const heavy = () => db.exec("INSERT INTO fleet_tick_heavy (source) VALUES ('test')");

// First heavy tick: at most 40 tasks, only the four keys.
heavy();
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM code_task_ctx_compacted").get().n, 40, "40 tasks in the first batch");
const done = db.prepare("SELECT task_id FROM code_task_ctx_compacted").all().map((r) => r.task_id);
for (const id of done) {
  const c = JSON.parse(db.prepare("SELECT ctx FROM code_tasks WHERE id = ?").get(id).ctx);
  assert.deepEqual(Object.keys(c).sort(), ["anchor", "claim", "edits", "lastError", "sigs", "superseded_pr"], "only base, patch, win_text and x are removed: " + id);
  assert.deepEqual(c.claim, { token: "t1", released_at: "2026-10-30T00:00:00Z" });
  assert.equal(c.superseded_pr, 77);
}
const led = db.prepare("SELECT bytes_before, bytes_after FROM code_task_ctx_compacted LIMIT 1").get();
assert.ok(led.bytes_before > 140000 && led.bytes_after < 400, "the ledger holds the bytes before and after: " + JSON.stringify(led));

// Three more ticks finish the 116 due tasks (100 + 5 + 5 + 3 + 3 from the resumability cases); nothing else is touched.
heavy(); heavy(); heavy();
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM code_task_ctx_compacted").get().n, 116, "all due tasks, once each");
heavy();
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM code_task_ctx_compacted").get().n, 116, "a further tick finds nothing and repeats nothing");
for (const id of ["fy", "my", "q", "pr", "small", "epoch", "bad", "sn", "sd", "sr"]) {
  assert.ok(!db.prepare("SELECT 1 FROM code_task_ctx_compacted WHERE task_id = ?").get(id), id + " is not compacted");
  assert.ok(db.prepare("SELECT length(ctx) AS n FROM code_tasks WHERE id = ?").get(id).n > 100 || id === "small", id + " keeps its ctx");
}
assert.ok(JSON.parse(db.prepare("SELECT ctx FROM code_tasks WHERE id = 'q'").get().ctx).base.length === 120000, "an active task keeps its base");
assert.equal(db.prepare("SELECT updated_at FROM code_tasks WHERE id = 'm0'").get().updated_at, isoDaysAgo(3), "updated_at is not touched");
assert.equal(db.prepare("SELECT status FROM code_tasks WHERE id = 'm0'").get().status, "merged");
assert.ok(total() < bytes0 * 0.1, "about 90 % of the bytes are gone: " + bytes0 + " -> " + total());

// The kill switch.
db.prepare("INSERT INTO code_tasks (id, status, ctx, updated_at) VALUES ('late', 'merged', ?, ?)").run(ctxOf(), isoDaysAgo(9));
db.exec("INSERT INTO ops_config (key, value) VALUES ('code_tasks_ctx_compact', 'off')");
heavy();
assert.ok(!db.prepare("SELECT 1 FROM code_task_ctx_compacted WHERE task_id = 'late'").get(), "code_tasks_ctx_compact = off stops it");
db.exec("DELETE FROM ops_config WHERE key = 'code_tasks_ctx_compact'");
heavy();
assert.ok(db.prepare("SELECT 1 FROM code_task_ctx_compacted WHERE task_id = 'late'").get(), "and it resumes when the key is gone");

db.exec(migration);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 1, "replay is idempotent");
db.close();
console.log("code-tasks-ctx-compact: all passed");
