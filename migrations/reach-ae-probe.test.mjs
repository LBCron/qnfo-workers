// REACH-AE-1 migration suite (migrations/2026-11-05-reach-ae-probe.sql; GitHub #5727, agent_issues 1000699). Proves, without live state: the new closing probe is a plain
// d1-query that passes only when fresh reach-ae rows exist and otherwise reports the read-back's own state (error text included); the strings it reads (source reach-ae, state id
// reach_ae) are the ones qnfo-infra writes; the filed writer issue carries a code-task, an anchor that occurs once in qnfo-gateway/worker.js and a code-probe; the file is
// idempotent and its Rollback line restores the old probe and removes the open issue.
// Run: node migrations/reach-ae-probe.test.mjs   -> prints "N passed, 0 failed"
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const sql = readFileSync(join(here, "2026-11-05-reach-ae-probe.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 300))); } };

const mk = () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER, escalate_to TEXT, expected_cadence_h INTEGER, status TEXT, ts TEXT, last_attempt_at TEXT, last_verdict TEXT, module TEXT, budget_ms INTEGER, next_due_at TEXT, max_items INTEGER, requires_container INTEGER, attempts INTEGER, deferred_since TEXT);
    CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT, outcome_matched INTEGER);
    CREATE TABLE decision_predictions (decision_id INTEGER, kind TEXT, subject TEXT, op TEXT, value REAL, due_at TEXT, origin TEXT);
    CREATE TRIGGER decision_predictions_parse AFTER INSERT ON decision_log WHEN instr(COALESCE(NEW.predicted_outcome, ''), ' within ') > 0
      BEGIN INSERT INTO decision_predictions (decision_id, kind, subject, op, value, due_at, origin) VALUES (NEW.id, 'metric', 'x', '>', 0, 'x', 'parsed'); END;
    CREATE TABLE reach_signals (date TEXT NOT NULL, source TEXT NOT NULL, channel TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, metric TEXT NOT NULL, value REAL, quality TEXT CHECK (quality IN ('human','bot','unknown')), collected_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (date, source, channel, entity_type, entity_id, metric));
    CREATE TABLE infra_state (id TEXT PRIMARY KEY, ts TEXT, kind TEXT, data TEXT);`);
  db.prepare("INSERT INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module, last_verdict, attempts) VALUES ('issue-1000699', 1000699, 'ISSUE-PROBE-AGENT-1', 'VACUOUS-PROBE-V3-1: old', 'SELECT 1 AS expected, 0 AS observed FROM analytics_ae_events', 'd1-query', 3, 'qnfo-fleet-control', 1, 'active', 'probe-template-v3-generic', 'fail', 247)").run();
  db.prepare("INSERT INTO remediation_contracts (class, issue_id, verify_probe, verify_transport, status, last_verdict) VALUES ('issue-1', 1, 'untouched', 'd1-query', 'active', 'fail')").run();
  return db;
};
const db = mk();
db.exec(sql);
const c = db.prepare("SELECT * FROM remediation_contracts WHERE class = 'issue-1000699'").get();
ok(c.verify_transport === "d1-query" && c.status === "active" && c.attempts === 0 && c.last_verdict === null && c.deferred_since === null && !!c.next_due_at, "the contract is re-armed: d1-query, active, clean verdict and attempts", c);
ok(!/VACUOUS-PROBE-V3-1/.test(c.action) && !/analytics_ae_events/.test(c.verify_probe), "the placeholder action text and the retired table are gone");
ok(db.prepare("SELECT verify_probe FROM remediation_contracts WHERE class = 'issue-1'").get().verify_probe === "untouched", "another contract is untouched");
ok(!c.verify_probe.includes(";"), "the probe holds no semicolon (PROBE-SEMICOLON-LINT-1)");

// the probe, run against each state the live system can be in
const run = () => db.prepare(c.verify_probe).get();
let r = run();
ok(r.expected !== r.observed && /collector state: none$/.test(r.observed), "no rows and no state: the probe fails and says the read-back has not run", r);
db.prepare("INSERT INTO infra_state (id, ts, kind, data) VALUES ('reach_ae', 't', 'reach_ae', ?)").run(JSON.stringify({ error: "analytics_engine sql HTTP 403: Authentication error" }));
r = run();
ok(r.expected !== r.observed && /HTTP 403: Authentication error/.test(r.observed), "an API refusal is visible in the probe's observed text", r);
db.prepare("UPDATE infra_state SET data = ? WHERE id = 'reach_ae'").run(JSON.stringify({ rows: 0, loads: 0 }));
db.prepare("INSERT INTO reach_signals (date, source, channel, entity_type, entity_id, metric, value, quality, collected_at) VALUES ('2026-11-04', 'reach-ae', 'web', 'host', 'qnfo.org', 'pageloads', 3, 'unknown', datetime('now', '-4 hours'))").run();
r = run();
ok(r.expected !== r.observed, "a row older than 3 hours does not pass", r);
db.prepare("INSERT INTO reach_signals (date, source, channel, entity_type, entity_id, metric, value, quality, collected_at) VALUES ('2026-11-04', 'reach-ae', 'web', 'host', 'papers.qnfo.org', 'pageloads', 9, 'unknown', datetime('now', '-30 minutes'))").run();
r = run();
ok(r.expected === r.observed, "a fresh reach-ae row passes (expected equals observed)", r);
db.prepare("DELETE FROM reach_signals").run();
db.prepare("INSERT INTO reach_signals (date, source, channel, entity_type, entity_id, metric, value, quality, collected_at) VALUES ('2026-11-04', 'cf-rum-human', 'web', 'host', 'qnfo.org', 'pageviews', 9, 'human', datetime('now'))").run();
ok(run().expected !== run().observed, "fresh rows of another source (cf-rum-human) do not pass");

// the probe reads exactly what qnfo-infra writes
const infra = readFileSync(join(root, "qnfo-infra", "worker.js"), "utf8");
ok(infra.includes("var REACH_AE_SOURCE = \"reach-ae\";") && /INSERT INTO infra_state \(id, ts, kind, data\) VALUES \('reach_ae'/.test(infra) && /collected_at = excluded\.collected_at/.test(infra), "qnfo-infra writes source reach-ae, state id reach_ae and refreshes collected_at on every upsert");

// the writer issue
const issues = db.prepare("SELECT * FROM agent_issues").all();
ok(issues.length === 1 && /^REACH-AE-1b:/.test(issues[0].title) && issues[0].status === "open" && issues[0].priority === "high", "exactly one open writer issue is filed", issues.map((i) => i.title));
const d = issues[0].description;
ok(/\ncode-task: repo=qnfo-workers path=qnfo-gateway\/worker\.js\ncode-anchor: function utmClickRow\(request, res, nowMs\) \{\ncode-probe: \{"paths": \["qnfo-gateway\/worker\.js"\], "contains": "REACH_AE\.writeDataPoint"\}$/.test(d), "it ends with a code-task, an anchor and a code-probe, each on its own line");
const gw = readFileSync(join(root, "qnfo-gateway", "worker.js"), "utf8");
ok(gw.split("function utmClickRow(request, res, nowMs) {").length === 2, "the anchor occurs exactly once in qnfo-gateway/worker.js");
ok(/blob2 host, blob3 path, blob4 referrer host/.test(d) && infra.includes("blob2 AS host, blob4 AS ref") && infra.includes("blob2 AS host, blob3 AS path"), "the blob positions in the writer's design are the ones the read-back queries");
ok(db.prepare("SELECT COUNT(*) n FROM decision_log").get().n === 1 && db.prepare("SELECT COUNT(*) n FROM decision_predictions").get().n === 0, "one decision_log row and no accidental prediction parse");

// idempotent, headers, rollback
const snap = () => JSON.stringify([db.prepare("SELECT class, verify_probe, action, attempts, last_verdict FROM remediation_contracts ORDER BY class").all(), db.prepare("SELECT title FROM agent_issues").all(), db.prepare("SELECT COUNT(*) n FROM decision_log").get()]);
const s1 = snap();
db.exec(sql);
ok(snap() === s1, "applying the file twice changes nothing more");
ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: /m.test(sql) && /^-- BACKUP: bak_20261105_reach_ae_probe$/m.test(sql), "the runner header lines are present");
ok(!/INSERT[^;]*INTO\s+metric_registry/i.test(sql), "no metric is registered (so no breach cause to map)");
db.exec(/^-- Rollback: (.*)$/m.exec(sql)[1]);
const rb = db.prepare("SELECT verify_probe, action, module FROM remediation_contracts WHERE class = 'issue-1000699'").get();
ok(/analytics_ae_events/.test(rb.verify_probe) && /VACUOUS-PROBE-V3-1/.test(rb.action) && rb.module === "probe-template-v3-generic", "the Rollback line restores the old probe", rb);
ok(db.prepare("SELECT COUNT(*) n FROM agent_issues").get().n === 0, "and removes the open writer issue");

console.log(pass + " passed, " + fail + " failed");
process.exitCode = fail ? 1 : 0;
