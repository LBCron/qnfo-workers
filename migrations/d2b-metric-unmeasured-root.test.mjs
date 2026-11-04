// METRIC-UNMEASURED-ROOT-1 offline suite (migrations/2026-11-05-d2b-metric-unmeasured-root.sql).
// The managers re-file METRIC-UNMEASURED-1 per owner while an enabled trigger's metric holds no value. Three metrics were unmeasured with three different causes: plus_debt_oldest_weeks had
// no producer (a seed string since 2026-10-29), plus_kept_share_30d is at a sample floor (no mature plus_outcome_checks row), youtube_avg_view_duration_s waits for the owner's OAuth consent
// (human_actions yt-analytics-consent, IDENTITY-BOUND). This applies the migration on SQLite (node:sqlite) and proves: the header (APPLY-BY ci, DB qnfo-audit, one single-line Rollback, a BACKUP
// table, nothing deleted or dropped in the body); the producer step is appended once to management-personas-plus (a replay adds nothing) and, run against the v_product_plus_debt shape,
// writes a number and a refresh time for plus_debt_oldest_weeks and writes nothing when the view is empty; both exemptions are inserted once with a doer and an end condition; the contracts of
// issue-1000609 and issue-1000745 return the literal 0 against 0 when the owner has no unmeasured row with bp26 = 0 and the count otherwise (an exempt row, bp26 = 1, no longer counts); the
// family-quiet probe copied into issue-1001220 passes only for a ticket older than 24 hours with no opened or reopened METRIC-UNMEASURED-1 issue in 24 hours and ignores other families; the
// Rollback restores contracts and the task definition and removes the exemptions; scripts/apply_migrations.py --check accepts the file.
// Run: node --no-warnings migrations/d2b-metric-unmeasured-root.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const FILE = join(here, "2026-11-05-d2b-metric-unmeasured-root.sql");
const sql = readFileSync(FILE, "utf8").replace(/\r\n/g, "\n");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };

const lines = sql.split("\n");
const hdr = (k) => (lines.find((l) => l.startsWith("-- " + k + ": ")) || "").slice(k.length + 4).trim();
const rollback = hdr("Rollback");
const body = lines.filter((l) => !l.startsWith("--")).join("\n");
ok(hdr("APPLY-BY") === "ci" && hdr("DB") === "qnfo-audit", "the file opts in with APPLY-BY: ci and DB: qnfo-audit");
ok(lines.filter((l) => /^-- Rollback: /.test(l)).length === 1 && rollback.length > 300, "one single-line Rollback");
ok(hdr("BACKUP") === "bak_20261105_d2b_unmeasured_contracts" && /CREATE TABLE IF NOT EXISTS bak_20261105_d2b_unmeasured_contracts AS/.test(body) && /CREATE TABLE IF NOT EXISTS bak_20261105_d2b_plus_task AS/.test(body), "backup tables are named and created first");
ok(!/decision_log/i.test(rollback), "the Rollback never touches decision_log (append-only)");
ok(!/\bDELETE\b/i.test(body) && !/\bDROP\b/i.test(body), "the body deletes and drops nothing");
ok(!/claude\.ai|anthropic\.com/i.test(sql) && !/\[skip|skip[ -]ci|skip-checks/i.test(sql), "no claude.ai or anthropic.com link and no skip-CI token");
ok(!/action = '[^']*VACUOUS-PROBE/.test(body), "no written action carries the VACUOUS-PROBE marker");

