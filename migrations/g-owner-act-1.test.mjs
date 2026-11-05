// OWNER-ACT-REVIEW-1 offline suite (migrations/2026-11-05-g-owner-act-1.sql). Run: node migrations/g-owner-act-1.test.mjs
// Runs the migration against an in-memory SQLite shaped like the live tables it touches and checks: the new papers measure and its trigger and cause, the three unmapped
// breach metrics, the item probes of the three INTENT-TASK cards, the narrowed OPS doer probe, the re-armed issue-yield contract, the five supersessions (only while the
// surviving issue is open), the backups the Rollback reads, and that a second run changes nothing.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

let fail = 0;
const ok_ = (c, m, x) => { if (!c) { fail++; console.log("FAIL " + m + (x === undefined ? "" : " :: " + JSON.stringify(x))); } };
const sql = readFileSync(new URL("./2026-11-05-g-owner-act-1.sql", import.meta.url), "utf8");

const SCHEMA = `
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, status TEXT, close_channel TEXT);
CREATE TABLE issue_triage (issue_id INTEGER PRIMARY KEY, triage_state TEXT, close_evidence TEXT, remediation TEXT);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, verify_probe TEXT, verify_transport TEXT, status TEXT, last_verdict TEXT, attempts INTEGER, next_due_at TEXT);
CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, layer TEXT, kind TEXT, formula TEXT, source_of_truth TEXT, baseline TEXT, target TEXT, owner TEXT, disposition_actor TEXT, refresh_cadence TEXT, warning_band TEXT, kill_band TEXT, last_value TEXT, state TEXT, refresh_class TEXT);
CREATE TABLE analytics_metric_triggers (id INTEGER PRIMARY KEY AUTOINCREMENT, metric_key TEXT, title TEXT, source_table TEXT, operator TEXT, threshold REAL, priority INTEGER, action TEXT, owner TEXT, queue_target TEXT, cooldown_hours INTEGER, enabled INTEGER, notes TEXT);
CREATE TABLE metric_breach_cause (metric_key TEXT PRIMARY KEY, cause_key TEXT NOT NULL, note TEXT);
CREATE TABLE metric_improvement_now (trigger_id INTEGER PRIMARY KEY, metric_key TEXT, program_code TEXT, verdict TEXT, has_code_task INTEGER, open_issue_id INTEGER);
CREATE TABLE idea_proposals (id INTEGER PRIMARY KEY, status TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT, outcome_matched INTEGER);
`;
const CARDS = [1000778, 1000779, 1000780, 1000781, 1000802, 1000803, 1000812, 1000813, 1000814, 1000819, 1000822, 1000823, 1000824, 1001338, 1001343, 1001348];
function fresh(openSurvivors = true) {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  for (const id of CARDS) {
    db.prepare("INSERT INTO agent_issues VALUES (?, ?, 'open', NULL)").run(id, "card " + id);
    db.prepare("INSERT INTO issue_triage VALUES (?, 'triaged', NULL, NULL)").run(id);
  }
  for (const id of [100222, 100464, 1000979, 1798, 99939]) db.prepare("INSERT INTO agent_issues VALUES (?, ?, ?, NULL)").run(id, "survivor " + id, openSurvivors ? "open" : "closed");
  const c = db.prepare("INSERT INTO remediation_contracts VALUES (?, ?, 'OLD', 'd1-query', ?, ?, 7, NULL)");
  for (const id of [1000781, 1000802, 1000812, 1000814, 1000819, 1000824, 1001338, 1001343, 1001348]) c.run("issue-" + id, id, "active", "fail");
  c.run("issue-1000780", 1000780, "superseded", "superseded:probe-unusable (no machine-executable probe; the issue stays open and needs a real one)");
  db.prepare("UPDATE remediation_contracts SET verify_probe = 'WITH baseline AS (SELECT 1) SELECT 1' WHERE class = 'issue-1000780'").run();
  return db;
}
const probe = (db, cls) => { const p = db.prepare("SELECT verify_probe p FROM remediation_contracts WHERE class = ?").get(cls).p; return db.prepare(p).get(); };

