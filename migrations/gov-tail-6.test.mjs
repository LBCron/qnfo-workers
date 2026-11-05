// GOV-TAIL-6 offline suite (migrations/2026-11-05-gov-tail-6.sql). GOV-TAIL-2 armed every open BLINDSPOT-1 issue with a generic probe and overwrote six real probes another session had written. This applies
// GOV-TAIL-2 and then GOV-TAIL-6 on SQLite (node:sqlite) fixtures and proves: the six real probes come back byte for byte from the backup, an issue that was circular before stays on the armed probe, a probe a
// session writes later is not restored over, the three refuted beliefs drop to 0.1 with evidence appended once (and only when the evidence exists), the audit step no longer overwrites an active real
// probe but still arms a circular or inactive one, a replay changes nothing, the Rollback restores, and scripts/apply_migrations.py --check accepts the file.
// Run: node --no-warnings migrations/gov-tail-6.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const FILE = join(here, "2026-11-05-gov-tail-6.sql");
const sql = readFileSync(FILE, "utf8").replace(/\r\n/g, "\n");
const sql2 = readFileSync(join(here, "2026-11-05-gov-tail-2.sql"), "utf8").replace(/\r\n/g, "\n");
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
ok([...body.matchAll(/\bLIKE\s+'((?:[^']|'')*)'/gi)].every((m) => Buffer.byteLength(m[1]) <= 50), "every LIKE pattern is within D1's 50-byte limit");

const DDL = `
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, status TEXT);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT NOT NULL DEFAULT 'p', action TEXT NOT NULL DEFAULT 'a', verify_probe TEXT NOT NULL, verify_transport TEXT NOT NULL, max_attempts INTEGER NOT NULL DEFAULT 3, escalate_to TEXT NOT NULL DEFAULT 'q', expected_cadence_h INTEGER, status TEXT DEFAULT 'active', last_verdict TEXT, module TEXT, next_due_at TEXT, attempts INTEGER DEFAULT 0);
CREATE TABLE belief_registry (belief_key TEXT PRIMARY KEY, claim TEXT, confidence REAL, evidence TEXT NOT NULL, probe_class TEXT);
CREATE TABLE fleet_tasks (id TEXT PRIMARY KEY, definition TEXT, updated_at TEXT);
CREATE TABLE control_alternate_probes (control TEXT PRIMARY KEY, probe_sql TEXT NOT NULL, window_note TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1);
CREATE TABLE model_floor_guard_runs (run_id INTEGER PRIMARY KEY, conclusion TEXT);
CREATE TABLE cloud_ops_events (id TEXT PRIMARY KEY, kind TEXT, text TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
CREATE TRIGGER decision_log_no_delete BEFORE DELETE ON decision_log BEGIN SELECT RAISE(ABORT, 'DOCTRINE-1: decision_log is append-only (doctrine section 12)'); END;
CREATE TRIGGER decision_log_no_update BEFORE UPDATE ON decision_log BEGIN SELECT RAISE(ABORT, 'DOCTRINE-1: decision_log is append-only (doctrine section 12)'); END;
`;
const OLD_MIG = "FROM migration_runs r WHERE status <> 'ok' AND NOT EXISTS (SELECT 1 FROM migration_runs o WHERE o.file = r.file AND o.status = 'ok' AND o.id > r.id)";
const AUDIT_DEF = JSON.stringify({ steps: [{ type: "sql", name: "migration-unapplied", db: "AUDIT", sql: "SELECT 1 " + OLD_MIG }, { type: "sql", name: "metric", db: "AUDIT", sql: "SELECT 2" }] });
const circ = (id) => "SELECT 'closed' AS expected, (SELECT CASE WHEN status IN ('closed', 'resolved') THEN 'closed' ELSE NULL END FROM agent_issues WHERE id = " + id + ") AS observed";
const TITLES = {
  1001678: "BLINDSPOT-1: belief issues-probed-hourly is contradicted by its live probe",
  1001679: "BLINDSPOT-1: belief research-drains-in-3h is contradicted by its live probe",
  1001684: "BLINDSPOT-1: belief no-spof-on-critical-path is contradicted by its live probe",
  1001685: "BLINDSPOT-1: belief alt-unexercisable-model_floor_pr_check is contradicted by its live probe",
  1001697: "BLINDSPOT-1: belief alt-unexercisable-research-model-skip-gauge is contradicted by its live probe",
  1001698: "BLINDSPOT-1: belief alt-unexercisable-research-fallback-price-guard is contradicted by its live probe",
  1001699: "BLINDSPOT-1: belief belief-doctor-structured-facts-suffice is contradicted by its live probe",
};
const REAL = { 1001679: "SELECT '0 queued rows older than 180 minutes' AS expected, '0 queued rows older than 180 minutes' AS observed", 1001684: "SELECT '0' AS expected, '5' AS observed", 1001685: "SELECT 'belief consistent' AS expected, 'contradicted' AS observed", 1001697: "SELECT 'reconciled' AS expected, 'unreconciled' AS observed", 1001698: "SELECT 'a' AS expected, 'b' AS observed", 1001699: "SELECT 'ok' AS expected, 'short:0.022' AS observed" };
const fresh = (withEvidence = true) => {
  const db = new DatabaseSync(":memory:");
  db.exec(DDL);
  const ins = db.prepare("INSERT INTO agent_issues VALUES (?, ?, 'open')");
  const c = db.prepare("INSERT INTO remediation_contracts (class, issue_id, verify_probe, verify_transport, status, last_verdict, module, next_due_at, attempts) VALUES (?, ?, ?, 'd1-query', ?, ?, ?, '2099-01-01 00:00:00', 4)");
  for (const [id, t] of Object.entries(TITLES)) {
    ins.run(Number(id), t);
    if (REAL[id]) c.run("issue-" + id, Number(id), REAL[id], "active", "fail", "probe-author-1");
    else c.run("issue-" + id, Number(id), circ(id), "superseded", "superseded:closure-observing-probe-at-birth", "probe-template-v3-generic");
  }
  const b = db.prepare("INSERT INTO belief_registry VALUES (?, 'claim', 0.9, 'earlier evidence', ?)");
  b.run("alt-unexercisable-model_floor_pr_check", "belief-alt-unexercisable-model_floor_pr_check");
  b.run("alt-unexercisable-research-model-skip-gauge", "belief-alt-unexercisable-research-model-skip-gauge");
  b.run("alt-unexercisable-research-fallback-price-guard", "belief-alt-unexercisable-research-fallback-price-guard");
  db.prepare("INSERT INTO fleet_tasks VALUES ('blind-spot-audit', ?, '2026-11-04T00:00:00Z')").run(AUDIT_DEF);
  if (withEvidence) {
    db.exec("INSERT INTO model_floor_guard_runs VALUES (1, 'success'), (2, 'failure')");
    db.exec("INSERT INTO cloud_ops_events VALUES ('e1', 'ai-skip', 'aiText waiting 2 s after a rate limit, no fallback at or under its price')");
  }
  return db;
};
const upTo2 = (db) => db.exec(sql2);

