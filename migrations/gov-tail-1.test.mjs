// GOV-TAIL-1 offline suite (migrations/2026-11-05-gov-tail-1.sql). Applies the migration on SQLite (node:sqlite) against fixtures shaped like the live tables and proves:
// the header; the rewritten probes of issues 100317, 100595, 1000825 and 1000817 return the literal ok when the measurement holds and the measured value when it does not (the
// consumer passes a d1-query contract only when expected equals observed as text); the nine breach causes are mapped without overwriting an earlier mapping; the four closures
// carry evidence and the session channel; a replay changes nothing; the Rollback restores every touched row; scripts/apply_migrations.py --check accepts the file.
// Run: node --no-warnings migrations/gov-tail-1.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const FILE = join(here, "2026-11-05-gov-tail-1.sql");
const sql = readFileSync(FILE, "utf8").replace(/\r\n/g, "\n");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };

const lines = sql.split("\n");
const hdr = (k) => (lines.find((l) => l.startsWith("-- " + k + ": ")) || "").slice(k.length + 4).trim();
const rollback = hdr("Rollback");
ok(hdr("APPLY-BY") === "ci" && hdr("DB") === "qnfo-audit", "the file opts in with APPLY-BY: ci and DB: qnfo-audit");
ok(lines.filter((l) => /^-- Rollback: /.test(l)).length === 1 && rollback.length > 300, "one single-line Rollback");
ok(!/decision_log/i.test(rollback), "the Rollback never touches decision_log (append-only)");
const body = lines.filter((l) => !l.startsWith("--")).join("\n");
ok(!/\bDROP\b/i.test(body) && !/\bDELETE\b/i.test(body), "the body deletes and drops nothing");
ok(!/claude\.ai|anthropic\.com/i.test(sql) && !/\[skip|skip[ -]ci|skip-checks/i.test(sql), "no claude.ai or anthropic.com link and no skip-CI token");

const DDL = `
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, verify_probe TEXT, verify_transport TEXT, status TEXT, last_verdict TEXT, next_due_at TEXT, attempts INTEGER);
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, status TEXT, close_channel TEXT, updated_at INTEGER);
CREATE TABLE issue_triage (issue_id INTEGER PRIMARY KEY, triage_state TEXT, owner TEXT, close_evidence TEXT);
CREATE TABLE transformation_levers (id INTEGER PRIMARY KEY, tp INTEGER, n INTEGER, key TEXT, status TEXT, landed_at TEXT, stalled_at TEXT, note TEXT, updated_at TEXT);
CREATE TABLE metric_breach_cause (metric_key TEXT PRIMARY KEY, cause_key TEXT NOT NULL, note TEXT);
CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, last_value TEXT, state TEXT);
CREATE TABLE evolve_candidates (id INTEGER PRIMARY KEY, status TEXT, ts TEXT, note TEXT, proposal TEXT);
CREATE TABLE pr_sla_state (pr INTEGER, waits_on TEXT, opened_at TEXT, state TEXT);
CREATE TABLE metric_improvement_now (program_code TEXT, metric_key TEXT, verdict TEXT, has_code_task INTEGER);
CREATE TABLE v_metric_trigger_state (metric_key TEXT, hit INTEGER);
CREATE TABLE remediation_verifications (id INTEGER PRIMARY KEY AUTOINCREMENT, class TEXT, pass INTEGER, verified_at TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
CREATE TRIGGER decision_log_no_delete BEFORE DELETE ON decision_log BEGIN SELECT RAISE(ABORT, 'DOCTRINE-1: decision_log is append-only (doctrine section 12)'); END;
CREATE TRIGGER decision_log_no_update BEFORE UPDATE ON decision_log BEGIN SELECT RAISE(ABORT, 'DOCTRINE-1: decision_log is append-only (doctrine section 12)'); END;
-- the live sync: a closed triage row closes the open issue and names an auto channel (triage_close_sync_issue_upd)
CREATE TRIGGER triage_close_sync_issue_upd AFTER UPDATE OF triage_state ON issue_triage WHEN NEW.triage_state = 'closed' BEGIN
  UPDATE remediation_contracts SET status = 'superseded', last_verdict = 'superseded:closure-superseded'
    WHERE issue_id = NEW.issue_id AND status IN ('active', 'holding') AND (lower(substr(COALESCE(NEW.close_evidence, ''), 1, 10)) = 'superseded' OR lower(substr(COALESCE(NEW.close_evidence, ''), 1, 4)) = 'moot');
  UPDATE agent_issues SET status = 'closed', close_channel = COALESCE(close_channel, 'auto:triage-sync' || CASE WHEN COALESCE(NEW.owner, '') <> '' THEN ':' || NEW.owner ELSE '' END), updated_at = 1 WHERE id = NEW.issue_id AND status = 'open';
END;
-- the live guard: a close with an active or holding failing contract is refused
CREATE TRIGGER issue_close_evidence_required BEFORE UPDATE OF status ON agent_issues WHEN NEW.status IN ('closed', 'resolved') AND OLD.status NOT IN ('closed', 'resolved') BEGIN
  SELECT RAISE(ABORT, 'close-without-evidence') WHERE NOT EXISTS (SELECT 1 FROM issue_triage t WHERE t.issue_id = NEW.id AND t.close_evidence IS NOT NULL AND TRIM(t.close_evidence) <> '');
  SELECT RAISE(ABORT, 'close-while-contract-fails') WHERE EXISTS (SELECT 1 FROM remediation_contracts c WHERE c.issue_id = NEW.id AND c.status IN ('active', 'holding') AND COALESCE(c.last_verdict, '') IN ('fail'));
END;
`;
const OLD_100317 = "SELECT '0' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM evolve_candidates WHERE status = 'model-skip' AND ts >= '2026-09-26' AND note LIKE 'no usable JSON%' AND COALESCE(proposal,'') NOT LIKE '%\"reasked\":true%'";
const OLD_100595 = "WITH o AS (SELECT pr, waits_on, CAST((julianday('now') - julianday(opened_at)) * 1440 AS INTEGER) AS age_min FROM pr_sla_state WHERE state = 'open') SELECT CAST('0 open PRs older than 60m awaiting merge' AS TEXT) AS expected, CAST((SELECT COUNT(*) FROM o WHERE age_min > 60) AS TEXT) || ' open PRs older than 60m, oldest ' || CAST((SELECT MAX(age_min) FROM o) AS TEXT) || 'm, prs ' || COALESCE((SELECT group_concat(pr || '(' || COALESCE(waits_on,'none') || ',' || age_min || 'm)') FROM o WHERE age_min > 60), 'none') AS observed";
const OLD_1000825 = "WITH personal_off AS (SELECT metric_key, verdict, has_code_task FROM metric_improvement_now WHERE program_code = 'QNFO.PERSONAL' AND verdict NOT IN ('on-target','unmeasured')) SELECT '0 off-target QNFO.PERSONAL metrics are missing a doer' AS expected, COALESCE(COUNT(*), 0) || ' off-target metrics without a doer' AS observed FROM personal_off WHERE has_code_task = 0";
const OLD_1000817 = "WITH breached AS (SELECT metric_key FROM v_metric_trigger_state WHERE hit = 1) SELECT '0 unmapped breach metrics' AS expected, COALESCE(COUNT(*), 0) || ' unmapped breach metric(s)' || COALESCE(': ' || group_concat(b.metric_key, ', '), '') AS observed FROM breached b LEFT JOIN metric_breach_cause c ON c.metric_key = b.metric_key WHERE c.metric_key IS NULL";

const NINE = ["workers_ai_attribution_coverage_pct", "improvement_rate_7d", "idea_topic_concentration_30d", "worker_count_disagreement", "metrics_on_probation_overdue", "contracts_unexecutable_open", "cf_obs_reopen_churn_24h", "secrets_in_repo", "plain_article_coverage_pct"];

const fresh = () => {
  const db = new DatabaseSync(":memory:");
  db.exec(DDL);
  const c = db.prepare("INSERT INTO remediation_contracts VALUES (?, ?, ?, 'd1-query', ?, ?, '2026-11-05 00:00:00', 7)");
  c.run("issue-100317", 100317, OLD_100317, "active", "fail");
  c.run("issue-1001448", 1001448, "SELECT 1", "active", "fail");
  c.run("issue-100595", 100595, OLD_100595, "active", "fail");
  c.run("issue-1000825", 1000825, OLD_1000825, "active", "fail");
  c.run("issue-1000817", 1000817, OLD_1000817, "active", "fail");
  c.run("issue-1001461", 1001461, "SELECT 1", "monitoring", "monitoring:loop-owned-48h");
  c.run("issue-1001748", 1001748, "SELECT 1", "superseded", "superseded:closure-observing-probe-at-birth");
  c.run("issue-1001781", 1001781, "SELECT 1", "superseded", "superseded:closure-observing-probe-at-birth");
  for (const id of [100317, 1001448, 1001461, 1001748, 1001781, 100595, 1000825, 1000817]) {
    db.prepare("INSERT INTO agent_issues VALUES (?, 'open', NULL, 5)").run(id);
    db.prepare("INSERT INTO issue_triage VALUES (?, 'triaged', 'qnfo-fleet-control', NULL)").run(id);
  }
  db.prepare("INSERT INTO transformation_levers VALUES (28, 3, 9, 'charter-pillar-on-every-toml', 'session', NULL, NULL, 'needs a session', '2026-11-03')").run();
  db.prepare("INSERT INTO metric_registry VALUES ('evolve_parse_pass_pct_7d', '100.0', 'MEASURED')").run();
  db.prepare("INSERT INTO metric_breach_cause VALUES ('secrets_in_repo', 'measurement', 'earlier session')").run();
  db.prepare("INSERT INTO remediation_verifications (class, pass, verified_at) VALUES ('belief-evolve-wip-planner-alignment', 0, '2026-11-04 22:00:00'), ('belief-evolve-wip-planner-alignment', 1, '2026-11-04 23:29:09')").run();
  for (const m of NINE) db.prepare("INSERT INTO v_metric_trigger_state VALUES (?, 1)").run(m);
  db.prepare("INSERT INTO v_metric_trigger_state VALUES ('drift_total', 1)").run();
  db.prepare("INSERT INTO metric_breach_cause VALUES ('drift_total', 'structure', 'BREACH-UNMAPPED-3')").run();
  return db;
};
const probeOf = (db, cls) => db.prepare("SELECT verify_probe p FROM remediation_contracts WHERE class = ?").get(cls)?.p;
const run = (db, probe) => db.prepare(probe).get();

// ---- the old probes cannot pass ----
{
  const db = fresh();
  db.exec("INSERT INTO pr_sla_state VALUES (1, 'checks', datetime('now', '-5 minutes'), 'open')");
  const r = run(db, OLD_100595); ok(r.expected !== r.observed, "the old 100595 probe never reads pass", r);
  const p = run(db, OLD_1000825); ok(p.expected !== p.observed, "the old 1000825 probe never reads pass", p);
  const u = run(db, OLD_1000817); ok(u.expected !== u.observed, "the old 1000817 probe never reads pass", u);
}

// ---- apply ----
const db = fresh();
db.exec(sql);
const before = JSON.stringify(db.prepare("SELECT * FROM remediation_contracts ORDER BY class").all()) + JSON.stringify(db.prepare("SELECT * FROM issue_triage ORDER BY issue_id").all());

// 100317: judges only rows after the fix
{
  const p = probeOf(db, "issue-100317");
  ok(!/model-skip.*ts >= '2026-09-26'/.test(p), "100317 no longer counts the rows from before the fix");
  let r = run(db, p); ok(r.expected === "ok" && r.observed === "ok", "100317 reads ok with metric 100 and no unre-asked skip after the fix", r);
  db.exec("INSERT INTO evolve_candidates VALUES (117, 'model-skip', '2026-10-02T10:00:47.359Z', 'no usable JSON from @cf/moonshotai/kimi-k2.7-code', '{}')");
  r = run(db, p); ok(r.observed === "ok", "a skip from before the fix does not count", r);
  db.exec("INSERT INTO evolve_candidates VALUES (130, 'model-skip', '2026-11-03T10:00:00.000Z', 'no usable JSON from @cf/moonshotai/kimi-k2.7-code', '{\"model\":\"m\"}')");
  r = run(db, p); ok(r.observed !== "ok" && /not re-asked/.test(r.observed), "an un-re-asked skip after the fix is a defect", r);
  db.exec("UPDATE evolve_candidates SET proposal = '{\"reasked\":true}' WHERE id = 130");
  r = run(db, p); ok(r.observed === "ok", "a re-asked skip is not a defect", r);
  db.exec("UPDATE metric_registry SET last_value = '40.0' WHERE metric = 'evolve_parse_pass_pct_7d'");
  r = run(db, p); ok(r.observed !== "ok" && /below 50/.test(r.observed), "a metric below 50 is a defect", r);
  db.exec("UPDATE metric_registry SET last_value = '100.0' WHERE metric = 'evolve_parse_pass_pct_7d'");
  const row = db.prepare("SELECT status, last_verdict, attempts FROM remediation_contracts WHERE class = 'issue-100317'").get();
  ok(row.status === "active" && row.last_verdict === null && row.attempts === 0, "100317 contract is re-armed", row);
}

// 100595
{
  const p = probeOf(db, "issue-100595");
  let r = run(db, p); ok(r.expected === "ok" && r.observed === "ok", "100595 reads ok with an empty queue", r);
  db.exec("INSERT INTO pr_sla_state VALUES (7001, 'checks', datetime('now', '-90 minutes'), 'open'), (7002, NULL, datetime('now', '-3 minutes'), 'open')");
  r = run(db, p); ok(r.observed !== "ok" && /^1 open PRs older than 60m, oldest 9\dm, prs 7001\(checks,9\dm\)$/.test(r.observed), "100595 names the stale PR", r);
}

// 1000825
{
  const p = probeOf(db, "issue-1000825");
  let r = run(db, p); ok(r.expected === "ok" && r.observed === "ok", "1000825 reads ok with no off-target metric lacking a doer", r);
  db.exec("INSERT INTO metric_improvement_now VALUES ('QNFO.PERSONAL', 'm_a', 'breach', 0), ('QNFO.PERSONAL', 'm_b', 'breach', 1), ('QNFO.OPS', 'm_c', 'breach', 0), ('QNFO.PERSONAL', 'm_d', 'on-target', 0)");
  r = run(db, p); ok(r.observed === "1 off-target QNFO.PERSONAL metrics without a doer: m_a", "1000825 names the metric without a doer", r);
}

// 1000817 and the nine mappings
{
  const rows = db.prepare("SELECT metric_key, cause_key, note FROM metric_breach_cause WHERE note = 'GOV-TAIL-1'").all();
  ok(rows.length === 8, "eight new rows (secrets_in_repo kept its earlier mapping)", rows.length);
  ok(db.prepare("SELECT cause_key FROM metric_breach_cause WHERE metric_key = 'secrets_in_repo'").get().cause_key === "measurement", "an earlier mapping is not overwritten");
  const causes = new Set(["spend", "issue-backlog", "code-loop", "owner-routing", "publishing", "heartbeat", "structure", "measurement", "breach-doctor"]);
  ok(db.prepare("SELECT cause_key FROM metric_breach_cause").all().every((r) => causes.has(r.cause_key)), "every cause_key is one the vocabulary already uses");
  const p = probeOf(db, "issue-1000817");
  let r = run(db, p); ok(r.expected === "ok" && r.observed === "ok", "1000817 reads ok when every breaching metric is mapped", r);
  db.exec("INSERT INTO v_metric_trigger_state VALUES ('brand_new_metric', 1)");
  r = run(db, p); ok(r.observed === "1 unmapped breach metric(s): brand_new_metric", "1000817 names a new unmapped metric (no guess)", r);
}

// closures
{
  for (const id of [1001448, 1001461, 1001748, 1001781]) {
    const a = db.prepare("SELECT status, close_channel FROM agent_issues WHERE id = ?").get(id);
    const t = db.prepare("SELECT triage_state, close_evidence FROM issue_triage WHERE issue_id = ?").get(id);
    ok(a.status === "closed" && a.close_channel === "session:breach-remediation", "issue " + id + " closed on the session channel", a);
    ok(t.triage_state === "closed" && t.close_evidence.length > 120, "issue " + id + " carries evidence", t);
  }
  ok(/^superseded by #100317/.test(db.prepare("SELECT close_evidence e FROM issue_triage WHERE issue_id = 1001448").get().e), "1001448 evidence names its successor first");
  ok(db.prepare("SELECT status FROM remediation_contracts WHERE class = 'issue-1001448'").get().status === "superseded", "1001448 contract is superseded");
  ok(db.prepare("SELECT status, landed_at IS NOT NULL l FROM transformation_levers WHERE id = 28").get().status === "landed", "lever 28 is landed");
  for (const id of [100317, 100595, 1000825, 1000817]) ok(db.prepare("SELECT status FROM agent_issues WHERE id = ?").get(id).status === "open", "issue " + id + " stays open until its own probe passes twice");
  ok(db.prepare("SELECT COUNT(*) n FROM decision_log WHERE action LIKE 'GOV-TAIL-1:%'").get().n === 1, "one decision row");
}

// the belief closure needs a passing latest row
{
  const d2 = fresh();
  d2.exec("INSERT INTO remediation_verifications (class, pass, verified_at) VALUES ('belief-evolve-wip-planner-alignment', 0, '2026-11-04 23:50:00')");
  d2.exec(sql);
  ok(d2.prepare("SELECT status FROM agent_issues WHERE id = 1001781").get().status === "open", "a belief whose latest probe fails again is not closed");
}

// replay is a no-op
{
  db.exec(sql);
  const after = JSON.stringify(db.prepare("SELECT * FROM remediation_contracts ORDER BY class").all()) + JSON.stringify(db.prepare("SELECT * FROM issue_triage ORDER BY issue_id").all());
  ok(before.replace(/"next_due_at":"[^"]*"/g, "") === after.replace(/"next_due_at":"[^"]*"/g, ""), "a replay leaves the contracts and triage rows as they were");
  ok(db.prepare("SELECT COUNT(*) n FROM decision_log WHERE action LIKE 'GOV-TAIL-1:%'").get().n === 1, "a replay adds no second decision row");
}

// the Rollback restores
{
  const rb = fresh(); rb.exec(sql);
  rb.exec(rollback);
  const r = rb.prepare("SELECT status, verify_probe FROM remediation_contracts WHERE class = 'issue-100317'").get();
  ok(r.verify_probe === OLD_100317, "Rollback restores the 100317 probe byte for byte");
  ok(rb.prepare("SELECT verify_probe p FROM remediation_contracts WHERE class = 'issue-100595'").get().p === OLD_100595, "Rollback restores the 100595 probe");
  for (const id of [1001448, 1001461, 1001748, 1001781]) {
    ok(rb.prepare("SELECT status FROM agent_issues WHERE id = ?").get(id).status === "open", "Rollback reopens " + id);
  }
  ok(rb.prepare("SELECT COUNT(*) n FROM metric_breach_cause WHERE note = 'GOV-TAIL-1'").get().n === 0, "Rollback removes the new cause rows");
  ok(rb.prepare("SELECT status FROM transformation_levers WHERE id = 28").get().status === "session", "Rollback restores lever 28");
}

// apply_migrations --check
{
  const r = spawnSync("python", ["scripts/apply_migrations.py", "--check", FILE], { cwd: root, encoding: "utf8" });
  ok(r.status === 0, "scripts/apply_migrations.py --check accepts the file", (r.stdout || "") + (r.stderr || ""));
}

console.log(fail ? fail + " failed, " + pass + " passed" : "all " + pass + " passed");
process.exit(fail ? 1 : 0);
