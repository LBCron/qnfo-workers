// W2-B products rows offline suite: replays migrations/2026-11-05-w2b-products-rows.sql on node:sqlite against a fixture of the live layout, runs the closing probes on both sides of their gates and checks
// the filed issue's code anchor against the file it names. No live state is read. Output MUST contain "0 failed" on success.   node migrations/w2b-products-rows.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("../migrations/2026-11-05-w2b-products-rows.sql", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL " + m); } };
ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: /m.test(sql) && /^-- BACKUP: /m.test(sql), "header opts in");
ok(/^-- CAUSE-MAPPED: /m.test(sql) && !/INTO metric_registry/i.test(sql), "registers no metric, says so");
const body = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
const db = new DatabaseSync(":memory:");
db.exec(`
CREATE TABLE roadmap_implementation(id INTEGER PRIMARY KEY, item TEXT, source TEXT, status TEXT, evidence TEXT, verified_at TEXT);
CREATE TABLE remediation_contracts(class TEXT PRIMARY KEY, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module, next_due_at, last_verdict);
CREATE TABLE decision_log(id INTEGER PRIMARY KEY, actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested);
CREATE TABLE agent_issues(id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE jobsearch_meta(k TEXT PRIMARY KEY, v TEXT, updated_at TEXT);
CREATE TABLE metric_registry(metric TEXT PRIMARY KEY, state TEXT, last_value TEXT);
CREATE TABLE human_actions(id INTEGER PRIMARY KEY, slug TEXT, status TEXT, resolution TEXT);
`);
const rows = [[1623, "YT-6", "yt-shorts-2026", "planned"], [1677, "JS-6", "jobsearch-2026", "planned"], [1678, "JS-7", "jobsearch-2026", "planned"], [1680, "JS-9", "jobsearch-2026", "built"],
  [1688, "JS-11", "jobsearch-2026", "planned"], [1690, "EXUVIA-ENGAGE-1", "exuvia-2026-10", "planned"], [1714, "YT-10", "yt-shorts-2026", "planned"], [1717, "YT-13", "yt-shorts-2026", "planned"],
  [1800, "PLUS-5", "plussing-2026", "built"], [1, "OTHER", "x", "planned"]];
