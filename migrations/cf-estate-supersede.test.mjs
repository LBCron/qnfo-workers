// CF-ESTATE-1 duplicate suite: migrations/2026-11-05-c4-next-infra-supersede-worker-count.sql closes the WORK next-slice issue as a duplicate of WORKER-COUNT-1.1 (1001901),
// supersedes its contract, maps the survivor to QNFO.INFRA.WORK and names it on row 610. Replayed on SQLite with the live column layout.
// Run: node --no-warnings migrations/cf-estate-supersede.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(here, "2026-11-05-c4-next-infra-supersede-worker-count.sql"), "utf8").replace(/\r\n/g, "\n");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 300))); } };
const lines = sql.split("\n");
const hdr = (k) => (lines.find((l) => new RegExp("^-- " + k + ": ").test(l)) || "").replace(new RegExp("^-- " + k + ": "), "");
const body = lines.filter((l) => !l.startsWith("--")).join("\n");
ok(hdr("APPLY-BY") === "ci" && hdr("DB") === "qnfo-audit" && lines.filter((l) => /^-- Rollback: /.test(l)).length === 1, "header: APPLY-BY ci, DB qnfo-audit, one Rollback");
ok(!/^\s*(DELETE|DROP)\b/im.test(body) && !/CREATE\s+TRIGGER/i.test(body), "no DELETE, DROP or trigger");
ok(/superseded by agent_issues 1001901/.test(body), "the close evidence starts with the form the reopen predicate reads: superseded by agent_issues <id>");

const WORK = "ROADMAP-1: QNFO.INFRA.WORK #1: worker_count must not count the tombstone";
const SURV = "ROADMAP-1: QNFO.INFRA WORKER-COUNT-1.1: census tombstone class";
const mk = (survivorStatus = "open") => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, source TEXT, status TEXT)");
  db.exec("CREATE TABLE issue_triage (issue_id INTEGER PRIMARY KEY, triage_state TEXT, close_evidence TEXT)");
  db.exec("CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, status TEXT, last_verdict TEXT, last_attempt_at TEXT)");
  db.exec("CREATE TABLE issue_project_map (issue_id INTEGER PRIMARY KEY, project_code TEXT NOT NULL, program_code TEXT NOT NULL, kind TEXT NOT NULL, updated_at TEXT)");
  db.exec("CREATE TABLE projects (project_code TEXT PRIMARY KEY)");
  db.exec("CREATE TABLE roadmap_implementation (id INTEGER PRIMARY KEY, item TEXT, evidence TEXT)");
  db.exec("CREATE TABLE portfolio_gaps (kind TEXT NOT NULL, entity TEXT NOT NULL, detail TEXT, day TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', resolved_at TEXT, PRIMARY KEY (kind, entity, day))");
  for (const e of ["WORK", "PAGE", "DNS", "D1", "R2"]) db.prepare("INSERT INTO portfolio_gaps (kind, entity, day) VALUES ('no-mapped-work', ?, '2026-11-05')").run("QNFO.INFRA." + e);
  db.exec("INSERT INTO portfolio_gaps (kind, entity, day) VALUES ('no-mapped-work', 'QNFO.OPS.ELSE', '2026-11-05'), ('project-no-owner', 'QNFO.INFRA.WORK', '2026-11-05')");
  for (const [id, e] of [[1001950, "PAGE"]]) db.prepare("INSERT INTO issue_project_map VALUES (?, ?, 'QNFO.INFRA', 'fix', 'then')").run(id, "QNFO.INFRA." + e);
  db.prepare("INSERT INTO agent_issues VALUES (1001932, ?, 'cf-estate-1', 'open')").run(WORK);
  db.prepare("INSERT INTO agent_issues VALUES (1001901, ?, 'x', ?)").run(SURV, survivorStatus);
  db.prepare("INSERT INTO agent_issues VALUES (1001950, 'ROADMAP-1: QNFO.INFRA.PAGE #1: other', 'cf-estate-1', 'open')").run();
  db.exec("INSERT INTO issue_triage VALUES (1001932, 'triaged', NULL), (1001901, 'triaged', NULL), (1001950, 'triaged', NULL)");
  db.exec("INSERT INTO remediation_contracts VALUES ('issue-1001932', 'active', NULL, NULL), ('issue-1001901', 'active', NULL, NULL), ('issue-1001950', 'active', NULL, NULL)");
  db.exec("INSERT INTO issue_project_map VALUES (1001901, 'W.qnfo-fleet-control', 'QNFO.OPS', 'fix', 'then')");
  db.exec("INSERT INTO projects VALUES ('QNFO.INFRA.WORK')");
  db.exec("INSERT INTO roadmap_implementation VALUES (610, 'NEXT-QNFO.INFRA.WORK', 'Deliverable (PR 7413, x).')");
  return db;
};
const db = mk();
db.exec(sql);
const t = (id) => db.prepare("SELECT triage_state, close_evidence FROM issue_triage WHERE issue_id = ?").get(id);
const c = (cl) => db.prepare("SELECT status, last_verdict FROM remediation_contracts WHERE class = ?").get(cl);
ok(t(1001932).triage_state === "closed" && t(1001932).close_evidence.startsWith("superseded by agent_issues 1001901"), "the duplicate is closed with the survivor id");
ok(c("issue-1001932").status === "superseded" && c("issue-1001932").last_verdict === "superseded:issue-1001901", "its contract is superseded");
ok(t(1001901).triage_state === "triaged" && c("issue-1001901").status === "active" && t(1001950).triage_state === "triaged" && c("issue-1001950").status === "active", "the survivor and the other issues are untouched");
const m = db.prepare("SELECT * FROM issue_project_map").get();
ok(m.issue_id === 1001901 && m.project_code === "QNFO.INFRA.WORK" && m.program_code === "QNFO.INFRA", "the survivor is mapped to QNFO.INFRA.WORK");
ok(/Supersede 2026-11-05 \(c4-next\).*1001901/.test(db.prepare("SELECT evidence FROM roadmap_implementation WHERE id = 610").get().evidence), "row 610 names the survivor");
db.exec(sql);
ok((db.prepare("SELECT evidence FROM roadmap_implementation WHERE id = 610").get().evidence.match(/Supersede 2026-11-05/g) || []).length === 1, "a replay appends nothing more");

