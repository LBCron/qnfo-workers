#!/usr/bin/env python3
"""conflict_repair.py -- CONFLICT-REPAIR-DOER-1 (agent_issues 2305, charter pillar: autonomy).

WHAT  The doer for STALE-PR-CONFLICT-REPAIR-1 issues (qnfo-fleet-control files one per quiet pull request that conflicts with
      its base branch). For one pull request it
        1. reads the pull request (open, same repository, not a draft, `mergeable_state: dirty`);
        2. branches `repair/pr-<n>-<head sha7>` from its base branch and merges the pull request's head into it without committing;
        3. resolves what can be resolved without judgement, keeping the base branch's meaning everywhere else:
             - a conflict whose every hunk is only the `var VERSION = "..."` line of a worker.js takes the pull request's
               line (the next step bumps it), which is how nearly every conflict on this repository arises: two changes to
               one worker each bump the same line;
             - deployed-current.worker.js is never merged: it is rewritten from the resolved worker.js (mirror-guard);
             - anything else is a semantic overlap. The merge is aborted, nothing is pushed, and the outcome is
               `needs-session` with the files, so the issue stays open for a doer that can read the code;
        4. bumps each changed worker's VERSION above what the base branch and every other open pull request claim (VERSION-AHEAD-1);
        5. runs the checks a pull request gets: node --check, the changed workers' suites (scripts/run-suites.mjs),
           mirror-guard, version-bump-guard and the workers-standards guard;
        6. with --push: pushes the branch, opens the replacement pull request naming the old one, dispatches the check
           workflows that accept a dispatch (a pull_request run on a GITHUB_TOKEN push starts no job, see DISPATCHABLE),
           comments on the old pull request and closes it as superseded by the new number.
      Every run writes one cloud_ops_events row (kind conflict-repair-reapplied, status ok | warn) and a branch_hygiene_log
      row; a pull request head that was already re-applied and pushed is skipped. An --all run also writes an hourly
      heartbeat row (id conflict-repair-tick-<UTC hour>) so the watchmaker can prove the doer ran.
      It never merges, never force-pushes, never touches main, and refuses a pull request that changes .github/ (the
      Actions token may not push workflow files).
USAGE python3 scripts/conflict_repair.py --pr <n> [--push] [--keep-branch]
      python3 scripts/conflict_repair.py --all [--push] [--max 3]      every open STALE-PR-CONFLICT-REPAIR-1 issue's pull request
      python3 scripts/conflict_repair.py --selftest
      Reads GH_TOKEN (gh), CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID (ledger rows; skipped with a warning when absent).
      Exit 0 unless the arguments are wrong: an outcome is data, written to the ledger and printed as JSON.
"""
import argparse
import calendar
import json
import os
import re
import shutil
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from code_delivery import numstat_has_code_changes  # noqa: E402
REPO = os.environ.get("GITHUB_REPOSITORY") or "QNFO/qnfo-workers"
DB_ID = "35e2e573-92f3-46ac-83c6-22f6429fc5e5"
VERSION_LINE = re.compile(r'^(var VERSION ?= ?)"([^"\n]*)"(;?.*)$', re.M)  # group 1 keeps the file's own spacing (qnfo-gateway writes var VERSION="x")
NOTE_BLOCK = re.compile(r"/\*.*?\*/", re.S)
HOLD_RE = re.compile(r"(^|[\s\[(])(wip|do[\s-]*not[\s-]*merge|hold)([\s:\])]|$)", re.I)
# PR-MERGE-SLA-10M-1 (2026-10-26, owner directive: every pull request merges within 10 minutes of opening): a person's branch waited the full ten
# minutes of quiet before a repair, which alone is the whole SLA. The repair is a fast-forward merge of main into the branch, never forced, so an
# author's concurrent push wins and the next main push tries again; 3 minutes matches the merge lane's quiet window (qnfo-fleet-control
# stale_pr_merge_idle_min).
# PR-MERGE-SLA-10M-1: the body phrases that ask the lane and this doer to wait; the same set as BH_BODY_HOLD_RE in qnfo-fleet-control (a session that keeps its
# pull request as a draft on purpose says so in the body, because the harness opens every one as a draft).
BODY_HOLD_RE = re.compile(r"\b(do[\s-]*not[\s-]*merge|don'?t[\s-]*merge|draft[\s-]+until|stays?[\s-]+(a[\s-]+)?draft|keep[\s-]+(it[\s-]+|this[\s-]+)?(as[\s-]+)?a[\s-]+draft|not[\s-]+ready[\s-]+(for[\s-]+(review|merge)|to[\s-]+merge))\b", re.I)
DIRTY_QUIET_MIN = 3  # a pull request whose newest commit is younger is still being worked on
# PR-MERGE-SLA-10M-1: the harness opens every session pull request as a draft, so skipping drafts left them conflicting until their author came back.
# A draft that asks to wait (WIP, hold, do-not-merge in the title, labels or body) is still left alone (asks_to_wait). Switch: CONFLICT_REPAIR_DRAFTS=off
# restores the old refusal, mirroring ops_config stale_pr_merge_drafts on the merge lane.
DRAFTS = (os.environ.get("CONFLICT_REPAIR_DRAFTS") or "on").strip().lower() not in ("0", "off", "false", "no", "disabled")
# CONFLICT-REPAIR-BOT-QUIET-1 (2026-10-26): a code-loop branch (codeagent-*) has no author mid-edit, so waiting ten minutes only adds latency.
# Each merge to a hot worker (qnfo-research-exec took six queued code tasks at once on 2026-10-26) makes every other pull request on it
# conflict, and the wait is paid once per merge: 5 pull requests x 10 minutes of quiet = 50 minutes of a 120-minute SLA. A repair is
# followed by a gate of 5 to 9 minutes and conflicts recur only after another merge to the same worker (one per runner tick, >= 10 minutes
# apart), so 3 minutes cannot start a repair loop.
BOT_BRANCH_PREFIX = "codeagent-"
BOT_QUIET_MIN = 3
ISSUE_PR = re.compile(r"STALE-PR-CONFLICT-REPAIR-1\b[^\d#]{0,40}#?(\d+)")
# The check workflows dispatched on a branch this script pushes (each declares workflow_dispatch; scripts/conflict_repair_test.py pins that).
# PR-GUARD-FIXES-1 (2026-10-20, agent_issues 100295): a push with GITHUB_TOKEN does not "start no pull_request workflow". GitHub creates the
# pull_request runs for the pusher github-actions[bot] and they never start a job: run 39318576612 (version-compare, PR 3106, created
# 2026-10-19T20:21:07Z by this script's push) has 0 jobs, run_attempt 1, and was concluded `failure` at 22:34:28Z, the second the pull
# request merged. The 2026-10-20 audit counted 36 such runs over PRs 2901, 2986, 3056, 3100 and 3106 (six workflows each), failed when
# their pull request closed or merged, with no guard run on the repaired head. The wait is inferred to be an approval gate (the audit
# read `action_required` on attempt 1 of sibling runs, which passed at once on a person's re-run, attempt 2), and nobody clicks it. A
# workflow_dispatch run on the same head does start, so the checks the merge lane requires are dispatched here. mirror-guard.yml
# (check `mirror-guard`, in EVOLVE_REQUIRED of qnfo-fleet-control) was missing, so a repaired head had no mirror-guard result until a
# person re-ran it: PR 3106 waited four hours. A dispatched mirror-guard run is the strict global audit (no --scope-to-diff), so it
# reads the whole tree of the repaired head.
# Failed-run accounting must not count the zero-job runs: a pull_request run by github-actions[bot] with 0 jobs and conclusion failure,
# ending the second its pull request closed or merged, is a gate artifact and no verdict on the change. (ci_watchdog.py classes a
# zero-job run as invalid-workflow, so it would misdiagnose these if its scope widened from main to pull-request branches.)
DISPATCHABLE = ["deploy-gate.yml", "version-bump-guard.yml", "mirror-guard.yml", "charter-guard.yml", "version-compare.yml"]
# PHANTOM-RUN-CLEAR-1 (2026-10-26, owner directive "remediate all failing workflows"; corrects PHANTOM-RUN-CANCEL-1 of the same day): the zero-job
# pull_request runs described above were two thirds of every failure on the Actions page (56 of 84 in 24 h: seven repaired pull request heads x
# eight workflows). MEASURED on the next repair push (claude/project-thread-0hsmo1, 06:58Z): they are approval-gated runs, status `completed`,
# conclusion `action_required`, zero jobs, by github-actions[bot]; GitHub concludes them `failure` the second the pull request closes. A
# completed run cannot be cancelled (HTTP 409), so the first version of this step, which cancelled only runs that were not completed, caught
# none of them. A completed zero-job run carries no verdict and no log, so it is deleted (HTTP 204 for a completed run); a run that is still in
# flight is cancelled. The first version approved nothing: the approval gate is a security control (POST .../approve starts such a run for real, measured
# once as a probe) and relaxing it was the owner's decision; the owner has since decided it (OWNER-AUTO-APPROVE-ALL-1 below). The dispatched workflow_dispatch runs are another
# event and are never touched.
# OWNER-AUTO-APPROVE-ALL-1 (2026-10-26): the owner answered "Yes, auto-approve all" to the question whether a repair push's approval-gated runs may be approved instead of
# deleted. They are now approved (POST .../approve), so the pull_request checks run for real on the repaired head and the pull request no longer carries a failed zero-job run when
# it closes. Only a run of THIS push (head_sha), of THIS repository's own branch (head_repository), event pull_request, by github-actions[bot], concluded action_required with zero
# jobs is approved: a fork run, a person's run and a dispatched run are never touched. An approval GitHub refuses falls back to the deletion above. CONFLICT_REPAIR_APPROVE=off
# restores "nothing is approved" without a deploy of anything but the workflow env.
APPROVE_PHANTOM = (os.environ.get("CONFLICT_REPAIR_APPROVE") or "on").strip().lower() not in ("0", "off", "false", "no", "disabled")
PHANTOM_PASSES = 3
PHANTOM_WAIT_S = 8


def emit(msg):
    print(msg, flush=True)


def clear_phantom_runs(sha, api=None, sleep=None, passes=None, wait=None, approve=None):
    """Clear the pull_request runs that a GITHUB_TOKEN push of `sha` created. Returns [(run id, workflow name, action, done)].

    action is "approve" for a completed, action_required, zero-job run of this repository's own branch while approval is on (OWNER-AUTO-APPROVE-ALL-1; a refused approval
    falls back to the deletion), "delete" for such a run otherwise and "cancel" for a run still in flight. GitHub creates the runs a few
    seconds after the push, so the list is read `passes` times, `wait` seconds apart, and each run is handled once. Nothing here can fail the
    repair: gh() answers None on any error and that is recorded as not done.
    """
    api = api or gh
    sleep = sleep or time.sleep
    approve = APPROVE_PHANTOM if approve is None else approve
    passes = PHANTOM_PASSES if passes is None else passes
    wait = PHANTOM_WAIT_S if wait is None else wait
    seen = {}
    for i in range(passes):
        if i:
            sleep(wait)
        data = api("repos/%s/actions/runs?head_sha=%s&event=pull_request&per_page=50" % (REPO, sha))
        for run in (data or {}).get("workflow_runs", []) if isinstance(data, dict) else []:
            rid = run.get("id")
            if not rid or rid in seen:
                continue
            if (run.get("actor") or {}).get("login") != "github-actions[bot]" or run.get("event") != "pull_request":
                continue
            if run.get("status") != "completed":
                seen[rid] = (run.get("name"), "cancel", api("repos/%s/actions/runs/%d/cancel" % (REPO, rid), "POST") is not None)
            elif run.get("conclusion") == "action_required":
                jobs = api("repos/%s/actions/runs/%d/jobs" % (REPO, rid))
                if isinstance(jobs, dict) and jobs.get("total_count") == 0:
                    own = (run.get("head_repository") or {}).get("full_name") == REPO and run.get("head_sha", sha) == sha
                    if approve and own and api("repos/%s/actions/runs/%d/approve" % (REPO, rid), "POST") is not None:
                        seen[rid] = (run.get("name"), "approve", True)
                        continue
                    seen[rid] = (run.get("name"), "delete", api("repos/%s/actions/runs/%d" % (REPO, rid), "DELETE") is not None)
    return [(rid, name, act, ok) for rid, (name, act, ok) in sorted(seen.items())]