// GOV-TAIL-2 first: it overwrites the six real probes with the armed generic one
const db = fresh();
upTo2(db);
for (const id of Object.keys(REAL)) ok(db.prepare("SELECT verify_probe p FROM remediation_contracts WHERE class = ?").get("issue-" + id).p.includes("BLINDSPOT-ARMED-1"), "GOV-TAIL-2 armed " + id + " (the regression this file repairs)");
const after2 = JSON.stringify(db.prepare("SELECT class, verify_probe FROM remediation_contracts ORDER BY class").all());
db.exec(sql);

for (const id of Object.keys(REAL)) {
  const c = db.prepare("SELECT verify_probe p, status s, last_verdict v, attempts a, module m FROM remediation_contracts WHERE class = ?").get("issue-" + id);
  ok(c.p === REAL[id] && c.s === "active" && c.v === null && c.a === 0 && c.m === "probe-author-1", "issue " + id + " has its own probe back, byte for byte", c);
}
ok(db.prepare("SELECT verify_probe p FROM remediation_contracts WHERE class = 'issue-1001678'").get().p.includes("BLINDSPOT-ARMED-1"), "an issue that was circular before stays on the armed probe");

// a probe a session writes after GOV-TAIL-2 is not restored over
{
  const d = fresh(); upTo2(d);
  d.exec("UPDATE remediation_contracts SET verify_probe = 'SELECT ''ok'' AS expected, ''ok'' AS observed /* session */' WHERE class = 'issue-1001685'");
  d.exec(sql);
  ok(d.prepare("SELECT verify_probe p FROM remediation_contracts WHERE class = 'issue-1001685'").get().p.endsWith("/* session */"), "a later session probe is kept");
  ok(d.prepare("SELECT verify_probe p FROM remediation_contracts WHERE class = 'issue-1001679'").get().p === REAL[1001679], "the others are still restored");
}

// the beliefs
{
  const rows = db.prepare("SELECT belief_key k, confidence c, evidence e FROM belief_registry ORDER BY belief_key").all();
  ok(rows.length === 3 && rows.every((r) => r.c === 0.1 && r.e.startsWith("earlier evidence | REFUTED 2026-11-05 (GOV-TAIL-6)") && (r.e.match(/GOV-TAIL-6/g) || []).length === 1), "three beliefs lowered to 0.1 with the evidence appended once", rows.map((r) => [r.k, r.c]));
  const n = fresh(false); upTo2(n);
  n.exec("DELETE FROM control_alternate_probes");
  n.exec(sql);
  ok(n.prepare("SELECT COUNT(*) n FROM belief_registry WHERE confidence = 0.1").get().n === 0, "without the evidence and the alternate probe row no belief is lowered");
  const m = fresh(true); upTo2(m); m.exec("DELETE FROM cloud_ops_events");
  m.exec(sql);
  ok(m.prepare("SELECT confidence c FROM belief_registry WHERE belief_key = 'alt-unexercisable-model_floor_pr_check'").get().c === 0.1 && m.prepare("SELECT confidence c FROM belief_registry WHERE belief_key = 'alt-unexercisable-research-model-skip-gauge'").get().c === 0.9, "each belief needs its own evidence");
}

