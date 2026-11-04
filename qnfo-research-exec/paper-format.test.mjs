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
  living.exec("CREATE TABLE papers (slug TEXT PRIMARY KEY,identifier TEXT,title TEXT,subtitle TEXT,abstract TEXT,body_md TEXT,version TEXT,status TEXT,change_actor TEXT,change_reason TEXT,updated_at TEXT,keywords TEXT,doi TEXT); CREATE TABLE old_bodies (slug TEXT,body_md TEXT); CREATE TRIGGER history AFTER UPDATE ON papers BEGIN INSERT INTO old_bodies VALUES (old.slug,old.body_md); END;");
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
    assert.equal(row.body_md, "# Broken Title\n\n## Abstract\n\nA complete real abstract about a scientific result.\n\n## 1. Introduction\n\nBody with $x^2$.\n", "PAPER-CANONICAL-1: no front matter, byline or wrapped title is stored");
    assert.equal(row.updated_at, null, "a format-only change leaves the revision date alone");
    assert.equal(row.abstract, "A complete real abstract about a scientific result.");
  }
  assert.equal(living.prepare("SELECT body_md FROM papers WHERE slug='d'").get().body_md, old);
  await paperFormatTick(env, { batch: 2 });
  await paperFormatTick(env, { batch: 2 });
  const state = JSON.parse(audit.prepare("SELECT value FROM ops_config").get().value);
  assert.deepEqual({ ...state.lastSweep, at: null }, { rules: "PAPER-CANONICAL-1", at: null, checked: 3, repaired: 0, errors: 0, refused: 0 });
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
  living.exec("CREATE TABLE papers (slug TEXT PRIMARY KEY,identifier TEXT,title TEXT,subtitle TEXT,abstract TEXT,body_md TEXT,version TEXT,status TEXT,change_actor TEXT,change_reason TEXT,updated_at TEXT,keywords TEXT,doi TEXT); INSERT INTO papers VALUES ('a','a','Title',NULL,'Old abstract','# Title', '2.0','published',NULL,NULL,NULL,NULL,NULL);");
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

test("a canonical body that would be thinner is refused and the row is left as it is", async () => {
  const living = new DatabaseSync(":memory:");
  const audit = new DatabaseSync(":memory:");
  living.exec("CREATE TABLE papers (slug TEXT PRIMARY KEY,identifier TEXT,title TEXT,subtitle TEXT,abstract TEXT,body_md TEXT,version TEXT,status TEXT,change_actor TEXT,change_reason TEXT,updated_at TEXT,keywords TEXT,doi TEXT);");
  audit.exec("CREATE TABLE ops_config (key TEXT PRIMARY KEY,value TEXT);");
  // A paper that is almost all "Version History": removing it would lose most of the words.
  const body = "# Thin\n\n## Abstract\n\nShort abstract.\n\n## Version History\n\n" + "- Version 1.0.0: a long history entry that is most of the paper. ".repeat(60) + "\n";
  living.prepare("INSERT INTO papers (slug,title,abstract,body_md,version,status) VALUES ('t','Thin','Short abstract.',?,'1.0.0','published')").run(body);
  const r = await paperFormatTick({ LIVING_PAPER: d1(living), QNFO_AUDIT: d1(audit) }, { batch: 5 });
  assert.equal(r.refused, 1);
  assert.equal(r.repaired, 0);
  assert.equal(living.prepare("SELECT body_md FROM papers WHERE slug='t'").get().body_md, body);
  assert.match(JSON.parse(audit.prepare("SELECT value FROM ops_config").get().value).refusedList[0].why, /words|history/);
});

const LONG = "We study error correction in depth and show many things about the codes that matter for readers of the journal today, including thresholds, decoders and overheads.";
const SCHEMA = "CREATE TABLE papers (slug TEXT PRIMARY KEY,identifier TEXT,title TEXT,subtitle TEXT,abstract TEXT,body_md TEXT,version TEXT,status TEXT,change_actor TEXT,change_reason TEXT,updated_at TEXT,keywords TEXT,doi TEXT);";

