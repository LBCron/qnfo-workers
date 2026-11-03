// COPILOT-PR-LIFECYCLE-1 offline suite (scripts/copilot-pr-lifecycle.mjs, workflow copilot-pr-lifecycle, lane-poke branches-ignore). No network: a fake GitHub.
// Proves: the owner is removed as reviewer and as assignee of a Copilot pull request and of the issue it fixes, a person who is not the owner is left
// alone, other authors' pull requests and fork heads are never touched; nothing is approved while the agent is still working; a finished agent's gated
// pull_request runs are approved only when the diff avoids every denied path (workflows, scripts, wrangler and package manifests, shell, Docker, yaml), a
// withheld approval is explained once per head commit, a 403 on approve is recorded and stops that pull request only; KICK-GATED-CHECKS-1: when GitHub refuses
// the approval of a Copilot run with 403 and the fleet user credential is present, a finished pull request that avoids every denied path gets one update-branch
// pinned to its head (never for another refusal, a running agent, a denied path, an empty pull request, a dry run, approve=false or a missing credential; capped per run); EMPTY-FINISHED-DRAFT-1: a draft whose
// session finished 30 minutes ago and changed no file (files listing confirms) is commented and closed with the workflow token, never approved or kicked; dry sends no write; approve=false
// sends no approval; no credential or an unreadable list sends nothing and never throws; the per-run cap defers the rest; the workflow keeps GITHUB_TOKEN
// as its only secret, a timeout, the runner pin, pinned actions, a base checkout and no pull request text in a run line; lane-poke ignores copilot/** runs.
// Run: node --no-warnings scripts/copilot-pr-lifecycle.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { run, deniedPaths, workState, linkedIssues, isCopilotAuthor, DENY_PATHS } from "./copilot-pr-lifecycle.mjs";
import { CODE_DELIVERY_DOD } from "./code-delivery.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 500) : "")); } };

const REPO = "QNFO/qnfo-workers";
const user = (login) => ({ login });
const pr = (n, over) => Object.assign({
  number: n, user: user("Copilot"), draft: true, changed_files: 2, body: CODE_DELIVERY_DOD, node_id: "PR_" + n, requested_reviewers: [], assignees: [],
  head: { sha: "sha" + n, ref: "copilot/x-" + n, repo: { full_name: REPO } }
}, over || {});
const FINISHED = [{ event: "copilot_work_started" }, { event: "copilot_work_finished" }, { event: "review_requested" }];
const gatedRun = (id, sha, over) => Object.assign({ id, name: "wf" + id, status: "completed", conclusion: "action_required", event: "pull_request", head_sha: sha, head_repository: { full_name: REPO }, actor: user("Copilot") }, over || {});

function fakeGh(cfg) {
  const log = [];
  const pullReads = {}, eventReads = {};
  const fetchImpl = async (url, init) => {
    const u = new URL(url), method = init.method || "GET", path = decodeURIComponent(u.pathname);
    log.push({ method, path, search: u.search, body: init.body ? JSON.parse(init.body) : undefined, auth: init.headers.Authorization });
    const reply = (status, body) => ({ status, text: async () => (body === undefined ? "" : JSON.stringify(body)) });
    if (cfg.networkDown) throw new Error("getaddrinfo ENOTFOUND api.github.com");
    let m;
    if (method === "GET" && path === "/repos/" + REPO + "/pulls") return cfg.listStatus ? reply(cfg.listStatus, { message: "Bad credentials" }) : reply(200, (cfg.prs || []).map((p) => ({ number: p.number, user: p.user })));
    if ((m = /^\/repos\/QNFO\/qnfo-workers\/pulls\/(\d+)$/.exec(path)) && method === "GET") {
      const p = (cfg.prs || []).find((x) => x.number === Number(m[1]));
      pullReads[m[1]] = (pullReads[m[1]] || 0) + 1;
      const head = cfg.freshHead && cfg.freshHead[m[1]];
      return p ? reply(200, head && pullReads[m[1]] > 1 ? Object.assign({}, p, { head: Object.assign({}, p.head, { sha: head }) }) : p) : reply(404, { message: "Not Found" });
    }
    if ((m = /^\/repos\/[^/]+\/[^/]+\/pulls\/(\d+)\/requested_reviewers$/.exec(path)) && method === "DELETE") return reply(cfg.reviewerDeleteStatus || 200, {});
    if ((m = /^\/repos\/[^/]+\/[^/]+\/issues\/(\d+)\/assignees$/.exec(path)) && method === "DELETE") return reply(200, {});
    if ((m = /^\/repos\/[^/]+\/[^/]+\/issues\/(\d+)\/events$/.exec(path))) {
      eventReads[m[1]] = (eventReads[m[1]] || 0) + 1;
      return reply(200, eventReads[m[1]] > 1 && cfg.resumedEvents ? cfg.resumedEvents : (cfg.events || {})[m[1]] || []);
    }
    if ((m = /^\/repos\/[^/]+\/[^/]+\/issues\/(\d+)\/comments$/.exec(path))) {
      if (method === "POST") {
        if (cfg.commentStatus) return reply(cfg.commentStatus, { message: "Comment write refused" });
        (cfg.comments = cfg.comments || {})[m[1]] = ((cfg.comments || {})[m[1]] || []).concat([{ body: JSON.parse(init.body).body }]); return reply(201, {});
      }
      return reply(200, (cfg.comments || {})[m[1]] || []);
    }
    if ((m = /^\/repos\/[^/]+\/[^/]+\/issues\/(\d+)$/.exec(path)) && method === "GET") { const i = (cfg.issues || {})[m[1]]; return i ? reply(200, i) : reply(404, { message: "Not Found" }); }
    if (path === "/repos/" + REPO + "/actions/runs" && method === "GET") return reply(200, { workflow_runs: (cfg.runs || {})[u.searchParams.get("head_sha")] || [] });
    if ((m = /^\/repos\/[^/]+\/[^/]+\/actions\/runs\/(\d+)\/approve$/.exec(path)) && method === "POST") return (cfg.approveStatus && cfg.approveStatus[m[1]]) ? reply(cfg.approveStatus[m[1]], { message: "Resource not accessible by integration" }) : reply(201, {});
    if ((m = /^\/repos\/[^/]+\/[^/]+\/pulls\/(\d+)\/files$/.exec(path))) return reply(200, (cfg.files || {})[m[1]] || []);
    if (path === "/search/issues") {
      const q = u.searchParams.get("q") || "";
      if (cfg.searchStatus) return reply(cfg.searchStatus, { message: "Validation Failed" });
      if (/-repo:/.test(q)) return reply(200, { items: ((cfg.search || {}).emptyDraft || []).map((x) => ({ number: x.number, repository_url: "https://api.github.com/repos/" + x.repo })) });
      const kind = /review-requested:/.test(q) ? "reviewer" : /is:issue/.test(q) ? "issueAssignee" : "prAssignee";
      return reply(200, { items: ((cfg.search || {})[kind] || []).map((x) => ({ number: x.number, repository_url: "https://api.github.com/repos/" + x.repo })) });
    }
    if ((m = /^\/repos\/([^/]+\/[^/]+)\/pulls\/(\d+)$/.exec(path)) && m[1] !== REPO && method === "GET") { const p = (cfg.otherPrs || {})[m[1] + "#" + m[2]]; return p ? reply(200, p) : reply(404, { message: "Not Found" }); }
    if ((m = /^\/repos\/([^/]+\/[^/]+)\/pulls\/(\d+)$/.exec(path)) && method === "PATCH") {
      if (cfg.patchStatus) return reply(cfg.patchStatus, { message: "Pull request write refused" });
      const p = m[1] === REPO ? (cfg.prs || []).find((x) => x.number === Number(m[2])) : (cfg.otherPrs || {})[m[1] + "#" + m[2]];
      if (p) Object.assign(p, JSON.parse(init.body));
      return reply(200, {});
    }
    if ((m = /^\/repos\/QNFO\/qnfo-workers\/pulls\/(\d+)\/update-branch$/.exec(path)) && method === "PUT") return (cfg.kickStatus && cfg.kickStatus[m[1]]) ? reply(cfg.kickStatus[m[1]], { message: "There are no new commits on the base branch." }) : reply(202, { message: "Updating pull request branch." });
    return reply(404, { message: "unexpected " + method + " " + path });
  };
  return { fetchImpl, log, cfg };
}
const writes = (log) => log.filter((c) => c.method !== "GET");
const base = { token: "t", repo: REPO, mode: "live", approve: true, owners: ["rwnq8"], pauseMs: 0 };

