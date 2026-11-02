// TRACKER-SYNC-1 offline suite: agent_issues are mirrored to GitHub issues and kept in state, code_tasks follow their PRs,
// and the sync refuses to act on a partial or anomalous GitHub read. Run: node qnfo-github-steward/tracker-sync.test.mjs
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
const here = dirname(fileURLToPath(import.meta.url));
const w = (await import(pathToFileURL(join(here, "worker.js")).href)).default;
const VERSION = /var VERSION = "(\d+)\.(\d+)/.exec(readFileSync(join(here, "worker.js"), "utf8"));
assert.ok(Number(VERSION[1]) > 0 || Number(VERSION[2]) >= 3, "VERSION at or above 0.3 (minimum, not a pin)");

const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT DEFAULT 'open', linked_session TEXT, created_at INTEGER, updated_at INTEGER, pipeline_stage TEXT, predicate_id TEXT, recheck_count INTEGER DEFAULT 0, close_channel TEXT)");
db.exec("CREATE TABLE issue_triage (issue_id INTEGER PRIMARY KEY, rc TEXT, owner TEXT, sla_due_at TEXT, close_evidence TEXT)");
db.exec("CREATE TABLE code_tasks (id TEXT PRIMARY KEY, repo TEXT, path TEXT, goal TEXT, status TEXT, branch TEXT, pr_url TEXT, merged_by TEXT, merged_sha TEXT, merged_at TEXT, merge_note TEXT, created_at TEXT, updated_at TEXT)");
db.exec("CREATE TABLE fleet_issue_dispatch (fingerprint TEXT PRIMARY KEY, category TEXT, sev TEXT, owner TEXT, payload TEXT, gh_number TEXT, state TEXT, exec_state TEXT, exec_ts TEXT, exec_result TEXT, exec_attempts INTEGER)");
db.exec("CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, last_value TEXT, last_refreshed TEXT, state TEXT)");
db.exec("CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT)");
const mig = readFileSync(join(here, "..", "migrations", "2026-10-18-tracker-sync.sql"), "utf8");
for (const stmt of mig.split(/;\s*\n/).map((s) => s.replace(/^\s*--.*$/gm, "").trim()).filter(Boolean)) {
  if (/^INSERT OR IGNORE INTO analytics_metric_triggers/.test(stmt)) continue;
  if (/^INSERT OR IGNORE INTO metric_registry/.test(stmt)) { for (const m of ["tracker_drift", "tracker_issue_drift", "tracker_code_task_drift"]) db.prepare("INSERT INTO metric_registry (metric, state) VALUES (?, 'PENDING')").run(m); continue; }
  db.exec(stmt);
}
const prep = (sql) => { let a = []; const st = { bind: (...x) => { a = x.map((v) => (v === undefined ? null : v)); return st; }, run: async () => { const r = db.prepare(sql).run(...a); return { meta: { changes: Number(r.changes) } }; }, first: async () => db.prepare(sql).get(...a) || null, all: async () => ({ results: db.prepare(sql).all(...a) }) }; return st; };
const AUDIT = { prepare: prep, batch: async (l) => { for (const s of l) await s.run(); return []; } };

// Fake GitHub
let gIssues = [], gNext = 5000, gPulls = [], calls = [], listFails = false, listOmissions = new Set(), gComments = [], patchStatus = null, patchLog = [], patchMsg = "limited", patchHdr = undefined, patchFailFor = new Set(), issueGetFailFor = new Set();
const reply = (status, body, headers) => new Response(body === undefined ? "" : JSON.stringify(body), { status, headers });
globalThis.fetch = async (url, init) => {
  const u = new URL(url); const m = (init && init.method) || "GET"; const body = init && init.body ? JSON.parse(init.body) : null;
  calls.push(m + " " + u.pathname);
  const page = Number(u.searchParams.get("page") || 1);
  if (m === "GET" && u.pathname === "/repos/QNFO/qnfo-workers/issues") {
    if (listFails) return reply(502, { message: "bad gateway" });
    const label = u.searchParams.get("labels");
    return reply(200, page > 1 ? [] : gIssues.filter((i) => i.state === "open" && !listOmissions.has(i.number) && (!label || (i.labels || []).includes(label))));
  }
  if (m === "POST" && u.pathname === "/repos/QNFO/qnfo-workers/issues") { const i = { number: gNext++, title: body.title, body: body.body, labels: body.labels, state: "open" }; gIssues.push(i); return reply(201, i); }
  let mm = /^\/repos\/QNFO\/qnfo-workers\/issues\/(\d+)$/.exec(u.pathname);
  if (mm && m === "GET") { if (issueGetFailFor.has(Number(mm[1]))) return reply(403, { message: "Resource not accessible by integration" }); const i = gIssues.find((x) => x.number === Number(mm[1])); return i ? reply(200, i) : reply(404, {}); }
  if (mm && m === "PATCH") { patchLog.push({ n: Number(mm[1]), ...body }); if (patchFailFor.has(Number(mm[1]))) return reply(403, { message: "Resource not accessible by integration" }); if (patchStatus) return reply(patchStatus, { message: patchMsg }, patchHdr); const i = gIssues.find((x) => x.number === Number(mm[1])); i.state = body.state; if (body.state_reason) i.state_reason = body.state_reason; return reply(200, i); }
  mm = /^\/repos\/QNFO\/qnfo-workers\/issues\/(\d+)\/comments$/.exec(u.pathname);
  if (mm) { gComments.push({ n: Number(mm[1]), body: body.body }); return reply(201, { id: 1 }); }
  if (m === "GET" && u.pathname === "/repos/QNFO/qnfo-workers/pulls") return reply(200, page > 1 ? [] : gPulls.filter((p) => !p.hidden));
  mm = /^\/repos\/QNFO\/qnfo-workers\/pulls\/(\d+)$/.exec(u.pathname);
  if (mm) { const p = gPulls.find((x) => x.number === Number(mm[1])); return p ? reply(200, p.merged_at ? { ...p, merged_by: { login: "rwnq8" } } : p) : reply(404, {}); }
  return reply(404, { message: "unmocked " + m + " " + u.pathname });
};
const env = { AUDIT, GITHUB_TOKEN: "t", STEWARD_KEY: "k" };
const tick = async () => { const r = await w.fetch(new Request("https://s.test/tracker/tick", { method: "POST", headers: { "x-steward-key": "k" } }), env); assert.equal(r.status, 200); return (await r.json()).result; };

