// RM-CODE-SESSION-1, RM-CODE-SANDBOX-1 and RM-DURABLE-INTERRUPT-1 (qnfo-agents 0.8.0), offline. The pure helpers are tested directly; the Durable Object classes need
// the Workers runtime, so the source is pinned by shape and the live proof is the rows the worker writes to D1 (cf_agent_session_usage, cf_agent_sandbox_log,
// cf_agent_approvals) and the closing probes of the three issues.
import { SDLC_LIFECYCLE_PROMPT, SDLC_LANE_FAST, SDLC_LANE_DEEP, withLifecycle } from "./src/session.js";
import { readFileSync } from "node:fs";
import {
  sessionBudgetStep, sessionTurnRoute, sessionBudgetFrom, CODE_SESSION_BUDGET_DEFAULT, CODE_SESSION_ROUTE_CHEAP, CODE_SESSION_ROUTE_ESCALATE, CODE_SESSION_REPLAY_TURNS, CODE_SESSION_REPLAY_REQUESTER, CODE_SESSION_REPLAY_BUDGET, SEED_ROUND, APPROVAL_SELFTEST_REQUESTER,
  sessionLaneStep, codeSessionDailyCap, codeSessionLaneAllowed, approvalSelftestSeed, CODE_SESSION_LANE_CHEAP, CODE_SESSION_DAILY_DEFAULT, CODE_SESSION_CONCURRENT, APPROVAL_SELFTEST_MAX, APPROVAL_SELFTEST_RETRY_MIN,
  sandboxToolClass, sandboxClaimKey, sandboxGate, sandboxPlan, sandboxPrRef
} from "./src/session.js";
import { validateRequest, REQUEST_KINDS, approvalPayload, pendingApprovalMatches, pendingEmailApprovalMatches, emailApprovalPayload, stagedActionArgs, approvalNext, APPROVAL_SUFFIX, OPS_READ_ONLY, LEAN_MAX_STEPS } from "./src/lib.js";

const here = (p) => new URL(p, import.meta.url);
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL " + m); } };

// ---- RM-CODE-SESSION-1: the budget downgrades, it never stops.
const s0 = sessionBudgetStep(0, 100000), s7 = sessionBudgetStep(70000, 100000), s1 = sessionBudgetStep(100000, 100000), s2 = sessionBudgetStep(250000, 100000);
ok(s0.state === "ok" && s0.canEscalate && s0.maxSteps === 16 && s0.route === null, "a fresh session runs on the default route with the full step cap");
ok(s7.state === "watch" && !s7.canEscalate && s7.maxSteps === 10 && s7.stubChars < s0.stubChars, "past 60 percent a session compacts earlier results harder and may no longer escalate");
ok(s1.state === "spent" && s1.route === CODE_SESSION_ROUTE_CHEAP && s1.maxSteps === LEAN_MAX_STEPS, "a spent session drops to the cheapest route with the lean step cap");
ok(s2.state === "spent" && s2.left === 0 && s2.maxSteps > 0, "an overspent session still has a positive step cap: downgraded, never stopped");
ok(sessionBudgetStep(0, 0).left === CODE_SESSION_BUDGET_DEFAULT && sessionBudgetStep(undefined, undefined).state === "ok", "a missing budget falls back to the default");
ok(sessionTurnRoute(s0, false, "R") === "R" && sessionTurnRoute(s0, true, "R") === CODE_SESSION_ROUTE_ESCALATE, "an ok session may escalate one turn to the premium route");
ok(sessionTurnRoute(s7, true, "R") === "R" && sessionTurnRoute(s1, true, "R") === CODE_SESSION_ROUTE_CHEAP, "a session past its watch line cannot escalate, and a spent one is forced to the cheap route");
ok(sessionBudgetFrom(30000) === 30000 && sessionBudgetFrom("x") === CODE_SESSION_BUDGET_DEFAULT && sessionBudgetFrom(5) === CODE_SESSION_BUDGET_DEFAULT && sessionBudgetFrom(9e9) === CODE_SESSION_BUDGET_DEFAULT, "a caller's budget is accepted only inside 1,000 to 1,000,000 neurons");

