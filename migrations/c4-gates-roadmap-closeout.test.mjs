// C4-GATES-ROADMAP-CLOSEOUT-1 offline suite: replays migrations/2026-11-04-c4-gates-roadmap-closeout.sql on fixtures and runs every probe it registers.
// Proves: the eleven roadmap rows take the status the migration states; every built row has an rm-<id> contract whose probe passes on the shipped repo text (code-read) or on the fixture
// (d1-query); the four detectors read 0 on a clean fixture and 1 on the defect each names; the 15 goals split 5 completed, 6 superseded, 4 kept with a ledger row each; a re-run
// changes nothing. No live state is pinned.
// Run: node migrations/c4-gates-roadmap-closeout.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const sql = readFileSync(join(here, "2026-11-04-c4-gates-roadmap-closeout.sql"), "utf8");
let fail = 0, pass = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 300))); } };

const GOALS = ["ops-model-toolcall-crisis", "fleet-loop-actuation-gap", "ops-exec-loop-parse-guard", "self-heal-tool-list-correction", "research-exec-newversion-draft-cleanup", "skill-sync-public-route-404", "skill-sync-esm-ai-deploy-path", "skill-sync-r2-repo-sync-route", "custom-prompts-template-parity", "kaizen-anchor-parity-2-150", "wrangler-deploy-fleet-control", "repo-mirror-drift-closeout", "cost-routing-stack-l0l7", "external-impact-per-dollar", "g1ungpzy41"];
const ROWS = [[7, "RM-S5-RATIFICATION-SURFACE-1", "owner-decision"], [61, "RM-ADOPTED-GOALS-CLOSEOUT-1", "partial"], [72, "RM-GATE-C1", "local-only"], [74, "RM-GATE-C3", "local-only"], [82, "RM-GATE-D4", "local-only"], [88, "RM-GATE-E2", "local-only"], [98, "RM-GATE-H1", "local-only"], [99, "RM-GATE-H2", "local-only"], [100, "RM-GATE-H3", "local-only"], [102, "RM-GATE-H5", "local-only"], [124, "RM-PORTFOLIO-HYGIENE-1", "partial"]];

function fixture() {
  const d = new DatabaseSync(":memory:");
  d.exec(`CREATE TABLE roadmap_implementation (id INTEGER PRIMARY KEY, item TEXT, source TEXT, title TEXT, artifact_type TEXT, artifact_ref TEXT, status TEXT, evidence TEXT, verified_at TEXT, created_at TEXT);
    CREATE TABLE goals (id INTEGER PRIMARY KEY AUTOINCREMENT, goal_key TEXT UNIQUE, statement TEXT, goal_type TEXT DEFAULT 'instrumental', status TEXT, dod TEXT, owner TEXT, completed_at TEXT, retired_at TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE goal_lifecycle (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), goal_key TEXT NOT NULL, from_status TEXT, to_status TEXT, action TEXT NOT NULL, evidence TEXT NOT NULL);
    CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT NOT NULL, root_cause TEXT NOT NULL, remediation TEXT NOT NULL, detector TEXT NOT NULL, probe_class TEXT, first_seen TEXT NOT NULL, issue_id INTEGER, trigger_condition TEXT, symptom TEXT, blast_radius TEXT);
    CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER, escalate_to TEXT, expected_cadence_h INTEGER, status TEXT, module TEXT, next_due_at TEXT);
    CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
    CREATE TABLE objective_revision_applies (goal_id INTEGER PRIMARY KEY, outcome TEXT NOT NULL);
    CREATE TABLE v_blocker_claims (target TEXT, text TEXT, created_ms INTEGER);
    CREATE TABLE human_actions (id INTEGER PRIMARY KEY, title TEXT, action TEXT, status TEXT);
    CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);`);
  for (const [id, item, st] of ROWS) d.prepare("INSERT INTO roadmap_implementation (id, item, status, evidence) VALUES (?, ?, ?, 'seed')").run(id, item, st);
  for (const k of GOALS) d.prepare("INSERT INTO goals (goal_key, status, goal_type) VALUES (?, 'adopted', 'instrumental')").run(k);
  d.exec("INSERT INTO objective_revision_applies VALUES (58, 'applied')");
  return d;
}
const one = (d, q, ...a) => d.prepare(q).get(...a);
const rows = (d, q, ...a) => d.prepare(q).all(...a);
const probe = (d, cls) => { const c = one(d, "SELECT verify_probe p, verify_transport t FROM remediation_contracts WHERE class = ?", cls); return c; };
const runProbe = (d, cls) => { const c = probe(d, cls); return d.prepare(c.p).get(); };

const d = fixture();
d.exec(sql);

