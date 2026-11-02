// TRIGGER-RECOVERY-1: a METRIC-TRIGGER issue closes itself, with close_evidence, after its cadence-specific recovery hold;
// a breach during the streak ends it. Runs the real
// evaluateMetricTriggers against an in-memory D1 (node:sqlite). Also checks the publication preflight and calibrator fixes.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { DatabaseSync } from "node:sqlite";
const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "worker.js"), "utf8");
const cut = (a, b) => src.slice(src.indexOf(a), src.indexOf(b));
const code = cut("// ---- ACT-BRIDGE-1:BEGIN", "// ---- ACT-BRIDGE-1:END") +
  cut("async function closeBlockedByContract(env, issueId, database) {", "async function improvementLoopTick(env)") +
  cut("async function evaluateMetricTriggers(env)", "__name(evaluateMetricTriggers") +
  cut("async function metricTriggerValue(db, t)", "__name(metricTriggerValue") +
  (src.indexOf("function triggerNum(") >= 0 ? "\n" + src.slice(src.indexOf("function triggerNum("), src.indexOf("\n}\n", src.indexOf("function triggerNum(")) + 3) : "");
const errors = [];
const sb = { console: { error: (message) => errors.push(String(message)) }, Date, JSON, Math, Number, String, isFinite };
vm.createContext(sb);
vm.runInContext(code + "\n__x = { evaluateMetricTriggers, metricTriggerValue, triggerRecoveryDue, triggerRecoveryHoldMin, TRIGGER_RECOVERY_MIN };", sb);
const { evaluateMetricTriggers, metricTriggerValue, triggerRecoveryDue, triggerRecoveryHoldMin, TRIGGER_RECOVERY_MIN } = sb.__x;

const sq = new DatabaseSync(":memory:");
sq.exec(`CREATE TABLE analytics_metric_triggers (id INTEGER PRIMARY KEY, metric_key TEXT, title TEXT, source_table TEXT, operator TEXT, threshold REAL, priority TEXT, action TEXT, owner TEXT, queue_target TEXT, cooldown_hours INTEGER, enabled INTEGER);
CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, last_value TEXT, refresh_cadence TEXT);
CREATE TABLE analytics_dash_records (metric TEXT, value TEXT); CREATE TABLE analytics_dash_meta (key TEXT, value TEXT);
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER, close_channel TEXT);
CREATE VIEW v_issue_age_ladder AS SELECT id, title, CASE WHEN status = 'open' THEN 1 ELSE 0 END AS breach FROM agent_issues;
CREATE TABLE issue_triage (issue_id INTEGER PRIMARY KEY, rc TEXT, triage_state TEXT, owner TEXT, sla_due_at TEXT, close_evidence TEXT);
CREATE TABLE remediation_contracts (issue_id INTEGER, status TEXT, last_verdict TEXT);
CREATE TABLE analytics_action_log (id INTEGER PRIMARY KEY AUTOINCREMENT, trigger_id INTEGER, fired_at TEXT, metric_value REAL, action TEXT, queue_target TEXT, status TEXT, notes TEXT);
CREATE TABLE alerts (source TEXT, level TEXT, message TEXT, digested TEXT);
CREATE TRIGGER issue_close_evidence_required BEFORE UPDATE OF status ON agent_issues
WHEN NEW.status IN ('closed','resolved') AND OLD.status NOT IN ('closed','resolved')
BEGIN
  SELECT RAISE(ABORT,'close-without-evidence')
    WHERE NOT EXISTS (SELECT 1 FROM issue_triage t WHERE t.issue_id = NEW.id AND t.close_evidence IS NOT NULL AND TRIM(t.close_evidence) <> '');
  SELECT RAISE(ABORT,'close-while-contract-fails')
    WHERE EXISTS (SELECT 1 FROM remediation_contracts c WHERE c.issue_id = NEW.id
      AND c.status IN ('active','holding')
      AND COALESCE(c.last_verdict,'') IN ('fail','vacuous-probe-result','probe-error','probe-not-machine-executable','probe-same-account-host'));
END;
INSERT INTO analytics_metric_triggers VALUES (7, 'ask_error_rate_7d', 'Ask errors high', 'meta', 'gt', 0.1, '7', 'Pillar reach. Fix ask errors.', 'qnfo-ai-search', 'agent_issues', 24, 1);
INSERT INTO analytics_metric_triggers VALUES (8, 'digest_x', 'Digest only', 'meta', 'gt', 1, 'low', 'note', 'x', 'alerts', 24, 1);
INSERT INTO analytics_metric_triggers VALUES (9901, 'issues_over_24h_no_doer', 'No-doer issues', 'registry', 'gt', 0, 'critical', 'Pillar autonomy.', 'qnfo-fleet-control', 'agent_issues', 1, 1);
INSERT INTO metric_registry VALUES ('ask_error_rate_7d', '0.2', '10m'), ('digest_x', '0', '10m'), ('issues_over_24h_no_doer', '1', '10m');`);
const d1 = { prepare(sql0) { const order = []; const sql = sql0.replace(/\?(\d+)/g, (m, n) => { order.push(+n - 1); return "?"; }); let a = [];
  const st = { bind(...x) { a = order.length ? order.map((i) => x[i]) : x; return st; },
    async first() { return sq.prepare(sql).get(...a) ?? null; }, async all() { return { results: sq.prepare(sql).all(...a) }; }, async run() { sq.prepare(sql).run(...a); return {}; } }; return st; } };
