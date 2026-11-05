// ROADMAP-BUILT-VERIFY-1: the closing probes of the 24 built roadmap items are registered, runnable by the contract runners, and true on this checkout.
// Run: node migrations/roadmap-built-verify.test.mjs
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const sql = readFileSync(join(here, "2026-11-05-roadmap-built-verify.sql"), "utf8");
const IDS = [1618, 1619, 1620, 1621, 1672, 1673, 1674, 1675, 1687, 1689, 1700, 1705, 1707, 1708, 1711, 1712, 1721, 1738, 1796, 1798, 1799, 1801, 3108, 3110];
// scripts/remediation_consumer.py: HTTPS_HOSTS, parse_https_probe keys, WRITE_KW
const HOSTS = ["qnfo.org", "q08.org", "q08.workers.dev", "qwav.tech", "qwav.org", "qwav.uk", "qwav.net", "qwave.tech"];
const HTTPS_KEYS = new Set(["url", "status", "contains", "absent", "min_version", "max_ms", "redirect_to"]);
const WRITE_KW = ["insert into", "update ", "delete from", "drop table", "drop index", "alter table", "create table", "create index", "create trigger", "attach ", "detach ", "pragma ", "replace into", "vacuum"];

function world() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE roadmap_implementation (id INTEGER PRIMARY KEY, item TEXT NOT NULL, source TEXT NOT NULL DEFAULT 's', status TEXT NOT NULL, evidence TEXT, verified_at TEXT, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT NOT NULL, action TEXT NOT NULL, verify_probe TEXT NOT NULL, verify_transport TEXT NOT NULL, max_attempts INTEGER NOT NULL DEFAULT 3, escalate_to TEXT NOT NULL, expected_cadence_h INTEGER, status TEXT DEFAULT 'active', ts TEXT DEFAULT (datetime('now')), last_attempt_at TEXT, last_verdict TEXT, module TEXT, next_due_at TEXT);
    CREATE TABLE roadmap_gh_links (roadmap_id INTEGER PRIMARY KEY, gh_number INTEGER, gh_state TEXT);
    CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT NOT NULL, root_cause TEXT NOT NULL, remediation TEXT NOT NULL, detector TEXT NOT NULL, probe_class TEXT, first_seen TEXT NOT NULL, issue_id INTEGER, trigger_condition TEXT, symptom TEXT, blast_radius TEXT);
    CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT, outcome_matched INTEGER);
  `);
  // every (id, item) the migration names, as a built row created five days ago
  for (const m of sql.matchAll(/WHERE id = (\d+) AND item = '([^']+)' AND status IN/g))
    db.prepare("INSERT INTO roadmap_implementation (id, item, status, created_at) VALUES (?, ?, 'built', datetime('now', '-5 days'))").run(Number(m[1]), m[2]);
  db.exec("INSERT INTO roadmap_gh_links SELECT id, 1000 + id, 'open' FROM roadmap_implementation");
  return db;
}
const contracts = (db) => db.prepare("SELECT * FROM remediation_contracts WHERE module = 'roadmap-dod-v1' ORDER BY class").all();

test("one rm- contract per item, only for the right row in a built state, idempotent", () => {
  const db = world();
  db.exec(sql);
  const rows = contracts(db);
  assert.deepEqual(rows.map((r) => r.class).sort(), IDS.map((i) => "rm-" + i).sort());
  for (const r of rows) {
    assert.equal(r.issue_id, null); assert.equal(r.status, "active"); assert.equal(r.escalate_to, "qnfo-github-steward");
    assert.ok(r.max_attempts >= 24, "a contract that waits for a condition is not escalated after three misses");
    assert.ok(r.action.length > 60 && !/\bTODO\b/.test(r.action), "the action text is the proof written into the evidence");
    assert.ok(["d1-query", "runner-https", "code-read"].includes(r.verify_transport));
  }
  db.exec(sql);
  assert.equal(contracts(db).length, 24, "a second apply adds nothing");
  const dl = db.prepare("SELECT COUNT(*) c FROM decision_log WHERE action LIKE 'ROADMAP-BUILT-VERIFY-1:%'").get().c;
  assert.equal(dl, 1, "one decision_log row, not one per apply");
  // an item already verified (or with another item name at that id) gets no contract
  const db2 = world();
  db2.prepare("UPDATE roadmap_implementation SET status = 'verified' WHERE id = 1618").run();
  db2.prepare("UPDATE roadmap_implementation SET item = 'OTHER' WHERE id = 1619").run();
  db2.exec(sql);
  const ids2 = contracts(db2).map((r) => r.class);
  assert.ok(!ids2.includes("rm-1618") && !ids2.includes("rm-1619") && ids2.length === 22);
});

test("runner-https probes use only keys and hosts the runner accepts", () => {
  const db = world(); db.exec(sql);
  const https = contracts(db).filter((r) => r.verify_transport === "runner-https");
  assert.equal(https.length, 7);
  for (const r of https) {
    const p = JSON.parse(r.verify_probe);
    for (const k of Object.keys(p)) assert.ok(HTTPS_KEYS.has(k), r.class + " uses an unknown key " + k);
    const u = new URL(p.url); assert.equal(u.protocol, "https:");
    assert.ok(HOSTS.some((h) => u.hostname === h || u.hostname.endsWith("." + h)), r.class + " host " + u.hostname + " is not allowlisted");
    assert.ok(p.contains || p.min_version, r.class + " must check a marker or a version, not only a status");
    if (p.contains) assert.ok(p.contains.length <= 200);
  }
});

test("code-read probes are true on this checkout (case-sensitive, every path)", () => {
  const db = world(); db.exec(sql);
  const code = contracts(db).filter((r) => r.verify_transport === "code-read");
  assert.equal(code.length, 4);
  for (const r of code) {
    const p = JSON.parse(r.verify_probe);
    assert.ok(Array.isArray(p.paths) && p.paths.length && p.contains, r.class);
    for (const path of p.paths) {
      assert.ok(existsSync(join(root, path)), r.class + ": " + path + " exists");
      assert.ok(readFileSync(join(root, path), "utf8").includes(p.contains), r.class + ": " + path + " contains " + JSON.stringify(p.contains));
    }
  }
});

test("d1-query probes return the literal expected token, hold one statement and write nothing", () => {
  const db = world(); db.exec(sql);
  const d1 = contracts(db).filter((r) => r.verify_transport === "d1-query");
  assert.equal(d1.length, 24 - 11);
  for (const r of d1) {
    const t = r.verify_probe;
    assert.match(t, /^SELECT 'ok' AS expected, CASE WHEN .* THEN 'ok' ELSE '.*' END AS observed$/s, r.class + " must return 'ok' as expected and a CASE observed");
    assert.ok(!t.includes(";"), r.class + " holds one statement");
    for (const kw of WRITE_KW) assert.ok(!t.toLowerCase().includes(kw), r.class + " contains the write keyword " + kw);
    assert.ok(!/'<=|'>=/.test(t), "a comparator literal as expected can never pass");
  }
  // the one item that waits on a live event reads as a deferral (pending:) until it happens, never as a failure that exhausts the contract
  const yt17 = d1.find((r) => r.class === "rm-3110");
  assert.match(yt17.verify_probe, /ELSE 'pending: /);
});

test("the plus items wait on a healthy plus loop and on the statuses its steps write", () => {
  const db = world(); db.exec(sql);
  for (const id of [1798, 1799, 1801]) {
    const t = db.prepare("SELECT verify_probe FROM remediation_contracts WHERE class = ?").get("rm-" + id).verify_probe;
    assert.ok(t.includes("task_id = 'management-personas-plus' ORDER BY id DESC LIMIT 1) = 'ok'"), "rm-" + id + " requires the latest plus run to finish ok");
  }
  for (const id of [1799, 1801]) {
    const t = db.prepare("SELECT verify_probe FROM remediation_contracts WHERE class = ?").get("rm-" + id).verify_probe;
    assert.ok(t.includes("instr(sql, 'deployed') > 0"), "rm-" + id + " requires plus_ledger to admit the deployed status");
  }
});

test("the detector counts built rows older than 3 days that have no live rm- contract", () => {
  const db = world(); db.exec(sql);
  const probe = db.prepare("SELECT verify_probe FROM remediation_contracts WHERE class = 'fm-roadmap-built-unverified'").get().verify_probe;
  assert.deepEqual({ ...db.prepare(probe).get() }, { expected: "0", observed: "0" });
  db.prepare("INSERT INTO roadmap_implementation (id, item, status, created_at) VALUES (9001, 'LATE', 'deployed', datetime('now', '-4 days'))").run();
  db.prepare("INSERT INTO roadmap_implementation (id, item, status, created_at) VALUES (9002, 'NEW', 'built', datetime('now', '-1 hours'))").run();
  db.prepare("INSERT INTO roadmap_implementation (id, item, status, created_at) VALUES (9003, 'OUT-OF-SCOPE', 'built', datetime('now', '-40 days'))").run();
  db.exec("INSERT INTO roadmap_gh_links VALUES (9001, 9001, 'open'), (9002, 9002, 'open'), (9003, 9003, 'closed')");
  assert.equal(db.prepare(probe).get().observed, "1", "an old built row with an open mirror and no contract is counted; a new one and one whose mirror is closed are not");
  db.prepare("UPDATE remediation_contracts SET status = 'escalated' WHERE class = 'rm-1618'").run();
  assert.equal(db.prepare(probe).get().observed, "2", "an escalated contract no longer protects its item");
  db.prepare("UPDATE roadmap_implementation SET status = 'verified' WHERE id IN (1618, 9001)").run();
  assert.equal(db.prepare(probe).get().observed, "0", "a verified item is never counted");
});
