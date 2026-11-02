import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("./2026-11-02-verification-deferred-issue-100622.sql", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (condition, message, detail) => {
  if (condition) pass++;
  else {
    fail++;
    console.log("FAIL " + message + (detail === undefined ? "" : " :: " + JSON.stringify(detail).slice(0, 700)));
  }
};

const header = sql.split("\n").filter((line) => line.startsWith("--"));
const body = sql.split("\n").filter((line) => !line.startsWith("--")).join("\n");
ok(header.some((line) => /^-- APPLY-BY: ci\s*$/.test(line)) && header.some((line) => /^-- DB: qnfo-audit\s*$/.test(line)), "migration opts in");
ok(header.filter((line) => /^-- Rollback:/.test(line)).length === 1, "migration has one Rollback line");
ok(!/\b(DELETE\s+FROM|DROP\s+(TABLE|INDEX|VIEW|TRIGGER))\b/i.test(body), "migration does not delete or drop");
ok(!/\b(UPDATE|DELETE\s+FROM)\s+decision_log\b/i.test(body), "decision_log is append-only");

const closingProbe = "SELECT 'cleared' AS expected, CASE WHEN EXISTS (SELECT 1 FROM remediation_contracts c WHERE c.class = 'issue-100622' AND c.status = 'active' AND c.deferred_since IS NOT NULL AND (c.last_verdict LIKE 'deferred%' OR (c.last_verdict = 'fail' AND lower(trim(COALESCE((SELECT e.observed FROM v_remediation_evidence_all e WHERE e.class = c.class ORDER BY e.verified_at DESC LIMIT 1), ''))) LIKE 'pending%'))) THEN 'pending: contract issue-100622 still defers' ELSE 'cleared' END AS observed";

function world({ closeEvidence = "remediation_verifications#411462", status = "active", verdict = "deferred", deferredSince = "2026-10-25 17:31:01" } = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, status TEXT);
CREATE TABLE issue_triage (issue_id INTEGER PRIMARY KEY, close_evidence TEXT);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, verify_probe TEXT NOT NULL, status TEXT, last_verdict TEXT, deferred_since TEXT, next_due_at TEXT);
CREATE TABLE remediation_verifications (id INTEGER PRIMARY KEY, class TEXT, observed TEXT, verified_at TEXT);
CREATE VIEW v_remediation_evidence_all AS SELECT * FROM remediation_verifications;
CREATE TABLE research_queue (status TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT, outcome_matched INTEGER);`);
  db.prepare("INSERT INTO agent_issues VALUES (100622, 'COST-SUSTAIN-1', 'closed')").run();
  db.prepare("INSERT INTO issue_triage VALUES (100622, ?)").run(closeEvidence);
  db.prepare("INSERT INTO agent_issues VALUES (1001218, 'VERIFICATION-DEFERRED-7D-1', 'open')").run();
  db.prepare("INSERT INTO remediation_contracts VALUES ('issue-100622', 100622, ?, ?, ?, ?, '2026-11-02 16:21:33')").run(
    "SELECT 'ok' AS expected, CASE WHEN (SELECT COUNT(*) FROM research_queue WHERE status='queued') <= 150 THEN 'ok' ELSE 'pending: queued=' || (SELECT COUNT(*) FROM research_queue WHERE status='queued') END AS observed",
    status,
    verdict,
    deferredSince,
  );
  db.prepare("INSERT INTO remediation_contracts VALUES ('issue-1001218', 1001218, ?, 'active', 'deferred', '2026-11-01 22:11:02', '2026-11-02 16:21:33')").run(closingProbe);
  db.prepare("INSERT INTO remediation_contracts VALUES ('issue-100500', 100500, 'SELECT 1', 'active', 'deferred', '2026-10-25 17:31:01', '2026-11-02 16:21:33')").run();
  db.prepare("INSERT INTO agent_issues VALUES (100500, 'unproven closure', 'closed')").run();
  for (let i = 0; i < 192; i++) db.prepare("INSERT INTO research_queue VALUES ('queued')").run();
  return db;
}

const one = (db, query, ...params) => db.prepare(query).get(...params);
const contract = (db, name) => one(db, "SELECT * FROM remediation_contracts WHERE class = ?", name);
const target = world();
const oldProbe = contract(target, "issue-100622").verify_probe;
ok(one(target, closingProbe).observed === "pending: contract issue-100622 still defers", "closing probe reads pending before supersession");
ok(one(target, oldProbe).observed === "pending: queued=192", "the closed issue's original probe still exposes the queued threshold");

target.exec(sql);
target.exec(sql);
const superseded = contract(target, "issue-100622");
ok(superseded.status === "superseded" && superseded.deferred_since === null && superseded.next_due_at === null, "only the closed issue's deferred contract is superseded", superseded);
ok(/^superseded:contract-on-closed-issue/.test(superseded.last_verdict), "supersession uses the established closed-issue disposition");
ok(superseded.verify_probe === oldProbe && one(target, oldProbe).observed === "pending: queued=192", "the original queue condition remains unchanged");
ok(one(target, closingProbe).observed === "cleared", "issue 1001218 closing probe reads cleared after supersession");
ok(one(target, "SELECT status FROM agent_issues WHERE id = 100622").status === "closed", "the source issue is not changed");
ok(one(target, "SELECT close_evidence FROM issue_triage WHERE issue_id = 100622").close_evidence === "remediation_verifications#411462", "the source issue's close evidence is preserved");
ok(one(target, "SELECT COUNT(*) AS n FROM research_queue WHERE status = 'queued'").n === 192, "the queued research work is not changed");
ok(contract(target, "issue-100500").status === "active" && contract(target, "issue-100500").deferred_since !== null, "another deferred contract is untouched");
ok(one(target, "SELECT COUNT(*) AS n FROM decision_log").n === 1, "migration replay inserts one decision row");
const decision = one(target, "SELECT * FROM decision_log");
ok(decision.action.includes("issue-100622") && decision.action.includes("closed with evidence") && decision.rollback_path.includes("bak_20261102_vd_issue_100622"), "decision names the contract, reason and revert path", decision);
ok(one(target, "SELECT COUNT(*) AS n FROM bak_20261102_vd_issue_100622").n === 1, "backup captures the changed contract");

const rollback = /^-- Rollback: (.*)$/m.exec(sql)[1].split(";").map((statement) => statement.trim()).filter(Boolean);
ok(rollback.length === 1, "rollback is a single statement");
for (const statement of rollback) target.exec(statement);
const restored = contract(target, "issue-100622");
ok(restored.status === "active" && restored.last_verdict === "deferred" && restored.deferred_since === "2026-10-25 17:31:01" && restored.next_due_at === "2026-11-02 16:21:33", "rollback restores the exact prior contract state", restored);
ok(one(target, closingProbe).observed === "pending: contract issue-100622 still defers", "rollback restores the pending closing-probe result");
ok(one(target, "SELECT COUNT(*) AS n FROM decision_log").n === 1, "rollback preserves the append-only decision");

const noEvidence = world({ closeEvidence: "", status: "active", verdict: "deferred" });
noEvidence.exec(sql);
ok(contract(noEvidence, "issue-100622").status === "active" && contract(noEvidence, "issue-100622").deferred_since !== null, "without close evidence, the contract is left alone");
ok(one(noEvidence, "SELECT COUNT(*) AS n FROM decision_log").n === 0, "without a matching contract change, no decision is recorded");

const notDeferred = world({ status: "active", verdict: "pass", deferredSince: null });
notDeferred.exec(sql);
ok(contract(notDeferred, "issue-100622").status === "active" && contract(notDeferred, "issue-100622").last_verdict === "pass", "a contract with an existing verdict is left alone");

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
