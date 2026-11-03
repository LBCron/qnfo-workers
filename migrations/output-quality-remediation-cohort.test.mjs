// Run: node migrations/output-quality-remediation-cohort.test.mjs
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("./2026-11-03-output-quality-remediation-cohort.sql", import.meta.url), "utf8");
const original = readFileSync(new URL("./2026-10-26-output-quality-ledger.sql", import.meta.url), "utf8");
const oldView = original.match(/CREATE VIEW IF NOT EXISTS v_output_quality_verdict AS[\s\S]*?;/)[0];
const surfaceView = original.match(/CREATE VIEW IF NOT EXISTS v_output_quality_by_surface AS[\s\S]*?;/)[0];
const metric = "remediation_latest_pass_pct_7d";
const db = new DatabaseSync(":memory:");
db.exec(`
CREATE TABLE output_quality_measures (metric TEXT PRIMARY KEY, surface TEXT, role TEXT, polarity INTEGER, tol_rel REAL, tol_abs REAL, judged_by TEXT, caveat TEXT);
CREATE TABLE metric_history (metric TEXT, day TEXT, value REAL, PRIMARY KEY(metric, day));
CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, last_value TEXT, target TEXT);
CREATE TABLE remediation_verifications (id INTEGER PRIMARY KEY, issue_id INTEGER, class TEXT, pass INTEGER, verified_at TEXT);
CREATE INDEX idx_rv_verified_norm ON remediation_verifications(replace(substr(verified_at, 1, 19), 'T', ' '));
CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT, root_cause TEXT, remediation TEXT, detector TEXT, probe_class TEXT, first_seen TEXT, issue_id INTEGER);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER, escalate_to TEXT, expected_cadence_h INTEGER, status TEXT, module TEXT);
CREATE TABLE decision_log (actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
INSERT INTO output_quality_measures VALUES ('${metric}', 'code', 'outcome', 1, 0.05, 2, 'independent probe', 'a probe the fixer wrote can be weak');
INSERT INTO output_quality_measures VALUES ('proxy', 'ask', 'proxy', 1, 0, 0, 'rule', '');
INSERT INTO metric_history VALUES ('${metric}', date('now', '-7 days'), 100), ('${metric}', date('now'), 20), ('proxy', date('now', '-7 days'), 1), ('proxy', date('now'), 2);
INSERT INTO metric_registry VALUES ('${metric}', '20', '>= 80');
${oldView}
${surfaceView}
`);
const verdict = () => db.prepare("SELECT * FROM v_output_quality_verdict WHERE metric = ?").get(metric);
const cohort = () => db.prepare("SELECT * FROM v_output_quality_remediation_cohort").get();
const row = (issue, cls, pass, offset, iso = false) => db.prepare(`
INSERT INTO remediation_verifications (issue_id, class, pass, verified_at)
VALUES (?, ?, ?, strftime(?, 'now', ?))
`).run(issue, cls, pass, iso ? "%Y-%m-%dT12:00:00Z" : "%Y-%m-%d 12:00:00", `${offset} days`);
const reset = () => db.exec("DELETE FROM remediation_verifications");

