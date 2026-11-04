// LEVER-REPORT-IDEMPOTENT-1 offline suite: replays 2026-11-04-lever-report-idempotent.sql on a stub fleet_tasks that holds the live lever-report step text (read 2026-11-04 20:15Z
// from management-personas-c) and proves (1) the step gains its guard once, (2) a second apply changes nothing, (3) a task without the step is untouched, (4) the old step repeats the
// paragraph when lever-mark does not follow and the guarded step does not, (5) a healthy report -> mark sequence still reports the next pending request.
// Run: node migrations/lever-report-idempotent.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("./2026-11-04-lever-report-idempotent.sql", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d))); } };

const GOOD = String.raw`((COALESCE(r.result, '') LIKE '%code-task: repo=qnfo-workers path=%' AND COALESCE(r.result, '') LIKE '%code-anchor:%' AND COALESCE(r.result, '') LIKE '%EDIT:%') OR (COALESCE(r.result, '') LIKE '%CORRECTED TARGET:%' AND COALESCE(r.result, '') LIKE '%EVIDENCE:%'))`;
const PICK = String.raw`(SELECT MIN(p.id) FROM persona_actions p JOIN cf_agent_requests r ON r.instance = p.from_value WHERE p.kind = 'lever-review' AND p.to_value = 'requested' AND p.issue_id = agent_issues.id AND r.status IN ('done', 'failed', 'error') AND ${GOOD} AND COALESCE(r.result, r.error, '') <> '')`;
const FIRST = String.raw`(SELECT x.from_value FROM persona_actions x WHERE x.id = ${PICK})`;
// the live step text, assembled from the same fragments the live statement repeats
const LIVE = String.raw`UPDATE agent_issues SET description = COALESCE(description, '') || char(10) || char(10) || 'Lever review by the Cloudflare agent (' || ${FIRST} || ', the metric did not improve in 7 days): ' || substr((SELECT COALESCE(r.result, r.error, '') FROM cf_agent_requests r WHERE r.instance = ${FIRST} ORDER BY r.id DESC LIMIT 1), 1, 2000), updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000 WHERE status = 'open' AND ${PICK} IS NOT NULL`;

const MARK = String.raw`UPDATE persona_actions SET to_value = CASE WHEN EXISTS (SELECT 1 FROM cf_agent_requests r WHERE r.instance = persona_actions.from_value AND r.status IN ('done', 'failed', 'error') AND (COALESCE(r.result, '') LIKE '(the model returned no text)%' OR COALESCE(r.result, r.error, '') = '' OR NOT ${GOOD})) THEN 'empty' ELSE 'reported' END WHERE kind = 'lever-review' AND to_value = 'requested' AND (id IN (SELECT MIN(p.id) FROM persona_actions p JOIN cf_agent_requests r ON r.instance = p.from_value WHERE p.kind = 'lever-review' AND p.to_value = 'requested' AND r.status IN ('done', 'failed', 'error') AND COALESCE(r.result, '') NOT LIKE '(the model returned no text)%' AND COALESCE(r.result, r.error, '') <> '' GROUP BY p.issue_id) OR EXISTS (SELECT 1 FROM cf_agent_requests r WHERE r.instance = persona_actions.from_value AND r.status IN ('done', 'failed', 'error') AND (COALESCE(r.result, '') LIKE '(the model returned no text)%' OR COALESCE(r.result, r.error, '') = '' OR NOT ${GOOD})))`;

const OTHER = "SELECT 1";
const step = (name, s) => ({ type: "sql", name, db: "AUDIT", sql: s });

