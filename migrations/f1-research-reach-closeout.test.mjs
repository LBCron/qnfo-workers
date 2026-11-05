// F1-RESEARCH-REACH-CLOSEOUT-1 (2026-11-05): replays migrations/2026-11-05-f1-research-reach-closeout.sql on node:sqlite with a minimal schema. Proves the four rewritten closing probes tell fixed from
// unfixed on fixtures (they read ok / 0 when the defect is gone and something else when it is not), the roadmap rows move only from the statuses read, the two roadmap-dod contracts exist for built rows
// and not for others, and a replay changes nothing. State-independent: no live row, no exact version. Run: node migrations/f1-research-reach-closeout.test.mjs   -> prints "N passed, 0 failed"
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("./2026-11-05-f1-research-reach-closeout.sql", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };

const header = sql.split("\n").filter((l) => l.startsWith("--"));
ok(header.some((l) => /^-- APPLY-BY: ci\s*$/.test(l)) && header.some((l) => /^-- DB: qnfo-audit\s*$/.test(l)), "header opts in to CI and names the database");
ok(header.filter((l) => /^-- Rollback:/.test(l)).length === 1, "one Rollback line");
ok(header.some((l) => l === "-- BACKUP: bak_20261105_f1_closeout") && header.some((l) => /^-- CAUSE-MAPPED:/.test(l)), "BACKUP and CAUSE-MAPPED lines present");
const body = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
ok(!/\b(DELETE\s+FROM|DROP\s+(TABLE|INDEX|VIEW|TRIGGER))\b/i.test(body), "the body deletes and drops nothing");
ok(!/CREATE\s+(TEMP\s+)?TRIGGER/i.test(body), "no trigger is created");

