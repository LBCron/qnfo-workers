// REM-A5-RETIRE-ARTIFACTS-1 offline suite: replays migrations/2026-10-26-rem-a5-retire-qnfo-artifacts.sql on node:sqlite.
// Proves: the header opts in (APPLY-BY ci, DB qnfo-audit, one Rollback line, nothing deleted or dropped, decision_log only inserted into); the qnfo-artifacts registry row goes live ->
// retired and no other row changes; the two named contracts are superseded with the reason and every other contract keeps its state (including a contract of another worker on the
// same host family); one decision row carries a prediction the live parser reads (worker_count <= 35 within 3 h); a replay changes nothing; the Rollback line puts the rows back;
// the retirement marker the PR added is on disk and the deploy manifest and the qnfo-ops declaration no longer name the worker.
// Output MUST contain "0 failed" on success.   node migrations/rem-a5-retire-qnfo-artifacts.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync } from "node:fs";

const root = new URL("../", import.meta.url);
const rd = (rel) => readFileSync(new URL(rel, root), "utf8");
const sql = rd("migrations/2026-10-26-rem-a5-retire-qnfo-artifacts.sql");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 500))); } };

const header = sql.split("\n").filter((l) => l.startsWith("--"));
const body = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
ok(header.some((l) => /^-- APPLY-BY: ci\s*$/.test(l)) && header.some((l) => /^-- DB: qnfo-audit\s*$/.test(l)), "header opts in: APPLY-BY ci, DB qnfo-audit");
ok(header.filter((l) => /^-- Rollback:/.test(l)).length === 1, "exactly one single-line Rollback header");
ok(!/^\s*(DELETE\s+FROM|DROP\s+(TABLE|INDEX|VIEW|TRIGGER))\b/im.test(body), "the body deletes and drops nothing");
ok(!/\b(UPDATE|DELETE\s+FROM|REPLACE\s+INTO|INSERT\s+OR\s+REPLACE\s+INTO)\s+(decision_log|issue_lifecycle)\b/i.test(body), "APPEND-ONLY-LINT-1: decision_log is only inserted into");
ok(!/INSERT\s+(OR\s+\w+\s+)?INTO\s+fleet_tick/i.test(body) && !/claude\.ai|anthropic\.com/i.test(sql), "no write to fleet_tick and no claude.ai or anthropic.com link");
ok(Array.from(body.matchAll(/LIKE\s+'((?:[^']|'')*)'/gi)).every((m) => Buffer.byteLength(m[1]) <= 50), "every LIKE pattern is at most 50 bytes");

