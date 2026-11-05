// SLICE-C-DISPOSITIONS-1 offline suite: replays the live close triggers (text read from qnfo-audit sqlite_master on 2026-10-26, as in migrations/issue-hygiene.test.mjs)
// on node:sqlite, then runs migrations/2026-11-05-slice-c-dispositions.sql. Proves:
//  * a CODE-MERGE-REFUSED-1 ticket whose task's issue is closed is closed as moot; one whose issue is still open stays
//  * a METRIC-FIX-RELAPSED-1 ticket is superseded only while the named trigger ticket is open and at least as urgent; a closed or lower-priority successor leaves it open
//  * content_items_over_stage_sla 100456 is superseded by 99948 with the measured decomposition in its evidence
//  * a contract that reads fail (which would abort a plain close) is settled first; unrelated tickets and contracts are byte-identical
//  * the 1001468 probe window moves once and the 1000662 contract becomes a code-read probe on updated_brier; a second apply changes nothing
//  * the Rollback line restores status, triage, contracts and the two probes; the file adds no trigger and no index on agent_issues
// Run: node migrations/slice-c-dispositions.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const here = (f) => new URL("./" + f, import.meta.url);
const FILE = "2026-11-05-slice-c-dispositions.sql";
const sql = readFileSync(here(FILE), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d))); } };
const all = (db, s, ...a) => db.prepare(s).all(...a);
const one = (db, s, ...a) => db.prepare(s).get(...a);
const rollback = /^-- Rollback: (.*)$/m.exec(sql)[1];

const LIVE_TRIGGERS = [
  `CREATE TRIGGER issue_close_evidence_required BEFORE UPDATE OF status ON agent_issues
WHEN NEW.status IN ('closed','resolved','wontfix') AND OLD.status NOT IN ('closed','resolved','wontfix')
BEGIN
  SELECT RAISE(ABORT,'close-without-evidence')
    WHERE NOT EXISTS (SELECT 1 FROM issue_triage t WHERE t.issue_id = NEW.id AND t.close_evidence IS NOT NULL AND TRIM(t.close_evidence) <> '');
  SELECT RAISE(ABORT,'close-while-contract-fails')
    WHERE NEW.status IN ('closed','resolved')
      AND EXISTS (SELECT 1 FROM remediation_contracts c WHERE c.issue_id = NEW.id
                    AND c.status IN ('active','holding')
                    AND COALESCE(c.last_verdict,'') IN ('fail','vacuous-probe-result','probe-error','probe-not-machine-executable','probe-same-account-host'));
END`,
  `CREATE TRIGGER issue_lifecycle_au AFTER UPDATE OF status ON agent_issues
WHEN COALESCE(OLD.status, '') <> COALESCE(NEW.status, '')
BEGIN
  INSERT INTO issue_lifecycle (issue_id, event, from_status, to_status, has_evidence)
  VALUES (NEW.id, CASE WHEN NEW.status IN ('closed', 'resolved', 'wontfix') THEN 'dispositioned' ELSE 'reopened' END, OLD.status, NEW.status,
    CASE WHEN EXISTS (SELECT 1 FROM issue_triage t WHERE t.issue_id = NEW.id AND t.close_evidence IS NOT NULL AND TRIM(t.close_evidence) <> '') THEN 1 ELSE 0 END);
END`,
  `CREATE TRIGGER agent_issues_superseded_contracts_upd AFTER UPDATE OF status ON agent_issues
WHEN NEW.status IN ('closed', 'resolved') AND COALESCE(OLD.status, '') NOT IN ('closed', 'resolved')
  AND EXISTS (SELECT 1 FROM issue_triage t WHERE t.issue_id = NEW.id
              AND (lower(substr(COALESCE(t.close_evidence, ''), 1, 10)) = 'superseded' OR lower(substr(COALESCE(t.close_evidence, ''), 1, 4)) = 'moot'))
BEGIN
  UPDATE remediation_contracts SET status = 'superseded', last_verdict = 'superseded:closure-superseded', last_attempt_at = datetime('now')
  WHERE issue_id = NEW.id AND status IN ('active', 'holding', 'needs-machine-probe', 'probe-review-refused');
END`,
  `CREATE TRIGGER triage_close_sync_issue_upd AFTER UPDATE OF triage_state ON issue_triage WHEN NEW.triage_state IN ('closed','closed-refuted','wontfix') BEGIN UPDATE agent_issues SET status = CASE WHEN NEW.triage_state='wontfix' THEN 'wontfix' ELSE 'closed' END, updated_at = CAST(strftime('%s','now') AS INTEGER)*1000 WHERE id = NEW.issue_id AND status='open'; END`,
  `CREATE TRIGGER triage_superseded_contracts_upd AFTER UPDATE OF triage_state, close_evidence ON issue_triage
WHEN NEW.triage_state = 'closed' AND (lower(substr(COALESCE(NEW.close_evidence, ''), 1, 10)) = 'superseded' OR lower(substr(COALESCE(NEW.close_evidence, ''), 1, 4)) = 'moot')
BEGIN
  UPDATE remediation_contracts SET status = 'superseded', last_verdict = 'superseded:closure-superseded', last_attempt_at = datetime('now')
  WHERE issue_id = NEW.issue_id AND status IN ('active', 'holding', 'needs-machine-probe', 'probe-review-refused');
END`,
  `CREATE TRIGGER decision_log_no_update BEFORE UPDATE ON decision_log BEGIN SELECT RAISE(ABORT, 'DOCTRINE-1: decision_log is append-only (doctrine section 12)'); END`,
  `CREATE TRIGGER decision_log_no_delete BEFORE DELETE ON decision_log BEGIN SELECT RAISE(ABORT, 'DOCTRINE-1: decision_log is append-only (doctrine section 12)'); END`,
];

