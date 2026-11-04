// GITHUB-SETTINGS-ACTIONS-1 offline suite (scripts/github-settings-actions.mjs, agent_issues 2927). No network: a fake GitHub.
// Proves: a refusal is recorded with its status and GitHub's own text and the run is not retried with another credential; dry mode
// writes nothing; live refuses while a required check would never report (the version-bump-guard path filter, an unseen context) or an
// app cannot be resolved; live creates, updates (idempotently) and reverts only the ruleset named main-gate; secret scanning is one PATCH
// per feature and a refusal of one is a recorded limitation; only QNFO/qnfo-workers paths are reachable; a missing credential is a
// refusal and not a write; the committed ruleset config names checks that real pull_request jobs produce.
// WORKFLOW-SCRIPT-FIXES-1 adds: the two core secret protections decide a secret-scanning run's verdict (plan-gated extras are limitations, not a red run);
// the github-actions app (15368) is refused as a bypass actor by id or slug in dry and live alike, and the committed config no longer lists it; a workflow
// comment line that mentions a push to main is not a push path.
// Run: node --no-warnings scripts/github-settings-actions.test.mjs   -> prints "N passed, 0 failed"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { run, makeApi, workflowChecks, workflowPushPaths, checkProblems, buildRuleset, rulesetDiff, activityActors, unlistedPushers, loadConfig, isActionsApp, ACTIONS, SECRET_FEATURES, SECRET_CORE_FEATURES, GITHUB_ACTIONS_APP_ID } from "./github-settings-actions.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 500) : "")); } };

