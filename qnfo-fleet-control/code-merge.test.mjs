/**
 * code-merge.test.mjs -- offline regression lock for CODE-TASK-MERGE-RUNNER-1 (qnfo-fleet-control 0.4.85).
 *
 * Slices the EVOLVE-PR-1 block and the runner block out of worker.js and drives them against an in-memory SQLite D1
 * (node:sqlite, Node 22) and a scripted GitHub API. Patches are produced by the code orchestrator's own hunkPatch and
 * wholeFilePatch (sliced from qnfo-code-orchestrator/worker.js), so the parser and applier are tested against the real
 * producer. Proves: the open decision (a pushed branch becomes a PR opened with the fleet token only after the verify,
 * scope, provenance and integrity gates; an existing PR is adopted), the merge decision (every refusal and wait case, the
 * 120-minute refusal when no required check starts (SLA-120M-7; it was 3h), and the one green path), the merge with merged_by, post-merge deploy and live
 * verification, the inverse-patch revert through an evolve candidate, the kill switch, the first-ok marker, provenance,
 * reconciliation of person merges and opens, one merge per tick, and that evAdvance still merges, deploys and verifies
 * its own candidates after the shared-helper refactor.
 * Output MUST contain "0 failed" on success; charter-guard.yml greps for exactly that string.
 *
 *   node qnfo-fleet-control/code-merge.test.mjs
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "worker.js"), "utf8");
const A = src.indexOf("var EVOLVE_REPO = ");
const END = "// ---- CODE-TASK-MERGE-RUNNER-1:END ----";
const B = src.indexOf(END);
if (A < 0 || B < A || src.indexOf("// ---- CODE-TASK-MERGE-RUNNER-1:BEGIN") < A) { console.error("FAIL evolve / code-merge blocks not found in worker.js"); console.log("1 failed"); process.exit(1); }
const orch = readFileSync(join(here, "..", "qnfo-code-orchestrator", "worker.js"), "utf8");
const o1 = orch.indexOf("function lineOps("), o2 = orch.indexOf("function promptForPatch("), o3 = orch.indexOf("function wholeFilePatch("), o4 = orch.indexOf("// ONE bounded step");
if (o1 < 0 || o2 < o1 || o3 < 0 || o4 < o3) { console.error("FAIL orchestrator diff functions not found"); console.log("1 failed"); process.exit(1); }

// ---------------------------------------------------------------- D1 (node:sqlite)
let db;
function freshDb() {
  db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE code_tasks (id TEXT PRIMARY KEY, repo TEXT NOT NULL, path TEXT NOT NULL, goal TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', step TEXT NOT NULL DEFAULT 'read', attempts INTEGER NOT NULL DEFAULT 0, model TEXT, ctx TEXT, branch TEXT, pr_url TEXT, last_error TEXT, lease_until TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT, updated_at TEXT);
CREATE TABLE cloud_ops_events (id TEXT PRIMARY KEY, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT);
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER, close_channel TEXT);
CREATE TABLE fleet_deploys (id INTEGER PRIMARY KEY AUTOINCREMENT, worker TEXT, actor TEXT, from_sha TEXT, to_sha TEXT, source_path TEXT, ok INTEGER, note TEXT, ts TEXT, session_id TEXT);
CREATE TABLE worker_live_audit (worker TEXT PRIMARY KEY, http INTEGER, live_version TEXT, registry_before TEXT, match INTEGER, note TEXT, probed_at TEXT);`);
}
function stmtOn(sql) {
  let args = [];
  // node:sqlite refuses positional ?N binding ("column index out of range"); map ?N to named $pN.
  const q = /\?\d/.test(sql) ? sql.replace(/\?(\d+)/g, (m, n) => "$p" + n) : sql;
  const call = (m) => {
    const st = db.prepare(q);
    return q === sql ? st[m](...args) : st[m](Object.fromEntries(args.map((v, i) => ["p" + (i + 1), v])));
  };
  const self = {
    bind(...x) { args = x.map((v) => (v === undefined ? null : v)); return self; },
    async all() { return { results: call("all") }; },
    async first() { return call("get") || null; },
    async run() { const r = call("run"); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; }
  };
  return self;
}
const AUDIT = { prepare: (sql) => stmtOn(sql) };
const rows = (sql, ...a) => db.prepare(sql).all(...a);
const one = (sql, ...a) => db.prepare(sql).get(...a);

// ---------------------------------------------------------------- GitHub (scripted)
const b64 = (s) => Buffer.from(String(s), "utf8").toString("base64");
let gh;
function freshGh() {
  gh = { calls: [], pulls: {}, files: {}, checks: {}, statuses: {}, contents: {}, mergeBase: {}, branches: { main: "main1" }, compareFiles: {}, merges: [], comments: [], commits: [], refs: [], blobs: [], newPulls: [], down: false, mergeStatus: null, seq: 0 };
}
function resp(status, j) { return { status, async json() { return j; }, async text() { return j === undefined || j === null ? "" : JSON.stringify(j); } }; }
function ghRoute(method, path, body) {
  gh.calls.push(method + " " + path);
  if (gh.down) return resp(503, { message: "down" });
  let m;
  if (method === "GET" && (m = /^\/pulls\/(\d+)$/.exec(path))) return gh.pulls[m[1]] ? resp(200, gh.pulls[m[1]]) : resp(404, {});
  if (method === "GET" && (m = /^\/pulls\?head=QNFO%3A([^&]+)&state=all&per_page=5$/.exec(path))) return resp(200, Object.values(gh.pulls).filter((p) => p.head.ref === decodeURIComponent(m[1])));
  if (method === "GET" && (m = /^\/git\/ref\/heads\/(.+)$/.exec(path)) && m[1] !== "main") return gh.branches[m[1]] ? resp(200, { object: { sha: gh.branches[m[1]] } }) : resp(404, { message: "Not Found" });
  if (method === "GET" && (m = /^\/pulls\/(\d+)\/files\?per_page=100$/.exec(path))) return resp(200, gh.files[m[1]] || []);
  if (method === "GET" && (m = /^\/commits\/([^/]+)\/check-runs\?per_page=100$/.exec(path))) return resp(200, { total_count: (gh.checks[m[1]] || []).length, check_runs: gh.checks[m[1]] || [] });
  if (method === "GET" && (m = /^\/commits\/([^/]+)\/status$/.exec(path))) return resp(200, gh.statuses[m[1]] || { state: "pending", total_count: 0, statuses: [] });
  if (method === "GET" && (m = /^\/compare\/main\.\.\.(.+)$/.exec(path))) return resp(200, { merge_base_commit: { sha: gh.mergeBase[m[1]] || "base0" }, files: gh.compareFiles[m[1]] || [] });
  if (method === "GET" && (m = /^\/contents\/(.+)\?ref=(.+)$/.exec(path))) {
    const key = decodeURIComponent(m[2]) + ":" + m[1].split("/").map(decodeURIComponent).join("/");
    return key in gh.contents ? resp(200, { encoding: "base64", content: b64(gh.contents[key]) }) : resp(404, { message: "Not Found" });
  }
  if (method === "GET" && path === "/git/ref/heads/main") return resp(200, { object: { sha: "main1" } });
  if (method === "GET" && (m = /^\/git\/commits\/(.+)$/.exec(path))) return resp(200, { sha: m[1], tree: { sha: "tree-" + m[1] } });
  if (method === "POST" && path === "/git/commits") { const sha = "k" + (++gh.seq); gh.commits.push({ sha, ...body }); return resp(201, { sha }); }
  if (method === "PATCH" && (m = /^\/git\/refs\/heads\/(.+)$/.exec(path))) {
    gh.refs.push({ branch: m[1], ...body });
    for (const n in gh.pulls) if (gh.pulls[n].head.ref === m[1]) gh.pulls[n].head.sha = body.sha;
    return resp(200, { object: { sha: body.sha } });
  }
  if (method === "PUT" && (m = /^\/pulls\/(\d+)\/merge$/.exec(path))) {
    gh.merges.push({ pr: Number(m[1]), ...body });
    if (gh.mergeRace > 0) { gh.mergeRace--; return resp(405, { message: "Base branch was modified. Review and try the merge again." }); }
    if (gh.mergeStatus) return resp(gh.mergeStatus, { message: "not mergeable" });
    if (gh.pulls[m[1]]) { gh.pulls[m[1]].merged = true; gh.pulls[m[1]].state = "closed"; }
    return resp(200, { sha: "merge-" + m[1], merged: true });
  }
  if (method === "PUT" && /\/update-branch$/.test(path)) return resp(202, {});
  if (method === "DELETE" && /^\/git\/refs\/heads\//.test(path)) return resp(204, null);
  if (method === "POST" && (m = /^\/issues\/(\d+)\/comments$/.exec(path))) { gh.comments.push({ pr: Number(m[1]), body: body.body }); return resp(201, {}); }
  if (method === "PATCH" && /^\/pulls\/\d+$/.test(path)) return resp(200, {});
  if (method === "POST" && path === "/git/blobs") { gh.blobs.push(Buffer.from(body.content, "base64").toString("utf8")); return resp(201, { sha: "blob" + gh.blobs.length }); }
  if (method === "POST" && path === "/git/trees") return resp(201, { sha: "tree-new" });
  if (method === "POST" && path === "/git/refs") return resp(201, { ref: body.ref });
  if (method === "POST" && /^\/actions\/workflows\/[^/]+\/dispatches$/.test(path)) { (gh.dispatches = gh.dispatches || []).push({ path, body }); return resp(gh.dispatchStatus || 204, gh.dispatchStatus ? { message: "Resource not accessible by personal access token" } : null); }
  if (method === "POST" && path === "/pulls") {
    if (gh.pull422) { const n = gh.pull422; gh.pull422 = null; seedWorkerPr(n, body.head, gh.branches[body.head]); return resp(422, { message: "Validation Failed", errors: [{ resource: "PullRequest", code: "custom", message: "A pull request already exists for QNFO:" + body.head + "." }] }); }
    if (gh.pull422bare) { gh.pull422bare = false; return resp(422, { message: "Validation Failed", errors: [{ resource: "PullRequest", code: "custom", message: "No commits between main and " + body.head }] }); }
    const number = 900 + gh.newPulls.length, sha = gh.branches[body.head];
    gh.newPulls.push({ number, ...body });
    if (sha) { gh.pulls[number] = prJson({ number, title: body.title, head: { ref: body.head, sha, repo: { full_name: "QNFO/qnfo-workers" } } }); gh.files[number] = gh.compareFiles[sha] || []; }
    return resp(201, { number });
  }
  return resp(404, { message: "unscripted " + method + " " + path });
}
async function timedFetch(url, opts) {
  const p = String(url).replace("https://api.github.com/repos/QNFO/qnfo-workers", "");
  return ghRoute((opts && opts.method) || "GET", p, opts && opts.body ? JSON.parse(opts.body) : null);
}

// ---------------------------------------------------------------- sandbox
const sandbox = {
  __name: (f) => f, timedFetch, aiRunAttr: async () => null, console, crypto: globalThis.crypto, Uint8Array, TextDecoder, TextEncoder, atob, btoa, encodeURIComponent,
  b64encode: (s) => Buffer.from(String(s), "utf8").toString("base64"), DIFF_MAX_D: 600, __export: null,
};
vm.createContext(sandbox);
vm.runInContext(src.slice(A, B + END.length) + "\n" + orch.slice(o1, o2) + "\n" + orch.slice(o3, o4) +
  "\n__export = { cmVerAhead, cmVerCore, cmDecide, cmOpenDecide, cmParsePatch, cmApply, cmBump, cmRevertText, cmEditsApply, cmRebaseText, cmRevertEdits, cmIntegrity, cmRequired, cmChecks, cmTrusted, cmScope, codeMergeTick, cmConfig, evAdvance, evSchema, hunkPatch, wholeFilePatch, CM_DEFAULT_ENABLED, cmReviewParse, cmReviewModel, cmReviewDiff, cmReviewDecision, cmModelFamily, CM_REVIEW_MODELS, CM_REVIEW_TRIES, cmCompanions, cmTaskGates, cmReviewScreen, cmReviewCombine, cmCiteFound, cmDefectName, cmDefinedIn, cmReviewFacts, cmSecondReviewer, cmReviewPrompt, cmRepairable, CM_REVIEW_DIFF_CHARS, CM_REVIEW_GOAL_CHARS, CM_STALE_RE };", sandbox, { filename: "code-merge-block.js" });
const W = sandbox.__export;
vm.runInContext("EV_MERGE_RETRY_WAIT_MS = 0;", sandbox); // MERGE-RACE-RETRY-1: no real waits in the suite

let passed = 0, failed = 0;
function ok(c, label, extra) { if (c) { passed++; return; } failed++; console.error("FAIL " + label + (extra !== undefined ? "  -- " + JSON.stringify(extra) : "")); }
const NOW = Date.parse("2026-10-03T12:00:00Z");
const ago = (h) => new Date(NOW - h * 36e5).toISOString();
const J = (x) => JSON.parse(JSON.stringify(x));

// ---------------------------------------------------------------- fixtures
const filler = Array.from({ length: 40 }, (_, i) => "var f" + i + " = " + i + ";");
const BASE = ['var VERSION = "1.2.3-demo";', "function a() {", "  return 1;", "}", ...filler, "function b() {", "  return 2;", "}", ""].join("\n");
const NEXT = BASE.replace('var VERSION = "1.2.3-demo";', 'var VERSION = "1.2.4-codeagent";').replace("  return 1;", "  return 11;");
const DIR = "qnfo-demo", PATH = DIR + "/worker.js", MIRROR = DIR + "/deployed-current.worker.js";
const PATCH = W.hunkPatch(PATH, BASE, NEXT) + W.hunkPatch(MIRROR, BASE, NEXT);
const ID = "ct_abcdefghijklmn", BRANCH = "codeagent-" + ID.slice(3, 15);
function task(over) {
  return Object.assign({ id: ID, repo: "qnfo-workers", path: PATH, goal: "[issue #50] fix a", status: "published", step: "done", attempts: 0, ctx: JSON.stringify({ base: BASE, patch: PATCH }), branch: BRANCH, pr_url: "https://github.com/QNFO/qnfo-workers/pull/401", last_error: null, created_at: ago(5), updated_at: ago(4) }, over || {});
}
const green = (sha, names) => names.map((n, i) => ({ id: 100 + i, name: n, status: "completed", conclusion: "success", head_sha: sha }));
function prJson(over) {
  return Object.assign({ number: 401, state: "open", merged: false, draft: false, mergeable: true, mergeable_state: "clean", title: "code-task: fix a\nS", head: { ref: BRANCH, sha: "h1", repo: { full_name: "QNFO/qnfo-workers" } }, base: { ref: "main", sha: "base0", repo: { full_name: "QNFO/qnfo-workers" } } }, over || {});
}
function g(over) {
  return Object.assign({
    pr: prJson(), files: [{ filename: PATH, status: "modified" }, { filename: MIRROR, status: "modified" }],
    checks: green("h1", ["gate", "mirror-guard", "comparator", "guard", "CodeQL"]), status: { state: "pending", total_count: 0 },
    provenance: { ok: true, origin: "issue #50" }, integrity: { ok: true, revertible: true, containers: false, version_to: "1.2.4-codeagent" },
  }, over || {});
}
const act = (t, gg) => J(W.cmDecide(t, gg, NOW));

// ================================================================ 1. patch parse / apply against the orchestrator's producer
const P = W.cmParsePatch(PATCH);
ok(Object.keys(P).sort().join(",") === [MIRROR, PATH].sort().join(","), "a path + mirror patch parses into two files");
ok(W.cmApply(BASE, P[PATH], false, false) === NEXT, "forward apply of hunkPatch output reproduces the verified file");
const SHIFTED = "// a line main added on top\n// and another\n" + BASE;
ok(W.cmApply(SHIFTED, P[PATH], false, false) === "// a line main added on top\n// and another\n" + NEXT, "hunks apply at an offset after unrelated lines moved (git apply semantics)");
ok(W.cmApply(BASE.replace("  return 2;", "  return 22;"), P[PATH], false, false) !== null, "a change outside the hunks' context still applies");
ok(W.cmApply(BASE.replace("function a() {", "function a(x) {"), P[PATH], false, false) === null, "a hunk whose context changed does not apply");
ok(W.cmApply(NEXT, P[PATH], true, false) === BASE, "reverse apply restores the base");
const WHOLE = W.wholeFilePatch("docs/x.md", "one\ntwo\n", "one\ntwo\nthree\n");
const PW = W.cmParsePatch(WHOLE)["docs/x.md"];
ok(W.cmApply("one\ntwo\n", PW, false, false) === "one\ntwo\nthree\n", "a whole-file patch applies to its own base");
ok(W.cmApply("one\nTWO\n", PW, false, false) === null, "a whole-file patch does not apply once the file moved");
const NOEOL = W.wholeFilePatch("docs/y.md", "alpha\nbeta", "alpha\nbeta\ngamma");
ok(W.cmApply("alpha\nbeta", W.cmParsePatch(NOEOL)["docs/y.md"], false, false) === "alpha\nbeta\ngamma", "files without a final newline round-trip ('\\ No newline at end of file')");
ok(W.cmApply("alpha\nbeta\n", W.cmParsePatch(NOEOL)["docs/y.md"], false, false) === null, "the final-newline marker is enforced");
const SQLP = W.hunkPatch("docs/s.md", "a\n-- note\nb\n", "a\nb\n");
ok(W.cmApply("a\n-- note\nb\n", W.cmParsePatch(SQLP)["docs/s.md"], false, false) === "a\nb\n", "a removed line that starts with '-- ' is a hunk line, not a header");
const EMPTY = W.wholeFilePatch("docs/e.md", "", "new\n");
ok(W.cmApply("", W.cmParsePatch(EMPTY)["docs/e.md"], false, false) === "new\n", "a patch onto an empty file inserts at the top");
const REV = W.cmRevertText(NEXT, P[PATH], "-revert-c7");
ok(REV && REV.from === "1.2.4-codeagent" && REV.to === "1.2.5-revert-c7" && REV.content === BASE.replace('"1.2.3-demo"', '"1.2.5-revert-c7"'), "the revert undoes the edit and bumps main's VERSION, not the pre-task one", REV && REV.to);
const LATER = NEXT.replace('"1.2.4-codeagent"', '"1.2.9-later"');
const REV2 = W.cmRevertText(LATER, P[PATH], "-revert-c8");
ok(REV2 && REV2.to === "1.2.10-revert-c8" && /return 1;/.test(REV2.content), "the revert tolerates a later VERSION on main (VERSION lines match as wildcards)");
ok(W.cmRevertText(NEXT.replace("  return 11;", "  return 12;"), P[PATH], "-x") === null, "a revert whose lines were changed again on main is refused (needs a person)");
const C1 = W.cmBump('var VERSION = "1.15.4-x"; /* changelog */\nvar y = 1;\n', "-r");
ok(C1 && C1.to === "1.15.5-r" && C1.content.startsWith('var VERSION = "1.15.5-r"; /* changelog */'), "cmBump keeps a trailing changelog comment");
ok(W.cmBump('const VERSION = "1.0.0";\n', "-r") === null && W.cmBump('var VERSION = "1.0.0";\nvar VERSION = "2.0.0";\n', "-r") === null, "const VERSION and duplicate VERSION lines are not bumpable");

// ================================================================ 2. scope, required checks, provenance
ok(J(W.cmScope(PATH)).kind === "worker" && J(W.cmScope("docs/a/b.md")).kind === "doc" && J(W.cmScope("qnfo-x/README.md")).kind === "doc" && J(W.cmScope("scripts/cf_ops_actions.py")).kind === "script" && J(W.cmScope("scripts/drift-check.mjs")).kind === "script" && J(W.cmScope("scripts/fleet-autoaudit.py")).kind === "script", "worker.js, docs/**.md, <dir>/README.md and fleet scripts are in scope (SCOPE-SCRIPTS-1)");
ok(["scripts/deploy_gate.py", "scripts/mirror-guard.py", "scripts/version-bump-guard.py", "scripts/workflow-lint.py", "scripts/run-suites.mjs", "scripts/canary_revert.py", "scripts/canonical_deploy.py", "scripts/raw_put.py", "scripts/remediation_consumer.py", "scripts/secret_lock.py", "scripts/fold_worker_selftest.py", "scripts/cf_ops_delete_worker_test.py", "scripts/probe-semicolon.test.mjs", "scripts/mention-radar-test.mjs", "scripts/x.sh", "scripts/sub/x.py", ".github/workflows/a.yml", "qnfo-x/wrangler.toml", "migrations/a.test.mjs", "migrations/a.sql.bak", "mind/wrangler.toml.bak", "qnfo-x/a.test.mjs", "qnfo-x/inline-x.mjs", "docs/../x.md"].every((p) => !W.cmScope(p).ok), "gates, guards, suites, deploy primitives, the loop's runners, workflows, configs, tests and other modules are out of scope");
// MERGE-SCOPE-DATA-SURFACES-1 (agent_issues 100617): the two surfaces the loop is asked to remediate but could never merge.
ok(J(W.cmScope("migrations/2026-10-22-close-channel-required.sql")).ok === true && J(W.cmScope("migrations/2026-10-22-close-channel-required.sql")).kind === "migration", "a migration file auto-merges (a file without the MIGRATION-RUNNER-1 header is inert)");
ok(J(W.cmScope("mind/data/entries-a.json")).ok === true && J(W.cmScope("mind/data/entries-a.json")).kind === "mind-data" && J(W.cmScope("mind/wrangler.toml")).ok === true && J(W.cmScope("mind/wrangler.toml")).kind === "mind-data", "the q08-mind content and config surface auto-merges");
ok(J(W.cmScope("workers/qnfo-fleet-control/worker.js")).ok === false && /does not exist in qnfo-workers/.test(String(W.cmScope("workers/qnfo-fleet-control/worker.js").why)) && /re-author the task against qnfo-fleet-control\/worker.js/.test(String(W.cmScope("workers/qnfo-fleet-control/worker.js").why)), "a spurious workers/ prefix is refused with the corrected path, before any model call");
ok(["qnfo-observability", "qnfo-autonomy-scorer", "qnfo-containers-pilot", "qnfo-code-agent"].every((w) => !W.cmScope(w + "/worker.js").ok), "the scorer host, the scorer, the container pilot and the retired code agent never auto-merge");
// CODE-LOOP-CONTROL-PLANE-1 (0.37.0, owner directive 2026-10-19): the code loop may always change the verifier workers and its own code.
ok(["qnfo-fleet-control", "qnfo-ops", "qnfo-deploy-guard", "qnfo-code-orchestrator"].every((w) => J(W.cmScope(w + "/worker.js")).ok === true && J(W.cmScope(w + "/worker.js")).kind === "worker" && J(W.cmScope(w + "/worker.js")).mirror === w + "/deployed-current.worker.js"), "qnfo-fleet-control, qnfo-ops, qnfo-deploy-guard and qnfo-code-orchestrator auto-merge with their mirror (the loop's own code)");
ok(J(W.cmScope("scripts/code-task-publish.py")).ok === true && J(W.cmScope("scripts/code-task-publish.py")).kind === "script" && !W.cmScope("scripts/code-task-publish.test.mjs").ok, "the loop's own publish script is in scope, its test is not");
// CONTROL-PLANE-FUNCTIONAL-CANARY-1 (0.20.0, agent_issues 2176): the two control-plane workers with a functional canary and an automatic revert are in scope.
ok(["qnfo-ai", "qnfo-gateway"].every((w) => J(W.cmScope(w + "/worker.js")).ok === true && J(W.cmScope(w + "/worker.js")).kind === "worker"), "qnfo-ai and qnfo-gateway (functional canary) auto-merge");
ok(J(W.cmRequired([PATH, MIRROR])).join(",") === "mirror-guard,comparator,guard", "a worker.js needs mirror-guard, comparator and guard");
ok(J(W.cmRequired(["docs/x.md"])).join(",") === "mirror-guard,comparator", "a doc needs no version-bump guard (its workflow does not run for docs)");
ok(J(W.cmRequired(["docs/QUNIVERSE-CHARTER.md"])).indexOf("charter") >= 0 && J(W.cmRequired(["qnfo-code-orchestrator/README.md"])).indexOf("test") >= 0, "charter-guard and code-loop-test are required where they run");
ok(W.cmTrusted("qnfo-fleet-dashboard:owner-request", "OWNER-TASK-12: x") && W.cmTrusted("claude-session-intake-smoke", "x"), "owner tasks and session-filed issues are trusted origins");
ok(!W.cmTrusted("qnfo-fleet-dashboard:owner-request", "INTENT-TASK-3: x") && !W.cmTrusted("kaizen-ai", "x") && !W.cmTrusted("email-composer", "x"), "feed intents, model and email loops are not trusted origins");
ok(W.cmTrusted("kaizen-ai", "x", "kaizen-*") && !W.cmTrusted("claude-session-x", "x", "kaizen-*"), "ops_config code_merge_trusted_sources replaces the default list");