for (const [id, item, src, st] of rows) db.prepare("INSERT INTO roadmap_implementation VALUES (?,?,?,?,?,NULL)").run(id, item, src, st, id === 1 ? "keep" : "base " + item);
db.exec("INSERT INTO remediation_contracts(class, issue_id, verify_probe, verify_transport, status, last_verdict, module) VALUES ('issue-1002003',1002003,'SELECT ''closed'' AS expected','d1-query','superseded','superseded:closure-observing-probe-at-birth','probe-template-v3-generic')");
db.exec("INSERT INTO human_actions VALUES (233,'yt-oauth-production-and-analytics','rerouted','handed back to the fleet by the owner (dashboard), issue 1002003, 2026-11-05T02:47:18.678Z')");
db.exec("INSERT INTO jobsearch_meta VALUES ('rerank_status','http-502','x'),('rerank_at','2026-11-05T03:16:28.829Z','x')");
db.exec("INSERT INTO metric_registry VALUES ('youtube_avg_view_duration_s','UNMEASURED','')");
db.exec(body);
const R = (id) => db.prepare("SELECT status s, evidence e, verified_at v FROM roadmap_implementation WHERE id=?").get(id);
for (const id of [1678, 1688, 1800]) ok(R(id).s === "verified" && R(id).v !== null && /W2-B/.test(R(id).e), "row " + id + " is verified with its live evidence");
ok(/jobsearch_feeds read at 03:16:28Z/.test(R(1678).e) && /smartrecruiters:oecd/.test(R(1678).e), "JS-7 names the feeds it read");
ok(/werkenvoornederland last_count 30/.test(R(1688).e) && /1000643/.test(R(1688).e), "JS-11 names the feed counts and the closed issue");
ok(R(1677).s === "built" && /NOT working/.test(R(1677).e) && /PR 7658/.test(R(1677).e) && /rm-1677/.test(R(1677).e), "JS-6 is built, says it does not work live, and names its fix and its contract");
ok(R(1680).s === "built" && /mature_applied_90d 0 of min_mature_for_rate 10/.test(R(1680).e) && R(1680).v === null, "JS-9 stays built and unverified, with the reading");
ok(R(1690).s === "partial" && /best_score 0.67/.test(R(1690).e) && /PR 7660/.test(R(1690).e), "EXUVIA-ENGAGE-1 is partial with the reading");
ok(R(1623).s === "built" && /IDENTITY-BOUND/.test(R(1623).e) && /rm-1623/.test(R(1623).e) && R(1623).v === null, "YT-6 is built, IDENTITY-BOUND, not claimed verified");
ok(R(1714).s === "partial" && /1001963/.test(R(1714).e), "YT-10 is partial with its issue");
ok(R(1717).s === "partial" && /1001965/.test(R(1717).e), "YT-13 is partial with its issue");
ok(R(1).s === "planned" && R(1).e === "keep", "other rows are untouched");
ok(db.prepare("SELECT COUNT(*) n FROM bak_20261105_w2b_rows").get().n === 9, "backup holds the nine prior rows");
ok(db.prepare("SELECT evidence e FROM bak_20261105_w2b_rows WHERE id = 1800").get().e === "base PLUS-5", "backup keeps the prior evidence");
const probe = (c) => db.prepare(db.prepare("SELECT verify_probe p FROM remediation_contracts WHERE class=?").get(c).p).get();
// the probes are read-only, one statement, and their expected is the literal ok
for (const c of ["rm-1677", "rm-1623", "issue-1002003"]) {
  const p = db.prepare("SELECT verify_probe p, status s FROM remediation_contracts WHERE class=?").get(c);
  ok(!/;/.test(p.p) && !/\b(insert|update|delete|drop|alter|create|replace)\b/i.test(p.p), c + " probe is one read-only statement");
  ok(p.s === "active" && probe(c).expected === "ok", c + " is active and expects ok");
}
// rm-1677: pending on http-502 and on a stale ok, ok on a fresh ok or reordered
ok(/^pending: jobsearch_meta rerank_status is http-502/.test(probe("rm-1677").observed), "rerank contract pends on the live http-502: " + probe("rm-1677").observed);
const iso = (ms) => new Date(Date.now() - ms).toISOString();
db.prepare("UPDATE jobsearch_meta SET v = 'ok' WHERE k = 'rerank_status'").run();
db.prepare("UPDATE jobsearch_meta SET v = ? WHERE k = 'rerank_at'").run(iso(5 * 3600e3));
ok(/^pending/.test(probe("rm-1677").observed), "a stale ok does not satisfy it");
db.prepare("UPDATE jobsearch_meta SET v = ? WHERE k = 'rerank_at'").run(iso(20 * 60e3));
ok(probe("rm-1677").observed === "ok", "a fresh ok satisfies it");
db.prepare("UPDATE jobsearch_meta SET v = 'reordered' WHERE k = 'rerank_status'").run();
ok(probe("rm-1677").observed === "ok", "a fresh reordered satisfies it");
db.prepare("UPDATE jobsearch_meta SET v = 'bad-answer' WHERE k = 'rerank_status'").run();
ok(/^pending/.test(probe("rm-1677").observed), "bad-answer does not satisfy it");
// rm-1623 and issue-1002003: pending until the metric is measured or the card is resolved by the owner
ok(/^pending: IDENTITY-BOUND/.test(probe("rm-1623").observed), "retention contract pends while the metric is unmeasured");
ok(/^pending: IDENTITY-BOUND/.test(probe("issue-1002003").observed), "the handed-back card does not close the issue");
db.exec("UPDATE human_actions SET status = 'resolved', resolution = 'handed back to the fleet by the owner (dashboard), issue 1002003' WHERE id = 233");
ok(/^pending/.test(probe("issue-1002003").observed), "a resolved handback still pends");
db.exec("UPDATE human_actions SET resolution = 'owner published the app and consented with the three scopes' WHERE id = 233");
ok(probe("issue-1002003").observed === "ok", "the owner resolving the card closes the issue probe");
db.exec("UPDATE human_actions SET status = 'rerouted', resolution = 'handed back to the fleet by the owner (dashboard), issue 1002003' WHERE id = 233");
db.exec("UPDATE metric_registry SET state = 'MEASURED', last_value = '23.4' WHERE metric = 'youtube_avg_view_duration_s'");
ok(probe("rm-1623").observed === "ok" && probe("issue-1002003").observed === "ok", "a measured retention metric satisfies both");
ok(db.prepare("SELECT status s, module m, last_verdict v FROM remediation_contracts WHERE class = 'issue-1002003'").get().m === "owner-step", "issue-1002003 is an owner-step contract again");
// the filed issue: one row, its doer lines, and an anchor that occurs once in the file it names
const iss = db.prepare("SELECT title t, description d, status s FROM agent_issues WHERE title LIKE 'AI-ROUTER-REASONING-EFFORT-1:%'").all();
ok(iss.length === 1 && iss[0].s === "open", "one open router issue");
const path = /^code-task: repo=qnfo-workers path=(\S+)$/m.exec(iss[0].d), anchor = /^code-anchor: (.+)$/m.exec(iss[0].d);
ok(path && anchor && /^code-probe: \{/m.test(iss[0].d), "the issue carries code-task, code-anchor and code-probe lines");
const src = readFileSync(new URL("../" + path[1], import.meta.url), "utf8");
ok(src.split(anchor[1]).length - 1 === 1, "the code anchor occurs exactly once in " + path[1]);
ok(/^function reasoningEffortFor\(/.test(anchor[1]), "the anchor is a function signature");
// idempotent
db.exec(body);
ok(db.prepare("SELECT COUNT(*) n FROM agent_issues").get().n === 1 && db.prepare("SELECT COUNT(*) n FROM decision_log WHERE action LIKE 'W2-B products rows:%'").get().n === 1, "a second run adds no issue and no decision");
ok((R(1678).e.match(/W2-B/g) || []).length === 1, "a second run does not repeat the evidence");
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
