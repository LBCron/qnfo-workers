// C4-FM-CLOSEOUT-1 offline suite for migrations/2026-11-04-c4-fm-roadmap-closeout.sql (roadmap_implementation 1754 FM-1, 1756 FM-3, 1758 FM-5; the FM-2 detector).
// Replays the migration on node:sqlite against rows shaped like the live ones read from qnfo-audit on 2026-11-04 (a description that CONTINUES after the placeholder line, which is why the
// cluster-e-c clean-up matched nothing; the live rc-agent-report and rc-agent-mark statements) and proves: the markup and the placeholder are removed and the two reports are re-armed and
// then append the clean answer; the hold audit agrees with the autoclose hold (held close, single post-reopen pass, three-reopen tier, kill switch, a verified_at moved by the dedupe,
// a close before the hold); each detector returns expected and observed; the dedupe follow-up carries a doer text and a measuring probe; rows 1755 and 1757 are not written and 1754 and 1758
// keep their status; a second apply changes nothing. State-independent: no assertion reads live qnfo-audit.
// Run: node --no-warnings migrations/c4-fm-roadmap-closeout.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const here = new URL("./", import.meta.url);
const sql = readFileSync(new URL("2026-11-04-c4-fm-roadmap-closeout.sql", here), "utf8").replace(/\r\n/g, "\n");
const body = sql.replace(/^--.*$/gm, "");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 500))); } };

ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: .+/m.test(sql) && /^-- BACKUP: bak_\w+$/m.test(sql), "migration headers present");
ok(!/\bDELETE\b/i.test(body), "no DELETE in the body");
ok(!sql.includes("__PR__"), "the PR number placeholder is replaced");
ok(!/\bcode-task:/.test(body), "no stored text carries the code-task marker with a colon (no parser may take the follow-up issues for tasks)");
ok(!/\bsession-task:/.test(sql), "no session-task line is filed (AUTONOMY-FIRST-1)");

// the live statements of fleet_tasks management-personas (read 2026-11-04, v34)
const RC_REPORT = "UPDATE agent_issues SET description = COALESCE(description, '') || char(10) || char(10) || 'Root-cause diagnosis by the Cloudflare agent (cf_agent_requests #' || (SELECT r.id FROM cf_agent_requests r WHERE r.instance = 'root-cause-' || agent_issues.id ORDER BY r.id DESC LIMIT 1) || ', ' || (SELECT r.finished_at FROM cf_agent_requests r WHERE r.instance = 'root-cause-' || agent_issues.id ORDER BY r.id DESC LIMIT 1) || '): ' || substr((SELECT COALESCE(r.result, r.error, '') FROM cf_agent_requests r WHERE r.instance = 'root-cause-' || agent_issues.id ORDER BY r.id DESC LIMIT 1), 1, 2000), updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000 WHERE status = 'open' AND title LIKE 'ROOT-CAUSE-1:%' AND id IN (SELECT p.issue_id FROM persona_actions p WHERE p.kind = 'agent-diagnose' AND p.to_value = 'requested') AND EXISTS (SELECT 1 FROM cf_agent_requests r WHERE r.instance = 'root-cause-' || agent_issues.id AND r.status IN ('done', 'failed', 'error') AND COALESCE(r.result, '') NOT LIKE '(the model returned no text)%' AND COALESCE(r.result, '') NOT LIKE '%tool_call%' AND COALESCE(r.result, '') NOT LIKE '%<invoke%' AND COALESCE(r.result, '') NOT LIKE '%<function_calls%' AND COALESCE(r.result, '') NOT LIKE '%DSML%')";
const RC_MARK = "UPDATE persona_actions SET to_value = 'reported' WHERE kind = 'agent-diagnose' AND to_value = 'requested' AND EXISTS (SELECT 1 FROM cf_agent_requests r WHERE r.instance = 'root-cause-' || persona_actions.issue_id AND r.status IN ('done', 'failed', 'error') AND COALESCE(r.result, '') NOT LIKE '(the model returned no text)%' AND COALESCE(r.result, '') NOT LIKE '%tool_call%' AND COALESCE(r.result, '') NOT LIKE '%<invoke%' AND COALESCE(r.result, '') NOT LIKE '%<function_calls%' AND COALESCE(r.result, '') NOT LIKE '%DSML%')";