// ================================================================ 3. the decision
ok(act(task(), g()).action === "merge", "all gates green: merge", act(task(), g()));
// MERGE-VERIFY-ATTEMPTS-1: a task that verified after SELF-REPAIR-1 retries (step done, no last_error) is mergeable; the bound
// is the orchestrator's MAX_ATTEMPTS * RETRY_ROUNDS
ok(act(task({ attempts: 4 }), g()).action === "merge" && act(task({ attempts: 8 }), g()).action === "merge", "a task that verified after self-repair rounds (attempts 4, 8) merges");
{
  const ma = Number((/^const MAX_ATTEMPTS = (\d+);/m.exec(orch) || [])[1]), rr = Number((/^const RETRY_ROUNDS = (\d+);/m.exec(orch) || [])[1]);
  const cm = Number((/^var CM_TASK_MAX_ATTEMPTS = (\d+);/m.exec(src) || [])[1]);
  ok(ma > 0 && rr > 0 && cm === ma * rr, "CM_TASK_MAX_ATTEMPTS equals the orchestrator's MAX_ATTEMPTS * RETRY_ROUNDS", { ma, rr, cm });
}

ok(act(task(), g({ integrity: undefined })).action === "need-integrity", "integrity is fetched only when every cheap gate passed");
const refuses = [
  ["a branch that is not the loop's own", task({ branch: "feature-x" }), g()],
  ["a pull URL of another repository", task({ pr_url: "https://github.com/QNFO/other/pull/401" }), g()],
  ["a fork head", task(), g({ pr: prJson({ head: { ref: BRANCH, sha: "h1", repo: { full_name: "evil/qnfo-workers" } } }) })],
  ["a head ref that is not the task branch", task(), g({ pr: prJson({ head: { ref: "codeagent-zzz", sha: "h1", repo: { full_name: "QNFO/qnfo-workers" } } }) })],
  ["a base other than main", task(), g({ pr: prJson({ base: { ref: "develop", repo: { full_name: "QNFO/qnfo-workers" } } }) })],
  ["verify not done", task({ step: "verify" }), g()],
  ["as many failed attempts as self-repair allows", task({ attempts: 9 }), g()],
  ["a last_error", task({ last_error: "verify failed" }), g()],
  ["no stored patch", task({ ctx: JSON.stringify({ base: BASE }) }), g()],
  ["unparseable ctx", task({ ctx: "{nope" }), g()],
  ["an extra file", task(), g({ files: [{ filename: PATH, status: "modified" }, { filename: "scripts/x.py", status: "modified" }] })],
  ["only the mirror", task(), g({ files: [{ filename: MIRROR, status: "modified" }] })],
  ["an added file", task(), g({ files: [{ filename: PATH, status: "added" }] })],
  ["a path out of scope", task({ path: "scripts/deploy_gate.py" }), g({ files: [{ filename: "scripts/deploy_gate.py", status: "modified" }] })],
  ["a denied worker", task({ path: "qnfo-observability/worker.js" }), g({ files: [{ filename: "qnfo-observability/worker.js", status: "modified" }] })],
  ["an untrusted origin", task(), g({ provenance: { ok: false, why: "source issue #50 came from 'kaizen-ai'" } })],
  ["a failed required check", task(), g({ checks: green("h1", ["gate", "mirror-guard", "comparator"]).concat([{ id: 300, name: "guard", status: "completed", conclusion: "failure" }]) })],
  ["a failing commit status", task(), g({ status: { state: "failure", total_count: 1 } })],
  ["a merge conflict", task(), g({ pr: prJson({ mergeable: false, mergeable_state: "dirty" }) })],
  ["content other than the verified patch", task(), g({ integrity: { ok: false, why: "qnfo-demo/worker.js at the PR head is not the verified patch" } })],
  ["a container worker", task(), g({ integrity: { ok: true, revertible: true, containers: true } })],
  ["a worker that cannot be auto-reverted", task(), g({ integrity: { ok: true, revertible: false, revert_why: "no single var VERSION" } })],
];
for (const [label, t, gg] of refuses) ok(act(t, gg).action === "refuse", "refuse: " + label, act(t, gg));
const waits = [
  ["a draft", g({ pr: prJson({ draft: true }) })],
  ["a required check still running", g({ checks: green("h1", ["gate", "mirror-guard", "comparator"]).concat([{ id: 301, name: "guard", status: "in_progress", conclusion: null }]) })],
  ["one required check missing", g({ checks: green("h1", ["gate", "mirror-guard", "comparator"]) })],
  ["a non-required check failed", g({ checks: green("h1", ["gate", "mirror-guard", "comparator", "guard"]).concat([{ id: 302, name: "CodeQL", status: "completed", conclusion: "failure" }]) })],
  ["a pending commit status", g({ status: { state: "pending", total_count: 2 } })],
  ["mergeability not computed", g({ pr: prJson({ mergeable: null, mergeable_state: "unknown" }) })],
  ["a transient integrity read", g({ integrity: { ok: false, transient: true, why: "compare HTTP 502" } })],
  ["a transient provenance read", g({ provenance: { ok: false, transient: true, why: "source issue #50 could not be read" } })],
];
for (const [label, gg] of waits) ok(act(task(), gg).action === "wait", "wait: " + label, act(task(), gg));
ok(act(task(), g({ checks: green("h1", ["gate", "mirror-guard", "comparator"]).concat([{ id: 50, name: "guard", status: "completed", conclusion: "cancelled" }, { id: 51, name: "guard", status: "completed", conclusion: "success" }]) })).action === "merge", "the latest run per check decides (a cancelled run superseded by a green one)");
ok(act(task(), g({ pr: prJson({ mergeable_state: "behind" }) })).action === "merge", "a branch behind main is mergeable (no up-to-date rule on main)");
const noChecks = g({ checks: [{ id: 9, name: "CodeQL", status: "completed", conclusion: "success" }], integrity: undefined });
let nc = act(task(), noChecks);
ok(nc.action === "wait" && nc.mark && nc.mark.nochecks_sha === "h1" && nc.mark.nochecks_since === new Date(NOW).toISOString(), "no required check on a new head: wait and start the 120-minute clock (no empty commit, no integrity fetch)", nc);
ok(act(task({ nochecks_sha: "h1", nochecks_since: ago(1.5) }), noChecks).action === "wait" && !act(task({ nochecks_sha: "h1", nochecks_since: ago(1.5) }), noChecks).mark, "inside 120 minutes: keep waiting, the clock is not reset");
ok(act(task({ nochecks_sha: "h1", nochecks_since: ago(2.2) }), noChecks).action === "reopen", "SLA-120M-7: past 120 minutes (not 3 h) the runner acts", act(task({ nochecks_sha: "h1", nochecks_since: ago(2.2) }), noChecks));
nc = act(task({ nochecks_sha: "h1", nochecks_since: ago(4) }), noChecks);
ok(nc.action === "reopen" && /within 120 minutes/.test(nc.why) && nc.mark.nochecks_sha === "h1+reopened" && nc.mark.nochecks_since === new Date(NOW).toISOString(), "MERGE-NOCHECKS-REOPEN-1: no required check 120 minutes after the runner first saw the head: close and reopen once with the fleet token (no model call)", nc);
ok(act(task({ nochecks_sha: "h1+reopened", nochecks_since: ago(1) }), noChecks).action === "wait", "after the reopen the clock runs again");
nc = act(task({ nochecks_sha: "h1+reopened", nochecks_since: ago(4) }), noChecks);
ok(nc.action === "refuse" && /nor within 120 minutes after the runner closed and reopened/.test(nc.why), "still no check 120 minutes after the reopen: refuse, naming both waits", nc);
nc = act(task({ nochecks_sha: "h1", nochecks_since: ago(1) }), g({ checks: [{ id: 9, name: "CodeQL", status: "completed", conclusion: "success" }], integrity: undefined, pr: prJson({ mergeable: false, mergeable_state: "dirty" }) }));
ok(nc.action === "refuse" && nc.stale_check === true && /conflicts with main/.test(nc.why), "NOCHECKS-CONFLICT-1: no checks on a dirty PR is a stale base at once (PR 597), not a 120-minute wait", nc);
ok(act(task({ nochecks_sha: "h0", nochecks_since: ago(4) }), noChecks).mark.nochecks_sha === "h1", "a new head restarts the clock");
const merged = act(task(), g({ pr: prJson({ merged: true, state: "closed", merged_by: { login: "rwnq8" } }) }));
ok(merged.action === "reconcile" && merged.status === "merged" && merged.by === "gh:rwnq8", "a PR a person merged is reconciled with who merged it");
ok(act(task(), g({ pr: prJson({ state: "closed" }) })).status === "closed", "a PR a person closed is reconciled as closed");
const docT = task({ path: "docs/x.md", ctx: JSON.stringify({ patch: WHOLE }) });
const docG = g({ pr: prJson({ body: "Implemented in: #400" }), files: [{ filename: "docs/x.md", status: "modified" }], checks: green("h1", ["gate", "mirror-guard", "comparator"]), integrity: { ok: true } });
ok(act(docT, { ...docG, pr: prJson() }).action === "refuse", "documentation without implementing evidence stays incomplete");
ok(act(docT, docG).action === "refuse" && /CODE-CHANGE-REQUIRED-1/.test(act(docT, docG).why), "another PR cannot exempt a documentation-only diff");
const scrT = task({ path: "scripts/cf_ops_actions.py", ctx: JSON.stringify({ patch: WHOLE }) });
const scrG = g({ files: [{ filename: "scripts/cf_ops_actions.py", status: "modified" }], checks: green("h1", ["gate", "mirror-guard", "comparator"]), integrity: { ok: true } });
ok(act(scrT, scrG).action === "merge" && act(scrT, scrG).kind === "script", "SCOPE-SCRIPTS-1: a fleet script merges on gate, mirror-guard and comparator");
ok(act(task({ path: "scripts/deploy_gate.py", ctx: JSON.stringify({ patch: WHOLE }) }), g({ files: [{ filename: "scripts/deploy_gate.py", status: "modified" }], checks: green("h1", ["gate", "mirror-guard", "comparator"]), integrity: { ok: true } })).action === "refuse", "a CI gate script never merges on its own");
ok(act(task({ status: "pr_open", path: "scripts/cf_ops_actions.py", ctx: JSON.stringify({ proposal: "x\n" }) }), scrG).action === "merge", "a code-agent implementation pr_open row with a stored proposal can merge");
ok(act(task({ status: "pr_open", ctx: JSON.stringify({ proposal: "x" }) }), g({ integrity: { ok: true, revertible: false, revert_why: "a code-agent pull request stores no patch to invert" } })).action === "refuse", "a code-agent worker.js PR is refused (no patch to revert)");
// ---- opening a pushed branch (status branch_pushed): cmOpenDecide
const pushedT = (over) => task(Object.assign({ status: "branch_pushed", pr_url: "https://github.com/QNFO/qnfo-workers/compare/main..." + BRANCH + "?expand=1" }, over || {}));
const og = (over) => Object.assign({ pulls: [], head_sha: "h1", files: [{ filename: PATH, status: "modified" }, { filename: MIRROR, status: "modified" }], provenance: { ok: true, origin: "issue #50" }, integrity: { ok: true, revertible: true, containers: false, version_to: "1.2.4-codeagent" } }, over || {});
const oact = (t, gg) => J(W.cmOpenDecide(t, gg));
ok(oact(pushedT(), og()).action === "open", "a verified, in-scope, trusted, intact branch is opened as a PR", oact(pushedT(), og()));
ok(oact(pushedT(), og({ integrity: undefined })).action === "need-integrity", "integrity is checked before a PR (and with it CI) is opened");
const adopt = oact(pushedT(), og({ pulls: [prJson({ number: 455, state: "closed", merged: true })] }));
ok(adopt.action === "adopt" && adopt.pr === 455, "an existing PR for the branch (any state) is adopted, never duplicated", adopt);
ok(oact(pushedT(), og({ pulls: [prJson({ number: 456, head: { ref: BRANCH, sha: "h1", repo: { full_name: "evil/qnfo-workers" } } })] })).action === "open", "a fork's PR with the same branch name is not adopted");
const orefuses = [
  ["a branch that is not the loop's own", pushedT({ branch: "feature-x" }), og()],
  ["a deleted branch", pushedT(), og({ head_sha: null, branch_missing: true })],
  ["an extra file on the branch", pushedT(), og({ files: [{ filename: PATH, status: "modified" }, { filename: "scripts/deploy_gate.py", status: "modified" }] })],
  ["a path out of scope", pushedT({ path: "scripts/deploy_gate.py" }), og({ files: [{ filename: "scripts/deploy_gate.py", status: "modified" }] })],
  ["an untrusted origin", pushedT(), og({ provenance: { ok: false, why: "kaizen-ai" } })],
  ["verify not passed", pushedT({ step: "verify" }), og()],
  ["verify not passed (a last_error)", pushedT({ last_error: "verify failed" }), og()],
  ["content other than the verified patch", pushedT(), og({ integrity: { ok: false, why: "not the verified patch" } })],
  ["a worker that cannot be auto-reverted", pushedT(), og({ integrity: { ok: true, revertible: false, revert_why: "const VERSION" } })],
];
for (const [label, t, gg] of orefuses) ok(oact(t, gg).action === "refuse", "not opened: " + label, oact(t, gg));
ok(oact(pushedT(), og({ pulls: undefined })).action === "wait" && oact(pushedT(), og({ provenance: { ok: false, transient: true, why: "d1" } })).action === "wait", "unread pulls or a transient provenance read only wait");
// REBASE-BRANCH-ACCEPT-1 (0.11.1): the -r<n> rebuild of cmRequeueStale is the loop's own branch (codeagent-3oa9p0pglnnj-r2 was refused 2026-10-07T15:20Z)
const r2T = (over) => pushedT(Object.assign({ branch: BRANCH + "-r2", pr_url: "https://github.com/QNFO/qnfo-workers/compare/main..." + BRANCH + "-r2?expand=1" }, over || {}));
ok(oact(r2T(), og()).action === "open", "REBASE-BRANCH-ACCEPT-1: a -r2 rebuilt branch is opened as a pull request", oact(r2T(), og()));
ok(oact(r2T({ branch: BRANCH + "-r12" }), og()).action === "open", "a -r12 rebuild is the loop's own branch too");
const r2adopt = oact(r2T(), og({ pulls: [prJson({ number: 457, head: { ref: BRANCH + "-r2", sha: "h1", repo: { full_name: "QNFO/qnfo-workers" } } })] }));
ok(r2adopt.action === "adopt" && r2adopt.pr === 457, "an existing pull request for the -r2 branch is adopted", r2adopt);
ok(oact(pushedT(), og({ pulls: [prJson({ number: 458, head: { ref: BRANCH + "-r2", sha: "h1", repo: { full_name: "QNFO/qnfo-workers" } } })] })).action === "open" && oact(r2T(), og({ pulls: [prJson({ number: 459 })] })).action === "open", "a pull request for the other name (base vs -r2) is not adopted");
for (const bad of [BRANCH + "-r", BRANCH + "-rx", BRANCH + "-r0", BRANCH + "-r2-r2", BRANCH + "-r2x", BRANCH + "-r1000", "codeagent-zzzzzzzzzzzz-r2", BRANCH + "x-r2"]) ok(oact(pushedT({ branch: bad }), og()).action === "refuse" && /not a code-loop branch/.test(oact(pushedT({ branch: bad }), og()).why), "not opened: branch " + bad, oact(pushedT({ branch: bad }), og()));
// and cmDecide (a pull request on the -r2 branch) takes the same gates as the base branch
const r2M = task({ branch: BRANCH + "-r2" }), r2G = g({ pr: prJson({ head: { ref: BRANCH + "-r2", sha: "h1", repo: { full_name: "QNFO/qnfo-workers" } } }) });
ok(act(r2M, r2G).action === act(task(), g()).action && act(task(), g()).action === "merge", "REBASE-BRANCH-ACCEPT-1: a -r2 branch's pull request merges like the base branch's", { r2: act(r2M, r2G), base: act(task(), g()) });
ok(act(r2M, g()).action === "refuse" && act(task({ branch: BRANCH + "-r2-r2" }), r2G).action === "refuse", "a -r2 task whose pull request head is the base branch, or a malformed rebuild name, is refused");

