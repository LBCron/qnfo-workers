// ISSUE-HYGIENE-7 / D1-OVERLOAD-FOLD-1 offline suite: migrations/2026-11-04-issue-hygiene-d1-overload-supersede.sql adds the rule d1-overload-superseded to the hourly workflow issue-meta-fold and runs it once.
// While the umbrella issue ("CF-OBS-ISSUE-1: fleet: D1 DB is overloaded, all workers [cf-obs:d1-overload]", filed by scripts/cf_obs_issue_bridge.py) is open, every other open CF-OBS-ISSUE-1, LOOP-BREAKER-1 or
// [fleet] issue whose TITLE says "D1 DB is overloaded" or "D DB is overloaded" is closed with the evidence "superseded by <umbrella id>: one shared-database condition, tracked once (D1-OVERLOAD-FOLD-1)".
// Proves, on five of the live close-guard triggers replayed in node:sqlite:
//  * umbrella absent (or closed): the file and the hourly run close nothing; the workflow still gains the rule;
//  * umbrella present: the overload issues of all three prefixes and both spellings close with ledger rows, the successor id, the channel and the evidence; their contracts are superseded;
//  * other D1 errors (no such column, UNIQUE, CPU time limit, storage timeout), an overload text in another title prefix, an overload text only in the body and an already closed issue are untouched; so is the umbrella;
//  * a second apply and a second run change nothing (the definition is not given the rule twice); an umbrella that appears later folds the issues on the next hourly run;
//  * the Rollback line restores the previous steps; the file adds no trigger and no DELETE or DROP; the live statements of the workflow are kept in order behind the new first step.
// Run: node --no-warnings migrations/issue-hygiene-d1-overload.test.mjs   -> prints "N passed, 0 failed"
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const here = (f) => new URL("./" + f, import.meta.url);
const sql1 = readFileSync(here("2026-10-26-issue-hygiene-1.sql"), "utf8");
const sql2 = readFileSync(here("2026-10-26-issue-hygiene-2.sql"), "utf8");
const sql3 = readFileSync(here("2026-10-26-issue-hygiene-3.sql"), "utf8");
// H7_MIGRATION points the suite at a mutated copy of the migration (mutation checks); unset, it reads the merged file.
const sql7 = readFileSync(process.env.H7_MIGRATION ? resolve(process.env.H7_MIGRATION) : here("2026-11-04-issue-hygiene-d1-overload-supersede.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };
const one = (db, s, ...a) => db.prepare(s).get(...a);
const rollback = /^-- Rollback: (.*)$/m.exec(sql7)[1];
const UMB = "CF-OBS-ISSUE-1: fleet: D1 DB is overloaded, all workers [cf-obs:d1-overload]";

const TRIGGERS = [
  `CREATE TRIGGER issue_close_evidence_required BEFORE UPDATE OF status ON agent_issues
WHEN NEW.status IN ('closed','resolved','wontfix') AND OLD.status NOT IN ('closed','resolved','wontfix')
BEGIN
  SELECT RAISE(ABORT,'close-without-evidence') WHERE NOT EXISTS (SELECT 1 FROM issue_triage t WHERE t.issue_id = NEW.id AND t.close_evidence IS NOT NULL AND TRIM(t.close_evidence) <> '');
  SELECT RAISE(ABORT,'close-while-contract-fails') WHERE NEW.status IN ('closed','resolved') AND EXISTS (SELECT 1 FROM remediation_contracts c WHERE c.issue_id = NEW.id AND c.status IN ('active','holding') AND COALESCE(c.last_verdict,'') IN ('fail','vacuous-probe-result','probe-error','probe-not-machine-executable','probe-same-account-host'));
END`,
  `CREATE TRIGGER issue_lifecycle_au AFTER UPDATE OF status ON agent_issues WHEN COALESCE(OLD.status, '') <> COALESCE(NEW.status, '')
BEGIN INSERT INTO issue_lifecycle (issue_id, event, from_status, to_status, has_evidence) VALUES (NEW.id, CASE WHEN NEW.status IN ('closed', 'resolved', 'wontfix') THEN 'dispositioned' ELSE 'reopened' END, OLD.status, NEW.status, CASE WHEN EXISTS (SELECT 1 FROM issue_triage t WHERE t.issue_id = NEW.id AND t.close_evidence IS NOT NULL AND TRIM(t.close_evidence) <> '') THEN 1 ELSE 0 END); END`,
  `CREATE TRIGGER triage_close_sync_issue_upd AFTER UPDATE OF triage_state ON issue_triage WHEN NEW.triage_state IN ('closed','closed-refuted','wontfix') BEGIN UPDATE agent_issues SET status = CASE WHEN NEW.triage_state='wontfix' THEN 'wontfix' ELSE 'closed' END, close_channel = COALESCE(close_channel, 'auto:triage-sync' || CASE WHEN COALESCE(NEW.owner, '') <> '' THEN ':' || NEW.owner ELSE '' END), updated_at = CAST(strftime('%s','now') AS INTEGER)*1000 WHERE id = NEW.issue_id AND status='open'; END`, // the live text of 2026-10-26 (it also sets close_channel)
  `CREATE TRIGGER triage_superseded_contracts_upd AFTER UPDATE OF triage_state, close_evidence ON issue_triage
WHEN NEW.triage_state = 'closed' AND (lower(substr(COALESCE(NEW.close_evidence, ''), 1, 10)) = 'superseded' OR lower(substr(COALESCE(NEW.close_evidence, ''), 1, 4)) = 'moot')
BEGIN UPDATE remediation_contracts SET status = 'superseded', last_verdict = 'superseded:closure-superseded', last_attempt_at = datetime('now') WHERE issue_id = NEW.issue_id AND status IN ('active', 'holding', 'needs-machine-probe', 'probe-review-refused'); END`,
  `CREATE TRIGGER decision_log_no_update BEFORE UPDATE ON decision_log BEGIN SELECT RAISE(ABORT, 'DOCTRINE-1: decision_log is append-only (doctrine section 12)'); END`,
];
function build() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT DEFAULT 'open', linked_session TEXT, created_at INTEGER, updated_at INTEGER, close_channel TEXT);
CREATE TABLE issue_triage (issue_id INTEGER PRIMARY KEY, rc TEXT NOT NULL, triage_state TEXT NOT NULL DEFAULT 'triaged', owner TEXT NOT NULL, sla_due_at TEXT NOT NULL, triaged_at TEXT DEFAULT (datetime('now')), remediation TEXT, close_evidence TEXT, reopened_count INTEGER NOT NULL DEFAULT 0);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT NOT NULL, action TEXT NOT NULL, verify_probe TEXT NOT NULL, verify_transport TEXT NOT NULL, max_attempts INTEGER DEFAULT 3, escalate_to TEXT NOT NULL, expected_cadence_h INTEGER, status TEXT DEFAULT 'active', ts TEXT, last_attempt_at TEXT, last_verdict TEXT, module TEXT, budget_ms INTEGER, next_due_at TEXT, max_items INTEGER, requires_container INTEGER, attempts INTEGER DEFAULT 0);
CREATE TABLE issue_lifecycle (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), issue_id INTEGER, event TEXT, from_status TEXT, to_status TEXT, has_evidence INTEGER);
CREATE TABLE code_tasks (id TEXT PRIMARY KEY, goal TEXT, status TEXT, updated_at TEXT);
CREATE TABLE issue_ledger (fingerprint TEXT PRIMARY KEY, source TEXT, level TEXT, category TEXT, title TEXT, status TEXT, first_seen TEXT, last_seen TEXT, occurrences INTEGER, last_detail TEXT, updated_at TEXT, resolved_at TEXT);
CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT, root_cause TEXT, remediation TEXT, detector TEXT, probe_class TEXT, first_seen TEXT, issue_id INTEGER, trigger_condition TEXT, symptom TEXT, blast_radius TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT DEFAULT (datetime('now')), actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT, outcome_matched INTEGER);
CREATE TABLE fleet_tasks (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, definition TEXT NOT NULL, timeout_ms INTEGER NOT NULL DEFAULT 30000, retries INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 1, enabled INTEGER NOT NULL DEFAULT 1, updated_at TEXT);
CREATE TABLE fleet_crons (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, cron_expr TEXT NOT NULL, task_id TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, timezone TEXT NOT NULL DEFAULT 'UTC', last_fired TEXT, next_fire TEXT, updated_at TEXT);
`);
  for (const t of TRIGGERS) db.exec(t);
  return db;
}
function build3() {
  const db = build();
  db.exec("CREATE TABLE cf_model_catalog (slug TEXT PRIMARY KEY, model_id TEXT, status TEXT, notes TEXT); CREATE TABLE model_ladder_models (id TEXT PRIMARY KEY, active INTEGER, notes TEXT);");
  return db;
}

let n = 0;
function issue(db, title, o = {}) {
  const id = one(db, "SELECT MAX(COALESCE(MAX(id), 0) + 1, 3000001) AS n FROM agent_issues").n; n++;
  db.prepare("INSERT INTO agent_issues (id, title, description, source, category, priority, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'reliability', 'high', ?, 1, 1)")
    .run(id, title, o.desc ?? "worker-observability group", o.source ?? "cf-obs-bridge", o.status ?? "open");
  db.prepare("INSERT INTO issue_triage (issue_id, rc, triage_state, owner, sla_due_at) VALUES (?, 'AUTOTRIAGE-2', 'triaged', 'qnfo-ops', '2026-11-04 02:00:00')").run(id);
  if (o.contract !== false) db.prepare("INSERT INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, escalate_to, status, last_verdict) VALUES (?, ?, 'p', 'a', 'SELECT 1', 'd1-query', 'owner', 'active', 'pending')").run("issue-" + id, id);
  return id;
}
const OV = "D1_ERROR: D1 DB is overloaded. Too many resources consumed within a <duration> window";
function fixture(db) {
  return {
    cf1: issue(db, "CF-OBS-ISSUE-1: qnfo-fleet-control: loopWatch error: " + OV + " [cf-obs:233"),
    cf2: issue(db, "CF-OBS-ISSUE-1: idea-hub: {\"error\":\"" + OV + "\",\"where\":\"<str [cf-obs:ee4c3"),
    lb1: issue(db, "LOOP-BREAKER-1: qnfo-code-orchestrator: fleet_tick: D_ERROR: D DB is overloaded. Too many resources consumed within ", { source: "loop-breaker" }),
    fleet: issue(db, "[fleet] qnfo-social · worker-observability: " + OV, { source: "fleet" }),
    lower: issue(db, "CF-OBS-ISSUE-1: qnfo-pdf: d1 db is OVERLOADED, requests queued for too long [cf-obs:ce5"),
    // kept: other D1 errors, other prefixes, body-only text, closed
    col: issue(db, "CF-OBS-ISSUE-1: qnfo-ops: D1_ERROR: no such column: foo at offset 12 [cf-obs:a1"),
    uniq: issue(db, "CF-OBS-ISSUE-1: qnfo-ops: D1_ERROR: UNIQUE constraint failed: agent_issues.title [cf-obs:a2"),
    cpu: issue(db, "CF-OBS-ISSUE-1: qnfo-ops: Worker exceeded its CPU time limit [cf-obs:a3"),
    sto: issue(db, "LOOP-BREAKER-1: qnfo-ops: D1_ERROR: storage operation exceeded timeout which caused object to be reset", { source: "loop-breaker" }),
    otherPrefix: issue(db, "PORTFOLIO-GAP deploy-unrecorded qnfo-x (" + OV + ")", { source: "portfolio" }),
    bodyOnly: issue(db, "LOOP-BREAKER-1: qnfo-ops: error capture: http , error event(s) in min", { source: "loop-breaker", desc: "samples: " + OV + " ; D DB is overloaded" }),
    alreadyClosed: issue(db, "CF-OBS-ISSUE-1: qnfo-lifecycle: " + OV + " [cf-obs:b1", { status: "closed", contract: false }),
  };
}
const OVERLOAD = ["cf1", "cf2", "lb1", "fleet", "lower"];
const KEPT = ["col", "uniq", "cpu", "sto", "otherPrefix", "bodyOnly"];
const stepsOf = (db) => JSON.parse(one(db, "SELECT definition FROM fleet_tasks WHERE id = 'issue-meta-fold'").definition).steps.map((s) => s.sql);
const run = (db) => { for (const s of stepsOf(db)) db.exec(s); };
const status = (db, id) => one(db, "SELECT status FROM agent_issues WHERE id = ?", id).status;
const base = () => { const d = build3(); d.exec(sql1); d.exec(sql2); d.exec(sql3); return d; };
const ledger7 = (db) => one(db, "SELECT COUNT(*) AS n FROM issue_fold_ledger WHERE rule = 'd1-overload-superseded'").n;

// ---- umbrella absent: the file and the hourly run close nothing
const a = base();
const fa = fixture(a);
const v3 = one(a, "SELECT version FROM fleet_tasks WHERE id = 'issue-meta-fold'").version;
const v3steps = stepsOf(a);
const triggers0 = one(a, "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger'").n;
a.exec(sql7);
ok(OVERLOAD.every((k) => status(a, fa[k]) === "open") && ledger7(a) === 0, "umbrella absent: the file closes nothing", OVERLOAD.map((k) => status(a, fa[k])));
run(a);
ok(OVERLOAD.every((k) => status(a, fa[k]) === "open") && ledger7(a) === 0, "umbrella absent: the hourly run closes nothing");
const v7 = one(a, "SELECT version FROM fleet_tasks WHERE id = 'issue-meta-fold'").version;
const v7steps = stepsOf(a);
ok(v7 === v3 + 1 && v7steps.length === v3steps.length + 1 && /d1-overload-superseded/.test(v7steps[0]), "the workflow moves up one version and gains the rule as its first statement", { v3, v7, n: v7steps.length });
ok(JSON.stringify(v7steps.slice(1)) === JSON.stringify(v3steps), "the previous statements are kept unchanged and in order behind it");
ok(one(a, "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger'").n === triggers0, "the file adds no trigger");
ok(!/^\s*(DELETE|DROP)\b/im.test(sql7.replace(/^--.*$/gm, "")), "the file runs no DELETE or DROP");
ok(one(a, "SELECT COUNT(*) AS n FROM bak_20261104_fleet_task_issue_meta_fold_h7").n === 1 && one(a, "SELECT version FROM bak_20261104_fleet_task_issue_meta_fold_h7").version === v3, "the previous definition is saved once");
ok(one(a, "SELECT COUNT(*) AS n FROM decision_log WHERE instr(action, 'ISSUE-HYGIENE-7:') = 1").n === 1, "the decision is logged once");

// ---- the umbrella appears later: the next hourly run folds the overload issues, only those
const um = issue(a, UMB, { contract: false });
const kept = Object.fromEntries(KEPT.map((k) => [k, status(a, fa[k])]));
run(a);
ok(OVERLOAD.every((k) => status(a, fa[k]) === "closed"), "umbrella present: the hourly run closes every overload issue (three prefixes, both spellings, lower case)", OVERLOAD.map((k) => status(a, fa[k])));
ok(KEPT.every((k) => status(a, fa[k]) === "open"), "other D1 errors, another title prefix and a body-only mention are kept", KEPT.map((k) => status(a, fa[k])));
ok(status(a, um) === "open" && one(a, "SELECT triage_state, close_evidence FROM issue_triage WHERE issue_id = ?", um).triage_state === "triaged", "the umbrella itself is untouched");
ok(status(a, fa.alreadyClosed) === "closed" && one(a, "SELECT COUNT(*) AS n FROM issue_fold_ledger WHERE issue_id = ?", fa.alreadyClosed).n === 0, "an already closed issue gets no ledger row");
const EVID = "superseded by " + um + ": one shared-database condition, tracked once (D1-OVERLOAD-FOLD-1)";
ok(OVERLOAD.every((k) => one(a, "SELECT close_evidence FROM issue_triage WHERE issue_id = ?", fa[k]).close_evidence === EVID), "each close carries the exact evidence naming the umbrella id", one(a, "SELECT close_evidence FROM issue_triage WHERE issue_id = ?", fa.cf1).close_evidence);
ok(OVERLOAD.every((k) => one(a, "SELECT close_channel FROM agent_issues WHERE id = ?", fa[k]).close_channel === "workflow:ISSUE-HYGIENE-1 d1-overload-superseded"), "each close names its channel");
ok(ledger7(a) === 5 && one(a, "SELECT COUNT(*) AS n FROM issue_fold_ledger WHERE rule = 'd1-overload-superseded' AND applied = 1 AND successor_id = ? AND agent_status = 'open' AND triage_state = 'triaged'", um).n === 5 && one(a, "SELECT COUNT(*) AS n FROM issue_fold_ledger WHERE applied = 0").n === 0, "the ledger holds one applied row per close with the successor id and the before-state, and nothing pending");
ok(OVERLOAD.every((k) => one(a, "SELECT status FROM remediation_contracts WHERE class = ?", "issue-" + fa[k]).status === "superseded") && KEPT.every((k) => one(a, "SELECT status FROM remediation_contracts WHERE class = ?", "issue-" + fa[k]).status === "active"), "contracts of the closed issues are superseded, the others stay active");
ok(one(a, "SELECT COUNT(*) AS n FROM issue_lifecycle WHERE event = 'dispositioned' AND has_evidence = 1 AND issue_id IN (" + OVERLOAD.map((k) => fa[k]).join(",") + ")").n === 5, "each close left a lifecycle row with evidence (no silent drop)");

// ---- idempotent: second run, second apply
const vNow = one(a, "SELECT version FROM fleet_tasks WHERE id = 'issue-meta-fold'").version;
run(a); a.exec(sql7);
ok(ledger7(a) === 5 && one(a, "SELECT COUNT(*) AS n FROM issue_fold_ledger").n === 5, "a second run and a second apply add no ledger row");
ok(one(a, "SELECT version FROM fleet_tasks WHERE id = 'issue-meta-fold'").version === vNow && stepsOf(a).length === v7steps.length, "a second apply neither bumps the version nor adds the rule twice");
ok(one(a, "SELECT COUNT(*) AS n FROM bak_20261104_fleet_task_issue_meta_fold_h7").n === 1 && one(a, "SELECT COUNT(*) AS n FROM decision_log WHERE instr(action, 'ISSUE-HYGIENE-7:') = 1").n === 1, "and the backup and the decision row are written once");
ok(KEPT.every((k) => status(a, fa[k]) === kept[k]) && status(a, um) === "open", "the kept issues and the umbrella are still open after the repeats");

// ---- a new per-group issue while the umbrella is open folds; once the umbrella closes, a new one stays
const late = issue(a, "CF-OBS-ISSUE-1: qnfo-subscribers: " + OV + " [cf-obs:zz");
run(a);
ok(status(a, late) === "closed" && one(a, "SELECT close_evidence FROM issue_triage WHERE issue_id = ?", late).close_evidence === EVID, "a later per-group issue folds on the next run");
a.prepare("UPDATE issue_triage SET triage_state = 'closed', close_evidence = 'moot: overload ended (test)' WHERE issue_id = ?").run(um);
ok(status(a, um) === "closed", "test setup: the umbrella closes with evidence");
const afterUmb = issue(a, "CF-OBS-ISSUE-1: qnfo-pdf: " + OV + " [cf-obs:yy");
run(a);
ok(status(a, afterUmb) === "open" && ledger7(a) === 6, "umbrella closed: a new overload issue is not closed", { s: status(a, afterUmb), n: ledger7(a) });
// a closed umbrella never serves as successor even if an older closed twin exists, and a second open umbrella picks the newest one
const um2 = issue(a, UMB, { contract: false });
run(a);
ok(status(a, afterUmb) === "closed" && one(a, "SELECT close_evidence FROM issue_triage WHERE issue_id = ?", afterUmb).close_evidence === "superseded by " + um2 + ": one shared-database condition, tracked once (D1-OVERLOAD-FOLD-1)" && status(a, um2) === "open", "a reopened-as-new umbrella becomes the successor and stays open");

// ---- umbrella present at apply time: the file itself closes on apply
const b = build3(); b.exec(sql1); b.exec(sql2); b.exec(sql3);
const fb = fixture(b);
const umB = issue(b, UMB, { contract: false });
b.exec(sql7);
ok(OVERLOAD.every((k) => status(b, fb[k]) === "closed") && KEPT.every((k) => status(b, fb[k]) === "open") && status(b, umB) === "open", "umbrella present at apply: the file closes the overload issues on apply and nothing else");
ok(one(b, "SELECT close_evidence FROM issue_triage WHERE issue_id = ?", fb.lb1).close_evidence === "superseded by " + umB + ": one shared-database condition, tracked once (D1-OVERLOAD-FOLD-1)", "evidence on apply names the umbrella id");

// ---- rollback restores the previous steps; closes stay
const stepsB = stepsOf(b);
b.exec(rollback);
ok(JSON.stringify(stepsOf(b)) === JSON.stringify(v3steps), "the Rollback line restores the previous steps");
const lateB = issue(b, "CF-OBS-ISSUE-1: qnfo-pdf: " + OV + " [cf-obs:xx");
run(b);
ok(status(b, lateB) === "open" && status(b, fb.cf1) === "closed" && stepsB.length === v3steps.length + 1, "after rollback a new overload issue is not folded (the gap is back) and the earlier closes stay closed");

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
