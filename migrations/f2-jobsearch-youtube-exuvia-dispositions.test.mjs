// F2 cluster dispositions (migrations/2026-11-05-f2-jobsearch-youtube-exuvia-dispositions.sql) offline suite, on SQLite (node:sqlite) with fixture tables.
// Proves: roadmap rows only gain evidence (two become built, none becomes verified), the backup holds the old text, the three owner cards carry an IDENTITY-BOUND line,
// a default in effect and no route to a chat product, every probe returns the literal ok when its condition holds and a pending line when it does not (no semicolon, so the
// D1 rewrite triggers cannot change it), the replaced probes of 1000643, 1000644 and 1000707 can pass, the render-speed contract reads the worst ratio, and a replay adds nothing.
// Run: node migrations/f2-jobsearch-youtube-exuvia-dispositions.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("./2026-11-05-f2-jobsearch-youtube-exuvia-dispositions.sql", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };
const hdr = sql.split("\n").filter((l) => l.startsWith("--"));
ok(hdr.some((l) => l === "-- APPLY-BY: ci") && hdr.some((l) => l === "-- DB: qnfo-audit") && hdr.some((l) => l.startsWith("-- Rollback: ")) && hdr.some((l) => l === "-- BACKUP: bak_20261105_f2_roadmap"), "header lines");
ok(!/[^\x00-\x7F]/.test(sql), "ascii only");

const IDS = [1622, 1623, 1677, 1678, 1679, 1680, 1688, 1690, 1713, 1714, 1715, 1716, 1717, 3109, 3111, 3129];
const db = new DatabaseSync(":memory:");
db.exec(`
CREATE TABLE roadmap_implementation (id INTEGER PRIMARY KEY, item TEXT, source TEXT, title TEXT, artifact_type TEXT, artifact_ref TEXT, status TEXT, evidence TEXT, verified_at TEXT, created_at TEXT);
CREATE TABLE human_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE, title TEXT, why TEXT, default_in_effect TEXT, action TEXT, url TEXT, sev TEXT, due TEXT, status TEXT, source TEXT, created_at TEXT, updated_at TEXT, resolved_at TEXT, resolution TEXT);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER, escalate_to TEXT, expected_cadence_h REAL, status TEXT, ts TEXT, last_attempt_at TEXT, last_verdict TEXT, module TEXT, budget_ms INTEGER, next_due_at TEXT);
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT, outcome_matched INTEGER);
CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT, updated_at TEXT);
CREATE TABLE jobsearch_feeds (feed TEXT PRIMARY KEY, last_ok_at TEXT, last_count INTEGER, last_error TEXT, last_error_at TEXT, consecutive_fail INTEGER DEFAULT 0);
CREATE TABLE jobsearch_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT, finished_at TEXT, errors_json TEXT);
CREATE TABLE jobsearch_bank (k TEXT PRIMARY KEY, v TEXT, rev INTEGER);
CREATE TABLE jobsearch_meta (k TEXT PRIMARY KEY, v TEXT, updated_at TEXT);
CREATE TABLE youtube_videos (id INTEGER PRIMARY KEY, slug TEXT, state TEXT, duration_s REAL, avg_view_duration_s REAL);
CREATE TABLE youtube_spend (id INTEGER PRIMARY KEY AUTOINCREMENT, row_id INTEGER, kind TEXT, units REAL);
`);
for (const id of IDS) db.prepare("INSERT INTO roadmap_implementation (id, item, source, status, evidence) VALUES (?, ?, 'x', 'planned', ?)").run(id, "I" + id, "old evidence " + id);
for (const id of [1000643, 1000644, 1000707]) db.prepare("INSERT INTO remediation_contracts (class, issue_id, verify_probe, verify_transport, status, last_verdict) VALUES (?, ?, 'SELECT 1', 'code-read', 'active', 'fail')").run("issue-" + id, id);
db.prepare("INSERT INTO roadmap_implementation (id, item, source, status, evidence) VALUES (9999, 'OTHER', 'x', 'planned', 'untouched')").run();

db.exec(sql);
const count = (t) => db.prepare("SELECT COUNT(*) n FROM " + t).get().n;
const rm = (id) => db.prepare("SELECT status, evidence FROM roadmap_implementation WHERE id = ?").get(id);

