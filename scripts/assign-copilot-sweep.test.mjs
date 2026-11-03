// ASSIGN-COPILOT-ISSUES-1 offline suite (scripts/assign-copilot-sweep.mjs, workflow assign-copilot-on-issue). No network: a fake GitHub and a fake
// work-claim service.
// Proves: a trusted new issue is assigned to copilot-swe-agent[bot] with the Quniverse custom agent, the repository's own default branch and the
// static instructions; pull requests, closed issues, issues Copilot already has or ever had, archived repositories and issues written by strangers
// are left alone; a human the assignment call added is removed again and one that was already there is not; the oldest issue goes first, the issue
// that fired the run goes before all of them, and the per-run cap defers the rest; the open Copilot pull requests bound the work (back-pressure);
// an issue the work-claim service shows as claimed or in flight is left to that doer; a stalled assignment is re-driven once, only after the claim
// fallback is on main, and never while a live pull request exists; a 401 stops the run, a refusal for one repository skips only that repository, and
// nothing throws; dry sends no write; no credential sends nothing; the kill switch works; the organization agent is created, updated or left alone
// by blob sha, never from an invalid source; the workflow keeps QNFO_GH_PAT (not GITHUB_TOKEN), a timeout, pinned actions and no input in a run line.
// Run: node --no-warnings scripts/assign-copilot-sweep.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { run, normalize, trusted, isCopilot, mirrorId, parseRefs, agentProblems, sinceIso, makeApi, syncOrgAgent, INSTRUCTIONS, AGENT, COPILOT_BOT, AGENT_SOURCE, AGENT_TARGET, LOCKS_URL, DEFAULTS, TARGET_OVERRIDES, startFailures, creditsBreaker, START_FAILED_RE, CREDITS_RE, PRIORITY_LABEL } from "./assign-copilot-sweep.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 500) : "")); } };

const NOW = Date.parse("2026-10-30T09:00:00Z");
const hAgo = (h) => new Date(NOW - h * 3600000).toISOString().replace(/\.\d{3}Z$/, "Z");
const AGENT_TEXT = "---\nname: Quniverse\ndescription: Operates the fleet.\ntarget: github-copilot\n---\n\nBody.\n";
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
const item = (n, over) => Object.assign({
  number: n, state: "open", title: "issue " + n, repository_url: "https://api.github.com/repos/QNFO/qnfo-ops", html_url: "https://github.com/QNFO/qnfo-ops/issues/" + n,
  user: { login: "rwnq8" }, author_association: "OWNER", assignees: [], created_at: "2026-10-30T0" + (n % 9) + ":00:00Z"
}, over || {});
const hAgoIso = (h) => new Date(NOW - h * 3600000).toISOString();
const REFUSED_CREDITS = "The agent encountered an error and was unable to start working on this issue: You don't have sufficient GitHub AI Credits to start a session. Review your usage and budgets in your Copilot settings.";
const REFUSED_OTHER = "The agent encountered an error and was unable to start working on this issue: Please try again later, or contact support if the problem persists. (Request id: 67C7:70AE8)";
const withCopilot = (n, over) => item(n, Object.assign({ assignees: [{ login: "Copilot" }], created_at: hAgo(20 + (n % 9)) }, over || {}));