const env = { AUDIT: d1 };
let fails = 0;
const check = (c, m, d) => { console.log((c ? "PASS " : "FAIL ") + m + (c || d === undefined ? "" : " :: " + JSON.stringify(d))); if (!c) fails++; };
const issues = () => sq.prepare("SELECT id, status FROM agent_issues WHERE title LIKE 'METRIC-TRIGGER-7-%'").all();
const log = (st, triggerId = 7) => sq.prepare("SELECT COUNT(*) n FROM analytics_action_log WHERE trigger_id=? AND status=?").get(triggerId, st).n;
const noDoerLog = (st) => sq.prepare("SELECT COUNT(*) n FROM analytics_action_log WHERE trigger_id=9901 AND status=?").get(st).n;
const actionLog = (action, triggerId = 7) => sq.prepare("SELECT COUNT(*) n FROM analytics_action_log WHERE trigger_id=? AND action=?").get(triggerId, action).n;
const ageStreak = (min) => sq.prepare("UPDATE analytics_action_log SET fired_at = datetime('now', ?) WHERE trigger_id=7 AND status='recovering'").run("-" + min + " minutes");

check(triggerRecoveryDue("2026-10-02 08:00:00", Date.parse("2026-10-02T09:00:00Z"), 60) === true, "60 minutes after the streak opened, recovery is due");
check(triggerRecoveryDue("2026-10-02 08:30:00", Date.parse("2026-10-02T09:00:00Z"), 60) === false, "30 minutes is not enough");
check(triggerRecoveryDue(null, Date.now(), 60) === false && triggerRecoveryDue("garbage", Date.now(), 60) === false, "no streak or an unreadable time never closes");
check(TRIGGER_RECOVERY_MIN >= 60, "the recovery window is at least an hour");
check(triggerRecoveryHoldMin("10m") === 60 && triggerRecoveryHoldMin("*/10") === 60, "10-minute cadences keep the 60-minute floor");
check(triggerRecoveryHoldMin("1h") === 120 && triggerRecoveryHoldMin("hourly") === 120 && triggerRecoveryHoldMin("2h") === 120, "hourly and slower cadences cap at 120 minutes");
check(triggerRecoveryHoldMin("unknown") === 120 && triggerRecoveryHoldMin(null) === 120, "unknown cadences use the 60-minute fallback before the cap");
check(triggerRecoveryDue("2026-10-02 08:00:00", Date.parse("2026-10-02T09:30:00Z"), triggerRecoveryHoldMin("1h")) === false, "an hourly metric is not recovered after 90 minutes");
check(triggerRecoveryDue("2026-10-02 08:00:00", Date.parse("2026-10-02T10:05:00Z"), triggerRecoveryHoldMin("1h")) === true, "an hourly metric is recovered after 125 minutes");

