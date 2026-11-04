// PLUS-OWN-TASK-1 offline suite: replays migrations/2026-11-04-plus-steps-own-task.sql on node:sqlite against a fixture of the live layout.
// Output MUST contain "0 failed" on success.   node migrations/plus-steps-own-task.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("../migrations/2026-11-04-plus-steps-own-task.sql", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL " + m); } };
const body = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: /m.test(sql) && /^-- BACKUP: /m.test(sql), "header opts in");
const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE fleet_tasks(id TEXT PRIMARY KEY,name TEXT,type TEXT,definition TEXT,timeout_ms INT,retries INT,version INT,enabled INT,updated_at TEXT);CREATE TABLE fleet_crons(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,cron_expr TEXT,task_id TEXT,enabled INT DEFAULT 1,timezone TEXT,last_fired TEXT,next_fire TEXT,updated_at TEXT);");
const steps = [...Array.from({ length: 80 }, (_, i) => "s" + i).flatMap((n, i) => (i === 3 ? [n, "pl-ledger"] : i === 9 ? [n, "pl-sync"] : [n])), "pl-plus-keep-rate"].map((n) => ({ type: "sql", name: n, db: "AUDIT", sql: "SELECT 1" }));
db.prepare("INSERT INTO fleet_tasks VALUES('management-personas','n','workflow',?,120000,1,24,1,'x')").run(JSON.stringify({ steps }));
const names = (id) => JSON.parse(db.prepare("SELECT definition d FROM fleet_tasks WHERE id=?").get(id).d).steps.map((s) => s.name).join(",");
db.exec(body);
const A = names("management-personas").split(","), B = names("management-personas-b").split(","), C = names("management-personas-c").split(",");
ok(A.length === 35 && B.length === 35 && C.length === 10 && !A.concat(B, C).some((n) => n.startsWith("pl-")), "pl-* leave; the rest split 35/35/10");
ok(A.concat(B, C).join(",") === Array.from({ length: 80 }, (_, i) => "s" + i).join(","), "order kept across the three tasks");
ok(names("management-personas-plus") === "pl-ledger,pl-sync,pl-plus-keep-rate", "pl-* steps move in order");
ok(db.prepare("SELECT cron_expr c FROM fleet_crons WHERE name='management-personas-plus-hourly'").get().c === "50 * * * *", "own hourly cron");
db.exec(body);
ok(names("management-personas").split(",").length === 35 && db.prepare("SELECT COUNT(*) n FROM fleet_crons").get().n === 3, "a replay changes nothing (3 crons)");
console.log(pass + " passed, " + fail + " failed");
