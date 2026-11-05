// C8-MOOT-NEWVERSION-1 offline suite: replays migrations/2026-11-05-c8-moot-newversion-issue.sql on node:sqlite. Output MUST contain "0 failed" on success.
// Proves: the open issue filed by C8-GOALS-NO-DOD-1 loses its code-task and code-anchor lines (the code loop must not pick it up), gains an absent code-probe, keeps its title and status, other
// issues are untouched, a replay changes nothing, and the Rollback restores the original description.
// Run: node --no-warnings migrations/c8-moot-newversion-issue.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("./2026-11-05-c8-moot-newversion-issue.sql", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 300))); } };
ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: /m.test(sql), "header opts in");
const d = new DatabaseSync(":memory:");
d.exec("CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, status TEXT, updated_at INTEGER)");
const orig = "code-task: repo=qnfo-workers path=qnfo-research-exec/worker.js\ncode-anchor: async function publishV2(env, row) {\ncode-probe: {\"paths\": [\"qnfo-research-exec/worker.js\"], \"contains\": \"stuck-newversion\"}\nCharter pillar: research.";
d.prepare("INSERT INTO agent_issues (title, description, status) VALUES ('ROADMAP-1: QNFO.RSCH #c8-stuck-newversion: publishV2 recovers a Zenodo newversion draft', ?, 'open')").run(orig);
d.prepare("INSERT INTO agent_issues (title, description, status) VALUES ('ROADMAP-1: QNFO.RSCH #other: something else', 'code-task: repo=qnfo-workers path=x\ncode-anchor: function a() {', 'open')").run();
d.prepare("INSERT INTO agent_issues (title, description, status) VALUES ('ROADMAP-1: QNFO.RSCH #c8-stuck-newversion: closed twin', 'old', 'closed')").run();
d.exec(sql);
const a = d.prepare("SELECT * FROM agent_issues WHERE id = 1").get();
ok(!/code-task:|code-anchor:/.test(a.description) && /^MOOT, corrected 2026-11-05/.test(a.description), "the code-task and code-anchor lines are gone and the issue says it is moot", a.description.slice(0, 120));
ok(/\ncode-probe: \{"paths": \["qnfo-research-exec\/worker\.js"\], "absent": "zenodo"\}$/.test(a.description), "the closing probe is the absent spec, last line");
ok(a.status === "open" && /Zenodo newversion draft/.test(a.title) && a.updated_at > 0, "status and title are kept, updated_at set");
ok(/code-task: repo=qnfo-workers path=x/.test(d.prepare("SELECT description FROM agent_issues WHERE id = 2").get().description) && d.prepare("SELECT description FROM agent_issues WHERE id = 3").get().description === "old", "another issue and a closed twin are untouched");
const s1 = JSON.stringify(d.prepare("SELECT * FROM agent_issues ORDER BY id").all());
d.exec(sql); ok(JSON.stringify(d.prepare("SELECT * FROM agent_issues ORDER BY id").all()) === s1, "a replay changes nothing");
d.exec(/^-- Rollback: (.+)$/m.exec(sql)[1]);
ok(d.prepare("SELECT description FROM agent_issues WHERE id = 1").get().description === orig, "the rollback restores the original description");
console.log(pass + " passed, " + fail + " failed");
