// SPOF-ALTERNATE-RAN-E-1 offline suite. Run: node migrations/e-spof-alternates-ran.test.mjs
import { DatabaseSync } from "node:sqlite"; import { readFileSync } from "node:fs";
const db = new DatabaseSync(":memory:");
db.exec(`CREATE TABLE spof_registry (component TEXT PRIMARY KEY, critical_path TEXT, alternate_path TEXT, alternate_tested_at TEXT, evidence TEXT, issue_id INTEGER, reviewed_at TEXT);
INSERT INTO spof_registry VALUES
 ('fleet_tick producers (qnfo-audit trigger fan-out)', 'p', 'alt', NULL, 'ev1', 1001656, '2026-11-04T15:54:59Z'),
 ('work-claim endpoint (qnfo-deploy-guard /work-lock)', 'p', 'alt', NULL, 'ev2', NULL, '2026-10-30T09:28:48Z'),
 ('qnfo-agents cron */5 (CF-AGENTS-LOOPS-1)', 'p', 'alt', NULL, 'ev3', NULL, '2026-10-26T06:52:44Z'),
 ('qnfo-evolve cron', 'p', 'alt', NULL, 'ev4', NULL, '2026-10-17T16:59:56Z'),
 ('research publication structural validation', 'p', 'not preventive', NULL, 'ev5', 1000209, '2026-10-25T16:01:54Z'),
 ('qnfo-audit D1', 'p', 'alt', '2026-11-04T20:05:45.368Z', 'ev6', NULL, '2026-11-04T20:05:45.368Z');
CREATE TABLE spof_alternate_probes (component TEXT PRIMARY KEY, probe_sql TEXT NOT NULL, exercise TEXT, window_note TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, last_run_at TEXT, last_pass INTEGER, last_pass_at TEXT, last_observed TEXT, created_at TEXT);
CREATE TABLE fleet_tick (id INTEGER PRIMARY KEY, ts TEXT, source TEXT);
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at TEXT, updated_at TEXT);`);
let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.log("FAIL " + m); } };
const untested = () => db.prepare("SELECT COUNT(*) n FROM spof_registry WHERE alternate_tested_at IS NULL").get().n;
ok(untested() === 5, "before: five registered single points of failure have no tested alternate");
const sql = readFileSync(new URL("./2026-11-05-e-spof-alternates-ran.sql", import.meta.url), "utf8");
db.exec(sql);
ok(untested() === 3, "after: three are left (agents cron, evolve cron, research structure gate): " + untested());
const left = db.prepare("SELECT component FROM spof_registry WHERE alternate_tested_at IS NULL ORDER BY component").all().map((r) => r.component);
ok(left.join("|") === "qnfo-agents cron */5 (CF-AGENTS-LOOPS-1)|qnfo-evolve cron|research publication structural validation", "the three that stay untested are named: " + left.join("|"));
const r = db.prepare("SELECT alternate_tested_at a, evidence e FROM spof_registry WHERE component = 'work-claim endpoint (qnfo-deploy-guard /work-lock)'").get();
ok(r.a === "2026-11-04T15:25:55Z" && /PR 6966/.test(r.e) && /^ev2 \| SPOF-ALTERNATE-RAN-E-1/.test(r.e), "the work-claim row carries the date of PR 6966 and appends its evidence");
const t = db.prepare("SELECT alternate_tested_at a, evidence e FROM spof_registry WHERE component = 'fleet_tick producers (qnfo-audit trigger fan-out)'").get();
ok(t.a === "2026-11-05T00:54:45Z" && /cron:qnfo-code-orchestrator 41/.test(t.e), "the fleet_tick row carries the alternate producer's last write and the counts");
ok(db.prepare("SELECT alternate_tested_at a FROM spof_registry WHERE component = 'qnfo-audit D1'").get().a === "2026-11-04T20:05:45.368Z", "a row already tested is untouched");
// the drill probe: passes only while the alternate producer keeps writing
const probe = () => db.prepare(db.prepare("SELECT probe_sql p FROM spof_alternate_probes WHERE component = 'fleet_tick producers (qnfo-audit trigger fan-out)'").get().p).get();
ok(probe().expected === "ok" && probe().observed !== "ok", "with no orchestrator tick the drill probe fails");
db.prepare("INSERT INTO fleet_tick (ts, source) VALUES (?, 'cron:qnfo-fleet-dashboard')").run(new Date().toISOString().slice(0, 19) + "Z");
ok(probe().observed !== "ok", "a dashboard tick alone is not the alternate");
db.prepare("INSERT INTO fleet_tick (ts, source) VALUES (?, 'cron:qnfo-code-orchestrator')").run(new Date().toISOString().slice(0, 19) + "Z");
ok(probe().observed === "ok", "a fresh orchestrator tick passes");
db.exec("DELETE FROM fleet_tick; INSERT INTO fleet_tick (ts, source) VALUES ('2020-01-01T00:00:00Z', 'cron:qnfo-code-orchestrator')");
ok(probe().observed !== "ok", "an old orchestrator tick does not");
const issue = db.prepare("SELECT title, description, priority FROM agent_issues WHERE title LIKE 'SPOF-DRILL-1:%'").get();
ok(issue && /code-task: repo=qnfo-workers path=qnfo-fleet-control\/worker\.js/.test(issue.description) && /code-anchor: async function chaosExercise\(env, exercise\) \{/.test(issue.description) && /code-probe: /.test(issue.description), "the remainder has a doer: code-task, code-anchor on a function signature, code-probe");
db.exec(sql);
ok(db.prepare("SELECT COUNT(*) n FROM agent_issues WHERE title LIKE 'SPOF-DRILL-1:%'").get().n === 1 && db.prepare("SELECT COUNT(*) n FROM spof_alternate_probes").get().n === 1 && untested() === 3, "re-running changes nothing");
ok(db.prepare("SELECT COUNT(*) n FROM bak_20261105_e_spof_alternates").get().n === 2, "the two stamped rows are saved for the rollback");
ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: /m.test(sql) && /^-- BACKUP: /m.test(sql), "migration header lines");
console.log(fail ? fail + " failed" : "all passed"); process.exit(fail ? 1 : 0);
