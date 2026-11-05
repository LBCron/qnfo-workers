// PLAN-STARVATION-1 + DISABLED-TRIGGER-TICKET-1 offline suite for migrations/2026-11-05-red-drain-headroom.sql.
// Real SQLite (node:sqlite) with the close guards of qnfo-audit copied in: the migration is applied to a seeded database, then replayed, then rolled back.
// Proves: 1 the red-drain dispatch step takes the queue-headroom gate and nothing else changes (41 queued rows still dispatch, 42 dispatch nothing);
//         2 the six dead-end tickets close with evidence: two superseded by the enabled parent ticket, four moot; contracts superseded; a re-enabled trigger's ticket stays open;
//         3 the two detector probes read what they should before and after; 4 replay changes nothing; 5 the rollback line restores the workflow and reopens the tickets.
// Run: node --no-warnings migrations/red-drain-headroom.test.mjs   (exit 0 = all passed)
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const migration = readFileSync(fileURLToPath(new URL("./2026-11-05-red-drain-headroom.sql", import.meta.url)), "utf8");
const rollback = migration.match(/^-- Rollback: (.+)$/m)?.[1];
assert.ok(rollback, "one rollback line");
assert.match(migration, /^-- APPLY-BY: ci$/m);
assert.match(migration, /^-- DB: qnfo-audit$/m);
const body = migration.replace(/^--.*$/gm, "");

const DISPATCH = "INSERT OR IGNORE INTO code_tasks (id, repo, path, goal, status, step, attempts, created_at, updated_at)\n      SELECT 'ct_im' || a.id, 'qnfo-workers', 'w' || a.id || '/worker.js', a.title || ' -- issue #' || a.id || ' (RED-DRAIN-1 dispatch).', 'queued', 'read', 0, datetime('now'), datetime('now')\n        FROM agent_issues a\n       WHERE a.status = 'open' AND a.description LIKE '%code-task:%'\n         AND NOT EXISTS (SELECT 1 FROM code_tasks ct WHERE ct.id = 'ct_im' || a.id) /* RED-DRAIN-SCOPE-1 */\n       LIMIT 5";
const DEFINITION = JSON.stringify({ steps: [{ type: "sql", db: "AUDIT", sql: "SELECT 0" }, { type: "sql", db: "AUDIT", sql: "SELECT 1" }, { type: "sql", db: "AUDIT", sql: "SELECT 2 LIMIT 5" }, { type: "sql", db: "AUDIT", sql: DISPATCH }, { type: "sql", db: "AUDIT", sql: "SELECT 4 LIMIT 5" }] });

