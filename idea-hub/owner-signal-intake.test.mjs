// OWNER-SIGNAL-INTAKE-1 (1.7.0, #1947 #2103 #2104) offline suite. Runs the worker's own triageProposals, runOwnerCorpus,
// runReentry and thinkSeed in a vm against in-memory SQLite D1s, a scripted Workers AI stub and an in-memory R2 vault.
// Proves: an owner-authored idea is ACCEPTed and queued even when the model says HOLD; an owner's short chat question is
// still held; an ask-gap question is scored instead of filtered; a notebook idea passes at OWNER_CORPUS_SCORE_MIN and
// fails below it; the corpus feeder turns a research note into one owner-corpus proposal, records short, missing and
// no-idea notes, never reads a note twice, and pauses when research_queue is full; re-entry reads only the owner's own
// papers; the think loop is seeded from the owner's accepted ideas.
// Run: node idea-hub/owner-signal-intake.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { DatabaseSync } from "node:sqlite";
import { stripWorkerDefaultExport } from "../scripts/worker-source-test.mjs";
const here = dirname(fileURLToPath(import.meta.url));
const src = stripWorkerDefaultExport(readFileSync(join(here, "worker.js"), "utf8")).replace(/export default\s*\{/, "var __default = {");
const sb = { console: { log() {}, error() {} }, Date, JSON, Math, Number, String, RegExp, Set, Map, Array, Object, Promise, URL, Response, Request, Headers, TextEncoder, crypto, fetch: async () => { throw new Error("no network"); } };
vm.createContext(sb);
vm.runInContext(src + "\n__x = { ownerPipelineDois, triageProposals, runOwnerCorpus, runReentry, runConsume, thinkSeed, proposalKind, realQuestion, ownerPaper, aiRunAttr, promptCacheOpts, OWNER_CORPUS_SCORE_MIN, OWNER_CORPUS_RQ_CAP, OWNER_CORPUS_BATCH, REASONING_MAX_TOKENS, OWNER_CORPUS_FLEET_ERA };", sb);
const api = sb.__x;
const mk = () => new DatabaseSync(":memory:");
const shim = (db) => ({ prepare(sql) { let a = []; const q = sql.replace(/\?(\d+)/g, "?"); const st = { bind(...x) { a = x; return st; }, async all() { return { results: db.prepare(q).all(...a) }; }, async first() { return db.prepare(q).get(...a) ?? null; }, async run() { const r = db.prepare(q).run(...a); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; } }; return st; } });
const db = mk();
db.exec(`CREATE TABLE idea_proposals (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, idea TEXT NOT NULL, contact TEXT, status TEXT DEFAULT 'new', ip_hash TEXT, created_at TEXT, decision TEXT, score REAL, rationale TEXT, triaged_at TEXT);
CREATE TABLE fleet_budget (node_class TEXT PRIMARY KEY, cap REAL, target REAL, current REAL, unit TEXT, updated_at TEXT);
CREATE TABLE cloud_ops_events (id TEXT PRIMARY KEY, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT);
CREATE TABLE fleet_heartbeat (worker TEXT PRIMARY KEY, version TEXT, ts TEXT, ok INTEGER);
CREATE TABLE research_queue (id TEXT PRIMARY KEY, source TEXT, source_id TEXT, idea TEXT, summary TEXT, score REAL, decision TEXT, status TEXT, created_at TEXT, UNIQUE(source, source_id));
CREATE TABLE signals (id TEXT PRIMARY KEY, ts TEXT, source TEXT, source_ref TEXT, content TEXT, open_questions TEXT, evidential_weight REAL, domain TEXT, status TEXT, decision TEXT, created_at TEXT);
CREATE TABLE signal_worker_boundary (worker TEXT, source TEXT, permitted INTEGER);
CREATE TABLE notes_intake (path TEXT PRIMARY KEY, type TEXT, title TEXT, status TEXT, sig TEXT);
CREATE TABLE ai_call_counters (day TEXT, worker TEXT, purpose TEXT, model TEXT, calls INTEGER DEFAULT 0, errors INTEGER DEFAULT 0, in_chars INTEGER DEFAULT 0, ms INTEGER DEFAULT 0, in_tok INTEGER DEFAULT 0, out_tok INTEGER DEFAULT 0, neurons REAL DEFAULT 0, PRIMARY KEY (day, worker, purpose, model));
CREATE TABLE ai_cache_counters (day TEXT, worker TEXT, model TEXT, calls INTEGER DEFAULT 0, cached_calls INTEGER DEFAULT 0, in_tok INTEGER DEFAULT 0, cached_tok INTEGER DEFAULT 0, PRIMARY KEY (day, worker, model));`);
// Scripted model: a scorecard whose merit depends on a marker in the idea; an extraction reply for notebook prompts.
const card = (m) => JSON.stringify({ novelty: m, technical_merit: m, impact_potential: m, exposure_potential: m, feasibility: 0.9, risk: 0.1, rationale: "r" + m, hook: "h" });
const calls = [];
const seenMax = [], seenAff = [];
const AI = { async run(model, input, opts) {
  const p = String(input.messages[0].content);
  seenMax.push(input.max_tokens); seenAff.push(opts && opts.extraHeaders && opts.extraHeaders["x-session-affinity"] || null);
  calls.push(p.startsWith("You read one note") ? "corpus" : "score");
  if (p.startsWith("You read one note")) {
    if (/NO-IDEA-HERE/.test(p)) return { response: '{"none":"shopping list"}' };
    return { response: '{"title":"Distinction lattices bound measurement records","idea":"The author argues that a distinction lattice over measurement outcomes gives an ultrametric on records, and that its depth bounds the information an observer can extract. A formal analysis can derive the bound and test it on finite lattices by computation."}' };
  }
  const m = /MERIT_LOW/.test(p) ? 0.3 : /MERIT_MID/.test(p) ? 0.6 : 0.9;
  return { response: card(m) };
} };
const vault = new Map();
const VAULT = { async get(k) { return vault.has(k) ? { async text() { return vault.get(k); } } : null; } };
const env = { QNFO_AUDIT: shim(db), AI, VAULT };
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d))); } };
const add = (name, idea, contact = "") => Number(db.prepare("INSERT INTO idea_proposals (name, idea, contact, status, created_at) VALUES (?, ?, ?, 'new', datetime('now'))").run(name, idea, contact).lastInsertRowid);
const row = (id) => db.prepare("SELECT * FROM idea_proposals WHERE id = ?").get(id);
const queued = (id) => !!db.prepare("SELECT 1 FROM research_queue WHERE source_id = ?").get(String(id));