function fresh() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER, escalate_to TEXT, expected_cadence_h INTEGER,
      status TEXT, ts TEXT, last_attempt_at TEXT, last_verdict TEXT, module TEXT, budget_ms INTEGER, next_due_at TEXT, max_items INTEGER, requires_container INTEGER, attempts INTEGER DEFAULT 0, deferred_since TEXT);
    CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, status TEXT);
    CREATE TABLE roadmap_implementation (id INTEGER PRIMARY KEY, item TEXT, status TEXT, evidence TEXT, verified_at TEXT);
    CREATE TABLE decision_log (id INTEGER PRIMARY KEY, actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
    CREATE TABLE version_queue (id INTEGER PRIMARY KEY, status TEXT, updated_at TEXT, citation_audit TEXT);
    CREATE TABLE paper_claims (id INTEGER PRIMARY KEY, claim_kind TEXT, created_at TEXT);
    CREATE TABLE seeded_claim_runs (id INTEGER PRIMARY KEY, ts TEXT, gate TEXT, caught INTEGER);
    CREATE TABLE research_queue (id TEXT PRIMARY KEY, status TEXT, stage TEXT, error TEXT);
    CREATE TABLE bp26_probe_results (id INTEGER PRIMARY KEY, subject TEXT, ok INTEGER, run_at TEXT);
    CREATE TABLE content_external_items (item_id TEXT, property TEXT, stage TEXT, title TEXT);
  `);
  for (const [cls, id] of [["issue-1000648", 1000648], ["issue-1000766", 1000766], ["issue-1000974", 1000974], ["issue-1001449", 1001449]]) {
    db.prepare("INSERT INTO remediation_contracts (class, issue_id, verify_probe, verify_transport, status, attempts) VALUES (?, ?, 'SELECT 1', 'd1-query', 'active', 50)").run(cls, id);
    db.prepare("INSERT INTO agent_issues (id, status) VALUES (?, 'open')").run(id);
  }
  db.exec(`INSERT INTO roadmap_implementation (id, item, status) VALUES (1684, 'RM-RAG-HYBRID-BASELINE-1', 'planned'), (1710, 'ROADMAP-1: QNFO.OPS BP26-SLO-FRESHNESS-1', 'built'), (1751, 'EK-4', 'built'), (1752, 'EK-5', 'built'), (1700, 'OTHER', 'planned')`);
  return db;
}
const run = (db, cls) => db.prepare(db.prepare("SELECT verify_probe FROM remediation_contracts WHERE class = ?").get(cls).verify_probe).get();

const db = fresh();
db.exec(sql);
const probes = db.prepare("SELECT class, verify_probe, status, attempts, last_verdict FROM remediation_contracts WHERE class IN ('issue-1000648','issue-1000766','issue-1000974','issue-1001449','rm-1751','rm-1752')").all();
ok(probes.length === 6, "four probes rewritten and two roadmap-dod contracts inserted", probes.map((p) => p.class));
for (const p of probes) {
  ok(!/;/.test(p.verify_probe), p.class + ": probe has no semicolon");
  ok(!/\b(insert|update|delete|drop|alter|create|replace|pragma|attach)\b/i.test(p.verify_probe), p.class + ": probe holds no write keyword, strings included");
  ok(p.status === "active", p.class + ": active");
}
ok(probes.filter((p) => p.class.startsWith("issue-")).every((p) => p.attempts === 0 && p.last_verdict === null), "rewritten contracts start a fresh attempt budget");
const rows = db.prepare("SELECT id, status, verified_at FROM roadmap_implementation ORDER BY id").all();
const st = Object.fromEntries(rows.map((r) => [r.id, r.status]));
ok(st[1684] === "verified" && st[1710] === "verified" && st[1751] === "built" && st[1752] === "built" && st[1700] === "planned", "only rows 1684 and 1710 become verified, nothing else moves", st);
ok(db.prepare("SELECT COUNT(*) n FROM decision_log").get().n === 1, "one decision_log row");

// 1000648: the existence-gate probe
{
  const p = (q) => run(q, "issue-1000648");
  const d = fresh(); d.exec(sql);
  let r = p(d);
  ok(r.expected === "ok" && r.observed !== "ok", "1000648 reads not-ok with no reference rows and no seeded catch", r);
  d.exec(`INSERT INTO paper_claims (claim_kind, created_at) VALUES ('reference', datetime('now', '-1 days')); INSERT INTO seeded_claim_runs (ts, gate, caught) VALUES (datetime('now', '-1 hours'), 'citation-gate', 1)`);
  r = p(d);
  ok(r.expected === "ok" && r.observed === "ok", "1000648 reads ok when the gate wrote reference rows, the harness caught a seed and nothing recent is identifier-less", r);
  d.exec(`INSERT INTO version_queue (status, updated_at, citation_audit) VALUES ('published', '2026-09-14 12:41', 'x no machine identifier present y')`);
  r = p(d);
  ok(r.observed === "ok", "1000648 ignores September rows that predate the gate", r);
  d.exec(`INSERT INTO version_queue (status, updated_at, citation_audit) VALUES ('published', '2026-11-03 12:41', 'x no machine identifier present y')`);
  r = p(d);
  ok(r.observed !== "ok" && /1 unresolved publications/.test(r.observed), "1000648 flags a publication since 2026-10-28 with an identifier-less reference", r);
}
// 1000766, 1000974, 1001449: counted from research_queue
{
  const d = fresh(); d.exec(sql);
  d.exec(`INSERT INTO research_queue VALUES ('a', 'wontfix', 'parked', 'REVIEW-UNRESOLVED-PARK-1: review: 6 HARD findings unresolved after 3 revise cycles'), ('b', 'published', 'done', 'review: 1 HARD findings unresolved'),
          ('c', 'queued', 'ground', 'SINGLE-LANE-1: re-entered'), ('d', 'wontfix', 'ground', 'ground: bibliography 4 < 5 entries'), ('e', 'published', 'done', 'ground: bibliography 4 < 5 entries'),
          ('f', 'researching', 'revise', 'complete: structural defects only, no writable section: duplicate section numbers: 7'), ('g', 'wontfix', 'complete', 'complete: skipped section numbers: 6')`);
  ok(run(d, "issue-1000766").observed === "1", "1000766 counts only the terminal HARD-unresolved row", run(d, "issue-1000766"));
  ok(run(d, "issue-1001449").observed === "1", "1001449 counts the terminal bibliography row and not the published one", run(d, "issue-1001449"));
  ok(run(d, "issue-1000974").observed === "1", "1000974 counts the waiting duplicate-number row and not the terminal one", run(d, "issue-1000974"));
  d.exec("DELETE FROM research_queue");
  ok(["issue-1000766", "issue-1000974", "issue-1001449"].every((c) => { const r = run(d, c); return r.expected === "0" && r.observed === "0"; }), "all three read expected = observed = 0 on a clean queue");
}
// rm-1751 / rm-1752
{
  const d = fresh(); d.exec(sql);
  ok(run(d, "rm-1752").observed !== "ok", "rm-1752 is not ok with no freshness sample", run(d, "rm-1752"));
  d.exec(`INSERT INTO bp26_probe_results (subject, ok, run_at) VALUES ('fresh:q08.org', 0, '2026-11-05T03:22:59Z'), ('fresh:q08.org', 1, '2026-11-06T03:22:59Z')`);
  ok(run(d, "rm-1752").observed === "ok", "rm-1752 reads ok when the newest freshness sample is ok", run(d, "rm-1752"));
  ok(run(d, "rm-1751").observed !== "ok", "rm-1751 is not ok with no published policy or science piece", run(d, "rm-1751"));
  d.exec(`INSERT INTO content_external_items VALUES ('1', 'q08.org', 'published', 'A public health rule and its cost')`);
  ok(run(d, "rm-1751").observed === "ok", "rm-1751 reads ok with a published public-health piece", run(d, "rm-1751"));
}
// a built-row filter: a row that is not built gets no roadmap-dod contract
{
  const d = fresh(); d.exec("UPDATE roadmap_implementation SET status = 'planned' WHERE id IN (1751, 1752)"); d.exec(sql);
  ok(d.prepare("SELECT COUNT(*) n FROM remediation_contracts WHERE class IN ('rm-1751','rm-1752')").get().n === 0, "no roadmap-dod contract for a row that is not built");
}
// replay changes nothing
{
  const before = JSON.stringify(db.prepare("SELECT class, verify_probe, status, attempts FROM remediation_contracts ORDER BY class").all());
  db.exec(sql);
  const after = JSON.stringify(db.prepare("SELECT class, verify_probe, status, attempts FROM remediation_contracts ORDER BY class").all());
  ok(before === after, "a replay changes no contract");
  ok(db.prepare("SELECT COUNT(*) n FROM decision_log").get().n === 1, "a replay adds no second decision_log row");
}
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