function fakeGh(cfg) {
  const log = [];
  const repos = Object.assign({ "QNFO/qnfo-ops": { default_branch: "main", archived: false }, "QNFO/qnfo-skills": { default_branch: "master", archived: false }, "QNFO/qnfo-workers": { default_branch: "main", archived: false }, "QNFO/qnfo-fleet-issues": { default_branch: "main", archived: false } }, cfg.repos || {});
  const files = Object.assign({}, cfg.files || {});
  const refused = {}; // issue key -> "credits" | "other": Copilot's refusal comment appears after the assignment POST
  const fetchImpl = async (url, init) => {
    if (url === LOCKS_URL) { log.push({ method: "GET", path: "LOCKS" }); if (!cfg.locks) throw new Error("getaddrinfo ENOTFOUND qnfo-deploy-guard.q08.workers.dev"); return { status: 200, text: async () => JSON.stringify(cfg.locks) }; }
    const u = new URL(url), method = init.method || "GET", path = decodeURIComponent(u.pathname);
    log.push({ method, path, search: decodeURIComponent(u.search), body: init.body ? JSON.parse(init.body) : undefined, auth: init.headers.Authorization });
    const reply = (status, body) => ({ status, text: async () => (body === undefined ? "" : JSON.stringify(body)) });
    if (cfg.networkDown) throw new Error("getaddrinfo ENOTFOUND api.github.com");
    if (path === "/search/issues") {
      const q = u.searchParams.get("q") || "";
      if (/is:pr/.test(q)) { const items = cfg.copilotPrs || []; return reply(200, { total_count: cfg.openPrCount !== undefined ? cfg.openPrCount : items.length, items }); }
      if (/sufficient GitHub AI Credits/.test(q)) { const items = cfg.creditsIssues || []; return reply(200, { total_count: items.length, items }); }
      if (cfg.searchStatus) return reply(cfg.searchStatus, { message: "Validation Failed" });
      const list = /assignee:app\/copilot-swe-agent/.test(q) ? (cfg.stalled || []) : (cfg.issues || []);
      const page = Number(u.searchParams.get("page") || 1);
      return reply(200, { total_count: list.length, items: list.slice((page - 1) * 100, page * 100) });
    }
    let m = /^\/repos\/([^/]+\/[^/]+)\/actions\/workflows\/assign-copilot-on-issue\.yml\/runs$/.exec(path);
    if (m) return cfg.runsStatus ? reply(cfg.runsStatus, { message: "boom" }) : reply(200, { workflow_runs: cfg.runs || [] });
    m = /^\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)\/events$/.exec(path);
    if (m) return reply(200, (cfg.events || {})[m[1] + "#" + m[2]] || []);
    m = /^\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)\/comments$/.exec(path);
    if (m && method === "GET") {
      const key = m[1] + "#" + m[2], since = Date.parse(u.searchParams.get("since") || "") || 0;
      const extra = refused[key] ? [{ user: { login: "Copilot" }, created_at: hAgoIso(0), body: refused[key] === "credits" ? REFUSED_CREDITS : REFUSED_OTHER }] : [];
      return reply(200, ((cfg.comments || {})[key] || []).concat(extra).filter((c) => cfg.sinceIsUpdatedAt || Date.parse(c.created_at) >= since)); // GitHub's since filters on updated_at, so an old comment that was edited comes back
    }
    m = /^\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)\/timeline$/.exec(path);
    if (m) return cfg.timelineStatus ? reply(cfg.timelineStatus, { message: "boom" }) : reply(200, (cfg.timeline || {})[m[1] + "#" + m[2]] || []);
    m = /^\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)\/assignees$/.exec(path);
    if (m && method === "POST") {
      const key = m[1] + "#" + m[2];
      if (cfg.refuseOnAssign && cfg.refuseOnAssign[key]) refused[key] = cfg.refuseOnAssign[key];
      if (cfg.assignStatus && cfg.assignStatus[key]) return reply(cfg.assignStatus[key], { message: (cfg.assignMessage || {})[key] || "Forbidden" });
      if (cfg.assignRepoStatus && cfg.assignRepoStatus[m[1]]) return reply(cfg.assignRepoStatus[m[1]], { message: "Resource not accessible by personal access token" });
      const all = (cfg.issues || []).concat(cfg.stalled || [], Object.values(cfg.single || {}));
      const found = all.find((i) => m[1] === "QNFO/qnfo-ops" && i.number === Number(m[2]));
      const before = found ? found.assignees.filter((a) => !isCopilot(a.login)) : [];
      return reply(201, { assignees: before.concat([{ login: "Copilot" }], cfg.autoAdd || []) });
    }
    if (m && method === "DELETE") return cfg.deleteStatus ? reply(cfg.deleteStatus, { message: "nope" }) : reply(200, {});
    m = /^\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)$/.exec(path);
    if (m) {
      const f = (cfg.single || {})[m[1] + "#" + m[2]] || (cfg.issues || []).concat(cfg.stalled || []).find((i) => i.repository_url === "https://api.github.com/repos/" + m[1] && i.number === Number(m[2]));
      if (method === "PATCH" && f) {
        if (cfg.issuePatchStatus) return reply(cfg.issuePatchStatus, { message: "Issue body write refused" });
        Object.assign(f, JSON.parse(init.body));
      }
      return f ? reply(200, f) : reply(404, { message: "Not Found" });
    }
    m = /^\/repos\/(QNFO\/[^/]+)\/contents\/(.+)$/.exec(path);
    if (m) {
      const k = m[1] + "|" + m[2];
      if (method === "GET") { const f = files[k]; return f ? reply(200, { sha: f.sha, content: b64(f.text) + "\n" }) : reply(404, { message: "Not Found" }); }
      if (method === "PUT") {
        if (cfg.putStatus) return reply(cfg.putStatus, { message: "Protected branch update failed" });
        const b = JSON.parse(init.body); files[k] = { sha: "sha-after-put", text: Buffer.from(b.content, "base64").toString("utf8") }; return reply(files[k] && (cfg.files || {})[k] ? 200 : 201, { content: { path: m[2] } });
      }
    }
    m = /^\/repos\/([^/]+\/[^/]+)$/.exec(path);
    if (m) return repos[m[1]] ? reply(200, repos[m[1]]) : reply(404, { message: "Not Found" });
    return reply(404, { message: "Not Found" });
  };
  return { fetchImpl, log, files };
}
const go = (cfg, opts, extra) => { const g = fakeGh(cfg); return run(Object.assign({ token: "SECRET-TOKEN-123", hours: 24, max: 25, pauseMs: 0, agentSync: false }, opts || {}), Object.assign({ fetchImpl: g.fetchImpl, now: NOW, sleep: async () => {} }, extra || {})).then((s) => ({ s, g })); };
const posts = (g) => g.log.filter((c) => c.method === "POST");
// the credit pre-flight search also names the Copilot assignee; only a search WITHOUT the credit phrase looks for stalled issues
const stalledSearched = (g) => g.log.some((c) => /assignee:app\/copilot-swe-agent/.test(c.search || "") && !/AI Credits/.test(c.search || ""));

