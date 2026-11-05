// CAPS-CHANGE-GRACE-1 offline suite (migrations/2026-11-05-social-weekly-caps-cap-change.sql). Builds the probe with the migration that created it
// (2026-11-03-social-weekly-caps-probe.sql), applies the new one over it and runs the probe on node:sqlite.
// Proves: the header opts in; the rewrite touches only the probe row of the control and is idempotent; it stays read-only; the live false alarm (8 posts under a cap of 14, the cap
// halved to 7 afterwards, share 0.5, no post since) reads ok; the same 8 posts under a cap of 7 all week still read 'exceed'; the daily attention share no longer turns a within-cap week red;
// the incident the drill exists for (two LinkedIn posts 5 h apart under a cap of 7, after the last cap change) still reads as a spacing violation; a post after the cap change that breaks the hard
// count still reads 'exceed'; a zero cap with posts after the change is still caught; the Rollback line restores the previous probe.
// Output MUST contain "0 failed" on success.   node migrations/social-weekly-caps-cap-change.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const base = readFileSync(new URL("./2026-11-03-social-weekly-caps-probe.sql", import.meta.url), "utf8");
const sql = readFileSync(new URL("./2026-11-05-social-weekly-caps-cap-change.sql", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 300))); } };
const header = sql.split("\n").filter((l) => l.startsWith("--"));
const body = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
ok(header.some((l) => /^-- APPLY-BY: ci\s*$/.test(l)) && header.some((l) => /^-- DB: qnfo-audit\s*$/.test(l)), "header opts in");
const rollback = header.filter((l) => /^-- Rollback:/.test(l));
ok(rollback.length === 1, "exactly one single-line Rollback header");
ok(header.some((l) => /^-- BACKUP: bak_20261105_social_caps_probe\s*$/.test(l)), "BACKUP header names a table the file creates");
ok(!/\b(DELETE\s+FROM|DROP\s+(TABLE|INDEX|VIEW|TRIGGER))\b/i.test(body), "nothing is deleted or dropped");
ok(!/\bUPDATE\s+agent_issues\b/i.test(body) && !/\bCREATE\s+TRIGGER\b/i.test(body), "agent_issues is not written and no trigger is added");
for (const m of body.matchAll(/LIKE\s+'([^']*)'/gi)) ok(Buffer.byteLength(m[1]) < 50, "LIKE pattern under D1's 50-byte limit: " + m[1]);