const gaps = Object.fromEntries(db.prepare("SELECT kind || ':' || entity AS k, status FROM portfolio_gaps").all().map((r) => [r.k, r.status]));
ok(gaps["no-mapped-work:QNFO.INFRA.WORK"] === "closed" && gaps["no-mapped-work:QNFO.INFRA.PAGE"] === "closed", "the gap of a project that now has an open mapped issue is closed (WORK through the survivor, PAGE through its own)", gaps);
ok(gaps["no-mapped-work:QNFO.INFRA.DNS"] === "open" && gaps["no-mapped-work:QNFO.INFRA.D1"] === "open" && gaps["no-mapped-work:QNFO.INFRA.R2"] === "open", "a gap stays open while the project has no open mapped issue (these three have none in the fixture)", gaps);
ok(gaps["no-mapped-work:QNFO.OPS.ELSE"] === "open" && gaps["project-no-owner:QNFO.INFRA.WORK"] === "open", "another project and another gap kind are untouched", gaps);

const closed = mk("closed");
closed.exec(sql);
ok(closed.prepare("SELECT triage_state FROM issue_triage WHERE issue_id = 1001932").get().triage_state === "triaged" && closed.prepare("SELECT project_code FROM issue_project_map WHERE issue_id = 1001901").get().project_code === "W.qnfo-fleet-control", "nothing happens while the survivor is not open (never close a duplicate in favour of a closed issue)");

db.exec(hdr("Rollback"));
ok(t(1001932).triage_state === "triaged" && t(1001932).close_evidence === null && c("issue-1001932").status === "active" && c("issue-1001932").last_verdict === null, "the Rollback reopens the triage row and the contract");
ok(db.prepare("SELECT project_code FROM issue_project_map WHERE issue_id = 1001901").get().project_code === "W.qnfo-fleet-control" && db.prepare("SELECT evidence FROM roadmap_implementation WHERE id = 610").get().evidence === "Deliverable (PR 7413, x).", "the Rollback restores the mapping and the row text");
ok(db.prepare("SELECT status FROM portfolio_gaps WHERE entity = 'QNFO.INFRA.WORK' AND kind = 'no-mapped-work'").get().status === "open", "the Rollback reopens the gaps");
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
