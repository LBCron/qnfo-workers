// C4-FM2-LEVER-NONANCHOR-GATE-1 offline suite for migrations/2026-11-05-c4-fm2-lever-nonanchor-gate.sql (roadmap_implementation 1755 FM-2).
// Replays the migration against the live lever-report and lever-mark statements of fleet_tasks management-personas-c (read 2026-11-05T00:50Z, v12; the lever-request step is carried as a
// predicate-only copy) and proves: a lever reply whose code-anchor line starts with not (NOT ESTABLISHED, not quotable, not captured) is appended by the old statements and refused by the new
// ones (marked empty, so the request step asks again); a usable reply and a CORRECTED TARGET reply are still appended and reported; the six predicates carry the gate; the two stored
// blocks lose the task marker; the FM-2 detector reads the stored non-anchors; a second apply changes nothing; a task whose predicate does not occur six times is not written.
// State-independent: no live read. Run: node --no-warnings migrations/c4-fm2-lever-nonanchor-gate.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const here = new URL("./", import.meta.url);
const sql = readFileSync(new URL("2026-11-05-c4-fm2-lever-nonanchor-gate.sql", here), "utf8").replace(/\r\n/g, "\n");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 500))); } };

ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: .+/m.test(sql) && /^-- BACKUP: bak_\w+$/m.test(sql), "migration headers present");
ok(!/\bDELETE\b/i.test(sql.replace(/^--.*$/gm, "")), "no DELETE in the body");