const db = fresh();
db.exec(sql);
const st = (id) => db.prepare("SELECT a.status, a.close_channel, t.triage_state, t.close_evidence, t.remediation FROM agent_issues a JOIN issue_triage t ON t.issue_id = a.id WHERE a.id = ?").get(id);
const ct = (cls) => db.prepare("SELECT status, last_verdict, attempts, verify_probe FROM remediation_contracts WHERE class = ?").get(cls);

// papers measure, trigger and cause
const m = db.prepare("SELECT * FROM metric_registry WHERE metric = 'papers_per_100usd_7d'").get();
ok_(!!m && m.refresh_class === "runner" && m.state === "PENDING", "papers_per_100usd_7d is registered, pending its first value", m);
const trg = db.prepare("SELECT * FROM analytics_metric_triggers WHERE metric_key = 'papers_per_100usd_7d'").get();
ok_(!!trg && trg.operator === "lt" && trg.threshold === 10 && trg.queue_target === "agent_issues" && trg.enabled === 1, "a floor trigger files agent_issues", trg);
ok_(db.prepare("SELECT cause_key FROM metric_breach_cause WHERE metric_key = 'papers_per_100usd_7d'").get().cause_key === "publishing", "the new metric is mapped (METRIC-CAUSE-AT-REGISTRATION-1)");
const causes = new Set(["spend", "issue-backlog", "code-loop", "owner-routing", "publishing", "heartbeat", "structure", "measurement", "breach-doctor"]);
const mapped = db.prepare("SELECT metric_key, cause_key FROM metric_breach_cause WHERE note LIKE 'OWNER-ACT-REVIEW-1:%'").all();
ok_(mapped.length === 5 && mapped.every((r) => causes.has(r.cause_key)), "five mappings, each one of the fleet's nine causes", mapped);

// supersessions: contract first, triage closed with the survivor named
for (const [id, surv] of [[1000781, 100222], [1000802, 100464], [1000812, 1000979], [1000814, 1798], [1000819, 99939]]) {
  const s = st(id), c = ct("issue-" + id);
  ok_(c.status === "superseded" && c.last_verdict.endsWith("agent_issues " + surv), "contract of " + id + " is superseded by " + surv, c);
  ok_(s.triage_state === "closed" && s.close_evidence.startsWith("superseded by agent_issues " + surv + " "), "triage of " + id + " closes with the survivor named", s.close_evidence);
  ok_(s.close_channel === "session:G-owner-security", "close channel of " + id + " names the session");
}
// the cards that stay open carry a measured review, and their state is untouched
for (const id of [1000779, 1000780, 1000803, 1000813, 1000822, 1000823]) ok_(/OWNER-ACT review 2026-11-05/.test(st(id).remediation) && st(id).triage_state === "triaged", "review note on " + id);
// the issue-yield contract is armed again
ok_(ct("issue-1000780").status === "active" && ct("issue-1000780").last_verdict === null && ct("issue-1000780").attempts === 0, "1000780 contract is active again", ct("issue-1000780"));