const MARKUP_238 = '<|tool_calls_section_begin|><|tool_call_begin|>functions.repo_read_file:0<|tool_call_argument_begin|>{"path":"qnfo-fleet-control/worker.js"}<|tool_call_end|><|tool_calls_section_end|>';
const MARKUP_97 = '<|tool_calls_section_begin|><|tool_call_begin|>functions.fleet_sql:0<|tool_call_argument_begin|>{"sql":"SELECT 1"}<|tool_call_end|><|tool_calls_section_end|> and more text';
const MARKUP_58 = '<|tool_calls_section_begin|><|tool_call_begin|>functions.fleet_sql:0<|tool_call_argument_begin|>{"sql":"SELECT 2"}<|tool_call_end|>';
const PREFACE_118 = "I need to read the metric-trigger loop implementation and the alternate probe first. ";
const RESULT_118 = PREFACE_118 + "<|tool_calls_section_begin|><|tool_call_begin|>functions.repo_read_file:0<|tool_call_argument_begin|>{}<|tool_call_end|>";
const CLEAN_333 = "Known from qnfo-audit:\n\n- **Producer:** `qnfo-code-orchestrator` worker, function `fleet_tick`.";
const CLEAN_340 = "**Findings**\n\n- **Producer:** `qnfo-fleet-control/worker.js`, function `workflowFailureIntake`.";
// the born placeholder of contract_probe_templates_v3_generic
const placeholder = id => "SELECT 'closed' AS expected, (SELECT CASE WHEN status IN ('closed', 'resolved') THEN 'closed' ELSE NULL END FROM agent_issues WHERE id = " + id + ") AS observed";

const mk = () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, description TEXT, status TEXT, source TEXT, category TEXT, priority TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE cf_agent_requests (id INTEGER PRIMARY KEY, requester TEXT, instance TEXT, status TEXT DEFAULT 'done', result TEXT, error TEXT, finished_at TEXT);
CREATE TABLE persona_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, persona_key TEXT, kind TEXT, issue_id INTEGER, from_value TEXT, to_value TEXT, evidence TEXT);
CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE fleet_tasks (id TEXT PRIMARY KEY, definition TEXT);
CREATE TABLE fleet_tick (id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER, escalate_to TEXT, expected_cadence_h INTEGER, status TEXT, module TEXT, next_due_at TEXT, attempts INTEGER DEFAULT 0, last_verdict TEXT);
CREATE TABLE remediation_verifications (id INTEGER PRIMARY KEY AUTOINCREMENT, class TEXT, issue_id INTEGER, pass INTEGER, expected TEXT, observed TEXT, verified_at TEXT, transport TEXT);
CREATE TABLE issue_triage (issue_id INTEGER PRIMARY KEY, reopened_count INTEGER DEFAULT 0, close_evidence TEXT);
CREATE TABLE issue_lifecycle (id INTEGER PRIMARY KEY AUTOINCREMENT, issue_id INTEGER, event TEXT, ts TEXT);
CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT, root_cause TEXT, remediation TEXT, detector TEXT, probe_class TEXT, first_seen TEXT, issue_id INTEGER, trigger_condition TEXT, symptom TEXT, blast_radius TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, layer TEXT, kind TEXT, formula TEXT, source_of_truth TEXT, baseline TEXT, target TEXT, owner TEXT, disposition_actor TEXT, refresh_cadence TEXT, warning_band TEXT, kill_band TEXT, last_value TEXT, last_refreshed TEXT, state TEXT, refresh_class TEXT);
CREATE TABLE analytics_metric_triggers (id INTEGER PRIMARY KEY AUTOINCREMENT, metric_key TEXT UNIQUE, title TEXT, source_table TEXT, operator TEXT, threshold REAL, priority INTEGER DEFAULT 5, action TEXT, owner TEXT, queue_target TEXT, cooldown_hours INTEGER DEFAULT 168, enabled INTEGER DEFAULT 1, notes TEXT);
CREATE TABLE metric_breach_cause (metric_key TEXT PRIMARY KEY, cause_key TEXT NOT NULL, note TEXT);
CREATE TABLE roadmap_implementation (id INTEGER PRIMARY KEY, item TEXT, source TEXT, title TEXT, artifact_type TEXT, artifact_ref TEXT, status TEXT, evidence TEXT, verified_at TEXT);
INSERT INTO failure_modes (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id) VALUES
  ('diagnosis-raw-markup', 'a', 'b', 'c', 'issue-1000717 probe', 'd1-query', '2026-10-28', 1000717),
  ('diagnosis-unresolved-anchor', 'a', 'b', 'c', 'issue-1000718 probe', 'd1-query', '2026-10-28', 1000718),
  ('close-no-dwell', 'a', 'b', 'c', 'issue-1000719 probe', 'd1-query', '2026-10-28', 1000719);