const LEVER_REPORT = `UPDATE agent_issues SET description = COALESCE(description, '') || char(10) || char(10) || 'Lever review by the Cloudflare agent (' || (SELECT x.from_value FROM persona_actions x WHERE x.id = (SELECT MIN(p.id) FROM persona_actions p JOIN cf_agent_requests r ON r.instance = p.from_value WHERE p.kind = 'lever-review' AND p.to_value = 'requested' AND p.issue_id = agent_issues.id AND r.status IN ('done', 'failed', 'error') AND ((COALESCE(r.result, '') LIKE '%code-task: repo=qnfo-workers path=%' AND COALESCE(r.result, '') LIKE '%code-anchor:%' AND COALESCE(r.result, '') LIKE '%EDIT:%') OR (COALESCE(r.result, '') LIKE '%CORRECTED TARGET:%' AND COALESCE(r.result, '') LIKE '%EVIDENCE:%')) AND COALESCE(r.result, r.error, '') <> '')) || ', the metric did not improve in 7 days): ' || substr((SELECT COALESCE(r.result, r.error, '') FROM cf_agent_requests r WHERE r.instance = (SELECT x.from_value FROM persona_actions x WHERE x.id = (SELECT MIN(p.id) FROM persona_actions p JOIN cf_agent_requests r ON r.instance = p.from_value WHERE p.kind = 'lever-review' AND p.to_value = 'requested' AND p.issue_id = agent_issues.id AND r.status IN ('done', 'failed', 'error') AND ((COALESCE(r.result, '') LIKE '%code-task: repo=qnfo-workers path=%' AND COALESCE(r.result, '') LIKE '%code-anchor:%' AND COALESCE(r.result, '') LIKE '%EDIT:%') OR (COALESCE(r.result, '') LIKE '%CORRECTED TARGET:%' AND COALESCE(r.result, '') LIKE '%EVIDENCE:%')) AND COALESCE(r.result, r.error, '') <> '')) ORDER BY r.id DESC LIMIT 1), 1, 2000), updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000 WHERE status = 'open' AND NOT EXISTS (SELECT 1 FROM persona_actions g WHERE g.kind = 'lever-review' AND g.to_value = 'requested' AND g.issue_id = agent_issues.id AND instr(COALESCE(agent_issues.description, ''), 'Lever review by the Cloudflare agent (' || g.from_value || ',') > 0) AND (SELECT MIN(p.id) FROM persona_actions p JOIN cf_agent_requests r ON r.instance = p.from_value WHERE p.kind = 'lever-review' AND p.to_value = 'requested' AND p.issue_id = agent_issues.id AND r.status IN ('done', 'failed', 'error') AND ((COALESCE(r.result, '') LIKE '%code-task: repo=qnfo-workers path=%' AND COALESCE(r.result, '') LIKE '%code-anchor:%' AND COALESCE(r.result, '') LIKE '%EDIT:%') OR (COALESCE(r.result, '') LIKE '%CORRECTED TARGET:%' AND COALESCE(r.result, '') LIKE '%EVIDENCE:%')) AND COALESCE(r.result, r.error, '') <> '') IS NOT NULL`;
const LEVER_MARK = `UPDATE persona_actions SET to_value = CASE WHEN EXISTS (SELECT 1 FROM cf_agent_requests r WHERE r.instance = persona_actions.from_value AND r.status IN ('done', 'failed', 'error') AND (COALESCE(r.result, '') LIKE '(the model returned no text)%' OR COALESCE(r.result, r.error, '') = '' OR NOT ((COALESCE(r.result, '') LIKE '%code-task: repo=qnfo-workers path=%' AND COALESCE(r.result, '') LIKE '%code-anchor:%' AND COALESCE(r.result, '') LIKE '%EDIT:%') OR (COALESCE(r.result, '') LIKE '%CORRECTED TARGET:%' AND COALESCE(r.result, '') LIKE '%EVIDENCE:%')))) THEN 'empty' ELSE 'reported' END WHERE kind = 'lever-review' AND to_value = 'requested' AND (id IN (SELECT MIN(p.id) FROM persona_actions p JOIN cf_agent_requests r ON r.instance = p.from_value WHERE p.kind = 'lever-review' AND p.to_value = 'requested' AND r.status IN ('done', 'failed', 'error') AND COALESCE(r.result, '') NOT LIKE '(the model returned no text)%' AND COALESCE(r.result, r.error, '') <> '' GROUP BY p.issue_id) OR EXISTS (SELECT 1 FROM cf_agent_requests r WHERE r.instance = persona_actions.from_value AND r.status IN ('done', 'failed', 'error') AND (COALESCE(r.result, '') LIKE '(the model returned no text)%' OR COALESCE(r.result, r.error, '') = '' OR NOT ((COALESCE(r.result, '') LIKE '%code-task: repo=qnfo-workers path=%' AND COALESCE(r.result, '') LIKE '%code-anchor:%' AND COALESCE(r.result, '') LIKE '%EDIT:%') OR (COALESCE(r.result, '') LIKE '%CORRECTED TARGET:%' AND COALESCE(r.result, '') LIKE '%EVIDENCE:%')))))`;
// the lever-request step carries the predicate once, inside its NOT EXISTS (the rest of the statement is not replayed here)
const LEVER_REQUEST_PRED = "AND NOT EXISTS (SELECT 1 FROM cf_agent_requests r WHERE r.instance LIKE 'lever-' || m.trigger_id || '-%' AND (r.status IN ('queued', 'running') OR (r.created_at >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-3 days') AND ((COALESCE(r.result, '') LIKE '%code-task: repo=qnfo-workers path=%' AND COALESCE(r.result, '') LIKE '%code-anchor:%' AND COALESCE(r.result, '') LIKE '%EDIT:%') OR (COALESCE(r.result, '') LIKE '%CORRECTED TARGET:%' AND COALESCE(r.result, '') LIKE '%EVIDENCE:%')) AND r.status = 'done')))";
const FRAG = "COALESCE(r.result, '') LIKE '%code-anchor:%' AND COALESCE(r.result, '') LIKE '%EDIT:%'";
const count = (s, f) => s.split(f).length - 1;
const defOf = (steps) => JSON.stringify({ steps });
const LIVE_DEF = defOf([
  { type: "sql", name: "lever-request", db: "AUDIT", sql: "INSERT INTO x SELECT 1 FROM y m WHERE 1 " + LEVER_REQUEST_PRED },
  { type: "sql", name: "lever-report", db: "AUDIT", sql: LEVER_REPORT },
  { type: "sql", name: "lever-mark", db: "AUDIT", sql: LEVER_MARK },
  { type: "sql", name: "unrelated", db: "AUDIT", sql: "SELECT 1 WHERE 'code-anchor' <> ''" },
]);
ok(count(LIVE_DEF, FRAG) === 6, "the fixture carries the predicate six times, as the live task does", count(LIVE_DEF, FRAG));

