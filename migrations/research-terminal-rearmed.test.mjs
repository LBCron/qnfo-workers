// RESEARCH-TERMINAL-REARMED-1 offline suite: replays migrations/2026-10-20-research-terminal-rearmed.sql on SQLite.
// Proves: every open RESEARCH-TERMINAL notice whose queue row is unambiguous gets research-terminal-<prefix> whose probe text equals the one qnfo-research-exec writes (terminalResolveProbe);
// the probe reads pending while the row is parked with recoveries left and resolved once the row left the terminal state, is published, or has spent both recoveries; an ambiguous prefix and a
// closed issue get none; an older contract of the class (the HARD-review one) is replaced and backed up; the unreachable published-probe of an issue that gains the contract is superseded;
// no LIKE literal in the probe exceeds D1's 50 bytes and the probe never reads agent_issues; a second apply changes nothing; the Rollback line restores the old state.
// Run: node --no-warnings migrations/research-terminal-rearmed.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { terminalResolveProbe, terminalContentKind } from "../qnfo-research-exec/worker.js";
const sql = readFileSync(new URL("./2026-10-20-research-terminal-rearmed.sql", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 300))); } };
const rollback = /^-- Rollback: (.+)$/m.exec(sql)[1];
const d = new DatabaseSync(":memory:");
d.exec(`CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, status TEXT);
  CREATE TABLE research_queue (id TEXT PRIMARY KEY, status TEXT, stage TEXT, error TEXT, terminal_rearms INTEGER DEFAULT 0);
  CREATE TABLE cloud_ops_events (id TEXT, ts TEXT, text TEXT, job TEXT, status TEXT);
  CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER, escalate_to TEXT, expected_cadence_h INTEGER, status TEXT, last_verdict TEXT, next_due_at TEXT, attempts INTEGER DEFAULT 0);
  CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);`);
