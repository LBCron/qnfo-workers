// SINGLE-LANE-1 offline suite: replays migrations/2026-11-03-single-lane-no-parked-research.sql on node:sqlite.
// Proves: the header opts in (APPLY-BY ci, DB qnfo-audit, BACKUP, one Rollback line, nothing deleted or dropped in the body); every parked row (wontfix or archived) leaves stage parked; merged errata duplicates
// become superseded; all other parked rows re-enter at ground as queued with counters reset and the old reason kept; other rows are untouched; POOL-BOUND-1 is switched off; the issue's closing probe goes from N to 0;
// a replay changes nothing; the Rollback line restores the first state.
// Output MUST contain "0 failed" on success.   node migrations/single-lane-no-parked-research.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("./2026-11-03-single-lane-no-parked-research.sql", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 500))); } };

const header = sql.split("\n").filter((l) => l.startsWith("--"));
const body = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
ok(header.some((l) => /^-- APPLY-BY: ci\s*$/.test(l)) && header.some((l) => /^-- DB: qnfo-audit\s*$/.test(l)), "header opts in: APPLY-BY ci, DB qnfo-audit");
ok(header.filter((l) => /^-- Rollback:/.test(l)).length === 1 && header.filter((l) => /^-- BACKUP: bak_20261103_single_lane_parked\s*$/.test(l)).length === 1, "one Rollback line and the backup is named");
ok(!/\b(DELETE\s+FROM|DROP\s+(TABLE|INDEX|VIEW|TRIGGER))\b/i.test(body), "the body deletes and drops nothing");
ok(!/fleet_tick|claude\.ai|anthropic\.com/i.test(sql) && !/\b(UPDATE|DELETE\s+FROM)\s+(decision_log|issue_lifecycle)\b/i.test(body), "decision_log is only inserted into; no fleet_tick, no claude.ai");
ok([...sql.matchAll(/LIKE\s+'([^']*)'/gi)].every((m) => Buffer.byteLength(m[1]) <= 50), "LIKE patterns stay under 50 bytes");

const w = new DatabaseSync(":memory:");
w.exec(`CREATE TABLE research_queue (id TEXT PRIMARY KEY, source TEXT, source_id TEXT, status TEXT, stage TEXT, score REAL, error TEXT, recover_count INTEGER DEFAULT 0, terminal_rearms INTEGER DEFAULT 0, attempt INTEGER DEFAULT 0, context TEXT, claimed_at TEXT, created_at TEXT);
CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT);
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);`);
w.exec("INSERT INTO ops_config (key, value, note) VALUES ('research_deferred_max', '400', 'old note')");
const put = (id, status, stage, error, rc = 3, tr = 2) => w.prepare("INSERT INTO research_queue (id, source, source_id, status, stage, score, error, recover_count, terminal_rearms, attempt, context, created_at) VALUES (?, 'proposal', ?, ?, ?, 0.5, ?, ?, ?, 4, '{\"cycles\":2}', '2026-10-20T00:00:00Z')").run(id, "s-" + id, status, stage, error, rc, tr);
put("poison", "wontfix", "parked", "PARKED-POISON-1: recover_count exhausted (6); last error: revise: output too short");
put("review", "wontfix", "parked", "REVIEW-UNRESOLVED-PARK-1: prior stage revise; no applicable edit");
put("pool", "wontfix", "parked", "POOL-BOUND-1 parked 2026-10-20T00:00:00Z: deferred pool 500");
put("arch", "archived", "parked", "PARKED-POISON-1: stale researching claim");
put("dup", "wontfix", "parked", "ERRATA-ROUTE-PER-PAPER-1: merged into rem-keep (same paper)");
put("live", "queued", "revise", null, 1, 0);
put("done", "published", "done", null, 0, 0);
put("failed-other", "wontfix", "ground", "terminal but not parked", 3, 0);
const probe = () => w.prepare("SELECT COUNT(*) n FROM research_queue WHERE stage = 'parked'").get().n;
const snap = () => JSON.stringify(w.prepare("SELECT * FROM research_queue ORDER BY id").all());
ok(probe() === 5, "before: five rows hold stage parked");
const first = snap();
w.exec(sql);
const row = (id) => w.prepare("SELECT * FROM research_queue WHERE id = ?").get(id);
ok(probe() === 0, "after: the closing probe reads 0");
for (const id of ["poison", "review", "pool", "arch"]) {
  const r = row(id);
  ok(r.status === "queued" && r.stage === "ground" && r.recover_count === 0 && r.terminal_rearms === 0 && r.attempt === 0 && r.context === "{}" && r.claimed_at === null && r.error.startsWith("SINGLE-LANE-1: re-entered at ground") && r.error.includes(" Was: "), id + ": back in the lane at ground, counters reset, old reason kept", r);
}
ok(row("poison").error.includes("output too short") && row("arch").error.includes("stale researching claim"), "the old reasons survive in error");
ok(row("dup").status === "superseded" && row("dup").stage === "merged" && row("dup").error.startsWith("SINGLE-LANE-1: carried by another row") && row("dup").error.includes("rem-keep"), "a merged errata duplicate leaves the lane as superseded, not rewritten twice", row("dup"));
ok(row("live").status === "queued" && row("live").stage === "revise" && row("live").recover_count === 1 && row("done").status === "published" && row("failed-other").stage === "ground" && row("failed-other").status === "wontfix", "rows that were not parked are untouched");
ok(w.prepare("SELECT value FROM ops_config WHERE key = 'research_deferred_max'").get().value === "0", "POOL-BOUND-1 is off (research_deferred_max 0)");
ok(w.prepare("SELECT COUNT(*) n FROM bak_20261103_single_lane_parked").get().n === 5 && w.prepare("SELECT value FROM bak_20261103_single_lane_ops").get().value === "400", "backups hold the five rows and the old ops_config value");
const iss = w.prepare("SELECT * FROM agent_issues WHERE title LIKE 'SINGLE-LANE-1:%'").all();
ok(iss.length === 1 && /code-task: repo=qnfo-workers path=qnfo-research-exec\/worker\.js/.test(iss[0].description) && iss[0].description.includes("code-anchor: async function parkPoisonRow(env, row, msg) {") && iss[0].description.includes("WHERE stage = 'parked' expected 0"), "the code task is filed with its anchor and closing probe", iss.length);
ok(w.prepare("SELECT COUNT(*) n FROM decision_log WHERE action LIKE 'SINGLE-LANE-1:%'").get().n === 1, "one decision_log row");
// the code task this file filed has been carried out (qnfo-research-exec 0.54.0): the anchored writer is gone and its one replacement, laneReenter, occurs once
{
  const src = readFileSync(new URL("../qnfo-research-exec/worker.js", import.meta.url), "utf8");
  ok(src.split("async function parkPoisonRow(env, row, msg) {").length === 1, "the anchored park writer is gone from qnfo-research-exec/worker.js");
  ok(src.split("async function laneReenter(env, row, o) {").length === 2, "the one lane re-entry that replaces it occurs once");
}
const second = snap();
w.exec(sql);
ok(snap() === second && w.prepare("SELECT COUNT(*) n FROM decision_log").get().n === 1 && w.prepare("SELECT COUNT(*) n FROM agent_issues").get().n === 1, "a replay changes nothing and adds no issue or decision row");
{
  const rb = header.find((l) => /^-- Rollback:/.test(l)).replace(/^-- Rollback:\s*/, "");
  w.exec(rb);
  ok(snap() === first, "the Rollback line restores every row to its first state");
  ok(w.prepare("SELECT value FROM ops_config WHERE key = 'research_deferred_max'").get().value === "400", "the Rollback line restores the ops_config value");
}
console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
