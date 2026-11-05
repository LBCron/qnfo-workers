// B-GOVERNANCE-2 offline suite: migrations/2026-11-05-b-governance-probes-2.sql replaces two closing probes that could not pass.
//  issue-746: the old probe wanted more than 80 distinct probe names and 40 scheduled workers (constants of a 55-worker roster); the new one counts live non-member workers of service_registry with no
//    fleet_probe_log row in 24 hours (expected 0): 0 when every live worker is probed, 1 when one loses its probe, a folded member is not a worker, a retired row does not count.
//  issue-1000696: the old probe was anchored on date('2026-11-04', '-29 days') with no upper bound; the new one rolls on date('now'): an old day falls out, the failure text carries the run rate.
// Run: node --no-warnings migrations/b-governance-probes-2.test.mjs   (exit 0 = all passed)
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const sql = readFileSync(new URL("./2026-11-05-b-governance-probes-2.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? "  -- " + JSON.stringify(x).slice(0, 400) : "")); } };
ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: .+/m.test(sql), "migration opts in with APPLY-BY, DB and Rollback headers");
ok(!/\b(DELETE\s+FROM|DROP\s+(TABLE|INDEX|VIEW|TRIGGER))\b/i.test(sql.split("\n").filter((l) => !l.startsWith("--")).join("\n")), "no delete or drop in the body");

const OLD_746 = "WITH probe AS (SELECT strftime('%Y-%m-%d %H', ts) AS hour, COUNT(DISTINCT name) AS names FROM fleet_probe_log WHERE ts >= datetime('now','-1 day') GROUP BY hour ORDER BY hour DESC LIMIT 1) SELECT 'x' AS expected, 'y' AS observed FROM probe";
const OLD_1000696 = "WITH s AS (SELECT max(0, sum(neurons) - 300000)/1000.0*0.011 AS usd FROM ai_call_counters WHERE day >= date('2026-11-04','-29 days')) SELECT 'workers-ai 30d <= 95 USD' AS expected, 'x' AS observed FROM s";

function world() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, status TEXT, description TEXT);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, status TEXT, attempts INTEGER, last_verdict TEXT, deferred_since TEXT, next_due_at TEXT);
CREATE TABLE service_registry (service TEXT PRIMARY KEY, kind TEXT, state TEXT);
CREATE TABLE fleet_probe_log (id INTEGER PRIMARY KEY, name TEXT, ts TEXT);
CREATE TABLE ai_call_counters (id INTEGER PRIMARY KEY, day TEXT, worker TEXT, model TEXT, neurons REAL, calls INTEGER);
CREATE TABLE ai_spend_ledger (id INTEGER PRIMARY KEY, provider TEXT, day TEXT, cached_tok INTEGER);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY, actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
INSERT INTO agent_issues VALUES (746, 'FIX-ORDERING-HAZARD', 'open', 'base'), (1000696, 'ROADMAP-1 OPS 1', 'open', 'base');
INSERT INTO remediation_contracts (class, issue_id, verify_probe, status, attempts, last_verdict) VALUES ('issue-746', 746, ?, 'active', 178, 'fail'), ('issue-1000696', 1000696, ?, 'active', 12, 'fail');`.replace("?", "'" + OLD_746.replace(/'/g, "''") + "'").replace("?", "'" + OLD_1000696.replace(/'/g, "''") + "'"));
  return db;
}
const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString().replace("T", " ").slice(0, 19);

const db = world();
const before = JSON.stringify(db.prepare("SELECT * FROM remediation_contracts ORDER BY class").all());
db.exec(sql);
const c746 = db.prepare("SELECT * FROM remediation_contracts WHERE class = 'issue-746'").get();
const c696 = db.prepare("SELECT * FROM remediation_contracts WHERE class = 'issue-1000696'").get();
ok(c746.status === "active" && c746.attempts === 0 && c746.last_verdict === null && !c746.verify_probe.includes(";") && c746.verify_probe !== OLD_746, "issue-746 is re-pointed, re-armed and the probe has no semicolon", c746);
ok(c696.status === "active" && !c696.verify_probe.includes(";") && !c696.verify_probe.includes("2026-11-04") && c696.verify_probe.includes("date('now','-29 days')"), "issue-1000696 probe rolls on date('now')", c696.verify_probe.slice(0, 200));
ok(db.prepare("SELECT COUNT(*) n FROM bak_20261105_b_gov_probes_2").get().n === 2, "the backup holds both old contracts");

// ---- issue-746
const svc = (s, k, st) => db.prepare("INSERT OR REPLACE INTO service_registry VALUES (?, ?, ?)").run(s, k, st);
const probe = (n, h) => db.prepare("INSERT INTO fleet_probe_log (name, ts) VALUES (?, ?)").run(n, ago(h));
svc("qnfo-ai", "worker", "live"); svc("qnfo-ops", "worker", "live"); svc("qnfo-backlog-exec", "member", "live"); svc("old-worker", "worker", "retired");
probe("qnfo-ai", 1); probe("qnfo-ops", 2);
let r = db.prepare(c746.verify_probe).get();
ok(r.expected === "0" && r.observed === "0", "746: every live standalone worker probed, the folded member and the retired row are not counted -> 0", r);
svc("qnfo-new", "worker", "live");
r = db.prepare(c746.verify_probe).get();
ok(r.observed === "1", "746: a live worker with no probe row reads 1 (falsifiable)", r);
probe("qnfo-new", 30);   // older than a day
r = db.prepare(c746.verify_probe).get();
ok(r.observed === "1", "746: a probe row older than 24 hours does not count", r);
probe("qnfo-new", 3);
ok(db.prepare(c746.verify_probe).get().observed === "0", "746: a fresh probe row brings it back to 0");

// ---- issue-1000696
const neu = (d, n) => db.prepare("INSERT INTO ai_call_counters (day, worker, model, neurons, calls) VALUES (?, 'w', 'm1', ?, 10)").run(day(d), n);
neu(1, 20000000); neu(2, 20000000); neu(3, 20000000); neu(10, 1000000);
db.prepare("INSERT INTO ai_spend_ledger (provider, day, cached_tok) VALUES ('workers-ai', ?, 1000)").run(day(1));
r = db.prepare(c696.verify_probe).get();
const usd = (61000000 - 300000) / 1000 * 0.011;
ok(r.expected === "workers-ai 30d <= 95 USD" && r.observed.startsWith("workers-ai 30d " + usd.toFixed(2) + " USD vs cap 95") && /last 3 complete days 220\.00 USD\/day/.test(r.observed) && /top model m1/.test(r.observed), "1000696: over the cap, the text names the 30-day figure, the run rate and the top model", r);
db.prepare("DELETE FROM ai_call_counters").run();
neu(40, 5000000000);      // an old spike outside the window must fall out
neu(1, 20000);
r = db.prepare(c696.verify_probe).get();
ok(r.observed === r.expected, "1000696: a spike older than 30 days no longer counts (the old probe's window never rolled)", r);
// the old probe, run on the same data, still sees the spike: that is the defect
const oldP = db.prepare("SELECT verify_probe p FROM bak_20261105_b_gov_probes_2 WHERE class = 'issue-1000696'").get().p;
ok(oldP.includes("date('2026-11-04'"), "the backup keeps the anchored old probe");

// ---- notes and replay
ok(/B-GOVERNANCE-2/.test(db.prepare("SELECT description d FROM agent_issues WHERE id = 746").get().d) && /19\.81 USD a day/.test(db.prepare("SELECT description d FROM agent_issues WHERE id = 1000696").get().d), "both issues carry the reading");
const snap = JSON.stringify(db.prepare("SELECT * FROM remediation_contracts ORDER BY class").all()) + JSON.stringify(db.prepare("SELECT description FROM agent_issues ORDER BY id").all());
db.exec(sql);
ok(snap === JSON.stringify(db.prepare("SELECT * FROM remediation_contracts ORDER BY class").all()) + JSON.stringify(db.prepare("SELECT description FROM agent_issues ORDER BY id").all()) && db.prepare("SELECT COUNT(*) n FROM decision_log").get().n === 1, "a replay changes nothing (notes once, one decision row)");
ok(before.includes("178") && before !== snap, "control: the file changed the rows");

console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
