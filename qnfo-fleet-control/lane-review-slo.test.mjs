/**
 * lane-review-slo.test.mjs -- offline suite for LANE-WAITS-FOR-REVIEW-1 (agent_issues 1000872, GitHub 5515) and BP26-SLO-MERGE-LANE-1 (roadmap 1709, GitHub 5592).
 *
 * Slices the shipped BRANCH-HYGIENE-1 block out of worker.js and drives it against an in-memory D1 and a scripted GitHub (the harness of pr-merge-sla.test.mjs):
 *   A. REPLAY OF PR 5366: the review the automated reviewer submitted on its head (id 5709974064, two High findings and one Medium) is read from the "3 open issues" block; the lane
 *      refuses the merge, posts ONE comment that starts HOLD: (and cannot release itself), and does not post a second one on the next tick; a new push (another head) merges;
 *      a collaborator comment that says so releases it; a review of an OLDER head holds nothing; a review with no High item holds nothing; a read that fails assumes nothing.
 *   B. THE WAIT: a requested review that has not arrived holds a risky change (a migration) for at most 8 minutes after the pull request opened, never a plain change,
 *      never longer; lane_review_wait_min = 0 never waits; lane_review_hold = off stops the read.
 *   C. THE SLO FREEZE: with slo_budget_spent empty nothing changes; non-empty, a pull request that adds a new-capability release fragment (patch number 0) waits, a patch release, a
 *      migration or a docs change merges, the label reliability or a body line slo-exempt lets a capability through, slo_merge_lane = off lifts it.
 *   node qnfo-fleet-control/lane-review-slo.test.mjs      -> prints "N passed, 0 failed"
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "worker.js"), "utf8");
const BEGIN = "// ---- BRANCH-HYGIENE-1:BEGIN", END = "// ---- BRANCH-HYGIENE-1:END ----";
const a = src.indexOf(BEGIN), b = src.indexOf(END);
let passed = 0, failed = 0;
function eq(actual, expected, label) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; return; }
  failed++; console.error(`FAIL ${label}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
if (a < 0 || b < a) { console.error("FAIL branch-hygiene block markers missing"); console.log("1 failed"); process.exit(1); }
function grab(name) {
  const i = src.indexOf("function " + name + "(");
  let d = 0;
  const st = src.slice(i - 6, i) === "async " ? i - 6 : i;
  for (let k = src.indexOf("{", i); k < src.length; k++) { if (src[k] === "{") d++; else if (src[k] === "}" && --d === 0) return src.slice(st, k + 1); }
  throw new Error("function " + name + " not found");
}

const NOW = Date.parse("2026-11-05T10:07:00Z");
const hAgo = (n) => new Date(NOW - n * 3600000).toISOString();
const mAgo = (n) => new Date(NOW - n * 60000).toISOString();
const R = { full_name: "QNFO/qnfo-workers" };
const BOT = "copilot-pull-request-reviewer[bot]";

// The "3 open issues" block of review 5709974064 on PR 5366 (2026-10-30T08:46:20Z, head 6a9e1a55...), with the picture markup the reviewer writes.
const pic = (sev) => `<picture><source media="(prefers-color-scheme: dark)" srcset="https://github.githubassets.com/static/images/icons/copilot-code-review/${sev}-v2-dark.svg"><source media="(prefers-color-scheme: light)" srcset="https://github.githubassets.com/static/images/icons/copilot-code-review/${sev}-v2-light.svg"><img src="https://github.githubassets.com/static/images/icons/copilot-code-review/${sev}-v2-light.png" alt="${sev === "high" ? "High" : "Medium"} severity" width="62" height="18" align="texttop"></picture>`;
const BODY_5366 = "<!-- ccr-overview-v2 -->\n\n### 🟡 Changes recommended\n\nActive critical migration-integrity and aggregate-maintenance defects, plus a rollback-isolation issue, remain unresolved.\n\n<details open>\n<summary><strong>3 open issues</strong></summary>\n\n" +
  `- ${pic("high")} [Do not modify the already-applied historical migration](https://github.com/QNFO/qnfo-workers/pull/5366#discussion_r4421890625) · New\n` +
  `- ${pic("high")} [Recalculate emptied digest groups as zero on UPDATE and DELETE](https://github.com/QNFO/qnfo-workers/pull/5366#discussion_r4421890660) · New\n` +
  `- ${pic("medium")} [Preserve pre-existing mappings during rollback](https://github.com/QNFO/qnfo-workers/pull/5366#discussion_r4421890709) · New\n</details>\n\n<details>\n<summary><strong>What changed in this PR</strong></summary>\n\nThis pull request delivers runtime and migration fixes.\n\n**Changes:**\n- Replaces FinOps trigger replacement with explicit UPSERT and reconciliation logic.\n</details>\n\n<sub>Review effort: Lite</sub>`;
const BODY_CLEAN = "<!-- ccr-overview-v2 -->\n\n### 🟢 Looks good\n\nNo open issues.\n\n<details>\n<summary><strong>What changed in this PR</strong></summary>\n\n- Replaces a thing.\n</details>";
const BODY_MEDIUM_ONLY = BODY_5366.replace(new RegExp(pic("high").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), pic("medium"));

// ---- pure helpers, sliced from the block ----
const pure = { bhReviewFindings: null };
{
  const sandbox = { __name: (f) => f, Date, Math, JSON, Number, String, Object, Array, RegExp, __export: null };
  vm.createContext(sandbox);
  const deps = ["var CM_DOCS_ONLY_RE = "].map((k) => { const i = src.indexOf(k); return src.slice(i, src.indexOf("\n", i)); }).join("\n");
  vm.runInContext(deps + "\n" + src.slice(a, b + END.length) + "\n__export = { bhReviewFindings, bhReviewVerdict, bhReviewRisky, bhReviewHoldText, bhSloGate, BH_REVIEW_MARK };", sandbox, { filename: "bh-pure.js" });
  Object.assign(pure, sandbox.__export);
}
{
  const f = pure.bhReviewFindings(BODY_5366);
  eq(f.map((x) => x.title), ["Do not modify the already-applied historical migration", "Recalculate emptied digest groups as zero on UPDATE and DELETE"], "A: the two High items of review 5709974064 are read, the Medium one is not");
  eq(f[0].url, "https://github.com/QNFO/qnfo-workers/pull/5366#discussion_r4421890625", "A: a finding keeps its link");
  eq(pure.bhReviewFindings(BODY_CLEAN), [], "A: a review with no open issues has no finding");
  eq(pure.bhReviewFindings(BODY_MEDIUM_ONLY), [], "A: Medium items alone are no hold");
  eq(pure.bhReviewFindings(null), [], "A: no body, no finding");
  eq(pure.bhReviewFindings("- " + pic("high") + " [Loose item](https://x/y) · New").length, 1, "A: a body without the open-issues block is scanned whole");
  eq(pure.bhReviewFindings("The summary says " + pic("high") + " but is not a list item").length, 0, "A: only list items count");
  const head = "6a9e1a558ce47e7cc0e620a65c8344c9d5ee37ca";
  const rv = (over) => Object.assign({ id: 5709974064, user: { login: BOT }, commit_id: head, submitted_at: "2026-10-30T08:46:20Z", state: "COMMENTED", body: BODY_5366 }, over || {});
  eq(pure.bhReviewVerdict([rv()], head, {}, NOW).state, "high", "A: the replay of PR 5366 reads high");
  eq(pure.bhReviewVerdict([rv()], "ffffffffffffffffffffffffffffffffffffffff", {}, NOW).state, "none", "A: a review of an older head says nothing about this head");
  eq(pure.bhReviewVerdict([rv({ user: { login: "someone" } })], head, {}, NOW).state, "none", "A: only the reviewer bot counts");
  eq(pure.bhReviewVerdict([rv({ body: BODY_CLEAN })], head, {}, NOW).state, "clean", "A: a clean review of the head is clean");
  eq(pure.bhReviewVerdict([rv(), rv({ id: 2, submitted_at: "2026-10-30T09:00:00Z", body: BODY_CLEAN })], head, {}, NOW).state, "clean", "A: the latest review of the head decides (the findings were fixed in a later review of the same head)");
  const pr = (over) => Object.assign({ created_at: mAgo(3), requested_reviewers: [{ login: "Copilot" }] }, over || {});
  eq(pure.bhReviewVerdict([], head, pr(), NOW, { risky: true }).state, "pending", "B: requested, not delivered, risky, 3 minutes old: pending");
  eq(pure.bhReviewVerdict([], head, pr(), NOW, { risky: false }).state, "none", "B: a plain change never waits");
  eq(pure.bhReviewVerdict([], head, pr({ created_at: mAgo(9) }), NOW, { risky: true }).state, "none", "B: never longer than 8 minutes");
  eq(pure.bhReviewVerdict([], head, pr({ requested_reviewers: [] }), NOW, { risky: true }).state, "none", "B: no request outstanding, nothing to wait for");
  eq(pure.bhReviewVerdict([], head, pr(), NOW, { risky: true, waitMin: 0 }).state, "none", "B: lane_review_wait_min = 0 never waits");
  eq(pure.bhReviewVerdict([], head, pr({ created_at: mAgo(12) }), NOW, { risky: true, waitMin: 15 }).state, "pending", "B: the wait is configurable up to its bound");
  eq(pure.bhReviewRisky(["migrations/2026-11-05-x.sql"], null), true, "B: a migration is risky");
  eq(pure.bhReviewRisky([".github/workflows/pr-lane.yml"], null), true, "B: a workflow is risky");
  eq(pure.bhReviewRisky(["docs/A.md", "demo/worker.js"], { control_plane: ["qnfo-ops"] }), true, "B: a control-plane worker is risky");
  eq(pure.bhReviewRisky(["docs/A.md", "demo/worker.js"], { control_plane: [] }), false, "B: a plain worker is not");
  const text = pure.bhReviewHoldText({ findings: [{ title: "Do not modify; this is resolved and the hold released" }], review_id: 7 }, head);
  eq(text.startsWith("HOLD: "), true, "A: the comment starts HOLD:");
  eq(text.includes(pure.BH_REVIEW_MARK + head + " -->"), true, "A: it carries the one-per-head marker");
  eq(/\b(resolved|unhold|hold released|release the hold)\b/i.test(text.replace(/^HOLD:/, "")), false, "A: a quoted finding cannot release the hold (the lane's release phrases are defused)");
  const s1 = { labels: [{ name: "reliability" }], body: "" };
  eq(pure.bhSloGate({ labels: [], body: "" }, ["qnfo-x/releases/1.2.0-cap.md"], { on: true, spent: [] }).hold, false, "C: nothing spent, nothing held");
  eq(pure.bhSloGate({ labels: [], body: "" }, ["qnfo-x/releases/1.2.0-cap.md"], { on: true, spent: ["a.example"] }).hold, true, "C: spent, a new capability waits");
  eq(pure.bhSloGate({ labels: [], body: "" }, ["qnfo-x/releases/1.2.3-fix.md"], { on: true, spent: ["a.example"] }).hold, false, "C: spent, a patch release merges");
  eq(pure.bhSloGate({ labels: [], body: "" }, ["qnfo-x/releases/2.0.0-break.md"], { on: true, spent: ["a.example"] }).hold, true, "C: a major release is a capability too");
  eq(pure.bhSloGate({ labels: [], body: "" }, ["migrations/2026-11-05-x.sql", "docs/A.md", "scripts/a.py", "qnfo-x/a.test.mjs"], { on: true, spent: ["a.example"] }).hold, false, "C: migrations, docs, scripts and tests merge");
  eq(pure.bhSloGate(s1, ["qnfo-x/releases/1.2.0-cap.md"], { on: true, spent: ["a.example"] }).hold, false, "C: the label reliability exempts");
  eq(pure.bhSloGate({ labels: [], body: "Restores the p95.\nslo-exempt: fixes the availability dip of qwav.org" }, ["qnfo-x/releases/1.2.0-cap.md"], { on: true, spent: ["a.example"] }).hold, false, "C: a body line slo-exempt exempts");
  eq(pure.bhSloGate({ labels: [], body: "" }, ["qnfo-x/releases/1.2.0-cap.md"], { on: false, spent: ["a.example"] }).hold, false, "C: slo_merge_lane = off lifts the freeze");
  eq(pure.bhSloGate({ labels: [], body: "" }, ["qnfo-x/releases/1.2.0-cap.md"], null).hold, false, "C: no options, no freeze");
  eq(/ops_config slo_budget_spent/.test(pure.bhSloGate({ labels: [], body: "" }, ["qnfo-x/releases/1.2.0-cap.md"], { on: true, spent: ["a.example", "b.example"] }).why), true, "C: the refusal names its source and the way out");
}

// ---- the lane against a scripted GitHub ----
function makeD1() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE code_tasks (id TEXT, branch TEXT, status TEXT, updated_at TEXT); CREATE TABLE cloud_ops_events (id TEXT PRIMARY KEY, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT); CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, last_value TEXT, last_refreshed TEXT); INSERT INTO metric_registry (metric) VALUES ('repo_branches_open'); CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER, close_channel TEXT); CREATE TABLE scheduler_state (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);");
  const prepare = (sql) => {
    const order = [...sql.matchAll(/\?(\d+)/g)].map((m) => Number(m[1]));
    const plain = sql.replace(/\?\d+/g, "?");
    const mk = (args) => ({
      bind: (...x) => mk(x),
      run: async () => { const r = db.prepare(plain).run(...order.map((n) => args[n - 1])); return { meta: { changes: Number(r.changes) } }; },
      first: async () => db.prepare(plain).get(...order.map((n) => args[n - 1])) || null,
      all: async () => ({ results: db.prepare(plain).all(...order.map((n) => args[n - 1])) }),
    });
    return mk([]);
  };
  return { db, AUDIT: { prepare, batch: async (xs) => { const out = []; for (const x of xs) out.push(await x.run()); return out; } } };
}
function makeGh(sc) {
  const calls = [];
  const evApi = async (env, method, path, body) => {
    calls.push(method + " " + path);
    const ok = (j, status = 200) => ({ status, ok: status < 300, j });
    let m;
    if (method === "GET" && path.startsWith("/branches")) return ok(sc.branches || []);
    if (method === "GET" && (m = /^\/pulls\/(\d+)$/.exec(path)) && sc.prs) return sc.prs[m[1]] ? ok(sc.prs[m[1]]) : ok({ message: "Not Found" }, 404);
    if (method === "GET" && (m = /^\/pulls\/(\d+)\/files/.exec(path))) return ok((sc.files || {})[m[1]] || []);
    if (method === "GET" && (m = /^\/pulls\/(\d+)\/reviews/.exec(path))) return sc.reviewsStatus ? ok({ message: "boom" }, sc.reviewsStatus) : ok((sc.reviews || {})[m[1]] || []);
    if (method === "GET" && (m = /^\/commits\/([^/]+)\/check-runs/.exec(path))) return ok({ check_runs: (sc.checks || {})[m[1]] || [] });
    if (method === "GET" && /^\/commits\/([^/]+)\/status$/.test(path)) return ok({ state: "pending", total_count: 0 });
    if (method === "PUT" && (m = /^\/pulls\/(\d+)\/merge$/.exec(path))) { (sc.merges = sc.merges || []).push({ pr: Number(m[1]), body }); return ok({ sha: "merged" + m[1], merged: true }); }
    if (method === "PUT" && /\/update-branch$/.test(path)) return ok({}, 202);
    if (method === "GET" && path.startsWith("/pulls")) return ok(sc.pulls || []);
    if (method === "DELETE") return ok(null, 204);
    if (method === "GET" && path === "") return ok({ delete_branch_on_merge: true });
    if (method === "POST" && (m = /^\/issues\/(\d+)\/comments$/.exec(path))) {
      (sc.posts = sc.posts || []).push({ pr: Number(m[1]), body: body && body.body });
      (sc.comments = sc.comments || {})[m[1]] = ((sc.comments || {})[m[1]] || []).concat([{ created_at: new Date(NOW).toISOString(), body: body.body, user: { login: "qnfo-fleet[bot]" } }]);
      return sc.postStatus ? ok({ message: "no" }, sc.postStatus) : ok({}, 201);
    }
    if (method === "PATCH") return ok({});
    if (method === "GET" && (m = /^\/issues\/(\d+)\/comments/.exec(path))) return ok((sc.comments || {})[m[1]] || []);
    if (method === "GET" && (m = /^\/commits\/([^/?]+)$/.exec(path))) return ok({ sha: m[1], commit: { committer: { date: (sc.commitAt || {})[m[1]] || hAgo(5) } } });
    return ok(null, 404);
  };
  return { evApi, evGraphql: async () => ({ status: 200, ok: true, j: {} }), calls };
}
async function run(sc, opts) {
  const d1 = makeD1();
  (sc.config || []).forEach(([k, v]) => d1.db.prepare("INSERT INTO ops_config (key, value) VALUES (?1, ?2)").run(k, v));
  const gh = makeGh(sc);
  const sandbox = { evApi: gh.evApi, evGraphql: gh.evGraphql, EVOLVE_REPO: "QNFO/qnfo-workers", __name: (f) => f, console, Date, Math, JSON, Number, String, Object, Array, RegExp, isNaN, encodeURIComponent, Promise, setTimeout, __export: null };
  vm.createContext(sandbox);
  const deps = ["var EVOLVE_REQUIRED = ", "var CM_OK = ", "var EVOLVE_DENY = ", "var CM_CONTROL_PLANE = ", "var CM_LOOP_CANARIED = ", "var CM_DENY = ", "var CM_DOCS_ONLY_RE = "].map((k) => { const i = src.indexOf(k); return src.slice(i, src.indexOf("\n", i)); }).concat(["cmDocsOnly", "cmRequired", "cmChecks", "evMergePr"].map(grab)).join("\n");
  vm.runInContext(deps + "\n" + src.slice(a, b + END.length) + "\nBH_MERGEABLE_WAIT_MS = 0;\nEV_MERGE_RETRY_WAIT_MS = 0;\nBH_READY_WAIT_MS = 0;\n__export = { branchHygieneTick };", sandbox, { filename: "bh-block.js" });
  const env = { GITHUB_TOKEN: "x", AUDIT: d1.AUDIT };
  const out = await sandbox.__export.branchHygieneTick(env, Object.assign({ now: NOW }, opts || {}));
  return { out, calls: gh.calls, d1, sc };
}
const green = (h, names) => names.map((n, i) => ({ id: 10 + i, name: n, status: "completed", conclusion: "success", head_sha: h }));
const ALL = ["gate", "mirror-guard", "comparator", "guard", "CodeQL"];
const W2 = (f) => ["demo/worker.js", "demo/deployed-current.worker.js"].concat(f || []).map((n) => ({ filename: n, status: "modified" }));
const prj = (n, ref, h, over) => Object.assign({ number: n, node_id: "PR_node_" + n, state: "open", draft: false, merged: false, mergeable: true, mergeable_state: "clean", title: "feat: thing " + n, body: "", labels: [], created_at: hAgo(4), updated_at: hAgo(3), head: { ref, sha: h, repo: R }, base: { ref: "main", repo: R }, requested_reviewers: [] }, over || {});
const lite = (x) => ({ number: x.number, state: x.state, draft: x.draft, merged_at: x.merged_at || null, closed_at: x.closed_at || null, created_at: x.created_at, updated_at: x.updated_at, head: x.head, base: x.base });
const scenario = (prs, extra) => Object.assign({ branches: [{ name: "main", protected: true, commit: { sha: "m0" } }], compare: {}, prs, pulls: Object.values(prs).map(lite), files: Object.fromEntries(Object.keys(prs).map((n) => [n, W2()])), checks: Object.fromEntries(Object.values(prs).map((x) => [x.head.sha, green(x.head.sha, ALL)])) }, extra || {});
// the HOLD comments the review gate posted (the lane also comments after a merge)
const holdPosts = (sc) => (sc.posts || []).filter((x) => String(x.body).startsWith("HOLD:"));
const HEAD = "6a9e1a558ce47e7cc0e620a65c8344c9d5ee37ca";
const review5366 = (over) => Object.assign({ id: 5709974064, user: { login: BOT }, commit_id: HEAD, submitted_at: mAgo(6), state: "COMMENTED", body: BODY_5366 }, over || {});

// ---- A. replay of PR 5366 ----
{
  const p = prj(71, "claude/pr5366", HEAD);
  const sc = scenario({ 71: p }, { reviews: { 71: [review5366()] } });
  const r1 = await run(sc);
  eq(r1.out.merged_prs, [], "A: the lane does not merge a head whose review lists High items");
  eq((sc.merges || []).length, 0, "A: no merge call");
  eq(holdPosts(sc).length, 1, "A: one comment is posted");
  eq(holdPosts(sc)[0].body.startsWith("HOLD: "), true, "A: it starts HOLD:");
  eq(/Do not modify the already-applied historical migration/.test(holdPosts(sc)[0].body) || /D​o not/.test(holdPosts(sc)[0].body) || /migration/.test(holdPosts(sc)[0].body), true, "A: it names the finding");
  eq(holdPosts(sc)[0].body.includes(pure.BH_REVIEW_MARK + HEAD), true, "A: and the marker of the head");
  eq(r1.calls.filter((c) => c === "GET /pulls/71/reviews?per_page=100").length, 1, "A: the reviews are read once, for a pull request that passed every other gate");
  // next tick: the comment exists; the existing hold read holds, no second comment
  const r2 = await run(sc);
  eq(r2.out.merged_prs, [], "A: the next tick still holds (the HOLD comment is read like any other)");
  eq(holdPosts(sc).length, 1, "A: and posts no second comment");
  // a collaborator releases it: the review hold is not posted again for the same head
  sc.comments[71] = sc.comments[71].concat([{ created_at: new Date(NOW + 1000).toISOString(), body: "hold released: the migration is a new file", user: { login: "owner" } }]);
  const r3 = await run(sc, { now: NOW + 5000 });
  eq(r3.out.merged_prs, [71], "A: a later comment that says so releases the hold and the pull request merges");
  eq(holdPosts(sc).length, 1, "A: the review hold is not posted again for the same head");
}
{
  // a new push: the review belongs to the old head, so the new head is not held by it
  const p = prj(72, "claude/pr-new-head", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  const sc = scenario({ 72: p }, { reviews: { 72: [review5366()] } });
  const r = await run(sc);
  eq(r.out.merged_prs, [72], "A: a review of an older head holds nothing (a new push releases)");
  eq(holdPosts(sc).length, 0, "A: and posts nothing");
}
{
  const p = prj(73, "claude/pr-clean", HEAD);
  const sc = scenario({ 73: p }, { reviews: { 73: [review5366({ body: BODY_CLEAN })] } });
  eq((await run(sc)).out.merged_prs, [73], "A: a reviewed head with no High item merges");
}
{
  const p = prj(74, "claude/pr-readfail", HEAD);
  const sc = scenario({ 74: p }, { reviews: { 74: [review5366()] }, reviewsStatus: 500 });
  const r = await run(sc);
  eq(r.out.merged_prs, [74], "A: a failed reviews read assumes no hold (the lane never stalls on GitHub)");
}
{
  const p = prj(75, "claude/pr-switch", HEAD);
  const sc = scenario({ 75: p }, { reviews: { 75: [review5366()] }, config: [["lane_review_hold", "off"]] });
  const r = await run(sc);
  eq(r.out.merged_prs, [75], "A: lane_review_hold = off restores the old behaviour");
  eq(r.calls.some((c) => /\/reviews/.test(c)), false, "A: and reads no review");
}
{
  const p = prj(76, "claude/pr-holds-off", HEAD);
  const sc = scenario({ 76: p }, { reviews: { 76: [review5366()] }, config: [["stale_pr_holds_enabled", "off"]] });
  const r = await run(sc);
  eq(r.out.merged_prs, [76], "A: with the lane's hold read off the review hold is off too (its comment would not be read)");
  eq(holdPosts(sc).length, 0, "A: and posts nothing");
}
{
  const p = prj(77, "claude/pr-postfail", HEAD);
  const sc = scenario({ 77: p }, { reviews: { 77: [review5366()] }, postStatus: 403 });
  const r = await run(sc);
  eq(r.out.merged_prs, [], "A: a comment that could not be posted still holds this tick");
}

// ---- B. the wait ----
{
  const p = prj(81, "claude/pr-migration", "cccccccccccccccccccccccccccccccccccccccc", { created_at: mAgo(5), updated_at: mAgo(4), requested_reviewers: [{ login: "Copilot" }] });
  const sc = scenario({ 81: p }, { files: { 81: W2(["migrations/2026-11-05-x.sql"]) }, reviews: { 81: [] } });
  const r = await run(sc);
  eq(r.out.merged_prs, [], "B: a migration whose requested review has not arrived waits");
  eq(holdPosts(sc).length, 0, "B: the wait posts no comment");
  const p2 = prj(82, "claude/pr-migration-late", "dddddddddddddddddddddddddddddddddddddddd", { created_at: mAgo(9), updated_at: mAgo(8), requested_reviewers: [{ login: "Copilot" }] });
  const sc2 = scenario({ 82: p2 }, { files: { 82: W2(["migrations/2026-11-05-x.sql"]) }, reviews: { 82: [] } });
  eq((await run(sc2)).out.merged_prs, [82], "B: after 8 minutes the lane stops waiting (the 10-minute merge SLA holds)");
  const p3 = prj(83, "claude/pr-plain", "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", { created_at: mAgo(5), updated_at: mAgo(4), requested_reviewers: [{ login: "Copilot" }] });
  const sc3 = scenario({ 83: p3 }, { reviews: { 83: [] } });
  eq((await run(sc3)).out.merged_prs, [83], "B: a plain change never waits for the review");
  const sc4 = scenario({ 81: p }, { files: { 81: W2(["migrations/2026-11-05-x.sql"]) }, reviews: { 81: [] }, config: [["lane_review_wait_min", "0"]] });
  eq((await run(sc4)).out.merged_prs, [81], "B: lane_review_wait_min = 0 never waits");
}

// ---- C. the SLO freeze ----
{
  const cap = (n, ref, h, over) => prj(n, ref, h, over);
  const files = (n, extra) => ({ [n]: W2(extra) });
  const spent = [["slo_budget_spent", "qwav.org,fleet.qnfo.org"]];
  let sc = scenario({ 91: cap(91, "claude/cap", "1111111111111111111111111111111111111111") }, { files: files(91, ["demo/releases/1.2.0-new-thing.md"]), config: spent });
  let r = await run(sc);
  eq(r.out.merged_prs, [], "C: with a budget spent a new-capability release fragment waits");
  sc = scenario({ 92: cap(92, "claude/fix", "2222222222222222222222222222222222222222") }, { files: files(92, ["demo/releases/1.2.3-fix.md"]), config: spent });
  eq((await run(sc)).out.merged_prs, [92], "C: a patch release merges while the budget is spent");
  sc = scenario({ 93: cap(93, "claude/cap2", "3333333333333333333333333333333333333333") }, { files: files(93, ["demo/releases/1.2.0-new-thing.md"]), config: [] });
  eq((await run(sc)).out.merged_prs, [93], "C: slo_budget_spent absent changes nothing");
  sc = scenario({ 94: cap(94, "claude/cap3", "4444444444444444444444444444444444444444") }, { files: files(94, ["demo/releases/1.2.0-new-thing.md"]), config: [["slo_budget_spent", ""]] });
  eq((await run(sc)).out.merged_prs, [94], "C: slo_budget_spent empty changes nothing");
  sc = scenario({ 95: cap(95, "claude/cap4", "5555555555555555555555555555555555555555", { labels: [{ name: "reliability" }] }) }, { files: files(95, ["demo/releases/1.2.0-new-thing.md"]), config: spent });
  eq((await run(sc)).out.merged_prs, [95], "C: the label reliability lets a capability through");
  sc = scenario({ 96: cap(96, "claude/cap5", "6666666666666666666666666666666666666666") }, { files: files(96, ["demo/releases/1.2.0-new-thing.md"]), config: spent.concat([["slo_merge_lane", "off"]]) });
  eq((await run(sc)).out.merged_prs, [96], "C: slo_merge_lane = off lifts the freeze");
  sc = scenario({ 97: cap(97, "claude/docs", "7777777777777777777777777777777777777777") }, { files: files(97, ["migrations/2026-11-05-x.sql", "docs/A.md"]), config: spent });
  eq((await run(sc)).out.merged_prs, [97], "C: a migration and docs merge while the budget is spent");
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