// the family-quiet probe as read from remediation_contracts on 2026-11-04 (issue-1001522)
const SIBLING = "SELECT '1' AS expected, CAST((SELECT COUNT(*) FROM agent_issues a WHERE a.id = 1001522 AND a.created_at < (CAST(strftime('%s', 'now') AS INTEGER) - 86400) * 1000 AND NOT EXISTS (SELECT 1 FROM issue_lifecycle l JOIN agent_issues b ON b.id = l.issue_id WHERE l.event IN ('opened', 'reopened') AND l.ts >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-24 hours') AND b.id <> a.id AND b.title NOT LIKE 'ROOT-CAUSE-1:%' AND CASE WHEN b.title LIKE 'METRIC-TRIGGER-%' THEN substr(b.title, 1, 14 + instr(substr(b.title, 16), '-')) ELSE substr(b.title, 1, MIN(CASE WHEN instr(b.title, ' ') > 0 THEN instr(b.title, ' ') ELSE 999 END, CASE WHEN instr(b.title, ':') > 0 THEN instr(b.title, ':') ELSE 999 END) - 1) END = substr(a.title, 15, instr(a.title, ' keeps recurring') - 15))) AS TEXT) AS observed";
const OLD_1001220 = "SELECT 0 AS expected, (SELECT COUNT(*) FROM metric_registry r WHERE NOT EXISTS (SELECT 1 FROM metric_history h WHERE h.metric = r.metric)) AS observed";
const OLD_1000609 = "SELECT '0' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM metric_improvement_now WHERE owner = 'qnfo-fleet-control' AND metric_key = 'evolve_parse_pass_pct_7d' AND (verdict = 'unmeasured' OR val IS NULL)";
const OLD_1000745 = "SELECT '0' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM metric_improvement_now WHERE metric_key = 'youtube_avg_view_duration_s' AND owner = 'qnfo-youtube-shorts' AND verdict = 'unmeasured'";
const VIEW = "CREATE VIEW v_product_plus_debt AS SELECT p.slug, p.name, p.surface, p.owner_worker, MAX(COALESCE(l.shipped_at, p.created_at)) AS last_plus_at, CAST((julianday('now') - julianday(MAX(COALESCE(l.shipped_at, p.created_at)))) / 7 AS INTEGER) AS weeks_since_plus FROM products p LEFT JOIN plus_ledger l ON l.product_slug = p.slug AND l.status IN ('shipped','kept') GROUP BY p.slug";
const DDL = `
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT NOT NULL, action TEXT NOT NULL, verify_probe TEXT NOT NULL, verify_transport TEXT NOT NULL, max_attempts INTEGER NOT NULL DEFAULT 3, escalate_to TEXT NOT NULL, expected_cadence_h INTEGER, status TEXT DEFAULT 'active', last_verdict TEXT, module TEXT, next_due_at TEXT, attempts INTEGER DEFAULT 0);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
CREATE TRIGGER decision_log_no_delete BEFORE DELETE ON decision_log BEGIN SELECT RAISE(ABORT, 'DOCTRINE-1: decision_log is append-only (doctrine section 12)'); END;
CREATE TRIGGER decision_log_no_update BEFORE UPDATE ON decision_log BEGIN SELECT RAISE(ABORT, 'DOCTRINE-1: decision_log is append-only (doctrine section 12)'); END;
CREATE TABLE metric_unmeasured_exemptions (metric_key TEXT PRIMARY KEY, reason TEXT NOT NULL, ends_when TEXT NOT NULL, doer TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')));
CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, last_value TEXT, last_refreshed TEXT, state TEXT);
CREATE TABLE fleet_tasks (id TEXT PRIMARY KEY, name TEXT, type TEXT, definition TEXT, timeout_ms INTEGER, retries INTEGER, version INTEGER, enabled INTEGER, updated_at TEXT);
CREATE TABLE products (slug TEXT PRIMARY KEY, name TEXT, surface TEXT, owner_worker TEXT, created_at TEXT);
CREATE TABLE plus_ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, product_slug TEXT, status TEXT, shipped_at TEXT);
${VIEW};
CREATE TABLE metric_improvement_now (trigger_id INTEGER PRIMARY KEY, metric_key TEXT, owner TEXT, val REAL, verdict TEXT, bp26 INTEGER);
CREATE TABLE control_registry (control TEXT PRIMARY KEY, location TEXT, kind TEXT, guards_against TEXT, critical_path INTEGER, disposition TEXT, disposition_state TEXT, alternate_path TEXT, evidence TEXT, issue_id INTEGER);
CREATE TABLE control_alternate_probes (control TEXT PRIMARY KEY, probe_sql TEXT NOT NULL, window_note TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1);
CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT NOT NULL, root_cause TEXT NOT NULL, remediation TEXT NOT NULL, detector TEXT NOT NULL, probe_class TEXT, first_seen TEXT NOT NULL, issue_id INTEGER, trigger_condition TEXT, symptom TEXT, blast_radius TEXT);
CREATE TABLE human_actions (id INTEGER PRIMARY KEY, slug TEXT, status TEXT, resolved_at TEXT);
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, created_at INTEGER);
CREATE TABLE issue_lifecycle (id INTEGER PRIMARY KEY AUTOINCREMENT, issue_id INTEGER, event TEXT, ts TEXT);
`;
const OLD_DEF = '{"steps":[{"type":"sql","name":"pl-ledger","db":"AUDIT","sql":"SELECT 1"}]}';
const fresh = () => {
  const db = new DatabaseSync(":memory:");
  db.exec(DDL);
  const ins = db.prepare("INSERT INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, escalate_to, status, last_verdict, module, attempts) VALUES (?, ?, 'p', ?, ?, 'd1-query', 'qnfo-fleet-control', 'active', 'fail', ?, 62)");
  ins.run("issue-1000609", 1000609, "VACUOUS-PROBE-V3-1: placeholder", OLD_1000609, "breach-doctor-restored");
  ins.run("issue-1000745", 1000745, "VACUOUS-PROBE-V3-1: placeholder", OLD_1000745, "breach-doctor-restored");
  ins.run("issue-1001220", 1001220, "HOLDING monitor only", OLD_1001220, "probe-author-1");
  ins.run("issue-1001522", 1001522, "MEASURES the closing condition", SIBLING, "root-cause-probe-at-birth-1");
  db.prepare("INSERT INTO fleet_tasks (id, name, type, definition, version) VALUES ('management-personas-plus', 'plus', 'workflow', ?, 1)").run(OLD_DEF);
  db.prepare("INSERT INTO metric_registry (metric, last_value, last_refreshed, state) VALUES ('plus_debt_oldest_weeks', 'seed: 0 (ledger has no shipped pluses yet)', '2026-10-29 12:29:00', 'MEASURED')").run();
  const day = 86400000;
  db.prepare("INSERT INTO agent_issues (id, title, created_at) VALUES (1001220, 'ROOT-CAUSE-1: METRIC-UNMEASURED-1 keeps recurring', ?)").run(Date.now() - 3 * day);
  db.prepare("INSERT INTO agent_issues (id, title, created_at) VALUES (1001522, 'ROOT-CAUSE-1: METRIC-TRIGGER-5797 keeps recurring', ?)").run(Date.now() - 3 * day);
  return db;
};
const one = (db, q, ...a) => db.prepare(q).get(...a);
const probeOf = (db, cls) => one(db, "SELECT verify_probe p FROM remediation_contracts WHERE class = ?", cls)?.p;
const run = (db, probe) => db.prepare(probe).get();