const NONANCHOR_1000391 = "ROOT CAUSE: the runner stores the preface\ncode-task: repo=qnfo-workers path=qnfo-agents/src/ (lever-review / cf_agent_requests result capture — exact file NOT read in this turn)\ncode-anchor: NOT ESTABLISHED — I did not read the producer source, and I will not supply an unverified anchor.\n\nEDIT: pending that read";
const NONANCHOR_1001373 = "ROOT CAUSE: the playbook insert\ncode-task: repo=qnfo-workers path=migrations/2026-11-04-iar-r1-live-doer-verify-semicolon.sql\ncode-anchor: not quotable — the playbook-insert migration's text was never read.\nEDIT: add a migration";
const GOOD = "ROOT CAUSE: the closer\ncode-task: repo=qnfo-workers path=qnfo-fleet-control/worker.js\ncode-anchor: async function breachDoctorTick(env, opts) {\nEDIT: guard the close";
const GOOD_BACKTICK_NOTE = "ROOT CAUSE: x\ncode-task: repo=qnfo-workers path=a/b.js\ncode-anchor: notify(env, row);\nEDIT: y";   // a real anchor that starts with the letters not (notify), no space after not
const TARGET = "ROOT CAUSE: the target is wrong; CORRECTED TARGET: >= 40; EVIDENCE: its formula counts closed rows.";
const NOTAGAIN = "ROOT CAUSE: x\ncode-task: repo=qnfo-workers path=a/b.js\ncode-anchor: not captured\nEDIT: y";

