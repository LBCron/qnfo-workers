import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

// D1-INDEX-HOTSPOTS-1: the four correlated lookups use an index after the migration, and the detector counts the indexes.
const migration = readFileSync(new URL("./2026-11-04-d1-index-hotspots.sql", import.meta.url), "utf8");
assert.match(migration, /^-- APPLY-BY: ci$/m);
assert.match(migration, /^-- DB: qnfo-audit$/m);
assert.match(migration, /^-- Rollback: /m);

const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, description TEXT, priority TEXT, status TEXT, close_channel TEXT, updated_at INTEGER);
  CREATE INDEX idx_issues_status ON agent_issues(status, priority);
  CREATE UNIQUE INDEX idx_agent_issues_open_title ON agent_issues(title) WHERE status = 'open';
  CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT,
    max_attempts INTEGER, escalate_to TEXT, expected_cadence_h INTEGER, status TEXT, next_due_at TEXT, module TEXT, budget_ms INTEGER, max_items INTEGER,
    requires_container INTEGER, last_verdict TEXT);
  CREATE INDEX idx_rc_issue_status ON remediation_contracts(issue_id, status);
  CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE deployment_history (id INTEGER PRIMARY KEY AUTOINCREMENT, resource_type TEXT, resource_name TEXT, action TEXT, version_id TEXT, deployed_by TEXT,
    deployed_at TEXT DEFAULT (datetime('now')), status TEXT DEFAULT 'success', notes TEXT, _version INTEGER DEFAULT 1, wbs_code TEXT);
  CREATE TABLE projects (project_code TEXT PRIMARY KEY, program_code TEXT NOT NULL, name TEXT NOT NULL, description TEXT, status TEXT NOT NULL DEFAULT 'active',
    github_repo TEXT, pages_project TEXT, r2_prefix TEXT, created_at TEXT, updated_at TEXT, completed_at TEXT, source TEXT, owner_service TEXT, gh_milestone INTEGER);
  CREATE TABLE issue_triage (issue_id INTEGER PRIMARY KEY, rc TEXT NOT NULL, triage_state TEXT NOT NULL DEFAULT 'triaged', owner TEXT NOT NULL, sla_due_at TEXT NOT NULL,
    triaged_at TEXT, remediation TEXT, close_evidence TEXT, reopened_count INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE roadmap_implementation (id INTEGER PRIMARY KEY AUTOINCREMENT, item TEXT NOT NULL, source TEXT NOT NULL, title TEXT NOT NULL, artifact_type TEXT NOT NULL,
    artifact_ref TEXT, status TEXT NOT NULL, evidence TEXT, verified_at TEXT, created_at TEXT);
  CREATE TABLE worker_compat_state (worker TEXT NOT NULL, checked_at TEXT NOT NULL, live_date TEXT NOT NULL, toml_date TEXT, toml_reviewed TEXT, live_flags TEXT NOT NULL DEFAULT '',
    toml_flags TEXT NOT NULL DEFAULT '', nodejs_compat_live INTEGER NOT NULL DEFAULT 0, nodejs_compat_toml INTEGER NOT NULL DEFAULT 0, nodejs_compat_default_on INTEGER NOT NULL DEFAULT 0,
    flips_between TEXT NOT NULL DEFAULT '[]', flips_count INTEGER NOT NULL DEFAULT 0, days_behind INTEGER, advance TEXT, PRIMARY KEY (worker, checked_at));
  CREATE TABLE issue_map_stub (x INTEGER);
  CREATE TABLE issue_project_map (issue_id INTEGER PRIMARY KEY, project_code TEXT NOT NULL, program_code TEXT NOT NULL, kind TEXT NOT NULL, synced_milestone INTEGER,
    synced_labels TEXT, gh_node TEXT, gh_item TEXT, updated_at TEXT, synced_at TEXT);
  CREATE TABLE cf_agent_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, requester TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'run', prompt TEXT, code TEXT, cron TEXT,
    delay_s INTEGER, instance TEXT, priority TEXT NOT NULL DEFAULT 'medium', status TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0, run_id TEXT,
    result TEXT, error TEXT, created_at TEXT, started_at TEXT, finished_at TEXT);
  CREATE INDEX idx_cf_agent_requests_status ON cf_agent_requests (status, id);
  CREATE INDEX idx_cf_agent_requests_requester ON cf_agent_requests (requester, id);
  CREATE TABLE issue_probe_requests (issue_id INTEGER PRIMARY KEY, request_id INTEGER, requested_at TEXT, answered_at TEXT, verdict TEXT, probe TEXT, applied_at TEXT, note TEXT);
  CREATE VIEW v_issue_probe_intake AS SELECT a.id AS issue_id, a.priority, 'p' AS prompt FROM agent_issues a LEFT JOIN remediation_contracts c ON c.class = 'issue-' || a.id
    WHERE a.status = 'open' AND COALESCE(c.status, 'none') NOT IN ('active', 'monitoring', 'holding');
  CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT, root_cause TEXT, remediation TEXT, detector TEXT, probe_class TEXT, first_seen TEXT, issue_id INTEGER,
    trigger_condition TEXT, symptom TEXT, blast_radius TEXT);
  CREATE TABLE decision_log (actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT,
    predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
`);

// Data at the live sizes (2026-11-04): 5.4 K issues (4.7 K closed), 111 projects, a map entry per mapped issue, 3 K roadmap rows, 3 K deployments, 2.4 K agent requests.
const tx = (fn) => { db.exec("BEGIN"); fn(); db.exec("COMMIT"); };
tx(() => {
  const issue = db.prepare("INSERT INTO agent_issues (id, title, description, priority, status) VALUES (?, ?, '', 'medium', ?)");
  for (let i = 1; i <= 5400; i++) issue.run(i, "issue " + i, i % 9 === 0 ? "open" : "closed");
  for (let i = 1; i <= 8; i++) issue.run(6000 + i, "PORTFOLIO-UPGRADE-1: advance compat_date for w" + i, "open");
  const project = db.prepare("INSERT INTO projects (project_code, program_code, name, status, owner_service) VALUES (?, 'P', ?, 'active', ?)");
  for (let p = 1; p <= 111; p++) project.run("PRJ" + p, "n" + p, "svc" + (p % 100));
  const map = db.prepare("INSERT INTO issue_project_map (issue_id, project_code, program_code, kind) VALUES (?, ?, 'P', 'k')");
  for (let i = 1; i <= 4000; i++) map.run(i, "PRJ" + (1 + (i % 111)));
  const road = db.prepare("INSERT INTO roadmap_implementation (item, source, title, artifact_type, status) VALUES (?, 's', 't', 'a', ?)");
  for (let r = 1; r <= 3000; r++) road.run("UPG-w" + (r % 80), r % 3 ? "verified" : "planned");
  const compat = db.prepare("INSERT INTO worker_compat_state (worker, checked_at, live_date, days_behind) VALUES (?, ?, 'd', 3)");
  for (let w = 1; w <= 80; w++) for (let c = 0; c < 5; c++) compat.run("w" + w, "2026-11-0" + (1 + c) + " 00:00:00");
  const dep = db.prepare("INSERT INTO deployment_history (resource_type, resource_name, version_id, deployed_at) VALUES ('worker', ?, ?, ?)");
  // Unique timestamps: with ties ORDER BY deployed_at DESC LIMIT 1 may return either row (live: 3 tie groups, none with differing versions).
  for (let d = 1; d <= 3000; d++) dep.run("svc" + (d % 100), d % 7 ? "v" + d : null, new Date(Date.UTC(2026, 9, 1) + d * 60000).toISOString());
  const req = db.prepare("INSERT INTO cf_agent_requests (requester, instance, status) VALUES (?, ?, ?)");
  for (let r = 1; r <= 2400; r++) req.run(r % 12 ? "issue-probe-agent" : "other", "probe-issue-" + r, "done");
  const probe = db.prepare("INSERT INTO issue_probe_requests (issue_id, requested_at) VALUES (?, ?)");
  for (let i = 1; i <= 3000; i++) probe.run(i, "2026-10-01T00:00:00Z");
});

// The four statements as the fleet_tasks workflows run them (SELECT form where the step writes).
const STATEMENTS = {
  probe: `SELECT 'issue-probe-agent', 'run', v.prompt, 'probe-issue-' || v.issue_id, v.priority FROM v_issue_probe_intake v WHERE COALESCE((SELECT value FROM ops_config WHERE key = 'issue_probe_agent'), 'on') <> 'off' AND NOT EXISTS (SELECT 1 FROM issue_probe_requests q WHERE q.issue_id = v.issue_id AND q.requested_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-120 minutes')) AND NOT EXISTS (SELECT 1 FROM cf_agent_requests r WHERE r.requester = 'issue-probe-agent' AND r.instance = 'probe-issue-' || v.issue_id AND r.status IN ('queued', 'running')) ORDER BY CASE v.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END, v.issue_id LIMIT CAST(COALESCE((SELECT value FROM ops_config WHERE key = 'issue_probe_agent_per_hour'), '12') AS INTEGER)`,
  execute: `SELECT count(*) FROM projects WHERE status='active' AND EXISTS (SELECT 1 FROM issue_project_map m JOIN agent_issues a ON a.id=m.issue_id WHERE m.project_code=projects.project_code AND a.status IN ('closed','resolved')) AND NOT EXISTS (SELECT 1 FROM issue_project_map m JOIN agent_issues a ON a.id=m.issue_id WHERE m.project_code=projects.project_code AND a.status='open')`,
  deploy: `SELECT p.project_code, d.resource_name, COUNT(*), MIN(d.deployed_at), MAX(d.deployed_at), (SELECT d2.version_id FROM deployment_history d2 WHERE d2.resource_name = d.resource_name AND d2.version_id IS NOT NULL ORDER BY d2.deployed_at DESC LIMIT 1), COUNT(DISTINCT d.version_id), NULL, CAST(julianday('now') - julianday(MAX(d.deployed_at)) AS INTEGER) FROM projects p JOIN deployment_history d ON d.resource_name = p.owner_service WHERE true GROUP BY p.project_code, d.resource_name`,
  gap: `SELECT count(*) FROM agent_issues WHERE status='open' AND EXISTS (
  SELECT 1 FROM worker_compat_state w
  JOIN roadmap_implementation r ON r.item='UPG-'||w.worker AND r.status='verified'
  JOIN issue_triage t ON t.issue_id=agent_issues.id
  WHERE agent_issues.title='PORTFOLIO-UPGRADE-1: advance compat_date for '||w.worker
    AND w.checked_at=(SELECT MAX(w2.checked_at) FROM worker_compat_state w2 WHERE w2.worker=w.worker)
    AND typeof(w.days_behind) IN ('integer','real') AND w.days_behind>=0 AND w.days_behind<30
    AND datetime(w.checked_at) BETWEEN datetime('now','-120 minutes') AND datetime('now')
    AND t.close_evidence='PORTFOLIO-GAP-CLOSE-EVIDENCE-1: worker='||w.worker||' checked_at='||w.checked_at||
      ' live_date='||w.live_date||' days_behind='||w.days_behind||' roadmap='||r.item||' verified_at='||r.verified_at)
  AND NOT EXISTS (SELECT 1 FROM remediation_contracts c WHERE c.issue_id=agent_issues.id AND c.status IN ('active','holding')
    AND COALESCE(c.last_verdict,'') IN ('fail','vacuous-probe-result','probe-error','probe-not-machine-executable','probe-same-account-host'))`,
};
const plan = (sql) => db.prepare("EXPLAIN QUERY PLAN " + sql).all().map((r) => r.detail);
const results = (sql) => JSON.stringify(db.prepare(sql).all());

const before = Object.fromEntries(Object.entries(STATEMENTS).map(([k, s]) => [k, { plan: plan(s), rows: results(s) }]));
assert.ok(before.probe.plan.some((d) => /r USING INDEX idx_cf_agent_requests_requester \(requester=\?\)/.test(d)), "before: the requester index walks every row of the requester");
assert.ok(before.deploy.plan.some((d) => /SCAN d2/.test(d)), "before: the latest-version subquery scans deployment_history");
assert.ok(before.gap.plan.some((d) => /AUTOMATIC/.test(d)), "before: the gap-action EXISTS builds an automatic index");

db.exec(migration);

const after = Object.fromEntries(Object.entries(STATEMENTS).map(([k, s]) => [k, { plan: plan(s), rows: results(s) }]));
for (const k of Object.keys(STATEMENTS)) assert.equal(after[k].rows, before[k].rows, k + ": same rows before and after the indexes");
assert.ok(after.probe.plan.some((d) => /idx_cf_agent_requests_req_inst \(requester=\? AND instance=\? AND status=\?\)/.test(d)), "probe: " + after.probe.plan.join(" | "));
assert.ok(after.execute.plan.some((d) => /idx_ipm_project/.test(d)), "execute: " + after.execute.plan.join(" | "));
assert.ok(after.deploy.plan.some((d) => /idx_deploy_history_res/.test(d)) && !after.deploy.plan.some((d) => /SCAN d2/.test(d)), "deploy: " + after.deploy.plan.join(" | "));
assert.ok(after.gap.plan.some((d) => /idx_roadmap_impl_item_status/.test(d)) && !after.gap.plan.some((d) => /AUTOMATIC/.test(d)), "gap: " + after.gap.plan.join(" | "));

// Detector: four indexes present now; dropping one trips it.
const probe = db.prepare("SELECT verify_probe FROM remediation_contracts WHERE class = 'fm-d1-hotspot-index-missing'").get().verify_probe;
assert.deepEqual({ ...db.prepare(probe).get() }, { expected: "4", observed: "4" });
db.exec("DROP INDEX idx_ipm_project");
assert.equal(db.prepare(probe).get().observed, "3");
db.exec("CREATE INDEX idx_ipm_project ON issue_project_map (project_code, issue_id)");

// Replay is idempotent.
db.exec(migration);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 1);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM failure_modes").get().n, 1);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM remediation_contracts WHERE class = 'fm-d1-hotspot-index-missing'").get().n, 1);
db.close();
console.log("d1-index-hotspots: all passed");
