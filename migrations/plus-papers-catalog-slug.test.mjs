// PLUS-REGISTRY-SLUG-1 offline suite (migrations/2026-11-05-plus-papers-catalog-slug.sql).
// plus_ledger.product_slug references products(slug) and D1 enforces foreign keys; the plus loop writes the product_registry key. The registry holds papers, the catalog papers-hub, so the first plus
// proposed for papers fails pl-ledger and the whole management-personas-plus workflow with FOREIGN KEY constraint failed. This applies the migration on SQLite (node:sqlite, foreign keys on like D1)
// and proves: the header (APPLY-BY ci, DB qnfo-audit, one single-line Rollback, a BACKUP table, nothing deleted or dropped in the body); the defect is reproduced before (an insert for papers is
// refused by the foreign key) and gone after; the catalog row mirrors papers-hub column for column and nothing else is added; the detector reads 1 before and 0 after and counts a new drifted slug;
// an existing papers row is not overwritten; a replay adds nothing; the Rollback removes the row (and keeps it when plus_ledger already holds a row for it), the detector and the failure mode;
// scripts/apply_migrations.py --check accepts the file.
// Run: node --no-warnings migrations/plus-papers-catalog-slug.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const FILE = join(here, "2026-11-05-plus-papers-catalog-slug.sql");
const sql = readFileSync(FILE, "utf8").replace(/\r\n/g, "\n");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };

const lines = sql.split("\n");
const hdr = (k) => (lines.find((l) => l.startsWith("-- " + k + ": ")) || "").slice(k.length + 4).trim();
const rollback = hdr("Rollback");
const body = lines.filter((l) => !l.startsWith("--")).join("\n");
ok(hdr("APPLY-BY") === "ci" && hdr("DB") === "qnfo-audit", "the file opts in with APPLY-BY: ci and DB: qnfo-audit");
ok(lines.filter((l) => /^-- Rollback: /.test(l)).length === 1 && rollback.length > 150, "one single-line Rollback");
ok(hdr("BACKUP") === "products", "the BACKUP header names the table the file extends (no row is deleted)");
ok(!/decision_log/i.test(rollback), "the Rollback never touches decision_log (append-only)");
ok(!/\bDELETE\b/i.test(body) && !/\bDROP\b/i.test(body), "the body deletes and drops nothing");
ok(!/claude\.ai|anthropic\.com/i.test(sql) && !/\[skip|skip[ -]ci|skip-checks/i.test(sql), "no claude.ai or anthropic.com link and no skip-CI token");

const DDL = `
CREATE TABLE products (slug TEXT PRIMARY KEY, name TEXT NOT NULL, surface TEXT NOT NULL, owner_worker TEXT, repo TEXT NOT NULL DEFAULT 'QNFO/qnfo-workers', path TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE product_registry (product TEXT PRIMARY KEY, state TEXT NOT NULL DEFAULT 'active');
CREATE TABLE plus_ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, product_slug TEXT NOT NULL REFERENCES products(slug), plus TEXT NOT NULL);
CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT NOT NULL, root_cause TEXT NOT NULL, remediation TEXT NOT NULL, detector TEXT NOT NULL, probe_class TEXT, first_seen TEXT NOT NULL, issue_id INTEGER, trigger_condition TEXT, symptom TEXT, blast_radius TEXT);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT NOT NULL, action TEXT NOT NULL, verify_probe TEXT NOT NULL, verify_transport TEXT NOT NULL, max_attempts INTEGER NOT NULL DEFAULT 3, escalate_to TEXT NOT NULL, expected_cadence_h INTEGER, status TEXT DEFAULT 'active');
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
CREATE TRIGGER decision_log_no_delete BEFORE DELETE ON decision_log BEGIN SELECT RAISE(ABORT, 'DOCTRINE-1: decision_log is append-only (doctrine section 12)'); END;
CREATE TRIGGER decision_log_no_update BEFORE UPDATE ON decision_log BEGIN SELECT RAISE(ABORT, 'DOCTRINE-1: decision_log is append-only (doctrine section 12)'); END;
`;
const fresh = () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(DDL);
  db.exec("INSERT INTO products (slug, name, surface, owner_worker, path, created_at) VALUES ('papers-hub', 'Papers hub (papers.qnfo.org)', 'papers.qnfo.org', 'qnfo-gateway', 'qnfo-gateway/worker.js', '2026-10-29 12:29:00'), ('jobs', 'Jobs', 'jobs.q08.org', 'qnfo-jobsearch', 'qnfo-jobsearch/worker.js', '2026-11-02 00:00:00')");
  db.exec("INSERT INTO product_registry (product, state) VALUES ('jobs', 'active'), ('papers', 'active'), ('retired-thing', 'retired')");
  return db;
};
const one = (db, q, ...a) => db.prepare(q).get(...a);
const tryRun = (db, q, ...a) => { try { db.prepare(q).run(...a); return null; } catch (e) { return String(e.message); } };

