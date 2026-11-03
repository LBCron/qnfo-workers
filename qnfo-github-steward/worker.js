/* qnfo-github-steward — GITHUB-STEWARD-1
 *
 * WHY THIS EXISTS
 *   GitHub settings for the QNFO estate were optimised once, by hand, and then drifted: 0 of 61
 *   active repositories deleted a merged branch, 3 of 61 protected their default branch, one
 *   organisation-level default handed every member ADMIN on every repository, and the org-wide
 *   GITHUB_TOKEN still defaulted to write. A setting is only an optimisation if something keeps
 *   putting it back. This worker is that something.
 *
 * WHAT IT DOES
 *   Every six hours it reads the estate (one org + the owner's personal account), compares each
 *   repository and the organisation to a declared DESIRED state, writes what actually differs,
 *   and records the run in D1. It never edits workflow YAML: a heuristic rewrite of a build file
 *   is how a green pipeline becomes a red one, so workflow findings are REPORTED, and the ones
 *   that need a human or the fleet's code-agent are named explicitly.
 *
 * SAFETY
 *   * additive only -- it sets merge/branch/protection policy, never deletes a repository,
 *     never archives, never touches workflow files, never pushes commits;
 *   * a field the platform refuses (free plan: branch protection and auto-merge on private
 *     repositories) is recorded as a permanent limitation, not retried as a failure;
 *   * archived repositories are read-only and are skipped, not reported as drift;
 *   * GET /report and GET /health are public reads; POST /tick needs STEWARD_KEY.
 */
// 0.10.7 PROGRAM-PROJECTS-1 (#2052, agent_issues 2972, pillar autonomy; patch): derive projects for manager-pinned program issues so their GitHub milestones converge.
// 0.10.8 TRACKER-MERGED-METADATA-REPAIR-1 (#100300, pillar autonomy; patch): restore merged_at when a task is already marked merged but its confirmed merged PR timestamp is missing.
// 0.10.9 TRACKER-CANONICAL-PR-LINK-1 (#2327, pillar autonomy; patch): preserve the canonical PR URL when an old duplicate shares the task branch, so a stale duplicate link cannot leave false tracker drift.
// 0.10.10 TRACKER-UNLABELLED-ISSUE-STATE-1 (#1991, pillar autonomy; patch): state sync reads all open issues so removing the mirror label cannot hide a GitHub/D1 state mismatch; relinking still requires the mirror label.
// 0.10.5 PORTFOLIO-BACKFILL-1 (2026-11-01, pillar autonomy; patch): process portfolio milestone and roadmap issue backfills at the existing 40-item sync rate to keep a 206-row backlog within the 120-minute issue SLA.
// 0.10.4 CAPABILITY-CONTRACT-REFRESH-1 (#2852, pillar autonomy; patch: re-publish the declared /health lists for a fresh live capability audit).
var VERSION = "0.12.4-codeagent"; // 0.10.8 TRACKER-MERGED-METADATA-REPAIR-1 (#100300, pillar autonomy; patch): restore merged_at when a task is already marked merged but its confirmed merged PR timestamp is missing. 0.10.6 TRACKER-STATE-VERIFY-1 (2026-11-01, pillar autonomy; patch): mass mismatches are verified per issue before D1 state is reconciled; list omissions do not trigger state changes.  0.10.3 NARRATIVE-GUARD-WORDING-1 (2026-11-01, pillar autonomy; patch): a comment in psPlace (0.10.1) used a phrase that scripts/narrative-prompt-guard.py bans in every worker source, comments included, so the NARRATIVE-PROMPT-GUARD-1 step of deploy-gate went red on main from #5526 onward; the comment and its tag are reworded (the tag is now PIN-PROGRAM-ROW-1). No behaviour change. 0.10.2 FM-ACTOR-1-INDIVIDUAL-1 (2026-11-01, pillar autonomy; patch): every FM-ACTOR-1 issue is mirrored individually at every priority, excluded from digests, and reopened if GitHub closes it while D1 remains open. 0.10.1 PLACE-ALL-OPEN-1 + PS-SCOPE-SUBQUERY-1 (2026-10-30, pillar autonomy; patch): (a) psPlace places every open agent_issue on a project, mirrored or not (it joined gh_issue_links, so the 149 high and medium issues that ISSUE-ROLLUP-1 stopped mirroring had no issue_project_map row and every program roll-up ignored them); an issue that names an active worker in its title goes to that worker's project before the fleet-control fallback; (b) the roadmap mirror step and GET /roadmap no longer bind roadmap_mirror_scope as a NOT IN list (138 sources against D1's 100 bound variables: "D1_ERROR: too many SQL variables" on every tick since 0.8.0, GET /roadmap answered 500, 82 roadmap rows stayed unmirrored and portfolio_drift read 83); with the table present the filter is a subquery on it. // 0.10.0 ISSUE-ROLLUP-1 (owner directive 2026-10-26 "reduce open issues to <100", pillar autonomy; minor: a decision the worker now takes on its own): an agent_issues row whose priority is not in ops_config gh_individual_priorities (default critical) is no longer its own GitHub issue; its mirror is closed not_planned and D1 stays authoritative and open; one [digest] issue per program lists the rolled rows (gh_digest_links), and one lists the goals while roadmap_mirror_scope has goals at mirrored = 0. Deleting the ops_config key restores one issue per row. // 0.9.1 PS-KEEP-CATALOGUE-PROJECT-1 (2026-10-26, agent_issues 2993, pillar autonomy; patch): psPlace keeps an open issue on an active project that is not a W.<worker> project (a catalogue project such as BP26.EDITORIAL) instead of placing it by owner onto W.<owner>; the 30 BP26 catalogue issues had all been moved to W.qnfo-ops, which left five BP26 projects with no mapped issue and the no-mapped-work detector reporting them. 0.9.0 ROADMAP-TWIN-ROWS-1 (2026-10-26, pillar autonomy; minor: a decision the worker now takes on its own): a roadmap row whose artifact_type is agent_issue is the twin of a TRACKER-SYNC-1 ticket and is never a GitHub issue, whatever source writes it; the source best-practice-2026 had doubled 31 tickets in an hour. 0.8.0 PORTFOLIO-NOT-ISSUES-1 (owner question 2026-10-26 "why are there over 800 GitHub issues?", pillar autonomy; minor: the worker now decides which roadmap sources are Issues): 181 of the 381 open roadmap issues could never close or were a second ticket (77 projects, 75 metric-breach twins of METRIC-TRIGGER issues, 29 failure_modes registry rows). Sources with mirrored = 0 in roadmap_mirror_scope (default projects, metric-breach, failure_modes while the table is absent) are no longer filed, are never placed, and an open GitHub issue for one is closed not_planned with a comment that says it is not a verification and is never reopened; the public /roadmap count skips them. // 0.7.6 FLEET-PR-SHARE-1 (agent_issues 100420): hourly fleet_authored_pr_share_7d from two GitHub search counts; CLOSE-PROVENANCE-1 also finds RED-DRAIN-1 goals. // 0.7.5 CLOSE-PROVENANCE-1: a completed close comment names the merged fleet PR, or states that no code changed. // 0.7.4 HEALTH-CONTRACT-1 (agent_issues 2852, capability_contract_conformance, pillar autonomy; patch, no behaviour change): /health declares capabilities[] and limitations[] (module constants CAPABILITIES and LIMITATIONS), so the fleet snapshot counts this worker as conforming (it was one of the two empty rows holding the metric at 0.9412). // 0.7.3 MODEL-FLOOR-GUARD-RUNS-OBJECT-1 (agent_issues 100258, pillar autonomy; patch: a read that always came back empty): the workflow-runs endpoint answers an object {workflow_runs: [...]}, and paginate() keeps only array bodies, so recordModelFloorGuardRun never created model_floor_guard_runs (the table does not exist in qnfo-audit) and modelFloorGuardVisibility (0.7.2) wrote status "empty", runs 0 on every run although the workflow has 400+ runs on main. DESIRED_REPO is the settings object, not a repository name, so both also built the path QNFO/[object Object] (the recorder returned before its first read, the visibility call would have answered 404); both now name qnfo-workers as mainRulesVisibility does. Both now read body.workflow_runs through workflowRuns(), and a non-200 answer is recorded as status http_<n> instead of reading as no runs. model-floor-guard-visibility.test.mjs. // 0.7.0 PROTECTION-VISIBLE-1 (agent_issues 2927 INTEG-GITHUB-HARDEN-1, pillar security): the branch-protection step ignored every answer except 404 and 200, so a credential that cannot read protection (403 "Resource not accessible by integration") produced repos_protected 0, errors 0 and drift 0 for every run since 2026-10-17 while 55 public repositories stayed unprotected. A GET that answers anything else is now counted (result.protection_unreadable: count, status map, GitHub's own text, an example repository) and written as one limitation; and the run records the rules that apply to QNFO/qnfo-workers main (result.main_rules: status, rule types, whether required_status_checks and pull_request are among them; one public GET), so the DoD of 2927 is a number in github_steward_runs.detail on every tick. // 0.6.0 CRON-GRID-1 (owner directive 2026-10-19, pillar autonomy): the tracker tick moves to the 5-minute grid (:05, :15 ... :55) and the repository reconcile runs hourly on the :15 fire (it ran every 6 hours on its own trigger). Every fire is logged to cron_fire_log for CRON-WATCH-1. // 0.5.0 TRACKER-DRAIN-1 (agent_issues 2940 follow-up): ISSUE-SYNC-FORWARD-1 closes the GitHub issue of a resolved worker-observability dispatch row (and reopens it on a recurrence, before the reverse leg can swallow it); the state sync runs oldest D1 change first inside a time/subrequest budget and stops on 403/429 instead of a flat 20; the mass-flip guard refuses only unexplained disagreement (explained = D1 moved across open/closed since the link last agreed, not an updated_at window); a 403 stops the tick only when GitHub says rate limit (one shared flag), a per-issue 403 is skipped; the subrequest budget counts D1 calls; one status mapping (monitoring is closed not_planned naming its twin, never a completed close with no evidence); superseded attempt PRs outside the recent window are matched by stem and recorded with head_ref and task_ref; v_tracker_drift gains age_min and metric tracker_drift_oldest_min. // 0.4.8 TRACKER-REPAIR-ROUND-1 (agent_issues 2940): a codeagent-<stem>-rN pull request of an earlier repair round is matched to its task by the branch stem, so it is no longer pr-without-task drift. // 0.4.6 PORTFOLIO-HEARTBEAT-1 (2026-10-18): publish the portfolio run as in_progress BEFORE the work, so a tick killed by the CPU budget is distinguishable from a record that was never writtenIVENESS-1 (2026-10-18): this worker, on its own 10-minute cron and outside the qnfo-code-orchestrator process, reads the freshest fleet_crons.last_fired and files liveness:dispatcher-stalled when the per-minute dispatcher has been quiet for over 20 minutes -- the one stall no watchdog inside that failure domain can report, because NEVER-STALL-1 is itself a fleet_cron dispatched by the tick it would be reporting on. // 0.4.4 NOTIFY-ATTEMPT-TITLE-1 (2026-10-18): a re-run notification title ("workflow run, Attempt #2 failed") is parsed like the first attempt, so its resolved thread is cleared (three were kept at 10:52Z). // 0.4.3 TRACKER-SYNC-1: stale pr-without-task rows are cleared every tick; a merge fix reads merged_by from the single PR; 0.4.2 TRACKER-SYNC-1: the recent-PR window is a deliberate partial read (every post-backfill tick refused it); 0.4.1 org projects declared on (the portfolio board needs them); 0.4.0 PORTFOLIO-SYNC-1: projects derived from the census, metric breaches as roadmap objectives, programs/projects/issues/roadmap mirrored to GitHub labels, milestones, issues and a Projects board every 10 minutes; 0.3.1 a task is matched to its PR by number too (pr-without-task false positive on PR 381); 0.3.0 TRACKER-SYNC-1: agent_issues <-> GitHub issues and code_tasks <-> PRs every 10 minutes (0.2.2 ISSUE-SYNC-1)

// 0.11.0 REPOSITORY-AGE-POLICY-1 (pillar autonomy): seven-day not-planned issues stay closed; canonical D1 work stays open.
// 0.12.0 CODE-CHANGE-REQUIRED-1 (QNFO.OPS, autonomy): attach implementation DoD to all created or body-updated issues.
var ORG = "QNFO";
var USER = "rwnq8";
var API = "https://api.github.com";

/* Declared end state. Everything here is reversible; nothing here deletes anything. */
var DESIRED_ORG = {
  default_repository_permission: "read",
  members_can_create_public_repositories: false,
  /* PORTFOLIO-SYNC-1: the org Projects (v2) board "QNFO Fleet Portfolio" needs organization projects enabled; with it off,
   * createProjectV2 fails with a bare "Something went wrong" (measured 2026-10-18 10:11Z and 10:15Z). */
  has_organization_projects: true
};
var DESIRED_REPO = {
  delete_branch_on_merge: true,
  allow_auto_merge: true,
  allow_update_branch: true,
  allow_squash_merge: true,
  allow_merge_commit: false,
  allow_rebase_merge: false,
  has_projects: false
};
/* Fields the free plan refuses on private repositories. Recorded, not retried as errors. */
var PAID_ONLY_IF_PRIVATE = { allow_auto_merge: true };
var PROTECTION = {
  required_status_checks: {
    strict: true,
    contexts: ["gate", "guard", "mirror-guard", "identity-guard"]
  },
  enforce_admins: false,
  required_pull_request_reviews: {
    required_approving_review_count: 1,
    dismiss_stale_reviews: true,
    require_code_owner_reviews: true
  },
  restrictions: null,
  required_linear_history: false,
  allow_force_pushes: false,
  allow_deletions: false,
  block_creations: false,
  required_conversation_resolution: false,
  lock_branch: false,
  allow_fork_syncing: false
};

/* Subrequests spent by this isolate; a tick budget (tsBudget) reads the difference, so no reset is needed. */
var GH_CALLS = 0;
/* TRACKER-RATE-LIMIT-1: one flag for every stage of a tick. A response is a rate limit only when GitHub says so: 429, or a 403 that
 * carries Retry-After, x-ratelimit-remaining 0 or a rate-limit/abuse/secondary message. Any other 403 (a locked or forbidden issue)
 * is that issue's refusal and the loop moves on. gh() latches the first limit for Retry-After seconds (60 s default, at most 600),
 * every later stage reads ghLimited() and makes no further call, and trackerSync copies it to the tick result. */
