// PAPER-LEARN-PROJECTIONS-1 migration suite: verifies learning dispositions, rollout-bounded metrics and the label-omission trigger.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("./2026-11-03-paper-projection-remediation.sql", import.meta.url), "utf8");
const body = sql.split("\n").filter((line) => !line.startsWith("--")).join("\n");
const rollback = sql.match(/^-- Rollback: (.+)$/m)?.[1];
let passed = 0, failed = 0;
const ok = (condition, label, details) => {
  if (condition) passed++;
  else { failed++; console.error("FAIL " + label + (details === undefined ? "" : " :: " + JSON.stringify(details).slice(0, 500))); }
};

const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE paper_learnings (id INTEGER PRIMARY KEY, slug TEXT, version TEXT, applicability TEXT, kind TEXT, verification TEXT, claim TEXT, fleet_status TEXT, status_note TEXT, issue_id INTEGER, model TEXT, created_at TEXT, updated_at TEXT);
  CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT);
  CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, layer TEXT, kind TEXT, formula TEXT, source_of_truth TEXT, baseline TEXT, target TEXT, owner TEXT, disposition_actor TEXT, refresh_cadence TEXT, warning_band TEXT, kill_band TEXT, last_value TEXT, last_refreshed TEXT, state TEXT, refresh_class TEXT);
  CREATE TABLE metric_breach_cause (metric_key TEXT PRIMARY KEY, cause_key TEXT, note TEXT);
  CREATE TABLE analytics_metric_triggers (id INTEGER PRIMARY KEY, metric_key TEXT UNIQUE, title TEXT, source_table TEXT, operator TEXT, threshold REAL, priority INTEGER, action TEXT, owner TEXT, queue_target TEXT, cooldown_hours INTEGER, enabled INTEGER, notes TEXT);
  CREATE TABLE decision_log (id INTEGER PRIMARY KEY, actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
  INSERT INTO paper_learnings VALUES
    (5981,'the-speed-of-light-as-the-tracing-capacity-of-a-distributed-estimation-vacuum-ca','1.0.0','direct','derived','derived-unchecked','divergence time', 'probation',NULL,1001381,'reader','2026-11-02T20:00:00Z',NULL),
    (5982,'the-speed-of-light-as-the-tracing-capacity-of-a-distributed-estimation-vacuum-ca','1.0.0','direct','derived','derived-unchecked','gain ratio', 'probation',NULL,1001381,'reader','2026-11-02T20:00:00Z',NULL),
    (5984,'the-speed-of-light-as-the-tracing-capacity-of-a-distributed-estimation-vacuum-ca','1.0.0','direct','derived','derived-unchecked','sampling fraction', 'probation',NULL,1001381,'reader','2026-11-02T20:00:00Z',NULL),
    (5987,'the-speed-of-light-as-the-tracing-capacity-of-a-distributed-estimation-vacuum-ca','1.0.0','direct','assumption','assumption','model status', 'probation',NULL,1001381,'reader','2026-11-02T20:00:00Z',NULL);
`);

ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && rollback && /^-- BACKUP: bak_20261103_paper_projection_learnings$/m.test(sql), "migration is CI-applied, reversible, and backs up changed learning rows");
ok(/^-- CAUSE-MAPPED: .{10,}$/m.test(sql) && /^-- METRIC-EXEMPT: paper_model_projection_remediation_share_7d .{10,}$/m.test(sql), "metric cause and observational exemption are documented");

db.exec(body);
db.exec(body);
const statuses = db.prepare("SELECT id, fleet_status, status_note FROM paper_learnings ORDER BY id").all();
ok(statuses.filter((row) => row.fleet_status === "rejected").length === 3 && statuses[3].fleet_status === "applied", "recomputed but non-transferable claims are rejected and the labeling learning is applied", statuses);
ok(statuses.every((row) => row.status_note && /PAPER-LEARN|PL-TRIAGE/.test(row.status_note)), "each learning disposition records a reason and the applied path");
ok(db.prepare("SELECT COUNT(*) AS n FROM metric_registry").get().n === 2, "both requested measurement and omission guard register idempotently");
ok(db.prepare("SELECT COUNT(*) AS n FROM metric_breach_cause").get().n === 2, "both metrics map to the existing measurement cause");
const trigger = db.prepare("SELECT operator, threshold, enabled, action FROM analytics_metric_triggers WHERE metric_key = 'paper_unlabeled_model_projection_issues_7d'").get();
ok(trigger && trigger.operator === "gt" && trigger.threshold === 0 && trigger.enabled === 1 && /code-task: repo=qnfo-workers path=qnfo-lifecycle\/worker\.js/.test(trigger.action) && /code-anchor: async function plFileIssue\(env, p, strong\) \{/.test(trigger.action), "the zero-target omission trigger carries its implementation handoff", trigger);
ok(db.prepare("SELECT COUNT(*) AS n FROM decision_log WHERE action LIKE 'PAPER-LEARN-PROJECTIONS-1:%'").get().n === 1, "the decision and revert path are recorded once");

if (rollback) {
  db.exec(rollback);
  ok(db.prepare("SELECT COUNT(*) AS n FROM metric_registry").get().n === 0 && db.prepare("SELECT COUNT(*) AS n FROM analytics_metric_triggers").get().n === 0, "rollback removes only the new metrics and trigger");
  ok(db.prepare("SELECT id, fleet_status FROM paper_learnings ORDER BY id").all().every((row) => row.fleet_status === "probation"), "rollback restores all backed-up learning states");
}

console.log(passed + " passed, " + failed + " failed");
if (failed) process.exit(1);
