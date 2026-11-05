// PLUS-LEDGER-STATUS-CHECK-1 offline suite: the rebuilt plus_ledger accepts every status the plussing workflow writes, keeps its rows and ids,
// brings back its index and the two views, and a second run changes nothing.
// Run: node --no-warnings migrations/plus-ledger-status-check.test.mjs   (exit 0 = all passed)
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const rd = (f) => readFileSync(new URL("./" + f, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const sql = rd("2026-11-05-plus-ledger-status-check.sql");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? "  -- " + JSON.stringify(x).slice(0, 400) : "")); } };
ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: .+/m.test(sql) && /^-- BACKUP: bak_20261105_plus_ledger$/m.test(sql), "migration opts in with APPLY-BY, DB, BACKUP and Rollback headers");
ok(/CREATE TABLE IF NOT EXISTS bak_20261105_plus_ledger AS SELECT \* FROM plus_ledger/.test(sql) && sql.indexOf("bak_20261105_plus_ledger AS") < sql.indexOf("DROP TABLE plus_ledger;"), "the backup table is created before the table is dropped");

const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys = ON");
db.exec(`
CREATE TABLE products (slug TEXT PRIMARY KEY, name TEXT NOT NULL, surface TEXT NOT NULL, owner_worker TEXT, repo TEXT NOT NULL DEFAULT 'QNFO/qnfo-workers', path TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE product_registry (product TEXT PRIMARY KEY, host TEXT, program_code TEXT, last_plus_at TEXT, created_at TEXT, plus_cadence_h INTEGER DEFAULT 24, misses_in_row INTEGER DEFAULT 0, pluses_since_simplify INTEGER DEFAULT 0, state TEXT DEFAULT 'active', rest_until TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
CREATE TABLE plus_ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, product_slug TEXT NOT NULL REFERENCES products(slug), plus TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','shipped','kept','reverted')), metric TEXT, predicted TEXT, measured TEXT, shipped_at TEXT, decided_at TEXT NOT NULL DEFAULT (datetime('now')), product TEXT, kind TEXT, title TEXT, evidence TEXT, predicted_outcome TEXT, issue_id INTEGER, pr_url TEXT, outcome TEXT, created_at TEXT);
CREATE INDEX idx_plus_ledger_product ON plus_ledger(product_slug, status);
CREATE VIEW v_product_plus_debt AS SELECT p.slug, p.name, p.surface, p.owner_worker, MAX(COALESCE(l.shipped_at, p.created_at)) AS last_plus_at, CAST((julianday('now') - julianday(MAX(COALESCE(l.shipped_at, p.created_at)))) / 7 AS INTEGER) AS weeks_since_plus FROM products p LEFT JOIN plus_ledger l ON l.product_slug = p.slug AND l.status IN ('shipped','kept') GROUP BY p.slug;
CREATE VIEW v_product_plus_due AS SELECT p.product, p.host, p.program_code, p.last_plus_at, CAST((julianday('now') - julianday(COALESCE(p.last_plus_at, p.created_at))) * 24 AS INTEGER) AS hours_since_plus, p.plus_cadence_h, p.misses_in_row, p.pluses_since_simplify, CASE WHEN p.pluses_since_simplify >= 4 THEN 'simplify' ELSE 'plus' END AS next_kind, (SELECT COUNT(*) FROM plus_ledger l WHERE l.product = p.product AND l.status IN ('proposed','building','reverting')) AS in_flight FROM product_registry p WHERE p.state = 'active' AND (p.rest_until IS NULL OR p.rest_until <= strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) AND (julianday('now') - julianday(COALESCE(p.last_plus_at, p.created_at))) * 24 >= p.plus_cadence_h ORDER BY hours_since_plus DESC;
INSERT INTO products (slug, name, surface, created_at) VALUES ('companion-today', 'Today', 'me.q08.org', '2026-10-01 00:00:00'), ('jobs', 'Jobs', 'jobs.q08.org', '2026-10-01 00:00:00');
INSERT INTO product_registry (product, host, program_code, created_at) VALUES ('jobs', 'jobs.q08.org', 'QNFO.PERSONAL', '2026-10-01T00:00:00Z');
INSERT INTO plus_ledger (id, product_slug, plus, status, product, kind, title, evidence, issue_id) VALUES
  (1, 'companion-today', 'PLUS-1', 'proposed', 'companion-today', 'plus', 'PLUS-1', 'Migrated from the legacy product plus ledger', NULL),
  (2, 'jobs', 'Group stretch', 'proposed', 'jobs', 'plus', 'Group stretch', 'proposal #2152 (roadmap-QNFO.PERSONAL-plus-jobs-20261104): qnfo-jobsearch/worker.js', 1001801);
`);