await evaluateMetricTriggers(env);
check(issues().length === 1 && issues()[0].status === "open", "a breach files one open issue");
sq.prepare("UPDATE metric_registry SET last_value='0.05' WHERE metric='ask_error_rate_7d'").run();
await evaluateMetricTriggers(env);
check(issues()[0].status === "open" && log("recovering") === 1, "the first recovered tick opens a streak and closes nothing");
await evaluateMetricTriggers(env);
check(issues()[0].status === "open" && log("recovering") === 1, "a second tick inside the window keeps the issue open and does not open a second streak");
ageStreak(30); await evaluateMetricTriggers(env);
check(issues()[0].status === "open", "30 minutes into the streak the issue is still open");
// relapse: breach again inside the cooldown, then recover again
sq.prepare("UPDATE metric_registry SET last_value='0.3' WHERE metric='ask_error_rate_7d'").run();
await evaluateMetricTriggers(env);
check(log("relapsed") === 1 && issues().length === 1, "a breach during the streak writes 'relapsed' and files no duplicate (cooldown)");
sq.prepare("UPDATE metric_registry SET last_value='0.05' WHERE metric='ask_error_rate_7d'").run();
ageStreak(120); await evaluateMetricTriggers(env);
check(issues()[0].status === "open", "after a relapse the old streak no longer counts (would otherwise close at once)");
check(log("recovering") === 2, "recovery after a relapse opens a new streak");
sq.prepare("UPDATE analytics_action_log SET fired_at = datetime('now','-60 minutes') WHERE trigger_id=7 AND status='recovering' AND id = (SELECT MAX(id) FROM analytics_action_log WHERE trigger_id=7 AND status='recovering')").run();
const issueId = issues()[0].id;
sq.prepare("INSERT INTO remediation_contracts (issue_id, status, last_verdict) VALUES (?, 'active', 'fail')").run(issueId);
const deferred = await evaluateMetricTriggers(env);
check(issues()[0].status === "open" && deferred.close_deferred === 1 && errors.length === 0, "a failing active contract defers recovery without attempting a guarded close", { issue: issues()[0], deferred, errors });
check(log("recovered") === 0 && log("recovering") === 3 && actionLog("recovery close deferred") === 1, "the deferred close is recorded once without ending the recovery streak");
await evaluateMetricTriggers(env);
check(actionLog("recovery close deferred") === 1 && errors.length === 0, "repeated ticks do not duplicate the deferral or emit a constraint error");
sq.prepare("UPDATE remediation_contracts SET last_verdict='pass' WHERE issue_id=?").run(issueId);
const recovered = await evaluateMetricTriggers(env);
const tri = sq.prepare("SELECT * FROM issue_triage WHERE issue_id=?").get(issueId);
check(issues()[0].status === "closed", "a 10-minute metric closes after 60 minutes of recovery", issues());
check(tri && tri.triage_state === "closed" && /TRIGGER-RECOVERY-1 .*ask_error_rate_7d=0.05 no longer gt 0.1/.test(tri.close_evidence), "it closes with close_evidence naming the value and threshold", tri);
check(log("recovered") === 1 && recovered.recovered && recovered.recovered[0].id === 7, "the close is logged and reported after the contract passes");
await evaluateMetricTriggers(env);
check(log("recovering") === 3 && log("recovered") === 1 && errors.length === 0, "with no open issue, a recovered metric writes nothing more");
check(sq.prepare("SELECT COUNT(*) n FROM analytics_action_log WHERE trigger_id=8").get().n === 0, "a digest-only trigger never opens recovery streaks");