// 1. Kinds.
ok(api.proposalKind({ name: "owner-chat", contact: "owner" }) === "direct" && api.proposalKind({ name: "chat-session", contact: "rowan-chat-2026-10-01" }) === "direct" && api.proposalKind({ name: "rowan-chat", contact: "chat" }) === "direct", "owner-chat, chat-session and rowan-* rows are owner-direct");
ok(api.proposalKind({ name: "owner-corpus", contact: "owner" }) === "corpus" && api.proposalKind({ name: "intake:arxiv-complexity", contact: "owner" }) === "generated" && api.proposalKind({ name: "auto-scan" }) === "generated", "owner-corpus is corpus; radar intake and arXiv scan are generated");

// 2. Triage routing.
const own = add("owner-chat", "MERIT_LOW Revision target: the two-index anyon condensation framework undercounts D_C^2 in Ising x Ising-bar; correct and extend with module categories.", "owner");
const chatQ = add("chat-session", "What is a qubit?", "rowan-chat-2026-10-01");
const gap = add("ask-gap", "What are implications for consciousness and distinction/partition calculus/theory?");
const corpHi = add("owner-corpus", "MERIT_MID Distinction lattices bound measurement records. Source: owner notebook notes/v1/x.md", "owner");
const corpLo = add("owner-corpus", "MERIT_LOW A vague thought about everything. Source: owner notebook notes/v1/y.md", "owner");
let out = await api.triageProposals(env);
ok(row(own).status === "triaged_accepted" && row(own).decision === "ACCEPT" && queued(own), "an owner idea the model scores low is still ACCEPTed and queued for research", row(own));
ok(/owner-authored/.test(row(own).rationale) && row(own).score !== null, "the owner row keeps its score and says why it was accepted");
ok(row(chatQ).status === "triaged_hold" && row(chatQ).rationale === "noise/question filter", "an owner's short chat question is still held by the question filter");
ok(row(gap).rationale !== "noise/question filter" && row(gap).score !== null, "an Ask QWAV gap is scored, not dropped by the question filter", row(gap));
ok(row(corpHi).status === "triaged_accepted" && queued(corpHi), "a notebook idea at the corpus bar (" + api.OWNER_CORPUS_SCORE_MIN + ") is ACCEPTed and queued", row(corpHi));
// HOLD-RELEASE-OWNER-BAR-1 (#2173, owner directive 2026-10-08: remove holds): the corpus bar is 0, so a notebook idea the
// model scores low is accepted too; the score is kept for ordering, never used to hold the owner's own idea.
ok(api.OWNER_CORPUS_SCORE_MIN === 0, "the owner-corpus bar is 0 (no hold on the owner's notebook)");
ok(row(corpLo).status === "triaged_accepted" && queued(corpLo), "a notebook idea the model scores low is ACCEPTed and queued", row(corpLo));
ok(out.owner_accepted === 3, "the run counts owner accepts", out);