const now = Date.now();
const ins = db.prepare("INSERT INTO agent_issues (id, title, description, source, category, priority, status, created_at) VALUES (?, ?, ?, ?, ?, 'high', ?, ?)");
ins.run(101, "LEAK-1: token ghp_ABCDEFGHIJKLMNOPQRSTUVWX123 in log", "mail owner@example.com see #12 @someone", "qnfo-ops", "reliability", "open", now - 3600e3);
ins.run(102, "PRIVATE-1: tax", "secret life detail", "personal-api", "personal", "open", now - 3600e3);
ins.run(103, "DONE-1: closed already", "x", "qnfo-ops", "bug", "closed", now - 3600e3);
db.prepare("INSERT INTO code_tasks (id, status, branch, pr_url) VALUES ('ct_a', 'failed', 'codeagent-a', 'https://github.com/QNFO/qnfo-workers/pull/812')").run();
db.prepare("INSERT INTO code_tasks (id, status, branch, pr_url) VALUES ('ct_b', 'merged', 'codeagent-b', 'https://github.com/QNFO/qnfo-workers/pull/813')").run();
db.prepare("INSERT INTO code_tasks (id, status, branch, pr_url) VALUES ('ct_c', 'closed', 'codeagent-c', 'https://github.com/QNFO/qnfo-workers/compare/main...codeagent-c?expand=1')").run();
db.prepare("INSERT INTO code_tasks (id, status, branch, pr_url) VALUES ('ct_d', 'merged', NULL, 'https://github.com/QNFO/qnfo-workers/pull/381')").run();
// TRACKER-REPAIR-ROUND-1: a repair round re-pushed ct_im2924x as -r2, so the first round's PR 901 names a branch no row holds.
db.prepare("INSERT INTO code_tasks (id, status, branch, pr_url) VALUES ('ct_im2924x', 'queued', 'codeagent-im2924x-r2', 'https://github.com/QNFO/qnfo-workers/compare/main...codeagent-im2924x-r2?expand=1')").run();
gPulls = [
  { number: 812, state: "closed", merged_at: "2026-10-08T18:09:05Z", merge_commit_sha: "cced805", head: { ref: "codeagent-a", sha: "s1" } },
  { number: 813, state: "closed", merged_at: null, head: { ref: "codeagent-b", sha: "s2" } },
  { number: 381, state: "closed", merged_at: "2026-10-01T21:37:29Z", head: { ref: "codeagent-readme", sha: "s4" } },
  { number: 900, state: "open", merged_at: null, head: { ref: "codeagent-orphan", sha: "s3" }, updated_at: new Date().toISOString() },
  { number: 901, state: "closed", merged_at: null, head: { ref: "codeagent-im2924x", sha: "s5" }, closed_at: new Date().toISOString() }
];

// Tick 1: mirror open issues, fix the phantom failure, flag the rest.
const r1 = await tick();
assert.equal(r1.mirrored, 2, "the two open issues are mirrored, the closed one is not");
const leak = gIssues.find((i) => i.title.startsWith("[#101]"));
assert.ok(!/ghp_/.test(leak.title + leak.body), "tokens are redacted");
assert.ok(!/owner@example\.com/.test(leak.body), "e-mail addresses are redacted");
assert.ok(leak.body.includes("```text"), "the description is fenced, so mentions and references do not expand");
const priv = gIssues.find((i) => i.title.startsWith("[#102]"));
assert.ok(!/tax|secret life/.test(priv.title + priv.body), "personal issues are mirrored by number only");
assert.equal(db.prepare("SELECT status FROM code_tasks WHERE id='ct_a'").get().status, "merged", "a task whose PR merged is marked merged");
assert.match(db.prepare("SELECT merged_by FROM code_tasks WHERE id='ct_a'").get().merged_by, /^github:rwnq8$/);
const drift = Object.fromEntries(db.prepare("SELECT task_id, drift FROM code_task_pr_links").all().map((x) => [x.task_id, x.drift]));
assert.equal(drift.ct_b, "task-merged-pr-closed", "a task that claims a merge GitHub does not have is drift, not silently rewritten");
assert.equal(drift["pr:900"], "pr-without-task", "a code-loop PR without a task row is drift");
assert.ok(!drift["pr:901"], "an earlier repair round's PR (codeagent-<stem> while the task now holds -r2) is matched by the stem, not drift");
assert.equal(drift["pr:381"], undefined, "a PR matched to a task by number (task has no branch) is not pr-without-task");
assert.equal(drift.ct_d, null, "a merged task whose PR merged is in sync");
assert.equal(drift.ct_c, null, "a compare URL with no PR is recorded as never-opened, not drift");
assert.equal(db.prepare("SELECT pr_state FROM code_task_pr_links WHERE task_id='ct_c'").get().pr_state, "never-opened");
assert.equal(db.prepare("SELECT last_value FROM metric_registry WHERE metric='tracker_code_task_drift'").get().last_value, "2");
assert.equal(db.prepare("SELECT last_value FROM metric_registry WHERE metric='tracker_drift'").get().last_value, "2", "graded once every open issue is mirrored");
assert.equal(db.prepare("SELECT merged_at FROM code_tasks WHERE id='ct_d'").get().merged_at, "2026-10-01T21:37:29Z", "a task already marked merged gets its missing timestamp from the confirmed merged PR");

db.prepare("UPDATE code_tasks SET merged_at = NULL WHERE id='ct_d'").run();
db.prepare("UPDATE code_task_pr_links SET merged_at = '2026-10-01T21:37:29Z' WHERE task_id='ct_d'").run();
db.prepare("INSERT INTO tracker_sync_state (k, v, updated_at) VALUES ('pr_backfill_done', 'yes', ?) ON CONFLICT(k) DO UPDATE SET v='yes'").run(new Date().toISOString());
gPulls.find((p) => p.number === 381).hidden = true;
calls = [];
await tick();
assert.ok(calls.includes("GET /repos/QNFO/qnfo-workers/pulls/381"), "an old settled link with a missing task timestamp is re-read after PR backfill");
assert.equal(db.prepare("SELECT merged_at FROM code_tasks WHERE id='ct_d'").get().merged_at, "2026-10-01T21:37:29Z", "a task outside the recent PR list is repaired from its confirmed PR");
gPulls.find((p) => p.number === 381).hidden = false;

// A stale link to a closed duplicate PR must not mask the task's canonical merged PR after it leaves the recent list window.
db.prepare("INSERT INTO code_tasks (id, status, branch, pr_url, merged_at) VALUES ('ct_linkfix', 'merged', 'codeagent-linkfix', 'https://github.com/QNFO/qnfo-workers/pull/814', '2026-10-01T21:37:29Z')").run();
db.prepare("INSERT INTO code_task_pr_links (task_id, pr_number, pr_state, merged_at, task_status, drift, synced_at) VALUES ('ct_linkfix', 815, 'closed', NULL, 'merged', 'task-merged-pr-closed', '2026-10-01T21:37:29Z')").run();
gPulls.push(
  { number: 814, state: "closed", merged_at: "2026-10-01T21:37:29Z", merge_commit_sha: "canonical-sha", head: { ref: "codeagent-linkfix", sha: "canonical-head" }, hidden: true },
  { number: 815, state: "closed", merged_at: null, head: { ref: "codeagent-linkfix", sha: "duplicate-head" } }
);
calls = [];
await tick();
assert.ok(calls.includes("GET /repos/QNFO/qnfo-workers/pulls/814"), "a stale duplicate link does not suppress reading the canonical PR");
assert.equal(db.prepare("SELECT pr_number FROM code_task_pr_links WHERE task_id='ct_linkfix'").get().pr_number, 814, "the task link follows its canonical PR URL");
assert.equal(db.prepare("SELECT drift FROM code_task_pr_links WHERE task_id='ct_linkfix'").get().drift, null, "the stale duplicate-PR drift clears after canonical verification");
gPulls = gPulls.filter((p) => p.number !== 814 && p.number !== 815);