SECRET_ENV = re.compile(r"TOKEN|SECRET|KEY|PASSWORD|CLOUDFLARE|CF_ACCOUNT", re.I)


def clean_env():
    """The environment without credentials: the suites and guards run the pull request's own code, which gets no token."""
    return {k: v for k, v in os.environ.items() if not SECRET_ENV.search(k)}


def sh(args, cwd=None, check=True, timeout=900, env=None):
    r = subprocess.run(list(args), cwd=cwd, capture_output=True, text=True, timeout=timeout, env=env)
    if check and r.returncode != 0:
        raise RuntimeError("%s: %s" % (" ".join(args[:4]), (r.stderr or r.stdout).strip()[:400]))
    return r


def git(args, cwd=None, check=True):
    return sh(["git"] + list(args), cwd, check).stdout


def gh(path, method="GET", fields=None, raw=False):
    """One REST call through gh (GraphQL listings are refused in sessions). Returns parsed JSON, text when raw, or None on failure."""
    cmd = ["gh", "api", "-X", method, path]
    if raw:
        cmd += ["-H", "Accept: application/vnd.github.raw"]
    for k, v in (fields or {}).items():
        cmd += ["-f", "%s=%s" % (k, v)]
    r = sh(cmd, check=False, timeout=120)
    if r.returncode != 0:
        return None
    if raw:
        return r.stdout
    try:
        return json.loads(r.stdout) if r.stdout.strip() else {}
    except ValueError:
        return None


# ---- pure helpers ------------------------------------------------------------------------------------------------------

def read_version(text):
    m = VERSION_LINE.search(str(text or ""))
    return m.group(2) if m else None


def core(v):
    """'0.14.0-conflict-repair' -> (0, 14, 0); None when there is no numeric core."""
    m = re.match(r"^(\d+)\.(\d+)\.(\d+)", str(v or ""))
    return tuple(int(x) for x in m.groups()) if m else None


def bump_above(version, others):
    """version stays when its core is above every core in others; otherwise the highest core's patch + 1, the suffix kept."""
    mine = core(version)
    top = max([c for c in (core(o) for o in others) if c] or [None], key=lambda c: c or (-1,))
    if mine is None:
        return None
    if top is None or mine > top:
        return version
    suffix = re.sub(r"^\d+\.\d+\.\d+", "", version)
    # keep the kind of release the change declared: a minor bump stays a minor bump above main
    if mine[2] == 0 and mine[1] > 0:
        return "%d.%d.0%s" % (top[0], top[1] + 1, suffix)
    return "%d.%d.%d%s" % (top[0], top[1], top[2] + 1, suffix)


def set_version(text, new):
    if len(VERSION_LINE.findall(text)) != 1:
        return None
    return VERSION_LINE.sub(lambda m: m.group(1) + '"' + new + '"' + m.group(3), text, count=1)


def chain_notes(pr_line, main_line):
    """The VERSION line of the pull request with main's release notes kept: the pull request's own new notes first, then every
    note main carries (its new ones and the tail both share). Only /* */ notes are chained; a line whose notes are anything else
    (// style, text outside the blocks) keeps the pull request's line as it is, because those notes cannot be split safely."""
    mp, mm = VERSION_LINE.fullmatch(pr_line), VERSION_LINE.fullmatch(main_line)
    if not mp or not mm:
        return pr_line
    pb, mb = NOTE_BLOCK.findall(mp.group(3)), NOTE_BLOCK.findall(mm.group(3))
    if not pb or not mb or NOTE_BLOCK.sub("", mp.group(3)).strip(" ;") or NOTE_BLOCK.sub("", mm.group(3)).strip(" ;"):
        return pr_line
    k = 0
    while k < min(len(pb), len(mb)) and pb[-1 - k] == mb[-1 - k]:
        k += 1
    return mp.group(1) + '"' + mp.group(2) + '"; ' + " ".join(pb[: len(pb) - k] + mb)


NOTE_LINE = re.compile(r"^[ \t]*/\*.*\*/[ \t]*$")


def merge_note_hunk(pr_part, main_part):
    """One conflict hunk -> its resolved lines, or None when it is a semantic overlap. A hunk resolves when each side is at most one
    VERSION line plus release-note lines (a whole line that is one /* */ comment; VERSION-LINE-SPLIT-1 keeps a worker's notes one per
    line below the statement, agent_issues 100220), with the VERSION line on both sides or on neither: the pull request's side is
    kept (its VERSION line with main's same-line notes chained, see chain_notes) and main's note lines it lacks follow its last note."""
    def split(part):
        v = [k for k, l in enumerate(part) if VERSION_LINE.fullmatch(l)]
        if len(v) > 1 or any(not NOTE_LINE.match(l) for k, l in enumerate(part) if k not in v):
            return None
        return v
    pv, mv = split(pr_part), split(main_part)
    if pv is None or mv is None or len(pv) != len(mv) or not (pr_part or main_part):
        return None
    res = list(pr_part)
    if pv:
        res[pv[0]] = chain_notes(pr_part[pv[0]], main_part[mv[0]])
    have = set(l.strip() for l in pr_part)
    extra = [l for k, l in enumerate(main_part) if k not in mv and l.strip() not in have]
    notes_at = [k for k in range(len(res)) if not pv or k != pv[0]]
    at = (notes_at[-1] + 1) if notes_at else len(res)
    return res[:at] + extra + res[at:]


def resolve_version_only(text, pr_side="theirs"):
    """A file with merge conflict markers -> its text with every hunk resolved to the pull request's VERSION line (its release notes
    chained with main's, see chain_notes), when every hunk is nothing but the VERSION line on both sides; None when any hunk carries
    something else (a semantic overlap). pr_side says which side of the markers is the pull request: "theirs" when the pull request
    is merged into a branch cut from main (a replacement), "ours" when main is merged into the pull request's own branch."""
    out, i, lines, hunks = [], 0, str(text).split("\n"), 0
    while i < len(lines):
        if not lines[i].startswith("<<<<<<< "):
            out.append(lines[i])
            i += 1
            continue
        ours, base, theirs, part = [], [], [], "ours"
        i += 1
        while i < len(lines) and not lines[i].startswith(">>>>>>> "):
            if lines[i].startswith("||||||| "):
                part = "base"
            elif lines[i] == "=======":
                part = "theirs"
            else:
                (ours if part == "ours" else base if part == "base" else theirs).append(lines[i])
            i += 1
        if i >= len(lines):
            return None  # an unterminated hunk
        i += 1
        pr_part, main_part = (ours, theirs) if pr_side == "ours" else (theirs, ours)
        merged = merge_note_hunk(pr_part, main_part)
        if merged is None:
            return None
        out.extend(merged)
        hunks += 1
    return "\n".join(out) if hunks else None


def hold_text(body):
    """The body without fenced blocks and inline code spans: a hold phrase inside code documents a hold, it does not set one (same rule as bhHoldText in
    qnfo-fleet-control). An unterminated fence stays in the text, so an odd body errs towards holding."""
    t = re.sub(r"```.*?```", " ", str(body or ""), flags=re.S)
    t = re.sub(r"~~~.*?~~~", " ", t, flags=re.S)
    return re.sub(r"`[^`\n]*`", " ", t)


def asks_to_wait(pr):
    """True when the pull request's title, labels or description ask not to be touched (WIP, hold, do not merge)."""
    labels = " ".join(str((l or {}).get("name") or "") for l in (pr.get("labels") or []))
    return bool(HOLD_RE.search(str(pr.get("title") or "")) or HOLD_RE.search(labels) or BODY_HOLD_RE.search(hold_text(pr.get("body"))))


def valid_base_branch(base_ref, cwd=None):
    """Whether an API-supplied base branch is a valid Git branch name."""
    if not base_ref:
        return False
    return sh(["git", "check-ref-format", "--branch", str(base_ref)], cwd, check=False, timeout=30).returncode == 0


def fetch_base_branch(base_ref, number, cwd=None):
    """Fetch a validated PR base into an isolated remote-tracking ref."""
    if not valid_base_branch(base_ref, cwd):
        return None
    target = "refs/remotes/origin/pr-base-%d" % int(number)
    git(["fetch", "-q", "origin", "+refs/heads/%s:%s" % (base_ref, target)], cwd)
    return target


def merge_tree_conflicts(number, cwd=None, base_ref="main"):
    """PR-MERGE-SLA-10M-1: True when the pull request's head conflicts with its base branch, False when it merges cleanly, None when that cannot
    be told. GitHub leaves `mergeable` null for as long as a base keeps moving (every 1 to 5 minutes here), so a conflicting pull request read
    as `unknown` was never repaired. git computes it locally: `git merge-tree --write-tree` exits 1 on a conflict and 0 on a clean merge."""
    try:
        base = fetch_base_branch(base_ref, number, cwd)
        if not base:
            return None
        git(["fetch", "-q", "origin", "+refs/pull/%d/head:refs/remotes/origin/pr-%d" % (number, number)], cwd)
        r = sh(["git", "merge-tree", "--write-tree", "--name-only", base, "refs/remotes/origin/pr-%d" % number], cwd, check=False, timeout=120)
    except Exception:  # a failed fetch or a git older than 2.38 is "cannot tell", never a conflict
        return None
    if r.returncode == 1:
        return True
    return False if r.returncode == 0 else None


def dirty_prs(limit, quiet_min=DIRTY_QUIET_MIN, now=None, ghf=None, sleep=time.sleep, mtf=None):
    """Open pull requests GitHub reports as conflicting with their base (mergeable_state dirty), oldest-quiet first, up to limit: any author,
    any branch except repair/*, a draft, a hold or a fork. A pull request whose newest commit is younger than quiet_min minutes
    is left to its author. GitHub computes mergeability on the first read, so a null is read again a few times; a pull request still null
    after that is tested with git (merge_tree_conflicts) instead of being skipped. A draft is taken unless it asks to wait (DRAFTS)."""
    ghf = ghf or gh
    mtf = mtf or merge_tree_conflicts
    now = time.time() if now is None else now
    found = []
    for p in ghf("repos/%s/pulls?state=open&per_page=100" % REPO) or []:
        n, ref = p.get("number"), str((p.get("head") or {}).get("ref") or "")
        if not n or (p.get("draft") and not DRAFTS) or ref.startswith("repair/") or asks_to_wait(p):
            continue
        full = None
        for tries in range(3):
            full = ghf("repos/%s/pulls/%d" % (REPO, n))
            if not isinstance(full, dict) or full.get("mergeable") is not None:
                break
            sleep(5)
        if not isinstance(full, dict) or eligible(full):
            continue
        base_branch = str((full.get("base") or {}).get("ref") or "")
        conflicting = full.get("mergeable") is False and full.get("mergeable_state") == "dirty"
        if not conflicting and full.get("mergeable") is None:
            conflicting = mtf(n, base_branch) is True
        if not conflicting:
            continue
        c = ghf("repos/%s/commits/%s" % (REPO, full["head"]["sha"])) or {}
        stamp = ((c.get("commit") or {}).get("committer") or {}).get("date") or ""
        try:
            age = (now - calendar.timegm(time.strptime(stamp, "%Y-%m-%dT%H:%M:%SZ"))) / 60.0
        except ValueError:
            age = 1e9
        if age >= (min(quiet_min, BOT_QUIET_MIN) if ref.startswith(BOT_BRANCH_PREFIX) else quiet_min):
            found.append((age, n))
    found.sort(reverse=True)
    return [n for _, n in found[: max(1, limit)]]


