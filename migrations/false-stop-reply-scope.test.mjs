// FALSE-STOP-REPLY-SCOPE-1 offline suite: replays migrations/2026-10-27-false-stop-reply-scope.sql on SQLite, starting from the two views as
// migrations/2026-10-12-20-kernel-registries.sql created them and from the nine false_stop_hits rows read on 2026-10-26 (ids, reply ids,
// patterns and phrases are the live ones, the response texts are short fixtures with the same shape).
// Proves: the three real conditional offers stay counted; the four hits that are model reasoning cut at the generation cap, the quoted
// signature list and the stated hypothesis move to false_stop_hits_reclassified with a class and reason each; the new views skip
// capped output (8000 and 8192 completion tokens, and only those) and a phrase that is only inside double quotes or backticks, and still
// catch an unquoted offer, a menu and a NULL-token row; doctrine proposal 316 is rejected with a red-team result; the failure mode, its
// detector contract (expected 0, observed = capped ok = 1 rows of the last 7 days) and the code-task issue are written once;
// a second apply changes nothing; the Rollback line puts the moved rows back.
// Run: node migrations/false-stop-reply-scope.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("./2026-10-27-false-stop-reply-scope.sql", import.meta.url), "utf8");
const dispositionSql = readFileSync(new URL("./2026-11-03-false-stop-disposition.sql", import.meta.url), "utf8");
const kernel = readFileSync(new URL("./2026-10-12-20-kernel-registries.sql", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };

const oldReplies = /CREATE VIEW IF NOT EXISTS v_agent_replies AS[\s\S]*?\n\);\n/.exec(kernel)[0];
const oldCandidates = /CREATE VIEW IF NOT EXISTS v_false_stop_candidates AS[\s\S]*?> 0;\n/.exec(kernel)[0];
ok(oldReplies && oldCandidates, "the earlier view texts are read from the kernel registries migration");

const d = new DatabaseSync(":memory:");
d.exec(`
CREATE TABLE ops_ai_log (id TEXT PRIMARY KEY, ts TEXT NOT NULL, model TEXT, strategy TEXT, prompt TEXT, response TEXT, completion_tokens INTEGER, tool_calls TEXT, source TEXT, ok INTEGER DEFAULT 1);
CREATE TABLE owner_prompts (id TEXT PRIMARY KEY, ts TEXT, prompt TEXT, response TEXT);
CREATE TABLE session_records (session_id TEXT PRIMARY KEY, created_at TEXT, summary TEXT, handoff_notes TEXT);
CREATE TABLE ask_events (id TEXT PRIMARY KEY, ts TEXT, answer TEXT);
CREATE TABLE chatbox_conversations (id TEXT PRIMARY KEY, ts TEXT, source TEXT, response TEXT);
CREATE TABLE false_stop_phrases (phrase TEXT PRIMARY KEY, pattern_key TEXT NOT NULL, scope TEXT NOT NULL CHECK (scope IN ('reply', 'user', 'disposition')));
CREATE TABLE false_stop_hits (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), source TEXT NOT NULL, reply_id TEXT NOT NULL, reply_ts TEXT, pattern_key TEXT NOT NULL, phrase TEXT, excerpt TEXT, UNIQUE (source, reply_id, pattern_key));
CREATE TABLE doctrine_proposals (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), source TEXT NOT NULL UNIQUE, signal TEXT NOT NULL, proposed_rule TEXT NOT NULL, red_team_result TEXT, metrics_improved TEXT, version TEXT, status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'adopted', 'rejected', 'superseded')), disposed_at TEXT);
CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT NOT NULL, root_cause TEXT NOT NULL, remediation TEXT NOT NULL, detector TEXT NOT NULL, probe_class TEXT, first_seen TEXT NOT NULL, issue_id INTEGER, trigger_condition TEXT, symptom TEXT, blast_radius TEXT);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT NOT NULL, action TEXT NOT NULL, verify_probe TEXT NOT NULL, verify_transport TEXT NOT NULL, max_attempts INTEGER NOT NULL DEFAULT 3, escalate_to TEXT NOT NULL, expected_cadence_h INTEGER, status TEXT DEFAULT 'active', ts TEXT DEFAULT (datetime('now')), last_attempt_at TEXT, last_verdict TEXT, module TEXT, budget_ms INTEGER DEFAULT 45000, next_due_at TEXT, max_items INTEGER DEFAULT 5, requires_container INTEGER DEFAULT 0, attempts INTEGER DEFAULT 0, deferred_since TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT, outcome_matched INTEGER);
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT DEFAULT 'open', created_at INTEGER, updated_at INTEGER);
`);
d.exec(oldReplies);
d.exec(oldCandidates);
const phrase = d.prepare("INSERT INTO false_stop_phrases (phrase, pattern_key, scope) VALUES (?, ?, ?)");
for (const [p, k, s] of [["if you want", "conditional-offer", "reply"], ["would you like", "conditional-offer", "reply"], ["shall i", "conditional-offer", "reply"],
  ["let me know if", "conditional-offer", "reply"], ["alternatively", "menu", "reply"], ["two options", "menu", "reply"], ["the fix is to", "narration", "reply"],
  ["refused", "disposition", "disposition"], ["live claim", "disposition", "disposition"]]) phrase.run(p, k, s);

