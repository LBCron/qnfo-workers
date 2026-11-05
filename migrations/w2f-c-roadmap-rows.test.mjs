// W2-F-C offline suite: replays migrations/2026-11-05-w2f-c-roadmap-rows.sql on node:sqlite.
// Proves: the header opts in (APPLY-BY ci, DB qnfo-audit, one Rollback line, nothing deleted or dropped in the body); rows 51, 119 and 125 stay partial and row 123 becomes verified, each keeping its old
// evidence and appending one dated reading; no other row moves; contract rm-125 is written once and reads the watchmaker_index metric (expected 0, observed the stored value, "unmeasured" without one);
// the note on agent_issues 1001970 is written once; a replay changes nothing; the Rollback line puts statuses, evidence and the issue text back and removes the contract. It does not read live state.
// Output MUST contain "0 failed" on success.   node migrations/w2f-c-roadmap-rows.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("./2026-11-05-w2f-c-roadmap-rows.sql", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 300))); } };

const header = sql.split("\n").filter((l) => l.startsWith("--"));
const body = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
ok(header.some((l) => /^-- APPLY-BY: ci\s*$/.test(l)) && header.some((l) => /^-- DB: qnfo-audit\s*$/.test(l)), "header opts in: APPLY-BY ci, DB qnfo-audit");
const rollback = header.filter((l) => /^-- Rollback:/.test(l));
ok(rollback.length === 1, "exactly one single-line Rollback header");
ok(header.some((l) => /^-- CAUSE-MAPPED: /.test(l)) && !/metric_registry\s*\(|INSERT[^;]*INTO\s+metric_registry/i.test(body), "registers no metric and says so");
ok(!/^\s*(DELETE\s+FROM|DROP\s+(TABLE|INDEX|VIEW|TRIGGER))\b/im.test(body), "the body deletes and drops nothing");
ok(!/https?:\/\/(?:[a-z0-9-]+\.)*(?:claude\.ai|claude\.site|claudeusercontent\.com|anthropic\.com)/i.test(sql), "no link to a claude.ai-hosted surface or anthropic.com (the host guard's rule; the words alone are fine)");
ok(Array.from(body.matchAll(/LIKE\s+'((?:[^']|'')*)'/gi)).every((m) => Buffer.byteLength(m[1]) <= 50), "every LIKE pattern is at most 50 bytes");
ok(!/Bearer\s+[A-Za-z0-9]|secret_value|sk-[A-Za-z0-9]{10}/.test(sql), "no secret value in the file");

function world() {
  const w = new DatabaseSync(":memory:");
  w.exec(`CREATE TABLE roadmap_implementation (id INTEGER PRIMARY KEY, item TEXT NOT NULL, status TEXT NOT NULL, evidence TEXT, verified_at TEXT);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER, expected_cadence_h INTEGER, status TEXT, precondition TEXT, action TEXT, escalate_to TEXT, module TEXT, next_due_at TEXT);
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, description TEXT, status TEXT);
CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, last_value TEXT);`);
  const before = { 51: ["RM-SECRETS-STORE-1", "partial", null], 119: ["RM-D1-RETENTION-1", "partial", null], 123: ["RM-OWNER-DOCS-PRIVATE-STORE-1", "built", "2026-10-01T21:03:00Z"], 125: ["RM-NO-CLAUDE-RUNTIME-1", "partial", null], 52: ["RM-WAF-RATE-LIMIT-1", "verified", "2026-11-05 04:36:12"] };
  for (const [id, [item, st, v]] of Object.entries(before)) w.prepare("INSERT INTO roadmap_implementation (id, item, status, evidence, verified_at) VALUES (?, ?, ?, ?, ?)").run(Number(id), item, st, "old evidence " + id, v);
  w.prepare("INSERT INTO agent_issues (id, title, description, status) VALUES (1001970, 'SECRETS-STORE-ADOPT-1: x', 'd0', 'open')").run();
  w.prepare("INSERT INTO metric_registry (metric, last_value) VALUES ('watchmaker_index', '2')").run();
  return { w, before };
}
const snap = (w) => JSON.stringify([w.prepare("SELECT * FROM roadmap_implementation ORDER BY id").all(), w.prepare("SELECT class FROM remediation_contracts").all(), w.prepare("SELECT id, description FROM agent_issues").all()]);

const { w, before } = world();
const s0 = snap(w);
w.exec(sql);
const rows = Object.fromEntries(w.prepare("SELECT * FROM roadmap_implementation").all().map((r) => [r.id, r]));
const want = { 51: "partial", 119: "partial", 123: "verified", 125: "partial", 52: "verified" };
for (const [id, st] of Object.entries(want)) ok(rows[id].status === st, `row ${id} is ${st}`, rows[id].status);
for (const id of [51, 119, 123, 125]) ok(rows[id].evidence.startsWith("old evidence " + id + " | W2-F-C 2026-11-05: "), `row ${id} keeps its old evidence and appends the dated reading`, rows[id].evidence.slice(0, 60));
ok(rows[52].evidence === "old evidence 52" && rows[52].verified_at === "2026-11-05 04:36:12", "row 52 (verified by the steward) is not touched");
ok(rows[123].verified_at && rows[123].verified_at > "2026-11-05", "row 123 carries a verified_at of today", rows[123].verified_at);
ok(rows[51].verified_at === null && rows[119].verified_at === null && rows[125].verified_at === null, "the partial rows carry no verified_at");
for (const id of [51, 119, 123, 125]) ok(rows[id].evidence.length > 900 && !/\bTODO\b|TBD/.test(rows[id].evidence), `row ${id} states its readings`, rows[id].evidence.length);

const c = w.prepare("SELECT * FROM remediation_contracts WHERE class = 'rm-125'").get();
ok(c && c.verify_transport === "d1-query" && c.status === "active" && c.module === "roadmap-dod-v1" && c.next_due_at > "2026-11-05 23:59", "contract rm-125 is an active d1-query roadmap-dod contract due after the next daily snapshot", c);
const probe = () => ({ ...w.prepare(c.verify_probe).get() });
ok(JSON.stringify(probe()) === JSON.stringify({ expected: "0", observed: "2" }), "the probe reads the stored watchmaker_index", probe());
w.prepare("UPDATE metric_registry SET last_value = '0'").run();
ok(probe().observed === "0", "it passes when the index reads 0", probe());
w.prepare("DELETE FROM metric_registry").run();
ok(probe().observed === "unmeasured", "it reads unmeasured without a row", probe());
ok(w.prepare("SELECT description d FROM agent_issues WHERE id = 1001970").get().d.startsWith("d0\nW2-F-C 2026-11-05: "), "agent_issues 1001970 gets one dated note");

const s1 = snap(w);
w.exec(sql);
ok(snap(w) === s1, "a replay changes nothing");
w.exec(rollback[0].replace(/^-- Rollback:\s*/, ""));
const back = Object.fromEntries(w.prepare("SELECT * FROM roadmap_implementation").all().map((r) => [r.id, r]));
ok(Object.entries(before).every(([id, [, st, v]]) => back[id].status === st && back[id].verified_at === v && back[id].evidence === "old evidence " + id), "the Rollback line puts statuses, verified_at and evidence back");
ok(w.prepare("SELECT COUNT(*) n FROM remediation_contracts").get().n === 0 && w.prepare("SELECT description d FROM agent_issues WHERE id = 1001970").get().d === "d0", "and removes the contract and the issue note");
void s0;

console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