// --- pure helpers
ok(isCopilotAuthor("Copilot") && isCopilotAuthor("copilot-swe-agent[bot]") && !isCopilotAuthor("rwnq8") && !isCopilotAuthor("copilot-impostor"), "only the Copilot cloud agent is a Copilot author");
const f = (name, extra) => Object.assign({ filename: name }, extra || {});
// Each sample is matched by exactly one rule, so removing any one rule fails this check.
const SAMPLES = [".github/CODEOWNERS", "scripts/x.mjs", "qnfo-x/wrangler.toml", "qnfo-x/package.json", "qnfo-x/yarn.lock", "qnfo-x/run.sh", "qnfo-x/Dockerfile.prod", "qnfo-x/config.yaml"];
ok(DENY_PATHS.every((re) => re instanceof RegExp), "the deny list is regular expressions only");
ok(SAMPLES.every((p) => DENY_PATHS.filter((re) => re.test(p)).length === 1) && new Set(SAMPLES.map((p) => DENY_PATHS.findIndex((re) => re.test(p)))).size === SAMPLES.length, "every deny rule is exercised by a path only it matches", SAMPLES.map((p) => [p, DENY_PATHS.filter((re) => re.test(p)).length]));
ok(deniedPaths(SAMPLES.map((p) => f(p)).concat([f("package-lock.json"), f(".npmrc"), f("qnfo-x/Dockerfile")])).length === SAMPLES.length + 3, "workflows, scripts, wrangler, package manifests, shell, Docker, yaml and npmrc are denied");
ok(deniedPaths([f("qnfo-x/worker.js"), f("qnfo-x/deployed-current.worker.js"), f("qnfo-x/x.test.mjs"), f("migrations/2026-10-30-a.sql"), f("docs/A.md"), f("CLAUDE.md"), f("qnfo-x/README.md")]).length === 0, "worker sources, mirrors, tests, migrations and docs stay approvable");
ok(deniedPaths([f("docs/new.md", { previous_filename: ".github/workflows/old.yml" })]).length === 1, "a rename away from a denied path is denied");
ok(workState([]) === "none" && workState([{ event: "copilot_work_started" }]) === "working" && workState(FINISHED) === "finished" && workState(FINISHED.concat([{ event: "copilot_work_started" }])) === "working", "work state is the newest copilot_work event");
ok(JSON.stringify(linkedIssues("Fixes #12\n\ncloses #5, Resolved: #9 and fixes #12; see #7 and https://x/y#44")) === "[12,5,9]", "linked issues come from closing keywords only, once each", linkedIssues("Fixes #12 closes #5 Resolved: #9 see #7"));

