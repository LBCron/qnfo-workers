// ROOT-CAUSE-DIAGNOSIS-USABLE-1 offline suite (migrations/2026-11-05-root-cause-diagnosis-usable.sql). Replays the file on node:sqlite over a management-personas definition
// whose rc-agent-* steps are the text read from qnfo-audit on 2026-11-05 (fleet_tasks version 36) and runs the REWRITTEN step SQL against ticket fixtures.
// Proves: the header opts in; nothing is deleted; each of the three steps gets the length rule once and the prompt gets the instruction; a replay changes nothing (idempotent);
// a definition that has drifted (a fragment missing) is left alone; a ROOT-CAUSE-1 ticket whose only answer is an opening narration line is asked again, one with a real answer
// is not, one at six requests is not; a failed or empty answer is asked again; the report step appends a usable answer and never a narration line; the persona row of a ticket
// whose stored answer is unusable goes back to 'requested' and one with a usable answer stays 'reported'; the view and the detector read the live rule; the Rollback line restores.
// Output MUST contain "0 failed" on success.   node migrations/root-cause-diagnosis-usable.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("./2026-11-05-root-cause-diagnosis-usable.sql", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };
const header = sql.split("\n").filter((l) => l.startsWith("--"));
const body = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
ok(header.some((l) => /^-- APPLY-BY: ci\s*$/.test(l)) && header.some((l) => /^-- DB: qnfo-audit\s*$/.test(l)), "header opts in");
const rollback = header.filter((l) => /^-- Rollback:/.test(l));
ok(rollback.length === 1, "exactly one single-line Rollback header");
ok(header.some((l) => /^-- BACKUP: bak_20261105_rc_diagnosis_tasks\s*$/.test(l)), "BACKUP header names a table the file creates");
ok(!/\b(DELETE\s+FROM|DROP\s+(TABLE|INDEX|VIEW|TRIGGER))\b/i.test(body), "nothing is deleted or dropped in the body");
ok(!/\bUPDATE\s+agent_issues\b/i.test(body) && !/\bCREATE\s+TRIGGER\b/i.test(body), "agent_issues is not written and no trigger is added");
for (const m of body.matchAll(/LIKE\s+'([^']*)'/gi)) ok(Buffer.byteLength(m[1]) < 50, "LIKE pattern under D1's 50-byte limit: " + m[1]);

// ---- the live text (qnfo-audit fleet_tasks management-personas version 36, 2026-11-05) of the three steps and the prompt tail
const NOT_USABLE = "COALESCE(r.result, '') NOT LIKE '(the model returned no text)%' AND COALESCE(r.result, '') NOT LIKE '%tool_call%' AND COALESCE(r.result, '') NOT LIKE '%<invoke%' AND COALESCE(r.result, '') NOT LIKE '%<function_calls%' AND COALESCE(r.result, '') NOT LIKE '%DSML%'";
const REQUEST = "INSERT INTO cf_agent_requests (requester, kind, prompt, instance, priority) SELECT 'program-manager:' || COALESCE(m.program_code, 'QNFO.OPS'), 'run', 'You are the program manager of ' || COALESCE(m.program_code, 'QNFO.OPS') || ' in the QNFO fleet. Issue #' || a.id || ' says: ' || a.title || '. ' || substr(COALESCE(a.description, ''), 1, 1200) || ' Find the root cause: read qnfo-audit (issue_lifecycle, agent_issues, issue_triage.close_evidence, remediation_contracts.verify_probe for the family) and the repository code of the loop that files and the probe that closes these issues. Answer in under 300 words: the producer (worker, function or fleet_tasks step), the closing probe, why they disagree or why the defect recurs, and the smallest change that stops it, as a code-task proposal with repo, path and the exact edit, only after you have read the file and confirmed that the code-anchor text occurs exactly once in it; when the gate or writer is a D1 trigger, view, migration or fleet_tasks step, say so and propose the migration instead of a worker.js edit. If you can file it, file one agent_issues row with a code-task line.', 'root-cause-' || a.id, 'high' FROM agent_issues a LEFT JOIN issue_project_map m ON m.issue_id = a.id WHERE a.status = 'open' AND a.title LIKE 'ROOT-CAUSE-1:%' AND NOT EXISTS (SELECT 1 FROM cf_agent_requests r WHERE r.instance = 'root-cause-' || a.id AND " + NOT_USABLE + ") AND (SELECT COUNT(*) FROM cf_agent_requests q WHERE q.instance = 'root-cause-' || a.id) < 6 AND COALESCE((SELECT value FROM ops_config WHERE key = 'persona_actions'), 'on') <> 'off' ORDER BY a.id LIMIT 3";
const REPORT = "UPDATE agent_issues SET description = COALESCE(description, '') || char(10) || char(10) || 'Root-cause diagnosis by the Cloudflare agent (cf_agent_requests #' || (SELECT r.id FROM cf_agent_requests r WHERE r.instance = 'root-cause-' || agent_issues.id ORDER BY r.id DESC LIMIT 1) || ', ' || (SELECT r.finished_at FROM cf_agent_requests r WHERE r.instance = 'root-cause-' || agent_issues.id ORDER BY r.id DESC LIMIT 1) || '): ' || substr((SELECT COALESCE(r.result, r.error, '') FROM cf_agent_requests r WHERE r.instance = 'root-cause-' || agent_issues.id ORDER BY r.id DESC LIMIT 1), 1, 2000), updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000 WHERE status = 'open' AND title LIKE 'ROOT-CAUSE-1:%' AND id IN (SELECT p.issue_id FROM persona_actions p WHERE p.kind = 'agent-diagnose' AND p.to_value = 'requested') AND EXISTS (SELECT 1 FROM cf_agent_requests r WHERE r.instance = 'root-cause-' || agent_issues.id AND r.status IN ('done', 'failed', 'error') AND " + NOT_USABLE + ")";
const MARK = "UPDATE persona_actions SET to_value = 'reported' WHERE kind = 'agent-diagnose' AND to_value = 'requested' AND EXISTS (SELECT 1 FROM cf_agent_requests r WHERE r.instance = 'root-cause-' || persona_actions.issue_id AND r.status IN ('done', 'failed', 'error') AND " + NOT_USABLE + ")";
const steps = [{ name: "rc-file", sql: "SELECT 1" }, { name: "rc-agent-request", sql: REQUEST }, { name: "rc-agent-log", sql: "SELECT 2" }, { name: "rc-agent-report", sql: REPORT }, { name: "rc-agent-mark", sql: MARK }, { name: "risk-clear", sql: "DELETE FROM program_risk_now" }];
const DEFINITION = JSON.stringify({ steps });

