// DASHBOARD-DATA-LIVENESS-1 offline suite: the four data-route liveness contracts parse, are runner-https and active, and each marker is a substring the
// real dashboard prints (run against scripts/ux-journeys/apps/fleet-harness.mjs, which serves the real worker.js), so a change to the JSON shape or key order of
// /api/v3/now or /api/v3/readers fails here instead of silently failing the probe live.
// Run: node migrations/dashboard-data-liveness.test.mjs   -> prints "N passed, 0 failed"
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(here, "2026-11-04-dashboard-data-liveness.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 300))); } };

const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER, escalate_to TEXT, expected_cadence_h INTEGER, status TEXT, module TEXT, budget_ms INTEGER, max_items INTEGER, next_due_at TEXT)");
db.exec("CREATE TABLE decision_log (actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT)");
db.exec(sql);

const rows = db.prepare("SELECT * FROM remediation_contracts ORDER BY class").all();
ok(rows.length === 4, "four contracts inserted", rows.map((r) => r.class));
ok(rows.every((r) => r.status === "active" && r.verify_transport === "runner-https" && r.module === "runtime-liveness-v1" && r.expected_cadence_h === 1), "every row is active, runner-https and hourly");
ok(db.prepare("SELECT COUNT(*) n FROM decision_log").get().n === 1, "one decision_log row");
const probes = {};
for (const r of rows) {
  let p = null; try { p = JSON.parse(r.verify_probe); } catch (e) { /* reported below */ }
  ok(p && /^https:\/\/fleet\.qnfo\.org\/api\/v3\/(now|readers)$/.test(p.url) && p.status === 200 && p.max_ms >= 10000, r.class + " probe parses and reads an owner data route", r.verify_probe);
  probes[r.class] = p;
}
const MARK = { "rt-data-fleet-now-needs": '"needs":{"ok":true', "rt-data-fleet-now-spend": '"spend":{"ok":true', "rt-data-fleet-now-health": '"health":{"ok":true', "rt-data-fleet-readers-reach": '"reach":{"ok":true' };
for (const [c, m] of Object.entries(MARK)) ok(probes[c] && probes[c].contains === m, c + " marker is " + m, probes[c] && probes[c].contains);
ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: /m.test(sql), "the migration carries the runner header lines");
ok(!/\b(DELETE|DROP)\b/i.test(sql.split("\n").filter((l) => !l.startsWith("--")).join("\n")), "the migration deletes and drops nothing");
ok(!/INSERT[^;]*INTO\s+metric_registry/i.test(sql), "no metric is registered (so no breach cause to map)");

// Coupling to the real dashboard: each marker's section prefix is printed by the worker (compact JSON, "ok" first), so the live probe can pass.
const { startFleet } = await import(pathToFileURL(join(here, "..", "scripts", "ux-journeys", "apps", "fleet-harness.mjs")).href);
const h = await startFleet();
try {
  const get = async (p) => (await fetch(h.base + p)).text();
  const now = await get("/api/v3/now"), readers = await get("/api/v3/readers");
  for (const [c, m] of Object.entries(MARK)) {
    const body = c.includes("readers") ? readers : now;
    const prefix = m.slice(0, m.indexOf('{"ok":') + 6);
    ok(body.includes(prefix), c + ": the worker prints " + prefix + " (true or false) in compact JSON", body.slice(0, 160));
  }
  ok(now.includes('"needs":{"ok":true') && now.includes('"health":{"ok":true'), "with data readable the exact needs and health markers are printed", now.slice(0, 300));
} finally { await h.close(); }
console.log(pass + " passed, " + fail + " failed");
process.exitCode = fail ? 1 : 0;
