#!/usr/bin/env node
// scripts/github-settings-actions.mjs: GITHUB-SETTINGS-ACTIONS-1 (agent_issues 2927 INTEG-GITHUB-HARDEN-1, pillar security).
//
// WHAT   Allowlisted GitHub settings actions for QNFO/qnfo-workers, run by .github/workflows/github-settings-actions.yml (the same
//        shape as cf-ops-actions: workflow_dispatch, one action per run, one RESULT_JSON line, nothing secret printed).
//          report              read-only capability matrix: which settings calls the credential may make (status + GitHub's own
//                              message, verbatim), the rulesets and rules on main, the check contexts seen on recent pull request
//                              heads, who pushes to main (the pusher, not the commit author), the org's app installations, the
//                              secret-scanning state.
//          ruleset-main        dry (default): print the ruleset payload, its diff against what exists, and every safety problem.
//                              live: create or update the ruleset `main-gate` (required checks, pull request required, admin role
//                              and the fleet's apps bypass), then read /rules/branches/main back to prove it.
//          ruleset-main-revert delete the ruleset named `main-gate`, and only that name (dry by default).
//          delete-stuck-runs   DELETE-STUCK-RUNS-1: dry (default) lists the workflow runs that are queued or in progress, older than 24 h and
//                              with no job running now, and the ones it skipped with the reason; live deletes at most 25 of them and stops at the
//                              first refusal, recording its status and GitHub's text.
//          secret-scanning     enable secret scanning, push protection, validity checks and non-provider patterns, one PATCH per
//                              feature so a refusal of one never hides the others; the answer of each is recorded. The run is ok when
//                              the two core protections (secret scanning, push protection) are enabled; the plan-gated extras that stay
//                              disabled are listed under limitations (SECRET-SCANNING-CORE-OK-1).
//          gh-webhook          register the existing signed receiver, installing its dedicated secret under the secret lease;
//                              verify a fresh GitHub test delivery before reporting success (dry reads only).
// WHY    No session holds repository Administration rights (a session's GET /branches/main/protection answers 403 "Resource not
//        accessible by integration", 2026-10-19), main has a ruleset that only blocks deletion and force pushes, and every concurrent
//        session clobber in this repository traces to unreviewed direct pushes. The steward's token has administration rights
//        (github_steward_runs 1 and 10: 61 and 49 repositories PATCHed), the repository secret QNFO_GH_PAT reads the org; which of
//        them may write rulesets has never been asked. This action asks, once, with the credential the fleet already has.
// SAFETY * One credential per run (GH_ADMIN_TOKEN, the secret QNFO_GH_PAT). A refusal is recorded with its status and text and is never
//          retried with another credential or another route. The token is never printed.
//        * Only QNFO/qnfo-workers, only the paths below. `live` refuses while a required check would never report (a path-filtered
//          workflow, an unknown context): GitHub then waits for it forever and no pull request could merge.
//        * The ruleset is added beside main-safety; reverting is one action. enforce on `~DEFAULT_BRANCH` only.
// USAGE  GH_ADMIN_TOKEN=... node scripts/github-settings-actions.mjs <action> [--mode dry|live] [--root .]
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setupWebhook } from "./gh-webhook-setup.mjs";

export const ACTIONS = ["report", "ruleset-main", "ruleset-main-revert", "secret-scanning", "delete-stuck-runs", "gh-webhook"];
export const STUCK_RUN_MIN_AGE_H = 24;
export const STUCK_RUN_MAX_DELETES = 25;
export const API = "https://api.github.com";
export const CONFIG_PATH = "scripts/github-main-ruleset.json";
const REPO_RE = /^\/repos\/QNFO\/qnfo-workers(\/|$|\?)/;
const ORG_RE = /^\/(orgs\/QNFO\/installations(\?|$)|apps\/[a-z0-9-]+$)/;
export const SECRET_FEATURES = ["secret_scanning", "secret_scanning_push_protection", "secret_scanning_validity_checks", "secret_scanning_non_provider_patterns"];
export const SECRET_CORE_FEATURES = ["secret_scanning", "secret_scanning_push_protection"];