// Tick 2: idempotent.
calls = [];
const r2 = await tick();
assert.equal(r2.mirrored, 0, "nothing is filed twice");
assert.ok(!calls.some((c) => c.startsWith("POST /repos/QNFO/qnfo-workers/issues") && !c.endsWith("/comments")), "no create on a converged tick");
const synced = db.prepare("SELECT max(synced_at) m FROM code_task_pr_links").get().m;
await tick();
assert.equal(db.prepare("SELECT max(synced_at) m FROM code_task_pr_links").get().m, synced, "unchanged links are not rewritten every tick");

// D1 closes with evidence -> GitHub closes; a hand close on GitHub of a D1-open issue is reopened.
db.prepare("UPDATE agent_issues SET status='resolved', close_channel='evidence' WHERE id=101").run();
db.prepare("INSERT INTO issue_triage (issue_id, close_evidence) VALUES (101, 'probe passed 2026-10-18')").run();
priv.state = "closed";
const r3 = await tick();
assert.equal(r3.closed, 1); assert.equal(r3.reopened, 1);
assert.equal(leak.state, "closed", "closed in D1 -> closed on GitHub");
assert.equal(priv.state, "open", "D1 is authoritative: a hand close is reopened");
assert.equal(db.prepare("SELECT status FROM agent_issues WHERE id=102").get().status, "open", "GitHub never closes a D1 issue");

// A new D1 issue whose "[#id]" title already exists on GitHub is linked, not re-filed.
ins.run(104, "RELINK-1", "x", "qnfo-ops", "bug", "open", now);
gIssues.push({ number: 4999, title: "[#104] RELINK-1", labels: ["fleet-issue"], state: "open" });
const r4 = await tick();
assert.equal(r4.relinked, 1); assert.equal(r4.mirrored, 0);
assert.equal(db.prepare("SELECT gh_number FROM gh_issue_links WHERE issue_id=104").get().gh_number, 4999);

// A failed list is never read as "everything is closed".
listFails = true;
const before = JSON.stringify(gIssues);
const r5 = await tick();
assert.ok(r5.errors.some((e) => e.scope === "tracker-issues"));
assert.equal(JSON.stringify(gIssues), before, "no issue state changes on a failed read");
listFails = false;

// After the backfill only the newest 2 PR pages are read. A repository with more than 200 PRs fills both, and that window
// is valid (live 2026-10-18 10:03Z: every post-backfill tick refused it as a partial list).
const filler = Array.from({ length: 250 }, (_, i) => ({ number: 2000 + i, state: "closed", merged_at: null, head: { ref: "human-" + i, sha: "f" + i }, updated_at: new Date().toISOString() }));
const allPulls = gPulls.concat(filler);
const pullsHandler = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = new URL(url);
  if (((init && init.method) || "GET") === "GET" && u.pathname === "/repos/QNFO/qnfo-workers/pulls") {
    const page = Number(u.searchParams.get("page") || 1);
    return new Response(JSON.stringify(allPulls.slice((page - 1) * 100, page * 100)), { status: 200 });
  }
  return pullsHandler(url, init);
};
const r6 = await tick();
assert.ok(!r6.errors.some((e) => e.scope === "tracker-prs"), "a full 2-page recent window is not a failed read");
globalThis.fetch = pullsHandler;

// A stale pr-without-task row (written by an older version) is cleared once a task points at that PR.
db.prepare("INSERT OR REPLACE INTO code_task_pr_links (task_id, pr_number, pr_state, drift) VALUES ('pr:381', 381, 'merged', 'pr-without-task')").run();
await tick();
assert.equal(db.prepare("SELECT drift FROM code_task_pr_links WHERE task_id='pr:381'").get().drift, null, "a stale pr-without-task row is cleared");

// ---- TRACKER-DRAIN-1 (qnfo-github-steward 0.5.0) ----
// Everything above ran before the companion migration applied (head_ref, task_ref, gh_close_reason and v_tracker_drift.age_min do
// not exist yet): the worker works either side of it. Apply it now.
assert.ok(Number(VERSION[1]) > 0 || Number(VERSION[2]) >= 5, "VERSION at or above 0.5 (minimum, not a pin)");
const migPath = join(here, "..", "migrations", "2026-10-19-tracker-drift-age.sql");
const mig2 = readFileSync(migPath, "utf8");
for (const stmt of mig2.split(/;\s*\n/).map((s) => s.replace(/^\s*--.*$/gm, "").trim()).filter(Boolean)) {
  if (/^INSERT OR IGNORE INTO (analytics_metric_triggers|control_registry|failure_modes|remediation_contracts|capability_ledger)/.test(stmt)) continue;
  if (/^INSERT OR IGNORE INTO metric_registry/.test(stmt)) { db.prepare("INSERT INTO metric_registry (metric, state) VALUES ('tracker_drift_oldest_min', 'PENDING')").run(); continue; }
  db.exec(stmt);
}
assert.equal(db.prepare("SELECT count(*) c FROM bak_20261019_v_tracker_drift").get().c, 1, "the migration keeps the old view text before it drops it");

// One status mapping: the view's open set and the worker's TS_STATUS_OPEN list the same statuses.
const wsrc = readFileSync(join(here, "worker.js"), "utf8");
const jsOpen = Array.from(/var TS_STATUS_OPEN = \{([^}]*)\}/.exec(wsrc)[1].matchAll(/(\w+):/g), (x) => x[1]).sort();
const sqlOpen = Array.from(/a\.status IN \(([^)]*)\)\) <> /.exec(mig2)[1].matchAll(/'(\w+)'/g), (x) => x[1]).sort();
assert.deepEqual(sqlOpen, jsOpen, "v_tracker_drift and the steward agree which statuses are open on GitHub");
assert.deepEqual(jsOpen, ["open"], "only open is open on GitHub; monitoring is not");

const rollupMig = readFileSync(join(here, "..", "migrations", "2026-11-02-tracker-rollup-drift.sql"), "utf8");
for (const stmt of rollupMig.split(/;\s*\n/).map((s) => s.replace(/^\s*--.*$/gm, "").trim()).filter(Boolean)) db.exec(stmt);
assert.equal(db.prepare("SELECT count(*) c FROM bak_20261102_v_tracker_drift_rollup").get().c, 1, "the replacement view is backed up");