// 3. Corpus feeder.
db.exec("DELETE FROM research_queue");
const longNote = "Some reflections.\n\n" + "A distinction lattice over measurement outcomes induces an ultrametric on the record space. ".repeat(12);
db.prepare("INSERT INTO notes_intake (path, type, title, status, sig) VALUES (?,?,?,?,?)").run("notes/v1/2025/10/28/a.md", "note", "a", "active", "s1");
db.prepare("INSERT INTO notes_intake (path, type, title, status, sig) VALUES (?,?,?,?,?)").run("notes/v1/2025/10/27/b.md", "note", "b", "active", "s2");
db.prepare("INSERT INTO notes_intake (path, type, title, status, sig) VALUES (?,?,?,?,?)").run("notes/v1/2025/10/26/c.md", "note", "c", "active", "s3");
db.prepare("INSERT INTO notes_intake (path, type, title, status, sig) VALUES (?,?,?,?,?)").run("notes/v1/2025/10/25/d.md", "note", "d", "active", "s4");
db.prepare("INSERT INTO notes_intake (path, type, title, status, sig) VALUES (?,?,?,?,?)").run("notes/v1/2025/10/29/daily.md", "daily", "daily", "active", "s5");
vault.set("notes/v1/2025/10/28/a.md", "---\ntags: x\n---\n" + longNote);
vault.set("notes/v1/2025/10/27/b.md", "too short");
vault.set("notes/v1/2025/10/26/c.md", "NO-IDEA-HERE " + "milk eggs bread ".repeat(60));
const before = db.prepare("SELECT COUNT(*) n FROM idea_proposals").get().n;
calls.length = 0;
let c1 = await api.runOwnerCorpus(env);
// Batch-size agnostic (2026-10-08): #2125 raised OWNER_CORPUS_BATCH to read more of the owner's notes per run; the
// invariants are the batch bound, newest first, and every eligible note read exactly once, not a batch of exactly 2.
const B = api.OWNER_CORPUS_BATCH;
ok(B >= 2 && c1.picked === Math.min(B, 4), "one run reads at most OWNER_CORPUS_BATCH notes, newest path first", c1);
ok(c1.proposed === 1 && c1.short === 1, "the research note becomes a proposal; the short note is recorded as short", c1);
const p = db.prepare("SELECT * FROM idea_proposals WHERE name = 'owner-corpus' AND idea LIKE '%notes/v1/2025/10/28/a.md%'").get();
ok(p && p.contact === "owner" && p.status === "new" && /^corpus:[0-9a-f]{16}$/.test(p.ip_hash) && /^Distinction lattices bound measurement records\. /.test(p.idea), "the proposal is owner-corpus, contact owner, status new, tagged by path hash, titled", p);
ok(db.prepare("SELECT COUNT(*) n FROM idea_proposals").get().n === before + 1, "exactly one proposal was written");
let c2 = await api.runOwnerCorpus(env);
ok((c1.none + c2.none) === 1 && (c1.missing + c2.missing) === 1 && c2.proposed === 0 && c1.picked + c2.picked === 4, "across runs: no idea in one note, missing body in another, each read once", [c1, c2]);
const seen = Object.fromEntries(db.prepare("SELECT path, outcome FROM owner_corpus_seen").all().map((r) => [r.path, r.outcome]));
ok(seen["notes/v1/2025/10/28/a.md"] === "proposed" && seen["notes/v1/2025/10/27/b.md"] === "short" && seen["notes/v1/2025/10/26/c.md"] === "none" && seen["notes/v1/2025/10/25/d.md"] === "missing" && !("notes/v1/2025/10/29/daily.md" in seen), "every eligible note gets one outcome row; daily notes are not corpus", seen);
let c3 = await api.runOwnerCorpus(env);
ok(c3.picked === 0, "a third run finds nothing left: no note is read twice", c3);
ok(calls.filter((x) => x === "corpus").length === 2, "only notes with a long enough body reach the model (2 calls)", calls);
db.prepare("INSERT INTO notes_intake (path, type, title, status, sig) VALUES (?,?,?,?,?)").run("notes/v1/2025/11/01/e.md", "note", "e", "active", "s6");
for (let i = 0; i < api.OWNER_CORPUS_RQ_CAP; i++) db.prepare("INSERT INTO research_queue (id, source, source_id, status) VALUES (?, 'proposal', ?, 'queued')").run("rq" + i, "x" + i);
let c4 = await api.runOwnerCorpus(env);
ok(c4.picked === 1 && !c4.paused && /research_queue/.test(String(c4.slowed)), "OWNER-CORPUS-RATE-1: a full research_queue slows the feeder to a small batch instead of pausing it", c4);
let c5 = await api.runOwnerCorpus({ QNFO_AUDIT: shim(db), AI });
ok(c5.ok === false && /VAULT/.test(c5.why), "without the VAULT binding the feeder reports it and does nothing", c5);

