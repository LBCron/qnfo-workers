// GOV-TAIL-2 offline suite (migrations/2026-11-05-gov-tail-2.sql). Applies the migration on SQLite (node:sqlite) against fixtures shaped like the live tables and proves:
// every open BLINDSPOT-1 issue gets a probe that measures the condition its text states (ok when it holds, the measured value when it does not), that the probes pass the consumer's
// literal-select rules (SELECT or WITH, no semicolon, none of its write keywords), that the audit gains one `arm-closing-probes` step that arms a new issue and is a no-op on a replay,
// that the audit's migration query ignores a superseded run, that the three alternate probes and the belief watchers behave, that the owner-bound probes read as deferrals
// (never as a measured pending) until the owner step is observable, that a replay changes nothing, that the Rollback restores, and that apply_migrations --check accepts the file.
// Run: node --no-warnings migrations/gov-tail-2.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const FILE = join(here, "2026-11-05-gov-tail-2.sql");
const sql = readFileSync(FILE, "utf8").replace(/\r\n/g, "\n");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 500))); } };

const lines = sql.split("\n");
const hdr = (k) => (lines.find((l) => l.startsWith("-- " + k + ": ")) || "").slice(k.length + 4).trim();
const rollback = hdr("Rollback");
ok(hdr("APPLY-BY") === "ci" && hdr("DB") === "qnfo-audit", "the file opts in with APPLY-BY: ci and DB: qnfo-audit");
ok(lines.filter((l) => /^-- Rollback: /.test(l)).length === 1 && rollback.length > 300, "one single-line Rollback");
ok(!/decision_log/i.test(rollback.replace(/decision_log is append-only/g, "")), "the Rollback never touches decision_log (append-only)");
const body = lines.filter((l) => !l.startsWith("--")).join("\n");
ok(!/\bDROP\b/i.test(body) && !/\bDELETE\b/i.test(body), "the body deletes and drops nothing");
ok(!/claude\.ai|anthropic\.com/i.test(sql) && !/\[skip|skip[ -]ci|skip-checks/i.test(sql), "no claude.ai or anthropic.com link and no skip-CI token");

// the consumer's rules for a literal read-only probe (scripts/remediation_consumer.py is_literal_select, WRITE_KW) and for a measured pending (is_measured_pending)
const WRITE_KW = ["insert into", "update ", "delete from", "drop table", "drop index", "alter table", "create table", "create index", "create trigger", "attach ", "detach ", "pragma ", "replace into", "vacuum"];
const literalSelect = (p) => { const low = p.trim().toLowerCase(); return (low.startsWith("select") || low.startsWith("with")) && !WRITE_KW.some((k) => low.includes(k)) && !p.trim().replace(/;$/, "").includes(";"); };
const measuredPending = (o) => /[0-9]/.test(o) && (["ceiling", "target", "threshold", "limit", "fewer than", "more than"].some((w) => o.toLowerCase().includes(w)) || [" <= ", " >= ", " < ", " > "].some((op) => o.includes(op)));

const OLD_MIG = "FROM migration_runs r WHERE status <> 'ok' AND NOT EXISTS (SELECT 1 FROM migration_runs o WHERE o.file = r.file AND o.status = 'ok' AND o.id > r.id)";
const AUDIT_DEF = JSON.stringify({ steps: [
  { type: "sql", name: "belief-contradicted", db: "AUDIT", sql: "SELECT 1" },
  { type: "sql", name: "migration-unapplied", db: "AUDIT", sql: "INSERT INTO agent_issues (title) SELECT 'x' " + OLD_MIG + " AND 0" },
  { type: "sql", name: "metric", db: "AUDIT", sql: "SELECT 2" },
] });

const DDL = `
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, status TEXT);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT NOT NULL DEFAULT 'p', action TEXT NOT NULL DEFAULT 'a', verify_probe TEXT NOT NULL, verify_transport TEXT NOT NULL, max_attempts INTEGER NOT NULL DEFAULT 3, escalate_to TEXT NOT NULL DEFAULT 'q', expected_cadence_h INTEGER, status TEXT DEFAULT 'active', last_verdict TEXT, module TEXT, next_due_at TEXT, attempts INTEGER DEFAULT 0);
CREATE TABLE remediation_verifications (id INTEGER PRIMARY KEY AUTOINCREMENT, class TEXT, pass INTEGER, verified_at TEXT);
CREATE TABLE belief_registry (belief_key TEXT PRIMARY KEY, probe_class TEXT);
CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, probe_class TEXT);
CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, state TEXT, last_refreshed TEXT);
CREATE TABLE code_tasks (id TEXT PRIMARY KEY, merged_at TEXT, deployed_at TEXT);
CREATE TABLE migration_runs (id INTEGER PRIMARY KEY, file TEXT, status TEXT);
CREATE TABLE fleet_tasks (id TEXT PRIMARY KEY, definition TEXT, updated_at TEXT);
CREATE TABLE control_alternate_probes (control TEXT PRIMARY KEY, probe_sql TEXT NOT NULL, window_note TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1);
CREATE TABLE model_floor_guard_runs (run_id INTEGER PRIMARY KEY, workflow_path TEXT, branch TEXT, event TEXT, conclusion TEXT, run_started_at TEXT);
CREATE TABLE cloud_ops_events (id TEXT PRIMARY KEY, ts TEXT, job TEXT, kind TEXT, status TEXT, text TEXT);
CREATE TABLE human_actions (slug TEXT PRIMARY KEY, status TEXT, resolution TEXT);
CREATE TABLE ai_spend_owner_client (day TEXT, client TEXT, usd REAL);
CREATE TABLE ai_spend_owner_local (day TEXT, usd REAL);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
CREATE TRIGGER decision_log_no_delete BEFORE DELETE ON decision_log BEGIN SELECT RAISE(ABORT, 'DOCTRINE-1: decision_log is append-only (doctrine section 12)'); END;
CREATE TRIGGER decision_log_no_update BEFORE UPDATE ON decision_log BEGIN SELECT RAISE(ABORT, 'DOCTRINE-1: decision_log is append-only (doctrine section 12)'); END;
`;
const CIRCULAR = "SELECT 'closed' AS expected, (SELECT CASE WHEN status IN ('closed', 'resolved') THEN 'closed' ELSE NULL END FROM agent_issues WHERE id = 1) AS observed";
const TITLES = {
  1001678: "BLINDSPOT-1: belief issues-probed-hourly is contradicted by its live probe",
  1001679: "BLINDSPOT-1: belief evolve-wip-planner-alignment has no probe result in 48 hours",
  1001852: "BLINDSPOT-1: 9 failure modes have a detector that never ran",
  1001853: "BLINDSPOT-1: 15 metrics have not refreshed in 3 days",
  1001854: "BLINDSPOT-1: 23 merged code tasks have no deploy evidence after 2 hours",
  1001855: "BLINDSPOT-1: 4 migration files have no ok row in migration_runs",
  1001856: "BLINDSPOT-1: 2 active contracts are parked past their cadence",
};
const NINE = ["issue-1001747", "issue-1001749", "issue-1001750", "issue-1001751", "issue-1001752", "issue-100384"];
const ALT = ["belief-alt-unexercisable-model_floor_pr_check", "belief-alt-unexercisable-research-model-skip-gauge", "belief-alt-unexercisable-research-fallback-price-guard"];
const BELIEF_OLD = (extra) => "SELECT 'ok' AS expected, CASE WHEN EXISTS (SELECT 1 FROM cloud_ops_events WHERE kind = 'ai-skip') THEN 'an ai-skip event now exists: add a control_alternate_probes row for " + extra + "' WHEN EXISTS (SELECT 1 FROM cloud_ops_events WHERE kind = 'ai-warn') THEN 'a warn event exists' ELSE 'ok' END AS observed";

const fresh = () => {
  const db = new DatabaseSync(":memory:");
  db.exec(DDL);
  const addI = db.prepare("INSERT INTO agent_issues VALUES (?, ?, 'open')");
  const addC = db.prepare("INSERT INTO remediation_contracts (class, issue_id, verify_probe, verify_transport, status, last_verdict, next_due_at, attempts) VALUES (?, ?, ?, 'd1-query', ?, ?, '2099-01-01 00:00:00', 4)");
  for (const [id, t] of Object.entries(TITLES)) { addI.run(Number(id), t); addC.run("issue-" + id, Number(id), CIRCULAR, id === "1001679" ? "active" : "superseded", id === "1001679" ? "fail" : "superseded:closure-observing-probe-at-birth"); }
  addI.run(1001900, "ROADMAP-1: something else"); addC.run("issue-1001900", 1001900, "SELECT 'ok' AS expected, 'ok' AS observed", "active", "pass");
  for (const c of NINE) addC.run(c, Number(c.slice(6)), "SELECT 'x' AS expected, 'y' AS observed", c === "issue-100384" ? "active" : "superseded", "fail");
  for (const c of ALT) addC.run(c, null, BELIEF_OLD(c.slice("belief-alt-unexercisable-".length)), "active", "fail");
  db.prepare("INSERT INTO belief_registry VALUES ('issues-probed-hourly', 'belief-issues-probed-hourly'), ('evolve-wip-planner-alignment', 'belief-evolve-wip-planner-alignment')").run();
  db.prepare("INSERT INTO fleet_tasks VALUES ('blind-spot-audit', ?, '2026-11-04T00:00:00Z')").run(AUDIT_DEF);
  return db;
};
const probeOf = (db, cls) => db.prepare("SELECT verify_probe p FROM remediation_contracts WHERE class = ?").get(cls)?.p;
const run = (db, probe) => db.prepare(probe).get();

// ---------------------------------------------------------------- apply
const db = fresh();
db.exec(sql);
const state = () => JSON.stringify(db.prepare("SELECT class, verify_probe, status, last_verdict, attempts, next_due_at, module FROM remediation_contracts ORDER BY class").all()) + db.prepare("SELECT definition d FROM fleet_tasks").get().d;
const first = state();

// every BLINDSPOT contract is armed once
for (const id of Object.keys(TITLES)) {
  const c = db.prepare("SELECT * FROM remediation_contracts WHERE class = ?").get("issue-" + id);
  ok(c.status === "active" && c.module === "blindspot-armed-1" && c.attempts === 0 && c.last_verdict === null && c.verify_transport === "d1-query", "issue " + id + " contract is active and re-armed", c);
  ok(c.verify_probe.includes("BLINDSPOT-ARMED-1") && literalSelect(c.verify_probe), "issue " + id + " probe is a literal select with the marker", c.verify_probe.slice(0, 120));
}
ok(db.prepare("SELECT verify_probe p FROM remediation_contracts WHERE class = 'issue-1001900'").get().p.startsWith("SELECT 'ok' AS expected, 'ok'"), "an issue outside the BLINDSPOT-1 families is untouched");

// belief contradicted / unprobed
{
  const p = probeOf(db, "issue-1001678");
  let r = run(db, p); ok(r.expected === "ok" && r.observed === "the latest probe of belief issues-probed-hourly still fails or has no reading", "no reading is a defect", r);
  db.exec("INSERT INTO remediation_verifications (class, pass, verified_at) VALUES ('belief-issues-probed-hourly', 0, datetime('now'))");
  r = run(db, p); ok(r.observed !== "ok", "a failing latest reading is a defect", r);
  db.exec("INSERT INTO remediation_verifications (class, pass, verified_at) VALUES ('belief-issues-probed-hourly', 1, datetime('now'))");
  r = run(db, p); ok(r.observed === "ok", "a passing latest reading reads ok", r);
  const u = probeOf(db, "issue-1001679");
  r = run(db, u); ok(r.observed === "no reading of the probe of belief evolve-wip-planner-alignment in 48 hours", "unprobed names the belief", r);
  db.exec("INSERT INTO remediation_verifications (class, pass, verified_at) VALUES ('belief-evolve-wip-planner-alignment', 0, datetime('now', '-3 hours'))");
  r = run(db, u); ok(r.observed === "ok", "a reading of any verdict in 48 hours reads ok (the condition is that it ran)", r);
  db.exec("DELETE FROM remediation_verifications WHERE class = 'belief-evolve-wip-planner-alignment'");
  db.exec("INSERT INTO remediation_verifications (class, pass, verified_at) VALUES ('belief-evolve-wip-planner-alignment', 1, datetime('now', '-72 hours'))");
  r = run(db, u); ok(r.observed !== "ok", "a reading older than 48 hours is a defect", r);
}
// failure modes with a detector that never ran
{
  const p = probeOf(db, "issue-1001852");
  db.exec("INSERT INTO failure_modes VALUES ('a', 'fm-a'), ('b', 'fm-b'), ('c', NULL)");
  let r = run(db, p); ok(r.observed === "2 failure modes have a detector that never ran", "two modes with no reading and no active contract", r);
  db.exec("INSERT INTO remediation_contracts (class, verify_probe, verify_transport, status) VALUES ('fm-a', 's', 'd1-query', 'active'), ('fm-b', 's', 'd1-query', 'active')");
  r = run(db, p); ok(r.observed === "2 failure modes have a detector that never ran", "an active contract without a reading is still never run", r);
  db.exec("INSERT INTO remediation_verifications (class, pass, verified_at) VALUES ('fm-a', 1, datetime('now')), ('fm-b', 0, datetime('now'))");
  r = run(db, p); ok(r.observed === "ok", "a reading of any verdict and an active contract read ok", r);
}
// stale metrics
{
  const p = probeOf(db, "issue-1001853");
  db.exec("INSERT INTO metric_registry VALUES ('fresh', 'MEASURED', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), ('gone', 'RETIRED', NULL), ('never', 'UNMEASURED', NULL), ('old', 'MEASURED', strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-5 days'))");
  let r = run(db, p); ok(r.observed === "2 metrics have not refreshed in 3 days, for example never", "retired metrics do not count", r);
  db.exec("UPDATE metric_registry SET state = 'RETIRED' WHERE metric IN ('never', 'old')");
  r = run(db, p); ok(r.observed === "ok", "after retirement or refresh the count is 0", r);
}
// merged code tasks without deploy evidence
{
  const p = probeOf(db, "issue-1001854");
  db.exec("INSERT INTO code_tasks VALUES ('a', datetime('now', '-30 hours'), NULL), ('b', datetime('now', '-30 hours'), datetime('now', '-29 hours')), ('c', datetime('now', '-1 hours'), NULL), ('d', datetime('now', '-9 days'), NULL)");
  let r = run(db, p); ok(r.observed === "1 merged code tasks have no deploy evidence after 2 hours", "only the merged-over-2h-ago, within-7-days, undeployed task counts", r);
  db.exec("UPDATE code_tasks SET deployed_at = datetime('now') WHERE id = 'a'");
  r = run(db, p); ok(r.observed === "ok", "recording the deploy clears it", r);
}
// migration files with no ok row (a later superseded row counts like a later ok row)
{
  const p = probeOf(db, "issue-1001855");
  db.exec("INSERT INTO migration_runs VALUES (1, 'a.sql', 'error'), (2, 'a.sql', 'ok'), (3, 'b.sql', 'error'), (4, 'b.sql', 'superseded'), (5, 'c.sql', 'error')");
  let r = run(db, p); ok(r.observed === "1 migration files have a failed run and no later ok run", "only c.sql never applied", r);
  db.exec("INSERT INTO migration_runs VALUES (6, 'c.sql', 'ok')");
  r = run(db, p); ok(r.observed === "ok", "an ok run after the failure clears it", r);
}
// contracts parked
{
  const p = probeOf(db, "issue-1001856");
  let r = run(db, p); ok(r.observed.endsWith("active contracts are parked past their cadence"), "armed contracts parked in 2099 are counted", r);
  db.exec("UPDATE remediation_contracts SET next_due_at = datetime('now')");
  r = run(db, p); ok(r.observed === "ok", "re-armed contracts read ok", r);
}

// ---------------------------------------------------------------- the audit definition
{
  const def = JSON.parse(db.prepare("SELECT definition d FROM fleet_tasks WHERE id = 'blind-spot-audit'").get().d);
  const names = def.steps.map((s) => s.name);
  ok(names.length === 4 && names[3] === "arm-closing-probes", "the audit gains exactly one step, last", names);
  const step = def.steps[3];
  ok(step.type === "sql" && step.db === "AUDIT" && /^UPDATE remediation_contracts SET verify_probe = COALESCE\(/.test(step.sql), "the step is one UPDATE of remediation_contracts", step.sql.slice(0, 80));
  const mig = def.steps[1].sql;
  ok(!mig.includes("status <> 'ok'") && mig.includes("status NOT IN ('ok', 'superseded')") && mig.includes("o.status = 'superseded'"), "the audit's migration query ignores a superseded run", mig);
  // the step arms an issue born after this migration, once
  const d2 = fresh();
  d2.exec(sql);
  d2.exec("INSERT INTO agent_issues VALUES (1002000, 'BLINDSPOT-1: belief nothing-stuck is contradicted by its live probe', 'open')");
  d2.exec("INSERT INTO belief_registry VALUES ('nothing-stuck', 'belief-nothing-stuck')");
  d2.exec("INSERT INTO remediation_contracts (class, issue_id, verify_probe, verify_transport, status, last_verdict, next_due_at) VALUES ('issue-1002000', 1002000, '" + CIRCULAR.replace(/'/g, "''") + "', 'd1-query', 'superseded', 'superseded:closure-observing-probe-at-birth', '2099-01-01 00:00:00')");
  d2.exec(step.sql);
  const c = d2.prepare("SELECT status, module, verify_probe p FROM remediation_contracts WHERE class = 'issue-1002000'").get();
  ok(c.status === "active" && c.module === "blindspot-armed-1" && c.p.includes("'belief-nothing-stuck'") === false && c.p.includes("'nothing-stuck'"), "the hourly step arms a new belief issue with its own belief key", c);
  const due = d2.prepare("SELECT next_due_at n FROM remediation_contracts WHERE class = 'issue-1002000'").get().n;
  d2.exec("UPDATE remediation_contracts SET next_due_at = '2030-01-01 00:00:00' WHERE class = 'issue-1002000'");
  d2.exec(step.sql);
  ok(d2.prepare("SELECT next_due_at n FROM remediation_contracts WHERE class = 'issue-1002000'").get().n === "2030-01-01 00:00:00", "a second run of the step leaves an armed issue alone", due);
  // a closed issue is not armed
  d2.exec("UPDATE agent_issues SET status = 'closed' WHERE id = 1002000");
  d2.exec("UPDATE remediation_contracts SET status = 'superseded', verify_probe = '" + CIRCULAR.replace(/'/g, "''") + "' WHERE class = 'issue-1002000'");
  d2.exec(step.sql);
  ok(d2.prepare("SELECT status FROM remediation_contracts WHERE class = 'issue-1002000'").get().status === "superseded", "a closed issue is not re-armed");
}

// ---------------------------------------------------------------- alternate probes
{
  const rows = db.prepare("SELECT control, probe_sql, window_note, enabled FROM control_alternate_probes ORDER BY control").all();
  ok(rows.map((r) => r.control).join() === "model_floor_pr_check,research-fallback-price-guard,research-model-skip-gauge", "three alternate probes", rows.map((r) => r.control));
  ok(rows.every((r) => literalSelect(r.probe_sql) && r.enabled === 1 && r.window_note.startsWith("GOV-TAIL-2:")), "each is a literal select with a window note");
  const by = Object.fromEntries(rows.map((r) => [r.control, r.probe_sql]));
  let r = run(db, by.model_floor_pr_check); ok(r.observed.startsWith("no post-merge push or schedule run"), "no recorded run is a defect", r);
  db.exec("INSERT INTO model_floor_guard_runs VALUES (1, '.github/workflows/model-floor-guard.yml', 'main', 'push', 'success', strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-1 hours'))");
  r = run(db, by.model_floor_pr_check); ok(r.observed === "ok", "a recent successful main push run reads ok", r);
  db.exec("INSERT INTO model_floor_guard_runs VALUES (2, '.github/workflows/model-floor-guard.yml', 'main', 'push', 'failure', strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-10 minutes'))");
  r = run(db, by.model_floor_pr_check); ok(r.observed === "the newest model-floor-guard run on main did not succeed", "a newer failed run is a defect", r);
  db.exec("INSERT INTO model_floor_guard_runs VALUES (3, '.github/workflows/model-floor-guard.yml', 'other', 'push', 'failure', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))");
  // research controls
  r = run(db, by["research-model-skip-gauge"]); ok(r.observed === "ok", "no wait in 30 days reads ok", r);
  db.exec("INSERT INTO cloud_ops_events VALUES ('e1', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days'), 'qnfo-research-exec', 'ai-skip', 'warn', 'aiText model=m waiting 2 s after a rate limit, no fallback at or under its price')");
  r = run(db, by["research-model-skip-gauge"]); ok(r.observed.startsWith("a rate-limit wait"), "a wait with no finished stage after it is a defect", r);
  db.exec("INSERT INTO cloud_ops_events VALUES ('e2', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days', '+3 minutes'), 'qnfo-research-exec', 'done', 'ok', '{}')");
  r = run(db, by["research-model-skip-gauge"]); ok(r.observed === "ok", "a finished stage within 15 minutes clears it", r);
  r = run(db, by["research-fallback-price-guard"]); ok(r.observed === "ok", "the price guard probe sees the same wait and its follow-up", r);
  db.exec("INSERT INTO cloud_ops_events VALUES ('e3', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 days'), 'qnfo-research-exec', 'ai-skip', 'warn', 'something else without the phrase')");
  r = run(db, by["research-fallback-price-guard"]); ok(r.observed === "ok", "an ai-skip without the price-guard phrase does not concern the price guard", r);
  r = run(db, by["research-model-skip-gauge"]); ok(r.observed.startsWith("a rate-limit wait"), "but it does concern the skip gauge", r);
  // belief watchers go quiet once the control row exists (here they exist) and keep their old message otherwise
  for (const cls of ALT) {
    const p = probeOf(db, cls);
    ok(p.includes("FROM control_alternate_probes WHERE control = "), cls + " watcher consults control_alternate_probes");
    r = run(db, p); ok(r.observed === "ok", cls + " watcher is quiet once the alternate probe row exists", r);
  }
  const d3 = fresh(); d3.exec(sql); d3.exec("DELETE FROM control_alternate_probes"); d3.exec("INSERT INTO cloud_ops_events VALUES ('e9', datetime('now'), 'x', 'ai-skip', 'warn', 't')");
  ok(run(d3, probeOf(d3, ALT[1])).observed.startsWith("an ai-skip event now exists"), "without the alternate probe row the watcher still speaks");
}

// ---------------------------------------------------------------- owner-bound probes
{
  for (const c of NINE) {
    const k = db.prepare("SELECT status, verify_probe p, verify_transport t, attempts FROM remediation_contracts WHERE class = ?").get(c);
    ok(k.status === "active" && k.t === "d1-query" && k.attempts === 0 && literalSelect(k.p), c + " is live with a literal select", k);
  }
  db.exec("INSERT INTO human_actions VALUES ('ga4-internal-traffic-1', 'resolved', 'handed back to the fleet by the owner (dashboard), filing, 2026-11-04T17:08:40.627Z')");
  for (const [c] of [["issue-1001747"], ["issue-1001749"], ["issue-1001750"], ["issue-1001752"], ["issue-1001751"]]) {
    const r = run(db, probeOf(db, c));
    ok(r.expected === "ok" && r.observed.startsWith("pending:") && !measuredPending(r.observed), c + " reads a plain deferral, never a measured pending", r.observed);
  }
  db.exec("UPDATE human_actions SET resolution = 'done by the owner: internal traffic filter active 2026-11-05' WHERE slug = 'ga4-internal-traffic-1'");
  ok(run(db, probeOf(db, "issue-1001747")).observed === "ok", "the GA4 card resolved with a real resolution reads ok");
  ok(run(db, probeOf(db, "issue-1001749")).observed.startsWith("pending:"), "a card that does not exist stays pending");
  db.exec("INSERT INTO ai_spend_owner_client VALUES (date('now'), 'cursor', 4.2)");
  ok(run(db, probeOf(db, "issue-1001751")).observed === "ok", "owner_client rows make the tagging card ok");
  // 100384: rolling 30 days, 90 percent coverage
  db.exec("INSERT INTO ai_spend_owner_local VALUES (date('now', '-3 day'), 100)");
  let r = run(db, probeOf(db, "issue-100384")); ok(r.observed.startsWith("pending:") && r.observed.includes("covers 4.20 of 100.00 USD in 30 days") && !measuredPending(r.observed), "100384 names the coverage as a plain deferral", r.observed);
  db.exec("INSERT INTO ai_spend_owner_client VALUES (date('now', '-2 day'), 'claude', 90)");
  r = run(db, probeOf(db, "issue-100384")); ok(r.observed === "ok", "100384 reads ok at 90 percent coverage", r);
  const d4 = fresh(); d4.exec(sql);
  ok(run(d4, probeOf(d4, "issue-100384")).observed === "ok", "no owner-local spend in the window reads ok");
}

// ---------------------------------------------------------------- replay, decision, rollback, --check
{
  db.exec("UPDATE remediation_contracts SET next_due_at = '2099-01-01 00:00:00' WHERE class = 'issue-1001678'");
  const before = JSON.stringify(db.prepare("SELECT class, verify_probe, status, module FROM remediation_contracts ORDER BY class").all()) + db.prepare("SELECT definition d FROM fleet_tasks").get().d;
  db.exec(sql);
  const after = JSON.stringify(db.prepare("SELECT class, verify_probe, status, module FROM remediation_contracts ORDER BY class").all()) + db.prepare("SELECT definition d FROM fleet_tasks").get().d;
  ok(before === after, "a replay leaves every probe, status and the audit definition as they were");
  ok(db.prepare("SELECT next_due_at n FROM remediation_contracts WHERE class = 'issue-1001678'").get().n === "2099-01-01 00:00:00", "a replay does not re-arm an armed issue");
  ok(db.prepare("SELECT COUNT(*) n FROM decision_log WHERE action LIKE 'GOV-TAIL-2:%'").get().n === 1, "one decision row, also after a replay");
  ok(db.prepare("SELECT COUNT(*) n FROM control_alternate_probes").get().n === 3, "no duplicate alternate probes after a replay");
  void first;
}
{
  const rb = fresh(); rb.exec(sql); rb.exec(rollback);
  for (const id of Object.keys(TITLES)) {
    const c = rb.prepare("SELECT verify_probe p, status FROM remediation_contracts WHERE class = ?").get("issue-" + id);
    ok(c.p === CIRCULAR && c.status === (id === "1001679" ? "active" : "superseded"), "Rollback restores issue " + id, c.status);
  }
  ok(rb.prepare("SELECT COUNT(*) n FROM control_alternate_probes").get().n === 0, "Rollback removes the alternate probes");
  ok(rb.prepare("SELECT definition d FROM fleet_tasks").get().d === AUDIT_DEF, "Rollback restores the audit definition byte for byte");
  ok(rb.prepare("SELECT verify_probe p FROM remediation_contracts WHERE class = ?").get(ALT[0]).p === BELIEF_OLD("model_floor_pr_check"), "Rollback restores the belief watcher");
}
{
  const r = spawnSync("python", ["scripts/apply_migrations.py", "--check", FILE], { cwd: root, encoding: "utf8" });
  ok(r.status === 0, "scripts/apply_migrations.py --check accepts the file", (r.stdout || "") + (r.stderr || ""));
}

console.log(fail ? fail + " failed, " + pass + " passed" : "all " + pass + " passed");
process.exit(fail ? 1 : 0);
