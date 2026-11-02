// MANAGEMENT-PERSONAS-5 / QUALITY-IMPROVEMENT-AUDIT-1 offline suite: applies migrations/2026-10-26-management-personas.sql, -2, -3, -4 and -5 on
// SQLite with the shapes of the earlier suites plus metric_history and metric_breach_cause (read from qnfo-audit on 2026-10-26), and runs the
// new workflow steps the way fleet-exec does. Proves: each metric trigger gets its verdict against its value 7 days ago; the trend row, the three
// metrics and the per-program view read the audit; unmeasured non-BP26 metrics get one issue per owner with a closing probe, closed with evidence
// once measured; worse and flat breaches get one Cloudflare agent lever review each, a real answer is appended to the metric's issue and an
// only actionable lever proposals are reported (malformed answers are asked again); persona_actions = off stops the reviews; re-applies are no-ops.
// Run: node migrations/management-personas-5.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const rd = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const sqls = ["./2026-10-26-management-personas.sql", "./2026-10-26-management-personas-2.sql", "./2026-10-26-management-personas-3.sql"].map(rd);
const sql4 = rd("./2026-10-26-management-personas-4.sql"), sql5 = rd("./2026-10-26-management-personas-5.sql"), sql6 = rd("./2026-11-02-metric-lever-response-validation.sql");
const suite1 = rd("./management-personas.test.mjs");
const schema = suite1.slice(suite1.indexOf("db.exec(`") + 9, suite1.indexOf("`);", suite1.indexOf("db.exec(`")));
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d))); } };
const db = new DatabaseSync(":memory:");
db.exec(schema);
db.exec(`ALTER TABLE agent_issues ADD COLUMN close_channel TEXT;
ALTER TABLE remediation_contracts ADD COLUMN last_verdict TEXT;
ALTER TABLE remediation_contracts ADD COLUMN last_attempt_at TEXT;
CREATE TABLE issue_triage (issue_id INTEGER PRIMARY KEY, rc TEXT, triage_state TEXT, owner TEXT, sla_due_at TEXT, triaged_at TEXT, remediation TEXT, close_evidence TEXT, reopened_count INTEGER);
CREATE TABLE issue_lifecycle (id INTEGER PRIMARY KEY AUTOINCREMENT, issue_id INTEGER, event TEXT, from_status TEXT, to_status TEXT, has_evidence INTEGER, ts TEXT);
CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT NOT NULL, root_cause TEXT NOT NULL, remediation TEXT NOT NULL, detector TEXT NOT NULL, probe_class TEXT, first_seen TEXT NOT NULL, issue_id INTEGER, trigger_condition TEXT, symptom TEXT, blast_radius TEXT);
ALTER TABLE remediation_contracts ADD COLUMN precondition TEXT; ALTER TABLE remediation_contracts ADD COLUMN action TEXT; ALTER TABLE remediation_contracts ADD COLUMN verify_probe TEXT; ALTER TABLE remediation_contracts ADD COLUMN verify_transport TEXT; ALTER TABLE remediation_contracts ADD COLUMN max_attempts INTEGER; ALTER TABLE remediation_contracts ADD COLUMN escalate_to TEXT; ALTER TABLE remediation_contracts ADD COLUMN expected_cadence_h INTEGER;
CREATE VIEW v_output_quality_headline AS SELECT 6 AS better, 0 AS worse, 1 AS flat, 2 AS unmeasured, 'ask' AS gaps, 'improving_with_gaps' AS verdict;
CREATE TABLE cf_agent_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, requester TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'run', prompt TEXT, code TEXT, cron TEXT, delay_s INTEGER, instance TEXT, priority TEXT NOT NULL DEFAULT 'medium', status TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0, run_id TEXT, result TEXT, error TEXT, created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), started_at TEXT, finished_at TEXT);
CREATE TABLE metric_history (metric TEXT NOT NULL, day TEXT NOT NULL, value REAL, meets INTEGER, target TEXT, ts TEXT, PRIMARY KEY (metric, day));
CREATE TABLE metric_breach_cause (metric_key TEXT PRIMARY KEY, cause_key TEXT, note TEXT);
CREATE TABLE code_tasks (id TEXT PRIMARY KEY, repo TEXT, path TEXT, goal TEXT, status TEXT, step TEXT, attempts INTEGER, model TEXT, ctx TEXT, branch TEXT, pr_url TEXT, last_error TEXT, lease_until TEXT, created_at TEXT, updated_at TEXT, merged_by TEXT, merged_sha TEXT, merged_at TEXT, merge_state TEXT, merge_note TEXT);
CREATE TRIGGER issue_close_evidence_required BEFORE UPDATE OF status ON agent_issues WHEN NEW.status = 'closed' AND OLD.status = 'open' BEGIN
  SELECT RAISE(ABORT, 'close-without-evidence') WHERE COALESCE((SELECT close_evidence FROM issue_triage WHERE issue_id = NEW.id), '') = '';
END;`);
db.exec("INSERT INTO fleet_tasks (id, name, type, definition, version) VALUES ('portfolio-autopilot', 'ap', 'workflow', '{\"steps\":[]}', 1)");
for (const s of sqls) db.exec(s);
const run = (s, ...a) => db.prepare(s).run(...a);
const q = (s, ...a) => db.prepare(s).all(...a);
const one = (s, ...a) => db.prepare(s).get(...a);

