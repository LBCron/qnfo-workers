// ISSUE-HYGIENE-1 offline suite: replays the live triggers a close touches (text read from qnfo-audit sqlite_master on 2026-10-26: the close-evidence and
// close-while-contract-fails guard, the lifecycle row, the superseded-contract settlers, the triage-to-issue close sync, the append-only decision_log) on
// node:sqlite, then runs migrations/2026-10-26-issue-hygiene-1.sql. Proves, for each of the eight rules, that it closes what it states and nothing else:
//  * probe-needed-target-not-open     a PROBE-NEEDED-1 issue whose target is not open (even with a probe-review-refused contract, even one with an
//                                     active contract that reads 'fail', which would abort a plain close); one whose target is open stays
//  * code-merge-refused-task-merged   CODE-MERGE-REFUSED-1 for a merged code task; a queued task stays
//  * code-loop-exhausted-dod-met      CODE-LOOP-EXHAUSTED-1 whose root issue is closed, or whose root has a merged replacement task; a root that is open
//                                     with no replacement, or a replacement that is only queued, stays
//  * ledger-escalation-resolved       an evReview escalation copy whose ledger row is resolved and has no open twin row (self-heal copies match by tool, other
//                                     copies by whole title); an open ledger row of the same tool keeps it; an issue that is not an escalation copy stays
//  * owner-task-names-closed-issue    an OWNER-TASK that asks for the fix of an issue that is closed, naming the same item; an open target or another item stays
//  * owner-prompt-twin                the same owner prompt filed again is superseded by the OLDEST open ticket; a unique prompt, a short key and another source stay
//  * stale-pr-check-repair-pr-merged  the three merged-PR repair requests
//  * owner-task-semantic-twin         the seven read-by-hand pairs, only while the keeper is open
//  and: every closed issue has evidence ('moot:' or 'superseded by <id>'), close_channel 'workflow:ISSUE-HYGIENE-1 <rule>', its contract superseded, one
//  issue_lifecycle row 'dispositioned' with evidence, a ledger row applied = 1 holding the before-state; nothing is deleted and nothing is wontfix; the
//  kept tickets are byte-identical; a second apply changes nothing; the workflow definition in fleet_tasks holds exactly the statements of the file and,
//  run on a fresh state, gives the same end state; the Rollback line restores status, triage and contracts; the file adds no trigger and no index on
//  agent_issues (AGENT-ISSUES-TRIGGER-DEPTH-1); the detector fm-meta-issue-outlives-subject reads 0 and goes red for a stalled workflow or a stuck row.
// Run: node migrations/issue-hygiene.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const here = (f) => new URL("./" + f, import.meta.url);
const FILE = "2026-10-26-issue-hygiene-1.sql";
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
  db.prepare("INSERT INTO agent_issues (id, title, description, source, category, priority, status, linked_session, created_at, updated_at) VALUES (?, ?, ?, ?, 'reliability', 'medium', ?, ?, ?, ?)")
    .run(o.id, o.title, o.desc || "d", o.source === undefined ? "qnfo-fleet-control" : o.source, o.status || "open", o.linked || null, ms(o.ageH || 30), ms(o.ageH || 30));
  if (o.triage !== false) db.prepare("INSERT INTO issue_triage (issue_id, rc, triage_state, owner, sla_due_at, close_evidence) VALUES (?, 'AUTOTRIAGE-2', ?, 'qnfo-fleet-control', '2026-10-15 18:01:01', ?)")
    .run(o.id, o.status === "closed" ? "closed" : "triaged", o.evidence || null);
  if (o.contract) db.prepare("INSERT INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, escalate_to, expected_cadence_h, status, last_verdict) VALUES (?, ?, 'p', 'a', 'SELECT 1', 'd1-query', 'qnfo-fleet-control', 1, ?, ?)")
    .run("issue-" + id(o), id(o), o.contract, o.verdict || null);
}
const id = (o) => o.id;
const OT = "qnfo-fleet-dashboard:owner-request";