function world(definition) {
  const d = new DatabaseSync(":memory:");
  d.exec(`
CREATE TABLE fleet_tasks (id TEXT PRIMARY KEY, name TEXT, type TEXT, definition TEXT, timeout_ms INTEGER, retries INTEGER, version INTEGER, enabled INTEGER, updated_at TEXT);
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE issue_project_map (issue_id INTEGER, program_code TEXT);
CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE cf_agent_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, requester TEXT, kind TEXT, prompt TEXT, instance TEXT, priority TEXT, status TEXT DEFAULT 'queued', result TEXT, error TEXT, finished_at TEXT);
CREATE TABLE persona_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, persona_key TEXT, kind TEXT, issue_id INTEGER, from_value TEXT, to_value TEXT, evidence TEXT, reverted_at TEXT);
CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT, root_cause TEXT, remediation TEXT, detector TEXT, probe_class TEXT, first_seen TEXT, issue_id INTEGER, trigger_condition TEXT, symptom TEXT, blast_radius TEXT);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER, escalate_to TEXT, expected_cadence_h INTEGER, status TEXT, module TEXT, budget_ms INTEGER, max_items INTEGER, requires_container INTEGER);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);`);
  d.prepare("INSERT INTO fleet_tasks VALUES ('management-personas', 'mp', 'sql', ?, 1, 0, 36, 1, 't')").run(definition);
  return d;
}
const q = (r, s, ...p) => r.prepare(s).all(...p);
const q1 = (r, s, ...p) => r.prepare(s).get(...p);
const NARRATION = "Now the contracts, the metrics named in the open family issues, and the lifecycle counts.";
const REAL = "Producer: scripts/bp26_slo.py file_action. Closing probe: remediation_contracts verify_probe on class issue-1000808, runner d1-query. Why they disagree: the probe reads a 28-day budget state that cannot read ok, so the contract fails after every close and REMEDIATION-REOPEN-2 reopens the issue. Smallest change: replace the probe with a 24 hour window of observed samples and re-arm the open issues each run (code-task in scripts/bp26_slo.py).";
ok(NARRATION.length < 400 && REAL.length >= 400, "fixture answers sit on the right sides of the 400 character rule", [NARRATION.length, REAL.length]);