db.exec(sql4);
const before = JSON.parse(one("SELECT definition FROM fleet_tasks WHERE id = 'management-personas'").definition).steps;
// a root-cause turn that returned no text, appended by the earlier step
run("INSERT INTO agent_issues (id, title, description, priority, status, source, created_at) VALUES (900, 'ROOT-CAUSE-1: X keeps recurring', 'text' || char(10) || char(10) || 'Root-cause diagnosis by the Cloudflare agent (cf_agent_requests #1, t): (the model returned no text)', 'critical', 'open', 'management-personas', 1)");
db.exec(sql5);
db.exec(sql6);
ok(true, "the five migrations apply");
const def = () => JSON.parse(one("SELECT definition FROM fleet_tasks WHERE id = 'management-personas'").definition).steps;
const names = def().map((s) => s.name);
const NEW = ["mi-clear", "mi-snapshot", "mi-trend", "mi-metric-metrics_worsening_7d", "mi-metric-metrics_unmeasured", "mi-metric-fleet_quality_change_7d", "mi-unmeasured-file", "mi-unmeasured-map", "mi-unmeasured-probe", "mi-unmeasured-close-evidence", "mi-unmeasured-close-log", "mi-unmeasured-close", "lever-request", "lever-log", "lever-report", "lever-mark", "brief-audit"];
ok(names.length === before.length + NEW.length && names.slice(-NEW.length).join() === NEW.join(), "seventeen audit steps are appended after the earlier ones", names.slice(-18));
const byName = (n) => def().find((s) => s.name === n).sql;
ok(/NOT LIKE '\(the model returned no text\)%'/.test(byName("rc-agent-report")) && /NOT LIKE '\(the model returned no text\)%'/.test(byName("rc-agent-mark")) && /NOT LIKE '\(the model returned no text\)%'/.test(byName("parked-report")), "earlier report steps skip empty agent answers");
ok(/root-cause-' \|\| a\.id AND COALESCE\(r\.result, ''\) NOT LIKE/.test(byName("rc-agent-request")), "an empty root-cause answer is asked again");
ok(/no answer yet; the managers ask again/.test(one("SELECT description FROM agent_issues WHERE id = 900").description), "an empty answer already appended is reworded");
db.exec(sql5.slice(0, sql5.lastIndexOf("\nINSERT INTO decision_log")));
ok(def().length === names.length && (byName("rc-agent-report").match(/the model returned no text/g) || []).length === 1, "a re-apply changes nothing");
ok(one("SELECT COUNT(*) AS n FROM analytics_metric_triggers WHERE metric_key IN ('metrics_worsening_7d', 'fleet_quality_change_7d')").n === 2 && one("SELECT COUNT(*) AS n FROM metric_registry WHERE metric IN ('metrics_worsening_7d', 'metrics_unmeasured', 'fleet_quality_change_7d')").n === 3, "three metrics and two triggers are registered once");

// metrics: one improving breach, one worsening, one flat, one new, one on target, two unmeasured (one BP26)
const day = (d) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
const trig = (key, op, thr, val, v7, owner, extra = {}) => {
  run("INSERT INTO metric_registry (metric, layer, kind, last_value, source_of_truth) VALUES (?, 'operational', 'target', ?, ?)", key, val === null ? null : String(val), extra.bp26 ? "x [BP26]" : "x");
  const tid = Number(run("INSERT INTO analytics_metric_triggers (metric_key, operator, threshold, owner, priority, action) VALUES (?, ?, ?, ?, ?, ?)", key, op, thr, owner, extra.pri || 3, extra.action || "lever text").lastInsertRowid);
  if (v7 !== null) run("INSERT INTO metric_history (metric, day, value) VALUES (?, ?, ?)", key, day(7), v7);
  if (extra.issue !== false && val !== null) run("INSERT INTO agent_issues (title, priority, status, source, created_at) VALUES (?, 'medium', 'open', 'qnfo-fleet-control', 1)", "METRIC-TRIGGER-" + tid + "-" + key.toUpperCase() + ": breach");
  return tid;
};
const tImp = trig("m_improving", "gt", 0, 3, 9, "svc-ops");
const tWorse = trig("m_worse", "lt", 50, 10, 30, "program-manager:QNFO.RSCH", { pri: 1 });
const tFlat = trig("m_flat", "gt", 0, 4, 4, "svc-ops", { action: "code-task: repo=qnfo-workers path=a/worker.js" });
const tNew = trig("m_new", "gt", 0, 2, null, "svc-ops");
trig("m_ok", "gt", 5, 1, 9, "svc-ops", { issue: false });
trig("m_none", "gt", 0, null, null, "svc-unmeasured");
trig("m_bp26", "gt", 0, null, null, "svc-bp", { bp26: true });
run("INSERT INTO service_program_map (service, program_code) VALUES ('svc-unmeasured', 'QNFO.OPS') ON CONFLICT DO NOTHING");
run("INSERT INTO metric_breach_cause (metric_key, cause_key) VALUES ('m_worse', 'publishing')");
run("INSERT INTO portfolio_allocations (tick, program_code, verdict, risk_score, decision, slots, manager_persona) VALUES ('2026-10-26T08:35Z', 'QNFO.OPS', 'RED', 50, 'steady', 5, 'program-manager:QNFO.OPS')");
run("INSERT INTO persona_briefs (tick, persona_key, level, scope, verdict, decision, summary) VALUES ('2026-10-26T08:35Z', 'portfolio-manager', 'portfolio', 'QNFO', 'RED', 'allocate', 'Brief.')");
const steps = def().filter((s) => NEW.includes(s.name));
const tick = () => { for (const s of steps) { try { db.prepare(s.sql).all(); } catch (e) { ok(false, "step " + s.name + " runs", String(e)); throw e; } } };
tick();
const v = (k) => one("SELECT * FROM metric_improvement_now WHERE metric_key = ?", k);
ok(v("m_improving").verdict === "breach-improving" && v("m_worse").verdict === "breach-worsening" && v("m_flat").verdict === "breach-flat" && v("m_new").verdict === "breach-new" && v("m_ok").verdict === "on-target" && v("m_none").verdict === "unmeasured", "each metric gets its verdict (lower is better for gt, higher for lt)", q("SELECT metric_key, verdict FROM metric_improvement_now"));
ok(v("m_worse").program_code === "QNFO.RSCH" && v("m_worse").cause_key === "publishing" && v("m_flat").has_code_task === 1 && v("m_worse").open_issue_id > 0 && v("m_bp26").bp26 === 1, "program, cause, code-task lever, open issue and BP26 flag are recorded", v("m_worse"));
const tr = one("SELECT * FROM metric_improvement_trend ORDER BY tick DESC LIMIT 1");
ok(tr.triggers === q("SELECT * FROM metric_improvement_now").length && tr.worsening === 1 && tr.flat === 1 && tr.improving === 1 && tr.unmeasured >= 2, "the hourly trend row counts the verdicts", tr);
const mv = (k) => one("SELECT last_value FROM metric_registry WHERE metric = ?", k).last_value;
ok(mv("metrics_worsening_7d") === "2" && Number(mv("metrics_unmeasured")) >= 2 && mv("fleet_quality_change_7d") === "0.0", "the three metrics are written", [mv("metrics_worsening_7d"), mv("metrics_unmeasured"), mv("fleet_quality_change_7d")]);
const um = q("SELECT id, title FROM agent_issues WHERE title LIKE 'METRIC-UNMEASURED-1:%' AND status = 'open'");
ok(um.length >= 1 && um.some((i) => i.title === "METRIC-UNMEASURED-1: svc-unmeasured has metrics with no value") && !um.some((i) => /svc-bp/.test(i.title)), "one issue per owner of an unmeasured non-BP26 metric", um);
const umId = um.find((i) => /svc-unmeasured/.test(i.title)).id;
run("INSERT OR IGNORE INTO remediation_contracts (class, issue_id, status) VALUES (?, ?, 'active')", "issue-" + umId, umId);
tick();
const pr = one("SELECT verify_probe FROM remediation_contracts WHERE class = ?", "issue-" + umId).verify_probe;
ok(/owner = 'svc-unmeasured'\) AS TEXT\) AS observed$/.test(pr) && one(pr.replace(/^SELECT '0' AS expected, /, "SELECT ")).observed === "1", "the issue gets a closing probe that reads the owner's unmeasured count", pr);
const reqs = q("SELECT instance, prompt FROM cf_agent_requests WHERE instance LIKE 'lever-%' ORDER BY id");
ok(reqs.length === 2 && reqs[0].instance.startsWith("lever-" + tWorse + "-") && reqs[1].instance.startsWith("lever-" + tFlat + "-") && /replaced, not repeated/.test(reqs[0].prompt) && /reads 10\.0 now and 30\.0 seven days ago/.test(reqs[0].prompt) && /ROOT CAUSE:/.test(reqs[0].prompt) && /CORRECTED TARGET:/.test(reqs[0].prompt), "worse and flat breaches get one structured lever review each, highest priority first", reqs.map((r) => r.instance));
ok(q("SELECT * FROM persona_actions WHERE kind = 'lever-review' AND to_value = 'requested'").length === 2, "each lever review is a persona_actions row");
tick();
ok(q("SELECT * FROM cf_agent_requests WHERE instance LIKE 'lever-%'").length === 2, "a second tick asks nothing twice");
const issueOf = (tid) => one("SELECT open_issue_id AS i FROM metric_improvement_now WHERE trigger_id = ?", tid).i;
run("UPDATE cf_agent_requests SET status = 'done', result = 'Now the lever steps and the lever-review history in persona_actions:' WHERE instance LIKE ?", "lever-" + tFlat + "-%");
run("UPDATE cf_agent_requests SET status = 'done', result = 'ROOT CAUSE: the producer stalls; code-task: repo=qnfo-workers path=b/worker.js; code-anchor: unique producer call; EDIT: repair the stalled producer.' WHERE instance LIKE ?", "lever-" + tWorse + "-%");
tick();
ok(/Lever review by the Cloudflare agent \(lever-\d+-\d+, the metric did not improve in 7 days\): ROOT CAUSE: the producer stalls/.test(one("SELECT description FROM agent_issues WHERE id = ?", issueOf(tWorse)).description || ""), "an actionable answer is appended to the metric's issue");
ok(!/Now the lever steps/.test(one("SELECT description FROM agent_issues WHERE id = ?", issueOf(tFlat)).description || ""), "non-actionable output is not appended");
ok(q("SELECT to_value FROM persona_actions WHERE kind = 'lever-review' ORDER BY id").map((r) => r.to_value).join() === "reported,empty", "the reviews are marked reported and empty");
tick();
ok(q("SELECT * FROM cf_agent_requests WHERE instance LIKE ?", "lever-" + tFlat + "-%").length === 2 && q("SELECT * FROM cf_agent_requests WHERE instance LIKE ?", "lever-" + tWorse + "-%").length === 1, "a malformed answer is asked again; an actionable one waits 3 days");
const leverProbe = one("SELECT verify_probe FROM remediation_contracts WHERE class = 'fm-metric-lever-nonactionable'").verify_probe;
ok(one(leverProbe.replace(/^SELECT '0' AS expected, /, "SELECT "),).observed === "0", "the detector probe finds no newly reported non-actionable lever");
ok(/Metric audit \(\d+ triggers\): \d+ on target, 1 breaches improving, 1 flat, 1 worse than 7 days ago, 1 new, \d+ unmeasured; quality 0\.0 points over 7 days\. Worst: m_worse\./.test(one("SELECT summary FROM persona_briefs WHERE persona_key = 'portfolio-manager'").summary), "the portfolio brief states the audit once", one("SELECT summary FROM persona_briefs WHERE persona_key = 'portfolio-manager'").summary);
run("UPDATE metric_registry SET last_value = '0' WHERE metric = 'm_none'");
tick();
ok(one("SELECT status FROM agent_issues WHERE id = ?", umId).status === "closed" && /holds a value/.test(one("SELECT close_evidence FROM issue_triage WHERE issue_id = ?", umId).close_evidence), "the unmeasured issue closes with evidence once its metrics hold values");
const p = one("SELECT * FROM v_metric_improvement_by_program WHERE program_code = 'QNFO.RSCH'");
ok(p && p.worsening === 1 && p.breaches_without_code_lever === 1, "the per-program view reads the audit", p);
run("INSERT INTO ops_config (key, value) VALUES ('persona_actions', 'off') ON CONFLICT(key) DO UPDATE SET value = 'off'");
run("UPDATE cf_agent_requests SET created_at = '2026-01-01T00:00:00Z' WHERE instance LIKE 'lever-%'");
tick();
ok(q("SELECT * FROM cf_agent_requests WHERE instance LIKE 'lever-%'").length === 3 && one("SELECT COUNT(*) AS n FROM metric_improvement_now").n > 0, "persona_actions = off stops the reviews, not the audit");
ok(/^-- APPLY-BY: ci$/m.test(sql5) && /^-- DB: qnfo-audit$/m.test(sql5) && /^-- BACKUP: bak_20261026_mp5_workflow$/m.test(sql5) && /^-- Rollback: /m.test(sql5), "the header opts in to the runner");
const afterLeverMigration = JSON.stringify(def());
db.exec(sql6);
ok(JSON.stringify(def()) === afterLeverMigration, "the response-validation migration is idempotent");
ok(/^-- APPLY-BY: ci$/m.test(sql6) && /^-- DB: qnfo-audit$/m.test(sql6) && /^-- BACKUP: bak_20261102_metric_lever_validation$/m.test(sql6) && /^-- Rollback: /m.test(sql6), "the response-validation migration opts in to the runner");
console.log("management-personas-5: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
