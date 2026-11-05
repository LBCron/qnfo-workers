// PLAN-STARVATION-1 follow-up offline suite for migrations/2026-11-05-red-drain-headroom-canonical.sql (real SQLite).
// Proves: the canonical row follows the live definition when live minus the QUEUE-HEADROOM-1 gate is exactly the canonical one; a canonical row another session changed is left alone; replay and rollback.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dir = (n) => fileURLToPath(new URL(n, import.meta.url));
const migration = readFileSync(dir("./2026-11-05-red-drain-headroom-canonical.sql"), "utf8");
const first = readFileSync(dir("./2026-11-05-red-drain-headroom.sql"), "utf8");
const rollback = migration.match(/^-- Rollback: (.+)$/m)?.[1];
assert.ok(rollback);
assert.match(migration, /^-- APPLY-BY: ci$/m);
assert.match(migration, /^-- DB: qnfo-audit$/m);
const strip = (s) => s.replace(/^--.*$/gm, "");

const DISPATCH = "INSERT OR IGNORE INTO code_tasks SELECT 1 FROM agent_issues a WHERE a.status = 'open' /* RED-DRAIN-SCOPE-1 */\n       LIMIT 5";
const DEF = JSON.stringify({ steps: [{ sql: "SELECT 0" }, { sql: "SELECT 1" }, { sql: "SELECT 2 LIMIT 5" }, { sql: DISPATCH }] });

const make = (canonicalDef) => {
  const d = new DatabaseSync(":memory:");
  d.exec("CREATE TABLE fleet_tasks (id TEXT PRIMARY KEY, definition TEXT, version INTEGER, updated_at TEXT); CREATE TABLE fleet_tasks_canonical (id TEXT PRIMARY KEY, definition TEXT NOT NULL, repo_path TEXT, exported_at TEXT);");
  d.prepare("INSERT INTO fleet_tasks VALUES ('red-drain', ?, 10, 'x')").run(DEF);
  d.prepare("INSERT INTO fleet_tasks_canonical VALUES ('red-drain', ?, 'migrations/old.sql', '2026-11-04 23:56:15')").run(canonicalDef);
  // the first migration's own step on the live row (its UPDATE of fleet_tasks only; the rest of that file needs other tables)
  d.exec(`UPDATE fleet_tasks SET definition = json_set(definition, '$.steps[3].sql', replace(json_extract(definition, '$.steps[3].sql'), 'LIMIT 5', 'AND (SELECT COUNT(*) FROM code_tasks WHERE status = ''queued'') < 42 /* QUEUE-HEADROOM-1 */ LIMIT 5')), version = version + 1 WHERE id = 'red-drain' AND json_extract(definition, '$.steps[3].sql') LIKE '%RED-DRAIN-SCOPE-1%'`);
  return d;
};
const canon = (d) => d.prepare("SELECT definition, repo_path FROM fleet_tasks_canonical WHERE id = 'red-drain'").get();
const live = (d) => d.prepare("SELECT definition FROM fleet_tasks WHERE id = 'red-drain'").get().definition;

// the gate text in the first migration is the text this one reverses
assert.ok(first.includes("AND (SELECT COUNT(*) FROM code_tasks WHERE status = ''queued'') < 42 /* QUEUE-HEADROOM-1 */ LIMIT 5"));
assert.ok(migration.includes("AND (SELECT COUNT(*) FROM code_tasks WHERE status = ''queued'') < 42 /* QUEUE-HEADROOM-1 */ LIMIT 5"));

{
  const d = make(DEF); // canonical = the definition before the gate (stored as the same minified JSON text)
  assert.notEqual(live(d), canon(d).definition);
  d.exec(strip(migration));
  assert.equal(canon(d).definition, live(d), "canonical follows live");
  assert.equal(canon(d).repo_path, "migrations/2026-11-05-red-drain-headroom.sql");
  const snap = JSON.stringify(canon(d));
  d.exec(strip(migration));
  assert.equal(JSON.stringify(canon(d)), snap, "replay changes nothing");
  d.exec(rollback);
  assert.equal(canon(d).definition, DEF, "rollback restores the old canonical row");
  assert.equal(canon(d).repo_path, "migrations/old.sql");
}
{
  const other = JSON.stringify({ steps: [{ sql: "SELECT 0" }, { sql: "SELECT 1" }, { sql: "SELECT 2 LIMIT 5" }, { sql: DISPATCH + " " }] }); // a canonical row some other session changed
  const d = make(other);
  d.exec(strip(migration));
  assert.equal(canon(d).definition, other, "a canonical row that is not the pre-gate definition is never overwritten");
}
{
  const d = make(DEF);
  d.exec(strip(migration));
  const after = canon(d).definition;
  d.prepare("UPDATE fleet_tasks_canonical SET definition = ? WHERE id = 'red-drain'").run(after); // already in sync
  d.exec(strip(migration));
  assert.equal(canon(d).definition, after, "an already synchronised canonical row is left alone (it carries the marker)");
}
console.log("red-drain-headroom-canonical.test: all assertions passed");
