// GOLDEN-RUN-COMPLEMENT-SINCE-FIX-1 offline suite: migrations/2026-11-05-golden-run-complement-since-fix.sql on node:sqlite.
// Proves: (1) the re-created output_quality_heavy_tick is the 2026-10-26 trigger with exactly the golden-run clause changed (all other statements byte for byte);
// (2) the golden-run UPDATE, run on fixtures, counts only rows since the fix with 0 < catch_rate < 1: pre-fix complements and the 1 + 0 = 1 coincidence do not count,
// a post-fix complement does; (3) with no decidable row the metric is left alone; (4) the file replays cleanly twice and keeps the first backup; (5) one decision, one prediction.
// Run: node migrations/golden-run-complement-since-fix.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const here = (f) => new URL("./" + f, import.meta.url);
const sql = readFileSync(here("2026-11-05-golden-run-complement-since-fix.sql"), "utf8");
const orig = readFileSync(here("2026-10-26-output-quality-ledger.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d))); } };
function triggerOf(text, withIfNotExists) {
  const head = withIfNotExists ? "CREATE TRIGGER IF NOT EXISTS output_quality_heavy_tick" : "CREATE TRIGGER output_quality_heavy_tick";
  const a = text.indexOf(head);
  const b = text.indexOf("\nEND", a) + 4;
  return text.slice(a, b).replace("CREATE TRIGGER IF NOT EXISTS ", "CREATE TRIGGER ");
}
const oldTrig = triggerOf(orig, true);
const newTrig = triggerOf(sql, false);
ok(oldTrig.length > 4000 && newTrig.length > oldTrig.length, "both trigger texts found", [oldTrig.length, newTrig.length]);
const OLD1 = "FROM research_golden_runs WHERE created_at >= datetime('now', '-30 days'))";
const NEW1 = "FROM research_golden_runs WHERE created_at >= max('2026-10-27', datetime('now', '-30 days')) AND catch_rate > 0 AND catch_rate < 1)";
const OLD2 = "AND EXISTS (SELECT 1 FROM research_golden_runs WHERE created_at >= datetime('now', '-30 days'));";
const NEW2 = "AND EXISTS (SELECT 1 FROM research_golden_runs WHERE created_at >= max('2026-10-27', datetime('now', '-30 days')) AND catch_rate > 0 AND catch_rate < 1);";
ok(newTrig.replace(NEW1, OLD1).replace(NEW2, OLD2) === oldTrig, "the new trigger differs from the live one in exactly the two golden-run clauses");
ok(newTrig.split(";\n").length === oldTrig.split(";\n").length, "the trigger keeps its statement count");

// the golden UPDATE statement on its own, with fixtures
const body = newTrig.slice(newTrig.indexOf("BEGIN") + 5, newTrig.lastIndexOf("END"));
const stmts = body.split(/;\s*\n\s*(?=UPDATE|END)/).map((s) => s.trim().replace(/;$/, ""));
const golden = stmts.find((s) => s.includes("WHERE metric = 'golden_run_complement_share_30d'"));
ok(!!golden, "the golden-run statement is found in the trigger body");
const ago = (days) => new Date(Date.now() - days * 864e5).toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
function build(rows) {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE research_golden_runs (row_id TEXT PRIMARY KEY, catch_rate REAL, false_positive_rate REAL, model_version TEXT, prompt_version TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP); CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, last_value TEXT, last_refreshed TEXT, state TEXT);");
  db.prepare("INSERT INTO metric_registry (metric, last_value) VALUES ('golden_run_complement_share_30d', '0.887')").run();
  const ins = db.prepare("INSERT INTO research_golden_runs (row_id, catch_rate, false_positive_rate, created_at) VALUES (?, ?, ?, ?)");
  rows.forEach((r, i) => ins.run("r" + i, r[0], r[1], r[2]));
  return db;
}
const value = (db) => db.prepare("SELECT last_value v FROM metric_registry WHERE metric = 'golden_run_complement_share_30d'").get().v;
const post = (n) => ago(n);           // days ago, all after 2026-10-27 if n small enough at test time
const FIX = "2026-10-27 00:00:00";
const preFix = "2026-10-20 12:00:00";
const mid = build([[0.8, 0.2, preFix], [0.7, 0.3, preFix], [0.9, 0.1, preFix],        // pre-fix complements: ignored
  [1, 0, post(0.5)], [1, 0, post(0.4)], [1, 0, post(0.3)],                                // 1 + 0 = 1 coincidence: ignored
  [0.9, 0, post(0.2)], [0.8, 0.05, post(0.2)], [0.75, 0.1, post(0.1)], [0.6, 0.25, post(0.1)]]); // four decidable, none a complement
// the fixtures must sit after the fix and inside 30 days at run time
const rowsOk = mid.prepare("SELECT COUNT(*) n FROM research_golden_runs WHERE created_at >= ?").get(FIX).n;
if (rowsOk >= 7) {
  mid.exec(golden);
  ok(value(mid) === "0.0", "no decidable post-fix complement reads 0.0", value(mid));
  const one = build([[0.9, 0, post(0.2)], [0.8, 0.05, post(0.2)], [0.75, 0.25, post(0.1)], [0.6, 0.25, post(0.1)]]);   // 0.75 + 0.25 = 1
  one.exec(golden);
  ok(value(one) === "0.25", "one complement among four decidable rows reads 0.25", value(one));
  const old = build([[0.8, 0.2, preFix], [0.7, 0.3, preFix], [1, 0, post(0.5)]]);     // nothing decidable after the fix
  old.exec(golden);
  ok(value(old) === "0.887", "with no decidable row since the fix the metric is left as it was", value(old));
} else {
  ok(false, "fixtures fall after the fix date", rowsOk);
}

// replay on a database that has the pieces the migration touches
function shell() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE fleet_tick_heavy (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, source TEXT);
CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, formula TEXT, last_value TEXT, last_refreshed TEXT, state TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
CREATE TABLE decision_predictions (id INTEGER PRIMARY KEY AUTOINCREMENT, decision_id INTEGER, kind TEXT, subject TEXT, op TEXT, value REAL, due_at TEXT, origin TEXT, UNIQUE(decision_id, kind, subject));
INSERT INTO metric_registry (metric, formula) VALUES ('golden_run_complement_share_30d', 'share of research_golden_runs rows');`);
  db.exec(oldTrig + ";");
  return db;
}
function statements(text) {
  const out = []; let cur = "", q = false, depth = 0;
  const lines = text.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
  for (let i = 0; i < lines.length; i++) {
    const c = lines[i];
    if (c === "'") q = !q;
    if (!q && /^BEGIN\b/i.test(lines.slice(i, i + 5)) && (i === 0 || /\s/.test(lines[i - 1]))) depth = 1;
    if (!q && depth && /^END\b/i.test(lines.slice(i, i + 3)) && /\s/.test(lines[i - 1] || " ")) depth = 0;
    if (c === ";" && !q && !depth) { if (cur.trim()) out.push(cur.trim()); cur = ""; } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
const S = statements(sql);
ok(S.length === 6, "six statements (backup, drop, create, formula, decision, prediction)", S.map((s) => s.slice(0, 40)));
const db = shell();
for (const s of S) db.exec(s);
const trigNow = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'output_quality_heavy_tick'").get().sql;
ok(trigNow.includes("max('2026-10-27'") && !trigNow.includes("IF NOT EXISTS"), "the live trigger is the new one after the file");
const bakFirst = JSON.stringify(db.prepare("SELECT * FROM bak_20261105_golden_run_complement ORDER BY kind").all());
for (const s of S) db.exec(s);
ok(JSON.stringify(db.prepare("SELECT * FROM bak_20261105_golden_run_complement ORDER BY kind").all()) === bakFirst, "a replay keeps the first backup (the old trigger)");
ok(db.prepare("SELECT v FROM bak_20261105_golden_run_complement WHERE kind = 'trigger'").get().v.includes("datetime('now', '-30 days'))") === true, "the backup holds the old trigger");
ok(db.prepare("SELECT COUNT(*) n FROM decision_log").get().n === 1 && db.prepare("SELECT COUNT(*) n FROM decision_predictions").get().n === 1, "one decision and one prediction after two runs");
ok(/GOLDEN-RUN-COMPLEMENT-SINCE-FIX-1/.test(db.prepare("SELECT formula f FROM metric_registry").get().f) && db.prepare("SELECT formula f FROM metric_registry").get().f.split("GOLDEN-RUN-COMPLEMENT-SINCE-FIX-1").length === 2, "the formula says what changed, once");

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
