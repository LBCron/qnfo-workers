import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { paperFormatTick } from "./worker.js";

function d1(db) {
  return { prepare(sql) {
    let args = [];
    const statement = {
      bind(...values) { args = values; return statement; },
      async first() { return db.prepare(sql).get(...args) || null; },
      async all() { return { results: db.prepare(sql).all(...args) }; },
      async run() { const result = db.prepare(sql).run(...args); return { meta: { changes: Number(result.changes) } }; }
    };
    return statement;
  } };
}

test("full public corpus repair converges, preserves versions/status and attributes archived changes", async () => {
  const living = new DatabaseSync(":memory:");
  const audit = new DatabaseSync(":memory:");
  living.exec("CREATE TABLE papers (slug TEXT PRIMARY KEY,title TEXT,subtitle TEXT,abstract TEXT,body_md TEXT,version TEXT,status TEXT,change_actor TEXT,change_reason TEXT,updated_at TEXT); CREATE TABLE old_bodies (slug TEXT,body_md TEXT); CREATE TRIGGER history AFTER UPDATE ON papers BEGIN INSERT INTO old_bodies VALUES (old.slug,old.body_md); END;");
  audit.exec("CREATE TABLE ops_config (key TEXT PRIMARY KEY,value TEXT);");
  const old = "# Broken\nTitle\n\n**Author:** Writer\n\n### ABSTRACT\n\nA complete real abstract about a scientific result.\n\n## 1. Introduction\n\nBody with $x^2$.\n";
  for (const [slug, status] of [["a", "published"], ["b", "distributed"], ["c", "external_preprint"], ["d", "draft"], ["e", "retracted"]]) {
    living.prepare("INSERT INTO papers (slug,title,abstract,body_md,version,status) VALUES (?,'Broken Title','wrong',?,'2.1',?)").run(slug, old, status);
  }
  const env = { LIVING_PAPER: d1(living), QNFO_AUDIT: d1(audit) };
  const first = await paperFormatTick(env, { batch: 2 });
  assert.equal(first.repaired, 2);
  assert.equal(first.complete, false);
  const second = await paperFormatTick(env, { batch: 2 });
  assert.equal(second.repaired, 1);
  assert.equal(second.complete, true);
  assert.equal(living.prepare("SELECT COUNT(*) AS n FROM old_bodies").get().n, 3);
  for (const row of living.prepare("SELECT * FROM papers WHERE slug<'d'").all()) {
    assert.equal(row.status, { a: "published", b: "distributed", c: "external_preprint" }[row.slug]);
    assert.equal(row.version, "2.1");
    assert.match(row.change_actor, /paper-format/);
    assert.match(row.body_md, /author: "Writer"/);
    assert.equal(row.abstract, "A complete real abstract about a scientific result.");
  }
  assert.equal(living.prepare("SELECT body_md FROM papers WHERE slug='d'").get().body_md, old);
  await paperFormatTick(env, { batch: 2 });
  await paperFormatTick(env, { batch: 2 });
  const state = JSON.parse(audit.prepare("SELECT value FROM ops_config").get().value);
  assert.deepEqual({ ...state.lastSweep, at: null }, { rules: "PAPER-FORMAT-2", at: null, checked: 3, repaired: 0, errors: 0 });
  assert.equal(living.prepare("SELECT COUNT(*) AS n FROM old_bodies").get().n, 3);
  const source = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
  assert.match(source, /await paperFormatTick\(env\)/);
});

test("failed repairs remain visible and are retried on the next sweep", async () => {
  let state = null, attempts = 0;
  const env = {
    QNFO_AUDIT: { prepare() { return { async first() { return state ? { value: state } : null; }, bind(value) { return { async run() { state = value; } }; } }; } },
    LIVING_PAPER: { prepare(sql) {
      if (sql.startsWith("SELECT slug FROM")) return { bind() { return { async all() { return { results: [{ slug: "bad" }] }; } }; } };
      return { bind() { return { async first() { attempts++; throw new Error("D1 read failed"); } }; } };
    } }
  };
  const result = await paperFormatTick(env, { batch: 2 });
  assert.equal(result.errors[0].error, "D1 read failed");
  assert.equal(JSON.parse(state).lastSweep.errors, 1);
  await paperFormatTick(env, { batch: 2 });
  assert.equal(attempts, 2);
});

test("a concurrent metadata correction is not overwritten or reported as convergence", async () => {
  const living = new DatabaseSync(":memory:");
  const audit = new DatabaseSync(":memory:");
  living.exec("CREATE TABLE papers (slug TEXT PRIMARY KEY,title TEXT,subtitle TEXT,abstract TEXT,body_md TEXT,version TEXT,status TEXT,change_actor TEXT,change_reason TEXT,updated_at TEXT); INSERT INTO papers VALUES ('a','Title',NULL,'Old abstract','# Title', '2.0','published',NULL,NULL,NULL);");
  audit.exec("CREATE TABLE ops_config (key TEXT PRIMARY KEY,value TEXT);");
  const db = d1(living);
  const env = {
    QNFO_AUDIT: d1(audit),
    LIVING_PAPER: { prepare(sql) {
      if (sql.startsWith("UPDATE papers SET body_md")) living.exec("UPDATE papers SET abstract='Concurrent abstract',subtitle='Concurrent subtitle' WHERE slug='a'");
      return db.prepare(sql);
    } }
  };
  const result = await paperFormatTick(env, { batch: 2 });
  assert.equal(result.conflicts, 1);
  assert.equal(result.repaired, 0);
  assert.equal(JSON.parse(audit.prepare("SELECT value FROM ops_config").get().value).lastSweep.errors, 1);
  const paper = living.prepare("SELECT * FROM papers WHERE slug='a'").get();
  assert.equal(paper.abstract, "Concurrent abstract");
  assert.equal(paper.subtitle, "Concurrent subtitle");
  assert.equal(paper.body_md, "# Title");
});