function tickets(d) {
  const ins = d.prepare("INSERT INTO agent_issues (id, title, description, status, created_at) VALUES (?, ?, 'orig', 'open', 0)");
  for (const id of [1, 2, 3, 4, 5, 6]) ins.run(id, "ROOT-CAUSE-1: F" + id + " keeps recurring");
  ins.run(9, "SLO-POSTMORTEM-ACTION-1 x: find the root cause");
  const req = (id, status, result, n = 1) => { for (let i = 0; i < n; i++) d.prepare("INSERT INTO cf_agent_requests (requester, kind, prompt, instance, priority, status, result, finished_at) VALUES ('program-manager:QNFO.OPS', 'run', 'p', ?, 'high', ?, ?, '2026-11-05T00:00:00Z')").run("root-cause-" + id, status, result); };
  req(1, "done", NARRATION);            // narration only: counted as a diagnosis before, must be asked again
  req(2, "done", REAL);                 // usable
  req(3, "done", NARRATION, 6);         // six requests already: no more
  req(4, "failed", null);               // failed, empty
  /* 5: no request yet */
  req(6, "done", NARRATION); req(6, "done", REAL);   // an earlier narration, a later real answer
  for (const id of [1, 2, 3, 4, 6]) d.prepare("INSERT INTO persona_actions (persona_key, kind, issue_id, to_value) VALUES ('program-manager:QNFO.OPS', 'agent-diagnose', ?, ?)").run(id, id === 1 || id === 3 || id === 4 ? "reported" : "requested");
  d.prepare("INSERT INTO persona_actions (persona_key, kind, issue_id, to_value) VALUES ('program-manager:QNFO.OPS', 'agent-diagnose', 2, 'reported')").run();
}
const stepSql = (d, name) => JSON.parse(q1(d, "SELECT definition FROM fleet_tasks WHERE id = 'management-personas'").definition).steps.find((s) => s.name === name).sql;

// ---- before: the live rule asks again only for empty/markup answers
const before = world(DEFINITION); tickets(before);
const askedBefore = (() => { before.exec(stepSql(before, "rc-agent-request")); return q(before, "SELECT instance FROM cf_agent_requests WHERE status = 'queued' ORDER BY id").map((r) => r.instance); })();
ok(!askedBefore.includes("root-cause-1"), "BEFORE: a narration-only ticket is not asked again (the defect)", askedBefore);

// ---- apply
const w = world(DEFINITION); tickets(w);
w.exec(sql);
const defn = q1(w, "SELECT definition, version FROM fleet_tasks WHERE id = 'management-personas'");
ok(defn.version === 37 && JSON.parse(defn.definition).steps.length === steps.length, "version bumped once, steps intact", defn.version);
const gate = "AND length(COALESCE(r.result, '')) >= 400";
ok(defn.definition.split(gate).length - 1 === 3, "the length rule is in exactly three places");
for (const n of ["rc-agent-request", "rc-agent-report", "rc-agent-mark"]) ok(stepSql(w, n).includes(gate), n + " carries the length rule");
ok(/at least four sentences, beginning with the line ROOT-CAUSE-DIAGNOSIS:/.test(stepSql(w, "rc-agent-request")), "the prompt asks for the diagnosis itself");
ok(stepSql(w, "risk-clear") === "DELETE FROM program_risk_now" && stepSql(w, "rc-file") === "SELECT 1", "other steps are untouched");
w.exec(sql);
ok(q1(w, "SELECT version FROM fleet_tasks WHERE id = 'management-personas'").version === 37, "a replay does not bump the version again");
ok(q1(w, "SELECT definition FROM fleet_tasks WHERE id = 'management-personas'").definition === defn.definition, "a replay changes no step");
ok(q(w, "SELECT * FROM failure_modes").length === 1 && q(w, "SELECT * FROM remediation_contracts").length === 1 && q(w, "SELECT * FROM decision_log").length === 1, "one failure mode, one detector, one decision row after two applies");

// ---- behaviour of the rewritten request step
w.exec(stepSql(w, "rc-agent-request"));
const asked = q(w, "SELECT instance FROM cf_agent_requests WHERE status = 'queued' ORDER BY id").map((r) => r.instance);
ok(asked.join() === "root-cause-1,root-cause-4,root-cause-5", "asks again for the narration-only ticket (1), the failed one (4) and the one never asked (5); not for the real answer (2), the six-request ticket (3) or the ticket with a later real answer (6)", asked);
ok(q1(w, "SELECT COUNT(*) n FROM cf_agent_requests WHERE instance = 'root-cause-3'").n === 6, "the six-request ticket got no seventh");