def eligible(pr):
    """A pull request object -> None when the doer may take it, else the reason it does not."""
    if not isinstance(pr, dict) or not pr.get("number"):
        return "the pull request could not be read"
    if pr.get("state") != "open":
        return "the pull request is " + str(pr.get("state"))
    if pr.get("draft") and not DRAFTS:
        return "the pull request is a draft"
    if pr.get("draft") and asks_to_wait(pr):
        return "the pull request is a draft that asks to wait"
    head = pr.get("head") or {}
    base = pr.get("base") or {}
    if ((head.get("repo") or {}).get("full_name") or "") != (base.get("repo") or {}).get("full_name"):
        return "the head is a fork"
    if not base.get("ref"):
        return "the base branch could not be read"
    if str(head.get("ref") or "").startswith("repair/"):
        return "the pull request is itself a repair"
    if pr.get("mergeable") is True:
        return "the pull request does not conflict with main"
    return None


def branch_name(pr):
    return "repair/pr-%d-%s" % (int(pr["number"]), str((pr.get("head") or {}).get("sha") or "")[:7])


def replacement_text(pr, bumped, checks):
    base_branch = str((pr.get("base") or {}).get("ref") or "main")
    title = re.sub(r"\s*\(re-applied from #\d+\)$", "", str(pr.get("title") or "pull request %s" % pr["number"]))[:200] + " (re-applied from #%d)" % pr["number"]
    body = ("Charter pillar: autonomy. CONFLICT-REPAIR-DOER-1 (agent_issues 2305): pull request #%d conflicted with %s and went quiet, so its "
            "commits are re-applied here on top of that base. Only VERSION-line and mirror conflicts were resolved; every other line is the "
            "original change or the base.\n\n" % (pr["number"], base_branch))
    if bumped:
        body += "VERSION raised above the base branch and the open pull requests: " + "; ".join("%s %s -> %s" % b for b in bumped) + ".\n\n"
    body += "Checked on the runner before the push: " + "; ".join("%s %s" % (k, "ok" if v else "FAILED") for k, v in checks) + ".\n\n"
    body += "## Definition of done (CODE-CHANGE-REQUIRED-1)\n\nImplement the issue's remedy in code, an applied migration or executable configuration in this PR; link the issue, identify implementation paths, run regression checks and verify the outcome after canonical deployment. No empty, documentation-only or investigation-only PR satisfies this contract.\n\n"
    body += "Supersedes #%d, which is closed with this number.\n\n---\nOriginal description:\n\n%s\n" % (pr["number"], str(pr.get("body") or "")[:6000])
    return title, body


def issue_prs(titles):
    """Issue titles -> the pull request numbers they name, in order, once each."""
    out = []
    for t in titles or []:
        m = ISSUE_PR.search(str(t or ""))
        if m and int(m.group(1)) not in out:
            out.append(int(m.group(1)))
    return out


# ---- the re-apply ------------------------------------------------------------------------------------------------------

def reapply(head_ref, base_ref, branch, cwd=None, message=None, in_place=False):
    """Merges head_ref into a new branch cut from base_ref and resolves VERSION-only and mirror conflicts.
    in_place=True runs the other way round: base_ref is merged into a branch cut from head_ref (the pull request's own commits stay
    where they are, so the pull request, its number and its code task survive; the result is pushed to the pull request's branch).
    Returns {"outcome": "reapplied", "workers": [dir], "resolved": [path]} with the merge staged but NOT committed, or
    {"outcome": "needs-session" | "clean" | "error", ...} with the tree restored."""
    if in_place:
        git(["checkout", "-q", "-B", branch, head_ref], cwd)
        r = sh(["git", "merge", "--no-ff", "--no-commit", base_ref], cwd, check=False)
    else:
        git(["checkout", "-q", "-B", branch, base_ref], cwd)
        r = sh(["git", "merge", "--no-ff", "--no-commit", head_ref], cwd, check=False)
    conflicted = [p for p in git(["diff", "--name-only", "--diff-filter=U"], cwd).split("\n") if p]
    if r.returncode != 0 and not conflicted:
        sh(["git", "merge", "--abort"], cwd, check=False)
        return {"outcome": "error", "error": (r.stderr or r.stdout).strip()[:300]}
    resolved, hard = [], []
    for p in conflicted:
        full = os.path.join(cwd or ".", p)
        if os.path.basename(p) == "deployed-current.worker.js":
            continue  # rewritten from worker.js below
        if os.path.basename(p) == "worker.js" and os.path.isfile(full):
            with open(full, encoding="utf-8", errors="replace") as fh:
                fixed = resolve_version_only(fh.read(), "ours" if in_place else "theirs")
            if fixed is not None:
                with open(full, "w", encoding="utf-8") as fh:
                    fh.write(fixed)
                git(["add", p], cwd)
                resolved.append(p)
                continue
        hard.append(p)
    if hard:
        sh(["git", "merge", "--abort"], cwd, check=False)
        return {"outcome": "needs-session", "files": hard, "resolved": resolved}
    changed = [p for p in git(["diff", "--name-only", "--cached", base_ref], cwd).split("\n") if p]
    changed = sorted(set(changed) | set(conflicted))
    workers = sorted({p.split("/")[0] for p in changed if re.fullmatch(r"[^/]+/(?:worker\.js|deployed-current\.worker\.js)", p)})
    for w in workers:
        src, mirror = os.path.join(cwd or ".", w, "worker.js"), os.path.join(cwd or ".", w, "deployed-current.worker.js")
        if os.path.isfile(src) and (os.path.isfile(mirror) or (w + "/deployed-current.worker.js") in conflicted):
            shutil.copyfile(src, mirror)
            git(["add", w + "/deployed-current.worker.js"], cwd)
            if (w + "/deployed-current.worker.js") in conflicted:
                resolved.append(w + "/deployed-current.worker.js")
    return {"outcome": "reapplied" if conflicted else "clean", "workers": workers, "resolved": resolved, "changed": changed}


def landed_on_base(head_ref, base_ref, cwd=None, min_len=12):
    """MERGE-LANE-LANDED-1 and -2 (agent_issues 100293, PR 3093): returns the changed files when the pull request's change is already in its base's
    copy of each of them, else None. A pull request whose change reached its base by another route has no conflict to repair, so it is closed as
    superseded instead of left with an issue that says 'needs judgement' (PR 3093 sat conflicted for hours although q08-signal-engine already
    carried its qwen switch).
    The test is placement-aware (MERGE-LANE-LANDED-2): the first version asked only that each added line occur somewhere in the base file, so a
    one-line pull request that adds a call the base already has in another function (handleB gains the validateInput(...) that handleA has) read as
    landed and would have been closed with valid work in it. Each change segment of the diff (unified=1) must now appear in the base contiguously,
    with its leading and trailing context line around the added lines (so a pure deletion needs the two context lines adjacent), and a line the
    pull request removes must be gone from the base file altogether. The VERSION line and the deployed-current mirror never count: a pull
    request's own bump is never on its base and the mirror is a copy of worker.js. Anything uncertain (a changed neighbour, a file the base lacks,
    a segment that mixes a VERSION line) returns None and the pull request is repaired as before. min_len keeps its old meaning for removed lines."""
    out = git(["diff", "--unified=1", "--no-color", "%s...%s" % (base_ref, head_ref)], cwd)
    segs, cur, seg, ctx_before, in_hunk = {}, None, None, None, False

    def flush():
        nonlocal seg
        if seg and (seg["added"] or seg["removed"]):
            segs.setdefault(seg["file"], []).append(seg)
        seg = None

    for line in out.split("\n"):
        if line.startswith("diff --git "):
            flush(); cur = None; in_hunk = False; ctx_before = None
        elif line.startswith("+++ "):
            cur = line[6:] if line.startswith("+++ b/") else None
            if cur and os.path.basename(cur) == "deployed-current.worker.js":
                cur = None
        elif line.startswith("@@"):
            flush(); in_hunk = True; ctx_before = None
        elif cur and in_hunk and line[:1] in ("+", "-", " "):
            kind, text = line[0], line[1:].strip()
            if kind == " ":
                if seg:
                    seg["after"] = text
                    flush()
                ctx_before = text
            else:
                if re.match(r"var\s+VERSION\s*=", text):
                    continue
                if seg is None:
                    seg = {"file": cur, "before": ctx_before, "after": None, "added": [], "removed": []}
                (seg["added"] if kind == "+" else seg["removed"]).append(text)
    flush()
    files = sorted(segs)
    if not files:
        return None
    for f in files:
        r = sh(["git", "show", "%s:%s" % (base_ref, f)], cwd, check=False)
        if r.returncode != 0:
            return None
        main_lines = [x.strip() for x in r.stdout.split("\n")]
        have = set(main_lines)
        for sg in segs[f]:
            if any(len(t) >= min_len and t in have for t in sg["removed"]):
                return None
            want = ([sg["before"]] if sg["before"] is not None else []) + sg["added"] + ([sg["after"]] if sg["after"] is not None else [])
            if not want:
                return None
            n = len(want)
            if not any(main_lines[i:i + n] == want for i in range(0, len(main_lines) - n + 1)):
                return None
    return files


def claimed_versions(worker, skip_pr=None, base_branch="main"):
    """VERSIONs that main, the target base, and the other open pull requests claim (REST, as CLAUDE.md prescribes)."""
    out = []
    refs = [("main", None)]
    if base_branch and base_branch != "main":
        refs.append((base_branch, None))
    for p in gh("repos/%s/pulls?state=open&per_page=100" % REPO) or []:
        if p.get("number") != skip_pr:
            refs.append((p["head"]["sha"], p["number"]))
    for ref, _n in refs:
        v = read_version(gh("repos/%s/contents/%s/worker.js?ref=%s" % (REPO, worker, ref), raw=True))
        if v:
            out.append(v)
    return out


def bump_workers(workers, skip_pr, cwd=None, claims=claimed_versions, base_branch="main"):
    """Raises each worker's VERSION above the claims and mirrors it. Returns [(worker, old, new)] for the ones that moved."""
    moved = []
    for w in workers:
        path = os.path.join(cwd or ".", w, "worker.js")
        if not os.path.isfile(path):
            continue
        with open(path, encoding="utf-8", errors="replace") as fh:
            text = fh.read()
        old = read_version(text)
        versions = claims(w, skip_pr, base_branch) if claims is claimed_versions else claims(w, skip_pr)
        new = bump_above(old, versions) if old else None
        if not new or new == old:
            continue
        fixed = set_version(text, new)
        if fixed is None:
            continue
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(fixed)
        mirror = os.path.join(cwd or ".", w, "deployed-current.worker.js")
        if os.path.isfile(mirror):
            shutil.copyfile(path, mirror)
            git(["add", w + "/deployed-current.worker.js"], cwd)
        git(["add", w + "/worker.js"], cwd)
        moved.append((w, old, new))
    return moved


