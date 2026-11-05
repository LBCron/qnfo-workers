// SMART-PLACEMENT-READ-1 migration suite (agent_issues 1000697). Runs migrations/2026-11-05-smart-placement-read-1.sql on node:sqlite against the live layout of
// remediation_contracts, agent_issues and infra_state, and proves: the failed-PATCH probe is replaced once; the new probe reads the snapshot's d1.smart_placement
// (old snapshot shape: says qnfo-infra 1.12.1 is not live; none of the heaviest on smart: x of y; all of them: equals its expected text, which is what passes it);
// the re-read is appended to the issue once; a second apply changes nothing; an unrelated contract is untouched; the Rollback line restores the probe and strips the note.
// Run: node migrations/smart-placement-read-1.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("./2026-11-05-smart-placement-read-1.sql", import.meta.url), "utf8");
const rollback = /^-- Rollback: (.*)$/m.exec(sql)[1];
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };
const one = (db, s, ...a) => db.prepare(s).get(...a);

const OLD = "WITH latest AS (SELECT json_extract(data, '$.d1.smart_placement') AS sp FROM infra_state WHERE id = 'snapshot' ORDER BY ts DESC LIMIT 1), counts AS (SELECT json_array_length(json_extract(sp, '$.top_heavy')) AS top_n, json_array_length(json_extract(sp, '$.patched')) AS patched_n, json_array_length(json_extract(sp, '$.patch_errors')) AS errors_n FROM latest) SELECT top_n || ' patched, 0 errors' AS expected, patched_n || ' patched, ' || errors_n || ' errors' AS observed FROM counts";
function build() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, description TEXT, status TEXT DEFAULT 'open');
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT NOT NULL, verify_transport TEXT NOT NULL, status TEXT DEFAULT 'active', last_verdict TEXT, attempts INTEGER DEFAULT 0, next_due_at TEXT);
CREATE TABLE infra_state (id TEXT, ts TEXT, data TEXT);
`);
  db.prepare("INSERT INTO agent_issues (id, title, description) VALUES (1000697, 'ROADMAP-1: QNFO.INFRA #1: enable Smart Placement', 'code-task: repo=qnfo-workers path=qnfo-infra/worker.js')").run();
  db.prepare("INSERT INTO agent_issues (id, title, description) VALUES (5001, 'other', 'untouched')").run();
  db.prepare("INSERT INTO remediation_contracts (class, issue_id, action, verify_probe, verify_transport, last_verdict, attempts) VALUES ('issue-1000697', 1000697, 'VACUOUS-PROBE-V3-1', ?, 'd1-query', 'fail', 208)").run(OLD);
  db.prepare("INSERT INTO remediation_contracts (class, issue_id, action, verify_probe, verify_transport, last_verdict, attempts) VALUES ('issue-5001', 5001, 'a', 'SELECT 1', 'd1-query', 'fail', 3)").run();
  return db;
}
const snapshot = (db, sp) => { db.exec("DELETE FROM infra_state"); db.prepare("INSERT INTO infra_state (id, ts, data) VALUES ('snapshot', '2026-11-05T01:00:00Z', ?)").run(JSON.stringify({ d1: { smart_placement: sp } })); };
const probe = (db) => db.prepare(one(db, "SELECT verify_probe FROM remediation_contracts WHERE class = 'issue-1000697'").verify_probe).get();

const db = build();
const other0 = JSON.stringify(one(db, "SELECT * FROM remediation_contracts WHERE class = 'issue-5001'"));
db.exec(sql);
const c = one(db, "SELECT * FROM remediation_contracts WHERE class = 'issue-1000697'");
ok(!c.verify_probe.includes("patch_errors") && c.verify_probe.includes("top_heavy_smart"), "the failed-PATCH probe is replaced by one that reads top_heavy_smart");
ok(c.attempts === 0 && c.last_verdict === null && c.verify_transport === "d1-query" && c.action.startsWith("SMART-PLACEMENT-READ-1:"), "the contract is re-armed with a new action text", c);
ok(JSON.stringify(one(db, "SELECT * FROM remediation_contracts WHERE class = 'issue-5001'")) === other0, "an unrelated contract is untouched");
ok(one(db, "SELECT COUNT(*) AS n FROM bak_20261105_smart_placement_read").n === 1, "the old row is kept in the backup table");

// the probe
snapshot(db, { candidates: 40, top_heavy: ["a", "b", "c"], patched: [], patch_errors: [{ name: "a", error: "x" }] });
let r = probe(db);
ok(r.observed.includes("1.12.1 not live") && r.observed !== r.expected, "the old snapshot shape reads as not yet live", r);
snapshot(db, { candidates: 40, top_heavy: ["a", "b", "c"], smart: [], top_heavy_smart: [] });
r = probe(db);
ok(r.observed === "0 of 3 heaviest D1 workers are on smart placement" && r.observed !== r.expected, "none of the heaviest on smart placement fails with the count", r);
snapshot(db, { candidates: 40, top_heavy: ["a", "b", "c"], smart: ["a", "personal-api"], top_heavy_smart: ["a"] });
r = probe(db);
ok(r.observed === "1 of 3 heaviest D1 workers are on smart placement", "a partial rollout reports its progress", r);
snapshot(db, { candidates: 40, top_heavy: ["a", "b", "c"], smart: ["a", "b", "c"], top_heavy_smart: ["a", "b", "c"] });
r = probe(db);
ok(r.observed === r.expected, "every heavy worker on smart placement passes (observed equals expected)", r);
snapshot(db, { candidates: 0, top_heavy: [], smart: [], top_heavy_smart: [] });
r = probe(db);
ok(r.observed !== r.expected, "an empty top list never passes", r);

// the issue note
const d = one(db, "SELECT description FROM agent_issues WHERE id = 1000697").description;
ok(d.startsWith("code-task: repo=qnfo-workers path=qnfo-infra/worker.js") && d.includes("SMART-PLACEMENT-REREAD-1 2026-11-05") && d.includes("no error rise, latency effect unproven"), "the re-read is appended after the code-task line");
ok(one(db, "SELECT description FROM agent_issues WHERE id = 5001").description === "untouched", "another issue is untouched");

// idempotent
const s1 = JSON.stringify([one(db, "SELECT * FROM remediation_contracts WHERE class = 'issue-1000697'"), one(db, "SELECT description FROM agent_issues WHERE id = 1000697")]);
db.exec(sql);
const s2 = JSON.stringify([one(db, "SELECT * FROM remediation_contracts WHERE class = 'issue-1000697'"), one(db, "SELECT description FROM agent_issues WHERE id = 1000697")]);
ok(s1.replace(/"next_due_at":"[^"]*"/, "") === s2.replace(/"next_due_at":"[^"]*"/, ""), "a second apply changes nothing");
ok((one(db, "SELECT description FROM agent_issues WHERE id = 1000697").description.match(/SMART-PLACEMENT-REREAD-1/g) || []).length === 1, "the note is appended once");

// rollback
for (const part of rollback.split(/;\s+(?=UPDATE)/)) db.exec(part);
const rb = one(db, "SELECT * FROM remediation_contracts WHERE class = 'issue-1000697'");
ok(rb.verify_probe === OLD && rb.action === "VACUOUS-PROBE-V3-1", "rollback restores the old probe and action", rb);
ok(one(db, "SELECT description FROM agent_issues WHERE id = 1000697").description === "code-task: repo=qnfo-workers path=qnfo-infra/worker.js", "rollback strips the note");

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
