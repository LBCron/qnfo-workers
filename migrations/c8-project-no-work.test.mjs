// PROJECT-NO-WORK-1 offline suite: replays migrations/2026-11-05-c8-project-no-work.sql on node:sqlite, then runs the two steps of the fleet task it creates the way fleet-exec does.
// Proves: only an open PROJ- row of an ACTIVE derived project older than 14 days with no issue ever mapped is retired (not a mapped one, a young one, a bp26, legacy or owner project, an umbrella
// W.QNFO.* project, or a project that is not active); the row reopens when an issue maps to the project and only a row this rule retired is reopened; a replay and a second task run change nothing;
// the task and cron exist once; the Rollback restores the rows. Output MUST contain "0 failed" on success.
// Run: node --no-warnings migrations/c8-project-no-work.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("./2026-11-05-c8-project-no-work.sql", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 300))); } };
ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: /m.test(sql) && /^-- BACKUP: bak_20261105_c8_proj_rows$/m.test(sql), "header opts in with a backup table");
const d = new DatabaseSync(":memory:");
d.exec(`CREATE TABLE projects (project_code TEXT PRIMARY KEY, program_code TEXT, name TEXT, status TEXT NOT NULL DEFAULT 'active', source TEXT, owner_service TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT);
CREATE TABLE issue_project_map (issue_id INTEGER, project_code TEXT);
CREATE TABLE roadmap_implementation (id INTEGER PRIMARY KEY AUTOINCREMENT, item TEXT NOT NULL, source TEXT NOT NULL, title TEXT NOT NULL, artifact_type TEXT NOT NULL, artifact_ref TEXT, status TEXT NOT NULL, evidence TEXT, verified_at TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE fleet_tasks (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, definition TEXT NOT NULL, timeout_ms INTEGER NOT NULL DEFAULT 30000, retries INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 1, enabled INTEGER NOT NULL DEFAULT 1, updated_at TEXT);
CREATE TABLE fleet_crons (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, cron_expr TEXT NOT NULL, task_id TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, timezone TEXT NOT NULL DEFAULT 'UTC', last_fired TEXT, next_fire TEXT, updated_at TEXT);`);
const old = "datetime('now', '-30 days')", young = "datetime('now', '-5 days')";
const proj = (code, src, status, created) => { d.exec("INSERT INTO projects (project_code, name, status, source, created_at) VALUES ('" + code + "', 'n', '" + status + "', '" + src + "', " + created + ")"); d.prepare("INSERT INTO roadmap_implementation (item, source, title, artifact_type, artifact_ref, status, evidence) VALUES (?, 'projects', 't', 'project', ?, 'open', 'auto')").run("PROJ-" + code, code); };
proj("R.idle", "derived", "active", old); proj("W.idle", "derived", "active", old);
proj("R.worked", "derived", "active", old); d.exec("INSERT INTO issue_project_map VALUES (1, 'R.worked')");
proj("W.young", "derived", "active", young);
proj("BP26.X", "bp26", "active", old); proj("QNFO.INFRA.WORK", "legacy", "active", old); proj("YT.SHORTS", "owner-2026-10-27", "active", old);
proj("W.QNFO.OPS", "derived", "active", old); proj("W.done", "derived", "completed", old);
d.exec("INSERT INTO roadmap_implementation (item, source, title, artifact_type, artifact_ref, status, evidence) VALUES ('PROJ-R.other', 'projects', 't', 'project', 'R.other', 'retired', 'retired by somebody else')");
d.exec("INSERT INTO projects (project_code, name, status, source, created_at) VALUES ('R.other', 'n', 'active', 'derived', " + old + ")");
d.exec("INSERT INTO issue_project_map VALUES (2, 'R.other')");
d.exec(sql);
const row = (code) => d.prepare("SELECT * FROM roadmap_implementation WHERE item = ?").get("PROJ-" + code);
ok(row("R.idle").status === "retired" && row("W.idle").status === "retired", "idle derived projects without any mapped issue are retired");
ok(/^PROJECT-NO-WORK-1: project R\.idle is a derived registry entry with no issue ever mapped/.test(row("R.idle").evidence) && row("R.idle").verified_at, "the row says why and when");
ok(["R.worked", "W.young", "BP26.X", "QNFO.INFRA.WORK", "YT.SHORTS", "W.QNFO.OPS", "W.done"].every((c) => row(c).status === "open"), "a mapped, young, bp26, legacy, owner, umbrella or non-active project keeps its open row");
ok(row("R.other").status === "retired" && row("R.other").evidence === "retired by somebody else", "a row retired by somebody else is left alone");
ok(d.prepare("SELECT status FROM projects WHERE project_code = 'R.idle'").get().status === "active", "the project itself is not changed");
ok(d.prepare("SELECT COUNT(*) n FROM bak_20261105_c8_proj_rows").get().n === 9, "every open PROJ row was backed up first", d.prepare("SELECT COUNT(*) n FROM bak_20261105_c8_proj_rows").get());
const t = d.prepare("SELECT * FROM fleet_tasks WHERE id = 'roadmap-project-nowork'").get();
const steps = JSON.parse(t.definition).steps;
ok(t && steps.length === 2 && steps.every((s) => s.type === "sql" && s.db === "AUDIT" && /^UPDATE roadmap_implementation/.test(s.sql)), "one task of two UPDATE steps");
const cron = d.prepare("SELECT * FROM fleet_crons WHERE name = 'roadmap-project-nowork-hourly'").get();
ok(cron && cron.cron_expr === "35 * * * *" && cron.task_id === "roadmap-project-nowork" && cron.enabled === 1, "hourly cron at minute 35");
ok(!["30", "31", "33", "37", "50"].includes(cron.cron_expr.split(" ")[0]), "the minute does not collide with the roadmap loop tasks");
const run = () => { for (const s of steps) d.exec(s.sql); };
const snap = () => JSON.stringify(d.prepare("SELECT * FROM roadmap_implementation ORDER BY id").all());
const s1 = snap(); run(); ok(snap() === s1, "a task run right after the migration changes nothing");
d.exec(sql); ok(snap() === s1 && d.prepare("SELECT COUNT(*) n FROM fleet_tasks").get().n === 1 && d.prepare("SELECT COUNT(*) n FROM fleet_crons").get().n === 1, "a replay changes nothing and adds no second task or cron");
// reopen: an issue maps to R.idle
d.exec("INSERT INTO issue_project_map VALUES (3, 'R.idle')");
run();
ok(row("R.idle").status === "open" && row("R.idle").verified_at === null && /reopened, an issue is now mapped to project R\.idle/.test(row("R.idle").evidence), "the row reopens when an issue maps to the project");
ok(row("W.idle").status === "retired", "other retired rows stay retired");
ok(row("R.other").status === "retired", "the row retired by somebody else is not reopened even though an issue is mapped");
// a project that gets work and is later idle again is not re-retired while mapped
run(); ok(row("R.idle").status === "open", "a mapped project is not retired again");
// Rollback restores the original rows
const rb = /^-- Rollback: (.+)$/m.exec(sql)[1].split("; DELETE FROM fleet_crons")[0];
d.exec(rb);
ok(row("W.idle").status === "open" && row("W.idle").evidence === "auto" && row("R.other").status === "retired" && row("R.other").evidence === "retired by somebody else", "the rollback restores the rows from the backup");
console.log(pass + " passed, " + fail + " failed");