const noDoerRecoveryStarts = actionLog("recovery streak opened", 9901);
sq.prepare("INSERT INTO agent_issues (title, source, category, priority, status, created_at, updated_at) VALUES ('METRIC-TRIGGER-9800-OTHER: another alert', 'qnfo-fleet-control', 'reliability', 'critical', 'open', 1, 1)").run();
const otherId = sq.prepare("SELECT id FROM agent_issues WHERE title LIKE 'METRIC-TRIGGER-9800-%'").get().id;
const noDoer = sq.prepare("SELECT * FROM analytics_metric_triggers WHERE id = 9901").get();
check(await metricTriggerValue(d1, noDoer) === 1, "the no-doer trigger excludes only its own notice and counts another trigger's open notice");
await evaluateMetricTriggers(env);
check(issues().length === 1 && actionLog("recovery streak opened") === 2 && actionLog("recovery streak opened", 9901) === noDoerRecoveryStarts, "another open trigger notice prevents no-doer recovery");
const noDoerIssue = sq.prepare("SELECT id, status FROM agent_issues WHERE title LIKE 'METRIC-TRIGGER-9901-%' AND status='open' ORDER BY id LIMIT 1").get();
check(noDoerIssue && noDoerLog("relapsed") === 1, "another open trigger notice ends the no-doer recovery streak");
sq.prepare("INSERT INTO issue_triage (issue_id, rc, triage_state, owner, sla_due_at, close_evidence) VALUES (?, 'test-cleanup', 'closed', 'test', datetime('now'), 'synthetic issue cleanup')").run(otherId);
sq.prepare("UPDATE agent_issues SET status = 'closed', close_channel = 'session:trigger-recovery-test' WHERE id = ?").run(otherId);
await evaluateMetricTriggers(env);
check(sq.prepare("SELECT status FROM agent_issues WHERE title LIKE 'METRIC-TRIGGER-9901-%'").get().status === "open" && actionLog("recovery streak opened", 9901) === noDoerRecoveryStarts + 1, "the self-notice starts recovery only after other breaches clear");
check(sq.prepare("SELECT status FROM agent_issues WHERE title LIKE 'METRIC-TRIGGER-9901-%'").get().status === "open" && noDoerLog("recovering") === 2, "the self-notice starts a new recovery streak after other breaches clear");
sq.prepare("UPDATE analytics_action_log SET fired_at = datetime('now','-61 minutes') WHERE trigger_id=9901 AND status='recovering'").run();
await evaluateMetricTriggers(env);
const self = sq.prepare("SELECT * FROM agent_issues WHERE title LIKE 'METRIC-TRIGGER-9901-%'").get();
const selfEvidence = sq.prepare("SELECT close_evidence FROM issue_triage WHERE issue_id=?").get(self.id);
check(self.status === "closed" && self.close_channel === "auto:fleet-control/metric-trigger-recovered", "the self-referential no-doer alert closes after its own metric clears", self);
check(selfEvidence && /issues_over_24h_no_doer=0 no longer gt 0/.test(selfEvidence.close_evidence), "self-alert closure carries evidence from the non-circular count", selfEvidence);

sq.prepare("INSERT INTO analytics_metric_triggers VALUES (9, 'hourly_recovery', 'Hourly recovery', 'registry', 'gt', 0.1, 'medium', 'note', 'x', 'agent_issues', 24, 1)").run();
sq.prepare("INSERT INTO metric_registry VALUES ('hourly_recovery', '0.2', '1h')").run();
await evaluateMetricTriggers(env);
sq.prepare("UPDATE metric_registry SET last_value='0.05' WHERE metric='hourly_recovery'").run();
await evaluateMetricTriggers(env);
const hourlyIssue = () => sq.prepare("SELECT id, status FROM agent_issues WHERE title LIKE 'METRIC-TRIGGER-9-%'").get();
const ageHourlyStreak = (min) => sq.prepare("UPDATE analytics_action_log SET fired_at = datetime('now', ?) WHERE trigger_id=9 AND status='recovering'").run("-" + min + " minutes");
ageHourlyStreak(90);
await evaluateMetricTriggers(env);
check(hourlyIssue().status === "open" && log("recovering", 9) === 1, "an hourly metric's issue stays open after 90 minutes of recovery", hourlyIssue());
ageHourlyStreak(125);
await evaluateMetricTriggers(env);
check(hourlyIssue().status === "closed" && log("recovered", 9) === 1, "an hourly metric's issue closes after 125 minutes of recovery", hourlyIssue());

const pp = cut("async function publicationPreflight(env)", "__name(publicationPreflight");
check(/sok && open[\s\S]*INSERT INTO issue_triage[\s\S]*close_evidence[\s\S]*UPDATE agent_issues SET status='closed'/.test(pp), "the publication preflight closes its own issue with evidence on recovery");
check(/if \(cron === "30 3 \* \* 1"\) type = "stress"/.test(src) && src.indexOf('{"cron": "30 3 * * 1", "periodMin": 10080, "retry": true}') > 0, "the calibrator's stress key matches the declared Monday cron");
console.log(fails + " failure(s)");
process.exit(fails ? 1 : 0);
