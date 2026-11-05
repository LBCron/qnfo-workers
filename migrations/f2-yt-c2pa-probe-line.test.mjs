// F2 follow-up (migrations/2026-11-05-f2-yt-c2pa-probe-line.sql) offline suite on SQLite: the YT-C2PA-1 issue gains its probe line once, its contract is a code-read
// on render.py that parses as JSON, a replay changes nothing, and a closed or different issue is left alone. Run: node migrations/f2-yt-c2pa-probe-line.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("./2026-11-05-f2-yt-c2pa-probe-line.sql", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 300))); } };
const hdr = sql.split(/\r?\n/).filter((l) => l.startsWith("--"));
ok(hdr.some((l) => l === "-- APPLY-BY: ci") && hdr.some((l) => l === "-- DB: qnfo-audit") && hdr.some((l) => l.startsWith("-- Rollback: ")), "header lines");

const fresh = (status, title = "YT-C2PA-1: sign a C2PA manifest into every Short (remainder of YT-13)") => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, description TEXT, status TEXT, updated_at INTEGER);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER, escalate_to TEXT, expected_cadence_h REAL, status TEXT, module TEXT, next_due_at TEXT);`);
  db.prepare("INSERT INTO agent_issues (id, title, description, status) VALUES (1001965, ?, 'Charter pillar: security. Definition of done: render.py names c2pa.', ?)").run(title, status);
  db.prepare("INSERT INTO remediation_contracts (class, issue_id, verify_probe, verify_transport, status) VALUES ('issue-1001965', 1001965, 'SELECT 1', 'd1-query', 'superseded')").run();
  return db;
};
{
  const db = fresh("open");
  db.exec(sql);
  const issue = db.prepare("SELECT description FROM agent_issues WHERE id = 1001965").get();
  ok(/\ncode-probe: \{"paths": \["qnfo-youtube-shorts\/container\/render\.py"\], "contains": "c2pa"\}$/.test(issue.description), "the issue gains the probe line", issue.description);
  const c = db.prepare("SELECT * FROM remediation_contracts WHERE class = 'issue-1001965'").get();
  const probe = JSON.parse(c.verify_probe);
  ok(c.verify_transport === "code-read" && c.status === "active" && probe.paths[0] === "qnfo-youtube-shorts/container/render.py" && probe.contains === "c2pa", "the contract is an active code-read on render.py", c);
  const once = db.prepare("SELECT description FROM agent_issues WHERE id = 1001965").get().description;
  db.exec(sql);
  ok(db.prepare("SELECT description FROM agent_issues WHERE id = 1001965").get().description === once && db.prepare("SELECT COUNT(*) n FROM remediation_contracts").get().n === 1, "a replay changes nothing");
}
{
  const db = fresh("closed");
  db.exec(sql);
  ok(db.prepare("SELECT description FROM agent_issues WHERE id = 1001965").get().description === "Charter pillar: security. Definition of done: render.py names c2pa." && db.prepare("SELECT status FROM remediation_contracts").get().status === "superseded", "a closed issue is left alone");
  const other = fresh("open", "SOMETHING ELSE: another issue with that id");
  other.exec(sql);
  ok(other.prepare("SELECT status FROM remediation_contracts").get().status === "superseded", "a different title is left alone");
}
console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