// --- a full sweep
{
  const g = fakeGh({
    prs: [
      pr(1, { requested_reviewers: [user("rwnq8"), user("someone")], assignees: [user("rwnq8"), user("Copilot")], body: "Fixes #100" }),
      pr(2, { requested_reviewers: [user("rwnq8")] }),
      pr(3),
      pr(4, { user: user("rwnq8"), requested_reviewers: [user("rwnq8")] }),
      pr(5, { changed_files: 0 }),
      pr(6, { head: { sha: "sha6", ref: "copilot/y", repo: { full_name: "someone/fork" } }, requested_reviewers: [user("rwnq8")] })
    ],
    events: { 1: FINISHED, 2: [{ event: "copilot_work_started" }], 3: FINISHED, 5: FINISHED, 6: FINISHED },
    issues: { 100: { number: 100, assignees: [user("rwnq8")] } },
    runs: { sha1: [gatedRun(11, "sha1"), gatedRun(12, "sha1"), gatedRun(13, "sha1", { conclusion: "success" }), gatedRun(14, "sha1", { event: "workflow_run" }), gatedRun(15, "sha1", { head_repository: { full_name: "someone/fork" } }), gatedRun(16, "sha1", { actor: user("rwnq8") })], sha3: [gatedRun(31, "sha3")], sha5: [] },
    files: { 1: [f("qnfo-x/worker.js"), f("qnfo-x/x.test.mjs"), f("migrations/2026-10-30-a.sql")], 3: [f("qnfo-x/worker.js"), f(".github/agents/evil.agent.md")] }
  });
  const s = await run(base, { fetchImpl: g.fetchImpl, sleep: async () => {} });
  const w = writes(g.log);
  ok(s.copilot_prs === 5 && s.considered === 5, "five of the six open pull requests are Copilot's (a person's is not)", [s.copilot_prs, s.considered]);
  ok(JSON.stringify(s.reviewers_removed.map((r) => r.pr)) === "[1,2]", "the owner is removed as reviewer from the pull requests that have it (not the fork, not the person's)", s.reviewers_removed);
  ok(!w.some((c) => c.path.includes("/pulls/4/")) && !w.some((c) => c.path.includes("/issues/4/")), "a pull request written by a person is never touched");
  ok(!w.some((c) => c.path.includes("/pulls/6/") || c.path.includes("/issues/6/")), "a fork head is never touched");
  const del1 = w.find((c) => c.method === "DELETE" && c.path.endsWith("/pulls/1/requested_reviewers"));
  ok(del1 && JSON.stringify(del1.body) === '{"reviewers":["rwnq8"]}', "only the owner login is sent for removal", del1);
  const as1 = w.find((c) => c.method === "DELETE" && c.path.endsWith("/issues/1/assignees"));
  ok(as1 && JSON.stringify(as1.body) === '{"assignees":["rwnq8"]}', "the owner is removed as assignee and Copilot stays", as1);
  ok(s.issue_assignees_removed.length === 1 && s.issue_assignees_removed[0].issue === 100, "the owner is removed from the issue the pull request fixes", s.issue_assignees_removed);
  ok(s.skipped["agent-working"] === 1, "a session still running is skipped for approval", s.skipped);
  ok(s.approved.length === 2 && s.approved.every((a) => a.pr === 1) && s.approved.map((a) => a.run).join() === "11,12", "only the finished, clean pull request's own gated pull_request runs are approved", s.approved);
  ok(!w.some((c) => /actions\/runs\/(13|14|15|16|31)\/approve/.test(c.path)), "a green run, another event, a fork run, a person's run and a denied pull request are never approved");
  ok(s.approval_withheld.length === 1 && s.approval_withheld[0].pr === 3 && s.approval_withheld[0].paths.join() === ".github/agents/evil.agent.md", "a pull request that changes an agent profile or workflow is withheld with the path named", s.approval_withheld);
  ok((g.cfg.comments[3] || []).length === 1 && /approval withheld/i.test(g.cfg.comments[3][0].body) && g.cfg.comments[3][0].body.includes(".github/agents/evil.agent.md"), "the withheld pull request gets one comment naming the file");
  ok(s.status === "ok" && s.errors.length === 0, "a clean sweep is ok", s);
  ok(g.log.every((c) => c.auth === "Bearer t"), "every call carries the one credential");
  // second pass over the same state: the comment is not repeated
  const g2 = fakeGh(Object.assign({}, g.cfg));
  const s2 = await run(base, { fetchImpl: g2.fetchImpl, sleep: async () => {} });
  ok((g2.cfg.comments[3] || []).length === 1 && s2.approval_withheld.length === 1, "the withheld comment is written once per head commit", g2.cfg.comments);
}

// --- one pull request by number, dry mode, approve off, cap
{
  const cfg = { prs: [pr(1, { requested_reviewers: [user("rwnq8")], assignees: [user("rwnq8")], body: "Fixes #100\n\n" + CODE_DELIVERY_DOD }), pr(2, { requested_reviewers: [user("rwnq8")] })], events: { 1: FINISHED, 2: FINISHED }, issues: { 100: { number: 100, assignees: [user("rwnq8")] } }, runs: { sha1: [gatedRun(11, "sha1")], sha2: [gatedRun(21, "sha2")] }, files: { 1: [f("qnfo-x/worker.js")], 2: [f("qnfo-y/worker.js")] } };
  const g = fakeGh(cfg);
  const s = await run(Object.assign({}, base, { pr: 2 }), { fetchImpl: g.fetchImpl, sleep: async () => {} });
  ok(s.considered === 1 && s.approved.length === 1 && s.approved[0].pr === 2, "a target pull request limits the sweep to it", s);
  const gd = fakeGh(cfg);
  const sd = await run(Object.assign({}, base, { mode: "dry" }), { fetchImpl: gd.fetchImpl, sleep: async () => {} });
  ok(writes(gd.log).length === 0 && sd.mode === "dry" && sd.reviewers_removed.length === 2 && sd.approved.length === 2, "dry mode reports what it would do and sends no write", writes(gd.log));
  const gn = fakeGh(cfg);
  const sn = await run(Object.assign({}, base, { approve: false }), { fetchImpl: gn.fetchImpl, sleep: async () => {} });
  ok(!writes(gn.log).some((c) => c.path.endsWith("/approve")) && sn.reviewers_removed.length === 2 && sn.approve === false, "approve off still clears the owner and approves nothing");
  const gc = fakeGh(cfg);
  const sc = await run(Object.assign({}, base, { max: 1 }), { fetchImpl: gc.fetchImpl, sleep: async () => {} });
  ok(sc.considered === 1 && sc.skipped["over-cap"] === 1, "the per-run cap defers the rest", sc);
}

