// PAPER-LEARN-1 offline suite (qnfo-lifecycle 1.12.0). Drives the real default export of qnfo-lifecycle/worker.js against an
// in-memory living-paper and qnfo-audit (node:sqlite behind a small D1 shim) and a scripted Workers AI: the hourly tick reads the
// newest unread published papers, stores each claim with a verification status decided from the paper (never from the model),
// sends only errors the second model family confirms to internal_errata, files one follow-up issue with its closing probe for a
// strong direct learning, falls back to the second model when the first fails, retries a failed read at most three times,
// does not read a paper version twice, reads a new version again, writes papers_unlearned_over_120m, and stops on
// paper_learn_mode = off. The fold members survive.
// Run: node qnfo-lifecycle/paper-learn.test.mjs   -> prints "N passed, 0 failed"
import { DatabaseSync } from "node:sqlite";

const W = (await import("./worker.js")).default;
const P = W.__paperLearn;
let passed = 0, failed = 0;
const ok = (c, l, x) => { if (c) passed++; else { failed++; console.error("FAIL " + l + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 400) : "")); } };

function d1(db, faults = {}) {
  const stmt = (sql, args) => ({
    bind: (...a) => stmt(sql, a),
    async run() { const r = db.prepare(sql).run(...(args || [])); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
    async all() { return { results: db.prepare(sql).all(...(args || [])) }; },
    async first() { return db.prepare(sql).get(...(args || [])) || null; },
  });
  return { prepare: (sql) => stmt(sql, []), async batch(list) {
    if (faults.batch > 0) { faults.batch--; throw new Error("D1_ERROR: D1 DB is overloaded. Requests queued for too long."); }
    const out = []; for (const s of list) out.push(await s.run()); return out;
  } };
}

ok(P && typeof P.tick === "function" && typeof P.status === "function", "the loop is exposed on the default export (__paperLearn)");
ok(typeof W.scheduled === "function" && typeof W.fetch === "function", "fetch and scheduled survive the wrapper");
ok(W.__foldMember && W.__foldMember.name === "calendar-api", "the fold member survives the wrapper");

// Verification comes from the paper's own support, never from the model.
ok(P.verification("empirical", "none") === "unverified", "empirical with no support is unverified");
ok(P.verification("empirical", "Table 2, measured") === "cited-unchecked", "empirical with a stated source is cited-unchecked");
ok(P.verification("derived", "Section 4") === "derived-unchecked", "derived is derived-unchecked until recomputed");
ok(P.verification("assumption", "") === "assumption", "assumption stays assumption");
const n0 = P.normalize({ learnings: [{ claim: "x" }, { claim: "A long enough claim about budgets", kind: "WEIRD", applicability: "direct", confidence: 7, verification: "checked" }], errors: [{ claim: "short", why: "x" }] });
ok(n0.learnings.length === 1 && n0.learnings[0].kind === "assumption" && n0.learnings[0].confidence === 1 && n0.learnings[0].verification === "assumption", "normalize drops short claims, clamps confidence, ignores a model-set verification", n0);
ok(n0.errors.length === 0, "normalize drops an error without a reason");
ok(P.json("Sure! ```json\n{\"learnings\": [], \"note\": \"a \\\\ b\"}\n``` done").learnings.length === 0, "json reads the first balanced object out of prose");
ok(P.json("{\"a\": \"\\frac{1}{2}\"}") !== null, "json survives a lone LaTeX backslash");

// Fixtures.
const living = new DatabaseSync(":memory:");
living.exec("CREATE TABLE papers (slug TEXT, title TEXT, version TEXT, status TEXT, body_md TEXT, updated_at TEXT)");
const audit = new DatabaseSync(":memory:");
audit.exec(`CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT, updated_at TEXT);
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT DEFAULT 'optimization', priority TEXT DEFAULT 'medium', status TEXT DEFAULT 'open', linked_session TEXT, created_at INTEGER, updated_at INTEGER, pipeline_stage TEXT DEFAULT NULL, predicate_id TEXT, recheck_count INTEGER DEFAULT 0, close_channel TEXT);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT NOT NULL, action TEXT NOT NULL, verify_probe TEXT NOT NULL, verify_transport TEXT NOT NULL, max_attempts INTEGER NOT NULL DEFAULT 3, escalate_to TEXT NOT NULL, expected_cadence_h INTEGER, status TEXT DEFAULT 'active', ts TEXT, last_attempt_at TEXT, last_verdict TEXT, module TEXT, budget_ms INTEGER DEFAULT 45000, next_due_at TEXT, max_items INTEGER DEFAULT 5, requires_container INTEGER DEFAULT 0, attempts INTEGER DEFAULT 0, deferred_since TEXT);
CREATE TABLE internal_errata (id TEXT PRIMARY KEY, target_kind TEXT NOT NULL, target_ref TEXT NOT NULL, detected_at TEXT NOT NULL, detected_by TEXT, severity TEXT DEFAULT 'high', claim_text TEXT, falsification TEXT, evidence TEXT, remediation TEXT, status TEXT DEFAULT 'open', owner TEXT, updated_at TEXT);
CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, last_value TEXT, last_refreshed TEXT, state TEXT);
CREATE TABLE cloud_ops_events (id TEXT PRIMARY KEY, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT);
INSERT INTO metric_registry (metric) VALUES ('papers_unlearned_over_120m');
-- ORPHAN-GUARD-BIRTH-1 stand-in: every new issue gets its issue-<id> contract row at birth.
CREATE TRIGGER birth AFTER INSERT ON agent_issues BEGIN INSERT INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, escalate_to) VALUES ('issue-' || NEW.id, NEW.id, 'birth', 'birth', 'pending', 'pending', 'x'); END;`);
const ago = (min) => new Date(Date.now() - min * 60000).toISOString().replace("T", " ").slice(0, 19);
const body = (s) => "# " + s + "\n\n" + "A derivation about operating points. ".repeat(300);
const addPaper = (slug, ver, min, status) => living.prepare("INSERT INTO papers VALUES (?, ?, ?, ?, ?, ?)").run(slug, "Title " + slug, ver, status || "published", body(slug), ago(min));
addPaper("p-new", "1.0.0", 5);
addPaper("p-old", "1.0.0", 300);
addPaper("p-older", "1.0.0", 3000);
addPaper("p-draft", "1.0.0", 1, "draft");
living.prepare("INSERT INTO papers VALUES ('p-short', 't', '1.0.0', 'published', 'too short', ?)").run(ago(2));

// Scripted Workers AI: the first model answers per paper; the confirmation call answers by the reviewer list.
const calls = [];
let plan = {};
const AI = { async run(model, opts) {
  const prompt = opts.messages[0].content;
  calls.push({ model, confirm: prompt.startsWith("A reviewer claims") });
  if (prompt.startsWith("A reviewer claims")) return { choices: [{ message: { content: JSON.stringify({ verdicts: [{ i: 0, confirmed: true, why: "the concave case is beaten by steady spending" }, { i: 1, confirmed: false, why: "it follows" }] }) } }] };
  const slug = /PAPER: Title (\S+)/.exec(prompt)[1];
  const step = (plan[slug] || [])[model.includes("glm") ? 0 : 1];
  if (step === "throw") throw new Error("3040: capacity temporarily exceeded");
  if (step === "garbage") return { response: "I could not read it." };
  return { response: "Here you go:\n" + JSON.stringify(step || { learnings: [], errors: [] }) };
} };
const auditFaults = { batch: 0 };
const env = { LIVING_PAPER: d1(living), QNFO_AUDIT: d1(audit, auditFaults), AI };

const strong = { learnings: [
  { claim: "Steady spending at the budget beats duty cycling when output is concave", section: "4.4", kind: "derived", support: "Section 4.4", fleet_lever: "budget steering", application: "keep cheap models running", applicability: "direct", confidence: 0.9 },
  { claim: "Novelty grows superlinearly with self-reference, an empirical fact", section: "3.1", kind: "empirical", support: "none", fleet_lever: "", application: "", applicability: "analogy", confidence: 0.4 },
  { claim: "The Landauer floor is 2.967e-21 J per bit at 310 K", section: "4.5", kind: "derived", support: "Section 4.5", fleet_lever: "", application: "", applicability: "none", confidence: 0.9 },
], errors: [
  { claim: "The duty cycle is called optimal", why: "U = p(1-p) is concave so steady operation wins" },
  { claim: "The quartic moves the optimum to zero", why: "the root rises with beta" },
] };
plan = { "p-new": [strong], "p-old": ["throw", { learnings: [{ claim: "Cascade size is 1/(1-m) for a branching process", kind: "derived", support: "4.2", applicability: "direct", confidence: 0.6 }], errors: [] }], "p-older": ["garbage", "garbage"] };

audit.exec("INSERT INTO ops_config (key, value) VALUES ('paper_learn_per_tick', '3')");
let r = await P.tick(env);
ok(r.read.length === 3 && r.read[0].slug === "p-new" && r.read[1].slug === "p-old", "the tick reads the newest unread published papers first, skipping drafts and short bodies", r.read);
const L = audit.prepare("SELECT * FROM paper_learnings WHERE slug = 'p-new' ORDER BY id").all();
ok(L.filter((x) => x.kind !== "error").length === 3, "three learnings stored for p-new", L.length);
ok(L.find((x) => /superlinearly/.test(x.claim)).verification === "unverified", "the empirical claim with no support is stored unverified");
ok(L.find((x) => /Steady/.test(x.claim)).verification === "derived-unchecked" && L.find((x) => /Steady/.test(x.claim)).fleet_status === "proposed", "a derived claim is derived-unchecked and proposed");
ok(L.find((x) => /Landauer/.test(x.claim)).fleet_status === "n/a", "a claim with no fleet bearing is n/a");
const E = audit.prepare("SELECT * FROM internal_errata").all();
ok(E.length === 1 && E[0].target_ref === "p-new" && E[0].owner === "qnfo-research-exec" && E[0].status === "open" && /duty cycle/.test(E[0].claim_text), "only the error the second family confirmed reaches internal_errata", E);
ok(L.filter((x) => x.kind === "error").length === 1 && L.find((x) => x.kind === "error").fleet_status === "routed", "the confirmed error is recorded as routed");
const conf = calls.filter((c) => c.confirm);
ok(conf.length === 1 && conf[0].model.includes("gpt-oss"), "the confirmation runs on the other model family", conf);
ok(audit.prepare("SELECT COUNT(*) AS n FROM paper_learnings WHERE slug = 'p-old'").get().n === 1 && audit.prepare("SELECT model FROM paper_learn_state WHERE slug = 'p-old'").get().model.includes("gpt-oss"), "a failing first model falls back to the second family");
const S3 = audit.prepare("SELECT * FROM paper_learn_state WHERE slug = 'p-older'").get();
ok(S3.status === "failed" && S3.attempts === 1 && audit.prepare("SELECT COUNT(*) AS n FROM paper_learnings WHERE slug = 'p-older'").get().n === 0, "an unreadable answer is a failed state row with no learnings", S3);
const I = audit.prepare("SELECT * FROM agent_issues").all();
ok(I.length === 1 && I[0].title === "PAPER-LEARN-1: apply p-new to the fleet" && /Charter pillar: autonomy/.test(I[0].description), "one follow-up issue for the strong direct learning (p-old's 0.6 learning files none)", I.map((x) => x.title));
const C = audit.prepare("SELECT * FROM remediation_contracts WHERE class = ?").get("issue-" + I[0].id);
ok(C.verify_transport === "d1-query" && /fleet_status = 'proposed'/.test(C.verify_probe), "the birth contract carries the closing probe", C);
ok(audit.prepare(C.verify_probe).get().observed === "1", "the probe reads 1 while the learning is proposed");
audit.prepare("UPDATE paper_learnings SET fleet_status = 'applied' WHERE slug = 'p-new' AND applicability = 'direct'").run();
ok(audit.prepare(C.verify_probe).get().observed === "0", "the probe passes once the learning is applied");
ok(audit.prepare("SELECT last_value FROM metric_registry WHERE metric = 'papers_unlearned_over_120m'").get().last_value === "0", "papers_unlearned_over_120m is 0: the read papers left, p-older changed outside the 1,440-minute window", audit.prepare("SELECT * FROM metric_registry").all());

// Second tick: nothing read twice; the failed paper is retried until three attempts.
plan["p-older"] = ["garbage", "garbage"];
calls.length = 0;
r = await P.tick(env);
ok(r.read.length === 1 && r.read[0].slug === "p-older" && audit.prepare("SELECT attempts FROM paper_learn_state WHERE slug = 'p-older'").get().attempts === 2, "only the failed paper is read again", r.read);
await P.tick(env);
r = await P.tick(env);
ok(r.read.length === 0 && audit.prepare("SELECT attempts FROM paper_learn_state WHERE slug = 'p-older'").get().attempts === 3, "a paper is tried at most three times");

// A new version is read again; the open-issue dedupe holds.
living.prepare("UPDATE papers SET version = '1.1.0', updated_at = ? WHERE slug = 'p-new'").run(ago(1));
auditFaults.batch = 1;
r = await P.tick(env);
ok(r.read.length === 1 && r.read[0].version === "1.1.0", "a revised version is read again", r.read);
ok(auditFaults.batch === 0 && audit.prepare("SELECT COUNT(*) AS n FROM paper_learnings WHERE slug = 'p-new' AND version = '1.1.0'").get().n === 4, "a transient D1 batch overload retries the write and stores the learning set once");
ok(audit.prepare("SELECT COUNT(*) AS n FROM agent_issues").get().n === 1, "the open follow-up issue is not filed twice");
ok(audit.prepare("SELECT COUNT(*) AS n FROM internal_errata").get().n === 2, "the new version's confirmed error is a new errata row");

// The open-issue cap is backpressure: five open PAPER-LEARN-1 issues hold new filings.
for (let i = 0; i < 5; i++) audit.prepare("INSERT INTO agent_issues (title, status) VALUES (?, 'open')").run("PAPER-LEARN-1: apply cap-" + i + " to the fleet");
addPaper("p-cap", "1.0.0", 1);
plan["p-cap"] = [strong];
r = await P.tick(env);
ok(r.read.length === 1 && r.read[0].issue === null && audit.prepare("SELECT COUNT(*) AS n FROM agent_issues WHERE title LIKE '%p-cap%'").get().n === 0, "no new issue while five are open", r.read);

// A version that changed 600 minutes ago and is still unread counts against the SLA; one under 120 minutes does not.
audit.exec("UPDATE ops_config SET value = '0' WHERE key = 'paper_learn_per_tick'");
addPaper("p-wait", "1.0.0", 600);
addPaper("p-fresh", "1.0.0", 30);
r = await P.tick(env);
ok(r.read.length === 0 && audit.prepare("SELECT last_value FROM metric_registry WHERE metric = 'papers_unlearned_over_120m'").get().last_value === "1", "papers_unlearned_over_120m counts the 600-minute paper only", r);

// Off switch, status routes, scheduled wiring.
audit.exec("INSERT OR REPLACE INTO ops_config (key, value) VALUES ('paper_learn_mode', 'off')");
addPaper("p-off", "1.0.0", 1);
r = await P.tick(env);
ok(r.skipped === true && r.read.length === 0, "paper_learn_mode = off stops the step");
const st = await (await W.fetch(new Request("https://x/paper-learn/status"), env, {})).json();
ok(st.marker === "PAPER-LEARN-1" && st.state.versions >= 4, "GET /paper-learn/status reports the ledger", st);
const one = await (await W.fetch(new Request("https://x/paper-learn/learnings?slug=p-new"), env, {})).json();
ok(one.learnings.length >= 4 && one.learnings.every((x) => x.verification), "GET /paper-learn/learnings?slug= lists a paper's learnings");
const ev = audit.prepare("SELECT COUNT(*) AS n FROM cloud_ops_events WHERE job = 'paper-learn'").get().n;
await W.scheduled({ cron: "0 0 1 * *", scheduledTime: Date.now() }, Object.assign({}, env), { waitUntil() {} }).catch(() => {});
ok(audit.prepare("SELECT COUNT(*) AS n FROM cloud_ops_events WHERE job = 'paper-learn'").get().n === ev, "a non-tick cron does not run the step");

console.log(passed + " passed, " + failed + " failed");
if (failed) process.exit(1);
