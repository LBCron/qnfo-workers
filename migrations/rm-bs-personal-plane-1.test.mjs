// RM-BS-PERSONAL-PLANE-1 offline suite: replays migrations/2026-11-05-rm-bs-personal-plane-1.sql on node:sqlite.
// Proves: the header opts in; the isolation map holds 4 audit tables for personal-api and 14 for personal-companion; the cost view lists all six personal-plane workers with neurons and list-price USD
// over 30 days only (older days and other workers' neurons stay out of the worker lines, and feed the fleet share); the two follow-up issues carry code-task, code-anchor and code-probe lines whose path
// exists and whose anchor occurs once; the migration names no personal-life table; a replay changes nothing; the Rollback line removes the tables and the view.
// Output MUST contain "0 failed" on success.   Run: node migrations/rm-bs-personal-plane-1.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync } from "node:fs";

const root = new URL("../", import.meta.url);
const rd = (rel) => readFileSync(new URL(rel, root), "utf8");
const sql = rd("migrations/2026-11-05-rm-bs-personal-plane-1.sql");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };

const header = sql.split("\n").filter((l) => l.startsWith("--"));
const body = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
ok(header.some((l) => /^-- APPLY-BY: ci\s*$/.test(l)) && header.some((l) => /^-- DB: qnfo-audit\s*$/.test(l)), "header opts in");
const rollback = header.filter((l) => /^-- Rollback:/.test(l));
ok(rollback.length === 1, "exactly one Rollback line");
ok(!/^\s*(DELETE\s+FROM|DROP\s+(TABLE|INDEX|VIEW|TRIGGER))\b/im.test(body), "the body deletes and drops nothing");
ok(!/claude\.ai|anthropic\.com/i.test(sql), "no claude.ai or anthropic.com link");
ok(Array.from(body.matchAll(/LIKE\s+'((?:[^']|'')*)'/gi)).every((m) => Buffer.byteLength(m[1]) <= 50), "every LIKE pattern is at most 50 bytes");
ok(!/(INTO|FROM|UPDATE|JOIN)\s+(facts|notes|chat|profile|events|email_index|papers|nodes|edges)\b/i.test(body), "the file reads and writes no personal-life or research table");

const day = (n) => new Date(Date.now() - n * 86400e3).toISOString().slice(0, 10);
function world() {
  const w = new DatabaseSync(":memory:");
  w.exec(`CREATE TABLE ai_call_counters (day TEXT, worker TEXT, purpose TEXT, model TEXT, calls INTEGER DEFAULT 0, errors INTEGER DEFAULT 0, in_chars INTEGER DEFAULT 0, ms INTEGER DEFAULT 0, in_tok INTEGER DEFAULT 0, out_tok INTEGER DEFAULT 0, neurons REAL DEFAULT 0, PRIMARY KEY (day, worker, purpose, model));
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, linked_session TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT, outcome_matched INTEGER);`);
  const ins = w.prepare("INSERT INTO ai_call_counters (day, worker, purpose, model, calls, neurons) VALUES (?, ?, 'p', 'm', ?, ?)");
  ins.run(day(1), "q08-signal-engine", 100, 100000);
  ins.run(day(2), "q08-signal-engine", 50, 50000);
  ins.run(day(60), "q08-signal-engine", 999, 999999);   // older than 30 days: not in the line
  ins.run(day(1), "personal-api", 10, 2000);
  ins.run(day(1), "personal-companion", 500, 0);
  ins.run(day(1), "qnfo-ops", 10, 850000);               // another worker: only in the fleet total
  return w;
}
const count = (w, t) => w.prepare("SELECT COUNT(*) n FROM " + t).get().n;
const w = world();
w.exec(body);

