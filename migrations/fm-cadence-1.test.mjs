// FM-CADENCE-1 (2026-11-05, pillar autonomy): standing detectors are never parked beyond the 60-minute freshness window of v_failure_mode_status.
// Replays remediation_contracts with parked fm-/belief- rows, issue rows and a holding row, applies the migration twice and runs the new detector probe.
// Run: node --no-warnings migrations/fm-cadence-1.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const mig = readFileSync(new URL("./2026-11-05-fm-cadence-1.sql", import.meta.url), "utf8");
assert.match(mig, /^-- APPLY-BY: ci$/m);
assert.match(mig, /^-- DB: qnfo-audit$/m);
assert.match(mig, /^-- Rollback: /m);
assert.match(mig, /^-- CAUSE-MAPPED: /m);
const bare = mig.replace(/^--.*$/gm, "");
assert.ok(!/\bDELETE FROM\b|\bDROP\b/i.test(bare), "no destructive statement: the parked due times are kept in the backup table");
assert.ok(!/LIKE\s+'[^']{50,}'/i.test(bare), "no LIKE pattern over 50 bytes (D1 limit)");

const db = new DatabaseSync(":memory:");
db.exec(`
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER, expected_cadence_h INTEGER,
  status TEXT, precondition TEXT NOT NULL DEFAULT '', action TEXT NOT NULL DEFAULT '', escalate_to TEXT NOT NULL DEFAULT '', module TEXT, next_due_at TEXT, last_attempt_at TEXT);
CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT NOT NULL, root_cause TEXT NOT NULL, remediation TEXT NOT NULL, detector TEXT NOT NULL, probe_class TEXT, first_seen TEXT NOT NULL,
  issue_id INTEGER, trigger_condition TEXT, symptom TEXT, blast_radius TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT,
  capability_gain TEXT, predicted_outcome TEXT, surfaces_tested TEXT);
`);
const at = (m) => `datetime('now', '${m >= 0 ? "+" : ""}${m} minutes')`;
const ins = (cls, status, due, att) => db.exec(`INSERT INTO remediation_contracts (class, status, verify_transport, next_due_at, last_attempt_at) VALUES ('${cls}', '${status}', 'd1-query', ${due === null ? "NULL" : at(due)}, ${att === null ? "NULL" : at(att)})`);
ins("fm-parked-a", "active", 105, -1);
ins("fm-parked-b", "active", 95, -10);
ins("belief-parked", "active", 104, -1);
ins("fm-fresh", "active", 18, -4);          // already inside the window: untouched
ins("fm-holding", "holding", 105, -1);      // not active: untouched
ins("fm-nodue", "active", null, null);      // never scheduled: untouched
ins("issue-1234", "active", 105, -1);       // an issue contract keeps its FM-5 back-off
const due = (c) => db.prepare("SELECT next_due_at d FROM remediation_contracts WHERE class = ?").get(c).d;
const minutesAhead = (c) => db.prepare("SELECT (julianday(next_due_at) - julianday('now')) * 1440 m FROM remediation_contracts WHERE class = ?").get(c).m;
const before = { fresh: due("fm-fresh"), holding: due("fm-holding"), issue: due("issue-1234") };

// the probe fails while a standing detector is parked, before the restagger runs
const probeText = (() => {
  const m = mig.match(/'(SELECT ''0'' AS expected[\s\S]*?AS observed)'/);
  assert.ok(m, "the detector probe is in the file");
  return m[1].replace(/''/g, "'");
})();
const parkedReading = db.prepare(probeText).get();
assert.deepEqual({ ...parkedReading }, { expected: "0", observed: "3" }, "three parked standing detectors are counted before the fix");

db.exec(mig);
assert.equal(db.prepare("SELECT COUNT(*) n FROM bak_20261105_fm_cadence_1").get().n, 3, "the backup keeps the three parked due times");
for (const c of ["fm-parked-a", "fm-parked-b", "belief-parked"]) {
  const m = minutesAhead(c);
  assert.ok(m >= -1 && m <= 25.5, c + " is due within 25 minutes, got " + m);
}
assert.equal(due("fm-fresh"), before.fresh, "a detector already inside the window is untouched");
assert.equal(due("fm-holding"), before.holding, "a holding contract is untouched");
assert.equal(due("fm-nodue"), null, "an unscheduled contract is untouched");
assert.equal(due("issue-1234"), before.issue, "an issue contract keeps its FM-5 back-off");

const after = { ...db.prepare(probeText).get() };
assert.deepEqual(after, { expected: "0", observed: "0" }, "the detector reads absent after the restagger: expected equals observed as strings");
assert.ok(!/;/.test(probeText), "the probe has no semicolon (remediation_probe_semicolon_ins would rewrite it)");
assert.ok(!/\b(insert|update|delete|drop|alter|create|replace)\b/i.test(probeText), "the probe is read-only");

db.exec(mig); // idempotent: INSERT OR IGNORE, the decision_log row is guarded, the restagger finds nothing parked
assert.equal(db.prepare("SELECT COUNT(*) n FROM remediation_contracts WHERE class = 'fm-standing-detector-backed-off'").get().n, 1);
assert.equal(db.prepare("SELECT COUNT(*) n FROM failure_modes WHERE fm_key = 'standing-detector-backed-off' AND probe_class = 'fm-standing-detector-backed-off'").get().n, 1);
assert.equal(db.prepare("SELECT COUNT(*) n FROM decision_log WHERE action LIKE 'FM-CADENCE-1:%'").get().n, 1);

// a later writer that parks a detector again is caught by the probe
ins("fm-reparked", "active", 105, -1);
assert.deepEqual({ ...db.prepare(probeText).get() }, { expected: "0", observed: "1" }, "a re-parked standing detector is counted");

console.log("fm-cadence-1: ok");