function build() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT DEFAULT 'open', linked_session TEXT, created_at INTEGER, updated_at INTEGER, close_channel TEXT);
CREATE UNIQUE INDEX idx_agent_issues_open_title_ci ON agent_issues(lower(trim(title))) WHERE status = 'open';
CREATE TABLE issue_triage (issue_id INTEGER PRIMARY KEY, rc TEXT NOT NULL, triage_state TEXT NOT NULL DEFAULT 'triaged', owner TEXT NOT NULL, sla_due_at TEXT NOT NULL, triaged_at TEXT DEFAULT (datetime('now')), remediation TEXT, close_evidence TEXT, reopened_count INTEGER NOT NULL DEFAULT 0);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT NOT NULL, action TEXT NOT NULL, verify_probe TEXT NOT NULL, verify_transport TEXT NOT NULL, max_attempts INTEGER DEFAULT 3, escalate_to TEXT NOT NULL, expected_cadence_h INTEGER, status TEXT DEFAULT 'active', ts TEXT, last_attempt_at TEXT, last_verdict TEXT, module TEXT, budget_ms INTEGER, next_due_at TEXT, max_items INTEGER, requires_container INTEGER, attempts INTEGER DEFAULT 0);
CREATE TABLE issue_lifecycle (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), issue_id INTEGER, event TEXT, from_status TEXT, to_status TEXT, has_evidence INTEGER);
CREATE TABLE code_tasks (id TEXT PRIMARY KEY, goal TEXT, status TEXT, updated_at TEXT);
CREATE TABLE issue_ledger (fingerprint TEXT PRIMARY KEY, source TEXT, level TEXT, category TEXT, title TEXT, status TEXT, first_seen TEXT, last_seen TEXT, occurrences INTEGER, last_detail TEXT, updated_at TEXT, resolved_at TEXT);
CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT, root_cause TEXT, remediation TEXT, detector TEXT, probe_class TEXT, first_seen TEXT, issue_id INTEGER, trigger_condition TEXT, symptom TEXT, blast_radius TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT DEFAULT (datetime('now')), actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT, outcome_matched INTEGER);
CREATE TABLE fleet_tasks (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, definition TEXT NOT NULL, timeout_ms INTEGER NOT NULL DEFAULT 30000, retries INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 1, enabled INTEGER NOT NULL DEFAULT 1, updated_at TEXT);
CREATE TABLE fleet_crons (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, cron_expr TEXT NOT NULL, task_id TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, timezone TEXT NOT NULL DEFAULT 'UTC', last_fired TEXT, next_fire TEXT, updated_at TEXT);
`);
  for (const t of LIVE_TRIGGERS) db.exec(t);
  return db;
}

const ms = (agoH) => Date.now() - agoH * 3600 * 1000;
function add(db, o) {
  db.prepare("INSERT INTO agent_issues (id, title, description, source, category, priority, status, created_at, updated_at) VALUES (?, ?, 'd', ?, 'reliability', ?, ?, ?, ?)")
    .run(o.id, o.title, o.source || "qnfo-fleet-control", o.priority || "high", o.status || "open", ms(o.ageH || 30), ms(o.ageH || 30));
  db.prepare("INSERT INTO issue_triage (issue_id, rc, triage_state, owner, sla_due_at, close_evidence) VALUES (?, 'AUTOTRIAGE-2', ?, 'qnfo-fleet-control', '2026-10-15 18:01:01', ?)")
    .run(o.id, o.status === "closed" ? "closed" : "triaged", o.evidence || null);
  for (const c of o.contracts || []) {
    db.prepare("INSERT INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, escalate_to, expected_cadence_h, status, last_verdict, module, attempts) VALUES (?, ?, 'p', 'a', ?, ?, 'qnfo-fleet-control', 1, ?, ?, ?, 5)")
      .run(c.class || "issue-" + o.id, o.id, c.probe || "SELECT 1", c.transport || "d1-query", c.status || "active", c.verdict || null, c.module || null);
  }
}
const NOOP_PROBE = "WITH r AS (SELECT DISTINCT t.id AS id FROM cloud_ops_events e JOIN code_tasks t ON instr(e.text, t.id) > 0 WHERE e.kind = 'code-task.noop-refused' AND e.text LIKE '%string literals%' AND e.ts >= strftime('%Y-%m-%dT%H:%M:%SZ','now','-1 day')) SELECT '0' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM r";
const BORN_SUPERSEDED = "SELECT 'closed' AS expected, (SELECT CASE WHEN status IN ('closed', 'resolved') THEN 'closed' ELSE NULL END FROM agent_issues WHERE id = 1000662) AS observed";
const REFUSED = (task, file) => "CODE-MERGE-REFUSED-1: code task " + task + " (" + file + ")";

function fixture(db, o) {
  o = Object.assign({ parent854: "open", succ2467: "open", prio2467: "critical" }, o || {});
  add(db, { id: 1000619, title: "ROADMAP-1: QNFO.OPS #162: Add /sla-gap endpoint to backlog-exec", status: "closed", evidence: "fixed" });
  add(db, { id: 1000787, title: "CF-OBS-ISSUE-1: radar-hub: D1 timeout", status: o.parent854, evidence: o.parent854 === "closed" ? "gone" : null });
  add(db, { id: 1000625, title: REFUSED("ct_im1000619", "qnfo-lifecycle/worker.js"), priority: "critical", contracts: [{ status: "active", verdict: "fail" }] });
  add(db, { id: 1000854, title: REFUSED("ct_im1000787", "radar-hub/worker.js"), contracts: [{ status: "active", verdict: "fail" }] });
  add(db, { id: 1753, title: "METRIC-TRIGGER-341-SUBSCRIBERS-GROWTH-MONTHLY: Reach gap: confirmed subscriber growth under +10/month", priority: "critical" });
  add(db, { id: 2467, title: "METRIC-TRIGGER-1868-ATTENTION-DECISION-EFFICACY-30D: Loop gap: attention decisions move attention", priority: o.prio2467, status: o.succ2467, evidence: o.succ2467 === "closed" ? "e" : null });
  add(db, { id: 99948, title: "METRIC-TRIGGER-5915-CONTENT-ITEMS-OVER-STAGE-SLA: Content pipeline: items are past their stage SLA", priority: "critical" });
  add(db, { id: 100281, title: "METRIC-FIX-RELAPSED-1: subscribers_growth_monthly", priority: "high", contracts: [{ status: "active", verdict: "fail" }, { class: "issue-100281-BACKFILL-1", status: "escalated", verdict: "escalated:over-retried" }] });
  add(db, { id: 100286, title: "METRIC-FIX-RELAPSED-1: attention_decision_efficacy_30d", priority: "high", contracts: [{ status: "active", verdict: "fail" }] });
  add(db, { id: 100456, title: "content_items_over_stage_sla 1601 = 3 stalled loops (errata 882, revision 486, research-queued 198)", priority: "critical", contracts: [{ status: "active", verdict: "deferred" }] });
  add(db, { id: 1001468, title: "noop-guard misreads SQL-inside-a-JS-string edits as message text", priority: "critical", contracts: [{ status: "active", verdict: "fail", probe: NOOP_PROBE }] });
  add(db, { id: 1000662, title: "ROADMAP-1: QNFO.RSCH #3: q08 scores the last forecast update", priority: "critical", contracts: [{ status: "superseded", verdict: "superseded:closure-observing-probe-at-birth", probe: BORN_SUPERSEDED }] });
  add(db, { id: 5001, title: "UNRELATED-1: nothing to do with this file", contracts: [{ status: "active", verdict: "fail" }] });
  add(db, { id: 5002, title: "METRIC-FIX-RELAPSED-1: some_other_metric", priority: "high", contracts: [{ status: "active", verdict: "fail" }] });
}
const snap = (db) => ({
  agent: all(db, "SELECT id, status, close_channel FROM agent_issues ORDER BY id"),
  triage: all(db, "SELECT issue_id, triage_state, close_evidence, reopened_count FROM issue_triage ORDER BY issue_id"),
  contracts: all(db, "SELECT class, status, last_verdict, verify_probe, verify_transport, module FROM remediation_contracts ORDER BY class")
});
const st = (s, id) => s.agent.find((r) => r.id === id);
const ev = (s, id) => (s.triage.find((r) => r.issue_id === id) || {}).close_evidence || "";
const ct = (s, cls) => s.contracts.find((r) => r.class === cls);

// ================= scenario A: 854's parent open, 2467 closed =================
const db = build(); fixture(db, { parent854: "open", succ2467: "closed" });
const before = snap(db);
const trg0 = one(db, "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger'").n;
db.exec(sql);
const after = snap(db);

ok(st(after, 1000625).status === "closed", "1000625 (task's issue 1000619 is closed) is closed, although its contract read fail", st(after, 1000625));
ok(ev(after, 1000625).startsWith("moot:") && ev(after, 1000625).includes("ct_im1000619") && ev(after, 1000625).includes("issue 1000619"), "1000625 evidence is moot and names the task and its issue", ev(after, 1000625));
ok(st(after, 1000854).status === "open", "1000854 stays while issue 1000787 is open");
ok(st(after, 100281).status === "closed" && ev(after, 100281).startsWith("superseded by 1753"), "100281 is superseded by 1753", ev(after, 100281).slice(0, 120));
ok(st(after, 100286).status === "open", "100286 stays while its successor 2467 is closed");
ok(st(after, 100456).status === "closed" && ev(after, 100456).startsWith("superseded by 99948") && ev(after, 100456).includes("1,378") && ev(after, 100456).includes("research_daily_neurons"), "100456 is superseded by 99948 with the measured decomposition", ev(after, 100456).slice(0, 120));
for (const i of [1000625, 100281, 100456]) {
  ok(st(after, i).close_channel.startsWith("session:breach-remediation"), "close channel named for " + i, st(after, i).close_channel);
  ok(ct(after, "issue-" + i).status === "superseded", "contract of " + i + " is superseded", ct(after, "issue-" + i));
}
ok(ct(after, "issue-100281-BACKFILL-1").status === "escalated" || ct(after, "issue-100281-BACKFILL-1").status === "superseded", "the escalated BACKFILL contract does not block the close");
ok(one(db, "SELECT COUNT(*) AS n FROM issue_lifecycle WHERE event = 'dispositioned'").n === 3, "three dispositioned lifecycle rows");
ok(one(db, "SELECT COUNT(*) AS n FROM issue_fold_ledger WHERE applied = 1").n === 3 && one(db, "SELECT COUNT(*) AS n FROM issue_fold_ledger WHERE applied = 0").n === 0, "three ledger rows, all applied");
// kept tickets are byte-identical
for (const i of [1000854, 100286, 5001, 5002, 1753, 2467, 99948, 1000619, 1000787]) {
  ok(JSON.stringify(st(before, i)) === JSON.stringify(st(after, i)), "ticket " + i + " is unchanged", { a: st(before, i), b: st(after, i) });
  ok(JSON.stringify(before.triage.find((r) => r.issue_id === i)) === JSON.stringify(after.triage.find((r) => r.issue_id === i)), "triage row of " + i + " is unchanged");
}
for (const cls of ["issue-1000854", "issue-100286", "issue-5001", "issue-5002"]) ok(JSON.stringify(ct(before, cls)) === JSON.stringify(ct(after, cls)), "contract " + cls + " is unchanged");

// probes
const noop = ct(after, "issue-1001468");
ok(noop.status === "active" && noop.last_verdict === null && noop.verify_probe.includes("e.ts >= '2026-11-04T15:30:00Z'") && noop.verify_probe.includes("code-task.noop-refused") && noop.verify_probe.includes("-1 day"), "1001468 probe now counts from after the fix and keeps its predicate", noop);
const q08 = ct(after, "issue-1000662");
ok(q08.status === "active" && q08.verify_transport === "code-read" && q08.module === "code-probe-line-v1" && JSON.parse(q08.verify_probe).contains === "f.updated_brier = score.brier;", "1000662 is a code-read probe on updated_brier", q08);
ok(st(after, 1001468).status === "open" && st(after, 1000662).status === "open", "the two probe rewrites close nothing");
// the code-read probe string really is in the file it names
const q08src = readFileSync(new URL("../q08-signal-engine/worker.js", import.meta.url), "utf8");
ok(q08src.includes("f.updated_brier = score.brier;"), "q08-signal-engine/worker.js contains the probed text");
ok(q08src.split("f.updated_brier = score.brier;").length === 2, "and exactly once");

// no trigger, no index
ok(one(db, "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger'").n === trg0, "the file adds no trigger (AGENT-ISSUES-TRIGGER-DEPTH-1)");
ok(!/\bCREATE\s+(UNIQUE\s+)?TRIGGER\b/i.test(sql.replace(/^--.*$/gm, "")), "the file text creates no trigger");
ok(all(db, "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name IN ('agent_issues', 'issue_triage')").length === 1, "no index is added to agent_issues or issue_triage");

// idempotent
db.exec(sql);
const again = snap(db);
const strip = (s) => JSON.stringify({ ...s, triage: s.triage.map((r) => { const { triaged_at, ...x } = r; return x; }) });
ok(strip(again) === strip(after), "a second apply changes nothing");
ok(one(db, "SELECT COUNT(*) AS n FROM issue_fold_ledger").n === 3, "a second apply adds no ledger row");
ok(one(db, "SELECT COUNT(*) AS n FROM issue_lifecycle WHERE event = 'dispositioned'").n === 3, "a second apply writes no lifecycle row");
ok(one(db, "SELECT COUNT(*) AS n FROM decision_log").n === 1, "one decision_log row");

// ================= scenario B: 854's parent closed, 2467 open but less urgent than 100286 =================
const b = build(); fixture(b, { parent854: "closed", succ2467: "open", prio2467: "low" });
b.exec(sql);
const sb = snap(b);
ok(st(sb, 1000854).status === "closed" && ev(sb, 1000854).startsWith("moot:") && ev(sb, 1000854).includes("ct_im1000787"), "1000854 closes once issue 1000787 is closed", ev(sb, 1000854).slice(0, 100));
ok(st(sb, 100286).status === "open", "100286 stays while its successor is lower priority");
ok(st(sb, 1000625).status === "closed", "1000625 closes in this state as well");

// scenario C: the carrying trigger ticket is closed -> nothing is superseded into it
const c = build(); fixture(c);
c.prepare("UPDATE issue_triage SET close_evidence = 'e' WHERE issue_id = 99948").run();
c.prepare("UPDATE agent_issues SET status = 'closed' WHERE id = 99948").run();
c.exec(sql);
ok(st(snap(c), 100456).status === "open", "100456 stays when 99948 is closed");

// ================= rollback restores the before-state =================
const rb = build(); fixture(rb, { parent854: "open", succ2467: "closed" });
const pre = snap(rb);
rb.exec(sql);
for (const part of rollback.split(/;\s+(?=UPDATE|DELETE)/)) rb.exec(part);
const restored = snap(rb);
for (const i of [1000625, 100281, 100456]) {
  ok(st(restored, i).status === "open" && st(restored, i).close_channel === st(pre, i).close_channel, "rollback reopens " + i, st(restored, i));
  const t0 = pre.triage.find((r) => r.issue_id === i), t1 = restored.triage.find((r) => r.issue_id === i);
  ok(t1.triage_state === t0.triage_state && t1.close_evidence === t0.close_evidence, "rollback restores the triage row of " + i, { t0, t1 });
  const c0 = ct(pre, "issue-" + i), c1 = ct(restored, "issue-" + i);
  ok(c1.status === c0.status && c1.last_verdict === c0.last_verdict, "rollback restores the contract of " + i, { c0, c1 });
}
for (const cls of ["issue-1001468", "issue-1000662"]) {
  const c0 = ct(pre, cls), c1 = ct(restored, cls);
  ok(c1.verify_probe === c0.verify_probe && c1.verify_transport === c0.verify_transport && c1.status === c0.status && c1.last_verdict === c0.last_verdict && c1.module === c0.module, "rollback restores the probe row " + cls, { c0, c1 });
}

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