// ---- a fake GitHub ----
function fakeGitHub(opts = {}) {
  const st = {
    rulesets: opts.rulesets || [{ id: 25060446, name: "main-safety", enforcement: "active", rules: [{ type: "deletion" }, { type: "non_fast_forward" }], bypass_actors: [] }],
    sa: Object.assign({ secret_scanning: { status: "enabled" }, secret_scanning_push_protection: { status: "disabled" }, secret_scanning_validity_checks: { status: "disabled" }, secret_scanning_non_provider_patterns: { status: "disabled" } }, opts.sa || {}),
    log: [], tokens: new Set(), runs: (opts.runs || []).slice()
  };
  const json = (status, body) => ({ status, text: async () => (body === undefined ? "" : JSON.stringify(body)) });
  const fetchImpl = async (url, init) => {
    const method = init.method || "GET";
    const path = url.replace("https://api.github.com", "");
    st.log.push({ method, path, auth: init.headers.Authorization });
    st.tokens.add(init.headers.Authorization);
    if (opts.admin403 && /branches\/main\/protection|\/rulesets|installations/.test(path) && method !== "GET") return json(403, { message: "Resource not accessible by integration", documentation_url: "https://docs.github.com/rest/repos/rules" });
    if (opts.read403 && /branches\/main\/protection/.test(path)) return json(403, { message: "Resource not accessible by integration" });
    let m;
    if (method === "GET" && path === "/repos/QNFO/qnfo-workers") return json(200, { permissions: { admin: true }, security_and_analysis: opts.noSa ? null : st.sa });
    if (method === "PATCH" && path === "/repos/QNFO/qnfo-workers") {
      const f = Object.keys(init.body ? JSON.parse(init.body).security_and_analysis : {})[0];
      if (opts.refuse && opts.refuse.includes(f)) return json(422, { message: "Validation Failed", errors: [{ message: f + " requires GitHub Secret Protection" }] });
      st.sa[f] = { status: "enabled" }; return json(200, {});
    }
    if (method === "GET" && /\/branches\/main\/protection$/.test(path)) return json(404, { message: "Branch not protected" });
    if (method === "GET" && path === "/repos/QNFO/qnfo-workers/rulesets") return json(200, st.rulesets.map((r) => ({ id: r.id, name: r.name, enforcement: r.enforcement })));
    if (method === "GET" && (m = /\/rulesets\/(\d+)$/.exec(path))) { const r = st.rulesets.find((x) => String(x.id) === m[1]); return r ? json(200, r) : json(404, { message: "Not Found" }); }
    if (method === "POST" && path === "/repos/QNFO/qnfo-workers/rulesets") { const b = JSON.parse(init.body); st.rulesets.push({ id: 777, ...b }); return json(201, { id: 777 }); }
    if (method === "PUT" && (m = /\/rulesets\/(\d+)$/.exec(path))) { const i = st.rulesets.findIndex((x) => String(x.id) === m[1]); st.rulesets[i] = { id: Number(m[1]), ...JSON.parse(init.body) }; return json(200, {}); }
    if (method === "DELETE" && (m = /\/rulesets\/(\d+)$/.exec(path))) { st.rulesets = st.rulesets.filter((x) => String(x.id) !== m[1]); return json(204); }
    if (method === "GET" && path === "/repos/QNFO/qnfo-workers/rules/branches/main") return json(200, st.rulesets.filter((r) => r.enforcement === "active").flatMap((r) => r.rules.map((x) => ({ type: x.type, ruleset_id: r.id }))));
    if (method === "GET" && path.startsWith("/repos/QNFO/qnfo-workers/vulnerability-alerts")) return json(204);
    if (method === "GET" && path.startsWith("/repos/QNFO/qnfo-workers/automated-security-fixes")) return json(200, { enabled: true });
    if (method === "GET" && path === "/apps/qnfo-fleet") return opts.noFleetApp || opts.appsViaInstallations ? json(404, { message: "Not Found" }) : json(200, { id: 424242, slug: "qnfo-fleet" });
    if (method === "GET" && path.startsWith("/orgs/QNFO/installations")) return json(200, { installations: opts.noFleetApp ? [] : [{ app_slug: "qnfo-fleet", app_id: 424242 }] });
    if (method === "GET" && path.startsWith("/repos/QNFO/qnfo-workers/pulls?")) return json(200, [{ head: { sha: "aaa" } }, { head: { sha: "bbb" } }]);
    if (method === "GET" && /\/commits\/(aaa|bbb)\/check-runs/.test(path)) return json(200, { check_runs: (opts.contexts || ["gate", "version-bump-guard / guard", "mirror-guard / mirror-guard", "identity-guard / identity-guard", "CodeQL"]).map((name) => ({ name })) });
    if (method === "GET" && path.startsWith("/repos/QNFO/qnfo-workers/activity?")) return json(200, [
      ...Array.from({ length: 3 }, () => ({ activity_type: "push", actor: { login: "github-actions[bot]" } })),
      { activity_type: "pr_merge", actor: { login: "qnfo-fleet[bot]" } }, { activity_type: "push", actor: { login: "qnfo-fleet[bot]" } },
      { activity_type: "pr_merge", actor: { login: "rwnq8" } }, ...(opts.stranger ? [{ activity_type: "push", actor: { login: "someone-else" } }] : [])]);
    if (method === "GET" && (m = /^\/repos\/QNFO\/qnfo-workers\/actions\/runs\?status=(queued|in_progress)&per_page=100&page=(\d+)$/.exec(path))) {
      if (opts.runsList403) return json(403, { message: "Resource not accessible by integration" });
      const rows = st.runs.filter((x) => x.status === m[1]).map(({ jobs, ...x }) => x);
      const start = (Number(m[2]) - 1) * 100;
      return json(200, { total_count: rows.length, workflow_runs: rows.slice(start, start + 100) });
    }
    if (method === "GET" && (m = /\/actions\/runs\/(\d+)\/jobs/.exec(path))) {
      const x = st.runs.find((y) => String(y.id) === m[1]);
      if (!x) return json(404, { message: "Not Found" });
      if (x.jobs === null) return json(500, { message: "Server Error" });
      return json(200, { total_count: x.jobs.length, jobs: x.jobs });
    }
    // GitHub deletes only a run that has completed (run 40290472819, 2026-10-26: 403 "Could not delete the workflow run" for queued and wedged runs)
    if (method === "POST" && (m = /\/actions\/runs\/(\d+)\/force-cancel$/.exec(path))) {
      if (opts.forceCancelRefuse) return json(403, { message: "Resource not accessible by integration" });
      if (opts.forceCancelNotRunning && opts.forceCancelNotRunning.includes(Number(m[1]))) { const y = st.runs.find((z) => String(z.id) === m[1]); if (y) { y.status = "completed"; y.conclusion = "cancelled"; } return json(409, { message: "Cannot cancel a workflow run that is not in progress." }); }
      if (opts.forceCancelWedged && opts.forceCancelWedged.includes(Number(m[1]))) return json(409, { message: "Cannot cancel a workflow run that has not been queued yet." });
      const x = st.runs.find((y) => String(y.id) === m[1]);
      if (!x) return json(404, { message: "Not Found" });
      if (!opts.forceCancelStaysQueued) { x.status = "completed"; x.conclusion = "cancelled"; }
      return json(202, {});
    }
    if (method === "GET" && (m = /\/actions\/runs\/(\d+)$/.exec(path))) {
      const x = st.runs.find((y) => String(y.id) === m[1]);
      return x ? json(200, { id: x.id, status: x.status, conclusion: x.conclusion || null }) : json(404, { message: "Not Found" });
    }
    if (method === "DELETE" && (m = /\/actions\/runs\/(\d+)$/.exec(path))) {
      if (opts.deleteRefuse) return json(403, { message: "Could not delete the workflow run" });
      const x = st.runs.find((y) => String(y.id) === m[1]);
      if (x && x.status !== "completed") return json(403, { message: "Could not delete the workflow run" });
      st.runs = st.runs.filter((y) => String(y.id) !== m[1]);
      return json(204);
    }
    return json(404, { message: "Not Found" });
  };
  return { fetchImpl, st };
}

// ---- a synthetic workflow tree ----
const wfRoot = mkdtempSync(join(tmpdir(), "gh-settings-"));
mkdirSync(join(wfRoot, ".github", "workflows"), { recursive: true });
mkdirSync(join(wfRoot, "scripts"), { recursive: true });
const wf = (name, text) => writeFileSync(join(wfRoot, ".github", "workflows", name), text);
wf("deploy-gate.yml", "name: deploy-gate\non:\n  push:\n    branches: [main]\n  pull_request:\n    branches: [main]\njobs:\n  gate:\n    runs-on: ubuntu-latest\n    steps: []\n");
wf("version-bump-guard.yml", "name: version-bump-guard\non:\n  push:\n    branches: [main]\n  workflow_call:\njobs:\n  guard:\n    runs-on: ubuntu-latest\n    steps: []\n");
wf("mirror-guard.yml", "name: mirror-guard\n# comment\non:\n  push:\n    branches: [main]\n  # comment inside\n  workflow_call:\n  workflow_dispatch:\njobs:\n  mirror-guard:\n    runs-on: ubuntu-latest\n    steps: []\n");
wf("identity-guard.yml", "name: identity-guard\non:\n  workflow_call:\njobs:\n  identity-guard:\n    name: identity-guard\n    runs-on: ubuntu-latest\n    steps: []\n");
const prChecks = (trigger) => "name: pr-checks\non:\n" + trigger + "jobs:\n  version-bump-guard:\n    uses: ./.github/workflows/version-bump-guard.yml\n  mirror-guard:\n    uses: ./.github/workflows/mirror-guard.yml\n  identity-guard:\n    uses: ./.github/workflows/identity-guard.yml\n";
wf("pr-checks.yml", prChecks("  pull_request:\n    paths:\n      - '*/worker.js'\n"));
const cfg = JSON.parse(readFileSync(join(repoRoot, "scripts", "github-main-ruleset.json"), "utf8"));
writeFileSync(join(wfRoot, "scripts", "github-main-ruleset.json"), JSON.stringify(cfg));