// --- refusals and failures never throw
{
  const g = fakeGh({ prs: [pr(1, { requested_reviewers: [user("rwnq8")] }), pr(2)], events: { 1: FINISHED, 2: FINISHED }, runs: { sha1: [gatedRun(11, "sha1"), gatedRun(12, "sha1")], sha2: [gatedRun(21, "sha2")] }, files: { 1: [f("qnfo-x/worker.js")], 2: [f("qnfo-y/worker.js")] }, approveStatus: { 11: 403 } });
  const s = await run(base, { fetchImpl: g.fetchImpl, sleep: async () => {} });
  ok(s.status === "partial" && s.errors.length === 1 && s.errors[0].http === 403 && /not accessible/.test(s.errors[0].message), "a refused approval is recorded as GitHub said it", s.errors);
  ok(!writes(g.log).some((c) => c.path.endsWith("/runs/12/approve")), "a refused approval stops that pull request's other runs");
  ok(s.approved.length === 1 && s.approved[0].run === 21, "the next pull request is still approved", s.approved);
  const nc = await run(Object.assign({}, base, { token: "" }), { fetchImpl: async () => { throw new Error("must not be called"); } });
  ok(nc.status === "no-credential", "no credential sends nothing");
  const lf = fakeGh({ listStatus: 401 });
  const sl = await run(base, { fetchImpl: lf.fetchImpl });
  ok(sl.status === "list-failed" && writes(lf.log).length === 0, "an unreadable list sends no write", sl);
  const nd = fakeGh({ networkDown: true });
  const sn2 = await run(base, { fetchImpl: nd.fetchImpl });
  ok(sn2.status === "list-failed" && /network/.test(sn2.errors[0].message), "a network failure is a status and not a throw", sn2);
  const br = await run(Object.assign({}, base, { repo: "not a repo" }), { fetchImpl: async () => { throw new Error("must not be called"); } });
  ok(br.status === "bad-repo", "a malformed repository name sends nothing");
}

// --- the organization pass (ORG_TOKEN, the fleet user credential)
{
  const search = {
    reviewer: [{ repo: "QNFO/qnfo-fleet-issues", number: 106 }, { repo: "QNFO/qnfo-ops", number: 9 }],
    prAssignee: [{ repo: "QNFO/qnfo-fleet-issues", number: 106 }],
    issueAssignee: [{ repo: "QNFO/qnfo-setup-bootstrap", number: 2 }, { repo: "QNFO/qnfo-workers", number: 55 }]
  };
  const g = fakeGh({ prs: [], search });
  const s = await run(Object.assign({}, base, { orgToken: "ORG" }), { fetchImpl: g.fetchImpl, sleep: async () => {} });
  const w = writes(g.log);
  ok(s.status === "ok" && s.org_removed.length === 5, "the owner is removed from every matching pull request and issue in the organization", s.org_removed);
  ok(w.length === 5 && w.every((c) => c.auth === "Bearer ORG"), "the organization removals use the fleet user credential and nothing else writes", w.map((c) => c.auth));
  ok(w.filter((c) => c.path.endsWith("/requested_reviewers")).every((c) => JSON.stringify(c.body) === '{"reviewers":["rwnq8"]}') && w.filter((c) => c.path.endsWith("/assignees")).every((c) => JSON.stringify(c.body) === '{"assignees":["rwnq8"]}'), "a review request and an assignment are removed with the owner login only", w);
  ok(w.some((c) => c.path === "/repos/QNFO/qnfo-fleet-issues/pulls/106/requested_reviewers") && w.some((c) => c.path === "/repos/QNFO/qnfo-setup-bootstrap/issues/2/assignees"), "other repositories are reached by their own path");
  const searches = g.log.filter((c) => c.path === "/search/issues");
  ok(searches.length === 4 && searches.every((c) => c.auth === "Bearer ORG"), "four searches (three removal queries and the empty-draft query), all with the fleet user credential");
  const g2 = fakeGh({ prs: [], search });
  const s2 = await run(Object.assign({}, base), { fetchImpl: g2.fetchImpl, sleep: async () => {} });
  ok(!g2.log.some((c) => c.path === "/search/issues") && s2.org_removed === undefined, "without ORG_TOKEN there is no organization pass");
  const g3 = fakeGh({ prs: [], search });
  const s3 = await run(Object.assign({}, base, { orgToken: "ORG", mode: "dry" }), { fetchImpl: g3.fetchImpl, sleep: async () => {} });
  ok(writes(g3.log).length === 0 && s3.org_removed.length === 5 && s3.org_removed.every((x) => x.dry), "dry mode lists the organization removals and sends no write");
  const g4 = fakeGh({ prs: [], search });
  const s4 = await run(Object.assign({}, base, { orgToken: "ORG", orgMax: 2 }), { fetchImpl: g4.fetchImpl, sleep: async () => {} });
  ok(s4.org_removed.length === 2 && s4.skipped["org-over-cap"] === 3, "the organization cap defers the rest", [s4.org_removed.length, s4.skipped]);
  const g5 = fakeGh({ prs: [], search, searchStatus: 422 });
  const s5 = await run(Object.assign({}, base, { orgToken: "ORG" }), { fetchImpl: g5.fetchImpl, sleep: async () => {} });
  ok(s5.status === "partial" && s5.errors.length === 4 && writes(g5.log).length === 0, "a failed search is recorded per query and removes nothing", s5.errors);
  const g6 = fakeGh({ listStatus: 401, search });
  const s6 = await run(Object.assign({}, base, { orgToken: "ORG" }), { fetchImpl: g6.fetchImpl, sleep: async () => {} });
  ok(s6.status === "list-failed" && s6.org_removed.length === 5, "an unreadable repository list does not stop the organization pass", [s6.status, s6.org_removed]);
  const g7 = fakeGh({ prs: [], search: { reviewer: [{ repo: "QNFO/x", number: 1 }] } });
  const s7 = await run(Object.assign({}, base, { orgToken: "ORG", owners: ["rwnq8", "bad login; rm -rf"] }), { fetchImpl: g7.fetchImpl, sleep: async () => {} });
  ok(g7.log.filter((c) => c.path === "/search/issues").length === 4, "an owner login that is not a plain name is never put in a query", s7.org_removed);
}

