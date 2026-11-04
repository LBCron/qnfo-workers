import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

// RETENTION-PRUNE-SPREAD-1: every tick deletes at most 400 rows per statement, the same rows as before are due, nothing else is touched, and retention_prune = off stops it.
const migration = readFileSync(new URL("./2026-11-04-retention-prune-spread.sql", import.meta.url), "utf8");
assert.match(migration, /^-- APPLY-BY: ci$/m);
assert.match(migration, /^-- DB: qnfo-audit$/m);
assert.match(migration, /^-- BACKUP: bak_20261104_retention_prune_trigger$/m);
assert.match(migration, /^-- Rollback: /m);

const T0 = Date.now();
const iso = (days) => new Date(T0 - days * 86400000).toISOString();
const isoZ = (days) => iso(days).replace(/\.\d+Z$/, "Z");

const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT);
  CREATE TABLE fleet_tick (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), source TEXT);
  CREATE TABLE cloud_ops_events (id TEXT PRIMARY KEY, ts TEXT, kind TEXT);
  CREATE INDEX idx_coe_ts ON cloud_ops_events (ts);
  CREATE TABLE remediation_verifications (id INTEGER PRIMARY KEY AUTOINCREMENT, verified_at TEXT);
  CREATE INDEX idx_remediation_verifications_ts ON remediation_verifications (verified_at);
  CREATE TABLE fleet_probe_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, name TEXT, transport TEXT);
  CREATE INDEX idx_fpl_ts ON fleet_probe_log (ts);
  CREATE INDEX idx_fpl_name_transport_ts ON fleet_probe_log (name, transport, ts);
  CREATE TABLE decision_log (actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT,
    predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
  -- the trigger as RETENTION-SWEEP-1 left it: minute < 10 only, 5,000 rows a statement
  CREATE TRIGGER retention_prune_tick_v2 AFTER INSERT ON fleet_tick
  WHEN strftime('%M', 'now') < '10' AND COALESCE((SELECT value FROM ops_config WHERE key = 'retention_prune'), 'on') <> 'off'
  BEGIN
    DELETE FROM remediation_verifications WHERE id IN (SELECT id FROM remediation_verifications INDEXED BY idx_remediation_verifications_ts
      WHERE verified_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-8 days') LIMIT 5000);
  END;
`);
db.exec("BEGIN");
const rv = db.prepare("INSERT INTO remediation_verifications (verified_at) VALUES (?)");
for (let i = 0; i < 3000; i++) rv.run(iso(10 + (i % 3)));       // due: 3,000 rows older than 8 days
for (let i = 0; i < 500; i++) rv.run(iso(1 + (i % 5)));         // kept: inside the 8 days
const coe = db.prepare("INSERT INTO cloud_ops_events (id, ts, kind) VALUES (?, ?, ?)");
let n = 0;
for (let i = 0; i < 1000; i++) coe.run("h" + n++, isoZ(6 + (i % 3)), "heartbeat");        // due: housekeeping kind older than 5 days
for (let i = 0; i < 500; i++) coe.run("k" + n++, isoZ(6 + (i % 3)), "important-kind");    // kept: not a housekeeping kind, under 90 days
for (let i = 0; i < 500; i++) coe.run("r" + n++, isoZ(1 + (i % 3)), "heartbeat");         // kept: housekeeping but recent
for (let i = 0; i < 900; i++) coe.run("a" + n++, isoZ(100 + (i % 5)), "important-kind");  // due by the 90-day statement
const fpl = db.prepare("INSERT INTO fleet_probe_log (ts, name, transport) VALUES (?, ?, ?)");
for (let i = 0; i < 1000; i++) fpl.run(iso(30 + (i % 4)).replace(/Z$/, "Z"), "probe" + (i % 10), "d1");   // due: older than 21 days and a newer row exists
for (let i = 0; i < 10; i++) fpl.run(iso(1), "probe" + i, "d1");                                           // the newer rows
db.exec("COMMIT");
const count = (sql) => db.prepare(sql).get().n;
const rvOld = () => count(`SELECT COUNT(*) AS n FROM remediation_verifications WHERE verified_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-8 days')`);
const coeHk = () => count(`SELECT COUNT(*) AS n FROM cloud_ops_events WHERE kind = 'heartbeat' AND ts < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-5 days')`);
const coeAncient = () => count(`SELECT COUNT(*) AS n FROM cloud_ops_events WHERE ts < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-90 days')`);
const fplOld = () => count(`SELECT COUNT(*) AS n FROM fleet_probe_log WHERE ts < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-21 days')`);
assert.deepEqual([rvOld(), coeHk(), coeAncient(), fplOld()], [3000, 1000, 900, 1000], "fixture sanity");

db.exec(migration);
const sql = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'retention_prune_tick_v2'").get().sql;
assert.ok(!sql.includes("strftime('%M', 'now') < '10'"), "no minute gate");
assert.doesNotMatch(sql, /LIMIT 5000|LIMIT 3000/, "no large batch");
assert.equal((sql.match(/LIMIT 400/g) || []).length, 4, "four statements, 400 rows each");
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM bak_20261104_retention_prune_trigger").get().n, 1, "the old definition is backed up");

// One tick, whatever the minute: at most 400 rows per statement.
const tick = () => db.exec("INSERT INTO fleet_tick (source) VALUES ('test')");
const before = [rvOld(), coeHk(), coeAncient(), fplOld()];
tick();
const after1 = [rvOld(), coeHk(), coeAncient(), fplOld()];
assert.deepEqual(before.map((b, i) => b - after1[i]), [400, 400, 400, 400], "the first tick deletes 400 of each class: " + after1);
for (let i = 0; i < 5; i++) tick();
assert.deepEqual([rvOld(), coeHk(), coeAncient(), fplOld()], [3000 - 2400, 0, 0, 0 + Math.max(0, 1000 - 2400)], "six ticks: 2,400 verifications, the smaller classes are gone");

// Only due rows were removed.
assert.equal(count("SELECT COUNT(*) AS n FROM remediation_verifications WHERE verified_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-8 days')"), 500, "recent verifications kept");
assert.equal(count("SELECT COUNT(*) AS n FROM cloud_ops_events WHERE kind = 'important-kind' AND ts >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-90 days')"), 500, "non-housekeeping kinds under 90 days kept");
assert.equal(count("SELECT COUNT(*) AS n FROM cloud_ops_events WHERE kind = 'heartbeat' AND ts >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-5 days')"), 500, "recent housekeeping events kept");
assert.equal(count("SELECT COUNT(*) AS n FROM fleet_probe_log WHERE ts >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-21 days')"), 10, "the newest probe rows kept");

// The kill switch still works.
db.exec("INSERT INTO ops_config (key, value) VALUES ('retention_prune', 'off')");
const frozen = rvOld();
tick(); tick();
assert.equal(rvOld(), frozen, "retention_prune = off stops pruning");

db.exec(migration);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 1, "replay is idempotent");
db.close();
console.log("retention-prune-spread: all passed");
