// RM-BS-HYPERAGENT-MANAGERS-1 offline suite: replays migrations/2026-11-05-rm-bs-hyperagent-managers-1.sql on node:sqlite.
// Proves: the header opts in; the holdout seals the readings that exist, the frozen trigger config and the population rule; UPDATE and DELETE on the sealed table abort; the judge view is stored
// as its own text; the one proposal carries apply and revert SQL that round-trip and is still 'proposed' (nothing applied); the detector reads ok at birth, broken when the judge view is replaced
// without a reseal and ok again after a version 2 reseal; the follow-up issue's path exists and its anchor occurs once; a replay changes nothing; the Rollback line removes everything.
// Output MUST contain "0 failed" on success.   Run: node migrations/rm-bs-hyperagent-managers-1.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync } from "node:fs";

const root = new URL("../", import.meta.url);
const rd = (rel) => readFileSync(new URL(rel, root), "utf8");
const sql = rd("migrations/2026-11-05-rm-bs-hyperagent-managers-1.sql");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };

const header = sql.split("\n").filter((l) => l.startsWith("--"));
const body = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
ok(header.some((l) => /^-- APPLY-BY: ci\s*$/.test(l)) && header.some((l) => /^-- DB: qnfo-audit\s*$/.test(l)), "header opts in");
const rollback = header.filter((l) => /^-- Rollback:/.test(l));
ok(rollback.length === 1, "exactly one Rollback line");
ok(!/^\s*(DELETE\s+FROM|DROP\s+(TABLE|INDEX|VIEW|TRIGGER))\b/im.test(body), "the body deletes and drops nothing");
ok(!/claude\.ai|anthropic\.com/i.test(sql), "no claude.ai or anthropic.com link");
ok(Array.from(body.matchAll(/LIKE\s+'((?:[^']|'')*)'/gi)).every((m) => Buffer.byteLength(m[1]) <= 50), "every LIKE pattern is at most 50 bytes");
ok(!/INSERT[^;]*\bINTO\s+agent_issues[^;]*\bSELECT\b[^;]*\bFROM\s+agent_issues\b/i.test(body), "no trigger-like write into agent_issues from agent_issues");

const JUDGE = "CREATE VIEW v_metric_trigger_state AS SELECT t.id, t.metric_key, t.threshold FROM analytics_metric_triggers t";
function world() {
  const w = new DatabaseSync(":memory:");
  w.exec(`CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, layer TEXT, kind TEXT, formula TEXT, source_of_truth TEXT, baseline TEXT, target TEXT, owner TEXT, disposition_actor TEXT, refresh_cadence TEXT, warning_band TEXT, kill_band TEXT, last_value TEXT, last_refreshed TEXT, state TEXT, refresh_class TEXT);
CREATE TABLE analytics_metric_triggers (id INTEGER PRIMARY KEY AUTOINCREMENT, metric_key TEXT UNIQUE, title TEXT, source_table TEXT, operator TEXT, threshold REAL, priority INTEGER DEFAULT 5, action TEXT, owner TEXT, queue_target TEXT, cooldown_hours INTEGER DEFAULT 168, enabled INTEGER DEFAULT 1, notes TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT, root_cause TEXT, remediation TEXT, detector TEXT, probe_class TEXT, first_seen TEXT, issue_id INTEGER, trigger_condition TEXT, symptom TEXT, blast_radius TEXT);
CREATE TABLE remediation_contracts (id INTEGER PRIMARY KEY AUTOINCREMENT, class TEXT UNIQUE, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER, escalate_to TEXT, expected_cadence_h INTEGER, status TEXT, module TEXT, next_due_at TEXT);
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, linked_session TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT, outcome_matched INTEGER);`);
  const ins = w.prepare("INSERT INTO metric_registry (metric, layer, kind, target, last_value, last_refreshed) VALUES (?, 'x', ?, ?, ?, '2026-11-05T03:00:00Z')");
  for (const [m, k, t, v] of [["metrics_in_breach", "lagging", "0", "86"], ["remedy_efficacy_30d", "lagging", ">= 0.5", "0.6"], ["open_agent_issues", "leading", "0", "517"], ["issue_drain_ratio_24h", "target", ">= 1.5", "1.064"], ["code_task_success_rate_30d", "leading", ">= 0.6", "0.53"], ["session_execution_ratio_30d", "leading", ">= 0.8", "0.81"], ["mttr_h_7d", "target", "<= 2", "49.8"], ["issue_wontfix_share_7d", "guard", "<= 15", "0.0"], ["remediation_latest_pass_pct_7d", "guard", ">= 80", "72.4"], ["some_other_metric", "x", "", "5"]]) ins.run(m, k, t, v);
  w.exec("INSERT INTO analytics_metric_triggers (id, metric_key, operator, threshold, cooldown_hours, enabled) VALUES (378, 'code_task_success_rate_30d', 'lt', 0.5, 2, 1);");
  w.exec(JUDGE);
  return w;
}
const count = (w, t) => w.prepare("SELECT COUNT(*) n FROM " + t).get().n;
const detector = (w) => { const p = w.prepare("SELECT verify_probe FROM remediation_contracts WHERE class = 'fm-manager-holdout-sealed'").get().verify_probe; const r = w.prepare(p).get(); return r.observed; };

