// qnfo-agents CodeSession helpers (RM-CODE-SESSION-1, RM-CODE-SANDBOX-1; 0.8.0). Pure functions, no imports beyond lib.js, so the offline suites load them with node
// and no node_modules.
import { OPS_READ_ONLY, LEAN_OLD_RESULT_CHARS, LEAN_MAX_STEPS } from "./lib.js";

// ---- RM-CODE-SESSION-1: the per-session neuron budget downgrades a CodeSession and never stops it (BUDGET-SOFT-ROUTE-1).
// Measured 2026-11-04 (cf_agent_session_usage): the two completed sessions used 252,213 and 359,603 input tokens for one turn each (USD 0.13 and 0.17),
// because every step of the stream resent every earlier tool result. A session therefore compacts earlier tool results before each step, and as its neurons
// run out it drops to the cheapest route (dynamic/value) with a lower step cap; a spent session keeps answering, one lean turn at a time.
export const CODE_SESSION_BUDGET_DEFAULT = 100000;
export const CODE_SESSION_ROUTE_CHEAP = "dynamic/value";
export const CODE_SESSION_ROUTE_ESCALATE = "dynamic/premium";
export const CODE_SESSION_STUB_CHARS = 1200;
export const CODE_SESSION_WATCH_AT = 0.6;
export function sessionBudgetStep(used, budget) {
  const b = Number(budget) > 0 ? Number(budget) : CODE_SESSION_BUDGET_DEFAULT;
  const u = Math.max(0, Number(used) || 0);
  const frac = u / b;
  const left = Math.max(0, b - u);
  if (frac >= 1) return { state: "spent", frac, left, route: CODE_SESSION_ROUTE_CHEAP, stubChars: LEAN_OLD_RESULT_CHARS, maxSteps: LEAN_MAX_STEPS, canEscalate: false };
  if (frac >= CODE_SESSION_WATCH_AT) return { state: "watch", frac, left, route: null, stubChars: LEAN_OLD_RESULT_CHARS, maxSteps: 10, canEscalate: false };
  return { state: "ok", frac, left, route: null, stubChars: CODE_SESSION_STUB_CHARS, maxSteps: 16, canEscalate: true };
}
// The route a turn runs on: the session's step wins when it forces one (spent), else an explicit escalation (only while the budget is ok), else the default.
export function sessionTurnRoute(step, escalate, fallback) {
  if (step && step.route) return step.route;
  if (escalate && step && step.canEscalate) return CODE_SESSION_ROUTE_ESCALATE;
  return fallback;
}
export function sessionBudgetFrom(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1000 && n <= 1000000 ? Math.round(n) : CODE_SESSION_BUDGET_DEFAULT;
}

// Ten plain-English turns that a CodeSession replays through its stream (RM-CMD-FAILURES-1 asked for ten turns of the kinds the owner types: a question, a
// probe, a code change, a decision). Each is read-only, so replaying them changes nothing; the code change is a proposal, which the owner still files.
// Seeding is keyed by requester, so a re-seed is a new requester: ".r2" (2026-11-05) replaces the ten rows of "rm-code-session-1" that were shed unrun (see
// codeSessionLane below) and the one selftest that failed on its host module name. Bump the round to seed again; never delete the old rows.
export const SEED_ROUND = "r2";
export const CODE_SESSION_REPLAY_REQUESTER = "rm-code-session-1." + SEED_ROUND;
export const APPROVAL_SELFTEST_REQUESTER = "rm-durable-interrupt-1." + SEED_ROUND;
export const CODE_SESSION_REPLAY_BUDGET = 30000;
export const CODE_SESSION_REPLAY_TURNS = [
  "What is the constraint program right now, and which focus issues have no doer? Read it from the fleet managers feed (dashboard_feed /api/managers) and answer in five lines.",
  "Show the open critical issues in priority-queue order, ten at most, with their ids and titles (v_issue_queue).",
  "Did the latest deploy-gate run on main pass? Name the failing job and step if it did not (github_repo_read or the workflow runs).",
  "List the workers whose deployed version is behind main, if any (fleet_deploys against the repository).",
  "Propose a code change: the first heading of docs/README.md should name the fleet's documentation index. Use propose_code_task with a verbatim anchor and do not claim it is applied.",
  "Probe the health of qnfo-ops, qnfo-ai and qnfo-agents and report each worker's VERSION from its /health answer.",
  "Decide with evidence: may the stale-PR lane merge a green control-plane pull request that has been quiet for 20 minutes? Read the rule in CLAUDE.md (repo_read_file) and say which rule applies.",
  "What did Workers AI cost yesterday, by caller? Read ai_spend_ledger and list the three largest callers with usd.",
  "How many agent_issues were opened and how many closed in the last 24 hours? Give both counts and the drain ratio.",
  "Summarise where RM-CODE-SESSION-1 stands from roadmap_implementation and agent_issues 1000805: what is built, what is measured, what is open."
];

