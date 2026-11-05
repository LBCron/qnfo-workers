// C4-FM-DETECTOR-CONVERGE-1 offline suite for migrations/2026-11-05-c4-fm-detector-converge.sql (follow-up of PR 7398, roadmap_implementation 1754 and 1756).
// Replays the three files in production order on node:sqlite: the detector contracts as migrations/2026-11-05-sla-graph-fm-1.sql created them (copies of the issue probes, read live
// 2026-11-04T23:21Z), then migrations/2026-11-04-c4-fm-roadmap-closeout.sql (whose INSERT OR IGNORE leaves those copies in place), then the converge file. Proves: the copied raw-markup probe reads 0
// on a database that holds markup and the replacement reads the defect; the copied close-no-dwell probe is replaced by the hold audit and reads 0 for a held close; the failure_modes rows name the
// fm-<key> contracts; the two duplicates are superseded and not run; a second apply changes nothing; nothing happens before v_close_hold_audit exists. State-independent: no live read.
// Run: node --no-warnings migrations/c4-fm-detector-converge.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const here = new URL("./", import.meta.url);
const first = readFileSync(new URL("2026-11-04-c4-fm-roadmap-closeout.sql", here), "utf8").replace(/\r\n/g, "\n");
const conv = readFileSync(new URL("2026-11-05-c4-fm-detector-converge.sql", here), "utf8").replace(/\r\n/g, "\n");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 500))); } };

ok(/^-- APPLY-BY: ci$/m.test(conv) && /^-- DB: qnfo-audit$/m.test(conv) && /^-- Rollback: .+/m.test(conv) && /^-- BACKUP: bak_\w+$/m.test(conv), "migration headers present");
ok(!/\bDELETE\b/i.test(conv.replace(/^--.*$/gm, "")), "no DELETE in the body");

// the probes of sla-graph-fm-1 (copies of the issue contracts 1000717 and 1000719), as read live
const OLD_RAW = "SELECT '0' AS expected, CAST((CASE WHEN instr((SELECT definition FROM fleet_tasks WHERE id = 'management-personas'), '%tool_call%') > 0 THEN (SELECT COUNT(*) FROM cf_agent_requests r JOIN agent_issues a ON r.instance = 'root-cause-' || a.id WHERE r.finished_at > '2026-10-29T00:00:00Z' AND (r.result LIKE '%tool_call%' OR r.result LIKE '%<invoke%' OR r.result LIKE '%DSML%') AND instr(a.description, '(cf_agent_requests #' || r.id || ',') > 0) ELSE 1 END) + (SELECT COUNT(*) FROM agent_issues WHERE status = 'open' AND title LIKE 'ROOT-CAUSE-1:%' AND description LIKE '%no answer yet' || char(59) || ' the managers ask again') AS TEXT) AS observed";
const OLD_DWELL = "SELECT '0' AS expected, CAST((SELECT COUNT(*) FROM v_close_dwell_shadow WHERE single_pass_close = 1 AND closed_on_pass_at > datetime('now', '-24 hours')) AS TEXT) AS observed";
const OLD_ANCHOR = "SELECT '1' AS expected, CASE WHEN instr((SELECT definition FROM fleet_tasks WHERE id = 'management-personas'), 'occurs exactly once in it') > 0 THEN '1' ELSE '0' END AS observed";