const db = () => {
  const d = new DatabaseSync(":memory:");
  d.exec(`
    CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, status TEXT, title TEXT, description TEXT, priority TEXT, close_channel TEXT, created_at INTEGER, updated_at INTEGER);
    CREATE TABLE issue_triage (issue_id INTEGER PRIMARY KEY, rc TEXT, triage_state TEXT, owner TEXT, triaged_at TEXT, close_evidence TEXT);
    CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER, escalate_to TEXT, expected_cadence_h INTEGER, status TEXT, last_verdict TEXT, last_attempt_at TEXT, next_due_at TEXT, module TEXT);
    CREATE TABLE analytics_metric_triggers (id INTEGER PRIMARY KEY, metric_key TEXT, enabled INTEGER);
    CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, last_value TEXT);
    CREATE TABLE metric_deps (child_metric TEXT, parent_metric TEXT, relation TEXT, active INTEGER);
    CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT, root_cause TEXT, remediation TEXT, detector TEXT, probe_class TEXT, first_seen TEXT, issue_id INTEGER);
    CREATE TABLE decision_log (id INTEGER PRIMARY KEY, actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
    CREATE TABLE fleet_tasks (id TEXT PRIMARY KEY, definition TEXT, version INTEGER, updated_at TEXT);
    CREATE TABLE code_tasks (id TEXT PRIMARY KEY, repo TEXT, path TEXT, goal TEXT, status TEXT, step TEXT, attempts INTEGER, created_at TEXT, updated_at TEXT);
    CREATE TABLE issue_plans (issue_id INTEGER PRIMARY KEY, planned_at TEXT, outcome TEXT);
    CREATE TRIGGER issue_close_evidence_required BEFORE UPDATE OF status ON agent_issues
    WHEN NEW.status IN ('closed', 'resolved', 'wontfix') AND OLD.status NOT IN ('closed', 'resolved', 'wontfix')
    BEGIN SELECT RAISE(ABORT, 'close-without-evidence') WHERE NOT EXISTS (SELECT 1 FROM issue_triage t WHERE t.issue_id = NEW.id AND COALESCE(t.close_evidence, '') <> ''); END;
    CREATE TRIGGER triage_close_sync_issue_upd AFTER UPDATE OF triage_state ON issue_triage
    WHEN NEW.triage_state IN ('closed', 'closed-refuted', 'wontfix')
    BEGIN UPDATE agent_issues SET status = CASE WHEN NEW.triage_state = 'wontfix' THEN 'wontfix' ELSE 'closed' END,
      close_channel = COALESCE(close_channel, 'auto:triage-sync:' || NEW.owner), updated_at = 1 WHERE id = NEW.issue_id AND status = 'open'; END;
  `);
  return d;
};
const OLD = 1700000000000; // ms, far older than 24 h
const IDS = [1753, 2022, 2467, 2564, 99928, 99954];
const seed = (d, { reEnabled2022 = false, queued = 0 } = {}) => {
  d.prepare("INSERT INTO fleet_tasks VALUES ('red-drain', ?, 10, '2026-11-01 00:00:00')").run(DEFINITION);
  const trig = { 1753: ["subscribers_growth_monthly", 341], 2022: ["social_engagement_rate_30d", 404], 2467: ["attention_decision_efficacy_30d", 1868], 2564: ["papers_live_failing_release_gate", 5916], 99928: ["fleet_ai_run_rate_30d_usd", 409], 99954: ["open_issues_without_doer_120m", 5944] };
  for (const id of IDS) {
    const [metric, tid] = trig[id];
    d.prepare("INSERT INTO agent_issues VALUES (?, 'open', ?, '', 'critical', NULL, ?, ?)").run(id, "METRIC-TRIGGER-" + tid + "-" + metric.toUpperCase().replace(/_/g, "-") + ": gap", OLD, OLD);
    d.prepare("INSERT INTO issue_triage VALUES (?, 'triaged', 'triaged', 'qnfo-fleet-control', NULL, NULL)").run(id);
    d.prepare("INSERT INTO analytics_metric_triggers VALUES (?, ?, ?)").run(tid, metric, id === 2022 && reEnabled2022 ? 1 : 0);
    d.prepare("INSERT INTO metric_registry VALUES (?, '7')").run(metric);
    d.prepare("INSERT INTO remediation_contracts (class, issue_id, status, last_verdict, next_due_at) VALUES (?, ?, 'monitoring', 'monitoring:metric-condition', '2026-11-05 03:00:00')").run("issue-" + id, id);
  }
  // enabled parents and their open tickets
  d.prepare("INSERT INTO analytics_metric_triggers VALUES (3689, 'monthly_cost_run_rate_usd', 1)").run();
  d.prepare("INSERT INTO analytics_metric_triggers VALUES (9901, 'issues_over_24h_no_doer', 1)").run();
  d.prepare("INSERT INTO agent_issues VALUES (99938, 'open', 'METRIC-TRIGGER-3689-MONTHLY-COST-RUN-RATE-USD: cost', '', 'critical', NULL, ?, ?)").run(OLD, OLD);
  d.prepare("INSERT INTO agent_issues VALUES (100301, 'open', 'METRIC-TRIGGER-9901-ISSUES-OVER-24H-NO-DOER: no doer', '', 'critical', NULL, ?, ?)").run(OLD, OLD);
  d.prepare("INSERT INTO metric_deps VALUES ('fleet_ai_run_rate_30d_usd', 'monthly_cost_run_rate_usd', 'disabled-duplicate', 1)").run();
  d.prepare("INSERT INTO metric_deps VALUES ('open_issues_without_doer_120m', 'issues_over_24h_no_doer', 'disabled-duplicate', 1)").run();
  // an unrelated open ticket with an enabled trigger must never be touched
  d.prepare("INSERT INTO agent_issues VALUES (5000, 'open', 'METRIC-TRIGGER-9999-SOMETHING: gap', '', 'critical', NULL, ?, ?)").run(OLD, OLD);
  d.prepare("INSERT INTO analytics_metric_triggers VALUES (9999, 'something', 1)").run();
  // dispatch candidates
  for (let i = 0; i < queued; i++) d.prepare("INSERT INTO code_tasks VALUES (?, 'qnfo-workers', 'q/worker.js', 'g', 'queued', 'read', 0, 'n', 'n')").run("ct_q" + i);
  for (let i = 1; i <= 8; i++) d.prepare("INSERT INTO agent_issues VALUES (?, 'open', 'ISSUE X', 'code-task: repo=qnfo-workers path=w/worker.js', 'critical', NULL, ?, ?)").run(7000 + i, OLD, OLD);
};
const status = (d, id) => d.prepare("SELECT status FROM agent_issues WHERE id = ?").get(id).status;
const evidence = (d, id) => d.prepare("SELECT close_evidence FROM issue_triage WHERE issue_id = ?").get(id).close_evidence;
const dispatchOf = (d) => JSON.parse(d.prepare("SELECT definition FROM fleet_tasks WHERE id = 'red-drain'").get().definition).steps[3].sql;

