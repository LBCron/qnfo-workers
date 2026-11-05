// CF-ESTATE-1 offline suite: migrations/2026-11-04-c4-next-infra-roadmap-closeout.sql (roadmap rows 610 to 614, NEXT-QNFO.INFRA.WORK, PAGE, DNS, D1, R2).
// Applies the file on SQLite (node:sqlite) against a fixture with the live column layout and proves: the header (APPLY-BY ci, DB qnfo-audit, one single-line Rollback, a BACKUP
// table created before anything changes, no DELETE or DROP in the body); five open issues, one per project, each with the code-task, code-anchor and code-probe lines the code
// loop reads (the paths exist; no assertion pins the anchor text or the absence of the probe text, because the doer changes both); five issue_project_map rows on the right
// QNFO.INFRA.* project (the join portfolio-execute reads); rows 610 to 614 become partial with the mapped issue id in the evidence, and a row that is no longer planned is left
// alone; a replay changes nothing; the Rollback restores the rows and removes only what the file filed.
// Run: node --no-warnings migrations/cf-estate-closeout.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const sql = readFileSync(join(here, "2026-11-04-c4-next-infra-roadmap-closeout.sql"), "utf8").replace(/\r\n/g, "\n");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 300))); } };

const lines = sql.split("\n");
const hdr = (k) => (lines.find((l) => new RegExp("^-- " + k + ": ").test(l)) || "").replace(new RegExp("^-- " + k + ": "), "");
const body = lines.filter((l) => !l.startsWith("--")).join("\n");
ok(hdr("APPLY-BY") === "ci" && hdr("DB") === "qnfo-audit", "the file opts in with APPLY-BY: ci and DB: qnfo-audit");
ok(lines.filter((l) => /^-- Rollback: /.test(l)).length === 1 && hdr("Rollback").length > 100, "one single-line Rollback");
ok(hdr("BACKUP") === "bak_20261105_c4_next_infra" && /CREATE TABLE IF NOT EXISTS bak_20261105_c4_next_infra/.test(body), "the BACKUP table is created by the file");
ok(!/^\s*(DELETE|DROP)\b/im.test(body), "no statement of the body is a DELETE or a DROP (the Rollback comment has them; the words appear in issue prose only)");
ok(!/CREATE\s+TRIGGER/i.test(body), "no trigger is added (AGENT-ISSUES-TRIGGER-DEPTH-1)");
ok(!/PR_NUMBER/.test(sql), "the PR number placeholder was replaced");
ok(!/claude\.ai|anthropic\.com/i.test(sql), "no claude.ai or anthropic.com link");