const SCHEMA = `
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, description TEXT, status TEXT, source TEXT, category TEXT, priority TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE cf_agent_requests (id INTEGER PRIMARY KEY, requester TEXT, instance TEXT, status TEXT DEFAULT 'done', result TEXT, error TEXT, finished_at TEXT);
CREATE TABLE persona_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, persona_key TEXT, kind TEXT, issue_id INTEGER, from_value TEXT, to_value TEXT, evidence TEXT);
CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE fleet_tasks (id TEXT PRIMARY KEY, definition TEXT);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER, escalate_to TEXT, expected_cadence_h INTEGER, status TEXT, module TEXT, next_due_at TEXT, attempts INTEGER DEFAULT 0, last_verdict TEXT);
CREATE TABLE remediation_verifications (id INTEGER PRIMARY KEY AUTOINCREMENT, class TEXT, issue_id INTEGER, pass INTEGER, expected TEXT, observed TEXT, verified_at TEXT, transport TEXT);
CREATE TABLE issue_triage (issue_id INTEGER PRIMARY KEY, reopened_count INTEGER DEFAULT 0, close_evidence TEXT);
CREATE TABLE issue_lifecycle (id INTEGER PRIMARY KEY AUTOINCREMENT, issue_id INTEGER, event TEXT, ts TEXT);
CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT, root_cause TEXT, remediation TEXT, detector TEXT, probe_class TEXT, first_seen TEXT, issue_id INTEGER, trigger_condition TEXT, symptom TEXT, blast_radius TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
CREATE TABLE roadmap_implementation (id INTEGER PRIMARY KEY, item TEXT, source TEXT, title TEXT, artifact_type TEXT, artifact_ref TEXT, status TEXT, evidence TEXT, verified_at TEXT);
CREATE VIEW v_close_dwell_shadow AS SELECT 0 AS single_pass_close, '' AS closed_on_pass_at WHERE 0;
`;

const mk = () => {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  // sla-graph-fm-1: the failure modes point at the copied contracts
  db.exec("INSERT INTO failure_modes (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen) VALUES " +
    "('diagnosis-raw-markup', 'a', 'b', 'c', 'x', 'fm-diagnosis-raw-markup', '2026-10-28'), ('diagnosis-unresolved-anchor', 'a', 'b', 'c', 'x', 'fm-diagnosis-unresolved-anchor', '2026-10-28'), ('close-no-dwell', 'a', 'b', 'c', 'x', 'fm-close-no-dwell', '2026-10-28')");
  const ins = db.prepare("INSERT INTO remediation_contracts (class, precondition, action, verify_probe, verify_transport, status, module, last_verdict) VALUES (?, ?, 'failure-mode detector', ?, 'd1-query', 'active', 'failure-mode', ?)");
  ins.run("fm-diagnosis-raw-markup", "even-keel FM-1 (agent_issues 1000717)", OLD_RAW, "pass");
  ins.run("fm-diagnosis-unresolved-anchor", "even-keel FM-2 (agent_issues 1000718)", OLD_ANCHOR, "pass");
  ins.run("fm-close-no-dwell", "even-keel FM-3 (agent_issues 1000719)", OLD_DWELL, "fail");
  db.prepare("INSERT INTO fleet_tasks (id, definition) VALUES ('management-personas', ?)").run("... confirmed that the code-anchor text occurs exactly once in it; when the gate or writer is a D1 trigger, view, migration or fleet_tasks step, say so ... %tool_call% ...");
  db.exec("INSERT INTO roadmap_implementation (id, item, source, title, artifact_type, status, evidence) VALUES (1756, 'FM-3', 'failure-modes-2026', 't', 'doc', 'planned', 'x')");
  return db;
};
const probe = (db, cls) => db.prepare("SELECT verify_probe p FROM remediation_contracts WHERE class = ?").get(cls).p;
const read = (db, cls) => { const r = db.prepare(probe(db, cls)).get(); return [String(r.expected), String(r.observed)]; };
const row = (db, cls) => db.prepare("SELECT status, last_verdict, attempts, precondition FROM remediation_contracts WHERE class = ?").get(cls);

