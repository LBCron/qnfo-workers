// RELAPSE-COHORT-1 offline suite: v_relapse_6h_cohort splits closes before and after the change and counts a relapse only inside 6 hours.
// Run: node --no-warnings migrations/relapse-6h-cohort.test.mjs   (exit 0 = all passed)
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const sql = readFileSync(new URL("./2026-11-04-relapse-6h-cohort.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const sql2 = readFileSync(new URL("./2026-11-04-relapse-6h-cohort-channel.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? "  -- " + JSON.stringify(x).slice(0, 400) : "")); } };

ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: .+/m.test(sql) && /^-- BACKUP: bak_20261104_relapse_6h_cohort$/m.test(sql), "migration opts in with APPLY-BY, DB, Rollback and BACKUP headers");

const db = new DatabaseSync(":memory:");
db.exec(`
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, status TEXT, description TEXT, updated_at INTEGER, close_channel TEXT);
CREATE TABLE issue_lifecycle (id INTEGER PRIMARY KEY AUTOINCREMENT, issue_id INTEGER NOT NULL, event TEXT NOT NULL, ts TEXT NOT NULL);
CREATE INDEX idx_issue_lifecycle_issue ON issue_lifecycle (issue_id, ts);
CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT, updated_at TEXT);
INSERT INTO agent_issues (id, title, status, description) VALUES (1, 'FAM-A-1: a', 'open', ''), (2, 'FAM-A-1: b', 'open', ''), (3, 'FAM-B-1: c', 'open', ''), (4, 'METRIC-TRIGGER-7-X: d', 'open', ''),
  (5, 'FAM-A-1: e', 'open', ''), (6, 'FAM-A-1: f', 'open', '');
INSERT INTO agent_issues (id, title, status, description) VALUES (9, 'RELAPSE-HOLD-1 measure: keep or revert the close hold by the 7-day reading', 'open', 'base');
`);
const at = (hoursAgo) => new Date(Date.now() - hoursAgo * 3600e3).toISOString().replace(/\.\d+Z$/, "Z");
const ev = (id, event, hoursAgo) => db.prepare("INSERT INTO issue_lifecycle (issue_id, event, ts) VALUES (?, ?, ?)").run(id, event, at(hoursAgo));
// the change went live 48 hours ago
db.prepare("INSERT INTO ops_config (key, value) VALUES ('relapse_hold_since', ?)").run(at(48));
// before: three closes of FAM-A (one relapses after 2 h, one after 8 h = outside the window), one METRIC-TRIGGER close relapsing after 1 h
ev(1, "dispositioned", 100); ev(1, "reopened", 98);
ev(2, "dispositioned", 90); ev(2, "reopened", 82);
ev(5, "dispositioned", 80);
ev(4, "dispositioned", 70); ev(4, "reopened", 69);
// after: two closes of FAM-B, one relapses after 3 h; one close too recent to judge (3 h ago); one FAM-A close that relapses after 7 h (outside)
ev(3, "dispositioned", 40); ev(3, "reopened", 37);
ev(6, "dispositioned", 30); ev(6, "reopened", 23);
ev(3, "dispositioned", 20);
ev(5, "dispositioned", 3); ev(5, "reopened", 2);

