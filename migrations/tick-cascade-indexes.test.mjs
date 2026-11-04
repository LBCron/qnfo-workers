import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const migration = readFileSync(new URL("./2026-11-04-tick-cascade-indexes.sql", import.meta.url), "utf8");
for (const h of ["-- APPLY-BY: ci", "-- DB: qnfo-audit", "-- Rollback:"]) assert.ok(migration.includes(h), h);

const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE remediation_verifications (id INTEGER PRIMARY KEY, issue_id INTEGER, class TEXT, verified_at TEXT);
  CREATE INDEX idx_rv_verified_norm ON remediation_verifications (replace(substr(verified_at, 1, 19), 'T', ' '));
  CREATE TABLE research_queue (id INTEGER PRIMARY KEY, published_at TEXT);
  CREATE TABLE idea_proposals (id INTEGER PRIMARY KEY, created_at TEXT);
  CREATE TABLE social_media_posts (id INTEGER PRIMARY KEY, status TEXT, published_at TEXT);
  CREATE TABLE continuity_snapshots (id INTEGER PRIMARY KEY, ok INTEGER, ts TEXT);
`);
const plan = (q) => db.prepare("EXPLAIN QUERY PLAN " + q).all().map((r) => r.detail).join(" | ");
const cohort = `SELECT MAX(CASE WHEN replace(substr(r.verified_at,1,19),'T',' ') >= '2026-10-29' THEN r.id END)
  FROM remediation_verifications r WHERE replace(substr(r.verified_at,1,19),'T',' ') >= '2026-10-22'
  AND replace(substr(r.verified_at,1,19),'T',' ') < '2026-11-05' AND (r.issue_id IS NOT NULL OR r.class IS NOT NULL)
  GROUP BY CASE WHEN r.issue_id IS NOT NULL THEN r.issue_id ELSE r.class END`;
assert.doesNotMatch(plan(cohort), /COVERING/, "fixture: cohort is not index-only before");
db.exec(migration);
db.exec(migration); // idempotent
assert.match(plan(cohort), /COVERING INDEX idx_rv_verified_norm_cover/);
assert.match(plan("SELECT julianday(MAX(published_at)) FROM research_queue WHERE published_at IS NOT NULL"), /idx_rq_published_at/);
assert.match(plan("SELECT julianday(MAX(created_at)) FROM idea_proposals"), /idx_ip_created_at/);
assert.match(plan("SELECT julianday(MAX(published_at)) FROM social_media_posts WHERE status = 'published'"), /idx_sm_status_published/);
assert.match(plan("SELECT julianday(MAX(ts)) FROM continuity_snapshots WHERE ok = 1"), /idx_cs_ok_ts/);
console.log("tick-cascade-indexes ok");