// helpers
ok(isCopilot("Copilot") && isCopilot("copilot-swe-agent[bot]") && isCopilot("copilot-swe-agent") && !isCopilot("rwnq8") && !isCopilot("copilot-fan"), "isCopilot matches the bot's three spellings and nothing else");
ok(sinceIso(NOW, 24) === "2026-10-29T09:00:00Z", "the look-back is an ISO time without milliseconds", sinceIso(NOW, 24));
ok(trusted(normalize(item(1))) && trusted(normalize(item(2, { author_association: "COLLABORATOR" }))) && trusted(normalize(item(3, { user: { login: "github-actions[bot]" }, author_association: "NONE" }))), "owner, collaborator and github-actions[bot] authors are trusted");
ok(!trusted(normalize(item(4, { user: { login: "stranger" }, author_association: "NONE" }))) && !trusted(normalize(item(5, { user: { login: "fan" }, author_association: "CONTRIBUTOR" }))) && !trusted(normalize(item(6, { user: { login: "evil[bot]" }, author_association: "NONE" }))), "a stranger, a past contributor and another bot are not trusted");
ok(normalize(item(7)).owner === "QNFO" && normalize(item(7)).repo === "qnfo-ops", "the repository comes from repository_url");
ok(mirrorId("[#1000625] CODE-MERGE-REFUSED-1: x") === 1000625 && mirrorId("[fleet] x") === null && mirrorId("a [#5] b") === null, "mirrorId reads the D1 id only from the leading [#id]");
ok([...parseRefs("Fixes #12 and refs QNFO/other#7, related to #3", "QNFO/a")].sort().join() === "QNFO/a#12,QNFO/a#3,QNFO/other#7", "parseRefs reads the issues a pull request works on", [...parseRefs("Fixes #12 and refs QNFO/other#7, related to #3", "QNFO/a")]);
ok(agentProblems(AGENT_TEXT).length === 0 && agentProblems("no front matter").length === 1 && agentProblems("---\nname: X\n---\n").join().includes("description") && agentProblems(AGENT_TEXT + "ghp_" + "a".repeat(30)).join().includes("token"), "agentProblems accepts a profile and names a missing description, front matter or an embedded token");
ok(!/\$\{|\{\{/.test(INSTRUCTIONS) && INSTRUCTIONS.length < 2000 && /work-claim/.test(INSTRUCTIONS) && /acquired:false/.test(INSTRUCTIONS) && /never assign the issue to a user/i.test(INSTRUCTIONS), "the instructions are static, short, carry the claim fallback and forbid assigning a person");

// 1. a trusted new issue is assigned with the exact payload
let { s, g } = await go({ issues: [item(11)] });
ok(s.status === "ok" && s.assigned === 1 && posts(g).length === 1, "one trusted new issue is assigned", s);
const p = posts(g)[0];
const deliveryWrite = g.log.find((c) => c.method === "PATCH" && c.path.endsWith("/issues/11"));
ok(deliveryWrite && /Definition of done \(CODE-CHANGE-REQUIRED-1\)/.test(deliveryWrite.body.body)
  && /CODE-CHANGE-REQUIRED-1/.test(INSTRUCTIONS), "issue dispatch persists a code-change DoD and instructs the agent to include it in the PR");
ok(p && p.path === "/repos/QNFO/qnfo-ops/issues/11/assignees" && JSON.stringify(p.body.assignees) === JSON.stringify([COPILOT_BOT]), "the call goes to the assignees endpoint with copilot-swe-agent[bot] only", p);
ok(p && p.body.agent_assignment.custom_agent === AGENT && AGENT === "quniverse" && p.body.agent_assignment.target_repo === "QNFO/qnfo-ops" && p.body.agent_assignment.base_branch === "main" && p.body.agent_assignment.custom_instructions === INSTRUCTIONS, "agent_assignment names the Quniverse agent, this repository and its default branch", p && p.body);
const searchCall = g.log.find((c) => c.path === "/search/issues" && !/is:pr|assignee:/.test(c.search));
const q = decodeURIComponent(searchCall.search);
ok(/q=org:QNFO is:issue is:open archived:false created:>=2026-10-29T09:00:00Z/.test(q), "the search is every open, non-archived issue of the organization created inside the window", q);
{
  const refused = await go({ issues: [item(12)], issuePatchStatus: 403 });
  ok(posts(refused.g).length === 0 && refused.s.errors.some((e) => e.http === 403 && /code-delivery DoD/.test(e.where)),
    "a refused DoD write is explicit and does not dispatch an issue without the contract");
}
ok(g.log.filter((c) => c.path !== "LOCKS").every((c) => c.auth === "Bearer SECRET-TOKEN-123") && !JSON.stringify(s).includes("SECRET-TOKEN-123") && !g.log.some((c) => c.path.includes("SECRET")), "the credential is sent as a bearer token and appears in no summary and no path");
({ s, g } = await go({ issues: [item(12, { repository_url: "https://api.github.com/repos/QNFO/qnfo-skills" })], repos: {} }));
ok(posts(g)[0] && posts(g)[0].body.agent_assignment.base_branch === "master" && posts(g)[0].body.agent_assignment.target_repo === "QNFO/qnfo-skills", "the default branch of the issue's own repository is used (master here)", posts(g)[0] && posts(g)[0].body);

// 2. what is left alone
({ s, g } = await go({
  issues: [
    item(21, { pull_request: {} }), item(22, { state: "closed" }), item(23, { assignees: [{ login: "Copilot" }] }),
    item(24, { user: { login: "stranger" }, author_association: "NONE" }), item(25), item(26, { repository_url: "https://api.github.com/repos/QNFO/old" }), item(27)
  ],
  events: { "QNFO/qnfo-ops#25": [{ event: "assigned", assignee: { login: "Copilot" } }, { event: "unassigned", assignee: { login: "Copilot" } }] },
  repos: { "QNFO/old": { default_branch: "main", archived: true } }
}));
ok(s.assigned === 1 && posts(g).length === 1 && posts(g)[0].path.endsWith("/27/assignees"), "only the clean trusted issue is assigned", s);
ok(s.skipped["pull-request"] === 1 && s.skipped["not-open"] === 1 && s.skipped["already-assigned"] === 1 && s.skipped["untrusted-author"] === 1 && s.skipped["previously-assigned"] === 1 && s.skipped["repo-archived"] === 1, "each skip is counted under its reason", s.skipped);
ok(!g.log.some((c) => c.path.includes("/issues/24/")) && !g.log.some((c) => c.path.includes("/issues/23/")), "a stranger's issue and an already assigned issue cost no further call");

// 3. no person is ever assigned
({ s, g } = await go({ issues: [item(31)], autoAdd: [{ login: "rwnq8" }] }));
const del = g.log.find((c) => c.method === "DELETE");
ok(del && del.path === "/repos/QNFO/qnfo-ops/issues/31/assignees" && JSON.stringify(del.body) === JSON.stringify({ assignees: ["rwnq8"] }) && s.person_removed[0].logins[0] === "rwnq8", "a human the assignment added is removed again", del);
({ s, g } = await go({ issues: [item(32, { assignees: [{ login: "someone" }] })], autoAdd: [] }));
ok(!g.log.some((c) => c.method === "DELETE") && s.assigned === 1, "an assignee that was already on the issue is left in place");

// 4. order, priority and cap
({ s, g } = await go({ issues: [item(43, { created_at: "2026-10-30T03:00:00Z" }), item(41, { created_at: "2026-10-30T01:00:00Z" }), item(42, { created_at: "2026-10-30T02:00:00Z" }), item(44, { created_at: "2026-10-30T04:00:00Z" })] }, { max: 2 }));
ok(posts(g).map((c) => c.path.split("/")[5]).join() === "41,42" && s.deferred === 2 && s.assigned === 2, "the oldest issues go first and the cap defers the rest", { order: posts(g).map((c) => c.path), s });
({ s, g } = await go({ issues: [item(51, { created_at: "2026-10-30T01:00:00Z" }), item(52, { created_at: "2026-10-30T02:00:00Z" })], single: { "QNFO/qnfo-ops#53": item(53, { created_at: "2026-10-30T08:59:00Z" }) } }, { max: 1, priority: { repo: "QNFO/qnfo-ops", number: 53 } }));
ok(posts(g).length === 1 && posts(g)[0].path.includes("/issues/53/") && s.deferred === 2, "the issue that fired the run goes before older ones", posts(g).map((c) => c.path));
({ s, g } = await go({ issues: [item(61)], single: { "QNFO/qnfo-ops#61": item(61) } }, { priority: { repo: "QNFO/qnfo-ops", number: 61 } }));
ok(posts(g).length === 1 && s.considered === 1, "an issue that is both priority and in the search is handled once");
({ s, g } = await go({ issues: [] }, { priority: { repo: "QNFO/qnfo-ops", number: 99 } }));
ok(s.errors.length === 1 && s.errors[0].http === 404 && posts(g).length === 0, "an unreadable priority issue is reported and does not stop the sweep");

// 4b. back-pressure: the open Copilot pull requests bound the work
({ s, g } = await go({ issues: [item(71), item(72), item(73)], openPrCount: 12 }));
ok(s.capacity === 0 && s.assigned === 0 && posts(g).length === 0 && s.deferred === 3 && /limit/.test(s.deferred_why) && s.open_copilot_prs === 12, "at the open-pull-request limit nothing is assigned and the backlog is counted as deferred", s);
ok(!g.log.some((c) => /\/events$/.test(c.path)), "a saturated run examines no issue (no per-issue call)");
({ s, g } = await go({ issues: [item(71, { created_at: "2026-10-30T01:00:00Z" }), item(72, { created_at: "2026-10-30T02:00:00Z" }), item(73, { created_at: "2026-10-30T03:00:00Z" })], openPrCount: 10 }));
ok(s.capacity === 2 && s.assigned === 2 && s.deferred === 1 && posts(g).map((c) => c.path.split("/")[5]).join() === "71,72", "two free slots below the limit assign two issues", s);
({ s, g } = await go({ issues: [item(74)], copilotPrs: [] }, { maxOpen: 1 }));
ok(s.assigned === 1 && s.open_copilot_prs === 0, "no open Copilot pull request leaves the whole capacity free", s);
ok(DEFAULTS.max === 10 && DEFAULTS.maxOpen === 12 && DEFAULTS.hours === 720 && DEFAULTS.maxRedrives === 1, "the defaults are bounded: 10 a run, 12 open pull requests, 30 days, one re-drive per issue", DEFAULTS);

// 4c. claim-aware: an issue another doer holds is left to it
const locks = { claims: [{ key: "issue:555", holder: "session-x" }], in_flight: [{ kind: "code-loop", intent: "ROADMAP-1: QNFO.OPS #162: add /sla-gap -- issue #777 (RED-DRAIN-1 dispatch)" }, { kind: "ledger", issue_id: 888 }] };
({ s, g } = await go({ issues: [item(81, { title: "[#555] a" }), item(82, { title: "[#777] b" }), item(83, { title: "[#888] c" }), item(84, { title: "[#999] d" }), item(85, { title: "[fleet] plain" })], locks }));
ok(s.work_locks === "read" && s.skipped["has-doer"] === 3 && posts(g).map((c) => c.path.split("/")[5]).sort().join() === "84,85", "claimed, in-flight and ledger issues are left to their doer, the others are assigned", { s, posts: posts(g).map((c) => c.path) });
({ s, g } = await go({ issues: [item(86, { title: "[#555] a" })] }));
ok(s.work_locks === "unreachable" && s.assigned === 1, "an unreachable work-claim service never blocks the sweep", s);

// 4d. stalled re-drive: only after the claim fallback is on main, once, never over a live pull request
const CLAUDE_KEY = "QNFO/qnfo-workers|CLAUDE.md";
const stalledCfg = () => ({
  files: { [CLAUDE_KEY]: { sha: "c1", text: "## Work claims\n- CLAIM-UNREACHABLE-FALLBACK-1 (2026-10-30): an unreachable endpoint is not a refusal.\n" } },
  stalled: [withCopilot(101, { created_at: "2026-10-20T01:00:00Z" }), withCopilot(102, { created_at: "2026-10-20T02:00:00Z" }), withCopilot(103, { created_at: "2026-10-20T03:00:00Z" }), withCopilot(104, { created_at: "2026-10-20T04:00:00Z" }), withCopilot(105, { created_at: "2026-10-20T05:00:00Z" }), withCopilot(106, { created_at: "2026-10-20T06:00:00Z" })],
  events: {
    "QNFO/qnfo-ops#101": [{ event: "assigned", assignee: { login: "Copilot" }, created_at: hAgo(3) }],
    "QNFO/qnfo-ops#102": [{ event: "assigned", assignee: { login: "Copilot" }, created_at: hAgo(0.5) }],
    "QNFO/qnfo-ops#103": [{ event: "assigned", assignee: { login: "Copilot" }, created_at: hAgo(5) }],
    "QNFO/qnfo-ops#104": [{ event: "assigned", assignee: { login: "Copilot" }, created_at: hAgo(5) }],
    "QNFO/qnfo-ops#105": [{ event: "assigned", assignee: { login: "Copilot" }, created_at: hAgo(10) }, { event: "assigned", assignee: { login: "Copilot" }, created_at: hAgo(5) }],
    "QNFO/qnfo-ops#106": [{ event: "assigned", assignee: { login: "Copilot" }, created_at: hAgo(6) }]
  },
  copilotPrs: [{ number: 900, repository_url: "https://api.github.com/repos/QNFO/qnfo-ops", body: "Fixes #103", pull_request: {} }],
  timeline: {
    "QNFO/qnfo-ops#104": [{ event: "cross-referenced", source: { issue: { state: "closed", pull_request: { merged_at: "2026-10-30T07:00:00Z" } } } }],
    "QNFO/qnfo-ops#106": [{ event: "cross-referenced", source: { issue: { state: "closed", pull_request: { merged_at: null } } } }, { event: "connected" }]
  }
});
const num = (c) => c.path.split("/")[5];
const assignedAtList = (hours) => hours.map((h) => ({ event: "assigned", assignee: { login: "Copilot" }, created_at: hAgo(h) }));
({ s, g } = await go(stalledCfg()));
ok(s.claim_fallback_on_main === true && s.redriven === 2 && s.assigned === 0 && s.status === "ok", "with the fallback on main two stalled assignments are re-driven", s);
ok(posts(g).map(num).join() === "101,106", "only the stalled ones: not the recent session, not the one with an open Copilot pull request, not the one with a merged pull request, not the exhausted one", { posts: posts(g).map((c) => c.path), skipped: s.skipped });
ok(s.skipped["session-recent"] === 1 && s.skipped["has-open-copilot-pr"] === 1 && s.skipped["has-live-pr"] === 1 && s.skipped["redrive-exhausted"] === 1, "each refusal is counted under its reason", s.skipped);
const seq = g.log.filter((c) => /\/(101|106)\/assignees$/.test(c.path)).map((c) => c.method + num(c));
ok(seq.join() === "DELETE101,POST101,DELETE106,POST106", "each re-drive unassigns the bot and then assigns again", seq);
ok(g.log.filter((c) => c.method === "DELETE").every((c) => JSON.stringify(c.body) === JSON.stringify({ assignees: [COPILOT_BOT] })), "the unassign names the bot login copilot-swe-agent[bot] (the login the API accepts) and no person");
({ s, g } = await go(Object.assign(stalledCfg(), { files: {} })));
ok(s.claim_fallback_on_main === false && s.redriven === 0 && !stalledSearched(g), "without the fallback on main nothing is re-driven and the stalled issues are not even searched");
({ s, g } = await go(stalledCfg(), { sweep: "new-only" }));
ok(s.redriven === 0 && posts(g).length === 0 && s.claim_fallback_on_main === false, "new-only turns the re-drive off");
({ s, g } = await go(stalledCfg(), { redriveMax: 1 }));
ok(s.redriven === 1 && s.deferred >= 1 && posts(g).map(num).join() === "101", "--redrive-max bounds the re-drives in one run", s);
({ s, g } = await go(Object.assign(stalledCfg(), { openPrCount: 11 })));
ok(s.capacity === 1 && s.redriven === 1, "the open-pull-request limit bounds re-drives too", s);
({ s, g } = await go(Object.assign(stalledCfg(), { openPrCount: 12 })));
ok(s.capacity === 0 && s.redriven === 0 && !stalledSearched(g), "a saturated run does not even search the stalled issues");
({ s, g } = await go(Object.assign(stalledCfg(), { deleteStatus: 403 })));
ok(s.redriven === 0 && posts(g).length === 0 && s.errors.some((e) => /could not unassign/.test(e.message)), "a failed unassign stops that re-drive before any new assignment");
({ s, g } = await go(Object.assign(stalledCfg(), { timelineStatus: 500 })));
ok(s.redriven === 0 && s.skipped["history-unreadable"] >= 1, "an unreadable timeline re-drives nothing");
({ s, g } = await go(Object.assign(stalledCfg(), { locks: { claims: [{ key: "issue:1" }], in_flight: [] }, stalled: [withCopilot(107, { title: "[#1] held", created_at: "2026-10-20T07:00:00Z" })], events: { "QNFO/qnfo-ops#107": [{ event: "assigned", assignee: { login: "Copilot" }, created_at: hAgo(9) }] } })));
ok(s.redriven === 0 && s.skipped["has-doer"] === 1, "a claimed issue is not re-driven either");
({ s, g } = await go({ issues: [item(120)] }, { sweep: "off" }));
ok(s.status === "disabled" && g.log.length === 0, "ASSIGN_COPILOT_SWEEP=off sends nothing");
({ s, g } = await go({ issues: [item(121)] }, { sweep: "garbage" }));
ok(s.sweep === "on" && s.assigned === 1, "an unknown switch value means on");

// 4e. an issue-only repository is worked where the code lives (measured live: target_repo may differ from the issue's repository)
({ s, g } = await go({ issues: [item(131, { repository_url: "https://api.github.com/repos/QNFO/qnfo-fleet-issues", title: "[general] Worker observability (live)" })], repos: { "QNFO/qnfo-workers": { default_branch: "trunk", archived: false } } }));
ok(posts(g)[0] && posts(g)[0].path === "/repos/QNFO/qnfo-fleet-issues/issues/131/assignees" && posts(g)[0].body.agent_assignment.target_repo === "QNFO/qnfo-workers" && posts(g)[0].body.agent_assignment.base_branch === "trunk", "an issue in the issue-only repository is assigned where it lives but worked in qnfo-workers, on that repository's default branch", posts(g)[0] && posts(g)[0].body);
({ s, g } = await go({ issues: [item(132, { repository_url: "https://api.github.com/repos/QNFO/qnfo-fleet-issues" })], repos: { "QNFO/qnfo-workers": { default_branch: "main", archived: true } } }));
ok(posts(g).length === 0 && s.skipped["repo-unreadable"] === 1, "an archived work repository assigns nothing", s);
ok(TARGET_OVERRIDES["QNFO/qnfo-fleet-issues"] === "QNFO/qnfo-workers" && Object.keys(TARGET_OVERRIDES).length === 1, "only the issue-feed repository is redirected");

// 4f. throttle: only the first run of each window sweeps, and a throttled run never starves the next window
const gate = (event, runId) => ({ gate: { event, runId, repo: "QNFO/qnfo-workers", minutes: 10 } });
const run_ = (id, created) => ({ id, created_at: created, conclusion: "success" });
({ s, g } = await go({ issues: [item(141)], runs: [run_(3, "2026-10-30T09:35:30Z"), run_(2, "2026-10-30T09:32:00Z"), run_(1, "2026-10-30T09:31:00Z")] }, gate("workflow_run", 3)));
ok(s.status === "throttled" && s.assigned === 0 && g.log.length === 1 && /earlier run/.test(s.note), "a run with an earlier run in its own window is throttled and costs one read", s);
({ s, g } = await go({ issues: [item(142)], runs: [run_(5, "2026-10-30T09:40:30Z"), run_(4, "2026-10-30T09:39:59Z"), run_(3, "2026-10-30T09:35:30Z")] }, gate("workflow_run", 5)));
ok(s.status === "ok" && s.assigned === 1, "the first run of a window sweeps, whatever ran in the previous window (no starvation)", s);
({ s, g } = await go({ issues: [item(143)], runs: [run_(3, "2026-10-30T09:35:30Z"), run_(2, "2026-10-30T09:32:00Z")] }, gate("issues", 3)));
ok(s.status === "ok" && s.assigned === 1 && !g.log.some((c) => /actions\/workflows/.test(c.path)), "an issues run always sweeps and reads no run list");
({ s, g } = await go({ issues: [item(144)], runs: [run_(3, "2026-10-30T09:35:30Z"), run_(2, "2026-10-30T09:32:00Z")] }, gate("workflow_dispatch", 3)));
ok(s.status === "ok" && s.assigned === 1, "a manual run always sweeps");
({ s, g } = await go({ issues: [item(145)], runs: [run_(2, "2026-10-30T09:32:00Z")] }, gate("workflow_run", 3)));
ok(s.status === "ok" && s.assigned === 1, "a run that is not in the list yet is not throttled");
({ s, g } = await go({ issues: [item(146)], runsStatus: 500 }, gate("schedule", 3)));
ok(s.status === "ok" && s.assigned === 1, "an unreadable run list never blocks the sweep");
({ s, g } = await go({ issues: [item(147)], runs: [run_(3, "2026-10-30T09:35:30Z"), run_(2, "2026-10-30T09:35:30Z")] }, gate("workflow_run", 3)));
ok(s.status === "throttled", "two runs created in the same second: the lower id sweeps, the other is throttled", s);
({ s, g } = await go({ issues: [item(148)], runs: [run_(3, "2026-10-30T09:35:30Z"), run_(2, "2026-10-30T09:35:30Z")] }, gate("workflow_run", 2)));
ok(s.status === "ok" && s.assigned === 1, "the lower id of two simultaneous runs sweeps", s);
ok(DEFAULTS.windowMinutes === 10, "the throttle window is ten minutes");

// 4g. an assignment Copilot refused to start is not a session (measured 2026-11-01: 109 of 153 issues assigned to Copilot, 107 of them for lack of AI credits)
const tlc = (who, body) => ({ event: "commented", actor: { login: who }, body });
const sf0 = startFailures([tlc("Copilot", REFUSED_CREDITS), tlc("Copilot", REFUSED_CREDITS), tlc("Copilot", REFUSED_OTHER), tlc("rwnq8", REFUSED_CREDITS), tlc("Copilot", "Working on it."), { event: "cross-referenced" }, { event: "commented", user: { login: "Copilot" }, body: REFUSED_OTHER }]);
ok(sf0.all === 4 && sf0.credits === 2 && sf0.other === 2, "startFailures counts only Copilot's own refusals (actor or user), split into credit refusals and others", sf0);
ok(startFailures(null).all === 0 && startFailures([]).all === 0 && START_FAILED_RE.test(REFUSED_OTHER) && CREDITS_RE.test(REFUSED_CREDITS) && !CREDITS_RE.test(REFUSED_OTHER), "the refusal and credit patterns match the comments measured live");
const LANDED_FILES = { [CLAUDE_KEY]: { sha: "c1", text: "## Work claims\n- CLAIM-UNREACHABLE-FALLBACK-1 (2026-10-30): an unreachable endpoint is not a refusal.\n" } };
const stalledOne = (n, assignedHours, tl, extra) => Object.assign({
  files: LANDED_FILES, stalled: [withCopilot(n, { created_at: "2026-10-20T01:00:00Z" })],
  events: { ["QNFO/qnfo-ops#" + n]: assignedHours.map((h) => ({ event: "assigned", assignee: { login: "Copilot" }, created_at: hAgo(h) })) },
  timeline: { ["QNFO/qnfo-ops#" + n]: tl }
}, extra || {});
({ s, g } = await go(stalledOne(301, [30, 20, 10], [tlc("Copilot", REFUSED_CREDITS), tlc("Copilot", REFUSED_CREDITS), tlc("Copilot", REFUSED_CREDITS)])));
ok(s.redriven === 1 && s.redriven_after_start_failure === 1 && posts(g).length === 1 && !s.skipped["redrive-exhausted"], "an issue assigned three times whose three starts all failed for credits is re-driven (it used to read redrive-exhausted and was never worked)", s);
({ s, g } = await go(stalledOne(302, [30, 20, 10], [tlc("Copilot", REFUSED_CREDITS)])));
ok(s.redriven === 0 && s.skipped["redrive-exhausted"] === 1, "two real sessions (three assignments, one refusal) still exhaust the re-drive", s);
({ s, g } = await go(stalledOne(303, [70, 60, 50, 40, 30, 20, 10], [1, 2, 3, 4, 5, 6, 7].map(() => tlc("Copilot", REFUSED_CREDITS)))));
ok(s.redriven === 1, "credit refusals never count against an issue, however many there were", s);
({ s, g } = await go(stalledOne(304, [40, 30, 20, 10], [1, 2, 3, 4].map(() => tlc("Copilot", REFUSED_OTHER)))));
ok(s.redriven === 0 && s.skipped["start-failures-exhausted"] === 1, "a refusal that is not about credits is bounded: four of them stop the issue", s);
({ s, g } = await go(stalledOne(305, [30, 20, 10], [1, 2, 3].map(() => tlc("Copilot", REFUSED_OTHER)))));
ok(s.redriven === 1, "three non-credit refusals are still allowed one more try", s);
({ s, g } = await go(stalledOne(306, [20, 10], [tlc("Copilot", REFUSED_CREDITS)])));
ok(s.redriven === 1, "one refusal and one real session: the second real attempt is allowed", s);
({ s, g } = await go(stalledOne(307, [30, 20, 10], [tlc("Copilot", REFUSED_CREDITS), { event: "cross-referenced", source: { issue: { state: "open", pull_request: {} } } }])));
ok(s.redriven === 0 && s.skipped["has-live-pr"] === 1, "a refused start does not override a live pull request");
({ s, g } = await go(stalledOne(308, [0.5], [tlc("Copilot", REFUSED_CREDITS)])));
ok(s.redriven === 0 && s.skipped["session-recent"] === 1, "the cooldown applies to a refused start too (no retry inside the window)");

// 4h. a red main blocks every deploy: its ci-watchdog issue goes first
({ s, g } = await go({ issues: [item(401, { created_at: "2026-10-30T01:00:00Z" }), item(402, { created_at: "2026-10-30T08:00:00Z", labels: [{ name: PRIORITY_LABEL }] })] }, { max: 1 }));
ok(posts(g).length === 1 && posts(g)[0].path.includes("/issues/402/") && PRIORITY_LABEL === "ci-watchdog", "a ci-watchdog issue is assigned before an older issue when the cap allows one", posts(g).map((c) => c.path));
({ s, g } = await go({ stalled: [withCopilot(403, { created_at: "2026-10-01T00:00:00Z" }), withCopilot(404, { created_at: "2026-10-25T00:00:00Z", labels: [{ name: PRIORITY_LABEL }] })], files: LANDED_FILES, events: { "QNFO/qnfo-ops#403": assignedAtList([5]), "QNFO/qnfo-ops#404": assignedAtList([5]) } }, { redriveMax: 1 }));
ok(posts(g).length === 1 && posts(g)[0].path.includes("/issues/404/"), "a stalled ci-watchdog issue is re-driven before an older stalled issue", posts(g).map((c) => c.path));
({ s, g } = await go({ issues: [item(405, { created_at: "2026-10-30T01:00:00Z" }), item(406, { created_at: "2026-10-30T08:00:00Z", labels: [{ name: PRIORITY_LABEL }] })], single: { "QNFO/qnfo-ops#405": item(405, { created_at: "2026-10-30T01:00:00Z" }) } }, { max: 1, priority: { repo: "QNFO/qnfo-ops", number: 405 } }));
ok(posts(g).length === 1 && posts(g)[0].path.includes("/issues/405/"), "the issue that fired the run still goes before a ci-watchdog issue");

// 4i. canary: the first assignment of a run is checked for a refusal; credits stop the run, no refusal lets it continue
const refusalReads = (g) => g.log.filter((c) => c.method === "GET" && /\/comments$/.test(c.path));
const sleeps = [];
({ s, g } = await go({ issues: [item(411, { created_at: "2026-10-30T01:00:00Z" }), item(412, { created_at: "2026-10-30T02:00:00Z" }), item(413, { created_at: "2026-10-30T03:00:00Z" })], refuseOnAssign: { "QNFO/qnfo-ops#411": "credits" } }, {}, { sleep: async (ms) => { sleeps.push(ms); } }));
ok(posts(g).length === 1 && s.status === "credits-exhausted" && s.credits_exhausted === "QNFO/qnfo-ops#411" && /AI credits/.test(s.start_refused) && /AI credits are exhausted/.test(s.stopped), "a credit refusal on the first assignment stops the run after that one assignment", s);
ok(sleeps.length === 1 && sleeps[0] === DEFAULTS.canaryMs && DEFAULTS.canaryMs === 12000, "the canary waits the configured seconds once (Copilot refuses within about five)", sleeps);
({ s, g } = await go({ issues: [item(421, { created_at: "2026-10-30T01:00:00Z" }), item(422, { created_at: "2026-10-30T02:00:00Z" })], refuseOnAssign: { "QNFO/qnfo-ops#421": "other" } }));
ok(posts(g).length === 1 && s.status === "stopped" && /other reason/.test(s.start_refused) && s.credits_exhausted === undefined && /unknown/.test(s.stopped), "a refusal for another reason also stops the run (the cause is unknown, so the rest would meet it)", s);
({ s, g } = await go({ issues: [item(431, { created_at: "2026-10-30T01:00:00Z" }), item(432, { created_at: "2026-10-30T02:00:00Z" }), item(433, { created_at: "2026-10-30T03:00:00Z" })] }));
ok(posts(g).length === 3 && s.status === "ok" && refusalReads(g).length === 1, "with no refusal every issue is assigned and the canary read exactly once", { posts: posts(g).length, reads: refusalReads(g).length, status: s.status });
({ s, g } = await go({ issues: [item(441), item(442)], refuseOnAssign: { "QNFO/qnfo-ops#441": "credits" } }, { mode: "dry" }));
ok(refusalReads(g).length === 0 && posts(g).length === 0 && s.would_assign.length === 2, "dry never assigns, so it never runs the canary or the pre-flight check");
({ s, g } = await go(Object.assign(stalledOne(451, [30], []), { refuseOnAssign: { "QNFO/qnfo-ops#451": "credits" } })));
ok(s.status === "credits-exhausted" && s.redriven === 1, "a re-drive is canaried like a new assignment", s);

// 4j. pre-flight breaker: while Copilot is refusing for credits, assign nothing
const recentRefusal = (key, hours, body) => ({ [key]: [{ user: { login: "Copilot" }, created_at: hAgoIso(hours), body: body || REFUSED_CREDITS }] });
({ s, g } = await go({ issues: [item(461)], creditsIssues: [item(462)], comments: recentRefusal("QNFO/qnfo-ops#462", 0.17) }));
ok(s.status === "credits-exhausted" && s.credits_check === "tripped" && s.credits_exhausted === "QNFO/qnfo-ops#462" && posts(g).length === 0 && s.assigned === 0 && /AI credits/.test(s.note), "a credit refusal inside the cooldown window stops the sweep before it assigns anything", s);
ok(!g.log.some((c) => /created:>=/.test(c.search || "")), "the tripped run costs only the pre-flight reads (it never lists the issues)");
({ s, g } = await go({ issues: [item(463)], creditsIssues: [item(464)], comments: recentRefusal("QNFO/qnfo-ops#464", 2) }));
ok(s.status === "ok" && s.credits_check === "clear" && s.assigned === 1, "a refusal older than the window no longer holds the sweep", s);
({ s, g } = await go({ issues: [item(465)], creditsIssues: [item(466)], comments: recentRefusal("QNFO/qnfo-ops#466", 0.17, REFUSED_OTHER) }));
ok(s.status === "ok" && s.credits_check === "clear" && s.assigned === 1, "a refusal that is not about credits does not trip the breaker");
({ s, g } = await go({ issues: [item(467)], creditsIssues: [item(468)], comments: recentRefusal("QNFO/qnfo-ops#468", 0.17) }, { creditsCooldownMinutes: 5 }));
ok(s.status === "ok" && s.assigned === 1, "the cooldown is configurable (a 10-minute-old refusal is outside a 5-minute window)");
({ s, g } = await go({ issues: [item(469)] }));
ok(s.credits_check === "clear" && s.assigned === 1, "no recently updated credit-refusal issue leaves the breaker clear");
({ s, g } = await go({ issues: [item(470)], creditsIssues: [item(471)], comments: recentRefusal("QNFO/qnfo-ops#471", 0.17), openPrCount: 12 }));
ok(!g.log.some((c) => /AI Credits/.test(c.search || "")) && s.capacity === 0, "a saturated run skips the pre-flight (it would assign nothing anyway)");
({ s, g } = await go({ issues: [item(473)], creditsIssues: [item(474)], comments: recentRefusal("QNFO/qnfo-ops#474", 3), sinceIsUpdatedAt: true }));
ok(s.status === "ok" && s.credits_check === "clear" && s.assigned === 1, "a refusal written hours ago that GitHub returns because it was edited recently does not trip the breaker (since filters on updated_at, so the comment's own time decides)", s);
const cb = await creditsBreaker(makeApi(fakeGh({ creditsIssues: [item(472)], comments: recentRefusal("QNFO/qnfo-ops#472", 0.1) }).fetchImpl, "t"), "QNFO", NOW, 30);
ok(cb.tripped === true && cb.issue === "QNFO/qnfo-ops#472", "creditsBreaker reads the comment time, not the issue's updated_at", cb);
const cb2 = await creditsBreaker(makeApi(fakeGh({ searchStatus: 500, creditsIssues: [] }).fetchImpl, "t"), "QNFO", NOW, 30);
ok(cb2.tripped === false, "an unreadable pre-flight never blocks the sweep");

// 4k. the per-run read budget bounds what a sweep spends of the shared PAT
({ s, g } = await go(Object.assign(stalledCfg(), { }), { maxCalls: 14 }));
ok(s.deferred_why === "read budget" && s.deferred >= 1 && g.log.filter((c) => c.path !== "LOCKS").length <= 14 + 8, "a run that has spent its read budget defers the rest of the backlog", { why: s.deferred_why, deferred: s.deferred, calls: s.calls });
ok(DEFAULTS.maxCalls === 170 && DEFAULTS.maxOtherFailures === 3 && DEFAULTS.creditsCooldownMinutes === 30, "the defaults: 170 reads a run, three non-credit refusals, a 30-minute credit cooldown", DEFAULTS);

// 5. failures never throw and never loop
({ s, g } = await go({ issues: [item(71, { created_at: "2026-10-30T01:00:00Z" }), item(72, { created_at: "2026-10-30T02:00:00Z" }), item(73, { created_at: "2026-10-30T03:00:00Z" })], assignStatus: { "QNFO/qnfo-ops#71": 401 }, assignMessage: { "QNFO/qnfo-ops#71": "Bad credentials" } }));
ok(s.status === "stopped" && posts(g).length === 1 && /401/.test(s.stopped), "a 401 stops the run after the first refusal", s);
({ s, g } = await go({ issues: [item(81), item(82)], assignStatus: { "QNFO/qnfo-ops#81": 403 }, assignMessage: { "QNFO/qnfo-ops#81": "You have exceeded a secondary rate limit" } }));
ok(s.status === "stopped" && posts(g).length === 1, "a rate limit stops the run", s);
({ s, g } = await go({ issues: [item(91), item(92), item(93, { repository_url: "https://api.github.com/repos/QNFO/qnfo-skills" })], assignRepoStatus: { "QNFO/qnfo-ops": 403 } }));
ok(s.status === "partial" && posts(g).length === 2 && s.skipped["repo-refused"] === 1 && s.assigned === 1, "a refusal for one repository skips that repository's other issues and not the rest", s);
({ s, g } = await go({ issues: [item(95)], assignStatus: { "QNFO/qnfo-ops#95": 422 }, assignMessage: { "QNFO/qnfo-ops#95": "Validation Failed" } }));
ok(s.status === "partial" && s.assigned === 0 && s.errors[0].http === 422, "a 422 is recorded and the run still completes", s);
({ s } = await go({ issues: [item(96)], searchStatus: 422 }));
ok(s.errors[0].where === "search" && s.assigned === 0, "a failed search assigns nothing and says so");
({ s } = await go({ issues: [item(97)], networkDown: true }));
ok(s.status === "partial" && s.assigned === 0 && s.errors.some((e) => /network/.test(e.message)), "a network failure is an error row and not an exception", s);
({ s, g } = await go({ issues: [item(98)] }, { token: "" }));
ok(s.status === "no-credential" && g.log.length === 0 && s.assigned === 0, "no credential sends nothing and says why");

// 6. dry
({ s, g } = await go({ issues: [item(101), item(102)] }, { mode: "dry" }));
ok(s.mode === "dry" && s.would_assign.length === 2 && !g.log.some((c) => c.method !== "GET"), "dry names what it would assign and sends no write", s);

// 7. the organization agent
const SRC_KEY = AGENT_SOURCE.repo + "|" + AGENT_SOURCE.path, DST_KEY = AGENT_TARGET.repo + "|" + AGENT_TARGET.path;
let g2 = fakeGh({ files: { [SRC_KEY]: { sha: "aaa1111", text: AGENT_TEXT } } });
let r = await syncOrgAgent(makeApi(g2.fetchImpl, "t"), false);
let put = g2.log.find((c) => c.method === "PUT");
ok(r.status === "created" && put && put.path === "/repos/QNFO/.github/contents/agents/quniverse.agent.md" && put.body.branch === "master" && put.body.sha === undefined && Buffer.from(put.body.content, "base64").toString("utf8") === AGENT_TEXT, "a missing organization agent is created on master, byte for byte", r);
g2 = fakeGh({ files: { [SRC_KEY]: { sha: "aaa1111", text: AGENT_TEXT }, [DST_KEY]: { sha: "bbb2222", text: "old" } } });
r = await syncOrgAgent(makeApi(g2.fetchImpl, "t"), false); put = g2.log.find((c) => c.method === "PUT");
ok(r.status === "updated" && put && put.body.sha === "bbb2222", "a different organization agent is replaced with the sha it replaces", r);
g2 = fakeGh({ files: { [SRC_KEY]: { sha: "aaa1111", text: AGENT_TEXT }, [DST_KEY]: { sha: "aaa1111", text: AGENT_TEXT } } });
r = await syncOrgAgent(makeApi(g2.fetchImpl, "t"), false);
ok(r.status === "in-sync" && !g2.log.some((c) => c.method === "PUT"), "an identical organization agent is left alone", r);
g2 = fakeGh({ files: { [SRC_KEY]: { sha: "ccc3333", text: "no front matter" } } });
r = await syncOrgAgent(makeApi(g2.fetchImpl, "t"), false);
ok(r.status === "source-invalid" && !g2.log.some((c) => c.method === "PUT"), "an invalid source profile is never published", r);
g2 = fakeGh({});
r = await syncOrgAgent(makeApi(g2.fetchImpl, "t"), false);
ok(r.status === "source-unreadable" && !g2.log.some((c) => c.method === "PUT"), "an unreadable source publishes nothing", r);
g2 = fakeGh({ files: { [SRC_KEY]: { sha: "aaa1111", text: AGENT_TEXT } }, putStatus: 403 });
r = await syncOrgAgent(makeApi(g2.fetchImpl, "t"), false);
ok(r.status === "write-refused" && r.http === 403, "a refused write is reported with its status", r);
g2 = fakeGh({ files: { [SRC_KEY]: { sha: "aaa1111", text: AGENT_TEXT } } });
r = await syncOrgAgent(makeApi(g2.fetchImpl, "t"), true);
ok(r.status === "would-create" && !g2.log.some((c) => c.method === "PUT"), "dry reports would-create and writes nothing", r);
({ s, g } = await go({ issues: [item(111)], files: { [SRC_KEY]: { sha: "aaa1111", text: AGENT_TEXT } }, putStatus: 403 }, { agentSync: true }));
ok(s.agent_sync.status === "write-refused" && s.assigned === 1, "a refused organization-agent write does not stop the assignments", s);

// 8. the files in this repository
const wf = readFileSync(join(root, ".github", "workflows", "assign-copilot-on-issue.yml"), "utf8");
const live = wf.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
ok(/GH_PAT_TOKEN: \$\{\{ secrets\.QNFO_GH_PAT \}\}/.test(live) && !/secrets\.GITHUB_TOKEN/.test(live), "the workflow authenticates with QNFO_GH_PAT and never with GITHUB_TOKEN");
ok(/ASSIGN_COPILOT_SWEEP: \$\{\{ vars\.ASSIGN_COPILOT_SWEEP \}\}/.test(live) && /--max "\$\{IN_MAX:-10\}"/.test(live), "the kill switch is the repository variable ASSIGN_COPILOT_SWEEP and a run assigns at most 10 by default");
ok(/^permissions:\n  contents: read\n/m.test(live) && !/issues:\s*write/.test(live), "the workflow's own token is read-only (the user token does the write)");
ok(/timeout-minutes: \d+/.test(live) && /runs-on: ubuntu-24\.04/.test(live) && /group: assign-copilot-on-issue\n\s+cancel-in-progress: false/.test(live), "the job has a timeout, the pinned runner and a non-cancelling concurrency group");
ok(/issues:\n\s+types: \[opened\]/.test(live) && /workflow_run:\n\s+workflows: \["remediation-consumer"\]/.test(live) && /workflow_dispatch:/.test(live) && /schedule:/.test(live), "it fires on issue opened, after remediation-consumer, by schedule and by hand");
ok(!live.split("\n").some((l) => /^\s*(run:|-?\s*run:)/.test(l) && /\$\{\{/.test(l)) && /node scripts\/assign-copilot-sweep\.mjs/.test(live), "no expression reaches a run line (inputs travel through env) and the script is the one under test");
ok(/uses: actions\/checkout@[0-9a-f]{40} # v\d/.test(live) && /uses: actions\/setup-node@[0-9a-f]{40} # v\d/.test(live), "both actions are pinned to a commit sha with a version comment");
const agentSrc = readFileSync(join(root, ".github", "agents", "quniverse.agent.md"), "utf8");
ok(agentProblems(agentSrc).length === 0, "the profile in this repository is one the sweep will publish", agentProblems(agentSrc));
ok(/Assign Copilot|assign Copilot|ASSIGN-COPILOT-ISSUES-1/.test(readFileSync(join(root, "CLAUDE.md"), "utf8")), "CLAUDE.md records the automation and the cloud claim fallback");

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