const ghIssue = (n, title, state = "open", labels = ["fleet-issue"]) => { const i = { number: n, title, labels, state }; gIssues.push(i); return i; };
const mkIssue = (id, status, agoMs, title, evidence) => {
  ins.run(id, title || "DRAIN-" + id, "x", "qnfo-ops", "bug", status, now - agoMs);
  db.prepare("UPDATE agent_issues SET updated_at = ? WHERE id = ?").run(now - agoMs, id);
  if (evidence) db.prepare("INSERT INTO issue_triage (issue_id, close_evidence) VALUES (?, ?)").run(id, evidence);
};
const mkLink = (id, ghState, reason, d1) => db.prepare("INSERT INTO gh_issue_links (issue_id, gh_number, gh_state, d1_status, synced_at, gh_close_reason) VALUES (?, ?, ?, ?, 'x', ?)").run(id, 6000 + id, ghState, d1 || 'open', reason || null);
const patches = (pred) => patchLog.filter(pred);

// 1. Status mapping. A monitoring card is closed not_planned naming its live twin, never "completed" with "(none recorded)".
mkIssue(5000, "open", 3600e3, "TWIN-X: parked twin"); ghIssue(6000 + 5000, "[#5000] TWIN-X", "open"); mkLink(5000, "open");
mkIssue(5001, "monitoring", 3600e3, " twin-x: PARKED twin "); ghIssue(6000 + 5001, "[#5001] TWIN-X", "open"); mkLink(5001, "open");
mkIssue(5010, "resolved", 3600e3, "NOEV-1"); ghIssue(6000 + 5010, "[#5010] NOEV-1", "open"); mkLink(5010, "open");
mkIssue(5011, "wontfix", 3600e3, "WONTFIX-1"); ghIssue(6000 + 5011, "[#5011] WONTFIX-1", "open"); mkLink(5011, "open");
mkIssue(5012, "resolved", 3600e3, "EV-1", "probe passed 2026-10-19"); ghIssue(6000 + 5012, "[#5012] EV-1", "open"); mkLink(5012, "open");
// a monitoring card an older version closed as completed: corrected once
mkIssue(5020, "monitoring", 3600e3, "OLD-MON"); const oldMon = ghIssue(6000 + 5020, "[#5020] OLD-MON", "closed"); oldMon.state_reason = "completed"; mkLink(5020, "closed");
mkIssue(5021, "monitoring", 3600e3, "DONE-MON"); ghIssue(6000 + 5021, "[#5021] DONE-MON", "closed"); mkLink(5021, "closed", "not_planned");
patchLog = []; gComments = [];
const rm = await tick();
const monPatch = patches((p) => p.n === 6000 + 5001);
assert.equal(monPatch.length, 1); assert.equal(monPatch[0].state, "closed"); assert.equal(monPatch[0].state_reason, "not_planned", "monitoring closes as not planned, not completed");
const monNote = gComments.find((c) => c.n === 6000 + 5001).body;
assert.match(monNote, /monitoring/); assert.match(monNote, new RegExp("#" + (6000 + 5000) + "\\b"), "the comment names the live twin"); assert.ok(!/Close evidence|none recorded/.test(monNote), "no evidence is claimed for monitoring");
assert.equal(patches((p) => p.n === 6000 + 5000).length, 0, "the open twin is untouched");
assert.equal(patches((p) => p.n === 6000 + 5010)[0].state_reason, "completed");
assert.ok(!gComments.some((c) => c.n === 6000 + 5010), "a close with no close_evidence posts no \"Closed in qnfo-audit ... (none recorded)\" comment");
assert.equal(patches((p) => p.n === 6000 + 5011)[0].state_reason, "not_planned", "wontfix closes not planned");
assert.match(gComments.find((c) => c.n === 6000 + 5012).body, /Close evidence[\s\S]*probe passed 2026-10-19/, "a close with evidence quotes it");
assert.equal(db.prepare("SELECT gh_close_reason r FROM gh_issue_links WHERE issue_id=5001").get().r, "not_planned");
const recl = patches((p) => p.n === 6000 + 5020);
assert.equal(recl.length, 1); assert.equal(recl[0].state_reason, "not_planned", "an old completed close of a monitoring card is corrected");
assert.match(gComments.find((c) => c.n === 6000 + 5020).body, /Corrected/);
assert.equal(db.prepare("SELECT gh_close_reason r FROM gh_issue_links WHERE issue_id=5020").get().r, "not_planned");
assert.equal(patches((p) => p.n === 6000 + 5021).length, 0, "a card already corrected is not touched again");
assert.equal(rm.reclassified, 1);
patchLog = []; gComments = [];
await tick();
assert.equal(patchLog.length, 0, "the corrected and closed cards are not rewritten on the next tick");
assert.equal(db.prepare("SELECT d1_status s FROM gh_issue_links WHERE issue_id=5001").get().s, "monitoring", "d1_status is refreshed, not a stale first snapshot");

// 2. The age of drift is measured, not hidden: the count is ungraced, age_min says how long.
mkIssue(5100, "closed", 25 * 60e3, "AGE-25"); ghIssue(6000 + 5100, "[#5100] AGE-25", "open"); mkLink(5100, "open");
mkIssue(5101, "closed", 5 * 60e3, "AGE-5"); ghIssue(6000 + 5101, "[#5101] AGE-5", "open"); mkLink(5101, "open");
const ages = Object.fromEntries(db.prepare("SELECT ref, age_min FROM v_tracker_drift WHERE kind='issue-state'").all().map((x) => [x.ref, x.age_min]));
assert.ok(ages["5101"] >= 4 && ages["5101"] <= 6, "a 5 minute old disagreement is in the view (no grace window) with its age: " + ages["5101"]);
assert.ok(ages["5100"] >= 24 && ages["5100"] <= 26, "a 25 minute old one reads 25: " + ages["5100"]);
await tick();
assert.equal(db.prepare("SELECT count(*) c FROM v_tracker_drift WHERE kind='issue-state'").get().c, 0, "both are fixed by the next tick");

