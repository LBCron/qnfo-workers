// C8-GOALS-NO-DOD-1 offline suite: replays migrations/2026-11-05-c8-goals-no-dod.sql on node:sqlite. Output MUST contain "0 failed" on success.
// Proves: 41 goals are touched once (33 superseded with the survivor named in the alignment text, 8 given a machine-checkable DoD with the original wording kept in front and the probe last);
// a replay changes nothing; every new probe is one SELECT or one code-read spec that compiles, reads UNMET while the defect exists and MET once it is fixed (no vacuous pass);
// the ROADMAP-1 issue carries code-task, code-anchor and code-probe lines and is filed once; the decision is logged; the Rollback restores the goals.
// Run: node --no-warnings migrations/c8-goals-no-dod.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("./2026-11-05-c8-goals-no-dod.sql", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 300))); } };
ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: /m.test(sql), "header opts in");
const keys = Array.from(sql.match(/CREATE TABLE IF NOT EXISTS bak_20261105_c8_goals AS SELECT \* FROM goals WHERE goal_key IN \(([^)]*)\)/)[1].matchAll(/'([^']+)'/g)).map((m) => m[1]);
ok(keys.length === 41 && new Set(keys).size === 41, "41 distinct goals in scope", keys.length);
const d = new DatabaseSync(":memory:");
d.exec(`CREATE TABLE goals (id INTEGER PRIMARY KEY AUTOINCREMENT, goal_key TEXT UNIQUE NOT NULL, statement TEXT, goal_type TEXT DEFAULT 'instrumental', status TEXT DEFAULT 'adopted', dod TEXT, alignment TEXT, owner TEXT, retired_at TEXT, updated_at TEXT);
CREATE TABLE goal_lifecycle (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), goal_key TEXT NOT NULL, from_status TEXT, to_status TEXT, action TEXT NOT NULL, evidence TEXT NOT NULL);
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT, outcome_matched INTEGER);
CREATE TABLE ops_ai_log (id TEXT PRIMARY KEY, ts TEXT NOT NULL, ok INTEGER DEFAULT 1);
CREATE TABLE routing_policy (layer TEXT PRIMARY KEY, name TEXT, status TEXT);
CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, last_value TEXT, last_refreshed TEXT);`);
const goalsWith = (k, dod) => d.prepare("INSERT INTO goals (goal_key, statement, dod, alignment, owner) VALUES (?, 'stmt', ?, 'serves x', 'fleet')").run(k, dod);
for (const k of keys) goalsWith(k, "Original DoD wording for " + k + ".");
goalsWith("unrelated-goal", "keep");
const before = JSON.stringify(d.prepare("SELECT * FROM goals ORDER BY id").all());
d.exec(sql);
const g = (k) => d.prepare("SELECT * FROM goals WHERE goal_key = ?").get(k);
const sup = keys.filter((k) => g(k).status === "superseded");
const chk = keys.filter((k) => g(k).status === "adopted" && /Machine check:/.test(g(k).dod));
ok(sup.length === 33 && chk.length === 8 && sup.length + chk.length === 41, "33 superseded and 8 given a probe", { sup: sup.length, chk: chk.length });
ok(sup.every((k) => g(k).retired_at && /superseded 2026-11-05 by .{40,}/.test(g(k).alignment) && /^serves x \| superseded/.test(g(k).alignment)), "each superseded goal names its survivor and keeps its alignment text");
ok(sup.filter((k) => /program charter QNFO\.RSCH/.test(g(k).alignment)).length === 20, "20 research hypotheses cite the QNFO.RSCH charter");
ok(chk.every((k) => g(k).dod.startsWith("Original DoD wording for " + k + ". Machine check: ") && /^(SELECT |\{"paths")/.test(g(k).dod.slice(("Original DoD wording for " + k + ". Machine check: ").length)) && g(k).dod.split("Machine check:").length === 2), "the original wording stays first and the probe last");
ok(g("unrelated-goal").dod === "keep" && g("unrelated-goal").status === "adopted", "an unrelated goal is untouched");
ok(d.prepare("SELECT COUNT(*) n FROM goal_lifecycle WHERE action = 'c8-superseded'").get().n === 33 && d.prepare("SELECT COUNT(*) n FROM goal_lifecycle WHERE action = 'c8-dod-written'").get().n === 8, "one ledger row per transition");
ok(d.prepare("SELECT COUNT(*) n FROM decision_log WHERE action LIKE 'C8-GOALS-NO-DOD-1:%'").get().n === 1, "the decision is logged once");
const issue = d.prepare("SELECT * FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.RSCH #c8-stuck-newversion:%'").all();
ok(issue.length === 1 && /^code-task: repo=qnfo-workers path=qnfo-research-exec\/worker\.js\ncode-anchor: async function publishV2\(env, row\) \{\ncode-probe: \{"paths": \["qnfo-research-exec\/worker\.js"\], "contains": "stuck-newversion"\}/.test(issue[0].description) && issue[0].status === "open", "the doer issue carries code-task, code-anchor and code-probe", issue.length);
const snap = JSON.stringify([d.prepare("SELECT * FROM goals ORDER BY id").all(), d.prepare("SELECT COUNT(*) n FROM goal_lifecycle").get(), d.prepare("SELECT COUNT(*) n FROM agent_issues").get(), d.prepare("SELECT COUNT(*) n FROM decision_log").get()]);
d.exec(sql);
const snap2 = JSON.stringify([d.prepare("SELECT * FROM goals ORDER BY id").all(), d.prepare("SELECT COUNT(*) n FROM goal_lifecycle").get(), d.prepare("SELECT COUNT(*) n FROM agent_issues").get(), d.prepare("SELECT COUNT(*) n FROM decision_log").get()]);
ok(snap === snap2, "a replay changes nothing");

// The probes: v_goal_dod semantics (first SELECT or {"paths" to the end) on fixtures that make the defect present, then fixed.
const probeOf = (k) => { const t = g(k).dod; const i = t.indexOf('{"paths"'); if (i >= 0) return { code: JSON.parse(t.slice(i).trim()) }; const s = t.indexOf("SELECT "); return { sql: t.slice(s).replace(/;\s*$/, "").replace(/;/g, ",") }; };
const run = (k) => { const p = probeOf(k); if (p.sql) { const r = d.prepare(p.sql).get(); return r.expected === r.observed ? "met" : "unmet:" + r.observed; } return "code"; };
const now = Date.now();
// ops-exec-loop-parse-guard
ok(run("ops-exec-loop-parse-guard").startsWith("unmet:pending"), "ops probe is pending, not met, with no traffic (no vacuous pass)", run("ops-exec-loop-parse-guard"));
d.prepare("INSERT INTO ops_ai_log (id, ts, ok) VALUES ('a', strftime('%Y-%m-%dT%H:%M:%fZ','now'), 0), ('b', strftime('%Y-%m-%dT%H:%M:%fZ','now'), 1)").run();
ok(run("ops-exec-loop-parse-guard") === "unmet:1", "ops probe reads the failure", run("ops-exec-loop-parse-guard"));
d.exec("UPDATE ops_ai_log SET ok = 1");
ok(run("ops-exec-loop-parse-guard") === "met", "ops probe passes when no call failed in 24 hours");
// self-heal-tool-list-correction
d.prepare("INSERT INTO agent_issues (title, status, created_at) VALUES ('[self-heal] tool web_fetch failing x2 (6h no recovery)', 'open', ?)").run(now - 3600e3);
ok(run("self-heal-tool-list-correction") === "unmet:1", "self-heal probe reads a recent web_ tool issue", run("self-heal-tool-list-correction"));
d.exec("UPDATE agent_issues SET created_at = " + (now - 30 * 86400e3) + " WHERE title LIKE '[self-heal] tool web_%'");
d.prepare("INSERT INTO agent_issues (title, status, created_at) VALUES ('[self-heal] tool github_issue_get failing x6 (50.0% of 12 calls in 6h)', 'open', ?)").run(now);
ok(run("self-heal-tool-list-correction") === "met", "self-heal probe passes with only old web_ issues and a real-tool issue ignored");
// fleet-loop-actuation-gap
d.prepare("INSERT INTO agent_issues (title, status, created_at) VALUES ('DEPLOY-UNCOORDINATED-DEPLOY: x', 'open', ?)").run(now - 600e3);
ok(run("fleet-loop-actuation-gap") === "unmet:1", "actuation probe counts a fresh DEPLOY-UNCOORDINATED ticket", run("fleet-loop-actuation-gap"));
d.exec("UPDATE agent_issues SET created_at = " + (now - 3 * 86400e3) + " WHERE title LIKE 'DEPLOY-UNCOORDINATED%'");
ok(run("fleet-loop-actuation-gap") === "met", "actuation probe passes when none was filed in 24 hours");
// cost-routing-stack-l0l7
d.prepare("INSERT INTO routing_policy VALUES ('L0','a','LIVE'), ('L5','distillation','ABSENT'), ('L6','draft','PARTIAL'), ('CTX','ctx','PARTIAL'), ('MEA','m','LIVE')").run();
ok(run("cost-routing-stack-l0l7") === "unmet:2", "routing probe counts L5 and L6, not CTX", run("cost-routing-stack-l0l7"));
d.exec("UPDATE routing_policy SET status = 'LIVE'");
ok(run("cost-routing-stack-l0l7") === "met", "routing probe passes when every L layer is LIVE");
// external-impact-per-dollar
d.prepare("INSERT INTO metric_registry VALUES ('external_impact_per_dollar', '0.02341', strftime('%Y-%m-%dT%H:%M:%SZ','now'))").run();
ok(run("external-impact-per-dollar").startsWith("unmet:unmet: external_impact_per_dollar 0.02341"), "impact probe reads the number while it is above target", run("external-impact-per-dollar"));
d.exec("UPDATE metric_registry SET last_value = '0.011'");
ok(run("external-impact-per-dollar") === "met", "impact probe passes at or below 0.012 when fresh");
d.exec("UPDATE metric_registry SET last_refreshed = '2020-01-01T00:00:00Z'");
ok(run("external-impact-per-dollar").startsWith("unmet:"), "impact probe does not pass on a stale value");
// code-read specs are well formed JSON with a path and a needle
for (const k of ["repo-mirror-drift-closeout", "wrangler-deploy-fleet-control", "research-exec-newversion-draft-cleanup"]) {
  const c = probeOf(k).code;
  ok(c && Array.isArray(c.paths) && c.paths.length === 1 && typeof c.contains === "string" && c.contains.length > 5, k + " code-read spec is well formed", c);
}
// every new SQL probe is a single read-only SELECT with a LIKE pattern under 50 bytes
for (const k of chk) { const p = probeOf(k); if (p.sql) { ok(/^SELECT /.test(p.sql) && !/\b(INSERT|UPDATE|DELETE|DROP)\b/i.test(p.sql) && !p.sql.includes(";"), k + " probe is one read-only SELECT"); for (const m of p.sql.matchAll(/LIKE '([^']*)'/g)) ok(Buffer.byteLength(m[1]) < 50, k + " LIKE pattern under 50 bytes"); } }
// Rollback restores the goals.
const rb = /^-- Rollback: (.+)$/m.exec(sql)[1].split("; DELETE")[0];
d.exec(rb);
ok(JSON.stringify(d.prepare("SELECT goal_key, status, dod, alignment, retired_at FROM goals ORDER BY id").all()) === JSON.stringify(JSON.parse(before).map((r) => ({ goal_key: r.goal_key, status: r.status, dod: r.dod, alignment: r.alignment, retired_at: r.retired_at }))), "the rollback restores every goal");
console.log(pass + " passed, " + fail + " failed");
