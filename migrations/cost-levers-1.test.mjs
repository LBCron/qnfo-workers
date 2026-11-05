// COST-LEVERS-1 (2026-11-05): replays migrations/2026-11-05-cost-levers-1.sql on node:sqlite.
// Proves: the manager request cap ignores a program-manager:* insert once the rolling 24 h count reaches ops_config manager_agent_daily_cap (default 48)
// and counts only program-manager requests of the last day; other requesters are never limited; an ignored insert changes no row and raises no error;
// raising the key reopens the gate and 100000 turns it off; the control_registry row, the gateway code task (code-task and code-anchor lines, a code-probe
// that is absent today) and the decision_log row are written once and the file re-applies without change.
// Run: node migrations/cost-levers-1.test.mjs
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const file = new URL("./2026-11-05-cost-levers-1.sql", import.meta.url);
const sql = readFileSync(file, "utf8");
let pass = 0;
const ok = (c, m, x) => { assert.ok(c, m + (x === undefined ? "" : " -- " + JSON.stringify(x).slice(0, 400))); pass++; };

for (const h of ["-- APPLY-BY: ci", "-- DB: qnfo-audit", "-- Rollback:"]) ok(sql.includes(h), "header " + h);
ok(!/^\s*(DELETE\s+FROM|DROP\s+)/im.test(sql.split("\n").filter((l) => !l.startsWith("--")).join("\n")), "the file runs no DELETE or DROP");

const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT, updated_at TEXT);
  CREATE TABLE cf_agent_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, requester TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'run', prompt TEXT, instance TEXT, priority TEXT NOT NULL DEFAULT 'medium', status TEXT NOT NULL DEFAULT 'queued', created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')));
  CREATE TABLE control_registry (control TEXT PRIMARY KEY, location TEXT NOT NULL, kind TEXT NOT NULL, guards_against TEXT, critical_path INTEGER NOT NULL DEFAULT 0, disposition TEXT NOT NULL, disposition_state TEXT NOT NULL DEFAULT 'planned', alternate_path TEXT, alternate_tested_at TEXT, evidence TEXT NOT NULL, issue_id INTEGER, reviewed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')));
  CREATE TABLE control_alternate_probes (control TEXT PRIMARY KEY, probe_sql TEXT, window_note TEXT, enabled INTEGER);
  CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT);
  CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT, outcome_matched INTEGER);
