// RM-BS-SELF-REPORTING-PLATFORM-1 offline suite: replays migrations/2026-11-05-rm-bs-self-reporting-platform-1.sql on node:sqlite.
// Proves: the header opts in; the view classes each worker both-quiet / agree / differ / capture-blind / platform-blind from the latest census day and the last 24 hours of worker_logs
// (rows older than 24 hours and older census days are ignored); the detector contract reads 0 until a worker has 20 census errors and nothing captured, then 1; the follow-up issue's path
// exists and its anchor occurs once; a replay changes nothing; the Rollback line removes the view and supersedes the detector. Output MUST contain "0 failed" on success.
// Run: node migrations/rm-bs-self-reporting-platform-1.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync } from "node:fs";

const root = new URL("../", import.meta.url);
const rd = (rel) => readFileSync(new URL(rel, root), "utf8");
const sql = rd("migrations/2026-11-05-rm-bs-self-reporting-platform-1.sql");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };

const header = sql.split("\n").filter((l) => l.startsWith("--"));
const body = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
ok(header.some((l) => /^-- APPLY-BY: ci\s*$/.test(l)) && header.some((l) => /^-- DB: qnfo-audit\s*$/.test(l)), "header opts in");
const rollback = header.filter((l) => /^-- Rollback:/.test(l));
ok(rollback.length === 1, "exactly one Rollback line");
ok(!/^\s*(DELETE\s+FROM|DROP\s+(TABLE|INDEX|VIEW|TRIGGER))\b/im.test(body), "the body deletes and drops nothing");
ok(!/claude\.ai|anthropic\.com/i.test(sql), "no claude.ai or anthropic.com link");
ok(Array.from(body.matchAll(/LIKE\s+'((?:[^']|'')*)'/gi)).every((m) => Buffer.byteLength(m[1]) <= 50), "every LIKE pattern is at most 50 bytes");
ok(!/\b(update|insert|delete|drop|alter)\s/i.test(body.match(/'SELECT ''0'' AS expected[^;]*'/)[0]), "the probe text carries no write keyword");

const nowS = Math.floor(Date.now() / 1000);
function world() {
  const w = new DatabaseSync(":memory:");
  w.exec(`CREATE TABLE worker_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, ts_ms INTEGER, script_name TEXT, event_type TEXT, outcome TEXT, status INTEGER);
CREATE TABLE worker_usage_daily (day TEXT NOT NULL, script TEXT NOT NULL, requests_24h INTEGER, errors_24h INTEGER, requests_7d INTEGER, errors_7d INTEGER, source TEXT, ts TEXT, PRIMARY KEY (day, script));
CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT, root_cause TEXT, remediation TEXT, detector TEXT, probe_class TEXT, first_seen TEXT, issue_id INTEGER, trigger_condition TEXT, symptom TEXT, blast_radius TEXT);
CREATE TABLE remediation_contracts (id INTEGER PRIMARY KEY AUTOINCREMENT, class TEXT UNIQUE, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER, escalate_to TEXT, expected_cadence_h INTEGER, status TEXT, module TEXT, next_due_at TEXT);
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, linked_session TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT, outcome_matched INTEGER);`);
  return w;
}
const census = (w, day, script, req, err) => w.prepare("INSERT INTO worker_usage_daily (day, script, requests_24h, errors_24h) VALUES (?, ?, ?, ?)").run(day, script, req, err);
const log = (w, script, outcome, n, ageS = 60) => { const st = w.prepare("INSERT INTO worker_logs (ts_ms, script_name, event_type, outcome, status) VALUES (?, ?, 'telemetry:fetch', ?, NULL)"); for (let i = 0; i < n; i++) st.run((nowS - ageS - i) * 1000, script, outcome); };
const klass = (w) => Object.fromEntries(w.prepare("SELECT script, agreement FROM v_telemetry_capture_agreement").all().map((r) => [r.script, r.agreement]));
const detector = (w) => { const p = w.prepare("SELECT verify_probe FROM remediation_contracts WHERE class = 'fm-telemetry-capture-blind'").get().verify_probe; const r = w.prepare(p).get(); return r.observed; };

