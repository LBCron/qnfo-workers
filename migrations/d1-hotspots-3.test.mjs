// D1-HOTSPOTS-3 (2026-11-04, pillar cost): the partial index is chosen by the planner for the probe's own text, the over-budget probe gives the same answer as before with one
// pass over code_tasks, and the range form of v_breach_ticket_coverage_candidates returns what the LIKE form returned.
// Run: node --no-warnings migrations/d1-hotspots-3.test.mjs
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const mig = readFileSync(new URL("./2026-11-04-d1-hotspots-3.sql", import.meta.url), "utf8");
assert.match(mig, /^-- APPLY-BY: ci$/m);
assert.match(mig, /^-- DB: qnfo-audit$/m);
assert.match(mig, /^-- BACKUP: bak_20261104_d1_hotspots_3$/m);
assert.match(mig, /^-- Rollback: /m);
assert.match(mig, /^-- CAUSE-MAPPED: /m);

const OLD_PROBE = "SELECT '0' AS expected, CAST(CASE WHEN EXISTS (SELECT 1 FROM metric_registry m WHERE m.metric = 'remediation_contracts_over_budget' AND CAST(m.last_value AS INTEGER) = (SELECT COUNT(*) FROM remediation_contracts r WHERE r.status IN ('active','holding') AND r.last_verdict='fail' AND r.attempts > 5*COALESCE(r.max_attempts,3) AND substr(r.class,1,3) <> 'fm-' AND substr(r.class,1,7) <> 'belief-' AND NOT EXISTS (SELECT 1 FROM code_tasks ct WHERE ct.status NOT IN ('closed','superseded') AND ct.goal LIKE '%#' || r.issue_id || ' %') AND NOT (r.issue_id IS NOT NULL AND EXISTS (SELECT 1 FROM agent_issues a WHERE a.id=r.issue_id AND a.status='open' AND a.title NOT LIKE 'METRIC-TRIGGER-%') AND NOT EXISTS (SELECT 1 FROM remediation_contracts c2 WHERE c2.issue_id=r.issue_id AND c2.class<>r.class AND c2.status IN ('active','holding')))) AND m.last_refreshed >= strftime('%Y-%m-%dT%H:%M:%SZ','now','-120 minutes')) THEN 0 ELSE 1 END AS TEXT) AS observed";
const PENDING_PROBE = "SELECT COUNT(*) FROM remediation_verifications WHERE verified_at > '2026-10-19 17:30:52' AND pass = 0 AND verifier LIKE 'remediation-consumer@%' AND lower(trim(observed)) LIKE 'pending%' AND NOT (observed GLOB '*[0-9]*' AND (observed LIKE '%ceiling%'))";
const OLD_VIEW = "CREATE VIEW v_breach_ticket_coverage_candidates AS SELECT s.id AS trigger_id, s.metric_key, s.val, s.threshold FROM v_metric_trigger_state s WHERE s.hit = 1 AND s.queue_target = 'agent_issues' AND EXISTS (SELECT 1 FROM agent_issues a WHERE a.title LIKE 'METRIC-TRIGGER-' || s.id || '-%') AND NOT EXISTS (SELECT 1 FROM agent_issues a WHERE a.status = 'open' AND a.title LIKE 'METRIC-TRIGGER-' || s.id || '-%')";

const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE remediation_verifications (id INTEGER PRIMARY KEY AUTOINCREMENT, issue_id INTEGER, class TEXT, transport TEXT NOT NULL DEFAULT 'd1', observed TEXT, pass INTEGER NOT NULL, verified_at TEXT, verifier TEXT);
  CREATE INDEX idx_remediation_verifications_ts ON remediation_verifications (verified_at);
  CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, status TEXT, last_verdict TEXT, attempts INTEGER, max_attempts INTEGER, verify_probe TEXT);
  CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, last_value TEXT, last_refreshed TEXT);
  CREATE TABLE code_tasks (id TEXT PRIMARY KEY, status TEXT, goal TEXT);
  CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, status TEXT);
  CREATE INDEX idx_agent_issues_title ON agent_issues (title);
  CREATE TABLE trigger_states (id INTEGER PRIMARY KEY, metric_key TEXT, val REAL, threshold REAL, hit INTEGER, queue_target TEXT);
  CREATE VIEW v_metric_trigger_state AS SELECT * FROM trigger_states;
  CREATE TABLE decision_log (actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
`);
db.exec(OLD_VIEW);
const nowIso = new Date().toISOString().replace(/\.\d+Z$/, "Z");

// fixtures: contracts over budget with and without an open code task, one with a sibling contract, one with an open issue
db.exec(`
  INSERT INTO metric_registry VALUES ('remediation_contracts_over_budget', '2', '${nowIso}');
  INSERT INTO remediation_contracts VALUES ('issue-11', 11, 'active', 'fail', 99, 3, NULL);
  INSERT INTO remediation_contracts VALUES ('issue-12', 12, 'active', 'fail', 99, 3, NULL);
  INSERT INTO remediation_contracts VALUES ('issue-13', 13, 'active', 'fail', 99, 3, NULL);
  INSERT INTO remediation_contracts VALUES ('issue-14', 14, 'active', 'fail', 99, 3, NULL);
  INSERT INTO remediation_contracts VALUES ('fm-skip', 15, 'active', 'fail', 99, 3, NULL);
  INSERT INTO remediation_contracts VALUES ('issue-16', NULL, 'active', 'fail', 99, 3, NULL);
  INSERT INTO remediation_contracts VALUES ('fm-remediation-over-budget-metric-lifetime-count', NULL, 'active', 'fail', 1, 3, '${OLD_PROBE.replace(/'/g, "''")}');
  INSERT INTO code_tasks VALUES ('a', 'queued', 'fix thing #12 now');
  INSERT INTO code_tasks VALUES ('b', 'closed', 'old work #13 done');
  INSERT INTO code_tasks VALUES ('c', 'failed', 'prefix #123 not twelve');
  INSERT INTO agent_issues VALUES (14, 'real issue', 'open');
  INSERT INTO agent_issues VALUES (13, 'METRIC-TRIGGER-13-x', 'open');