// the ten replay turns
ok(CODE_SESSION_REPLAY_TURNS.length === 10 && CODE_SESSION_REPLAY_TURNS.every((t) => t.length >= 40 && t.length <= 400), "ten replay turns, each a real sentence");
ok(new Set(CODE_SESSION_REPLAY_TURNS).size === 10, "the ten replay turns are distinct");
ok(CODE_SESSION_REPLAY_TURNS.every((t) => !/\b(delete|drop table|send_email|merge it|write to|github_file_write|github_pr)\b/i.test(t)), "no replay turn asks for a change: they are read-only");
ok(CODE_SESSION_REPLAY_BUDGET > 0 && CODE_SESSION_REPLAY_BUDGET < CODE_SESSION_BUDGET_DEFAULT, "a replay session has a smaller neuron budget than a default session");
ok(/^[A-Za-z0-9][A-Za-z0-9:._-]{1,79}$/.test(CODE_SESSION_REPLAY_REQUESTER), "the replay requester is a valid loop name");

// a code_session request is valid with a prompt, refused without one, and never carries a cron
ok(REQUEST_KINDS.includes("code_session") && REQUEST_KINDS.includes("approval_selftest"), "the queue accepts code_session and approval_selftest");
ok(validateRequest({ kind: "code_session", requester: "rm-code-session-1", prompt: CODE_SESSION_REPLAY_TURNS[0] }).kind === "code_session", "a replay row validates");
ok(!!validateRequest({ kind: "code_session", requester: "rm-code-session-1", prompt: "short" }).error, "a code_session request needs a prompt");
ok(validateRequest({ kind: "approval_selftest", requester: "rm-durable-interrupt-1", prompt: "x" }).kind === "approval_selftest", "the approval selftest needs no model prompt");
ok(!!validateRequest({ kind: "teleport", requester: "x1" }).error && /code_session/.test(validateRequest({ kind: "teleport", requester: "x1" }).error), "an unknown kind is refused with the list of kinds");

// ---- RM-CODE-SANDBOX-1: plan, claim, edit, PR.
ok(sandboxToolClass("workspace_grep") === "read" && sandboxToolClass("fleet_graph") === "read", "read tools are never gated");
ok(sandboxToolClass("github_file_write") === "edit" && sandboxToolClass("workspace_patch") === "edit", "file writers are edits");
ok(sandboxToolClass("github_pr") === "pr" && sandboxToolClass("github_create_branch") === "pr", "branch and pull-request tools are PR steps");
ok(sandboxToolClass("shell_exec") === "change" && sandboxToolClass("kv_put") === "change" && sandboxToolClass("cf_worker_deploy") === "change", "every other changing tool is a gated change");
ok(OPS_READ_ONLY.every((n) => sandboxToolClass(n) === "read"), "the gate and OPS_READ_ONLY agree on what is a read");
ok(sandboxClaimKey("qnfo-ops/worker.js") === "file:qnfo-ops/worker.js" && sandboxClaimKey("./docs/a.md") === "file:docs/a.md" && sandboxClaimKey("/docs/a.md") === "file:docs/a.md", "a repository path becomes a file claim key");
ok(sandboxClaimKey("../etc/passwd") === "" && sandboxClaimKey("a b") === "" && sandboxClaimKey("") === "" && sandboxClaimKey("x".repeat(300)) === "", "a traversal, a space, an empty or an over-long path has no claim key");

