// B-GOVERNANCE-1 offline suite: migrations/2026-11-05-b-governance-roadmap-verified.sql verifies five roadmap rows with their readings and gives issue 1001566 a probe on the OUTCOME (a CF-OBS
// issue closed by the verification trigger after the fix with its group seen inside the six hours before the close). The probe must read 0 when every close met the bar, 1 for a close short of it,
// ignore closes made before the fix and by other channels, and never pass on a missing dispatch row (the join is the evidence).
// Run: node --no-warnings migrations/b-governance-roadmap-verified.test.mjs   (exit 0 = all passed)
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const sql = readFileSync(new URL("./2026-11-05-b-governance-roadmap-verified.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? "  -- " + JSON.stringify(x).slice(0, 400) : "")); } };
ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: .+/m.test(sql), "migration opts in with APPLY-BY, DB and Rollback headers");

const db = new DatabaseSync(":memory:");
db.exec(`
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, status TEXT, close_channel TEXT, updated_at INTEGER, description TEXT);
CREATE TABLE fleet_issue_dispatch (fingerprint TEXT PRIMARY KEY, payload TEXT);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT, status TEXT, module TEXT, attempts INTEGER, last_verdict TEXT, next_due_at TEXT, expected_cadence_h INTEGER, deferred_since TEXT);
CREATE TABLE roadmap_implementation (id INTEGER PRIMARY KEY, item TEXT, source TEXT, status TEXT, evidence TEXT, verified_at TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY, actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
INSERT INTO agent_issues (id, title, status, description) VALUES (1001566, 'Issue #1001505 closed 2h35m after last occurrence', 'open', '');
INSERT INTO remediation_contracts (class, issue_id, verify_probe, verify_transport, status, module, last_verdict) VALUES ('issue-1001566', 1001566, 'SELECT 1', 'd1-query', 'probe-review-refused', 'cf-obs-six-hour-bar', 'probe-review-refused');
INSERT INTO roadmap_implementation (id, item, source, status) VALUES (1754, 'FM-1', 'failure-modes-2026', 'planned'), (1755, 'FM-2', 'failure-modes-2026', 'planned'), (1758, 'FM-5', 'failure-modes-2026', 'planned'),
  (1704, 'RM-D1-RESTORE-DRILL-1', 'scout-2026-10-closeout', 'planned'), (1701, 'RM-POSTMORTEM-LEDGER-1', 'scout-2026-10-closeout', 'planned'), (1756, 'FM-3', 'failure-modes-2026', 'planned'), (1757, 'FM-4', 'failure-modes-2026', 'planned');
`);
db.exec(sql);

const rows = Object.fromEntries(db.prepare("SELECT id, status, evidence, verified_at FROM roadmap_implementation").all().map((r) => [r.id, r]));
for (const id of [1754, 1755, 1758, 1704, 1701]) ok(rows[id].status === "verified" && rows[id].evidence.length > 120 && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(rows[id].verified_at), "row " + id + " is verified with a reading and a datetime", rows[id]);
ok(rows[1756].status === "planned" && rows[1757].status === "planned", "FM-3 and FM-4 (other clusters' rows) are untouched", [rows[1756], rows[1757]]);

const c = db.prepare("SELECT * FROM remediation_contracts WHERE class = 'issue-1001566'").get();
ok(c.status === "active" && c.verify_transport === "d1-query" && c.module === "cf-obs-six-hour-bar-outcome" && !c.verify_probe.includes(";") && c.last_verdict === null, "the contract is active on a d1-query probe without a semicolon", c);

const FIX = 1793811970000, H = 3600000, fp = (u) => "cf-obs-" + u;
const issue = (id, uuid, status, channel, closedAt) => db.prepare("INSERT INTO agent_issues (id, title, status, close_channel, updated_at) VALUES (?, ?, ?, ?, ?)").run(id, "CF-OBS-ISSUE-1: svc: err [cf-obs:" + uuid + "]", status, channel, closedAt);
const group = (uuid, lastObserved) => db.prepare("INSERT INTO fleet_issue_dispatch (fingerprint, payload) VALUES (?, ?)").run(fp(uuid), JSON.stringify({ lastObserved }));
const u = (n) => "00000000-0000-0000-0000-" + String(n).padStart(12, "0");
const read = () => db.prepare(c.verify_probe).get();

let r = read();
ok(r.expected === "0" && r.observed === "0", "no CF-OBS close at all reads 0 (the probe is a count of violations)", r);

issue(1002001, u(1), "closed", "auto:verified-remediation-trigger", FIX + 10 * H); group(u(1), FIX + 10 * H - 8 * H);          // quiet 8 h: meets the bar
issue(1002002, u(2), "closed", "auto:verified-remediation-trigger", FIX + 12 * H); group(u(2), FIX + 12 * H - 21 * H);         // quiet 21 h
r = read();
ok(r.observed === "0", "closes after the fix with 8 and 21 quiet hours read 0", r);

issue(1002003, u(3), "closed", "auto:verified-remediation-trigger", FIX + 14 * H); group(u(3), FIX + 14 * H - 2 * H);          // quiet 2 h: short of the bar
r = read();
ok(r.observed === "1", "a close after the fix with the group seen 2 hours earlier reads 1 (falsifiable)", r);

issue(1002004, u(4), "closed", "auto:verified-remediation-trigger", FIX - 2 * H); group(u(4), FIX - 2 * H - 1 * H);            // before the fix: history, not this fix
issue(1002005, u(5), "closed", "workflow:ISSUE-HYGIENE-1 d1-overload-superseded", FIX + 15 * H); group(u(5), FIX + 15 * H - 1 * H); // another channel: not the trigger's bar
issue(1002006, u(6), "open", "auto:verified-remediation-trigger", FIX + 16 * H); group(u(6), FIX + 16 * H - 1 * H);            // reopened since: not closed
issue(1002007, u(7), "closed", "auto:verified-remediation-trigger", FIX + 17 * H); group(u(7), FIX + 17 * H + 3 * H);          // seen again after the close: a relapse, another measure
issue(1002008, u(8), "closed", "auto:verified-remediation-trigger", FIX + 18 * H);                                             // no dispatch row: the join gives no evidence either way
db.prepare("INSERT INTO agent_issues (id, title, status, close_channel, updated_at) VALUES (1002009, 'METRIC-UNMEASURED-1: x [cf-obs:" + u(9) + "]', 'closed', 'auto:verified-remediation-trigger', ?)").run(FIX + 19 * H);
group(u(9), FIX + 19 * H - 1 * H);                                                                                           // another family
r = read();
ok(r.observed === "1", "closes before the fix, by another channel, reopened, relapsed, without a dispatch row or of another family do not count", r);

db.exec(sql);
ok(db.prepare("SELECT COUNT(*) n FROM decision_log WHERE actor = 'session:B-governance-code'").get().n === 1, "re-applying writes one decision_log row");
ok(db.prepare("SELECT verify_probe FROM remediation_contracts WHERE class = 'issue-1001566'").get().verify_probe === c.verify_probe, "re-applying leaves the probe unchanged");

console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
