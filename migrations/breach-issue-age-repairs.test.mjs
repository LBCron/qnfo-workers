import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const here = (p) => new URL(p, import.meta.url);
const sql = readFileSync(here("./2026-11-02-breach-issue-age-repairs.sql"), "utf8");
const engineTest = readFileSync(here("../qnfo-fleet-control/breach-doctor.test.mjs"), "utf8");
const base = readFileSync(here("./2026-10-26-breach-doctor.sql"), "utf8");
const fix = readFileSync(here("./2026-10-26-breach-doctor-fix.sql"), "utf8");
const worker = readFileSync(here("../qnfo-fleet-control/worker.js"), "utf8");
const ddlStart = engineTest.indexOf("const BASE_DDL = `") + "const BASE_DDL = `".length;
const ddlEnd = engineTest.indexOf("`;", ddlStart);
const ddl = engineTest.slice(ddlStart, ddlEnd);
const A = "// ---- BREACH-DOCTOR-1:BEGIN ----", B = "// ---- BREACH-DOCTOR-1:END ----";
const start = worker.indexOf(A), end = worker.indexOf(B);
const kw = worker.match(/^var __RT_WRITE_KW = \[[^\]]*\];$/m)?.[0];
const block = worker.slice(start, end);
const cx = vm.createContext({ Date, Number, String, parseInt, Math, JSON, Object, Array, RegExp, Error, Promise, isFinite, console: { error() {}, log() {} }, VERSION: "0.55.0-test", crypto: globalThis.crypto, TextEncoder, Uint8Array });
vm.runInContext(kw + "\n" + block + "\nthis.api = { breachDoctorTick, bdValidateRule };", cx);
const api = cx.api;
const db = new DatabaseSync(":memory:");
db.exec(ddl);
db.exec(base);
db.exec(fix);
db.exec(`CREATE VIEW v_issue_age_ladder AS
  SELECT a.id, CASE
    WHEN instr(COALESCE(a.description, ''), 'code-task:') > 0 THEN 'code-task line'
    WHEN EXISTS (SELECT 1 FROM code_tasks k WHERE k.goal LIKE '[issue #' || a.id || ']%' AND k.status NOT IN ('failed', 'closed', 'superseded', 'needs_human')) THEN 'live code task'
    WHEN EXISTS (SELECT 1 FROM work_claims w WHERE (w.issue_id = a.id OR w.path = 'issue:' || a.id) AND w.released_at IS NULL AND w.expires_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) THEN 'live work claim'
    WHEN EXISTS (SELECT 1 FROM breach_diagnoses d WHERE d.issue_id = a.id AND d.mode = 'on' AND d.state IN ('queued', 'applied', 'verifying') AND d.lease_until > strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) THEN 'breach doctor'
  END AS doer FROM agent_issues a WHERE a.status = 'open';`);
db.exec(sql);

let failures = 0;
const ok = (condition, name, data) => {
  if (!condition) {
    failures++;
    console.log("FAIL " + name + (data === undefined ? "" : " :: " + JSON.stringify(data)));
  }
};
const rule = db.prepare("SELECT * FROM breach_playbooks WHERE rule_id = 'IAR-R1-live-doer'").get();
ok(start >= 0 && end > start && kw, "production doctor engine was extracted");
ok(rule && api.bdValidateRule(rule).ok, "playbook validates in the production engine", rule && api.bdValidateRule(rule));
ok(rule?.family === "other" && rule?.cause_class === "age-repair-live-doer" && rule?.mode === "on", "playbook covers only the specific generated notice subset", rule);

const age = Date.now() - 3 * 3600000;
function issue(id, title, source = "qnfo-fleet-control") {
  db.prepare("INSERT INTO agent_issues (id,title,source,priority,status,created_at,updated_at) VALUES (?,?,?,'high','open',?,?)").run(id, title, source, age, Date.now());
  db.prepare("INSERT INTO issue_triage (issue_id,rc,triage_state,owner,sla_due_at) VALUES (?,'AUTOTRIAGE-1','triaged','qnfo-ops','2026-10-01')").run(id);
}
issue(880000, "PARENT-1: active work");
issue(880001, "ISSUE-AGE-24H-REPAIR-1: issue #880000 has no live doer");
issue(880002, "PARENT-2: no live doer");
issue(880003, "ISSUE-AGE-24H-REPAIR-1: issue #880002 has no live doer");
issue(880004, "PARENT-3: wrong source");
issue(880005, "ISSUE-AGE-24H-REPAIR-1: issue #880004 has no live doer", "other-source");
db.prepare("INSERT INTO work_claims (path,intent,holder,issue_id,expires_at) VALUES ('issue:880000','test','test',880000,'2099-01-01T00:00:00Z')").run();
db.prepare("UPDATE breach_playbooks SET created_at = strftime('%Y-%m-%dT%H:%M:%SZ','now','-90 minutes')").run();

const stmt = (query) => {
  let args = [];
  const self = {
    bind(...values) { args = values; return self; },
    async all() { return { results: db.prepare(query).all(...args) }; },
    async first() { return db.prepare(query).get(...args) ?? null; },
    async run() { const result = db.prepare(query).run(...args); return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }; }
  };
  return self;
};
const auditDb = { prepare: stmt, async batch(statements) { db.exec("BEGIN"); try { const result = []; for (const statement of statements) result.push(await statement.run()); db.exec("COMMIT"); return result; } catch (error) { db.exec("ROLLBACK"); throw error; } } };
async function tick() { return api.breachDoctorTick({ AUDIT_DB: auditDb }, {}); }
await tick();
await tick();
await tick();
const status = (id) => db.prepare("SELECT status FROM agent_issues WHERE id = ?").get(id)?.status;
const diagnosis = (id) => db.prepare("SELECT cause_class,state FROM breach_diagnoses WHERE issue_id = ? ORDER BY id DESC LIMIT 1").get(id);
ok(status(880001) === "closed", "a notice closes after its target gains a live doer", status(880001));
ok(status(880000) === "open", "the target issue remains open", status(880000));
ok(status(880003) === "open", "a target without a live doer is not closed", status(880003));
ok(status(880005) === "open", "a similarly titled issue from another source is not closed", status(880005));
ok(diagnosis(880001)?.cause_class === "age-repair-live-doer" && diagnosis(880001)?.state === "verified", "the doctor verifies the action", diagnosis(880001));
ok(diagnosis(880003)?.cause_class === "unclassified", "the unmatched notice remains unclassified", diagnosis(880003));
const probe = db.prepare(db.prepare("SELECT verify_probe FROM remediation_contracts WHERE class = 'fm-breach-age-repair-live-doer'").get().verify_probe).get();
ok(probe?.expected === "0" && probe?.observed === "0", "the detector probe clears after the eligible notice is remediated", probe);

for (const statement of JSON.parse(rule.revert_sql)) db.prepare(statement).run(880001);
ok(status(880001) === "open" && status(880000) === "open", "the playbook revert restores the notice without changing its target", [status(880001), status(880000)]);

const body = sql.split("\n").filter((line) => !line.startsWith("--")).join("\n");
ok(!/\b(DELETE\s+FROM|DROP\s+(TABLE|INDEX|VIEW|TRIGGER))\b/i.test(body), "the migration adds no destructive statements");
ok(db.prepare("SELECT COUNT(*) AS n FROM decision_log WHERE action LIKE 'BREACH-ISSUE-AGE-REPAIR-1:%'").get().n === 1, "one decision record is written");
console.log(failures ? failures + " failed" : "all passed");
process.exit(failures ? 1 : 0);
