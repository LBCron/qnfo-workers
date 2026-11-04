import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

// BLINDSPOT-LIKE-LIMIT-1: no LIKE pattern in the blind-spot-audit task exceeds D1's 50 bytes, the JSON stays valid, and the issue match is the same.
const migration = readFileSync(new URL("./2026-11-04-blindspot-like-limit.sql", import.meta.url), "utf8");
assert.match(migration, /^-- APPLY-BY: ci$/m);
assert.match(migration, /^-- DB: qnfo-audit$/m);
assert.match(migration, /^-- BACKUP: bak_20261104_blind_spot_audit_task$/m);
assert.match(migration, /^-- Rollback: /m);

const sufs = ["failure modes have a detector that never ran", "metrics have not refreshed in 3 days", "merged code tasks have no deploy evidence after 2 hours", "migration files have no ok row in migration_runs", "active contracts are parked past their cadence"];
const step = (n, s) => ({ type: "sql", name: n, db: "AUDIT", sql: "SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM agent_issues a WHERE a.status = 'open' AND a.title LIKE 'BLINDSPOT-1: % " + s + "')" });
const def = JSON.stringify({ steps: sufs.map((s, i) => step("s" + i, s)).concat([{ type: "sql", name: "metric", db: "AUDIT", sql: "SELECT title FROM agent_issues WHERE title LIKE 'BLINDSPOT-1:%' AND title LIKE 'goal-%'" }]) });
const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE fleet_tasks (id TEXT PRIMARY KEY, definition TEXT); CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, status TEXT, title TEXT);");
db.prepare("INSERT INTO fleet_tasks VALUES ('blind-spot-audit', ?)").run(def);
const longLikes = (d) => [...String(d).matchAll(/LIKE '((?:[^']|'')*)'/g)].map((m) => m[1]).filter((p) => Buffer.byteLength(p) > 50);
assert.equal(longLikes(def).length, 5, "fixture: five patterns over 50 bytes");
db.exec(migration);
const after = db.prepare("SELECT definition FROM fleet_tasks WHERE id = 'blind-spot-audit'").get().definition;
assert.doesNotThrow(() => JSON.parse(after), "definition is still JSON");
assert.equal(longLikes(after).length, 0, "no LIKE pattern over 50 bytes: " + longLikes(after).join(" | "));
// same issues match, old predicate vs new, for each suffix
for (const s of sufs) {
  db.exec("DELETE FROM agent_issues");
  db.prepare("INSERT INTO agent_issues (status, title) VALUES ('open', ?)").run("BLINDSPOT-1: 12 " + s);
  db.prepare("INSERT INTO agent_issues (status, title) VALUES ('open', ?)").run("BLINDSPOT-1: 12 something else");
  const o = db.prepare("SELECT COUNT(*) n FROM agent_issues a WHERE a.status = 'open' AND a.title LIKE 'BLINDSPOT-1: % " + s + "'").get().n;
  const n = db.prepare("SELECT COUNT(*) n FROM agent_issues a WHERE a.status = 'open' AND (a.title LIKE 'BLINDSPOT-1: %' AND instr(a.title, ' " + s + "') > 0)").get().n;
  assert.equal(n, o);
}
assert.ok(JSON.parse(after).steps[0].sql.includes("instr(a.title, ' failure modes have a detector that never ran') > 0"));
db.exec(migration); // idempotent
assert.equal(db.prepare("SELECT definition FROM fleet_tasks WHERE id = 'blind-spot-audit'").get().definition, after);
console.log("blindspot-like-limit: ok");
