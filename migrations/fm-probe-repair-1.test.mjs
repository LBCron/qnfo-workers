// FM-PROBE-REPAIR-1 (2026-11-05, pillar autonomy): six failure-mode detectors read their real defect again, 302 historic id-less events get ids,
// three directive-newline descriptions are repaired and the hourly hygiene task sweeps later ones.
// Replays the touched tables with a few rows each, applies the migration twice, runs the new SQL probes and the sweep step.
// Run: node --no-warnings migrations/fm-probe-repair-1.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync } from "node:fs";
import assert from "node:assert/strict";

const mig = readFileSync(new URL("./2026-11-05-fm-probe-repair-1.sql", import.meta.url), "utf8");
assert.match(mig, /^-- APPLY-BY: ci$/m);
assert.match(mig, /^-- DB: qnfo-audit$/m);
assert.match(mig, /^-- BACKUP: bak_20261105_fm_probe_repair_1$/m);
assert.match(mig, /^-- Rollback: /m);
assert.match(mig, /^-- CAUSE-MAPPED: /m);
const bare = mig.replace(/^--.*$/gm, "");
assert.ok(!/\bDELETE FROM\b|\bDROP\b/i.test(bare), "no destructive statement: every replaced value is in a backup table");
assert.ok(!/\bLIKE\s+'[^']{50,}'/i.test(bare), "no LIKE pattern over D1's 50-byte limit");

const db = new DatabaseSync(":memory:");
db.exec(`
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER, expected_cadence_h INTEGER, status TEXT,
  precondition TEXT NOT NULL DEFAULT '', action TEXT NOT NULL DEFAULT '', escalate_to TEXT NOT NULL DEFAULT '', module TEXT, next_due_at TEXT, last_verdict TEXT);
CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT, root_cause TEXT, remediation TEXT NOT NULL DEFAULT '', detector TEXT NOT NULL DEFAULT '', probe_class TEXT, first_seen TEXT);
CREATE TABLE cloud_ops_events (id TEXT PRIMARY KEY, ts TEXT, kind TEXT, text TEXT);
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, status TEXT, description TEXT, updated_at INTEGER);
CREATE TABLE fleet_tasks (id TEXT PRIMARY KEY, name TEXT NOT NULL, definition TEXT NOT NULL, version INTEGER DEFAULT 1, updated_at TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, surfaces_tested TEXT);
CREATE TABLE remediation_verifications (id INTEGER PRIMARY KEY AUTOINCREMENT, issue_id INTEGER, class TEXT, action_ref INTEGER, verified_at TEXT, pass INTEGER, observed TEXT, verifier TEXT);
CREATE INDEX i1 ON remediation_verifications (issue_id, verified_at);
CREATE INDEX i2 ON remediation_verifications (class, verified_at);
CREATE INDEX i3 ON remediation_verifications (verified_at);
CREATE INDEX i4 ON remediation_verifications (class, id);
CREATE INDEX i5 ON remediation_verifications (action_ref, id);
CREATE INDEX i6 ON remediation_verifications (verifier, verified_at);
CREATE INDEX i7 ON remediation_verifications (issue_id, class, verified_at);
CREATE INDEX idx_rv_pending_fail ON remediation_verifications (verified_at) WHERE pass = 0 AND lower(trim(observed)) LIKE 'pending%';
`);
const cls = ["fm-code-loop-budget-claim-starvation", "fm-zaraz-autoinject-worker-html", "fm-edge-copy-version-skew", "fm-q08-writer-yield-order", "fm-d1-like-pattern-length", "fm-redundant-indexes"];
const LIVE_TRANSPORT = { "fm-code-loop-budget-claim-starvation": "code-read", "fm-zaraz-autoinject-worker-html": "runner-https", "fm-edge-copy-version-skew": "runner-https", "fm-q08-writer-yield-order": "code-read", "fm-d1-like-pattern-length": "d1-query", "fm-redundant-indexes": "d1-query" };
for (const c of cls) db.prepare("INSERT INTO remediation_contracts (class, verify_probe, verify_transport, status, expected_cadence_h) VALUES (?, 'old', ?, 'active', 1)").run(c, LIVE_TRANSPORT[c]);
for (const k of ["code-loop-budget-claim-starvation", "zaraz-autoinject-worker-html", "edge-copy-version-skew", "q08-writer-yield-order", "d1-like-pattern-length", "redundant-indexes"]) db.prepare("INSERT INTO failure_modes (fm_key, remediation, detector, probe_class, first_seen) VALUES (?, 'r', 'd', ?, '2026-10-01')").run(k, "fm-" + k);
db.exec("INSERT INTO failure_modes (fm_key, remediation, detector, probe_class, first_seen) VALUES ('writer-order-by-proxy', 'r', 'd', NULL, '2026-10-26')");
db.exec("INSERT INTO cloud_ops_events (id, ts, kind, text) VALUES (NULL, '2026-11-01T11:00:00Z', 'errata_confirm_defer', 'x'), (NULL, '2026-10-24T14:00:00Z', 'owner_queue_audit', 'y'), ('keep-1', '2026-11-04T10:00:00Z', 'obs', 'z')");
const NL = "\\n";
db.prepare("INSERT INTO agent_issues VALUES (1893, 'open', ?, 1), (7, 'open', 'clean text', 1), (8, 'closed', ?, 1)").run(
  "body " + NL + "code-task: repo=qnfo-workers path=a/worker.js" + NL + "code-anchor: foo", "closed " + NL + "code-task: repo=x path=y");
