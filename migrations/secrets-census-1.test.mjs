// SECRETS-CENSUS-1 migration suite (agent_issues 1000698, successor DECLARED-SECRETS-STORE-1). Runs migrations/2026-11-05-secrets-census-1.sql on node:sqlite against the live layout of
// agent_issues, remediation_contracts and infra_state, and proves: the successor issue is filed once with a code-task, a code-anchor and a code-probe line; 1000698 names it and carries the
// measurement; the nonsense probe (failed migration runs) becomes a census probe whose wording passes only when store bindings cover secret_text bindings, says "not live yet" for an old
// snapshot shape, and reports the counts otherwise; a second apply changes nothing; another issue and contract are untouched; the Rollback line restores the probe and strips the note.
// Run: node migrations/secrets-census-1.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("./2026-11-05-secrets-census-1.sql", import.meta.url), "utf8");
const rollback = /^-- Rollback: (.*)$/m.exec(sql)[1];
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 500))); } };
const one = (db, s, ...a) => db.prepare(s).get(...a);

const OLD = "SELECT 0 AS expected, (SELECT COUNT(*) FROM migration_runs WHERE status NOT IN ('done','ok')) AS observed";
const db = new DatabaseSync(":memory:");
db.exec(`
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT DEFAULT 'open', created_at INTEGER, updated_at INTEGER);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, action TEXT, verify_probe TEXT NOT NULL, verify_transport TEXT NOT NULL, status TEXT DEFAULT 'active', last_verdict TEXT, attempts INTEGER DEFAULT 0, next_due_at TEXT);
CREATE TABLE infra_state (id TEXT, ts TEXT, data TEXT);
`);
db.prepare("INSERT INTO agent_issues (id, title, description, source, status) VALUES (1000698, 'ROADMAP-1: QNFO.INFRA #2: migrate 108 per-worker secret_text bindings to Secrets Store', 'code-task: repo=qnfo-workers path=qnfo-infra/worker.js', 'session', 'open')").run();
db.prepare("INSERT INTO agent_issues (id, title, description, source, status) VALUES (5001, 'other', 'untouched', 'session', 'open')").run();
db.prepare("INSERT INTO remediation_contracts (class, issue_id, action, verify_probe, verify_transport, last_verdict, attempts) VALUES ('issue-1000698', 1000698, 'VACUOUS-PROBE-V3-1', ?, 'd1-query', 'fail', 52)").run(OLD);
db.prepare("INSERT INTO remediation_contracts (class, issue_id, action, verify_probe, verify_transport, last_verdict, attempts) VALUES ('issue-5001', 5001, 'a', 'SELECT 1', 'd1-query', 'fail', 3)").run();
const other = () => JSON.stringify([one(db, "SELECT * FROM remediation_contracts WHERE class = 'issue-5001'"), one(db, "SELECT * FROM agent_issues WHERE id = 5001")]);
const other0 = other();

db.exec(sql);
const succ = db.prepare("SELECT * FROM agent_issues WHERE title LIKE 'DECLARED-SECRETS-STORE-1:%'").all();
ok(succ.length === 1 && succ[0].status === "open" && succ[0].source === "session" && succ[0].priority === "high", "the successor is filed once, open, high", succ.map((s) => s.title));
const d = succ[0].description;
ok(/^code-task: repo=qnfo-workers path=qnfo-ops\/worker\.js$/m.test(d), "it carries a code-task line on qnfo-ops/worker.js");
const anchor = /^code-anchor: (.*)$/m.exec(d)[1];
ok(anchor === 'else if (s.name === "ai") decl.push({ type: "ai", name: nm });', "its code-anchor is the installer's ai case, verbatim", anchor);
ok(/^code-probe: \{"paths": \["qnfo-ops\/worker\.js"\], "contains": "secrets_store_secret"\}$/m.test(d), "it carries a code-probe line");
// the anchor is a real line of the file it names, once (checked while the installer still has it)
const ops = readFileSync(new URL("../qnfo-ops/worker.js", import.meta.url), "utf8");
if (ops.includes(anchor)) ok(ops.split(anchor).length === 2, "the anchor occurs exactly once in qnfo-ops/worker.js");
ok(/revert is deleting the table from qnfo-infra\/wrangler\.toml/.test(d) && /No secret value is read, written or logged/.test(d), "the activation note states the revert and that no secret value is touched");