// --- empty Copilot drafts in other repositories
{
  const NOW = Date.parse("2026-10-30T10:00:00Z");
  const done = (min, extra) => [{ event: "copilot_work_started", created_at: "2026-10-30T08:00:00Z" }, { event: "copilot_work_finished", created_at: new Date(NOW - min * 60000).toISOString() }].concat(extra || []);
  const draft = (files) => ({ draft: true, changed_files: files, body: CODE_DELIVERY_DOD });
  const cfg = () => ({
    prs: [],
    search: { emptyDraft: [{ repo: "QNFO/qnfo-fleet-issues", number: 107 }, { repo: "QNFO/qnfo-fleet-issues", number: 108 }, { repo: "QNFO/qnfo-fleet-issues", number: 109 }, { repo: "QNFO/qnfo-fleet-issues", number: 110 }, { repo: "QNFO/qnfo-setup-bootstrap", number: 4 }] },
    otherPrs: { "QNFO/qnfo-fleet-issues#107": draft(0), "QNFO/qnfo-fleet-issues#108": draft(0), "QNFO/qnfo-fleet-issues#109": draft(2), "QNFO/qnfo-fleet-issues#110": draft(0), "QNFO/qnfo-setup-bootstrap#4": draft(0) },
    events: { 107: done(45), 108: done(5), 109: done(90), 110: [{ event: "copilot_work_started", created_at: "2026-10-30T09:50:00Z" }], 4: done(120) },
    files: { 109: [f("qnfo-x/worker.js")] }
  });
  const g = fakeGh(cfg());
  const s = await run(Object.assign({}, base, { orgToken: "ORG" }), { fetchImpl: g.fetchImpl, sleep: async () => {}, now: NOW });
  const closed = s.empty_drafts_closed.map((x) => x.repo + "#" + x.number).sort().join();
  ok(closed === "QNFO/qnfo-fleet-issues#107,QNFO/qnfo-fleet-issues#108,QNFO/qnfo-setup-bootstrap#4", "finished no-code PRs close without a 30-minute delay", closed);
  ok(s.skipped["draft-has-changes"] === 1 && s.skipped["empty-draft-session-working"] === 1, "an implementation diff and a running session are left alone", s.skipped);
  const patches = g.log.filter((c) => c.method === "PATCH");
  ok(patches.length === 3 && patches.every((c) => JSON.stringify(c.body) === '{"state":"closed"}' && c.auth === "Bearer ORG"), "the close is a state change with the fleet user credential", patches);
  const cm = g.log.filter((c) => c.method === "POST" && c.path.endsWith("/comments"));
  ok(cm.length === 3 && /CODE-CHANGE-REQUIRED-1/.test(cm[0].body.body) && /issue stays open/.test(cm[0].body.body), "each close explains itself and says the issue stays open");
  const draftSearch = g.log.filter((c) => c.path === "/search/issues");
  const dq = decodeURIComponent((draftSearch.find((c) => /-repo:/.test(decodeURIComponent(c.search))) || { search: "" }).search);
  ok(/is:pr is:open author:app\/copilot-swe-agent -repo:QNFO\/qnfo-workers/.test(dq), "the no-code search includes ready PRs and excludes this repository's separate pass", dq);
  ok(draftSearch.length === 4, "the draft search is the fourth organization query", draftSearch.length);
  const gd = fakeGh(cfg());
  const sd = await run(Object.assign({}, base, { orgToken: "ORG", mode: "dry" }), { fetchImpl: gd.fetchImpl, sleep: async () => {}, now: NOW });
  ok(writes(gd.log).length === 0 && sd.empty_drafts_closed.length === 3 && sd.empty_drafts_closed.every((x) => x.dry), "dry mode lists the empty drafts and sends no write");
  const gc = fakeGh(cfg());
  const sc = await run(Object.assign({}, base, { orgToken: "ORG", emptyMax: 1 }), { fetchImpl: gc.fetchImpl, sleep: async () => {}, now: NOW });
  ok(sc.empty_drafts_closed.length === 1 && sc.skipped["empty-over-cap"] >= 1, "the empty-draft cap defers the rest", sc.skipped);
  const gp = fakeGh(Object.assign(cfg(), { patchStatus: 403 }));
  const sp = await run(Object.assign({}, base, { orgToken: "ORG" }), { fetchImpl: gp.fetchImpl, sleep: async () => {}, now: NOW });
  ok(sp.status === "partial" && sp.empty_drafts_closed.length === 0 && sp.errors.some((e) => /close empty draft/.test(e.where) && e.http === 403), "a refused close is recorded and not counted", sp.errors);
  const g2 = fakeGh(cfg());
  await run(Object.assign({}, base), { fetchImpl: g2.fetchImpl, sleep: async () => {}, now: NOW });
  ok(writes(g2.log).length === 0, "without ORG_TOKEN no draft is closed");
}

