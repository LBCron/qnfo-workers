// BP26-KILLSWITCH-CAPS-1 migration suite: migrations/2026-11-05-killswitch-caps-1.sql inserts the breaker switch as on, two control records with a read-only alternate probe each, moves roadmap
// row 1722 to in_progress (3 of 9 readers) and 1723 to built, writes one decision_log row; a replay changes nothing and never turns a value someone set to off back on.
// Run: node --no-warnings migrations/killswitch-caps-1.test.mjs   (exit 0 = all passed)
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const sql = readFileSync(new URL("./2026-11-05-killswitch-caps-1.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? "  -- " + JSON.stringify(x).slice(0, 300) : "")); } };
ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: .+/m.test(sql), "migration opts in with APPLY-BY, DB and Rollback headers");
ok(!/\b(DELETE\s+FROM|DROP\s+(TABLE|INDEX|VIEW|TRIGGER))\b/i.test(sql.split("\n").filter((l) => !l.startsWith("--")).join("\n")), "no delete or drop in the body");

const db = new DatabaseSync(":memory:");
db.exec(`CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT);
CREATE TABLE control_registry (control TEXT PRIMARY KEY, location TEXT, kind TEXT, guards_against TEXT, critical_path INTEGER, disposition TEXT, disposition_state TEXT, alternate_path TEXT, alternate_tested_at TEXT, evidence TEXT, issue_id INTEGER, reviewed_at TEXT);
CREATE TABLE control_alternate_probes (control TEXT PRIMARY KEY, probe_sql TEXT, window_note TEXT, enabled INTEGER, last_run_at TEXT);
CREATE TABLE roadmap_implementation (id INTEGER PRIMARY KEY, item TEXT, status TEXT, evidence TEXT);
INSERT INTO roadmap_implementation (id, item, status) VALUES (1722, 'KS-READERS', 'planned'), (1723, 'KS-CAPS', 'planned'), (1724, 'other', 'planned');
CREATE TABLE decision_log (id INTEGER PRIMARY KEY, actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);`);
db.exec(sql);
const all = (q, ...a) => db.prepare(q).all(...a);
const one = (q, ...a) => db.prepare(q).get(...a);
ok(one("SELECT value v FROM ops_config WHERE key = 'code_loop_breaker'").v === "on", "the breaker switch is inserted as on");
const ctl = Object.fromEntries(all("SELECT * FROM control_registry").map((c) => [c.control, c]));
ok(ctl["code-loop-breaker"].kind === "cap" && ctl["code-loop-breaker"].critical_path === 1 && /bounded/.test(ctl["code-loop-breaker"].alternate_path) && ctl["code-loop-kill-switch-reader"].kind === "kill-switch" && ctl["code-loop-kill-switch-reader"].disposition === "keep", "two control records with their disposition and alternate", Object.keys(ctl));
const probes = Object.fromEntries(all("SELECT control, probe_sql p, enabled e FROM control_alternate_probes").map((r) => [r.control, r]));
ok(Object.keys(probes).length === 2 && Object.values(probes).every((r) => r.e === 1 && !r.p.includes(";")), "an enabled probe without a semicolon for each control", Object.keys(probes));
const run = (c) => db.prepare(probes[c].p).get().observed;
ok(run("code-loop-breaker") === "ok", "breaker probe reads ok while the lever row holds on");
db.prepare("UPDATE ops_config SET value = 'maybe' WHERE key = 'code_loop_breaker'").run();
ok(/other than on or off/.test(run("code-loop-breaker")), "breaker probe is falsifiable: an unknown value reads a reason");
db.prepare("DELETE FROM ops_config WHERE key = 'code_loop_breaker'").run();
ok(/missing/.test(run("code-loop-breaker")), "and a missing row reads missing");
ok(/missing/.test(run("code-loop-kill-switch-reader")), "the kill-switch probe reads missing when the flag row is absent");
db.prepare("INSERT INTO ops_config (key, value) VALUES ('fleet_kill_switch', 'off')").run();
ok(run("code-loop-kill-switch-reader") === "ok", "and ok once the flag row exists with off");
db.prepare("UPDATE ops_config SET value = 'true' WHERE key = 'fleet_kill_switch'").run();
ok(/other than on or off/.test(run("code-loop-kill-switch-reader")), "and falsifiable on a value that no reader treats as on");
const rm = Object.fromEntries(all("SELECT id, status, evidence FROM roadmap_implementation").map((r) => [r.id, r]));
ok(rm[1722].status === "in_progress" && /qnfo-github-steward 0\.17\.0/.test(rm[1722].evidence) && rm[1723].status === "built" && rm[1724].status === "planned", "row 1722 in progress with the reader list, 1723 built, other rows untouched", rm);
db.prepare("INSERT INTO ops_config (key, value) VALUES ('code_loop_breaker', 'off')").run();
db.prepare("UPDATE roadmap_implementation SET status = 'verified' WHERE id = 1723").run();
db.exec(sql);
ok(one("SELECT value v FROM ops_config WHERE key = 'code_loop_breaker'").v === "off", "a replay never turns an off back on");
ok(one("SELECT status s FROM roadmap_implementation WHERE id = 1723").s === "verified", "a replay never moves a verified row back");
ok(one("SELECT COUNT(*) n FROM decision_log").n === 1 && one("SELECT COUNT(*) n FROM control_registry").n === 2, "a replay adds no second row");
console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