// production order: sla-graph-fm-1 (in mk), PR 7398, this file
const db = mk();
// pre-fix data: a markup description whose answer is older than 2026-10-29 and a clean answer that is not in the description, the placeholder in the middle of a description
db.prepare("INSERT INTO agent_issues (id, title, description, status) VALUES (1000558, 'ROOT-CAUSE-1: W', ?, 'open')").run("t\n\nRoot-cause diagnosis by the Cloudflare agent (cf_agent_requests #238, 2026-10-27T02:51:00Z): <|tool_calls_section_begin|><|tool_call_begin|>x\n\nRED-GATE-1: escalated");
db.prepare("INSERT INTO agent_issues (id, title, description, status) VALUES (1000303, 'ROOT-CAUSE-1: L', ?, 'open')").run("t (cf_agent_requests #5, 2026-10-26T07:46:00Z): no answer yet; the managers ask again\n\nCLUSTER-F-A note");
db.prepare("INSERT INTO cf_agent_requests (id, requester, instance, status, result, finished_at) VALUES (238, 'p', 'root-cause-1000558', 'done', '<|tool_calls_section_begin|><|tool_call_begin|>x', '2026-10-27T02:51:00Z')").run();
db.prepare("INSERT INTO cf_agent_requests (id, requester, instance, status, result, finished_at) VALUES (333, 'p', 'root-cause-1000303', 'done', 'Known from qnfo-audit: a clean answer', '2026-10-28T20:51:00Z')").run();
const oldRead = read(db, "fm-diagnosis-raw-markup");
ok(oldRead[1] === "0", "the copied probe reads 0 on a database that holds markup and an unappended answer (the defect)", oldRead);

db.exec(first);
ok(probe(db, "fm-diagnosis-raw-markup") === OLD_RAW && probe(db, "fm-close-no-dwell") === OLD_DWELL, "PR 7398 left the copies of sla-graph-fm-1 in place (INSERT OR IGNORE)");
ok(db.prepare("SELECT probe_class p FROM failure_modes WHERE fm_key = 'close-no-dwell'").get().p === "fm-close-hold-violated" && db.prepare("SELECT probe_class p FROM failure_modes WHERE fm_key = 'diagnosis-unresolved-anchor'").get().p === "fm-diagnosis-anchor-rule", "and re-pointed two failure modes at its own names");

// the first migration scrubbed the markup description; put the pre-fix state back for the probe test
db.prepare("UPDATE agent_issues SET description = ? WHERE id = 1000558").run("t\n\nRoot-cause diagnosis by the Cloudflare agent (cf_agent_requests #238, 2026-10-27T02:51:00Z): <|tool_calls_section_begin|><|tool_call_begin|>x\n\nRED-GATE-1: escalated");
db.prepare("UPDATE agent_issues SET description = 't (cf_agent_requests #5, 2026-10-26T07:46:00Z): later note' WHERE id = 1000303").run();

db.exec(conv);
const raw = read(db, "fm-diagnosis-raw-markup");
ok(raw[0] === "0" && raw[1] === "2", "the replaced probe counts the markup description and the unappended clean answer", raw);
ok(!probe(db, "fm-diagnosis-raw-markup").includes("no answer yet") && row(db, "fm-diagnosis-raw-markup").attempts === 0 && row(db, "fm-diagnosis-raw-markup").last_verdict === null, "and re-arms it");
const dw = read(db, "fm-close-no-dwell");
ok(dw[0] === "0" && dw[1] === "0" && probe(db, "fm-close-no-dwell").includes("v_close_hold_audit") && row(db, "fm-close-no-dwell").last_verdict === null, "fm-close-no-dwell reads the hold audit and passes on an empty audit", dw);
ok(probe(db, "fm-diagnosis-unresolved-anchor") === OLD_ANCHOR, "the prompt-rule detector of sla-graph-fm-1 is untouched");
const fm = Object.fromEntries(db.prepare("SELECT fm_key k, probe_class p FROM failure_modes").all().map(r => [r.k, r.p]));
ok(fm["close-no-dwell"] === "fm-close-no-dwell" && fm["diagnosis-unresolved-anchor"] === "fm-diagnosis-unresolved-anchor" && fm["diagnosis-raw-markup"] === "fm-diagnosis-raw-markup", "the failure modes name the fm-<key> contracts", fm);
ok(row(db, "fm-close-hold-violated").status === "superseded" && /duplicate of fm-close-no-dwell/.test(row(db, "fm-close-hold-violated").last_verdict) && row(db, "fm-diagnosis-anchor-rule").status === "superseded", "the two duplicates are superseded");
ok(row(db, "fm-verification-row-volume").status === "active", "the row-volume detector stays active");
ok(db.prepare("SELECT COUNT(*) n FROM bak_20261105_c4_fm_detectors").get().n >= 4, "the replaced rows are backed up");