const w = world();
w.exec(body);

const readings = w.prepare("SELECT key, value FROM manager_holdout_v0 WHERE row_kind = 'reading' ORDER BY key").all();
ok(readings.length === 9 && !readings.some((r) => r.key === "some_other_metric"), "nine headline readings sealed, nothing else", readings.map((r) => r.key));
ok(readings.find((r) => r.key === "code_task_success_rate_30d").value === 0.53 && readings.find((r) => r.key === "mttr_h_7d").value === 49.8, "values are copied as numbers");
ok(w.prepare("SELECT value FROM manager_holdout_v0 WHERE row_kind = 'config' AND key = 'analytics_metric_triggers.378.threshold'").get().value === 0.5, "frozen trigger config sealed at 0.5");
ok(/id % 20 = 0/.test(w.prepare("SELECT text_value FROM manager_holdout_v0 WHERE row_kind = 'rule'").get().text_value), "population rule sealed");

let err = "";
try { w.exec("UPDATE manager_holdout_v0 SET value = 1"); } catch (e) { err = String(e.message); }
ok(/sealed/.test(err), "UPDATE on the sealed table aborts", err);
err = "";
try { w.exec("DELETE FROM manager_holdout_v0"); } catch (e) { err = String(e.message); }
ok(/sealed/.test(err), "DELETE on the sealed table aborts", err);
ok(count(w, "manager_holdout_v0") === 11, "eleven sealed rows (9 readings, 1 config, 1 rule)", count(w, "manager_holdout_v0"));

const seal = w.prepare("SELECT version, sql_text FROM manager_scorer_seal WHERE object = 'v_metric_trigger_state'").get();
ok(seal && seal.version === 1 && seal.sql_text === JUDGE, "the judge view is stored as its own text");

const prop = w.prepare("SELECT * FROM manager_evolve_proposals").all();
ok(prop.length === 1 && prop[0].status === "proposed" && prop[0].target_kind === "threshold" && prop[0].decision_log_id === 1, "one proposal, proposed, linked to its decision_log row", prop.map((p) => [p.status, p.decision_log_id]));
ok(w.prepare("SELECT threshold FROM analytics_metric_triggers WHERE id = 378").get().threshold === 0.5, "nothing was applied");
ok(!/issue_wontfix_share_7d|remediation_latest_pass_pct_7d/.test(prop[0].holdout_metrics) && /issue_wontfix_share_7d/.test(prop[0].guard_metrics), "guards are named as guards, not as targets");
w.exec(prop[0].apply_sql);
ok(w.prepare("SELECT threshold FROM analytics_metric_triggers WHERE id = 378").get().threshold === 0.6, "apply_sql moves the threshold to the registry target");
w.exec(prop[0].revert_sql);
ok(w.prepare("SELECT threshold FROM analytics_metric_triggers WHERE id = 378").get().threshold === 0.5, "revert_sql puts it back");
ok(Date.parse(prop[0].evaluate_after) - Date.parse(prop[0].created_at) >= 13 * 86400e3, "evaluation date is at least 13 days out");

ok(detector(w) === "ok", "detector reads ok at birth", detector(w));
w.exec("DROP VIEW v_metric_trigger_state; CREATE VIEW v_metric_trigger_state AS SELECT 1 AS hit");
ok(detector(w) === "broken", "detector reads broken when the judge view is replaced without a reseal");
w.exec("INSERT INTO manager_scorer_seal (object, version, sealed_at, reason, pr, sql_text) SELECT name, 2, '2026-11-06T00:00:00Z', 'reseal in the same migration as the change', '#1', sql FROM sqlite_master WHERE type = 'view' AND name = 'v_metric_trigger_state'");
ok(detector(w) === "ok", "detector reads ok again after a version 2 reseal");
w.exec("DROP TRIGGER manager_holdout_v0_no_delete");
ok(detector(w) === "broken", "detector reads broken when a holdout trigger is gone");

const issue = w.prepare("SELECT title, description FROM agent_issues").get();
const pth = /^code-task: repo=qnfo-workers path=(\S+)$/m.exec(issue.description), anc = /^code-anchor: (.+)$/m.exec(issue.description);
ok(pth && anc && existsSync(new URL(pth[1], root)), "follow-up issue routes to an existing file");
if (pth && anc) ok(rd(pth[1]).split(anc[1]).length - 1 === 1, "its anchor occurs exactly once in " + pth[1]);
ok(/^code-probe: \{.+\}$/m.test(issue.description), "follow-up issue carries a code-probe");

const w2 = world();
w2.exec(body);
const tables = ["manager_holdout_v0", "manager_scorer_seal", "manager_evolve_proposals", "failure_modes", "remediation_contracts", "agent_issues", "decision_log"];
const before = tables.map((t) => count(w2, t));
w2.exec(body);
ok(JSON.stringify(before) === JSON.stringify(tables.map((t) => count(w2, t))), "a replay changes nothing", before);

w2.exec(rollback[0].replace(/^-- Rollback:\s*/, ""));
ok(w2.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name LIKE 'manager_%'").get().n === 0, "Rollback removes the tables and triggers");
ok(w2.prepare("SELECT status FROM remediation_contracts").get().status === "superseded", "Rollback supersedes the detector");

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
