// GOV-TAIL-5 offline suite (migrations/2026-11-05-gov-tail-5.sql): the child issue's description gains the arming note once (and only for an open PORTFOLIO-WRITE-VIA-PR-1 issue that carries
// a code-probe line), the probe of issue 1000781 returns the literal ok at its unchanged threshold and the measured sentence otherwise, a replay changes nothing, the Rollback restores,
// and scripts/apply_migrations.py --check accepts the file. Run: node --no-warnings migrations/gov-tail-5.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const FILE = join(here, "2026-11-05-gov-tail-5.sql");
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
ok([...body.matchAll(/\bLIKE\s+'((?:[^']|'')*)'/gi)].every((m) => Buffer.byteLength(m[1]) <= 50), "every LIKE pattern is within D1's 50-byte limit");

const DDL = `
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, description TEXT, status TEXT, updated_at INTEGER);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, verify_probe TEXT NOT NULL, last_verdict TEXT, attempts INTEGER, next_due_at TEXT);
CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, last_value TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
CREATE TRIGGER decision_log_no_delete BEFORE DELETE ON decision_log BEGIN SELECT RAISE(ABORT, 'DOCTRINE-1: decision_log is append-only (doctrine section 12)'); END;
CREATE TRIGGER decision_log_no_update BEFORE UPDATE ON decision_log BEGIN SELECT RAISE(ABORT, 'DOCTRINE-1: decision_log is append-only (doctrine section 12)'); END;
`;
const D0 = 'Charter pillar: core.\ncode-task: repo=qnfo-workers path=qnfo-fleet-control/worker.js\ncode-probe: {"paths": ["qnfo-fleet-control/worker.js"], "contains": "PORTFOLIO-WRITE-VIA-PR-1"}';
const OLD = "SELECT 'cost per impact unit <= 0.012 (registered yield target)' AS expected, 'cost per impact unit = ' || COALESCE((SELECT printf('%.5f', CAST(last_value AS REAL)) FROM metric_registry WHERE metric = 'external_impact_per_dollar'), 'unmeasured') AS observed";
const fresh = () => {
  const db = new DatabaseSync(":memory:");
  db.exec(DDL);
  db.prepare("INSERT INTO agent_issues VALUES (1001928, 'PORTFOLIO-WRITE-VIA-PR-1: direct commits', ?, 'open', 1)").run(D0);
  db.prepare("INSERT INTO agent_issues VALUES (1001929, 'PORTFOLIO-WRITE-VIA-PR-1: an older closed twin', ?, 'closed', 1)").run(D0);
  db.prepare("INSERT INTO agent_issues VALUES (1001930, 'PORTFOLIO-WRITE-VIA-PR-1: open without a code-probe line', 'no probe line here', 'open', 1)").run();
  db.prepare("INSERT INTO remediation_contracts VALUES ('issue-1000781', 1000781, ?, 'fail', 40, '2026-11-05 00:00:00')").run(OLD);
  return db;
};
const db = fresh();
db.exec(sql);
{
  const d = db.prepare("SELECT description d FROM agent_issues WHERE id = 1001928").get().d;
  ok(d.startsWith(D0) && (d.match(/GOV-TAIL-5/g) || []).length === 1 && d.split("\n").includes('code-probe: {"paths": ["qnfo-fleet-control/worker.js"], "contains": "PORTFOLIO-WRITE-VIA-PR-1"}'), "the child keeps its lines and gains the arming note once", d);
  ok(db.prepare("SELECT description d FROM agent_issues WHERE id = 1001929").get().d === D0, "a closed twin is untouched");
  ok(db.prepare("SELECT description d FROM agent_issues WHERE id = 1001930").get().d === "no probe line here", "an open issue without a code-probe line is untouched");
  const p = db.prepare("SELECT verify_probe p, last_verdict v, attempts a FROM remediation_contracts WHERE class = 'issue-1000781'").get();
  ok(p.v === null && p.a === 0 && p.p.startsWith("SELECT 'ok' AS expected") && !p.p.includes(";"), "the 1000781 contract is re-armed with the ok-token probe", p);
  const run = () => db.prepare(p.p).get();
  let r = run(); ok(r.expected === "ok" && r.observed === "cost per impact unit = unmeasured (registered yield target is at most 0.012)", "an unmeasured metric reads unmeasured", r);
  db.exec("INSERT INTO metric_registry VALUES ('external_impact_per_dollar', '0.02483')");
  r = run(); ok(r.observed === "cost per impact unit = 0.02483 (registered yield target is at most 0.012)", "above the threshold names the value", r);
  db.exec("UPDATE metric_registry SET last_value = '0.012' WHERE metric = 'external_impact_per_dollar'");
  r = run(); ok(r.observed === "ok", "at the threshold reads ok", r);
  db.exec("UPDATE metric_registry SET last_value = '0.0071' WHERE metric = 'external_impact_per_dollar'");
  r = run(); ok(r.observed === "ok", "below the threshold reads ok", r);
}
{
  const snap = () => JSON.stringify(db.prepare("SELECT * FROM agent_issues ORDER BY id").all()) + JSON.stringify(db.prepare("SELECT class, verify_probe FROM remediation_contracts").all());
  const before = snap();
  db.exec(sql);
  ok(before === snap(), "a replay changes nothing");
  ok(db.prepare("SELECT COUNT(*) n FROM decision_log WHERE action LIKE 'GOV-TAIL-5:%'").get().n === 1, "one decision row");
  const rb = fresh(); rb.exec(sql); rb.exec(rollback);
  ok(rb.prepare("SELECT description d FROM agent_issues WHERE id = 1001928").get().d === D0, "Rollback restores the description");
  ok(rb.prepare("SELECT verify_probe p FROM remediation_contracts WHERE class = 'issue-1000781'").get().p === OLD, "Rollback restores the probe byte for byte");
  ok(rb.prepare("SELECT attempts a FROM remediation_contracts WHERE class = 'issue-1000781'").get().a === 40, "Rollback restores the attempts");
}
{
  const r = spawnSync("python", ["scripts/apply_migrations.py", "--check", FILE], { cwd: root, encoding: "utf8" });
  ok(r.status === 0, "scripts/apply_migrations.py --check accepts the file", (r.stdout || "") + (r.stderr || ""));
}
console.log(fail ? fail + " failed, " + pass + " passed" : "all " + pass + " passed");
process.exit(fail ? 1 : 0);
