// C5-OBSERVE: replays migrations/2026-11-04-c5-observe-capability-decisions.sql on an in-memory catalog.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const db = new DatabaseSync(":memory:");
db.exec(`
CREATE TABLE cloudflare_capability_catalog (slug TEXT PRIMARY KEY, need TEXT NOT NULL, product TEXT NOT NULL, when_to_choose TEXT, skill TEXT, reference TEXT, status TEXT NOT NULL DEFAULT 'not_considered', source TEXT NOT NULL DEFAULT 'cloudflare-skills', source_sha TEXT, linked_issue INTEGER, metric_ref TEXT, first_seen TEXT DEFAULT (datetime('now')), last_synced TEXT DEFAULT (datetime('now')));
INSERT INTO cloudflare_capability_catalog (slug, need, product, status, metric_ref, when_to_choose) VALUES
 ('turnstile','n','Turnstile','proposed','subscribers_growth_monthly','w'),
 ('analytics-engine','n','Workers Analytics Engine','proposed','pageviews_30d','w'),
 ('cron-single-trigger','n','Cron Triggers','proposed','fleet_budget.cron_schedules','w'),
 ('gradual-deployments','n','Workers Versions','proposed',NULL,'w'),
 ('waf','n','WAF','proposed','worker_req_30d','w'),
 ('tls','n','SSL/TLS','not_considered',NULL,'w');
CREATE TABLE decision_log(actor TEXT,assumption TEXT,action TEXT,evidence TEXT,outcome TEXT,blast_radius TEXT,rollback_path TEXT,capability_gain TEXT,predicted_outcome TEXT,reach_gain TEXT,surfaces_tested TEXT);
`);
const sql = readFileSync(new URL("./2026-11-04-c5-observe-capability-decisions.sql", import.meta.url), "utf8");
db.exec(sql);
db.exec(sql); // idempotent
const st = Object.fromEntries(db.prepare("SELECT slug, status, metric_ref, when_to_choose w FROM cloudflare_capability_catalog").all().map((r) => [r.slug, r]));
for (const s of ["turnstile", "analytics-engine", "cron-single-trigger"]) assert.equal(st[s].status, "in_use", s);
assert.equal(st["gradual-deployments"].status, "approved");
assert.equal(st["gradual-deployments"].metric_ref, "deploys_via_gradual");
assert.equal(st["turnstile"].metric_ref, "subscribers_growth_monthly", "an existing metric_ref is kept");
assert.equal(st["waf"].status, "proposed", "other rows are untouched");
assert.equal(st["tls"].status, "not_considered");
for (const s of ["turnstile", "analytics-engine", "cron-single-trigger", "gradual-deployments"]) {
  const note = st[s].w.match(/decision 2026-11-05/g) || [];
  assert.equal(note.length, 1, s + " carries its decision note once, even after a second apply");
}
assert.equal(db.prepare("SELECT COUNT(*) n FROM decision_log").get().n, 1, "one decision_log row");
console.log("c5-observe-capability-decisions: ok");