// the audit step
{
  const def = JSON.parse(db.prepare("SELECT definition d FROM fleet_tasks WHERE id = 'blind-spot-audit'").get().d);
  const step = def.steps.find((s) => s.name === "arm-closing-probes");
  ok(step && (step.sql.match(/OR instr\(COALESCE\(verify_probe, ''\), 'FROM agent_issues WHERE id = '\) > 0\)/g) || []).length === 1 && step.sql.includes("status <> 'active'"), "the step arms only an inactive contract or one that observes the issue's own status", step && step.sql.slice(-220));
  const d2 = fresh(); upTo2(d2); d2.exec(sql);
  d2.exec("INSERT INTO agent_issues VALUES (1002000, 'BLINDSPOT-1: belief nothing-stuck is contradicted by its live probe', 'open')");
  d2.exec("INSERT INTO agent_issues VALUES (1002001, 'BLINDSPOT-1: belief nothing-stuck is contradicted by its live probe', 'open')");
  d2.exec("INSERT INTO agent_issues VALUES (1002002, 'BLINDSPOT-1: belief nothing-stuck is contradicted by its live probe', 'open')");
  const ci = (cls, id, probe, st) => d2.prepare("INSERT INTO remediation_contracts (class, issue_id, verify_probe, verify_transport, status, next_due_at) VALUES (?, ?, ?, 'd1-query', ?, '2099-01-01 00:00:00')").run(cls, id, probe, st);
  ci("issue-1002000", 1002000, circ(1002000), "superseded");
  ci("issue-1002001", 1002001, circ(1002001), "active");
  ci("issue-1002002", 1002002, "SELECT 'x' AS expected, 'y' AS observed", "active");
  d2.exec(step.sql);
  const g = (cls) => d2.prepare("SELECT verify_probe p FROM remediation_contracts WHERE class = ?").get(cls).p;
  ok(g("issue-1002000").includes("BLINDSPOT-ARMED-1"), "a superseded circular contract is armed");
  ok(g("issue-1002001").includes("BLINDSPOT-ARMED-1"), "an active circular contract is armed");
  ok(g("issue-1002002") === "SELECT 'x' AS expected, 'y' AS observed", "an active real probe is never overwritten");
  ok(g("issue-1001679") === REAL[1001679] && g("issue-1001685") === REAL[1001685], "the restored probes survive the hourly step");
}

// replay, decision, rollback
{
  const snap = () => JSON.stringify(db.prepare("SELECT class, verify_probe, status FROM remediation_contracts ORDER BY class").all()) + JSON.stringify(db.prepare("SELECT * FROM belief_registry ORDER BY belief_key").all()) + db.prepare("SELECT definition d FROM fleet_tasks").get().d;
  const before = snap();
  db.exec(sql);
  ok(before === snap(), "a replay changes nothing");
  ok(db.prepare("SELECT COUNT(*) n FROM decision_log WHERE action LIKE 'GOV-TAIL-6:%'").get().n === 1, "one decision row");
  const rb = fresh(); upTo2(rb); rb.exec(sql); rb.exec(rollback);
  ok(JSON.stringify(rb.prepare("SELECT class, verify_probe FROM remediation_contracts ORDER BY class").all()) === after2, "Rollback puts the contracts back as GOV-TAIL-2 left them");
  ok(rb.prepare("SELECT definition d FROM fleet_tasks").get().d === JSON.stringify(JSON.parse(rb.prepare("SELECT definition d FROM fleet_tasks").get().d)) && !rb.prepare("SELECT definition d FROM fleet_tasks").get().d.includes("FROM agent_issues WHERE id = ') > 0)"), "Rollback restores the audit definition as GOV-TAIL-2 left it");
  ok(rb.prepare("SELECT COUNT(*) n FROM belief_registry WHERE confidence = 0.9 AND evidence = 'earlier evidence'").get().n === 3, "Rollback restores the three beliefs");
}
{
  const r = spawnSync("python", ["scripts/apply_migrations.py", "--check", FILE], { cwd: root, encoding: "utf8" });
  ok(r.status === 0, "scripts/apply_migrations.py --check accepts the file", (r.stdout || "") + (r.stderr || ""));
}
console.log(fail ? fail + " failed, " + pass + " passed" : "all " + pass + " passed");
process.exit(fail ? 1 : 0);