const per = Object.fromEntries(w.prepare("SELECT worker, COUNT(*) n FROM personal_plane_audit_deps GROUP BY worker").all().map((r) => [r.worker, r.n]));
ok(per["personal-api"] === 4 && per["personal-companion"] === 14 && count(w, "personal_plane_audit_deps") === 18, "isolation map: 4 + 14 audit tables", per);
ok(count(w, "personal_plane_workers") === 6 && w.prepare("SELECT COUNT(*) n FROM personal_plane_workers WHERE binds_audit = 0").get().n === 2, "six personal-plane workers, two bind nothing");
const issuePipeline = w.prepare("SELECT audit_table FROM personal_plane_audit_deps WHERE worker = 'personal-companion' AND kind LIKE 'fleet issue pipeline' ORDER BY audit_table").all().map((r) => r.audit_table);
ok(JSON.stringify(issuePipeline) === JSON.stringify(["agent_issues", "issue_triage"]), "the companion's fleet-issue-pipeline tables are named", issuePipeline);

const cost = Object.fromEntries(w.prepare("SELECT * FROM v_personal_plane_cost_30d").all().map((r) => [r.worker, r]));
ok(Object.keys(cost).length === 6, "the cost view lists all six workers, including those with no spend", Object.keys(cost));
ok(cost["q08-signal-engine"].neurons === 150000 && cost["q08-signal-engine"].calls === 150 && cost["q08-signal-engine"].usd_list_price === 1.65, "30-day window: 150,000 neurons, USD 1.65 at list price (the 60-day-old row is out)", cost["q08-signal-engine"]);
ok(cost["personal-api"].neurons === 2000 && cost["personal-api"].usd_list_price === 0.02, "personal-api line", cost["personal-api"]);
ok(cost["personal-companion"].neurons === 0 && cost["personal-companion"].calls === 500 && /external-provider/.test(cost["personal-companion"].cost_basis), "the companion shows calls and says its USD is not in the counter", cost["personal-companion"]);
ok(cost["personal-watch"].calls === 0 && cost["personal-watch"].neurons === 0, "a worker with no rows is a zero line, not missing");
ok(Math.abs(cost["q08-signal-engine"].pct_of_fleet_neurons - 100 * 150000 / 1002000) < 0.01, "share of fleet neurons uses the 30-day fleet total", cost["q08-signal-engine"].pct_of_fleet_neurons);

const issues = w.prepare("SELECT title, description FROM agent_issues ORDER BY id").all();
ok(issues.length === 2 && issues.every((i) => /^ROADMAP-1: QNFO\.PERSONAL W2-J-PERS-[23]/.test(i.title)), "two ROADMAP-1 follow-up issues", issues.map((i) => i.title.slice(0, 50)));
for (const i of issues) {
  const p = /^code-task: repo=qnfo-workers path=(\S+)$/m.exec(i.description), a = /^code-anchor: (.+)$/m.exec(i.description);
  ok(p && a, "routing lines on " + i.title.slice(0, 50));
  if (p && a) {
    ok(existsSync(new URL(p[1], root)), "routed path exists: " + p[1]);
    ok(rd(p[1]).split(a[1]).length - 1 === 1, "anchor occurs exactly once in " + p[1], a[1]);
  }
  ok(/^code-probe: \{.+\}$/m.test(i.description), "carries a code-probe line");
}
ok(/INSERT INTO agent_issues/.test(rd("personal-companion/worker.js")) && /"absent": "INSERT INTO agent_issues"/.test(issues[1].description), "PERS-3's absent-probe currently fails (the inserts exist) and will pass when they are gone");
ok(!/memory_keyed/.test(rd("personal-api/worker.js")), "PERS-2's contains-probe currently fails (memory_keyed is not in the worker yet)");
ok(count(w, "decision_log") === 1, "one decision_log row");

const tables = ["personal_plane_workers", "personal_plane_audit_deps", "agent_issues", "decision_log"];
const before = tables.map((t) => count(w, t));
w.exec(body);
ok(JSON.stringify(before) === JSON.stringify(tables.map((t) => count(w, t))), "a replay changes nothing", before);

w.exec(rollback[0].replace(/^-- Rollback:\s*/, ""));
ok(w.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name LIKE 'personal_plane_%' OR name = 'v_personal_plane_cost_30d'").get().n === 0, "Rollback removes the tables and the view");

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
