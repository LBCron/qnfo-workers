// PAPER-PROVENANCE-TRACE-1 coverage views. Run: node qnfo-gateway/paper-provenance-coverage.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const migration = readFileSync(new URL("../migrations/living-paper/2026-11-02-paper-provenance-coverage.sql", import.meta.url), "utf8");
const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE papers (slug TEXT, status TEXT, first_published_at TEXT, created_at TEXT);
  CREATE TABLE paper_change_ledger (seq INTEGER PRIMARY KEY, slug TEXT);
  CREATE TABLE paper_change_bodies (seq INTEGER PRIMARY KEY, metadata TEXT);
  CREATE TABLE paper_change_body_archive (seq INTEGER PRIMARY KEY, metadata TEXT);
  INSERT INTO papers VALUES
    ('body-record', 'published', datetime('now'), datetime('now')),
    ('archive-record', 'distributed', datetime('now'), datetime('now')),
    ('missing-record', 'external_preprint', datetime('now'), datetime('now')),
    ('old-paper', 'published', '2020-01-01', '2020-01-01'),
    ('draft-paper', 'draft', datetime('now'), datetime('now'));
  INSERT INTO paper_change_ledger VALUES (1, 'body-record'), (2, 'body-record'), (3, 'archive-record'), (4, 'draft-paper');
  INSERT INTO paper_change_bodies VALUES
    (1, '{"seed":{"id":"old"},"trace_id":[],"novelty":{"result":null}}'),
    (2, '{"seed":{"id":"new"},"trace_id":["event-1"],"novelty":{"result":{"screened":true}}}'),
    (4, '{"seed":{"id":"draft"},"trace_id":[],"novelty":{"result":null}}');
  INSERT INTO paper_change_body_archive VALUES
    (3, '{"seed":{"id":"archived"},"trace_id":["event-2"],"novelty":{"result":null}}');
`);
db.exec(migration);

const records = db.prepare("SELECT slug, provenance_seq, metadata, has_provenance FROM v_paper_provenance_records ORDER BY slug").all();
assert.deepEqual(records.map(({ slug, has_provenance }) => [slug, has_provenance]), [
  ["archive-record", 1],
  ["body-record", 1],
  ["missing-record", 0],
  ["old-paper", 0]
]);
assert.equal(JSON.parse(records.find((row) => row.slug === "body-record").metadata).seed.id, "new");
assert.equal(JSON.parse(records.find((row) => row.slug === "archive-record").metadata).seed.id, "archived");

const coverage = db.prepare("SELECT * FROM v_paper_provenance_coverage").get();
assert.equal(coverage.new_public_papers_7d, 3);
assert.equal(coverage.papers_with_provenance_7d, 2);
assert.equal(coverage.coverage_pct_7d, 66.67);

db.prepare("UPDATE papers SET first_published_at = '2020-01-01' WHERE first_published_at >= datetime('now','-7 days')").run();
const emptyWindow = db.prepare("SELECT * FROM v_paper_provenance_coverage").get();
assert.equal(emptyWindow.new_public_papers_7d, 0);
assert.equal(emptyWindow.papers_with_provenance_7d, 0);
assert.equal(emptyWindow.coverage_pct_7d, null);

db.close();
console.log("paper-provenance-coverage: ok");
