// RESEARCH-CHAIN-HELD-1 (qnfo-observability 1.5.5, agent_issues 1000630 and 100166) offline suite. No network, synthetic rows.
// Proves: the research chain reads `draining` with a detail that says it is held (not `stuck`) when the backlog is above its ceiling, no consumer finished a row in 3 hours and
// qnfo-research-exec reported "daily budget exhausted" in the last 45 minutes; a budget report older than 45 minutes, a different report, or none still reads `stuck`; a backlog
// whose consumer advanced still reads the ordinary `draining`; a backlog at or under the ceiling is healthy; a read error of the hold query is not a hold.
// Run: node --no-warnings qnfo-observability/research-chain-held.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const mod = await import("data:text/javascript;base64," + Buffer.from(src + "\nexport { assessIntegration as __assess, INTEGRATION_CHAINS as __chains, VERSION as __v };\n").toString("base64"));
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 400) : "")); } };

function mk(withEvents = true) {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE research_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, status TEXT, created_at TEXT)");
  if (withEvents) db.exec("CREATE TABLE cloud_ops_events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, kind TEXT, job TEXT, text TEXT, status TEXT)");
  const AUDIT = { prepare(sql) { let a = []; const s = { bind: (...x) => { a = x; return s; }, run: async () => { db.prepare(sql).run(...a); return {}; }, first: async () => db.prepare(sql).get(...a) || null, all: async () => ({ results: db.prepare(sql).all(...a) }) }; return s; } };
  return { db, env: { AUDIT } };
}
const queue = (db, n) => { const st = db.prepare("INSERT INTO research_queue (status, created_at) VALUES ('queued', datetime('now', '-9 hours'))"); for (let i = 0; i < n; i++) st.run(); };
const ev = (db, kind, text, ago, status = "ok") => db.prepare("INSERT INTO cloud_ops_events (ts, kind, job, text, status) VALUES (strftime('%Y-%m-%dT%H:%M:%SZ', 'now', ?), ?, 'qnfo-research-exec', ?, ?)").run(ago, kind, text, status);
const research = async (env) => { const realErr = console.error; console.error = () => {}; try { const s = await mod.__assess(env); return s.chains.find((c) => c.id === "research"); } finally { console.error = realErr; } };
const BUDGET = "daily budget exhausted: spent=410472 budget=360000 (COST-SUSTAIN-1; work resumes at 00:00 UTC)";

{
  const chain = mod.__chains.find((c) => c.id === "research");
  ok(chain && typeof chain.heldBy === "string" && /research-budget/.test(chain.heldBy) && /-45 minutes/.test(chain.heldBy), "the research chain definition carries the heldBy clause");
  { const [maj, min, pat] = String(mod.__v).split("-")[0].split(".").map(Number); ok(maj > 1 || (maj === 1 && (min > 5 || (min === 5 && pat >= 5))), "VERSION is at least 1.5.5 (minimum, never exact)", mod.__v); }
}
// A. backlog, no progress in 3 h, budget exhausted reported 5 minutes ago -> held (draining), not stuck
{
  const { db, env } = mk(); queue(db, 196); ev(db, "research-budget", BUDGET, "-5 minutes");
  const c = await research(env);
  ok(c && c.n === 196 && c.status === "draining" && /^held: 196 waiting above ceiling/.test(c.detail) && /COST-SUSTAIN-1/.test(c.detail) && /00:00 UTC/.test(c.detail), "A the budget hold reads draining with a held detail", c);
}
// B. the same backlog, the budget report is 3 hours old -> stuck (the hold is not current)
{
  const { db, env } = mk(); queue(db, 196); ev(db, "research-budget", BUDGET, "-3 hours");
  const c = await research(env);
  ok(c && c.status === "stuck" && /no consumer progress in 3h/.test(c.detail), "B a stale budget report does not excuse the backlog", c);
}
// C. a research-budget event that is not the exhausted report -> stuck
{
  const { db, env } = mk(); queue(db, 196); ev(db, "research-budget", "budget ok: spent=1000 budget=360000", "-5 minutes");
  const c = await research(env);
  ok(c && c.status === "stuck", "C a budget report that says the budget is fine does not excuse the backlog", c);
}
// D. no events at all -> stuck
{
  const { db, env } = mk(); queue(db, 196);
  const c = await research(env);
  ok(c && c.status === "stuck", "D no report, no excuse", c);
}
// E. the hold query cannot be read (no events table) -> stuck, never a thrown error
{
  const { db, env } = mk(false); queue(db, 196);
  const c = await research(env);
  ok(c && c.status === "stuck", "E an unreadable hold query reads stuck", c);
}
// F. the consumer advanced (a done row 20 minutes ago) -> the ordinary draining detail, not held
{
  const { db, env } = mk(); queue(db, 196); ev(db, "done", "slug", "-20 minutes"); ev(db, "research-budget", BUDGET, "-5 minutes");
  const c = await research(env);
  ok(c && c.status === "draining" && /^draining: 196 waiting/.test(c.detail) && /advanced \d+m ago/.test(c.detail), "F progress wins over the hold: the ordinary draining detail", c);
}
// G. a backlog at the ceiling is healthy whatever the hold
{
  const { db, env } = mk(); queue(db, 10); ev(db, "research-budget", BUDGET, "-5 minutes");
  const c = await research(env);
  ok(c && c.status === "healthy", "G a backlog at the ceiling is healthy", c);
}

console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