// workflow check detection
const wc = workflowChecks(wfRoot);
ok(wc.find((w) => w.context === "version-bump-guard / guard").filtered === true && wc.find((w) => w.context === "gate").filtered === false, "a pull_request paths filter is detected, a branches filter is not", wc);
ok(wc.find((w) => w.context === "mirror-guard / mirror-guard").onPr && wc.find((w) => w.context === "identity-guard / identity-guard").onPr, "a trigger block with comments and a job name still resolves");
let pr = checkProblems(cfg, wfRoot);
ok(pr.length === 3 && pr.every((x) => /paths filter/.test(x)), "the path-filtered caller makes its three guard checks problems: " + pr.join(" | "));
wf("pr-checks.yml", prChecks("  pull_request:\n"));
ok(checkProblems(cfg, wfRoot).length === 0, "the same workflow without a pull_request paths filter has no problem");
ok(checkProblems({ ...cfg, required_checks: ["gate", "nonesuch"] }, wfRoot).some((p) => /nonesuch.*no workflow job/.test(p)), "a check no job produces is a problem");

// the real repository: the committed config names checks real pull_request jobs always produce
const real = checkProblems(loadConfig(repoRoot), repoRoot);
ok(real.length === 0, "the committed config's required checks are produced by unfiltered pull_request workflows in this repository", real);
ok(JSON.stringify(loadConfig(repoRoot).required_checks) === JSON.stringify(["gate", "version-bump-guard / guard", "mirror-guard / mirror-guard", "identity-guard / identity-guard"]), "the declared checks are the four named in agent_issues 2927");

// payload
const desired = buildRuleset(cfg, [{ slug: "qnfo-fleet", actor_id: 424242 }]);
ok(desired.name === "main-gate" && desired.enforcement === "active" && desired.conditions.ref_name.include[0] === "~DEFAULT_BRANCH", "the ruleset targets the default branch by name main-gate");
ok(desired.rules.map((r) => r.type).join() === "deletion,non_fast_forward,pull_request,required_status_checks", "rules: no deletion, no force push, pull request, required checks");
const rsc = desired.rules.find((r) => r.type === "required_status_checks").parameters;
ok(rsc.required_status_checks.map((c) => c.context).join() === "gate,version-bump-guard / guard,mirror-guard / mirror-guard,identity-guard / identity-guard" && rsc.strict_required_status_checks_policy === false, "the four contexts, not strict (strict would stall every PR whenever main moves)");
ok(desired.rules.find((r) => r.type === "pull_request").parameters.required_approving_review_count === 0, "no approving review is required (one account authors every pull request)");
ok(desired.bypass_actors.some((b) => b.actor_type === "RepositoryRole" && b.actor_id === 5) && desired.bypass_actors.some((b) => b.actor_id === 424242 && b.actor_type === "Integration") && desired.bypass_actors.every((b) => b.bypass_mode === "always") && desired.bypass_actors.length === 2, "the admin role and the fleet app bypass, nothing else", desired.bypass_actors);
ok(rulesetDiff(null, desired)[0].startsWith("absent") && rulesetDiff(JSON.parse(JSON.stringify(desired)), desired).length === 0 && rulesetDiff({ ...desired, enforcement: "disabled" }, desired).length === 1, "rulesetDiff: absent, equal, one change");
const actors = activityActors([{ activity_type: "push", actor: { login: "github-actions[bot]" } }, { activity_type: "pr_merge", actor: { login: "rwnq8" } }, { activity_type: "push", actor: { login: "github-actions[bot]" } }, { activity_type: "push", actor: { login: "intruder" } }]);
ok(actors["github-actions[bot]"].push === 2 && actors.rwnq8.pr_merge === 1 && unlistedPushers(actors, cfg).join() === "intruder", "activityActors counts by pusher and kind; unlistedPushers names a direct pusher nobody listed (a merger is not one)", actors);

// ---- report: refusal recorded verbatim ----
let g = fakeGitHub({ read403: true });
let res = await run("report", "dry", wfRoot, g.fetchImpl, { GITHUB_TOKEN: "ghs_session" });
const prot = res.matrix.find((x) => x.call === "GET branches/main/protection");
ok(prot.status === 403 && prot.message === "Resource not accessible by integration" && res.classic_protection === "unreadable" && /^no: /.test(res.token_can_administer), "report records the refused call with its status and GitHub's own words", prot);
ok(res.credential === "GITHUB_TOKEN" && res.contexts_seen_on_recent_pr_heads.gate === 2 && res.rules_on_main.join() === "deletion,non_fast_forward" && res.pushers_last_100["github-actions[bot]"].push === 3 && res.unlisted_direct_pushers.length === 0, "report reads the rules, the contexts seen and the pushers of main", res);
ok(g.st.log.every((c) => c.method === "GET"), "report only reads");
g = fakeGitHub();
res = await run("report", "dry", wfRoot, g.fetchImpl, { GH_ADMIN_TOKEN: "pat_admin", GITHUB_TOKEN: "ghs_x" });
ok(res.credential === "QNFO_GH_PAT" && res.classic_protection === "absent" && /^yes: /.test(res.token_can_administer) && res.org_apps.join() === "qnfo-fleet:424242", "with the admin credential the report says it can administer and lists the org apps");
ok(g.st.tokens.size === 1 && [...g.st.tokens][0] === "Bearer pat_admin", "one credential per run, the admin one when set");