db.exec(sql);
const rows = Object.fromEntries(db.prepare("SELECT * FROM v_relapse_6h_cohort").all().map((r) => [r.cohort + "/" + r.family, r]));
ok(rows["before/FAM-A-1"].closes === 3 && rows["before/FAM-A-1"].relapsed_6h === 1 && rows["before/FAM-A-1"].rate_6h === 0.333, "before, family A: three closes, one relapse inside 6 h, the 8 h one does not count", rows["before/FAM-A-1"]);
ok(rows["before/METRIC-TRIGGER"].closes === 1 && rows["before/METRIC-TRIGGER"].relapsed_6h === 1, "metric-trigger issues are one family", rows["before/METRIC-TRIGGER"]);
ok(rows["after/FAM-B-1"].closes === 2 && rows["after/FAM-B-1"].relapsed_6h === 1, "after, family B: two closes, one relapse", rows["after/FAM-B-1"]);
ok(rows["after/FAM-A-1"].closes === 1 && rows["after/FAM-A-1"].relapsed_6h === 0, "after, family A: the relapse at 7 h is outside the window and the 3 h old close is not judged yet", rows["after/FAM-A-1"]);
const total = db.prepare("SELECT cohort, SUM(closes) c, SUM(relapsed_6h) r, ROUND(1.0 * SUM(relapsed_6h) / SUM(closes), 3) rate FROM v_relapse_6h_cohort GROUP BY cohort ORDER BY cohort").all();
ok(total.length === 2 && total[0].cohort === "after" && total[0].c === 3 && total[0].r === 1 && total[1].c === 4 && total[1].r === 2, "cohort totals", total);
ok(db.prepare("SELECT description d FROM agent_issues WHERE id = 9").get().d.includes("RELAPSE-COHORT-1"), "the measure issue points at the view");

db.exec(sql);
ok(db.prepare("SELECT description d FROM agent_issues WHERE id = 9").get().d.split("RELAPSE-COHORT-1").length === 2, "re-applying appends the pointer once");
ok(db.prepare("SELECT COUNT(*) n FROM ops_config WHERE key = 'relapse_hold_since'").get().n === 1, "re-applying keeps one change-time row");
const plan = db.prepare("EXPLAIN QUERY PLAN SELECT * FROM v_relapse_6h_cohort").all().map((r) => r.detail).join(" | ");
ok(/idx_issue_lifecycle_issue/.test(plan), "the relapse lookup uses the (issue_id, ts) index", plan);

// ---------------------------------------------------------------------------------------------------------------- RELAPSE-COHORT-2: channel column
{
  ok(/^-- APPLY-BY: ci$/m.test(sql2) && /^-- DB: qnfo-audit$/m.test(sql2) && /^-- Rollback: .+/m.test(sql2) && /^-- BACKUP: bak_20261104_relapse_6h_cohort_view$/m.test(sql2), "channel migration opts in with APPLY-BY, DB, Rollback and BACKUP headers");
  db.exec("UPDATE agent_issues SET close_channel = 'auto:verified-remediation-trigger' WHERE id IN (1, 3, 6)");
  db.exec("UPDATE agent_issues SET close_channel = 'auto:triage-sync:qnfo-fleet-control' WHERE id IN (2, 4, 5)");
  db.exec(sql2);
  const cols = db.prepare("SELECT name FROM pragma_table_info('v_relapse_6h_cohort')").all().map((r) => r.name);
  ok(cols.join(",") === "cohort,family,channel,closes,relapsed_6h,rate_6h", "the view gains a channel column", cols);
  const gated = db.prepare("SELECT cohort, SUM(closes) c, SUM(relapsed_6h) r FROM v_relapse_6h_cohort WHERE channel = 'auto:verified-remediation-trigger' GROUP BY cohort ORDER BY cohort").all();
  ok(gated.length === 2 && gated[0].cohort === "after" && gated[0].c === 3 && gated[0].r === 1 && gated[1].c === 1 && gated[1].r === 1, "the gated-channel reading counts only its own closes", gated);
  const all = db.prepare("SELECT cohort, SUM(closes) c FROM v_relapse_6h_cohort GROUP BY cohort ORDER BY cohort").all();
  ok(all[0].c === 3 && all[1].c === 4, "the all-channel totals are unchanged", all);
  ok(db.prepare("SELECT description d FROM agent_issues WHERE id = 9").get().d.includes("RELAPSE-COHORT-2"), "the measure issue carries the gated reading");
  db.exec(sql2);
  ok(db.prepare("SELECT description d FROM agent_issues WHERE id = 9").get().d.split("RELAPSE-COHORT-2").length === 2, "re-applying appends once");
}

console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
