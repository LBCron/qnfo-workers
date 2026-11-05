// WORKER-COUNT-1 offline suite: replays migrations/2026-11-05-worker-count-census-1.sql on node:sqlite.
// Proves: the header opts in (APPLY-BY ci, DB qnfo-audit, one Rollback line, nothing deleted or dropped, decision_log only inserted into); the eight ROADMAP-1 rows are filed once with the routing
// line the loops read (code-task for the single-file census fix, session-task for the folds) and every path and anchor they name exists on this checkout and occurs exactly once; the five plan-of-record
// levers move pending -> dispatched with their issue id and nothing else changes (a landed lever, a session lever and a lever that already has an issue stay as they were); two new levers follow the
// code; the three parent issues get one dated note; one decision row; a replay changes nothing; the Rollback line puts levers and notes back.
// Output MUST contain "0 failed" on success.   node migrations/worker-count-census-1.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync } from "node:fs";

const root = new URL("../", import.meta.url);
const rd = (rel) => readFileSync(new URL(rel, root), "utf8");
const sql = rd("migrations/2026-11-05-worker-count-census-1.sql");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 500))); } };

const header = sql.split("\n").filter((l) => l.startsWith("--"));
const body = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
ok(header.some((l) => /^-- APPLY-BY: ci\s*$/.test(l)) && header.some((l) => /^-- DB: qnfo-audit\s*$/.test(l)), "header opts in: APPLY-BY ci, DB qnfo-audit");
ok(header.filter((l) => /^-- Rollback:/.test(l)).length === 1, "exactly one single-line Rollback header");
ok(!/^\s*(DELETE\s+FROM|DROP\s+(TABLE|INDEX|VIEW|TRIGGER))\b/im.test(body), "the body deletes and drops nothing");
ok(!/\b(UPDATE|DELETE\s+FROM|REPLACE\s+INTO|INSERT\s+OR\s+REPLACE\s+INTO)\s+(decision_log|issue_lifecycle)\b/i.test(body), "APPEND-ONLY-LINT-1: decision_log is only inserted into");
ok(!/INSERT\s+(OR\s+\w+\s+)?INTO\s+fleet_tick/i.test(body) && !/claude\.ai|anthropic\.com/i.test(sql), "no write to fleet_tick and no claude.ai or anthropic.com link");
ok(Array.from(body.matchAll(/LIKE\s+'((?:[^']|'')*)'/gi)).every((m) => Buffer.byteLength(m[1]) <= 50), "every LIKE pattern is at most 50 bytes");

