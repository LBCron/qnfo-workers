import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

// BLOCKER-REDTEAM-AUTO-3a: the migration removes only the wrong signed verdict for issue 3003 and keeps a copy.
const migration = readFileSync(new URL("./2026-11-05-redteam-3003-retract.sql", import.meta.url), "utf8");
assert.match(migration, /^-- APPLY-BY: ci$/m);
assert.match(migration, /^-- DB: qnfo-audit$/m);
assert.match(migration, /^-- BACKUP: bak_20261105_blocker_redteam_3003$/m);
assert.match(migration, /^-- Rollback: /m);
const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE blocker_redteam (id INTEGER PRIMARY KEY, target TEXT, claim TEXT, attempt TEXT, verdict TEXT, evidence TEXT, actor TEXT, text_sig TEXT, ts TEXT)");
const ins = db.prepare("INSERT INTO blocker_redteam (id, target, claim, attempt, verdict, evidence, actor, text_sig, ts) VALUES (?, ?, 'c', 'a', ?, ?, ?, ?, '2026-11-04T23:58:07Z')");
ins.run(345, "issue:3003", "false-belief-removed", "not a blocker claim, every occurrence is negated: **Why the metric is not moving:** two producers are blocked by publication-quality | surfaces: x", "blocker-redteam-runner", "127:4335");
ins.run(346, "issue:1000275", "false-belief-removed", "not a blocker claim, every occurrence is negated: so nothing is blocked | surfaces: x", "blocker-redteam-runner", "121:2426");
ins.run(347, "issue:3003", "confirmed-with-evidence", "an earlier session verdict", "session", null);
db.exec(migration);
assert.deepEqual(db.prepare("SELECT id FROM blocker_redteam ORDER BY id").all().map((r) => r.id), [346, 347], "only the wrong row is removed");
assert.deepEqual(db.prepare("SELECT id FROM bak_20261105_blocker_redteam_3003").all().map((r) => r.id), [345], "the removed row is kept in the backup");
db.exec(migration);
assert.equal(db.prepare("SELECT COUNT(*) n FROM blocker_redteam").get().n, 2, "idempotent");
console.log("redteam-3003-retract: ok");
