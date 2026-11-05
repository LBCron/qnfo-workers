// W2-E wrap-up offline suite: replays migrations/2026-11-05-w2e-wrapup.sql on node:sqlite (with a stand-in for the birth-contract trigger).
// Proves: the header opts in (APPLY-BY ci, DB qnfo-audit, one Rollback line, BACKUP named for its delete, nothing deleted in the body, LIKE patterns at most 50 bytes); each named roadmap row gains exactly one dated note
// and keeps its old evidence, row 5 alone changes status (partial to built), no other row changes; two open issues are filed once (OPS-DEGRADED-2 with code-task, code-anchor, code-probe and the cold-pickup sections:
// what to change, what not to touch, verify live, definition of done; ROW-FLIPS-W2E-1 with its three steps); the closing contract of ROW-FLIPS-W2E-1 becomes an active read-only measuring probe that fails today
// and passes once the rows left their waiting states; a replay changes nothing; the Rollback line puts rows, status, issues and contract back. No assertion reads the repository (a state that ends when the work lands
// would turn main red).
// Output MUST contain "0 failed" on success.   node migrations/w2e-wrapup.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("./2026-11-05-w2e-wrapup.sql", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };

const header = sql.split("\n").filter((l) => l.startsWith("--"));
const body = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
ok(header.some((l) => /^-- APPLY-BY: ci\s*$/.test(l)) && header.some((l) => /^-- DB: qnfo-audit\s*$/.test(l)), "header opts in: APPLY-BY ci, DB qnfo-audit");
ok(header.filter((l) => /^-- Rollback:/.test(l)).length === 1 && header.some((l) => /^-- BACKUP: agent_issues\s*$/.test(l)), "one Rollback line and the BACKUP header for its delete");
ok(!/^\s*(DELETE\s+FROM|DROP\s+(TABLE|INDEX|VIEW|TRIGGER))\b/im.test(body), "the body deletes and drops nothing");
const likes = [...body.matchAll(/LIKE\s+''?([^']*)''?/gi)].map((m) => m[1]);
ok(likes.every((p) => Buffer.byteLength(p) <= 50), "no LIKE pattern over 50 bytes (D1 rejects longer)", likes);

const ROWS = [1, 5, 6, 8, 10, 126, 127, 128, 131, 133, 134, 129];
function world() {
  const w = new DatabaseSync(":memory:");
  w.exec(`CREATE TABLE roadmap_implementation (id INTEGER PRIMARY KEY, item TEXT, source TEXT, status TEXT, evidence TEXT, verified_at TEXT);
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, verify_probe TEXT, verify_transport TEXT, status TEXT, last_verdict TEXT, next_due_at TEXT);
CREATE TRIGGER birth_contract AFTER INSERT ON agent_issues BEGIN INSERT INTO remediation_contracts (class, issue_id, precondition, verify_probe, verify_transport, status, last_verdict) VALUES ('issue-' || NEW.id, NEW.id, 'birth', 'SELECT 1', 'd1-query', 'superseded', 'superseded:closure-observing-probe-at-birth'); END;`);
  for (const id of ROWS) w.prepare("INSERT INTO roadmap_implementation (id, item, source, status, evidence) VALUES (?, ?, 'x', ?, ?)").run(id, "RM-" + id, id === 5 ? "partial" : id === 134 ? "built" : id === 1 ? "not-built" : "partial", "OLD" + id);
  return w;
}
const q1 = (w, s, ...p) => w.prepare(s).get(...p);
const qa = (w, s, ...p) => w.prepare(s).all(...p);
const snap = (w) => JSON.stringify([qa(w, "SELECT * FROM roadmap_implementation ORDER BY id"), qa(w, "SELECT id, title, description, source, status FROM agent_issues ORDER BY id"), qa(w, "SELECT * FROM remediation_contracts ORDER BY class")]);

const w = world();
const before = snap(w);
w.exec(sql);
for (const id of [1, 5, 6, 8, 10, 126, 127, 128, 131, 133, 134]) {
  const r = q1(w, "SELECT status, evidence FROM roadmap_implementation WHERE id = ?", id);
  ok(r.evidence.startsWith("OLD" + id + " || W2E-WRAP 2026-11-05:") && r.evidence.split("W2E-WRAP 2026-11-05").length === 2, "row " + id + " keeps its evidence and gains one dated note", r.evidence.slice(0, 80));
}
ok(q1(w, "SELECT status s FROM roadmap_implementation WHERE id = 5").s === "built", "row 5 moves partial to built");
ok([1, 6, 8, 10, 126, 127, 128, 131, 133].every((id) => q1(w, "SELECT status s FROM roadmap_implementation WHERE id = ?", id).s === (id === 1 ? "not-built" : "partial")) && q1(w, "SELECT status s FROM roadmap_implementation WHERE id = 134").s === "built", "no other row changes status (row 134 stays built until its reading)");
ok(q1(w, "SELECT evidence e FROM roadmap_implementation WHERE id = 129").e === "OLD129", "a row W2-E did not work is untouched");
ok(!/\bverified\b/i.test(q1(w, "SELECT evidence e FROM roadmap_implementation WHERE id = 6").e.slice(4)), "row 6 note does not claim a verification it does not have");
ok(/NOT yet seen live/.test(q1(w, "SELECT evidence e FROM roadmap_implementation WHERE id = 5").e) && /NOT proven live/.test(q1(w, "SELECT evidence e FROM roadmap_implementation WHERE id = 10").e), "the notes say plainly what is not proven live");

const issues = qa(w, "SELECT * FROM agent_issues ORDER BY id");
ok(issues.length === 2 && issues.every((i) => i.status === "open" && i.source === "session:W2-E-wrap" && /^ROADMAP-1: QNFO\.OPS (OPS-DEGRADED-2|ROW-FLIPS-W2E-1):/.test(i.title)), "two open ROADMAP-1 issues are filed", issues.map((i) => i.title.slice(0, 50)));
const [i2, iflip] = issues;
const d = i2.description;
ok(/charter pillar autonomy/.test(d) && /WHAT TO CHANGE/.test(d) && /WHAT NOT TO TOUCH/.test(d) && /VERIFY LIVE/.test(d) && /DEFINITION OF DONE/.test(d) && /PREDICTION/.test(d) && /FALSIFIER/.test(d) && /TESTS/.test(d) && /RELEASE/.test(d), "OPS-DEGRADED-2 carries the cold-pickup sections");
const path = (/code-task: repo=qnfo-workers path=(\S+)/.exec(d) || [])[1];
const anchor = (/\ncode-anchor: (.*)\n/.exec(d) || [])[1];
const probe = (/\ncode-probe: (\{.*\})/.exec(d) || [])[1];
ok(path === "qnfo-ops/worker.js" && anchor === "function opsD1Gate(now, name, args) {" && JSON.parse(probe).contains === "OPS-DEGRADED-2" && d.split("\n").pop().startsWith("code-probe: "), "OPS-DEGRADED-2 has code-task, code-anchor and code-probe (the probe block is last)", { path, anchor });
const f = iflip.description;
ok(f.startsWith("session-task: repo=qnfo-workers path=migrations/") && /STEP 1, row 134/.test(f) && /STEP 2, row 6/.test(f) && /STEP 3, rows 10 and 131/.test(f) && /WHAT NOT TO TOUCH/.test(f) && /DEFINITION OF DONE/.test(f) && /06:27Z/.test(f), "ROW-FLIPS-W2E-1 is a session-task with the three steps, the time gate, what not to touch and the definition of done");
const c = q1(w, "SELECT status, verify_transport, verify_probe, last_verdict FROM remediation_contracts WHERE issue_id = ?", iflip.id);
ok(c.status === "active" && c.verify_transport === "d1-query" && c.last_verdict === null && /^SELECT '1' AS expected, CASE WHEN/.test(c.verify_probe) && !/;/.test(c.verify_probe) && !/\b(insert|update|delete|drop|alter|create|replace)\b/i.test(c.verify_probe), "the closing contract is an active read-only measuring probe", c);
ok(q1(w, "SELECT status s FROM remediation_contracts WHERE issue_id = ?", i2.id).s === "superseded", "the other issue's contract is untouched (its code-probe contract is made by the fleet)");
const run = () => w.prepare(c.verify_probe).get();
ok(run().observed === "0", "the closing probe fails today (rows still waiting)", run());
w.prepare("UPDATE roadmap_implementation SET status = 'verified' WHERE id = 134").run();
ok(run().observed === "0", "and still fails with one row flipped");
for (const id of [6, 10, 131]) w.prepare("UPDATE roadmap_implementation SET status = 'implemented' WHERE id = ?").run(id);
ok(run().expected === run().observed, "and passes once rows 134, 6, 10 and 131 left their waiting states", run());

const after = snap(w);
w.exec(sql);
ok(snap(w) === after, "a replay changes nothing");
w.exec(sql.split("\n").find((l) => l.startsWith("-- Rollback: ")).slice("-- Rollback: ".length));
const w2 = world();
ok(JSON.stringify(qa(w, "SELECT id, status, evidence FROM roadmap_implementation WHERE id NOT IN (6, 10, 131, 134) ORDER BY id")) === JSON.stringify(qa(w2, "SELECT id, status, evidence FROM roadmap_implementation WHERE id NOT IN (6, 10, 131, 134) ORDER BY id")) && qa(w, "SELECT * FROM agent_issues").length === 0 && qa(w, "SELECT * FROM remediation_contracts").length === 0, "the Rollback line restores the rows, removes the issues and their contracts");

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