const w = world();
w.exec(body);
census(w, "2026-11-04", "old-day", 100, 90);                    // older census day: ignored
census(w, "2026-11-05", "quiet", 300, 0);
census(w, "2026-11-05", "agree-a", 500, 20); log(w, "agree-a", "exception", 24);
census(w, "2026-11-05", "differ-b", 500, 3); log(w, "differ-b", "exception", 60);
census(w, "2026-11-05", "plat-blind", 900, 0); log(w, "plat-blind", "exception", 40);
census(w, "2026-11-05", "cap-blind-small", 400, 6);
census(w, "2026-11-05", "canceled-only", 600, 0); log(w, "canceled-only", "canceled", 78); // client disconnects are not failures
census(w, "2026-11-05", "stale-rows", 200, 0); log(w, "stale-rows", "exception", 50, 3 * 86400); // captured 3 days ago: outside the window
log(w, "nocensus", "exception", 12);                            // captured failures, no census row

const k = klass(w);
ok(k["quiet"] === "both-quiet" && k["canceled-only"] === "both-quiet" && k["stale-rows"] === "both-quiet", "quiet, canceled-only and stale-capture workers are both-quiet", k);
ok(k["agree-a"] === "agree" && k["differ-b"] === "differ", "20 vs 24 agree; 3 vs 60 differ", k);
ok(k["plat-blind"] === "platform-blind" && k["nocensus"] === "platform-blind", "captured failures the census does not count are platform-blind (including a worker with no census row)", k);
ok(k["cap-blind-small"] === "capture-blind", "6 census errors and nothing captured is capture-blind", k);
ok(!("old-day" in k), "an older census day is not read", Object.keys(k));
ok(detector(w) === "0", "detector reads 0 while the only capture-blind worker has fewer than 20 census errors", detector(w));
census(w, "2026-11-05", "cap-blind-big", 100, 80);
ok(detector(w) === "1", "detector reads 1 once a worker has 80 census errors and nothing captured", detector(w));
log(w, "cap-blind-big", "exception", 3);
ok(detector(w) === "0", "detector reads 0 again once the capture holds a failure for it", detector(w));

ok(w.prepare("SELECT COUNT(*) n FROM failure_modes WHERE fm_key = 'telemetry-capture-blind' AND probe_class = 'fm-telemetry-capture-blind'").get().n === 1, "failure mode row with its detector class");
const issue = w.prepare("SELECT title, description FROM agent_issues").get();
const pth = /^code-task: repo=qnfo-workers path=(\S+)$/m.exec(issue.description), anc = /^code-anchor: (.+)$/m.exec(issue.description);
ok(pth && anc && existsSync(new URL(pth[1], root)), "follow-up issue routes to an existing file");
if (pth && anc) ok(rd(pth[1]).split(anc[1]).length - 1 === 1, "its anchor occurs exactly once in " + pth[1]);
ok(/^code-probe: \{.+\}$/m.test(issue.description) && /^ROADMAP-1: QNFO\.INFRA W2-J-OBS-2/.test(issue.title), "follow-up issue carries a code-probe and the ROADMAP-1 title");

const tables = ["failure_modes", "remediation_contracts", "agent_issues", "decision_log"];
const before = tables.map((t) => w.prepare("SELECT COUNT(*) n FROM " + t).get().n);
w.exec(body);
ok(JSON.stringify(before) === JSON.stringify(tables.map((t) => w.prepare("SELECT COUNT(*) n FROM " + t).get().n)), "a replay changes nothing", before);

w.exec(rollback[0].replace(/^-- Rollback:\s*/, ""));
ok(w.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name = 'v_telemetry_capture_agreement'").get().n === 0, "Rollback drops the view");
ok(w.prepare("SELECT status FROM remediation_contracts").get().status === "superseded", "Rollback supersedes the detector");

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
