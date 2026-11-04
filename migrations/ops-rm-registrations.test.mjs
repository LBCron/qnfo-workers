// OPS-RM-SLICES-1: migrations/2026-11-05-ops-rm-registrations.sql replaces five contract probes, registers composio and the OAuth broker, files two IDENTITY-BOUND cards and three ROADMAP-1
// remainders. Applied twice to a fixture of the affected tables: the effects land once, the new probes run and tell a missing proof from a present one, and every code-anchor of a filed
// remainder occurs exactly once in the file it names.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const sql = readFileSync(new URL("./2026-11-05-ops-rm-registrations.sql", import.meta.url), "utf8");
const root = new URL("../", import.meta.url);
const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT NOT NULL, verify_transport TEXT NOT NULL,
    max_attempts INTEGER DEFAULT 3, escalate_to TEXT, expected_cadence_h INTEGER, status TEXT DEFAULT 'active', last_verdict TEXT, attempts INTEGER DEFAULT 0, next_due_at TEXT, module TEXT);
  CREATE TABLE roadmap_implementation (id INTEGER PRIMARY KEY, item TEXT, source TEXT, title TEXT, artifact_type TEXT, artifact_ref TEXT, status TEXT NOT NULL, evidence TEXT, verified_at TEXT);
  CREATE TABLE capability_ledger (capability TEXT, provenance TEXT NOT NULL, prerequisites TEXT, reliability TEXT, acquired_at TEXT NOT NULL, last_exercised_at TEXT, evidence TEXT NOT NULL);
  CREATE TABLE agent_tool_allowlist (surface TEXT NOT NULL, kind TEXT NOT NULL, pattern TEXT NOT NULL, note TEXT, enabled INTEGER NOT NULL DEFAULT 1, added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')));
  CREATE TABLE human_actions (id INTEGER PRIMARY KEY, slug TEXT UNIQUE, title TEXT NOT NULL, why TEXT, default_in_effect TEXT, action TEXT, url TEXT, sev TEXT DEFAULT 'normal', due TEXT, status TEXT DEFAULT 'open', source TEXT);
  CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT NOT NULL, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);
  CREATE TABLE decision_log (id INTEGER PRIMARY KEY, actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT NOT NULL, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
  CREATE TABLE cloud_ops_events (id TEXT PRIMARY KEY, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT);
  CREATE TABLE oauth_broker_records (record_id TEXT PRIMARY KEY, provider TEXT, data_plane TEXT, record_type TEXT, encrypted_payload TEXT, expires_at INTEGER, lease_until INTEGER DEFAULT 0, call_count INTEGER DEFAULT 0, last_called_at INTEGER, updated_at INTEGER);
`);
for (const id of [1000639, 1000649, 1000650, 1000794, 1000807]) {
  db.prepare("INSERT INTO remediation_contracts (class, issue_id, verify_probe, verify_transport, last_verdict, attempts) VALUES (?, ?, 'SELECT old', 'd1-query', 'fail', 2)").run("issue-" + id, id);
}
for (const id of [1683, 1692, 1693, 1802, 1808]) db.prepare("INSERT INTO roadmap_implementation (id, status, evidence) VALUES (?, 'planned', 'docs/x.md')").run(id);

db.exec(sql);
db.exec(sql); // idempotent: the second run adds nothing

const count = (q) => db.prepare(q).get().n;
assert.equal(count("SELECT COUNT(*) AS n FROM capability_ledger"), 4, "four capabilities, once");
assert.equal(count("SELECT COUNT(*) AS n FROM agent_tool_allowlist WHERE pattern IN ('composio_execute', 'composio_status')"), 2);
assert.equal(count("SELECT COUNT(*) AS n FROM human_actions WHERE slug IN ('composio-account-1', 'oauth-broker-clients-1')"), 2);
assert.equal(count("SELECT COUNT(*) AS n FROM agent_issues"), 3, "three remainders, once");
assert.equal(count("SELECT COUNT(*) AS n FROM decision_log"), 1);
assert.equal(count("SELECT COUNT(*) AS n FROM bak_20261105_ops_rm_contracts"), 5, "the old probes are backed up");
assert.equal(count("SELECT COUNT(*) AS n FROM roadmap_implementation WHERE status = 'partial' AND evidence LIKE 'docs/x.md | OPS-RM-SLICES-1%'"), 5, "the roadmap mirrors are partial, with their old evidence kept");

// the owner cards are IDENTITY-BOUND and name the contract that closes the issue
for (const card of db.prepare("SELECT slug, why, action, default_in_effect FROM human_actions").all()) {
  assert.match(card.why, /^IDENTITY-BOUND:/, card.slug + " carries the IDENTITY-BOUND line");
  assert.match(card.why, /Closing probe: remediation_contracts class issue-100\d+/);
  assert.ok(card.default_in_effect.length > 20 && card.action.length > 50);
  assert.ok(!/(sk-|ghp_|xox[bp]-|secret=|key=)/i.test(JSON.stringify(card)), "no secret value in a card");
}

// code-read probes: valid JSON, existing files, and the marker names a MEASUREMENT heading that is not in the doc yet only because the measurement is not done
const contract = (id) => db.prepare("SELECT verify_probe, verify_transport, last_verdict, attempts, status FROM remediation_contracts WHERE class = ?").get("issue-" + id);
for (const id of [1000639, 1000650, 1000649]) {
  const c = contract(id);
  assert.equal(c.verify_transport, "code-read");
  assert.equal(c.last_verdict, null, "a replaced probe starts without a verdict");
  assert.equal(c.attempts, 0);
  const p = JSON.parse(c.verify_probe);
  assert.ok(p.paths.every((f) => existsSync(new URL(f, root))), "probe paths exist: " + p.paths);
  assert.match(p.contains, /^## (Result on 20 tasks|Result on 20 long tasks|Replay result)$/);
}
// 1000649 is the one whose measurement shipped with the change: the heading is there
assert.ok(readFileSync(new URL("docs/POLICY-GATE-REPLAY.md", root), "utf8").includes(JSON.parse(contract(1000649).verify_probe).contains), "the replay result is recorded");

// d1 probes: they run, and a missing proof differs from a present one
function run(id) {
  const c = contract(id);
  assert.equal(c.verify_transport, "d1-query");
  assert.ok(!c.verify_probe.includes(";"), "no semicolon in a probe (PROBE-SEMICOLON-LINT-1)");
  const r = db.prepare(c.verify_probe).get();
  return r;
}
let r = run(1000794);
assert.notEqual(r.observed, r.expected, "no composio call yet: the probe fails honestly");
assert.match(r.observed, /composio-account-1/, "and names the card that is the blocker");
db.prepare("INSERT INTO cloud_ops_events (id, ts, kind, text, status) VALUES ('e1', 't', 'ops_ai_tool', 'composio_execute', 'error')").run();
assert.notEqual(run(1000794).observed, run(1000794).expected, "an error call is not a live read");
db.prepare("INSERT INTO cloud_ops_events (id, ts, kind, text, status) VALUES ('e2', 't', 'ops_ai_tool', 'composio_execute', 'ok')").run();
r = run(1000794);
assert.equal(r.observed, r.expected, "an ok composio_execute passes");

r = run(1000807);
assert.notEqual(r.observed, r.expected);
assert.match(r.observed, /oauth-broker-clients-1/);
db.prepare("INSERT INTO oauth_broker_records (record_id, provider, data_plane, record_type, encrypted_payload, expires_at, call_count) VALUES ('r1', 'google', 'research', 'state', 'x', 1, 5)").run();
assert.notEqual(run(1000807).observed, run(1000807).expected, "a state record that was called is not a token");
db.prepare("INSERT INTO oauth_broker_records (record_id, provider, data_plane, record_type, encrypted_payload, expires_at, call_count) VALUES ('r2', 'google', 'research', 'token', 'x', 1, 0)").run();
assert.notEqual(run(1000807).observed, run(1000807).expected, "a stored token that has served no call is not a read");
db.prepare("UPDATE oauth_broker_records SET call_count = 1 WHERE record_id = 'r2'").run();
r = run(1000807);
assert.equal(r.observed, r.expected, "a token record that served a call passes");

// remainders: a doer (code-task and a code-anchor that occurs once in the named file), a charter pillar, a definition of done
for (const issue of db.prepare("SELECT title, description FROM agent_issues").all()) {
  assert.match(issue.title, /^ROADMAP-1: QNFO\.OPS RM-[A-Z-]+-1\.2: /);
  const m = issue.description.match(/^code-task: repo=qnfo-workers path=(\S+)\ncode-anchor: (.+)$/m);
  assert.ok(m, issue.title + " starts with a code-task and a code-anchor");
  const file = readFileSync(new URL(m[1], root), "utf8").replace(/\r\n/g, "\n");
  assert.equal(file.split(m[2]).length - 1, 1, "the code-anchor occurs once in " + m[1]);
  assert.match(issue.description, /Charter pillar/);
  assert.match(issue.description, /Definition of done/);
}
console.log("ops-rm-registrations tests: ok");
