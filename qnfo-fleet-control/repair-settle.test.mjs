/**
 * repair-settle.test.mjs -- offline regression lock for STALE-PR-REPAIR-SETTLE-1 (qnfo-fleet-control 0.62.0).
 *
 * The STALE-PR-CHECK-REPAIR-1 and STALE-PR-CONFLICT-REPAIR-1 issues were opened by the branch-hygiene tick and never closed by it, so the
 * issues of pull requests that had merged (5319, 6071, 6351, 6664, 6690, 6716) stayed open for days. Drives bhSettleDecide / bhSettleTargets
 * (pure) and bhSettleRepairIssues against an in-memory SQLite D1 and a scripted GitHub. Output MUST contain "0 failed" on success.
 *
 *   node qnfo-fleet-control/repair-settle.test.mjs
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "worker.js"), "utf8");
const a = src.indexOf("// STALE-PR-REPAIR-SETTLE-1 (0.62.0");
const endMark = '__name(bhSettleRepairIssues, "bhSettleRepairIssues");';
const b = src.indexOf(endMark);
if (a < 0 || b < a) { console.error("FAIL settle block markers missing"); console.log("1 failed"); process.exit(1); }

let passed = 0, failed = 0;
function eq(actual, expected, label) { if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; return; } failed++; console.error(`FAIL ${label}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`); }

function makeD1() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, status TEXT, close_channel TEXT, updated_at INTEGER);" +
    "CREATE TABLE issue_triage (issue_id INTEGER PRIMARY KEY, rc TEXT, triage_state TEXT, owner TEXT, sla_due_at TEXT NOT NULL, close_evidence TEXT);" +
    "CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, status TEXT, last_verdict TEXT);");
  const stmt = (sql, args) => ({
    bind: (...a2) => stmt(sql, a2),
    run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
    first: async () => db.prepare(sql).get(...args) || null,
    all: async () => ({ results: db.prepare(sql).all(...args) })
  });
  return { db, AUDIT: { prepare: (sql) => stmt(sql, []) } };
}

const calls = [];
let pulls = {};
const evApi = async (env, method, path) => {
  calls.push(method + " " + path);
  const m = /^\/pulls\/(\d+)$/.exec(path);
  if (!m) return { status: 404, ok: false, j: null };
  return pulls[m[1]] ? { status: 200, ok: true, j: pulls[m[1]] } : { status: 404, ok: false, j: { message: "Not Found" } };
};
const sandbox = { evApi, __name: (f) => f, console, Date, Number, String, Array, Object, JSON, __export: null };
vm.createContext(sandbox);
vm.runInContext(src.slice(a, b + endMark.length) + "\n__export = { bhSettleDecide, bhSettleTargets, bhSettleRepairIssues, BH_SETTLE_MAX };", sandbox);
const W = sandbox.__export;

// ---- bhSettleDecide ----
eq(W.bhSettleDecide("check", { number: 6071, state: "closed", merged_at: "2026-11-03T10:00:00Z" }).settle, true, "a merged PR settles a check-repair issue");
eq(/merged at 2026-11-03T10:00:00Z/.test(W.bhSettleDecide("check", { number: 6071, state: "closed", merged_at: "2026-11-03T10:00:00Z" }).evidence), true, "evidence names the merge time");
eq(/closed unmerged/.test(W.bhSettleDecide("conflict", { number: 7, state: "closed", merged_at: null, closed_at: "2026-11-02T00:00:00Z" }).evidence), true, "a closed unmerged PR settles with that wording");
eq(W.bhSettleDecide("check", { number: 5, state: "open", mergeable: true, mergeable_state: "unstable" }).settle, false, "an open PR keeps its check-repair issue");
eq(W.bhSettleDecide("conflict", { number: 5, state: "open", mergeable: false, mergeable_state: "dirty" }).settle, false, "a still-dirty PR keeps its conflict issue");
eq(W.bhSettleDecide("conflict", { number: 5, state: "open", mergeable: null, mergeable_state: "unknown" }).settle, false, "an unknown mergeability never settles");
eq(W.bhSettleDecide("conflict", { number: 5, state: "open", mergeable: true, mergeable_state: "clean" }).settle, true, "a PR that no longer conflicts settles its conflict issue");
eq(W.bhSettleDecide("check", { number: 5, state: "open", mergeable: true, mergeable_state: "clean" }).settle, false, "mergeable alone never settles a check-repair issue");
eq(W.bhSettleDecide("check", null).settle, false, "an unread PR settles nothing");

// ---- bhSettleTargets ----
eq(W.bhSettleTargets([
  { id: 1, title: "STALE-PR-CHECK-REPAIR-1 PR 5319: guard, lint failing on a green, quiet session pull request" },
  { id: 2, title: "STALE-PR-CONFLICT-REPAIR-1 PR 6716: merge conflicts with main on a quiet session pull request" },
  { id: 3, title: "STALE-PR-CONFLICT-REPAIR-1: PR #870 x" },
  { id: 4, title: "OTHER-1 PR 5" }
]), [{ id: 1, kind: "check", pr: 5319 }, { id: 2, kind: "conflict", pr: 6716 }], "targets parse kind and PR; other titles are skipped");

// ---- bhSettleRepairIssues ----
{
  const d1 = makeD1();
  const add = (id, title) => { d1.db.prepare("INSERT INTO agent_issues (id, title, status) VALUES (?1, ?2, 'open')").run(id, title); d1.db.prepare("INSERT INTO remediation_contracts (class, status) VALUES (?1, 'open')").run("issue-" + id); };
  add(1, "STALE-PR-CHECK-REPAIR-1 PR 6071: copilot failing on a green, quiet session pull request");
  add(2, "STALE-PR-CONFLICT-REPAIR-1 PR 6716: merge conflicts with main on a quiet session pull request");
  add(3, "STALE-PR-CONFLICT-REPAIR-1 PR 6703: merge conflicts with main on a quiet session pull request");
  add(4, "STALE-PR-CHECK-REPAIR-1 PR 6999: CodeQL failing on a green, quiet session pull request");
  add(5, "STALE-PR-CHECK-REPAIR-1 PR 6071: Workers Builds failing on a green, quiet session pull request");
  d1.db.prepare("INSERT INTO agent_issues (id, title, status) VALUES (9, 'STALE-PR-CHECK-REPAIR-1 PR 6071: already closed', 'closed')").run();
  pulls = {
    6071: { number: 6071, state: "closed", merged_at: "2026-11-03T10:00:00Z" },
    6716: { number: 6716, state: "closed", merged_at: "2026-11-04T01:00:00Z" },
    6703: { number: 6703, state: "open", mergeable: false, mergeable_state: "dirty" },
    6999: { number: 6999, state: "open", mergeable: true, mergeable_state: "unstable" }
  };
  calls.length = 0;
  const r = await W.bhSettleRepairIssues({ AUDIT: d1.AUDIT }, 1762300000000);
  eq(r.settled.sort(), [1, 2, 5], "merged PRs settle every repair issue that names them, including two issues of one PR");
  eq(r.kept, 2, "the dirty and the unstable open PRs keep their issues");
  eq(calls.filter((c) => c === "GET /pulls/6071").length, 1, "one GitHub read per PR");
  const st = (id) => d1.db.prepare("SELECT status, close_channel FROM agent_issues WHERE id = ?1").get(id);
  eq(st(1), { status: "closed", close_channel: "auto:fleet-control/pr-settled" }, "issue 1 is closed with its channel");
  eq(st(3).status, "open", "issue 3 stays open");
  eq(st(4).status, "open", "issue 4 stays open");
  eq(/STALE-PR-REPAIR-SETTLE-1: GitHub reads PR #6716 merged/.test(d1.db.prepare("SELECT close_evidence FROM issue_triage WHERE issue_id = 2").get().close_evidence), true, "close_evidence quotes the GitHub read");
  eq(d1.db.prepare("SELECT last_verdict FROM remediation_contracts WHERE class = 'issue-1'").get().last_verdict, "superseded:pr-settled", "the contract of a settled issue is superseded");
  eq(d1.db.prepare("SELECT status FROM remediation_contracts WHERE class = 'issue-3'").get().status, "open", "the contract of a kept issue is untouched");
  // a second tick finds nothing left to settle
  calls.length = 0;
  const r2 = await W.bhSettleRepairIssues({ AUDIT: d1.AUDIT }, 1762300001000);
  eq(r2.settled, [], "a second tick settles nothing");
}
// an unreadable PR keeps its issue and reports the HTTP status
{
  const d1 = makeD1();
  d1.db.prepare("INSERT INTO agent_issues (id, title, status) VALUES (1, 'STALE-PR-CHECK-REPAIR-1 PR 404404: x', 'open')").run();
  pulls = {};
  const r = await W.bhSettleRepairIssues({ AUDIT: d1.AUDIT }, 1);
  eq([r.settled, r.errors], [[], ["PR 404404: HTTP 404"]], "an unreadable PR is reported, not settled");
  eq(d1.db.prepare("SELECT status FROM agent_issues WHERE id = 1").get().status, "open", "its issue stays open");
}
// the per-tick read cap
{
  const d1 = makeD1();
  pulls = {};
  for (let i = 0; i < 12; i++) { d1.db.prepare("INSERT INTO agent_issues (id, title, status) VALUES (?1, ?2, 'open')").run(i + 1, "STALE-PR-CHECK-REPAIR-1 PR " + (100 + i) + ": x"); pulls[100 + i] = { number: 100 + i, state: "closed", merged_at: "2026-11-01T00:00:00Z" }; }
  calls.length = 0;
  const r = await W.bhSettleRepairIssues({ AUDIT: d1.AUDIT }, 1);
  eq([r.read, r.settled.length], [W.BH_SETTLE_MAX, W.BH_SETTLE_MAX], "GitHub reads per tick are capped");
}
// the tick wires the step in
eq(/out\.repair_settled = await bhSettleRepairIssues\(env, nowMs\)/.test(src), true, "branchHygieneTick calls the settle step");

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