const hoursAgo = (h) => new Date(Date.now() - h * 36e5).toISOString().slice(0, 19) + "Z";
const log = d.prepare("INSERT INTO ops_ai_log (id, ts, strategy, response, completion_tokens, tool_calls, source, ok) VALUES (?, ?, ?, ?, ?, ?, ?, 1)");
const rows = {
  "ops-1a418c26da88ce": ["agent-tools", "The request is currently waiting to be verified, so `123456` wasn't accepted. If you want owner access, a fresh 6-digit code has to be emailed first.", 200, "[]"],
  "ops-cbe5974fdaf051": ["agent-tools", "The request is currently waiting to be verified, so `123456` wasn't accepted. If you want owner access, a fresh 6-digit code has to be emailed first.", 219, "[]"],
  "ops-2ec01565c60188": ["agent-tools", "Done, filed in persistent memory. My toolset has no write into the issue store, so if you want it as a formal agent issue, that is a one-line addition.", 507, "[]"],
  "ops-6a811b4c1aa914": ["agent-tools", "Good data. Now let me analyze the fleet. The rule says never end with a menu, so no would you like me to ending. I should state it pla", 8192, '[{"name":"public_data"}]'],
  "ops-935c733638a008": ["job-workflow", "Let me reconstruct where I am. Alternatively the task could be to fix the endpoints, or the fix is to create the record. Hmm hold on, wait. Let me re-", 8000, "[]"],
  "ops-b5681a392e5615": ["job-workflow", "Let me reconstruct where I am. Writes need care. Alternatively use idea_submit kind=issue. Hmm, but the fix will already be done", 8000, "[]"],
  "ops-020796cbd0e3c5": ["job-workflow", 'Fixed 1 of 3: proposals 197 and 199 duplicated a recognition in force (the kernel lists "if you want", "let me know if", "shall I", "would you like"). Marked superseded.', 3193, "[]"],
  "ops-97b030716fb1c7": ["agent-tools", "Root cause recorded. Failure modes: fixing revise could restore throughput, alternatively the 10-20 cut may have been a deliberate owner cost decision.", 953, "[]"],
};
let n = 0;
for (const [id, [strategy, text, tokens, tools]] of Object.entries(rows)) log.run(id, hoursAgo(24 + n++), strategy, text, tokens, tools, "public");
const hit = d.prepare("INSERT INTO false_stop_hits (id, ts, source, reply_id, reply_ts, pattern_key, phrase, excerpt) VALUES (?, ?, 'ops_ai_log', ?, ?, ?, ?, ?)");
const live = [[21, "ops-1a418c26da88ce", "conditional-offer", "if you want"], [22, "ops-cbe5974fdaf051", "conditional-offer", "if you want"],
  [25, "ops-6a811b4c1aa914", "conditional-offer", "would you like"], [27, "ops-020796cbd0e3c5", "conditional-offer", "if you want"],
  [35, "ops-2ec01565c60188", "conditional-offer", "if you want"], [37, "ops-97b030716fb1c7", "menu", "alternatively"],
  [39, "ops-b5681a392e5615", "menu", "alternatively"], [40, "ops-935c733638a008", "menu", "alternatively"], [41, "ops-935c733638a008", "narration", "the fix is to"]];
for (const [id, rid, key, ph] of live) hit.run(id, hoursAgo(30), rid, hoursAgo(30), key, ph, "excerpt " + id);
d.prepare("INSERT INTO doctrine_proposals (id, ts, source, signal, proposed_rule, status) VALUES (316, ?, 'false_stop:menu:ops_ai_log', '3 hits in 7 days', 'The emitter behind ops_ai_log reports its decision as done instead of emitting the menu signature.', 'proposed')").run(hoursAgo(40));

