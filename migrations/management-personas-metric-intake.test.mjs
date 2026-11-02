import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const migration = readFileSync(new URL("./2026-11-02-management-personas-metric-intake.sql", import.meta.url), "utf8");
const workerSrc = readFileSync(new URL("../qnfo-code-orchestrator/worker.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const pair = "management-personas|METRIC-UNMEASURED-1:";
const backupKey = "code_merge_trusted_sources--bak-20261102-mp-metric-intake";
const trustedList = "qnfo-fleet-control|METRIC-TRIGGER-,management-personas|ROADMAP-1:";

const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT, updated_at TEXT);
  CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, source TEXT, title TEXT, status TEXT);
  CREATE TABLE issue_plans (issue_id INTEGER PRIMARY KEY, planned_at TEXT, outcome TEXT, detail TEXT, task_id TEXT, path TEXT, model TEXT, attempts INTEGER DEFAULT 1);
  CREATE TABLE remediation_verifications (id INTEGER PRIMARY KEY, issue_id INTEGER, class TEXT, pass INTEGER, verified_at TEXT);
  CREATE TABLE control_registry (control TEXT PRIMARY KEY, alternate_path TEXT, evidence TEXT, reviewed_at TEXT);
  CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT, root_cause TEXT, remediation TEXT, detector TEXT, probe_class TEXT, first_seen TEXT, issue_id INTEGER, trigger_condition TEXT, symptom TEXT, blast_radius TEXT);
  CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER, expected_cadence_h INTEGER, status TEXT, precondition TEXT, action TEXT, escalate_to TEXT);
  CREATE TABLE capability_ledger (capability TEXT PRIMARY KEY, provenance TEXT, prerequisites TEXT, reliability REAL, acquired_at TEXT, evidence TEXT);
  CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
