// C8-GOVERNANCE-PROPOSALS-1 offline suite: replays migrations/2026-11-05-c8-governance-proposals.sql on node:sqlite. Output MUST contain "0 failed" on success.
// Proves: three proposals already in force become resolved and two replaced ones superseded, each with the live reading in its alignment text and one ledger row; the open proposal
// lrev-return-on-spend-v3-17f8ssu, an unrelated adopted goal and an already settled proposal are untouched; the objectives table is never written; a replay changes nothing; the
// decision is logged once; the Rollback restores the five rows.
// Run: node --no-warnings migrations/c8-governance-proposals.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("./2026-11-05-c8-governance-proposals.sql", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 300))); } };
ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: /m.test(sql), "header opts in");
ok(!/\b(UPDATE|INSERT INTO|DELETE FROM) objectives\b/i.test(sql), "the objectives table is never written");
const d = new DatabaseSync(":memory:");
d.exec(`CREATE TABLE goals (id INTEGER PRIMARY KEY AUTOINCREMENT, goal_key TEXT UNIQUE NOT NULL, statement TEXT, goal_type TEXT DEFAULT 'objective-revision', status TEXT DEFAULT 'adopted', dod TEXT, alignment TEXT, owner TEXT DEFAULT 'human-ratify', completed_at TEXT, retired_at TEXT, updated_at TEXT);
CREATE TABLE goal_lifecycle (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), goal_key TEXT NOT NULL, from_status TEXT, to_status TEXT, action TEXT NOT NULL, evidence TEXT NOT NULL);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT, outcome_matched INTEGER);`);
const keys = ["vrev-external-impact-term-20260926", "vrev-gmw8u0d2y", "vrev-g15hdh4s30", "gjyfc7j56", "vrev-g16eyz4j2k"];
for (const k of keys.concat(["lrev-return-on-spend-v3-17f8ssu", "unrelated"])) d.prepare("INSERT INTO goals (goal_key, statement, alignment) VALUES (?, 's', 'rationale: x')").run(k);
d.prepare("INSERT INTO goals (goal_key, statement, status, alignment) VALUES ('settled-before', 's', 'rejected', 'a')").run();
const before = JSON.stringify(d.prepare("SELECT * FROM goals ORDER BY id").all());
d.exec(sql);
const g = (k) => d.prepare("SELECT * FROM goals WHERE goal_key = ?").get(k);
ok(["vrev-external-impact-term-20260926", "vrev-gmw8u0d2y", "vrev-g15hdh4s30"].every((k) => g(k).status === "resolved" && g(k).completed_at && /resolved 2026-11-05: already in force/.test(g(k).alignment)), "three proposals already in force are resolved with the reading");
ok(["gjyfc7j56", "vrev-g16eyz4j2k"].every((k) => g(k).status === "superseded" && g(k).retired_at && /superseded 2026-11-05 by /.test(g(k).alignment)), "two replaced proposals are superseded with their survivor");
ok(/energy_efficiency/.test(g("vrev-g15hdh4s30").alignment) && /0\.9617/.test(g("vrev-g15hdh4s30").alignment) && /autonomy 0\.15 and self_improv 0\.20/.test(g("vrev-gmw8u0d2y").alignment), "the live readings are in the text");
ok(g("lrev-return-on-spend-v3-17f8ssu").status === "adopted" && g("unrelated").status === "adopted" && g("settled-before").status === "rejected", "the open proposal, an unrelated goal and a settled one are untouched");
ok(d.prepare("SELECT COUNT(*) n FROM goal_lifecycle").get().n === 5, "one ledger row per transition");
ok(d.prepare("SELECT COUNT(*) n FROM decision_log WHERE action LIKE 'C8-GOVERNANCE-PROPOSALS-1:%'").get().n === 1, "the decision is logged once");
const snap = () => JSON.stringify([d.prepare("SELECT * FROM goals ORDER BY id").all(), d.prepare("SELECT COUNT(*) n FROM goal_lifecycle").get(), d.prepare("SELECT COUNT(*) n FROM decision_log").get()]);
const s1 = snap(); d.exec(sql); ok(snap() === s1, "a replay changes nothing");
d.exec(/^-- Rollback: (.+)$/m.exec(sql)[1]);
const after = JSON.stringify(d.prepare("SELECT goal_key, status, alignment, completed_at, retired_at FROM goals ORDER BY id").all());
const orig = JSON.stringify(JSON.parse(before).map((r) => ({ goal_key: r.goal_key, status: r.status, alignment: r.alignment, completed_at: r.completed_at, retired_at: r.retired_at })));
ok(after === orig, "the rollback restores the five rows");
console.log(pass + " passed, " + fail + " failed");
