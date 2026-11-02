// METRIC-TRIGGER-AUTOCLOSE-HIT-GUARD-1 offline suite: a remediation pass must not close a metric-trigger issue while its
// enabled trigger is hit or unreadable; measured recovery still closes it, and unrelated issues keep their existing path.
// Run: node migrations/metric-trigger-autoclose-hit-guard.test.mjs
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const sql = readFileSync(new URL("./2026-11-02-metric-trigger-autoclose-hit-guard.sql", import.meta.url), "utf8");
const db = new DatabaseSync(":memory:");
let pass = 0, fail = 0;
const ok = (condition, name, detail) => {
  if (condition) pass++;
  else { fail++; console.log("FAIL " + name + (detail === undefined ? "" : " :: " + JSON.stringify(detail))); }
};

db.exec(`CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, status TEXT, close_channel TEXT, updated_at INTEGER);
CREATE TABLE issue_triage (issue_id INTEGER PRIMARY KEY, rc TEXT, triage_state TEXT, owner TEXT, sla_due_at TEXT, close_evidence TEXT, reopened_count INTEGER DEFAULT 0);
CREATE TABLE remediation_verifications (id INTEGER PRIMARY KEY AUTOINCREMENT, issue_id INTEGER, class TEXT, observed TEXT, pass INTEGER, transport TEXT, verified_at TEXT);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, status TEXT, last_verdict TEXT, action TEXT, verify_probe TEXT);
CREATE TABLE analytics_metric_triggers (id INTEGER PRIMARY KEY, metric_key TEXT, operator TEXT, threshold REAL, enabled INTEGER);
CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, last_value TEXT);
CREATE VIEW v_metric_trigger_state AS
  SELECT t.id, CASE WHEN m.last_value IS NULL THEN NULL
    WHEN t.operator = 'lt' THEN CAST(m.last_value AS REAL) < t.threshold
    WHEN t.operator = 'gt' THEN CAST(m.last_value AS REAL) > t.threshold
    WHEN t.operator = 'lte' THEN CAST(m.last_value AS REAL) <= t.threshold
    WHEN t.operator = 'gte' THEN CAST(m.last_value AS REAL) >= t.threshold
    ELSE CAST(m.last_value AS REAL) = t.threshold END AS hit
  FROM analytics_metric_triggers t LEFT JOIN metric_registry m ON m.metric = t.metric_key
  WHERE t.enabled = 1;
CREATE TABLE control_registry (control TEXT PRIMARY KEY, location TEXT, guards_against TEXT, critical_path INTEGER, disposition TEXT, disposition_state TEXT, alternate_path TEXT, alternate_tested_at TEXT, evidence TEXT, issue_id INTEGER);
CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT, root_cause TEXT, remediation TEXT, detector TEXT, symptom TEXT, blast_radius TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT DEFAULT (datetime('now')), actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT, outcome_matched INTEGER);
INSERT INTO control_registry VALUES ('autoclose-hysteresis', 'old location', 'old guard', 0, 'keep', 'applied', 'old alternate', '2026-10-13', 'old evidence', NULL);
INSERT INTO failure_modes VALUES ('autoclose-flap', 'old mode', 'old cause', 'old fix', 'old detector', 'old symptom', 'old impact');
INSERT INTO remediation_contracts VALUES ('fm-autoclose-flap', NULL, 'active', 'pass', 'old action', 'old probe');
CREATE TRIGGER remediation_verification_autoclose_ins AFTER INSERT ON remediation_verifications WHEN NEW.pass = 1
  BEGIN UPDATE agent_issues SET status = 'closed' WHERE id = NEW.issue_id; END;
CREATE TRIGGER remediation_verification_autoclose_upd AFTER UPDATE OF pass ON remediation_verifications WHEN NEW.pass = 1 AND OLD.pass <> 1
  BEGIN UPDATE agent_issues SET status = 'closed' WHERE id = NEW.issue_id; END;
INSERT INTO analytics_metric_triggers VALUES (5795, 'issue_auto_close_2h_share_24h', 'lt', 1, 1),
  (5796, 'unmeasured_metric', 'gt', 0.5, 1), (5797, 'disabled_metric', 'gt', 0, 0);
INSERT INTO metric_registry VALUES ('issue_auto_close_2h_share_24h', '0.208'), ('unmeasured_metric', NULL), ('disabled_metric', '1');
INSERT INTO agent_issues VALUES
  (1, 'METRIC-TRIGGER-5795-ISSUE-AUTO-CLOSE: breach', 'open', NULL, 0),
  (2, 'METRIC-TRIGGER-5796-UNMEASURED-METRIC: unknown', 'open', NULL, 0),
  (3, 'ordinary remediation issue', 'open', NULL, 0),
  (4, 'METRIC-TRIGGER-5795-ISSUE-AUTO-CLOSE: update path', 'open', NULL, 0),
  (5, 'METRIC-TRIGGER-5797-DISABLED-METRIC: disabled', 'open', NULL, 0),
  (6, 'METRIC-TRIGGER-5795-ISSUE-AUTO-CLOSE: hysteresis', 'open', NULL, 0);
INSERT INTO issue_triage (issue_id, reopened_count) VALUES (6, 1);
`);