// the earlier views reproduce the nine hits from the fixture rows (a sanity check on the fixture, not on the migration)
const oldIds = d.prepare("SELECT DISTINCT reply_id FROM v_false_stop_candidates ORDER BY 1").all().map((r) => r.reply_id);
ok(oldIds.length === 8, "the earlier candidate view flags all eight fixture replies", oldIds);

const open316 = () => d.prepare("SELECT COUNT(*) AS n FROM doctrine_proposals WHERE status = 'proposed' AND ts < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-24 hours')").get().n;
ok(open316() === 1, "before: one proposal waits over a day");

d.exec(sql);

const kept = d.prepare("SELECT id FROM false_stop_hits ORDER BY id").all().map((r) => r.id);
ok(kept.join() === "21,22,35", "only the three real conditional offers stay counted", kept);
const moved = d.prepare("SELECT id, reclass_class FROM false_stop_hits_reclassified ORDER BY id").all();
ok(moved.map((r) => r.id).join() === "25,27,37,39,40,41", "six hits moved with their ids", moved);
const klass = Object.fromEntries(moved.map((r) => [r.id, r.reclass_class]));
ok(klass[25] === "output-cap-reasoning" && klass[39] === "output-cap-reasoning" && klass[40] === "output-cap-reasoning" && klass[41] === "output-cap-reasoning" && klass[27] === "quoted-signature" && klass[37] === "hypothesis-not-option",
  "each moved hit carries its class", klass);
ok(d.prepare("SELECT COUNT(*) AS n FROM false_stop_hits_reclassified WHERE reclass_reason IS NULL OR length(reclass_reason) < 80 OR migration <> 'FALSE-STOP-REPLY-SCOPE-1' OR excerpt IS NULL").get().n === 0, "each moved hit keeps its excerpt and a written reason");

// the new views: the live rows
const cand = d.prepare("SELECT DISTINCT reply_id FROM v_false_stop_candidates ORDER BY 1").all().map((r) => r.reply_id);
ok(cand.join() === "ops-1a418c26da88ce,ops-2ec01565c60188,ops-97b030716fb1c7,ops-cbe5974fdaf051", "the new candidate view keeps the real offers (and the one hypothesis row, which is set aside by id, not by rule)", cand);

// the new views: rules, one row each
const add = (id, text, tokens) => log.run(id, hoursAgo(1), "agent-tools", text, tokens, "[]", "public");
add("t-uncapped-menu", "There are two options here. Alternatively you could do the other.", 900);
add("t-capped-8000", "There are two options here. Alternatively you could do the other.", 8000);
add("t-capped-8192", "There are two options here. Alternatively you could do the other.", 8192);
add("t-multiround-8100", "There are two options here. Alternatively you could do the other.", 8100);
add("t-big-multiround", "There are two options here. Alternatively you could do the other.", 56815);
add("t-null-tokens", "Would you like me to continue?", null);
add("t-quoted", 'The kernel signature is "would you like" and the other is `shall I`.', 300);
add("t-quoted-and-used", 'The kernel signature is "would you like" and I ask: would you like me to proceed.', 300);
add("t-single-quoted-only", "I wrote 'would you like' once", 300);
add("t-plain-done", "Done. The change is merged and verified live.", 300);
const ids = new Set(d.prepare("SELECT DISTINCT reply_id FROM v_false_stop_candidates").all().map((r) => r.reply_id));
ok(ids.has("t-uncapped-menu"), "an uncapped menu is still caught");
ok(!ids.has("t-capped-8000") && !ids.has("t-capped-8192"), "output cut at 8000 or 8192 completion tokens is not read as a reply");
ok(ids.has("t-multiround-8100") && ids.has("t-big-multiround"), "a summed multi-round turn at another token count is still scanned (the rule keys on the two exact cap values)");
ok(ids.has("t-null-tokens"), "a row with NULL completion_tokens is still scanned");
ok(!ids.has("t-quoted"), "a phrase only inside double quotes or backticks is a mention");
ok(ids.has("t-quoted-and-used"), "a quoted phrase does not shelter an unquoted use of the same phrase");
ok(ids.has("t-single-quoted-only"), "single quotes are not treated as quoting (contractions)");
ok(!ids.has("t-plain-done"), "a plain report is not a candidate");
const view = d.prepare("SELECT sql FROM sqlite_master WHERE name = 'v_agent_replies'").get().sql;
ok(/owner_prompts/.test(view) && /session_records/.test(view) && /ask_events/.test(view) && /chatbox_conversations/.test(view), "the other four reply sources are unchanged");