function fixture(db) {
  // ---- R1 probe-needed-target-not-open
  add(db, { id: 100435, title: "OWNER-QUEUE-HONEST-COUNT-1: /api/human must count owner decisions", status: "closed", evidence: "fixed and verified" });
  add(db, { id: 100476, title: "PROBE-NEEDED-1: issue-100435", contract: "probe-review-refused", verdict: "deferred" });                       // closed target, refused contract: closes
  add(db, { id: 100618, title: "FOLD-PAIR-TASK-1 self-deadlock: the suite that gates a merge", status: "closed", evidence: "Live re-probe 2026-10-25T11:14Z: green" });
  add(db, { id: 1000087, title: "PROBE-NEEDED-1: issue-100618", contract: "active", verdict: "fail" });                                      // an active contract that FAILS would abort a plain close
  add(db, { id: 5001, title: "OPEN-TARGET-1: still open and without a probe" });
  add(db, { id: 5002, title: "PROBE-NEEDED-1: issue-5001", contract: "active", verdict: "pending" });                                         // open target: stays
  // ---- R2 code-merge-refused-task-merged
  db.prepare("INSERT INTO code_tasks (id, goal, status, updated_at) VALUES ('ct_im100444', 'g', 'merged', '2026-10-22T03:45:49.184Z'), ('ct_im100448', 'g', 'queued', '2026-10-22T03:45:49.184Z')").run();
  add(db, { id: 100500, title: "CODE-MERGE-REFUSED-1: code task ct_im100444 (qnfo-backlog-exec/worker.js)", contract: "monitoring", verdict: "monitoring:loop-owned-48h" });
  add(db, { id: 100501, title: "CODE-MERGE-REFUSED-1: code task ct_im100448 (scripts/fleet-autoaudit.py)", contract: "monitoring" });         // queued: stays
  // ---- R3 code-loop-exhausted-dod-met
  add(db, { id: 2047, title: "METRIC-TRIGGER-1238-IDEA: Intake diversity", status: "closed", evidence: "recovered" });
  db.prepare("INSERT INTO code_tasks (id, goal, status) VALUES ('ct_im2047', 'METRIC-TRIGGER-1238-IDEA', 'failed'), ('ct_im100350', 'LIVING-PAPER', 'failed'), ('ct_k52qxgs3r3hswg', '[issue #100211] [retry 1] RESEARCH-MODEL-COST-1', 'failed'), ('ct_eg8bpejxuqc1qt', '[issue #100211] RESEARCH-MODEL-COST-1', 'merged'), ('ct_x', '[issue #100999] other', 'failed'), ('ct_y', '[issue #100999] other (replacement)', 'queued')").run();
  add(db, { id: 100321, title: "CODE-LOOP-EXHAUSTED-1: ct_im2047 METRIC-TRIGGER-1238", contract: "monitoring" });                              // root closed: closes
  add(db, { id: 100350, title: "LIVING-PAPER-RESTORE-FLOOR-1: the 20,000-character floor" });                                                 // root open, no replacement
  add(db, { id: 100498, title: "CODE-LOOP-EXHAUSTED-1: ct_im100350 qnfo-research-exec/worker.js", contract: "monitoring" });                   // stays
  add(db, { id: 100211, title: "RESEARCH-MODEL-COST-1: qnfo-research-exec spends 78 percent" });
  add(db, { id: 100549, title: "CODE-LOOP-EXHAUSTED-1: ct_k52qxgs3r3hswg qnfo-research-exec/worker.js", contract: "monitoring" });            // open root, merged replacement: closes
  add(db, { id: 100999, title: "OTHER-ROOT-1: an issue whose replacement task is only queued" });
  add(db, { id: 100998, title: "CODE-LOOP-EXHAUSTED-1: ct_x qnfo-ops/worker.js", contract: "monitoring" });                                    // replacement queued: stays
  // ---- R5 ledger-escalation-resolved
  const L = db.prepare("INSERT INTO issue_ledger (fingerprint, source, level, title, status, last_seen) VALUES (?, 'qnfo-ops', 'high', ?, ?, ?)");
  L.run("selfheal:85ef1588", "[self-heal] tool git_clone_exec failing x4 (20.0% of 20 calls in 6h)", "resolved", "2026-10-25 11:01:10");
  L.run("selfheal:3ddf9c26", "[self-heal] tool github_issue_get failing x5 (62.5% of 8 calls in 6h)", "resolved", "2026-10-25 11:01:11");
  L.run("selfheal:aaaaaaaa", "[self-heal] tool github_issue_get failing x9 (90.0% of 10 calls in 6h)", "open", "2026-10-26 05:30:00");     // the tool is failing again: keeps its copies
  L.run("fp-exact", "qnfo-ops", "CF-OBS thing broke");
  db.prepare("UPDATE issue_ledger SET title = 'EXACT-TITLE: ledger row', status = 'resolved', last_seen = '2026-10-25 09:00:00' WHERE fingerprint = 'fp-exact'").run();
  const esc = "AUTO-ESCALATION from evReview 2026-10-25T11:15:00.000Z - 4x, src qnfo-ops";
  add(db, { id: 1000190, title: "[self-heal] tool git_clone_exec failing x4 (20.0% of 20 calls in 6h)", desc: esc, source: null, contract: "superseded", verdict: "superseded:closure-observing-probe-at-birth" });    // closes
  add(db, { id: 1000141, title: "[self-heal] tool git_clone_exec failing x3 (30.0% of 10 calls in 6h)", desc: esc, source: null });                                                                      // closes (no contract row)
  add(db, { id: 1000165, title: "[self-heal] tool github_issue_get failing x5 (62.5% of 8 calls in 6h)", desc: esc, source: null });                                                                    // an open ledger row of the same tool: stays
  add(db, { id: 1000300, title: "EXACT-TITLE: ledger row", desc: esc, source: null });                                                                                                                   // whole-title match: closes
  add(db, { id: 1000301, title: "[self-heal] tool git_clone_exec failing x8 (61.0% of 13 calls in 6h)", desc: "A person filed this by hand about git_clone_exec", source: null });                         // not an escalation copy: stays
  // ---- R6 owner-task-names-closed-issue
  add(db, { id: 100345, title: "ERRATA-CONFIRM-THROUGHPUT-1: confirmInternalErrata moves 3 rows an hour", status: "closed", evidence: "remediation_verifications#289353 pass=1" });
  add(db, { id: 100581, title: "OWNER-TASK-op-mvln8ii858bb: ERRATA-CONFIRM-THROUGHPUT-1 (issue #100345): raise confirmInternalErrata throughput", source: OT, contract: "superseded" });   // closes
  add(db, { id: 100582, title: "OWNER-TASK-op-mvln8j3d6617: CLOSE-CHANNEL-REQUIRED-1 (issue #100419): ensure issue closes record close_channel", source: OT });                                 // target open: stays
  add(db, { id: 100419, title: "CLOSE-CHANNEL-REQUIRED-1: 449/900 issue closes have NULL close_channel" });
  add(db, { id: 100583, title: "OWNER-TASK-op-mvln8k0000: Unrelated cleanup of the cache (issue #100345): a different item entirely", source: OT });                                           // names a closed issue but not its item: stays
  // ---- R7 owner-prompt-twin
  const P = "Fix the fleet error past its SLA: Integration chain Errata watch -> respond -> publish";
  add(db, { id: 100588, title: "OWNER-TASK-op-mvlpwrbk710a: " + P, source: OT, contract: "superseded" });
  add(db, { id: 100590, title: "OWNER-TASK-op-mvlq0an8d6c8: " + P, source: OT, contract: "superseded" });
  add(db, { id: 1000071, title: "OWNER-TASK-op-mvmtenpwca8d: " + P, source: OT, contract: "superseded" });
  add(db, { id: 100680, title: "OWNER-TASK-op-mvlq9999: " + P + " (a longer, different prompt)", source: OT });                                  // a different whole prompt: stays
  add(db, { id: 100701, title: "OWNER-NOTE-49: UIA-SOURCE-FIDELITY-1: authorize the seven fixes to the Ignorance Audit papers", source: OT });
  add(db, { id: 100702, title: "OWNER-NOTE-50: UIA-SOURCE-FIDELITY-1: authorize the seven fixes to the Ignorance Audit papers", source: OT });  // twin of 100701: closes
  add(db, { id: 100703, title: "OWNER-NOTE-60: short key", source: OT }); add(db, { id: 100704, title: "OWNER-NOTE-61: short key", source: OT });         // key under 20 characters: stays
  add(db, { id: 100705, title: "OWNER-TASK-op-zz1: " + P, source: "owner-chat" });                                                                 // another source: stays
  // ---- R4 stale-pr-check-repair-pr-merged
  for (const [i, pr] of [[1000127, 3931], [1000128, 3935], [1000129, 3941], [1000130, 3999]]) add(db, { id: i, title: "STALE-PR-CHECK-REPAIR-1 PR " + pr + ": Workers Builds: qnfo-workers failing", contract: "monitoring" });   // 3999 is not a merged PR here: stays
  // ---- R8 owner-task-semantic-twin (keeper open)
  add(db, { id: 1000064, title: "OWNER-TASK-op-mvmng02z1b91: Investigate and unblock the stuck integration chain Errata watch -> respond -> publish (625 waiting)", source: OT });
  add(db, { id: 1000073, title: "OWNER-TASK-op-mvmtfjtj5cb4: Unstick the Errata watch -> respond -> publish integration chain (631 waiting)", source: OT, contract: "superseded" });
  add(db, { id: 1000076, title: "OWNER-TASK-op-mvmtg796eb87: Unstick the Errata integration chain: 631 messages waiting", source: OT });
  add(db, { id: 1000081, title: "OWNER-TASK-op-mvmtgnpr5243: Unstick the Errata watch -> respond -> publish integration chain: 631 items", source: OT });
  add(db, { id: 100523, title: "OWNER-TASK-op-mvj9cyv5fec0: Implement the smallest fix for gap C-01 (D1 body truncation): make DOIs the canonical source", source: OT });
  add(db, { id: 100585, title: "OWNER-TASK-op-mvlptrz5591c: Implement the smallest fix for the D1 truncation breach: make DOIs the canonical source", source: OT });
  add(db, { id: 100597, title: "OWNER-TASK-op-mvm7d9i71a19: Implement the minimal D1 truncation mitigation: make DOIs the canonical source", source: OT });
  add(db, { id: 1000241, title: "OWNER-TASK-op-mvogk1da6b11: Implement the smallest fix for the D1 truncation breach: make DOIs the canonical source for full text", source: OT });
  add(db, { id: 100384, title: "OWNER-TASK-op-mvh2iuolcaa1: Audit fleet cost attribution: identify the untagged owner-local desktop clients", source: OT });
  add(db, { id: 100385, title: "OWNER-TASK-op-mvh2juof8d7d: Identify the untagged owner-local desktop clients that generated $167", source: OT });
  // ---- untouched
  add(db, { id: 7001, title: "A plain real defect that carries work" });
  add(db, { id: 7002, title: "Another one", status: "monitoring" });
}
const CLOSES = {
  "probe-needed-target-not-open": [100476, 1000087],
  "code-merge-refused-task-merged": [100500],
  "code-loop-exhausted-dod-met": [100321, 100549],
  "ledger-escalation-resolved": [1000190, 1000141, 1000300],
  "owner-task-names-closed-issue": [100581],
  "owner-prompt-twin": [100590, 1000071, 100702],
  "stale-pr-check-repair-pr-merged": [1000127, 1000128, 1000129],
  "owner-task-semantic-twin": [1000073, 1000076, 1000081, 100585, 100597, 1000241, 100385],
};
const STAYS = [5002, 100501, 100498, 100998, 1000165, 1000301, 100582, 100583, 100588, 100680, 100701, 100703, 100704, 100705, 1000130, 1000064, 100523, 100384, 7001, 7002, 5001, 100419, 100211, 100350, 100999];
const SUCC = { 100590: 100588, 1000071: 100588, 100702: 100701, 1000073: 1000064, 1000076: 1000064, 1000081: 1000064, 100585: 100523, 100597: 100523, 1000241: 100523, 100385: 100384 };
const snap = (db) => ({
  agent: all(db, "SELECT id, title, description, source, status, close_channel, linked_session FROM agent_issues ORDER BY id"),
  triage: all(db, "SELECT issue_id, triage_state, close_evidence, reopened_count, triaged_at FROM issue_triage ORDER BY issue_id"),
  contracts: all(db, "SELECT class, status, last_verdict FROM remediation_contracts ORDER BY class"),
});
const detector = (db) => { const p = one(db, "SELECT verify_probe FROM remediation_contracts WHERE class = 'fm-meta-issue-outlives-subject'"); return p ? one(db, p.verify_probe) : null; };

