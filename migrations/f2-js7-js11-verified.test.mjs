// F2 verification (migrations/2026-11-05-f2-js7-js11-verified.sql) offline suite on SQLite: JS-7 and JS-11 become verified only while the live feed facts hold, with the old text in the
// backup; a failing or short feed, an open issue 1000643 or a row in another state leaves them alone; a replay adds nothing. Run: node migrations/f2-js7-js11-verified.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("./2026-11-05-f2-js7-js11-verified.sql", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 300))); } };
const hdr = sql.split(/\r?\n/).filter((l) => l.startsWith("--"));
ok(hdr.some((l) => l === "-- APPLY-BY: ci") && hdr.some((l) => l === "-- DB: qnfo-audit") && hdr.some((l) => l === "-- BACKUP: bak_20261105_f2_js7_js11") && hdr.some((l) => l.startsWith("-- Rollback: ")), "header lines");

function fresh({ feeds = {}, issue = "closed", status = "planned" } = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE roadmap_implementation (id INTEGER PRIMARY KEY, item TEXT, source TEXT, status TEXT, evidence TEXT, verified_at TEXT);
CREATE TABLE jobsearch_feeds (feed TEXT PRIMARY KEY, last_count INTEGER, consecutive_fail INTEGER DEFAULT 0);
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, status TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);`);
  db.prepare("INSERT INTO roadmap_implementation (id, item, source, status, evidence) VALUES (1678, 'JS-7', 'jobsearch-2026', ?, 'old 1678')").run(status);
  db.prepare("INSERT INTO roadmap_implementation (id, item, source, status, evidence) VALUES (1688, 'JS-11', 'jobsearch-2026', ?, 'old 1688')").run(status);
  db.prepare("INSERT INTO agent_issues (id, status) VALUES (1000643, ?)").run(issue);
  for (const [feed, [count, failing]] of Object.entries(feeds)) db.prepare("INSERT INTO jobsearch_feeds (feed, last_count, consecutive_fail) VALUES (?, ?, ?)").run(feed, count, failing);
  return db;
}
const GOOD = { "smartrecruiters:oecd": [22, 0], "recruitee:sweco": [179, 0], "publicsector:werkenvoornederland": [30, 0], "publicsector:academictransfer": [137, 0], "publicsector:euraxess": [35, 0] };
const row = (db, id) => db.prepare("SELECT status, evidence, verified_at FROM roadmap_implementation WHERE id = ?").get(id);

{
  const db = fresh({ feeds: GOOD });
  db.exec(sql);
  ok(row(db, 1678).status === "verified" && row(db, 1688).status === "verified", "both rows are verified with the live facts");
  ok(/smartrecruiters:oecd 22/.test(row(db, 1678).evidence) && /werkenvoornederland 30/.test(row(db, 1688).evidence) && row(db, 1678).verified_at && row(db, 1688).verified_at, "the evidence names the live numbers and a verified date");
  ok(db.prepare("SELECT evidence FROM bak_20261105_f2_js7_js11 WHERE id = 1678").get().evidence === "old 1678", "the backup holds the old text");
  ok(db.prepare("SELECT COUNT(*) n FROM decision_log").get().n === 1, "one decision is logged");
  db.exec(sql);
  ok(db.prepare("SELECT COUNT(*) n FROM decision_log").get().n === 1 && db.prepare("SELECT evidence FROM bak_20261105_f2_js7_js11 WHERE id = 1678").get().evidence === "old 1678", "a replay adds nothing and keeps the first backup");
}
for (const [name, opts, expect] of [
  ["a failing SmartRecruiters feed", { feeds: { ...GOOD, "smartrecruiters:oecd": [22, 3] } }, { 1678: "planned", 1688: "verified" }],
  ["a missing Sweco feed", { feeds: { "smartrecruiters:oecd": [22, 0], ...Object.fromEntries(Object.entries(GOOD).filter(([k]) => k.startsWith("publicsector"))) } }, { 1678: "planned", 1688: "verified" }],
  ["the old two-posting reader", { feeds: { ...GOOD, "publicsector:werkenvoornederland": [2, 0] } }, { 1678: "verified", 1688: "planned" }],
  ["an academictransfer feed that fails", { feeds: { ...GOOD, "publicsector:academictransfer": [137, 1] } }, { 1678: "verified", 1688: "planned" }],
  ["issue 1000643 still open", { feeds: GOOD, issue: "open" }, { 1678: "verified", 1688: "planned" }],
  ["rows already in another state", { feeds: GOOD, status: "built" }, { 1678: "built", 1688: "built" }],
]) {
  const db = fresh(opts);
  db.exec(sql);
  ok(row(db, 1678).status === expect[1678] && row(db, 1688).status === expect[1688], "left alone: " + name, { a: row(db, 1678).status, b: row(db, 1688).status });
}
console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