// ---- roadmap rows
ok(rm(1680).status === "built" && rm(1713).status === "built", "JS-9 and YT-9 are built");
ok(IDS.filter((id) => ![1680, 1713].includes(id)).every((id) => rm(id).status === "planned"), "every other row keeps its status (no row is verified by this file)");
ok(IDS.every((id) => rm(id).evidence && !rm(id).evidence.startsWith("old evidence")), "every row has new evidence");
ok(rm(9999).evidence === "untouched" && rm(9999).status === "planned", "an unrelated row is untouched");
ok(db.prepare("SELECT COUNT(*) n FROM bak_20261105_f2_roadmap").get().n === IDS.length && db.prepare("SELECT evidence FROM bak_20261105_f2_roadmap WHERE id = 1680").get().evidence === "old evidence 1680", "the backup holds the old text");
ok(count("bak_20261105_f2_contracts") === 3, "the contract backup holds the three probes");
ok(/7423/.test(rm(1677).evidence) && /7458/.test(rm(1717).evidence) && /7293/.test(rm(1690).evidence) && /7258/.test(rm(3109).evidence) && /6368/.test(rm(1680).evidence), "evidence names the pull requests");
ok(/Not verified live/.test(rm(1680).evidence), "JS-9 says it is not verified live");
ok(/IDENTITY-BOUND/.test(rm(1622).evidence) && /IDENTITY-BOUND/.test(rm(1679).evidence) && /IDENTITY-BOUND/.test(rm(3111).evidence), "owner-only rows say why");

// ---- cards
const cards = db.prepare("SELECT * FROM human_actions ORDER BY slug").all();
ok(cards.map((c) => c.slug).join() === "jobsearch-ledger-owner-answers-held,yt-channel-branding-owner,yt-oauth-production-and-analytics", "three cards", cards.map((c) => c.slug));
for (const c of cards) {
  ok(/^IDENTITY-BOUND: /.test(c.why), "IDENTITY-BOUND line: " + c.slug);
  ok(c.status === "open" && c.default_in_effect.length > 20 && c.action.length > 80 && c.source === "session:F2", "open, default in effect, steps: " + c.slug);
  ok(!/claude|anthropic/i.test(JSON.stringify(c)), "no route to a chat product: " + c.slug);
}
ok(/Publish app/.test(cards.find((c) => c.slug === "yt-oauth-production-and-analytics").action) && /yt-analytics\.readonly/.test(cards.find((c) => c.slug === "yt-oauth-production-and-analytics").action), "the OAuth card names the console step and the scope");

// ---- owner-card contracts
const probe = (cls) => db.prepare("SELECT verify_probe, verify_transport FROM remediation_contracts WHERE class = ?").get(cls);
const run = (cls) => { const p = probe(cls); ok(p && p.verify_transport === "d1-query" && !p.verify_probe.includes(";"), cls + " is a d1-query without a semicolon"); const r = db.prepare(p.verify_probe).get(); return r; };
const passes = (r) => r.expected === "ok" && r.observed === "ok";
const pending = (r) => r.expected === "ok" && /^pending: /.test(r.observed);
let r = run("owner-card-yt-oauth");
ok(pending(r), "yt oauth: pending with no read duration", r);
db.prepare("INSERT INTO youtube_videos (id, slug, state, duration_s, avg_view_duration_s) VALUES (1, 'a', 'uploaded', 25.8, NULL)").run();
ok(pending(run("owner-card-yt-oauth")), "yt oauth: a NULL duration is still pending");
db.prepare("UPDATE youtube_videos SET avg_view_duration_s = 11.4 WHERE id = 1").run();
ok(passes(run("owner-card-yt-oauth")), "yt oauth: passes when a Short has a read duration");
r = run("owner-card-yt-branding");
ok(pending(r), "branding: pending without an answer", r);
db.prepare("INSERT INTO ops_config (key, value) VALUES ('yt_channel_branding', 'keep')").run();
ok(passes(run("owner-card-yt-branding")), "branding: passes when the answer is recorded");

// ---- replaced probes can pass and cannot pass early
r = run("issue-1000643");
ok(pending(r), "1000643: pending while the reader yields 2 postings", r);
db.prepare("INSERT INTO jobsearch_feeds (feed, last_count, consecutive_fail) VALUES ('publicsector:werkenvoornederland', 2, 0)").run();
ok(pending(run("issue-1000643")), "1000643: the old reader's 2 postings are not enough");
db.prepare("UPDATE jobsearch_feeds SET last_count = 30 WHERE feed = 'publicsector:werkenvoornederland'").run();
for (let i = 0; i < 3; i++) db.prepare("INSERT INTO jobsearch_runs (started_at, finished_at, errors_json) VALUES ('t', 't', '[]')").run();
ok(passes(run("issue-1000643")), "1000643: passes with 30 postings and 3 clean runs");
db.prepare("INSERT INTO jobsearch_runs (started_at, finished_at, errors_json) VALUES ('t', 't', '[\"publicsector:werkenvoornederland: HTTP 500\"]')").run();
ok(pending(run("issue-1000643")), "1000643: a failing run among the last 3 stops it");

