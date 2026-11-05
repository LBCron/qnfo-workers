// WRITE-ROUTES-4 offline suite: replays migrations/2026-11-04-c5-resilience-write-route-view.sql on node:sqlite, on top of the migration that files the issue it edits.
// Proves: the header opts in (APPLY-BY ci, DB qnfo-audit, one Rollback line, no LIKE pattern over 50 bytes, no trigger); v_unauth_write_routes returns only the latest run of the metric and answers through the (metric, run_at) index; the deploy-guard issue gets the caller note
// before its code-task line, which stays the last block with its anchor and probe intact; a replay changes nothing; the Rollback line restores the issue text byte for byte and drops the view; the other issues are untouched.
// Output MUST contain "0 failed" on success.   node migrations/c5-resilience-write-route-view.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const rd = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const first = rd("./2026-11-04-c5-resilience-write-route-probe.sql");
const sql = rd("./2026-11-04-c5-resilience-write-route-view.sql");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };

const header = sql.split("\n").filter((l) => l.startsWith("--"));
const body = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
ok(header.some((l) => /^-- APPLY-BY: ci\s*$/.test(l)) && header.some((l) => /^-- DB: qnfo-audit\s*$/.test(l)), "header opts in: APPLY-BY ci, DB qnfo-audit");
ok(header.filter((l) => /^-- Rollback:/.test(l)).length === 1, "exactly one single-line Rollback header");
ok(!/\b(DELETE\s+FROM|DROP\s+(TABLE|INDEX|TRIGGER))\b/i.test(body) && !/CREATE\s+(TEMP\s+)?TRIGGER/i.test(body), "the body deletes nothing, drops nothing and creates no trigger");
const likes = [...body.matchAll(/LIKE\s+'((?:[^']|'')*)'/gi)].map((m) => m[1]);
ok(likes.every((p) => Buffer.byteLength(p) <= 50), "no LIKE pattern over 50 bytes (D1 rejects it)", likes);

const rollback = header.find((l) => /^-- Rollback:/.test(l)).replace(/^-- Rollback:\s*/, "");
const w = new DatabaseSync(":memory:");
w.exec(`CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, layer TEXT, kind TEXT, formula TEXT, source_of_truth TEXT, baseline TEXT, target TEXT, owner TEXT, disposition_actor TEXT, refresh_cadence TEXT, warning_band TEXT, kill_band TEXT, state TEXT, refresh_class TEXT, last_value TEXT, last_refreshed TEXT);
CREATE TABLE analytics_metric_triggers (id INTEGER PRIMARY KEY AUTOINCREMENT, metric_key TEXT, title TEXT, source_table TEXT, operator TEXT, threshold REAL, priority INTEGER, action TEXT, owner TEXT, queue_target TEXT, cooldown_hours INTEGER, enabled INTEGER, notes TEXT);
CREATE TABLE metric_breach_cause (metric_key TEXT, cause_key TEXT, note TEXT, PRIMARY KEY (metric_key, cause_key));
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE transformation_levers (id INTEGER PRIMARY KEY AUTOINCREMENT, tp INTEGER, n INTEGER, key TEXT, status TEXT DEFAULT 'pending', note TEXT, landed_at TEXT);
CREATE TABLE roadmap_implementation (id INTEGER PRIMARY KEY, item TEXT, source TEXT, status TEXT, evidence TEXT);
CREATE TABLE bp26_probe_results (id INTEGER PRIMARY KEY AUTOINCREMENT, run_at TEXT, metric TEXT, subject TEXT, ok INTEGER, detail TEXT, producer TEXT);
CREATE INDEX idx_bp26_probe_metric_time ON bp26_probe_results (metric, run_at);`);
w.prepare("INSERT INTO roadmap_implementation (id, item, source, status, evidence) VALUES (133, 'RM-TP-8-TRUST-BOUNDARY', 'T8', 'not-built', 'e')").run();
w.prepare("INSERT INTO transformation_levers (tp, n, key, status, note) VALUES (8, 2, 'containers-exec-access', 'pending', 'n')").run();
w.exec(first);
const issues0 = w.prepare("SELECT id, title, description FROM agent_issues ORDER BY id").all();
const dg = issues0.find((i) => i.title.includes("WRITE-ROUTES-DEPLOY-GUARD-1"));
const rk = issues0.find((i) => i.title.includes("WRITE-ROUTES-RESEARCH-KICK-1"));
ok(dg && rk, "the first migration filed both issues");
const ins = w.prepare("INSERT INTO bp26_probe_results (run_at, metric, subject, ok, detail, producer) VALUES (?, ?, ?, ?, ?, 'write_routes')");
ins.run("2026-11-05T00:09:59Z", "unauth_write_routes_open", "qnfo-evolve POST /tick", 0, "HTTP 200 OPEN");
ins.run("2026-11-05T01:09:59Z", "unauth_write_routes_open", "qnfo-deploy-guard POST /scan", 0, "HTTP 200 OPEN");
ins.run("2026-11-05T01:09:59Z", "unauth_write_routes_open", "qnfo-ops POST /mcp", 1, "HTTP 401 refused");
ins.run("2026-11-05T01:09:59Z", "ops_gateway_hosts_ok", "primary ops.qnfo.org", 1, "ok");
ins.run("2026-11-05T01:30:00Z", "ops_gateway_hosts_ok", "primary ops.qnfo.org", 1, "ok");
const one = (q, ...a) => w.prepare(q).get(...a);
const snap = () => JSON.stringify([w.prepare("SELECT id, title, description FROM agent_issues ORDER BY id").all(), w.prepare("SELECT name FROM sqlite_master WHERE type = 'view'").all()]);

