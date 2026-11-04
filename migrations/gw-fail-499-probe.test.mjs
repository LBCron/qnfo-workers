// GW-FAIL-STATUS-SCOPE-1 offline suite: replays migrations/2026-11-05-gw-fail-499-probe.sql on SQLite and runs the probe it writes against fixtures.
// Proves: the probe returns the literal ok when the model's 499 rows are all client-closed (400 and 504 rows of the same model do not count) and the
// ledger row is resolved; a 499 of class other, or an open ledger row gwfail:3892c147, makes it read a reason instead; a 499 older than 24 hours does not
// count; a client-closed 499 never makes it fail; the contract is reset for the consumer (attempts 0, no verdict). No live state is read.
// Run: node migrations/gw-fail-499-probe.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("./2026-11-05-gw-fail-499-probe.sql", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 300))); } };

function fresh() {
  const d = new DatabaseSync(":memory:");
  d.exec(`
CREATE TABLE ai_gateway_failures (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, model TEXT, status INTEGER, count INTEGER, error_class TEXT, sample_detail TEXT, source TEXT);
CREATE TABLE issue_ledger (fingerprint TEXT PRIMARY KEY, title TEXT, status TEXT);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, verify_probe TEXT, verify_transport TEXT, status TEXT, attempts INTEGER, last_verdict TEXT, next_due_at TEXT);
INSERT INTO remediation_contracts VALUES ('issue-1001463', 1001463, 'old', 'd1-query', 'active', 115, 'fail', '2026-11-04 22:00:00');
INSERT INTO issue_ledger VALUES ('gwfail:3892c147', '[gw-fail] 499 dynamic/value', 'resolved');
`);
  d.exec(sql);
  return d;
}
const now = Date.now();
const add = (d, hoursAgo, status, cls) => d.prepare("INSERT INTO ai_gateway_failures (ts, model, status, count, error_class, source) VALUES (?, 'dynamic/value', ?, 1, ?, 'qnfo-ai-calibration')").run(now - hoursAgo * 3600 * 1000, status, cls);
const observed = (d) => { const c = d.prepare("SELECT verify_probe FROM remediation_contracts WHERE class = 'issue-1001463'").get(); const r = d.prepare(c.verify_probe).get(); return r; };

{
  const d = fresh();
  const c = d.prepare("SELECT verify_probe, verify_transport, attempts, last_verdict FROM remediation_contracts WHERE class = 'issue-1001463'").get();
  ok(c.verify_probe !== "old" && c.verify_transport === "d1-query" && c.attempts === 0 && c.last_verdict === null, "the contract holds the new probe and is reset", c);
  add(d, 1, 400, "other"); add(d, 1, 504, "upstream"); add(d, 1, 499, "client-closed"); add(d, 2, 499, "client-closed");
  const r = observed(d);
  ok(r.expected === "ok" && r.observed === "ok" && r.expected === r.observed, "client-closed 499 rows and the model's 400 and 504 rows do not fail the probe", r);
}
{
  const d = fresh();
  add(d, 3, 499, "other");
  const r = observed(d);
  ok(r.expected === "ok" && r.observed !== "ok" && /still counted/.test(r.observed), "a 499 of class other in the last 24 hours keeps it failing", r);
}
{
  const d = fresh();
  add(d, 30, 499, "other");
  const r = observed(d);
  ok(r.observed === "ok", "a class-other 499 older than 24 hours no longer counts", r);
}
{
  const d = fresh();
  d.exec("UPDATE issue_ledger SET status = 'open' WHERE fingerprint = 'gwfail:3892c147'");
  const r = observed(d);
  ok(r.observed !== "ok" && /ledger row is still open/.test(r.observed), "an open ledger row keeps it failing", r);
}
{
  const d = fresh();
  d.exec("DELETE FROM issue_ledger");
  ok(observed(d).observed === "ok", "no ledger row at all is a pass (nothing open)");
}
{
  const d = new DatabaseSync(":memory:");
  d.exec("CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, verify_probe TEXT, verify_transport TEXT, status TEXT, attempts INTEGER, last_verdict TEXT, next_due_at TEXT); INSERT INTO remediation_contracts VALUES ('issue-1001463', 1001463, 'kept', 'd1-query', 'superseded', 3, 'fail', 'x');");
  d.exec(sql);
  ok(d.prepare("SELECT verify_probe FROM remediation_contracts").get().verify_probe === "kept", "a superseded contract is left alone");
}
{
  const d = fresh();
  const before = d.prepare("SELECT verify_probe FROM remediation_contracts").get().verify_probe;
  d.exec(sql);
  ok(d.prepare("SELECT verify_probe FROM remediation_contracts").get().verify_probe === before, "a second apply leaves the probe as it is");
  ok(/^-- Rollback: UPDATE remediation_contracts SET verify_probe/m.test(sql) && /^-- BACKUP: remediation_contracts/m.test(sql), "header names Rollback and BACKUP");
}
console.log("gw-fail-499-probe: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