const mk = () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, description TEXT, status TEXT, source TEXT, category TEXT, priority TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE cf_agent_requests (id INTEGER PRIMARY KEY, requester TEXT, instance TEXT, status TEXT DEFAULT 'done', result TEXT, error TEXT, finished_at TEXT, created_at TEXT);
CREATE TABLE persona_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, persona_key TEXT, kind TEXT, issue_id INTEGER, from_value TEXT, to_value TEXT, evidence TEXT);
CREATE TABLE fleet_tasks (id TEXT PRIMARY KEY, definition TEXT, version INTEGER, updated_at TEXT);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, precondition TEXT, action TEXT, verify_probe TEXT, status TEXT, attempts INTEGER DEFAULT 0, last_verdict TEXT, next_due_at TEXT);
CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, detector TEXT, probe_class TEXT);
CREATE TABLE roadmap_implementation (id INTEGER PRIMARY KEY, item TEXT, status TEXT, evidence TEXT, verified_at TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
`);
  db.prepare("INSERT INTO fleet_tasks VALUES ('management-personas-c', ?, 12, 'x')").run(LIVE_DEF);
  const ISS = db.prepare("INSERT INTO agent_issues (id, title, description, status) VALUES (?, ?, ?, 'open')");
  const REQ = db.prepare("INSERT INTO cf_agent_requests (id, requester, instance, status, result, created_at) VALUES (?, 'program-manager:QNFO.OPS', ?, 'done', ?, '2026-11-05T00:00:00Z')");
  const PA = db.prepare("INSERT INTO persona_actions (ts, persona_key, kind, issue_id, from_value, to_value, evidence) VALUES ('2026-11-05T00:00:00Z', 'program-manager:QNFO.OPS', 'lever-review', ?, ?, 'requested', 'x')");
  let rid = 1;
  for (const [iss, reply] of [[5001, GOOD], [5002, NONANCHOR_1000391], [5003, TARGET], [5004, GOOD_BACKTICK_NOTE], [5005, NOTAGAIN]]) {
    ISS.run(iss, "METRIC-TRIGGER-" + iss + "-X: gap", "breach text");
    const inst = "lever-" + iss + "-202611050000";
    REQ.run(rid++, inst, reply); PA.run(iss, inst);
  }
  // the two stored blocks as the lever-report wrote them
  db.prepare("INSERT INTO agent_issues (id, title, description, status) VALUES (1000391, 'METRIC-TRIGGER-14558-X: gap', ?, 'open')").run("text\n\nLever review by the Cloudflare agent (lever-14558-1, the metric did not improve in 7 days): " + NONANCHOR_1000391);
  db.prepare("INSERT INTO agent_issues (id, title, description, status) VALUES (1001373, 'METRIC-TRIGGER-14606-X: gap', ?, 'open')").run("text\n\nLever review by the Cloudflare agent (lever-14606-1, the metric did not improve in 7 days): " + NONANCHOR_1001373);
  db.prepare("INSERT INTO agent_issues (id, title, description, status) VALUES (100138, 'METRIC-TRIGGER-1-X: gap', ?, 'open')").run("text\n\nLever review by the Cloudflare agent (lever-1-1, ...): " + GOOD);
  db.prepare("INSERT INTO remediation_contracts (class, precondition, action, verify_probe, status, last_verdict) VALUES ('fm-diagnosis-unresolved-anchor', 'even-keel FM-2 (agent_issues 1000718)', 'failure-mode detector', ?, 'active', 'pass')")
    .run("SELECT '1' AS expected, CASE WHEN instr((SELECT definition FROM fleet_tasks WHERE id = 'management-personas'), 'occurs exactly once in it') > 0 THEN '1' ELSE '0' END AS observed");
  db.prepare("INSERT INTO fleet_tasks VALUES ('management-personas', ?, 36, 'x')").run("... occurs exactly once in it ... D1 trigger, view, migration or fleet_tasks step ...");
  db.prepare("INSERT INTO failure_modes VALUES ('diagnosis-unresolved-anchor', 'fm-diagnosis-unresolved-anchor: the live root-cause prompt carries the rule', 'fm-diagnosis-unresolved-anchor')").run();
  db.prepare("INSERT INTO roadmap_implementation VALUES (1755, 'FM-2', 'verified', 'FM-2 live 2026-11-04: the prompt requires the anchor.', '2026-11-04 23:38:51')").run();
  return db;
};
const stepSql = (db, name) => JSON.parse(db.prepare("SELECT definition d FROM fleet_tasks WHERE id = 'management-personas-c'").get().d).steps.find(s => s.name === name).sql;
const pa = (db, iss) => db.prepare("SELECT to_value v FROM persona_actions WHERE issue_id = ?").get(iss).v;
const desc = (db, id) => db.prepare("SELECT description d FROM agent_issues WHERE id = ?").get(id).d;
const appended = (db, iss) => desc(db, iss).includes("Lever review by the Cloudflare agent (lever-" + iss + "-");

// before: the live statements append a reply that says there is no anchor
{
  const pre = mk();
  pre.exec(stepSql(pre, "lever-report")); pre.exec(stepSql(pre, "lever-mark"));
  ok(appended(pre, 5002) && appended(pre, 5005), "the live statements append a reply whose code-anchor line says there is none (the defect)");
  ok(pa(pre, 5002) === "reported", "and mark it reported");
}

const db = mk();
db.exec(sql);
const v = db.prepare("SELECT version, definition FROM fleet_tasks WHERE id = 'management-personas-c'").get();
ok(v.version === 13, "management-personas-c version moves once", v.version);
ok(count(v.definition, "NOT LIKE '%code-anchor: not %'") === 6 && count(v.definition, FRAG) === 0, "all six predicates carry the gate", [count(v.definition, "NOT LIKE '%code-anchor: not %'"), count(v.definition, FRAG)]);
ok(JSON.parse(v.definition).steps.find(s => s.name === "unrelated").sql === "SELECT 1 WHERE 'code-anchor' <> ''", "a step outside the predicate is byte for byte unchanged");
ok(JSON.parse(v.definition).steps.find(s => s.name === "lever-request").sql.includes("NOT LIKE '%code-anchor: not %'"), "the request step lets a new request in when the last reply was a non-anchor");

db.exec(stepSql(db, "lever-report")); db.exec(stepSql(db, "lever-mark"));
ok(appended(db, 5001) && appended(db, 5003) && appended(db, 5004), "usable replies are still appended: a real anchor, a CORRECTED TARGET reply, an anchor that begins with the letters not");
ok(!appended(db, 5002) && !appended(db, 5005), "a reply whose code-anchor line starts with not is not appended");
ok(pa(db, 5001) === "reported" && pa(db, 5003) === "reported" && pa(db, 5004) === "reported", "and the usable ones are reported");
ok(pa(db, 5002) === "empty" && pa(db, 5005) === "empty", "the non-anchor replies are marked empty (the request step asks again inside its caps)");

// the stored blocks
ok(!/code-anchor: not /i.test(desc(db, 1000391)) && !/code-anchor: not /i.test(desc(db, 1001373)), "no stored description holds a code-anchor line that starts with not");
ok(!desc(db, 1000391).includes("code-task: repo=") && !desc(db, 1001373).includes("code-task: repo="), "and neither stored block is a task any more (the marker lost its colon)");
ok(desc(db, 1000391).includes("code-task (FM-2: no file, no anchor) repo=qnfo-workers path=qnfo-agents/src/") && desc(db, 1001373).includes("(FM-2: that file does not exist)") && desc(db, 1001373).includes("EDIT: add a migration"), "the text stays readable");
ok(desc(db, 100138).includes("code-task: repo=qnfo-workers path=qnfo-fleet-control/worker.js"), "a stored block with a real anchor is untouched");

// the detector
{
  const probe = db.prepare("SELECT verify_probe p FROM remediation_contracts WHERE class = 'fm-diagnosis-unresolved-anchor'").get().p;
  const r = db.prepare(probe).get();
  ok(String(r.expected) === "1" && String(r.observed) === "1", "fm-diagnosis-unresolved-anchor reads 1 once the stored non-anchors are gone", r);
  ok(db.prepare("SELECT attempts a, last_verdict l FROM remediation_contracts WHERE class = 'fm-diagnosis-unresolved-anchor'").get().l === null, "and is re-armed");
  db.prepare("INSERT INTO agent_issues (id, title, description, status) VALUES (200000, 'X-1: y', 'code-task: repo=qnfo-workers path=a.js\ncode-anchor: NOT VERIFIED - not read', 'open')").run();
  ok(String(db.prepare(probe).get().observed) === "0", "and reads 0 when an open issue stores a non-anchor");
  db.prepare("UPDATE agent_issues SET status = 'closed' WHERE id = 200000").run();
  ok(String(db.prepare(probe).get().observed) === "1", "a closed issue is not counted");
  ok(/C4-FM2-LEVER-NONANCHOR-GATE-1/.test(db.prepare("SELECT detector d FROM failure_modes WHERE fm_key = 'diagnosis-unresolved-anchor'").get().d), "the failure mode names the extended detector");
}

// row 1755 keeps its status, the limit is appended once
{
  const r = db.prepare("SELECT status s, evidence e, verified_at v FROM roadmap_implementation WHERE id = 1755").get();
  ok(r.s === "verified" && r.v === "2026-11-04 23:38:51" && r.e.startsWith("FM-2 live 2026-11-04: the prompt requires the anchor.") && /C4-FM2-LEVER-NONANCHOR-GATE-1/.test(r.e) && /Not built: a file-reading check/.test(r.e), "row 1755 keeps its status and gets the measured limit appended", r.e.slice(0, 120));
}

// idempotent; a concurrent edit writes nothing
{
  const snap = d => JSON.stringify([d.prepare("SELECT version, definition FROM fleet_tasks WHERE id = 'management-personas-c'").get(), d.prepare("SELECT id, description FROM agent_issues ORDER BY id").all(), d.prepare("SELECT evidence FROM roadmap_implementation").all(), d.prepare("SELECT COUNT(*) n FROM decision_log").get(), d.prepare("SELECT COUNT(*) n FROM bak_20261105_c4_fm2").get()]);
  const before = snap(db);
  db.exec(sql);
  ok(snap(db) === before, "a second apply changes nothing");
  const edited = mk();
  edited.prepare("UPDATE fleet_tasks SET definition = replace(definition, ?, 'COALESCE(r.result, '''') LIKE ''%code-anchor:%'' AND COALESCE(r.result, '''') LIKE ''%DIFFERENT%''') WHERE id = 'management-personas-c'").run(FRAG);
  // five of six predicates changed by someone else: the count guard refuses
  const def5 = defOf([{ type: "sql", name: "lever-report", db: "AUDIT", sql: LEVER_REPORT }, { type: "sql", name: "lever-mark", db: "AUDIT", sql: LEVER_MARK }]);
  edited.prepare("UPDATE fleet_tasks SET definition = ? WHERE id = 'management-personas-c'").run(def5);
  ok(count(def5, FRAG) === 5, "fixture: five occurrences", count(def5, FRAG));
  edited.exec(sql);
  const e = edited.prepare("SELECT version, definition FROM fleet_tasks WHERE id = 'management-personas-c'").get();
  ok(e.version === 12 && e.definition === def5, "a task whose predicate does not occur six times is not written");
  ok(!/code-anchor: not /i.test(edited.prepare("SELECT description d FROM agent_issues WHERE id = 1000391").get().d), "(the stored blocks are still fixed)");
}

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