// ---- the view
const view = Object.fromEntries(q(w, "SELECT issue_id, requests, usable FROM v_root_cause_diagnosis").map((r) => [r.issue_id, r]));
ok(view[2].usable === 1 && view[6].usable === 1 && view[1].usable === 0 && view[3].usable === 0 && view[5].requests === 1 && !view[9], "v_root_cause_diagnosis counts usable answers per open ROOT-CAUSE-1 ticket only", view);

// ---- persona rows: unusable stored answers go back to 'requested'; ticket 2 (usable) stays
const personas = Object.fromEntries(q(w, "SELECT issue_id, to_value FROM persona_actions").map((r) => [r.issue_id + (r.issue_id === 2 ? ":" + r.to_value : ""), r.to_value]));
ok(personas[1] === "requested" && personas[3] === "requested" && personas[4] === "requested", "persona rows of tickets 1, 3 and 4 (unusable stored answers) are set back to requested", personas);
ok(personas["2:reported"] === "reported", "the usable ticket keeps its reported row");

// ---- report step appends a usable answer, never a narration line
w.exec(stepSql(w, "rc-agent-report"));
const d1 = q1(w, "SELECT description FROM agent_issues WHERE id = 1").description, d6 = q1(w, "SELECT description FROM agent_issues WHERE id = 6").description;
ok(d1 === "orig", "ticket 1 (narration only) gets no appended diagnosis", d1);
ok(/Root-cause diagnosis by the Cloudflare agent/.test(d6) && d6.includes("Producer: scripts/bp26_slo.py"), "ticket 6 (a real answer after a narration line) gets the real answer appended", d6.slice(0, 200));
// the real answer arrives for ticket 1
w.prepare("UPDATE cf_agent_requests SET status = 'done', result = ?, finished_at = '2026-11-05T01:00:00Z' WHERE instance = 'root-cause-1' AND status = 'queued'").run(REAL);
w.exec(stepSql(w, "rc-agent-report")); w.exec(stepSql(w, "rc-agent-mark"));
ok(q1(w, "SELECT description FROM agent_issues WHERE id = 1").description.includes("Producer: scripts/bp26_slo.py"), "ticket 1 gets the diagnosis once a real answer exists");
ok(q1(w, "SELECT to_value FROM persona_actions WHERE issue_id = 1").to_value === "reported", "and its persona row is reported again");

// ---- the detector reads the rule from the live definition
const det = q1(w, "SELECT verify_probe, expected_cadence_h, module, status, verify_transport FROM remediation_contracts WHERE class = 'fm-root-cause-diagnosis-preface'");
ok(det.module === "failure-mode" && det.verify_transport === "d1-query" && det.status === "active", "the detector is a standing failure-mode contract");
const r1 = q1(w, det.verify_probe);
ok(r1.expected === "3" && r1.observed === "3", "detector: the rule is in all three steps", r1);
w.prepare("UPDATE fleet_tasks SET definition = replace(definition, ?, '') WHERE id = 'management-personas'").run(gate);
const r2 = q1(w, det.verify_probe);
ok(r2.observed === "0" && r2.expected === "3", "detector: removing the rule is seen", r2);

// ---- a drifted definition is left alone
const drift = world(DEFINITION.replace("NOT LIKE '%DSML%') AND (SELECT COUNT(*) FROM cf_agent_requests q", "NOT LIKE '%DSML%') AND (SELECT COUNT(1) FROM cf_agent_requests q")); tickets(drift);
const driftBefore = q1(drift, "SELECT definition, version FROM fleet_tasks WHERE id = 'management-personas'");
drift.exec(sql);
const driftAfter = q1(drift, "SELECT definition, version FROM fleet_tasks WHERE id = 'management-personas'");
ok(driftAfter.definition === driftBefore.definition && driftAfter.version === 36, "a definition whose fragment moved is not partly rewritten");

// ---- rollback
const rb = world(DEFINITION); tickets(rb);
const snap = JSON.stringify([q(rb, "SELECT * FROM fleet_tasks"), q(rb, "SELECT * FROM persona_actions ORDER BY id")]);
rb.exec(sql);
rb.exec(rollback[0].replace(/^-- Rollback:\s*/, ""));
const back = q(rb, "SELECT * FROM fleet_tasks");
ok(back[0].definition === JSON.parse(snap)[0][0].definition, "the Rollback line restores the definition");
ok(JSON.stringify(q(rb, "SELECT * FROM persona_actions ORDER BY id")) === JSON.stringify(JSON.parse(snap)[1]), "the Rollback line restores the persona rows");
ok(q(rb, "SELECT * FROM failure_modes").length === 0 && q(rb, "SELECT * FROM remediation_contracts").length === 0, "the Rollback line removes the failure mode and the detector");
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