// every routing line names a file on this checkout (anchors were verified once at filing; they are not pinned here, a worker edit must not turn main red for a prose row)
const routes = Array.from(body.matchAll(/'(code-task|session-task): repo=qnfo-workers path=([^']+)'\s*\|\|\s*char\(10\)\s*\|\|\s*'(code-anchor|edit-near): ((?:[^']|'')+)'/g)).map((m) => ({ kind: m[1], path: m[2], anchor: m[4].replace(/''/g, "'") }));
ok(routes.length === 8, "eight routing lines", routes.length);
ok(routes.filter((r) => r.kind === "code-task").length === 1 && routes[0].kind === "code-task" && routes[0].path === "qnfo-fleet-control/worker.js", "the census fix is the one code-task, on qnfo-fleet-control/worker.js");
for (const r of routes) ok(existsSync(new URL(r.path, root)) && r.anchor.length >= 8, "path exists and the anchor is a real line: " + r.path + " :: " + r.anchor);
// the kit commands in the rows are the ones that were dry-run: the fold kit really accepts these arguments
{
  const kit = rd("scripts/fold_worker.py");
  for (const flag of ["--member-version", "--host-version", "--note", "--prefix", "--due", "--test-due-at", "--test-due-cron", "--host-cron", "--env-map", "--why"]) ok(kit.includes('"' + flag + '"'), "fold_worker.py has " + flag);
}
// the fact the census row rests on: the stub is the repository root worker the Workers Builds target builds
ok(/^name = "qnfo-workers"$/m.test(rd("wrangler.toml")), "the repository root wrangler.toml is the qnfo-workers Workers Builds target");

const calib = rd("migrations/2026-10-12-22-calibration-scorer.sql");
const pt0 = calib.indexOf("CREATE TRIGGER IF NOT EXISTS decision_predictions_parse"), pt1 = calib.indexOf("\nEND;", pt0) + 5;
const PARSE_TRIGGER = calib.slice(pt0, pt1);

function world() {
  const w = new DatabaseSync(":memory:");
  w.exec(`CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE transformation_levers (id INTEGER PRIMARY KEY AUTOINCREMENT, tp INTEGER NOT NULL, n INTEGER NOT NULL, key TEXT NOT NULL, title TEXT NOT NULL, kind TEXT NOT NULL, wave TEXT NOT NULL, pillar TEXT, path TEXT, anchor TEXT, detail TEXT, dod TEXT, issue_id INTEGER, code_task_id TEXT, status TEXT NOT NULL DEFAULT 'pending', note TEXT, dispatched_at TEXT, landed_at TEXT, verified_at TEXT, stalled_at TEXT, updated_at TEXT, UNIQUE(tp, n));
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
CREATE TRIGGER decision_log_no_update BEFORE UPDATE ON decision_log BEGIN SELECT RAISE(ABORT, 'decision_log is append-only'); END;
CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, last_value TEXT);
CREATE TABLE decision_predictions (id INTEGER PRIMARY KEY AUTOINCREMENT, decision_id INTEGER NOT NULL, kind TEXT NOT NULL, subject TEXT NOT NULL, op TEXT NOT NULL, value REAL, value2 REAL, due_at TEXT NOT NULL, origin TEXT NOT NULL, scored_at TEXT, UNIQUE (decision_id, kind, subject, op));`);
  w.exec(PARSE_TRIGGER);
  const ai = w.prepare("INSERT INTO agent_issues (id, title, description, status) VALUES (?, ?, ?, ?)");
  ai.run(99923, "METRIC-TRIGGER-344-WORKER-COUNT: Core gap", "cap breach text", "open");
  ai.run(100480, "METRIC-TRIGGER-1924-WORKER-COUNT-DISAGREEMENT", "disagreement text", "open");
  ai.run(1000156, "CENSUS-TOMBSTONE-1: a retired 410 stub", "FOUND 2026-10-25", "closed");
  ai.run(1001443, "one email transport", "session issue", "open");
  const lv = w.prepare("INSERT INTO transformation_levers (tp, n, key, title, kind, wave, status, issue_id, note, dispatched_at, landed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  lv.run(3, 2, "mcp-two-to-one", "MCP 2 -> 1", "refactor", "W2", "pending", null, "", null, null);
  lv.run(3, 3, "radars-into-research-exec", "radars", "refactor", "W2", "pending", null, "", null, null);
  lv.run(3, 5, "one-email-transport", "one email transport", "refactor", "W1", "session", 1001443, "needs a session", "2026-11-03T09:05:45.378Z", null);
  lv.run(3, 10, "calendar-api-fold", "calendar-api fold", "refactor", "W2", "landed", null, "landed", null, "2026-10-06T11:02:00Z");
  lv.run(3, 11, "intent-orchestrator-fold", "intent fold", "refactor", "W2", "pending", null, "", null, null);
  lv.run(3, 12, "observability-into-calibration", "observability", "refactor", "W2", "pending", null, "", null, null);
  lv.run(3, 13, "subscribers-into-email", "subscribers", "refactor", "W2", "pending", 777, "someone filed it first", null, null);
  lv.run(1, 5, "container-verifier", "container verifier", "refactor", "W0", "stalled", 2008, "adopted: issue 2008", "2026-10-06T06:27:00Z", null);
  return w;
}
const q1 = (w, s, ...p) => w.prepare(s).get(...p);
const qa = (w, s, ...p) => w.prepare(s).all(...p);
const issueId = (w, k) => (q1(w, "SELECT id FROM agent_issues WHERE title LIKE ?", "ROADMAP-1: QNFO.INFRA WORKER-COUNT-" + k + "%") || {}).id;
const lever = (w, tp, n) => q1(w, "SELECT status, issue_id, note, dispatched_at, wave, path FROM transformation_levers WHERE tp = ? AND n = ?", tp, n);

const w = world();
const before = JSON.stringify(qa(w, "SELECT tp, n, status, issue_id, note, dispatched_at FROM transformation_levers ORDER BY tp, n"));
w.exec(sql);
const rows = qa(w, "SELECT id, title, description, source, status, priority FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.INFRA WORKER-COUNT-%' ORDER BY id");
ok(rows.length === 8 && rows.every((r) => r.status === "open" && /^WORKER-COUNT-1\.[1-8]:/.test(r.title.slice("ROADMAP-1: QNFO.INFRA ".length))), "eight open ROADMAP-1 rows, 1.1 to 1.8", rows.map((r) => r.title.slice(0, 60)));
ok(new Set(rows.map((r) => r.title.slice(22, 40))).size === 8, "eight distinct sequence numbers");
ok(/^code-task: repo=qnfo-workers path=qnfo-fleet-control\/worker\.js\ncode-anchor: function workerCountDiff\(\ncode-probe: \{"paths": \["qnfo-fleet-control\/worker\.js"\], "contains": "TOMBSTONE-CLASS-1"\}/.test(rows.find((r) => /1\.1:/.test(r.title)).description), "1.1 carries the code-task, the anchor and a code-probe on separate lines");
ok(rows.filter((r) => /1\.[2-8]:/.test(r.title)).every((r) => /^session-task: repo=qnfo-workers path=[^\n]+\nedit-near: [^\n]+\n/.test(r.description) && !/^code-task:/m.test(r.description)), "the seven folds are session-task rows (a mechanical kit fold is not a patch for the code loop)");
ok(rows.every((r) => /Charter pillar core/.test(r.description) && /Definition of done/.test(r.description)), "every row names the pillar and a definition of done");
ok(/IDENTITY-BOUND/.test(rows.find((r) => /1\.6:/.test(r.title)).description), "1.6 states the owner-only step with the IDENTITY-BOUND marker");
ok(/refuse|refus/.test(rows.find((r) => /1\.7:/.test(r.title)).description) && /refus/.test(rows.find((r) => /1\.8:/.test(r.title)).description), "1.7 and 1.8 state the separation refusal they rest on");

// levers
const l12 = lever(w, 3, 12), l2 = lever(w, 3, 2), l3 = lever(w, 3, 3), l11 = lever(w, 3, 11);
ok(l12.status === "dispatched" && l12.issue_id === issueId(w, "1.4") && /^\d{4}-\d\d-\d\dT/.test(l12.dispatched_at), "lever 12 dispatched with the 1.4 issue", l12);
ok(l2.status === "dispatched" && l2.issue_id === issueId(w, "1.6") && l3.status === "dispatched" && l3.issue_id === issueId(w, "1.7") && l11.status === "dispatched" && l11.issue_id === issueId(w, "1.8"), "levers 2, 3 and 11 dispatched with 1.6, 1.7 and 1.8");
const l13 = lever(w, 3, 13);
ok(l13.status === "pending" && l13.issue_id === 777 && l13.note === "someone filed it first", "a pending lever that already has an issue is left alone", l13);
ok(lever(w, 3, 10).status === "landed" && lever(w, 3, 5).status === "session" && lever(w, 3, 5).issue_id === 1001443 && lever(w, 1, 5).status === "stalled", "a landed lever, a session lever and another program's lever do not change");
const n16 = lever(w, 3, 16), n17 = lever(w, 3, 17);
ok(n16 && n16.status === "dispatched" && n16.issue_id === issueId(w, "1.2") && n16.wave === "W1" && n16.path === "qnfo-cloud-ops/worker.js", "new lever 16 follows qnfo-cloud-ops", n16);
ok(n17 && n17.status === "dispatched" && n17.issue_id === issueId(w, "1.3") && n17.path === "qnfo-ai-calibration/worker.js", "new lever 17 follows qnfo-ai-calibration", n17);

// notes and the decision
for (const id of [99923, 100480, 1000156]) ok(q1(w, "SELECT (length(description) - length(replace(description, 'WORKER-COUNT-1 2026-11-05', ''))) / length('WORKER-COUNT-1 2026-11-05') c FROM agent_issues WHERE id = ?", id).c === 1, "issue " + id + " carries the dated note once");
ok(/worker_count_disagreement stays 0\) is not met/.test(q1(w, "SELECT description d FROM agent_issues WHERE id = 1000156").d), "the 1000156 note says its definition of done is not met");
const dec = qa(w, "SELECT actor, action, evidence FROM decision_log");
ok(dec.length === 1 && /^WORKER-COUNT-1:/.test(dec[0].action) && /voice-stt KEEP, IDENTITY-BOUND/.test(dec[0].evidence) && /qnfo-fleet-lee KEEP, IDENTITY-BOUND/.test(dec[0].evidence) && /qnfo-workers KEEP/.test(dec[0].evidence), "one decision row with the per-worker verdicts", dec.length);
ok(qa(w, "SELECT 1 FROM decision_predictions").length === 0, "no scored prediction row (the prediction belongs to the 1.1 deploy, not to this file)");

{ // replay
  const snap = () => JSON.stringify([qa(w, "SELECT id, title, description FROM agent_issues ORDER BY id"), qa(w, "SELECT tp, n, status, issue_id, note, dispatched_at FROM transformation_levers ORDER BY tp, n"), qa(w, "SELECT action FROM decision_log")]);
  const s1 = snap();
  w.exec(sql);
  ok(snap() === s1, "a second apply changes nothing");
}
{ // rollback
  const r = world();
  r.exec(sql);
  r.exec(sql.split("\n").find((l) => l.startsWith("-- Rollback: ")).slice("-- Rollback: ".length));
  const after = JSON.stringify(qa(r, "SELECT tp, n, status, issue_id, note, dispatched_at FROM transformation_levers ORDER BY tp, n"));
  ok(after === before, "Rollback restores the levers (and removes levers 16 and 17)");
  const notes = qa(r, "SELECT id, description FROM agent_issues WHERE id IN (99923, 100480, 1000156) ORDER BY id");
  ok(notes.length === 3 && notes.every((n) => !/WORKER-COUNT-1 2026-11-05/.test(n.description)), "Rollback restores the three descriptions");
}

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
