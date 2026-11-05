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
export const CODE_SESSION_REPLAY_REQUESTER = "rm-code-session-1";
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
