import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

// OUTCOME-NORTHSTAR-FIX-1: the view reads ask_feedback.ts, so INSERT INTO fleet_tick compiles again; the tick-age detector reads 0 fresh and 1 stale.
const migration = readFileSync(new URL("./2026-11-04-outcome-northstar-ask-feedback-ts.sql", import.meta.url), "utf8");
assert.match(migration, /^-- APPLY-BY: ci$/m);
assert.match(migration, /^-- DB: qnfo-audit$/m);
assert.match(migration, /^-- BACKUP: bak_20261104_v_outcome_northstar$/m);
assert.match(migration, /^-- Rollback: /m);

const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE fleet_tick (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), source TEXT);
  CREATE TABLE code_tasks (id TEXT, path TEXT, goal TEXT, created_at TEXT);
  CREATE TABLE reader_reports (id INTEGER PRIMARY KEY, created_at TEXT);
  CREATE TABLE ask_feedback (event_id TEXT, ts TEXT, helpful INTEGER);
  CREATE VIEW v_channel_impact_7d AS SELECT 'bluesky' AS channel, 12 AS human_clicks_7d UNION ALL SELECT 'x', 3;
  CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, last_value TEXT, last_refreshed TEXT, state TEXT);
  INSERT INTO metric_registry (metric) VALUES ('product_task_share_7d'), ('outreach_human_clicks_7d'), ('reader_signal_7d');
  CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT, root_cause TEXT, remediation TEXT, detector TEXT, probe_class TEXT, first_seen TEXT, issue_id INTEGER,
    trigger_condition TEXT, symptom TEXT, blast_radius TEXT);
  CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER,
    escalate_to TEXT, expected_cadence_h INTEGER, status TEXT, next_due_at TEXT, module TEXT, budget_ms INTEGER, max_items INTEGER, requires_container INTEGER);
  CREATE TABLE decision_log (actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT,
    predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
  -- as PR 7023 shipped it: the view reads ask_feedback.created_at, which does not exist
  CREATE VIEW v_outcome_northstar AS
  SELECT 'product_task_share_7d' AS metric, ROUND(1.0*SUM(NOT (path LIKE 'scripts/%' OR goal LIKE '%probe%'))/COUNT(*),3) AS value FROM code_tasks WHERE created_at>=datetime('now','-7 day')
  UNION ALL SELECT 'outreach_human_clicks_7d', COALESCE(SUM(human_clicks_7d),0) FROM v_channel_impact_7d
  UNION ALL SELECT 'reader_signal_7d', (SELECT count(*) FROM reader_reports WHERE created_at>=datetime('now','-7 day'))+(SELECT count(*) FROM ask_feedback WHERE created_at>=datetime('now','-7 day'));
  CREATE TRIGGER outcome_northstar_tick AFTER INSERT ON fleet_tick WHEN strftime('%M','now')<'10'
  BEGIN
    UPDATE metric_registry SET last_refreshed=strftime('%Y-%m-%dT%H:%M:%SZ','now'), state='MEASURED',
      last_value=CAST((SELECT value FROM v_outcome_northstar v WHERE v.metric=metric_registry.metric) AS TEXT)
    WHERE metric IN ('product_task_share_7d','outreach_human_clicks_7d','reader_signal_7d');
  END;
`);
const iso = (days) => new Date(Date.now() - days * 86400000).toISOString().replace(/\.\d+Z$/, "Z");
db.prepare("INSERT INTO code_tasks VALUES ('a', 'qnfo-ai/worker.js', 'make it better', ?)").run(iso(1));
db.prepare("INSERT INTO code_tasks VALUES ('b', 'scripts/x.py', 'tidy', ?)").run(iso(1));
db.prepare("INSERT INTO reader_reports VALUES (1, ?)").run(iso(2));
db.prepare("INSERT INTO ask_feedback VALUES ('e1', ?, 1)").run(iso(1));
db.prepare("INSERT INTO ask_feedback VALUES ('e2', ?, 0)").run(iso(30));

// Before: every insert into fleet_tick fails at prepare time, although the trigger's WHEN is usually false.
assert.throws(() => db.exec("INSERT INTO fleet_tick (source) VALUES ('before')"), /no such column: created_at/, "before: the broken view kills every fleet_tick insert");

db.exec(migration);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM bak_20261104_v_outcome_northstar").get().n, 1, "the previous definition is backed up");
db.exec("INSERT INTO fleet_tick (source) VALUES ('after')");
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM fleet_tick").get().n, 1, "after: the insert works");
const v = Object.fromEntries(db.prepare("SELECT metric, value FROM v_outcome_northstar").all().map((r) => [r.metric, r.value]));
assert.deepEqual(v, { product_task_share_7d: 0.5, outreach_human_clicks_7d: 15, reader_signal_7d: 2 }, "reader_signal_7d counts the reader report and the ask_feedback row of the last 7 days");

// Detector.
const probe = db.prepare("SELECT verify_probe FROM remediation_contracts WHERE class = 'fm-fleet-tick-stale-20m'").get().verify_probe;
assert.deepEqual({ ...db.prepare(probe).get() }, { expected: "0", observed: "0" }, "a fresh tick reads 0");
db.exec("UPDATE fleet_tick SET ts = strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-25 minutes')");
assert.equal(db.prepare(probe).get().observed, "1", "a tick older than 20 minutes reads 1");

db.exec(migration);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 1, "replay is idempotent");
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM failure_modes").get().n, 1);
db.close();
console.log("outcome-northstar-fix: all passed");