// OPS probe: a breaching agent_issues-trigger metric with no doer is counted; unmeasured and loop-owned ones are not
db.exec(`INSERT INTO analytics_metric_triggers (id, metric_key, operator, threshold, queue_target) VALUES (16911, 'product_plus_rate_7d', 'lt', 0.5, 'qnfo-fleet-control'), (16414, 'youtube_avg_view_duration_s', 'lt', 10, 'agent_issues'), (4000, 'real_gap', 'gt', 0, 'agent_issues');
INSERT INTO metric_improvement_now VALUES (16911, 'product_plus_rate_7d', 'QNFO.OPS', 'breach-new', 0, NULL), (16414, 'youtube_avg_view_duration_s', 'QNFO.OPS', 'unmeasured', 0, NULL);`);
let p = probe(db, "issue-1000824");
ok_(p.expected === p.observed && p.observed === "0 off-target QNFO.OPS metrics without a doer", "loop-owned and unmeasured metrics are not a missing doer", p);
db.exec("INSERT INTO metric_improvement_now VALUES (4000, 'real_gap', 'QNFO.OPS', 'breach-worsening', 0, NULL)");
p = probe(db, "issue-1000824");
ok_(p.expected !== p.observed && /^1 off-target/.test(p.observed), "a breaching metric whose trigger files issues and has no doer is counted", p);
db.exec("UPDATE metric_improvement_now SET open_issue_id = 5 WHERE trigger_id = 4000");
p = probe(db, "issue-1000824");
ok_(p.expected === p.observed, "an open issue is a doer", p);

// INTENT-TASK probes read the proposal per item
for (const [id, prop] of [[1001338, 2564], [1001343, 2567], [1001348, 2568]]) {
  let r = probe(db, "issue-" + id);
  ok_(r.expected === "queued" && /^not queued: .*missing/.test(r.observed), id + ": no proposal row reads as not queued", r);
  db.prepare("INSERT OR REPLACE INTO idea_proposals VALUES (?, 'deferred_diversity')").run(prop);
  r = probe(db, "issue-" + id);
  ok_(r.expected === r.observed, id + ": a proposal held by the diversity cap is queued", r);
  db.prepare("UPDATE idea_proposals SET status = 'triaged_hold' WHERE id = ?").run(prop);
  r = probe(db, "issue-" + id);
  ok_(r.observed === "not queued: triaged_hold", id + ": a proposal the intake rejected is not queued", r);
}

// backups for the Rollback
ok_(db.prepare("SELECT COUNT(*) n FROM bak_20261105_g_owner_act WHERE kind = 'contract'").get().n === 10, "ten contracts are backed up");
ok_(db.prepare("SELECT COUNT(*) n FROM bak_20261105_g_owner_act WHERE kind = 'triage'").get().n === 11, "eleven triage rows are backed up");
ok_(db.prepare("SELECT verify_probe FROM bak_20261105_g_owner_act WHERE kind = 'contract' AND k = 'issue-1001338'").get().verify_probe === "OLD", "the old probe text is the backup");

// a second run changes nothing and writes no second decision
const before = JSON.stringify([db.prepare("SELECT * FROM decision_log").all().length, db.prepare("SELECT COUNT(*) n FROM analytics_metric_triggers").get().n, db.prepare("SELECT COUNT(*) n FROM bak_20261105_g_owner_act").get().n]);
db.exec(sql);
const after = JSON.stringify([db.prepare("SELECT * FROM decision_log").all().length, db.prepare("SELECT COUNT(*) n FROM analytics_metric_triggers").get().n, db.prepare("SELECT COUNT(*) n FROM bak_20261105_g_owner_act").get().n]);
ok_(before === after && before.startsWith("[1,"), "re-running writes no second decision, trigger or backup row", { before, after });

// a closed survivor blocks the supersession
const db2 = fresh(false);
db2.exec(sql);
for (const id of [1000781, 1000802, 1000812, 1000814, 1000819]) {
  const s = db2.prepare("SELECT t.triage_state, c.status FROM issue_triage t JOIN remediation_contracts c ON c.issue_id = t.issue_id WHERE t.issue_id = ?").get(id);
  ok_(s.triage_state === "triaged" && s.status === "active", id + " is not superseded while its survivor is closed", s);
}

ok_(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: /m.test(sql) && /^-- CAUSE-MAPPED: /m.test(sql), "migration header lines");
ok_(!/\bDELETE\s+FROM\b|\bDROP\b/i.test(sql.split("\n").filter((l) => !l.startsWith("--")).join("\n")), "the file body deletes and drops nothing");
console.log(fail ? fail + " failed" : "all passed");
process.exit(fail ? 1 : 0);