// ---- RM-CODE-SANDBOX-1: plan, approve, claim, edit, PR. A write-scope CodeSession may read freely; any tool that changes something waits for an
// approved plan, an edit takes a work claim on its file first, and a pull request needs at least one claimed edit. The gate is a pure function of the tool,
// its arguments and the session's plan and claims, so it is tested without a model. It sits in front of opsCall, the one path every ops tool takes.
export const SANDBOX_EDIT_TOOLS = ["workspace_write", "workspace_edit", "workspace_patch", "workspace_delete", "github_file_write"];
export const SANDBOX_PR_TOOLS = ["github_pr", "github_create_branch", "github_cherry_pick", "github_pr_close", "github_branch_delete"];
export function sandboxToolClass(name) {
  const n = String(name || "");
  if (OPS_READ_ONLY.indexOf(n) >= 0) return "read";
  if (SANDBOX_EDIT_TOOLS.indexOf(n) >= 0) return "edit";
  if (SANDBOX_PR_TOOLS.indexOf(n) >= 0) return "pr";
  return "change";
}
export function sandboxClaimKey(path) {
  const p = String(path == null ? "" : path).trim().replace(/^\.\//, "").replace(/^\/+/, "");
  if (!p || p.length > 200 || p.indexOf("..") >= 0 || !/^[A-Za-z0-9._\/-]+$/.test(p)) return "";
  return "file:" + p;
}
// st: { planApproved: boolean, claims: string[] (keys held; an unreachable claim service is recorded as a claim), claimed: number }
export function sandboxGate(name, args, st) {
  const cls = sandboxToolClass(name);
  if (cls === "read") return { allow: true, cls };
  const state = st || {};
  if (!state.planApproved) return { allow: false, cls, need: "plan", error: "'" + name + "' changes something: call propose_plan first and wait until the owner approves the plan in the page; read tools stay open meanwhile" };
  if (cls === "edit") {
    const key = sandboxClaimKey(args && args.path);
    if (!key) return { allow: false, cls, need: "path", error: "'" + name + "' needs a relative repository path (letters, digits, . _ / -) to take its work claim" };
    if ((state.claims || []).indexOf(key) >= 0) return { allow: true, cls, key };
    return { allow: true, cls, key, claim: key };
  }
  if (cls === "pr" && !(Number(state.claimed) > 0)) return { allow: false, cls, need: "claim", error: "'" + name + "' follows an edit: this session has no claimed file yet, so there is nothing to open a pull request for" };
  return { allow: true, cls };
}
// The model's plan, normalised: a title, 1 to 12 steps and up to 12 repository paths. Anything else is refused with the reason.
export function sandboxPlan(input) {
  const i = input && typeof input === "object" ? input : {};
  const title = String(i.title == null ? "" : i.title).replace(/\s+/g, " ").trim();
  if (title.length < 8 || title.length > 160) return { error: "a plan needs a title of 8 to 160 characters" };
  const steps = (Array.isArray(i.steps) ? i.steps : []).map((s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim()).filter(Boolean);
  if (steps.length < 1 || steps.length > 12) return { error: "a plan needs 1 to 12 steps" };
  if (steps.some((s) => s.length < 4 || s.length > 300)) return { error: "each plan step is 4 to 300 characters" };
  const files = (Array.isArray(i.files) ? i.files : []).map((f) => String(f == null ? "" : f).trim()).filter(Boolean);
  if (files.length > 12) return { error: "a plan names at most 12 files" };
  const bad = files.filter((f) => !sandboxClaimKey(f));
  if (bad.length) return { error: "plan files must be relative repository paths: " + bad.slice(0, 3).join(", ") };
  return { plan: { title, steps, files } };
}
// The pull-request number or URL a github_pr result carries, for the claim ledger. Tolerates the ops wrapper's nesting.
export function sandboxPrRef(res) {
  const r = res && typeof res === "object" ? (res.result && typeof res.result === "object" ? res.result : res) : {};
  const num = Number(r.number || r.pr || (r.pull_request && r.pull_request.number)) || 0;
  const url = String(r.html_url || r.url || (r.pull_request && r.pull_request.html_url) || "").slice(0, 300);
  return { number: num > 0 ? num : 0, url };
}

// ---- 0.8.2: code_session requests run in their own lane, on the cheapest route.
// Measured 2026-11-05: ten code_session requests (priority low) sat behind the 3-slot, priority-ordered queue of the loop drain and were all shed after 110 minutes
// ("waited over 110 minutes under the daily neuron budget") although the day's budget was 11 percent spent (about 27,000 of 250,000 neurons at 05:42Z): the drain level-loads
// the day (left / ticks-left, one request per 15 minutes at that hour) and a low request never reached the front. BUDGET-SOFT-ROUTE-1: a budget steers a request to
// the cheapest capable route, it does not refuse, defer or skip it. So a code_session request is never shed, never competes for the shared model slots, and is bounded by
// its own caps instead: one start a tick, at most CODE_SESSION_CONCURRENT running, at most a daily number started (ops_config qnfo_agents_code_session_daily), and each
// session runs on dynamic/value with the lean step cap and a small neuron budget.
export const CODE_SESSION_LANE_CHEAP = "cheap";
export const CODE_SESSION_DAILY_DEFAULT = 30;
export const CODE_SESSION_CONCURRENT = 2;
export function sessionLaneStep(step, lane) {
  if (lane !== CODE_SESSION_LANE_CHEAP || !step) return step;
  return Object.assign({}, step, {
    state: step.state === "ok" ? "cheap" : step.state,
    route: CODE_SESSION_ROUTE_CHEAP,
    stubChars: Math.min(step.stubChars, LEAN_OLD_RESULT_CHARS),
    maxSteps: Math.min(step.maxSteps, 8),
    canEscalate: false
  });
}
// ops_config qnfo_agents_code_session_daily: a number, or 'off' / '0' to pause the lane. Anything else is the default.
export function codeSessionDailyCap(value) {
  const v = String(value == null ? "" : value).trim().toLowerCase();
  if (v === "off" || v === "0") return 0;
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 && n <= 500 ? Math.floor(n) : CODE_SESSION_DAILY_DEFAULT;
}
// May the drain start one more code_session request this tick? startedToday and running come from cf_agent_requests.
export function codeSessionLaneAllowed(startedToday, running, cap) {
  const c = Number.isFinite(Number(cap)) ? Number(cap) : CODE_SESSION_DAILY_DEFAULT;
  if (c <= 0) return { start: false, why: "paused (qnfo_agents_code_session_daily is off)" };
  if ((Number(running) || 0) >= CODE_SESSION_CONCURRENT) return { start: false, why: "waiting: " + CODE_SESSION_CONCURRENT + " code sessions are running" };
  if ((Number(startedToday) || 0) >= c) return { start: false, why: "waiting for the next UTC day: " + c + " code sessions already started today" };
  return { start: true, why: "" };
}

// The approval selftest is seeded once per round and retried a bounded number of times: a failed run is tried again after RETRY_MIN minutes, at most
// APPROVAL_SELFTEST_MAX runs in all, and never while one is queued, running or done. rows: { n, live, last } from cf_agent_requests of the round's requester.
export const APPROVAL_SELFTEST_MAX = 3;
export const APPROVAL_SELFTEST_RETRY_MIN = 180;
export function approvalSelftestSeed(rows, nowMs) {
  const n = Number(rows && rows.n) || 0, live = Number(rows && rows.live) || 0;
  if (n === 0) return true;
  if (live > 0 || n >= APPROVAL_SELFTEST_MAX) return false;
  const last = Date.parse(String(rows && rows.last || ""));
  return Number.isFinite(last) && (Number.isFinite(nowMs) ? nowMs : Date.now()) - last >= APPROVAL_SELFTEST_RETRY_MIN * 60000;
}

// ---- SDLC-OWN-1 (owner directive 2026-11-06, issue #8204): the lifecycle block a CodeSession appends to its system prompt.
// Two speeds in one turn: a short first answer (lane:fast), then the full cycle (lane:deep), with the agent acting as the back-end product manager,
// front end and back end named together, and anything unfinished left as an issue plus a draft pull request that any code agent can complete.
export const SDLC_LANE_FAST = "lane:fast";
export const SDLC_LANE_DEEP = "lane:deep";
export const SDLC_LIFECYCLE_PROMPT = [
  "Lifecycle (SDLC-OWN-1). Work in two speeds within the same turn.",
  "Fast lane (" + SDLC_LANE_FAST + "): answer first with the smallest useful, token-friendly result in a few lines, reading outlines or the system map instead of whole files.",
  "Deep lane (" + SDLC_LANE_DEEP + "): straight after, without being asked, own the whole cycle: define (goal, user, metric, acceptance criteria), research (docs, prior art, open issues and PRs, blast radius), design (options, decision, failure modes, rollback), build, test, deploy through the canonical path, verify live, measure, and file the next improvement.",
  "Act as the product manager on the back end: restate the goal and who it serves in one line, name the metric, place it on the roadmap and file the follow-ups you foresee.",
  "Front end and back end ship together: name what the person sees (screen, copy, empty and error states) and what runs (worker, route, D1 table, cron, probe, memory); build both or file the counterpart as an issue with a doer, acceptance criteria and a closing probe.",
  "Write session state, decisions and memory to Cloudflare (D1, R2, KV) so any client can attach and resume; nothing canonical lives in a chat.",
  "Unfinished work becomes an issue (problem, context, paths, acceptance criteria, test plan, code-task line, closing probe) and a draft PR with docs/handoff/<slug>.md, so any code agent can finish it without this conversation. Commit progress as each stage completes.",
  "Before you finish, audit your own output against real results, name what you did not consider, and fix it or file it."
].join("\n");
export function withLifecycle(system) {
  const s = String(system || "");
  return s.indexOf(SDLC_LANE_FAST) >= 0 ? s : s + "\n" + SDLC_LIFECYCLE_PROMPT;
}
