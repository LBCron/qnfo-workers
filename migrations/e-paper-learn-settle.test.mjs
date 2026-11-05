// PAPER-LEARN-SETTLE-E-1 offline suite. Run: node migrations/e-paper-learn-settle.test.mjs
// The three PAPER-LEARN-1 contract probes count direct `proposed` learnings of their paper version; they pass at 0.
import { DatabaseSync } from "node:sqlite"; import { readFileSync } from "node:fs";
const db = new DatabaseSync(":memory:");
db.exec(`CREATE TABLE paper_learnings (id INTEGER PRIMARY KEY, slug TEXT, version TEXT, applicability TEXT, fleet_status TEXT, status_note TEXT, updated_at TEXT);`);
const ins = db.prepare("INSERT INTO paper_learnings (id, slug, version, applicability, fleet_status, status_note, updated_at) VALUES (?, ?, ?, ?, ?, 'old note', 'old')");
const RSC = "recursive-self-consistency", NUM = "number-systems-as-stratified-distinction-operations-an-enclosure-hierarchy-over-", QUBIT = "paper-beyond-the-qubit";
for (const id of [5672, 5673, 5675, 5676, 5677, 5678, 5679]) ins.run(id, RSC, "2.0.0", "direct", "proposed");
ins.run(5674, RSC, "2.0.0", "direct", "already-in-place"); ins.run(5680, RSC, "2.0.0", "none", "routed");
ins.run(5683, NUM, "3.0.0", "direct", "proposed");
for (const id of [5681, 5685, 5686]) ins.run(id, NUM, "3.0.0", "analogy", "proposed");
for (const id of [5734, 5735, 5736, 5737]) ins.run(id, QUBIT, "3.0.0", "direct", "proposed");
ins.run(5738, QUBIT, "3.0.0", "analogy", "proposed");
let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.log("FAIL " + m); } };
const probe = (slug, ver) => db.prepare("SELECT CAST(COUNT(*) AS TEXT) AS observed FROM paper_learnings WHERE slug = ? AND version = ? AND applicability = 'direct' AND fleet_status = 'proposed'").get(slug, ver).observed;
ok(probe(RSC, "2.0.0") === "7" && probe(NUM, "3.0.0") === "1" && probe(QUBIT, "3.0.0") === "4", "before: 7, 1 and 4 direct learnings are proposed");
const sql = readFileSync(new URL("./2026-11-05-e-paper-learn-settle.sql", import.meta.url), "utf8");
db.exec(sql);
ok(probe(RSC, "2.0.0") === "0" && probe(NUM, "3.0.0") === "0" && probe(QUBIT, "3.0.0") === "0", "after: the three closing probes read 0");
const by = {}; for (const r of db.prepare("SELECT fleet_status s, COUNT(*) n FROM paper_learnings WHERE id IN (5672,5673,5675,5676,5677,5678,5679,5683,5734,5735,5736,5737) GROUP BY fleet_status").all()) by[r.s] = r.n;
ok(by["applied"] === 1 && by["already-in-place"] === 7 && by["rejected"] === 4 && Object.keys(by).length === 3, "one applied, seven already in place, four rejected: " + JSON.stringify(by));
ok(db.prepare("SELECT fleet_status s FROM paper_learnings WHERE id = 5677").get().s === "applied", "the sweep learning (5677) is the applied one");
const notes = db.prepare("SELECT id, status_note n FROM paper_learnings WHERE id IN (5672,5673,5675,5676,5677,5678,5679,5683,5734,5735,5736,5737)").all();
ok(notes.every((r) => r.n.startsWith("PL-TRIAGE-2 ") && r.n.length > 250), "every settled row says why, in more than a sentence");
ok(notes.filter((r) => /rejected/.test(r.n.slice(0, 40))).every((r) => /Re-propose with/.test(r.n)), "every rejection says what would justify proposing again");
ok(db.prepare("SELECT COUNT(*) n FROM paper_learnings WHERE id IN (5674, 5680, 5681, 5685, 5686, 5738) AND (status_note <> 'old note')").get().n === 0, "rows outside the twelve are untouched");
ok(db.prepare("SELECT COUNT(*) n FROM paper_learnings WHERE id IN (5681, 5685, 5686, 5738) AND fleet_status = 'proposed'").get().n === 4, "the analogy learnings stay proposed (not part of the issues' probes)");
db.exec(sql);
ok(db.prepare("SELECT COUNT(*) n FROM bak_20261105_e_pl_settle").get().n === 12 && db.prepare("SELECT COUNT(*) n FROM bak_20261105_e_pl_settle WHERE fleet_status = 'proposed'").get().n === 12, "re-running keeps the first backup (all twelve were proposed)");
ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: /m.test(sql), "migration header lines");
// the applied learning names files that exist in this change
ok(/scripts\/d1_like_limit_guard\.py/.test(sql) && /scripts\/d1-like-limit-guard\.test\.mjs/.test(sql), "the applied row names the guard and its suite");
console.log(fail ? fail + " failed" : "all passed"); process.exit(fail ? 1 : 0);
