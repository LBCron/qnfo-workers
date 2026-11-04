// CLOSED-LOOPS-1 offline suite: replays migrations/2026-11-04-closed-loops.sql and runs the detector probe against fixtures.
// Run: node migrations/closed-loops.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("./2026-11-04-closed-loops.sql", import.meta.url), "utf8");
let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log("FAIL " + m); } };
const d = new DatabaseSync(":memory:");
d.exec(`CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT);
  CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT NOT NULL, root_cause TEXT NOT NULL, remediation TEXT NOT NULL, detector TEXT NOT NULL, probe_class TEXT, first_seen TEXT NOT NULL, issue_id INTEGER, trigger_condition TEXT, symptom TEXT, blast_radius TEXT);
  CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER, escalate_to TEXT, expected_cadence_h INTEGER, status TEXT, module TEXT, next_due_at TEXT);
  CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
  CREATE TABLE issue_triage (issue_id INTEGER, triage_state TEXT, close_evidence TEXT, triaged_at TEXT);
  CREATE TABLE v_issue_age_ladder (id INTEGER, doer TEXT, age_h REAL);`);
const probe = () => { d.exec(sql); const p = d.prepare("SELECT verify_probe FROM remediation_contracts WHERE class = 'fm-open-loops-unclosed'").get().verify_probe; return Number(d.prepare(p).get().observed); };
d.exec("INSERT INTO v_issue_age_ladder VALUES (1, NULL, 5), (2, 'live code task', 5), (3, NULL, 0.5)");
const now = new Date().toISOString();
d.prepare("INSERT INTO issue_triage VALUES (9, 'closed', '', ?), (10, 'closed', 'live: metric 0', ?)").run(now, now);
ok(probe() === 2, "one doerless old issue plus one evidence-less close counted");
d.exec("UPDATE v_issue_age_ladder SET doer = 'live work claim' WHERE id = 1; UPDATE issue_triage SET close_evidence = 'x' WHERE issue_id = 9");
ok(probe() === 0, "zero once doer and evidence exist");
d.exec(sql);
ok(d.prepare("SELECT COUNT(*) n FROM failure_modes").get().n === 1 && d.prepare("SELECT COUNT(*) n FROM decision_log").get().n === 1, "idempotent");
if (fail) process.exit(1); console.log("closed-loops ok");
