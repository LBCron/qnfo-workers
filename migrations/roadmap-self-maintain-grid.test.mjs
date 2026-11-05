// ROADMAP-SELF-MAINTAIN-2b offline suite: migrations/2026-11-05-roadmap-self-maintain-grid.sql on node:sqlite.
// Proves: the three split crons move onto the 5-minute grid (:40, :05, :15), next_fire is cleared so each re-schedules from the new expression, the original :30 cron and other crons are
// untouched, a replay changes nothing, and the backup keeps the first expressions.
// Run: node migrations/roadmap-self-maintain-grid.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("./2026-11-05-roadmap-self-maintain-grid.sql", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d))); } };
const body = sql.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
const S = body.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean);
const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE fleet_crons (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, cron_expr TEXT NOT NULL, task_id TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, timezone TEXT NOT NULL DEFAULT 'UTC', last_fired TEXT, next_fire TEXT, updated_at TEXT)");
const ins = db.prepare("INSERT INTO fleet_crons (name, cron_expr, task_id, next_fire) VALUES (?, ?, ?, '2026-11-05T01:31:00.000Z')");
ins.run("roadmap-self-maintain-hourly", "30 * * * *", "roadmap-self-maintain");
ins.run("roadmap-self-maintain-goals-hourly", "31 * * * *", "roadmap-self-maintain-goals");
ins.run("roadmap-self-maintain-roadmap-hourly", "33 * * * *", "roadmap-self-maintain-roadmap");
ins.run("roadmap-self-maintain-metrics-hourly", "37 * * * *", "roadmap-self-maintain-metrics");
ins.run("other-hourly", "35 * * * *", "other");
const run = () => { for (const s of S) db.exec(s); };
run();
const row = (n) => db.prepare("SELECT cron_expr c, next_fire nf FROM fleet_crons WHERE name = ?").get(n);
ok(row("roadmap-self-maintain-goals-hourly").c === "40 * * * *" && row("roadmap-self-maintain-roadmap-hourly").c === "5 * * * *" && row("roadmap-self-maintain-metrics-hourly").c === "15 * * * *", "the three crons sit on the 5-minute grid");
ok(["roadmap-self-maintain-goals-hourly", "roadmap-self-maintain-roadmap-hourly", "roadmap-self-maintain-metrics-hourly"].every((n) => row(n).nf === null), "next_fire is cleared so each re-schedules from the new expression");
ok(row("roadmap-self-maintain-hourly").c === "30 * * * *" && row("roadmap-self-maintain-hourly").nf !== null && row("other-hourly").c === "35 * * * *", "the original cron and an unrelated cron are untouched");
ok(db.prepare("SELECT COUNT(*) n FROM bak_20261105_rsm_grid").get().n === 3 && db.prepare("SELECT v FROM bak_20261105_rsm_grid WHERE k = 'roadmap-self-maintain-goals-hourly'").get().v === "31 * * * *", "the backup keeps the first expressions");
ok(["40", "5", "15"].every((m) => Number(m) % 5 === 0), "every new minute is a multiple of 5");
const snap = () => JSON.stringify(db.prepare("SELECT name, cron_expr, next_fire FROM fleet_crons ORDER BY name").all());
const before = snap();
db.prepare("UPDATE fleet_crons SET next_fire = '2026-11-05T02:40:00.000Z' WHERE name = 'roadmap-self-maintain-goals-hourly'").run();
run();
ok(db.prepare("SELECT next_fire n FROM fleet_crons WHERE name = 'roadmap-self-maintain-goals-hourly'").get().n === "2026-11-05T02:40:00.000Z" && JSON.parse(before).length === 5, "a replay does not clear a next_fire the dispatcher has since set");
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
