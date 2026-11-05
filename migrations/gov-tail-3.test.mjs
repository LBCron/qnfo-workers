// GOV-TAIL-3 offline suite (migrations/2026-11-05-gov-tail-3.sql). Applies the migration on SQLite (node:sqlite) against fixtures shaped like the live tables and proves:
// the five `session-task:` lines that name a change already on main are rewritten (each only for its own issue, the rest of the description is untouched, a line that names another
// path or an issue whose change is not on main keeps its marker), the qnfo-observability probe counts only exceptions that are not D1 saturation since the health route was
// decoupled (a /health exception after the deploy is a defect, saturation is not, an exception before the deploy is not), a replay changes nothing, the Rollback restores, and
// scripts/apply_migrations.py --check accepts the file. Run: node --no-warnings migrations/gov-tail-3.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const FILE = join(here, "2026-11-05-gov-tail-3.sql");
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
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, status TEXT, description TEXT, updated_at INTEGER);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, verify_probe TEXT, last_verdict TEXT, attempts INTEGER, next_due_at TEXT);
CREATE TABLE worker_logs (script_name TEXT, outcome TEXT, ts_ms INTEGER, url TEXT, exceptions_json TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
CREATE TRIGGER decision_log_no_delete BEFORE DELETE ON decision_log BEGIN SELECT RAISE(ABORT, 'DOCTRINE-1: decision_log is append-only (doctrine section 12)'); END;
CREATE TRIGGER decision_log_no_update BEFORE UPDATE ON decision_log BEGIN SELECT RAISE(ABORT, 'DOCTRINE-1: decision_log is append-only (doctrine section 12)'); END;
`;
const OLD_PROBE = "SELECT '0' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM worker_logs WHERE script_name = 'qnfo-observability' AND outcome = 'exception' AND ts_ms > CAST(strftime('%s','2026-10-29 21:00:00') AS INTEGER) * 1000";
const D = (path, pre, post) => "Charter pillar: research.\n" + pre + "\nsession-task: repo=qnfo-workers path=" + path + "\ncode-anchor: some anchor\n" + post;
const ISSUES = {
  100317: D("qnfo-fleet-control/worker.js", "pre-317", "post-317"),
  1000334: D("q08-signal-engine/worker.js", "pre-334", "post-334"),
  1000341: D("personal-api/worker.js", "pre-341", "post-341"),
  1000347: D("personal-companion/worker.js", "pre-347", "post-347"),
  1000351: D("q08-signal-engine/worker.js", "pre-351", "post-351"),
  1000344: D("personal-api/worker.js", "pre-344", "post-344"),
  1000350: D("qnfo-ops/worker.js", "pre-350", "post-350"),
};
const fresh = () => {
  const db = new DatabaseSync(":memory:");
  db.exec(DDL);
  for (const [id, d] of Object.entries(ISSUES)) db.prepare("INSERT INTO agent_issues VALUES (?, 'open', ?, 1)").run(Number(id), d);
  db.prepare("INSERT INTO remediation_contracts VALUES ('issue-1000866', 1000866, ?, 'fail', 75, '2026-11-05 00:00:00')").run(OLD_PROBE);
  return db;
};
const db = fresh();
db.exec(sql);

const desc = (id) => db.prepare("SELECT description d FROM agent_issues WHERE id = ?").get(id).d;
for (const id of [100317, 1000334, 1000341, 1000347, 1000351]) {
  const d = desc(id);
  ok(!d.includes("session-task:") && /^(landed|slice-shipped): repo=qnfo-workers path=/m.test(d) && d.includes("GOV-TAIL-3 2026-11-05"), "issue " + id + " no longer asks a session and names what shipped", d.slice(0, 200));
  ok(d.startsWith("Charter pillar: research.\npre-" + String(id).slice(-3)) && d.endsWith("\ncode-anchor: some anchor\npost-" + String(id).slice(-3)), "issue " + id + " keeps the rest of its text", d);
}
ok(desc(100317).includes("PR 5671") && desc(1000334).includes("PR 5126") && desc(1000341).includes("personal-api 4.26.0") && desc(1000347).includes("issue 1000738") && desc(1000351).includes("PR 5148"), "each record names its evidence");
for (const id of [1000344, 1000350]) ok(desc(id) === ISSUES[id] && desc(id).includes("session-task:"), "issue " + id + " keeps its marker: its change is not on main");
ok(db.prepare("SELECT updated_at u FROM agent_issues WHERE id = 1000344").get().u === 1, "an untouched issue keeps its updated_at");

// the observability probe
{
  const p = db.prepare("SELECT verify_probe p, last_verdict v, attempts a FROM remediation_contracts WHERE class = 'issue-1000866'").get();
  ok(p.v === null && p.a === 0 && !p.p.includes("2026-10-29") && p.p.startsWith("SELECT 'ok' AS expected"), "the 1000866 contract is re-armed with the new probe", p);
  ok(!p.p.includes(";") && !/update |attach |pragma |vacuum|insert into|delete from/i.test(p.p), "the probe is a literal read-only select");
  const run = () => db.prepare(p.p).get();
  const T = (s) => Date.parse(s) ;
  let r = run(); ok(r.expected === "ok" && r.observed === "ok", "no exception reads ok", r);
  const ins = db.prepare("INSERT INTO worker_logs VALUES ('qnfo-observability', 'exception', ?, ?, ?)");
  ins.run(T("2026-11-02T21:40:58Z"), "https://qnfo-observability.q08.workers.dev/health", '[{"name":"exception","message":"D1_ERROR: D1 DB is overloaded. Requests queued for too long."}]');
  ins.run(T("2026-11-03T03:01:04Z"), "https://qnfo-observability.q08.workers.dev/health", '[{"name":"exception","message":"GET https://qnfo-observability.q08.workers.dev/health"}]');
  r = run(); ok(r.observed === "ok", "exceptions before the decoupling deploy do not count", r);
  ins.run(T("2026-11-04T09:15:30Z"), "", '[{"name":"exception","message":"scheduled failed D1_ERROR: D1 DB is overloaded. Too many resources consumed within a 10 second window"}]');
  ins.run(T("2026-11-04T09:15:30Z"), "", '[{"name":"exception","message":"qnfo-observability fleet_heartbeat write failed D1_ERROR: D1 DB is overloaded. Too many resources consumed within a 10 second window"}]');
  r = run(); ok(r.observed === "ok", "D1 saturation after the deploy is the fleet-wide umbrella, not a defect of this worker", r);
  ins.run(T("2026-11-04T12:00:00Z"), "https://qnfo-observability.q08.workers.dev/health", '[{"name":"exception","message":"GET https://qnfo-observability.q08.workers.dev/health"}]');
  r = run(); ok(r.observed === "1 qnfo-observability exceptions that are not D1 saturation since the health route was decoupled from D1", "a /health exception after the deploy is a defect", r);
  db.prepare("INSERT INTO worker_logs VALUES ('other-worker', 'exception', ?, '', '[{\"message\":\"boom\"}]')").run(T("2026-11-04T13:00:00Z"));
  r = run(); ok(r.observed.startsWith("1 "), "another worker's exception does not count", r);
}

// replay, decision row, rollback
{
  const before = JSON.stringify(db.prepare("SELECT * FROM agent_issues ORDER BY id").all()) + JSON.stringify(db.prepare("SELECT * FROM remediation_contracts").all());
  db.exec(sql);
  const after = JSON.stringify(db.prepare("SELECT * FROM agent_issues ORDER BY id").all()) + JSON.stringify(db.prepare("SELECT * FROM remediation_contracts").all());
  ok(before.replace(/"next_due_at":"[^"]*"/g, "") === after.replace(/"next_due_at":"[^"]*"/g, ""), "a replay leaves the descriptions and the contract as they were");
  ok(db.prepare("SELECT COUNT(*) n FROM decision_log WHERE action LIKE 'GOV-TAIL-3:%'").get().n === 1, "one decision row, also after a replay");
  const rb = fresh(); rb.exec(sql); rb.exec(rollback);
  for (const [id, d] of Object.entries(ISSUES)) ok(rb.prepare("SELECT description d FROM agent_issues WHERE id = ?").get(Number(id)).d === d, "Rollback restores issue " + id);
  ok(rb.prepare("SELECT verify_probe p, last_verdict v, attempts a FROM remediation_contracts WHERE class = 'issue-1000866'").get().p === OLD_PROBE, "Rollback restores the probe byte for byte");
  ok(rb.prepare("SELECT last_verdict v, attempts a FROM remediation_contracts WHERE class = 'issue-1000866'").get().a === 75, "Rollback restores the attempts");
}
{
  const r = spawnSync("python", ["scripts/apply_migrations.py", "--check", FILE], { cwd: root, encoding: "utf8" });
  ok(r.status === 0, "scripts/apply_migrations.py --check accepts the file", (r.stdout || "") + (r.stderr || ""));
}
console.log(fail ? fail + " failed, " + pass + " passed" : "all " + pass + " passed");
process.exit(fail ? 1 : 0);