-- ORPHAN-GUARD-BIRTH-1 and the generic template, reduced to what the migration depends on: every issue is born with a contract that the generic template makes a placeholder
CREATE TRIGGER birth_contract AFTER INSERT ON agent_issues BEGIN
  INSERT INTO remediation_contracts (class, issue_id, status, module, action, verify_probe, verify_transport)
  VALUES ('issue-' || NEW.id, NEW.id, 'active', 'probe-template-v3-generic', 'VACUOUS-PROBE-V3-1: no verdict while the issue is open',
          'SELECT ''closed'' AS expected, (SELECT CASE WHEN status IN (''closed'', ''resolved'') THEN ''closed'' ELSE NULL END FROM agent_issues WHERE id = ' || NEW.id || ') AS observed', 'd1-query');
END;
`);
  return db;
};

const db = mk();
const ISS = db.prepare("INSERT INTO agent_issues (id, title, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0)");
const REQ = db.prepare("INSERT INTO cf_agent_requests (id, requester, instance, status, result, finished_at) VALUES (?, 'program-manager:QNFO.OPS', ?, 'done', ?, ?)");
const PA = db.prepare("INSERT INTO persona_actions (ts, persona_key, kind, issue_id, to_value, evidence) VALUES ('2026-10-26T07:36:56Z', 'program-manager:QNFO.OPS', 'agent-diagnose', ?, ?, 'cf_agent_requests')");
const hdr = (id, fin, res) => "\n\nRoot-cause diagnosis by the Cloudflare agent (cf_agent_requests #" + id + ", " + fin + "): " + res;

// 1000301 and 1000302: placeholder then a clean answer (the first version of the report step); 1000303: placeholder, then more text, clean answer never appended
ISS.run(1000301, "ROOT-CAUSE-1: CF-OBS-ISSUE-1 keeps recurring", "family text" + hdr(3, "2026-10-26T07:50:59Z", "no answer yet; the managers ask again") + hdr(30, "2026-10-26T09:46:02Z", "I searched qnfo-audit: a clean answer."), "open");
ISS.run(1000302, "ROOT-CAUSE-1: FLEET-JOURNEY-FAILED-1 keeps recurring", "family text" + hdr(4, "2026-10-26T07:46:00Z", "no answer yet; the managers ask again") + hdr(31, "2026-10-26T09:46:03Z", "**Findings** clean"), "open");
ISS.run(1000303, "ROOT-CAUSE-1: LOOP-BREAKER-1 keeps recurring", "family text" + hdr(5, "2026-10-26T07:46:00Z", "no answer yet; the managers ask again") + "\n\nCLUSTER-F-A 2026-10-28 (state): last member 1000700.\nRED-GATE-1: escalated to critical.", "open");
// markup stored as the diagnosis (closed 1000306, 1000309, 1000310; open 1000558, which also continues after it)
ISS.run(1000306, "ROOT-CAUSE-1: METRIC-TRIGGER-5182 keeps recurring", "family text" + hdr(118, "2026-10-26T13:46:01Z", RESULT_118) + "\n\nlater note", "closed");
ISS.run(1000309, "ROOT-CAUSE-1: METRIC-TRIGGER-8888 keeps recurring", "family text" + hdr(97, "2026-10-26T12:51:02Z", MARKUP_97) + "\n\nlater note", "closed");
ISS.run(1000310, "ROOT-CAUSE-1: PORTFOLIO-GAP keeps recurring", "family text" + hdr(58, "2026-10-26T10:56:01Z", MARKUP_58), "closed");
ISS.run(1000558, "ROOT-CAUSE-1: WORKFLOW-FAILED-1 keeps recurring", "family text" + hdr(238, "2026-10-27T02:51:00Z", MARKUP_238) + "\n\nRED-GATE-1: escalated to critical.", "open");
// a new clean ROOT-CAUSE-1 issue that is fine
ISS.run(1001800, "ROOT-CAUSE-1: NEW-FAMILY keeps recurring", "family text" + hdr(400, "2026-11-04T10:00:00Z", "clean answer"), "open");
for (const [id, inst, res, fin] of [
  [3, "root-cause-1000301", "(the model returned no text)", "2026-10-26T07:50:59Z"], [30, "root-cause-1000301", "I searched qnfo-audit: a clean answer.", "2026-10-26T09:46:02Z"],
  [4, "root-cause-1000302", "(the model returned no text)", "2026-10-26T07:46:00Z"], [31, "root-cause-1000302", "**Findings** clean", "2026-10-26T09:46:03Z"],
  [5, "root-cause-1000303", "(the model returned no text)", "2026-10-26T07:46:00Z"], [333, "root-cause-1000303", CLEAN_333, "2026-10-28T20:51:00Z"],
  [118, "root-cause-1000306", RESULT_118, "2026-10-26T13:46:01Z"], [97, "root-cause-1000309", MARKUP_97, "2026-10-26T12:51:02Z"], [58, "root-cause-1000310", MARKUP_58, "2026-10-26T10:56:01Z"],
  [232, "root-cause-1000558", "(the model returned no text)", "2026-10-27T01:46:00Z"], [238, "root-cause-1000558", MARKUP_238, "2026-10-27T02:51:00Z"], [340, "root-cause-1000558", CLEAN_340, "2026-10-28T21:51:00Z"],
  [400, "root-cause-1001800", "clean answer", "2026-11-04T10:00:00Z"],
]) REQ.run(id, inst, res, fin);
for (const iss of [1000301, 1000302, 1000303, 1000558, 1000306, 1001800]) PA.run(iss, "reported");

db.prepare("INSERT INTO fleet_tasks (id, definition) VALUES ('management-personas', ?)").run(JSON.stringify({ steps: [{ name: "rc-agent-request", sql: "... only after you have read the file and confirmed that the code-anchor text occurs exactly once in it; when the gate or writer is a D1 trigger, view, migration or fleet_tasks step, say so ..." }] }));

const probeOf = cls => db.prepare("SELECT verify_probe p FROM remediation_contracts WHERE class = ?").get(cls).p;
const read = (cls, d = db) => { const r = d.prepare(d.prepare("SELECT verify_probe p FROM remediation_contracts WHERE class = ?").get(cls).p).get(); return [String(r.expected), String(r.observed)]; };
const desc = id => db.prepare("SELECT description d FROM agent_issues WHERE id = ?").get(id).d;

// FM-3 world (times relative to now, after the hold's start on 2026-11-04T17:06:10Z): the autoclose trigger is not replayed, only the rows it leaves behind
const T = min => db.prepare("SELECT datetime('now', ?) t").get((-min) + " minutes").t;
const TZ = min => T(min).replace(" ", "T") + "Z";
const VER = db.prepare("INSERT INTO remediation_verifications (class, issue_id, pass, expected, observed, verified_at, transport) VALUES (?, ?, ?, ?, ?, ?, 'd1-query')");
const LC = db.prepare("INSERT INTO issue_lifecycle (issue_id, event, ts) VALUES (?, ?, ?)");
const lastId = () => db.prepare("SELECT MAX(id) m FROM remediation_verifications").get().m;
const closeAt = (issue, vid, atText) => db.prepare("INSERT INTO issue_triage (issue_id, reopened_count, close_evidence) VALUES (?, 0, ?) ON CONFLICT(issue_id) DO UPDATE SET close_evidence = excluded.close_evidence")
  .run(issue, "remediation_verifications#" + vid + " pass=1 class=issue-" + issue + " transport=d1-query verified_at=" + atText);
const closeOn = (issue, atMin, movedToMin) => {
  const vid = lastId();
  closeAt(issue, vid, T(atMin));
  if (movedToMin !== undefined) db.prepare("UPDATE remediation_verifications SET verified_at = ? WHERE id = ?").run(T(movedToMin), vid);
};
const mkIssue = (id, reopens) => { ISS.run(id, "X-1: audit case " + id, "d", "closed"); for (const m of reopens) LC.run(id, "reopened", TZ(m)); };
// A: one reopen 300 min ago, passes 100 minutes apart: held
mkIssue(2001, [300]);   VER.run("issue-2001", 2001, 1, "0", "0", T(250)); VER.run("issue-2001", 2001, 1, "0", "0", T(150)); closeOn(2001, 150);
// B: one reopen 200 min ago, the only pass since is the closing pass, an older pass from before the reopen exists
mkIssue(2002, [200]);   VER.run("issue-2002", 2002, 1, "0", "0", T(400)); VER.run("issue-2002", 2002, 1, "0", "0", T(100)); closeOn(2002, 100);
// C: three reopens; passes 100 minutes apart (hold 120) violate, 130 apart hold
mkIssue(2003, [600, 500, 400]); VER.run("issue-2003", 2003, 1, "0", "0", T(300)); VER.run("issue-2003", 2003, 1, "0", "0", T(200)); closeOn(2003, 200);
mkIssue(2004, [600, 500, 400]); VER.run("issue-2004", 2004, 1, "0", "0", T(330)); VER.run("issue-2004", 2004, 1, "0", "0", T(200)); closeOn(2004, 200);
// D: never reopened, one pass closes it (hold 0)
mkIssue(2005, []);      VER.run("issue-2005", 2005, 1, "0", "0", T(90)); closeOn(2005, 90);
// E: the previous row is a measured failure, then one pass (violates the 60 minute hold)
mkIssue(2006, [300]);   VER.run("issue-2006", 2006, 1, "0", "0", T(280)); VER.run("issue-2006", 2006, 0, "0", "3", T(120)); VER.run("issue-2006", 2006, 1, "0", "0", T(60)); closeOn(2006, 60);
// F: three reopens, passes 80 minutes apart (hold 120: violation); the closing row was touched later by the dedupe (verified_at moved to 10 minutes ago), which would make the span 190 and hide it
mkIssue(2007, [600, 500, 400]); VER.run("issue-2007", 2007, 1, "0", "0", T(200)); VER.run("issue-2007", 2007, 1, "0", "0", T(120)); closeOn(2007, 120, 10);
// G: a close before the hold existed (2026-11-04T17:06:10Z) is not judged
mkIssue(2008, [600]);   VER.run("issue-2008", 2008, 1, "0", "0", "2026-11-04 15:00:00"); closeAt(2008, lastId(), "2026-11-04 17:00:00");

db.exec(sql);

// ---- FM-1
for (const id of [1000306, 1000309, 1000310, 1000558]) ok(!desc(id).includes("<|tool_call"), "markup removed from " + id);
ok(desc(1000306).includes(PREFACE_118.trim()) && desc(1000306).includes("later note") && desc(1000306).includes("[raw tool-call markup removed (FM-1): cf_agent_requests #118"), "1000306 keeps the preface of the answer and the text after it", desc(1000306));
ok(desc(1000309).includes("later note") && desc(1000558).includes("RED-GATE-1: escalated to critical."), "text after the removed markup is kept");
for (const id of [1000301, 1000302, 1000303]) ok(!desc(id).includes("no answer yet; the managers ask again") && desc(id).includes("(that request returned no text; a later request answers)"), "placeholder rewritten on " + id);
ok(desc(1000301).includes("I searched qnfo-audit: a clean answer.") && desc(1000302).includes("**Findings** clean"), "clean answers already appended stay");
ok(desc(1001800) === "family text" + hdr(400, "2026-11-04T10:00:00Z", "clean answer"), "an untouched clean issue is byte for byte unchanged");
const pa = id => db.prepare("SELECT to_value v FROM persona_actions WHERE issue_id = ?").get(id).v;
ok(pa(1000303) === "requested" && pa(1000558) === "requested", "the two open issues with an unappended clean answer are re-armed", [pa(1000303), pa(1000558)]);
ok(pa(1000301) === "reported" && pa(1000302) === "reported" && pa(1000306) === "reported" && pa(1001800) === "reported", "no other persona row moves");
{
  const before = read("fm-diagnosis-raw-markup");
  ok(before[0] === "0" && before[1] === "2", "right after the migration the detector still counts the two unappended answers (it is first due after the hourly run)", before);
  db.exec(RC_REPORT); db.exec(RC_MARK);
  ok(desc(1000303).includes("(cf_agent_requests #333,") && desc(1000303).includes("Known from qnfo-audit"), "the live report step appends the clean latest answer to 1000303");
  ok(desc(1000558).includes("(cf_agent_requests #340,") && desc(1000558).includes("**Findings**"), "the live report step appends the clean latest answer to 1000558");
  ok(!desc(1000558).includes("<|tool_call") && !desc(1000303).includes("<|tool_call"), "and no markup comes back");
  ok(pa(1000303) === "reported" && pa(1000558) === "reported", "the live mark step sets them back to reported");
  const d = read("fm-diagnosis-raw-markup");
  ok(d[0] === "0" && d[1] === "0", "detector fm-diagnosis-raw-markup reads 0 after the report ran", d);
}
{
  // the detector sees both defects on a pre-fix database
  const pre = mk();
  pre.exec("DROP TRIGGER birth_contract");
  pre.prepare("INSERT INTO agent_issues (id, title, description, status) VALUES (1000558, 'ROOT-CAUSE-1: W', ?, 'open')").run("t" + hdr(238, "2026-10-27T02:51:00Z", MARKUP_238));
  pre.prepare("INSERT INTO agent_issues (id, title, description, status) VALUES (1000303, 'ROOT-CAUSE-1: L', 'no clean answer in here', 'open')").run();
  pre.prepare("INSERT INTO cf_agent_requests (id, requester, instance, status, result, finished_at) VALUES (333, 'p', 'root-cause-1000303', 'done', ?, '2026-10-28T20:51:00Z')").run(CLEAN_333);
  pre.prepare("INSERT INTO cf_agent_requests (id, requester, instance, status, result, finished_at) VALUES (238, 'p', 'root-cause-1000558', 'done', ?, '2026-10-27T02:51:00Z')").run(MARKUP_238);
  const probe = probeOf("fm-diagnosis-raw-markup");
  const r = pre.prepare(probe).get();
  ok(String(r.observed) === "2", "the detector counts one markup description and one unappended clean answer on a pre-fix database", r);
  pre.prepare("INSERT INTO cf_agent_requests (id, requester, instance, status, result, finished_at) VALUES (999, 'p', 'root-cause-1000303', 'done', 'fresh clean', strftime('%Y-%m-%dT%H:%M:%SZ','now','-10 minutes'))").run();
  ok(String(pre.prepare(probe).get().observed) === "1", "a clean answer younger than 3 hours is not counted yet (the hourly report step has not run)");
}
ok(db.prepare("SELECT next_due_at > datetime('now', '+60 minutes') ok FROM remediation_contracts WHERE class = 'fm-diagnosis-raw-markup'").get().ok === 1, "the markup detector is first due after the next hourly management-personas run");

// ---- FM-2
{
  const r = read("fm-diagnosis-anchor-rule");
  ok(r[0] === "1" && r[1] === "1", "fm-diagnosis-anchor-rule reads the live prompt rule", r);
  db.prepare("UPDATE fleet_tasks SET definition = replace(definition, 'occurs exactly once in it', 'occurs somewhere') WHERE id = 'management-personas'").run();
  ok(read("fm-diagnosis-anchor-rule")[1] === "0", "and reads 0 when a later migration drops the rule");
  db.prepare("UPDATE fleet_tasks SET definition = replace(definition, 'occurs somewhere', 'occurs exactly once in it') WHERE id = 'management-personas'").run();
}

// ---- FM-3
{
  const a = Object.fromEntries(db.prepare("SELECT issue_id i, hold_min h, prev_pass pp, span_min s, violated v FROM v_close_hold_audit").all().map(r => [r.i, r]));
  ok(a[2001] && a[2001].h === 60 && a[2001].v === 0 && Math.abs(a[2001].s - 100) < 0.2, "A: one reopen, passes 100 minutes apart: held", a[2001]);
  ok(a[2002] && a[2002].h === 60 && a[2002].v === 1 && a[2002].s === null, "B: the only pass since the reopen is the closing pass: violation", a[2002]);
  ok(a[2003] && a[2003].h === 120 && a[2003].v === 1 && Math.abs(a[2003].s - 100) < 0.2, "C1: three reopens, passes 100 minutes apart: violation of the 120 minute hold", a[2003]);
  ok(a[2004] && a[2004].h === 120 && a[2004].v === 0 && Math.abs(a[2004].s - 130) < 0.2, "C2: three reopens, passes 130 minutes apart: held", a[2004]);
  ok(a[2005] && a[2005].h === 0 && a[2005].v === 0, "D: never reopened, hold 0: not a violation", a[2005]);
  ok(a[2006] && a[2006].pp === 0 && a[2006].v === 1 && a[2006].s === null, "E: a measured failure before the closing pass resets the span: violation", a[2006]);
  ok(a[2007] && a[2007].v === 1 && Math.abs(a[2007].s - 80) < 0.2, "F: a verified_at moved by the dedupe does not hide the violation (the close time is the one in close_evidence)", a[2007]);
  ok(!a[2008], "G: a close before the hold is not judged");
  const d = read("fm-close-hold-violated");
  ok(d[0] === "0" && d[1] === "4", "the detector counts the violations of the last 24 hours (B, C1, E, F)", d);
  db.prepare("INSERT INTO ops_config VALUES ('relapse_close_hold', 'off')").run();
  ok(read("fm-close-hold-violated")[1] === "0" && db.prepare("SELECT MAX(hold_min) m FROM v_close_hold_audit").get().m === 0, "ops_config relapse_close_hold = off turns every hold to 0, as in v_issue_close_hold");
  db.prepare("DELETE FROM ops_config WHERE key = 'relapse_close_hold'").run();
}

// ---- FM-5
{
  const fm5 = db.prepare("SELECT title, description, priority, category FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.OPS #fm5-issueless-dedupe:%'").get();
  ok(fm5 && fm5.category === "cost" && fm5.description.includes("Doer:") && fm5.description.includes("runtime_verified_share_24h"), "the issue-less dedupe issue names a doer and the guard it must not move", fm5 && fm5.title);
  const row = db.prepare("SELECT class, status, precondition, last_verdict FROM remediation_contracts WHERE class = 'issue-' || (SELECT id FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.OPS #fm5-issueless-dedupe:%')").get();
  ok(row && row.status === "active" && /FM-5/.test(row.precondition) && row.last_verdict === null, "its birth contract holds a measuring probe instead of the placeholder", row);
  const rd = read(row.class);
  ok(rd[0] === "1" && rd[1] === "1", "the probe passes while few issue-less rows are written", rd);
  const ins = db.prepare("INSERT INTO remediation_verifications (class, issue_id, pass, expected, observed, verified_at, transport) VALUES (?, NULL, 1, '0', '0', datetime('now'), 'd1-query')");
  for (let i = 0; i < 1000; i++) ins.run("fm-x-" + (i % 50));
  ok(read(row.class)[1] === "0", "and fails with 1000 issue-less rows in the last 3 hours among the last 3000 ids", read(row.class));
  const vol = read("fm-verification-row-volume");
  ok(vol[0] === "1" && vol[1] === "1", "fm-verification-row-volume passes below 24000 rows a day", vol);
}

// ---- failure modes
{
  const fm = Object.fromEntries(db.prepare("SELECT fm_key k, probe_class p FROM failure_modes").all().map(r => [r.k, r.p]));
  ok(fm["diagnosis-raw-markup"] === "fm-diagnosis-raw-markup" && fm["diagnosis-unresolved-anchor"] === "fm-diagnosis-anchor-rule" && fm["close-no-dwell"] === "fm-close-hold-violated" && fm["verification-row-volume"] === "fm-verification-row-volume", "every failure mode names a probe_class that is a detector contract", fm);
  for (const p of Object.values(fm)) ok(db.prepare("SELECT COUNT(*) n FROM remediation_contracts WHERE class = ?").get(p).n === 1, "detector contract exists: " + p);
}

// ---- roadmap rows and idempotence, on a database that holds the five rows as production does (1754, 1755, 1758 verified by other sessions, 1757 built by PR 7357, 1756 planned)
{
  const db2 = mk();
  const s2 = db2.prepare("INSERT INTO roadmap_implementation (id, item, source, title, artifact_type, artifact_ref, status, evidence, verified_at) VALUES (?, ?, 'failure-modes-2026', 't', 'script', 'qnfo-fleet-control/worker.js', ?, ?, ?)");
  const seedRows = { 1754: ["FM-1", "verified", "FM-1 live 2026-11-04: the closing probe of issue-1000717 read 0 of 0.", "2026-11-04 23:38:50"], 1755: ["FM-2", "verified", "FM-2 live 2026-11-04: the prompt requires the anchor.", "2026-11-04 23:38:51"],
    1756: ["FM-3", "planned", "issue_triage reopened_count >= 5 grouped by family", null], 1757: ["FM-4", "built", "VACUOUS-MARKER-REAL-PROBE-1 (PR 7357)", null], 1758: ["FM-5", "verified", "FM-5 live 2026-11-04 22:40Z: 18960 rows.", "2026-11-04 23:38:51"] };
  for (const [id, r] of Object.entries(seedRows)) s2.run(Number(id), r[0], r[1], r[2], r[3]);
  db2.exec(sql);
  const rows = Object.fromEntries(db2.prepare("SELECT item i, status s, evidence e, artifact_ref a, verified_at v FROM roadmap_implementation").all().map(r => [r.i, r]));
  ok(rows["FM-1"].s === "verified" && rows["FM-1"].v === "2026-11-04 23:38:50" && rows["FM-1"].e.startsWith(seedRows[1754][2]) && rows["FM-1"].e.includes("C4-FM-CLOSEOUT-1 correction"), "FM-1 keeps its status and gets the correction appended", rows["FM-1"].e);
  ok(rows["FM-2"].e === seedRows[1755][2] && rows["FM-2"].s === "verified" && rows["FM-4"].e === seedRows[1757][2] && rows["FM-4"].s === "built", "rows 1755 and 1757 are not written");
  ok(rows["FM-3"].s === "implemented" && /RELAPSE-HOLD-1/.test(rows["FM-3"].e) && /62\.7/.test(rows["FM-3"].e) && /10 closes/.test(rows["FM-3"].e) && rows["FM-3"].e.length > 400, "FM-3 is implemented with the ten reads", rows["FM-3"].e.slice(0, 200));
  ok(rows["FM-5"].s === "verified" && rows["FM-5"].e.startsWith(seedRows[1758][2]) && /fm5-issueless-dedupe/.test(rows["FM-5"].e) && /fm-verification-row-volume/.test(rows["FM-5"].e), "FM-5 keeps its status and gets the remainder appended");
  ok(rows["FM-3"].v === null, "no row is stamped verified by the migration");
  ok(/PR \d+/.test(rows["FM-1"].e) && /PR \d+/.test(rows["FM-3"].e) && /PR \d+/.test(rows["FM-5"].e), "the appended text names the PR");
  ok(db2.prepare("SELECT COUNT(*) n FROM bak_20261104_c4_fm WHERE kind = 'roadmap'").get().n === 3, "the old row values are backed up");
  const cnt = d => ["decision_log", "agent_issues", "remediation_contracts", "failure_modes", "bak_20261104_c4_fm"].map(t => d.prepare("SELECT COUNT(*) n FROM " + t).get().n).join(",");
  const before = cnt(db2);
  const ev = db2.prepare("SELECT evidence e FROM roadmap_implementation WHERE id IN (1754, 1758) ORDER BY id").all().map(r => r.e).join("|");
  db2.exec(sql);
  ok(cnt(db2) === before, "a second apply adds nothing", [before, cnt(db2)]);
  ok(db2.prepare("SELECT evidence e FROM roadmap_implementation WHERE id IN (1754, 1758) ORDER BY id").all().map(r => r.e).join("|") === ev, "and appends the evidence only once");
  ok(db2.prepare("SELECT COUNT(*) n FROM decision_log WHERE actor = 'session:c4-fm'").get().n === 1, "one decision_log row");
}

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