// ================= base, then the file =================
// SUITE-FLAKE-1: base and db are two separate builds and issue_triage.triaged_at defaults to datetime('now'), so a second boundary crossed between the two
// fixtures made every kept ticket's triage row differ (1 run in 12 locally, every run on the loaded CI runner from 2026-11-04 23:04Z, ci-watchdog issue 7294).
// Both fixtures get the same frozen stamp before the file runs; the file's own writes to triaged_at still show in the comparison.
const FROZEN = "2026-10-26 00:00:00";
const freeze = (d) => d.exec("UPDATE issue_triage SET triaged_at = '" + FROZEN + "'");
const base = build(); fixture(base); freeze(base);
const before = snap(base);
const trg0 = one(base, "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger'").n;
const db = build(); fixture(db); freeze(db); db.exec(sql);
const after = snap(db);
const closedIds = Object.values(CLOSES).flat();

for (const [rule, ids] of Object.entries(CLOSES)) {
  for (const i of ids) {
    const a = after.agent.find((r) => r.id === i), t = after.triage.find((r) => r.issue_id === i), c = after.contracts.find((r) => r.class === "issue-" + i);
    ok(a.status === "closed", rule + ": " + i + " is closed", a.status);
    ok(a.close_channel === "workflow:ISSUE-HYGIENE-1 " + rule, rule + ": " + i + " names its channel", a.close_channel);
    ok(t.triage_state === "closed" && (SUCC[i] ? t.close_evidence.startsWith("superseded by " + SUCC[i] + " (") : t.close_evidence.startsWith("moot: ")), rule + ": " + i + " evidence reads '" + (SUCC[i] ? "superseded by " + SUCC[i] : "moot:") + "'", t.close_evidence.slice(0, 70));
    ok(/ISSUE-HYGIENE-1 \d{4}-\d{2}-\d{2}$/.test(t.close_evidence), rule + ": " + i + " evidence is dated and tagged", t.close_evidence.slice(-40));
    if (c) ok(c.status === "superseded", rule + ": " + i + " contract is superseded", c);
    const life = all(db, "SELECT event, from_status, to_status, has_evidence FROM issue_lifecycle WHERE issue_id = ?", i);
    ok(life.length === 1 && life[0].event === "dispositioned" && life[0].from_status === "open" && life[0].has_evidence === 1, rule + ": " + i + " has one lifecycle row 'dispositioned' with evidence", life);
    const l = one(db, "SELECT * FROM issue_fold_ledger WHERE issue_id = ?", i);
    ok(l && l.rule === rule && l.applied === 1 && l.agent_status === "open" && l.successor_id === (SUCC[i] || l.successor_id), rule + ": " + i + " is in the ledger, applied, with its before-state", l);
  }
}
ok(all(db, "SELECT 1 FROM issue_fold_ledger").length === closedIds.length, "one ledger row per close and no other (" + closedIds.length + ")", all(db, "SELECT issue_id, rule FROM issue_fold_ledger").length);
ok(new Set(all(db, "SELECT issue_id FROM issue_fold_ledger").map((r) => r.issue_id)).size === closedIds.length, "no issue is folded twice by two rules");
ok(all(db, "SELECT 1 FROM agent_issues WHERE status = 'wontfix'").length === 0, "nothing is wontfix");
ok(one(db, "SELECT COUNT(*) AS n FROM agent_issues").n === before.agent.length, "nothing is deleted");
// the specific evidence facts
const ev = (i) => after.triage.find((r) => r.issue_id === i).close_evidence;
ok(ev(100476).includes("issue 100435 is closed"), "R1 evidence names the target and its status", ev(100476).slice(0, 90));
ok(ev(100500).includes("ct_im100444 is merged") && ev(100500).includes("2026-10-22T03:45:49.184Z"), "R2 evidence names the task and the time it was last updated", ev(100500).slice(0, 120));
ok(ev(100321).includes("issue 2047") && ev(100549).includes("a replacement task for issue 100211 is merged or published"), "R3 evidence says which half of the definition of done is met");
ok(ev(1000190).includes("selfheal:85ef1588") && ev(1000190).includes("2026-10-25 11:01:10") && ev(1000300).includes("fp-exact"), "R5 evidence names the ledger fingerprint and its last-seen time", ev(1000190).slice(0, 120));
ok(ev(100581).includes("issue 100345") && ev(100581).includes("remediation_verifications#289353"), "R6 evidence quotes the close evidence of the closed issue", ev(100581).slice(0, 140));
ok(ev(1000127).includes("PR 3931 is merged") && ev(1000127).includes("2026-10-25T07:10:17Z") && ev(1000129).includes("2026-10-25T07:36:45Z"), "R4 evidence names the PR and its merge time", ev(1000127).slice(0, 110));
// the keepers and everything else are byte-identical
for (const i of STAYS) {
  const a0 = before.agent.find((r) => r.id === i), a1 = after.agent.find((r) => r.id === i);
  ok(JSON.stringify(a0) === JSON.stringify(a1), "kept ticket " + i + " is unchanged", { a0, a1 });
  ok(JSON.stringify(before.triage.find((r) => r.issue_id === i)) === JSON.stringify(after.triage.find((r) => r.issue_id === i)), "kept ticket " + i + ": triage row unchanged");
  ok(JSON.stringify(before.contracts.find((r) => r.class === "issue-" + i) || null) === JSON.stringify(after.contracts.find((r) => r.class === "issue-" + i) || null), "kept ticket " + i + ": contract unchanged");
}
ok(before.agent.filter((r) => r.status === "open").length - after.agent.filter((r) => r.status === "open").length === closedIds.length, "the open count falls by exactly the number of closes");