const db = fresh();
db.exec(sql);
// ---- the producer step ----
const def = JSON.parse(one(db, "SELECT definition d FROM fleet_tasks WHERE id = 'management-personas-plus'").d);
const steps = def.steps.filter((s) => s.name === "pl-debt-oldest");
ok(def.steps.length === 2 && steps.length === 1 && steps[0].type === "sql" && steps[0].db === "AUDIT", "management-personas-plus gains exactly one sql step pl-debt-oldest");
ok(one(db, "SELECT version v FROM fleet_tasks WHERE id = 'management-personas-plus'").v === 2, "the task version is bumped once");
ok(/FROM v_product_plus_debt/.test(steps[0].sql) && /last_refreshed/.test(steps[0].sql) && !/'seed/.test(steps[0].sql) && !/last_value = '?\d/.test(steps[0].sql), "the step reads the view and never writes a literal value");
db.exec(sql);
ok(JSON.parse(one(db, "SELECT definition d FROM fleet_tasks WHERE id = 'management-personas-plus'").d).steps.length === 2 && one(db, "SELECT version v FROM fleet_tasks WHERE id = 'management-personas-plus'").v === 2, "a replay adds no second step and no version bump");

const stepDb = new DatabaseSync(":memory:");
stepDb.exec(DDL);
stepDb.prepare("INSERT INTO metric_registry (metric, last_value, last_refreshed, state) VALUES ('plus_debt_oldest_weeks', 'seed: 0 (ledger has no shipped pluses yet)', '2026-10-29 12:29:00', 'MEASURED')").run();
stepDb.exec(steps[0].sql);
ok(one(stepDb, "SELECT last_value v FROM metric_registry WHERE metric = 'plus_debt_oldest_weeks'").v.startsWith("seed"), "an empty view writes nothing (the metric stays unmeasured instead of being invented)");
const old = new Date(Date.now() - 15 * 86400000).toISOString().slice(0, 19) + "Z";
stepDb.prepare("INSERT INTO products (slug, name, surface, owner_worker, created_at) VALUES ('a', 'A', 'a.example', 'w', ?), ('b', 'B', 'b.example', 'w', ?)").run(old, new Date().toISOString().slice(0, 19) + "Z");
stepDb.exec(steps[0].sql);
const m = one(stepDb, "SELECT last_value v, last_refreshed r, state s FROM metric_registry WHERE metric = 'plus_debt_oldest_weeks'");
ok(m.v === "2" && m.s === "MEASURED" && m.r > "2026-11-01", "the step writes the oldest product's weeks (15 days = 2), a fresh refresh time and MEASURED", m);
stepDb.prepare("INSERT INTO plus_ledger (product_slug, status, shipped_at) VALUES ('a', 'shipped', ?)").run(new Date().toISOString().slice(0, 19) + "Z");
stepDb.exec(steps[0].sql);
ok(one(stepDb, "SELECT last_value v FROM metric_registry WHERE metric = 'plus_debt_oldest_weeks'").v === "0", "a shipped plus lowers the oldest debt to 0");