// the repository half of the retirement (PR 4800) is on this checkout
ok(existsSync(new URL("qnfo-artifacts/RETIRED", root)) || existsSync(new URL("archive/qnfo-artifacts/RETIRED", root)), "qnfo-artifacts/RETIRED exists, in place or under archive/ after RM-REPO-DEAD-SOURCES-1 moved it (the marker cf-ops-actions delete-worker reads)");
ok(!/^qnfo-artifacts\s/m.test(rd("deploy-targets.txt")), "deploy-targets.txt no longer lists qnfo-artifacts");
ok(!/service\s*=\s*"qnfo-artifacts"/.test(rd("qnfo-ops/wrangler.toml")) && !/CH_QNFO_ARTIFACTS/.test(rd("qnfo-ops/wrangler.toml").replace(/^#.*$/gm, "")), "qnfo-ops/wrangler.toml declares no binding to qnfo-artifacts");

const calib = rd("migrations/2026-10-12-22-calibration-scorer.sql");
const pt0 = calib.indexOf("CREATE TRIGGER IF NOT EXISTS decision_predictions_parse"), pt1 = calib.indexOf("\nEND;", pt0) + 5;
const PARSE_TRIGGER = calib.slice(pt0, pt1);

function world() {
  const w = new DatabaseSync(":memory:");
  w.exec(`CREATE TABLE service_registry (service TEXT PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'worker', version TEXT, base_url TEXT, purpose TEXT, capabilities TEXT, routes TEXT, tools TEXT, models TEXT, deps TEXT, updated_at TEXT, state TEXT NOT NULL DEFAULT 'live');
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER DEFAULT 3, escalate_to TEXT, expected_cadence_h INTEGER DEFAULT 1, status TEXT DEFAULT 'active', ts TEXT, last_attempt_at TEXT, last_verdict TEXT, module TEXT, budget_ms INTEGER DEFAULT 45000, next_due_at TEXT);
CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, last_value TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
CREATE TRIGGER decision_log_no_update BEFORE UPDATE ON decision_log BEGIN SELECT RAISE(ABORT, 'decision_log is append-only'); END;
CREATE TABLE decision_predictions (id INTEGER PRIMARY KEY AUTOINCREMENT, decision_id INTEGER NOT NULL, kind TEXT NOT NULL, subject TEXT NOT NULL, op TEXT NOT NULL, value REAL, value2 REAL, due_at TEXT NOT NULL, origin TEXT NOT NULL, scored_at TEXT, UNIQUE (decision_id, kind, subject, op));`);
  w.exec(PARSE_TRIGGER);
  w.prepare("INSERT INTO metric_registry (metric, last_value) VALUES ('worker_count', '36')").run();
  const sr = w.prepare("INSERT INTO service_registry (service, state, updated_at) VALUES (?, ?, '2026-10-25T00:00:00Z')");
  sr.run("qnfo-artifacts", "live"); sr.run("qnfo-ops", "live"); sr.run("qnfo-evolve", "live"); sr.run("qnfo-artifacts-sibling", "live"); sr.run("qnfo-workers", "retired");
  const rc = w.prepare("INSERT INTO remediation_contracts (class, issue_id, verify_probe, verify_transport, status, last_verdict, next_due_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
  rc.run("rt-live-qnfo-artifacts", null, '{"url": "https://qnfo-artifacts.q08.workers.dev/health", "status": 200, "contains": "version"}', "runner-https", "active", "pass", "2026-10-26 20:00:00");
  rc.run("issue-3010", 3010, "SELECT 1", "d1-query", "holding", "deferred", "2026-10-26 21:00:00");
  rc.run("issue-2995", 2995, "SELECT 1", "d1-query", "closed", "pass", null);
  rc.run("rt-live-qnfo-evolve", null, '{"url": "https://qnfo-evolve.q08.workers.dev/health"}', "runner-https", "active", "pass", "2026-10-26 20:00:00");
  rc.run("fm-registry-live-absent", null, "SELECT 1", "d1-query", "active", "pass", "2026-10-26 20:00:00");
  return w;
}
const q1 = (w, s, ...p) => w.prepare(s).get(...p);
const qa = (w, s, ...p) => w.prepare(s).all(...p);
const state = (w, s) => (q1(w, "SELECT state s FROM service_registry WHERE service = ?", s) || {}).s;
const cst = (w, c) => (q1(w, "SELECT status s FROM remediation_contracts WHERE class = ?", c) || {}).s;

const w = world();
w.exec(sql);
ok(state(w, "qnfo-artifacts") === "retired", "qnfo-artifacts is retired in service_registry");
ok(state(w, "qnfo-ops") === "live" && state(w, "qnfo-evolve") === "live" && state(w, "qnfo-artifacts-sibling") === "live" && state(w, "qnfo-workers") === "retired", "no other registry row changed (a name that starts the same way, the host, another worker and an already retired row)");
ok(/^\d{4}-\d\d-\d\dT/.test(q1(w, "SELECT updated_at u FROM service_registry WHERE service = 'qnfo-artifacts'").u) && q1(w, "SELECT updated_at u FROM service_registry WHERE service = 'qnfo-artifacts'").u > "2026-10-26", "updated_at is stamped");
ok(cst(w, "rt-live-qnfo-artifacts") === "superseded" && cst(w, "issue-3010") === "superseded", "the liveness contract and the holding contract of the closed issue are superseded");
ok(/^superseded:REM-A5-RETIRE-ARTIFACTS-1/.test(q1(w, "SELECT last_verdict v FROM remediation_contracts WHERE class = 'rt-live-qnfo-artifacts'").v), "with the reason on the row");
ok(cst(w, "issue-2995") === "closed" && cst(w, "rt-live-qnfo-evolve") === "active" && cst(w, "fm-registry-live-absent") === "active", "no other contract changed state (a closed one, another worker's liveness probe, the detector)");
const dec = qa(w, "SELECT actor, predicted_outcome FROM decision_log");
ok(dec.length === 1 && dec[0].actor === "rem-a5", "one decision row");
const pred = qa(w, "SELECT subject, op, value, CAST(round((julianday(due_at) - julianday('now')) * 24) AS INTEGER) h FROM decision_predictions");
ok(pred.length === 1 && pred[0].subject === "worker_count" && pred[0].op === "<=" && pred[0].value === 35 && Math.abs(pred[0].h - 3) <= 1, "the live parser reads worker_count <= 35 within 3 h", pred);

{ // replay
  const snap = () => JSON.stringify([qa(w, "SELECT service, state, updated_at FROM service_registry ORDER BY service"), qa(w, "SELECT class, status, last_verdict FROM remediation_contracts ORDER BY class"), qa(w, "SELECT action FROM decision_log"), qa(w, "SELECT decision_id, subject FROM decision_predictions")]);
  const s1 = snap();
  w.exec(sql);
  ok(snap() === s1, "a second apply changes nothing");
}
{ // a worker that is not live is left alone (the registry half never revives or re-stamps)
  const x = world();
  x.prepare("UPDATE service_registry SET state = 'retired', updated_at = '2026-10-20T00:00:00Z' WHERE service = 'qnfo-artifacts'").run();
  x.exec(sql);
  ok(q1(x, "SELECT updated_at u FROM service_registry WHERE service = 'qnfo-artifacts'").u === "2026-10-20T00:00:00Z", "an already retired row keeps its updated_at");
}
{ // rollback
  const r = world();
  const fresh = JSON.stringify([qa(r, "SELECT service, state, updated_at FROM service_registry ORDER BY service"), qa(r, "SELECT class, status, last_verdict, next_due_at FROM remediation_contracts ORDER BY class")]);
  r.exec(sql);
  r.exec(sql.split("\n").find((l) => l.startsWith("-- Rollback: ")).slice("-- Rollback: ".length));
  const back = JSON.stringify([qa(r, "SELECT service, state, updated_at FROM service_registry ORDER BY service"), qa(r, "SELECT class, status, last_verdict, next_due_at FROM remediation_contracts ORDER BY class")]);
  ok(back === fresh, "Rollback restores the registry row and both contracts byte for byte");
}

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