// ================= no trigger, no index =================
ok(one(db, "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger'").n === trg0, "the file adds no trigger (AGENT-ISSUES-TRIGGER-DEPTH-1)");
ok(!/\bCREATE\s+(UNIQUE\s+)?TRIGGER\b/i.test(sql.replace(/^--.*$/gm, "")), "the file text creates no trigger");
ok(all(db, "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name IN ('agent_issues', 'issue_triage')").length === 1, "no index is added to agent_issues or issue_triage (only the fixture's own)");

// ================= idempotent =================
db.exec(sql);
const again = snap(db);
const stripTriagedAt = (s) => JSON.stringify({ ...s, triage: s.triage.map((r) => { const { triaged_at, ...x } = r; return x; }) });
ok(stripTriagedAt(again) === stripTriagedAt(after), "a second apply changes nothing");
ok(one(db, "SELECT COUNT(*) AS n FROM issue_fold_ledger").n === closedIds.length, "a second apply adds no ledger row");
ok(one(db, "SELECT COUNT(*) AS n FROM issue_lifecycle WHERE event = 'dispositioned'").n === closedIds.length, "a second apply writes no lifecycle row");
ok(one(db, "SELECT COUNT(*) AS n FROM decision_log").n === 1 && one(db, "SELECT COUNT(*) AS n FROM failure_modes").n === 1 && one(db, "SELECT COUNT(*) AS n FROM fleet_tasks").n === 1 && one(db, "SELECT COUNT(*) AS n FROM fleet_crons").n === 1, "one decision, one failure mode, one workflow, one cron after two applies");

