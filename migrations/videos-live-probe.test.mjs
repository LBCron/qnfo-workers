// COMPANION-NO-TYPING-1:videos probe migration suite (agent_issues 1001637). Runs migrations/2026-11-05-videos-live-probe.sql on node:sqlite against the live layout of
// remediation_contracts: the born-superseded probe becomes an active runner probe on the companion page; another contract and another probe text are untouched; a second apply
// changes nothing; the Rollback line restores the old row. Also pins that the marker the probe looks for is in the source the page is built from.
// Run: node migrations/videos-live-probe.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("./2026-11-05-videos-live-probe.sql", import.meta.url), "utf8");
const rollback = /^-- Rollback: (.*)$/m.exec(sql)[1];
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };
const one = (db, s, ...a) => db.prepare(s).get(...a);

const BORN = "SELECT 'closed' AS expected, (SELECT CASE WHEN status IN ('closed', 'resolved') THEN 'closed' ELSE NULL END FROM agent_issues WHERE id = 1001637) AS observed";
const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, action TEXT, verify_probe TEXT NOT NULL, verify_transport TEXT NOT NULL, module TEXT, status TEXT, last_verdict TEXT, attempts INTEGER DEFAULT 0, next_due_at TEXT)");
db.prepare("INSERT INTO remediation_contracts (class, issue_id, action, verify_probe, verify_transport, module, status, last_verdict, attempts) VALUES ('issue-1001637', 1001637, 'VACUOUS-PROBE-V3-1: x', ?, 'd1-query', 'probe-template-v3-generic', 'superseded', 'superseded:closure-observing-probe-at-birth', 0)").run(BORN);
db.prepare("INSERT INTO remediation_contracts (class, issue_id, action, verify_probe, verify_transport, module, status, last_verdict, attempts) VALUES ('issue-1001640', 1001640, 'a', 'SELECT 1', 'd1-query', NULL, 'active', 'fail', 3)").run();
const other0 = JSON.stringify(one(db, "SELECT * FROM remediation_contracts WHERE class = 'issue-1001640'"));
const row0 = JSON.stringify(one(db, "SELECT * FROM remediation_contracts WHERE class = 'issue-1001637'"));

db.exec(sql);
const c = one(db, "SELECT * FROM remediation_contracts WHERE class = 'issue-1001637'");
const p = JSON.parse(c.verify_probe);
ok(c.status === "active" && c.verify_transport === "runner-https" && c.module === "probe-line-sweep-v1" && c.last_verdict === null && c.attempts === 0, "the contract is an active runner probe", c);
ok(p.url === "https://me.q08.org/companion" && p.status === 200 && p.contains === "kind=video", "it reads the companion page for the video link", p);
ok(JSON.stringify(one(db, "SELECT * FROM remediation_contracts WHERE class = 'issue-1001640'")) === other0, "another contract is untouched");
ok(one(db, "SELECT COUNT(*) AS n FROM bak_20261105_videos_live_probe").n === 1, "the old row is backed up");
const s1 = JSON.stringify(one(db, "SELECT class, status, verify_probe, verify_transport FROM remediation_contracts WHERE class = 'issue-1001637'"));
db.exec(sql);
ok(JSON.stringify(one(db, "SELECT class, status, verify_probe, verify_transport FROM remediation_contracts WHERE class = 'issue-1001637'")) === s1, "a second apply changes nothing");
ok(one(db, "SELECT COUNT(*) AS n FROM bak_20261105_videos_live_probe").n === 1 && one(db, "SELECT verify_probe FROM bak_20261105_videos_live_probe").verify_probe === BORN, "the backup still holds the original probe after the second apply");

for (const part of rollback.split(/;\s+(?=UPDATE)/)) db.exec(part);
const rb = one(db, "SELECT * FROM remediation_contracts WHERE class = 'issue-1001637'");
ok(rb.status === "superseded" && rb.verify_probe === BORN && rb.verify_transport === "d1-query" && rb.module === "probe-template-v3-generic" && rb.last_verdict === "superseded:closure-observing-probe-at-birth", "rollback restores the born-superseded row", rb);

// the marker is in the source the page is built from
const src = readFileSync(new URL("../personal-api/companion.js", import.meta.url), "utf8");
ok(src.includes("/now?kind=video&") && src.includes("text:'Watch something'"), "personal-api/companion.js builds the Watch something link");
ok(row0.length > 0, "fixture sanity");

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
