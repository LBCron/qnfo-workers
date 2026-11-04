// ISSUE-1001566 offline suite: the issue's contract measures the CF-OBS six-hour bar (no open CF-OBS probe passes on the resolved status alone, the birth trigger needs the six-hour reading).
// Run: node --no-warnings migrations/issue-1001566-cf-obs-bar.test.mjs   (exit 0 = all passed)
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const sql = readFileSync(new URL("./2026-11-04-issue-1001566-cf-obs-bar.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? "  -- " + JSON.stringify(x).slice(0, 400) : "")); } };
ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: .+/m.test(sql), "migration opts in with APPLY-BY, DB and Rollback headers");

const OLD = "SELECT '1' AS expected, CASE WHEN EXISTS (SELECT 1 FROM dispatch WHERE state = 'resolved' OR (state <> 'resolved' AND json_valid(payload) AND x > 0)) THEN '1' ELSE '0' END AS observed";
const NEW = "SELECT '1' AS expected, CASE WHEN EXISTS (SELECT 1 FROM dispatch WHERE (state = 'resolved' AND NOT (json_valid(payload) AND y > 0)) OR (json_valid(payload) AND x > 0)) THEN '1' ELSE '0' END AS observed";
const db = new DatabaseSync(":memory:");
db.exec(`
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, status TEXT, description TEXT, updated_at INTEGER);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT, status TEXT, module TEXT, attempts INTEGER, last_verdict TEXT, next_due_at TEXT, expected_cadence_h INTEGER);
CREATE TABLE t (x);
INSERT INTO agent_issues VALUES (1001566, 'Issue #1001505 closed early', 'open', 'base', 0), (11, 'CF-OBS-ISSUE-1: a', 'open', '', 0), (12, 'CF-OBS-ISSUE-1: b', 'closed', '', 0);
INSERT INTO remediation_contracts (class, issue_id, verify_probe, verify_transport, status, module, last_verdict) VALUES ('issue-1001566', 1001566, 'SELECT 1', 'd1-query', 'superseded', 'probe-template-v3-generic', 'superseded:probe-unusable');
`);
const setTemplate = (body) => { db.exec("DROP TRIGGER IF EXISTS contract_probe_templates_family_birth"); db.exec("CREATE TRIGGER contract_probe_templates_family_birth AFTER INSERT ON t BEGIN SELECT '" + body.replace(/'/g, "''") + "'; END"); };
const contract = (cls, issue, probe) => db.prepare("INSERT OR REPLACE INTO remediation_contracts (class, issue_id, verify_probe, verify_transport, status, module) VALUES (?, ?, ?, 'd1-query', 'active', 'issue-birth-probe-families')").run(cls, issue, probe);

setTemplate("state = 'resolved' OR (state <> 'resolved' AND json_valid(payload) AND");
contract("issue-11", 11, OLD);
db.exec(sql);
const c = db.prepare("SELECT * FROM remediation_contracts WHERE class = 'issue-1001566'").get();
ok(c.status === "active" && c.module === "cf-obs-six-hour-bar" && c.verify_transport === "d1-query" && !c.verify_probe.includes(";"), "the issue's contract is active on a probe without a semicolon", c);
let r = db.prepare(c.verify_probe).get();
ok(r.expected === "0" && r.observed === "2", "before the fix: one open old probe plus the old template read 2", r);

setTemplate("(state = 'resolved' AND NOT (json_valid(payload) AND y > 0)) OR (json_valid(payload) AND");
r = db.prepare(c.verify_probe).get();
ok(r.observed === "1", "template fixed, an open contract still old: reads 1", r);
contract("issue-11", 11, NEW);
contract("issue-12", 12, OLD);   // closed issue with the old probe is outside this probe
r = db.prepare(c.verify_probe).get();
ok(r.observed === "0", "template fixed, open contract tightened, a closed issue's old probe ignored: reads 0", r);
db.exec("DROP TRIGGER contract_probe_templates_family_birth");
r = db.prepare(c.verify_probe).get();
ok(r.observed === "1", "no birth trigger at all reads 1 (cannot pass vacuously)", r);

ok(db.prepare("SELECT description d FROM agent_issues WHERE id = 1001566").get().d.includes("ISSUE-1001566 migration"), "the answer is appended to the issue");
db.exec(sql);
ok(db.prepare("SELECT description d FROM agent_issues WHERE id = 1001566").get().d.split("ISSUE-1001566 migration").length === 2, "re-applying appends once");

console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
