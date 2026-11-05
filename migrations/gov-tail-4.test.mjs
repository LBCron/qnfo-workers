// GOV-TAIL-4 offline suite (migrations/2026-11-05-gov-tail-4.sql). Applies the migration on SQLite (node:sqlite) against fixtures shaped like the live tables and proves:
// the three PORTFOLIO-WRITE-FAILED-1 issues get the root cause once and a live probe (ok only when the newest portfolio_sync_runs row is ok, the measured status otherwise, a literal
// read-only select), the child issue PORTFOLIO-WRITE-VIA-PR-1 is filed once with the code-task, code-anchor and code-probe lines the intake reads (the anchor occurs once in the real
// qnfo-fleet-control/worker.js, a trusted session source), the two breach causes are mapped without overwriting a session's mapping, a replay changes nothing, the Rollback restores,
// and scripts/apply_migrations.py --check accepts the file. Run: node --no-warnings migrations/gov-tail-4.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const FILE = join(here, "2026-11-05-gov-tail-4.sql");
const sql = readFileSync(FILE, "utf8").replace(/\r\n/g, "\n");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };

const lines = sql.split("\n");
const hdr = (k) => (lines.find((l) => l.startsWith("-- " + k + ": ")) || "").slice(k.length + 4).trim();
const rollback = hdr("Rollback");
ok(hdr("APPLY-BY") === "ci" && hdr("DB") === "qnfo-audit", "the file opts in with APPLY-BY: ci and DB: qnfo-audit");
ok(lines.filter((l) => /^-- Rollback: /.test(l)).length === 1 && rollback.length > 300, "one single-line Rollback");
ok(!/decision_log/i.test(rollback), "the Rollback never touches decision_log (append-only)");
const body = lines.filter((l) => !l.startsWith("--")).join("\n");
ok(!/\bDROP\b/i.test(body) && !/\bDELETE\b/i.test(body), "the body deletes and drops nothing");
ok(!/claude\.ai|anthropic\.com/i.test(sql) && !/\[skip|skip[ -]ci|skip-checks/i.test(sql), "no claude.ai or anthropic.com link and no skip-CI token");
ok([...body.matchAll(/\bLIKE\s+'((?:[^']|'')*)'/gi)].every((m) => Buffer.byteLength(m[1]) <= 50), "every LIKE pattern is within D1's 50-byte limit");

const DDL = `
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, verify_probe TEXT NOT NULL, verify_transport TEXT, status TEXT, last_verdict TEXT, attempts INTEGER, next_due_at TEXT);
CREATE TABLE portfolio_sync_runs (id INTEGER PRIMARY KEY, ts TEXT, status TEXT, writes TEXT);
CREATE TABLE metric_breach_cause (metric_key TEXT PRIMARY KEY, cause_key TEXT NOT NULL, note TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
CREATE TRIGGER decision_log_no_delete BEFORE DELETE ON decision_log BEGIN SELECT RAISE(ABORT, 'DOCTRINE-1: decision_log is append-only (doctrine section 12)'); END;
CREATE TRIGGER decision_log_no_update BEFORE UPDATE ON decision_log BEGIN SELECT RAISE(ABORT, 'DOCTRINE-1: decision_log is append-only (doctrine section 12)'); END;
`;
const CIRC = "SELECT 'closed' AS expected, 'open' AS observed";
const WF = [1001804, 1001805, 1001806];
const fresh = () => {
  const db = new DatabaseSync(":memory:");
  db.exec(DDL);
  for (const id of WF) {
    db.prepare("INSERT INTO agent_issues (id, title, description, source, status) VALUES (?, ?, ?, 'loop-watch', 'open')").run(id, "PORTFOLIO-WRITE-FAILED-1: x" + id, "AUTO-FILED by LOOP-WATCH-1 " + id);
    db.prepare("INSERT INTO remediation_contracts VALUES (?, ?, ?, 'd1-query', 'superseded', 'superseded:closure-observing-probe-at-birth', 0, '2099-01-01 00:00:00')").run("issue-" + id, id, CIRC);
  }
  db.prepare("INSERT INTO metric_breach_cause VALUES ('observability_enabled_share', 'measurement', 'a session mapped it')").run();
  return db;
};
const db = fresh();
db.exec(sql);

for (const id of WF) {
  const a = db.prepare("SELECT description d FROM agent_issues WHERE id = ?").get(id).d;
  ok(a.startsWith("AUTO-FILED by LOOP-WATCH-1 " + id) && (a.match(/ROOT-CAUSE \(GOV-TAIL-4/g) || []).length === 1 && a.includes("26544275") && a.includes("portfolio_sync_runs 773"), "issue " + id + " keeps its text and gains the root cause once", a.slice(0, 120));
  const c = db.prepare("SELECT * FROM remediation_contracts WHERE class = ?").get("issue-" + id);
  ok(c.status === "active" && c.verify_transport === "d1-query" && c.last_verdict === null && c.attempts === 0, "contract " + id + " is live", c);
  ok(/^SELECT 'ok' AS expected/.test(c.verify_probe) && !c.verify_probe.includes(";") && !/update |attach |pragma |vacuum|insert into|delete from/i.test(c.verify_probe), "the probe is a literal read-only select");
}
{
  const p = db.prepare("SELECT verify_probe p FROM remediation_contracts WHERE class = 'issue-1001804'").get().p;
  const run = () => db.prepare(p).get();
  let r = run(); ok(r.expected === "ok" && r.observed === "the newest portfolio sync run is missing: ", "no run reads missing", r);
  db.exec(`INSERT INTO portfolio_sync_runs VALUES (772, '2026-11-04T15:05:50Z', 'ok', '[]'), (773, '2026-11-04T16:05:57Z', 'partial', '[{"path":"QNFO/qnfo-workers/docs/PORTFOLIO.md","status":"write-failed","note":"PUT HTTP 409 on main; attempts 3"}]')`);
  r = run(); ok(r.observed.startsWith("the newest portfolio sync run is partial: [{\"path\":\"QNFO/qnfo-workers/docs/PORTFOLIO.md\"") , "the newest partial run is the defect and names the write", r.observed);
  db.exec("INSERT INTO portfolio_sync_runs VALUES (779, '2026-11-05T01:05:50Z', 'ok', '[]')");
  r = run(); ok(r.observed === "ok", "an ok newest run reads ok", r);
}
// the child issue
{
  const rows = db.prepare("SELECT * FROM agent_issues WHERE instr(title, 'PORTFOLIO-WRITE-VIA-PR-1') = 1").all();
  ok(rows.length === 1, "one child issue", rows.length);
  const c = rows[0];
  ok(c.source.indexOf("session") === 0 && c.status === "open" && c.priority === "high", "a trusted session source, open, high", c);
  const lns = c.description.split("\n");
  ok(lns.includes("code-task: repo=qnfo-workers path=qnfo-fleet-control/worker.js"), "the code-task line is on a line of its own");
  const anchor = (lns.find((l) => l.startsWith("code-anchor: ")) || "").slice(13);
  ok(anchor === "async function pfCommitOnce(env, repo, path, content, message, mode) {", "the code-anchor line is the signature", anchor);
  const probe = lns.find((l) => l.startsWith("code-probe: "));
  let pj = null; try { pj = JSON.parse(probe.slice(12)); } catch { /* checked below */ }
  ok(pj && pj.paths[0] === "qnfo-fleet-control/worker.js" && pj.contains === "PORTFOLIO-WRITE-VIA-PR-1", "the code-probe line is JSON naming the marker", probe);
  // a function signature, never a body line: a body line stops matching once the code loop edits it (migrations/code-anchor-once.test.mjs); the live file was read for it on 2026-11-05
  ok(/^async function [A-Za-z0-9_]+\(.*\) \{$/.test(anchor), "the anchor is a function signature", anchor);
  ok(c.description.includes("26544275") && c.description.includes("charterCommitOnce") && c.description.includes("one pull request"), "the description names the rule, the second call site and the single reused pull request");
}
// causes
{
  ok(db.prepare("SELECT cause_key c FROM metric_breach_cause WHERE metric_key = 'human_wait_oldest_days'").get().c === "owner-routing", "human_wait_oldest_days is owner-routing");
  ok(db.prepare("SELECT cause_key c FROM metric_breach_cause WHERE metric_key = 'observability_enabled_share'").get().c === "measurement", "a session's mapping is not overwritten");
  const causes = new Set(["spend", "issue-backlog", "code-loop", "owner-routing", "publishing", "heartbeat", "structure", "measurement", "breach-doctor"]);
  ok(db.prepare("SELECT cause_key c FROM metric_breach_cause").all().every((r) => causes.has(r.c)), "every cause_key is one the vocabulary already uses");
}
// replay and rollback
{
  const snap = () => JSON.stringify(db.prepare("SELECT id, title, description FROM agent_issues ORDER BY id").all()) + JSON.stringify(db.prepare("SELECT class, verify_probe, status FROM remediation_contracts ORDER BY class").all());
  const before = snap();
  db.exec(sql);
  ok(before === snap(), "a replay changes nothing, files no second child and appends no second root cause");
  ok(db.prepare("SELECT COUNT(*) n FROM decision_log WHERE action LIKE 'GOV-TAIL-4:%'").get().n === 1, "one decision row");
  const rb = fresh(); rb.exec(sql); rb.exec(rollback);
  for (const id of WF) {
    ok(rb.prepare("SELECT description d FROM agent_issues WHERE id = ?").get(id).d === "AUTO-FILED by LOOP-WATCH-1 " + id, "Rollback restores the description of " + id);
    const c = rb.prepare("SELECT verify_probe p, status s, last_verdict v FROM remediation_contracts WHERE class = ?").get("issue-" + id);
    ok(c.p === CIRC && c.s === "superseded", "Rollback restores the contract of " + id, c);
  }
  ok(rb.prepare("SELECT COUNT(*) n FROM metric_breach_cause WHERE note = 'GOV-TAIL-4'").get().n === 0 && rb.prepare("SELECT cause_key c FROM metric_breach_cause WHERE metric_key = 'observability_enabled_share'").get().c === "measurement", "Rollback removes the row this file added and keeps the session's mapping");
}
{
  const r = spawnSync("python", ["scripts/apply_migrations.py", "--check", FILE], { cwd: root, encoding: "utf8" });
  ok(r.status === 0, "scripts/apply_migrations.py --check accepts the file", (r.stdout || "") + (r.stderr || ""));
}
console.log(fail ? fail + " failed, " + pass + " passed" : "all " + pass + " passed");
process.exit(fail ? 1 : 0);
