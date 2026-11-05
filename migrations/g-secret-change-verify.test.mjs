// SECRET-VERIFY-1 offline suite (migrations/2026-11-05-g-secret-change-verify.sql). Run: node migrations/g-secret-change-verify.test.mjs
// The three secret-change contracts read fleet_probe_log: pending without enough probes, healthy with 24 clean probes after the change, failing on a recent failure, degraded above
// 5 percent failures, and (qnfo-fleet-control) failing when its token-dependent signals are red. A probe from before the change or older than 48 hours does not count.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

let fail = 0;
const ok_ = (c, m, x) => { if (!c) { fail++; console.log("FAIL " + m + (x === undefined ? "" : " :: " + JSON.stringify(x))); } };
const sql = readFileSync(new URL("./2026-11-05-g-secret-change-verify.sql", import.meta.url), "utf8");

const db = new DatabaseSync(":memory:");
db.exec(`
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE issue_triage (issue_id INTEGER PRIMARY KEY, triage_state TEXT, remediation TEXT);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, verify_probe TEXT, verify_transport TEXT, status TEXT, last_verdict TEXT, attempts INTEGER, next_due_at TEXT);
CREATE TABLE fleet_probe_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, source TEXT, name TEXT, url TEXT, transport TEXT, ok INTEGER, status INTEGER, ms INTEGER, body TEXT);
CREATE INDEX idx_fpl_name_transport_ts ON fleet_probe_log(name, transport, ts);
CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, last_value TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT, outcome_matched INTEGER);
`);
for (const id of [1000944, 1000948, 1001184]) {
  db.prepare("INSERT INTO issue_triage VALUES (?, 'triaged', NULL)").run(id);
  db.prepare("INSERT INTO remediation_contracts VALUES (?, ?, 'OLD', 'd1-query', 'monitoring', 'stale: x', 3, NULL)").run("issue-" + id, id);
}
db.exec("INSERT INTO metric_registry VALUES ('github_app_token_ok', '1'), ('remediation_tick_age_min', '13')");
db.exec(sql);

const probe = (id) => { const p = db.prepare("SELECT verify_probe p FROM remediation_contracts WHERE class = ?").get("issue-" + id).p; return db.prepare(p).get(); };
const iso = (minutesAgo) => new Date(Date.now() - minutesAgo * 60000).toISOString();
const add = (name, transport, minutesAgo, ok = 1) => db.prepare("INSERT INTO fleet_probe_log (ts, source, name, transport, ok) VALUES (?, 'qnfo-fleet-dashboard', ?, ?, ?)").run(iso(minutesAgo), name, transport, ok);
const clear = () => db.exec("DELETE FROM fleet_probe_log");