function build(withStepInMain = false) {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE fleet_tasks (id TEXT PRIMARY KEY, definition TEXT, version INTEGER DEFAULT 1, updated_at TEXT);
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, status TEXT, description TEXT, updated_at INTEGER);
CREATE TABLE persona_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, persona_key TEXT, kind TEXT, issue_id INTEGER, from_value TEXT, to_value TEXT, evidence TEXT);
CREATE TABLE cf_agent_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, requester TEXT, kind TEXT, prompt TEXT, instance TEXT, priority TEXT, status TEXT, result TEXT, error TEXT, created_at TEXT);
CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT, root_cause TEXT, remediation TEXT, detector TEXT, probe_class TEXT, first_seen TEXT, issue_id INTEGER, trigger_condition TEXT, symptom TEXT, blast_radius TEXT);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER, escalate_to TEXT, expected_cadence_h INTEGER, status TEXT, next_due_at TEXT, module TEXT, budget_ms INTEGER, max_items INTEGER, requires_container INTEGER);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT, outcome_matched INTEGER);`);
  const mk = (id, steps) => db.prepare("INSERT INTO fleet_tasks (id, definition) VALUES (?, ?)").run(id, JSON.stringify({ steps }));
  mk("management-personas", withStepInMain ? [step("lever-report", LIVE)] : [step("recur-clear", OTHER)]);
  mk("management-personas-c", [step("lever-request", OTHER), step("lever-log", OTHER), step("lever-report", LIVE), step("lever-mark", MARK), step("brief-audit", OTHER)]);
  return db;
}
const stepSql = (db, task, name) => JSON.parse(db.prepare("SELECT definition FROM fleet_tasks WHERE id = ?").get(task).definition).steps.find((s) => s.name === name)?.sql;
const version = (db, id) => db.prepare("SELECT version v FROM fleet_tasks WHERE id = ?").get(id).v;
const GUARD = "FROM persona_actions g WHERE g.kind = 'lever-review'";

// 1. the guard is added once, in the right task, and nothing else in the definition moves
let db = build();
const before = stepSql(db, "management-personas-c", "lever-report");
ok(before.includes(" WHERE status = 'open' AND (SELECT MIN(p.id) "), "fixture: the live step has the anchor the migration rewrites", before.slice(-200));
ok((before.match(/ WHERE status = 'open' AND \(SELECT MIN\(p\.id\) /g) || []).length === 1, "fixture: the anchor occurs exactly once");
db.exec(sql);
const after = stepSql(db, "management-personas-c", "lever-report");
ok(after.includes(GUARD) && (after.match(/FROM persona_actions g WHERE/g) || []).length === 1, "lever-report gains the guard exactly once");
ok(version(db, "management-personas-c") === 2, "management-personas-c is bumped once", version(db, "management-personas-c"));
ok(version(db, "management-personas") === 1 && stepSql(db, "management-personas", "recur-clear") === OTHER, "a task without the step keeps its version and steps");
const names = JSON.parse(db.prepare("SELECT definition FROM fleet_tasks WHERE id = 'management-personas-c'").get().definition).steps.map((s) => s.name);
ok(names.join() === "lever-request,lever-log,lever-report,lever-mark,brief-audit", "step order is unchanged", names);
ok(stepSql(db, "management-personas-c", "lever-mark") === MARK && stepSql(db, "management-personas-c", "lever-request") === OTHER, "the other steps are byte-identical");
ok(db.prepare("SELECT COUNT(*) c FROM failure_modes WHERE fm_key = 'lever-mark-stalled'").get().c === 1, "failure mode row written");
ok(db.prepare("SELECT COUNT(*) c FROM remediation_contracts WHERE class = 'fm-lever-mark-stalled' AND issue_id IS NULL AND verify_transport = 'd1-query'").get().c === 1, "detector contract written with no issue binding");
ok(db.prepare("SELECT COUNT(*) c FROM decision_log WHERE action LIKE 'LEVER-REPORT-IDEMPOTENT-1:%'").get().c === 1, "decision_log row written once");

// 2. a second apply changes nothing
const snap = () => JSON.stringify([db.prepare("SELECT id, definition, version FROM fleet_tasks ORDER BY id").all(), db.prepare("SELECT COUNT(*) c FROM decision_log").get().c, db.prepare("SELECT COUNT(*) c FROM failure_modes").get().c, db.prepare("SELECT COUNT(*) c FROM remediation_contracts").get().c]);
const s1 = snap();
db.exec(sql);
ok(s1 === snap(), "a second apply changes nothing (definitions, versions, rows)");

// 3. the step is rewritten in whichever task holds it, and both when both do
const both = build(true);
both.exec(sql);
ok(version(both, "management-personas") === 2 && stepSql(both, "management-personas", "lever-report").includes(GUARD), "a task that holds the step in management-personas is guarded too");

// 4/5. behaviour on stub data
const RESULT = "ROOT CAUSE: x; code-task: repo=qnfo-workers path=a/worker.js; code-anchor: foo; EDIT: bar";
function seed(d, instance, issue, status) {
  d.prepare("INSERT OR IGNORE INTO agent_issues (id, status, description, updated_at) VALUES (?, 'open', 'base', 0)").run(issue);
  d.prepare("INSERT INTO cf_agent_requests (requester, kind, prompt, instance, priority, status, result, created_at) VALUES ('program-manager:QNFO.OPS', 'run', 'p', ?, 'medium', ?, ?, '2026-11-04T05:37:00Z')").run(instance, status, status === "done" ? RESULT + " " + instance : null);
  d.prepare("INSERT INTO persona_actions (ts, persona_key, kind, issue_id, from_value, to_value, evidence) VALUES ('2026-11-04T05:37:08Z', 'program-manager:QNFO.OPS', 'lever-review', ?, ?, 'requested', 'e')").run(issue, instance);
}
const copies = (d, issue, instance) => { const t = d.prepare("SELECT description FROM agent_issues WHERE id = ?").get(issue).description; return t.split("Lever review by the Cloudflare agent (" + instance + ",").length - 1; };
const runStep = (d, task, name) => d.exec(stepSql(d, task, name));

const old = build();
seed(old, "lever-5394-202611040537", 1, "done");
for (let i = 0; i < 3; i++) runStep(old, "management-personas-c", "lever-report");
ok(copies(old, 1, "lever-5394-202611040537") === 3, "the unguarded step repeats the paragraph when lever-mark does not follow (the 2026-11-04 defect)", copies(old, 1, "lever-5394-202611040537"));

const g = build();
g.exec(sql);
seed(g, "lever-5394-202611040537", 1, "done");
for (let i = 0; i < 3; i++) runStep(g, "management-personas-c", "lever-report");
ok(copies(g, 1, "lever-5394-202611040537") === 1, "the guarded step reports once however many runs stall before lever-mark", copies(g, 1, "lever-5394-202611040537"));
ok(g.prepare("SELECT description FROM agent_issues WHERE id = 1").get().description.length < 2200, "the description does not grow with the stalled runs");

// healthy sequence: report, mark, then the next pending request of the same issue is reported on the next run
const h = build();
h.exec(sql);
seed(h, "lever-5394-202611040537", 1, "done");
seed(h, "lever-5394-202611041237", 1, "done");
runStep(h, "management-personas-c", "lever-report");
runStep(h, "management-personas-c", "lever-mark");
const states = () => h.prepare("SELECT from_value f, to_value t FROM persona_actions ORDER BY id").all().map((r) => r.f.slice(-4) + ":" + r.t).join();
ok(copies(h, 1, "lever-5394-202611040537") === 1 && copies(h, 1, "lever-5394-202611041237") === 0, "run 1 reports the lowest pending request only", states());
ok(states() === "0537:reported,1237:requested", "run 1 marks only the reported request", states());
runStep(h, "management-personas-c", "lever-report");
runStep(h, "management-personas-c", "lever-mark");
ok(copies(h, 1, "lever-5394-202611040537") === 1 && copies(h, 1, "lever-5394-202611041237") === 1, "run 2 reports the next request, the first is not repeated", states());
ok(states() === "0537:reported,1237:reported", "run 2 marks it", states());
runStep(h, "management-personas-c", "lever-report");
ok(copies(h, 1, "lever-5394-202611040537") === 1 && copies(h, 1, "lever-5394-202611041237") === 1, "run 3 adds nothing");

// a pending request whose answer is not ready yet is not reported, and a second issue is unaffected by the first
const m = build();
m.exec(sql);
seed(m, "lever-1-202611040537", 1, "queued");
seed(m, "lever-2-202611040537", 2, "done");
runStep(m, "management-personas-c", "lever-report");
ok(copies(m, 1, "lever-1-202611040537") === 0 && copies(m, 2, "lever-2-202611040537") === 1, "an unanswered request waits, another issue is reported");

// the detector: a finished request still 'requested' after 3 hours counts, a fresh one or an unfinished one does not
const probe = db.prepare("SELECT verify_probe p FROM remediation_contracts WHERE class = 'fm-lever-mark-stalled'").get().p;
const dd = build();
dd.exec(sql);
seed(dd, "lever-1-a", 1, "done");
seed(dd, "lever-2-a", 2, "queued");
dd.prepare("UPDATE persona_actions SET ts = strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-4 hours')").run();
let row = dd.prepare(probe).get();
ok(row.expected === "0" && row.observed === "1", "detector reads 1 for one finished request left requested for 4 hours", row);
dd.prepare("UPDATE persona_actions SET to_value = 'reported' WHERE from_value = 'lever-1-a'").run();
row = dd.prepare(probe).get();
ok(row.observed === "0", "detector reads 0 once it is marked", row);
dd.prepare("UPDATE persona_actions SET ts = strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-10 minutes'), to_value = 'requested' WHERE from_value = 'lever-1-a'").run();
ok(dd.prepare(probe).get().observed === "0", "detector ignores a request younger than 3 hours");

console.log("lever-report-idempotent: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
