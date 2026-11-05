// JOURNEY-RECORD-DURABLE-1 offline suite (migrations/2026-11-05-d2a-journey-durable.sql).
// The fleet-control tick wrote its journey rows one at a time and lost some (11 of 62 ticks partial on 2026-11-04, 10 absent, no ask-path run at 18:00Z). This applies the file on SQLite (node:sqlite)
// and proves: the header (APPLY-BY ci, DB qnfo-audit, one single-line Rollback, no delete or drop in the body); the failure mode and its detector contract exist once; the detector reads ok
// on whole ticks and names the problem on a partial tick, on too few ticks and on a missing ask-path slot; the portfolio doer is filed once with a code-task / code-anchor pair whose anchor occurs
// exactly once in qnfo-fleet-control/worker.js and its probe reads ok only for a fresh ok sync; a replay is a no-op; the Rollback removes the detector and the failure mode and leaves the
// issue and the decision row; scripts/apply_migrations.py --check accepts the file.
// Run: node --no-warnings migrations/d2a-journey-durable.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const FILE = join(here, "2026-11-05-d2a-journey-durable.sql");
const sql = readFileSync(FILE, "utf8").replace(/\r\n/g, "\n");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };

const lines = sql.split("\n");
const hdr = (k) => (lines.find((l) => l.startsWith("-- " + k + ": ")) || "").slice(k.length + 4).trim();
const rollback = hdr("Rollback");
const body = lines.filter((l) => !l.startsWith("--")).join("\n");
ok(hdr("APPLY-BY") === "ci" && hdr("DB") === "qnfo-audit", "the file opts in with APPLY-BY: ci and DB: qnfo-audit");
ok(lines.filter((l) => /^-- Rollback: /.test(l)).length === 1 && rollback.length > 80, "one single-line Rollback");
ok(!/decision_log/i.test(rollback), "the Rollback never touches decision_log (append-only)");
ok(!/\bDROP\b/i.test(body) && !/\bDELETE\b/i.test(body), "the body deletes and drops nothing");
ok(!/claude\.ai|anthropic\.com/i.test(sql) && !/\[skip|skip[ -]ci|skip-checks/i.test(body.replace(/keep \[skip ci\] out of that commit message/g, "")), "no claude.ai or anthropic.com link and no skip-CI token in the statements");

const DDL = `
CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT NOT NULL, root_cause TEXT NOT NULL, remediation TEXT NOT NULL, detector TEXT NOT NULL, probe_class TEXT, first_seen TEXT NOT NULL, issue_id INTEGER, trigger_condition TEXT, symptom TEXT, blast_radius TEXT);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT NOT NULL DEFAULT 'p', action TEXT NOT NULL DEFAULT 'a', verify_probe TEXT NOT NULL, verify_transport TEXT NOT NULL, max_attempts INTEGER NOT NULL DEFAULT 3, escalate_to TEXT NOT NULL DEFAULT 'q', expected_cadence_h INTEGER, status TEXT DEFAULT 'active', attempts INTEGER DEFAULT 0, last_verdict TEXT, next_due_at TEXT);
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TRIGGER agent_issues_birth_contract AFTER INSERT ON agent_issues BEGIN
  INSERT INTO remediation_contracts (class, issue_id, verify_probe, verify_transport) VALUES ('issue-' || NEW.id, NEW.id, 'needs-machine-probe', 'd1-query');
END;
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
CREATE TRIGGER decision_log_no_delete BEFORE DELETE ON decision_log BEGIN SELECT RAISE(ABORT, 'DOCTRINE-1: decision_log is append-only (doctrine section 12)'); END;
CREATE TRIGGER decision_log_no_update BEFORE UPDATE ON decision_log BEGIN SELECT RAISE(ABORT, 'DOCTRINE-1: decision_log is append-only (doctrine section 12)'); END;
CREATE TABLE journey_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, runner TEXT NOT NULL, journey TEXT NOT NULL, ok INTEGER NOT NULL DEFAULT 1);
CREATE TABLE portfolio_sync_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, status TEXT);
`;
const db = new DatabaseSync(":memory:");
db.exec(DDL);
db.exec(sql);
const one = (d, q, ...a) => d.prepare(q).get(...a);
const run = (d, probe) => d.prepare(probe).get();

// ---- failure mode and detector ----
ok(one(db, "SELECT COUNT(*) n FROM failure_modes WHERE fm_key = 'journey-ticks-cut'").n === 1, "one failure mode row");
const det = db.prepare("SELECT * FROM remediation_contracts WHERE class = 'fm-journey-ticks-cut'").all();
ok(det.length === 1 && det[0].issue_id === null && det[0].verify_transport === "d1-query" && det[0].status === "active" && det[0].expected_cadence_h === 1, "one active hourly d1-query detector contract", det);
const probe = det[0].verify_probe;
const EIGHT = ["papers-path", "lock-roundtrip", "binding-census", "deploy-coherence", "loop-heartbeats", "ai-router", "traffic-health", "negative-control"];
const iso = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString();
const tick = (d, minAgo, journeys) => { const ts = iso(minAgo); journeys.forEach((j) => d.prepare("INSERT INTO journey_runs (ts, runner, journey) VALUES (?, 'cf', ?)").run(ts, j)); };
const fill = (d, withAsk = true) => {
  for (let k = 0; k < 18 * 4; k++) tick(d, 5 + k * 20, EIGHT);   // 24 h of whole ticks every 20 minutes
  if (withAsk) for (const h of [20, 14, 8, 2]) tick(d, h * 60, ["ask-path"]);
};
let d = new DatabaseSync(":memory:"); d.exec(DDL);
let r = run(d, probe);
ok(r.expected === "ok" && r.observed.startsWith("only 0 of 18 ticks"), "no journey_runs at all: the detector names the shortfall", r);
fill(d);
r = run(d, probe);
ok(r.expected === "ok" && r.observed === "ok", "24 h of whole ticks and four ask-path runs reads ok", r);
// a partial tick inside the last 6 h
d = new DatabaseSync(":memory:"); d.exec(DDL); fill(d);
d.prepare("DELETE FROM journey_runs WHERE journey IN ('ai-router', 'traffic-health', 'negative-control') AND ts = (SELECT ts FROM journey_runs WHERE journey = 'papers-path' ORDER BY ts DESC LIMIT 1)").run();
r = run(d, probe);
ok(r.observed === "1 of the last 6 h ticks hold fewer rows than the fullest tick", "a tick that lost three rows is counted", r);
// a partial tick older than 6 h is outside the window
d = new DatabaseSync(":memory:"); d.exec(DDL); fill(d);
d.prepare("DELETE FROM journey_runs WHERE journey = 'ai-router' AND ts = (SELECT ts FROM journey_runs WHERE journey = 'papers-path' AND ts < ? ORDER BY ts DESC LIMIT 1)").run(iso(7 * 60));
ok(run(d, probe).observed === "ok", "a partial tick older than 6 h is not counted");
// ticks missing: only 12 of the 18
d = new DatabaseSync(":memory:"); d.exec(DDL);
for (let k = 0; k < 12; k++) tick(d, 5 + k * 29, EIGHT);
tick(d, 100, ["ask-path"]); tick(d, 500, ["ask-path"]); tick(d, 900, ["ask-path"]);
r = run(d, probe);
ok(/^only 12 of 18 ticks in the last 6 h$/.test(r.observed), "missing ticks are named", r);
// the ask-path slot lost, as at 18:00Z on 2026-11-04
d = new DatabaseSync(":memory:"); d.exec(DDL); fill(d, false);
tick(d, 20 * 60, ["ask-path"]); tick(d, 8 * 60, ["ask-path"]);
r = run(d, probe);
ok(r.observed === "ask-path ran in 2 of the last 4 slots", "a lost ask-path slot is named", r);
// the journey list may change: the yardstick is the fullest tick of the same 6 h, so a journey added or removed does not read as loss once the old ticks are past 6 h
d = new DatabaseSync(":memory:"); d.exec(DDL); fill(d);
for (let k = 18; k < 18 * 4; k++) d.prepare("INSERT INTO journey_runs (ts, runner, journey) SELECT ts, 'cf', 'retired-journey' FROM journey_runs WHERE journey = 'papers-path' AND ts = (SELECT ts FROM journey_runs WHERE journey = 'papers-path' ORDER BY ts DESC LIMIT 1 OFFSET ?)").run(k);
ok(run(d, probe).observed === "ok", "ticks older than 6 h that carried one more journey do not make the recent ticks read short");
d.prepare("INSERT INTO journey_runs (ts, runner, journey) SELECT ts, 'cf', 'extra' FROM journey_runs WHERE journey = 'papers-path' AND ts = (SELECT ts FROM journey_runs WHERE journey = 'papers-path' ORDER BY ts DESC LIMIT 1)").run();
ok(/^17 of the last 6 h ticks hold fewer rows/.test(run(d, probe).observed), "one tick fuller than the rest of the same 6 h makes the other 17 read short");

// ---- the doer for the portfolio write ----
const iss = db.prepare("SELECT * FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.OPS #portfolio-pr-publish:%'").all();
ok(iss.length === 1 && iss[0].status === "open" && iss[0].source === "claude-session", "the doer issue is filed once and open", iss.length);
const desc = iss[0].description;
const m = /\ncode-task: repo=qnfo-workers path=(qnfo-fleet-control\/worker\.js)\ncode-anchor: (.+)$/.exec(desc);
ok(m && m[2].startsWith("async function pfCommitOnce("), "the description ends with a code-task / code-anchor pair on a function signature", m && m[2]);
const wsrc = readFileSync(join(root, "qnfo-fleet-control", "worker.js"), "utf8");
ok(m && wsrc.split(m[2]).length === 2, "the anchor occurs exactly once in qnfo-fleet-control/worker.js", m && wsrc.split(m[2]).length - 1);
ok(/portfolio_sync_runs/.test(desc) && /require-build/.test(desc) && /Definition of done/.test(desc), "the description carries the evidence, the ruleset and a definition of done");
const c = db.prepare("SELECT * FROM remediation_contracts WHERE class = ?").get("issue-" + iss[0].id);
ok(c && c.verify_transport === "d1-query" && c.status === "active" && c.verify_probe.includes("portfolio_sync_runs") && c.attempts === 0 && c.last_verdict === null, "the birth contract is replaced by the portfolio probe", c && c.verify_probe.slice(0, 80));
const pp = c.verify_probe;
const sync = (dd, minAgo, status) => dd.prepare("INSERT INTO portfolio_sync_runs (ts, status) VALUES (?, ?)").run(iso(minAgo), status);
d = new DatabaseSync(":memory:"); d.exec(DDL);
r = run(d, pp);
ok(r.expected === "ok" && r.observed === "no portfolio sync row", "no sync row: not ok", r);
sync(d, 30, "ok");
ok(run(d, pp).observed === "ok", "a fresh ok sync reads ok");
sync(d, 5, "partial");
ok(run(d, pp).observed === "latest portfolio sync is partial", "the newest sync partial: not ok, named");
d = new DatabaseSync(":memory:"); d.exec(DDL); sync(d, 400, "ok");
ok(run(d, pp).observed === "latest portfolio sync is older than 150 minutes", "an ok sync older than 150 minutes: not ok");

// ---- decision row, replay, rollback ----
const dl = db.prepare("SELECT * FROM decision_log").all();
ok(dl.length === 1 && dl[0].action.startsWith("JOURNEY-RECORD-DURABLE-1:") && dl[0].rollback_path.length > 20 && dl[0].capability_gain.length > 20, "one decision row names the change, its rollback and its gain", dl.length);
const snap = (x) => JSON.stringify([x.prepare("SELECT COUNT(*) n FROM failure_modes").get(), x.prepare("SELECT class, verify_probe FROM remediation_contracts ORDER BY class").all(), x.prepare("SELECT COUNT(*) n FROM agent_issues").get(), x.prepare("SELECT COUNT(*) n FROM decision_log").get()]);
const before = snap(db);
db.exec(sql);
ok(snap(db) === before, "replaying the file is a no-op");
const rb = new DatabaseSync(":memory:"); rb.exec(DDL); rb.exec(sql); rb.exec(rollback);
ok(one(rb, "SELECT COUNT(*) n FROM failure_modes").n === 0 && one(rb, "SELECT COUNT(*) n FROM remediation_contracts WHERE class = 'fm-journey-ticks-cut'").n === 0, "the Rollback removes the failure mode and the detector");
ok(one(rb, "SELECT COUNT(*) n FROM agent_issues").n === 1 && one(rb, "SELECT COUNT(*) n FROM decision_log").n === 1, "the Rollback leaves the filed issue and the decision row");

// ---- the migration check ----
const PY = ["python3", "python"].find((cmd) => spawnSync(cmd, ["-I", "-c", "import sys"], { encoding: "utf8" }).status === 0);
if (PY) {
  const chk = spawnSync(PY, ["-I", join(root, "scripts", "apply_migrations.py"), "--check", FILE], { encoding: "utf8" });
  ok(chk.status === 0 && /"ok": true/.test(chk.stdout), "the file passes scripts/apply_migrations.py --check", chk.stdout + chk.stderr);
}
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