// 4. Re-entry reads only the owner's own papers.
const lp = mk();
lp.exec("CREATE TABLE papers (doi TEXT, slug TEXT, title TEXT, body_md TEXT, created_at TEXT, status TEXT, identifier_type TEXT)");
const body = "## Open Questions\n- Does the ultrametric bound extend to infinite products of records?\n";
lp.prepare("INSERT INTO papers (doi, title, body_md, created_at, status, identifier_type) VALUES (?,?,?,?,?,?)").run("10.9999/test.1", "Own", body, "2026-10-01", "published", "owner");
lp.prepare("INSERT INTO papers (doi, title, body_md, created_at, status, identifier_type) VALUES (?,?,?,?,?,?)").run("10.48550/arXiv.2610.1", "ArXiv QEC", body, "2026-10-06", "published", "arxiv");
lp.prepare("INSERT INTO papers (doi, title, body_md, created_at, status, identifier_type) VALUES (?,?,?,?,?,?)").run("10.9999/test.2", "Pipeline", body, "2026-10-06", "published", "qnfo");
db.prepare("INSERT INTO signal_worker_boundary (worker, source, permitted) VALUES ('idea-hub', 'artifact_reentry', 0), ('idea-hub', 'artifact_reentry_owner', 1)").run();
const r = await api.runReentry({ QNFO_AUDIT: shim(db), LIVING_PAPER: shim(lp) });
const refs = db.prepare("SELECT source_ref FROM signals WHERE source = 'artifact_reentry'").all().map((x) => x.source_ref);
ok(r.scanned === 1 && refs.length === 1 && refs[0] === "10.9999/test.1", "re-entry scans only owner-authored papers, not arxiv or pipeline rows", { r, refs });

