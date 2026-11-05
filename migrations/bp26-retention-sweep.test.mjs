// BP26-RETENTION-SWEEP-1 suite: replays migrations/2026-11-05-bp26-retention-sweep.sql on node:sqlite and pins that the sweep stays dormant.
// Proves: the header opts in; the retention switch is inserted as 'off' and an existing 'on' is never overwritten; no policy row, no enforcement flag and no switch value is changed
// by the file; roadmap row 1400 becomes partial only from planned; the owner card keeps its status and gets the paragraph once; the doer issue carries a code-task, an anchor that
// occurs once in scripts/cf_ops_actions.py and a code-probe; a replay inserts nothing twice; the compiled sweeps in scripts/retention_sweep.py are exactly the registry's 19 policy keys.
// Output MUST contain "0 failed" on success.   node migrations/bp26-retention-sweep.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("./2026-11-05-bp26-retention-sweep.sql", import.meta.url), "utf8");
const privacy = readFileSync(new URL("./2026-10-26-bp26-privacy.sql", import.meta.url), "utf8");
const sweep = readFileSync(new URL("../scripts/retention_sweep.py", import.meta.url), "utf8");
const cfops = readFileSync(new URL("../scripts/cf_ops_actions.py", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };

const header = sql.split("\n").filter((l) => l.startsWith("--"));
const body = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
ok(header.some((l) => /^-- APPLY-BY: ci\s*$/.test(l)) && header.some((l) => /^-- DB: qnfo-audit\s*$/.test(l)), "header opts in: APPLY-BY ci, DB qnfo-audit");
ok(header.filter((l) => /^-- Rollback:/.test(l)).length === 1, "exactly one single-line Rollback header");
ok(!/\b(DELETE\s+FROM|DROP\s+(TABLE|INDEX|VIEW|TRIGGER))\b/i.test(body), "the body deletes and drops nothing");
ok(!/\b(UPDATE|INSERT\s+OR\s+REPLACE\s+INTO|REPLACE\s+INTO)\s+(retention_policy|ops_config)\b/i.test(body), "the body never updates retention_policy or overwrites ops_config");
ok(!/enforcement\s*=\s*'enforce'|policy_status\s*=\s*'adopted'|'retention_enforce',\s*'on'/i.test(body), "nothing in the body switches the sweep on");
ok(!/claude\.ai|anthropic\.com/i.test(sql), "no claude.ai or anthropic.com link");
ok(!/\b(LIKE|GLOB)\s+'[^']{51,}'/i.test(body), "no LIKE or GLOB pattern over 50 bytes");

// registry parity: the policy keys of the privacy migration are exactly the compiled sweeps
const regKeys = [...privacy.matchAll(/^\s+\('([a-z0-9_]+)', '(?:qnfo-audit|ipatent-db|q08-signal|living-paper)'/gm)].map((m) => m[1]).sort();
const swKeys = [...sweep.matchAll(/^    "([a-z0-9_]+)": \("?[A-Za-z0-9_-]+"?, "[a-z_]+", "(?:blank|delete)"/gm)].map((m) => m[1]).sort();
ok(regKeys.length === 19, "the privacy migration registers 19 policies", regKeys.length);
ok(JSON.stringify(regKeys) === JSON.stringify(swKeys), "the compiled sweeps are exactly the registered policy keys", { regKeys, swKeys });

const w = new DatabaseSync(":memory:");
w.exec(`
CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT, updated_at TEXT DEFAULT (datetime('now')));
CREATE TABLE roadmap_implementation (id INTEGER PRIMARY KEY AUTOINCREMENT, item TEXT, source TEXT, title TEXT, artifact_type TEXT, artifact_ref TEXT, status TEXT NOT NULL, evidence TEXT, verified_at TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE human_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE, title TEXT NOT NULL, why TEXT, status TEXT DEFAULT 'open', updated_at TEXT DEFAULT (datetime('now')));
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT, outcome_matched INTEGER);
INSERT INTO roadmap_implementation (id, item, source, title, artifact_type, status) VALUES (1400, 'AI-1000344', 'x', 'BP26 4.3', 'agent_issue', 'planned');
INSERT INTO human_actions (id, slug, title, why, status) VALUES (189, 'bp26-retention-enforce', 'Decide', 'IDENTITY-BOUND: x', 'open');
`);
w.exec(sql);
const one = (q, ...a) => w.prepare(q).get(...a);
ok(one("SELECT value v FROM ops_config WHERE key = 'retention_enforce'").v === "off", "the switch exists and reads off");
ok(one("SELECT status s FROM roadmap_implementation WHERE id = 1400").s === "partial" && /records_past_retention reads 1004/.test(one("SELECT evidence e FROM roadmap_implementation WHERE id = 1400").e), "row 1400 is partial with the measured number");
ok(one("SELECT status s FROM human_actions WHERE id = 189").s === "open" && /BP26-RETENTION-SWEEP-1 \(2026-11-05\):/.test(one("SELECT why w FROM human_actions WHERE id = 189").w), "card 189 stays open and carries the paragraph");
const iss = one("SELECT description d, priority p FROM agent_issues WHERE title LIKE 'BP26-RETENTION-EXPORTS-1:%'");
ok(iss && /code-task: repo=qnfo-workers path=scripts\/cf_ops_actions\.py/.test(iss.d) && /code-probe: \{"paths": \["scripts\/cf_ops_actions\.py"\], "contains": "r2-lifecycle"\}/.test(iss.d), "the doer issue carries a code-task and a code-probe", iss && iss.d.slice(-200));
const anchor = (iss.d.match(/code-anchor: (.+)/) || [])[1];
ok(anchor && cfops.split(anchor).length - 1 === 1, "the code-anchor occurs exactly once in scripts/cf_ops_actions.py", anchor);
ok(/^def /.test(anchor || "") && /\)( -> \w+)?:$/.test(anchor || ""), "the anchor is a function signature");
ok(one("SELECT COUNT(*) n FROM decision_log WHERE actor = 'session-w2a'").n === 1, "one decision_log row");
w.exec(sql);
ok(one("SELECT COUNT(*) n FROM agent_issues").n === 1 && one("SELECT COUNT(*) n FROM decision_log").n === 1 && (one("SELECT why w FROM human_actions WHERE id = 189").w.match(/BP26-RETENTION-SWEEP-1 \(2026-11-05\):/g) || []).length === 1, "a replay inserts and appends nothing twice");

// an 'on' set by the owner's answer survives a replay; a row already past planned is not reset
w.exec("UPDATE ops_config SET value = 'on' WHERE key = 'retention_enforce'; UPDATE roadmap_implementation SET status = 'verified' WHERE id = 1400;");
w.exec(sql);
ok(one("SELECT value v FROM ops_config WHERE key = 'retention_enforce'").v === "on" && one("SELECT status s FROM roadmap_implementation WHERE id = 1400").s === "verified", "an existing switch value and a later row status are not overwritten");

// the Rollback line undoes the file (apart from the switch the owner may have turned on)
const rollback = header.find((l) => /^-- Rollback:/.test(l)).replace(/^-- Rollback:\s*/, "");
const w2 = new DatabaseSync(":memory:");
w2.exec(`
CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT, updated_at TEXT DEFAULT (datetime('now')));
CREATE TABLE roadmap_implementation (id INTEGER PRIMARY KEY AUTOINCREMENT, item TEXT, source TEXT, title TEXT, artifact_type TEXT, artifact_ref TEXT, status TEXT NOT NULL, evidence TEXT, verified_at TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE human_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE, title TEXT NOT NULL, why TEXT, status TEXT DEFAULT 'open', updated_at TEXT DEFAULT (datetime('now')));
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT, outcome_matched INTEGER);
INSERT INTO roadmap_implementation (id, item, source, title, artifact_type, status) VALUES (1400, 'AI-1000344', 'x', 'BP26 4.3', 'agent_issue', 'planned');
INSERT INTO human_actions (id, slug, title, why, status) VALUES (189, 'bp26-retention-enforce', 'Decide', 'IDENTITY-BOUND: x', 'open');
`);
w2.exec(sql);
w2.exec(rollback);
const q2 = (s) => w2.prepare(s).get();
ok(q2("SELECT COUNT(*) n FROM ops_config").n === 0 && q2("SELECT status s FROM roadmap_implementation WHERE id = 1400").s === "planned" && q2("SELECT why w FROM human_actions WHERE id = 189").w === "IDENTITY-BOUND: x"
   && q2("SELECT status s FROM agent_issues").s === "closed" && q2("SELECT COUNT(*) n FROM decision_log").n === 0, "the Rollback line restores the starting state");

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