// ---- ruleset-main ----
wf("pr-checks.yml", prChecks("  pull_request:\n    paths:\n      - '*/worker.js'\n"));
g = fakeGitHub();
res = await run("ruleset-main", "live", wfRoot, g.fetchImpl, { GH_ADMIN_TOKEN: "pat_admin" });
ok(!res.ok && res.problems.some((p) => /guard.*paths filter/.test(p)) && !g.st.log.some((c) => c.method !== "GET") && /live refused/.test(res.note), "live refuses and writes nothing while a required check is path-filtered", res.problems);
wf("pr-checks.yml", prChecks("  pull_request:\n"));
g = fakeGitHub({ contexts: ["gate", "mirror-guard / mirror-guard", "identity-guard / identity-guard"] });
res = await run("ruleset-main", "live", wfRoot, g.fetchImpl, { GH_ADMIN_TOKEN: "pat_admin" });
ok(!res.ok && res.problems.some((p) => /version-bump-guard . guard. was not seen/.test(p)) && !g.st.log.some((c) => c.method !== "GET"), "live refuses while a required context was never seen on a recent pull request head");
g = fakeGitHub({ noFleetApp: true });
res = await run("ruleset-main", "live", wfRoot, g.fetchImpl, { GH_ADMIN_TOKEN: "pat_admin" });
ok(!res.ok && res.problems.some((p) => /qnfo-fleet/.test(p) && /lock that app out/.test(p)) && !g.st.log.some((c) => c.method !== "GET"), "live refuses while the code loop's app cannot be resolved (it would lock the loop out of main)");
g = fakeGitHub({ appsViaInstallations: true });
res = await run("ruleset-main", "dry", wfRoot, g.fetchImpl, { GH_ADMIN_TOKEN: "pat_admin" });
ok(res.ok && res.desired.bypass_actors.some((b) => b.actor_id === 424242), "the app id falls back to the org installations when the public app lookup fails");
g = fakeGitHub({ stranger: true });
res = await run("ruleset-main", "live", wfRoot, g.fetchImpl, { GH_ADMIN_TOKEN: "pat_admin" });
ok(!res.ok && res.problems.some((p) => /someone-else/.test(p) && /would block it/.test(p)) && !g.st.log.some((c) => c.method !== "GET"), "live refuses while an unlisted actor pushes directly to main (the ruleset would block it)");
g = fakeGitHub();
res = await run("ruleset-main", "dry", wfRoot, g.fetchImpl, { GH_ADMIN_TOKEN: "pat_admin" });
ok(res.ok && res.problems.length === 0 && res.diff[0].startsWith("absent") && !g.st.log.some((c) => c.method !== "GET") && res.desired.bypass_actors.length === 2 && !res.desired.bypass_actors.some((b) => b.actor_id === 15368), "dry run is clean, shows the diff and writes nothing, and carries no github-actions bypass actor", res);
res = await run("ruleset-main", "live", wfRoot, g.fetchImpl, { GH_ADMIN_TOKEN: "pat_admin" });
ok(res.ok && res.write.status === 201 && res.rules_on_main_after.includes("required_status_checks") && res.rules_on_main_after.includes("pull_request") && g.st.rulesets.length === 2 && g.st.rulesets[0].name === "main-safety", "live creates main-gate beside main-safety and reads the rules back", res);
const before = g.st.log.length;
res = await run("ruleset-main", "live", wfRoot, g.fetchImpl, { GH_ADMIN_TOKEN: "pat_admin" });
ok(res.ok && /already matches/.test(res.note) && !g.st.log.slice(before).some((c) => c.method !== "GET"), "a second live run is a no-op");
g.st.rulesets.find((r) => r.name === "main-gate").enforcement = "disabled";
res = await run("ruleset-main", "live", wfRoot, g.fetchImpl, { GH_ADMIN_TOKEN: "pat_admin" });
ok(res.ok && res.write.call.startsWith("PUT rulesets/777") && g.st.rulesets.find((r) => r.name === "main-gate").enforcement === "active", "a drifted ruleset is updated in place (PUT), not duplicated");
res = await run("ruleset-main-revert", "dry", wfRoot, g.fetchImpl, { GH_ADMIN_TOKEN: "pat_admin" });
ok(res.ok && /would delete ruleset 777/.test(res.note) && g.st.rulesets.length === 2, "revert dry run deletes nothing");
res = await run("ruleset-main-revert", "live", wfRoot, g.fetchImpl, { GH_ADMIN_TOKEN: "pat_admin" });
ok(res.ok && res.delete.status === 204 && g.st.rulesets.length === 1 && g.st.rulesets[0].name === "main-safety", "revert live deletes main-gate and never main-safety");

