// F1E-FOLLOWUP-CONTRACTS-REARM-1: migrations/2026-11-05-f1e-followup-contracts-rearm.sql re-arms the two ROADMAP-1 contracts that the birth template left superseded,
// and touches nothing else. Replayed on SQLite against a fixture with the columns it reads and writes. Run: node migrations/f1e-followup-contracts-rearm.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(here, "2026-11-05-f1e-followup-contracts-rearm.sql"), "utf8");
let failed = 0, passed = 0;
const ok = (c, m) => { if (c) passed++; else { failed++; console.log("FAIL " + m); } };

ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: .+/m.test(sql), "migration headers are present");
for (const m of sql.matchAll(/LIKE '((?:[^']|'')*)'/g)) ok(m[1].replace(/''/g, "'").length <= 50, "LIKE pattern within D1's 50 byte limit: " + m[1]);

const statements = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n").split(/;\s*\n/).map((s) => s.trim()).filter(Boolean);
ok(statements.length === 3 && statements.slice(1).every((s) => s.startsWith("UPDATE remediation_contracts")), "one backup table and two updates of remediation_contracts");

const db = new DatabaseSync(":memory:");
db.exec(`CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, status TEXT);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT, status TEXT, last_verdict TEXT, next_due_at TEXT, attempts INTEGER, module TEXT);`);
db.prepare("INSERT INTO agent_issues VALUES (?, ?, 'open')").run(1001862, "ROADMAP-1: QNFO.RSCH #rag-rerank-parity: keep the cheaper rerank arm when quality holds, decided from 3 recorded pairs");
db.prepare("INSERT INTO agent_issues VALUES (?, ?, 'open')").run(1001939, "ROADMAP-1: QNFO.INFRA #memory-consolidation: consolidate episodic memories into semantic rows and decay stale ones, once the memory tools are used");
db.prepare("INSERT INTO agent_issues VALUES (?, ?, 'open')").run(1001909, "ROADMAP-1: QNFO.OPS #qwav-demos: replay the four older qwav-demos pages and flip the coverage line");
db.prepare("INSERT INTO agent_issues VALUES (?, ?, 'open')").run(5, "an unrelated issue");
const ins = db.prepare("INSERT INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, status, last_verdict, next_due_at, attempts, module) VALUES (?, ?, 'p', 'a', ?, ?, ?, ?, NULL, 7, 'probe-template-v3-generic')");
const vacuous = "superseded:closure-observing-probe-at-birth (CLOSE-PROBE-CIRCULAR-1 ...)";
ins.run("issue-1001862", 1001862, "SELECT 'ok' AS expected, CASE WHEN (SELECT COUNT(*) FROM ask_evals) >= 3 AND EXISTS (SELECT 1 FROM experiments WHERE id = 'RAG-RERANK-PARITY-1' AND status IN ('adopted', 'kept')) THEN 'ok' ELSE 'no' END AS observed", "d1-query", "superseded", vacuous);
ins.run("issue-1001939", 1001939, "SELECT 'ok' AS expected, CASE WHEN EXISTS (SELECT 1 FROM memory_consolidation_runs WHERE semantic_out > 0) THEN 'ok' ELSE 'no' END AS observed", "d1-query", "superseded", vacuous);
ins.run("issue-1001909", 1001909, "{\"paths\": [\"docs/QWAV-CROSS-SIMULATOR.md\"], \"contains\": \"All published demos covered: yes\"}", "code-read", "active", null);
ins.run("issue-5", 5, "SELECT 'closed' AS expected, 'open' AS observed", "d1-query", "superseded", vacuous);
// a superseded contract whose probe is still the vacuous template must stay superseded
ins.run("issue-1000999", 1001862, "SELECT 'closed' AS expected, 'open' AS observed", "d1-query", "superseded", vacuous);

for (const s of statements) db.exec(s);
const row = (c) => db.prepare("SELECT status, attempts, last_verdict, next_due_at, precondition FROM remediation_contracts WHERE class = ?").get(c);
ok(row("issue-1001862").status === "active" && row("issue-1001862").attempts === 0 && /^rearmed: F1E-FOLLOWUP/.test(row("issue-1001862").last_verdict) && !!row("issue-1001862").next_due_at, "the rerank parity contract is active and due");
ok(row("issue-1001939").status === "active" && /memory tools are in use/.test(row("issue-1001939").precondition), "the memory consolidation contract is active");
ok(row("issue-1001909").status === "active" && row("issue-1001909").last_verdict === null && row("issue-1001909").attempts === 7, "the qwav-demos contract is not touched");
ok(row("issue-5").status === "superseded", "an unrelated superseded contract is not touched");
ok(row("issue-1000999").status === "superseded", "a superseded contract that still holds the vacuous probe stays superseded");
ok(db.prepare("SELECT COUNT(*) n FROM bak_20261105_f1e_rearm").get().n === 2 && db.prepare("SELECT status FROM bak_20261105_f1e_rearm WHERE class = 'issue-1001862'").get().status === "superseded", "the backup holds the two rows as they were");
for (const s of statements.slice(1)) db.exec(s);
ok(row("issue-1001862").status === "active", "applying the file twice changes nothing more");

console.log(passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