// ================================================================ 4. end to end: pushed branch -> PR opened by the runner -> merge -> deploy -> verify
function seedTask(over) {
  const t = task(over);
  db.prepare("INSERT INTO code_tasks (id, repo, path, goal, status, step, attempts, ctx, branch, pr_url, last_error, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(t.id, t.repo, t.path, t.goal, t.status, t.step, t.attempts, t.ctx, t.branch, t.pr_url, t.last_error, t.created_at, t.updated_at);
  return t;
}
function seedHead(headSha) {
  gh.contents["base0:" + PATH] = BASE; gh.contents["base0:" + MIRROR] = BASE;
  gh.contents[headSha + ":" + PATH] = NEXT; gh.contents[headSha + ":" + MIRROR] = NEXT;
  gh.contents[headSha + ":" + DIR + "/wrangler.toml"] = 'name = "qnfo-demo"\nmain = "worker.js"\n';
  gh.compareFiles[headSha] = [{ filename: PATH, status: "modified" }, { filename: MIRROR, status: "modified" }];
}
function seedWorkerPr(num, branch, headSha) {
  gh.pulls[num] = prJson({ number: num, head: { ref: branch, sha: headSha, repo: { full_name: "QNFO/qnfo-workers" } } });
  gh.files[num] = [{ filename: PATH, status: "modified" }, { filename: MIRROR, status: "modified" }];
  seedHead(headSha);
}
freshDb(); freshGh();
const env = { AUDIT, GITHUB_TOKEN: "test-token" };
// ---- REBASE-INTEGRITY-1 (0.11.2): a branch rebuilt from ctx.edits on a moved main is verified by its edits, not the parked patch
{
  const BASE2 = BASE.replace('var VERSION = "1.2.3-demo";', 'var VERSION = "1.2.9-moved";').replace("function b() {", "function b0() {\n  return 0;\n}\nfunction b() {");
  const EDITS = [{ search: "  return 1;", replace: "  return 11;" }];
  const REBUILT = W.cmRebaseText(BASE2, EDITS, true);
  ok(REBUILT && REBUILT.includes("  return 11;") && REBUILT.includes("function b0() {") && /var VERSION = "1\.2\.10-codeagent";/.test(REBUILT), "cmRebaseText re-applies the edits on the moved base and bumps its VERSION as the publisher does", REBUILT && REBUILT.slice(0, 80));
  const noop = [{ search: "  return 1;", replace: "  return 1;" }];
  ok(W.cmRebaseText(BASE2, noop, false) === null && W.cmRebaseText(BASE2, noop, true) === BASE2.replace('"1.2.9-moved"', '"1.2.10-codeagent"') && W.cmRebaseText(BASE2 + "  return 1;\n", EDITS, true) === null && W.cmRebaseText(BASE2, [], true) === null, "a no-op edit gives nothing on a non-js file and only the VERSION bump on a worker (as the publisher does); an ambiguous SEARCH or no edits give nothing");
  gh.contents["mb2:" + PATH] = BASE2; gh.contents["mb2:" + MIRROR] = BASE2;
  gh.contents["r2h:" + PATH] = REBUILT; gh.contents["r2h:" + MIRROR] = REBUILT; gh.contents["r2h:" + DIR + "/wrangler.toml"] = 'name = "qnfo-demo"\nmain = "worker.js"\n';
  const rctx = { base: BASE, patch: PATCH, edits: EDITS, mirror: MIRROR, rebased: "REBASE-BEFORE-PUBLISH-1: the parked patch did not apply to main@mb2; 1 edit re-applied to the current file, mirror rewritten (no model call)" };
  const rt = task({ status: "branch_pushed", branch: BRANCH + "-r2", pr_url: null, ctx: JSON.stringify(rctx) });
  const ig = J(await W.cmIntegrity(env, rt, "r2h", [PATH, MIRROR], W.cmScope(PATH), "mb2"));
  ok(ig.ok === true && ig.revertible === true && ig.version_to === "1.2.10-codeagent" && ig.merge_base === "mb2", "REBASE-INTEGRITY-1: the rebuilt branch is intact (merge base + edits + bump), revertible, and carries the bumped VERSION", ig);
  const stale = task({ status: "branch_pushed", branch: BRANCH + "-r2", pr_url: null, ctx: JSON.stringify({ base: BASE, patch: PATCH, edits: EDITS, mirror: MIRROR }) });
  const ig0 = J(await W.cmIntegrity(env, stale, "r2h", [PATH, MIRROR], W.cmScope(PATH), "mb2"));
  ok(ig0.ok === false && /does not apply to/.test(ig0.why), "without ctx.rebased the parked patch still decides (it does not apply on the moved base)", ig0);
  gh.contents["r2x:" + PATH] = REBUILT + "// other\n"; gh.contents["r2x:" + MIRROR] = REBUILT; gh.contents["r2x:" + DIR + "/wrangler.toml"] = 'name = "qnfo-demo"\n';
  const igx = J(await W.cmIntegrity(env, rt, "r2x", [PATH, MIRROR], W.cmScope(PATH), "mb2"));
  ok(igx.ok === false && /is not the verified patch/.test(igx.why), "other content on the rebuilt head is refused", igx);
  gh.contents["mb3:" + PATH] = BASE2.replace("  return 1;", "  return 2;"); gh.contents["mb3:" + MIRROR] = gh.contents["mb3:" + PATH];
  const igm = J(await W.cmIntegrity(env, rt, "r2h", [PATH, MIRROR], W.cmScope(PATH), "mb3"));
  ok(igm.ok === false && /do not re-apply/.test(igm.why), "edits whose SEARCH is gone from the merge base are refused with the REBASE-INTEGRITY-1 reason", igm);
  const rv = W.cmRevertEdits(REBUILT, EDITS, "-revert-c9");
  ok(rv && rv.content.includes("  return 1;") && !rv.content.includes("  return 11;") && rv.from === "1.2.10-codeagent" && rv.to === "1.2.11-revert-c9", "cmRevertEdits puts the SEARCH text back on today's main and bumps main's VERSION", rv && { from: rv.from, to: rv.to });
  ok(W.cmEditsApply("aXbXc", [{ search: "X", replace: "Y" }], false) === null && W.cmEditsApply("abc", [{ search: "b", replace: "" }], true) === null && W.cmEditsApply("abc", [{ search: "a", replace: "1" }, { search: "c", replace: "3" }], false) === "1b3", "cmEditsApply: unique SEARCH only, an empty REPLACE cannot be inverted, several edits apply in place");
}
db.prepare("INSERT INTO agent_issues (id, title, description, source, status) VALUES (50, 'OWNER-TASK-9: fix a', 'desc', 'qnfo-fleet-dashboard:owner-request', 'open')").run();
seedTask({ status: "branch_pushed", pr_url: "https://github.com/QNFO/qnfo-workers/compare/main..." + BRANCH + "?expand=1" });
gh.branches[BRANCH] = "h1";
seedHead("h1");
let r = J(await W.codeMergeTick(env, { now: NOW }));
const cols = rows("PRAGMA table_info(code_tasks)").map((c) => c.name);
ok(["merged_by", "merged_at", "merge_state", "green_since", "nochecks_sha", "pr_opened_by", "version_to", "revert_cid"].every((c) => cols.includes(c)) && !cols.includes("kicked_sha"), "the runner adds its columns to code_tasks");
ok(W.CM_DEFAULT_ENABLED === true && !r.disabled, "with no ops_config row the runner runs (default on)");
ok(r.opened[0].action === "open" && gh.newPulls.length === 1 && gh.newPulls[0].head === BRANCH && gh.newPulls[0].base === "main" && !/\n/.test(gh.newPulls[0].title), "a pushed branch is opened as a PR by the runner (fleet token), head = the task branch", r.opened);
let row = one("SELECT * FROM code_tasks WHERE id = ?", ID);
ok(row.status === "published" && row.pr_url === "https://github.com/QNFO/qnfo-workers/pull/900" && row.pr_opened_by === "qnfo-fleet-control" && row.pr_opened_at === new Date(NOW).toISOString(), "the row becomes published with the pull URL and who opened it", row);
ok(one("SELECT COUNT(*) n FROM cloud_ops_events WHERE kind = 'code-merge.pr-opened'").n === 1 && gh.commits.length === 0 && gh.refs.length === 0, "the open writes one cloud_ops_events row; no commit is pushed");
ok(r.decided.length === 1 && r.decided[0].action === "wait" && gh.merges.length === 0, "the new PR is a merge candidate in the same tick, but no check has run yet", r.decided);
const hb = one("SELECT * FROM cloud_ops_events WHERE id = 'code-merge-tick-2026-10-03'");
ok(hb && hb.status === "ok" && hb.ts === new Date(NOW).toISOString(), "each tick upserts the day's heartbeat, status ok", hb);
const fo = one("SELECT * FROM cloud_ops_events WHERE id = 'code-merge-first-ok'");
ok(fo && fo.status === "ok" && fo.ts === new Date(NOW).toISOString(), "the first ok tick writes code-merge-first-ok", fo);
row = one("SELECT * FROM code_tasks WHERE id = ?", ID);
ok(row.nochecks_sha === "h1" && row.nochecks_since === new Date(NOW).toISOString(), "the no-checks clock starts for the head", row);
gh.checks.h1 = green("h1", ["gate", "mirror-guard", "comparator"]).concat([{ id: 400, name: "guard", status: "in_progress", conclusion: null }]);
r = J(await W.codeMergeTick(env, { now: NOW + 36e5 }));
ok(r.decided[0].action === "wait" && /running guard/.test(r.decided[0].why) && gh.merges.length === 0, "checks started by the PR the runner opened: wait while one runs", r.decided);
ok(one("SELECT ts FROM cloud_ops_events WHERE id = 'code-merge-first-ok'").ts === new Date(NOW).toISOString(), "code-merge-first-ok is written once, never moved");
gh.checks.h1 = green("h1", ["gate", "mirror-guard", "comparator", "guard"]);
r = J(await W.codeMergeTick(env, { now: NOW + 2 * 36e5 }));
ok(r.decided[0].action === "merge" && gh.merges.length === 1 && gh.merges[0].pr === 900 && gh.merges[0].sha === "h1" && gh.merges[0].merge_method === "squash", "green checks: squash-merged, pinned to the tested head", r.decided);
ok(/CODE-TASK-MERGE-RUNNER-1/.test(gh.merges[0].commit_message) && !/\n/.test(gh.merges[0].commit_title) && /\(#900\)$/.test(gh.merges[0].commit_title), "the merge commit names the runner; the title is one line", gh.merges[0]);
row = one("SELECT * FROM code_tasks WHERE id = ?", ID);
ok(row.status === "merged" && row.merged_by === "qnfo-fleet-control" && row.merge_state === "deploying" && row.version_to === "1.2.4-codeagent" && row.merged_sha === "merge-900", "D1 records merged_by qnfo-fleet-control, the merge sha and the VERSION to verify", row);
ok(gh.calls.includes("DELETE /git/refs/heads/" + BRANCH), "the task branch is deleted after the merge (as evolve does)");
ok(one("SELECT COUNT(*) n FROM cloud_ops_events WHERE kind = 'code-merge.merged' AND status = 'ok'").n === 1, "the merge writes one cloud_ops_events row");
r = J(await W.codeMergeTick(env, { now: NOW + 3 * 36e5 }));
ok(r.advanced[0].merge_state === "deploying" && gh.merges.length === 1, "no deploy yet: waits on the canonical deploy, merges nothing new");
db.prepare("INSERT INTO fleet_deploys (worker, to_sha, ok, ts) VALUES ('qnfo-demo', '1.2.4-codeagent', 1, ?)").run(ago(-3.2));
r = J(await W.codeMergeTick(env, { now: NOW + 4 * 36e5 }));
ok(r.advanced[0].merge_state === "deployed" && one("SELECT merge_state FROM code_tasks WHERE id = ?", ID).merge_state === "deployed", "a fleet_deploys row for the new VERSION moves it to deployed");
db.prepare("INSERT INTO worker_live_audit (worker, http, live_version, probed_at) VALUES ('qnfo-demo', 200, '1.2.4-codeagent', ?)").run(new Date(NOW + 3.5 * 36e5).toISOString().replace("T", " ").slice(0, 19));
r = J(await W.codeMergeTick(env, { now: NOW + 5 * 36e5 }));
ok(r.advanced[0].merge_state === "verified" && one("SELECT merge_state FROM code_tasks WHERE id = ?", ID).merge_state === "verified", "a live audit after the deploy with http 200 and the VERSION verifies it");
ok(/CODE-TASK-MERGE-RUNNER-1: code task ct_abcdefghijklmn merged/.test(one("SELECT description FROM agent_issues WHERE id = 50").description), "the source issue gets the evidence line (not closed)");

// ================================================================ 5. a failed live check opens the inverse-patch revert
freshDb(); freshGh();
const T2 = "ct_zyxwvutsrqpo00";
db.prepare("INSERT INTO code_tasks (id, repo, path, goal, status, step, attempts, ctx, branch, pr_url, created_at, updated_at) VALUES (?, 'qnfo-workers', ?, 'fix', 'published', 'done', 0, ?, ?, 'https://github.com/QNFO/qnfo-workers/pull/402', ?, ?)").run(T2, PATH, JSON.stringify({ patch: PATCH }), "codeagent-" + T2.slice(3, 15), ago(6), ago(6));
await W.codeMergeTick(env, { now: NOW });   // adds the columns (no PR scripted: a read error, nothing else)
db.prepare("UPDATE code_tasks SET status = 'merged', merged_by = 'qnfo-fleet-control', merged_at = ?, merge_state = 'deployed', deployed_at = ?, version_to = '1.2.4-codeagent' WHERE id = ?").run(ago(2), ago(1.5), T2);
db.prepare("INSERT INTO fleet_deploys (worker, to_sha, ok, ts) VALUES ('qnfo-demo', '1.2.4-codeagent', 1, ?)").run(ago(1.5));
db.prepare("INSERT INTO worker_live_audit (worker, http, live_version, probed_at) VALUES ('qnfo-demo', 500, '1.2.4-codeagent', ?)").run(ago(1).replace("T", " ").slice(0, 19));
gh.contents["main:" + PATH] = NEXT;
r = J(await W.codeMergeTick(env, { now: NOW }));
const ev = one("SELECT * FROM evolve_candidates ORDER BY id DESC LIMIT 1");
row = one("SELECT * FROM code_tasks WHERE id = ?", T2);
ok(r.advanced[0].merge_state === "reverting" && row.merge_state === "reverting" && row.revert_cid === ev.id, "http 500 after the deploy: the task is reverting through an evolve candidate", r.advanced);
ok(ev.kind === "revert" && ev.status === "pr-open" && ev.worker === "qnfo-demo" && ev.pr_number === 900 && ev.branch === "evolve/qnfo-demo-c" + ev.id && ev.version_to === "1.2.5-revert-c" + ev.id, "the revert is an evolve 'revert' candidate with its own PR, branch and VERSION", ev);
ok(gh.blobs.length === 1 && gh.blobs[0] === BASE.replace('"1.2.3-demo"', '"1.2.5-revert-c' + ev.id + '"'), "the revert PR carries the inverse patch on today's main with a bumped VERSION (worker.js and mirror)");
r = J(await W.codeMergeTick(env, { now: NOW + 0.5 * 36e5 }));
ok(!gh.calls.includes("GET /pulls/900") && /evolve candidate/.test(r.advanced[0].note || ""), "while the revert is evolve's oldest in-flight candidate, evolveTick drives it (the runner only watches)", r.advanced);
db.prepare("INSERT INTO evolve_candidates (id, worker, ts, status, kind) VALUES (0, 'qnfo-other', ?, 'merged', 'fix')").run(ago(3));   // an older candidate holds evolve's slot
gh.pulls[900] = prJson({ number: 900, title: "evolve(qnfo-demo): revert", head: { ref: ev.branch, sha: "rv1", repo: { full_name: "QNFO/qnfo-workers" } } });
gh.checks.rv1 = green("rv1", ["gate", "guard", "mirror-guard", "comparator"]);
r = J(await W.codeMergeTick(env, { now: NOW + 0.6 * 36e5 }));
ok(gh.merges.some((x) => x.pr === 900) && one("SELECT status FROM evolve_candidates WHERE id = ?", ev.id).status === "merged", "when another candidate holds evolve's slot, the runner drives its revert through evAdvance (merged on green checks)", r.advanced);
db.prepare("DELETE FROM evolve_candidates WHERE id = 0").run();
db.prepare("UPDATE evolve_candidates SET status = 'reverted-verified' WHERE id = ?").run(ev.id);
r = J(await W.codeMergeTick(env, { now: NOW + 36e5 }));
ok(one("SELECT merge_state FROM code_tasks WHERE id = ?", T2).merge_state === "reverted", "a verified evolve revert marks the code task reverted");
db.prepare("UPDATE code_tasks SET merge_state = 'reverting' WHERE id = ?").run(T2);
db.prepare("UPDATE evolve_candidates SET status = 'ci-rejected' WHERE id = ?").run(ev.id);
await W.codeMergeTick(env, { now: NOW + 2 * 36e5 });
ok(one("SELECT merge_state FROM code_tasks WHERE id = ?", T2).merge_state === "revert-failed" && one("SELECT COUNT(*) n FROM agent_issues WHERE title LIKE 'CODE-MERGE-REVERT-FAILED-1:%' AND status = 'open'").n === 1, "a revert that does not land is revert-failed and files one agent_issue");
// deploy never happened
db.prepare("UPDATE code_tasks SET merge_state = 'deploying', merged_at = ?, version_to = '9.9.9-never' WHERE id = ?").run(ago(4), T2);
await W.codeMergeTick(env, { now: NOW });
ok(one("SELECT merge_state FROM code_tasks WHERE id = ?", T2).merge_state === "deploy-missing", "no fleet_deploys row 120 minutes after the merge: deploy-missing (as evolve)");

// ================================================================ 6. refusals, provenance, kill switch, person merges, budget
freshDb(); freshGh();
// ISSUE-NOTE-NEWLINE-1: the issue ends with its ACT-BRIDGE-1 lines, as a metric-trigger issue does
db.prepare("INSERT INTO agent_issues (id, title, description, source, status) VALUES (50, 'OWNER-TASK-9: fix a', 'd' || char(10) || 'code-task: repo=qnfo-workers path=qnfo-demo/worker.js' || char(10) || 'code-anchor: function a() {', 'qnfo-fleet-dashboard:owner-request', 'open')").run();
db.prepare("INSERT INTO agent_issues (id, title, description, source, status) VALUES (60, 'kaizen idea', 'd', 'kaizen-ai', 'open')").run();
seedTask();
seedWorkerPr(401, BRANCH, "h1");
gh.files[401].push({ filename: "scripts/x.py", status: "modified" });
r = J(await W.codeMergeTick(env, { now: NOW }));
row = one("SELECT * FROM code_tasks WHERE id = ?", ID);
ok(r.decided[0].action === "refuse" && row.status === "failed" && /^merge-runner: the branch changes/.test(row.last_error) && gh.merges.length === 0 && gh.commits.length === 0, "an extra file: failed (not an owner card) with the reason, nothing pushed, no merge", row);
ok(gh.comments.length === 1 && gh.comments[0].pr === 401 && /did not merge this pull request/.test(gh.comments[0].body) && /handed to the fleet/.test(gh.comments[0].body), "the refusal is explained on the PR");
const d50 = one("SELECT description FROM agent_issues WHERE id = 50").description;
ok(/CODE-TASK-MERGE-RUNNER-1: code task ct_abcdefghijklmn was refused by the merge runner/.test(d50) && one("SELECT status FROM agent_issues WHERE id = 50").status === "open", "MERGE-RUNNER-REFUSAL-TAXONOMY-1: the refusal is noted on the source issue, which stays open for the fleet");
ok(/\n\nCODE-TASK-MERGE-RUNNER-1: code task ct_abcdefghijklmn was refused/.test(d50) && /^code-anchor: function a\(\) \{$/m.test(d50) && !/\{ \| CODE-TASK/.test(d50), "ISSUE-NOTE-NEWLINE-1: the note starts on its own line and the issue's code-anchor: line stays intact", d50);
ok(one("SELECT COUNT(*) n FROM cloud_ops_events WHERE kind = 'code-merge.refused' AND status = 'refused'").n === 1, "the refusal writes one cloud_ops_events row");
r = J(await W.codeMergeTick(env, { now: NOW + 36e5 }));
ok(r.decided.length === 0 && gh.comments.length === 1, "a refused task is not re-evaluated or re-commented");
gh.pulls[401].merged = true; gh.pulls[401].state = "closed"; gh.pulls[401].merged_by = { login: "rwnq8" }; gh.pulls[401].merged_at = ago(0); gh.pulls[401].merge_commit_sha = "pm1";
r = J(await W.codeMergeTick(env, { now: NOW + 2 * 36e5 }));
row = one("SELECT * FROM code_tasks WHERE id = ?", ID);
ok(row.status === "merged" && row.merged_by === "gh:rwnq8" && r.reconciled.length === 1, "a refused PR a person merged later is recorded as merged by that person", row);

freshDb(); freshGh();
db.prepare("INSERT INTO agent_issues (id, title, description, source, status) VALUES (60, 'kaizen idea', 'd', 'kaizen-ai', 'open')").run();
seedTask({ goal: "[issue #60] kaizen idea" });
seedWorkerPr(401, BRANCH, "h1");
gh.checks.h1 = green("h1", ["gate", "mirror-guard", "comparator", "guard"]);
r = J(await W.codeMergeTick(env, { now: NOW }));
ok(r.decided[0].action === "refuse" && /not a trusted origin/.test(one("SELECT last_error FROM code_tasks WHERE id = ?", ID).last_error) && gh.merges.length === 0, "a task from an untrusted issue source is refused although CI is green");

freshDb(); freshGh();
seedTask({ goal: "direct task" });
seedWorkerPr(401, BRANCH, "h1");
gh.checks.h1 = green("h1", ["gate", "mirror-guard", "comparator", "guard"]);
gh.contents["h1:" + PATH] = NEXT + "// pushed by someone\n";
r = J(await W.codeMergeTick(env, { now: NOW }));
ok(r.decided[0].action === "refuse" && /is not the verified patch/.test(one("SELECT last_error FROM code_tasks WHERE id = ?", ID).last_error) && gh.merges.length === 0, "content beyond the verified patch at the PR head is refused");

freshDb(); freshGh();
db.prepare("INSERT INTO ops_config (key, value) VALUES ('code_merge_runner_enabled', '0')").run();
seedTask();
seedWorkerPr(401, BRANCH, "h1");
r = J(await W.codeMergeTick(env, { now: NOW }));
ok(r.disabled === true && gh.calls.length === 0 && one("SELECT status FROM cloud_ops_events WHERE id = 'code-merge-tick-2026-10-03'").status === "disabled" && !one("SELECT id FROM cloud_ops_events WHERE id = 'code-merge-first-ok'"), "kill switch '0': no GitHub call (nothing opened or merged), heartbeat 'disabled', no first-ok marker");
db.exec("UPDATE ops_config SET value = 'on'");
r = J(await W.codeMergeTick(env, { now: NOW }));
ok(!r.disabled && gh.calls.length > 0, "kill switch 'on' resumes the runner");

freshDb(); freshGh();
for (const [i, id] of ["ct_doc000000001", "ct_doc000000002"].entries()) {
  const num = 410 + i, br = "codeagent-" + id.slice(3, 15);
  db.prepare("INSERT INTO code_tasks (id, repo, path, goal, status, step, attempts, ctx, branch, pr_url, created_at, updated_at) VALUES (?, 'qnfo-workers', 'scripts/x.py', 'code', 'published', 'done', 0, ?, ?, ?, ?, ?)").run(id, JSON.stringify({ patch: WHOLE.split("docs/x.md").join("scripts/x.py") }), br, "https://github.com/QNFO/qnfo-workers/pull/" + num, ago(5), ago(5 - i));
  gh.pulls[num] = prJson({ number: num, body: "Implemented in: #400", head: { ref: br, sha: "d" + i, repo: { full_name: "QNFO/qnfo-workers" } } });
  gh.files[num] = [{ filename: "scripts/x.py", status: "modified" }];
  gh.checks["d" + i] = green("d" + i, ["gate", "mirror-guard", "comparator"]);
  gh.contents["base0:scripts/x.py"] = "one\ntwo\n"; gh.contents["d" + i + ":scripts/x.py"] = "one\ntwo\nthree\n";
}
r = J(await W.codeMergeTick(env, { now: NOW }));
const d1 = one("SELECT * FROM code_tasks WHERE id = 'ct_doc000000001'"), d2 = one("SELECT * FROM code_tasks WHERE id = 'ct_doc000000002'");
ok(gh.merges.length === 1 && d1.status === "merged" && d1.merge_state === "verified" && d1.merged_by === "qnfo-fleet-control", "a green implementation script PR merges and needs no worker deployment", d1);
ok(d2.status === "published" && d2.green_since === new Date(NOW).toISOString() && /one merge per tick/.test(d2.merge_note), "one merge per tick: the second green PR waits with green_since recorded", d2);
r = J(await W.codeMergeTick(env, { now: NOW + 36e5 }));
ok(gh.merges.length === 2 && one("SELECT status FROM code_tasks WHERE id = 'ct_doc000000002'").status === "merged", "the next tick merges it");

// MERGE-THROUGHPUT-1: the limit is an ops_config dial (clamped 1..5); both green implementation PRs merge in one tick when it is 2
{
  freshDb(); freshGh();
  db.prepare("INSERT INTO ops_config (key, value) VALUES ('code_merge_max_merges_per_tick', '2')").run();
  for (const [i, id] of ["ct_doc000000003", "ct_doc000000004"].entries()) {
    const num = 420 + i, br = "codeagent-" + id.slice(3, 15);
    db.prepare("INSERT INTO code_tasks (id, repo, path, goal, status, step, attempts, ctx, branch, pr_url, created_at, updated_at) VALUES (?, 'qnfo-workers', ?, 'code', 'published', 'done', 0, ?, ?, ?, ?, ?)").run(id, "scripts/y" + i + ".py", JSON.stringify({ patch: WHOLE.split("docs/x.md").join("scripts/y" + i + ".py") }), br, "https://github.com/QNFO/qnfo-workers/pull/" + num, "2026-10-02T00:00:00Z", "2026-10-02T00:00:00Z");
    gh.pulls[num] = prJson({ number: num, body: "Implemented in: #400", head: { ref: br, sha: "e" + i, repo: { full_name: "QNFO/qnfo-workers" } } });
    gh.files[num] = [{ filename: "scripts/y" + i + ".py", status: "modified" }];
    gh.checks["e" + i] = green("e" + i, ["gate", "mirror-guard", "comparator"]);
    gh.contents["base0:scripts/y" + i + ".py"] = "one\ntwo\n"; gh.contents["e" + i + ":scripts/y" + i + ".py"] = "one\ntwo\nthree\n";
  }
  const r2 = J(await W.codeMergeTick(env, { now: NOW }));
  ok(gh.merges.length === 2, "merge dial 2: two green PRs on different files merge in one tick", { merges: gh.merges.length, r: r2.decided });
  const c9 = await W.cmConfig({ AUDIT: env.AUDIT });
  db.exec("UPDATE ops_config SET value = '99' WHERE key = 'code_merge_max_merges_per_tick'");
  const c5 = await W.cmConfig({ AUDIT: env.AUDIT });
  db.exec("UPDATE ops_config SET value = 'abc' WHERE key = 'code_merge_max_merges_per_tick'");
  const c1 = await W.cmConfig({ AUDIT: env.AUDIT });
  ok(c9.maxMerges === 2 && c5.maxMerges === 5 && c1.maxMerges === 1, "merge dial is clamped to 1..5 and a non-number keeps the default 1", { c9: c9.maxMerges, c5: c5.maxMerges, c1: c1.maxMerges });
  freshDb(); freshGh();
}
freshDb(); freshGh();
db.prepare("INSERT INTO agent_issues (id, title, description, source, status) VALUES (50, 'OWNER-TASK-9: fix a', 'd', 'qnfo-fleet-dashboard:owner-request', 'open')").run();
seedTask();
seedWorkerPr(401, BRANCH, "h1");
gh.down = true;
r = J(await W.codeMergeTick(env, { now: NOW }));
ok(r.heartbeat === "error" && one("SELECT status FROM cloud_ops_events WHERE id = 'code-merge-tick-2026-10-03'").status === "error" && one("SELECT status FROM code_tasks WHERE id = ?", ID).status === "published", "GitHub unreachable: heartbeat 'error', the task is untouched");
gh.down = false;
gh.checks.h1 = green("h1", ["gate", "mirror-guard", "comparator", "guard"]);
await W.evSchema(env);
db.prepare("INSERT INTO evolve_candidates (worker, ts, status, kind) VALUES ('qnfo-demo', ?, 'pr-open', 'fix')").run(ago(1));
r = J(await W.codeMergeTick(env, { now: NOW }));
ok(r.decided[0].action === "wait" && /has a change in flight/.test(r.decided[0].why) && gh.merges.length === 0, "never merges while the same worker has an evolve candidate in flight", r.decided);
gh.mergeStatus = 405;
db.exec("UPDATE evolve_candidates SET status = 'verified'");
r = J(await W.codeMergeTick(env, { now: NOW }));
ok(r.decided[0].action === "merge-failed" && gh.calls.includes("PUT /pulls/401/update-branch") && one("SELECT status FROM code_tasks WHERE id = ?", ID).status === "published" && r.heartbeat === "ok", "a 405 merge asks GitHub to update the branch (evolve's path) and keeps the task waiting");

// a legacy PR opened with the Actions GITHUB_TOKEN: its checks never start, so after 120 minutes (SLA-120M-7; it was 3h) it is refused (no empty commit)
freshDb(); freshGh();
seedTask({ goal: "direct task" });
seedWorkerPr(401, BRANCH, "h1");
r = J(await W.codeMergeTick(env, { now: NOW }));
ok(r.decided[0].action === "wait" && one("SELECT nochecks_sha FROM code_tasks WHERE id = ?", ID).nochecks_sha === "h1", "a PR with no required check: the runner waits and starts the clock");
r = J(await W.codeMergeTick(env, { now: NOW + 3.5 * 36e5 }));
row = one("SELECT * FROM code_tasks WHERE id = ?", ID);
ok(r.decided[0].action === "reopen" && row.status === "published" && row.nochecks_sha === "h1+reopened" && gh.calls.filter((c) => c === "PATCH /pulls/401").length === 2 && gh.commits.length === 0 && gh.merges.length === 0, "3.5h later: the PR is closed and reopened once with the fleet token, nothing pushed, nothing merged", row);
ok(one("SELECT COUNT(*) n FROM cloud_ops_events WHERE kind = 'code-merge.reopened'").n === 1, "the reopen writes one cloud_ops_events row");
r = J(await W.codeMergeTick(env, { now: NOW + 7 * 36e5 }));
row = one("SELECT * FROM code_tasks WHERE id = ?", ID);
ok(r.decided[0].action === "refuse" && row.status === "failed" && /nor within 120 minutes after the runner closed and reopened/.test(row.last_error), "still no check 3.5h after the reopen: refused with the reason and handed to the fleet", row);
ok(gh.comments.length === 1 && /did not merge/.test(gh.comments[0].body) && one("SELECT COUNT(*) n FROM agent_issues WHERE title LIKE 'CODE-MERGE-REFUSED-1: code task ct_abcdefghijklmn%' AND status = 'open'").n === 1, "a direct task's refusal files one CODE-MERGE-REFUSED-1 fleet issue and explains it on the PR");
await W.codeMergeTick(env, { now: NOW + 8 * 36e5 });
ok(one("SELECT COUNT(*) n FROM agent_issues WHERE title LIKE 'CODE-MERGE-REFUSED-1:%'").n === 1, "the fleet issue is not filed twice");

// a pushed branch the runner will not open: refused, compare URL kept; a person opens and merges it -> reconciled
freshDb(); freshGh();
db.prepare("INSERT INTO agent_issues (id, title, description, source, status) VALUES (60, 'kaizen idea', 'd', 'kaizen-ai', 'open')").run();
seedTask({ goal: "[issue #60] kaizen idea", status: "branch_pushed", pr_url: "https://github.com/QNFO/qnfo-workers/compare/main..." + BRANCH + "?expand=1" });
gh.branches[BRANCH] = "h1"; seedHead("h1");
r = J(await W.codeMergeTick(env, { now: NOW }));
row = one("SELECT * FROM code_tasks WHERE id = ?", ID);
ok(r.opened[0].action === "refuse" && row.status === "failed" && /not a trusted origin/.test(row.last_error) && /\/compare\//.test(row.pr_url) && gh.newPulls.length === 0, "an untrusted branch is not opened as a PR (CI would run it); failed and handed to the fleet, compare URL kept", row);
gh.pulls[470] = prJson({ number: 470, state: "closed", merged: true, merged_by: { login: "rwnq8" }, merged_at: ago(-1), merge_commit_sha: "pm470" });
r = J(await W.codeMergeTick(env, { now: NOW + 2 * 36e5 }));
row = one("SELECT * FROM code_tasks WHERE id = ?", ID);
ok(row.status === "merged" && row.merged_by === "gh:rwnq8" && row.pr_url === "https://github.com/QNFO/qnfo-workers/pull/470", "a refused branch a person opened and merged is reconciled by branch, with who merged it", row);

// an existing PR for a pushed branch is adopted, not duplicated
freshDb(); freshGh();
seedTask({ goal: "direct task", status: "branch_pushed", pr_url: "https://github.com/QNFO/qnfo-workers/compare/main..." + BRANCH + "?expand=1" });
seedWorkerPr(480, BRANCH, "h1");
gh.branches[BRANCH] = "h1";
r = J(await W.codeMergeTick(env, { now: NOW }));
ok(r.opened[0].action === "adopt" && gh.newPulls.length === 0 && one("SELECT pr_url FROM code_tasks WHERE id = ?", ID).pr_url === "https://github.com/QNFO/qnfo-workers/pull/480", "a PR that already exists for the branch is adopted");

// PR-OPEN-422-ADOPT-1 (0.33.19, issue 100020): a 422 on POST /pulls because the PR now exists adopts it, not an error
freshDb(); freshGh();
db.prepare("INSERT INTO agent_issues (id, title, description, source, status) VALUES (50, 'OWNER-TASK-9: fix a', 'desc', 'qnfo-fleet-dashboard:owner-request', 'open')").run();
seedTask({ repo: "QNFO/qnfo-workers", status: "branch_pushed", pr_url: "https://github.com/QNFO/qnfo-workers/compare/main..." + BRANCH + "?expand=1" });
gh.branches[BRANCH] = "h1";
seedHead("h1");
gh.pull422 = 482;
r = J(await W.codeMergeTick(env, { now: NOW }));
ok(r.opened[0].action === "adopt" && r.opened[0].pr === 482 && one("SELECT status, pr_url FROM code_tasks WHERE id = ?", ID).pr_url === "https://github.com/QNFO/qnfo-workers/pull/482"
  && one("SELECT status FROM code_tasks WHERE id = ?", ID).status === "published" && one("SELECT COUNT(*) n FROM cloud_ops_events WHERE kind = 'code-merge.pr-open-failed'").n === 0,
  "PR-OPEN-422-ADOPT-1: a 422 because the PR already exists adopts it (published, no pr-open-failed); REPO-SLUG-PUBLISH-1: an owner-qualified repo row is opened", r.opened);
freshDb(); freshGh();
db.prepare("INSERT INTO agent_issues (id, title, description, source, status) VALUES (50, 'OWNER-TASK-9: fix a', 'desc', 'qnfo-fleet-dashboard:owner-request', 'open')").run();
seedTask({ status: "branch_pushed", pr_url: "https://github.com/QNFO/qnfo-workers/compare/main..." + BRANCH + "?expand=1" });
gh.branches[BRANCH] = "h1";
seedHead("h1");
gh.pull422bare = true;
r = J(await W.codeMergeTick(env, { now: NOW }));
ok(r.opened[0].action === "open-failed" && /No commits between/.test(r.opened[0].why) && one("SELECT status FROM code_tasks WHERE id = ?", ID).status === "branch_pushed",
  "a 422 with no PR to adopt stays an open failure and records GitHub's errors[] reason", r.opened);

// ================================================================ 7. evAdvance after the shared-helper refactor
freshDb(); freshGh();
await W.evSchema(env);
db.prepare("INSERT INTO evolve_candidates (worker, ts, status, kind, pr_number, branch, version_to, updated_at) VALUES ('qnfo-demo', ?, 'pr-open', 'fix', 501, 'evolve/qnfo-demo-c1', '1.2.4-evolve-c1', ?)").run(ago(1), ago(1));
gh.pulls[501] = prJson({ number: 501, title: "evolve(qnfo-demo): x", head: { ref: "evolve/qnfo-demo-c1", sha: "e1", repo: { full_name: "QNFO/qnfo-workers" } } });
gh.checks.e1 = green("e1", ["gate", "guard", "mirror-guard", "comparator"]);
let c = one("SELECT * FROM evolve_candidates WHERE id = 1");
let a = J(await W.evAdvance(env, c));
ok(a.status === "merged" && gh.merges.length === 1 && gh.merges[0].commit_title === "evolve(qnfo-demo): x (#501)" && gh.merges[0].commit_message === undefined, "evAdvance still self-merges on green required checks (same call as before)", a);
db.prepare("INSERT INTO fleet_deploys (worker, to_sha, ok, ts) VALUES ('qnfo-demo', '1.2.4-evolve-c1', 1, ?)").run(new Date(Date.now() - 60e3).toISOString());
a = J(await W.evAdvance(env, one("SELECT * FROM evolve_candidates WHERE id = 1")));
ok(a.status === "deployed", "evAdvance reads the deploy ledger through evDeployRow", a);
db.prepare("INSERT INTO worker_live_audit (worker, http, live_version, probed_at) VALUES ('qnfo-demo', 200, '1.2.4-evolve-c1', ?)").run(new Date(Date.now() + 60e3).toISOString());
a = J(await W.evAdvance(env, one("SELECT * FROM evolve_candidates WHERE id = 1")));
ok(a.status === "verified", "evAdvance verifies live through evLiveCheck", a);

// ================================================================ 8. CODE-LOOP-STALE-VERSION-1: a stale-base failure is re-proposed, not parked
async function staleCase(mainText, extraSameGoal, conflict, ctxExtra) {
  freshDb(); freshGh();
  db.prepare("INSERT INTO agent_issues (id, title, description, source, status) VALUES (50, 'OWNER-TASK-9: fix a', 'd', 'qnfo-fleet-dashboard:owner-request', 'open')").run();
  seedTask({ ctx: JSON.stringify(Object.assign({ base: BASE, patch: PATCH, anchor: "function a() {" }, ctxExtra || {})) });
  for (let i = 0; i < extraSameGoal; i++) db.prepare("INSERT INTO code_tasks (id, repo, path, goal, status, step, attempts, created_at, updated_at) VALUES (?, 'qnfo-workers', ?, '[issue #50] fix a', 'closed', 'done', 0, ?, ?)").run("ct_old" + i + "xxxxxxxxx", PATH, ago(9), ago(9));
  seedWorkerPr(401, BRANCH, "h1");
  if (conflict) { gh.pulls[401].mergeable = false; gh.pulls[401].mergeable_state = "dirty"; gh.checks.h1 = green("h1", ["gate", "mirror-guard", "comparator", "guard"]); }
  else gh.checks.h1 = green("h1", ["gate", "mirror-guard", "comparator"]).concat([{ id: 401, name: "guard", status: "completed", conclusion: "failure", head_sha: "h1" }]);
  gh.contents["main:" + PATH] = mainText;
  const rr = J(await W.codeMergeTick(env, { now: NOW }));
  return { rr, old: one("SELECT * FROM code_tasks WHERE id = ?", ID), fresh: rows("SELECT * FROM code_tasks WHERE status = 'queued'") };
}
const MOVED = BASE.replace('var VERSION = "1.2.3-demo";', 'var VERSION = "1.2.4-codeagent";').replace("  return 2;", "  return 22;");
let sc = await staleCase(MOVED, 0, false);
ok(sc.rr.decided[0].action === "requeued" && sc.old.status === "closed" && /stale base: required check\(s\) failed/.test(sc.old.last_error), "a failed check on a file main changed since the merge base: the task is closed as stale, not needs_human", sc.old);
ok(sc.fresh.length === 1 && sc.fresh[0].goal === "[issue #50] fix a" && sc.fresh[0].path === PATH && sc.fresh[0].step === "read" && JSON.parse(sc.fresh[0].ctx).anchor === "function a() {" && /^ct_[a-z0-9]{14}$/.test(sc.fresh[0].id), "the same goal is queued as a fresh task (anchor kept) for the orchestrator to propose on current main", sc.fresh);
ok(gh.calls.includes("PATCH /pulls/401") && gh.comments.some((c) => c.pr === 401 && /CODE-LOOP-STALE-VERSION-1/.test(c.body) && c.body.includes(sc.fresh[0].id)) && gh.merges.length === 0, "the stale PR is closed with a comment naming the new task; nothing is merged");
ok(one("SELECT COUNT(*) n FROM cloud_ops_events WHERE kind = 'code-merge.requeued'").n === 1, "the re-proposal writes one cloud_ops_events row");
sc = await staleCase(MOVED, 0, true);
ok(sc.rr.decided[0].action === "requeued" && sc.fresh.length === 1, "a conflicting PR on a moved file is re-proposed the same way", sc.rr.decided);
// CODE-REPAIR-INTASK-1 (0.16.0): a real check failure is repaired inside the task before it can fail
sc = await staleCase(BASE, 0, false);
ok(sc.rr.decided[0].action === "repair-requeued" && sc.old.status === "queued" && sc.old.step === "propose" && sc.old.attempts === 1 && sc.old.branch === BRANCH + "-r2" && sc.old.pr_url === null && /required check\(s\) failed/.test(JSON.parse(sc.old.ctx).lastError) && JSON.parse(sc.old.ctx).repair_round === 1, "a failed check while main did NOT change the file: the same task goes back to propose with the failure as feedback, on a fresh branch", sc.old);
ok(gh.calls.includes("PATCH /pulls/401") && gh.comments.some((c) => c.pr === 401 && /CODE-REPAIR-INTASK-1 round 1 of 2/.test(c.body)) && gh.merges.length === 0 && one("SELECT COUNT(*) n FROM cloud_ops_events WHERE kind = 'code-merge.repair-requeued'").n === 1, "the repaired PR is closed with a comment and one repair-requeued event; nothing merges");
sc = await staleCase(BASE, 0, false, { repair_round: 2 });
ok(sc.rr.decided[0].action === "refuse" && sc.old.status === "failed" && sc.fresh.length === 0, "after two repair rounds a real check failure fails the task and hands it to the fleet", sc.old);
sc = await staleCase(MOVED, 2, false, { repair_round: 2 });
ok(sc.rr.decided[0].action === "refuse" && sc.old.status === "failed" && sc.fresh.length === 0, "after two re-proposals of one goal and two repair rounds the runner stops and hands it to the fleet", sc.rr.decided);

// ---- REBASE-REQUEUE-1 (0.4.135, transformation lever T1.3 half 2): a stale task that parked its edits goes back to the publisher
const EDITS = [{ search: "  return 2;", replace: "  return 3;" }];
sc = await staleCase(MOVED, 0, false, { edits: EDITS });
ok(sc.rr.decided[0].action === "rebase-requeued" && sc.old.status === "ready_to_publish" && sc.old.step === "done" && sc.old.branch === BRANCH + "-r2" && sc.old.pr_url === null && sc.old.last_error === null && sc.fresh.length === 0, "a stale task with SEARCH/REPLACE edits is sent back to code-task-publish on a fresh branch name, no model call, no new task", sc.old);
const rc = JSON.parse(sc.old.ctx);
ok(rc.rebase_round === 1 && rc.edits.length === 1 && rc.edits[0].replace === "  return 3;" && rc.patch === PATCH && rc.base === BASE && /required check/.test(rc.rebase_why) && rc.rebase_from_pr === 401, "the edits, base and patch stay on the task; the rebase round, the reason and the closed PR are recorded", rc);
ok(/REBASE-REQUEUE-1/.test(sc.old.merge_note) && sc.old.merge_note.includes(BRANCH + "-r2"), "the merge note names the rebuilt branch", sc.old.merge_note);
ok(!gh.calls.includes("PATCH /pulls/401") && gh.comments.some((c) => c.pr === 401 && /REBASE-REQUEUE-1/.test(c.body) && c.body.includes(BRANCH + "-r2")) && gh.merges.length === 0, "NO-UNTRACKED-CLOSE-1: the stale PR is left OPEN with a comment naming the rebuilt branch (the successor PR does not exist yet); nothing is merged");
ok(JSON.parse(sc.old.ctx).superseded_pr === 401, "NO-UNTRACKED-CLOSE-1: the parked PR number is recorded in ctx.superseded_pr so cmCloseSuperseded can close it once a successor exists", sc.old.ctx);
ok(one("SELECT COUNT(*) n FROM cloud_ops_events WHERE kind = 'code-merge.rebase-requeued'").n === 1 && one("SELECT COUNT(*) n FROM cloud_ops_events WHERE kind = 'code-merge.requeued'").n === 0, "one rebase-requeued event, no re-proposal event");
sc = await staleCase(MOVED, 0, true, { edits: EDITS });
ok(sc.rr.decided[0].action === "rebase-requeued" && sc.old.status === "ready_to_publish", "a conflicting PR on a moved file is rebuilt the same way", sc.rr.decided);
sc = await staleCase(MOVED, 0, false, { edits: EDITS, rebase_round: 1 });
ok(sc.rr.decided[0].action === "requeued" && sc.old.status === "closed" && sc.fresh.length === 1, "a task already rebuilt once is re-proposed with a model on its next stale base, as before", sc.rr.decided);
sc = await staleCase(MOVED, 0, false, { edits: [] });
ok(sc.rr.decided[0].action === "requeued" && sc.fresh.length === 1, "a task without parked edits (whole-file mode) is re-proposed as before", sc.rr.decided);

// ================================================================ 9. CODE-CLOSE-REASON-1: a closure outside the runner records why
const addCols = () => ["merged_by TEXT", "merged_sha TEXT", "merged_at TEXT", "merge_state TEXT", "merge_note TEXT", "green_since TEXT", "nochecks_sha TEXT", "nochecks_since TEXT", "pr_opened_by TEXT", "pr_opened_at TEXT", "version_to TEXT", "deployed_at TEXT", "revert_cid INTEGER", "merge_checked_at TEXT"].forEach((c) => db.exec("ALTER TABLE code_tasks ADD COLUMN " + c));
freshDb(); freshGh(); addCols();
db.exec("CREATE TABLE branch_hygiene_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, branch TEXT NOT NULL, sha TEXT, action TEXT NOT NULL, why TEXT, pr INTEGER, archive_ref TEXT, ok INTEGER DEFAULT 1, dry INTEGER DEFAULT 0)");
seedTask({ goal: "direct task" });
db.prepare("UPDATE code_tasks SET merge_note = 'GitHub is still computing mergeability' WHERE id = ?").run(ID);
seedWorkerPr(401, BRANCH, "h1");
gh.pulls[401].state = "closed"; gh.pulls[401].closed_at = ago(1);
db.prepare("INSERT INTO branch_hygiene_log (ts, branch, action, why, pr) VALUES (?, ?, 'close-stale-pr', 'open PR idle over 24h with no live code task', 401)").run(ago(1), BRANCH);
r = J(await W.codeMergeTick(env, { now: NOW }));
row = one("SELECT * FROM code_tasks WHERE id = ?", ID);
ok(row.status === "closed" && /closed unmerged by the stale-PR closer \(CYCLE-TIME-1/.test(row.merge_note) && /^closed: /.test(row.last_error) && /last note was: GitHub is still computing/.test(row.merge_note), "a PR closed by CYCLE-TIME-1: the reason names the closer, not the stale wait note", row);
freshDb(); freshGh();
seedTask({ goal: "direct task" });
seedWorkerPr(401, BRANCH, "h1");
gh.pulls[401].state = "closed"; gh.pulls[401].closed_at = ago(1);
r = J(await W.codeMergeTick(env, { now: NOW }));
row = one("SELECT * FROM code_tasks WHERE id = ?", ID);
ok(row.status === "closed" && /was closed unmerged outside the runner at /.test(row.merge_note), "a PR closed by someone else: the reason says so (no branch_hygiene_log table needed)", row);

// ================================================================ 10. MERGE-RUNNER-VERSION-FORM-1 and CRON-ONLY-VERIFY-1
const EM = 'var VERSION="2.3.1-itinerary-ingest"/* note */\nvar y = 1;\n';
const B1 = W.cmBump(EM, "-r");
ok(B1 && B1.from === "2.3.1-itinerary-ingest" && B1.to === "2.3.2-r" && B1.content.startsWith('var VERSION = "2.3.2-r"/* note */'), "cmBump accepts var VERSION=\"x\" without spaces or semicolon (qnfo-email)", B1);
const GW = W.cmBump('var VERSION="3.9.3-allowlist";\nz();\n', "-r");
ok(GW && GW.content.startsWith('var VERSION = "3.9.4-r";'), "cmBump accepts the no-space form with a semicolon (qnfo-gateway)", GW);
{
  const B0 = 'var VERSION="2.3.1-x"/* c */\nfunction a() {\n  return 1;\n}\n', N0 = B0.replace('"2.3.1-x"', '"2.3.2-codeagent"').replace("return 1", "return 11");
  const P0 = W.cmParsePatch(W.hunkPatch("qnfo-e/worker.js", B0, N0))["qnfo-e/worker.js"];
  const RV = W.cmRevertText(N0.replace('"2.3.2-codeagent"', '"2.3.5-later"'), P0, "-revert-c1");
  ok(RV && RV.to === "2.3.6-revert-c1" && /return 1;/.test(RV.content), "a no-space VERSION worker is revertible: the inverse applies and main's VERSION is bumped", RV);
}
{
  freshDb(); freshGh(); addCols();
  db.exec("CREATE TABLE fleet_heartbeat (worker TEXT PRIMARY KEY, version TEXT, ts TEXT, ok INTEGER)");
  const T3 = "ct_cron00000000x";
  db.prepare("INSERT INTO code_tasks (id, repo, path, goal, status, step, attempts, ctx, branch, pr_url, created_at, updated_at, merged_by, merged_at, merge_state, version_to, deployed_at) VALUES (?, 'qnfo-workers', 'qnfo-prober/worker.js', 'direct', 'merged', 'done', 0, ?, 'codeagent-cron00000000', 'https://github.com/QNFO/qnfo-workers/pull/581', ?, ?, 'qnfo-fleet-control', ?, 'deployed', '2.3.11-codeagent', ?)").run(T3, JSON.stringify({ patch: PATCH }), ago(9), ago(5), ago(5), ago(4));
  db.prepare("INSERT INTO worker_live_audit (worker, http, live_version, note, probed_at) VALUES ('qnfo-prober', NULL, NULL, 'CRON_ONLY', ?)").run(ago(1).replace("T", " ").slice(0, 19));
  await W.codeMergeTick(env, { now: NOW });
  const hasEv = !!one("SELECT name FROM sqlite_master WHERE name = 'evolve_candidates'");
  ok(one("SELECT merge_state FROM code_tasks WHERE id = ?", T3).merge_state === "unverifiable" && (!hasEv || one("SELECT COUNT(*) n FROM evolve_candidates WHERE kind = 'revert'").n === 0) && gh.newPulls.length === 0, "CRON-ONLY-VERIFY-1: a cron-only worker with no heartbeat after the deploy is unverifiable, never reverted on http null", one("SELECT merge_state, merge_note FROM code_tasks WHERE id = ?", T3));
  db.prepare("UPDATE code_tasks SET merge_state = 'deployed' WHERE id = ?").run(T3);
  db.prepare("INSERT INTO fleet_heartbeat (worker, version, ts, ok) VALUES ('qnfo-prober', '2.3.11-codeagent', ?, 1)").run(ago(2));
  await W.codeMergeTick(env, { now: NOW });
  const v3 = one("SELECT merge_state, merge_note FROM code_tasks WHERE id = ?", T3);
  ok(v3.merge_state === "verified" && /live 2\.3\.11-codeagent http 200/.test(v3.merge_note), "a cron-only worker whose fleet_heartbeat shows the merged VERSION after the deploy is verified", v3);
  db.prepare("UPDATE code_tasks SET merge_state = 'deployed' WHERE id = ?").run(T3);
  db.prepare("UPDATE fleet_heartbeat SET version = '2.3.10-old', ok = 1").run();
  await W.codeMergeTick(env, { now: NOW });
  ok(/revert/.test(one("SELECT merge_state FROM code_tasks WHERE id = ?", T3).merge_state), "a heartbeat after the deploy with another VERSION is a real failure and goes the revert way", one("SELECT merge_state, merge_note FROM code_tasks WHERE id = ?", T3));
}

// ================================================================ N. PR-OPEN-ON-20MIN-TICK-1 (TP-1b2, agent_issues 2017): the open-only tick
freshDb(); freshGh();
db.prepare("INSERT INTO agent_issues (id, title, description, source, status) VALUES (50, 'OWNER-TASK-9: fix a', 'desc', 'qnfo-fleet-dashboard:owner-request', 'open')").run();
seedTask({ status: "branch_pushed", pr_url: "https://github.com/QNFO/qnfo-workers/compare/main..." + BRANCH + "?expand=1" });
gh.branches[BRANCH] = "h1";
seedHead("h1");
// a merged task mid-deploy and a published candidate with green checks: the open-only tick must touch neither
db.prepare("INSERT INTO code_tasks (id, repo, path, goal, status, step, attempts, ctx, branch, pr_url, created_at, updated_at) VALUES ('ct_openonlycand01', 'qnfo-workers', 'qnfo-other/worker.js', '[issue #50] fix b', 'published', 'done', 0, ?, 'codeagent-openonlycand', 'https://github.com/QNFO/qnfo-workers/pull/777', ?, ?)").run(JSON.stringify({ patch: PATCH }), ago(5), ago(4));
gh.pulls[777] = prJson({ number: 777, head: { ref: "codeagent-openonlycand", sha: "h7", repo: { full_name: "QNFO/qnfo-workers" } } });
gh.checks.h7 = green("h7", ["gate", "mirror-guard", "comparator", "guard"]);
const T20 = Date.parse("2026-10-03T12:20:00Z");
r = J(await W.codeMergeTick(env, { now: T20, openOnly: true }));
ok(r.open_only === true && r.opened.length === 1 && r.opened[0].action === "open" && gh.newPulls.length === 1 && gh.newPulls[0].head === BRANCH, "open-only tick: the pushed branch is opened as a PR", r.opened);
ok(r.decided.length === 0 && r.advanced.length === 0 && gh.merges.length === 0, "open-only tick: no merge candidate is decided, nothing is merged or advanced", { d: r.decided, a: r.advanced, m: gh.merges });
row = one("SELECT * FROM code_tasks WHERE id = ?", ID);
ok(row.status === "published" && row.pr_opened_by === "qnfo-fleet-control" && row.pr_opened_at === new Date(T20).toISOString(), "open-only tick: the row is published with pr_opened_at at :20", row);
ok(!one("SELECT 1 AS x FROM cloud_ops_events WHERE id = 'code-merge-tick-2026-10-03'"), "open-only tick: the day's merge-tick heartbeat is not written (the hourly tick owns it)");
ok(one("SELECT COUNT(*) n FROM cloud_ops_events WHERE kind = 'code-merge.pr-opened'").n === 1, "open-only tick: the open is audited as code-merge.pr-opened");
// at :00 the open-only tick stands aside for the hourly tick (no double open of one branch)
seedTask({ id: "ct_openonlysecond", status: "branch_pushed", branch: "codeagent-openonlyseco", pr_url: "https://github.com/QNFO/qnfo-workers/compare/main...codeagent-openonlyseco?expand=1" });
gh.branches["codeagent-openonlyseco"] = "h1";
r = J(await W.codeMergeTick(env, { now: Date.parse("2026-10-03T13:00:00Z"), openOnly: true }));
ok(r.idle === "hourly tick owns minute 0" && gh.newPulls.length === 1, "open-only tick at minute 0 does nothing: the hourly tick opens then", r);
r = J(await W.codeMergeTick(env, { now: Date.parse("2026-10-03T13:00:00Z") }));
ok(gh.newPulls.length === 2 && r.opened.length === 1 && r.decided.length >= 1, "the hourly tick still opens and decides", { n: gh.newPulls.length, o: r.opened, d: r.decided.length });

// ---------------------------------------------------------------- TP-1a TRUSTED-ORIGIN-PARITY-1 (agent_issues 2005, 0.4.132)
// The runner's default list (CM_TRUSTED_SOURCES) trusts every (source, title-prefix) pair the orchestrator's planner trusts
// (PLAN_TRUSTED_DEFAULT with planTrustRules, sliced from qnfo-code-orchestrator/worker.js; PLAN-TRUST-PARITY-1, 0.25.0: the planner reads the
// runner's own ops_config list and falls back to this default), so a task the planner builds is never refused by cmProvenance.
{
  const p1 = orch.indexOf("const PLAN_TRUSTED_DEFAULT = "), p2 = orch.indexOf("const _planDbs");
  ok(p1 > 0 && p2 > p1, "PLAN_TRUSTED_DEFAULT and planTrusted are found in the orchestrator");
  vm.runInContext(orch.slice(p1, p2) + "\n__export.planTrusted = planTrusted; __export.PLAN_TRUSTED = planTrustRules(); __export.PLAN_TRUSTED_DEFAULT = PLAN_TRUSTED_DEFAULT;", sandbox, { filename: "plan-trusted" });
  ok(Array.isArray(W.PLAN_TRUSTED) && W.PLAN_TRUSTED.length >= 6, "the planner's list has its rows", W.PLAN_TRUSTED);
  ok(W.PLAN_TRUSTED_DEFAULT === (/var CM_TRUSTED_SOURCES = "([^"]*)"/.exec(src) || [])[1], "the planner's default list is the runner's constant, character for character");
  W.PLAN_TRUSTED.forEach((r) => {
    const src = r.prefix ? r.src + "-x" : r.src, title = (r.title || "") + "something";
    ok(W.planTrusted(src, title) === true && W.cmTrusted(src, title) === true, "planner and runner both trust " + src + " / " + title);
  });
  ok(W.planTrusted("qnfo-ops", "X") === false && W.cmTrusted("qnfo-ops", "X") === false, "planner and runner both refuse an unlisted origin");
  ok(W.cmTrusted("qnfo-fleet-control", "SOMETHING-ELSE-1") === false, "a fleet-control issue outside the trusted prefixes is still refused");
  ok(W.cmTrusted("qnfo-fleet-control", "TP-1.3-REBASE-1: x") === true && W.cmTrusted("TRANSFORMATION-PROGRAM-1", "TP-9-X: y") === true, "the transformation program's two origins are trusted by default (TRANSFORMATION-LOOP-1)");
}

// ---------------------------------------------------------------- GOAL-REVIEW-1 (0.9.0)
// Pure parts: reviewer choice outside the proposer's family, reply parsing, the diff the reviewer reads, the decision.
ok(W.cmModelFamily("@cf/qwen/qwen2.5-coder-32b-instruct") === "qwen" && W.cmModelFamily("@cf/openai/gpt-oss-120b") === "openai", "model family is the @cf/<family>/ segment");
ok(W.cmReviewModel("@cf/qwen/qwen2.5-coder-32b-instruct") === "@cf/openai/gpt-oss-120b" && W.cmReviewModel("@cf/openai/gpt-oss-20b") === "@cf/nvidia/nemotron-3-120b-a12b", "the reviewer is the first listed model outside the proposer's family");
ok(W.cmReviewModel(null) === W.CM_REVIEW_MODELS[0] && W.cmReviewModel("@cf/qwen/x", ["@cf/qwen/y"]) === null, "no proposer recorded: the first reviewer; only same-family reviewers: none");
ok(!W.CM_REVIEW_MODELS.some((m) => ["qwen", "moonshotai", "zai-org"].includes(W.cmModelFamily(m))), "the default reviewers share no family with the orchestrator's default ladder (qwen, moonshotai, zai-org)");
{
  const ld = orch.indexOf("const DEFAULT_LADDER = ["), le = orch.indexOf("];", ld);
  const lad = JSON.parse(orch.slice(ld + "const DEFAULT_LADDER = ".length, le + 1));
  ok(lad.length > 0 && lad.every((m) => W.cmReviewModel(m) && W.cmModelFamily(W.cmReviewModel(m)) !== W.cmModelFamily(m)), "every rung of the orchestrator's DEFAULT_LADDER gets a reviewer from another family", lad);
}
ok(J(W.cmReviewParse('<think>the diff passes [] only</think>{"verdict":"no","defects":["publishStage only passes [] to publishToArchive; no citation is checked"]}')).verdict === "no", "a reply with a think block parses");
ok(W.cmReviewParse('```json\n{"verdict": "Implements", "defects": []}\n```').verdict === "implements" && W.cmReviewParse('noise "verdict": "partial" noise').verdict === "partial", "fenced JSON and a bare verdict field parse; case is ignored");
ok(W.cmReviewParse("I think it is fine").verdict === null && W.cmReviewParse('{"verdict":"maybe"}').verdict === null && W.cmReviewParse("").verdict === null, "an unreadable reply or an unknown verdict is no verdict");
ok(W.cmReviewParse("Verdict: **partial**\nThe gateway half is missing.").verdict === "partial" && W.cmReviewParse("verdict = implements").verdict === "implements", "REVIEW-NO-VERDICT-1: a verdict written outside JSON is read");
ok(W.cmReviewParse("").why === "empty" && W.cmReviewParse('{"verdict": "impl').why === "truncated-json" && W.cmReviewParse("I think it is fine").why === "prose", "REVIEW-NO-VERDICT-1: a reply with no verdict is classed");
ok(W.cmReviewParse('{"verdict":"no","defects":["a","b","c","d","e","f"]}').defects.length === 4, "at most 4 defects are kept");
ok(J(W.cmReviewParse('Reasoning {x}. {"verdict":"no","defects":["handleClaims writes papers.claim_line but no line runs ALTER TABLE papers ADD COLUMN claim_line { }"]}')).defects[0].indexOf("ALTER TABLE") > 0, "a defect that quotes braces, after braces in prose, is kept");
{
  const d = W.cmReviewDiff([{ filename: PATH, patch: "@@ -1 +1 @@\n-" + "x".repeat(900) + "\n+  return 11;" }, { filename: MIRROR, patch: "@@ mirror @@" }]);
  ok(d.indexOf("--- " + PATH) === 0 && d.indexOf(MIRROR) < 0 && d.indexOf("+  return 11;") > 0 && /\[line cut\]/.test(W.cmReviewDiff([{ filename: PATH, patch: "@@ -1 +1,2 @@\n ctx\n+" + "y".repeat(5000) }])), "the reviewer reads the worker diff, not the mirror; a long line with no counterpart is cut", d.slice(0, 120));
  ok(W.cmReviewDiff([{ filename: PATH, patch: ("+line " + "z".repeat(40) + "\n").repeat(5000) }]).length < W.CM_REVIEW_DIFF_CHARS + 200 && W.CM_REVIEW_DIFF_CHARS >= 40000 && W.cmReviewDiff([{ filename: PATH, patch: ("+line\n").repeat(5000) }]).length > 14200, "the diff is capped at CM_REVIEW_DIFF_CHARS (a 30,000-char diff is no longer cut at 14,000)");
}
ok(W.cmReviewDecision({ verdict: "no", model: "m", defects: ["x"] }).refuse === true && /goal review \(m\): the diff does not implement the goal: x/.test(W.cmReviewDecision({ verdict: "no", model: "m", defects: ["x"] }).why), "verdict no refuses with the defects");
ok(!/rejected by|review-rejected|noop-proposal|superseded|already shipped|DROPPED|withdrawn/i.test(W.cmReviewDecision({ verdict: "no", model: "m", defects: ["x"] }).why), "a goal-review refusal does not match the orchestrator's INTAKE_NO_RETRY, so the issue is retried with the defects");
// GOAL-REVIEW-HARM-1 (0.9.1): the live review of ct_hdaim0vx7h7vvl (2026-10-07 08:40Z) answered partial while naming errors
{
  const live = W.cmReviewParse('{"verdict":"partial","harm":true,"defects":["The added inner if/else inside the diversity-hold block makes the else branch unreachable and still increments diversity_held, causing incorrect accounting","Owner rows are not forced to ACCEPT"]}');
  ok(live.verdict === "partial" && live.harm === true && live.defects.length === 2, "harm is parsed apart from the verdict", live);
  const d = W.cmReviewDecision(Object.assign({ model: "@cf/openai/gpt-oss-120b" }, live));
  ok(d.refuse === true && /goal review \(@cf\/openai\/gpt-oss-120b\): the diff carries an error \(verdict partial\): The added inner if\/else/.test(d.why), "partial with harm refuses with the errors", d);
  ok(W.cmReviewDecision({ verdict: "implements", harm: true, model: "m", defects: ["x"] }).refuse === true, "implements with harm refuses too");
  ok(W.cmReviewParse('{"verdict":"partial","harm":false,"defects":["the gateway half is left for a second task"]}').harm === false && !W.cmReviewDecision({ verdict: "partial", harm: false, model: "m" }).refuse, "partial without harm still passes");
  ok(W.cmReviewParse('noise "verdict": "partial", "harm": "yes" noise').harm === true && W.cmReviewParse('{"verdict":"implements"}').harm === false, "harm as a string parses; a reply without harm is no harm (a pre-0.9.1 cached review decides as before)");
  ok(/harm/.test(W.cmReviewDecision({ verdict: "no", harm: true, model: "m", defects: ["y"] }).why) === false && W.cmReviewDecision({ verdict: "no", harm: true, model: "m", defects: ["y"] }).refuse, "verdict no keeps its own reason");
}
ok(W.cmReviewDecision({ verdict: "partial", model: "m" }).note === "goal review partial (m)" && W.cmReviewDecision({ tries: 1, err: "3046" }).wait === true && /unavailable after 3 tries/.test(W.cmReviewDecision({ tries: 3 }).note), "partial passes with a note; an unread review waits, then the checks decide after 3 tries");
// End to end through codeMergeTick: the open lane and the merge lane.
const GPATCH = [{ filename: PATH, status: "modified", patch: "@@ -2,3 +2,3 @@\n function a() {\n-  return 1;\n+  return 11;\n }" }, { filename: MIRROR, status: "modified", patch: "@@ mirror @@" }];
let aiCalls = [];
const reviewer = (reply) => async (env0, worker, purpose, model, input) => { aiCalls.push({ worker, purpose, model, input }); if (reply instanceof Error) throw reply; return { choices: [{ message: { content: reply } }] }; };
function goalSetup(over) {
  freshDb(); freshGh(); aiCalls = [];
  db.prepare("INSERT INTO agent_issues (id, title, description, source, status) VALUES (50, 'OWNER-TASK-9: fix a', 'desc', 'qnfo-fleet-dashboard:owner-request', 'open')").run();
  seedTask(Object.assign({ status: "branch_pushed", pr_url: "https://github.com/QNFO/qnfo-workers/compare/main..." + BRANCH + "?expand=1" }, over || {}));
  db.prepare("UPDATE code_tasks SET model = '@cf/qwen/qwen2.5-coder-32b-instruct'").run();
  gh.branches[BRANCH] = "h1";
  seedHead("h1");
  gh.compareFiles.h1 = GPATCH;
}
const genv = { AUDIT, GITHUB_TOKEN: "test-token", AI: {} };
const openedWhy = () => (one("SELECT text FROM cloud_ops_events WHERE kind = 'code-merge.pr-opened' ORDER BY ts DESC LIMIT 1") || {}).text || "";
goalSetup();
sandbox.aiRunAttr = reviewer('{"verdict":"no","defects":["a() now returns 11 but the goal asks for the citation check, which no line adds"]}');
r = J(await W.codeMergeTick(genv, { now: NOW }));
row = one("SELECT * FROM code_tasks WHERE id = ?", ID);
ok(gh.newPulls.length === 0 && row.status === "queued" && row.step === "propose" && /goal review \(@cf\/openai\/gpt-oss-120b \+ @cf\/nvidia\/nemotron-3-120b-a12b\): the diff does not implement the goal: a\(\) now returns 11/.test(row.merge_note) && JSON.parse(row.ctx).refusal.kind === "goal-review" && JSON.parse(row.ctx).refusal.reasons.length === 2 && /a\(\) now returns 11/.test(JSON.parse(row.ctx).lastError), "verdict no from two reviewers: the PR is not opened and the task goes back to propose with the defects (REPAIR-AT-OPEN-1)", { pulls: gh.newPulls.length, row: [row.status, row.step, row.merge_note] });
ok(aiCalls.length === 2 && aiCalls[0].purpose === "goal-review" && aiCalls[0].model === "@cf/openai/gpt-oss-120b" && aiCalls[1].model === "@cf/nvidia/nemotron-3-120b-a12b" && /fix a/.test(aiCalls[0].input.messages[1].content) && /\+  return 11;/.test(aiCalls[0].input.messages[1].content) && aiCalls[1].input.messages[1].content === aiCalls[0].input.messages[1].content, "two metered calls (purpose goal-review) to reviewers of two families outside the proposer's, with the goal and the head diff", aiCalls.map((c) => [c.purpose, c.model]));
ok(one("SELECT status FROM cloud_ops_events WHERE id = ?", "goal-review-" + ID + "-h1").status === "refused", "the verdict is cached under goal-review-<task>-<head>");
goalSetup();
sandbox.aiRunAttr = reviewer('{"verdict":"implements","defects":[]}');
r = J(await W.codeMergeTick(genv, { now: NOW }));
row = one("SELECT * FROM code_tasks WHERE id = ?", ID);
ok(gh.newPulls.length === 1 && row.status === "published" && /goal review implements \(@cf\/openai\/gpt-oss-120b\)/.test(openedWhy()), "verdict implements: the PR is opened and the open records the review", openedWhy());
gh.checks.h1 = green("h1", ["gate", "mirror-guard", "comparator", "guard"]);
r = J(await W.codeMergeTick(genv, { now: NOW + 2 * 36e5 }));
ok(gh.merges.length === 1 && aiCalls.length === 1, "green checks merge it; the merge lane reuses the cached review (one model call per head)", { merges: gh.merges.length, calls: aiCalls.length });
goalSetup();
sandbox.aiRunAttr = reviewer(new Error("3046: Request timeout"));
for (let k = 0; k < 2; k++) r = J(await W.codeMergeTick(genv, { now: NOW + k * 36e5 }));
row = one("SELECT * FROM code_tasks WHERE id = ?", ID);
ok(gh.newPulls.length === 0 && row.status === "branch_pushed" && /goal review pending \(try 2 of 3: 3046/.test(row.merge_note), "a failing reviewer only waits", row.merge_note);
r = J(await W.codeMergeTick(genv, { now: NOW + 2 * 36e5 }));
row = one("SELECT * FROM code_tasks WHERE id = ?", ID);
ok(gh.newPulls.length === 1 && /goal review unavailable after 3 tries; the checks decide/.test(openedWhy()) && aiCalls.length === 3, "after three failed reviews the checks decide alone, and that is recorded", { n: gh.newPulls.length, why: openedWhy(), calls: aiCalls.length });
goalSetup();
db.prepare("INSERT INTO ops_config (key, value) VALUES ('code_goal_review_enabled', 'off')").run();
sandbox.aiRunAttr = reviewer('{"verdict":"no","defects":["x"]}');
r = J(await W.codeMergeTick(genv, { now: NOW }));
ok(gh.newPulls.length === 1 && aiCalls.length === 0 && /goal review off/.test(openedWhy()), "ops_config code_goal_review_enabled off: no model call, the PR opens", openedWhy());
goalSetup();
db.prepare("INSERT INTO ops_config (key, value) VALUES ('code_goal_review_models', '@cf/meta/llama-3.3-70b-instruct-fp8-fast, not-a-model')").run();
sandbox.aiRunAttr = reviewer('{"verdict":"partial","defects":[]}');
r = J(await W.codeMergeTick(genv, { now: NOW }));
ok(aiCalls.length === 1 && aiCalls[0].model === "@cf/meta/llama-3.3-70b-instruct-fp8-fast" && gh.newPulls.length === 1, "ops_config code_goal_review_models replaces the list (only @cf/ ids kept); partial opens the PR", aiCalls.map((c) => c.model));
goalSetup();
sandbox.aiRunAttr = reviewer('{"verdict":"partial","harm":true,"defects":[{"line":"  return 11;","why":"a() returns 11 where the goal keeps 1 for the legacy path"}]}');
r = J(await W.codeMergeTick(genv, { now: NOW }));
row = one("SELECT * FROM code_tasks WHERE id = ?", ID);
ok(gh.newPulls.length === 0 && row.status === "queued" && /the diff carries an error \(verdict partial\): a\(\) returns 11[^|]*\[line: return 11;\]/.test(row.merge_note) && /line `return 11;`/.test(JSON.parse(row.ctx).lastError) && /"harm":true/.test(one("SELECT meta FROM cloud_ops_events WHERE id = ?", "goal-review-" + ID + "-h1").meta), "partial with harm on a quoted line, from two reviewers: no PR, the repair round gets the line", [row.status, row.merge_note]);
goalSetup();
sandbox.aiRunAttr = reviewer('{"verdict":"partial","harm":true,"defects":["the else branch is unreachable and still increments diversity_held"]}');
r = J(await W.codeMergeTick(genv, { now: NOW }));
row = one("SELECT * FROM code_tasks WHERE id = ?", ID);
ok(gh.newPulls.length === 1 && row.status === "published" && aiCalls.length === 1, "harm with no quoted line of the diff does not refuse: the PR opens and the checks decide (one call, no second reviewer needed)", [row.status, row.merge_note, aiCalls.length]);
goalSetup();
sandbox.aiRunAttr = reviewer('{"verdict":"partial","harm":true,"defects":[{"line":"  return 11;","why":"a() returns 11 where the goal keeps 1 for the legacy path"}]}');
r = J(await W.codeMergeTick(genv, { now: NOW }));
row = one("SELECT * FROM code_tasks WHERE id = ?", ID);
ok(gh.newPulls.length === 0 && row.status === "queued" && row.step === "propose", "the same again: the cited harm is repaired in the task", [row.status, row.step]);
// the merge lane reviews a PR opened before 0.9.0 (no cached review) and refuses a "no" with a comment on the PR
freshDb(); freshGh(); aiCalls = [];
db.prepare("INSERT INTO agent_issues (id, title, description, source, status) VALUES (50, 'OWNER-TASK-9: fix a', 'desc', 'qnfo-fleet-dashboard:owner-request', 'open')").run();
seedTask({ status: "published" });
seedWorkerPr(401, BRANCH, "h1");
gh.files[401] = GPATCH;
gh.checks.h1 = green("h1", ["gate", "mirror-guard", "comparator", "guard"]);
sandbox.aiRunAttr = reviewer('{"verdict":"no","defects":["the change does not do what the goal asks"]}');
r = J(await W.codeMergeTick(genv, { now: NOW }));
row = one("SELECT * FROM code_tasks WHERE id = ?", ID);
ok(gh.merges.length === 0 && row.status === "queued" && row.step === "propose" && /goal review/.test(JSON.parse(row.ctx).lastError) && /does not do what the goal asks/.test(JSON.parse(row.ctx).lastError) && gh.comments.some((c) => c.pr === 401 && /CODE-REPAIR-INTASK-1/.test(c.body) && /goal review/.test(c.body)), "merge lane: a green PR whose review says no is not merged; the task is re-proposed with the reviewer's defects and the PR says why", { merges: gh.merges.length, status: row.status, comments: gh.comments.length });
freshDb(); freshGh(); aiCalls = [];
db.prepare("INSERT INTO agent_issues (id, title, description, source, status) VALUES (50, 'OWNER-TASK-9: fix a', 'desc', 'qnfo-fleet-dashboard:owner-request', 'open')").run();
seedTask({ status: "published", attempts: 8 });
seedWorkerPr(401, BRANCH, "h1");
gh.files[401] = GPATCH;
gh.checks.h1 = green("h1", ["gate", "mirror-guard", "comparator", "guard"]);
sandbox.aiRunAttr = reviewer('{"verdict":"no","defects":["the change does not do what the goal asks"]}');
r = J(await W.codeMergeTick(genv, { now: NOW }));
row = one("SELECT * FROM code_tasks WHERE id = ?", ID);
ok(gh.merges.length === 0 && row.status === "failed", "a review refusal with no attempt left fails the task as before", { status: row.status, attempts: row.attempts });
sandbox.aiRunAttr = async () => null;

// ================================================================ 0.18.0: the merge side of the code loop
// GOAL-REVIEW-2, REFUSAL-REASON-1, REPAIR-AT-OPEN-1, PATCH-REBUILD-1, MIRROR-FOLLOWS-SOURCE-1, MERGE-MULTI-FILE-1, PUBLISH-DISPATCH-1
const M1 = "@cf/openai/gpt-oss-120b", M2 = "@cf/nvidia/nemotron-3-120b-a12b"; // REVIEW-POOL-ORDER-1 (0.34.4): nemotron leads deepseek in the default pool, so it is the second reviewer for these proposers
const reviewerBy = (map) => async (env0, worker, purpose, model, input) => { aiCalls.push({ worker, purpose, model, input }); const rp = model in map ? map[model] : map["*"]; if (rp instanceof Error) throw rp; return { choices: [{ message: { content: rp } }] }; };
ok(Number(/var VERSION = "0\.(\d+)\./.exec(src)[1]) >= 18, "qnfo-fleet-control is at least 0.18.0", /var VERSION = "[^"]*"/.exec(src)[0]);
{ // ---- pure: the second reviewer, quoted lines, screening
  ok(W.cmSecondReviewer("@cf/qwen/qwen2.5-coder-32b-instruct", M1) === M2 && W.cmSecondReviewer("@cf/deepseek-ai/x", M1) === "@cf/nvidia/nemotron-3-120b-a12b" && W.cmSecondReviewer(null, M1, [M1, "@cf/openai/gpt-oss-20b"]) === null, "the second reviewer's family is neither the proposer's nor the first reviewer's; none is null");
  const DIFF = W.cmReviewDiff(GPATCH);
  ok(W.cmCiteFound("  return 11;", DIFF) && W.cmCiteFound("+  return 11;", DIFF) && W.cmCiteFound("return 1;", DIFF) && !W.cmCiteFound("function a() {", DIFF) && !W.cmCiteFound("}", DIFF) && !W.cmCiteFound("return 12;", DIFF) && !W.cmCiteFound("", DIFF), "a quoted line counts only when it is a changed line of the diff (context lines, short quotes and invented lines do not)");
  const HEAD = 'var VERSION = "1";\nfunction helperOne(x) {\n  return x;\n}\nconst WRITER_PROMPT = "p";\nasync function later() {\n  const refs = [];\n  return refs;\n}\n';
  ok(W.cmDefinedIn(HEAD, "helperOne") && W.cmDefinedIn(HEAD, "WRITER_PROMPT") && W.cmDefinedIn(HEAD, "later") && !W.cmDefinedIn(HEAD, "refs") && !W.cmDefinedIn(HEAD, "checkCondition") && !W.cmDefinedIn(HEAD, "a.b") && !W.cmDefinedIn(null, "x"), "cmDefinedIn: top-level functions and declarations only (a local of another function is not a definition)");
  const names = [["Uses undefined function checkCondition, causing a runtime error.", "checkCondition"], ["ReferenceError: parseRefLine is not defined, causing a runtime error", "parseRefLine"], ["parseRefLine is called but not defined, causing a ReferenceError at runtime", "parseRefLine"], ["WRITER_PROMPT variable removed causing undefined reference", "WRITER_PROMPT"], ["refs variable is used but not defined in this scope, causing another runtime error", "refs"], ["The diff does not add any logic to select notes_intake rows", null]];
  ok(names.every(([w, n]) => W.cmDefectName(w) === n), "cmDefectName reads the name out of the recorded defect sentences", names.map(([w]) => W.cmDefectName(w)));
  const facts = W.cmReviewFacts("+  var y = helperOne(1) + missing(2) + obj.method(3) + parseInt(z);\n-  later(1);", HEAD);
  ok(/helperOne/.test(facts) && !/missing|method|later|parseInt/.test(facts) && W.cmReviewFacts("+  x = 1;", HEAD) === "" && W.cmReviewFacts("+ helperOne()", null) === "", "FACTS name only the called names the head file defines (added lines, no methods, no globals)", facts);
  const pr = W.cmReviewPrompt("g".repeat(7000), "D", "F");
  ok(pr.user.indexOf("g".repeat(W.CM_REVIEW_GOAL_CHARS)) >= 0 && W.CM_REVIEW_GOAL_CHARS >= 6000 && /\n\nFACTS:\nF\n\nDIFF:\nD$/.test(pr.user) && /VERSION/.test(pr.system) && /PREVIOUS ATTEMPT/.test(pr.system) && /"line"/.test(pr.system) && /quotes no line of the DIFF is ignored/.test(pr.system) && /comments, wording, naming or style/.test(pr.system) && !/FACTS:/.test(W.cmReviewPrompt("g", "D").user), "the prompt carries the whole goal, FACTS, and the rules: quote the line, no VERSION, comment or style verdicts");
  // a long line is shown around the part that changed, not cut at its head
  const dp = W.cmReviewDiff([{ filename: PATH, patch: "@@ -1 +1 @@\n-" + "a".repeat(3000) + "OLD" + "b".repeat(3000) + "\n+" + "a".repeat(3000) + "NEWER" + "b".repeat(3000) }]);
  ok(/aOLDb/.test(dp) && /aNEWERb/.test(dp) && dp.length < 1500 && dp.split("[2840 chars unchanged]").length === 5 && W.cmCiteFound("aaNEWERbb", dp), "a changed long line is shown around its change with the unchanged lengths (the old 400-char head cut hid it)", dp.length);
  ok(/\(new file\)/.test(W.cmReviewDiff([{ filename: "migrations/x.sql", status: "added", patch: "@@ -0,0 +1 @@\n+SELECT 1;" }])), "a new companion is labelled in the reviewer's diff");
  // screening
  const sc1 = J(W.cmReviewScreen({ verdict: "no", harm: true, defects: ["helperOne is called but not defined, causing a ReferenceError at runtime"] }, DIFF, HEAD));
  ok(sc1.verdict === "partial" && sc1.harm === false && sc1.defects.length === 0 && /helperOne is defined in the file at the head/.test(sc1.dropped[0].dropped) && /screened out/.test(sc1.downgraded), "a 'not defined' defect about a name the head file defines is dropped, and a 'no' with nothing left is a partial", sc1);
  const sc2 = J(W.cmReviewScreen(W.cmReviewParse('{"verdict":"implements","harm":true,"defects":[{"line":"return 99;","why":"a() returns the wrong value"}]}'), DIFF, HEAD));
  ok(sc2.harm === false && sc2.harm_unsupported === true && sc2.defects.length === 1 && sc2.cites[0].cited === false && !W.cmReviewDecision(Object.assign({ model: M1 }, sc2)).refuse, "harm that quotes a line the diff does not contain is not established", sc2);
  const sc3 = J(W.cmReviewScreen(W.cmReviewParse('{"verdict":"partial","harm":true,"defects":[{"line":"+  return 11;","why":"a() returns the wrong value"}]}'), DIFF, HEAD));
  ok(sc3.harm === true && sc3.cites[0].cited === true && W.cmReviewDecision(Object.assign({ model: M1 }, sc3)).refuse === true && /\[line: \+ ?return 11;\]/.test(W.cmReviewDecision(Object.assign({ model: M1 }, sc3)).why), "harm on a quoted changed line stands, and the refusal names the line", W.cmReviewDecision(Object.assign({ model: M1 }, sc3)).why);
  const cutDiff = "x".repeat(10) + "\n[diff cut at 40000 of 90000 chars]";
  ok(J(W.cmReviewScreen({ verdict: "no", harm: false, defects: ["the diff adds no verification step"] }, cutDiff, HEAD)).verdict === "partial" && J(W.cmReviewScreen({ verdict: "no", harm: false, defects: ["the diff adds no verification step"] }, DIFF, HEAD)).verdict === "no", "on a cut diff a defect with no quoted line is dropped (something 'missing' may sit in the part the reviewer did not see); on a whole diff it stands");
  ok(J(W.cmReviewScreen({ verdict: "no", harm: false, defects: [] }, DIFF, HEAD)).verdict === "partial" && /no defect was named/.test(J(W.cmReviewScreen({ verdict: "no", harm: false, defects: [] }, DIFF, HEAD)).downgraded), "a 'no' that names no defect gives the repair round nothing and does not refuse");
  // the 13 goal-review refusals of the 7 days to 2026-10-12, as recorded in cloud_ops_events code-merge.goal-review (verdict, harm, defects)
  const REC = [
    ["ct_hwpi986n77ncy2", "no", false, ["The diff does not add any logic to select notes_intake rows and feed them into idea_proposals as required by the task", "The version string is changed without relevance to the requested functionality", "PROPOSAL_BACKPRESSURE is altered from 30 to 3, but no accompanying code changes enforce the intended per‑run limit"]],
    ["ct_xlpr8iojg9fpip", "no", true, ["Uses undefined function checkCondition, causing a runtime error.", "Relies on setTimeout in a Cloudflare Worker, which will not survive the worker's short execution and thus never performs verification."]],
    ["ct_x18gl289qtiggu", "no", true, ["Version string does not match required 1.13.0-ds402-fallback", "Default model changed to placeholder \"fallback-model\" which is not a valid model", "Fallback only checks for HTTP 402, ignoring 401 and 403 as required", "No breaker (dsBreakerUntil) is set for 401/402/403 errors"]],
    ["ct_2yk2wih2zivbf9", "no", true, ["ReferenceError: parseRefLine is not defined, causing a runtime error", "Title similarity check only requires any word match instead of requiring at least half the words to match as specified"]],
    ["ct_0n5w20gezyii9s", "no", true, ["Version string does not match required 1.13.0-ds402-fallback", "Fallback logic still only checks for HTTP 402, ignoring required 401 and 403 handling", "No breaker (dsBreakerUntil) is set for 401/402/403 errors"]],
    ["ct_x4tr2srzgf5p7h", "no", true, ["Uses undefined function checkCondition causing a runtime error", "Uses setTimeout which will not survive in a Cloudflare Worker, preventing verification"]],
    ["ct_tm74cz0fyuo6wp", "partial", true, ["The comment still lists fleet_budget as read‑only, contradicting the updated rule that it is writable", "The read‑only list comment was not updated to remove fleet_budget"]],
    ["ct_kxidt9fse2j7yu", "no", true, ["WRITER_PROMPT variable removed causing undefined reference", "RECONCILE_PROMPT variable removed causing undefined reference", "REVIEW_PROMPT variable removed causing undefined reference", "REVISE_PROMPT variable removed causing undefined reference"]],
    ["ct_9ep1i6a57obg7l", "no", true, ["Uses undefined function checkCondition causing a runtime error", "Uses setTimeout which will not survive in a Cloudflare Worker, preventing verification on the next execution cycle"]],
    ["ct_jy19s7wu3hzm93", "no", true, ["VERSION variable does not match required 1.13.0-ds402-fallback", "Fallback logic does not implement 401/402/403 breaker handling or set dsBreakerUntil", "No breaker logic added for DeepSeek errors despite comment"]],
    ["ct_frhtt8hi1nztli", "no", true, ["weekdayHoursSince now uses strict null check (raw === null) instead of loose check (raw == null), changing behavior for undefined inputs and potentially causing runtime errors or incorrect results"]],
    ["ct_p5x02gfyvun209", "no", false, ["The change only modifies the error message for missing H1 title, it does not fix the most frequent cause of gate failures as required."]],
    ["ct_7xtqmvrmppmoxw", "no", true, ["parseRefLine is called but not defined, causing a runtime ReferenceError", "refs variable is used but not defined in this scope, causing another runtime error"]]
  ];
  const outc = REC.map(([id, v, h, ds]) => { const sc = W.cmReviewScreen({ verdict: v, harm: h, defects: ds }, DIFF, BASE); return { id, refuse: !!W.cmReviewDecision(Object.assign({ model: M1 }, sc)).refuse, dropped: (sc.dropped || []).length, kept: sc.defects.length }; });
  ok(outc.filter((x) => x.refuse).length === 12 && outc.find((x) => x.id === "ct_tm74cz0fyuo6wp").refuse === false && outc.find((x) => x.id === "ct_tm74cz0fyuo6wp").dropped === 2, "replay of the 13 recorded refusals: the 12 that named a real defect still refuse (pending the second reviewer), the comment-only one (ct_tm74cz0fyuo6wp) does not", outc);
  ok(["ct_hwpi986n77ncy2", "ct_x18gl289qtiggu", "ct_0n5w20gezyii9s", "ct_jy19s7wu3hzm93"].every((id) => { const o = outc.find((x) => x.id === id); return o.dropped === 1 && o.kept >= 1; }) && outc.find((x) => x.id === "ct_jy19s7wu3hzm93").kept === 2, "replay: the four VERSION-string defects are dropped and never reach the repair round; 'despite comment' is not a comment remark", outc.filter((x) => x.dropped));
  // two reviewers
  const R1 = { model: M1, tries: 1, verdict: "no", harm: false, defects: ["x"], cites: [{ line: "return 11;", why: "x", cited: true }] };
  ok(W.cmReviewCombine(R1).wait === true && !W.cmReviewCombine(R1).refuse, "one refusal alone only waits for the second reviewer");
  const both = J(W.cmReviewCombine(Object.assign({}, R1, { second: { model: M2, tries: 1, verdict: "no", harm: false, defects: ["y"], cites: [{ line: "", why: "y", cited: false }] } })));
  ok(both.refuse === true && both.why.indexOf("goal review (" + M1 + " + " + M2 + "): the diff does not implement the goal: x [line: return 11;] | second reviewer: y") === 0 && both.reasons.length === 2 && both.reasons[0].by === M1 && both.reasons[0].line === "return 11;" && both.reasons[1].by === M2 && both.reasons[1].line === "" && W.cmRepairable(task({ status: "branch_pushed" }), both.why), "two reviewers of different families agree: refused, with structured reasons the repair round can act on", both);
  const split = J(W.cmReviewCombine(Object.assign({}, R1, { second: { model: M2, tries: 1, verdict: "implements", harm: false, defects: [] } })));
  ok(!split.refuse && !split.wait && split.split === true && /one model's opinion does not refuse \(GOAL-REVIEW-2\), the required checks decide/.test(split.note) && split.note.indexOf(M2 + " answered implements") > 0, "the reviewers disagree: not refused, the checks decide, and the note says so", split);
  ok(W.cmReviewCombine(Object.assign({}, R1, { second: { model: M2, tries: 1, err: "3046" } })).wait === true && /unavailable after 3 tries/.test(W.cmReviewCombine(Object.assign({}, R1, { second: { model: M2, tries: 3, err: "3046" } })).note) && /no reviewer of another family/.test(W.cmReviewCombine(Object.assign({}, R1, { second: { skipped: true } })).note), "a second reviewer that fails is retried, and after three tries (or with none configured) one opinion does not refuse");
  ok(W.cmReviewCombine({ model: M1, tries: 1, verdict: "implements" }).note === "goal review implements (" + M1 + ")" && W.cmReviewCombine({ tries: 1, err: "x" }).wait === true, "a passing or pending first review is unchanged");
}
// ---- the reviewers disagree at the open step: the PR opens, the checks decide, the merge reuses the cached pair
goalSetup();
sandbox.aiRunAttr = reviewerBy({ [M1]: '{"verdict":"no","harm":false,"defects":[{"line":"","why":"the diff does not add the citation check the goal asks for"}]}', [M2]: '{"verdict":"implements","harm":false,"defects":[]}' });
r = J(await W.codeMergeTick(genv, { now: NOW }));
row = one("SELECT * FROM code_tasks WHERE id = ?", ID);
ok(gh.newPulls.length === 1 && row.status === "published" && aiCalls.length === 2 && /one model's opinion does not refuse/.test(openedWhy()) && one("SELECT status FROM cloud_ops_events WHERE id = ?", "goal-review-" + ID + "-h1").status === "split", "split review at the open step: the pull request is opened and the event is recorded as split", [row.status, openedWhy(), aiCalls.length]);
gh.checks.h1 = green("h1", ["gate", "mirror-guard", "comparator", "guard"]);
r = J(await W.codeMergeTick(genv, { now: NOW + 2 * 36e5 }));
row = one("SELECT * FROM code_tasks WHERE id = ?", ID);
ok(gh.merges.length === 1 && row.status === "merged" && aiCalls.length === 2 && /one model's opinion does not refuse/.test(row.merge_note), "green required checks then merge it: a single model's refusal never overrides them (no further model call)", [row.status, row.merge_note, aiCalls.length]);
// ---- the second reviewer is down: three tries, then the checks decide
goalSetup();
sandbox.aiRunAttr = reviewerBy({ [M1]: '{"verdict":"no","defects":["the diff does not add the citation check"]}', [M2]: new Error("3046: Request timeout"), "*": new Error("3046: Request timeout") }); // REVIEW-ROTATE-1: the second reviewer's next try goes to the next family (deepseek), which is down too
for (let k = 0; k < 2; k++) r = J(await W.codeMergeTick(genv, { now: NOW + k * 36e5 }));
row = one("SELECT * FROM code_tasks WHERE id = ?", ID);
ok(gh.newPulls.length === 0 && row.status === "branch_pushed" && /second reviewer pending \(try 2 of 3: 3046/.test(row.merge_note), "a failing second reviewer only waits", row.merge_note);
r = J(await W.codeMergeTick(genv, { now: NOW + 2 * 36e5 }));
ok(gh.newPulls.length === 1 && aiCalls.length === 4 && /the second reviewer was unavailable after 3 tries; one model's opinion does not refuse/.test(openedWhy()), "after three failed second reviews the pull request opens and the checks decide (first reviewer called once)", [openedWhy(), aiCalls.map((c) => c.model)]);
// ---- a refusal at the merge step carries its reasons to the planner
freshDb(); freshGh(); aiCalls = [];
db.prepare("INSERT INTO agent_issues (id, title, description, source, status) VALUES (50, 'OWNER-TASK-9: fix a', 'desc', 'qnfo-fleet-dashboard:owner-request', 'open')").run();
seedTask({ status: "published", ctx: JSON.stringify({ base: BASE, patch: PATCH, edits: [{ search: "  return 1;", replace: "  return 11;" }] }) });
seedWorkerPr(401, BRANCH, "h1");
gh.files[401] = GPATCH;
gh.checks.h1 = green("h1", ["gate", "mirror-guard", "comparator", "guard"]);
sandbox.aiRunAttr = reviewerBy({ "*": '{"verdict":"no","harm":true,"defects":[{"line":"  return 11;","why":"a() must keep returning 1 for the legacy callers"},{"line":"","why":"Version string does not match required 9.9.9"}]}' });
r = J(await W.codeMergeTick(genv, { now: NOW }));
row = one("SELECT * FROM code_tasks WHERE id = ?", ID);
{
  const cx2 = JSON.parse(row.ctx);
  ok(gh.merges.length === 0 && row.status === "queued" && row.step === "propose" && cx2.refusal.kind === "goal-review" && cx2.refusal.reasons.length === 2 && cx2.refusal.reasons.every((x) => x.line === "return 11;" && /legacy callers/.test(x.why)) && cx2.refusal.reasons[0].by === M1 && cx2.refusal.reasons[1].by === M2 && /Defects: 1\) line `return 11;`: a\(\) must keep returning 1/.test(cx2.lastError) && !/Version string/.test(cx2.lastError) && Array.isArray(cx2.edits) && cx2.edits.length === 1 && cx2.repair_round === 1, "merge step: two reviewers refuse on a quoted line; ctx.refusal and ctx.lastError carry the line and the reason, the VERSION remark is gone, and the parked edits stay for the planner's repair prompt", [row.status, cx2.refusal, cx2.lastError]);
}
// ---- MERGE-MULTI-FILE-1
freshDb(); freshGh(); aiCalls = [];
{
  const TESTP = DIR + "/a.test.mjs", MIG = "migrations/2026-10-12-demo.sql";
  const TBASE = "import './worker.js';\nassert(a() === 1);\n", TNEXT = TBASE.replace("=== 1", "=== 11");
  const MIGTEXT = "-- APPLY-BY: ci\n-- DB: qnfo-audit\n-- Rollback: DELETE FROM t WHERE k = 'a';\nINSERT INTO t (k) VALUES ('a');\n";
  // the orchestrator's newFilePatch (qnfo-code-orchestrator MULTI-FILE-CODE-TASKS-1)
  const newFilePatch = (path, text) => { const a = text.split("\n"); if (a[a.length - 1] === "") a.pop(); return "diff --git a/" + path + " b/" + path + "\nnew file mode 100644\n--- /dev/null\n+++ b/" + path + "\n@@ -0,0 +1," + a.length + " @@\n" + a.map((l) => "+" + l + "\n").join(""); };
  const MPATCH = PATCH + W.hunkPatch(TESTP, TBASE, TNEXT) + newFilePatch(MIG, MIGTEXT);
  const hp = W.cmParsePatch(MPATCH);
  ok(hp && Object.keys(hp).sort().join() === [MIG, MIRROR, TESTP, PATH].sort().join() && hp[MIG].created === true && !hp[TESTP].created && !hp[PATH].created && W.cmApply("", hp[MIG], false, false) === MIGTEXT && W.cmApply(TBASE, hp[TESTP], false, false) === TNEXT, "cmParsePatch reads a 'new file mode' section (old side /dev/null) and marks it created; it applies to an empty text", hp && Object.keys(hp));
  const mctx = (over) => Object.assign({ base: BASE, patch: MPATCH, paths: [TESTP, MIG] }, over || {});
  const mt = (over, cover) => task(Object.assign({ status: "branch_pushed", pr_url: "https://github.com/QNFO/qnfo-workers/compare/main..." + BRANCH + "?expand=1", ctx: JSON.stringify(mctx(cover)) }, over || {}));
  ok(J(W.cmCompanions(mt(), mctx())).list.length === 2 && J(W.cmCompanions(mt(), { paths: null })).ok === true && J(W.cmCompanions(mt(), {})).list.length === 0, "cmCompanions accepts the worker's own test and a migration; no ctx.paths is a single-file task");
  const badLists = [[PATH], [MIRROR], ["other-worker/x.test.mjs"], [DIR + "/wrangler.toml"], [".github/workflows/x.yml"], ["migrations/../x.sql"], [DIR + "/tool.exe"], [TESTP, TESTP], [DIR + "/a.mjs", DIR + "/b.mjs", DIR + "/c.mjs", DIR + "/d.mjs"], "x", [DIR + "/sub/worker.js"], [DIR + "/sub/deployed-current.worker.js"], ["/etc/passwd"], [7], ["migrations/sub/x.sql"], ["scripts/x.py"]];
  ok(badLists.every((l) => W.cmCompanions(mt(), { paths: l }).ok === false), "cmCompanions refuses a worker source, a mirror, another directory, a config, a workflow, a traversal, an unsupported type, a duplicate, more than three, a non-list", badLists.filter((l) => W.cmCompanions(mt(), { paths: l }).ok !== false));
  const mfiles = [{ filename: PATH, status: "modified" }, { filename: MIRROR, status: "modified" }, { filename: TESTP, status: "modified" }, { filename: MIG, status: "added" }];
  ok(oact(mt(), og({ files: mfiles, multiFile: true })).action === "open", "multi-file: the task path, its mirror, a modified companion and a new migration pass the task gates while the key is on", oact(mt(), og({ files: mfiles, multiFile: true })));
  const off = oact(mt(), og({ files: mfiles }));
  ok(off.action === "wait" && /code_merge_multi_file/.test(off.why), "multi-file: with the key off the branch waits (never a dead end, never a merge)", off);
  ok(oact(mt(), og({ files: mfiles.concat([{ filename: DIR + "/other.mjs", status: "added" }]), multiFile: true })).action === "refuse" && oact(mt(), og({ files: mfiles.map((f) => f.filename === TESTP ? { filename: TESTP, status: "removed" } : f), multiFile: true })).action === "refuse" && oact(mt(), og({ files: mfiles.map((f) => f.filename === MIRROR ? { filename: MIRROR, status: "added" } : f), multiFile: true })).action === "refuse", "multi-file: a file outside ctx.paths, a removed companion, or an 'added' mirror is refused");
  ok(oact(pushedT(), og({ files: [{ filename: PATH, status: "modified" }, { filename: MIRROR, status: "modified" }, { filename: TESTP, status: "added" }], multiFile: true })).action === "refuse" && oact(mt(null, { paths: [PATH] }), og({ files: mfiles, multiFile: true })).action === "refuse", "a single-file task still may change only its path and mirror; a bad ctx.paths refuses");
  ok(act(task({ ctx: JSON.stringify(mctx()) }), g({ files: mfiles, multiFile: true })).action === "merge" && act(task({ ctx: JSON.stringify(mctx()) }), g({ files: mfiles })).action === "wait", "multi-file: the merge decision takes the same gate");
  // integrity
  gh.contents["mbm:" + PATH] = BASE; gh.contents["mbm:" + MIRROR] = BASE; gh.contents["mbm:" + TESTP] = TBASE;
  gh.contents["hm:" + PATH] = NEXT; gh.contents["hm:" + MIRROR] = NEXT; gh.contents["hm:" + TESTP] = TNEXT; gh.contents["hm:" + MIG] = MIGTEXT; gh.contents["hm:" + DIR + "/wrangler.toml"] = 'name = "qnfo-demo"\nmain = "worker.js"\n';
  const ALLN = [PATH, MIRROR, TESTP, MIG];
  const im = J(await W.cmIntegrity(env, mt(), "hm", ALLN, W.cmScope(PATH), "mbm", { multiFile: true }));
  ok(im.ok === true && im.revertible === true && im.version_to === "1.2.4-codeagent", "multi-file integrity: every file at the head is the parked patch on the merge base; the migration is absent there and created", im);
  const im0 = J(await W.cmIntegrity(env, mt(), "hm", ALLN, W.cmScope(PATH), "mbm"));
  ok(im0.ok === false && /only a companion listed in ctx\.paths may be created/.test(im0.why), "without the key a new file in the patch is refused by the integrity check too", im0);
  gh.contents["mbx:" + PATH] = BASE; gh.contents["mbx:" + MIRROR] = BASE; gh.contents["mbx:" + TESTP] = TBASE; gh.contents["mbx:" + MIG] = "-- someone else's\n";
  const imx = J(await W.cmIntegrity(env, mt(), "hm", ALLN, W.cmScope(PATH), "mbx", { multiFile: true }));
  ok(imx.ok === false && imx.stale === true && /was to be created and exists at the merge base/.test(imx.why), "a migration that already exists at the merge base is stale, not intact", imx);
  gh.contents["hy:" + PATH] = NEXT; gh.contents["hy:" + MIRROR] = NEXT; gh.contents["hy:" + TESTP] = TNEXT; gh.contents["hy:" + MIG] = MIGTEXT + "DROP TABLE t;\n"; gh.contents["hy:" + DIR + "/wrangler.toml"] = 'name = "qnfo-demo"\n';
  const imy = J(await W.cmIntegrity(env, mt(), "hy", ALLN, W.cmScope(PATH), "mbm", { multiFile: true }));
  ok(imy.ok === false && !imy.stale && /migrations\/2026-10-12-demo\.sql at the PR head hy is not the verified patch/.test(imy.why), "other content pushed into a companion is refused", imy);
  // a branch the publisher rebuilt: the primary by ctx.edits, each companion by its own ctx.x[].edits
  const BASE2 = BASE.replace('var VERSION = "1.2.3-demo";', 'var VERSION = "1.2.9-moved";').replace("function b() {", "function b0() {\n  return 0;\n}\nfunction b() {");
  const EDITS = [{ search: "  return 1;", replace: "  return 11;" }], REBUILT = W.cmRebaseText(BASE2, EDITS, true), TBASE2 = "// moved\n" + TBASE;
  const rctx = { rebased: "REBASE-BEFORE-PUBLISH-1: rebuilt", edits: EDITS, mirror: MIRROR, x: [{ path: TESTP, base: TBASE, edits: [{ search: "=== 1", replace: "=== 11" }] }, { path: MIG, new: true, base: "", edits: [{ search: "", replace: MIGTEXT.slice(0, -1) }] }] };
  gh.contents["mb2:" + PATH] = BASE2; gh.contents["mb2:" + MIRROR] = BASE2; gh.contents["mb2:" + TESTP] = TBASE2;
  gh.contents["hr:" + PATH] = REBUILT; gh.contents["hr:" + MIRROR] = REBUILT; gh.contents["hr:" + TESTP] = TBASE2.replace("=== 1", "=== 11"); gh.contents["hr:" + MIG] = MIGTEXT; gh.contents["hr:" + DIR + "/wrangler.toml"] = 'name = "qnfo-demo"\n';
  const ir = J(await W.cmIntegrity(env, mt({ branch: BRANCH + "-r2" }, rctx), "hr", ALLN, W.cmScope(PATH), "mb2", { multiFile: true }));
  ok(ir.ok === true && ir.revertible === true && ir.version_to === "1.2.10-codeagent", "a rebuilt multi-file branch is intact: primary and mirror by ctx.edits with the bump, the test by its own edits, the new migration by its parked text", ir);
  const ir2 = J(await W.cmIntegrity(env, mt({ branch: BRANCH + "-r2" }, rctx), "hr", [PATH, MIRROR, MIG], W.cmScope(PATH), "mb2", { multiFile: true }));
  ok(ir2.ok === true, "a rebuilt branch may leave out a companion whose edits changed nothing", ir2);
  const ir3 = J(await W.cmIntegrity(env, mt({ branch: BRANCH + "-r2" }, Object.assign({}, rctx, { x: [rctx.x[1]] })), "hr", ALLN, W.cmScope(PATH), "mb2", { multiFile: true }));
  ok(ir3.ok === false && /has no parked edits/.test(ir3.why), "a rebuilt companion with no parked edits cannot be verified and is refused", ir3);
  gh.contents["mb4:" + PATH] = BASE2; gh.contents["mb4:" + MIRROR] = BASE2; gh.contents["mb4:" + TESTP] = "// rewritten\n";
  const ir4 = J(await W.cmIntegrity(env, mt({ branch: BRANCH + "-r2" }, rctx), "hr", ALLN, W.cmScope(PATH), "mb4", { multiFile: true }));
  ok(ir4.ok === false && ir4.stale === true && /do not re-apply to qnfo-demo\/a\.test\.mjs/.test(ir4.why), "a companion whose SEARCH is gone from the merge base is stale", ir4);
  // MIRROR-FOLLOWS-SOURCE-1 (ct_yghmskhqci2vv1, ct_h7lmh3yuwbv3wv: the mirror lagged the source at the merge base fced858)
  gh.contents["mbl:" + PATH] = BASE; gh.contents["mbl:" + MIRROR] = BASE.replace("  return 1;", "  return 0;");
  gh.contents["hl:" + PATH] = NEXT; gh.contents["hl:" + MIRROR] = NEXT; gh.contents["hl:" + DIR + "/wrangler.toml"] = 'name = "qnfo-demo"\n';
  const il = J(await W.cmIntegrity(env, task({ status: "branch_pushed" }), "hl", [PATH, MIRROR], W.cmScope(PATH), "mbl"));
  ok(il.ok === true && il.revertible === true, "MIRROR-FOLLOWS-SOURCE-1: a mirror that lagged the source at the merge base no longer fails the patch; the head mirror must equal the verified source", il);
  gh.contents["hl2:" + PATH] = NEXT; gh.contents["hl2:" + MIRROR] = NEXT + "// drift\n"; gh.contents["hl2:" + DIR + "/wrangler.toml"] = 'name = "qnfo-demo"\n';
  const il2 = J(await W.cmIntegrity(env, task({ status: "branch_pushed" }), "hl2", [PATH, MIRROR], W.cmScope(PATH), "mbl"));
  ok(il2.ok === false && /deployed-current\.worker\.js at the PR head hl2 is not the verified patch/.test(il2.why), "a head mirror that differs from the verified source is still refused", il2);
  // end to end with the key on: opened, reviewed with the companions in the diff, merged
  goalSetup({ ctx: JSON.stringify(mctx()) });
  db.prepare("INSERT INTO ops_config (key, value) VALUES ('code_merge_multi_file', 'on')").run();
  gh.contents["base0:" + TESTP] = TBASE; gh.contents["h1:" + TESTP] = TNEXT; gh.contents["h1:" + MIG] = MIGTEXT;
  gh.compareFiles.h1 = [GPATCH[0], GPATCH[1], { filename: TESTP, status: "modified", patch: "@@ -1,2 +1,2 @@\n import './worker.js';\n-assert(a() === 1);\n+assert(a() === 11);" }, { filename: MIG, status: "added", patch: "@@ -0,0 +1,4 @@\n+" + MIGTEXT.trimEnd().split("\n").join("\n+") }];
  sandbox.aiRunAttr = reviewer('{"verdict":"implements","harm":false,"defects":[]}');
  r = J(await W.codeMergeTick(genv, { now: NOW }));
  row = one("SELECT * FROM code_tasks WHERE id = ?", ID);
  ok(gh.newPulls.length === 1 && row.status === "published" && /a\.test\.mjs/.test(aiCalls[0].input.messages[1].content) && /2026-10-12-demo\.sql \(new file\)/.test(aiCalls[0].input.messages[1].content), "multi-file end to end: the branch is opened and the reviewer reads the companions", [row.status, row.merge_note]);
  gh.checks.h1 = green("h1", ["gate", "mirror-guard", "comparator", "guard"]);
  r = J(await W.codeMergeTick(genv, { now: NOW + 2 * 36e5 }));
  row = one("SELECT * FROM code_tasks WHERE id = ?", ID);
  ok(gh.merges.length === 1 && row.status === "merged", "multi-file end to end: merged on green required checks", [row.status, row.merge_note, r.decided]);
  goalSetup({ ctx: JSON.stringify(mctx()) });
  gh.contents["base0:" + TESTP] = TBASE; gh.contents["h1:" + TESTP] = TNEXT; gh.contents["h1:" + MIG] = MIGTEXT;
  gh.compareFiles.h1 = mfiles;
  r = J(await W.codeMergeTick(genv, { now: NOW }));
  row = one("SELECT * FROM code_tasks WHERE id = ?", ID);
  ok(gh.newPulls.length === 0 && row.status === "branch_pushed" && /code_merge_multi_file/.test(row.merge_note), "multi-file end to end with the key off: the branch waits", [row.status, row.merge_note]);
}
// ---- PATCH-REBUILD-1: a change that no longer fits its base is rebuilt or re-proposed
{
  const EDITS = [{ search: "  return 1;", replace: "  return 11;" }];
  goalSetup({ ctx: JSON.stringify({ base: BASE, patch: PATCH, edits: EDITS, mirror: MIRROR, anchor: "function a() {" }) });
  // main changed a context line of the parked hunk after the task read the file
  gh.contents["base0:" + PATH] = BASE.replace("function a() {", "function a() { // main changed this line");
  sandbox.aiRunAttr = reviewer('{"verdict":"implements","defects":[]}');
  r = J(await W.codeMergeTick(genv, { now: NOW }));
  row = one("SELECT * FROM code_tasks WHERE id = ?", ID);
  let c3 = JSON.parse(row.ctx);
  ok(row.status === "ready_to_publish" && row.branch === BRANCH + "-r2" && row.pr_url === null && row.last_error === null && c3.rebase_round === 1 && c3.edits.length === 1 && /PATCH-REBUILD-1: the verified patch does not apply to/.test(row.merge_note) && aiCalls.length === 0 && one("SELECT COUNT(*) AS n FROM cloud_ops_events WHERE kind = 'code-merge.rebase-requeued'").n === 1, "a stale patch at the open step is handed back to the publisher to re-apply the parked edits on current main (no model call, not a failed task)", [row.status, row.branch, row.merge_note]);
  // the one rebuild is spent: the task goes back to the orchestrator, which reads the file again
  goalSetup({ ctx: JSON.stringify({ base: BASE, patch: PATCH, edits: EDITS, mirror: MIRROR, anchor: "function a() {", rebase_round: 1, extras: [{ path: DIR + "/a.test.mjs" }] }), branch: BRANCH + "-r2", pr_url: "https://github.com/QNFO/qnfo-workers/compare/main..." + BRANCH + "-r2?expand=1" });
  gh.branches[BRANCH + "-r2"] = "h1";
  gh.contents["base0:" + PATH] = BASE.replace("function a() {", "function a() { // main changed this line");
  r = J(await W.codeMergeTick(genv, { now: NOW }));
  row = one("SELECT * FROM code_tasks WHERE id = ?", ID);
  c3 = JSON.parse(row.ctx);
  ok(row.status === "queued" && row.step === "read" && row.attempts === 1 && row.branch === BRANCH + "-r3" && c3.anchor === "function a() {" && c3.extras.length === 1 && !("patch" in c3) && !("base" in c3) && !("edits" in c3) && c3.refusal.kind === "stale-base" && /does not apply to/.test(c3.lastError) && /re-read and re-proposed on current main/.test(row.merge_note), "a real conflict (the rebuild already spent) becomes a repair round: step read, the anchor and companions kept, the stale patch dropped", [row.status, row.step, row.branch, Object.keys(c3)]);
  // no attempt left: only then does the task end failed
  goalSetup({ ctx: JSON.stringify({ base: BASE, patch: PATCH }), attempts: 8 });
  gh.contents["base0:" + PATH] = BASE.replace("function a() {", "function a() { // main changed this line");
  r = J(await W.codeMergeTick(genv, { now: NOW }));
  row = one("SELECT * FROM code_tasks WHERE id = ?", ID);
  ok(row.status === "failed" && /does not apply to/.test(row.last_error), "with no parked edits and no attempt left the refusal still ends the task", [row.status, row.last_error]);
  ok(W.CM_STALE_RE.test("the pull request conflicts with main (mergeable_state dirty)") && W.CM_STALE_RE.test("the parked edits do not re-apply to x at the merge base abc") && !W.CM_STALE_RE.test("required check(s) failed on abc: gate=failure") && W.cmRepairable(task(), "the pull request conflicts with main (mergeable_state dirty)") && !W.cmRepairable(task(), "qnfo-ops is a control-plane or code-loop worker, which never auto-merges"), "conflicts and stale patches are repairable; policy refusals are not");
  // the publisher's dead end (ct_55k6tphrr4dlr0): publish_failed on a conflict goes back to the orchestrator
  freshDb(); freshGh(); aiCalls = [];
  db.prepare("INSERT INTO agent_issues (id, title, description, source, status) VALUES (50, 'OWNER-TASK-9: fix a', 'desc', 'qnfo-fleet-dashboard:owner-request', 'open')").run();
  db.prepare("INSERT INTO agent_issues (id, title, description, source, status) VALUES (51, 'OWNER-TASK-10: retired', 'desc', 'qnfo-fleet-dashboard:owner-request', 'closed')").run();
  // a hand-filed patch row (no parked edits) and a task of a closed issue are not the loop's to re-propose
  db.prepare("INSERT INTO code_tasks (id, repo, path, goal, status, step, attempts, ctx, branch, last_error, created_at, updated_at) VALUES ('ct_handfiled00001', 'qnfo-workers', ?1, '[issue #50] by hand', 'publish_failed', 'done', 0, ?2, 'codeagent-handfiled000', 'publish: patch does not apply to main: x; rebase: no SEARCH/REPLACE edits parked in ctx.edits', ?3, ?3)").run(PATH, JSON.stringify({ patch: PATCH }), ago(2));
  db.prepare("INSERT INTO code_tasks (id, repo, path, goal, status, step, attempts, ctx, branch, last_error, created_at, updated_at) VALUES ('ct_closedissue001', 'qnfo-workers', ?1, '[issue #51] retired', 'publish_failed', 'done', 0, ?2, 'codeagent-closedissue0', 'publish: patch does not apply to main: x; rebase: edit 1: SEARCH text occurs 0 times', ?3, ?3)").run(PATH, JSON.stringify({ patch: PATCH, edits: EDITS }), ago(2));
  seedTask({ status: "publish_failed", pr_url: null, attempts: 6, updated_at: ago(1), last_error: "publish: patch does not apply to main: error: patch failed: qnfo-demo/worker.js:9; rebase: edit 1: SEARCH text occurs 0 times in the current file (it must occur exactly once)", ctx: JSON.stringify({ base: BASE, patch: PATCH, edits: EDITS, anchor: "function a() {" }) });
  r = J(await W.codeMergeTick(genv, { now: NOW + 20 * 6e4, openOnly: true }));
  ok(one("SELECT status FROM code_tasks WHERE id = ?", ID).status === "publish_failed", "the open-only tick does not sweep publish_failed tasks");
  r = J(await W.codeMergeTick(genv, { now: NOW }));
  row = one("SELECT * FROM code_tasks WHERE id = ?", ID);
  c3 = JSON.parse(row.ctx);
  ok(rows("SELECT status FROM code_tasks WHERE id IN ('ct_handfiled00001', 'ct_closedissue001')").every((x) => x.status === "publish_failed"), "a hand-filed patch row and a task of a closed issue stay as they are");
  ok(row.status === "queued" && row.step === "read" && row.attempts === 7 && c3.anchor === "function a() {" && /SEARCH text occurs 0 times/.test(c3.lastError) && r.rebuilt.length === 1, "a publish_failed conflict is re-proposed on current main instead of staying a dead end", [row.status, row.step, row.attempts, r.rebuilt]);
  db.prepare("UPDATE code_tasks SET status = 'publish_failed', attempts = 8, last_error = 'publish: patch does not apply to main: x' WHERE id = ?").run(ID);
  r = J(await W.codeMergeTick(genv, { now: NOW + 36e5 }));
  ok(one("SELECT status FROM code_tasks WHERE id = ?", ID).status === "publish_failed", "a task with no attempt left is not swept again");
}
// ---- PUBLISH-DISPATCH-1
{
  freshDb(); freshGh(); aiCalls = [];
  seedTask({ status: "ready_to_publish", pr_url: null, updated_at: ago(8) });
  r = J(await W.codeMergeTick(genv, { now: NOW }));
  const ev = () => rows("SELECT status, text FROM cloud_ops_events WHERE kind = 'code-merge.publish-dispatch' ORDER BY ts");
  ok((gh.dispatches || []).length === 1 && gh.dispatches[0].path === "/actions/workflows/code-task-publish.yml/dispatches" && gh.dispatches[0].body.ref === "main" && r.publish_dispatch.dispatched === true && r.publish_dispatch.waiting === 1 && ev().length === 1 && ev()[0].status === "ok" && /dispatch HTTP 204/.test(ev()[0].text), "a task ready_to_publish for over 10 minutes: the publisher workflow is dispatched on main and the dispatch is recorded", [gh.dispatches, r.publish_dispatch, ev()]);
  r = J(await W.codeMergeTick(genv, { now: NOW + 4 * 6e4 }));
  ok(gh.dispatches.length === 1 && /dispatched at/.test(r.publish_dispatch.skipped), "no second dispatch inside 5 minutes (PUBLISH-DISPATCH-FAST-1)");
  r = J(await W.codeMergeTick(genv, { now: NOW + 6 * 6e4, openOnly: true }));
  ok(gh.dispatches.length === 2, "the open-only tick dispatches too, once the 5-minute gap has passed");
  freshDb(); freshGh();
  seedTask({ status: "ready_to_publish", pr_url: null, updated_at: new Date(NOW - 1 * 6e4).toISOString() });
  r = J(await W.codeMergeTick(genv, { now: NOW }));
  ok((gh.dispatches || []).length === 1 && r.publish_dispatch.dispatched === true, "PUBLISH-DISPATCH-FAST-1: a task ready for 1 minute is dispatched on the first tick that sees it", [r.publish_dispatch]);
  freshDb(); freshGh();
  seedTask({ status: "ready_to_publish", pr_url: null, updated_at: new Date(NOW - 5 * 6e4).toISOString() });
  db.prepare("INSERT INTO ops_config (key, value) VALUES ('code_publish_wait_min', '10'), ('code_publish_gap_min', '20')").run();
  r = J(await W.codeMergeTick(genv, { now: NOW }));
  ok(!(gh.dispatches || []).length && !r.publish_dispatch, "ops_config code_publish_wait_min 10 restores the old wait: a task ready for 5 minutes is left to the workflow_run trigger");
  r = J(await W.codeMergeTick(genv, { now: NOW + 6 * 6e4 }));
  ok(gh.dispatches.length === 1, "and dispatches once the dialled wait has passed");
  r = J(await W.codeMergeTick(genv, { now: NOW + 15 * 6e4 }));
  ok(gh.dispatches.length === 1 && /dispatched at/.test(r.publish_dispatch.skipped), "ops_config code_publish_gap_min 20 restores the old gap");
  freshDb(); freshGh();
  seedTask({ status: "ready_to_publish", pr_url: null, updated_at: ago(8) });
  db.prepare("INSERT INTO ops_config (key, value) VALUES ('code_publish_dispatch_enabled', 'off')").run();
  r = J(await W.codeMergeTick(genv, { now: NOW }));
  ok(!(gh.dispatches || []).length, "ops_config code_publish_dispatch_enabled off: no dispatch");
  freshDb(); freshGh();
  gh.dispatchStatus = 403;
  seedTask({ status: "ready_to_publish", pr_url: null, updated_at: ago(8) });
  r = J(await W.codeMergeTick(genv, { now: NOW }));
  ok(r.publish_dispatch.dispatched === false && r.publish_dispatch.http === 403 && ev()[0].status === "error" && /dispatch HTTP 403 Resource not accessible/.test(ev()[0].text) && r.ok === true, "a refused dispatch is recorded as an error with GitHub's reason and never fails the tick", [r.publish_dispatch, ev()]);
}
// ---- MERGE-RACE-RETRY-1: "405 Base branch was modified" is retried with the same head before any update-branch
goalSetup({ status: "published", pr_url: "https://github.com/QNFO/qnfo-workers/pull/401" });
seedWorkerPr(401, BRANCH, "h1");
gh.files[401] = GPATCH;
gh.checks.h1 = green("h1", ["gate", "mirror-guard", "comparator", "guard"]);
sandbox.aiRunAttr = reviewer('{"verdict":"implements","defects":[]}');
gh.mergeRace = 1;
r = J(await W.codeMergeTick(genv, { now: NOW }));
row = one("SELECT * FROM code_tasks WHERE id = ?", ID);
ok(gh.merges.length === 2 && gh.merges.every((x) => x.sha === "h1") && row.status === "merged" && !gh.calls.some((c) => /update-branch/.test(c)), "a merge refused once with 'Base branch was modified' is retried on the same head and lands, with no update-branch (PR 986, 2026-10-12T09:00Z)", [gh.merges.length, row.status, row.merge_note]);
goalSetup({ status: "published", pr_url: "https://github.com/QNFO/qnfo-workers/pull/401" });
seedWorkerPr(401, BRANCH, "h1");
gh.files[401] = GPATCH;
gh.checks.h1 = green("h1", ["gate", "mirror-guard", "comparator", "guard"]);
gh.mergeRace = 9;
r = J(await W.codeMergeTick(genv, { now: NOW }));
row = one("SELECT * FROM code_tasks WHERE id = ?", ID);
ok(gh.merges.length === 3 && row.status === "published" && /merge HTTP 405/.test(row.merge_note) && gh.calls.filter((c) => /update-branch/.test(c)).length === 1, "after the retries are spent the branch is brought up to date once, as before", [gh.merges.length, row.status, row.merge_note]);
sandbox.aiRunAttr = async () => null;

// ================================================================ 9. MERGE-DEPLOYED-UNBLOCK-1 (0.48.0, 2026-10-26)
// The audit writer crashed at 2026-10-25T20:21Z; four runner merges stayed 'deployed' ("waiting on a live audit after deploy") for 9 hours
// and each held its worker busy, so five green research-exec pull requests were deferred ("has a change in flight") until they aged out.
{
  const STUCK = "ct_stuckdeployed1";
  const minAgo = (m) => new Date(NOW - m * 6e4).toISOString();
  // A green candidate on qnfo-demo, plus an earlier runner merge of the same worker in `state`, deployed `deployedMinAgo` minutes ago.
  const setup = async (state, deployedMinAgo, fmt) => {
    freshDb(); freshGh();
    db.prepare("INSERT INTO agent_issues (id, title, description, source, status) VALUES (50, 'OWNER-TASK-9: fix a', 'd', 'qnfo-fleet-dashboard:owner-request', 'open')").run();
    seedTask();
    seedWorkerPr(401, BRANCH, "h1");
    gh.checks.h1 = green("h1", ["gate", "mirror-guard", "comparator", "guard"]);
    gh.down = true; await W.codeMergeTick(env, { now: NOW }); gh.down = false;   // adds the code_tasks columns, merges nothing
    await W.evSchema(env);
    seedTask({ id: STUCK, branch: "codeagent-stuckdeploy", pr_url: "https://github.com/QNFO/qnfo-workers/pull/399", status: "merged" });
    const at = fmt === "sqlite" ? minAgo(deployedMinAgo).replace("T", " ").slice(0, 19) : minAgo(deployedMinAgo);
    db.prepare("UPDATE code_tasks SET merged_by = 'qnfo-fleet-control', merged_at = ?, merge_state = ?, deployed_at = ?, version_to = '1.2.0-codeagent' WHERE id = ?").run(minAgo(deployedMinAgo + 3), state, at, STUCK);
  };

  await setup("deployed", 3);
  let r9 = J(await W.codeMergeTick(env, { now: NOW }));
  ok(r9.decided[0].action === "wait" && gh.merges.length === 0 && /has a change in flight: ct_stuckdeployed1 deployed/.test(r9.decided[0].why), "a task deployed 3 minutes ago still holds its worker, and the deferral names the task holding it", r9.decided);
  ok(r9.advanced[0].merge_state === "deployed", "inside the wait the task stays deployed", r9.advanced);

  await setup("deployed", 8);
  r9 = J(await W.codeMergeTick(env, { now: NOW }));
  ok(gh.merges.length === 1 && gh.merges[0].pr === 401, "a task deployed 8 minutes ago (live audit still pending) no longer holds its worker: the green pull request merges", r9.decided);
  ok(one("SELECT merge_state FROM code_tasks WHERE id = ?", STUCK).merge_state === "deployed", "...and the earlier task is still waiting for its audit, not reverted or dropped");

  await setup("deployed", 45);
  r9 = J(await W.codeMergeTick(env, { now: NOW }));
  const stuck = one("SELECT merge_state, merge_note FROM code_tasks WHERE id = ?", STUCK);
  ok(stuck.merge_state === "unverifiable" && /no worker_live_audit row newer than the deploy within 30 minutes/.test(stuck.merge_note), "no live audit 45 minutes after the deploy: unverifiable, with the reason", stuck);
  ok(one("SELECT COUNT(*) n FROM cloud_ops_events WHERE kind = 'code-merge.unverifiable' AND status = 'error'").n === 1, "the unverifiable disposition is an error event, so the stale audit writer is visible");
  ok(one("SELECT COUNT(*) n FROM evolve_candidates WHERE kind = 'revert'").n === 0 && gh.merges.length === 1, "it is never reverted on a missing probe, and the waiting pull request merges in the same tick", gh.merges);

  await setup("deployed", 45, "sqlite");
  r9 = J(await W.codeMergeTick(env, { now: NOW }));
  ok(one("SELECT merge_state FROM code_tasks WHERE id = ?", STUCK).merge_state === "unverifiable" && gh.merges.length === 1, "a SQLite-format deployed_at (YYYY-MM-DD HH:MM:SS) is read as UTC, not skipped", r9.advanced);

  await setup("deployed", 45);
  db.prepare("INSERT INTO fleet_deploys (worker, to_sha, ok, ts) VALUES ('qnfo-demo', '1.2.0-codeagent', 1, ?)").run(minAgo(45));
  db.prepare("INSERT INTO worker_live_audit (worker, http, live_version, probed_at) VALUES ('qnfo-demo', 200, '1.2.0-codeagent', ?)").run(minAgo(10).replace("T", " ").slice(0, 19));
  r9 = J(await W.codeMergeTick(env, { now: NOW }));
  ok(one("SELECT merge_state FROM code_tasks WHERE id = ?", STUCK).merge_state === "verified", "a live audit after the deploy still verifies it, whatever its age (the bound only applies when no audit arrives)", r9.advanced);

  await setup("deploying", 60);
  r9 = J(await W.codeMergeTick(env, { now: NOW }));
  ok(r9.decided[0].action === "wait" && gh.merges.length === 0 && /has a change in flight: ct_stuckdeployed1 deploying/.test(r9.decided[0].why), "a deploy still in progress holds the worker for as long as it is deploying", r9.decided);
}

// ---- MERGEABLE-POLL-LONGER-1 (0.48.0): mergeable=null on the first reads, resolved on a later one, still merges in the same tick
{
  freshDb(); freshGh();
  db.prepare("INSERT INTO agent_issues (id, title, description, source, status) VALUES (50, 'OWNER-TASK-9: fix a', 'd', 'qnfo-fleet-dashboard:owner-request', 'open')").run();
  seedTask();
  seedWorkerPr(401, BRANCH, "h1");
  gh.checks.h1 = green("h1", ["gate", "mirror-guard", "comparator", "guard"]);
  sandbox.setTimeout = (fn) => { fn(); return 0; };   // the sandbox has no timers; the 5 s waits run instantly here
  const realGet = gh.pulls[401];
  let reads = 0;
  Object.defineProperty(gh.pulls, 401, { get() { reads++; return reads <= 4 ? Object.assign({}, realGet, { mergeable: null, mergeable_state: "unknown" }) : realGet; }, configurable: true });
  const rt = J(await W.codeMergeTick(env, { now: NOW }));
  ok(reads >= 5 && gh.merges.length === 1, "mergeability null for four reads and known on the fifth: the runner keeps reading (25 s) and merges in the same tick", { reads, decided: rt.decided });
  delete sandbox.setTimeout;
}

// ================================================================ 10. MERGE-VERSION-AHEAD-1 (0.48.1)
// qnfo-research-exec #4297 and #4282 both bumped 0.34.0 to 0.34.1 from the same base. Once the runner merges one change per worker per tick, the
// second merged clean with an unchanged VERSION and main's version-bump-guard failed (ci-watchdog #4319). The head's VERSION must be ahead of main's now.
{
  ok(W.cmVerAhead("1.2.4-codeagent", "1.2.3-demo") === true && W.cmVerAhead("1.2.10", "1.2.9") === true && W.cmVerAhead("1.3.0", "1.2.99") === true && W.cmVerAhead("2.0.0", "1.99.99") === true, "cmVerAhead: patch, minor and major steps compare numerically (1.2.10 is ahead of 1.2.9)");
  ok(W.cmVerAhead("0.34.1-codeagent", "0.34.1-codeagent") === false && W.cmVerAhead("0.34.1-a", "0.34.1-b") === false && W.cmVerAhead("1.2.3", "1.2.4") === false && W.cmVerAhead("1.2.9", "1.2.10") === false, "cmVerAhead: the same core with another suffix, and a lower core, are not ahead");
  ok(W.cmVerAhead("x", "1.2.3") === true && W.cmVerAhead("1.2.3", "") === true && W.cmVerAhead(null, null) === true, "cmVerAhead: an unreadable side is not this gate's call");

  const arrange = async (mainText) => {
    freshDb(); freshGh();
    db.prepare("INSERT INTO agent_issues (id, title, description, source, status) VALUES (50, 'OWNER-TASK-9: fix a', 'd', 'qnfo-fleet-dashboard:owner-request', 'open')").run();
    seedTask();
    seedWorkerPr(401, BRANCH, "h1");
    gh.checks.h1 = green("h1", ["gate", "mirror-guard", "comparator", "guard"]);
    if (mainText != null) gh.contents["main:" + PATH] = mainText;
    sandbox.setTimeout = (fn) => { fn(); return 0; };
    const out = J(await W.codeMergeTick(env, { now: NOW }));
    delete sandbox.setTimeout;
    return out;
  };

  let rv = await arrange(NEXT);   // main already carries 1.2.4-codeagent: the head's VERSION is the same
  let rw = one("SELECT status, last_error FROM code_tasks WHERE id = ?", ID);
  ok(gh.merges.length === 0 && rv.decided[0].action === "refuse" && /VERSION-AHEAD-1: the pull request's VERSION 1\.2\.4-codeagent is not ahead of main's 1\.2\.4-codeagent/.test(rv.decided[0].why), "main already at the head's VERSION: not merged, refused as stale with the reason", rv.decided);
  ok(rw.status === "failed" && /VERSION-AHEAD-1/.test(rw.last_error || ""), "a task with no parked edits to rebuild from ends failed with the reason, handed to the fleet", rw);

  rv = await arrange(BASE.replace('"1.2.3-demo"', '"1.3.0-newer"'));   // main is ahead of the head
  ok(gh.merges.length === 0 && rv.decided[0].action === "refuse" && /is not ahead of main's 1\.3\.0-newer/.test(rv.decided[0].why), "main ahead of the head's VERSION: not merged", rv.decided);

  rv = await arrange(BASE);   // main at 1.2.3-demo, the head at 1.2.4-codeagent
  ok(gh.merges.length === 1 && rv.decided[0].action === "merge", "main behind the head's VERSION: merges as before", rv.decided);

  rv = await arrange(null);   // main's file unreadable (404): this gate does not decide
  ok(gh.merges.length === 1, "main's file missing: the gate does not block", rv.decided);
}

// ---- MODULE-SOURCE-SCOPE-1: a worker's source module merges as that worker's change, with worker.js, its VERSION bump and its mirror
{
  const SRCM = DIR + "/companion.js", SB = "export function hi() {\n  return 1;\n}\n", SN = SB.replace("return 1", "return 11");
  const scS = J(W.cmScope(SRCM)), scW = J(W.cmScope(PATH));
  ok(scW.ok === true && scW.kind === "worker" && scW.src === undefined, "single-file worker: a worker.js task keeps its scope unchanged (no module source)", scW);
  ok(scS.ok === true && scS.kind === "worker" && scS.src === PATH && scS.mirror === MIRROR && scS.worker === DIR, "multi-file worker: <dir>/companion.js is in scope as that worker's change, carrying worker.js and the mirror", scS);
  const outside = ["qnfo-observability/fleet.js", "qnfo-autonomy-scorer/helper.js", DIR + "/companion.test.mjs", DIR + "/inline-companion.mjs", DIR + "/build.mjs", "scripts/helper.js", "docs/x.js", "migrations/x.js", "mind/x.js", "workers/" + DIR + "/x.js", DIR + "/sub/x.js", DIR + "/wrangler.toml", ".github/workflows/x.js"];
  ok(outside.every((x) => !W.cmScope(x).ok), "paths outside the worker (a control-plane worker's module, tests, build scripts, reserved directories, nested paths, config) stay out of scope", outside.filter((x) => W.cmScope(x).ok));
  const MPATCH2 = W.hunkPatch(SRCM, SB, SN) + W.hunkPatch(PATH, BASE, NEXT) + W.hunkPatch(MIRROR, BASE, NEXT);
  const mt2 = () => task({ path: SRCM, status: "branch_pushed", pr_url: null, ctx: JSON.stringify({ base: SB, patch: MPATCH2 }) });
  gh.contents["mbs:" + SRCM] = SB; gh.contents["mbs:" + PATH] = BASE; gh.contents["mbs:" + MIRROR] = BASE;
  gh.contents["hs:" + SRCM] = SN; gh.contents["hs:" + PATH] = NEXT; gh.contents["hs:" + MIRROR] = NEXT; gh.contents["hs:" + DIR + "/wrangler.toml"] = 'name = "qnfo-demo"\nmain = "worker.js"\n';
  gh.contents["main:" + PATH] = BASE;
  const ims = J(await W.cmIntegrity(env, mt2(), "hs", [SRCM, PATH, MIRROR], scS, "mbs"));
  ok(ims.ok === true && ims.version_to === "1.2.4-codeagent" && ims.revertible === true, "multi-file worker: module, worker.js and mirror each equal the verified patch on the merge base; the VERSION and the revert follow worker.js", ims);
  const imn = J(await W.cmIntegrity(env, mt2(), "hs", [SRCM], scS, "mbs"));
  ok(imn.ok === false && /not the files of the verified patch/.test(imn.why), "a module change without worker.js and its mirror is refused: the pull request files must be the verified patch files", imn);
  const imn2 = J(await W.cmIntegrity(env, task({ path: SRCM, status: "branch_pushed", pr_url: null, ctx: JSON.stringify({ base: SB, patch: W.hunkPatch(SRCM, SB, SN) }) }), "hs", [SRCM], scS, "mbs"));
  ok(imn2.ok === false && /must also carry/.test(imn2.why), "a module-only patch (no worker.js, no mirror) is refused with the reason", imn2);
  gh.contents["hs2:" + SRCM] = SN; gh.contents["hs2:" + PATH] = NEXT + "// pushed\n"; gh.contents["hs2:" + MIRROR] = NEXT; gh.contents["hs2:" + DIR + "/wrangler.toml"] = 'name = "qnfo-demo"\n';
  const imx2 = J(await W.cmIntegrity(env, mt2(), "hs2", [SRCM, PATH, MIRROR], scS, "mbs"));
  ok(imx2.ok === false && /worker\.js at the PR head hs2 is not the verified patch/.test(imx2.why), "other content pushed into the carried worker.js is refused: the check that PR files match the verified patch stays", imx2);
  const imo = J(await W.cmIntegrity(env, mt2(), "hs", [SRCM, PATH, MIRROR, "qnfo-other/worker.js"], scS, "mbs"));
  ok(imo.ok === false && /not the files of the verified patch/.test(imo.why), "a file outside the worker in the pull request is refused", imo);
}

console.log(`code-merge.test: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