`);
const run = (sql) => db.prepare(sql).get();
// candidates: 11 (no task), 13 (task closed), 16 (NULL issue), 14 has an open non-trigger issue with no sibling -> excluded, 12 has an open task -> excluded: expected count 3
db.exec(`UPDATE metric_registry SET last_value = '3'`);
assert.equal(run(OLD_PROBE).observed, "0", "the old probe agrees with the metric");

// coverage fixtures
db.exec(`
  INSERT INTO trigger_states VALUES (1, 'm1', 5, 1, 1, 'agent_issues');
  INSERT INTO trigger_states VALUES (2, 'm2', 5, 1, 1, 'agent_issues');
  INSERT INTO trigger_states VALUES (3, 'm3', 5, 1, 1, 'agent_issues');
  INSERT INTO trigger_states VALUES (4, 'm4', 5, 1, 0, 'agent_issues');
  INSERT INTO agent_issues VALUES (101, 'METRIC-TRIGGER-1-a breach', 'closed');
  INSERT INTO agent_issues VALUES (102, 'METRIC-TRIGGER-2-b breach', 'open');
  INSERT INTO agent_issues VALUES (103, 'METRIC-TRIGGER-12-c other id sharing the prefix', 'closed');
  INSERT INTO agent_issues VALUES (104, 'METRIC-TRIGGER-3', 'closed');
  INSERT INTO agent_issues VALUES (105, 'METRIC-TRIGGER-4-z', 'closed');
`);
const before = db.prepare("SELECT trigger_id FROM v_breach_ticket_coverage_candidates ORDER BY 1").all().map((r) => r.trigger_id);
assert.deepEqual(before, [1], "LIKE form: trigger 1 had a ticket and none is open; 2 has an open one; 3 has no '-' title; 4 is not a hit");

db.exec(mig);
db.exec(mig);   // idempotent
const after = db.prepare("SELECT trigger_id FROM v_breach_ticket_coverage_candidates ORDER BY 1").all().map((r) => r.trigger_id);
assert.deepEqual(after, before, "the range form returns what the LIKE form returned");
assert.equal(db.prepare("SELECT COUNT(*) n FROM bak_20261104_d1_hotspots_3").get().n, 2, "view and probe saved once");
assert.equal(db.prepare("SELECT body FROM bak_20261104_d1_hotspots_3 WHERE kind = 'view'").get().body.includes("LIKE 'METRIC-TRIGGER-'"), true, "the old view text is the backup");

const newProbe = db.prepare("SELECT verify_probe p FROM remediation_contracts WHERE class = 'fm-remediation-over-budget-metric-lifetime-count'").get().p;
assert.ok(!/ct\.goal LIKE/.test(newProbe) && /group_concat\(goal/.test(newProbe), "the probe reads the goals once");
assert.equal(run(newProbe).observed, "0", "same answer when the metric matches");
db.exec(`UPDATE metric_registry SET last_value = '4'`);
assert.equal(run(newProbe).observed, "1", "same answer when the metric is off by one");
assert.equal(run(OLD_PROBE).observed, "1");
db.exec(`DELETE FROM code_tasks; UPDATE metric_registry SET last_value = '4'`);     // no open task at all: group_concat is NULL, COALESCE keeps the probe alive; 11,12,13,16 are over budget now
assert.equal(run(newProbe).observed, run(OLD_PROBE).observed, "no open code task: both forms agree");

// the planner proves the partial index from the probe's own terms
const plan = db.prepare("EXPLAIN QUERY PLAN " + PENDING_PROBE).all().map((r) => r.detail).join(" | ");
assert.match(plan, /idx_rv_pending_fail/, plan);
const rows = db.prepare("INSERT INTO remediation_verifications (pass, observed, verified_at, verifier) VALUES (?, ?, ?, ?)");
rows.run(0, "pending: waiting", "2026-11-04T10:00:00Z", "remediation-consumer@abc");
rows.run(0, "  Pending", "2026-11-04T10:00:00Z", "remediation-consumer@abc");
rows.run(0, "fail", "2026-11-04T10:00:00Z", "remediation-consumer@abc");
rows.run(1, "pending", "2026-11-04T10:00:00Z", "remediation-consumer@abc");
assert.equal(db.prepare(PENDING_PROBE).get()["COUNT(*)"], 2, "the probe still counts the two failing pending rows");
console.log("d1-hotspots-3: ok");
