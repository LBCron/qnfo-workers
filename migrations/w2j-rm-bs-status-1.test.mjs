// W2-J-STATUS-1 offline suite: replays migrations/2026-11-05-w2j-rm-bs-status-1.sql on node:sqlite.
// Proves: the header opts in; rows 3264, 3265, 3266 and 3268 become partial and keep their old evidence with the dated reading appended once; no row is verified or built on a merge alone and the 3265 text
// states what was NOT verified live; the self-test contract is a valid runner-https probe due later; the revocation issue routes to a real file whose anchor occurs once and creates the table it names;
// a replay changes nothing; the Rollback line puts statuses and evidence back and removes the contract and the table. Output MUST contain "0 failed" on success.
// Run: node migrations/w2j-rm-bs-status-1.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync } from "node:fs";

const root = new URL("../", import.meta.url);
const rd = (rel) => readFileSync(new URL(rel, root), "utf8");
const sql = rd("migrations/2026-11-05-w2j-rm-bs-status-1.sql");
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

const w = new DatabaseSync(":memory:");
w.exec(`CREATE TABLE roadmap_implementation (id INTEGER PRIMARY KEY, item TEXT NOT NULL, source TEXT NOT NULL, title TEXT NOT NULL, artifact_type TEXT NOT NULL, artifact_ref TEXT, status TEXT, evidence TEXT, verified_at TEXT, created_at TEXT);
CREATE TABLE remediation_contracts (id INTEGER PRIMARY KEY AUTOINCREMENT, class TEXT UNIQUE, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER, escalate_to TEXT, expected_cadence_h INTEGER, status TEXT, module TEXT, next_due_at TEXT);
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, linked_session TEXT, created_at INTEGER, updated_at INTEGER);`);
for (const id of [3264, 3265, 3266, 3268, 1]) w.prepare("INSERT INTO roadmap_implementation (id, item, source, title, artifact_type, status, evidence) VALUES (?, ?, 'bluesky-2026-11', 't', 'worker', ?, 'docs/BLUE-SKY-ROADMAP-2026-11.md')").run(id, "RM-" + id, id === 1 ? "verified" : "planned");
const snap = () => JSON.stringify({ r: w.prepare("SELECT id, status, evidence, verified_at FROM roadmap_implementation ORDER BY id").all(), c: w.prepare("SELECT class, verify_probe, status FROM remediation_contracts").all(), i: w.prepare("SELECT title FROM agent_issues").all() });
const s0 = snap();
w.exec(body);
const rows = Object.fromEntries(w.prepare("SELECT id, status, evidence, verified_at FROM roadmap_implementation").all().map((r) => [r.id, r]));
for (const id of [3264, 3265, 3266, 3268]) {
  ok(rows[id].status === "partial", `row ${id} is partial`, rows[id].status);
  ok(rows[id].evidence.startsWith("docs/BLUE-SKY-ROADMAP-2026-11.md | W2-J 2026-11-05: PARTIAL"), `row ${id} keeps its old evidence and appends the reading`, rows[id].evidence.slice(0, 90));
  ok(rows[id].verified_at === null, `row ${id} is not stamped verified`);
  ok(/OPEN: /.test(rows[id].evidence), `row ${id} names what is open`);
}
ok(rows[1].status === "verified" && rows[1].evidence === "docs/BLUE-SKY-ROADMAP-2026-11.md", "an unrelated row is untouched");
ok(/NOT verified live: a real mint and a 61 s SSE run/.test(rows[3265].evidence) && /MCP_TOKEN/.test(rows[3265].evidence), "3265 says what was not verified live and why");
ok(/PR 7683/.test(rows[3264].evidence) && /PR 7661/.test(rows[3265].evidence) && /PR 7712/.test(rows[3265].evidence) && /PR 7715/.test(rows[3265].evidence) && /PR 7723/.test(rows[3266].evidence) && /PR 7701/.test(rows[3268].evidence), "each row cites its PR numbers");
ok(/NOT written: personal-api\/worker\.js is claimed/.test(rows[3266].evidence), "3266 says the code slice is not written and why");

const c = w.prepare("SELECT * FROM remediation_contracts").all();
let probe = null; try { probe = JSON.parse(c[0].verify_probe); } catch (e) { /* reported below */ }
ok(c.length === 1 && c[0].class === "fm-capability-selftest-live" && c[0].verify_transport === "runner-https" && probe && probe.status === 200 && probe.contains === '"ok":true' && /cap-selftest$/.test(probe.url), "the self-test is a runner-https contract on the ok:true marker", c[0]);
ok(Date.parse(c[0].next_due_at.replace(" ", "T") + "Z") > Date.now() + 60 * 60e3, "first due more than an hour out, after the deploy");

const issue = w.prepare("SELECT title, description FROM agent_issues").get();
const p = /^code-task: repo=qnfo-workers path=(\S+)$/m.exec(issue.description), a = /^code-anchor: (.+)$/m.exec(issue.description);
ok(/^ROADMAP-1: QNFO\.OPS W2-J-CAP-4/.test(issue.title) && p && a && existsSync(new URL(p[1], root)), "revocation issue routes to an existing file");
if (p && a) ok(rd(p[1]).split(a[1]).length - 1 === 1, "its anchor occurs exactly once in " + p[1]);
ok(/^code-probe: \{.+\}$/m.test(issue.description) && /fails OPEN/.test(issue.description), "carries a code-probe and states the fail-open choice");
ok(w.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name = 'capability_revocations'").get().n === 1, "the table the issue names exists");

const s1 = snap();
w.exec(body);
ok(snap() === s1 && s1 !== s0, "a replay changes nothing");

w.exec(rollback[0].replace(/^-- Rollback:\s*/, ""));
const back = Object.fromEntries(w.prepare("SELECT id, status, evidence FROM roadmap_implementation").all().map((r) => [r.id, r]));
ok([3264, 3265, 3266, 3268].every((id) => back[id].status === "planned" && back[id].evidence === "docs/BLUE-SKY-ROADMAP-2026-11.md"), "Rollback puts statuses and evidence back");
ok(w.prepare("SELECT status FROM remediation_contracts").get().status === "superseded" && w.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name = 'capability_revocations'").get().n === 0, "Rollback supersedes the contract and drops the table");

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
