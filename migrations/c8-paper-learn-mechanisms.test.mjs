// PAPER-LEARN-MECHANISMS-1 offline suite: replays migrations/2026-11-05-c8-paper-learn-mechanisms.sql on node:sqlite. Output MUST contain "0 failed" on success.
// Proves: 19 mechanisms are added once with a key, a title, a citation and an evidence probe; none carries a lexical term (a term settles a learning without a model, so only the two model
// families may name these); each probe is a single read-only SELECT that qnfo-lifecycle's plRunProbe would accept and reads ok or absent (never a write); a replay changes nothing;
// the Rollback removes exactly these keys and leaves an older mechanism alone.
// Run: node --no-warnings migrations/c8-paper-learn-mechanisms.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("./2026-11-05-c8-paper-learn-mechanisms.sql", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 300))); } };
ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: /m.test(sql), "header opts in");
const d = new DatabaseSync(":memory:");
d.exec("CREATE TABLE paper_learning_mechanisms (mech_key TEXT PRIMARY KEY, title TEXT NOT NULL, terms TEXT NOT NULL DEFAULT '', citation TEXT NOT NULL, evidence_probe TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at TEXT)");
d.prepare("INSERT INTO paper_learning_mechanisms (mech_key, title, terms, citation, evidence_probe) VALUES ('claim-integrity', 'older', 'claim integrity', 'c', 'SELECT 1 AS observed')").run();
d.exec(sql);
const rows = d.prepare("SELECT * FROM paper_learning_mechanisms WHERE mech_key <> 'claim-integrity' ORDER BY mech_key").all();
ok(rows.length === 19, "19 mechanisms added", rows.length);
ok(rows.every((r) => /^[a-z]+(-[a-z0-9]+)*$/.test(r.mech_key) && r.title.length >= 60 && r.citation.length >= 40), "key, title and citation are filled in");
ok(rows.every((r) => r.terms === ""), "no mechanism carries a lexical term");
ok(rows.every((r) => /^SELECT /.test(r.evidence_probe) && !r.evidence_probe.includes(";") && !/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b/i.test(r.evidence_probe) && /'ok'/.test(r.evidence_probe) && /'absent'/.test(r.evidence_probe)), "each probe is one read-only SELECT that reads ok or absent");
ok(rows.every((r) => Array.from(r.evidence_probe.matchAll(/LIKE '([^']*)'/g)).every((m) => Buffer.byteLength(m[1]) < 50)), "no LIKE pattern reaches D1's 50-byte limit");
ok(new Set(rows.map((r) => r.title)).size === 19, "titles are distinct");
// Probes compile against a stub schema built from the tables they name, and read absent on empty tables.
const stub = new DatabaseSync(":memory:");
const need = new Set();
for (const r of rows) for (const m of r.evidence_probe.matchAll(/(?:FROM|JOIN) ([a-z_0-9]+)/g)) need.add(m[1]);
const cols = { metric_registry: "metric TEXT, last_value TEXT, warning_band TEXT, kind TEXT", decision_log: "outcome_matched INTEGER", cloud_ops_events: "kind TEXT, ts TEXT", remediation_contracts: "max_attempts INTEGER, budget_ms INTEGER", sqlite_master: null, v_cost_all_in: "lines INTEGER" };
for (const t of need) { if (t === "sqlite_master") continue; stub.exec("CREATE TABLE " + t + " (" + (cols[t] || "x INTEGER") + ")"); }
let compiled = 0, absent = 0;
for (const r of rows) { try { const v = stub.prepare(r.evidence_probe).get(); compiled++; if (v.observed === "absent") absent++; } catch (e) { console.log("probe " + r.mech_key + ": " + e.message); } }
ok(compiled === 19, "every probe compiles", compiled);
ok(absent === 19, "every probe reads absent on an empty fleet (none passes vacuously)", absent);
const before = JSON.stringify(d.prepare("SELECT * FROM paper_learning_mechanisms ORDER BY mech_key").all());
d.exec(sql);
ok(JSON.stringify(d.prepare("SELECT * FROM paper_learning_mechanisms ORDER BY mech_key").all()) === before, "a replay changes nothing");
const rb = /^-- Rollback: (.+)$/m.exec(sql)[1];
d.exec(rb);
ok(d.prepare("SELECT COUNT(*) n FROM paper_learning_mechanisms").get().n === 1 && d.prepare("SELECT mech_key FROM paper_learning_mechanisms").get().mech_key === "claim-integrity", "the rollback removes exactly these keys");
console.log(pass + " passed, " + fail + " failed");
