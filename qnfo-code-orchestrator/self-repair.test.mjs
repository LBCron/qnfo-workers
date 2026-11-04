// SELF-REPAIR-1 offline suite (qnfo-code-orchestrator 0.3.7, agent_issues #1768, pillar autonomy).
// Replays code task ct_qldqse7ngltdth (issue #1763, Q08-VOTE-CUTOFF-1): a ~93 KB worker.js with no final newline, an anchor on
// feedbackScan, and a goal that edits BOTH of two near-identical SQL lines. Live on 2026-10-02 rung 1 matched both lines, rungs 2 and
// 3 replied with no SEARCH/REPLACE block, all inside one 26 s tick, and the task became a needs_human owner card. This suite proves:
//   1. the model sees an anchor-centred window, not the 93 KB file;
//   2. a duplicate SEARCH is fed back with the places it matched, and a no-block reply is classified and kept for diagnosis;
//   3. a failed round waits for a backoff instead of reaching a person, and the next round starts again at the first rung;
//   4. the next round lands the edit: both lines changed, VERSION bumped, mirror carried, patch applies with git;
//   5. a task that fails every round is 'failed' with exactly ONE fleet agent_issues row, never an owner card, and that row cannot
//      become a code task itself.
// Real SQL (node:sqlite behind a D1-shaped shim), scripted model, scripted GitHub raw reads, real git apply.
// Run: node --no-warnings qnfo-code-orchestrator/self-repair.test.mjs   (exit 0 = all passed)
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
const atLeast = (v, min) => { const a = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v || "")), b = min.split(".").map(Number); if (!a) return false; for (let i = 0; i < 3; i++) { if (+a[i + 1] !== b[i]) return +a[i + 1] > b[i]; } return true; }; // semver minimum, so a minor bump keeps passing

const here = path.dirname(fileURLToPath(import.meta.url));
const worker = (await import(pathToFileURL(path.join(here, "worker.js")).href)).default;

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? "  -- " + JSON.stringify(x).slice(0, 600) : "")); } };

// ---- D1 shim; agent_issues carries production's open-title unique index ----
function makeD1() {
  const db = new DatabaseSync(":memory:");
  const wrap = (sql) => {
    let args = [];
    const st = {
      bind: (...a) => { args = a.map((v) => (v === undefined ? null : v)); return st; },
      run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
      first: async () => db.prepare(sql).get(...args) || null,
      all: async () => ({ results: db.prepare(sql).all(...args) }),
    };
    return st;
  };
  db.exec(`CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT DEFAULT 'optimization', priority TEXT DEFAULT 'medium', status TEXT DEFAULT 'open', linked_session TEXT, created_at INTEGER, updated_at INTEGER);
    CREATE UNIQUE INDEX idx_agent_issues_open_title ON agent_issues(title) WHERE status = 'open';
    CREATE TABLE cloud_ops_events (id TEXT, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT);`);
  return { prepare: wrap, _db: db };
}

// ---- the fixture: q08-signal-engine's shape. Lines S1 and S2 are verbatim from q08-signal-engine/worker.js (feedbackScan). ----
const S1 = `    "(SELECT COUNT(*) FROM q08_feedback f WHERE f.slug = p.slug AND f.signal = 'good') AS g, " +`;
const S2 = `    "(SELECT COUNT(*) FROM q08_feedback f WHERE f.slug = p.slug AND f.signal IN ('flat','no')) AS b " +`;
const CUT = " AND f.created_at >= '2026-10-03T00:00:00Z'";
const ANCHOR = "async function feedbackScan(env) {";
const fn = [
  ANCHOR,
  "  // Rank prompt_pool by READER VERDICTS (worth your time?): votes, not views.",
  "  var rows = await env.DB.prepare(",
  `    "SELECT pp.id, pp.piece_id, pp.structure_md, p.slug, p.reads, " +`,
  S1,
  S2,
  `    "FROM prompt_pool pp JOIN published_pieces p ON p.id = pp.piece_id WHERE pp.active = 1"`,
  "  ).all();",
  "  var all = rows.results || [];",
  "  return { promoted: 0, purged: 0, n: all.length };",
  "}",
];
const lines = ["// q08-signal-engine (fixture)", 'var VERSION = "0.7.37-cadence-cap"; // v0.7.37 Q08-CADENCE-CAP-1'];
for (let i = 0; i < 800; i++) lines.push("function filler" + i + "(env) { return env && env.FLAG_" + i + " ? " + i + " : 0; }");
lines.push(...fn);
for (let i = 800; i < 1375; i++) lines.push("function filler" + i + "(env) { return env && env.FLAG_" + i + " ? " + i + " : 0; }");
lines.push("export default {", "  async fetch(req, env) { return new Response('ok'); },", "};");
const BIG = lines.join("\n"); // no final newline, like q08-signal-engine/worker.js
const WANT = BIG.replace(S1, S1.replace("f.slug = p.slug", "f.slug = p.slug" + CUT)).replace(S2, S2.replace("f.slug = p.slug", "f.slug = p.slug" + CUT))
  .replace('"0.7.37-cadence-cap"', '"0.7.38-codeagent"');
