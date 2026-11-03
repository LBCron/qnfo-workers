// SOCIAL-WEEKLY-CAPS-PROBE-1 offline suite. Exercises the read-only alternate probe
// against configured per-channel caps, including the incident's 5 h / 23 h case.
// Run: node migrations/social-weekly-caps-probe.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(join(here, "2026-11-03-social-weekly-caps-probe.sql"), "utf8");
const rollback = migration.match(/^-- Rollback: (.+)$/m)?.[1];
let pass = 0, fail = 0;
const ok = (condition, message, detail) => {
  if (condition) pass++;
  else { fail++; console.log("FAIL " + message + (detail === undefined ? "" : " :: " + JSON.stringify(detail))); }
};

function fresh() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE pipeline_flags (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
CREATE TABLE control_alternate_probes (control TEXT PRIMARY KEY, probe_sql TEXT NOT NULL, window_note TEXT NOT NULL, enabled INTEGER DEFAULT 1);
CREATE TABLE control_registry (control TEXT PRIMARY KEY, alternate_path TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY, actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
CREATE TABLE social_media_posts (id TEXT PRIMARY KEY, platform TEXT NOT NULL, published_at TEXT, status TEXT DEFAULT 'published');
INSERT INTO control_alternate_probes VALUES ('social-weekly-caps', 'SELECT ''ok'' AS expected, ''ok'' AS observed', 'old', 1);
INSERT INTO control_registry VALUES ('social-weekly-caps', 'old alternate');`);
  db.exec("INSERT INTO pipeline_flags VALUES ('social_channel_caps', '{\"linkedin\":7,\"mastodon\":14,\"twitter\":14}'), ('social_share_floor', '0.5')");
  db.exec("INSERT INTO ops_config VALUES ('attention_channel_share', '{\"linkedin\":1,\"mastodon\":1,\"x\":1}', datetime('now'))");
  const post = db.prepare("INSERT INTO social_media_posts (id, platform, published_at) VALUES (?, ?, datetime('now', ?))");
  post.run("x1", "buffer-x", "-30 hours");
  post.run("x2", "buffer-x", "-10 hours");
  db.exec(migration);
  db.exec(migration);
  return db;
}

function probe(db) {
  const sql = db.prepare("SELECT probe_sql FROM control_alternate_probes WHERE control = 'social-weekly-caps'").get().probe_sql;
  const before = db.prepare("SELECT total_changes() AS n").get().n;
  const result = db.prepare(sql).get();
  const after = db.prepare("SELECT total_changes() AS n").get().n;
  return { ...result, readOnly: before === after };
}

{
  const db = fresh();
  const r = probe(db);
  ok(r.expected === "ok" && r.observed === "ok" && r.readOnly, "normal X spacing passes and the probe is read-only", r);
  const row = db.prepare("SELECT window_note FROM control_alternate_probes WHERE control = 'social-weekly-caps'").get();
  ok(row.window_note.includes("adjacent-post spacing") && row.window_note.includes("attention share"), "the probe describes the same cap-derived signal it reads", row);
  const alternate = db.prepare("SELECT alternate_path FROM control_registry WHERE control = 'social-weekly-caps'").get().alternate_path;
  ok(alternate.includes("weekly counts") && alternate.includes("attention share"), "the control registry names its measured alternate", alternate);
  const decision = db.prepare("SELECT * FROM decision_log WHERE action LIKE 'SOCIAL-WEEKLY-CAPS-PROBE-1:%'").get();
  ok(decision && decision.predicted_outcome.includes("6-hour drill") && decision.surfaces_tested.includes("read-only probe"), "the migration records its prediction and verification surface", decision);
  ok(db.prepare("SELECT COUNT(*) AS n FROM decision_log WHERE action LIKE 'SOCIAL-WEEKLY-CAPS-PROBE-1:%'").get().n === 1, "reapplying the migration does not duplicate its decision record");
}
{
  const db = fresh();
  db.prepare("INSERT INTO social_media_posts (id, platform, published_at) VALUES ('li-1', 'buffer-linkedin', datetime('now', '-10 hours')), ('li-2', 'buffer-linkedin', datetime('now', '-5 hours'))").run();
  const incident = probe(db);
  ok(incident.observed.includes("spacing") && incident.readOnly, "the incident's 5 h LinkedIn gap fails under the configured 7/week cap", incident);
}
{
  const db = fresh();
  db.prepare("INSERT INTO social_media_posts (id, platform, published_at) VALUES ('li-1', 'buffer-linkedin', datetime('now', '-24 hours')), ('li-2', 'buffer-linkedin', datetime('now', '-2 hours'))").run();
  const r = probe(db);
  ok(r.observed.includes("spacing") && r.readOnly, "22 h LinkedIn spacing fails under the configured 7/week cap (23 h required)", r);
}
{
  const db = fresh();
  db.prepare("INSERT INTO social_media_posts (id, platform, published_at) VALUES ('x3', 'buffer-x', datetime('now', '-21 hours'))").run();
  const r = probe(db);
  ok(r.observed.includes("spacing") && r.readOnly, "10 h X spacing fails under the configured 14/week cap (11 h required)", r);
}
{
  const db = fresh();
  db.prepare("INSERT INTO social_media_posts (id, platform, published_at) VALUES ('li-1', 'buffer-linkedin', datetime('now', '-25 hours')), ('li-2', 'buffer-linkedin', datetime('now', '-2 hours'))").run();
  const r = probe(db);
  ok(r.observed === "ok", "23 h LinkedIn spacing passes the configured cap boundary", r);
}
{
  const db = fresh();
  const insert = db.prepare("INSERT INTO social_media_posts (id, platform, published_at) VALUES (?, 'buffer-x', datetime('now', ?))");
  for (let i = 1; i <= 13; i++) insert.run("over-cap-" + i, "-" + (i * 11) + " hours");
  const r = probe(db);
  ok(r.observed.includes("weekly cap") && r.readOnly, "a 15th X post within 7 days fails the configured weekly cap", r);
}
{
  const db = fresh();
  db.exec("UPDATE pipeline_flags SET value = 'not json' WHERE key = 'social_channel_caps'");
  const r = probe(db);
  ok(r.observed.includes("not JSON") && r.readOnly, "an unreadable cap configuration fails safely", r);
}
{
  const db = fresh();
  db.exec(rollback);
  const row = db.prepare("SELECT probe_sql, window_note FROM control_alternate_probes WHERE control = 'social-weekly-caps'").get();
  const alternate = db.prepare("SELECT alternate_path FROM control_registry WHERE control = 'social-weekly-caps'").get().alternate_path;
  ok(row.probe_sql.includes("< 360") && row.window_note.includes("cap itself is read"), "the migration rollback restores the original probe", row);
  ok(alternate.includes("BSKY-SPACING-1") && alternate.includes("attention share"), "the migration rollback restores the original alternate", alternate);
}

console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
