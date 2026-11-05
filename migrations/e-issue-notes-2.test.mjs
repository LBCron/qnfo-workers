// ISSUE-NOTES-E-2 offline suite. Run: node migrations/e-issue-notes-2.test.mjs
// Two issues get one dated finding each; the note never carries a planner line, is added once, and the old description is saved.
import { DatabaseSync } from "node:sqlite"; import { readFileSync } from "node:fs";
const ids = [1000613, 1000982];
const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, description TEXT)");
for (const id of [...ids, 999]) db.prepare("INSERT INTO agent_issues VALUES (?, ?, ?)").run(id, "t" + id, "body " + id);
let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.log("FAIL " + m); } };
const sql = readFileSync(new URL("./2026-11-05-e-issue-notes-2.sql", import.meta.url), "utf8");
db.exec(sql);
const rows = db.prepare("SELECT id, description d FROM agent_issues").all();
for (const id of ids) {
  const d = rows.find((r) => r.id === id).d;
  ok(d.startsWith("body " + id) && (d.match(/E-METRICS-PORTFOLIO 2026-11-05b/g) || []).length === 1, "issue " + id + " keeps its text and gets one note");
  ok(!/code-task:|code-anchor:|code-probe:|runtime-probe:/.test(d), "issue " + id + " note carries no planner line");
  ok(d.length > 600, "issue " + id + " note says something: " + d.length);
}
ok(rows.find((r) => r.id === 999).d === "body 999", "another issue is untouched");
db.exec(sql);
ok(db.prepare("SELECT description d FROM agent_issues WHERE id = 1000613").get().d.match(/E-METRICS-PORTFOLIO 2026-11-05b/g).length === 1, "re-running adds nothing");
ok(db.prepare("SELECT COUNT(*) n FROM bak_20261105_e_issue_notes_2").get().n === 2, "the two old descriptions are saved");
ok(db.prepare("SELECT description d FROM bak_20261105_e_issue_notes_2 WHERE id = 1000982").get().d === "body 1000982", "the saved description is the original");
ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: /m.test(sql) && /^-- BACKUP: /m.test(sql), "migration header lines");
console.log(fail ? fail + " failed" : "all passed"); process.exit(fail ? 1 : 0);
