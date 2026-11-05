// W2-F-C offline suite: replays migrations/2026-11-05-w2f-c-blob-tier-1.sql on node:sqlite.
// Proves: the header opts in (APPLY-BY ci, DB qnfo-audit, one Rollback line, the body deletes and drops nothing); the failure mode, its closing probe, one decision_log row, the note on
// issue 1001972 and the BLOB-TIER-2 issue are written once (a replay changes nothing); the probe reads 0 up to 100 heavy slimmed rows older than a day and 1 above, ignores light, unslimmed and
// fresh rows; the Rollback line removes it all; the BLOB-TIER-2 anchor occurs once in scripts/cold_tier.py and its code-probe does not pass yet; code_task_ctx_archive is a blob tier.
// It does not read live state. Output MUST contain "0 failed" on success.   node migrations/w2f-c-blob-tier-1.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const rd = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const sql = rd("./2026-11-05-w2f-c-blob-tier-1.sql");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 300))); } };

const header = sql.split("\n").filter((l) => l.startsWith("--"));
const body = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
ok(header.some((l) => /^-- APPLY-BY: ci\s*$/.test(l)) && header.some((l) => /^-- DB: qnfo-audit\s*$/.test(l)), "header opts in: APPLY-BY ci, DB qnfo-audit");
const rollback = header.filter((l) => /^-- Rollback:/.test(l));
ok(rollback.length === 1, "exactly one single-line Rollback header");
ok(header.some((l) => /^-- CAUSE-MAPPED: /.test(l)) && !/metric_registry/i.test(body), "registers no metric and says so");
ok(!/^\s*(DELETE\s+FROM|DROP\s+(TABLE|INDEX|VIEW|TRIGGER))\b/im.test(body), "the body deletes and drops nothing");
ok(!/claude\.ai|anthropic\.com/i.test(sql), "no claude.ai or anthropic.com link");
ok(Array.from(body.matchAll(/LIKE\s+'((?:[^']|'')*)'/gi)).every((m) => Buffer.byteLength(m[1]) <= 50), "every LIKE pattern is at most 50 bytes");

const w = new DatabaseSync(":memory:");
w.exec(`CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT, root_cause TEXT, remediation TEXT, detector TEXT, probe_class TEXT, first_seen TEXT, trigger_condition TEXT, symptom TEXT, blast_radius TEXT);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER, expected_cadence_h INTEGER, status TEXT, precondition TEXT, action TEXT, escalate_to TEXT, module TEXT, next_due_at TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT, outcome_matched INTEGER);
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE code_task_ctx_archive (task_id TEXT PRIMARY KEY, base TEXT, patch TEXT, orig_ctx_bytes INTEGER, archived_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), slimmed INTEGER NOT NULL DEFAULT 0);`);
w.prepare("INSERT INTO agent_issues (id, title, description) VALUES (1001972, 'BLOB-TIER-1: x', 'd0')").run();
w.exec(sql);
const snap = () => JSON.stringify([w.prepare("SELECT fm_key FROM failure_modes").all(), w.prepare("SELECT class FROM remediation_contracts").all(), w.prepare("SELECT action FROM decision_log").all(), w.prepare("SELECT id, title, description FROM agent_issues ORDER BY id").all()]);
ok(w.prepare("SELECT COUNT(*) n FROM failure_modes WHERE fm_key = 'cold-archive-lag-3'").get().n === 1, "the failure mode is written");
ok(w.prepare("SELECT COUNT(*) n FROM remediation_contracts WHERE class = 'fm-cold-archive-lag-3' AND status = 'active' AND verify_transport = 'd1-query'").get().n === 1, "the closing probe is an active d1-query contract");
ok(w.prepare("SELECT COUNT(*) n FROM decision_log WHERE actor = 'session:w2f-c'").get().n === 1, "one decision_log row");
ok(w.prepare("SELECT description d FROM agent_issues WHERE id = 1001972").get().d.startsWith("d0\nBLOB-TIER-1 2026-11-05: "), "issue 1001972 gets one dated note");
const i2 = w.prepare("SELECT * FROM agent_issues WHERE title LIKE 'BLOB-TIER-2:%'").get();
ok(i2 && i2.status === "open" && /code-task: repo=qnfo-workers path=scripts\/cold_tier\.py/.test(i2.description) && /code-anchor: def archive_chunk\(d1, r2, t, rows, now=None, sleep=time\.sleep\):/.test(i2.description) && /code-probe: \{/.test(i2.description), "BLOB-TIER-2 is filed with the routing, anchor and probe lines");
const s1 = snap();
w.exec(sql);
ok(snap() === s1, "a replay changes nothing");

const probe = () => ({ ...w.prepare(w.prepare("SELECT verify_probe p FROM remediation_contracts WHERE class = 'fm-cold-archive-lag-3'").get().p).get() });
ok(JSON.stringify(probe()) === JSON.stringify({ expected: "0", observed: "0" }), "an empty table is healthy", probe());
const iso = (h) => new Date(Date.now() - h * 3600e3).toISOString().replace(/\.\d+Z$/, "Z");
const ins = w.prepare("INSERT INTO code_task_ctx_archive (task_id, base, patch, orig_ctx_bytes, archived_at, slimmed) VALUES (?, ?, ?, 1, ?, ?)");
for (let i = 0; i < 100; i++) ins.run("h" + i, "b", "p", iso(30), 1);
ins.run("light", null, null, iso(30), 1);
ins.run("unslimmed", "b", "p", iso(30), 0);
ins.run("fresh", "b", "p", iso(2), 1);
ok(probe().observed === "0", "100 heavy slimmed rows over a day old is the limit; light, unslimmed and fresh rows do not count", probe());
ins.run("h100", "b", null, iso(30), 1);
ok(probe().observed === "1", "101 reads as the blob tier not running", probe());

w.exec(rollback[0].replace(/^-- Rollback:\s*/, ""));
ok(w.prepare("SELECT (SELECT COUNT(*) FROM failure_modes) + (SELECT COUNT(*) FROM remediation_contracts) + (SELECT COUNT(*) FROM decision_log) n").get().n === 0 && w.prepare("SELECT COUNT(*) n FROM agent_issues WHERE title LIKE 'BLOB-TIER-2:%'").get().n === 0 && w.prepare("SELECT description d FROM agent_issues WHERE id = 1001972").get().d === "d0", "the Rollback line removes everything the file wrote and restores the issue text");

const py = rd("../scripts/cold_tier.py");
ok(py.split("def archive_chunk(d1, r2, t, rows, now=None, sleep=time.sleep):").length - 1 === 1, "the BLOB-TIER-2 code-anchor occurs once in scripts/cold_tier.py");
ok(py.indexOf('"table": "errata_actions"') === -1, "the BLOB-TIER-2 code-probe does not already pass");
ok(/"table": "code_task_ctx_archive"[^\n]*"mode": "blob"/.test(py), "code_task_ctx_archive is a blob tier in TIERS");

console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
