import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("./2026-11-02-plus-substrate-reconcile.sql", import.meta.url), "utf8");

test("plus substrate reconciliation aligns catalog and registry slugs without losing history", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE products (
        slug TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        surface TEXT NOT NULL,
        owner_worker TEXT,
        repo TEXT NOT NULL DEFAULT 'QNFO/qnfo-workers',
        path TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE product_registry (
        product TEXT PRIMARY KEY,
        host TEXT,
        worker TEXT,
        program_code TEXT NOT NULL,
        what_for TEXT,
        usage_metric TEXT,
        quality_measure TEXT,
        plus_cadence_h INTEGER NOT NULL DEFAULT 168,
        last_plus_at TEXT,
        rest_until TEXT,
        misses_in_row INTEGER NOT NULL DEFAULT 0,
        pluses_since_simplify INTEGER NOT NULL DEFAULT 0,
        state TEXT NOT NULL DEFAULT 'active',
        created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );
      CREATE TABLE plus_ledger (
        id INTEGER PRIMARY KEY,
        product_slug TEXT NOT NULL REFERENCES products(slug),
        product TEXT
      );
      CREATE TABLE decision_log (
        actor TEXT NOT NULL,
        assumption TEXT NOT NULL,
        action TEXT NOT NULL,
        evidence TEXT NOT NULL,
        outcome TEXT NOT NULL,
        blast_radius TEXT NOT NULL,
        rollback_path TEXT NOT NULL,
        capability_gain TEXT,
        predicted_outcome TEXT,
        reach_gain TEXT,
        surfaces_tested TEXT
      );
      INSERT INTO products (slug, name, surface, owner_worker, path) VALUES
        ('companion-today', 'Companion', 'me.q08.org', 'personal-api', 'personal-api/worker.js'),
        ('fleet-dashboard', 'Fleet dashboard', 'fleet.qnfo.org', 'qnfo-fleet-dashboard', 'qnfo-fleet-dashboard/worker.js'),
        ('ops-executor', 'Ops executor', 'internal', 'qnfo-ops', NULL),
        ('research-gateway', 'Research gateway', 'internal', 'qnfo-ai', NULL),
        ('q08-home', 'q08.org homepage', 'q08.org', 'qnfo-gateway', 'qnfo-gateway/worker.js');
      INSERT INTO product_registry (product, host, worker, program_code, what_for) VALUES
        ('companion-today', 'me.q08.org', 'personal-api', 'QNFO.PERSONAL', 'agenda'),
        ('fleet-dashboard', 'fleet.qnfo.org', 'qnfo-fleet-dashboard', 'QNFO.OPS', 'dashboard'),
        ('jobs', 'jobs.q08.org', 'qnfo-jobsearch', 'QNFO.PERSONAL', 'job matcher'),
        ('ops-executor', 'ops.qnfo.org', 'qnfo-ops', 'QNFO.OPS', 'executor'),
        ('qnfo-site', 'qnfo.org', 'qnfo-gateway', 'QNFO.REACH', 'landing, papers and email capture'),
        ('research-gateway', 'ai.qnfo.org', 'qnfo-ai', 'QNFO.RSCH', 'research gateway'),
        ('shorts-channel', 'youtube', 'qnfo-youtube-shorts', 'QNFO.REACH', 'research Shorts'),
        ('travel', 'travel.q08.org', 'personal-companion', 'QNFO.PERSONAL', 'trip planning');
      INSERT INTO plus_ledger (id, product_slug, product)
      VALUES (1, 'companion-today', 'companion-today');
    `);

    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM product_registry r LEFT JOIN products p ON p.slug = r.product WHERE p.slug IS NULL").get().count,
      4,
    );

    db.exec(migration);
    db.exec(migration);

    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM product_registry").get().count, 8);
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM product_registry r LEFT JOIN products p ON p.slug = r.product WHERE p.slug IS NULL").get().count,
      0,
    );
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM products").get().count, 8);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM decision_log WHERE actor = 'PLUS-SUBSTRATE-RECONCILE-1'").get().count, 1);
    assert.equal(db.prepare("SELECT product FROM product_registry WHERE product = 'qnfo-site'").get(), undefined);
    assert.deepEqual(
      { ...db.prepare("SELECT host, worker, program_code, what_for FROM product_registry WHERE product = 'q08-home'").get() },
      {
        host: "q08.org",
        worker: "q08-signal-engine",
        program_code: "QNFO.REACH",
        what_for: "q08.org homepage",
      },
    );
    assert.deepEqual(
      db.prepare("SELECT slug, surface, owner_worker, path FROM products WHERE slug IN ('jobs', 'travel', 'shorts-channel') ORDER BY slug").all().map((row) => ({ ...row })),
      [
        { slug: "jobs", surface: "jobs.q08.org", owner_worker: "qnfo-jobsearch", path: "qnfo-jobsearch/worker.js" },
        { slug: "shorts-channel", surface: "youtube", owner_worker: "qnfo-youtube-shorts", path: "qnfo-youtube-shorts/worker.js" },
        { slug: "travel", surface: "travel.q08.org", owner_worker: "personal-companion", path: "personal-companion/worker.js" },
      ],
    );
    assert.equal(db.prepare("SELECT product_slug FROM plus_ledger WHERE id = 1").get().product_slug, "companion-today");
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);

    const rollback = migration.match(/^-- Rollback: (.+)$/m)?.[1];
    assert.ok(rollback);
    db.exec(rollback);

    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM products").get().count, 5);
    assert.deepEqual(
      { ...db.prepare("SELECT surface, owner_worker, path FROM products WHERE slug = 'q08-home'").get() },
      { surface: "q08.org", owner_worker: "qnfo-gateway", path: "qnfo-gateway/worker.js" },
    );
    assert.deepEqual(
      { ...db.prepare("SELECT host, worker, what_for FROM product_registry WHERE product = 'qnfo-site'").get() },
      { host: "qnfo.org", worker: "qnfo-gateway", what_for: "landing, papers and email capture" },
    );
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'bak_20261102_plus_substrate_products'").get().count, 0);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    db.close();
  }
});