db.prepare("INSERT INTO fleet_tasks (id, name, definition) VALUES ('t1', 'ISSUE-HYGIENE-1: close a ticket about a record when that record is resolved', ?), ('t2', 'OTHER task', ?)").run(
  JSON.stringify({ steps: [{ type: "sql", db: "AUDIT", sql: "SELECT 1" }] }), JSON.stringify({ steps: [] }));

db.exec(mig);
db.exec(mig); // idempotent

const probe = (c) => db.prepare("SELECT verify_probe p, verify_transport t FROM remediation_contracts WHERE class = ?").get(c);
// (1)-(4) code-read and runner-https probes are well-formed JSON that names a marker
for (const c of ["fm-code-loop-budget-claim-starvation", "fm-zaraz-autoinject-worker-html", "fm-edge-copy-version-skew", "fm-q08-writer-yield-order", "fm-writer-order-by-proxy"]) {
  const p = probe(c);
  const j = JSON.parse(p.p);
  assert.ok(j.contains && j.contains.length > 10, c + " names a marker");
  assert.ok(p.t === "code-read" ? Array.isArray(j.paths) : j.url && j.status === 200, c + " has the shape of its transport");
}
assert.equal(probe("fm-zaraz-autoinject-worker-html").t, "runner-https");
assert.equal(probe("fm-edge-copy-version-skew").t, "code-read");
assert.equal(JSON.parse(probe("fm-q08-writer-yield-order").p).contains, JSON.parse(probe("fm-writer-order-by-proxy").p).contains, "both writer-order modes read the one current array");
assert.match(JSON.parse(probe("fm-q08-writer-yield-order").p).contains, /nemotron-3-120b-a12b",\n  "@cf\/openai\/gpt-oss-120b",\n  "@cf\/moonshotai\/kimi-k2\.6",$/);
assert.equal(db.prepare("SELECT probe_class FROM failure_modes WHERE fm_key = 'writer-order-by-proxy'").get().probe_class, "fm-writer-order-by-proxy");
assert.equal(db.prepare("SELECT COUNT(*) n FROM remediation_contracts WHERE class = 'fm-writer-order-by-proxy'").get().n, 1);
// the markers exist on this checkout (the detectors would pass)
const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
for (const c of ["fm-code-loop-budget-claim-starvation", "fm-edge-copy-version-skew", "fm-q08-writer-yield-order"]) {
  const j = JSON.parse(probe(c).p);
  for (const f of j.paths) if (existsSync(new URL("../" + f, import.meta.url))) assert.ok(read(f).includes(j.contains), c + ": marker present in " + f);
}

// (5) the LIKE-length detector counts a LIKE error event, not an overload
db.exec("INSERT INTO agent_issues VALUES (1001233, 'open', 'a', 1), (2157, 'open', 'b', 1)");
db.exec("INSERT INTO remediation_contracts (class, status, last_verdict, verify_probe, verify_transport) VALUES ('issue-1001233', 'active', 'probe-error', 'p', 'd1-query'), ('issue-2157', 'active', 'probe-error', 'p', 'd1-query')");
const now = new Date().toISOString();
db.prepare("INSERT INTO cloud_ops_events (id, ts, kind, text) VALUES ('e1', ?, 'remediation.probe-error', 'class=issue-1001233 transport=d1-query error=HTTP 429 D1 DB is overloaded')").run(now);
const likeProbe = db.prepare("SELECT verify_probe p FROM remediation_contracts WHERE class = 'fm-d1-like-pattern-length'").get().p;
assert.deepEqual({ ...db.prepare(likeProbe).get() }, { expected: "0", observed: "0" }, "an overload error is not a LIKE-length error");
db.prepare("INSERT INTO cloud_ops_events (id, ts, kind, text) VALUES ('e2', ?, 'remediation.probe-error', 'class=issue-2157 transport=d1-query error=D1_ERROR: LIKE or GLOB pattern too complex')").run(now);
assert.deepEqual({ ...db.prepare(likeProbe).get() }, { expected: "0", observed: "1" }, "a LIKE error on an open issue contract is counted");
assert.ok(!/;/.test(likeProbe), "no semicolon in a d1-query probe");

// (6) 7 full + 1 partial index passes; an eighth full index fails
const idxProbe = db.prepare("SELECT verify_probe p FROM remediation_contracts WHERE class = 'fm-redundant-indexes'").get().p;
assert.deepEqual({ ...db.prepare(idxProbe).get() }, { expected: "0", observed: "0" }, "seven full indexes and one partial one pass");
db.exec("CREATE INDEX i8 ON remediation_verifications (pass, class)");
assert.deepEqual({ ...db.prepare(idxProbe).get() }, { expected: "0", observed: "1" }, "an eighth full index is counted");
db.exec("DROP INDEX i8");

// (7) ids
assert.equal(db.prepare("SELECT COUNT(*) n FROM cloud_ops_events WHERE id IS NULL").get().n, 0, "every event has an id");
assert.equal(db.prepare("SELECT id FROM cloud_ops_events WHERE kind = 'obs'").get().id, "keep-1", "an existing id is kept");
assert.equal(db.prepare("SELECT COUNT(*) n FROM bak_20261105_coe_null_id").get().n, 2, "the backup holds the two id-less rows");

// (8) directive newlines
const d = (id) => db.prepare("SELECT description FROM agent_issues WHERE id = ?").get(id).description;
assert.ok(!d(1893).includes("\\n") && d(1893).includes("\ncode-task: repo=qnfo-workers path=a/worker.js\ncode-anchor: foo"), "the open issue is repaired");
assert.equal(d(7), "clean text");
assert.ok(d(8).includes("\\ncode-task:"), "a closed issue is left alone");
const step = JSON.parse(db.prepare("SELECT definition FROM fleet_tasks WHERE id = 't1'").get().definition).steps.find((s) => s.name === "directive-newline-sweep");
assert.ok(step && step.type === "sql" && step.db === "AUDIT", "the sweep step is in the hygiene task");
assert.equal(db.prepare("SELECT definition FROM fleet_tasks WHERE id = 't1'").get().definition.split("directive-newline-sweep").length, 2, "one copy after two applies");
assert.equal(db.prepare("SELECT definition FROM fleet_tasks WHERE id = 't2'").get().definition, JSON.stringify({ steps: [] }), "other tasks are untouched");
assert.equal(db.prepare("SELECT version FROM fleet_tasks WHERE id = 't1'").get().version, 2, "the task version moved once");
db.prepare("INSERT INTO agent_issues VALUES (99, 'open', ?, 1)").run("again " + NL + "runtime-probe: {} " + NL + "session-task: x");
db.exec(step.sql);
assert.ok(d(99).includes("\nruntime-probe:") && d(99).includes("\nsession-task:") && !d(99).includes("\\n"), "the sweep step repairs a later description");
assert.ok(!/\\n/.test(step.sql.replace(/char\(92\)/g, "")), "the step carries no backslash that JSON would mangle");

assert.equal(db.prepare("SELECT COUNT(*) n FROM decision_log WHERE action LIKE 'FM-PROBE-REPAIR-1:%'").get().n, 1);
console.log("fm-probe-repair-1: ok");
