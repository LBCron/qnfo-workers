// C3-PRODUCTS verified-state offline suite: replays migrations/2026-11-05-c3-products-verified.sql on node:sqlite against a fixture of the live layout and runs the three probes
// on both sides of their gates. No live state is read. Output MUST contain "0 failed" on success.   node migrations/c3-products-verified.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("../migrations/2026-11-05-c3-products-verified.sql", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL " + m); } };
ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: /m.test(sql) && /^-- BACKUP: /m.test(sql), "header opts in");
ok(/^-- CAUSE-MAPPED: /m.test(sql) && !/INTO metric_registry/i.test(sql), "registers no metric, says so");
const body = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
const db = new DatabaseSync(":memory:");
db.exec(`
CREATE TABLE roadmap_implementation(id INTEGER PRIMARY KEY, item TEXT, source TEXT, status TEXT, evidence TEXT, verified_at TEXT);
CREATE TABLE remediation_contracts(class TEXT PRIMARY KEY, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module, next_due_at, last_verdict TEXT);
CREATE TABLE decision_log(id INTEGER PRIMARY KEY, actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested);
CREATE TABLE cf_agent_requests(id INTEGER PRIMARY KEY AUTOINCREMENT, instance TEXT, prompt TEXT);
CREATE TABLE social_video_posts(slug TEXT, platform TEXT, state TEXT, PRIMARY KEY(slug, platform));
CREATE TABLE human_actions(id INTEGER PRIMARY KEY, slug TEXT, status TEXT, resolution TEXT);
CREATE TABLE cloud_ops_events(id TEXT, ts TEXT, kind TEXT, job TEXT);
`);
db.exec("INSERT INTO roadmap_implementation VALUES (1797,'PLUS-2','plussing-2026','built','PR 7337 data layer.','2026-11-05T00:09:57Z'),(1800,'PLUS-5','plussing-2026','planned','depends on PLUS-4',NULL),(3109,'YT-16','yt-shorts-2026','planned','old',NULL),(1,'X','y','planned','keep',NULL)");
db.exec("INSERT INTO remediation_contracts(class, issue_id, verify_probe, verify_transport, status, last_verdict, module) VALUES ('issue-1001913',1001913,'SELECT ''closed'' AS expected','d1-query','superseded','superseded:closure-observing-probe-at-birth','probe-template-v3-generic')");
db.exec(body);
const R = (id) => db.prepare("SELECT status s, evidence e, verified_at v FROM roadmap_implementation WHERE id=?").get(id);
ok(R(1800).s === "built" && R(1800).v !== null && /PR 7450/.test(R(1800).e) && /PR 7520/.test(R(1800).e), "PLUS-5 built with its evidence");
ok(R(1797).s === "built" && /PR 7337 data layer\./.test(R(1797).e) && /Consumer side \(PR 7456/.test(R(1797).e), "PLUS-2 keeps its earlier evidence and gains the consumer note");
ok(R(3109).s === "deployed" && R(3109).v === null && /not built-and-verified/.test(R(3109).e), "YT-16 is deployed, not built, not claimed verified");
ok(R(1).s === "planned" && R(1).e === "keep", "other rows are untouched");
ok(db.prepare("SELECT COUNT(*) n FROM bak_20261105_c3_rows2").get().n === 3, "backup holds the three prior rows");
const probe = (c) => db.prepare(db.prepare("SELECT verify_probe p FROM remediation_contracts WHERE class=?").get(c).p).get();
// PLUS-2 consumer probe
let p = probe("rm-plus-2-pick-verify");
ok(p.expected === "ok" && /^pending: no plus request/.test(p.observed), "pick probe pends with no request: " + p.observed);
db.exec("INSERT INTO cf_agent_requests(instance, prompt) VALUES ('roadmap-QNFO.RSCH-plus-x-20261105', 'Usage signal: worker_requests_7d. Quality measure')");
ok(/^pending/.test(probe("rm-plus-2-pick-verify").observed), "a prompt without the number does not satisfy it");
db.exec("INSERT INTO cf_agent_requests(instance, prompt) VALUES ('roadmap-QNFO.RSCH-plus-papers-20261106', 'Usage signal: worker_requests_7d = 165043 over 7d (Worker requests)')");
ok(probe("rm-plus-2-pick-verify").observed === "ok", "a prompt with the number satisfies it");
// YT-16 probe
ok(/^pending: social_video_posts has no posted row/.test(probe("rm-yt-16-first-post").observed), "first-post probe pends on an empty ledger");
db.exec("INSERT INTO social_video_posts VALUES ('s','bluesky','error')");
ok(/^pending/.test(probe("rm-yt-16-first-post").observed), "a failed attempt is not a post");
db.exec("INSERT INTO social_video_posts VALUES ('s','mastodon','posted')");
ok(probe("rm-yt-16-first-post").observed === "ok", "a posted row satisfies it");
// issue-1001913 probe
const row = db.prepare("SELECT status s, last_verdict v, module m, verify_transport t FROM remediation_contracts WHERE class='issue-1001913'").get();
ok(row.s === "active" && row.v === null && row.m === "owner-step" && row.t === "d1-query", "the birth probe is replaced and the contract is live again");
const ev = db.prepare("INSERT INTO cloud_ops_events(id,ts,kind,job) VALUES (?,?,?,?)");
const iso = (d) => new Date(Date.now() - d * 86400000).toISOString();
ev.run("a", iso(8), "youtube.uploaded", "qnfo-youtube-shorts"); ev.run("b", iso(0.05), "youtube.uploaded", "qnfo-youtube-shorts");
db.exec("INSERT INTO human_actions VALUES (226,'yt-oauth-publish','rerouted','handed back to the fleet by the owner (dashboard), issue 1001913')");
p = probe("issue-1001913");
ok(p.expected === "ok" && /^pending: IDENTITY-BOUND owner step\./.test(p.observed) && /Uploads have run 8 of 21 days/.test(p.observed), "issue probe pends in the IDENTITY-BOUND shape: " + p.observed);
ok(!/\bupdate \b|\binsert\b|\bdelete\b|\bdrop\b|\balter\b/i.test(p.observed) && !/\bupdate \b/i.test(db.prepare("SELECT verify_probe p FROM remediation_contracts WHERE class='issue-1001913'").get().p.replace(/UPDATE/g, "")), "no write keyword in the probe text (the runners scan literals)");
db.exec("UPDATE human_actions SET status='resolved', resolution='handed back to the fleet by the owner (dashboard), issue 1001913' WHERE id=226");
ok(/^pending/.test(probe("issue-1001913").observed), "a handback resolution does not satisfy it");
db.exec("UPDATE human_actions SET status='resolved', resolution='owner published the app' WHERE id=226");
ok(probe("issue-1001913").observed === "ok", "a real resolution by the owner satisfies it");
db.exec("UPDATE human_actions SET status='resolved', resolution='handed back to the fleet by the owner (dashboard), issue 1001913' WHERE id=226; DELETE FROM cloud_ops_events");
ev.run("a", iso(22), "youtube.uploaded", "qnfo-youtube-shorts"); ev.run("b", iso(1), "youtube.uploaded", "qnfo-youtube-shorts");
ok(probe("issue-1001913").observed === "ok", "21 days of uploads with a recent one satisfies it");
ok(db.prepare("SELECT COUNT(*) n FROM decision_log").get().n === 1, "one decision_log row");
console.log(pass + " passed, " + fail + " failed");
