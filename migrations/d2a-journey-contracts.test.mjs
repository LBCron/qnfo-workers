// D2A-JOURNEY-CONTRACTS-1 offline suite (migrations/2026-11-05-d2a-journey-contracts.sql).
// Three remediation contracts could not read pass for the defect their issue names: issue-1000750 read fleet_worker_census (a different table) for a row that never exists, issue-1001363
// (ask-path, a 6-hourly journey) wanted the newest run at most 180 minutes old, issue-1001440 answered 'no root-page GET logged in 24h' once the page stopped erroring.
// This applies the migration on SQLite (node:sqlite) and proves: the header (APPLY-BY ci, DB qnfo-audit, one single-line Rollback, no delete or drop); each new probe returns the literal ok
// when its measure holds and something else (a 'pending:' deferral or the measured count) when it does not, on passing, failing, stale and empty rows; the contracts are reset to
// attempts 0 / no verdict; a replay is a no-op; the Rollback restores the three probes byte for byte; scripts/apply_migrations.py --check accepts the file.
// Run: node --no-warnings migrations/d2a-journey-contracts.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const FILE = join(here, "2026-11-05-d2a-journey-contracts.sql");
const sql = readFileSync(FILE, "utf8").replace(/\r\n/g, "\n");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };

const lines = sql.split("\n");
const hdr = (k) => (lines.find((l) => l.startsWith("-- " + k + ": ")) || "").slice(k.length + 4).trim();
const rollback = hdr("Rollback");
const body = lines.filter((l) => !l.startsWith("--")).join("\n");
ok(hdr("APPLY-BY") === "ci" && hdr("DB") === "qnfo-audit", "the file opts in with APPLY-BY: ci and DB: qnfo-audit");
ok(lines.filter((l) => /^-- Rollback: /.test(l)).length === 1 && rollback.length > 300, "one single-line Rollback");
ok(!/decision_log/i.test(rollback), "the Rollback never touches decision_log (append-only)");
ok(!/\bDROP\b/i.test(body) && !/\bDELETE\b/i.test(body), "the body deletes and drops nothing");
ok(!/claude\.ai|anthropic\.com/i.test(sql) && !/\[skip|skip[ -]ci|skip-checks/i.test(sql), "no claude.ai or anthropic.com link and no skip-CI token");

// ---- the live probes the three contracts carried on 2026-11-04 (heads of the real texts; the migration matches on a fragment of each) ----
const OLD_CENSUS = "SELECT 'present' AS expected, CASE WHEN EXISTS (SELECT 1 FROM fleet_worker_census WHERE worker = 'qnfo-fleet-lee') THEN 'present' ELSE 'absent' END AS observed";
const v4 = (j, a) => "SELECT 'ok' AS expected, CASE WHEN (SELECT COUNT(*) FROM v_journey_state WHERE journey = '" + j + "') = 0 THEN 'pending: no journey_state row' WHEN (SELECT MIN(ok) FROM v_journey_state WHERE journey = '" + j + "' AND age_min <= " + a + ") = 1 AND (SELECT COUNT(*) FROM v_journey_state WHERE journey = '" + j + "' AND age_min > " + a + ") = 0 THEN 'ok' ELSE 'pending: ' || (SELECT group_concat(runner || ' ok=' || ok || ' age_min=' || CAST(age_min AS INT), ', ') FROM v_journey_state WHERE journey = '" + j + "') END AS observed";
const OLD_ASK = v4("ask-path", 180);
const OLD_WL = "WITH r AS (SELECT wall_ms, outcome FROM worker_logs WHERE script_name='qnfo-fleet-dashboard' AND method='GET' AND url='https://fleet.qnfo.org/' AND ts_ms >= (SELECT max(ts_ms) FROM worker_logs) - 24*3600000) SELECT 'ok' AS expected, CASE WHEN count(*)=0 THEN 'no root-page GET logged in 24h' WHEN sum(CASE WHEN outcome='canceled' OR coalesce(wall_ms,0)>=15000 THEN 1 ELSE 0 END)=0 THEN 'ok' ELSE 'slow' END AS observed FROM r";
const OTHER = "SELECT 'ok' AS expected, 'ok' AS observed";

const DDL = `
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT NOT NULL DEFAULT 'p', action TEXT NOT NULL DEFAULT 'a', verify_probe TEXT NOT NULL, verify_transport TEXT NOT NULL, max_attempts INTEGER NOT NULL DEFAULT 3, escalate_to TEXT NOT NULL DEFAULT 'q', expected_cadence_h INTEGER, status TEXT DEFAULT 'active', module TEXT, attempts INTEGER DEFAULT 0, last_verdict TEXT, next_due_at TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
CREATE TRIGGER decision_log_no_delete BEFORE DELETE ON decision_log BEGIN SELECT RAISE(ABORT, 'DOCTRINE-1: decision_log is append-only (doctrine section 12)'); END;
CREATE TRIGGER decision_log_no_update BEFORE UPDATE ON decision_log BEGIN SELECT RAISE(ABORT, 'DOCTRINE-1: decision_log is append-only (doctrine section 12)'); END;
CREATE TABLE fleet_worker_census (worker TEXT, verdict TEXT);
CREATE TABLE journey_state (journey TEXT, runner TEXT, ts TEXT, ok INTEGER);
CREATE VIEW v_journey_state AS SELECT journey, runner, ts, ok, (julianday('now') - julianday(ts)) * 1440.0 AS age_min FROM journey_state;
CREATE TABLE worker_logs (script_name TEXT, method TEXT, url TEXT, outcome TEXT, wall_ms REAL, ts_ms INTEGER);
CREATE INDEX idx_worker_logs_script_ts ON worker_logs(script_name, ts_ms);
`;
const fresh = () => {
  const db = new DatabaseSync(":memory:");
  db.exec(DDL);
  const ins = db.prepare("INSERT INTO remediation_contracts (class, issue_id, verify_probe, verify_transport, module, attempts, last_verdict) VALUES (?, ?, ?, 'd1-query', ?, ?, ?)");
  ins.run("issue-1000750", 1000750, OLD_CENSUS, "probe-template-v2c-loop", 97, "fail");
  ins.run("issue-1001363", 1001363, OLD_ASK, "probe-template-v4-journey", 7, "deferred");
  ins.run("issue-1001440", 1001440, OLD_WL, "probe-template-v3-generic", 5, "fail");
  ins.run("issue-424242", 424242, OTHER, "probe-template-v3-generic", 3, "fail");
  return db;
};
const probeOf = (db, cls) => db.prepare("SELECT verify_probe p FROM remediation_contracts WHERE class = ?").get(cls)?.p;
const one = (db, q, ...a) => db.prepare(q).get(...a);
const run = (db, probe) => db.prepare(probe).get();
const minsAgo = (m) => new Date(Date.now() - m * 60000).toISOString().replace(/\.\d+Z$/, "Z");

const db = fresh();
ok(one(db, "SELECT observed FROM (" + OLD_CENSUS + ")").observed === "absent", "before the migration the census contract reads absent whatever the journey does");
db.exec(sql);
const census = probeOf(db, "issue-1000750"), ask = probeOf(db, "issue-1001363"), wl = probeOf(db, "issue-1001440");
ok(!census.includes("fleet_worker_census") && census.includes("journey = 'binding-census'") && census.includes("age_min <= 180"), "issue-1000750 now reads the binding-census journey, newest run within 3 h");
ok(ask.includes("journey = 'ask-path'") && ask.includes("age_min <= 480") && !ask.includes("age_min <= 180") && !ask.includes("age_min > 180"), "issue-1001363 allows the 6-hourly cadence plus 120 minutes (480)");
ok(!wl.includes("no root-page GET logged") && wl.includes("script_name = 'qnfo-fleet-dashboard'") && wl.includes("86400"), "issue-1001440 no longer fails on an empty window");
const c = db.prepare("SELECT class, status, attempts, last_verdict, module, verify_transport FROM remediation_contracts WHERE class IN ('issue-1000750','issue-1001363','issue-1001440')").all();
ok(c.length === 3 && c.every((r) => r.status === "active" && r.attempts === 0 && r.last_verdict === null && r.verify_transport === "d1-query"), "the three contracts are active d1-query rows with attempts 0 and no verdict", c);
ok(probeOf(db, "issue-424242") === OTHER && one(db, "SELECT attempts a FROM remediation_contracts WHERE class = 'issue-424242'").a === 3, "another contract is untouched");

// ---- journey probes: ok needs a run on every runner within the limit and every one passing ----
const jr = (j, runner, ok_, ago) => db.prepare("INSERT INTO journey_state (journey, runner, ts, ok) VALUES (?, ?, ?, ?)").run(j, runner, minsAgo(ago), ok_);
let r = run(db, census);
ok(r.expected === "ok" && r.observed === "pending: no journey_state row", "no run recorded: a pending deferral, not a pass", r);
jr("binding-census", "cf", 0, 5); jr("binding-census", "gha", 1, 20);
r = run(db, census);
ok(r.observed.startsWith("pending: ") && r.observed.includes("cf ok=0"), "one runner failing: pending, never ok", r);
db.exec("DELETE FROM journey_state WHERE journey = 'binding-census'");
jr("binding-census", "cf", 1, 5); jr("binding-census", "gha", 1, 20);
r = run(db, census);
ok(r.expected === "ok" && r.observed === "ok", "both runners passing within 3 h reads ok", r);
db.exec("DELETE FROM journey_state WHERE journey = 'binding-census'");
jr("binding-census", "cf", 1, 5); jr("binding-census", "gha", 1, 200);
r = run(db, census);
ok(r.observed.startsWith("pending: "), "a runner whose newest run is 200 min old is stale for the 3 h journey", r);
// ask-path: only the cf runner runs it; 300 minutes old is inside the 6 h cadence plus 120, 600 is not
jr("ask-path", "cf", 1, 300);
r = run(db, ask);
ok(r.expected === "ok" && r.observed === "ok", "an ask-path run 300 min old that passed reads ok (it read pending under the old 180 limit)", r);
ok(run(db, OLD_ASK).observed.startsWith("pending: "), "the old probe read pending for the same row");
db.exec("DELETE FROM journey_state WHERE journey = 'ask-path'");
jr("ask-path", "cf", 1, 600);
ok(run(db, ask).observed.startsWith("pending: cf ok=1 age_min=6"), "an ask-path run 600 min old (a lost tick) is stale: pending", run(db, ask));
db.exec("DELETE FROM journey_state WHERE journey = 'ask-path'");
jr("ask-path", "cf", 0, 100);
ok(run(db, ask).observed.startsWith("pending: cf ok=0"), "a failing ask-path run is never ok", run(db, ask));

// ---- worker_logs probe ----
const wlog = (ago, outcome, wall, script = "qnfo-fleet-dashboard", url = "https://fleet.qnfo.org/") => db.prepare("INSERT INTO worker_logs (script_name, method, url, outcome, wall_ms, ts_ms) VALUES (?, 'GET', ?, ?, ?, ?)").run(script, url, outcome, wall, Date.now() - ago * 60000);
r = run(db, wl);
ok(r.observed === "worker_logs has no row in the last 2 h (capture stalled)", "an empty worker_logs is a stalled capture, not a healthy page", r);
wlog(10, "ok", 300, "qnfo-ai", "https://ai.qnfo.org/");
r = run(db, wl);
ok(r.expected === "ok" && r.observed === "ok", "capture alive and no GET / of the dashboard in the window reads ok (the old probe read 'no root-page GET logged in 24h')", r);
wlog(60 * 5, "canceled", 20000);
r = run(db, wl);
ok(r.observed === "slow: 1 GET / requests in 24 h were aborted, threw or ran 15000 ms or more", "an aborted GET / is counted", r);
db.exec("DELETE FROM worker_logs WHERE script_name = 'qnfo-fleet-dashboard'");
wlog(60 * 30, "canceled", 20000);
r = run(db, wl);
ok(r.observed === "ok", "an aborted GET / older than 24 h is outside the window", r);
wlog(60 * 2, "exception", null);
r = run(db, wl);
ok(r.observed.startsWith("slow: 1 "), "a GET / that threw counts too (the old probe ignored exceptions)", r);
db.exec("DELETE FROM worker_logs WHERE script_name = 'qnfo-fleet-dashboard'");
wlog(60 * 3, "ok", 16000);
ok(run(db, wl).observed.startsWith("slow: 1 "), "a 16 s GET / counts");
db.exec("DELETE FROM worker_logs WHERE script_name = 'qnfo-fleet-dashboard'");
wlog(60 * 3, "ok", 900);
ok(run(db, wl).observed === "ok", "a logged 0.9 s GET / does not");
wlog(60 * 3, "canceled", 20000, "qnfo-fleet-dashboard", "https://fleet.qnfo.org/api/state");
ok(run(db, wl).observed === "ok", "another route of the dashboard does not count");

// ---- decision row, replay, rollback ----
const dl = db.prepare("SELECT * FROM decision_log").all();
ok(dl.length === 1 && dl[0].action.startsWith("D2A-JOURNEY-CONTRACTS-1:") && dl[0].rollback_path.length > 20 && dl[0].capability_gain.length > 20, "one decision row names the change, its rollback and its gain", dl.length);
const snap = (d) => JSON.stringify([d.prepare("SELECT class, verify_probe, status, module, attempts, last_verdict FROM remediation_contracts ORDER BY class").all(), d.prepare("SELECT COUNT(*) n FROM decision_log").get()]);
const before = snap(db);
db.exec(sql);
ok(snap(db) === before, "replaying the file is a no-op");
const rb = fresh();
const OLD = snap(rb);
rb.exec(sql);
rb.exec(rollback);
ok(probeOf(rb, "issue-1000750") === OLD_CENSUS && probeOf(rb, "issue-1001363") === OLD_ASK && probeOf(rb, "issue-1001440") === OLD_WL, "the Rollback restores the three probes byte for byte");
const rbc = rb.prepare("SELECT class, attempts, last_verdict, module FROM remediation_contracts WHERE class IN ('issue-1000750','issue-1001363','issue-1001440') ORDER BY class").all();
ok(rbc[0].attempts === 97 && rbc[0].last_verdict === "fail" && rbc[0].module === "probe-template-v2c-loop" && rbc[2].attempts === 5, "the Rollback restores attempts, verdict and module", rbc);
ok(one(rb, "SELECT COUNT(*) n FROM decision_log").n === 1, "the Rollback leaves the decision row");
void OLD;

// ---- the migration check ----
const PY = ["python3", "python"].find((cmd) => spawnSync(cmd, ["-I", "-c", "import sys"], { encoding: "utf8" }).status === 0);
if (PY) {
  const chk = spawnSync(PY, ["-I", join(root, "scripts", "apply_migrations.py"), "--check", FILE], { encoding: "utf8" });
  ok(chk.status === 0 && /"ok": true/.test(chk.stdout), "the file passes scripts/apply_migrations.py --check", chk.stdout + chk.stderr);
}
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