// ================= the workflow equals the file =================
const task = one(db, "SELECT * FROM fleet_tasks WHERE id = 'issue-meta-fold'");
const steps = JSON.parse(task.definition).steps;
ok(task.type === "workflow" && task.enabled === 1 && task.timeout_ms === 120000 && steps.length === 11 && steps.every((s) => s.type === "sql" && s.db === "AUDIT"), "the workflow has eleven SQL steps on AUDIT", { n: steps.length, type: task.type });
const body = sql.replace(/^--.*$/gm, "");
ok(steps.every((s) => body.includes(s.sql + ";")), "every workflow step appears verbatim in the file (the backfill is the workflow's own statements)");
const cron = one(db, "SELECT * FROM fleet_crons WHERE name = 'issue-meta-fold-hourly'");
ok(cron && cron.cron_expr === "20 * * * *" && cron.task_id === "issue-meta-fold" && cron.enabled === 1, "the cron is hourly at :20 and bound to the workflow", cron);
// run the workflow on a fresh state: same end state as the file (the table and its index are the migration's, the workflow assumes them)
const DDL = /CREATE TABLE IF NOT EXISTS issue_fold_ledger \([\s\S]*?\);/.exec(sql)[0] + "\n" + /CREATE INDEX IF NOT EXISTS idx_issue_fold_ledger_issue[^;]*;/.exec(sql)[0];
const wf = build(); wf.exec(DDL); fixture(wf);
for (const s of steps) wf.exec(s.sql);
const afterWf = snap(wf);
const hourlyIds = [].concat(CLOSES["probe-needed-target-not-open"], CLOSES["code-merge-refused-task-merged"], CLOSES["code-loop-exhausted-dod-met"], CLOSES["ledger-escalation-resolved"], CLOSES["owner-task-names-closed-issue"], CLOSES["owner-prompt-twin"]);
ok(hourlyIds.every((i) => afterWf.agent.find((r) => r.id === i).status === "closed"), "the workflow alone closes every live-state rule's issues");
ok([].concat(CLOSES["stale-pr-check-repair-pr-merged"], CLOSES["owner-task-semantic-twin"]).every((i) => afterWf.agent.find((r) => r.id === i).status === "open"), "the one-time rules are not in the workflow");
// a new subject resolving later closes its ticket on the next run
const wf2 = build(); wf2.exec(DDL); fixture(wf2);
wf2.prepare("UPDATE issue_triage SET close_evidence = 'fixed by hand' WHERE issue_id = 5001").run();
wf2.prepare("UPDATE agent_issues SET status = 'closed' WHERE id = 5001").run();
for (const s of steps) wf2.exec(s.sql);
ok(one(wf2, "SELECT status FROM agent_issues WHERE id = 5002").status === "closed", "when a target closes later, its PROBE-NEEDED-1 ticket closes on the next run");
for (const s of steps) wf2.exec(s.sql);
ok(one(wf2, "SELECT COUNT(*) AS n FROM issue_fold_ledger WHERE issue_id = 5002").n === 1, "and the next run adds nothing");