// ---- the github-actions app is not a bypass actor (WORKFLOW-SCRIPT-FIXES-1) ----
ok(isActionsApp({ slug: "github-actions" }) && isActionsApp({ slug: "github-actions[bot]" }) && isActionsApp({ slug: "renamed", actor_id: 15368 }) && isActionsApp({ slug: "x", actor_id: "15368" }) && !isActionsApp({ slug: "qnfo-fleet", actor_id: 424242 }) && !isActionsApp({ slug: "qnfo-fleet" }) && GITHUB_ACTIONS_APP_ID === 15368, "isActionsApp: by slug, by slug with [bot], by id 15368 (number or string); the fleet app is not");
ok(!JSON.stringify(loadConfig(repoRoot).bypass.integrations).includes("15368") && !loadConfig(repoRoot).bypass.integrations.some(isActionsApp) && loadConfig(repoRoot).bypass.integrations.some((i) => i.slug === "qnfo-fleet"), "the committed ruleset config lists no github-actions bypass actor and still lists the fleet app");
for (const mode of ["dry", "live"]) {
  for (const entry of [{ slug: "github-actions", actor_id: 15368, why: "x" }, { slug: "github-actions", actor_id: null }, { slug: "ci", actor_id: 15368 }]) {
    const root2 = mkdtempSync(join(tmpdir(), "gh-settings-ia-"));
    mkdirSync(join(root2, ".github"), { recursive: true });
    mkdirSync(join(root2, "scripts"), { recursive: true });
    cpSync(join(wfRoot, ".github"), join(root2, ".github"), { recursive: true });
    const withActions = JSON.parse(JSON.stringify(cfg));
    withActions.bypass.integrations = [entry, ...withActions.bypass.integrations];
    writeFileSync(join(root2, "scripts", "github-main-ruleset.json"), JSON.stringify(withActions));
    g = fakeGitHub();
    res = await run("ruleset-main", mode, root2, g.fetchImpl, { GH_ADMIN_TOKEN: "pat_admin" });
    ok(res.problems.some((p) => /refused by GitHub/.test(p) && /422/.test(p) && (entry.actor_id ? p.includes(String(entry.actor_id)) : /github-actions/.test(p))) && !res.desired.bypass_actors.some((b) => b.actor_id === 15368), "ruleset-main " + mode + ": a configured github-actions entry (" + JSON.stringify(entry) + ") is a problem before any write, and is not in the payload", res.problems);
    ok(!g.st.log.some((c) => c.method !== "GET") && (mode === "dry" ? res.ok === true && /problem\(s\) block live/.test(res.note) : !res.ok && /live refused/.test(res.note)), "ruleset-main " + mode + ": nothing is written (dry reports the problem, live refuses)", res.note);
    rmSync(root2, { recursive: true, force: true });
  }
}

