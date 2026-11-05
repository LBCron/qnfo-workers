// GITHUB-STEWARD-2 migration suite: migrations/2026-11-05-github-steward-2-settings.sql inserts the switch as `dry` (the steward writes nothing until it is `on`), the control record with its
// tested alternate, and one decision_log row; replaying it changes nothing and never resets a value someone moved to `on`.
// Run: node --no-warnings migrations/github-steward-2-settings.test.mjs   (exit 0 = all passed)
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const sql = readFileSync(new URL("./2026-11-05-github-steward-2-settings.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? "  -- " + JSON.stringify(x).slice(0, 300) : "")); } };
ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: .+/m.test(sql), "migration opts in with APPLY-BY, DB and Rollback headers");
ok(!/\b(DELETE\s+FROM|DROP\s+(TABLE|INDEX|VIEW|TRIGGER))\b/i.test(sql.split("\n").filter((l) => !l.startsWith("--")).join("\n")), "no delete or drop in the body, so no BACKUP header is needed");

const db = new DatabaseSync(":memory:");
db.exec(`CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT);
CREATE TABLE control_registry (control TEXT PRIMARY KEY, location TEXT, kind TEXT, guards_against TEXT, critical_path INTEGER, disposition TEXT, disposition_state TEXT, alternate_path TEXT, alternate_tested_at TEXT, evidence TEXT, issue_id INTEGER, reviewed_at TEXT);
CREATE TABLE control_alternate_probes (control TEXT PRIMARY KEY, probe_sql TEXT, window_note TEXT, enabled INTEGER, last_run_at TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY, actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);`);
db.exec(sql);
const one = (q, ...a) => db.prepare(q).get(...a);
ok(one("SELECT value v FROM ops_config WHERE key = 'steward_settings_enforce'").v === "dry", "the switch is inserted as dry");
const c = one("SELECT * FROM control_registry WHERE control = 'steward-settings-enforce'");
ok(c && c.kind === "kill-switch" && c.critical_path === 0 && c.disposition === "keep" && c.disposition_state === "applied" && /dry/.test(c.alternate_path) && c.evidence.length > 40, "the control record names its disposition, critical path and alternate", c);
{
  const pr = one("SELECT probe_sql p, enabled e FROM control_alternate_probes WHERE control = 'steward-settings-enforce'");
  ok(pr && pr.e === 1 && !pr.p.includes(";"), "the control has a read-only alternate probe without a semicolon", pr);
  const r1 = db.prepare(pr.p).get();
  ok(r1.expected === "ok" && r1.observed === "ok", "the probe reads ok while the lever row holds dry", r1);
  db.prepare("UPDATE ops_config SET value = 'maybe' WHERE key = 'steward_settings_enforce'").run();
  const r2 = db.prepare(pr.p).get();
  ok(r2.observed !== "ok" && /other than off, dry or on/.test(r2.observed), "the probe is falsifiable: an unknown value reads a reason", r2);
  db.prepare("DELETE FROM ops_config WHERE key = 'steward_settings_enforce'").run();
  ok(/missing/.test(db.prepare(pr.p).get().observed), "and a missing row reads missing");
  db.prepare("INSERT INTO ops_config (key, value) VALUES ('steward_settings_enforce', 'dry')").run();
}
ok(one("SELECT COUNT(*) n FROM decision_log WHERE actor = 'session:B-governance-code' AND capability_gain = 'steward-declares-github-settings'").n === 1, "one decision_log row carries the prediction");
db.prepare("UPDATE ops_config SET value = 'on' WHERE key = 'steward_settings_enforce'").run();
db.exec(sql);
ok(one("SELECT value v FROM ops_config WHERE key = 'steward_settings_enforce'").v === "on", "a replay never resets a value moved to on");
ok(one("SELECT COUNT(*) n FROM decision_log").n === 1 && one("SELECT COUNT(*) n FROM control_registry").n === 1, "a replay adds no second row");
console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