// ---- exemptions ----
const ex = db.prepare("SELECT * FROM metric_unmeasured_exemptions ORDER BY metric_key").all();
ok(ex.length === 2 && ex[0].metric_key === "plus_kept_share_30d" && ex[1].metric_key === "youtube_avg_view_duration_s", "two exemptions are inserted once");
ok(ex.every((e) => e.reason.length > 60 && e.ends_when.length > 20 && e.doer), "each exemption names a reason, an end condition and a doer");
ok(/IDENTITY-BOUND/.test(ex[1].reason) && /yt-analytics-consent/.test(ex[1].reason), "the youtube exemption points at the IDENTITY-BOUND owner card");

// ---- the owner-wide contracts ----
const P9 = probeOf(db, "issue-1000609"), P5 = probeOf(db, "issue-1000745");
const addNow = (key, owner, verdict, bp26) => db.prepare("INSERT INTO metric_improvement_now (metric_key, owner, verdict, bp26) VALUES (?, ?, ?, ?)").run(key, owner, verdict, bp26);
ok(run(db, P9).expected === "0" && run(db, P9).observed === "0" && run(db, P5).observed === "0", "no unmeasured row: 0 against 0 (the consumer passes only when expected equals observed as text)");
addNow("plus_debt_oldest_weeks", "qnfo-fleet-control", "unmeasured", 0);
ok(run(db, P9).observed === "1" && run(db, P5).observed === "0", "an unmeasured row of the owner counts for that owner only");
addNow("plus_kept_share_30d", "qnfo-fleet-control", "unmeasured", 1);
ok(run(db, P9).observed === "1", "an exempt row (bp26 = 1) does not count, exactly as in the filer's close step");
addNow("youtube_avg_view_duration_s", "qnfo-youtube-shorts", "unmeasured", 0);
ok(run(db, P5).observed === "1", "the youtube metric counts until its exemption flips bp26");
db.exec("UPDATE metric_improvement_now SET bp26 = 1 WHERE metric_key = 'youtube_avg_view_duration_s'");
ok(run(db, P5).observed === "0", "with bp26 = 1 the youtube owner reads 0 and the contract can pass");
const c9 = one(db, "SELECT * FROM remediation_contracts WHERE class = 'issue-1000609'");
ok(c9.attempts === 0 && c9.last_verdict === null && !/^VACUOUS/.test(c9.action) && c9.module === "metric-unmeasured-owner-1", "issue-1000609 is reset and loses the VACUOUS-PROBE marker");