const ROWS = [[610, "WORK"], [611, "PAGE"], [612, "DNS"], [613, "D1"], [614, "R2"]];
const mk = () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at TEXT, updated_at TEXT)");
  db.exec("CREATE TABLE issue_project_map (issue_id INTEGER PRIMARY KEY, project_code TEXT NOT NULL, program_code TEXT NOT NULL, kind TEXT NOT NULL, synced_milestone INTEGER, synced_labels TEXT, gh_node TEXT, gh_item TEXT, updated_at TEXT, synced_at TEXT)");
  db.exec("CREATE TABLE projects (project_code TEXT PRIMARY KEY, program_code TEXT, name TEXT, status TEXT)");
  db.exec("CREATE TABLE roadmap_implementation (id INTEGER PRIMARY KEY, item TEXT, source TEXT, status TEXT, evidence TEXT, verified_at TEXT)");
  db.exec("CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT, outcome_matched INTEGER)");
  for (const [id, k] of ROWS) {
    db.prepare("INSERT INTO projects VALUES (?, 'QNFO.INFRA', ?, 'active')").run("QNFO.INFRA." + k, k);
    db.prepare("INSERT INTO roadmap_implementation VALUES (?, ?, 'portfolio-self-manage', 'planned', 'old evidence', NULL)").run(id, "NEXT-QNFO.INFRA." + k);
  }
  return db;
};
const db = mk();
db.exec(sql);
const issues = db.prepare("SELECT * FROM agent_issues ORDER BY id").all();
ok(issues.length === 5 && issues.every((r) => r.status === "open" && r.source === "cf-estate-1"), "five open issues from this file", issues.length);
for (const [, k] of ROWS) {
  const r = issues.find((x) => x.title.startsWith("ROADMAP-1: QNFO.INFRA." + k + " #1: "));
  ok(!!r, "one ROADMAP-1 issue for " + k);
  if (!r) continue;
  const task = /^code-task: repo=qnfo-workers path=(\S+)$/m.exec(r.description);
  const anchor = /^code-anchor: (.+)$/m.exec(r.description);
  const probe = /^code-probe: (\{.*\})$/m.exec(r.description);
  ok(task && existsSync(join(root, task[1])), k + " code-task names a file that exists", task && task[1]);
  ok(anchor && anchor[1].length > 10, k + " has a code-anchor line");
  const p = probe ? JSON.parse(probe[1]) : null;
  ok(p && Array.isArray(p.paths) && p.paths.every((f) => existsSync(join(root, f))) && typeof p.contains === "string" && p.contains.length > 5, k + " code-probe is a spec with existing paths and a text", p);
  ok(/^Charter pillar: /.test(r.description) && /Metric it should move:/.test(r.description) && /Evidence/.test(r.description) && /\nChange: /.test(r.description), k + " states pillar, metric, evidence and change (CODE-CHANGE-REQUIRED-1)");
}
const map = db.prepare("SELECT m.issue_id, m.project_code, m.program_code, m.kind, a.title FROM issue_project_map m JOIN agent_issues a ON a.id = m.issue_id ORDER BY m.project_code").all();
ok(map.length === 5 && map.every((m) => m.program_code === "QNFO.INFRA" && m.title.startsWith("ROADMAP-1: " + m.project_code + " #1: ")), "each issue is mapped to its own project", map);
// the portfolio-execute no-mapped-work join
const unmapped = db.prepare("SELECT p.project_code FROM projects p WHERE p.status = 'active' AND NOT EXISTS (SELECT 1 FROM issue_project_map m WHERE m.project_code = p.project_code)").all();
ok(unmapped.length === 0, "no active QNFO.INFRA project is left without mapped work", unmapped);
const rm = db.prepare("SELECT id, item, status, evidence, verified_at FROM roadmap_implementation ORDER BY id").all();
ok(rm.every((r) => r.status === "partial" && r.verified_at === null), "rows 610 to 614 are partial, not verified", rm.map((r) => r.status));
ok(rm.every((r, i) => r.evidence.includes("agent_issues " + issues.find((x) => x.title.startsWith("ROADMAP-1: QNFO.INFRA." + ROWS[i][1] + " ")).id + " ") && !r.evidence.includes("agent_issues ? ")), "each row names the id of its mapped issue", rm.map((r) => r.evidence.slice(-120)));
ok(rm.every((r) => /Not yet read: a live run of the workflow after the merge/.test(r.evidence)), "each row says what is not yet verified live");
ok(db.prepare("SELECT COUNT(*) n FROM decision_log").get().n === 1, "one decision_log row");

db.exec(sql);
ok(db.prepare("SELECT COUNT(*) n FROM agent_issues").get().n === 5 && db.prepare("SELECT COUNT(*) n FROM issue_project_map").get().n === 5 && db.prepare("SELECT COUNT(*) n FROM decision_log").get().n === 1, "a replay inserts nothing more");

const db2 = mk();
db2.prepare("UPDATE roadmap_implementation SET status = 'verified', evidence = 'auto' WHERE id = 612").run();
db2.exec(sql);
ok(db2.prepare("SELECT status, evidence FROM roadmap_implementation WHERE id = 612").get().evidence === "auto", "a row the loop already verified is left alone");

const db3 = mk();
db3.exec(sql);
db3.prepare("INSERT INTO agent_issues (title, status, source) VALUES ('unrelated', 'open', 'x')").run();
db3.exec(hdr("Rollback"));
const left = db3.prepare("SELECT title FROM agent_issues").all();
const back = db3.prepare("SELECT status, evidence FROM roadmap_implementation ORDER BY id").all();
ok(left.length === 1 && left[0].title === "unrelated" && db3.prepare("SELECT COUNT(*) n FROM issue_project_map").get().n === 0, "the Rollback removes the five issues and their map rows, nothing else", left);
ok(back.every((r) => r.status === "planned" && r.evidence === "old evidence"), "the Rollback restores the five rows", back);

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
