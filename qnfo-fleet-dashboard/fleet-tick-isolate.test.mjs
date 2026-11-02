// FLEET-TICK-ISOLATE-1 offline suite for the fallback fleet_tick producer (qnfo-fleet-dashboard 1.49.2, agent_issues 2600).
// The orchestrator's twin is qnfo-code-orchestrator/fleet-tick-isolate.test.mjs. On 2026-10-18 12:14Z-14:38Z a UNIQUE violation inside one
// D1 trigger on fleet_tick rolled the insert back for 144 minutes; this fallback runs the same insert through the same triggers and failed
// with it (fleet_heartbeat ok 0). This suite runs the real feedFallbackTick sliced from worker.js against that shape in node:sqlite.
// Proves: a healthy tick keeps the old source and returns 1; a failing trigger gets an ":isolated" tick, the unrelated fixer runs, only the
// violating statement is skipped, and it returns 1; a tick younger than 9 minutes is not duplicated; two failures return 0 and never throw.
// Run: node --no-warnings qnfo-fleet-dashboard/fleet-tick-isolate.test.mjs   (exit 0 = all passed)
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "worker.js"), "utf8");
const wrangler = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "wrangler.toml"), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 300) : "")); } };
const i = src.indexOf("async function feedFallbackTick(env) {"), j = src.indexOf('\n__name(feedFallbackTick', i);
ok(i >= 0 && j > i, "feedFallbackTick is found in worker.js");
const logs = [];
const lib = new Function("NAME", "console", src.slice(i, j) + "\nreturn { feedFallbackTick };")("qnfo-fleet-dashboard", { log: (x) => logs.push(String(x)) });
const dueStart = src.indexOf("function fullDashboardRefreshDue(controller) {");
const dueEnd = src.indexOf("\n__name(fullDashboardRefreshDue", dueStart);
ok(dueStart >= 0 && dueEnd > dueStart, "fullDashboardRefreshDue is found in worker.js");
const fullDashboardRefreshDue = new Function(src.slice(dueStart, dueEnd) + "\nreturn fullDashboardRefreshDue;")();
const mk = (opts = {}) => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, status TEXT);
    CREATE UNIQUE INDEX idx_agent_issues_open_title_ci ON agent_issues (lower(title)) WHERE status = 'open';
    CREATE TABLE fleet_tick (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), source TEXT);
    CREATE TABLE fixer_marks (n INTEGER);
    INSERT INTO agent_issues (title, status) VALUES ('same title', 'open'), ('same title', 'closed');
    CREATE TRIGGER fixer_unrelated AFTER INSERT ON fleet_tick BEGIN INSERT INTO fixer_marks VALUES (1); END;
  `);
  if (!opts.healthy) db.exec(`CREATE TRIGGER fixer_reopen_twin AFTER INSERT ON fleet_tick BEGIN UPDATE agent_issues SET status = 'open' WHERE title = 'same title' AND status = 'closed'; END;`);
  if (opts.broken) db.exec("DROP TABLE fleet_tick");
  const stmt = (sql) => ({ run: async () => { db.prepare(sql).run(); return { success: true }; } });
  return { db, env: { AUDIT: { prepare: (sql) => stmt(sql) } } };
};
const ticks = (db) => db.prepare("SELECT source FROM fleet_tick ORDER BY id").all().map((r) => r.source);
const marks = (db) => db.prepare("SELECT COUNT(*) n FROM fixer_marks").get().n;

{ const { db, env } = mk({ healthy: true }); logs.length = 0;
  const r = await lib.feedFallbackTick(env);
  ok(r === 1 && ticks(db).join() === "cron:qnfo-fleet-dashboard" && marks(db) === 1 && logs.length === 0, "a healthy tick keeps the old source, returns 1 and logs nothing", { r, t: ticks(db), logs }); }
{ const { db, env } = mk(); logs.length = 0;
  const r = await lib.feedFallbackTick(env);
  ok(r === 1 && ticks(db).join() === "cron:qnfo-fleet-dashboard:isolated", "the failing fan-out still gets a tick row under the :isolated source and returns 1", { r, t: ticks(db) });
  ok(marks(db) === 1, "the unrelated fixer ran in the slot", marks(db));
  ok(db.prepare("SELECT status FROM agent_issues WHERE id = 2").get().status === "closed", "only the violating statement was skipped");
  ok(logs.length === 1 && /scheduled:fleet_tick/.test(logs[0]) && /UNIQUE constraint failed/.test(logs[0]), "the first error is logged", logs); }
{ const { db, env } = mk({ healthy: true });
  await lib.feedFallbackTick(env); await lib.feedFallbackTick(env);
  ok(ticks(db).length === 1, "a tick younger than 9 minutes is not duplicated", ticks(db)); }
{ const { env } = mk({ broken: true }); logs.length = 0; let threw = false, r = null;
  try { r = await lib.feedFallbackTick(env); } catch (e) { threw = true; }
  ok(!threw && r === 0 && logs.length === 2, "two failures return 0 (heartbeat ok 0), log both and never throw", { threw, r, logs: logs.length }); }
// STANDBY-PROOF-1 (agent_issues 100136): the standby producer proves itself every 6 hours even while the primary ticks.
{ const { db, env } = mk({ healthy: true });
  db.prepare("INSERT INTO fleet_tick (source) VALUES ('cron:qnfo-code-orchestrator')").run();
  const r = await lib.feedFallbackTick(env);
  ok(r === 1 && ticks(db).join() === "cron:qnfo-code-orchestrator,cron:qnfo-fleet-dashboard", "a fresh primary tick and no row of its own in 6 h: the standby writes one proof tick", { r, t: ticks(db) }); }
{ const { db, env } = mk({ healthy: true });
  db.prepare("INSERT INTO fleet_tick (source) VALUES ('cron:qnfo-code-orchestrator')").run();
  db.prepare("INSERT INTO fleet_tick (ts, source) VALUES (strftime('%Y-%m-%dT%H:%M:%SZ','now','-60 minutes'), 'cron:qnfo-fleet-dashboard')").run();
  await lib.feedFallbackTick(env);
  ok(ticks(db).length === 2, "a fresh primary tick and a row of its own 1 h ago: no proof tick", ticks(db)); }
{ const { db, env } = mk({ healthy: true });
  db.prepare("INSERT INTO fleet_tick (source) VALUES ('cron:qnfo-code-orchestrator')").run();
  db.prepare("INSERT INTO fleet_tick (ts, source) VALUES (strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours'), 'cron:qnfo-fleet-dashboard')").run();
  await lib.feedFallbackTick(env);
  ok(ticks(db).length === 3, "its own last row 7 h ago: a proof tick is written", ticks(db)); }
{ const { db, env } = mk({ healthy: true });
  db.prepare("INSERT INTO fleet_tick (ts, source) VALUES (strftime('%Y-%m-%dT%H:%M:%SZ','now','-30 minutes'), 'cron:qnfo-code-orchestrator')").run();
  const r = await lib.feedFallbackTick(env);
  ok(r === 1 && ticks(db).includes("cron:qnfo-fleet-dashboard"), "a stale primary still gets the standby tick (the original duty is unchanged)", ticks(db)); }
{ const probe = "SELECT COUNT(*) n FROM fleet_tick WHERE source LIKE 'cron:qnfo-fleet-dashboard%' AND ts > strftime('%Y-%m-%dT%H:%M:%SZ','now','-24 hours')";
  const { db, env } = mk({ healthy: true });  /* then a failing fan-out: the :isolated row also satisfies the drill probe */
  db.prepare("INSERT INTO fleet_tick (source) VALUES ('cron:qnfo-code-orchestrator')").run();
  db.exec("CREATE TRIGGER fixer_reopen_twin AFTER INSERT ON fleet_tick BEGIN UPDATE agent_issues SET status = 'open' WHERE title = 'same title' AND status = 'closed'; END;");
  await lib.feedFallbackTick(env);
  ok(db.prepare(probe).get().n >= 1, "the chaos-drill probe (a dashboard-sourced row in 24 h) is satisfied, isolated rows included", ticks(db)); }
{ const at = (minute) => Date.UTC(2026, 10, 2, 8, minute);
  ok(fullDashboardRefreshDue({ scheduledTime: at(0) }) && fullDashboardRefreshDue({ scheduledTime: at(15) }), "full dashboard refresh remains on its original quarter-hour boundaries");
  ok(!fullDashboardRefreshDue({ scheduledTime: at(5) }) && !fullDashboardRefreshDue({ scheduledTime: at(10) }), "five-minute heartbeat-only runs skip the full refresh");
  const scheduled = src.slice(src.indexOf("async scheduled(controller, env, ctx) {"));
  const tick = scheduled.indexOf("const tickOk = await feedFallbackTick(env);");
  const guard = scheduled.indexOf("if (!fullDashboardRefreshDue(controller)) {");
  const heartbeat = scheduled.indexOf("INSERT OR REPLACE INTO fleet_heartbeat");
  const longWork = scheduled.indexOf("const deadline = Date.now()");
  ok(/crons\s*=\s*\["\*\/5 \* \* \* \*"\]/.test(wrangler), "the standby is scheduled every five minutes");
  ok(tick >= 0 && heartbeat > tick && guard > heartbeat && guard < longWork, "each cadence records heartbeat evidence before full work is skipped on non-quarter-hours"); }
ok(/const tickOk = await feedFallbackTick\(env\);/.test(src) && !/INSERT INTO fleet_tick \(source\) SELECT 'cron:qnfo-fleet-dashboard' WHERE/.test(src), "scheduled() uses the helper and no longer carries the bare insert");
{ const m = /var VERSION = "(\d+)\.(\d+)\.(\d+)/.exec(src); ok(m && Number(m[1]) * 1e6 + Number(m[2]) * 1e3 + Number(m[3]) >= 1080000, "VERSION is at least 1.80.0", m && m[0]); }
console.log(fail ? fail + " failed, " + pass + " passed" : pass + " passed, 0 failed");
process.exit(fail ? 1 : 0);
