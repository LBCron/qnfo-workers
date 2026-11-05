// PORTFOLIO-COST-CARD-1 follow-up offline suite for migrations/2026-11-05-portfolio-cost-card-arm.sql: the filing migration plus the arming UPDATE leave a code-probe segment that differs from the filed one
// (so the production trigger agent_issues_code_probe_upd fires), is the same JSON, parses, and ends at the first closing brace the trigger looks for; the UPDATE is idempotent and the rollback restores the filed text.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const rd = (n) => readFileSync(fileURLToPath(new URL(n, import.meta.url)), "utf8");
const strip = (s) => s.replace(/^--.*$/gm, "");
const arm = rd("./2026-11-05-portfolio-cost-card-arm.sql");
const rollback = arm.match(/^-- Rollback: (.+)$/m)?.[1];
assert.ok(rollback);
assert.match(arm, /^-- APPLY-BY: ci$/m);
assert.match(arm, /^-- DB: qnfo-audit$/m);

const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);");
db.exec(strip(rd("./2026-11-05-portfolio-cost-card-issue.sql")));
const probeOf = () => { const d = db.prepare("SELECT description FROM agent_issues").get().description; const i = d.indexOf("code-probe: {"); return d.slice(i + 12, i + 12 + d.slice(i + 12).indexOf("}") + 1); };
const filed = probeOf();
db.exec(strip(arm));
const armed = probeOf();
assert.notEqual(armed, filed, "the code-probe segment differs from the filed one: the trigger's OLD/NEW comparison fires");
assert.deepEqual(JSON.parse(armed), JSON.parse(filed), "same JSON");
assert.deepEqual(JSON.parse(armed).paths, ["qnfo-fleet-dashboard/worker.js"]);
assert.equal(typeof JSON.parse(armed).absent, "string");
const once = db.prepare("SELECT description, updated_at FROM agent_issues").get();
db.exec(strip(arm));
assert.equal(db.prepare("SELECT description FROM agent_issues").get().description, once.description, "idempotent");
db.exec(rollback);
assert.equal(probeOf(), filed, "rollback restores the filed segment");
console.log("portfolio-cost-card-arm.test: all assertions passed");