// 3. A burst of D1 closes (150, over half of all links) drains oldest D1 change first, in budgeted slices, a reopen first.
for (let i = 0; i < 150; i++) { mkIssue(2000 + i, "closed", 3600e3 + i * 1000, "BURST-" + i); ghIssue(6000 + 2000 + i, "[#" + (2000 + i) + "] BURST", "open"); mkLink(2000 + i, "open"); }
mkIssue(2200, "open", 0, "REOPEN-NEWEST"); ghIssue(6000 + 2200, "[#2200] REOPEN", "closed"); mkLink(2200, "closed");
const totalLinks = db.prepare("SELECT count(*) c FROM gh_issue_links").get().c;
assert.ok(150 > totalLinks / 2, "the burst is over half of all links (the old guard refused this for good)");
patchLog = [];
const b1 = await tick();
assert.ok(!b1.errors.some((e) => /mass state flip/.test(e.why || "")), "a burst of recent D1 changes is explained, not refused");
assert.equal(b1.state_sync.tried, 40, "a tick is capped at TS_FIX_MAX attempts");
assert.equal(b1.state_sync.fixed, 40); assert.equal(b1.state_sync.carried, 111, "the rest is carried to the next tick and reported");
assert.ok(b1.state_sync.oldest_min >= 60, "the oldest waiting change is reported: " + b1.state_sync.oldest_min);
assert.equal(patchLog[0].n, 6000 + 2200, "the phantom (D1 open, GitHub closed) goes first");
assert.equal(patchLog[0].state, "open");
const closedFirst = patchLog.slice(1).map((p) => p.n - 6000 - 2000);
assert.equal(closedFirst[0], 149, "then the oldest D1 change first");
assert.deepEqual(closedFirst.slice().sort((a, c) => c - a), closedFirst, "in age order");
assert.ok(closedFirst.every((n) => n >= 111), "tick 1 closed exactly the 39 oldest closes: " + closedFirst.join(","));
assert.ok(Number(db.prepare("SELECT last_value v FROM metric_registry WHERE metric='tracker_drift_oldest_min'").get().v) >= 60, "metric tracker_drift_oldest_min carries the age");
let tickN = 1;
while (db.prepare("SELECT count(*) c FROM v_tracker_drift WHERE kind='issue-state'").get().c > 0 && tickN < 8) { await tick(); tickN++; }
assert.equal(db.prepare("SELECT count(*) c FROM v_tracker_drift WHERE kind='issue-state'").get().c, 0);
assert.ok(tickN <= 5, "151 mismatches drain in four ticks: " + tickN);
await tick();
assert.equal(Number(db.prepare("SELECT last_value v FROM metric_registry WHERE metric='tracker_drift_oldest_min'").get().v) < 5, true, "the age metric returns to ~0 once drained");

// 3b. A task/PR contradiction the steward cannot clear (code-task-pr) keeps ageing but is not this loop's backlog: it must not
// push tracker_drift_oldest_min past its target (it is counted by tracker_code_task_drift).
db.prepare("INSERT OR REPLACE INTO code_task_pr_links (task_id, pr_number, pr_state, drift, synced_at) VALUES ('ct_stuck_contradiction', 2568, 'open', 'pr-open-task-failed', ?)").run(new Date(Date.now() - 5 * 3600e3).toISOString());
await tick();
const stuck = db.prepare("SELECT age_min FROM v_tracker_drift WHERE kind='code-task-pr' AND ref='ct_stuck_contradiction'").get();
assert.ok(stuck && stuck.age_min >= 240, "the contradiction row survives the tick and is old: " + (stuck && stuck.age_min));
assert.ok(Number(db.prepare("SELECT last_value v FROM metric_registry WHERE metric='tracker_drift_oldest_min'").get().v) < 5, "a code-task-pr row does not age tracker_drift_oldest_min");
db.prepare("DELETE FROM code_task_pr_links WHERE task_id='ct_stuck_contradiction'").run();

// 4. When a majority mismatch could be a list anomaly, direct issue reads distinguish omissions from hand state changes.
const L = db.prepare("SELECT count(*) c FROM gh_issue_links").get().c;
// 4a. A partial response omits genuinely open issues. Direct reads confirm their state and prevent false closes.
for (let i = 0; i < L + 5; i++) { mkIssue(3000 + i, "open", 60e3, "OMITTED-" + i); const issue = ghIssue(6000 + 3000 + i, "[#" + (3000 + i) + "] R", "open"); listOmissions.add(issue.number); mkLink(3000 + i, "open", null, "open"); }
patchLog = []; gComments = []; calls = [];
const g1 = await tick();
assert.ok(g1.errors.some((e) => e.scope === "tracker-issues" && /verifying each linked issue/.test(e.why)), "the mass-mismatch guard requires individual reads");
assert.ok(calls.some((c) => c === "GET /repos/QNFO/qnfo-workers/issues/" + (6000 + 3000)), "an omitted issue is read by number");
assert.equal(patchLog.length, 0, "and nothing is flipped"); assert.equal(gComments.length, 0, "and nothing is commented");
listOmissions.clear();
// 4b. GitHub hand-closed many issues while D1 stayed closed: confirmed mismatches are repaired from the authoritative D1 state.
const L4b = db.prepare("SELECT count(*) c FROM gh_issue_links").get().c;
for (let i = 0; i < L4b + 5; i++) { mkIssue(3500 + i, "closed", 3 * 86400e3, "OLDQUIET-" + i); ghIssue(6000 + 3500 + i, "[#" + (3500 + i) + "] Q", "open"); mkLink(3500 + i, "open", null, "closed"); }
patchLog = [];
const g1b = await tick();
assert.ok(!g1b.errors.some((e) => /refusing a mass state flip/.test(e.why || "")), "verified changes are not blocked by the old mass-flip refusal");
assert.ok(g1b.state_sync.tried <= 40, "verified state repairs stay inside the per-tick attempt cap");
assert.equal(g1b.state_sync.fixed, g1b.state_sync.tried);
for (let i = 0; i < 20 && db.prepare("SELECT count(*) c FROM v_tracker_drift WHERE kind='issue-state'").get().c > 0; i++) await tick();
assert.equal(db.prepare("SELECT count(*) c FROM v_tracker_drift WHERE kind='issue-state'").get().c, 0, "all confirmed GitHub hand state changes drain over budgeted ticks");
// 4c. A refused direct read cannot change GitHub or the link record; the issue is retried once readable.
const failId = 12000, L4c = db.prepare("SELECT count(*) c FROM gh_issue_links").get().c;
for (let i = 0; i < L4c + 5; i++) {
  const id = failId + i;
  mkIssue(id, "closed", 4 * 86400e3, "VERIFY-FAIL-" + id); const issue = ghIssue(6000 + id, "[#" + id + "] VERIFY-FAIL-" + id, "open"); mkLink(id, "open", null, "closed");
  issueGetFailFor.add(issue.number);
}
patchLog = [];
const g1c = await tick();
assert.ok(g1c.errors.some((e) => e.scope === "tracker-issue-state-check " + failId && e.status === 403), "the direct-read refusal is recorded");
assert.equal(patchLog.length, 0, "failed direct reads cause no state mutations");
assert.equal(db.prepare("SELECT gh_state FROM gh_issue_links WHERE issue_id=?").get(failId).gh_state, "open", "the link remains unchanged for retry");
issueGetFailFor.clear();
await tick();
assert.equal(gIssues.find((i) => i.number === 6000 + failId).state, "closed", "D1 state is applied after the direct read succeeds");
for (let i = 0; i < 40 && db.prepare("SELECT count(*) c FROM v_tracker_drift WHERE kind='issue-state'").get().c > 0; i++) await tick();
assert.equal(db.prepare("SELECT count(*) c FROM v_tracker_drift WHERE kind='issue-state'").get().c, 0, "the verified retry batch drains");
db.prepare("DELETE FROM agent_issues WHERE id >= 12000").run(); db.prepare("DELETE FROM gh_issue_links WHERE issue_id >= 12000").run();
gIssues = gIssues.filter((i) => i.number < 6000 + failId || i.number >= 6000 + failId + L4c + 5);
db.prepare("DELETE FROM agent_issues WHERE id >= 3000 AND id < 4000").run(); db.prepare("DELETE FROM gh_issue_links WHERE issue_id >= 3000 AND issue_id < 4000").run();
gIssues = gIssues.filter((i) => !(i.number >= 9000 && i.number < 10000));