ok(BIG.length > 90000 && BIG.length < 100000 && BIG.charAt(BIG.length - 1) !== "\n", "fixture: ~93 KB like q08-signal-engine, no final newline", BIG.length);
ok(BIG.split("WHERE f.slug = p.slug AND f.signal").length - 1 === 2 && BIG.split(ANCHOR).length - 1 === 1, "fixture: the anchor is unique and the edited text occurs twice");

const FILES = { "q08-signal-engine/worker.js": BIG, "q08-signal-engine/deployed-current.worker.js": BIG };
globalThis.fetch = async (u) => {
  const m = /^https:\/\/raw\.githubusercontent\.com\/QNFO\/qnfo-workers\/main\/(.+)$/.exec(String(u));
  const p = m ? decodeURIComponent(m[1]) : null;
  return p && FILES[p] != null ? new Response(FILES[p], { status: 200 }) : new Response("nf", { status: 404 });
};
// The JS verifier the platform measured as enforced (/health js_verify auto-on); the fake replays "it parsed" like test-loop.mjs.
const fakeLoader = { load: () => ({ getEntrypoint: () => ({ fetch: async () => new Response("ok") }) }) };
function envWith(replies) {
  const calls = [];
  const env = { ORCH_TOKEN: "t0ken", AUDIT_DB: makeD1(), PR_PUBLISH_MODE: "pull", JS_VERIFY: "dynamic", LOADER: fakeLoader,
    AI: { run: async (model, input) => { calls.push({ model, prompt: input.messages[1].content }); const r = replies.shift(); return { response: typeof r === "function" ? r(input) : (r == null ? "" : r) }; } } };
  return { env, calls };
}
const tick = async (env) => (await worker.fetch(new Request("https://x/v1/tick", { method: "POST", headers: { authorization: "Bearer t0ken", "content-type": "application/json" }, body: JSON.stringify({ maxSteps: 12, budgetMs: 25000, plan: false }) }), env)).json();
const row = (env, id) => env.AUDIT_DB._db.prepare("SELECT * FROM code_tasks WHERE id=?").get(id);
const expire = (env, id) => env.AUDIT_DB._db.prepare("UPDATE code_tasks SET lease_until=? WHERE id=?").run(new Date(Date.now() - 1000).toISOString(), id);
const block = (a, b) => "<<<<<<< SEARCH\n" + a + "\n=======\n" + b + "\n>>>>>>> REPLACE";
// The dashboard's owner-card query for code tasks, read from qnfo-fleet-dashboard itself so this suite follows it if it changes.
const dash = fs.readFileSync(path.join(here, "..", "qnfo-fleet-dashboard", "worker.js"), "utf8");
const dm = /read\("code-tasks"[\s\S]{0,200}?d1all\(env\.AUDIT, "([^"]+)"/.exec(dash);
ok(!!dm && /FROM code_tasks/.test(dm[1]), "the dashboard's code-task owner-card query was found in qnfo-fleet-dashboard/worker.js", dm && dm[1]);
const ownerCards = (env) => (dm ? env.AUDIT_DB._db.prepare(dm[1]).all() : [{ missing: true }]);
const LADDER = ["@cf/openai/gpt-oss-120b", "@cf/zai-org/glm-5.3", "@cf/moonshotai/kimi-k2.7-code"]; // COST-CUT-CODE-1 (glm before kimi) LADDER-COST-FIRST-1 (cheapest equal-yield rung first) // LADDER-DEAD-RUNG-1 (deepseek-v4-flash-0731 removed: empty replies disproved the 0.18.9 budget fix)

