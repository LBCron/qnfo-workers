// PAPER-LEARN-TRIAGE-1 offline suite (qnfo-lifecycle 1.14.0). Drives the triage step of the real default export against an in-memory qnfo-audit
// (node:sqlite behind a D1 shim) and a scripted Workers AI. Proves: a learning that matches a catalogue mechanism whose probe reads ok is settled
// already-in-place with the citation and no model call; a match whose probe fails is not (it goes to the model path); a reject needs both model
// families, a single reject or an unreadable answer settles nothing; a conflict must name a catalogue mechanism whose probe is ok; an uncovered
// learning becomes a probationary goal and is not triaged again; the model budget per tick holds; issue-bound learnings go first; a probe that is
// not a single SELECT never runs; paper_learn_triage = off stops it; the reader strips the pipeline's own notices.
// Run: node --no-warnings qnfo-lifecycle/paper-learn-triage.test.mjs
import { DatabaseSync } from "node:sqlite";

const W = (await import("./worker.js")).default;
const P = W.__paperLearn;
let passed = 0, failed = 0;
const ok = (c, l, x) => { if (c) passed++; else { failed++; console.error("FAIL " + l + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 400) : "")); } };
function d1(db) {
  const stmt = (sql, args) => ({
    bind: (...a) => stmt(sql, a),
    async run() { const r = db.prepare(sql).run(...(args || [])); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
    async all() { return { results: db.prepare(sql).all(...(args || [])) }; },
    async first() { return db.prepare(sql).get(...(args || [])) || null; },
  });
  return { prepare: (sql) => stmt(sql, []), async batch(list) { const out = []; for (const s of list) out.push(await s.run()); return out; } };
}

ok(P && typeof P.triage === "function" && typeof P.stripNotices === "function", "the triage is exposed on the default export");

// The reader does not learn the pipeline's own notices.
const md = "# T\n\n> **Correction (version 1.0.1, 2026-10-19):** statements ... none took place.\n> See the Correction Notice.\n\nThe body claim stays.\n\n## Correction Notice\n\nVersion 1.0.1 corrects x.\n\n## Method\n\nMethod text.\n\n## Version History\n\n- Version 1.0.1 (2026-10-19)\n\n## Provenance and AI Involvement\n\n- drafted by the pipeline\n\n## References\n\n[1] A.\n";
const stripped = P.stripNotices(md);
ok(!/Correction/.test(stripped) && !/Version History/.test(stripped) && !/Provenance/.test(stripped) && !/none took place/.test(stripped), "notices are stripped", stripped);
ok(/The body claim stays\./.test(stripped) && /## Method\n\nMethod text\./.test(stripped) && /## References\n\n\[1\] A\./.test(stripped), "the paper text and its other sections stay", stripped);
ok(P.stripNotices("# T\n\nBody.\n") === "# T\n\nBody.\n", "a paper without notices is unchanged");

const audit = new DatabaseSync(":memory:");
audit.exec(`CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT, updated_at TEXT);
CREATE TABLE cloud_ops_events (id TEXT, ts TEXT, kind TEXT, text TEXT, job TEXT, status TEXT);
CREATE TABLE paper_learnings (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT, version TEXT, claim TEXT, kind TEXT, verification TEXT DEFAULT 'derived-unchecked', fleet_lever TEXT, application TEXT, applicability TEXT DEFAULT 'direct', fleet_status TEXT DEFAULT 'proposed', status_note TEXT, issue_id INTEGER, updated_at TEXT);
CREATE TABLE goals (id INTEGER PRIMARY KEY AUTOINCREMENT, goal_key TEXT UNIQUE NOT NULL, statement TEXT NOT NULL, goal_type TEXT NOT NULL DEFAULT 'instrumental', parent_objective TEXT, alignment TEXT, source TEXT, priority INTEGER DEFAULT 0, status TEXT NOT NULL DEFAULT 'adopted', dod TEXT, owner TEXT);
CREATE TABLE paper_learning_mechanisms (mech_key TEXT PRIMARY KEY, title TEXT, terms TEXT, citation TEXT, evidence_probe TEXT, status TEXT DEFAULT 'active');
INSERT INTO paper_learning_mechanisms (mech_key, title, terms, citation, evidence_probe) VALUES
 ('claim-integrity', 'past-tense claims are held', 'claim-integrity|none took place', 'CLAIM-INTEGRITY-1 in qnfo-research-exec', 'SELECT CASE WHEN EXISTS (SELECT 1 FROM cloud_ops_events WHERE kind = ''claim-integrity'') THEN ''ok'' ELSE ''absent'' END AS observed'),
 ('priority-queue', 'issues drain by priority then oldest', '', 'PRIORITY-QUEUE-1 owner directive', 'SELECT ''ok'' AS observed'),
 ('broken-probe', 'a mechanism whose probe writes', 'broken term', 'x', 'UPDATE ops_config SET value = ''hacked'' WHERE key = ''k'''),
 ('two-statements', 'a probe with two statements', 'two stmt term', 'x', 'SELECT ''ok'' AS observed; DELETE FROM ops_config');
INSERT INTO ops_config (key, value) VALUES ('k', 'v');
INSERT INTO cloud_ops_events (id, ts, kind, text, job, status) VALUES ('e1', strftime('%Y-%m-%dT%H:%M:%SZ','now'), 'claim-integrity', 'x', 'qnfo-research-exec', 'ok');`);
const add = (o) => audit.prepare("INSERT INTO paper_learnings (slug, version, claim, kind, fleet_lever, application, applicability, fleet_status, issue_id) VALUES (?, '1.0', ?, ?, ?, ?, ?, ?, ?)").run(o.slug || "p", o.claim, o.kind || "derived", o.lever || "", o.app || "", o.applic || "direct", o.st || "proposed", o.issue || null);
const get = (id) => audit.prepare("SELECT * FROM paper_learnings WHERE id = ?").get(id);

const calls = [];
let script = () => ({ disposition: "apply", category: "gap", mechanism: "", reason: "" });
const AI = { async run(model, opts) { const prompt = opts.messages[0].content; calls.push({ model, prompt }); const r = script(model, prompt); if (r === "throw") throw new Error("3040 capacity"); if (r === "garbage") return { response: "no json" }; return { response: JSON.stringify(r) }; } };
const env = { QNFO_AUDIT: d1(audit), AI };

// 1. lexical match + a probe that reads ok: in place, no model call, citation in the note
add({ claim: "The pipeline detected and corrected automatically (CLAIM-INTEGRITY-1) a claim that none took place", lever: "review rule", issue: 7 });
let r = await P.triage(env);
ok(r.in_place === 1 && calls.length === 0, "a probe-verified match settles without a model call", { r, calls: calls.length });
ok(get(1).fleet_status === "already-in-place" && /^PL-TRIAGE-1 in place \(.*\): claim-integrity - CLAIM-INTEGRITY-1 in qnfo-research-exec \(evidence probe ok\)/.test(get(1).status_note), "the note cites the mechanism and the probe", get(1));

// 2. the mechanism's probe fails: not settled by the catalogue
audit.exec("DELETE FROM cloud_ops_events");
add({ claim: "Claim-integrity again", lever: "x", issue: 7 });
calls.length = 0;
script = () => ({ disposition: "apply", category: "gap", mechanism: "", reason: "the fleet has no such check at all today, so one should be added" });
r = await P.triage(env);
const goal2 = audit.prepare("SELECT * FROM goals WHERE goal_key = 'PAPER-LEARN-2'").get();
ok(get(2).fleet_status === "probation" && calls.length === 2, "a match whose probe is not ok goes to the model path", { st: get(2).fleet_status, calls: calls.length });
ok(r.apply === 1 && r.goals === 1 && /^PL-TRIAGE-1 probation: goal PAPER-LEARN-2/.test(get(2).status_note) && /no such check/.test(get(2).status_note), "an uncovered learning is transferred to a probationary goal with its reason", get(2));
ok(goal2 && goal2.status === "adopted" && goal2.owner === "qnfo-code-orchestrator" && /fleet_status NOT IN \('applied', 'rejected', 'routed', 'already-in-place'\)/.test(goal2.dod), "the goal has an owner and a machine-checkable completion condition", goal2);
ok(audit.prepare(goal2.dod).get().observed === "1", "the goal remains open while the learning is on probation");
calls.length = 0;
r = await P.triage(env);
ok(calls.length === 0 && r.examined === 0, "a learning transferred to a goal is not triaged again", r);
ok(audit.prepare("SELECT COUNT(*) AS n FROM goals WHERE goal_key = 'PAPER-LEARN-2'").get().n === 1, "the probationary goal is created only once");
audit.prepare("UPDATE paper_learnings SET fleet_status = 'applied' WHERE id = 2").run();
ok(audit.prepare(goal2.dod).get().observed === "0", "the goal completion probe passes once the learning is applied");
audit.prepare("INSERT INTO cloud_ops_events (id, ts, kind, text, job, status) VALUES ('e2', strftime('%Y-%m-%dT%H:%M:%SZ','now'), 'claim-integrity', 'x', 'qnfo-research-exec', 'ok')").run();

// 3. a reject needs both families
add({ claim: "The paper marks its own claims with inline tags", lever: "review rule" });
calls.length = 0;
script = () => ({ disposition: "reject", category: "paper-convention", mechanism: "", reason: "this is the paper's own authoring convention, not a fleet defect" });
r = await P.triage(env);
ok(get(3).fleet_status === "rejected" && /^PL-TRIAGE-1 rejected \(paper-convention; two model families agree/.test(get(3).status_note) && calls.length === 2 && calls[0].model !== calls[1].model, "two families agreeing on reject settles it", { n: get(3), models: calls.map((c) => c.model) });
add({ claim: "A claim only one family will reject", lever: "x" });
calls.length = 0;
script = (model) => /glm/.test(model) ? { disposition: "reject", category: "analogy-only", mechanism: "", reason: "a metaphor with no operational counterpart in the fleet" } : { disposition: "apply", category: "gap", mechanism: "", reason: "the fleet could adopt this practice for its own loops" };
r = await P.triage(env);
ok(get(4).fleet_status === "probation" && /^PL-TRIAGE-1 probation: goal PAPER-LEARN-4/.test(get(4).status_note), "a single reject does not reject the learning; the apply signal becomes a goal", get(4));
add({ claim: "A claim the second family cannot read", lever: "x" });
script = (model) => /glm/.test(model) ? { disposition: "reject", category: "analogy-only", mechanism: "", reason: "a metaphor with no operational counterpart in the fleet" } : "garbage";
r = await P.triage(env);
ok(get(5).fleet_status === "proposed" && get(5).status_note === null && r.kept === 1, "an unreadable second answer settles nothing and is retried next tick", { st: get(5), r });
add({ claim: "A claim with a thin reason", lever: "x" });
script = () => ({ disposition: "reject", category: "paper-convention", mechanism: "", reason: "no" });
await P.triage(env, { examine: 1 });
audit.exec("UPDATE paper_learnings SET fleet_status = 'proposed', status_note = NULL WHERE id = 5");

// 4. a conflict must name a catalogue mechanism with a passing probe
audit.exec("UPDATE paper_learnings SET fleet_status = 'n/a' WHERE id IN (4, 5, 6)");
add({ claim: "Rank issues by cost to verify", lever: "drain order", issue: 9 });
const id7 = audit.prepare("SELECT MAX(id) AS id FROM paper_learnings").get().id;
script = () => ({ disposition: "reject", category: "conflicts", mechanism: "priority-queue", reason: "the owner fixed the drain order by priority then age, so another key conflicts" });
r = await P.triage(env);
ok(get(id7).fleet_status === "rejected" && /Conflicts with priority-queue: PRIORITY-QUEUE-1 owner directive \(probe ok\)/.test(get(id7).status_note), "a conflict names a live catalogue mechanism", get(id7));
add({ claim: "Another ranking claim", lever: "drain order" });
const id8 = audit.prepare("SELECT MAX(id) AS id FROM paper_learnings").get().id;
script = () => ({ disposition: "reject", category: "conflicts", mechanism: "no-such-mechanism", reason: "this conflicts with a rule that i made up for the purpose of the test" });
await P.triage(env);
ok(get(id8).fleet_status === "proposed", "a conflict with an unknown mechanism is not accepted", get(id8));
audit.exec("UPDATE paper_learnings SET fleet_status = 'n/a' WHERE id = " + id8);
add({ claim: "Yet another ranking claim", lever: "drain order" });
const id9 = audit.prepare("SELECT MAX(id) AS id FROM paper_learnings").get().id;
script = (model) => ({ disposition: "reject", category: /glm/.test(model) ? "conflicts" : "analogy-only", mechanism: "priority-queue", reason: "the two families disagree about the category of this learning" });
await P.triage(env);
ok(get(id9).fleet_status === "proposed", "families that disagree on the category settle nothing", get(id9));
audit.exec("UPDATE paper_learnings SET fleet_status = 'n/a' WHERE id = " + id9);

// 5. probes that are not one SELECT never run
add({ claim: "A broken term here", lever: "x" });
const id10 = audit.prepare("SELECT MAX(id) AS id FROM paper_learnings").get().id;
add({ claim: "A two stmt term here", lever: "x" });
const id11 = audit.prepare("SELECT MAX(id) AS id FROM paper_learnings").get().id;
calls.length = 0;
script = () => ({ disposition: "apply", category: "gap", mechanism: "", reason: "nothing in the fleet covers this at the moment" });
await P.triage(env, { modelMax: 0 });
ok(audit.prepare("SELECT value FROM ops_config WHERE key = 'k'").get().value === "v" && audit.prepare("SELECT COUNT(*) AS n FROM ops_config").get().n === 1, "a write probe and a two-statement probe never ran");
ok(get(id10).fleet_status === "proposed" && get(id11).fleet_status === "proposed" && calls.length === 0, "and their learnings are not settled (modelMax 0 holds the model path)");
audit.exec("UPDATE paper_learnings SET fleet_status = 'n/a' WHERE id IN (" + id10 + "," + id11 + ")");

// 6. the per-tick model budget, issue-bound rows first
for (let i = 0; i < 7; i++) add({ claim: "Unmatched claim number " + i, lever: "x", issue: i === 6 ? 11 : null });
const first = audit.prepare("SELECT MIN(id) AS id FROM paper_learnings WHERE fleet_status = 'proposed' AND claim LIKE 'Unmatched%'").get().id;
const issueBound = audit.prepare("SELECT id FROM paper_learnings WHERE claim = 'Unmatched claim number 6'").get().id;
calls.length = 0;
script = () => ({ disposition: "apply", category: "gap", mechanism: "", reason: "nothing in the fleet covers this at the moment" });
r = await P.triage(env);
ok(calls.length === 8 && r.apply === 4 && r.goals === 4 && r.kept >= 3, "four learnings reach the model per tick (two calls each) and unresolved gaps become goals", { calls: calls.length, r });
ok(get(issueBound).fleet_status === "probation" && /^PL-TRIAGE-1 probation: goal PAPER-LEARN-/.test(get(issueBound).status_note || "") && get(audit.prepare("SELECT id FROM paper_learnings WHERE claim = 'Unmatched claim number 5'").get().id).status_note === null, "the issue-bound learning is examined before the unbound ones, and the budget stops after four", { bound: get(issueBound).status_note });

// 6b. PAPER-LEARN-RETRIAGE-1: the covered answer, the four settled states in the goal DoD, and the probation re-triage
audit.exec("UPDATE paper_learnings SET fleet_status = 'n/a' WHERE fleet_status IN ('proposed', 'probation')");
audit.exec("INSERT INTO paper_learning_mechanisms (mech_key, title, terms, citation, evidence_probe) VALUES ('cov-mech', 'a mechanism the fleet really runs', '', 'COV-1 in qnfo-fleet-control', 'SELECT ''ok'' AS observed'), ('dead-mech', 'a mechanism whose probe fails', '', 'DEAD-1', 'SELECT ''absent'' AS observed'), ('term-mech', 'a mechanism matched by a term', 'zebra-stripes', 'TERM-1 in qnfo-ops', 'SELECT ''ok'' AS observed')");
const covered = (mech) => () => ({ disposition: "covered", category: "covered", mechanism: mech, reason: "the fleet already runs this: it is exactly what the listed mechanism does today" });
add({ claim: "Covered claim both families", lever: "x" });
const idc1 = audit.prepare("SELECT MAX(id) AS id FROM paper_learnings").get().id;
script = covered("cov-mech");
r = await P.triage(env, { retriageModelMax: 0 });
ok(get(idc1).fleet_status === "already-in-place" && /^PL-TRIAGE-1 in place \(two model families agree, .*\): cov-mech - COV-1 in qnfo-fleet-control \(evidence probe ok\)/.test(get(idc1).status_note), "two families answering covered with the same live mechanism settle it in place", get(idc1));
add({ claim: "Covered by one family only", lever: "x" });
const idc2 = audit.prepare("SELECT MAX(id) AS id FROM paper_learnings").get().id;
script = (model) => /glm/.test(model) ? covered("cov-mech")() : { disposition: "apply", category: "gap", mechanism: "", reason: "nothing in the fleet covers this at the moment, so it should be built" };
await P.triage(env, { retriageModelMax: 0 });
ok(get(idc2).fleet_status === "probation", "covered by one family and apply by the other is not settled in place", get(idc2));
add({ claim: "Covered with a dead probe", lever: "x" });
const idc3 = audit.prepare("SELECT MAX(id) AS id FROM paper_learnings").get().id;
script = covered("dead-mech");
await P.triage(env, { retriageModelMax: 0 });
ok(get(idc3).fleet_status === "proposed", "a covered answer whose mechanism probe is not ok settles nothing", get(idc3));
add({ claim: "Covered with an invented mechanism", lever: "x" });
const idc4 = audit.prepare("SELECT MAX(id) AS id FROM paper_learnings").get().id;
script = covered("no-such-mech");
await P.triage(env, { retriageModelMax: 0 });
ok(get(idc4).fleet_status === "proposed", "a covered answer naming an unknown mechanism settles nothing", get(idc4));
audit.exec("UPDATE paper_learnings SET fleet_status = 'n/a' WHERE id IN (" + idc3 + "," + idc4 + ")");
ok(/covered\|reject\|apply/.test(calls[calls.length - 1].prompt) && /- cov-mech: a mechanism the fleet really runs/.test(calls[calls.length - 1].prompt), "the prompt offers the covered answer and lists the catalogue");

// the goal DoD counts the four settled states
const gdod = audit.prepare("SELECT dod FROM goals WHERE goal_key = 'PAPER-LEARN-" + idc2 + "'").get().dod;
ok(audit.prepare(gdod).get().observed === "1", "the new goal is unsettled while the learning is on probation");
for (const st of ["routed", "already-in-place", "rejected", "applied"]) { audit.prepare("UPDATE paper_learnings SET fleet_status = ? WHERE id = ?").run(st, idc2); ok(audit.prepare(gdod).get().observed === "0", "the goal DoD reads settled for " + st); }
audit.prepare("UPDATE paper_learnings SET fleet_status = 'probation', status_note = 'PL-TRIAGE-1 probation: goal PAPER-LEARN-" + idc2 + " (x): initial signal' WHERE id = ?").run(idc2);

// re-triage: a probation row older than the gap is read again by both families
const OLD = "2026-01-01T00:00:00.000Z";
const retriageRow = (claim, note) => { add({ claim, lever: "x", st: "probation" }); const id = audit.prepare("SELECT MAX(id) AS id FROM paper_learnings").get().id; audit.prepare("UPDATE paper_learnings SET status_note = ?, updated_at = ? WHERE id = ?").run(note || "PL-TRIAGE-1 probation: goal PAPER-LEARN-" + id + " (x): initial signal", OLD, id); return id; };
audit.exec("UPDATE paper_learnings SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = " + idc2);
const idr1 = retriageRow("Probation row both families now reject");
calls.length = 0;
script = () => ({ disposition: "reject", category: "paper-convention", mechanism: "", reason: "this is the paper's own authoring convention, not a fleet defect" });
r = await P.triage(env);
ok(get(idr1).fleet_status === "rejected" && /^PL-TRIAGE-1 rejected \(paper-convention; two model families agree/.test(get(idr1).status_note) && r.retriaged === 1 && r.rejected >= 1 && calls.length === 2, "a probation learning both families now reject is settled by the re-triage", { st: get(idr1), r, calls: calls.length });
ok(get(idc2).fleet_status === "probation", "a probation row inside the gap is not read again");
const idr2 = retriageRow("Probation row covered by a live mechanism");
script = covered("cov-mech");
await P.triage(env);
ok(get(idr2).fleet_status === "already-in-place", "a probation learning both families now see as covered is settled in place", get(idr2));
const idr3 = retriageRow("Probation row with a term zebra-stripes in it");
calls.length = 0;
r = await P.triage(env);
ok(get(idr3).fleet_status === "already-in-place" && /term-mech - TERM-1 in qnfo-ops/.test(get(idr3).status_note) && calls.length === 0, "a lexical match with a live probe settles a probation row without a model call", { st: get(idr3), calls: calls.length });
// apply again: counted, then lapsed on the third pass
const idr4 = retriageRow("Probation row nobody takes");
script = () => ({ disposition: "apply", category: "gap", mechanism: "", reason: "nothing in the fleet covers this and it should be added by someone" });
await P.triage(env);
ok(get(idr4).fleet_status === "probation" && / \| PL-RETRIAGE 1 \(/.test(get(idr4).status_note) && /^PL-TRIAGE-1 probation: goal/.test(get(idr4).status_note), "an apply again keeps probation and counts the pass", get(idr4));
audit.prepare("UPDATE paper_learnings SET updated_at = ? WHERE id = ?").run(OLD, idr4);
await P.triage(env);
ok(/ \| PL-RETRIAGE 2 \(/.test(get(idr4).status_note) && !/PL-RETRIAGE 1/.test(get(idr4).status_note), "the second pass replaces the counter", get(idr4).status_note);
audit.prepare("UPDATE paper_learnings SET updated_at = ? WHERE id = ?").run(OLD, idr4);
r = await P.triage(env);
ok(get(idr4).fleet_status === "rejected" && /^PL-TRIAGE-2 rejected \(lapsed; 3 triage passes by two model families/.test(get(idr4).status_note) && /Re-propose with a measured fleet gap\.$/.test(get(idr4).status_note) && r.lapsed === 1, "the third apply lapses the learning as rejected with the reason", { st: get(idr4), r });
ok(get(idr4).status_note.length <= 700, "the lapse note is bounded");
// no agreement: no pass counted, the row waits its gap again
const idr5 = retriageRow("Probation row with an unreadable answer");
script = () => "garbage";
await P.triage(env);
ok(get(idr5).fleet_status === "probation" && !/PL-RETRIAGE/.test(get(idr5).status_note) && get(idr5).updated_at > OLD, "an unreadable answer counts no pass and moves the row to the back", get(idr5));
// budget and flag
const idr6 = retriageRow("Probation row while the budget is zero");
calls.length = 0;
script = () => ({ disposition: "reject", category: "paper-convention", mechanism: "", reason: "this is the paper's own authoring convention, not a fleet defect" });
await P.triage(env, { retriageModelMax: 0 });
ok(get(idr6).fleet_status === "probation" && calls.length === 0, "retriageModelMax 0 holds the model path of the re-triage");
audit.prepare("INSERT INTO ops_config (key, value) VALUES ('paper_learn_retriage', 'off')").run();
r = await P.triage(env);
ok(r.retriage_skipped === true && get(idr6).fleet_status === "probation" && calls.length === 0, "paper_learn_retriage = off stops the re-triage and not the triage", r);
audit.exec("DELETE FROM ops_config WHERE key = 'paper_learn_retriage'");
await P.triage(env);
ok(get(idr6).fleet_status === "rejected", "and removing the flag restarts it");
audit.exec("UPDATE paper_learnings SET fleet_status = 'n/a' WHERE fleet_status IN ('proposed', 'probation')");
audit.exec("DELETE FROM paper_learning_mechanisms WHERE mech_key IN ('cov-mech', 'dead-mech', 'term-mech')");

// 7. the flag
audit.exec("UPDATE paper_learnings SET status_note = NULL WHERE fleet_status = 'proposed'");
audit.prepare("INSERT INTO ops_config (key, value) VALUES ('paper_learn_triage', 'off')").run();
calls.length = 0;
r = await P.triage(env);
ok(r.skipped === true && calls.length === 0 && r.examined === 0, "paper_learn_triage = off stops it");
audit.exec("DELETE FROM ops_config WHERE key = 'paper_learn_triage'; DROP TABLE paper_learning_mechanisms");
r = await P.triage(env);
ok(r.error !== undefined && r.in_place === 0, "a missing catalogue is reported, never thrown", r);

console.log(passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