// 4d. An unlabelled open mirror is still visible to state sync and is reconciled from D1.
mkIssue(13000, "closed", 60e3, "UNLABELLED-MIRROR"); const unlabelled = ghIssue(6000 + 13000, "[#13000] UNLABELLED-MIRROR", "open", []); mkLink(13000, "open", null, "open");
patchLog = [];
await tick();
assert.equal(unlabelled.state, "closed", "an open issue does not disappear from state sync when its mirror label is removed");
assert.equal(patches((p) => p.n === 6000 + 13000)[0].state_reason, "completed");
assert.equal(db.prepare("SELECT gh_state FROM gh_issue_links WHERE issue_id=13000").get().gh_state, "closed");

// 5. Stop on 403/429: no further write after the first refusal.
for (let i = 0; i < 15; i++) { mkIssue(4000 + i, "closed", 3600e3 + i, "RL-" + i); ghIssue(6000 + 4000 + i, "[#" + (4000 + i) + "] RL", "open"); mkLink(4000 + i, "open"); }
patchLog = []; patchStatus = 429;
const rl = await tick();
assert.equal(patchLog.length, 1, "one refused write and the loop stops");
assert.equal(rl.state_sync.rate_limited, 429);
assert.equal(db.prepare("SELECT count(*) c FROM v_tracker_drift WHERE kind='issue-state'").get().c, 15, "nothing is recorded as fixed");
patchStatus = null;
await tick();
assert.equal(db.prepare("SELECT count(*) c FROM v_tracker_drift WHERE kind='issue-state'").get().c, 0, "the next tick completes them");

// 6. ISSUE-SYNC-FORWARD-1: a resolved Cloudflare Observability dispatch row closes its GitHub issue; a recurrence reopens it.
const fd = db.prepare("INSERT INTO fleet_issue_dispatch (fingerprint, category, sev, owner, payload, gh_number, state, exec_state, exec_ts) VALUES (?, ?, 'warn', 'fleet', ?, ?, ?, ?, ?)");
const pj = (id) => JSON.stringify({ id, status: "resolved", lastObserved: Date.now() - 3600e3 });
fd.run("cf-obs-aaa", "worker-observability", pj("aaa"), "7001", "resolved", "created", "2026-10-18T10:00:00Z"); ghIssue(7001, "[fleet] svc · worker-observability", "open", []);
fd.run("cf-obs-bbb", "worker-observability", pj("bbb"), "7002", "resolved", "created", "2026-10-18T10:00:00Z"); ghIssue(7002, "[fleet] svc2 · worker-observability", "closed", []);
fd.run("cf-obs-ccc", "worker-observability", pj("ccc"), "7003", "tracked", "created", "2026-10-18T10:00:00Z"); ghIssue(7003, "[fleet] svc3 · worker-observability", "open", []);
fd.run("cf-obs-ddd", "worker-observability", pj("ddd"), "7004", "resolved", "closed", "2026-10-18T10:00:00Z"); ghIssue(7004, "[fleet] svc4 · worker-observability", "closed", []);
fd.run("other-eee", "integration-chain", pj("eee"), "7005", "resolved", "created", "2026-10-18T10:00:00Z"); ghIssue(7005, "[fleet] svc5 · integration-chain", "open", []);
patchLog = []; gComments = [];
const f1 = await tick();
const exec = (fp) => ({ ...db.prepare("SELECT state, exec_state FROM fleet_issue_dispatch WHERE fingerprint=?").get(fp) });
assert.equal(gIssues.find((i) => i.number === 7001).state, "closed", "a resolved group's GitHub issue is closed");
assert.equal(gIssues.find((i) => i.number === 7001).state_reason, "completed");
assert.match(gComments.find((c) => c.n === 7001).body, /cf-obs-aaa/, "the comment names the dispatch row");
assert.equal(exec("cf-obs-aaa").exec_state, "closed-by-sync");
assert.equal(exec("cf-obs-bbb").exec_state, "closed-by-sync", "an issue already closed by hand is recorded too");
assert.equal(patches((p) => p.n === 7002).length, 0, "and not written");
assert.equal(exec("cf-obs-ccc").exec_state, "created", "a tracked group is not closed");
assert.equal(gIssues.find((i) => i.number === 7003).state, "open");
assert.equal(exec("cf-obs-ddd").exec_state, "closed"); assert.equal(gIssues.find((i) => i.number === 7005).state, "open", "only worker-observability rows are closed");
assert.deepEqual([f1.dispatch_sync_forward.closed, f1.dispatch_sync_forward.already_closed], [1, 1]);
calls = [];
await tick();
assert.ok(!calls.some((c) => /issues\/7001$|issues\/7002$/.test(c)), "a closed-by-sync row is not read again");
// recurrence: pollObservability sets state tracked again and leaves exec_state alone. Forward runs BEFORE reverse, so the
// reverse leg does not read the closed issue and flip the row to done.
db.prepare("UPDATE fleet_issue_dispatch SET state='tracked' WHERE fingerprint='cf-obs-aaa'").run();
const f2 = await tick();
assert.equal(gIssues.find((i) => i.number === 7001).state, "open", "a recurrence reopens the issue");
assert.deepEqual(exec("cf-obs-aaa"), { state: "tracked", exec_state: "created" }, "and the row stays tracked (the reverse leg did not swallow it)");
assert.equal(f2.dispatch_sync_forward.reopened, 1);
// a reopen that fails leaves the row closed-by-sync and tracked: the reverse leg skips it, nothing is silently dropped
db.prepare("UPDATE fleet_issue_dispatch SET state='resolved' WHERE fingerprint='cf-obs-aaa'").run();
await tick();
assert.equal(exec("cf-obs-aaa").exec_state, "closed-by-sync");
db.prepare("UPDATE fleet_issue_dispatch SET state='tracked' WHERE fingerprint='cf-obs-aaa'").run();
patchStatus = 500;
const f3 = await tick();
assert.deepEqual(exec("cf-obs-aaa"), { state: "tracked", exec_state: "closed-by-sync" }, "a failed reopen is retried, not flipped to done");
assert.ok(f3.errors.some((e) => /issue-sync-forward-reopen/.test(e.scope)));
patchStatus = null;
await tick();
assert.deepEqual(exec("cf-obs-aaa"), { state: "tracked", exec_state: "created" });
assert.equal(gIssues.find((i) => i.number === 7001).state, "open");