// Issue #1763 as it reached the loop: an opted-in issue with a code-task and a code-anchor line (ISSUE-INTAKE-1).
const GOAL_TEXT = "Part of #1758. Inside feedbackScan only, in BOTH SQL subqueries that read q08_feedback f, add the condition AND f.created_at >= '2026-10-03T00:00:00Z' directly after f.slug = p.slug. Change nothing else.";
function fileIssue(env) {
  return Number(env.AUDIT_DB._db.prepare("INSERT INTO agent_issues (title, description, source, category, priority, status, created_at) VALUES (?,?,?,?,?,?,?)")
    .run("Q08-VOTE-CUTOFF-1: q08 feedbackScan ignores pre-fix crawler votes", "code-task: repo=qnfo-workers path=q08-signal-engine/worker.js\ncode-anchor: " + ANCHOR + "\n" + GOAL_TEXT, "claude-session:Q08-SELF-IMPROVE-1", "reliability", "high", "open", Date.now() - 3600e3).lastInsertRowid);
}

// ===== A. the live failure, then the self-repair =====
{
  const dupSearch = block("WHERE f.slug = p.slug AND f.signal", "WHERE f.slug = p.slug" + CUT + " AND f.signal");
  const prose = "I will add the cutoff to both subqueries. Here is the updated function:\n```js\n" + fn.join("\n") + "\n```";
  const thinking = "<think>The user wants a created_at cutoff in feedbackScan. Let me look at both subqueries carefully";
  const twoBlocks = block(S1, S1.replace("f.slug = p.slug", "f.slug = p.slug" + CUT)) + "\n" + block(S2, S2.replace("f.slug = p.slug", "f.slug = p.slug" + CUT));
  const { env, calls } = envWith([dupSearch, prose, thinking, dupSearch, twoBlocks]);
  const issueId = fileIssue(env);
  await tick(env);
  const t = env.AUDIT_DB._db.prepare("SELECT * FROM code_tasks").get();
  ok(t && t.goal.indexOf("[issue #" + issueId + "]") === 0, "A0 intake turned the opted-in issue into one code task with the anchor", t && t.goal);
  const id = t.id;
  const cx = JSON.parse(t.ctx || "{}");

  // 1. window, not the file
  ok(cx.mode === "patch" && cx.anchor === ANCHOR && cx.win.we - cx.win.ws < 26000 && cx.mirror === "q08-signal-engine/deployed-current.worker.js", "A1 patch mode: an anchor-centred window of the 93 KB file and the mirror recorded", { mode: cx.mode, win: cx.win, mirror: cx.mirror });
  ok(calls.length === 3 && calls.every((c) => c.prompt.length < 30000 && c.prompt.includes(S1) && c.prompt.includes("Only part of the file")), "A1 every rung saw the window (under 30,000 chars), never the whole file", calls.map((c) => c.prompt.length));
  ok(calls.map((c) => c.model).join() === LADDER.join(), "A1 round 1 climbed the default ladder: gpt-oss-120b, then kimi-k2.7-code, then glm-5.3 (LADDER-DEAD-RUNG-1)", calls.map((c) => c.model));

  // 2. feedback that names the places, and a classified, kept no-block reply
  const fb = calls[1].prompt.slice(calls[1].prompt.indexOf("Your previous attempt FAILED"));
  ok(/occurs 2 times/.test(fb) && /line \d+: "\(SELECT COUNT\(\*\) FROM q08_feedback f WHERE f\.slug = p\.slug AND f\.signal = 'good'\) AS g/.test(fb) && /line \d+: "\(SELECT COUNT\(\*\) FROM q08_feedback f WHERE f\.slug = p\.slug AND f\.signal IN \('flat','no'\)\) AS b/.test(fb) && /one block per place/.test(fb), "A2 rung 2 was told both places the duplicate SEARCH matched, with their lines", fb.slice(0, 500));
  ok(/no SEARCH\/REPLACE block found in the reply \(\d+ chars; it began: I will add the cutoff/.test(calls[2].prompt), "A2 rung 3 was told rung 2's reply had no block and how it began", calls[2].prompt.slice(-400));

  // 3. a failed round waits; it is not an owner card
  const r1 = row(env, id);
  const c1 = JSON.parse(r1.ctx);
  ok(r1.status === "queued" && r1.attempts === 3 && Date.parse(r1.lease_until) > Date.now() + 3 * 60000, "A3 after 3 failed attempts the task waits 5 minutes (queued, lease_until), it is not needs_human", { st: r1.status, a: r1.attempts, lease: r1.lease_until });
  ok(/<think> reasoning/.test(r1.last_error) && /round 1 of 3 failed/.test(r1.last_error), "A3 last_error says why (reasoning cut off) and which round failed", r1.last_error);
  ok(typeof c1.lastReply === "string" && c1.lastReply.indexOf("<think>") === 0 && /<think> reasoning/.test(c1.lastError), "A3 the reply that held no block is kept in ctx.lastReply for diagnosis", c1.lastReply && c1.lastReply.slice(0, 80));
  ok(ownerCards(env).length === 0, "A3 no owner card: the dashboard's code-task query returns nothing", ownerCards(env));
  await tick(env);
  ok(calls.length === 3 && row(env, id).attempts === 3, "A3 the backoff is honoured: a tick inside it calls no model", calls.length);

  // 4. the next round starts at the first rung and lands the edit
  expire(env, id);
  await tick(env);
  const r2 = row(env, id);
  ok(calls.slice(3).map((c) => c.model).join() === LADDER.slice(0, 2).join(), "A4 round 2 restarted at the first rung and the second rung landed it", calls.map((c) => c.model));
  ok(r2.status === "ready_to_publish" && r2.attempts === 4 && r2.last_error == null, "A4 the task reached ready_to_publish with no person involved", { st: r2.status, a: r2.attempts, err: r2.last_error });
  const c2 = JSON.parse(r2.ctx);
  ok(c2.lastReply === undefined, "A4 ctx.lastReply is cleared once a reply is usable");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sr-"));
  fs.mkdirSync(path.join(dir, "q08-signal-engine"));
  for (const f of Object.keys(FILES)) fs.writeFileSync(path.join(dir, f), FILES[f]);
  fs.writeFileSync(path.join(dir, "p.diff"), c2.patch || "");
  const ap = spawnSync("git", ["-c", "core.autocrlf=false", "apply", "p.diff"], { cwd: dir, encoding: "utf8" });
  const outSrc = fs.readFileSync(path.join(dir, "q08-signal-engine/worker.js"), "utf8");
  const outMir = fs.readFileSync(path.join(dir, "q08-signal-engine/deployed-current.worker.js"), "utf8");
  ok(ap.status === 0 && outSrc === WANT && outMir === WANT, "A4 git apply gives exactly the goal: both subqueries cut off, VERSION bumped, mirror identical, nothing else", { err: ap.stderr, same: outSrc === WANT });
  ok((c2.patch || "").length < 6000 && ((c2.patch || "").match(/^diff --git /gm) || []).length === 2, "A4 the patch is a minimal hunk diff for the source and its mirror", (c2.patch || "").length);
  ok(ownerCards(env).length === 0, "A4 still no owner card");
}

// ===== B. a task no model can do: three rounds, then ONE fleet issue, never an owner card =====
{
  // FAIL-SIGNATURE-STOP-1 (0.16.0): three failures of one kind in a row now end the task early (fail-signature-stop.test.mjs), so
  // the rounds are driven by three different failures in turn: a SEARCH absent from the file, prose with no block, an empty reply.
  const kinds = [block("this text is nowhere in the file", "x"), "", "I would rather explain the change than make it."]; // COST-CUT-CODE-1: glm is rung 2, so the empty reply (which kimi answers with a second call) sits on rung 2
  const { env, calls } = envWith(new Array(9).fill(0).map((_, i) => kinds[i % 3]));
  fileIssue(env);
  await tick(env);
  const id = env.AUDIT_DB._db.prepare("SELECT id FROM code_tasks").get().id;
  const lease1 = row(env, id).lease_until;
  expire(env, id); await tick(env);
  const r2 = row(env, id);
  ok(r2.status === "queued" && r2.attempts === 6 && Date.parse(r2.lease_until) > Date.now() + 13 * 60000 && Date.parse(r2.lease_until) <= Date.now() + 15 * 60000 + 60e3 && /round 2 of 3/.test(r2.last_error), "B1 round 2 failed: the second backoff is 15 minutes (SLA-COMPRESS-1: inside every step SLA)", { st: r2.status, a: r2.attempts, lease: r2.lease_until });
  ok(Date.parse(lease1) < Date.parse(r2.lease_until), "B1 the backoff grows between rounds");
  expire(env, id); await tick(env);
  const r3 = row(env, id);
  const iss = env.AUDIT_DB._db.prepare("SELECT * FROM agent_issues WHERE source = 'qnfo-code-orchestrator'").all();
  ok(calls.length === 9 && calls.map((c) => c.model).join() === LADDER.concat(LADDER, LADDER).join(), "B2 nine attempts in all, each round climbing the whole ladder once", calls.map((c) => c.model));
  ok(r3.status === "failed" && r3.attempts === 9 && r3.lease_until == null, "B2 after the last round the task is failed, not needs_human", { st: r3.status, a: r3.attempts });
  ok(iss.length === 1 && iss[0].status === "open" && iss[0].title === "CODE-LOOP-EXHAUSTED-1: " + id + " q08-signal-engine/worker.js" && iss[0].category === "automation", "B2 exactly one open fleet issue names the task", iss.map((i) => i.title));
  ok(iss[0] && iss[0].description.indexOf(id) >= 0 && /UPDATE code_tasks SET status = 'queued', step = 'read', attempts = 0/.test(iss[0].description) && /no SEARCH\/REPLACE block found/.test(iss[0].description) && /Definition of done/.test(iss[0].description), "B2 the issue carries the last error, the evidence query, the lever and a definition of done", iss[0] && iss[0].description.slice(0, 300));
  ok(iss[0] && !/code-task:/i.test(iss[0].description), "B2 the fleet issue holds no code-task: marker (intake can never turn it into a code task)");
  ok(new RegExp("agent_issues #" + (iss[0] && iss[0].id)).test(r3.last_error), "B2 the task's last_error points at the fleet issue", r3.last_error);
  ok(ownerCards(env).length === 0, "B2 no owner card at any point", ownerCards(env));
  const ev = env.AUDIT_DB._db.prepare("SELECT status FROM cloud_ops_events WHERE kind = 'code-task.handoff'").all();
  ok(ev.length === 1 && ev[0].status === "ok", "B2 the hand-off is audited once", ev);

  // replays: a failed task is never claimed again, and a second exhaustion of the same task does not file a second issue
  await tick(env);
  ok(calls.length === 9 && env.AUDIT_DB._db.prepare("SELECT COUNT(*) AS n FROM code_tasks").get().n === 1, "B3 a failed task is not retried and the fleet issue does not become a code task", calls.length);
  env.AUDIT_DB._db.prepare("UPDATE code_tasks SET status='queued', step='propose', attempts=6, lease_until=NULL WHERE id=?").run(id);
  await tick(env);
  const again = env.AUDIT_DB._db.prepare("SELECT COUNT(*) AS n FROM agent_issues WHERE source = 'qnfo-code-orchestrator'").get().n;
  ok(row(env, id).status === "failed" && again === 1, "B3 exhausting the same task again keeps one open fleet issue (deduped by title)", { st: row(env, id).status, issues: again });
}

// ===== C. what a model cannot fix still stops (policy refusals are unchanged) =====
// ANCHOR-LOCATOR-1 makes one pick when the planner excerpts for the goal exist; a stub that answers empty is retried once by the model helper, so a pick is up to two calls.
// PLAN-LARGE-FILE-ANCHORS-1 (0.29.4, pull request 5511) keeps sampled source windows when a 486-line match region overflows the excerpt budget. It used to keep none, the locator
// returned at once and no model was called; that accident is what this case encoded as "before any model call". What still holds is the policy: the task parks needs_human with
// the reason, and the only model calls are locator picks, never a propose, review or repair call.
{
  const { env, calls } = envWith([]);
  await worker.fetch(new Request("https://x/v1/tasks", { method: "POST", headers: { authorization: "Bearer t0ken", "content-type": "application/json" }, body: JSON.stringify({ repo: "qnfo-workers", path: "q08-signal-engine/worker.js", goal: "make a change somewhere in this file", anchor: "function filler1" }) }), env);
  await tick(env);
  const r = env.AUDIT_DB._db.prepare("SELECT status, last_error FROM code_tasks").get();
  ok(r.status === "needs_human" && /must occur exactly once/.test(r.last_error) && calls.length <= 2 && calls.every((c) => /^TASK: /.test(String(c.prompt)) && /FILE EXCERPTS/.test(String(c.prompt))), "C1 a non-unique anchor still parks the task: at most one locator pick (its empty-reply retry included) and no propose call", { r, calls: calls.length });
}

// ===== D. /health tells the truth about it =====
{
  const { env } = envWith([]);
  const h = await (await worker.fetch(new Request("https://x/health"), env)).json();
  ok(atLeast(h.version, "0.3.0") && /^\d+\.\d+\.\d+-/.test(h.version) && h.capabilities.includes("self-repair") && h.limitations.some((l) => /SELF-REPAIR-1/.test(l) && /5m, then 15m/.test(l) && /3 rounds/.test(l)), "D1 /health names the self-repair capability and its limits", { v: h.version, l: h.limitations.filter((l) => /SELF-REPAIR/.test(l)) });
}

console.log("self-repair: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