// the replaced close-no-dwell probe sees a violation and a held close
{
  const T = min => db.prepare("SELECT datetime('now', ?) t").get((-min) + " minutes").t;
  const TZ = min => T(min).replace(" ", "T") + "Z";
  const V = db.prepare("INSERT INTO remediation_verifications (class, issue_id, pass, expected, observed, verified_at, transport) VALUES (?, ?, ?, '0', '0', ?, 'd1-query')");
  const close = (issue, atMin) => { const vid = db.prepare("SELECT MAX(id) m FROM remediation_verifications").get().m; db.prepare("INSERT INTO issue_triage (issue_id, close_evidence) VALUES (?, ?)").run(issue, "remediation_verifications#" + vid + " pass=1 class=issue-" + issue + " transport=d1-query verified_at=" + T(atMin)); };
  db.prepare("INSERT INTO issue_lifecycle (issue_id, event, ts) VALUES (3001, 'reopened', ?), (3002, 'reopened', ?)").run(TZ(300), TZ(300));
  V.run("issue-3001", 3001, 1, T(250)); V.run("issue-3001", 3001, 1, T(100)); close(3001, 100);   // held: 150 minutes against 60
  ok(read(db, "fm-close-no-dwell")[1] === "0", "a held close is no violation");
  V.run("issue-3002", 3002, 1, T(80)); close(3002, 80);                                             // the only pass since the reopen
  ok(read(db, "fm-close-no-dwell")[1] === "1", "a single post-reopen pass is the violation");
}

// idempotence and the guard
const snap = d => JSON.stringify([d.prepare("SELECT class, status, verify_probe, last_verdict, attempts FROM remediation_contracts ORDER BY class").all(), d.prepare("SELECT fm_key, probe_class, detector FROM failure_modes ORDER BY fm_key").all(), d.prepare("SELECT COUNT(*) n FROM decision_log").get(), d.prepare("SELECT COUNT(*) n FROM bak_20261105_c4_fm_detectors").get()]);
{
  const before = snap(db);
  db.exec(conv);
  ok(snap(db) === before, "a second apply changes nothing");
  ok(db.prepare("SELECT COUNT(*) n FROM decision_log WHERE actor = 'session:c4-fm' AND capability_gain = 'fm-detectors-converge-1'").get().n === 1, "one decision_log row");
}
{
  const d2 = mk();   // PR 7398 not applied: no v_close_hold_audit
  d2.exec(conv);
  ok(probe(d2, "fm-close-no-dwell") === OLD_DWELL && row(d2, "fm-close-no-dwell").last_verdict === "fail", "without v_close_hold_audit the close-no-dwell probe is not replaced");
  ok(!probe(d2, "fm-diagnosis-raw-markup").includes("no answer yet"), "the raw-markup probe does not depend on the view");
}
{
  const d3 = mk();
  d3.exec(first);
  d3.exec("UPDATE roadmap_implementation SET evidence = 'FM-3 ... PR 7398 adds v_close_hold_audit and detector fm-close-hold-violated, expected 0.' WHERE id = 1756");
  d3.exec(conv);
  ok(/detector fm-close-no-dwell \(its probe reads v_close_hold_audit\), expected 0/.test(d3.prepare("SELECT evidence e FROM roadmap_implementation WHERE id = 1756").get().e), "the evidence of row 1756 names the detector that stays");
}

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
