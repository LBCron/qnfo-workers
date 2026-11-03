// FLEET-GRAPH-SPOF-PROBE-1: a SPOF alternate counts as tested only when the cadence dispatch was accepted and the build followed it.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./2026-11-03-fleet-graph-spof-probe.sql", import.meta.url), "utf8");
const header = migration.split("\n").filter((line) => line.startsWith("--"));
const body = migration.split("\n").filter((line) => !line.startsWith("--")).join("\n");
const rollback = header.find((line) => line.startsWith("-- Rollback:"))?.slice("-- Rollback:".length).trim();
let pass = 0, fail = 0;
const ok = (condition, name, detail) => {
  if (condition) pass++;
  else { fail++; console.log("FAIL " + name + (detail === undefined ? "" : " :: " + JSON.stringify(detail))); }
};

ok(header.includes("-- APPLY-BY: ci") && header.includes("-- DB: qnfo-audit"), "migration opts in for CI");
ok(!!rollback && !/\b(DROP\s+(TABLE|INDEX|VIEW|TRIGGER)|DELETE\s+FROM)\b/i.test(body), "migration has rollback and its body does not delete data");

const db = new DatabaseSync(":memory:");
db.exec(`
CREATE TABLE spof_alternate_probes (component TEXT PRIMARY KEY, probe_sql TEXT NOT NULL, exercise TEXT, window_note TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, last_run_at TEXT, last_pass INTEGER, last_pass_at TEXT, last_observed TEXT);
CREATE TABLE cloud_ops_events (ts TEXT, kind TEXT, status TEXT, text TEXT);
INSERT INTO spof_alternate_probes (component, probe_sql, window_note) VALUES ('unrelated', 'SELECT ''ok'' AS expected, ''ok'' AS observed', 'keep');
`);
db.exec(body);
db.exec(body);
const probe = db.prepare("SELECT probe_sql, enabled, window_note FROM spof_alternate_probes WHERE component = 'fleet-graph build'").get();
ok(!!probe && probe.enabled === 1 && probe.window_note.startsWith("FLEET-GRAPH-SPOF-PROBE-1"), "migration registers one enabled fleet-graph probe after replay");
ok(db.prepare("SELECT COUNT(*) n FROM spof_alternate_probes WHERE component = 'fleet-graph build'").get().n === 1, "migration replay is idempotent");

const verdict = () => db.prepare(probe.probe_sql).get();
ok(verdict().expected !== verdict().observed, "missing event evidence fails");
const now = Date.now();
const at = (ms) => new Date(ms).toISOString();
const staleAt = now - 8 * 24 * 60 * 60_000;
db.prepare("INSERT INTO cloud_ops_events (ts, kind, status, text) VALUES (?, 'fleet-graph-cadence', 'ok', 'repository_dispatch fleet-graph-tick -> HTTP 204')").run(at(staleAt));
db.prepare("INSERT INTO cloud_ops_events (ts, kind, status, text) VALUES (?, 'fleet-graph', 'ok', 'build complete')").run(at(staleAt + 5 * 60_000));
ok(verdict().expected !== verdict().observed, "event pairs older than seven days fail");
const dispatchAt = now - 60_000;
db.prepare("INSERT INTO cloud_ops_events (ts, kind, status, text) VALUES (?, 'fleet-graph-cadence', 'ok', 'repository_dispatch fleet-graph-tick -> HTTP 204')").run(at(dispatchAt));
ok(verdict().expected !== verdict().observed, "an accepted dispatch without a subsequent build fails");
db.prepare("INSERT INTO cloud_ops_events (ts, kind, status, text) VALUES (?, 'fleet-graph', 'ok', 'build complete')").run(at(dispatchAt - 60_000));
ok(verdict().expected !== verdict().observed, "a build that predates the dispatch fails");
db.prepare("INSERT INTO cloud_ops_events (ts, kind, status, text) VALUES (?, 'fleet-graph', 'ok', 'build complete')").run(at(dispatchAt + 5 * 60_000));
ok(verdict().expected === verdict().observed, "an accepted dispatch followed by a successful build passes");
db.prepare("INSERT INTO cloud_ops_events (ts, kind, status, text) VALUES (?, 'fleet-graph-cadence', 'failed', 'HTTP 500')").run(at(dispatchAt + 6 * 60_000));
ok(verdict().expected === verdict().observed, "a later failed dispatch does not negate an earlier passing pair within the evidence window");
db.prepare(rollback).run();
ok(db.prepare("SELECT COUNT(*) n FROM spof_alternate_probes WHERE component = 'fleet-graph build'").get().n === 0, "rollback removes only this probe");
ok(db.prepare("SELECT COUNT(*) n FROM spof_alternate_probes WHERE component = 'unrelated'").get().n === 1, "rollback preserves unrelated probes");

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
