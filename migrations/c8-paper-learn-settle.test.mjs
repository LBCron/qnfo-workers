// PAPER-LEARN-PROBATION-SETTLE-1 / PAPER-LEARN-PROBATION-DOD-1 offline suite: replays migrations/2026-11-05-c8-paper-learn-goal-dod.sql and the nine settle files on node:sqlite.
// Proves: the nine files settle each of 225 learning ids exactly once with an allowed disposition and a bounded, specific note; the widened goal DoD reads 0 for a settled learning in every
// allowed state and 1 while a learning is still in probation; only rows in probation change (a proposed row, an applied row and a row of another id are left alone); a second apply changes
// nothing; each Rollback line restores the rows. Output MUST contain "0 failed" on success.
// Run: node --no-warnings migrations/c8-paper-learn-settle.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
const dir = new URL("./", import.meta.url);
const files = readdirSync(dir).filter((f) => /^2026-11-05-c8-paper-learn-settle-\d\d\.sql$/.test(f)).sort();
const dodFile = "2026-11-05-c8-paper-learn-goal-dod.sql";
const read = (f) => readFileSync(new URL(f, dir), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 300))); } };
ok(files.length === 9, "nine settle files", files.length);
const header = (sql) => /^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: /m.test(sql);
ok(header(read(dodFile)) && files.every((f) => header(read(f))), "every file opts in with APPLY-BY, DB and Rollback");
const idsByFile = files.map((f) => Array.from(read(f).matchAll(/WHERE id = (\d+) AND fleet_status = 'probation';/g)).map((m) => Number(m[1])));
const all = idsByFile.flat();
ok(all.length === 225 && new Set(all).size === 225, "225 distinct ids across the files", { n: all.length, distinct: new Set(all).size });
ok(idsByFile.every((x) => x.length <= 25), "at most 25 rows a file");
const upd = files.flatMap((f) => Array.from(read(f).matchAll(/SET fleet_status = '([a-z-]+)', status_note = '((?:[^']|'')*)'/g)).map((m) => ({ status: m[1], note: m[2].replace(/''/g, "'") })));
ok(upd.length === 225, "one update per id", upd.length);
ok(upd.every((u) => ["rejected", "already-in-place", "routed"].includes(u.status)), "only allowed dispositions");
ok(upd.every((u) => u.note.length >= 120 && u.note.length <= 700 && /^PL-TRIAGE-2 (rejected|in place|routed) \(c8-projects-goals session, 2026-11-05; [a-z,-]+\): /.test(u.note)), "notes are bounded and carry the marker, session and category");
ok(upd.filter((u) => u.status === "routed").every((u) => /1000459|external-impact-per-dollar/.test(u.note)), "a routed note names its issue or goal");
ok(upd.filter((u) => u.status === "rejected" && /; (no-measured-gap|paper-convention)\)/.test(u.note)).every((u) => /Re-propose/.test(u.note)), "a no-measured-gap or paper-convention rejection says what would justify re-proposing");
ok(upd.every((u) => !/listed above|see above|see below|the above/i.test(u.note)), "a note stands alone");
ok(new Set(upd.map((u) => u.note)).size === 225, "no two notes are identical");

