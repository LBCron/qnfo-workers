// migrations/c1-bp26-followups.test.mjs (C1-BP26-FOLLOWUPS-1, roadmap rows 1390, 1391, 1400, 1414): the shape of migrations/2026-11-05-c1-bp26-followups.sql, run against an in-memory
// SQLite with the tables it touches. Proves: the file applies twice without duplicating a row (every insert is guarded), the circular probe of issue 1001912 is replaced by a probe that
// reads the evidence row of the signing key and returns the expected text only when that row says served, each follow-up issue names a doer (code-task, a code-anchor that occurs exactly once in
// the named file, a probe) and a closing probe, and the decision rows exist once.
// Run: node migrations/c1-bp26-followups.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log("FAIL " + n + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 300) : "")); } };

const sql = readFileSync(new URL("./2026-11-05-c1-bp26-followups.sql", import.meta.url), "utf8");
ok("header lines are present", /^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: /m.test(sql));
const body = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
const stmts = body.split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean);

const db = new DatabaseSync(":memory:");
db.exec(`CREATE TABLE remediation_contracts (class TEXT, issue_id INTEGER, verify_probe TEXT, verify_transport TEXT, last_verdict TEXT, next_due_at TEXT);
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain INTEGER, surfaces_tested TEXT, outcome_matched INTEGER);
CREATE TABLE bp26_probe_results (run_at TEXT, metric TEXT, subject TEXT, ok INTEGER, detail TEXT, producer TEXT);`);
db.prepare("INSERT INTO remediation_contracts VALUES ('issue-1001912', 1001912, 'SELECT 1', 'd1-query', 'superseded:closure-observing-probe-at-birth', NULL)").run();
db.prepare("INSERT INTO agent_issues (title, description, status) VALUES ('BP26-PROVENANCE-KEY-1: owner-steps-watch resolves the provenance signing key card when the key document answers 200', 'first line', 'open')").run();

const apply = () => { for (const s of stmts) db.exec(s); };
apply();
apply();
const issues = db.prepare("SELECT title, description, status FROM agent_issues WHERE source LIKE 'bp26-%'").all();
ok("three follow-up issues, each once after two applications", issues.length === 3, issues.map((i) => i.title));
ok("the key issue's text is amended once", db.prepare("SELECT description FROM agent_issues WHERE title LIKE 'BP26-PROVENANCE-KEY-1%'").get().description.split("Update 2026-11-05").length === 2);
ok("each decision row exists once", db.prepare("SELECT COUNT(*) n FROM decision_log WHERE actor = 'session-c1-bp26'").get().n === 2);

for (const i of issues) {
  const m = /code-task: repo=qnfo-workers path=(\S+)\ncode-anchor: ([^\n]+)\ncode-probe: (\{[^\n]+\})/.exec(i.description);
  ok(i.title + " names a doer: code-task, code-anchor and code-probe lines", !!m);
  if (!m) continue;
  const file = readFileSync(new URL("../" + m[1], import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const anchor = m[2].trim();
  ok(i.title + ": the code-anchor occurs exactly once in " + m[1], file.split(anchor).length === 2, file.split(anchor).length - 1);
  ok(i.title + ": the code-probe is JSON with paths and a contains or absent", (() => { try { const j = JSON.parse(m[3]); return Array.isArray(j.paths) && (j.contains || j.absent); } catch (e) { return false; } })());
  ok(i.title + " carries a runtime or code closing probe", /runtime-probe: \{/.test(i.description) || /code-probe: \{/.test(i.description));
}

// the probe that replaces the circular one
const probe = db.prepare("SELECT verify_probe, verify_transport, last_verdict FROM remediation_contracts WHERE issue_id = 1001912").get();
ok("the probe is replaced, the verdict is reset", probe.verify_transport === "d1-query" && probe.last_verdict === null && /bp26_probe_results/.test(probe.verify_probe) && !/FROM agent_issues/.test(probe.verify_probe));
const run = () => db.prepare(probe.verify_probe).get();
ok("no evidence row: unmeasured, not the expected text", run().observed === "unmeasured" && run().expected === "signing key document served");
db.prepare("INSERT INTO bp26_probe_results VALUES ('2026-11-05T01:00:00Z', 'provenance_marking_coverage', 'signing key', 0, 'signing key document NOT served (HTTP 503)', 'x')").run();
ok("key document not served: the observed text differs from the expected one", run().observed !== run().expected && run().observed.startsWith("not served"));
db.prepare("INSERT INTO bp26_probe_results VALUES ('2026-11-05T02:00:00Z', 'provenance_marking_coverage', 'signing key', 1, 'signing key document served (HTTP 200)', 'x')").run();
ok("key document served on the newest run: observed equals expected", run().observed === run().expected);

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
