// W2-F-C offline suite: replays migrations/2026-11-05-w2f-c-cold-tier-2.sql on node:sqlite.
// Proves: the header opts in (APPLY-BY ci, DB qnfo-audit, one Rollback line, the body deletes and drops nothing); the failure mode, its closing probe, one decision_log row and the
// COLD-TIER-3 issue are written once (a replay changes nothing); the probe reads 3 with no archive and 0 once each of the three tables has a verified ledger row of the last 26 hours
// (an unverified or old row does not count); the Rollback line removes it all; the issue's code-anchor occurs once in scripts/cold_tier.py and its code-probe does not pass already.
// It does not read live state. Output MUST contain "0 failed" on success.   node migrations/w2f-c-cold-tier-2.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const rd = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const sql = rd("./2026-11-05-w2f-c-cold-tier-2.sql");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };

const header = sql.split("\n").filter((l) => l.startsWith("--"));
const body = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
ok(header.some((l) => /^-- APPLY-BY: ci\s*$/.test(l)) && header.some((l) => /^-- DB: qnfo-audit\s*$/.test(l)), "header opts in: APPLY-BY ci, DB qnfo-audit");
const rollback = header.filter((l) => /^-- Rollback:/.test(l));
ok(rollback.length === 1, "exactly one single-line Rollback header");
ok(header.some((l) => /^-- CAUSE-MAPPED: /.test(l)) && !/metric_registry/i.test(body), "registers no metric and says so");
ok(!/^\s*(DELETE\s+FROM|DROP\s+(TABLE|INDEX|VIEW|TRIGGER))\b/im.test(body), "the body deletes and drops nothing");
ok(!/claude\.ai|anthropic\.com/i.test(sql), "no claude.ai or anthropic.com link");
ok(Array.from(body.matchAll(/LIKE\s+'((?:[^']|'')*)'/gi)).every((m) => Buffer.byteLength(m[1]) <= 50), "every LIKE pattern is at most 50 bytes");

function world() {
  const w = new DatabaseSync(":memory:");
  w.exec(`CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT, root_cause TEXT, remediation TEXT, detector TEXT, probe_class TEXT, first_seen TEXT, trigger_condition TEXT, symptom TEXT, blast_radius TEXT);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER, expected_cadence_h INTEGER, status TEXT, precondition TEXT, action TEXT, escalate_to TEXT, module TEXT, next_due_at TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT, outcome_matched INTEGER);
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE cold_archive_ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, src_table TEXT NOT NULL, verified INTEGER NOT NULL DEFAULT 0, archived_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')));`);
  return w;
}
const snap = (w) => JSON.stringify([w.prepare("SELECT fm_key FROM failure_modes").all(), w.prepare("SELECT class, verify_probe FROM remediation_contracts").all(), w.prepare("SELECT action FROM decision_log").all(), w.prepare("SELECT title FROM agent_issues").all()]);

const w = world();
w.exec(sql);
ok(w.prepare("SELECT COUNT(*) n FROM failure_modes WHERE fm_key = 'cold-archive-lag-2'").get().n === 1, "the failure mode is written");
ok(w.prepare("SELECT COUNT(*) n FROM remediation_contracts WHERE class = 'fm-cold-archive-lag-2' AND status = 'active' AND verify_transport = 'd1-query'").get().n === 1, "the closing probe is an active d1-query contract");
ok(w.prepare("SELECT COUNT(*) n FROM decision_log WHERE actor = 'session:w2f-c'").get().n === 1, "one decision_log row");
const issue = w.prepare("SELECT * FROM agent_issues WHERE title LIKE 'COLD-TIER-3:%'").get();
ok(issue && issue.status === "open" && /code-task: repo=qnfo-workers path=scripts\/cold_tier\.py/.test(issue.description) && /code-anchor: def chunk_sql\(t\):/.test(issue.description) && /code-probe: \{/.test(issue.description), "COLD-TIER-3 is filed with the routing, anchor and probe lines the code loop reads");
const s1 = snap(w);
w.exec(sql);
ok(snap(w) === s1, "a replay changes nothing");

const probe = () => { const p = w.prepare("SELECT verify_probe p FROM remediation_contracts WHERE class = 'fm-cold-archive-lag-2'").get().p; return { ...w.prepare(p).get() }; };
ok(JSON.stringify(probe()) === JSON.stringify({ expected: "0", observed: "3" }), "no archive yet: all three tables are missing", probe());
const ins = w.prepare("INSERT INTO cold_archive_ledger (src_table, verified, archived_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now', ?))");
ins.run("cron_fire_log", 1, "-1 hours");
ins.run("fleet_runs", 0, "-1 hours");
ins.run("analytics_action_log", 1, "-30 hours");
ins.run("fleet_probe_log", 1, "-1 hours");
ok(probe().observed === "2", "an unverified row, a row older than 26 hours and another table do not count", probe());
ins.run("fleet_runs", 1, "-2 hours");
ins.run("analytics_action_log", 1, "-25 hours");
ok(JSON.stringify(probe()) === JSON.stringify({ expected: "0", observed: "0" }), "a verified row of the last 26 hours for each of the three tables is healthy", probe());

w.exec(rollback[0].replace(/^-- Rollback:\s*/, ""));
ok(w.prepare("SELECT (SELECT COUNT(*) FROM failure_modes) + (SELECT COUNT(*) FROM remediation_contracts) + (SELECT COUNT(*) FROM decision_log) + (SELECT COUNT(*) FROM agent_issues) n").get().n === 0, "the Rollback line removes everything the file wrote");

// the issue's routing line points at a real function signature that occurs once, and its probe does not pass before the work is done
const py = rd("../scripts/cold_tier.py");
ok(py.split("def chunk_sql(t):").length - 1 === 1, "the code-anchor occurs once in scripts/cold_tier.py");
ok(py.indexOf('"table": "cloud_ops_events"') === -1, "the code-probe of COLD-TIER-3 does not already pass");
ok(py.indexOf('"table": "cron_fire_log"') > 0 && py.indexOf('"table": "fleet_runs"') > 0 && py.indexOf('"table": "analytics_action_log"') > 0, "the three COLD-TIER-2 tiers are in TIERS");

console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