// --- KICK-GATED-CHECKS-1: the REST approval of a Copilot run is refused (403), so a finished pull request's checks are started by one update-branch
{
  const gatedFor = (n) => ({ ["sha" + n]: [gatedRun(n * 10 + 1, "sha" + n), gatedRun(n * 10 + 2, "sha" + n)] });
  const refuse = { 11: 403, 12: 403, 21: 403, 22: 403 };
  const mk = (over) => fakeGh(Object.assign({
    prs: [pr(1), pr(2)], events: { 1: FINISHED, 2: FINISHED }, runs: Object.assign({}, gatedFor(1), gatedFor(2)),
    files: { 1: [f("migrations/a.test.mjs")], 2: [f("qnfo-x/worker.js")] }, approveStatus: refuse
  }, over || {}));
  const withOrg = Object.assign({}, base, { orgToken: "ORG" });
  const puts = (log) => log.filter((c) => c.method === "PUT");
  const approves = (log) => log.filter((c) => c.method === "POST" && c.path.endsWith("/approve"));

  const g = mk();
  const s = await run(withOrg, { fetchImpl: g.fetchImpl, sleep: async () => {} });
  ok(s.kicked.length === 2 && s.kicked[0].pr === 1 && s.kicked[1].pr === 2 && s.errors.length === 0 && s.status === "ok", "a refused approval is followed by one branch update per finished pull request, and the sweep is ok", s);
  ok(puts(g.log).length === 2 && puts(g.log).every((c) => /^\/repos\/QNFO\/qnfo-workers\/pulls\/\d+\/update-branch$/.test(c.path)), "the update goes to the pull request's update-branch route", puts(g.log).map((c) => c.path));
  ok(puts(g.log)[0].body.expected_head_sha === "sha1" && puts(g.log)[1].body.expected_head_sha === "sha2" && Object.keys(puts(g.log)[0].body).join() === "expected_head_sha", "the update is pinned to the head that was judged and carries nothing else", puts(g.log).map((c) => c.body));
  ok(puts(g.log).every((c) => c.auth === "Bearer ORG") && approves(g.log).every((c) => c.auth === "Bearer t"), "the update uses the fleet user credential and the approval keeps the workflow token");
  ok(approves(g.log).length === 2, "a refused approval stops that pull request's other runs: one approval attempt per pull request", approves(g.log).map((c) => c.path));
  ok(s.skipped["kick-over-cap"] === undefined && typeof s.calls_kick === "number" && s.calls_kick === 2, "the calls of the kick are counted", s.calls_kick);

  // The next sweep: the new head's runs belong to the owner, so nothing is gated and nothing is sent again.
  const again = fakeGh({ prs: [pr(1, { head: { sha: "sha1b", ref: "copilot/x-1", repo: { full_name: REPO } } })], events: { 1: FINISHED }, runs: { sha1b: [gatedRun(13, "sha1b", { actor: user("rwnq8") })] }, files: { 1: [f("migrations/a.test.mjs")] } });
  const sa = await run(withOrg, { fetchImpl: again.fetchImpl, sleep: async () => {} });
  ok(writes(again.log).length === 0 && sa.kicked.length === 0, "a head whose runs are the owner's is neither approved nor kicked again", writes(again.log));

  // No credential for the update: the refusal is an error, as before.
  const gn = mk();
  const sn = await run(base, { fetchImpl: gn.fetchImpl, sleep: async () => {} });
  ok(puts(gn.log).length === 0 && sn.kicked.length === 0 && sn.status === "partial" && sn.errors.length === 2 && sn.errors.every((e) => e.http === 403 && /approve run/.test(e.where)), "without the fleet user credential the refusal stays an error and nothing is updated", sn.errors);

  // Only a 403 is an eligibility answer; a 500 or a network error is retried by the next sweep and never kicks.
  for (const status of [500, 404, 422, 429]) {
    const gs = mk({ approveStatus: { 11: status, 21: status } });
    const ss = await run(withOrg, { fetchImpl: gs.fetchImpl, sleep: async () => {} });
    ok(puts(gs.log).length === 0 && ss.errors.length === 2 && ss.errors.every((e) => e.http === status), "an approval refused with " + status + " is an error and starts nothing", ss.errors);
  }

  // The same policy as an approval: a denied path, a running agent and a dry run never kick.
  const gd = mk({ files: { 1: [f(".github/workflows/x.yml")], 2: [f("qnfo-x/worker.js"), f("scripts/y.mjs")] } });
  const sd = await run(withOrg, { fetchImpl: gd.fetchImpl, sleep: async () => {} });
  ok(puts(gd.log).length === 0 && approves(gd.log).length === 0 && sd.approval_withheld.length === 2 && sd.kicked.length === 0, "a diff that touches a denied path is neither approved nor kicked", sd.approval_withheld);
  const gw = mk({ events: { 1: [{ event: "copilot_work_started" }], 2: [{ event: "copilot_work_started" }] } });
  const sw = await run(withOrg, { fetchImpl: gw.fetchImpl, sleep: async () => {} });
  ok(puts(gw.log).length === 0 && approves(gw.log).length === 0 && sw.skipped["agent-working"] === 2, "a session that is still running is never kicked", sw.skipped);
  const gy = mk();
  const sy = await run(Object.assign({}, withOrg, { mode: "dry" }), { fetchImpl: gy.fetchImpl, sleep: async () => {} });
  ok(writes(gy.log).length === 0 && sy.kicked.length === 0, "a dry run sends no update", writes(gy.log));
  const go = mk();
  const so = await run(Object.assign({}, withOrg, { approve: false }), { fetchImpl: go.fetchImpl, sleep: async () => {} });
  ok(puts(go.log).length === 0 && approves(go.log).length === 0 && so.kicked.length === 0, "approve off stops the update as well");

  // An approval that works needs no update.
  const gk = mk({ approveStatus: {} });
  const sk = await run(withOrg, { fetchImpl: gk.fetchImpl, sleep: async () => {} });
  ok(puts(gk.log).length === 0 && sk.approved.length === 4 && sk.kicked.length === 0, "an approval that works is never followed by an update", sk);

  // The per-run cap, and the answers of the update call.
  const gc = mk();
  const sc = await run(Object.assign({}, withOrg, { kickMax: 1 }), { fetchImpl: gc.fetchImpl, sleep: async () => {} });
  ok(sc.kicked.length === 1 && puts(gc.log).length === 1 && sc.skipped["kick-over-cap"] === 1, "the per-run cap defers the other updates", sc);
  const gz = mk({ kickStatus: { 1: 422, 2: 422 } });
  const sz = await run(withOrg, { fetchImpl: gz.fetchImpl, sleep: async () => {} });
  ok(sz.kicked.length === 0 && sz.errors.length === 0 && sz.skipped["kick-refused-422"] === 2 && sz.status === "ok", "a 422 (a conflict, or nothing new on main) is skipped and not an error", sz);
  const ge = mk({ kickStatus: { 1: 403, 2: 500 } });
  const se = await run(withOrg, { fetchImpl: ge.fetchImpl, sleep: async () => {} });
  ok(se.kicked.length === 0 && se.status === "partial" && se.errors.length === 2 && se.errors.every((e) => /update branch on \d+ after approve run \d+ was refused/.test(e.where)) && se.errors[0].http === 403 && se.errors[1].http === 500, "a refused update is recorded as GitHub said it", se.errors);

  // A finished session that changed nothing has no check to run: it is neither approved nor kicked, and the pull request that did change files still is.
  const gm = mk({ files: { 1: [], 2: [f("qnfo-x/worker.js")] } });
  const sm = await run(withOrg, { fetchImpl: gm.fetchImpl, sleep: async () => {} });
  ok(sm.empty_drafts_closed.length === 1 && sm.kicked.length === 1 && sm.kicked[0].pr === 2 && puts(gm.log).length === 1 && approves(gm.log).length === 1 && !approves(gm.log).some((c) => /\/runs\/1[12]\/approve$/.test(c.path)), "an empty pull request is closed, neither approved nor kicked", { skipped: sm.skipped, kicked: sm.kicked, approves: approves(gm.log).map((c) => c.path) });
}