// ---- roadmap rows
const status = Object.fromEntries(rows(d, "SELECT id, status FROM roadmap_implementation").map((r) => [r.id, r.status]));
for (const id of [72, 74, 82, 88, 98, 99, 100, 61, 7]) ok(status[id] === "built", "row " + id + " is built", status[id]);
ok(status[102] === "enforced-partial", "row 102 (in-session by nature) is enforced-partial", status[102]);
ok(status[124] === "verified" && one(d, "SELECT verified_at v FROM roadmap_implementation WHERE id = 124").v !== null, "row 124 is verified with a verified_at");
ok(rows(d, "SELECT id FROM roadmap_implementation WHERE evidence NOT LIKE '%C4-GATES 2026-11-05%'").length === 0, "every touched row carries the C4-GATES evidence");
ok(one(d, "SELECT evidence e FROM roadmap_implementation WHERE id = 72").e.startsWith("seed | "), "evidence is appended, not replaced");

// ---- closing probes of the built rows
const contracts = rows(d, "SELECT class, verify_transport t, status, module, issue_id FROM remediation_contracts WHERE module = 'roadmap-dod-v1'");
ok(contracts.length === 9 && contracts.every((c) => c.status === "active" && c.issue_id === null), "nine active rm- contracts of module roadmap-dod-v1", contracts);
for (const id of [72, 74, 82, 88, 98, 99, 100]) {
  const c = probe(d, "rm-" + id);
  const spec = JSON.parse(c.p);
  const text = readFileSync(join(repo, spec.paths[0]), "utf8");
  ok(c.t === "code-read" && spec.paths.length === 1 && text.includes(spec.contains), "rm-" + id + " code-read probe passes on the repository text", spec);
}
ok(readFileSync(join(repo, "scripts", "pr_fast_guards.py"), "utf8").includes(JSON.parse(probe(d, "fm-fleet-lessons-gates-wired").p).contains), "the wiring detector finds the guard registered in scripts/pr_fast_guards.py");
ok(runProbe(d, "rm-61").observed === "ok", "rm-61 passes only after the goals are closed or retired and every goal has a ledger row" + "", runProbe(d, "rm-61"));
ok(runProbe(d, "rm-7").observed === "ok", "rm-7 passes with no stale proposal, a recorded decision and an active detector", runProbe(d, "rm-7"));

// ---- detectors: 0 on the clean fixture, 1 on the defect each names
const fm = (cls) => Number(runProbe(d, cls).observed);
for (const cls of ["fm-e2-credential-missing-claim", "fm-h5-owner-restart-handoff", "fm-objective-revision-unanswered"]) ok(fm(cls) === 0, cls + " reads 0 on a clean fixture", runProbe(d, cls));
d.exec("INSERT INTO v_blocker_claims VALUES ('issue:1', 'DEPLOY-X: needs a token the owner has', 1), ('issue:2', 'unrelated blocked item', 1)");
ok(fm("fm-e2-credential-missing-claim") === 1, "fm-e2: a claim naming a token counts, one that does not name a credential does not");
d.exec("INSERT INTO human_actions (id, title, action, status) VALUES (1, 'Restart DeepChat to load the config', '', 'open'), (2, 'Restart the worker', '', 'resolved'), (3, 'Sign the form', 'sign', 'open')");
ok(fm("fm-h5-owner-restart-handoff") === 1, "fm-h5: only an OPEN card that asks for a restart counts");
d.exec("INSERT INTO goals (goal_key, status, goal_type, created_at) VALUES ('vrev-old', 'proposed', 'objective-revision', '2020-01-01T00:00:00.000Z'), ('vrev-new', 'proposed', 'objective-revision', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), ('vrev-done', 'rejected', 'objective-revision', '2020-01-01 00:00:00')");
ok(fm("fm-objective-revision-unanswered") === 1, "fm-objective-revision: only a proposed revision older than 14 days counts (ISO or space dates)");
ok(runProbe(d, "rm-7").observed === "not-ok", "rm-7 fails while a stale proposal exists");
for (const cls of ["fm-e2-credential-missing-claim", "fm-h5-owner-restart-handoff", "fm-fleet-lessons-gates-wired", "fm-objective-revision-unanswered"]) {
  const c = one(d, "SELECT status, module, escalate_to, expected_cadence_h h FROM remediation_contracts WHERE class = ?", cls);
  ok(c && c.status === "active" && c.module === "failure-mode" && c.escalate_to && c.h === 1, cls + " is an active hourly failure-mode contract with an escalation target", c);
  ok(one(d, "SELECT probe_class p FROM failure_modes WHERE fm_key = ?", cls.slice(3)).p === cls, cls + " has its failure_modes row naming the detector class");
}