// 1. the workflow step
{
  const d = db(); seed(d, { queued: 0 });
  d.exec(body);
  const row = d.prepare("SELECT definition, version FROM fleet_tasks WHERE id = 'red-drain'").get();
  const steps = JSON.parse(row.definition).steps, before = JSON.parse(DEFINITION).steps;
  assert.equal(row.version, 11, "version raised by one");
  assert.equal((steps[3].sql.match(/QUEUE-HEADROOM-1/g) || []).length, 1, "the marker occurs once");
  assert.ok(steps[3].sql.includes("< 42 /* QUEUE-HEADROOM-1 */ LIMIT 5"), "the gate sits in front of LIMIT 5");
  for (const i of [0, 1, 2, 4]) assert.equal(steps[i].sql, before[i].sql, "step " + i + " is untouched (a LIMIT 5 elsewhere is not replaced)");
  assert.equal(steps.length, before.length);
  // 41 queued rows: the dispatch still inserts (up to 5); 42: nothing
  const run = (n) => { const e = db(); seed(e, { queued: n }); e.exec(body); e.prepare("DELETE FROM code_tasks WHERE id LIKE 'ct_im%'").run(); e.exec(dispatchOf(e)); return e.prepare("SELECT COUNT(*) AS n FROM code_tasks WHERE id LIKE 'ct_im%'").get().n; };
  assert.equal(run(41), 5, "41 queued rows: the dispatch inserts its five");
  assert.equal(run(42), 0, "42 queued rows: the dispatch inserts nothing (six slots stay with the planner)");
  assert.equal(run(0), 5);
}