// ---- API client: one token, an allowlist of paths, every answer kept verbatim ----
export function makeApi(fetchImpl, token) {
  const calls = [];
  async function call(method, path, body) {
    if (!(REPO_RE.test(path) || ORG_RE.test(path))) throw new Error("path not allowlisted: " + path);
    if (!token) { const r = { status: 0, body: null, text: "", message: "no credential", ok: false }; calls.push({ method, path, status: 0, message: r.message }); return r; }
    const init = { method, headers: { Authorization: "Bearer " + token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "qnfo-github-settings-actions", "Content-Type": "application/json" } };
    if (body !== undefined) init.body = JSON.stringify(body);
    let res, text = "";
    try { res = await fetchImpl(API + path, init); text = await res.text(); }
    catch (e) { const r = { status: 0, body: null, text: "", message: "network: " + String(e && e.message || e).slice(0, 160), ok: false }; calls.push({ method, path, status: 0, message: r.message }); return r; }
    let j = null; try { j = text ? JSON.parse(text) : null; } catch (e) { j = null; }
    const message = res.status >= 400 ? String((j && (j.message || j.error)) || text || "").slice(0, 300) + (j && Array.isArray(j.errors) && j.errors.length ? " " + JSON.stringify(j.errors).slice(0, 240) : "") : "";
    const r = { status: res.status, body: j, text, message, ok: res.status >= 200 && res.status < 300 };
    calls.push({ method, path, status: res.status, message });
    return r;
  }
  return { call, calls };
}

// ---- pure helpers ----
export function loadConfig(root) { return JSON.parse(readFileSync(join(root, CONFIG_PATH), "utf8")); }

