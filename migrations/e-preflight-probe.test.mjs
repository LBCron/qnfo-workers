// PREFLIGHT-PROBE-REAL-1 offline suite. Run: node migrations/e-preflight-probe.test.mjs
// The closing probe of PUBLICATION-PREFLIGHT-FAIL-Q08 must read what the preflight records, and must fail while the surface is down.
import { DatabaseSync } from "node:sqlite"; import { readFileSync } from "node:fs";
const db = new DatabaseSync(":memory:");
db.exec(`CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, verify_probe TEXT, verify_transport TEXT, status TEXT, attempts INTEGER, last_verdict TEXT, deferred_since TEXT, next_due_at TEXT);
INSERT INTO remediation_contracts VALUES ('issue-1001359', 1001359, 'OLD', 'd1-query', 'active', 64, 'probe-error', NULL, NULL), ('issue-1', 1, 'KEEP', 'd1-query', 'active', 0, NULL, NULL, NULL);
CREATE TABLE cloud_ops_events (id TEXT PRIMARY KEY, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT);`);
let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.log("FAIL " + m); } };
const sql = readFileSync(new URL("./2026-11-05-e-preflight-probe.sql", import.meta.url), "utf8");
db.exec(sql);
const probe = () => db.prepare(db.prepare("SELECT verify_probe p FROM remediation_contracts WHERE class = 'issue-1001359'").get().p).get();
const iso = (hAgo) => new Date(Date.now() - hAgo * 36e5).toISOString();
const ev = db.prepare("INSERT INTO cloud_ops_events (id, ts, kind, text, status) VALUES (?, ?, ?, ?, ?)");
ok(probe().expected === "ok" && probe().observed !== "ok", "no preflight event is not a pass");
ev.run("a", iso(26), "publication_preflight", "q08 ok", "ok"); ok(probe().observed !== "ok", "an ok event 26 hours old is not a pass");
ev.run("b", iso(1), "publication_preflight", "q08 ok", "ok"); ok(probe().observed === "ok", "an ok event 1 hour old passes: " + JSON.stringify(probe()));
ev.run("c", iso(0.2), "publication_preflight", "q08 FAIL", "error"); ok(probe().observed !== "ok", "the newest event failing is not a pass");
ev.run("d", iso(0.1), "publication_preflight", "q08 ok", "ok"); ok(probe().observed === "ok", "recovery passes again");
ev.run("e", iso(0.05), "publication_preflight", "other FAIL", "error"); ok(probe().observed === "ok", "another surface's failure does not hide q08");
ev.run("f", iso(0.01), "publication_preflight_recovered", "q08 recovered", "ok"); ok(probe().observed === "ok", "the recovered event is another kind and is ignored");
const c = db.prepare("SELECT status, attempts, last_verdict, verify_transport FROM remediation_contracts WHERE class = 'issue-1001359'").get();
ok(c.status === "active" && c.attempts === 0 && c.last_verdict === null && c.verify_transport === "d1-query", "the contract is re-armed");
ok(db.prepare("SELECT verify_probe p FROM remediation_contracts WHERE class = 'issue-1'").get().p === "KEEP", "no other contract changes");
ok(db.prepare("SELECT verify_probe p FROM bak_20261105_e_preflight_probe").get().p === "OLD", "the old probe is saved");
ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: /m.test(sql) && /^-- BACKUP: /m.test(sql), "migration header lines");
console.log(fail ? fail + " failed" : "all passed"); process.exit(fail ? 1 : 0);
