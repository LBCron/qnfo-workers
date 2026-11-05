// COST-GATEWAY-ARTICLE-1 data side (2026-11-05): replays migrations/2026-11-05-plain-article-format-refresh.sql on node:sqlite.
// Proves: an ok article whose paper has the same version and a body length within 20 percent is refreshed (body_len only, nothing else changes) and is
// no longer selected by the articleFill staleness test; a paper with another version, a length change over 20 percent, a failed article and an article of
// another slug stay as they were (still stale and rebuilt); the backup table holds the old lengths and the Rollback line restores them; the file re-applies cleanly.
// Run: node migrations/plain-article-format-refresh.test.mjs
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("./2026-11-05-plain-article-format-refresh.sql", import.meta.url), "utf8");
let pass = 0;
const ok = (c, m, x) => { assert.ok(c, m + (x === undefined ? "" : " -- " + JSON.stringify(x).slice(0, 400))); pass++; };
for (const h of ["-- APPLY-BY: ci", "-- DB: living-paper", "-- Rollback:"]) ok(sql.includes(h), "header " + h);

const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE papers (slug TEXT PRIMARY KEY, status TEXT, version TEXT, body_md TEXT);
  CREATE TABLE plain_article (slug TEXT PRIMARY KEY, rev TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, title TEXT, short TEXT, body TEXT, terms TEXT, links TEXT, words INTEGER NOT NULL DEFAULT 0, grade REAL NOT NULL DEFAULT 0, method TEXT, verdict TEXT, note TEXT, version TEXT, body_len INTEGER NOT NULL DEFAULT 0, generated_at TEXT NOT NULL);
`);
const body = (n) => "x".repeat(n);
const paper = db.prepare("INSERT INTO papers (slug, status, version, body_md) VALUES (?, 'published', ?, ?)");
const art = db.prepare("INSERT INTO plain_article (slug, rev, status, title, short, body, version, body_len, generated_at) VALUES (?, 'pa1', ?, 'T', 'S', 'B', ?, ?, datetime('now','-2 days'))");
// a: same version, +3 percent (format sweep)            -> refreshed
paper.run("a", "v1", body(10300)); art.run("a", "ok", "v1", 10000);
// b: same version, -20 percent exactly                  -> refreshed (bar is at most 20)
paper.run("b", "v1", body(8000)); art.run("b", "ok", "v1", 10000);
// c: same version, +40 percent                          -> stays stale (material)
paper.run("c", "v1", body(14000)); art.run("c", "ok", "v1", 10000);
// d: new version, same length                           -> stays stale
paper.run("d", "v2", body(10000)); art.run("d", "ok", "v1", 10000);
// e: failed article                                     -> untouched
paper.run("e", "v1", body(10200)); art.run("e", "failed", "v1", 10000);
// f: already current                                    -> untouched, not in the backup
paper.run("f", "v1", body(9000)); art.run("f", "ok", "v1", 9000);
// g: paper with a NULL version, article stored ''        -> same version, refreshed
db.exec("INSERT INTO papers (slug, status, version, body_md) VALUES ('g', 'published', NULL, '" + body(10100) + "')");
art.run("g", "ok", "", 10000);

const stale = () => db.prepare("SELECT a.slug AS slug FROM plain_article a JOIN papers p ON p.slug = a.slug WHERE a.status = 'ok' AND (a.version IS NOT COALESCE(p.version, '') OR a.body_len IS NOT LENGTH(p.body_md)) ORDER BY a.slug").all().map((r) => r.slug);
ok(stale().join() === "a,b,c,d,g", "before: a, b, c, d and g are stale", stale());
const snapshot = db.prepare("SELECT slug, rev, status, title, short, body, version, generated_at FROM plain_article ORDER BY slug").all();

db.exec(sql);
db.exec(sql); // re-apply: nothing left to refresh, nothing breaks
ok(stale().join() === "c,d", "after: only the material change (c) and the new version (d) stay stale", stale());
const lens = Object.fromEntries(db.prepare("SELECT slug, body_len FROM plain_article").all().map((r) => [r.slug, r.body_len]));
ok(lens.a === 10300 && lens.b === 8000 && lens.g === 10100, "refreshed lengths are the paper's current lengths", lens);
ok(lens.c === 10000 && lens.d === 10000 && lens.e === 10000 && lens.f === 9000, "stale and failed rows keep their lengths", lens);
const after = db.prepare("SELECT slug, rev, status, title, short, body, version, generated_at FROM plain_article ORDER BY slug").all();
ok(JSON.stringify(after) === JSON.stringify(snapshot), "no article text, status, version or timestamp changed");
const bak = db.prepare("SELECT slug, body_len FROM bak_20261105_plain_article_len ORDER BY slug").all();
ok(bak.map((r) => r.slug).join() === "a,b,g" && bak.every((r) => r.body_len === 10000), "the backup holds the three refreshed rows with their old length", bak);

// the Rollback line restores the lengths
const rb = /^-- Rollback: (.*)$/m.exec(sql)[1];
db.exec(rb);
ok(stale().join() === "a,b,c,d,g", "after the Rollback line the five are stale again", stale());
console.log(pass + " passed, 0 failed");