`);
db.prepare("INSERT INTO ops_config VALUES ('code_merge_trusted_sources', ?, 'existing trust policy', 'before')").run(trustedList);
db.prepare("INSERT INTO control_registry VALUES ('code-merge-trusted-sources', 'none needed', 'existing provenance policy', 'before')").run();

const issue = db.prepare("INSERT INTO agent_issues VALUES (?, ?, ?, ?)");
const plan = db.prepare("INSERT INTO issue_plans VALUES (?, ?, ?, ?, NULL, NULL, NULL, 1)");
const verification = db.prepare("INSERT INTO remediation_verifications VALUES (?, ?, ?, ?, ?)");
const seed = (id, source, title, status, outcome, pass) => {
  issue.run(id, source, title, status);
  plan.run(id, "2026-11-01T10:00:00Z", outcome, `source ${source} is not trusted`);
  if (pass !== null) verification.run(id * 10, id, `issue-${id}`, pass, "2026-11-02T15:00:00Z");
};
seed(1000609, "management-personas", "METRIC-UNMEASURED-1: qnfo-fleet-control has metrics with no value", "open", "untrusted", 1);
seed(1000745, "management-personas", "METRIC-UNMEASURED-1: qnfo-youtube-shorts has metrics with no value", "open", "untrusted", 0);
seed(1000800, "management-personas", "METRIC-UNMEASURED-1: program managers have metrics with no value", "open", "untrusted", 0);
seed(1000801, "management-personas", "METRIC-UNMEASURED-1: no verification exists", "open", "untrusted", null);
seed(1000802, "management-personas", "METRIC-UNMEASURED-1: a closed issue", "closed", "untrusted", 0);
seed(1000803, "management-personas", "METRIC-OTHER-1: unrelated", "open", "untrusted", 0);
seed(1000804, "other-source", "METRIC-UNMEASURED-1: another origin", "open", "untrusted", 0);
seed(1000805, "management-personas", "METRIC-UNMEASURED-1: already planned", "open", "not-code", 0);
seed(1000806, "management-personas", "METRIC-UNMEASURED-1: latest failed verification", "open", "untrusted", 1);
verification.run(10008061, 1000806, "issue-1000806", 0, "2026-11-02T15:01:00Z");

const start = workerSrc.indexOf("const PLAN_TRUSTED_DEFAULT");
const end = workerSrc.indexOf("// PLAN-TRUSTED-FIRST-1", start);
assert.ok(start >= 0 && end > start, "planner trust functions are present in qnfo-code-orchestrator");
const context = vm.createContext({});
vm.runInContext(workerSrc.slice(start, end) + "\nthis.api = { planTrustRules, planTrusted };", context);
const plannerTrusts = (value, source, title) => context.api.planTrusted(source, title, context.api.planTrustRules(value));

assert.equal(plannerTrusts(trustedList, "management-personas", "METRIC-UNMEASURED-1: issue #1"), false);
db.exec(migration);

const config = () => db.prepare("SELECT value FROM ops_config WHERE key = 'code_merge_trusted_sources'").get().value;
const planFor = (id) => db.prepare("SELECT planned_at, outcome, detail FROM issue_plans WHERE issue_id = ?").get(id);
assert.equal(config(), `${trustedList},${pair}`, "only the exact source/title pair is appended");
assert.equal(db.prepare("SELECT value FROM ops_config WHERE key = ?").get(backupKey).value, trustedList);
assert.equal(plannerTrusts(config(), "management-personas", "METRIC-UNMEASURED-1: issue #1"), true);
assert.equal(plannerTrusts(config(), "management-personas", "ROADMAP-1: unrelated"), true, "the existing manager roadmap rule remains");
assert.equal(plannerTrusts(config(), "management-personas", "METRIC-OTHER-1: unrelated"), false);
assert.equal(plannerTrusts(config(), "other-source", "METRIC-UNMEASURED-1: unrelated"), false);

for (const id of [1000745, 1000800, 1000801, 1000806]) {
  assert.equal(planFor(id).planned_at, "2000-01-01T00:00:00Z", `unresolved issue ${id} is re-armed`);
  assert.match(planFor(id).detail, /^MANAGEMENT-PERSONAS-METRIC-INTAKE-1 re-arm/);
  assert.equal(planFor(id).outcome, "untrusted", "the planner, not the migration, decides the next outcome");
}
assert.equal(planFor(1000609).planned_at, "2026-11-01T10:00:00Z", "a latest passing issue probe prevents rearming");
assert.equal(planFor(1000802).planned_at, "2026-11-01T10:00:00Z", "closed issue history is unchanged");
assert.equal(planFor(1000803).planned_at, "2026-11-01T10:00:00Z", "an unrelated title is unchanged");
assert.equal(planFor(1000804).planned_at, "2026-11-01T10:00:00Z", "another source is unchanged");
assert.equal(planFor(1000805).planned_at, "2026-11-01T10:00:00Z", "a non-untrusted plan is unchanged");
assert.equal(db.prepare("SELECT status FROM agent_issues WHERE id = 1000609").get().status, "open", "the original issue is not closed by the migration");

const control = db.prepare("SELECT alternate_path, evidence FROM control_registry WHERE control = 'code-merge-trusted-sources'").get();
assert.equal(control.alternate_path, "none needed");
assert.match(control.evidence, /ALTERNATE-NOT-EXERCISABLE/);
const originalControlEvidence = "existing provenance policy";
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM failure_modes WHERE fm_key = 'management-personas-metric-untrusted'").get().n, 1);
const detector = db.prepare("SELECT verify_probe FROM remediation_contracts WHERE class = 'fm-management-personas-metric-untrusted'").get().verify_probe;
assert.equal(db.prepare(detector).get().observed, "0", "the detector passes after eligible plans are re-armed");
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM capability_ledger WHERE capability = 'management-personas:metric-issue-planner-intake'").get().n, 1);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM decision_log WHERE action LIKE 'MANAGEMENT-PERSONAS-METRIC-INTAKE-1:%'").get().n, 1);

const snapshot = () => JSON.stringify({
  config: db.prepare("SELECT key, value, note, updated_at FROM ops_config ORDER BY key").all(),
  plans: db.prepare("SELECT * FROM issue_plans ORDER BY issue_id").all(),
  control: db.prepare("SELECT * FROM control_registry").all(),
  failures: db.prepare("SELECT * FROM failure_modes").all(),
  contracts: db.prepare("SELECT * FROM remediation_contracts").all(),
  capabilities: db.prepare("SELECT * FROM capability_ledger").all(),
  decisions: db.prepare("SELECT * FROM decision_log").all()
});
const first = snapshot();
db.exec(migration);
assert.equal(snapshot(), first, "reapplying the migration is idempotent");

const rollback = migration.match(/^-- Rollback: (.*)$/m)?.[1];
assert.ok(rollback, "the migration has a rollback");
for (const statement of rollback.split(/;\s*/).filter(Boolean)) db.exec(statement);
assert.equal(config(), trustedList, "rollback restores the original trust list");
for (const id of [1000745, 1000800, 1000801, 1000806]) {
  assert.equal(planFor(id).planned_at, "2026-11-01T10:00:00Z", "rollback restores the original plan timestamp");
  assert.equal(planFor(id).detail, `source management-personas is not trusted`, "rollback restores the original plan detail");
}
const restoredControl = db.prepare("SELECT alternate_path, evidence FROM control_registry WHERE control = 'code-merge-trusted-sources'").get();
assert.equal(restoredControl.alternate_path, "none needed");
assert.equal(restoredControl.evidence, originalControlEvidence, "rollback restores the original control evidence");
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM decision_log WHERE action LIKE 'MANAGEMENT-PERSONAS-METRIC-INTAKE-1:%'").get().n, 1, "the decision log remains append-only");

console.log("management-personas-metric-intake: all passed");
db.close();
