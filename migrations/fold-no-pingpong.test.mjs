// FOLD-NO-PINGPONG-1 offline suite: rule d1-overload-superseded of issue-meta-fold skips an issue reopened in the last 24 hours and folds the rest as before.
// Run: node --no-warnings migrations/fold-no-pingpong.test.mjs   (exit 0 = all passed)
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const rd = (f) => readFileSync(new URL("./" + f, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const sql = rd("2026-11-04-fold-no-pingpong.sql");
const foldSrc = rd("2026-11-04-issue-hygiene-d1-overload-supersede.sql");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? "  -- " + JSON.stringify(x).slice(0, 400) : "")); } };
ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: .+/m.test(sql), "migration opts in with APPLY-BY, DB and Rollback headers");

// the rule's statement exactly as the hygiene migration installs it (the first INSERT INTO issue_fold_ledger line)
const RULE = foldSrc.split("\n").find((l) => l.startsWith("INSERT INTO issue_fold_ledger (issue_id, rule, successor_id") && l.includes("'d1-overload-superseded'")).replace(/;$/, "");
ok(RULE.includes("AND NOT EXISTS (SELECT 1 FROM issue_fold_ledger f WHERE f.issue_id = m.id AND f.applied = 0) ORDER BY m.id LIMIT 200"), "the rule text carries the anchor this migration replaces");

const definition = JSON.stringify({ steps: [{ type: "sql", db: "AUDIT", sql: RULE }, { type: "sql", db: "AUDIT", sql: "SELECT 1" }] });
const db = new DatabaseSync(":memory:");
db.exec(`
CREATE TABLE fleet_tasks (id TEXT PRIMARY KEY, definition TEXT, version INTEGER, updated_at TEXT);
CREATE TABLE fleet_tasks_canonical (id TEXT PRIMARY KEY, definition TEXT, repo_path TEXT, exported_at TEXT);
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, status TEXT, updated_at INTEGER, close_channel TEXT);
CREATE TABLE issue_triage (issue_id INTEGER PRIMARY KEY, triage_state TEXT, close_evidence TEXT, reopened_count INTEGER, triaged_at TEXT);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, status TEXT, last_verdict TEXT, last_attempt_at TEXT);
CREATE TABLE issue_lifecycle (id INTEGER PRIMARY KEY AUTOINCREMENT, issue_id INTEGER NOT NULL, event TEXT NOT NULL, ts TEXT NOT NULL);
CREATE INDEX idx_issue_lifecycle_issue ON issue_lifecycle (issue_id, ts);
CREATE TABLE issue_fold_ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, issue_id INTEGER, rule TEXT, successor_id INTEGER, evidence TEXT, agent_status TEXT, agent_updated_at INTEGER, agent_close_channel TEXT, triage_state TEXT, triage_close_evidence TEXT, triage_reopened_count INTEGER, triage_triaged_at TEXT, contract_class TEXT, contract_status TEXT, contract_last_verdict TEXT, contract_last_attempt_at TEXT, applied INTEGER DEFAULT 0, created_at TEXT, applied_at TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
INSERT INTO agent_issues VALUES (100, 'CF-OBS-ISSUE-1: fleet: D1 DB is overloaded, all workers [cf-obs:d1-overload]', 'open', 0, NULL);
INSERT INTO agent_issues VALUES (1, 'CF-OBS-ISSUE-1: qnfo-a: D1_ERROR: D1 DB is overloaded x', 'open', 0, NULL),
  (2, 'LOOP-BREAKER-1: BRANCH-HYGIENE-1: D1_ERROR: D DB is overloaded', 'open', 0, NULL),
  (3, 'CF-OBS-ISSUE-1: qnfo-b: D1_ERROR: D1 DB is overloaded y', 'open', 0, NULL),
  (4, 'CF-OBS-ISSUE-1: qnfo-c: HttpServerError', 'open', 0, NULL);
INSERT INTO issue_triage VALUES (1, 'triaged', NULL, 0, 'x'), (2, 'triaged', NULL, 1, 'x'), (3, 'triaged', NULL, 1, 'x'), (4, 'triaged', NULL, 0, 'x');
`);
db.prepare("INSERT INTO fleet_tasks VALUES ('issue-meta-fold', ?, 6, 'x')").run(definition);
db.prepare("INSERT INTO fleet_tasks_canonical VALUES ('issue-meta-fold', ?, 'migrations/2026-11-04-issue-hygiene-d1-overload-supersede.sql', 'x')").run(definition);
const ev = (id, event, hoursAgo) => db.prepare("INSERT INTO issue_lifecycle (issue_id, event, ts) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now', ?))").run(id, event, "-" + hoursAgo + " hours");
ev(2, "reopened", 2);     // reopened by its producer 2 hours ago: stays open
ev(3, "reopened", 30);    // reopened 30 hours ago: folded again

const ledger = () => db.prepare("SELECT issue_id FROM issue_fold_ledger ORDER BY issue_id").all().map((r) => r.issue_id);
// before the change: the rule folds every overload issue, including the one reopened 2 hours ago
db.exec(RULE);
ok(ledger().join(",") === "1,2,3", "before: all three overload issues are selected, the unrelated error and the umbrella are not", ledger());
db.exec("DELETE FROM issue_fold_ledger");

db.exec(sql);
const t = db.prepare("SELECT definition, version FROM fleet_tasks WHERE id = 'issue-meta-fold'").get();
const step0 = JSON.parse(t.definition).steps[0].sql;
ok(t.version === 7 && step0.includes("FOLD-NO-PINGPONG-1") && JSON.parse(t.definition).steps.length === 2, "the workflow statement carries the new clause", { v: t.version });
ok(db.prepare("SELECT definition = (SELECT definition FROM fleet_tasks WHERE id = 'issue-meta-fold') eq FROM fleet_tasks_canonical WHERE id = 'issue-meta-fold'").get().eq === 1, "the canonical row moved with the live one");

db.exec(step0);
ok(ledger().join(",") === "1,3", "after: the issue reopened 2 hours ago is skipped, the one reopened 30 hours ago and the never-reopened one are folded", ledger());
ev(1, "reopened", 1);
db.exec("DELETE FROM issue_fold_ledger");
db.exec(step0);
ok(ledger().join(",") === "3", "an issue reopened since the last run is skipped on the next run", ledger());

db.exec(sql);
ok(db.prepare("SELECT version FROM fleet_tasks WHERE id = 'issue-meta-fold'").get().version === 7, "re-applying does not bump the version again");
ok(db.prepare("SELECT COUNT(*) n FROM decision_log WHERE action LIKE 'FOLD-NO-PINGPONG-1:%'").get().n === 1, "the decision is logged once");
ok(!JSON.parse(db.prepare("SELECT definition FROM bak_20261104_fold_no_pingpong").get().definition).steps[0].sql.includes("FOLD-NO-PINGPONG-1"), "the backup is the pre-change text");

console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