// ================= a reopened ticket is folded again with fresh evidence =================
const re = build(); re.exec(DDL); fixture(re); for (const s of steps) re.exec(s.sql);
re.prepare("UPDATE issue_triage SET triage_state = 'triaged', close_evidence = NULL WHERE issue_id = 100476").run();
re.prepare("UPDATE agent_issues SET status = 'open' WHERE id = 100476").run();
for (const s of steps) re.exec(s.sql);
ok(one(re, "SELECT status FROM agent_issues WHERE id = 100476").status === "closed" && one(re, "SELECT COUNT(*) AS n FROM issue_fold_ledger WHERE issue_id = 100476").n === 2, "a ticket reopened while its subject is still resolved is folded again, as a second ledger row");

// ================= detector =================
ok(JSON.stringify(detector(db)) === JSON.stringify({ expected: "0", observed: "1" }), "detector: a workflow that has never fired reads 1", detector(db));
db.prepare("UPDATE fleet_crons SET last_fired = ? WHERE name = 'issue-meta-fold-hourly'").run(new Date(Date.now() - 20 * 60 * 1000).toISOString());
ok(detector(db).observed === "0", "detector: a workflow that fired 20 minutes ago and no stuck row reads 0", detector(db));
db.prepare("UPDATE fleet_crons SET last_fired = ? WHERE name = 'issue-meta-fold-hourly'").run(new Date(Date.now() - 200 * 60 * 1000).toISOString());
ok(detector(db).observed === "1", "detector: a workflow quiet for 200 minutes reads 1", detector(db));
db.prepare("UPDATE fleet_crons SET last_fired = ? WHERE name = 'issue-meta-fold-hourly'").run(new Date().toISOString());
db.prepare("INSERT INTO issue_fold_ledger (issue_id, rule, evidence, applied, created_at) VALUES (7001, 'x', 'e', 0, datetime('now', '-3 hours'))").run();
ok(detector(db).observed === "1", "detector: a ledger row pending for over two hours reads 1", detector(db));
db.prepare("DELETE FROM issue_fold_ledger WHERE issue_id = 7001").run();

