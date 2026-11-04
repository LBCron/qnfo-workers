// SELF-CHECK-REPAIRS-1 offline suite: replays migrations/2026-11-04-self-check-repairs.sql on node:sqlite.
// Proves: header opts in; contracts parked by the 60-hour probe-error bug are re-armed within 50 minutes and a deliberate long cadence is left alone;
// the deny-paths control gets a probe that reads ok with a recent merged code task and the failure text without one; the two page markers move; a replay changes nothing.
// Output MUST contain "0 failed" on success.   node migrations/self-check-repairs.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("./2026-11-04-self-check-repairs.sql", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };
const header = sql.split("\n").filter((l) => l.startsWith("--"));
ok(header.some((l) => /^-- APPLY-BY: ci\s*$/.test(l)) && header.some((l) => /^-- DB: qnfo-audit\s*$/.test(l)), "header opts in");
ok(header.filter((l) => /^-- Rollback:/.test(l)).length === 1, "one Rollback line");
const body = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
const db = new DatabaseSync(":memory:");
db.exec(`CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, status TEXT, expected_cadence_h INTEGER, next_due_at TEXT, verify_probe TEXT);
CREATE TABLE control_alternate_probes (control TEXT PRIMARY KEY, probe_sql TEXT, window_note TEXT, enabled INTEGER);
CREATE TABLE code_tasks (id INTEGER PRIMARY KEY, status TEXT, updated_at TEXT);
INSERT INTO remediation_contracts VALUES
 ('fm-parked','active',1,datetime('now','+60 hours'),'x'),
 ('fm-soon','active',1,datetime('now','+20 minutes'),'x'),
 ('slow-on-purpose','active',24,datetime('now','+20 hours'),'x'),
 ('rt-page-qwav-home','active',1,datetime('now'),'{"url": "https://qwav.org/", "status": 200, "contains": "QWAV Research Papers"}'),
 ('rt-page-fleet-queue','active',1,datetime('now'),'{"url": "https://fleet.qnfo.org/", "status": 200, "contains": "<title>QNFO fleet status", "max_ms": 15000}');`);
const run = () => db.exec(body);
run();
const q = (s) => db.prepare(s).get();
ok(q("SELECT (julianday(next_due_at) - julianday('now')) * 1440 m FROM remediation_contracts WHERE class='fm-parked'").m < 51, "parked detector re-armed within 50 minutes");
ok(q("SELECT next_due_at > datetime('now','+19 hours') ok FROM remediation_contracts WHERE class='slow-on-purpose'").ok === 1, "a long cadence is left alone");
ok(JSON.parse(q("SELECT verify_probe p FROM remediation_contracts WHERE class='rt-page-qwav-home'").p).contains === "p-adic ultrametric computing", "qwav marker moved");
ok(JSON.parse(q("SELECT verify_probe p FROM remediation_contracts WHERE class='rt-page-fleet-queue'").p).contains === "<title>Fleet</title>", "fleet marker moved");
const probe = q("SELECT probe_sql s FROM control_alternate_probes WHERE control='copilot-pr-approval-deny-paths'").s;
ok(db.prepare(probe).get().observed.startsWith("no code task merged"), "probe fails with no merged task");
db.exec("INSERT INTO code_tasks (status, updated_at) VALUES ('merged', strftime('%Y-%m-%dT%H:%M:%fZ','now'))");
ok(db.prepare(probe).get().observed === "ok", "probe passes with a recent merged task");
const snap = () => JSON.stringify(db.prepare("SELECT class, verify_probe FROM remediation_contracts ORDER BY class").all());
const before = snap();
run();
ok(before === snap(), "replay changes no probe text");
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