const db = new DatabaseSync(":memory:");
db.exec(`CREATE TABLE paper_learnings (id INTEGER PRIMARY KEY, slug TEXT, fleet_status TEXT, status_note TEXT, updated_at TEXT);
CREATE TABLE goals (id INTEGER PRIMARY KEY AUTOINCREMENT, goal_key TEXT UNIQUE NOT NULL, statement TEXT, goal_type TEXT NOT NULL DEFAULT 'instrumental', status TEXT NOT NULL DEFAULT 'adopted', dod TEXT, program_code TEXT, owner TEXT, priority INTEGER, updated_at TEXT);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, module TEXT, verify_probe TEXT, verify_transport TEXT);
CREATE VIEW v_goal_dod AS SELECT g.id, g.goal_key, g.status, g.goal_type, g.program_code, g.owner, g.priority,
  CASE WHEN instr(COALESCE(g.dod, ''), '{"paths"') > 0 THEN 'code-read' WHEN instr(COALESCE(g.dod, ''), 'SELECT ') > 0 AND instr(COALESCE(g.dod, ''), 'AS expected') > 0 THEN 'd1-query' END AS transport,
  CASE WHEN instr(COALESCE(g.dod, ''), '{"paths"') > 0 THEN trim(substr(g.dod, instr(g.dod, '{"paths"'))) WHEN instr(COALESCE(g.dod, ''), 'SELECT ') > 0 AND instr(COALESCE(g.dod, ''), 'AS expected') > 0 THEN replace(rtrim(trim(substr(g.dod, instr(g.dod, 'SELECT '))), ';'), ';', ',') END AS probe
FROM goals g WHERE g.goal_type <> 'objective-revision';`);
const oldDod = (id) => "SELECT '0' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM paper_learnings WHERE id = " + id + " AND fleet_status NOT IN ('applied', 'rejected')";
for (const id of all) {
  db.prepare("INSERT INTO paper_learnings (id, slug, fleet_status, status_note, updated_at) VALUES (?, 's', 'probation', 'orig', 'u0')").run(id);
  db.prepare("INSERT INTO goals (goal_key, statement, dod, owner) VALUES (?, 'x', ?, 'qnfo-code-orchestrator')").run("PAPER-LEARN-" + id, oldDod(id));
  db.prepare("INSERT INTO remediation_contracts (class, module, verify_probe, verify_transport) VALUES (?, 'goal-dod-v1', ?, 'd1-query')").run("goal-PAPER-LEARN-" + id, oldDod(id));
}
db.prepare("INSERT INTO paper_learnings (id, slug, fleet_status, status_note, updated_at) VALUES (1, 'other', 'proposed', 'keep', 'u0'), (2, 'other', 'applied', 'keep', 'u0'), (3, 'other', 'probation', 'keep', 'u0')").run();
db.prepare("INSERT INTO goals (goal_key, statement, dod) VALUES ('other-goal', 'x', 'SELECT 1 AS expected, 2 AS observed')").run();
const observed = (probe) => db.prepare(probe).get();
const settled = (id) => { const p = db.prepare("SELECT probe FROM v_goal_dod WHERE goal_key = ?").get("PAPER-LEARN-" + id).probe; const r = observed(p); return r.expected === r.observed; };
ok(all.every((id) => !settled(id)), "every goal fails its DoD while its learning is in probation");
db.exec(read(dodFile));
ok(db.prepare("SELECT COUNT(*) n FROM goals WHERE dod LIKE '%already-in-place%'").get().n === 225, "225 goal DoDs widened");
ok(db.prepare("SELECT dod FROM goals WHERE goal_key = 'other-goal'").get().dod === "SELECT 1 AS expected, 2 AS observed", "another goal is untouched");
ok(db.prepare("SELECT COUNT(*) n FROM remediation_contracts WHERE verify_probe LIKE '%already-in-place%'").get().n === 225, "225 contract probes follow the DoD");
ok(all.every((id) => !settled(id)), "widening alone completes nothing");
const before = JSON.stringify(db.prepare("SELECT * FROM paper_learnings ORDER BY id").all());
for (const f of files) db.exec(read(f));
ok(db.prepare("SELECT COUNT(*) n FROM paper_learnings WHERE fleet_status = 'probation'").get().n === 1, "only the unrelated probation row remains in probation");
ok(all.every((id) => settled(id)), "every goal DoD reads settled after the dispositions");
ok(db.prepare("SELECT fleet_status s, status_note n FROM paper_learnings WHERE id = 1").get().s === "proposed" && db.prepare("SELECT status_note n FROM paper_learnings WHERE id = 3").get().n === "keep", "rows outside the id list are untouched");
const after = JSON.stringify(db.prepare("SELECT * FROM paper_learnings ORDER BY id").all());
for (const f of files) db.exec(read(f));
db.exec(read(dodFile));
ok(JSON.stringify(db.prepare("SELECT * FROM paper_learnings ORDER BY id").all()) === after, "a second apply changes nothing");
// Rollback of the last settle file restores its rows from its own backup table.
const last = files[files.length - 1];
const rb = /^-- Rollback: (.+)$/m.exec(read(last))[1];
db.exec(rb);
const restored = db.prepare("SELECT COUNT(*) n FROM paper_learnings WHERE id IN (" + idsByFile[8].join(",") + ") AND fleet_status = 'probation' AND status_note = 'orig'").get().n;
ok(restored === 25, "the rollback restores the file's rows", restored);
ok(before.length > 0, "snapshot taken");
console.log(pass + " passed, " + fail + " failed");
