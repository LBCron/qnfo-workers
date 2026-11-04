// ISSUE-BIRTH-DOER-PROBE-1: replay birth, probe validation and evidence-only meta-folding.
// Run: node --no-warnings migrations/issue-birth-doer-probe.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const read = (f) => readFileSync(new URL("./" + f, import.meta.url), "utf8");
const db = new DatabaseSync(":memory:");
const base = read("issue-probe-agent.test.mjs");
db.exec(base.slice(base.indexOf("db.exec(`") + 9, base.indexOf("`);")));
db.exec(`
ALTER TABLE agent_issues ADD COLUMN source TEXT;
ALTER TABLE agent_issues ADD COLUMN updated_at INTEGER;
ALTER TABLE agent_issues ADD COLUMN close_channel TEXT;
ALTER TABLE remediation_contracts ADD COLUMN module TEXT;
ALTER TABLE remediation_contracts ADD COLUMN last_attempt_at TEXT;
ALTER TABLE decision_log ADD COLUMN reach_gain TEXT;
CREATE TABLE analytics_metric_triggers (id INTEGER PRIMARY KEY, owner TEXT);
CREATE TABLE service_registry (service TEXT PRIMARY KEY, state TEXT);
CREATE TABLE issue_source_hosts (source TEXT PRIMARY KEY, host TEXT);
CREATE TABLE issue_triage (issue_id INTEGER PRIMARY KEY, rc TEXT NOT NULL, triage_state TEXT NOT NULL, owner TEXT NOT NULL,
  sla_due_at TEXT NOT NULL, triaged_at TEXT, close_evidence TEXT, reopened_count INTEGER DEFAULT 0);
CREATE TABLE issue_lifecycle (issue_id INTEGER, event TEXT, from_status TEXT, to_status TEXT, has_evidence INTEGER);
CREATE TABLE code_tasks (id TEXT PRIMARY KEY, goal TEXT, status TEXT, updated_at TEXT);
CREATE TABLE issue_ledger (fingerprint TEXT PRIMARY KEY, title TEXT, status TEXT, last_seen TEXT);
CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, last_value TEXT, last_refreshed TEXT);
CREATE TABLE fleet_budget (node_class TEXT PRIMARY KEY, current REAL, cap REAL, updated_at TEXT);
CREATE TABLE value_readback (rung TEXT, usd_per_unit REAL, units_30d REAL);
CREATE VIEW v_value_for_money AS SELECT * FROM value_readback;
INSERT INTO service_registry VALUES ('qnfo-ai','live'), ('qnfo-fleet-control','live'), ('qnfo-ops','live'), ('retired-worker','retired');
INSERT INTO issue_source_hosts VALUES ('ai-observer','qnfo-ai'), ('old-observer','retired-worker');
INSERT INTO analytics_metric_triggers VALUES (123,'qnfo-ai');
CREATE TRIGGER agent_issues_autotriage2_ins AFTER INSERT ON agent_issues WHEN NEW.status = 'open'
BEGIN
  INSERT OR IGNORE INTO issue_triage (issue_id, rc, triage_state, owner, sla_due_at)
  VALUES (NEW.id, 'AUTOTRIAGE-1', 'triaged', 'qnfo-ops', datetime('now'));
END;
CREATE TRIGGER contract_probe_templates_test AFTER INSERT ON remediation_contracts
WHEN NEW.status = 'needs-machine-probe'
BEGIN
  UPDATE remediation_contracts SET status = 'monitoring', module = 'probe-template-v2d-loop',
    verify_probe = 'SELECT status FROM agent_issues WHERE id = ' || NEW.issue_id
  WHERE class = NEW.class;
  UPDATE remediation_contracts SET status = 'active', module = 'probe-template-v1h',
    verify_probe = 'SELECT ''0'' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM faults'
  WHERE class = NEW.class AND NEW.issue_id IN (SELECT id FROM agent_issues WHERE title LIKE 'METRIC-TRIGGER-%');
END;
CREATE TABLE faults (id INTEGER PRIMARY KEY);
INSERT INTO faults VALUES (1);
`);
// Reuse the close-evidence, lifecycle and triage-sync trigger fixtures from the hygiene suite.
const hygiene = read("issue-hygiene-6.test.mjs");
db.exec(read("2026-10-26-issue-probe-agent.sql"));
db.exec(read("2026-10-26-issue-hygiene-1.sql"));
const triggerText = hygiene.slice(hygiene.indexOf("const TRIGGERS = [") + 17, hygiene.indexOf("\nfunction build()"));
for (const trigger of eval(triggerText.replace(/;\s*$/, ""))) db.exec(trigger);
const sql = read("2026-11-01-issue-birth-doer-probe.sql");
db.exec(`
INSERT INTO agent_issues (id,title,description,source,priority,status,created_at)
VALUES (90,'Existing unmapped family','a defect','ai-observer','critical','open',1);
INSERT INTO remediation_contracts (class,issue_id,precondition,action,verify_probe,verify_transport,escalate_to,status,module)
VALUES ('issue-90',90,'old placeholder','VACUOUS-PROBE-V3-1','SELECT status FROM agent_issues WHERE id=90',
  'd1-query','qnfo-fleet-control','active','probe-template-v3-generic');
INSERT INTO agent_issues (id,title,source,priority,status,created_at)
VALUES (1000814,'OWNER-TASK-op-backlog','owner','critical','open',1);
INSERT INTO remediation_contracts (class,issue_id,precondition,action,verify_probe,verify_transport,escalate_to,status)
VALUES ('issue-1000814',1000814,'ISSUE-PROBE-AGENT-1','check','SELECT 1','d1-query','qnfo-fleet-control','active');
`);
db.exec(sql);
const steps = (id) => JSON.parse(db.prepare("SELECT definition FROM fleet_tasks WHERE id = ?").get(id).definition).steps;
const run = (id) => { for (const step of steps(id)) db.prepare(step.sql).run(); };
const issue = (id, title, source, priority = "high", status = "open", description = "a defect") =>
  db.prepare("INSERT INTO agent_issues (id,title,description,source,priority,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
    .run(id, title, description, source, priority, status, Date.now(), Date.now());
const one = (s, ...p) => db.prepare(s).get(...p);
const asked = (id) => one("SELECT * FROM cf_agent_requests WHERE instance = ?", "probe-issue-" + id);
const contract = (id) => one("SELECT * FROM remediation_contracts WHERE class = ?", "issue-" + id);
assert.equal(one("SELECT owner FROM issue_triage WHERE issue_id=90").owner, "qnfo-ai", "existing fallback owners are repaired");
assert.equal(one("SELECT owner FROM bak_20261101_issue_birth_owners WHERE issue_id=90").owner, "qnfo-ops");

issue(101, "Unknown family", "new-filer", "critical");
assert.equal(one("SELECT owner FROM issue_triage WHERE issue_id=101").owner, "qnfo-fleet-control");
assert.equal(asked(101).priority, "critical");
assert.equal(one("SELECT request_id FROM issue_probe_requests WHERE issue_id=101").request_id, asked(101).id);
assert.equal(contract(101).status, "monitoring");
assert.equal(one("SELECT COUNT(*) n FROM v_issue_probe_intake WHERE issue_id=101").n, 1);
issue(102, "Source-owned family", "qnfo-ai:health");
issue(103, "Mapped family", "ai-observer");
issue(104, "Retired source", "old-observer");
issue(105, "METRIC-TRIGGER-123-AI", "unknown");
issue(106, "Explicit code task", "unknown", "high", "open", "code-task: repo=qnfo-workers path=qnfo-ai/worker.js");
for (const id of [102, 103, 105, 106]) assert.equal(one("SELECT owner FROM issue_triage WHERE issue_id=?", id).owner, "qnfo-ai");
assert.equal(one("SELECT owner FROM issue_triage WHERE issue_id=104").owner, "qnfo-fleet-control");
assert.equal(asked(105), undefined, "a specialized metric probe is not queued");
issue(107, "Closed family", "unknown", "high", "closed");
assert.equal(asked(107), undefined);
issue(108, "PROBE-NEEDED-1: issue-101 has no check", "unknown");
assert.equal(asked(108), undefined, "meta-tickets retain their dedicated folder");
issue(109, "TOOL-FAILURE: web_fetch [timeout]", "qnfo-ops");
assert.equal(asked(109), undefined, "tool templates retain ownership of their probes");
run("issue-probe-agent");
assert.equal(one("SELECT COUNT(*) n FROM cf_agent_requests WHERE instance='probe-issue-101'").n, 1);

const answer = (id, probe) => db.prepare("UPDATE cf_agent_requests SET status='done', result=? WHERE instance=?")
  .run(JSON.stringify({ verdict: "probe", probe, observed_now: "1", why: "measure faults" }), "probe-issue-" + id);
const probe = "SELECT '0' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM faults";
answer(101, probe);
answer(90, probe);
answer(102, "SELECT 'closed' AS expected, status AS observed FROM agent_issues WHERE id = 102");
answer(103, "SELECT '0' AS expected, '0' AS observed; DELETE FROM faults");
// A source-specific checker can arrive while the synthesis request is in flight.
db.prepare("UPDATE remediation_contracts SET precondition='specialized', module='specialized', verify_probe=? WHERE class='issue-104'").run(probe);
answer(104, "SELECT 'other' AS expected, 'other' AS observed FROM faults");
run("issue-probe-agent");
assert.equal(contract(101).verify_probe, probe);
assert.equal(contract(101).precondition, "ISSUE-PROBE-AGENT-1");
assert.equal(one("SELECT COUNT(*) n FROM v_issue_probe_intake WHERE issue_id=90").n, 0, "a repaired vacuous action is not queued again");
assert.ok(one("SELECT applied_at FROM issue_probe_requests WHERE issue_id=101").applied_at);
assert.deepEqual({ ...one(probe) }, { expected: "0", observed: "1" }, "the real defect fails its check");
assert.equal(one("SELECT verdict FROM issue_probe_requests WHERE issue_id=102").verdict, "rejected");
assert.equal(one("SELECT verdict FROM issue_probe_requests WHERE issue_id=103").verdict, "rejected");
assert.equal(contract(104).precondition, "specialized");
assert.equal(contract(104).verify_probe, probe);
assert.equal(one("SELECT applied_at FROM issue_probe_requests WHERE issue_id=104").applied_at, null);
assert.equal(one("SELECT COUNT(*) n FROM faults").n, 1, "a generated write never runs");
run("issue-meta-fold");
assert.equal(one("SELECT status FROM agent_issues WHERE id=108").status, "closed");
assert.match(one("SELECT close_evidence FROM issue_triage WHERE issue_id=108").close_evidence, /request .*target remains independently verified/);
assert.equal(one("SELECT status FROM agent_issues WHERE id=101").status, "open", "folding the meta-ticket does not close its failing target");
assert.equal(one("SELECT has_evidence FROM issue_lifecycle WHERE issue_id=108").has_evidence, 1);
assert.match(one("SELECT close_channel FROM agent_issues WHERE id=108").close_channel, /ISSUE-HYGIENE-1/);
db.exec("DELETE FROM faults");
assert.deepEqual({ ...one(probe) }, { expected: "0", observed: "0" }, "the same defect check passes only after recovery");

// Retry failures after 120 minutes, but never duplicate a queued/running request.
db.exec("UPDATE issue_probe_requests SET requested_at='2000-01-01T00:00:00Z'");
run("issue-probe-agent");
assert.equal(one("SELECT COUNT(*) n FROM cf_agent_requests WHERE instance='probe-issue-102'").n, 2);
assert.equal(one("SELECT COUNT(*) n FROM cf_agent_requests WHERE instance='probe-issue-106'").n, 1);
db.exec("UPDATE ops_config SET value='off' WHERE key='issue_probe_agent'");
issue(110, "Disabled synthesis", "unknown");
assert.equal(asked(110), undefined);
assert.ok(contract(110), "disabling synthesis does not drop the issue");
for (let id = 200; id < 220; id++) issue(id, "Batch family " + id, "unknown");
db.exec("UPDATE ops_config SET value='on' WHERE key='issue_probe_agent'");
const beforeBatch = one("SELECT MAX(id) id FROM cf_agent_requests").id;
db.prepare(steps("issue-probe-agent").find((s) => s.name === "probe-request").sql).run();
assert.equal(one("SELECT COUNT(*) n FROM cf_agent_requests WHERE id > ?", beforeBatch).n, 12, "hourly backfill retains its configured batch cap");

const definitions = one("SELECT group_concat(definition) d FROM fleet_tasks").d;
db.exec(sql);
assert.equal(one("SELECT group_concat(definition) d FROM fleet_tasks").d, definitions, "migration replay is idempotent");

// ISSUE-PROBE-CAP-3: the attempt cap must land on this live probe-request text (CAP-1 and CAP-2 matched the superseded October text and
// changed nothing). Applied in a savepoint so the rollback assertions below still compare against the Nov-01 backup.
db.exec("SAVEPOINT cap3");
const cap3 = read("2026-11-04-issue-probe-cap-3.sql");
const defBefore = one("SELECT definition FROM fleet_tasks WHERE id='issue-probe-agent'").definition;
db.exec(cap3);
const defAfter = one("SELECT definition FROM fleet_tasks WHERE id='issue-probe-agent'").definition;
assert.notEqual(defAfter, defBefore, "CAP-3 changes the live probe-request step");
assert.ok(defAfter.includes("/* probe-attempt-cap-3 */"), "the cap marker is in the workflow");
db.exec(cap3);
assert.equal(one("SELECT definition FROM fleet_tasks WHERE id='issue-probe-agent'").definition, defAfter, "CAP-3 replay is idempotent");
issue(300, "Cap family", "unknown");
const pr = () => db.prepare(steps("issue-probe-agent").find((x) => x.name === "probe-request").sql).run();
const asks300 = () => one("SELECT COUNT(*) n FROM cf_agent_requests WHERE instance='probe-issue-300'").n;
const age = () => db.exec("UPDATE issue_probe_requests SET requested_at='2000-01-01T00:00:00Z'; UPDATE cf_agent_requests SET status='done' WHERE instance='probe-issue-300'");
pr(); assert.equal(asks300(), 1, "first ask");
age(); pr(); assert.equal(asks300(), 2, "second ask after the 120-minute window");
age(); pr(); assert.equal(asks300(), 2, "CAP-3: a third ask inside the retry window is refused");
db.exec("UPDATE cf_agent_requests SET created_at='2000-01-01T00:00:00Z' WHERE instance='probe-issue-300'");
pr(); assert.equal(asks300(), 3, "CAP-3: after issue_probe_retry_days a capped issue is asked once more");
age(); pr(); assert.equal(asks300(), 3, "CAP-3: and not again inside the new window");
db.exec("ROLLBACK TO cap3; RELEASE cap3");
assert.equal(one("SELECT definition FROM fleet_tasks WHERE id='issue-probe-agent'").definition, defBefore, "the savepoint restores the Nov-01 text");
assert.equal(one("SELECT COUNT(*) n FROM decision_log WHERE action LIKE 'ISSUE-BIRTH-DOER-PROBE-1:%'").n, 1);
const readback = contract(1000814).verify_probe;
for (const [metric, value] of [
  ["issues_unprobed_60m", 193], ["issue_drain_ratio_24h", 0.9],
  ["issue_wontfix_share_7d", 0], ["remediation_latest_pass_pct_7d", 78.6],
  ["output_quality_outcomes_worse", 0], ["cost_usd_30d", 300],
  ["publications_30d", 263], ["papers_with_open_high_errata_pct", 2.4]
]) db.prepare("INSERT INTO metric_registry VALUES (?, ?, datetime('now'))").run(metric, String(value));
db.exec("INSERT INTO value_readback VALUES ('R1 correct (no open high-severity erratum)',1.5,260); INSERT INTO fleet_budget VALUES ('cost:fleet_all_in_month',299,300,datetime('now'))");
assert.deepEqual({ ...one(readback) }, { expected: "ok", observed: "ok" });
for (const change of [
  "UPDATE metric_registry SET last_value='194' WHERE metric='issues_unprobed_60m'",
  "UPDATE metric_registry SET last_value='0.881' WHERE metric='issue_drain_ratio_24h'",
  "UPDATE metric_registry SET last_value='1' WHERE metric='output_quality_outcomes_worse'",
  "UPDATE metric_registry SET last_value='78.5' WHERE metric='remediation_latest_pass_pct_7d'",
  "UPDATE metric_registry SET last_value=NULL WHERE metric='issue_wontfix_share_7d'",
  "UPDATE metric_registry SET last_refreshed=datetime('now','-121 minutes') WHERE metric='cost_usd_30d'",
  "UPDATE value_readback SET usd_per_unit=1.540858941594465",
  "UPDATE value_readback SET usd_per_unit=0",
  "UPDATE value_readback SET units_30d=0",
  "UPDATE fleet_budget SET current=301",
  "UPDATE fleet_budget SET current=0"
]) {
  db.exec("SAVEPOINT guard_case");
  db.exec(change);
  assert.notEqual(one(readback).observed, "ok", change);
  db.exec("ROLLBACK TO guard_case; RELEASE guard_case");
}
db.exec(sql.match(/^-- Rollback: (.+)$/m)[1]);
assert.equal(one("SELECT COUNT(*) n FROM sqlite_master WHERE name='v_issue_probe_intake'").n, 0);
assert.equal(one("SELECT definition FROM fleet_tasks WHERE id='issue-probe-agent'").definition,
  one("SELECT definition FROM bak_20261101_issue_birth_workflows WHERE id='issue-probe-agent'").definition);
assert.equal(one("SELECT status FROM agent_issues WHERE id=101").status, "open");
assert.equal(one("SELECT owner FROM issue_triage WHERE issue_id=90").owner, "qnfo-ops", "rollback restores the prior fallback owner");
assert.equal(contract(1000814).verify_probe, "SELECT 1", "rollback restores the original owner-task probe");
db.close();
console.log("issue-birth-doer-probe: birth ownership, validation, recovery, meta-fold, replay and rollback passed");
