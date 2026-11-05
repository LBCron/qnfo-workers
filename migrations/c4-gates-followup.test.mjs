// C4-GATES-FOLLOWUP-1 offline suite: replays migrations/2026-11-05-c4-gates-followup.sql, which (1) replaces the description of the open LOCAL-GUARD-HEARTBEAT-1 issue (filed by the merged
// migrations/2026-11-04-c4-gates-roadmap-closeout.sql, which is not edited) with the text that carries a machine code-probe line and an ISO-form heartbeat probe, and (2) reconciles the
// goal ledger with the statuses another loop (C8-GOALS-NO-DOD-1) applied first: one closeout-reconciled row per goal whose disposition differs, and the final counts on roadmap row 61.
// Run: node migrations/c4-gates-followup.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const sql = readFileSync(join(here, "2026-11-05-c4-gates-followup.sql"), "utf8");
let fail = 0, pass = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 300))); } };

const d = new DatabaseSync(":memory:");
d.exec(`CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, status TEXT, updated_at INTEGER);
  CREATE TABLE goals (id INTEGER PRIMARY KEY AUTOINCREMENT, goal_key TEXT UNIQUE, status TEXT);
  CREATE TABLE goal_lifecycle (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), goal_key TEXT NOT NULL, from_status TEXT, to_status TEXT, action TEXT NOT NULL, evidence TEXT NOT NULL);
  CREATE TABLE roadmap_implementation (id INTEGER PRIMARY KEY, item TEXT, status TEXT, evidence TEXT);`);
const OLD = "code-task: repo=qnfo-workers path=docs/ops-governance/scripts/model_guard.py\ncode-anchor: def main():\nCharter pillar: autonomy. Closing probe: SELECT COUNT(*) FROM fleet_heartbeat WHERE ts >= datetime('now','-26 hours')";
const ins = d.prepare("INSERT INTO agent_issues (title, description, source, status, updated_at) VALUES (?, ?, ?, ?, 1)");
ins.run("LOCAL-GUARD-HEARTBEAT-1: x", OLD, "session:c4-gates", "open");
ins.run("LOCAL-GUARD-HEARTBEAT-1: closed twin", OLD, "session:c4-gates", "closed");
ins.run("LOCAL-GUARD-HEARTBEAT-1: someone else's", OLD, "session:other", "open");
ins.run("OTHER-1: unrelated", "keep", "session:c4-gates", "open");
const G = { "ops-model-toolcall-crisis": "superseded", "custom-prompts-template-parity": "superseded", "kaizen-anchor-parity-2-150": "superseded", "g1ungpzy41": "superseded", "fleet-loop-actuation-gap": "adopted" };
for (const [k, s] of Object.entries(G)) d.prepare("INSERT INTO goals (goal_key, status) VALUES (?, ?)").run(k, s);
d.exec("INSERT INTO roadmap_implementation VALUES (61, 'RM-ADOPTED-GOALS-CLOSEOUT-1', 'built', 'seed'), (62, 'OTHER', 'built', 'keep')");
d.exec(sql);

// ---- (1) the issue
const rows = d.prepare("SELECT id, description, updated_at u FROM agent_issues ORDER BY id").all();
const mg = readFileSync(join(repo, "docs/ops-governance/scripts/model_guard.py"), "utf8");
ok(rows[0].description.startsWith("code-task: repo=qnfo-workers path=docs/ops-governance/scripts/model_guard.py\ncode-anchor: def main():\ncode-probe: {\"paths\": [\"docs/ops-governance/scripts/model_guard.py\"], \"contains\": \"local-guard:model_guard\"}\n"), "the open issue carries the code-task, code-anchor and code-probe lines", rows[0].description.slice(0, 300));
ok(mg.split("def main():").length === 2, "the code-anchor occurs exactly once in model_guard.py");
ok(/strftime\('%Y-%m-%dT%H:%M:%SZ','now','-26 hours'\)/.test(rows[0].description) && !/datetime\('now'/.test(rows[0].description), "the heartbeat probe compares ISO text with an ISO cutoff");
ok(/Doer:/.test(rows[0].description) && rows[0].u > 1, "the doer is named and updated_at moved");
ok(rows[1].description === OLD && rows[2].description === OLD && rows[3].description === "keep", "a closed twin, another session's issue and an unrelated issue are untouched");
ok(d.prepare("SELECT COUNT(*) n FROM bak_20261105_c4gates_issue").get().n === 2, "the backup holds the two issues of that source (the open one and its closed twin)");

// ---- (2) the ledger
const led = d.prepare("SELECT goal_key k, from_status f, to_status t, evidence e FROM goal_lifecycle WHERE action = 'closeout-reconciled' ORDER BY goal_key").all();
ok(led.length === 4 && led.map((r) => r.k).join() === "custom-prompts-template-parity,g1ungpzy41,kaizen-anchor-parity-2-150,ops-model-toolcall-crisis", "one closeout-reconciled row for each of the four superseded goals", led.map((r) => r.k));
ok(led.every((r) => r.f === "superseded" && r.t === "superseded" && /C8-GOALS-NO-DOD-1/.test(r.e) && /ledger id 30[2346]/.test(r.e)), "each row records the status the goal really has and the ledger id of the loop that set it");
ok(!led.some((r) => r.k === "fleet-loop-actuation-gap"), "a goal still adopted gets no reconciliation row");
const r61 = d.prepare("SELECT evidence e FROM roadmap_implementation WHERE id = 61").get().e;
ok(r61.startsWith("seed | RECONCILED 2026-11-05 (C4-GATES)") && /completed 2/.test(r61) && /superseded 10/.test(r61) && /adopted 3/.test(r61), "row 61 keeps its evidence and gains the final counts", r61.slice(0, 120));
ok(d.prepare("SELECT evidence e FROM roadmap_implementation WHERE id = 62").get().e === "keep", "another row is untouched");

// ---- idempotence
const snap = () => JSON.stringify([d.prepare("SELECT id, description, updated_at u FROM agent_issues ORDER BY id").all(), d.prepare("SELECT * FROM goal_lifecycle ORDER BY id").all(), d.prepare("SELECT * FROM roadmap_implementation ORDER BY id").all()]);
const first = snap();
d.exec(sql);
ok(snap() === first, "a re-run changes nothing");

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