test("keywords and a DOI that only the header held go to the empty columns, the column abstract is kept, ORCID stays in the ledger text", async () => {
  const living = new DatabaseSync(":memory:");
  const audit = new DatabaseSync(":memory:");
  living.exec(SCHEMA);
  audit.exec("CREATE TABLE ops_config (key TEXT PRIMARY KEY,value TEXT);");
  const body = "# Strange Loop\n\n## The Strange Loop Theory\n\n**Author:** R\n**Contact:** r@example.org **ORCID:** 0009-0002-4317-5604\n**DOI:** https://doi.org/10.1103/PhysRevD.99.123456\n**Version:** 1.2.0\n\n**Abstract**: Opening paragraph of the abstract. " + "More words of the abstract. ".repeat(20) + "\n\n**Keywords:** strange loop, quantization,\ntopological invariants\n\n## 1. Background\n\nText. " + "Words. ".repeat(40) + "\n";
  living.prepare("INSERT INTO papers (slug,title,abstract,body_md,version,status) VALUES ('s','Strange Loop',?,?,'1.2.0','published')").run(LONG, body);
  const r = await paperFormatTick({ LIVING_PAPER: d1(living), QNFO_AUDIT: d1(audit) }, { batch: 5 });
  assert.equal(r.repaired, 1);
  assert.equal(r.lifted, 1);
  const row = living.prepare("SELECT * FROM papers WHERE slug='s'").get();
  assert.deepEqual(JSON.parse(row.keywords), ["strange loop", "quantization", "topological invariants"]);
  assert.equal(row.doi, "10.1103/PhysRevD.99.123456");
  assert.equal(row.abstract, LONG, "the abstract column is never replaced by a derived one");
  assert.doesNotMatch(row.body_md, /ORCID|Keywords|doi\.org/);
  assert.match(row.change_reason, /keywords and doi moved from the header to the column/);
  assert.match(row.change_reason, /ORCID, ISNI, contact and dates stay in the ledger copy/);
  const again = await paperFormatTick({ LIVING_PAPER: d1(living), QNFO_AUDIT: d1(audit) }, { batch: 5 });
  assert.equal(again.repaired, 0);
});

test("a failed mirror write is kept and retried first thing on the next tick", async () => {
  const living = new DatabaseSync(":memory:");
  const audit = new DatabaseSync(":memory:");
  living.exec(SCHEMA);
  audit.exec("CREATE TABLE ops_config (key TEXT PRIMARY KEY,value TEXT);");
  living.prepare("INSERT INTO papers (slug,title,abstract,body_md,version,status) VALUES ('m','Mirror Paper',?,?,'1.0.0','published')").run(LONG, "---\ntitle: Mirror Paper\n---\n\n# Mirror Paper\n\n## Abstract\n\n" + LONG + "\n\n## 1. Intro\n\nBody.\n");
  const puts = [];
  let failing = true;
  const MIRROR = {
    async put(key, value) { if (failing) throw new Error("R2 unavailable"); puts.push([key, String(value)]); },
    async head(key) { const p = puts.find((x) => x[0] === key); return p ? { size: Buffer.byteLength(p[1]) } : null; },
    async get(key) { const p = puts.find((x) => x[0] === key); return p ? { async text() { return p[1]; }, async arrayBuffer() { return new TextEncoder().encode(p[1]).buffer; } } : null; }
  };
  const env = { LIVING_PAPER: d1(living), QNFO_AUDIT: d1(audit), MIRROR };
  const first = await paperFormatTick(env, { batch: 5 });
  assert.equal(first.repaired, 1);
  assert.equal(first.mirror_errors, 1);
  assert.deepEqual(JSON.parse(audit.prepare("SELECT value FROM ops_config").get().value).mirrorRetry, ["m"]);
  failing = false;
  const second = await paperFormatTick(env, { batch: 5 });
  assert.equal(second.mirror_retried, 1);
  assert.deepEqual(JSON.parse(audit.prepare("SELECT value FROM ops_config").get().value).mirrorRetry, []);
  assert.equal(puts[0][0], "papers/m.md");
  assert.match(puts[0][1], /^# Mirror Paper\n\n## Abstract/);
});
