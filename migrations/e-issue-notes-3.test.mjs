// ISSUE-NOTES-E-3 offline suite. Run: node migrations/e-issue-notes-3.test.mjs
// METRIC-354 (agent_issues 1000988) gets one dated finding; the note never carries a planner line, is added once, and the old description is saved.
import { DatabaseSync } from "node:sqlite"; import { readFileSync } from "node:fs";
const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, description TEXT)");
for (const id of [1000988, 999]) db.prepare("INSERT INTO agent_issues VALUES (?, ?, ?)").run(id, "t" + id, "body " + id);
let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.log("FAIL " + m); } };
const sql = readFileSync(new URL("./2026-11-05-e-issue-notes-3.sql", import.meta.url), "utf8");
db.exec(sql);
const d = db.prepare("SELECT description d FROM agent_issues WHERE id = 1000988").get().d;
ok(d.startsWith("body 1000988") && (d.match(/E-METRICS-PORTFOLIO 2026-11-05c/g) || []).length === 1, "METRIC-354 keeps its text and gets one note");
ok(!/code-task:|code-anchor:|code-probe:|runtime-probe:/.test(d), "the note carries no planner line");
ok(d.length > 1500, "the note says something: " + d.length);
ok(/518\.72/.test(d) && /298,667/.test(d) && /1,560,634/.test(d), "the note carries the numbers read on 2026-11-05");
ok(db.prepare("SELECT description d FROM agent_issues WHERE id = 999").get().d === "body 999", "another issue is untouched");
db.exec(sql);
ok(db.prepare("SELECT description d FROM agent_issues WHERE id = 1000988").get().d.match(/E-METRICS-PORTFOLIO 2026-11-05c/g).length === 1, "re-running adds nothing");
ok(db.prepare("SELECT COUNT(*) n FROM bak_20261105_e_issue_notes_3").get().n === 1, "the old description is saved once");
ok(db.prepare("SELECT description d FROM bak_20261105_e_issue_notes_3 WHERE id = 1000988").get().d === "body 1000988", "the saved description is the original");
ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: /m.test(sql) && /^-- BACKUP: /m.test(sql), "migration header lines");
console.log(fail ? fail + " failed" : "all passed"); process.exit(fail ? 1 : 0);