def run_checks(workers, base_ref, cwd=None):
    """[(name, passed)] of the checks a pull request gets, run on the staged-and-committed tree."""
    out = []
    root = cwd or "."
    env = clean_env()
    for w in workers:
        if os.path.isfile(os.path.join(root, w, "worker.js")):
            out.append(("node --check " + w, sh(["node", "--check", w + "/worker.js"], cwd, check=False, env=env).returncode == 0))
    changed = os.path.join(root, ".conflict-repair-changed.txt")
    dirs = sorted({p.split("/")[0] for p in git(["diff", "--name-only", base_ref, "HEAD"], cwd).split("\n") if p})
    with open(changed, "w", encoding="utf-8") as fh:
        fh.write("\n".join(dirs) + "\n")
    try:
        out.append(("suites", sh(["node", "scripts/run-suites.mjs", "--changed-file", changed, "--jobs", "4", "--timeout", "180"], cwd, check=False, timeout=1500, env=env).returncode == 0))
    finally:
        os.remove(changed)
    out.append(("mirror-guard", sh([sys.executable, "scripts/mirror-guard.py", "--scope-to-diff=" + base_ref], cwd, check=False, env=env).returncode == 0))
    out.append(("version-bump-guard", sh([sys.executable, "scripts/version-bump-guard.py", git(["rev-parse", base_ref], cwd).strip(), git(["rev-parse", "HEAD"], cwd).strip()], cwd, check=False, env=env).returncode == 0))
    out.append(("workers-standards-guard", sh([sys.executable, "scripts/workers_standards_guard.py", base_ref], cwd, check=False, env=env).returncode == 0))
    return out


def ledger(pr_number, head_sha, status, text, meta):
    acct, token = os.environ.get("CLOUDFLARE_ACCOUNT_ID") or os.environ.get("CF_ACCOUNT_ID"), os.environ.get("CLOUDFLARE_API_TOKEN")
    if not (acct and token):
        emit("::warning::conflict-repair: no Cloudflare credentials, the outcome is recorded only in this log")
        return False
    try:
        from apply_migrations import d1
        d1(acct, token, DB_ID, "INSERT OR REPLACE INTO cloud_ops_events (id, ts, kind, status, text, job, meta) VALUES (?1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), 'conflict-repair-reapplied', ?2, ?3, 'conflict-repair', ?4)",
           ["conflict-repair-%d-%s" % (pr_number, str(head_sha)[:7]), status, text[:900], json.dumps(meta)[:3000]])
        d1(acct, token, DB_ID, "INSERT INTO branch_hygiene_log (ts, branch, sha, action, why, pr, ok, dry) VALUES (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), ?1, ?2, 'conflict-repair-reapplied', ?3, ?4, ?5, ?6)",
           [str(meta.get("branch") or ""), str(head_sha), text[:400], pr_number, 1 if status == "ok" else 0, 0 if meta.get("pushed") else 1])
        return True
    except Exception as e:  # noqa: BLE001
        emit("::warning::conflict-repair: ledger write failed: " + str(e)[:200])
        return False


def heartbeat(found, push):
    """One row per hour that the doer ran over the repair issues (the watchmaker reads it: a recurring operation proves it ran)."""
    acct, token = os.environ.get("CLOUDFLARE_ACCOUNT_ID") or os.environ.get("CF_ACCOUNT_ID"), os.environ.get("CLOUDFLARE_API_TOKEN")
    if not (acct and token):
        return False
    try:
        from apply_migrations import d1
        d1(acct, token, DB_ID, "INSERT OR REPLACE INTO cloud_ops_events (id, ts, kind, status, text, job) VALUES (?1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), 'conflict-repair-tick', 'ok', ?2, 'conflict-repair')",
           [heartbeat_id(time.gmtime()), "CONFLICT-REPAIR-DOER-1 tick: %d repair issue%s read%s" % (found, "" if found == 1 else "s", "" if push else " (dry run)")])
        return True
    except Exception as e:  # noqa: BLE001
        emit("::warning::conflict-repair: heartbeat not written: " + str(e)[:200])
        return False


def heartbeat_id(t):
    return "conflict-repair-tick-" + time.strftime("%Y%m%dT%H", t)


def attempted(pr_number, head_sha):
    acct, token = os.environ.get("CLOUDFLARE_ACCOUNT_ID") or os.environ.get("CF_ACCOUNT_ID"), os.environ.get("CLOUDFLARE_API_TOKEN")
    if not (acct and token):
        return False
    try:
        from apply_migrations import d1
        rows = d1(acct, token, DB_ID, "SELECT id FROM cloud_ops_events WHERE id = ?1 AND json_extract(meta, '$.pushed') = 1", ["conflict-repair-%d-%s" % (pr_number, str(head_sha)[:7])])
        return bool(rows)
    except Exception:  # noqa: BLE001
        return False


def open_issue_prs():
    acct, token = os.environ.get("CLOUDFLARE_ACCOUNT_ID") or os.environ.get("CF_ACCOUNT_ID"), os.environ.get("CLOUDFLARE_API_TOKEN")
    if not (acct and token):
        return []
    from apply_migrations import d1
    rows = d1(acct, token, DB_ID, "SELECT title FROM agent_issues WHERE status = 'open' AND title LIKE 'STALE-PR-CONFLICT-REPAIR-1%' ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END, id LIMIT 20")
    return issue_prs([r.get("title") for r in rows or []])


def settled_evidence(pr):
    """A pull request object -> the close evidence for its repair issue when the PR is no longer open, else None.
    CONFLICT-REPAIR-SETTLE-1 (2026-10-19, agent_issues 2305/2898): the doer skipped a merged or closed pull request and
    left its repair issue open for good (2898: PR 1417 merged 2026-10-18T08:57Z, issue still open 20 h later)."""
    if not isinstance(pr, dict) or not pr.get("number") or pr.get("state") == "open":
        return None
    if pr.get("merged_at"):
        how = "merged at %s" % pr.get("merged_at")
    else:
        how = "closed unmerged at %s" % (pr.get("closed_at") or "?")
    return "CONFLICT-REPAIR-SETTLE-1: GitHub reads PR #%d %s, so there is no conflict left to repair." % (int(pr["number"]), how)


# CONFLICT-REPAIR-SETTLE-2 (2026-10-19, PR 2603 review): the first settle INSERTed into issue_triage without sla_due_at, which is
# NOT NULL with no default in the live schema; SQLite checks NOT NULL before the ON CONFLICT upsert, so the statement failed even
# when a triage row existed and the repair issue of a merged or closed pull request (2898, 2305, 99905, 100038) stayed open.
# agent_issues_autotriage2_ins gives every issue a triage row, so the evidence goes in by UPDATE; the guarded INSERT covers an
# issue that has none and supplies every NOT NULL column (due on arrival, PRIORITY-QUEUE-1). scripts/conflict_repair_test.py runs
# these statements against the live issue_triage definition and the close triggers.
SETTLE_TRIAGE_SQL = ("INSERT INTO issue_triage (issue_id, rc, owner, sla_due_at, close_evidence) "
                     "SELECT ?1, 'CONFLICT-REPAIR-SETTLE-1', 'conflict-repair', datetime('now'), ?2 "
                     "WHERE NOT EXISTS (SELECT 1 FROM issue_triage WHERE issue_id = ?1)")
SETTLE_EVIDENCE_SQL = "UPDATE issue_triage SET close_evidence = ?2 WHERE issue_id = ?1"
# CLOSE-CHANNEL-REQUIRED-1 (agent_issues 100419): a close with no close_channel cannot be attributed to a fix, a probe or a sweep. This
# close wrote none, so the settled repair issues 100422, 1000256, 1000270 and 1000365 carried NULL (1000254 was closed by a session as a
# duplicate pull request, not by this statement). The close_evidence this script writes ("CONFLICT-REPAIR-SETTLE-1: ...") is what the
# closing probe of issue 100419 keys on.
SETTLE_CLOSE_CHANNEL = "auto:conflict-repair-settle"
SETTLE_CLOSE_SQL = ("UPDATE agent_issues SET status = 'closed', close_channel = '" + SETTLE_CLOSE_CHANNEL + "', "
                    "updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000 WHERE id = ?1 AND status = 'open'")


def settle_issue(number, evidence):
    """Close the open STALE-PR-CONFLICT-REPAIR-1 issue of a pull request that is no longer open, with the GitHub read as
    evidence. The close triggers still apply (issue_close_evidence_required, CLOSE-BINDS-TO-PROBE-1): a failing contract
    keeps the issue open and the refusal is reported, never bypassed."""
    acct, token = os.environ.get("CLOUDFLARE_ACCOUNT_ID") or os.environ.get("CF_ACCOUNT_ID"), os.environ.get("CLOUDFLARE_API_TOKEN")
    if not (acct and token):
        return False
    try:
        from apply_migrations import d1
        rows = d1(acct, token, DB_ID, "SELECT id FROM agent_issues WHERE status = 'open' AND title LIKE ?1", ["STALE-PR-CONFLICT-REPAIR-1 PR %d:%%" % number])
        for r in rows or []:
            iid = int(r.get("id"))
            d1(acct, token, DB_ID, SETTLE_TRIAGE_SQL, [iid, evidence])
            d1(acct, token, DB_ID, SETTLE_EVIDENCE_SQL, [iid, evidence])
            d1(acct, token, DB_ID, SETTLE_CLOSE_SQL, [iid])
        return True
    except Exception as e:  # noqa: BLE001
        emit("::warning::conflict-repair: repair issue of PR %d not settled: %s" % (number, str(e)[:200]))
        return False


