// FM-DRIFT-1 (2026-11-05, pillar autonomy): open-issue contracts parked beyond the 90-minute drift bound are re-scheduled; closed-issue holds and in-bound rows are untouched.
// Run: node --no-warnings migrations/fm-drift-1.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const mig = readFileSync(new URL("./2026-11-05-fm-drift-1.sql", import.meta.url), "utf8");
assert.match(mig, /^-- APPLY-BY: ci$/m);
assert.match(mig, /^-- DB: qnfo-audit$/m);
assert.match(mig, /^-- Rollback: /m);
assert.match(mig, /^-- CAUSE-MAPPED: /m);
const bare = mig.replace(/^--.*$/gm, "");
assert.ok(!/\bDELETE FROM\b|\bDROP\b/i.test(bare), "no destructive statement");

const db = new DatabaseSync(":memory:");
db.exec(`
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, status TEXT);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, status TEXT, next_due_at TEXT, last_attempt_at TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, surfaces_tested TEXT);
INSERT INTO agent_issues VALUES (1, 'open'), (2, 'open'), (3, 'closed'), (4, 'open');
`);
const at = (m) => `datetime('now', '${m >= 0 ? "+" : ""}${m} minutes')`;
const ins = (cls, issue, status, due) => db.exec(`INSERT INTO remediation_contracts VALUES ('${cls}', ${issue}, '${status}', ${due === null ? "NULL" : at(due)}, ${at(-1)})`);
ins("issue-1", 1, "active", 105);   // parked by the old 2-hour back-off: re-scheduled
ins("issue-2", 2, "holding", 100);  // holding on an open issue: re-scheduled
ins("issue-3", 3, "holding", 1440); // closed issue regression watch (daily): untouched
ins("issue-4", 4, "active", 75);    // the new back-off: untouched
const due = (c) => db.prepare("SELECT next_due_at d FROM remediation_contracts WHERE class = ?").get(c).d;
const ahead = (c) => db.prepare("SELECT (julianday(next_due_at) - julianday('now')) * 1440 m FROM remediation_contracts WHERE class = ?").get(c).m;
const keep = { closed: due("issue-3"), fresh: due("issue-4") };
const drift = () => db.prepare("SELECT COUNT(*) n FROM remediation_contracts c JOIN agent_issues a ON a.id = c.issue_id WHERE a.status = 'open' AND c.status IN ('active', 'holding') AND c.next_due_at IS NOT NULL AND datetime(c.next_due_at) > datetime('now', '+90 minutes')").get().n;
assert.equal(drift(), 2, "two open-issue contracts drift before the fix");
db.exec(mig);
assert.equal(drift(), 0, "none drifts after the fix");
for (const c of ["issue-1", "issue-2"]) assert.ok(ahead(c) <= 30.5, c + " is due within 30 minutes");
assert.equal(due("issue-3"), keep.closed, "a closed issue's daily hold is untouched");
assert.equal(due("issue-4"), keep.fresh, "an in-bound contract is untouched");
assert.equal(db.prepare("SELECT COUNT(*) n FROM bak_20261105_fm_drift_1").get().n, 2, "the backup keeps the two parked due times");
db.exec(mig);
assert.equal(db.prepare("SELECT COUNT(*) n FROM decision_log WHERE action LIKE 'FM-DRIFT-1:%'").get().n, 1, "idempotent");
console.log("fm-drift-1: ok");