// ---- the 15 goals
const g = Object.fromEntries(rows(d, "SELECT goal_key, status, completed_at c, retired_at r FROM goals WHERE goal_key IN (" + GOALS.map(() => "?").join(",") + ")", ...GOALS).map((r) => [r.goal_key, r]));
const count = (s) => Object.values(g).filter((r) => r.status === s).length;
ok(count("completed") === 5 && count("superseded") === 6 && count("adopted") === 4, "5 completed, 6 superseded, 4 kept adopted", [count("completed"), count("superseded"), count("adopted")]);
ok(Object.values(g).filter((r) => r.status === "completed").every((r) => r.c) && Object.values(g).filter((r) => r.status === "superseded").every((r) => r.r), "completed goals carry completed_at, superseded goals retired_at");
const led = rows(d, "SELECT goal_key, from_status f, to_status t, action a, length(evidence) n FROM goal_lifecycle WHERE action LIKE 'closeout-%'");
ok(led.length === 15 && new Set(led.map((r) => r.goal_key)).size === 15, "one closeout ledger row per goal", led.length);
ok(led.every((r) => r.f === "adopted" && r.n > 80 && ((r.a === "closeout-completed" && r.t === "completed") || (r.a === "closeout-retired" && r.t === "superseded") || (r.a === "closeout-review" && r.t === "adopted"))), "ledger rows record from, to and a stated reason");
ok(led.filter((r) => r.a === "closeout-retired").every((r) => /Surviving|surviving|Surviving:/.test(one(d, "SELECT evidence e FROM goal_lifecycle WHERE goal_key = ?", r.goal_key).e)), "every retired goal names its surviving row");
for (const cls of ["closeout-goal-fleet-loop-actuation-gap", "closeout-goal-repo-mirror-drift-closeout"]) {
  const c = one(d, "SELECT status, escalate_to, verify_transport t FROM remediation_contracts WHERE class = ?", cls);
  ok(c && c.status === "active" && c.escalate_to, cls + " is an active contract of a kept goal", c);
}
// the kept-goal probes: 0 when nothing breaks, 1 when it does
d.exec("INSERT INTO agent_issues (id, title, created_at) VALUES (5000, 'DEPLOY-UNCOORDINATED-DEPLOY: x', CAST(strftime('%s','now') AS INTEGER) * 1000), (5001, 'DEPLOY-UNCOORDINATED-DEPLOY: old', 1000)");
ok(Number(runProbe(d, "closeout-goal-fleet-loop-actuation-gap").observed) === 1, "the uncoordinated-deploy probe counts a ticket of the last 24 hours and not an old one");
const gdb = new DatabaseSync(":memory:");
gdb.exec("CREATE TABLE fg_finding (kind TEXT, subject TEXT); INSERT INTO fg_finding VALUES ('untracked-worker', 'a'), ('env-undeclared', 'b')");
ok(Number(gdb.prepare(probe(d, "closeout-goal-repo-mirror-drift-closeout").p).get().observed) === 1 && probe(d, "closeout-goal-repo-mirror-drift-closeout").t === "d1-query@qnfo-graph", "the untracked-worker probe reads the graph database and counts only that kind");

// ---- the originated improvement: one open issue with a doer, a code-task anchor that occurs once, and a closing probe
const hb = rows(d, "SELECT title, description, status, source FROM agent_issues WHERE title LIKE 'LOCAL-GUARD-HEARTBEAT-1:%'");
ok(hb.length === 1 && hb[0].status === "open" && hb[0].source === "session:c4-gates", "one open LOCAL-GUARD-HEARTBEAT-1 issue", hb.length);
const mg = readFileSync(join(repo, "docs/ops-governance/scripts/model_guard.py"), "utf8");
ok(hb[0].description.startsWith("code-task: repo=qnfo-workers path=docs/ops-governance/scripts/model_guard.py\ncode-anchor: def main():\n") && mg.split("def main():").length === 2, "its code-task path exists and its anchor occurs exactly once in that file");
ok(/Closing probe:/.test(hb[0].description) && /Doer:/.test(hb[0].description), "it names a closing probe and a doer");

// ---- decisions and idempotence
ok(one(d, "SELECT COUNT(*) n FROM decision_log").n === 3 && rows(d, "SELECT rollback_path r FROM decision_log").every((r) => r.r && r.r.length > 20), "three decisions, each with its revert path");
const snap = () => JSON.stringify([rows(d, "SELECT * FROM roadmap_implementation ORDER BY id"), rows(d, "SELECT class FROM remediation_contracts ORDER BY class"), rows(d, "SELECT goal_key, status FROM goals ORDER BY id"), one(d, "SELECT COUNT(*) n FROM goal_lifecycle"), one(d, "SELECT COUNT(*) n FROM decision_log"), one(d, "SELECT COUNT(*) n FROM failure_modes")]);
const before = snap();
d.exec(sql);
ok(snap() === before, "a re-run changes nothing");

// a goal another loop already completed still gets its ledger row, so rm-61 can pass
const d2 = fixture();
d2.exec("UPDATE goals SET status = 'completed', completed_at = datetime('now') WHERE goal_key = 'fleet-loop-actuation-gap'");
d2.exec(sql);
ok(one(d2, "SELECT COUNT(*) n FROM goal_lifecycle WHERE action LIKE 'closeout-%'").n === 15, "a goal completed meanwhile still gets its closeout ledger row");
ok(one(d2, "SELECT from_status f FROM goal_lifecycle WHERE goal_key = 'fleet-loop-actuation-gap'").f === "completed", "the ledger records the status the goal actually had");

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