// --- EMPTY-FINISHED-DRAFT-1: a draft whose session finished 30 minutes ago and changed no file is closed in this repository too
{
  const NOW = Date.parse("2026-11-01T12:00:00Z");
  const sessionFinished = (minAgo) => [{ event: "copilot_work_started", created_at: "2026-11-01T10:00:00Z" }, { event: "copilot_work_finished", created_at: new Date(NOW - minAgo * 60000).toISOString() }, { event: "review_requested" }];
  const mk = (over) => fakeGh(Object.assign({
    prs: [pr(1, { changed_files: 0 })], events: { 1: sessionFinished(45) }, files: { 1: [] }, runs: { sha1: [gatedRun(11, "sha1")] }, approveStatus: { 11: 403 }
  }, over || {}));
  const go = (g, extra) => run(Object.assign({}, base, extra || {}), { fetchImpl: g.fetchImpl, sleep: async () => {}, now: NOW });
  const patches = (log) => log.filter((c) => c.method === "PATCH");
  const posts = (log) => log.filter((c) => c.method === "POST" && c.path.endsWith("/comments"));

  const g = mk();
  const s = await go(g, { orgToken: "ORG" });
  ok(s.empty_drafts_closed.length === 1 && s.empty_drafts_closed[0].repo === REPO && s.empty_drafts_closed[0].number === 1 && /^2026-11-01T11:15:00/.test(s.empty_drafts_closed[0].finished_at) && s.status === "ok", "an empty draft whose session finished 45 minutes ago is closed", s);
  ok(posts(g.log).length === 1 && /EMPTY-FINISHED-DRAFT-1/.test(posts(g.log)[0].body.body) && patches(g.log).length === 1 && patches(g.log)[0].path === "/repos/" + REPO + "/pulls/1" && patches(g.log)[0].body.state === "closed", "it is explained in one comment and closed", g.log.filter((c) => c.method !== "GET").map((c) => c.method + " " + c.path));
  ok(!g.log.some((c) => /\/approve$/.test(c.path) || c.method === "PUT") && s.kicked.length === 0, "a closed empty draft is neither approved nor kicked");
  ok(g.log.filter((c) => c.path === "/repos/" + REPO + "/pulls/1/files").length === 1 && s.skipped["no-changed-files"] === undefined, "it is listed once and the sweep moves on: no second pass through the approval path", { skipped: s.skipped });
  ok(g.log.filter((c) => c.method !== "GET").every((c) => c.auth === "Bearer t"), "it is closed with the workflow token, not the fleet user credential");

  const gn = mk();
  const sn = await go(gn);
  ok(sn.empty_drafts_closed.length === 1 && patches(gn.log).length === 1, "it needs no fleet user credential");

  const gr = mk({ events: { 1: sessionFinished(10) } });
  const sr = await go(gr);
  ok(sr.empty_drafts_closed.length === 1 && !gr.log.some((c) => /\/approve$/.test(c.path)), "a newly finished no-code PR closes immediately", sr.skipped);
  const gl = mk({ files: { 1: [f("docs/A.md")] } });
  const sl = await go(gl, { orgToken: "ORG" });
  ok(sl.empty_drafts_closed.length === 1, "documentation-only changes do not satisfy code delivery", sl.empty_drafts_closed);
  const gh = mk({ prs: [pr(1, { changed_files: 0, draft: false })] });
  const sh = await go(gh);
  ok(sh.empty_drafts_closed.length === 1, "a ready-for-review no-code PR is closed too");
  const gf = mk({ prs: [pr(1, { changed_files: 2 })], files: { 1: [f("docs/A.md")] } });
  const sf = await go(gf);
  ok(sf.empty_drafts_closed.length === 1, "changed_files alone is not implementation evidence");
  const gw = mk({ events: { 1: [{ event: "copilot_work_started", created_at: "2026-11-01T11:00:00Z" }] } });
  const sw = await go(gw);
  ok(patches(gw.log).length === 0 && sw.skipped["agent-working"] === 1, "a session that is still running is never closed");
  const resumed = mk({ resumedEvents: sessionFinished(45).concat([{ event: "copilot_work_started" }]) });
  const resumedResult = await go(resumed);
  ok(patches(resumed.log).length === 0 && resumedResult.skipped["agent-resumed"] === 1, "a session that resumes during cleanup is not closed");
  const changedHead = mk({ freshHead: { 1: "new-head" } });
  const changedResult = await go(changedHead);
  ok(patches(changedHead.log).length === 0 && changedResult.skipped["head-changed"] === 1, "a concurrent push is not closed using the old diff");
  const commentRefused = mk({ commentStatus: 403 });
  const commentResult = await go(commentRefused);
  ok(patches(commentRefused.log).length === 0 && commentResult.errors.some((e) => e.http === 403), "a failed explanation is surfaced and prevents silent closure");
  const gu = mk({ events: { 1: [{ event: "copilot_work_started" }, { event: "copilot_work_finished" }] } });
  const su = await go(gu);
  ok(su.empty_drafts_closed.length === 1, "a finished event proves completion without needing an idle timestamp");
  const gd = mk();
  const sd = await go(gd, { mode: "dry" });
  ok(writes(gd.log).length === 0 && sd.empty_drafts_closed.length === 1 && sd.empty_drafts_closed[0].dry === true, "a dry run names the draft and sends no write", sd.empty_drafts_closed);
  const ga = mk();
  const sa = await go(ga, { approve: false });
  ok(sa.empty_drafts_closed.length === 1 && patches(ga.log).length === 1, "approve off does not keep an empty finished draft open");
  const gp = mk({ patchStatus: 403 });
  const sp = await go(gp);
  ok(sp.status === "partial" && sp.empty_drafts_closed.length === 0 && sp.errors.some((e) => /close empty draft/.test(e.where) && e.http === 403), "a refused close is recorded and not counted", sp.errors);
  const g2 = mk({ prs: [pr(1, { changed_files: 0 }), pr(2, { changed_files: 0 })], events: { 1: sessionFinished(45), 2: sessionFinished(60) }, files: { 1: [], 2: [] }, runs: {} });
  const s2 = await go(g2, { emptyMax: 1 });
  ok(s2.empty_drafts_closed.length === 1 && s2.skipped["empty-over-cap"] === 1, "the per-run cap defers the other empty draft", s2);
  // The organization pass fills the same list: this repository's entry is kept and the other repository's is added.
  const cfgOrg = { prs: [pr(1, { changed_files: 0 })], events: { 1: sessionFinished(45) }, files: { 1: [] }, runs: {}, search: { emptyDraft: [{ repo: "QNFO/other", number: 7 }] }, otherPrs: { "QNFO/other#7": { draft: true, changed_files: 0 } } };
  const go2 = fakeGh(cfgOrg);
  const so = await run(Object.assign({}, base, { orgToken: "ORG" }), { fetchImpl: go2.fetchImpl, sleep: async () => {}, now: NOW });
  ok(so.empty_drafts_closed.some((x) => x.repo === REPO && x.number === 1), "the organization pass does not discard this repository's closed drafts", so.empty_drafts_closed);
}