// A required check reports only when a workflow that triggers on pull_request to main has a job with that id (or `name:`), and the
// trigger has no `paths:` filter: a filtered workflow never runs for a pull request that changes nothing under it, and the required
// check then stays "Expected" for ever.
export function workflowChecks(root) {
  const dir = join(root, ".github", "workflows");
  const out = [];
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir).filter((x) => /\.ya?ml$/.test(x)).sort()) {
    const text = readFileSync(join(dir, f), "utf8");
    const onBlock = /^on:\s*\n((?:[ \t]+.*\n|[ \t]*\n|#.*\n)*)/m.exec(text);
    const trig = onBlock ? onBlock[1] : "";
    const pr = /^[ \t]{2}pull_request:\s*\n((?:[ \t]{3,}.*\n|[ \t]*\n|[ \t]*#.*\n)*)/m.exec(trig);
    const onPr = !!pr || /^[ \t]*pull_request:/m.test(trig) || /^on:\s*\[[^\]]*pull_request/m.test(text);
    const filtered = !!(pr && /^[ \t]{4}paths(-ignore)?:/m.test(pr[1]));
    const jobsAt = text.search(/^jobs:\s*$/m);
    if (jobsAt < 0) continue;
    const jobs = text.slice(jobsAt).split("\n").slice(1);
    let cur = null;
    for (const line of jobs) {
      const k = /^  ([A-Za-z0-9_-]+):\s*$/.exec(line);
      if (k) { cur = { workflow: f, job: k[1], context: k[1], onPr, filtered }; out.push(cur); continue; }
      const n = /^    name:\s*(.+?)\s*$/.exec(line);
      if (n && cur && !/\$\{\{/.test(n[1])) cur.context = n[1].replace(/^["']|["']$/g, "");
      const u = /^    uses:\s*\.\/\.github\/workflows\/([A-Za-z0-9_.-]+\.ya?ml)\s*$/.exec(line);
      if (u && cur) cur.uses = u[1];
    }
  }
  // THREE-PR-WORKFLOWS-1: a job that calls a reusable workflow reports its callee's jobs as "<caller job> / <callee job>".
  const base = out.filter((w) => !w.uses);
  for (const w of out.filter((x) => x.uses)) {
    for (const c of base.filter((b) => b.workflow === w.uses)) {
      out.push({ workflow: w.workflow, job: c.job, context: w.job + " / " + c.context, onPr: w.onPr, filtered: w.filtered });
    }
  }
  return out;
}

export function checkProblems(cfg, root) {
  const problems = [];
  const all = workflowChecks(root);
  for (const ctx of cfg.required_checks) {
    const hit = all.filter((w) => w.context === ctx);
    if (!hit.length) problems.push("required check '" + ctx + "' is produced by no workflow job (GitHub would wait for it for ever)");
    else if (!hit.some((w) => w.onPr && !w.filtered)) problems.push("required check '" + ctx + "' is produced only by " + hit.map((w) => w.workflow + (w.onPr ? " (pull_request has a paths filter)" : " (no pull_request trigger)")).join(", ") + ": a pull request that skips it could never merge");
  }
  return problems;
}

export function buildRuleset(cfg, bypassIntegrations) {
  const rules = [
    { type: "deletion" },
    { type: "non_fast_forward" },
    { type: "pull_request", parameters: { ...cfg.pull_request, allowed_merge_methods: ["squash"] } },
    { type: "required_status_checks", parameters: { strict_required_status_checks_policy: !!cfg.strict_required_status_checks_policy, required_status_checks: cfg.required_checks.map((c) => ({ context: c })) } }
  ];
  const bypass_actors = [
    ...cfg.bypass.repository_roles.map((r) => ({ actor_id: r.actor_id, actor_type: "RepositoryRole", bypass_mode: "always" })),
    ...bypassIntegrations.map((i) => ({ actor_id: i.actor_id, actor_type: "Integration", bypass_mode: "always" }))
  ];
  return { name: cfg.name, target: cfg.target, enforcement: cfg.enforcement, conditions: cfg.conditions, rules, bypass_actors };
}

// Does an existing ruleset already carry the desired rules, checks and bypass list?
export function rulesetDiff(existing, desired) {
  if (!existing) return ["absent: will be created"];
  const d = [];
  if (existing.enforcement !== desired.enforcement) d.push("enforcement " + existing.enforcement + " -> " + desired.enforcement);
  const types = (x) => (x.rules || []).map((r) => r.type).sort().join(",");
  if (types(existing) !== types(desired)) d.push("rule types " + types(existing) + " -> " + types(desired));
  const ctx = (x) => ((x.rules || []).find((r) => r.type === "required_status_checks") || { parameters: { required_status_checks: [] } }).parameters.required_status_checks.map((c) => c.context).sort().join(",");
  if (ctx(existing) !== ctx(desired)) d.push("required checks " + ctx(existing) + " -> " + ctx(desired));
  const by = (x) => (x.bypass_actors || []).map((b) => b.actor_type + ":" + b.actor_id).sort().join(",");
  if (by(existing) !== by(desired)) d.push("bypass " + by(existing) + " -> " + by(desired));
  return d;
}

// GET /repos/.../activity?ref=refs/heads/main: who pushed or merged on main. `actor` is the PUSHER (the token's identity), which a commit's
// author or committer name is not: the status and charter commits are authored as qnfo-selfheal-bot and qnfo-fleet-bot but pushed by the
// Actions app (measured 2026-10-19: github-actions[bot] 47 pushes, qnfo-fleet[bot] 18 merges and 5 pushes, rwnq8 28 merges and 2 pushes).
export function activityActors(list) {
  const by = {};
  for (const a of Array.isArray(list) ? list : []) {
    const who = (a.actor && a.actor.login) || "unknown";
    const kind = a.activity_type || "unknown";
    by[who] = by[who] || {};
    by[who][kind] = (by[who][kind] || 0) + 1;
  }
  return by;
}
// A direct push (activity_type push, not pr_merge) by an actor the ruleset would block: neither a bypass app nor a known admin.
export function unlistedPushers(actors, cfg) {
  // GitHub Actions cannot be a ruleset bypass actor, so pushes by github-actions[bot] must be moved to a bypass-listed identity.
  const known = new Set(cfg.known_direct_pushers || []);
  known.delete("github-actions[bot]");
  return Object.keys(actors).filter((who) => (actors[who].push || 0) > 0 && who !== "github-actions[bot]" && !known.has(who));
}

// Audit the workflow files for any command that pushes directly to refs/heads/main. Those paths currently push as github-actions[bot].
export function workflowPushPaths(root) {
  const dir = join(root, ".github", "workflows");
  const out = [];
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir).filter((x) => /\.ya?ml$/.test(x)).sort()) {
    const lines = readFileSync(join(dir, f), "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // A YAML comment line is prose about a push, not a push path (apply-unmangle-worker-js.yml:13 and fleet-autodeploy.yml:229
      // quoted `git push` in comments and were listed as two of the 18 problems the live ruleset action refuses on).
      if (/^\s*#/.test(line)) continue;
      if (/\bgit\s+push\b/.test(line) && /\bmain\b/.test(line)) {
        out.push({ workflow: f, line: i + 1, snippet: line.trim() });
      }
      // MAIN-RULESET-STAGE0-1 (issue 100168): canonical-deploy status commits and the automatic canary revert push through these
      // scripts, so a workflow that never writes `git push ... main` itself still pushes to main as github-actions[bot].
      if (/(push_artifact\.sh|canary_revert\.py)/.test(line)) {
        out.push({ workflow: f, line: i + 1, snippet: line.trim() });
      }
    }
  }
  return out;
}

// ---- reads shared by report and the live safety check ----
async function seenContexts(api, repo, perPr = 8) {
  const seen = {};
  const prs = await api.call("GET", "/repos/" + repo + "/pulls?state=closed&per_page=" + perPr);
  const heads = prs.ok && Array.isArray(prs.body) ? prs.body.map((p) => p.head && p.head.sha).filter(Boolean) : [];
  for (const sha of heads) {
    const cr = await api.call("GET", "/repos/" + repo + "/commits/" + sha + "/check-runs?per_page=100");
    if (cr.ok && cr.body && Array.isArray(cr.body.check_runs)) for (const r of cr.body.check_runs) seen[r.name] = (seen[r.name] || 0) + 1;
  }
  return { seen, prs_sampled: heads.length, prs_status: prs.status };
}

// An app's numeric id: the public GET /apps/<slug> first (no credential needed), then the org's installations (needs an org-admin credential).
// GitHub's own Actions app (id 15368, slug github-actions) is refused as a ruleset bypass actor: POST /rulesets answered 422 "Actor GitHub
// Actions integration must be part of the ruleset source or owner organization" (run 39269046255, 2026-10-19), while the dry run at the same
// commit passed. It is tested BEFORE the explicit actor_id shortcut, so a configured id is refused here, in dry and live alike.
export const GITHUB_ACTIONS_APP_ID = 15368;
export function isActionsApp(i) {
  return Number(i && i.actor_id) === GITHUB_ACTIONS_APP_ID || (i && (i.slug === "github-actions" || i.slug === "github-actions[bot]"));
}
async function resolveIntegrations(api, cfg) {
  const out = [], unresolved = [], ineligible = [];
  let listing = null;
  for (const i of cfg.bypass.integrations) {
    if (isActionsApp(i)) {
      ineligible.push((i.slug || "github-actions") + " (actor_id " + (i.actor_id || GITHUB_ACTIONS_APP_ID) + ")");
      continue;
    }
    if (i.actor_id) { out.push({ slug: i.slug, actor_id: i.actor_id }); continue; }
    const pub = await api.call("GET", "/apps/" + i.slug);
    if (pub.ok && pub.body && pub.body.id && pub.body.slug === i.slug) { out.push({ slug: i.slug, actor_id: pub.body.id }); continue; }
    if (!listing) listing = await api.call("GET", "/orgs/QNFO/installations?per_page=100");
    const hit = listing.ok && listing.body && Array.isArray(listing.body.installations) ? listing.body.installations.find((x) => x.app_slug === i.slug) : null;
    if (hit && hit.app_id) out.push({ slug: i.slug, actor_id: hit.app_id });
    else unresolved.push(i.slug + " (GET /apps/" + i.slug + " answered " + pub.status + (pub.message ? " " + pub.message : "") + "; " + (listing.ok ? "not among the org installations" : "installations answered " + listing.status + ": " + listing.message) + ")");
  }
  return { integrations: out, unresolved, ineligible };
}

// ---- actions ----
export async function actionReport(api, cfg, root) {
  const repo = cfg.repo, r = { action: "report", repo, ok: true, matrix: [] };
  const probe = async (label, path) => { const x = await api.call("GET", path); r.matrix.push({ call: label, status: x.status, message: x.message || undefined }); return x; };
  const repoInfo = await probe("GET repo", "/repos/" + repo);
  r.repo_admin_flag = repoInfo.body && repoInfo.body.permissions ? repoInfo.body.permissions.admin : null;
  r.security_and_analysis = repoInfo.body ? repoInfo.body.security_and_analysis || null : null;
  const prot = await probe("GET branches/main/protection", "/repos/" + repo + "/branches/main/protection");
  r.classic_protection = prot.status === 200 ? "present" : prot.status === 404 ? "absent" : "unreadable";
  const rs = await probe("GET rulesets", "/repos/" + repo + "/rulesets");
  r.rulesets = rs.ok && Array.isArray(rs.body) ? rs.body.map((x) => ({ id: x.id, name: x.name, enforcement: x.enforcement })) : null;
  const rules = await probe("GET rules/branches/main", "/repos/" + repo + "/rules/branches/main");
  r.rules_on_main = rules.ok && Array.isArray(rules.body) ? Array.from(new Set(rules.body.map((x) => x.type))).sort() : null;
  await probe("GET vulnerability-alerts", "/repos/" + repo + "/vulnerability-alerts");
  await probe("GET automated-security-fixes", "/repos/" + repo + "/automated-security-fixes");
  const inst = await probe("GET org installations", "/orgs/QNFO/installations?per_page=100");
  r.org_apps = inst.ok && inst.body && Array.isArray(inst.body.installations) ? inst.body.installations.map((x) => x.app_slug + ":" + x.app_id) : null;
  const cs = await seenContexts(api, repo);
  r.contexts_seen_on_recent_pr_heads = cs.seen; r.prs_sampled = cs.prs_sampled;
  // MAIN-RULESET-PUSH-IDENTITY-1 (issue 100168): audit every write path to main and the identity it uses, report-only.
  const dir = join(root, ".github", "workflows");
  const wfFiles = existsSync(dir) ? readdirSync(dir).filter((x) => /\.ya?ml$/.test(x)).sort() : [];
  const pushIdentities = [];
  for (const f of wfFiles) {
    const text = readFileSync(join(dir, f), "utf8");
    if (!text) continue;
    // MAIN-RULESET-STAGE0-1 (issue 100168): a QNFO_GH_PAT mention inside a YAML comment is prose, not a converted push path,
    // so only non-comment lines count when deciding which credential a workflow's writes to main use.
    const codeText = text.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
    const hasCheckoutToken = /persist-credentials:\s*false/.test(text) ? "checkout does not persist the default token" : "checkout persists the default GITHUB_TOKEN identity (github-actions[bot]) unless overridden";
    const pushes = [];
    if (/\bgit\s+push\b/.test(codeText)) pushes.push("git push");
    if (/\/contents\//.test(codeText) && /(PUT|patch)/i.test(codeText)) pushes.push("contents PUT/PATCH");
    if (/\/git\/refs\//.test(codeText)) pushes.push("git refs PATCH/POST");
    if (/canary_revert/.test(codeText)) pushes.push("canary_revert");
    if (/QNFO_GH_PAT/.test(codeText)) pushIdentities.push({ workflow: f, credential: "QNFO_GH_PAT (admin PAT)", paths: pushes.length ? pushes : ["other"] });
    else if (pushes.length) pushIdentities.push({ workflow: f, credential: hasCheckoutToken, paths: pushes, identity: "github-actions[bot] unless a bypass-listed app token is configured" });
  }
  r.main_push_paths = workflowPushPaths(root);
  r.main_push_identities = pushIdentities;
  r.main_push_identity_note = "ruleset-main refuses while any workflow pushes to main as github-actions[bot]; each push path must move to a bypass-listed identity (QNFO_GH_PAT or the qnfo-fleet app token) before ruleset-main goes live";
  const act = await probe("GET activity main", "/repos/" + repo + "/activity?ref=refs/heads/main&per_page=100");
  r.pushers_last_100 = act.ok ? activityActors(act.body) : null;
  r.unlisted_direct_pushers = act.ok ? unlistedPushers(r.pushers_last_100, cfg) : null;
  r.workflow_problems = checkProblems(cfg, root);
  r.workflow_push_paths = workflowPushPaths(root);
  r.token_can_administer = prot.status === 200 || prot.status === 404 ? "yes: branch protection answered " + prot.status : "no: GET branches/main/protection answered " + prot.status + " " + prot.message;
  return r;
}

export async function actionRulesetMain(api, cfg, root, mode) {
  const repo = cfg.repo, r = { action: "ruleset-main", repo, mode, ok: false, problems: [] };
  r.problems.push(...checkProblems(cfg, root));
  const pushPaths = workflowPushPaths(root);
  r.workflow_push_paths = pushPaths;
  for (const p of pushPaths) r.problems.push("workflow " + p.workflow + " line " + p.line + " pushes to main as github-actions[bot]; move this path to a bypass-listed identity: " + p.snippet);
  const { integrations, unresolved, ineligible } = await resolveIntegrations(api, cfg);
  for (const x of ineligible) r.problems.push("bypass actor " + x + " is refused by GitHub (POST rulesets answers 422 'Actor GitHub Actions integration must be part of the ruleset source or owner organization'): remove it from " + CONFIG_PATH + " and move its direct pushes to a bypass-listed identity");
  for (const u of unresolved) r.problems.push("cannot resolve the app " + u + ": a ruleset without it would lock that app out of main");
  const cs = await seenContexts(api, repo);
  r.contexts_seen = cs.seen;
  for (const ctx of cfg.required_checks) if (!cs.seen[ctx]) r.problems.push("required check '" + ctx + "' was not seen on the last " + cs.prs_sampled + " closed pull request heads (check-runs read answered " + cs.prs_status + ")");
  const act = await api.call("GET", "/repos/" + repo + "/activity?ref=refs/heads/main&per_page=100");
  if (act.ok) {
    r.unlisted_direct_pushers = unlistedPushers(activityActors(act.body), cfg);
    for (const w of r.unlisted_direct_pushers) r.problems.push("'" + w + "' pushed directly to main in the last 100 activities and is neither a bypass app nor a known admin: the ruleset would block it (add it to known_direct_pushers only after deciding it may bypass)");
  } else r.problems.push("the push activity of main is unreadable (" + act.status + " " + act.message + "): cannot tell who the ruleset would block");
  const desired = buildRuleset(cfg, integrations);
  r.desired = desired;
  const list = await api.call("GET", "/repos/" + repo + "/rulesets");
  if (!list.ok) { r.refused = { call: "GET rulesets", status: list.status, message: list.message }; r.problems.push("rulesets unreadable: " + list.status + " " + list.message); return r; }
  const found = (list.body || []).find((x) => x.name === cfg.name) || null;
  const existing = found ? (await api.call("GET", "/repos/" + repo + "/rulesets/" + found.id)).body : null;
  r.diff = rulesetDiff(existing, desired);
  if (mode !== "live") { r.ok = true; r.note = "dry run: nothing written; " + (r.problems.length ? r.problems.length + " problem(s) block live" : "no problem blocks live"); return r; }
  if (r.problems.length) { r.note = "live refused: fix the problems first"; return r; }
  if (existing && !r.diff.length) { r.ok = true; r.note = "ruleset already matches"; return r; }
  const w = existing ? await api.call("PUT", "/repos/" + repo + "/rulesets/" + found.id, desired) : await api.call("POST", "/repos/" + repo + "/rulesets", desired);
  r.write = { call: existing ? "PUT rulesets/" + found.id : "POST rulesets", status: w.status, message: w.message || undefined };
  if (!w.ok) { r.refused = r.write; return r; }
  const back = await api.call("GET", "/repos/" + repo + "/rules/branches/main");
  const types = back.ok && Array.isArray(back.body) ? Array.from(new Set(back.body.map((x) => x.type))) : [];
  r.rules_on_main_after = types.sort();
  r.ok = types.includes("required_status_checks") && types.includes("pull_request");
  r.note = r.ok ? "ruleset live; revert with action ruleset-main-revert" : "written but /rules/branches/main does not show it";
  return r;
}

export async function actionRulesetRevert(api, cfg, mode) {
  const repo = cfg.repo, r = { action: "ruleset-main-revert", repo, mode, ok: false };
  const list = await api.call("GET", "/repos/" + repo + "/rulesets");
  if (!list.ok) { r.refused = { call: "GET rulesets", status: list.status, message: list.message }; return r; }
  const found = (list.body || []).find((x) => x.name === cfg.name);
  if (!found) { r.ok = true; r.note = "no ruleset named " + cfg.name; return r; }
  if (mode !== "live") { r.ok = true; r.note = "dry run: would delete ruleset " + found.id + " (" + cfg.name + ")"; return r; }
  const d = await api.call("DELETE", "/repos/" + repo + "/rulesets/" + found.id);
  r.delete = { status: d.status, message: d.message || undefined };
  r.ok = d.ok;
  if (!d.ok) r.refused = r.delete;
  return r;
}

// DELETE-STUCK-RUNS-1 (agent_issues 1000275, 2026-10-26): five runs sat `queued` with no jobs since 2026-10-07 and one deploy-gate run sat `in_progress`
// since 2026-10-22 although its only job had failed. The session token and the GitHub connector both answer cancel with HTTP 409 ("Cannot cancel a workflow
// run that has not been queued yet") and delete with 403, so the run records stay for good and distort counts. A run is a candidate only when it is queued or
// in progress, was created more than STUCK_RUN_MIN_AGE_H hours ago, and has no job that is running now (a queued run has none; the stuck deploy-gate run has one
// job and it concluded). Dry (default) lists the candidates and what it skipped and why; live deletes at most STUCK_RUN_MAX_DELETES runs with the admin credential
// and stops at the first refusal, recording its status and GitHub's text: a refusal is the answer and is never retried with another credential.
// DELETE-STUCK-RUNS-2 (2026-10-26): the first live run (run 40290472819) was answered `DELETE run 37655533507` -> 403 "Could not delete the workflow run" with the
// repository credential too: GitHub deletes only a run that has completed, and these never completed. The documented endpoint for a run that ignores cancellation is
// force-cancel, so each candidate is force-cancelled first (POST .../force-cancel, the same credential and the same write right as a cancel), polled until it reads
// completed (STUCK_RUN_POLL_TRIES reads, STUCK_RUN_POLL_MS apart), and then deleted. A refusal of the force-cancel is recorded with its status and text and stops the run
// exactly like a refused delete: that is the answer (a missing Actions write right would show as 403 here), it is not retried and not reworded.
export const STUCK_RUN_POLL_TRIES = 6;
export const STUCK_RUN_POLL_MS = 3000;
export async function actionDeleteStuckRuns(api, cfg, mode, now, env) {
  const repo = cfg.repo, r = { action: "delete-stuck-runs", repo, mode, ok: false, min_age_h: STUCK_RUN_MIN_AGE_H, candidates: [], skipped: [], deleted: [] };
  const cutoff = (now || Date.now()) - STUCK_RUN_MIN_AGE_H * 3600000;
  const self = env && env.GITHUB_RUN_ID ? Number(env.GITHUB_RUN_ID) : 0;
  const runs = [], seen = {};
  for (const status of ["queued", "in_progress"]) {
    for (let page = 1; ; page++) {
      const l = await api.call("GET", "/repos/" + repo + "/actions/runs?status=" + status + "&per_page=100&page=" + page);
      if (!l.ok) { r.refused = { call: "GET runs " + status + " page " + page, status: l.status, message: l.message }; return r; }
      const listed = (l.body && l.body.workflow_runs) || [];
      for (const x of listed) if (!seen[x.id]) { seen[x.id] = 1; runs.push(x); }
      if (listed.length < 100) break;
    }
  }
  for (const x of runs) {
    const row = { id: x.id, name: x.name, status: x.status, branch: x.head_branch, created_at: x.created_at };
    const created = Date.parse(x.created_at) || 0;
    if (x.id === self) { r.skipped.push({ ...row, why: "this run" }); continue; }
    if (!created || created >= cutoff) { r.skipped.push({ ...row, why: "younger than " + STUCK_RUN_MIN_AGE_H + " h" }); continue; }
    const jobs = await api.call("GET", "/repos/" + repo + "/actions/runs/" + x.id + "/jobs?per_page=100");
    if (!jobs.ok) { r.skipped.push({ ...row, why: "jobs unreadable (HTTP " + jobs.status + ")" }); continue; }
    const running = ((jobs.body && jobs.body.jobs) || []).filter((j) => j.status === "in_progress");
    if (running.length) { r.skipped.push({ ...row, why: running.length + " job(s) running now" }); continue; }
    r.candidates.push({ ...row, jobs: ((jobs.body && jobs.body.jobs) || []).length });
  }
  r.candidate_count = r.candidates.length;
  if (mode !== "live") { r.ok = true; r.note = "dry run: nothing written; " + r.candidates.length + " stuck run(s) would be force-cancelled and then deleted (cap " + STUCK_RUN_MAX_DELETES + " per run)"; return r; }
  const pollMs = env && env.STUCK_RUN_POLL_MS !== undefined && env.STUCK_RUN_POLL_MS !== "" ? Number(env.STUCK_RUN_POLL_MS) : STUCK_RUN_POLL_MS;
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  r.force_cancelled = []; r.not_completed = []; r.wedged = [];
  for (const c of r.candidates.slice(0, STUCK_RUN_MAX_DELETES)) {
    const base = "/repos/" + repo + "/actions/runs/" + c.id;
    const f = await api.call("POST", base + "/force-cancel");
    // STUCK-RUN-WEDGED-1 (agent_issues 4395, run 37655533507 queued since 2026-10-07): GitHub answers 409 "Cannot cancel a workflow run that has not been queued yet" for a run
    // wedged on its side. That is the run's state, not a missing right, so it is recorded and the next candidate is tried; any other refusal still stops the run as before.
    if (!f.ok && f.status === 409 && /not been queued/i.test(String(f.message || ""))) { r.wedged.push({ id: c.id, status: f.status, message: f.message }); continue; }
    // STUCK-RUN-NOTINPROGRESS-1: 409 "Cannot cancel a workflow run that is not in progress" means the run left the state the list read (run 39698201166, 2026-10-28): it is
    // read like a cancelled run (polled until completed, then deleted), and one that never reads completed is left, not a refusal.
    const gone = !f.ok && f.status === 409 && /not in progress/i.test(String(f.message || ""));
    if (!f.ok && !gone) { r.refused = { call: "POST force-cancel run " + c.id, status: f.status, message: f.message }; break; }
    if (!gone) r.force_cancelled.push(c.id);
    let done = false;
    for (let i = 0; i < STUCK_RUN_POLL_TRIES && !done; i++) {
      await sleep(pollMs);
      const g = await api.call("GET", base);
      done = g.ok && !!g.body && g.body.status === "completed";
    }
    if (!done) { r.not_completed.push(c.id); continue; }
    const d = await api.call("DELETE", base);
    if (!d.ok) { r.refused = { call: "DELETE run " + c.id, status: d.status, message: d.message }; break; }
    r.deleted.push(c.id);
  }
  r.remaining = r.candidates.length - r.deleted.length;
  r.ok = !r.refused;
  if (r.ok && r.remaining > 0) r.note = r.remaining + " candidate(s) stay: " + r.not_completed.length + " force-cancelled but not completed after " + STUCK_RUN_POLL_TRIES + " reads (a later run deletes them once completed is read), the rest beyond the cap of " + STUCK_RUN_MAX_DELETES;
  if (r.ok && r.wedged.length) r.note = (r.note ? r.note + "; " : "") + r.wedged.length + " run(s) wedged on GitHub's side (force-cancel answers 409, no API path): " + r.wedged.map((w) => w.id).join(",");
  return r;
}

export async function actionSecretScanning(api, cfg, mode) {
  const repo = cfg.repo, r = { action: "secret-scanning", repo, mode, ok: true, features: {} };
  const before = await api.call("GET", "/repos/" + repo);
  if (!before.ok) { r.ok = false; r.refused = { call: "GET repo", status: before.status, message: before.message }; return r; }
  const sa = (before.body && before.body.security_and_analysis) || null;
  r.visible_to_credential = !!sa;
  for (const f of SECRET_FEATURES) {
    const state = sa && sa[f] ? sa[f].status : "unknown";
    const row = { before: state };
    if (state === "enabled") { row.result = "already enabled"; r.features[f] = row; continue; }
    if (mode !== "live") { row.result = "dry run: would PATCH security_and_analysis." + f + " = enabled"; r.features[f] = row; continue; }
    const p = await api.call("PATCH", "/repos/" + repo, { security_and_analysis: { [f]: { status: "enabled" } } });
    row.patch = { status: p.status, message: p.message || undefined };
    r.features[f] = row;
  }
  if (mode === "live") {
    const after = await api.call("GET", "/repos/" + repo);
    const sa2 = (after.body && after.body.security_and_analysis) || {};
    for (const f of SECRET_FEATURES) { r.features[f].after = sa2[f] ? sa2[f].status : "unknown"; if (r.features[f].after !== "enabled") r.features[f].limitation = (r.features[f].patch && r.features[f].patch.message) || "still " + r.features[f].after; }
    r.limitations = SECRET_FEATURES.filter((f) => r.features[f].after !== "enabled").map((f) => f + ": " + r.features[f].limitation);
    // SECRET-SCANNING-CORE-OK-1: the run's verdict is the two core protections. validity checks and non-provider patterns accept the PATCH
    // (200) and stay disabled on this plan (run 39269201605, 2026-10-19; a plan limitation, issue 2927's close note), so they are
    // reported under `limitations` and `optional_limitations` and no longer turn a run red in which both core protections are enabled.
    r.core_features = SECRET_CORE_FEATURES;
    r.core_enabled = SECRET_CORE_FEATURES.every((f) => r.features[f].after === "enabled");
    r.optional_limitations = SECRET_FEATURES.filter((f) => !SECRET_CORE_FEATURES.includes(f) && r.features[f].after !== "enabled").map((f) => f + ": " + r.features[f].limitation);
    r.ok = r.core_enabled;
    if (r.core_enabled && r.limitations.length) r.note = "core secret scanning and push protection are enabled; " + r.optional_limitations.length + " optional feature(s) stay disabled (plan-gated, recorded under limitations)";
  }
  return r;
}

export async function run(action, mode, root, fetchImpl, env) {
  if (!ACTIONS.includes(action)) return { ok: false, action, error: "action not allowlisted; one of " + ACTIONS.join(", ") };
  if (mode !== "dry" && mode !== "live") return { ok: false, action, error: "mode must be dry or live" };
  const cfg = loadConfig(root);
  const admin = (env && env.GH_ADMIN_TOKEN) || "";
  const readTok = admin || (env && env.GITHUB_TOKEN) || "";
  const writes = action !== "report";
  // a dry run only reads, so it may use whichever credential exists; a live write uses the admin credential and nothing else
  const token = writes && mode === "live" ? admin : (admin || readTok);
  const api = makeApi(action === "gh-webhook" ? (url, init) => fetchImpl(url, {
    ...init, redirect: "error", signal: AbortSignal.timeout(15000)
  }) : fetchImpl, token);
  let res;
  if (writes && mode === "live" && !admin) res = { ok: false, action, mode, refused: { call: "(none sent)", status: 0, message: "no GH_ADMIN_TOKEN (repository secret QNFO_GH_PAT is empty or unset): a live write needs a credential with repository administration" } };
  else if (action === "report") res = await actionReport(api, cfg, root);
  else if (action === "ruleset-main") res = await actionRulesetMain(api, cfg, root, mode);
  else if (action === "ruleset-main-revert") res = await actionRulesetRevert(api, cfg, mode);
  else if (action === "delete-stuck-runs") res = await actionDeleteStuckRuns(api, cfg, mode, Date.now(), env);
  else if (action === "gh-webhook") res = await setupWebhook(api, mode, fetchImpl, env || {});
  else res = await actionSecretScanning(api, cfg, mode);
  res.credential = token === admin && admin ? "QNFO_GH_PAT" : token ? "GITHUB_TOKEN" : "none";
  res.calls = api.calls.length;
  return res;
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const action = argv[0] || "";
  const res = await run(action, arg("--mode", "dry"), resolve(arg("--root", process.cwd())), fetch, process.env);
  console.log("RESULT_JSON=" + JSON.stringify(res));
  process.exit(res.ok ? 0 : 1);
}
function isEntry() { try { return import.meta.url === pathToFileURL(process.argv[1]).href; } catch { return false; } }
if (isEntry()) main();