`);
db.exec(sql);
db.exec(sql); // idempotent
ok(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type = 'trigger' AND name = 'cf_agent_requests_manager_cap_bi'").get().n === 1, "one cap trigger after two applies");
ok(db.prepare("SELECT value FROM ops_config WHERE key = 'manager_agent_daily_cap'").get().value === "48", "default cap 48, under the metric threshold of 60");
ok(db.prepare("SELECT COUNT(*) n FROM control_registry WHERE control = 'manager-agent-request-cap'").get().n === 1, "one control_registry row");
ok(db.prepare("SELECT COUNT(*) n FROM decision_log WHERE action LIKE 'COST-LEVERS-1:%'").get().n === 1, "one decision_log row");
{
  const p = db.prepare("SELECT probe_sql FROM control_alternate_probes WHERE control = 'manager-agent-request-cap'").get();
  ok(p && db.prepare("SELECT 1").get(), "one control alternate probe");
  const r1 = db.prepare(p.probe_sql).get();
  ok(r1.expected === "ok" && r1.observed === "ok", "the alternate probe reads ok with the trigger and the key present (sqlite_master is readable)", r1);
}

// the filed code task is complete and its probe is absent-today shaped
const iss = db.prepare("SELECT * FROM agent_issues WHERE title LIKE 'COST-GATEWAY-ARTICLE-1:%'").all();
ok(iss.length === 1 && iss[0].status === "open", "one open gateway code-task issue", iss.length);
const d = iss[0].description;
ok(/^code-task: repo=qnfo-workers path=qnfo-gateway\/worker\.js$/m.test(d) && /^code-anchor: async function articleFill\(env, only\) \{$/m.test(d), "code-task and code-anchor lines on their own lines");
const cp = /^code-probe: (\{.*\})$/m.exec(d);
ok(cp, "a code-probe line");
const probe = JSON.parse(cp[1]);
ok(probe.paths[0] === "qnfo-gateway/worker.js" && probe.absent === "a.version IS NOT COALESCE(p.version, '') OR a.body_len IS NOT LENGTH(p.body_md) OR ", "the probe names the old staleness test", probe);
const gw = readFileSync(new URL("../qnfo-gateway/worker.js", import.meta.url), "utf8");
const count = (needle) => gw.split(needle).length - 1;
ok(count("async function articleFill(env, only) {") === 1, "the anchor occurs once in qnfo-gateway/worker.js", count("async function articleFill(env, only) {"));
ok(count(probe.absent) === 1 || count(probe.absent) === 0, "the probe text is the live selection text (1 today) or already gone (0 after the fix)", count(probe.absent));

// the cap
const ins = db.prepare("INSERT INTO cf_agent_requests (requester, kind, prompt, instance, created_at) VALUES (?, 'run', 'p', ?, ?)");
const nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");
const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString().replace(/\.\d+Z$/, "Z");
const count24 = () => db.prepare("SELECT COUNT(*) n FROM cf_agent_requests WHERE requester >= 'program-manager:' AND requester < 'program-manager;' AND created_at >= strftime('%Y-%m-%dT%H:%M:%SZ','now','-1 day')").get().n;
for (let i = 0; i < 30; i++) ins.run("program-manager:QNFO.OPS", "lever-" + i, ago(2 + (i % 20)));
for (let i = 0; i < 10; i++) ins.run("program-manager:QNFO.RSCH", "roadmap-" + i, ago(30)); // older than a day: not counted
for (let i = 0; i < 100; i++) ins.run("issue-probe-agent", "probe-issue-" + i, nowIso());
ok(count24() === 30, "30 manager requests in the window", count24());
for (let i = 0; i < 30; i++) ins.run("program-manager:QNFO.INFRA", "doer-" + i, nowIso());
ok(count24() === 48, "the 49th manager insert onward is ignored: the count stops at the cap", count24());
const before = db.prepare("SELECT COUNT(*) n FROM cf_agent_requests").get().n;
const r = ins.run("program-manager:QNFO.REACH", "roadmap-x", nowIso());
ok(Number(r.changes) === 0 && db.prepare("SELECT COUNT(*) n FROM cf_agent_requests").get().n === before, "an ignored insert changes no row and raises no error", r);
ok(Number(ins.run("issue-probe-agent", "probe-issue-x", nowIso()).changes) === 1, "other requesters are not limited");
ok(Number(ins.run("cf-agents-verify", "v", nowIso()).changes) === 1, "a non-manager requester with a similar prefix is not limited");

// the key moves the gate
db.prepare("UPDATE ops_config SET value = '60' WHERE key = 'manager_agent_daily_cap'").run();
ok(Number(ins.run("program-manager:QNFO.REACH", "roadmap-y", nowIso()).changes) === 1 && count24() === 49, "raising the cap reopens the gate");
db.prepare("UPDATE ops_config SET value = '100000' WHERE key = 'manager_agent_daily_cap'").run();
for (let i = 0; i < 20; i++) ins.run("program-manager:QNFO.OPS", "z-" + i, nowIso());
ok(count24() === 69, "100000 turns the cap off", count24());
db.prepare("DELETE FROM ops_config WHERE key = 'manager_agent_daily_cap'").run();
ok(Number(ins.run("program-manager:QNFO.OPS", "after-delete", nowIso()).changes) === 0, "a missing key falls back to the default 48");

console.log(pass + " passed, 0 failed");