def repair(number, push=False, keep_branch=False, in_place=False):
    pr = gh("repos/%s/pulls/%d" % (REPO, number))
    why = eligible(pr)
    if why:
        ev = settled_evidence(pr)
        if ev and push:
            done = settle_issue(number, ev)
            return {"pr": number, "outcome": "settled" if done else "settle-failed", "why": why, "evidence": ev}
        return {"pr": number, "outcome": "skipped", "why": why}
    base_branch = str((pr.get("base") or {}).get("ref") or "")
    if not valid_base_branch(base_branch):
        return {"pr": number, "outcome": "skipped", "why": "the base branch is missing or invalid"}
    head_sha = pr["head"]["sha"]
    if push and attempted(number, head_sha):
        return {"pr": number, "outcome": "skipped", "why": "head %s was already re-applied and pushed" % head_sha[:7]}
    files = [f.get("filename") for f in gh("repos/%s/pulls/%d/files?per_page=100" % (REPO, number)) or []]
    branch = branch_name(pr)
    head_ref = str(pr["head"].get("ref") or "")
    if in_place:
        branch = "inplace/pr-%d-%s" % (number, head_sha[:7])  # a local work branch; the push goes to the pull request's own branch
    meta = {"pr": number, "head": head_sha, "base": base_branch, "branch": head_ref if in_place else branch, "pushed": 0, "in_place": 1 if in_place else 0}
    if any(str(f).startswith(".github/") for f in files):
        res = {"pr": number, "outcome": "needs-session", "why": "the pull request changes .github/, which the Actions token may not push", "files": [f for f in files if str(f).startswith(".github/")]}
        ledger(number, head_sha, "warn", "CONFLICT-REPAIR-DOER-1 PR %d not re-applied: %s" % (number, res["why"]), dict(meta, outcome="needs-session"))
        return res
    start = git(["rev-parse", "--abbrev-ref", "HEAD"]).strip()
    res = {"pr": number, "branch": head_ref if in_place else branch, "in_place": in_place}
    try:
        base_ref = fetch_base_branch(base_branch, number)
        if not base_ref:
            res.update({"outcome": "skipped", "why": "the base branch could not be fetched"})
            return res
        git(["fetch", "-q", "origin", "+refs/pull/%d/head:refs/remotes/origin/pr-%d" % (number, number)])
        landed = landed_on_base("refs/remotes/origin/pr-%d" % number, base_ref)
        if landed:
            res.update({"outcome": "already-on-base", "files": landed})
            if push:
                gh("repos/%s/issues/%d/comments" % (REPO, number), "POST", {"body": "MERGE-LANE-LANDED-1: every substantive line this pull request adds (%s) is already on base branch `%s`, so there is nothing left to merge or repair. Closing as superseded; the change reached its base by another route." % (", ".join(landed), base_branch)})
                gh("repos/%s/pulls/%d" % (REPO, number), "PATCH", {"state": "closed"})
                ledger(number, head_sha, "ok", "MERGE-LANE-LANDED-1 PR %d closed: its change is already on base %s (%s)" % (number, base_branch, ", ".join(landed)), dict(meta, outcome="already-on-base", files=landed))
            return res
        r = reapply("refs/remotes/origin/pr-%d" % number, base_ref, branch, in_place=in_place)
        res.update(r)
        if r["outcome"] not in ("reapplied", "clean"):
            ledger(number, head_sha, "warn", "CONFLICT-REPAIR-DOER-1 PR %d not re-applied (%s): %s" % (number, r["outcome"], ", ".join(r.get("files") or []) or r.get("error") or ""), dict(meta, outcome=r["outcome"], files=r.get("files")))
            if push and r["outcome"] == "needs-session":
                gh("repos/%s/issues/%d/comments" % (REPO, number), "POST", {"body": "CONFLICT-REPAIR-DOER-1 could not re-apply this pull request onto base branch `%s` without judgement. Overlapping files: `%s`. Only VERSION-line and mirror conflicts are resolved automatically; the repair issue stays open for a session or the code loop." % (base_branch, "`, `".join(r.get("files") or []))})
            return res
        bumped = bump_workers(r["workers"], number, base_branch=base_branch)
        res["bumped"] = bumped
        git(["-c", "user.name=qnfo-conflict-repair", "-c", "user.email=conflict-repair@users.noreply.github.com", "commit", "-q", "-m",
             ("merge %s into %s (CONFLICT-REPAIR-INPLACE-1, #%d)" % (base_branch, head_ref, number) if in_place else "re-apply #%d onto %s (CONFLICT-REPAIR-DOER-1)" % (number, base_branch)) + "\n\n%s\n\nResolved without judgement: %s. VERSION: %s." % ( str(pr.get("title") or "")[:200], ", ".join(r["resolved"]) or "nothing (clean merge)", "; ".join("%s %s -> %s" % b for b in bumped) or "unchanged")])
        checks = run_checks(r["workers"], base_ref)
        res["checks"] = checks
        res["sha"] = git(["rev-parse", "HEAD"]).strip()
        if not numstat_has_code_changes(git(["diff", "--numstat", base_ref, "HEAD"])):
            res["outcome"] = "no-code-change"
            res["why"] = "CODE-CHANGE-REQUIRED-1: no implementation diff; no replacement PR or push"
            ledger(number, head_sha, "warn", res["why"], dict(meta, outcome=res["outcome"]))
            return res
        if not all(v for _, v in checks):
            res["outcome"] = "checks-failed"
            ledger(number, head_sha, "warn", "CONFLICT-REPAIR-DOER-1 PR %d re-applied but not pushed, failed: %s" % (number, ", ".join(k for k, v in checks if not v)), dict(meta, outcome="checks-failed"))
            return res
        if not push:
            res["outcome"] = "reapplied-dry"
            return res
        if in_place:
            # CONFLICT-REPAIR-INPLACE-1: the merge commit goes on the pull request's own branch (a fast-forward, never forced, so an
            # author's concurrent push wins and the next main push tries again). The pull_request runs that a GITHUB_TOKEN push creates
            # start no job (see DISPATCHABLE), so the check workflows that accept a dispatch are dispatched on the branch, as for a
            # replacement.
            pushed = sh(["git", "push", "origin", branch + ":refs/heads/" + head_ref], check=False, timeout=300)
            if pushed.returncode != 0:
                res["outcome"] = "push-refused"
                res["error"] = (pushed.stderr or pushed.stdout).strip()[:300]
                ledger(number, head_sha, "warn", "CONFLICT-REPAIR-INPLACE-1 PR %d merged main locally but the push to %s was refused: %s" % (number, head_ref, res["error"]), dict(meta, outcome="push-refused"))
                return res
            meta["pushed"] = 1
            for wf in DISPATCHABLE:
                sh(["gh", "workflow", "run", wf, "--repo", REPO, "--ref", head_ref], check=False, timeout=60)
            phantoms = clear_phantom_runs(res["sha"])
            if phantoms:
                emit("PHANTOM-RUN-CLEAR-1 PR %d: %d gated pull_request run(s) on %s, cleared %d (%s)" % (
                    number, len(phantoms), res["sha"][:7], sum(1 for _, _, _, c in phantoms if c), ", ".join("%s %s" % (a, n or "?") for _, n, a, _ in phantoms)))
            note = ("CONFLICT-REPAIR-INPLACE-1: this pull request conflicted with base branch `%s` and was quiet, so that base was merged into `%s` "
                    "(only VERSION-line and mirror conflicts were resolved: %s; VERSION: %s). The checks ran on the runner before the push (%s) "
                    "and are dispatched again on the branch.") % (
                base_branch, head_ref, ", ".join(r["resolved"]) or "none", "; ".join("%s %s -> %s" % b for b in bumped) or "unchanged",
                "; ".join("%s %s" % (k, "ok" if v else "FAILED") for k, v in checks))
            gh("repos/%s/issues/%d/comments" % (REPO, number), "POST", {"body": note})
            res["outcome"] = "updated"
            ledger(number, head_sha, "ok", "CONFLICT-REPAIR-INPLACE-1 PR %d: base %s merged into %s (%s)" % (number, base_branch, head_ref, res["sha"][:7]),
                   dict(meta, outcome="updated", sha=res["sha"], bumped=bumped))
            return res
        git(["push", "origin", branch])
        meta["pushed"] = 1
        title, body = replacement_text(pr, bumped, checks)
        new = gh("repos/%s/pulls" % REPO, "POST", {"title": title, "head": branch, "base": base_branch, "body": body})
        if new and new.get("number"):
            res["new_pr"] = new["number"]
            for wf in DISPATCHABLE:
                sh(["gh", "workflow", "run", wf, "--repo", REPO, "--ref", branch], check=False, timeout=60)
            clear_phantom_runs(res["sha"])
            gh("repos/%s/issues/%d/comments" % (REPO, number), "POST", {"body": "Superseded by #%d: CONFLICT-REPAIR-DOER-1 re-applied this change onto base branch `%s` (%s)." % (new["number"], base_branch, "; ".join("%s %s -> %s" % b for b in bumped) or "no VERSION change")})
            gh("repos/%s/pulls/%d" % (REPO, number), "PATCH", {"state": "closed"})
            res["outcome"] = "replaced"
        else:
            res["outcome"] = "branch-pushed"
        ledger(number, head_sha, "ok", "CONFLICT-REPAIR-DOER-1 PR %d re-applied onto base %s as %s (%s), replacement %s" % (number, base_branch, branch, res["sha"][:7], ("#%d" % res["new_pr"]) if res.get("new_pr") else "not opened: the branch waits for an opener"),
               dict(meta, outcome=res["outcome"], new_pr=res.get("new_pr"), sha=res["sha"], bumped=bumped))
        return res
    finally:
        sh(["git", "merge", "--abort"], check=False)
        sh(["git", "checkout", "-q", "-f", start], check=False)
        if not keep_branch:
            sh(["git", "branch", "-q", "-D", branch], check=False)