// ================= rollback restores the before-state =================
const rb = build(); fixture(rb); rb.exec(sql);
for (const part of rollback.split(/;\s+(?=UPDATE|DELETE)/)) rb.exec(part);
const restored = snap(rb);
for (const i of closedIds) {
  const a0 = before.agent.find((r) => r.id === i), a1 = restored.agent.find((r) => r.id === i);
  ok(a1.status === "open" && a1.close_channel === a0.close_channel, "rollback reopens " + i + " and restores its close channel", { a1 });
  const t0 = before.triage.find((r) => r.issue_id === i), t1 = restored.triage.find((r) => r.issue_id === i);
  ok(t1.triage_state === t0.triage_state && t1.close_evidence === t0.close_evidence, "rollback restores the triage row of " + i, { t0, t1 });
  const c0 = before.contracts.find((r) => r.class === "issue-" + i), c1 = restored.contracts.find((r) => r.class === "issue-" + i);
  if (c0) ok(c1.status === c0.status, "rollback restores the contract of " + i + " (" + c0.status + ")", { c0, c1 });
}
ok(one(rb, "SELECT COUNT(*) AS n FROM fleet_crons WHERE name = 'issue-meta-fold-hourly' AND enabled = 1").n === 0, "rollback stops the workflow");
ok(one(rb, "SELECT COUNT(*) AS n FROM failure_modes").n === 0, "rollback removes the failure mode");

// ================= a failing contract does not abort the set (close-while-contract-fails) =================
ok(after.agent.find((r) => r.id === 1000087).status === "closed", "1000087 (active contract reading 'fail') is closed: its contract was settled first");

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
