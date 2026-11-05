// D1-OBSERVABILITY-DISPOSITIONS-1 offline suite for migrations/2026-11-05-d1-observability-dispositions.sql.
// 1001546 (qnfo-fleet-control HTTP 5xx) is superseded by the umbrella only while the umbrella is open; 1000993 (qnfo-ai HTTP 502) gets a worker_logs probe;
// the doer ROUTER-LEGS-1 is filed once with a code-task / code-anchor / code-probe triple whose anchor occurs once in the calibration worker.
// Run: node --no-warnings migrations/d1-observability-dispositions.test.mjs   (exit 0 = all passed)
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const rd = (f) => readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const sql = rd("./2026-11-05-d1-observability-dispositions.sql");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? "  -- " + JSON.stringify(x).slice(0, 400) : "")); } };
ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: .+/m.test(sql), "migration opts in with APPLY-BY, DB and Rollback headers");
ok(!/^\s*(DELETE\s+FROM|DROP\s+)/im.test(sql), "no row-destructive statement");

const UMB = "CF-OBS-ISSUE-1: fleet: D1 DB is overloaded, all workers [cf-obs:d1-overload]";
function mk(withUmbrella) {
  const db = new DatabaseSync(":memory:");
  db.exec(`
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, close_channel TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE issue_triage (issue_id INTEGER PRIMARY KEY, triage_state TEXT, close_evidence TEXT, reopened_count INTEGER, triaged_at TEXT);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, status TEXT, last_verdict TEXT, last_attempt_at TEXT, verify_probe TEXT, verify_transport TEXT, module TEXT, next_due_at TEXT, attempts INTEGER DEFAULT 0);
CREATE TABLE issue_fold_ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, issue_id INTEGER NOT NULL, rule TEXT NOT NULL, successor_id INTEGER, evidence TEXT NOT NULL, agent_status TEXT, agent_updated_at INTEGER, agent_close_channel TEXT, triage_state TEXT, triage_close_evidence TEXT, triage_reopened_count INTEGER, triage_triaged_at TEXT, contract_class TEXT, contract_status TEXT, contract_last_verdict TEXT, contract_last_attempt_at TEXT, applied INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), applied_at TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT NOT NULL, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
CREATE TABLE worker_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, ts_ms INTEGER, script_name TEXT, url TEXT, status INTEGER);
`);
  const rows = [[1000993, "CF-OBS-ISSUE-1: qnfo-ai: HttpServerError · HTTP 502"], [1001546, "CF-OBS-ISSUE-1: qnfo-fleet-control: HttpServerError · HTTP 503"], [1001547, "CF-OBS-ISSUE-1: qnfo-fleet-control: other"]];
  if (withUmbrella) rows.push([1001715, UMB]);
  for (const [id, title] of rows) {
    db.prepare("INSERT INTO agent_issues (id, title, status, created_at, updated_at) VALUES (?, ?, 'open', 0, 0)").run(id, title);
    db.prepare("INSERT INTO issue_triage VALUES (?, 'triaged', NULL, 0, 'x')").run(id);
    db.prepare("INSERT INTO remediation_contracts (class, status, last_verdict, verify_probe, verify_transport, module) VALUES (?, 'active', 'fail', 'old probe', 'd1-query', 'issue-birth-probe-families')").run("issue-" + id);
  }
  return db;
}
const get = (db, q, ...a) => db.prepare(q).get(...a);

const db = mk(true);
db.exec(sql);
ok(get(db, "SELECT status FROM agent_issues WHERE id = 1001546").status === "closed", "1001546 is closed");
const ev = get(db, "SELECT close_evidence, triage_state FROM issue_triage WHERE issue_id = 1001546");
ok(ev.triage_state === "closed" && ev.close_evidence.startsWith("superseded by 1001715: ") && ev.close_evidence.includes("breach-doctor/run") && ev.close_evidence.includes("lock_db_unavailable"), "the evidence names the umbrella and the correlation", ev);
ok(get(db, "SELECT close_channel FROM agent_issues WHERE id = 1001546").close_channel === "session:D1-observability", "close_channel names the session");
ok(get(db, "SELECT status FROM remediation_contracts WHERE class = 'issue-1001546'").status === "superseded", "its contract is superseded");
ok(["1000993", "1001547", "1001715"].every((i) => get(db, "SELECT status FROM agent_issues WHERE id = " + i).status === "open"), "the other issues and the umbrella stay open");
ok(get(db, "SELECT COUNT(*) n FROM issue_fold_ledger WHERE applied = 1 AND issue_id = 1001546").n === 1, "one applied ledger row keeps the before-state");

const c = get(db, "SELECT verify_probe, module, status, attempts FROM remediation_contracts WHERE class = 'issue-1000993'");
ok(c.module === "qnfo-ai-5xx" && c.verify_probe.includes("status = 502") && c.verify_probe.includes("script_name = ''qnfo-ai''".replace(/''/g, "'")), "1000993 measures 502 responses of qnfo-ai and left the family module", c);
const now = Date.now();
const log = (minAgo, status) => db.prepare("INSERT INTO worker_logs (ts_ms, script_name, url, status) VALUES (?, 'qnfo-ai', 'https://qnfo-ai.internal/v1/chat/completions', ?)").run(now - minAgo * 60000, status);
ok(String(db.prepare(c.verify_probe).get().observed).startsWith("pending:"), "no telemetry in the last hour is a deferral", db.prepare(c.verify_probe).get());
log(5, 200); log(20, 504);
ok(db.prepare(c.verify_probe).get().observed === "0", "a 504 does not count against the 502 probe");
log(30, 502); log(500, 502);
ok(db.prepare(c.verify_probe).get().observed === "1", "one 502 inside six hours counts, the older one does not", db.prepare(c.verify_probe).get());

const doer = db.prepare("SELECT title, description, source, priority FROM agent_issues WHERE title LIKE 'ROUTER-LEGS-1:%'").all();
ok(doer.length === 1 && doer[0].source === "session:D1-observability" && doer[0].priority === "high", "the doer row is filed once", doer.length);
const d = doer[0].description;
ok(/\ncode-task: repo=qnfo-workers path=qnfo-ai-calibration\/worker\.js\n/.test(d) && /\ncode-anchor: .+\n/.test(d) && /\ncode-probe: \{"paths":\["qnfo-ai-calibration\/worker\.js"\],"contains":"ROUTER-LEGS-1"\}$/.test(d), "the description carries the code-task, code-anchor and code-probe lines");
const anchor = /\ncode-anchor: (.+)\n/.exec(d)[1];
const calib = readFileSync(new URL("../qnfo-ai-calibration/worker.js", import.meta.url), "utf8");
ok(calib.split(anchor).length - 1 <= 1, "the anchor occurs at most once in the calibration worker (zero once the doer has landed)", calib.split(anchor).length - 1);

db.exec(sql);
ok(get(db, "SELECT COUNT(*) n FROM agent_issues WHERE title LIKE 'ROUTER-LEGS-1:%'").n === 1 && get(db, "SELECT COUNT(*) n FROM decision_log WHERE action LIKE 'D1-OBSERVABILITY-DISPOSITIONS-1:%'").n === 1 && get(db, "SELECT COUNT(*) n FROM issue_fold_ledger").n === 1, "re-applying files, logs and folds nothing twice");

// no umbrella: 1001546 stays open
const db2 = mk(false);
db2.exec(sql);
ok(get(db2, "SELECT status FROM agent_issues WHERE id = 1001546").status === "open" && get(db2, "SELECT COUNT(*) n FROM issue_fold_ledger").n === 0, "without an open umbrella nothing is superseded");

console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