def selftest():
    import tempfile
    fails = []

    def ok(c, name, detail=None):
        emit(("PASS " if c else "FAIL ") + name + ("" if c or detail is None else " -- " + repr(detail)[:400]))
        if not c:
            fails.append(name)
    ok(heartbeat_id(time.gmtime(0)) == "conflict-repair-tick-19700101T00" and "conflict-repair-tick-" <= heartbeat_id(time.gmtime()) < "conflict-repair-tick.", "the hourly heartbeat id sorts inside the range the watchmaker query reads")
    os.environ["CONFLICT_REPAIR_SELFTEST_TOKEN"] = "x"
    ce = clean_env()
    ok("CONFLICT_REPAIR_SELFTEST_TOKEN" not in ce and not any(SECRET_ENV.search(k) for k in ce) and "PATH" in ce, "clean_env drops every credential-named variable and keeps PATH")
    ok(core("0.14.0-conflict-repair") == (0, 14, 0) and core("x") is None, "core reads the numeric part")
    # PHANTOM-RUN-CLEAR-1: the measured shape is completed + action_required + zero jobs; in-flight runs are cancelled; nothing is approved
    bot = {"login": "github-actions[bot]"}
    runs = [
        {"id": 1, "name": "mirror-guard", "status": "completed", "conclusion": "action_required", "event": "pull_request", "actor": bot},
        {"id": 2, "name": "deploy-gate", "status": "completed", "conclusion": "action_required", "event": "pull_request", "actor": bot},
        {"id": 3, "name": "ran-for-real", "status": "completed", "conclusion": "action_required", "event": "pull_request", "actor": bot},
        {"id": 4, "name": "queued-one", "status": "queued", "conclusion": None, "event": "pull_request", "actor": bot},
        {"id": 5, "name": "green", "status": "completed", "conclusion": "success", "event": "pull_request", "actor": bot},
        {"id": 6, "name": "a person's run", "status": "completed", "conclusion": "action_required", "event": "pull_request", "actor": {"login": "rwnq8"}},
        {"id": 7, "name": "dispatched", "status": "completed", "conclusion": "action_required", "event": "workflow_dispatch", "actor": bot},
    ]
    calls, napped = [], []
    def fake_api(path, method="GET", fields=None):
        calls.append((method, path))
        if method == "GET" and path.endswith("/jobs"):
            return {"total_count": 2 if "/runs/3/" in path else 0, "jobs": []}
        if method == "GET":
            return {"workflow_runs": runs}
        return None if path.endswith("/runs/2") else {}
    got = clear_phantom_runs("abc1234", api=fake_api, sleep=napped.append, passes=3, wait=8, approve=False)
    mutating = [(m, p) for m, p in calls if m != "GET"]
    ok(got == [(1, "mirror-guard", "delete", True), (2, "deploy-gate", "delete", False), (4, "queued-one", "cancel", True)],
       "a completed action_required zero-job run is deleted, a run in flight is cancelled, a refusal is recorded and never raised", got)
    ok(not any(m == "POST" and "approve" in p for m, p in mutating) and all(m in ("DELETE", "POST") for m, _ in mutating), "with approval off (CONFLICT_REPAIR_APPROVE=off) nothing is approved", mutating)
    ok(not any("/runs/3" in p or "/runs/5" in p or "/runs/6" in p or "/runs/7" in p for m, p in mutating), "a run that has jobs, a green run, a person's run and a dispatched run are never touched", mutating)
    ok(len([1 for m, p in calls if m == "GET" and "head_sha" in p]) == 3 and napped == [8, 8], "the list is read three times, 8 s apart, and each run is handled once", (calls, napped))
    ok(clear_phantom_runs("abc1234", api=lambda *a, **k: None, sleep=lambda s: None) == [], "an unreadable run list clears nothing and does not raise")
    # OWNER-AUTO-APPROVE-ALL-1: with approval on, only a gated zero-job run of this push on this repository's own branch is approved; a refused approval falls back to the deletion
    own = {"full_name": REPO}
    runs = [
        {"id": 11, "name": "mirror-guard", "status": "completed", "conclusion": "action_required", "event": "pull_request", "actor": bot, "head_repository": own, "head_sha": "abc1234"},
        {"id": 12, "name": "deploy-gate", "status": "completed", "conclusion": "action_required", "event": "pull_request", "actor": bot, "head_repository": own, "head_sha": "abc1234"},
        {"id": 13, "name": "a fork run", "status": "completed", "conclusion": "action_required", "event": "pull_request", "actor": bot, "head_repository": {"full_name": "someone/fork"}, "head_sha": "abc1234"},
        {"id": 14, "name": "no repository field", "status": "completed", "conclusion": "action_required", "event": "pull_request", "actor": bot},
        {"id": 15, "name": "another sha", "status": "completed", "conclusion": "action_required", "event": "pull_request", "actor": bot, "head_repository": own, "head_sha": "ffff999"},
        {"id": 16, "name": "ran-for-real", "status": "completed", "conclusion": "action_required", "event": "pull_request", "actor": bot, "head_repository": own, "head_sha": "abc1234"},
        {"id": 17, "name": "a person's run", "status": "completed", "conclusion": "action_required", "event": "pull_request", "actor": {"login": "rwnq8"}, "head_repository": own, "head_sha": "abc1234"},
        {"id": 18, "name": "dispatched", "status": "completed", "conclusion": "action_required", "event": "workflow_dispatch", "actor": bot, "head_repository": own, "head_sha": "abc1234"},
    ]
    calls2 = []
    def fake_api2(path, method="GET", fields=None):
        calls2.append((method, path))
        if method == "GET" and path.endswith("/jobs"):
            return {"total_count": 2 if "/runs/16/" in path else 0, "jobs": []}
        if method == "GET":
            return {"workflow_runs": runs}
        return None if path.endswith("/runs/12/approve") else {}
    got2 = clear_phantom_runs("abc1234", api=fake_api2, sleep=lambda s: None, passes=1, wait=0, approve=True)
    mut2 = [(m, p.split("/actions/")[1]) for m, p in calls2 if m != "GET"]
    ok(got2 == [(11, "mirror-guard", "approve", True), (12, "deploy-gate", "delete", True), (13, "a fork run", "delete", True), (14, "no repository field", "delete", True), (15, "another sha", "delete", True)],
       "approval on: an own-branch gated run is approved, a refused approval falls back to the deletion, a fork, an unknown repository and another sha are only deleted", got2)
    ok(mut2 == [("POST", "runs/11/approve"), ("POST", "runs/12/approve"), ("DELETE", "runs/12"), ("DELETE", "runs/13"), ("DELETE", "runs/14"), ("DELETE", "runs/15")],
       "approval is attempted only on runs 11 and 12; a run with jobs, a person's run and a dispatched run are never touched", mut2)
    ok(APPROVE_PHANTOM is True or os.environ.get("CONFLICT_REPAIR_APPROVE"), "approval is on by default (owner decision 2026-10-26)")
    ok(settled_evidence({"number": 1417, "state": "closed", "merged_at": "2026-10-18T08:57:52Z"}) == "CONFLICT-REPAIR-SETTLE-1: GitHub reads PR #1417 merged at 2026-10-18T08:57:52Z, so there is no conflict left to repair."
       and "closed unmerged" in settled_evidence({"number": 9, "state": "closed", "merged_at": None, "closed_at": "x"})
       and settled_evidence({"number": 9, "state": "open"}) is None and settled_evidence(None) is None,
       "a merged or closed pull request settles its repair issue with the GitHub read; an open one does not")
    ok(bump_above("0.14.0-fix", ["0.13.9", "0.12.0"]) == "0.14.0-fix", "a VERSION already ahead stays")
    ok(bump_above("0.13.2-fix", ["0.13.5-a", "0.13.4"]) == "0.13.6-fix", "a patch release lands one patch above the highest claim, suffix kept")
    ok(bump_above("0.14.0-feature", ["0.16.1-perf", "0.15.0"]) == "0.17.0-feature", "a minor release stays a minor release above the highest claim")
    ok(bump_above("1.2.3", []) == "1.2.3" and bump_above("nope", ["1.0.0"]) is None, "no claims: unchanged; no numeric core: refused")
    ok(set_version('a\nvar VERSION = "1.0.0"; // x\nb', "1.0.1") == 'a\nvar VERSION = "1.0.1"; // x\nb' and set_version('var VERSION = "1";\nvar VERSION = "2";', "3") is None, "set_version rewrites the one VERSION line, refuses two")
    conflict = 'top\n<<<<<<< HEAD\nvar VERSION = "0.16.1-main";\n=======\nvar VERSION = "0.14.0-pr";\n>>>>>>> pr\nbody\n'
    ok(resolve_version_only(conflict) == 'top\nvar VERSION = "0.14.0-pr";\nbody\n', "a VERSION-only hunk takes the pull request's line")
    diff3 = 'top\n<<<<<<< HEAD\nvar VERSION = "0.16.1-main";\n||||||| base\nvar VERSION = "0.13.0";\n=======\nvar VERSION = "0.14.0-pr";\n>>>>>>> pr\n'
    ok(resolve_version_only(diff3) == 'top\nvar VERSION = "0.14.0-pr";\n', "diff3 markers are read too")
    ok(resolve_version_only(conflict + '<<<<<<< HEAD\nconst a = 1;\n=======\nconst a = 2;\n>>>>>>> pr\n') is None, "a second hunk that is code makes the file a semantic overlap")
    ok(resolve_version_only('<<<<<<< HEAD\nvar VERSION = "1.0.0";\nconst x = 1;\n=======\nvar VERSION = "1.0.1";\n>>>>>>> pr\n') is None and resolve_version_only("no markers") is None and resolve_version_only('<<<<<<< HEAD\nvar VERSION = "1";\n') is None, "a hunk with more than the VERSION line, no hunk, or an unterminated hunk is refused")
    base_pr = {"number": 7, "state": "open", "draft": False, "mergeable": False, "title": "fix x", "body": "why", "head": {"sha": "abcdef1234", "ref": "fix/x", "repo": {"full_name": "o/r"}}, "base": {"ref": "main", "repo": {"full_name": "o/r"}}}
    ok(eligible(base_pr) is None and "closed" in eligible(dict(base_pr, state="closed")) and eligible(dict(base_pr, draft=True)) is None and "asks to wait" in eligible(dict(base_pr, draft=True, title="WIP: x")) and "fork" in eligible(dict(base_pr, head=dict(base_pr["head"], repo={"full_name": "x/r"})))
       and "does not conflict" in eligible(dict(base_pr, mergeable=True)) and "itself a repair" in eligible(dict(base_pr, head=dict(base_pr["head"], ref="repair/pr-1-abc"))) and eligible(None), "eligible: open, same repository, conflicting, not a repair; a draft is taken unless it asks to wait")
    global DRAFTS
    saved_drafts, DRAFTS = DRAFTS, False
    try:
        ok("draft" in eligible(dict(base_pr, draft=True)) and eligible(base_pr) is None, "PR-MERGE-SLA-10M-1: CONFLICT_REPAIR_DRAFTS=off restores the refusal of a draft")
    finally:
        DRAFTS = saved_drafts
    ok(branch_name(base_pr) == "repair/pr-7-abcdef1", "the branch names the pull request and its head")
    ok("mirror-guard.yml" in DISPATCHABLE and len(set(DISPATCHABLE)) == len(DISPATCHABLE), "PR-GUARD-FIXES-1: mirror-guard, a check the merge lane requires, is dispatched on a repaired head, each workflow once")
    t, b = replacement_text(base_pr, [("w", "1.0.0", "1.0.2")], [("suites", True)])
    ok(t == "fix x (re-applied from #7)" and "Supersedes #7" in b and "w 1.0.0 -> 1.0.2" in b and "suites ok" in b and "Charter pillar: autonomy" in b and replacement_text(dict(base_pr, title=t), [], [])[0] == t, "the replacement names the old pull request, the bumps and the checks, and the suffix is not stacked")
    ok(issue_prs(["STALE-PR-CONFLICT-REPAIR-1 PR 910: quiet and conflicting", "STALE-PR-CONFLICT-REPAIR-1: PR #870 x", "STALE-PR-CONFLICT-REPAIR-1 PR 910 again", "OTHER-1 PR 5"]) == [910, 870], "issue titles give their pull request numbers once")
    # end to end in a throwaway repository: two changes bump one VERSION line; the quiet one is re-applied and bumped
    with tempfile.TemporaryDirectory() as d:
        def g(*a):
            return git(list(a), d)
        g("init", "-q", "-b", "main"); g("config", "user.email", "a@b.c"); g("config", "user.name", "t")
        os.mkdir(os.path.join(d, "w"))
        src = 'var VERSION = "1.0.0";\nexport default {\n  a: 1,\n\n\n\n\n  z: 1\n};\n'
        for f in ("worker.js", "deployed-current.worker.js"):
            open(os.path.join(d, "w", f), "w").write(src)
        open(os.path.join(d, "notes.txt"), "w").write("one\n")
        g("add", "-A"); g("commit", "-qm", "base")
        g("checkout", "-q", "-b", "quiet")
        for f in ("worker.js", "deployed-current.worker.js"):
            open(os.path.join(d, "w", f), "w").write(src.replace('"1.0.0"', '"1.0.1-quiet"').replace("z: 1", "z: 2"))
        g("commit", "-qam", "quiet change")
        g("checkout", "-q", "main")
        for f in ("worker.js", "deployed-current.worker.js"):
            open(os.path.join(d, "w", f), "w").write(src.replace('"1.0.0"', '"1.0.3-main"').replace("a: 1", "a: 9"))
        g("commit", "-qam", "main moved")
        r = reapply("quiet", "main", "repair/pr-1-abc", d)
        text = open(os.path.join(d, "w", "worker.js")).read()
        ok(r["outcome"] == "reapplied" and r["workers"] == ["w"] and "w/worker.js" in r["resolved"] and "w/deployed-current.worker.js" in r["resolved"] and 'var VERSION = "1.0.1-quiet";' in text and "a: 9" in text and "z: 2" in text and "<<<<<<<" not in text,
           "reapply: the VERSION conflict is resolved, main's line and the change's line both survive", (r, text))
        moved = bump_workers(r["workers"], 1, d, claims=lambda w, skip: ["1.0.3-main", "1.0.4-other-pr"])
        text = open(os.path.join(d, "w", "worker.js")).read()
        ok(moved == [("w", "1.0.1-quiet", "1.0.5-quiet")] and 'var VERSION = "1.0.5-quiet";' in text and text == open(os.path.join(d, "w", "deployed-current.worker.js")).read(), "bump_workers: VERSION lands above main and the other open claim, the mirror is identical", moved)
        g("commit", "-qm", "re-apply"); ok(git(["status", "--porcelain"], d).strip() == "", "the re-apply commits cleanly")
        g("checkout", "-q", "main"); g("checkout", "-q", "-b", "semantic")
        for f in ("worker.js", "deployed-current.worker.js"):
            cur = open(os.path.join(d, "w", f)).read()
            open(os.path.join(d, "w", f), "w").write(cur.replace("a: 9", "a: 7").replace('"1.0.3-main"', '"1.0.4-sem"'))
        g("commit", "-qam", "semantic change"); g("checkout", "-q", "main")
        for f in ("worker.js", "deployed-current.worker.js"):
            cur = open(os.path.join(d, "w", f)).read()
            open(os.path.join(d, "w", f), "w").write(cur.replace("a: 9", "a: 8").replace('"1.0.3-main"', '"1.0.6-main"'))
        g("commit", "-qam", "main moved again")
        r2 = reapply("semantic", "main", "repair/pr-2-def", d)
        ok(r2["outcome"] == "needs-session" and r2["files"] == ["w/worker.js"] and git(["status", "--porcelain"], d).strip() == "" and "a: 8" in open(os.path.join(d, "w", "worker.js")).read(), "reapply: an overlap in code is refused, the merge aborted and main's text kept", r2)
        g("checkout", "-q", "main"); g("checkout", "-q", "-b", "clean"); open(os.path.join(d, "notes.txt"), "w").write("one\ntwo\n"); g("commit", "-qam", "notes"); g("checkout", "-q", "main")
        ok(reapply("clean", "main", "repair/pr-3-aaa", d)["outcome"] == "clean", "reapply: a change that no longer conflicts is a clean merge")
    # CONFLICT-REPAIR-INPLACE-1 (2026-10-19): release notes survive, the gateway's spacing survives, conflicting quiet PRs are found, main goes into the PR
    mn = 'var VERSION = "1.47.0-main"; /* 1.47.0 main note */ /* 1.46.1 shared */'
    pn = 'var VERSION = "1.46.2"; /* 1.46.2 pr note */ /* 1.46.1 shared */'
    ok(chain_notes(pn, mn) == 'var VERSION = "1.46.2"; /* 1.46.2 pr note */ /* 1.47.0 main note */ /* 1.46.1 shared */', "chain_notes: the pull request's new notes first, then main's, the shared tail once", chain_notes(pn, mn))
    ok(chain_notes('var VERSION = "0.2.0"; // pr note', 'var VERSION = "0.3.0"; // main note') == 'var VERSION = "0.2.0"; // pr note' and chain_notes('var VERSION = "1"; /* a */ tail', mn) == 'var VERSION = "1"; /* a */ tail', "chain_notes: a note style it cannot split safely keeps the pull request's line")
    gw = 'var VERSION="3.26.4-codeagent"; /* 3.26.4 x */'
    ok(read_version(gw) == "3.26.4-codeagent" and set_version(gw, "3.26.5-codeagent") == 'var VERSION="3.26.5-codeagent"; /* 3.26.4 x */', "VERSION lines without spaces (qnfo-gateway) are read and rewritten in their own style")
    ok(resolve_version_only('<<<<<<< HEAD\n' + pn + '\n=======\n' + mn + '\n>>>>>>> main\n', "ours") == 'var VERSION = "1.46.2"; /* 1.46.2 pr note */ /* 1.47.0 main note */ /* 1.46.1 shared */\n'
       and resolve_version_only('<<<<<<< HEAD\n' + mn + '\n=======\n' + pn + '\n>>>>>>> pr\n') == 'var VERSION = "1.46.2"; /* 1.46.2 pr note */ /* 1.47.0 main note */ /* 1.46.1 shared */\n', "resolve_version_only: either direction yields the pull request's version with both note chains")
    # VERSION-LINE-SPLIT-1: notes one per line below the statement; both sides add a note and bump the VERSION
    sp = 'top\n<<<<<<< HEAD\nvar VERSION = "0.43.0-pr";\n/* 0.43.0 pr note */\n=======\nvar VERSION = "0.42.1-main";\n/* 0.42.1 main note */\n>>>>>>> main\n/* 0.42.0 shared */\n'
    ok(resolve_version_only(sp, "ours") == 'top\nvar VERSION = "0.43.0-pr";\n/* 0.43.0 pr note */\n/* 0.42.1 main note */\n/* 0.42.0 shared */\n', "split notes: the pull request's VERSION, its note, then main's note", resolve_version_only(sp, "ours"))
    ok(resolve_version_only('<<<<<<< HEAD\n/* a */\n=======\n/* b */\n/* a */\n>>>>>>> pr\n') == '/* b */\n/* a */\n', "a notes-only hunk keeps the pull request's notes and adds main's missing ones")
    ok(resolve_version_only('<<<<<<< HEAD\nvar VERSION = "1";\n/* a */\n=======\n/* b */\n>>>>>>> pr\n') is None, "a VERSION line on one side only is refused")
    ok(resolve_version_only('<<<<<<< HEAD\nvar VERSION = "1";\n=======\nvar VERSION = "2";\n/* n */ const z = 1;\n>>>>>>> pr\n') is None, "a note line that carries code is refused")
    ok(asks_to_wait({"title": "WIP: x"}) and asks_to_wait({"title": "hold: y"}) and asks_to_wait({"title": "z", "labels": [{"name": "do not merge"}]}) and asks_to_wait({"title": "z", "body": "please do-not-merge"}) and not asks_to_wait({"title": "Withhold nothing, shipping soon", "body": "ok"}), "asks_to_wait: WIP, hold and do-not-merge, not words that merely contain them")
    ok(all(asks_to_wait({"title": "z", "body": b}) for b in ("Draft until an independent adversarial review has returned", "this stays a draft", "Keep it as a draft for now", "not ready for merge", "not ready to merge yet", "Not ready for review"))
       and not any(asks_to_wait({"title": "z", "body": b}) for b in ("the phrase `draft until` in code documents the rule", "```\ndo not merge\n```\nfinished", "use ~~~\nnot ready for merge\n~~~ as the fence", "the harness opens every session pull request as a draft", "ready for review", "a draft that is green is marked ready", "drafting notes until later")), "asks_to_wait: the body phrases a session uses to keep a draft on purpose hold it; a body that only mentions drafts does not")
    stamp = lambda secs: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(1000000 + secs))
    prs = {1: dict(base_pr, number=1, mergeable=False, mergeable_state="dirty", head=dict(base_pr["head"], sha="a1", ref="codeagent-x")), 2: dict(base_pr, number=2, mergeable=False, mergeable_state="dirty", head=dict(base_pr["head"], sha="a2", ref="fix/y")),
           3: dict(base_pr, number=3, mergeable=True, mergeable_state="clean", head=dict(base_pr["head"], sha="a3")), 4: dict(base_pr, number=4, mergeable=False, mergeable_state="dirty", head=dict(base_pr["head"], sha="a4", ref="repair/pr-9-abc")),
           5: dict(base_pr, number=5, mergeable=False, mergeable_state="dirty", head=dict(base_pr["head"], sha="a5")), 6: dict(base_pr, number=6, mergeable=False, mergeable_state="dirty", head=dict(base_pr["head"], sha="a6")), 7: dict(base_pr, number=7, mergeable=False, mergeable_state="dirty", draft=True, head=dict(base_pr["head"], sha="a7"))}
    prs[5]["title"] = "WIP: not yet"
    ages = {"a1": 600, "a2": 3600, "a3": 99999, "a5": 99999, "a6": 30, "a7": 99999}  # seconds since the newest commit at now = 1000000 + 4000
    reads = {"n": 0}
    def fake_gh(path):
        if path.endswith("/pulls?state=open&per_page=100"):
            return [{"number": n, "draft": v.get("draft"), "title": v["title"], "body": v.get("body"), "labels": [], "head": {"ref": v["head"]["ref"]}} for n, v in prs.items()]
        mm = re.search(r"/pulls/(\d+)$", path)
        if mm:
            reads["n"] += 1
            v = dict(prs[int(mm.group(1))])
            if int(mm.group(1)) == 2 and reads["n"] < 3:
                v["mergeable"] = None  # GitHub has not computed it yet
            return v
        mm = re.search(r"/commits/(\w+)$", path)
        return {"commit": {"committer": {"date": stamp(4000 - ages[mm.group(1)])}}} if mm else None
    got = dirty_prs(5, 10, now=1000000 + 4000, ghf=fake_gh, sleep=lambda x: None)
    ok(got == [7, 2, 1], "dirty_prs: conflicting quiet pull requests, longest quiet first, a draft included; a clean one, a repair branch, a hold and one committed 30 s ago are left; a null mergeability is read again", got)
    ok(dirty_prs(1, 10, now=1000000 + 4000, ghf=fake_gh, sleep=lambda x: None) == [7], "dirty_prs: the limit is honoured")
    DRAFTS = False
    try:
        got = dirty_prs(5, 10, now=1000000 + 4000, ghf=fake_gh, sleep=lambda x: None)
    finally:
        DRAFTS = saved_drafts
    ok(got == [2, 1], "dirty_prs: CONFLICT_REPAIR_DRAFTS=off leaves a draft alone again", got)
    prs[7]["title"] = "hold: waiting for the owner"
    ok(7 not in dirty_prs(5, 10, now=1000000 + 4000, ghf=fake_gh, sleep=lambda x: None), "dirty_prs: a draft that asks to wait is left")
    prs[7]["title"] = "fix x"
    # CONFLICT-REPAIR-BOT-QUIET-1: a codeagent-* branch waits 3 minutes, a person's branch still waits the full ten
    saved_ages = dict(ages)
    ages["a1"], ages["a2"] = 240, 240
    got = dirty_prs(5, 10, now=1000000 + 4000, ghf=fake_gh, sleep=lambda x: None)
    ok(1 in got and 2 not in got, "dirty_prs: a code-loop branch committed 4 minutes ago is taken, a person's branch committed 4 minutes ago is left", got)
    ages["a1"] = 120
    ok(1 not in dirty_prs(5, 10, now=1000000 + 4000, ghf=fake_gh, sleep=lambda x: None), "dirty_prs: a code-loop branch committed 2 minutes ago is still left (it may be mid-push)")
    ages.clear(); ages.update(saved_ages)
    # PR-MERGE-SLA-10M-1: the default quiet window is 3 minutes, so a person's branch committed 4 minutes ago is taken and one committed 2 minutes ago is left
    ages["a2"], ages["a6"] = 240, 120
    got = dirty_prs(5, now=1000000 + 4000, ghf=fake_gh, sleep=lambda x: None)
    ok(DIRTY_QUIET_MIN == 3 and 2 in got and 6 not in got, "dirty_prs: the default quiet window is 3 minutes (a person's branch committed 4 minutes ago is taken, 2 minutes ago is left)", got)
    ages.clear(); ages.update(saved_ages)
    # PR-MERGE-SLA-10M-1: a pull request GitHub never computes (mergeable stays null while main moves) is tested with git, not skipped
    for n, sha in ((8, "a8"), (9, "a9"), (10, "a10")):
        prs[n] = dict(base_pr, number=n, mergeable=None, mergeable_state="unknown", head=dict(base_pr["head"], sha=sha, ref="fix/n%d" % n))
        ages[sha] = 99999
    tested = []
    def fake_mt(n, base_ref):
        tested.append((n, base_ref))
        return {8: True, 9: False, 10: None}[n]
    got = dirty_prs(9, 10, now=1000000 + 4000, ghf=fake_gh, sleep=lambda x: None, mtf=fake_mt)
    ok(8 in got and 9 not in got and 10 not in got and sorted(n for n, _ in tested) == [8, 9, 10] and all(base == "main" for _, base in tested) and 2 in got and 3 not in got, "dirty_prs: a null mergeability that git says conflicts is tested against its base; clean and cannot-tell are left; a pull request GitHub did compute is not re-tested", (got, tested))
    for n in (8, 9, 10):
        del prs[n]
    ages.clear(); ages.update(saved_ages)
    # PR-MERGE-SLA-10M-1: merge_tree_conflicts against a remote with pull refs and non-main base branches.
    with tempfile.TemporaryDirectory() as d:
        bare, work = os.path.join(d, "origin.git"), os.path.join(d, "work")
        def g(cwd, *a):
            return git(list(a), cwd)
        os.mkdir(bare); g(bare, "init", "-q", "--bare", "-b", "main")
        os.mkdir(work); g(work, "init", "-q", "-b", "main"); g(work, "config", "user.email", "a@b.c"); g(work, "config", "user.name", "t")
        g(work, "remote", "add", "origin", bare)
        open(os.path.join(work, "f.txt"), "w").write("one\ntwo\nthree\n"); open(os.path.join(work, "g.txt"), "w").write("g\n"); open(os.path.join(work, "h.txt"), "w").write("base\n")
        g(work, "add", "-A"); g(work, "commit", "-qm", "base"); base = g(work, "rev-parse", "HEAD").strip()
        g(work, "checkout", "-q", "-b", "release/next", base); open(os.path.join(work, "h.txt"), "w").write("release\n"); g(work, "commit", "-qam", "release edit")
        g(work, "push", "-q", "origin", "release/next")
        g(work, "checkout", "-q", "-b", "pr5", base); open(os.path.join(work, "f.txt"), "w").write("one\nTWO-pr\nthree\n"); g(work, "commit", "-qam", "pr edit")
        g(work, "push", "-q", "origin", "pr5:refs/pull/5/head")
        g(work, "checkout", "-q", "-b", "pr8", base); open(os.path.join(work, "h.txt"), "w").write("pr\n"); g(work, "commit", "-qam", "release-target PR edit")
        g(work, "push", "-q", "origin", "pr8:refs/pull/8/head")
        g(work, "checkout", "-q", "-b", "pr6", base); open(os.path.join(work, "g.txt"), "w").write("g-pr\n"); g(work, "commit", "-qam", "pr edit g")
        g(work, "push", "-q", "origin", "pr6:refs/pull/6/head")
        g(work, "checkout", "-q", "main"); open(os.path.join(work, "f.txt"), "w").write("one\nTWO-main\nthree\n"); g(work, "commit", "-qam", "main edit")
        g(work, "push", "-q", "origin", "main")
        ok(merge_tree_conflicts(5, work) is True, "merge_tree_conflicts: a head editing the line main also edited conflicts")
        ok(merge_tree_conflicts(6, work) is False, "merge_tree_conflicts: a head editing another file merges cleanly")
        ok(merge_tree_conflicts(8, work, "main") is False and merge_tree_conflicts(8, work, "release/next") is True,
           "merge_tree_conflicts: a PR's conflict is evaluated against its actual base branch")
        ok(merge_tree_conflicts(8, work, "--upload-pack=bad") is None, "merge_tree_conflicts: an invalid base ref is not passed to git")
        ok(merge_tree_conflicts(77, work) is None, "merge_tree_conflicts: a pull request ref the remote lacks is 'cannot tell', never a conflict")
    # in-place: main is merged into the pull request's own branch; the pull request keeps its commits and gets main's
    with tempfile.TemporaryDirectory() as d:
        def g(*a):
            return git(list(a), d)
        g("init", "-q", "-b", "main"); g("config", "user.email", "a@b.c"); g("config", "user.name", "t")
        os.mkdir(os.path.join(d, "w"))
        src = 'var VERSION = "1.0.0"; /* 1.0.0 base */\nexport default {\n  a: 1,\n\n\n\n\n  z: 1\n};\n'
        for f in ("worker.js", "deployed-current.worker.js"):
            open(os.path.join(d, "w", f), "w").write(src)
        g("add", "-A"); g("commit", "-qm", "base"); g("checkout", "-q", "-b", "pr")
        for f in ("worker.js", "deployed-current.worker.js"):
            open(os.path.join(d, "w", f), "w").write(src.replace('"1.0.0"; /*', '"1.0.1-pr"; /* 1.0.1 pr note */ /*').replace("z: 1", "z: 2"))
        g("commit", "-qam", "pr change"); g("checkout", "-q", "main")
        for f in ("worker.js", "deployed-current.worker.js"):
            open(os.path.join(d, "w", f), "w").write(src.replace('"1.0.0"; /*', '"1.0.3-main"; /* 1.0.3 main note */ /*').replace("a: 1", "a: 9"))
        g("commit", "-qam", "main moved")
        r = reapply("pr", "main", "inplace/pr-1-abc", d, in_place=True)
        text = open(os.path.join(d, "w", "worker.js")).read()
        ok(r["outcome"] == "reapplied" and 'var VERSION = "1.0.1-pr"; /* 1.0.1 pr note */ /* 1.0.3 main note */ /* 1.0.0 base */' in text and "a: 9" in text and "z: 2" in text and text == open(os.path.join(d, "w", "deployed-current.worker.js")).read(),
           "reapply in place: main goes into the pull request's branch, both release notes survive, the mirror follows", (r, text))
        moved = bump_workers(r["workers"], 1, d, claims=lambda w, skip: ["1.0.3-main"])
        g("-c", "user.name=t", "-c", "user.email=a@b.c", "commit", "-qm", "merge main into pr")
        ok(moved == [("w", "1.0.1-pr", "1.0.4-pr")] and git(["log", "--first-parent", "--format=%s", "-3"], d).strip().split("\n")[1] == "pr change", "the merge commit sits on top of the pull request's own commits", moved)
    # MERGE-LANE-LANDED-1: a pull request whose substantive added lines are already on its base is detected; a different change is not
    with tempfile.TemporaryDirectory() as d:
        def g(*a):
            return git(list(a), d)
        g("init", "-q", "-b", "main"); g("config", "user.email", "a@b.c"); g("config", "user.name", "t")
        os.mkdir(os.path.join(d, "w"))
        base = 'var VERSION = "1.0.0";\nfunction f(m) {\n  if (m.indexOf("nemotron") >= 0) return 1;\n  return 0;\n}\n'
        for f in ("worker.js", "deployed-current.worker.js"):
            open(os.path.join(d, "w", f), "w").write(base)
        g("add", "-A"); g("commit", "-qm", "base")
        g("checkout", "-q", "-b", "same")
        for f in ("worker.js", "deployed-current.worker.js"):
            open(os.path.join(d, "w", f), "w").write(base.replace('"1.0.0"', '"1.0.1-same"').replace("  return 0;", '  if (m.indexOf("qwen") >= 0) return 2;\n  return 0;'))
        g("commit", "-qam", "same change"); g("checkout", "-q", "-b", "other", "main")
        for f in ("worker.js", "deployed-current.worker.js"):
            open(os.path.join(d, "w", f), "w").write(base.replace('"1.0.0"', '"1.0.1-other"').replace("  return 0;", '  if (m.indexOf("gemma") >= 0) return 3;\n  return 0;'))
        g("commit", "-qam", "other change"); g("checkout", "-q", "main")
        for f in ("worker.js", "deployed-current.worker.js"):
            open(os.path.join(d, "w", f), "w").write(base.replace('"1.0.0"', '"1.0.5-main"').replace("  return 0;", '  if (m.indexOf("qwen") >= 0) return 2; // landed elsewhere\n  return 0;').replace("return 1;", "return 1; /* x */"))
        g("commit", "-qam", "main already has the qwen branch")
        ok(landed_on_base("same", "main", d) is None, "landed_on_base: a line with a trailing comment on the base is not the same line (strict, no false positive)")
        g("checkout", "-q", "main")
        for f in ("worker.js", "deployed-current.worker.js"):
            open(os.path.join(d, "w", f), "w").write(base.replace('"1.0.0"', '"1.0.5-main"').replace("  return 0;", '  if (m.indexOf("qwen") >= 0) return 2;\n  return 0;'))
        g("commit", "-qam", "main has the exact line")
        ok(landed_on_base("same", "main", d) == ["w/worker.js"], "landed_on_base: the pull request's added line is on its base; VERSION and the mirror are ignored", landed_on_base("same", "main", d))
        ok(landed_on_base("other", "main", d) is None, "landed_on_base: a change the base does not have is not landed")
    # MERGE-LANE-LANDED-2: placement matters. A line that occurs elsewhere in main's file does not make the change landed.
    with tempfile.TemporaryDirectory() as d:
        def g(*a):
            return git(list(a), d)
        def put(text):
            for f in ("worker.js", "deployed-current.worker.js"):
                open(os.path.join(d, "w", f), "w").write(text)
        g("init", "-q", "-b", "main"); g("config", "user.email", "a@b.c"); g("config", "user.name", "t")
        os.mkdir(os.path.join(d, "w"))
        base = ('var VERSION = "1.0.0";\nasync function handleA(request, env) {\n  validateInput(request, env);\n  return doA(request);\n}\n'
                'async function handleB(request, env) {\n  return doB(request);\n}\nfunction legacy() {\n  oldHelperCall(1);\n  return 1;\n}\n')
        put(base); g("add", "-A"); g("commit", "-qm", "base")
        g("checkout", "-q", "-b", "dup")
        put(base.replace('"1.0.0"', '"1.0.1-dup"').replace("async function handleB(request, env) {\n", "async function handleB(request, env) {\n  validateInput(request, env);\n"))
        g("commit", "-qam", "dup: handleB gains the call handleA already has")
        g("checkout", "-q", "-b", "del", "main")
        put(base.replace('"1.0.0"', '"1.0.1-del"').replace("  oldHelperCall(1);\n", ""))
        g("commit", "-qam", "del: remove the helper call")
        g("checkout", "-q", "-b", "rep", "main")
        put(base.replace('"1.0.0"', '"1.0.1-rep"').replace("oldHelperCall(1);", "newHelperCall(1);"))
        g("commit", "-qam", "rep: replace the helper call")
        g("checkout", "-q", "main")
        ok(landed_on_base("dup", "main", d) is None, "landed_on_base: a call the base has in another function does not make a one-line change landed (the PR 3216 hole)")
        put(base.replace('"1.0.0"', '"1.0.5-main"').replace("async function handleB(request, env) {\n", "async function handleB(request, env) {\n  validateInput(request, env);\n"))
        g("commit", "-qam", "main gains the call in handleB")
        ok(landed_on_base("dup", "main", d) == ["w/worker.js"], "landed_on_base: the same change is landed once handleB has the call itself", landed_on_base("dup", "main", d))
        ok(landed_on_base("del", "main", d) is None, "landed_on_base: a deletion is not landed while the base still has the removed line")
        put(base.replace('"1.0.0"', '"1.0.6-main"').replace("  oldHelperCall(1);\n", ""))
        g("commit", "-qam", "main removes the helper call")
        ok(landed_on_base("del", "main", d) == ["w/worker.js"], "landed_on_base: a deletion is landed when the base lacks the line and the two neighbours are adjacent", landed_on_base("del", "main", d))
        ok(landed_on_base("rep", "main", d) is None, "landed_on_base: a replacement is not landed while the base has neither the new line nor lost the old one in place")
    emit("conflict_repair selftest: " + ("ok" if not fails else "%d FAILED" % len(fails)))
    return 1 if fails else 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--pr", type=int)
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--dirty", action="store_true", help="also take every open pull request GitHub reports as conflicting and quiet "
                    "(CONFLICT-REPAIR-INPLACE-1): main is merged into its own branch, VERSION-line and mirror conflicts only")
    ap.add_argument("--quiet-min", type=int, default=DIRTY_QUIET_MIN)
    ap.add_argument("--max", type=int, default=3)
    ap.add_argument("--push", action="store_true")
    ap.add_argument("--keep-branch", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args(argv)
    if a.selftest:
        return selftest()
    if not a.pr and not a.all and not a.dirty:
        ap.error("--pr <n>, --all or --dirty")
    work = []  # (number, in_place)
    if a.pr:
        work.append((a.pr, False))
    else:
        dirty = []
        if a.dirty:
            try:
                dirty = dirty_prs(max(1, a.max), a.quiet_min)
            except Exception as e:  # noqa: BLE001
                emit("::warning::conflict-repair: cannot list the conflicting pull requests: " + str(e)[:200])
        work += [(n, True) for n in dirty]  # a pull request found conflicting is updated in place, whether or not it also has a repair issue
        if a.all:
            try:
                work += [(n, False) for n in open_issue_prs()[: max(1, a.max)] if n not in dirty]
            except Exception as e:  # noqa: BLE001
                emit("::warning::conflict-repair: cannot read the repair issues: " + str(e)[:200])
    if a.all or a.dirty:
        heartbeat(len(work), a.push)
    if not work:
        emit(json.dumps({"conflict_repair": "nothing to do"}))
        return 0
    for n, in_place in work:
        try:
            emit(json.dumps({"conflict_repair": repair(n, a.push, a.keep_branch, in_place)}, default=str))
        except Exception as e:  # noqa: BLE001  (one pull request's failure never stops the next)
            emit(json.dumps({"conflict_repair": {"pr": n, "outcome": "error", "error": type(e).__name__ + ": " + str(e)[:300]}}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