function fresh(caps, share, capsAt) {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE pipeline_flags (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
CREATE TABLE control_alternate_probes (control TEXT PRIMARY KEY, probe_sql TEXT NOT NULL, window_note TEXT NOT NULL, enabled INTEGER DEFAULT 1);
CREATE TABLE control_registry (control TEXT PRIMARY KEY, alternate_path TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY, actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
CREATE TABLE social_media_posts (id TEXT PRIMARY KEY, platform TEXT NOT NULL, published_at TEXT, status TEXT DEFAULT 'published');
INSERT INTO control_alternate_probes VALUES ('social-weekly-caps', 'SELECT ''ok'' AS expected, ''ok'' AS observed', 'old', 1);
INSERT INTO control_registry VALUES ('social-weekly-caps', 'old alternate');`);
  db.prepare("INSERT INTO pipeline_flags VALUES ('social_channel_caps', ?, ?), ('social_share_floor', '0.5', datetime('now', '-30 days'))").run(JSON.stringify(caps), capsAt);
  db.prepare("INSERT INTO ops_config VALUES ('attention_channel_share', ?, datetime('now'))").run(JSON.stringify(share));
  db.exec(base);
  return db;
}
const probe = (db) => {
  const s = db.prepare("SELECT probe_sql FROM control_alternate_probes WHERE control = 'social-weekly-caps'").get().probe_sql;
  const b = db.prepare("SELECT total_changes() AS n").get().n;
  const r = db.prepare(s).get();
  return { ...r, readOnly: b === db.prepare("SELECT total_changes() AS n").get().n };
};
const addPosts = (db, platform, hoursAgo) => { for (const h of hoursAgo) db.prepare("INSERT INTO social_media_posts (id, platform, published_at) VALUES (?, ?, datetime('now', ?))").run(platform + h + Math.random(), platform, "-" + h + " hours"); };
const EXCEED = "published Buffer posts exceed a channel effective weekly cap in 7 days";
const SPACING = "consecutive Buffer posts violate the channel effective weekly-cap spacing";
const ago = (h) => "datetime('now', '-" + h + " hours')";
const capsAtSql = (h) => new DatabaseSync(":memory:").prepare("SELECT " + ago(h) + " AS t").get().t;

// ---- the live false alarm: 8 mastodon posts under cap 14, cap halved 3 h ago, share 0.5, none since
{
  const db = fresh({ linkedin: 7, mastodon: 14, twitter: 14 }, { linkedin: 1, mastodon: 1, x: 1 }, capsAtSql(200));
  addPosts(db, "buffer-mastodon", [120, 105, 90, 75, 60, 45, 30, 15]);
  db.exec("UPDATE pipeline_flags SET value = '{\"linkedin\":7,\"mastodon\":7,\"twitter\":21}', updated_at = datetime('now', '-3 hours') WHERE key = 'social_channel_caps'");
  db.exec("UPDATE ops_config SET value = '{\"linkedin\":1,\"mastodon\":0.5,\"x\":1}' WHERE key = 'attention_channel_share'");
  const before = probe(db);
  ok(before.observed === EXCEED, "BEFORE the migration: the cap decision turns the drill red (the defect)", before);
  const snap = db.prepare("SELECT probe_sql, window_note FROM control_alternate_probes").get();
  db.exec(sql);
  const after = probe(db);
  ok(after.expected === "ok" && after.observed === "ok" && after.readOnly, "AFTER: no post since the cap change -> ok, and the probe is still read-only", after);
  ok(db.prepare("SELECT COUNT(*) n FROM control_registry").get().n === 1 && db.prepare("SELECT alternate_path FROM control_registry").get().alternate_path.includes("weekly counts"), "the registry row is untouched by this file");
  const row = db.prepare("SELECT probe_sql, window_note FROM control_alternate_probes").get();
  ok(/caps_at/.test(row.probe_sql) && /CAPS-CHANGE-GRACE-1/.test(row.window_note), "probe and window note carry the change");
  db.exec(sql);
  const row2 = db.prepare("SELECT probe_sql, window_note FROM control_alternate_probes").get();
  ok(row2.probe_sql === row.probe_sql && row2.window_note === row.window_note && db.prepare("SELECT COUNT(*) n FROM decision_log WHERE action LIKE 'CAPS-CHANGE-GRACE-1:%'").get().n === 1, "a replay changes nothing and logs one decision");
  // a post after the change within the hard cap is fine; the 9th post of the week would not be judged by today's share
  addPosts(db, "buffer-mastodon", [1]);
  ok(probe(db).observed === "ok", "one post after the change, within the hard cap of 7 -> ok");
  db.exec(rollback[0].replace(/^-- Rollback:\s*/, ""));
  const back = db.prepare("SELECT probe_sql, window_note FROM control_alternate_probes").get();
  ok(back.probe_sql === snap.probe_sql && back.window_note === snap.window_note, "the Rollback line restores the previous probe and note");
  ok(probe(db).observed === EXCEED, "and the previous probe reads red again");
}
// ---- the same 8 posts under a cap of 7 all week are a violation
{
  const db = fresh({ linkedin: 7, mastodon: 7, twitter: 21 }, { linkedin: 1, mastodon: 1, x: 1 }, capsAtSql(500));
  addPosts(db, "buffer-mastodon", [120, 105, 90, 75, 60, 45, 30, 15]);
  db.exec(sql);
  ok(probe(db).observed === EXCEED, "8 posts in 7 days under a cap of 7 that was in force all week still read 'exceed'", probe(db));
}
// ---- the daily attention share no longer turns a within-cap week red
{
  const db = fresh({ linkedin: 7, mastodon: 7, twitter: 21 }, { linkedin: 1, mastodon: 0.5, x: 1 }, capsAtSql(500));
  addPosts(db, "buffer-mastodon", [144, 119, 94, 69, 44, 19]);
  const old = probe(db);
  ok(old.observed === EXCEED, "BEFORE: 6 posts spaced 25 h, judged by a share of 0.5 (effective cap 5), are red", old);
  db.exec(sql);
  ok(probe(db).observed === "ok", "AFTER: 6 posts within the hard cap of 7 and spaced 25 h are ok whatever today's share is");
}
// ---- the incident: two LinkedIn posts 5 h apart under a cap of 7 (spacing 23 h), after the last cap change
{
  const db = fresh({ linkedin: 7, mastodon: 7, twitter: 21 }, { linkedin: 1, mastodon: 1, x: 1 }, capsAtSql(100));
  addPosts(db, "buffer-linkedin", [10, 5]);
  db.exec(sql);
  const r = probe(db);
  ok(r.observed === SPACING, "two posts 5 h apart under a cap of 7, after the last cap change, still read as a spacing violation", r);
}
// ---- the same pair before the cap change is judged under the old caps, which are not kept
{
  const db = fresh({ linkedin: 7, mastodon: 7, twitter: 21 }, { linkedin: 1, mastodon: 1, x: 1 }, capsAtSql(2));
  addPosts(db, "buffer-linkedin", [10, 5]);
  db.exec(sql);
  ok(probe(db).observed === "ok", "the pair published before the last cap change is not judged by the new caps");
}
// ---- a zero cap with posts after the change is still caught
{
  const db = fresh({ linkedin: 0, mastodon: 7, twitter: 21 }, { linkedin: 1, mastodon: 1, x: 1 }, capsAtSql(100));
  addPosts(db, "buffer-linkedin", [3]);
  db.exec(sql);
  ok(probe(db).observed === "posts exist on a Buffer channel whose effective weekly cap is zero", "a post on a channel whose cap is zero is still caught", probe(db));
}
// ---- caps never recorded: the whole window counts
{
  const db = fresh({ linkedin: 7, mastodon: 7, twitter: 21 }, { linkedin: 1, mastodon: 1, x: 1 }, capsAtSql(500));
  db.exec("UPDATE pipeline_flags SET updated_at = NULL WHERE key = 'social_channel_caps'");
  addPosts(db, "buffer-mastodon", [120, 105, 90, 75, 60, 45, 30, 15]);
  db.exec(sql);
  ok(probe(db).observed === EXCEED, "a cap row with no updated_at counts the whole window");
}
// ---- a drifted probe is left alone
{
  const db = fresh({ linkedin: 7, mastodon: 7, twitter: 21 }, { linkedin: 1, mastodon: 1, x: 1 }, capsAtSql(500));
  db.exec("UPDATE control_alternate_probes SET probe_sql = replace(probe_sql, 'posts_7d > effective_cap', 'posts_7d >= effective_cap') WHERE control = 'social-weekly-caps'");
  const d = db.prepare("SELECT probe_sql FROM control_alternate_probes").get().probe_sql;
  db.exec(sql);
  ok(db.prepare("SELECT probe_sql FROM control_alternate_probes").get().probe_sql === d, "a probe whose fragment moved is not partly rewritten");
}
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