r = run("issue-1000644");
ok(pending(r) && /0 posted/.test(r.observed), "1000644: pending with nothing posted", r);
const dl = (outcome, ts) => db.prepare("INSERT INTO decision_log (ts, actor, outcome) VALUES (?, 'qnfo-memory-mcp:exuvia-engage', ?)").run(ts, outcome);
dl("Evidence-backed reply draft prepared; not posted", "2026-11-01T00:00:00Z");
for (let i = 0; i < 3; i++) dl("posted", new Date(Date.now() - 2 * 86400000).toISOString().replace(/\.\d{3}Z$/, "Z"));
ok(pending(run("issue-1000644")) && /3 posted, 1 drafted/.test(run("issue-1000644").observed), "1000644: three posted rows younger than 7 days are not enough", run("issue-1000644"));
db.prepare("UPDATE decision_log SET ts = ? WHERE outcome = 'posted' AND id = (SELECT MIN(id) FROM decision_log WHERE outcome = 'posted')").run(new Date(Date.now() - 8 * 86400000).toISOString().replace(/\.\d{3}Z$/, "Z"));
ok(passes(run("issue-1000644")), "1000644: passes with 3 posted rows, the first 8 days old, none refused");
dl("HTTP 403", "2026-11-05T00:00:00Z");
ok(pending(run("issue-1000644")), "1000644: an Exuvia refusal stops it");

r = run("issue-1000707");
ok(pending(r) && /000 of the three/.test(r.observed), "1000707: pending with no bank", r);
db.prepare("INSERT INTO jobsearch_bank (k, v, rev) VALUES ('bank', '{\"publications\":[{\"title\":\"Quantum Laws of Form\"},{\"title\":\"Dimensionless Physics\"},{\"title\":\"Proof-of-Concept for Auditable Attention using Ultrametric Tree Distances\"}]}', 1)").run();
ok(pending(run("issue-1000707")) && /111 of the three/.test(run("issue-1000707").observed), "1000707: the three papers alone are not the whole definition of done");
db.prepare("INSERT INTO jobsearch_meta (k, v) VALUES ('research_headline', 'on')").run();
ok(passes(run("issue-1000707")), "1000707: passes with the papers and the headline flag");

// ---- remainders
const issues = db.prepare("SELECT * FROM agent_issues ORDER BY id").all();
ok(issues.length === 4 && issues.every((i) => i.status === "open" && i.priority && i.category && i.description.length > 400), "four open remainder issues with a real description", issues.map((i) => i.title.slice(0, 20)));
const hl = issues.find((i) => /^JOBSEARCH-RESEARCH-HEADLINE-1:/.test(i.title));
ok(/\ncode-task: repo=qnfo-workers path=qnfo-jobsearch\/worker\.js\ncode-anchor: function headline\(clusters\) \{\ncode-probe: /.test(hl.description), "the code-loop issue carries the task, anchor and probe lines");
ok(issues.filter((i) => /container|pull request from a session/.test(i.description)).length === 3 && !issues.filter((i) => /^YT-/.test(i.title)).some((i) => /code-task:/.test(i.description)), "the container issues name their doer and give the code loop no task it cannot merge");
const speed = issues.find((i) => /^YT-RENDER-SPEED-1:/.test(i.title));
ok(!!probe("issue-" + speed.id), "the render-speed issue has its own contract");
r = run("issue-" + speed.id);
ok(pending(r) && /n\/a|0 renders/.test(r.observed), "render speed: pending with no renders", r);
const spend = (row, units, dur) => { db.prepare("INSERT OR REPLACE INTO youtube_videos (id, slug, state, duration_s) VALUES (?, 's' || ?, 'uploaded', ?)").run(row, row, dur); db.prepare("INSERT INTO youtube_spend (row_id, kind, units) VALUES (?, 'container', ?)").run(row, units); };
spend(11, 143, 55.9); spend(12, 122, 25.8); spend(13, 306, 59.5);
r = run("issue-" + speed.id);
ok(pending(r) && /5\.14/.test(r.observed), "render speed: the 306 s render for 59.5 s fails the target", r);
spend(14, 100, 60); spend(15, 90, 55); spend(16, 110, 58);
ok(passes(run("issue-" + speed.id)), "render speed: passes when the last 3 are at most 2 s per video second");

// ---- decisions
const dec = db.prepare("SELECT action, rollback_path FROM decision_log WHERE actor = 'coding-agent (F2 cluster)'").all();
ok(dec.length === 2 && dec.every((d) => d.rollback_path.length > 20), "two decisions with a way back", dec);

// ---- a replay adds nothing and breaks nothing
const before = { cards: count("human_actions"), issues: count("agent_issues"), dec: count("decision_log"), rc: count("remediation_contracts"), bak: count("bak_20261105_f2_roadmap") };
db.exec(sql);
ok(count("human_actions") === before.cards && count("agent_issues") === before.issues && count("decision_log") === before.dec && count("remediation_contracts") === before.rc && count("bak_20261105_f2_roadmap") === before.bak, "a replay adds nothing", before);
ok(rm(1680).status === "built" && db.prepare("SELECT evidence FROM bak_20261105_f2_roadmap WHERE id = 1680").get().evidence === "old evidence 1680", "a replay keeps the first backup");
console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