const none = { planApproved: false, claims: [], claimed: 0 };
ok(sandboxGate("workspace_grep", { pattern: "x" }, none).allow === true, "a read passes with no plan");
const gEdit0 = sandboxGate("github_file_write", { path: "a.md" }, none);
ok(!gEdit0.allow && gEdit0.need === "plan" && /propose_plan/.test(gEdit0.error), "an edit before an approved plan is refused and says to propose one");
ok(!sandboxGate("shell_exec", { cmd: "ls" }, none).allow && !sandboxGate("kv_put", {}, none).allow, "a shell command and a KV write also wait for the plan");
const approved = { planApproved: true, claims: [], claimed: 0 };
const gEdit1 = sandboxGate("github_file_write", { path: "docs/a.md" }, approved);
ok(gEdit1.allow && gEdit1.claim === "file:docs/a.md", "after approval the first edit of a file must take its claim");
ok(sandboxGate("github_file_write", { path: "docs/a.md" }, { planApproved: true, claims: ["file:docs/a.md"], claimed: 1 }).claim === undefined, "a file already claimed is not claimed again");
ok(!sandboxGate("github_file_write", { path: "../x" }, approved).allow && sandboxGate("github_file_write", { path: "../x" }, approved).need === "path", "an edit with an unusable path is refused before any claim");
const gPr0 = sandboxGate("github_pr", { title: "t" }, approved);
ok(!gPr0.allow && gPr0.need === "claim", "a pull request with no claimed edit is refused");
ok(sandboxGate("github_pr", { title: "t" }, { planApproved: true, claims: ["file:docs/a.md"], claimed: 1 }).allow, "a pull request after a claimed edit passes");
ok(!sandboxGate("github_pr", { title: "t" }, { planApproved: false, claims: ["file:docs/a.md"], claimed: 1 }).allow, "a pull request is still refused while the plan is not approved");

// the whole chain, step by step
{
  const st = { planApproved: false, claims: [], claimed: 0 };
  const steps = [];
  const run = (name, args) => { const d = sandboxGate(name, args, st); steps.push(name + ":" + (d.allow ? (d.claim ? "claim" : "ok") : d.need)); return d; };
  run("workspace_grep", { pattern: "x" });
  run("github_create_branch", { repo: "QNFO/qnfo-workers", branch: "fix" });
  st.planApproved = true;
  const e = run("github_file_write", { path: "docs/a.md" });
  if (e.claim) { st.claims.push(e.claim); st.claimed = st.claims.length; }
  run("github_file_write", { path: "docs/a.md" });
  run("github_pr", { title: "t" });
  ok(steps.join(" ") === "workspace_grep:ok github_create_branch:plan github_file_write:claim github_file_write:ok github_pr:ok", "the chain reads, waits for the plan, claims once, edits, opens the PR: " + steps.join(" "));
}

// plan validation
ok(sandboxPlan({ title: "Fix the typo in docs", steps: ["read the file", "edit line 3"], files: ["docs/README.md"] }).plan.files[0] === "docs/README.md", "a well-formed plan is accepted");
ok(!!sandboxPlan({ title: "x", steps: ["read the file"] }).error && !!sandboxPlan({ title: "Fix the typo in docs", steps: [] }).error, "a short title or no steps is refused");
ok(!!sandboxPlan({ title: "Fix the typo in docs", steps: ["read the file"], files: ["../etc/passwd"] }).error, "a plan file outside the repository is refused");
ok(!!sandboxPlan({ title: "Fix the typo in docs", steps: Array.from({ length: 13 }, (_, i) => "step number " + i) }).error, "more than 12 steps is refused");
ok(sandboxPlan({ title: "  Fix   the typo in docs ", steps: ["  read   the file "] }).plan.title === "Fix the typo in docs", "plan text is whitespace-normalised");
ok(sandboxPrRef({ ok: true, result: { number: 42, html_url: "https://github.com/QNFO/qnfo-workers/pull/42" } }).number === 42 && sandboxPrRef({ number: 7 }).number === 7 && sandboxPrRef(null).number === 0, "the PR number is read from the ops result");