const issue = (id, rid, reason, st = "open") => d.prepare("INSERT INTO agent_issues VALUES (?, ?, ?)").run(id, "RESEARCH-TERMINAL " + rid + ": " + reason, st);
const row = (id, status, stage, err, tr = 0) => d.prepare("INSERT INTO research_queue VALUES (?, ?, ?, ?, ?)").run(id, status, stage, err, tr);
const contract = (cls, issueId, probe, status) => d.prepare("INSERT INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, status) VALUES (?, ?, 'old', 'old', ?, 'd1-query', ?)").run(cls, issueId, probe, status);
const NE = "revise: no applicable edit for 1 HARD fixes (H3) from two models, strict retry included";
const HARD = "review: 6 HARD findings unresolved after 7 revise cycles (H1,H2)";
const MM = "verify: unresolved after revision - mismatch=true gates=";
// A: re-armed row (deferred), published-probe; B: parked no-edit; C: parked HARD review with an older contract of its class; D: gate failure; E: ambiguous prefix; F: closed issue; G: verify mismatch
issue(1, "aaaa1111", MM + "gate-length"); row("aaaa1111-0000-4000-8000-000000000001", "deferred", "ground", "RESEARCH-BACKPRESSURE-1", 1); contract("issue-1", 1, "SELECT 'published' AS expected, 'x' AS observed", "active");
issue(2, "bbbb2222", NE); row("bbbb2222-0000-4000-8000-000000000002", "wontfix", "parked", "REVIEW-UNRESOLVED-PARK-1: prior stage revise; " + NE, 1);
issue(3, "cccc3333", HARD); row("cccc3333-0000-4000-8000-000000000003", "wontfix", "parked", "PARKED-POISON-1: x; last error: " + HARD, 0); contract("research-terminal-cccc3333", 3, "SELECT 'parked+queue-moving' AS expected, 'pending' AS observed", "active"); contract("issue-3", 3, "SELECT 'published' AS expected, 'x' AS observed", "active");
issue(4, "dddd4444", MM + "gate-refcount"); row("dddd4444-0000-4000-8000-000000000004", "queued", "ground", "x", 1);
issue(5, "eeee5555", HARD); row("eeee5555-0000-4000-8000-000000000005", "wontfix", "parked", HARD); row("eeee5555-0000-4000-8000-000000000006", "wontfix", "parked", HARD);
issue(6, "ffff6666", NE, "closed"); row("ffff6666-0000-4000-8000-000000000007", "wontfix", "parked", NE);
issue(7, "99997777", MM); row("99997777-0000-4000-8000-000000000008", "wontfix", "parked", "PARKED-POISON-1: x; last error: " + MM);
d.exec(sql);
const cls = (c) => d.prepare("SELECT * FROM remediation_contracts WHERE class = ?").get(c);
const a = cls("research-terminal-aaaa1111"), b = cls("research-terminal-bbbb2222"), c = cls("research-terminal-cccc3333"), g = cls("research-terminal-99997777");
ok(a && a.issue_id === 1 && a.status === "active" && a.verify_transport === "d1-query", "A gets the contract", a);
ok(b && c && cls("research-terminal-dddd4444") && g, "B, C, D and G get one");
ok(!cls("research-terminal-eeee5555") && !cls("research-terminal-ffff6666"), "an ambiguous prefix and a closed issue get none");
ok(b.precondition === "row parked for a failure that may be a pipeline fault" && /HARD review findings/.test(c.precondition) && /verify mismatch/.test(g.precondition), "the precondition names the kind", [b.precondition, c.precondition, g.precondition]);
ok(c.action.startsWith("none: the row is re-armed by the park sweeps") && c.issue_id === 3 && c.status === "active", "C's older contract of the class is replaced by the superset");
const bak = d.prepare("SELECT * FROM bak_20261020_terminal_rearmed WHERE class = 'research-terminal-cccc3333'").get();
ok(bak && bak.action === "old", "the replaced contract is in the backup", bak);
ok(cls("issue-1").status === "superseded" && /TERMINAL-REARMED-1/.test(cls("issue-1").last_verdict) && cls("issue-3").status === "superseded", "the unreachable published probes of issues that gained the contract are superseded");
// the migration writes the same probe the worker writes
const wid = (p) => d.prepare("SELECT id FROM research_queue WHERE id LIKE ?").get(p + "%").id;
// SINGLE-LANE-1 (qnfo-research-exec 0.54.0): the worker's probe is now only the "left the terminal state" clause (nothing is parked any more, so the parked and spent-recovery branches are gone).
// The contracts this migration wrote keep their text; each must contain the worker's current clause, so the old probe resolves everything the new one does.
const leftOf = (p) => (/WHEN (EXISTS \(SELECT 1 FROM research_queue WHERE id = '[^']+' AND status <> 'wontfix' AND COALESCE\(stage, ''\) <> 'parked'\))/.exec(p) || [])[1];
const covers = (mig, cur) => !!leftOf(cur) && leftOf(cur) === leftOf(mig) && mig.startsWith("SELECT 'resolved' AS expected");
ok(covers(a.verify_probe, terminalResolveProbe(wid("aaaa1111"), terminalContentKind(MM + "gate-length"))), "A: migration probe contains the worker's resolve clause");
ok(covers(b.verify_probe, terminalResolveProbe(wid("bbbb2222"), terminalContentKind(NE))), "B: migration probe contains the worker's resolve clause");
ok(covers(c.verify_probe, terminalResolveProbe(wid("cccc3333"), terminalContentKind(HARD))), "C: migration probe contains the worker's resolve clause (hard-review)");
ok(covers(g.verify_probe, terminalResolveProbe(wid("99997777"), terminalContentKind(MM))), "G: migration probe contains the worker's resolve clause (mismatch)");
for (const x of [a, b, c, g]) ok(/^SELECT /.test(x.verify_probe) && !x.verify_probe.includes(";") && !/LIKE '[^']{50,}'/.test(x.verify_probe) && !/agent_issues/.test(x.verify_probe), "probe is one SELECT, no long LIKE, never reads the issue", x.class);
const probe = (x) => d.prepare(x.verify_probe).get().observed;
ok(probe(a) === "resolved", "A: the row left the terminal state, resolved");
ok(probe(b) === "pending", "B: parked with a recovery left, pending");
d.prepare("INSERT INTO cloud_ops_events VALUES ('e1', strftime('%Y-%m-%dT%H:%M:%SZ','now'), '{\"stage\":\"ground->ensemble\"}', 'qnfo-research-exec', 'ok')").run();
ok(probe(b) === "pending", "B stays pending while the queue moves (pipeline fault keeps its issue)");
ok(probe(c) === "resolved", "C: a withheld HARD-review paper with the queue moving, resolved");
ok(probe(g) === "resolved", "G: a withheld verify mismatch with the queue moving, resolved");
d.exec("UPDATE research_queue SET terminal_rearms = 2 WHERE id LIKE 'bbbb2222%'");
ok(probe(b) === "resolved", "B: both recoveries spent, resolved");
d.exec("UPDATE research_queue SET terminal_rearms = 1, status = 'queued', stage = 'ground' WHERE id LIKE 'bbbb2222%'");
ok(probe(b) === "resolved", "B: re-armed, resolved");
d.exec("UPDATE research_queue SET status = 'wontfix', stage = 'parked' WHERE id LIKE 'bbbb2222%'");
ok(probe(b) === "pending", "B: parked again with a recovery left, pending");
const n = () => [d.prepare("SELECT COUNT(*) AS n FROM remediation_contracts").get().n, d.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n].join();
const before = n();
d.exec(sql);
ok(n() === before, "a second apply changes nothing", [before, n()]);
d.exec(rollback);
ok(!cls("research-terminal-aaaa1111") && !cls("research-terminal-bbbb2222") && cls("research-terminal-cccc3333").action === "old" && cls("issue-1").status === "active", "Rollback removes the new contracts, restores the replaced one and un-supersedes");
console.log("research-terminal-rearmed: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