// ---- the family-quiet probe ----
const P20 = probeOf(db, "issue-1001220");
ok(P20 === SIBLING.replace("a.id = 1001522", "a.id = 1001220") && !/1001522/.test(P20), "issue-1001220 carries the sibling probe with its own id");
ok(run(db, P20).expected === "1" && run(db, P20).observed === "1", "a ticket older than 24 hours with a quiet family reads 1 against 1");
const ts = (offH) => new Date(Date.now() + offH * 3600000).toISOString().slice(0, 19) + "Z";
db.prepare("INSERT INTO agent_issues (id, title, created_at) VALUES (1001760, 'METRIC-UNMEASURED-1: qnfo-ops has metrics with no value', ?)").run(Date.now() - 5 * 3600000);
db.prepare("INSERT INTO issue_lifecycle (issue_id, event, ts) VALUES (1001760, 'reopened', ?)").run(ts(-2));
ok(run(db, P20).observed === "0", "a METRIC-UNMEASURED-1 issue reopened 2 hours ago breaks the quiet family");
db.exec("DELETE FROM issue_lifecycle");
db.prepare("INSERT INTO issue_lifecycle (issue_id, event, ts) VALUES (1001760, 'reopened', ?)").run(ts(-30));
ok(run(db, P20).observed === "1", "a reopen 30 hours ago no longer counts");
db.exec("DELETE FROM issue_lifecycle");
db.prepare("INSERT INTO agent_issues (id, title, created_at) VALUES (1001761, 'CRON-FAULT-1: worker-silent:x', ?)").run(Date.now());
db.prepare("INSERT INTO issue_lifecycle (issue_id, event, ts) VALUES (1001761, 'opened', ?)").run(ts(-1));
ok(run(db, P20).observed === "1", "an issue of another family does not count");


// ---- controls, alternate probes, failure mode and detector ----
ok(one(db, "SELECT COUNT(*) n FROM control_registry WHERE kind = 'filter' AND disposition = 'keep' AND critical_path = 0").n === 2, "both exemptions are registered as non-critical filters with disposition keep");
const altP = (c) => one(db, "SELECT probe_sql p FROM control_alternate_probes WHERE control = ? AND enabled = 1", c)?.p;
const AP = altP("metric-unmeasured-plus-kept-sample-floor"), AY = altP("metric-unmeasured-youtube-owner-consent");
ok(!!AP && !!AY, "both controls have an enabled alternate probe");
const snap = (key, owner, val, verdict, bp26) => { db.exec("DELETE FROM metric_improvement_now WHERE metric_key = '" + key + "'"); db.prepare("INSERT INTO metric_improvement_now (metric_key, owner, val, verdict, bp26) VALUES (?, ?, ?, ?, ?)").run(key, owner, val, verdict, bp26); };
snap("plus_kept_share_30d", "qnfo-fleet-control", null, "unmeasured", 1);
ok(run(db, AP).expected === "ok" && run(db, AP).observed === "ok", "plus-kept alternate: exempt NULL reads ok");
snap("plus_kept_share_30d", "qnfo-fleet-control", null, "unmeasured", 0);
ok(/treated as a missing producer/.test(run(db, AP).observed), "plus-kept alternate: an unexempted NULL snapshot reads a named reason");
snap("plus_kept_share_30d", "qnfo-fleet-control", 0.6, "on-target", 1);
ok(/exempted or unmeasured/.test(run(db, AP).observed), "plus-kept alternate: a numeric value masked by the exemption reads a named reason");
snap("plus_kept_share_30d", "qnfo-fleet-control", 0.6, "on-target", 0);
ok(run(db, AP).observed === "ok", "plus-kept alternate: a numeric value that is visible reads ok");
snap("youtube_avg_view_duration_s", "qnfo-youtube-shorts", null, "unmeasured", 1);
db.exec("INSERT INTO human_actions (id, slug, status, resolved_at) VALUES (204, 'yt-analytics-consent', 'rerouted', NULL)");
ok(run(db, AY).observed === "ok", "youtube alternate: exempt NULL with the owner card open reads ok");
db.exec("UPDATE human_actions SET resolved_at = '2026-11-05 00:00:00' WHERE id = 204");
ok(/owner card yt-analytics-consent is missing or resolved/.test(run(db, AY).observed), "youtube alternate: a resolved card while the metric is still unmeasured reads a named reason");
snap("youtube_avg_view_duration_s", "qnfo-youtube-shorts", 21, "on-target", 0);
ok(run(db, AY).observed === "ok", "youtube alternate: a measured value with a resolved card reads ok (the consent worked)");
const det = one(db, "SELECT verify_probe p FROM remediation_contracts WHERE class = 'fm-metric-seed-never-refreshed'").p;
ok(one(db, "SELECT COUNT(*) n FROM failure_modes WHERE fm_key = 'metric-seed-never-refreshed'").n === 1, "the failure mode row is inserted once");
ok(run(stepDb2(), det).observed === "1", "the detector reads 1 for a seed string refreshed on 2026-10-29");
function stepDb2() { const d = new DatabaseSync(":memory:"); d.exec(DDL); d.prepare("INSERT INTO metric_registry (metric, last_value, last_refreshed, state) VALUES ('plus_debt_oldest_weeks', 'seed: 0 (ledger has no shipped pluses yet)', '2026-10-29 12:29:00', 'MEASURED')").run(); return d; }
ok(run(stepDb, det).observed === "0", "the detector reads 0 once the step has written a number");

