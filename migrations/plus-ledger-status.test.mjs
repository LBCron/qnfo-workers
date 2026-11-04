// PLUS-LEDGER-STATUS-1: plus_ledger admits every status the plus steps write, keeps its rows and ids, and the file converges when re-run after a failure part way.
// The fixture uses the DDL the live table has (read from sqlite_master on 2026-11-05), not the DDL the PLUS-1 migration intended.
// Run: node migrations/plus-ledger-status.test.mjs
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(here, "2026-11-05-plus-ledger-status.sql"), "utf8");
const LIVE_LEDGER = "CREATE TABLE plus_ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, product_slug TEXT NOT NULL REFERENCES products(slug), plus TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','shipped','kept','reverted')), metric TEXT, predicted TEXT, measured TEXT, shipped_at TEXT, decided_at TEXT NOT NULL DEFAULT (datetime('now')), product TEXT, kind TEXT, title TEXT, evidence TEXT, predicted_outcome TEXT, issue_id INTEGER, pr_url TEXT, outcome TEXT, created_at TEXT)";
const STATUSES = ["proposed", "building", "deployed", "rejected", "shipped", "kept", "reverting", "reverted"];

function world() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`
    CREATE TABLE products (slug TEXT PRIMARY KEY, name TEXT NOT NULL, surface TEXT NOT NULL, owner_worker TEXT, repo TEXT NOT NULL DEFAULT 'QNFO/qnfo-workers', path TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE product_registry (product TEXT PRIMARY KEY, host TEXT, worker TEXT, program_code TEXT NOT NULL, what_for TEXT, usage_metric TEXT, quality_measure TEXT, plus_cadence_h INTEGER NOT NULL DEFAULT 168, last_plus_at TEXT, rest_until TEXT, misses_in_row INTEGER NOT NULL DEFAULT 0, pluses_since_simplify INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT 'active', created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')));
    CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT NOT NULL, root_cause TEXT NOT NULL, remediation TEXT NOT NULL, detector TEXT NOT NULL, probe_class TEXT, first_seen TEXT NOT NULL, issue_id INTEGER, trigger_condition TEXT, symptom TEXT, blast_radius TEXT);
    CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT NOT NULL, action TEXT NOT NULL, verify_probe TEXT NOT NULL, verify_transport TEXT NOT NULL, max_attempts INTEGER NOT NULL DEFAULT 3, escalate_to TEXT NOT NULL, expected_cadence_h INTEGER, status TEXT DEFAULT 'active', ts TEXT DEFAULT (datetime('now')), last_attempt_at TEXT, last_verdict TEXT, module TEXT, next_due_at TEXT);
    CREATE TABLE fleet_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, status TEXT NOT NULL, error TEXT);
    CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT, outcome_matched INTEGER);
  `);
  db.exec(LIVE_LEDGER);
  db.exec("CREATE INDEX idx_plus_ledger_product ON plus_ledger(product_slug, status)");
  db.exec("CREATE VIEW v_product_plus_debt AS SELECT p.slug, MAX(COALESCE(l.shipped_at, p.created_at)) AS last_plus_at FROM products p LEFT JOIN plus_ledger l ON l.product_slug = p.slug AND l.status IN ('shipped','kept') GROUP BY p.slug");
  db.exec("CREATE VIEW v_product_plus_due AS SELECT p.product, (SELECT COUNT(*) FROM plus_ledger l WHERE l.product = p.product AND l.status IN ('proposed','building','reverting')) AS in_flight FROM product_registry p WHERE p.state = 'active'");
  db.exec("INSERT INTO products (slug, name, surface) VALUES ('companion-today', 'Today', 'me.q08.org'), ('jobs', 'Jobs', 'jobs.q08.org')");
  db.exec("INSERT INTO product_registry (product, program_code) VALUES ('companion-today', 'QNFO.PERSONAL'), ('jobs', 'QNFO.PERSONAL')");
  db.exec("INSERT INTO plus_ledger (id, product_slug, plus, status, product, evidence, decided_at) VALUES (1, 'companion-today', 'PLUS-1 card', 'proposed', 'companion-today', 'legacy', '2026-10-29 12:29:00'), (2, 'jobs', 'group stretch', 'proposed', 'jobs', 'proposal #2152 (x)', '2026-11-04 19:52:46')");
  return db;
}

test("the live table refuses the statuses the plus steps write (the defect)", () => {
  const db = world();
  for (const s of ["building", "deployed", "rejected", "reverting"]) assert.throws(() => db.prepare("UPDATE plus_ledger SET status = ? WHERE id = 2").run(s), /CHECK constraint failed/);
});