var GH_LIMIT = null;
function ghLimited() { return !!GH_LIMIT && Date.now() < GH_LIMIT.until; }
function ghIsLimit(status, headers, text) {
  if (status === 429) return true;
  if (status !== 403) return false;
  var h = function (k) { return headers && headers.get ? headers.get(k) : null; };
  return !!h("retry-after") || h("x-ratelimit-remaining") === "0" || /rate limit|abuse|secondary/i.test(String(text || "").slice(0, 400));
}
function gh(env, method, path, body) {
  GH_CALLS++;
  if ((method === "POST" || method === "PATCH") && /\/issues(?:\/\d+)?$/.test(path) && body && typeof body.body === "string") {
    body = Object.assign({}, body, { body: issueCodeDelivery(body.body) });
  }
  var init = {
    method: method,
    headers: {
      Authorization: "Bearer " + env.GITHUB_TOKEN,
      Accept: "application/vnd.github+json",
      "User-Agent": "qnfo-github-steward/" + VERSION,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json"
    }
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  return fetch(API + path, init).then(function (r) {
    return r.text().then(function (t) {
      var j = null;
      try { j = t ? JSON.parse(t) : null; } catch (e) { j = null; }
      var limited = ghIsLimit(r.status, r.headers, t);
      if (limited) { var ra = Number(r.headers && r.headers.get && r.headers.get("retry-after")); if (!ghLimited()) GH_LIMIT = { status: r.status, until: Date.now() + (ra > 0 ? Math.min(ra, 600) : 60) * 1000 }; }
      return { status: r.status, body: j, text: t, limited: limited };
    });
  });
}

function issueCodeDelivery(body) {
  var dod = "## Definition of done (CODE-CHANGE-REQUIRED-1)\n\nImplement this issue's remedy in code, an applied migration or executable configuration in a linked PR. Identify the changed implementation paths, run regression checks, and verify the outcome after canonical deployment before closing the issue. An empty, documentation-only or investigation-only PR does not satisfy this contract. If the implementation already exists, record evidence on this issue instead of opening a no-change PR.";
  var text = String(body || "");
  return text.indexOf(dod) >= 0 ? text : text + "\n\n" + dod;
}

/* GitHub's seven-day administrative disposition is not evidence that canonical D1 work finished. */
function agePolicyClosed(issue, nowMs) {
  var created = Date.parse(issue && issue.created_at);
  return !!issue && !issue.pull_request && issue.state === "closed" && issue.state_reason === "not_planned"
    && Number.isFinite(created) && nowMs - created > 7 * 24 * 60 * 60000;
}
async function reopenIssue(env, path, body) {
  var current = await gh(env, "GET", path);
  if (current.status !== 200) return current;
  if (!current.body || (current.body.state !== "open" && current.body.state !== "closed")) {
    return { status: 502, text: "Issue state unreadable; no reopen attempted", limited: false };
  }
  if (agePolicyClosed(current.body, Date.now())) return { ...current, age_policy_closed: true };
  return gh(env, "PATCH", path, body);
}

async function paginate(env, path) {
  var out = [], page = 1;
  while (page <= 20) {
    var sep = path.indexOf("?") >= 0 ? "&" : "?";
    var r = await gh(env, "GET", path + sep + "per_page=100&page=" + page);
    if (r.status !== 200 || !Array.isArray(r.body)) break;
    out = out.concat(r.body);
    if (r.body.length < 100) break;
    page++;
  }
  return out;
}

async function reconcileOrg(env, result) {
  var r = await gh(env, "GET", "/orgs/" + ORG);
  if (r.status !== 200) {
    result.errors.push({ scope: "org:" + ORG, status: r.status, why: "cannot read org" });
    return;
  }
  var patch = {};
  Object.keys(DESIRED_ORG).forEach(function (k) {
    if (r.body[k] !== DESIRED_ORG[k]) patch[k] = DESIRED_ORG[k];
  });
  if (!Object.keys(patch).length) { result.org_ok = true; return; }
  var w = await gh(env, "PATCH", "/orgs/" + ORG, patch);
  if (w.status === 200) {
    result.org_fixed = Object.keys(patch);
    result.drift.push({ scope: "org", field: Object.keys(patch).join(","), fixed: true });
  } else {
    result.errors.push({ scope: "org", status: w.status, why: String(w.text).slice(0, 160) });
  }
}

/* PROTECTION-VISIBLE-1 (agent_issues 2927). Pure bookkeeping: one aggregate per run, never one entry per repository. */
function protectionUnreadable(result, full, r) {
  var b = result.protection_unreadable || (result.protection_unreadable = { count: 0, statuses: {}, sample: null, example_repo: null });
  b.count++;
  b.statuses[r.status] = (b.statuses[r.status] || 0) + 1;
  if (!b.sample) { b.sample = String(r.text || "").slice(0, 160); b.example_repo = full; }
}
function protectionLimitation(result) {
  var b = result.protection_unreadable;
  if (!b) return;
  result.limitations.push("branch_protection: GET /branches/<default>/protection answered " + JSON.stringify(b.statuses) + " for " + b.count +
    " public repositories (e.g. " + b.example_repo + ": " + b.sample + "); this credential cannot read branch protection, so it is never reconciled here (INTEG-GITHUB-HARDEN-1)");
}
/* The rules that apply to the default branch of the fleet's own repository, from the public rules endpoint (rulesets and classic
 * protection together). The DoD of agent_issues 2927 is "an active main ruleset with required checks": this is that fact, per tick. */
async function mainRulesVisibility(env, result) {
  var r = await gh(env, "GET", "/repos/" + ORG + "/qnfo-workers/rules/branches/main");
  var types = [];
  if (r.status === 200 && Array.isArray(r.body)) r.body.forEach(function (x) { if (x && x.type && types.indexOf(x.type) < 0) types.push(x.type); });
  types.sort();
  result.main_rules = {
    status: r.status, types: types,
    required_checks: types.indexOf("required_status_checks") >= 0 ? "yes" : "no",
    pull_request_required: types.indexOf("pull_request") >= 0 ? "yes" : "no"
  };
}

async function reconcileRepo(env, listed, result) {
  var full = listed.full_name;
  var isPrivate = listed.private === true;
  /* GITHUB-STEWARD-1 fix: the LIST endpoint omits delete_branch_on_merge, allow_update_branch,
   * allow_auto_merge and the merge-method flags, so comparing against it reads every field as
   * "drifted", PATCHes 61 repositories that were already correct, and reports 61 phantom fixes.
   * The single-repository endpoint carries the full settings object; compare against that. */
  var one = await gh(env, "GET", "/repos/" + full);
  var repo = (one.status === 200 && one.body) ? one.body : listed;
  var patch = {};
  Object.keys(DESIRED_REPO).forEach(function (k) {
    if (repo[k] === DESIRED_REPO[k]) return;
    if (isPrivate && PAID_ONLY_IF_PRIVATE[k]) {
      result.limitations.push(full + ":" + k + " (needs GitHub Pro on a private repo)");
      return;
    }
    patch[k] = DESIRED_REPO[k];
  });

  if (Object.keys(patch).length) {
    var w = await gh(env, "PATCH", "/repos/" + full, patch);
    if (w.status === 200) {
      result.repos_fixed++;
      Object.keys(patch).forEach(function (k) {
        result.drift.push({ scope: full, field: k, fixed: true });
      });
    } else if (w.status === 403 && isPrivate) {
      result.limitations.push(full + ":" + Object.keys(patch).join(",") + " (403 plan limit)");
    } else {
      result.errors.push({ scope: full, status: w.status, why: String(w.text).slice(0, 140) });
    }
  }

  /* Default branch must not be a working branch. Only auto-corrects when the target exists. */
  var br = repo.default_branch || "main";
  if (/^(feature|slb|ump|res|plt|dem|inm|cfe)\//.test(br)) {
    result.drift.push({ scope: full, field: "default_branch=" + br, fixed: false, note: "working branch is the default" });
  }

  /* Branch protection: one GET, one PUT at most, public repositories only. */
  if (!isPrivate) {
    var cur = await gh(env, "GET", "/repos/" + full + "/branches/" + br + "/protection");
    if (cur.status === 404) {
      var p = await gh(env, "PUT", "/repos/" + full + "/branches/" + br + "/protection", PROTECTION);
      if (p.status === 200) {
        result.repos_protected++;
        result.drift.push({ scope: full, field: "branch_protection", fixed: true });
      } else {
        result.errors.push({ scope: full, status: p.status, why: "protection: " + String(p.text).slice(0, 120) });
      }
    } else if (cur.status === 200) {
      var ap = cur.body || {};
      var weak = [];
      if (ap.allow_force_pushes && ap.allow_force_pushes.enabled) weak.push("force-pushes-allowed");
      if (ap.allow_deletions && ap.allow_deletions.enabled) weak.push("deletions-allowed");
      if (weak.length) {
        var fix = await gh(env, "PUT", "/repos/" + full + "/branches/" + br + "/protection", PROTECTION);
        result.drift.push({ scope: full, field: "protection:" + weak.join(","), fixed: fix.status === 200 });
      }
    } else if (!cur.limited) {
      /* PROTECTION-VISIBLE-1: any other answer (403 for a credential without Administration, 401, 5xx) used to fall through here
       * silently. Count it; runReconcile turns the count into one limitation. A rate limit is not a refusal and is left to GH_LIMIT. */
      protectionUnreadable(result, full, cur);
    }
  } else {
    result.limitations.push(full + ":branch_protection (needs GitHub Pro on a private repo)");
  }
}

async function auditWorkflows(env, repo, result) {
  var r = await gh(env, "GET", "/repos/" + repo.full_name + "/actions/workflows");
  if (r.status !== 200 || !r.body || !r.body.workflows) return;
  var staticOnes = r.body.workflows.filter(function (w) {
    return String(w.path || "").indexOf("dynamic/") !== 0;
  });
  if (!staticOnes.length) return;
  result.workflows += staticOnes.length;
  for (var i = 0; i < staticOnes.length; i++) {
    var w = staticOnes[i];
    var f = await fetch("https://raw.githubusercontent.com/" + repo.full_name + "/" + (repo.default_branch || "main") + "/" + w.path, {
      headers: { "User-Agent": "qnfo-github-steward/" + VERSION }
    });
    if (!f.ok) continue;
    var t = await f.text();
    var issues = [];
    if (t.indexOf("permissions:") < 0) issues.push("no-permissions-block");
    if (t.indexOf("concurrency:") < 0) issues.push("no-concurrency");
    if (t.indexOf("timeout-minutes") < 0) issues.push("no-timeout");
    if (/(uses:\s*[\w\-\.\/]+@)(main|master|HEAD)\b/.test(t)) issues.push("floating-ref");
    if (issues.length) {
      result.workflow_issues.push({ repo: repo.full_name, path: w.path, issues: issues });
    }
  }
}

/* NOTIFY-TRIAGE-1 (2026-10-18): the owner's GitHub inbox held 113 unread threads, 111 of them
 * "workflow run failed" CheckSuite notices that GitHub never retracts once the failure is fixed.
 * Each run reads the unread threads and marks a thread DONE only when its cause is PROVABLY
 * resolved: a newer completed run of the same workflow on the same branch succeeded, the branch's
 * pull request is closed or merged, the branch no longer exists, or the issue / PR subject is
 * closed. Anything unproven stays unread, so the inbox shows only live failures. Never touches
 * code, runs or issues; DELETE /notifications/threads/{id} only marks the thread done. */
var NOTIFY_STALE_DAYS = 14;
async function triageNotifications(env, result) {
  var t = { seen: 0, done: 0, kept: [], errors: 0, reasons: {} };
  result.notifications = t;
  // the notifications API caps per_page at 50, so paginate() (which stops below 100) would read one page only
  var list = [];
  for (var pg = 1; pg <= 20; pg++) {
    var rp = await gh(env, "GET", "/notifications?all=false&per_page=50&page=" + pg);
    if (rp.status !== 200 || !Array.isArray(rp.body)) { if (rp.status !== 200) result.errors.push({ scope: "notifications", why: "list " + rp.status }); break; }
    list = list.concat(rp.body);
    if (rp.body.length < 50) break;
  }
  t.seen = list.length;
  var runCache = {}, prCache = {}, branchCache = {};
  var wfCache = {};
  // per-workflow query: a branch-wide "newest 100 runs" window drops a quiet workflow on a busy branch
  async function latestRun(repo, wf, branch) {
    if (!wfCache[repo]) {
      var w = await gh(env, "GET", "/repos/" + repo + "/actions/workflows?per_page=100");
      wfCache[repo] = (w.status === 200 && w.body && w.body.workflows) || [];
    }
    var ids = wfCache[repo].filter(function (x) { return x.name === wf; }).map(function (x) { return x.id; });
    var best = null;
    for (var j = 0; j < ids.length; j++) {
      var k = repo + "|" + ids[j] + "|" + branch;
      if (runCache[k] === undefined) {
        // a cancelled or skipped run (concurrency superseded) says nothing; the verdict is the newest success/failure
        var r = await gh(env, "GET", "/repos/" + repo + "/actions/workflows/" + ids[j] + "/runs?status=completed&per_page=10&branch=" + encodeURIComponent(branch));
        var wr = (r.status === 200 && r.body && r.body.workflow_runs) || [];
        runCache[k] = wr.filter(function (x) { return x.conclusion === "success" || x.conclusion === "failure" || x.conclusion === "timed_out"; })[0] || null;
      }
      var cand = runCache[k];
      if (cand && (!best || Date.parse(cand.created_at) > Date.parse(best.created_at))) best = cand;
    }
    return best;
  }
  async function branchPr(repo, branch) {
    var k = repo + "|" + branch;
    if (prCache[k] === undefined) {
      var owner = repo.split("/")[0];
      var r = await gh(env, "GET", "/repos/" + repo + "/pulls?state=all&per_page=5&head=" + encodeURIComponent(owner + ":" + branch));
      prCache[k] = (r.status === 200 && Array.isArray(r.body) && r.body[0]) || null;
    }
    return prCache[k];
  }
  async function branchGone(repo, branch) {
    var k = repo + "|" + branch;
    if (branchCache[k] === undefined) {
      var r = await gh(env, "GET", "/repos/" + repo + "/branches/" + encodeURIComponent(branch));
      branchCache[k] = r.status === 404;
    }
    return branchCache[k];
  }
  for (var i = 0; i < list.length; i++) {
    var n = list[i], why = null;
    try {
      var repo = n.repository && n.repository.full_name;
      var title = (n.subject && n.subject.title) || "";
      var type = n.subject && n.subject.type;
      if (type === "CheckSuite") {
        // NOTIFY-ATTEMPT-TITLE-1: a re-run reads "<wf> workflow run, Attempt #2 failed for <b> branch"
        var m = title.match(/^(.+) workflow run(?:, Attempt #\d+)? (?:failed|cancelled|timed out)(?: for (.+) branch)?$/);
        if (m) {
          var wf = m[1], br = m[2] || (n.repository && n.repository.default_branch) || "main";
          var run = await latestRun(repo, wf, br);
          if (run && run.conclusion === "success" && Date.parse(run.created_at) <= Date.now()) why = "rerun-green";
          if (!why && br !== "main" && br !== "master") {
            var pr = await branchPr(repo, br);
            if (pr && pr.state === "closed") why = pr.merged_at ? "pr-merged" : "pr-closed";
            else if (!pr && await branchGone(repo, br)) why = "branch-deleted";
          }
        }
      } else if ((type === "Issue" || type === "PullRequest") && n.subject.url) {
        var s = await gh(env, "GET", n.subject.url.replace(API, ""));
        if (s.status === 200 && s.body && s.body.state === "closed") why = "subject-closed";
        else if (s.status === 404 || s.status === 410) why = "subject-gone";
      } else if (type === "Release" || type === "Discussion" || type === "Commit") {
        why = "informational";
      }
      if (!why && Date.parse(n.updated_at) < Date.now() - NOTIFY_STALE_DAYS * 864e5 && type === "CheckSuite") why = "stale";
      if (why) {
        var d = await gh(env, "DELETE", "/notifications/threads/" + n.id);
        if (d.status === 204 || d.status === 205 || d.status === 200) { t.done++; t.reasons[why] = (t.reasons[why] || 0) + 1; }
        else { t.errors++; if (t.errors === 1) result.errors.push({ scope: "notifications", why: "mark-done " + d.status + " " + String(d.text).slice(0, 100) }); }
      } else {
        t.kept.push({ id: n.id, repo: repo, type: type, title: title.slice(0, 120), updated_at: n.updated_at });
      }
    } catch (e) {
      t.errors++;
      result.errors.push({ scope: "notification " + n.id, why: String(e && e.message || e).slice(0, 140) });
    }
  }
  return t;
}
// end NOTIFY-TRIAGE-1
/* ISSUE-SYNC-1 (owner directive 2026-10-18): keep internal issue tracking and GitHub issues in
 * sync at all times. fleet_issue_dispatch rows that are queued or tracked and still carry no
 * gh_number are the internal backlog; each is mirrored to a GitHub issue on QNFO/qnfo-workers and
 * the number is written back. Idempotent (a row with gh_number is skipped) and fail-safe (a create
 * error is recorded and the row stays queued for the next run, never retried as drift). */
async function issueSync(env, result) {
  if (!env.AUDIT) return;
  if (ghLimited()) { result.issue_sync = { mirrored: 0, failed: 0, backlog_seen: 0, skipped: "rate limited" }; return; }
  try {
    var rows = await env.AUDIT.prepare(
      "SELECT fingerprint, category, sev, owner, payload, gh_number FROM fleet_issue_dispatch WHERE state IN ('queued','tracked') AND (gh_number IS NULL OR gh_number = '') LIMIT 20"
    ).all();
    var list = rows.results || [];
    var created = 0, failed = 0;
    for (var i = 0; i < list.length; i++) {
      var row = list[i];
      var title = "";
      try {
        var p = JSON.parse(row.payload || "{}");
        var svc = p.service || row.owner || "fleet";
        var t = typeof p.title === "string" ? p.title : "";
        title = ("[fleet] " + svc + " · " + (row.category || "issue") + (t ? ": " + t : "")).slice(0, 240);
      } catch (e) {
        title = ("[fleet] " + (row.owner || "fleet") + " · " + (row.category || "issue")).slice(0, 240);
      }
      var body = [
        "Mirrored from internal issue tracking (`qnfo-audit.fleet_issue_dispatch`).",
        "",
        "- fingerprint: `" + row.fingerprint + "`",
        "- category: `" + (row.category || "") + "`",
        "- severity: `" + (row.sev || "") + "`",
        "- owner: `" + (row.owner || "") + "`",
        "",
        "```",
        String(row.payload || "").slice(0, 2800),
        "```",
        "",
        "Filed automatically by qnfo-github-steward (ISSUE-SYNC-1)."
      ].join("\n");
      var c = await gh(env, "POST", "/repos/" + ORG + "/qnfo-workers/issues", { title: title, body: body });
      if (c.status === 201 && c.body && c.body.number) {
        await env.AUDIT.prepare(
          "UPDATE fleet_issue_dispatch SET gh_number = ?, state = 'tracked', exec_state = 'created', exec_ts = ? WHERE fingerprint = ?"
        ).bind(String(c.body.number), new Date().toISOString(), row.fingerprint).run();
        created++;
      } else {
        failed++;
        result.errors.push({ scope: "issue-sync:" + row.fingerprint, status: c.status, why: String(c.text).slice(0, 120) });
        if (c.limited) break; /* rate limited: the rest waits for the next tick */
      }
    }
    result.issue_sync = { mirrored: created, failed: failed, backlog_seen: list.length };
  } catch (e) {
    result.errors.push({ scope: "issue-sync", why: String(e && e.message || e).slice(0, 160) });
  }
}

/* ISSUE-SYNC-REVERSE-1 (owner directive 2026-10-18): reflect closed GitHub issues back into
 * internal tracking. A fleet_issue_dispatch row that carries a gh_number but is still 'tracked'
 * is checked against its GitHub issue; a closed issue marks the internal row 'done'. Idempotent,
 * read-mostly, and fail-safe (an API error leaves the row tracked for the next run). */
async function issueSyncReverse(env, result) {
  if (!env.AUDIT) return;
  if (ghLimited()) { result.issue_sync_reverse = { closed: 0, still_open: 0, errored: 0, checked: 0, skipped: "rate limited" }; return; }
  try {
    var rows = await env.AUDIT.prepare(
      "SELECT fingerprint, gh_number FROM fleet_issue_dispatch WHERE state = 'tracked' AND gh_number IS NOT NULL AND gh_number != '' AND COALESCE(exec_state, '') <> 'closed-by-sync' LIMIT 50"
    ).all();
    var list = rows.results || [];
    var closed = 0, stillOpen = 0, errored = 0, ageClosed = 0;
    for (var i = 0; i < list.length; i++) {
      var row = list[i];
      var g = await gh(env, "GET", "/repos/" + ORG + "/qnfo-workers/issues/" + row.gh_number);
      if (g.status === 200 && agePolicyClosed(g.body, Date.now())) { ageClosed++; continue; }
      if (g.status === 200 && g.body && g.body.state === "closed") {
        await env.AUDIT.prepare(
          "UPDATE fleet_issue_dispatch SET state = 'done', exec_state = 'closed', exec_ts = ? WHERE fingerprint = ?"
        ).bind(new Date().toISOString(), row.fingerprint).run();
        closed++;
      } else if (g.status === 200) {
        stillOpen++;
      } else {
        errored++;
        if (g.limited) { result.errors.push({ scope: "issue-sync-reverse", status: g.status, why: "rate limited; the rest waits for the next tick" }); break; }
      }
    }
    // ISSUE-SYNC-REVERSE-2 (#99921 tracker drift): D1 is authoritative for fleet_issue_dispatch
    // state. A row already marked 'done' via reverse sync must stay closed on GitHub; if a human
    // reopened it, push it back to closed so the two trackers stay in agreement.
    var forcedClosed = 0;
    var listDone = [];
    try {
      listDone = (await env.AUDIT.prepare(
        "SELECT fingerprint, gh_number FROM fleet_issue_dispatch WHERE state = 'done' AND gh_number IS NOT NULL AND gh_number != '' AND exec_state = 'closed' LIMIT 20"
      ).all()).results || [];
      for (var k = 0; k < listDone.length; k++) {
        var drow = listDone[k];
        var gi = await gh(env, "GET", "/repos/" + ORG + "/qnfo-workers/issues/" + drow.gh_number);
        if (gi.status === 200 && agePolicyClosed(gi.body, Date.now())) { continue; }
        if (gi.status === 200 && gi.body && gi.body.state === "open") {
          await gh(env, "POST", "/repos/" + ORG + "/qnfo-workers/issues/" + drow.gh_number + "/comments", { body: "Closed by ISSUE-SYNC-REVERSE-2: this issue was manually reopened while the corresponding `fleet_issue_dispatch` row is already resolved in qnfo-audit. D1 is authoritative for this state." });
          var closeRes = await gh(env, "PATCH", "/repos/" + ORG + "/qnfo-workers/issues/" + drow.gh_number, { state: "closed", state_reason: "completed" });
          if (closeRes.status >= 200 && closeRes.status < 300) {
            await env.AUDIT.prepare(
              "UPDATE fleet_issue_dispatch SET exec_result = ?, exec_ts = ? WHERE fingerprint = ?"
            ).bind("re-closed GitHub issue " + drow.gh_number + " to match D1 done state", new Date().toISOString(), drow.fingerprint).run();
            forcedClosed++;
          } else {
            result.errors.push({ scope: "issue-sync-reverse-force:" + drow.fingerprint, status: closeRes.status, why: String(closeRes.text).slice(0, 120) });
            if (closeRes.limited) break;
          }
        }
      }
    } catch (e) {
      result.errors.push({ scope: "issue-sync-reverse-force", why: String(e && e.message || e).slice(0, 160) });
    }
    result.issue_sync_reverse = { closed: closed, still_open: stillOpen, forced_closed: forcedClosed, age_policy_closed: ageClosed, errored: errored, checked: list.length + listDone.length };
  } catch (e) {
    result.errors.push({ scope: "issue-sync-reverse", why: String(e && e.message || e).slice(0, 160) });
  }
}

/* ISSUE-SYNC-FORWARD-1 (agent_issues 2940 follow-up, clusters cf-obs-mirror-never-closes and fleet-issue-dispatch-github-mirror-never-closes):
 * ISSUE-SYNC-1 mirrors a Cloudflare Observability group (fleet_issue_dispatch, category worker-observability) to a GitHub
 * issue and ISSUE-SYNC-REVERSE-1 copies a GitHub close back, but nothing closed the GitHub issue when pollObservability resolved
 * the group: 42 [fleet] issues stayed open for good (measured 2026-10-19 05:50Z, 48 resolved rows with exec_state created).
 * Forward: a resolved row whose issue is open gets a comment and a completed close, exec_state closed-by-sync; an issue already
 * closed is only recorded (a GET, no write). Relapse: pollObservability re-sets state tracked on recurrence and leaves exec_state
 * alone, so tracked + closed-by-sync means the group came back; the issue is reopened BEFORE issueSyncReverse runs (otherwise the
 * reverse leg reads the closed issue and flips the row to done, and the recurrence is silent), and the reverse leg skips a
 * closed-by-sync row whose reopen failed. Oldest first, a bounded batch, stop on 403/429. */
var TS_FORWARD_PER_TICK = 20;
async function issueSyncForward(env, result) {
  if (ghLimited()) { result.issue_sync_forward = { closed: 0, already_closed: 0, reopened: 0, errored: 0, checked: 0, carried: 0, rate_limited: true, skipped: "rate limited earlier in this tick" }; return; }
  if (!env.AUDIT) return;
  var res = { closed: 0, already_closed: 0, reopened: 0, errored: 0, checked: 0, carried: 0, rate_limited: false };
  result.issue_sync_forward = res;
  try {
    var rows = ((await env.AUDIT.prepare(
      "SELECT fingerprint, gh_number FROM fleet_issue_dispatch WHERE category = 'worker-observability' AND state = 'tracked' AND exec_state = 'closed-by-sync' AND gh_number IS NOT NULL AND gh_number != '' ORDER BY COALESCE(exec_ts, '') LIMIT ?"
    ).bind(TS_FORWARD_PER_TICK).all()).results) || [];
    for (var j = 0; j < rows.length; j++) {
      var b = rows[j];
      var ro = await reopenIssue(env, TS_REPO + "/issues/" + b.gh_number, { state: "open" });
      if (ro.age_policy_closed) { res.age_policy_closed = (res.age_policy_closed || 0) + 1; continue; }
      if (ro.limited) { res.rate_limited = true; result.errors.push({ scope: "issue-sync-forward-reopen", status: ro.status, why: String(ro.text).slice(0, 100) }); return; }
      if (ro.status < 200 || ro.status >= 300) {
        /* a per-issue refusal: stamp exec_ts so the row moves behind the others (the queue is oldest exec_ts first) and is retried */
        res.errored++; result.errors.push({ scope: "issue-sync-forward-reopen:" + b.fingerprint, status: ro.status, why: String(ro.text).slice(0, 100) });
        await env.AUDIT.prepare("UPDATE fleet_issue_dispatch SET exec_ts = ?, exec_result = ? WHERE fingerprint = ?").bind(new Date().toISOString(), "forward-reopen failed: " + ro.status, b.fingerprint).run();
        continue;
      }
      await gh(env, "POST", TS_REPO + "/issues/" + b.gh_number + "/comments", { body: "Reopened by ISSUE-SYNC-FORWARD-1: the Cloudflare Observability group `" + tsRedact(b.fingerprint) + "` is tracked again in qnfo-audit (it recurred after it was closed here)." });
      await env.AUDIT.prepare("UPDATE fleet_issue_dispatch SET exec_state = 'created', exec_ts = ?, exec_result = NULL WHERE fingerprint = ?").bind(new Date().toISOString(), b.fingerprint).run();
      res.reopened++;
    }

    var todo = ((await env.AUDIT.prepare(
      "SELECT fingerprint, gh_number FROM fleet_issue_dispatch WHERE category = 'worker-observability' AND state IN ('resolved', 'done') AND gh_number IS NOT NULL AND gh_number != '' AND COALESCE(exec_state, '') NOT IN ('closed', 'closed-by-sync') ORDER BY COALESCE(exec_attempts, 0), COALESCE(exec_ts, '') LIMIT ?"
    ).bind(TS_FORWARD_PER_TICK + 1).all()).results) || [];
    res.carried = Math.max(0, todo.length - TS_FORWARD_PER_TICK);
    todo = todo.slice(0, TS_FORWARD_PER_TICK);
    for (var i = 0; i < todo.length; i++) {
      var row = todo[i], now = new Date().toISOString();
      res.checked++;
      var g = await gh(env, "GET", TS_REPO + "/issues/" + row.gh_number);
      if (g.limited) { res.rate_limited = true; result.errors.push({ scope: "issue-sync-forward", status: g.status, why: String(g.text).slice(0, 100) }); return; }
      var fail = null;
      if (g.status === 404 || g.status === 410) {
        await env.AUDIT.prepare("UPDATE fleet_issue_dispatch SET exec_state = 'closed', exec_ts = ?, exec_result = ? WHERE fingerprint = ?").bind(now, "forward-close: github issue " + row.gh_number + " is gone (" + g.status + ")", row.fingerprint).run();
        res.already_closed++;
      } else if (g.status === 200 && g.body && g.body.state === "closed") {
        await env.AUDIT.prepare("UPDATE fleet_issue_dispatch SET exec_state = 'closed-by-sync', exec_ts = ?, exec_result = ? WHERE fingerprint = ?").bind(now, "forward-close: github issue already closed", row.fingerprint).run();
        res.already_closed++;
      } else if (g.status === 200 && g.body && g.body.pull_request) {
        fail = "number is a pull request";
      } else if (g.status === 200) {
        await gh(env, "POST", TS_REPO + "/issues/" + row.gh_number + "/comments", { body: "Closed by ISSUE-SYNC-FORWARD-1: the Cloudflare Observability group `" + tsRedact(row.fingerprint) + "` is resolved in qnfo-audit (fleet_issue_dispatch state resolved: it is no longer in the active issue list). It is reopened here if the group recurs." });
        var p = await gh(env, "PATCH", TS_REPO + "/issues/" + row.gh_number, { state: "closed", state_reason: "completed" });
        if (p.status >= 200 && p.status < 300) {
          await env.AUDIT.prepare("UPDATE fleet_issue_dispatch SET exec_state = 'closed-by-sync', exec_ts = ?, exec_result = ? WHERE fingerprint = ?").bind(now, "forward-close: closed github issue " + row.gh_number + " (completed)", row.fingerprint).run();
          res.closed++;
        } else {
          if (p.limited) { res.rate_limited = true; result.errors.push({ scope: "issue-sync-forward", status: p.status, why: String(p.text).slice(0, 100) }); return; }
          fail = "close " + p.status;
        }
      } else fail = "read " + g.status;
      if (fail) {
        res.errored++;
        await env.AUDIT.prepare("UPDATE fleet_issue_dispatch SET exec_attempts = COALESCE(exec_attempts, 0) + 1, exec_result = ? WHERE fingerprint = ?").bind("forward-close failed: " + fail, row.fingerprint).run();
        result.errors.push({ scope: "issue-sync-forward:" + row.fingerprint, why: fail });
      }
    }
  } catch (e) {
    result.errors.push({ scope: "issue-sync-forward", why: String(e && e.message || e).slice(0, 160) });
  }
}


/* TRACKER-SYNC-1 (owner directive 2026-10-18, verbatim: "qnfo-audit.code_tasks AND GITHUB ISSUES/PRS NEED TO BE
 * COORDINATED AND IN-SYNC AT ALL TIMES TO AVOID PHANTOM ISSUES AND INCORRECT METRICS").
 *
 * Measured before this change (2026-10-18 ~09:05Z): 228 open agent_issues, 0 of them on GitHub; code task ct_m3uh71laryg91d
 * 'failed' while its PR 812 had MERGED; 7 codeagent-* PRs with no code_tasks row. Runs every 10 minutes (SLA grid).
 *
 * Authority, so the two sides can never flap:
 *   issue state -> D1 agent_issues (it carries the close-evidence gate). Open in D1 = open on GitHub. A GitHub issue closed
 *                  by hand while D1 is open is reopened with a comment; D1 is never closed without evidence from here.
 *   merge state -> GitHub. A PR that merged marks its code task merged (merged_by github:<login>). Every other disagreement
 *                  is written to code_task_pr_links.drift and surfaces in v_tracker_drift / metric tracker_drift.
 * Public repository: bodies are fenced (no mention or reference expansion), tokens and e-mail addresses are redacted, and
 * personal or security issues are mirrored by number only. Scope (owner choice 2026-10-18): open issues only. */
var TS_REPO = "/repos/" + ORG + "/qnfo-workers";
var TS_LABEL = "fleet-issue";
var TS_CRON = "5,15,25,35,45,55 * * * *";
var TS_CREATE_PER_TICK = 20;
/* TRACKER-STATE-BUDGET-1: the state fixes (close, reopen) were a flat 20 per tick in unspecified order. Measured 2026-10-19 05:43Z:
 * 20 fixes took 46.9 s with no errors, the cap drained a 61-row burst in about three ticks, and the unordered join fixed the newest
 * ids last (one row waited 85 min behind newer ones). The loop now runs oldest D1 change first and stops on a budget, not a count:
 * at least TS_FIX_MIN attempts always run, then it stops at TS_FIX_MS of wall time or TS_FIX_CALLS GitHub subrequests, never
 * more than TS_FIX_MAX attempts (GitHub's secondary limit is about 80 content-creating requests a minute and 500 an hour), and
 * on the first 403/429. The portfolio roadmap twin uses the same budget. A reopen (D1 open, GitHub closed) is a phantom issue
 * and goes first, up to a quarter of TS_FIX_MAX. */
var TS_FIX_MIN = 10, TS_FIX_MAX = 40, TS_FIX_MS = 95000, TS_FIX_CALLS = 110;
var TS_RECLASS_PER_TICK = 8, TS_PR_REVISIT_PER_TICK = 10;
var TS_PRIVATE_CATEGORIES = { personal: 1, security: 1 };

function tsRedact(s) {
  return String(s == null ? "" : s)
    .replace(/(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_\-]{16,}|xox[abpr]-[A-Za-z0-9\-]{10,})/g, "[redacted-token]")
    .replace(/(Bearer|Basic)\s+[A-Za-z0-9._~+\/=\-]{12,}/gi, "$1 [redacted]")
    .replace(/([?&](?:key|token|secret|sig|signature|password|api_key|apikey)=)[^&\s"']+/gi, "$1[redacted]")
    .replace(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/\b[a-f0-9]{40,}\b/gi, "[redacted-hex]");
}

/* A fenced block: GitHub expands no mention, reference or HTML inside it. */
function tsFence(s, max) {
  var t = tsRedact(s).replace(/```/g, "'''");
  if (t.length > max) t = t.slice(0, max) + "\n... (truncated; full text in qnfo-audit)";
  return "```text\n" + t + "\n```";
}

function tsIsPrivate(row) {
  return !!TS_PRIVATE_CATEGORIES[String(row.category || "").toLowerCase()] || /personal/i.test(String(row.source || ""));
}

function tsTitle(row) {
  if (tsIsPrivate(row)) return "[#" + row.id + "] " + String(row.category || "private") + " issue (details kept in qnfo-audit)";
  return ("[#" + row.id + "] " + tsRedact(row.title || "(untitled)").replace(/@/g, "@\u200b")).slice(0, 240);
}

function tsBody(row) {
  var b = [
    "Mirrored from `qnfo-audit.agent_issues` id **" + row.id + "** (TRACKER-SYNC-1). D1 is authoritative for this issue's state:",
    "it closes here when it closes there with evidence, and a hand close here is reopened.",
    "",
    "| field | value |", "|:--|:--|",
    "| priority | " + String(row.priority || "") + " |",
    "| category | " + String(row.category || "") + " |",
    "| source | " + tsRedact(row.source || "").replace(/\|/g, "/").slice(0, 120) + " |",
    "| opened | " + (row.created_at ? new Date(Number(row.created_at)).toISOString() : "") + " |",
    ""
  ];
  if (tsIsPrivate(row)) b.push("Details are not mirrored: personal and security issues stay in qnfo-audit.");
  else b.push(tsFence(row.description || "", 6000));
  return b.join("\n");
}

/* Every page, or null: a partial list must never be read as "these issues are closed". windowOk: the caller asked for the
 * newest maxPages pages only (pull requests sorted by updated), so hitting the page cap is the window, not a failure. */
async function tsListAll(env, path, maxPages, windowOk) {
  var out = [];
  for (var page = 1; page <= maxPages; page++) {
    var r = await gh(env, "GET", path + (path.indexOf("?") >= 0 ? "&" : "?") + "per_page=100&page=" + page);
    if (r.status !== 200 || !Array.isArray(r.body)) return null;
    out = out.concat(r.body);
    if (r.body.length < 100) return out;
  }
  return windowOk ? out : null;
}

async function tsState(env, k, v) {
  if (v === undefined) {
    var r = await env.AUDIT.prepare("SELECT v FROM tracker_sync_state WHERE k = ?").bind(k).first();
    return r ? r.v : null;
  }
  await env.AUDIT.prepare("INSERT INTO tracker_sync_state (k, v, updated_at) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at")
    .bind(k, String(v), new Date().toISOString()).run();
}

/* How a D1 agent_issues status shows on GitHub (TRACKER-STATUS-MAP-1). One table for the worker; migrations/2026-10-19-tracker-drift-age.sql
 * v_tracker_drift uses the same open set (a test reads both). Only 'open' is open on GitHub. 'monitoring' is not a terminal
 * state and no evidence is claimed for it: the 42 rows parked there are twins of a newer open row (agent-issues-reopen-twin-guard),
 * so it is closed as not_planned with a comment naming the live twin. Mapping it to open would put 42 duplicates beside their twins. */
var TS_STATUS_OPEN = { open: 1 };
var TS_STATUS_NOT_PLANNED = { wontfix: 1, monitoring: 1 };
/* ISSUE-ROLLUP-1: priorities that stay one GitHub issue each (ops_config gh_individual_priorities, comma list). Key absent or unreadable = every priority is individual (the old behaviour). */
var TS_INDIVIDUAL = null;
async function tsLoadIndividual(env) {
  try {
    var r = await env.AUDIT.prepare("SELECT value FROM ops_config WHERE key = 'gh_individual_priorities'").first();
    var v = r && String(r.value || "").trim().toLowerCase();
    TS_INDIVIDUAL = v ? v.split(/[,\s]+/).filter(Boolean) : null;
  } catch (e) { TS_INDIVIDUAL = null; }
}
function tsIsRolled(priority, title) {
  if (/^FM-ACTOR-1:/i.test(String(title || "").trim())) return false;
  return !!TS_INDIVIDUAL && TS_INDIVIDUAL.indexOf(String(priority || "").toLowerCase()) < 0;
}
function tsGhWant(status) {
  if (TS_STATUS_OPEN[status]) return { open: true, reason: null };
  return { open: false, reason: TS_STATUS_NOT_PLANNED[status] ? "not_planned" : "completed" };
}

/* The budget counts every subrequest the loop makes: GitHub calls (GH_CALLS) and the D1 calls the loop reports through d1(n); both
 * are subrequests of the invocation. */
function tsBudget(max) {
  var t0 = Date.now(), c0 = GH_CALLS, d1 = 0;
  return {
    d1: function (n) { d1 += n === undefined ? 1 : n; },
    more: function (tried) {
      if (tried >= max) return false;
      if (tried < TS_FIX_MIN) return true;
      return Date.now() - t0 < TS_FIX_MS && GH_CALLS - c0 + d1 < TS_FIX_CALLS;
    }
  };
}

function tsRateLimited(r) { return !!r && !!r.limited; }

/* Oldest D1 change first; reopens lead up to a quarter of the cap, the rest of them follow the closes. */
function tsOrder(mism, isReopen, changedOf, idOf) {
  var by = function (a, b) { return changedOf(a) - changedOf(b) || idOf(a) - idOf(b); };
  var re = mism.filter(isReopen).sort(by), cl = mism.filter(function (l) { return !isReopen(l); }).sort(by);
  var q = Math.ceil(TS_FIX_MAX / 4);
  return re.slice(0, q).concat(cl, re.slice(q));
}

/* The mass-flip guard identifies a label rename or API anomaly, where GitHub differs and D1 has NOT changed. "Explained" is
 * what the link already knows, not a clock: a mismatch is explained when D1 moved across the open/closed line since the last time
 * the two agreed (the link's last-synced d1_status maps to the other GitHub state than the current status). A row whose d1_status
 * already equals its status and whose GitHub side differs is a GitHub-side change (a removed label, a hand close, an API
 * anomaly) however recently agent_issues.updated_at was touched. When unexplained rows exceed half the links, each is read directly
 * by number: a list omission is not treated as a state change, while a confirmed GitHub state change is reconciled from D1. */
function tsGuard(mism, total, explainedOf) {
  var explained = mism.filter(explainedOf);
  var unexplained = mism.length - explained.length;
  if (total >= 10 && unexplained > total / 2) return { rows: explained, refused: unexplained };
  return { rows: mism, refused: 0 };
}

async function tsHasColumn(env, table, col) {
  try { return (((await env.AUDIT.prepare("PRAGMA table_info(" + table + ")").all()).results) || []).some(function (c) { return c.name === col; }); }
  catch (e) { return false; }
}

async function tsTwinGh(env, l) {
  try {
    var r = await env.AUDIT.prepare(
      "SELECT l2.gh_number FROM agent_issues b JOIN gh_issue_links l2 ON l2.issue_id = b.id WHERE b.status = 'open' AND b.id <> ? AND lower(trim(b.title)) = lower(trim(?)) ORDER BY b.id DESC LIMIT 1"
    ).bind(l.issue_id, l.title || "").first();
    return r ? r.gh_number : null;
  } catch (e) { return null; }
}

/* The close comment. Evidence is quoted only when D1 holds it: "(none recorded)" on a public tracker read as a completed fix.
 * A monitoring row says what it is instead of claiming evidence; a close with neither says nothing (the state reason is the record). */
/* CLOSE-PROVENANCE-1 (0.7.5, 2026-10-21, pillar autonomy): every completed close names the code change behind it, or says plainly that
 * there was none, so a close on probe evidence alone no longer reads like a shipped fix. Measured 2026-10-21: 300 of 300 issues closed
 * in 7 days had no linked pull request and the close comment did not say whether code changed. */
async function tsCodeChange(env, issueId) {
  try {
    var rows = (await env.AUDIT.prepare("SELECT pr_url FROM code_tasks WHERE status = 'merged' AND pr_url IS NOT NULL AND (id = ?1 OR goal LIKE ?2 OR goal LIKE ?3) ORDER BY merged_at DESC LIMIT 3").bind("ct_im" + issueId, "[issue #" + issueId + "]%", "%-- issue #" + issueId + " (RED-DRAIN-1%").all()).results || [];
    var prs = rows.map(function (r) { var m = /\/pulls?\/(\d+)/.exec(String(r.pr_url || "")); return m ? "#" + m[1] : null; }).filter(Boolean);
    if (prs.length) return "Code change: fleet pull request " + prs.join(", ") + " (merged).";
    return "Code change: **none** (no fleet pull request merged for this issue; it closed on the probe evidence below alone).";
  } catch (e) { return "Code change: unknown (code_tasks unreadable: " + String(e && e.message).slice(0, 80) + ")."; }
}
async function tsCloseComment(env, l) {
  if (l.status === "monitoring") {
    var twin = await tsTwinGh(env, l);
    return "Closed here by TRACKER-SYNC-1: agent_issues " + l.issue_id + " is status **monitoring** in qnfo-audit, which is not resolved and carries no close evidence. " +
      (twin ? "The work is tracked by its live twin #" + twin + "; this card is closed as not planned and is not a completed fix." : "It is parked under observation, not on the defect register; it is mirrored open again if it returns to status open.");
  }
  var ev = String(l.close_evidence == null ? "" : l.close_evidence).trim();
  if (!ev) return null;
  return "Closed in qnfo-audit (agent_issues " + l.issue_id + ": status **" + String(l.status || "missing") + "**, channel " + String(l.close_channel || "none recorded") + "). " + (await tsCodeChange(env, l.issue_id)) + " Close evidence:\n\n" + tsFence(ev, 3000);
}

async function tsIssues(env, out) {
  var now = new Date().toISOString();
  await tsLoadIndividual(env);
  if (ghLimited()) { out.errors.push({ scope: "tracker-issues", why: "rate limited; no state change this tick" }); return; }
  var open = await tsListAll(env, TS_REPO + "/issues?state=open", 15);
  if (!open) { out.errors.push({ scope: "tracker-issues", why: "could not list open issues; no state change this tick" }); return; }
  var openNums = {}, byId = {};
  open.forEach(function (g) {
    if (g.pull_request) return;
    openNums[g.number] = 1;
    if (!(g.labels || []).some(function (label) { return String(label && label.name || label) === TS_LABEL; })) return;
    var m = /^\[#(\d+)\]/.exec(g.title || "");
    if (m) byId[m[1]] = g.number;
  });

  var hasReason = await tsHasColumn(env, "gh_issue_links", "gh_close_reason");
  var links = (await env.AUDIT.prepare(
    "SELECT l.issue_id, l.gh_number, l.gh_state, l.d1_status, " + (hasReason ? "l.gh_close_reason" : "NULL") + " AS gh_close_reason, a.status, a.priority, a.title, a.updated_at, a.close_channel, t.close_evidence FROM gh_issue_links l LEFT JOIN agent_issues a ON a.id = l.issue_id LEFT JOIN issue_triage t ON t.issue_id = l.issue_id"
  ).all()).results || [];
  var wantOpen = function (l) { return tsGhWant(l.status).open && !(l.status === "open" && tsIsRolled(l.priority, l.title)); };
  var changedOf = function (l) { return Number(l.updated_at) || 0; };
  var mism = links.filter(function (l) { return (wantOpen(l) !== !!openNums[l.gh_number]) && !(wantOpen(l) && l.gh_close_reason === 'age-policy'); });
  var oldest = mism.reduce(function (m, l) { return Math.min(m, changedOf(l) || Date.now()); }, Date.now());
  /* d1_status is the status at the last agreement (refreshed every tick for links that agree): D1 changed since then, or it did not. */
  var explainedOf = function (l) { return (l.status === "open" && tsIsRolled(l.priority, l.title)) || (!!l.d1_status && tsGhWant(l.d1_status).open !== tsGhWant(l.status).open); };
  var guard = tsGuard(mism, links.length, explainedOf), verifyIds = {};
  /* A full-list anomaly must not close open issues. Direct reads distinguish it from real hand state changes. */
  if (guard.refused) {
    out.errors.push({ scope: "tracker-issues", why: guard.refused + " of " + links.length + " links disagree with the open-issue list although D1 has not changed since the last sync; verifying each linked issue before reconciling" });
    mism.forEach(function (l) { if (!explainedOf(l)) verifyIds[l.issue_id] = 1; });
  }
  mism = tsOrder(mism, wantOpen, changedOf, function (l) { return Number(l.issue_id) || 0; });
  var mismIds = {};
  mism.forEach(function (l) { mismIds[l.issue_id] = 1; });
  var fixed = 0, tried = 0, budget = tsBudget(TS_FIX_MAX), limited = null;
  for (var i = 0; i < mism.length && budget.more(tried); i++) {
    var l = mism[i], r, rolled = l.status === "open" && tsIsRolled(l.priority, l.title), want = rolled ? { open: false, reason: "not_planned" } : tsGhWant(l.status), reason = null;
    tried++;
    if (verifyIds[l.issue_id]) {
      var check = await gh(env, "GET", TS_REPO + "/issues/" + l.gh_number);
      if (tsRateLimited(check)) { limited = check.status; out.errors.push({ scope: "tracker-issue-state-check " + l.issue_id, status: check.status, why: "rate limited; the rest waits for the next tick" }); break; }
      var checked = check.body, marker = checked && new RegExp("^\\[#"+ Number(l.issue_id) + "\\]").test(String(checked.title || ""));
      if (check.status !== 200 || !checked || Number(checked.number) !== Number(l.gh_number) || !marker || (checked.state !== "open" && checked.state !== "closed")) {
        out.errors.push({ scope: "tracker-issue-state-check " + l.issue_id, status: check.status, why: check.status === 200 ? "issue identity or state did not match the linked tracker row" : String(check.text || "").slice(0, 120) });
        continue;
      }
      if ((checked.state === "open") === want.open) {
        await env.AUDIT.prepare("UPDATE gh_issue_links SET gh_state = ?, d1_status = ?, synced_at = ? WHERE issue_id = ?").bind(checked.state, l.status || "missing", now, l.issue_id).run();
        fixed++;
        budget.d1(1);
        continue;
      }
    }
    if (want.open) {
      r = await reopenIssue(env, TS_REPO + "/issues/" + l.gh_number, { state: "open" });
      if (r.age_policy_closed) {
  out.age_policy_closed = (out.age_policy_closed || 0) + 1;
  if (hasReason) {
    await env.AUDIT.prepare("UPDATE gh_issue_links SET gh_close_reason = 'age-policy', synced_at = ? WHERE issue_id = ?")
      .bind(now, l.issue_id).run();
    budget.d1(1);
  }
  continue;
}
      if (r.status >= 200 && r.status < 300) {
        await gh(env, "POST", TS_REPO + "/issues/" + l.gh_number + "/comments", { body: "Reopened by TRACKER-SYNC-1: agent_issues " + l.issue_id + " is still open in qnfo-audit, which is authoritative. It closes here when it is closed there with close evidence." });
        out.reopened++;
      }
    } else {
      var note = rolled ? "Rolled up by ISSUE-ROLLUP-1: agent_issues " + l.issue_id + " (priority " + l.priority + ") is still open in qnfo-audit, which is authoritative. It is listed in its program's [digest] issue; only priority " + TS_INDIVIDUAL.join(", ") + " keeps an issue each. This close is not a verification." : await tsCloseComment(env, l);
      if (l.status === "monitoring") budget.d1(1);
      if (note) {
        var cr = await gh(env, "POST", TS_REPO + "/issues/" + l.gh_number + "/comments", { body: note });
        if (tsRateLimited(cr)) { limited = cr.status; out.errors.push({ scope: "tracker-issue " + l.issue_id, status: cr.status, why: "rate limited; the rest waits for the next tick" }); break; }
      }
      r = await gh(env, "PATCH", TS_REPO + "/issues/" + l.gh_number, { state: "closed", state_reason: want.reason });
      if (r.status >= 200 && r.status < 300) { out.closed++; reason = want.reason; }
    }
    if (r && r.status >= 200 && r.status < 300) {
      fixed++;
      budget.d1(1);
      var gs = want.open ? "open" : "closed";
      if (hasReason) await env.AUDIT.prepare("UPDATE gh_issue_links SET gh_state = ?, d1_status = ?, synced_at = ?, gh_close_reason = ? WHERE issue_id = ?").bind(gs, l.status || "missing", now, reason, l.issue_id).run();
      else await env.AUDIT.prepare("UPDATE gh_issue_links SET gh_state = ?, d1_status = ?, synced_at = ? WHERE issue_id = ?").bind(gs, l.status || "missing", now, l.issue_id).run();
    } else {
      out.errors.push({ scope: "tracker-issue " + l.issue_id, status: r && r.status, why: String(r && r.text || "").slice(0, 120) });
      if (tsRateLimited(r)) { limited = r.status; break; }
    }
  }
  out.state_sync = { drift: mism.length, tried: tried, fixed: fixed, carried: Math.max(0, mism.length - tried), oldest_min: mism.length ? Math.round((Date.now() - oldest) / 60000) : 0, rate_limited: limited };

  /* A monitoring card an earlier version closed as "completed" with "(none recorded)" is corrected once: not_planned plus the
   * comment naming its twin. gh_close_reason is the memo, so a row is never touched twice; a refusal other than a rate limit is
   * memoised too ("kept:<status>") so one stubborn row cannot hold the head of the queue. */
  if (hasReason && !limited && !ghLimited()) {
    var recl = links.filter(function (x) { return x.status === "monitoring" && !openNums[x.gh_number] && !mismIds[x.issue_id] && !x.gh_close_reason; }).slice(0, TS_RECLASS_PER_TICK);
    for (var q = 0; q < recl.length; q++) {
      var x = recl[q];
      var rc = await tsCloseComment(env, x);
      var cm = await gh(env, "POST", TS_REPO + "/issues/" + x.gh_number + "/comments", { body: "Corrected by TRACKER-SYNC-1: this card was closed as completed earlier with no close evidence. " + rc });
      if (tsRateLimited(cm)) { out.state_sync.rate_limited = cm.status; break; }
      var rp = await gh(env, "PATCH", TS_REPO + "/issues/" + x.gh_number, { state: "closed", state_reason: "not_planned" });
      if (tsRateLimited(rp)) { out.state_sync.rate_limited = rp.status; break; }
      var ok = rp.status >= 200 && rp.status < 300;
      if (!ok) out.errors.push({ scope: "tracker-reclass " + x.issue_id, status: rp.status, why: String(rp.text).slice(0, 100) });
      await env.AUDIT.prepare("UPDATE gh_issue_links SET gh_close_reason = ?, synced_at = ? WHERE issue_id = ?").bind(ok ? "not_planned" : "kept:" + rp.status, now, x.issue_id).run();
      if (ok) out.reclassified = (out.reclassified || 0) + 1;
    }
  }

  /* Record GitHub's state for links that agree, so v_tracker_drift reads the truth and not the last write (d1_status too:
   * it was refreshed only when gh_state changed, so it was a stale snapshot). */
  var stmts = [];
  links.forEach(function (x) {
    var st = openNums[x.gh_number] ? "open" : "closed";
    if (!mismIds[x.issue_id] && (x.gh_state !== st || x.d1_status !== (x.status || "missing"))) stmts.push(env.AUDIT.prepare("UPDATE gh_issue_links SET gh_state = ?, d1_status = ?, synced_at = ? WHERE issue_id = ?").bind(st, x.status || "missing", now, x.issue_id));
  });
  for (var sb = 0; sb < stmts.length; sb += 50) await env.AUDIT.batch(stmts.slice(sb, sb + 50));

  /* Mirror open issues that have no GitHub issue yet, oldest first. A "[#id]" title already on GitHub is linked, not re-filed. */
  var todo = ((await env.AUDIT.prepare(
    "SELECT a.id, a.title, a.description, a.source, a.category, a.priority, a.created_at FROM agent_issues a LEFT JOIN gh_issue_links l ON l.issue_id = a.id WHERE a.status = 'open' AND l.issue_id IS NULL" + (TS_INDIVIDUAL ? " AND (lower(a.priority) IN (" + TS_INDIVIDUAL.map(function () { return "?"; }).join(",") + ") OR lower(trim(a.title)) LIKE 'fm-actor-1:%')" : "") + " ORDER BY a.id LIMIT ?"
  ).bind(...(TS_INDIVIDUAL || []), TS_CREATE_PER_TICK).all()).results) || [];
  for (var j = 0; j < todo.length; j++) {
    if (ghLimited()) break;
    var row = todo[j];
    var num = byId[String(row.id)];
    if (num) {
      out.relinked++;
    } else {
      var c = await gh(env, "POST", TS_REPO + "/issues", { title: tsTitle(row), body: tsBody(row), labels: [TS_LABEL] });
      if (c.status !== 201 || !c.body || !c.body.number) {
        out.errors.push({ scope: "tracker-mirror " + row.id, status: c.status, why: String(c.text).slice(0, 120) });
        if (c.limited) break; /* rate limited: the rest waits for the next tick */
        continue;
      }
      num = c.body.number;
      out.mirrored++;
    }
    await env.AUDIT.prepare("INSERT OR REPLACE INTO gh_issue_links (issue_id, gh_number, gh_state, d1_status, synced_at) VALUES (?, ?, 'open', 'open', ?)").bind(row.id, num, now).run();
  }
}


/* ISSUE-ROLLUP-1: one [digest] issue per program lists the open agent_issues that are not individual issues, and one lists the open goals while
 * roadmap_mirror_scope has goals at mirrored = 0. A digest is rewritten only when its body changed (gh_digest_links.body_hash), and one whose group
 * emptied is closed. It carries the label fleet-digest, never fleet-issue or roadmap, so no other loop treats it as a mirror. */
function tsHash(str) { var h = 5381; for (var i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0; return String(h); }
function tsDigestBody(head, lines, cap) {
  var out = head + "\n\n| ref | priority | item |\n|:--|:--|:--|\n", used = out.length, shown = 0;
  for (var i = 0; i < lines.length; i++) {
    if (used + lines[i].length + 1 > cap) break;
    out += lines[i] + "\n"; used += lines[i].length + 1; shown++;
  }
  if (shown < lines.length) out += "\n...and " + (lines.length - shown) + " more (qnfo-audit is authoritative).\n";
  return out;
}
function tsCell(s) { return String(s || "").replace(/\|/g, "/").replace(/\s+/g, " ").slice(0, 120); }
async function tsDigest(env, out) {
  if (!TS_INDIVIDUAL || ghLimited()) return;
  var groups = {};
  var inds = TS_INDIVIDUAL.map(function () { return "?"; }).join(",");
  var rows = ((await env.AUDIT.prepare("SELECT a.id, a.title, a.priority, COALESCE(m.program_code, 'other') AS prog FROM agent_issues a LEFT JOIN issue_project_map m ON m.issue_id = a.id WHERE a.status = 'open' AND lower(a.priority) NOT IN (" + inds + ") AND lower(trim(a.title)) NOT LIKE 'fm-actor-1:%' ORDER BY CASE a.priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END, a.id").bind(...TS_INDIVIDUAL).all()).results) || [];
  rows.forEach(function (r) {
    var k = "issues:" + r.prog;
    if (!groups[k]) groups[k] = { title: "[digest] " + r.prog + " · open issues below " + TS_INDIVIDUAL.join("/"), head: "Rolled up by ISSUE-ROLLUP-1. These agent_issues are open in `qnfo-audit.agent_issues` (authoritative; each closes there with close evidence). Only priority " + TS_INDIVIDUAL.join(", ") + " keeps an issue each.", lines: [] };
    groups[k].lines.push("| #" + r.id + " | " + r.priority + " | " + tsCell(r.title) + " |");
  });
  var gs = null;
  try { gs = await env.AUDIT.prepare("SELECT mirrored FROM roadmap_mirror_scope WHERE source = 'goals'").first(); } catch (e) { gs = null; }
  if (gs && Number(gs.mirrored) === 0) {
    var goals = ((await env.AUDIT.prepare("SELECT id, item, status FROM roadmap_implementation WHERE source = 'goals' ORDER BY id").all()).results) || [];
    var open = goals.filter(function (g) { return !PS_RM_DONE[g.status]; });
    if (open.length) groups["goals"] = { title: "[digest] open goals", head: "Rolled up by ISSUE-ROLLUP-1. Open goals with a definition of done, from `qnfo-audit.roadmap_implementation` (source goals); also in GET /roadmap and on the Projects board.", lines: open.map(function (g) { return "| RM-" + g.id + " | " + g.status + " | " + tsCell(g.item) + " |"; }) };
  }
  var links = ((await env.AUDIT.prepare("SELECT dkey, gh_number, body_hash FROM gh_digest_links").all()).results) || [];
  var byKey = {}; links.forEach(function (l) { byKey[l.dkey] = l; });
  var now = new Date().toISOString(), calls = 0, keys = Object.keys(groups), res = { groups: keys.length, written: 0, closed: 0 };
  for (var i = 0; i < keys.length && calls < 12; i++) {
    var k = keys[i], g = groups[k], title = g.title + " (" + g.lines.length + ")", hash = tsHash(title + "\n" + g.lines.join("\n")), l = byKey[k];
    if (l && l.body_hash === hash) continue;
    var body = tsDigestBody(g.head + " (" + g.lines.length + " rows, " + now.slice(0, 16) + "Z)", g.lines, 60000);
    calls++;
    var r = l ? await reopenIssue(env, TS_REPO + "/issues/" + l.gh_number, { title: title, body: body, state: "open" }) : await gh(env, "POST", TS_REPO + "/issues", { title: title, body: body, labels: ["fleet-digest"] });
    if (r.age_policy_closed) { res.age_policy_closed = (res.age_policy_closed || 0) + 1; continue; }
    if (r.status >= 200 && r.status < 300 && r.body && (l || r.body.number)) {
      await env.AUDIT.prepare("INSERT OR REPLACE INTO gh_digest_links (dkey, gh_number, body_hash, n, synced_at) VALUES (?, ?, ?, ?, ?)").bind(k, l ? l.gh_number : r.body.number, hash, g.lines.length, now).run();
      res.written++;
    } else { out.errors.push({ scope: "digest " + k, status: r.status, why: String(r.text).slice(0, 100) }); if (r.limited) break; }
  }
  for (var j = 0; j < links.length && calls < 12; j++) {
    if (groups[links[j].dkey] || links[j].body_hash === "closed") continue;
    calls++;
    var c = await gh(env, "PATCH", TS_REPO + "/issues/" + links[j].gh_number, { state: "closed", state_reason: "completed" });
    if (c.status >= 200 && c.status < 300) { await env.AUDIT.prepare("UPDATE gh_digest_links SET body_hash = 'closed', n = 0, synced_at = ? WHERE dkey = ?").bind(now, links[j].dkey).run(); res.closed++; }
  }
  out.digest = res;
}

function tsPrNum(url) {
  var m = /\/pull\/(\d+)/.exec(String(url || ""));
  return m ? Number(m[1]) : null;
}

async function tsCodeTasks(env, out) {
  var now = new Date().toISOString();
  if (ghLimited()) { out.errors.push({ scope: "tracker-prs", why: "rate limited earlier in this tick; no code task change" }); return; }
  var backfilled = await tsState(env, "pr_backfill_done");
  var prs = await tsListAll(env, TS_REPO + "/pulls?state=all&sort=updated&direction=desc", backfilled ? 2 : 30, !!backfilled);
  if (!prs) { out.errors.push({ scope: "tracker-prs", why: "could not list pull requests; no code task change this tick" }); return; }
  var byNum = {}, byHead = {};
  prs.forEach(function (p) { byNum[p.number] = p; if (p.head && p.head.ref) byHead[p.head.ref] = p; });

  var tasks = ((await env.AUDIT.prepare(
    "SELECT t.id, t.status, t.branch, t.pr_url, t.merged_at, t.merged_sha, t.merged_by, k.pr_number AS known_pr, k.pr_state AS known_state, k.task_status AS known_status, k.drift AS known_drift FROM code_tasks t LEFT JOIN code_task_pr_links k ON k.task_id = t.id"
  ).all()).results) || [];
  var known = {};
  /* head_ref / task_ref (migrations/2026-10-19-tracker-drift-age.sql) are optional until that migration has applied. */
  var hasRef = await tsHasColumn(env, "code_task_pr_links", "head_ref");
  (((await env.AUDIT.prepare("SELECT task_id, pr_number, pr_state, drift" + (hasRef ? ", head_ref, task_ref" : "") + " FROM code_task_pr_links WHERE task_id LIKE 'pr:%'").all()).results) || []).forEach(function (k) { known[k.task_id] = k; });
  /* Write a link only when it changed: an unchanged row rewritten every 10 minutes is write volume nothing reads. */
  var same = function (a, b) { return String(a == null ? "" : a) === String(b == null ? "" : b); };
  var branches = {}, taskPrs = {}, stems = {}, stmts = [];
  for (var i = 0; i < tasks.length; i++) {
    var t = tasks[i];
    if (t.branch) branches[t.branch] = t.id;
    /* TRACKER-REPAIR-ROUND-1: a repair round re-pushes as codeagent-<stem>-rN and overwrites code_tasks.branch and
     * pr_url, so the earlier rounds' pull requests keep a branch no row names (PR 1413 -> ct_yhjw5pnqkdnbep, now -r3;
     * PR 2577 -> ct_im2924, now -r2). The branch stem is the task id without ct_, cut to 12 characters. */
    stems["codeagent-" + String(t.id || "").replace(/^ct_/, "").slice(0, 12)] = t.id;
    var n = tsPrNum(t.pr_url) || t.known_pr || null;
    if (n) taskPrs[n] = t.id;
    var p = n ? (byNum[n] || null) : ((t.branch && byHead[t.branch]) || null);
    if (!p) {
      /* Not in the recent window. Settled links (terminal PR, same task status) need no read; anything else gets one. */
      var settled = same(t.known_pr, n) && (t.known_state === "merged" ? !!t.merged_at : t.known_state === "closed" || (!n && t.known_state === "never-opened"));
      if (backfilled && t.known_status === t.status && settled) continue;
      if (n) { if (ghLimited()) continue; var g = await gh(env, "GET", TS_REPO + "/pulls/" + n); if (g.status === 200) p = g.body; else continue; }
    }
    var prState = !p ? "never-opened" : (p.merged_at ? "merged" : p.state);
    var drift = null, status = t.status;
    if (prState === "merged" && (t.status !== "merged" || !t.merged_at)) {
      /* The list endpoint carries no merged_by; read the one PR so the ledger names who merged it. */
      if (!p.merged_by && !ghLimited()) { var one = await gh(env, "GET", TS_REPO + "/pulls/" + p.number); if (one.status >= 200 && one.status < 300 && one.body) p = one.body; }
      var note = "TRACKER-SYNC-1: PR #" + p.number + " merged on GitHub at " + p.merged_at + "; code_tasks said '" + t.status + "'";
      var u = await env.AUDIT.prepare(
        "UPDATE code_tasks SET status = 'merged', merged_at = COALESCE(merged_at, ?), merged_sha = COALESCE(merged_sha, ?), merged_by = COALESCE(merged_by, ?), merge_note = ? || CASE WHEN merge_note IS NULL THEN '' ELSE ' | was: ' || substr(merge_note, 1, 400) END, updated_at = ? WHERE id = ? AND (status <> 'merged' OR merged_at IS NULL)"
      ).bind(p.merged_at, p.merge_commit_sha || null, "github:" + String(p.merged_by && p.merged_by.login || "unknown"), note, now, t.id).run();
      if (u && u.meta && u.meta.changes) { out.tasks_fixed.push(t.id + " #" + p.number + (t.status === "merged" ? " merged timestamp repaired" : " " + t.status + "->merged")); status = "merged"; }
      else drift = "pr-merged-task-" + t.status;
    } else if (t.status === "merged" && prState !== "merged") {
      drift = "task-merged-pr-" + prState;
    } else if (prState === "open" && ["closed", "failed", "publish_failed"].indexOf(t.status) >= 0) {
      drift = "pr-open-task-" + t.status;
    }
    if (drift) out.task_drift++;
    if (same(t.known_pr, p ? p.number : null) && same(t.known_state, prState) && same(t.known_status, status) && same(t.known_drift, drift)) continue;
    stmts.push(env.AUDIT.prepare(
      "INSERT INTO code_task_pr_links (task_id, pr_number, pr_state, merged_at, head_sha, task_status, drift, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(task_id) DO UPDATE SET pr_number = excluded.pr_number, pr_state = excluded.pr_state, merged_at = excluded.merged_at, head_sha = excluded.head_sha, task_status = excluded.task_status, drift = excluded.drift, synced_at = excluded.synced_at"
    ).bind(t.id, p ? p.number : null, prState, p ? (p.merged_at || null) : null, p && p.head ? p.head.sha : null, status, drift, now));
  }
  /* A code-loop PR the ledger does not know is work the metrics never count: drift while open or within 30 days. */
  var cutoff = Date.now() - 30 * 86400000;
  /* TRACKER-PR-ATTEMPTS-1: the stem match above only sees the 2-page recent window, so a superseded attempt that has since left it
   * (PRs 780, 1042, 1067, 1070, 1413, 1414: closed unmerged, recorded pr-without-task at the 09:43Z backfill) was never revisited
   * and stayed drift. A drift row with no head_ref yet is read once by number (a bounded batch), matched like the others, and its
   * head_ref and owning task are recorded: the row then says which task it was an attempt of, and is not read again. */
  var revisited = {}, orphans = Object.keys(byHead).map(function (h) { return byHead[h]; });
  if (hasRef) {
    var stale = Object.keys(known).filter(function (id) { var k = known[id]; return k.drift && !k.head_ref && !byNum[k.pr_number]; }).slice(0, TS_PR_REVISIT_PER_TICK);
    for (var v = 0; v < stale.length; v++) {
      if (ghLimited()) break;
      var gp = await gh(env, "GET", TS_REPO + "/pulls/" + known[stale[v]].pr_number);
      if (tsRateLimited(gp)) { out.errors.push({ scope: "tracker-pr-revisit", status: gp.status, why: "rate limited; the rest waits for the next tick" }); break; }
      if (gp.status === 200 && gp.body && gp.body.head) { revisited[gp.body.number] = 1; orphans.push(gp.body); }
      else if (gp.status === 404 || gp.status === 410) stmts.push(env.AUDIT.prepare("UPDATE code_task_pr_links SET drift = NULL, head_ref = 'gone', synced_at = ? WHERE task_id = ?").bind(now, stale[v]));
    }
  }
  orphans.forEach(function (p) {
    var h = (p.head && p.head.ref) || "";
    var direct = branches[h] || taskPrs[p.number] || null, codeagent = h.indexOf("codeagent-") === 0;
    if (!revisited[p.number] && (!codeagent || direct)) return;
    var owned = direct || (codeagent && stems[h.replace(/-r\d+$/, "")]) || null;
    var recent = codeagent && !owned && (p.state === "open" || Date.parse(p.merged_at || p.closed_at || p.updated_at || 0) >= cutoff);
    if (recent) out.task_drift++;
    if (owned && !direct) out.attempts_linked = (out.attempts_linked || 0) + 1;
    var k = known["pr:" + p.number], st = p.merged_at ? "merged" : p.state, dr = recent ? "pr-without-task" : null;
    if (k && same(k.pr_state, st) && same(k.drift, dr) && (!hasRef || (same(k.head_ref, h) && same(k.task_ref, owned)))) return;
    stmts.push(hasRef ? env.AUDIT.prepare(
      "INSERT INTO code_task_pr_links (task_id, pr_number, pr_state, merged_at, head_sha, task_status, drift, synced_at, head_ref, task_ref) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?) ON CONFLICT(task_id) DO UPDATE SET pr_state = excluded.pr_state, merged_at = excluded.merged_at, drift = excluded.drift, synced_at = excluded.synced_at, head_ref = excluded.head_ref, task_ref = excluded.task_ref"
    ).bind("pr:" + p.number, p.number, st, p.merged_at || null, p.head ? p.head.sha : null, dr, now, h, owned) : env.AUDIT.prepare(
      "INSERT INTO code_task_pr_links (task_id, pr_number, pr_state, merged_at, head_sha, task_status, drift, synced_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?) ON CONFLICT(task_id) DO UPDATE SET pr_state = excluded.pr_state, merged_at = excluded.merged_at, drift = excluded.drift, synced_at = excluded.synced_at"
    ).bind("pr:" + p.number, p.number, st, p.merged_at || null, p.head ? p.head.sha : null, dr, now));
  });
  /* A pr-without-task row is only revisited while its PR is in the recent window, so clear what is no longer true: a PR a
   * task now points at, one merged more than 30 days ago, or one closed unmerged (its row last changed when it closed) more than
   * 30 days ago. Without this a fixed false positive stays drift for good. */
  stmts.push(env.AUDIT.prepare(
    "UPDATE code_task_pr_links SET drift = NULL, synced_at = ?1 WHERE task_id LIKE 'pr:%' AND drift IS NOT NULL AND (pr_number IN (SELECT pr_number FROM code_task_pr_links WHERE task_id NOT LIKE 'pr:%' AND pr_number IS NOT NULL) OR (merged_at IS NOT NULL AND merged_at < ?2) OR (pr_state = 'closed' AND merged_at IS NULL AND synced_at < ?2))"
  ).bind(now, new Date(cutoff).toISOString()));
  for (var s = 0; s < stmts.length; s += 50) await env.AUDIT.batch(stmts.slice(s, s + 50));
  if (!backfilled) await tsState(env, "pr_backfill_done", now);
}

/* DISPATCH-LIVENESS-1 (owner directive 2026-10-18, verbatim: "THE SYSTEM SHALL NEVER STOP OR
 * TERMINATE WITH ANY OUTSTANDING BREACHES ... THE SYSTEM SHALL ALWAYS KEEP GOING").
 *
 * Every fleet_cron is dispatched by the per-minute tick inside qnfo-code-orchestrator. If that worker
 * dies, its dispatcher dies with it -- and NEVER-STALL-1, the task that would report a stall, is itself a
 * fleet_cron dispatched by that same tick. Nothing inside the failure domain can notice the failure.
 *
 * This worker is a different process on its own 10-minute Cloudflare cron. It reads the freshest
 * last_fired across every enabled fleet_cron: while the dispatcher lives that advances at least every 10
 * minutes, and when it stops the number freezes. A dispatcher quiet for over 20 minutes files
 * liveness:dispatcher-stalled here, and ISSUE-SYNC-1 mirrors it to GitHub on the same tick.
 *
 * Idempotent: one row per condition, created once. A queued alarm that recovers before it was mirrored is
 * cancelled rather than filed; a tracked one is left to the normal close path so it never drifts. */
var DL_FP = "liveness:dispatcher-stalled";
var DL_IDLE_LIMIT_MIN = 20;
async function dispatchLiveness(env, result) {
  if (!env.AUDIT) return;
  try {
    var row = await env.AUDIT.prepare(
      "SELECT MAX(last_fired) AS newest FROM fleet_crons WHERE enabled = 1 AND last_fired IS NOT NULL"
    ).first();
    var newest = row && row.newest ? Date.parse(row.newest) : 0;
    var idleMin = newest ? Math.round((Date.now() - newest) / 60000) : 9999;
    var now = new Date().toISOString();
    if (idleMin > DL_IDLE_LIMIT_MIN) {
      var payload = JSON.stringify({
        service: "qnfo-code-orchestrator",
        title: "fleet cron dispatch has been quiet for " + idleMin + " minutes",
        detail: "The freshest fleet_crons.last_fired is " + (newest ? row.newest : "absent") +
          ". The per-minute tick in qnfo-code-orchestrator dispatches every fleet cron, including NEVER-STALL-1, so a stall here means no scheduled task is running and the watchdog cannot report it. Check /health on qnfo-code-orchestrator, its cron triggers, and the loop_lock row.",
        idle_min: idleMin,
        limit_min: DL_IDLE_LIMIT_MIN
      });
      await env.AUDIT.prepare(
        "INSERT OR IGNORE INTO fleet_issue_dispatch (fingerprint, category, sev, owner, action, payload, state, created_at) VALUES (?, 'liveness', 'critical', 'qnfo-code-orchestrator', 'investigate-dispatch', ?, 'queued', ?)"
      ).bind(DL_FP, payload, now).run();
      result.dispatch_liveness = { idle_min: idleMin, limit_min: DL_IDLE_LIMIT_MIN, stalled: true };
      return;
    }
    // Healthy: cancel an alarm that was raised but never mirrored, so a transient blip leaves no issue behind.
    await env.AUDIT.prepare(
      "UPDATE fleet_issue_dispatch SET state = 'done', exec_state = 'recovered', exec_ts = ? WHERE fingerprint = ? AND state = 'queued' AND (gh_number IS NULL OR gh_number = '')"
    ).bind(now, DL_FP).run();
    result.dispatch_liveness = { idle_min: idleMin, limit_min: DL_IDLE_LIMIT_MIN, stalled: false };
  } catch (e) {
    result.errors.push({ scope: "dispatch-liveness", why: String(e && e.message || e).slice(0, 160) });
  }
}

/* FLEET-PR-SHARE-1 (0.7.6, agent_issues 100420, pillar autonomy): the share of pull requests merged into qnfo-workers main in the
 * last 7 days that the fleet's own GitHub App authored. Measured 2026-10-21: 145 of 537 since 10-17 (27%); the rest came from outside
 * sessions. Two search reads per hour (GitHub's own counts, no list paging); written to metric_registry fleet_authored_pr_share_7d,
 * graded by analytics_metric_triggers (lt 0.5, owner qnfo-code-orchestrator). A failed read writes nothing (never a false zero). */
async function fleetPrShare(env) {
  var since = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  var base = "repo:" + TS_REPO.replace(/^\/repos\//, "") + " is:pr is:merged merged:>=" + since;
  var all = await gh(env, "GET", "/search/issues?per_page=1&q=" + encodeURIComponent(base));
  var own = await gh(env, "GET", "/search/issues?per_page=1&q=" + encodeURIComponent(base + " author:app/qnfo-fleet"));
  if (all.status !== 200 || own.status !== 200 || !all.body || !own.body) return { ok: false, status: [all.status, own.status] };
  var n = Number(all.body.total_count) || 0, f = Number(own.body.total_count) || 0;
  var v = n ? Math.round(1000 * f / n) / 1000 : "n/a: no merged pull request in 7d";
  await env.AUDIT.prepare("UPDATE metric_registry SET last_value = ?, last_refreshed = ?, state = 'MEASURED' WHERE metric = 'fleet_authored_pr_share_7d'").bind(String(v), new Date().toISOString()).run();
  return { ok: true, merged: n, fleet: f, share: v };
}
async function trackerSync(env) {
  var started = Date.now();
  var out = { version: VERSION, started_at: new Date(started).toISOString(), mirrored: 0, relinked: 0, closed: 0, reopened: 0, tasks_fixed: [], task_drift: 0, errors: [] };
  if (!env.AUDIT || !env.GITHUB_TOKEN) { out.errors.push({ scope: "tracker", why: "AUDIT binding or GITHUB_TOKEN missing" }); return out; }
  GH_LIMIT = null; /* a new tick decides afresh; the cron is 10 minutes apart */
  try { await tsIssues(env, out); } catch (e) { out.errors.push({ scope: "tracker-issues", why: String(e && e.message || e).slice(0, 160) }); }
  try { await tsDigest(env, out); } catch (e) { out.errors.push({ scope: "tracker-digest", why: String(e && e.message || e).slice(0, 160) }); }
  try { await tsCodeTasks(env, out); } catch (e) { out.errors.push({ scope: "tracker-prs", why: String(e && e.message || e).slice(0, 160) }); }
  /* The fleet_issue_dispatch mirror (ISSUE-SYNC-1) rides the same 10-minute grid instead of the 6-hourly reconcile. */
  var legacy = { errors: [], issue_sync: null, issue_sync_reverse: null, issue_sync_forward: null, dispatch_liveness: null };
  await dispatchLiveness(env, legacy);
  await issueSync(env, legacy);
  /* Forward (and its relapse reopen) before reverse: see ISSUE-SYNC-FORWARD-1. */
  await issueSyncForward(env, legacy);
  await issueSyncReverse(env, legacy);
  out.dispatch_liveness = legacy.dispatch_liveness;
  out.dispatch_sync = legacy.issue_sync;
  out.dispatch_sync_forward = legacy.issue_sync_forward;
  out.dispatch_sync_reverse = legacy.issue_sync_reverse;
  out.errors = out.errors.concat(legacy.errors);
  try {
    var d = ((await env.AUDIT.prepare("SELECT kind, count(*) AS n FROM v_tracker_drift GROUP BY kind").all()).results) || [];
    var issue = 0, task = 0, unmirrored = 0;
    d.forEach(function (r) { if (r.kind === "code-task-pr") task += r.n; else issue += r.n; if (r.kind === "issue-unmirrored") unmirrored += r.n; });
    out.drift = { issue: issue, code_task: task, unmirrored: unmirrored };
    var at = new Date().toISOString();
    var put = function (m, v) { return env.AUDIT.prepare("UPDATE metric_registry SET last_value = ?, last_refreshed = ?, state = 'MEASURED' WHERE metric = ?").bind(String(v), at, m); };
    var w = [put("tracker_issue_drift", issue), put("tracker_code_task_drift", task)];
    /* tracker_drift is graded (it can file an issue) only after the first full open-issue backfill, so the backfill is not
     * reported as a breach of itself; until then it stays PENDING while its parts are measured. */
    var full = await tsState(env, "issue_backfill_done");
    if (!full && unmirrored === 0) { full = at; await tsState(env, "issue_backfill_done", at); }
    if (full) w.push(put("tracker_drift", issue + task));
    await env.AUDIT.batch(w);
    /* Age of the oldest drift row this loop drains (issue-state, issue-unmirrored), in minutes (the view's age_min exists once
     * migrations/2026-10-19-tracker-drift-age.sql has applied). A code-task-pr row is a task/PR contradiction the code loop owns and
     * has its own count (tracker_code_task_drift), so it does not age this metric. The count above is not graced or filtered: a burst
     * shows as drift at once, and this says how long the oldest row has waited. */
    try {
      var ag = await env.AUDIT.prepare("SELECT COALESCE(MAX(age_min), 0) AS m FROM v_tracker_drift WHERE kind IN ('issue-state', 'issue-unmirrored')").first();
      out.drift.oldest_min = ag ? Number(ag.m) || 0 : 0;
      await put("tracker_drift_oldest_min", out.drift.oldest_min).run();
    } catch (eAge) { out.drift.oldest_min = null; }
  } catch (e) { out.errors.push({ scope: "tracker-metrics", why: String(e && e.message || e).slice(0, 160) }); }
  out.duration_ms = Date.now() - started;
  out.rate_limited = ghLimited() ? GH_LIMIT.status : null; /* the one flag: any stage that met a GitHub rate limit */
  try { await tsState(env, "last_run", JSON.stringify(out).slice(0, 20000)); } catch (e) { out.errors.push({ scope: "tracker-record", why: String(e && e.message || e).slice(0, 120) }); }
  return out;
}
// end TRACKER-SYNC-1

/* PORTFOLIO-SYNC-1 (owner directive 2026-10-18, verbatim: "THE SYSTEM SHALL AUTOMATICALLY POPULATE AND MAINTAIN ITS OWN FLEET
 * ROADMAP AND BACKLOG, AS WELL AS ISSUES/TASKS FOR ALL FIXES/REMEDIATION AND PLANNED ENHANCEMENTS/UPGRADES, WHICH SHALL BE
 * CANONICAL ACROSS THE FLEET AND ALWAYS IN-SYNC WITH GITHUB ASSETS AND ISSUE/PROJECT TRACKING. THE SYSTEM SHALL MANAGE ITS OWN
 * PORTFOLIO, ITS OWN PROGRAMS, AND ITS OWN PROJECTS AUTOMATICALLY.")
 *
 * Measured before (2026-10-18 ~10:00Z): projects hand-written (21 rows, 0 of 30 live workers covered, 7 on 404 repos);
 * roadmap_implementation 141 rows / 117 open / 0 on GitHub; 0 milestones; 0 org Projects; 20 metrics in breach with no
 * roadmap objective.
 *
 * One 10-minute tick (after TRACKER-SYNC-1, same cron), each step bounded, idempotent and isolated:
 *   1 DERIVE      projects from service_registry (live worker -> W.<worker>) and portfolio_repos (active public non-fork repo
 *                 -> R.<repo>); a derived project whose source vanished is retired. Refused on a degenerate source (<10 rows,
 *                 DEGENERATE-DETECTION-SOURCE-1). Only source='derived' rows are ever retired.
 *   2 OBJECTIVES  every metric in breach (v_metric_trigger_state hit=1) is roadmap objective RM-METRIC-<key>; verified with the
 *                 measured value when the breach clears, reopened on re-breach.
 *   3 PLACE       every open mirrored issue -> project / program / kind (fix, enhancement, research, owner).
 *   4 GITHUB      programs + kinds -> labels; projects -> milestones (closed on retire); issues -> milestone + labels, compared
 *                 with GitHub's live state; roadmap items -> issues labelled roadmap, closed with evidence when D1 verifies,
 *                 reopened when closed by hand (D1 authoritative).
 *   5 BOARD       best effort: org Projects v2 board "QNFO Fleet Portfolio" carrying every mirrored item.
 *   6 MEASURE     v_portfolio_drift -> metric portfolio_drift (target 0). */
var PS_REPO = "/repos/" + ORG + "/qnfo-workers";
var PS_BOARD = "QNFO Fleet Portfolio";
var PS_MS_PER_TICK = 40, PS_ISSUE_PER_TICK = 40, PS_RM_CREATE_PER_TICK = 40, PS_RM_STATE_MAX = 40, PS_BOARD_PER_TICK = 30;
var PS_RM_DONE = { verified: 1, "enforced-verified": 1, "violated-remediated": 1, retired: 1 };
var PS_PROGRAMS = {
  "QNFO.RSCH": { label: "program:research", color: "1d76db", desc: "Research & Publications" },
  "QNFO.INFRA": { label: "program:infra", color: "5319e7", desc: "Cloudflare Infrastructure" },
  "QNFO.OPS": { label: "program:ops", color: "0e8a16", desc: "Operations & Governance" },
  "QNFO.REACH": { label: "program:reach", color: "fbca04", desc: "Reach & Distribution" },
  "QNFO.PERSONAL": { label: "program:personal", color: "c5def5", desc: "Personal Twin (names only)" }
};
var PS_KINDS = {
  fix: { color: "d73a4a", desc: "Fix / remediation" },
  enhancement: { color: "a2eeef", desc: "Planned enhancement / upgrade" },
  research: { color: "bfdadc", desc: "Research work" },
  owner: { color: "e99695", desc: "Owner request" }
};

function psProgramForWorker(w) {
  w = String(w || "");
  if (/^personal/.test(w)) return "QNFO.PERSONAL";
  if (/research|pdf|paper|radar|ai-search|ipatent|arxiv|citation|errata/.test(w)) return "QNFO.RSCH";
  if (/social|subscriber|signal|idea|outreach|cloud-ops|email/.test(w)) return "QNFO.REACH";
  if (/fleet|steward|evolve|lifecycle|deploy-guard|observability|orchestrator|calibration|kaizen|backlog|qnfo-ops|audit/.test(w)) return "QNFO.OPS";
  return "QNFO.INFRA";
}
function psProgramForRepo(r) {
  if (r.pillar === "personal" || r.tier === "client-config") return "QNFO.PERSONAL";
  if (r.tier === "research" || r.pillar === "research") return "QNFO.RSCH";
  if (r.tier === "demo" || r.pillar === "reach") return "QNFO.REACH";
  if (r.tier === "governance" || r.pillar === "autonomy") return "QNFO.OPS";
  return "QNFO.INFRA";
}
function psKind(category, source) {
  var c = String(category || "").toLowerCase();
  if (/owner/.test(c) || /owner-request/.test(String(source || ""))) return "owner";
  if (/research/.test(c)) return "research";
  if (/bug|defect|reliab|remediat|self-heal|security|integrity|quality|incident/.test(c)) return "fix";
  return "enhancement";
}
function psMsTitle(p) { return (p.project_code + " · " + tsRedact(p.name || "")).slice(0, 120); }
function psNow() { return new Date().toISOString().replace("T", " ").slice(0, 19); }

async function psDerive(env, out) {
  var now = psNow();
  var workers = ((await env.AUDIT.prepare("SELECT service, purpose FROM service_registry WHERE kind = 'worker' AND state = 'live'").all()).results) || [];
  var repos = ((await env.AUDIT.prepare("SELECT name, tier, pillar, description, visibility, archived, fork FROM portfolio_repos WHERE seen = 1").all()).results) || [];
  if (workers.length < 10 || repos.length < 10) {
    out.errors.push({ scope: "portfolio-derive", why: "degenerate source (workers " + workers.length + ", repos " + repos.length + "); no project created or retired this tick" });
    return;
  }
  var want = {};
  Object.keys(PS_PROGRAMS).forEach(function (program) {
    want["W." + program] = { program: program, name: PS_PROGRAMS[program].desc, desc: "Program work for " + program, owner: null };
  });
  workers.forEach(function (w) {
    want["W." + w.service] = { program: psProgramForWorker(w.service), name: w.service, desc: tsRedact(w.purpose || "worker " + w.service).slice(0, 400), owner: w.service };
  });
  repos.forEach(function (r) {
    if (Number(r.archived) || Number(r.fork) || String(r.visibility) !== "public" || r.name === "qnfo-workers") return;
    var prog = psProgramForRepo(r);
    if (prog === "QNFO.PERSONAL") return;
    want["R." + r.name] = { program: prog, name: r.name, desc: tsRedact(r.description || "repository " + r.name).slice(0, 400), owner: null, repo: ORG + "/" + r.name };
  });
  var have = {};
  (((await env.AUDIT.prepare("SELECT project_code, program_code, status, source FROM projects").all()).results) || []).forEach(function (p) { have[p.project_code] = p; });
  var stmts = [];
  Object.keys(want).forEach(function (code) {
    var w = want[code], h = have[code];
    if (!h) {
      stmts.push(env.AUDIT.prepare("INSERT INTO projects (project_code, program_code, name, description, status, github_repo, source, owner_service, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, 'derived', ?, ?, ?)")
        .bind(code, w.program, w.name, w.desc, w.repo || ORG + "/qnfo-workers", w.owner, now, now));
      out.projects_created++;
    } else if (h.source === "derived" && (h.status !== "active" || h.program_code !== w.program)) {
      stmts.push(env.AUDIT.prepare("UPDATE projects SET status = 'active', program_code = ?, completed_at = NULL, updated_at = ? WHERE project_code = ?").bind(w.program, now, code));
      out.projects_reactivated++;
    }
  });
  Object.keys(have).forEach(function (code) {
    var h = have[code];
    if (h.source === "derived" && h.status === "active" && !want[code]) {
      stmts.push(env.AUDIT.prepare("UPDATE projects SET status = 'retired', completed_at = ?, updated_at = ? WHERE project_code = ?").bind(now, now, code));
      out.projects_retired++;
    }
  });
  for (var i = 0; i < stmts.length; i += 50) await env.AUDIT.batch(stmts.slice(i, i + 50));
}

async function psObjectives(env, out) {
  var rows = ((await env.AUDIT.prepare("SELECT metric_key, title, owner, operator, threshold, val, hit FROM v_metric_trigger_state WHERE val IS NOT NULL").all()).results) || [];
  if (!rows.length) { out.errors.push({ scope: "portfolio-objectives", why: "v_metric_trigger_state returned no measured rows; objectives untouched" }); return; }
  var have = {};
  (((await env.AUDIT.prepare("SELECT id, item, status FROM roadmap_implementation WHERE source = 'metric-breach'").all()).results) || []).forEach(function (r) { have[r.item] = r; });
  var now = psNow(), stmts = [];
  rows.forEach(function (m) {
    var item = "RM-METRIC-" + m.metric_key, h = have[item];
    var ev = "measured " + m.val + " (" + m.operator + " " + m.threshold + ") at " + now + "Z from v_metric_trigger_state";
    if (Number(m.hit) === 1) {
      if (!h) {
        stmts.push(env.AUDIT.prepare("INSERT INTO roadmap_implementation (item, source, title, artifact_type, artifact_ref, status, evidence) VALUES (?, 'metric-breach', ?, 'objective', ?, 'open', ?)")
          .bind(item, String(m.title || m.metric_key).slice(0, 300), m.owner || null, "breach: " + ev));
        out.objectives_opened++;
      } else if (PS_RM_DONE[h.status]) {
        stmts.push(env.AUDIT.prepare("UPDATE roadmap_implementation SET status = 'open', evidence = ?, verified_at = NULL WHERE id = ?").bind("re-breach: " + ev, h.id));
        out.objectives_reopened++;
      }
    } else if (h && !PS_RM_DONE[h.status]) {
      stmts.push(env.AUDIT.prepare("UPDATE roadmap_implementation SET status = 'verified', evidence = ?, verified_at = ? WHERE id = ?").bind("cleared: " + ev, now, h.id));
      out.objectives_verified++;
    }
  });
  for (var i = 0; i < stmts.length; i += 50) await env.AUDIT.batch(stmts.slice(i, i + 50));
}

/* PLACE-ALL-OPEN-1 (0.10.1, 2026-10-30, pillar autonomy; owner request "audit and resolve all portfolio and program management issues"): the program of an open issue
 * is a fact about the issue, not about its GitHub mirror. psPlace joined gh_issue_links, so when ISSUE-ROLLUP-1 (0.10.0) stopped mirroring every non-critical issue
 * (it rolls them into a [digest]), 149 of 356 open issues (56 high, 93 medium, none critical) had no issue_project_map row and v_program_health, program risk, the focus
 * plan and the managers' verdicts ignored them. Every open issue is placed now, mirrored or not; a rolled issue only lacks the milestone and labels, which psIssues
 * still applies to mirrored rows alone. An issue that names an active worker in its title (the CF-OBS / LOOP-BREAKER / journey titles do) goes to that worker's project
 * when neither its triage owner nor its source names one, before the fleet-control fallback. */
function psTitleProject(title, active) {
  var best = null, re = /\b((?:qnfo|personal|q08|idea|radar)-[a-z0-9-]+)\b/g, m;
  while ((m = re.exec(String(title || "")))) {
    if (active["W." + m[1]] && (!best || m[1].length > best.length)) best = m[1];
  }
  return best ? "W." + best : null;
}

async function psPlace(env, out, projects) {
  var active = {};
  projects.forEach(function (p) { if (p.status === "active") active[p.project_code] = p; });
  var rows = ((await env.AUDIT.prepare(
    "SELECT a.id, a.title, a.category, a.source, t.owner, m.project_code AS cur_p, m.program_code AS cur_prog, m.kind AS cur_k FROM agent_issues a LEFT JOIN issue_triage t ON t.issue_id = a.id LEFT JOIN issue_project_map m ON m.issue_id = a.id WHERE a.status = 'open'"
  ).all()).results) || [];
  var fallback = active["W.qnfo-fleet-control"] ? "W.qnfo-fleet-control" : Object.keys(active)[0];
  var now = new Date().toISOString(), stmts = [];
  rows.forEach(function (r) {
    var code = null;
    /* PIN-PROGRAM-ROW-1 (0.10.1): the program managers place the issues they file on a program, not on a worker: project code "W.<program>" ("W.QNFO.INFRA" for a ROADMAP-1 item,
     * "W.QNFO.OPS" for a METRIC-UNMEASURED-1 issue). psDerive supplies the matching project. Such a row already sits on its program and is left alone; re-placing it by owner would move a roadmap
     * item of one program onto the fleet-control project of another now that every open issue is placed. A catalogue project that vanished (BP26.GONE) is still re-placed. */
    if (r.cur_p && PS_PROGRAMS[r.cur_prog] && r.cur_p === "W." + r.cur_prog) return;
    // PS-KEEP-CATALOGUE-PROJECT-1 (0.9.1, agent_issues 2993): an open issue already placed on an active project that is not a W.<worker> project (a catalogue project such as
    // BP26.EDITORIAL, chosen by subject when the catalogue was filed) keeps it. Placing it by owner moved all 30 BP26 issues onto W.qnfo-ops within a day, left the five BP26
    // projects with no mapped issue, and the no-mapped-work detector kept reporting them. Only an issue on a W.<worker> project, or on none, is placed by owner.
    if (r.cur_p && String(r.cur_p).indexOf("W.") !== 0 && active[r.cur_p]) code = r.cur_p;
    [r.owner, r.source].forEach(function (cand) {
      if (code || !cand) return;
      var s = String(cand).split(/[:|\s]/)[0];
      if (active["W." + s]) code = "W." + s;
    });
    code = code || psTitleProject(r.title, active) || fallback;
    if (!code) return;
    var kind = psKind(r.category, r.source);
    if (r.cur_p !== code || r.cur_k !== kind) {
      stmts.push(env.AUDIT.prepare("INSERT INTO issue_project_map (issue_id, project_code, program_code, kind, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(issue_id) DO UPDATE SET project_code = excluded.project_code, program_code = excluded.program_code, kind = excluded.kind, updated_at = excluded.updated_at")
        .bind(r.id, code, active[code].program_code, kind, now));
      out.issues_placed++;
    }
  });
  for (var i = 0; i < stmts.length; i += 50) await env.AUDIT.batch(stmts.slice(i, i + 50));
}

async function psLabels(env, out) {
  var have = await tsListAll(env, PS_REPO + "/labels", 5);
  if (!have) { out.errors.push({ scope: "portfolio-labels", why: "could not list labels" }); return false; }
  var names = {};
  have.forEach(function (l) { names[l.name] = 1; });
  var need = [{ name: "roadmap", color: "0052cc", description: "Fleet roadmap item (roadmap_implementation)" }];
  Object.keys(PS_PROGRAMS).forEach(function (k) { need.push({ name: PS_PROGRAMS[k].label, color: PS_PROGRAMS[k].color, description: k + " " + PS_PROGRAMS[k].desc }); });
  Object.keys(PS_KINDS).forEach(function (k) { need.push({ name: "kind:" + k, color: PS_KINDS[k].color, description: PS_KINDS[k].desc }); });
  for (var i = 0; i < need.length; i++) {
    if (names[need[i].name]) continue;
    var r = await gh(env, "POST", PS_REPO + "/labels", need[i]);
    if (r.status === 201) out.labels_created++;
    else { out.errors.push({ scope: "portfolio-label " + need[i].name, status: r.status, why: String(r.text).slice(0, 100) }); return false; }
  }
  return true;
}

async function psMilestones(env, out, projects) {
  var list = await tsListAll(env, PS_REPO + "/milestones?state=all", 10);
  if (!list) { out.errors.push({ scope: "portfolio-milestones", why: "could not list milestones; no milestone change this tick" }); return null; }
  var byCode = {};
  list.forEach(function (m) { var k = String(m.title || "").split(" · ")[0]; if (k) byCode[k] = m; });
  var done = 0, stmts = [], now = psNow();
  for (var i = 0; i < projects.length; i++) {
    var p = projects[i], m = byCode[p.project_code];
    if (p.status === "active") {
      if (!m) {
        if (done >= PS_MS_PER_TICK) continue;
        var c = await gh(env, "POST", PS_REPO + "/milestones", { title: psMsTitle(p), description: p.program_code === "QNFO.PERSONAL" ? "QNFO.PERSONAL | details kept in qnfo-audit" : (p.program_code + " | " + tsRedact(p.description || "")).slice(0, 700) });
        if (c.status !== 201 || !c.body) { out.errors.push({ scope: "portfolio-milestone " + p.project_code, status: c.status, why: String(c.text).slice(0, 100) }); if (c.status === 403 || c.status === 429) break; continue; }
        m = c.body; byCode[p.project_code] = m; out.milestones_created++; done++;
      } else if (m.state !== "open") {
        if (done >= PS_MS_PER_TICK) continue;
        var o = await gh(env, "PATCH", PS_REPO + "/milestones/" + m.number, { state: "open" });
        if (o.status === 200) { m.state = "open"; out.milestones_reopened++; done++; }
      }
      if (p.gh_milestone !== m.number) stmts.push(env.AUDIT.prepare("UPDATE projects SET gh_milestone = ?, updated_at = ? WHERE project_code = ?").bind(m.number, now, p.project_code));
      p.gh_milestone = m.number;
    } else {
      if (m && m.state === "open" && done < PS_MS_PER_TICK) {
        var x = await gh(env, "PATCH", PS_REPO + "/milestones/" + m.number, { state: "closed" });
        if (x.status === 200) { m.state = "closed"; out.milestones_closed++; done++; }
      }
      if (m && p.gh_milestone !== m.number) stmts.push(env.AUDIT.prepare("UPDATE projects SET gh_milestone = ? WHERE project_code = ?").bind(m.number, p.project_code));
    }
  }
  for (var j = 0; j < stmts.length; j += 50) await env.AUDIT.batch(stmts.slice(j, j + 50));
  return byCode;
}

function psManaged(n) { return n === "fleet-issue" || n === "roadmap" || /^program:|^kind:/.test(n); }
function psLabelNames(g) { return (g.labels || []).map(function (l) { return typeof l === "string" ? l : l.name; }); }
function psLabelSet(program, kind, extra) {
  var s = extra.slice();
  if (PS_PROGRAMS[program]) s.push(PS_PROGRAMS[program].label);
  if (PS_KINDS[kind]) s.push("kind:" + kind);
  return s.sort();
}
function psSameLabels(g, want) { return JSON.stringify(psLabelNames(g).filter(psManaged).sort()) === JSON.stringify(want); }
function psKeepLabels(g, want) { return psLabelNames(g).filter(function (n) { return !psManaged(n); }).concat(want); }

async function psIssues(env, out, projects, openFleet) {
  var byCode = {}, gByNum = {};
  projects.forEach(function (p) { byCode[p.project_code] = p; });
  openFleet.forEach(function (g) { gByNum[g.number] = g; });
  var rows = ((await env.AUDIT.prepare("SELECT m.issue_id, m.project_code, m.program_code, m.kind, m.synced_milestone, m.gh_node, l.gh_number FROM issue_project_map m JOIN gh_issue_links l ON l.issue_id = m.issue_id JOIN agent_issues a ON a.id = m.issue_id WHERE a.status = 'open'").all()).results) || [];
  var done = 0, stmts = [], now = new Date().toISOString();
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i], g = gByNum[r.gh_number], p = byCode[r.project_code];
    if (!g || !p || !p.gh_milestone) continue;
    var want = psLabelSet(r.program_code, r.kind, ["fleet-issue"]);
    if (g.milestone && g.milestone.number === p.gh_milestone && psSameLabels(g, want)) {
      if (r.synced_milestone !== p.gh_milestone || !r.gh_node) stmts.push(env.AUDIT.prepare("UPDATE issue_project_map SET synced_milestone = ?, synced_labels = ?, gh_node = ?, synced_at = ? WHERE issue_id = ?").bind(p.gh_milestone, want.join(","), g.node_id || null, now, r.issue_id));
      continue;
    }
    if (done >= PS_ISSUE_PER_TICK) continue;
    var u = await gh(env, "PATCH", PS_REPO + "/issues/" + r.gh_number, { milestone: p.gh_milestone, labels: psKeepLabels(g, want) });
    if (u.status === 200) {
      done++; out.issues_synced++;
      stmts.push(env.AUDIT.prepare("UPDATE issue_project_map SET synced_milestone = ?, synced_labels = ?, gh_node = ?, synced_at = ? WHERE issue_id = ?").bind(p.gh_milestone, want.join(","), g.node_id || null, now, r.issue_id));
    } else {
      out.errors.push({ scope: "portfolio-issue " + r.issue_id, status: u.status, why: String(u.text).slice(0, 100) });
      if (u.status === 403 || u.status === 429) break;
    }
  }
  for (var j = 0; j < stmts.length; j += 50) await env.AUDIT.batch(stmts.slice(j, j + 50));
}

function psRmProject(r, byCode) {
  var ref = String(r.artifact_ref || "") + " " + String(r.title || "");
  var re = /\b((?:qnfo|personal|q08|idea|radar)-[a-z0-9-]+)\b/g, m;
  while ((m = re.exec(ref))) { var p = byCode["W." + m[1]]; if (p && p.status === "active") return p; }
  var f = byCode["W.qnfo-fleet-control"];
  return f && f.status === "active" ? f : null;
}

/* PORTFOLIO-NOT-ISSUES-1 (0.8.0, 2026-10-26, pillar autonomy; owner question "why are there over 800 GitHub issues?"): GitHub Issues carry work that
 * finishing the work closes. Measured 2026-10-26 on 828 open issues: 381 were roadmap mirrors, and 181 of those could never close or were a second
 * ticket for something already tracked: 77 'projects' rows (PROJ-<code>: a worker or repository is a catalogue entry that is already a milestone,
 * and a live project is never "completed"), 75 'metric-breach' objectives (RM-METRIC-<key>: the breaching metric already has its METRIC-TRIGGER
 * issue, so one breach was two tickets) and 29 'failure_modes' registry entries (a lesson with a detector, not a task; one with an open issue is
 * that issue's twin). Those sources stay in qnfo-audit.roadmap_implementation (the roadmap, the Projects board and the public /roadmap tree read
 * them) but are not Issues. The scope is data (roadmap_mirror_scope, migrations/2026-10-26-issue-hygiene-1.sql, a source with mirrored = 1 is
 * mirrored again on the next tick); this default holds while the table is absent, unreadable or empty. */
var PS_RM_NOT_ISSUES_DEFAULT = ["projects", "metric-breach", "failure_modes"];
/* PS-SCOPE-SUBQUERY-1 (0.10.1, 2026-10-30): roadmap_mirror_scope holds 138 sources at mirrored = 0 (ISSUE-CONSOLIDATE-1 seeded them on 2026-10-26) and D1 allows 100 bound
 * variables in one statement, so binding the scope as a NOT IN list made the roadmap mirror step fail on every tick since 0.8.0 ("D1_ERROR: too many SQL variables"):
 * no new roadmap item was mirrored or placed, v_portfolio_drift counted 82 roadmap-unmirrored rows (metric portfolio_drift 83, METRIC-TRIGGER-8581 reopened 20 times in
 * 7 days) and GET /roadmap answered 500. With the table present the filter is a subquery on the table itself (no variables); the three-source default is bound only
 * while the table is absent or empty. */
var PS_RM_SCOPE_TABLE = false;
function psRmNotInSql(col, off) {
  if (PS_RM_SCOPE_TABLE) return { sql: " AND " + col + " NOT IN (SELECT source FROM roadmap_mirror_scope WHERE mirrored = 0)", binds: [] };
  var keys = Object.keys(off);
  return { sql: keys.length ? " AND " + col + " NOT IN (" + keys.map(function () { return "?"; }).join(",") + ")" : "", binds: keys };
}
async function psRmScope(env) {
  var off = {};
  PS_RM_SCOPE_TABLE = false;
  try {
    var rows = ((await env.AUDIT.prepare("SELECT source, mirrored FROM roadmap_mirror_scope").all()).results) || [];
    if (rows.length) { PS_RM_SCOPE_TABLE = true; rows.forEach(function (r) { if (!Number(r.mirrored)) off[r.source] = 1; }); return off; }
  } catch (e) { /* the table is not applied yet: the default below */ }
  PS_RM_NOT_ISSUES_DEFAULT.forEach(function (s) { off[s] = 1; });
  return off;
}
/* ROADMAP-TWIN-ROWS-1 (0.9.0, 2026-10-26): a roadmap row whose artifact is an agent issue (artifact_type 'agent_issue', item AI-<id>) is the roadmap twin of
 * an issue that TRACKER-SYNC-1 already mirrors as [#id]; a second GitHub issue for it tracks one thing twice. The rule is on the row's own artifact_type,
 * not on a source name: the 'agent_issues' source was excluded by name, and the next research batch (source 'best-practice-2026', 31 rows in one hour on
 * 2026-10-26, 15 already mirrored) arrived under a new name and doubled its issues. Whatever source writes such a row, it stays out of the mirror. */
function psIsTwin(l) { return String(l.artifact_type || "") === "agent_issue"; }

async function psRoadmap(env, out, projects) {
  var byCode = {};
  projects.forEach(function (p) { byCode[p.project_code] = p; });
  var notIssue = await psRmScope(env);
  /* An item is an open GitHub issue when D1 has it not done and its source is a work source (PORTFOLIO-NOT-ISSUES-1). */
  var wantOpen = function (l) { return !PS_RM_DONE[l.status] && !notIssue[l.source] && !psIsTwin(l); };
  var open = await tsListAll(env, PS_REPO + "/issues?state=open&labels=roadmap", 10);
  if (!open) { out.errors.push({ scope: "portfolio-roadmap", why: "could not list open roadmap issues; no roadmap change this tick" }); return null; }
  var openNums = {}, byId = {};
  open.forEach(function (g) { if (g.pull_request) return; openNums[g.number] = g; var m = /^\[RM-(\d+)\]/.exec(g.title || ""); if (m) byId[m[1]] = g.number; });
  var links = ((await env.AUDIT.prepare("SELECT g.roadmap_id, g.gh_number, g.gh_state, g.d1_status, g.gh_node, r.status, r.source, r.artifact_type, r.evidence, r.item, r.verified_at, r.created_at FROM roadmap_gh_links g JOIN roadmap_implementation r ON r.id = g.roadmap_id").all()).results) || [];
  var mism = links.filter(function (l) { return wantOpen(l) !== !!openNums[l.gh_number]; });
  /* Same budget, order and explained-burst guard as TRACKER-STATE-BUDGET-1 (the D1 change time is verified_at, else created_at). */
  var changedRm = function (l) { return Date.parse(l.verified_at || l.created_at || 0) || 0; };
  /* Explained = the item moved across done/not-done since the last agreement (the link's d1_status, refreshed every tick for links that agree),
   * or its source is out of the mirror scope (a recorded decision in roadmap_mirror_scope, not a GitHub-side anomaly). */
  var rguard = tsGuard(mism, links.length, function (l) { return !!notIssue[l.source] || psIsTwin(l) || (!!l.d1_status && !!PS_RM_DONE[l.d1_status] !== !!PS_RM_DONE[l.status]); });
  if (rguard.refused) out.errors.push({ scope: "portfolio-roadmap", why: rguard.refused + " of " + links.length + " roadmap links disagree with GitHub although D1 has not changed since the last sync; refusing a mass state flip" });
  mism = tsOrder(rguard.rows, wantOpen, changedRm, function (l) { return Number(l.roadmap_id) || 0; });
  var now = new Date().toISOString(), fixed = 0, tried = 0, rbudget = tsBudget(PS_RM_STATE_MAX), mismIds = {};
  mism.forEach(function (l) { mismIds[l.roadmap_id] = 1; });
  for (var i = 0; i < mism.length && rbudget.more(tried); i++) {
    var l = mism[i], r;
    tried++;
    if (wantOpen(l)) {
      r = await reopenIssue(env, PS_REPO + "/issues/" + l.gh_number, { state: "open" });
      if (r.age_policy_closed) { out.age_policy_closed = (out.age_policy_closed || 0) + 1; continue; }
      if (r.status === 200) { await gh(env, "POST", PS_REPO + "/issues/" + l.gh_number + "/comments", { body: "Reopened by PORTFOLIO-SYNC-1: roadmap item " + tsRedact(l.item) + " is '" + l.status + "' in qnfo-audit.roadmap_implementation, which is authoritative." }); out.roadmap_reopened++; }
    } else if ((notIssue[l.source] || psIsTwin(l)) && !PS_RM_DONE[l.status]) {
      /* Out of scope and still not done in D1: not a verification, so no completed close and no evidence block. */
      await gh(env, "POST", PS_REPO + "/issues/" + l.gh_number + "/comments", { body: "Closed by PORTFOLIO-NOT-ISSUES-1: roadmap item " + tsRedact(l.item) + " (source `" + tsRedact(l.source) + "`) is a catalogue, twin or registry entry, not work that closing can finish (a row whose artifact is an agent issue is that issue's twin: the issue is its [#id] ticket). It stays in qnfo-audit.roadmap_implementation (the roadmap, the Projects board and the public /roadmap tree) and is tracked there; metric breaches are tracked by their METRIC-TRIGGER issue. This is not a verification." });
      r = await gh(env, "PATCH", PS_REPO + "/issues/" + l.gh_number, { state: "closed", state_reason: "not_planned" });
      if (r.status >= 200 && r.status < 300) { out.roadmap_closed++; out.roadmap_scoped_closed = (out.roadmap_scoped_closed || 0) + 1; }
    } else {
      await gh(env, "POST", PS_REPO + "/issues/" + l.gh_number + "/comments", { body: "Verified in qnfo-audit (roadmap " + tsRedact(l.item) + ": status **" + l.status + "**). Evidence:\n\n" + tsFence(l.evidence || "(none recorded)", 3000) });
      r = await gh(env, "PATCH", PS_REPO + "/issues/" + l.gh_number, { state: "closed", state_reason: l.status === "retired" ? "not_planned" : "completed" });
      if (r.status === 200) out.roadmap_closed++;
    }
    if (r && r.status >= 200 && r.status < 300) { fixed++; rbudget.d1(1); await env.AUDIT.prepare("UPDATE roadmap_gh_links SET gh_state = ?, d1_status = ?, synced_at = ? WHERE roadmap_id = ?").bind(wantOpen(l) ? "open" : "closed", l.status, now, l.roadmap_id).run(); }
    else { out.errors.push({ scope: "portfolio-roadmap-state " + l.roadmap_id, status: r && r.status, why: String(r && r.text || "").slice(0, 100) }); if (tsRateLimited(r)) break; }
  }
  var stmts = [];
  links.forEach(function (x) {
    var g = openNums[x.gh_number], st = g ? "open" : "closed";
    if (!mismIds[x.roadmap_id] && (x.gh_state !== st || x.d1_status !== x.status || (g && !x.gh_node))) stmts.push(env.AUDIT.prepare("UPDATE roadmap_gh_links SET gh_state = ?, d1_status = ?, gh_node = COALESCE(gh_node, ?), synced_at = ? WHERE roadmap_id = ?").bind(st, x.status, g ? g.node_id : null, now, x.roadmap_id));
  });
  for (var s = 0; s < stmts.length; s += 50) await env.AUDIT.batch(stmts.slice(s, s + 50));

  /* Place open roadmap issues: an item mirrored before its project's milestone existed (milestones are capped per tick) is
   * moved into the milestone and given its labels once the milestone exists. Compared with GitHub's live state. */
  var place = ((await env.AUDIT.prepare("SELECT g.roadmap_id, g.gh_number, g.project_code, r.source, r.artifact_type, r.title, r.artifact_ref FROM roadmap_gh_links g JOIN roadmap_implementation r ON r.id = g.roadmap_id WHERE r.status NOT IN ('verified','enforced-verified','violated-remediated','retired')").all()).results) || [];
  var placed = 0, pst = [];
  for (var q = 0; q < place.length && placed < PS_ISSUE_PER_TICK; q++) {
    var x2 = place[q], g2 = openNums[x2.gh_number], p2 = psRmProject(x2, byCode);
    if (!g2 || !p2 || !p2.gh_milestone || notIssue[x2.source] || psIsTwin(x2)) continue;
    var want2 = psLabelSet(p2.program_code, x2.source === "metric-breach" ? "fix" : "enhancement", ["roadmap"]);
    if (g2.milestone && g2.milestone.number === p2.gh_milestone && psSameLabels(g2, want2)) {
      if (x2.project_code !== p2.project_code) pst.push(env.AUDIT.prepare("UPDATE roadmap_gh_links SET project_code = ? WHERE roadmap_id = ?").bind(p2.project_code, x2.roadmap_id));
      continue;
    }
    var u2 = await gh(env, "PATCH", PS_REPO + "/issues/" + x2.gh_number, { milestone: p2.gh_milestone, labels: psKeepLabels(g2, want2) });
    if (u2.status === 200) { placed++; out.roadmap_placed = (out.roadmap_placed || 0) + 1; pst.push(env.AUDIT.prepare("UPDATE roadmap_gh_links SET project_code = ?, synced_at = ? WHERE roadmap_id = ?").bind(p2.project_code, now, x2.roadmap_id)); }
    else { out.errors.push({ scope: "portfolio-roadmap-place " + x2.roadmap_id, status: u2.status, why: String(u2.text).slice(0, 100) }); if (u2.status === 403 || u2.status === 429) break; }
  }
  if (pst.length) await env.AUDIT.batch(pst);

  /* Rows copied from agent_issues (source 'agent_issues') are already on GitHub as their [#id] issue (TRACKER-SYNC-1); mirroring
   * them again would track one defect twice, so they are never filed here. */
  /* Out-of-scope sources are excluded in SQL, not after the LIMIT, so they can never starve the work items behind them (PORTFOLIO-NOT-ISSUES-1). */
  var skipF = psRmNotInSql("r.source", notIssue);
  var todoStmt = env.AUDIT.prepare("SELECT r.id, r.item, r.source, r.title, r.artifact_type, r.artifact_ref, r.status, r.evidence FROM roadmap_implementation r LEFT JOIN roadmap_gh_links g ON g.roadmap_id = r.id WHERE g.roadmap_id IS NULL AND r.status NOT IN ('verified','enforced-verified','violated-remediated','retired') AND r.source <> 'agent_issues' AND r.artifact_type <> 'agent_issue'"
    + skipF.sql + " ORDER BY r.id LIMIT ?");
  var todo = ((await todoStmt.bind.apply(todoStmt, skipF.binds.concat([PS_RM_CREATE_PER_TICK])).all()).results) || [];
  for (var j = 0; j < todo.length; j++) {
    var row = todo[j], p = psRmProject(row, byCode), num = byId[String(row.id)], node = num && openNums[num] ? openNums[num].node_id : null;
    if (!num) {
      var body = [
        "Mirrored from qnfo-audit.roadmap_implementation id **" + row.id + "** (PORTFOLIO-SYNC-1). D1 is authoritative: this closes",
        "when the item is verified there, with its evidence, and a hand close here is reopened.", "",
        "| field | value |", "|:--|:--|",
        "| item | " + tsRedact(row.item).replace(/\|/g, "/") + " |",
        "| status | " + String(row.status) + " |",
        "| source | " + tsRedact(row.source || "").replace(/\|/g, "/").slice(0, 160) + " |",
        "| artifact | " + tsRedact((row.artifact_type || "") + " " + (row.artifact_ref || "")).replace(/\|/g, "/").slice(0, 200) + " |",
        "| project | " + (p ? p.project_code : "") + " |", "",
        tsFence(row.evidence || "(no evidence yet)", 3000)
      ].join("\n");
      var payload = { title: ("[RM-" + row.id + "] " + tsRedact(row.item) + ": " + tsRedact(row.title || "")).replace(/@/g, "@\u200b").slice(0, 240), body: body, labels: psLabelSet(p ? p.program_code : "QNFO.OPS", row.source === "metric-breach" ? "fix" : "enhancement", ["roadmap"]) };
      if (p && p.gh_milestone) payload.milestone = p.gh_milestone;
      var c = await gh(env, "POST", PS_REPO + "/issues", payload);
      if (c.status !== 201 || !c.body) { out.errors.push({ scope: "portfolio-roadmap-mirror " + row.id, status: c.status, why: String(c.text).slice(0, 100) }); if (c.status === 403 || c.status === 429) break; continue; }
      num = c.body.number; node = c.body.node_id; out.roadmap_mirrored++;
    } else out.roadmap_relinked++;
    await env.AUDIT.prepare("INSERT OR REPLACE INTO roadmap_gh_links (roadmap_id, gh_number, gh_state, d1_status, project_code, gh_node, synced_at) VALUES (?, ?, 'open', ?, ?, ?, ?)").bind(row.id, num, row.status, p ? p.project_code : null, node, now).run();
  }
  return open;
}

async function psGql(env, query, variables) {
  var r = await fetch(API + "/graphql", { method: "POST", headers: { Authorization: "Bearer " + env.GITHUB_TOKEN, "User-Agent": "qnfo-github-steward/" + VERSION, "Content-Type": "application/json" }, body: JSON.stringify({ query: query, variables: variables || {} }) });
  var j = null; try { j = await r.json(); } catch (e) { j = null; }
  if (!r.ok || !j || j.errors) throw new Error("graphql " + r.status + " " + JSON.stringify(j && j.errors || "").slice(0, 160));
  return j.data;
}

/* Best effort: a failure is a recorded limitation, never a failed tick; milestones + labels are the primary view (two paths). */
async function psBoard(env, out) {
  try {
    var pid = await tsState(env, "portfolio_board_id");
    if (!pid) {
      var d = await psGql(env, "query($l:String!){organization(login:$l){id projectsV2(first:50){nodes{id title}}}}", { l: ORG });
      var found = (d.organization.projectsV2.nodes || []).filter(function (n) { return n.title === PS_BOARD; })[0];
      if (!found) {
        var c = await psGql(env, "mutation($o:ID!,$t:String!){createProjectV2(input:{ownerId:$o,title:$t}){projectV2{id}}}", { o: d.organization.id, t: PS_BOARD });
        pid = c.createProjectV2.projectV2.id; out.board_created = true;
      } else pid = found.id;
      await tsState(env, "portfolio_board_id", pid);
    }
    var items = ((await env.AUDIT.prepare("SELECT 'i' AS t, issue_id AS k, gh_node FROM issue_project_map WHERE gh_node IS NOT NULL AND gh_item IS NULL UNION ALL SELECT 'r', roadmap_id, gh_node FROM roadmap_gh_links WHERE gh_node IS NOT NULL AND gh_item IS NULL AND gh_state = 'open' LIMIT ?").bind(PS_BOARD_PER_TICK).all()).results) || [];
    var st = [];
    for (var i = 0; i < items.length; i++) {
      var a = await psGql(env, "mutation($p:ID!,$c:ID!){addProjectV2ItemById(input:{projectId:$p,contentId:$c}){item{id}}}", { p: pid, c: items[i].gh_node });
      var iid = a.addProjectV2ItemById.item.id;
      st.push(items[i].t === "i" ? env.AUDIT.prepare("UPDATE issue_project_map SET gh_item = ? WHERE issue_id = ?").bind(iid, items[i].k) : env.AUDIT.prepare("UPDATE roadmap_gh_links SET gh_item = ? WHERE roadmap_id = ?").bind(iid, items[i].k));
      out.board_items_added++;
    }
    if (st.length) await env.AUDIT.batch(st);
  } catch (e) {
    out.limitations.push("projects-v2 board: " + String(e && e.message || e).slice(0, 160));
  }
}

async function portfolioSync(env) {
  var started = Date.now();
  var out = { version: VERSION, started_at: new Date(started).toISOString(), projects_created: 0, projects_reactivated: 0, projects_retired: 0, objectives_opened: 0, objectives_reopened: 0, objectives_verified: 0, issues_placed: 0, labels_created: 0, milestones_created: 0, milestones_reopened: 0, milestones_closed: 0, issues_synced: 0, roadmap_mirrored: 0, roadmap_relinked: 0, roadmap_closed: 0, roadmap_reopened: 0, board_items_added: 0, errors: [], limitations: [] };
  if (!env.AUDIT || !env.GITHUB_TOKEN) { out.errors.push({ scope: "portfolio", why: "AUDIT binding or GITHUB_TOKEN missing" }); return out; }
  /* PORTFOLIO-HEARTBEAT-1: measured 2026-10-18, /portfolio reported last_run 13:43:19Z while the
   * 13:53 tick was running, and there was no way to tell a stalled tick from a record that simply
   * had not been written yet (the record is only written at the END, line ~1119). Publishing an
   * in_progress marker first makes the two distinguishable: a marker with an old started_at and no
   * completion means the tick died; no marker at all means it never started. A heartbeat write must
   * never block the tick, so it is best-effort. */
  try { await tsState(env, "portfolio_last_run", JSON.stringify({ version: VERSION, started_at: out.started_at, state: "in_progress" })); } catch (e) { /* heartbeat is best-effort */ }
  /* The GitHub steps make no call once a rate limit was met earlier in this invocation (the tracker tick just before it, or a step above). */
  var GH_STEPS = { labels: 1, milestones: 1, list: 1, issues: 1, roadmap: 1 };
  var step = async function (name, fn) {
    if (GH_STEPS[name] && ghLimited()) { out.errors.push({ scope: "portfolio-" + name, why: "rate limited; skipped this tick" }); return null; }
    try { return await fn(); } catch (e) { out.errors.push({ scope: "portfolio-" + name, why: String(e && e.message || e).slice(0, 160) }); return null; }
  };
  await step("derive", function () { return psDerive(env, out); });
  await step("objectives", function () { return psObjectives(env, out); });
  var projects = (await step("projects", async function () { return ((await env.AUDIT.prepare("SELECT project_code, program_code, name, description, status, gh_milestone FROM projects ORDER BY project_code").all()).results) || []; })) || [];
  await step("place", function () { return psPlace(env, out, projects); });
  var labelsOk = await step("labels", function () { return psLabels(env, out); });
  var ms = labelsOk ? await step("milestones", function () { return psMilestones(env, out, projects); }) : null;
  if (ms) {
    var openFleet = await step("list", function () { return tsListAll(env, PS_REPO + "/issues?state=open&labels=fleet-issue", 15); });
    if (openFleet) await step("issues", function () { return psIssues(env, out, projects, openFleet); });
    else out.errors.push({ scope: "portfolio-issues", why: "could not list open fleet-issue issues; no issue placement this tick" });
    await step("roadmap", function () { return psRoadmap(env, out, projects); });
  }
  if (!ghLimited()) await psBoard(env, out);
  await step("measure", async function () {
    var d = ((await env.AUDIT.prepare("SELECT kind, count(*) AS n FROM v_portfolio_drift GROUP BY kind").all()).results) || [];
    var total = 0; out.drift = {};
    d.forEach(function (r) { out.drift[r.kind] = r.n; total += r.n; });
    out.drift.total = total;
    await env.AUDIT.prepare("UPDATE metric_registry SET last_value = ?, last_refreshed = ?, state = 'MEASURED' WHERE metric = 'portfolio_drift'").bind(String(total), new Date().toISOString()).run();
  });
  out.duration_ms = Date.now() - started;
  out.rate_limited = ghLimited() ? GH_LIMIT.status : null;
  try { await tsState(env, "portfolio_last_run", JSON.stringify(out).slice(0, 20000)); } catch (e) { out.errors.push({ scope: "portfolio-record", why: String(e && e.message || e).slice(0, 120) }); }
  return out;
}

/* GET /roadmap: portfolio -> programs -> projects (open work by kind, open roadmap items, milestone link). Personal projects
 * are counted, never itemised (PERSONAL-QNFO-SEPARATION-1). */
async function portfolioTree(env) {
  var progs = ((await env.AUDIT.prepare("SELECT program_code, name FROM programs ORDER BY program_code").all()).results) || [];
  var projs = ((await env.AUDIT.prepare("SELECT project_code, program_code, name, source, gh_milestone FROM projects WHERE status = 'active' ORDER BY project_code").all()).results) || [];
  var kinds = ((await env.AUDIT.prepare("SELECT m.project_code, m.kind, count(*) AS n FROM issue_project_map m JOIN agent_issues a ON a.id = m.issue_id AND a.status = 'open' GROUP BY m.project_code, m.kind").all()).results) || [];
  var treeSkip = await psRmScope(env);
  var treeF = psRmNotInSql("r.source", treeSkip);
  var rmsStmt = env.AUDIT.prepare("SELECT g.project_code, count(*) AS n FROM roadmap_gh_links g JOIN roadmap_implementation r ON r.id = g.roadmap_id WHERE r.status NOT IN ('verified','enforced-verified','violated-remediated','retired') AND r.artifact_type <> 'agent_issue'"
    + treeF.sql + " GROUP BY g.project_code");
  var rms = ((await (treeF.binds.length ? rmsStmt.bind.apply(rmsStmt, treeF.binds) : rmsStmt).all()).results) || [];
  var kBy = {}, rBy = {};
  kinds.forEach(function (k) { (kBy[k.project_code] = kBy[k.project_code] || {})[k.kind] = k.n; });
  rms.forEach(function (r) { rBy[r.project_code] = r.n; });
  var tree = { portfolio: "QNFO", repo: ORG + "/qnfo-workers", programs: [] };
  progs.forEach(function (g) {
    var ps = projs.filter(function (p) { return p.program_code === g.program_code; });
    var node = { program: g.program_code, name: g.name, label: PS_PROGRAMS[g.program_code] ? PS_PROGRAMS[g.program_code].label : null, projects: ps.length };
    if (g.program_code !== "QNFO.PERSONAL") node.items = ps.map(function (p) { return { project: p.project_code, name: p.name, source: p.source, milestone: p.gh_milestone ? "https://github.com/" + ORG + "/qnfo-workers/milestone/" + p.gh_milestone : null, open: kBy[p.project_code] || {}, roadmap_open: rBy[p.project_code] || 0 }; });
    tree.programs.push(node);
  });
  return tree;
}
// end PORTFOLIO-SYNC-1

// the workflow-runs endpoint answers an object, which paginate() (array bodies only) drops: read body.workflow_runs directly
async function workflowRuns(env, path) {
  var r = await gh(env, "GET", path);
  if (r.status !== 200) return { status: r.status, runs: [] };
  var runs = r.body && Array.isArray(r.body.workflow_runs) ? r.body.workflow_runs : [];
  return { status: 200, runs: runs };
}

async function recordModelFloorGuardRun(env, repo, result) {
  if (!env.AUDIT || repo.full_name !== ORG + "/qnfo-workers") return;
  if (ghLimited()) { result.limitations.push("model-floor-guard observable: skipped (rate limited)"); return; }
  var path = ".github/workflows/model-floor-guard.yml";
  try {
    var got = await workflowRuns(env, "/repos/" + repo.full_name + "/actions/workflows/model-floor-guard.yml/runs?per_page=15");
    var runs = got.runs;
    if (got.status !== 200 && got.status !== 404) result.limitations.push("model-floor-guard observable: runs read answered HTTP " + got.status);
    if (!runs.length) return;
    await env.AUDIT.prepare(
      "CREATE TABLE IF NOT EXISTS model_floor_guard_runs (run_id INTEGER PRIMARY KEY, repo TEXT, workflow_path TEXT, branch TEXT, event TEXT, conclusion TEXT, run_attempt INTEGER, run_started_at TEXT, run_url TEXT, recorded_at TEXT)"
    ).run();
    var stmt = env.AUDIT.prepare(
      "INSERT INTO model_floor_guard_runs (run_id, repo, workflow_path, branch, event, conclusion, run_attempt, run_started_at, run_url, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(run_id) DO UPDATE SET conclusion=excluded.conclusion, run_attempt=excluded.run_attempt, recorded_at=excluded.recorded_at"
    );
    var batch = [], n = 0;
    for (var i = 0; i < runs.length; i++) {
      var run = runs[i];
      if (!run || run.path !== path) continue;
      batch.push(stmt.bind(run.id, repo.full_name, run.path, run.head_branch || null, run.event || null, run.conclusion || null, run.run_attempt || 1, run.run_started_at || null, run.html_url || null, new Date().toISOString()));
      if (batch.length >= 25) { await env.AUDIT.batch(batch); n += batch.length; batch = []; }
    }
    if (batch.length) { await env.AUDIT.batch(batch); n += batch.length; }
    if (n) result.workflows = (result.workflows || 0) + n;
  } catch (e) {
    var msg = String(e && e.message || e);
    if (msg.indexOf("404") < 0) result.limitations.push("model-floor-guard observable: " + msg.slice(0, 160));
  }
}

async function modelFloorGuardVisibility(env, result) {
  result.model_floor_guard = { status: "missing", runs: 0, last_conclusion: null, last_run_at: null, last_success_at: null, last_failure_at: null };
  if (ghLimited()) { result.model_floor_guard.status = "rate_limited"; result.limitations.push("model-floor-guard visibility: skipped (rate limited)"); return; }
  var url = "/repos/" + ORG + "/qnfo-workers/actions/workflows/model-floor-guard.yml/runs?branch=main&status=completed&per_page=10";
  var got = await workflowRuns(env, url);
  var runs = got.runs.filter(function (x) { return x && (x.conclusion === "success" || x.conclusion === "failure" || x.conclusion === "timed_out"); }); // a cancelled or skipped run says nothing
  if (got.status !== 200) { result.model_floor_guard.status = "http_" + got.status; return; }
  if (!runs.length) { result.model_floor_guard.status = "empty"; return; }
  var o = { status: "ok", runs: runs.length, last_conclusion: null, last_run_at: null, last_success_at: null, last_failure_at: null };
  for (var i = 0; i < runs.length; i++) {
    var r = runs[i];
    var t = r && r.run_started_at ? r.run_started_at : null;
    if (i === 0) { o.last_conclusion = r && r.conclusion ? r.conclusion : null; o.last_run_at = t; }
    if (r && r.conclusion === "success" && !o.last_success_at) o.last_success_at = t;
    if (r && (r.conclusion === "failure" || r.conclusion === "timed_out") && !o.last_failure_at) o.last_failure_at = t;
    if (o.last_success_at && o.last_failure_at) break;
  }
  result.model_floor_guard = o;
}

async function runReconcile(env, opts) {
  var started = Date.now();
  var result = {
    version: VERSION, started_at: new Date(started).toISOString(),
    org_ok: false, org_fixed: [], repos_checked: 0, repos_fixed: 0,
    repos_protected: 0, workflows: 0,
    drift: [], workflow_issues: [], limitations: [], errors: [], issue_sync: null, issue_sync_reverse: null
  };

  await reconcileOrg(env, result);

  var repos = await paginate(env, "/orgs/" + ORG + "/repos?type=all");
  var personal = await paginate(env, "/users/" + USER + "/repos?type=owner");
  var seen = {};
  var all = [];
  repos.concat(personal).forEach(function (r) {
    if (!r || !r.full_name || seen[r.full_name]) return;
    seen[r.full_name] = 1;
    all.push(r);
  });

  var active = all.filter(function (r) { return r.archived !== true; });
  result.repos_discovered = all.length;
  result.repos_archived = all.length - active.length;

  for (var i = 0; i < active.length; i++) {
    result.repos_checked++;
    try {
      await reconcileRepo(env, active[i], result);
      await recordModelFloorGuardRun(env, active[i], result);
      if (opts && opts.workflows) await auditWorkflows(env, active[i], result);
    } catch (e) {
      result.errors.push({ scope: active[i].full_name, why: String(e && e.message || e).slice(0, 140) });
    }
  }

  protectionLimitation(result);
  try { await mainRulesVisibility(env, result); } catch (eM) { result.errors.push({ scope: "main_rules", why: String(eM && eM.message || eM).slice(0, 140) }); }
  try { await modelFloorGuardVisibility(env, result); } catch (eM) { result.errors.push({ scope: "model_floor_guard", why: String(eM && eM.message || eM).slice(0, 140) }); }

  if (!opts || opts.notifications !== false) {
    try { await triageNotifications(env, result); } catch (eN) { result.errors.push({ scope: "notifications", why: String(eN && eN.message || eN).slice(0, 140) }); }
  }
  /* ISSUE-SYNC-1 moved to the 10-minute tracker tick (TRACKER-SYNC-1). */
  result.duration_ms = Date.now() - started;
  result.finished_at = new Date().toISOString();
  return result;
}

async function record(env, result) {
  if (!env.AUDIT) return;
  try {
    await env.AUDIT.prepare(
      "INSERT INTO github_steward_runs (started_at, finished_at, version, repos_discovered, repos_archived, repos_checked, repos_fixed, repos_protected, workflows, drift_count, error_count, limitation_count, duration_ms, detail) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
    ).bind(
      result.started_at, result.finished_at, result.version,
      result.repos_discovered || 0, result.repos_archived || 0, result.repos_checked,
      result.repos_fixed, result.repos_protected, result.workflows,
      result.drift.length, result.errors.length, result.limitations.length,
      result.duration_ms, JSON.stringify(result).slice(0, 400000)
    ).run();
  } catch (e) {
    console.error(JSON.stringify({ worker: "qnfo-github-steward", where: "record", error: String(e && e.message || e) }));
  }
}

async function lastRun(env) {
  if (!env.AUDIT) return null;
  try {
    var r = await env.AUDIT.prepare(
      "SELECT started_at, finished_at, version, repos_checked, repos_fixed, repos_protected, workflows, drift_count, error_count, limitation_count, duration_ms FROM github_steward_runs ORDER BY id DESC LIMIT 1"
    ).first();
    return r || null;
  } catch (e) { return { error: String(e && e.message || e) }; }
}

/* WORKERS-BP-DEBT-1 (agent_issues 2757): the guard refuses a string comparison of a secret, because
 * `!==` short-circuits on the first differing byte and leaks the shared prefix length. Compare
 * fixed-length SHA-256 digests with an accumulate-XOR loop instead. Both sides are hashed, so the
 * comparison is constant-time with respect to the secret's content and its length. */
async function stewardKeyOk(env, provided) {
  if (!env.STEWARD_KEY || !provided) return false;
  var enc = new TextEncoder();
  var pair = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(String(provided))),
    crypto.subtle.digest("SHA-256", enc.encode(String(env.STEWARD_KEY)))
  ]);
  var a = new Uint8Array(pair[0]), b = new Uint8Array(pair[1]), d = 0;
  for (var i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

function json(o, status) {
  return new Response(JSON.stringify(o, null, 1), {
    status: status || 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

/* HEALTH-CONTRACT-1 (agent_issues 2852): the capability contract on /health. qnfo-deploy-guard snapshots capabilities[] and
 * limitations[] from every live worker's /health and qnfo-fleet-control grades the share that declare both
 * (capability_contract_conformance). Each line states what this file does or refuses to do. */
var CAPABILITIES = [
  "repo-reconcile: compares every non-archived repository of the org and the owner account to DESIRED_REPO and writes the fields that differ (merge policy, branch deletion, auto-merge, update branch)",
  "org-reconcile: compares the organisation to DESIRED_ORG (default repository permission, public repository creation, organisation projects) and writes the difference",
  "branch-protection: PUTs the declared PROTECTION on a default branch that has none, and records a protection answer it cannot read as one counted limitation",
  "main-rules-visibility: records the rules that apply to QNFO/qnfo-workers main (status, rule types, required checks) on every run",
  "tracker-sync: mirrors agent_issues to GitHub issues and code_tasks to pull requests every 10 minutes, oldest change first, inside a time and subrequest budget",
  "portfolio-sync: derives projects from the census and mirrors programs, projects, issues and the roadmap to GitHub labels, milestones, issues and the Projects board",
  "roadmap-scope: files a roadmap item as a GitHub issue only when its source is a work source; sources with mirrored = 0 in roadmap_mirror_scope (default projects, metric-breach, failure_modes) stay in qnfo-audit and the Projects board, and an open issue for one is closed not_planned; a row whose artifact_type is agent_issue is the twin of an agent issue ticket and is never filed, whatever its source (ROADMAP-TWIN-ROWS-1)",
  "model-floor-guard-visibility: records the model-floor-guard workflow runs on main as a countable fact",
  "dispatch-liveness: files liveness:dispatcher-stalled when the per-minute dispatcher has been quiet for over 20 minutes, from outside that failure domain",
  "reports: GET /report, GET /tracker, GET /portfolio and GET /roadmap return the last run of each stage"
];
var LIMITATIONS = [
  "additive only: never deletes a repository, archives one, pushes a commit or rewrites a workflow file; workflow findings are reported, not edited",
  "a setting the platform refuses (branch protection and auto-merge on a private repository on the free plan) is recorded as a permanent limitation and not retried as a failure",
  "organisation two_factor_requirement_enabled cannot be set through the REST API on this plan",
  "a credential that cannot read branch protection (403 Resource not accessible by integration) leaves protection unchanged and is counted, never treated as protected",
  "stops a tick on a GitHub rate limit (429, or a 403 that says so) and makes no further call until Retry-After has passed",
  "the tracker mass-flip guard refuses a change in which D1 and GitHub disagree without an explained open/closed move, and leaves that pair for the next tick",
  "a roadmap source taken out of the mirror scope closes its open GitHub issues as not_planned, 40 per tick; it deletes nothing in qnfo-audit, and putting the source back (mirrored = 1) reopens the linked issues of its not-done items, 40 per tick",
  "POST /tick and POST /tracker/tick need the steward key; GET reads are public",
  "runs on a 5-minute grid with the repository reconcile hourly on the :15 fire; /health reports only the worker and its settings, the last run is on /report"
];

export default {
  async fetch(request, env) {
    var url = new URL(request.url);
    var p = url.pathname;

    if (p === "/health" || p === "/") {
      return json({
        status: "ok", worker: "qnfo-github-steward", version: VERSION,
        capabilities: CAPABILITIES, limitations: LIMITATIONS,
        scope: { org: ORG, user: USER },
        desired_org: DESIRED_ORG, desired_repo: DESIRED_REPO,
        token_present: !!env.GITHUB_TOKEN,
        limitation: "workflow YAML is reported, never rewritten; org two_factor_requirement_enabled cannot be set through the REST API on this plan"
      });
    }

    if (p === "/report" && request.method === "GET") {
      return json({ version: VERSION, last_run: await lastRun(env) });
    }

    if (p === "/tracker" && request.method === "GET") {
      var last = null;
      try { last = JSON.parse(await tsState(env, "last_run") || "null"); } catch (e) { last = { error: String(e && e.message || e) }; }
      return json({ version: VERSION, cron: TS_CRON, last_run: last });
    }

    if (p === "/tracker/tick" && request.method === "POST") {
      if (!(await stewardKeyOk(env, request.headers.get("x-steward-key") || ""))) {
        return json({ ok: false, error: "POST /tracker/tick needs x-steward-key" }, 401);
      }
      return json({ ok: true, result: await trackerSync(env) });
    }

    if (p === "/portfolio" && request.method === "GET") {
      var plast = null;
      try { plast = JSON.parse(await tsState(env, "portfolio_last_run") || "null"); } catch (e) { plast = { error: String(e && e.message || e) }; }
      return json({ version: VERSION, cron: TS_CRON, last_run: plast });
    }

    if (p === "/roadmap" && request.method === "GET") {
      try { return json(await portfolioTree(env)); } catch (e) { return json({ error: String(e && e.message || e).slice(0, 200) }, 500); }
    }

    if (p === "/portfolio/tick" && request.method === "POST") {
      if (!(await stewardKeyOk(env, request.headers.get("x-steward-key") || ""))) {
        return json({ ok: false, error: "POST /portfolio/tick needs x-steward-key" }, 401);
      }
      return json({ ok: true, result: await portfolioSync(env) });
    }

    if (p === "/tick") {
      var key = request.headers.get("x-steward-key") || "";
      if (!(await stewardKeyOk(env, key))) {
        return json({ ok: false, error: "POST /tick needs x-steward-key" }, 401);
      }
      var opts = { workflows: url.searchParams.get("workflows") === "1", notifications: url.searchParams.get("notifications") !== "0" };
      var res = await runReconcile(env, opts);
      await record(env, res);
      return json({ ok: true, result: res });
    }

    return json({ error: "not found", routes: ["GET /health", "GET /report", "POST /tick", "GET /tracker", "POST /tracker/tick", "GET /portfolio", "GET /roadmap", "POST /portfolio/tick"] }, 404);
  },

  async scheduled(event, env, ctx) {
    return cronGridRun(env.AUDIT, event, ctx, CRON_GRID_CFG, function (ev, c) { return stewardScheduled(ev, env, c); });
  }
};
async function stewardScheduled(event, env, ctx) {
    if (event && event.cron === TS_CRON) {
      var ts = await trackerSync(env);
      console.log(JSON.stringify({ worker: "qnfo-github-steward", version: VERSION, cron: event.cron, tracker: { mirrored: ts.mirrored, relinked: ts.relinked, closed: ts.closed, reopened: ts.reopened, carried: ts.state_sync ? ts.state_sync.carried : null, tasks_fixed: ts.tasks_fixed.length, drift: ts.drift, errors: ts.errors.length } }));
      /* PORTFOLIO-SYNC-1 runs after the tracker so it places the issues this tick just mirrored. */
      var ps = await portfolioSync(env);
      console.log(JSON.stringify({ worker: "qnfo-github-steward", version: VERSION, cron: event.cron, portfolio: { projects_created: ps.projects_created, projects_retired: ps.projects_retired, objectives_opened: ps.objectives_opened, objectives_verified: ps.objectives_verified, milestones_created: ps.milestones_created, issues_synced: ps.issues_synced, roadmap_mirrored: ps.roadmap_mirrored, roadmap_closed: ps.roadmap_closed, drift: ps.drift, errors: ps.errors.length, limitations: ps.limitations.length } }));
      return;
    }
    var res = await runReconcile(env, { workflows: false });
    await record(env, res);
    try { res.fleet_pr_share = await fleetPrShare(env); } catch (eF) { console.error(JSON.stringify({ worker: "qnfo-github-steward", where: "fleet-pr-share", error: String(eF && eF.message || eF).slice(0, 200) })); }
    console.log(JSON.stringify({
      worker: "qnfo-github-steward", version: VERSION, cron: event.cron,
      checked: res.repos_checked, fixed: res.repos_fixed, protected: res.repos_protected,
      drift: res.drift.length, errors: res.errors.length, limitations: res.limitations.length
    }));
}
// ---- CRON-GRID-1:BEGIN (owner directive 2026-10-19: "ALL CRON TICKS SHALL BE MEASURED IN 5-MINUTE INTERVALS, AND NO CRON
// SHALL EXECUTE LESS THAN ONCE EVERY HOUR. ALL CRON FAILURES/ERRORS SHALL BE TRIAGED AND REMEDIATED AUTOMATICALLY BY THE FLEET.")
// Cloudflare fires this worker only on triggers that repeat at least hourly, on minutes that are multiples of 5. A job that
// had its own slower trigger (daily, weekly, every 6 hours) keeps its cadence: it runs on the first grid fire after its old
// slot, and is retried on later fires while its last good run is older than its period plus 30 minutes, at most
// CRON_GRID_RETRIES times in a row; past that CRON-WATCH-1 (qnfo-audit fleet_tasks cron-watch) escalates it to the code loop.
// Every run is one cron_fire_log row (source worker:<name>, outcome ok, error or idle) that CRON-WATCH-1 reads. A job named
// retry: false (a send to people outside the fleet) runs only on its slot, so a failure is never repeated at a reader.
var CRON_GRID_RETRIES = 3;
function cronGridField(spec, v, lo, hi) {
  return String(spec).split(",").some(function (part) {
    var step = 1, sm = /^(.*)\/(\d+)$/.exec(part), a, b;
    if (sm) { part = sm[1]; step = Math.max(1, parseInt(sm[2], 10)); }
    if (part === "*") { a = lo; b = hi; }
    else if (part.indexOf("-") > 0) { a = parseInt(part, 10); b = parseInt(part.split("-")[1], 10); }
    else { a = parseInt(part, 10); b = sm ? hi : a; }
    return v >= a && v <= b && (v - a) % step === 0;
  });
}
// Cloudflare numbers weekdays 1 (Sunday) to 7 (Saturday) (CF-DOW, qnfo-fleet-control 2026-10-05).
function cronGridMatch(expr, d) {
  var f = String(expr).trim().split(/\s+/);
  if (f.length !== 5) return false;
  var domOk = cronGridField(f[2], d.getUTCDate(), 1, 31), dowOk = cronGridField(f[4], d.getUTCDay() + 1, 1, 7);
  var dayOk = f[2] !== "*" && f[4] !== "*" ? (domOk || dowOk) : (domOk && dowOk);
  return dayOk && cronGridField(f[0], d.getUTCMinutes(), 0, 59) && cronGridField(f[1], d.getUTCHours(), 0, 23) && cronGridField(f[3], d.getUTCMonth() + 1, 1, 12);
}
// True when expr had a slot in the window (sinceMs, untilMs].
function cronGridSlot(expr, sinceMs, untilMs) {
  for (var t = Math.floor(untilMs / 60000) * 60000; t > sinceMs; t -= 60000) if (cronGridMatch(expr, new Date(t))) return true;
  return false;
}
async function cronGridLog(db, worker, expr, startMs, outcome, note) {
  if (!db) return;
  try {
    await db.prepare("INSERT INTO cron_fire_log (cron_name, task_id, cron_expr, fired_at, fired_epoch_ms, outcome, source, note) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)")
      .bind(worker + "|" + expr, worker, expr, new Date(startMs).toISOString(), startMs, outcome, "worker:" + worker, String(note || "").slice(0, 500)).run();
  } catch (e) { console.error(JSON.stringify({ worker: worker, where: "cron-grid-log", error: String(e && e.message || e).slice(0, 200) })); }
}
async function cronGridDue(db, cfg, nowMs) {
  var out = [], lag = cfg.lagMin || 0;
  for (var i = 0; i < cfg.jobs.length; i++) {
    var j = cfg.jobs[i];
    if (cronGridSlot(j.cron, nowMs - (lag + cfg.tickMin) * 60000, nowMs - lag * 60000)) { out.push({ cron: j.cron, why: "slot" }); continue; }
    if (!db || !j.retry) continue;
    try {
      var name = cfg.worker + "|" + j.cron;
      var r = await db.prepare("SELECT COUNT(*) AS n, MAX(CASE WHEN outcome = 'ok' THEN fired_epoch_ms END) AS last_ok, SUM(CASE WHEN outcome = 'error' AND fired_epoch_ms > COALESCE((SELECT MAX(fired_epoch_ms) FROM cron_fire_log WHERE cron_name = ?1 AND outcome = 'ok'), 0) THEN 1 ELSE 0 END) AS fails FROM cron_fire_log WHERE cron_name = ?1").bind(name).first();
      if (r && Number(r.n) > 0 && Number(r.fails || 0) < CRON_GRID_RETRIES && nowMs - Number(r.last_ok || 0) > (j.periodMin + 30) * 60000) out.push({ cron: j.cron, why: "retry" });
    } catch (e) { console.error(JSON.stringify({ worker: cfg.worker, where: "cron-grid-due", error: String(e && e.message || e).slice(0, 200) })); }
  }
  return out;
}
// One run of the worker's own handler, awaited with its waitUntil work, logged with its outcome.
async function cronGridOne(db, worker, expr, why, ev, ctx, run) {
  var t0 = Date.now(), pending = [];
  var c = { waitUntil: function (p) { pending.push(Promise.resolve(p)); } };
  try {
    await run(ev, c);
    // Index loop, not allSettled: work a waitUntil promise adds while it runs is awaited too.
    var bad = null;
    for (var k = 0; k < pending.length; k++) { try { await pending[k]; } catch (e) { if (!bad) bad = e || new Error("waitUntil rejected"); } }
    if (bad) throw bad;
    await cronGridLog(db, worker, expr, t0, "ok", why + " " + (Date.now() - t0) + " ms");
  } catch (e) {
    await cronGridLog(db, worker, expr, t0, "error", why + ": " + String(e && e.message || e));
    throw e;
  }
}
// cfg: { worker, tick, tickMin, lagMin, jobs: [{ cron, periodMin, retry }], own: "self" | "none" | "<cron the tick runs as>", ownWhenDue }
async function cronGridRun(db, event, ctx, cfg, run) {
  var cron = String((event && event.cron) || "");
  var nowMs = Number(event && event.scheduledTime) || Date.now();
  if (cron !== cfg.tick) return cronGridOne(db, cfg.worker, cron || "manual", "fire", event, ctx, run);
  var due = await cronGridDue(db, cfg, nowMs), firstErr = null;
  for (var i = 0; i < due.length; i++) {
    try { await cronGridOne(db, cfg.worker, due[i].cron, due[i].why, { cron: due[i].cron, scheduledTime: nowMs, type: "scheduled" }, ctx, run); }
    catch (e) { if (!firstErr) firstErr = e; }
  }
  if (cfg.own === "none" || (due.length && cfg.ownWhenDue === false)) {
    if (!due.length) await cronGridLog(db, cfg.worker, cfg.tick, nowMs, "idle", "grid tick: no job due");
  } else {
    var ev = cfg.own && cfg.own !== "self" ? { cron: cfg.own, scheduledTime: nowMs, type: "scheduled" } : event;
    try { await cronGridOne(db, cfg.worker, cfg.tick, "tick", ev, ctx, run); } catch (e) { if (!firstErr) firstErr = e; }
  }
  if (firstErr) throw firstErr;
}
// ---- CRON-GRID-1:END ----
var CRON_GRID_CFG = {"worker": "qnfo-github-steward", "tick": "5,15,25,35,45,55 * * * *", "tickMin": 10, "jobs": [{"cron": "15 * * * *", "periodMin": 60, "retry": true}], "own": "self"};