const main = one(db, "SELECT description FROM agent_issues WHERE id = 1000698").description;
ok(main.startsWith("code-task: repo=qnfo-workers path=qnfo-infra/worker.js") && main.includes("SECRETS-CENSUS-1 2026-11-05") && main.includes("agent_issues " + succ[0].id + " (code-task on qnfo-ops/worker.js)"), "1000698 keeps its first line, carries the measurement and names the successor id");
ok(JSON.stringify([one(db, "SELECT * FROM remediation_contracts WHERE class = 'issue-5001'"), one(db, "SELECT * FROM agent_issues WHERE id = 5001")]) === other0, "another issue and contract are untouched");

// the probe
const c = one(db, "SELECT * FROM remediation_contracts WHERE class = 'issue-1000698'");
ok(!c.verify_probe.includes("migration_runs") && c.attempts === 0 && c.last_verdict === null && c.action.startsWith("SECRETS-CENSUS-1:"), "the migration_runs probe is replaced and the contract re-armed", c);
const snap = (census) => { db.exec("DELETE FROM infra_state"); db.prepare("INSERT INTO infra_state (id, ts, data) VALUES ('snapshot', '2026-11-05T02:00:00Z', ?)").run(JSON.stringify(census === undefined ? { d1: {} } : { secrets_census: census })); };
const probe = () => db.prepare(one(db, "SELECT verify_probe FROM remediation_contracts WHERE class = 'issue-1000698'").verify_probe).get();
snap(undefined);
let r = probe(); ok(r.observed.includes("1.12.2 not live") && r.observed !== r.expected, "an old snapshot shape reads as not live yet", r);
snap({ workers: 39, secret_text: 112, store_bindings: 0, store_bound: [] });
r = probe(); ok(r.observed === "0 store bindings against 112 secret_text bindings" && r.observed !== r.expected, "today's reading fails with the counts", r);
snap({ workers: 39, secret_text: 112, store_bindings: 1, store_bound: ["qnfo-infra"] });
r = probe(); ok(r.observed === "1 store bindings against 112 secret_text bindings", "one binding is progress, not a pass", r);
snap({ workers: 39, secret_text: 3, store_bindings: 3, store_bound: ["a"] });
r = probe(); ok(r.observed === r.expected, "store bindings covering the secret_text bindings passes", r);
snap({ workers: 39, secret_text: 0, store_bindings: 0, store_bound: [] });
r = probe(); ok(r.observed === r.expected, "no secret_text binding left passes", r);

// idempotent
const s1 = JSON.stringify([db.prepare("SELECT id, title, description FROM agent_issues ORDER BY id").all(), db.prepare("SELECT class, verify_probe, action, status FROM remediation_contracts ORDER BY class").all()]);
db.exec(sql);
const s2 = JSON.stringify([db.prepare("SELECT id, title, description FROM agent_issues ORDER BY id").all(), db.prepare("SELECT class, verify_probe, action, status FROM remediation_contracts ORDER BY class").all()]);
ok(s1 === s2, "a second apply changes nothing");
ok(db.prepare("SELECT COUNT(*) AS n FROM agent_issues WHERE title LIKE 'DECLARED-SECRETS-STORE-1:%'").get().n === 1, "and files no second successor");

// rollback
for (const part of rollback.split(/;\s+(?=UPDATE)/)) db.exec(part);
const rb = one(db, "SELECT * FROM remediation_contracts WHERE class = 'issue-1000698'");
ok(rb.verify_probe === OLD && rb.action === "VACUOUS-PROBE-V3-1", "rollback restores the old probe", rb);
ok(one(db, "SELECT description FROM agent_issues WHERE id = 1000698").description === "code-task: repo=qnfo-workers path=qnfo-infra/worker.js", "rollback strips the note");

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