// 7. Superseded attempt PRs outside the recent window are matched by stem once and recorded as attempts of their task.
db.prepare("INSERT INTO code_tasks (id, status, branch, pr_url) VALUES ('ct_yhjw5pnqkdnbep', 'queued', 'codeagent-yhjw5pnqkdnb-r3', 'https://github.com/QNFO/qnfo-workers/compare/main...x?expand=1')").run();
const olderIso = new Date(Date.now() - 5 * 86400e3).toISOString();
gPulls.push({ number: 1413, state: "closed", merged_at: null, closed_at: olderIso, hidden: true, head: { ref: "codeagent-yhjw5pnqkdnb", sha: "a1" } });
gPulls.push({ number: 1414, state: "closed", merged_at: null, closed_at: olderIso, hidden: true, head: { ref: "codeagent-yhjw5pnqkdnb-r2", sha: "a2" } });
gPulls.push({ number: 1500, state: "closed", merged_at: null, closed_at: olderIso, hidden: true, head: { ref: "codeagent-nomatch1", sha: "a3" } });
gPulls.push({ number: 1600, state: "closed", merged_at: null, closed_at: olderIso, hidden: true, head: { ref: "human-branch", sha: "a4" } });
const oldIso = new Date(Date.now() - 40 * 86400e3).toISOString();
const dr = db.prepare("INSERT OR REPLACE INTO code_task_pr_links (task_id, pr_number, pr_state, drift, synced_at) VALUES (?, ?, ?, 'pr-without-task', ?)");
dr.run("pr:1413", 1413, "closed", "2026-10-18T09:43:00Z"); dr.run("pr:1414", 1414, "closed", "2026-10-18T09:43:00Z");
dr.run("pr:1500", 1500, "closed", "2026-10-18T09:43:00Z"); dr.run("pr:1600", 1600, "closed", "2026-10-18T09:43:00Z");
dr.run("pr:77", 77, "closed", oldIso);
calls = [];
const a1 = await tick();
const link = (id) => ({ ...db.prepare("SELECT drift, head_ref, task_ref FROM code_task_pr_links WHERE task_id=?").get(id) });
assert.deepEqual(link("pr:1413"), { drift: null, head_ref: "codeagent-yhjw5pnqkdnb", task_ref: "ct_yhjw5pnqkdnbep" }, "an earlier attempt is matched to its task by the branch stem");
assert.deepEqual(link("pr:1414"), { drift: null, head_ref: "codeagent-yhjw5pnqkdnb-r2", task_ref: "ct_yhjw5pnqkdnbep" }, "-r2 too");
assert.deepEqual(link("pr:1500"), { drift: "pr-without-task", head_ref: "codeagent-nomatch1", task_ref: null }, "a PR no task matches is still drift");
assert.equal(link("pr:1600").drift, null, "a non-codeagent PR is not code-loop drift"); assert.equal(link("pr:1600").head_ref, "human-branch");
assert.equal(link("pr:77").drift, null, "a closed-unmerged row more than 30 days old is cleared");
assert.deepEqual(link("pr:901"), { drift: null, head_ref: "codeagent-im2924x", task_ref: "ct_im2924x" }, "an in-window attempt records its task too");
assert.equal(calls.filter((c) => c === "GET /repos/QNFO/qnfo-workers/pulls/1413").length, 1, "read once");
calls = [];
await tick();
assert.ok(!calls.some((c) => /pulls\/(1413|1414|1500|1600)$/.test(c)), "a row with a head_ref is not read again");
assert.equal(db.prepare("SELECT count(*) c FROM code_task_pr_links c WHERE c.task_id LIKE 'pr:%' AND c.drift = 'pr-without-task' AND c.head_ref LIKE 'codeagent-%' AND EXISTS (SELECT 1 FROM code_tasks t WHERE substr(t.id, 4, 12) = substr(c.head_ref, 11, 12))").get().c, 0, "fm-pr-attempt-unlinked detector reads 0");

// 8. A 403 is a rate limit only when GitHub says so (429, a secondary-limit/abuse message, Retry-After, x-ratelimit-remaining 0).
// A per-issue 403 (locked, forbidden) is recorded and skipped; it must not stall the oldest-first queue. A real limit stops EVERY
// later stage of the tick (one shared flag on the tick result), not only the loop that saw it.
const inR = (lo) => (p) => p.n >= 6000 + lo && p.n < 6000 + lo + 100;
for (let i = 0; i < 12; i++) { mkIssue(4100 + i, "closed", 3600e3 + i * 1000, "F403-" + i); ghIssue(6000 + 4100 + i, "[#" + (4100 + i) + "] F", "open"); mkLink(4100 + i, "open"); }
patchFailFor = new Set([6000 + 4111]); patchLog = [];
const p1 = await tick();
assert.equal(patchLog.filter(inR(4100)).length, 12, "a per-issue 403 at the head of the queue does not stop the other eleven");
assert.equal(p1.state_sync.fixed, 11); assert.equal(p1.state_sync.rate_limited, null, "a per-issue 403 is not a rate limit");
assert.ok(!p1.rate_limited, "and the tick result does not carry the flag");
assert.ok(p1.errors.some((e) => e.scope === "tracker-issue 4111" && e.status === 403), "the refusal is recorded");
patchFailFor = new Set(); await tick();
assert.equal(db.prepare("SELECT count(*) c FROM v_tracker_drift WHERE kind='issue-state'").get().c, 0, "it completes once GitHub allows it");

for (let i = 0; i < 5; i++) { mkIssue(4200 + i, "closed", 3600e3 + i * 1000, "SEC-" + i); ghIssue(6000 + 4200 + i, "[#" + (4200 + i) + "] S", "open"); mkLink(4200 + i, "open"); }
fd.run("cf-obs-rlr", "worker-observability", pj("rlr"), "7100", "resolved", "created", "2026-10-18T10:00:00Z"); ghIssue(7100, "[fleet] svcR · worker-observability", "open", []);
fd.run("cf-obs-rlq", "worker-observability", pj("rlq"), "", "queued", null, null);
patchStatus = 403; patchMsg = "You have exceeded a secondary rate limit. Please wait a few minutes before you try again."; patchLog = []; calls = [];
const p2 = await tick();
assert.equal(patchLog.filter(inR(4200)).length, 1, "a secondary-limit 403 stops the loop at the first refusal");
assert.equal(p2.state_sync.rate_limited, 403); assert.equal(p2.rate_limited, 403, "one flag on the tick result");
assert.ok(!calls.some((c) => c === "GET /repos/QNFO/qnfo-workers/issues/7100"), "the forward leg makes no call after the limit");
assert.ok(!calls.some((c) => c === "POST /repos/QNFO/qnfo-workers/issues"), "the dispatch mirror creates nothing after the limit");
assert.ok(!calls.some((c) => /\/pulls/.test(c)), "the PR sync makes no call after the limit");
patchStatus = null; patchMsg = "limited"; calls = [];
const p3 = await tick();
assert.ok(!p3.rate_limited);
assert.equal(gIssues.find((i) => i.number === 7100).state, "closed", "the next tick runs every stage again");
assert.equal(db.prepare("SELECT count(*) c FROM v_tracker_drift WHERE kind='issue-state'").get().c, 0);

mkIssue(4300, "closed", 3600e3, "RA-1"); ghIssue(6000 + 4300, "[#4300] RA", "open"); mkLink(4300, "open");
patchStatus = 403; patchMsg = "Forbidden"; patchHdr = { "retry-after": "60" }; patchLog = [];
const p4 = await tick();
assert.equal(p4.rate_limited, 403, "a 403 with Retry-After is a rate limit");
patchStatus = null; patchMsg = "limited"; patchHdr = undefined;
await tick();