// before: the statement pl-sync runs when proposal 2152 reaches building is refused
let refused = "";
try { db.exec("UPDATE plus_ledger SET status = 'building' WHERE id = 2"); } catch (e) { refused = String(e.message); }
ok(/CHECK constraint failed/.test(refused), "before: the old CHECK refuses status building", refused);

db.exec(sql);

const rows = db.prepare("SELECT id, product_slug, status, issue_id, evidence, title FROM plus_ledger ORDER BY id").all();
ok(rows.length === 2 && rows[0].id === 1 && rows[1].id === 2 && rows[1].issue_id === 1001801 && rows[1].evidence.startsWith("proposal #2152"), "both rows and their ids survive the rebuild", rows);
ok(db.prepare("SELECT COUNT(*) n FROM bak_20261105_plus_ledger").get().n === 2, "the backup table holds both rows");
ok(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name = 'plus_ledger_v2'").get().n === 0, "no plus_ledger_v2 is left behind");
ok(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type = 'index' AND name = 'idx_plus_ledger_product' AND tbl_name = 'plus_ledger'").get().n === 1, "the index is back on plus_ledger");
ok(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type = 'view' AND name IN ('v_product_plus_debt', 'v_product_plus_due')").get().n === 2, "both views are back");

// every status the workflow writes is accepted, and an unknown one is still refused
for (const s of ["building", "deployed", "rejected", "reverting", "reverted", "kept", "shipped", "proposed"]) {
  let err = "";
  try { db.exec("UPDATE plus_ledger SET status = '" + s + "' WHERE id = 2"); } catch (e) { err = String(e.message); }
  ok(err === "", "after: status " + s + " is accepted", err);
}
let bogus = "";
try { db.exec("UPDATE plus_ledger SET status = 'bogus' WHERE id = 2"); } catch (e) { bogus = String(e.message); }
ok(/CHECK constraint failed/.test(bogus), "an unknown status is still refused", bogus);

// the in-flight reading sees a building plus, and the debt view counts a deployed one as delivered
db.exec("UPDATE plus_ledger SET status = 'building' WHERE id = 2");
ok(db.prepare("SELECT in_flight FROM v_product_plus_due WHERE product = 'jobs'").get().in_flight === 1, "v_product_plus_due counts the building plus as in flight");
db.exec("UPDATE plus_ledger SET status = 'deployed', shipped_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = 2");
ok(db.prepare("SELECT weeks_since_plus w FROM v_product_plus_debt WHERE slug = 'jobs'").get().w === 0, "v_product_plus_debt counts a deployed plus as delivered (0 weeks since)");

// a new insert gets the next id (the sequence continues), and the foreign key to products still holds
db.exec("INSERT INTO plus_ledger (product_slug, plus, status) VALUES ('jobs', 'next', 'proposed')");
ok(db.prepare("SELECT MAX(id) m FROM plus_ledger").get().m === 3, "the next insert takes id 3");
let fk = "";
try { db.exec("INSERT INTO plus_ledger (product_slug, plus) VALUES ('no-such-product', 'x')"); } catch (e) { fk = String(e.message); }
ok(/FOREIGN KEY/.test(fk), "the foreign key to products still holds", fk);

// idempotent: a second run keeps rows and leaves one table, one index, two views
const before = JSON.stringify(db.prepare("SELECT * FROM plus_ledger ORDER BY id").all());
db.exec(sql);
ok(JSON.stringify(db.prepare("SELECT * FROM plus_ledger ORDER BY id").all()) === before, "a second run keeps every row");
ok(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name = 'plus_ledger' AND type = 'table'").get().n === 1, "still one plus_ledger table after a second run");
ok(db.prepare("SELECT COUNT(*) n FROM decision_log WHERE action LIKE 'PLUS-LEDGER-STATUS-CHECK-1:%'").get().n === 1, "one decision_log row after two runs");

console.log((fail ? "FAIL " : "ok ") + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