const before = fresh();
ok(/FOREIGN KEY constraint failed/.test(tryRun(before, "INSERT INTO plus_ledger (product_slug, plus) VALUES ('papers', 'x')") || ""), "before: a plus for the registry slug papers is refused by the foreign key");

const db = fresh();
db.exec(sql);
const hub = one(db, "SELECT name, surface, owner_worker, repo, path FROM products WHERE slug = 'papers-hub'");
const pap = one(db, "SELECT name, surface, owner_worker, repo, path FROM products WHERE slug = 'papers'");
ok(pap && JSON.stringify(pap) === JSON.stringify(hub), "the catalog row for papers mirrors papers-hub column for column", pap);
ok(one(db, "SELECT COUNT(*) n FROM products").n === 3, "nothing else is added to the catalog");
ok(tryRun(db, "INSERT INTO plus_ledger (product_slug, plus) VALUES ('papers', 'x')") === null, "after: the same insert succeeds");

const DETECT = one(db, "SELECT verify_probe p FROM remediation_contracts WHERE class = 'fm-plus-registry-slug-not-in-catalog'").p;
const drifted = fresh();
drifted.exec(sql);
drifted.exec("DELETE FROM products WHERE slug = 'papers'");
ok(one(drifted, DETECT).expected === "0" && one(drifted, DETECT).observed === "1", "the detector reads 1 for a registry slug with no catalog row");
ok(one(db, DETECT).expected === "0" && one(db, DETECT).observed === "0", "the detector reads 0 against 0 after the migration (a retired registry product is not counted)");
db.exec("INSERT INTO product_registry (product, state) VALUES ('new-product', 'active')");
ok(one(db, DETECT).observed === "1", "a new drifted slug is counted");

const kept = fresh();
kept.exec("INSERT INTO products (slug, name, surface, owner_worker) VALUES ('papers', 'Papers (custom)', 'papers.example', 'w')");
kept.exec(sql);
ok(one(kept, "SELECT name n FROM products WHERE slug = 'papers'").n === "Papers (custom)", "an existing papers row is not overwritten");

const snap = JSON.stringify([db.prepare("SELECT * FROM products ORDER BY slug").all(), db.prepare("SELECT class FROM remediation_contracts").all()]);
db.exec(sql);
ok(JSON.stringify([db.prepare("SELECT * FROM products ORDER BY slug").all(), db.prepare("SELECT class FROM remediation_contracts").all()]) === snap && one(db, "SELECT COUNT(*) n FROM decision_log").n === 1 && one(db, "SELECT COUNT(*) n FROM failure_modes").n === 1, "a replay adds nothing (one decision row, one failure mode)");

const rb = fresh();
rb.exec(sql);
rb.exec(rollback);
ok(one(rb, "SELECT COUNT(*) n FROM products WHERE slug = 'papers'").n === 0 && one(rb, "SELECT COUNT(*) n FROM remediation_contracts").n === 0 && one(rb, "SELECT COUNT(*) n FROM failure_modes").n === 0 && one(rb, "SELECT COUNT(*) n FROM decision_log").n === 1, "the Rollback removes the row, the detector and the failure mode and leaves the decision row");
const rb2 = fresh();
rb2.exec(sql);
rb2.exec("INSERT INTO plus_ledger (product_slug, plus) VALUES ('papers', 'x')");
rb2.exec(rollback);
ok(one(rb2, "SELECT COUNT(*) n FROM products WHERE slug = 'papers'").n === 1, "the Rollback keeps the catalog row once plus_ledger references it (the foreign key would refuse the delete)");

const PY = ["python3", "python"].find((c) => spawnSync(c, ["-I", "-c", "import sys"], { encoding: "utf8" }).status === 0);
if (PY) {
  const chk = spawnSync(PY, ["-I", join(root, "scripts", "apply_migrations.py"), "--check", FILE], { encoding: "utf8" });
  ok(chk.status === 0 && /"ok": true/.test(chk.stdout), "the file passes scripts/apply_migrations.py --check", [chk.status, chk.stdout, chk.stderr]);
}
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