// ---- replay, decision row, rollback ----
ok(one(db, "SELECT COUNT(*) n FROM decision_log").n === 1, "one decision row after two applies");
ok(one(db, "SELECT verify_probe p FROM bak_20261105_d2b_unmeasured_contracts WHERE class = 'issue-1001220'").p === OLD_1001220, "the backup keeps the first old probe");
const rb = fresh();
rb.exec(sql);
rb.exec(rollback);
ok(probeOf(rb, "issue-1000609") === OLD_1000609 && probeOf(rb, "issue-1000745") === OLD_1000745 && probeOf(rb, "issue-1001220") === OLD_1001220, "the Rollback restores the three probes byte for byte");
ok(one(rb, "SELECT action a FROM remediation_contracts WHERE class = 'issue-1000609'").a === "VACUOUS-PROBE-V3-1: placeholder" && one(rb, "SELECT attempts n FROM remediation_contracts WHERE class = 'issue-1000609'").n === 62, "the Rollback restores action and attempts");
ok(one(rb, "SELECT definition d FROM fleet_tasks WHERE id = 'management-personas-plus'").d === OLD_DEF, "the Rollback restores the task definition byte for byte");
ok(one(rb, "SELECT COUNT(*) n FROM metric_unmeasured_exemptions").n === 0 && one(rb, "SELECT COUNT(*) n FROM decision_log").n === 1, "the Rollback removes the exemptions and leaves the decision row");
ok(one(rb, "SELECT (SELECT COUNT(*) FROM control_registry) + (SELECT COUNT(*) FROM control_alternate_probes) + (SELECT COUNT(*) FROM failure_modes) + (SELECT COUNT(*) FROM remediation_contracts WHERE class LIKE 'fm-%') n").n === 0, "the Rollback removes the controls, alternate probes, failure mode and detector");

// ---- the migration check ----
const PY = ["python3", "python"].find((c) => spawnSync(c, ["-I", "-c", "import sys"], { encoding: "utf8" }).status === 0);
if (PY) {
  const chk = spawnSync(PY, ["-I", join(root, "scripts", "apply_migrations.py"), "--check", FILE], { encoding: "utf8" });
  ok(chk.status === 0 && /"ok": true/.test(chk.stdout), "the file passes scripts/apply_migrations.py --check", chk.stdout + chk.stderr);
}
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
