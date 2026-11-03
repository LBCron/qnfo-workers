// FIX-VERIFY-1 offline suite for the path-claim ceiling in qnfo-code-orchestrator pathBusy (agent_issues 2782; shipped as
// 0.16.3-claim-ceiling under PATH-CLAIM-CEILING-1, agent_issues 2726). The fix had no suite and no live repro: the "path busy" refusals
// had already stopped before the deploy, so nothing proved that a stale claim is released instead of refused. This suite slices the real
// pathBusy, taskPaths and CODE_TASK_DONE out of worker.js and runs them against the real work_claims / code_tasks / agent_issues /
// cloud_ops_events shapes in node:sqlite. Proves:
//   - a live claim on the file (fresh, with an open issue) refuses the intake and is left alone, with no ceiling event;
//   - a claim whose issue is no longer open is released once, outcome released-stale:issue-<status>, with exactly one
//     'claim-ceiling' cloud_ops_events row, and the intake is NOT refused;
//   - a claim older than 90 minutes that owns no pull request is released the same way (released-stale:age-<min>m-no-pr), while a claim
//     of 89 minutes, or an old claim that owns a pull request, still refuses;
//   - the claim on the mirror file (deployed-current.worker.js) counts for the worker.js intake and the reverse;
//   - an expired or already released claim, and a repository other than qnfo-workers, are ignored, and nothing is written;
//   - an unfinished code task on the file refuses, a finished one does not;
//   - fail-soft: no work_claims table, or no cloud_ops_events table, never refuses the intake;
//   - a second intake after the release is not refused and writes no second event;
//   - MUTATION SELF-CHECK: the same scenarios run against four mutated copies of the sliced source (the 90-minute ceiling raised, the age
//     test inverted, the pull-request exemption dropped, the issue-status test dropped) and each mutant is caught by name.
// The `?N` placeholders are rewritten to positional ones so the suite binds the same way on every platform (WINDOWS-SUITE-PARITY-1).
// Run: node --no-warnings qnfo-code-orchestrator/claim-ceiling.test.mjs   (exit 0 = all passed)
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, "worker.js"), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 400) : "")); } };
const grab = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); return i >= 0 && j > i ? src.slice(i, j) : ""; };

const parts = {
  done: grab("const CODE_TASK_DONE = [", "\n// PLAN-WIP-SUPERSEDED-1"),
  paths: grab("function taskPaths(path) {", "\n// NO-PROGRESS-CEILING-1"),
  busy: grab("var CLAIM_TTL_MAX_MS", "\n// RETIRED-TARGET-1"),
  owner: grab("const CLAIM_OWNER = ", "\nconst CLAIM_TTL_S"),
};
ok(parts.done.includes("CODE_TASK_DONE") && parts.paths.includes("taskPaths") && parts.busy.includes("async function pathBusy"), "CODE_TASK_DONE, taskPaths and pathBusy are found in worker.js", Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, v.length])));
ok(parts.owner.includes("CLAIM_OWNER"), "pathBusy's claim owner dependency is found in worker.js");
ok(/var CLAIM_TTL_MAX_MS = 90 \* 60 \* 1e3;/.test(parts.busy), "the ceiling is 90 minutes");

// pathNoProgress (the task-level ceiling, NO-PROGRESS-CEILING-1) has its own suite; here it only answers "keep the file" or "freed".
const build = (text) => new Function("pathNoProgress", "audit", text + "\nreturn { pathBusy, CLAIM_TTL_MAX_MS, taskPaths };");
const mkLib = (text, ctl) => build(text)(async () => ctl.noProgress, async () => {});