// 5. Think loop seed.
const seed = await api.thinkSeed(env);
ok(/The author's own lines of work/.test(seed) && /Distinction lattices|anyon condensation/.test(seed) && !/quantum foundations, information thermodynamics/.test(seed), "the think loop is seeded from the owner's accepted ideas, not fixed quantum themes", seed.slice(0, 200));
const empty = mk(); empty.exec("CREATE TABLE idea_proposals (id INTEGER PRIMARY KEY, name TEXT, idea TEXT, contact TEXT, decision TEXT)");
ok(!/quantum/i.test(await api.thinkSeed({ QNFO_AUDIT: shim(empty) })), "with no owner ideas on file the seed falls back without fixed topic nouns");

// 6. 1.7.2: reasoning budget, call + cache counters, prompt-cache affinity.
ok(api.REASONING_MAX_TOKENS >= 2000 && seenMax.length > 0 && seenMax.every((m) => m === api.REASONING_MAX_TOKENS), "every scoring and notebook call carries the reasoning budget (>= 2000 tokens), never 600/700", [...new Set(seenMax)]);
ok(db.prepare("SELECT SUM(calls) n FROM ai_call_counters WHERE worker = 'idea-hub'").get().n > 0, "ai_call_counters still records every idea-hub call (cost attribution kept)");
const cc = db.prepare("SELECT SUM(calls) calls, SUM(cached_calls) cached FROM ai_cache_counters WHERE worker = 'idea-hub'").get();
ok(cc.calls > 0 && cc.cached === 0, "ai_cache_counters gets a row per call; cached_calls counts calls, not tokens", cc);
await api.aiRunAttr({ QNFO_AUDIT: shim(db), AI: { async run() { return { response: "{}", usage: { prompt_tokens: 900, prompt_tokens_details: { cached_tokens: 700 } } }; } } }, "idea-hub", "t", "@cf/zai-org/glm-5.3-flash", { messages: [{ role: "user", content: "x" }] });
const cc2 = db.prepare("SELECT SUM(cached_calls) cached, SUM(cached_tok) tok FROM ai_cache_counters WHERE worker = 'idea-hub'").get();
ok(cc2.cached === 1 && cc2.tok === 700, "a call with 700 cached tokens adds one cached call and 700 cached tokens", cc2);
ok(seenAff.some((k) => /^pc-[0-9a-z]+$/.test(String(k))), "long prompts carry a PROMPT-CACHE-1 session-affinity key");
const k1 = api.promptCacheOpts("m", { messages: [{ content: "A".repeat(5000) }] }, null).extraHeaders["x-session-affinity"];
const k2 = api.promptCacheOpts("m", { messages: [{ content: "A".repeat(5000) + " a tail past the first 4 KB" }] }, null).extraHeaders["x-session-affinity"];
ok(k1 === k2 && api.promptCacheOpts("m", { messages: [{ content: "short" }] }, null) === null, "the same model and prompt prefix share a key; prompts under 1 KB get none");

// 7. 1.7.2 notebook: order and retries.
const d2 = mk(); d2.exec("CREATE TABLE idea_proposals (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, idea TEXT NOT NULL, contact TEXT, status TEXT DEFAULT 'new', ip_hash TEXT, created_at TEXT, rationale TEXT); CREATE TABLE research_queue (id TEXT, status TEXT); CREATE TABLE notes_intake (path TEXT PRIMARY KEY, type TEXT, title TEXT, status TEXT, sig TEXT); CREATE TABLE ai_call_counters (day TEXT, worker TEXT, purpose TEXT, model TEXT, calls INTEGER DEFAULT 0, errors INTEGER DEFAULT 0, in_chars INTEGER DEFAULT 0, ms INTEGER DEFAULT 0, in_tok INTEGER DEFAULT 0, out_tok INTEGER DEFAULT 0, neurons REAL DEFAULT 0, PRIMARY KEY (day, worker, purpose, model)); CREATE TABLE ai_cache_counters (day TEXT, worker TEXT, model TEXT, calls INTEGER DEFAULT 0, cached_calls INTEGER DEFAULT 0, in_tok INTEGER DEFAULT 0, cached_tok INTEGER DEFAULT 0, PRIMARY KEY (day, worker, model));");
for (const p of ["notes/v1/_weekly-review.md", "notes/v1/personal-events-radar.md", "notes/v1/2026/10/02/ops.md", "notes/v1/2025/10/28/idea-a.md", "notes/v1/2025/06/14/idea-b.md"]) d2.prepare("INSERT INTO notes_intake (path, type, status) VALUES (?, 'note', 'active')").run(p);
const v2 = new Map([["notes/v1/2025/10/28/idea-a.md", longNote], ["notes/v1/2025/06/14/idea-b.md", longNote]]);
let failNext = true;
const AI2 = { async run(model, input) { if (failNext) { failNext = false; return { choices: [{ finish_reason: "length", message: { content: "" } }] }; } return AI.run(model, input); } };
const env2 = { QNFO_AUDIT: shim(d2), AI: AI2, VAULT: { async get(k) { return v2.has(k) ? { async text() { return v2.get(k); } } : null; } } };
let o1 = await api.runOwnerCorpus(env2);
const seen2 = () => Object.fromEntries(d2.prepare("SELECT path, outcome FROM owner_corpus_seen").all().map((r) => [r.path, r.outcome]));
ok(B > 2 ? (seen2()["notes/v1/2025/10/28/idea-a.md"] && seen2()["notes/v1/2025/06/14/idea-b.md"]) : (Object.keys(seen2()).join(",") === "notes/v1/2025/10/28/idea-a.md,notes/v1/2025/06/14/idea-b.md" || (seen2()["notes/v1/2025/10/28/idea-a.md"] && seen2()["notes/v1/2025/06/14/idea-b.md"] && Object.keys(seen2()).length === 2)), "pre-fleet dated notes are read first, newest first; with a batch of 2 ops files and undated logs wait", seen2());
ok(seen2()["notes/v1/2025/10/28/idea-a.md"] === "error1" && seen2()["notes/v1/2025/06/14/idea-b.md"] === "proposed", "a truncated reply is recorded as error1 (retryable), not lost", seen2());
d2.prepare("UPDATE owner_corpus_seen SET ts = ? WHERE outcome = 'error1'").run(new Date(Date.now() - 2 * 864e5).toISOString());
let o2 = await api.runOwnerCorpus(env2);
ok(seen2()["notes/v1/2025/10/28/idea-a.md"] === "proposed", "a day later the failed note is retried and proposed", { o2, s: seen2() });

// 8. 1.7.2 re-entry consume: owner papers and real questions only.
ok(api.realQuestion("Does the ultrametric bound extend to infinite products?") && api.realQuestion("It remains open whether the bound is tight.") && !api.realQuestion("We flag this as an open question rather than a result.") && !api.realQuestion("The results are summarised in Table 2."), "re-entry keeps real questions and drops sentences that only mention an open question");
const lp2 = mk(); lp2.exec("CREATE TABLE papers (doi TEXT, slug TEXT, identifier_type TEXT)"); lp2.prepare("INSERT INTO papers (doi, identifier_type) VALUES ('10.9999/test.own', 'owner'), ('10.9999/test.pipe', 'qnfo')").run();
const a3 = mk(); a3.exec("CREATE TABLE idea_proposals (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, idea TEXT NOT NULL, contact TEXT, status TEXT DEFAULT 'new', ip_hash TEXT, created_at TEXT, rationale TEXT); CREATE TABLE signals (id TEXT PRIMARY KEY, ts TEXT, source TEXT, source_ref TEXT, content TEXT, open_questions TEXT, evidential_weight REAL, domain TEXT, status TEXT, decision TEXT, created_at TEXT); CREATE TABLE signal_worker_boundary (worker TEXT, source TEXT, permitted INTEGER);");
a3.prepare("INSERT INTO signal_worker_boundary VALUES ('idea-hub', 'artifact_reentry_owner', 1)").run();
a3.prepare("INSERT INTO signals (id, source, source_ref, open_questions, evidential_weight, status, created_at) VALUES ('s1', 'artifact_reentry', '10.9999/test.pipe', ?, 0.9, 'new', '2026-10-01'), ('s2', 'artifact_reentry', '10.9999/test.own', ?, 0.9, 'new', '2026-10-02')").run(JSON.stringify(["Is the QEC threshold universal?"]), JSON.stringify(["We flag this as an open question rather than a result.", "Does the bound hold for p = 2?"]));
const cs = await api.runConsume({ QNFO_AUDIT: shim(a3), LIVING_PAPER: shim(lp2) });
const props = a3.prepare("SELECT idea FROM idea_proposals").all().map((r) => r.idea);
// HOLD-RELEASE-REENTRY-1 (1.8.0, #2174): a non-owner paper's signal is admitted under a daily rate instead of expired.
const s1 = a3.prepare("SELECT status, decision FROM signals WHERE id='s1'").get();
ok(s1.status === "consumed" && /HOLD-RELEASE-REENTRY-1 non-owner/.test(s1.decision) && !cs.expired_not_owner, "a signal from a pipeline (qnfo) paper is consumed under the non-owner rate, not expired", { s1, cs });
ok(props.length === 2 && props.some((x) => /Does the bound hold for p = 2\?/.test(x)) && props.some((x) => /QEC threshold universal/.test(x)) && !props.some((x) => /We flag this/.test(x)), "both real questions become proposals; the hedge sentence does not", props);
// The rate: 2 non-owner signals per UTC day; the rest stay new, and an owner signal behind them is still consumed.
a3.prepare("INSERT INTO signals (id, source, source_ref, open_questions, evidential_weight, status, created_at) VALUES ('n1', 'artifact_reentry', '10.9999/test.pipe', ?, 0.9, 'new', '2026-10-03'), ('n2', 'artifact_reentry', '10.9999/test.pipe', ?, 0.9, 'new', '2026-10-04'), ('o3', 'artifact_reentry', '10.9999/test.own', ?, 0.9, 'new', '2026-10-05')").run(JSON.stringify(["Is n1 open?"]), JSON.stringify(["Is n2 open?"]), JSON.stringify(["Is o3 open?"]));
const cs2 = await api.runConsume({ QNFO_AUDIT: shim(a3), LIVING_PAPER: shim(lp2) });
const st = (id) => a3.prepare("SELECT status FROM signals WHERE id=?").get(id).status;
ok(st("n1") === "consumed" && st("n2") === "new" && st("o3") === "consumed" && cs2.deferred_not_owner === 1, "the second non-owner signal of the day is admitted, the third waits as new, the owner signal behind it is consumed", { cs2, n1: st("n1"), n2: st("n2"), o3: st("o3") });

// 9. 1.7.2: a pipeline paper that came from an owner proposal counts as the owner's.
a3.exec("CREATE TABLE research_queue (id TEXT, source TEXT, source_id TEXT, status TEXT, doi TEXT, paper_slug TEXT)");
const op = Number(a3.prepare("INSERT INTO idea_proposals (name, idea, contact, status) VALUES ('owner-corpus', 'x', 'owner', 'triaged_accepted')").run().lastInsertRowid);
const gp = Number(a3.prepare("INSERT INTO idea_proposals (name, idea, contact, status) VALUES ('auto-scan', 'y', '', 'triaged_accepted')").run().lastInsertRowid);
a3.prepare("INSERT INTO research_queue (id, source, source_id, status, doi) VALUES ('r1', 'proposal', ?, 'published', '10.9999/test.ownpipe'), ('r2', 'proposal', ?, 'published', '10.9999/test.pipe')").run(String(op), String(gp));
lp2.prepare("INSERT INTO papers (doi, identifier_type) VALUES ('10.9999/test.ownpipe', 'qnfo')").run();
const e3 = { QNFO_AUDIT: shim(a3), LIVING_PAPER: shim(lp2) };
ok(await api.ownerPaper(e3, "10.9999/test.ownpipe") && !(await api.ownerPaper(e3, "10.9999/test.pipe")) && await api.ownerPaper(e3, "10.9999/test.own"), "a pipeline paper from an owner proposal is the owner's; one from an arXiv scan is not; an owner-typed paper is");

// NOZ-DOI-1: a paper without a DOI is keyed by its slug (living-paper slug, research_queue.paper_slug).
a3.prepare("INSERT INTO research_queue (id, source, source_id, status, doi, paper_slug) VALUES ('r3', 'proposal', ?, 'published', NULL, 'slug-only-paper')").run(String(op));
lp2.prepare("INSERT INTO papers (doi, slug, identifier_type) VALUES (NULL, 'slug-only-paper', 'qnfo')").run();
ok(await api.ownerPaper(e3, "slug-only-paper") && !(await api.ownerPaper(e3, "other-slug")), "a DOI-less pipeline paper from an owner proposal is the owner's, keyed by its slug");

const ih = readFileSync(join(here, "worker.js"), "utf8");
ok(/r\.corpus = await runOwnerCorpus\(env, WALL_DEADLINE\)/.test(ih), "the hourly ideation cycle runs the corpus feeder");
ok(/binding = "VAULT"[\s\S]*bucket_name = "obsidian-vault"/.test(readFileSync(join(here, "wrangler.toml"), "utf8")), "wrangler.toml binds the obsidian-vault bucket as VAULT");
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