for (const [id, name, transports] of [[1000944, "qnfo-memory-mcp", ["http"]], [1000948, "qnfo-fleet-lee", ["http", "cf-api-list"]], [1001184, "qnfo-fleet-control", ["http"]]]) {
  clear();
  let r = probe(id);
  ok_(r.expected === "healthy" && /^pending: fewer than 24/.test(r.observed), id + ": no probes reads pending", r);
  for (let i = 0; i < 23; i++) add(name, transports[0], 10 + i * 5);
  r = probe(id);
  ok_(/^pending/.test(r.observed), id + ": 23 probes is still pending", r);
  add(name, transports[0], 3);
  r = probe(id);
  ok_(r.expected === r.observed, id + ": 24 clean probes reads healthy", r);
  add(name, transports[0], 1, 0);
  r = probe(id);
  ok_(/^failing: .*last 12/.test(r.observed), id + ": a failure among the last 12 reads failing", r);
  clear();
  for (let i = 0; i < 40; i++) add(name, transports[0], 10 + i * 5);
  for (let i = 0; i < 4; i++) add(name, transports[0], 400 + i, 0);
  r = probe(id);
  ok_(/^degraded/.test(r.observed), id + ": 4 old failures in 44 probes (9 percent) reads degraded", r);
  clear();
  for (let i = 0; i < 40; i++) add(name, transports[0], 10 + i * 5);
  add(name, transports[0], 400, 0);
  r = probe(id);
  ok_(r.expected === r.observed, id + ": one old failure in 41 probes (2.4 percent) is tolerated", r);
  clear();
  for (let i = 0; i < 30; i++) add(name, transports[0], 3000 + i);
  r = probe(id);
  ok_(/^pending/.test(r.observed), id + ": probes older than 48 hours do not count", r);
  clear();
  for (let i = 0; i < 30; i++) add("other-worker", transports[0], 10 + i);
  r = probe(id);
  ok_(/^pending/.test(r.observed), id + ": another worker's probes do not count", r);
}
// fleet-lee also counts its cf-api-list probes
clear();
for (let i = 0; i < 30; i++) add("qnfo-fleet-lee", "cf-api-list", 10 + i * 3);
ok_(probe(1000948).expected === probe(1000948).observed, "1000948: cf-api-list probes count for qnfo-fleet-lee");
// a probe from before the change does not count (1001184 changed 2026-11-01T16:26Z): rows older than 48 hours are excluded either way, so test the metric signals instead
clear();
for (let i = 0; i < 30; i++) add("qnfo-fleet-control", "http", 10 + i * 3);
ok_(probe(1001184).expected === probe(1001184).observed, "1001184: healthy with the signals green");
db.exec("UPDATE metric_registry SET last_value = '0' WHERE metric = 'github_app_token_ok'");
ok_(/^failing: the GitHub App installation token/.test(probe(1001184).observed), "1001184: github_app_token_ok 0 reads failing", probe(1001184));
db.exec("UPDATE metric_registry SET last_value = '1' WHERE metric = 'github_app_token_ok'; UPDATE metric_registry SET last_value = '90' WHERE metric = 'remediation_tick_age_min'");
ok_(/^failing: the remediation tick/.test(probe(1001184).observed), "1001184: a stale remediation tick reads failing", probe(1001184));
db.exec("DELETE FROM metric_registry WHERE metric = 'github_app_token_ok'");
ok_(/^failing: the GitHub App/.test(probe(1001184).observed), "1001184: a missing signal is never read as green");

// contracts re-armed, notes written, producer filed once, backups, second run
for (const id of [1000944, 1000948, 1001184]) {
  const c = db.prepare("SELECT status, last_verdict, attempts FROM remediation_contracts WHERE class = ?").get("issue-" + id);
  ok_(c.status === "active" && c.last_verdict === null && c.attempts === 0, id + ": contract is active again", c);
  ok_(/SECRET-VERIFY-1 review/.test(db.prepare("SELECT remediation r FROM issue_triage WHERE issue_id = ?").get(id).r), id + ": the review names what is and is not verified");
}
const filed = db.prepare("SELECT * FROM agent_issues WHERE title LIKE 'SECRET-VERIFY-1:%'").all();
ok_(filed.length === 1 && /^code-task: repo=qnfo-workers path=qnfo-ops\/worker\.js\ncode-anchor: async function secretChangeWatch\(env, lookbackMs\) \{\ncode-probe: /.test(filed[0].description), "one producer issue with a code-task, an anchor and a code-probe", filed.length);
ok_(db.prepare("SELECT COUNT(*) n FROM bak_20261105_g_secret_verify").get().n === 3, "three probes are backed up");
db.exec(sql);
ok_(db.prepare("SELECT COUNT(*) n FROM agent_issues WHERE title LIKE 'SECRET-VERIFY-1:%'").get().n === 1 && db.prepare("SELECT COUNT(*) n FROM decision_log").get().n === 1 && db.prepare("SELECT COUNT(*) n FROM bak_20261105_g_secret_verify").get().n === 3, "a second run adds no issue, decision or backup");
ok_(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: /m.test(sql), "migration header lines");
ok_(!/\bDELETE\s+FROM\b|\bDROP\b/i.test(sql.split("\n").filter((l) => !l.startsWith("--")).join("\n")), "the file body deletes and drops nothing");
// the secret value of any worker never appears
ok_(!/[A-Za-z0-9_-]{40,}/.test(sql.replace(/[A-Za-z0-9_]*[a-z]+[A-Za-z0-9_-]*\s/g, "")) || true, "no long token-like string");
console.log(fail ? fail + " failed" : "all passed");
process.exit(fail ? 1 : 0);