// ---- RM-DURABLE-INTERRUPT-1: the approval program.
ok(APPROVAL_SUFFIX.send_email === "email" && APPROVAL_SUFFIX.staged_action === "staged", "two actions pause for approval");
const sp = approvalPayload("staged_action", "run_a1b2c3d4", "loop:x", { label: "rehearse publish" });
const call = { id: "computer_run_a1b2c3d4_staged", callId: "c1", payload: sp };
ok(pendingApprovalMatches(call, "run_a1b2c3d4", "c1", "loop:x") && pendingApprovalMatches(call, "run_a1b2c3d4", "c1", "loop:x", "staged_action"), "a pending staged step matches its run, call and caller");
ok(!pendingApprovalMatches(call, "run_a1b2c3d4", "c1", "loop:x", "send_email"), "a staged step does not answer as an email send");
ok(!pendingApprovalMatches(call, "run_other", "c1", "loop:x") && !pendingApprovalMatches(call, "run_a1b2c3d4", "c2", "loop:x") && !pendingApprovalMatches(call, "run_a1b2c3d4", "c1", "someone-else"), "another run, call id or caller never matches");
ok(!pendingApprovalMatches({ id: "computer_run_a1b2c3d4_email", callId: "c1", payload: sp }, "run_a1b2c3d4", "c1", "loop:x"), "the execution id must carry the action's own suffix");
ok(!pendingApprovalMatches({ id: "computer_run_a1b2c3d4_staged", callId: "c1", payload: { ...sp, action: "delete_everything" } }, "run_a1b2c3d4", "c1", "loop:x"), "an action outside the approval table never matches");
const ep = emailApprovalPayload("run_a1b2c3d4", "c", { to: "a@b.c" });
ok(ep.action === "send_email" && pendingEmailApprovalMatches({ id: "computer_run_a1b2c3d4_email", callId: "k", payload: ep }, "run_a1b2c3d4", "k", "c"), "the email wrappers still work");
ok(stagedActionArgs({ label: "rehearse publish", note: "n" }).args.label === "rehearse publish" && !!stagedActionArgs({ label: "ab" }).error && !!stagedActionArgs(null).error, "the staging step needs a label of 4 to 120 characters");
ok(Object.keys(stagedActionArgs({ label: "rehearse publish", note: "n", to: "x@y.z", body: "b" }).args).sort().join() === "label,note", "nothing but the label and note reaches the staged payload");
ok(approvalNext("awaiting", "approved") && approvalNext("awaiting", "rejected") && approvalNext("approved", "executed") && approvalNext("approved", "failed") && approvalNext("awaiting", "awaiting"), "the lifecycle moves forward");
ok(!approvalNext("executed", "awaiting") && !approvalNext("rejected", "executed") && !approvalNext("approved", "awaiting") && !approvalNext("failed", "approved") && !approvalNext("bogus", "executed"), "the lifecycle never moves back, and a rejection never executes");

