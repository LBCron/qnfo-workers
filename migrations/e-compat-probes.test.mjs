// COMPAT-PROBE-REAL-1 offline suite. Run: node migrations/e-compat-probes.test.mjs
// The three PORTFOLIO-UPGRADE-1 probes must pass on the ADVANCED live date with no skipped default change, and must not depend on the calendar.
import { DatabaseSync } from "node:sqlite"; import { readFileSync } from "node:fs";
const db = new DatabaseSync(":memory:");
db.exec(`CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, action TEXT, verify_probe TEXT, status TEXT, attempts INTEGER, last_verdict TEXT, deferred_since TEXT, next_due_at TEXT);
CREATE TABLE worker_compat_state (worker TEXT, checked_at TEXT, live_date TEXT, days_behind INTEGER, flips_count INTEGER);
INSERT INTO remediation_contracts VALUES ('issue-1000583', 1000583, 'old', 'OLD583', 'active', 290, 'fail', NULL, NULL), ('issue-1000843', 1000843, 'old', 'OLD843', 'active', 210, 'fail', NULL, NULL), ('issue-1000914', 1000914, 'old', 'OLD914', 'active', 153, 'fail', NULL, NULL), ('issue-1000915', 1000915, 'old', 'OLD915', 'active', 152, 'fail', NULL, NULL);`);
db.exec(readFileSync(new URL("./2026-11-05-e-compat-probes.sql", import.meta.url), "utf8"));
let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.log("FAIL " + m); } };
const probe = (cls) => db.prepare("SELECT verify_probe p FROM remediation_contracts WHERE class = ?").get(cls).p;
const run = (cls) => db.prepare(probe(cls)).get();
const worker = { "issue-1000583": "qnfo-jobsearch", "issue-1000843": "personal-watch", "issue-1000914": "q08-mind" };
for (const [cls, w] of Object.entries(worker)) {
  ok(run(cls).observed !== run(cls).expected, cls + ": no snapshot row is not a pass");
  db.exec(`DELETE FROM worker_compat_state; INSERT INTO worker_compat_state VALUES ('${w}', '2026-11-05T00:00:00Z', '2026-10-10', 26, 0);`);
  ok(run(cls).observed !== run(cls).expected, cls + ": the old live date with zero flips is not a pass (the advance has not applied)");
  db.exec(`DELETE FROM worker_compat_state; INSERT INTO worker_compat_state VALUES ('${w}', '2026-11-05T06:00:00Z', '2026-11-04', 1, 0);`);
  ok(run(cls).observed === run(cls).expected, cls + ": the advanced live date with zero flips is a pass: " + JSON.stringify(run(cls)));
  db.exec(`DELETE FROM worker_compat_state; INSERT INTO worker_compat_state VALUES ('${w}', '2026-12-20T06:00:00Z', '2026-11-04', 46, 0);`);
  ok(run(cls).observed === run(cls).expected, cls + ": calendar age alone does not undo a pass (days_behind 46 still passes)");
  db.exec(`DELETE FROM worker_compat_state; INSERT INTO worker_compat_state VALUES ('${w}', '2026-11-05T06:00:00Z', '2026-11-04', 1, 2);`);
  ok(run(cls).observed !== run(cls).expected, cls + ": a skipped default change is not a pass");
  db.exec(`DELETE FROM worker_compat_state; INSERT INTO worker_compat_state VALUES ('${w}', '2026-11-05T00:00:00Z', '2026-10-10', 26, 0), ('${w}', '2026-11-05T06:00:00Z', '2026-11-04', 1, 0);`);
  ok(run(cls).observed === run(cls).expected, cls + ": the newest snapshot decides");
  const row = db.prepare("SELECT status, attempts, last_verdict, next_due_at FROM remediation_contracts WHERE class = ?").get(cls);
  ok(row.status === "active" && row.attempts === 0 && row.last_verdict === null && row.next_due_at !== null, cls + ": the contract is re-armed for the next consumer run");
}
ok(db.prepare("SELECT verify_probe p FROM remediation_contracts WHERE class = 'issue-1000915'").get().p === "OLD915", "voice-stt (no repository source) is not touched");
const bak = db.prepare("SELECT class, verify_probe FROM bak_20261105_e_compat_probes ORDER BY class").all();
ok(bak.length === 3 && bak[0].verify_probe === "OLD583", "the three old probes are saved for the rollback");
const sql = readFileSync(new URL("./2026-11-05-e-compat-probes.sql", import.meta.url), "utf8");
ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: /m.test(sql) && /^-- BACKUP: /m.test(sql), "migration header lines");
console.log(fail ? fail + " failed" : "all passed"); process.exit(fail ? 1 : 0);