// 9. The subrequest budget counts D1 calls too: a monitoring close is 2 GitHub calls and 2 D1 calls (twin lookup, link update).
for (let i = 0; i < 60; i++) { mkIssue(4400 + i, "monitoring", 3600e3 + i * 1000, "MONB-" + i); ghIssue(6000 + 4400 + i, "[#" + (4400 + i) + "] M", "open"); mkLink(4400 + i, "open"); }
const bm = await tick();
assert.ok(bm.state_sync.tried >= 10 && bm.state_sync.tried <= 30, "GitHub and D1 calls share the 110 budget: " + bm.state_sync.tried + " attempts");
for (let n = 0; n < 6 && db.prepare("SELECT count(*) c FROM v_tracker_drift WHERE kind='issue-state'").get().c > 0; n++) await tick();
assert.equal(db.prepare("SELECT count(*) c FROM v_tracker_drift WHERE kind='issue-state'").get().c, 0);

// 10. A reclass that GitHub refuses is memoised as kept:<status> and must stay visible to the fm-monitoring-closed-completed detector.
const probeSql = (key) => { const m = new RegExp("\\('" + key + "', NULL, '(?:[^']|'')*', '(?:[^']|'')*', '((?:[^']|'')*)', 'd1-query'").exec(mig2); assert.ok(m, "probe of " + key + " found in the migration"); return m[1].replace(/''/g, "'"); };
const kProbe = probeSql("fm-monitoring-closed-completed");
const observed = () => Number(db.prepare(kProbe).get().observed);
const before10 = observed();
mkIssue(5030, "monitoring", 3600e3, "KEPT-MON"); const keptGh = ghIssue(6000 + 5030, "[#5030] KEPT", "closed"); keptGh.state_reason = "completed"; mkLink(5030, "closed");
patchStatus = 500; await tick(); patchStatus = null;
assert.equal(db.prepare("SELECT gh_close_reason r FROM gh_issue_links WHERE issue_id=5030").get().r, "kept:500", "a refused reclass is memoised");
assert.equal(observed(), before10 + 1, "the detector counts the kept:* row, which is still closed as completed on GitHub");
db.prepare("DELETE FROM gh_issue_links WHERE issue_id=5030").run(); db.prepare("DELETE FROM agent_issues WHERE id=5030").run();

// 11. The Rollback header is executable SQL: run it against the migrated schema and the previous 3-column view comes back.
const rbLine = /^-- Rollback:\s*(.+)$/m.exec(mig2)[1];
const rbStmts = rbLine.split(";").map((x) => x.trim()).filter(Boolean);
assert.ok(rbStmts.length >= 5 && rbStmts.every((x) => /^(DROP|CREATE|UPDATE|DELETE|ALTER)\b/i.test(x)), "every Rollback statement starts with an SQL verb, no prose: " + rbStmts.filter((x) => !/^(DROP|CREATE|UPDATE|DELETE|ALTER)\b/i.test(x)).join(" | "));
const rb = new DatabaseSync(":memory:");
for (const r of db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name IN ('agent_issues','gh_issue_links','code_task_pr_links','ops_config')").all()) rb.exec(r.sql);
for (const t of ["analytics_metric_triggers (metric_key TEXT)", "failure_modes (fm_key TEXT)", "remediation_contracts (class TEXT)", "control_registry (control TEXT)", "metric_registry (metric TEXT)"]) rb.exec("CREATE TABLE " + t);
rb.exec(mig2.split(/;\s*\n/).map((x) => x.replace(/^\s*--.*$/gm, "").trim()).filter((x) => /^(CREATE VIEW|DROP VIEW)/.test(x)).join(";\n"));
for (const x of rbStmts) rb.exec(x);
assert.deepEqual(rb.prepare("SELECT name FROM pragma_table_info('v_tracker_drift')").all().map((c) => c.name), ["kind", "ref", "detail"], "the rollback restores the 3-column view");

// ISSUE-ROLLUP-1 intentionally closes the individual GitHub issue for priorities outside the configured set.
db.prepare("INSERT INTO ops_config (key, value) VALUES ('gh_individual_priorities', 'critical')").run();
const insertPolicyIssue = db.prepare("INSERT INTO agent_issues (id, title, priority, status, created_at, updated_at) VALUES (?, ?, ?, 'open', ?, ?)");
const policyNow = Date.now(), oldCreated = policyNow - 3600e3;
insertPolicyIssue.run(93001, "ROLLED-UNMIRRORED", "low", oldCreated, oldCreated);
insertPolicyIssue.run(93002, "ROLLED-STATE", "low", oldCreated, oldCreated);
insertPolicyIssue.run(93003, "INDIVIDUAL-UNMIRRORED", "critical", oldCreated, oldCreated);
insertPolicyIssue.run(93004, "FM-ACTOR-1: protected row", "low", oldCreated, oldCreated);
insertPolicyIssue.run(93005, "INDIVIDUAL-STATE", "critical", oldCreated, oldCreated);
mkLink(93002, "closed", "not_planned");
mkLink(93005, "closed");
const policyDrift = (id) => db.prepare("SELECT kind FROM v_tracker_drift WHERE ref = ?").get(String(id))?.kind;
assert.equal(policyDrift(93001), undefined, "a rolled-up unlinked issue is not tracker drift");
assert.equal(policyDrift(93002), undefined, "a rolled-up issue closed as not_planned is not state drift");
assert.equal(policyDrift(93003), "issue-unmirrored", "an individual issue without a GitHub mirror remains visible");
assert.equal(policyDrift(93004), "issue-unmirrored", "FM-ACTOR-1 remains individually mirrored at every priority");
assert.equal(policyDrift(93005), "issue-state", "an individual issue with a closed GitHub mirror remains visible");
db.prepare("DELETE FROM ops_config WHERE key = 'gh_individual_priorities'").run();

// The scheduled handler routes the 10-minute cron to the tracker only; CRON-GRID-1 (0.6.0) adds the settings reconcile on
// the :15 fire alone (its old 6-hourly trigger is a grid job).
calls = [];
await w.scheduled({ cron: "5,15,25,35,45,55 * * * *", scheduledTime: Date.UTC(2026, 9, 19, 10, 5) }, env, { waitUntil() {} });
assert.ok(!calls.some((c) => c.startsWith("GET /orgs/")), "the :05 tracker tick does not run the settings reconcile");
calls = [];
await w.scheduled({ cron: "5,15,25,35,45,55 * * * *", scheduledTime: Date.UTC(2026, 9, 19, 10, 15) }, env, { waitUntil() {} });
assert.ok(calls.some((c) => c.startsWith("GET /orgs/")), "the :15 fire runs the hourly settings reconcile");
const g = await w.fetch(new Request("https://s.test/tracker"), env);
assert.equal((await g.json()).cron, "5,15,25,35,45,55 * * * *");
console.log("tracker-sync.test.mjs ok");