test("after the migration every status in use is admitted, an unknown one is not, and the rows survive", () => {
  const db = world();
  db.exec(sql);
  assert.deepEqual(db.prepare("SELECT id, product_slug, status, evidence FROM plus_ledger ORDER BY id").all().map((r) => ({ ...r })), [
    { id: 1, product_slug: "companion-today", status: "proposed", evidence: "legacy" },
    { id: 2, product_slug: "jobs", status: "proposed", evidence: "proposal #2152 (x)" }]);
  for (const s of STATUSES) db.prepare("UPDATE plus_ledger SET status = ? WHERE id = 2").run(s);
  assert.throws(() => db.prepare("UPDATE plus_ledger SET status = 'abandoned' WHERE id = 2").run(), /CHECK constraint failed/);
  assert.throws(() => db.prepare("INSERT INTO plus_ledger (product_slug, plus) VALUES ('nope', 'x')").run(), /FOREIGN KEY constraint failed/, "the products reference stays");
  const next = db.prepare("INSERT INTO plus_ledger (product_slug, plus, product) VALUES ('jobs', 'next', 'jobs')").run();
  assert.equal(Number(next.lastInsertRowid), 3, "ids continue after the copied rows");
  assert.equal(db.prepare("SELECT status FROM plus_ledger WHERE id = 3").get().status, "proposed", "the default status is kept");
  assert.equal(db.prepare("SELECT COUNT(*) c FROM bak_20261105_plus_ledger").get().c, 2, "the backup holds the original rows");
});

test("the index and both views are back and read the new table", () => {
  const db = world(); db.exec(sql);
  const names = db.prepare("SELECT name FROM sqlite_master WHERE name IN ('idx_plus_ledger_product', 'v_product_plus_due', 'v_product_plus_debt', 'plus_ledger', 'plus_ledger_v2') ORDER BY name").all().map((r) => r.name);
  assert.deepEqual(names, ["idx_plus_ledger_product", "plus_ledger", "v_product_plus_debt", "v_product_plus_due"], "no plus_ledger_v2 is left behind");
  db.prepare("UPDATE plus_ledger SET status = 'building' WHERE id = 2").run();
  db.exec("UPDATE product_registry SET created_at = '2026-01-01T00:00:00Z'");
  const due = db.prepare("SELECT in_flight FROM v_product_plus_due ORDER BY product").all();
  assert.equal(due.find((r, i) => i === 1).in_flight, 1);
  assert.doesNotThrow(() => db.prepare("SELECT * FROM v_product_plus_debt").all());
  assert.match(db.prepare("SELECT sql FROM sqlite_master WHERE name = 'plus_ledger'").get().sql, /'building'/);
});

test("a re-run after a failure part way converges (after the drop, before the rename; and a plain second apply)", () => {
  const db = world();
  const stmts = sql.split(/;\s*\n/).map((s) => s.replace(/^\s*--.*$/gm, "").trim()).filter(Boolean);
  const cut = stmts.findIndex((s) => /^DROP TABLE IF EXISTS plus_ledger$/i.test(s));
  assert.ok(cut > 0);
  for (const s of stmts.slice(0, cut + 1)) db.exec(s);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE name = 'plus_ledger'").get().c, 0, "the failure point leaves no plus_ledger");
  db.exec(sql);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM plus_ledger").get().c, 2);
  assert.doesNotThrow(() => db.prepare("UPDATE plus_ledger SET status = 'deployed' WHERE id = 1").run());
  const again = world(); again.exec(sql); again.exec(sql);
  assert.equal(again.prepare("SELECT COUNT(*) c FROM plus_ledger").get().c, 2);
});

test("the detector reads the latest plus run and its CHECK error", () => {
  const db = world(); db.exec(sql);
  const probe = db.prepare("SELECT verify_probe FROM remediation_contracts WHERE class = 'fm-plus-ledger-status-rejected'").get().verify_probe;
  db.prepare("INSERT INTO fleet_runs (task_id, status, error) VALUES ('management-personas-plus', 'failed', 'D1_ERROR: CHECK constraint failed: status IN (''proposed'')')").run();
  assert.deepEqual({ ...db.prepare(probe).get() }, { expected: "0", observed: "1" });
  db.prepare("INSERT INTO fleet_runs (task_id, status, error) VALUES ('management-personas-plus', 'ok', NULL)").run();
  assert.equal(db.prepare(probe).get().observed, "0", "the latest run decides");
  db.prepare("INSERT INTO fleet_runs (task_id, status, error) VALUES ('other-task', 'failed', 'CHECK constraint failed')").run();
  assert.equal(db.prepare(probe).get().observed, "0", "another task's failure is not this one's");
});

test("every status the plus migrations write is one the table admits", () => {
  const files = readdirSync(here).filter((f) => /^2026-1[01]-.*plus.*\.sql$/.test(f) && f !== "2026-11-05-plus-ledger-status.sql");
  assert.ok(files.length >= 5);
  const found = new Set();
  for (const f of files) {
    const t = readFileSync(join(here, f), "utf8");
    for (const m of t.matchAll(/UPDATE plus_ledger\s+SET status\s*=\s*'{1,2}([a-z]+)'{1,2}/g)) found.add(m[1]);
    for (const seg of t.matchAll(/UPDATE plus_ledger\s+SET status\s*=\s*CASE([\s\S]*?)ELSE status END/g)) for (const m of seg[1].matchAll(/THEN\s+'{1,2}([a-z]+)'{1,2}/g)) found.add(m[1]);
  }
  assert.ok(found.has("building") && found.has("deployed") && found.has("reverted"), "the scan sees the statuses the steps write: " + [...found].join(","));
  for (const s of found) assert.ok(STATUSES.includes(s), "plus_ledger would reject the status " + s);
});