row(1, "old-class", 1, -8);
row(1, "new-class", 1, -1, true);
for (let i = 2; i <= 5; i++) row(i, "new-contract", 0, -1);
assert.equal(verdict().moved, "worse", "old pool comparison reports a false regression");
const history = db.prepare("SELECT * FROM metric_history ORDER BY metric, day").all();
const guard = db.prepare("SELECT * FROM metric_registry").all();
const proxy = db.prepare("SELECT * FROM v_output_quality_verdict WHERE metric = 'proxy'").get();
db.exec(sql);
assert.equal(verdict().moved, "flat", "new failing subjects cannot change the matched denominator");
assert.equal(cohort().subjects, 1);
assert.equal(cohort().now_value, 100);
assert.deepEqual(db.prepare("SELECT * FROM metric_history ORDER BY metric, day").all(), history, "raw guard history is untouched");
assert.deepEqual(db.prepare("SELECT * FROM metric_registry").all(), guard, "all-subject integrity guard value and target are untouched");
assert.equal(db.prepare("SELECT verdict FROM v_output_quality_by_surface WHERE surface = 'code'").get().verdict, "flat", "dependent surface verdict uses the matched cohort");
assert.deepEqual(db.prepare("SELECT * FROM v_output_quality_verdict WHERE metric = 'proxy'").get(), proxy, "other measures retain their verdict");
db.exec(sql);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM bak_20261103_output_quality_verdict").get().n, 1, "backup survives reapplication");
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM failure_modes").get().n, 1);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 1, "decision is recorded once");
assert.ok(db.prepare("EXPLAIN QUERY PLAN SELECT * FROM v_output_quality_remediation_cohort").all().some(r => r.detail.includes("idx_rv_verified_norm")), "cohort uses the existing normalized timestamp index");
const probe = db.prepare("SELECT verify_probe FROM remediation_contracts").get().verify_probe;
assert.equal(db.prepare(probe).get().status, "ok");

row(1, "new-class", 0, -1);
assert.equal(verdict().moved, "worse", "latest failed re-probe still exposes a genuine relapse");
assert.equal(db.prepare("SELECT verdict FROM v_output_quality_by_surface WHERE surface = 'code'").get().verdict, "regressing", "surface still reports genuine relapse");
row(1, "new-class", 1, -1);
assert.equal(verdict().moved, "flat", "latest recovery supersedes failed attempts");

reset();
row(null, "contract", 0, -8);
row(null, "contract", 1, -1);
row(9, "dropped-subject", 1, -8);
assert.equal(verdict().moved, "better", "class-only subjects match and dropped subjects do not bias the trend");
assert.equal(cohort().subjects, 1);
row(1, "ignored", 0, -8);
row(1, "ignored", 0, -1);
row(null, "1", 1, -8);
row(null, "1", 1, -1);
row(null, null, 1, -8);
row(null, null, 0, -1);
assert.equal(cohort().subjects, 3, "issue IDs and class names cannot collide; anonymous rows are not subjects");

reset();
for (let i = 1; i <= 50; i++) {
  row(i, "contract", 1, -8);
  row(i, "contract", i <= 2 ? 0 : 1, -1);
}
assert.equal(verdict().moved, "flat", "four-point fall remains inside the unchanged five-percent tolerance");
row(3, "contract", 0, -1);
assert.equal(verdict().moved, "worse", "six-point fall crosses the existing tolerance");

reset();
row(1, "contract", 1, -7);
row(1, "contract", 0, -6, true);
row(1, "contract", 1, -14);
row(1, "contract", 1, 1);
assert.equal(verdict().moved, "worse", "boundary days enter exactly one window; outside rows are excluded");
reset();
row(1, "contract", 1, -8);
row(2, "contract", 0, -1);
assert.equal(verdict().moved, "insufficient_history", "disjoint cohorts never fall back to the pool");
assert.equal(cohort().now_value, null);
reset();
assert.equal(verdict().moved, "insufficient_history", "empty verifications are not a pass");

db.exec("DELETE FROM metric_history WHERE metric = 'remediation_latest_pass_pct_7d'");
assert.equal(verdict().moved, "insufficient_history", "no snapshot supplies no comparison");
db.exec(`INSERT INTO metric_history VALUES ('${metric}', date('now', '-3 days'), 20)`);
row(1, "contract", 1, -11);
row(1, "contract", 0, -4);
assert.equal(verdict().moved, "stale", "old snapshot cannot claim a current regression or recovery");

db.exec(sql.match(/^-- Rollback: (.+)$/m)[1]);
assert.equal(db.prepare(probe).get().status, "missing", "detector notices removal of the cohort comparison");
assert.equal(db.prepare("SELECT caveat FROM output_quality_measures WHERE metric = ?").get(metric).caveat, "a probe the fixer wrote can be weak");
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM remediation_contracts").get().n, 0);
db.close();
console.log("OUTPUT-QUALITY-REMEDIATION-COHORT-1: all assertions passed");