// ---- a comment line is not a push path ----
const pushRoot = mkdtempSync(join(tmpdir(), "gh-settings-pp-"));
mkdirSync(join(pushRoot, ".github", "workflows"), { recursive: true });
writeFileSync(join(pushRoot, ".github", "workflows", "p.yml"), "name: p\n# the old step ran a bare `git push origin HEAD:main` here\n  #   git push origin main  (indented comment)\njobs:\n  j:\n    steps:\n      - run: |\n          # git push origin main is documented above\n          git push origin HEAD:main\n      - run: git push origin feature\n");
const pp = workflowPushPaths(pushRoot);
ok(pp.length === 1 && pp[0].workflow === "p.yml" && pp[0].line === 9 && /^git push origin HEAD:main$/.test(pp[0].snippet), "only the real push to main is a push path; comment lines (also indented and inside a run block) and a push to another branch are not", pp);
rmSync(pushRoot, { recursive: true, force: true });
const realPaths = workflowPushPaths(repoRoot);
ok(realPaths.length > 0 && realPaths.every((x) => !/^\s*#/.test(x.snippet)), "on this repository no listed push path is a comment line", realPaths.filter((x) => /^\s*#/.test(x.snippet)));

// ---- refusals ----
g = fakeGitHub({ admin403: true });
res = await run("ruleset-main", "live", wfRoot, g.fetchImpl, { GH_ADMIN_TOKEN: "pat_weak" });
ok(!res.ok && res.refused && res.refused.status === 403 && res.refused.message === "Resource not accessible by integration", "a refused write is recorded with status and text", res.refused);
ok(g.st.tokens.size === 1 && [...g.st.tokens][0] === "Bearer pat_weak" && g.st.log.filter((c) => c.method !== "GET").length === 1, "a refusal is not retried: one write, one credential");
g = fakeGitHub();
res = await run("ruleset-main", "live", wfRoot, g.fetchImpl, { GITHUB_TOKEN: "ghs_only" });
ok(!res.ok && res.refused.status === 0 && /no GH_ADMIN_TOKEN/.test(res.refused.message) && g.st.log.length === 0, "a live write without GH_ADMIN_TOKEN is a refusal and sends nothing (GITHUB_TOKEN is never used to write)");

// ---- secret scanning ----
g = fakeGitHub();
res = await run("secret-scanning", "dry", wfRoot, g.fetchImpl, { GH_ADMIN_TOKEN: "pat_admin" });
ok(res.ok && res.features.secret_scanning.result === "already enabled" && /dry run/.test(res.features.secret_scanning_push_protection.result) && !g.st.log.some((c) => c.method !== "GET"), "secret-scanning dry run lists what it would enable and writes nothing", res.features);
g = fakeGitHub({ refuse: ["secret_scanning_validity_checks", "secret_scanning_non_provider_patterns"] });
res = await run("secret-scanning", "live", wfRoot, g.fetchImpl, { GH_ADMIN_TOKEN: "pat_admin" });
ok(res.ok && res.core_enabled && g.st.log.filter((c) => c.method === "PATCH").length === 3 && res.features.secret_scanning_push_protection.after === "enabled" && res.limitations.length === 2 && res.optional_limitations.length === 2 && /Secret Protection/.test(res.limitations[0]) && /optional feature/.test(res.note), "one PATCH per feature: a refusal of the two plan-gated extras leaves both core protections enabled, is recorded as two limitations and does not fail the run", res);
g = fakeGitHub({ refuse: ["secret_scanning_push_protection"] });
res = await run("secret-scanning", "live", wfRoot, g.fetchImpl, { GH_ADMIN_TOKEN: "pat_admin" });
ok(!res.ok && !res.core_enabled && res.limitations.length >= 1 && /secret_scanning_push_protection/.test(res.limitations[0]), "a refused core protection (push protection) still fails the run", res);
g = fakeGitHub({ sa: { secret_scanning: { status: "disabled" } }, refuse: ["secret_scanning"] });
res = await run("secret-scanning", "live", wfRoot, g.fetchImpl, { GH_ADMIN_TOKEN: "pat_admin" });
ok(!res.ok && !res.core_enabled, "a refused secret_scanning (the other core protection) still fails the run", res);
g = fakeGitHub();
res = await run("secret-scanning", "live", wfRoot, g.fetchImpl, { GH_ADMIN_TOKEN: "pat_admin" });
ok(res.ok && res.core_enabled && res.limitations.length === 0 && res.optional_limitations.length === 0 && !res.note, "everything enabled: ok with no limitation and no note", res);
ok(SECRET_CORE_FEATURES.join() === "secret_scanning,secret_scanning_push_protection" && SECRET_CORE_FEATURES.every((f) => SECRET_FEATURES.includes(f)), "the core features are the first two of the four");
g = fakeGitHub({ noSa: true });
res = await run("secret-scanning", "dry", wfRoot, g.fetchImpl, { GH_ADMIN_TOKEN: "pat_admin" });
ok(res.visible_to_credential === false && res.features.secret_scanning.before === "unknown", "a credential that cannot see security_and_analysis says so");

// ---- allowlists ----
ok((await run("delete-repo", "live", wfRoot, g.fetchImpl, {})).error.includes("not allowlisted") && (await run("report", "yolo", wfRoot, g.fetchImpl, {})).error.includes("mode"), "an unknown action or mode is refused");
const api = makeApi(g.fetchImpl, "t");
let threw = 0;
for (const p of ["/repos/QNFO/other/rulesets", "/orgs/QNFO/repos", "/user/repos", "/repos/QNFO/qnfo-workers-evil/rulesets", "/apps/qnfo-fleet/installations", "/apps/Evil_App"]) { try { await api.call("GET", p); } catch (e) { threw++; } }
ok(threw === 6, "only QNFO/qnfo-workers and the org installations are reachable", threw);
ok(ACTIONS.join() === "report,ruleset-main,ruleset-main-revert,secret-scanning,delete-stuck-runs,gh-webhook" && SECRET_FEATURES.length === 4, "the action list is the documented six");
const wfText = readFileSync(join(repoRoot, ".github", "workflows", "github-settings-actions.yml"), "utf8");
ok(/GH_ADMIN_TOKEN: \$\{\{ secrets\.QNFO_GH_PAT \}\}/.test(wfText) && !/run:.*\$\{\{ (github\.event\.)?inputs\./.test(wfText) && /IN_ACTION: \$\{\{ github\.event_name == 'push' && 'gh-webhook' \|\| inputs\.action \}\}/.test(wfText) && /workflow_dispatch:/.test(wfText) && !/schedule:/.test(wfText), "the workflow passes inputs through env, takes the PAT from the secret and has no recurring schedule");
ok(!/ghp_|github_pat_|ghs_[A-Za-z0-9]{10}/.test(readFileSync(join(repoRoot, "scripts", "github-settings-actions.mjs"), "utf8")), "no credential value in the script");

// ---- DELETE-STUCK-RUNS-1 (agent_issues 1000275): queued or in-progress runs older than 24 h with no job running now
{
  const H = 3600000, T0 = Date.now(), ago = (h) => new Date(T0 - h * H).toISOString();
  const stuck = () => [
    { id: 101, name: "remediation-bridge", status: "queued", head_branch: "main", created_at: ago(19 * 24), jobs: [] },
    { id: 102, name: "code-task-publish", status: "queued", head_branch: "main", created_at: ago(19 * 24), jobs: [] },
    { id: 103, name: "deploy-gate", status: "in_progress", head_branch: "codeagent-im1", created_at: ago(4 * 24), jobs: [{ status: "completed", conclusion: "failure" }] },
    { id: 104, name: "deploy-gate", status: "in_progress", head_branch: "main", created_at: ago(30), jobs: [{ status: "in_progress" }] },
    { id: 105, name: "version-bump-guard", status: "queued", head_branch: "x", created_at: ago(0.1), jobs: [] },
    { id: 106, name: "github-settings-actions", status: "in_progress", head_branch: "main", created_at: ago(30), jobs: [] },
    { id: 107, name: "unreadable", status: "queued", head_branch: "main", created_at: ago(48), jobs: null },
  ];
  ok(ACTIONS.includes("delete-stuck-runs") && /- delete-stuck-runs/.test(readFileSync(join(repoRoot, ".github", "workflows", "github-settings-actions.yml"), "utf8")), "the action is allowlisted in the script and offered by the workflow");

  let g2 = fakeGitHub({ runs: stuck() });
  let r2 = await run("delete-stuck-runs", "dry", wfRoot, g2.fetchImpl, { GITHUB_TOKEN: "ghs_session", GITHUB_RUN_ID: "106" });
  ok(r2.ok && r2.candidates.map((c) => c.id).join() === "101,102,103", "dry: the two old queued runs and the old run whose only job concluded are the candidates", r2.candidates);
  const why = Object.fromEntries(r2.skipped.map((x) => [x.id, x.why]));
  ok(/running now/.test(why[104]) && /younger/.test(why[105]) && why[106] === "this run" && /jobs unreadable \(HTTP 500\)/.test(why[107]), "dry: a run with a job running, a young run, this run and a run whose jobs cannot be read are skipped, each with its reason", why);
  ok(!g2.st.log.some((x) => x.method === "DELETE") && g2.st.runs.length === 7 && /force-cancelled and then deleted/.test(r2.note), "dry writes nothing");
  ok(r2.credential === "GITHUB_TOKEN", "dry may use the session credential");

  g2 = fakeGitHub({ runs: stuck() });
  r2 = await run("delete-stuck-runs", "live", wfRoot, g2.fetchImpl, { GITHUB_TOKEN: "ghs_session", GITHUB_RUN_ID: "106" });
  ok(!r2.ok && r2.refused && r2.refused.status === 0 && g2.st.log.length === 0, "live without the admin credential is a refusal and sends nothing", r2.refused);

  g2 = fakeGitHub({ runs: stuck() });
  r2 = await run("delete-stuck-runs", "live", wfRoot, g2.fetchImpl, { STUCK_RUN_POLL_MS: "0", GH_ADMIN_TOKEN: "pat_admin", GITHUB_TOKEN: "ghs_session", GITHUB_RUN_ID: "106" });
  ok(r2.ok && r2.deleted.join() === "101,102,103" && g2.st.runs.map((x) => x.id).join() === "104,105,106,107", "live deletes exactly the candidates and leaves the running, the young, this and the unreadable run", { d: r2.deleted, left: g2.st.runs.map((x) => x.id) });
  ok(g2.st.tokens.size === 1 && g2.st.tokens.has("Bearer pat_admin") && r2.credential === "QNFO_GH_PAT", "live uses the admin credential only");

  g2 = fakeGitHub({ runs: stuck(), deleteRefuse: true });
  r2 = await run("delete-stuck-runs", "live", wfRoot, g2.fetchImpl, { STUCK_RUN_POLL_MS: "0", GH_ADMIN_TOKEN: "pat_admin", GITHUB_TOKEN: "ghs_session", GITHUB_RUN_ID: "106" });
  ok(!r2.ok && r2.refused.status === 403 && /Could not delete the workflow run/.test(r2.refused.message) && r2.refused.call === "DELETE run 101", "a refused delete is recorded with its status and GitHub's own text", r2.refused);
  ok(g2.st.log.filter((x) => x.method === "DELETE").length === 1 && g2.st.tokens.size === 1 && r2.deleted.length === 0, "and it stops at the first refusal and is not retried with another credential");

  g2 = fakeGitHub({ runs: Array.from({ length: 30 }, (_, i) => ({ id: 500 + i, name: "wedged", status: "queued", head_branch: "main", created_at: ago(72), jobs: [] })) });
  r2 = await run("delete-stuck-runs", "live", wfRoot, g2.fetchImpl, { STUCK_RUN_POLL_MS: "0", GH_ADMIN_TOKEN: "pat_admin" });
  ok(r2.ok && r2.deleted.length === 25 && r2.remaining === 5 && /beyond the cap of 25/.test(r2.note) && g2.st.runs.length === 5, "live deletes at most 25 per run and says how many remain", { n: r2.deleted.length, rem: r2.remaining });

  g2 = fakeGitHub({ runs: [] });
  r2 = await run("delete-stuck-runs", "live", wfRoot, g2.fetchImpl, { STUCK_RUN_POLL_MS: "0", GH_ADMIN_TOKEN: "pat_admin" });
  ok(r2.ok && r2.candidates.length === 0 && r2.deleted.length === 0, "nothing stuck is a pass that deletes nothing");

  const beyondFirstPage = Array.from({ length: 100 }, (_, i) => ({ id: 2000 + i, name: "recent", status: "queued", head_branch: "main", created_at: ago(1), jobs: [] }));
  beyondFirstPage.push({ id: 2100, name: "old queued run", status: "queued", head_branch: "main", created_at: ago(48), jobs: [] });
  g2 = fakeGitHub({ runs: beyondFirstPage });
  r2 = await run("delete-stuck-runs", "dry", wfRoot, g2.fetchImpl, { GITHUB_TOKEN: "ghs_x" });
  ok(r2.ok && r2.candidates.map((c) => c.id).join() === "2100" && g2.st.log.some((x) => /status=queued&per_page=100&page=2$/.test(x.path)), "dry scans later pages and finds a stale run behind the first 100 recent runs", r2.candidates);

  g2 = fakeGitHub({ runs: stuck(), runsList403: true });
  r2 = await run("delete-stuck-runs", "live", wfRoot, g2.fetchImpl, { STUCK_RUN_POLL_MS: "0", GH_ADMIN_TOKEN: "pat_admin" });
  ok(!r2.ok && r2.refused.status === 403 && !g2.st.log.some((x) => x.method === "DELETE"), "a refused list is recorded and nothing is deleted", r2.refused);

  // DELETE-STUCK-RUNS-2: GitHub deletes only a completed run, so each candidate is force-cancelled, read until completed, then deleted
  g2 = fakeGitHub({ runs: stuck() });
  r2 = await run("delete-stuck-runs", "live", wfRoot, g2.fetchImpl, { STUCK_RUN_POLL_MS: "0", GH_ADMIN_TOKEN: "pat_admin", GITHUB_RUN_ID: "106" });
  const seq = g2.st.log.filter((x) => (x.method === "POST" || x.method === "DELETE")).map((x) => x.method + " " + /runs\/(\d+)/.exec(x.path)[1]);
  ok(r2.ok && seq.join() === "POST 101,DELETE 101,POST 102,DELETE 102,POST 103,DELETE 103", "live force-cancels each run and only then deletes it, one candidate at a time", seq);
  ok(r2.force_cancelled.join() === "101,102,103" && r2.deleted.join() === "101,102,103" && r2.not_completed.length === 0 && g2.st.tokens.size === 1 && g2.st.tokens.has("Bearer pat_admin"), "the result lists what was force-cancelled and deleted, with the admin credential only", r2);

  g2 = fakeGitHub({ runs: stuck(), forceCancelRefuse: true });
  r2 = await run("delete-stuck-runs", "live", wfRoot, g2.fetchImpl, { STUCK_RUN_POLL_MS: "0", GH_ADMIN_TOKEN: "pat_admin", GITHUB_RUN_ID: "106" });
  ok(!r2.ok && r2.refused.call === "POST force-cancel run 101" && r2.refused.status === 403 && /not accessible/.test(r2.refused.message), "a refused force-cancel is recorded with its status and GitHub's text", r2.refused);
  ok(g2.st.log.filter((x) => x.method === "POST").length === 1 && !g2.st.log.some((x) => x.method === "DELETE") && g2.st.tokens.size === 1 && r2.deleted.length === 0, "and it stops there: no delete is sent, no second candidate is tried, no other credential is used");

  // STUCK-RUN-WEDGED-1: one run wedged on GitHub's side (409) must not block the candidates behind it
  g2 = fakeGitHub({ runs: stuck(), forceCancelWedged: [101] });
  r2 = await run("delete-stuck-runs", "live", wfRoot, g2.fetchImpl, { STUCK_RUN_POLL_MS: "0", GH_ADMIN_TOKEN: "pat_admin", GITHUB_RUN_ID: "106" });
  ok(r2.ok && !r2.refused && r2.wedged.map((w) => w.id).join() === "101" && r2.deleted.join() === "102,103" && /wedged on GitHub/.test(r2.note), "a run whose force-cancel answers 409 is recorded as wedged and the next candidates are still deleted", r2);

  // STUCK-RUN-NOTINPROGRESS-1: a run that is no longer in progress when the force-cancel arrives is read and deleted, not a refusal
  g2 = fakeGitHub({ runs: stuck(), forceCancelNotRunning: [101] });
  r2 = await run("delete-stuck-runs", "live", wfRoot, g2.fetchImpl, { STUCK_RUN_POLL_MS: "0", GH_ADMIN_TOKEN: "pat_admin", GITHUB_RUN_ID: "106" });
  ok(r2.ok && !r2.refused && r2.deleted.join() === "101,102,103" && r2.force_cancelled.join() === "102,103", "a 409 'not in progress' on force-cancel falls through to the read and delete", r2);

  g2 = fakeGitHub({ runs: stuck(), forceCancelStaysQueued: true });
  r2 = await run("delete-stuck-runs", "live", wfRoot, g2.fetchImpl, { STUCK_RUN_POLL_MS: "0", GH_ADMIN_TOKEN: "pat_admin", GITHUB_RUN_ID: "106" });
  ok(r2.ok && r2.not_completed.join() === "101,102,103" && r2.deleted.length === 0 && !g2.st.log.some((x) => x.method === "DELETE") && /force-cancelled but not completed/.test(r2.note), "a run that does not read completed after the polls is left, not deleted, and the note says why", r2);
  ok(g2.st.log.filter((x) => x.method === "GET" && /runs\/101$/.test(x.path)).length === 6, "each run is read 6 times before the run gives up on it");

  g2 = fakeGitHub({ runs: stuck(), deleteRefuse: true });
  r2 = await run("delete-stuck-runs", "live", wfRoot, g2.fetchImpl, { STUCK_RUN_POLL_MS: "0", GH_ADMIN_TOKEN: "pat_admin", GITHUB_RUN_ID: "106" });
  ok(!r2.ok && r2.refused.call === "DELETE run 101" && g2.st.log.filter((x) => x.method === "POST").length === 1 && r2.force_cancelled.join() === "101", "a refused delete after a force-cancel stops the run and names the delete", r2.refused);

  g2 = fakeGitHub({ runs: [{ id: 900, name: "old-but-fresh-enough", status: "queued", head_branch: "main", created_at: ago(23.9), jobs: [] }, { id: 901, name: "just-over", status: "queued", head_branch: "main", created_at: ago(24.1), jobs: [] }] });
  r2 = await run("delete-stuck-runs", "dry", wfRoot, g2.fetchImpl, { GITHUB_TOKEN: "ghs_x" });
  ok(r2.candidates.map((c) => c.id).join() === "901", "the age cut is 24 hours: 23.9 h is kept, 24.1 h is a candidate", r2.candidates);
}

rmSync(wfRoot, { recursive: true, force: true });
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
