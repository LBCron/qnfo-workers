// OWNER-SECURITY-CLUSTER-2 offline suite (migrations/2026-11-05-g-owner-misc-2.sql). Run: node migrations/g-owner-misc-2.test.mjs
// Checks: the owner card and its setting probe, the 1001749 probe swap, the six supersessions (only while the parent is open), the triage notes, the backups, and idempotence.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

let fail = 0;
const ok_ = (c, m, x) => { if (!c) { fail++; console.log("FAIL " + m + (x === undefined ? "" : " :: " + JSON.stringify(x))); } };
const sql = readFileSync(new URL("./2026-11-05-g-owner-misc-2.sql", import.meta.url), "utf8");

const SCHEMA = `
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, status TEXT, close_channel TEXT);
CREATE TABLE issue_triage (issue_id INTEGER PRIMARY KEY, triage_state TEXT, close_evidence TEXT, remediation TEXT);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER, escalate_to TEXT, expected_cadence_h INTEGER, status TEXT, last_verdict TEXT, attempts INTEGER, module TEXT, next_due_at TEXT);
CREATE TABLE human_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT, title TEXT, why TEXT, default_in_effect TEXT, action TEXT, url TEXT, sev TEXT, status TEXT, source TEXT, created_at TEXT, updated_at TEXT, resolution TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT, outcome_matched INTEGER);
`;
const TICKETS = { 1000751: 1000652, 1000754: 1000019, 1000972: 99909, 1000995: 100226, 1001426: 1000598, 1001577: 1000744 };
const PARENTS = [1000652, 1000019, 99909, 100226, 1000598, 1000744];
const OTHER_TRIAGE = [1000941];
const LEDGER_PROBE = "SELECT 'ok' AS expected, 'ok' AS observed -- ledger_open_questions";
function fresh(parentStatus) {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  const ins = db.prepare("INSERT INTO agent_issues VALUES (?, ?, ?, NULL)");
  const tri = db.prepare("INSERT INTO issue_triage VALUES (?, 'triaged', NULL, NULL)");
  const con = db.prepare("INSERT INTO remediation_contracts (class, issue_id, verify_probe, verify_transport, status, last_verdict, attempts) VALUES (?, ?, 'OLD', 'd1-query', ?, ?, 4)");
  for (const [t, p] of Object.entries(TICKETS)) { ins.run(Number(t), "ticket " + t, "open"); tri.run(Number(t)); con.run("issue-" + t, Number(t), t === "1001426" ? "deferred" : "active", "fail"); ins.run(p, "parent " + p, parentStatus); tri.run(p); }
  for (const id of OTHER_TRIAGE) { ins.run(id, "card " + id, "open"); tri.run(id); }
  ins.run(1001749, "handback", "open");
  con.run("issue-1001749", 1001749, "superseded", "superseded:closure-observing-probe-at-birth (CLOSE-PROBE-CIRCULAR-1: x)");
  db.prepare("INSERT INTO remediation_contracts (class, verify_probe, verify_transport, status) VALUES ('owner-card-jobsearch-ledger', ?, 'd1-query', 'active')").run(LEDGER_PROBE);
  return db;
}
const db = fresh("open");
db.exec(sql);
const st = (id) => db.prepare("SELECT a.status, a.close_channel, t.triage_state, t.close_evidence, t.remediation FROM agent_issues a JOIN issue_triage t ON t.issue_id = a.id WHERE a.id = ?").get(id);
const ct = (cls) => db.prepare("SELECT status, last_verdict, verify_probe, attempts FROM remediation_contracts WHERE class = ?").get(cls);

for (const [t, p] of Object.entries(TICKETS)) {
  const s = st(Number(t)), c = ct("issue-" + t);
  ok_(c.status === "superseded" && c.last_verdict.endsWith("agent_issues " + p), t + ": contract superseded by " + p, c);
  ok_(s.triage_state === "closed" && s.close_evidence.startsWith("superseded by agent_issues " + p + " "), t + ": triage closes naming the parent " + p, s.close_evidence);
  ok_(s.close_channel === "session:G-owner-security", t + ": close channel names the session");
}
for (const p of PARENTS) ok_(/OWNER-SECURITY-CLUSTER-2 2026-11-05/.test(st(p).remediation) && st(p).triage_state === "triaged", p + ": parent keeps the work and carries what blocks it");
ok_(/verification done/.test(st(1000941).remediation) && st(1000941).triage_state === "triaged", "1000941 stays open with its measured status");

// owner card + setting probe
const card = db.prepare("SELECT * FROM human_actions WHERE slug = 'dotgithub-enable-pull-requests'").get();
ok_(!!card && card.status === "open" && /^IDENTITY-BOUND: /.test(card.why) && !/claude/i.test(card.why + card.action + card.title), "the owner card is open, IDENTITY-BOUND and routes nothing to Claude", card && card.why.slice(0, 40));
const pc = ct("owner-card-dotgithub-pull-requests");
ok_(pc.status === "active", "the setting probe contract is active");
const pj = JSON.parse(pc.verify_probe);
ok_(pj.url === "https://api.github.com/repos/QNFO/.github" && pj.status === 200 && pj.contains === '"has_pull_requests": true', "the probe reads the repository setting", pj);
ok_(db.prepare("SELECT transport FROM (SELECT verify_transport AS transport FROM remediation_contracts WHERE class = 'owner-card-dotgithub-pull-requests')").get().transport === "runner-https", "the probe runs from the runner (a host outside the account)");

// 1001749 probe swap
const c9 = ct("issue-1001749");
ok_(c9.status === "active" && c9.verify_probe === LEDGER_PROBE && c9.attempts === 0, "1001749 carries the ledger probe again", c9);

// backups
ok_(db.prepare("SELECT COUNT(*) n FROM bak_20261105_g_owner_misc WHERE kind = 'contract'").get().n === 7, "seven contracts are backed up");
ok_(db.prepare("SELECT COUNT(*) n FROM bak_20261105_g_owner_misc WHERE kind = 'triage'").get().n === 13, "thirteen triage rows are backed up");

// second run changes nothing
const count = (d) => JSON.stringify([d.prepare("SELECT COUNT(*) n FROM human_actions").get().n, d.prepare("SELECT COUNT(*) n FROM decision_log").get().n, d.prepare("SELECT COUNT(*) n FROM remediation_contracts").get().n, d.prepare("SELECT COUNT(*) n FROM bak_20261105_g_owner_misc").get().n]);
const before = count(db); db.exec(sql);
ok_(before === count(db) && before.startsWith("[1,1,"), "a second run writes no second card, decision, contract or backup row", { before, after: count(db) });

// a closed parent blocks the supersession
const db2 = fresh("closed"); db2.exec(sql);
for (const t of Object.keys(TICKETS)) {
  const r = db2.prepare("SELECT t.triage_state, c.status FROM issue_triage t JOIN remediation_contracts c ON c.issue_id = t.issue_id WHERE t.issue_id = ?").get(Number(t));
  ok_(r.triage_state === "triaged" && r.status !== "superseded", t + ": not superseded while its parent is closed", r);
}

ok_(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: /m.test(sql), "migration header lines");
ok_(!/\bDELETE\s+FROM\b|\bDROP\b/i.test(sql.split("\n").filter((l) => !l.startsWith("--")).join("\n")), "the file body deletes and drops nothing");
console.log(fail ? fail + " failed" : "all passed");
process.exit(fail ? 1 : 0);