w.exec(sql);
const rows = w.prepare("SELECT subject, ok, detail FROM v_unauth_write_routes ORDER BY ok, subject").all();
ok(rows.length === 2 && rows[0].subject === "qnfo-deploy-guard POST /scan" && rows[0].ok === 0 && rows[1].subject === "qnfo-ops POST /mcp" && rows[1].ok === 1, "the view returns only the latest run of this metric, open routes first", rows);
const plan = w.prepare("EXPLAIN QUERY PLAN SELECT * FROM v_unauth_write_routes").all().map((r) => r.detail).join(" | ");
ok(/idx_bp26_probe_metric_time/.test(plan) && !/SCAN bp26_probe_results(?! USING)/.test(plan.replace(/USING (COVERING )?INDEX/g, "USING INDEX")), "the view is answered through the (metric, run_at) index, no table scan", plan);

const dg1 = one("SELECT description FROM agent_issues WHERE id = ?", dg.id).description;
const iNote = dg1.indexOf("C5-RESILIENCE caller findings 2026-11-05");
const iEnd = dg1.indexOf("END C5-RESILIENCE-NOTE");
const iTask = dg1.indexOf("\ncode-task: repo=qnfo-workers path=qnfo-deploy-guard/worker.js");
ok(iNote > 0 && iEnd > iNote && iTask > iEnd, "the note sits before the code-task line", { iNote, iEnd, iTask });
ok(dg1.slice(iTask) === dg.description.slice(dg.description.indexOf("\ncode-task: repo=qnfo-workers path=qnfo-deploy-guard/worker.js")), "the code-task, code-anchor and code-probe block is unchanged and still last");
ok(/scripts\/deploy_guard\.py/.test(dg1) && /props\.caller/.test(dg1) && /d1-overload-resilience\.test\.mjs/.test(dg1) && /never as a flat refusal/.test(dg1), "the note names the CLI caller, the props pattern, the test fixture and forbids a flat refusal");
ok(dg1.startsWith(dg.description.slice(0, dg.description.indexOf("\ncode-task:"))), "the original text before the block is kept");
ok(one("SELECT description FROM agent_issues WHERE id = ?", rk.id).description === rk.description, "the research-exec issue is untouched");

const before = snap();
w.exec(sql);
ok(before === snap(), "a replay changes nothing");
w.exec(rollback);
ok(one("SELECT description FROM agent_issues WHERE id = ?", dg.id).description === dg.description, "the Rollback line restores the issue text byte for byte");
ok(w.prepare("SELECT name FROM sqlite_master WHERE type = 'view' AND name = 'v_unauth_write_routes'").all().length === 0, "the Rollback line drops the view");

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
