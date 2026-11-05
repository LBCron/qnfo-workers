// PORTFOLIO-COST-CARD-1 offline suite for migrations/2026-11-05-portfolio-cost-card-issue.sql: the issue is filed once, carries a code-task line, an anchor and a parseable code-probe, and its source is one the code loop trusts.
// (No assertion pins the dashboard worker's current text: the fix removes the INSERT the probe names.)
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const migration = readFileSync(fileURLToPath(new URL("./2026-11-05-portfolio-cost-card-issue.sql", import.meta.url)), "utf8");
assert.ok(migration.match(/^-- Rollback: (.+)$/m));
assert.match(migration, /^-- APPLY-BY: ci$/m);
assert.match(migration, /^-- DB: qnfo-audit$/m);
const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);");
const body = migration.replace(/^--.*$/gm, "");
db.exec(body);
db.exec(body);
const rows = db.prepare("SELECT * FROM agent_issues").all();
assert.equal(rows.length, 1, "filed once, replay adds nothing");
const r = rows[0];
assert.equal(r.status, "open");
assert.ok(/^claude-session/.test(r.source), "source is a trusted origin prefix of the planner and the intake (claude-session*)");
assert.match(r.description, /^code-task: repo=qnfo-workers path=qnfo-fleet-dashboard\/worker\.js$/m);
assert.match(r.description, /^code-anchor: needs\.push\(\{ key: "portfolio-cost", action: "Spend decision: "$/m);
const probe = /^code-probe: (.+)$/m.exec(r.description);
assert.ok(probe, "a code-probe line");
const p = JSON.parse(probe[1]);
assert.deepEqual(p.paths, ["qnfo-fleet-dashboard/worker.js"]);
assert.ok(p.absent.includes("INSERT OR IGNORE INTO human_actions") && p.absent.includes("'portfolio-strategic')"), "absent names the card INSERT");
assert.ok(p.absent.length <= 300 && !p.absent.includes("\n"));
console.log("portfolio-cost-card-issue.test: all assertions passed");