db.exec(sql);
const q = (query, ...values) => db.prepare(query).all(...values);
const one = (query, ...values) => db.prepare(query).get(...values);
const verifyInsert = (issue, cls, result = "pass", value = 1) =>
  db.prepare("INSERT INTO remediation_verifications (issue_id, class, observed, pass, transport, verified_at) VALUES (?, ?, ?, ?, 'd1-query', datetime('now'))").run(issue, cls, result, value);

ok(one("SELECT COUNT(*) AS n FROM bak_20261102_metric_trigger_autoclose WHERE kind='trigger'").n === 2, "both prior trigger definitions are backed up");
ok(one("SELECT COUNT(*) AS n FROM decision_log WHERE action LIKE 'METRIC-TRIGGER-AUTOCLOSE-HIT-GUARD-1:%'").n === 1, "the decision is logged once");
ok(one("SELECT disposition, disposition_state, critical_path FROM control_registry WHERE control='autoclose-hysteresis'").disposition === "keep", "the existing autoclose control remains applied");
ok(one("SELECT verify_probe FROM remediation_contracts WHERE class='fm-autoclose-flap'").verify_probe.includes("v_metric_trigger_state"), "the existing failure-mode contract verifies the live metric guard");

verifyInsert(1, "unrelated-contract");
ok(one("SELECT status FROM agent_issues WHERE id=1").status === "open" && !one("SELECT close_evidence FROM issue_triage WHERE issue_id=1"), "a passing unrelated contract cannot close an issue whose metric trigger is hit");
ok(one("SELECT COUNT(*) AS n FROM remediation_verifications WHERE issue_id=1 AND pass=1").n === 1, "the passing verification is retained as evidence");

verifyInsert(2, "unrelated-contract");
ok(one("SELECT status FROM agent_issues WHERE id=2").status === "open", "an unreadable metric trigger is not treated as recovery");

verifyInsert(3, "ordinary-contract");
ok(one("SELECT status FROM agent_issues WHERE id=3").status === "closed" && one("SELECT close_evidence FROM issue_triage WHERE issue_id=3").close_evidence.includes("remediation_verifications#"), "an ordinary issue still closes with verification evidence");

verifyInsert(4, "update-contract", "failed", 0);
db.prepare("UPDATE remediation_verifications SET pass=1, observed='pass' WHERE issue_id=4").run();
ok(one("SELECT status FROM agent_issues WHERE id=4").status === "open", "the update autoclose path also defers while the metric trigger is hit");
db.prepare("UPDATE metric_registry SET last_value='1' WHERE metric='issue_auto_close_2h_share_24h'").run();
verifyInsert(4, "update-recovered-contract", "failed", 0);
db.prepare("UPDATE remediation_verifications SET pass=1, observed='pass' WHERE issue_id=4 AND class='update-recovered-contract'").run();
ok(one("SELECT status FROM agent_issues WHERE id=4").status === "closed", "the update autoclose path closes after the metric trigger is measured clear");

verifyInsert(5, "disabled-contract");
ok(one("SELECT status FROM agent_issues WHERE id=5").status === "closed", "a disabled metric trigger does not strand its issue");

verifyInsert(6, "first-pass");
ok(one("SELECT status FROM agent_issues WHERE id=6").status === "open", "the existing reopened-issue two-pass hysteresis remains");
verifyInsert(6, "second-pass");
ok(one("SELECT status FROM agent_issues WHERE id=6").status === "closed", "a reopened non-metric issue closes after its second pass");

const backupCount = one("SELECT COUNT(*) AS n FROM bak_20261102_metric_trigger_autoclose").n;
db.exec(sql);
ok(one("SELECT COUNT(*) AS n FROM bak_20261102_metric_trigger_autoclose").n === backupCount, "reapplying preserves the original rollback snapshot");
ok(one("SELECT COUNT(*) AS n FROM decision_log WHERE action LIKE 'METRIC-TRIGGER-AUTOCLOSE-HIT-GUARD-1:%'").n === 1, "reapplying does not duplicate the decision");

console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