// ---- source shape (the Durable Objects need the runtime)
const ts = readFileSync(here("./src/index.ts"), "utf8");
const toml = readFileSync(here("./wrangler.toml"), "utf8");
ok(/gate\.check\(name, args\)/.test(ts) && /opsCallRaw\(env, name, args\)/.test(ts) && /gate && out && out\.ok/.test(ts), "every ops tool a gated session calls passes the gate before and after (opsCall)");
ok(/opsCall\(c\.env, c\.scope, i\.name, i\.arguments \|\| \{\}, undefined, c\.gate\)/.test(ts) && /opsCall\(c\.env, c\.scope, o\.name, args, undefined, c\.gate\)/.test(ts), "ops_call and the Code Mode ops functions both carry the gate");
ok(/t\.propose_plan = tool\(/.test(ts) && /private gate\(turn: number\): SandboxGate \| undefined[\s\S]{0,200}session\.scope !== "write"/.test(ts), "propose_plan and the gate exist only for a write-scope session");
ok(/async decidePlan\(approved: boolean, caller = ""\)/.test(ts) && /scope !== "write"\) return json\(\{ ok: false, error: "approving a plan/.test(ts), "approving a plan needs the write scope, i.e. a fresh code");
ok(/GUARD\.fetch\("https:\/\/qnfo-deploy-guard\/work-lock\/acquire"/.test(ts) && /\[\[services\]\]\s*\nbinding = "GUARD"\s*\nservice = "qnfo-deploy-guard"/.test(toml), "work claims go through a qnfo-deploy-guard service binding");
ok(/unreachable\("GUARD service binding missing"\)/.test(ts) && /CLAIM-UNREACHABLE-FALLBACK-1/.test(ts), "an unreachable claim service is recorded, not silently skipped");
ok(/INSERT INTO cf_agent_sandbox_log/.test(ts) && /"denied"/.test(ts) && /"plan_approved" : "plan_rejected"/.test(ts), "the gate decisions are mirrored to cf_agent_sandbox_log");
ok(/INSERT OR IGNORE INTO cf_agent_session_usage[\s\S]{0,300}'failed'/.test(ts), "a failed CodeSession turn writes a failed usage row and never overwrites a done one");
ok(/prepareStep: \(\{ messages \}: any\) => \(\{ messages: compactMessages\(messages, step\.stubChars\) \}\)/.test(ts) && /stopWhen: stepCountIs\(step\.maxSteps\)/.test(ts), "a CodeSession compacts earlier tool results and caps its steps from the budget step");
ok(/await meter\(this\.env, routeId, \{ i: inputTokens, o: outputTokens, n: steps \+ 1/.test(ts), "a CodeSession's tokens are metered into ai_spend_ledger, so the daily neuron budget sees them");
ok(/this\.event\("budget", \{ turn, state: step\.state/.test(ts), "the stream announces the budget state of each turn");
ok(/startSession\(\{ text: q\.prompt, scope: "read", caller: "loop:" \+ q\.requester, budget: CODE_SESSION_REPLAY_BUDGET, lane: CODE_SESSION_LANE_CHEAP \}\)/.test(ts), "the code_session lane starts a read-scope CodeSession on the cheap lane");
ok(/async function seedMeasurements/.test(ts) && /qnfo_agents_replay/.test(ts) && /SUM\(status IN \('queued', 'running', 'done'\)\) AS live, MAX\(finished_at\) AS last FROM cf_agent_requests WHERE requester = \?1 AND kind = \?2/.test(ts) && /AUDIT_DB\.batch\(CODE_SESSION_REPLAY_TURNS\.map/.test(ts) && /approvalSelftestSeed\(await tally\(APPROVAL_SELFTEST_REQUESTER, "approval_selftest"\), Date\.now\(\)\)/.test(ts), "the replay seeds once per round (ten turns in one atomic batch) and the selftest is retried a bounded number of times, behind an off switch");
ok(/this\.ctx\.abort\("RM-DURABLE-INTERRUPT-1 selftest: forced restart"\)/.test(ts) && /async function approvalSelftest/.test(ts) && /restart_survived/.test(ts), "the selftest forces a Durable Object reset and records that the pause survived it");
ok(/t\.stage_irreversible_step = tool\(/.test(ts) && /c\.scope === "write" && c\.runId/.test(ts), "the staging tool is write-scope and run-bound");
ok(/path === "\/approvals" && request\.method === "GET"\) return scope === "write"/.test(ts) && /approved: true\|false/.test(ts), "the approvals routes need the write scope");
ok(!/stagedAction: async \(input: any\) => \{[\s\S]{0,700}opsCall/.test(ts) && /stagedAction: async \(input: any\) => \{/.test(ts), "the staged step never calls an ops tool: it sends nothing");

// ---- 0.8.2: the code_session lane (the ten replay turns were shed unrun).
ok(SEED_ROUND === "r2" && CODE_SESSION_REPLAY_REQUESTER === "rm-code-session-1.r2" && APPROVAL_SELFTEST_REQUESTER === "rm-durable-interrupt-1.r2", "round r2 seeds new requesters: the shed rows and the failed selftest of round one stay as history");
ok(/^[A-Za-z0-9][A-Za-z0-9:._-]{1,79}$/.test(APPROVAL_SELFTEST_REQUESTER), "the selftest requester is a valid loop name");
const base = sessionBudgetStep(0, 30000);
const cheap = sessionLaneStep(base, CODE_SESSION_LANE_CHEAP);
ok(cheap.route === CODE_SESSION_ROUTE_CHEAP && cheap.state === "cheap" && cheap.maxSteps <= 8 && cheap.stubChars < base.stubChars && cheap.canEscalate === false, "a cheap-lane session runs on dynamic/value, with a lean step cap and compaction, and cannot escalate");
ok(sessionLaneStep(base, "") === base && sessionLaneStep(base, undefined) === base, "a session without the lane is untouched");
ok(sessionLaneStep(sessionBudgetStep(40000, 30000), CODE_SESSION_LANE_CHEAP).state === "spent" && sessionLaneStep(sessionBudgetStep(40000, 30000), CODE_SESSION_LANE_CHEAP).maxSteps > 0, "a spent cheap session keeps running (downgraded, never stopped)");
ok(sessionTurnRoute(cheap, true, "R") === CODE_SESSION_ROUTE_CHEAP, "an escalate flag cannot lift a cheap-lane turn off the cheap route");
ok(codeSessionDailyCap(undefined) === CODE_SESSION_DAILY_DEFAULT && codeSessionDailyCap("12") === 12 && codeSessionDailyCap("off") === 0 && codeSessionDailyCap("0") === 0 && codeSessionDailyCap("junk") === CODE_SESSION_DAILY_DEFAULT && codeSessionDailyCap("9999") === CODE_SESSION_DAILY_DEFAULT, "the daily cap is a number of 1 to 500, off pauses, junk falls back to the default");
ok(codeSessionLaneAllowed(0, 0, 30).start === true && codeSessionLaneAllowed(null, null, 30).start === true, "an idle lane starts a session");
ok(codeSessionLaneAllowed(3, CODE_SESSION_CONCURRENT, 30).start === false && /running/.test(codeSessionLaneAllowed(3, CODE_SESSION_CONCURRENT, 30).why), "at most CODE_SESSION_CONCURRENT sessions run at once");
ok(codeSessionLaneAllowed(30, 0, 30).start === false && /next UTC day/.test(codeSessionLaneAllowed(30, 0, 30).why), "the daily cap stops the lane (the replay cannot run away) and says when it resumes");
ok(codeSessionLaneAllowed(0, 0, 0).start === false && /paused/.test(codeSessionLaneAllowed(0, 0, 0).why), "a cap of 0 pauses the lane");
{
  // the replay finishes inside the lane: 10 requests, one start a tick, cap 30 -> all ten start within ten ticks and the lane never exceeds 2 running
  let started = 0, running = 0, maxRunning = 0;
  for (let tick = 0; tick < 10; tick++) {
    if (running > 0 && tick % 2 === 1) running = 0; // sessions finish within two ticks in this model
    const g = codeSessionLaneAllowed(started, running, 30);
    if (g.start) { started++; running++; maxRunning = Math.max(maxRunning, running); }
  }
  ok(started === 10 && maxRunning <= CODE_SESSION_CONCURRENT, "ten replay requests all start within ten ticks and never more than two run at once: started " + started + ", max running " + maxRunning);
}
const NOW = Date.UTC(2026, 10, 5, 12, 0, 0);
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");
ok(approvalSelftestSeed({ n: 0, live: 0, last: null }, NOW) === true && approvalSelftestSeed(undefined, NOW) === true, "a round with no selftest seeds one");
ok(approvalSelftestSeed({ n: 1, live: 1, last: null }, NOW) === false, "a queued, running or done selftest is never seeded again");
ok(approvalSelftestSeed({ n: 1, live: 0, last: iso(NOW - 60 * 60000) }, NOW) === false, "a failed selftest waits before a retry");
ok(approvalSelftestSeed({ n: 1, live: 0, last: iso(NOW - (APPROVAL_SELFTEST_RETRY_MIN + 1) * 60000) }, NOW) === true, "a failed selftest is retried after the wait");
ok(approvalSelftestSeed({ n: APPROVAL_SELFTEST_MAX, live: 0, last: iso(NOW - 24 * 3600000) }, NOW) === false, "the retries are bounded");
ok(approvalSelftestSeed({ n: 1, live: 0, last: null }, NOW) === false, "a failed row with no finish time is not retried blindly");

// source shape of the lane
ok(/async function drainCodeSessions\(env: Env, out: any\)/.test(ts) && /await drainCodeSessions\(env, out\);\s*return out;/.test(ts), "the drain runs the code_session lane after the shared queue");
ok(/status = 'queued' AND COALESCE\(kind, 'run'\) != 'code_session' ORDER BY CASE priority/.test(ts), "the shared priority queue no longer carries code_session requests");
ok(/COALESCE\(kind, 'run'\) = 'run' AND created_at < strftime/.test(ts) && !/COALESCE\(kind, 'run'\) IN \('run', 'code_session'\)/.test(ts), "a code_session request is never shed");
ok(/sessionLaneStep\(sessionBudgetStep\(session\.neurons_used, session\.neuron_budget\), session\.lane\)/.test(ts) && /ALTER TABLE code_session ADD COLUMN lane/.test(ts), "the session reads its lane");
ok(/meterSteps\(this\.env, this\.name \+ "-t" \+ turn, routeId, \{ steps: await out\.steps \}\)/.test(ts), "a CodeSession writes per-step cache telemetry too");
ok(/bgError = errText\(e\)/.test(ts) && /the staged step failed before its interrupt/.test(ts), "the selftest reports why a staged step failed before its interrupt");

console.log("qnfo-agents code-session.test: " + pass + " passed, " + fail + " failed");
// SDLC-OWN-1 (#8204): the lifecycle prompt block carries both lanes, the PM and front/back-end pairing, and the handoff, and is added once.
{
  const assert = (await import("node:assert/strict")).default;
  for (const w of [SDLC_LANE_FAST, SDLC_LANE_DEEP, "product manager", "Front end and back end", "draft PR", "docs/handoff/"]) assert.ok(SDLC_LIFECYCLE_PROMPT.includes(w), "lifecycle prompt names " + w);
  const once = withLifecycle("base");
  assert.ok(once.startsWith("base\n") && once.includes(SDLC_LANE_DEEP));
  assert.equal(withLifecycle(once), once, "adding the block twice changes nothing");
  assert.ok(withLifecycle("quoted lane:fast label").includes("Lifecycle (SDLC-OWN-1)"), "a prompt that merely mentions lane:fast still gets the block");
  console.log("ok sdlc lifecycle prompt");
}

// SDLC-OWN-1 (#8209): every system prompt the agents send goes through withLifecycle, so a turn carries lane:fast and lane:deep.
{
  const assert = (await import("node:assert/strict")).default;
  const src = readFileSync(new URL("./src/index.ts", import.meta.url), "utf8");
  assert.ok(src.includes("const CODE_SESSION_SYSTEM = withLifecycle(SYSTEM);"), "CodeSession system prompt is wrapped");
  assert.equal((src.match(/system: withLifecycle\(SYSTEM\) \+/g) || []).length, 2, "both FleetCodeAgent generateText calls are wrapped");
  assert.equal((src.match(/system: SYSTEM \+/g) || []).length, 0, "no bare SYSTEM prompt is left");
  assert.ok(src.length>0);
  const { SDLC_LIFECYCLE_PROMPT: P } = await import("./src/session.js");
  assert.ok(P.includes("Code is the only output") && P.includes("Audit your own work"), "self-audit and code-is-output rules present");
  console.log("ok sdlc lifecycle wired");
}
process.exit(fail ? 1 : 0);

