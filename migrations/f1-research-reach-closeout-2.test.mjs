// F1-RESEARCH-REACH-CLOSEOUT-2 (2026-11-05): replays migrations/2026-11-05-f1-research-reach-closeout-2.sql on node:sqlite. Proves the two revision rows are prioritised only while queued, the stale structural error
// text is cleared only on rows that are not at stage complete (and kept in the backup table), the SINGLE-LANE-2 issue carries the code-task, code-anchor and code-probe lines the doers read, and a replay changes
// nothing. State-independent. Run: node migrations/f1-research-reach-closeout-2.test.mjs   -> prints "N passed, 0 failed"
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("./2026-11-05-f1-research-reach-closeout-2.sql", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };

const header = sql.split("\n").filter((l) => l.startsWith("--"));
ok(header.some((l) => /^-- APPLY-BY: ci\s*$/.test(l)) && header.some((l) => /^-- DB: qnfo-audit\s*$/.test(l)), "header opts in to CI and names the database");
ok(header.filter((l) => /^-- Rollback:/.test(l)).length === 1, "one Rollback line");
ok(header.some((l) => l === "-- BACKUP: bak_20261105_f1_closeout2") && header.some((l) => /^-- CAUSE-MAPPED:/.test(l)), "BACKUP and CAUSE-MAPPED lines present");
const body = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
ok(!/\b(DELETE\s+FROM|DROP\s+(TABLE|INDEX|VIEW|TRIGGER))\b/i.test(body), "the body deletes and drops nothing");
ok(!/CREATE\s+(TEMP\s+)?TRIGGER/i.test(body), "no trigger is created");

function fresh() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE research_queue (id TEXT PRIMARY KEY, status TEXT, stage TEXT, error TEXT, score REAL);
    CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT);
    CREATE TABLE decision_log (id INTEGER PRIMARY KEY, actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
    INSERT INTO research_queue VALUES
      ('rem-rev-cfb-1000701-a', 'queued', 'ground', NULL, 0.96),
      ('rem-rev-cfb-1000701-b', 'queued', 'ground', NULL, 0.96),
      ('x-claimed', 'researching', 'ground', NULL, 0.96),
      ('s-review', 'queued', 'review', 'STALE-CLAIM-REAPER-1: reclaimed; previous error: complete: structural defects only, no writable section: duplicate section numbers: 7', 0.9),
      ('s-ground', 'deferred', 'ground', 'complete: structural defects only, no writable section: skipped section numbers: 6', 0.9),
      ('s-complete', 'queued', 'complete', 'complete: structural defects only, no writable section: skipped section numbers: 6', 0.9),
      ('s-term', 'wontfix', 'ground', 'complete: structural defects only, no writable section: skipped section numbers: 6', 0.9),
      ('s-other', 'queued', 'review', 'review: 1 HARD findings unresolved', 0.9);
  `);
  return db;
}
const q = (db, id) => db.prepare("SELECT * FROM research_queue WHERE id = ?").get(id);

const db = fresh();
db.exec(sql);
ok(q(db, "rem-rev-cfb-1000701-a").score === 0.99 && q(db, "rem-rev-cfb-1000701-b").score === 0.99, "both revision rows go to 0.99");
ok(q(db, "x-claimed").score === 0.96, "no other row changes score");
ok(q(db, "s-review").error === null && q(db, "s-ground").error === null, "stale structural text is cleared on rows at review and ground");
ok(q(db, "s-complete").error !== null, "a row still at stage complete keeps its text (it may really be stuck there)");
ok(q(db, "s-term").error !== null, "a terminal row keeps its text");
ok(q(db, "s-other").error === "review: 1 HARD findings unresolved", "an unrelated error text is untouched");
const bak = db.prepare("SELECT kind, id, score, error FROM bak_20261105_f1_closeout2 ORDER BY kind, id").all();
ok(bak.filter((b) => b.kind === "score").length === 2 && bak.filter((b) => b.kind === "error").length === 2, "the backup holds the two scores and the two cleared texts", bak.map((b) => b.kind + ":" + b.id));
ok(bak.filter((b) => b.kind === "error").every((b) => /no writable section/.test(b.error)), "the backup keeps the old text");
const issue = db.prepare("SELECT * FROM agent_issues WHERE title LIKE 'SINGLE-LANE-2:%'").all();
ok(issue.length === 1 && issue[0].status === "open" && issue[0].priority === "high", "one open SINGLE-LANE-2 issue", issue.map((i) => i.priority));
const lines = (issue[0] ? issue[0].description : "").split("\n");
ok(lines.includes("code-task: repo=qnfo-workers path=qnfo-fleet-control/worker.js"), "the code-task line is on its own line");
ok(lines.includes("code-anchor: async function researchBackpressureTick(env) {"), "the code-anchor is a function signature on its own line");
const probeLine = lines.find((l) => l.startsWith("code-probe: "));
let probe = null; try { probe = JSON.parse(probeLine.slice("code-probe: ".length)); } catch (e) { /* asserted below */ }
ok(probe && probe.paths[0] === "qnfo-fleet-control/worker.js" && probe.absent === "SET status = 'wontfix', stage = 'parked'", "the code-probe line is JSON and names the park write", probeLine);
ok(db.prepare("SELECT COUNT(*) n FROM decision_log").get().n === 1, "one decision_log row");

// replay changes nothing
{
  const before = JSON.stringify(db.prepare("SELECT * FROM research_queue ORDER BY id").all());
  db.exec(sql);
  ok(before === JSON.stringify(db.prepare("SELECT * FROM research_queue ORDER BY id").all()), "a replay changes no research_queue row");
  ok(db.prepare("SELECT COUNT(*) n FROM agent_issues").get().n === 1 && db.prepare("SELECT COUNT(*) n FROM decision_log").get().n === 1, "a replay adds no second issue or decision_log row");
}
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
