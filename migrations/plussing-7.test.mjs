import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("./2026-11-02-plussing-7.sql", import.meta.url), "utf8");
const body = migration.split("\n").filter((line) => !line.startsWith("--")).join("\n");
const rollback = migration.match(/^-- Rollback: (.+)$/m)?.[1];

test("PLUSSING-7 refreshes the product-plus metrics from plus_ledger", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`
      CREATE TABLE fleet_tasks (id TEXT PRIMARY KEY, definition TEXT NOT NULL, version INTEGER NOT NULL, updated_at TEXT);
      CREATE TABLE plus_ledger (id INTEGER PRIMARY KEY, status TEXT, shipped_at TEXT, decided_at TEXT);
      CREATE TABLE product_registry (product TEXT PRIMARY KEY, state TEXT NOT NULL);
      CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, last_value TEXT, last_refreshed TEXT, state TEXT);
      CREATE TABLE capability_ledger (capability TEXT PRIMARY KEY, provenance TEXT, prerequisites TEXT, reliability REAL, acquired_at TEXT, evidence TEXT);
      CREATE TABLE decision_log (actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
      INSERT INTO fleet_tasks (id, definition, version) VALUES
        ('management-personas', '{"steps":[]}', 1);
      INSERT INTO metric_registry (metric, last_value, state) VALUES
        ('product_plus_rate_7d', 'seed: 0.00', 'MEASURED'),
        ('plus_keep_rate_30d', 'seed: n/a', 'MEASURED');
    `);

    db.exec(body);
    db.exec(body);

    const steps = () => db.prepare(`
      SELECT json_extract(value, '$.name') AS name, json_extract(value, '$.sql') AS sql
      FROM fleet_tasks, json_each(fleet_tasks.definition, '$.steps')
      WHERE fleet_tasks.id = 'management-personas'
    `).all();
    assert.deepEqual(steps().map(({ name }) => name), [
      "pl-shipped-at",
      "pl-product-plus-rate",
      "pl-plus-keep-rate",
    ]);

    const runSteps = () => {
      for (const { sql } of steps()) db.exec(sql);
    };
    db.exec(`
      INSERT INTO product_registry VALUES ('product-a', 'active'), ('product-b', 'active');
      INSERT INTO plus_ledger (status, shipped_at, decided_at) VALUES
        ('proposed', NULL, datetime('now')),
        ('deployed', NULL, datetime('now')),
        ('deployed', NULL, NULL),
        ('kept', datetime('now'), datetime('now', '-10 days')),
        ('reverted', datetime('now', '-40 days'), datetime('now', '-40 days'));
    `);
    runSteps();

    const metric = (name) => db.prepare("SELECT last_value, state FROM metric_registry WHERE metric = ?").get(name);
    assert.deepEqual(
      { value: Number(metric("product_plus_rate_7d").last_value), state: metric("product_plus_rate_7d").state },
      { value: 1, state: "MEASURED" },
    );
    assert.deepEqual(
      { value: Number(metric("plus_keep_rate_30d").last_value), state: metric("plus_keep_rate_30d").state },
      { value: 1, state: "MEASURED" },
    );
    assert.equal(db.prepare("SELECT shipped_at FROM plus_ledger WHERE status = 'deployed'").get().shipped_at, db.prepare("SELECT decided_at FROM plus_ledger WHERE status = 'deployed'").get().decided_at);
    assert.equal(db.prepare("SELECT shipped_at FROM plus_ledger WHERE status = 'deployed' AND decided_at IS NULL").get().shipped_at, null);

    db.exec("DELETE FROM plus_ledger WHERE status IN ('kept', 'reverted')");
    runSteps();
    assert.deepEqual(
      { value: Number(metric("plus_keep_rate_30d").last_value), state: metric("plus_keep_rate_30d").state },
      { value: 0, state: "MEASURED" },
    );

    db.exec("DELETE FROM product_registry");
    runSteps();
    assert.deepEqual({ ...metric("product_plus_rate_7d") }, { last_value: null, state: "UNMEASURED" });

    db.exec(rollback);
    assert.equal(db.prepare("SELECT definition FROM fleet_tasks WHERE id = 'management-personas'").get().definition, '{"steps":[]}');
  } finally {
    db.close();
  }
});