const SCHEMA = `
  CREATE TABLE code_tasks (id TEXT PRIMARY KEY, repo TEXT, path TEXT, status TEXT, attempts INTEGER DEFAULT 0, created_at TEXT, ctx TEXT, last_error TEXT);
  CREATE TABLE work_claims (id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL, intent TEXT NOT NULL, holder TEXT NOT NULL, issue_id INTEGER, pr INTEGER,
    claimed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), expires_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now','+2 hours')), released_at TEXT, outcome TEXT);
  CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, status TEXT);
  CREATE TABLE cloud_ops_events (id TEXT PRIMARY KEY, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT);
`;
const stamp = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const ago = (min) => stamp(Date.now() - min * 60000);
const ahead = (min) => stamp(Date.now() + min * 60000);
const mkEnv = (opts = {}) => {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  if (opts.noClaims) db.exec("DROP TABLE work_claims");
  if (opts.noEvents) db.exec("DROP TABLE cloud_ops_events");
  const norm = (sql, binds) => {
    if (!/\?\d/.test(sql)) return [sql, binds];
    const args = [];
    return [sql.replace(/\?(\d+)/g, (_, n) => { args.push(binds[Number(n) - 1] === undefined ? null : binds[Number(n) - 1]); return "?"; }), args];
  };
  const stmt = (sql, binds = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => { const [s, a] = norm(sql, binds); return db.prepare(s).get(...a) || null; },
    run: async () => { const [s, a] = norm(sql, binds); const r = db.prepare(s).run(...a); return { meta: { changes: Number(r.changes) } }; },
  });
  return { db, env: { AUDIT_DB: { prepare: (sql) => stmt(sql) } } };
};
const claim = (db, o) => db.prepare("INSERT INTO work_claims (path, intent, holder, issue_id, pr, claimed_at, expires_at, released_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
  .run(o.path || "qnfo-research-exec/worker.js", o.intent || "fix it", o.holder || "session_a", o.issue === undefined ? null : o.issue, o.pr === undefined ? null : o.pr, o.claimed || ago(10), o.expires || ahead(110), o.released || null);
const events = (db) => { try { return db.prepare("SELECT kind, text FROM cloud_ops_events ORDER BY ts, id").all(); } catch { return null; } };
const claims = (db) => db.prepare("SELECT holder, released_at, outcome FROM work_claims ORDER BY id").all();
const P = "qnfo-research-exec/worker.js", M = "qnfo-research-exec/deployed-current.worker.js", R = "qnfo-workers";

// Every scenario returns { name: boolean }; the real source must pass all of them and each mutant must fail the named ones.
async function scenarios(text) {
  const out = {};
  const ctl = { noProgress: false };
  const lib = mkLib(text, ctl);
  { const { db, env } = mkEnv();
    out.free = (await lib.pathBusy(env, R, P)) === null; }
  { const { db, env } = mkEnv(); claim(db, { issue: 7 }); db.prepare("INSERT INTO agent_issues VALUES (7, 't', 'open')").run();
    const r = await lib.pathBusy(env, R, P);
    out.liveRefused = typeof r === "string" && /session session_a holds the work claim on qnfo-research-exec\/worker\.js until /.test(r) && claims(db)[0].released_at === null && events(db).length === 0; }
  { const { db, env } = mkEnv(); claim(db, { issue: 7, claimed: ago(5) }); db.prepare("INSERT INTO agent_issues VALUES (7, 't', 'closed')").run();
    const r = await lib.pathBusy(env, R, P);
    const c = claims(db)[0], e = events(db);
    out.issueClosedReleased = r === null && c.released_at !== null && c.outcome === "released-stale:issue-closed" && e.length === 1 && e[0].kind === "claim-ceiling" && e[0].text === "released stale claim on " + P + " (issue-closed, holder session_a)";
    const again = await lib.pathBusy(env, R, P);
    out.releasedOnce = again === null && events(db).length === 1; }
  { const { db, env } = mkEnv(); claim(db, { claimed: ago(100) }); // no issue, no PR, older than 90 minutes, lease still running
    const r = await lib.pathBusy(env, R, P);
    const c = claims(db)[0], e = events(db);
    out.ageReleased = r === null && /^released-stale:age-10[01]m-no-pr$/.test(String(c.outcome)) && c.released_at !== null && e.length === 1 && /\(age-10[01]m-no-pr, holder session_a\)/.test(e[0].text); }
  { const { db, env } = mkEnv(); claim(db, { claimed: ago(89) });
    const r = await lib.pathBusy(env, R, P);
    out.insideCeilingRefused = typeof r === "string" && claims(db)[0].released_at === null && events(db).length === 0; }
  { const { db, env } = mkEnv(); claim(db, { claimed: ago(91) });
    const r = await lib.pathBusy(env, R, P);
    out.justPastCeilingReleased = r === null && claims(db)[0].released_at !== null; }
  { const { db, env } = mkEnv(); claim(db, { claimed: ago(150), pr: 2901 }); // old but it owns a pull request: the work is alive
    const r = await lib.pathBusy(env, R, P);
    out.oldWithPrRefused = typeof r === "string" && claims(db)[0].released_at === null && events(db).length === 0; }
  { const { db, env } = mkEnv(); claim(db, { claimed: ago(100), issue: 9 }); db.prepare("INSERT INTO agent_issues VALUES (9, 't', 'open')").run();
    const r = await lib.pathBusy(env, R, P); // issue open, but older than the ceiling and no PR: released by age
    out.openIssueAgeReleased = r === null && /^released-stale:age-/.test(String(claims(db)[0].outcome)); }
  { const { db, env } = mkEnv(); claim(db, { path: M, claimed: ago(100) }); // the mirror file is the same file for the intake
    out.mirrorClaimSeen = (await lib.pathBusy(env, R, P)) === null && claims(db)[0].released_at !== null;
    const e2 = mkEnv(); claim(e2.db, { path: M, claimed: ago(10) });
    out.mirrorClaimRefuses = typeof (await lib.pathBusy(e2.env, R, P)) === "string";
    const e3 = mkEnv(); claim(e3.db, { path: P, claimed: ago(10) });
    out.mirrorIntakeSeesWorkerClaim = typeof (await lib.pathBusy(e3.env, R, M)) === "string"; }
  { const { db, env } = mkEnv(); claim(db, { expires: ago(1), claimed: ago(130) }); claim(db, { released: ago(2), claimed: ago(130), holder: "session_b" });
    out.expiredOrReleasedIgnored = (await lib.pathBusy(env, R, P)) === null && claims(db).every((c) => c.outcome === null) && events(db).length === 0; }
  { const { db, env } = mkEnv(); claim(db, { claimed: ago(10) });
    out.otherRepoSkipsClaims = (await lib.pathBusy(env, "some-other-repo", P)) === null && claims(db)[0].released_at === null; }
  { const { db, env } = mkEnv(); claim(db, { path: "qnfo-other/worker.js", claimed: ago(100) });
    out.otherPathUntouched = (await lib.pathBusy(env, R, P)) === null && claims(db)[0].released_at === null && events(db).length === 0; }
  { const { db, env } = mkEnv(); db.prepare("INSERT INTO code_tasks (id, repo, path, status, attempts, created_at) VALUES ('ct_1', ?, ?, 'queued', 0, ?)").run(R, P, ago(5));
    const r = await lib.pathBusy(env, R, P);
    out.taskInFlightRefused = typeof r === "string" && /code task ct_1 \(queued\) is still in flight on qnfo-workers\/qnfo-research-exec\/worker\.js; one change per file at a time/.test(r);
    ctl.noProgress = true; // the task-level ceiling frees the file
    out.taskFreedByNoProgress = (await lib.pathBusy(env, R, P)) === null;
    ctl.noProgress = false; }
  { const { db, env } = mkEnv(); db.prepare("INSERT INTO code_tasks (id, repo, path, status, attempts, created_at) VALUES ('ct_2', ?, ?, 'merged', 3, ?)").run(R, P, ago(500));
    out.taskDoneNotBusy = (await lib.pathBusy(env, R, P)) === null; }
  { const { env } = mkEnv({ noClaims: true });
    out.noLedgerFailSoft = (await lib.pathBusy(env, R, P)) === null; }
  { const { db, env } = mkEnv({ noEvents: true }); claim(db, { claimed: ago(100) });
    out.eventWriteFailSoft = (await lib.pathBusy(env, R, P)) === null; }
  return out;
}

const real = await scenarios(Object.values(parts).join("\n"));
const names = Object.keys(real);
ok(names.length >= 19, "the scenario set is complete", names.length);
for (const n of names) ok(real[n] === true, "scenario passes on the shipped source: " + n);

// MUTATION SELF-CHECK: a suite that cannot tell the ceiling from no ceiling proves nothing (FIX-VERIFY-1).
const mutants = [
  ["ceiling raised to 90 hours", (t) => t.replace("var CLAIM_TTL_MAX_MS = 90 * 60 * 1e3;", "var CLAIM_TTL_MAX_MS = 90 * 60 * 60 * 1e3;"), ["ageReleased", "justPastCeilingReleased", "openIssueAgeReleased", "mirrorClaimSeen", "eventWriteFailSoft"]],
  ["age test inverted", (t) => t.replace("age > CLAIM_TTL_MAX_MS", "age < CLAIM_TTL_MAX_MS"), ["ageReleased", "insideCeilingRefused", "justPastCeilingReleased"]],
  ["pull-request exemption dropped", (t) => t.replace("if (!stale && !c.pr) {", "if (!stale) {"), ["oldWithPrRefused"]],
  ["issue-status test dropped", (t) => t.replace("if (iss && String(iss.status || \"\") !== \"open\") stale", "if (false) stale"), ["issueClosedReleased", "releasedOnce"]],
];
for (const [label, mutate, mustFail] of mutants) {
  const text = Object.values(parts).join("\n");
  const mutated = mutate(text);
  ok(mutated !== text, "mutant applies to the sliced source: " + label);
  const got = await scenarios(mutated);
  const caught = mustFail.filter((n) => got[n] !== true);
  ok(caught.length === mustFail.length, "mutant '" + label + "' is caught by " + mustFail.join(", "), { caught, got: Object.keys(got).filter((n) => got[n] !== true) });
}

console.log(fail ? fail + " failed, " + pass + " passed" : pass + " passed, 0 failed");
process.exit(fail ? 1 : 0);