// 2. the dead-end tickets
{
  const d = db(); seed(d);
  d.exec(body);
  for (const id of IDS) assert.equal(status(d, id), "closed", "ticket " + id + " closed");
  assert.match(evidence(d, 99928), /^SUPERSEDED BY #99938: trigger 409 \(fleet_ai_run_rate_30d_usd\) is disabled/);
  assert.match(evidence(d, 99954), /^SUPERSEDED BY #100301: trigger 5944 \(open_issues_without_doer_120m\) is disabled/);
  for (const id of [1753, 2022, 2467, 2564]) assert.match(evidence(d, id), /^MOOT: trigger \d+ \(\w+\) is disabled .*last_value 7\)/s, "moot evidence for " + id);
  for (const id of IDS) assert.equal(d.prepare("SELECT close_channel FROM agent_issues WHERE id = ?").get(id).close_channel, "session:breach-remediation", "the channel is named before the triage sync can default it");
  for (const id of IDS) assert.equal(d.prepare("SELECT status FROM remediation_contracts WHERE class = ?").get("issue-" + id).status, "superseded");
  assert.equal(status(d, 5000), "open", "an unrelated ticket stays open");
  assert.equal(status(d, 99938), "open"); assert.equal(status(d, 100301), "open");
  assert.equal(d.prepare("SELECT COUNT(*) AS n FROM bak_20261105_disabled_trigger_tickets").get().n, 6, "before-state kept for all six");
}
{
  const d = db(); seed(d, { reEnabled2022: true });
  d.exec(body);
  assert.equal(status(d, 2022), "open", "a ticket whose trigger was re-enabled is not closed");
  assert.equal(d.prepare("SELECT status FROM remediation_contracts WHERE class = 'issue-2022'").get().status, "monitoring", "and its contract is untouched");
  assert.equal(status(d, 1753), "closed");
}

// 3. the detectors
{
  const d = db(); seed(d);
  const probe = (cls) => d.prepare("SELECT verify_probe FROM remediation_contracts WHERE class = ?").get(cls).verify_probe;
  const before = d.prepare("SELECT COUNT(*) AS n FROM agent_issues").get().n;
  d.exec(body);
  const det = d.prepare(probe("fm-disabled-trigger-ticket-open")).get();
  assert.deepEqual({ ...det }, { expected: "0", observed: "0" }, "no open ticket of a disabled trigger after the migration");
  d.prepare("INSERT INTO agent_issues VALUES (6000, 'open', 'METRIC-TRIGGER-77-NEW-THING: gap', '', 'critical', NULL, ?, ?)").run(OLD, OLD);
  d.prepare("INSERT INTO analytics_metric_triggers VALUES (77, 'new_thing', 0)").run();
  assert.equal(d.prepare(probe("fm-disabled-trigger-ticket-open")).get().observed, "1", "a later disabled trigger with an open ticket is seen");
  const silent = probe("fm-planner-silent");
  assert.equal(d.prepare(silent).get().observed, "0", "no verdict in 12 h reads 0");
  d.prepare("INSERT INTO issue_plans VALUES (1, strftime('%Y-%m-%dT%H:%M:%SZ','now'), 'untrusted')").run();
  assert.deepEqual({ ...d.prepare(silent).get() }, { expected: "1", observed: "1" }, "a verdict in 12 h reads 1");
  const c = d.prepare("SELECT status, next_due_at FROM remediation_contracts WHERE class = 'fm-planner-silent'").get();
  assert.equal(c.status, "active"); assert.ok(c.next_due_at > new Date().toISOString().slice(0, 10), "the first probe waits three hours for the deploy");
  assert.equal(d.prepare("SELECT COUNT(*) AS n FROM failure_modes WHERE fm_key IN ('disabled-trigger-ticket-open','planner-silent')").get().n, 2);
  assert.equal(before, d.prepare("SELECT COUNT(*) AS n FROM agent_issues").get().n - 1, "the migration deletes no issue row");
}

// 4. replay
{
  const d = db(); seed(d);
  d.exec(body);
  const snap = () => JSON.stringify([d.prepare("SELECT * FROM fleet_tasks").all(), d.prepare("SELECT id,status,close_channel FROM agent_issues ORDER BY id").all(), d.prepare("SELECT * FROM issue_triage ORDER BY issue_id").all(), d.prepare("SELECT class,status,last_verdict FROM remediation_contracts ORDER BY class").all(), d.prepare("SELECT COUNT(*) AS n FROM decision_log").all()]);
  const a = snap();
  d.exec(body);
  assert.equal(snap(), a, "replay changes nothing (version, tickets, contracts, decision_log)");
}

// 5. rollback
{
  const d = db(); seed(d);
  const original = JSON.stringify(d.prepare("SELECT definition FROM fleet_tasks").all());
  d.exec(body);
  d.exec(rollback);
  assert.equal(JSON.stringify(d.prepare("SELECT definition FROM fleet_tasks").all()), original, "the workflow definition is restored");
  for (const id of IDS) { assert.equal(status(d, id), "open", "ticket " + id + " reopened"); assert.equal(d.prepare("SELECT triage_state FROM issue_triage WHERE issue_id = ?").get(id).triage_state, "triaged"); assert.equal(d.prepare("SELECT status FROM remediation_contracts WHERE class = ?").get("issue-" + id).status, "monitoring"); }
  assert.equal(d.prepare("SELECT COUNT(*) AS n FROM remediation_contracts WHERE class IN ('fm-disabled-trigger-ticket-open','fm-planner-silent')").get().n, 0);
}

console.log("red-drain-headroom.test: all assertions passed");