// proposal 316
const p = d.prepare("SELECT status, version, disposed_at, red_team_result, metrics_improved FROM doctrine_proposals WHERE id = 316").get();
ok(p.status === "rejected" && p.version === "8.2.1" && /^\d{4}-\d\d-\d\dT/.test(p.disposed_at) && p.red_team_result.length > 600 && /transient/.test(p.red_team_result) && /already in force/.test(p.red_team_result) && /false_stops_7d/.test(p.metrics_improved), "proposal 316 is rejected with its red-team result", p);
ok(open316() === 0, "after: no proposal waits over a day");

// failure mode, detector, issue, decision
const fm = d.prepare("SELECT * FROM failure_modes WHERE fm_key = 'ops-capped-reply-logged-ok'").get();
const iss = d.prepare("SELECT * FROM agent_issues WHERE title LIKE 'OPS-CAPPED-REPLY-1:%'").all();
ok(fm && iss.length === 1 && fm.issue_id === iss[0].id && fm.probe_class === "fm-ops-capped-reply-logged-ok", "failure mode registered and linked to its issue", { fm, n: iss.length });
const desc = iss[0].description;
ok(/\ncode-task: repo=qnfo-workers path=qnfo-ops\/worker\.js\n/.test(desc) && /\ncode-anchor: if \(_g0 && /.test(desc) && /\ncode-probe: \{"paths": \["qnfo-ops\/worker\.js"\], "contains": "OPS-CAPPED-REPLY-1"\}$/.test(desc), "the issue carries code-task, code-anchor and code-probe lines");
ok(iss[0].priority === "high" && iss[0].status === "open" && iss[0].created_at > 1.7e12, "the issue is open, high priority and stamped in milliseconds");
const probe = () => d.prepare(d.prepare("SELECT verify_probe FROM remediation_contracts WHERE class = 'fm-ops-capped-reply-logged-ok'").get().verify_probe).get();
const pr = probe();
ok(pr.expected === "0" && pr.observed === "5", "the detector counts ok = 1 rows at exactly 8000 or 8192 tokens in the last 7 days (3 fixture rows plus the two added above)", pr);
d.exec("UPDATE ops_ai_log SET ts = '2020-01-01T00:00:00Z' WHERE completion_tokens IN (8000, 8192)");
ok(probe().observed === "0", "the detector reads 0 once no such row is in the last 7 days", probe());
ok(d.prepare("SELECT COUNT(*) AS n FROM decision_log WHERE action LIKE 'FALSE-STOP-REPLY-SCOPE-1:%'").get().n === 1, "one decision_log row");

// refusal-with-reason phrases take precedence over a conditional-offer phrase, including stored hits.
const dispositionTs = hoursAgo(1);
const dispositionReplies = [
  [16, "If you want them actually gone, that requires a D1 DELETE."],
  [17, "The request is waiting to be verified. If you want owner access, a fresh code has to be emailed first."],
  [18, "The request wasn't accepted. If you want owner access, a fresh code has to be emailed first."],
];
for (const [id, response] of dispositionReplies) {
  const replyId = "ops-row-" + id;
  log.run(replyId, dispositionTs, "agent-tools", response, 300, "[]", "public");
  hit.run(id, dispositionTs, replyId, dispositionTs, "conditional-offer", "if you want", response);
}
d.exec(dispositionSql);
const classified = d.prepare("SELECT id, disposition_phrases FROM false_stop_hits_dispositioned ORDER BY id").all();
ok(classified.map((r) => r.id).join() === "16,17,18,21,22", "all five refusal-with-reason hits are reclassified", classified);
const matchedDispositions = classified.map((r) => r.disposition_phrases).join(", ");
ok(["waiting to be verified", "wasn't accepted", "has to be emailed first", "requires a d1 delete"].every((phrase) => matchedDispositions.includes(phrase)),
  "the new refusal-with-reason phrases are recorded as the reason for reclassification", classified);
ok(d.prepare("SELECT COUNT(*) AS n FROM false_stop_phrases WHERE scope = 'disposition' AND phrase IN ('waiting to be verified', 'wasn''t accepted', 'has to be emailed first', 'requires a d1 delete')").get().n === 4,
  "all four refusal-with-reason phrases are seeded as dispositions");
ok(d.prepare("SELECT id FROM false_stop_hits ORDER BY id").all().map((r) => r.id).join() === "35",
  "disposition-bearing hits leave the active ledger while the bare offer stays");
const remaining = d.prepare("SELECT DISTINCT reply_id FROM v_false_stop_candidates ORDER BY reply_id").all().map((r) => r.reply_id);
ok(remaining.includes("ops-2ec01565c60188") && !remaining.includes("ops-1a418c26da88ce") &&
  !remaining.includes("ops-cbe5974fdaf051") && !remaining.includes("ops-row-16") &&
  !remaining.includes("ops-row-17") && !remaining.includes("ops-row-18"),
  "the candidate view excludes offers attached to dispositions but preserves the independent bare offer", remaining);
const beforeDispositionReapply = JSON.stringify([
  d.prepare("SELECT id FROM false_stop_hits ORDER BY id").all(),
  d.prepare("SELECT id FROM false_stop_hits_dispositioned ORDER BY id").all(),
  d.prepare("SELECT phrase FROM false_stop_phrases WHERE scope = 'disposition' ORDER BY phrase").all(),
]);
d.exec(dispositionSql);
ok(JSON.stringify([
  d.prepare("SELECT id FROM false_stop_hits ORDER BY id").all(),
  d.prepare("SELECT id FROM false_stop_hits_dispositioned ORDER BY id").all(),
  d.prepare("SELECT phrase FROM false_stop_phrases WHERE scope = 'disposition' ORDER BY phrase").all(),
]) === beforeDispositionReapply, "the disposition migration is idempotent");

// second apply changes nothing
const snap = () => JSON.stringify([d.prepare("SELECT id FROM false_stop_hits ORDER BY id").all(), d.prepare("SELECT COUNT(*) AS n FROM false_stop_hits_reclassified").get(),
  d.prepare("SELECT COUNT(*) AS n FROM agent_issues").get(), d.prepare("SELECT COUNT(*) AS n FROM failure_modes").get(), d.prepare("SELECT COUNT(*) AS n FROM remediation_contracts").get(),
  d.prepare("SELECT COUNT(*) AS n FROM decision_log").get(), d.prepare("SELECT status, disposed_at FROM doctrine_proposals WHERE id = 316").get()]);
const before2 = snap();
d.exec(sql);
ok(snap() === before2, "a second apply changes nothing");
const cand2 = d.prepare("SELECT COUNT(DISTINCT reply_id) AS n FROM v_false_stop_candidates").get().n;
ok(cand2 === 8, "the views still work after the second apply (five disposition hits are excluded and eight unrelated candidates remain)", cand2);

// the Rollback line puts the moved rows back
const rb = sql.split("\n").filter((l) => /^-- Rollback:|^--\s{8,}\S/.test(l)).join("\n");
ok(/INSERT OR IGNORE INTO false_stop_hits/.test(rb) && /UPDATE doctrine_proposals SET status = 'proposed'/.test(rb) && /DROP VIEW IF EXISTS v_agent_replies/.test(rb), "the Rollback header names each undo");
d.exec("INSERT OR IGNORE INTO false_stop_hits (id, ts, source, reply_id, reply_ts, pattern_key, phrase, excerpt) SELECT id, ts, source, reply_id, reply_ts, pattern_key, phrase, excerpt FROM false_stop_hits_reclassified WHERE migration = 'FALSE-STOP-REPLY-SCOPE-1'");
ok(d.prepare("SELECT id FROM false_stop_hits ORDER BY id").all().map((r) => r.id).join() === "25,27,35,37,39,40,41",
  "the earlier rollback restores its six reclassified hits without restoring the disposition hits");

// the header declares what the runner needs
ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- BACKUP: false_stop_hits_reclassified$/m.test(sql) && /^-- Rollback: /m.test(sql), "the header carries APPLY-BY, DB, BACKUP and Rollback");
ok(!/\bclaude\.ai\b/i.test(sql), "no claude.ai link");
ok(/^-- APPLY-BY: ci$/m.test(dispositionSql) && /^-- DB: qnfo-audit$/m.test(dispositionSql) &&
  /^-- BACKUP: false_stop_hits_dispositioned$/m.test(dispositionSql) && /^-- Rollback: /m.test(dispositionSql),
  "the disposition migration declares its runner, database, backup and rollback");

console.log((fail ? "FAIL " : "ok ") + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