// --- the workflow and the lane poke
const wf = readFileSync(join(root, ".github/workflows/copilot-pr-lifecycle.yml"), "utf8");
const lane = readFileSync(join(root, ".github/workflows/lane-poke.yml"), "utf8");
ok(/timeout-minutes:\s*10/.test(wf) && /runs-on:\s*ubuntu-24\.04/.test(wf) && /^permissions:/m.test(wf), "the workflow has a timeout, the runner pin and a top-level permissions block");
ok(/pull-requests:\s*write/.test(wf) && /issues:\s*write/.test(wf) && /actions:\s*write/.test(wf) && /contents:\s*read/.test(wf) && !/contents:\s*write/.test(wf), "the token may write pull requests, issues and approvals and only read contents");
ok((wf.match(/secrets\.[A-Za-z0-9_]+/g) || []).sort().join() === "secrets.GITHUB_TOKEN,secrets.QNFO_GH_PAT", "the workflow reads GITHUB_TOKEN and the fleet user credential and nothing else", wf.match(/secrets\.[A-Za-z0-9_]+/g));
ok(/ORG_TOKEN: \$\{\{ github\.event_name != 'pull_request_target' && secrets\.QNFO_GH_PAT \|\| '' \}\}/.test(wf), "the fleet user credential is handed over only off a pull_request_target run");
ok((wf.match(/uses:\s*\S+/g) || []).every((u) => /@[0-9a-f]{40}$/.test(u)), "every action is pinned to a commit", wf.match(/uses:\s*\S+/g));
ok(/pull_request_target:/.test(wf) && /github\.event\.pull_request\.user\.login == 'Copilot'/.test(wf), "the pull_request_target job runs only for a pull request written by Copilot");
ok(!/ref:\s*\$\{\{/.test(wf) && !/head\.(sha|ref)/.test(wf.replace(/^#.*$/gm, "")), "the job never checks out or names the pull request head");
const runLines = wf.split("\n").filter((l) => /^\s*run:/.test(l));
ok(runLines.length === 1 && !/\$\{\{/.test(runLines[0]), "the one run line carries no expression", runLines);
ok(/workflows:\s*\["remediation-consumer"\]/.test(wf) && /push:\s*\n\s*branches:\s*\[main\]/.test(wf) && /workflow_dispatch:/.test(wf), "the sweep also runs after remediation-consumer, on a push to main and by dispatch");
ok(/branches-ignore:\s*\n\s*-\s*"copilot\/\*\*"/.test(lane) && lane.indexOf("branches-ignore") < lane.indexOf("workflows:\n      - deploy-gate"), "lane-poke ignores check runs of copilot/** branches");

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
