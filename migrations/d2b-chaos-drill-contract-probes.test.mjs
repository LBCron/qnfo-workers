// CHAOS-DRILL-CONTRACT-PROBE-1 offline suite (migrations/2026-11-05-d2b-chaos-drill-contract-probes.sql).
// qnfo-fleet-control chaosDrill closes a CHAOS-DRILL-FAILED-1 issue itself when the control's alternate probe passes, but that close is refused by close-while-contract-fails while the
// issue's own contract reads fail. issue-1000610 printed "gap 420.6 min < 360" for a gap that is above its threshold (no WHERE gap_min < 360) and issue-1001636 counted past degraded
// improvement-loop runs for seven days. This applies the migration on SQLite (node:sqlite) and proves: the header (APPLY-BY ci, DB qnfo-audit, one single-line Rollback, a BACKUP table);
// both new probes return the literal ok when their control is healthy and a named reason otherwise (drill failing, drill not run in 8 hours, probe missing or disabled, metric stale,
// metric non-numeric or outside 0..1, loop run stale, state without the figure); a past degraded run no longer matters once the latest run is healthy; both contracts are reset
// (attempts 0, last_verdict NULL); a replay adds no decision row; the Rollback restores both contracts byte for byte; scripts/apply_migrations.py --check accepts the file.
// Run: node --no-warnings migrations/d2b-chaos-drill-contract-probes.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const FILE = join(here, "2026-11-05-d2b-chaos-drill-contract-probes.sql");
const sql = readFileSync(FILE, "utf8").replace(/\r\n/g, "\n");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };

const lines = sql.split("\n");
const hdr = (k) => (lines.find((l) => l.startsWith("-- " + k + ": ")) || "").slice(k.length + 4).trim();
const rollback = hdr("Rollback");
const body = lines.filter((l) => !l.startsWith("--")).join("\n");
ok(hdr("APPLY-BY") === "ci" && hdr("DB") === "qnfo-audit", "the file opts in with APPLY-BY: ci and DB: qnfo-audit");
ok(lines.filter((l) => /^-- Rollback: /.test(l)).length === 1 && rollback.length > 200, "one single-line Rollback");
ok(hdr("BACKUP") === "bak_20261105_d2b_chaos_contracts" && /CREATE TABLE IF NOT EXISTS bak_20261105_d2b_chaos_contracts AS/.test(body), "a BACKUP table is named and created first");
ok(!/decision_log/i.test(rollback), "the Rollback never touches decision_log (append-only)");
ok(!/\bDELETE\b/i.test(body) && !/\bDROP\b/i.test(body), "the body deletes and drops nothing");
ok(!/claude\.ai|anthropic\.com/i.test(sql) && !/\[skip|skip[ -]ci|skip-checks/i.test(sql), "no claude.ai or anthropic.com link and no skip-CI token");
ok(!/VACUOUS-PROBE/.test(body), "neither new action carries the VACUOUS-PROBE marker");

const OLD_PROBE_A = "SELECT 'ok' AS expected, CASE WHEN (SELECT COUNT(*) FROM w) = 0 THEN 'ok' ELSE 'gap' END AS observed";
const OLD_PROBE_B = "SELECT 'runs_without_0_1_figure_7d=0' AS expected, 'runs_without_0_1_figure_7d=' || COUNT(*) AS observed FROM improvement_loop_runs";
const DDL = `
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT NOT NULL, action TEXT NOT NULL, verify_probe TEXT NOT NULL, verify_transport TEXT NOT NULL, max_attempts INTEGER NOT NULL DEFAULT 3, escalate_to TEXT NOT NULL, expected_cadence_h INTEGER, status TEXT DEFAULT 'active', last_verdict TEXT, module TEXT, next_due_at TEXT, attempts INTEGER DEFAULT 0);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
CREATE TRIGGER decision_log_no_delete BEFORE DELETE ON decision_log BEGIN SELECT RAISE(ABORT, 'DOCTRINE-1: decision_log is append-only (doctrine section 12)'); END;
CREATE TRIGGER decision_log_no_update BEFORE UPDATE ON decision_log BEGIN SELECT RAISE(ABORT, 'DOCTRINE-1: decision_log is append-only (doctrine section 12)'); END;
CREATE TABLE control_alternate_probes (control TEXT PRIMARY KEY, probe_sql TEXT NOT NULL, window_note TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1, last_run_at TEXT, last_pass INTEGER, last_pass_at TEXT, last_observed TEXT);
CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, kind TEXT, last_value TEXT, last_refreshed TEXT);
CREATE TABLE improvement_loop_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, fixes_judged INTEGER, state_json TEXT);
`;
const iso = (offMin) => new Date(Date.now() + offMin * 60000).toISOString();
const fresh = () => {
  const db = new DatabaseSync(":memory:");
  db.exec(DDL);
  const ins = db.prepare("INSERT INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, escalate_to, status, last_verdict, module, attempts) VALUES (?, ?, 'p', 'VACUOUS-PROBE-V3-1 old action', ?, 'd1-query', 'qnfo-fleet-control', 'active', 'fail', 'probe-template-v2c-loop', 115)");
  ins.run("issue-1000610", 1000610, OLD_PROBE_A);
  ins.run("issue-1001636", 1001636, OLD_PROBE_B);
  ins.run("issue-1000999", 1000999, "SELECT 'ok' AS expected, 'ok' AS observed");
  return db;
};
const probeOf = (db, cls) => db.prepare("SELECT verify_probe p FROM remediation_contracts WHERE class = ?").get(cls)?.p;
const one = (db, q, ...a) => db.prepare(q).get(...a);
const run = (db, probe) => db.prepare(probe).get();

const db = fresh();
db.exec(sql);
const c610 = one(db, "SELECT * FROM remediation_contracts WHERE class = 'issue-1000610'");
const c636 = one(db, "SELECT * FROM remediation_contracts WHERE class = 'issue-1001636'");
ok(c610.attempts === 0 && c610.last_verdict === null && c636.attempts === 0 && c636.last_verdict === null, "both contracts are reset (attempts 0, last_verdict NULL)");
ok(c610.module === "chaos-drill-control-verdict-1" && c636.module === "chaos-drill-control-verdict-1" && !/^VACUOUS/.test(c610.action) && !/^VACUOUS/.test(c636.action), "module and action name the control measurement");
ok(probeOf(db, "issue-1000999") === "SELECT 'ok' AS expected, 'ok' AS observed", "an unrelated contract is untouched");
ok(one(db, "SELECT COUNT(*) n FROM bak_20261105_d2b_chaos_contracts").n === 2, "the backup holds the two old contracts");

// ---- issue-1000610: the drill verdict for social-weekly-caps ----
const P1 = c610.verify_probe;
const setCtl = (o) => { db.exec("DELETE FROM control_alternate_probes"); if (o) db.prepare("INSERT INTO control_alternate_probes (control, probe_sql, enabled, last_run_at, last_pass, last_observed) VALUES ('social-weekly-caps', 'x', ?, ?, ?, ?)").run(o.enabled ?? 1, o.run, o.pass, o.obs ?? ""); };
setCtl(null);
ok(/missing or disabled/.test(run(db, P1).observed), "no alternate probe row reads a named reason");
setCtl({ enabled: 0, run: iso(-10), pass: 1 });
ok(/missing or disabled/.test(run(db, P1).observed), "a disabled alternate probe reads a named reason");
setCtl({ run: iso(-30), pass: 1, obs: "ok" });
ok(run(db, P1).expected === "ok" && run(db, P1).observed === "ok", "a passing drill 30 minutes ago reads ok (expected equals observed as text)");
setCtl({ run: iso(-470), pass: 1 });
ok(run(db, P1).observed === "ok", "a passing drill 470 minutes ago still reads ok (the drill runs every 6 hours)");
setCtl({ run: iso(-500), pass: 1 });
ok(/has not run in 8 hours/.test(run(db, P1).observed), "a passing drill 500 minutes ago reads not run in 8 hours");
setCtl({ run: iso(-30), pass: 0, obs: "buffer-linkedin 2026-11-04 10:00 -> 12:00 under 23 h spacing" });
ok(/drill probe is failing: buffer-linkedin/.test(run(db, P1).observed), "a failing drill carries the drill's own observed text");
setCtl({ run: iso(-30), pass: null });
ok(/drill probe is failing/.test(run(db, P1).observed), "a drill that never recorded a pass reads failing");

// ---- issue-1001636: the improvement loop's relapse-judge figure ----
const P2 = c636.verify_probe;
const setMetric = (o) => {
  db.exec("DELETE FROM metric_registry; DELETE FROM improvement_loop_runs");
  if (o.metric) db.prepare("INSERT INTO metric_registry (metric, kind, last_value, last_refreshed) VALUES ('fix_target_hold_rate_30d', ?, ?, ?)").run(o.kind ?? "guard", o.value ?? null, o.refreshed);
  if (o.run) db.prepare("INSERT INTO improvement_loop_runs (ts, fixes_judged, state_json) VALUES (?, 146, ?)").run(o.run, o.state ?? '{"fix_target_hold_rate_30d":0.5342}');
};
setMetric({ metric: true, value: "0.5342", refreshed: iso(-20), run: iso(-20) });
ok(run(db, P2).expected === "ok" && run(db, P2).observed === "ok", "a fresh numeric figure and a recent run read ok");
db.prepare("INSERT INTO improvement_loop_runs (id, ts, fixes_judged, state_json) VALUES (-1, ?, 0, ?)").run(iso(-200), '{"fix_target_hold_rate_30d":null}');
ok(run(db, P2).observed === "ok", "an older degraded run (all figures null) no longer keeps the contract failing once the latest run is healthy");
setMetric({ metric: false, run: iso(-20) });
ok(/missing from metric_registry/.test(run(db, P2).observed), "a missing guard metric reads a named reason");
setMetric({ metric: true, value: "0.5342", kind: "target", refreshed: iso(-20), run: iso(-20) });
ok(/missing from metric_registry/.test(run(db, P2).observed), "a metric that is not a guard reads missing (the judge falls back on the guard)");
setMetric({ metric: true, value: "0.5342", refreshed: iso(-150), run: iso(-20) });
ok(/not refreshed in 120 minutes/.test(run(db, P2).observed), "a figure refreshed 150 minutes ago reads stale");
setMetric({ metric: true, value: null, refreshed: iso(-20), run: iso(-20) });
ok(/holds no figure between 0 and 1/.test(run(db, P2).observed), "a NULL figure reads no figure");
setMetric({ metric: true, value: "seed: 0 (no data)", refreshed: iso(-20), run: iso(-20) });
ok(/holds no figure between 0 and 1/.test(run(db, P2).observed), "a non-numeric seed string reads no figure");
setMetric({ metric: true, value: "1.4", refreshed: iso(-20), run: iso(-20) });
ok(/holds no figure between 0 and 1/.test(run(db, P2).observed), "a figure above 1 reads no figure");
setMetric({ metric: true, value: "0.5", refreshed: iso(-20), run: iso(-150) });
ok(/recorded no run in 120 minutes/.test(run(db, P2).observed), "a loop that recorded no run in 150 minutes reads stale");
setMetric({ metric: true, value: "0.5", refreshed: iso(-20), run: iso(-20), state: '{"improvement_rate_7d":0.2}' });
ok(/no longer keeps the target-based figure/.test(run(db, P2).observed), "a run state without the figure reads a named reason");

// ---- replay, decision row, rollback ----
const n1 = one(db, "SELECT COUNT(*) n FROM decision_log").n;
db.exec(sql);
ok(n1 === 1 && one(db, "SELECT COUNT(*) n FROM decision_log").n === 1, "a replay adds no second decision row");
ok(one(db, "SELECT COUNT(*) n FROM bak_20261105_d2b_chaos_contracts").n === 2 && one(db, "SELECT verify_probe p FROM bak_20261105_d2b_chaos_contracts WHERE class = 'issue-1000610'").p === OLD_PROBE_A, "a replay keeps the first backup");
const rb = fresh();
rb.exec(sql);
rb.exec(rollback);
const back = (cls) => one(rb, "SELECT verify_probe p, action a, module m, attempts n, last_verdict v FROM remediation_contracts WHERE class = ?", cls);
ok(back("issue-1000610").p === OLD_PROBE_A && back("issue-1001636").p === OLD_PROBE_B, "the Rollback restores both probes byte for byte");
ok(back("issue-1000610").a === "VACUOUS-PROBE-V3-1 old action" && back("issue-1000610").m === "probe-template-v2c-loop" && back("issue-1000610").n === 115 && back("issue-1000610").v === "fail", "the Rollback restores action, module, attempts and verdict");
ok(one(rb, "SELECT COUNT(*) n FROM decision_log").n === 1, "the Rollback leaves the decision row");

// ---- the migration check ----
const PY = ["python3", "python"].find((c) => spawnSync(c, ["-I", "-c", "import sys"], { encoding: "utf8" }).status === 0);
if (PY) {
  const chk = spawnSync(PY, ["-I", join(root, "scripts", "apply_migrations.py"), "--check", FILE], { encoding: "utf8" });
  ok(chk.status === 0 && /"ok": true/.test(chk.stdout), "the file passes scripts/apply_migrations.py --check", chk.stdout + chk.stderr);
}
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
